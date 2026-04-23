// ═══════════════════════════════════════════════════════════════
// Pure calculation functions for Auto Trade Hub.
//
// Extracted from sayarah-auction-flip.jsx so they can be unit-tested
// without a React/DOM runtime. Everything here is a pure function (or a
// module-level mutable config intentionally shared with the app).
//
// The regression test lives at tests/calc.test.mjs and is run via
// `npm test` (node --test). Add a test for every money-affecting change.
// ═══════════════════════════════════════════════════════════════

// Parse any user-typed money value to a number. Strings, empty strings,
// NaN-producing inputs all safely collapse to 0.
export const p = (v) => parseFloat(v) || 0;

// ─── Auction Fee Structures (Copart/IAAI tiers as published) ──────
// DEFAULT_AUCTION_FEE_TIERS is the immutable baseline. AUCTION_FEE_TIERS
// is a mutable copy the app can override via the Settings tab. Both
// pct-style and fee-style tiers are supported; every flat fee field
// falls back to 0 if missing so `undefined + number` (NaN) can't leak
// into Total Cost.
export const DEFAULT_AUCTION_FEE_TIERS = {
  copart: {
    name: "Copart",
    tiers: [
      { max: 99.99, fee: 25 }, { max: 199.99, fee: 50 }, { max: 299.99, fee: 75 },
      { max: 399.99, fee: 100 }, { max: 499.99, fee: 130 }, { max: 599.99, fee: 155 },
      { max: 699.99, fee: 180 }, { max: 799.99, fee: 200 }, { max: 899.99, fee: 215 },
      { max: 999.99, fee: 235 }, { max: 1199.99, fee: 260 }, { max: 1299.99, fee: 280 },
      { max: 1499.99, fee: 310 }, { max: 1599.99, fee: 325 }, { max: 1799.99, fee: 355 },
      { max: 1999.99, fee: 380 }, { max: 2399.99, fee: 400 }, { max: 2499.99, fee: 415 },
      { max: 2999.99, fee: 435 }, { max: 3499.99, fee: 475 }, { max: 3999.99, fee: 500 },
      { max: 4499.99, fee: 600 }, { max: 4999.99, fee: 625 }, { max: 5999.99, fee: 650 },
      { max: 7499.99, fee: 700 }, { max: 9999.99, fee: 750 }, { max: 14999.99, fee: 800 },
      { max: 19999.99, fee: 850 }, { max: Infinity, pct: 5 },
    ],
    gateFee: 79, envFee: 10, titleFee: 0, virtualBidFee: 0,
  },
  iaai: {
    name: "IAAI",
    tiers: [
      { max: 99.99, fee: 25 }, { max: 199.99, fee: 50 }, { max: 299.99, fee: 65 },
      { max: 399.99, fee: 95 }, { max: 499.99, fee: 110 }, { max: 599.99, fee: 130 },
      { max: 699.99, fee: 155 }, { max: 799.99, fee: 175 }, { max: 899.99, fee: 190 },
      { max: 999.99, fee: 210 }, { max: 1199.99, fee: 235 }, { max: 1499.99, fee: 275 },
      { max: 1999.99, fee: 340 }, { max: 2499.99, fee: 375 }, { max: 2999.99, fee: 400 },
      { max: 3999.99, fee: 475 }, { max: 4999.99, fee: 575 }, { max: 7499.99, fee: 650 },
      { max: 9999.99, fee: 725 }, { max: 14999.99, fee: 775 }, { max: Infinity, pct: 5 },
    ],
    gateFee: 79, envFee: 0, titleFee: 0, virtualBidFee: 100,
  },
  manheim: { name: "Manheim", tiers: [{ max: Infinity, pct: 5 }], gateFee: 59, envFee: 0, titleFee: 0, virtualBidFee: 0 },
  private_party: { name: "Private Party", tiers: [{ max: Infinity, pct: 0 }], gateFee: 0, envFee: 0, titleFee: 0, virtualBidFee: 0 },
  autotrader: { name: "AutoTrader", tiers: [{ max: Infinity, pct: 0 }], gateFee: 0, envFee: 0, titleFee: 0, virtualBidFee: 0 },
  facebook: { name: "Facebook Marketplace", tiers: [{ max: Infinity, pct: 0 }], gateFee: 0, envFee: 0, titleFee: 0, virtualBidFee: 0 },
  trade_in: { name: "Trade-In", tiers: [{ max: Infinity, pct: 0 }], gateFee: 0, envFee: 0, titleFee: 0, virtualBidFee: 0 },
  other: { name: "Other", tiers: [{ max: Infinity, pct: 0 }], gateFee: 0, envFee: 0, titleFee: 0, virtualBidFee: 0 },
  custom: { name: "Custom %", tiers: [{ max: Infinity, pct: 0 }], gateFee: 0, envFee: 0, titleFee: 0, virtualBidFee: 0 },
};

// Deep-clone the defaults so in-place mutation by applyCustomAuctionFeeTiers
// doesn't leak back into DEFAULT_AUCTION_FEE_TIERS.
export const cloneTierConfig = (src) => Object.fromEntries(
  Object.entries(src).map(([k, v]) => [k, { ...v, tiers: v.tiers.map((t) => ({ ...t })) }])
);

export const AUCTION_FEE_TIERS = cloneTierConfig(DEFAULT_AUCTION_FEE_TIERS);

// Merges admin overrides onto the defaults and mutates AUCTION_FEE_TIERS
// in place. Called during render when `data.auctionFeeTiers` changes so
// every downstream calcAuctionFees call picks up the new rates.
// Infinite-max tiers are stored as `max: null` in Firestore and
// deserialized back to Infinity here.
export function applyCustomAuctionFeeTiers(custom) {
  const fresh = cloneTierConfig(DEFAULT_AUCTION_FEE_TIERS);
  for (const k of Object.keys(AUCTION_FEE_TIERS)) delete AUCTION_FEE_TIERS[k];
  for (const [k, v] of Object.entries(fresh)) AUCTION_FEE_TIERS[k] = v;
  if (!custom || typeof custom !== "object") return;
  for (const src of Object.keys(custom)) {
    if (!AUCTION_FEE_TIERS[src]) continue;
    const ov = custom[src] || {};
    const next = { ...AUCTION_FEE_TIERS[src] };
    if (typeof ov.gateFee === "number") next.gateFee = ov.gateFee;
    if (typeof ov.envFee === "number") next.envFee = ov.envFee;
    if (typeof ov.titleFee === "number") next.titleFee = ov.titleFee;
    if (typeof ov.virtualBidFee === "number") next.virtualBidFee = ov.virtualBidFee;
    if (Array.isArray(ov.tiers) && ov.tiers.length > 0) {
      next.tiers = ov.tiers.map((t) => ({
        ...t,
        max: (t.max == null || t.max === "Infinity") ? Infinity : Number(t.max),
      }));
    }
    AUCTION_FEE_TIERS[src] = next;
  }
}

// Inverse of applyCustomAuctionFeeTiers — sparse override shape that's
// Firestore-safe (Infinity → null).
export function serializeTierOverrides(source) {
  return {
    ...source,
    tiers: source.tiers.map((t) => ({ ...t, max: t.max === Infinity ? null : t.max })),
  };
}

// Calculate the buyer's auction fees for a given purchase price and
// source. Returns a shape with a numeric `total` — never NaN, never
// undefined, even when the source's tier is pct=0 or fee=0. This
// guarantee is what makes calcTotalCost safe downstream.
//
// Regression note: the old implementation read `tier.pct ? price * pct/100
// : tier.fee`, which treated pct=0 as "no pct" and fell through to
// tier.fee — undefined on every non-Copart/IAAI/Manheim source — yielding
// NaN total and cascading $0 Total Cost across reports. See the test
// "calcAuctionFees returns a number for every known source" for the
// regression guard.
export function calcAuctionFees(price, source) {
  const s = AUCTION_FEE_TIERS[source] || AUCTION_FEE_TIERS.custom;
  // Open-ended fallback if price > every defined max.
  const tier = s.tiers.find((t) => price <= t.max) || s.tiers[s.tiers.length - 1];
  const premium = typeof tier.pct === "number"
    ? price * (tier.pct / 100)
    : (typeof tier.fee === "number" ? tier.fee : 0);
  const gate = typeof s.gateFee === "number" ? s.gateFee : 0;
  const env = typeof s.envFee === "number" ? s.envFee : 0;
  const title = typeof s.titleFee === "number" ? s.titleFee : 0;
  const vbid = typeof s.virtualBidFee === "number" ? s.virtualBidFee : 0;
  return { premium, gate, env, title, vbid, total: premium + gate + env + title + vbid };
}

// ─── Total Cost — the single source of truth for cost basis ───
// Total Cost = Purchase Price + computed Auction Fees + every cost
// attached to this vehicle (legacy acquisition fields + every tracked
// expense, every category, matched by stockNum). Displays everywhere —
// the stat card, the Cost Breakdown total row, the P&L subtraction line,
// reports, exports — all read this single function.
export function calcTotalCost(v, expenses = []) {
  const pp = p(v.purchasePrice);
  let auctCost;
  if (v.useCustomPremium) {
    auctCost = pp * p(v.buyerPremiumPct) / 100;
  } else {
    auctCost = calcAuctionFees(pp, v.auctionSource || "custom").total;
  }
  const legacy = p(v.transportCost) + p(v.repairCost) + p(v.otherExpenses);
  const tracked = Array.isArray(expenses)
    ? expenses.filter((e) => e.stockNum === v.stockNum).reduce((s, e) => s + p(e.amount), 0)
    : 0;
  return pp + auctCost + legacy + tracked;
}

// Sum of tracked expenses for a vehicle (no purchase price, no auction
// fees). Used anywhere we need "just the expense ledger" number.
export function calcVehicleExpenses(v, expenses) {
  if (!v || !Array.isArray(expenses)) return 0;
  return expenses.filter((e) => e.stockNum === v.stockNum).reduce((s, e) => s + p(e.amount), 0);
}

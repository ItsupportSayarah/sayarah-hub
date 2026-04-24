// Regression tests for Auto Trade Hub cost / P&L calculations.
//
// Run with:  npm test
//
// Every test that references a specific dollar figure is ticketed to a
// real bug report so we can't quietly regress on the exact symptom
// again.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  p,
  calcAuctionFees,
  calcTotalCost,
  calcVehicleExpenses,
  AUCTION_FEE_TIERS,
  DEFAULT_AUCTION_FEE_TIERS,
  applyCustomAuctionFeeTiers,
} from "../apps/auction/src/calc.js";

// ─── Regression: stock #001 ─────────────────────────────────────
// Reported bug (INV-001-MOC34XNI): 2007 Toyota 4Runner, purchase
// $9,000, tracked expenses Office/Admin $320 + Transport/Towing $250 +
// Storage/Parking $109, sold at $9,000. Detail page showed Total Cost
// $0 and P&L $0; PDF showed "—" for Net Profit / Margin / ROI / Grade.
//
// Root cause: calcAuctionFees fell through to `tier.fee` when `pct: 0`
// was the tier, producing NaN auction fees for every non-Copart/IAAI/
// Manheim source. NaN propagated into Total Cost.
//
// These tests lock the correct values in so the specific symptom
// can't ship again.
test("stock #001 regression — Total Cost is $9,974 (includes $295 tax reserve)", () => {
  const vehicle = {
    stockNum: "001",
    year: 2007,
    make: "Toyota",
    model: "4Runner",
    purchasePrice: 9000,
    auctionSource: "other",        // the source that triggered the original bug
    useCustomPremium: false,
    transportCost: "",
    repairCost: "",
    otherExpenses: "",
  };
  const expenses = [
    { id: "e1", stockNum: "001", category: "Office/Admin", amount: 320 },
    { id: "e2", stockNum: "001", category: "Transport/Towing", amount: 250 },
    { id: "e3", stockNum: "001", category: "Storage/Parking", amount: 109 },
  ];

  const total = calcTotalCost(vehicle, expenses);

  // 9000 purchase + 0 auction + 679 expenses + 295 tax reserve = 9974
  assert.equal(total, 9974, `expected $9,974, got ${total}`);
  assert.ok(Number.isFinite(total), "Total Cost must be a finite number, never NaN");
});

test("stock #001 regression — tracked-expense sum is $679", () => {
  const v = { stockNum: "001" };
  const expenses = [
    { stockNum: "001", amount: 320 },
    { stockNum: "001", amount: 250 },
    { stockNum: "001", amount: 109 },
    { stockNum: "002", amount: 999 }, // belongs to a different vehicle
  ];
  assert.equal(calcVehicleExpenses(v, expenses), 679);
});

// ─── Auction-fee surface: every source returns a finite number ───
// Guards the exact regression that caused bug #001. Before the fix,
// any source whose tier was `{pct: 0}` (private_party, autotrader,
// facebook, trade_in, other, custom) returned NaN because `tier.pct`
// is falsy and the code fell through to `tier.fee` which was
// undefined. The test below iterates every shipped source and
// asserts a finite numeric total, with both $0 and $9,000 price
// points.
test("calcAuctionFees returns a finite number for every source (bug-001 regression)", () => {
  const sources = Object.keys(DEFAULT_AUCTION_FEE_TIERS);
  for (const src of sources) {
    for (const price of [0, 500, 9000, 25000]) {
      const { total } = calcAuctionFees(price, src);
      assert.ok(
        Number.isFinite(total),
        `calcAuctionFees(${price}, "${src}").total is not finite — got ${total}. ` +
        `This is the exact bug that caused stock #001 to show $0 Total Cost.`
      );
    }
  }
});

test("calcAuctionFees: pct=0 sources all return 0 premium", () => {
  for (const src of ["private_party", "autotrader", "facebook", "trade_in", "other", "custom"]) {
    const { premium, total } = calcAuctionFees(9000, src);
    assert.equal(premium, 0, `${src}: expected $0 premium, got ${premium}`);
    assert.equal(total, 0, `${src}: expected $0 total, got ${total}`);
  }
});

test("calcAuctionFees: Copart tier lookup matches the published rate card", () => {
  // $9,000 vehicle at Copart: tier max 9999.99 → fee $750, plus $79 gate + $10 env
  const r = calcAuctionFees(9000, "copart");
  assert.equal(r.premium, 750);
  assert.equal(r.gate, 79);
  assert.equal(r.env, 10);
  assert.equal(r.total, 839);
});

test("calcAuctionFees: IAAI pct=5 top tier for >$14,999.99", () => {
  const r = calcAuctionFees(20000, "iaai");
  assert.equal(r.premium, 1000); // 5% of 20000
  assert.equal(r.total, 1000 + 79 + 100); // gate + virtualBid
});

test("calcAuctionFees: price above every defined max uses the open-ended tier", () => {
  const r = calcAuctionFees(500000, "copart");
  assert.ok(Number.isFinite(r.total), "no NaN on price overflow");
  assert.equal(r.premium, 500000 * 0.05);
});

// ─── calcTotalCost guarantees ───────────────────────────────────
test("calcTotalCost: empty vehicle returns 0 (never NaN)", () => {
  const total = calcTotalCost({ stockNum: "x" }, []);
  assert.equal(total, 0);
  assert.ok(Number.isFinite(total));
});

test("calcTotalCost: includes legacy acquisition fields when present", () => {
  const v = {
    stockNum: "x",
    purchasePrice: 1000,
    auctionSource: "other",
    transportCost: 100,
    repairCost: 200,
    otherExpenses: 50,
  };
  // +295 tax reserve baked in on every real vehicle
  assert.equal(calcTotalCost(v, []), 1000 + 0 + 100 + 200 + 50 + 295);
});

test("calcTotalCost: tracked expenses filtered by stockNum", () => {
  const v = { stockNum: "A", purchasePrice: 5000, auctionSource: "other" };
  const expenses = [
    { stockNum: "A", amount: 100 },
    { stockNum: "B", amount: 999 }, // not this vehicle
    { stockNum: "A", amount: 50 },
  ];
  assert.equal(calcTotalCost(v, expenses), 5000 + 100 + 50 + 295);
});

test("calcTotalCost: useCustomPremium overrides source-based fees", () => {
  const v = {
    stockNum: "x",
    purchasePrice: 10000,
    auctionSource: "copart",
    useCustomPremium: true,
    buyerPremiumPct: 3, // 3% custom
  };
  assert.equal(calcTotalCost(v, []), 10000 + 300 + 295);
});

test("calcTotalCost: silently accepts non-array expenses (defensive)", () => {
  const v = { stockNum: "x", purchasePrice: 100, auctionSource: "other" };
  assert.equal(calcTotalCost(v, null), 100 + 295);
  assert.equal(calcTotalCost(v, undefined), 100 + 295);
});

test("calcTotalCost: parseFloat-unfriendly values collapse to 0 (no NaN leaks)", () => {
  const v = {
    stockNum: "x",
    purchasePrice: "1000",  // string that parses fine
    auctionSource: "other",
    transportCost: "abc",   // unparseable
    repairCost: undefined,
    otherExpenses: null,
  };
  const total = calcTotalCost(v, [{ stockNum: "x", amount: "forty" }]);
  assert.equal(total, 1000 + 295);
  assert.ok(Number.isFinite(total));
});

// Regression guard: the $295 baked into Total Cost must match
// TAX_PER_SALE in money.js so the post-sale JE accrual and the
// upfront inventory cost stay in sync.
test("calcTotalCost: $295 tax reserve matches money.js TAX_PER_SALE", async () => {
  const { TAX_PER_SALE } = await import("../apps/auction/src/money.js");
  const { TAX_RESERVE_PER_VEHICLE } = await import("../apps/auction/src/calc.js");
  assert.equal(TAX_RESERVE_PER_VEHICLE, TAX_PER_SALE,
    "calc.js TAX_RESERVE_PER_VEHICLE must equal money.js TAX_PER_SALE");
});

// ─── p() helper ─────────────────────────────────────────────────
test("p() never returns NaN", () => {
  assert.equal(p(""), 0);
  assert.equal(p(null), 0);
  assert.equal(p(undefined), 0);
  assert.equal(p(NaN), 0);
  assert.equal(p("abc"), 0);
  assert.equal(p("123"), 123);
  assert.equal(p(42), 42);
  assert.equal(p(-7.5), -7.5);
});

// ─── Admin fee-tier overrides ───────────────────────────────────
test("applyCustomAuctionFeeTiers merges admin overrides and is reversible", () => {
  applyCustomAuctionFeeTiers({ copart: { gateFee: 99 } });
  assert.equal(AUCTION_FEE_TIERS.copart.gateFee, 99);
  applyCustomAuctionFeeTiers(null);
  assert.equal(AUCTION_FEE_TIERS.copart.gateFee, DEFAULT_AUCTION_FEE_TIERS.copart.gateFee);
});

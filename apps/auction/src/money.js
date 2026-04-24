// ═══════════════════════════════════════════════════════════════
// Money Management — double-entry accounting core.
//
// This module is the single source of truth for every financial
// operation: member contributions, the Atlantic Fund, per-vehicle
// funding, profit distribution, the tax sub-account, and every
// journal entry that backs them. Pure functions only — no React,
// no DOM. Tested in tests/money.test.mjs.
//
// Design:
//   • Every money movement is a journal entry (JE) with at least
//     one debit and one credit line; debits must equal credits.
//   • JEs are immutable once posted. Corrections are posted as a
//     reversing JE, never by mutating history.
//   • Account balances are computed from the ledger on demand, so
//     we never have a stored-balance-drift bug.
// ═══════════════════════════════════════════════════════════════

import { p } from "./calc.js";

// ─── Account types & chart of accounts ────────────────────────
// `normal` is the natural balance side. Increases to an asset or
// expense are debits; to equity, liability, revenue are credits.
// Used for balance computation: balance = sum(debits) − sum(credits)
// for asset/expense, or reversed for the others.
export const ACCOUNT_TYPES = {
  asset: { normal: "debit" },
  liability: { normal: "credit" },
  equity: { normal: "credit" },
  revenue: { normal: "credit" },
  expense: { normal: "debit" },
};

// Well-known system account ids. Members and vehicle inventory
// accounts are generated dynamically (one per member, one per
// vehicle) with ids member:<id> and vehicle:<stockNum>.
export const SYSTEM_ACCOUNTS = {
  SAYARAH_BANK: "bank:sayarah-chase",
  ATLANTIC_FUND: "fund:atlantic",
  PROFIT_DISTRIBUTION: "equity:profit-distribution",
  TAX: "liability:tax-account",
  REVENUE_VEHICLE_SALES: "revenue:vehicle-sales",
  COGS_VEHICLES: "expense:cogs-vehicles",
  OPERATING_EXPENSES: "expense:operating",
  SALES_TAX_PAYABLE: "liability:sales-tax-ma",
};

export const TAX_PER_SALE = 295; // MA S-Corp — skimmed to the tax sub-account on every sold vehicle

// ─── Default chart of accounts ────────────────────────────────
// Installed on first run via seedChartOfAccounts(). The app stores
// these under data.accounts so the admin can add custom accounts
// (e.g. new expense categories) without a code change.
export const DEFAULT_ACCOUNTS = [
  { id: SYSTEM_ACCOUNTS.SAYARAH_BANK, name: "Sayarah Chase Bank", type: "asset", system: true, description: "Primary operating account — holds the Atlantic Fund." },
  { id: SYSTEM_ACCOUNTS.ATLANTIC_FUND, name: "Atlantic Fund", type: "asset", system: true, description: "Shared member pool for vehicle purchases. Held inside the Chase account." },
  { id: SYSTEM_ACCOUNTS.PROFIT_DISTRIBUTION, name: "Profit Distribution (pending)", type: "equity", system: true, description: "Holds vehicle profit from sale until month-end split." },
  { id: SYSTEM_ACCOUNTS.TAX, name: "Tax Account ($295 per sale)", type: "liability", system: true, description: "Skimmed from every vehicle sale for MA/federal taxes + misc." },
  { id: SYSTEM_ACCOUNTS.REVENUE_VEHICLE_SALES, name: "Vehicle Sales Revenue", type: "revenue", system: true },
  { id: SYSTEM_ACCOUNTS.COGS_VEHICLES, name: "Cost of Goods Sold — Vehicles", type: "expense", system: true },
  { id: SYSTEM_ACCOUNTS.OPERATING_EXPENSES, name: "Operating Expenses", type: "expense", system: true },
  { id: SYSTEM_ACCOUNTS.SALES_TAX_PAYABLE, name: "MA Sales Tax Payable", type: "liability", system: true },
];

// Seed a member capital account. Called once per member.
export const memberAccountId = (memberId) => `equity:member:${memberId}`;
export const memberAccount = (memberId, name) => ({
  id: memberAccountId(memberId),
  name: `Member Capital — ${name}`,
  type: "equity",
  memberId,
  system: false,
});

// Seed a vehicle inventory account when a vehicle is created.
export const vehicleAccountId = (stockNum) => `asset:vehicle:${stockNum}`;
export const vehicleAccount = (stockNum, label) => ({
  id: vehicleAccountId(stockNum),
  name: `Vehicle Inventory — ${label}`,
  type: "asset",
  stockNum,
  system: false,
});

// ─── Journal entry construction ───────────────────────────────
// Every JE has: { id, date, memo, user, ip, timestamp, lines: [{ accountId, debit, credit }] }
// The lines must balance (sum debit === sum credit). postJournalEntry
// throws if they don't — forcing a bug to be caught before corrupt
// data lands in the ledger.

export function lineIsValid(line) {
  const d = p(line.debit);
  const c = p(line.credit);
  if (!line.accountId) return false;
  if (d < 0 || c < 0) return false;
  // Exactly one side must be > 0. Both > 0 or both 0 is invalid.
  if (d > 0 && c > 0) return false;
  if (d === 0 && c === 0) return false;
  if (!Number.isFinite(d) || !Number.isFinite(c)) return false;
  return true;
}

export function validateJournalEntry(entry) {
  if (!entry || !Array.isArray(entry.lines) || entry.lines.length < 2) {
    return "Journal entry must have at least 2 lines";
  }
  for (const line of entry.lines) {
    if (!lineIsValid(line)) return `Invalid line for account ${line.accountId || "(missing)"}`;
  }
  const totalDebit = entry.lines.reduce((s, l) => s + p(l.debit), 0);
  const totalCredit = entry.lines.reduce((s, l) => s + p(l.credit), 0);
  // Penny-tolerance for rounding.
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return `Debits (${totalDebit.toFixed(2)}) must equal credits (${totalCredit.toFixed(2)})`;
  }
  if (!entry.date) return "Journal entry must have a date";
  return null;
}

export function buildJournalEntry({ date, memo, lines, user, ip, ref }) {
  return {
    id: `je_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    date,
    memo: memo || "",
    user: user || "system",
    ip: ip || "",
    ref: ref || null, // optional pointer back to a vehicle/sale/contribution row
    timestamp: new Date().toISOString(),
    lines: lines.map((l) => ({
      accountId: l.accountId,
      debit: p(l.debit) || 0,
      credit: p(l.credit) || 0,
    })),
  };
}

// Append a validated entry to the ledger. Returns the new ledger
// (never mutates the input). Throws on invalid input — caller must
// catch and surface to the user.
export function postJournalEntry(ledger, entry) {
  const err = validateJournalEntry(entry);
  if (err) throw new Error(`Journal entry rejected: ${err}`);
  return [...(ledger || []), entry];
}

// Reverse an entry — for corrections. Creates a new entry with
// every debit/credit flipped, referencing the original. Both stay
// in the ledger; you never delete the original.
export function buildReversingEntry(original, { user, ip, memo } = {}) {
  return buildJournalEntry({
    date: new Date().toISOString().slice(0, 10),
    memo: memo || `REVERSAL of ${original.id}: ${original.memo || ""}`.trim(),
    user,
    ip,
    ref: { type: "reversal", of: original.id },
    lines: original.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.credit,
      credit: l.debit,
    })),
  });
}

// ─── Balance computation ──────────────────────────────────────
// Balance = (sum of debits − sum of credits) for asset/expense,
// or (sum of credits − sum of debits) for equity/liability/revenue.
// The caller passes the account type via accountsById.
export function calcAccountBalance(accountId, ledger, accountsById) {
  if (!ledger) return 0;
  let debits = 0;
  let credits = 0;
  for (const entry of ledger) {
    for (const line of entry.lines) {
      if (line.accountId !== accountId) continue;
      debits += p(line.debit);
      credits += p(line.credit);
    }
  }
  const account = accountsById && accountsById[accountId];
  const normal = account && ACCOUNT_TYPES[account.type]
    ? ACCOUNT_TYPES[account.type].normal
    : "debit";
  return normal === "debit" ? debits - credits : credits - debits;
}

// Compute every account's balance in one pass. Returns { [id]: number }.
export function calcAllBalances(ledger, accounts) {
  const accountsById = Object.fromEntries((accounts || []).map((a) => [a.id, a]));
  const out = {};
  for (const acc of accounts || []) out[acc.id] = 0;
  // Also seed account buckets for any id appearing in the ledger
  // that isn't in the chart of accounts (defensive).
  for (const e of ledger || []) {
    for (const l of e.lines) {
      if (!(l.accountId in out)) out[l.accountId] = 0;
    }
  }
  for (const entry of ledger || []) {
    for (const line of entry.lines) {
      const acc = accountsById[line.accountId];
      const normal = acc && ACCOUNT_TYPES[acc.type]
        ? ACCOUNT_TYPES[acc.type].normal
        : "debit";
      if (normal === "debit") {
        out[line.accountId] += p(line.debit) - p(line.credit);
      } else {
        out[line.accountId] += p(line.credit) - p(line.debit);
      }
    }
  }
  return out;
}

// ─── Contribution + approval helpers ──────────────────────────

// YYYY-MM for a Date or ISO date string. Strings in YYYY-MM-DD form
// are handled via substring to sidestep the `new Date("2025-01-01")`
// UTC-parsing quirk that slides to Dec 31 in western-hemisphere TZs.
export const monthKey = (dateLike) => {
  if (typeof dateLike === "string" && /^\d{4}-\d{2}/.test(dateLike)) {
    return dateLike.slice(0, 7);
  }
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike || Date.now());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// Find a contribution record for (member, month) or null.
export const findContribution = (contributions, memberId, month) =>
  (contributions || []).find((c) => c.memberId === memberId && c.month === month) || null;

export const findApproval = (approvals, memberId, month) =>
  (approvals || []).find((a) => a.memberId === memberId && a.month === month) || null;

// Computed status: green only when BOTH the monthly contribution is
// paid AND admin has approved the member's fund usage for that month.
// Returns one of: "green" | "red" | "pending".
export function calcMemberMonthlyStatus(memberId, month, contributions, approvals) {
  const cont = findContribution(contributions, memberId, month);
  const appr = findApproval(approvals, memberId, month);
  const paid = !!cont && cont.status === "paid";
  const approved = !!appr && appr.status === "approved";
  if (paid && approved) return "green";
  if ((cont && cont.status === "late") || (appr && appr.status === "rejected")) return "red";
  // Blocked if paid but not approved, or approved but not paid, or neither yet —
  // rendering this as "red" matches the rule "red = missed contribution OR
  // not approved by admin → blocked from fund".
  return "red";
}

// Can this member draw from the Atlantic Fund right now?
// Rule: must be green for the current month.
export const canMemberUseFund = (memberId, contributions, approvals, now = new Date()) =>
  calcMemberMonthlyStatus(memberId, monthKey(now), contributions, approvals) === "green";

// Create contribution-due records for all members for a given month.
// Idempotent — if a record already exists for (member, month) it's
// kept as-is.
export const MONTHLY_CONTRIBUTION_AMOUNT = 25_000;
export const ATLANTIC_FUND_TARGET = 75_000;
export const ATLANTIC_FUND_LOW_BALANCE = 20_000;
export const LARGE_OUTFLOW_THRESHOLD = 10_000;

export function generateMonthlyContributions(contributions, members, month) {
  const existing = contributions || [];
  const added = [];
  for (const m of members || []) {
    if (findContribution(existing, m.id, month)) continue;
    added.push({
      id: `contrib_${month}_${m.id}`,
      memberId: m.id,
      month,
      amount: MONTHLY_CONTRIBUTION_AMOUNT,
      status: "pending", // pending | paid | late
      dueDate: `${month}-01`,
      paidDate: null,
      journalEntryId: null,
    });
  }
  return [...existing, ...added];
}

// ─── Event-to-journal translators ─────────────────────────────
// These are the canonical ways specific business events translate
// into journal entries. Every caller that posts money should go
// through one of these.

// Member pays their monthly contribution by wire/check into Chase.
// Post as a proper balanced entry: bank debits (cash received),
// member capital credits (member's equity stake grows).
// Use allocateToFundEntry() in a separate step to reclassify the
// cash from general bank holdings into the Atlantic Fund sub-ledger.
export function contributionPaidEntryBalanced({ memberId, month, amount, date, user, ip }) {
  return buildJournalEntry({
    date: date || `${month}-01`,
    memo: `Monthly contribution — ${memberId} — ${month}`,
    user, ip,
    ref: { type: "contribution", memberId, month },
    // Bank increases (debit asset). Member capital increases (credit
    // equity). That's the primary entry. The fund-designation is a
    // separate, balanced reclassifying entry — see allocateToFund().
    lines: [
      { accountId: SYSTEM_ACCOUNTS.SAYARAH_BANK, debit: amount, credit: 0 },
      { accountId: memberAccountId(memberId), debit: 0, credit: amount },
    ],
  });
}

// Separate entry: reclassify from general bank holdings to Atlantic Fund
// designation. Bank (asset) credit, Atlantic Fund (asset) debit.
// Net effect on total assets is zero — this is a memo entry.
export function allocateToFundEntry({ amount, date, user, ip, memo }) {
  return buildJournalEntry({
    date: date || new Date().toISOString().slice(0, 10),
    memo: memo || "Designate to Atlantic Fund",
    user, ip,
    lines: [
      { accountId: SYSTEM_ACCOUNTS.ATLANTIC_FUND, debit: amount, credit: 0 },
      { accountId: SYSTEM_ACCOUNTS.SAYARAH_BANK, debit: 0, credit: amount },
    ],
  });
}

// Vehicle purchase funded from the Atlantic Fund. Increases inventory,
// decreases fund. The vehicle sub-account is created lazily elsewhere.
export function vehiclePurchaseFromFundEntry({ stockNum, amount, date, memo, user, ip }) {
  return buildJournalEntry({
    date,
    memo: memo || `Vehicle purchase — #${stockNum}`,
    user, ip,
    ref: { type: "vehicle_purchase", stockNum, source: "fund" },
    lines: [
      { accountId: vehicleAccountId(stockNum), debit: amount, credit: 0 },
      { accountId: SYSTEM_ACCOUNTS.ATLANTIC_FUND, debit: 0, credit: amount },
    ],
  });
}

// Vehicle purchase funded personally by a member (counted as a
// capital contribution specifically for this vehicle).
export function vehiclePurchaseFromMemberEntry({ stockNum, memberId, amount, date, memo, user, ip }) {
  return buildJournalEntry({
    date,
    memo: memo || `Vehicle purchase — #${stockNum} — member ${memberId}`,
    user, ip,
    ref: { type: "vehicle_purchase", stockNum, source: "member", memberId },
    lines: [
      { accountId: vehicleAccountId(stockNum), debit: amount, credit: 0 },
      { accountId: memberAccountId(memberId), debit: 0, credit: amount },
    ],
  });
}

// Sale of a vehicle. Principal (totalCost) returns to the source it
// came from, $295 to the tax account, remaining profit to the
// distribution account. Loss scenarios: grossProfit is negative;
// distribution is 0; tax is still $295 (it's a flat skim).
export function vehicleSaleEntries({ stockNum, totalCost, grossSale, principalDestination, date, user, ip }) {
  // principalDestination: { type: "fund" } or { type: "member", memberId }
  const gross = p(grossSale);
  const cost = p(totalCost);
  const profit = gross - cost;
  const taxSkim = profit > TAX_PER_SALE ? TAX_PER_SALE : Math.max(0, profit);
  const distributable = profit - taxSkim;

  const principalAccount = principalDestination && principalDestination.type === "member"
    ? memberAccountId(principalDestination.memberId)
    : SYSTEM_ACCOUNTS.ATLANTIC_FUND;

  // Entry 1: cash in from sale, vehicle inventory out, gross profit recognized.
  const saleEntry = buildJournalEntry({
    date,
    memo: `Vehicle sale — #${stockNum} — gross ${gross.toFixed(2)}`,
    user, ip,
    ref: { type: "vehicle_sale", stockNum },
    lines: [
      { accountId: SYSTEM_ACCOUNTS.SAYARAH_BANK, debit: gross, credit: 0 },
      { accountId: SYSTEM_ACCOUNTS.COGS_VEHICLES, debit: cost, credit: 0 },
      { accountId: vehicleAccountId(stockNum), debit: 0, credit: cost },
      { accountId: SYSTEM_ACCOUNTS.REVENUE_VEHICLE_SALES, debit: 0, credit: gross },
    ],
  });

  // Entry 2: return principal to source + split the profit.
  const distributionLines = [
    // Principal (cost) returns to the source that funded it.
    { accountId: principalAccount, debit: cost, credit: 0 },
    { accountId: SYSTEM_ACCOUNTS.SAYARAH_BANK, debit: 0, credit: cost },
  ];
  if (taxSkim > 0) {
    distributionLines.push({ accountId: SYSTEM_ACCOUNTS.TAX, debit: 0, credit: taxSkim });
    distributionLines.push({ accountId: SYSTEM_ACCOUNTS.SAYARAH_BANK, debit: taxSkim, credit: 0 });
  }
  if (distributable !== 0) {
    // Distributable profit goes into the holding account until
    // month-end; members don't receive cash yet.
    distributionLines.push({
      accountId: SYSTEM_ACCOUNTS.PROFIT_DISTRIBUTION,
      debit: distributable < 0 ? -distributable : 0,
      credit: distributable > 0 ? distributable : 0,
    });
    distributionLines.push({
      accountId: SYSTEM_ACCOUNTS.SAYARAH_BANK,
      debit: distributable < 0 ? 0 : distributable,
      credit: distributable > 0 ? 0 : -distributable,
    });
  }
  const allocationEntry = buildJournalEntry({
    date,
    memo: `Sale allocation — #${stockNum} — principal back, $${taxSkim} tax, $${distributable.toFixed(2)} to distribution`,
    user, ip,
    ref: { type: "vehicle_sale_allocation", stockNum },
    lines: distributionLines,
  });

  return [saleEntry, allocationEntry];
}

// Month-end: split the Profit Distribution balance equally across
// all members and zero the account. Returns the single journal
// entry; posting it is the caller's responsibility.
export function distributeMonthEndEntry({ month, members, profitBalance, user, ip, date }) {
  const activeMembers = members || [];
  if (activeMembers.length === 0) return null;
  if (Math.abs(profitBalance) < 0.01) return null;
  const share = Math.floor((profitBalance / activeMembers.length) * 100) / 100; // penny-floor per member
  const lines = [
    { accountId: SYSTEM_ACCOUNTS.PROFIT_DISTRIBUTION, debit: profitBalance, credit: 0 },
  ];
  let allocated = 0;
  activeMembers.forEach((m, i) => {
    const amount = i === activeMembers.length - 1 ? profitBalance - allocated : share;
    lines.push({ accountId: memberAccountId(m.id), debit: 0, credit: amount });
    allocated += amount;
  });
  return buildJournalEntry({
    date: date || new Date().toISOString().slice(0, 10),
    memo: `Month-end distribution — ${month} — ${activeMembers.length} members`,
    user, ip,
    ref: { type: "distribution", month },
    lines,
  });
}

// Ledger filter helpers for UI views.
export const entriesForAccount = (ledger, accountId) =>
  (ledger || []).filter((e) => e.lines.some((l) => l.accountId === accountId));

export const entriesForRef = (ledger, predicate) =>
  (ledger || []).filter((e) => e.ref && predicate(e.ref));

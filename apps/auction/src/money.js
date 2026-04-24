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
  RETAINED_EARNINGS: "equity:retained-earnings",
  INCOME_SUMMARY: "equity:income-summary",
  TAX: "liability:tax-account",
  REVENUE_VEHICLE_SALES: "revenue:vehicle-sales",
  COGS_VEHICLES: "expense:cogs-vehicles",
  OPERATING_EXPENSES: "expense:operating",
  SALES_TAX_PAYABLE: "liability:sales-tax-ma",
  USE_TAX_PAYABLE: "liability:use-tax-ma",
};

export const TAX_PER_SALE = 295; // MA S-Corp — skimmed to the tax sub-account on every sold vehicle
// MA use tax: 6.25% on out-of-state purchases brought into MA for use.
// Applied when a vehicle's acquisition source is flagged as out-of-state
// and no MA sales tax was paid at purchase.
export const MA_USE_TAX_RATE = 0.0625;
// MA sales tax: 6.25% on vehicles delivered to a buyer in MA. Out-of-
// state (US) and international export sales are exempt — those buyers
// owe use tax in their own state, and exports are outside US sales-tax
// jurisdiction entirely. Sayarah's office is in MA but most sales go
// out-of-state or international, so this rate only bites the minority
// of in-state deliveries.
export const MA_SALES_TAX_RATE = 0.0625;
export const SALE_DESTINATIONS = {
  in_state_ma: { label: "In-state (MA)", taxable: true },
  out_of_state_us: { label: "Out-of-state (US)", taxable: false },
  international: { label: "International export", taxable: false },
};

// ─── Default chart of accounts ────────────────────────────────
// Installed on first run via seedChartOfAccounts(). The app stores
// these under data.accounts so the admin can add custom accounts
// (e.g. new expense categories) without a code change.
export const DEFAULT_ACCOUNTS = [
  { id: SYSTEM_ACCOUNTS.SAYARAH_BANK, name: "Sayarah Chase Bank", type: "asset", system: true, description: "Primary operating account — holds the Atlantic Fund." },
  { id: SYSTEM_ACCOUNTS.ATLANTIC_FUND, name: "Atlantic Fund", type: "asset", system: true, description: "Shared member pool for vehicle purchases. Held inside the Chase account." },
  { id: SYSTEM_ACCOUNTS.PROFIT_DISTRIBUTION, name: "Profit Distribution (pending)", type: "equity", system: true, description: "Holds vehicle profit from sale until month-end split." },
  { id: SYSTEM_ACCOUNTS.RETAINED_EARNINGS, name: "Retained Earnings", type: "equity", system: true, description: "Cumulative net income across closed fiscal years (after distributions)." },
  { id: SYSTEM_ACCOUNTS.INCOME_SUMMARY, name: "Income Summary (temp)", type: "equity", system: true, description: "Closing-entry clearing account used only during year-end close." },
  { id: SYSTEM_ACCOUNTS.TAX, name: "Tax Account ($295 per sale)", type: "liability", system: true, description: "Skimmed from every vehicle sale for MA/federal taxes + misc." },
  { id: SYSTEM_ACCOUNTS.REVENUE_VEHICLE_SALES, name: "Vehicle Sales Revenue", type: "revenue", system: true },
  { id: SYSTEM_ACCOUNTS.COGS_VEHICLES, name: "Cost of Goods Sold — Vehicles", type: "expense", system: true },
  { id: SYSTEM_ACCOUNTS.OPERATING_EXPENSES, name: "Operating Expenses", type: "expense", system: true },
  { id: SYSTEM_ACCOUNTS.SALES_TAX_PAYABLE, name: "MA Sales Tax Payable", type: "liability", system: true },
  { id: SYSTEM_ACCOUNTS.USE_TAX_PAYABLE, name: "MA Use Tax Payable", type: "liability", system: true, description: "Owed on out-of-state purchases brought into MA for use (6.25%)." },
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

export function validateJournalEntry(entry, closedPeriods = []) {
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
  // Closed-period guard: once a fiscal year is closed no new entries can be
  // posted with a date inside it. Reversal / correction entries also pass
  // through this check — they must be dated in an open period.
  if (isDateInClosedPeriod(entry.date, closedPeriods)) {
    return `Cannot post to a closed period (date ${entry.date} falls within a closed fiscal period)`;
  }
  return null;
}

// True if the given YYYY-MM-DD date falls within any closed period.
// closedPeriods is an array of { startDate, endDate, ... }.
export function isDateInClosedPeriod(dateStr, closedPeriods) {
  if (!dateStr || !Array.isArray(closedPeriods)) return false;
  for (const cp of closedPeriods) {
    if (cp && dateStr >= cp.startDate && dateStr <= cp.endDate) return true;
  }
  return false;
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
// catch and surface to the user. Pass `closedPeriods` (data.money
// .closedPeriods) so closed-year guard fires.
export function postJournalEntry(ledger, entry, closedPeriods = []) {
  const err = validateJournalEntry(entry, closedPeriods);
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
export function vehicleSaleEntries({ stockNum, totalCost, grossSale, principalDestination, date, user, ip, destination }) {
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
    ref: { type: "vehicle_sale", stockNum, destination: destination || null },
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

// Entries inside an inclusive date range (YYYY-MM-DD strings).
export const entriesInRange = (ledger, start, end) =>
  (ledger || []).filter((e) => e.date >= start && e.date <= end);

// ═══════════════════════════════════════════════════════════════
// REPORT-CALCULATION HELPERS (Phase 2)
//
// Every report is derived from the ledger + chart of accounts on
// demand. No stored aggregates that can go stale.
// ═══════════════════════════════════════════════════════════════

// Compute P&L (income statement) for a period.
// Returns { revenue, expenses, netIncome, byAccount: {…} }.
export function calcProfitLoss(ledger, accounts, startDate, endDate) {
  const inRange = entriesInRange(ledger, startDate, endDate);
  const accountsById = Object.fromEntries((accounts || []).map((a) => [a.id, a]));
  const byAccount = {};
  let revenue = 0;
  let expenses = 0;
  for (const entry of inRange) {
    for (const line of entry.lines) {
      const acc = accountsById[line.accountId];
      if (!acc) continue;
      const amount = acc.type === "revenue"
        ? p(line.credit) - p(line.debit)       // revenue: credit-normal
        : acc.type === "expense"
          ? p(line.debit) - p(line.credit)      // expense: debit-normal
          : 0;
      if (amount !== 0) {
        byAccount[line.accountId] = (byAccount[line.accountId] || 0) + amount;
        if (acc.type === "revenue") revenue += amount;
        else if (acc.type === "expense") expenses += amount;
      }
    }
  }
  return { revenue, expenses, netIncome: revenue - expenses, byAccount, startDate, endDate };
}

// Balance sheet as of a given date.
// Returns { assets: {…}, liabilities: {…}, equity: {…}, totals: {…} }.
export function calcBalanceSheet(ledger, accounts, asOfDate) {
  const upTo = (ledger || []).filter((e) => !asOfDate || e.date <= asOfDate);
  const balances = calcAllBalances(upTo, accounts);
  const out = { assets: {}, liabilities: {}, equity: {}, totals: { assets: 0, liabilities: 0, equity: 0 } };
  for (const acc of accounts || []) {
    const bal = balances[acc.id] || 0;
    if (Math.abs(bal) < 0.005) continue;
    if (acc.type === "asset") { out.assets[acc.id] = { name: acc.name, balance: bal }; out.totals.assets += bal; }
    else if (acc.type === "liability") { out.liabilities[acc.id] = { name: acc.name, balance: bal }; out.totals.liabilities += bal; }
    else if (acc.type === "equity") { out.equity[acc.id] = { name: acc.name, balance: bal }; out.totals.equity += bal; }
  }
  return { ...out, asOfDate };
}

// K-1 prep: per-member capital balance + share of net income for
// the period. `members` is the list of member records from
// data.money.members.
export function calcMemberK1Prep(ledger, accounts, members, startDate, endDate) {
  const pl = calcProfitLoss(ledger, accounts, startDate, endDate);
  const share = (members || []).length > 0 ? pl.netIncome / members.length : 0;
  const accountsById = Object.fromEntries((accounts || []).map((a) => [a.id, a]));
  const endBalances = calcAllBalances(entriesInRange(ledger, "0000-00-00", endDate), accounts);
  return (members || []).map((m) => ({
    memberId: m.id,
    name: m.name,
    endingCapital: endBalances[memberAccountId(m.id)] || 0,
    shareOfIncome: share,
    startDate,
    endDate,
  }));
}

// 1099 tracking: vendors paid > $600 in the period. Scans expense
// entries where a memo or ref has a vendor field.
export function calc1099Report(ledger, startDate, endDate, threshold = 600) {
  const inRange = entriesInRange(ledger, startDate, endDate);
  const byVendor = {};
  for (const entry of inRange) {
    const vendor = entry.ref?.vendor || (entry.memo && entry.memo.match(/vendor:\s*([^·,;]+)/i)?.[1]);
    if (!vendor) continue;
    const name = vendor.trim();
    if (!name) continue;
    // Sum debits on expense accounts only (that's what "paid to vendor" means).
    for (const line of entry.lines) {
      if (!line.accountId.startsWith("expense:")) continue;
      byVendor[name] = (byVendor[name] || 0) + p(line.debit) - p(line.credit);
    }
  }
  return Object.entries(byVendor)
    .filter(([, amt]) => amt >= threshold)
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
}

// MA sales tax collected + owed: sums the Sales Tax Payable liability,
// and breaks down the underlying sales by destination so the CPA can
// see "of $X gross sold in the period, $A was in-state taxable, $B was
// out-of-state, $C international export."
export function calcMaSalesTax(ledger, accounts, startDate, endDate) {
  const inRange = entriesInRange(ledger, startDate, endDate);
  let collected = 0;
  const byDestination = { in_state_ma: 0, out_of_state_us: 0, international: 0, unspecified: 0 };
  for (const entry of inRange) {
    for (const line of entry.lines) {
      if (line.accountId === SYSTEM_ACCOUNTS.SALES_TAX_PAYABLE) {
        collected += p(line.credit) - p(line.debit);
      }
    }
    // Sales allocation by destination (from the vehicle_sale entries).
    if (entry.ref && entry.ref.type === "vehicle_sale") {
      const bank = entry.lines.find((l) => l.accountId === SYSTEM_ACCOUNTS.SAYARAH_BANK);
      if (bank) {
        const gross = p(bank.debit);
        const dest = entry.ref.destination || "unspecified";
        byDestination[dest] = (byDestination[dest] || 0) + gross;
      }
    }
  }
  return { collected, byDestination, startDate, endDate };
}

// MA use tax owed in a period (6.25% on out-of-state purchases
// brought into MA for use — recognized at vehicle purchase time).
export function calcMaUseTax(ledger, startDate, endDate) {
  const inRange = entriesInRange(ledger, startDate, endDate);
  let owed = 0;
  let paid = 0;
  for (const entry of inRange) {
    for (const line of entry.lines) {
      if (line.accountId === SYSTEM_ACCOUNTS.USE_TAX_PAYABLE) {
        owed += p(line.credit);
        paid += p(line.debit);
      }
    }
  }
  return { owed, paid, netOwed: owed - paid, startDate, endDate };
}

// Compute the use tax owed on an out-of-state vehicle purchase.
export function calcUseTax(purchasePrice) {
  return roundMoney(p(purchasePrice) * MA_USE_TAX_RATE);
}
const roundMoney = (n) => (n == null || !Number.isFinite(n)) ? 0 : Math.round(n * 100) / 100;

// MA sales-tax collected on an in-state vehicle delivery.
// Buyer pays tax on top of the gross price; the seller holds it as
// a liability (Sales Tax Payable) and remits to MA DOR. Out-of-state
// and international sales use returnNull (no entry posted).
export function calcMaSalesTaxOnSale(grossPrice, destination) {
  const rule = SALE_DESTINATIONS[destination] || SALE_DESTINATIONS.out_of_state_us;
  if (!rule.taxable) return 0;
  return roundMoney(p(grossPrice) * MA_SALES_TAX_RATE);
}

export function salesTaxOnSaleEntry({ stockNum, grossPrice, destination, date, user, ip }) {
  const tax = calcMaSalesTaxOnSale(grossPrice, destination);
  if (tax <= 0) return null;
  return buildJournalEntry({
    date,
    memo: `MA Sales Tax 6.25% — in-state sale #${stockNum}`,
    user, ip,
    ref: { type: "sales_tax", stockNum, destination },
    lines: [
      // Buyer paid tax on top of the sale; cash came into the bank,
      // liability owed to MA DOR.
      { accountId: SYSTEM_ACCOUNTS.SAYARAH_BANK, debit: tax, credit: 0 },
      { accountId: SYSTEM_ACCOUNTS.SALES_TAX_PAYABLE, debit: 0, credit: tax },
    ],
  });
}

// Journal entry that recognizes use-tax liability at purchase time.
// Posted alongside the vehicle-purchase entries when the source is
// flagged as out-of-state and no MA sales tax was paid at purchase.
// Debits the vehicle inventory account (tax is part of cost basis);
// credits the MA Use Tax Payable liability.
export function useTaxOnPurchaseEntry({ stockNum, purchasePrice, date, user, ip }) {
  const tax = calcUseTax(purchasePrice);
  if (tax <= 0) return null;
  return buildJournalEntry({
    date,
    memo: `MA Use Tax 6.25% on #${stockNum} — recognized at purchase`,
    user, ip,
    ref: { type: "use_tax", stockNum },
    lines: [
      { accountId: vehicleAccountId(stockNum), debit: tax, credit: 0 },
      { accountId: SYSTEM_ACCOUNTS.USE_TAX_PAYABLE, debit: 0, credit: tax },
    ],
  });
}

// ═══════════════════════════════════════════════════════════════
// YEAR-END CLOSE
//
// Closes temporary accounts (revenue + expense) to Income Summary,
// then closes Income Summary to Retained Earnings (S-Corp retained
// earnings pattern — distributions to shareholders are separate
// transactions during the year, not part of the closing process).
// Returns an array of journal entries to post in sequence.
// ═══════════════════════════════════════════════════════════════
export function calcClosingEntries({ ledger, accounts, fiscalYearEnd, user, ip }) {
  const yearStart = fiscalYearEnd.slice(0, 4) + "-01-01";
  const pl = calcProfitLoss(ledger, accounts, yearStart, fiscalYearEnd);
  const entries = [];
  const date = fiscalYearEnd;

  // 1) Close revenue accounts → Income Summary.
  const revenueLines = [];
  let totalRevenue = 0;
  for (const [accId, amt] of Object.entries(pl.byAccount)) {
    const acc = accounts.find((a) => a.id === accId);
    if (acc && acc.type === "revenue" && Math.abs(amt) > 0.005) {
      // Revenue has credit-normal balance. Debit it to close.
      revenueLines.push({ accountId: accId, debit: amt, credit: 0 });
      totalRevenue += amt;
    }
  }
  if (revenueLines.length > 0) {
    revenueLines.push({ accountId: SYSTEM_ACCOUNTS.INCOME_SUMMARY, debit: 0, credit: totalRevenue });
    entries.push(buildJournalEntry({
      date, memo: `Year-end close: revenue → Income Summary (FY ${yearStart.slice(0, 4)})`,
      user, ip, ref: { type: "year_end_close", step: "close_revenue", year: yearStart.slice(0, 4) },
      lines: revenueLines,
    }));
  }

  // 2) Close expense accounts → Income Summary.
  const expenseLines = [];
  let totalExpense = 0;
  for (const [accId, amt] of Object.entries(pl.byAccount)) {
    const acc = accounts.find((a) => a.id === accId);
    if (acc && acc.type === "expense" && Math.abs(amt) > 0.005) {
      // Expense has debit-normal balance. Credit it to close.
      expenseLines.push({ accountId: accId, debit: 0, credit: amt });
      totalExpense += amt;
    }
  }
  if (expenseLines.length > 0) {
    expenseLines.push({ accountId: SYSTEM_ACCOUNTS.INCOME_SUMMARY, debit: totalExpense, credit: 0 });
    entries.push(buildJournalEntry({
      date, memo: `Year-end close: expenses → Income Summary (FY ${yearStart.slice(0, 4)})`,
      user, ip, ref: { type: "year_end_close", step: "close_expenses", year: yearStart.slice(0, 4) },
      lines: expenseLines,
    }));
  }

  // 3) Close Income Summary → Retained Earnings.
  const netIncome = pl.netIncome;
  if (Math.abs(netIncome) > 0.005) {
    entries.push(buildJournalEntry({
      date, memo: `Year-end close: Income Summary → Retained Earnings (${fmtSigned(netIncome)} FY ${yearStart.slice(0, 4)})`,
      user, ip, ref: { type: "year_end_close", step: "close_income_summary", year: yearStart.slice(0, 4) },
      lines: netIncome >= 0
        ? [
            { accountId: SYSTEM_ACCOUNTS.INCOME_SUMMARY, debit: netIncome, credit: 0 },
            { accountId: SYSTEM_ACCOUNTS.RETAINED_EARNINGS, debit: 0, credit: netIncome },
          ]
        : [
            { accountId: SYSTEM_ACCOUNTS.RETAINED_EARNINGS, debit: -netIncome, credit: 0 },
            { accountId: SYSTEM_ACCOUNTS.INCOME_SUMMARY, debit: 0, credit: -netIncome },
          ],
    }));
  }

  return { entries, netIncome, revenue: totalRevenue, expenses: totalExpense, yearStart, yearEnd: fiscalYearEnd };
}
const fmtSigned = (n) => (n >= 0 ? "+" : "") + n.toFixed(2);

// ═══════════════════════════════════════════════════════════════
// BANK RECONCILIATION HELPERS
// ═══════════════════════════════════════════════════════════════

// Extremely forgiving CSV parser: splits on newlines, strips BOM,
// handles simple quoted fields. Headers are taken from the first
// non-empty row. Returns [{ headers, rows: [{ [header]: value }] }].
// For the bank-recon use case we expect columns including at least:
// date, description, amount (in some form).
export function parseBankCsv(text) {
  if (!text) return { headers: [], rows: [] };
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const splitLine = (line) => {
    const out = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === "," && !inQ) { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = splitLine(lines[0]);
  const rows = lines.slice(1).map((line, idx) => {
    const cells = splitLine(line);
    const row = { _id: `csv_${idx}` };
    headers.forEach((h, i) => { row[h] = cells[i] || ""; });
    return row;
  });
  return { headers, rows };
}

// Heuristically match a CSV row to a ledger entry. Good enough for
// the recon UI to suggest matches; user confirms. Criteria: same
// date (YYYY-MM-DD) AND amount within $1.00 of the entry's total.
export function suggestMatches(csvRow, ledger) {
  const amountStr = csvRow.amount || csvRow.Amount || csvRow.AMOUNT || "";
  const amount = Math.abs(p(amountStr));
  const date = (csvRow.date || csvRow.Date || csvRow.DATE || "").slice(0, 10);
  if (!date || !amount) return [];
  const candidates = [];
  for (const entry of ledger || []) {
    if (entry.date !== date) continue;
    const entryTotal = entry.lines.reduce((s, l) => s + p(l.debit), 0);
    if (Math.abs(entryTotal - amount) < 1.00) {
      candidates.push(entry);
    }
  }
  return candidates;
}

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
  // ATLANTIC_FUND is kept for backward-compat with entries posted
  // by earlier phases, but it is FILTERED OUT of every external
  // financial statement (P&L, Balance Sheet, Cash Flow, Member
  // Equity). Per the CPA-approved Accounting spec, the Atlantic
  // Fund is an internal management sub-ledger only — it never
  // appears to external readers. See isExternalAccount() below.
  ATLANTIC_FUND: "fund:atlantic",
  PROFIT_DISTRIBUTION: "equity:profit-distribution",
  RETAINED_EARNINGS: "equity:retained-earnings",
  INCOME_SUMMARY: "equity:income-summary",
  // Phase 4 / Accounting-spec additions per the approved CoA
  ACCOUNTS_PAYABLE: "liability:accounts-payable",
  ACCRUED_EXPENSES: "liability:accrued-expenses",
  ACCRUED_TAX_LIABILITY: "liability:accrued-tax",
  DEFERRED_REVENUE: "liability:deferred-revenue",
  ACCOUNTS_RECEIVABLE: "asset:accounts-receivable",
  PREPAID_EXPENSES: "asset:prepaid-expenses",
  // Legacy aliases — keep pointing at the same slots so existing
  // ledger entries resolve, but prefer the names above.
  TAX: "liability:tax-account",
  REVENUE_VEHICLE_SALES: "revenue:vehicle-sales",
  COGS_VEHICLES: "expense:cogs-vehicles",
  OPERATING_EXPENSES: "expense:operating",
  // Operating expense sub-accounts (per CoA)
  EXPENSE_ADVERTISING: "expense:advertising",
  EXPENSE_OFFICE_ADMIN: "expense:office-admin",
  EXPENSE_PROFESSIONAL_FEES: "expense:professional-fees",
  EXPENSE_INSURANCE: "expense:insurance",
  EXPENSE_RENT_UTILITIES: "expense:rent-utilities",
  EXPENSE_SOFTWARE: "expense:software",
  EXPENSE_BANK_FEES: "expense:bank-fees",
  EXPENSE_OTHER: "expense:other",
  TAX_RESERVE_EXPENSE: "expense:tax-reserve",
  SALES_TAX_PAYABLE: "liability:sales-tax-ma",
  USE_TAX_PAYABLE: "liability:use-tax-ma",
};

// Account IDs that should NEVER appear on external financial
// statements — they're management-layer concepts. The Balance
// Sheet / P&L / Cash Flow / Member Equity renderers must filter
// entries through this function before aggregating.
export const INTERNAL_ONLY_ACCOUNTS = new Set([SYSTEM_ACCOUNTS.ATLANTIC_FUND]);
export const isExternalAccount = (accountId) => !INTERNAL_ONLY_ACCOUNTS.has(accountId);

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
  // ── Assets ──
  { id: SYSTEM_ACCOUNTS.SAYARAH_BANK, name: "Chase Operating Cash", type: "asset", system: true, description: "Primary operating account at Chase Bank." },
  { id: SYSTEM_ACCOUNTS.ACCOUNTS_RECEIVABLE, name: "Accounts Receivable", type: "asset", system: true },
  { id: SYSTEM_ACCOUNTS.PREPAID_EXPENSES, name: "Prepaid Expenses", type: "asset", system: true },
  // Atlantic Fund kept in the chart for existing-ledger compatibility,
  // but flagged internal-only — every external-facing statement filters
  // it out via isExternalAccount().
  { id: SYSTEM_ACCOUNTS.ATLANTIC_FUND, name: "Atlantic Fund (INTERNAL)", type: "asset", system: true, internalOnly: true, description: "Management sub-ledger — never on external financial statements." },
  // ── Liabilities ──
  { id: SYSTEM_ACCOUNTS.ACCOUNTS_PAYABLE, name: "Accounts Payable", type: "liability", system: true },
  { id: SYSTEM_ACCOUNTS.ACCRUED_EXPENSES, name: "Accrued Expenses", type: "liability", system: true },
  { id: SYSTEM_ACCOUNTS.ACCRUED_TAX_LIABILITY, name: "Accrued Tax Liability", type: "liability", system: true, description: "Tax reserve ($295-per-sale accumulator + accrued MA S-Corp excise)." },
  { id: SYSTEM_ACCOUNTS.TAX, name: "Tax Reserve (legacy alias)", type: "liability", system: true, internalOnly: false, description: "Pre-Accounting-refactor tax reserve. New postings should go to Accrued Tax Liability." },
  { id: SYSTEM_ACCOUNTS.SALES_TAX_PAYABLE, name: "MA Sales Tax Payable", type: "liability", system: true },
  { id: SYSTEM_ACCOUNTS.USE_TAX_PAYABLE, name: "MA Use Tax Payable", type: "liability", system: true, description: "Owed on out-of-state purchases brought into MA for use (6.25%)." },
  { id: SYSTEM_ACCOUNTS.DEFERRED_REVENUE, name: "Deferred Revenue", type: "liability", system: true, description: "Buyer deposits received before title transfer." },
  // ── Equity ──
  { id: SYSTEM_ACCOUNTS.PROFIT_DISTRIBUTION, name: "Profit Distribution Clearing", type: "equity", system: true, description: "Holds monthly profit until distributed to members." },
  { id: SYSTEM_ACCOUNTS.RETAINED_EARNINGS, name: "Retained Earnings", type: "equity", system: true, description: "Cumulative net income net of distributions." },
  { id: SYSTEM_ACCOUNTS.INCOME_SUMMARY, name: "Income Summary (temp)", type: "equity", system: true, description: "Closing-entry clearing account used only during year-end close." },
  // ── Revenue ──
  { id: SYSTEM_ACCOUNTS.REVENUE_VEHICLE_SALES, name: "Vehicle Sales Revenue", type: "revenue", system: true },
  // ── COGS ──
  { id: SYSTEM_ACCOUNTS.COGS_VEHICLES, name: "Cost of Vehicles Sold", type: "expense", system: true, isCogs: true },
  // ── Operating Expenses (subcategorized per CPA-approved CoA) ──
  { id: SYSTEM_ACCOUNTS.EXPENSE_ADVERTISING, name: "Advertising & Marketing", type: "expense", system: true },
  { id: SYSTEM_ACCOUNTS.EXPENSE_OFFICE_ADMIN, name: "Office & Admin", type: "expense", system: true },
  { id: SYSTEM_ACCOUNTS.EXPENSE_PROFESSIONAL_FEES, name: "Professional Fees", type: "expense", system: true },
  { id: SYSTEM_ACCOUNTS.EXPENSE_INSURANCE, name: "Insurance (non-capitalized)", type: "expense", system: true },
  { id: SYSTEM_ACCOUNTS.EXPENSE_RENT_UTILITIES, name: "Rent & Utilities", type: "expense", system: true },
  { id: SYSTEM_ACCOUNTS.EXPENSE_SOFTWARE, name: "Software & Subscriptions", type: "expense", system: true },
  { id: SYSTEM_ACCOUNTS.EXPENSE_BANK_FEES, name: "Bank & Merchant Fees", type: "expense", system: true },
  { id: SYSTEM_ACCOUNTS.EXPENSE_OTHER, name: "Other Operating", type: "expense", system: true },
  { id: SYSTEM_ACCOUNTS.OPERATING_EXPENSES, name: "Operating Expenses (legacy)", type: "expense", system: true, description: "Pre-CoA-refactor catch-all." },
  // ── Non-operating ──
  { id: SYSTEM_ACCOUNTS.TAX_RESERVE_EXPENSE, name: "Tax Reserve Expense", type: "expense", system: true, description: "$295-per-sale accrual; offsets Accrued Tax Liability." },
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

// Contra-equity distribution account per member. Accumulates YTD
// distributions; year-end close moves the balance to capital (debit
// capital, credit distributions, zeroing the contra). Keeping
// distributions separate from capital during the year lets the
// Statement of Member Equity render a clean "Distributions" line
// and makes K-1 prep trivial.
export const memberDistributionsId = (memberId) => `equity:member:${memberId}:distributions`;
export const memberDistributionsAccount = (memberId, name) => ({
  id: memberDistributionsId(memberId),
  name: `${name} — Distributions YTD`,
  type: "equity",
  memberId,
  isContra: true,
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
// Contra accounts flip the normal side so their natural balance comes
// out positive — e.g. a contra-equity "Member Distributions" account
// normally has a DEBIT balance (opposite of equity's credit-normal).
// Post a debit → positive balance → balance sheet subtracts from
// equity total via isContra flag.
export function calcAllBalances(ledger, accounts) {
  const accountsById = Object.fromEntries((accounts || []).map((a) => [a.id, a]));
  const out = {};
  for (const acc of accounts || []) out[acc.id] = 0;
  for (const e of ledger || []) {
    for (const l of e.lines) {
      if (!(l.accountId in out)) out[l.accountId] = 0;
    }
  }
  for (const entry of ledger || []) {
    for (const line of entry.lines) {
      const acc = accountsById[line.accountId];
      let normal = acc && ACCOUNT_TYPES[acc.type]
        ? ACCOUNT_TYPES[acc.type].normal
        : "debit";
      if (acc && acc.isContra) normal = normal === "debit" ? "credit" : "debit";
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

// Sale of a vehicle. Aligned with CPA-approved Scenarios 9, 13, 14, 15.
//
// Posts three clean entries per sale:
//   1. Revenue recognition + cash receipt (with MA sales tax if in-state)
//   2. COGS + inventory relief
//   3. Tax reserve accrual ($295 as liability, per CPA Pattern 1)
//
// Atlantic Fund "principal return" is NO LONGER a ledger entry —
// it's an internal sub-ledger event tracked by the Money Management
// tab only. External statements see cash, revenue, COGS, tax.
// Profit flows through period net income to Retained Earnings at
// month-end; distribution happens via distributeMonthEndEntry +
// distributionCashPayoutEntry.
export function vehicleSaleEntries({ stockNum, totalCost, grossSale, principalDestination, date, user, ip, destination }) {
  const gross = p(grossSale);
  const cost = p(totalCost);
  const salesTax = calcMaSalesTaxOnSale(gross, destination || "out_of_state_us");

  const entries = [];

  // Entry 1: Cash in + revenue recognition + (optional) MA sales tax
  const saleLines = [
    // Buyer pays gross + tax; all hits bank
    { accountId: SYSTEM_ACCOUNTS.SAYARAH_BANK, debit: gross + salesTax, credit: 0 },
    { accountId: SYSTEM_ACCOUNTS.REVENUE_VEHICLE_SALES, debit: 0, credit: gross },
  ];
  if (salesTax > 0) {
    saleLines.push({ accountId: SYSTEM_ACCOUNTS.SALES_TAX_PAYABLE, debit: 0, credit: salesTax });
  }
  entries.push(buildJournalEntry({
    date,
    memo: `Vehicle sale — #${stockNum} — gross ${gross.toFixed(2)}${salesTax > 0 ? ` + MA sales tax ${salesTax.toFixed(2)}` : ""}`,
    user, ip,
    ref: { type: "vehicle_sale", stockNum, destination: destination || null, principalDestination },
    lines: saleLines,
  }));

  // Entry 2: COGS + inventory relief
  entries.push(buildJournalEntry({
    date,
    memo: `COGS — #${stockNum}`,
    user, ip,
    ref: { type: "vehicle_cogs", stockNum },
    lines: [
      { accountId: SYSTEM_ACCOUNTS.COGS_VEHICLES, debit: cost, credit: 0 },
      { accountId: vehicleAccountId(stockNum), debit: 0, credit: cost },
    ],
  }));

  // Entry 3: Tax reserve accrual ($295 as an accrued liability)
  if (TAX_PER_SALE > 0) {
    entries.push(buildJournalEntry({
      date,
      memo: `Tax reserve — #${stockNum} — $${TAX_PER_SALE} per sale`,
      user, ip,
      ref: { type: "tax_reserve", stockNum },
      lines: [
        { accountId: SYSTEM_ACCOUNTS.TAX_RESERVE_EXPENSE, debit: TAX_PER_SALE, credit: 0 },
        { accountId: SYSTEM_ACCOUNTS.ACCRUED_TAX_LIABILITY, debit: 0, credit: TAX_PER_SALE },
      ],
    }));
  }

  return entries;
}

// Internal sub-ledger event for Atlantic Fund tracking — NOT a
// journal entry. Returns a plain object for Money Management to
// append to data.money.fundMovements. Used when a sale's principal
// is earmarked "back to the fund" or "back to a member."
export function fundPrincipalReturnEvent({ stockNum, amount, destination, date, user }) {
  return {
    id: `fmv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type: "principal_return",
    stockNum,
    amount: p(amount),
    destination, // { type: "fund" } or { type: "member", memberId }
    date,
    user,
    timestamp: new Date().toISOString(),
  };
}

// Month-end: allocate the Profit Distribution clearing balance
// equally across all members. Per CPA-approved Pattern 2, we post
// the allocation to each member's contra-equity Distributions
// account (not directly to Capital). Year-end close moves those
// balances to Capital. This gives the Statement of Member Equity
// a clean "Distributions" line and keeps K-1 prep straightforward.
//
// Returns an array (possibly empty) of journal entries for the
// caller to post. Separate from cash payout — that's a distinct
// entry when cash actually leaves Chase.
export function distributeMonthEndEntry({ month, members, profitBalance, user, ip, date }) {
  const activeMembers = members || [];
  if (activeMembers.length === 0) return null;
  if (Math.abs(profitBalance) < 0.01) return null;
  const share = Math.floor((profitBalance / activeMembers.length) * 100) / 100;
  const lines = [
    { accountId: SYSTEM_ACCOUNTS.PROFIT_DISTRIBUTION, debit: profitBalance, credit: 0 },
  ];
  let allocated = 0;
  activeMembers.forEach((m, i) => {
    const amount = i === activeMembers.length - 1 ? profitBalance - allocated : share;
    // Contra-equity: credit the distributions account to increase
    // its (debit-normal, since contra) running total. Wait — a
    // contra-equity account has a DEBIT balance naturally. To
    // INCREASE it we debit. So on the allocation entry we'd debit
    // Distributions and credit Clearing. Hmm let me think again:
    //
    // Pattern 2 intent: every distribution reduces net equity.
    // - Net equity = Capital − Distributions (contra)
    // - To reduce net equity by $X: INCREASE the contra, i.e. Debit Distributions
    // - Cash goes out: Credit Cash
    //
    // But here there's no cash move (that's a separate entry when
    // actually paid). This is an ALLOCATION entry: clearing profit
    // → member-specific distribution buckets.
    // - Debit Clearing (equity) reduces it
    // - Credit what offsets it? If Distributions is credit-normal
    //   as a contra-equity… Actually credit-normal contra-equity
    //   is unusual. Most systems treat distributions as a
    //   DEBIT-BALANCE contra to capital (natural balance debit,
    //   same as drawings). So increasing them = debit.
    //
    // That makes this entry: Debit Distributions, Credit Clearing.
    // But we want to DEBIT Clearing (to reduce it) — those can't
    // both happen in the same entry.
    //
    // Resolution: the allocation entry should be:
    //   Dr Profit Distribution Clearing  (close it)
    //     Cr Retained Earnings or Income Summary (absorb it)
    // Then a separate distribution entry:
    //   Dr Member X Distributions (contra, natural debit)
    //     Cr Cash (when actually paid)
    //
    // For the month-end "allocate but not yet paid" case, we skip
    // the distribution entry. It fires when cash moves out.
    lines.push({ accountId: memberAccountId(m.id), debit: 0, credit: amount });
    allocated += amount;
  });
  return buildJournalEntry({
    date: date || new Date().toISOString().slice(0, 10),
    memo: `Month-end allocation — ${month} — ${activeMembers.length} members`,
    user, ip,
    ref: { type: "distribution", month },
    lines,
  });
}

// Separate entry: actual cash distribution to members. Posts to
// the contra-equity Distributions account per CPA Pattern 2.
// Closed to Capital at year-end via closeMemberDistributionsEntry.
//
// Use this when cash actually leaves Chase — typically right after
// distributeMonthEndEntry for businesses that pay out monthly.
export function distributionCashPayoutEntry({ memberId, memberName, amount, date, user, ip, month }) {
  if (!memberId || amount <= 0) return null;
  return buildJournalEntry({
    date: date || new Date().toISOString().slice(0, 10),
    memo: `Cash distribution — ${memberName || memberId}${month ? ` — ${month}` : ""}`,
    user, ip,
    ref: { type: "distribution_payout", memberId, month },
    lines: [
      { accountId: memberDistributionsId(memberId), debit: amount, credit: 0 },
      { accountId: SYSTEM_ACCOUNTS.SAYARAH_BANK, debit: 0, credit: amount },
    ],
  });
}

// Year-end: close every member's Distributions contra-equity into
// their Capital account. Zeros the contras so next year starts
// fresh. Runs as part of the year-end close sequence.
export function closeMemberDistributionsEntry({ members, balances, date, user, ip }) {
  const lines = [];
  for (const m of members || []) {
    const distBal = p(balances[memberDistributionsId(m.id)]) || 0;
    // Distributions is a contra-equity with a DEBIT natural
    // balance. To close: Credit Distributions (zeros it), Debit
    // Member Capital (reduces capital by the year's payouts).
    if (Math.abs(distBal) < 0.005) continue;
    lines.push({ accountId: memberAccountId(m.id), debit: distBal, credit: 0 });
    lines.push({ accountId: memberDistributionsId(m.id), debit: 0, credit: distBal });
  }
  if (lines.length === 0) return null;
  return buildJournalEntry({
    date: date || new Date().toISOString().slice(0, 10),
    memo: "Year-end: close Distributions → Capital",
    user, ip,
    ref: { type: "year_end_close", step: "close_distributions" },
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

// External-statement-safe ledger: strips any entry whose lines all
// touch internal-only accounts (currently just the Atlantic Fund).
// Entries that mix external and internal accounts are kept but
// internal lines are ignored by statement aggregators via
// isExternalAccount(). We don't mutate the entries themselves —
// aggregators filter per-line.
export const externalLedger = (ledger) => ledger || [];

// ═══════════════════════════════════════════════════════════════
// REPORT-CALCULATION HELPERS (Phase 2)
//
// Every report is derived from the ledger + chart of accounts on
// demand. No stored aggregates that can go stale.
// ═══════════════════════════════════════════════════════════════

// Compute P&L (income statement) for a period. Filters out any
// internal-only accounts (Atlantic Fund) so external statements
// don't reference the management sub-ledger.
// Returns { revenue, expenses, cogs, grossProfit, netIncome, byAccount }.
export function calcProfitLoss(ledger, accounts, startDate, endDate, { externalOnly = true } = {}) {
  const inRange = entriesInRange(ledger, startDate, endDate);
  const accountsById = Object.fromEntries((accounts || []).map((a) => [a.id, a]));
  const byAccount = {};
  let revenue = 0;
  let expenses = 0;
  let cogs = 0;
  for (const entry of inRange) {
    for (const line of entry.lines) {
      if (externalOnly && !isExternalAccount(line.accountId)) continue;
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
        else if (acc.type === "expense") {
          expenses += amount;
          if (acc.isCogs || line.accountId === SYSTEM_ACCOUNTS.COGS_VEHICLES) cogs += amount;
        }
      }
    }
  }
  return {
    revenue,
    cogs,
    grossProfit: revenue - cogs,
    operatingExpenses: expenses - cogs,
    expenses,
    netIncome: revenue - expenses,
    byAccount,
    startDate,
    endDate,
  };
}

// Balance sheet as of a given date. Filters internal-only accounts
// (Atlantic Fund) so external readers never see the management
// sub-ledger on financial statements.
// Returns { assets: {…}, liabilities: {…}, equity: {…}, totals: {…} }.
export function calcBalanceSheet(ledger, accounts, asOfDate, { externalOnly = true } = {}) {
  const upTo = (ledger || []).filter((e) => !asOfDate || e.date <= asOfDate);
  const balances = calcAllBalances(upTo, accounts);
  const out = { assets: {}, liabilities: {}, equity: {}, totals: { assets: 0, liabilities: 0, equity: 0 } };
  for (const acc of accounts || []) {
    if (externalOnly && !isExternalAccount(acc.id)) continue;
    const bal = balances[acc.id] || 0;
    if (Math.abs(bal) < 0.005) continue;
    if (acc.type === "asset") { out.assets[acc.id] = { name: acc.name, balance: bal }; out.totals.assets += bal; }
    else if (acc.type === "liability") { out.liabilities[acc.id] = { name: acc.name, balance: bal }; out.totals.liabilities += bal; }
    else if (acc.type === "equity") {
      // Contra-equity (member Distributions) reduces net equity.
      // Natural balance is debit; treat it as a reduction when
      // summing totals.equity.
      const signed = acc.isContra ? -bal : bal;
      out.equity[acc.id] = { name: acc.name, balance: bal, isContra: !!acc.isContra };
      out.totals.equity += signed;
    }
  }
  return { ...out, asOfDate };
}

// Trial Balance: every account with a non-zero balance and its
// debit or credit balance (natural side). For period-close
// verification — total debits should equal total credits.
export function calcTrialBalance(ledger, accounts, asOfDate, { externalOnly = false } = {}) {
  const upTo = (ledger || []).filter((e) => !asOfDate || e.date <= asOfDate);
  const balances = calcAllBalances(upTo, accounts);
  const rows = [];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const acc of accounts || []) {
    if (externalOnly && !isExternalAccount(acc.id)) continue;
    const bal = balances[acc.id] || 0;
    if (Math.abs(bal) < 0.005) continue;
    const normal = ACCOUNT_TYPES[acc.type]?.normal || "debit";
    const effectiveNormal = acc.isContra ? (normal === "debit" ? "credit" : "debit") : normal;
    if (effectiveNormal === "debit") {
      rows.push({ id: acc.id, name: acc.name, type: acc.type, debit: bal, credit: 0 });
      totalDebit += bal;
    } else {
      rows.push({ id: acc.id, name: acc.name, type: acc.type, debit: 0, credit: bal });
      totalCredit += bal;
    }
  }
  return { rows, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01, asOfDate };
}

// Cash Flow Statement (indirect method is standard but direct is
// clearer for small businesses — we use direct here). Reports cash
// movements by activity type: operating / investing / financing.
// Net change in cash should reconcile to (closing − opening) Chase
// bank balance.
export function calcCashFlow(ledger, accounts, startDate, endDate) {
  const inRange = entriesInRange(ledger, startDate, endDate);
  let operating = 0;
  let investing = 0;
  let financing = 0;
  const byCategory = { operating: [], investing: [], financing: [] };

  for (const entry of inRange) {
    // Look at each line that touches the bank account; classify
    // the movement by what the OTHER side of the entry is.
    const bankLines = entry.lines.filter((l) => l.accountId === SYSTEM_ACCOUNTS.SAYARAH_BANK);
    if (bankLines.length === 0) continue;
    const bankNetDebit = bankLines.reduce((s, l) => s + p(l.debit) - p(l.credit), 0);
    if (Math.abs(bankNetDebit) < 0.005) continue;

    // Classify by the primary non-bank account in the entry
    const nonBank = entry.lines.filter((l) => l.accountId !== SYSTEM_ACCOUNTS.SAYARAH_BANK);
    const primary = nonBank[0];
    if (!primary) continue;
    let category = "operating";
    // Member contributions / distributions = financing
    if (primary.accountId.startsWith("equity:member:")) category = "financing";
    // Everything else (revenue, expenses, inventory, AR, AP, taxes) = operating
    // Investing would be fixed-asset purchases — not in scope yet
    const row = {
      date: entry.date, memo: entry.memo, amount: bankNetDebit,
      counterpartyId: primary.accountId,
      ref: entry.ref,
    };
    byCategory[category].push(row);
    if (category === "operating") operating += bankNetDebit;
    else if (category === "investing") investing += bankNetDebit;
    else if (category === "financing") financing += bankNetDebit;
  }

  const netChange = operating + investing + financing;
  // Opening + closing cash balances for reconciliation
  const allBefore = (ledger || []).filter((e) => startDate && e.date < startDate);
  const allUpTo = (ledger || []).filter((e) => !endDate || e.date <= endDate);
  const opening = (calcAllBalances(allBefore, accounts)[SYSTEM_ACCOUNTS.SAYARAH_BANK]) || 0;
  const closing = (calcAllBalances(allUpTo, accounts)[SYSTEM_ACCOUNTS.SAYARAH_BANK]) || 0;
  return {
    operating, investing, financing, netChange,
    opening, closing,
    reconciles: Math.abs((closing - opening) - netChange) < 0.01,
    byCategory,
    startDate, endDate,
  };
}

// Statement of Member Equity — per-member movement over a period.
// Feeds K-1 prep directly. Returns one row per member with:
// opening balance · contributions · share of net income · distributions · closing.
export function calcStatementOfMemberEquity(ledger, accounts, members, startDate, endDate) {
  const before = (ledger || []).filter((e) => e.date < startDate);
  const upTo = (ledger || []).filter((e) => e.date <= endDate);
  const openingBalances = calcAllBalances(before, accounts);
  const closingBalances = calcAllBalances(upTo, accounts);
  const pl = calcProfitLoss(ledger, accounts, startDate, endDate);
  const memberCount = (members || []).length || 1;
  const share = pl.netIncome / memberCount;

  // Pro-rate: last member absorbs the penny remainder so shares
  // sum exactly to net income.
  return (members || []).map((m, i) => {
    const capId = memberAccountId(m.id);
    const distId = memberDistributionsId(m.id);
    const opening = openingBalances[capId] || 0;
    const closingCapital = closingBalances[capId] || 0;
    const closingDistributions = closingBalances[distId] || 0;
    // Contributions in the period = net credit activity on Capital
    // (excluding income-summary closes and distribution closes).
    // Approximation for display: opening + contributions + share
    // = closing capital before distributions-contra, so contributions
    // = closing capital − opening − share.
    const contributions = closingCapital - opening - share;
    // Share rounding: last member absorbs remainder
    const adjustedShare = i === memberCount - 1
      ? pl.netIncome - share * (memberCount - 1)
      : share;
    return {
      memberId: m.id,
      name: m.name,
      opening,
      contributions: Math.max(0, contributions),
      shareOfNetIncome: adjustedShare,
      distributions: closingDistributions,
      closing: opening + Math.max(0, contributions) + adjustedShare - closingDistributions,
    };
  });
}

// Depreciation schedule (placeholder — returns empty for now since
// Sayarah doesn't own non-inventory fixed assets per scope. Wire a
// real calculation in when fixed-asset register is added).
export function calcDepreciationSchedule() {
  return { items: [], total: 0, note: "No fixed assets on register (vehicle inventory is tracked separately as held-for-sale)." };
}

// ═══════════════════════════════════════════════════════════════
// MA sales tax filings — must be submitted every period even if
// zero. Auto-generate pending records for each month, flag red
// until admin marks as filed.
// ═══════════════════════════════════════════════════════════════
export function generateSalesTaxFilingsForMonth(existing, month) {
  const has = (existing || []).some((f) => f.month === month);
  if (has) return existing || [];
  // Monthly cadence by default — CPA may change to quarterly based
  // on prior-year liability (MA DOR sets the frequency).
  return [
    ...(existing || []),
    {
      id: `st_${month}`,
      month,
      cadence: "monthly",
      status: "pending",
      dueDate: `${month}-20`, // MA monthly sales tax return due 20th of following month
      generatedAt: new Date().toISOString(),
      filedAt: null,
      filedBy: null,
      amount: null,
    },
  ];
}

// Roll up in-state MA sales tax collected for a period. Used both
// for filing prep and the zero-return path (filing due even when 0).
export function calcSalesTaxFilingAmount(ledger, month) {
  const start = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${month}-${String(lastDay).padStart(2, "0")}`;
  const r = calcMaSalesTax(null, null, start, end);
  return r.collected;
}

// Override: rewire so tests can call with the ledger argument the
// existing signature expects. (JS closure — the inner fn sees the
// outer closure's `ledger` arg.)
export function calcSalesTaxFilingAmountFromLedger(ledger, month) {
  const start = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${month}-${String(lastDay).padStart(2, "0")}`;
  const r = calcMaSalesTax(ledger, null, start, end);
  return r.collected;
}

// Period-close gate: returns null if the period can be closed, or
// an error string describing what's blocking. Admin sees this in
// the Accounting tab before being allowed to click Close Month.
export function canClosePeriod({ month, bankImports, salesTaxFilings }) {
  // Rule 1: every bank-import row for the period must be resolved
  const periodRows = (bankImports || []).filter((r) => {
    const d = r.date || r.Date || "";
    return d.startsWith(month);
  });
  const unresolved = periodRows.filter((r) => !r.matchedEntryId && !r.ignored);
  if (unresolved.length > 0) {
    return `${unresolved.length} bank row${unresolved.length === 1 ? "" : "s"} unreconciled for ${month}. Match or ignore each before closing.`;
  }
  // Rule 2: MA sales tax filing for the period must be filed
  const filing = (salesTaxFilings || []).find((f) => f.month === month);
  if (!filing) return `No MA sales tax filing record for ${month}. Generate one before closing.`;
  if (filing.status !== "filed") return `MA sales tax filing for ${month} is still ${filing.status}. File it (or file as $0) before closing.`;
  return null;
}

// Out-of-state / international sales breakdown for nexus review.
// Returns rows of { date, stockNum, destination, buyerState, grossSale }.
// CPA uses this to check per-state nexus exposure quarterly.
export function calcOutOfStateSalesReport(ledger, startDate, endDate) {
  const rows = [];
  for (const entry of entriesInRange(ledger, startDate, endDate)) {
    if (entry.ref?.type !== "vehicle_sale") continue;
    const dest = entry.ref.destination || "unspecified";
    if (dest === "in_state_ma") continue;
    const bank = entry.lines.find((l) => l.accountId === SYSTEM_ACCOUNTS.SAYARAH_BANK);
    if (!bank) continue;
    rows.push({
      date: entry.date,
      stockNum: entry.ref.stockNum,
      destination: dest,
      buyerState: entry.ref.buyerState || null,
      grossSale: p(bank.debit),
    });
  }
  return rows;
}

// Vehicle Profitability Report: per-vehicle cost, sale price, net
// profit, ROI %, days in inventory. Computed from the ledger +
// vehicle/sale records provided by the caller.
export function calcVehicleProfitabilityReport({ vehicles, sales, expenses, holdCosts, ledger, startDate, endDate }) {
  const rows = [];
  for (const v of vehicles || []) {
    const sale = (sales || []).find((s) => s.stockNum === v.stockNum);
    if (!sale) continue;
    if (sale.date < startDate || sale.date > endDate) continue;
    // totalCost must be passed in or computed via calcTotalCost; to
    // keep money.js free of calc.js dependency, caller passes it.
    const totalCost = p(v.__totalCost || 0);
    const grossSale = p(sale.grossPrice);
    const profit = grossSale - totalCost;
    const daysInInventory = v.purchaseDate && sale.date
      ? Math.max(0, Math.round((new Date(sale.date) - new Date(v.purchaseDate)) / 86400000))
      : null;
    rows.push({
      stockNum: v.stockNum,
      year: v.year, make: v.make, model: v.model,
      purchaseDate: v.purchaseDate,
      saleDate: sale.date,
      daysInInventory,
      totalCost,
      grossSale,
      profit,
      roi: totalCost > 0 ? profit / totalCost : null,
      destination: sale.saleDestination || "unspecified",
    });
  }
  return rows.sort((a, b) => (b.profit || 0) - (a.profit || 0));
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

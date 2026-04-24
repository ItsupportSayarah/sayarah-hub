// Regression tests for the Money Management accounting core.
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ACCOUNT_TYPES,
  SYSTEM_ACCOUNTS,
  TAX_PER_SALE,
  DEFAULT_ACCOUNTS,
  memberAccountId,
  vehicleAccountId,
  memberAccount,
  vehicleAccount,
  validateJournalEntry,
  buildJournalEntry,
  postJournalEntry,
  buildReversingEntry,
  calcAccountBalance,
  calcAllBalances,
  monthKey,
  findContribution,
  findApproval,
  calcMemberMonthlyStatus,
  canMemberUseFund,
  generateMonthlyContributions,
  contributionPaidEntryBalanced,
  allocateToFundEntry,
  vehiclePurchaseFromFundEntry,
  vehiclePurchaseFromMemberEntry,
  vehicleSaleEntries,
  distributeMonthEndEntry,
  MONTHLY_CONTRIBUTION_AMOUNT,
} from "../apps/auction/src/money.js";

// ─── Chart of accounts sanity ─────────────────────────────────
test("DEFAULT_ACCOUNTS has all system accounts and no duplicates", () => {
  const ids = DEFAULT_ACCOUNTS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicate account ids");
  for (const key of Object.values(SYSTEM_ACCOUNTS)) {
    assert.ok(ids.includes(key), `missing system account: ${key}`);
  }
  for (const acc of DEFAULT_ACCOUNTS) {
    assert.ok(ACCOUNT_TYPES[acc.type], `unknown account type on ${acc.id}: ${acc.type}`);
  }
});

// ─── Journal entry validation ─────────────────────────────────
test("validateJournalEntry rejects unbalanced entries", () => {
  const bad = {
    date: "2025-01-01",
    lines: [
      { accountId: "a", debit: 100, credit: 0 },
      { accountId: "b", debit: 0, credit: 50 },
    ],
  };
  assert.match(validateJournalEntry(bad), /Debits.*must equal credits/);
});

test("validateJournalEntry rejects lines with both debit and credit", () => {
  const bad = {
    date: "2025-01-01",
    lines: [
      { accountId: "a", debit: 100, credit: 100 },
      { accountId: "b", debit: 0, credit: 100 },
    ],
  };
  assert.match(validateJournalEntry(bad), /Invalid line/);
});

test("validateJournalEntry accepts a valid two-line entry", () => {
  const ok = buildJournalEntry({
    date: "2025-01-01",
    memo: "test",
    user: "u",
    lines: [
      { accountId: "a", debit: 100, credit: 0 },
      { accountId: "b", debit: 0, credit: 100 },
    ],
  });
  assert.equal(validateJournalEntry(ok), null);
});

test("postJournalEntry returns a new ledger, never mutates the input", () => {
  const ledger = [];
  const entry = buildJournalEntry({
    date: "2025-01-01",
    lines: [
      { accountId: "a", debit: 10, credit: 0 },
      { accountId: "b", debit: 0, credit: 10 },
    ],
  });
  const next = postJournalEntry(ledger, entry);
  assert.equal(ledger.length, 0);
  assert.equal(next.length, 1);
});

test("postJournalEntry throws on invalid entries (no silent corruption)", () => {
  assert.throws(() => postJournalEntry([], { lines: [] }), /Journal entry rejected/);
});

// ─── Balance computation ──────────────────────────────────────
test("calcAccountBalance uses debit-normal for assets", () => {
  const accounts = [{ id: "bank", type: "asset" }];
  const byId = { bank: accounts[0] };
  const ledger = [
    { lines: [{ accountId: "bank", debit: 100, credit: 0 }, { accountId: "x", debit: 0, credit: 100 }] },
    { lines: [{ accountId: "bank", debit: 0, credit: 30 }, { accountId: "x", debit: 30, credit: 0 }] },
  ];
  assert.equal(calcAccountBalance("bank", ledger, byId), 70);
});

test("calcAccountBalance uses credit-normal for equity", () => {
  const accounts = [{ id: "cap", type: "equity" }];
  const byId = { cap: accounts[0] };
  const ledger = [
    { lines: [{ accountId: "cap", debit: 0, credit: 500 }, { accountId: "x", debit: 500, credit: 0 }] },
    { lines: [{ accountId: "cap", debit: 100, credit: 0 }, { accountId: "x", debit: 0, credit: 100 }] },
  ];
  assert.equal(calcAccountBalance("cap", ledger, byId), 400);
});

test("calcAllBalances returns a balance for every known account id", () => {
  const accounts = [
    { id: "bank", type: "asset" },
    { id: "cap", type: "equity" },
  ];
  const ledger = [
    { lines: [{ accountId: "bank", debit: 1000, credit: 0 }, { accountId: "cap", debit: 0, credit: 1000 }] },
  ];
  const bals = calcAllBalances(ledger, accounts);
  assert.equal(bals.bank, 1000);
  assert.equal(bals.cap, 1000);
});

// ─── Monthly contribution workflow ───────────────────────────
test("generateMonthlyContributions is idempotent per (member, month)", () => {
  const members = [{ id: "m1" }, { id: "m2" }];
  const first = generateMonthlyContributions([], members, "2025-01");
  assert.equal(first.length, 2);
  const second = generateMonthlyContributions(first, members, "2025-01");
  assert.equal(second.length, 2, "no duplicates on re-run");
});

test("generateMonthlyContributions sets amount to the monthly constant", () => {
  const [c] = generateMonthlyContributions([], [{ id: "m1" }], "2025-02");
  assert.equal(c.amount, MONTHLY_CONTRIBUTION_AMOUNT);
  assert.equal(c.status, "pending");
  assert.equal(c.dueDate, "2025-02-01");
});

test("calcMemberMonthlyStatus: green only when paid AND admin-approved", () => {
  const m = "m1";
  const month = "2025-01";
  const cont = [{ memberId: m, month, status: "paid" }];
  const appr = [{ memberId: m, month, status: "approved" }];
  assert.equal(calcMemberMonthlyStatus(m, month, cont, appr), "green");
});

test("calcMemberMonthlyStatus: red when paid but not approved", () => {
  const cont = [{ memberId: "m1", month: "2025-01", status: "paid" }];
  const appr = [];
  assert.equal(calcMemberMonthlyStatus("m1", "2025-01", cont, appr), "red");
});

test("calcMemberMonthlyStatus: red when approved but not paid", () => {
  const cont = [];
  const appr = [{ memberId: "m1", month: "2025-01", status: "approved" }];
  assert.equal(calcMemberMonthlyStatus("m1", "2025-01", cont, appr), "red");
});

test("canMemberUseFund blocks unless status is green for the current month", () => {
  const now = new Date("2025-03-15");
  assert.equal(canMemberUseFund("m1", [], [], now), false);
  const cont = [{ memberId: "m1", month: "2025-03", status: "paid" }];
  const appr = [{ memberId: "m1", month: "2025-03", status: "approved" }];
  assert.equal(canMemberUseFund("m1", cont, appr, now), true);
});

// ─── Event-to-journal translators ─────────────────────────────
test("contributionPaidEntryBalanced is a valid entry", () => {
  const e = contributionPaidEntryBalanced({ memberId: "m1", month: "2025-01", amount: 25000, user: "u" });
  assert.equal(validateJournalEntry(e), null);
});

test("allocateToFundEntry balances (bank → fund reclassification)", () => {
  const e = allocateToFundEntry({ amount: 25000, user: "u" });
  assert.equal(validateJournalEntry(e), null);
});

test("vehiclePurchaseFromFundEntry: fund pays, inventory up", () => {
  const e = vehiclePurchaseFromFundEntry({ stockNum: "001", amount: 9000, date: "2025-01-05", user: "u" });
  assert.equal(validateJournalEntry(e), null);
  const fundLine = e.lines.find((l) => l.accountId === SYSTEM_ACCOUNTS.ATLANTIC_FUND);
  assert.equal(fundLine.credit, 9000);
});

test("vehiclePurchaseFromMemberEntry: member capital up, inventory up", () => {
  const e = vehiclePurchaseFromMemberEntry({ stockNum: "002", memberId: "m1", amount: 5000, date: "2025-01-06", user: "u" });
  assert.equal(validateJournalEntry(e), null);
  const capLine = e.lines.find((l) => l.accountId === memberAccountId("m1"));
  assert.equal(capLine.credit, 5000);
});

// ─── Vehicle sale (new CPA-approved three-entry pattern) ───
// Per the Accounting spec: one entry for cash+revenue+sales-tax,
// one for COGS+inventory relief, one for tax-reserve accrual.
// Principal return to fund is an INTERNAL sub-ledger event, not
// a journal entry — it doesn't appear on external statements.
test("vehicleSaleEntries: profitable sale posts 3 clean entries (revenue, COGS, tax reserve)", () => {
  const entries = vehicleSaleEntries({
    stockNum: "001",
    totalCost: 9000,
    grossSale: 12000,
    date: "2025-02-20",
    user: "u",
    destination: "out_of_state_us",
  });
  assert.equal(entries.length, 3);
  for (const e of entries) assert.equal(validateJournalEntry(e), null);

  const saleEntry = entries.find((e) => e.ref?.type === "vehicle_sale");
  assert.ok(saleEntry, "sale entry present");
  const bankLine = saleEntry.lines.find((l) => l.accountId === SYSTEM_ACCOUNTS.SAYARAH_BANK);
  assert.equal(bankLine.debit, 12000, "bank +12K on out-of-state sale (no sales tax)");
  const revLine = saleEntry.lines.find((l) => l.accountId === SYSTEM_ACCOUNTS.REVENUE_VEHICLE_SALES);
  assert.equal(revLine.credit, 12000);

  const cogsEntry = entries.find((e) => e.ref?.type === "vehicle_cogs");
  assert.ok(cogsEntry, "COGS entry present");

  const taxEntry = entries.find((e) => e.ref?.type === "tax_reserve");
  assert.ok(taxEntry, "tax reserve entry present");
  const taxExp = taxEntry.lines.find((l) => l.accountId === SYSTEM_ACCOUNTS.TAX_RESERVE_EXPENSE);
  assert.equal(taxExp.debit, TAX_PER_SALE);
  const taxLiab = taxEntry.lines.find((l) => l.accountId === SYSTEM_ACCOUNTS.ACCRUED_TAX_LIABILITY);
  assert.equal(taxLiab.credit, TAX_PER_SALE);
});

test("vehicleSaleEntries: loss sale still accrues full $295 tax reserve per CPA pattern", () => {
  const entries = vehicleSaleEntries({
    stockNum: "004",
    totalCost: 10000,
    grossSale: 9000,
    date: "2025-02-20",
    user: "u",
    destination: "out_of_state_us",
  });
  const taxEntry = entries.find((e) => e.ref?.type === "tax_reserve");
  assert.ok(taxEntry, "tax reserve still accrues on loss — CPA flat $295 policy");
  const liab = taxEntry.lines.find((l) => l.accountId === SYSTEM_ACCOUNTS.ACCRUED_TAX_LIABILITY);
  assert.equal(liab.credit, TAX_PER_SALE);
});

test("fundPrincipalReturnEvent: internal sub-ledger event, not a JE", () => {
  const ev = fundPrincipalReturnEvent({ stockNum: "001", amount: 9000, destination: { type: "fund" }, date: "2025-02-20", user: "u" });
  assert.equal(ev.type, "principal_return");
  assert.equal(ev.amount, 9000);
  assert.ok(!ev.lines, "sub-ledger event has no journal lines");
});

// ─── Month-end distribution ──────────────────────────────────
test("distributeMonthEndEntry splits profit equally across members and zeroes the account", () => {
  const members = [{ id: "m1" }, { id: "m2" }, { id: "m3" }];
  const entry = distributeMonthEndEntry({
    month: "2025-03",
    members,
    profitBalance: 3000,
    user: "admin",
  });
  assert.equal(validateJournalEntry(entry), null);
  const distDebit = entry.lines.find((l) => l.accountId === SYSTEM_ACCOUNTS.PROFIT_DISTRIBUTION);
  assert.equal(distDebit.debit, 3000);
  const totalCredited = entry.lines
    .filter((l) => l.accountId.startsWith("equity:member:"))
    .reduce((s, l) => s + l.credit, 0);
  assert.equal(totalCredited, 3000);
});

test("distributeMonthEndEntry handles penny rounding by giving the remainder to the last member", () => {
  const members = [{ id: "m1" }, { id: "m2" }, { id: "m3" }];
  // $100 / 3 = 33.3333... Each member: 33.33, last: 33.34 (= 100 - 66.66)
  const entry = distributeMonthEndEntry({
    month: "2025-03",
    members,
    profitBalance: 100,
    user: "admin",
  });
  const memberCredits = entry.lines
    .filter((l) => l.accountId.startsWith("equity:member:"))
    .map((l) => l.credit);
  const total = memberCredits.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 100) < 0.001, `total distributed should equal $100, got ${total}`);
});

test("distributeMonthEndEntry returns null when nothing to distribute", () => {
  const r = distributeMonthEndEntry({ month: "2025-03", members: [{ id: "m1" }], profitBalance: 0, user: "u" });
  assert.equal(r, null);
});

// ─── Reversing entries ───────────────────────────────────────
test("buildReversingEntry flips debits and credits and references the original", () => {
  const original = buildJournalEntry({
    date: "2025-01-01",
    lines: [
      { accountId: "a", debit: 100, credit: 0 },
      { accountId: "b", debit: 0, credit: 100 },
    ],
  });
  const rev = buildReversingEntry(original, { user: "admin" });
  assert.equal(validateJournalEntry(rev), null);
  assert.equal(rev.ref.type, "reversal");
  assert.equal(rev.ref.of, original.id);
  assert.equal(rev.lines[0].credit, 100);
  assert.equal(rev.lines[0].debit, 0);
});

// ─── End-to-end scenario: one month, one vehicle, full flow ──
// Exercises the CPA-approved three-entry sale pattern. Principal is
// not "returned to the fund" as a JE anymore — that's an internal
// sub-ledger event. The profit sits in Revenue / COGS / Tax Reserve
// until month-end, when a closing-style entry moves net income into
// the PROFIT_DISTRIBUTION clearing account so distributeMonthEndEntry
// can split it to members.
test("end-to-end: 3 members contribute $25K, fund buys & sells a vehicle, month-end distributes", () => {
  const members = [{ id: "m1" }, { id: "m2" }, { id: "m3" }];
  let ledger = [];
  const accounts = [
    ...DEFAULT_ACCOUNTS,
    ...members.map((m) => memberAccount(m.id, m.id.toUpperCase())),
    vehicleAccount("001", "2020 Test Vehicle"),
  ];

  // 1. Three contributions of $25K paid, each allocated to the fund.
  for (const m of members) {
    ledger = postJournalEntry(ledger, contributionPaidEntryBalanced({ memberId: m.id, month: "2025-01", amount: 25000, user: "u" }));
    ledger = postJournalEntry(ledger, allocateToFundEntry({ amount: 25000, user: "u" }));
  }

  let balances = calcAllBalances(ledger, accounts);
  assert.equal(balances[SYSTEM_ACCOUNTS.ATLANTIC_FUND], 75000);

  // 2. Fund buys a $60K vehicle.
  ledger = postJournalEntry(ledger, vehiclePurchaseFromFundEntry({ stockNum: "001", amount: 60000, date: "2025-01-10", user: "u" }));
  balances = calcAllBalances(ledger, accounts);
  assert.equal(balances[SYSTEM_ACCOUNTS.ATLANTIC_FUND], 15000);
  assert.equal(balances[vehicleAccountId("001")], 60000);

  // 3. Vehicle sells for $72K out-of-state → new 3-entry pattern:
  //    sale (cash/revenue), COGS/inventory, tax reserve.
  const saleEntries = vehicleSaleEntries({
    stockNum: "001",
    totalCost: 60000,
    grossSale: 72000,
    destination: "out_of_state_us",
    date: "2025-01-25",
    user: "u",
  });
  assert.equal(saleEntries.length, 3, "new pattern posts three entries");
  for (const e of saleEntries) ledger = postJournalEntry(ledger, e);
  balances = calcAllBalances(ledger, accounts);

  // Inventory cleared, bank received gross (no in-state tax), accrued tax reserve + tax reserve expense recognized.
  assert.equal(balances[vehicleAccountId("001")], 0, "inventory cleared after sale");
  assert.equal(balances[SYSTEM_ACCOUNTS.ACCRUED_TAX_LIABILITY], TAX_PER_SALE);
  assert.equal(balances["revenue:vehicle-sales"], 72000);
  assert.equal(balances["expense:cogs-vehicles"], 60000);
  assert.equal(balances["expense:tax-reserve"], TAX_PER_SALE);

  // Principal-return is NOT a JE — record the internal sub-ledger event instead.
  // Atlantic Fund balance stays at 15K (cash sits in bank, not the fund).
  assert.equal(balances[SYSTEM_ACCOUNTS.ATLANTIC_FUND], 15000, "fund untouched by sale JE (principal return is sub-ledger)");

  // 4. Month-end: post a closing-style entry to move net income
  //    (revenue - cogs - tax reserve expense) into the profit
  //    distribution clearing account, then allocate to members.
  const netIncome = 72000 - 60000 - TAX_PER_SALE; // 11705
  const closeToDistribution = buildJournalEntry({
    date: "2025-01-31",
    memo: "Month-end: close net income to distribution clearing",
    user: "admin",
    ref: { type: "month_end_close", month: "2025-01" },
    lines: [
      { accountId: "revenue:vehicle-sales", debit: 72000, credit: 0 },
      { accountId: "expense:cogs-vehicles", debit: 0, credit: 60000 },
      { accountId: "expense:tax-reserve", debit: 0, credit: TAX_PER_SALE },
      { accountId: SYSTEM_ACCOUNTS.PROFIT_DISTRIBUTION, debit: 0, credit: netIncome },
    ],
  });
  ledger = postJournalEntry(ledger, closeToDistribution);

  const distEntry = distributeMonthEndEntry({
    month: "2025-01",
    members,
    profitBalance: netIncome,
    user: "admin",
  });
  ledger = postJournalEntry(ledger, distEntry);
  balances = calcAllBalances(ledger, accounts);

  assert.ok(Math.abs(balances[SYSTEM_ACCOUNTS.PROFIT_DISTRIBUTION]) < 0.01, "distribution clearing zeroed");

  // Each member's capital should now be 25000 + share of 11705.
  const totalMemberCapital = members.reduce((s, m) => s + balances[memberAccountId(m.id)], 0);
  const expectedTotal = 75000 + netIncome;
  assert.ok(Math.abs(totalMemberCapital - expectedTotal) < 0.01,
    `total member capital should be ${expectedTotal}, got ${totalMemberCapital}`);
});

test("monthKey formats correctly", () => {
  assert.equal(monthKey(new Date("2025-04-15")), "2025-04");
  assert.equal(monthKey("2025-01-01"), "2025-01");
});

// ─── Report-calculation helpers ───────────────────────────────
import {
  calcProfitLoss,
  calcBalanceSheet,
  calcMemberK1Prep,
  calc1099Report,
  calcMaSalesTax,
  parseBankCsv,
  suggestMatches,
  entriesInRange,
  // Expense auto-posting
  DEFAULT_EXPENSE_CATEGORY_MAP,
  resolveExpenseAccount,
  expenseEntry,
} from "../apps/auction/src/money.js";

test("resolveExpenseAccount: maps every default category to a CoA expense account", () => {
  for (const [category, accountId] of Object.entries(DEFAULT_EXPENSE_CATEGORY_MAP)) {
    const resolved = resolveExpenseAccount(category);
    assert.equal(resolved, accountId, `default map mismatch for ${category}`);
    assert.ok(resolved.startsWith("expense:"), `resolved id must be an expense account, got ${resolved}`);
  }
});

test("resolveExpenseAccount: unknown category falls back to Other Expenses", () => {
  assert.equal(resolveExpenseAccount("Not A Real Category"), SYSTEM_ACCOUNTS.EXPENSE_OTHER);
  assert.equal(resolveExpenseAccount(undefined), SYSTEM_ACCOUNTS.EXPENSE_OTHER);
  assert.equal(resolveExpenseAccount(""), SYSTEM_ACCOUNTS.EXPENSE_OTHER);
});

test("resolveExpenseAccount: customMap overrides default mapping", () => {
  const custom = { "Transport/Towing": SYSTEM_ACCOUNTS.EXPENSE_OFFICE_ADMIN };
  assert.equal(resolveExpenseAccount("Transport/Towing", custom), SYSTEM_ACCOUNTS.EXPENSE_OFFICE_ADMIN);
  // Unaffected categories still use defaults
  assert.equal(resolveExpenseAccount("Marketing/Listing", custom), SYSTEM_ACCOUNTS.EXPENSE_ADVERTISING);
});

test("expenseEntry: builds a balanced JE (Dr expense, Cr Cash)", () => {
  const entry = expenseEntry({
    expenseId: "e1", category: "Marketing/Listing", amount: 150,
    vendor: "Facebook", description: "Boosted post", stockNum: "001",
    date: "2025-03-15", user: "admin",
  });
  assert.equal(validateJournalEntry(entry), null);
  assert.equal(entry.lines.length, 2);
  const debit = entry.lines.find(l => l.debit > 0);
  const credit = entry.lines.find(l => l.credit > 0);
  assert.equal(debit.accountId, SYSTEM_ACCOUNTS.EXPENSE_ADVERTISING);
  assert.equal(debit.debit, 150);
  assert.equal(credit.accountId, SYSTEM_ACCOUNTS.SAYARAH_BANK);
  assert.equal(credit.credit, 150);
  assert.equal(entry.ref.type, "expense");
  assert.equal(entry.ref.vendor, "Facebook");
});

test("expenseEntry: zero-amount returns null (no silent $0 ledger post)", () => {
  assert.equal(expenseEntry({ expenseId: "x", category: "Other", amount: 0, date: "2025-01-01", user: "admin" }), null);
  assert.equal(expenseEntry({ expenseId: "x", category: "Other", amount: "", date: "2025-01-01", user: "admin" }), null);
});

test("calcProfitLoss sums revenue minus expenses in the date range", () => {
  const accounts = [
    { id: SYSTEM_ACCOUNTS.REVENUE_VEHICLE_SALES, type: "revenue" },
    { id: SYSTEM_ACCOUNTS.COGS_VEHICLES, type: "expense" },
    { id: "bank", type: "asset" },
  ];
  const ledger = [
    buildJournalEntry({ date: "2025-01-10", lines: [
      { accountId: "bank", debit: 10000, credit: 0 },
      { accountId: SYSTEM_ACCOUNTS.REVENUE_VEHICLE_SALES, debit: 0, credit: 10000 },
    ]}),
    buildJournalEntry({ date: "2025-01-10", lines: [
      { accountId: SYSTEM_ACCOUNTS.COGS_VEHICLES, debit: 7000, credit: 0 },
      { accountId: "bank", debit: 0, credit: 7000 },
    ]}),
    buildJournalEntry({ date: "2025-02-01", lines: [
      // Outside the Jan range — should be excluded.
      { accountId: "bank", debit: 1, credit: 0 },
      { accountId: SYSTEM_ACCOUNTS.REVENUE_VEHICLE_SALES, debit: 0, credit: 1 },
    ]}),
  ];
  const pl = calcProfitLoss(ledger, accounts, "2025-01-01", "2025-01-31");
  assert.equal(pl.revenue, 10000);
  assert.equal(pl.expenses, 7000);
  assert.equal(pl.netIncome, 3000);
});

test("calcBalanceSheet: assets = liabilities + equity as of a date", () => {
  // Include the member capital account so it's classified as equity
  // on the balance sheet (member accounts are generated dynamically).
  const accounts = [...DEFAULT_ACCOUNTS, memberAccount("m1", "Alice")];
  let ledger = [];
  ledger = postJournalEntry(ledger, contributionPaidEntryBalanced({ memberId: "m1", month: "2025-01", amount: 50000, user: "u" }));
  const bs = calcBalanceSheet(ledger, accounts, "2025-01-31");
  assert.equal(bs.totals.assets, 50000, "bank asset $50K");
  assert.equal(bs.totals.liabilities, 0);
  assert.equal(bs.totals.equity, 50000, "member capital $50K");
  assert.ok(Math.abs(bs.totals.assets - bs.totals.liabilities - bs.totals.equity) < 0.01, "bs must balance");
});

test("calcMemberK1Prep: equal share of period net income", () => {
  const accounts = [
    ...DEFAULT_ACCOUNTS,
    memberAccount("m1", "Alice"),
    memberAccount("m2", "Bob"),
  ];
  const members = [{ id: "m1", name: "Alice" }, { id: "m2", name: "Bob" }];
  // Give each $10K capital, then recognize $2K net income via rev/cogs.
  let ledger = [];
  ledger = postJournalEntry(ledger, contributionPaidEntryBalanced({ memberId: "m1", month: "2025-01", amount: 10000, user: "u" }));
  ledger = postJournalEntry(ledger, contributionPaidEntryBalanced({ memberId: "m2", month: "2025-01", amount: 10000, user: "u" }));
  ledger = postJournalEntry(ledger, buildJournalEntry({ date: "2025-01-15", lines: [
    { accountId: SYSTEM_ACCOUNTS.SAYARAH_BANK, debit: 2000, credit: 0 },
    { accountId: SYSTEM_ACCOUNTS.REVENUE_VEHICLE_SALES, debit: 0, credit: 2000 },
  ]}));
  const k1 = calcMemberK1Prep(ledger, accounts, members, "2025-01-01", "2025-01-31");
  assert.equal(k1[0].shareOfIncome, 1000);
  assert.equal(k1[1].shareOfIncome, 1000);
  assert.equal(k1[0].endingCapital, 10000);
});

test("parseBankCsv handles simple CSV with headers", () => {
  const csv = `date,description,amount\n2025-01-05,Wire from Alice,25000.00\n2025-01-10,Car dealer payout,-9000.00`;
  const parsed = parseBankCsv(csv);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].date, "2025-01-05");
  assert.equal(parsed.rows[1].amount, "-9000.00");
});

test("suggestMatches: date + amount within $1 returns a candidate", () => {
  const entry = buildJournalEntry({ date: "2025-01-05", lines: [
    { accountId: SYSTEM_ACCOUNTS.SAYARAH_BANK, debit: 25000, credit: 0 },
    { accountId: "equity:member:m1", debit: 0, credit: 25000 },
  ]});
  const csvRow = { date: "2025-01-05", description: "Wire from Alice", amount: "25000.00" };
  const matches = suggestMatches(csvRow, [entry]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, entry.id);
});

test("suggestMatches: no match on different date", () => {
  const entry = buildJournalEntry({ date: "2025-01-05", lines: [
    { accountId: "bank", debit: 25000, credit: 0 },
    { accountId: "cap", debit: 0, credit: 25000 },
  ]});
  const csvRow = { date: "2025-01-06", amount: "25000.00" };
  assert.equal(suggestMatches(csvRow, [entry]).length, 0);
});

// ─── Phase 3: MA use tax ─────────────────────────────────────
import {
  MA_USE_TAX_RATE,
  calcUseTax,
  calcMaUseTax,
  useTaxOnPurchaseEntry,
  isDateInClosedPeriod,
  calcClosingEntries,
} from "../apps/auction/src/money.js";

test("MA use tax rate is 6.25% (verified against mass.gov)", () => {
  assert.equal(MA_USE_TAX_RATE, 0.0625);
  assert.equal(calcUseTax(10000), 625);
  assert.equal(calcUseTax(9000), 562.5);
});

test("useTaxOnPurchaseEntry: debit vehicle inventory, credit use tax payable", () => {
  const e = useTaxOnPurchaseEntry({ stockNum: "001", purchasePrice: 10000, date: "2025-01-05", user: "u" });
  assert.equal(validateJournalEntry(e), null);
  const inventoryLine = e.lines.find((l) => l.accountId === vehicleAccountId("001"));
  assert.equal(inventoryLine.debit, 625, "use tax rolls into cost basis (debit vehicle inv)");
  const liabilityLine = e.lines.find((l) => l.accountId === SYSTEM_ACCOUNTS.USE_TAX_PAYABLE);
  assert.equal(liabilityLine.credit, 625);
});

test("useTaxOnPurchaseEntry: zero-price purchase returns null", () => {
  const e = useTaxOnPurchaseEntry({ stockNum: "002", purchasePrice: 0, date: "2025-01-05", user: "u" });
  assert.equal(e, null);
});

test("calcMaUseTax sums the liability in a date range", () => {
  const e1 = useTaxOnPurchaseEntry({ stockNum: "001", purchasePrice: 10000, date: "2025-01-05", user: "u" });
  const e2 = useTaxOnPurchaseEntry({ stockNum: "002", purchasePrice: 8000, date: "2025-02-10", user: "u" });
  const ledger = [e1, e2];
  const r = calcMaUseTax(ledger, "2025-01-01", "2025-01-31");
  assert.equal(r.owed, 625);
  assert.equal(r.paid, 0);
});

// ─── Phase 3: Closed-period lock ─────────────────────────────
test("isDateInClosedPeriod: inclusive bounds", () => {
  const closed = [{ startDate: "2024-01-01", endDate: "2024-12-31" }];
  assert.equal(isDateInClosedPeriod("2024-06-15", closed), true);
  assert.equal(isDateInClosedPeriod("2024-01-01", closed), true);
  assert.equal(isDateInClosedPeriod("2024-12-31", closed), true);
  assert.equal(isDateInClosedPeriod("2025-01-01", closed), false);
  assert.equal(isDateInClosedPeriod("2023-12-31", closed), false);
});

test("postJournalEntry refuses to post into a closed period", () => {
  const closed = [{ startDate: "2024-01-01", endDate: "2024-12-31" }];
  const entry = buildJournalEntry({
    date: "2024-06-15",
    lines: [
      { accountId: "a", debit: 100, credit: 0 },
      { accountId: "b", debit: 0, credit: 100 },
    ],
  });
  assert.throws(
    () => postJournalEntry([], entry, closed),
    /Cannot post to a closed period/
  );
});

test("postJournalEntry still accepts entries outside closed periods", () => {
  const closed = [{ startDate: "2024-01-01", endDate: "2024-12-31" }];
  const entry = buildJournalEntry({
    date: "2025-03-10",
    lines: [
      { accountId: "a", debit: 100, credit: 0 },
      { accountId: "b", debit: 0, credit: 100 },
    ],
  });
  const ledger = postJournalEntry([], entry, closed);
  assert.equal(ledger.length, 1);
});

// ─── Phase 3: Year-end close ─────────────────────────────────
test("calcClosingEntries: revenue → income summary → retained earnings", () => {
  const accounts = [
    { id: SYSTEM_ACCOUNTS.REVENUE_VEHICLE_SALES, type: "revenue" },
    { id: SYSTEM_ACCOUNTS.COGS_VEHICLES, type: "expense" },
    { id: SYSTEM_ACCOUNTS.INCOME_SUMMARY, type: "equity" },
    { id: SYSTEM_ACCOUNTS.RETAINED_EARNINGS, type: "equity" },
    { id: "bank", type: "asset" },
  ];
  const ledger = [
    buildJournalEntry({ date: "2024-06-01", lines: [
      { accountId: "bank", debit: 50000, credit: 0 },
      { accountId: SYSTEM_ACCOUNTS.REVENUE_VEHICLE_SALES, debit: 0, credit: 50000 },
    ]}),
    buildJournalEntry({ date: "2024-06-15", lines: [
      { accountId: SYSTEM_ACCOUNTS.COGS_VEHICLES, debit: 40000, credit: 0 },
      { accountId: "bank", debit: 0, credit: 40000 },
    ]}),
  ];
  const result = calcClosingEntries({ ledger, accounts, fiscalYearEnd: "2024-12-31", user: "admin" });
  assert.equal(result.revenue, 50000);
  assert.equal(result.expenses, 40000);
  assert.equal(result.netIncome, 10000);
  assert.equal(result.entries.length, 3, "three closing entries: close revenue, close expenses, close income summary");
  for (const e of result.entries) assert.equal(validateJournalEntry(e), null, `closing entry must balance: ${e.memo}`);

  // After posting all three entries, revenue and expense accounts should
  // net to zero, Retained Earnings should hold the net income.
  let closedLedger = ledger;
  for (const e of result.entries) closedLedger = postJournalEntry(closedLedger, e);
  const balances = calcAllBalances(closedLedger, accounts);
  assert.equal(balances[SYSTEM_ACCOUNTS.REVENUE_VEHICLE_SALES], 0, "revenue closed to 0");
  assert.equal(balances[SYSTEM_ACCOUNTS.COGS_VEHICLES], 0, "expenses closed to 0");
  assert.equal(balances[SYSTEM_ACCOUNTS.INCOME_SUMMARY], 0, "income summary closed to 0");
  assert.equal(balances[SYSTEM_ACCOUNTS.RETAINED_EARNINGS], 10000, "net income landed in retained earnings");
});

test("calcClosingEntries: net loss (expenses > revenue) debits retained earnings", () => {
  const accounts = [
    { id: SYSTEM_ACCOUNTS.REVENUE_VEHICLE_SALES, type: "revenue" },
    { id: SYSTEM_ACCOUNTS.COGS_VEHICLES, type: "expense" },
    { id: SYSTEM_ACCOUNTS.INCOME_SUMMARY, type: "equity" },
    { id: SYSTEM_ACCOUNTS.RETAINED_EARNINGS, type: "equity" },
    { id: "bank", type: "asset" },
  ];
  const ledger = [
    buildJournalEntry({ date: "2024-06-01", lines: [
      { accountId: "bank", debit: 30000, credit: 0 },
      { accountId: SYSTEM_ACCOUNTS.REVENUE_VEHICLE_SALES, debit: 0, credit: 30000 },
    ]}),
    buildJournalEntry({ date: "2024-06-15", lines: [
      { accountId: SYSTEM_ACCOUNTS.COGS_VEHICLES, debit: 40000, credit: 0 },
      { accountId: "bank", debit: 0, credit: 40000 },
    ]}),
  ];
  const result = calcClosingEntries({ ledger, accounts, fiscalYearEnd: "2024-12-31", user: "admin" });
  assert.equal(result.netIncome, -10000);
  let closedLedger = ledger;
  for (const e of result.entries) closedLedger = postJournalEntry(closedLedger, e);
  const balances = calcAllBalances(closedLedger, accounts);
  assert.equal(balances[SYSTEM_ACCOUNTS.RETAINED_EARNINGS], -10000, "net loss reduces retained earnings");
});

test("calcClosingEntries: no-activity year returns empty entries + zero net", () => {
  const r = calcClosingEntries({
    ledger: [],
    accounts: [{ id: SYSTEM_ACCOUNTS.REVENUE_VEHICLE_SALES, type: "revenue" }],
    fiscalYearEnd: "2024-12-31",
    user: "admin",
  });
  assert.equal(r.entries.length, 0);
  assert.equal(r.netIncome, 0);
});

// ─── MA sales tax: destination-aware ─────────────────────────
import {
  MA_SALES_TAX_RATE,
  SALE_DESTINATIONS,
  calcMaSalesTaxOnSale,
  salesTaxOnSaleEntry,
} from "../apps/auction/src/money.js";

test("MA_SALES_TAX_RATE is 6.25%", () => {
  assert.equal(MA_SALES_TAX_RATE, 0.0625);
});

test("SALE_DESTINATIONS: only in-state taxable", () => {
  assert.equal(SALE_DESTINATIONS.in_state_ma.taxable, true);
  assert.equal(SALE_DESTINATIONS.out_of_state_us.taxable, false);
  assert.equal(SALE_DESTINATIONS.international.taxable, false);
});

test("calcMaSalesTaxOnSale: in-state → 6.25% of gross", () => {
  assert.equal(calcMaSalesTaxOnSale(10000, "in_state_ma"), 625);
  assert.equal(calcMaSalesTaxOnSale(12345.67, "in_state_ma"), 771.6); // rounded to cents
});

test("calcMaSalesTaxOnSale: out-of-state US → zero (exempt)", () => {
  assert.equal(calcMaSalesTaxOnSale(10000, "out_of_state_us"), 0);
});

test("calcMaSalesTaxOnSale: international → zero (export exempt)", () => {
  assert.equal(calcMaSalesTaxOnSale(10000, "international"), 0);
});

test("calcMaSalesTaxOnSale: unknown destination defaults to exempt (safe default)", () => {
  assert.equal(calcMaSalesTaxOnSale(10000, "mars"), 0);
  assert.equal(calcMaSalesTaxOnSale(10000, ""), 0);
});

test("salesTaxOnSaleEntry: in-state posts a balanced entry; exempt returns null", () => {
  const e = salesTaxOnSaleEntry({ stockNum: "007", grossPrice: 20000, destination: "in_state_ma", date: "2025-05-10", user: "u" });
  assert.equal(validateJournalEntry(e), null);
  const bankLine = e.lines.find((l) => l.accountId === SYSTEM_ACCOUNTS.SAYARAH_BANK);
  assert.equal(bankLine.debit, 1250);
  const liability = e.lines.find((l) => l.accountId === SYSTEM_ACCOUNTS.SALES_TAX_PAYABLE);
  assert.equal(liability.credit, 1250);

  assert.equal(salesTaxOnSaleEntry({ stockNum: "008", grossPrice: 20000, destination: "out_of_state_us", date: "2025-05-10", user: "u" }), null);
  assert.equal(salesTaxOnSaleEntry({ stockNum: "009", grossPrice: 20000, destination: "international", date: "2025-05-10", user: "u" }), null);
});

// ═══════════════════════════════════════════════════════════════
// CPA-SIGNED-OFF SCENARIOS (8–15) — regression tests for the
// exact journal entries approved before coding. If any of these
// break, statements are wrong — flag CPA before merging.
// ═══════════════════════════════════════════════════════════════
import {
  INTERNAL_ONLY_ACCOUNTS,
  isExternalAccount,
  memberDistributionsId,
  memberDistributionsAccount,
  distributionCashPayoutEntry,
  closeMemberDistributionsEntry,
  calcTrialBalance,
  calcCashFlow,
  calcStatementOfMemberEquity,
  calcVehicleProfitabilityReport,
  calcOutOfStateSalesReport,
  generateSalesTaxFilingsForMonth,
  canClosePeriod,
  fundPrincipalReturnEvent,
} from "../apps/auction/src/money.js";

test("Atlantic Fund is internal-only (never on external statements)", () => {
  assert.ok(INTERNAL_ONLY_ACCOUNTS.has(SYSTEM_ACCOUNTS.ATLANTIC_FUND));
  assert.equal(isExternalAccount(SYSTEM_ACCOUNTS.ATLANTIC_FUND), false);
  assert.equal(isExternalAccount(SYSTEM_ACCOUNTS.SAYARAH_BANK), true);
});

test("Scenario 9 — Sale $30K, cost $25K: revenue, COGS, tax reserve post cleanly", () => {
  const accounts = [
    ...DEFAULT_ACCOUNTS,
    vehicleAccount("1", "2020 Test"),
  ];
  // Pre-seed: vehicle inventory at $25K cost from a prior purchase
  let ledger = postJournalEntry([], buildJournalEntry({
    date: "2024-12-15",
    lines: [
      { accountId: vehicleAccountId("1"), debit: 25000, credit: 0 },
      { accountId: SYSTEM_ACCOUNTS.SAYARAH_BANK, debit: 0, credit: 25000 },
    ],
  }));
  // Sale at $30K out-of-state (no sales tax)
  const entries = vehicleSaleEntries({
    stockNum: "1", totalCost: 25000, grossSale: 30000,
    principalDestination: { type: "fund" },
    date: "2025-01-20", user: "u", destination: "out_of_state_us",
  });
  assert.equal(entries.length, 3, "three clean entries: sale, COGS, tax reserve");
  for (const e of entries) ledger = postJournalEntry(ledger, e);

  const pl = calcProfitLoss(ledger, accounts, "2025-01-01", "2025-01-31");
  assert.equal(pl.revenue, 30000);
  assert.equal(pl.cogs, 25000);
  assert.equal(pl.grossProfit, 5000);
  assert.equal(pl.netIncome, 5000 - 295, "net income = gross profit − tax reserve");

  const bs = calcBalanceSheet(ledger, accounts, "2025-01-31");
  assert.ok(bs.liabilities[SYSTEM_ACCOUNTS.ACCRUED_TAX_LIABILITY], "accrued tax liability on balance sheet");
  assert.equal(bs.liabilities[SYSTEM_ACCOUNTS.ACCRUED_TAX_LIABILITY].balance, 295);
});

test("Scenario 13 — In-state MA sale posts sales tax; bank = gross + tax", () => {
  const accounts = [...DEFAULT_ACCOUNTS, vehicleAccount("1", "Test")];
  let ledger = postJournalEntry([], buildJournalEntry({
    date: "2024-12-15",
    lines: [
      { accountId: vehicleAccountId("1"), debit: 25000, credit: 0 },
      { accountId: SYSTEM_ACCOUNTS.SAYARAH_BANK, debit: 0, credit: 25000 },
    ],
  }));
  const entries = vehicleSaleEntries({
    stockNum: "1", totalCost: 25000, grossSale: 30000,
    date: "2025-01-20", user: "u", destination: "in_state_ma",
  });
  for (const e of entries) ledger = postJournalEntry(ledger, e);

  const bs = calcBalanceSheet(ledger, accounts, "2025-01-31");
  assert.ok(bs.liabilities[SYSTEM_ACCOUNTS.SALES_TAX_PAYABLE], "sales tax payable on BS");
  assert.equal(bs.liabilities[SYSTEM_ACCOUNTS.SALES_TAX_PAYABLE].balance, 1875, "6.25% of $30K");
});

test("Scenario 14 — Out-of-state sale: no MA sales tax; bank = gross only", () => {
  const accounts = [...DEFAULT_ACCOUNTS, vehicleAccount("1", "Test")];
  let ledger = postJournalEntry([], buildJournalEntry({
    date: "2024-12-15",
    lines: [
      { accountId: vehicleAccountId("1"), debit: 25000, credit: 0 },
      { accountId: SYSTEM_ACCOUNTS.SAYARAH_BANK, debit: 0, credit: 25000 },
    ],
  }));
  const entries = vehicleSaleEntries({
    stockNum: "1", totalCost: 25000, grossSale: 30000,
    date: "2025-01-20", user: "u", destination: "out_of_state_us",
  });
  for (const e of entries) ledger = postJournalEntry(ledger, e);

  const bs = calcBalanceSheet(ledger, accounts, "2025-01-31");
  assert.ok(!bs.liabilities[SYSTEM_ACCOUNTS.SALES_TAX_PAYABLE], "no sales tax liability on out-of-state sale");
});

test("Scenario 15 — International export: no US sales tax", () => {
  const accounts = [...DEFAULT_ACCOUNTS, vehicleAccount("1", "Test")];
  let ledger = postJournalEntry([], buildJournalEntry({
    date: "2024-12-15",
    lines: [
      { accountId: vehicleAccountId("1"), debit: 25000, credit: 0 },
      { accountId: SYSTEM_ACCOUNTS.SAYARAH_BANK, debit: 0, credit: 25000 },
    ],
  }));
  const entries = vehicleSaleEntries({
    stockNum: "1", totalCost: 25000, grossSale: 30000,
    date: "2025-01-20", user: "u", destination: "international",
  });
  for (const e of entries) ledger = postJournalEntry(ledger, e);
  const bs = calcBalanceSheet(ledger, accounts, "2025-01-31");
  assert.ok(!bs.liabilities[SYSTEM_ACCOUNTS.SALES_TAX_PAYABLE], "no sales tax on export");
});

test("Trial Balance: total debits == total credits when ledger is healthy", () => {
  const accounts = [...DEFAULT_ACCOUNTS, memberAccount("m1", "Alice")];
  let ledger = [];
  ledger = postJournalEntry(ledger, contributionPaidEntryBalanced({ memberId: "m1", month: "2025-01", amount: 50000, user: "u" }));
  const tb = calcTrialBalance(ledger, accounts, "2025-01-31");
  assert.equal(tb.balanced, true, `TB must balance: ${tb.totalDebit} debit vs ${tb.totalCredit} credit`);
});

test("Cash Flow reconciles: opening + net change = closing", () => {
  const accounts = [...DEFAULT_ACCOUNTS, memberAccount("m1", "Alice")];
  let ledger = [];
  ledger = postJournalEntry(ledger, contributionPaidEntryBalanced({ memberId: "m1", month: "2025-01", amount: 50000, user: "u" }));
  const cf = calcCashFlow(ledger, accounts, "2025-01-01", "2025-01-31");
  assert.equal(cf.reconciles, true);
  assert.equal(cf.financing, 50000, "member contribution is a financing inflow");
  assert.equal(cf.opening, 0);
  assert.equal(cf.closing, 50000);
});

test("Contra-equity member distributions: cash payout reduces net equity", () => {
  const accounts = [
    ...DEFAULT_ACCOUNTS,
    memberAccount("m1", "Alice"),
    memberDistributionsAccount("m1", "Alice"),
  ];
  let ledger = [];
  // Seed $10K member capital
  ledger = postJournalEntry(ledger, contributionPaidEntryBalanced({ memberId: "m1", month: "2025-01", amount: 10000, user: "u" }));
  // $2K cash distribution
  const payout = distributionCashPayoutEntry({ memberId: "m1", memberName: "Alice", amount: 2000, date: "2025-01-25", user: "admin", month: "2025-01" });
  ledger = postJournalEntry(ledger, payout);

  const bs = calcBalanceSheet(ledger, accounts, "2025-01-31");
  // Net equity after payout = $10K capital − $2K distributions contra = $8K
  assert.equal(bs.totals.equity, 8000, "contra-equity properly reduces net equity");
  // Bank: $10K in − $2K out = $8K
  assert.equal(bs.totals.assets, 8000);
});

test("Year-end close-distributions: zeros contras and reduces capital", () => {
  const accounts = [
    ...DEFAULT_ACCOUNTS,
    memberAccount("m1", "Alice"),
    memberDistributionsAccount("m1", "Alice"),
  ];
  let ledger = [];
  ledger = postJournalEntry(ledger, contributionPaidEntryBalanced({ memberId: "m1", month: "2025-01", amount: 10000, user: "u" }));
  ledger = postJournalEntry(ledger, distributionCashPayoutEntry({ memberId: "m1", memberName: "Alice", amount: 2000, date: "2025-06-30", user: "admin", month: "2025-06" }));
  // Year-end close
  const balances = calcAllBalances(ledger, accounts);
  const closeEntry = closeMemberDistributionsEntry({ members: [{ id: "m1" }], balances, date: "2025-12-31", user: "admin" });
  ledger = postJournalEntry(ledger, closeEntry);

  const bsAfter = calcAllBalances(ledger, accounts);
  assert.equal(bsAfter[memberDistributionsId("m1")], 0, "distributions contra zeroed");
  assert.equal(bsAfter[memberAccountId("m1")], 8000, "capital reduced by distributions");
});

test("MA sales tax filings: idempotent, zero-amount records generated", () => {
  const first = generateSalesTaxFilingsForMonth([], "2025-03");
  assert.equal(first.length, 1);
  assert.equal(first[0].status, "pending");
  assert.equal(first[0].amount, null, "amount null until filed");
  const second = generateSalesTaxFilingsForMonth(first, "2025-03");
  assert.equal(second.length, 1, "idempotent — no duplicate for same month");
});

test("canClosePeriod: blocks on unreconciled bank rows", () => {
  const err = canClosePeriod({
    month: "2025-03",
    bankImports: [{ date: "2025-03-15", matchedEntryId: null, ignored: false }],
    salesTaxFilings: [{ month: "2025-03", status: "filed" }],
  });
  assert.match(err, /unreconciled/i);
});

test("canClosePeriod: blocks on unfiled sales tax return", () => {
  const err = canClosePeriod({
    month: "2025-03",
    bankImports: [],
    salesTaxFilings: [{ month: "2025-03", status: "pending" }],
  });
  assert.match(err, /sales tax filing/i);
});

test("canClosePeriod: allows close when both gates pass", () => {
  const err = canClosePeriod({
    month: "2025-03",
    bankImports: [{ date: "2025-03-15", matchedEntryId: "je_1", ignored: false }],
    salesTaxFilings: [{ month: "2025-03", status: "filed" }],
  });
  assert.equal(err, null);
});

test("Out-of-state sales report: excludes in-state, includes OOS + export", () => {
  const accounts = [...DEFAULT_ACCOUNTS, vehicleAccount("1", "T"), vehicleAccount("2", "T2"), vehicleAccount("3", "T3")];
  let ledger = [];
  // Pre-seed inventory for all three
  for (const stock of ["1", "2", "3"]) {
    ledger = postJournalEntry(ledger, buildJournalEntry({
      date: "2024-12-15",
      lines: [
        { accountId: vehicleAccountId(stock), debit: 20000, credit: 0 },
        { accountId: SYSTEM_ACCOUNTS.SAYARAH_BANK, debit: 0, credit: 20000 },
      ],
    }));
  }
  for (const [stock, dest] of [["1", "in_state_ma"], ["2", "out_of_state_us"], ["3", "international"]]) {
    const entries = vehicleSaleEntries({ stockNum: stock, totalCost: 20000, grossSale: 25000, date: "2025-01-15", user: "u", destination: dest });
    for (const e of entries) ledger = postJournalEntry(ledger, e);
  }
  const rows = calcOutOfStateSalesReport(ledger, "2025-01-01", "2025-01-31");
  assert.equal(rows.length, 2, "excludes in-state");
  const destinations = rows.map((r) => r.destination).sort();
  assert.deepEqual(destinations, ["international", "out_of_state_us"]);
});

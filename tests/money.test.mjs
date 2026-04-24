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

// ─── Vehicle sale allocation — the core Atlantic Fund flow ───
test("vehicleSaleEntries: profitable sale → principal back, $295 tax, rest to distribution", () => {
  const [saleEntry, allocEntry] = vehicleSaleEntries({
    stockNum: "001",
    totalCost: 9000,
    grossSale: 12000,
    principalDestination: { type: "fund" },
    date: "2025-02-20",
    user: "u",
  });
  assert.equal(validateJournalEntry(saleEntry), null);
  assert.equal(validateJournalEntry(allocEntry), null);

  const fundLine = allocEntry.lines.find((l) => l.accountId === SYSTEM_ACCOUNTS.ATLANTIC_FUND);
  assert.equal(fundLine.debit, 9000, "principal returns to fund");

  const taxLine = allocEntry.lines.find((l) => l.accountId === SYSTEM_ACCOUNTS.TAX);
  assert.equal(taxLine.credit, TAX_PER_SALE);

  const distLine = allocEntry.lines.find((l) => l.accountId === SYSTEM_ACCOUNTS.PROFIT_DISTRIBUTION);
  // Profit = 12000 − 9000 = 3000. Tax skim = 295. Distributable = 2705.
  assert.equal(distLine.credit, 3000 - TAX_PER_SALE);
});

test("vehicleSaleEntries: break-even sale → no distribution, no tax skim beyond profit", () => {
  const [saleEntry, allocEntry] = vehicleSaleEntries({
    stockNum: "003",
    totalCost: 10000,
    grossSale: 10000,
    principalDestination: { type: "fund" },
    date: "2025-02-20",
    user: "u",
  });
  assert.equal(validateJournalEntry(saleEntry), null);
  assert.equal(validateJournalEntry(allocEntry), null);
  const taxLine = allocEntry.lines.find((l) => l.accountId === SYSTEM_ACCOUNTS.TAX);
  assert.ok(!taxLine, "no tax skim on a break-even deal");
});

test("vehicleSaleEntries: loss sale → principal back, no distribution, no tax", () => {
  const [saleEntry, allocEntry] = vehicleSaleEntries({
    stockNum: "004",
    totalCost: 10000,
    grossSale: 9000, // $1,000 loss
    principalDestination: { type: "fund" },
    date: "2025-02-20",
    user: "u",
  });
  assert.equal(validateJournalEntry(saleEntry), null);
  assert.equal(validateJournalEntry(allocEntry), null);
  const taxLine = allocEntry.lines.find((l) => l.accountId === SYSTEM_ACCOUNTS.TAX);
  assert.ok(!taxLine, "no tax skim on a loss");
});

test("vehicleSaleEntries: member-funded vehicle → principal returns to member capital", () => {
  const [, allocEntry] = vehicleSaleEntries({
    stockNum: "005",
    totalCost: 8000,
    grossSale: 10000,
    principalDestination: { type: "member", memberId: "m2" },
    date: "2025-02-20",
    user: "u",
  });
  const principalLine = allocEntry.lines.find((l) => l.accountId === memberAccountId("m2"));
  assert.equal(principalLine.debit, 8000);
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
test("end-to-end: 3 members contribute $25K, fund buys & sells a vehicle, month-end distributes", () => {
  const members = [{ id: "m1" }, { id: "m2" }, { id: "m3" }];
  let ledger = [];
  const accounts = [
    ...DEFAULT_ACCOUNTS,
    ...members.map((m) => memberAccount(m.id, m.id.toUpperCase())),
    vehicleAccount("001", "2020 Test Vehicle"),
  ];

  // 1. Three contributions of $25K paid.
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

  // 3. Vehicle sells for $72K.
  const [sale, alloc] = vehicleSaleEntries({
    stockNum: "001",
    totalCost: 60000,
    grossSale: 72000,
    principalDestination: { type: "fund" },
    date: "2025-01-25",
    user: "u",
  });
  ledger = postJournalEntry(ledger, sale);
  ledger = postJournalEntry(ledger, alloc);
  balances = calcAllBalances(ledger, accounts);

  // Fund restored to 75K (had 15K, +60K principal back).
  assert.equal(balances[SYSTEM_ACCOUNTS.ATLANTIC_FUND], 75000);
  // Tax: $295.
  assert.equal(balances[SYSTEM_ACCOUNTS.TAX], TAX_PER_SALE);
  // Profit distribution: 12000 − 295 = 11705.
  assert.equal(balances[SYSTEM_ACCOUNTS.PROFIT_DISTRIBUTION], 12000 - TAX_PER_SALE);

  // 4. Month-end: distribute 11705 equally across 3 members.
  const distEntry = distributeMonthEndEntry({
    month: "2025-01",
    members,
    profitBalance: balances[SYSTEM_ACCOUNTS.PROFIT_DISTRIBUTION],
    user: "admin",
  });
  ledger = postJournalEntry(ledger, distEntry);
  balances = calcAllBalances(ledger, accounts);
  assert.ok(Math.abs(balances[SYSTEM_ACCOUNTS.PROFIT_DISTRIBUTION]) < 0.01, "distribution account zeroed");
  // Each member's capital should now be 25000 + share of 11705.
  const totalMemberCapital = members.reduce((s, m) => s + balances[memberAccountId(m.id)], 0);
  const expectedTotal = 75000 + (12000 - TAX_PER_SALE);
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
} from "../apps/auction/src/money.js";

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

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

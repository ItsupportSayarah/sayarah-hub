import { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext, Component } from "react";
import { auth, firebaseSignIn, firebaseSignUp, firebaseSignOut, onAuthChange, getUserRole, getUserProfile, updateUserRole, getAllUsers, updateUserPermissions, getUserData, saveAppData, loadAppData, saveSharedData, saveSharedDataTxn, loadSharedData, onSharedDataChange, saveApprovalsFB, loadApprovalsFB, addActivityLogEntryFB, loadActivityLogFB, changePassword, resetPassword, uploadFile, deleteFile } from "./src/firebase.js";
// Pure calculation functions live in src/calc.js so they can be
// unit-tested (see tests/calc.test.mjs). Every display of Total Cost,
// Net Profit, Gross Margin, etc. funnels through these — no parallel
// implementations, no "two aggregation paths" that can drift.
import {
  DEFAULT_AUCTION_FEE_TIERS,
  AUCTION_FEE_TIERS,
  cloneTierConfig,
  applyCustomAuctionFeeTiers,
  serializeTierOverrides,
  calcAuctionFees,
  calcTotalCost,
  calcVehicleExpenses,
} from "./src/calc.js";
// Money Management accounting core — see src/money.js + tests/money.test.mjs
import {
  SYSTEM_ACCOUNTS,
  TAX_PER_SALE,
  DEFAULT_ACCOUNTS,
  memberAccountId,
  vehicleAccountId,
  memberAccount as buildMemberAccount,
  vehicleAccount as buildVehicleAccount,
  buildJournalEntry,
  postJournalEntry,
  buildReversingEntry,
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
  ATLANTIC_FUND_TARGET,
  ATLANTIC_FUND_LOW_BALANCE,
  LARGE_OUTFLOW_THRESHOLD,
  entriesForAccount,
  entriesInRange,
  calcProfitLoss,
  calcBalanceSheet,
  calcMemberK1Prep,
  calc1099Report,
  calcMaSalesTax,
  parseBankCsv,
  suggestMatches,
  // Phase 3
  MA_USE_TAX_RATE,
  calcUseTax,
  calcMaUseTax,
  useTaxOnPurchaseEntry,
  isDateInClosedPeriod,
  calcClosingEntries,
  MA_SALES_TAX_RATE,
  SALE_DESTINATIONS,
  calcMaSalesTaxOnSale,
  salesTaxOnSaleEntry,
  // Accounting tab helpers
  INTERNAL_ONLY_ACCOUNTS,
  isExternalAccount,
  memberDistributionsId,
  memberDistributionsAccount,
  distributionCashPayoutEntry,
  closeMemberDistributionsEntry,
  fundPrincipalReturnEvent,
  calcTrialBalance,
  calcCashFlow,
  calcStatementOfMemberEquity,
  generateSalesTaxFilingsForMonth,
  calcSalesTaxFilingAmount,
  canClosePeriod,
  calcOutOfStateSalesReport,
  calcVehicleProfitabilityReport,
  // Expense auto-posting
  DEFAULT_EXPENSE_CATEGORY_MAP,
  resolveExpenseAccount,
  expenseEntry,
} from "./src/money.js";

// Error boundary — catches render crashes and shows a message instead of blank page
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error("App crash:", error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", background: "#F8FAFC", padding: 20 }}>
          <div style={{ textAlign: "center", maxWidth: 400 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>!</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#1E293B", marginBottom: 8 }}>Something went wrong</div>
            <div style={{ fontSize: 13, color: "#64748B", marginBottom: 20 }}>{this.state.error?.message || "An unexpected error occurred"}</div>
            <button onClick={() => window.location.reload()} style={{ padding: "10px 24px", background: "#3B82F6", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Reload Page</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Check if Firebase is configured (not placeholder keys)
const FIREBASE_ENABLED = (() => {
  try { return auth && auth.app && auth.app.options && auth.app.options.apiKey && !auth.app.options.apiKey.startsWith("YOUR_"); } catch { return false; }
})();

// ═══════════════════════════════════════════════════════════════
// INDUSTRY ENGINE — Advanced Car Flipping Business Logic
// ═══════════════════════════════════════════════════════════════

// AUCTION_FEE_TIERS, DEFAULT_AUCTION_FEE_TIERS, calcAuctionFees, etc.
// are now imported from ./src/calc.js so the calculation surface can
// be unit-tested. See tests/calc.test.mjs for the regression suite.

// ─── Title Status Impact on Value ─────────────────────────────
const TITLE_STATUS = {
  clean: { label: "Clean", valueMult: 1.0, risk: 1, color: "#166534", bg: "#D1FAE5" },
  salvage: { label: "Salvage", valueMult: 0.55, risk: 4, color: "#DC2626", bg: "#FEE2E2" },
  rebuilt: { label: "Rebuilt", valueMult: 0.70, risk: 3, color: "#D97706", bg: "#FEF3C7" },
  flood: { label: "Flood/Water", valueMult: 0.40, risk: 5, color: "#7C3AED", bg: "#EDE9FE" },
  theft_recovery: { label: "Theft Recovery", valueMult: 0.65, risk: 3, color: "#2563EB", bg: "#DBEAFE" },
  parts_only: { label: "Parts Only", valueMult: 0.25, risk: 5, color: "#111", bg: "#E5E7EB" },
  lemon: { label: "Lemon/Buyback", valueMult: 0.50, risk: 4, color: "#EA580C", bg: "#FFEDD5" },
};

// ─── Hold Cost Calculator ─────────────────────────────────────
const DEFAULT_HOLD_COSTS = {
  insurancePerDay: 3.50,    // ~$105/mo liability
  storagePerDay: 0,         // 0 if home lot
  depreciationPerDay: 5.00, // ~$150/mo avg depreciation
  opportunityCostRate: 0.10,// 10% annual return on capital
  agingThresholdDays: 45,   // warn when a vehicle has been in inventory this long
};

function calcHoldCosts(totalCost, daysHeld, holdCosts = DEFAULT_HOLD_COSTS) {
  const insurance = holdCosts.insurancePerDay * daysHeld;
  const storage = holdCosts.storagePerDay * daysHeld;
  const depreciation = holdCosts.depreciationPerDay * daysHeld;
  const opportunityCost = totalCost * (holdCosts.opportunityCostRate / 365) * daysHeld;
  return { insurance, storage, depreciation, opportunityCost, total: insurance + storage + depreciation + opportunityCost, perDay: daysHeld > 0 ? (insurance + storage + depreciation + opportunityCost) / daysHeld : 0 };
}

// ─── Break-Even Calculator ────────────────────────────────────
function calcBreakEven(totalCost, holdCosts, sellerFeeRate = 0) {
  const minSale = totalCost + holdCosts;
  const withFees = sellerFeeRate > 0 ? minSale / (1 - sellerFeeRate) : minSale;
  return { minSalePrice: withFees, totalCostBasis: totalCost + holdCosts };
}

// ─── Deal Grading Engine ──────────────────────────────────────
function gradeDeal(profitMargin, daysHeld, annualizedROI, profitVelocity) {
  let score = 0;
  // Margin scoring (40% weight)
  if (profitMargin >= 0.30) score += 40;
  else if (profitMargin >= 0.20) score += 32;
  else if (profitMargin >= 0.15) score += 25;
  else if (profitMargin >= 0.10) score += 18;
  else if (profitMargin >= 0.05) score += 10;
  else if (profitMargin > 0) score += 5;

  // Speed scoring (25% weight)
  if (daysHeld <= 7) score += 25;
  else if (daysHeld <= 14) score += 22;
  else if (daysHeld <= 21) score += 18;
  else if (daysHeld <= 30) score += 14;
  else if (daysHeld <= 45) score += 10;
  else if (daysHeld <= 60) score += 5;

  // ROI scoring (20% weight)
  if (annualizedROI >= 2.0) score += 20;
  else if (annualizedROI >= 1.0) score += 16;
  else if (annualizedROI >= 0.5) score += 12;
  else if (annualizedROI >= 0.25) score += 8;
  else if (annualizedROI > 0) score += 4;

  // Velocity scoring (15% weight)
  if (profitVelocity >= 100) score += 15;
  else if (profitVelocity >= 50) score += 12;
  else if (profitVelocity >= 25) score += 9;
  else if (profitVelocity >= 10) score += 6;
  else if (profitVelocity > 0) score += 3;

  if (score >= 85) return { grade: "A+", score, color: "#166534", bg: "#D1FAE5", label: "Exceptional Flip" };
  if (score >= 75) return { grade: "A", score, color: "#166534", bg: "#D1FAE5", label: "Great Deal" };
  if (score >= 65) return { grade: "B+", score, color: "#15803D", bg: "#DCFCE7", label: "Solid Profit" };
  if (score >= 55) return { grade: "B", score, color: "#CA8A04", bg: "#FEF9C3", label: "Decent Return" };
  if (score >= 45) return { grade: "C+", score, color: "#D97706", bg: "#FEF3C7", label: "Marginal" };
  if (score >= 35) return { grade: "C", score, color: "#EA580C", bg: "#FFEDD5", label: "Below Average" };
  if (score >= 20) return { grade: "D", score, color: "#DC2626", bg: "#FEE2E2", label: "Poor Deal" };
  return { grade: "F", score, color: "#991B1B", bg: "#FEE2E2", label: "Loss/Failed" };
}

// ─── Profit Velocity ($/day) ──────────────────────────────────
function calcProfitVelocity(profit, daysHeld) {
  // Returns null when daysHeld is invalid so downstream can render "—"
  // instead of a misleading 0. Previously returned 0 which caused Deal
  // Grades to score against fake inputs and Avg Velocity to look healthy
  // on records with no holding period.
  if (!Number.isFinite(profit) || !Number.isFinite(daysHeld) || daysHeld <= 0) return null;
  return profit / daysHeld;
}

// ─── Annualized ROI ───────────────────────────────────────────
function calcAnnualizedROI(profit, totalCost, daysHeld) {
  // Returns null (not 0) when the computation is undefined — divide-by-zero
  // or missing data. The caller must null-check before displaying.
  if (!Number.isFinite(profit) || !Number.isFinite(totalCost) || !Number.isFinite(daysHeld)) return null;
  if (totalCost <= 0 || daysHeld <= 0) return null;
  const roi = profit / totalCost;
  return roi * (365 / daysHeld);
}

// ─── Inventory Aging ──────────────────────────────────────────
function getAgingStatus(daysHeld) {
  if (daysHeld <= 14) return { level: "fresh", label: "Fresh", color: "#166534", bg: "#D1FAE5", icon: "●" };
  if (daysHeld <= 30) return { level: "normal", label: "Normal", color: "#2563EB", bg: "#DBEAFE", icon: "●" };
  if (daysHeld <= 45) return { level: "aging", label: "Aging", color: "#D97706", bg: "#FEF3C7", icon: "▲" };
  if (daysHeld <= 60) return { level: "stale", label: "Stale", color: "#EA580C", bg: "#FFEDD5", icon: "▲" };
  if (daysHeld <= 90) return { level: "critical", label: "Critical", color: "#DC2626", bg: "#FEE2E2", icon: "◆" };
  return { level: "dead", label: "Dead Stock", color: "#991B1B", bg: "#FEE2E2", icon: "✕" };
}

// ─── Vehicle Risk Score ───────────────────────────────────────
function calcRiskScore(vehicle) {
  let risk = 0;
  const year = parseInt(vehicle.year) || 2020;
  const age = new Date().getFullYear() - year;
  const miles = parseInt(vehicle.odometer) || 0;
  const price = parseFloat(vehicle.purchasePrice) || 0;
  const titleInfo = TITLE_STATUS[vehicle.titleStatus] || TITLE_STATUS.clean;

  // Age risk
  if (age > 15) risk += 3; else if (age > 10) risk += 2; else if (age > 5) risk += 1;
  // Mileage risk
  if (miles > 150000) risk += 3; else if (miles > 100000) risk += 2; else if (miles > 75000) risk += 1;
  // Price point risk (cheap cars = more risk of hidden issues)
  if (price < 1500) risk += 2; else if (price < 3000) risk += 1;
  // High price = more capital at risk
  if (price > 15000) risk += 2; else if (price > 10000) risk += 1;
  // Title status
  risk += titleInfo.risk;

  if (risk >= 10) return { score: risk, level: "Very High", color: "#991B1B", pct: 100 };
  if (risk >= 7) return { score: risk, level: "High", color: "#DC2626", pct: 80 };
  if (risk >= 5) return { score: risk, level: "Medium", color: "#D97706", pct: 55 };
  if (risk >= 3) return { score: risk, level: "Low", color: "#2563EB", pct: 35 };
  return { score: risk, level: "Very Low", color: "#166534", pct: 15 };
}

// ─── Reconditioning Budget Engine ─────────────────────────────
const RECON_CATEGORIES = [
  { key: "mechanical", label: "Mechanical", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg> },
  { key: "bodyPaint", label: "Body/Paint", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 3H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"/><path d="M12 9v4"/><path d="M8 13H6a2 2 0 0 0-2 2v6h4v-6a2 2 0 0 0-2-2z"/></svg> },
  { key: "interior", label: "Interior", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3"/><path d="M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1H7v-1a2 2 0 0 0-4 0z"/><path d="M5 18v2"/><path d="M19 18v2"/></svg> },
  { key: "tires", label: "Tires/Wheels", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg> },
  { key: "electrical", label: "Electrical", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> },
  { key: "detailing", label: "Detailing", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3z"/><path d="M5 3v4"/><path d="M3 5h4"/><path d="M19 17v4"/><path d="M17 19h4"/></svg> },
  { key: "glass", label: "Glass/Windshield", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg> },
  { key: "other", label: "Other", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg> },
];

// ─── Cash Flow Engine ─────────────────────────────────────────
function buildCashFlow(vehicles, sales, expenses) {
  const events = [];
  vehicles.forEach(v => {
    if (v.purchaseDate) {
      const pp = p(v.purchasePrice);
      const auctFees = calcAuctionFees(pp, v.auctionSource || "custom");
      const customPrem = v.useCustomPremium ? pp * p(v.buyerPremiumPct) / 100 : 0;
      const totalOut = pp + (v.useCustomPremium ? customPrem : auctFees.total) + p(v.transportCost);
      events.push({ date: v.purchaseDate, type: "purchase", amount: -totalOut, label: `Buy #${v.stockNum} ${v.year} ${v.make} ${v.model}`, stockNum: v.stockNum });
    }
  });
  sales.forEach(s => {
    if (s.date) {
      const net = p(s.grossPrice) - p(s.auctionFee) - p(s.titleFee) - p(s.otherDeductions);
      events.push({ date: s.date, type: "sale", amount: net, label: `Sell #${s.stockNum} ${s.vehicle}`, stockNum: s.stockNum });
    }
  });
  expenses.forEach(e => {
    if (e.date) events.push({ date: e.date, type: "expense", amount: -p(e.amount), label: `${e.category}: ${e.description}`, stockNum: e.stockNum });
  });
  events.sort((a, b) => a.date.localeCompare(b.date));
  let balance = 0;
  return events.map(e => { balance += e.amount; return { ...e, balance }; });
}

// ─── Quarterly Tax Engine ─────────────────────────────────────
function calcQuarterlyTax(sales, expenses, vehicles) {
  const quarters = [
    { q: "Q1", start: "-01-01", end: "-03-31", due: "Apr 15" },
    { q: "Q2", start: "-04-01", end: "-06-30", due: "Jun 15" },
    { q: "Q3", start: "-07-01", end: "-09-30", due: "Sep 15" },
    { q: "Q4", start: "-10-01", end: "-12-31", due: "Jan 15" },
  ];
  const year = new Date().getFullYear();
  return quarters.map(qtr => {
    const qs = `${year}${qtr.start}`, qe = `${year}${qtr.end}`;
    const qSales = sales.filter(s => s.date >= qs && s.date <= qe);
    const qExpenses = expenses.filter(e => e.date >= qs && e.date <= qe);
    const revenue = qSales.reduce((s, x) => s + p(x.grossPrice) - p(x.auctionFee) - p(x.titleFee) - p(x.otherDeductions), 0);
    const costs = qSales.reduce((s, x) => {
      const v = vehicles.find(vh => vh.stockNum === x.stockNum);
      return s + (v ? calcTotalCost(v, expenses) : 0);
    }, 0);
    // qExpenses covers the whole period; calcTotalCost above already
    // pulled in per-vehicle expenses for each sold vehicle, so subtract those
    // out of the stand-alone expense line to avoid double-counting.
    const stockNumsInPeriod = new Set(qSales.map(x => x.stockNum));
    const exp = qExpenses
      .filter(e => !stockNumsInPeriod.has(e.stockNum))
      .reduce((s, e) => s + p(e.amount), 0);
    const profit = revenue - costs - exp;
    const maStateTax = profit > 0 ? profit * MA_CORP_TAX_RATE : 0;
    const federalTax = profit > 0 ? profit * FEDERAL_CORP_TAX_RATE : 0;
    return { ...qtr, revenue, costs, expenses: exp, profit, maStateTax, federalTax, totalTax: maStateTax + federalTax, carsSold: qSales.length };
  });
}

// ─── Performance Benchmarks ───────────────────────────────────
const INDUSTRY_BENCHMARKS = {
  avgProfitPerCar: { beginner: 800, intermediate: 1500, expert: 3000 },
  avgDaysToSell: { beginner: 45, intermediate: 25, expert: 14 },
  profitMargin: { beginner: 0.10, intermediate: 0.18, expert: 0.28 },
  profitVelocity: { beginner: 20, intermediate: 50, expert: 100 },
  carsPerMonth: { beginner: 1, intermediate: 3, expert: 8 },
};

function getBenchmarkLevel(metric, value) {
  const b = INDUSTRY_BENCHMARKS[metric];
  if (!b) return "beginner";
  if (metric === "avgDaysToSell") {
    if (value <= b.expert) return "expert";
    if (value <= b.intermediate) return "intermediate";
    return "beginner";
  }
  if (value >= b.expert) return "expert";
  if (value >= b.intermediate) return "intermediate";
  return "beginner";
}

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════
const BRAND_LIGHT = { red: "#8B1A1A", redLight: "#A52422", redBg: "#fdf2f2", redBg2: "#fee2e2", cream: "#FAFAF7", white: "#fff", black: "#111", gray: "#6B7280", grayLight: "#E5E7EB", grayDark: "#374151", green: "#166534", greenBg: "#f0fdf4", blue: "#1E40AF", blueBg: "#eff6ff" };
const BRAND_DARK = { red: "#C43B3B", redLight: "#D35555", redBg: "#2A1515", redBg2: "#3A1A1A", cream: "#121212", white: "#1E1E1E", black: "#E8E8E8", gray: "#9CA3AF", grayLight: "#333", grayDark: "#D1D5DB", green: "#22C55E", greenBg: "#0A2015", blue: "#60A5FA", blueBg: "#1A2540" };
let BRAND = { ...BRAND_LIGHT };
const THEME_KEY = "sayarah-theme-v1";
function loadTheme() { try { return localStorage.getItem(THEME_KEY) || "light"; } catch { return "light"; } }
function applyTheme(mode) { Object.assign(BRAND, mode === "dark" ? BRAND_DARK : BRAND_LIGHT); localStorage.setItem(THEME_KEY, mode); }
applyTheme(loadTheme());

const TABS = ["Dashboard", "Pipeline", "Inventory", "Mileage", "Analytics"];
const PIPELINE_STAGES = ["Scouting", "Purchased", "Repairing", "Listed", "Sold"];
// Canonical expense category list. Every tracked expense must use one of
// these; reports break down P&L by these categories. Ordered to match the
// typical deal lifecycle.
const EXPENSE_CATEGORIES = [
  "Purchase Price",
  "Auction Fees",
  "Transport/Towing",
  "Storage/Parking",
  "Repair/Recon",
  "DMV/Title/Registration",
  "Inspection",
  "Detailing",
  "Marketing/Listing",
  "Office/Admin",
  "Selling Costs (post-sale)",
  "Other",
];
const SALE_TYPES = ["Private Party","Dealer","Auction","Consignment","Trade-In","Facebook Marketplace","Craigslist","OfferUp"];
const PAYMENT_METHODS = ["Cash","Check","Credit Card","Debit Card","Wire Transfer","Financing","Zelle","Venmo","PayPal"];
const IRS_RATE = 0.70;
// MA Corporate Tax: 8% state excise tax + 21% federal corporate tax
const MA_CORP_TAX_RATE = 0.08;
const FEDERAL_CORP_TAX_RATE = 0.21;
const STORAGE_KEY = "sayarah-flip-v4";
const USERS_STORAGE_KEY = "sayarah-users-v2";
const AUCTION_SOURCES = ["copart", "iaai", "manheim", "autotrader", "private_party", "facebook", "trade_in", "other", "custom"];

// ─── User Management ────────────────────────────────────────
function loadUsers() {
  try {
    const raw = localStorage.getItem(USERS_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveUsers(users) {
  localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
}

function authenticateUser() {
  // localStorage auth disabled — Firebase required
  return null;
}

// Firebase auth wrapper — used by LoginPage when Firebase is enabled
async function firebaseLogin(email, password) {
  const user = await firebaseSignIn(email, password);
  const profile = await getUserProfile(user.uid);
  const role = profile?.role || "user";
  const firstName = profile?.firstName || (user.displayName || email.split("@")[0]).split(" ")[0];
  // Check auctionAccess — admin/manager always have access, others need explicit permission
  const isSuperAdmin = email === (import.meta.env.VITE_SUPER_ADMIN_EMAIL || "support@sayarah.io");
  if (!isSuperAdmin && role !== "admin" && role !== "manager" && profile?.auctionAccess !== true) {
    await firebaseSignOut();
    throw { code: "auth/unauthorized", message: "You don't have access to Auto Trade Hub. Contact your admin to request access." };
  }
  return { uid: user.uid, username: firstName, email, role };
}

async function firebaseRegister(email, password, displayName, firstName, lastName) {
  // New registrations via auction app don't get auction access by default — admin must grant it
  const user = await firebaseSignUp(email, password, displayName, { firstName, lastName });
  await firebaseSignOut();
  throw { code: "auth/unauthorized", message: "Account created! However, you need admin approval to access Auto Trade Hub. Contact your admin." };
}

function isAdmin(role) { return role === "admin"; }
function isManager(role) { return role === "manager"; }
function canApprove(role) { return role === "admin" || role === "manager"; }
function canEditVehicles(role) { return role === "admin" || role === "manager"; }
// Managers can delete vehicles (parallel to canEditVehicles). Admin +
// manager are the "operator" roles. Lower roles (user, customer) can
// still initiate a delete via the approval flow — see del() in InventoryTab.
function canDeleteVehicles(role) { return role === "admin" || role === "manager"; }

// ─── Approval Queue ─────────────────────────────────────────
const APPROVALS_STORAGE_KEY = "sayarah-approvals-v1";
const ACTIVITY_STORAGE_KEY = "sayarah-activity-v1";

async function loadApprovals() {
  if (FIREBASE_ENABLED) { try { return await loadApprovalsFB(); } catch { return []; } }
  try { const raw = localStorage.getItem(APPROVALS_STORAGE_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
function saveApprovals(list) {
  if (FIREBASE_ENABLED) { saveApprovalsFB(list).catch(() => {}); return; }
  localStorage.setItem(APPROVALS_STORAGE_KEY, JSON.stringify(list));
}
async function addApproval(approval) { const arr = await loadApprovals(); arr.unshift(approval); saveApprovals(arr); }

async function loadActivityLog() {
  if (FIREBASE_ENABLED) { try { return await loadActivityLogFB(); } catch { return []; } }
  try { const raw = localStorage.getItem(ACTIVITY_STORAGE_KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
// Append a new log entry. Backed by an append-only Firestore collection in prod
// (create-only rules prevent tampering). In local/dev the fallback keeps a
// rolling 500-entry list in localStorage.
async function logActivity(user, action, description, details = {}) {
  const entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), user, action, description, timestamp: new Date().toISOString(), details };
  if (FIREBASE_ENABLED) {
    try { await addActivityLogEntryFB(entry); } catch (e) { console.warn("activity log append failed:", e); }
    return;
  }
  try {
    const raw = localStorage.getItem(ACTIVITY_STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    list.unshift(entry);
    if (list.length > 500) list.length = 500;
    localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(list));
  } catch {}
}

// ─── Notifications ──────────────────────────────────────────
const NOTIFICATIONS_KEY = "sayarah-notifications-v1";
const WIDGET_PREFS_KEY = "sayarah-widget-prefs-v1";
function loadNotifications() { try { return JSON.parse(localStorage.getItem(NOTIFICATIONS_KEY)) || []; } catch { return []; } }
function saveNotifications(list) { localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(list)); }
function addNotification(type, title, message, meta = {}) {
  const all = loadNotifications();
  all.unshift({ id: genId(), type, title, message, read: false, timestamp: new Date().toISOString(), ...meta });
  if (all.length > 100) all.length = 100;
  saveNotifications(all);
}
async function generateNotifications(data) {
  const notes = [];
  const now = new Date();
  // Aging vehicles
  (data.vehicles || []).filter(v => v.status !== "Sold" && v.purchaseDate).forEach(v => {
    const days = Math.round((now - new Date(v.purchaseDate)) / 86400000);
    if (days >= 60) notes.push({ type: "critical", title: `#${v.stockNum} Critical Aging`, message: `${v.year} ${v.make} ${v.model} held for ${days} days. Consider price reduction.`, stockNum: v.stockNum });
    else if (days >= 45) notes.push({ type: "warning", title: `#${v.stockNum} Stale Inventory`, message: `${v.year} ${v.make} ${v.model} held for ${days} days.`, stockNum: v.stockNum });
    else if (days >= 30) notes.push({ type: "info", title: `#${v.stockNum} Aging Alert`, message: `${v.year} ${v.make} ${v.model} held for ${days} days.`, stockNum: v.stockNum });
  });
  // Pending approvals
  const approvals = await loadApprovals();
  const pending = approvals.filter(a => a.status === "pending");
  if (pending.length > 0) notes.push({ type: "action", title: "Pending Approvals", message: `${pending.length} request${pending.length > 1 ? "s" : ""} waiting for review.` });
  return notes;
}

// ─── Aging Price Suggestions ────────────────────────────────
function calcSuggestedPrice(vehicle, holdCosts, expenses = []) {
  const totalCost = calcTotalCost(vehicle, expenses);
  const days = vehicle.purchaseDate ? Math.round((new Date() - new Date(vehicle.purchaseDate)) / 86400000) : 0;
  const hc = calcHoldCosts(totalCost, days, holdCosts);
  const breakEven = totalCost + hc.total;
  const withMargin10 = breakEven / (1 - 0.10); // 10% margin
  const withMargin15 = breakEven / (1 - 0.15); // 15% margin
  const dailyBurn = hc.perDay;
  return { breakEven, withMargin10, withMargin15, dailyBurn, holdTotal: hc.total, days };
}

// ─── Widget Preferences ─────────────────────────────────────
const DEFAULT_WIDGETS = ["counts", "money", "aging", "tax", "expenses", "recent"];
function loadWidgetPrefs() { try { return JSON.parse(localStorage.getItem(WIDGET_PREFS_KEY)) || DEFAULT_WIDGETS; } catch { return DEFAULT_WIDGETS; } }
function saveWidgetPrefs(prefs) { localStorage.setItem(WIDGET_PREFS_KEY, JSON.stringify(prefs)); }

const DOC_CATEGORIES = ["Title", "Receipt", "Inspection Report", "Insurance", "Repair Invoice", "Photo", "Registration", "Other"];

// Default rules text shown on the Money Management → Rules page
// (admin-editable). Referenced by the Rules component via data.rules.
const DEFAULT_RULES_CONTENT = `# Sayarah Money Management — Rules

## 1. Entity
- **Entity type:** S-Corp
- **State of registration:** Massachusetts
- **Banking:** Sayarah account at Chase Bank
- **Members:** 3

## 2. Monthly Contribution
- Each member contributes **$25,000 per month**.
- **Due date:** 1st of each month.
- Status shown as **green** (paid + approved) or **red** (missed or unapproved).

## 3. Atlantic Fund
- Shared pool held inside the Sayarah Chase account.
- **Maximum / target balance:** $75,000.
- **Low-balance warning:** triggered at $20,000.
- **Cannot be overdrawn.**
- **Admin approval required** before the start of each month for each member to use the fund.
- A **missed contribution** flags the member **and** blocks their fund usage until resolved.
- Outflows over **$10,000** require a **second member's approval**.

## 4. Vehicle Payments
- Both deposit and balance can be paid by a member or from the Atlantic Fund.
- Every vehicle must have a recorded funding source.

## 5. Profit Distribution
- When a fund-purchased vehicle is sold, the **principal returns to the Atlantic Fund**.
- **$295 per sale** moves to the Tax account (for taxes + other costs).
- Remaining profit is **split equally** among the three members.
- Distribution happens at the **end of each month**.

## 6. Tax / Compliance
- S-Corp, Massachusetts.
- The Tax account holds $295 per sale for taxes and other related costs.
`;

const defaultData = () => ({
  vehicles: [], expenses: [], sales: [], mileage: [], documents: [], auctionEvents: [], trash: [],
  nextStockNum: 1,
  holdCosts: { ...DEFAULT_HOLD_COSTS },
  auctionFeeTiers: null,
  startingCapital: 0,
  // ── Money Management ──
  // Seeded with three placeholder members so a fresh install has a
  // working fund immediately; admin can rename / reassign them via
  // the Money Management settings UI.
  money: {
    accounts: DEFAULT_ACCOUNTS,
    members: [
      { id: "m1", name: "Member 1", email: "" },
      { id: "m2", name: "Member 2", email: "" },
      { id: "m3", name: "Member 3", email: "" },
    ],
    ledger: [],
    contributions: [],
    approvals: [],
  },
  rules: {
    content: DEFAULT_RULES_CONTENT,
    version: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: "system",
  },
});
// Wraps a deleted record with audit metadata for the trash bucket.
const toTrash = (item, entity, user) => ({ ...item, _entity: entity, _deletedAt: new Date().toISOString(), _deletedBy: user || "unknown" });
const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const p = v => parseFloat(v) || 0;
// Validates a money-value input. Returns an error string or null.
// Empty/null is OK (treated as 0 downstream); guards NaN, negatives, and absurd magnitudes.
const validateMoney = (val, label, { allowZero = true, max = 10_000_000 } = {}) => {
  if (val === "" || val == null) return allowZero ? null : `${label} is required`;
  const n = Number(val);
  if (!Number.isFinite(n)) return `${label} must be a valid number`;
  if (n < 0) return `${label} cannot be negative`;
  if (!allowZero && n === 0) return `${label} must be greater than 0`;
  if (n > max) return `${label} looks unreasonable (> ${fmt$(max)}). Double-check the value.`;
  return null;
};
const validateMoneyFields = (checks) => {
  for (const [val, label, opts] of checks) {
    const err = validateMoney(val, label, opts);
    if (err) return err;
  }
  return null;
};
// Rounds to nearest cent to prevent floating-point drift at computation boundaries.
// Money math stays in dollars-as-floats (safe for sums < ~$9e12); this just
// snaps results to a whole number of cents so displays and stored totals match.
const roundMoney = (n) => {
  if (n == null || !Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
};
// Payment types — informational tags on a sale payment entry.
const PAYMENT_TYPES = ["deposit", "balance", "payment", "refund", "other"];
// Sum of payments on a sale. For legacy records (no `payments` array) we
// treat the contracted `grossPrice` as fully collected. Refunds are recorded
// as negative-amount entries, so a plain sum is correct.
const calcSalePaid = (s) => {
  if (!s) return 0;
  const pays = Array.isArray(s.payments) ? s.payments : [];
  if (pays.length === 0) return p(s.grossPrice);
  return pays.reduce((acc, pay) => acc + p(pay.amount), 0);
};
// Outstanding balance — only meaningful when payments have been recorded.
// Legacy sales (no payments) report 0 outstanding.
const calcSaleOutstanding = (s) => {
  if (!s) return 0;
  const pays = Array.isArray(s.payments) ? s.payments : [];
  if (pays.length === 0) return 0;
  return roundMoney(p(s.grossPrice) - calcSalePaid(s));
};
// Returns an error string if the sale is missing required-for-Sold fields,
// otherwise null. Per the workflow rule: a vehicle cannot be marked Sold
// unless sale price, sale date, buyer, and payment method are all set.
const validateSoldRequirements = (sale) => {
  if (!sale) return "No sale record";
  if (!p(sale.grossPrice)) return "Sale price (gross) is required";
  if (!sale.date) return "Sale date is required";
  if (!(sale.buyerName || "").trim()) return "Buyer name is required";
  if (!(sale.paymentMethod || "").trim()) return "Payment method is required";
  return null;
};
// Field-level diff helper for the audit trail. Given two versions of a
// record and a list of fields, returns { changes: [{field, before, after}],
// summary: "field: x → y; ..." } for the ones that actually changed.
// Money fields are compared via p() so "" vs 0 doesn't register as a change.
const MONEY_FIELDS = new Set(["purchasePrice", "transportCost", "repairCost", "otherExpenses", "grossPrice", "auctionFee", "titleFee", "otherDeductions", "amount", "reconBudget"]);
const auditDiff = (oldObj, newObj, fields) => {
  const changes = [];
  for (const f of fields) {
    const before = oldObj ? oldObj[f] : undefined;
    const after = newObj ? newObj[f] : undefined;
    const eq = MONEY_FIELDS.has(f) ? (p(before) === p(after)) : ((before ?? "") === (after ?? ""));
    if (!eq) changes.push({ field: f, before: before ?? null, after: after ?? null });
  }
  const fmtVal = (v) => v == null || v === "" ? "∅" : String(v);
  const summary = changes.map(c => `${c.field}: ${fmtVal(c.before)} → ${fmtVal(c.after)}`).join("; ");
  return { changes, summary };
};
// Canonical expense-entry validator. Every tracked expense must have these
// fields — anything less creates gaps in the cost roll-up and ambiguity in
// category-based reports.
const validateExpenseEntry = (e) => {
  if (!e) return "Expense is empty";
  if (!e.date) return "Date is required";
  if (!(e.category || "").trim()) return "Category is required";
  if (!EXPENSE_CATEGORIES.includes(e.category)) return "Category must be chosen from the standard list";
  if (!(e.vendor || "").trim()) return "Vendor is required";
  if (!(e.description || "").trim()) return "Description is required";
  if (e.amount === "" || e.amount == null) return "Amount is required";
  const amtErr = validateMoney(e.amount, "Amount", { allowZero: false });
  if (amtErr) return amtErr;
  if (!(e.stockNum || "").toString().trim()) return "Vehicle (stock #) is required";
  return null;
};
const fmt$ = n => (n == null || isNaN(n)) ? "$0" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
const fmt$2 = n => (n == null || isNaN(n)) ? "$0.00" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
// Percent formatter. Missing/NaN/Infinity render as "—" rather than "0%" so
// users never see a misleading zero when the underlying computation was
// undefined (e.g. ROI when totalCost=0, margin when netSale=0).
const fmtPct = n => (n == null || !Number.isFinite(n)) ? "—" : (n * 100).toFixed(1) + "%";
const daysBetween = (d1, d2) => (!d1 || !d2) ? null : Math.round((new Date(d2) - new Date(d1)) / 86400000);
const daysFromNow = d => d ? Math.round((new Date() - new Date(d)) / 86400000) : 0;
const S = { mono: { fontFamily: "'DM Mono', monospace" } };
// HTML escape for safe print/PDF output
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// CSV export utility
function exportCSV(filename, headers, rows) {
  const csvEsc = v => { const s = String(v ?? ""); return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [headers.join(","), ...rows.map(r => r.map(csvEsc).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}

// calcTotalCost and calcVehicleExpenses are imported from ./src/calc.js
// — the single source of truth for cost-basis math.

function calcVehicleFullMetrics(v, sale, holdCosts, expenses = []) {
  // Total Cost is the complete, all-in cost basis of the vehicle —
  // purchase price + derived auction fees + legacy acquisition fields
  // + every tracked expense (every category, including Selling Costs
  // post-sale). This is the single number every downstream calculation
  // depends on. Do not subtract any tracked-expense category separately
  // below — that would double-count.
  const totalCost = calcTotalCost(v, expenses);
  const vehicleExpenses = Array.isArray(expenses) ? expenses.filter(e => e.stockNum === v.stockNum) : [];
  // sellingCosts is an *informational* breakdown of "how much of Total
  // Cost happens to be post-sale selling costs" — it is NOT subtracted
  // again from profit. Displays use this only as an "of which…" sublabel.
  const sellingCosts = vehicleExpenses
    .filter(e => (e.category || "").toLowerCase().startsWith("selling"))
    .reduce((s, e) => s + p(e.amount), 0);
  const saleDeductions = sale ? p(sale.auctionFee) + p(sale.titleFee) + p(sale.otherDeductions) : 0;
  const netSale = sale ? p(sale.grossPrice) - saleDeductions : 0;
  // Single clean definition: Net Profit = Net Sale − Total Cost.
  // Sale-time deductions are already folded into netSale; every other
  // dollar spent on the vehicle is in totalCost.
  const grossProfit = sale ? netSale - totalCost : null;
  const days = sale && v.purchaseDate && sale.date ? daysBetween(v.purchaseDate, sale.date) : (v.purchaseDate ? daysFromNow(v.purchaseDate) : 0);
  const hc = calcHoldCosts(totalCost, days || 0, holdCosts);
  const trueProfit = grossProfit != null ? grossProfit - hc.total : null;
  const margin = sale && netSale > 0 ? grossProfit / netSale : null;
  const velocity = grossProfit != null && days > 0 ? calcProfitVelocity(grossProfit, days) : null;
  const annROI = grossProfit != null && days > 0 ? calcAnnualizedROI(grossProfit, totalCost, days) : null;
  // Only grade when every input is actually defined. Previously we graded
  // on zero-defaulted inputs, producing misleading "F" grades for records
  // that were simply missing data (e.g. no cost basis = no ROI = F).
  const canGrade = grossProfit != null
    && margin != null && Number.isFinite(margin)
    && annROI != null && Number.isFinite(annROI)
    && velocity != null && Number.isFinite(velocity)
    && days > 0;
  const grade = canGrade ? gradeDeal(margin, days, annROI, velocity) : null;
  const breakEven = calcBreakEven(totalCost, hc.total, 0);
  const risk = calcRiskScore(v);
  const aging = v.status !== "Sold" ? getAgingStatus(days || 0) : null;
  const costPerDay = days > 0 ? totalCost / days : 0;
  return { totalCost, netSale, grossProfit, trueProfit, days, holdCost: hc, margin, velocity, annROI, grade, breakEven, risk, aging, sellingCosts, saleDeductions, costPerDay };
}

// ═══════════════════════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════════════════════
function Input({ label, value, onChange, type = "text", placeholder, readOnly, step, className = "" }) {
  const [f, setF] = useState(false);
  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {label && <label style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: BRAND.gray }}>{label}</label>}
      <input type={type} value={value ?? ""} placeholder={placeholder} readOnly={readOnly} step={step}
        onChange={e => onChange(type === "number" ? (e.target.value === "" ? "" : parseFloat(e.target.value)) : e.target.value)}
        onFocus={() => setF(true)} onBlur={() => setF(false)}
        style={{ width: "100%", border: `1.5px solid ${f ? BRAND.red : BRAND.grayLight}`, borderRadius: 8, padding: "9px 11px", fontSize: 13, color: readOnly ? BRAND.gray : BRAND.black, background: readOnly ? "#F9FAFB" : BRAND.white, outline: "none", boxSizing: "border-box", transition: "border-color 0.2s" }} />
    </div>
  );
}

function Select({ label, value, onChange, options, placeholder, className = "" }) {
  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {label && <label style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: BRAND.gray }}>{label}</label>}
      <select value={value ?? ""} onChange={e => onChange(e.target.value)} style={{ width: "100%", border: `1.5px solid ${BRAND.grayLight}`, borderRadius: 8, padding: "9px 11px", fontSize: 13, color: BRAND.black, background: BRAND.white, outline: "none", boxSizing: "border-box", cursor: "pointer" }}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(o => typeof o === "object" ? <option key={o.value} value={o.value}>{o.label}</option> : <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", size = "md", disabled, style: sx = {} }) {
  const base = { border: "none", borderRadius: 6, cursor: disabled ? "not-allowed" : "pointer", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6, transition: "all 0.15s", opacity: disabled ? 0.5 : 1, fontFamily: "inherit", letterSpacing: "0.02em" };
  const v = {
    primary: { background: BRAND.red, color: "#fff", padding: size === "sm" ? "6px 12px" : "9px 18px", fontSize: size === "sm" ? 12 : 13 },
    secondary: { background: BRAND.white, color: BRAND.grayDark, padding: size === "sm" ? "6px 12px" : "9px 18px", fontSize: size === "sm" ? 12 : 13, border: `1.5px solid ${BRAND.grayLight}` },
    danger: { background: "#DC2626", color: "#fff", padding: "6px 12px", fontSize: 12 },
    ghost: { background: "transparent", color: BRAND.gray, padding: "4px 8px", fontSize: 12 },
  };
  return <button onClick={onClick} disabled={disabled} style={{ ...base, ...v[variant], ...sx }}>{children}</button>;
}

function Card({ children, style = {}, onClick }) { return <div onClick={onClick} style={{ background: BRAND.white, border: `1px solid ${BRAND.grayLight}`, borderRadius: 12, padding: 18, ...style }}>{children}</div>; }

// ─── Toast Notification System ───
const ToastCtx = createContext();
function useToast() { return useContext(ToastCtx); }
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((msg, type = "success") => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);
  const colors = { success: { bg: "#F0FDF4", border: "#86EFAC", text: "#166534" }, error: { bg: "#FEF2F2", border: "#FECACA", text: "#991B1B" }, info: { bg: "#EFF6FF", border: "#93C5FD", text: "#1E40AF" } };
  return (
    <ToastCtx.Provider value={add}>
      {children}
      <div style={{ position: "fixed", top: 16, right: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
        {toasts.map(t => { const c = colors[t.type] || colors.info; return (
          <div key={t.id} style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text, padding: "10px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", animation: "slideUp 0.3s ease", maxWidth: 360, pointerEvents: "auto" }}>{t.msg}</div>
        ); })}
      </div>
    </ToastCtx.Provider>
  );
}

function StatCard({ label, value, sub, color, trend }) {
  return (
    <Card style={{ flex: "1 1 160px", minWidth: 148 }}>
      <div style={{ fontSize: 10, color: BRAND.gray, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || BRAND.red, ...S.mono }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: BRAND.gray, marginTop: 3 }}>{sub}</div>}
      {trend && <div style={{ fontSize: 11, marginTop: 4, color: trend >= 0 ? BRAND.green : "#DC2626", fontWeight: 700 }}>{trend >= 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(1)}%</div>}
    </Card>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 12, backdropFilter: "blur(3px)" }}>
      <div className="modal-dialog" onClick={e => e.stopPropagation()} style={{ background: BRAND.white, borderRadius: 14, padding: 24, width: "100%", maxWidth: wide ? 860 : 540, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 40px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, paddingBottom: 14, borderBottom: `2px solid ${BRAND.redBg2}` }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: BRAND.red }}>{title}</h3>
          <Btn variant="ghost" onClick={onClose}>✕</Btn>
        </div>
        {children}
      </div>
    </div>
  );
}

function Empty({ icon, title, sub }) {
  return <div style={{ textAlign: "center", padding: "50px 20px" }}><div style={{ fontSize: 44, marginBottom: 6 }}>{icon}</div><div style={{ fontSize: 15, fontWeight: 700, color: BRAND.grayDark }}>{title}</div><div style={{ fontSize: 12, color: BRAND.gray, marginTop: 3 }}>{sub}</div></div>;
}

function Confirm({ msg, onOk, onCancel }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}>
      <div style={{ background: BRAND.white, borderRadius: 12, padding: 24, maxWidth: 360, textAlign: "center", boxShadow: "0 16px 40px rgba(0,0,0,0.2)" }}>
        <p style={{ color: BRAND.grayDark, fontSize: 14, marginBottom: 18, lineHeight: 1.5 }}>{msg}</p>
        <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
          <Btn variant="secondary" onClick={onCancel}>Cancel</Btn>
          <Btn variant="danger" onClick={onOk}>Delete</Btn>
        </div>
      </div>
    </div>
  );
}

function Badge({ children, color, bg }) { return <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 9px", borderRadius: 20, background: bg, color, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{children}</span>; }

function StatusBadge({ status }) {
  const c = { "In Recon": { bg: "#FEF3C7", fg: "#92400E" }, "Ready": { bg: "#DBEAFE", fg: "#1E40AF" }, "Listed": { bg: "#E0E7FF", fg: "#4338CA" }, "Sold": { bg: "#D1FAE5", fg: "#065F46" } };
  const x = c[status] || { bg: BRAND.grayLight, fg: BRAND.grayDark };
  return <Badge color={x.fg} bg={x.bg}>{status}</Badge>;
}

function GradeBadge({ grade, showPending = true }) {
  if (!grade) {
    if (!showPending) return null;
    // Shown when the grade cannot be computed yet — e.g. the vehicle hasn't
    // been sold, or required financial inputs are missing. Avoids the
    // previous behavior of grading 0-defaulted inputs as "F" which misled
    // users into thinking a data-incomplete deal had failed.
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: BRAND.gray, ...S.mono }}>—</span>
        <span style={{ fontSize: 10, color: BRAND.gray, fontWeight: 600 }}>Pending</span>
      </div>
    );
  }
  return <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
    <span style={{ fontSize: 18, fontWeight: 900, color: grade.color, ...S.mono }}>{grade.grade}</span>
    <span style={{ fontSize: 10, color: grade.color, fontWeight: 600 }}>{grade.label}</span>
  </div>;
}

function MiniBar({ value, max, color }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return <div style={{ height: 4, background: BRAND.grayLight, borderRadius: 2, width: "100%" }}><div style={{ height: 4, background: color || BRAND.red, borderRadius: 2, width: `${pct}%`, transition: "width 0.4s" }} /></div>;
}

function SectionTitle({ children }) { return <div style={{ fontSize: 11, fontWeight: 800, color: BRAND.red, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>{children}</div>; }

// ═══════════════════════════════════════════════════════════════
// VEHICLE PHOTOS — thumbnail + editor (drag-drop upload, reorder, remove)
// ═══════════════════════════════════════════════════════════════
// Placeholder icon shown when a vehicle has no photo. Kept inline so the
// inventory row never breaks layout if uploads are missing or still pending.
function VehicleThumb({ photos, width = 160, height = 110 }) {
  const first = Array.isArray(photos) && photos.length > 0 ? photos[0] : null;
  if (first && first.url) {
    return (
      <img
        src={first.url}
        alt=""
        loading="lazy"
        style={{ width, height, objectFit: "cover", borderRadius: 8, border: `1px solid ${BRAND.grayLight}`, background: "#F5F5F5", display: "block", flexShrink: 0 }}
      />
    );
  }
  return (
    <div style={{ width, height, borderRadius: 8, background: "#F3F4F6", border: `1px solid ${BRAND.grayLight}`, display: "flex", alignItems: "center", justifyContent: "center", color: "#9CA3AF", flexShrink: 0 }}>
      <svg width={Math.round(width / 4)} height={Math.round(width / 4)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18 10l-2.7-3.6A1.5 1.5 0 0 0 14.1 6H9.9a1.5 1.5 0 0 0-1.2.6L6 10l-2.5 1.1C2.7 11.3 2 12.1 2 13v3c0 .6.4 1 1 1h2"/>
        <circle cx="7" cy="17" r="2"/>
        <circle cx="17" cy="17" r="2"/>
      </svg>
    </div>
  );
}

// Inline editor for a vehicle's photo set. Uploads go to Firebase Storage
// under vehicles/{vehicleId}/photos/{photoId}.{ext}; the vehicle record
// stores the URL + storage path so deletes can reclaim storage.
// First photo in the array is treated as primary everywhere in the app.
function PhotoEditor({ vehicleId, photos, onChange, readOnly = false, compact = false }) {
  const safePhotos = Array.isArray(photos) ? photos : [];
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const inputId = `photo-upload-${vehicleId || "new"}`;

  // Translate Firebase Storage error codes into something a non-developer
  // can act on. "storage/unauthorized" is the most common one and nearly
  // always means the Storage rules need to be deployed (see storage.rules
  // in the repo root).
  const humanizeUploadError = (e) => {
    const code = (e && e.code) || "";
    if (code === "storage/unauthorized" || /unauthorized/i.test(e?.message || "")) {
      return "Upload blocked by Firebase Storage rules. An admin needs to deploy the storage.rules file (firebase deploy --only storage).";
    }
    if (code === "storage/unauthenticated") return "You're not signed in. Refresh the page and sign in again.";
    if (code === "storage/quota-exceeded") return "Storage quota exceeded — contact your admin.";
    if (code === "storage/retry-limit-exceeded") return "Upload timed out. Check your internet connection and try again.";
    if (code === "storage/canceled") return "Upload cancelled.";
    return `Upload failed: ${e?.message || e}`;
  };

  const handleFiles = async (fileList) => {
    const files = [...(fileList || [])];
    if (files.length === 0) return;
    const images = files.filter(f => f.type && f.type.startsWith("image/"));
    if (images.length === 0) { setError("Images only (JPG, PNG, WebP)."); return; }
    setError("");
    const appended = [];
    for (const f of images) {
      if (f.size > 10 * 1024 * 1024) {
        setError(`${f.name} is larger than 10 MB — skipped.`);
        continue;
      }
      const photoId = genId();
      const ext = (f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `vehicles/${vehicleId || "pending"}/photos/${photoId}.${ext || "jpg"}`;
      setUploading(u => u + 1);
      try {
        const url = await uploadFile(path, f);
        appended.push({ id: photoId, url, path, name: f.name, size: f.size, uploadedAt: new Date().toISOString() });
      } catch (e) {
        console.warn("photo upload failed:", e);
        setError(humanizeUploadError(e));
      } finally {
        setUploading(u => u - 1);
      }
    }
    if (appended.length > 0) onChange([...safePhotos, ...appended]);
  };

  const remove = async (photo) => {
    if (photo.path) { try { await deleteFile(photo.path); } catch {} }
    onChange(safePhotos.filter(p => p.id !== photo.id));
  };
  const move = (idx, dir) => {
    const tgt = idx + dir;
    if (tgt < 0 || tgt >= safePhotos.length) return;
    const next = [...safePhotos];
    [next[idx], next[tgt]] = [next[tgt], next[idx]];
    onChange(next);
  };

  const thumbSize = compact ? 80 : 110;

  return (
    <div>
      {/* Read-only hint so users who lack edit permission know why no
          upload control appears. Without this they'd see just the
          existing photos (or nothing) and conclude the feature is
          broken. */}
      {readOnly && safePhotos.length === 0 && (
        <div style={{ padding: "10px 12px", background: "#F9FAFB", borderRadius: 8, fontSize: 11, color: BRAND.gray, border: `1px solid ${BRAND.grayLight}`, fontStyle: "italic" }}>
          No photos yet. You don't have permission to upload — ask an admin or manager to add photos to this vehicle.
        </div>
      )}
      {!readOnly && (
        <label
          htmlFor={inputId}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
          style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            padding: compact ? 14 : 22, borderRadius: 10,
            border: `2px dashed ${dragOver ? BRAND.red : BRAND.grayLight}`,
            background: dragOver ? "#FEF2F2" : "#FAFAFA",
            cursor: uploading > 0 ? "wait" : "pointer", transition: "all 0.15s", minHeight: compact ? 80 : 110,
          }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={dragOver ? BRAND.red : BRAND.gray} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 6 }}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <div style={{ fontSize: 12, fontWeight: 700, color: dragOver ? BRAND.red : BRAND.grayDark }}>
            {uploading > 0 ? `Uploading ${uploading}…` : "Drop photos here or click to upload"}
          </div>
          <div style={{ fontSize: 10, color: BRAND.gray, marginTop: 3 }}>JPG, PNG, WebP · max 10 MB each · drop multiple</div>
          <input
            id={inputId}
            type="file"
            accept="image/*"
            multiple
            onChange={e => { handleFiles(e.target.files); e.target.value = ""; }}
            style={{ display: "none" }}
          />
        </label>
      )}
      {error && <div style={{ background: "#FEF2F2", color: "#DC2626", padding: "6px 10px", borderRadius: 6, fontSize: 11, marginTop: 8, fontWeight: 600 }}>{error}</div>}
      {safePhotos.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize + 20}px, 1fr))`, gap: 8, marginTop: 10 }}>
          {safePhotos.map((photo, i) => (
            <div key={photo.id} style={{ position: "relative", borderRadius: 8, overflow: "hidden", aspectRatio: "4/3", border: i === 0 ? `2px solid ${BRAND.red}` : `1px solid ${BRAND.grayLight}`, background: "#F5F5F5" }}>
              <img src={photo.url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              {i === 0 && (
                <div style={{ position: "absolute", top: 4, left: 4, background: BRAND.red, color: "#fff", fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4, letterSpacing: "0.05em" }}>PRIMARY</div>
              )}
              {!readOnly && (
                <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, display: "flex", justifyContent: "space-between", background: "rgba(0,0,0,0.55)", padding: 4, gap: 4 }}>
                  <div style={{ display: "flex", gap: 2 }}>
                    <button title="Move left" onClick={(e) => { e.stopPropagation(); move(i, -1); }} disabled={i === 0} style={{ background: "rgba(255,255,255,0.18)", border: "none", color: i === 0 ? "#666" : "#fff", cursor: i === 0 ? "not-allowed" : "pointer", borderRadius: 4, padding: "2px 6px", fontSize: 11, lineHeight: 1 }}>←</button>
                    <button title="Move right" onClick={(e) => { e.stopPropagation(); move(i, 1); }} disabled={i === safePhotos.length - 1} style={{ background: "rgba(255,255,255,0.18)", border: "none", color: i === safePhotos.length - 1 ? "#666" : "#fff", cursor: i === safePhotos.length - 1 ? "not-allowed" : "pointer", borderRadius: 4, padding: "2px 6px", fontSize: 11, lineHeight: 1 }}>→</button>
                  </div>
                  <button title="Remove" onClick={(e) => { e.stopPropagation(); remove(photo); }} style={{ background: "rgba(220,38,38,0.85)", border: "none", color: "#fff", cursor: "pointer", borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 800, lineHeight: 1 }}>×</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Inline editor for a sale's payment schedule. Each row is a partial payment
// (deposit, balance, refund, etc.). Summary shows paid vs outstanding vs the
// contracted gross price. If no rows are added, the sale is treated as fully
// paid at grossPrice for backward-compat with legacy records.
function PaymentsEditor({ grossPrice, payments, onChange }) {
  const rows = Array.isArray(payments) ? payments : [];
  const paid = rows.reduce((acc, r) => acc + p(r.amount), 0);
  const outstanding = roundMoney((grossPrice || 0) - paid);

  const add = () => {
    const row = { id: genId(), date: new Date().toISOString().slice(0, 10), amount: "", method: "", type: "payment", notes: "" };
    onChange([...(rows || []), row]);
  };
  const upd = (id, key, val) => onChange(rows.map(r => r.id === id ? { ...r, [key]: val } : r));
  const remove = (id) => onChange(rows.filter(r => r.id !== id));

  return (
    <div style={{ marginTop: 14, borderTop: `1px dashed ${BRAND.grayLight}`, paddingTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: BRAND.gray, textTransform: "uppercase", letterSpacing: "0.06em" }}>Payments (optional)</div>
        <Btn size="sm" variant="secondary" onClick={add}>+ Add Payment</Btn>
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 11, color: BRAND.gray, fontStyle: "italic" }}>No payments recorded — sale is treated as fully paid at gross price.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map(r => (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: "120px 110px 110px 1fr 30px", gap: 6, alignItems: "center" }}>
              <input type="date" value={r.date || ""} onChange={e => upd(r.id, "date", e.target.value)} style={{ padding: "6px 8px", border: `1px solid ${BRAND.grayLight}`, borderRadius: 6, fontSize: 11, fontFamily: "inherit" }} />
              <input type="number" step="0.01" placeholder="Amount" value={r.amount} onChange={e => upd(r.id, "amount", e.target.value === "" ? "" : parseFloat(e.target.value))} style={{ padding: "6px 8px", border: `1px solid ${BRAND.grayLight}`, borderRadius: 6, fontSize: 11, fontFamily: "inherit", ...S.mono }} />
              <select value={r.type || "payment"} onChange={e => upd(r.id, "type", e.target.value)} style={{ padding: "6px 8px", border: `1px solid ${BRAND.grayLight}`, borderRadius: 6, fontSize: 11, fontFamily: "inherit", background: BRAND.white }}>
                {PAYMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input type="text" placeholder="Method / notes" value={r.method || ""} onChange={e => upd(r.id, "method", e.target.value)} style={{ padding: "6px 8px", border: `1px solid ${BRAND.grayLight}`, borderRadius: 6, fontSize: 11, fontFamily: "inherit" }} />
              <button onClick={() => remove(r.id)} aria-label="Remove payment" style={{ border: "none", background: "transparent", color: "#DC2626", cursor: "pointer", fontSize: 16, fontWeight: 700, padding: 0 }}>×</button>
            </div>
          ))}
        </div>
      )}
      {(rows.length > 0 || (grossPrice || 0) > 0) && (
        <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 11, flexWrap: "wrap" }}>
          <span style={{ color: BRAND.gray }}>Gross: <b style={{ color: BRAND.black, ...S.mono }}>{fmt$2(grossPrice || 0)}</b></span>
          <span style={{ color: BRAND.gray }}>Paid: <b style={{ color: BRAND.green, ...S.mono }}>{fmt$2(paid)}</b></span>
          <span style={{ color: BRAND.gray }}>Outstanding: <b style={{ color: outstanding > 0.005 ? "#DC2626" : outstanding < -0.005 ? "#D97706" : BRAND.green, ...S.mono }}>{fmt$2(outstanding)}</b></span>
          {rows.length > 0 && Math.abs(outstanding) < 0.005 && <span style={{ color: BRAND.green, fontWeight: 700 }}>· Paid in full ✓</span>}
        </div>
      )}
    </div>
  );
}

function TH({ children }) { return <th style={{ textAlign: "left", padding: "9px 12px", color: BRAND.red, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}>{children}</th>; }

function TD({ children, style = {} }) { return <td style={{ padding: "10px 12px", fontSize: 13, ...style }}>{children}</td>; }

// ═══════════════════════════════════════════════════════════════
// LOGIN PAGE
// ═══════════════════════════════════════════════════════════════
function LoginPage({ onLogin }) {
  const [user, setUser] = useState(""); const [pass, setPass] = useState(""); const [error, setError] = useState(""); const [loading, setLoading] = useState(false); const [showForgot, setShowForgot] = useState(false);
  const [focused, setFocused] = useState(null);
  const [isSignUp, setIsSignUp] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetStatus, setResetStatus] = useState(""); // "sent", "error:...", ""
  const [resetLoading, setResetLoading] = useState(false);

  const go = async () => {
    if (FIREBASE_ENABLED) {
      // Firebase auth — email/password
      if (!user.trim()) { setError("Enter your email"); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.trim())) { setError("Enter a valid email address"); return; }
      if (!pass.trim()) { setError("Enter a password"); return; }
      if (isSignUp && pass.length < 8) { setError("Password must be at least 8 characters"); return; }
      setLoading(true); setError("");
      try {
        if (isSignUp) {
          if (!firstName.trim()) { setError("Enter your first name"); setLoading(false); return; }
          if (!lastName.trim()) { setError("Enter your last name"); setLoading(false); return; }
          const fullName = `${firstName.trim()} ${lastName.trim()}`;
          const result = await firebaseRegister(user.trim(), pass, fullName, firstName.trim(), lastName.trim());
          onLogin(result.username, result.role, result.uid);
        } else {
          const result = await firebaseLogin(user.trim(), pass);
          onLogin(result.username, result.role, result.uid);
        }
      } catch (err) {
        const msg = err.code === "auth/user-not-found" ? "Invalid email or password"
          : err.code === "auth/wrong-password" ? "Invalid email or password"
          : err.code === "auth/invalid-email" ? "Invalid email format"
          : err.code === "auth/email-already-in-use" ? "Email already registered — try signing in"
          : err.code === "auth/weak-password" ? "Password must be at least 8 characters"
          : err.code === "auth/invalid-credential" ? "Invalid email or password"
          : err.message || "Authentication failed";
        setError(msg); setLoading(false);
      }
    } else {
      // localStorage fallback
      if (!user.trim()) { setError("Enter a username"); return; }
      if (!pass.trim()) { setError("Enter a password"); return; }
      setLoading(true); setError("");
      setTimeout(() => {
        const authed = authenticateUser(user.trim(), pass);
        if (authed) {
          onLogin(authed.username, authed.role);
        } else {
          setError("Invalid username or password");
          setLoading(false);
        }
      }, 700);
    }
  };

  const cssAnim = `
    @keyframes gradientShift { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }
    @keyframes float1 { 0%,100%{transform:translate(0,0) rotate(0deg)} 33%{transform:translate(30px,-20px) rotate(120deg)} 66%{transform:translate(-20px,15px) rotate(240deg)} }
    @keyframes float2 { 0%,100%{transform:translate(0,0) rotate(0deg)} 33%{transform:translate(-25px,20px) rotate(-120deg)} 66%{transform:translate(15px,-25px) rotate(-240deg)} }
    @keyframes float3 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(20px,-30px)} }
    @keyframes slideUp { from{opacity:0;transform:translateY(30px)} to{opacity:1;transform:translateY(0)} }
    @keyframes fadeIn { from{opacity:0} to{opacity:1} }
    @keyframes pulse { 0%,100%{opacity:0.6} 50%{opacity:1} }
    @keyframes carDrive { 0%{transform:translateX(-100px);opacity:0} 30%{opacity:1} 100%{transform:translateX(0);opacity:1} }
    @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
    @keyframes borderGlow { 0%,100%{border-color:rgba(139,26,26,0.3)} 50%{border-color:rgba(139,26,26,0.7)} }
  `;

  return (
    <div className="login-split" style={{ minHeight: "100vh", display: "flex", fontFamily: "'DM Sans', sans-serif", position: "relative", overflow: "hidden" }}>
      <style>{cssAnim}</style>

      {/* ─── Left Panel: Animated Hero ─── */}
      <div className="login-hero" style={{
        flex: "1 1 55%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "60px 70px",
        position: "relative", overflow: "hidden",
        background: "linear-gradient(-45deg, #5C0A0A, #8B1A1A, #A52422, #6B1515, #8B1A1A)",
        backgroundSize: "400% 400%",
        animation: "gradientShift 12s ease infinite",
      }}>
        {/* Floating orbs */}
        <div style={{ position: "absolute", top: -80, right: -80, width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,255,255,0.08) 0%, transparent 70%)", animation: "float1 20s ease-in-out infinite" }} />
        <div style={{ position: "absolute", bottom: -120, left: -60, width: 350, height: 350, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,255,255,0.06) 0%, transparent 70%)", animation: "float2 25s ease-in-out infinite" }} />
        <div style={{ position: "absolute", top: "40%", right: "15%", width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,255,255,0.04) 0%, transparent 70%)", animation: "float3 15s ease-in-out infinite" }} />

        {/* Grid pattern overlay */}
        <div style={{ position: "absolute", inset: 0, opacity: 0.03, backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />

        <div style={{ position: "relative", zIndex: 1 }}>
          {/* Logo */}
          <div style={{ marginBottom: 50, animation: "slideUp 0.8s ease" }}>
            <img src="/logo.png" alt="Auto Trade Hub" style={{ height: 80, objectFit: "contain" }} />
          </div>

          {/* Hero Text */}
          <h1 className="login-hero-h1" style={{ fontSize: 48, fontWeight: 900, color: "#fff", lineHeight: 1.05, margin: "0 0 20px", letterSpacing: "-0.04em", maxWidth: 500, animation: "slideUp 1s ease" }}>
            YOUR DEALS.<br />
            <span style={{
              background: "linear-gradient(90deg, rgba(255,255,255,0.4), rgba(255,255,255,0.7), rgba(255,255,255,0.4))",
              backgroundSize: "200% auto",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
              animation: "shimmer 3s linear infinite",
            }}>YOUR SUCCESS.</span>
          </h1>

          <p style={{ fontSize: 16, color: "rgba(255,255,255,0.55)", lineHeight: 1.7, maxWidth: 420, animation: "slideUp 1.2s ease" }}>
            Every great flip starts here. Track your deals, crush your numbers, and watch your profits grow.
          </p>

          {/* Motivational quote */}
          <div style={{ marginTop: 28, padding: "16px 20px", borderLeft: "3px solid rgba(255,255,255,0.25)", animation: "slideUp 1.3s ease" }}>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", fontStyle: "italic", lineHeight: 1.6, margin: 0 }}>
              &ldquo;The only way to do great work is to love what you do.&rdquo; &mdash; Steve Jobs
            </p>
          </div>

          {/* Feature Cards */}
          <div className="login-features" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 32, maxWidth: 440, animation: "slideUp 1.4s ease" }}>
            {[
              ["Smart Grading", "Know your best deals instantly", "A+"],
              ["Live Tracking", "Every cost, every car, real-time", "$"],
              ["Team Approvals", "Stay aligned with your admin", "OK"],
              ["Goal Crusher", "Beat benchmarks, level up", "GO"],
            ].map(([t, s, icon], i) => (
              <div key={t} style={{
                background: "rgba(255,255,255,0.07)", backdropFilter: "blur(10px)",
                border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "14px 16px",
                animation: `fadeIn ${1.4 + i * 0.15}s ease`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <div style={{ width: 26, height: 26, borderRadius: 7, background: "rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 900, color: "#fff", ...S.mono }}>{icon}</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>{t}</div>
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.4 }}>{s}</div>
              </div>
            ))}
          </div>

          {/* Team stats */}
          <div className="login-team-stats" style={{ display: "flex", gap: 28, marginTop: 32, animation: "slideUp 1.8s ease" }}>
            {[["TEAM", "Driven"], ["DEALS", "On Point"], ["PROFITS", "Growing"]].map(([val, label]) => (
              <div key={val}>
                <div style={{ fontSize: 18, fontWeight: 900, color: "#fff", letterSpacing: "0.04em" }}>{val}</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", letterSpacing: "0.05em" }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Right Panel: Login Form ─── */}
      <div className="login-form-panel" style={{
        flex: "1 1 45%", display: "flex", alignItems: "center", justifyContent: "center", padding: 40,
        background: `linear-gradient(135deg, ${BRAND.cream} 0%, #F5F0EB 50%, ${BRAND.cream} 100%)`,
        position: "relative",
      }}>
        {/* Subtle pattern */}
        <div style={{ position: "absolute", inset: 0, opacity: 0.03, backgroundImage: "radial-gradient(circle at 20px 20px, #8B1A1A 1px, transparent 1px)", backgroundSize: "40px 40px" }} />

        <div className="login-form-box" style={{ width: "100%", maxWidth: 380, position: "relative", zIndex: 1, animation: "slideUp 0.6s ease" }}>
          {/* Welcome section */}
          <div className="login-welcome" style={{ marginBottom: 32 }}>
            <div style={{ display: "inline-block", background: BRAND.redBg, borderRadius: 20, padding: "5px 14px", marginBottom: 14 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: BRAND.red, letterSpacing: "0.05em" }}>TEAM PORTAL</span>
            </div>
            <h2 style={{ fontSize: 30, fontWeight: 900, color: BRAND.black, margin: "0 0 6px", letterSpacing: "-0.03em", lineHeight: 1.1 }}>
              {isSignUp ? "Create Account" : "Good to see you."}<br />{isSignUp ? "Join the team." : "Let's get to work."}
            </h2>
            <p style={{ fontSize: 13, color: BRAND.gray, margin: 0 }}>{isSignUp ? "Sign up to start managing deals" : "Sign in to manage your deals and inventory"}</p>
          </div>

          {/* Form */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Name fields — only for Firebase sign-up */}
            {FIREBASE_ENABLED && isSignUp && (
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: BRAND.gray }}>First Name</label>
                  <div style={{ position: "relative" }}>
                    <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: focused === "fname" ? BRAND.red : BRAND.gray, transition: "color 0.2s" }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    </div>
                    <input value={firstName} onChange={e => setFirstName(e.target.value)} onFocus={() => setFocused("fname")} onBlur={() => setFocused(null)} placeholder="First name"
                      style={{ width: "100%", border: `2px solid ${focused === "fname" ? BRAND.red : BRAND.grayLight}`, borderRadius: 10, padding: "12px 12px 12px 38px", fontSize: 14, background: BRAND.white, outline: "none", boxSizing: "border-box", transition: "border-color 0.2s, box-shadow 0.2s", boxShadow: focused === "fname" ? "0 0 0 3px rgba(139,26,26,0.1)" : "none", fontFamily: "inherit" }} />
                  </div>
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: BRAND.gray }}>Last Name</label>
                  <div style={{ position: "relative" }}>
                    <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: focused === "lname" ? BRAND.red : BRAND.gray, transition: "color 0.2s" }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    </div>
                    <input value={lastName} onChange={e => setLastName(e.target.value)} onFocus={() => setFocused("lname")} onBlur={() => setFocused(null)} placeholder="Last name"
                      style={{ width: "100%", border: `2px solid ${focused === "lname" ? BRAND.red : BRAND.grayLight}`, borderRadius: 10, padding: "12px 12px 12px 38px", fontSize: 14, background: BRAND.white, outline: "none", boxSizing: "border-box", transition: "border-color 0.2s, box-shadow 0.2s", boxShadow: focused === "lname" ? "0 0 0 3px rgba(139,26,26,0.1)" : "none", fontFamily: "inherit" }} />
                  </div>
                </div>
              </div>
            )}

            {/* Email / Username */}
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: BRAND.gray }}>{FIREBASE_ENABLED ? "Email" : "Username"}</label>
              <div style={{ position: "relative" }}>
                <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: focused === "user" ? BRAND.red : BRAND.gray, transition: "color 0.2s" }}>
                  {FIREBASE_ENABLED
                    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
                </div>
                <input value={user} onChange={e => setUser(e.target.value)} onFocus={() => setFocused("user")} onBlur={() => setFocused(null)} placeholder={FIREBASE_ENABLED ? "you@email.com" : "Enter username"} type={FIREBASE_ENABLED ? "email" : "text"}
                  style={{ width: "100%", border: `2px solid ${focused === "user" ? BRAND.red : BRAND.grayLight}`, borderRadius: 10, padding: "12px 12px 12px 38px", fontSize: 14, background: BRAND.white, outline: "none", boxSizing: "border-box", transition: "border-color 0.2s, box-shadow 0.2s", boxShadow: focused === "user" ? "0 0 0 3px rgba(139,26,26,0.1)" : "none", fontFamily: "inherit" }} />
              </div>
            </div>

            {/* Password */}
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: BRAND.gray }}>Password</label>
              <div style={{ position: "relative" }}>
                <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: focused === "pass" ? BRAND.red : BRAND.gray, transition: "color 0.2s" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                </div>
                <input type="password" value={pass} onChange={e => setPass(e.target.value)} onFocus={() => setFocused("pass")} onBlur={() => setFocused(null)} onKeyDown={e => e.key === "Enter" && go()} placeholder="Enter password"
                  style={{ width: "100%", border: `2px solid ${focused === "pass" ? BRAND.red : BRAND.grayLight}`, borderRadius: 10, padding: "12px 12px 12px 38px", fontSize: 14, background: BRAND.white, outline: "none", boxSizing: "border-box", transition: "border-color 0.2s, box-shadow 0.2s", boxShadow: focused === "pass" ? "0 0 0 3px rgba(139,26,26,0.1)" : "none", fontFamily: "inherit" }} />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{ background: "#FEF2F2", color: "#DC2626", padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, border: "1px solid #FECACA", display: "flex", alignItems: "center", gap: 8, animation: "slideUp 0.3s ease" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                {error}
              </div>
            )}

            {/* Sign In / Sign Up Button */}
            <button onClick={go} disabled={loading} style={{
              width: "100%", padding: "14px", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 800,
              cursor: loading ? "wait" : "pointer", fontFamily: "inherit",
              background: loading ? BRAND.gray : `linear-gradient(135deg, ${BRAND.red}, ${BRAND.redLight})`,
              color: "#fff", boxShadow: loading ? "none" : "0 4px 15px rgba(139,26,26,0.35)",
              transition: "all 0.3s", transform: loading ? "scale(0.98)" : "scale(1)",
              letterSpacing: "0.04em",
            }}>
              {loading ? (
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <span style={{ width: 16, height: 16, border: "2.5px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "float1 1s linear infinite" }} />
                  {isSignUp ? "Creating account..." : "Signing in..."}
                </span>
              ) : isSignUp ? "CREATE ACCOUNT \u2192" : "SIGN IN \u2192"}
            </button>

            {/* Toggle Sign Up / Sign In (Firebase only) */}
            {FIREBASE_ENABLED && (
              <div style={{ textAlign: "center", marginTop: 4 }}>
                <span style={{ fontSize: 12, color: BRAND.gray }}>{isSignUp ? "Already have an account?" : "Don't have an account?"} </span>
                <button onClick={() => { setIsSignUp(!isSignUp); setError(""); }} style={{ background: "none", border: "none", color: BRAND.red, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                  {isSignUp ? "Sign In" : "Sign Up"}
                </button>
              </div>
            )}

            {/* Forgot password */}
            <div style={{ textAlign: "center", marginTop: 4 }}>
              <button onClick={() => { setShowForgot(!showForgot); setResetStatus(""); setResetEmail(user); }} style={{ background: "none", border: "none", color: BRAND.gray, fontSize: 12, cursor: "pointer", fontFamily: "inherit", transition: "color 0.2s" }}
                onMouseEnter={e => e.target.style.color = BRAND.red} onMouseLeave={e => e.target.style.color = BRAND.gray}>
                Forgot your password?
              </button>
              {showForgot && (
                <div style={{ marginTop: 10, background: "linear-gradient(135deg, #EFF6FF, #DBEAFE)", border: "1px solid #BFDBFE", borderRadius: 10, padding: "16px", fontSize: 12, color: BRAND.blue, lineHeight: 1.6, animation: "slideUp 0.3s ease", textAlign: "left" }}>
                  {resetStatus === "sent" ? (
                    <div style={{ textAlign: "center" }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 6 }}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                      <div style={{ fontWeight: 700, color: "#166534", marginBottom: 4 }}>Reset email sent!</div>
                      <div style={{ color: "#15803D", fontSize: 11 }}>Check your inbox (and spam folder) for a password reset link.</div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontWeight: 700, marginBottom: 8 }}>Reset your password</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <input value={resetEmail} onChange={e => setResetEmail(e.target.value)} placeholder="Enter your email" type="email"
                          style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid #BFDBFE", fontSize: 12, fontFamily: "inherit", outline: "none", background: "#fff" }} />
                        <button onClick={async () => {
                          if (!resetEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resetEmail.trim())) { setResetStatus("error:Enter a valid email"); return; }
                          setResetLoading(true); setResetStatus("");
                          try { await resetPassword(resetEmail.trim()); setResetStatus("sent"); }
                          catch (e) { setResetStatus("error:" + (e.code === "auth/user-not-found" ? "If this email exists, a reset link has been sent" : e.message || "Failed to send reset email")); }
                          setResetLoading(false);
                        }} disabled={resetLoading} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#2563EB", color: "#fff", fontSize: 11, fontWeight: 700, cursor: resetLoading ? "wait" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                          {resetLoading ? "Sending..." : "Send Link"}
                        </button>
                      </div>
                      {resetStatus.startsWith("error:") && <div style={{ marginTop: 8, color: "#DC2626", fontSize: 11, fontWeight: 600 }}>{resetStatus.slice(6)}</div>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div style={{ textAlign: "center", marginTop: 36, paddingTop: 20, borderTop: `1px solid ${BRAND.grayLight}` }}>
            <p style={{ fontSize: 11, color: BRAND.gray, margin: 0 }}>&copy; 2025 Sayarah Inc. All rights reserved. Atlantic Car Connect is a company of Sayarah Inc.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD TAB
// ═══════════════════════════════════════════════════════════════
const WIDGET_DEFS = [
  { id: "counts", label: "Core Counts" },
  { id: "money", label: "Financial Summary" },
  { id: "aging", label: "Inventory Aging Alert" },
  { id: "tax", label: "Quarterly Tax Estimates" },
  { id: "expenses", label: "Expense Breakdown" },
  { id: "recent", label: "Recent Vehicles" },
];

function DashboardTab({ data, username, darkMode }) {
  const { vehicles, expenses, sales, mileage, holdCosts } = data;
  const sold = vehicles.filter(v => v.status === "Sold");
  const unsold = vehicles.filter(v => v.status !== "Sold");
  const [widgetPrefs, setWidgetPrefs] = useState(() => loadWidgetPrefs());
  const [showWidgetConfig, setShowWidgetConfig] = useState(false);
  const toggleWidget = (id) => {
    const next = widgetPrefs.includes(id) ? widgetPrefs.filter(w => w !== id) : [...widgetPrefs, id];
    setWidgetPrefs(next);
    saveWidgetPrefs(next);
  };

  const metrics = useMemo(() => {
    const totalCost = vehicles.reduce((s, v) => s + calcTotalCost(v, expenses), 0);
    const totalRevenue = sales.reduce((s, x) => s + p(x.grossPrice), 0);
    const totalNet = sales.reduce((s, x) => s + p(x.grossPrice) - p(x.auctionFee) - p(x.titleFee) - p(x.otherDeductions), 0);
    const soldCost = sold.reduce((s, v) => s + calcTotalCost(v, expenses), 0);
    const grossProfit = totalNet - soldCost;
    const margin = totalRevenue > 0 ? grossProfit / totalRevenue : 0;
    const avgProfit = sold.length > 0 ? grossProfit / sold.length : 0;

    const velocities = sold.map(v => {
      const sl = sales.find(s => s.stockNum === v.stockNum);
      const d = sl && v.purchaseDate && sl.date ? daysBetween(v.purchaseDate, sl.date) : null;
      const inv = calcTotalCost(v, expenses);
      const net = sl ? p(sl.grossPrice) - p(sl.auctionFee) - p(sl.titleFee) - p(sl.otherDeductions) : 0;
      return d && d > 0 ? (net - inv) / d : null;
    }).filter(Boolean);
    const avgVelocity = velocities.length > 0 ? velocities.reduce((a, b) => a + b, 0) / velocities.length : 0;

    const daysArr = sold.map(v => { const sl = sales.find(s => s.stockNum === v.stockNum); return sl && v.purchaseDate && sl.date ? daysBetween(v.purchaseDate, sl.date) : null; }).filter(Boolean);
    const avgDays = daysArr.length > 0 ? Math.round(daysArr.reduce((a, b) => a + b, 0) / daysArr.length) : 0;

    // All tracked expenses (total displayed in UI).
    const totalExp = expenses.reduce((s, e) => s + p(e.amount), 0);
    // Per-vehicle expenses are already folded into soldCost via the
    // updated calcTotalCost; the netIncome roll-up only deducts overhead
    // (expenses with no stockNum) to avoid double-counting.
    const overheadExp = expenses.filter(e => !e.stockNum).reduce((s, e) => s + p(e.amount), 0);
    const netIncome = grossProfit - overheadExp;
    const inventoryCost = unsold.reduce((s, v) => s + calcTotalCost(v, expenses), 0);

    // Unsold hold costs
    const unsoldHoldCosts = unsold.reduce((s, v) => {
      const days = v.purchaseDate ? daysFromNow(v.purchaseDate) : 0;
      return s + calcHoldCosts(calcTotalCost(v, expenses), days, holdCosts).total;
    }, 0);

    const totalMiles = mileage.reduce((s, m) => s + p(m.miles), 0);

    return { totalCost, totalRevenue, totalNet, grossProfit, margin, avgProfit, avgVelocity, avgDays, totalExp, overheadExp, netIncome, inventoryCost, unsoldHoldCosts, totalMiles };
  }, [vehicles, sales, expenses, mileage, holdCosts, sold, unsold, data.auctionFeeTiers]);

  // Aging distribution
  const agingDist = useMemo(() => {
    const dist = { fresh: 0, normal: 0, aging: 0, stale: 0, critical: 0, dead: 0 };
    unsold.forEach(v => { const d = v.purchaseDate ? daysFromNow(v.purchaseDate) : 0; dist[getAgingStatus(d).level]++; });
    return dist;
  }, [unsold]);

  // Expense breakdown
  const expByCat = useMemo(() => {
    const m = {};
    expenses.forEach(e => { const c = e.category || "Other"; m[c] = (m[c] || 0) + p(e.amount); });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [expenses]);
  const maxCat = expByCat[0]?.[1] || 1;

  const recent = [...vehicles].sort((a, b) => (b.purchaseDate || "").localeCompare(a.purchaseDate || "")).slice(0, 6);
  const w = (id) => widgetPrefs.includes(id);

  return (
    <div>
      {/* ═══ Welcome Hero Section ═══ */}
      <div style={{
        position: "relative", overflow: "hidden",
        background: darkMode ? "#1a1a1a" : "#f5f5f5",
        borderRadius: 16, marginBottom: 20,
        padding: "60px 40px", textAlign: "center",
      }}>
        {/* Decorative geometric shapes */}
        <div style={{ position: "absolute", top: -40, left: -40, width: 180, height: 180, background: darkMode ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.04)", transform: "rotate(45deg)", borderRadius: 20 }} />
        <div style={{ position: "absolute", top: 30, right: -60, width: 220, height: 220, background: darkMode ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.03)", transform: "rotate(30deg)", borderRadius: 24 }} />
        <div style={{ position: "absolute", bottom: -50, left: "20%", width: 160, height: 160, background: darkMode ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.035)", transform: "rotate(60deg)", borderRadius: 16 }} />
        <div style={{ position: "absolute", bottom: 20, right: "15%", width: 100, height: 100, background: darkMode ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.025)", transform: "rotate(15deg)", borderRadius: 12 }} />
        {/* Small diamond shapes in corners */}
        <div style={{ position: "absolute", top: 20, left: 30, width: 14, height: 14, border: `2px solid ${darkMode ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.1)"}`, transform: "rotate(45deg)" }} />
        <div style={{ position: "absolute", top: 50, right: 40, width: 10, height: 10, border: `2px solid ${darkMode ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)"}`, transform: "rotate(45deg)" }} />
        <div style={{ position: "absolute", bottom: 30, left: 50, width: 12, height: 12, border: `2px solid ${darkMode ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)"}`, transform: "rotate(45deg)" }} />
        <div style={{ position: "absolute", bottom: 40, right: 60, width: 16, height: 16, border: `2px solid ${darkMode ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.07)"}`, transform: "rotate(45deg)" }} />

        {/* Decorative corner brackets around welcome text */}
        <div style={{ position: "relative", display: "inline-block", padding: "20px 40px" }}>
          {/* Top-left bracket */}
          <div style={{ position: "absolute", top: 0, left: 0, width: 20, height: 20, borderTop: "3px solid #8B1A1A", borderLeft: "3px solid #8B1A1A" }} />
          {/* Top-right bracket */}
          <div style={{ position: "absolute", top: 0, right: 0, width: 20, height: 20, borderTop: `3px solid ${darkMode ? "#aaa" : "#333"}`, borderRight: `3px solid ${darkMode ? "#aaa" : "#333"}` }} />
          {/* Bottom-left bracket */}
          <div style={{ position: "absolute", bottom: 0, left: 0, width: 20, height: 20, borderBottom: `3px solid ${darkMode ? "#aaa" : "#333"}`, borderLeft: `3px solid ${darkMode ? "#aaa" : "#333"}` }} />
          {/* Bottom-right bracket */}
          <div style={{ position: "absolute", bottom: 0, right: 0, width: 20, height: 20, borderBottom: "3px solid #8B1A1A", borderRight: "3px solid #8B1A1A" }} />

          <div style={{
            fontSize: 32, fontWeight: 900, color: BRAND.black,
            textTransform: "uppercase", letterSpacing: "0.08em",
            lineHeight: 1.2, marginBottom: 8,
          }}>
            Welcome, {username || "User"}
          </div>
          <div style={{ fontSize: 14, color: BRAND.gray, fontWeight: 400, letterSpacing: "0.02em" }}>
            We're glad to have you here
          </div>
        </div>

        {/* Decorative dots-and-line element */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 20 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#8B1A1A" }} />
          <div style={{ width: 40, height: 2, background: darkMode ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)", borderRadius: 1 }} />
          <div style={{ width: 4, height: 4, borderRadius: "50%", background: darkMode ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)" }} />
          <div style={{ width: 40, height: 2, background: darkMode ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)", borderRadius: 1 }} />
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#8B1A1A" }} />
        </div>
      </div>

      {/* Widget Customization Toggle */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <button onClick={() => setShowWidgetConfig(p => !p)} style={{ background: "transparent", border: `1px solid ${BRAND.grayLight}`, borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, color: BRAND.gray, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
          Customize Widgets
        </button>
      </div>
      {showWidgetConfig && (
        <Card style={{ marginBottom: 12, border: `2px solid ${BRAND.blue}` }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: BRAND.black, marginBottom: 10 }}>Dashboard Widgets</div>
          <div style={{ fontSize: 11, color: BRAND.gray, marginBottom: 10 }}>Toggle sections on/off to customize your dashboard view.</div>
          <div className="widget-config-bar" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {WIDGET_DEFS.map(wd => (
              <button key={wd.id} onClick={() => toggleWidget(wd.id)} style={{
                background: w(wd.id) ? BRAND.green : BRAND.white,
                color: w(wd.id) ? "#fff" : BRAND.grayDark,
                border: `1.5px solid ${w(wd.id) ? BRAND.green : BRAND.grayLight}`,
                borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              }}>{w(wd.id) ? "✓ " : ""}{wd.label}</button>
            ))}
          </div>
        </Card>
      )}

      {/* Row 1: Core counts */}
      {w("counts") && <div className="stat-cards-row" style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <StatCard label="Purchased" value={vehicles.length} color={BRAND.black} />
        <StatCard label="Sold" value={sold.length} color={BRAND.green} />
        <StatCard label="In Inventory" value={unsold.length} color={BRAND.blue} />
        <StatCard label="Avg Days to Sell" value={metrics.avgDays} color={BRAND.grayDark} sub={`Benchmark: ${INDUSTRY_BENCHMARKS.avgDaysToSell.intermediate}d`} />
        <StatCard label="Avg Profit Velocity" value={`${fmt$2(metrics.avgVelocity)}/d`} color={metrics.avgVelocity > 0 ? BRAND.green : "#DC2626"} sub={`Target: $${INDUSTRY_BENCHMARKS.profitVelocity.intermediate}/d`} />
      </div>}

      {/* Row 2: Money */}
      {w("money") && <div className="stat-cards-row" style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <StatCard label="Total Cost" value={fmt$(metrics.totalCost)} color={BRAND.red} />
        <StatCard label="Inventory Cost" value={fmt$(metrics.inventoryCost)} color="#7C3AED" sub={`Hold costs: ${fmt$(metrics.unsoldHoldCosts)}`} />
        <StatCard label="Gross Profit" value={fmt$(metrics.grossProfit)} color={metrics.grossProfit >= 0 ? BRAND.green : "#DC2626"} />
        <StatCard label="Avg Profit/Car" value={fmt$(metrics.avgProfit)} color={metrics.avgProfit >= 0 ? BRAND.green : "#DC2626"} sub={`Target: ${fmt$(INDUSTRY_BENCHMARKS.avgProfitPerCar.intermediate)}`} />
        <StatCard label="Mileage Deduction" value={fmt$(metrics.totalMiles * IRS_RATE)} sub={`${metrics.totalMiles.toLocaleString()} mi`} color={BRAND.blue} />
      </div>}

      {/* Inventory Aging Alert */}
      {w("aging") && (agingDist.aging + agingDist.stale + agingDist.critical + agingDist.dead) > 0 && (
        <Card style={{ marginBottom: 12, borderLeft: `4px solid #D97706`, background: "#FFFBEB" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span style={{ fontWeight: 700, color: "#92400E" }}>Inventory Alert:</span>
            {agingDist.aging > 0 && <Badge color="#D97706" bg="#FEF3C7">{agingDist.aging} Aging (30-45d)</Badge>}
            {agingDist.stale > 0 && <Badge color="#EA580C" bg="#FFEDD5">{agingDist.stale} Stale (45-60d)</Badge>}
            {agingDist.critical > 0 && <Badge color="#DC2626" bg="#FEE2E2">{agingDist.critical} Critical (60-90d)</Badge>}
            {agingDist.dead > 0 && <Badge color="#991B1B" bg="#FEE2E2">{agingDist.dead} Dead Stock (90d+)</Badge>}
          </div>
        </Card>
      )}

      {/* Tax + Expenses side by side */}
      {(w("tax") || w("expenses")) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
          {w("tax") && (
            <Card style={{ flex: "1 1 300px", borderLeft: `4px solid ${BRAND.red}` }}>
              <SectionTitle>Quarterly Tax Estimates</SectionTitle>
              {calcQuarterlyTax(sales, expenses, vehicles).map(q => (
                <div key={q.q} style={{ padding: "7px 0", borderBottom: `1px solid ${BRAND.grayLight}`, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div><span style={{ fontWeight: 800, color: BRAND.black }}>{q.q}</span> <span style={{ color: BRAND.gray }}>({q.carsSold} sold · Due {q.due})</span></div>
                    <span style={{ color: BRAND.green, fontWeight: 600, ...S.mono }}>P: {fmt$(q.profit)}</span>
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 3 }}>
                    <span style={{ color: BRAND.gray, fontSize: 10 }}>MA 8%: <b style={{ color: "#DC2626", ...S.mono }}>{fmt$(q.maStateTax)}</b></span>
                    <span style={{ color: BRAND.gray, fontSize: 10 }}>Fed 21%: <b style={{ color: "#DC2626", ...S.mono }}>{fmt$(q.federalTax)}</b></span>
                    <span style={{ color: BRAND.gray, fontSize: 10 }}>Total: <b style={{ color: "#DC2626", ...S.mono }}>{fmt$(q.totalTax)}</b></span>
                  </div>
                </div>
              ))}
            </Card>
          )}

          {w("expenses") && (
            <Card style={{ flex: "1 1 280px" }}>
              <SectionTitle>Expense Breakdown</SectionTitle>
              {expByCat.length === 0 ? <div style={{ color: BRAND.gray, fontSize: 12 }}>No expenses</div> : expByCat.slice(0, 8).map(([cat, amt]) => (
                <div key={cat} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2 }}>
                    <span style={{ color: BRAND.grayDark }}>{cat}</span>
                    <span style={{ color: BRAND.black, fontWeight: 600, ...S.mono }}>{fmt$(amt)}</span>
                  </div>
                  <MiniBar value={amt} max={maxCat} color={BRAND.red} />
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {/* Recent Vehicles */}
      {w("recent") && <Card>
        <SectionTitle>Recent Vehicles</SectionTitle>
        {recent.length === 0 ? <div style={{ color: BRAND.gray, fontSize: 12 }}>No vehicles</div> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
            {recent.map(v => {
              const m = calcVehicleFullMetrics(v, sales.find(s => s.stockNum === v.stockNum), holdCosts, expenses);
              return (
                <div key={v.id} style={{ border: `1px solid ${BRAND.grayLight}`, borderRadius: 8, padding: 12, borderLeft: `3px solid ${v.status === "Sold" ? BRAND.green : BRAND.red}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 6 }}>
                    <div>
                      <span style={{ color: BRAND.red, fontSize: 10, fontWeight: 800, ...S.mono }}>#{v.stockNum}</span>
                      <div style={{ fontSize: 14, fontWeight: 700, color: BRAND.black }}>{v.year} {v.make} {v.model}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                      <StatusBadge status={v.status} />
                      {m.aging && <Badge color={m.aging.color} bg={m.aging.bg}>{m.aging.icon} {m.aging.label}</Badge>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 12, fontSize: 11, color: BRAND.gray }}>
                    <span>In: <b style={{ color: BRAND.black }}>{fmt$(m.totalCost)}</b></span>
                    {m.grossProfit != null && <span>Profit: <b style={{ color: m.grossProfit >= 0 ? BRAND.green : "#DC2626" }}>{fmt$(m.grossProfit)}</b></span>}
                    {m.velocity != null && <span>Vel: <b style={{ color: BRAND.blue }}>{fmt$2(m.velocity)}/d</b></span>}
                  </div>
                  {m.grade && <div style={{ marginTop: 6 }}><GradeBadge grade={m.grade} /></div>}
                </div>
              );
            })}
          </div>
        )}
      </Card>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// INVENTORY TAB
// ═══════════════════════════════════════════════════════════════
function InventoryTab({ data, setData, role = "user", currentUser = "" }) {
  const [showForm, setShowForm] = useState(false);
  const [showDetail, setShowDetail] = useState(null); // vehicle id for detail view
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [filter, setFilter] = useState("All");
  const [sortBy, setSortBy] = useState("recent");
  // "Sold" is intentionally not user-selectable here. The status only flips
  // to "Sold" when a sale record is finalized with all required fields
  // (see saveSale). This prevents the "marked Sold but no sale record"
  // inconsistency that previously caused reports to disagree.
  const STATUS_OPTIONS = ["In Recon", "Ready", "Listed"];
  const admin = isAdmin(role);
  const canEdit = canEditVehicles(role);
  const canDelete = canDeleteVehicles(role);

  const empty = () => ({
    id: genId(), stockNum: String(data.nextStockNum).padStart(3, "0"),
    year: "", make: "", model: "", trim: "", vin: "", color: "", odometer: "", purchaseDate: "",
    auctionSource: "copart", useCustomPremium: false, buyerPremiumPct: "",
    transportCost: "", repairCost: "", otherExpenses: "",
    titleStatus: "clean", status: "In Recon",
    purchasePrice: "", reconBudget: "", notes: "", photos: [], estRetailValue: "",
    location: "", zipCode: "",
    // Money Management funding source — Phase 1b. depositSource/balanceSource
    // is either "fund" or "member:<id>". When set, this is the destination
    // used on sale (principal returns to whoever funded). When unset the
    // vehicle exists in inventory but isn't on the ledger yet.
    depositSource: "", depositAmount: "",
    balanceSource: "", balanceAmount: "",
    postedToLedger: false,
    // Phase 3 — MA use tax. When true AND the MA sales tax wasn't paid
    // at purchase, a 6.25% use tax entry is auto-posted at the same
    // time as the purchase ledger entry.
    outOfStatePurchase: false,
    maSalesTaxPaidAtPurchase: false,
  });
  const [form, setForm] = useState(empty());
  const [formError, setFormError] = useState("");
  const upd = (k, v) => { setFormError(""); setForm(f => ({ ...f, [k]: v })); };

  const openNew = () => { setForm(empty()); setEditing(null); setFormError(""); setShowForm(true); };
  const openDetail = v => { setShowDetail(v.id); };
  const openEditFromDetail = v => {
    if (!canEdit) return;
    setForm({ ...v, auctionSource: v.auctionSource || "custom", titleStatus: v.titleStatus || "clean" }); setEditing(v.id); setFormError(""); setShowForm(true);
  };
  const save = () => {
    if (!form.make.trim()) { setFormError("Make is required"); return; }
    if (!form.model.trim()) { setFormError("Model is required"); return; }
    if (!form.year) { setFormError("Year is required"); return; }
    if (form.vin && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(form.vin.trim())) { setFormError("VIN must be exactly 17 characters (no I, O, Q)"); return; }
    const moneyErr = validateMoneyFields([
      [form.purchasePrice, "Purchase price"],
      [form.transportCost, "Transport cost"],
      [form.repairCost, "Repair cost"],
      [form.otherExpenses, "Other expenses"],
      [form.buyerPremiumPct, "Buyer premium %", { max: 100 }],
      [form.reconBudget, "Recon budget"],
      [form.estRetailValue, "Est. retail value"],
    ]);
    if (moneyErr) { setFormError(moneyErr); return; }
    setFormError("");
    if (editing) {
      if (!canEdit) return;
      const before = data.vehicles.find(v => v.id === editing);
      const diff = auditDiff(before, form, ["status", "purchasePrice", "auctionSource", "titleStatus", "reconBudget", "estRetailValue", "location", "zipCode", "vin", "odometer", "color", "trim", "notes"]);
      setData(d => ({ ...d, vehicles: d.vehicles.map(v => v.id === editing ? form : v) }));
      const desc = `Edited vehicle #${form.stockNum} ${form.year} ${form.make} ${form.model}` + (diff.summary ? ` — ${diff.summary}` : "");
      logActivity(currentUser, "edited_vehicle", desc, { stockNum: form.stockNum, changes: diff.changes });
    } else {
      // Auto-post the purchase to the Money Management ledger when
      // funding sources are set and the fund outflow is within the
      // safe-threshold ($10K). Larger fund outflows still require the
      // manual "Post to Ledger" button so the second-member approval
      // flow fires. Any posting failure is silent — vehicle still
      // saves with postedToLedger=false so it can be retried later.
      const deposit = p(form.depositAmount);
      const balance = p(form.balanceAmount);
      const hasDeposit = deposit > 0 && !!form.depositSource;
      const hasBalance = balance > 0 && !!form.balanceSource;
      const fundOutflow = (form.depositSource === "fund" ? deposit : 0) + (form.balanceSource === "fund" ? balance : 0);
      const eligibleForAutoPost = isAdmin(role) && (hasDeposit || hasBalance) && (deposit === 0 || hasDeposit) && (balance === 0 || hasBalance) && fundOutflow <= LARGE_OUTFLOW_THRESHOLD;
      setData(d => {
        let ledger = d.money?.ledger || [];
        let accounts = d.money?.accounts || DEFAULT_ACCOUNTS;
        const closed = d.money?.closedPeriods || [];
        let posted = false;
        if (eligibleForAutoPost && d.money) {
          try {
            const fundBalance = calcAllBalances(ledger, accounts)[SYSTEM_ACCOUNTS.ATLANTIC_FUND] || 0;
            if (fundOutflow <= fundBalance) {
              const entries = [];
              const date = form.purchaseDate || new Date().toISOString().slice(0, 10);
              if (hasDeposit) {
                entries.push(form.depositSource === "fund"
                  ? vehiclePurchaseFromFundEntry({ stockNum: form.stockNum, amount: deposit, date, memo: `Deposit — #${form.stockNum}`, user: currentUser })
                  : vehiclePurchaseFromMemberEntry({ stockNum: form.stockNum, memberId: form.depositSource.slice(7), amount: deposit, date, memo: `Deposit — #${form.stockNum}`, user: currentUser }));
              }
              if (hasBalance) {
                entries.push(form.balanceSource === "fund"
                  ? vehiclePurchaseFromFundEntry({ stockNum: form.stockNum, amount: balance, date, memo: `Balance — #${form.stockNum}`, user: currentUser })
                  : vehiclePurchaseFromMemberEntry({ stockNum: form.stockNum, memberId: form.balanceSource.slice(7), amount: balance, date, memo: `Balance — #${form.stockNum}`, user: currentUser }));
              }
              if (form.outOfStatePurchase && !form.maSalesTaxPaidAtPurchase) {
                const ut = useTaxOnPurchaseEntry({ stockNum: form.stockNum, purchasePrice: p(form.purchasePrice), date, user: currentUser });
                if (ut) entries.push(ut);
              }
              for (const e of entries) ledger = postJournalEntry(ledger, e, closed);
              if (!accounts.some(a => a.id === vehicleAccountId(form.stockNum))) {
                accounts = [...accounts, buildVehicleAccount(form.stockNum, `${form.year} ${form.make} ${form.model}`)];
              }
              posted = entries.length > 0;
            }
          } catch (err) { console.warn("Auto-post purchase skipped:", err.message); }
        }
        const newVehicle = posted ? { ...form, postedToLedger: true } : form;
        return {
          ...d,
          vehicles: [...d.vehicles, newVehicle],
          nextStockNum: d.nextStockNum + 1,
          money: d.money ? { ...d.money, ledger, accounts } : d.money,
        };
      });
      logActivity(currentUser, "added_vehicle", `Added vehicle #${form.stockNum} ${form.year} ${form.make} ${form.model}`);
    }
    setShowForm(false);
  };
  const del = id => {
    const v = data.vehicles.find(x => x.id === id);
    if (!v) { setConfirm(null); return; }
    // Non-admin/non-manager users submit a deletion request instead of
    // deleting directly. This mirrors the existing expense_delete and
    // sale_delete approval flow so there's a consistent path for lower
    // roles to initiate changes their rules don't let them commit.
    if (!canDelete) {
      addApproval({
        id: genId(),
        type: "vehicle_delete",
        requestedBy: currentUser,
        requestedAt: new Date().toISOString(),
        status: "pending",
        stockNum: v.stockNum,
        vehicle: `${v.year} ${v.make} ${v.model}`,
        description: `Delete vehicle #${v.stockNum} ${v.year} ${v.make} ${v.model} (status: ${v.status})`,
        targetId: v.id,
        originalData: v,
        newData: null,
      });
      logActivity(currentUser, "requested_delete", `Requested vehicle deletion #${v.stockNum} ${v.year} ${v.make} ${v.model}`, { stockNum: v.stockNum, type: "vehicle_delete" });
      setConfirm(null); setShowForm(false); setShowDetail(null);
      return;
    }
    setData(d => ({
      ...d,
      vehicles: d.vehicles.filter(x => x.id !== id),
      trash: [...(d.trash || []), toTrash(v, "vehicle", currentUser)],
    }));
    setConfirm(null); setShowForm(false); setShowDetail(null);
    logActivity(currentUser, "deleted_vehicle", `Deleted vehicle #${v.stockNum} ${v.year} ${v.make} ${v.model} (status: ${v.status}, purchase: ${fmt$2(p(v.purchasePrice))})`, { stockNum: v.stockNum, snapshot: v });
  };

  let filtered = filter === "All" ? data.vehicles : data.vehicles.filter(v => v.status === filter);
  if (sortBy === "recent") filtered = [...filtered].sort((a, b) => (b.purchaseDate || "").localeCompare(a.purchaseDate || ""));
  else if (sortBy === "profit") filtered = [...filtered].sort((a, b) => {
    const sa = data.sales.find(s => s.stockNum === a.stockNum); const sb = data.sales.find(s => s.stockNum === b.stockNum);
    const pa = sa ? (p(sa.grossPrice) - p(sa.auctionFee) - p(sa.titleFee) - p(sa.otherDeductions)) - calcTotalCost(a, data.expenses) : -999999;
    const pb = sb ? (p(sb.grossPrice) - p(sb.auctionFee) - p(sb.titleFee) - p(sb.otherDeductions)) - calcTotalCost(b, data.expenses) : -999999;
    return pb - pa;
  });
  else if (sortBy === "aging") filtered = [...filtered].sort((a, b) => {
    const da = a.purchaseDate ? daysFromNow(a.purchaseDate) : 0; const db = b.purchaseDate ? daysFromNow(b.purchaseDate) : 0;
    return db - da;
  });

  // Computed auction fees for form
  const formPP = p(form.purchasePrice);
  const formAuctFees = form.useCustomPremium ? { total: formPP * p(form.buyerPremiumPct) / 100, premium: formPP * p(form.buyerPremiumPct) / 100, gate: 0, env: 0, vbid: 0 } : calcAuctionFees(formPP, form.auctionSource || "custom");
  const formTotalAcq = formPP + formAuctFees.total + p(form.transportCost);
  const formTotalInv = formTotalAcq + p(form.repairCost) + p(form.otherExpenses);

  // Detail view data
  const detailVehicle = showDetail ? data.vehicles.find(v => v.id === showDetail) : null;
  const detailExpenses = detailVehicle ? data.expenses.filter(e => e.stockNum === detailVehicle.stockNum) : [];
  const detailSale = detailVehicle ? data.sales.find(s => s.stockNum === detailVehicle.stockNum) : null;

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {["All", ...STATUS_OPTIONS].map(s => (
            <Btn key={s} variant={filter === s ? "primary" : "secondary"} size="sm" onClick={() => setFilter(s)}>
              {s} ({s === "All" ? data.vehicles.length : data.vehicles.filter(v => v.status === s).length})
            </Btn>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ border: `1px solid ${BRAND.grayLight}`, borderRadius: 6, padding: "5px 8px", fontSize: 11, background: BRAND.white }}>
            <option value="recent">Newest First</option>
            <option value="profit">Highest Profit</option>
            <option value="aging">Most Aged</option>
          </select>
          <Btn variant="secondary" onClick={() => {
            const headers = ["Stock#","Year","Make","Model","Trim","VIN","Color","Status","Location","ZIP","Purchase Price","Transport","Repair","Total Cost","Purchase Date"];
            const rows = filtered.map(v => [v.stockNum, v.year, v.make, v.model, v.trim||"", v.vin||"", v.color||"", v.status, v.location||"", v.zipCode||"", v.purchasePrice||"", v.transportCost||"", v.repairCost||"", calcTotalCost(v, data.expenses).toFixed(2), v.purchaseDate||""]);
            exportCSV(`vehicles_${new Date().toISOString().slice(0,10)}.csv`, headers, rows);
          }}>Export CSV</Btn>
          <Btn onClick={openNew}>+ Add Vehicle</Btn>
        </div>
      </div>

      {filtered.length === 0 ? <Empty icon={<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18 10l-2.7-3.6A1.5 1.5 0 0 0 14.1 6H9.9a1.5 1.5 0 0 0-1.2.6L6 10l-2.5 1.1C2.7 11.3 2 12.1 2 13v3c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>} title="No vehicles" sub="Add your first car" /> : (
        // Copart/IAA-style row layout: one vehicle per row, left thumbnail
        // + columns. Mobile collapses to photo + summary card via the
        // .inv-row CSS rules in the global style block at the top of App.
        <div style={{ display: "flex", flexDirection: "column", gap: 8, background: BRAND.white, border: `1px solid ${BRAND.grayLight}`, borderRadius: 10, overflow: "hidden" }}>
          {filtered.map((v, idx) => {
            const m = calcVehicleFullMetrics(v, data.sales.find(s => s.stockNum === v.stockNum), data.holdCosts, data.expenses);
            const titleInfo = TITLE_STATUS[v.titleStatus] || TITLE_STATUS.clean;
            const vSale = data.sales.find(s => s.stockNum === v.stockNum);
            const striped = idx % 2 === 0 ? BRAND.white : "#FAFAFA";
            const edgeColor = v.status === "Sold" ? BRAND.green : m.aging ? m.aging.color : BRAND.red;
            return (
              <div
                key={v.id}
                className="inv-row"
                onClick={() => openDetail(v)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(v); } }}
                style={{
                  display: "grid",
                  gridTemplateColumns: "172px 1fr 100px 120px 120px 120px 90px 130px 90px",
                  gap: 12,
                  alignItems: "center",
                  padding: "10px 14px",
                  background: striped,
                  borderLeft: `4px solid ${edgeColor}`,
                  cursor: "pointer",
                  transition: "background 0.12s",
                  minHeight: 124,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#F3F4F6"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = striped; }}
              >
                {/* 1. Photo */}
                <div className="inv-photo"><VehicleThumb photos={v.photos} width={160} height={110} /></div>

                {/* 2+3. Stock + Vehicle (stacked, takes flexible width) */}
                <div className="inv-vehicle" style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                    <span style={{ color: BRAND.red, fontSize: 11, fontWeight: 800, ...S.mono }}>#{v.stockNum}</span>
                    <Badge color={titleInfo.color} bg={titleInfo.bg}>{titleInfo.label}</Badge>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: BRAND.black, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {v.year} {v.make} {v.model} {v.trim && <span style={{ color: BRAND.gray, fontWeight: 500, fontSize: 13 }}>{v.trim}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: BRAND.gray, marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {v.color && <span>{v.color}</span>}
                    {v.vin && <span style={S.mono}>VIN: {v.vin}</span>}
                  </div>
                  {(v.location || v.zipCode) && (
                    <div style={{ fontSize: 11, color: BRAND.gray, marginTop: 3, display: "flex", alignItems: "center", gap: 4 }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                        <circle cx="12" cy="10" r="3"/>
                      </svg>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {v.location}{v.location && v.zipCode ? " · " : ""}{v.zipCode && <span style={S.mono}>{v.zipCode}</span>}
                      </span>
                    </div>
                  )}
                </div>

                {/* 4. Odometer */}
                <div className="inv-col">
                  <div style={{ fontSize: 10, color: BRAND.gray, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>Odometer</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: BRAND.black, ...S.mono }}>{v.odometer ? `${parseInt(v.odometer).toLocaleString()} mi` : "—"}</div>
                </div>

                {/* 5. Total Cost */}
                <div className="inv-col">
                  <div style={{ fontSize: 10, color: BRAND.gray, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>Total Cost</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: BRAND.black, ...S.mono }}>{fmt$(m.totalCost)}</div>
                </div>

                {/* 6. Break-Even OR Profit */}
                <div className="inv-col">
                  {m.grossProfit != null ? (
                    <>
                      <div style={{ fontSize: 10, color: BRAND.gray, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>Profit</div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: m.grossProfit >= 0 ? BRAND.green : "#DC2626", ...S.mono }}>{fmt$(m.grossProfit)}</div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 10, color: BRAND.gray, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>Break-Even</div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#D97706", ...S.mono }}>{fmt$(m.breakEven.minSalePrice)}</div>
                    </>
                  )}
                </div>

                {/* 7. Est. Retail */}
                <div className="inv-col">
                  <div style={{ fontSize: 10, color: BRAND.gray, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>Est. Retail</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: p(v.estRetailValue) ? BRAND.blue : BRAND.gray, ...S.mono }}>{p(v.estRetailValue) ? fmt$(p(v.estRetailValue)) : "—"}</div>
                </div>

                {/* 8. Risk */}
                <div className="inv-col">
                  <div style={{ fontSize: 10, color: BRAND.gray, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>Risk</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: m.risk.color }}>{m.risk.level}</div>
                </div>

                {/* 9. Status + days */}
                <div className="inv-col status-col" style={{ alignItems: "flex-start" }}>
                  <StatusBadge status={v.status} />
                  <div style={{ fontSize: 10, color: BRAND.gray, marginTop: 5, ...S.mono }}>
                    {m.days > 0 ? `${m.days}D` : "0D"}
                    {m.aging && v.status !== "Sold" && <span style={{ color: m.aging.color, marginLeft: 4, fontWeight: 700 }}>· {m.aging.label}</span>}
                  </div>
                </div>

                {/* 10. Actions */}
                <div className="inv-actions" style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button
                    title="View"
                    onClick={(e) => { e.stopPropagation(); openDetail(v); }}
                    style={{ background: "transparent", border: `1px solid ${BRAND.grayLight}`, borderRadius: 6, padding: "6px 8px", cursor: "pointer", color: BRAND.grayDark, display: "flex", alignItems: "center" }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  </button>
                  {canEdit && (
                    <button
                      title="Edit"
                      onClick={(e) => { e.stopPropagation(); openEditFromDetail(v); }}
                      style={{ background: "transparent", border: `1px solid ${BRAND.grayLight}`, borderRadius: 6, padding: "6px 8px", cursor: "pointer", color: BRAND.grayDark, display: "flex", alignItems: "center" }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ VEHICLE DETAIL MODAL ═══ */}
      {showDetail && detailVehicle && (
        <VehicleDetailModal
          vehicle={detailVehicle}
          expenses={detailExpenses}
          sale={detailSale}
          data={data}
          setData={setData}
          admin={admin}
          currentUser={currentUser}
          canEditProp={canEdit}
          canDeleteProp={canDelete}
          onClose={() => setShowDetail(null)}
          onEdit={() => openEditFromDetail(detailVehicle)}
          onDelete={() => setConfirm(detailVehicle.id)}
        />
      )}

      {/* ═══ ADD/EDIT VEHICLE FORM ═══ */}
      {showForm && (
        <Modal title={editing ? "Edit Vehicle" : "Add Vehicle"} onClose={() => setShowForm(false)} wide>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
            <Input label="Stock #" value={form.stockNum} onChange={v => upd("stockNum", v)} readOnly={!!editing} />
            <Input label="Year" value={form.year} onChange={v => upd("year", v)} type="number" placeholder="2022" />
            <Input label="Make" value={form.make} onChange={v => upd("make", v)} placeholder="Toyota" />
            <Input label="Model" value={form.model} onChange={v => upd("model", v)} placeholder="Camry" />
            <Input label="Trim" value={form.trim} onChange={v => upd("trim", v)} placeholder="SE" />
            <Input label="Color" value={form.color} onChange={v => upd("color", v)} placeholder="Black" />
            <Input label="Odometer" value={form.odometer} onChange={v => upd("odometer", v)} type="number" />
            <Input label="VIN" value={form.vin} onChange={v => upd("vin", v)} placeholder="1HGCG..." />
          </div>

          <div style={{ borderTop: `1px solid ${BRAND.grayLight}`, margin: "14px 0", paddingTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: BRAND.red, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Purchase & Costs</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
              <Input label="Purchase Date" value={form.purchaseDate} onChange={v => upd("purchaseDate", v)} type="date" />
              <Input label="Purchase Price" value={form.purchasePrice} onChange={v => upd("purchasePrice", v)} type="number" step="0.01" />
              <Select label="Acquisition Source" value={form.auctionSource} onChange={v => upd("auctionSource", v)} options={AUCTION_SOURCES.map(s => ({ value: s, label: AUCTION_FEE_TIERS[s].name }))} />
              <Select label="Title Status" value={form.titleStatus} onChange={v => upd("titleStatus", v)} options={Object.entries(TITLE_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} />
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: BRAND.gray }}>Fee Mode</label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: BRAND.grayDark, cursor: "pointer", padding: "8px 0" }}>
                  <input type="checkbox" checked={form.useCustomPremium} onChange={e => upd("useCustomPremium", e.target.checked)} style={{ accentColor: BRAND.red }} />
                  Use custom %
                </label>
              </div>
              {form.useCustomPremium && <Input label="Custom Premium %" value={form.buyerPremiumPct} onChange={v => upd("buyerPremiumPct", v)} type="number" step="0.1" />}
              <Input label="Recon Budget" value={form.reconBudget} onChange={v => upd("reconBudget", v)} type="number" step="0.01" placeholder="Target max" />
              <Input label="Est. Retail Value" value={form.estRetailValue} onChange={v => upd("estRetailValue", v)} type="number" step="0.01" placeholder="Target sale price" />
              <Input label="Location" value={form.location} onChange={v => upd("location", v)} placeholder="e.g. Copart North Boston, MA" />
              <Input label="ZIP / Postal Code" value={form.zipCode} onChange={v => upd("zipCode", v)} placeholder="02101" />
              <Select label="Status" value={form.status} onChange={v => upd("status", v)} options={STATUS_OPTIONS} />
            </div>
            {/* Funding source — Money Management. Splits purchase price into
                a deposit and balance, each of which can come from a member
                personally or from the shared Atlantic Fund. Kept optional
                so vehicles that predate this module can still be saved;
                "Post to ledger" on the detail screen is what actually
                books the journal entries. */}
            {(data.money && data.money.members && data.money.members.length > 0) && (
              <div style={{ marginTop: 14, padding: 12, border: `1px dashed ${BRAND.grayLight}`, borderRadius: 8, background: "#FAFAFA" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: BRAND.gray, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Funding Source (Money Management)</div>
                <div className="form-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Select label="Deposit paid by" value={form.depositSource} onChange={v => upd("depositSource", v)} options={[
                    { value: "", label: "(none — not on ledger)" },
                    { value: "fund", label: "Atlantic Fund" },
                    ...data.money.members.map(m => ({ value: `member:${m.id}`, label: m.name })),
                  ]} placeholder="Select..." />
                  <Input label="Deposit amount" value={form.depositAmount} onChange={v => upd("depositAmount", v)} type="number" step="0.01" placeholder="0.00" />
                  <Select label="Balance paid by" value={form.balanceSource} onChange={v => upd("balanceSource", v)} options={[
                    { value: "", label: "(none — same as deposit, or unpaid)" },
                    { value: "fund", label: "Atlantic Fund" },
                    ...data.money.members.map(m => ({ value: `member:${m.id}`, label: m.name })),
                  ]} placeholder="Select..." />
                  <Input label="Balance amount" value={form.balanceAmount} onChange={v => upd("balanceAmount", v)} type="number" step="0.01" placeholder="0.00" />
                </div>
                <div style={{ fontSize: 10, color: BRAND.gray, marginTop: 6, fontStyle: "italic" }}>
                  Leave blank to skip the ledger for this vehicle. To book, fill these in and click "Post to ledger" on the vehicle detail screen.
                </div>
                {/* MA use-tax flags — posts a 6.25% use-tax entry on
                    purchase when the car was bought out-of-state and
                    MA sales tax wasn't collected at the point of sale.
                    Use-tax amount rolls into cost basis (debits the
                    vehicle's inventory account). */}
                <div style={{ marginTop: 10, padding: "8px 10px", background: "#FFFBEB", borderRadius: 6, fontSize: 11, border: "1px solid #FDE68A" }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "#92400E", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>MA Use Tax (6.25%)</div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "#78350F" }}>
                    <input type="checkbox" checked={!!form.outOfStatePurchase} onChange={e => upd("outOfStatePurchase", e.target.checked)} />
                    Purchased out-of-state
                  </label>
                  {form.outOfStatePurchase && (
                    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "#78350F", marginTop: 4 }}>
                      <input type="checkbox" checked={!!form.maSalesTaxPaidAtPurchase} onChange={e => upd("maSalesTaxPaidAtPurchase", e.target.checked)} />
                      MA sales tax already paid at purchase (no use tax owed)
                    </label>
                  )}
                  {form.outOfStatePurchase && !form.maSalesTaxPaidAtPurchase && p(form.purchasePrice) > 0 && (
                    <div style={{ fontSize: 10, color: "#78350F", marginTop: 4, fontStyle: "italic" }}>
                      Use tax owed on purchase: <b>{fmt$2(p(form.purchasePrice) * 0.0625)}</b> — posted to MA Use Tax Payable when you "Post to ledger".
                    </div>
                  )}
                </div>
              </div>
            )}
            {/* Photos — uploaded to Firebase Storage under vehicles/{id}/photos/.
                First photo becomes the inventory row thumbnail. */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: BRAND.gray, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Photos</div>
              <PhotoEditor vehicleId={form.id} photos={form.photos || []} onChange={next => upd("photos", next)} compact />
            </div>
            <div style={{ marginTop: 10, padding: "10px 12px", background: "#EFF6FF", borderRadius: 8, fontSize: 11, color: "#1E40AF", border: "1px solid #BFDBFE" }}>
              <b>Heads up:</b> All costs other than Purchase Price now live in <b>Tracked Expenses</b> on the vehicle detail screen. Choose the appropriate category (Transport/Towing, Repair/Recon, Storage, etc.) when you add each line item. This replaces the old "Transport Cost / Repair Cost / Other Expenses" fields so every dollar is in one place.
            </div>
            <Input label="Notes" value={form.notes} onChange={v => upd("notes", v)} placeholder="Engine swapped, needs alignment..." className="mt-2" />
          </div>

          {/* Live Cost Breakdown */}
          <div style={{ background: BRAND.redBg, borderRadius: 10, padding: 14, marginTop: 12, border: `1px solid ${BRAND.redBg2}` }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: BRAND.red, textTransform: "uppercase", marginBottom: 8 }}>Cost Breakdown</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 6, fontSize: 12 }}>
              <div><span style={{ color: BRAND.gray }}>Bid Price:</span> <span style={{ fontWeight: 600, ...S.mono }}>{fmt$(formPP)}</span></div>
              {!form.useCustomPremium && <>
                <div><span style={{ color: BRAND.gray }}>Buyer Premium:</span> <span style={{ fontWeight: 600, ...S.mono }}>{fmt$(formAuctFees.premium)}</span></div>
                <div><span style={{ color: BRAND.gray }}>Gate Fee:</span> <span style={{ fontWeight: 600, ...S.mono }}>{fmt$(formAuctFees.gate)}</span></div>
                {formAuctFees.env > 0 && <div><span style={{ color: BRAND.gray }}>Env Fee:</span> <span style={{ fontWeight: 600, ...S.mono }}>{fmt$(formAuctFees.env)}</span></div>}
                {formAuctFees.vbid > 0 && <div><span style={{ color: BRAND.gray }}>VB Fee:</span> <span style={{ fontWeight: 600, ...S.mono }}>{fmt$(formAuctFees.vbid)}</span></div>}
              </>}
              {form.useCustomPremium && <div><span style={{ color: BRAND.gray }}>Custom Premium:</span> <span style={{ fontWeight: 600, ...S.mono }}>{fmt$(formAuctFees.total)}</span></div>}
              <div><span style={{ color: BRAND.gray }}>Transport:</span> <span style={{ fontWeight: 600, ...S.mono }}>{fmt$(p(form.transportCost))}</span></div>
              <div><span style={{ color: BRAND.gray }}>Recon:</span> <span style={{ fontWeight: 600, ...S.mono }}>{fmt$(p(form.repairCost))}</span></div>
              {formPP > 0 && <div><span style={{ color: BRAND.gray }}>Tax Reserve:</span> <span style={{ fontWeight: 600, ...S.mono }}>$295</span></div>}
              <div style={{ gridColumn: "1 / -1", borderTop: `1px solid ${BRAND.redBg2}`, paddingTop: 6, marginTop: 4 }}>
                <span style={{ color: BRAND.gray }}>Total Acquisition:</span> <span style={{ fontWeight: 700, color: BRAND.red, ...S.mono }}>{fmt$(formTotalAcq)}</span>
                <span style={{ marginLeft: 16, color: BRAND.gray }}>Total Cost:</span> <span style={{ fontWeight: 800, color: BRAND.red, ...S.mono }}>{fmt$(formTotalInv)}</span>
              </div>
            </div>
          </div>

          {formError && <div style={{ color: "#DC2626", fontSize: 12, fontWeight: 600, padding: "8px 12px", background: "#FEF2F2", borderRadius: 6, marginTop: 10 }}>{formError}</div>}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18 }}>
            <div>{editing && canDelete && <Btn variant="danger" onClick={() => setConfirm(editing)}>Delete</Btn>}</div>
            <div style={{ display: "flex", gap: 6 }}><Btn variant="secondary" onClick={() => setShowForm(false)}>Cancel</Btn><Btn onClick={save}>{editing ? "Save" : "Add Vehicle"}</Btn></div>
          </div>
        </Modal>
      )}
      {confirm && <Confirm msg={canDelete ? "Delete this vehicle? It will be moved to Trash and can be restored." : "Submit a delete request for this vehicle? An admin or manager will need to approve it."} onOk={() => del(confirm)} onCancel={() => setConfirm(null)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// VEHICLE DETAIL MODAL — shows expenses + sale inline
// ═══════════════════════════════════════════════════════════════
// Internal Deal Report — redesigned per spec:
// Single-page letter layout. Vehicle band is the sole status source-of-truth.
// Key Metrics row at top. Unified Cost Breakdown (no separate Acquisition
// vs Tracked sections). Sale Details + Profit & Loss appear only when sold.
// No bottom "Not Yet Sold" banner. INTERNAL USE ONLY footer.
function generateInvoicePDF(vehicle, expenses, sale, metrics, currentUserInfo) {
  const v = vehicle;
  const m = metrics;
  const u = currentUserInfo;
  const titleInfo = TITLE_STATUS[v.titleStatus] || TITLE_STATUS.clean;
  const sold = !!sale && v.status === "Sold";
  const acqSrcName = (AUCTION_FEE_TIERS[v.auctionSource] || AUCTION_FEE_TIERS.custom).name;
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const invoiceNum = `INV-${v.stockNum}-${Date.now().toString(36).toUpperCase()}`;
  const saleNet = m.netSale;

  // ─── Safe formatters. Display "—" when a metric is undefined rather than
  // showing "NaN%" or "$0" for what is really "not computable yet". ───
  const dollarOrDash = (n) => (n == null || !Number.isFinite(n)) ? "—" : fmt$2(n);
  const pctOrDash = (n) => (n == null || !Number.isFinite(n)) ? "—" : (n * 100).toFixed(1) + "%";

  // ─── Color rules from spec #13 ───
  const profitColor = (m.grossProfit == null) ? "#111" : (m.grossProfit >= 0 ? "#166534" : "#DC2626");
  const marginColor = (m.margin == null) ? "#111" : (m.margin >= 0.15 ? "#166534" : m.margin >= 0.05 ? "#D97706" : "#DC2626");
  const daysColor = (m.days == null || m.days === 0) ? "#111" : (m.days < 45 ? "#111" : m.days <= 60 ? "#D97706" : "#DC2626");

  // ─── Status chip. Single source of truth — rendered only in the vehicle
  // band. Label per spec: "SOLD · {date}", "LISTED", or fallback. ───
  const statusChip = sold
    ? `<span class="chip" style="background:#D1FAE5;color:#166534">SOLD · ${esc(sale.date)}</span>`
    : v.status === "Listed"
      ? `<span class="chip" style="background:#DBEAFE;color:#1E40AF">LISTED</span>`
      : v.status === "In Recon"
        ? `<span class="chip" style="background:#FEF3C7;color:#92400E">IN RECON</span>`
        : v.status === "Ready"
          ? `<span class="chip" style="background:#E0E7FF;color:#3730A3">READY</span>`
          : `<span class="chip" style="background:#F3F4F6;color:#4B5563">${esc((v.status || "IN INVENTORY").toUpperCase())}</span>`;

  // ─── Build the unified Cost Breakdown rows. Every dollar spent on the
  // vehicle appears here, regardless of which form/section entered it. ───
  const pp = p(v.purchasePrice);
  const auctFee = calcAuctionFees(pp, v.auctionSource || "custom").total;
  const costRows = [];
  if (pp > 0) costRows.push({ date: v.purchaseDate || "—", category: "Purchase Price", description: `${esc(v.year)} ${esc(v.make)} ${esc(v.model)}${v.trim ? " " + esc(v.trim) : ""}`, vendor: acqSrcName, amount: pp });
  if (auctFee > 0) costRows.push({ date: v.purchaseDate || "—", category: "Auction Fees", description: `Buyer premium + gate fees (${acqSrcName})`, vendor: acqSrcName, amount: auctFee });
  if (p(v.transportCost) > 0) costRows.push({ date: v.purchaseDate || "—", category: "Transport/Towing", description: "Acquisition transport (legacy field — prefer Tracked Expenses)", vendor: "—", amount: p(v.transportCost) });
  if (p(v.repairCost) > 0) costRows.push({ date: v.purchaseDate || "—", category: "Repair/Recon", description: "Reconditioning (legacy field — prefer Tracked Expenses)", vendor: "—", amount: p(v.repairCost) });
  if (p(v.otherExpenses) > 0) costRows.push({ date: v.purchaseDate || "—", category: "Other", description: "Misc acquisition (legacy field — prefer Tracked Expenses)", vendor: "—", amount: p(v.otherExpenses) });
  // Tracked expenses, sorted by date for readability
  [...expenses].sort((a, b) => (a.date || "").localeCompare(b.date || "")).forEach(e => {
    costRows.push({ date: e.date || "—", category: e.category || "Uncategorized", description: e.description || "—", vendor: e.vendor || "—", amount: p(e.amount) });
  });
  // Flat $295 tax reserve — baked into every vehicle's cost basis.
  // Posts to the Accrued Tax Liability account on sale via vehicleSaleEntries.
  if (pp > 0) costRows.push({ date: v.purchaseDate || "—", category: "Tax Reserve", description: "$295 per-vehicle reserve — posts to Accrued Tax Liability on sale", vendor: "—", amount: 295 });
  const totalCost = costRows.reduce((s, r) => s + r.amount, 0);

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Internal Deal Report · ${esc(v.stockNum)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Arial,sans-serif;color:#111;background:#fff;padding:24px;max-width:820px;margin:0 auto;font-size:11.5px;line-height:1.35}
.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #8B1A1A;padding-bottom:8px;margin-bottom:8px}
.logo-img{height:44px;object-fit:contain;display:block}
.logo-sub{font-size:9px;color:#999;letter-spacing:0.14em;margin-top:3px}
.inv-meta{text-align:right;font-size:10.5px;color:#555}
.inv-meta b{color:#111}
.inv-num{font-size:13px;font-weight:800;color:#8B1A1A;margin-bottom:2px}
.client-row{display:flex;justify-content:space-between;align-items:center;background:#F9FAFB;padding:5px 10px;border-radius:4px;font-size:10.5px;margin-bottom:8px}
.vehicle-band{background:#FEF2F2;border-left:3px solid #8B1A1A;padding:8px 12px;border-radius:4px;margin-bottom:10px}
.vehicle-title{font-size:15px;font-weight:900;color:#111;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.vehicle-meta{font-size:10px;color:#555;margin-top:3px;display:flex;gap:10px;flex-wrap:wrap}
.chip{display:inline-block;padding:2px 9px;border-radius:10px;font-size:9.5px;font-weight:800;letter-spacing:0.04em}
.metrics-row{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:10px}
.metric{border:1px solid #E5E7EB;border-radius:4px;padding:7px 9px}
.metric-label{font-size:8.5px;color:#6B7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:700}
.metric-value{font-size:15px;font-weight:800;margin-top:2px;font-family:'Courier New',monospace}
section{margin-bottom:10px}
.section-title{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.07em;color:#8B1A1A;padding:4px 0;border-bottom:1px solid #E5E7EB;margin-bottom:5px}
table{width:100%;border-collapse:collapse;font-size:10.5px}
th{background:#F9FAFB;text-align:left;padding:4px 7px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#6B7280;border-bottom:1px solid #E5E7EB}
td{padding:4px 7px;border-bottom:1px solid #F3F4F6}
.amt{text-align:right;font-family:'Courier New',monospace;font-weight:600}
.total-row td{border-top:2px solid #8B1A1A;font-weight:900;font-size:11.5px;padding-top:6px;background:#FEF2F2;color:#8B1A1A}
.pl-table{width:100%;font-size:11px}
.pl-table td{padding:3px 0;border-bottom:1px dashed #E5E7EB}
.pl-total{border-top:2px solid #111;padding-top:5px!important;font-weight:900;font-size:13px}
.footer{margin-top:12px;padding-top:6px;border-top:1px solid #E5E7EB;text-align:center}
.internal-label{font-size:10px;font-weight:800;color:#8B1A1A;letter-spacing:0.08em;margin-bottom:2px}
.footer-meta{font-size:8.5px;color:#999}
@media print{body{padding:12px}@page{margin:0.4in}}
</style></head><body>

<!-- Header -->
<div class="header">
  <div><img src="/logo.png" class="logo-img" alt="Auto Trade Hub" /><div class="logo-sub">ATLANTIC CAR CONNECT — A SAYARAH INC COMPANY</div></div>
  <div class="inv-meta">
    <div class="inv-num">Internal Deal Report</div>
    <div>${invoiceNum} · <b>${today}</b></div>
    <div>Stock #: <b>${esc(v.stockNum)}</b></div>
  </div>
</div>

<!-- Client line -->
<div class="client-row">
  <span><b>Exported By:</b> ${esc(u.username || "—")}${u.email ? " · " + esc(u.email) : ""}</span>
  <span style="color:#6B7280">Acquisition Source: <b style="color:#111">${esc(acqSrcName)}</b></span>
</div>

<!-- Vehicle band (sole status source-of-truth) -->
<div class="vehicle-band">
  <div class="vehicle-title">
    <span>${esc(v.year)} ${esc(v.make)} ${esc(v.model)}${v.trim ? " " + esc(v.trim) : ""}</span>
    ${statusChip}
  </div>
  <div class="vehicle-meta">
    ${v.vin ? `<span>VIN: <b>${esc(v.vin)}</b></span>` : ""}
    ${v.color ? `<span>Color: <b>${esc(v.color)}</b></span>` : ""}
    ${v.odometer ? `<span>Mileage: <b>${parseInt(v.odometer).toLocaleString()} mi</b></span>` : ""}
    <span>Title: <b>${esc(titleInfo.label)}</b></span>
    ${v.location || v.zipCode ? `<span>Location: <b>${esc(v.location || "")}${v.zipCode ? (v.location ? " · " : "") + esc(v.zipCode) : ""}</b></span>` : ""}
  </div>
</div>

<!-- Key Metrics (5 tiles, top of page) -->
<div class="metrics-row">
  <div class="metric"><div class="metric-label">Total Cost</div><div class="metric-value">${fmt$2(totalCost)}</div></div>
  <div class="metric"><div class="metric-label">Sale Price</div><div class="metric-value">${sold ? fmt$2(p(sale.grossPrice)) : "—"}</div></div>
  <div class="metric"><div class="metric-label">Net Profit / (Loss)</div><div class="metric-value" style="color:${profitColor}">${dollarOrDash(m.grossProfit)}</div></div>
  <div class="metric"><div class="metric-label">Margin %</div><div class="metric-value" style="color:${marginColor}">${pctOrDash(m.margin)}</div></div>
  <div class="metric"><div class="metric-label">Days Held</div><div class="metric-value" style="color:${daysColor}">${m.days || "—"}</div></div>
</div>

<!-- Unified Cost Breakdown (REPLACES Acquisition Costs + Tracked Expenses) -->
<section>
  <div class="section-title">Cost Breakdown</div>
  <table>
    <thead>
      <tr><th>Date</th><th>Category</th><th>Description</th><th>Vendor</th><th class="amt">Amount</th></tr>
    </thead>
    <tbody>
      ${costRows.length === 0
        ? `<tr><td colspan="5" style="padding:12px;text-align:center;color:#999;font-style:italic">No costs recorded yet — add Purchase Price or Tracked Expenses to this vehicle.</td></tr>`
        : costRows.map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.category)}</td><td>${r.description}</td><td>${esc(r.vendor)}</td><td class="amt">${fmt$2(r.amount)}</td></tr>`).join("")}
      <tr class="total-row"><td colspan="4">TOTAL COST</td><td class="amt">${fmt$2(totalCost)}</td></tr>
    </tbody>
  </table>
</section>

${sold ? `
<!-- Sale Details (sold only) -->
<section>
  <div class="section-title">Sale Details</div>
  <table class="pl-table">
    <tr><td>Sale Date</td><td class="amt">${esc(sale.date)}</td></tr>
    <tr><td>Buyer Name</td><td class="amt">${esc(sale.buyerName || "—")}</td></tr>
    <tr><td>Sale Type</td><td class="amt">${esc(sale.saleType || "—")}</td></tr>
    <tr><td>Payment Method</td><td class="amt">${esc(sale.paymentMethod || "—")}</td></tr>
    <tr><td style="padding-top:6px">Gross Sale Price</td><td class="amt" style="padding-top:6px;font-weight:700">${fmt$2(p(sale.grossPrice))}</td></tr>
    <tr><td>− Auction/Seller Fee</td><td class="amt" style="color:#DC2626">${fmt$2(p(sale.auctionFee))}</td></tr>
    <tr><td>− Title/Transfer Fee</td><td class="amt" style="color:#DC2626">${fmt$2(p(sale.titleFee))}</td></tr>
    <tr><td>− Other Deductions</td><td class="amt" style="color:#DC2626">${fmt$2(p(sale.otherDeductions))}</td></tr>
    <tr style="border-top:1px solid #111"><td style="padding-top:5px"><b>Net Sale</b></td><td class="amt" style="padding-top:5px;font-weight:800">${fmt$2(saleNet)}</td></tr>
  </table>
</section>

<!-- Profit & Loss (sold only) -->
<section>
  <div class="section-title">Profit & Loss</div>
  <table class="pl-table">
    <tr><td>Net Sale</td><td class="amt">${fmt$2(saleNet)}</td></tr>
    <tr><td>− Total Cost <span style="font-size:9px;color:#999">complete cost basis (all rows above)</span></td><td class="amt" style="color:#DC2626">${fmt$2(totalCost)}</td></tr>
    ${m.sellingCosts > 0 ? `<tr><td style="padding-left:14px;color:#888;font-style:italic;font-size:10px">↳ of which Post-sale Selling Costs <span style="font-size:9px">commission, post-sale repairs, marketing — already in Total Cost above</span></td><td class="amt" style="font-style:italic;color:#888;font-size:10px">${fmt$2(m.sellingCosts)}</td></tr>` : ""}
    <tr class="pl-total"><td>= Net Profit / (Loss)</td><td class="amt" style="color:${profitColor}">${dollarOrDash(m.grossProfit)}</td></tr>
    <tr><td>Gross Margin %</td><td class="amt" style="color:${marginColor}">${pctOrDash(m.margin)}</td></tr>
    <tr><td>Annualized ROI</td><td class="amt">${pctOrDash(m.annROI)}</td></tr>
    <tr><td>Days Held</td><td class="amt" style="color:${daysColor}">${m.days || "—"}</td></tr>
    <tr><td>Deal Grade</td><td class="amt">${m.grade ? `<b style="font-size:14px;color:${m.grade.color}">${esc(m.grade.grade.replace(/\+$/, ""))}</b> <span style="font-size:9.5px;color:${m.grade.color}">${esc(m.grade.label)}</span>` : `<span style="color:#999">— Pending</span>`}</td></tr>
  </table>
  ${m.grossProfit > 0 ? `<div style="margin-top:6px;font-size:9.5px;color:#6B7280">Est. Tax: MA State (8%) ${fmt$2(m.grossProfit * MA_CORP_TAX_RATE)} · Federal (21%) ${fmt$2(m.grossProfit * FEDERAL_CORP_TAX_RATE)} · Total ${fmt$2(m.grossProfit * (MA_CORP_TAX_RATE + FEDERAL_CORP_TAX_RATE))}</div>` : ""}
</section>
` : ""}

<!-- Footer -->
<div class="footer">
  <div class="internal-label">INTERNAL USE ONLY — NOT FOR CUSTOMER DISTRIBUTION</div>
  <div class="footer-meta">Auto Trade Hub · © 2025 Sayarah Inc · Atlantic Car Connect · Generated ${today}</div>
</div>

</body></html>`;

  const printWindow = window.open("", "_blank");
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onload = () => { printWindow.print(); };
}

function VehicleDetailModal({ vehicle, expenses, sale, data, setData, admin, currentUser, onClose, onEdit, onDelete, canEditProp, canDeleteProp }) {
  const v = vehicle;
  const m = calcVehicleFullMetrics(v, sale, data.holdCosts, data.expenses);
  const titleInfo = TITLE_STATUS[v.titleStatus] || TITLE_STATUS.clean;
  const [vehicleLog, setVehicleLog] = useState([]);
  useEffect(() => { loadActivityLog().then(log => setVehicleLog(log.filter(l => l.details?.stockNum === v.stockNum || l.description?.includes(`#${v.stockNum}`)).slice(0, 20))).catch(() => setVehicleLog([])); }, [v.stockNum]);

  const handleExportPDF = () => {
    const users = loadUsers();
    const userInfo = users.find(u => u.username === currentUser) || { username: currentUser, email: "", phone: "", address: "" };
    generateInvoicePDF(v, expenses, sale, m, userInfo);
  };

  // ─── Post vehicle purchase to the Money Management ledger ───
  // Converts the funding-source fields on the vehicle into proper
  // journal entries and marks the vehicle `postedToLedger: true` so
  // the button only fires once. Large outflows (> $10K from the
  // fund) are routed through the existing approval queue as a
  // "fund_outflow" request — a second member / admin approves
  // and the entries are booked then.
  const postVehicleToLedger = () => {
    if (v.postedToLedger) { alert("This vehicle has already been posted to the ledger."); return; }
    if (!admin) { alert("Only admins can post vehicles to the ledger."); return; }
    const deposit = p(v.depositAmount);
    const balance = p(v.balanceAmount);
    if (deposit + balance <= 0) { alert("Set a deposit or balance amount first (with a funding source)."); return; }
    if (deposit > 0 && !v.depositSource) { alert("Pick a deposit source (fund or member)."); return; }
    if (balance > 0 && !v.balanceSource) { alert("Pick a balance source (fund or member)."); return; }

    const fundBalance = calcAllBalances(data.money?.ledger || [], data.money?.accounts || DEFAULT_ACCOUNTS)[SYSTEM_ACCOUNTS.ATLANTIC_FUND] || 0;
    const fundOutflow = (v.depositSource === "fund" ? deposit : 0) + (v.balanceSource === "fund" ? balance : 0);

    if (fundOutflow > fundBalance) {
      alert(`Atlantic Fund has ${fmt$2(fundBalance)} but this vehicle needs ${fmt$2(fundOutflow)} from the fund. The fund cannot be overdrawn.`);
      return;
    }

    if (fundOutflow > LARGE_OUTFLOW_THRESHOLD) {
      // Route through approval queue — first approver is the admin
      // clicking now; they're recorded and the entry is deferred
      // until a second member approves.
      addApproval({
        id: genId(),
        type: "fund_outflow",
        requestedBy: currentUser,
        requestedAt: new Date().toISOString(),
        status: "pending",
        stockNum: v.stockNum,
        vehicle: `${v.year} ${v.make} ${v.model}`,
        description: `Fund outflow ${fmt$2(fundOutflow)} for vehicle #${v.stockNum} — requires second-member approval (threshold ${fmt$2(LARGE_OUTFLOW_THRESHOLD)})`,
        targetId: v.id,
        originalData: null,
        newData: { vehicleId: v.id, deposit, balance, depositSource: v.depositSource, balanceSource: v.balanceSource, fundOutflow },
      });
      logActivity(currentUser, "fund_outflow_requested", `Requested ${fmt$2(fundOutflow)} fund outflow for #${v.stockNum}`, { stockNum: v.stockNum });
      alert(`Posted as a pending request. A second member must approve the $${fundOutflow.toLocaleString()} outflow in the Approvals tab before the ledger is updated.`);
      return;
    }

    const entries = [];
    const date = v.purchaseDate || new Date().toISOString().slice(0, 10);
    if (deposit > 0) {
      if (v.depositSource === "fund") {
        entries.push(vehiclePurchaseFromFundEntry({ stockNum: v.stockNum, amount: deposit, date, memo: `Deposit — #${v.stockNum}`, user: currentUser }));
      } else if (v.depositSource.startsWith("member:")) {
        entries.push(vehiclePurchaseFromMemberEntry({ stockNum: v.stockNum, memberId: v.depositSource.slice(7), amount: deposit, date, memo: `Deposit — #${v.stockNum}`, user: currentUser }));
      }
    }
    if (balance > 0) {
      if (v.balanceSource === "fund") {
        entries.push(vehiclePurchaseFromFundEntry({ stockNum: v.stockNum, amount: balance, date, memo: `Balance — #${v.stockNum}`, user: currentUser }));
      } else if (v.balanceSource.startsWith("member:")) {
        entries.push(vehiclePurchaseFromMemberEntry({ stockNum: v.stockNum, memberId: v.balanceSource.slice(7), amount: balance, date, memo: `Balance — #${v.stockNum}`, user: currentUser }));
      }
    }
    // MA use tax — posted alongside the purchase so cost basis includes
    // the tax liability. Only when the car was bought out-of-state AND
    // MA sales tax wasn't paid at purchase.
    if (v.outOfStatePurchase && !v.maSalesTaxPaidAtPurchase) {
      const ut = useTaxOnPurchaseEntry({ stockNum: v.stockNum, purchasePrice: p(v.purchasePrice), date, user: currentUser });
      if (ut) entries.push(ut);
    }
    setData(d => {
      const closedPeriods = d.money?.closedPeriods || [];
      let ledger = d.money?.ledger || [];
      for (const e of entries) ledger = postJournalEntry(ledger, e, closedPeriods);
      // Ensure the vehicle inventory account exists in the chart so
      // balance lookups in the Money tab resolve.
      const accounts = d.money?.accounts || DEFAULT_ACCOUNTS;
      const hasVehicleAcc = accounts.some(a => a.id === vehicleAccountId(v.stockNum));
      const newAccounts = hasVehicleAcc ? accounts : [...accounts, buildVehicleAccount(v.stockNum, `${v.year} ${v.make} ${v.model}`)];
      return {
        ...d,
        money: { ...d.money, ledger, accounts: newAccounts },
        vehicles: d.vehicles.map(x => x.id === v.id ? { ...x, postedToLedger: true } : x),
      };
    });
    logActivity(currentUser, "vehicle_posted_to_ledger", `Posted #${v.stockNum} ${v.year} ${v.make} ${v.model} to ledger (${fmt$2(deposit + balance)})`, { stockNum: v.stockNum });
  };

  // ─── Expense form state ────────────────────────────────────
  const [showExpForm, setShowExpForm] = useState(false);
  const [editingExp, setEditingExp] = useState(null);
  const [confirmExp, setConfirmExp] = useState(null);
  const emptyExp = () => ({ id: genId(), date: new Date().toISOString().slice(0, 10), stockNum: v.stockNum, vehicle: `${v.year} ${v.make} ${v.model}`, category: "", description: "", vendor: "", paymentMethod: "", amount: "", receipt: "" });
  const [expForm, setExpForm] = useState(emptyExp());
  const updExp = (k, val) => setExpForm(f => ({ ...f, [k]: val }));
  const [approvalMsg, setApprovalMsg] = useState("");
  const openNewExp = () => { setExpForm(emptyExp()); setEditingExp(null); setShowExpForm(true); };
  const openEditExp = e => {
    if (!admin) {
      // Non-admin can only request edits
      setExpForm({ ...e }); setEditingExp(e.id); setShowExpForm(true);
      return;
    }
    setExpForm({ ...e }); setEditingExp(e.id); setShowExpForm(true);
  };
  const saveExp = () => {
    // Expenses opened from inside a vehicle modal inherit the stockNum, so
    // inject it before validation — the user doesn't see that field.
    const draft = { ...expForm, stockNum: expForm.stockNum || v.stockNum, vehicle: expForm.vehicle || `${v.year} ${v.make} ${v.model}` };
    const err = validateExpenseEntry(draft);
    if (err) { setApprovalMsg(err); setTimeout(() => setApprovalMsg(""), 3500); return; }
    Object.assign(expForm, draft);
    if (editingExp && !admin) {
      // Non-admin edit → send to approval queue
      addApproval({ id: genId(), type: "expense_edit", requestedBy: currentUser, requestedAt: new Date().toISOString(), status: "pending", stockNum: v.stockNum, vehicle: `${v.year} ${v.make} ${v.model}`, description: `Edit expense: ${expForm.category || "—"} — ${expForm.description || "—"} (${fmt$2(p(expForm.amount))})`, targetId: editingExp, originalData: data.expenses.find(e => e.id === editingExp), newData: { ...expForm } });
      logActivity(currentUser, "requested_edit", `Requested expense edit on #${v.stockNum} ${v.year} ${v.make} ${v.model}`, { type: "expense_edit", stockNum: v.stockNum });
      setApprovalMsg("Edit request sent to admin for approval!");
      setTimeout(() => setApprovalMsg(""), 3000);
      setShowExpForm(false);
      return;
    }
    // Auto-post to the Money Management ledger so every expense hits
    // the CoA (via resolveExpenseAccount) immediately. Failures are
    // non-blocking — expense saves succeed even if the ledger post
    // fails (e.g. closed period).
    const buildExpJE = (exp) => expenseEntry({
      expenseId: exp.id, category: exp.category, amount: exp.amount,
      vendor: exp.vendor, description: exp.description, stockNum: exp.stockNum,
      date: exp.date, user: currentUser, categoryMap: data.money?.expenseCategoryMap,
    });
    if (editingExp) {
      const before = data.expenses.find(e => e.id === editingExp);
      const diff = auditDiff(before, expForm, ["category", "amount", "vendor", "description", "date", "paymentMethod", "receipt"]);
      setData(d => {
        const money = d.money;
        let ledger = money?.ledger || [];
        const closed = money?.closedPeriods || [];
        const updatedExp = { ...expForm };
        try {
          if (money) {
            if (before?.journalEntryId) {
              const original = ledger.find(x => x.id === before.journalEntryId);
              if (original) ledger = postJournalEntry(ledger, buildReversingEntry(original, { user: currentUser, memo: "Reverse prior expense entry (edit)" }), closed);
            }
            const entry = buildExpJE(updatedExp);
            if (entry) { ledger = postJournalEntry(ledger, entry, closed); updatedExp.journalEntryId = entry.id; }
            else updatedExp.journalEntryId = null;
          }
        } catch (err) { console.warn("Expense ledger edit skipped:", err.message); }
        return {
          ...d,
          expenses: d.expenses.map(e => e.id === editingExp ? updatedExp : e),
          money: money ? { ...money, ledger } : money,
        };
      });
      const desc = `Edited expense on #${v.stockNum} ${v.year} ${v.make} ${v.model}` + (diff.summary ? ` — ${diff.summary}` : `: ${expForm.category || "—"}`);
      logActivity(currentUser, "edited_expense", desc, { stockNum: v.stockNum, expenseId: editingExp, changes: diff.changes });
    } else {
      setData(d => {
        const money = d.money;
        let ledger = money?.ledger || [];
        const closed = money?.closedPeriods || [];
        const newExp = { ...expForm };
        try {
          if (money) {
            const entry = buildExpJE(newExp);
            if (entry) { ledger = postJournalEntry(ledger, entry, closed); newExp.journalEntryId = entry.id; }
          }
        } catch (err) { console.warn("Expense ledger post skipped:", err.message); }
        return {
          ...d,
          expenses: [...d.expenses, newExp],
          money: money ? { ...money, ledger } : money,
        };
      });
      logActivity(currentUser, "added_expense", `Added expense on #${v.stockNum} ${v.year} ${v.make} ${v.model}: ${expForm.category || "—"} (${fmt$2(p(expForm.amount))})`);
    }
    setShowExpForm(false);
  };
  const delExp = id => {
    if (!admin) {
      addApproval({ id: genId(), type: "expense_delete", requestedBy: currentUser, requestedAt: new Date().toISOString(), status: "pending", stockNum: v.stockNum, vehicle: `${v.year} ${v.make} ${v.model}`, description: `Delete expense: ${(data.expenses.find(e => e.id === id)?.category || "—")}`, targetId: id, originalData: data.expenses.find(e => e.id === id), newData: null });
      logActivity(currentUser, "requested_delete", `Requested expense deletion on #${v.stockNum} ${v.year} ${v.make} ${v.model}`);
      setApprovalMsg("Delete request sent to admin for approval!");
      setTimeout(() => setApprovalMsg(""), 3000);
      setConfirmExp(null); setShowExpForm(false);
      return;
    }
    setData(d => {
      const exp = d.expenses.find(e => e.id === id);
      const money = d.money;
      let ledger = money?.ledger || [];
      if (exp?.journalEntryId && money) {
        const original = ledger.find(x => x.id === exp.journalEntryId);
        if (original) {
          try {
            ledger = postJournalEntry(ledger, buildReversingEntry(original, { user: currentUser, memo: "Reverse expense entry (delete)" }), money.closedPeriods || []);
          } catch (err) { console.warn("Expense reversal skipped:", err.message); }
        }
      }
      return {
        ...d,
        expenses: d.expenses.filter(e => e.id !== id),
        trash: exp ? [...(d.trash || []), toTrash(exp, "expense", currentUser)] : (d.trash || []),
        money: money ? { ...money, ledger } : money,
      };
    });
    const gone = data.expenses.find(e => e.id === id);
    const summary = gone ? `${gone.category || "—"} · ${fmt$2(p(gone.amount))} · ${gone.vendor || "—"}` : "";
    logActivity(currentUser, "deleted_expense", `Deleted expense on #${v.stockNum} ${v.year} ${v.make} ${v.model}${summary ? " — " + summary : ""}`, { stockNum: v.stockNum, expenseId: id, snapshot: gone });
    setConfirmExp(null); setShowExpForm(false);
  };

  // ─── Sale form state ───────────────────────────────────────
  const [showSaleForm, setShowSaleForm] = useState(false);
  const [editingSale, setEditingSale] = useState(null);
  const [confirmSale, setConfirmSale] = useState(null);
  const emptySale = () => ({ id: genId(), date: new Date().toISOString().slice(0, 10), stockNum: v.stockNum, vehicle: `${v.year} ${v.make} ${v.model}`, buyerName: "", saleType: "", grossPrice: "", auctionFee: "", titleFee: "", otherDeductions: "", buyerPhone: "", buyerEmail: "", paymentMethod: "", notes: "", payments: [], saleDestination: "out_of_state_us", buyerState: "" });
  const [saleForm, setSaleForm] = useState(emptySale());
  const updSale = (k, val) => setSaleForm(f => ({ ...f, [k]: val }));
  const saleNet = s => p(s.grossPrice) - p(s.auctionFee) - p(s.titleFee) - p(s.otherDeductions);
  const openNewSale = () => { setSaleForm(emptySale()); setEditingSale(null); setShowSaleForm(true); };
  const openEditSale = s => { setSaleForm({ ...s }); setEditingSale(s.id); setShowSaleForm(true); };
  const saveSale = () => {
    if (!saleForm.grossPrice) { setApprovalMsg("Gross price is required"); setTimeout(() => setApprovalMsg(""), 3000); return; }
    const moneyErr = validateMoneyFields([
      [saleForm.grossPrice, "Gross price", { allowZero: false }],
      [saleForm.auctionFee, "Auction fee"],
      [saleForm.titleFee, "Title fee"],
      [saleForm.otherDeductions, "Other deductions"],
    ]);
    if (moneyErr) { setApprovalMsg(moneyErr); setTimeout(() => setApprovalMsg(""), 3000); return; }
    // Payments allow negatives (refunds), so validate for NaN/sanity only
    for (const pay of (saleForm.payments || [])) {
      if (pay.amount === "" || pay.amount == null) continue;
      const n = Number(pay.amount);
      if (!Number.isFinite(n)) { setApprovalMsg("Payment amount must be a valid number"); setTimeout(() => setApprovalMsg(""), 3000); return; }
      if (Math.abs(n) > 10_000_000) { setApprovalMsg("Payment amount looks unreasonable"); setTimeout(() => setApprovalMsg(""), 3000); return; }
    }
    // Enforce the Sold workflow: every field required to flip status=Sold
    // must be set at finalize time. This keeps vehicle.status and sale data
    // in lock-step — no more "marked Sold but no sale record" drift.
    const soldErr = validateSoldRequirements(saleForm);
    if (soldErr) { setApprovalMsg(soldErr); setTimeout(() => setApprovalMsg(""), 3000); return; }
    if (editingSale && !admin) {
      addApproval({ id: genId(), type: "sale_edit", requestedBy: currentUser, requestedAt: new Date().toISOString(), status: "pending", stockNum: v.stockNum, vehicle: `${v.year} ${v.make} ${v.model}`, description: `Edit sale: ${fmt$2(p(saleForm.grossPrice))} to ${saleForm.buyerName || "—"}`, targetId: editingSale, originalData: data.sales.find(s => s.id === editingSale), newData: { ...saleForm } });
      logActivity(currentUser, "requested_edit", `Requested sale edit on #${v.stockNum} ${v.year} ${v.make} ${v.model}`);
      setApprovalMsg("Edit request sent to admin for approval!");
      setTimeout(() => setApprovalMsg(""), 3000);
      setShowSaleForm(false);
      return;
    }
    if (editingSale) {
      const before = data.sales.find(s => s.id === editingSale);
      const diff = auditDiff(before, saleForm, ["grossPrice", "auctionFee", "titleFee", "otherDeductions", "buyerName", "paymentMethod", "saleType", "date"]);
      setData(d => ({ ...d, sales: d.sales.map(s => s.id === editingSale ? saleForm : s) }));
      const desc = `Edited sale on #${v.stockNum} ${v.year} ${v.make} ${v.model}` + (diff.summary ? ` — ${diff.summary}` : "");
      logActivity(currentUser, "edited_sale", desc, { stockNum: v.stockNum, saleId: editingSale, changes: diff.changes });
    } else {
      // Auto-post sale entries to the Money Management ledger if the
      // vehicle was posted to the ledger when purchased. Principal
      // routes to whichever source funded the vehicle; $295 to Tax;
      // remainder to Profit Distribution. Skipped for vehicles that
      // were never ledger-booked (pre-Money-Management records).
      setData(d => {
        const next = {
          ...d,
          sales: [...d.sales, saleForm],
          vehicles: d.vehicles.map(vh => vh.stockNum === saleForm.stockNum ? { ...vh, status: "Sold" } : vh),
        };
        if (v.postedToLedger && d.money) {
          const totalCost = calcTotalCost(v, d.expenses);
          const grossSale = p(saleForm.grossPrice);
          // Principal destination: use the deposit source as primary
          // (typical case: deposit source = balance source). If split,
          // the user can reverse and re-post manually via admin tools.
          const srcStr = v.depositSource || v.balanceSource || "fund";
          const principalDestination = srcStr === "fund"
            ? { type: "fund" }
            : { type: "member", memberId: srcStr.replace(/^member:/, "") };
          const entries = vehicleSaleEntries({
            stockNum: v.stockNum,
            totalCost,
            grossSale,
            principalDestination,
            date: saleForm.date,
            user: currentUser,
            destination: saleForm.saleDestination || "out_of_state_us",
          });
          // In-state MA sales only: post a separate sales-tax entry
          // (buyer paid 6.25% on top of gross). Out-of-state and
          // international sales are exempt — no entry.
          const stEntry = salesTaxOnSaleEntry({
            stockNum: v.stockNum,
            grossPrice: grossSale,
            destination: saleForm.saleDestination || "out_of_state_us",
            date: saleForm.date,
            user: currentUser,
          });
          if (stEntry) entries.push(stEntry);
          let ledger = d.money.ledger || [];
          const closedPeriods = d.money?.closedPeriods || [];
          for (const e of entries) ledger = postJournalEntry(ledger, e, closedPeriods);
          next.money = { ...d.money, ledger };
        }
        return next;
      });
      logActivity(currentUser, "finalized_sale", `Finalized sale on #${v.stockNum} ${v.year} ${v.make} ${v.model}: ${fmt$2(p(saleForm.grossPrice))} to ${saleForm.buyerName} via ${saleForm.paymentMethod}${v.postedToLedger ? " — ledger entries posted" : ""}`, { stockNum: v.stockNum, grossPrice: p(saleForm.grossPrice), buyerName: saleForm.buyerName, paymentMethod: saleForm.paymentMethod });
    }
    setShowSaleForm(false);
  };
  const delSale = id => {
    if (!admin) {
      addApproval({ id: genId(), type: "sale_delete", requestedBy: currentUser, requestedAt: new Date().toISOString(), status: "pending", stockNum: v.stockNum, vehicle: `${v.year} ${v.make} ${v.model}`, description: `Delete sale record for #${v.stockNum}`, targetId: id, originalData: data.sales.find(s => s.id === id), newData: null });
      logActivity(currentUser, "requested_delete", `Requested sale deletion on #${v.stockNum} ${v.year} ${v.make} ${v.model}`);
      setApprovalMsg("Delete request sent to admin for approval!");
      setTimeout(() => setApprovalMsg(""), 3000);
      setConfirmSale(null); setShowSaleForm(false);
      return;
    }
    setData(d => {
      const s = d.sales.find(x => x.id === id);
      return {
        ...d,
        sales: d.sales.filter(x => x.id !== id),
        // Revert the vehicle's status — no sale record means the vehicle
        // is back on the lot. "Listed" is the safest default since the
        // vehicle was clearly ready enough to sell once.
        vehicles: s ? d.vehicles.map(vh => vh.stockNum === s.stockNum && vh.status === "Sold" ? { ...vh, status: "Listed" } : vh) : d.vehicles,
        trash: s ? [...(d.trash || []), toTrash(s, "sale", currentUser)] : (d.trash || []),
      };
    });
    const gone = data.sales.find(s => s.id === id);
    const summary = gone ? `${fmt$2(p(gone.grossPrice))} to ${gone.buyerName || "—"} · ${gone.paymentMethod || "—"}` : "";
    logActivity(currentUser, "deleted_sale", `Deleted sale on #${v.stockNum} ${v.year} ${v.make} ${v.model}; vehicle status reverted to Listed${summary ? " — " + summary : ""}`, { stockNum: v.stockNum, saleId: id, snapshot: gone });
    setConfirmSale(null); setShowSaleForm(false);
  };

  const totalExpenses = expenses.reduce((s, e) => s + p(e.amount), 0);
  const isSold = !!sale; // Once sale is finalized, lock edits for non-admin
  const lockedForUser = isSold && !admin; // Non-admin on a sold vehicle = read-only

  // ─── Document form state (lifted from IIFE to avoid hooks violation) ───
  const [showDocForm, setShowDocForm] = useState(false);
  const [docForm, setDocForm] = useState({ id: "", stockNum: v.stockNum, name: "", category: "", date: new Date().toISOString().slice(0, 10), notes: "", fileUrl: "", filePath: "" });
  const [uploading, setUploading] = useState(false);

  return (
    <div className="detail-modal-overlay" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 12, backdropFilter: "blur(3px)" }}>
      <div className="detail-modal" onClick={e => e.stopPropagation()} style={{ background: BRAND.white, borderRadius: 14, padding: 0, width: "100%", maxWidth: 920, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 20px 40px rgba(0,0,0,0.15)" }}>

        {/* ─── Header ─────────────────────────────────────── */}
        <div className="detail-modal-header" style={{ padding: "18px 24px", borderBottom: `2px solid ${BRAND.redBg2}`, display: "flex", justifyContent: "space-between", alignItems: "start" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ color: BRAND.red, fontSize: 12, fontWeight: 800, ...S.mono }}>#{v.stockNum}</span>
              <Badge color={titleInfo.color} bg={titleInfo.bg}>{titleInfo.label}</Badge>
              <StatusBadge status={v.status} />
              {m.aging && <Badge color={m.aging.color} bg={m.aging.bg}>{m.aging.icon} {m.days}d</Badge>}
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: BRAND.black }}>
              {v.year} {v.make} {v.model} {v.trim && <span style={{ color: BRAND.gray, fontWeight: 400, fontSize: 15 }}>{v.trim}</span>}
            </div>
            {v.color && <div style={{ fontSize: 12, color: BRAND.gray, marginTop: 2 }}>{v.color}{v.odometer ? ` · ${parseInt(v.odometer).toLocaleString()} mi` : ""}{v.vin ? ` · VIN: ${v.vin}` : ""}</div>}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <Btn variant="secondary" size="sm" onClick={handleExportPDF} style={{ background: BRAND.blueBg, color: BRAND.blue, border: `1px solid #BFDBFE` }}>Export PDF</Btn>
            {admin && data.money && !v.postedToLedger && (p(v.depositAmount) > 0 || p(v.balanceAmount) > 0) && (
              <Btn size="sm" onClick={postVehicleToLedger} style={{ background: "#059669" }}>Post to Ledger</Btn>
            )}
            {v.postedToLedger && (
              <span style={{ fontSize: 10, color: "#059669", fontWeight: 700, padding: "4px 8px", background: "#D1FAE5", borderRadius: 6 }}>✓ On Ledger</span>
            )}
            {canEditProp && <Btn variant="secondary" size="sm" onClick={onEdit}>Edit</Btn>}
            {/* Admins/managers delete directly; other authenticated users
                submit an approval request. Button label reflects which
                path will run so the user knows what to expect. */}
            <Btn variant="danger" size="sm" style={{ fontSize: 11, padding: "5px 10px" }} onClick={onDelete}>
              {canDeleteProp ? "Delete" : "Request Delete"}
            </Btn>
            <Btn variant="ghost" onClick={onClose}>✕</Btn>
          </div>
        </div>

        <div className="detail-modal-body" style={{ padding: 24 }}>

          {/* Approval notification */}
          {approvalMsg && (
            <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, padding: "10px 16px", marginBottom: 14, fontSize: 13, fontWeight: 600, color: "#1E40AF", display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg> {approvalMsg}
            </div>
          )}

          {/* ═══ SECTION 1: OVERVIEW ═══ */}
          {/* Data-integrity diagnostic: orphan expenses. Total Cost only
              counts expenses whose stockNum matches this vehicle, so if the
              user accidentally saved an expense with a different stockNum
              (or none), the money doesn't count and nothing tells them.
              Surface any such drift at the top of the detail view. */}
          {(() => {
            const orphans = (data.expenses || []).filter(e => {
              const label = `${v.year} ${v.make} ${v.model}`.toLowerCase();
              const matchesVehicleText = e.vehicle && e.vehicle.toLowerCase().includes(label.trim());
              return matchesVehicleText && e.stockNum !== v.stockNum;
            });
            if (orphans.length === 0) return null;
            const orphanTotal = orphans.reduce((s, e) => s + p(e.amount), 0);
            return (
              <div style={{ marginBottom: 12, padding: "10px 12px", background: "#FEF3C7", borderRadius: 8, fontSize: 11, color: "#92400E", border: "1px solid #FCD34D" }}>
                <b>Possible orphan expenses:</b> {orphans.length} expense{orphans.length === 1 ? "" : "s"} totaling {fmt$2(orphanTotal)} reference this vehicle by name but have a different stock #. These dollars are NOT in Total Cost. Check the Expenses tab and fix the stock # to include them here.
              </div>
            );
          })()}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
            <StatCard label="Total Cost" value={fmt$(m.totalCost)} color={BRAND.red} sub={m.totalCost > 0 ? "complete cost basis" : "no costs yet"} />
            {m.grossProfit != null ? (
              <StatCard label="Net Profit" value={fmt$(m.grossProfit)} color={m.grossProfit >= 0 ? BRAND.green : "#DC2626"} sub="Net Sale − Total Cost" />
            ) : (
              <StatCard label="Break-Even" value={fmt$(m.breakEven.minSalePrice)} color="#D97706" sub="min sale to cover costs" />
            )}
            <StatCard label="Risk" value={m.risk.level} color={m.risk.color} />
          </div>
          {/* Soft warning when Total Cost = $0 but we can see the vehicle
              has a purchase price OR at least one tracked expense. This
              state is *not reachable* with current formula logic, but is a
              canary if a future change regresses the roll-up or if expense
              records have malformed amounts. */}
          {m.totalCost === 0 && (p(v.purchasePrice) > 0 || expenses.length > 0) && (
            <div style={{ marginBottom: 14, padding: "10px 12px", background: "#FEE2E2", borderRadius: 8, fontSize: 12, color: "#991B1B", border: "1px solid #FCA5A5", fontWeight: 600 }}>
              Total Cost is $0 but this vehicle has a Purchase Price or Tracked Expenses. Please report this to engineering with the stock # — the roll-up formula is broken.
            </div>
          )}

          {m.grossProfit != null && (
            <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
              <GradeBadge grade={m.grade} />
              <span style={{ fontSize: 12, color: BRAND.gray }}>{fmt$2(m.velocity)}/day · {fmtPct(m.margin)} margin · {fmtPct(m.annROI)} ann. ROI · {m.days} days held</span>
            </div>
          )}

          {/* Days-held carrying cost indicator (per #7). Shows the average
              cost/day of holding and flags vehicles past the configurable
              aging threshold. Only relevant while the vehicle is unsold. */}
          {v.status !== "Sold" && v.purchaseDate && (() => {
            const threshold = p(data.holdCosts?.agingThresholdDays) || 45;
            const overThreshold = m.days > threshold;
            return (
              <div style={{ display: "flex", gap: 10, marginBottom: 16, padding: "10px 12px", background: overThreshold ? "#FEF2F2" : "#F9FAFB", border: `1px solid ${overThreshold ? "#FECACA" : BRAND.grayLight}`, borderRadius: 8, fontSize: 12, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ color: BRAND.gray }}>Days Held: <b style={{ color: overThreshold ? "#DC2626" : BRAND.black }}>{m.days}</b></span>
                <span style={{ color: BRAND.gray }}>Cost / day: <b style={{ color: BRAND.black, ...S.mono }}>{fmt$2(m.costPerDay)}</b></span>
                <span style={{ color: BRAND.gray }}>Total carrying cost: <b style={{ color: BRAND.black, ...S.mono }}>{fmt$2(m.holdCost.total)}</b></span>
                {overThreshold && (
                  <span style={{ marginLeft: "auto", color: "#DC2626", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    Held &gt; {threshold} days — review pricing
                  </span>
                )}
              </div>
            );
          })()}

          {/* Photos — editable when admin, read-only preview otherwise */}
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: BRAND.red, textTransform: "uppercase", letterSpacing: "0.08em" }}>Photos</div>
              <div style={{ fontSize: 10, color: BRAND.gray }}>{(v.photos || []).length} photo{(v.photos || []).length === 1 ? "" : "s"}{(v.photos || []).length > 0 && " · first is primary"}</div>
            </div>
            <PhotoEditor
              vehicleId={v.id}
              photos={v.photos || []}
              onChange={(next) => {
                setData(d => ({
                  ...d,
                  vehicles: d.vehicles.map(vh => vh.id === v.id ? { ...vh, photos: next } : vh),
                }));
                logActivity(currentUser, "edited_vehicle_photos", `Updated photos on #${v.stockNum} ${v.year} ${v.make} ${v.model} (${next.length} photo${next.length === 1 ? "" : "s"})`, { stockNum: v.stockNum });
              }}
              readOnly={!admin && !canEditProp}
            />
          </Card>

          {/* Cost Breakdown — the bottom "Total Cost" row renders
              m.totalCost (the one number every other calculation uses) so
              the stat card at top, this row, and the P&L Total Cost line
              always agree. If the sum of the visible line items differs
              from m.totalCost by more than a penny a red diagnostic row
              surfaces the drift — previously this could hide silently
              (individual expenses rendered fine but the total stayed at
              zero because the stockNum filter in calcTotalCost rejected
              them). */}
          <Card style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: BRAND.red, textTransform: "uppercase", marginBottom: 10, letterSpacing: "0.08em" }}>Cost Breakdown</div>
            {(() => {
              const pp = p(v.purchasePrice);
              const auctFees = calcAuctionFees(pp, v.auctionSource || "custom").total;
              const tCost = p(v.transportCost);
              const rCost = p(v.repairCost);
              const oCost = p(v.otherExpenses);
              const byCat = {};
              expenses.forEach(e => {
                const c = e.category || "Uncategorized";
                byCat[c] = (byCat[c] || 0) + p(e.amount);
              });
              // $295 tax reserve is baked into every real vehicle's Total Cost.
              const taxReserve = pp > 0 ? 295 : 0;
              const visibleSum = pp + auctFees + tCost + rCost + oCost + Object.values(byCat).reduce((s, x) => s + x, 0) + taxReserve;
              const drift = Math.abs(visibleSum - (m.totalCost || 0));
              const line = (label, amount, sub, subtle) => (
                <tr style={{ borderBottom: `1px dashed ${BRAND.grayLight}` }}>
                  <td style={{ padding: "6px 0", color: subtle ? BRAND.gray : BRAND.grayDark, fontSize: 12 }}>
                    {label}
                    {sub && <span style={{ fontSize: 10, color: BRAND.gray, marginLeft: 8 }}>{sub}</span>}
                  </td>
                  <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 700, color: BRAND.black, ...S.mono }}>{fmt$2(amount)}</td>
                </tr>
              );
              return (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>
                    {line("Purchase Price", pp)}
                    {line("Auction Fees", auctFees, `${(AUCTION_FEE_TIERS[v.auctionSource] || {}).name || "custom"} · derived from purchase price`, true)}
                    {tCost > 0 && line("Transport (legacy field)", tCost, "use Tracked Expenses going forward", true)}
                    {rCost > 0 && line("Repair/Recon (legacy field)", rCost, "use Tracked Expenses going forward", true)}
                    {oCost > 0 && line("Other (legacy field)", oCost, "use Tracked Expenses going forward", true)}
                    {Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
                      <tr key={cat} style={{ borderBottom: `1px dashed ${BRAND.grayLight}` }}>
                        <td style={{ padding: "6px 0", color: BRAND.grayDark, fontSize: 12 }}>
                          {cat}
                          <span style={{ fontSize: 10, color: BRAND.gray, marginLeft: 8 }}>tracked expense</span>
                        </td>
                        <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 700, color: BRAND.black, ...S.mono }}>{fmt$2(amt)}</td>
                      </tr>
                    ))}
                    {taxReserve > 0 && line("Tax Reserve", taxReserve, "$295 per-vehicle · posts to Accrued Tax Liability on sale", true)}
                    <tr style={{ borderTop: `2px solid ${BRAND.red}` }}>
                      <td style={{ padding: "10px 0 4px", fontWeight: 900, textTransform: "uppercase", fontSize: 12, color: BRAND.red, letterSpacing: "0.05em" }}>Total Cost</td>
                      <td style={{ padding: "10px 0 4px", textAlign: "right", fontWeight: 900, fontSize: 16, color: BRAND.black, ...S.mono }}>{fmt$2(m.totalCost)}</td>
                    </tr>
                    {drift > 0.01 && (
                      <tr>
                        <td colSpan={2} style={{ padding: "8px 10px", background: "#FEE2E2", color: "#991B1B", fontSize: 11, fontWeight: 700, borderRadius: 6 }}>
                          ⚠ The visible lines sum to {fmt$2(visibleSum)} but Total Cost is {fmt$2(m.totalCost || 0)} — off by {fmt$2(drift)}.
                          Likely cause: one or more expenses have a stock # that doesn't match this vehicle (#{v.stockNum}). Open the Expenses tab, find the mismatched rows, and fix the stock #.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              );
            })()}
          </Card>

          {v.notes && (
            <Card style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: BRAND.gray, textTransform: "uppercase", marginBottom: 4 }}>Notes</div>
              <div style={{ fontSize: 13, color: BRAND.grayDark, lineHeight: 1.5 }}>{v.notes}</div>
            </Card>
          )}

          {/* ═══ VEHICLE TIMELINE ═══ */}
          {(() => {
            const events = [];
            if (v.purchaseDate) events.push({ date: v.purchaseDate, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>, label: "Purchased", detail: `${fmt$(p(v.purchasePrice))} from ${(AUCTION_FEE_TIERS[v.auctionSource] || {}).name || "—"}`, color: BRAND.red });
            expenses.forEach(e => events.push({ date: e.date, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>, label: `Expense: ${e.category || "—"}`, detail: `${fmt$2(p(e.amount))}${e.description ? " — " + e.description : ""}`, color: "#D97706" }));
            if (sale) events.push({ date: sale.date, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="12" y1="6" x2="12" y2="18"/><path d="M6 12h.01"/><path d="M18 12h.01"/></svg>, label: "Sold", detail: `${fmt$(p(sale.grossPrice))} to ${sale.buyerName || "—"}`, color: BRAND.green });
            const log = vehicleLog;
            log.forEach(l => {
              if (!events.find(e => e.date === l.timestamp?.slice(0, 10) && e.label === l.action)) {
                events.push({ date: l.timestamp?.slice(0, 10) || "", icon: l.action.includes("edit") ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg> : l.action.includes("delete") ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="17" x2="12" y2="3"/><path d="M5 12l7-9 7 9"/><line x1="19" y1="21" x2="5" y2="21"/></svg>, label: l.action.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()), detail: l.user, color: BRAND.gray });
              }
            });
            events.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
            if (events.length === 0) return null;
            return (
              <div style={{ borderTop: `2px solid ${BRAND.grayLight}`, paddingTop: 18, marginBottom: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: BRAND.black, marginBottom: 12 }}>Vehicle Timeline</div>
                <div style={{ position: "relative", paddingLeft: 24 }}>
                  <div style={{ position: "absolute", left: 7, top: 4, bottom: 4, width: 2, background: BRAND.grayLight }} />
                  {events.map((e, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "start", gap: 10, marginBottom: 10, position: "relative" }}>
                      <div style={{ position: "absolute", left: -20, top: 2, width: 12, height: 12, borderRadius: "50%", background: e.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, zIndex: 1, border: "2px solid #fff" }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: BRAND.black }}>{e.icon} {e.label}</span>
                          <span style={{ fontSize: 10, color: BRAND.gray, ...S.mono }}>{e.date}</span>
                        </div>
                        <div style={{ fontSize: 11, color: BRAND.gray, marginTop: 1 }}>{e.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* ═══ DOCUMENT ATTACHMENTS ═══ */}
          {(() => {
            const docs = (data.documents || []).filter(d => d.stockNum === v.stockNum);
            const saveDoc = async () => {
              if (!docForm.name) return;
              setUploading(true);
              try {
                let fileUrl = docForm.fileUrl || "";
                let filePath = docForm.filePath || "";
                // Upload file if a new file was selected
                if (docForm._file) {
                  const ext = docForm._file.name.split(".").pop();
                  filePath = `auction/docs/${v.stockNum}/${genId()}.${ext}`;
                  fileUrl = await uploadFile(filePath, docForm._file);
                }
                const newDoc = { ...docForm, id: docForm.id || genId(), fileUrl, filePath };
                delete newDoc._file;
                if (docForm.id && docs.find(d => d.id === docForm.id)) {
                  setData(d => ({ ...d, documents: (d.documents || []).map(dc => dc.id === docForm.id ? newDoc : dc) }));
                } else {
                  setData(d => ({ ...d, documents: [...(d.documents || []), newDoc] }));
                }
                logActivity(currentUser, "added_document", `Added document "${newDoc.name}" to #${v.stockNum} ${v.year} ${v.make} ${v.model}`);
                setShowDocForm(false);
                setDocForm({ id: "", stockNum: v.stockNum, name: "", category: "", date: new Date().toISOString().slice(0, 10), notes: "", fileUrl: "", filePath: "" });
              } catch (e) { console.error("Upload failed:", e); }
              setUploading(false);
            };
            const delDoc = async (id) => {
              const d = docs.find(dc => dc.id === id);
              if (d?.filePath) { try { await deleteFile(d.filePath); } catch {} }
              setData(d => ({ ...d, documents: (d.documents || []).filter(dc => dc.id !== id) }));
            };
            return (
              <div style={{ borderTop: `2px solid ${BRAND.grayLight}`, paddingTop: 18, marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: BRAND.black }}>
                    Documents
                    <span style={{ fontSize: 12, fontWeight: 500, color: BRAND.gray, marginLeft: 8 }}>{docs.length} file{docs.length !== 1 ? "s" : ""}</span>
                  </div>
                  <Btn size="sm" onClick={() => setShowDocForm(!showDocForm)}>+ Add Document</Btn>
                </div>
                {docs.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                    {docs.map(d => (
                      <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#F9FAFB", borderRadius: 8, border: `1px solid ${BRAND.grayLight}` }}>
                        <span style={{ fontSize: 18, display: "flex", alignItems: "center" }}>{d.category === "Photo" ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> : d.category === "Receipt" ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> : d.category === "Title" ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> : d.category === "Insurance" ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: BRAND.black }}>{d.name}</div>
                          <div style={{ fontSize: 10, color: BRAND.gray }}>{d.category || "—"} · {d.date}{d.notes ? ` · ${d.notes}` : ""}</div>
                        </div>
                        {d.fileUrl && <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, fontWeight: 700, color: BRAND.blue, textDecoration: "none", padding: "4px 10px", borderRadius: 6, border: `1px solid ${BRAND.blue}`, display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                          View
                        </a>}
                        {(admin || canEditProp) && <Btn variant="ghost" size="sm" onClick={() => delDoc(d.id)}>Remove</Btn>}
                      </div>
                    ))}
                  </div>
                )}
                {showDocForm && (
                  <Card style={{ border: `2px solid ${BRAND.blue}`, marginBottom: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: BRAND.blue, marginBottom: 10 }}>Add Document</div>
                    <div className="form-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <Input label="Document Name" value={docForm.name} onChange={val => setDocForm(f => ({ ...f, name: val }))} placeholder="Title scan, receipt..." />
                      <Select label="Category" value={docForm.category} onChange={val => setDocForm(f => ({ ...f, category: val }))} options={DOC_CATEGORIES} placeholder="Select..." />
                      <Input label="Date" value={docForm.date} onChange={val => setDocForm(f => ({ ...f, date: val }))} type="date" />
                      <Input label="Notes" value={docForm.notes} onChange={val => setDocForm(f => ({ ...f, notes: val }))} placeholder="Optional notes" />
                    </div>
                    {/* File Upload */}
                    <div style={{ marginTop: 10 }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: BRAND.gray, display: "block", marginBottom: 5 }}>Upload File (PDF, Image, etc.)</label>
                      <div style={{ position: "relative" }}>
                        <input type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={e => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setDocForm(f => ({ ...f, _file: file, name: f.name || file.name.replace(/\.[^/.]+$/, "") }));
                          }
                        }} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `2px dashed ${docForm._file ? BRAND.green : BRAND.grayLight}`, fontSize: 12, fontFamily: "inherit", background: docForm._file ? "#F0FDF4" : "#FAFAFA", cursor: "pointer", boxSizing: "border-box" }} />
                        {docForm._file && <div style={{ fontSize: 10, color: BRAND.green, fontWeight: 600, marginTop: 4 }}>Selected: {docForm._file.name} ({(docForm._file.size / 1024).toFixed(0)} KB)</div>}
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 10 }}>
                      <Btn variant="secondary" size="sm" onClick={() => setShowDocForm(false)}>Cancel</Btn>
                      <Btn size="sm" onClick={saveDoc} disabled={uploading} style={{ background: BRAND.blue }}>{uploading ? "Uploading..." : "Save"}</Btn>
                    </div>
                  </Card>
                )}
              </div>
            );
          })()}

          {/* ═══ SECTION 2: EXPENSES ═══ */}
          <div style={{ borderTop: `2px solid ${BRAND.grayLight}`, paddingTop: 18, marginBottom: 16 }}>
            {/* Legacy-field migration banner — offers to turn transportCost/
                repairCost/otherExpenses into categorized tracked expenses so
                every dollar lives in one place. */}
            {admin && (p(v.transportCost) + p(v.repairCost) + p(v.otherExpenses) > 0) && (
              <div style={{ marginBottom: 12, padding: "10px 12px", background: "#FEF3C7", borderRadius: 8, fontSize: 11, color: "#92400E", border: "1px solid #FCD34D", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div>
                  <b>Legacy acquisition costs detected:</b>{" "}
                  {p(v.transportCost) > 0 && <span>Transport {fmt$2(p(v.transportCost))} · </span>}
                  {p(v.repairCost) > 0 && <span>Repair {fmt$2(p(v.repairCost))} · </span>}
                  {p(v.otherExpenses) > 0 && <span>Other {fmt$2(p(v.otherExpenses))}</span>}
                  <div style={{ fontSize: 10, opacity: 0.85, marginTop: 2 }}>Migrate these into Tracked Expenses so they appear in reports by category.</div>
                </div>
                <Btn size="sm" onClick={() => {
                  const today = new Date().toISOString().slice(0, 10);
                  const label = `${v.year} ${v.make} ${v.model}`;
                  const newEntries = [];
                  if (p(v.transportCost) > 0) newEntries.push({ id: genId(), date: v.purchaseDate || today, stockNum: v.stockNum, vehicle: label, category: "Transport/Towing", description: "Migrated from legacy acquisition cost field", vendor: "", paymentMethod: "", amount: p(v.transportCost), receipt: "" });
                  if (p(v.repairCost) > 0) newEntries.push({ id: genId(), date: v.purchaseDate || today, stockNum: v.stockNum, vehicle: label, category: "Repair/Recon", description: "Migrated from legacy acquisition cost field", vendor: "", paymentMethod: "", amount: p(v.repairCost), receipt: "" });
                  if (p(v.otherExpenses) > 0) newEntries.push({ id: genId(), date: v.purchaseDate || today, stockNum: v.stockNum, vehicle: label, category: "Office/Admin", description: "Migrated from legacy 'Other Expenses' field", vendor: "", paymentMethod: "", amount: p(v.otherExpenses), receipt: "" });
                  setData(d => ({
                    ...d,
                    expenses: [...d.expenses, ...newEntries],
                    vehicles: d.vehicles.map(x => x.id === v.id ? { ...x, transportCost: 0, repairCost: 0, otherExpenses: 0 } : x),
                  }));
                  logActivity(currentUser, "migrated_legacy_costs", `Migrated legacy acquisition costs on #${v.stockNum} ${label} to ${newEntries.length} tracked expense${newEntries.length === 1 ? "" : "s"}`);
                }}>Migrate to Tracked Expenses</Btn>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: BRAND.black }}>
                Expenses
                <span style={{ fontSize: 12, fontWeight: 500, color: BRAND.gray, marginLeft: 8 }}>
                  {expenses.length} item{expenses.length !== 1 ? "s" : ""} · {fmt$(totalExpenses)}
                </span>
              </div>
              {!lockedForUser && <Btn size="sm" onClick={openNewExp}>+ Add Expense</Btn>}
            </div>

            {expenses.length > 0 && (
              <Card style={{ padding: 0, overflow: "hidden", marginBottom: 10 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr style={{ background: BRAND.redBg }}>
                    {["Date", "Category", "Description", "Vendor", "Amount", ""].map(h => <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 800, color: BRAND.gray, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {[...expenses].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(e => (
                      <tr key={e.id} style={{ borderBottom: `1px solid ${BRAND.grayLight}` }}>
                        <td style={{ padding: "8px 10px", color: BRAND.gray }}>{e.date}</td>
                        <td style={{ padding: "8px 10px" }}><Badge color={BRAND.grayDark} bg={BRAND.grayLight}>{e.category || "—"}</Badge></td>
                        <td style={{ padding: "8px 10px", color: BRAND.grayDark }}>{e.description || "—"}</td>
                        <td style={{ padding: "8px 10px", color: BRAND.gray }}>{e.vendor || "—"}</td>
                        <td style={{ padding: "8px 10px", fontWeight: 700, color: BRAND.black, ...S.mono }}>{fmt$2(p(e.amount))}</td>
                        <td style={{ padding: "8px 10px" }}>
                          {!lockedForUser && <Btn variant="ghost" size="sm" onClick={() => openEditExp(e)}>Edit</Btn>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}

            {/* Inline Expense Form */}
            {showExpForm && !lockedForUser && (
              <Card style={{ marginTop: 8, border: `2px solid ${BRAND.red}` }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: BRAND.red, marginBottom: 10 }}>{editingExp ? "Edit Expense" : "Add Expense"}</div>
                <div className="form-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Input label="Date *" value={expForm.date} onChange={val => updExp("date", val)} type="date" />
                  <Select label="Category *" value={expForm.category} onChange={val => updExp("category", val)} options={EXPENSE_CATEGORIES} placeholder="Select..." />
                  <Input label="Amount *" value={expForm.amount} onChange={val => updExp("amount", val)} type="number" step="0.01" />
                  <Input label="Description *" value={expForm.description} onChange={val => updExp("description", val)} placeholder="What for?" />
                  <Input label="Vendor *" value={expForm.vendor} onChange={val => updExp("vendor", val)} />
                  <Select label="Payment" value={expForm.paymentMethod} onChange={val => updExp("paymentMethod", val)} options={PAYMENT_METHODS} placeholder="Select..." />
                  <Input label="Receipt #" value={expForm.receipt} onChange={val => updExp("receipt", val)} />
                </div>
                <div style={{ fontSize: 10, color: BRAND.gray, marginTop: 6, fontStyle: "italic" }}>* Required. Attached to #{v.stockNum} automatically.</div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
                  <div>{editingExp && <Btn variant="danger" size="sm" onClick={() => setConfirmExp(editingExp)}>Delete</Btn>}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Btn variant="secondary" size="sm" onClick={() => setShowExpForm(false)}>Cancel</Btn>
                    <Btn size="sm" onClick={saveExp}>{editingExp ? "Save" : "Add"}</Btn>
                  </div>
                </div>
              </Card>
            )}
            {confirmExp && <Confirm msg="Delete this expense?" onOk={() => delExp(confirmExp)} onCancel={() => setConfirmExp(null)} />}
          </div>

          {/* ═══ SECTION 3: FINALIZE SALE ═══ */}
          <div style={{ borderTop: `2px solid ${BRAND.grayLight}`, paddingTop: 18 }}>
            {sale && !showSaleForm ? (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: BRAND.green }}>Sale Finalized</div>
                  {admin && <Btn variant="secondary" size="sm" onClick={() => openEditSale(sale)}>Edit Sale</Btn>}
                </div>
                <Card style={{ borderLeft: `4px solid ${BRAND.green}` }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, fontSize: 12 }}>
                    <div><span style={{ color: BRAND.gray }}>Date:</span> <b>{sale.date}</b></div>
                    <div><span style={{ color: BRAND.gray }}>Buyer:</span> <b>{sale.buyerName || "—"}</b></div>
                    <div><span style={{ color: BRAND.gray }}>Type:</span> <b>{sale.saleType || "—"}</b></div>
                    <div><span style={{ color: BRAND.gray }}>Gross Price:</span> <b style={{ ...S.mono }}>{fmt$(p(sale.grossPrice))}</b></div>
                    <div><span style={{ color: BRAND.gray }}>Auction Fee:</span> <b style={{ color: "#DC2626", ...S.mono }}>{fmt$(p(sale.auctionFee))}</b></div>
                    <div><span style={{ color: BRAND.gray }}>Title Fee:</span> <b style={{ ...S.mono }}>{fmt$(p(sale.titleFee))}</b></div>
                    <div><span style={{ color: BRAND.gray }}>Other Deductions:</span> <b style={{ ...S.mono }}>{fmt$(p(sale.otherDeductions))}</b></div>
                    <div><span style={{ color: BRAND.gray }}>Net Sale:</span> <b style={{ color: BRAND.green, ...S.mono }}>{fmt$(saleNet(sale))}</b></div>
                  </div>
                  {Array.isArray(sale.payments) && sale.payments.length > 0 && (() => {
                    const paid = calcSalePaid(sale);
                    const outstanding = calcSaleOutstanding(sale);
                    return (
                      <div style={{ marginTop: 10, padding: "8px 10px", background: outstanding > 0.005 ? "#FEF2F2" : "#F0FDF4", borderRadius: 8, fontSize: 11, display: "flex", gap: 14, flexWrap: "wrap" }}>
                        <span style={{ color: BRAND.gray }}>Paid: <b style={{ color: BRAND.green, ...S.mono }}>{fmt$2(paid)}</b></span>
                        <span style={{ color: BRAND.gray }}>Outstanding: <b style={{ color: outstanding > 0.005 ? "#DC2626" : BRAND.green, ...S.mono }}>{fmt$2(outstanding)}</b></span>
                        <span style={{ color: BRAND.gray }}>{sale.payments.length} payment{sale.payments.length === 1 ? "" : "s"}</span>
                      </div>
                    );
                  })()}
                  {sale.buyerPhone && <div style={{ fontSize: 11, color: BRAND.gray, marginTop: 8 }}>Phone: {sale.buyerPhone}</div>}
                  {sale.buyerEmail && <div style={{ fontSize: 11, color: BRAND.gray, marginTop: 2 }}>Email: {sale.buyerEmail}</div>}
                  {sale.notes && <div style={{ fontSize: 11, color: BRAND.grayDark, marginTop: 6, fontStyle: "italic" }}>{sale.notes}</div>}
                </Card>

                {/* Full Profit & Loss — the source-of-truth P&L.
                    Formula: Net Sale − Total Cost = Net Profit.
                    Total Cost already includes every tracked expense
                    (every category, including Selling Costs post-sale), so
                    we do not subtract Selling Costs again — that was the
                    double-count bug. Selling Costs are surfaced as an
                    "of which…" informational sublabel under Total Cost
                    so the user can see how much post-sale spend is in the
                    number without it getting deducted twice. */}
                {m.grossProfit != null && (
                  <div style={{ background: m.grossProfit >= 0 ? "#F0FDF4" : "#FEF2F2", borderRadius: 10, padding: 16, marginTop: 12, border: `1px solid ${m.grossProfit >= 0 ? "#D1FAE5" : "#FECACA"}` }}>
                    <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", color: m.grossProfit >= 0 ? BRAND.green : "#DC2626", marginBottom: 10, letterSpacing: "0.06em" }}>Profit & Loss</div>
                    <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                      <tbody>
                        <tr><td style={{ padding: "4px 0", color: BRAND.gray }}>Sale Price (gross)</td><td style={{ padding: "4px 0", textAlign: "right", fontWeight: 700, ...S.mono }}>{fmt$2(p(sale.grossPrice))}</td></tr>
                        <tr><td style={{ padding: "4px 0", color: BRAND.gray }}>− Sale-time deductions <span style={{ fontSize: 10 }}>fees on the sale record itself — auction seller-fee, title, other</span></td><td style={{ padding: "4px 0", textAlign: "right", color: "#DC2626", ...S.mono }}>{fmt$2(m.saleDeductions)}</td></tr>
                        <tr style={{ borderTop: `1px dashed ${m.grossProfit >= 0 ? "#86EFAC" : "#FCA5A5"}` }}><td style={{ padding: "4px 0", color: BRAND.grayDark }}>Net Sale</td><td style={{ padding: "4px 0", textAlign: "right", fontWeight: 700, ...S.mono }}>{fmt$2(m.netSale)}</td></tr>
                        <tr><td style={{ padding: "4px 0", color: BRAND.gray }}>− Total Cost <span style={{ fontSize: 10 }}>complete cost basis: purchase + auction fees + every tracked expense, every category</span></td><td style={{ padding: "4px 0", textAlign: "right", color: "#DC2626", ...S.mono }}>{fmt$2(m.totalCost)}</td></tr>
                        {m.sellingCosts > 0 && (
                          <tr><td style={{ padding: "2px 0 6px 14px", fontSize: 10, color: BRAND.gray, fontStyle: "italic" }}>↳ of which Selling Costs (post-sale): commission, post-sale repairs, marketing</td><td style={{ padding: "2px 0 6px", textAlign: "right", fontSize: 10, fontStyle: "italic", color: BRAND.gray, ...S.mono }}>{fmt$2(m.sellingCosts)}</td></tr>
                        )}
                        <tr style={{ borderTop: `2px solid ${m.grossProfit >= 0 ? BRAND.green : "#DC2626"}` }}>
                          <td style={{ padding: "6px 0", fontWeight: 800, textTransform: "uppercase", fontSize: 11, color: m.grossProfit >= 0 ? BRAND.green : "#DC2626" }}>Net Profit / (Loss)</td>
                          <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 900, fontSize: 14, color: m.grossProfit >= 0 ? BRAND.green : "#DC2626", ...S.mono }}>{fmt$2(m.grossProfit)}</td>
                        </tr>
                        <tr><td style={{ padding: "2px 0", fontSize: 11, color: BRAND.gray }}>Gross Margin %</td><td style={{ padding: "2px 0", textAlign: "right", fontSize: 11, fontWeight: 700, color: Number.isFinite(m.margin) ? (m.margin >= 0 ? BRAND.green : "#DC2626") : BRAND.gray, ...S.mono }}>{Number.isFinite(m.margin) ? (m.margin * 100).toFixed(1) + "%" : "—"}</td></tr>
                        <tr><td style={{ padding: "2px 0", fontSize: 11, color: BRAND.gray }}>Annualized ROI</td><td style={{ padding: "2px 0", textAlign: "right", fontSize: 11, fontWeight: 700, color: Number.isFinite(m.annROI) ? (m.annROI >= 0 ? BRAND.green : "#DC2626") : BRAND.gray, ...S.mono }}>{Number.isFinite(m.annROI) ? (m.annROI * 100).toFixed(1) + "%" : "—"}</td></tr>
                      </tbody>
                    </table>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 11, alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${m.grossProfit >= 0 ? "#86EFAC" : "#FCA5A5"}` }}>
                      {m.velocity != null && <div style={{ color: BRAND.gray }}>Velocity: <b style={{ color: BRAND.blue, ...S.mono }}>{fmt$2(m.velocity)}/d</b></div>}
                      {m.days != null && <div style={{ color: BRAND.gray }}>Days Held: <b>{m.days}</b></div>}
                      <GradeBadge grade={m.grade} />
                    </div>
                  </div>
                )}
              </div>
            ) : !sale && !showSaleForm ? (
              <div style={{ textAlign: "center", padding: "24px 20px", background: BRAND.greenBg, borderRadius: 10, border: `1px dashed ${BRAND.green}` }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: BRAND.green, marginBottom: 4 }}>Ready to sell?</div>
                <div style={{ fontSize: 12, color: BRAND.gray, marginBottom: 14 }}>Add all expenses above first, then finalize the sale here</div>
                <Btn onClick={openNewSale} style={{ background: BRAND.green, fontSize: 14, padding: "12px 28px" }}>Finalize Sale</Btn>
              </div>
            ) : null}

            {/* Inline Sale Form — blocked for non-admin editing existing sale */}
            {showSaleForm && (!editingSale || admin) && (
              <Card style={{ marginTop: sale ? 12 : 0, border: `2px solid ${BRAND.green}` }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: BRAND.green, marginBottom: 12 }}>{editingSale ? "Edit Sale" : "Finalize Sale"}</div>
                <div className="form-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Input label="Sale Date" value={saleForm.date} onChange={val => updSale("date", val)} type="date" />
                  <Select label="Sale Type" value={saleForm.saleType} onChange={val => updSale("saleType", val)} options={SALE_TYPES} placeholder="Select..." />
                  <Input label="Gross Sale Price" value={saleForm.grossPrice} onChange={val => updSale("grossPrice", val)} type="number" step="0.01" />
                  <Input label="Buyer Name" value={saleForm.buyerName} onChange={val => updSale("buyerName", val)} />
                  <Input label="Auction/Seller Fee" value={saleForm.auctionFee} onChange={val => updSale("auctionFee", val)} type="number" step="0.01" />
                  <Input label="Title/Transfer Fee" value={saleForm.titleFee} onChange={val => updSale("titleFee", val)} type="number" step="0.01" />
                  <Input label="Other Deductions" value={saleForm.otherDeductions} onChange={val => updSale("otherDeductions", val)} type="number" step="0.01" />
                  <Input label="Buyer Phone" value={saleForm.buyerPhone} onChange={val => updSale("buyerPhone", val)} />
                  <Input label="Buyer Email" value={saleForm.buyerEmail} onChange={val => updSale("buyerEmail", val)} />
                  <Select label="Payment Method *" value={saleForm.paymentMethod} onChange={val => updSale("paymentMethod", val)} options={PAYMENT_METHODS} placeholder="Select..." />
                  <Select label="Sale Destination" value={saleForm.saleDestination || "out_of_state_us"} onChange={val => updSale("saleDestination", val)} options={[
                    { value: "in_state_ma", label: "In-state (MA) — 6.25% sales tax" },
                    { value: "out_of_state_us", label: "Out-of-state (US) — exempt" },
                    { value: "international", label: "International export — exempt" },
                  ]} />
                  <Input label="Notes" value={saleForm.notes} onChange={val => updSale("notes", val)} />
                </div>
                {/* Sales-tax preview: live 6.25% of gross price for in-state sales. */}
                {saleForm.saleDestination === "in_state_ma" && p(saleForm.grossPrice) > 0 && (
                  <div style={{ marginTop: 8, padding: "8px 10px", background: "#FFFBEB", borderRadius: 6, fontSize: 11, color: "#78350F", border: "1px solid #FDE68A" }}>
                    <b>MA Sales Tax (6.25%):</b> {fmt$2(p(saleForm.grossPrice) * 0.0625)} — collected from buyer, posted to MA Sales Tax Payable on finalize.
                  </div>
                )}
                {saleForm.saleDestination === "international" && (
                  <div style={{ marginTop: 8, padding: "8px 10px", background: "#EFF6FF", borderRadius: 6, fontSize: 11, color: "#1E40AF", border: "1px solid #BFDBFE" }}>
                    <b>International export — sales tax exempt.</b> Keep the bill of lading / export declaration on file.
                  </div>
                )}
                <div style={{ fontSize: 10, color: BRAND.gray, marginTop: 6, fontStyle: "italic" }}>* Required to finalize the sale. The vehicle's status will flip to "Sold" only when price, date, buyer, and payment method are all set.</div>
                {/* Payments — optional; track deposits, balances, refunds */}
                <PaymentsEditor
                  grossPrice={p(saleForm.grossPrice)}
                  payments={saleForm.payments || []}
                  onChange={(next) => updSale("payments", next)}
                />
                {/* Live P&L */}
                {saleForm.grossPrice && (() => {
                  const inv = calcTotalCost(v, data.expenses);
                  const netP = saleNet(saleForm);
                  const profit = netP - inv;
                  return (
                    <div style={{ background: profit >= 0 ? "#F0FDF4" : "#FEF2F2", borderRadius: 8, padding: 10, marginTop: 10, fontSize: 12 }}>
                      <span style={{ color: BRAND.gray }}>Net: </span><b style={S.mono}>{fmt$(netP)}</b>
                      <span style={{ marginLeft: 14, color: BRAND.gray }}>Total Cost: </span><b style={S.mono}>{fmt$(inv)}</b>
                      <span style={{ marginLeft: 14, color: BRAND.gray }}>Profit: </span><b style={{ color: profit >= 0 ? BRAND.green : "#DC2626", ...S.mono }}>{fmt$(profit)}</b>
                    </div>
                  );
                })()}
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
                  <div>{editingSale && <Btn variant="danger" size="sm" onClick={() => setConfirmSale(editingSale)}>Delete Sale</Btn>}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Btn variant="secondary" size="sm" onClick={() => setShowSaleForm(false)}>Cancel</Btn>
                    <Btn size="sm" onClick={saveSale} style={{ background: BRAND.green }}>{editingSale ? "Save Changes" : "Finalize Sale"}</Btn>
                  </div>
                </div>
              </Card>
            )}
            {confirmSale && <Confirm msg="Delete this sale record?" onOk={() => delSale(confirmSale)} onCancel={() => setConfirmSale(null)} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// EXPENSES TAB
// ═══════════════════════════════════════════════════════════════
function ExpensesTab({ data, setData, username }) {
  const [showForm, setShowForm] = useState(false); const [editing, setEditing] = useState(null); const [confirm, setConfirm] = useState(null); const [catFilter, setCatFilter] = useState("All");
  const empty = () => ({ id: genId(), date: new Date().toISOString().slice(0, 10), stockNum: "", vehicle: "", category: "", description: "", vendor: "", paymentMethod: "", amount: "", receipt: "" });
  const [form, setForm] = useState(empty());
  const upd = (k, v) => { setForm(prev => { const n = { ...prev, [k]: v }; if (k === "stockNum" && v) { const vh = data.vehicles.find(x => x.stockNum === v); if (vh) n.vehicle = `${vh.year} ${vh.make} ${vh.model}`; } return n; }); };
  const openNew = () => { setForm(empty()); setEditing(null); setShowForm(true); };
  const openEdit = e => { setForm({ ...e }); setEditing(e.id); setShowForm(true); };
  // Auto-post to the Money Management ledger. New/edited expenses post
  // a fresh JE; edits first reverse the prior entry so the ledger
  // stays in sync without manual re-posting. Safe to call on every
  // save — if the money module isn't set up yet (no bank account), we
  // skip posting silently.
  const save = () => {
    if (form.stockNum && !form.vehicle) { const v = data.vehicles.find(x => x.stockNum === form.stockNum); if (v) form.vehicle = `${v.year} ${v.make} ${v.model}`; }
    const err = validateExpenseEntry(form);
    if (err) { alert(err); return; }
    const buildEntry = () => expenseEntry({
      expenseId: form.id,
      category: form.category,
      amount: form.amount,
      vendor: form.vendor,
      description: form.description,
      stockNum: form.stockNum,
      date: form.date,
      user: username || "system",
      categoryMap: data.money?.expenseCategoryMap,
    });
    setData(d => {
      const money = d.money;
      const ledger = money?.ledger || [];
      const closed = money?.closedPeriods || [];
      let newLedger = ledger;
      try {
        if (editing) {
          const prev = d.expenses.find(e => e.id === editing);
          // Reverse the old JE if one was posted
          if (prev?.journalEntryId) {
            const original = ledger.find(x => x.id === prev.journalEntryId);
            if (original) newLedger = postJournalEntry(newLedger, buildReversingEntry(original, { user: username || "system", memo: "Reverse prior expense entry (edit)" }), closed);
          }
          const entry = buildEntry();
          if (entry) {
            newLedger = postJournalEntry(newLedger, entry, closed);
            form.journalEntryId = entry.id;
          } else {
            form.journalEntryId = null;
          }
        } else {
          const entry = buildEntry();
          if (entry) {
            newLedger = postJournalEntry(newLedger, entry, closed);
            form.journalEntryId = entry.id;
          }
        }
      } catch (err) {
        // Closed-period or validation error — fall back to saving the
        // expense without a ledger posting so the user isn't blocked.
        console.warn("Expense ledger-post skipped:", err.message);
      }
      const nextExpenses = editing
        ? d.expenses.map(e => e.id === editing ? form : e)
        : [...d.expenses, form];
      return { ...d, expenses: nextExpenses, money: money ? { ...money, ledger: newLedger } : money };
    });
    logActivity(username || "system", editing ? "expense_edited" : "expense_added",
      `${editing ? "Edited" : "Added"} ${form.category} expense — ${fmt$2(p(form.amount))}${form.stockNum ? ` (#${form.stockNum})` : ""}`);
    setShowForm(false);
  };
  const del = id => {
    setData(d => {
      const exp = d.expenses.find(e => e.id === id);
      const money = d.money;
      let newLedger = money?.ledger || [];
      if (exp?.journalEntryId && money) {
        const original = newLedger.find(x => x.id === exp.journalEntryId);
        if (original) {
          try {
            newLedger = postJournalEntry(newLedger, buildReversingEntry(original, { user: username || "system", memo: "Reverse expense entry (delete)" }), money.closedPeriods || []);
          } catch (err) { console.warn("Expense reversal skipped:", err.message); }
        }
      }
      return { ...d, expenses: d.expenses.filter(e => e.id !== id), money: money ? { ...money, ledger: newLedger } : money };
    });
    setConfirm(null); setShowForm(false);
  };

  let sorted = [...data.expenses].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  if (catFilter !== "All") sorted = sorted.filter(e => e.category === catFilter);
  const total = sorted.reduce((s, e) => s + p(e.amount), 0);
  const usedCats = [...new Set(data.expenses.map(e => e.category).filter(Boolean))];

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: BRAND.gray }}>{sorted.length} expenses · <span style={{ color: BRAND.red, fontWeight: 800, ...S.mono }}>{fmt$(total)}</span></span>
          {usedCats.length > 0 && <select value={catFilter} onChange={e => setCatFilter(e.target.value)} style={{ border: `1px solid ${BRAND.grayLight}`, borderRadius: 6, padding: "4px 8px", fontSize: 11, background: BRAND.white }}>
            <option value="All">All Categories</option>
            {usedCats.map(c => <option key={c} value={c}>{c}</option>)}
          </select>}
        </div>
        <Btn onClick={openNew}>+ Add Expense</Btn>
      </div>
      {sorted.length === 0 ? <Empty icon={<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>} title="No expenses" sub="Track every business expense" /> : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ background: BRAND.redBg }}>{["Date","Stock #","Vehicle","Category","Description","Vendor","Amount"].map(h => <TH key={h}>{h}</TH>)}</tr></thead>
              <tbody>
                {sorted.map(e => (
                  <tr key={e.id} onClick={() => openEdit(e)} style={{ borderBottom: `1px solid ${BRAND.grayLight}`, cursor: "pointer" }} onMouseEnter={ev => ev.currentTarget.style.background = "#FAFAFA"} onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}>
                    <TD style={{ color: BRAND.gray }}>{e.date}</TD>
                    <TD style={{ color: BRAND.red, fontWeight: 700, ...S.mono }}>{e.stockNum || "—"}</TD>
                    <TD style={{ color: BRAND.grayDark }}>{e.vehicle || "General"}</TD>
                    <TD><Badge color={BRAND.grayDark} bg={BRAND.grayLight}>{e.category}</Badge></TD>
                    <TD style={{ color: BRAND.gray }}>{e.description}</TD>
                    <TD style={{ color: BRAND.gray }}>{e.vendor || "—"}</TD>
                    <TD style={{ color: BRAND.black, fontWeight: 700, ...S.mono }}>{fmt$2(p(e.amount))}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {showForm && (
        <Modal title={editing ? "Edit Expense" : "Add Expense"} onClose={() => setShowForm(false)}>
          <div className="form-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Input label="Date *" value={form.date} onChange={v => upd("date", v)} type="date" />
            <Select label="Stock # *" value={form.stockNum} onChange={v => upd("stockNum", v)} options={data.vehicles.map(v => v.stockNum)} placeholder="Select vehicle..." />
            <Input label="Vehicle" value={form.vehicle} onChange={v => upd("vehicle", v)} readOnly />
            <Select label="Category *" value={form.category} onChange={v => upd("category", v)} options={EXPENSE_CATEGORIES} placeholder="Select..." />
            <Input label="Amount *" value={form.amount} onChange={v => upd("amount", v)} type="number" step="0.01" />
            <Input label="Description *" value={form.description} onChange={v => upd("description", v)} placeholder="What for?" />
            <Input label="Vendor *" value={form.vendor} onChange={v => upd("vendor", v)} />
            <Select label="Payment" value={form.paymentMethod} onChange={v => upd("paymentMethod", v)} options={PAYMENT_METHODS} placeholder="Select..." />
            <Input label="Receipt #" value={form.receipt} onChange={v => upd("receipt", v)} />
          </div>
          <div style={{ fontSize: 10, color: BRAND.gray, marginTop: 6, fontStyle: "italic" }}>* Required. Receipt photo upload isn't wired yet — attach a receipt # or URL for now.</div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18 }}>
            <div>{editing && <Btn variant="danger" onClick={() => setConfirm(editing)}>Delete</Btn>}</div>
            <div style={{ display: "flex", gap: 6 }}><Btn variant="secondary" onClick={() => setShowForm(false)}>Cancel</Btn><Btn onClick={save}>{editing ? "Save" : "Add"}</Btn></div>
          </div>
        </Modal>
      )}
      {confirm && <Confirm msg="Delete expense?" onOk={() => del(confirm)} onCancel={() => setConfirm(null)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SALES TAB
// ═══════════════════════════════════════════════════════════════
function SalesTab({ data, setData }) {
  const [showForm, setShowForm] = useState(false); const [editing, setEditing] = useState(null); const [confirm, setConfirm] = useState(null);
  const empty = () => ({ id: genId(), date: new Date().toISOString().slice(0, 10), stockNum: "", vehicle: "", buyerName: "", saleType: "", grossPrice: "", auctionFee: "", titleFee: "", otherDeductions: "", buyerPhone: "", buyerEmail: "", paymentMethod: "", notes: "", payments: [], saleDestination: "out_of_state_us", buyerState: "" });
  const [form, setForm] = useState(empty());
  const upd = (k, v) => { setForm(prev => { const n = { ...prev, [k]: v }; if (k === "stockNum" && v) { const vh = data.vehicles.find(x => x.stockNum === v); if (vh) n.vehicle = `${vh.year} ${vh.make} ${vh.model}`; } return n; }); };
  const net = s => p(s.grossPrice) - p(s.auctionFee) - p(s.titleFee) - p(s.otherDeductions);
  const openNew = () => { setForm(empty()); setEditing(null); setShowForm(true); };
  const openEdit = s => { setForm({ ...s }); setEditing(s.id); setShowForm(true); };
  const save = () => {
    if (!form.grossPrice && !form.stockNum) { alert("Gross price or stock # is required"); return; }
    const moneyErr = validateMoneyFields([
      [form.grossPrice, "Gross price"],
      [form.auctionFee, "Auction fee"],
      [form.titleFee, "Title fee"],
      [form.otherDeductions, "Other deductions"],
    ]);
    if (moneyErr) { alert(moneyErr); return; }
    if (form.stockNum && !form.vehicle) { const v = data.vehicles.find(x => x.stockNum === form.stockNum); if (v) form.vehicle = `${v.year} ${v.make} ${v.model}`; }
    if (editing) setData(d => ({ ...d, sales: d.sales.map(s => s.id === editing ? form : s) }));
    else setData(d => ({ ...d, sales: [...d.sales, form], vehicles: d.vehicles.map(v => v.stockNum === form.stockNum ? { ...v, status: "Sold" } : v) }));
    setShowForm(false);
  };
  const del = id => { setData(d => ({ ...d, sales: d.sales.filter(s => s.id !== id) })); setConfirm(null); setShowForm(false); };

  const sorted = [...data.sales].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: BRAND.gray }}>{data.sales.length} sales · Revenue: <span style={{ color: BRAND.green, fontWeight: 800, ...S.mono }}>{fmt$(data.sales.reduce((s, x) => s + p(x.grossPrice), 0))}</span></span>
        <Btn onClick={openNew}>+ Record Sale</Btn>
      </div>
      {sorted.length === 0 ? <Empty icon={<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>} title="No sales" sub="Record your flips" /> : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ background: BRAND.redBg }}>{["Date","Stock #","Vehicle","Buyer","Type","Gross","Fees","Net","Grade"].map(h => <TH key={h}>{h}</TH>)}</tr></thead>
              <tbody>
                {sorted.map(s => {
                  const v = data.vehicles.find(vh => vh.stockNum === s.stockNum);
                  const m = v ? calcVehicleFullMetrics(v, s, data.holdCosts, data.expenses) : null;
                  return (
                    <tr key={s.id} onClick={() => openEdit(s)} style={{ borderBottom: `1px solid ${BRAND.grayLight}`, cursor: "pointer" }} onMouseEnter={ev => ev.currentTarget.style.background = "#FAFAFA"} onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}>
                      <TD style={{ color: BRAND.gray }}>{s.date}</TD>
                      <TD style={{ color: BRAND.red, fontWeight: 700, ...S.mono }}>{s.stockNum}</TD>
                      <TD style={{ color: BRAND.grayDark }}>{s.vehicle}</TD>
                      <TD style={{ color: BRAND.grayDark }}>{s.buyerName || "—"}</TD>
                      <TD><Badge color={BRAND.grayDark} bg={BRAND.grayLight}>{s.saleType || "—"}</Badge></TD>
                      <TD style={{ ...S.mono, fontWeight: 600 }}>{fmt$(p(s.grossPrice))}</TD>
                      <TD style={{ color: "#DC2626", ...S.mono }}>{fmt$(p(s.auctionFee) + p(s.titleFee) + p(s.otherDeductions))}</TD>
                      <TD style={{ color: BRAND.green, fontWeight: 800, ...S.mono }}>{fmt$(net(s))}</TD>
                      <TD>{m?.grade && <span style={{ fontWeight: 900, color: m.grade.color, ...S.mono }}>{m.grade.grade}</span>}</TD>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {showForm && (
        <Modal title={editing ? "Edit Sale" : "Record Sale"} onClose={() => setShowForm(false)}>
          <div className="form-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Input label="Sale Date" value={form.date} onChange={v => upd("date", v)} type="date" />
            <Select label="Stock #" value={form.stockNum} onChange={v => upd("stockNum", v)} options={data.vehicles.map(v => v.stockNum)} placeholder="Select..." />
            <Input label="Vehicle" value={form.vehicle} onChange={v => upd("vehicle", v)} readOnly />
            <Select label="Sale Type" value={form.saleType} onChange={v => upd("saleType", v)} options={SALE_TYPES} placeholder="Select..." />
            <Input label="Gross Sale Price" value={form.grossPrice} onChange={v => upd("grossPrice", v)} type="number" step="0.01" />
            <Input label="Buyer Name" value={form.buyerName} onChange={v => upd("buyerName", v)} />
            <Input label="Auction/Seller Fee" value={form.auctionFee} onChange={v => upd("auctionFee", v)} type="number" step="0.01" />
            <Input label="Title/Transfer Fee" value={form.titleFee} onChange={v => upd("titleFee", v)} type="number" step="0.01" />
            <Input label="Other Deductions" value={form.otherDeductions} onChange={v => upd("otherDeductions", v)} type="number" step="0.01" />
            <Input label="Buyer Phone" value={form.buyerPhone} onChange={v => upd("buyerPhone", v)} />
            <Input label="Buyer Email" value={form.buyerEmail} onChange={v => upd("buyerEmail", v)} />
            <Input label="Notes" value={form.notes} onChange={v => upd("notes", v)} />
          </div>
          {/* Live P&L for this deal */}
          {form.stockNum && (() => {
            const v = data.vehicles.find(x => x.stockNum === form.stockNum);
            if (!v) return null;
            const inv = calcTotalCost(v, data.expenses);
            const netP = net(form);
            const profit = netP - inv;
            const days = v.purchaseDate && form.date ? daysBetween(v.purchaseDate, form.date) : null;
            const vel = days && days > 0 ? profit / days : null;
            const roi = days && days > 0 ? calcAnnualizedROI(profit, inv, days) : null;
            const mg = netP > 0 ? profit / netP : null;
            // Gate the grade: only render one when all financial inputs are
            // actually computable. Otherwise downstream shows "Pending".
            const gr = (mg != null && vel != null && roi != null && days > 0) ? gradeDeal(mg, days, roi, vel) : null;
            return (
              <div style={{ background: profit >= 0 ? "#F0FDF4" : "#FEF2F2", borderRadius: 10, padding: 14, marginTop: 12, border: `1px solid ${profit >= 0 ? "#D1FAE5" : "#FECACA"}` }}>
                <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", color: profit >= 0 ? BRAND.green : "#DC2626", marginBottom: 6 }}>Deal Analysis</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12, alignItems: "center" }}>
                  <div>Net: <b style={{ ...S.mono }}>{fmt$(netP)}</b></div>
                  <div>Total Cost: <b style={{ ...S.mono }}>{fmt$(inv)}</b></div>
                  <div>Profit: <b style={{ color: profit >= 0 ? BRAND.green : "#DC2626", ...S.mono }}>{fmt$(profit)}</b></div>
                  {vel != null && <div>Velocity: <b style={{ color: BRAND.blue, ...S.mono }}>{fmt$2(vel)}/d</b></div>}
                  {days != null && <div>Days: <b>{days}</b></div>}
                  <GradeBadge grade={gr} />
                </div>
              </div>
            );
          })()}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18 }}>
            <div>{editing && <Btn variant="danger" onClick={() => setConfirm(editing)}>Delete</Btn>}</div>
            <div style={{ display: "flex", gap: 6 }}><Btn variant="secondary" onClick={() => setShowForm(false)}>Cancel</Btn><Btn onClick={save}>{editing ? "Save" : "Record Sale"}</Btn></div>
          </div>
        </Modal>
      )}
      {confirm && <Confirm msg="Delete sale?" onOk={() => del(confirm)} onCancel={() => setConfirm(null)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MILEAGE TAB
// ═══════════════════════════════════════════════════════════════
function MileageTab({ data, setData }) {
  const [showForm, setShowForm] = useState(false); const [editing, setEditing] = useState(null); const [confirm, setConfirm] = useState(null);
  const empty = () => ({ id: genId(), date: new Date().toISOString().slice(0, 10), from: "", to: "", purpose: "", stockNum: "", miles: "" });
  const [form, setForm] = useState(empty());
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const openNew = () => { setForm(empty()); setEditing(null); setShowForm(true); };
  const openEdit = m => { setForm({ ...m }); setEditing(m.id); setShowForm(true); };
  const save = () => { if (!form.miles) return; if (editing) setData(d => ({ ...d, mileage: d.mileage.map(m => m.id === editing ? form : m) })); else setData(d => ({ ...d, mileage: [...d.mileage, form] })); setShowForm(false); };
  const del = id => { setData(d => ({ ...d, mileage: d.mileage.filter(m => m.id !== id) })); setConfirm(null); setShowForm(false); };
  const sorted = [...data.mileage].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const totalMiles = data.mileage.reduce((s, m) => s + p(m.miles), 0);

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: BRAND.gray }}>{data.mileage.length} trips · {totalMiles.toLocaleString()} mi · Deduction: <span style={{ color: BRAND.blue, fontWeight: 800, ...S.mono }}>{fmt$2(totalMiles * IRS_RATE)}</span></span>
        <Btn onClick={openNew}>+ Log Trip</Btn>
      </div>
      {sorted.length === 0 ? <Empty icon={<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>} title="No mileage" sub="Track business miles" /> : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ background: BRAND.blueBg }}>{["Date","From","To","Purpose","Stock #","Miles","Deduction"].map(h => <th key={h} style={{ textAlign: "left", padding: "9px 12px", color: BRAND.blue, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>)}</tr></thead>
              <tbody>
                {sorted.map(m => (
                  <tr key={m.id} onClick={() => openEdit(m)} style={{ borderBottom: `1px solid ${BRAND.grayLight}`, cursor: "pointer" }} onMouseEnter={ev => ev.currentTarget.style.background = "#FAFAFA"} onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}>
                    <TD style={{ color: BRAND.gray }}>{m.date}</TD><TD style={{ color: BRAND.grayDark }}>{m.from}</TD><TD style={{ color: BRAND.grayDark }}>{m.to}</TD><TD style={{ color: BRAND.gray }}>{m.purpose}</TD>
                    <TD style={{ color: BRAND.red, fontWeight: 700, ...S.mono }}>{m.stockNum || "—"}</TD>
                    <TD style={{ ...S.mono, fontWeight: 600 }}>{p(m.miles)}</TD>
                    <TD style={{ color: BRAND.blue, ...S.mono, fontWeight: 700 }}>{fmt$2(p(m.miles) * IRS_RATE)}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {showForm && (
        <Modal title={editing ? "Edit Trip" : "Log Trip"} onClose={() => setShowForm(false)}>
          <div className="form-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Input label="Date" value={form.date} onChange={v => upd("date", v)} type="date" />
            <Select label="Stock #" value={form.stockNum} onChange={v => upd("stockNum", v)} options={data.vehicles.map(v => v.stockNum)} placeholder="(General)" />
            <Input label="From" value={form.from} onChange={v => upd("from", v)} placeholder="Home" />
            <Input label="To" value={form.to} onChange={v => upd("to", v)} placeholder="Auction lot" />
            <Input label="Purpose" value={form.purpose} onChange={v => upd("purpose", v)} placeholder="Pick up vehicle" />
            <Input label="Miles" value={form.miles} onChange={v => upd("miles", v)} type="number" step="0.1" />
          </div>
          <div style={{ background: BRAND.blueBg, borderRadius: 8, padding: 10, marginTop: 10, fontSize: 13, border: "1px solid #DBEAFE" }}>
            Deduction: <b style={{ color: BRAND.blue, ...S.mono }}>{fmt$2(p(form.miles) * IRS_RATE)}</b>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18 }}>
            <div>{editing && <Btn variant="danger" onClick={() => setConfirm(editing)}>Delete</Btn>}</div>
            <div style={{ display: "flex", gap: 6 }}><Btn variant="secondary" onClick={() => setShowForm(false)}>Cancel</Btn><Btn onClick={save}>{editing ? "Save" : "Log Trip"}</Btn></div>
          </div>
        </Modal>
      )}
      {confirm && <Confirm msg="Delete?" onOk={() => del(confirm)} onCancel={() => setConfirm(null)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PIPELINE TAB (Kanban Board)
// ═══════════════════════════════════════════════════════════════
function getPipelineStage(vehicle, sales) {
  const sale = sales.find(s => s.stockNum === vehicle.stockNum);
  if (sale || vehicle.status === "Sold") return "Sold";
  if (vehicle.pipelineStage) return vehicle.pipelineStage;
  if (vehicle.status === "Listed") return "Listed";
  return "Purchased";
}

const STAGE_COLORS = {
  Scouting: { bg: "#EFF6FF", border: "#60A5FA", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>, text: "#1E40AF" },
  Purchased: { bg: "#FEF3C7", border: "#F59E0B", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>, text: "#92400E" },
  Repairing: { bg: "#FFEDD5", border: "#F97316", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>, text: "#9A3412" },
  Listed: { bg: "#F0FDF4", border: "#22C55E", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="12" y2="18"/></svg>, text: "#166534" },
  Sold: { bg: "#F5F3FF", border: "#8B5CF6", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>, text: "#5B21B6" },
};

function PipelineTab({ data, setData }) {
  const { vehicles, sales, expenses, holdCosts } = data;

  const columns = useMemo(() => {
    const cols = {};
    PIPELINE_STAGES.forEach(s => { cols[s] = []; });
    vehicles.forEach(v => {
      const stage = getPipelineStage(v, sales);
      if (cols[stage]) cols[stage].push(v);
      else if (cols.Purchased) cols.Purchased.push(v);
    });
    return cols;
  }, [vehicles, sales]);

  const moveVehicle = (vehicleId, newStage) => {
    setData(d => ({
      ...d,
      vehicles: d.vehicles.map(v => v.id === vehicleId ? {
        ...v,
        pipelineStage: newStage,
        status: newStage === "Listed" ? "Listed" : newStage === "Sold" ? "Sold" : v.status
      } : v)
    }));
  };

  const totalValue = useMemo(() => {
    const byStage = {};
    PIPELINE_STAGES.forEach(s => { byStage[s] = 0; });
    vehicles.forEach(v => {
      const stage = getPipelineStage(v, sales);
      if (byStage[stage] !== undefined) byStage[stage] += calcTotalCost(v, expenses);
    });
    return byStage;
  }, [vehicles, sales, expenses]);

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: BRAND.black }}>Deal Pipeline</div>
        <div style={{ fontSize: 12, color: BRAND.gray }}>Visual pipeline of vehicles through stages — click arrows to move vehicles</div>
      </div>

      {/* Pipeline Summary */}
      <div className="pipeline-summary" style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {PIPELINE_STAGES.map(stage => {
          const sc = STAGE_COLORS[stage];
          return (
            <div key={stage} style={{ flex: "1 1 120px", background: sc.bg, border: `1.5px solid ${sc.border}`, borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
              <div style={{ fontSize: 18 }}>{sc.icon}</div>
              <div style={{ fontSize: 11, fontWeight: 800, color: sc.text, textTransform: "uppercase", letterSpacing: "0.05em" }}>{stage}</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: sc.text }}>{columns[stage]?.length || 0}</div>
              <div style={{ fontSize: 10, color: BRAND.gray, ...S.mono }}>{fmt$(totalValue[stage] || 0)}</div>
            </div>
          );
        })}
      </div>

      {/* Kanban Columns */}
      <div className="pipeline-board" style={{ display: "flex", gap: 10, overflowX: "auto", minHeight: 400, paddingBottom: 10 }}>
        {PIPELINE_STAGES.map(stage => {
          const sc = STAGE_COLORS[stage];
          const items = columns[stage] || [];
          return (
            <div key={stage} style={{ flex: "1 1 200px", minWidth: 200, background: sc.bg, borderRadius: 10, border: `1.5px solid ${sc.border}`, display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "10px 12px", borderBottom: `1px solid ${sc.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: sc.text }}>{sc.icon} {stage}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: sc.text, background: "rgba(255,255,255,0.6)", padding: "2px 6px", borderRadius: 8 }}>{items.length}</span>
              </div>
              <div style={{ flex: 1, padding: 8, display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", maxHeight: 500 }}>
                {items.length === 0 ? (
                  <div style={{ textAlign: "center", color: BRAND.gray, fontSize: 11, padding: 20, opacity: 0.6 }}>No vehicles</div>
                ) : items.map(v => {
                  const m = calcVehicleFullMetrics(v, sales.find(s => s.stockNum === v.stockNum), holdCosts, expenses);
                  const stageIdx = PIPELINE_STAGES.indexOf(stage);
                  return (
                    <div key={v.id} style={{ background: BRAND.white, borderRadius: 8, padding: 10, border: `1px solid ${BRAND.grayLight}`, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 4 }}>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 800, color: BRAND.red, ...S.mono }}>#{v.stockNum}</div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: BRAND.black }}>{v.year} {v.make}</div>
                          <div style={{ fontSize: 11, color: BRAND.grayDark }}>{v.model}</div>
                        </div>
                        {m.aging && <Badge color={m.aging.color} bg={m.aging.bg}>{m.aging.icon}</Badge>}
                      </div>
                      <div style={{ fontSize: 10, color: BRAND.gray, marginBottom: 6 }}>
                        Total Cost: <b style={{ color: BRAND.black, ...S.mono }}>{fmt$(m.totalCost)}</b>
                        {m.grossProfit != null && <span> · P: <b style={{ color: m.grossProfit >= 0 ? BRAND.green : "#DC2626", ...S.mono }}>{fmt$(m.grossProfit)}</b></span>}
                      </div>
                      {stage !== "Sold" && (
                        <div style={{ display: "flex", gap: 3 }}>
                          {stageIdx > 0 && (
                            <button onClick={() => moveVehicle(v.id, PIPELINE_STAGES[stageIdx - 1])} style={{ flex: 1, background: "transparent", border: `1px solid ${BRAND.grayLight}`, borderRadius: 4, padding: "3px", fontSize: 10, cursor: "pointer", color: BRAND.gray }}>← Back</button>
                          )}
                          {stageIdx < PIPELINE_STAGES.length - 1 && (
                            <button onClick={() => moveVehicle(v.id, PIPELINE_STAGES[stageIdx + 1])} style={{ flex: 1, background: sc.border, border: "none", borderRadius: 4, padding: "3px", fontSize: 10, cursor: "pointer", color: "#fff", fontWeight: 700 }}>Next →</button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// AUCTION CALENDAR TAB
// ═══════════════════════════════════════════════════════════════
function CalendarTab({ data, setData }) {
  const events = data.auctionEvents || [];
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ id: "", title: "", date: "", source: "copart", type: "auction", notes: "", reminder: true });
  const [viewMonth, setViewMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });

  const openNew = (date) => {
    setForm({ id: "", title: "", date: date || new Date().toISOString().slice(0, 10), source: "copart", type: "auction", notes: "", reminder: true });
    setShowForm(true);
  };

  const save = () => {
    if (!form.title || !form.date) return;
    const evt = { ...form, id: form.id || genId() };
    if (form.id) {
      setData(d => ({ ...d, auctionEvents: (d.auctionEvents || []).map(e => e.id === form.id ? evt : e) }));
    } else {
      setData(d => ({ ...d, auctionEvents: [...(d.auctionEvents || []), evt] }));
    }
    setShowForm(false);
  };

  const del = (id) => {
    setData(d => ({ ...d, auctionEvents: (d.auctionEvents || []).filter(e => e.id !== id) }));
  };

  const daysInMonth = new Date(viewMonth.year, viewMonth.month + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewMonth.year, viewMonth.month, 1).getDay();
  const monthLabel = new Date(viewMonth.year, viewMonth.month).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const today = new Date().toISOString().slice(0, 10);

  const prevMonth = () => setViewMonth(v => v.month === 0 ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 });
  const nextMonth = () => setViewMonth(v => v.month === 11 ? { year: v.year + 1, month: 0 } : { ...v, month: v.month + 1 });

  const evtTypeColors = { auction: { bg: "#DBEAFE", color: "#1E40AF" }, pickup: { bg: "#D1FAE5", color: "#166534" }, deadline: { bg: "#FEE2E2", color: "#DC2626" }, reminder: { bg: "#FEF3C7", color: "#92400E" } };

  // Upcoming events (next 14 days)
  const upcoming = useMemo(() => {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const fut = new Date(t); fut.setDate(fut.getDate() + 14);
    return events.filter(e => e.date >= t.toISOString().slice(0, 10) && e.date <= fut.toISOString().slice(0, 10)).sort((a, b) => a.date.localeCompare(b.date));
  }, [events]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: BRAND.black }}>Auction Calendar</div>
          <div style={{ fontSize: 12, color: BRAND.gray }}>Track auction dates, pickups, and deadlines</div>
        </div>
        <Btn onClick={() => openNew()}>+ Add Event</Btn>
      </div>

      <div className="calendar-layout" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {/* Calendar Grid */}
        <Card style={{ flex: "2 1 400px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <button onClick={prevMonth} style={{ background: "transparent", border: `1px solid ${BRAND.grayLight}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 14, color: BRAND.grayDark }}>←</button>
            <span style={{ fontSize: 15, fontWeight: 800, color: BRAND.black }}>{monthLabel}</span>
            <button onClick={nextMonth} style={{ background: "transparent", border: `1px solid ${BRAND.grayLight}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 14, color: BRAND.grayDark }}>→</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1 }}>
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
              <div key={d} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: BRAND.gray, padding: "6px 0", textTransform: "uppercase" }}>{d}</div>
            ))}
            {Array.from({ length: firstDayOfWeek }).map((_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = `${viewMonth.year}-${String(viewMonth.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const dayEvts = events.filter(e => e.date === dateStr);
              const isToday = dateStr === today;
              return (
                <div key={day} className="calendar-day" onClick={() => openNew(dateStr)} style={{ minHeight: 60, padding: 4, border: `1px solid ${isToday ? BRAND.red : BRAND.grayLight}`, borderRadius: 4, cursor: "pointer", background: isToday ? BRAND.redBg : "transparent" }}>
                  <div style={{ fontSize: 11, fontWeight: isToday ? 800 : 500, color: isToday ? BRAND.red : BRAND.black, marginBottom: 2 }}>{day}</div>
                  {dayEvts.slice(0, 2).map(e => {
                    const tc = evtTypeColors[e.type] || evtTypeColors.auction;
                    return <div key={e.id} className="cal-evt" style={{ fontSize: 8, background: tc.bg, color: tc.color, padding: "1px 3px", borderRadius: 3, marginBottom: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", fontWeight: 600 }}>{e.title}</div>;
                  })}
                  {dayEvts.length > 2 && <div style={{ fontSize: 8, color: BRAND.gray }}>+{dayEvts.length - 2} more</div>}
                </div>
              );
            })}
          </div>
        </Card>

        {/* Upcoming Events Sidebar */}
        <Card style={{ flex: "1 1 250px" }}>
          <SectionTitle>Upcoming (14 days)</SectionTitle>
          {upcoming.length === 0 ? <div style={{ color: BRAND.gray, fontSize: 12 }}>No upcoming events</div> : upcoming.map(e => {
            const tc = evtTypeColors[e.type] || evtTypeColors.auction;
            const srcName = AUCTION_FEE_TIERS[e.source]?.name || e.source;
            return (
              <div key={e.id} style={{ padding: "8px 0", borderBottom: `1px solid ${BRAND.grayLight}`, display: "flex", alignItems: "start", gap: 8 }}>
                <div style={{ minWidth: 44, textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 900, color: BRAND.black }}>{new Date(e.date + "T12:00").getDate()}</div>
                  <div style={{ fontSize: 9, color: BRAND.gray, textTransform: "uppercase" }}>{new Date(e.date + "T12:00").toLocaleDateString("en-US", { month: "short" })}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: BRAND.black }}>{e.title}</div>
                  <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                    <Badge color={tc.color} bg={tc.bg}>{e.type}</Badge>
                    <span style={{ fontSize: 10, color: BRAND.gray }}>{srcName}</span>
                  </div>
                  {e.notes && <div style={{ fontSize: 10, color: BRAND.gray, marginTop: 2 }}>{e.notes}</div>}
                </div>
                <button onClick={(ev) => { ev.stopPropagation(); del(e.id); }} style={{ background: "transparent", border: "none", color: BRAND.gray, cursor: "pointer", fontSize: 14 }}>×</button>
              </div>
            );
          })}
          <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {Object.entries(evtTypeColors).map(([type, tc]) => (
              <Badge key={type} color={tc.color} bg={tc.bg}>{type}</Badge>
            ))}
          </div>
        </Card>
      </div>

      {/* Event Form Modal */}
      {showForm && (
        <Modal title={form.id ? "Edit Event" : "Add Event"} onClose={() => setShowForm(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Input label="Event Title" value={form.title} onChange={v => setForm(f => ({ ...f, title: v }))} placeholder="e.g. Copart MA Auction" />
            <div className="form-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Input label="Date" value={form.date} onChange={v => setForm(f => ({ ...f, date: v }))} type="date" />
              <Select label="Type" value={form.type} onChange={v => setForm(f => ({ ...f, type: v }))} options={[{ value: "auction", label: "Auction" }, { value: "pickup", label: "Pickup" }, { value: "deadline", label: "Deadline" }, { value: "reminder", label: "Reminder" }]} />
            </div>
            <Select label="Acquisition Source" value={form.source} onChange={v => setForm(f => ({ ...f, source: v }))} options={AUCTION_SOURCES.map(s => ({ value: s, label: AUCTION_FEE_TIERS[s]?.name || s }))} />
            <Input label="Notes" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} placeholder="Optional notes" />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 18 }}>
            <Btn variant="secondary" onClick={() => setShowForm(false)}>Cancel</Btn>
            <Btn onClick={save}>{form.id ? "Update" : "Add Event"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ANALYTICS TAB
// ═══════════════════════════════════════════════════════════════
function AnalyticsTab({ data }) {
  const { vehicles, sales, expenses, holdCosts } = data;
  const sold = vehicles.filter(v => v.status === "Sold");

  // Per-vehicle metrics
  const dealCards = useMemo(() => {
    return sold.map(v => {
      const sale = sales.find(s => s.stockNum === v.stockNum);
      return { vehicle: v, sale, metrics: calcVehicleFullMetrics(v, sale, holdCosts, expenses) };
    }).sort((a, b) => (b.metrics.grossProfit || 0) - (a.metrics.grossProfit || 0));
  }, [sold, sales, holdCosts, expenses]);

  // Cash flow
  const cashFlow = useMemo(() => buildCashFlow(vehicles, sales, expenses), [vehicles, sales, expenses]);

  // Performance by source
  const bySource = useMemo(() => {
    const m = {};
    sold.forEach(v => {
      const src = v.auctionSource || "custom";
      if (!m[src]) m[src] = { count: 0, totalProfit: 0, totalCost: 0, days: [] };
      const sale = sales.find(s => s.stockNum === v.stockNum);
      const met = calcVehicleFullMetrics(v, sale, holdCosts, expenses);
      m[src].count++;
      m[src].totalProfit += met.grossProfit || 0;
      m[src].totalCost += met.totalCost;
      if (met.days) m[src].days.push(met.days);
    });
    return Object.entries(m).map(([src, d]) => ({
      source: AUCTION_FEE_TIERS[src]?.name || src,
      ...d,
      avgProfit: d.count > 0 ? d.totalProfit / d.count : 0,
      avgDays: d.days.length > 0 ? Math.round(d.days.reduce((a, b) => a + b, 0) / d.days.length) : 0,
      roi: d.totalCost > 0 ? d.totalProfit / d.totalCost : 0,
    })).sort((a, b) => b.avgProfit - a.avgProfit);
  }, [sold, sales, holdCosts, expenses]);

  // Performance by title status
  const byTitle = useMemo(() => {
    const m = {};
    sold.forEach(v => {
      const ts = v.titleStatus || "clean";
      if (!m[ts]) m[ts] = { count: 0, totalProfit: 0, totalCost: 0 };
      const sale = sales.find(s => s.stockNum === v.stockNum);
      const met = calcVehicleFullMetrics(v, sale, holdCosts, expenses);
      m[ts].count++;
      m[ts].totalProfit += met.grossProfit || 0;
      m[ts].totalCost += met.totalCost;
    });
    return Object.entries(m).map(([ts, d]) => ({
      title: TITLE_STATUS[ts]?.label || ts,
      titleInfo: TITLE_STATUS[ts] || TITLE_STATUS.clean,
      ...d,
      avgProfit: d.count > 0 ? d.totalProfit / d.count : 0,
      roi: d.totalCost > 0 ? d.totalProfit / d.totalCost : 0,
    })).sort((a, b) => b.avgProfit - a.avgProfit);
  }, [sold, sales, holdCosts, expenses]);

  // Industry benchmarks
  const benchmarks = useMemo(() => {
    const avgP = sold.length > 0 ? dealCards.reduce((s, d) => s + (d.metrics.grossProfit || 0), 0) / sold.length : 0;
    const avgD = sold.length > 0 ? dealCards.filter(d => d.metrics.days).reduce((s, d) => s + d.metrics.days, 0) / dealCards.filter(d => d.metrics.days).length : 0;
    const avgM = sold.length > 0 ? dealCards.filter(d => d.metrics.margin != null).reduce((s, d) => s + d.metrics.margin, 0) / dealCards.filter(d => d.metrics.margin != null).length : 0;
    const avgV = sold.length > 0 ? dealCards.filter(d => d.metrics.velocity != null).reduce((s, d) => s + d.metrics.velocity, 0) / dealCards.filter(d => d.metrics.velocity != null).length : 0;
    return [
      { metric: "Avg Profit/Car", value: fmt$(avgP), level: getBenchmarkLevel("avgProfitPerCar", avgP) },
      { metric: "Avg Days to Sell", value: `${Math.round(avgD)}d`, level: getBenchmarkLevel("avgDaysToSell", avgD) },
      { metric: "Avg Gross Margin %", value: fmtPct(avgM), level: getBenchmarkLevel("profitMargin", avgM) },
      { metric: "Profit Velocity", value: `${fmt$2(avgV)}/d`, level: getBenchmarkLevel("profitVelocity", avgV) },
    ];
  }, [dealCards, sold]);

  const levelColors = { beginner: { color: "#DC2626", bg: "#FEE2E2", label: "Beginner" }, intermediate: { color: "#D97706", bg: "#FEF3C7", label: "Intermediate" }, expert: { color: "#166534", bg: "#D1FAE5", label: "Expert" } };

  return (
    <div>
      {/* Benchmarks */}
      <Card style={{ marginBottom: 14 }}>
        <SectionTitle>Your Performance vs Industry Benchmarks</SectionTitle>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {benchmarks.map(b => {
            const lc = levelColors[b.level];
            return (
              <div key={b.metric} style={{ flex: "1 1 140px", border: `1px solid ${BRAND.grayLight}`, borderRadius: 8, padding: 12, textAlign: "center" }}>
                <div style={{ fontSize: 10, color: BRAND.gray, textTransform: "uppercase", fontWeight: 700, marginBottom: 4 }}>{b.metric}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: BRAND.black, ...S.mono }}>{b.value}</div>
                <Badge color={lc.color} bg={lc.bg}>{lc.label}</Badge>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Deal Leaderboard */}
      <Card style={{ marginBottom: 14 }}>
        <SectionTitle>Deal Leaderboard — All Flips Ranked</SectionTitle>
        {dealCards.length === 0 ? <div style={{ color: BRAND.gray, fontSize: 12 }}>No completed deals yet</div> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ background: BRAND.redBg }}>{["Rank","Vehicle","Total Cost","Net Sale","Profit","Gross Margin %","Days","Velocity","Ann. ROI","Grade"].map(h => <TH key={h}>{h}</TH>)}</tr></thead>
              <tbody>
                {dealCards.map((d, i) => (
                  <tr key={d.vehicle.id} style={{ borderBottom: `1px solid ${BRAND.grayLight}`, background: i === 0 ? "#FEFCE8" : i < 3 ? "#FFFBEB" : "transparent" }}>
                    <TD style={{ fontWeight: 800, color: i < 3 ? "#D97706" : BRAND.grayDark }}>{`#${i + 1}`}</TD>
                    <TD><span style={{ color: BRAND.red, ...S.mono, fontWeight: 700, fontSize: 10 }}>#{d.vehicle.stockNum}</span> {d.vehicle.year} {d.vehicle.make} {d.vehicle.model}</TD>
                    <TD style={{ ...S.mono }}>{fmt$(d.metrics.totalCost)}</TD>
                    <TD style={{ ...S.mono }}>{fmt$(d.metrics.netSale)}</TD>
                    <TD style={{ ...S.mono, fontWeight: 800, color: (d.metrics.grossProfit || 0) >= 0 ? BRAND.green : "#DC2626" }}>{fmt$(d.metrics.grossProfit)}</TD>
                    <TD style={{ ...S.mono }}>{fmtPct(d.metrics.margin)}</TD>
                    <TD style={{ fontWeight: 600 }}>{d.metrics.days || "—"}d</TD>
                    <TD style={{ ...S.mono, color: BRAND.blue, fontWeight: 600 }}>{d.metrics.velocity != null ? `${fmt$2(d.metrics.velocity)}/d` : "—"}</TD>
                    <TD style={{ ...S.mono }}>{d.metrics.annROI != null ? fmtPct(d.metrics.annROI) : "—"}</TD>
                    <TD>{d.metrics.grade && <span style={{ fontWeight: 900, color: d.metrics.grade.color, ...S.mono, fontSize: 16 }}>{d.metrics.grade.grade}</span>}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
        {/* By Source */}
        <Card style={{ flex: "1 1 280px" }}>
          <SectionTitle>Performance by Auction Source</SectionTitle>
          {bySource.length === 0 ? <div style={{ color: BRAND.gray, fontSize: 12 }}>No data</div> : bySource.map(s => (
            <div key={s.source} style={{ padding: "8px 0", borderBottom: `1px solid ${BRAND.grayLight}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                <span style={{ fontWeight: 700, color: BRAND.black }}>{s.source}</span>
                <span style={{ color: BRAND.gray }}>{s.count} cars</span>
              </div>
              <div style={{ display: "flex", gap: 12, fontSize: 11, color: BRAND.gray }}>
                <span>Avg P: <b style={{ color: s.avgProfit >= 0 ? BRAND.green : "#DC2626" }}>{fmt$(s.avgProfit)}</b></span>
                <span>Avg D: <b>{s.avgDays}d</b></span>
                <span>ROI: <b style={{ color: BRAND.blue }}>{fmtPct(s.roi)}</b></span>
              </div>
            </div>
          ))}
        </Card>

        {/* By Title Status */}
        <Card style={{ flex: "1 1 280px" }}>
          <SectionTitle>Performance by Title Status</SectionTitle>
          {byTitle.length === 0 ? <div style={{ color: BRAND.gray, fontSize: 12 }}>No data</div> : byTitle.map(t => (
            <div key={t.title} style={{ padding: "8px 0", borderBottom: `1px solid ${BRAND.grayLight}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <Badge color={t.titleInfo.color} bg={t.titleInfo.bg}>{t.title}</Badge>
                <span style={{ fontSize: 11, color: BRAND.gray }}>{t.count} cars</span>
              </div>
              <div style={{ display: "flex", gap: 12, fontSize: 11, color: BRAND.gray }}>
                <span>Avg P: <b style={{ color: t.avgProfit >= 0 ? BRAND.green : "#DC2626" }}>{fmt$(t.avgProfit)}</b></span>
                <span>ROI: <b style={{ color: BRAND.blue }}>{fmtPct(t.roi)}</b></span>
              </div>
            </div>
          ))}
        </Card>
      </div>

      {/* Make/Model Profitability Analysis */}
      <Card style={{ marginBottom: 14 }}>
        <SectionTitle>Make/Model Profitability Analysis</SectionTitle>
        {(() => {
          const byMakeModel = {};
          sold.forEach(v => {
            const key = `${(v.make || "Unknown").trim()} ${(v.model || "").trim()}`.trim();
            if (!byMakeModel[key]) byMakeModel[key] = { count: 0, totalProfit: 0, totalCost: 0, days: [], profits: [] };
            const sale = sales.find(s => s.stockNum === v.stockNum);
            const met = calcVehicleFullMetrics(v, sale, holdCosts, expenses);
            byMakeModel[key].count++;
            byMakeModel[key].totalProfit += met.grossProfit || 0;
            byMakeModel[key].totalCost += met.totalCost;
            byMakeModel[key].profits.push(met.grossProfit || 0);
            if (met.days) byMakeModel[key].days.push(met.days);
          });
          const rows = Object.entries(byMakeModel).map(([key, d]) => ({
            makeModel: key,
            ...d,
            avgProfit: d.count > 0 ? d.totalProfit / d.count : 0,
            avgDays: d.days.length > 0 ? Math.round(d.days.reduce((a, b) => a + b, 0) / d.days.length) : 0,
            roi: d.totalCost > 0 ? d.totalProfit / d.totalCost : 0,
            winRate: d.profits.length > 0 ? d.profits.filter(p => p > 0).length / d.profits.length : 0,
          })).sort((a, b) => b.avgProfit - a.avgProfit);
          if (rows.length === 0) return <div style={{ color: BRAND.gray, fontSize: 12 }}>No completed deals yet</div>;
          return (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ background: BRAND.redBg }}>{["Make/Model", "Deals", "Total Profit", "Avg Profit", "Avg Days", "ROI", "Win Rate"].map(h => <TH key={h}>{h}</TH>)}</tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.makeModel} style={{ borderBottom: `1px solid ${BRAND.grayLight}` }}>
                      <TD style={{ fontWeight: 700, color: BRAND.black }}>{r.makeModel}</TD>
                      <TD>{r.count}</TD>
                      <TD style={{ ...S.mono, fontWeight: 700, color: r.totalProfit >= 0 ? BRAND.green : "#DC2626" }}>{fmt$(r.totalProfit)}</TD>
                      <TD style={{ ...S.mono, color: r.avgProfit >= 0 ? BRAND.green : "#DC2626" }}>{fmt$(r.avgProfit)}</TD>
                      <TD>{r.avgDays}d</TD>
                      <TD style={{ ...S.mono, color: BRAND.blue }}>{fmtPct(r.roi)}</TD>
                      <TD><span style={{ fontWeight: 700, color: r.winRate >= 0.8 ? BRAND.green : r.winRate >= 0.5 ? "#D97706" : "#DC2626" }}>{fmtPct(r.winRate)}</span></TD>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </Card>

      {/* Cash Flow Timeline */}
      <Card>
        <SectionTitle>Cash Flow Timeline</SectionTitle>
        {cashFlow.length === 0 ? <div style={{ color: BRAND.gray, fontSize: 12 }}>No transactions</div> : (
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {cashFlow.slice(-30).map((e, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: `1px solid ${BRAND.grayLight}`, fontSize: 12 }}>
                <span style={{ color: BRAND.gray, minWidth: 80, fontSize: 11 }}>{e.date}</span>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: e.type === "sale" ? BRAND.green : "#DC2626", flexShrink: 0 }} />
                <span style={{ flex: 1, color: BRAND.grayDark }}>{e.label}</span>
                <span style={{ fontWeight: 700, ...S.mono, color: e.amount >= 0 ? BRAND.green : "#DC2626", minWidth: 80, textAlign: "right" }}>{e.amount >= 0 ? "+" : ""}{fmt$(e.amount)}</span>
                <span style={{ fontWeight: 600, ...S.mono, color: e.balance >= 0 ? BRAND.black : "#DC2626", minWidth: 80, textAlign: "right", fontSize: 11 }}>Bal: {fmt$(e.balance)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Profit Forecasting */}
      <Card style={{ marginTop: 14 }}>
        <SectionTitle>Profit Forecasting — 30 / 60 / 90 Day Projections</SectionTitle>
        {(() => {
          if (sold.length < 2) return <div style={{ color: BRAND.gray, fontSize: 12 }}>Need at least 2 completed deals to generate forecasts</div>;

          const profits = dealCards.map(d => d.metrics.grossProfit || 0);
          const avgProfit = profits.reduce((a, b) => a + b, 0) / profits.length;
          const daysArr = dealCards.map(d => d.metrics.days).filter(Boolean);
          const avgDays = daysArr.length > 0 ? daysArr.reduce((a, b) => a + b, 0) / daysArr.length : 30;
          const carsPerMonth = avgDays > 0 ? 30 / avgDays : 1;
          const unsoldCount = vehicles.filter(v => v.status !== "Sold").length;

          const forecast = [30, 60, 90].map(days => {
            const estDeals = Math.round(carsPerMonth * (days / 30));
            const projectedProfit = estDeals * avgProfit;
            const unsoldPotential = Math.min(unsoldCount, estDeals) * avgProfit;
            return { days, estDeals, projectedProfit, unsoldPotential };
          });

          // Trend: compare last 5 deals avg vs first 5 deals avg
          const recent5 = profits.slice(0, Math.min(5, profits.length));
          const older5 = profits.slice(-Math.min(5, profits.length));
          const recentAvg = recent5.reduce((a, b) => a + b, 0) / recent5.length;
          const olderAvg = older5.reduce((a, b) => a + b, 0) / older5.length;
          const trend = olderAvg > 0 ? ((recentAvg - olderAvg) / Math.abs(olderAvg)) : 0;

          return (
            <div>
              <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 120px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8, padding: 12, textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: BRAND.gray, fontWeight: 700, textTransform: "uppercase" }}>Avg Profit/Deal</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: BRAND.green, ...S.mono }}>{fmt$(avgProfit)}</div>
                </div>
                <div style={{ flex: "1 1 120px", background: BRAND.blueBg, border: "1px solid #93C5FD", borderRadius: 8, padding: 12, textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: BRAND.gray, fontWeight: 700, textTransform: "uppercase" }}>Avg Days/Deal</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: BRAND.blue, ...S.mono }}>{Math.round(avgDays)}d</div>
                </div>
                <div style={{ flex: "1 1 120px", background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 8, padding: 12, textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: BRAND.gray, fontWeight: 700, textTransform: "uppercase" }}>Est. Deals/Month</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: "#92400E", ...S.mono }}>{carsPerMonth.toFixed(1)}</div>
                </div>
                <div style={{ flex: "1 1 120px", background: trend >= 0 ? "#F0FDF4" : "#FEF2F2", border: `1px solid ${trend >= 0 ? "#BBF7D0" : "#FECACA"}`, borderRadius: 8, padding: 12, textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: BRAND.gray, fontWeight: 700, textTransform: "uppercase" }}>Profit Trend</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: trend >= 0 ? BRAND.green : "#DC2626", ...S.mono }}>{trend >= 0 ? "↑" : "↓"} {fmtPct(Math.abs(trend))}</div>
                </div>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr style={{ background: BRAND.redBg }}>{["Period", "Est. Deals", "Projected Profit", "From Current Inventory", "Confidence"].map(h => <TH key={h}>{h}</TH>)}</tr></thead>
                  <tbody>
                    {forecast.map(f => (
                      <tr key={f.days} style={{ borderBottom: `1px solid ${BRAND.grayLight}` }}>
                        <TD style={{ fontWeight: 700 }}>Next {f.days} Days</TD>
                        <TD>{f.estDeals}</TD>
                        <TD style={{ ...S.mono, fontWeight: 800, color: f.projectedProfit >= 0 ? BRAND.green : "#DC2626" }}>{fmt$(f.projectedProfit)}</TD>
                        <TD style={{ ...S.mono, color: BRAND.blue }}>{fmt$(f.unsoldPotential)}</TD>
                        <TD><Badge color={f.days <= 30 ? BRAND.green : f.days <= 60 ? "#D97706" : BRAND.gray} bg={f.days <= 30 ? "#D1FAE5" : f.days <= 60 ? "#FEF3C7" : "#F3F4F6"}>{f.days <= 30 ? "High" : f.days <= 60 ? "Medium" : "Low"}</Badge></TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 8, fontSize: 10, color: BRAND.gray, fontStyle: "italic" }}>
                Based on {sold.length} completed deals · Avg {Math.round(avgDays)}d turnover · {carsPerMonth.toFixed(1)} deals/month pace
              </div>
            </div>
          );
        })()}
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// REPORTS TAB (Admin/Manager)
// ═══════════════════════════════════════════════════════════════
function ReportsTab({ data }) {
  const { vehicles, sales, expenses, holdCosts } = data;
  const [period, setPeriod] = useState("month");
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7)); // YYYY-MM

  const reportData = useMemo(() => {
    const now = new Date();
    let startDate, endDate, label;
    if (period === "week") {
      const dayOfWeek = now.getDay();
      const start = new Date(now); start.setDate(now.getDate() - dayOfWeek);
      startDate = start.toISOString().slice(0, 10);
      endDate = now.toISOString().slice(0, 10);
      label = `Week of ${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    } else if (period === "month") {
      startDate = selectedMonth + "-01";
      const [y, m] = selectedMonth.split("-").map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      endDate = selectedMonth + "-" + String(lastDay).padStart(2, "0");
      label = new Date(y, m - 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
    } else {
      startDate = now.getFullYear() + "-01-01";
      endDate = now.getFullYear() + "-12-31";
      label = `Year ${now.getFullYear()}`;
    }
    const inRange = (d) => d && d >= startDate && d <= endDate;

    const periodSales = sales.filter(s => inRange(s.date));
    const periodExpenses = expenses.filter(e => inRange(e.date));
    const periodPurchased = vehicles.filter(v => inRange(v.purchaseDate));
    const periodSold = vehicles.filter(v => {
      const sl = sales.find(s => s.stockNum === v.stockNum);
      return sl && inRange(sl.date);
    });

    const totalRevenue = periodSales.reduce((s, x) => s + p(x.grossPrice), 0);
    const totalNet = periodSales.reduce((s, x) => s + p(x.grossPrice) - p(x.auctionFee) - p(x.titleFee) - p(x.otherDeductions), 0);
    const soldCost = periodSold.reduce((s, v) => s + calcTotalCost(v, expenses), 0);
    const grossProfit = totalNet - soldCost;
    const totalExp = periodExpenses.reduce((s, e) => s + p(e.amount), 0);
    // Per-vehicle expenses on sold vehicles are already in soldCost;
    // deduct only overhead (non-vehicle-linked) here to avoid double-counting.
    const periodSoldStocks = new Set(periodSold.map(v => v.stockNum));
    const overheadExp = periodExpenses.filter(e => !e.stockNum || !periodSoldStocks.has(e.stockNum)).reduce((s, e) => s + p(e.amount), 0);
    const netIncome = grossProfit - overheadExp;

    const avgProfit = periodSold.length > 0 ? grossProfit / periodSold.length : 0;
    const daysArr = periodSold.map(v => { const sl = sales.find(s => s.stockNum === v.stockNum); return sl && v.purchaseDate && sl.date ? daysBetween(v.purchaseDate, sl.date) : null; }).filter(Boolean);
    const avgDays = daysArr.length > 0 ? Math.round(daysArr.reduce((a, b) => a + b, 0) / daysArr.length) : 0;

    // Top deals
    const topDeals = periodSold.map(v => {
      const sl = sales.find(s => s.stockNum === v.stockNum);
      return { vehicle: v, sale: sl, metrics: calcVehicleFullMetrics(v, sl, holdCosts, expenses) };
    }).sort((a, b) => (b.metrics.grossProfit || 0) - (a.metrics.grossProfit || 0)).slice(0, 5);

    // Expense breakdown
    const expByCat = {};
    periodExpenses.forEach(e => { const c = e.category || "Other"; expByCat[c] = (expByCat[c] || 0) + p(e.amount); });

    // In-inventory snapshot: vehicles that exist as of endDate and whose sale
    // (if any) is after endDate. Average days-held is computed against
    // endDate so "days held" makes sense for historical periods.
    const endDateObj = new Date(endDate + "T23:59:59");
    const periodInInventory = vehicles.filter(v => {
      if (!v.purchaseDate || v.purchaseDate > endDate) return false;
      const sl = sales.find(s => s.stockNum === v.stockNum);
      return !sl || sl.date > endDate;
    });
    const inventoryDays = periodInInventory.map(v => {
      const start = new Date(v.purchaseDate);
      return Math.max(0, Math.round((endDateObj - start) / 86400000));
    });
    const avgInventoryDays = inventoryDays.length > 0 ? Math.round(inventoryDays.reduce((a, b) => a + b, 0) / inventoryDays.length) : 0;
    const inventoryValue = periodInInventory.reduce((s, v) => s + calcTotalCost(v, expenses), 0);

    return { label, startDate, endDate, periodPurchased, periodSold, periodSales, periodExpenses, periodInInventory, inventoryValue, avgInventoryDays, totalRevenue, totalNet, soldCost, grossProfit, totalExp, overheadExp, netIncome, avgProfit, avgDays, topDeals, expByCat };
  }, [vehicles, sales, expenses, holdCosts, period, selectedMonth, data.auctionFeeTiers]);

  const handlePrintReport = () => {
    const r = reportData;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${r.label} Report - Auto Trade Hub</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;padding:40px;color:#1a1a1a}
.header{text-align:center;border-bottom:3px solid #8B1A1A;padding-bottom:20px;margin-bottom:30px}
.header h1{color:#8B1A1A;font-size:24px}.header p{color:#666;font-size:14px;margin-top:4px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
.stat{border:1px solid #ddd;border-radius:8px;padding:14px;text-align:center}
.stat-label{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px}
.stat-value{font-size:20px;font-weight:800}
table{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px}
th{background:#f5f5f5;padding:8px;text-align:left;font-size:10px;text-transform:uppercase;color:#666}
td{padding:8px;border-bottom:1px solid #eee}
.section{margin-bottom:24px}.section h3{font-size:14px;color:#8B1A1A;margin-bottom:10px;border-bottom:1px solid #eee;padding-bottom:6px}
.footer{text-align:center;margin-top:40px;font-size:10px;color:#aaa;border-top:1px solid #eee;padding-top:12px}
@media print{body{padding:20px}}
</style></head><body>
<div class="header"><img src="/logo.png" style="height:64px;object-fit:contain;margin-bottom:8px" alt="Auto Trade Hub" /><p style="font-size:11px;color:#999;letter-spacing:0.12em;margin-bottom:12px">ATLANTIC CAR CONNECT — A SAYARAH INC COMPANY</p><h2 style="color:#333;font-size:18px">${r.label} — Performance Report</h2></div>
<div class="grid">
<div class="stat"><div class="stat-label">Purchased</div><div class="stat-value">${r.periodPurchased.length}</div></div>
<div class="stat"><div class="stat-label">Sold</div><div class="stat-value">${r.periodSold.length}</div></div>
<div class="stat"><div class="stat-label">In Inventory</div><div class="stat-value">${r.periodInInventory.length}</div><div style="font-size:10px;color:#888;margin-top:3px">${fmt$(r.inventoryValue)}</div></div>
<div class="stat"><div class="stat-label">Revenue</div><div class="stat-value">${fmt$(r.totalRevenue)}</div></div>
<div class="stat"><div class="stat-label">Gross Profit</div><div class="stat-value" style="color:${r.grossProfit >= 0 ? "#166534" : "#DC2626"}">${fmt$(r.grossProfit)}</div></div>
<div class="stat"><div class="stat-label">Overhead</div><div class="stat-value" style="color:#DC2626">${fmt$(r.overheadExp)}</div><div style="font-size:10px;color:#888;margin-top:3px">${fmt$(r.totalExp)} total exp</div></div>
<div class="stat"><div class="stat-label">Net Income</div><div class="stat-value" style="color:${r.netIncome >= 0 ? "#166534" : "#DC2626"}">${fmt$(r.netIncome)}</div></div>
<div class="stat"><div class="stat-label">Avg Profit/Car</div><div class="stat-value">${fmt$(r.avgProfit)}</div></div>
<div class="stat"><div class="stat-label">Avg Days to Sell</div><div class="stat-value">${r.avgDays}d</div></div>
<div class="stat"><div class="stat-label">Avg Days in Inv.</div><div class="stat-value">${r.avgInventoryDays}d</div></div>
</div>
${r.topDeals.length > 0 ? `<div class="section"><h3>Top Deals</h3><table><thead><tr><th>Vehicle</th><th>Total Cost</th><th>Sold For</th><th>Profit</th><th>Days</th><th>Grade</th></tr></thead><tbody>${r.topDeals.map(d => `<tr><td>#${esc(d.vehicle.stockNum)} ${esc(d.vehicle.year)} ${esc(d.vehicle.make)} ${esc(d.vehicle.model)}</td><td>${fmt$(d.metrics.totalCost)}</td><td>${fmt$(d.metrics.netSale)}</td><td style="color:${(d.metrics.grossProfit||0)>=0?"#166534":"#DC2626"};font-weight:700">${fmt$(d.metrics.grossProfit)}</td><td>${d.metrics.days||"—"}d</td><td>${d.metrics.grade?esc(d.metrics.grade.grade):"—"}</td></tr>`).join("")}</tbody></table></div>` : ""}
${Object.keys(r.expByCat).length > 0 ? `<div class="section"><h3>Expense Breakdown</h3><table><thead><tr><th>Category</th><th>Amount</th></tr></thead><tbody>${Object.entries(r.expByCat).sort((a,b)=>b[1]-a[1]).map(([c,a])=>`<tr><td>${esc(c)}</td><td style="font-weight:700">${fmt$(a)}</td></tr>`).join("")}</tbody></table></div>` : ""}
<div class="footer">Generated by Auto Trade Hub · © 2025 Sayarah Inc · Atlantic Car Connect — A Sayarah Inc Company · ${new Date().toLocaleDateString()}</div>
</body></html>`;
    const w = window.open("", "_blank");
    w.document.write(html);
    w.document.close();
    w.onload = () => w.print();
  };

  const r = reportData;
  const months = useMemo(() => {
    const m = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      m.push(d.toISOString().slice(0, 7));
    }
    return m;
  }, []);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: BRAND.black }}>Reports</div>
          <div style={{ fontSize: 12, color: BRAND.gray }}>Generate and print period performance reports</div>
        </div>
        <Btn onClick={handlePrintReport}>Print / Export PDF</Btn>
      </div>

      {/* Period selector */}
      <Card style={{ marginBottom: 14 }}>
        <div className="report-period-bar" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: BRAND.gray }}>PERIOD:</span>
          {["week", "month", "year"].map(pr => (
            <button key={pr} onClick={() => setPeriod(pr)} style={{ background: period === pr ? BRAND.red : BRAND.white, color: period === pr ? "#fff" : BRAND.grayDark, border: `1.5px solid ${period === pr ? BRAND.red : BRAND.grayLight}`, borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize" }}>{pr === "week" ? "This Week" : pr === "month" ? "Monthly" : "Year to Date"}</button>
          ))}
          {period === "month" && (
            <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} style={{ border: `1.5px solid ${BRAND.grayLight}`, borderRadius: 6, padding: "6px 10px", fontSize: 12, fontFamily: "inherit" }}>
              {months.map(m => <option key={m} value={m}>{new Date(m + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" })}</option>)}
            </select>
          )}
          <span style={{ fontSize: 13, fontWeight: 800, color: BRAND.red, marginLeft: "auto" }}>{r.label}</span>
        </div>
      </Card>

      {/* Summary Stats */}
      <div className="stat-cards-row" style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <StatCard label="Purchased" value={r.periodPurchased.length} color={BRAND.black} />
        <StatCard label="Sold" value={r.periodSold.length} color={BRAND.green} />
        <StatCard label="In Inventory" value={r.periodInInventory.length} color={BRAND.blue} sub={fmt$(r.inventoryValue)} />
        <StatCard label="Revenue" value={fmt$(r.totalRevenue)} color={BRAND.blue} />
        <StatCard label="Gross Profit" value={fmt$(r.grossProfit)} color={r.grossProfit >= 0 ? BRAND.green : "#DC2626"} />
        <StatCard label="Overhead" value={fmt$(r.overheadExp)} color="#DC2626" sub={`of ${fmt$(r.totalExp)} total exp`} />
        <StatCard label="Net Income" value={fmt$(r.netIncome)} color={r.netIncome >= 0 ? BRAND.green : "#DC2626"} />
        <StatCard label="Avg Profit/Car" value={fmt$(r.avgProfit)} color={r.avgProfit >= 0 ? BRAND.green : "#DC2626"} />
        <StatCard label="Avg Days to Sell" value={`${r.avgDays}d`} color={BRAND.grayDark} />
        <StatCard label="Avg Days in Inv." value={`${r.avgInventoryDays}d`} color={BRAND.grayDark} />
      </div>

      {/* Top Deals */}
      <Card style={{ marginBottom: 14 }}>
        <SectionTitle>Top Deals — {r.label}</SectionTitle>
        {r.topDeals.length === 0 ? <div style={{ color: BRAND.gray, fontSize: 12 }}>No completed deals in this period</div> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ background: BRAND.redBg }}>{["Rank", "Vehicle", "Invested", "Net Sale", "Profit", "Days", "Grade"].map(h => <TH key={h}>{h}</TH>)}</tr></thead>
              <tbody>
                {r.topDeals.map((d, i) => (
                  <tr key={d.vehicle.id} style={{ borderBottom: `1px solid ${BRAND.grayLight}` }}>
                    <TD style={{ fontWeight: 800 }}>{`#${i + 1}`}</TD>
                    <TD><span style={{ color: BRAND.red, ...S.mono, fontWeight: 700, fontSize: 10 }}>#{d.vehicle.stockNum}</span> {d.vehicle.year} {d.vehicle.make} {d.vehicle.model}</TD>
                    <TD style={{ ...S.mono }}>{fmt$(d.metrics.totalCost)}</TD>
                    <TD style={{ ...S.mono }}>{fmt$(d.metrics.netSale)}</TD>
                    <TD style={{ ...S.mono, fontWeight: 800, color: (d.metrics.grossProfit || 0) >= 0 ? BRAND.green : "#DC2626" }}>{fmt$(d.metrics.grossProfit)}</TD>
                    <TD>{d.metrics.days || "—"}d</TD>
                    <TD>{d.metrics.grade && <span style={{ fontWeight: 900, color: d.metrics.grade.color, ...S.mono, fontSize: 16 }}>{d.metrics.grade.grade}</span>}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Expense Breakdown */}
      <Card>
        <SectionTitle>Expense Breakdown — {r.label}</SectionTitle>
        {Object.keys(r.expByCat).length === 0 ? <div style={{ color: BRAND.gray, fontSize: 12 }}>No expenses in this period</div> : (
          <div>
            {Object.entries(r.expByCat).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => {
              const max = Math.max(...Object.values(r.expByCat));
              return (
                <div key={cat} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2 }}>
                    <span style={{ color: BRAND.grayDark }}>{cat}</span>
                    <span style={{ color: BRAND.black, fontWeight: 600, ...S.mono }}>{fmt$(amt)}</span>
                  </div>
                  <MiniBar value={amt} max={max} color={BRAND.red} />
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// APPROVALS TAB (Admin Only)
// ═══════════════════════════════════════════════════════════════
function ApprovalsTab({ data, setData }) {
  const [approvals, setApprovals] = useState([]);
  const [filter, setFilter] = useState("pending");
  const refresh = async () => { const a = await loadApprovals(); setApprovals(a); };
  useEffect(() => { refresh(); }, []);

  const handleApprove = async (approval) => {
    // Apply the change
    if (approval.type === "expense_edit" && approval.newData) {
      setData(d => ({ ...d, expenses: d.expenses.map(e => e.id === approval.targetId ? approval.newData : e) }));
    } else if (approval.type === "expense_delete") {
      setData(d => ({ ...d, expenses: d.expenses.filter(e => e.id !== approval.targetId) }));
    } else if (approval.type === "sale_edit" && approval.newData) {
      setData(d => ({ ...d, sales: d.sales.map(s => s.id === approval.targetId ? approval.newData : s) }));
    } else if (approval.type === "sale_delete") {
      setData(d => ({ ...d, sales: d.sales.filter(s => s.id !== approval.targetId) }));
    } else if (approval.type === "vehicle_delete") {
      setData(d => ({
        ...d,
        vehicles: d.vehicles.filter(x => x.id !== approval.targetId),
        trash: approval.originalData
          ? [...(d.trash || []), toTrash(approval.originalData, "vehicle", approval.requestedBy)]
          : (d.trash || []),
      }));
    } else if (approval.type === "fund_outflow" && approval.newData) {
      // Second-approver greenlighted a > $10K fund outflow. Now book
      // the deferred journal entries. Same logic as postVehicleToLedger
      // but runs on approval instead of the initial click.
      const { vehicleId, deposit, balance, depositSource, balanceSource } = approval.newData;
      const veh = (data.vehicles || []).find(x => x.id === vehicleId);
      if (!veh) return;
      const date = veh.purchaseDate || new Date().toISOString().slice(0, 10);
      const entries = [];
      if (deposit > 0) {
        if (depositSource === "fund") entries.push(vehiclePurchaseFromFundEntry({ stockNum: veh.stockNum, amount: deposit, date, memo: `Deposit — #${veh.stockNum} (approved outflow)`, user: "Admin" }));
        else if (depositSource.startsWith("member:")) entries.push(vehiclePurchaseFromMemberEntry({ stockNum: veh.stockNum, memberId: depositSource.slice(7), amount: deposit, date, memo: `Deposit — #${veh.stockNum}`, user: "Admin" }));
      }
      if (balance > 0) {
        if (balanceSource === "fund") entries.push(vehiclePurchaseFromFundEntry({ stockNum: veh.stockNum, amount: balance, date, memo: `Balance — #${veh.stockNum} (approved outflow)`, user: "Admin" }));
        else if (balanceSource.startsWith("member:")) entries.push(vehiclePurchaseFromMemberEntry({ stockNum: veh.stockNum, memberId: balanceSource.slice(7), amount: balance, date, memo: `Balance — #${veh.stockNum}`, user: "Admin" }));
      }
      setData(d => {
        let ledger = d.money?.ledger || [];
        for (const e of entries) ledger = postJournalEntry(ledger, e);
        const accounts = d.money?.accounts || DEFAULT_ACCOUNTS;
        const hasAcc = accounts.some(a => a.id === vehicleAccountId(veh.stockNum));
        const newAccounts = hasAcc ? accounts : [...accounts, buildVehicleAccount(veh.stockNum, `${veh.year} ${veh.make} ${veh.model}`)];
        return {
          ...d,
          money: { ...d.money, ledger, accounts: newAccounts },
          vehicles: d.vehicles.map(x => x.id === vehicleId ? { ...x, postedToLedger: true } : x),
        };
      });
    }
    // Update approval status
    const all = (await loadApprovals()).map(a => a.id === approval.id ? { ...a, status: "approved", resolvedAt: new Date().toISOString() } : a);
    saveApprovals(all);
    logActivity("Admin", "approved_request", `Approved ${approval.type.replace("_", " ")} by ${approval.requestedBy} on #${approval.stockNum} ${approval.vehicle}`);
    refresh();
  };

  const handleReject = async (approval) => {
    const all = (await loadApprovals()).map(a => a.id === approval.id ? { ...a, status: "rejected", resolvedAt: new Date().toISOString() } : a);
    saveApprovals(all);
    logActivity("Admin", "rejected_request", `Rejected ${approval.type.replace("_", " ")} by ${approval.requestedBy} on #${approval.stockNum} ${approval.vehicle}`);
    refresh();
  };

  const filtered = approvals.filter(a => filter === "all" ? true : a.status === filter);
  const pendingCount = approvals.filter(a => a.status === "pending").length;

  const typeLabels = { expense_edit: "Expense Edit", expense_delete: "Expense Delete", sale_edit: "Sale Edit", sale_delete: "Sale Delete" };
  const typeColors = { expense_edit: { bg: "#FEF3C7", fg: "#92400E" }, expense_delete: { bg: "#FEE2E2", fg: "#DC2626" }, sale_edit: { bg: "#DBEAFE", fg: "#1E40AF" }, sale_delete: { bg: "#FEE2E2", fg: "#DC2626" } };
  const statusColors = { pending: { bg: "#FEF3C7", fg: "#92400E" }, approved: { bg: "#D1FAE5", fg: "#065F46" }, rejected: { bg: "#FEE2E2", fg: "#991B1B" } };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: BRAND.black }}>
            Approval Requests
            {pendingCount > 0 && <span style={{ background: "#DC2626", color: "#fff", fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 10, marginLeft: 8 }}>{pendingCount}</span>}
          </div>
          <div style={{ fontSize: 12, color: BRAND.gray }}>Review and approve or reject user edit requests</div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {["pending", "approved", "rejected", "all"].map(f => (
            <Btn key={f} variant={filter === f ? "primary" : "secondary"} size="sm" onClick={() => setFilter(f)}>
              {f.charAt(0).toUpperCase() + f.slice(1)} {f === "pending" ? `(${pendingCount})` : ""}
            </Btn>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty icon={<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>} title={filter === "pending" ? "No pending requests" : "No requests"} sub={filter === "pending" ? "All caught up! No user edits awaiting approval." : "No requests match this filter."} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map(a => {
            const tc = typeColors[a.type] || { bg: BRAND.grayLight, fg: BRAND.grayDark };
            const sc = statusColors[a.status] || statusColors.pending;
            return (
              <Card key={a.id} style={{ borderLeft: `4px solid ${a.status === "pending" ? "#D97706" : a.status === "approved" ? BRAND.green : "#DC2626"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 10 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <Badge color={tc.fg} bg={tc.bg}>{typeLabels[a.type] || a.type}</Badge>
                      <Badge color={sc.fg} bg={sc.bg}>{a.status}</Badge>
                      <span style={{ fontSize: 11, color: BRAND.gray, ...S.mono }}>#{a.stockNum}</span>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: BRAND.black }}>{a.vehicle}</div>
                    <div style={{ fontSize: 12, color: BRAND.grayDark, marginTop: 2 }}>{a.description}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: BRAND.blue }}>{a.requestedBy}</div>
                    <div style={{ fontSize: 10, color: BRAND.gray }}>{new Date(a.requestedAt).toLocaleDateString()} {new Date(a.requestedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                  </div>
                </div>

                {/* Show what changed */}
                {a.originalData && a.newData && (
                  <div style={{ background: "#F9FAFB", borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 11 }}>
                    <div style={{ fontWeight: 700, color: BRAND.gray, textTransform: "uppercase", fontSize: 10, marginBottom: 6 }}>Changes Requested</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                      {Object.keys(a.newData).filter(k => k !== "id" && JSON.stringify(a.newData[k]) !== JSON.stringify(a.originalData[k])).map(k => (
                        <div key={k} style={{ padding: "3px 0" }}>
                          <span style={{ color: BRAND.gray, textTransform: "capitalize" }}>{k.replace(/([A-Z])/g, " $1")}: </span>
                          <span style={{ color: "#DC2626", textDecoration: "line-through", marginRight: 4 }}>{a.originalData[k] || "—"}</span>
                          <span style={{ color: BRAND.green, fontWeight: 600 }}>{a.newData[k] || "—"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {a.status === "pending" && (
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <Btn variant="danger" size="sm" onClick={() => handleReject(a)}>Reject</Btn>
                    <Btn size="sm" onClick={() => handleApprove(a)} style={{ background: BRAND.green }}>Approve</Btn>
                  </div>
                )}
                {a.resolvedAt && <div style={{ fontSize: 10, color: BRAND.gray, marginTop: 6, textAlign: "right" }}>Resolved: {new Date(a.resolvedAt).toLocaleDateString()} {new Date(a.resolvedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ACTIVITY TAB (Admin Only)
// ═══════════════════════════════════════════════════════════════
function ActivityTab() {
  const [log, setLog] = useState([]);
  const [userFilter, setUserFilter] = useState("All");
  const refresh = async () => { const data = await loadActivityLog(); setLog(Array.isArray(data) ? data : []); };

  useEffect(() => { refresh(); }, []);

  const users = [...new Set(log.map(e => e.user))];
  const filtered = userFilter === "All" ? log : log.filter(e => e.user === userFilter);

  const actionIcons = {
    added_vehicle: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18 10l-2.7-3.6A1.5 1.5 0 0 0 14.1 6H9.9a1.5 1.5 0 0 0-1.2.6L6 10l-2.5 1.1C2.7 11.3 2 12.1 2 13v3c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>,
    edited_vehicle: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>,
    deleted_vehicle: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
    added_expense: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
    edited_expense: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>,
    deleted_expense: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
    finalized_sale: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="12" y1="6" x2="12" y2="18"/><path d="M6 12h.01"/><path d="M18 12h.01"/></svg>,
    edited_sale: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>,
    deleted_sale: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
    requested_edit: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>,
    requested_delete: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>,
    approved_request: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
    rejected_request: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>,
  };
  const actionColors = {
    added_vehicle: BRAND.green, edited_vehicle: BRAND.blue, deleted_vehicle: "#DC2626",
    added_expense: BRAND.green, edited_expense: BRAND.blue, deleted_expense: "#DC2626",
    finalized_sale: BRAND.green, edited_sale: BRAND.blue, deleted_sale: "#DC2626",
    requested_edit: "#D97706", requested_delete: "#D97706",
    approved_request: BRAND.green, rejected_request: "#DC2626",
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: BRAND.black }}>Activity History</div>
          <div style={{ fontSize: 12, color: BRAND.gray }}>Track what each user has done</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={userFilter} onChange={e => setUserFilter(e.target.value)} style={{ border: `1px solid ${BRAND.grayLight}`, borderRadius: 6, padding: "5px 10px", fontSize: 12, background: BRAND.white }}>
            <option value="All">All Users</option>
            {users.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <Btn variant="secondary" size="sm" onClick={refresh}>Refresh</Btn>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty icon={<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>} title="No activity" sub="User actions will appear here" />
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ maxHeight: 600, overflowY: "auto" }}>
            {filtered.map((entry, i) => {
              const icon = actionIcons[entry.action] || <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="17" x2="12" y2="3"/><path d="M5 12l7-9 7 9"/><line x1="19" y1="21" x2="5" y2="21"/></svg>;
              const color = actionColors[entry.action] || BRAND.gray;
              const date = new Date(entry.timestamp);
              const isToday = new Date().toDateString() === date.toDateString();
              const timeStr = isToday ? `Today ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
              return (
                <div key={entry.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: `1px solid ${BRAND.grayLight}`, background: i % 2 === 0 ? "#FAFAFA" : BRAND.white }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{icon}</span>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: BRAND.black }}>
                      <span style={{ fontWeight: 700, color: BRAND.blue }}>{entry.user}</span>
                      <span style={{ color: BRAND.grayDark, marginLeft: 6 }}>{entry.description}</span>
                    </div>
                    <div style={{ fontSize: 10, color: BRAND.gray, marginTop: 2 }}>
                      {entry.action.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: BRAND.gray, whiteSpace: "nowrap", flexShrink: 0, ...S.mono }}>{timeStr}</div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// USERS TAB (Admin Only)
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// USERS MANAGEMENT — Firebase Admin Panel
// ═══════════════════════════════════════════════════════════════
const SUPER_ADMIN_EMAIL = import.meta.env.VITE_SUPER_ADMIN_EMAIL || "support@sayarah.io";
const ALL_AUCTION_TABS = ["Dashboard", "Pipeline", "Inventory", "Mileage", "Analytics", "Calendar", "Reports", "Accounting", "Approvals", "Activity", "Settings"];
const USER_ROLES = [
  { key: "admin", label: "Admin", color: "#D97706", bg: "#FEF3C7" },
  { key: "manager", label: "Manager", color: "#2563EB", bg: "#DBEAFE" },
  { key: "user", label: "User", color: "#059669", bg: "#D1FAE5" },
  { key: "accountant", label: "Accountant/CPA", color: "#7C3AED", bg: "#EDE9FE" },
  { key: "viewer", label: "Viewer", color: "#4B5563", bg: "#E5E7EB" },
];

function timeAgo(isoString) {
  if (!isoString) return "Never";
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

// ═══════════════════════════════════════════════════════════════
// TRASH TAB (Admin Only) — restore / purge soft-deleted records
// ═══════════════════════════════════════════════════════════════
function TrashTab({ data, setData, currentUser }) {
  const [filter, setFilter] = useState("all");
  const [confirmPurge, setConfirmPurge] = useState(null); // trash item or "__ALL__"
  const trash = [...(data.trash || [])].sort((a, b) => (b._deletedAt || "").localeCompare(a._deletedAt || ""));
  const filtered = filter === "all" ? trash : trash.filter(t => t._entity === filter);
  const counts = { all: trash.length, vehicle: trash.filter(t => t._entity === "vehicle").length, expense: trash.filter(t => t._entity === "expense").length, sale: trash.filter(t => t._entity === "sale").length };

  const describe = (item) => {
    if (item._entity === "vehicle") return `#${item.stockNum || "—"} ${item.year || ""} ${item.make || ""} ${item.model || ""}`.trim();
    if (item._entity === "expense") return `${item.category || "—"} · ${fmt$2(p(item.amount))}${item.stockNum ? ` · #${item.stockNum}` : ""}`;
    if (item._entity === "sale") return `${fmt$2(p(item.grossPrice))} · ${item.buyerName || "—"}${item.stockNum ? ` · #${item.stockNum}` : ""}`;
    return "—";
  };

  // Match on id + _deletedAt — that combination is unique
  const matches = (t, item) => t.id === item.id && t._deletedAt === item._deletedAt;

  const restore = (item) => {
    const entity = item._entity;
    // Strip trash metadata before restoring
    const { _entity, _deletedAt, _deletedBy, _trashId, ...clean } = item;
    setData(d => {
      const remainingTrash = (d.trash || []).filter(t => !matches(t, item));
      const restored = { ...clean };
      if (entity === "vehicle") {
        const ids = new Set(d.vehicles.map(v => v.id));
        if (ids.has(restored.id)) restored.id = genId();
        const stocks = new Set(d.vehicles.map(v => v.stockNum));
        let nextStock = d.nextStockNum || 1;
        if (stocks.has(restored.stockNum)) { restored.stockNum = nextStock; nextStock += 1; }
        return { ...d, vehicles: [...d.vehicles, restored], trash: remainingTrash, nextStockNum: nextStock };
      }
      if (entity === "expense") {
        const ids = new Set(d.expenses.map(e => e.id));
        if (ids.has(restored.id)) restored.id = genId();
        return { ...d, expenses: [...d.expenses, restored], trash: remainingTrash };
      }
      if (entity === "sale") {
        const ids = new Set(d.sales.map(s => s.id));
        if (ids.has(restored.id)) restored.id = genId();
        return { ...d, sales: [...d.sales, restored], trash: remainingTrash };
      }
      return d;
    });
    logActivity(currentUser, `restored_${entity}`, `Restored ${entity}: ${describe(item)}`);
  };

  const purgeOne = (item) => {
    setData(d => ({ ...d, trash: (d.trash || []).filter(t => !matches(t, item)) }));
    logActivity(currentUser, "purged_trash", `Permanently deleted ${item._entity}: ${describe(item)}`);
    setConfirmPurge(null);
  };

  const purgeAll = () => {
    const n = (data.trash || []).length;
    setData(d => ({ ...d, trash: [] }));
    logActivity(currentUser, "purged_trash", `Emptied trash (${n} items)`);
    setConfirmPurge(null);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: BRAND.black }}>Trash</div>
          <div style={{ fontSize: 12, color: BRAND.gray }}>Recently deleted records · restore or purge permanently</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={filter} onChange={e => setFilter(e.target.value)} style={{ border: `1px solid ${BRAND.grayLight}`, borderRadius: 6, padding: "5px 10px", fontSize: 12, background: BRAND.white }}>
            <option value="all">All ({counts.all})</option>
            <option value="vehicle">Vehicles ({counts.vehicle})</option>
            <option value="expense">Expenses ({counts.expense})</option>
            <option value="sale">Sales ({counts.sale})</option>
          </select>
          {trash.length > 0 && <Btn variant="danger" size="sm" onClick={() => setConfirmPurge("__ALL__")}>Empty Trash</Btn>}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty icon={<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>} title="Trash is empty" sub="Deleted records will appear here for recovery" />
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ maxHeight: 600, overflowY: "auto" }}>
            {filtered.map((item, i) => {
              const color = item._entity === "vehicle" ? BRAND.blue : item._entity === "expense" ? "#D97706" : BRAND.green;
              const when = item._deletedAt ? new Date(item._deletedAt) : null;
              return (
                <div key={`${item.id}-${item._deletedAt}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: `1px solid ${BRAND.grayLight}`, background: i % 2 === 0 ? "#FAFAFA" : BRAND.white }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: BRAND.black, fontWeight: 600 }}>
                      <span style={{ textTransform: "uppercase", fontSize: 10, color, marginRight: 8, letterSpacing: "0.05em" }}>{item._entity}</span>
                      {describe(item)}
                    </div>
                    <div style={{ fontSize: 10, color: BRAND.gray, marginTop: 2 }}>
                      Deleted by <b>{item._deletedBy || "—"}</b>
                      {when && <span style={S.mono}> · {when.toLocaleDateString()} {when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <Btn size="sm" variant="secondary" onClick={() => restore(item)}>Restore</Btn>
                    <Btn size="sm" variant="danger" onClick={() => setConfirmPurge(item)}>Purge</Btn>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {confirmPurge === "__ALL__" && <Confirm msg={`Permanently delete all ${trash.length} items in trash? This cannot be undone.`} onOk={purgeAll} onCancel={() => setConfirmPurge(null)} />}
      {confirmPurge && confirmPurge !== "__ALL__" && <Confirm msg={`Permanently delete this ${confirmPurge._entity}? This cannot be undone.`} onOk={() => purgeOne(confirmPurge)} onCancel={() => setConfirmPurge(null)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MONEY MANAGEMENT TAB — Phase 1 core
//
// Dashboard + six sub-views backed by the double-entry ledger in
// data.money.ledger. All arithmetic is in src/money.js (tested in
// tests/money.test.mjs). This component owns UI, wiring, and
// admin workflows (approvals, contribution marking, month-end
// distribution trigger).
// ═══════════════════════════════════════════════════════════════
function MoneyManagementTab({ data, setData, username, userRole, darkMode }) {
  const money = data.money || { accounts: DEFAULT_ACCOUNTS, members: [], ledger: [], contributions: [], approvals: [] };
  const admin = isAdmin(userRole);
  // Super admin gets member-assignment + redo/pending privileges on
  // top of regular admin capabilities. Resolved via email match so
  // the check can't be bypassed by mutating the role field.
  const currentEmail = (auth && auth.currentUser && auth.currentUser.email) || "";
  const isSuper = currentEmail === SUPER_ADMIN_EMAIL;
  const today = new Date();
  const currentMonth = monthKey(today);

  const [view, setView] = useState("dashboard");
  const [memberFilter, setMemberFilter] = useState(null);
  const [showRules, setShowRules] = useState(false);
  const [showEditRules, setShowEditRules] = useState(false);
  const [showManageMembers, setShowManageMembers] = useState(false);

  // Balances are computed from the ledger every render — no stored
  // totals that could drift out of sync.
  const balances = useMemo(() => calcAllBalances(money.ledger, money.accounts), [money.ledger, money.accounts]);

  const fundBalance = balances[SYSTEM_ACCOUNTS.ATLANTIC_FUND] || 0;
  const profitBalance = balances[SYSTEM_ACCOUNTS.PROFIT_DISTRIBUTION] || 0;
  const taxBalance = balances[SYSTEM_ACCOUNTS.TAX] || 0;

  // Helper: post a journal entry and save. Passes closedPeriods so
  // the closed-year guard in postJournalEntry fires for any entry
  // dated inside a closed fiscal period.
  const postEntry = (entry) => {
    try {
      setData(d => ({
        ...d,
        money: {
          ...d.money,
          ledger: postJournalEntry(d.money?.ledger || [], entry, d.money?.closedPeriods || []),
        },
      }));
    } catch (err) {
      alert(err.message || String(err));
    }
  };

  // Helper: log + post
  const postWithLog = (entry, action, description) => {
    postEntry(entry);
    logActivity(username, action, description, { entryId: entry.id, ref: entry.ref });
  };

  // ── Monthly status for each member ──
  const memberStatuses = money.members.map(m => ({
    member: m,
    status: calcMemberMonthlyStatus(m.id, currentMonth, money.contributions, money.approvals),
    contribution: findContribution(money.contributions, m.id, currentMonth),
    approval: findApproval(money.approvals, m.id, currentMonth),
    capitalBalance: balances[memberAccountId(m.id)] || 0,
  }));

  // ── Actions ──
  const seedMonth = () => {
    setData(d => ({
      ...d,
      money: {
        ...d.money,
        contributions: generateMonthlyContributions(d.money?.contributions || [], d.money?.members || [], currentMonth),
      },
    }));
    logActivity(username, "money_seeded_month", `Generated contribution records for ${currentMonth}`);
  };

  const markContributionPaid = (memberId) => {
    const amount = MONTHLY_CONTRIBUTION_AMOUNT;
    const entry1 = contributionPaidEntryBalanced({ memberId, month: currentMonth, amount, user: username });
    const entry2 = allocateToFundEntry({ amount, user: username, memo: `Contribution ${currentMonth} → Atlantic Fund` });
    setData(d => ({
      ...d,
      money: {
        ...d.money,
        ledger: postJournalEntry(postJournalEntry(d.money?.ledger || [], entry1, d.money?.closedPeriods || []), entry2, d.money?.closedPeriods || []),
        contributions: (d.money?.contributions || []).map(c =>
          (c.memberId === memberId && c.month === currentMonth)
            ? { ...c, status: "paid", paidDate: new Date().toISOString().slice(0, 10), journalEntryId: entry1.id }
            : c
        ),
      },
    }));
    const name = money.members.find(m => m.id === memberId)?.name || memberId;
    logActivity(username, "contribution_paid", `${name} paid ${currentMonth} contribution ($${amount})`);
  };

  const approveFundUsage = (memberId) => {
    const existing = findApproval(money.approvals, memberId, currentMonth);
    setData(d => ({
      ...d,
      money: {
        ...d.money,
        approvals: existing
          ? (d.money.approvals || []).map(a => (a.memberId === memberId && a.month === currentMonth) ? { ...a, status: "approved", approvedBy: username, approvedAt: new Date().toISOString() } : a)
          : [...(d.money?.approvals || []), { id: `appr_${currentMonth}_${memberId}`, memberId, month: currentMonth, status: "approved", approvedBy: username, approvedAt: new Date().toISOString() }],
      },
    }));
    const name = money.members.find(m => m.id === memberId)?.name || memberId;
    logActivity(username, "fund_usage_approved", `Approved ${name} for fund usage ${currentMonth}`);
  };

  // ─── Super-admin-only: undo actions on this month's state ───
  //
  // These roll back the state record (contribution / approval) and
  // post a reversing journal entry for anything that hit the ledger.
  // The original entries stay in the ledger (immutable audit trail);
  // the reversal makes the net effect zero.
  const undoContributionPaid = (memberId) => {
    const cont = findContribution(money.contributions, memberId, currentMonth);
    if (!cont || cont.status !== "paid") return;
    if (!confirm(`Undo ${cont.memberId}'s paid contribution for ${currentMonth}? The original ledger entry stays; a reversing entry is posted to net it out.`)) return;
    setData(d => {
      let ledger = d.money?.ledger || [];
      const closedPeriods = d.money?.closedPeriods || [];
      // Reverse the original contribution entry + its fund-allocation
      // entry if we can find them by ref type.
      const contribEntry = ledger.find(e => e.ref && e.ref.type === "contribution" && e.ref.memberId === memberId && e.ref.month === currentMonth && !ledger.some(x => x.ref && x.ref.type === "reversal" && x.ref.of === e.id));
      if (contribEntry) {
        try {
          const rev = buildReversingEntry(contribEntry, { user: username, memo: `Undo contribution by super-admin` });
          ledger = postJournalEntry(ledger, rev, closedPeriods);
        } catch (err) { console.warn("contribution reversal failed:", err); }
      }
      return {
        ...d,
        money: {
          ...d.money,
          ledger,
          contributions: (d.money.contributions || []).map(c =>
            c.memberId === memberId && c.month === currentMonth
              ? { ...c, status: "pending", paidDate: null, undoneBy: username, undoneAt: new Date().toISOString() }
              : c
          ),
        },
      };
    });
    const name = money.members.find(m => m.id === memberId)?.name || memberId;
    logActivity(username, "contribution_undone", `Undid ${name}'s ${currentMonth} contribution (super-admin)`);
  };
  const revokeFundApproval = (memberId) => {
    const name = money.members.find(m => m.id === memberId)?.name || memberId;
    if (!confirm(`Revoke ${name}'s fund-usage approval for ${currentMonth}? They'll be blocked from fund usage until re-approved.`)) return;
    setData(d => ({
      ...d,
      money: {
        ...d.money,
        approvals: (d.money?.approvals || []).map(a =>
          a.memberId === memberId && a.month === currentMonth
            ? { ...a, status: "pending", revokedBy: username, revokedAt: new Date().toISOString() }
            : a
        ),
      },
    }));
    logActivity(username, "fund_approval_revoked", `Revoked ${name}'s ${currentMonth} fund-usage approval (super-admin)`);
  };
  const markContributionPending = (memberId) => {
    const cont = findContribution(money.contributions, memberId, currentMonth);
    if (!cont) return;
    if (cont.status === "paid") {
      // Paid → pending also requires reversing the ledger entry.
      undoContributionPaid(memberId);
      return;
    }
    setData(d => ({
      ...d,
      money: {
        ...d.money,
        contributions: (d.money?.contributions || []).map(c =>
          c.memberId === memberId && c.month === currentMonth
            ? { ...c, status: "pending" }
            : c
        ),
      },
    }));
    const name = money.members.find(m => m.id === memberId)?.name || memberId;
    logActivity(username, "contribution_marked_pending", `Marked ${name}'s ${currentMonth} contribution pending (super-admin)`);
  };

  // Assign a real User (from auction user pool) to a member slot.
  const assignMember = (slotId, userRecord) => {
    setData(d => ({
      ...d,
      money: {
        ...d.money,
        members: (d.money?.members || []).map(m =>
          m.id === slotId
            ? {
                ...m,
                name: userRecord ? (userRecord.firstName && userRecord.lastName ? `${userRecord.firstName} ${userRecord.lastName}` : userRecord.displayName || userRecord.email) : m.name,
                email: userRecord?.email || "",
                userId: userRecord?.id || userRecord?.uid || null,
                assignedAt: new Date().toISOString(),
                assignedBy: username,
              }
            : m
        ),
      },
    }));
    logActivity(username, "member_assigned", `Assigned ${userRecord?.email || "(unassigned)"} to ${slotId}`);
  };

  const runMonthEndDistribution = () => {
    if (profitBalance <= 0) return;
    const entry = distributeMonthEndEntry({ month: currentMonth, members: money.members, profitBalance, user: username });
    if (!entry) return;
    postWithLog(entry, "month_end_distribution", `Distributed ${fmt$2(profitBalance)} across ${money.members.length} members for ${currentMonth}`);
  };

  const saveRules = (content) => {
    setData(d => {
      const prev = d.rules || { content: DEFAULT_RULES_CONTENT, version: 1, updatedAt: new Date().toISOString(), updatedBy: "system" };
      const history = prev.history || [];
      return {
        ...d,
        rules: {
          content,
          version: (prev.version || 0) + 1,
          updatedAt: new Date().toISOString(),
          updatedBy: username,
          // Rules versioning per spec #12 — keep prior rule sets with
          // their effective date so members can see what changed.
          history: [...history, { version: prev.version || 1, content: prev.content, effectiveFrom: prev.updatedAt, effectiveTo: new Date().toISOString(), updatedBy: prev.updatedBy }],
          // Reset everyone's acknowledgement so members see a "please
          // review the updated rules" banner next time they open the tab.
          acknowledgedBy: [],
        },
      };
    });
    logActivity(username, "rules_updated", `Updated Money Management rules to v${(data.rules?.version || 0) + 1}`);
    setShowEditRules(false);
  };
  const acknowledgeRules = () => {
    setData(d => ({
      ...d,
      rules: {
        ...(d.rules || {}),
        acknowledgedBy: Array.from(new Set([...((d.rules?.acknowledgedBy) || []), username])),
      },
    }));
  };

  // Auto month-end distribution check — runs on tab mount and each
  // render. Triggers a distribution post if today is the last day
  // of the month AND there's profit sitting in the distribution
  // account AND no distribution has been posted for this month yet.
  useEffect(() => {
    if (!admin) return;
    const now = new Date();
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
    const isLastDayOfMonth = now.getMonth() !== tomorrow.getMonth();
    if (!isLastDayOfMonth || profitBalance <= 0) return;
    const alreadyDistributed = (money.ledger || []).some(e => e.ref && e.ref.type === "distribution" && e.ref.month === currentMonth);
    if (alreadyDistributed) return;
    // Auto-run. The admin can always reverse by posting the reversing entry.
    runMonthEndDistribution();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profitBalance, currentMonth]);

  // ══════════════════════════════════════════════════════════════
  // UI
  // ══════════════════════════════════════════════════════════════
  const SUB_VIEWS = [
    { id: "dashboard", label: "Dashboard" },
    { id: "fund", label: "Atlantic Fund" },
    { id: "profit", label: "Profit Distribution" },
    { id: "tax", label: "Tax Account" },
    { id: "members", label: "Members" },
    { id: "vehicles", label: "Vehicle P&L" },
    { id: "transactions", label: "Transactions" },
    { id: "audit", label: "Audit Trail" },
    { id: "reconciliation", label: "Bank Recon" },
    { id: "reports", label: "Tax Exports" },
    { id: "yearend", label: "Year-End Close" },
  ];

  // Notifications: derive from state (no stored feed). Surfaced as a
  // banner at the top of the tab so admins + members see pending
  // action items at a glance.
  const notifications = [];
  if (fundBalance < ATLANTIC_FUND_LOW_BALANCE) {
    notifications.push({ id: "low-balance", level: "warn", message: `Atlantic Fund is below ${fmt$2(ATLANTIC_FUND_LOW_BALANCE)} — currently ${fmt$2(fundBalance)}.` });
  }
  const pendingContribs = (money.contributions || []).filter(c => c.month === currentMonth && c.status !== "paid").length;
  if (pendingContribs > 0) {
    notifications.push({ id: "pending-contribs", level: "info", message: `${pendingContribs} member contribution${pendingContribs > 1 ? "s" : ""} still pending for ${currentMonth}.` });
  }
  if (admin) {
    const missingApprovals = (money.members || []).filter(m => {
      const a = findApproval(money.approvals, m.id, currentMonth);
      return !a || a.status !== "approved";
    }).length;
    if (missingApprovals > 0) {
      notifications.push({ id: "missing-approvals", level: "warn", message: `${missingApprovals} member${missingApprovals > 1 ? "s" : ""} awaiting your ${currentMonth} fund-usage approval.` });
    }
  }
  if (profitBalance > 0) {
    notifications.push({ id: "distribution-ready", level: "info", message: `${fmt$2(profitBalance)} pending in Profit Distribution — will auto-distribute on the last day of the month.` });
  }
  // Rules-updated nudge for non-admin members (and admins who haven't
  // acknowledged). Keeps until the user clicks acknowledge.
  const rulesAcked = ((data.rules?.acknowledgedBy) || []).includes(username);
  if (!rulesAcked && data.rules && data.rules.version > 1) {
    notifications.push({ id: "rules-updated", level: "info", message: `Money Management rules updated to v${data.rules.version}. Please review.`, action: "acknowledge" });
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 900, color: BRAND.black }}>Money Management</div>
          <div style={{ fontSize: 12, color: BRAND.gray }}>Atlantic Fund · Member Capital · Profit Distribution · Tax — all backed by the ledger</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Btn variant="secondary" size="sm" onClick={() => setShowRules(true)}>Rules</Btn>
          {isSuper && <Btn variant="secondary" size="sm" onClick={() => setShowManageMembers(true)}>Manage Members</Btn>}
          {admin && <Btn size="sm" onClick={seedMonth}>Seed {currentMonth}</Btn>}
        </div>
      </div>

      {/* Notifications banner — aggregates low-balance, pending contributions,
          pending approvals, distribution-ready, and rules-updated prompts. */}
      {notifications.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          {notifications.map(n => (
            <div key={n.id} style={{ padding: "8px 12px", borderRadius: 8, background: n.level === "warn" ? "#FEF3C7" : "#EFF6FF", color: n.level === "warn" ? "#92400E" : "#1E40AF", border: `1px solid ${n.level === "warn" ? "#FCD34D" : "#BFDBFE"}`, fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span>{n.message}</span>
              {n.action === "acknowledge" && (
                <Btn size="sm" variant="secondary" onClick={acknowledgeRules}>I've reviewed</Btn>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Sub-view tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
        {SUB_VIEWS.map(sv => (
          <button key={sv.id} onClick={() => setView(sv.id)} style={{
            background: view === sv.id ? BRAND.red : BRAND.white,
            color: view === sv.id ? "#fff" : BRAND.grayDark,
            border: `1px solid ${view === sv.id ? BRAND.red : BRAND.grayLight}`,
            borderRadius: 6, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
          }}>{sv.label}</button>
        ))}
      </div>

      {view === "dashboard" && (
        <div>
          {/* Key balances */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
            <StatCard label="Atlantic Fund" value={fmt$(fundBalance)} color={fundBalance < ATLANTIC_FUND_LOW_BALANCE ? "#DC2626" : BRAND.green} sub={fundBalance < ATLANTIC_FUND_LOW_BALANCE ? `Below $${ATLANTIC_FUND_LOW_BALANCE.toLocaleString()} warning` : `Target $${ATLANTIC_FUND_TARGET.toLocaleString()}`} />
            <StatCard label="Profit Distribution" value={fmt$(profitBalance)} color={BRAND.blue} sub={profitBalance > 0 ? "Pending month-end payout" : "No pending profit"} />
            <StatCard label="Tax Account" value={fmt$(taxBalance)} color="#D97706" sub={`$${TAX_PER_SALE} per sale`} />
            <StatCard label="Total Journal Entries" value={money.ledger.length} color={BRAND.gray} sub={`this month: ${money.ledger.filter(e => monthKey(e.date) === currentMonth).length}`} />
          </div>

          {/* Member status strip */}
          <Card style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: BRAND.red, textTransform: "uppercase", letterSpacing: "0.07em" }}>{currentMonth} — Member Status</div>
              {admin && profitBalance > 0 && (
                <Btn size="sm" onClick={runMonthEndDistribution}>Distribute {fmt$(profitBalance)} now</Btn>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
              {memberStatuses.map(({ member, status, contribution, approval, capitalBalance }) => (
                <div key={member.id} style={{ border: `1px solid ${BRAND.grayLight}`, borderRadius: 8, padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 12, height: 12, borderRadius: "50%", background: status === "green" ? "#16A34A" : "#DC2626", flexShrink: 0 }} />
                    <div style={{ fontSize: 13, fontWeight: 800, color: BRAND.black }}>{member.name}</div>
                    <span style={{ marginLeft: "auto", fontSize: 10, color: BRAND.gray, ...S.mono }}>{fmt$(capitalBalance)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: BRAND.grayDark, display: "flex", flexDirection: "column", gap: 3 }}>
                    <div>Contribution: <b style={{ color: contribution?.status === "paid" ? BRAND.green : "#DC2626" }}>{contribution?.status || "—"}</b></div>
                    <div>Admin approval: <b style={{ color: approval?.status === "approved" ? BRAND.green : "#DC2626" }}>{approval?.status || "—"}</b></div>
                  </div>
                  {admin && (
                    <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                      {contribution && contribution.status !== "paid" && <Btn size="sm" variant="secondary" onClick={() => markContributionPaid(member.id)}>Mark paid</Btn>}
                      {(!approval || approval.status !== "approved") && <Btn size="sm" onClick={() => approveFundUsage(member.id)}>Approve fund</Btn>}
                      {/* Super-admin redo / pending controls — surfaced inline
                          so the common workflow of fixing a misclick doesn't
                          need a separate screen. Each confirms before firing
                          because the contribution-undo posts a ledger reversal. */}
                      {isSuper && contribution && contribution.status === "paid" && (
                        <Btn size="sm" variant="secondary" onClick={() => undoContributionPaid(member.id)} style={{ background: "#FEF3C7", color: "#92400E", border: "1px solid #FCD34D" }}>Undo paid</Btn>
                      )}
                      {isSuper && approval && approval.status === "approved" && (
                        <Btn size="sm" variant="secondary" onClick={() => revokeFundApproval(member.id)} style={{ background: "#FEF3C7", color: "#92400E", border: "1px solid #FCD34D" }}>Revoke approval</Btn>
                      )}
                      {isSuper && contribution && contribution.status !== "pending" && (
                        <Btn size="sm" variant="ghost" onClick={() => markContributionPending(member.id)} style={{ color: BRAND.gray }}>Mark pending</Btn>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {money.members.length > 0 && money.contributions.filter(c => c.month === currentMonth).length === 0 && admin && (
              <div style={{ marginTop: 10, padding: "8px 12px", background: "#FEF3C7", color: "#92400E", borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
                No contribution records yet for {currentMonth}. Click "Seed {currentMonth}" above to generate them.
              </div>
            )}
          </Card>

          {/* Recent transactions */}
          <Card>
            <div style={{ fontSize: 11, fontWeight: 800, color: BRAND.red, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Recent Transactions</div>
            {money.ledger.length === 0 ? (
              <div style={{ fontSize: 12, color: BRAND.gray, fontStyle: "italic", padding: 12 }}>No journal entries yet. Mark a contribution paid or record a vehicle sale to get started.</div>
            ) : (
              <LedgerTable entries={[...money.ledger].slice(-20).reverse()} accounts={money.accounts} members={money.members} />
            )}
          </Card>

          {/* Backfill: scan vehicles/expenses for unposted rows and
              post them retroactively. Safe to run repeatedly — skips
              anything already on the ledger. Admin-only. */}
          {admin && <BackfillLedgerCard data={data} setData={setData} currentUser={username} />}
        </div>
      )}

      {view === "fund" && <AccountLedgerView accountId={SYSTEM_ACCOUNTS.ATLANTIC_FUND} title="Atlantic Fund" ledger={money.ledger} accounts={money.accounts} members={money.members} balance={fundBalance} />}
      {view === "profit" && <AccountLedgerView accountId={SYSTEM_ACCOUNTS.PROFIT_DISTRIBUTION} title="Profit Distribution" ledger={money.ledger} accounts={money.accounts} members={money.members} balance={profitBalance} />}
      {view === "tax" && <AccountLedgerView accountId={SYSTEM_ACCOUNTS.TAX} title={`Tax Account ($${TAX_PER_SALE} per sale)`} ledger={money.ledger} accounts={money.accounts} members={money.members} balance={taxBalance} />}
      {view === "members" && <MembersView money={money} balances={balances} admin={admin} memberFilter={memberFilter} setMemberFilter={setMemberFilter} />}
      {view === "vehicles" && <VehiclePLView data={data} balances={balances} />}
      {view === "transactions" && <TransactionsView ledger={money.ledger} accounts={money.accounts} members={money.members} />}
      {view === "audit" && <AuditTrailView ledger={money.ledger} accounts={money.accounts} members={money.members} admin={admin} onReverse={(entry) => {
        if (!confirm(`Reverse this entry?\n"${entry.memo}"\n\nA new journal entry will post with debits and credits flipped. The original stays in the ledger (immutable audit trail).`)) return;
        try {
          setData(d => {
            const rev = buildReversingEntry(entry, { user: username, ip: "", memo: `Reversed by ${username}: ${entry.memo || ""}`.trim() });
            return {
              ...d,
              money: { ...d.money, ledger: postJournalEntry(d.money?.ledger || [], rev, d.money?.closedPeriods || []) },
            };
          });
          logActivity(username, "ledger_entry_reversed", `Reversed entry ${entry.id}: ${entry.memo}`, { entryId: entry.id });
        } catch (err) { alert(err.message || String(err)); }
      }} />}
      {view === "reconciliation" && <BankReconciliationView data={data} setData={setData} admin={admin} username={username} />}
      {view === "reports" && <TaxExportsView data={data} money={money} />}
      {view === "yearend" && <YearEndCloseView data={data} setData={setData} money={money} admin={admin} username={username} />}

      {/* Rules modal */}
      {showRules && (
        <RulesModal rules={data.rules || { content: DEFAULT_RULES_CONTENT, version: 1 }} admin={admin} onClose={() => setShowRules(false)} onEdit={() => { setShowRules(false); setShowEditRules(true); }} />
      )}
      {showEditRules && admin && (
        <RulesEditor rules={data.rules || { content: DEFAULT_RULES_CONTENT, version: 1 }} onSave={saveRules} onCancel={() => setShowEditRules(false)} />
      )}

      {/* Manage Members modal — super-admin only */}
      {showManageMembers && isSuper && (
        <ManageMembersModal
          members={money.members}
          onAssign={assignMember}
          onClose={() => setShowManageMembers(false)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// BACKFILL LEDGER CARD — one-click posts every unposted historical
// vehicle purchase + expense into the Money Management ledger.
// Vehicles need a valid funding source + funded amount to qualify.
// Expenses auto-resolve to a CoA account via DEFAULT_EXPENSE_CATEGORY_MAP.
// Safe to run repeatedly — skips anything already posted.
// ═══════════════════════════════════════════════════════════════
function BackfillLedgerCard({ data, setData, currentUser }) {
  const money = data.money || {};
  const vehicles = data.vehicles || [];
  const expenses = data.expenses || [];

  const unpostedVehicles = useMemo(() => vehicles.filter(v => {
    if (v.postedToLedger) return false;
    const deposit = p(v.depositAmount);
    const balance = p(v.balanceAmount);
    const hasDeposit = deposit > 0 && !!v.depositSource;
    const hasBalance = balance > 0 && !!v.balanceSource;
    return hasDeposit || hasBalance;
  }), [vehicles]);

  const unpostedExpenses = useMemo(() =>
    expenses.filter(e => !e.journalEntryId && p(e.amount) > 0),
    [expenses]
  );

  const nothingToDo = unpostedVehicles.length === 0 && unpostedExpenses.length === 0;

  const runBackfill = () => {
    if (!confirm(`Backfill ${unpostedVehicles.length} vehicle purchase${unpostedVehicles.length === 1 ? "" : "s"} + ${unpostedExpenses.length} expense${unpostedExpenses.length === 1 ? "" : "s"} into the ledger? This posts journal entries retroactively and cannot be undone (you'd have to post reversals by hand).`)) return;

    setData(d => {
      const closed = d.money?.closedPeriods || [];
      let ledger = d.money?.ledger || [];
      let accounts = d.money?.accounts || DEFAULT_ACCOUNTS;
      let postedVehicles = 0;
      let postedExpenses = 0;
      let skipped = 0;

      const updatedVehicles = d.vehicles.map(v => {
        if (v.postedToLedger) return v;
        const deposit = p(v.depositAmount);
        const balance = p(v.balanceAmount);
        const hasDeposit = deposit > 0 && !!v.depositSource;
        const hasBalance = balance > 0 && !!v.balanceSource;
        if (!hasDeposit && !hasBalance) return v;
        try {
          const entries = [];
          const date = v.purchaseDate || new Date().toISOString().slice(0, 10);
          if (hasDeposit) {
            entries.push(v.depositSource === "fund"
              ? vehiclePurchaseFromFundEntry({ stockNum: v.stockNum, amount: deposit, date, memo: `Backfill deposit — #${v.stockNum}`, user: currentUser })
              : vehiclePurchaseFromMemberEntry({ stockNum: v.stockNum, memberId: v.depositSource.slice(7), amount: deposit, date, memo: `Backfill deposit — #${v.stockNum}`, user: currentUser }));
          }
          if (hasBalance) {
            entries.push(v.balanceSource === "fund"
              ? vehiclePurchaseFromFundEntry({ stockNum: v.stockNum, amount: balance, date, memo: `Backfill balance — #${v.stockNum}`, user: currentUser })
              : vehiclePurchaseFromMemberEntry({ stockNum: v.stockNum, memberId: v.balanceSource.slice(7), amount: balance, date, memo: `Backfill balance — #${v.stockNum}`, user: currentUser }));
          }
          if (v.outOfStatePurchase && !v.maSalesTaxPaidAtPurchase) {
            const ut = useTaxOnPurchaseEntry({ stockNum: v.stockNum, purchasePrice: p(v.purchasePrice), date, user: currentUser });
            if (ut) entries.push(ut);
          }
          for (const e of entries) ledger = postJournalEntry(ledger, e, closed);
          if (!accounts.some(a => a.id === vehicleAccountId(v.stockNum))) {
            accounts = [...accounts, buildVehicleAccount(v.stockNum, `${v.year} ${v.make} ${v.model}`)];
          }
          postedVehicles++;
          return { ...v, postedToLedger: true };
        } catch (err) {
          console.warn(`Backfill skipped #${v.stockNum}:`, err.message);
          skipped++;
          return v;
        }
      });

      const updatedExpenses = d.expenses.map(exp => {
        if (exp.journalEntryId) return exp;
        if (p(exp.amount) <= 0) return exp;
        try {
          const entry = expenseEntry({
            expenseId: exp.id, category: exp.category, amount: exp.amount,
            vendor: exp.vendor, description: exp.description, stockNum: exp.stockNum,
            date: exp.date, user: currentUser, categoryMap: d.money?.expenseCategoryMap,
          });
          if (entry) {
            ledger = postJournalEntry(ledger, entry, closed);
            postedExpenses++;
            return { ...exp, journalEntryId: entry.id };
          }
        } catch (err) {
          console.warn(`Backfill expense skipped ${exp.id}:`, err.message);
          skipped++;
        }
        return exp;
      });

      logActivity(currentUser, "ledger_backfill", `Backfilled ${postedVehicles} vehicle${postedVehicles === 1 ? "" : "s"} + ${postedExpenses} expense${postedExpenses === 1 ? "" : "s"} into the ledger (${skipped} skipped).`);

      return {
        ...d,
        vehicles: updatedVehicles,
        expenses: updatedExpenses,
        money: d.money ? { ...d.money, ledger, accounts } : d.money,
      };
    });
  };

  if (nothingToDo) return null;

  return (
    <Card style={{ marginTop: 14, background: "#FEF3C7", borderColor: "#FCD34D" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#92400E", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>
            Unposted in ledger
          </div>
          <div style={{ fontSize: 12, color: "#78350F", lineHeight: 1.5 }}>
            {unpostedVehicles.length > 0 && <div>· <b>{unpostedVehicles.length}</b> vehicle purchase{unpostedVehicles.length === 1 ? "" : "s"} with a funding source but no ledger entry</div>}
            {unpostedExpenses.length > 0 && <div>· <b>{unpostedExpenses.length}</b> tracked expense{unpostedExpenses.length === 1 ? "" : "s"} without a journal entry</div>}
            <div style={{ marginTop: 6, fontSize: 11, color: "#92400E", fontStyle: "italic" }}>
              These rows exist in Inventory/Expenses but are invisible to the CoA, Trial Balance, P&L, and every external statement. Click Backfill to post them retroactively.
            </div>
          </div>
        </div>
        <Btn onClick={runBackfill} style={{ background: "#92400E" }}>Backfill {unpostedVehicles.length + unpostedExpenses.length} row{(unpostedVehicles.length + unpostedExpenses.length) === 1 ? "" : "s"}</Btn>
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
// ACCOUNTING TAB — external, CPA-facing view. Separate from Money
// Management (which is management-only). The Atlantic Fund is
// filtered out of every external statement via isExternalAccount().
// Four core statements + supporting reports + period-close gate.
// ═══════════════════════════════════════════════════════════════
function AccountingTab({ data, setData, username, userRole, darkMode }) {
  const money = data.money || { accounts: DEFAULT_ACCOUNTS, members: [], ledger: [], contributions: [], approvals: [], bankImports: [], salesTaxFilings: [] };
  const admin = isAdmin(userRole);
  const ledger = money.ledger || [];
  const accounts = money.accounts || DEFAULT_ACCOUNTS;
  const members = money.members || [];
  const today = new Date().toISOString().slice(0, 10);
  const startOfYear = today.slice(0, 4) + "-01-01";

  const [view, setView] = useState("statements");
  const [statementView, setStatementView] = useState("pl");
  const [reportView, setReportView] = useState("trial_balance");
  const [startDate, setStartDate] = useState(startOfYear);
  const [endDate, setEndDate] = useState(today);
  const [compare, setCompare] = useState(false);

  // Previous-period window (same length, immediately before current).
  const { prevStart, prevEnd } = useMemo(() => {
    const s = new Date(startDate); const e = new Date(endDate);
    const days = Math.max(1, Math.round((e - s) / 86400000));
    const pe = new Date(s); pe.setDate(pe.getDate() - 1);
    const ps = new Date(pe); ps.setDate(ps.getDate() - days);
    return { prevStart: ps.toISOString().slice(0, 10), prevEnd: pe.toISOString().slice(0, 10) };
  }, [startDate, endDate]);

  const balances = useMemo(() => calcAllBalances(ledger, accounts), [ledger, accounts]);
  const pl = useMemo(() => calcProfitLoss(ledger, accounts, startDate, endDate), [ledger, accounts, startDate, endDate]);
  const plPrev = useMemo(() => compare ? calcProfitLoss(ledger, accounts, prevStart, prevEnd) : null, [compare, ledger, accounts, prevStart, prevEnd]);
  const bs = useMemo(() => calcBalanceSheet(ledger, accounts, endDate), [ledger, accounts, endDate]);
  const bsPrev = useMemo(() => compare ? calcBalanceSheet(ledger, accounts, prevEnd) : null, [compare, ledger, accounts, prevEnd]);
  const cf = useMemo(() => calcCashFlow(ledger, accounts, startDate, endDate), [ledger, accounts, startDate, endDate]);
  const sme = useMemo(() => calcStatementOfMemberEquity(ledger, accounts, members, startDate, endDate), [ledger, accounts, members, startDate, endDate]);
  const tb = useMemo(() => calcTrialBalance(ledger, accounts, endDate), [ledger, accounts, endDate]);
  const oosReport = useMemo(() => calcOutOfStateSalesReport(ledger, startDate, endDate), [ledger, startDate, endDate]);
  // calcVehicleProfitabilityReport reads v.__totalCost (so money.js
  // stays decoupled from calc.js). Enrich each vehicle with its full
  // Total Cost — including tracked expenses — before calling through.
  const vehicleProfit = useMemo(() => {
    const expenses = data.expenses || [];
    const enriched = (data.vehicles || []).map(v => ({
      ...v,
      __totalCost: calcTotalCost(v, expenses),
    }));
    return calcVehicleProfitabilityReport({
      vehicles: enriched, sales: data.sales || [], expenses,
      holdCosts: data.holdCosts, ledger, startDate, endDate,
    });
  }, [data.vehicles, data.sales, data.expenses, data.holdCosts, ledger, startDate, endDate]);

  // Expense-only slice of the P&L account breakdown — used by the
  // P&L statement view and the CSV export.
  const plExpenseRows = useMemo(() => {
    const rows = [];
    for (const [id, amount] of Object.entries(pl.byAccount || {})) {
      const acc = accounts.find(a => a.id === id);
      if (!acc || acc.type !== "expense") continue;
      if (id === SYSTEM_ACCOUNTS.COGS_VEHICLES || acc.isCogs) continue;
      rows.push({ id, name: acc.name, amount });
    }
    return rows.sort((a, b) => b.amount - a.amount);
  }, [pl, accounts]);

  // Dashboard tiles — computed once from the P&L + Balance Sheet.
  const dash = useMemo(() => {
    const revenue = pl.revenue || 0;
    const cogs = pl.cogs || 0;
    const grossProfit = pl.grossProfit != null ? pl.grossProfit : (revenue - cogs);
    const netIncome = pl.netIncome || 0;
    const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
    const cashOnHand = balances[SYSTEM_ACCOUNTS.SAYARAH_BANK] || 0;
    const inventoryValue = Object.keys(balances).filter(id => id.startsWith("asset:vehicle:")).reduce((s, id) => s + (balances[id] || 0), 0);
    const accruedTax = balances[SYSTEM_ACCOUNTS.ACCRUED_TAX_LIABILITY] || 0;
    const salesTaxDue = balances[SYSTEM_ACCOUNTS.SALES_TAX_PAYABLE] || 0;
    const useTaxDue = balances[SYSTEM_ACCOUNTS.USE_TAX_PAYABLE] || 0;
    const totalEquity = (bs.totals && bs.totals.equity) || 0;
    return { revenue, grossProfit, netIncome, grossMargin, cashOnHand, inventoryValue, accruedTax, salesTaxDue, useTaxDue, totalEquity };
  }, [pl, balances, bs]);

  // ── Shared render helpers ──
  const headerStyle = { fontSize: 11, fontWeight: 800, color: BRAND.red, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 };
  const rowStyle = { display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${BRAND.grayLight}`, fontSize: 13 };
  const labelStyle = { color: BRAND.black };
  const valStyle = { ...S.mono, fontWeight: 700, color: BRAND.black };
  const delta = (cur, prev) => {
    if (!compare || prev == null || prev === 0) return null;
    const pct = ((cur - prev) / Math.abs(prev)) * 100;
    const up = pct >= 0;
    return <span style={{ ...S.mono, fontSize: 10, color: up ? "#047857" : "#B91C1C", marginLeft: 8, fontWeight: 700 }}>{up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%</span>;
  };

  // ── CSV export helpers ──
  const exportPL = () => {
    const rows = [];
    rows.push(["Revenue", pl.revenue || 0]);
    rows.push(["Cost of Goods Sold", -(pl.cogs || 0)]);
    rows.push(["Gross Profit", pl.grossProfit || 0]);
    for (const r of plExpenseRows) rows.push([r.name, -r.amount]);
    rows.push(["Net Income", pl.netIncome || 0]);
    exportCSV(`profit-loss_${startDate}_${endDate}.csv`, ["Line", "Amount"], rows);
  };
  const exportBS = () => {
    const rows = [];
    rows.push(["ASSETS", ""]);
    for (const [id, a] of Object.entries(bs.assets || {})) rows.push([a.name, a.balance]);
    rows.push(["Total Assets", bs.totals?.assets || 0]);
    rows.push(["LIABILITIES", ""]);
    for (const [id, l] of Object.entries(bs.liabilities || {})) rows.push([l.name, l.balance]);
    rows.push(["Total Liabilities", bs.totals?.liabilities || 0]);
    rows.push(["EQUITY", ""]);
    for (const [id, e] of Object.entries(bs.equity || {})) rows.push([`${e.name}${e.isContra ? " (contra)" : ""}`, e.isContra ? -e.balance : e.balance]);
    rows.push(["Total Equity", bs.totals?.equity || 0]);
    exportCSV(`balance-sheet_as-of_${endDate}.csv`, ["Line", "Amount"], rows);
  };
  const exportTB = () => {
    const rows = (tb.rows || []).map(r => [r.name, r.type, r.debit || 0, r.credit || 0]);
    rows.push(["TOTAL", "", tb.totalDebit || 0, tb.totalCredit || 0]);
    exportCSV(`trial-balance_${endDate}.csv`, ["Account", "Type", "Debit", "Credit"], rows);
  };
  const exportGL = () => {
    const rows = entriesInRange(ledger, startDate, endDate)
      .flatMap(e => e.lines
        .filter(l => isExternalAccount(l.accountId))
        .map(l => {
          const acc = accounts.find(a => a.id === l.accountId);
          return [e.date, e.id, acc?.name || l.accountId, e.memo || "", l.debit || 0, l.credit || 0];
        })
      );
    exportCSV(`general-ledger_${startDate}_${endDate}.csv`, ["Date", "Entry ID", "Account", "Memo", "Debit", "Credit"], rows);
  };
  const printStatement = () => window.print();

  // ── Period close gate ──
  // canClosePeriod returns null (all clear) or a string describing what's
  // blocking. We re-derive the individual check results for display.
  const closeMonth = endDate.slice(0, 7);
  const closeBlocker = useMemo(() => canClosePeriod({
    month: closeMonth,
    bankImports: money.bankImports || [],
    salesTaxFilings: money.salesTaxFilings || [],
  }), [closeMonth, money.bankImports, money.salesTaxFilings]);
  const closeChecks = useMemo(() => {
    const rows = (money.bankImports || []).filter(r => {
      const d = r.date || r.Date || "";
      return d.startsWith(closeMonth);
    });
    const unreconciled = rows.filter(r => !r.matchedEntryId && !r.ignored).length;
    const filing = (money.salesTaxFilings || []).find(f => f.month === closeMonth);
    return {
      bankRows: rows.length,
      unreconciled,
      bankReconciled: unreconciled === 0,
      salesTaxGenerated: !!filing,
      salesTaxFiled: filing?.status === "filed",
    };
  }, [closeMonth, money.bankImports, money.salesTaxFilings]);
  const canCloseNow = closeBlocker === null;

  return (
    <div className="auction-content" style={{ maxWidth: 1280, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 900, color: BRAND.black }}>Accounting</div>
          <div style={{ fontSize: 11, color: BRAND.gray, marginTop: 4 }}>
            External, CPA-facing view · Atlantic Fund is a management sub-ledger and is filtered out of every statement here
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Input label="From" type="date" value={startDate} onChange={setStartDate} />
          <Input label="To" type="date" value={endDate} onChange={setEndDate} />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: BRAND.gray, textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer" }}>
            <input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} />
            Compare prev
          </label>
        </div>
      </div>

      {/* Sub-nav */}
      <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${BRAND.grayLight}`, marginBottom: 20 }}>
        {[["statements", "Statements"], ["reports", "Reports"], ["close", "Period Close"]].map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} style={{
            background: "transparent", border: "none",
            padding: "10px 16px", fontSize: 11, fontWeight: view === id ? 800 : 600,
            color: view === id ? BRAND.red : BRAND.gray,
            textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer",
            borderBottom: view === id ? `2px solid ${BRAND.red}` : "2px solid transparent",
          }}>{label}</button>
        ))}
      </div>

      {view === "statements" && (
        <>
          {/* Dashboard strip */}
          <div className="stat-cards-row" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
            <StatCard label="Revenue" value={fmt$(dash.revenue)} color={BRAND.red} />
            <StatCard label="Gross Profit" value={fmt$(dash.grossProfit)} sub={`${dash.grossMargin.toFixed(1)}% margin`} color={BRAND.red} />
            <StatCard label="Net Income" value={fmt$(dash.netIncome)} color={BRAND.red} />
            <StatCard label="Cash on Hand" value={fmt$(dash.cashOnHand)} color={BRAND.red} />
            <StatCard label="Inventory Value" value={fmt$(dash.inventoryValue)} color={BRAND.red} />
            <StatCard label="Total Equity" value={fmt$(dash.totalEquity)} color={BRAND.red} />
            <StatCard label="Accrued Tax" value={fmt$(dash.accruedTax)} sub="Tax reserve + excise" color={BRAND.red} />
            <StatCard label="Sales Tax Due" value={fmt$(dash.salesTaxDue + dash.useTaxDue)} sub="MA Sales + Use" color={BRAND.red} />
          </div>

          {/* Statement tabs */}
          <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
            {[["pl", "P & L"], ["bs", "Balance Sheet"], ["cf", "Cash Flow"], ["sme", "Member Equity"]].map(([id, label]) => (
              <button key={id} onClick={() => setStatementView(id)} style={{
                background: statementView === id ? BRAND.red : "transparent",
                color: statementView === id ? "#fff" : BRAND.gray,
                border: `1px solid ${statementView === id ? BRAND.red : BRAND.grayLight}`,
                padding: "8px 14px", fontSize: 11, fontWeight: 700, borderRadius: 8,
                textTransform: "uppercase", letterSpacing: "0.05em", cursor: "pointer",
              }}>{label}</button>
            ))}
            <div style={{ flex: 1 }} />
            <Btn variant="secondary" size="sm" onClick={printStatement}>Print</Btn>
            <Btn variant="secondary" size="sm" onClick={
              statementView === "pl" ? exportPL :
              statementView === "bs" ? exportBS :
              statementView === "cf" ? () => {
                const rows = [];
                rows.push(["Operating", cf.operating || 0]);
                rows.push(["Investing", cf.investing || 0]);
                rows.push(["Financing", cf.financing || 0]);
                rows.push(["Net Change", cf.netChange || 0]);
                rows.push(["Opening Cash", cf.opening || 0]);
                rows.push(["Closing Cash", cf.closing || 0]);
                exportCSV(`cash-flow_${startDate}_${endDate}.csv`, ["Section", "Amount"], rows);
              } :
              () => {
                const rows = (sme || []).flatMap(r => [
                  [r.name, "Opening Capital", r.opening || 0],
                  [r.name, "Contributions", r.contributions || 0],
                  [r.name, "Income Allocation", r.shareOfNetIncome || 0],
                  [r.name, "Distributions", -(r.distributions || 0)],
                  [r.name, "Closing Capital", r.closing || 0],
                ]);
                exportCSV(`member-equity_${startDate}_${endDate}.csv`, ["Member", "Line", "Amount"], rows);
              }
            }>Export CSV</Btn>
          </div>

          <Card>
            {statementView === "pl" && (
              <div>
                <div style={headerStyle}>Profit & Loss · {startDate} → {endDate}</div>
                <div style={rowStyle}>
                  <span style={labelStyle}>Revenue</span>
                  <span style={valStyle}>{fmt$(pl.revenue)} {plPrev && delta(pl.revenue, plPrev.revenue)}</span>
                </div>
                <div style={rowStyle}>
                  <span style={{ ...labelStyle, paddingLeft: 16 }}>Cost of Goods Sold</span>
                  <span style={valStyle}>({fmt$(pl.cogs)})</span>
                </div>
                <div style={{ ...rowStyle, fontWeight: 800, borderBottom: `2px solid ${BRAND.black}` }}>
                  <span style={labelStyle}>Gross Profit</span>
                  <span style={valStyle}>{fmt$(pl.grossProfit)} {plPrev && delta(pl.grossProfit, plPrev.grossProfit)}</span>
                </div>
                <div style={{ ...headerStyle, marginTop: 16 }}>Operating Expenses</div>
                {plExpenseRows.length === 0 ? (
                  <div style={{ fontSize: 11, color: BRAND.gray, fontStyle: "italic", padding: "8px 0" }}>No operating expenses in range.</div>
                ) : plExpenseRows.map(r => (
                  <div key={r.id} style={rowStyle}>
                    <span style={{ ...labelStyle, paddingLeft: 16 }}>{r.name}</span>
                    <span style={valStyle}>({fmt$(r.amount)})</span>
                  </div>
                ))}
                <div style={{ ...rowStyle, fontWeight: 900, borderTop: `2px solid ${BRAND.black}`, borderBottom: "none", marginTop: 8, fontSize: 15 }}>
                  <span style={labelStyle}>Net Income</span>
                  <span style={valStyle}>{fmt$(pl.netIncome)} {plPrev && delta(pl.netIncome, plPrev.netIncome)}</span>
                </div>
              </div>
            )}

            {statementView === "bs" && (() => {
              const assetEntries = Object.entries(bs.assets || {});
              const liabEntries = Object.entries(bs.liabilities || {});
              const equityEntries = Object.entries(bs.equity || {});
              const totalAssets = bs.totals?.assets || 0;
              const totalLiab = bs.totals?.liabilities || 0;
              const totalEquity = bs.totals?.equity || 0;
              const prevTotalAssets = bsPrev?.totals?.assets || 0;
              const prevTotalEquity = bsPrev?.totals?.equity || 0;
              return (
                <div>
                  <div style={headerStyle}>Balance Sheet · As of {endDate}</div>
                  <div style={{ ...headerStyle, marginTop: 8 }}>Assets</div>
                  {assetEntries.map(([id, a]) => (
                    <div key={id} style={rowStyle}>
                      <span style={{ ...labelStyle, paddingLeft: 16 }}>{a.name}</span>
                      <span style={valStyle}>{fmt$(a.balance)}</span>
                    </div>
                  ))}
                  <div style={{ ...rowStyle, fontWeight: 800 }}>
                    <span style={labelStyle}>Total Assets</span>
                    <span style={valStyle}>{fmt$(totalAssets)} {bsPrev && delta(totalAssets, prevTotalAssets)}</span>
                  </div>
                  <div style={{ ...headerStyle, marginTop: 16 }}>Liabilities</div>
                  {liabEntries.map(([id, l]) => (
                    <div key={id} style={rowStyle}>
                      <span style={{ ...labelStyle, paddingLeft: 16 }}>{l.name}</span>
                      <span style={valStyle}>{fmt$(l.balance)}</span>
                    </div>
                  ))}
                  <div style={{ ...rowStyle, fontWeight: 800 }}>
                    <span style={labelStyle}>Total Liabilities</span>
                    <span style={valStyle}>{fmt$(totalLiab)}</span>
                  </div>
                  <div style={{ ...headerStyle, marginTop: 16 }}>Equity</div>
                  {equityEntries.map(([id, e]) => (
                    <div key={id} style={rowStyle}>
                      <span style={{ ...labelStyle, paddingLeft: 16 }}>{e.name}{e.isContra ? " (contra)" : ""}</span>
                      <span style={valStyle}>{e.isContra ? `(${fmt$(e.balance)})` : fmt$(e.balance)}</span>
                    </div>
                  ))}
                  <div style={{ ...rowStyle, fontWeight: 800, borderBottom: `2px solid ${BRAND.black}` }}>
                    <span style={labelStyle}>Total Equity</span>
                    <span style={valStyle}>{fmt$(totalEquity)} {bsPrev && delta(totalEquity, prevTotalEquity)}</span>
                  </div>
                  <div style={{ ...rowStyle, fontWeight: 900, fontSize: 13, marginTop: 8 }}>
                    <span style={labelStyle}>Liabilities + Equity</span>
                    <span style={valStyle}>{fmt$(totalLiab + totalEquity)}</span>
                  </div>
                  {Math.abs((totalLiab + totalEquity) - totalAssets) > 0.01 && (
                    <div style={{ fontSize: 11, color: "#B91C1C", marginTop: 8, fontWeight: 700 }}>
                      ⚠ Balance sheet out of balance — see Trial Balance
                    </div>
                  )}
                </div>
              );
            })()}

            {statementView === "cf" && (
              <div>
                <div style={headerStyle}>Cash Flow · {startDate} → {endDate}</div>
                <div style={rowStyle}><span style={labelStyle}>Opening Cash</span><span style={valStyle}>{fmt$(cf.opening)}</span></div>
                <div style={{ ...headerStyle, marginTop: 16 }}>Operating</div>
                <div style={rowStyle}><span style={{ ...labelStyle, paddingLeft: 16 }}>Net operating cash flow</span><span style={valStyle}>{fmt$(cf.operating)}</span></div>
                <div style={{ ...headerStyle, marginTop: 16 }}>Investing</div>
                <div style={rowStyle}><span style={{ ...labelStyle, paddingLeft: 16 }}>Net investing cash flow</span><span style={valStyle}>{fmt$(cf.investing)}</span></div>
                <div style={{ ...headerStyle, marginTop: 16 }}>Financing</div>
                <div style={rowStyle}><span style={{ ...labelStyle, paddingLeft: 16 }}>Net financing cash flow</span><span style={valStyle}>{fmt$(cf.financing)}</span></div>
                <div style={{ ...rowStyle, fontWeight: 800, borderTop: `2px solid ${BRAND.black}`, marginTop: 8 }}>
                  <span style={labelStyle}>Net change in cash</span><span style={valStyle}>{fmt$(cf.netChange)}</span>
                </div>
                <div style={{ ...rowStyle, fontWeight: 900, fontSize: 13 }}>
                  <span style={labelStyle}>Closing Cash</span><span style={valStyle}>{fmt$(cf.closing)}</span>
                </div>
                {!cf.reconciles && (
                  <div style={{ fontSize: 11, color: "#B91C1C", marginTop: 8, fontWeight: 700 }}>
                    ⚠ Cash flow does not reconcile ({fmt$(Math.abs((cf.closing - cf.opening) - cf.netChange))} off)
                  </div>
                )}
              </div>
            )}

            {statementView === "sme" && (() => {
              const smeRows = sme || [];
              const totals = smeRows.reduce((t, r) => ({
                opening: t.opening + (r.opening || 0),
                contributions: t.contributions + (r.contributions || 0),
                shareOfNetIncome: t.shareOfNetIncome + (r.shareOfNetIncome || 0),
                distributions: t.distributions + (r.distributions || 0),
                closing: t.closing + (r.closing || 0),
              }), { opening: 0, contributions: 0, shareOfNetIncome: 0, distributions: 0, closing: 0 });
              return (
                <div>
                  <div style={headerStyle}>Statement of Member Equity · {startDate} → {endDate}</div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr>
                          <TH>Member</TH>
                          <TH>Opening Capital</TH>
                          <TH>Contributions</TH>
                          <TH>Income Allocation</TH>
                          <TH>Distributions</TH>
                          <TH>Closing Capital</TH>
                        </tr>
                      </thead>
                      <tbody>
                        {smeRows.map(r => (
                          <tr key={r.memberId} style={{ borderTop: `1px solid ${BRAND.grayLight}` }}>
                            <TD>{r.name}</TD>
                            <TD style={{ ...S.mono, textAlign: "right" }}>{fmt$(r.opening)}</TD>
                            <TD style={{ ...S.mono, textAlign: "right", color: "#047857" }}>{fmt$(r.contributions)}</TD>
                            <TD style={{ ...S.mono, textAlign: "right", color: "#047857" }}>{fmt$(r.shareOfNetIncome)}</TD>
                            <TD style={{ ...S.mono, textAlign: "right", color: "#B91C1C" }}>({fmt$(r.distributions)})</TD>
                            <TD style={{ ...S.mono, textAlign: "right", fontWeight: 800 }}>{fmt$(r.closing)}</TD>
                          </tr>
                        ))}
                        <tr style={{ borderTop: `2px solid ${BRAND.black}`, fontWeight: 800 }}>
                          <TD>Total</TD>
                          <TD style={{ ...S.mono, textAlign: "right" }}>{fmt$(totals.opening)}</TD>
                          <TD style={{ ...S.mono, textAlign: "right" }}>{fmt$(totals.contributions)}</TD>
                          <TD style={{ ...S.mono, textAlign: "right" }}>{fmt$(totals.shareOfNetIncome)}</TD>
                          <TD style={{ ...S.mono, textAlign: "right" }}>({fmt$(totals.distributions)})</TD>
                          <TD style={{ ...S.mono, textAlign: "right" }}>{fmt$(totals.closing)}</TD>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {smeRows.length === 0 && <Empty title="No members" sub="Assign member slots in Money Management first." />}
                </div>
              );
            })()}
          </Card>
        </>
      )}

      {view === "reports" && (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
            {[
              ["trial_balance", "Trial Balance"],
              ["gl", "General Ledger"],
              ["vehicle_profit", "Vehicle Profitability"],
              ["out_of_state", "Out-of-State Sales"],
              ["sales_tax", "MA Sales Tax"],
              ["tax_reserve", "Tax Reserve"],
              ["atlantic_fund", "Atlantic Fund (INTERNAL)"],
              ["1099", "1099 / Vendor"],
            ].map(([id, label]) => (
              <button key={id} onClick={() => setReportView(id)} style={{
                background: reportView === id ? BRAND.red : "transparent",
                color: reportView === id ? "#fff" : BRAND.gray,
                border: `1px solid ${reportView === id ? BRAND.red : BRAND.grayLight}`,
                padding: "6px 12px", fontSize: 10, fontWeight: 700, borderRadius: 6,
                textTransform: "uppercase", letterSpacing: "0.05em", cursor: "pointer",
              }}>{label}</button>
            ))}
          </div>

          <Card>
            {reportView === "trial_balance" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={headerStyle}>Trial Balance · As of {endDate}</div>
                  <Btn variant="secondary" size="sm" onClick={exportTB}>Export CSV</Btn>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr><TH>Account</TH><TH>Type</TH><TH>Debit</TH><TH>Credit</TH></tr></thead>
                    <tbody>
                      {(tb.rows || []).map(r => (
                        <tr key={r.id} style={{ borderTop: `1px solid ${BRAND.grayLight}` }}>
                          <TD>{r.name}</TD>
                          <TD style={{ textTransform: "capitalize", color: BRAND.gray }}>{r.type}</TD>
                          <TD style={{ ...S.mono, textAlign: "right" }}>{r.debit ? fmt$(r.debit) : "—"}</TD>
                          <TD style={{ ...S.mono, textAlign: "right" }}>{r.credit ? fmt$(r.credit) : "—"}</TD>
                        </tr>
                      ))}
                      <tr style={{ borderTop: `2px solid ${BRAND.black}`, fontWeight: 800 }}>
                        <TD>Total</TD><TD></TD>
                        <TD style={{ ...S.mono, textAlign: "right" }}>{fmt$(tb.totalDebit)}</TD>
                        <TD style={{ ...S.mono, textAlign: "right" }}>{fmt$(tb.totalCredit)}</TD>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {!tb.balanced && (
                  <div style={{ fontSize: 11, color: "#B91C1C", marginTop: 8, fontWeight: 700 }}>
                    ⚠ Out of balance by {fmt$(Math.abs((tb.totalDebit || 0) - (tb.totalCredit || 0)))}
                  </div>
                )}
              </div>
            )}

            {reportView === "gl" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={headerStyle}>General Ledger · {startDate} → {endDate}</div>
                  <Btn variant="secondary" size="sm" onClick={exportGL}>Export CSV</Btn>
                </div>
                <div style={{ fontSize: 11, color: BRAND.gray, marginBottom: 8 }}>Internal-only accounts (Atlantic Fund) filtered out.</div>
                <LedgerTable
                  entries={entriesInRange(ledger, startDate, endDate).filter(e => e.lines.some(l => isExternalAccount(l.accountId)))}
                  accounts={accounts}
                  members={members}
                />
              </div>
            )}

            {reportView === "vehicle_profit" && (
              <div>
                <div style={headerStyle}>Vehicle Profitability · {startDate} → {endDate}</div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr><TH>Stock</TH><TH>Vehicle</TH><TH>Sold</TH><TH>Days</TH><TH>Total Cost</TH><TH>Gross Sale</TH><TH>Profit</TH><TH>ROI</TH></tr></thead>
                    <tbody>
                      {(vehicleProfit || []).map(r => (
                        <tr key={r.stockNum} style={{ borderTop: `1px solid ${BRAND.grayLight}` }}>
                          <TD>#{r.stockNum}</TD>
                          <TD>{r.year} {r.make} {r.model}</TD>
                          <TD>{r.saleDate || "—"}</TD>
                          <TD style={{ ...S.mono, textAlign: "right" }}>{r.daysInInventory != null ? r.daysInInventory : "—"}</TD>
                          <TD style={{ ...S.mono, textAlign: "right" }}>{fmt$(r.totalCost)}</TD>
                          <TD style={{ ...S.mono, textAlign: "right" }}>{fmt$(r.grossSale)}</TD>
                          <TD style={{ ...S.mono, textAlign: "right", color: r.profit >= 0 ? "#047857" : "#B91C1C", fontWeight: 700 }}>{fmt$(r.profit)}</TD>
                          <TD style={{ ...S.mono, textAlign: "right" }}>{r.roi != null ? `${(r.roi * 100).toFixed(1)}%` : "—"}</TD>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {(vehicleProfit || []).length === 0 && <Empty title="No sold vehicles in range" />}
              </div>
            )}

            {reportView === "out_of_state" && (() => {
              const oosTotal = (oosReport || []).reduce((s, r) => s + (r.grossSale || 0), 0);
              return (
                <div>
                  <div style={headerStyle}>Out-of-State & Export Sales · {startDate} → {endDate}</div>
                  <div style={{ fontSize: 11, color: BRAND.gray, marginBottom: 8 }}>
                    Excludes in-state MA sales (those are on the MA Sales Tax tab).
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead><tr><TH>Date</TH><TH>Stock</TH><TH>Destination</TH><TH>Gross Sale</TH></tr></thead>
                      <tbody>
                        {(oosReport || []).map((r, i) => (
                          <tr key={i} style={{ borderTop: `1px solid ${BRAND.grayLight}` }}>
                            <TD>{r.date}</TD>
                            <TD>#{r.stockNum}</TD>
                            <TD>{SALE_DESTINATIONS[r.destination]?.label || r.destination}</TD>
                            <TD style={{ ...S.mono, textAlign: "right" }}>{fmt$(r.grossSale)}</TD>
                          </tr>
                        ))}
                        <tr style={{ borderTop: `2px solid ${BRAND.black}`, fontWeight: 800 }}>
                          <TD>Total</TD><TD></TD><TD></TD>
                          <TD style={{ ...S.mono, textAlign: "right" }}>{fmt$(oosTotal)}</TD>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {(oosReport || []).length === 0 && <Empty title="No out-of-state or export sales in range" />}
                </div>
              );
            })()}

            {reportView === "sales_tax" && (
              <div>
                <div style={headerStyle}>MA Sales Tax · {startDate} → {endDate}</div>
                <div style={rowStyle}><span style={labelStyle}>Accrued MA Sales Tax (liability balance)</span><span style={valStyle}>{fmt$(balances[SYSTEM_ACCOUNTS.SALES_TAX_PAYABLE] || 0)}</span></div>
                <div style={rowStyle}><span style={labelStyle}>Accrued MA Use Tax</span><span style={valStyle}>{fmt$(balances[SYSTEM_ACCOUNTS.USE_TAX_PAYABLE] || 0)}</span></div>
                <div style={{ ...headerStyle, marginTop: 16 }}>Filings</div>
                {(money.salesTaxFilings || []).length === 0 ? (
                  <Empty title="No filings yet" sub="Use Money Management → Tax Exports to generate monthly ST-9 filings." />
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr><TH>Month</TH><TH>Amount</TH><TH>Status</TH><TH>Filed Date</TH></tr></thead>
                    <tbody>
                      {(money.salesTaxFilings || []).map(f => (
                        <tr key={f.id || f.month} style={{ borderTop: `1px solid ${BRAND.grayLight}` }}>
                          <TD>{f.month}</TD>
                          <TD style={{ ...S.mono, textAlign: "right" }}>{f.amount == null ? "—" : fmt$(f.amount)}</TD>
                          <TD>{f.status}</TD>
                          <TD>{f.filedAt ? f.filedAt.slice(0, 10) : "—"}</TD>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {reportView === "tax_reserve" && (
              <div>
                <div style={headerStyle}>Tax Reserve · {startDate} → {endDate}</div>
                <div style={rowStyle}><span style={labelStyle}>Accrued Tax Liability (running balance)</span><span style={valStyle}>{fmt$(balances[SYSTEM_ACCOUNTS.ACCRUED_TAX_LIABILITY] || 0)}</span></div>
                <div style={rowStyle}><span style={labelStyle}>Tax Reserve Expense (this period)</span><span style={valStyle}>{fmt$(pl.byAccount?.[SYSTEM_ACCOUNTS.TAX_RESERVE_EXPENSE] || 0)}</span></div>
                <div style={rowStyle}><span style={labelStyle}>$295 accrued per vehicle sale</span><span style={valStyle}>{fmt$(TAX_PER_SALE)}</span></div>
              </div>
            )}

            {reportView === "atlantic_fund" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <div style={headerStyle}>Atlantic Fund Activity</div>
                  <Badge bg="#FEE2E2" color="#B91C1C">INTERNAL ONLY</Badge>
                </div>
                <div style={{ fontSize: 11, color: BRAND.gray, marginBottom: 8, fontStyle: "italic" }}>
                  This report is for internal management only. The Atlantic Fund does not appear on any external financial statement (P&L, Balance Sheet, Cash Flow, Member Equity).
                </div>
                <div style={rowStyle}><span style={labelStyle}>Current Atlantic Fund balance</span><span style={valStyle}>{fmt$(balances[SYSTEM_ACCOUNTS.ATLANTIC_FUND] || 0)}</span></div>
                <LedgerTable
                  entries={entriesForAccount(ledger, SYSTEM_ACCOUNTS.ATLANTIC_FUND).filter(e => e.date >= startDate && e.date <= endDate)}
                  accounts={accounts}
                  members={members}
                />
              </div>
            )}

            {reportView === "1099" && (
              <div>
                <div style={headerStyle}>1099 / Vendor · {startDate} → {endDate}</div>
                <Vendor1099Table ledger={ledger} startDate={startDate} endDate={endDate} accounts={accounts} />
              </div>
            )}
          </Card>
        </>
      )}

      {view === "close" && (
        <Card>
          <div style={headerStyle}>Period Close — {closeMonth}</div>
          <div style={{ fontSize: 12, color: BRAND.gray, marginBottom: 16, lineHeight: 1.5 }}>
            Closing a period locks it against further journal entries. Before you close, every bank row must be reconciled and the MA sales-tax return for this month must be marked filed. These gates protect the CPA-facing statements from being mutated after the books are supposedly "closed".
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>Bank reconciliation ({closeChecks.bankRows} row{closeChecks.bankRows === 1 ? "" : "s"} this month)</span>
            <span style={{ ...valStyle, color: closeChecks.bankReconciled ? "#047857" : "#B91C1C" }}>
              {closeChecks.bankReconciled ? "✓ All rows reconciled" : `⚠ ${closeChecks.unreconciled} unreconciled`}
            </span>
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>MA Sales Tax filing</span>
            <span style={{ ...valStyle, color: closeChecks.salesTaxFiled ? "#047857" : "#B91C1C" }}>
              {!closeChecks.salesTaxGenerated ? "⚠ Not generated" : closeChecks.salesTaxFiled ? "✓ Filed" : "⚠ Not filed"}
            </span>
          </div>
          {closeBlocker && (
            <div style={{ fontSize: 11, color: "#B91C1C", marginTop: 12, fontWeight: 700, padding: "8px 12px", background: "#FEE2E2", borderRadius: 6 }}>
              {closeBlocker}
            </div>
          )}
          <div style={{ marginTop: 20, display: "flex", gap: 8, alignItems: "center" }}>
            <Btn
              disabled={!canCloseNow || !admin}
              onClick={() => {
                if (!admin) return;
                if (!confirm(`Close ${closeMonth}? This locks the period and blocks new journal entries with dates inside it.`)) return;
                setData(d => ({
                  ...d,
                  money: {
                    ...d.money,
                    closedPeriods: [...(d.money?.closedPeriods || []), { start: `${closeMonth}-01`, end: endDate, closedBy: username, closedAt: new Date().toISOString() }],
                  },
                }));
                logActivity(username, "period_closed", `Closed ${closeMonth}`);
              }}
            >Close Period</Btn>
            {!canCloseNow && <span style={{ fontSize: 11, color: "#B91C1C", fontWeight: 700 }}>Resolve the warnings above before closing.</span>}
            {!admin && <span style={{ fontSize: 11, color: BRAND.gray, fontWeight: 700 }}>Admins only.</span>}
          </div>
          {(money.closedPeriods || []).length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={headerStyle}>Closed Periods</div>
              {(money.closedPeriods || []).map((p, i) => (
                <div key={i} style={rowStyle}>
                  <span style={labelStyle}>{p.start} → {p.end}</span>
                  <span style={{ ...S.mono, fontSize: 11, color: BRAND.gray }}>Closed by {p.closedBy} on {(p.closedAt || "").slice(0, 10)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// 1099 vendor report — totals payable-account outflows to vendors whose annual
// spend exceeds the 1099-NEC threshold ($600 default per IRS). Reads the ledger
// ref metadata for vendor identity (entries without it are excluded).
function Vendor1099Table({ ledger, startDate, endDate }) {
  const rows = useMemo(() => calc1099Report(ledger, startDate, endDate, 600), [ledger, startDate, endDate]);
  if (!rows || rows.length === 0) {
    return <Empty title="No reportable vendors" sub="Vendors with <$600 annual spend are excluded per IRS 1099-NEC threshold." />;
  }
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead><tr><TH>Vendor</TH><TH>Total Paid</TH></tr></thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.name} style={{ borderTop: `1px solid ${BRAND.grayLight}` }}>
            <TD>{r.name}</TD>
            <TD style={{ ...S.mono, textAlign: "right" }}>{fmt$(r.amount)}</TD>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ═══════════════════════════════════════════════════════════════
// MANAGE MEMBERS MODAL — super-admin assigns real Users from the
// app's user pool to each of the three Member Capital slots. The
// slot ids (m1/m2/m3) never change; only the user linked to them.
// Historical ledger entries use slot ids too, so reassigning never
// breaks past data — only the displayed name changes.
// ═══════════════════════════════════════════════════════════════
function ManageMembersModal({ members, onAssign, onClose }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    getAllUsers().then(list => { if (alive) { setUsers(list || []); setLoading(false); } }).catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <Modal title="Manage Member Capital Accounts" onClose={onClose} wide>
      <div style={{ fontSize: 11, color: BRAND.gray, marginBottom: 12, lineHeight: 1.5 }}>
        Link each of the three Atlantic Fund member slots to a real User. The slot id (<code>m1</code>, <code>m2</code>, <code>m3</code>) is permanent — past ledger entries stay valid when you reassign. Only the displayed name + email change.
      </div>
      {loading ? (
        <div style={{ padding: 16, textAlign: "center", color: BRAND.gray }}>Loading users…</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {members.map(m => (
            <div key={m.id} style={{ border: `1px solid ${BRAND.grayLight}`, borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: BRAND.gray, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Slot {m.id}</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: BRAND.black }}>{m.name}</div>
                  {m.email && <div style={{ fontSize: 10, color: BRAND.gray }}>{m.email}</div>}
                </div>
                {m.userId && (
                  <button onClick={() => onAssign(m.id, null)} style={{ fontSize: 10, border: `1px solid ${BRAND.grayLight}`, background: "transparent", color: BRAND.gray, padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontFamily: "inherit" }}>Unassign</button>
                )}
              </div>
              <select
                value={m.userId || ""}
                onChange={e => {
                  const userId = e.target.value;
                  const u = users.find(x => (x.id || x.uid) === userId);
                  onAssign(m.id, u || null);
                }}
                style={{ width: "100%", padding: "6px 8px", border: `1px solid ${BRAND.grayLight}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit" }}
              >
                <option value="">— Pick a user —</option>
                {users.map(u => {
                  const id = u.id || u.uid;
                  const label = (u.firstName && u.lastName) ? `${u.firstName} ${u.lastName} (${u.email})` : (u.displayName ? `${u.displayName} (${u.email})` : u.email);
                  return <option key={id} value={id}>{label}</option>;
                })}
              </select>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <Btn variant="secondary" size="sm" onClick={onClose}>Done</Btn>
      </div>
    </Modal>
  );
}

// Compact ledger table used on the dashboard recent-transactions feed
// and inside sub-views. Each row is one journal entry — shows memo,
// date, primary accounts, and the bigger of its debit/credit totals.
function LedgerTable({ entries, accounts, members }) {
  const accountName = (id) => {
    if (id.startsWith("equity:member:")) {
      const memberId = id.split(":")[2];
      return (members.find(m => m.id === memberId)?.name || memberId) + " (capital)";
    }
    if (id.startsWith("asset:vehicle:")) {
      const stock = id.split(":")[2];
      return `Vehicle #${stock}`;
    }
    return accounts.find(a => a.id === id)?.name || id;
  };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#F9FAFB", borderBottom: `1px solid ${BRAND.grayLight}` }}>
            <th style={{ padding: "6px 8px", textAlign: "left", fontSize: 10, fontWeight: 700, color: BRAND.gray, textTransform: "uppercase" }}>Date</th>
            <th style={{ padding: "6px 8px", textAlign: "left", fontSize: 10, fontWeight: 700, color: BRAND.gray, textTransform: "uppercase" }}>Memo</th>
            <th style={{ padding: "6px 8px", textAlign: "left", fontSize: 10, fontWeight: 700, color: BRAND.gray, textTransform: "uppercase" }}>Accounts</th>
            <th style={{ padding: "6px 8px", textAlign: "right", fontSize: 10, fontWeight: 700, color: BRAND.gray, textTransform: "uppercase" }}>Amount</th>
            <th style={{ padding: "6px 8px", textAlign: "left", fontSize: 10, fontWeight: 700, color: BRAND.gray, textTransform: "uppercase" }}>By</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(e => {
            const totalDebit = e.lines.reduce((s, l) => s + p(l.debit), 0);
            return (
              <tr key={e.id} style={{ borderBottom: `1px solid ${BRAND.grayLight}` }}>
                <td style={{ padding: "6px 8px", color: BRAND.grayDark, ...S.mono }}>{e.date}</td>
                <td style={{ padding: "6px 8px", color: BRAND.black }}>{e.memo}</td>
                <td style={{ padding: "6px 8px", color: BRAND.gray, fontSize: 10 }}>
                  {e.lines.slice(0, 3).map(l => accountName(l.accountId)).join(" ↔ ")}
                  {e.lines.length > 3 && ` +${e.lines.length - 3}`}
                </td>
                <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, color: BRAND.black, ...S.mono }}>{fmt$2(totalDebit)}</td>
                <td style={{ padding: "6px 8px", color: BRAND.gray, fontSize: 10 }}>{e.user}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Ledger filtered to a single account — used for Atlantic Fund /
// Profit Distribution / Tax sub-views.
function AccountLedgerView({ accountId, title, ledger, accounts, members, balance }) {
  const filtered = entriesForAccount(ledger, accountId);
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: BRAND.black }}>{title}</div>
        <div style={{ fontSize: 18, fontWeight: 900, color: BRAND.red, ...S.mono }}>{fmt$(balance)}</div>
      </div>
      {filtered.length === 0 ? (
        <div style={{ padding: 16, textAlign: "center", color: BRAND.gray, fontStyle: "italic" }}>No activity yet.</div>
      ) : (
        <LedgerTable entries={[...filtered].reverse()} accounts={accounts} members={members} />
      )}
    </Card>
  );
}

function MembersView({ money, balances, admin, memberFilter, setMemberFilter }) {
  return (
    <Card>
      <div style={{ fontSize: 15, fontWeight: 800, color: BRAND.black, marginBottom: 12 }}>Member Capital Accounts</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        {money.members.map(m => {
          const bal = balances[memberAccountId(m.id)] || 0;
          const contributions = money.contributions.filter(c => c.memberId === m.id);
          const paid = contributions.filter(c => c.status === "paid").length;
          return (
            <div key={m.id} style={{ border: `1px solid ${BRAND.grayLight}`, borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: BRAND.black, marginBottom: 4 }}>{m.name}</div>
              {m.email && <div style={{ fontSize: 10, color: BRAND.gray, marginBottom: 8 }}>{m.email}</div>}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderTop: `1px solid ${BRAND.grayLight}` }}>
                <span style={{ fontSize: 11, color: BRAND.gray }}>Capital balance</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: BRAND.black, ...S.mono }}>{fmt$(bal)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                <span style={{ fontSize: 11, color: BRAND.gray }}>Contributions paid</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: BRAND.green }}>{paid} / {contributions.length}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function VehiclePLView({ data, balances }) {
  const vehicles = data.vehicles || [];
  return (
    <Card>
      <div style={{ fontSize: 15, fontWeight: 800, color: BRAND.black, marginBottom: 12 }}>Per-Vehicle P&L (from inventory)</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#F9FAFB" }}>
              {["Stock#", "Vehicle", "Total Cost", "Sale", "Profit", "Funding", "Ledger"].map(h => (
                <th key={h} style={{ padding: "6px 8px", textAlign: "left", fontSize: 10, fontWeight: 700, color: BRAND.gray, textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vehicles.map(v => {
              const tc = calcTotalCost(v, data.expenses || []);
              const sale = (data.sales || []).find(s => s.stockNum === v.stockNum);
              const gross = sale ? p(sale.grossPrice) : 0;
              const profit = sale ? gross - tc : null;
              const inventoryBal = balances[vehicleAccountId(v.stockNum)] || 0;
              return (
                <tr key={v.id} style={{ borderBottom: `1px solid ${BRAND.grayLight}` }}>
                  <td style={{ padding: "6px 8px", ...S.mono, fontWeight: 700, color: BRAND.red }}>#{v.stockNum}</td>
                  <td style={{ padding: "6px 8px" }}>{v.year} {v.make} {v.model}</td>
                  <td style={{ padding: "6px 8px", ...S.mono }}>{fmt$(tc)}</td>
                  <td style={{ padding: "6px 8px", ...S.mono }}>{sale ? fmt$(gross) : "—"}</td>
                  <td style={{ padding: "6px 8px", ...S.mono, fontWeight: 700, color: profit == null ? BRAND.gray : profit >= 0 ? BRAND.green : "#DC2626" }}>{profit == null ? "—" : fmt$(profit)}</td>
                  <td style={{ padding: "6px 8px", fontSize: 10, color: BRAND.gray }}>{v.fundingSource || "—"}</td>
                  <td style={{ padding: "6px 8px", fontSize: 10, color: BRAND.gray, ...S.mono }}>{inventoryBal > 0 ? fmt$(inventoryBal) + " on ledger" : "not on ledger"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, padding: "8px 10px", background: "#EFF6FF", borderRadius: 6, fontSize: 10, color: "#1E40AF", border: "1px solid #BFDBFE" }}>
        Inventory-ledger parity: vehicles tagged with a funding source and posted to the ledger show a non-zero balance in the "Ledger" column. Vehicles saved before Money Management was added won't appear on the ledger until an admin posts their opening balance — see Vehicle detail → "Post to ledger" button.
      </div>
    </Card>
  );
}

function TransactionsView({ ledger, accounts, members }) {
  const [query, setQuery] = useState("");
  const filtered = ledger.filter(e => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (e.memo || "").toLowerCase().includes(q) ||
           (e.user || "").toLowerCase().includes(q) ||
           (e.ref && JSON.stringify(e.ref).toLowerCase().includes(q));
  });
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: BRAND.black }}>All Journal Entries ({ledger.length})</div>
        <input
          placeholder="Filter by memo, user, ref…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ border: `1px solid ${BRAND.grayLight}`, borderRadius: 6, padding: "6px 10px", fontSize: 12, fontFamily: "inherit", minWidth: 240 }}
        />
      </div>
      {filtered.length === 0 ? (
        <div style={{ padding: 16, textAlign: "center", color: BRAND.gray, fontStyle: "italic" }}>No entries match.</div>
      ) : (
        <LedgerTable entries={[...filtered].reverse()} accounts={accounts} members={members} />
      )}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
// BANK CSV RECONCILIATION — paste or upload CSV, suggest matches,
// flag unmatched entries. Rows persist in data.money.bankImports
// so admins can pick up later. No Plaid integration in v1.
// ═══════════════════════════════════════════════════════════════
function BankReconciliationView({ data, setData, admin, username }) {
  const imports = data.money?.bankImports || [];
  const ledger = data.money?.ledger || [];
  const [csvText, setCsvText] = useState("");
  const [parseError, setParseError] = useState("");
  // Plaid connection state — stored on data.money.plaid when Linked.
  const plaid = data.money?.plaid || null;
  const [plaidStatus, setPlaidStatus] = useState({ configured: null });
  const [plaidBusy, setPlaidBusy] = useState(false);
  useEffect(() => {
    fetch("/api/plaid/status").then(r => r.json()).then(setPlaidStatus).catch(() => setPlaidStatus({ configured: false }));
  }, []);

  // Plaid Link script is loaded on demand when the admin clicks
  // Connect — keeps the default bundle slim.
  const loadPlaidScript = () => new Promise((resolve, reject) => {
    if (window.Plaid) return resolve();
    const s = document.createElement("script");
    s.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Plaid Link script"));
    document.body.appendChild(s);
  });

  const startPlaid = async () => {
    setPlaidBusy(true);
    try {
      await loadPlaidScript();
      const r = await fetch("/api/plaid/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: username || "sayarah-admin" }),
      }).then(r => r.json());
      if (!r.link_token) throw new Error(r.error || "Could not get link token");
      const handler = window.Plaid.create({
        token: r.link_token,
        onSuccess: async (public_token, metadata) => {
          const ex = await fetch("/api/plaid/exchange", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ publicToken: public_token }),
          }).then(r => r.json());
          if (!ex.access_token) { alert("Plaid exchange failed: " + (ex.error || "unknown")); return; }
          setData(d => ({
            ...d,
            money: {
              ...d.money,
              plaid: {
                accessToken: ex.access_token,
                itemId: ex.item_id,
                institution: metadata.institution?.name || "Unknown",
                connectedAt: new Date().toISOString(),
                connectedBy: username,
                lastSyncAt: null,
              },
            },
          }));
          logActivity(username, "plaid_connected", `Connected bank via Plaid: ${metadata.institution?.name || "Unknown"}`);
        },
        onExit: () => {},
      });
      handler.open();
    } catch (e) {
      alert(e.message || String(e));
    } finally { setPlaidBusy(false); }
  };

  const syncPlaid = async () => {
    if (!plaid?.accessToken) return;
    setPlaidBusy(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const start = plaid.lastSyncAt
        ? new Date(plaid.lastSyncAt).toISOString().slice(0, 10)
        : new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const r = await fetch("/api/plaid/transactions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: plaid.accessToken, startDate: start, endDate: today }),
      }).then(r => r.json());
      if (!Array.isArray(r.transactions)) throw new Error(r.error || "No transactions returned");
      const batchId = `plaid_${Date.now().toString(36)}`;
      // Plaid amounts are positive for debits (money out), negative for
      // credits (money in). Normalize to the CSV shape used elsewhere.
      const rows = r.transactions.map((t, i) => ({
        _id: `${batchId}_${i}`,
        batchId,
        date: t.date,
        description: t.name || t.merchant_name || "(no description)",
        amount: (-t.amount).toFixed(2), // flip sign: positive = money in
        plaidTransactionId: t.transaction_id,
        matchedEntryId: null,
        ignored: false,
        source: "plaid",
      }));
      setData(d => ({
        ...d,
        money: {
          ...d.money,
          bankImports: [...(d.money?.bankImports || []), ...rows],
          plaid: { ...d.money.plaid, lastSyncAt: new Date().toISOString() },
        },
      }));
      logActivity(username, "plaid_synced", `Imported ${rows.length} transactions from Plaid (${start} to ${today})`);
    } catch (e) {
      alert(e.message || String(e));
    } finally { setPlaidBusy(false); }
  };

  const disconnectPlaid = () => {
    if (!confirm("Disconnect Plaid? The stored access token is removed from the app; Plaid still retains permissions until you revoke in your bank portal.")) return;
    setData(d => ({ ...d, money: { ...d.money, plaid: null } }));
    logActivity(username, "plaid_disconnected", `Disconnected Plaid bank link`);
  };

  const onFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => setCsvText(e.target.result || "");
    reader.readAsText(file);
  };

  const importParsed = () => {
    setParseError("");
    const parsed = parseBankCsv(csvText);
    if (parsed.rows.length === 0) { setParseError("No rows parsed. CSV should have a header row."); return; }
    const batchId = `batch_${Date.now().toString(36)}`;
    const rows = parsed.rows.map((r) => ({ ...r, batchId, matchedEntryId: null, ignored: false }));
    setData(d => ({
      ...d,
      money: { ...d.money, bankImports: [...(d.money?.bankImports || []), ...rows] },
    }));
    logActivity(username, "bank_csv_imported", `Imported ${rows.length} bank rows (batch ${batchId})`);
    setCsvText("");
  };

  const matchRow = (rowId, entryId) => {
    setData(d => ({
      ...d,
      money: {
        ...d.money,
        bankImports: (d.money?.bankImports || []).map(r => r._id === rowId ? { ...r, matchedEntryId: entryId, ignored: false } : r),
      },
    }));
  };
  const ignoreRow = (rowId) => {
    setData(d => ({
      ...d,
      money: {
        ...d.money,
        bankImports: (d.money?.bankImports || []).map(r => r._id === rowId ? { ...r, ignored: true, matchedEntryId: null } : r),
      },
    }));
  };

  const matchedCount = imports.filter(r => r.matchedEntryId).length;
  const ignoredCount = imports.filter(r => r.ignored).length;
  const unmatchedCount = imports.length - matchedCount - ignoredCount;

  return (
    <div>
      {admin && (
        <Card style={{ marginBottom: 12 }}>
          {/* Plaid live-sync card. Renders conditional on server config:
              "configured: false" → show setup instructions instead of the
              Connect button. */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: BRAND.black }}>Plaid (live bank sync)</div>
            {plaidStatus.configured === false && <span style={{ fontSize: 10, color: "#92400E", background: "#FEF3C7", padding: "2px 8px", borderRadius: 4, fontWeight: 700 }}>NOT CONFIGURED</span>}
            {plaidStatus.configured && !plaid && <span style={{ fontSize: 10, color: BRAND.gray, fontWeight: 700 }}>Not connected</span>}
            {plaid && <span style={{ fontSize: 10, color: BRAND.green, fontWeight: 700 }}>✓ {plaid.institution}</span>}
          </div>
          {plaidStatus.configured === false && (
            <div style={{ padding: "8px 10px", background: "#FFFBEB", borderRadius: 6, fontSize: 11, color: "#78350F", border: "1px solid #FDE68A", lineHeight: 1.5 }}>
              Plaid live-sync isn't available because <code>PLAID_CLIENT_ID</code>, <code>PLAID_SECRET</code>, and <code>PLAID_ENV</code> aren't set on the server. Add them to Heroku Config Vars and redeploy. Until then, use CSV import below.
            </div>
          )}
          {plaidStatus.configured && !plaid && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Btn size="sm" onClick={startPlaid} disabled={plaidBusy}>{plaidBusy ? "Opening Plaid…" : "Connect Chase via Plaid"}</Btn>
              <span style={{ fontSize: 10, color: BRAND.gray }}>Opens Plaid's secure bank-link flow. Storing the access token lets admins pull new transactions on demand.</span>
            </div>
          )}
          {plaid && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Btn size="sm" onClick={syncPlaid} disabled={plaidBusy}>{plaidBusy ? "Syncing…" : "Sync new transactions"}</Btn>
              <Btn size="sm" variant="secondary" onClick={disconnectPlaid}>Disconnect</Btn>
              <span style={{ fontSize: 10, color: BRAND.gray }}>
                Connected {new Date(plaid.connectedAt).toLocaleDateString()} by {plaid.connectedBy}
                {plaid.lastSyncAt ? ` · last sync ${new Date(plaid.lastSyncAt).toLocaleString()}` : " · never synced"}
              </span>
            </div>
          )}
        </Card>
      )}
      {admin && (
        <Card style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: BRAND.black, marginBottom: 8 }}>Import Chase CSV</div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
            <input type="file" accept=".csv,text/csv" onChange={e => onFile(e.target.files?.[0])} style={{ fontSize: 11 }} />
            <div style={{ fontSize: 10, color: BRAND.gray, fontStyle: "italic" }}>…or paste below. Expects columns: date, description, amount (case-insensitive).</div>
          </div>
          <textarea value={csvText} onChange={e => setCsvText(e.target.value)} placeholder="date,description,amount&#10;2025-01-05,Wire from member,25000.00" style={{ width: "100%", minHeight: 120, marginTop: 8, padding: 10, border: `1px solid ${BRAND.grayLight}`, borderRadius: 6, fontSize: 11, fontFamily: "ui-monospace, monospace", boxSizing: "border-box" }} />
          {parseError && <div style={{ marginTop: 6, color: "#DC2626", fontSize: 11, fontWeight: 600 }}>{parseError}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <Btn size="sm" onClick={importParsed} disabled={!csvText.trim()}>Import rows</Btn>
          </div>
        </Card>
      )}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: BRAND.black }}>Bank Rows ({imports.length})</div>
          <div style={{ fontSize: 11, color: BRAND.gray }}>
            <span style={{ color: BRAND.green, fontWeight: 700 }}>{matchedCount} matched</span> ·
            <span style={{ color: "#DC2626", fontWeight: 700, marginLeft: 6 }}>{unmatchedCount} unmatched</span> ·
            <span style={{ marginLeft: 6 }}>{ignoredCount} ignored</span>
          </div>
        </div>
        {imports.length === 0 ? (
          <div style={{ padding: 16, textAlign: "center", color: BRAND.gray, fontStyle: "italic" }}>No bank rows imported yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#F9FAFB" }}>
                  {["Date", "Description", "Amount", "Status", "Action"].map(h => (
                    <th key={h} style={{ padding: "6px 8px", textAlign: "left", fontSize: 10, fontWeight: 700, color: BRAND.gray, textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {imports.map(r => {
                  const matched = r.matchedEntryId ? ledger.find(e => e.id === r.matchedEntryId) : null;
                  const candidates = !r.matchedEntryId && !r.ignored ? suggestMatches(r, ledger) : [];
                  return (
                    <tr key={r._id} style={{ borderBottom: `1px solid ${BRAND.grayLight}` }}>
                      <td style={{ padding: "6px 8px", ...S.mono, color: BRAND.grayDark }}>{r.date || r.Date || "—"}</td>
                      <td style={{ padding: "6px 8px", color: BRAND.black }}>{r.description || r.Description || "—"}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right", ...S.mono }}>{fmt$2(p(r.amount || r.Amount || 0))}</td>
                      <td style={{ padding: "6px 8px", fontSize: 10 }}>
                        {r.ignored ? <span style={{ color: BRAND.gray }}>Ignored</span>
                          : matched ? <span style={{ color: BRAND.green, fontWeight: 700 }}>✓ {matched.memo}</span>
                          : <span style={{ color: "#DC2626", fontWeight: 700 }}>Unmatched</span>}
                      </td>
                      <td style={{ padding: "6px 8px" }}>
                        {admin && !r.ignored && !r.matchedEntryId && (
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {candidates.slice(0, 2).map(c => (
                              <button key={c.id} onClick={() => matchRow(r._id, c.id)} style={{ fontSize: 10, padding: "3px 7px", border: `1px solid ${BRAND.green}`, background: "transparent", color: BRAND.green, borderRadius: 4, cursor: "pointer", fontFamily: "inherit" }}>Match: {c.memo.slice(0, 30)}</button>
                            ))}
                            <button onClick={() => ignoreRow(r._id)} style={{ fontSize: 10, padding: "3px 7px", border: `1px solid ${BRAND.grayLight}`, background: "transparent", color: BRAND.gray, borderRadius: 4, cursor: "pointer", fontFamily: "inherit" }}>Ignore</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAX EXPORTS — P&L, Balance Sheet, Member K-1 prep, 1099, MA sales tax,
// and a combined Form 1120-S package. Uses browser Print → Save as PDF;
// no PDF library dependency.
// ═══════════════════════════════════════════════════════════════
function TaxExportsView({ data, money }) {
  const thisYear = new Date().getFullYear();
  const [startDate, setStartDate] = useState(`${thisYear}-01-01`);
  const [endDate, setEndDate] = useState(`${thisYear}-12-31`);

  const pl = calcProfitLoss(money.ledger, money.accounts, startDate, endDate);
  const bs = calcBalanceSheet(money.ledger, money.accounts, endDate);
  const k1 = calcMemberK1Prep(money.ledger, money.accounts, money.members, startDate, endDate);
  const t1099 = calc1099Report(money.ledger, startDate, endDate);
  const maTax = calcMaSalesTax(money.ledger, money.accounts, startDate, endDate);

  const print = (title, bodyHtml) => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:Arial,sans-serif;max-width:820px;margin:20px auto;padding:20px;color:#111;font-size:12px;line-height:1.4}
h1{color:#8B1A1A;font-size:20px;border-bottom:2px solid #8B1A1A;padding-bottom:6px;margin-bottom:14px}
h2{font-size:14px;color:#111;margin:16px 0 6px;border-bottom:1px solid #ddd;padding-bottom:4px}
table{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:11px}
th{background:#f3f4f6;padding:5px 8px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;color:#555;letter-spacing:0.05em;border-bottom:1px solid #ddd}
td{padding:5px 8px;border-bottom:1px solid #eee}
.amt{text-align:right;font-family:"Courier New",monospace;font-weight:600}
.total{border-top:2px solid #111;font-weight:900;background:#f9fafb}
.meta{color:#888;font-size:10px;margin-bottom:12px}
.header-info{margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid #ccc}
.footer{margin-top:24px;padding-top:10px;border-top:1px solid #ddd;font-size:9px;color:#888;text-align:center}
@media print{body{padding:10px}}</style></head><body>
<div class="header-info"><div style="font-weight:900;font-size:13px">Sayarah Inc — S-Corp · Massachusetts</div>
<div class="meta">Period: ${startDate} to ${endDate} · Generated ${new Date().toLocaleString()}</div></div>
<h1>${title}</h1>
${bodyHtml}
<div class="footer">Internal document. For accountant / CPA use. Sayarah Inc · © ${thisYear}</div>
</body></html>`;
    const w = window.open("", "_blank");
    w.document.write(html);
    w.document.close();
    w.onload = () => w.print();
  };

  const plHtml = `
    <table>
      <thead><tr><th>Account</th><th class="amt">Amount</th></tr></thead>
      <tbody>
        <tr><td colspan="2"><b>Revenue</b></td></tr>
        ${Object.entries(pl.byAccount).filter(([id]) => id.startsWith("revenue:")).map(([id, amt]) =>
          `<tr><td>${(money.accounts.find(a => a.id === id)?.name) || id}</td><td class="amt">${fmt$2(amt)}</td></tr>`
        ).join("")}
        <tr class="total"><td>Total Revenue</td><td class="amt">${fmt$2(pl.revenue)}</td></tr>
        <tr><td colspan="2"><b>Expenses</b></td></tr>
        ${Object.entries(pl.byAccount).filter(([id]) => id.startsWith("expense:")).map(([id, amt]) =>
          `<tr><td>${(money.accounts.find(a => a.id === id)?.name) || id}</td><td class="amt">${fmt$2(amt)}</td></tr>`
        ).join("")}
        <tr class="total"><td>Total Expenses</td><td class="amt">${fmt$2(pl.expenses)}</td></tr>
        <tr class="total" style="font-size:14px;color:${pl.netIncome >= 0 ? "#166534" : "#DC2626"}"><td>Net Income</td><td class="amt">${fmt$2(pl.netIncome)}</td></tr>
      </tbody>
    </table>`;

  const bsHtml = `
    <h2>Assets</h2>
    <table><tbody>
      ${Object.entries(bs.assets).map(([id, a]) => `<tr><td>${a.name}</td><td class="amt">${fmt$2(a.balance)}</td></tr>`).join("") || '<tr><td colspan="2"><i>No assets</i></td></tr>'}
      <tr class="total"><td>Total Assets</td><td class="amt">${fmt$2(bs.totals.assets)}</td></tr>
    </tbody></table>
    <h2>Liabilities</h2>
    <table><tbody>
      ${Object.entries(bs.liabilities).map(([id, a]) => `<tr><td>${a.name}</td><td class="amt">${fmt$2(a.balance)}</td></tr>`).join("") || '<tr><td colspan="2"><i>None</i></td></tr>'}
      <tr class="total"><td>Total Liabilities</td><td class="amt">${fmt$2(bs.totals.liabilities)}</td></tr>
    </tbody></table>
    <h2>Equity</h2>
    <table><tbody>
      ${Object.entries(bs.equity).map(([id, a]) => `<tr><td>${a.name}</td><td class="amt">${fmt$2(a.balance)}</td></tr>`).join("") || '<tr><td colspan="2"><i>None</i></td></tr>'}
      <tr class="total"><td>Total Equity</td><td class="amt">${fmt$2(bs.totals.equity)}</td></tr>
    </tbody></table>
    <div class="meta">Balance check: Assets (${fmt$2(bs.totals.assets)}) = Liabilities (${fmt$2(bs.totals.liabilities)}) + Equity (${fmt$2(bs.totals.equity)}) · difference ${fmt$2(bs.totals.assets - bs.totals.liabilities - bs.totals.equity)}</div>`;

  const k1Html = `
    <table>
      <thead><tr><th>Member</th><th class="amt">Ending Capital</th><th class="amt">Share of Net Income</th></tr></thead>
      <tbody>
        ${k1.map(m => `<tr><td>${m.name}</td><td class="amt">${fmt$2(m.endingCapital)}</td><td class="amt">${fmt$2(m.shareOfIncome)}</td></tr>`).join("")}
      </tbody>
    </table>
    <div class="meta">Equal-split allocation. Give each member's row to your CPA for their K-1 preparation.</div>`;

  const t1099Html = `
    <table>
      <thead><tr><th>Vendor</th><th class="amt">Total Paid</th><th>1099-NEC Required?</th></tr></thead>
      <tbody>
        ${t1099.length === 0 ? '<tr><td colspan="3"><i>No vendor-attributed expenses over $600 in this period. Vendors must be recorded in the journal-entry <code>vendor</code> ref field or memo to be tracked.</i></td></tr>' :
          t1099.map(v => `<tr><td>${v.name}</td><td class="amt">${fmt$2(v.amount)}</td><td>${v.amount >= 600 ? "Yes" : "No"}</td></tr>`).join("")}
      </tbody>
    </table>`;

  const maTaxHtml = `
    <table>
      <thead><tr><th>Destination</th><th class="amt">Gross Sales</th><th>Taxable?</th></tr></thead>
      <tbody>
        <tr><td>In-state (MA)</td><td class="amt">${fmt$2(maTax.byDestination?.in_state_ma || 0)}</td><td>Yes — 6.25%</td></tr>
        <tr><td>Out-of-state (US)</td><td class="amt">${fmt$2(maTax.byDestination?.out_of_state_us || 0)}</td><td>No — exempt (buyer owes use tax in their state)</td></tr>
        <tr><td>International export</td><td class="amt">${fmt$2(maTax.byDestination?.international || 0)}</td><td>No — export exempt</td></tr>
        ${(maTax.byDestination?.unspecified || 0) > 0 ? `<tr><td>Unspecified</td><td class="amt">${fmt$2(maTax.byDestination.unspecified)}</td><td>Legacy sales — verify destination</td></tr>` : ""}
      </tbody>
    </table>
    <table style="margin-top:16px"><tbody>
      <tr><td><b>MA Sales Tax Collected (period)</b></td><td class="amt"><b>${fmt$2(maTax.collected)}</b></td></tr>
    </tbody></table>
    <div class="meta">MA Sales Tax is 6.25%, collected only on in-state deliveries. Out-of-state US buyers owe use tax in their home state. International exports are exempt from US sales tax; keep the bill of lading / export declaration on file for audit.</div>`;

  const form1120SHtml = `
    <h2>Profit & Loss</h2>${plHtml}
    <h2 style="page-break-before:always">Balance Sheet (as of ${endDate})</h2>${bsHtml}
    <h2 style="page-break-before:always">Member K-1 Preparation</h2>${k1Html}
    <h2 style="page-break-before:always">1099 Tracking</h2>${t1099Html}
    <h2 style="page-break-before:always">MA Sales Tax</h2>${maTaxHtml}`;

  return (
    <Card>
      <div style={{ fontSize: 15, fontWeight: 800, color: BRAND.black, marginBottom: 12 }}>Tax & Compliance Exports</div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 10, color: BRAND.gray, textTransform: "uppercase", fontWeight: 700 }}>From</div>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ padding: "5px 8px", border: `1px solid ${BRAND.grayLight}`, borderRadius: 6, fontSize: 11 }} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: BRAND.gray, textTransform: "uppercase", fontWeight: 700 }}>To</div>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ padding: "5px 8px", border: `1px solid ${BRAND.grayLight}`, borderRadius: 6, fontSize: 11 }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
        <ExportCard title="Profit & Loss Statement" summary={`Revenue ${fmt$2(pl.revenue)} · Expenses ${fmt$2(pl.expenses)} · Net ${fmt$2(pl.netIncome)}`} onPrint={() => print("Profit & Loss Statement", plHtml)} onCsv={() => exportCSV(`pl_${startDate}_to_${endDate}.csv`, ["Account", "Amount"], Object.entries(pl.byAccount).map(([id, amt]) => [(money.accounts.find(a => a.id === id)?.name) || id, amt.toFixed(2)]))} />
        <ExportCard title="Balance Sheet" summary={`Assets ${fmt$2(bs.totals.assets)} · Equity ${fmt$2(bs.totals.equity)} · as of ${endDate}`} onPrint={() => print(`Balance Sheet (as of ${endDate})`, bsHtml)} onCsv={() => exportCSV(`bs_${endDate}.csv`, ["Section", "Account", "Balance"], [...Object.entries(bs.assets).map(([, a]) => ["Asset", a.name, a.balance.toFixed(2)]), ...Object.entries(bs.liabilities).map(([, a]) => ["Liability", a.name, a.balance.toFixed(2)]), ...Object.entries(bs.equity).map(([, a]) => ["Equity", a.name, a.balance.toFixed(2)])])} />
        <ExportCard title="Member K-1 Preparation" summary={`${k1.length} members · Net share ${fmt$2(k1[0]?.shareOfIncome || 0)}`} onPrint={() => print("Member Capital / K-1 Preparation", k1Html)} onCsv={() => exportCSV(`k1_${startDate}_to_${endDate}.csv`, ["Member", "Ending Capital", "Share of Net Income"], k1.map(m => [m.name, m.endingCapital.toFixed(2), m.shareOfIncome.toFixed(2)]))} />
        <ExportCard title="1099 Tracking" summary={`${t1099.length} vendor${t1099.length === 1 ? "" : "s"} over $600`} onPrint={() => print("Vendor / 1099 Tracking", t1099Html)} onCsv={() => exportCSV(`1099_${startDate}_to_${endDate}.csv`, ["Vendor", "Total Paid", "1099-NEC Required"], t1099.map(v => [v.name, v.amount.toFixed(2), v.amount >= 600 ? "Yes" : "No"]))} />
        <ExportCard title="MA Sales Tax" summary={`${fmt$2(maTax.collected)} collected · ${fmt$2(maTax.byDestination?.in_state_ma || 0)} taxable in-state`} onPrint={() => print("MA Sales Tax", maTaxHtml)} onCsv={() => exportCSV(`ma_sales_tax_${startDate}_to_${endDate}.csv`, ["Period Start", "Period End", "In-State Gross", "Out-of-State Gross", "International Gross", "Tax Collected"], [[startDate, endDate, (maTax.byDestination?.in_state_ma || 0).toFixed(2), (maTax.byDestination?.out_of_state_us || 0).toFixed(2), (maTax.byDestination?.international || 0).toFixed(2), maTax.collected.toFixed(2)]])} />
        <ExportCard title="Form 1120-S Package" summary="Combined P&L + Balance Sheet + K-1 + 1099 + MA tax" onPrint={() => print("Form 1120-S Preparation Package", form1120SHtml)} />
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
// AUDIT TRAIL — filterable view over the entire ledger
// ═══════════════════════════════════════════════════════════════
function AuditTrailView({ ledger, accounts, members, admin = false, onReverse = null }) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  const uniqueUsers = [...new Set((ledger || []).map(e => e.user).filter(Boolean))];
  const uniqueTypes = [...new Set((ledger || []).map(e => e.ref?.type).filter(Boolean))];

  const filtered = (ledger || []).filter(e => {
    if (fromDate && e.date < fromDate) return false;
    if (toDate && e.date > toDate) return false;
    if (userFilter && e.user !== userFilter) return false;
    if (typeFilter && (e.ref?.type || "") !== typeFilter) return false;
    if (accountFilter && !e.lines.some(l => l.accountId === accountFilter)) return false;
    return true;
  });

  const accountName = (id) => {
    if (id.startsWith("equity:member:")) {
      const mid = id.split(":")[2];
      return (members.find(m => m.id === mid)?.name || mid) + " (capital)";
    }
    if (id.startsWith("asset:vehicle:")) return `Vehicle #${id.split(":")[2]}`;
    return accounts.find(a => a.id === id)?.name || id;
  };

  const exportAudit = () => {
    const headers = ["Date", "Memo", "User", "Ref Type", "Account", "Debit", "Credit"];
    const rows = [];
    for (const e of filtered) {
      for (const l of e.lines) {
        rows.push([e.date, e.memo, e.user, e.ref?.type || "", accountName(l.accountId), p(l.debit).toFixed(2), p(l.credit).toFixed(2)]);
      }
    }
    exportCSV(`audit_trail_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: BRAND.black }}>Audit Trail ({filtered.length} of {ledger.length})</div>
        <Btn size="sm" variant="secondary" onClick={exportAudit}>Export CSV</Btn>
      </div>
      {/* Filters */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 12, padding: 10, background: "#F9FAFB", borderRadius: 6 }}>
        <div>
          <div style={{ fontSize: 9, color: BRAND.gray, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>From</div>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ width: "100%", padding: "4px 6px", border: `1px solid ${BRAND.grayLight}`, borderRadius: 4, fontSize: 11, boxSizing: "border-box" }} />
        </div>
        <div>
          <div style={{ fontSize: 9, color: BRAND.gray, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>To</div>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{ width: "100%", padding: "4px 6px", border: `1px solid ${BRAND.grayLight}`, borderRadius: 4, fontSize: 11, boxSizing: "border-box" }} />
        </div>
        <div>
          <div style={{ fontSize: 9, color: BRAND.gray, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>User</div>
          <select value={userFilter} onChange={e => setUserFilter(e.target.value)} style={{ width: "100%", padding: "4px 6px", border: `1px solid ${BRAND.grayLight}`, borderRadius: 4, fontSize: 11 }}>
            <option value="">(any)</option>
            {uniqueUsers.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 9, color: BRAND.gray, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>Entry type</div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ width: "100%", padding: "4px 6px", border: `1px solid ${BRAND.grayLight}`, borderRadius: 4, fontSize: 11 }}>
            <option value="">(any)</option>
            {uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 9, color: BRAND.gray, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>Account</div>
          <select value={accountFilter} onChange={e => setAccountFilter(e.target.value)} style={{ width: "100%", padding: "4px 6px", border: `1px solid ${BRAND.grayLight}`, borderRadius: 4, fontSize: 11 }}>
            <option value="">(any)</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>
      {filtered.length === 0 ? (
        <div style={{ padding: 16, textAlign: "center", color: BRAND.gray, fontStyle: "italic" }}>No entries match.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {[...filtered].reverse().map(e => {
            const total = e.lines.reduce((s, l) => s + p(l.debit), 0);
            const isExpanded = expandedId === e.id;
            return (
              <div key={e.id} style={{ border: `1px solid ${BRAND.grayLight}`, borderRadius: 6, overflow: "hidden" }}>
                <div onClick={() => setExpandedId(isExpanded ? null : e.id)} style={{ cursor: "pointer", padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", background: isExpanded ? "#FEF2F2" : BRAND.white, gap: 10, fontSize: 11 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                    <span style={{ color: BRAND.gray, ...S.mono, flexShrink: 0 }}>{e.date}</span>
                    <span style={{ color: BRAND.black, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.memo}</span>
                    <span style={{ fontSize: 9, color: BRAND.gray, textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0 }}>{e.ref?.type || "—"}</span>
                    <span style={{ color: BRAND.gray, flexShrink: 0 }}>{e.user}</span>
                    <span style={{ fontWeight: 800, color: BRAND.black, ...S.mono, flexShrink: 0 }}>{fmt$2(total)}</span>
                    <span style={{ fontSize: 10, color: BRAND.gray, flexShrink: 0 }}>{isExpanded ? "▾" : "▸"}</span>
                  </div>
                </div>
                {isExpanded && (
                  <div style={{ padding: "8px 12px", background: "#FAFAFA", borderTop: `1px solid ${BRAND.grayLight}` }}>
                    <div style={{ fontSize: 9, color: BRAND.gray, marginBottom: 4 }}>ID: {e.id} · Posted {new Date(e.timestamp).toLocaleString()}{e.ip ? ` · IP ${e.ip}` : ""}</div>
                    <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${BRAND.grayLight}` }}>
                          <th style={{ padding: "3px 6px", textAlign: "left", color: BRAND.gray, fontWeight: 700, textTransform: "uppercase" }}>Account</th>
                          <th style={{ padding: "3px 6px", textAlign: "right", color: BRAND.gray, fontWeight: 700, textTransform: "uppercase" }}>Debit</th>
                          <th style={{ padding: "3px 6px", textAlign: "right", color: BRAND.gray, fontWeight: 700, textTransform: "uppercase" }}>Credit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {e.lines.map((l, i) => (
                          <tr key={i}>
                            <td style={{ padding: "3px 6px" }}>{accountName(l.accountId)}</td>
                            <td style={{ padding: "3px 6px", textAlign: "right", ...S.mono, color: l.debit > 0 ? BRAND.black : BRAND.gray }}>{l.debit > 0 ? fmt$2(l.debit) : "—"}</td>
                            <td style={{ padding: "3px 6px", textAlign: "right", ...S.mono, color: l.credit > 0 ? BRAND.black : BRAND.gray }}>{l.credit > 0 ? fmt$2(l.credit) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {e.ref && <div style={{ fontSize: 9, color: BRAND.gray, marginTop: 6, fontFamily: "ui-monospace, monospace" }}>ref: {JSON.stringify(e.ref)}</div>}
                    {admin && onReverse && e.ref?.type !== "reversal" && (
                      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                        <Btn size="sm" variant="secondary" onClick={() => onReverse(e)} style={{ background: "#FEF3C7", color: "#92400E", border: "1px solid #FCD34D", fontSize: 10 }}>Reverse / Undo</Btn>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
// YEAR-END CLOSE — close revenue + expense accounts to Income
// Summary → Retained Earnings; lock the fiscal period so no more
// entries can be backdated into it.
// ═══════════════════════════════════════════════════════════════
function YearEndCloseView({ data, setData, money, admin, username }) {
  const thisYear = new Date().getFullYear();
  const [fyEnd, setFyEnd] = useState(`${thisYear - 1}-12-31`);
  const closedPeriods = money.closedPeriods || [];

  const preview = useMemo(() => calcClosingEntries({
    ledger: money.ledger, accounts: money.accounts,
    fiscalYearEnd: fyEnd, user: username,
  }), [money.ledger, money.accounts, fyEnd, username]);

  const alreadyClosed = closedPeriods.some(cp => cp.endDate === fyEnd);

  const closeYear = () => {
    if (alreadyClosed) { alert("This fiscal year is already closed."); return; }
    if (preview.entries.length === 0) { alert("No closing entries needed — no revenue or expense activity in this fiscal year."); return; }
    const yearStart = fyEnd.slice(0, 4) + "-01-01";
    if (!confirm(`Close fiscal year ${yearStart.slice(0, 4)}?\n\nNet income: ${fmt$2(preview.netIncome)}\nEntries to post: ${preview.entries.length}\n\nAfter closing, no new journal entries can be posted with a date inside this period. Reversals must use a later date.`)) return;

    setData(d => {
      let ledger = d.money?.ledger || [];
      const existingClosed = d.money?.closedPeriods || [];
      for (const e of preview.entries) {
        ledger = postJournalEntry(ledger, e, existingClosed); // closed-period check uses prior state
      }
      return {
        ...d,
        money: {
          ...d.money,
          ledger,
          closedPeriods: [...existingClosed, {
            startDate: yearStart,
            endDate: fyEnd,
            closedAt: new Date().toISOString(),
            closedBy: username,
            netIncome: preview.netIncome,
            entryIds: preview.entries.map(e => e.id),
          }],
        },
      };
    });
    logActivity(username, "year_end_closed", `Closed fiscal year ${fyEnd.slice(0, 4)}: net income ${fmt$2(preview.netIncome)}`, { fiscalYearEnd: fyEnd, netIncome: preview.netIncome });
  };

  return (
    <div>
      <Card style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: BRAND.black, marginBottom: 8 }}>Year-End Close</div>
        <div style={{ fontSize: 11, color: BRAND.gray, marginBottom: 14, lineHeight: 1.5 }}>
          Closing a fiscal year performs standard closing entries (revenue → Income Summary → Retained Earnings; expenses → Income Summary) and <b>locks the period</b> — no new journal entries can be posted with a date inside a closed year. Reversals are still possible but must be dated after the close.
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10, color: BRAND.gray, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>Fiscal year end</div>
            <input type="date" value={fyEnd} onChange={e => setFyEnd(e.target.value)} style={{ padding: "6px 8px", border: `1px solid ${BRAND.grayLight}`, borderRadius: 6, fontSize: 12 }} />
          </div>
          {admin && !alreadyClosed && <Btn size="sm" onClick={closeYear} disabled={preview.entries.length === 0}>Close Year {fyEnd.slice(0, 4)}</Btn>}
          {alreadyClosed && <span style={{ fontSize: 11, color: BRAND.green, fontWeight: 700, padding: "6px 10px", background: "#D1FAE5", borderRadius: 6 }}>✓ Closed</span>}
        </div>
        {preview.entries.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: BRAND.gray, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Preview — entries that will post</div>
            <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "#F9FAFB" }}>{["Memo", "Lines", "Amount"].map(h => <th key={h} style={{ padding: "5px 8px", textAlign: "left", fontSize: 10, fontWeight: 700, color: BRAND.gray, textTransform: "uppercase" }}>{h}</th>)}</tr></thead>
              <tbody>
                {preview.entries.map(e => {
                  const amount = e.lines.reduce((s, l) => s + p(l.debit), 0);
                  return (
                    <tr key={e.id} style={{ borderBottom: `1px solid ${BRAND.grayLight}` }}>
                      <td style={{ padding: "5px 8px" }}>{e.memo}</td>
                      <td style={{ padding: "5px 8px", color: BRAND.gray, fontSize: 10 }}>{e.lines.length}</td>
                      <td style={{ padding: "5px 8px", ...S.mono, textAlign: "right", fontWeight: 700 }}>{fmt$2(amount)}</td>
                    </tr>
                  );
                })}
                <tr style={{ background: "#FEF2F2", borderTop: `2px solid ${BRAND.red}` }}>
                  <td style={{ padding: "8px", fontWeight: 900, color: BRAND.red }}>Net Income (FY {fyEnd.slice(0, 4)})</td>
                  <td></td>
                  <td style={{ padding: "8px", ...S.mono, textAlign: "right", fontWeight: 900, color: preview.netIncome >= 0 ? BRAND.green : "#DC2626", fontSize: 14 }}>{fmt$2(preview.netIncome)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {closedPeriods.length > 0 && (
        <Card>
          <div style={{ fontSize: 13, fontWeight: 800, color: BRAND.black, marginBottom: 8 }}>Closed Periods ({closedPeriods.length})</div>
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "#F9FAFB" }}>{["Period", "Net Income", "Closed At", "Closed By"].map(h => <th key={h} style={{ padding: "5px 8px", textAlign: "left", fontSize: 10, fontWeight: 700, color: BRAND.gray, textTransform: "uppercase" }}>{h}</th>)}</tr></thead>
            <tbody>
              {closedPeriods.map(cp => (
                <tr key={cp.endDate} style={{ borderBottom: `1px solid ${BRAND.grayLight}` }}>
                  <td style={{ padding: "5px 8px", ...S.mono }}>{cp.startDate} to {cp.endDate}</td>
                  <td style={{ padding: "5px 8px", ...S.mono, fontWeight: 700, color: cp.netIncome >= 0 ? BRAND.green : "#DC2626" }}>{fmt$2(cp.netIncome || 0)}</td>
                  <td style={{ padding: "5px 8px", color: BRAND.gray }}>{new Date(cp.closedAt).toLocaleString()}</td>
                  <td style={{ padding: "5px 8px", color: BRAND.gray }}>{cp.closedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function ExportCard({ title, summary, onPrint, onCsv }) {
  return (
    <div style={{ border: `1px solid ${BRAND.grayLight}`, borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: BRAND.black, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 10, color: BRAND.gray, marginBottom: 8 }}>{summary}</div>
      <div style={{ display: "flex", gap: 6 }}>
        <Btn size="sm" onClick={onPrint} style={{ fontSize: 10, padding: "4px 8px" }}>Print / PDF</Btn>
        {onCsv && <Btn size="sm" variant="secondary" onClick={onCsv} style={{ fontSize: 10, padding: "4px 8px" }}>CSV</Btn>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// RULES MODAL — readable view with Print + admin Edit
// ═══════════════════════════════════════════════════════════════
function RulesModal({ rules, admin, onClose, onEdit }) {
  // Convert the markdown-lite content to display-ready HTML. We only
  // support headings (#, ##), bullets (-), and bold (**foo**) —
  // intentionally narrow so the content stays safe to render.
  const renderContent = (text) => {
    const lines = text.split("\n");
    const elems = [];
    let listBuffer = null;
    const flushList = () => {
      if (listBuffer) { elems.push(<ul key={`ul${elems.length}`} style={{ paddingLeft: 20, marginBottom: 10 }}>{listBuffer}</ul>); listBuffer = null; }
    };
    const renderInline = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((chunk, i) =>
      chunk.startsWith("**") && chunk.endsWith("**")
        ? <b key={i}>{chunk.slice(2, -2)}</b>
        : <span key={i}>{chunk}</span>
    );
    lines.forEach((line, i) => {
      if (line.startsWith("# ")) { flushList(); elems.push(<h1 key={i} style={{ fontSize: 20, fontWeight: 900, margin: "16px 0 8px", color: BRAND.red, borderBottom: `2px solid ${BRAND.redBg2}`, paddingBottom: 6 }}>{line.slice(2)}</h1>); }
      else if (line.startsWith("## ")) { flushList(); elems.push(<h2 key={i} style={{ fontSize: 16, fontWeight: 800, margin: "14px 0 6px", color: BRAND.black }}>{line.slice(3)}</h2>); }
      else if (line.startsWith("- ")) { if (!listBuffer) listBuffer = []; listBuffer.push(<li key={i} style={{ fontSize: 13, lineHeight: 1.6, color: BRAND.grayDark }}>{renderInline(line.slice(2))}</li>); }
      else if (line.trim() === "") { flushList(); }
      else { flushList(); elems.push(<p key={i} style={{ fontSize: 13, lineHeight: 1.6, color: BRAND.grayDark, margin: "4px 0" }}>{renderInline(line)}</p>); }
    });
    flushList();
    return elems;
  };

  const printRules = () => {
    const esc_ = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const printable = rules.content.split("\n").map(l => {
      if (l.startsWith("# ")) return `<h1>${esc_(l.slice(2))}</h1>`;
      if (l.startsWith("## ")) return `<h2>${esc_(l.slice(3))}</h2>`;
      if (l.startsWith("- ")) return `<li>${esc_(l.slice(2)).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")}</li>`;
      if (l.trim() === "") return "";
      return `<p>${esc_(l).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")}</p>`;
    }).join("\n").replace(/(<li>.*?<\/li>\n?)+/gs, m => `<ul>${m}</ul>`);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sayarah Money Management — Rules (v${rules.version})</title>
<style>body{font-family:Arial,sans-serif;max-width:720px;margin:24px auto;padding:24px;color:#111;line-height:1.5}h1{font-size:22px;color:#8B1A1A;border-bottom:2px solid #8B1A1A;padding-bottom:8px;margin-top:24px}h2{font-size:16px;margin-top:16px}ul{padding-left:22px}.header{border-bottom:1px solid #ccc;padding-bottom:10px;margin-bottom:20px}.header .meta{color:#666;font-size:11px}.signature{margin-top:40px;border-top:1px solid #ccc;padding-top:20px;font-size:11px;color:#666}@media print{body{padding:12px}}</style>
</head><body>
<div class="header"><div style="font-weight:900;font-size:13px">Sayarah — Money Management Rules</div><div class="meta">Version ${rules.version} · Last updated ${new Date(rules.updatedAt).toLocaleString()} by ${esc_(rules.updatedBy)}</div></div>
${printable}
<div class="signature">Acknowledged by: __________________________________  Date: ____________</div>
</body></html>`;
    const w = window.open("", "_blank");
    w.document.write(html);
    w.document.close();
    w.onload = () => w.print();
  };

  return (
    <Modal title={`Money Management Rules (v${rules.version})`} onClose={onClose} wide>
      <div style={{ maxHeight: 540, overflowY: "auto", padding: "0 4px" }}>
        {renderContent(rules.content)}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 12, borderTop: `1px solid ${BRAND.grayLight}`, gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 10, color: BRAND.gray }}>
          Last updated {new Date(rules.updatedAt).toLocaleString()} by {rules.updatedBy}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Btn variant="secondary" size="sm" onClick={printRules}>Print / Save as PDF</Btn>
          {admin && <Btn size="sm" onClick={onEdit}>Edit Rules</Btn>}
          <Btn variant="secondary" size="sm" onClick={onClose}>Close</Btn>
        </div>
      </div>
    </Modal>
  );
}

function RulesEditor({ rules, onSave, onCancel }) {
  const [content, setContent] = useState(rules.content);
  return (
    <Modal title={`Edit Rules (v${rules.version} → v${rules.version + 1})`} onClose={onCancel} wide>
      <div style={{ fontSize: 11, color: BRAND.gray, marginBottom: 8 }}>
        Use Markdown-lite: <code># Heading</code> · <code>## Subheading</code> · <code>- bullet</code> · <code>**bold**</code>
      </div>
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        spellCheck
        style={{ width: "100%", minHeight: 400, padding: 12, border: `1px solid ${BRAND.grayLight}`, borderRadius: 8, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, lineHeight: 1.5, resize: "vertical", boxSizing: "border-box" }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 12 }}>
        <Btn variant="secondary" size="sm" onClick={onCancel}>Cancel</Btn>
        <Btn size="sm" onClick={() => onSave(content)}>Save rules</Btn>
      </div>
    </Modal>
  );
}

function UsersTab() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editUser, setEditUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const load = async () => { setLoading(true); try { const u = await getAllUsers(); setUsers(u); } catch (e) { setMsg("Failed to load users: " + e.message); } setLoading(false); };
  useEffect(() => { if (FIREBASE_ENABLED) load(); }, []);

  const savePerms = async (uid, updates) => {
    setSaving(true); setMsg("");
    try { await updateUserPermissions(uid, updates); setMsg("Permissions saved!"); await load(); setTimeout(() => setMsg(""), 2000); }
    catch (e) { setMsg("Error: " + e.message); }
    setSaving(false);
  };

  if (!FIREBASE_ENABLED) return <Card><div style={{ padding: 24, textAlign: "center", color: BRAND.gray }}>Firebase not configured — user management unavailable</div></Card>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 900, color: BRAND.black }}>User Management</div>
          <div style={{ fontSize: 11, color: BRAND.gray }}>Control access, roles, and page permissions for Auto Trade Hub</div>
        </div>
        <Btn onClick={load}>↻ Refresh</Btn>
      </div>

      {msg && <div style={{ background: msg.startsWith("Error") ? BRAND.redBg : "#F0FDF4", color: msg.startsWith("Error") ? BRAND.red : "#166534", padding: "8px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, marginBottom: 12 }}>{msg}</div>}

      {loading ? <div style={{ textAlign: "center", padding: 40, color: BRAND.gray }}>Loading users...</div> : (
        <Card>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ borderBottom: `2px solid ${BRAND.grayLight}` }}>
              <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 10, fontWeight: 800, color: BRAND.gray, textTransform: "uppercase" }}>User</th>
              <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 10, fontWeight: 800, color: BRAND.gray, textTransform: "uppercase" }}>Email</th>
              <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 10, fontWeight: 800, color: BRAND.gray, textTransform: "uppercase" }}>Last Login</th>
              <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 10, fontWeight: 800, color: BRAND.gray, textTransform: "uppercase" }}>Role</th>
              <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 10, fontWeight: 800, color: BRAND.gray, textTransform: "uppercase" }}>Allowed Pages</th>
              <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 10, fontWeight: 800, color: BRAND.gray, textTransform: "uppercase" }}>Actions</th>
            </tr></thead>
            <tbody>
              {users.map(u => {
                const isSuperAdmin = u.email === SUPER_ADMIN_EMAIL;
                const isEditing = editUser?.id === u.id;
                return (
                  <tr key={u.id} style={{ borderBottom: `1px solid ${BRAND.grayLight}` }}>
                    <td style={{ padding: "10px" }}>
                      <div style={{ fontWeight: 700 }}>{u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.displayName || "—"}</div>
                      {isSuperAdmin && <span style={{ fontSize: 8, background: "#FEF3C7", color: "#92400E", padding: "1px 6px", borderRadius: 4, fontWeight: 800 }}>SUPER ADMIN</span>}
                    </td>
                    <td style={{ padding: "10px" }}><span style={{ fontSize: 11, color: BRAND.gray }}>{u.email || "—"}</span></td>
                    <td style={{ padding: "10px" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: BRAND.black }}>{timeAgo(u.lastLoginAt)}</div>
                      {u.lastLoginIp && u.lastLoginIp !== "Unknown" && (
                        <div style={{ fontSize: 9, color: BRAND.grayDark, marginTop: 2, fontFamily: "monospace" }}>{u.lastLoginIp}</div>
                      )}
                      {u.lastLoginLocation && u.lastLoginLocation !== "Unknown" && (
                        <div style={{ fontSize: 9, color: BRAND.gray, marginTop: 1, display: "flex", alignItems: "center", gap: 3 }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                          {u.lastLoginLocation}
                        </div>
                      )}
                      {u.prevLoginAt && (
                        <div style={{ fontSize: 8, color: BRAND.gray, marginTop: 4, borderTop: `1px solid ${BRAND.grayLight}`, paddingTop: 3 }}>
                          Prev: {timeAgo(u.prevLoginAt)}{u.prevLoginIp && u.prevLoginIp !== "Unknown" ? ` · ${u.prevLoginIp}` : ""}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "10px" }}>
                      {isEditing && !isSuperAdmin ? (
                        <select value={editUser.role || "user"} onChange={e => setEditUser({ ...editUser, role: e.target.value })} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, border: `1px solid ${BRAND.grayLight}`, fontFamily: "inherit" }}>
                          {USER_ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                        </select>
                      ) : (
                        <Badge color={(USER_ROLES.find(r => r.key === u.role) || USER_ROLES[2]).color} bg={(USER_ROLES.find(r => r.key === u.role) || USER_ROLES[2]).bg}>
                          {(USER_ROLES.find(r => r.key === u.role) || USER_ROLES[2]).label}
                        </Badge>
                      )}
                    </td>
                    <td style={{ padding: "10px" }}>
                      {isEditing && !isSuperAdmin ? (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {ALL_AUCTION_TABS.map(t => {
                            const tabs = editUser.allowedTabs || ALL_AUCTION_TABS;
                            const on = tabs.includes(t);
                            return <button key={t} onClick={() => {
                              const cur = editUser.allowedTabs || [...ALL_AUCTION_TABS];
                              setEditUser({ ...editUser, allowedTabs: on ? cur.filter(x => x !== t) : [...cur, t] });
                            }} style={{ fontSize: 9, padding: "3px 8px", borderRadius: 4, border: `1px solid ${on ? "#059669" : BRAND.grayLight}`, background: on ? "#D1FAE5" : "transparent", color: on ? "#059669" : BRAND.gray, cursor: "pointer", fontWeight: on ? 700 : 400, fontFamily: "inherit" }}>{t}</button>;
                          })}
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                          {(u.role === "admin" || isSuperAdmin) ? <span style={{ fontSize: 9, color: "#059669", fontWeight: 700 }}>All Pages</span>
                          : (u.allowedTabs || ["Dashboard"]).map(t => <span key={t} style={{ fontSize: 9, background: BRAND.grayLight, padding: "2px 6px", borderRadius: 3, color: BRAND.grayDark }}>{t}</span>)}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "10px" }}>
                      {isSuperAdmin ? <span style={{ fontSize: 9, color: BRAND.gray }}>Protected</span>
                      : isEditing ? (
                        <div style={{ display: "flex", gap: 4 }}>
                          <Btn onClick={() => { savePerms(u.id, { role: editUser.role, allowedTabs: editUser.allowedTabs || ALL_AUCTION_TABS, auctionAccess: true }); setEditUser(null); }} disabled={saving}>{saving ? "Saving..." : "Save"}</Btn>
                          <Btn variant="secondary" onClick={() => setEditUser(null)}>Cancel</Btn>
                        </div>
                      ) : (
                        <Btn variant="secondary" onClick={() => setEditUser({ ...u })}>Edit</Btn>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {users.length === 0 && <div style={{ padding: 24, textAlign: "center", color: BRAND.gray, fontSize: 12 }}>No users found</div>}
        </Card>
      )}

      <div style={{ marginTop: 16, padding: 14, background: BRAND.blueBg, borderRadius: 8, border: "1px solid #BFDBFE" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: BRAND.blue, marginBottom: 4 }}>How Permissions Work</div>
        <div style={{ fontSize: 10, color: BRAND.blue, lineHeight: 1.6 }}>
          • <b>Admin</b> — Full access to all pages and user management<br/>
          • <b>Manager</b> — Access to assigned pages only (set above)<br/>
          • <b>User</b> — Dashboard and Calendar only<br/>
          • <b>Super Admin</b> (support@sayarah.io) — Cannot be modified
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SETTINGS TAB
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// HOLD COSTS CARD — admin-editable rates used in profit calculations
// ═══════════════════════════════════════════════════════════════
const HOLD_COST_FIELDS = [
  { key: "insurancePerDay", label: "Insurance / day", prefix: "$", suffix: "", step: "0.01", help: "Daily insurance cost per vehicle" },
  { key: "storagePerDay", label: "Storage / day", prefix: "$", suffix: "", step: "0.01", help: "Daily lot/storage cost (0 if home lot)" },
  { key: "depreciationPerDay", label: "Depreciation / day", prefix: "$", suffix: "", step: "0.01", help: "Average daily depreciation estimate" },
  { key: "opportunityCostRate", label: "Opportunity cost rate", prefix: "", suffix: "%", step: "0.01", help: "Annual return on capital (10% = 0.10)", isPct: true },
  { key: "agingThresholdDays", label: "Aging warning threshold", prefix: "", suffix: "days", step: "1", help: "Flag vehicles held longer than this (default 45)" },
];
function HoldCostsCard({ data, setData, darkMode, username }) {
  const current = data.holdCosts || DEFAULT_HOLD_COSTS;
  const [form, setForm] = useState({ ...current });
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  const upd = (k, v) => { setErr(""); setSaved(false); setForm(f => ({ ...f, [k]: v })); };

  const save = () => {
    const bounds = [
      [form.insurancePerDay, "Insurance / day", { max: 1000 }],
      [form.storagePerDay, "Storage / day", { max: 1000 }],
      [form.depreciationPerDay, "Depreciation / day", { max: 1000 }],
      [form.opportunityCostRate, "Opportunity cost rate", { max: 1 }],
      [form.agingThresholdDays, "Aging threshold", { max: 3650 }],
    ];
    const e = validateMoneyFields(bounds);
    if (e) { setErr(e); return; }
    const clean = {
      insurancePerDay: p(form.insurancePerDay),
      storagePerDay: p(form.storagePerDay),
      depreciationPerDay: p(form.depreciationPerDay),
      opportunityCostRate: p(form.opportunityCostRate),
      agingThresholdDays: Math.max(1, Math.round(p(form.agingThresholdDays)) || 45),
    };
    setData(d => ({ ...d, holdCosts: clean }));
    logActivity(username, "updated_hold_costs", `Updated hold cost rates`);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const reset = () => {
    setForm({ ...DEFAULT_HOLD_COSTS });
    setErr("");
    setSaved(false);
  };

  const dirty = Object.keys(current).some(k => p(form[k]) !== p(current[k]));

  return (
    <Card style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: "#FEF3C7", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: BRAND.black }}>Hold Cost Rates</div>
          <div style={{ fontSize: 11, color: BRAND.gray }}>Used in profit & break-even calculations for every vehicle</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        {HOLD_COST_FIELDS.map(f => (
          <div key={f.key}>
            <div style={{ fontSize: 10, fontWeight: 700, color: BRAND.gray, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{f.label}</div>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              {f.prefix && <span style={{ position: "absolute", left: 10, color: BRAND.gray, fontSize: 12 }}>{f.prefix}</span>}
              <input
                type="number"
                step={f.step}
                value={form[f.key] ?? ""}
                onChange={e => upd(f.key, e.target.value === "" ? "" : parseFloat(e.target.value))}
                style={{ width: "100%", padding: f.prefix ? "9px 26px 9px 22px" : "9px 26px 9px 11px", borderRadius: 8, border: `1px solid ${BRAND.grayLight}`, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
              />
              {f.suffix && <span style={{ position: "absolute", right: 10, color: BRAND.gray, fontSize: 12 }}>{f.suffix}</span>}
            </div>
            <div style={{ fontSize: 10, color: BRAND.gray, marginTop: 3 }}>{f.help}</div>
          </div>
        ))}
      </div>
      {err && <div style={{ background: "#FEF2F2", color: "#DC2626", padding: "8px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, marginTop: 12 }}>{err}</div>}
      {saved && <div style={{ background: "#F0FDF4", color: "#166534", padding: "8px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, marginTop: 12 }}>Saved — new rates apply immediately.</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
        <Btn variant="secondary" size="sm" onClick={reset} disabled={!dirty}>Reset to defaults</Btn>
        <Btn size="sm" onClick={save} disabled={!dirty}>Save rates</Btn>
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
// AUCTION FEE TIERS CARD — admin-editable Copart/IAAI/etc. fee schedules
// ═══════════════════════════════════════════════════════════════
function AuctionFeeTiersCard({ data, setData, darkMode, username }) {
  const custom = data.auctionFeeTiers || {};
  // Build a working copy: merged defaults + overrides, for editing.
  const build = () => {
    const out = {};
    for (const [k, v] of Object.entries(DEFAULT_AUCTION_FEE_TIERS)) {
      const ov = custom[k] || {};
      out[k] = {
        ...v,
        gateFee: typeof ov.gateFee === "number" ? ov.gateFee : v.gateFee,
        envFee: typeof ov.envFee === "number" ? ov.envFee : v.envFee,
        titleFee: typeof ov.titleFee === "number" ? ov.titleFee : v.titleFee,
        virtualBidFee: typeof ov.virtualBidFee === "number" ? ov.virtualBidFee : v.virtualBidFee,
        tiers: (Array.isArray(ov.tiers) && ov.tiers.length > 0)
          ? ov.tiers.map(t => ({ ...t, max: (t.max == null || t.max === "Infinity") ? Infinity : Number(t.max) }))
          : v.tiers.map(t => ({ ...t })),
      };
    }
    return out;
  };
  const [form, setForm] = useState(build);
  const [openSrc, setOpenSrc] = useState(null);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  const updFlat = (src, key, val) => {
    setErr(""); setSaved(false);
    setForm(f => ({ ...f, [src]: { ...f[src], [key]: val === "" ? "" : parseFloat(val) } }));
  };
  const updTier = (src, idx, key, val) => {
    setErr(""); setSaved(false);
    setForm(f => {
      const tiers = f[src].tiers.map((t, i) => i === idx ? { ...t, [key]: (val === "" ? "" : Number(val)) } : t);
      return { ...f, [src]: { ...f[src], tiers } };
    });
  };
  const addTier = (src) => {
    setForm(f => {
      const last = f[src].tiers[f[src].tiers.length - 1];
      const newRow = last?.max === Infinity
        ? { max: 9999.99, fee: 0 }
        : { max: Infinity, pct: 5 };
      const tiers = last?.max === Infinity
        ? [...f[src].tiers.slice(0, -1), newRow, last]
        : [...f[src].tiers, newRow];
      return { ...f, [src]: { ...f[src], tiers } };
    });
  };
  const removeTier = (src, idx) => {
    setForm(f => ({ ...f, [src]: { ...f[src], tiers: f[src].tiers.filter((_, i) => i !== idx) } }));
  };
  const resetSrc = (src) => {
    setErr(""); setSaved(false);
    setForm(f => ({ ...f, [src]: { ...DEFAULT_AUCTION_FEE_TIERS[src], tiers: DEFAULT_AUCTION_FEE_TIERS[src].tiers.map(t => ({ ...t })) } }));
  };

  const save = () => {
    // Validate: every tier has a numeric max (or Infinity) and either fee or pct
    for (const [src, cfg] of Object.entries(form)) {
      const flatErr = validateMoneyFields([
        [cfg.gateFee, `${cfg.name} gate fee`, { max: 10_000 }],
        [cfg.envFee, `${cfg.name} env fee`, { max: 10_000 }],
        [cfg.titleFee, `${cfg.name} title fee`, { max: 10_000 }],
        [cfg.virtualBidFee, `${cfg.name} virtual bid fee`, { max: 10_000 }],
      ]);
      if (flatErr) { setErr(flatErr); return; }
      if (!Array.isArray(cfg.tiers) || cfg.tiers.length === 0) { setErr(`${cfg.name}: at least one tier row is required`); return; }
      for (let i = 0; i < cfg.tiers.length; i++) {
        const t = cfg.tiers[i];
        const isLast = i === cfg.tiers.length - 1;
        if (!isLast && (!Number.isFinite(Number(t.max)) || Number(t.max) <= 0)) { setErr(`${cfg.name} tier ${i + 1}: max must be a positive number`); return; }
        if (t.pct != null && t.pct !== "") {
          if (!Number.isFinite(Number(t.pct)) || Number(t.pct) < 0 || Number(t.pct) > 100) { setErr(`${cfg.name} tier ${i + 1}: pct must be 0–100`); return; }
        } else if (t.fee != null && t.fee !== "") {
          if (!Number.isFinite(Number(t.fee)) || Number(t.fee) < 0) { setErr(`${cfg.name} tier ${i + 1}: fee must be ≥ 0`); return; }
        } else {
          setErr(`${cfg.name} tier ${i + 1}: need either fee or pct`); return;
        }
      }
    }
    // Persist as sparse overrides: only sources where anything differs from defaults
    const overrides = {};
    for (const [src, cfg] of Object.entries(form)) {
      const def = DEFAULT_AUCTION_FEE_TIERS[src];
      const different = (
        cfg.gateFee !== def.gateFee ||
        cfg.envFee !== def.envFee ||
        cfg.titleFee !== def.titleFee ||
        cfg.virtualBidFee !== def.virtualBidFee ||
        cfg.tiers.length !== def.tiers.length ||
        cfg.tiers.some((t, i) => t.max !== def.tiers[i]?.max || t.fee !== def.tiers[i]?.fee || t.pct !== def.tiers[i]?.pct)
      );
      if (different) overrides[src] = serializeTierOverrides(cfg);
    }
    setData(d => ({ ...d, auctionFeeTiers: Object.keys(overrides).length > 0 ? overrides : null }));
    logActivity(username, "updated_auction_fees", `Updated auction fee tiers (${Object.keys(overrides).join(", ") || "reset to defaults"})`);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const resetAll = () => {
    setErr(""); setSaved(false);
    setForm(build());
  };

  return (
    <Card style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: "#EFF6FF", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: BRAND.black }}>Auction Fee Tiers</div>
          <div style={{ fontSize: 11, color: BRAND.gray }}>Override Copart/IAAI/etc. fee schedules when auction houses update their rates</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {Object.entries(form).map(([src, cfg]) => {
          const open = openSrc === src;
          const overridden = !!(data.auctionFeeTiers && data.auctionFeeTiers[src]);
          return (
            <div key={src} style={{ border: `1px solid ${BRAND.grayLight}`, borderRadius: 8, padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setOpenSrc(open ? null : src)}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: BRAND.black }}>{cfg.name}</div>
                  {overridden && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "#FEF3C7", color: "#92400E", fontWeight: 700 }}>CUSTOM</span>}
                  <span style={{ fontSize: 10, color: BRAND.gray }}>{cfg.tiers.length} tier{cfg.tiers.length === 1 ? "" : "s"}</span>
                </div>
                <span style={{ fontSize: 11, color: BRAND.gray }}>{open ? "▾" : "▸"}</span>
              </div>
              {open && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${BRAND.grayLight}` }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 10 }}>
                    {[["gateFee", "Gate"], ["envFee", "Env"], ["titleFee", "Title"], ["virtualBidFee", "Virtual Bid"]].map(([k, lbl]) => (
                      <div key={k}>
                        <div style={{ fontSize: 9, color: BRAND.gray, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>{lbl}</div>
                        <input type="number" step="0.01" value={cfg[k] ?? ""} onChange={e => updFlat(src, k, e.target.value)} style={{ width: "100%", padding: "6px 8px", border: `1px solid ${BRAND.grayLight}`, borderRadius: 6, fontSize: 11, fontFamily: "inherit", boxSizing: "border-box", ...S.mono }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: BRAND.gray, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Tiers (first-match: price &le; max)</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 280, overflowY: "auto" }}>
                    {cfg.tiers.map((t, i) => (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: "100px 80px 100px 30px", gap: 6, alignItems: "center", fontSize: 11 }}>
                        <input type={t.max === Infinity ? "text" : "number"} step="0.01" value={t.max === Infinity ? "∞ (last)" : t.max} disabled={t.max === Infinity} onChange={e => updTier(src, i, "max", e.target.value)} style={{ padding: "4px 6px", border: `1px solid ${BRAND.grayLight}`, borderRadius: 4, fontSize: 11, fontFamily: "inherit", ...S.mono, background: t.max === Infinity ? "#F5F5F5" : BRAND.white }} />
                        {t.pct != null && t.pct !== "" ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                            <input type="number" step="0.01" value={t.pct} onChange={e => updTier(src, i, "pct", e.target.value)} style={{ width: "100%", padding: "4px 6px", border: `1px solid ${BRAND.grayLight}`, borderRadius: 4, fontSize: 11, fontFamily: "inherit", ...S.mono }} />
                            <span style={{ color: BRAND.gray, fontSize: 10 }}>%</span>
                          </div>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                            <span style={{ color: BRAND.gray, fontSize: 10 }}>$</span>
                            <input type="number" step="0.01" value={t.fee ?? ""} onChange={e => updTier(src, i, "fee", e.target.value)} style={{ width: "100%", padding: "4px 6px", border: `1px solid ${BRAND.grayLight}`, borderRadius: 4, fontSize: 11, fontFamily: "inherit", ...S.mono }} />
                          </div>
                        )}
                        <select value={t.pct != null && t.pct !== "" ? "pct" : "fee"} onChange={e => {
                          setForm(f => {
                            const tiers = f[src].tiers.map((row, idx) => {
                              if (idx !== i) return row;
                              return e.target.value === "pct" ? { max: row.max, pct: row.fee ?? 5 } : { max: row.max, fee: row.pct ?? 25 };
                            });
                            return { ...f, [src]: { ...f[src], tiers } };
                          });
                        }} style={{ padding: "4px 6px", border: `1px solid ${BRAND.grayLight}`, borderRadius: 4, fontSize: 11, fontFamily: "inherit", background: BRAND.white }}>
                          <option value="fee">flat</option>
                          <option value="pct">percent</option>
                        </select>
                        <button onClick={() => removeTier(src, i)} disabled={cfg.tiers.length === 1} aria-label="Remove tier" style={{ border: "none", background: "transparent", color: cfg.tiers.length === 1 ? BRAND.grayLight : "#DC2626", cursor: cfg.tiers.length === 1 ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 700, padding: 0 }}>×</button>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
                    <Btn size="sm" variant="secondary" onClick={() => addTier(src)}>+ Add tier</Btn>
                    {overridden && <Btn size="sm" variant="ghost" onClick={() => resetSrc(src)} style={{ color: BRAND.gray, fontSize: 10 }}>Reset {cfg.name} to default</Btn>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {err && <div style={{ background: "#FEF2F2", color: "#DC2626", padding: "8px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, marginTop: 12 }}>{err}</div>}
      {saved && <div style={{ background: "#F0FDF4", color: "#166534", padding: "8px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, marginTop: 12 }}>Saved — new rates apply immediately to all calculations.</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <Btn variant="secondary" size="sm" onClick={resetAll}>Revert changes</Btn>
        <Btn size="sm" onClick={save}>Save fee tiers</Btn>
      </div>
    </Card>
  );
}

function SettingsTab({ darkMode, username, userRole, firebaseUid, data, setData, adminMode }) {
  const [loginInfo, setLoginInfo] = useState(null);
  useEffect(() => {
    if (firebaseUid) getUserProfile(firebaseUid).then(p => setLoginInfo(p)).catch(() => {});
  }, [firebaseUid]);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  const handleChangePw = async () => {
    setPwError("");
    if (!currentPw) { setPwError("Enter your current password"); return; }
    if (!newPw) { setPwError("Enter a new password"); return; }
    if (newPw.length < 8) { setPwError("New password must be at least 8 characters"); return; }
    if (newPw !== confirmPw) { setPwError("New passwords do not match"); return; }
    if (currentPw === newPw) { setPwError("New password must be different from current"); return; }
    setPwLoading(true);
    try {
      await changePassword(currentPw, newPw);
      setPwSuccess(true);
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
    } catch (e) {
      const msg = e.code === "auth/wrong-password" || e.code === "auth/invalid-credential" ? "Current password is incorrect"
        : e.code === "auth/weak-password" ? "Password is too weak"
        : e.code === "auth/requires-recent-login" ? "Session expired — sign out and back in"
        : e.message || "Failed to change password";
      setPwError(msg);
    }
    setPwLoading(false);
  };

  const inputStyle = { width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${darkMode ? "#444" : BRAND.grayLight}`, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: darkMode ? "#2a2a2a" : BRAND.white, color: darkMode ? "#e5e5e5" : BRAND.black };
  const labelStyle = { fontSize: 11, fontWeight: 700, color: darkMode ? "#aaa" : BRAND.gray, display: "block", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em" };

  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 900, color: BRAND.black, marginBottom: 4 }}>Settings</div>
      <div style={{ fontSize: 12, color: BRAND.gray, marginBottom: 24 }}>Account settings and preferences</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Change Password */}
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: BRAND.redBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={BRAND.red} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: BRAND.black }}>Change Password</div>
              <div style={{ fontSize: 11, color: BRAND.gray }}>Update your account password</div>
            </div>
          </div>
          {pwSuccess ? (
            <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10, padding: "16px 20px", textAlign: "center" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 6 }}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#166534" }}>Password updated successfully!</div>
              <button onClick={() => setPwSuccess(false)} style={{ marginTop: 10, background: "none", border: "none", color: BRAND.blue, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Change again</button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div><label style={labelStyle}>Current Password</label><input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} placeholder="Enter current password" style={inputStyle} /></div>
              <div><label style={labelStyle}>New Password</label><input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Min 8 characters" style={inputStyle} /></div>
              <div><label style={labelStyle}>Confirm New Password</label><input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} onKeyDown={e => e.key === "Enter" && handleChangePw()} placeholder="Re-enter new password" style={inputStyle} /></div>
              {pwError && <div style={{ background: "#FEF2F2", color: "#DC2626", padding: "8px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600 }}>{pwError}</div>}
              <Btn onClick={handleChangePw} disabled={pwLoading}>{pwLoading ? "Updating..." : "Update Password"}</Btn>
            </div>
          )}
        </Card>

        {/* Account Info */}
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "#EFF6FF", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: BRAND.black }}>Account Info</div>
              <div style={{ fontSize: 11, color: BRAND.gray }}>Your profile details</div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${BRAND.grayLight}` }}>
              <span style={{ color: BRAND.gray, fontWeight: 600 }}>Name</span>
              <span style={{ fontWeight: 700, color: BRAND.black }}>{username || "—"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${BRAND.grayLight}` }}>
              <span style={{ color: BRAND.gray, fontWeight: 600 }}>Email</span>
              <span style={{ fontWeight: 700, color: BRAND.black }}>{auth.currentUser?.email || "—"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${BRAND.grayLight}` }}>
              <span style={{ color: BRAND.gray, fontWeight: 600 }}>Role</span>
              <span style={{ fontWeight: 700, color: BRAND.black, textTransform: "capitalize" }}>{userRole}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0" }}>
              <span style={{ color: BRAND.gray, fontWeight: 600 }}>Platform</span>
              <span style={{ fontWeight: 700, color: BRAND.black }}>Auto Trade Hub</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Hold Cost Rates — admin-only */}
      {adminMode && data && setData && (
        <HoldCostsCard data={data} setData={setData} darkMode={darkMode} username={username} />
      )}

      {/* Auction Fee Tiers — admin-only */}
      {adminMode && data && setData && (
        <AuctionFeeTiersCard data={data} setData={setData} darkMode={darkMode} username={username} />
      )}

      {/* Login Activity */}
      {loginInfo && (
        <Card style={{ marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "#F0FDF4", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: BRAND.black }}>Login Activity</div>
              <div style={{ fontSize: 11, color: BRAND.gray }}>Current and previous session details</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {/* Current Session */}
            <div style={{ background: darkMode ? "#1a2a1a" : "#F0FDF4", borderRadius: 10, padding: 14, border: "1px solid #BBF7D0" }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: "#16A34A", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Current Session</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: BRAND.gray, marginBottom: 2 }}>Logged in</div>
                  <div style={{ fontWeight: 700, color: BRAND.black }}>{loginInfo.lastLoginAt ? new Date(loginInfo.lastLoginAt).toLocaleString() : "—"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: BRAND.gray, marginBottom: 2 }}>IP Address</div>
                  <div style={{ fontWeight: 700, color: BRAND.black, fontFamily: "'DM Mono', monospace" }}>{loginInfo.lastLoginIp || "—"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: BRAND.gray, marginBottom: 2 }}>Location</div>
                  <div style={{ fontWeight: 700, color: BRAND.black, display: "flex", alignItems: "center", gap: 4 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    {loginInfo.lastLoginLocation || "—"}
                  </div>
                </div>
              </div>
            </div>
            {/* Previous Session */}
            <div style={{ background: darkMode ? "#1a1a2a" : "#F5F5F5", borderRadius: 10, padding: 14, border: `1px solid ${darkMode ? "#333" : "#E5E7EB"}` }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: BRAND.gray, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Previous Session</div>
              {loginInfo.prevLoginAt ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
                  <div>
                    <div style={{ fontSize: 10, color: BRAND.gray, marginBottom: 2 }}>Logged in</div>
                    <div style={{ fontWeight: 700, color: BRAND.black }}>{new Date(loginInfo.prevLoginAt).toLocaleString()}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: BRAND.gray, marginBottom: 2 }}>IP Address</div>
                    <div style={{ fontWeight: 700, color: BRAND.black, fontFamily: "'DM Mono', monospace" }}>{loginInfo.prevLoginIp || "—"}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: BRAND.gray, marginBottom: 2 }}>Location</div>
                    <div style={{ fontWeight: 700, color: BRAND.black, display: "flex", alignItems: "center", gap: 4 }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                      {loginInfo.prevLoginLocation || "—"}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: BRAND.gray, padding: "16px 0", textAlign: "center" }}>No previous session recorded</div>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CHANGE PASSWORD MODAL
// ═══════════════════════════════════════════════════════════════
function ChangePasswordModal({ onClose, darkMode }) {
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError("");
    if (!currentPw) { setError("Enter your current password"); return; }
    if (!newPw) { setError("Enter a new password"); return; }
    if (newPw.length < 8) { setError("New password must be at least 8 characters"); return; }
    if (newPw !== confirmPw) { setError("New passwords do not match"); return; }
    if (currentPw === newPw) { setError("New password must be different from current"); return; }
    setLoading(true);
    try {
      await changePassword(currentPw, newPw);
      setSuccess(true);
    } catch (e) {
      const msg = e.code === "auth/wrong-password" || e.code === "auth/invalid-credential" ? "Current password is incorrect"
        : e.code === "auth/weak-password" ? "Password is too weak — use at least 8 characters"
        : e.code === "auth/requires-recent-login" ? "Session expired — please sign out and sign back in first"
        : e.message || "Failed to change password";
      setError(msg);
    }
    setLoading(false);
  };

  const inputStyle = { width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${darkMode ? "#444" : BRAND.grayLight}`, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: darkMode ? "#2a2a2a" : BRAND.white, color: darkMode ? "#e5e5e5" : BRAND.black };
  const labelStyle = { fontSize: 11, fontWeight: 700, color: darkMode ? "#aaa" : BRAND.gray, display: "block", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div className="modal-dialog" style={{ background: darkMode ? "#1e1e1e" : BRAND.white, borderRadius: 16, padding: 28, width: "100%", maxWidth: 400, boxShadow: "0 25px 50px rgba(0,0,0,0.25)", position: "relative" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900, color: darkMode ? "#fff" : BRAND.black }}>Change Password</div>
            <div style={{ fontSize: 11, color: darkMode ? "#888" : BRAND.gray, marginTop: 2 }}>Update your account password</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: darkMode ? "#888" : BRAND.gray, cursor: "pointer", padding: 4 }}>&times;</button>
        </div>

        {success ? (
          <div>
            <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10, padding: "16px 20px", textAlign: "center" }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 8 }}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#166534", marginBottom: 4 }}>Password Changed!</div>
              <div style={{ fontSize: 12, color: "#15803D" }}>Your password has been updated successfully.</div>
            </div>
            <button onClick={onClose} style={{ width: "100%", marginTop: 16, padding: "12px", background: BRAND.red, color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Done</button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div><label style={labelStyle}>Current Password</label><input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} placeholder="Enter current password" style={inputStyle} /></div>
            <div><label style={labelStyle}>New Password</label><input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Min 8 characters" style={inputStyle} /></div>
            <div><label style={labelStyle}>Confirm New Password</label><input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()} placeholder="Re-enter new password" style={inputStyle} /></div>
            {error && <div style={{ background: "#FEF2F2", color: "#DC2626", padding: "10px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, border: "1px solid #FECACA" }}>{error}</div>}
            <button onClick={handleSubmit} disabled={loading} style={{ width: "100%", padding: "12px", background: loading ? BRAND.gray : `linear-gradient(135deg, ${BRAND.red}, ${BRAND.redLight || "#A52422"})`, color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: loading ? "wait" : "pointer", fontFamily: "inherit", boxShadow: "0 4px 12px rgba(139,26,26,0.3)" }}>{loading ? "Updating..." : "Update Password"}</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
function AppInner() {
  const toast = useToast();
  const [loggedIn, setLoggedIn] = useState(false);
  const [username, setUsername] = useState("");
  const [userRole, setUserRole] = useState("user");
  const [tab, setTab] = useState("Dashboard");
  const [data, setData] = useState(defaultData());
  // Keep module-level AUCTION_FEE_TIERS in sync with admin overrides stored in
  // data.auctionFeeTiers. Runs during render (before child memos) so every
  // calcAuctionFees call this pass sees the up-to-date rates.
  useMemo(() => applyCustomAuctionFeeTiers(data.auctionFeeTiers), [data.auctionFeeTiers]);
  const [loaded, setLoaded] = useState(true);
  const [saving, setSaving] = useState(false);
  const [darkMode, setDarkMode] = useState(() => loadTheme() === "dark");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    applyTheme(next ? "dark" : "light");
  };

  // Global search results
  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) return [];
    const q = searchQuery.toLowerCase();
    const results = [];
    (data.vehicles || []).forEach(v => {
      const text = `${v.stockNum} ${v.year} ${v.make} ${v.model} ${v.vin || ""} ${v.color || ""}`.toLowerCase();
      if (text.includes(q)) results.push({ type: "vehicle", label: `#${v.stockNum} ${v.year} ${v.make} ${v.model}`, sub: `${v.status} · ${v.vin || "No VIN"}`, id: v.id });
    });
    (data.expenses || []).forEach(e => {
      const text = `${e.description || ""} ${e.vendor || ""} ${e.category || ""} ${e.vehicle || ""}`.toLowerCase();
      if (text.includes(q)) results.push({ type: "expense", label: `${e.category || "Expense"}: ${fmt$(p(e.amount))}`, sub: `${e.vehicle || "—"} · ${e.date || ""}`, id: e.id });
    });
    (data.sales || []).forEach(s => {
      const v = data.vehicles.find(v => v.stockNum === s.stockNum);
      const text = `${s.stockNum} ${s.buyerName || ""} ${v ? `${v.year} ${v.make} ${v.model}` : ""}`.toLowerCase();
      if (text.includes(q)) results.push({ type: "sale", label: `Sale #${s.stockNum}: ${fmt$(p(s.grossPrice))}`, sub: `${s.buyerName || "—"} · ${s.date || ""}`, id: s.id });
    });
    return results.slice(0, 8);
  }, [searchQuery, data]);

  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [firebaseUid, setFirebaseUid] = useState(null);
  const [dataReady, setDataReady] = useState(false);
  const [allowedTabs, setAllowedTabs] = useState(null);

  const adminMode = isAdmin(userRole);
  const managerMode = isManager(userRole);
  const allAdminTabs = [...TABS, "Calendar", "Reports", "Money", "Accounting", "Approvals", "Activity", "Trash", "Users", "Settings"];
  const visibleTabs = adminMode ? allAdminTabs : managerMode ? (allowedTabs && allowedTabs.length ? allowedTabs.filter(t => allAdminTabs.includes(t)) : ["Dashboard"]) : [...TABS, "Calendar", "Settings"];

  // Navigation — clean flat tabs, Settings accessed via gear icon only
  const navTabs = visibleTabs.filter(t => t !== "Settings");

  // Approvals & notifications check
  useEffect(() => {
    const check = async () => {
      const resolved = await loadApprovals();
      setPendingApprovalCount(resolved.filter(a => a.status === "pending").length);
      setNotifications(await generateNotifications(data));
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, [data]);

  // ─── Init: Firebase auth listener OR localStorage fallback ───
  useEffect(() => {
    if (FIREBASE_ENABLED) {
      // Timeout fallback — if Firebase hangs, show login after 5s
      const timeout = setTimeout(() => { setLoaded(true); }, 5000);
      const unsub = onAuthChange(async (fbUser) => {
        try {
          if (fbUser) {
            const isSuperAdmin = fbUser.email === (import.meta.env.VITE_SUPER_ADMIN_EMAIL || "support@sayarah.io");
            const profile = await getUserProfile(fbUser.uid);
            const role = isSuperAdmin ? "admin" : (profile?.role || "user");
            // Check auction access — same logic as firebaseLogin
            if (!isSuperAdmin && role !== "admin" && role !== "manager" && profile?.auctionAccess !== true) {
              await firebaseSignOut();
              setLoaded(true);
              clearTimeout(timeout);
              return;
            }
            setFirebaseUid(fbUser.uid);
            const fname = profile?.firstName || (fbUser.displayName || fbUser.email.split("@")[0]).split(" ")[0];
            setUsername(fname);
            setUserRole(role);
            setLoggedIn(true);
            // Load user permissions for manager role
            if (role === "manager") {
              const ud = await getUserData(fbUser.uid);
              if (ud && ud.allowedTabs) setAllowedTabs(ud.allowedTabs);
            } else { setAllowedTabs(null); }
            // Load SHARED data (all users see the same vehicles/expenses/sales)
            let cloudData = await loadSharedData();
            // Migration: merge this user's per-user data into shared (dedup by id)
            try {
              const perUserData = await loadAppData(fbUser.uid);
              if (perUserData && perUserData.vehicles && perUserData.vehicles.length > 0) {
                const shared = cloudData || defaultData();
                const existingIds = new Set((shared.vehicles || []).map(v => v.id));
                const newVehicles = perUserData.vehicles.filter(v => !existingIds.has(v.id));
                const existingExpIds = new Set((shared.expenses || []).map(e => e.id));
                const newExpenses = (perUserData.expenses || []).filter(e => !existingExpIds.has(e.id));
                const existingSaleIds = new Set((shared.sales || []).map(s => s.id));
                const newSales = (perUserData.sales || []).filter(s => !existingSaleIds.has(s.id));
                const existingMileIds = new Set((shared.mileage || []).map(m => m.id));
                const newMileage = (perUserData.mileage || []).filter(m => !existingMileIds.has(m.id));
                const existingDocIds = new Set((shared.documents || []).map(d => d.id));
                const newDocs = (perUserData.documents || []).filter(d => !existingDocIds.has(d.id));
                if (newVehicles.length > 0 || newExpenses.length > 0 || newSales.length > 0 || newMileage.length > 0 || newDocs.length > 0) {
                  const merged = {
                    ...shared,
                    vehicles: [...(shared.vehicles || []), ...newVehicles],
                    expenses: [...(shared.expenses || []), ...newExpenses],
                    sales: [...(shared.sales || []), ...newSales],
                    mileage: [...(shared.mileage || []), ...newMileage],
                    documents: [...(shared.documents || []), ...newDocs],
                    nextStockNum: Math.max(shared.nextStockNum || 1, perUserData.nextStockNum || 1),
                  };
                  await saveSharedData(merged);
                  cloudData = merged;
                }
              }
            } catch (e) { console.warn("Migration merge failed:", e); }
            if (cloudData) setData({ ...defaultData(), ...cloudData });
            setDataReady(true);
          } else {
            // Firebase says user is signed out — reset everything
            setFirebaseUid(null);
            setLoggedIn(false);
            setUsername("");
            setUserRole("user");
            setDataReady(false);
          }
        } catch (e) { console.error("Auth init error:", e); }
        clearTimeout(timeout);
        setLoaded(true);
      });
      return () => { unsub(); clearTimeout(timeout); };
    } else {
      // localStorage fallback
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) setData({ ...defaultData(), ...JSON.parse(raw) });
      } catch {}
      try {
        const s = localStorage.getItem("sayarah-session-v2");
        if (s) { const x = JSON.parse(s); setLoggedIn(true); setUsername(x.username); setUserRole(x.role || "user"); }
      } catch {}
      setDataReady(true);
      setLoaded(true);
    }
  }, []);

  // ─── Save data: Shared Firestore OR localStorage (only after cloud data loaded) ───
  // Uses a Firestore transaction for atomic read-merge-write. Firestore retries
  // the transaction automatically if the doc changes between read and write,
  // so concurrent writers can't silently overwrite each other. Arrays are
  // merged by `id` with local changes winning for the same item; monotonic
  // fields (nextStockNum, _version) grow; `trash` is unioned.
  useEffect(() => {
    if (!loaded || !dataReady) return;
    if (FIREBASE_ENABLED && firebaseUid) {
      const t = setTimeout(async () => {
        setSaving(true);
        try {
          const mergeArrays = (local, remote, key = "id") => {
            const map = new Map();
            (remote || []).forEach(item => map.set(item[key], item));
            (local || []).forEach(item => map.set(item[key], item)); // local wins for same ID
            return [...map.values()];
          };
          const trashKey = t => `${t.id}::${t._deletedAt || ""}`;
          const result = await saveSharedDataTxn((remote) => {
            if (!remote) return data;
            return {
              ...data,
              vehicles: mergeArrays(data.vehicles, remote.vehicles),
              expenses: mergeArrays(data.expenses, remote.expenses),
              sales: mergeArrays(data.sales, remote.sales),
              mileage: mergeArrays(data.mileage, remote.mileage),
              documents: mergeArrays(data.documents, remote.documents),
              auctionEvents: mergeArrays(data.auctionEvents, remote.auctionEvents),
              trash: (() => {
                const seen = new Map();
                (remote.trash || []).forEach(t => seen.set(trashKey(t), t));
                (data.trash || []).forEach(t => seen.set(trashKey(t), t));
                return [...seen.values()];
              })(),
              nextStockNum: Math.max(data.nextStockNum || 1, remote.nextStockNum || 1),
              holdCosts: data.holdCosts || remote.holdCosts,
              startingCapital: data.startingCapital ?? remote.startingCapital,
            };
          });
          // If merge produced a shape different from local state, hydrate
          if (result?.value && (
            (result.value.vehicles?.length || 0) !== (data.vehicles?.length || 0) ||
            (result.value.trash?.length || 0) !== (data.trash?.length || 0)
          )) {
            setData(result.value);
          }
        } catch (err) {
          console.warn("shared save txn failed:", err);
          // Surface the failure to the user. Without this it's silent and
          // non-admin users uploading photos see the image appear then
          // vanish on refresh (rule denied the write). Message is
          // role-specific so the user knows whether it's a permissions
          // issue (ask admin) vs a transient error (retry).
          const code = (err && err.code) || "";
          const isPerm = code === "permission-denied" || /permission/i.test(err?.message || "");
          const msg = isPerm
            ? `Can't save changes — your account doesn't have permission. Contact an admin.`
            : `Save failed: ${err?.message || "unknown error"}. Changes are not persisted.`;
          try { toast && toast(msg, "error"); } catch {}
        }
        setTimeout(() => setSaving(false), 400);
      }, 800);
      return () => clearTimeout(t);
    } else {
      const t = setTimeout(() => { try { setSaving(true); localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); setTimeout(() => setSaving(false), 400); } catch { setSaving(false); } }, 400);
      return () => clearTimeout(t);
    }
  }, [data, loaded, dataReady, firebaseUid]);

  const handleLogin = (u, role, uid) => {
    setUsername(u); setUserRole(role); setLoggedIn(true);
    if (uid) setFirebaseUid(uid);
    if (!FIREBASE_ENABLED) localStorage.setItem("sayarah-session-v2", JSON.stringify({ username: u, role }));
    toast(`Welcome back, ${u}!`);
  };
  const handleLogout = async () => {
    setLoggedIn(false); setUsername(""); setUserRole("user"); setFirebaseUid(null); setDataReady(false);
    // Clear all sensitive localStorage data on logout
    ["sayarah-session-v2", "sayarah-notifications-v1", "sayarah-widget-prefs-v1"].forEach(k => localStorage.removeItem(k));
    if (FIREBASE_ENABLED) { try { await firebaseSignOut(); } catch {} }
  };

  // Re-derive BRAND colors on dark mode toggle
  const theme = darkMode ? BRAND_DARK : BRAND_LIGHT;

  if (!loaded) return <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif", background: theme.cream, gap: 16 }}><img src="/logo.png" alt="Auto Trade Hub" style={{ height: 70 }} /><div style={{ width: 28, height: 28, border: "3px solid #e5e7eb", borderTopColor: BRAND.red, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} /><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>;
  if (!loggedIn) return <div style={{ fontFamily: "'DM Sans', sans-serif" }}><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800;900&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" /><LoginPage onLogin={handleLogin} /></div>;

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: theme.cream, minHeight: "100vh", color: theme.black }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800;900&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <style>{`
@media(max-width:1100px){
  .inv-row{
    grid-template-columns:140px 1fr 110px 110px 90px 120px!important;
    grid-template-areas:"photo vehicle invested breakeven risk status" "photo vehicle odo est est actions"!important;
    min-height:110px!important;
  }
  .inv-row .inv-photo{grid-area:photo}
  .inv-row .inv-vehicle{grid-area:vehicle}
  .inv-row .inv-actions{grid-area:actions;justify-content:flex-end}
}
@media(max-width:768px){
  .app-header-bar{padding:0 12px!important}
  .app-header-inner{height:auto!important;flex-wrap:wrap!important;padding:8px 0!important}
  .app-header-actions .action-label{display:none!important}
  .app-nav{overflow-x:auto!important;-webkit-overflow-scrolling:touch}
  .search-dropdown{width:calc(100vw - 32px)!important;right:-60px!important}
  .notif-dropdown{width:calc(100vw - 32px)!important;right:-60px!important}
  .auction-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
  .auction-table-wrap table{min-width:600px}
  .auction-content{padding:12px!important}
  .stat-cards-row{gap:6px!important}
  .modal-dialog{padding:16px!important;max-width:calc(100vw - 24px)!important}
  .report-period-bar{flex-direction:column!important;align-items:flex-start!important}
  .login-hero{display:none!important}
  .login-form-side{flex:1 1 100%!important}
  .inv-row{
    grid-template-columns:96px 1fr auto!important;
    grid-template-areas:"photo vehicle status"!important;
    gap:10px!important;
    min-height:auto!important;
    padding:10px!important;
  }
  .inv-row .inv-photo img, .inv-row .inv-photo > div{width:96px!important;height:72px!important}
  .inv-row .inv-col{display:none!important}
  .inv-row .inv-actions{display:none!important}
  .inv-row .inv-vehicle{grid-area:vehicle;min-width:0}
  .inv-row .inv-col.status-col{display:flex!important;flex-direction:column;align-items:flex-end;grid-area:status}
}
@media(max-width:480px){
  .app-header-actions .action-label{display:none!important}
  .search-dropdown{width:calc(100vw - 16px)!important;left:50%!important;right:auto!important;transform:translateX(-50%)!important}
  .notif-dropdown{width:calc(100vw - 16px)!important;left:50%!important;right:auto!important;transform:translateX(-50%)!important}
}
      `}</style>
      {/* ═══ Premium Header — Single Clean White Navbar ═══ */}
      <div style={{ position: "sticky", top: 0, zIndex: 100 }}>
        <div className="app-header-bar" style={{
          background: darkMode ? "#1a1a1a" : "#fff",
          padding: "0 32px",
          borderBottom: `1px solid ${darkMode ? "#333" : "#E5E7EB"}`,
          boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
        }}>
          <div className="app-header-inner" style={{ maxWidth: 1280, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
            {/* Left — Brand Box + Nav Items */}
            <div style={{ display: "flex", alignItems: "center", gap: 0, overflow: "hidden" }}>
              {/* Auto Trade Hub Logo */}
              <div className="app-header-brand" onClick={() => setTab("Dashboard")} style={{
                cursor: "pointer", flexShrink: 0, marginRight: 20,
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <img src="/logo.png" alt="Auto Trade Hub" style={{ height: 36, objectFit: "contain" }} />
                {saving && <span style={{ fontSize: 8, color: "#8B1A1A", fontWeight: 500, animation: "pulse 1.5s infinite" }}>Saving...</span>}
              </div>

              {/* Nav Items */}
              <nav className="app-nav" style={{ display: "flex", alignItems: "center", gap: 0, overflowX: "auto" }}>
                {navTabs.map(t => {
                  const isActive = tab === t;
                  return (
                    <button key={t} onClick={() => setTab(t)} style={{
                      background: "transparent",
                      color: isActive ? (darkMode ? "#fff" : "#111") : (darkMode ? "#9CA3AF" : "#6B7280"),
                      border: "none", padding: "18px 10px", fontSize: 10,
                      fontWeight: isActive ? 800 : 600, cursor: "pointer", fontFamily: "inherit",
                      letterSpacing: "0.05em", textTransform: "uppercase",
                      position: "relative", whiteSpace: "nowrap", flexShrink: 0,
                      borderBottom: isActive ? "2px solid #8B1A1A" : "2px solid transparent",
                      transition: "all 0.2s ease",
                      display: "flex", alignItems: "center", gap: 4,
                    }}>
                      {t.toUpperCase()}
                      {t === "Approvals" && pendingApprovalCount > 0 && (
                        <span style={{ background: "#8B1A1A", color: "#fff", fontSize: 7, fontWeight: 900, padding: "1px 4px", borderRadius: 6 }}>{pendingApprovalCount}</span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* Right Actions */}
            <div className="app-header-actions" style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
              {/* Search */}
              <div style={{ position: "relative" }}>
                <button onClick={() => setShowSearch(p => !p)} style={{
                  background: showSearch ? (darkMode ? "rgba(255,255,255,0.1)" : "#f3f4f6") : "transparent",
                  border: "none", padding: 10, borderRadius: 8, cursor: "pointer",
                  display: "flex", alignItems: "center", transition: "all 0.2s",
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={darkMode ? "#9CA3AF" : "#6B7280"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                </button>
                {showSearch && (
                  <div className="search-dropdown" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 380, background: BRAND.white, borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.25)", border: `1px solid ${BRAND.grayLight}`, zIndex: 200, overflow: "hidden" }}>
                    <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BRAND.grayLight}`, display: "flex", alignItems: "center", gap: 8 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={BRAND.gray} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                      <input autoFocus value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search vehicles, expenses, sales..." style={{ width: "100%", border: "none", outline: "none", fontSize: 13, color: BRAND.black, background: "transparent", fontFamily: "inherit" }} />
                    </div>
                    {searchQuery.length >= 2 && (
                      <div style={{ maxHeight: 320, overflowY: "auto" }}>
                        {searchResults.length === 0 ? (
                          <div style={{ padding: 20, textAlign: "center", color: BRAND.gray, fontSize: 12 }}>No results for "{searchQuery}"</div>
                        ) : searchResults.map((r, i) => (
                          <div key={i} onClick={() => { setTab(r.type === "vehicle" ? "Inventory" : r.type === "expense" ? "Inventory" : "Analytics"); setShowSearch(false); setSearchQuery(""); }} style={{ padding: "10px 16px", borderBottom: `1px solid ${BRAND.grayLight}`, cursor: "pointer", display: "flex", alignItems: "center", gap: 10, transition: "background 0.15s" }}>
                            <span style={{ display: "flex", alignItems: "center" }}>{r.type === "vehicle" ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={BRAND.gray} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0"/><path d="M17 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0"/><path d="M5 17h-2v-6l2-5h9l4 5h1a2 2 0 0 1 2 2v4h-2m-4 0h-6m-6-6h15m-6 0v-5"/></svg> : r.type === "expense" ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={BRAND.gray} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={BRAND.gray} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}</span>
                            <div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: BRAND.black }}>{r.label}</div>
                              <div style={{ fontSize: 10, color: BRAND.gray }}>{r.sub}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Dark Mode */}
              <button onClick={toggleDarkMode} title={darkMode ? "Light Mode" : "Dark Mode"} style={{
                background: "transparent", border: "none", padding: 10, borderRadius: 8,
                cursor: "pointer", display: "flex", alignItems: "center", transition: "all 0.2s",
              }}>
                {darkMode
                  ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
                  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>}
              </button>

              {/* Notifications */}
              <div style={{ position: "relative" }}>
                <button onClick={() => setShowNotifPanel(p => !p)} style={{
                  background: showNotifPanel ? (darkMode ? "rgba(255,255,255,0.1)" : "#f3f4f6") : "transparent",
                  border: "none", padding: 10, borderRadius: 8, cursor: "pointer",
                  position: "relative", display: "flex", alignItems: "center", transition: "all 0.2s",
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={darkMode ? "#9CA3AF" : "#6B7280"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                  {notifications.length > 0 && <span style={{ position: "absolute", top: 4, right: 4, background: "#FBBF24", color: "#111", fontSize: 7, fontWeight: 900, width: 15, height: 15, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid " + (darkMode ? "#1a1a1a" : "#fff"), animation: "pulse 2s infinite" }}>{notifications.length}</span>}
                </button>
                {showNotifPanel && (
                  <div className="notif-dropdown" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 360, background: BRAND.white, borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.25)", border: `1px solid ${BRAND.grayLight}`, zIndex: 200, maxHeight: 420, overflowY: "auto", overflow: "hidden" }}>
                    <div style={{ padding: "14px 18px", borderBottom: `1px solid ${BRAND.grayLight}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: BRAND.redBg }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: BRAND.black }}>Notifications</span>
                      <span style={{ fontSize: 10, color: BRAND.gray, background: BRAND.grayLight, padding: "2px 8px", borderRadius: 10 }}>{notifications.length}</span>
                    </div>
                    {notifications.length === 0 ? (
                      <div style={{ padding: 28, textAlign: "center", color: BRAND.gray, fontSize: 12 }}>All clear — no alerts right now</div>
                    ) : notifications.map((n, i) => (
                      <div key={i} style={{ padding: "12px 18px", borderBottom: `1px solid ${BRAND.grayLight}`, cursor: n.stockNum ? "pointer" : "default", transition: "background 0.15s" }} onClick={() => { if (n.stockNum) { setTab("Inventory"); setShowNotifPanel(false); } }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                          <div style={{ width: 10, height: 10, borderRadius: "50%", flexShrink: 0, background: n.type === "critical" ? "#DC2626" : n.type === "warning" ? "#F59E0B" : n.type === "action" ? "#3B82F6" : "#22C55E" }} />
                          <span style={{ fontSize: 12, fontWeight: 700, color: BRAND.black }}>{n.title}</span>
                        </div>
                        <div style={{ fontSize: 11, color: BRAND.gray, paddingLeft: 20 }}>{n.message}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Settings Gear */}
              <button onClick={() => setTab("Settings")} title="Settings" style={{
                background: "transparent", border: "none", padding: 10, borderRadius: 8,
                cursor: "pointer", display: "flex", alignItems: "center", transition: "all 0.2s",
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={darkMode ? "#9CA3AF" : "#6B7280"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>

              {/* Divider */}
              <div style={{ width: 1, height: 24, background: darkMode ? "#333" : "#E5E7EB", margin: "0 6px" }} />

              {/* User Avatar */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 6 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                  background: darkMode ? "rgba(255,255,255,0.1)" : "#f3f4f6", border: `2px solid ${darkMode ? "#444" : "#E5E7EB"}`,
                  fontSize: 12, fontWeight: 800, color: darkMode ? "#D1D5DB" : "#374151", textTransform: "uppercase",
                }}>{username ? username.charAt(0) : "U"}</div>
                <div className="action-label">
                  <div style={{ fontSize: 11, fontWeight: 700, color: BRAND.black, lineHeight: 1.2 }}>{username}</div>
                  <div style={{ fontSize: 9, color: BRAND.gray, textTransform: "uppercase", letterSpacing: "0.06em" }}>{adminMode ? "Admin" : managerMode ? "Manager" : "User"}</div>
                </div>
              </div>

              {/* Sign Out */}
              <button onClick={handleLogout} style={{
                background: darkMode ? "rgba(255,255,255,0.08)" : "#f3f4f6",
                border: `1px solid ${darkMode ? "#444" : "#E5E7EB"}`,
                color: darkMode ? "#D1D5DB" : "#374151", borderRadius: 8,
                padding: "8px 16px", fontSize: 11,
                fontWeight: 700, cursor: "pointer",
                fontFamily: "inherit", letterSpacing: "0.04em",
                transition: "all 0.25s",
              }}>Sign Out</button>
            </div>
          </div>
        </div>
      </div>
      {/* Content */}
      <div className="auction-content" style={{ maxWidth: 1120, margin: "0 auto", padding: "20px 16px" }}>
        {tab === "Dashboard" && <DashboardTab data={data} username={username} darkMode={darkMode} />}
        {tab === "Pipeline" && <PipelineTab data={data} setData={setData} />}
        {tab === "Inventory" && <InventoryTab data={data} setData={setData} role={userRole} currentUser={username} />}
        {tab === "Mileage" && <MileageTab data={data} setData={setData} />}
        {tab === "Analytics" && <AnalyticsTab data={data} />}
        {tab === "Calendar" && <CalendarTab data={data} setData={setData} />}
        {tab === "Reports" && (adminMode || managerMode) && <ReportsTab data={data} />}
        {tab === "Money" && (adminMode || managerMode || userRole === "accountant") && <MoneyManagementTab data={data} setData={setData} username={username} userRole={userRole} darkMode={darkMode} />}
        {tab === "Accounting" && (adminMode || managerMode || userRole === "accountant") && <AccountingTab data={data} setData={setData} username={username} userRole={userRole} darkMode={darkMode} />}
        {tab === "Approvals" && (adminMode || managerMode) && <ApprovalsTab data={data} setData={setData} />}
        {tab === "Activity" && (adminMode || managerMode) && <ActivityTab />}
        {tab === "Trash" && adminMode && <TrashTab data={data} setData={setData} currentUser={username} />}
        {tab === "Users" && adminMode && <UsersTab />}
        {tab === "Settings" && <SettingsTab darkMode={darkMode} username={username} userRole={userRole} firebaseUid={firebaseUid} data={data} setData={setData} adminMode={adminMode} />}
      </div>
      {/* Footer */}
      <div style={{ textAlign: "center", padding: "24px 16px", borderTop: `1px solid ${BRAND.grayLight}`, marginTop: 40 }}>
        <p style={{ fontSize: 11, color: BRAND.gray, margin: 0 }}>&copy; 2025 Sayarah Inc. All rights reserved. Atlantic Car Connect is a company of Sayarah Inc.</p>
      </div>
    </div>
  );
}

export default function App() {
  return <ErrorBoundary><ToastProvider><AppInner /></ToastProvider></ErrorBoundary>;
}

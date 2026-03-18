import { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext, Component } from "react";
import { auth, firebaseSignIn, firebaseSignUp, firebaseSignOut, onAuthChange, getUserRole, getUserProfile, updateUserRole, getAllUsers, updateUserPermissions, getUserData, saveAppData, loadAppData, saveSharedData, loadSharedData, onSharedDataChange, saveApprovalsFB, loadApprovalsFB, saveActivityLogFB, loadActivityLogFB, changePassword, resetPassword, uploadFile, deleteFile } from "./src/firebase.js";

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

// ─── Auction Fee Structures (Real Copart/IAAI tiers) ──────────
const AUCTION_FEE_TIERS = {
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
  custom: { name: "Custom %", tiers: [{ max: Infinity, pct: 0 }], gateFee: 0, envFee: 0, titleFee: 0, virtualBidFee: 0 },
};

function calcAuctionFees(price, source) {
  const s = AUCTION_FEE_TIERS[source] || AUCTION_FEE_TIERS.custom;
  const tier = s.tiers.find(t => price <= t.max);
  const premium = tier.pct ? price * (tier.pct / 100) : tier.fee;
  return { premium, gate: s.gateFee, env: s.envFee, title: s.titleFee, vbid: s.virtualBidFee, total: premium + s.gateFee + s.envFee + s.titleFee + s.virtualBidFee };
}

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
};

function calcHoldCosts(totalInvested, daysHeld, holdCosts = DEFAULT_HOLD_COSTS) {
  const insurance = holdCosts.insurancePerDay * daysHeld;
  const storage = holdCosts.storagePerDay * daysHeld;
  const depreciation = holdCosts.depreciationPerDay * daysHeld;
  const opportunityCost = totalInvested * (holdCosts.opportunityCostRate / 365) * daysHeld;
  return { insurance, storage, depreciation, opportunityCost, total: insurance + storage + depreciation + opportunityCost, perDay: daysHeld > 0 ? (insurance + storage + depreciation + opportunityCost) / daysHeld : 0 };
}

// ─── Break-Even Calculator ────────────────────────────────────
function calcBreakEven(totalInvested, holdCosts, sellerFeeRate = 0) {
  const minSale = totalInvested + holdCosts;
  const withFees = sellerFeeRate > 0 ? minSale / (1 - sellerFeeRate) : minSale;
  return { minSalePrice: withFees, totalCostBasis: totalInvested + holdCosts };
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
  return daysHeld > 0 ? profit / daysHeld : 0;
}

// ─── Annualized ROI ───────────────────────────────────────────
function calcAnnualizedROI(profit, totalInvested, daysHeld) {
  if (totalInvested <= 0 || daysHeld <= 0) return 0;
  const roi = profit / totalInvested;
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
      return s + (v ? calcTotalInvested(v) : 0);
    }, 0);
    const exp = qExpenses.reduce((s, e) => s + p(e.amount), 0);
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
const EXPENSE_CATEGORIES = ["Repairs/Mechanical","Body Work/Paint","Detailing/Cleaning","Parts","Tires","Registration/Title","Insurance","Transport/Towing","Auction Fees","Storage/Parking","Advertising/Listing","Tools/Equipment","Office/Admin","Fuel","Miscellaneous"];
const SALE_TYPES = ["Private Party","Dealer","Auction","Consignment","Trade-In","Facebook Marketplace","Craigslist","OfferUp"];
const PAYMENT_METHODS = ["Cash","Check","Credit Card","Debit Card","Wire Transfer","Financing","Zelle","Venmo","PayPal"];
const IRS_RATE = 0.70;
// MA Corporate Tax: 8% state excise tax + 21% federal corporate tax
const MA_CORP_TAX_RATE = 0.08;
const FEDERAL_CORP_TAX_RATE = 0.21;
const STORAGE_KEY = "sayarah-flip-v4";
const USERS_STORAGE_KEY = "sayarah-users-v2";
const AUCTION_SOURCES = ["copart", "iaai", "manheim", "private_party", "autotrader", "facebook", "custom"];

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
function canDeleteVehicles(role) { return role === "admin"; }

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
function saveActivityLog(list) {
  if (FIREBASE_ENABLED) { saveActivityLogFB(list).catch(() => {}); return; }
  localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(list));
}
async function logActivity(user, action, description, details = {}) {
  const entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), user, action, description, timestamp: new Date().toISOString(), details };
  const log = await loadActivityLog();
  log.unshift(entry); if (log.length > 500) log.length = 500; saveActivityLog(log);
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
function calcSuggestedPrice(vehicle, holdCosts) {
  const invested = calcTotalInvested(vehicle);
  const days = vehicle.purchaseDate ? Math.round((new Date() - new Date(vehicle.purchaseDate)) / 86400000) : 0;
  const hc = calcHoldCosts(invested, days, holdCosts);
  const breakEven = invested + hc.total;
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

const defaultData = () => ({ vehicles: [], expenses: [], sales: [], mileage: [], documents: [], auctionEvents: [], nextStockNum: 1, holdCosts: { ...DEFAULT_HOLD_COSTS }, startingCapital: 0 });
const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const p = v => parseFloat(v) || 0;
const fmt$ = n => (n == null || isNaN(n)) ? "$0" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
const fmt$2 = n => (n == null || isNaN(n)) ? "$0.00" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const fmtPct = n => (n == null || isNaN(n)) ? "0%" : (n * 100).toFixed(1) + "%";
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

function calcTotalInvested(v) {
  const pp = p(v.purchasePrice);
  let auctCost;
  if (v.useCustomPremium) {
    auctCost = pp * p(v.buyerPremiumPct) / 100;
  } else {
    auctCost = calcAuctionFees(pp, v.auctionSource || "custom").total;
  }
  return pp + auctCost + p(v.transportCost) + p(v.repairCost) + p(v.otherExpenses);
}

function calcVehicleFullMetrics(v, sale, holdCosts) {
  const invested = calcTotalInvested(v);
  const netSale = sale ? p(sale.grossPrice) - p(sale.auctionFee) - p(sale.titleFee) - p(sale.otherDeductions) : 0;
  const grossProfit = sale ? netSale - invested : null;
  const days = sale && v.purchaseDate && sale.date ? daysBetween(v.purchaseDate, sale.date) : (v.purchaseDate ? daysFromNow(v.purchaseDate) : 0);
  const hc = calcHoldCosts(invested, days || 0, holdCosts);
  const trueProfit = grossProfit != null ? grossProfit - hc.total : null;
  const margin = sale && netSale > 0 ? grossProfit / netSale : null;
  const velocity = grossProfit != null && days > 0 ? calcProfitVelocity(grossProfit, days) : null;
  const annROI = grossProfit != null && days > 0 ? calcAnnualizedROI(grossProfit, invested, days) : null;
  const grade = grossProfit != null ? gradeDeal(margin || 0, days || 30, annROI || 0, velocity || 0) : null;
  const breakEven = calcBreakEven(invested, hc.total, 0);
  const risk = calcRiskScore(v);
  const aging = v.status !== "Sold" ? getAgingStatus(days || 0) : null;
  return { invested, netSale, grossProfit, trueProfit, days, holdCost: hc, margin, velocity, annROI, grade, breakEven, risk, aging };
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

function GradeBadge({ grade }) {
  if (!grade) return null;
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
      if (isSignUp && pass.length < 6) { setError("Password must be at least 6 characters"); return; }
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
          : err.code === "auth/weak-password" ? "Password must be at least 6 characters"
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
    const totalInvested = vehicles.reduce((s, v) => s + calcTotalInvested(v), 0);
    const totalRevenue = sales.reduce((s, x) => s + p(x.grossPrice), 0);
    const totalNet = sales.reduce((s, x) => s + p(x.grossPrice) - p(x.auctionFee) - p(x.titleFee) - p(x.otherDeductions), 0);
    const soldInvested = sold.reduce((s, v) => s + calcTotalInvested(v), 0);
    const grossProfit = totalNet - soldInvested;
    const margin = totalRevenue > 0 ? grossProfit / totalRevenue : 0;
    const avgProfit = sold.length > 0 ? grossProfit / sold.length : 0;

    const velocities = sold.map(v => {
      const sl = sales.find(s => s.stockNum === v.stockNum);
      const d = sl && v.purchaseDate && sl.date ? daysBetween(v.purchaseDate, sl.date) : null;
      const inv = calcTotalInvested(v);
      const net = sl ? p(sl.grossPrice) - p(sl.auctionFee) - p(sl.titleFee) - p(sl.otherDeductions) : 0;
      return d && d > 0 ? (net - inv) / d : null;
    }).filter(Boolean);
    const avgVelocity = velocities.length > 0 ? velocities.reduce((a, b) => a + b, 0) / velocities.length : 0;

    const daysArr = sold.map(v => { const sl = sales.find(s => s.stockNum === v.stockNum); return sl && v.purchaseDate && sl.date ? daysBetween(v.purchaseDate, sl.date) : null; }).filter(Boolean);
    const avgDays = daysArr.length > 0 ? Math.round(daysArr.reduce((a, b) => a + b, 0) / daysArr.length) : 0;

    const totalExp = expenses.reduce((s, e) => s + p(e.amount), 0);
    const netIncome = grossProfit - totalExp;
    const capitalInInventory = unsold.reduce((s, v) => s + calcTotalInvested(v), 0);

    // Unsold hold costs
    const unsoldHoldCosts = unsold.reduce((s, v) => {
      const days = v.purchaseDate ? daysFromNow(v.purchaseDate) : 0;
      return s + calcHoldCosts(calcTotalInvested(v), days, holdCosts).total;
    }, 0);

    const totalMiles = mileage.reduce((s, m) => s + p(m.miles), 0);

    return { totalInvested, totalRevenue, totalNet, grossProfit, margin, avgProfit, avgVelocity, avgDays, totalExp, netIncome, capitalInInventory, unsoldHoldCosts, totalMiles };
  }, [vehicles, sales, expenses, mileage, holdCosts, sold, unsold]);

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
        <StatCard label="Total Invested" value={fmt$(metrics.totalInvested)} color={BRAND.red} />
        <StatCard label="Capital in Inventory" value={fmt$(metrics.capitalInInventory)} color="#7C3AED" sub={`Hold costs: ${fmt$(metrics.unsoldHoldCosts)}`} />
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
              const m = calcVehicleFullMetrics(v, sales.find(s => s.stockNum === v.stockNum), holdCosts);
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
                    <span>In: <b style={{ color: BRAND.black }}>{fmt$(m.invested)}</b></span>
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
  const STATUS_OPTIONS = ["In Recon","Ready","Listed","Sold"];
  const admin = isAdmin(role);
  const canEdit = canEditVehicles(role);
  const canDelete = canDeleteVehicles(role);

  const empty = () => ({ id: genId(), stockNum: String(data.nextStockNum).padStart(3, "0"), year: "", make: "", model: "", trim: "", vin: "", color: "", odometer: "", purchaseDate: "", auctionSource: "copart", useCustomPremium: false, buyerPremiumPct: "", transportCost: "", repairCost: "", otherExpenses: "", titleStatus: "clean", status: "In Recon", purchasePrice: "", reconBudget: "", notes: "" });
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
    setFormError("");
    if (editing) {
      if (!canEdit) return;
      setData(d => ({ ...d, vehicles: d.vehicles.map(v => v.id === editing ? form : v) }));
      logActivity(currentUser, "edited_vehicle", `Edited vehicle #${form.stockNum} ${form.year} ${form.make} ${form.model}`);
    } else {
      setData(d => ({ ...d, vehicles: [...d.vehicles, form], nextStockNum: d.nextStockNum + 1 }));
      logActivity(currentUser, "added_vehicle", `Added vehicle #${form.stockNum} ${form.year} ${form.make} ${form.model}`);
    }
    setShowForm(false);
  };
  const del = id => {
    if (!canDelete) return;
    const v = data.vehicles.find(x => x.id === id);
    setData(d => ({ ...d, vehicles: d.vehicles.filter(v => v.id !== id) })); setConfirm(null); setShowForm(false); setShowDetail(null);
    if (v) logActivity(currentUser, "deleted_vehicle", `Deleted vehicle #${v.stockNum} ${v.year} ${v.make} ${v.model}`);
  };

  let filtered = filter === "All" ? data.vehicles : data.vehicles.filter(v => v.status === filter);
  if (sortBy === "recent") filtered = [...filtered].sort((a, b) => (b.purchaseDate || "").localeCompare(a.purchaseDate || ""));
  else if (sortBy === "profit") filtered = [...filtered].sort((a, b) => {
    const sa = data.sales.find(s => s.stockNum === a.stockNum); const sb = data.sales.find(s => s.stockNum === b.stockNum);
    const pa = sa ? (p(sa.grossPrice) - p(sa.auctionFee) - p(sa.titleFee) - p(sa.otherDeductions)) - calcTotalInvested(a) : -999999;
    const pb = sb ? (p(sb.grossPrice) - p(sb.auctionFee) - p(sb.titleFee) - p(sb.otherDeductions)) - calcTotalInvested(b) : -999999;
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
            const headers = ["Stock#","Year","Make","Model","Trim","VIN","Color","Status","Purchase Price","Transport","Repair","Total Invested","Purchase Date"];
            const rows = filtered.map(v => [v.stockNum, v.year, v.make, v.model, v.trim||"", v.vin||"", v.color||"", v.status, v.purchasePrice||"", v.transportCost||"", v.repairCost||"", calcTotalInvested(v).toFixed(2), v.purchaseDate||""]);
            exportCSV(`vehicles_${new Date().toISOString().slice(0,10)}.csv`, headers, rows);
          }}>Export CSV</Btn>
          <Btn onClick={openNew}>+ Add Vehicle</Btn>
        </div>
      </div>

      {filtered.length === 0 ? <Empty icon={<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18 10l-2.7-3.6A1.5 1.5 0 0 0 14.1 6H9.9a1.5 1.5 0 0 0-1.2.6L6 10l-2.5 1.1C2.7 11.3 2 12.1 2 13v3c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>} title="No vehicles" sub="Add your first car" /> : (
        <div className="inventory-grid" style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
          {filtered.map(v => {
            const m = calcVehicleFullMetrics(v, data.sales.find(s => s.stockNum === v.stockNum), data.holdCosts);
            const titleInfo = TITLE_STATUS[v.titleStatus] || TITLE_STATUS.clean;
            const vExpenses = data.expenses.filter(e => e.stockNum === v.stockNum);
            const vSale = data.sales.find(s => s.stockNum === v.stockNum);
            return (
              <Card key={v.id} style={{ cursor: "pointer", borderLeft: `4px solid ${v.status === "Sold" ? BRAND.green : m.aging ? m.aging.color : BRAND.red}`, padding: 14, transition: "box-shadow 0.2s" }} onClick={() => openDetail(v)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: BRAND.red, fontSize: 10, fontWeight: 800, ...S.mono }}>#{v.stockNum}</span>
                      <Badge color={titleInfo.color} bg={titleInfo.bg}>{titleInfo.label}</Badge>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: BRAND.black, marginTop: 3 }}>
                      {v.year} {v.make} {v.model} {v.trim && <span style={{ color: BRAND.gray, fontWeight: 400, fontSize: 13 }}>{v.trim}</span>}
                    </div>
                    {v.color && <div style={{ fontSize: 11, color: BRAND.gray, marginTop: 1 }}>{v.color}{v.odometer ? ` · ${parseInt(v.odometer).toLocaleString()} mi` : ""}</div>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                    <StatusBadge status={v.status} />
                    {m.aging && <Badge color={m.aging.color} bg={m.aging.bg}>{m.aging.icon} {m.days}d</Badge>}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginTop: 10, fontSize: 11 }}>
                  <div><span style={{ color: BRAND.gray }}>Invested</span><div style={{ fontWeight: 700, color: BRAND.black, ...S.mono }}>{fmt$(m.invested)}</div></div>
                  {m.grossProfit != null ? (
                    <div><span style={{ color: BRAND.gray }}>Profit</span><div style={{ fontWeight: 800, color: m.grossProfit >= 0 ? BRAND.green : "#DC2626", ...S.mono }}>{fmt$(m.grossProfit)}</div></div>
                  ) : (
                    <div><span style={{ color: BRAND.gray }}>Break-Even</span><div style={{ fontWeight: 700, color: "#D97706", ...S.mono }}>{fmt$(m.breakEven.minSalePrice)}</div></div>
                  )}
                  <div><span style={{ color: BRAND.gray }}>Risk</span><div style={{ fontWeight: 700, color: m.risk.color }}>{m.risk.level}</div></div>
                </div>

                {m.grossProfit != null && (
                  <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}>
                    <GradeBadge grade={m.grade} />
                    <span style={{ fontSize: 10, color: BRAND.gray }}>{fmt$2(m.velocity)}/d · {fmtPct(m.margin)} margin · {fmtPct(m.annROI)} ann. ROI</span>
                  </div>
                )}

                {m.grossProfit == null && v.reconBudget && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: BRAND.gray, marginBottom: 2 }}>
                      <span>Recon: {fmt$(p(v.repairCost))} / {fmt$(p(v.reconBudget))}</span>
                      <span style={{ color: p(v.repairCost) > p(v.reconBudget) ? "#DC2626" : BRAND.green, fontWeight: 700 }}>
                        {p(v.repairCost) > p(v.reconBudget) ? `Over by ${fmt$(p(v.repairCost) - p(v.reconBudget))}` : `${fmt$(p(v.reconBudget) - p(v.repairCost))} left`}
                      </span>
                    </div>
                    <MiniBar value={p(v.repairCost)} max={p(v.reconBudget)} color={p(v.repairCost) > p(v.reconBudget) ? "#DC2626" : BRAND.green} />
                  </div>
                )}

                {/* Aging price suggestion for unsold vehicles 30+ days */}
                {v.status !== "Sold" && m.days >= 30 && (() => {
                  const sp = calcSuggestedPrice(v, data.holdCosts);
                  return (
                    <div style={{ marginTop: 8, background: "#FFFBEB", borderRadius: 6, padding: "6px 8px", border: "1px solid #FDE68A", fontSize: 10 }}>
                      <div style={{ fontWeight: 700, color: "#92400E", marginBottom: 2 }}>Price Suggestion (burn: {fmt$2(sp.dailyBurn)}/day)</div>
                      <div style={{ display: "flex", gap: 10, color: "#78350F" }}>
                        <span>Break-even: <b>{fmt$(sp.breakEven)}</b></span>
                        <span>10% margin: <b style={{ color: BRAND.green }}>{fmt$(sp.withMargin10)}</b></span>
                      </div>
                    </div>
                  );
                })()}

                {/* Quick summary of expenses/sale on card */}
                <div style={{ display: "flex", gap: 10, marginTop: 8, fontSize: 10, color: BRAND.gray }}>
                  {vExpenses.length > 0 && <span>{vExpenses.length} expense{vExpenses.length > 1 ? "s" : ""} · {fmt$(vExpenses.reduce((s, e) => s + p(e.amount), 0))}</span>}
                  {vSale && <span style={{ color: BRAND.green, fontWeight: 700 }}>Sold {fmt$(p(vSale.grossPrice))}</span>}
                </div>
              </Card>
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
              <Select label="Auction Source" value={form.auctionSource} onChange={v => upd("auctionSource", v)} options={AUCTION_SOURCES.map(s => ({ value: s, label: AUCTION_FEE_TIERS[s].name }))} />
              <Select label="Title Status" value={form.titleStatus} onChange={v => upd("titleStatus", v)} options={Object.entries(TITLE_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} />
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: BRAND.gray }}>Fee Mode</label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: BRAND.grayDark, cursor: "pointer", padding: "8px 0" }}>
                  <input type="checkbox" checked={form.useCustomPremium} onChange={e => upd("useCustomPremium", e.target.checked)} style={{ accentColor: BRAND.red }} />
                  Use custom %
                </label>
              </div>
              {form.useCustomPremium && <Input label="Custom Premium %" value={form.buyerPremiumPct} onChange={v => upd("buyerPremiumPct", v)} type="number" step="0.1" />}
              <Input label="Transport Cost" value={form.transportCost} onChange={v => upd("transportCost", v)} type="number" step="0.01" />
              <Input label="Repair/Recon Cost" value={form.repairCost} onChange={v => upd("repairCost", v)} type="number" step="0.01" />
              <Input label="Recon Budget" value={form.reconBudget} onChange={v => upd("reconBudget", v)} type="number" step="0.01" placeholder="Target max" />
              <Input label="Other Expenses" value={form.otherExpenses} onChange={v => upd("otherExpenses", v)} type="number" step="0.01" />
              <Select label="Status" value={form.status} onChange={v => upd("status", v)} options={STATUS_OPTIONS} />
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
              <div style={{ gridColumn: "1 / -1", borderTop: `1px solid ${BRAND.redBg2}`, paddingTop: 6, marginTop: 4 }}>
                <span style={{ color: BRAND.gray }}>Total Acquisition:</span> <span style={{ fontWeight: 700, color: BRAND.red, ...S.mono }}>{fmt$(formTotalAcq)}</span>
                <span style={{ marginLeft: 16, color: BRAND.gray }}>Total Invested:</span> <span style={{ fontWeight: 800, color: BRAND.red, ...S.mono }}>{fmt$(formTotalInv)}</span>
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
      {confirm && <Confirm msg="Delete this vehicle permanently?" onOk={() => del(confirm)} onCancel={() => setConfirm(null)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// VEHICLE DETAIL MODAL — shows expenses + sale inline
// ═══════════════════════════════════════════════════════════════
function generateInvoicePDF(vehicle, expenses, sale, metrics, currentUserInfo) {
  const v = vehicle;
  const m = metrics;
  const u = currentUserInfo;
  const titleInfo = TITLE_STATUS[v.titleStatus] || TITLE_STATUS.clean;
  const saleNet = sale ? p(sale.grossPrice) - p(sale.auctionFee) - p(sale.titleFee) - p(sale.otherDeductions) : 0;
  const totalExp = expenses.reduce((s, e) => s + p(e.amount), 0);
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const invoiceNum = `INV-${v.stockNum}-${Date.now().toString(36).toUpperCase()}`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${invoiceNum}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Arial,sans-serif;color:#111;background:#fff;padding:40px;max-width:800px;margin:0 auto}
.header{display:flex;justify-content:space-between;align-items:start;border-bottom:3px solid #8B1A1A;padding-bottom:20px;margin-bottom:24px}
.logo-img{height:64px;object-fit:contain;display:block;margin-bottom:6px}
.logo-sub{font-size:10px;color:#999;letter-spacing:0.15em}
.inv-meta{text-align:right;font-size:12px;color:#555}
.inv-meta b{color:#111}
.inv-num{font-size:16px;font-weight:800;color:#8B1A1A;margin-bottom:4px}
.parties{display:flex;gap:40px;margin-bottom:24px}
.party{flex:1}
.party-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#8B1A1A;margin-bottom:6px}
.party-name{font-size:15px;font-weight:700;margin-bottom:4px}
.party-detail{font-size:12px;color:#555;line-height:1.6}
.section{margin-bottom:20px}
.section-title{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#8B1A1A;padding:6px 0;border-bottom:1px solid #e5e7eb;margin-bottom:10px}
.vehicle-hero{background:#fdf2f2;border-radius:8px;padding:16px;margin-bottom:20px;border-left:4px solid #8B1A1A}
.vehicle-name{font-size:20px;font-weight:900;margin-bottom:4px}
.vehicle-meta{font-size:12px;color:#555}
table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:6px}
th{background:#f9fafb;text-align:left;padding:8px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;border-bottom:2px solid #e5e7eb}
td{padding:8px 10px;border-bottom:1px solid #f3f4f6}
.amt{text-align:right;font-family:'Courier New',monospace;font-weight:600}
.total-row td{border-top:2px solid #111;font-weight:800;font-size:13px;padding-top:10px}
.summary-box{background:#f0fdf4;border:1px solid #d1fae5;border-radius:8px;padding:16px;margin-top:20px}
.summary-box.loss{background:#fef2f2;border-color:#fecaca}
.summary-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;font-size:12px}
.summary-label{color:#6b7280;font-size:10px;text-transform:uppercase;font-weight:700}
.summary-value{font-size:18px;font-weight:800;font-family:'Courier New',monospace}
.footer{margin-top:30px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:10px;color:#999;text-align:center}
@media print{body{padding:20px}@page{margin:0.5in}}
</style></head><body>
<div class="header">
  <div><img src="/logo.png" class="logo-img" alt="Auto Trade Hub" /><div class="logo-sub">ATLANTIC CAR CONNECT — A SAYARAH INC COMPANY</div></div>
  <div class="inv-meta">
    <div class="inv-num">${invoiceNum}</div>
    <div>Date: <b>${today}</b></div>
    <div>Stock #: <b>${esc(v.stockNum)}</b></div>
  </div>
</div>

<div class="parties">
  <div class="party">
    <div class="party-label">Client (Exported By)</div>
    <div class="party-name">${esc(u.username || "—")}</div>
    <div class="party-detail">
      ${u.email ? esc(u.email) + "<br>" : ""}${u.phone ? esc(u.phone) + "<br>" : ""}${u.address ? esc(u.address) : ""}
    </div>
  </div>
  ${sale && sale.buyerName ? `<div class="party">
    <div class="party-label">Buyer</div>
    <div class="party-name">${esc(sale.buyerName)}</div>
    <div class="party-detail">
      ${sale.buyerPhone ? esc(sale.buyerPhone) + "<br>" : ""}${sale.buyerEmail ? esc(sale.buyerEmail) : ""}
    </div>
  </div>` : ""}
</div>

<div class="vehicle-hero">
  <div class="vehicle-name">${esc(v.year)} ${esc(v.make)} ${esc(v.model)} ${esc(v.trim || "")}</div>
  <div class="vehicle-meta">
    ${v.vin ? "VIN: " + esc(v.vin) + " · " : ""}${v.color ? esc(v.color) + " · " : ""}${v.odometer ? parseInt(v.odometer).toLocaleString() + " mi · " : ""}Title: ${esc(titleInfo.label)} · Status: ${esc(v.status)}
  </div>
</div>

<div class="section">
  <div class="section-title">Acquisition Costs</div>
  <table>
    <tr><td>Purchase Price</td><td class="amt">${fmt$2(p(v.purchasePrice))}</td></tr>
    <tr><td>Auction Fees (${(AUCTION_FEE_TIERS[v.auctionSource] || AUCTION_FEE_TIERS.custom).name})</td><td class="amt">${fmt$2(calcAuctionFees(p(v.purchasePrice), v.auctionSource || "custom").total)}</td></tr>
    <tr><td>Transport Cost</td><td class="amt">${fmt$2(p(v.transportCost))}</td></tr>
    <tr><td>Repair/Recon Cost</td><td class="amt">${fmt$2(p(v.repairCost))}</td></tr>
    <tr><td>Other Expenses</td><td class="amt">${fmt$2(p(v.otherExpenses))}</td></tr>
    <tr class="total-row"><td>Total Invested</td><td class="amt">${fmt$2(m.invested)}</td></tr>
  </table>
</div>

${expenses.length > 0 ? `<div class="section">
  <div class="section-title">Tracked Expenses (${expenses.length})</div>
  <table>
    <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Vendor</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>
      ${expenses.map(e => `<tr><td>${esc(e.date||"—")}</td><td>${esc(e.category||"—")}</td><td>${esc(e.description||"—")}</td><td>${esc(e.vendor||"—")}</td><td class="amt">${fmt$2(p(e.amount))}</td></tr>`).join("")}
      <tr class="total-row"><td colspan="4">Total Expenses</td><td class="amt">${fmt$2(totalExp)}</td></tr>
    </tbody>
  </table>
</div>` : ""}

${sale ? `<div class="section">
  <div class="section-title">Sale Details</div>
  <table>
    <tr><td>Sale Date</td><td class="amt">${esc(sale.date)}</td></tr>
    <tr><td>Sale Type</td><td class="amt">${esc(sale.saleType || "—")}</td></tr>
    <tr><td>Gross Sale Price</td><td class="amt">${fmt$2(p(sale.grossPrice))}</td></tr>
    <tr><td>Auction/Seller Fee</td><td class="amt">-${fmt$2(p(sale.auctionFee))}</td></tr>
    <tr><td>Title/Transfer Fee</td><td class="amt">-${fmt$2(p(sale.titleFee))}</td></tr>
    <tr><td>Other Deductions</td><td class="amt">-${fmt$2(p(sale.otherDeductions))}</td></tr>
    <tr class="total-row"><td>Net Sale</td><td class="amt">${fmt$2(saleNet)}</td></tr>
  </table>
</div>

<div class="summary-box ${m.grossProfit < 0 ? "loss" : ""}">
  <div class="section-title" style="color:${m.grossProfit >= 0 ? "#166534" : "#DC2626"};border-color:${m.grossProfit >= 0 ? "#D1FAE5" : "#FECACA"}">Profit & Loss Summary</div>
  <div class="summary-grid">
    <div><div class="summary-label">Total Invested</div><div class="summary-value">${fmt$2(m.invested)}</div></div>
    <div><div class="summary-label">Net Sale</div><div class="summary-value">${fmt$2(saleNet)}</div></div>
    <div><div class="summary-label">Gross Profit</div><div class="summary-value" style="color:${m.grossProfit >= 0 ? "#166534" : "#DC2626"}">${fmt$2(m.grossProfit)}</div></div>
    <div><div class="summary-label">Margin</div><div class="summary-value">${m.margin != null ? (m.margin * 100).toFixed(1) + "%" : "—"}</div></div>
    <div><div class="summary-label">Days Held</div><div class="summary-value">${m.days || "—"}</div></div>
    <div><div class="summary-label">Grade</div><div class="summary-value" style="color:${m.grade ? m.grade.color : "#111"}">${m.grade ? m.grade.grade : "—"}</div></div>
  </div>
  <div style="margin-top:12px;font-size:11px;color:#6b7280">
    MA State Tax (8%): ${fmt$2(m.grossProfit > 0 ? m.grossProfit * MA_CORP_TAX_RATE : 0)} ·
    Federal Tax (21%): ${fmt$2(m.grossProfit > 0 ? m.grossProfit * FEDERAL_CORP_TAX_RATE : 0)} ·
    Total Est. Tax: ${fmt$2(m.grossProfit > 0 ? m.grossProfit * (MA_CORP_TAX_RATE + FEDERAL_CORP_TAX_RATE) : 0)}
  </div>
</div>` : `<div class="summary-box">
  <div class="section-title">Status: Not Yet Sold</div>
  <div class="summary-grid">
    <div><div class="summary-label">Total Invested</div><div class="summary-value">${fmt$2(m.invested)}</div></div>
    <div><div class="summary-label">Break-Even Price</div><div class="summary-value" style="color:#D97706">${fmt$2(m.breakEven.minSalePrice)}</div></div>
    <div><div class="summary-label">Days Held</div><div class="summary-value">${m.days || "—"}</div></div>
  </div>
</div>`}

<div class="footer">
  Generated by Auto Trade Hub · © 2025 Sayarah Inc · Atlantic Car Connect — A Sayarah Inc Company · ${today} · Invoice ${invoiceNum}
</div>
</body></html>`;

  const printWindow = window.open("", "_blank");
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onload = () => { printWindow.print(); };
}

function VehicleDetailModal({ vehicle, expenses, sale, data, setData, admin, currentUser, onClose, onEdit, onDelete, canEditProp, canDeleteProp }) {
  const v = vehicle;
  const m = calcVehicleFullMetrics(v, sale, data.holdCosts);
  const titleInfo = TITLE_STATUS[v.titleStatus] || TITLE_STATUS.clean;
  const [vehicleLog, setVehicleLog] = useState([]);
  useEffect(() => { loadActivityLog().then(log => setVehicleLog(log.filter(l => l.details?.stockNum === v.stockNum || l.description?.includes(`#${v.stockNum}`)).slice(0, 20))).catch(() => setVehicleLog([])); }, [v.stockNum]);

  const handleExportPDF = () => {
    const users = loadUsers();
    const userInfo = users.find(u => u.username === currentUser) || { username: currentUser, email: "", phone: "", address: "" };
    generateInvoicePDF(v, expenses, sale, m, userInfo);
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
    if (!expForm.amount) return;
    if (editingExp && !admin) {
      // Non-admin edit → send to approval queue
      addApproval({ id: genId(), type: "expense_edit", requestedBy: currentUser, requestedAt: new Date().toISOString(), status: "pending", stockNum: v.stockNum, vehicle: `${v.year} ${v.make} ${v.model}`, description: `Edit expense: ${expForm.category || "—"} — ${expForm.description || "—"} (${fmt$2(p(expForm.amount))})`, targetId: editingExp, originalData: data.expenses.find(e => e.id === editingExp), newData: { ...expForm } });
      logActivity(currentUser, "requested_edit", `Requested expense edit on #${v.stockNum} ${v.year} ${v.make} ${v.model}`, { type: "expense_edit", stockNum: v.stockNum });
      setApprovalMsg("Edit request sent to admin for approval!");
      setTimeout(() => setApprovalMsg(""), 3000);
      setShowExpForm(false);
      return;
    }
    if (editingExp) {
      setData(d => ({ ...d, expenses: d.expenses.map(e => e.id === editingExp ? expForm : e) }));
      logActivity(currentUser, "edited_expense", `Edited expense on #${v.stockNum} ${v.year} ${v.make} ${v.model}: ${expForm.category || "—"}`);
    } else {
      setData(d => ({ ...d, expenses: [...d.expenses, expForm] }));
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
    setData(d => ({ ...d, expenses: d.expenses.filter(e => e.id !== id) }));
    logActivity(currentUser, "deleted_expense", `Deleted expense on #${v.stockNum} ${v.year} ${v.make} ${v.model}`);
    setConfirmExp(null); setShowExpForm(false);
  };

  // ─── Sale form state ───────────────────────────────────────
  const [showSaleForm, setShowSaleForm] = useState(false);
  const [editingSale, setEditingSale] = useState(null);
  const [confirmSale, setConfirmSale] = useState(null);
  const emptySale = () => ({ id: genId(), date: new Date().toISOString().slice(0, 10), stockNum: v.stockNum, vehicle: `${v.year} ${v.make} ${v.model}`, buyerName: "", saleType: "", grossPrice: "", auctionFee: "", titleFee: "", otherDeductions: "", buyerPhone: "", buyerEmail: "", notes: "" });
  const [saleForm, setSaleForm] = useState(emptySale());
  const updSale = (k, val) => setSaleForm(f => ({ ...f, [k]: val }));
  const saleNet = s => p(s.grossPrice) - p(s.auctionFee) - p(s.titleFee) - p(s.otherDeductions);
  const openNewSale = () => { setSaleForm(emptySale()); setEditingSale(null); setShowSaleForm(true); };
  const openEditSale = s => { setSaleForm({ ...s }); setEditingSale(s.id); setShowSaleForm(true); };
  const saveSale = () => {
    if (!saleForm.grossPrice) return;
    if (editingSale && !admin) {
      addApproval({ id: genId(), type: "sale_edit", requestedBy: currentUser, requestedAt: new Date().toISOString(), status: "pending", stockNum: v.stockNum, vehicle: `${v.year} ${v.make} ${v.model}`, description: `Edit sale: ${fmt$2(p(saleForm.grossPrice))} to ${saleForm.buyerName || "—"}`, targetId: editingSale, originalData: data.sales.find(s => s.id === editingSale), newData: { ...saleForm } });
      logActivity(currentUser, "requested_edit", `Requested sale edit on #${v.stockNum} ${v.year} ${v.make} ${v.model}`);
      setApprovalMsg("Edit request sent to admin for approval!");
      setTimeout(() => setApprovalMsg(""), 3000);
      setShowSaleForm(false);
      return;
    }
    if (editingSale) {
      setData(d => ({ ...d, sales: d.sales.map(s => s.id === editingSale ? saleForm : s) }));
      logActivity(currentUser, "edited_sale", `Edited sale on #${v.stockNum} ${v.year} ${v.make} ${v.model}`);
    } else {
      setData(d => ({ ...d, sales: [...d.sales, saleForm], vehicles: d.vehicles.map(vh => vh.stockNum === saleForm.stockNum ? { ...vh, status: "Sold" } : vh) }));
      logActivity(currentUser, "finalized_sale", `Finalized sale on #${v.stockNum} ${v.year} ${v.make} ${v.model}: ${fmt$2(p(saleForm.grossPrice))}`);
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
    setData(d => ({ ...d, sales: d.sales.filter(s => s.id !== id) }));
    logActivity(currentUser, "deleted_sale", `Deleted sale on #${v.stockNum} ${v.year} ${v.make} ${v.model}`);
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
            {canEditProp && <Btn variant="secondary" size="sm" onClick={onEdit}>Edit</Btn>}
            {canDeleteProp && <Btn variant="danger" size="sm" style={{ fontSize: 11, padding: "5px 10px" }} onClick={onDelete}>Delete</Btn>}
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
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
            <StatCard label="Total Invested" value={fmt$(m.invested)} color={BRAND.red} />
            {m.grossProfit != null ? (
              <StatCard label="Gross Profit" value={fmt$(m.grossProfit)} color={m.grossProfit >= 0 ? BRAND.green : "#DC2626"} />
            ) : (
              <StatCard label="Break-Even" value={fmt$(m.breakEven.minSalePrice)} color="#D97706" />
            )}
            <StatCard label="Total Expenses" value={fmt$(totalExpenses)} color={BRAND.gray} sub={`${expenses.length} item${expenses.length !== 1 ? "s" : ""}`} />
            <StatCard label="Risk" value={m.risk.level} color={m.risk.color} />
          </div>

          {m.grossProfit != null && (
            <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
              <GradeBadge grade={m.grade} />
              <span style={{ fontSize: 12, color: BRAND.gray }}>{fmt$2(m.velocity)}/day · {fmtPct(m.margin)} margin · {fmtPct(m.annROI)} ann. ROI · {m.days} days held</span>
            </div>
          )}

          {/* Cost Breakdown */}
          <Card style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: BRAND.red, textTransform: "uppercase", marginBottom: 8 }}>Cost Breakdown</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8, fontSize: 12 }}>
              <div><span style={{ color: BRAND.gray }}>Purchase Price:</span> <b style={S.mono}>{fmt$(p(v.purchasePrice))}</b></div>
              <div><span style={{ color: BRAND.gray }}>Auction Fees:</span> <b style={S.mono}>{fmt$(calcAuctionFees(p(v.purchasePrice), v.auctionSource || "custom").total)}</b></div>
              <div><span style={{ color: BRAND.gray }}>Transport:</span> <b style={S.mono}>{fmt$(p(v.transportCost))}</b></div>
              <div><span style={{ color: BRAND.gray }}>Repairs/Recon:</span> <b style={S.mono}>{fmt$(p(v.repairCost))}</b></div>
              <div><span style={{ color: BRAND.gray }}>Other Expenses:</span> <b style={S.mono}>{fmt$(p(v.otherExpenses))}</b></div>
              <div><span style={{ color: BRAND.gray }}>Tracked Expenses:</span> <b style={S.mono}>{fmt$(totalExpenses)}</b></div>
            </div>
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
                  <Input label="Date" value={expForm.date} onChange={val => updExp("date", val)} type="date" />
                  <Select label="Category" value={expForm.category} onChange={val => updExp("category", val)} options={EXPENSE_CATEGORIES} placeholder="Select..." />
                  <Input label="Amount" value={expForm.amount} onChange={val => updExp("amount", val)} type="number" step="0.01" />
                  <Input label="Description" value={expForm.description} onChange={val => updExp("description", val)} placeholder="What for?" />
                  <Input label="Vendor" value={expForm.vendor} onChange={val => updExp("vendor", val)} />
                  <Select label="Payment" value={expForm.paymentMethod} onChange={val => updExp("paymentMethod", val)} options={PAYMENT_METHODS} placeholder="Select..." />
                  <Input label="Receipt #" value={expForm.receipt} onChange={val => updExp("receipt", val)} />
                </div>
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
                  {sale.buyerPhone && <div style={{ fontSize: 11, color: BRAND.gray, marginTop: 8 }}>Phone: {sale.buyerPhone}</div>}
                  {sale.buyerEmail && <div style={{ fontSize: 11, color: BRAND.gray, marginTop: 2 }}>Email: {sale.buyerEmail}</div>}
                  {sale.notes && <div style={{ fontSize: 11, color: BRAND.grayDark, marginTop: 6, fontStyle: "italic" }}>{sale.notes}</div>}
                </Card>

                {/* P&L Summary */}
                {m.grossProfit != null && (
                  <div style={{ background: m.grossProfit >= 0 ? "#F0FDF4" : "#FEF2F2", borderRadius: 10, padding: 14, marginTop: 12, border: `1px solid ${m.grossProfit >= 0 ? "#D1FAE5" : "#FECACA"}` }}>
                    <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", color: m.grossProfit >= 0 ? BRAND.green : "#DC2626", marginBottom: 6 }}>Deal Analysis</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12, alignItems: "center" }}>
                      <div>Net Sale: <b style={{ ...S.mono }}>{fmt$(m.netSale)}</b></div>
                      <div>Invested: <b style={{ ...S.mono }}>{fmt$(m.invested)}</b></div>
                      <div>Profit: <b style={{ color: m.grossProfit >= 0 ? BRAND.green : "#DC2626", ...S.mono }}>{fmt$(m.grossProfit)}</b></div>
                      {m.velocity != null && <div>Velocity: <b style={{ color: BRAND.blue, ...S.mono }}>{fmt$2(m.velocity)}/d</b></div>}
                      {m.days != null && <div>Days: <b>{m.days}</b></div>}
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
                  <Input label="Notes" value={saleForm.notes} onChange={val => updSale("notes", val)} />
                </div>
                {/* Live P&L */}
                {saleForm.grossPrice && (() => {
                  const inv = calcTotalInvested(v);
                  const netP = saleNet(saleForm);
                  const profit = netP - inv;
                  return (
                    <div style={{ background: profit >= 0 ? "#F0FDF4" : "#FEF2F2", borderRadius: 8, padding: 10, marginTop: 10, fontSize: 12 }}>
                      <span style={{ color: BRAND.gray }}>Net: </span><b style={S.mono}>{fmt$(netP)}</b>
                      <span style={{ marginLeft: 14, color: BRAND.gray }}>Invested: </span><b style={S.mono}>{fmt$(inv)}</b>
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
function ExpensesTab({ data, setData }) {
  const [showForm, setShowForm] = useState(false); const [editing, setEditing] = useState(null); const [confirm, setConfirm] = useState(null); const [catFilter, setCatFilter] = useState("All");
  const empty = () => ({ id: genId(), date: new Date().toISOString().slice(0, 10), stockNum: "", vehicle: "", category: "", description: "", vendor: "", paymentMethod: "", amount: "", receipt: "" });
  const [form, setForm] = useState(empty());
  const upd = (k, v) => { setForm(prev => { const n = { ...prev, [k]: v }; if (k === "stockNum" && v) { const vh = data.vehicles.find(x => x.stockNum === v); if (vh) n.vehicle = `${vh.year} ${vh.make} ${vh.model}`; } return n; }); };
  const openNew = () => { setForm(empty()); setEditing(null); setShowForm(true); };
  const openEdit = e => { setForm({ ...e }); setEditing(e.id); setShowForm(true); };
  const save = () => { if (!form.amount) return; if (form.stockNum && !form.vehicle) { const v = data.vehicles.find(x => x.stockNum === form.stockNum); if (v) form.vehicle = `${v.year} ${v.make} ${v.model}`; } if (editing) setData(d => ({ ...d, expenses: d.expenses.map(e => e.id === editing ? form : e) })); else setData(d => ({ ...d, expenses: [...d.expenses, form] })); setShowForm(false); };
  const del = id => { setData(d => ({ ...d, expenses: d.expenses.filter(e => e.id !== id) })); setConfirm(null); setShowForm(false); };

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
            <Input label="Date" value={form.date} onChange={v => upd("date", v)} type="date" />
            <Select label="Stock #" value={form.stockNum} onChange={v => upd("stockNum", v)} options={data.vehicles.map(v => v.stockNum)} placeholder="(General)" />
            <Input label="Vehicle" value={form.vehicle} onChange={v => upd("vehicle", v)} readOnly />
            <Select label="Category" value={form.category} onChange={v => upd("category", v)} options={EXPENSE_CATEGORIES} placeholder="Select..." />
            <Input label="Amount" value={form.amount} onChange={v => upd("amount", v)} type="number" step="0.01" />
            <Input label="Description" value={form.description} onChange={v => upd("description", v)} placeholder="What for?" />
            <Input label="Vendor" value={form.vendor} onChange={v => upd("vendor", v)} />
            <Select label="Payment" value={form.paymentMethod} onChange={v => upd("paymentMethod", v)} options={PAYMENT_METHODS} placeholder="Select..." />
            <Input label="Receipt #" value={form.receipt} onChange={v => upd("receipt", v)} />
          </div>
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
  const empty = () => ({ id: genId(), date: new Date().toISOString().slice(0, 10), stockNum: "", vehicle: "", buyerName: "", saleType: "", grossPrice: "", auctionFee: "", titleFee: "", otherDeductions: "", buyerPhone: "", buyerEmail: "", notes: "" });
  const [form, setForm] = useState(empty());
  const upd = (k, v) => { setForm(prev => { const n = { ...prev, [k]: v }; if (k === "stockNum" && v) { const vh = data.vehicles.find(x => x.stockNum === v); if (vh) n.vehicle = `${vh.year} ${vh.make} ${vh.model}`; } return n; }); };
  const net = s => p(s.grossPrice) - p(s.auctionFee) - p(s.titleFee) - p(s.otherDeductions);
  const openNew = () => { setForm(empty()); setEditing(null); setShowForm(true); };
  const openEdit = s => { setForm({ ...s }); setEditing(s.id); setShowForm(true); };
  const save = () => {
    if (!form.grossPrice && !form.stockNum) return;
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
                  const m = v ? calcVehicleFullMetrics(v, s, data.holdCosts) : null;
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
            const inv = calcTotalInvested(v);
            const netP = net(form);
            const profit = netP - inv;
            const days = v.purchaseDate && form.date ? daysBetween(v.purchaseDate, form.date) : null;
            const vel = days && days > 0 ? profit / days : null;
            const roi = days && days > 0 ? calcAnnualizedROI(profit, inv, days) : null;
            const gr = gradeDeal(netP > 0 ? profit / netP : 0, days || 30, roi || 0, vel || 0);
            return (
              <div style={{ background: profit >= 0 ? "#F0FDF4" : "#FEF2F2", borderRadius: 10, padding: 14, marginTop: 12, border: `1px solid ${profit >= 0 ? "#D1FAE5" : "#FECACA"}` }}>
                <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", color: profit >= 0 ? BRAND.green : "#DC2626", marginBottom: 6 }}>Deal Analysis</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12, alignItems: "center" }}>
                  <div>Net: <b style={{ ...S.mono }}>{fmt$(netP)}</b></div>
                  <div>Invested: <b style={{ ...S.mono }}>{fmt$(inv)}</b></div>
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
  const { vehicles, sales, holdCosts } = data;

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
      if (byStage[stage] !== undefined) byStage[stage] += calcTotalInvested(v);
    });
    return byStage;
  }, [vehicles, sales]);

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
                  const m = calcVehicleFullMetrics(v, sales.find(s => s.stockNum === v.stockNum), holdCosts);
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
                        Invested: <b style={{ color: BRAND.black, ...S.mono }}>{fmt$(m.invested)}</b>
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
            <Select label="Auction Source" value={form.source} onChange={v => setForm(f => ({ ...f, source: v }))} options={AUCTION_SOURCES.map(s => ({ value: s, label: AUCTION_FEE_TIERS[s]?.name || s }))} />
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
      return { vehicle: v, sale, metrics: calcVehicleFullMetrics(v, sale, holdCosts) };
    }).sort((a, b) => (b.metrics.grossProfit || 0) - (a.metrics.grossProfit || 0));
  }, [sold, sales, holdCosts]);

  // Cash flow
  const cashFlow = useMemo(() => buildCashFlow(vehicles, sales, expenses), [vehicles, sales, expenses]);

  // Performance by source
  const bySource = useMemo(() => {
    const m = {};
    sold.forEach(v => {
      const src = v.auctionSource || "custom";
      if (!m[src]) m[src] = { count: 0, totalProfit: 0, totalInvested: 0, days: [] };
      const sale = sales.find(s => s.stockNum === v.stockNum);
      const met = calcVehicleFullMetrics(v, sale, holdCosts);
      m[src].count++;
      m[src].totalProfit += met.grossProfit || 0;
      m[src].totalInvested += met.invested;
      if (met.days) m[src].days.push(met.days);
    });
    return Object.entries(m).map(([src, d]) => ({
      source: AUCTION_FEE_TIERS[src]?.name || src,
      ...d,
      avgProfit: d.count > 0 ? d.totalProfit / d.count : 0,
      avgDays: d.days.length > 0 ? Math.round(d.days.reduce((a, b) => a + b, 0) / d.days.length) : 0,
      roi: d.totalInvested > 0 ? d.totalProfit / d.totalInvested : 0,
    })).sort((a, b) => b.avgProfit - a.avgProfit);
  }, [sold, sales, holdCosts]);

  // Performance by title status
  const byTitle = useMemo(() => {
    const m = {};
    sold.forEach(v => {
      const ts = v.titleStatus || "clean";
      if (!m[ts]) m[ts] = { count: 0, totalProfit: 0, totalInvested: 0 };
      const sale = sales.find(s => s.stockNum === v.stockNum);
      const met = calcVehicleFullMetrics(v, sale, holdCosts);
      m[ts].count++;
      m[ts].totalProfit += met.grossProfit || 0;
      m[ts].totalInvested += met.invested;
    });
    return Object.entries(m).map(([ts, d]) => ({
      title: TITLE_STATUS[ts]?.label || ts,
      titleInfo: TITLE_STATUS[ts] || TITLE_STATUS.clean,
      ...d,
      avgProfit: d.count > 0 ? d.totalProfit / d.count : 0,
      roi: d.totalInvested > 0 ? d.totalProfit / d.totalInvested : 0,
    })).sort((a, b) => b.avgProfit - a.avgProfit);
  }, [sold, sales, holdCosts]);

  // Industry benchmarks
  const benchmarks = useMemo(() => {
    const avgP = sold.length > 0 ? dealCards.reduce((s, d) => s + (d.metrics.grossProfit || 0), 0) / sold.length : 0;
    const avgD = sold.length > 0 ? dealCards.filter(d => d.metrics.days).reduce((s, d) => s + d.metrics.days, 0) / dealCards.filter(d => d.metrics.days).length : 0;
    const avgM = sold.length > 0 ? dealCards.filter(d => d.metrics.margin != null).reduce((s, d) => s + d.metrics.margin, 0) / dealCards.filter(d => d.metrics.margin != null).length : 0;
    const avgV = sold.length > 0 ? dealCards.filter(d => d.metrics.velocity != null).reduce((s, d) => s + d.metrics.velocity, 0) / dealCards.filter(d => d.metrics.velocity != null).length : 0;
    return [
      { metric: "Avg Profit/Car", value: fmt$(avgP), level: getBenchmarkLevel("avgProfitPerCar", avgP) },
      { metric: "Avg Days to Sell", value: `${Math.round(avgD)}d`, level: getBenchmarkLevel("avgDaysToSell", avgD) },
      { metric: "Avg Margin", value: fmtPct(avgM), level: getBenchmarkLevel("profitMargin", avgM) },
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
              <thead><tr style={{ background: BRAND.redBg }}>{["Rank","Vehicle","Invested","Net Sale","Profit","Margin","Days","Velocity","Ann. ROI","Grade"].map(h => <TH key={h}>{h}</TH>)}</tr></thead>
              <tbody>
                {dealCards.map((d, i) => (
                  <tr key={d.vehicle.id} style={{ borderBottom: `1px solid ${BRAND.grayLight}`, background: i === 0 ? "#FEFCE8" : i < 3 ? "#FFFBEB" : "transparent" }}>
                    <TD style={{ fontWeight: 800, color: i < 3 ? "#D97706" : BRAND.grayDark }}>{`#${i + 1}`}</TD>
                    <TD><span style={{ color: BRAND.red, ...S.mono, fontWeight: 700, fontSize: 10 }}>#{d.vehicle.stockNum}</span> {d.vehicle.year} {d.vehicle.make} {d.vehicle.model}</TD>
                    <TD style={{ ...S.mono }}>{fmt$(d.metrics.invested)}</TD>
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
            if (!byMakeModel[key]) byMakeModel[key] = { count: 0, totalProfit: 0, totalInvested: 0, days: [], profits: [] };
            const sale = sales.find(s => s.stockNum === v.stockNum);
            const met = calcVehicleFullMetrics(v, sale, holdCosts);
            byMakeModel[key].count++;
            byMakeModel[key].totalProfit += met.grossProfit || 0;
            byMakeModel[key].totalInvested += met.invested;
            byMakeModel[key].profits.push(met.grossProfit || 0);
            if (met.days) byMakeModel[key].days.push(met.days);
          });
          const rows = Object.entries(byMakeModel).map(([key, d]) => ({
            makeModel: key,
            ...d,
            avgProfit: d.count > 0 ? d.totalProfit / d.count : 0,
            avgDays: d.days.length > 0 ? Math.round(d.days.reduce((a, b) => a + b, 0) / d.days.length) : 0,
            roi: d.totalInvested > 0 ? d.totalProfit / d.totalInvested : 0,
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
    const soldInvested = periodSold.reduce((s, v) => s + calcTotalInvested(v), 0);
    const grossProfit = totalNet - soldInvested;
    const totalExp = periodExpenses.reduce((s, e) => s + p(e.amount), 0);
    const netIncome = grossProfit - totalExp;

    const avgProfit = periodSold.length > 0 ? grossProfit / periodSold.length : 0;
    const daysArr = periodSold.map(v => { const sl = sales.find(s => s.stockNum === v.stockNum); return sl && v.purchaseDate && sl.date ? daysBetween(v.purchaseDate, sl.date) : null; }).filter(Boolean);
    const avgDays = daysArr.length > 0 ? Math.round(daysArr.reduce((a, b) => a + b, 0) / daysArr.length) : 0;

    // Top deals
    const topDeals = periodSold.map(v => {
      const sl = sales.find(s => s.stockNum === v.stockNum);
      return { vehicle: v, sale: sl, metrics: calcVehicleFullMetrics(v, sl, holdCosts) };
    }).sort((a, b) => (b.metrics.grossProfit || 0) - (a.metrics.grossProfit || 0)).slice(0, 5);

    // Expense breakdown
    const expByCat = {};
    periodExpenses.forEach(e => { const c = e.category || "Other"; expByCat[c] = (expByCat[c] || 0) + p(e.amount); });

    return { label, periodPurchased, periodSold, periodSales, periodExpenses, totalRevenue, totalNet, soldInvested, grossProfit, totalExp, netIncome, avgProfit, avgDays, topDeals, expByCat };
  }, [vehicles, sales, expenses, holdCosts, period, selectedMonth]);

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
<div class="stat"><div class="stat-label">Revenue</div><div class="stat-value">${fmt$(r.totalRevenue)}</div></div>
<div class="stat"><div class="stat-label">Gross Profit</div><div class="stat-value" style="color:${r.grossProfit >= 0 ? "#166534" : "#DC2626"}">${fmt$(r.grossProfit)}</div></div>
<div class="stat"><div class="stat-label">Expenses</div><div class="stat-value" style="color:#DC2626">${fmt$(r.totalExp)}</div></div>
<div class="stat"><div class="stat-label">Net Income</div><div class="stat-value" style="color:${r.netIncome >= 0 ? "#166534" : "#DC2626"}">${fmt$(r.netIncome)}</div></div>
<div class="stat"><div class="stat-label">Avg Profit/Car</div><div class="stat-value">${fmt$(r.avgProfit)}</div></div>
<div class="stat"><div class="stat-label">Avg Days to Sell</div><div class="stat-value">${r.avgDays}d</div></div>
</div>
${r.topDeals.length > 0 ? `<div class="section"><h3>Top Deals</h3><table><thead><tr><th>Vehicle</th><th>Invested</th><th>Sold For</th><th>Profit</th><th>Days</th><th>Grade</th></tr></thead><tbody>${r.topDeals.map(d => `<tr><td>#${esc(d.vehicle.stockNum)} ${esc(d.vehicle.year)} ${esc(d.vehicle.make)} ${esc(d.vehicle.model)}</td><td>${fmt$(d.metrics.invested)}</td><td>${fmt$(d.metrics.netSale)}</td><td style="color:${(d.metrics.grossProfit||0)>=0?"#166534":"#DC2626"};font-weight:700">${fmt$(d.metrics.grossProfit)}</td><td>${d.metrics.days||"—"}d</td><td>${d.metrics.grade?esc(d.metrics.grade.grade):"—"}</td></tr>`).join("")}</tbody></table></div>` : ""}
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
        <StatCard label="Revenue" value={fmt$(r.totalRevenue)} color={BRAND.blue} />
        <StatCard label="Gross Profit" value={fmt$(r.grossProfit)} color={r.grossProfit >= 0 ? BRAND.green : "#DC2626"} />
        <StatCard label="Expenses" value={fmt$(r.totalExp)} color="#DC2626" />
        <StatCard label="Net Income" value={fmt$(r.netIncome)} color={r.netIncome >= 0 ? BRAND.green : "#DC2626"} />
        <StatCard label="Avg Profit/Car" value={fmt$(r.avgProfit)} color={r.avgProfit >= 0 ? BRAND.green : "#DC2626"} />
        <StatCard label="Avg Days to Sell" value={`${r.avgDays}d`} color={BRAND.grayDark} />
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
                    <TD style={{ ...S.mono }}>{fmt$(d.metrics.invested)}</TD>
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
const ALL_AUCTION_TABS = ["Dashboard", "Pipeline", "Inventory", "Mileage", "Analytics", "Calendar", "Reports", "Approvals", "Activity", "Settings"];
const USER_ROLES = [{ key: "admin", label: "Admin", color: "#D97706", bg: "#FEF3C7" }, { key: "manager", label: "Manager", color: "#2563EB", bg: "#DBEAFE" }, { key: "user", label: "User", color: "#059669", bg: "#D1FAE5" }];

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
function SettingsTab({ darkMode, username, userRole, firebaseUid }) {
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
    if (newPw.length < 6) { setPwError("New password must be at least 6 characters"); return; }
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
              <div><label style={labelStyle}>New Password</label><input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Min 6 characters" style={inputStyle} /></div>
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
    if (newPw.length < 6) { setError("New password must be at least 6 characters"); return; }
    if (newPw !== confirmPw) { setError("New passwords do not match"); return; }
    if (currentPw === newPw) { setError("New password must be different from current"); return; }
    setLoading(true);
    try {
      await changePassword(currentPw, newPw);
      setSuccess(true);
    } catch (e) {
      const msg = e.code === "auth/wrong-password" || e.code === "auth/invalid-credential" ? "Current password is incorrect"
        : e.code === "auth/weak-password" ? "Password is too weak — use at least 6 characters"
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
            <div><label style={labelStyle}>New Password</label><input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Min 6 characters" style={inputStyle} /></div>
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
  const [loaded, setLoaded] = useState(true);
  const [saving, setSaving] = useState(false);
  const [darkMode, setDarkMode] = useState(() => loadTheme() === "dark");
  const [showChangePw, setShowChangePw] = useState(false);
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
  const allAdminTabs = [...TABS, "Calendar", "Reports", "Approvals", "Activity", "Users", "Settings"];
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
  useEffect(() => {
    if (!loaded || !dataReady) return;
    if (FIREBASE_ENABLED && firebaseUid) {
      const t = setTimeout(() => {
        setSaving(true);
        saveSharedData(data).then(() => setTimeout(() => setSaving(false), 400)).catch(() => setSaving(false));
      }, 600);
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
        {tab === "Approvals" && (adminMode || managerMode) && <ApprovalsTab data={data} setData={setData} />}
        {tab === "Activity" && (adminMode || managerMode) && <ActivityTab />}
        {tab === "Users" && adminMode && <UsersTab />}
        {tab === "Settings" && <SettingsTab darkMode={darkMode} username={username} userRole={userRole} firebaseUid={firebaseUid} />}
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

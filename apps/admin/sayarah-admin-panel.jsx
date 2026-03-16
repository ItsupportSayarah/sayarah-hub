import { useState, useEffect, useRef, useCallback, createContext, useContext, Component } from "react";
import { auth, firebaseSignIn, firebaseSignOut, onAuthChange, getUserRole, getAllUsers, updateUserPermissions, getUserData, onUsersChange, addUserByEmail } from "./src/firebase.js";

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

const FIREBASE_ENABLED = (() => {
  try { return auth && auth.app && auth.app.options && auth.app.options.apiKey && !auth.app.options.apiKey.startsWith("YOUR_"); } catch { return false; }
})();

const SUPER_ADMIN = "support@sayarah.io";

// ═══════════════════════════════════════════════════════════════
// BRAND & STYLES
// ═══════════════════════════════════════════════════════════════
const B = {
  navy: "#0F172A", navyLight: "#1E293B", navySoft: "#334155",
  white: "#FFFFFF", cream: "#F8FAFC", grayLight: "#E2E8F0", gray: "#94A3B8", grayDark: "#64748B",
  blue: "#3B82F6", blueBg: "#DBEAFE", blueDark: "#1D4ED8",
  green: "#10B981", greenBg: "#D1FAE5",
  red: "#EF4444", redBg: "#FEE2E2",
  amber: "#F59E0B", amberBg: "#FEF3C7",
  purple: "#8B5CF6", purpleBg: "#EDE9FE",
};

const AUCTION_TABS = ["Dashboard", "Pipeline", "Inventory", "Mileage", "Analytics", "Calendar", "Reports", "Approvals", "Activity", "Settings"];
const LOGISTICS_TABS = ["Dashboard", "Customers", "Vehicles", "Containers", "Towing", "Rates", "Invoices", "Settings"];
// ─── Consistent line-style SVG icons ───
const I = {
  shield: (s=16,c="currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  clipboard: (s=16,c="currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>,
  user: (s=16,c="currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  users: (s=16,c="currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  cart: (s=16,c="currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>,
  grid: (s=16,c="currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
  activity: (s=16,c="currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  settings: (s=16,c="currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  car: (s=16,c="currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0"/><path d="M17 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0"/><path d="M5 17h-2v-6l2-5h9l4 5h1a2 2 0 0 1 2 2v4h-2m-4 0h-6m-6-6h15m-6 0v-5"/></svg>,
  truck: (s=16,c="currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  lock: (s=16,c="currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
  loader: (s=16,c="currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>,
  key: (s=16,c="currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>,
  layout: (s=16,c="currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>,
  database: (s=16,c="currentColor") => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4.03 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/></svg>,
};

const ROLES = [
  { key: "admin", label: "Admin", color: B.amber, bg: B.amberBg, icon: I.shield },
  { key: "manager", label: "Manager", color: B.blue, bg: B.blueBg, icon: I.clipboard },
  { key: "user", label: "User", color: B.green, bg: B.greenBg, icon: I.user },
  { key: "customer", label: "Customer", color: B.purple, bg: B.purpleBg, icon: I.cart },
];

// ═══════════════════════════════════════════════════════════════
// REUSABLE COMPONENTS
// ═══════════════════════════════════════════════════════════════
const font = "'Inter','DM Sans',system-ui,-apple-system,sans-serif";

function Card({ children, style }) {
  return <div style={{ background: B.white, borderRadius: 12, padding: 20, border: `1px solid ${B.grayLight}`, boxShadow: "0 1px 3px rgba(0,0,0,.06)", ...style }}>{children}</div>;
}
function Badge({ color, bg, children }) {
  return <span style={{ fontSize: 10, fontWeight: 700, color, background: bg, padding: "3px 10px", borderRadius: 20, display: "inline-flex", alignItems: "center", gap: 4 }}>{children}</span>;
}
function Btn({ children, onClick, variant = "primary", disabled, style }) {
  const styles = {
    primary: { background: `linear-gradient(135deg, ${B.blue}, ${B.blueDark})`, color: "#fff", border: "none", boxShadow: "0 2px 8px rgba(59,130,246,.3)" },
    danger: { background: `linear-gradient(135deg, ${B.red}, #DC2626)`, color: "#fff", border: "none" },
    ghost: { background: "transparent", color: B.grayDark, border: `1px solid ${B.grayLight}` },
    success: { background: `linear-gradient(135deg, ${B.green}, #059669)`, color: "#fff", border: "none" },
  };
  return <button onClick={onClick} disabled={disabled} style={{ ...styles[variant], padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", fontFamily: font, opacity: disabled ? 0.5 : 1, transition: "all .2s", ...style }}>{children}</button>;
}

// ─── Toast Notification System ───
const ToastCtx = createContext();
function useToast() { return useContext(ToastCtx); }
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((msg, type = "success") => { const id = Date.now() + Math.random(); setToasts(t => [...t, { id, msg, type }]); setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500); }, []);
  const colors = { success: { bg: "#F0FDF4", border: "#86EFAC", text: "#166534" }, error: { bg: "#FEF2F2", border: "#FECACA", text: "#991B1B" }, info: { bg: "#EFF6FF", border: "#93C5FD", text: "#1E40AF" } };
  return <ToastCtx.Provider value={add}>{children}<div style={{ position: "fixed", top: 16, right: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>{toasts.map(t => { const c = colors[t.type] || colors.info; return <div key={t.id} style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text, padding: "10px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600, fontFamily: font, boxShadow: "0 4px 12px rgba(0,0,0,0.1)", maxWidth: 360, pointerEvents: "auto" }}>{t.msg}</div>; })}</div></ToastCtx.Provider>;
}

// ═══════════════════════════════════════════════════════════════
// LOGIN PAGE
// ═══════════════════════════════════════════════════════════════
function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim()) { setErr("Email is required"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setErr("Enter a valid email address"); return; }
    if (!pass) { setErr("Password is required"); return; }
    setLoading(true); setErr("");
    try {
      const cred = await firebaseSignIn(email, pass);
      if (cred.user.email !== SUPER_ADMIN) {
        const role = await getUserRole(cred.user.uid);
        if (role !== "admin") { setErr("Access denied. Admin only."); await firebaseSignOut(); setLoading(false); return; }
      }
      onLogin();
    } catch (e) { setErr(e.message); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: `linear-gradient(135deg, ${B.navy} 0%, #1a1a2e 50%, ${B.navyLight} 100%)`, fontFamily: font }}>
      <div style={{ width: 400, maxWidth: "90vw" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <img src="/logo.png" alt="Sayarah" style={{ height: 60, objectFit: "contain", marginBottom: 16 }} />
          <div style={{ fontSize: 24, fontWeight: 900, color: B.white, letterSpacing: "-0.5px" }}>Admin Panel</div>
          <div style={{ fontSize: 12, color: B.gray, marginTop: 4 }}>Unified Control Center — Sayarah Inc</div>
        </div>
        <Card style={{ padding: 28 }}>
          <form onSubmit={submit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: B.grayDark, display: "block", marginBottom: 6 }}>Email</label>
              <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="admin@sayarah.io" style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${B.grayLight}`, fontSize: 13, fontFamily: font, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: B.grayDark, display: "block", marginBottom: 6 }}>Password</label>
              <input value={pass} onChange={e => setPass(e.target.value)} type="password" placeholder="••••••••" style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${B.grayLight}`, fontSize: 13, fontFamily: font, outline: "none", boxSizing: "border-box" }} />
            </div>
            {err && <div style={{ background: B.redBg, color: B.red, padding: "8px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600, marginBottom: 14 }}>{err}</div>}
            <Btn onClick={submit} disabled={loading} style={{ width: "100%", padding: "12px", fontSize: 14 }}>{loading ? "Signing in..." : "Sign In"}</Btn>
          </form>
          <div style={{ textAlign: "center", marginTop: 16, fontSize: 10, color: B.gray }}>Admin access only — support@sayarah.io</div>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD TAB — Overview of both apps
// ═══════════════════════════════════════════════════════════════
function DashboardView({ users, adminEmail }) {
  const totalUsers = users.length;
  const admins = users.filter(u => u.role === "admin").length;
  const managers = users.filter(u => u.role === "manager").length;
  const regularUsers = totalUsers - admins - managers;
  const displayName = adminEmail ? adminEmail.split("@")[0].toUpperCase() : "ADMIN";

  const stats = [
    { label: "Total Users", value: totalUsers, icon: I.users, color: B.blue, bg: B.blueBg },
    { label: "Admins", value: admins, icon: I.shield, color: B.amber, bg: B.amberBg },
    { label: "Managers", value: managers, icon: I.clipboard, color: B.purple, bg: B.purpleBg },
    { label: "Users / Customers", value: regularUsers, icon: I.user, color: B.green, bg: B.greenBg },
  ];

  return (
    <div>
      {/* Welcome Hero Section */}
      <div style={{
        position: "relative", overflow: "hidden", background: "#f5f5f5",
        borderRadius: 16, marginBottom: 28, padding: "64px 40px", textAlign: "center",
        minHeight: 260, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      }}>
        {/* Decorative geometric shapes */}
        <div style={{ position: "absolute", top: -40, left: -30, width: 180, height: 180, background: "rgba(0,0,0,0.04)", transform: "rotate(35deg)", borderRadius: 12 }} />
        <div style={{ position: "absolute", bottom: -50, right: -20, width: 220, height: 220, background: "rgba(0,0,0,0.03)", transform: "rotate(25deg)", borderRadius: 14 }} />
        <div style={{ position: "absolute", top: 30, right: 60, width: 120, height: 120, background: "rgba(0,0,0,0.025)", transform: "rotate(55deg)", borderRadius: 8 }} />
        <div style={{ position: "absolute", bottom: 20, left: 80, width: 100, height: 100, background: "rgba(0,0,0,0.02)", transform: "rotate(15deg)", borderRadius: 6 }} />
        {/* Diamond shapes in corners */}
        <div style={{ position: "absolute", top: 24, left: 28, width: 14, height: 14, border: "2px solid rgba(0,0,0,0.12)", transform: "rotate(45deg)" }} />
        <div style={{ position: "absolute", bottom: 24, right: 28, width: 14, height: 14, border: "2px solid rgba(0,0,0,0.12)", transform: "rotate(45deg)" }} />
        <div style={{ position: "absolute", top: 24, right: 28, width: 10, height: 10, border: "2px solid rgba(0,0,0,0.08)", transform: "rotate(45deg)" }} />
        <div style={{ position: "absolute", bottom: 24, left: 28, width: 10, height: 10, border: "2px solid rgba(0,0,0,0.08)", transform: "rotate(45deg)" }} />

        {/* Corner brackets around welcome text */}
        <div style={{ position: "relative", zIndex: 1, padding: "20px 40px" }}>
          {/* Top-left bracket */}
          <div style={{ position: "absolute", top: 0, left: 0, width: 20, height: 20, borderTop: "3px solid #8B1A1A", borderLeft: "3px solid #8B1A1A" }} />
          {/* Top-right bracket */}
          <div style={{ position: "absolute", top: 0, right: 0, width: 20, height: 20, borderTop: "3px solid #333", borderRight: "3px solid #333" }} />
          {/* Bottom-left bracket */}
          <div style={{ position: "absolute", bottom: 0, left: 0, width: 20, height: 20, borderBottom: "3px solid #333", borderLeft: "3px solid #333" }} />
          {/* Bottom-right bracket */}
          <div style={{ position: "absolute", bottom: 0, right: 0, width: 20, height: 20, borderBottom: "3px solid #8B1A1A", borderRight: "3px solid #8B1A1A" }} />

          <div style={{ fontSize: 32, fontWeight: 900, color: "#111", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
            Welcome, {displayName}
          </div>
          <div style={{ fontSize: 14, color: "#999", fontWeight: 400, letterSpacing: "0.02em" }}>
            We're glad to have you here
          </div>
        </div>

        {/* Decorative dots-and-line element */}
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 6, marginTop: 20 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#8B1A1A" }} />
          <div style={{ width: 40, height: 2, background: "#ccc", borderRadius: 1 }} />
          <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#bbb" }} />
          <div style={{ width: 40, height: 2, background: "#ccc", borderRadius: 1 }} />
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#8B1A1A" }} />
        </div>
      </div>

      {/* Stats Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 24 }}>
        {stats.map(s => (
          <Card key={s.label} style={{ padding: 18, display: "flex", alignItems: "center", gap: 14, borderLeft: `4px solid ${s.color}` }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: s.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>{s.icon(20, s.color)}</div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 900, color: B.navy }}>{s.value}</div>
              <div style={{ fontSize: 10, color: B.gray, fontWeight: 600 }}>{s.label}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* App Info Cards */}
      <div className="admin-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card style={{ borderTop: `3px solid ${B.red}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: B.redBg, display: "flex", alignItems: "center", justifyContent: "center" }}>{I.car(18, B.red)}</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: B.navy }}>Auto Trade Hub</div>
              <div style={{ fontSize: 10, color: B.gray }}>Car Auction Flipping Platform</div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: B.grayDark, lineHeight: 1.8 }}>
            <div><b>Pages:</b> {AUCTION_TABS.length}</div>
            <div><b>Tabs:</b> {AUCTION_TABS.join(", ")}</div>
          </div>
        </Card>
        <Card style={{ borderTop: `3px solid ${B.blue}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: B.blueBg, display: "flex", alignItems: "center", justifyContent: "center" }}>{I.truck(18, B.blue)}</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: B.navy }}>Sayarah Logistics</div>
              <div style={{ fontSize: 10, color: B.gray }}>Vehicle Shipping Platform</div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: B.grayDark, lineHeight: 1.8 }}>
            <div><b>Pages:</b> {LOGISTICS_TABS.length}</div>
            <div><b>Tabs:</b> {LOGISTICS_TABS.join(", ")}</div>
          </div>
        </Card>
      </div>

      <Card style={{ marginTop: 16, background: `linear-gradient(135deg, ${B.navy}, ${B.navyLight})`, border: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div>{I.shield(28, B.amber)}</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: B.white }}>Super Admin: {SUPER_ADMIN}</div>
            <div style={{ fontSize: 11, color: B.gray }}>This account has permanent admin access across all applications and cannot be modified</div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// USERS MANAGEMENT — Controls both apps
// ═══════════════════════════════════════════════════════════════
function UsersView({ users, onRefresh }) {
  const [editUser, setEditUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showAddUser, setShowAddUser] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [adding, setAdding] = useState(false);

  const savePerms = async (uid, updates) => {
    setSaving(true); setMsg("");
    try {
      await updateUserPermissions(uid, updates);
      setMsg("Permissions saved successfully!");
      await onRefresh();
      setTimeout(() => setMsg(""), 3000);
    } catch (e) { setMsg("Error: " + e.message); }
    setSaving(false);
  };

  const handleAddUser = async () => {
    if (!newEmail.trim()) { setMsg("Error: Email is required"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) { setMsg("Error: Enter a valid email address"); return; }
    setAdding(true); setMsg("");
    try {
      await addUserByEmail(newEmail.trim(), newName.trim(), newRole);
      setMsg("User added successfully!");
      setNewEmail(""); setNewName(""); setNewRole("user"); setShowAddUser(false);
      await onRefresh();
      setTimeout(() => setMsg(""), 3000);
    } catch (e) { setMsg("Error: " + e.message); }
    setAdding(false);
  };

  const filtered = users.filter(u => {
    if (filter !== "all" && u.role !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (u.displayName || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, color: B.navy }}>Users & Permissions</div>
          <div style={{ fontSize: 12, color: B.gray }}>Manage access across Auto Trade Hub & Sayarah Logistics</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn onClick={() => setShowAddUser(!showAddUser)} variant={showAddUser ? "ghost" : "success"} style={{ fontSize: 12 }}>{showAddUser ? "Cancel" : "+ Add User"}</Btn>
          <Btn onClick={onRefresh}>↻ Refresh</Btn>
        </div>
      </div>

      {/* Add User Form */}
      {showAddUser && (
        <Card style={{ marginBottom: 16, borderLeft: `4px solid ${B.green}` }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: B.navy, marginBottom: 12 }}>Add New User to Firestore</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: B.grayDark, display: "block", marginBottom: 4 }}>Email *</label>
              <input value={newEmail} onChange={e => setNewEmail(e.target.value)} type="email" placeholder="user@example.com" style={{ padding: "8px 12px", borderRadius: 6, border: `1px solid ${B.grayLight}`, fontSize: 12, fontFamily: font, width: 220, outline: "none" }} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: B.grayDark, display: "block", marginBottom: 4 }}>Display Name</label>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Full Name" style={{ padding: "8px 12px", borderRadius: 6, border: `1px solid ${B.grayLight}`, fontSize: 12, fontFamily: font, width: 180, outline: "none" }} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: B.grayDark, display: "block", marginBottom: 4 }}>Role</label>
              <select value={newRole} onChange={e => setNewRole(e.target.value)} style={{ padding: "8px 12px", borderRadius: 6, border: `1px solid ${B.grayLight}`, fontSize: 12, fontFamily: font, background: B.white }}>
                {ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </div>
            <Btn onClick={handleAddUser} disabled={adding} variant="success" style={{ fontSize: 12 }}>{adding ? "Adding..." : "Add User"}</Btn>
          </div>
          <div style={{ fontSize: 10, color: B.gray, marginTop: 8 }}>Add users who exist in Firebase Auth but haven't signed in to any app yet. They will appear in the admin panel immediately.</div>
        </Card>
      )}

      {msg && <div style={{ background: msg.startsWith("Error") ? B.redBg : B.greenBg, color: msg.startsWith("Error") ? B.red : "#166534", padding: "10px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600, marginBottom: 14 }}>{msg}</div>}

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search users..." style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${B.grayLight}`, fontSize: 12, fontFamily: font, minWidth: 200, outline: "none" }} />
        <div style={{ display: "flex", gap: 4 }}>
          {[{ key: "all", label: "All" }, ...ROLES].map(r => (
            <button key={r.key} onClick={() => setFilter(r.key)} style={{ fontSize: 10, padding: "6px 12px", borderRadius: 6, border: `1px solid ${filter === r.key ? B.blue : B.grayLight}`, background: filter === r.key ? B.blueBg : "transparent", color: filter === r.key ? B.blue : B.grayDark, cursor: "pointer", fontWeight: filter === r.key ? 700 : 500, fontFamily: font }}>{r.label || "All"} {r.key === "all" ? `(${users.length})` : `(${users.filter(u => u.role === r.key).length})`}</button>
          ))}
        </div>
      </div>

      {/* Users Table */}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div className="admin-table-wrap">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: B.cream, borderBottom: `2px solid ${B.grayLight}` }}>
              <th style={{ textAlign: "left", padding: "12px 14px", fontSize: 10, fontWeight: 800, color: B.grayDark, textTransform: "uppercase", letterSpacing: ".05em" }}>User</th>
              <th style={{ textAlign: "left", padding: "12px 14px", fontSize: 10, fontWeight: 800, color: B.grayDark, textTransform: "uppercase", letterSpacing: ".05em" }}>Role</th>
              <th style={{ textAlign: "left", padding: "12px 14px", fontSize: 10, fontWeight: 800, color: B.grayDark, textTransform: "uppercase", letterSpacing: ".05em" }}>App Access</th>
              <th style={{ textAlign: "left", padding: "12px 14px", fontSize: 10, fontWeight: 800, color: B.grayDark, textTransform: "uppercase", letterSpacing: ".05em" }}>Auto Trade Hub Pages</th>
              <th style={{ textAlign: "left", padding: "12px 14px", fontSize: 10, fontWeight: 800, color: B.grayDark, textTransform: "uppercase", letterSpacing: ".05em" }}>Logistics Pages</th>
              <th style={{ textAlign: "left", padding: "12px 14px", fontSize: 10, fontWeight: 800, color: B.grayDark, textTransform: "uppercase", letterSpacing: ".05em" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => {
              const isSuperAdmin = u.email === SUPER_ADMIN;
              const isEditing = editUser?.id === u.id;
              const roleInfo = ROLES.find(r => r.key === u.role) || ROLES[3];
              return (
                <tr key={u.id} style={{ borderBottom: `1px solid ${B.grayLight}`, transition: "background .15s", background: isEditing ? B.blueBg : "transparent" }}>
                  {/* User Info */}
                  <td style={{ padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: `linear-gradient(135deg, ${roleInfo.color}, ${roleInfo.bg})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: B.white, fontWeight: 800 }}>{(u.displayName || u.email || "?")[0].toUpperCase()}</div>
                      <div>
                        <div style={{ fontWeight: 700, color: B.navy, fontSize: 13 }}>{u.displayName || "—"}</div>
                        <div style={{ fontSize: 10, color: B.gray }}>{u.email || "—"}</div>
                        {isSuperAdmin && <Badge color="#92400E" bg={B.amberBg}>{I.shield(12, "#92400E")} SUPER ADMIN</Badge>}
                      </div>
                    </div>
                  </td>

                  {/* Role */}
                  <td style={{ padding: "12px 14px" }}>
                    {isEditing && !isSuperAdmin ? (
                      <select value={editUser.role || "user"} onChange={e => setEditUser({ ...editUser, role: e.target.value })} style={{ fontSize: 11, padding: "6px 10px", borderRadius: 6, border: `1px solid ${B.grayLight}`, fontFamily: font, background: B.white }}>
                        {ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                      </select>
                    ) : (
                      <Badge color={roleInfo.color} bg={roleInfo.bg}>{roleInfo.icon(12, roleInfo.color)} {roleInfo.label}</Badge>
                    )}
                  </td>

                  {/* App Access Toggles */}
                  <td style={{ padding: "12px 14px" }}>
                    {isEditing && !isSuperAdmin ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <button onClick={() => setEditUser({ ...editUser, auctionAccess: !editUser.auctionAccess })} style={{ fontSize: 9, padding: "4px 8px", borderRadius: 4, border: `1px solid ${editUser.auctionAccess ? B.green : B.grayLight}`, background: editUser.auctionAccess ? B.greenBg : "transparent", color: editUser.auctionAccess ? "#059669" : B.gray, cursor: "pointer", fontWeight: 600, fontFamily: font }}>{editUser.auctionAccess ? "✓" : "✗"} Auction</button>
                        <button onClick={() => setEditUser({ ...editUser, logisticsAccess: !(editUser.logisticsAccess !== false) })} style={{ fontSize: 9, padding: "4px 8px", borderRadius: 4, border: `1px solid ${editUser.logisticsAccess !== false ? B.blue : B.grayLight}`, background: editUser.logisticsAccess !== false ? B.blueBg : "transparent", color: editUser.logisticsAccess !== false ? B.blue : B.gray, cursor: "pointer", fontWeight: 600, fontFamily: font }}>{editUser.logisticsAccess !== false ? "✓" : "✗"} Logistics</button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={{ fontSize: 9, fontWeight: 600, color: (isSuperAdmin || u.role === "admin" || u.auctionAccess) ? "#059669" : B.gray }}>{(isSuperAdmin || u.role === "admin" || u.auctionAccess) ? "✓" : "✗"} Auction</span>
                        <span style={{ fontSize: 9, fontWeight: 600, color: (isSuperAdmin || u.role === "admin" || u.logisticsAccess !== false) ? B.blue : B.gray }}>{(isSuperAdmin || u.role === "admin" || u.logisticsAccess !== false) ? "✓" : "✗"} Logistics</span>
                      </div>
                    )}
                  </td>

                  {/* Auto Trade Hub Pages */}
                  <td style={{ padding: "12px 14px" }}>
                    {isEditing && !isSuperAdmin ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                        {AUCTION_TABS.map(t => {
                          const tabs = editUser.allowedTabs || AUCTION_TABS;
                          const on = tabs.includes(t);
                          return <button key={t} onClick={() => {
                            const cur = editUser.allowedTabs || [...AUCTION_TABS];
                            setEditUser({ ...editUser, allowedTabs: on ? cur.filter(x => x !== t) : [...cur, t] });
                          }} style={{ fontSize: 8, padding: "3px 6px", borderRadius: 3, border: `1px solid ${on ? B.green : B.grayLight}`, background: on ? B.greenBg : "transparent", color: on ? "#059669" : B.gray, cursor: "pointer", fontWeight: on ? 700 : 400, fontFamily: font }}>{t}</button>;
                        })}
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                        {(u.role === "admin" || isSuperAdmin) ? <span style={{ fontSize: 9, color: B.green, fontWeight: 700 }}>All Pages</span>
                        : (u.allowedTabs || ["Dashboard"]).filter(t => AUCTION_TABS.includes(t)).map(t => <span key={t} style={{ fontSize: 8, background: B.cream, padding: "2px 5px", borderRadius: 3, color: B.grayDark, border: `1px solid ${B.grayLight}` }}>{t}</span>)}
                      </div>
                    )}
                  </td>

                  {/* Logistics Pages */}
                  <td style={{ padding: "12px 14px" }}>
                    {isEditing && !isSuperAdmin ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                        {LOGISTICS_TABS.map(t => {
                          const tabs = editUser.allowedLogisticsTabs || LOGISTICS_TABS;
                          const on = tabs.includes(t);
                          return <button key={t} onClick={() => {
                            const cur = editUser.allowedLogisticsTabs || [...LOGISTICS_TABS];
                            setEditUser({ ...editUser, allowedLogisticsTabs: on ? cur.filter(x => x !== t) : [...cur, t] });
                          }} style={{ fontSize: 8, padding: "3px 6px", borderRadius: 3, border: `1px solid ${on ? B.blue : B.grayLight}`, background: on ? B.blueBg : "transparent", color: on ? B.blue : B.gray, cursor: "pointer", fontWeight: on ? 700 : 400, fontFamily: font }}>{t}</button>;
                        })}
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                        {(u.role === "admin" || isSuperAdmin) ? <span style={{ fontSize: 9, color: B.blue, fontWeight: 700 }}>All Pages</span>
                        : (u.allowedLogisticsTabs || ["Dashboard"]).filter(t => LOGISTICS_TABS.includes(t)).map(t => <span key={t} style={{ fontSize: 8, background: B.cream, padding: "2px 5px", borderRadius: 3, color: B.grayDark, border: `1px solid ${B.grayLight}` }}>{t}</span>)}
                      </div>
                    )}
                  </td>

                  {/* Actions */}
                  <td style={{ padding: "12px 14px" }}>
                    {isSuperAdmin ? <Badge color={B.gray} bg={B.cream}>Protected</Badge>
                    : isEditing ? (
                      <div style={{ display: "flex", gap: 4 }}>
                        <Btn variant="success" onClick={() => {
                          savePerms(u.id, {
                            role: editUser.role,
                            auctionAccess: !!editUser.auctionAccess,
                            logisticsAccess: editUser.logisticsAccess !== false,
                            allowedTabs: editUser.allowedTabs || AUCTION_TABS,
                            allowedLogisticsTabs: editUser.allowedLogisticsTabs || LOGISTICS_TABS,
                          });
                          setEditUser(null);
                        }} disabled={saving} style={{ padding: "6px 12px", fontSize: 11 }}>{saving ? "..." : "Save"}</Btn>
                        <Btn variant="ghost" onClick={() => setEditUser(null)} style={{ padding: "6px 12px", fontSize: 11 }}>Cancel</Btn>
                      </div>
                    ) : (
                      <Btn variant="ghost" onClick={() => setEditUser({ ...u })} style={{ padding: "6px 12px", fontSize: 11 }}>Edit</Btn>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        {filtered.length === 0 && <div style={{ padding: 32, textAlign: "center", color: B.gray, fontSize: 12 }}>No users found</div>}
      </Card>

      {/* Permissions Guide */}
      <div className="admin-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 16 }}>
        <Card style={{ background: B.amberBg, border: `1px solid #FCD34D` }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#92400E", marginBottom: 6 }}><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{I.car(14, "#92400E")} Auto Trade Hub Roles</span></div>
          <div style={{ fontSize: 10, color: "#92400E", lineHeight: 1.8 }}>
            • <b>Admin</b> — All pages + User management<br/>
            • <b>Manager</b> — Assigned pages only<br/>
            • <b>User</b> — Dashboard & Calendar only
          </div>
        </Card>
        <Card style={{ background: B.blueBg, border: `1px solid #93C5FD` }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: B.blueDark, marginBottom: 6 }}><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{I.truck(14, B.blueDark)} Sayarah Logistics Roles</span></div>
          <div style={{ fontSize: 10, color: B.blueDark, lineHeight: 1.8 }}>
            • <b>Admin</b> — All pages + User management<br/>
            • <b>Manager</b> — Assigned pages only<br/>
            • <b>Customer</b> — Dashboard, My Shipments, Rates, My Invoices
          </div>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ACTIVITY / AUDIT LOG
// ═══════════════════════════════════════════════════════════════
function ActivityView({ users }) {
  const toMs = (v) => { if (!v) return 0; if (typeof v === "number") return v; if (v.toMillis) return v.toMillis(); if (v.seconds) return v.seconds * 1000; return new Date(v).getTime() || 0; };
  const recent = [...users].sort((a, b) => {
    const da = toMs(a.lastLogin || a.createdAt);
    const db = toMs(b.lastLogin || b.createdAt);
    return db - da;
  });

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 900, color: B.navy }}>User Activity</div>
        <div style={{ fontSize: 12, color: B.gray }}>Recent registrations and user accounts</div>
      </div>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div className="admin-table-wrap">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: B.cream, borderBottom: `2px solid ${B.grayLight}` }}>
              <th style={{ textAlign: "left", padding: "12px 14px", fontSize: 10, fontWeight: 800, color: B.grayDark, textTransform: "uppercase" }}>User</th>
              <th style={{ textAlign: "left", padding: "12px 14px", fontSize: 10, fontWeight: 800, color: B.grayDark, textTransform: "uppercase" }}>Email</th>
              <th style={{ textAlign: "left", padding: "12px 14px", fontSize: 10, fontWeight: 800, color: B.grayDark, textTransform: "uppercase" }}>Role</th>
              <th style={{ textAlign: "left", padding: "12px 14px", fontSize: 10, fontWeight: 800, color: B.grayDark, textTransform: "uppercase" }}>Auction Access</th>
              <th style={{ textAlign: "left", padding: "12px 14px", fontSize: 10, fontWeight: 800, color: B.grayDark, textTransform: "uppercase" }}>Logistics Access</th>
            </tr>
          </thead>
          <tbody>
            {recent.map(u => {
              const roleInfo = ROLES.find(r => r.key === u.role) || ROLES[3];
              const isSuperAdmin = u.email === SUPER_ADMIN;
              return (
                <tr key={u.id} style={{ borderBottom: `1px solid ${B.grayLight}` }}>
                  <td style={{ padding: "10px 14px", fontWeight: 600 }}>{u.displayName || "—"}{isSuperAdmin && " (Super Admin)"}</td>
                  <td style={{ padding: "10px 14px", color: B.gray }}>{u.email}</td>
                  <td style={{ padding: "10px 14px" }}><Badge color={roleInfo.color} bg={roleInfo.bg}>{roleInfo.label}</Badge></td>
                  <td style={{ padding: "10px 14px", fontSize: 10, color: (isSuperAdmin || u.role === "admin" || u.auctionAccess) ? "#059669" : B.gray, fontWeight: 600 }}>{(isSuperAdmin || u.role === "admin" || u.auctionAccess) ? "✓ Yes" : "✗ No"}</td>
                  <td style={{ padding: "10px 14px", fontSize: 10, color: (isSuperAdmin || u.role === "admin" || u.logisticsAccess !== false) ? B.blue : B.gray, fontWeight: 600 }}>{(isSuperAdmin || u.role === "admin" || u.logisticsAccess !== false) ? "✓ Yes" : "✗ No"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SETTINGS VIEW
// ═══════════════════════════════════════════════════════════════
function SettingsView({ adminEmail }) {
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 900, color: B.navy }}>Settings</div>
        <div style={{ fontSize: 12, color: B.gray }}>Platform configuration and information</div>
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <Card>
          <div style={{ fontSize: 13, fontWeight: 800, color: B.navy, marginBottom: 12 }}><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{I.key(14, B.navy)} Authentication</span></div>
          <div style={{ fontSize: 11, color: B.grayDark, lineHeight: 2 }}>
            <div><b>Provider:</b> Firebase Authentication</div>
            <div><b>Method:</b> Email / Password</div>
            <div><b>Super Admin:</b> {SUPER_ADMIN}</div>
            <div><b>Logged in as:</b> {adminEmail}</div>
          </div>
        </Card>

        <Card>
          <div style={{ fontSize: 13, fontWeight: 800, color: B.navy, marginBottom: 12 }}><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{I.layout(14, B.navy)} Applications</span></div>
          <div className="admin-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ padding: 14, background: B.cream, borderRadius: 8, border: `1px solid ${B.grayLight}` }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: B.navy }}><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{I.car(14, B.navy)} Auto Trade Hub</span></div>
              <div style={{ fontSize: 10, color: B.gray, marginTop: 4 }}>Car auction flipping business management</div>
              <div style={{ fontSize: 10, color: B.grayDark, marginTop: 8 }}>{AUCTION_TABS.length} pages available</div>
            </div>
            <div style={{ padding: 14, background: B.cream, borderRadius: 8, border: `1px solid ${B.grayLight}` }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: B.navy }}><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{I.truck(14, B.navy)} Sayarah Logistics</span></div>
              <div style={{ fontSize: 10, color: B.gray, marginTop: 4 }}>Vehicle shipping & logistics platform</div>
              <div style={{ fontSize: 10, color: B.grayDark, marginTop: 8 }}>{LOGISTICS_TABS.length} pages available</div>
            </div>
          </div>
        </Card>

        <Card>
          <div style={{ fontSize: 13, fontWeight: 800, color: B.navy, marginBottom: 12 }}><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{I.database(14, B.navy)} Database</span></div>
          <div style={{ fontSize: 11, color: B.grayDark, lineHeight: 2 }}>
            <div><b>Provider:</b> Cloud Firestore</div>
            <div><b>Project:</b> sayarah-hub</div>
            <div><b>Collections:</b> users, appData, approvals, activityLog</div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
const NAV_TABS = ["Dashboard", "Users", "Activity", "Settings"];

function AppInner() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [loaded, setLoaded] = useState(true);
  const [adminEmail, setAdminEmail] = useState("");
  const [tab, setTab] = useState("Dashboard");
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      const u = await getAllUsers();
      console.log("getAllUsers returned:", u.length, "users");
      setUsers(u);
    } catch (e) { console.error("getAllUsers error:", e); }
    setLoadingUsers(false);
  };

  // Track unsubscribe function with useRef to persist across renders
  const unsubUsersRef = useRef(null);

  const startUsersListener = () => {
    // Clean up previous listener
    if (unsubUsersRef.current) unsubUsersRef.current();
    try {
      const unsub = onUsersChange(
        (usersList) => {
          console.log("Real-time users update:", usersList.length, "users");
          setUsers(usersList);
          setLoadingUsers(false);
        },
        (err) => {
          // Firestore rules may block collection-level reads — fallback to one-time fetch
          console.warn("Real-time listener failed, falling back to getAllUsers:", err.message);
          loadUsers();
        }
      );
      unsubUsersRef.current = unsub;
    } catch (e) {
      console.warn("Failed to start listener, using getAllUsers:", e.message);
      loadUsers();
    }
  };

  useEffect(() => {
    if (!FIREBASE_ENABLED) { setLoaded(true); return; }
    const timeout = setTimeout(() => { setLoaded(true); }, 5000);
    const unsub = onAuthChange(async (fbUser) => {
      try {
        if (fbUser) {
          const isSuperAdmin = fbUser.email === SUPER_ADMIN;
          if (!isSuperAdmin) {
            const role = await getUserRole(fbUser.uid);
            if (role !== "admin") { await firebaseSignOut(); clearTimeout(timeout); setLoaded(true); return; }
          }
          setAdminEmail(fbUser.email);
          setLoggedIn(true);
          startUsersListener();
        } else {
          // Don't force logout — handled by logout button only
        }
      } catch (e) { console.error("Auth init error:", e); }
      clearTimeout(timeout);
      setLoaded(true);
    });
    return () => { unsub(); clearTimeout(timeout); if (unsubUsersRef.current) unsubUsersRef.current(); };
  }, []);

  const handleLogout = async () => {
    if (unsubUsersRef.current) { unsubUsersRef.current(); unsubUsersRef.current = null; }
    try { await firebaseSignOut(); } catch {}
    setLoggedIn(false);
    setAdminEmail("");
    setTab("Dashboard");
    setUsers([]);
    setLoadingUsers(true);
  };

  if (!loaded) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: B.navy, fontFamily: font }}>
      <div style={{ textAlign: "center" }}>
        <img src="/logo.png" alt="Sayarah" style={{ height: 60, objectFit: "contain" }} />
        <div style={{ color: B.gray, fontSize: 12, marginTop: 12 }}>Loading...</div>
      </div>
    </div>
  );

  if (!loggedIn) return <LoginPage onLogin={() => setLoggedIn(true)} />;

  return (
    <div style={{ fontFamily: font, background: B.cream, minHeight: "100vh", color: B.navy }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <style>{`
@media(max-width:768px){
  .admin-topbar-inner{flex-wrap:wrap!important;height:auto!important;padding:10px 0!important;gap:8px!important}
  .admin-topbar-inner>div:last-child{width:100%;justify-content:flex-end}
  .admin-nav{overflow-x:auto!important;-webkit-overflow-scrolling:touch;flex-wrap:nowrap!important}
  .admin-nav button{white-space:nowrap!important;flex-shrink:0!important;padding:8px 12px!important}
  .admin-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
  .admin-table-wrap table{min-width:700px}
  .admin-2col{grid-template-columns:1fr!important}
  .admin-content{padding:16px 12px!important}
}
@media(max-width:480px){
  .admin-topbar{padding:0 12px!important}
  .admin-topbar-inner .admin-brand-text{display:none!important}
}
`}</style>

      {/* Top Bar */}
      <div className="admin-topbar" style={{ background: "#FFFFFF", padding: "0 24px", position: "sticky", top: 0, zIndex: 100, borderBottom: "1px solid #E5E7EB", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
        <div className="admin-topbar-inner" style={{ maxWidth: 1400, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ background: "#4A0E0E", color: "#FFFFFF", padding: "8px 14px", fontWeight: 900, fontSize: 14, letterSpacing: "0.12em", lineHeight: 1 }}>SAYARAH</div>
          </div>

          <nav className="admin-nav" style={{ display: "flex", gap: 4 }}>
            {NAV_TABS.map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                background: "transparent",
                color: tab === t ? "#111" : "#6B7280",
                border: "none", borderRadius: 0, padding: "8px 18px", fontSize: 12, fontWeight: tab === t ? 700 : 500,
                cursor: "pointer", fontFamily: font, transition: "all .2s",
                textTransform: "uppercase", letterSpacing: "0.06em",
                borderBottom: tab === t ? "2px solid #4A0E0E" : "2px solid transparent",
              }}>{t.toUpperCase()}</button>
            ))}
          </nav>

          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button onClick={() => setTab("Settings")} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", alignItems: "center" }}>
              {I.settings(18, "#6B7280")}
            </button>
            <div style={{
              width: 34, height: 34, borderRadius: "50%", background: "#4A0E0E", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 700, fontFamily: font, cursor: "pointer",
            }} title={adminEmail}>
              {adminEmail ? adminEmail.charAt(0).toUpperCase() : "A"}
            </div>
            <button onClick={handleLogout} style={{ background: "transparent", border: "1px solid #E5E7EB", color: "#374151", borderRadius: 6, padding: "6px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: font, transition: "all .2s" }}>Sign Out</button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="admin-content" style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 20px" }}>
        {loadingUsers && tab !== "Settings" ? (
          <div style={{ textAlign: "center", padding: 60, color: B.gray }}>
            <div style={{ marginBottom: 12 }}>{I.loader(28, B.gray)}</div>
            Loading users...
          </div>
        ) : (
          <>
            {tab === "Dashboard" && <DashboardView users={users} adminEmail={adminEmail} />}
            {tab === "Users" && <UsersView users={users} onRefresh={loadUsers} />}
            {tab === "Activity" && <ActivityView users={users} />}
            {tab === "Settings" && <SettingsView adminEmail={adminEmail} />}
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{ textAlign: "center", padding: "24px 0", borderTop: `1px solid ${B.grayLight}`, marginTop: 40 }}>
        <div style={{ fontSize: 10, color: B.gray }}>Powered by <b>Sayarah Inc</b> — Unified Admin Panel v1.0</div>
      </div>
    </div>
  );
}

export default function App() {
  return <ErrorBoundary><ToastProvider><AppInner /></ToastProvider></ErrorBoundary>;
}

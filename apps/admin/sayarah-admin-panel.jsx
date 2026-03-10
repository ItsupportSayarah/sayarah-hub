import { useState, useEffect } from "react";
import { auth, firebaseSignIn, firebaseSignOut, onAuthChange, getUserRole, getAllUsers, updateUserPermissions, getUserData } from "./src/firebase.js";

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
const ROLES = [
  { key: "admin", label: "Admin", color: B.amber, bg: B.amberBg, icon: "👑" },
  { key: "manager", label: "Manager", color: B.blue, bg: B.blueBg, icon: "📋" },
  { key: "user", label: "User", color: B.green, bg: B.greenBg, icon: "👤" },
  { key: "customer", label: "Customer", color: B.purple, bg: B.purpleBg, icon: "🛒" },
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
    if (!email || !pass) { setErr("Email and password required"); return; }
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
function DashboardView({ users }) {
  const totalUsers = users.length;
  const admins = users.filter(u => u.role === "admin").length;
  const managers = users.filter(u => u.role === "manager").length;
  const regularUsers = totalUsers - admins - managers;

  const stats = [
    { label: "Total Users", value: totalUsers, icon: "👥", color: B.blue, bg: B.blueBg },
    { label: "Admins", value: admins, icon: "👑", color: B.amber, bg: B.amberBg },
    { label: "Managers", value: managers, icon: "📋", color: B.purple, bg: B.purpleBg },
    { label: "Users / Customers", value: regularUsers, icon: "👤", color: B.green, bg: B.greenBg },
  ];

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 900, color: B.navy }}>Dashboard</div>
        <div style={{ fontSize: 12, color: B.gray }}>Overview of all Sayarah applications and users</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 24 }}>
        {stats.map(s => (
          <Card key={s.label} style={{ padding: 18, display: "flex", alignItems: "center", gap: 14, borderLeft: `4px solid ${s.color}` }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: s.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{s.icon}</div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 900, color: B.navy }}>{s.value}</div>
              <div style={{ fontSize: 10, color: B.gray, fontWeight: 600 }}>{s.label}</div>
            </div>
          </Card>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card style={{ borderTop: `3px solid ${B.red}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: B.redBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🚗</div>
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
            <div style={{ width: 36, height: 36, borderRadius: 8, background: B.blueBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🚚</div>
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
          <div style={{ fontSize: 28 }}>🛡️</div>
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
        <Btn onClick={onRefresh}>↻ Refresh</Btn>
      </div>

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
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: B.cream, borderBottom: `2px solid ${B.grayLight}` }}>
              <th style={{ textAlign: "left", padding: "12px 14px", fontSize: 10, fontWeight: 800, color: B.grayDark, textTransform: "uppercase", letterSpacing: ".05em" }}>User</th>
              <th style={{ textAlign: "left", padding: "12px 14px", fontSize: 10, fontWeight: 800, color: B.grayDark, textTransform: "uppercase", letterSpacing: ".05em" }}>Role</th>
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
                        {isSuperAdmin && <Badge color="#92400E" bg={B.amberBg}>🛡️ SUPER ADMIN</Badge>}
                      </div>
                    </div>
                  </td>

                  {/* Role */}
                  <td style={{ padding: "12px 14px" }}>
                    {isEditing && !isSuperAdmin ? (
                      <select value={editUser.role || "user"} onChange={e => setEditUser({ ...editUser, role: e.target.value })} style={{ fontSize: 11, padding: "6px 10px", borderRadius: 6, border: `1px solid ${B.grayLight}`, fontFamily: font, background: B.white }}>
                        {ROLES.map(r => <option key={r.key} value={r.key}>{r.icon} {r.label}</option>)}
                      </select>
                    ) : (
                      <Badge color={roleInfo.color} bg={roleInfo.bg}>{roleInfo.icon} {roleInfo.label}</Badge>
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
        {filtered.length === 0 && <div style={{ padding: 32, textAlign: "center", color: B.gray, fontSize: 12 }}>No users found</div>}
      </Card>

      {/* Permissions Guide */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 16 }}>
        <Card style={{ background: B.amberBg, border: `1px solid #FCD34D` }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#92400E", marginBottom: 6 }}>🚗 Auto Trade Hub Roles</div>
          <div style={{ fontSize: 10, color: "#92400E", lineHeight: 1.8 }}>
            • <b>Admin</b> — All pages + User management<br/>
            • <b>Manager</b> — Assigned pages only<br/>
            • <b>User</b> — Dashboard & Calendar only
          </div>
        </Card>
        <Card style={{ background: B.blueBg, border: `1px solid #93C5FD` }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: B.blueDark, marginBottom: 6 }}>🚚 Sayarah Logistics Roles</div>
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
  const recent = [...users].sort((a, b) => {
    const da = a.lastLogin || a.createdAt || 0;
    const db = b.lastLogin || b.createdAt || 0;
    return db - da;
  });

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 900, color: B.navy }}>User Activity</div>
        <div style={{ fontSize: 12, color: B.gray }}>Recent registrations and user accounts</div>
      </div>
      <Card style={{ padding: 0, overflow: "hidden" }}>
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
                  <td style={{ padding: "10px 14px", fontWeight: 600 }}>{u.displayName || "—"}{isSuperAdmin && " 🛡️"}</td>
                  <td style={{ padding: "10px 14px", color: B.gray }}>{u.email}</td>
                  <td style={{ padding: "10px 14px" }}><Badge color={roleInfo.color} bg={roleInfo.bg}>{roleInfo.label}</Badge></td>
                  <td style={{ padding: "10px 14px", fontSize: 10, color: B.grayDark }}>{isSuperAdmin || u.role === "admin" ? "Full" : (u.allowedTabs || ["Dashboard"]).length + " pages"}</td>
                  <td style={{ padding: "10px 14px", fontSize: 10, color: B.grayDark }}>{isSuperAdmin || u.role === "admin" ? "Full" : (u.allowedLogisticsTabs || ["Dashboard"]).length + " pages"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
          <div style={{ fontSize: 13, fontWeight: 800, color: B.navy, marginBottom: 12 }}>🔑 Authentication</div>
          <div style={{ fontSize: 11, color: B.grayDark, lineHeight: 2 }}>
            <div><b>Provider:</b> Firebase Authentication</div>
            <div><b>Method:</b> Email / Password</div>
            <div><b>Super Admin:</b> {SUPER_ADMIN}</div>
            <div><b>Logged in as:</b> {adminEmail}</div>
          </div>
        </Card>

        <Card>
          <div style={{ fontSize: 13, fontWeight: 800, color: B.navy, marginBottom: 12 }}>📱 Applications</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ padding: 14, background: B.cream, borderRadius: 8, border: `1px solid ${B.grayLight}` }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: B.navy }}>🚗 Auto Trade Hub</div>
              <div style={{ fontSize: 10, color: B.gray, marginTop: 4 }}>Car auction flipping business management</div>
              <div style={{ fontSize: 10, color: B.grayDark, marginTop: 8 }}>{AUCTION_TABS.length} pages available</div>
            </div>
            <div style={{ padding: 14, background: B.cream, borderRadius: 8, border: `1px solid ${B.grayLight}` }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: B.navy }}>🚚 Sayarah Logistics</div>
              <div style={{ fontSize: 10, color: B.gray, marginTop: 4 }}>Vehicle shipping & logistics platform</div>
              <div style={{ fontSize: 10, color: B.grayDark, marginTop: 8 }}>{LOGISTICS_TABS.length} pages available</div>
            </div>
          </div>
        </Card>

        <Card>
          <div style={{ fontSize: 13, fontWeight: 800, color: B.navy, marginBottom: 12 }}>🗄️ Database</div>
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

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [tab, setTab] = useState("Dashboard");
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const loadUsers = async () => {
    setLoadingUsers(true);
    try { const u = await getAllUsers(); setUsers(u); } catch (e) { console.error(e); }
    setLoadingUsers(false);
  };

  useEffect(() => {
    if (!FIREBASE_ENABLED) { setLoaded(true); return; }
    const unsub = onAuthChange(async (fbUser) => {
      if (fbUser) {
        const isSuperAdmin = fbUser.email === SUPER_ADMIN;
        if (!isSuperAdmin) {
          const role = await getUserRole(fbUser.uid);
          if (role !== "admin") { await firebaseSignOut(); setLoaded(true); return; }
        }
        setAdminEmail(fbUser.email);
        setLoggedIn(true);
        await loadUsers();
      } else {
        setLoggedIn(false);
        setAdminEmail("");
      }
      setLoaded(true);
    });
    return () => unsub();
  }, []);

  const handleLogout = async () => {
    try { await firebaseSignOut(); } catch {}
    setLoggedIn(false);
    setAdminEmail("");
    setTab("Dashboard");
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

      {/* Top Bar */}
      <div style={{ background: `linear-gradient(135deg, ${B.navy} 0%, ${B.navyLight} 100%)`, padding: "0 24px", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 4px 20px rgba(0,0,0,.3)" }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/logo.png" alt="Sayarah" style={{ height: 32, objectFit: "contain" }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 900, color: B.white, letterSpacing: "-.3px" }}>Sayarah Admin Panel</div>
              <div style={{ fontSize: 8, color: B.gray, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".1em" }}>Unified Control Center</div>
            </div>
          </div>

          <nav style={{ display: "flex", gap: 2 }}>
            {NAV_TABS.map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                background: tab === t ? "rgba(255,255,255,.12)" : "transparent",
                color: tab === t ? B.white : "rgba(255,255,255,.45)",
                border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 12, fontWeight: tab === t ? 800 : 500,
                cursor: "pointer", fontFamily: font, transition: "all .2s",
                borderBottom: tab === t ? `2px solid ${B.blue}` : "2px solid transparent",
              }}>{t === "Users" ? `👥 ${t}` : t === "Dashboard" ? `📊 ${t}` : t === "Activity" ? `📋 ${t}` : `⚙️ ${t}`}</button>
            ))}
          </nav>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Badge color={B.amber} bg={B.amberBg}>👑 Super Admin</Badge>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,.5)" }}>{adminEmail}</span>
            <button onClick={handleLogout} style={{ background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.15)", color: "#fff", borderRadius: 6, padding: "6px 12px", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: font }}>Sign Out</button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 20px" }}>
        {loadingUsers && tab !== "Settings" ? (
          <div style={{ textAlign: "center", padding: 60, color: B.gray }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>⏳</div>
            Loading users...
          </div>
        ) : (
          <>
            {tab === "Dashboard" && <DashboardView users={users} />}
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

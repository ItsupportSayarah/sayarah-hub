// ═══════════════════════════════════════════════════════════════
//  Firebase Configuration — Auto Trade Hub
//  Replace the config below with YOUR Firebase project config
// ═══════════════════════════════════════════════════════════════

import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, updatePassword, reauthenticateWithCredential, EmailAuthProvider, sendPasswordResetEmail } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, collection, getDocs, deleteDoc, query, where, serverTimestamp } from "firebase/firestore";

// ──────────────────────────────────────────────────────────────
// ⚠️  PASTE YOUR FIREBASE CONFIG HERE
//     Get it from: Firebase Console → Project Settings → Your Apps
// ──────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FB_API_KEY || "AIzaSyBKMJB6qdSStpzWBqxr6hW4YAigT-DyaOg",
  authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN || "sayarah-hub.firebaseapp.com",
  projectId: import.meta.env.VITE_FB_PROJECT_ID || "sayarah-hub",
  storageBucket: import.meta.env.VITE_FB_STORAGE_BUCKET || "sayarah-hub.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FB_MESSAGING_SENDER_ID || "807394144397",
  appId: import.meta.env.VITE_FB_APP_ID || "1:807394144397:web:07a07c9720cf809924b2c4",
  measurementId: import.meta.env.VITE_FB_MEASUREMENT_ID || "G-J4W3YENY76",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ═══════════════════════════════════════════════════════════════
//  AUTH HELPERS
// ═══════════════════════════════════════════════════════════════

// Sign up a new user with email & password
export async function firebaseSignUp(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName });
  // Create user doc in Firestore with role
  await setDoc(doc(db, "users", cred.user.uid), {
    uid: cred.user.uid,
    email,
    displayName,
    role: "user",
    logisticsAccess: true,
    auctionAccess: false,
    createdAt: serverTimestamp(),
  });
  return cred.user;
}

// Super admin email — Firestore rules check this email directly so
// admin powers work even before the user's Firestore doc has role=admin.
// Must stay in sync with firestore.rules and the auction app's value.
export const SUPER_ADMIN_EMAIL = (import.meta.env.VITE_SUPER_ADMIN_EMAIL || "support@sayarah.io").toLowerCase();

// Sign in existing user (ensures Firestore user doc exists AND the
// super-admin email has role=admin — client treats super admin as
// admin by email, Firestore rules check the role field. They must
// agree or every rule-gated write fails silently).
export async function firebaseSignIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const isSuper = (cred.user.email || "").toLowerCase() === SUPER_ADMIN_EMAIL;
  const ref = doc(db, "users", cred.user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const name = cred.user.displayName || email.split("@")[0];
    await setDoc(ref, {
      uid: cred.user.uid,
      email: cred.user.email,
      displayName: name,
      firstName: name.split(" ")[0] || "",
      lastName: name.split(" ").slice(1).join(" ") || "",
      role: isSuper ? "admin" : "user",
      logisticsAccess: true,
      auctionAccess: isSuper ? true : false,
      createdAt: serverTimestamp(),
    });
  } else if (isSuper && snap.data().role !== "admin") {
    await setDoc(ref, { role: "admin", auctionAccess: true }, { merge: true });
  }
  // Record login event
  await recordLoginEvent(cred.user.uid);
  return cred.user;
}

// Ensure the signed-in user has a Firestore doc AND that the super
// admin has role=admin. Idempotent — safe to call on every auth-state
// change. Self-writes are always allowed by the rules, so this fires
// even before the super admin has been promoted.
export async function ensureUserDoc(fbUser) {
  if (!fbUser) return null;
  const isSuper = (fbUser.email || "").toLowerCase() === SUPER_ADMIN_EMAIL;
  const ref = doc(db, "users", fbUser.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const name = fbUser.displayName || (fbUser.email || "").split("@")[0] || "User";
    await setDoc(ref, {
      uid: fbUser.uid,
      email: fbUser.email,
      displayName: name,
      firstName: name.split(" ")[0] || "",
      lastName: name.split(" ").slice(1).join(" ") || "",
      role: isSuper ? "admin" : "user",
      logisticsAccess: true,
      auctionAccess: isSuper,
      createdAt: serverTimestamp(),
    });
    return { role: isSuper ? "admin" : "user", created: true };
  }
  if (isSuper && snap.data().role !== "admin") {
    await setDoc(ref, { role: "admin", auctionAccess: true }, { merge: true });
    return { role: "admin", promoted: true };
  }
  return snap.data();
}

// Send password reset email
export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

// Change user password (requires re-authentication)
export async function changePassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  if (!user || !user.email) throw new Error("Not signed in");
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
}

// Fetch IP and location with multiple fallback APIs
async function fetchGeoInfo() {
  const apis = [
    { url: "https://api.ipify.org?format=json", parse: (d) => ({ ip: d.ip }) },
    { url: "https://ipapi.co/json/", parse: (d) => ({ ip: d.ip, location: [d.city, d.region, d.country_name].filter(Boolean).join(", ") }) },
    { url: "https://ip-api.com/json/?fields=query,city,regionName,country", parse: (d) => ({ ip: d.query, location: [d.city, d.regionName, d.country].filter(Boolean).join(", ") }) },
  ];
  let ip = "Unknown", location = "Unknown";
  try { const res = await fetch(apis[0].url); if (res.ok) { const d = await res.json(); ip = d.ip || "Unknown"; } } catch {}
  for (let i = 1; i < apis.length; i++) {
    try { const res = await fetch(apis[i].url); if (res.ok) { const d = await res.json(); const p = apis[i].parse(d); if (p.location && p.location !== "Unknown") location = p.location; if (ip === "Unknown" && p.ip) ip = p.ip; if (location !== "Unknown") break; } } catch {}
  }
  return { ip, location };
}

// Record login timestamp, location, and IP
export async function recordLoginEvent(uid) {
  try {
    const { ip, location } = await fetchGeoInfo();
    const snap = await getDoc(doc(db, "users", uid));
    const prev = snap.exists() ? snap.data() : {};
    const update = { lastLoginAt: new Date().toISOString(), lastLoginLocation: location, lastLoginIp: ip };
    if (prev.lastLoginAt) { update.prevLoginAt = prev.lastLoginAt; update.prevLoginLocation = prev.lastLoginLocation || "Unknown"; update.prevLoginIp = prev.lastLoginIp || "Unknown"; }
    await setDoc(doc(db, "users", uid), update, { merge: true });
  } catch (e) { console.warn("Failed to record login event:", e); }
}

// Sign out
export async function firebaseSignOut() {
  await signOut(auth);
}

// Listen for auth state changes
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// Get user role from Firestore
export async function getUserRole(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (snap.exists()) return snap.data().role || "user";
  return "user";
}

// Get user profile from Firestore
export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (snap.exists()) return snap.data();
  return null;
}

// Update user role (admin only)
export async function updateUserRole(uid, role) {
  await setDoc(doc(db, "users", uid), { role }, { merge: true });
}

// Update user permissions (role + allowed tabs)
export async function updateUserPermissions(uid, updates) {
  await setDoc(doc(db, "users", uid), updates, { merge: true });
}

// Get full user data including permissions
export async function getUserData(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (snap.exists()) return snap.data();
  return null;
}

// Get all users (admin)
export async function getAllUsers() {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Listen to users collection in real-time
export function onUsersChange(callback, onError) {
  return onSnapshot(collection(db, "users"), (snap) => {
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(users);
  }, (err) => {
    console.error("onUsersChange error:", err);
    if (onError) onError(err);
  });
}

// ═══════════════════════════════════════════════════════════════
//  DATA HELPERS — Replaces localStorage
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
//  SEPARATED DATA — Each app has its own Firestore collections
// ═══════════════════════════════════════════════════════════════

// ─── Auction App Data ───
export async function saveAuctionData(uid, data) {
  await setDoc(doc(db, "auctionData", uid), { ...data, updatedAt: serverTimestamp() });
}
export async function loadAuctionData(uid) {
  const snap = await getDoc(doc(db, "auctionData", uid));
  if (snap.exists()) { const d = snap.data(); delete d.updatedAt; return d; }
  return null;
}

// ─── Logistics App Data ───
export async function saveLogisticsData(uid, data) {
  await setDoc(doc(db, "logisticsData", uid), { ...data, updatedAt: serverTimestamp() });
}
export async function loadLogisticsData(uid) {
  const snap = await getDoc(doc(db, "logisticsData", uid));
  if (snap.exists()) { const d = snap.data(); delete d.updatedAt; return d; }
  return null;
}

// ─── Generic (kept for backward compat) ───
export async function saveAppData(uid, data) {
  await setDoc(doc(db, "auctionData", uid), { ...data, updatedAt: serverTimestamp() });
}
export async function loadAppData(uid) {
  const snap = await getDoc(doc(db, "auctionData", uid));
  if (snap.exists()) { const d = snap.data(); delete d.updatedAt; return d; }
  return null;
}
export function onAppDataChange(uid, callback) {
  return onSnapshot(doc(db, "auctionData", uid), (snap) => {
    if (snap.exists()) { const d = snap.data(); delete d.updatedAt; callback(d); }
  });
}

// ─── Approvals ───
export async function saveApprovalsFB(list) {
  await setDoc(doc(db, "auctionShared", "approvals"), { items: list, updatedAt: serverTimestamp() });
}
export async function loadApprovalsFB() {
  const snap = await getDoc(doc(db, "auctionShared", "approvals"));
  if (snap.exists()) return snap.data().items || [];
  return [];
}

// ─── Activity Log ───
export async function saveActivityLogFB(list) {
  await setDoc(doc(db, "auctionShared", "activityLog"), { items: list, updatedAt: serverTimestamp() });
}
export async function loadActivityLogFB() {
  const snap = await getDoc(doc(db, "auctionShared", "activityLog"));
  if (snap.exists()) return snap.data().items || [];
  return [];
}

// ─── Create user doc manually (admin adds user to Firestore) ───
export async function createUserDoc(uid, email, displayName, role = "user") {
  await setDoc(doc(db, "users", uid), {
    uid,
    email,
    displayName: displayName || email.split("@")[0],
    role,
    logisticsAccess: true,
    auctionAccess: false,
    createdAt: serverTimestamp(),
  }, { merge: true });
}

// ─── Add user by email (creates Firestore doc using email-based ID) ───
// Deduplicates by email case-insensitively. Returns the created id
// so the caller can refresh its list / show a success message.
export async function addUserByEmail(email, displayName, role = "user", { firstName, lastName, allowedTabs, auctionAccess } = {}) {
  const existing = await getDocs(collection(db, "users"));
  const dup = existing.docs.find(d => (d.data().email || "").toLowerCase() === email.toLowerCase());
  if (dup) throw new Error("User with this email already exists");
  const id = email.toLowerCase().replace(/[^a-z0-9@._-]/g, "").replace(/[@.]/g, "_");
  const fn = firstName || displayName?.split(" ")[0] || email.split("@")[0];
  const ln = lastName || displayName?.split(" ").slice(1).join(" ") || "";
  await setDoc(doc(db, "users", id), {
    uid: id,
    email,
    displayName: displayName || `${fn} ${ln}`.trim() || email.split("@")[0],
    firstName: fn,
    lastName: ln,
    role,
    auctionAccess: auctionAccess !== undefined ? auctionAccess : true,
    logisticsAccess: true,
    allowedTabs: Array.isArray(allowedTabs) ? allowedTabs : null,
    addedByAdmin: true,
    createdAt: serverTimestamp(),
  });
  return { id, email };
}

// Delete a user's Firestore doc. Admin-only. Does not delete the
// Firebase Auth account — that requires the Admin SDK server-side.
export async function deleteUserDoc(id) {
  await deleteDoc(doc(db, "users", id));
}

// ─── Users list for admin management ───
export async function saveUsersFB(users) {
  await setDoc(doc(db, "auctionShared", "usersList"), { items: users, updatedAt: serverTimestamp() });
}
export async function loadUsersFB() {
  const snap = await getDoc(doc(db, "auctionShared", "usersList"));
  if (snap.exists()) return snap.data().items || [];
  return [];
}

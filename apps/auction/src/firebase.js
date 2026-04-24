// ═══════════════════════════════════════════════════════════════
//  Firebase Configuration — Auto Trade Hub
//  Replace the config below with YOUR Firebase project config
// ═══════════════════════════════════════════════════════════════

import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, updatePassword, reauthenticateWithCredential, EmailAuthProvider, sendPasswordResetEmail } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc, addDoc, onSnapshot, collection, getDocs, deleteDoc, query, where, orderBy, limit as fsLimit, serverTimestamp, runTransaction } from "firebase/firestore";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";

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
export const storage = getStorage(app);

// ═══════════════════════════════════════════════════════════════
//  FILE STORAGE — Vehicle photos & documents
// ═══════════════════════════════════════════════════════════════

// Upload a file and return its download URL
export async function uploadFile(path, file) {
  const fileRef = storageRef(storage, path);
  await uploadBytes(fileRef, file);
  return await getDownloadURL(fileRef);
}

// Delete a file from storage
export async function deleteFile(path) {
  try {
    const fileRef = storageRef(storage, path);
    await deleteObject(fileRef);
  } catch (e) {
    if (e.code !== "storage/object-not-found") throw e;
  }
}

// ═══════════════════════════════════════════════════════════════
//  AUTH HELPERS
// ═══════════════════════════════════════════════════════════════

// Sign up a new user with email & password
export async function firebaseSignUp(email, password, displayName, { firstName, lastName } = {}) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName });
  // Create user doc in Firestore with role
  await setDoc(doc(db, "users", cred.user.uid), {
    uid: cred.user.uid,
    email,
    displayName,
    firstName: firstName || displayName.split(" ")[0] || "",
    lastName: lastName || displayName.split(" ").slice(1).join(" ") || "",
    role: "user",
    logisticsAccess: true,
    auctionAccess: false,
    createdAt: serverTimestamp(),
  });
  return cred.user;
}

// Super admin email is stored in env (build-time) and hardcoded here
// as a fallback so the client always knows who has auto-admin rights.
// Firestore rules can't read env vars, so we also have to mirror this
// email in the rules file (see firestore.rules).
const SUPER_ADMIN_EMAIL = (import.meta.env.VITE_SUPER_ADMIN_EMAIL || "support@sayarah.io").toLowerCase();

// Sign in existing user (ensures Firestore user doc exists AND that
// the super-admin email has role=admin on the Firestore doc — the
// client-side app treats the super-admin email as admin via a simple
// email check, but Firestore rules check the `role` field. If the two
// drift (e.g. signup created a "user" role doc for the super admin),
// every rule-gated write fails silently. We reconcile on every sign-in.
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
    // Doc exists but role is stale — promote to admin. Self-write is
    // always allowed by the rules (request.auth.uid == uid).
    await setDoc(ref, { role: "admin", auctionAccess: true }, { merge: true });
  }
  // Record login event
  await recordLoginEvent(cred.user.uid);
  return cred.user;
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
  // First get IP from ipify (most reliable)
  try {
    const res = await fetch(apis[0].url);
    if (res.ok) { const d = await res.json(); ip = d.ip || "Unknown"; }
  } catch {}
  // Then try to get location
  for (let i = 1; i < apis.length; i++) {
    try {
      const res = await fetch(apis[i].url);
      if (res.ok) {
        const d = await res.json();
        const parsed = apis[i].parse(d);
        if (parsed.location && parsed.location !== "Unknown") location = parsed.location;
        if (ip === "Unknown" && parsed.ip) ip = parsed.ip;
        if (location !== "Unknown") break;
      }
    } catch {}
  }
  return { ip, location };
}

// Record login timestamp, location, and IP
export async function recordLoginEvent(uid) {
  try {
    const { ip, location } = await fetchGeoInfo();
    // Read current login info to save as "previous"
    const snap = await getDoc(doc(db, "users", uid));
    const prev = snap.exists() ? snap.data() : {};
    const update = {
      lastLoginAt: new Date().toISOString(),
      lastLoginLocation: location,
      lastLoginIp: ip,
    };
    // Save previous login info (only if there was a previous login)
    if (prev.lastLoginAt) {
      update.prevLoginAt = prev.lastLoginAt;
      update.prevLoginLocation = prev.lastLoginLocation || "Unknown";
      update.prevLoginIp = prev.lastLoginIp || "Unknown";
    }
    await setDoc(doc(db, "users", uid), update, { merge: true });
  } catch (e) {
    console.warn("Failed to record login event:", e);
  }
}

// Sign out
export async function firebaseSignOut() {
  await signOut(auth);
}

// Ensure the signed-in user has a Firestore doc AND that the
// super-admin email has role="admin" on that doc. Safe to call on
// every sign-in / every auth-state change — it's idempotent.
// Matters for every rule-gated write: Firestore rules check the role
// field, so if the client treats super admin as admin but Firestore
// still shows "user", writes (like addUserByEmail) silently fail.
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

// Add a user by email from the admin UI — creates a Firestore doc so the
// user shows up in the Users tab immediately. When they later sign in
// through the normal auth flow, firebaseSignIn's safety net attaches
// their real Firebase UID doc; this email-keyed placeholder can be
// merged/cleaned up later.
export async function addUserByEmail(email, displayName, role = "user", { firstName, lastName, allowedTabs, auctionAccess } = {}) {
  // Guard duplicates — one doc per email across any id scheme.
  const existing = await getDocs(collection(db, "users"));
  const dup = existing.docs.find(d => (d.data().email || "").toLowerCase() === email.toLowerCase());
  if (dup) throw new Error("User with this email already exists");
  // Deterministic email-derived id so subsequent reads resolve to the
  // same doc and admins can't accidentally double-create.
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

// Delete a user doc by id (admin only). Does NOT delete the Firebase
// Auth account (that requires the Admin SDK server-side) — but removing
// the Firestore record blocks them from the app and from the Users tab.
export async function deleteUserDoc(id) {
  const { deleteDoc } = await import("firebase/firestore");
  await deleteDoc(doc(db, "users", id));
}

// ═══════════════════════════════════════════════════════════════
//  DATA HELPERS — Shared data (all users read/write same document)
// ═══════════════════════════════════════════════════════════════

// Save shared app data — ALL users share one document
export async function saveSharedData(data) {
  await setDoc(doc(db, "auctionShared", "appData"), {
    ...data,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

// Save only specific fields to avoid overwriting concurrent changes
export async function saveSharedFields(fields) {
  await setDoc(doc(db, "auctionShared", "appData"), {
    ...fields,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

// Atomic read-merge-write using a Firestore transaction.
// `merger` receives the current remote doc (or null if missing) and must
// return the new value to write. Firestore retries automatically if the
// underlying doc changes between the transaction's read and write, so the
// merger may be invoked more than once — it must be pure.
// The stored doc carries a `_version` counter, monotonically incremented,
// useful for client-side conflict detection and debugging.
export async function saveSharedDataTxn(merger) {
  const ref = doc(db, "auctionShared", "appData");
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? snap.data() : null;
    const next = merger(current);
    const nextVersion = (current?._version || 0) + 1;
    tx.set(ref, { ...next, _version: nextVersion, updatedAt: serverTimestamp() });
    return { version: nextVersion, value: next };
  });
}

// Load shared data once
export async function loadSharedData() {
  const snap = await getDoc(doc(db, "auctionShared", "appData"));
  if (snap.exists()) {
    const d = snap.data();
    delete d.updatedAt;
    return d;
  }
  return null;
}

// Listen to shared data changes in real-time
export function onSharedDataChange(callback) {
  return onSnapshot(doc(db, "auctionShared", "appData"), (snap) => {
    if (snap.exists()) {
      const d = snap.data();
      delete d.updatedAt;
      callback(d);
    }
  });
}

// ─── Legacy per-user data (kept for migration) ───
export async function saveAppData(uid, data) {
  await setDoc(doc(db, "auctionData", uid), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function loadAppData(uid) {
  const snap = await getDoc(doc(db, "auctionData", uid));
  if (snap.exists()) {
    const d = snap.data();
    delete d.updatedAt;
    return d;
  }
  return null;
}

export function onAppDataChange(uid, callback) {
  return onSnapshot(doc(db, "auctionData", uid), (snap) => {
    if (snap.exists()) {
      const d = snap.data();
      delete d.updatedAt;
      callback(d);
    }
  });
}

// ─── Approvals (Auction-specific) ───
export async function saveApprovalsFB(list) {
  await setDoc(doc(db, "auctionShared", "approvals"), { items: list, updatedAt: serverTimestamp() });
}

export async function loadApprovalsFB() {
  const snap = await getDoc(doc(db, "auctionShared", "approvals"));
  if (snap.exists()) return snap.data().items || [];
  return [];
}

// ─── Activity Log (Auction-specific) — append-only ───
// New entries go to the `activityLog` top-level collection (one doc per entry),
// which is protected by create-only Firestore rules. The legacy single-doc
// store at `auctionShared/activityLog` is still read during the transition
// so existing history remains visible.
export async function addActivityLogEntryFB(entry) {
  await addDoc(collection(db, "activityLog"), { ...entry, createdAt: serverTimestamp() });
}

export async function loadActivityLogFB(max = 500) {
  const out = [];
  try {
    const q = query(collection(db, "activityLog"), orderBy("timestamp", "desc"), fsLimit(max));
    const snap = await getDocs(q);
    snap.forEach(d => out.push({ _docId: d.id, ...d.data() }));
  } catch (e) {
    // New collection may not exist yet
  }
  if (out.length < max) {
    try {
      const legacy = await getDoc(doc(db, "auctionShared", "activityLog"));
      if (legacy.exists()) {
        const items = legacy.data().items || [];
        const seen = new Set(out.map(x => x.id));
        for (const it of items) {
          if (out.length >= max) break;
          if (!seen.has(it.id)) out.push(it);
        }
      }
    } catch (e) {
      // legacy missing is fine
    }
  }
  return out;
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

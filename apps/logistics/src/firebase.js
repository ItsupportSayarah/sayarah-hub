// ═══════════════════════════════════════════════════════════════
//  Firebase Configuration — Auto Trade Hub
//  Replace the config below with YOUR Firebase project config
// ═══════════════════════════════════════════════════════════════

import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, collection, getDocs, deleteDoc, query, where, serverTimestamp } from "firebase/firestore";
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

// Sign in existing user (ensures Firestore user doc exists)
export async function firebaseSignIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const snap = await getDoc(doc(db, "users", cred.user.uid));
  if (!snap.exists()) {
    const name = cred.user.displayName || email.split("@")[0];
    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid,
      email: cred.user.email,
      displayName: name,
      firstName: name.split(" ")[0] || "",
      lastName: name.split(" ").slice(1).join(" ") || "",
      role: "user",
      logisticsAccess: true,
      auctionAccess: false,
      createdAt: serverTimestamp(),
    });
  }
  // Record login event
  await recordLoginEvent(cred.user.uid);
  return cred.user;
}

// Change user password (requires re-authentication)
export async function changePassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  if (!user || !user.email) throw new Error("Not signed in");
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
}

// Record login timestamp and location
export async function recordLoginEvent(uid) {
  try {
    let location = "Unknown";
    try {
      const res = await fetch("https://ipapi.co/json/");
      if (res.ok) {
        const geo = await res.json();
        location = [geo.city, geo.region, geo.country_name].filter(Boolean).join(", ");
      }
    } catch {}
    await setDoc(doc(db, "users", uid), {
      lastLoginAt: new Date().toISOString(),
      lastLoginLocation: location,
    }, { merge: true });
  } catch (e) {
    console.warn("Failed to record login event:", e);
  }
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

// ═══════════════════════════════════════════════════════════════
//  DATA HELPERS — Replaces localStorage
// ═══════════════════════════════════════════════════════════════

// ─── Shared Logistics Data (all users read from same document) ───
export async function saveSharedData(data) {
  await setDoc(doc(db, "logisticsShared", "appData"), {
    ...data,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

// Save only specific fields to avoid overwriting concurrent changes
export async function saveSharedFields(fields) {
  await setDoc(doc(db, "logisticsShared", "appData"), {
    ...fields,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function loadSharedData() {
  const snap = await getDoc(doc(db, "logisticsShared", "appData"));
  if (snap.exists()) {
    const d = snap.data();
    delete d.updatedAt;
    return d;
  }
  return null;
}

export function onSharedDataChange(callback) {
  return onSnapshot(doc(db, "logisticsShared", "appData"), (snap) => {
    if (snap.exists()) {
      const d = snap.data();
      delete d.updatedAt;
      callback(d);
    }
  });
}

// ─── Legacy per-user data (kept for migration) ───
export async function saveAppData(uid, data) {
  await setDoc(doc(db, "logisticsData", uid), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function loadAppData(uid) {
  const snap = await getDoc(doc(db, "logisticsData", uid));
  if (snap.exists()) {
    const d = snap.data();
    delete d.updatedAt;
    return d;
  }
  return null;
}

export function onAppDataChange(uid, callback) {
  return onSnapshot(doc(db, "logisticsData", uid), (snap) => {
    if (snap.exists()) {
      const d = snap.data();
      delete d.updatedAt;
      callback(d);
    }
  });
}

// ─── Approvals (Logistics-specific) ───
export async function saveApprovalsFB(list) {
  await setDoc(doc(db, "logisticsShared", "approvals"), { items: list, updatedAt: serverTimestamp() });
}

export async function loadApprovalsFB() {
  const snap = await getDoc(doc(db, "logisticsShared", "approvals"));
  if (snap.exists()) return snap.data().items || [];
  return [];
}

// ─── Activity Log (Logistics-specific) ───
export async function saveActivityLogFB(list) {
  await setDoc(doc(db, "logisticsShared", "activityLog"), { items: list, updatedAt: serverTimestamp() });
}

export async function loadActivityLogFB() {
  const snap = await getDoc(doc(db, "logisticsShared", "activityLog"));
  if (snap.exists()) return snap.data().items || [];
  return [];
}

// ─── Users list for admin management ───
export async function saveUsersFB(users) {
  await setDoc(doc(db, "logisticsShared", "usersList"), { items: users, updatedAt: serverTimestamp() });
}

export async function loadUsersFB() {
  const snap = await getDoc(doc(db, "logisticsShared", "usersList"));
  if (snap.exists()) return snap.data().items || [];
  return [];
}

// ═══════════════════════════════════════════════════════════════
//  FILE STORAGE — Vehicle photos & title documents
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
    // Ignore if file doesn't exist
    if (e.code !== "storage/object-not-found") throw e;
  }
}

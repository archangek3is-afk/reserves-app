// Firebase configuration and initialization
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js';
import {
  initializeFirestore,
  persistentLocalCache,
  collection,
  doc,
  onSnapshot,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  Timestamp,
  enableNetwork,
  disableNetwork
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';

// ---- Firebase config (REMPLACER avec tes vraies valeurs) ----
const firebaseConfig = {
  apiKey: "AIzaSyCVlqGa9813X7rH9ZiVH16wI_QipSH5OnI",
  authDomain: "reserves-foyer.firebaseapp.com",
  projectId: "reserves-foyer",
  storageBucket: "reserves-foyer.firebasestorage.app",
  messagingSenderId: "739493123802",
  appId: "1:739493123802:web:a7bdaf8bc1f8b2e77677e3"
};

// ---- Initialize ----
const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({})
});
const auth = getAuth(app);

// ---- Sync Status Store ----
const syncListeners = new Set();
let syncState = { status: 'offline', label: 'Hors ligne' };

function setSyncStatus(status, label) {
  syncState = { status, label };
  syncListeners.forEach(fn => fn(syncState));
}

const syncStatus = {
  get() { return syncState; },
  subscribe(fn) {
    syncListeners.add(fn);
    fn(syncState);
    return () => syncListeners.delete(fn);
  }
};

// Monitor network status
window.addEventListener('online', () => {
  enableNetwork(db);
  setSyncStatus('syncing', 'Synchronisation...');
  setTimeout(() => setSyncStatus('online', 'En ligne'), 1500);
});

window.addEventListener('offline', () => {
  disableNetwork(db);
  setSyncStatus('offline', 'Hors ligne');
});

if (navigator.onLine) {
  setSyncStatus('online', 'En ligne');
} else {
  setSyncStatus('offline', 'Hors ligne');
}

// ---- Auth ----
let currentUser = null;
const authReadyPromise = new Promise((resolve) => {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      setSyncStatus(navigator.onLine ? 'online' : 'offline',
        navigator.onLine ? 'En ligne' : 'Hors ligne');
      resolve(user);
    } else {
      try {
        const result = await signInAnonymously(auth);
        currentUser = result.user;
        resolve(result.user);
      } catch (e) {
        console.error('Auth error:', e);
        setSyncStatus('offline', 'Erreur auth');
        resolve(null);
      }
    }
  });
});

function getCurrentUser() {
  return currentUser;
}

async function waitForAuth() {
  return authReadyPromise;
}

// ---- Foyer ID ----
function getFoyerId() {
  return localStorage.getItem('foyerId') || null;
}

function setFoyerId(id) {
  localStorage.setItem('foyerId', id);
}

// ---- Foyer Helpers ----
function foyerCollection(name) {
  const fid = getFoyerId();
  if (!fid) throw new Error('Aucun foyer configuré');
  return collection(db, 'foyers', fid, name);
}

function foyerDoc(path) {
  const fid = getFoyerId();
  if (!fid) throw new Error('Aucun foyer configuré');
  return doc(db, 'foyers', fid, ...path.split('/'));
}

// ---- Exports ----
export {
  db, auth, syncStatus,
  getCurrentUser, waitForAuth,
  getFoyerId, setFoyerId,
  foyerCollection, foyerDoc,
  // Re-export Firestore functions for convenience
  collection, doc, onSnapshot, getDoc, setDoc, updateDoc, deleteDoc, addDoc,
  query, where, orderBy, limit, getDocs,
  arrayUnion, arrayRemove, serverTimestamp, Timestamp,
  enableNetwork, disableNetwork
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  doc,
  getDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDlTK2CEy0CJyz7RofxuHi-H37zr-V4i0M",
  authDomain: "sales-schedule-app-621b9.firebaseapp.com",
  projectId: "sales-schedule-app-621b9",
  storageBucket: "sales-schedule-app-621b9.firebasestorage.app",
  messagingSenderId: "1022100366188",
  appId: "1:1022100366188:web:19113b8e8cd840fe65c949",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Persistent local cache: reads/writes keep working offline (e.g. visiting a
// client with no signal) and sync automatically once the connection returns.
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
});
const provider = new GoogleAuthProvider();

const btnSignIn = document.getElementById("btnSignIn");
const btnSignOut = document.getElementById("btnSignOut");
const syncStatus = document.getElementById("syncStatus");

const authGate = document.getElementById("authGate");
const authGateLoading = document.getElementById("authGateLoading");
const authGatePrompt = document.getElementById("authGatePrompt");
const authGateError = document.getElementById("authGateError");
const btnGateSignIn = document.getElementById("btnGateSignIn");
const inAppBrowserWarning = document.getElementById("inAppBrowserWarning");

let currentUser = null;
let saveTimer = null;
let applyingRemoteData = false;

// LINE, Instagram, Facebook, X/Twitter, and WeChat all embed a restricted WebView
// that Google blocks (or that lacks the storage) for OAuth sign-in.
function isInAppBrowser() {
  const ua = navigator.userAgent || "";
  return /Line\/|Instagram|FBAN|FBAV|Twitter|MicroMessenger/i.test(ua);
}

if (isInAppBrowser() && inAppBrowserWarning) {
  inAppBrowserWarning.classList.remove("hidden");
}

function updateStatus(text) {
  if (syncStatus) syncStatus.textContent = text;
}

function showGateLoggedOut() {
  authGate.classList.remove("hidden");
  authGateLoading.classList.add("hidden");
  authGatePrompt.classList.remove("hidden");
}

async function doSignIn() {
  authGateError.textContent = "";
  if (isInAppBrowser()) {
    authGateError.textContent =
      "このアプリ内ブラウザではログインできません。上の案内の通り、Safari/Chromeなど標準のブラウザで開き直してください。";
    return;
  }
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.error(e);
    authGateError.textContent = "ログインに失敗しました: " + (e.code || e.message || e);
  }
}

function userDocRef(uid) {
  return doc(db, "users", uid);
}

async function pullOrPushInitial(user) {
  const ref = userDocRef(user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    applyingRemoteData = true;
    window.ScheduleApp.setData(snap.data());
    applyingRemoteData = false;
  } else {
    await setDoc(ref, window.ScheduleApp.getData());
  }
}

function scheduleSave() {
  if (!currentUser || applyingRemoteData) return;
  clearTimeout(saveTimer);
  updateStatus(navigator.onLine ? `同期中… (${currentUser.email})` : `オフライン・復帰時に自動同期 (${currentUser.email})`);
  saveTimer = setTimeout(async () => {
    try {
      await setDoc(userDocRef(currentUser.uid), window.ScheduleApp.getData());
      updateStatus(navigator.onLine ? `同期済み (${currentUser.email})` : `オフライン・復帰時に自動同期 (${currentUser.email})`);
    } catch (e) {
      console.error(e);
      updateStatus(`同期エラー: ${e.code || e.message || e}`);
    }
  }, 800);
}

window.ScheduleApp.onChange(scheduleSave);

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    authGate.classList.add("hidden");
    btnSignIn.classList.add("hidden");
    btnSignOut.classList.remove("hidden");
    updateStatus(`読み込み中… (${user.email})`);
    try {
      await pullOrPushInitial(user);
      updateStatus(`同期済み (${user.email})`);
    } catch (e) {
      console.error(e);
      updateStatus(`読み込みエラー: ${e.code || e.message || e}`);
    }
  } else {
    showGateLoggedOut();
    btnSignIn.classList.remove("hidden");
    btnSignOut.classList.add("hidden");
    updateStatus("");
  }
});

window.addEventListener("online", () => {
  if (currentUser) updateStatus(`同期済み (${currentUser.email})`);
});
window.addEventListener("offline", () => {
  if (currentUser) updateStatus(`オフライン・復帰時に自動同期 (${currentUser.email})`);
});

btnSignIn.addEventListener("click", doSignIn);
btnGateSignIn.addEventListener("click", doSignIn);

btnSignOut.addEventListener("click", async () => {
  await signOut(auth);
});

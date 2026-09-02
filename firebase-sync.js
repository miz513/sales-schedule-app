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
  updateDoc,
  arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  getMessaging,
  isSupported as isMessagingSupported,
  getToken,
  onMessage,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";

// Generated in Firebase Console → Project settings → Cloud Messaging → Web
// configuration → "Generate key pair". Public by design (safe to ship).
const VAPID_KEY = "BMV_1kt7evb-gDJ4ywcVLefPpMCW7GotzlxC9kavp6Fs9-xgJ9EsUeCXDChsM8WzHN9y0Mif0fZTCfkTwt7P6tc";

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
const functions = getFunctions(app, "asia-northeast1");
const provider = new GoogleAuthProvider();

const btnSignIn = document.getElementById("btnSignIn");
const btnSignOut = document.getElementById("btnSignOut");
const syncStatus = document.getElementById("syncStatus");
const btnEnableNotify = document.getElementById("btnEnableNotify");
const notifyStatus = document.getElementById("notifyStatus");

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

// ---------- Event reminder push notifications ----------
// A scheduled Cloud Function checks everyone's events every few minutes and
// sends a push 30 minutes before each one starts, to whichever tokens are
// registered here. Foreground messages don't produce a system notification
// automatically, so onMessage below shows one manually in that case.

function updateNotifyStatus(text) {
  if (notifyStatus) notifyStatus.textContent = text;
}

let foregroundHandlerRegistered = false;

// Chrome on Android throws if a page script calls `new Notification()`
// directly while a service worker controls the page — it must go through
// the worker's own showNotification instead, same as the background handler
// in sw.js. Registered once (not per registerNotificationToken call) so a
// user re-enabling notifications never ends up with duplicate popups.
function ensureForegroundHandler(messaging, registration) {
  if (foregroundHandlerRegistered) return;
  foregroundHandlerRegistered = true;
  onMessage(messaging, (payload) => {
    const title = (payload.notification && payload.notification.title) || "予定";
    const body = (payload.notification && payload.notification.body) || "";
    const link = (payload.fcmOptions && payload.fcmOptions.link) || (payload.data && payload.data.link) || registration.scope;
    registration.showNotification(title, { body, data: { url: link } });
  });
}

async function registerNotificationToken() {
  if (!currentUser) return;
  if (!(await isMessagingSupported())) {
    updateNotifyStatus("この端末・ブラウザは通知に対応していません");
    return;
  }
  if (Notification.permission !== "granted") return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
    if (token) {
      await updateDoc(userDocRef(currentUser.uid), { fcmTokens: arrayUnion(token) });
      updateNotifyStatus("通知: 有効");
      ensureForegroundHandler(messaging, registration);
    }
  } catch (e) {
    console.error(e);
    updateNotifyStatus(`通知の設定に失敗しました: ${e.code || e.message || e}`);
  }
}

btnEnableNotify.addEventListener("click", async () => {
  if (!currentUser) {
    updateNotifyStatus("先にログインしてください");
    return;
  }
  if (!("Notification" in window)) {
    updateNotifyStatus("この端末・ブラウザは通知に対応していません");
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    updateNotifyStatus("通知が許可されませんでした");
    return;
  }
  await registerNotificationToken();
});

onAuthStateChanged(auth, (user) => {
  if (user && "Notification" in window && Notification.permission === "granted") {
    registerNotificationToken();
  } else if (user) {
    updateNotifyStatus("通知: 無効（メニューから有効にできます）");
  }
});

// Lets a memo be pushed to the notification shade on demand ("今すぐ通知に出
// す"), as a stand-in for a home-screen widget — a plain web app can't create
// one of those, but a notification the user leaves undismissed behaves a lot
// like one in the meantime.
window.ScheduleApp.notifyMemo = async (title, body) => {
  if (!currentUser) throw new Error("先にログインしてください");
  const sendMemoNotification = httpsCallable(functions, "sendMemoNotification");
  await sendMemoNotification({ title, body });
};

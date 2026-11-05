import { api } from "./api";

/**
 * Google sign-in through Firebase Authentication.
 * Firebase only proves which Google account the person owns; the portal then issues its own
 * session cookie. The Firebase SDK is loaded on demand so it adds nothing to normal page loads.
 */
interface FirebaseWebConfig { apiKey: string; authDomain: string; projectId: string; appId?: string }

let providers: Promise<{ google: FirebaseWebConfig | null }> | null = null;
export function getProviders() {
  providers ??= api<{ google: FirebaseWebConfig | null }>("/auth/providers").catch(() => ({ google: null }));
  return providers;
}

type FirebaseAuth = import("firebase/auth").Auth;
let authPromise: Promise<FirebaseAuth> | null = null;

async function getFirebaseAuth(): Promise<FirebaseAuth> {
  authPromise ??= (async () => {
    const { google } = await getProviders();
    if (!google) throw new Error("Google sign-in is not configured.");
    const [{ initializeApp, getApps }, fa] = await Promise.all([import("firebase/app"), import("firebase/auth")]);
    const app = getApps().find((a) => a.name === "zanvar") ?? initializeApp(google, "zanvar");
    // Nothing is stored in the browser: the Google session only lives until the portal has signed the person in.
    try {
      return fa.initializeAuth(app, { persistence: fa.inMemoryPersistence, popupRedirectResolver: fa.browserPopupRedirectResolver });
    } catch {
      return fa.getAuth(app);
    }
  })();
  authPromise.catch(() => (authPromise = null));
  return authPromise;
}

/** Load Firebase ahead of the click, so the Google window opens immediately (popup blockers allow it). */
export function warmGoogle() {
  void getFirebaseAuth().catch(() => undefined);
}

const FRIENDLY: Record<string, string> = {
  "auth/popup-blocked": "Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.",
  "auth/unauthorized-domain": "This web address is not allowed for Google sign-in. An administrator must add it under Firebase → Authentication → Settings → Authorized domains.",
  "auth/operation-not-allowed": "Google sign-in is not enabled in Firebase. An administrator must enable the Google provider under Firebase → Authentication → Sign-in method.",
  "auth/network-request-failed": "Could not reach Google. Check your internet connection and try again.",
  "auth/invalid-api-key": "Google sign-in is misconfigured (invalid Firebase API key). Contact the administrator.",
};

/** Opens the Google account chooser. Returns null if the person closed the window. */
export async function googleSignIn(): Promise<{ idToken: string; email: string; name: string } | null> {
  const auth = await getFirebaseAuth();
  const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const cred = await signInWithPopup(auth, provider);
    return { idToken: await cred.user.getIdToken(), email: cred.user.email ?? "", name: cred.user.displayName ?? "" };
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return null;
    throw new Error(FRIENDLY[code] ?? `Google sign-in failed${code ? ` (${code})` : ""}. Please try again.`);
  }
}

/** A fresh ID token for the Google account chosen earlier on this page (tokens last one hour). */
export async function currentGoogleIdToken(): Promise<string | null> {
  const auth = await getFirebaseAuth().catch(() => null);
  return (await auth?.currentUser?.getIdToken(true)) ?? null;
}

export async function googleSignOut() {
  const auth = await authPromise?.catch(() => null);
  if (auth?.currentUser) {
    const { signOut } = await import("firebase/auth");
    await signOut(auth).catch(() => undefined);
  }
}

export type GoogleLoginResult = { user: { role: string } } | { needsRegistration: true; email: string; name: string };

/** Google account → portal session. New people get `needsRegistration` and go to the registration form. */
export async function loginWithGoogle(idToken: string) {
  const r = await api<GoogleLoginResult>("/auth/google", { body: { idToken } });
  if ("user" in r) await googleSignOut();
  return r;
}

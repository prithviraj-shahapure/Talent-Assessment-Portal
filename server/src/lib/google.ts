import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from "jose";
import { env } from "../config/env";
import { badRequest, unauthorized } from "./http";

/**
 * Google sign-in through Firebase Authentication.
 * The browser signs in with Google via the Firebase SDK and sends us the Firebase ID token.
 * We verify that token ourselves against Google's published keys — no service account needed.
 */
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"), {
  cooldownDuration: 30_000,
  cacheMaxAge: 6 * 3600 * 1000,
});

export interface GoogleIdentity {
  uid: string;
  email: string;
  name: string;
}

export function googleEnabled() {
  return !!(env.firebase.apiKey && env.firebase.authDomain && env.firebase.projectId);
}

/** Public web configuration (these values are not secret — they identify the Firebase project). */
export function firebaseWebConfig() {
  if (!googleEnabled()) return null;
  return { apiKey: env.firebase.apiKey, authDomain: env.firebase.authDomain, projectId: env.firebase.projectId, appId: env.firebase.appId || undefined };
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  if (!googleEnabled()) throw badRequest("Google sign-in is not configured on this server");
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, JWKS, {
      issuer: `https://securetoken.google.com/${env.firebase.projectId}`,
      audience: env.firebase.projectId,
      algorithms: ["RS256"],
      clockTolerance: 60,
    }));
  } catch (e) {
    if (e instanceof joseErrors.JWTExpired) throw unauthorized("Your Google sign-in has expired. Please sign in with Google again.");
    if (e instanceof joseErrors.JOSEError) throw unauthorized("Google sign-in could not be verified. Please try again.");
    throw new Error(`Could not reach Google to verify the sign-in: ${(e as Error).message}`);
  }
  const fb = payload.firebase as { sign_in_provider?: string } | undefined;
  const authTime = Number(payload.auth_time ?? 0);
  if (!payload.sub || typeof payload.sub !== "string" || payload.sub.length > 128) throw unauthorized("Invalid Google sign-in");
  if (!authTime || authTime > Date.now() / 1000 + 60) throw unauthorized("Invalid Google sign-in");
  if (fb?.sign_in_provider !== "google.com") throw unauthorized("Only Google accounts can be used here");
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (!email || payload.email_verified !== true) throw unauthorized("Your Google account does not have a verified email address");
  const name = (typeof payload.name === "string" && payload.name.trim()) || email.split("@")[0];
  return { uid: payload.sub, email, name: name.slice(0, 120) };
}

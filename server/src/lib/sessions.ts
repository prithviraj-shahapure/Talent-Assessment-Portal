import crypto from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

export const SESSION_ACCESS_COOKIE = "zv_session_access";

export interface SessionAccessTokenPayload {
  candidateId: string;
  sessionId: string;
  examId: string;
  sub: string;
}

/**
 * Normalizes session code for consistent matching: uppercase, removes whitespace and dashes.
 * Also generates the secure SHA-256 hash using the server JWT secret as HMAC salt.
 */
export function normalizeSessionCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export function hashSessionCode(normalizedCode: string): string {
  return crypto.createHmac("sha256", env.jwtSecret).update(normalizedCode).digest("hex");
}

/**
 * Generates an unpredictable, secure session code.
 * Example formats: ZG-TECH-8472, ZG-INT-2026-001, or ZANVAR-XXXX-XXXX
 */
export function generateRandomSessionCode(prefix = "ZG"): string {
  const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let randomPart = "";
  const randomBytes = crypto.randomBytes(6);
  for (let i = 0; i < randomBytes.length; i++) {
    randomPart += characters[randomBytes[i] % characters.length];
  }
  return `${prefix}-${randomPart.slice(0, 3)}-${randomPart.slice(3)}`;
}

/**
 * Signs a short-lived session access token (e.g. valid for exam duration + 2 hours).
 */
export function signSessionAccessToken(candidateId: string, sessionId: string, examId: string): string {
  const payload: SessionAccessTokenPayload = {
    candidateId,
    sessionId,
    examId,
    sub: candidateId,
  };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: "8h", issuer: "zanvar-tap-session" });
}

export function verifySessionAccessToken(token: string): SessionAccessTokenPayload | null {
  try {
    return jwt.verify(token, env.jwtSecret, { issuer: "zanvar-tap-session" }) as SessionAccessTokenPayload;
  } catch {
    return null;
  }
}


import crypto from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import type { Role } from "./prisma";

export interface JwtPayload {
  sub: string;
  role: Role;
  sid: string;
}

export const AUTH_COOKIE = "zv_session";
export const CSRF_COOKIE = "zv_csrf";

export function signSession(userId: string, role: Role) {
  const payload: JwtPayload = { sub: userId, role, sid: crypto.randomUUID() };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: `${env.jwtExpiresHours}h`, issuer: "zanvar-tap" });
}

export function verifySession(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, env.jwtSecret, { issuer: "zanvar-tap" }) as JwtPayload;
  } catch {
    return null;
  }
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function inviteCode(prefix = "ZV") {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  const bytes = crypto.randomBytes(8);
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `${prefix}-${s.slice(0, 4)}-${s.slice(4)}`;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

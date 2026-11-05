import type { CookieOptions } from "express";
import { env } from "../config/env";

export const sessionCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: env.cookieSecure,
  sameSite: "lax",
  path: "/",
  maxAge: env.jwtExpiresHours * 3600 * 1000,
});

export const csrfCookieOptions = (): CookieOptions => ({
  httpOnly: false,
  secure: env.cookieSecure,
  sameSite: "lax",
  path: "/",
});

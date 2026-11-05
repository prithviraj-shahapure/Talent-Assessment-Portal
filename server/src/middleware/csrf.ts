import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { CSRF_COOKIE } from "../lib/tokens";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/** Double-submit cookie CSRF protection for all state-changing API requests. */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (SAFE.has(req.method)) return next();
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get("x-csrf-token");
  if (!cookie || !header || cookie.length !== header.length || !crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(header))) {
    return res.status(403).json({ error: "Invalid or missing CSRF token. Refresh the page and try again.", code: "CSRF" });
  }
  next();
}

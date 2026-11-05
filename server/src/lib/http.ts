import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError, type ZodTypeAny, type z } from "zod";

export class AppError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) {
    super(message);
  }
}
export const badRequest = (msg: string, details?: unknown) => new AppError(400, msg, "BAD_REQUEST", details);
export const unauthorized = (msg = "Authentication required") => new AppError(401, msg, "UNAUTHORIZED");
export const forbidden = (msg = "You do not have permission to do this") => new AppError(403, msg, "FORBIDDEN");
export const notFound = (what = "Resource") => new AppError(404, `${what} not found`, "NOT_FOUND");
export const conflict = (msg: string) => new AppError(409, msg, "CONFLICT");

export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const f = r.error.flatten();
    const first = Object.entries(f.fieldErrors)[0] as [string, string[]] | undefined;
    throw badRequest(first ? `${first[0]}: ${first[1][0]}` : f.formErrors[0] ?? "Validation failed", f);
  }
  return r.data;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Validation failed", details: err.flatten() });
  }
  const anyErr = err as { code?: string; message?: string; type?: string };
  if (anyErr?.type === "entity.too.large") return res.status(413).json({ error: "Payload too large" });
  if (anyErr?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File too large" });
  if (anyErr?.code === "P2002") return res.status(409).json({ error: "A record with these details already exists" });
  if (anyErr?.code === "P2025") return res.status(404).json({ error: "Record not found" });
  if (anyErr?.code === "P2003") return res.status(409).json({ error: "This record is in use and cannot be removed" });
  console.error("[error]", req.method, req.originalUrl, err);
  return res.status(500).json({ error: "Internal server error" });
}

export function pageParams(q: Record<string, unknown>) {
  const page = Math.max(1, Number(q.page ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? 25) || 25));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function clientIp(req: Request) {
  const ip = (req.ip || req.socket.remoteAddress || "").replace("::ffff:", "");
  return ip === "::1" ? "127.0.0.1" : ip;
}

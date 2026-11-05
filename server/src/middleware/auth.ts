import type { NextFunction, Request, Response } from "express";
import { prisma, type Role } from "../lib/prisma";
import { AUTH_COOKIE, verifySession } from "../lib/tokens";
import { forbidden, unauthorized } from "../lib/http";

export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[AUTH_COOKIE];
    if (token) {
      const payload = verifySession(token);
      if (payload) {
        const user = await prisma.user.findUnique({
          where: { id: payload.sub },
          select: { id: true, role: true, email: true, name: true, isActive: true, emailVerified: true, candidate: { select: { id: true } } },
        });
        if (user && user.isActive) {
          req.user = { id: user.id, role: user.role, email: user.email, name: user.name, candidateId: user.candidate?.id ?? null, emailVerified: user.emailVerified };
        }
      }
    }
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };

export const requireStaff = requireRole("SUPER_ADMIN", "HR_ADMIN");
export const requireSuperAdmin = requireRole("SUPER_ADMIN");
export const requireCandidate = requireRole("CANDIDATE");

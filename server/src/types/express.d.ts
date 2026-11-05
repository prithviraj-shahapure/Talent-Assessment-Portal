import type { Role } from "../generated/prisma/client";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: Role; email: string; name: string; candidateId?: string | null; emailVerified: boolean };
    }
  }
}
export {};

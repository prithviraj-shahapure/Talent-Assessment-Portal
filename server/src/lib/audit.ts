import type { Request } from "express";
import { prisma } from "./prisma";
import { clientIp } from "./http";

export async function audit(
  req: Request | null,
  action: string,
  entity?: string,
  entityId?: string,
  details?: Record<string, unknown>,
  userId?: string | null,
) {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        entity,
        entityId,
        details: (details ?? undefined) as object | undefined,
        userId: userId ?? req?.user?.id ?? null,
        ipAddress: req ? clientIp(req) : null,
      },
    });
  } catch (e) {
    console.error("[audit] failed", e);
  }
}

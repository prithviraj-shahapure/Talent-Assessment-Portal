import { Router } from "express";
import { ah, pageParams } from "../../lib/http";
import { prisma, type Prisma } from "../../lib/prisma";
import { requireSuperAdmin } from "../../middleware/auth";

export const auditRouter = Router();
auditRouter.use(requireSuperAdmin);

auditRouter.get(
  "/",
  ah(async (req, res) => {
    const { skip, take, page, pageSize } = pageParams(req.query);
    const where: Prisma.AuditLogWhereInput = {};
    if (req.query.action) where.action = { contains: String(req.query.action), mode: "insensitive" };
    if (req.query.entity) where.entity = String(req.query.entity);
    if (req.query.userId) where.userId = String(req.query.userId);
    if (req.query.from || req.query.to) {
      where.createdAt = {
        ...(req.query.from ? { gte: new Date(String(req.query.from)) } : {}),
        ...(req.query.to ? { lte: new Date(String(req.query.to) + "T23:59:59") } : {}),
      };
    }
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip, take, include: { user: { select: { name: true, email: true, role: true } } } }),
      prisma.auditLog.count({ where }),
    ]);
    res.json({ items, total, page, pageSize });
  }),
);

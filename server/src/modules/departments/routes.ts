import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { ah, parse } from "../../lib/http";
import { requireStaff, requireSuperAdmin } from "../../middleware/auth";
import { audit } from "../../lib/audit";

export const departmentsRouter = Router();

// Public list (registration form + filters)
departmentsRouter.get(
  "/",
  ah(async (_req, res) => {
    res.json(await prisma.department.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { exams: true, candidates: true } } } }));
  }),
);

const schema = z.object({ name: z.string().trim().min(2).max(100), code: z.string().trim().min(2).max(12).toUpperCase() });

departmentsRouter.post(
  "/",
  requireStaff,
  ah(async (req, res) => {
    const d = await prisma.department.create({ data: parse(schema, req.body) });
    await audit(req, "department.create", "Department", d.id, { name: d.name });
    res.status(201).json(d);
  }),
);

departmentsRouter.patch(
  "/:id",
  requireStaff,
  ah(async (req, res) => {
    const d = await prisma.department.update({ where: { id: req.params.id }, data: parse(schema.partial(), req.body) });
    await audit(req, "department.update", "Department", d.id);
    res.json(d);
  }),
);

departmentsRouter.delete(
  "/:id",
  requireSuperAdmin,
  ah(async (req, res) => {
    await prisma.department.delete({ where: { id: req.params.id } });
    await audit(req, "department.delete", "Department", req.params.id);
    res.json({ ok: true });
  }),
);

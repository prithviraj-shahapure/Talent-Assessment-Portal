import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { ah, badRequest, conflict, notFound, pageParams, parse } from "../../lib/http";
import { requireSuperAdmin } from "../../middleware/auth";
import { audit } from "../../lib/audit";
import { passwordSchema } from "../auth/routes";

export const usersRouter = Router();
usersRouter.use(requireSuperAdmin);

const staffSelect = { id: true, name: true, email: true, role: true, isActive: true, lastLoginAt: true, createdAt: true } as const;

usersRouter.get(
  "/",
  ah(async (req, res) => {
    const { skip, take, page, pageSize } = pageParams(req.query);
    const q = String(req.query.q ?? "").trim();
    const where = {
      role: { in: ["SUPER_ADMIN", "HR_ADMIN"] as ("SUPER_ADMIN" | "HR_ADMIN")[] },
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { email: { contains: q, mode: "insensitive" as const } }] } : {}),
    };
    const [items, total] = await Promise.all([prisma.user.findMany({ where, select: staffSelect, orderBy: { createdAt: "asc" }, skip, take }), prisma.user.count({ where })]);
    res.json({ items, total, page, pageSize });
  }),
);

usersRouter.post(
  "/",
  ah(async (req, res) => {
    const body = parse(
      z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email(), role: z.enum(["SUPER_ADMIN", "HR_ADMIN"]), password: passwordSchema }),
      req.body,
    );
    const email = body.email.toLowerCase();
    if (await prisma.user.findUnique({ where: { email } })) throw conflict("A user with this email already exists");
    const user = await prisma.user.create({
      data: { name: body.name, email, role: body.role, passwordHash: await bcrypt.hash(body.password, 12), emailVerified: true },
      select: staffSelect,
    });
    await audit(req, "user.create", "User", user.id, { email, role: body.role });
    res.status(201).json(user);
  }),
);

usersRouter.patch(
  "/:id",
  ah(async (req, res) => {
    const body = parse(
      z.object({ name: z.string().trim().min(2).max(120).optional(), role: z.enum(["SUPER_ADMIN", "HR_ADMIN"]).optional(), isActive: z.boolean().optional(), password: passwordSchema.optional() }),
      req.body,
    );
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target || target.role === "CANDIDATE") throw notFound("User");
    if (target.id === req.user!.id && (body.isActive === false || (body.role && body.role !== "SUPER_ADMIN"))) {
      throw badRequest("You cannot deactivate or demote your own account");
    }
    if ((body.isActive === false || body.role === "HR_ADMIN") && target.role === "SUPER_ADMIN") {
      const supers = await prisma.user.count({ where: { role: "SUPER_ADMIN", isActive: true } });
      if (supers <= 1) throw badRequest("At least one active Super Admin is required");
    }
    const user = await prisma.user.update({
      where: { id: target.id },
      data: { name: body.name, role: body.role, isActive: body.isActive, ...(body.password ? { passwordHash: await bcrypt.hash(body.password, 12) } : {}) },
      select: staffSelect,
    });
    await audit(req, "user.update", "User", user.id, { ...body, password: body.password ? "[changed]" : undefined });
    res.json(user);
  }),
);

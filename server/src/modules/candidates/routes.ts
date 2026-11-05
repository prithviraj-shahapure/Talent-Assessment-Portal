import { Router } from "express";
import { z } from "zod";
import ExcelJS from "exceljs";
import { prisma, type Prisma, type PipelineStage } from "../../lib/prisma";
import { ah, badRequest, notFound, pageParams, parse } from "../../lib/http";
import { requireStaff, requireSuperAdmin } from "../../middleware/auth";
import { storage } from "../../lib/storage";
import { audit } from "../../lib/audit";

export const candidatesRouter = Router();
candidatesRouter.use(requireStaff);

export const STAGES: PipelineStage[] = ["REGISTERED", "ELIGIBLE", "EXAM_SCHEDULED", "EXAM_COMPLETED", "EVALUATION", "SHORTLISTED", "INTERVIEW", "SELECTED", "REJECTED"];

function buildWhere(q: Record<string, unknown>): Prisma.CandidateProfileWhereInput {
  const where: Prisma.CandidateProfileWhereInput = {};
  const and: Prisma.CandidateProfileWhereInput[] = [];
  if (q.q) {
    const s = String(q.q);
    and.push({ OR: [{ user: { name: { contains: s, mode: "insensitive" } } }, { user: { email: { contains: s, mode: "insensitive" } } }, { mobile: { contains: s } }, { college: { contains: s, mode: "insensitive" } }] });
  }
  if (q.stage) where.stage = String(q.stage) as PipelineStage;
  if (q.degree) where.degree = { equals: String(q.degree), mode: "insensitive" };
  if (q.branch) where.branch = { contains: String(q.branch), mode: "insensitive" };
  if (q.college) where.college = { contains: String(q.college), mode: "insensitive" };
  if (q.graduationYear) where.graduationYear = Number(q.graduationYear);
  if (q.departmentId) where.departmentId = String(q.departmentId);
  if (q.examId) and.push({ assignments: { some: { examId: String(q.examId) } } });
  if (q.riskLevel) and.push({ attempts: { some: { riskLevel: String(q.riskLevel) } } });
  if (and.length) where.AND = and;
  return where;
}

candidatesRouter.get(
  "/",
  ah(async (req, res) => {
    const { skip, take, page, pageSize } = pageParams(req.query);
    const where = buildWhere(req.query);
    const sort = String(req.query.sort ?? "newest");
    const orderBy: Prisma.CandidateProfileOrderByWithRelationInput = sort === "name" ? { user: { name: "asc" } } : { createdAt: "desc" };
    const [items, total] = await Promise.all([
      prisma.candidateProfile.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          user: { select: { name: true, email: true, emailVerified: true, isActive: true } },
          department: { select: { name: true } },
          attempts: { where: { status: { not: "IN_PROGRESS" } }, select: { percentage: true, riskLevel: true, examId: true }, orderBy: { percentage: "desc" } },
          _count: { select: { assignments: true } },
        },
      }),
      prisma.candidateProfile.count({ where }),
    ]);
    res.json({
      items: items.map(({ attempts, resumeKey, ...c }) => ({
        ...c,
        hasResume: !!resumeKey,
        bestPercentage: attempts[0]?.percentage ?? null,
        attemptsCount: attempts.length,
        highestRisk: attempts.reduce<string | null>((acc, a) => (rank(a.riskLevel) > rank(acc) ? a.riskLevel : acc), null),
      })),
      total,
      page,
      pageSize,
    });
  }),
);
const rank = (r: string | null) => ({ NORMAL: 0, LOW: 1, MEDIUM: 2, HIGH: 3 })[r ?? ""] ?? -1;

candidatesRouter.get(
  "/facets",
  ah(async (_req, res) => {
    const [degrees, years, colleges] = await Promise.all([
      prisma.candidateProfile.groupBy({ by: ["degree"], _count: true, orderBy: { degree: "asc" } }),
      prisma.candidateProfile.groupBy({ by: ["graduationYear"], _count: true, orderBy: { graduationYear: "desc" } }),
      prisma.candidateProfile.groupBy({ by: ["college"], _count: true, orderBy: { _count: { college: "desc" } }, take: 50 }),
    ]);
    res.json({ degrees: degrees.map((d) => d.degree), graduationYears: years.map((y) => y.graduationYear), colleges: colleges.map((c) => c.college) });
  }),
);

candidatesRouter.get(
  "/export",
  ah(async (req, res) => {
    const format = req.query.format === "csv" ? "csv" : "xlsx";
    const rows = await prisma.candidateProfile.findMany({
      where: buildWhere(req.query),
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true, email: true, emailVerified: true } }, department: true, attempts: { where: { status: { not: "IN_PROGRESS" } }, include: { exam: { select: { title: true } } } } },
    });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Candidates");
    ws.columns = [
      { header: "Name", key: "name", width: 26 },
      { header: "Email", key: "email", width: 30 },
      { header: "Mobile", key: "mobile", width: 15 },
      { header: "College", key: "college", width: 34 },
      { header: "Degree", key: "degree", width: 10 },
      { header: "Branch", key: "branch", width: 22 },
      { header: "Current Year", key: "currentYear", width: 12 },
      { header: "Graduation Year", key: "graduationYear", width: 14 },
      { header: "Stage", key: "stage", width: 16 },
      { header: "Email Verified", key: "verified", width: 13 },
      { header: "Examinations Taken", key: "exams", width: 40 },
      { header: "Best %", key: "best", width: 9 },
      { header: "Registered On", key: "createdAt", width: 18 },
    ];
    for (const c of rows) {
      ws.addRow({
        name: c.user.name,
        email: c.user.email,
        mobile: c.mobile,
        college: c.college,
        degree: c.degree,
        branch: c.branch,
        currentYear: c.currentYear,
        graduationYear: c.graduationYear,
        stage: c.stage,
        verified: c.user.emailVerified ? "Yes" : "No",
        exams: c.attempts.map((a) => `${a.exam.title} (${a.percentage ?? "-"}%)`).join("; "),
        best: c.attempts.reduce((m, a) => Math.max(m, a.percentage ?? 0), 0) || null,
        createdAt: c.createdAt.toISOString().slice(0, 16).replace("T", " "),
      });
    }
    ws.getRow(1).font = { bold: true };
    await audit(req, "candidate.export", "CandidateProfile", undefined, { count: rows.length, format });
    res.setHeader("Content-Disposition", `attachment; filename="candidates.${format}"`);
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv");
      await wb.csv.write(res);
    } else {
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      await wb.xlsx.write(res);
    }
    res.end();
  }),
);

candidatesRouter.get(
  "/:id",
  ah(async (req, res) => {
    const c = await prisma.candidateProfile.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, name: true, email: true, emailVerified: true, isActive: true, lastLoginAt: true, createdAt: true } },
        department: true,
        assignments: { include: { exam: { select: { id: true, title: true, startAt: true, endAt: true, status: true } } } },
        attempts: {
          orderBy: { startedAt: "desc" },
          include: { exam: { select: { id: true, title: true, passingMarks: true } }, _count: { select: { events: true } } },
        },
        pipeline: { orderBy: { createdAt: "desc" }, include: { changedBy: { select: { name: true } } } },
        consents: { orderBy: { acceptedAt: "desc" }, take: 10 },
        accommodations: { include: { exam: { select: { title: true } } }, orderBy: { createdAt: "desc" } },
      },
    });
    if (!c) throw notFound("Candidate");
    const { resumeKey, ...rest } = c;
    res.json({ ...rest, hasResume: !!resumeKey });
  }),
);

candidatesRouter.get(
  "/:id/resume",
  ah(async (req, res) => {
    const c = await prisma.candidateProfile.findUnique({ where: { id: req.params.id } });
    if (!c?.resumeKey || !(await storage.exists(c.resumeKey))) throw notFound("Resume");
    await audit(req, "candidate.resume_view", "CandidateProfile", c.id);
    const ext = c.resumeKey.split(".").pop();
    res.setHeader("Content-Type", ext === "pdf" ? "application/pdf" : "application/octet-stream");
    res.setHeader("Content-Disposition", `${req.query.download ? "attachment" : "inline"}; filename="${(c.resumeName ?? `resume.${ext}`).replace(/[^\w.\- ]/g, "_")}"`);
    res.setHeader("Cache-Control", "private, no-store");
    storage.stream(c.resumeKey).pipe(res);
  }),
);

candidatesRouter.patch(
  "/:id",
  ah(async (req, res) => {
    const body = parse(z.object({ hrNotes: z.string().max(5000).nullable().optional(), departmentId: z.string().nullable().optional(), isActive: z.boolean().optional() }), req.body);
    const c = await prisma.candidateProfile.findUnique({ where: { id: req.params.id } });
    if (!c) throw notFound("Candidate");
    const { isActive, ...data } = body;
    await prisma.candidateProfile.update({ where: { id: c.id }, data });
    if (isActive !== undefined) await prisma.user.update({ where: { id: c.userId }, data: { isActive } });
    await audit(req, "candidate.update", "CandidateProfile", c.id, { fields: Object.keys(body) });
    res.json({ ok: true });
  }),
);

// DPDP: erasure of a candidate's personal data (Super Admin only)
candidatesRouter.delete(
  "/:id",
  requireSuperAdmin,
  ah(async (req, res) => {
    const c = await prisma.candidateProfile.findUnique({ where: { id: req.params.id }, include: { attempts: { include: { evidence: true } } } });
    if (!c) throw notFound("Candidate");
    const keys = [c.resumeKey, ...c.attempts.flatMap((a) => a.evidence.map((e) => e.storageKey))].filter(Boolean) as string[];
    await prisma.user.delete({ where: { id: c.userId } });
    for (const k of keys) await storage.remove(k);
    await audit(req, "candidate.erase", "CandidateProfile", c.id, { files: keys.length });
    res.json({ ok: true });
  }),
);

// ───────────── Accommodation requests ─────────────
candidatesRouter.get(
  "/accommodations/all",
  ah(async (req, res) => {
    const status = req.query.status ? (String(req.query.status) as "PENDING" | "APPROVED" | "DECLINED") : undefined;
    res.json(
      await prisma.accommodationRequest.findMany({
        where: { status },
        orderBy: { createdAt: "desc" },
        include: { exam: { select: { id: true, title: true } }, candidate: { include: { user: { select: { name: true, email: true } } } } },
      }),
    );
  }),
);

candidatesRouter.patch(
  "/accommodations/:aid",
  ah(async (req, res) => {
    const body = parse(
      z.object({
        status: z.enum(["APPROVED", "DECLINED"]),
        response: z.string().max(2000).optional().nullable(),
        extraMinutes: z.number().int().min(0).max(240).default(0),
        waiveWebcam: z.boolean().default(false),
        waiveMicrophone: z.boolean().default(false),
      }),
      req.body,
    );
    const a = await prisma.accommodationRequest.findUnique({ where: { id: req.params.aid } });
    if (!a) throw notFound("Request");
    if (body.status === "DECLINED" && (body.extraMinutes || body.waiveWebcam || body.waiveMicrophone)) throw badRequest("Declined requests cannot grant adjustments");
    const updated = await prisma.accommodationRequest.update({ where: { id: a.id }, data: body });
    if (body.status === "APPROVED" && body.extraMinutes) {
      await prisma.examAssignment.updateMany({ where: { examId: a.examId, candidateId: a.candidateId }, data: { extraMinutes: body.extraMinutes } });
    }
    await audit(req, "accommodation.respond", "AccommodationRequest", a.id, body);
    res.json(updated);
  }),
);

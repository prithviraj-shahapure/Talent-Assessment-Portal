import { Router } from "express";
import { z } from "zod";
import { prisma, type Prisma } from "../../lib/prisma";
import { ah, badRequest, forbidden, notFound, parse } from "../../lib/http";
import { requireStaff } from "../../middleware/auth";
import { audit } from "../../lib/audit";
import { inviteCode } from "../../lib/tokens";
import { emailLayout, sendMail } from "../../lib/mailer";
import { env } from "../../config/env";
import { advanceStage, checkEligibility, type Eligibility } from "../../lib/invites";
import { normalizeSessionCode, hashSessionCode } from "../../lib/sessions";

export const examsRouter = Router();
examsRouter.use(requireStaff);

const eligibilitySchema = z
  .object({
    degrees: z.array(z.string().trim().min(1)).optional(),
    branches: z.array(z.string().trim().min(1)).optional(),
    graduationYears: z.array(z.number().int()).optional(),
    colleges: z.array(z.string().trim().min(1)).optional(),
  })
  .nullable()
  .optional();

const examSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(5000).optional().nullable(),
  departmentId: z.string().optional().nullable(),
  position: z.string().trim().max(150).optional().nullable(),
  category: z.string().trim().max(80).optional().nullable(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  durationMinutes: z.number().int().min(1).max(600),
  passingMarks: z.number().min(0).default(0),
  negativeMarking: z.boolean().default(false),
  maxAttempts: z.number().int().min(1).max(10).default(1),
  randomizeQuestions: z.boolean().default(true),
  randomizeOptions: z.boolean().default(true),
  sectionTimeLimits: z.boolean().default(false),
  instructions: z.string().max(20000).optional().nullable(),
  eligibility: eligibilitySchema,
  resultPublication: z.enum(["MANUAL", "IMMEDIATE", "AFTER_EXAM_END"]).default("MANUAL"),
  proctoringEnabled: z.boolean().default(true),
  requireWebcam: z.boolean().default(true),
  requireMicrophone: z.boolean().default(true),
  requireFullscreen: z.boolean().default(true),
  evidenceCapture: z.boolean().default(false),
  livePreview: z.boolean().default(true),
});

async function recomputeTotal(examId: string) {
  const sections = await prisma.examSection.findMany({ where: { examId }, include: { questions: { include: { question: { select: { marks: true } } } }, randomRules: true } });
  const total = sections.reduce(
    (sum, s) => sum + s.questions.reduce((a, q) => a + (q.marks ?? q.question.marks), 0) + s.randomRules.reduce((a, r) => a + r.count * (r.marksEach ?? 1), 0),
    0,
  );
  await prisma.exam.update({ where: { id: examId }, data: { totalMarks: total } });
  return total;
}

async function assertEditableStructure(examId: string) {
  const attempts = await prisma.attempt.count({ where: { examId } });
  if (attempts > 0) throw badRequest("Candidates have already attempted this examination, so its questions cannot be changed. Duplicate the examination instead.");
}

async function sectionExam(sectionId: string) {
  const s = await prisma.examSection.findUnique({ where: { id: sectionId } });
  if (!s) throw notFound("Section");
  return s;
}

examsRouter.get(
  "/",
  ah(async (req, res) => {
    const where: Prisma.ExamWhereInput = {};
    if (req.query.status) where.status = String(req.query.status) as Prisma.ExamWhereInput["status"] as never;
    if (req.query.departmentId) where.departmentId = String(req.query.departmentId);
    if (req.query.q) where.title = { contains: String(req.query.q), mode: "insensitive" };
    const now = new Date();
    if (req.query.phase === "live") Object.assign(where, { status: "PUBLISHED", startAt: { lte: now }, endAt: { gte: now } });
    if (req.query.phase === "upcoming") Object.assign(where, { status: "PUBLISHED", startAt: { gt: now } });
    if (req.query.phase === "completed") Object.assign(where, { endAt: { lt: now } });
    const exams = await prisma.exam.findMany({
      where,
      orderBy: { startAt: "desc" },
      include: {
        department: { select: { id: true, name: true } },
        _count: { select: { assignments: true, attempts: true, sections: true, invitations: true } },
      },
    });
    const submitted = await prisma.attempt.groupBy({ by: ["examId"], where: { status: { not: "IN_PROGRESS" } }, _count: true, _avg: { percentage: true } });
    const sMap = new Map(submitted.map((s) => [s.examId, s]));
    res.json(exams.map((e) => ({ ...e, submittedCount: sMap.get(e.id)?._count ?? 0, avgPercentage: sMap.get(e.id)?._avg.percentage ?? null })));
  }),
);

examsRouter.get(
  "/:id",
  ah(async (req, res) => {
    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id },
      include: {
        department: true,
        createdBy: { select: { name: true } },
        sections: {
          orderBy: { order: "asc" },
          include: {
            questions: {
              orderBy: { order: "asc" },
              include: { question: { select: { id: true, text: true, type: true, difficulty: true, marks: true, isActive: true, category: { select: { name: true } } } } },
            },
            randomRules: { include: { category: { select: { name: true } } } },
          },
        },
        _count: { select: { assignments: true, attempts: true, invitations: true } },
      },
    });
    if (!exam) throw notFound("Examination");
    // Pool sizes for random rules so HR can see whether enough questions exist
    const pools: Record<string, number> = {};
    for (const s of exam.sections)
      for (const r of s.randomRules)
        pools[r.id] = await prisma.question.count({
          where: { isActive: true, ...(r.categoryId ? { categoryId: r.categoryId } : {}), ...(r.difficulty ? { difficulty: r.difficulty } : {}), ...(r.type ? { type: r.type } : {}) },
        });
    res.json({ ...exam, rulePools: pools });
  }),
);

examsRouter.post(
  "/",
  ah(async (req, res) => {
    const body = parse(examSchema, req.body);
    if (body.endAt <= body.startAt) throw badRequest("End time must be after start time");
    const exam = await prisma.exam.create({
      data: { ...body, eligibility: (body.eligibility ?? undefined) as Prisma.InputJsonValue | undefined, createdById: req.user!.id, sections: { create: [{ title: "Section A", order: 0 }] } },
    });
    await audit(req, "exam.create", "Exam", exam.id, { title: exam.title });
    res.status(201).json(exam);
  }),
);

examsRouter.put(
  "/:id",
  ah(async (req, res) => {
    const body = parse(examSchema, req.body);
    if (body.endAt <= body.startAt) throw badRequest("End time must be after start time");
    const exam = await prisma.exam.update({
      where: { id: req.params.id },
      data: { ...body, eligibility: body.eligibility === null ? ({} as Prisma.InputJsonValue) : ((body.eligibility ?? undefined) as Prisma.InputJsonValue | undefined) },
    });
    await audit(req, "exam.update", "Exam", exam.id);
    res.json(exam);
  }),
);

examsRouter.post(
  "/:id/status",
  ah(async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]) }), req.body);
    const exam = await prisma.exam.findUnique({ where: { id: req.params.id }, include: { sections: { include: { _count: { select: { questions: true, randomRules: true } } } } } });
    if (!exam) throw notFound("Examination");
    if (status === "PUBLISHED") {
      const hasQuestions = exam.sections.some((s) => s._count.questions + s._count.randomRules > 0);
      if (!hasQuestions) throw badRequest("Add questions before publishing");
      const total = await recomputeTotal(exam.id);
      if (exam.passingMarks > total) throw badRequest(`Passing marks (${exam.passingMarks}) exceed total marks (${total})`);
      if (exam.sectionTimeLimits && exam.sections.some((s) => !s.timeLimitMinutes)) throw badRequest("Section time limits are enabled — set a time limit on every section");
    }
    if (status === "DRAFT" && (await prisma.attempt.count({ where: { examId: exam.id } })) > 0) throw badRequest("This examination has attempts and cannot return to draft. Archive it instead.");
    const updated = await prisma.exam.update({ where: { id: exam.id }, data: { status } });
    await audit(req, `exam.${status.toLowerCase()}`, "Exam", exam.id, { title: exam.title });
    res.json(updated);
  }),
);

examsRouter.post(
  "/:id/release-results",
  ah(async (req, res) => {
    const { released } = parse(z.object({ released: z.boolean() }), req.body);
    const pending = await prisma.attempt.count({ where: { examId: req.params.id, needsManualEval: true, status: { not: "IN_PROGRESS" } } });
    if (released && pending > 0) throw badRequest(`${pending} attempt(s) still need manual evaluation before results can be released`);
    const exam = await prisma.exam.update({ where: { id: req.params.id }, data: { resultsReleased: released } });
    await audit(req, released ? "exam.results_released" : "exam.results_withdrawn", "Exam", exam.id);
    res.json(exam);
  }),
);

examsRouter.post(
  "/:id/duplicate",
  ah(async (req, res) => {
    const src = await prisma.exam.findUnique({ where: { id: req.params.id }, include: { sections: { include: { questions: true, randomRules: true } } } });
    if (!src) throw notFound("Examination");
    const { id: _i, createdAt: _c, updatedAt: _u, sections, createdById: _cb, ...rest } = src;
    const copy = await prisma.exam.create({
      data: {
        ...rest,
        eligibility: (rest.eligibility ?? undefined) as Prisma.InputJsonValue | undefined,
        title: `${src.title} (copy)`,
        status: "DRAFT",
        resultsReleased: false,
        createdById: req.user!.id,
        sections: {
          create: sections.map((s) => ({
            title: s.title,
            description: s.description,
            order: s.order,
            timeLimitMinutes: s.timeLimitMinutes,
            questions: { create: s.questions.map((q) => ({ questionId: q.questionId, order: q.order, marks: q.marks })) },
            randomRules: { create: s.randomRules.map((r) => ({ categoryId: r.categoryId, difficulty: r.difficulty, type: r.type, count: r.count, marksEach: r.marksEach })) },
          })),
        },
      },
    });
    await audit(req, "exam.duplicate", "Exam", copy.id, { from: src.id });
    res.status(201).json(copy);
  }),
);

// ───────────── Deletion Impact & Secure Deletion Workflow ─────────────

examsRouter.get(
  "/:id/deletion-impact",
  ah(async (req, res) => {
    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id },
      include: {
        department: { select: { name: true } },
        _count: {
          select: {
            sessions: true,
            assignments: true,
            attempts: true,
          },
        },
      },
    });

    if (!exam) throw notFound("Examination");

    // Check authorization: Super Admin or HR owner
    const isSuperAdmin = req.user?.role === "SUPER_ADMIN";
    const isOwner = exam.createdById === req.user?.id || !exam.createdById;
    if (!isSuperAdmin && !isOwner) {
      throw forbidden("You are only authorized to view deletion details for examinations you created.");
    }

    const [activeSessionCount, completedAttemptsCount] = await Promise.all([
      prisma.examSession.count({
        where: { examId: exam.id, status: { in: ["ACTIVE", "SCHEDULED"] } },
      }),
      prisma.attempt.count({
        where: { examId: exam.id, status: { in: ["SUBMITTED", "AUTO_SUBMITTED", "ADMIN_SUBMITTED", "EVALUATED"] } },
      }),
    ]);

    const attemptCount = exam._count.attempts;
    const hasAttempts = attemptCount > 0;

    res.json({
      examId: exam.id,
      examTitle: exam.title,
      status: exam.status,
      department: exam.department?.name ?? "General",
      sessionCount: exam._count.sessions,
      activeSessionCount,
      candidateCount: exam._count.assignments,
      attemptCount,
      completedAttemptsCount,
      hasAttempts,
      canPermanentDelete: attemptCount === 0 && (isSuperAdmin || exam.status === "DRAFT"),
      actionType: hasAttempts ? "ARCHIVE" : "PERMANENT_DELETE",
      isOwner,
      isSuperAdmin,
      warningMessage: hasAttempts
        ? `This examination has ${attemptCount} candidate attempt(s) (${completedAttemptsCount} completed). In compliance with recruiting integrity rules, it will be safely ARCHIVED instead of erased. All candidate answers, scores, and evaluations will be preserved, and all active examination session codes will be revoked.`
        : `This examination has 0 candidate attempts. It will be permanently removed along with its questions and session configurations.`,
    });
  })
);

examsRouter.post(
  "/:id/delete",
  ah(async (req, res) => {
    const { confirmationName, reason } = parse(
      z.object({
        confirmationName: z.string().optional(),
        reason: z.string().max(500).optional(),
      }),
      req.body
    );

    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id },
      select: { id: true, title: true, status: true, createdById: true },
    });

    if (!exam) throw notFound("Examination");

    const isSuperAdmin = req.user?.role === "SUPER_ADMIN";
    const isOwner = exam.createdById === req.user?.id || !exam.createdById;
    if (!isSuperAdmin && !isOwner) {
      throw forbidden("You are only authorized to delete or archive examinations that you created.");
    }

    const attemptsCount = await prisma.attempt.count({ where: { examId: exam.id } });

    // If candidate attempts exist, enforce typing the exam title to prevent accidental deletion
    if (attemptsCount > 0) {
      if (confirmationName?.trim().toLowerCase() !== exam.title.trim().toLowerCase()) {
        throw badRequest(`To confirm deletion, please type the exact examination title: "${exam.title}"`);
      }

      // Safe Soft Deletion / Archival
      await prisma.exam.update({
        where: { id: exam.id },
        data: { status: "ARCHIVED" },
      });

      // Revoke any active, scheduled, or paused session codes
      const revoked = await prisma.examSession.updateMany({
        where: { examId: exam.id, status: { in: ["ACTIVE", "SCHEDULED", "PAUSED"] } },
        data: { status: "REVOKED" },
      });

      // Delete unused invitations
      await prisma.invitation.deleteMany({
        where: { examId: exam.id, usedCount: 0 },
      });

      await audit(req, "exam.soft_delete_archived", "Exam", exam.id, {
        title: exam.title,
        attemptsPreserved: attemptsCount,
        sessionsRevoked: revoked.count,
        reason: reason || "Administrator deletion / archive request",
        role: req.user?.role,
      });

      return res.json({
        success: true,
        mode: "ARCHIVED",
        message: `Examination "${exam.title}" safely archived. ${attemptsCount} candidate attempt records preserved and ${revoked.count} session(s) revoked.`,
      });
    }

    // If 0 candidate attempts, permanent deletion is permitted
    if (exam.status !== "DRAFT" && confirmationName?.trim().toLowerCase() !== exam.title.trim().toLowerCase()) {
      throw badRequest(`To confirm permanent deletion, please type the examination title: "${exam.title}"`);
    }

    // Clean up dependent child records safely
    const sessions = await prisma.examSession.findMany({ where: { examId: exam.id }, select: { id: true } });
    const sessionIds = sessions.map((s) => s.id);
    if (sessionIds.length > 0) {
      await prisma.sessionAuditLog.deleteMany({ where: { sessionId: { in: sessionIds } } });
      await prisma.sessionCandidate.deleteMany({ where: { sessionId: { in: sessionIds } } });
      await prisma.examSession.deleteMany({ where: { id: { in: sessionIds } } });
    }
    await prisma.invitation.deleteMany({ where: { examId: exam.id } });
    await prisma.examAssignment.deleteMany({ where: { examId: exam.id } });
    await prisma.accommodationRequest.deleteMany({ where: { examId: exam.id } });
    await prisma.consentRecord.deleteMany({ where: { examId: exam.id } });

    const sections = await prisma.examSection.findMany({ where: { examId: exam.id }, select: { id: true } });
    const sectionIds = sections.map((s) => s.id);
    if (sectionIds.length > 0) {
      await prisma.sectionRandomRule.deleteMany({ where: { sectionId: { in: sectionIds } } });
      await prisma.examQuestion.deleteMany({ where: { sectionId: { in: sectionIds } } });
      await prisma.examSection.deleteMany({ where: { id: { in: sectionIds } } });
    }

    await prisma.exam.delete({ where: { id: exam.id } });

    await audit(req, "exam.permanent_delete", "Exam", exam.id, {
      title: exam.title,
      reason: reason || "Administrator permanent deletion",
      role: req.user?.role,
    });

    res.json({
      success: true,
      mode: "DELETED",
      message: `Examination "${exam.title}" permanently deleted.`,
    });
  })
);

examsRouter.delete(
  "/:id",
  ah(async (req, res) => {
    const exam = await prisma.exam.findUnique({ where: { id: req.params.id }, select: { id: true, createdById: true, status: true, title: true } });
    if (!exam) throw notFound("Examination");

    const isSuperAdmin = req.user?.role === "SUPER_ADMIN";
    const isOwner = exam.createdById === req.user?.id || !exam.createdById;
    if (!isSuperAdmin && !isOwner) {
      throw forbidden("You are only authorized to delete examinations you created.");
    }

    const attempts = await prisma.attempt.count({ where: { examId: req.params.id } });
    if (attempts > 0) {
      // Soft-delete / archive
      await prisma.exam.update({ where: { id: exam.id }, data: { status: "ARCHIVED" } });
      await prisma.examSession.updateMany({ where: { examId: exam.id, status: { in: ["ACTIVE", "SCHEDULED"] } }, data: { status: "REVOKED" } });
      await audit(req, "exam.soft_delete_archived", "Exam", exam.id, { title: exam.title });
      return res.json({ ok: true, mode: "ARCHIVED" });
    }

    // Permanent delete
    const sections = await prisma.examSection.findMany({ where: { examId: exam.id }, select: { id: true } });
    const sectionIds = sections.map((s) => s.id);
    if (sectionIds.length > 0) {
      await prisma.sectionRandomRule.deleteMany({ where: { sectionId: { in: sectionIds } } });
      await prisma.examQuestion.deleteMany({ where: { sectionId: { in: sectionIds } } });
      await prisma.examSection.deleteMany({ where: { id: { in: sectionIds } } });
    }
    await prisma.examSession.deleteMany({ where: { examId: exam.id } });
    await prisma.invitation.deleteMany({ where: { examId: exam.id } });
    await prisma.examAssignment.deleteMany({ where: { examId: exam.id } });
    await prisma.exam.delete({ where: { id: exam.id } });
    await audit(req, "exam.delete", "Exam", exam.id, { title: exam.title });
    res.json({ ok: true, mode: "DELETED" });
  }),
);

// ───────────── Sections ─────────────
const sectionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
  timeLimitMinutes: z.number().int().min(1).max(600).optional().nullable(),
  passingMarks: z.number().min(0).default(0),
  negativeMarks: z.number().min(0).default(0),
  instructions: z.string().max(10000).optional().nullable(),
  isMandatory: z.boolean().default(true),
  sectionType: z.string().optional().nullable(),
  difficultyConfig: z.record(z.unknown()).optional().nullable(),
  order: z.number().int().optional(),
});

examsRouter.post(
  "/:id/sections",
  ah(async (req, res) => {
    await assertEditableStructure(req.params.id);
    const body = parse(sectionSchema, req.body);
    const count = await prisma.examSection.count({ where: { examId: req.params.id } });
    res.status(201).json(await prisma.examSection.create({ data: { ...body, difficultyConfig: (body.difficultyConfig ?? undefined) as Prisma.InputJsonValue | undefined, examId: req.params.id, order: body.order ?? count } }));
  }),
);

examsRouter.post(
  "/:id/sections/reorder",
  ah(async (req, res) => {
    await assertEditableStructure(req.params.id);
    const { sectionIds } = parse(z.object({ sectionIds: z.array(z.string()) }), req.body);
    for (let i = 0; i < sectionIds.length; i++) {
      await prisma.examSection.update({
        where: { id: sectionIds[i] },
        data: { order: i },
      });
    }
    res.json({ ok: true });
  }),
);

examsRouter.patch(
  "/sections/:sid",
  ah(async (req, res) => {
    const s = await sectionExam(req.params.sid);
    const body = parse(sectionSchema.partial(), req.body);
    if (body.timeLimitMinutes !== undefined || body.passingMarks !== undefined || body.negativeMarks !== undefined) await assertEditableStructure(s.examId);
    res.json(await prisma.examSection.update({ where: { id: s.id }, data: { ...body, difficultyConfig: (body.difficultyConfig ?? undefined) as Prisma.InputJsonValue | undefined } }));
  }),
);

examsRouter.delete(
  "/sections/:sid",
  ah(async (req, res) => {
    const s = await sectionExam(req.params.sid);
    await assertEditableStructure(s.examId);
    await prisma.examSection.delete({ where: { id: s.id } });
    await recomputeTotal(s.examId);
    res.json({ ok: true });
  }),
);

examsRouter.post(
  "/:id/sections/reorder",
  ah(async (req, res) => {
    await assertEditableStructure(req.params.id);
    const { ids } = parse(z.object({ ids: z.array(z.string()).min(1) }), req.body);
    await prisma.$transaction(ids.map((id, i) => prisma.examSection.updateMany({ where: { id, examId: req.params.id }, data: { order: i } })));
    res.json({ ok: true });
  }),
);

examsRouter.post(
  "/sections/:sid/questions",
  ah(async (req, res) => {
    const s = await sectionExam(req.params.sid);
    await assertEditableStructure(s.examId);
    const { questionIds } = parse(z.object({ questionIds: z.array(z.string()).min(1).max(500) }), req.body);
    const existing = await prisma.examQuestion.findMany({ where: { section: { examId: s.examId } }, select: { questionId: true } });
    const already = new Set(existing.map((e) => e.questionId));
    const toAdd = questionIds.filter((q) => !already.has(q));
    const start = await prisma.examQuestion.count({ where: { sectionId: s.id } });
    await prisma.examQuestion.createMany({ data: toAdd.map((questionId, i) => ({ sectionId: s.id, questionId, order: start + i })), skipDuplicates: true });
    const total = await recomputeTotal(s.examId);
    res.json({ added: toAdd.length, skipped: questionIds.length - toAdd.length, totalMarks: total });
  }),
);

examsRouter.patch(
  "/sections/:sid/questions/:eqid",
  ah(async (req, res) => {
    const s = await sectionExam(req.params.sid);
    await assertEditableStructure(s.examId);
    const { marks } = parse(z.object({ marks: z.number().min(0).max(100).nullable() }), req.body);
    await prisma.examQuestion.update({ where: { id: req.params.eqid }, data: { marks } });
    res.json({ totalMarks: await recomputeTotal(s.examId) });
  }),
);

examsRouter.delete(
  "/sections/:sid/questions/:eqid",
  ah(async (req, res) => {
    const s = await sectionExam(req.params.sid);
    await assertEditableStructure(s.examId);
    await prisma.examQuestion.delete({ where: { id: req.params.eqid } });
    res.json({ totalMarks: await recomputeTotal(s.examId) });
  }),
);

examsRouter.post(
  "/sections/:sid/rules",
  ah(async (req, res) => {
    const s = await sectionExam(req.params.sid);
    await assertEditableStructure(s.examId);
    const body = parse(
      z.object({
        categoryId: z.string().optional().nullable(),
        difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).optional().nullable(),
        type: z.enum(["SINGLE", "MULTIPLE", "TRUE_FALSE", "SHORT", "DESCRIPTIVE", "CODING", "NUMERICAL"]).optional().nullable(),
        count: z.number().int().min(1, "Pick at least 1 question").max(200, "A rule can pick at most 200 questions"),
        marksEach: z.number().min(0).max(100).default(1),
      }),
      req.body,
    );
    const pool = await prisma.question.count({ where: { isActive: true, ...(body.categoryId ? { categoryId: body.categoryId } : {}), ...(body.difficulty ? { difficulty: body.difficulty } : {}), ...(body.type ? { type: body.type } : {}) } });
    if (pool < body.count) throw badRequest(`Only ${pool} matching question(s) exist in the bank — reduce the count or add questions`);
    const rule = await prisma.sectionRandomRule.create({ data: { ...body, sectionId: s.id } });
    res.status(201).json({ rule, totalMarks: await recomputeTotal(s.examId) });
  }),
);

examsRouter.delete(
  "/rules/:rid",
  ah(async (req, res) => {
    const r = await prisma.sectionRandomRule.findUnique({ where: { id: req.params.rid }, include: { section: true } });
    if (!r) throw notFound("Rule");
    await assertEditableStructure(r.section.examId);
    await prisma.sectionRandomRule.delete({ where: { id: r.id } });
    res.json({ totalMarks: await recomputeTotal(r.section.examId) });
  }),
);

// ───────────── Invitations ─────────────
examsRouter.get(
  "/:id/invitations",
  ah(async (req, res) => {
    res.json(await prisma.invitation.findMany({ where: { examId: req.params.id }, orderBy: { createdAt: "desc" }, include: { createdBy: { select: { name: true } } } }));
  }),
);

examsRouter.post(
  "/:id/invitations",
  ah(async (req, res) => {
    const body = parse(
      z.object({
        mode: z.enum(["shared", "personal"]),
        maxUses: z.number().int().min(1).max(10000).default(1),
        expiresAt: z.coerce.date().optional().nullable(),
        emails: z.array(z.string().trim().email()).max(500).default([]),
        sendEmail: z.boolean().default(true),
      }),
      req.body,
    );
    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (!exam) throw notFound("Examination");
    const prefix = (exam.title.replace(/[^A-Za-z]/g, "").slice(0, 4) || "ZV").toUpperCase();
    const created = [];
    if (body.mode === "shared") {
      created.push(await prisma.invitation.create({ data: { examId: exam.id, code: inviteCode(prefix), maxUses: body.maxUses, expiresAt: body.expiresAt ?? null, createdById: req.user!.id } }));
    } else {
      if (!body.emails.length) throw badRequest("Add at least one email address");
      for (const email of [...new Set(body.emails.map((e) => e.toLowerCase()))]) {
        const inv = await prisma.invitation.create({ data: { examId: exam.id, code: inviteCode(prefix), email, maxUses: 1, expiresAt: body.expiresAt ?? null, createdById: req.user!.id } });
        created.push(inv);
        if (exam.status === "PUBLISHED") {
          const user = await prisma.user.findUnique({ where: { email }, include: { candidate: true } });
          if (user?.candidate) {
            // Existing candidate: assign directly
            const exists = await prisma.examAssignment.findUnique({ where: { examId_candidateId: { examId: exam.id, candidateId: user.candidate.id } } });
            if (!exists) {
              await prisma.examAssignment.create({ data: { examId: exam.id, candidateId: user.candidate.id, invitationCode: inv.code } });
              await prisma.invitation.update({ where: { id: inv.id }, data: { usedCount: 1 } });
              await advanceStage(user.candidate.id, "EXAM_SCHEDULED", `Invited to ${exam.title}`, req.user!.id);
            }
          }
        }
        if (body.sendEmail) {
          const url = `${env.appUrl}/register?code=${inv.code}`;
          await sendMail(
            email,
            `Examination invitation: ${exam.title} — Zanvar Group`,
            `You are invited to appear for "${exam.title}".\nWindow: ${exam.startAt.toLocaleString("en-IN")} – ${exam.endAt.toLocaleString("en-IN")}\nInvitation code: ${inv.code}\nRegister or sign in: ${url}`,
            emailLayout(
              `Invitation: ${exam.title}`,
              `<p>You are invited to appear for the <b>${exam.title}</b> examination conducted by Zanvar Group.</p><p>Window: <b>${exam.startAt.toLocaleString("en-IN")}</b> to <b>${exam.endAt.toLocaleString("en-IN")}</b><br/>Duration: ${exam.durationMinutes} minutes</p><p>Your invitation code: <b style="font-family:monospace;font-size:16px">${inv.code}</b></p><p>The examination is proctored using your webcam and microphone. Please use a laptop or desktop with Chrome or Edge.</p>`,
              "Register / Sign in",
              url,
            ),
          );
        }
      }
    }

    // Automatically synchronize an active ExamSession for created invitation codes
    for (const inv of created) {
      try {
        const invNormCode = normalizeSessionCode(inv.code);
        const invHash = hashSessionCode(invNormCode);
        const existingSession = await prisma.examSession.findUnique({ where: { sessionCodeHash: invHash } });
        if (!existingSession) {
          await prisma.examSession.create({
            data: {
              sessionName: `${exam.title} - ${inv.code}`,
              examId: exam.id,
              sessionCodeHash: invHash,
              codePrefix: inv.code.length > 4 ? inv.code.slice(0, 4) : "",
              codeLastFour: inv.code.slice(-4),
              startsAt: exam.startAt || new Date(Date.now() - 3600000),
              endsAt: inv.expiresAt || exam.endAt || new Date(Date.now() + 30 * 24 * 3600000),
              maxCandidates: inv.maxUses || 500,
              maxAttempts: exam.maxAttempts || 3,
              status: "ACTIVE",
              createdById: req.user!.id,
            },
          });
        }
      } catch (err) {
        // Non-blocking sync
      }
    }

    await audit(req, "invitation.create", "Exam", exam.id, { mode: body.mode, count: created.length });
    res.status(201).json(created);
  }),
);

examsRouter.delete(
  "/invitations/:iid",
  ah(async (req, res) => {
    await prisma.invitation.delete({ where: { id: req.params.iid } });
    await audit(req, "invitation.revoke", "Invitation", req.params.iid);
    res.json({ ok: true });
  }),
);

// ───────────── Assignments ─────────────
examsRouter.get(
  "/:id/assignments",
  ah(async (req, res) => {
    const rows = await prisma.examAssignment.findMany({
      where: { examId: req.params.id },
      orderBy: { assignedAt: "desc" },
      include: {
        candidate: {
          include: {
            user: { select: { name: true, email: true, emailVerified: true } },
            attempts: { where: { examId: req.params.id }, select: { id: true, status: true, score: true, percentage: true, riskLevel: true, riskScore: true, attemptNo: true, submittedAt: true } },
          },
        },
      },
    });
    res.json(rows);
  }),
);

examsRouter.post(
  "/:id/assignments",
  ah(async (req, res) => {
    const { candidateIds, override } = parse(z.object({ candidateIds: z.array(z.string()).min(1).max(1000), override: z.boolean().default(false) }), req.body);
    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (!exam) throw notFound("Examination");
    const candidates = await prisma.candidateProfile.findMany({ where: { id: { in: candidateIds } }, include: { user: { select: { name: true } } } });
    const assigned: string[] = [];
    const skipped: { name: string; reason: string }[] = [];
    for (const c of candidates) {
      const reason = checkEligibility(exam.eligibility as Eligibility | null, c);
      if (reason && !override) {
        skipped.push({ name: c.user.name, reason });
        continue;
      }
      const r = await prisma.examAssignment.upsert({ where: { examId_candidateId: { examId: exam.id, candidateId: c.id } }, create: { examId: exam.id, candidateId: c.id }, update: {} });
      if (r) assigned.push(c.id);
      await advanceStage(c.id, "EXAM_SCHEDULED", `Assigned to ${exam.title}`, req.user!.id);
    }
    await audit(req, "exam.assign", "Exam", exam.id, { assigned: assigned.length, skipped: skipped.length, override });
    res.json({ assigned: assigned.length, skipped });
  }),
);

examsRouter.delete(
  "/:id/assignments/:candidateId",
  ah(async (req, res) => {
    const attempts = await prisma.attempt.count({ where: { examId: req.params.id, candidateId: req.params.candidateId } });
    if (attempts) throw badRequest("This candidate has already attempted the examination");
    await prisma.examAssignment.delete({ where: { examId_candidateId: { examId: req.params.id, candidateId: req.params.candidateId } } });
    await audit(req, "exam.unassign", "Exam", req.params.id, { candidateId: req.params.candidateId });
    res.json({ ok: true });
  }),
);

// Grant an additional attempt or extra time (e.g. after a technical failure reviewed by HR)
examsRouter.patch(
  "/:id/assignments/:candidateId",
  ah(async (req, res) => {
    const body = parse(z.object({ extraAttempts: z.number().int().min(0).max(5).optional(), extraMinutes: z.number().int().min(0).max(240).optional() }), req.body);
    const a = await prisma.examAssignment.update({ where: { examId_candidateId: { examId: req.params.id, candidateId: req.params.candidateId } }, data: body });
    await audit(req, "exam.assignment_adjusted", "Exam", req.params.id, { candidateId: req.params.candidateId, ...body });
    res.json(a);
  }),
);

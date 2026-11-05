import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { ah, badRequest, forbidden, notFound, parse } from "../../lib/http";
import { requireCandidate } from "../../middleware/auth";
import { resumeUpload, sniff } from "../../middleware/upload";
import { storage } from "../../lib/storage";
import { audit } from "../../lib/audit";
import { redeemInvitation } from "../../lib/invites";
import { resultsVisible, type Paper } from "../../lib/engine";
import { env } from "../../config/env";
import { hashSessionCode, normalizeSessionCode, signSessionAccessToken, SESSION_ACCESS_COOKIE } from "../../lib/sessions";

export const meRouter = Router();
meRouter.use(requireCandidate);

const cid = (req: Express.Request) => {
  if (!req.user?.candidateId) throw forbidden("Candidate profile missing");
  return req.user.candidateId;
};

meRouter.get(
  "/profile",
  ah(async (req, res) => {
    const p = await prisma.candidateProfile.findUnique({ where: { id: cid(req) }, include: { user: { select: { name: true, email: true, emailVerified: true } } } });
    if (!p) throw notFound("Profile");
    const { resumeKey, hrNotes: _hr, ...rest } = p;
    res.json({ ...rest, hasResume: !!resumeKey });
  }),
);

meRouter.put(
  "/profile",
  ah(async (req, res) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(120),
        mobile: z.string().trim().regex(/^[+]?[0-9 -]{10,15}$/, "Enter a valid mobile number"),
        college: z.string().trim().min(2).max(200),
        degree: z.string().trim().min(1).max(80),
        branch: z.string().trim().min(1).max(120),
        currentYear: z.string().trim().min(1).max(30),
        graduationYear: z.number().int().min(2000).max(2040),
      }),
      req.body,
    );
    const { name, ...profile } = body;
    await prisma.candidateProfile.update({ where: { id: cid(req) }, data: { ...profile, user: { update: { name } } } });
    await audit(req, "candidate.profile_update", "CandidateProfile", cid(req));
    res.json({ ok: true });
  }),
);

meRouter.post(
  "/resume",
  resumeUpload.single("resume"),
  ah(async (req, res) => {
    if (!req.file) throw badRequest("Choose a resume file");
    const kind = sniff(req.file.buffer);
    if (!kind || !["pdf", "doc", "docx"].includes(kind)) throw badRequest("Resume must be a valid PDF or Word document");
    const p = await prisma.candidateProfile.findUniqueOrThrow({ where: { id: cid(req) } });
    const key = await storage.put("resumes", req.file.buffer, kind);
    await prisma.candidateProfile.update({ where: { id: p.id }, data: { resumeKey: key, resumeName: req.file.originalname.slice(0, 150) } });
    if (p.resumeKey) await storage.remove(p.resumeKey);
    await audit(req, "candidate.resume_upload", "CandidateProfile", p.id);
    res.json({ ok: true, resumeName: req.file.originalname });
  }),
);

meRouter.post(
  "/redeem",
  ah(async (req, res) => {
    const { code } = parse(z.object({ code: z.string().trim().min(4).max(40) }), req.body);
    const r = await redeemInvitation(cid(req), req.user!.email, code);
    await audit(req, "invitation.redeem", "Exam", r.exam.id, { code });
    res.json({ examId: r.exam.id, title: r.exam.title, alreadyAssigned: r.alreadyAssigned });
  }),
);

async function examForCandidate(candidateId: string, examId: string) {
  const a = await prisma.examAssignment.findUnique({
    where: { examId_candidateId: { examId, candidateId } },
    include: { exam: { include: { department: { select: { name: true } }, sections: { select: { id: true, title: true, timeLimitMinutes: true }, orderBy: { order: "asc" } } } } },
  });
  if (!a || a.exam.status === "DRAFT") throw notFound("Examination");
  return a;
}

function examPhase(e: { startAt: Date; endAt: Date; status: string }) {
  const now = Date.now();
  if (e.status === "ARCHIVED") return "CLOSED";
  if (now < e.startAt.getTime()) return "UPCOMING";
  if (now > e.endAt.getTime()) return "CLOSED";
  return "OPEN";
}

meRouter.get(
  "/exams",
  ah(async (req, res) => {
    const candidateId = cid(req);
    const assignments = await prisma.examAssignment.findMany({
      where: { candidateId, exam: { status: { not: "DRAFT" } } },
      include: {
        exam: { select: { id: true, title: true, description: true, position: true, startAt: true, endAt: true, durationMinutes: true, totalMarks: true, maxAttempts: true, status: true, resultsReleased: true, resultPublication: true, proctoringEnabled: true, department: { select: { name: true } } } },
      },
      orderBy: { exam: { startAt: "asc" } },
    });
    const attempts = await prisma.attempt.findMany({ where: { candidateId }, select: { id: true, examId: true, status: true, attemptNo: true, deadlineAt: true, percentage: true, score: true, maxScore: true, passed: true, submittedAt: true } });
    res.json(
      assignments.map((a) => {
        const mine = attempts.filter((t) => t.examId === a.examId).sort((x, y) => y.attemptNo - x.attemptNo);
        const inProgress = mine.find((t) => t.status === "IN_PROGRESS" && t.deadlineAt > new Date());
        const allowed = a.exam.maxAttempts + a.extraAttempts;
        const phase = examPhase(a.exam);
        return {
          exam: a.exam,
          phase,
          attemptsUsed: mine.length,
          attemptsAllowed: allowed,
          inProgressAttemptId: inProgress?.id ?? null,
          canStart: phase === "OPEN" && !inProgress && mine.length < allowed,
          attempts: mine.map((t) => ({
            id: t.id,
            attemptNo: t.attemptNo,
            status: t.status,
            submittedAt: t.submittedAt,
            resultVisible: resultsVisible(a.exam, t.status),
            ...(resultsVisible(a.exam, t.status) ? { score: t.score, maxScore: t.maxScore, percentage: t.percentage, passed: t.passed } : {}),
          })),
        };
      }),
    );
  }),
);

/**
 * GET /api/me/available-exams
 * Browse all published examinations that are currently open or upcoming for candidates.
 */
meRouter.get(
  "/available-exams",
  ah(async (req, res) => {
    const candidateId = cid(req);
    const now = new Date();

    const exams = await prisma.exam.findMany({
      where: {
        status: "PUBLISHED",
        endAt: { gte: now },
      },
      select: {
        id: true,
        title: true,
        description: true,
        position: true,
        startAt: true,
        endAt: true,
        durationMinutes: true,
        totalMarks: true,
        passingMarks: true,
        maxAttempts: true,
        department: { select: { name: true } },
        assignments: {
          where: { candidateId },
          select: { id: true },
        },
        attempts: {
          where: { candidateId },
          select: { id: true, status: true },
        },
      },
      orderBy: { startAt: "asc" },
    });

    res.json(
      exams.map((e) => {
        const isAssigned = e.assignments.length > 0;
        const attemptsUsed = e.attempts.length;
        const phase = examPhase({ startAt: e.startAt, endAt: e.endAt, status: "PUBLISHED" });
        return {
          id: e.id,
          title: e.title,
          description: e.description,
          position: e.position,
          department: e.department?.name ?? "General",
          startAt: e.startAt,
          endAt: e.endAt,
          durationMinutes: e.durationMinutes,
          totalMarks: e.totalMarks,
          passingMarks: e.passingMarks,
          maxAttempts: e.maxAttempts,
          isAssigned,
          attemptsUsed,
          phase,
        };
      })
    );
  })
);

/**
 * POST /api/me/apply
 * Apply for an examination by entering its Examination Session Code.
 * Verifies code, checks candidate eligibility & session validity, assigns candidate, and issues session access token.
 */
meRouter.post(
  "/apply",
  ah(async (req, res) => {
    const candidateId = cid(req);
    const { examId, sessionCode } = parse(
      z.object({
        examId: z.string().min(1),
        sessionCode: z.string().trim().min(3).max(64),
      }),
      req.body
    );

    // 1. Verify exam exists and is published
    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: {
        sections: { orderBy: { order: "asc" } },
      },
    });
    if (!exam || exam.status !== "PUBLISHED") {
      throw notFound("Examination not found or is no longer available.");
    }

    const normCode = normalizeSessionCode(sessionCode);
    const codeHash = hashSessionCode(normCode);
    const stripped = normCode.replace(/[^A-Z0-9]/g, "");
    const strippedHash = hashSessionCode(stripped);

    // 2. Look for matching active session for this exam
    let session = await prisma.examSession.findFirst({
      where: {
        examId,
        OR: [{ sessionCodeHash: codeHash }, { sessionCodeHash: strippedHash }],
      },
      include: {
        _count: { select: { candidates: true } },
      },
    });

    // Also check invitation code for this exam
    if (!session) {
      const invitation = await prisma.invitation.findFirst({
        where: {
          examId,
          OR: [
            { code: { equals: normCode, mode: "insensitive" } },
            { code: { equals: sessionCode.trim(), mode: "insensitive" } },
            { code: { equals: stripped, mode: "insensitive" } },
          ],
        },
      });

      if (invitation) {
        session = await prisma.examSession.findFirst({
          where: { examId, status: { in: ["ACTIVE", "SCHEDULED"] } },
          include: {
            _count: { select: { candidates: true } },
          },
        });

        if (!session) {
          // Provision session for valid invitation
          session = await prisma.examSession.create({
            data: {
              sessionName: `${exam.title} - Main Session`,
              examId,
              sessionCodeHash: codeHash,
              codePrefix: normCode.length > 4 ? normCode.slice(0, 4) : "",
              codeLastFour: normCode.slice(-4),
              startsAt: exam.startAt || new Date(Date.now() - 3600000),
              endsAt: exam.endAt && exam.endAt > new Date() ? exam.endAt : new Date(Date.now() + 30 * 24 * 3600000),
              maxCandidates: 1000,
              maxAttempts: exam.maxAttempts || 3,
              status: "ACTIVE",
              createdById: exam.createdById,
            },
            include: {
              _count: { select: { candidates: true } },
            },
          });
        }
      }
    }

    if (!session) {
      throw badRequest("Invalid Examination Session Code for this examination. Please check the code and try again.");
    }

    // 3. Check session status
    const now = new Date();
    if (session.status === "REVOKED") throw badRequest("This examination session has been revoked by HR.");
    if (session.status === "PAUSED") throw badRequest("This examination session is currently paused.");
    if (session.status === "COMPLETED") throw badRequest("This examination session has ended.");
    if (session.status === "EXPIRED" || (session.endsAt && now > session.endsAt)) throw badRequest("This examination session has expired.");

    // 4. Assign candidate to exam if not already assigned
    await prisma.examAssignment.upsert({
      where: {
        examId_candidateId: { examId, candidateId },
      },
      update: {
        invitationCode: sessionCode.trim().toUpperCase(),
      },
      create: {
        examId,
        candidateId,
        invitationCode: sessionCode.trim().toUpperCase(),
      },
    });

    // 5. Connect candidate to session
    await prisma.sessionCandidate.upsert({
      where: {
        sessionId_candidateId: { sessionId: session.id, candidateId },
      },
      update: {
        accessStatus: "JOINED",
        joinedAt: now,
      },
      create: {
        sessionId: session.id,
        candidateId,
        accessStatus: "JOINED",
        joinedAt: now,
      },
    });

    // 6. Sign session access token cookie
    const token = signSessionAccessToken(candidateId, session.id, examId);
    res.cookie(SESSION_ACCESS_COOKIE, token, {
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: "lax",
      maxAge: (exam.durationMinutes + 120) * 60 * 1000,
    });

    res.json({
      success: true,
      examId,
      title: exam.title,
      sessionToken: token,
    });
  })
);

meRouter.get(
  "/exams/:examId",
  ah(async (req, res) => {
    const candidateId = cid(req);
    const a = await examForCandidate(candidateId, req.params.examId);
    const e = a.exam;
    const [attemptsUsed, accommodation, inProgress] = await Promise.all([
      prisma.attempt.count({ where: { examId: e.id, candidateId } }),
      prisma.accommodationRequest.findFirst({ where: { examId: e.id, candidateId }, orderBy: { createdAt: "desc" } }),
      prisma.attempt.findFirst({ where: { examId: e.id, candidateId, status: "IN_PROGRESS", deadlineAt: { gt: new Date() } }, select: { id: true } }),
    ]);
    const questionCount = await prisma.examQuestion.count({ where: { section: { examId: e.id } } });
    const ruleCount = await prisma.sectionRandomRule.aggregate({ where: { section: { examId: e.id } }, _sum: { count: true } });
    res.json({
      id: e.id,
      title: e.title,
      description: e.description,
      position: e.position,
      department: e.department?.name,
      startAt: e.startAt,
      endAt: e.endAt,
      durationMinutes: e.durationMinutes + a.extraMinutes,
      totalMarks: e.totalMarks,
      passingMarks: e.passingMarks,
      negativeMarking: e.negativeMarking,
      instructions: e.instructions,
      sections: e.sections,
      sectionTimeLimits: e.sectionTimeLimits,
      questionCount: questionCount + (ruleCount._sum.count ?? 0),
      proctoring: {
        enabled: e.proctoringEnabled,
        requireWebcam: e.requireWebcam && !(accommodation?.status === "APPROVED" && accommodation.waiveWebcam),
        requireMicrophone: e.requireMicrophone && !(accommodation?.status === "APPROVED" && accommodation.waiveMicrophone),
        requireFullscreen: e.requireFullscreen,
        evidenceCapture: e.evidenceCapture,
        livePreview: e.livePreview,
      },
      phase: examPhase(e),
      attemptsUsed,
      attemptsAllowed: e.maxAttempts + a.extraAttempts,
      inProgressAttemptId: inProgress?.id ?? null,
      emailVerified: req.user!.emailVerified,
      accommodation,
    });
  }),
);

meRouter.post(
  "/exams/:examId/accommodation",
  ah(async (req, res) => {
    const candidateId = cid(req);
    await examForCandidate(candidateId, req.params.examId);
    const { reason } = parse(z.object({ reason: z.string().trim().min(10).max(2000) }), req.body);
    const pending = await prisma.accommodationRequest.findFirst({ where: { examId: req.params.examId, candidateId, status: "PENDING" } });
    if (pending) throw badRequest("You already have a pending request for this examination");
    const r = await prisma.accommodationRequest.create({ data: { examId: req.params.examId, candidateId, reason } });
    await audit(req, "accommodation.request", "AccommodationRequest", r.id);
    res.status(201).json(r);
  }),
);

meRouter.get(
  "/results/:attemptId",
  ah(async (req, res) => {
    const attempt = await prisma.attempt.findUnique({ where: { id: req.params.attemptId }, include: { exam: true, answers: true } });
    if (!attempt || attempt.candidateId !== cid(req)) throw notFound("Result");
    if (!resultsVisible(attempt.exam, attempt.status)) throw forbidden("Results for this examination have not been released yet");
    const paper = attempt.paper as unknown as Paper;
    const qIds = paper.flatMap((s) => s.questions.map((q) => q.questionId));
    const questions = await prisma.question.findMany({ where: { id: { in: qIds } }, include: { options: true } });
    const qMap = new Map(questions.map((q) => [q.id, q]));
    const aMap = new Map(attempt.answers.map((a) => [a.questionId, a]));
    const sections = paper.map((s) => {
      const qs = s.questions.map((pq, i) => {
        const q = qMap.get(pq.questionId)!;
        const a = aMap.get(pq.questionId);
        const optionsById = new Map(q.options.map((o) => [o.id, o]));
        return {
          number: i + 1,
          text: q.text,
          type: q.type,
          marks: pq.marks,
          marksAwarded: a?.marksAwarded ?? 0,
          isCorrect: a?.isCorrect ?? null,
          explanation: q.explanation,
          options: pq.optionOrder.map((id) => ({ id, text: optionsById.get(id)?.text, isCorrect: optionsById.get(id)?.isCorrect, selected: a?.selectedOptionIds.includes(id) ?? false })),
          textAnswer: a?.textAnswer ?? null,
          acceptedAnswers: q.type === "SHORT" || q.type === "NUMERICAL" ? q.acceptedAnswers : [],
          evaluatorNote: a?.evaluatorNote ?? null,
        };
      });
      return { title: s.title, score: qs.reduce((x, q) => x + (q.marksAwarded ?? 0), 0), max: qs.reduce((x, q) => x + q.marks, 0), questions: qs };
    });
    res.json({
      exam: { id: attempt.exam.id, title: attempt.exam.title, passingMarks: attempt.exam.passingMarks },
      attemptNo: attempt.attemptNo,
      submittedAt: attempt.submittedAt,
      score: attempt.score,
      maxScore: attempt.maxScore,
      percentage: attempt.percentage,
      passed: attempt.passed,
      sections,
    });
  }),
);

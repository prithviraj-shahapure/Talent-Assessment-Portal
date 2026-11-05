import { Router } from "express";
import { z } from "zod";
import { prisma, type Prisma } from "../../lib/prisma";
import { ah, badRequest, notFound, parse } from "../../lib/http";
import { requireStaff, requireSuperAdmin } from "../../middleware/auth";
import { storage } from "../../lib/storage";
import { audit } from "../../lib/audit";
import { liveHub, type LiveStatus } from "../../sockets/hub";
import { finalizeAttempt } from "../../lib/attempts";
import type { Paper } from "../../lib/engine";

export const proctoringRouter = Router();
proctoringRouter.use(requireStaff);

proctoringRouter.get(
  "/live",
  ah(async (req, res) => {
    const examId = req.query.examId ? String(req.query.examId) : undefined;
    const since = new Date(Date.now() - 2 * 3600 * 1000);
    const attempts = await prisma.attempt.findMany({
      where: { ...(examId ? { examId } : {}), OR: [{ status: "IN_PROGRESS" }, { submittedAt: { gte: since } }] },
      include: {
        exam: { select: { id: true, title: true, livePreview: true } },
        candidate: { include: { user: { select: { name: true } } } },
        _count: { select: { events: true, answers: { where: { OR: [{ selectedOptionIds: { isEmpty: false } }, { textAnswer: { not: null } }] } } } },
      },
      orderBy: { startedAt: "desc" },
    });
    const items: LiveStatus[] = attempts.map((a) => {
      const hub = liveHub.statuses.get(a.id);
      const info = (a.clientInfo ?? {}) as { webcamRequired?: boolean; microphoneRequired?: boolean };
      const paper = a.paper as unknown as Paper;
      const ended = a.status !== "IN_PROGRESS";
      const base: LiveStatus = {
        attemptId: a.id,
        examId: a.examId,
        candidateId: a.candidateId,
        candidateName: a.candidate.user.name,
        examTitle: a.exam.title,
        deadlineAt: a.deadlineAt.toISOString(),
        currentQuestion: a.currentQuestion,
        totalQuestions: paper.reduce((n, s) => n + s.questions.length, 0),
        answered: a._count.answers,
        camera: info.webcamRequired ? "OFF" : "NOT_REQUIRED",
        microphone: info.microphoneRequired ? "OFF" : "NOT_REQUIRED",
        focused: false,
        fullscreen: false,
        faceCount: null,
        audioLevel: 0,
        connected: false,
        status: ended ? (a.status === "AUTO_SUBMITTED" ? "AUTO_SUBMITTED" : "SUBMITTED") : "DISCONNECTED",
        eventCount: a._count.events,
        riskScore: a.riskScore,
        riskLevel: a.riskLevel,
        lastSeenAt: (a.lastSeenAt ?? a.startedAt).toISOString(),
        previewAllowed: a.exam.livePreview && !!info.webcamRequired,
      };
      if (!hub) return base;
      return { ...base, ...hub, status: ended ? base.status : hub.status, riskScore: a.riskScore, riskLevel: a.riskLevel, eventCount: a._count.events };
    });
    res.json(items);
  }),
);

proctoringRouter.get(
  "/review",
  ah(async (req, res) => {
    const where: Prisma.AttemptWhereInput = { status: { not: "IN_PROGRESS" }, riskScore: { gt: 0 } };
    if (req.query.examId) where.examId = String(req.query.examId);
    if (req.query.level) where.riskLevel = String(req.query.level);
    const attempts = await prisma.attempt.findMany({
      where,
      orderBy: { riskScore: "desc" },
      take: 200,
      include: {
        exam: { select: { title: true } },
        candidate: { include: { user: { select: { name: true, email: true } } } },
        _count: { select: { events: true } },
        events: { where: { reviewed: false, weightApplied: { gt: 0 } }, select: { id: true } },
      },
    });
    res.json(attempts.map(({ events, paper: _p, ...a }) => ({ ...a, unreviewed: events.length })));
  }),
);

proctoringRouter.get(
  "/attempts/:id",
  ah(async (req, res) => {
    const a = await prisma.attempt.findUnique({
      where: { id: req.params.id },
      include: {
        exam: { select: { id: true, title: true, durationMinutes: true, evidenceCapture: true, livePreview: true } },
        candidate: { include: { user: { select: { name: true, email: true } } } },
        events: { orderBy: { occurredAt: "asc" }, include: { reviewedBy: { select: { name: true } } } },
        evidence: { select: { id: true, kind: true, createdAt: true, expiresAt: true } },
      },
    });
    if (!a) throw notFound("Attempt");
    const consent = await prisma.consentRecord.findFirst({ where: { candidateId: a.candidateId, examId: a.examId }, orderBy: { acceptedAt: "desc" } });
    const { paper, ...rest } = a;
    const p = paper as unknown as Paper;
    res.json({ ...rest, totalQuestions: p.reduce((n, s) => n + s.questions.length, 0), consent, live: liveHub.statuses.get(a.id) ?? null });
  }),
);

proctoringRouter.get(
  "/evidence/:id",
  ah(async (req, res) => {
    const ev = await prisma.evidenceFile.findUnique({ where: { id: req.params.id } });
    if (!ev || !(await storage.exists(ev.storageKey))) throw notFound("Evidence");
    await audit(req, "evidence.view", "EvidenceFile", ev.id, { attemptId: ev.attemptId, kind: ev.kind });
    res.setHeader("Content-Type", ev.mimeType);
    res.setHeader("Cache-Control", "private, no-store");
    storage.stream(ev.storageKey).pipe(res);
  }),
);

proctoringRouter.delete(
  "/evidence/:id",
  requireSuperAdmin,
  ah(async (req, res) => {
    const ev = await prisma.evidenceFile.findUnique({ where: { id: req.params.id } });
    if (!ev) throw notFound("Evidence");
    await storage.remove(ev.storageKey);
    await prisma.evidenceFile.delete({ where: { id: ev.id } });
    await audit(req, "evidence.delete", "EvidenceFile", ev.id, { attemptId: ev.attemptId });
    res.json({ ok: true });
  }),
);

proctoringRouter.patch(
  "/events/:id",
  ah(async (req, res) => {
    const body = parse(z.object({ reviewed: z.boolean(), reviewNote: z.string().max(1000).optional().nullable() }), req.body);
    const ev = await prisma.proctorEvent.update({ where: { id: req.params.id }, data: { ...body, reviewedById: req.user!.id } });
    await audit(req, "proctor_event.review", "ProctorEvent", ev.id, body);
    res.json(ev);
  }),
);

proctoringRouter.post(
  "/attempts/:id/review-all",
  ah(async (req, res) => {
    const { reviewNote } = parse(z.object({ reviewNote: z.string().max(1000).optional().nullable() }), req.body);
    const r = await prisma.proctorEvent.updateMany({ where: { attemptId: req.params.id, reviewed: false }, data: { reviewed: true, reviewNote: reviewNote ?? undefined, reviewedById: req.user!.id } });
    await audit(req, "proctor_event.review_all", "Attempt", req.params.id, { count: r.count });
    res.json({ updated: r.count });
  }),
);

proctoringRouter.post(
  "/attempts/:id/message",
  ah(async (req, res) => {
    const { text } = parse(z.object({ text: z.string().trim().min(2).max(300) }), req.body);
    const a = await prisma.attempt.findUnique({ where: { id: req.params.id } });
    if (!a || a.status !== "IN_PROGRESS") throw badRequest("Attempt is not active");
    liveHub.io?.to(`attempt:${a.id}`).emit("proctor:message", { text, from: "Proctor", at: new Date().toISOString() });
    await audit(req, "proctor.message", "Attempt", a.id, { text });
    res.json({ ok: true });
  }),
);

// Human decision only: e.g. a technical problem or a reviewed malpractice decision
proctoringRouter.post(
  "/attempts/:id/force-submit",
  ah(async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(500) }), req.body);
    const a = await prisma.attempt.findUnique({ where: { id: req.params.id } });
    if (!a || a.status !== "IN_PROGRESS") throw badRequest("Attempt is not active");
    liveHub.io?.to(`attempt:${a.id}`).emit("proctor:message", { text: "Your examination has been submitted by the proctor.", from: "Proctor", at: new Date().toISOString() });
    await finalizeAttempt(a.id, false);
    await audit(req, "attempt.force_submit", "Attempt", a.id, { reason });
    res.json({ ok: true });
  }),
);

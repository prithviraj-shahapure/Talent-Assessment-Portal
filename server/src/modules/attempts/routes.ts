import { Router, type Request } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { prisma, type Attempt } from "../../lib/prisma";
import { ah, badRequest, clientIp, conflict, forbidden, notFound, parse } from "../../lib/http";
import { requireCandidate } from "../../middleware/auth";
import { imageUpload, sniff } from "../../middleware/upload";
import { buildPaper, deadlineFor, type Paper } from "../../lib/engine";
import { finalizeAttempt, syncSection } from "../../lib/attempts";
import { recordEvent } from "../../lib/risk";
import { getSettings, DEFAULT_RISK_RULES } from "../../lib/settings";
import { storage } from "../../lib/storage";
import { audit } from "../../lib/audit";
import { liveHub } from "../../sockets/hub";
import { SESSION_ACCESS_COOKIE, verifySessionAccessToken } from "../../lib/sessions";

export const attemptsRouter = Router();
attemptsRouter.use(requireCandidate);

const GRACE_MS = 5000; // network latency allowance for the final autosave

async function ownAttempt(req: Request, id: string) {
  const a = await prisma.attempt.findUnique({ where: { id }, include: { exam: true } });
  if (!a || a.candidateId !== req.user!.candidateId) throw notFound("Attempt");
  return a;
}

/** Finalises the attempt if its time is over; returns true when it is no longer writable. */
async function expireIfDue(a: Attempt & { exam: { id: string } }) {
  if (a.status !== "IN_PROGRESS") return true;
  const paper = a.paper as unknown as Paper;
  const last = paper.length - 1;
  const lastLimit = paper[last]?.timeLimitMinutes;
  const sectionOver = a.currentSection === last && lastLimit && a.sectionStartedAt && Date.now() > a.sectionStartedAt.getTime() + lastLimit * 60_000 + GRACE_MS;
  if (Date.now() > a.deadlineAt.getTime() + GRACE_MS || sectionOver) {
    await finalizeAttempt(a.id, true);
    return true;
  }
  return false;
}

// ───────────── Start ─────────────
attemptsRouter.post(
  "/start",
  ah(async (req, res) => {
    const body = parse(
      z.object({
        examId: z.string(),
        consent: z.object({ webcam: z.boolean(), microphone: z.boolean(), evidence: z.boolean(), privacyNotice: z.literal(true) }),
        clientInfo: z.record(z.unknown()).optional(),
      }),
      req.body,
    );
    const candidateId = req.user!.candidateId!;
    if (!req.user!.emailVerified) throw forbidden("Verify your email address before starting an examination");
    const assignment = await prisma.examAssignment.findUnique({ where: { examId_candidateId: { examId: body.examId, candidateId } }, include: { exam: true } });
    if (!assignment) throw notFound("Examination");
    const exam = assignment.exam;
    const now = new Date();
    if (exam.status !== "PUBLISHED") throw badRequest("This examination is not open");
    if (now < exam.startAt) throw badRequest(`This examination opens at ${exam.startAt.toLocaleString("en-IN")}`);
    if (now > exam.endAt) throw badRequest("This examination window has closed");

    const existing = await prisma.attempt.findFirst({ where: { examId: exam.id, candidateId, status: "IN_PROGRESS" }, include: { exam: true } });
    if (existing && !(await expireIfDue(existing))) return res.json({ attemptId: existing.id, resumed: true });

    // ── Session Code Verification Gate Enforcement ──
    const token = (req.cookies[SESSION_ACCESS_COOKIE] as string) || (req.headers["x-session-token"] as string);
    let verifiedSessionId: string | null = null;

    if (token) {
      const payload = verifySessionAccessToken(token);
      if (payload && payload.examId === exam.id && payload.candidateId === candidateId) {
        const s = await prisma.examSession.findUnique({ where: { id: payload.sessionId } });
        if (s) {
          if (s.status === "REVOKED") {
            throw forbidden("This examination session has been revoked by HR.");
          }
          if (s.status === "PAUSED") {
            throw forbidden("Examination Currently Paused by HR. Please wait for resumption.");
          }
          if (s.status === "EXPIRED" || now > s.endsAt) {
            throw forbidden("Examination session has expired.");
          }
          verifiedSessionId = s.id;
        }
      }
    }

    if (!verifiedSessionId) {
      const activeSessionCand = await prisma.sessionCandidate.findFirst({
        where: {
          candidateId,
          session: {
            examId: exam.id,
            status: { in: ["ACTIVE", "SCHEDULED"] },
            endsAt: { gt: now },
          },
        },
        include: { session: true },
        orderBy: { joinedAt: "desc" },
      });

      if (activeSessionCand && activeSessionCand.joinedAt) {
        verifiedSessionId = activeSessionCand.sessionId;
      }
    }

    if (!verifiedSessionId) {
      await prisma.auditLog.create({
        data: {
          action: "attempt.session_gate_rejected",
          entity: "Exam",
          entityId: exam.id,
          userId: req.user!.id,
          details: { reason: "Missing or invalid session verification token", examTitle: exam.title },
          ipAddress: clientIp(req),
        },
      });
      throw forbidden("Session Code verification is required before starting this examination. Please enter your session code.");
    }

    const used = await prisma.attempt.count({ where: { examId: exam.id, candidateId } });
    if (used >= exam.maxAttempts + assignment.extraAttempts) throw badRequest("You have used all permitted attempts for this examination");

    const accommodation = await prisma.accommodationRequest.findFirst({ where: { examId: exam.id, candidateId, status: "APPROVED" }, orderBy: { updatedAt: "desc" } });
    const needWebcam = exam.proctoringEnabled && exam.requireWebcam && !accommodation?.waiveWebcam;
    const needMic = exam.proctoringEnabled && exam.requireMicrophone && !accommodation?.waiveMicrophone;
    if (needWebcam && !body.consent.webcam) throw badRequest("Webcam consent is required for this examination");
    if (needMic && !body.consent.microphone) throw badRequest("Microphone consent is required for this examination");

    const settings = await getSettings();
    await prisma.consentRecord.create({
      data: {
        candidateId,
        examId: exam.id,
        policyVersion: settings.privacyPolicyVersion,
        webcam: body.consent.webcam,
        microphone: body.consent.microphone,
        evidence: exam.evidenceCapture && body.consent.evidence,
        ipAddress: clientIp(req),
        userAgent: req.get("user-agent")?.slice(0, 300),
      },
    });

    const { paper, maxScore } = await buildPaper(exam.id);
    const durationMs = (exam.durationMinutes + assignment.extraMinutes) * 60_000;
    const deadlineAt = new Date(Math.min(now.getTime() + durationMs, exam.endAt.getTime()));

    // Check if candidate is associated with an active session for this exam
    const sessionCandidate = await prisma.sessionCandidate.findFirst({
      where: { candidateId, session: { examId: exam.id } },
      include: { session: true },
      orderBy: { invitedAt: "desc" },
    });

    let attempt: Attempt;
    try {
      attempt = await prisma.attempt.create({
        data: {
          examId: exam.id,
          candidateId,
          sessionId: verifiedSessionId || sessionCandidate?.sessionId || null,
          attemptNo: used + 1,
          deadlineAt,
          paper: paper as unknown as object,
          maxScore,
          sectionStartedAt: now,
          clientInfo: { ...(body.clientInfo ?? {}), webcamRequired: needWebcam, microphoneRequired: needMic, evidenceConsent: exam.evidenceCapture && body.consent.evidence } as object,
          ipAddress: clientIp(req),
        },
      });

      if (sessionCandidate) {
        await prisma.sessionCandidate.update({
          where: { id: sessionCandidate.id },
          data: { accessStatus: "APPEARING", attemptsUsed: { increment: 1 } },
        });
        await prisma.sessionAuditLog.create({
          data: {
            sessionId: sessionCandidate.sessionId,
            candidateId,
            eventType: "ATTEMPT_STARTED",
            metadata: { attemptId: attempt.id, attemptNo: attempt.attemptNo },
            ipAddress: clientIp(req),
          },
        });
      }
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") throw conflict("An attempt was just started in another window. Refresh the page.");
      throw e;
    }
    await audit(req, "attempt.start", "Attempt", attempt.id, { examId: exam.id, attemptNo: attempt.attemptNo });
    res.status(201).json({ attemptId: attempt.id, resumed: false });
  }),
);

// ───────────── State (questions without answers keys) ─────────────
attemptsRouter.get(
  "/:id/state",
  ah(async (req, res) => {
    let a = await ownAttempt(req, req.params.id);
    if (a.status === "IN_PROGRESS") {
      const finished = await expireIfDue(a);
      if (!finished) {
        const s = await syncSection(a);
        a = { ...a, ...s };
      }
    }
    const fresh = await prisma.attempt.findUniqueOrThrow({ where: { id: a.id }, include: { exam: true, answers: true, sectionAttempts: true, evidence: { where: { kind: "VERIFICATION_PHOTO" }, select: { id: true } } } });
    const paper = fresh.paper as unknown as Paper;
    const curInfo = ((fresh.clientInfo ?? {}) as Record<string, unknown>);
    const info = curInfo as { webcamRequired?: boolean; microphoneRequired?: boolean; evidenceConsent?: boolean; autoSubmittedReason?: string; multiFaceViolations?: number };
    const multiFaceCount = await prisma.proctorEvent.count({ where: { attemptId: a.id, type: "MULTIPLE_FACES" } });
    const autoSubmittedReason = (info.autoSubmittedReason ?? (fresh.status === "AUTO_SUBMITTED" ? "TIME_UP" : null)) as string | null;
    const base = {
      id: fresh.id,
      status: fresh.status,
      serverNow: new Date().toISOString(),
      multiFaceCount,
      autoSubmittedReason,
      exam: {
        id: fresh.exam.id,
        title: fresh.exam.title,
        proctoringEnabled: fresh.exam.proctoringEnabled,
        requireWebcam: !!info.webcamRequired,
        requireMicrophone: !!info.microphoneRequired,
        requireFullscreen: fresh.exam.requireFullscreen,
        evidenceCapture: !!info.evidenceConsent,
        livePreview: fresh.exam.livePreview,
        negativeMarking: fresh.exam.negativeMarking,
        sectionTimeLimits: fresh.exam.sectionTimeLimits,
      },
    };

    if (fresh.status === "TERMINATED") {
      return res.json({
        ...base,
        finished: true,
        isTerminated: true,
        terminatedReason: fresh.terminatedReason || "Your examination has been terminated by an administrator.",
      });
    }

    if (fresh.status !== "IN_PROGRESS" && fresh.status !== "PAUSED") {
      return res.json({
        ...base,
        finished: true,
        submissionMethod: fresh.submissionMethod ?? (fresh.status === "ADMIN_SUBMITTED" ? "ADMIN_FORCE" : "CANDIDATE"),
      });
    }

    const isPaused = fresh.status === "PAUSED";
    const verificationDone = fresh.evidence.length > 0 || !info.webcamRequired;
    const { sectionDeadline } = deadlineFor(fresh, paper);

    // If paused, deadline times reflect frozen remaining seconds
    const nowMs = Date.now();
    const effectiveDeadlineAt = isPaused && fresh.remainingSecondsAtPause != null
      ? new Date(nowMs + fresh.remainingSecondsAtPause * 1000).toISOString()
      : fresh.deadlineAt.toISOString();

    const effectiveSectionDeadlineAt = isPaused
      ? (fresh.sectionRemainingSecondsAtPause != null ? new Date(nowMs + fresh.sectionRemainingSecondsAtPause * 1000).toISOString() : null)
      : (sectionDeadline?.toISOString() ?? null);

    const qIds = paper.flatMap((s) => s.questions.map((q) => q.questionId));
    // Correct answers, accepted answers and explanations are never selected here.
    const questions = await prisma.question.findMany({
      where: { id: { in: qIds } },
      select: { id: true, type: true, text: true, codeLanguage: true, codeStarter: true, negativeMarks: true, options: { select: { id: true, text: true } } },
    });
    const qMap = new Map(questions.map((q) => [q.id, q]));
    const ansMap = new Map(fresh.answers.map((x) => [x.questionId, x]));

    res.json({
      ...base,
      finished: false,
      isPaused,
      pausedAt: fresh.pausedAt?.toISOString() ?? null,
      remainingSecondsAtPause: fresh.remainingSecondsAtPause,
      sectionRemainingSecondsAtPause: fresh.sectionRemainingSecondsAtPause,
      verificationDone,
      deadlineAt: effectiveDeadlineAt,
      sectionDeadlineAt: effectiveSectionDeadlineAt,
      currentSection: fresh.currentSection,
      currentQuestion: fresh.currentQuestion,
      sections: paper.map((s, si) => {
        const secAttempt = fresh.sectionAttempts.find((sa) => sa.sectionIndex === si);
        const isLocked = fresh.exam.sectionTimeLimits ? si !== fresh.currentSection : false;
        const isCompleted = si < fresh.currentSection || secAttempt?.status === "COMPLETED" || secAttempt?.status === "EXPIRED";
        const isCurrent = si === fresh.currentSection;
        return {
          index: si,
          title: s.title,
          timeLimitMinutes: s.timeLimitMinutes,
          passingMarks: s.passingMarks,
          negativeMarks: s.negativeMarks,
          instructions: s.instructions,
          status: isCurrent ? "ACTIVE" : isCompleted ? "COMPLETED" : "LOCKED",
          locked: isLocked,
          questions:
            fresh.exam.sectionTimeLimits && si !== fresh.currentSection
              ? s.questions.map((pq) => ({ id: pq.questionId, hidden: true, answered: ansMap.has(pq.questionId) && isAnswered(ansMap.get(pq.questionId)!) }))
              : s.questions.map((pq) => {
                  const q = qMap.get(pq.questionId)!;
                  const ans = ansMap.get(pq.questionId);
                  const optionsById = new Map(q.options.map((o) => [o.id, o]));
                  return {
                    id: q.id,
                    type: q.type,
                    text: q.text,
                    marks: pq.marks,
                    negativeMarks: fresh.exam.negativeMarking ? q.negativeMarks : 0,
                    codeLanguage: q.codeLanguage,
                    codeStarter: q.codeStarter,
                    options: pq.optionOrder.map((id) => ({ id, text: optionsById.get(id)?.text ?? "" })),
                    answer: ans ? { selectedOptionIds: ans.selectedOptionIds, textAnswer: ans.textAnswer, markedForReview: ans.markedForReview } : null,
                  };
                }),
        };
      }),
    });
  }),
);
const isAnswered = (a: { selectedOptionIds: string[]; textAnswer: string | null }) => a.selectedOptionIds.length > 0 || !!a.textAnswer?.trim();

// ───────────── Autosave ─────────────
const answerSchema = z.object({
  questionId: z.string(),
  selectedOptionIds: z.array(z.string()).max(10).default([]),
  textAnswer: z.string().max(30000).nullable().optional(),
  markedForReview: z.boolean().default(false),
  clientSavedAt: z.coerce.date().optional(),
});

const saveLimiter = rateLimit({ windowMs: 60_000, limit: 240, keyGenerator: (req) => req.user?.id ?? clientIp(req), standardHeaders: true, legacyHeaders: false });

attemptsRouter.put(
  "/:id/answers",
  saveLimiter,
  ah(async (req, res) => {
    const { answers } = parse(z.object({ answers: z.array(answerSchema).min(1).max(200) }), req.body);
    const a = await ownAttempt(req, req.params.id);
    if (a.status === "PAUSED") {
      return res.json({
        saved: [],
        rejected: answers.map((x) => ({ questionId: x.questionId, reason: "Examination is currently paused by administrator." })),
        isPaused: true,
        serverNow: new Date().toISOString(),
      });
    }
    if (a.status === "TERMINATED") {
      throw forbidden("Examination has been terminated by administrator.");
    }
    if (await expireIfDue(a)) throw conflict("This attempt has already been submitted");
    const { currentSection } = await syncSection(a);
    const paper = a.paper as unknown as Paper;
    const allowed = new Map<string, number>();
    paper.forEach((s, si) => s.questions.forEach((q) => allowed.set(q.questionId, si)));
    const questions = await prisma.question.findMany({ where: { id: { in: answers.map((x) => x.questionId) } }, select: { id: true, type: true, options: { select: { id: true } } } });
    const qMap = new Map(questions.map((q) => [q.id, q]));
    const saved: string[] = [];
    const rejected: { questionId: string; reason: string }[] = [];
    for (const ans of answers) {
      const si = allowed.get(ans.questionId);
      const q = qMap.get(ans.questionId);
      if (si === undefined || !q) {
        rejected.push({ questionId: ans.questionId, reason: "Not part of this paper" });
        continue;
      }
      if (a.exam.sectionTimeLimits && si !== currentSection) {
        rejected.push({ questionId: ans.questionId, reason: "Section is closed" });
        continue;
      }
      const validOpts = new Set(q.options.map((o) => o.id));
      const sel = [...new Set(ans.selectedOptionIds)].filter((id) => validOpts.has(id));
      if ((q.type === "SINGLE" || q.type === "TRUE_FALSE") && sel.length > 1) {
        rejected.push({ questionId: ans.questionId, reason: "Only one option may be selected" });
        continue;
      }
      const data = { selectedOptionIds: sel, textAnswer: ans.textAnswer ?? null, markedForReview: ans.markedForReview, savedAt: new Date() };
      await prisma.answer.upsert({ where: { attemptId_questionId: { attemptId: a.id, questionId: q.id } }, create: { attemptId: a.id, questionId: q.id, ...data }, update: data });
      saved.push(q.id);
    }
    const answeredCount = await prisma.answer.count({ where: { attemptId: a.id, OR: [{ selectedOptionIds: { isEmpty: false } }, { textAnswer: { not: null } }] } });
    liveHub.update(a.id, { answered: answeredCount });
    res.json({ saved, rejected, serverNow: new Date().toISOString() });
  }),
);

attemptsRouter.post(
  "/:id/position",
  ah(async (req, res) => {
    const { currentQuestion } = parse(z.object({ currentQuestion: z.number().int().min(0).max(1000) }), req.body);
    const a = await ownAttempt(req, req.params.id);
    if (a.status !== "IN_PROGRESS") return res.json({ ok: false });
    await prisma.attempt.update({ where: { id: a.id }, data: { currentQuestion, lastSeenAt: new Date() } });
    liveHub.update(a.id, { currentQuestion });
    res.json({ ok: true });
  }),
);

attemptsRouter.post(
  "/:id/next-section",
  ah(async (req, res) => {
    const a = await ownAttempt(req, req.params.id);
    if (a.status === "PAUSED") {
      throw conflict("Examination is currently paused by administrator.");
    }
    if (a.status === "TERMINATED") {
      throw forbidden("Examination has been terminated by administrator.");
    }
    if (await expireIfDue(a)) throw conflict("This attempt has already been submitted");
    const { currentSection } = await syncSection(a);
    const paper = a.paper as unknown as Paper;
    if (!a.exam.sectionTimeLimits) throw badRequest("Sections are not timed in this examination");
    if (currentSection >= paper.length - 1) throw badRequest("This is the last section");

    const now = new Date();
    // Mark previous section as completed
    await prisma.candidateSectionAttempt.upsert({
      where: { attemptId_sectionIndex: { attemptId: a.id, sectionIndex: currentSection } },
      create: {
        attemptId: a.id,
        sectionIndex: currentSection,
        sectionId: paper[currentSection].sectionId,
        sectionTitle: paper[currentSection].title,
        status: "COMPLETED",
        submittedAt: now,
      },
      update: {
        status: "COMPLETED",
        submittedAt: now,
      },
    });

    const nextIndex = currentSection + 1;
    const nextSec = paper[nextIndex];
    // Activate next section with independent timer
    await prisma.candidateSectionAttempt.upsert({
      where: { attemptId_sectionIndex: { attemptId: a.id, sectionIndex: nextIndex } },
      create: {
        attemptId: a.id,
        sectionIndex: nextIndex,
        sectionId: nextSec.sectionId,
        sectionTitle: nextSec.title,
        status: "ACTIVE",
        timeLimitMinutes: nextSec.timeLimitMinutes,
        startedAt: now,
        deadlineAt: nextSec.timeLimitMinutes ? new Date(now.getTime() + nextSec.timeLimitMinutes * 60_000) : null,
      },
      update: {
        status: "ACTIVE",
        startedAt: now,
        deadlineAt: nextSec.timeLimitMinutes ? new Date(now.getTime() + nextSec.timeLimitMinutes * 60_000) : null,
      },
    });

    await prisma.attempt.update({ where: { id: a.id }, data: { currentSection: nextIndex, sectionStartedAt: now, currentQuestion: 0 } });
    res.json({ currentSection: nextIndex });
  }),
);

// ───────────── Submit (idempotent) ─────────────
attemptsRouter.post(
  "/:id/submit",
  ah(async (req, res) => {
    const a = await ownAttempt(req, req.params.id);
    if (a.status === "IN_PROGRESS") {
      const reason = req.body?.reason;
      const isMultiFace = reason === "MULTIPLE_FACES";
      const auto = isMultiFace || reason === "TIME_UP";
      if (isMultiFace) {
        const curInfo = ((a.clientInfo ?? {}) as Record<string, unknown>);
        await prisma.attempt.update({
          where: { id: a.id },
          data: { clientInfo: { ...curInfo, autoSubmittedReason: "MULTIPLE_FACES" } },
        });
      }
      await finalizeAttempt(a.id, auto);
      await audit(
        req,
        isMultiFace
          ? "attempt.auto_submit_multiple_faces"
          : auto
          ? "attempt.auto_submit_client"
          : "attempt.submit",
        "Attempt",
        a.id,
        isMultiFace ? { reason: "MULTIPLE_FACES" } : undefined,
      );
    }
    const done = await prisma.attempt.findUniqueOrThrow({ where: { id: a.id }, select: { id: true, status: true, submittedAt: true } });
    res.json(done);
  }),
);

// ───────────── Proctoring: events & evidence ─────────────
const KNOWN_EVENTS = new Set([...Object.keys(DEFAULT_RISK_RULES), "FACE_RETURNED", "CAMERA_RECONNECTED", "MIC_RECONNECTED", "FULLSCREEN_ENTERED", "FOCUS_RETURNED", "SESSION_RESUMED", "DETECTOR_UNAVAILABLE", "PERMISSION_DENIED"]);

const eventLimiter = rateLimit({ windowMs: 60_000, limit: 120, keyGenerator: (req) => req.user?.id ?? clientIp(req), standardHeaders: true, legacyHeaders: false });

attemptsRouter.post(
  "/:id/events",
  eventLimiter,
  ah(async (req, res) => {
    const { events } = parse(
      z.object({
        events: z
          .array(z.object({ type: z.string().max(40), occurredAt: z.coerce.date(), message: z.string().max(300).optional(), meta: z.record(z.unknown()).optional(), evidenceId: z.string().optional().nullable() }))
          .min(1)
          .max(50),
      }),
      req.body,
    );
    const a = await ownAttempt(req, req.params.id);
    if (a.status !== "IN_PROGRESS" && Date.now() - (a.submittedAt?.getTime() ?? 0) > 60_000) return res.json({ accepted: 0 });
    let accepted = 0;
    let last: { riskScore: number; riskLevel: string } | null = null;
    for (const ev of events) {
      if (!KNOWN_EVENTS.has(ev.type)) continue;
      // Never trust client timestamps beyond the attempt window
      const t = Math.min(Math.max(ev.occurredAt.getTime(), a.startedAt.getTime()), Date.now());
      if (ev.evidenceId) {
        const owns = await prisma.evidenceFile.count({ where: { id: ev.evidenceId, attemptId: a.id } });
        if (!owns) ev.evidenceId = null;
      }
      const r = await recordEvent(a.id, { type: ev.type, message: ev.message, occurredAt: new Date(t), meta: ev.meta, evidenceId: ev.evidenceId });
      accepted++;
      last = r;

      if (ev.type === "MULTIPLE_FACES") {
        const multiCount = await prisma.proctorEvent.count({ where: { attemptId: a.id, type: "MULTIPLE_FACES" } });
        const curInfo = ((a.clientInfo ?? {}) as Record<string, unknown>);
        const isAutoSubmit = multiCount >= 3;

        await prisma.attempt.update({
          where: { id: a.id },
          data: {
            clientInfo: {
              ...curInfo,
              multiFaceViolations: multiCount,
              ...(isAutoSubmit ? { autoSubmittedReason: "MULTIPLE_FACES" } : {}),
            },
          },
        });

        liveHub.update(a.id, { multiFaceViolations: multiCount });

        liveHub.event(a.examId, a.id, {
          id: r.event.id,
          type: r.event.type,
          severity: isAutoSubmit ? "HIGH" : r.event.severity,
          message: isAutoSubmit
            ? "3rd Multiple Face Detection: Examination auto-submitted (total 3 detections reached)"
            : `Multiple faces detected (Warning ${multiCount}/2)`,
          occurredAt: r.event.occurredAt,
          weightApplied: r.event.weightApplied,
          riskScore: r.riskScore,
          riskLevel: r.riskLevel,
          hasEvidence: !!r.event.evidenceId,
          multiFaceViolations: multiCount,
          autoSubmitted: isAutoSubmit,
        });

        if (isAutoSubmit) {
          const freshAttempt = await prisma.attempt.findUnique({ where: { id: a.id } });
          if (freshAttempt && freshAttempt.status === "IN_PROGRESS") {
            await finalizeAttempt(a.id, true);
            await audit(req, "attempt.auto_submit_multiple_faces", "Attempt", a.id, { violationCount: multiCount });
          }
        }
      } else if (["SCREENSHOT_ATTEMPT", "SNIPPING_TOOL_DETECTED", "SCREEN_CAPTURE_DETECTED"].includes(ev.type)) {
        const screenshotCount = await prisma.proctorEvent.count({
          where: { attemptId: a.id, type: { in: ["SCREENSHOT_ATTEMPT", "SNIPPING_TOOL_DETECTED", "SCREEN_CAPTURE_DETECTED"] } },
        });
        liveHub.update(a.id, { screenshotViolations: screenshotCount });
        liveHub.event(a.examId, a.id, {
          id: r.event.id,
          type: r.event.type,
          severity: r.event.severity,
          message: r.event.message,
          occurredAt: r.event.occurredAt,
          weightApplied: r.event.weightApplied,
          riskScore: r.riskScore,
          riskLevel: r.riskLevel,
          hasEvidence: !!r.event.evidenceId,
          screenshotViolations: screenshotCount,
        });
      } else {
        liveHub.event(a.examId, a.id, {
          id: r.event.id,
          type: r.event.type,
          severity: r.event.severity,
          message: r.event.message,
          occurredAt: r.event.occurredAt,
          weightApplied: r.event.weightApplied,
          riskScore: r.riskScore,
          riskLevel: r.riskLevel,
          hasEvidence: !!r.event.evidenceId,
        });
      }
    }
    res.json({ accepted, ...(last ?? {}) });
  }),
);

attemptsRouter.post(
  "/:id/evidence",
  imageUpload.single("image"),
  ah(async (req, res) => {
    const { kind } = parse(z.object({ kind: z.enum(["VERIFICATION_PHOTO", "SNAPSHOT"]) }), req.body);
    const a = await ownAttempt(req, req.params.id);
    if (a.status !== "IN_PROGRESS") throw conflict("This attempt is no longer active");
    if (!req.file) throw badRequest("Image missing");
    const ext = sniff(req.file.buffer);
    if (!ext || !["jpg", "png", "webp"].includes(ext)) throw badRequest("Invalid image");
    const info = (a.clientInfo ?? {}) as { evidenceConsent?: boolean };
    if (kind === "SNAPSHOT" && !info.evidenceConsent) throw forbidden("Evidence capture is not enabled or consented for this attempt");
    if (kind === "SNAPSHOT") {
      const count = await prisma.evidenceFile.count({ where: { attemptId: a.id, kind: "SNAPSHOT" } });
      if (count >= 60) throw badRequest("Evidence limit reached for this attempt");
    } else {
      const has = await prisma.evidenceFile.count({ where: { attemptId: a.id, kind: "VERIFICATION_PHOTO" } });
      if (has) throw conflict("Verification photo already captured");
    }
    const settings = await getSettings();
    const days = kind === "SNAPSHOT" ? settings.evidenceRetentionDays : settings.verificationPhotoRetentionDays;
    const key = await storage.put(kind === "SNAPSHOT" ? "evidence" : "verification", req.file.buffer, ext);
    const ev = await prisma.evidenceFile.create({
      data: { attemptId: a.id, kind, storageKey: key, mimeType: req.file.mimetype, sizeBytes: req.file.size, expiresAt: new Date(Date.now() + days * 86400_000) },
    });
    res.status(201).json({ id: ev.id });
  }),
);

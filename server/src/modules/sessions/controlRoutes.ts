import { Router } from "express";
import { z } from "zod";
import { prisma, type SessionStatus } from "../../lib/prisma";
import { ah, badRequest, clientIp, forbidden, notFound, parse } from "../../lib/http";
import { requireStaff, requireSuperAdmin } from "../../middleware/auth";
import { audit } from "../../lib/audit";
import { liveHub } from "../../sockets/hub";
import {
  allowAttemptReentry,
  forceSubmitAttempt,
  pauseAttempt,
  resumeAttempt,
  terminateAttempt,
} from "../../lib/sessionControl";

export const sessionControlRouter = Router();
sessionControlRouter.use(requireStaff);

// ─────────────────────────────────────────────────────────────────────────────
// SESSION LIVE CONTROL DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Live control metrics and candidate telemetry for a session.
 */
sessionControlRouter.get(
  "/:id/live-control",
  ah(async (req, res) => {
    const session = await prisma.examSession.findUnique({
      where: { id: req.params.id },
      include: {
        exam: {
          include: {
            sections: { orderBy: { order: "asc" } },
          },
        },
        createdBy: { select: { name: true, email: true } },
      },
    });

    if (!session) throw notFound("Session");

    // Fetch all candidates mapped to this session
    const sessionCandidates = await prisma.sessionCandidate.findMany({
      where: { sessionId: session.id },
      include: {
        candidate: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    // Fetch all attempts associated with this exam and candidates in this session
    const attempts = await prisma.attempt.findMany({
      where: {
        examId: session.examId,
        candidateId: { in: sessionCandidates.map((sc) => sc.candidateId) },
      },
      include: {
        answers: { select: { questionId: true, selectedOptionIds: true, textAnswer: true } },
        events: { select: { type: true, occurredAt: true } },
      },
      orderBy: { startedAt: "desc" },
    });

    const now = new Date();
    const candidateRows = sessionCandidates.map((sc) => {
      const candAttempts = attempts.filter((a) => a.candidateId === sc.candidateId);
      const latestAttempt = candAttempts[0] || null;

      let examStatus = "NOT_STARTED";
      let timeRemainingSec: number | null = null;
      let currentSectionTitle = "—";

      if (latestAttempt) {
        if (latestAttempt.status === "PAUSED") {
          examStatus = "PAUSED";
          timeRemainingSec = latestAttempt.remainingSecondsAtPause ?? 0;
        } else if (["SUBMITTED", "AUTO_SUBMITTED", "ADMIN_SUBMITTED", "EVALUATED"].includes(latestAttempt.status)) {
          examStatus = latestAttempt.status;
        } else if (latestAttempt.status === "TERMINATED") {
          examStatus = "TERMINATED";
        } else if (latestAttempt.lastSeenAt && (now.getTime() - latestAttempt.lastSeenAt.getTime()) > 90_000) {
          examStatus = "DISCONNECTED";
          timeRemainingSec = Math.max(0, Math.floor((latestAttempt.deadlineAt.getTime() - now.getTime()) / 1000));
        } else {
          examStatus = "ACTIVE";
          timeRemainingSec = Math.max(0, Math.floor((latestAttempt.deadlineAt.getTime() - now.getTime()) / 1000));
        }

        const paper: any = latestAttempt.paper;
        if (Array.isArray(paper) && paper[latestAttempt.currentSection]) {
          currentSectionTitle = paper[latestAttempt.currentSection].title;
        }
      }

      return {
        candidateId: sc.candidateId,
        candidateProfileId: sc.candidate.id,
        name: sc.candidate.user.name,
        email: sc.candidate.user.email,
        mobile: sc.candidate.mobile,
        college: sc.candidate.college,
        branch: sc.candidate.branch,
        accessStatus: sc.accessStatus,
        examStatus,
        attemptId: latestAttempt?.id || null,
        attemptNo: latestAttempt?.attemptNo || 0,
        currentSection: currentSectionTitle,
        currentSectionIdx: latestAttempt?.currentSection ?? 0,
        timeRemainingSec,
        answeredCount: latestAttempt?.answers.filter((x) => x.selectedOptionIds.length > 0 || !!x.textAnswer?.trim()).length || 0,
        proctoringStatus: latestAttempt ? (latestAttempt.riskLevel === "NORMAL" ? "CLEAR" : `FLAGGED (${latestAttempt.riskLevel})`) : "INACTIVE",
        riskScore: latestAttempt?.riskScore || 0,
        lastActivity: latestAttempt?.lastSeenAt || sc.joinedAt || sc.invitedAt,
        reentryCount: latestAttempt?.reentryCount || 0,
      };
    });

    const metrics = {
      totalRegistered: sessionCandidates.length,
      joined: candidateRows.filter((c) => c.accessStatus !== "INVITED").length,
      currentlyActive: candidateRows.filter((c) => c.examStatus === "ACTIVE").length,
      paused: candidateRows.filter((c) => c.examStatus === "PAUSED").length,
      submitted: candidateRows.filter((c) => ["SUBMITTED", "AUTO_SUBMITTED", "ADMIN_SUBMITTED", "EVALUATED"].includes(c.examStatus)).length,
      disconnected: candidateRows.filter((c) => c.examStatus === "DISCONNECTED").length,
      terminated: candidateRows.filter((c) => c.examStatus === "TERMINATED").length,
    };

    res.json({
      session,
      metrics,
      candidates: candidateRows,
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// SESSION LEVEL ACTIONS (PAUSE, RESUME, TERMINATE, RECOVER)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pause entire examination session:
 * Freezes timers for all currently active candidate attempts, locks new candidate entries.
 */
sessionControlRouter.post(
  "/:id/pause",
  ah(async (req, res) => {
    const session = await prisma.examSession.findUnique({ where: { id: req.params.id } });
    if (!session) throw notFound("Session");
    if (session.status === "PAUSED") throw badRequest("Session is already paused");
    if (session.status === "TERMINATED") throw badRequest("Cannot pause a terminated session");

    const reason = req.body?.reason ? String(req.body.reason).trim() : "Administrative session pause";
    const now = new Date();

    // 1. Update session status
    await prisma.examSession.update({
      where: { id: session.id },
      data: { status: "PAUSED", pausedAt: now },
    });

    // 2. Pause all in-progress attempts in this session
    const activeAttempts = await prisma.attempt.findMany({
      where: {
        sessionId: session.id,
        status: "IN_PROGRESS",
      },
    });

    let pausedCount = 0;
    for (const att of activeAttempts) {
      try {
        await pauseAttempt(att.id, req.user!.id, reason, clientIp(req));
        pausedCount++;
      } catch {
        // Skip individual errors
      }
    }

    await prisma.adminActionAuditLog.create({
      data: {
        adminId: req.user!.id,
        sessionId: session.id,
        examId: session.examId,
        actionType: "SESSION_PAUSE",
        actionReason: reason,
        previousStatus: session.status,
        newStatus: "PAUSED",
        metadata: { pausedAttempts: pausedCount },
        ipAddress: clientIp(req),
      },
    });

    await audit(req, "session.pause", "ExamSession", session.id, { pausedAttempts: pausedCount });
    liveHub.sessionPaused(session.id, session.examId, reason);

    res.json({ success: true, status: "PAUSED", pausedAttempts: pausedCount });
  })
);

/**
 * Resume entire examination session:
 * Reactivates session and resumes timers for all paused candidates.
 */
sessionControlRouter.post(
  "/:id/resume",
  ah(async (req, res) => {
    const session = await prisma.examSession.findUnique({ where: { id: req.params.id } });
    if (!session) throw notFound("Session");
    if (session.status !== "PAUSED") throw badRequest("Session is not paused");

    const reason = req.body?.reason ? String(req.body.reason).trim() : "Administrative session resume";

    // 1. Reactivate session
    await prisma.examSession.update({
      where: { id: session.id },
      data: { status: "ACTIVE", pausedAt: null },
    });

    // 2. Resume all paused attempts in this session
    const pausedAttempts = await prisma.attempt.findMany({
      where: {
        sessionId: session.id,
        status: "PAUSED",
      },
    });

    let resumedCount = 0;
    for (const att of pausedAttempts) {
      try {
        await resumeAttempt(att.id, req.user!.id, reason, clientIp(req));
        resumedCount++;
      } catch {
        // Skip individual failures
      }
    }

    await prisma.adminActionAuditLog.create({
      data: {
        adminId: req.user!.id,
        sessionId: session.id,
        examId: session.examId,
        actionType: "SESSION_RESUME",
        actionReason: reason,
        previousStatus: "PAUSED",
        newStatus: "ACTIVE",
        metadata: { resumedAttempts: resumedCount },
        ipAddress: clientIp(req),
      },
    });

    await audit(req, "session.resume", "ExamSession", session.id, { resumedAttempts: resumedCount });
    liveHub.sessionResumed(session.id, session.examId);

    res.json({ success: true, status: "ACTIVE", resumedAttempts: resumedCount });
  })
);

/**
 * Terminate entire examination session:
 * Permanently locks and stops all active attempts in this session with mandatory reason.
 */
sessionControlRouter.post(
  "/:id/terminate",
  ah(async (req, res) => {
    const session = await prisma.examSession.findUnique({ where: { id: req.params.id } });
    if (!session) throw notFound("Session");
    if (session.status === "TERMINATED") throw badRequest("Session is already terminated");

    const { reason } = parse(z.object({ reason: z.string().trim().min(3) }), req.body);
    const now = new Date();

    // 1. Mark session as terminated
    await prisma.examSession.update({
      where: { id: session.id },
      data: {
        status: "TERMINATED",
        terminatedAt: now,
        terminatedById: req.user!.id,
        terminatedReason: reason,
      },
    });

    // 2. Terminate all active and paused attempts in this session
    const ongoingAttempts = await prisma.attempt.findMany({
      where: {
        sessionId: session.id,
        status: { in: ["IN_PROGRESS", "PAUSED"] },
      },
    });

    for (const att of ongoingAttempts) {
      try {
        await terminateAttempt(att.id, req.user!.id, `Session terminated: ${reason}`, clientIp(req));
      } catch {
        // Skip
      }
    }

    await prisma.adminActionAuditLog.create({
      data: {
        adminId: req.user!.id,
        sessionId: session.id,
        examId: session.examId,
        actionType: "SESSION_TERMINATE",
        actionReason: reason,
        previousStatus: session.status,
        newStatus: "TERMINATED",
        metadata: { terminatedAttempts: ongoingAttempts.length },
        ipAddress: clientIp(req),
      },
    });

    await audit(req, "session.terminate", "ExamSession", session.id, { reason });
    liveHub.sessionTerminated(session.id, session.examId, reason);

    res.json({ success: true, status: "TERMINATED", terminatedAttempts: ongoingAttempts.length });
  })
);

/**
 * Super Admin Recovery of a terminated session.
 * Reopens session, restores eligible non-submitted attempts.
 */
sessionControlRouter.post(
  "/:id/recover",
  requireSuperAdmin,
  ah(async (req, res) => {
    const session = await prisma.examSession.findUnique({ where: { id: req.params.id } });
    if (!session) throw notFound("Session");
    if (session.status !== "TERMINATED") throw badRequest("Only terminated sessions can be recovered");

    const { reason, extendMinutes } = parse(
      z.object({
        reason: z.string().trim().min(5),
        extendMinutes: z.number().int().min(5).max(180).default(30),
      }),
      req.body
    );

    const now = new Date();
    const newEnd = new Date(Math.max(session.endsAt.getTime(), now.getTime() + extendMinutes * 60_000));

    // 1. Restore session to ACTIVE
    await prisma.examSession.update({
      where: { id: session.id },
      data: {
        status: "ACTIVE",
        recoveredAt: now,
        recoveredById: req.user!.id,
        recoveryReason: reason,
        endsAt: newEnd,
      },
    });

    // 2. Restore terminated candidate attempts that were not submitted
    const terminatedAttempts = await prisma.attempt.findMany({
      where: {
        sessionId: session.id,
        status: "TERMINATED",
      },
    });

    let recoveredAttempts = 0;
    for (const att of terminatedAttempts) {
      try {
        await allowAttemptReentry(att.id, req.user!.id, `Super admin recovery: ${reason}`, clientIp(req));
        recoveredAttempts++;
      } catch {
        // Skip
      }
    }

    await prisma.adminActionAuditLog.create({
      data: {
        adminId: req.user!.id,
        sessionId: session.id,
        examId: session.examId,
        actionType: "SESSION_RECOVER",
        actionReason: reason,
        previousStatus: "TERMINATED",
        newStatus: "ACTIVE",
        metadata: { recoveredAttempts, extendedMinutes: extendMinutes },
        ipAddress: clientIp(req),
      },
    });

    await audit(req, "session.recover", "ExamSession", session.id, { reason, recoveredAttempts });

    res.json({ success: true, status: "ACTIVE", recoveredAttempts, newEnd });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// INDIVIDUAL & BULK CANDIDATE CONTROLS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Individual candidate controls: pause, resume, force-submit, terminate, allow-reentry.
 */
sessionControlRouter.post(
  "/:id/candidates/:candidateId/:action",
  ah(async (req, res) => {
    const { id: sessionId, candidateId, action } = req.params;
    const session = await prisma.examSession.findUnique({ where: { id: sessionId } });
    if (!session) throw notFound("Session");

    const attempt = await prisma.attempt.findFirst({
      where: { examId: session.examId, candidateId },
      orderBy: { startedAt: "desc" },
    });

    if (!attempt) throw notFound("Candidate attempt not found");

    const reason = req.body?.reason ? String(req.body.reason).trim() : undefined;
    const ip = clientIp(req);

    let result;
    switch (action) {
      case "pause":
        result = await pauseAttempt(attempt.id, req.user!.id, reason, ip);
        break;
      case "resume":
        result = await resumeAttempt(attempt.id, req.user!.id, reason, ip);
        break;
      case "force-submit":
        if (!reason) throw badRequest("Reason is required for force-submitting a candidate.");
        result = await forceSubmitAttempt(attempt.id, req.user!.id, reason, ip);
        break;
      case "terminate":
        if (!reason) throw badRequest("Reason is required for terminating a candidate.");
        result = await terminateAttempt(attempt.id, req.user!.id, reason, ip);
        break;
      case "allow-reentry":
        result = await allowAttemptReentry(attempt.id, req.user!.id, reason, ip);
        break;
      default:
        throw badRequest(`Unknown candidate action '${action}'`);
    }

    res.json({ success: true, action, attempt: result });
  })
);

/**
 * Bulk candidate control action (pause, resume, force-submit)
 */
sessionControlRouter.post(
  "/:id/bulk-action",
  ah(async (req, res) => {
    const { id: sessionId } = req.params;
    const session = await prisma.examSession.findUnique({ where: { id: sessionId } });
    if (!session) throw notFound("Session");

    const { action, candidateIds, reason } = parse(
      z.object({
        action: z.enum(["PAUSE", "RESUME", "FORCE_SUBMIT"]),
        candidateIds: z.array(z.string()).min(1),
        reason: z.string().trim().optional(),
      }),
      req.body
    );

    const attempts = await prisma.attempt.findMany({
      where: {
        examId: session.examId,
        candidateId: { in: candidateIds },
      },
    });

    let processedCount = 0;
    const ip = clientIp(req);

    for (const att of attempts) {
      try {
        if (action === "PAUSE" && att.status === "IN_PROGRESS") {
          await pauseAttempt(att.id, req.user!.id, reason || "Bulk pause", ip);
          processedCount++;
        } else if (action === "RESUME" && att.status === "PAUSED") {
          await resumeAttempt(att.id, req.user!.id, reason || "Bulk resume", ip);
          processedCount++;
        } else if (action === "FORCE_SUBMIT" && ["IN_PROGRESS", "PAUSED"].includes(att.status)) {
          await forceSubmitAttempt(att.id, req.user!.id, reason || "Bulk force-submit", ip);
          processedCount++;
        }
      } catch {
        // Skip failed individuals
      }
    }

    await prisma.adminActionAuditLog.create({
      data: {
        adminId: req.user!.id,
        sessionId: session.id,
        examId: session.examId,
        actionType: "BULK_ACTION",
        actionReason: reason || `Bulk ${action}`,
        metadata: { action, candidateCount: candidateIds.length, processedCount },
        ipAddress: ip,
      },
    });

    res.json({ success: true, processedCount });
  })
);

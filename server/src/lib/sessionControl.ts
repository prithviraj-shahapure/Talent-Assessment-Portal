import { prisma, type Attempt } from "./prisma";
import { finalizeAttempt } from "./attempts";
import { type Paper } from "./engine";
import { liveHub } from "../sockets/hub";

/**
 * Server-authoritative pause for an attempt.
 * Calculates exact remaining overall & section seconds, freezes the timer, and sets status to PAUSED.
 */
export async function pauseAttempt(
  attemptId: string,
  adminId: string,
  reason?: string,
  ipAddress?: string
) {
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: { session: true },
  });
  if (!attempt) throw new Error("Attempt not found");
  if (attempt.status !== "IN_PROGRESS") {
    throw new Error(`Cannot pause attempt in '${attempt.status}' status`);
  }

  const now = new Date();
  const paper = attempt.paper as unknown as Paper;
  const currentSec = paper[attempt.currentSection];

  // Calculate remaining seconds overall
  const totalRemainingSec = Math.max(0, Math.floor((attempt.deadlineAt.getTime() - now.getTime()) / 1000));

  // Calculate remaining seconds in current section
  let sectionRemainingSec: number | null = null;
  if (currentSec?.timeLimitMinutes && attempt.sectionStartedAt) {
    const secDeadline = attempt.sectionStartedAt.getTime() + currentSec.timeLimitMinutes * 60_000;
    sectionRemainingSec = Math.max(0, Math.floor((secDeadline - now.getTime()) / 1000));
  }

  const updated = await prisma.attempt.update({
    where: { id: attemptId },
    data: {
      status: "PAUSED",
      pausedAt: now,
      remainingSecondsAtPause: totalRemainingSec,
      sectionRemainingSecondsAtPause: sectionRemainingSec,
    },
  });

  // Log admin action audit
  await prisma.adminActionAuditLog.create({
    data: {
      adminId,
      candidateId: attempt.candidateId,
      sessionId: attempt.sessionId,
      examId: attempt.examId,
      actionType: "CANDIDATE_PAUSE",
      actionReason: reason || "Administrative pause",
      previousStatus: "IN_PROGRESS",
      newStatus: "PAUSED",
      metadata: { remainingSeconds: totalRemainingSec, sectionRemainingSeconds: sectionRemainingSec },
      ipAddress,
    },
  });

  liveHub.attemptPaused(attempt.id, attempt.examId, reason);

  return updated;
}

/**
 * Server-authoritative resume for a paused attempt.
 * Restores remaining overall & section seconds accurately from freeze point.
 */
export async function resumeAttempt(
  attemptId: string,
  adminId: string,
  reason?: string,
  ipAddress?: string
) {
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: { exam: true },
  });
  if (!attempt) throw new Error("Attempt not found");
  if (attempt.status !== "PAUSED") {
    throw new Error(`Cannot resume attempt with status '${attempt.status}'`);
  }

  const now = new Date();
  const remainingSec = attempt.remainingSecondsAtPause ?? Math.max(0, Math.floor((attempt.deadlineAt.getTime() - (attempt.pausedAt || now).getTime()) / 1000));
  const newDeadlineAt = new Date(now.getTime() + remainingSec * 1000);

  // Recalculate sectionStartedAt so that remaining time matches frozen section seconds
  const paper = attempt.paper as unknown as Paper;
  const currentSec = paper[attempt.currentSection];
  let newSectionStartedAt: Date | null = attempt.sectionStartedAt;

  if (currentSec?.timeLimitMinutes && attempt.sectionRemainingSecondsAtPause != null) {
    const elapsedSecBeforePause = currentSec.timeLimitMinutes * 60 - attempt.sectionRemainingSecondsAtPause;
    newSectionStartedAt = new Date(now.getTime() - elapsedSecBeforePause * 1000);
  } else if (!attempt.sectionStartedAt) {
    newSectionStartedAt = now;
  }

  const updated = await prisma.attempt.update({
    where: { id: attemptId },
    data: {
      status: "IN_PROGRESS",
      pausedAt: null,
      remainingSecondsAtPause: null,
      sectionRemainingSecondsAtPause: null,
      deadlineAt: newDeadlineAt,
      sectionStartedAt: newSectionStartedAt,
    },
  });

  await prisma.adminActionAuditLog.create({
    data: {
      adminId,
      candidateId: attempt.candidateId,
      sessionId: attempt.sessionId,
      examId: attempt.examId,
      actionType: "CANDIDATE_RESUME",
      actionReason: reason || "Administrative resume",
      previousStatus: "PAUSED",
      newStatus: "IN_PROGRESS",
      metadata: { restoredSeconds: remainingSec, newDeadlineAt },
      ipAddress,
    },
  });

  liveHub.attemptResumed(attempt.id, attempt.examId);

  return updated;
}

/**
 * Force-submit an active or paused candidate attempt by HR.
 */
export async function forceSubmitAttempt(
  attemptId: string,
  adminId: string,
  reason: string,
  ipAddress?: string
) {
  const attempt = await prisma.attempt.findUnique({ where: { id: attemptId } });
  if (!attempt) throw new Error("Attempt not found");
  if (["SUBMITTED", "AUTO_SUBMITTED", "ADMIN_SUBMITTED", "EVALUATED", "TERMINATED"].includes(attempt.status)) {
    throw new Error(`Attempt is already closed with status '${attempt.status}'`);
  }

  const now = new Date();
  await prisma.attempt.update({
    where: { id: attemptId },
    data: {
      status: "ADMIN_SUBMITTED",
      submissionMethod: "ADMIN_FORCE",
      submittedAt: now,
    },
  });

  // Finalize evaluation
  await finalizeAttempt(attemptId, false);

  await prisma.adminActionAuditLog.create({
    data: {
      adminId,
      candidateId: attempt.candidateId,
      sessionId: attempt.sessionId,
      examId: attempt.examId,
      actionType: "CANDIDATE_FORCE_SUBMIT",
      actionReason: reason,
      previousStatus: attempt.status,
      newStatus: "ADMIN_SUBMITTED",
      metadata: { forcedByAdminId: adminId, reason },
      ipAddress,
    },
  });

  liveHub.attemptForceSubmitted(attempt.id, attempt.examId, reason);

  return prisma.attempt.findUnique({ where: { id: attemptId } });
}

/**
 * Permanently terminate an individual candidate attempt.
 */
export async function terminateAttempt(
  attemptId: string,
  adminId: string,
  reason: string,
  ipAddress?: string
) {
  const attempt = await prisma.attempt.findUnique({ where: { id: attemptId } });
  if (!attempt) throw new Error("Attempt not found");

  const now = new Date();
  const updated = await prisma.attempt.update({
    where: { id: attemptId },
    data: {
      status: "TERMINATED",
      terminatedAt: now,
      terminatedById: adminId,
      terminatedReason: reason,
    },
  });

  if (attempt.sessionId) {
    await prisma.sessionCandidate.updateMany({
      where: { sessionId: attempt.sessionId, candidateId: attempt.candidateId },
      data: { accessStatus: "REVOKED" },
    });
  }

  await prisma.adminActionAuditLog.create({
    data: {
      adminId,
      candidateId: attempt.candidateId,
      sessionId: attempt.sessionId,
      examId: attempt.examId,
      actionType: "CANDIDATE_TERMINATE",
      actionReason: reason,
      previousStatus: attempt.status,
      newStatus: "TERMINATED",
      metadata: { terminatedReason: reason },
      ipAddress,
    },
  });

  liveHub.attemptTerminated(attempt.id, attempt.examId, reason);

  return updated;
}

/**
 * Re-entry authorization for disconnected or accidentally exited candidates.
 * Preserves the single attempt, restores remaining time per policy, and records audit trail.
 */
export async function allowAttemptReentry(
  attemptId: string,
  adminId: string,
  reason?: string,
  ipAddress?: string
) {
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: { exam: true },
  });
  if (!attempt) throw new Error("Attempt not found");
  if (["SUBMITTED", "AUTO_SUBMITTED", "ADMIN_SUBMITTED", "EVALUATED"].includes(attempt.status)) {
    throw new Error("Cannot re-enter an already submitted examination.");
  }

  const now = new Date();
  let deadlineAt = attempt.deadlineAt;
  let sectionStartedAt = attempt.sectionStartedAt;

  // If expired while away, extend deadline by minimum grace recovery buffer
  if (now > attempt.deadlineAt) {
    const recoveryBufferMs = 10 * 60_000; // 10 minutes recovery buffer
    deadlineAt = new Date(now.getTime() + recoveryBufferMs);
    sectionStartedAt = now;
  }

  const updated = await prisma.attempt.update({
    where: { id: attemptId },
    data: {
      status: "IN_PROGRESS",
      deadlineAt,
      sectionStartedAt,
      reentryCount: { increment: 1 },
      lastSeenAt: now,
    },
  });

  if (attempt.sessionId) {
    await prisma.sessionCandidate.updateMany({
      where: { sessionId: attempt.sessionId, candidateId: attempt.candidateId },
      data: { accessStatus: "APPEARING" },
    });
  }

  await prisma.adminActionAuditLog.create({
    data: {
      adminId,
      candidateId: attempt.candidateId,
      sessionId: attempt.sessionId,
      examId: attempt.examId,
      actionType: "CANDIDATE_REENTRY",
      actionReason: reason || "Authorized candidate re-entry",
      previousStatus: attempt.status,
      newStatus: "IN_PROGRESS",
      metadata: { reentryCount: updated.reentryCount },
      ipAddress,
    },
  });

  liveHub.attemptResumed(attempt.id, attempt.examId);

  return updated;
}

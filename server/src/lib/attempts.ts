import { prisma } from "./prisma";
import { evaluateAttempt, type Paper } from "./engine";
import { advanceStage } from "./invites";
import { liveHub } from "../sockets/hub";
import { firestore } from "./firestore";

/**
 * Locks and finalises an attempt exactly once. Safe to call concurrently
 * (manual submit, timer expiry and the background sweeper may race).
 */
export async function finalizeAttempt(attemptId: string, auto: boolean) {
  const now = new Date();
  const existing = await prisma.attempt.findUnique({
    where: { id: attemptId },
    select: { submissionMethod: true },
  });
  const defaultMethod = auto ? "TIME_UP" : "CANDIDATE";
  const finalMethod = existing?.submissionMethod || defaultMethod;

  const locked = await prisma.attempt.updateMany({
    where: { id: attemptId, status: "IN_PROGRESS" },
    data: {
      status: auto ? "AUTO_SUBMITTED" : "SUBMITTED",
      submittedAt: now,
      submissionMethod: finalMethod,
    },
  });
  if (locked.count === 0) return prisma.attempt.findUnique({ where: { id: attemptId } });

  // Mark all section attempts as completed/expired
  await prisma.candidateSectionAttempt.updateMany({
    where: { attemptId, status: { in: ["ACTIVE", "LOCKED"] } },
    data: { status: auto ? "EXPIRED" : "COMPLETED", submittedAt: now },
  });

  const result = await evaluateAttempt(attemptId);
  const a = await prisma.attempt.findUniqueOrThrow({ where: { id: attemptId }, include: { exam: { select: { title: true } } } });

  // Update section attempt scores
  await updateSectionAttemptScores(attemptId);

  // Update candidate status in session if linked
  if (a.sessionId) {
    await prisma.sessionCandidate.updateMany({
      where: { sessionId: a.sessionId, candidateId: a.candidateId },
      data: { accessStatus: "COMPLETED" },
    });
    await prisma.sessionAuditLog.create({
      data: {
        sessionId: a.sessionId,
        candidateId: a.candidateId,
        eventType: "ATTEMPT_SUBMITTED",
        metadata: { attemptId, auto },
      },
    });
  }

  await advanceStage(a.candidateId, "EXAM_COMPLETED", `${auto ? "Auto-submitted" : "Submitted"}: ${a.exam.title}`);
  // Fully auto-graded attempts are ready for HR evaluation straight away
  if (!a.needsManualEval) await advanceStage(a.candidateId, "EVALUATION", `Auto-evaluated: ${a.exam.title}`);
  // Cloud Firestore Sync (Module 3)
  await firestore.saveSubmission({
    attemptId: a.id,
    examId: a.examId,
    candidateId: a.candidateId,
    sessionId: a.sessionId || null,
    score: a.score,
    maxScore: a.maxScore,
    percentage: a.percentage,
    passed: a.passed,
    startedAt: a.startedAt.toISOString(),
    submittedAt: now.toISOString(),
    submissionMethod: a.submissionMethod,
    status: a.status,
    submittedAtTimestamp: now.getTime(),
  });

  liveHub.attemptEnded(a.id, a.examId, auto ? "AUTO_SUBMITTED" : "SUBMITTED");
  return result;
}

export async function updateSectionAttemptScores(attemptId: string) {
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: { answers: true, sectionAttempts: true },
  });
  if (!attempt) return;
  const paper = attempt.paper as unknown as Paper;
  const answerMap = new Map(attempt.answers.map((ans) => [ans.questionId, ans.marksAwarded ?? 0]));

  for (let si = 0; si < paper.length; si++) {
    const sec = paper[si];
    const secScore = sec.questions.reduce((sum, q) => sum + (answerMap.get(q.questionId) ?? 0), 0);
    const maxScore = sec.questions.reduce((sum, q) => sum + q.marks, 0);
    const passingMarks = sec.passingMarks ?? 0;
    const passed = secScore >= passingMarks;

    await prisma.candidateSectionAttempt.upsert({
      where: { attemptId_sectionIndex: { attemptId, sectionIndex: si } },
      create: {
        attemptId,
        sectionIndex: si,
        sectionId: sec.sectionId,
        sectionTitle: sec.title,
        status: "COMPLETED",
        score: Math.round(secScore * 100) / 100,
        maxScore,
        passed,
      },
      update: {
        score: Math.round(secScore * 100) / 100,
        maxScore,
        passed,
      },
    });
  }
}

/** Moves to the next section when the current section's time limit has elapsed. */
export async function syncSection(attempt: { id: string; currentSection: number; sectionStartedAt: Date | null; deadlineAt: Date; paper: unknown }) {
  const paper = attempt.paper as Paper;
  let { currentSection, sectionStartedAt } = attempt;
  let changed = false;
  const now = new Date();

  // Ensure current section attempt record exists
  const currentSec = paper[currentSection];
  if (currentSec) {
    await prisma.candidateSectionAttempt.upsert({
      where: { attemptId_sectionIndex: { attemptId: attempt.id, sectionIndex: currentSection } },
      create: {
        attemptId: attempt.id,
        sectionIndex: currentSection,
        sectionId: currentSec.sectionId,
        sectionTitle: currentSec.title,
        status: "ACTIVE",
        timeLimitMinutes: currentSec.timeLimitMinutes,
        startedAt: sectionStartedAt || now,
        deadlineAt: currentSec.timeLimitMinutes && sectionStartedAt ? new Date(sectionStartedAt.getTime() + currentSec.timeLimitMinutes * 60_000) : null,
      },
      update: {
        status: "ACTIVE",
      },
    });
  }

  while (currentSection < paper.length - 1) {
    const limit = paper[currentSection].timeLimitMinutes;
    if (!limit || !sectionStartedAt) break;
    const end = sectionStartedAt.getTime() + limit * 60_000;
    if (Date.now() < end) break;

    // Previous section expired
    await prisma.candidateSectionAttempt.upsert({
      where: { attemptId_sectionIndex: { attemptId: attempt.id, sectionIndex: currentSection } },
      create: {
        attemptId: attempt.id,
        sectionIndex: currentSection,
        sectionId: paper[currentSection].sectionId,
        sectionTitle: paper[currentSection].title,
        status: "EXPIRED",
        submittedAt: new Date(end),
      },
      update: {
        status: "EXPIRED",
        submittedAt: new Date(end),
      },
    });

    currentSection += 1;
    sectionStartedAt = new Date(end);
    changed = true;

    // Next section activated
    const nextSec = paper[currentSection];
    await prisma.candidateSectionAttempt.upsert({
      where: { attemptId_sectionIndex: { attemptId: attempt.id, sectionIndex: currentSection } },
      create: {
        attemptId: attempt.id,
        sectionIndex: currentSection,
        sectionId: nextSec.sectionId,
        sectionTitle: nextSec.title,
        status: "ACTIVE",
        timeLimitMinutes: nextSec.timeLimitMinutes,
        startedAt: sectionStartedAt,
        deadlineAt: nextSec.timeLimitMinutes ? new Date(sectionStartedAt.getTime() + nextSec.timeLimitMinutes * 60_000) : null,
      },
      update: {
        status: "ACTIVE",
        startedAt: sectionStartedAt,
        deadlineAt: nextSec.timeLimitMinutes ? new Date(sectionStartedAt.getTime() + nextSec.timeLimitMinutes * 60_000) : null,
      },
    });
  }

  if (changed) {
    await prisma.attempt.update({ where: { id: attempt.id }, data: { currentSection, sectionStartedAt, currentQuestion: 0 } });
  }
  return { currentSection, sectionStartedAt };
}

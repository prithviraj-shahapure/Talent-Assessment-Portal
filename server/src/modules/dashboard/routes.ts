import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { ah } from "../../lib/http";
import { requireStaff } from "../../middleware/auth";

export const dashboardRouter = Router();
dashboardRouter.use(requireStaff);

dashboardRouter.get(
  "/",
  ah(async (_req, res) => {
    const now = new Date();
    const since = new Date(now.getTime() - 29 * 86400_000);
    since.setHours(0, 0, 0, 0);
    const [totalCandidates, verifiedCandidates, activeExams, upcomingExams, completedExams, shortlisted, avg, underReviewEval, underReviewRisk, pendingAccommodations, liveAttempts] = await Promise.all([
      prisma.candidateProfile.count(),
      prisma.candidateProfile.count({ where: { user: { emailVerified: true } } }),
      prisma.exam.count({ where: { status: "PUBLISHED", startAt: { lte: now }, endAt: { gte: now } } }),
      prisma.exam.count({ where: { status: "PUBLISHED", startAt: { gt: now } } }),
      prisma.exam.count({ where: { status: { not: "DRAFT" }, endAt: { lt: now } } }),
      prisma.candidateProfile.count({ where: { stage: { in: ["SHORTLISTED", "INTERVIEW", "SELECTED"] } } }),
      prisma.attempt.aggregate({ where: { status: "EVALUATED" }, _avg: { percentage: true } }),
      prisma.attempt.findMany({ where: { needsManualEval: true, status: { not: "IN_PROGRESS" } }, select: { candidateId: true }, distinct: ["candidateId"] }),
      prisma.attempt.findMany({ where: { riskLevel: { in: ["MEDIUM", "HIGH"] }, events: { some: { reviewed: false, weightApplied: { gt: 0 } } } }, select: { candidateId: true }, distinct: ["candidateId"] }),
      prisma.accommodationRequest.count({ where: { status: "PENDING" } }),
      prisma.attempt.count({ where: { status: "IN_PROGRESS", deadlineAt: { gt: now } } }),
    ]);
    const underReview = new Set([...underReviewEval, ...underReviewRisk].map((x) => x.candidateId)).size;

    // Registrations per day (last 30 days)
    const regs = await prisma.candidateProfile.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } });
    const regMap = new Map<string, number>();
    for (let i = 0; i < 30; i++) regMap.set(new Date(since.getTime() + i * 86400_000).toISOString().slice(0, 10), 0);
    for (const r of regs) {
      const k = r.createdAt.toISOString().slice(0, 10);
      if (regMap.has(k)) regMap.set(k, regMap.get(k)! + 1);
    }

    // Participation & performance per exam (most recent 8 non-draft)
    const exams = await prisma.exam.findMany({
      where: { status: { not: "DRAFT" } },
      orderBy: { startAt: "desc" },
      take: 8,
      select: { id: true, title: true, department: { select: { name: true } }, _count: { select: { assignments: true } } },
    });
    const perExam = await Promise.all(
      exams.map(async (e) => {
        const [attempted, submitted, agg, passed, failed] = await Promise.all([
          prisma.attempt.findMany({ where: { examId: e.id }, select: { candidateId: true }, distinct: ["candidateId"] }),
          prisma.attempt.count({ where: { examId: e.id, status: { not: "IN_PROGRESS" } } }),
          prisma.attempt.aggregate({ where: { examId: e.id, status: "EVALUATED" }, _avg: { percentage: true }, _max: { percentage: true } }),
          prisma.attempt.count({ where: { examId: e.id, passed: true } }),
          prisma.attempt.count({ where: { examId: e.id, passed: false } }),
        ]);
        return {
          examId: e.id,
          title: e.title,
          department: e.department?.name ?? "General",
          assigned: e._count.assignments,
          attempted: attempted.length,
          submitted,
          avgPercentage: agg._avg.percentage ? Math.round(agg._avg.percentage * 10) / 10 : 0,
          maxPercentage: agg._max.percentage ?? 0,
          passed,
          failed,
        };
      }),
    );

    const [passCount, failCount, pendingCount] = await Promise.all([
      prisma.attempt.count({ where: { passed: true } }),
      prisma.attempt.count({ where: { passed: false } }),
      prisma.attempt.count({ where: { needsManualEval: true, status: { not: "IN_PROGRESS" } } }),
    ]);

    // Department-wise candidates: via the department of the examinations they are assigned to
    const deptRows = await prisma.department.findMany({
      select: { name: true, exams: { select: { assignments: { select: { candidateId: true } }, attempts: { where: { passed: true }, select: { candidateId: true } } } } },
    });
    const departments = deptRows
      .map((d) => ({
        department: d.name,
        candidates: new Set(d.exams.flatMap((e) => e.assignments.map((a) => a.candidateId))).size,
        passed: new Set(d.exams.flatMap((e) => e.attempts.map((a) => a.candidateId))).size,
      }))
      .filter((d) => d.candidates > 0)
      .sort((a, b) => b.candidates - a.candidates);

    const stageCounts = await prisma.candidateProfile.groupBy({ by: ["stage"], _count: true });
    const recentEvents = await prisma.proctorEvent.findMany({
      where: { weightApplied: { gt: 0 } },
      orderBy: { occurredAt: "desc" },
      take: 8,
      include: { attempt: { select: { exam: { select: { title: true } }, candidate: { select: { user: { select: { name: true } } } } } } },
    });

    res.json({
      stats: {
        totalCandidates,
        registeredCandidates: verifiedCandidates,
        activeExams,
        completedExams,
        upcomingExams,
        underReview,
        shortlisted,
        averageScore: avg._avg.percentage ? Math.round(avg._avg.percentage * 10) / 10 : null,
        pendingAccommodations,
        liveAttempts,
      },
      registrations: [...regMap.entries()].map(([date, count]) => ({ date, count })),
      participation: perExam.slice().reverse(),
      passFail: [
        { name: "Passed", value: passCount },
        { name: "Failed", value: failCount },
        { name: "Pending evaluation", value: pendingCount },
      ],
      departments,
      stages: stageCounts.map((s) => ({ stage: s.stage, count: s._count })),
      recentEvents: recentEvents.map((e) => ({ id: e.id, attemptId: e.attemptId, type: e.type, severity: e.severity, message: e.message, occurredAt: e.occurredAt, candidate: e.attempt.candidate.user.name, exam: e.attempt.exam.title })),
    });
  }),
);

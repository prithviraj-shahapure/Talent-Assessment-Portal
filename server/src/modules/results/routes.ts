import { Router } from "express";
import { z } from "zod";
import ExcelJS from "exceljs";
import { prisma } from "../../lib/prisma";
import { ah, badRequest, notFound, parse } from "../../lib/http";
import { requireStaff } from "../../middleware/auth";
import type { Paper } from "../../lib/engine";
import { audit } from "../../lib/audit";
import { attemptReview } from "../evaluation/routes";

export const resultsRouter = Router();
resultsRouter.use(requireStaff);

export interface LeaderRow {
  rank: number;
  attemptId: string;
  candidateId: string;
  name: string;
  email: string;
  college: string;
  degree: string;
  branch: string;
  stage: string;
  attemptNo: number;
  status: string;
  score: number;
  maxScore: number;
  percentage: number;
  passed: boolean | null;
  needsManualEval: boolean;
  timeTakenSec: number | null;
  riskScore: number;
  riskLevel: string;
  submittedAt: Date | null;
  sections: { title: string; score: number; max: number; passed?: boolean | null; timeLimitMinutes?: number | null }[];
}

/** Best submitted attempt per candidate, ranked by score (desc) then time taken (asc). */
export async function leaderboard(examId: string): Promise<{ exam: { id: string; title: string; passingMarks: number; totalMarks: number }; rows: LeaderRow[] }> {
  const exam = await prisma.exam.findUnique({ where: { id: examId }, select: { id: true, title: true, passingMarks: true, totalMarks: true } });
  if (!exam) throw notFound("Examination");
  const attempts = await prisma.attempt.findMany({
    where: { examId, status: { not: "IN_PROGRESS" } },
    include: {
      candidate: { include: { user: { select: { name: true, email: true } } } },
      answers: { select: { questionId: true, marksAwarded: true } },
      sectionAttempts: true,
    },
  });
  const best = new Map<string, (typeof attempts)[number]>();
  for (const a of attempts) {
    const cur = best.get(a.candidateId);
    if (!cur || (a.score ?? 0) > (cur.score ?? 0)) best.set(a.candidateId, a);
  }
  const rows = [...best.values()].map((a) => {
    const paper = a.paper as unknown as Paper;
    const m = new Map(a.answers.map((x) => [x.questionId, x.marksAwarded ?? 0]));
    return {
      rank: 0,
      attemptId: a.id,
      candidateId: a.candidateId,
      name: a.candidate.user.name,
      email: a.candidate.user.email,
      college: a.candidate.college,
      degree: a.candidate.degree,
      branch: a.candidate.branch,
      stage: a.candidate.stage,
      attemptNo: a.attemptNo,
      status: a.status,
      submissionMethod: a.submissionMethod,
      score: a.score ?? 0,
      maxScore: a.maxScore ?? 0,
      percentage: a.percentage ?? 0,
      passed: a.passed,
      needsManualEval: a.needsManualEval,
      timeTakenSec: a.submittedAt ? Math.round((a.submittedAt.getTime() - a.startedAt.getTime()) / 1000) : null,
      riskScore: a.riskScore,
      riskLevel: a.riskLevel,
      submittedAt: a.submittedAt,
      sections: paper.map((s, si) => {
        const sa = a.sectionAttempts.find((x) => x.sectionIndex === si);
        const sScore = Math.round(s.questions.reduce((x, q) => x + (m.get(q.questionId) ?? 0), 0) * 100) / 100;
        const sMax = s.questions.reduce((x, q) => x + q.marks, 0);
        return {
          title: s.title,
          score: sa?.score ?? sScore,
          max: sa?.maxScore ?? sMax,
          passed: sa?.passed ?? (s.passingMarks ? sScore >= s.passingMarks : true),
          timeLimitMinutes: s.timeLimitMinutes,
        };
      }),
    };
  });
  rows.sort((x, y) => y.score - x.score || (x.timeTakenSec ?? 1e9) - (y.timeTakenSec ?? 1e9));
  let lastScore: number | null = null;
  let lastRank = 0;
  rows.forEach((r, i) => {
    r.rank = r.score === lastScore ? lastRank : i + 1;
    lastScore = r.score;
    lastRank = r.rank;
  });
  return { exam, rows };
}

resultsRouter.get(
  "/exams/:examId",
  ah(async (req, res) => {
    const { exam, rows } = await leaderboard(req.params.examId);
    const [assigned, inProgress] = await Promise.all([
      prisma.examAssignment.count({ where: { examId: exam.id } }),
      prisma.attempt.count({ where: { examId: exam.id, status: "IN_PROGRESS" } }),
    ]);
    const evaluated = rows.filter((r) => !r.needsManualEval);
    const pct = evaluated.map((r) => r.percentage);
    const distribution = Array.from({ length: 10 }, (_, i) => ({
      range: `${i * 10}–${i === 9 ? 100 : i * 10 + 9}`,
      count: pct.filter((p) => (i === 9 ? p >= 90 : p >= i * 10 && p < i * 10 + 10)).length,
    }));
    const sectionTitles = rows[0]?.sections.map((s) => s.title) ?? [];
    const sectionAverages = sectionTitles.map((t, i) => {
      const vals = rows.map((r) => (r.sections[i]?.max ? (r.sections[i].score / r.sections[i].max) * 100 : 0));
      return { title: t, avgPercentage: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0 };
    });

    // Question-level analytics (difficulty index) for objective questions
    const answers = await prisma.answer.findMany({
      where: { attemptId: { in: rows.map((r) => r.attemptId) } },
      select: { questionId: true, isCorrect: true, selectedOptionIds: true, textAnswer: true, question: { select: { text: true, type: true } } },
    });
    const qStats = new Map<string, { text: string; type: string; attempted: number; correct: number }>();
    for (const a of answers) {
      const s = qStats.get(a.questionId) ?? { text: a.question.text, type: a.question.type, attempted: 0, correct: 0 };
      if (a.selectedOptionIds.length || a.textAnswer?.trim()) s.attempted += 1;
      if (a.isCorrect) s.correct += 1;
      qStats.set(a.questionId, s);
    }
    const questionAnalytics = [...qStats.entries()]
      .map(([id, s]) => ({ questionId: id, text: s.text.slice(0, 140), type: s.type, attempted: s.attempted, correct: s.correct, correctRate: s.attempted ? Math.round((s.correct / s.attempted) * 1000) / 10 : 0 }))
      .sort((a, b) => a.correctRate - b.correctRate);

    res.json({
      exam,
      summary: {
        assigned,
        inProgress,
        submitted: rows.length,
        pendingEvaluation: rows.filter((r) => r.needsManualEval).length,
        average: pct.length ? Math.round((pct.reduce((a, b) => a + b, 0) / pct.length) * 10) / 10 : null,
        highest: pct.length ? Math.max(...pct) : null,
        lowest: pct.length ? Math.min(...pct) : null,
        passed: evaluated.filter((r) => r.passed).length,
        failed: evaluated.filter((r) => r.passed === false).length,
        flagged: rows.filter((r) => r.riskLevel === "MEDIUM" || r.riskLevel === "HIGH").length,
      },
      distribution,
      sectionAverages,
      questionAnalytics,
      rows,
    });
  }),
);

resultsRouter.get(
  "/exams/:examId/export",
  ah(async (req, res) => {
    const format = req.query.format === "csv" ? "csv" : "xlsx";
    const { exam, rows } = await leaderboard(req.params.examId);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Results");
    const sectionCols = (rows[0]?.sections ?? []).map((s, i) => ({ header: `${s.title} (/${s.max})`, key: `s${i}`, width: 16 }));
    ws.columns = [
      { header: "Rank", key: "rank", width: 7 },
      { header: "Name", key: "name", width: 26 },
      { header: "Email", key: "email", width: 30 },
      { header: "College", key: "college", width: 32 },
      { header: "Degree", key: "degree", width: 10 },
      { header: "Branch", key: "branch", width: 20 },
      { header: "Score", key: "score", width: 9 },
      { header: "Max", key: "maxScore", width: 7 },
      { header: "Percentage", key: "percentage", width: 11 },
      { header: "Result", key: "result", width: 12 },
      ...sectionCols,
      { header: "Time Taken (min)", key: "time", width: 15 },
      { header: "Risk Score", key: "riskScore", width: 10 },
      { header: "Risk Level", key: "riskLevel", width: 11 },
      { header: "Pipeline Stage", key: "stage", width: 15 },
      { header: "Submitted At", key: "submittedAt", width: 18 },
    ];
    for (const r of rows) {
      ws.addRow({
        ...r,
        result: r.needsManualEval ? "Pending" : r.passed ? "Pass" : "Fail",
        time: r.timeTakenSec ? Math.round(r.timeTakenSec / 6) / 10 : null,
        submittedAt: r.submittedAt?.toISOString().slice(0, 16).replace("T", " "),
        ...Object.fromEntries(r.sections.map((s, i) => [`s${i}`, s.score])),
      });
    }
    ws.getRow(1).font = { bold: true };
    await audit(req, "results.export", "Exam", exam.id, { format, rows: rows.length });
    const safe = exam.title.replace(/[^\w\- ]/g, "").replace(/\s+/g, "-").slice(0, 60);
    res.setHeader("Content-Disposition", `attachment; filename="results-${safe}.${format}"`);
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

resultsRouter.get(
  "/attempts/:id",
  ah(async (req, res) => {
    res.json(await attemptReview(req.params.id));
  }),
);

resultsRouter.get(
  "/compare",
  ah(async (req, res) => {
    const ids = parse(z.array(z.string()).min(2).max(4), String(req.query.attemptIds ?? "").split(",").filter(Boolean));
    const reviews = await Promise.all(ids.map((id) => attemptReview(id)));
    const examIds = new Set(reviews.map((r) => r.exam.id));
    if (examIds.size > 1) throw badRequest("Compare attempts from the same examination");
    const { rows } = await leaderboard(reviews[0].exam.id);
    res.json(
      reviews.map((r) => {
        const lr = rows.find((x) => x.attemptId === r.id);
        const qs = r.sections.flatMap((s) => s.questions);
        return {
          attemptId: r.id,
          candidateId: r.candidateId,
          name: r.candidate.user.name,
          college: r.candidate.college,
          degree: r.candidate.degree,
          branch: r.candidate.branch,
          graduationYear: r.candidate.graduationYear,
          stage: r.candidate.stage,
          rank: lr?.rank ?? null,
          score: r.score,
          maxScore: r.maxScore,
          percentage: r.percentage,
          passed: r.passed,
          timeTakenSec: r.timeTakenSec,
          riskScore: r.riskScore,
          riskLevel: r.riskLevel,
          sections: r.sections.map((s) => ({ title: s.title, score: s.score, max: s.max })),
          correct: qs.filter((q) => q.isCorrect === true).length,
          wrong: qs.filter((q) => q.isCorrect === false && (q.textAnswer || q.options.some((o) => o.selected))).length,
          unanswered: qs.filter((q) => !q.textAnswer && !q.options.some((o) => o.selected)).length,
        };
      }),
    );
  }),
);

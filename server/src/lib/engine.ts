import { prisma, type Prisma, type QuestionType } from "./prisma";
import { shuffle } from "./tokens";
import { badRequest } from "./http";

export interface PaperQuestion {
  questionId: string;
  marks: number;
  optionOrder: string[];
}
export interface PaperSection {
  sectionId: string;
  title: string;
  timeLimitMinutes: number | null;
  passingMarks?: number;
  negativeMarks?: number;
  instructions?: string | null;
  isMandatory?: boolean;
  sectionType?: string | null;
  questions: PaperQuestion[];
}
export type Paper = PaperSection[];

const OPTION_TYPES: QuestionType[] = ["SINGLE", "MULTIPLE", "TRUE_FALSE"];
export const MANUAL_TYPES: QuestionType[] = ["DESCRIPTIVE", "CODING"];

/** Builds a frozen, per-candidate question paper. Random-rule picks and order are fixed at start. */
export async function buildPaper(examId: string): Promise<{ paper: Paper; maxScore: number }> {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    include: {
      sections: {
        orderBy: { order: "asc" },
        include: {
          questions: { orderBy: { order: "asc" }, include: { question: { include: { options: { orderBy: { order: "asc" } } } } } },
          randomRules: true,
        },
      },
    },
  });
  if (!exam) throw badRequest("Examination not found");
  const used = new Set<string>();
  const paper: Paper = [];
  let maxScore = 0;

  for (const s of exam.sections) {
    const qs: PaperQuestion[] = [];
    for (const eq of s.questions) {
      if (!eq.question.isActive) continue;
      used.add(eq.questionId);
      qs.push({
        questionId: eq.questionId,
        marks: eq.marks ?? eq.question.marks,
        optionOrder: orderOptions(eq.question.type, eq.question.options.map((o) => o.id), exam.randomizeOptions),
      });
    }
    for (const rule of s.randomRules) {
      const where: Prisma.QuestionWhereInput = {
        isActive: true,
        id: { notIn: [...used] },
        ...(rule.categoryId ? { categoryId: rule.categoryId } : {}),
        ...(rule.difficulty ? { difficulty: rule.difficulty } : {}),
        ...(rule.type ? { type: rule.type } : {}),
      };
      const pool = await prisma.question.findMany({ where, include: { options: { orderBy: { order: "asc" } } } });
      const picks = shuffle(pool).slice(0, rule.count);
      for (const q of picks) {
        used.add(q.id);
        qs.push({ questionId: q.id, marks: rule.marksEach ?? q.marks, optionOrder: orderOptions(q.type, q.options.map((o) => o.id), exam.randomizeOptions) });
      }
    }
    const ordered = exam.randomizeQuestions ? shuffle(qs) : qs;
    maxScore += ordered.reduce((a, q) => a + q.marks, 0);
    paper.push({
      sectionId: s.id,
      title: s.title,
      timeLimitMinutes: exam.sectionTimeLimits ? s.timeLimitMinutes : null,
      passingMarks: s.passingMarks,
      negativeMarks: s.negativeMarks,
      instructions: s.instructions,
      isMandatory: s.isMandatory,
      sectionType: s.sectionType,
      questions: ordered,
    });
  }
  if (paper.every((s) => s.questions.length === 0)) throw badRequest("This examination has no questions configured yet");
  return { paper, maxScore };
}

function orderOptions(type: QuestionType, ids: string[], randomize: boolean) {
  if (!OPTION_TYPES.includes(type)) return [];
  if (type === "TRUE_FALSE") return ids; // keep True/False in natural order
  return randomize ? shuffle(ids) : ids;
}

export interface GradeInput {
  type: QuestionType;
  marks: number;
  negativeMarks: number;
  negativeMarking: boolean;
  options: { id: string; isCorrect: boolean }[];
  acceptedAnswers: string[];
  numericTolerance: number | null;
  selectedOptionIds: string[];
  textAnswer: string | null;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Returns null for answers that need human evaluation. */
export function gradeAnswer(g: GradeInput): { isCorrect: boolean | null; marks: number } | null {
  const penalty = g.negativeMarking ? -Math.abs(g.negativeMarks) : 0;
  const answered = g.selectedOptionIds.length > 0 || (g.textAnswer ?? "").trim() !== "";
  if (MANUAL_TYPES.includes(g.type)) return answered ? null : { isCorrect: false, marks: 0 };
  if (!answered) return { isCorrect: false, marks: 0 };

  switch (g.type) {
    case "SINGLE":
    case "TRUE_FALSE":
    case "MULTIPLE": {
      const correct = new Set(g.options.filter((o) => o.isCorrect).map((o) => o.id));
      const sel = new Set(g.selectedOptionIds);
      const ok = correct.size === sel.size && [...correct].every((id) => sel.has(id));
      return { isCorrect: ok, marks: ok ? g.marks : penalty };
    }
    case "NUMERICAL": {
      const val = Number(String(g.textAnswer).trim());
      const target = Number(g.acceptedAnswers[0]);
      if (Number.isNaN(val) || Number.isNaN(target)) return { isCorrect: false, marks: penalty };
      const ok = Math.abs(val - target) <= (g.numericTolerance ?? 0) + 1e-9;
      return { isCorrect: ok, marks: ok ? g.marks : penalty };
    }
    case "SHORT": {
      if (g.acceptedAnswers.length === 0) return null;
      const ok = g.acceptedAnswers.some((a) => norm(a) === norm(g.textAnswer ?? ""));
      return { isCorrect: ok, marks: ok ? g.marks : penalty };
    }
  }
  return null;
}

/**
 * Grades every question in the frozen paper (unanswered questions get an Answer row with 0),
 * then totals the attempt. Answers already graded by a human evaluator are preserved.
 */
export async function evaluateAttempt(attemptId: string) {
  const attempt = await prisma.attempt.findUnique({ where: { id: attemptId }, include: { exam: true, answers: true } });
  if (!attempt) return;
  const paper = attempt.paper as unknown as Paper;
  const qIds = paper.flatMap((s) => s.questions.map((q) => q.questionId));
  const questions = await prisma.question.findMany({ where: { id: { in: qIds } }, include: { options: true } });
  const qMap = new Map(questions.map((q) => [q.id, q]));
  const aMap = new Map(attempt.answers.map((a) => [a.questionId, a]));

  let pendingManual = false;
  for (const s of paper) {
    for (const pq of s.questions) {
      const q = qMap.get(pq.questionId);
      if (!q) continue;
      const a = aMap.get(pq.questionId);
      if (a?.evaluatorId) continue; // human-evaluated already
      const result = gradeAnswer({
        type: q.type,
        marks: pq.marks,
        negativeMarks: q.negativeMarks,
        negativeMarking: attempt.exam.negativeMarking,
        options: q.options,
        acceptedAnswers: q.acceptedAnswers,
        numericTolerance: q.numericTolerance,
        selectedOptionIds: a?.selectedOptionIds ?? [],
        textAnswer: a?.textAnswer ?? null,
      });
      if (result === null) pendingManual = true;
      const data = {
        isCorrect: result?.isCorrect ?? null,
        marksAwarded: result ? result.marks : null,
        autoGraded: result !== null,
      };
      await prisma.answer.upsert({
        where: { attemptId_questionId: { attemptId, questionId: pq.questionId } },
        create: { attemptId, questionId: pq.questionId, ...data },
        update: data,
      });
    }
  }
  return totalAttempt(attemptId, pendingManual);
}

export async function totalAttempt(attemptId: string, pendingManualHint?: boolean) {
  const attempt = await prisma.attempt.findUniqueOrThrow({ where: { id: attemptId }, include: { exam: true, answers: { include: { question: { select: { type: true } } } } } });
  const pending =
    pendingManualHint ??
    attempt.answers.some((a) => a.marksAwarded === null && (a.textAnswer ?? "").trim() !== "");
  const raw = attempt.answers.reduce((sum, a) => sum + (a.marksAwarded ?? 0), 0);
  const autoScore = attempt.answers.filter((a) => a.autoGraded).reduce((s, a) => s + (a.marksAwarded ?? 0), 0);
  const score = Math.max(0, Math.round(raw * 100) / 100);
  const maxScore = attempt.maxScore ?? 0;
  const percentage = maxScore > 0 ? Math.round((score / maxScore) * 10000) / 100 : 0;
  return prisma.attempt.update({
    where: { id: attemptId },
    data: {
      score,
      autoScore: Math.round(autoScore * 100) / 100,
      percentage,
      passed: pending ? null : score >= attempt.exam.passingMarks,
      needsManualEval: pending,
      status: pending ? attempt.status : "EVALUATED",
    },
  });
}

export function deadlineFor(a: { startedAt: Date; deadlineAt: Date; sectionStartedAt: Date | null; currentSection: number }, paper: Paper) {
  const sec = paper[a.currentSection];
  let sectionDeadline: Date | null = null;
  if (sec?.timeLimitMinutes && a.sectionStartedAt) {
    sectionDeadline = new Date(Math.min(a.sectionStartedAt.getTime() + sec.timeLimitMinutes * 60_000, a.deadlineAt.getTime()));
  }
  return { attemptDeadline: a.deadlineAt, sectionDeadline };
}

export function resultsVisible(exam: { resultsReleased: boolean; resultPublication: string; endAt: Date }, attemptStatus: string) {
  if (attemptStatus !== "EVALUATED") return false;
  if (exam.resultsReleased) return true;
  if (exam.resultPublication === "IMMEDIATE") return true;
  if (exam.resultPublication === "AFTER_EXAM_END" && exam.endAt.getTime() < Date.now()) return true;
  return false;
}

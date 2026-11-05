import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { ah, badRequest, notFound, parse } from "../../lib/http";
import { requireStaff } from "../../middleware/auth";
import { totalAttempt, type Paper } from "../../lib/engine";
import { advanceStage } from "../../lib/invites";
import { audit } from "../../lib/audit";

export const evaluationRouter = Router();
evaluationRouter.use(requireStaff);

evaluationRouter.get(
  "/queue",
  ah(async (req, res) => {
    const attempts = await prisma.attempt.findMany({
      where: { needsManualEval: true, status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] }, ...(req.query.examId ? { examId: String(req.query.examId) } : {}) },
      orderBy: { submittedAt: "asc" },
      include: {
        exam: { select: { id: true, title: true } },
        candidate: { include: { user: { select: { name: true, email: true } } } },
        answers: { where: { marksAwarded: null, NOT: { textAnswer: null } }, select: { id: true } },
      },
    });
    res.json(attempts.map(({ answers, paper: _p, ...a }) => ({ ...a, pendingAnswers: answers.length })));
  }),
);

/** Full attempt with answer keys — staff only. Used for evaluation and question-wise review. */
export async function attemptReview(attemptId: string) {
  const a = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: {
      exam: { select: { id: true, title: true, passingMarks: true, negativeMarking: true, resultsReleased: true } },
      candidate: { include: { user: { select: { name: true, email: true } } } },
      answers: { include: { evaluator: { select: { name: true } } } },
    },
  });
  if (!a) throw notFound("Attempt");
  const paper = a.paper as unknown as Paper;
  const qIds = paper.flatMap((s) => s.questions.map((q) => q.questionId));
  const questions = await prisma.question.findMany({ where: { id: { in: qIds } }, include: { options: true, category: { select: { name: true } } } });
  const qMap = new Map(questions.map((q) => [q.id, q]));
  const aMap = new Map(a.answers.map((x) => [x.questionId, x]));
  let n = 0;
  const sections = paper.map((s) => {
    const qs = s.questions.map((pq) => {
      const q = qMap.get(pq.questionId)!;
      const ans = aMap.get(pq.questionId);
      const byId = new Map(q.options.map((o) => [o.id, o]));
      n += 1;
      return {
        number: n,
        questionId: q.id,
        answerId: ans?.id ?? null,
        type: q.type,
        text: q.text,
        category: q.category?.name ?? null,
        difficulty: q.difficulty,
        marks: pq.marks,
        negativeMarks: a.exam.negativeMarking ? q.negativeMarks : 0,
        explanation: q.explanation,
        acceptedAnswers: q.acceptedAnswers,
        numericTolerance: q.numericTolerance,
        codeLanguage: q.codeLanguage,
        options: pq.optionOrder.map((id) => ({ id, text: byId.get(id)?.text ?? "", isCorrect: !!byId.get(id)?.isCorrect, selected: ans?.selectedOptionIds.includes(id) ?? false })),
        textAnswer: ans?.textAnswer ?? null,
        markedForReview: ans?.markedForReview ?? false,
        isCorrect: ans?.isCorrect ?? null,
        marksAwarded: ans?.marksAwarded ?? null,
        autoGraded: ans?.autoGraded ?? false,
        evaluator: ans?.evaluator?.name ?? null,
        evaluatorNote: ans?.evaluatorNote ?? null,
        needsManual: (q.type === "DESCRIPTIVE" || q.type === "CODING" || (q.type === "SHORT" && q.acceptedAnswers.length === 0)) && !!ans?.textAnswer?.trim(),
      };
    });
    return {
      title: s.title,
      score: Math.round(qs.reduce((x, q) => x + (q.marksAwarded ?? 0), 0) * 100) / 100,
      max: qs.reduce((x, q) => x + q.marks, 0),
      questions: qs,
    };
  });
  const { paper: _p, answers: _a, ...rest } = a;
  const timeTakenSec = a.submittedAt ? Math.round((a.submittedAt.getTime() - a.startedAt.getTime()) / 1000) : null;
  return { ...rest, timeTakenSec, sections };
}

evaluationRouter.get(
  "/attempts/:id",
  ah(async (req, res) => {
    res.json(await attemptReview(req.params.id));
  }),
);

evaluationRouter.put(
  "/answers/:answerId",
  ah(async (req, res) => {
    const body = parse(z.object({ marksAwarded: z.number().min(-100).max(100), note: z.string().max(2000).optional().nullable() }), req.body);
    const ans = await prisma.answer.findUnique({ where: { id: req.params.answerId }, include: { attempt: { include: { exam: true } }, question: true } });
    if (!ans) throw notFound("Answer");
    if (ans.attempt.status === "IN_PROGRESS") throw badRequest("The attempt is still in progress");
    const paper = ans.attempt.paper as unknown as Paper;
    const pq = paper.flatMap((s) => s.questions).find((q) => q.questionId === ans.questionId);
    const max = pq?.marks ?? ans.question.marks;
    const min = ans.attempt.exam.negativeMarking ? -Math.abs(ans.question.negativeMarks) : 0;
    if (body.marksAwarded > max || body.marksAwarded < min) throw badRequest(`Marks must be between ${min} and ${max}`);
    await prisma.answer.update({
      where: { id: ans.id },
      data: { marksAwarded: body.marksAwarded, isCorrect: body.marksAwarded >= max ? true : body.marksAwarded <= 0 ? false : null, evaluatorId: req.user!.id, evaluatorNote: body.note ?? null, evaluatedAt: new Date() },
    });
    const pending = await prisma.answer.count({ where: { attemptId: ans.attemptId, marksAwarded: null, NOT: { textAnswer: null } } });
    const updated = await totalAttempt(ans.attemptId, pending > 0);
    if (!updated.needsManualEval) await advanceStage(updated.candidateId, "EVALUATION", `Evaluation completed: ${ans.attempt.exam.title}`, req.user!.id);
    await audit(req, "answer.evaluate", "Answer", ans.id, { attemptId: ans.attemptId, marks: body.marksAwarded });
    res.json({ score: updated.score, percentage: updated.percentage, needsManualEval: updated.needsManualEval, status: updated.status });
  }),
);

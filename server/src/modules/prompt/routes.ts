import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { ah, badRequest, forbidden, notFound, parse, unauthorized } from "../../lib/http";
import { requireAuth, requireStaff } from "../../middleware/auth";
import { audit } from "../../lib/audit";
import { callAIService, evaluatePromptQuestion } from "../../lib/promptEvaluator";
import { firestore } from "../../lib/firestore";

export const promptRouter = Router();

/**
 * POST /api/prompt/run
 * Submit prompt to configured AI service and record attempt.
 * Enforces maximum 2 attempts per question.
 */
promptRouter.post(
  "/run",
  requireAuth,
  ah(async (req, res) => {
    const body = parse(
      z.object({
        attemptId: z.string(),
        questionId: z.string(),
        prompt: z.string().trim().min(5).max(10000),
        attemptNumber: z.number().int().min(1).max(2),
      }),
      req.body
    );

    // Verify candidate owns this attempt and exam is in progress
    const attempt = await prisma.attempt.findUnique({
      where: { id: body.attemptId },
      include: {
        candidate: { select: { id: true, userId: true } },
      },
    });

    if (!attempt) throw notFound("Examination attempt");

    if (req.user?.role === "CANDIDATE" && attempt.candidate.userId !== req.user.id) {
      throw forbidden("Access denied to this examination attempt");
    }

    if (attempt.status !== "IN_PROGRESS") {
      throw badRequest("Examination is not active");
    }

    // Verify question is PROMPT type
    const question = await prisma.question.findUnique({
      where: { id: body.questionId },
    });
    if (!question || question.type !== "PROMPT") {
      throw badRequest("Question is not a Prompt Engineering assessment");
    }

    // Count existing attempts for this candidate & question to strictly enforce max 2 attempts
    const existingCount = await prisma.promptAttempt.count({
      where: {
        attemptId: body.attemptId,
        questionId: body.questionId,
      },
    });

    if (existingCount >= 2) {
      throw badRequest("Maximum 2 prompt attempts permitted for this question.");
    }

    const calculatedAttemptNumber = existingCount + 1;
    const promptMeta = (question.promptMeta as any) || {};

    // System context passed to AI
    const systemContext = [
      promptMeta.scenario ? `Scenario: ${promptMeta.scenario}` : "",
      promptMeta.requirements?.length ? `Technical Requirements:\n${promptMeta.requirements.join("\n")}` : "",
      promptMeta.expectedOutput ? `Expected Output Format:\n${promptMeta.expectedOutput}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    // Call AI provider through backend
    const aiResult = await callAIService(body.prompt, systemContext || question.text);

    // Record prompt attempt in database
    const savedAttempt = await prisma.promptAttempt.create({
      data: {
        attemptId: body.attemptId,
        questionId: body.questionId,
        candidateId: attempt.candidateId,
        attemptNumber: calculatedAttemptNumber,
        prompt: body.prompt,
        aiResponse: aiResult.text || (aiResult.error ? `[ERROR: ${aiResult.error}]` : null),
        submittedAt: new Date(),
      },
    });

    // Cloud Firestore Sync (Module 3)
    await firestore.savePromptAttempt({
      attemptId: body.attemptId,
      questionId: body.questionId,
      candidateId: attempt.candidateId,
      attemptNumber: calculatedAttemptNumber,
      prompt: body.prompt,
      aiResponse: aiResult.text || null,
      submittedAt: new Date().toISOString(),
    });

    res.json({
      success: aiResult.success,
      attemptNumber: calculatedAttemptNumber,
      maxAttempts: 2,
      aiResponse: aiResult.text || null,
      error: aiResult.error || null,
      provider: aiResult.provider,
    });
  })
);

/**
 * POST /api/prompt/evaluate
 * Trigger evaluation for candidate's prompt question answers
 */
promptRouter.post(
  "/evaluate",
  requireAuth,
  ah(async (req, res) => {
    const body = parse(
      z.object({
        attemptId: z.string(),
        questionId: z.string(),
        finalSubmit: z.boolean().default(false),
      }),
      req.body
    );

    const attempt = await prisma.attempt.findUnique({
      where: { id: body.attemptId },
      include: { candidate: { select: { id: true, userId: true } } },
    });
    if (!attempt) throw notFound("Attempt");

    if (req.user?.role === "CANDIDATE" && attempt.candidate.userId !== req.user.id) {
      throw forbidden("Access denied");
    }

    const question = await prisma.question.findUnique({
      where: { id: body.questionId },
    });
    if (!question || question.type !== "PROMPT") {
      throw badRequest("Question is not a Prompt Engineering assessment");
    }

    // Fetch candidate prompt attempts
    const promptAttempts = await prisma.promptAttempt.findMany({
      where: { attemptId: body.attemptId, questionId: body.questionId },
      orderBy: { attemptNumber: "asc" },
    });

    if (promptAttempts.length === 0) {
      throw badRequest("No prompt attempts submitted yet");
    }

    const attempt1 = promptAttempts[0];
    const attempt2 = promptAttempts[1] || null;

    const breakdown = await evaluatePromptQuestion({
      maxMarks: question.marks,
      promptMeta: question.promptMeta,
      attempt1Prompt: attempt1.prompt,
      attempt1Response: attempt1.aiResponse || undefined,
      attempt2Prompt: attempt2?.prompt || undefined,
      attempt2Response: attempt2?.aiResponse || undefined,
    });

    // Save evaluation result
    const evalResult = await prisma.evaluationResult.upsert({
      where: { attemptId_questionId: { attemptId: body.attemptId, questionId: body.questionId } },
      create: {
        attemptId: body.attemptId,
        questionId: body.questionId,
        candidateId: attempt.candidateId,
        problemUnderstanding: breakdown.problemUnderstanding,
        promptClarity: breakdown.promptClarity,
        technicalCompleteness: breakdown.technicalCompleteness,
        solutionCorrectness: breakdown.solutionCorrectness,
        outputQuality: breakdown.outputQuality,
        improvement: breakdown.improvement,
        totalMarksAwarded: breakdown.totalMarksAwarded,
        maxMarks: question.marks,
        testCasesPassed: breakdown.testCasesPassed,
        testCasesFailed: breakdown.testCasesFailed,
        isManualOverride: false,
        evaluatedAt: new Date(),
      },
      update: {
        problemUnderstanding: breakdown.problemUnderstanding,
        promptClarity: breakdown.promptClarity,
        technicalCompleteness: breakdown.technicalCompleteness,
        solutionCorrectness: breakdown.solutionCorrectness,
        outputQuality: breakdown.outputQuality,
        improvement: breakdown.improvement,
        totalMarksAwarded: breakdown.totalMarksAwarded,
        testCasesPassed: breakdown.testCasesPassed,
        testCasesFailed: breakdown.testCasesFailed,
        evaluatedAt: new Date(),
      },
    });

    // Cloud Firestore Sync (Module 3)
    await firestore.saveEvaluationResult({
      attemptId: body.attemptId,
      questionId: body.questionId,
      candidateId: attempt.candidateId,
      problemUnderstanding: breakdown.problemUnderstanding,
      promptClarity: breakdown.promptClarity,
      technicalCompleteness: breakdown.technicalCompleteness,
      solutionCorrectness: breakdown.solutionCorrectness,
      outputQuality: breakdown.outputQuality,
      improvement: breakdown.improvement,
      totalMarksAwarded: breakdown.totalMarksAwarded,
      maxMarks: question.marks,
      testCasesPassed: breakdown.testCasesPassed,
      testCasesFailed: breakdown.testCasesFailed,
      isManualOverride: false,
      evaluatedAt: new Date().toISOString(),
    });

    // Update Answer record
    const textAnswerJson = JSON.stringify({
      attempts: promptAttempts.map((p) => ({
        attemptNumber: p.attemptNumber,
        prompt: p.prompt,
        response: p.aiResponse,
        submittedAt: p.submittedAt,
      })),
      evaluationBreakdown: breakdown,
      locked: body.finalSubmit,
    });

    await prisma.answer.upsert({
      where: { attemptId_questionId: { attemptId: body.attemptId, questionId: body.questionId } },
      create: {
        attemptId: body.attemptId,
        questionId: body.questionId,
        textAnswer: textAnswerJson,
        marksAwarded: breakdown.totalMarksAwarded,
        autoGraded: true,
      },
      update: {
        textAnswer: textAnswerJson,
        marksAwarded: breakdown.totalMarksAwarded,
        autoGraded: true,
      },
    });

    res.json({
      evaluation: evalResult,
      breakdown,
    });
  })
);

/**
 * POST /api/prompt/override
 * HR Staff score review and manual override
 */
promptRouter.post(
  "/override",
  requireStaff,
  ah(async (req, res) => {
    const body = parse(
      z.object({
        attemptId: z.string(),
        questionId: z.string(),
        totalMarksAwarded: z.number().min(0).max(100),
        notes: z.string().trim().max(1000).optional(),
      }),
      req.body
    );

    const question = await prisma.question.findUnique({ where: { id: body.questionId } });
    if (!question) throw notFound("Question");

    const attempt = await prisma.attempt.findUnique({ where: { id: body.attemptId } });
    if (!attempt) throw notFound("Attempt");

    const updated = await prisma.evaluationResult.upsert({
      where: { attemptId_questionId: { attemptId: body.attemptId, questionId: body.questionId } },
      create: {
        attemptId: body.attemptId,
        questionId: body.questionId,
        candidateId: attempt.candidateId,
        totalMarksAwarded: body.totalMarksAwarded,
        maxMarks: question.marks,
        isManualOverride: true,
        evaluatorNotes: body.notes || "Manual HR score adjustment",
        evaluatedById: req.user!.id,
        evaluatedAt: new Date(),
      },
      update: {
        totalMarksAwarded: body.totalMarksAwarded,
        isManualOverride: true,
        evaluatorNotes: body.notes || "Manual HR score adjustment",
        evaluatedById: req.user!.id,
        evaluatedAt: new Date(),
      },
    });

    // Update Answer marksAwarded
    await prisma.answer.updateMany({
      where: { attemptId: body.attemptId, questionId: body.questionId },
      data: {
        marksAwarded: body.totalMarksAwarded,
        evaluatorId: req.user!.id,
        evaluatorNote: body.notes,
        evaluatedAt: new Date(),
      },
    });

    // Firestore Sync
    await firestore.saveEvaluationResult({
      attemptId: body.attemptId,
      questionId: body.questionId,
      candidateId: attempt.candidateId,
      totalMarksAwarded: body.totalMarksAwarded,
      maxMarks: question.marks,
      testCasesPassed: updated.testCasesPassed,
      testCasesFailed: updated.testCasesFailed,
      isManualOverride: true,
      evaluatorNotes: body.notes,
      evaluatedById: req.user!.id,
      evaluatedAt: new Date().toISOString(),
    });

    await audit(req, "evaluation.manual_override", "EvaluationResult", updated.id, {
      attemptId: body.attemptId,
      questionId: body.questionId,
      newMarks: body.totalMarksAwarded,
    });

    res.json(updated);
  })
);

/**
 * GET /api/prompt/attempts/:attemptId/:questionId
 * Retrieve prompt attempts and evaluation history
 */
promptRouter.get(
  "/attempts/:attemptId/:questionId",
  requireAuth,
  ah(async (req, res) => {
    const { attemptId, questionId } = req.params;

    const [attempts, evaluation] = await Promise.all([
      prisma.promptAttempt.findMany({
        where: { attemptId, questionId },
        orderBy: { attemptNumber: "asc" },
      }),
      prisma.evaluationResult.findUnique({
        where: { attemptId_questionId: { attemptId, questionId } },
      }),
    ]);

    res.json({ attempts, evaluation });
  })
);

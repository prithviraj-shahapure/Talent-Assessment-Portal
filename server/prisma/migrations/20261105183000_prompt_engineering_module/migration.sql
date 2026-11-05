-- AlterEnum
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'PROMPT';

-- AlterTable Question
ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "promptMeta" JSONB;

-- AlterTable ExamSession
ALTER TABLE "ExamSession" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "ExamSession_idempotencyKey_key" ON "ExamSession"("idempotencyKey");

-- CreateTable PromptAttempt
CREATE TABLE IF NOT EXISTS "PromptAttempt" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "aiResponse" TEXT,
    "testCaseResults" JSONB,
    "evaluation" JSONB,
    "score" DOUBLE PRECISION,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable EvaluationResult
CREATE TABLE IF NOT EXISTS "EvaluationResult" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "problemUnderstanding" DOUBLE PRECISION,
    "promptClarity" DOUBLE PRECISION,
    "technicalCompleteness" DOUBLE PRECISION,
    "solutionCorrectness" DOUBLE PRECISION,
    "outputQuality" DOUBLE PRECISION,
    "improvement" DOUBLE PRECISION,
    "totalMarksAwarded" DOUBLE PRECISION,
    "maxMarks" DOUBLE PRECISION NOT NULL,
    "testCasesPassed" INTEGER NOT NULL DEFAULT 0,
    "testCasesFailed" INTEGER NOT NULL DEFAULT 0,
    "isManualOverride" BOOLEAN NOT NULL DEFAULT false,
    "evaluatorNotes" TEXT,
    "evaluatedById" TEXT,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PromptAttempt_attemptId_questionId_idx" ON "PromptAttempt"("attemptId", "questionId");
CREATE INDEX IF NOT EXISTS "PromptAttempt_candidateId_idx" ON "PromptAttempt"("candidateId");
CREATE UNIQUE INDEX IF NOT EXISTS "EvaluationResult_attemptId_questionId_key" ON "EvaluationResult"("attemptId", "questionId");
CREATE INDEX IF NOT EXISTS "EvaluationResult_candidateId_idx" ON "EvaluationResult"("candidateId");

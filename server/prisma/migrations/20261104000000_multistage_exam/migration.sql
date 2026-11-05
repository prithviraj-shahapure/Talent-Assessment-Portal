-- Multi-Stage Examination & Question Generation Schema Extensions

-- 1. Alter Question table
ALTER TABLE "Question" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Question" ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "Question" ADD COLUMN "sectionTitle" TEXT;

-- 2. Alter ExamSection table
ALTER TABLE "ExamSection" ADD COLUMN "passingMarks" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "ExamSection" ADD COLUMN "negativeMarks" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "ExamSection" ADD COLUMN "instructions" TEXT;
ALTER TABLE "ExamSection" ADD COLUMN "isMandatory" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ExamSection" ADD COLUMN "sectionType" TEXT;
ALTER TABLE "ExamSection" ADD COLUMN "difficultyConfig" JSONB;

-- 3. Create CandidateSectionAttempt table
CREATE TABLE "CandidateSectionAttempt" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "sectionIndex" INTEGER NOT NULL,
    "sectionId" TEXT,
    "sectionTitle" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LOCKED',
    "timeLimitMinutes" INTEGER,
    "startedAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "score" DOUBLE PRECISION,
    "maxScore" DOUBLE PRECISION,
    "passed" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateSectionAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CandidateSectionAttempt_attemptId_sectionIndex_key" ON "CandidateSectionAttempt"("attemptId", "sectionIndex");

ALTER TABLE "CandidateSectionAttempt" ADD CONSTRAINT "CandidateSectionAttempt_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Alter Answer table to optionally link to CandidateSectionAttempt
ALTER TABLE "Answer" ADD COLUMN "sectionAttemptId" TEXT;
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_sectionAttemptId_fkey" FOREIGN KEY ("sectionAttemptId") REFERENCES "CandidateSectionAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Create QuestionImport table
CREATE TABLE "QuestionImport" (
    "id" TEXT NOT NULL,
    "examId" TEXT,
    "fileName" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'TXT',
    "totalQuestions" INTEGER NOT NULL DEFAULT 0,
    "validQuestions" INTEGER NOT NULL DEFAULT 0,
    "invalidQuestions" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "parsedData" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionImport_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "QuestionImport" ADD CONSTRAINT "QuestionImport_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;


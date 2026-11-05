-- AlterTable Question
ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "documentId" TEXT;
ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "documentSectionId" TEXT;
ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "questionOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateTable ExamDocument
CREATE TABLE IF NOT EXISTS "ExamDocument" (
    "id" TEXT NOT NULL,
    "documentName" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "rawText" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT,
    "processingStatus" TEXT NOT NULL DEFAULT 'PARSED',
    "totalSections" INTEGER NOT NULL DEFAULT 0,
    "totalQuestions" INTEGER NOT NULL DEFAULT 0,
    "assignedStageId" TEXT,
    "assignedExamId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable DocumentSection
CREATE TABLE IF NOT EXISTS "DocumentSection" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sectionTitle" TEXT NOT NULL,
    "sectionOrder" INTEGER NOT NULL DEFAULT 0,
    "totalQuestions" INTEGER NOT NULL DEFAULT 0,
    "totalMarks" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "timeLimitMinutes" INTEGER,
    "difficultyConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentSection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExamDocument_assignedExamId_assignedStageId_idx" ON "ExamDocument"("assignedExamId", "assignedStageId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DocumentSection_documentId_idx" ON "DocumentSection"("documentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Question_documentId_documentSectionId_idx" ON "Question"("documentId", "documentSectionId");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Question_documentId_fkey'
    ) THEN
        ALTER TABLE "Question" ADD CONSTRAINT "Question_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ExamDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Question_documentSectionId_fkey'
    ) THEN
        ALTER TABLE "Question" ADD CONSTRAINT "Question_documentSectionId_fkey" FOREIGN KEY ("documentSectionId") REFERENCES "DocumentSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ExamDocument_uploadedById_fkey'
    ) THEN
        ALTER TABLE "ExamDocument" ADD CONSTRAINT "ExamDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ExamDocument_assignedExamId_fkey'
    ) THEN
        ALTER TABLE "ExamDocument" ADD CONSTRAINT "ExamDocument_assignedExamId_fkey" FOREIGN KEY ("assignedExamId") REFERENCES "Exam"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'DocumentSection_documentId_fkey'
    ) THEN
        ALTER TABLE "DocumentSection" ADD CONSTRAINT "DocumentSection_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ExamDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

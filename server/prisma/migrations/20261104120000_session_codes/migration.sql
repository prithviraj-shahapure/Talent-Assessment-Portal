-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'PAUSED', 'EXPIRED', 'COMPLETED', 'REVOKED');

-- AlterTable Attempt
ALTER TABLE "Attempt" ADD COLUMN "sessionId" TEXT;

-- CreateTable ExamSession
CREATE TABLE "ExamSession" (
    "id" TEXT NOT NULL,
    "sessionName" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "sessionCodeHash" TEXT NOT NULL,
    "codeLastFour" TEXT NOT NULL,
    "codePrefix" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "maxCandidates" INTEGER NOT NULL DEFAULT 100,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "eligibility" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable SessionCandidate
CREATE TABLE "SessionCandidate" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accessStatus" TEXT NOT NULL DEFAULT 'INVITED',
    "joinedAt" TIMESTAMP(3),
    "attemptsUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable SessionAuditLog
CREATE TABLE "SessionAuditLog" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "candidateId" TEXT,
    "eventType" TEXT NOT NULL,
    "eventTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "ipAddress" TEXT,

    CONSTRAINT "SessionAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE UNIQUE INDEX "ExamSession_sessionCodeHash_key" ON "ExamSession"("sessionCodeHash");
CREATE INDEX "ExamSession_status_startsAt_endsAt_idx" ON "ExamSession"("status", "startsAt", "endsAt");

CREATE UNIQUE INDEX "SessionCandidate_sessionId_candidateId_key" ON "SessionCandidate"("sessionId", "candidateId");
CREATE INDEX "SessionCandidate_sessionId_accessStatus_idx" ON "SessionCandidate"("sessionId", "accessStatus");

CREATE INDEX "SessionAuditLog_sessionId_eventTimestamp_idx" ON "SessionAuditLog"("sessionId", "eventTimestamp");

-- AddForeignKeys
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ExamSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ExamSession" ADD CONSTRAINT "ExamSession_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamSession" ADD CONSTRAINT "ExamSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SessionCandidate" ADD CONSTRAINT "SessionCandidate_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ExamSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SessionCandidate" ADD CONSTRAINT "SessionCandidate_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionAuditLog" ADD CONSTRAINT "SessionAuditLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ExamSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;


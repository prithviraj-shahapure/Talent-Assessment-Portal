-- AlterEnum
ALTER TYPE "SessionStatus" ADD VALUE IF NOT EXISTS 'TERMINATED';
ALTER TYPE "AttemptStatus" ADD VALUE IF NOT EXISTS 'PAUSED';
ALTER TYPE "AttemptStatus" ADD VALUE IF NOT EXISTS 'ADMIN_SUBMITTED';
ALTER TYPE "AttemptStatus" ADD VALUE IF NOT EXISTS 'TERMINATED';

-- AlterTable Attempt
ALTER TABLE "Attempt" ADD COLUMN "submissionMethod" TEXT;
ALTER TABLE "Attempt" ADD COLUMN "pausedAt" TIMESTAMP(3);
ALTER TABLE "Attempt" ADD COLUMN "remainingSecondsAtPause" INTEGER;
ALTER TABLE "Attempt" ADD COLUMN "sectionRemainingSecondsAtPause" INTEGER;
ALTER TABLE "Attempt" ADD COLUMN "terminatedAt" TIMESTAMP(3);
ALTER TABLE "Attempt" ADD COLUMN "terminatedReason" TEXT;
ALTER TABLE "Attempt" ADD COLUMN "terminatedById" TEXT;
ALTER TABLE "Attempt" ADD COLUMN "reentryCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable ExamSession
ALTER TABLE "ExamSession" ADD COLUMN "pausedAt" TIMESTAMP(3);
ALTER TABLE "ExamSession" ADD COLUMN "terminatedAt" TIMESTAMP(3);
ALTER TABLE "ExamSession" ADD COLUMN "terminatedReason" TEXT;
ALTER TABLE "ExamSession" ADD COLUMN "terminatedById" TEXT;
ALTER TABLE "ExamSession" ADD COLUMN "recoveredAt" TIMESTAMP(3);
ALTER TABLE "ExamSession" ADD COLUMN "recoveredById" TEXT;
ALTER TABLE "ExamSession" ADD COLUMN "recoveryReason" TEXT;

-- CreateTable AdminActionAuditLog
CREATE TABLE "AdminActionAuditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "candidateId" TEXT,
    "sessionId" TEXT,
    "examId" TEXT,
    "actionType" TEXT NOT NULL,
    "actionReason" TEXT,
    "previousStatus" TEXT,
    "newStatus" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminActionAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminActionAuditLog_sessionId_createdAt_idx" ON "AdminActionAuditLog"("sessionId", "createdAt");
CREATE INDEX "AdminActionAuditLog_adminId_createdAt_idx" ON "AdminActionAuditLog"("adminId", "createdAt");
CREATE INDEX "AdminActionAuditLog_actionType_createdAt_idx" ON "AdminActionAuditLog"("actionType", "createdAt");

-- AddForeignKey
ALTER TABLE "AdminActionAuditLog" ADD CONSTRAINT "AdminActionAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminActionAuditLog" ADD CONSTRAINT "AdminActionAuditLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ExamSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;


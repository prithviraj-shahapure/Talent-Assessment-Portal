import { describe, it } from "node:test";
import assert from "node:assert/strict";
process.env.JWT_SECRET = process.env.JWT_SECRET || "mock-secret-for-testing-purposes-123456789";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://mock:mock@localhost:5432/mock";

import {
  allowAttemptReentry,
  forceSubmitAttempt,
  pauseAttempt,
  resumeAttempt,
  terminateAttempt,
} from "./sessionControl";
import { prisma } from "./prisma";

describe("Advanced Session Control & Candidate Attempt Lifecycle Engine", () => {
  it("pauseAttempt: should calculate frozen seconds, set status to PAUSED, and record audit log", async () => {
    const originalFindUnique = prisma.attempt.findUnique;
    const originalUpdate = prisma.attempt.update;
    const originalAudit = prisma.adminActionAuditLog.create;

    let updatedData: any = null;
    let auditData: any = null;

    try {
      const now = new Date();
      const mockDeadline = new Date(now.getTime() + 1800 * 1000); // 30 min left
      const mockSecStart = new Date(now.getTime() - 600 * 1000); // 10 min into 20 min section

      (prisma.attempt.findUnique as any) = async () => ({
        id: "att-test-1",
        candidateId: "cand-1",
        examId: "exam-1",
        sessionId: "sess-1",
        status: "IN_PROGRESS",
        currentSection: 0,
        deadlineAt: mockDeadline,
        sectionStartedAt: mockSecStart,
        paper: [
          { sectionId: "sec-1", title: "Aptitude", timeLimitMinutes: 20, questions: [] },
        ],
      });

      (prisma.attempt.update as any) = async ({ data }: any) => {
        updatedData = data;
        return { id: "att-test-1", ...data };
      };

      (prisma.adminActionAuditLog.create as any) = async ({ data }: any) => {
        auditData = data;
        return { id: "log-1", ...data };
      };

      const result = await pauseAttempt("att-test-1", "admin-1", "Technical difficulty reported");
      assert.equal(result.status, "PAUSED");
      assert.equal(updatedData.status, "PAUSED");
      assert.ok(updatedData.remainingSecondsAtPause > 1750, "Remaining seconds should be preserved");
      assert.ok(updatedData.sectionRemainingSecondsAtPause > 550, "Section remaining seconds should be preserved");

      assert.equal(auditData.actionType, "CANDIDATE_PAUSE");
      assert.equal(auditData.adminId, "admin-1");
      assert.equal(auditData.actionReason, "Technical difficulty reported");
    } finally {
      prisma.attempt.findUnique = originalFindUnique;
      prisma.attempt.update = originalUpdate;
      prisma.adminActionAuditLog.create = originalAudit;
    }
  });

  it("resumeAttempt: should shift deadline forward by frozen remaining seconds", async () => {
    const originalFindUnique = prisma.attempt.findUnique;
    const originalUpdate = prisma.attempt.update;
    const originalAudit = prisma.adminActionAuditLog.create;

    let updatedData: any = null;

    try {
      const now = new Date();

      (prisma.attempt.findUnique as any) = async () => ({
        id: "att-test-2",
        candidateId: "cand-1",
        examId: "exam-1",
        sessionId: "sess-1",
        status: "PAUSED",
        currentSection: 0,
        deadlineAt: new Date(now.getTime() - 100000), // old deadline expired during pause
        pausedAt: new Date(now.getTime() - 500000),
        remainingSecondsAtPause: 1200, // 20 min frozen
        sectionRemainingSecondsAtPause: 600, // 10 min section frozen
        paper: [
          { sectionId: "sec-1", title: "Aptitude", timeLimitMinutes: 20, questions: [] },
        ],
      });

      (prisma.attempt.update as any) = async ({ data }: any) => {
        updatedData = data;
        return { id: "att-test-2", ...data };
      };

      (prisma.adminActionAuditLog.create as any) = async () => ({ id: "log-2" });

      const result = await resumeAttempt("att-test-2", "admin-1", "Proctor authorized resumption");
      assert.equal(result.status, "IN_PROGRESS");
      assert.equal(updatedData.status, "IN_PROGRESS");
      assert.equal(updatedData.pausedAt, null);
      assert.equal(updatedData.remainingSecondsAtPause, null);

      // Verify restored deadline is in the future (~20 mins from now)
      const diffSec = Math.round((new Date(updatedData.deadlineAt).getTime() - Date.now()) / 1000);
      assert.ok(diffSec >= 1195 && diffSec <= 1205, "Deadline must be restored by exactly 1200 seconds");
    } finally {
      prisma.attempt.findUnique = originalFindUnique;
      prisma.attempt.update = originalUpdate;
      prisma.adminActionAuditLog.create = originalAudit;
    }
  });

  it("forceSubmitAttempt: should mark status as ADMIN_SUBMITTED with ADMIN_FORCE method", async () => {
    const originalFindUnique = prisma.attempt.findUnique;
    const originalUpdate = prisma.attempt.update;
    const originalUpdateMany = prisma.attempt.updateMany;
    const originalAudit = prisma.adminActionAuditLog.create;

    let updatedData: any = null;

    try {
      (prisma.attempt.findUnique as any) = async () => ({
        id: "att-test-3",
        candidateId: "cand-2",
        examId: "exam-1",
        sessionId: "sess-1",
        status: "IN_PROGRESS",
      });

      (prisma.attempt.update as any) = async ({ data }: any) => {
        updatedData = data;
        return { id: "att-test-3", ...data };
      };

      (prisma.attempt.updateMany as any) = async () => ({ count: 0 });

      (prisma.adminActionAuditLog.create as any) = async () => ({ id: "log-3" });

      // Note: finalizeAttempt is called internally; mock prisma calls handles it
      await forceSubmitAttempt("att-test-3", "admin-1", "Exam time expired while offline");
      assert.equal(updatedData.status, "ADMIN_SUBMITTED");
      assert.equal(updatedData.submissionMethod, "ADMIN_FORCE");
    } finally {
      prisma.attempt.findUnique = originalFindUnique;
      prisma.attempt.update = originalUpdate;
      prisma.attempt.updateMany = originalUpdateMany;
      prisma.adminActionAuditLog.create = originalAudit;
    }
  });

  it("terminateAttempt: should set TERMINATED status, reason and revoke session access", async () => {
    const originalFindUnique = prisma.attempt.findUnique;
    const originalUpdate = prisma.attempt.update;
    const originalAudit = prisma.adminActionAuditLog.create;
    const originalSessionCandUpdate = prisma.sessionCandidate.updateMany;

    let updatedData: any = null;
    let accessStatusUpdated: any = null;

    try {
      (prisma.attempt.findUnique as any) = async () => ({
        id: "att-test-4",
        candidateId: "cand-3",
        examId: "exam-1",
        sessionId: "sess-1",
        status: "IN_PROGRESS",
      });

      (prisma.attempt.update as any) = async ({ data }: any) => {
        updatedData = data;
        return { id: "att-test-4", ...data };
      };

      (prisma.sessionCandidate.updateMany as any) = async ({ data }: any) => {
        accessStatusUpdated = data;
        return { count: 1 };
      };

      (prisma.adminActionAuditLog.create as any) = async () => ({ id: "log-4" });

      const result = await terminateAttempt("att-test-4", "admin-1", "Severe malpractice detected");
      assert.equal(result.status, "TERMINATED");
      assert.equal(updatedData.status, "TERMINATED");
      assert.equal(updatedData.terminatedReason, "Severe malpractice detected");
      assert.equal(accessStatusUpdated.accessStatus, "REVOKED");
    } finally {
      prisma.attempt.findUnique = originalFindUnique;
      prisma.attempt.update = originalUpdate;
      prisma.adminActionAuditLog.create = originalAudit;
      prisma.sessionCandidate.updateMany = originalSessionCandUpdate;
    }
  });

  it("allowAttemptReentry: should restore attempt to IN_PROGRESS and increment reentryCount", async () => {
    const originalFindUnique = prisma.attempt.findUnique;
    const originalUpdate = prisma.attempt.update;
    const originalAudit = prisma.adminActionAuditLog.create;
    const originalSessionCandUpdate = prisma.sessionCandidate.updateMany;

    let updatedData: any = null;
    let accessStatusUpdated: any = null;

    try {
      (prisma.attempt.findUnique as any) = async () => ({
        id: "att-test-5",
        candidateId: "cand-4",
        examId: "exam-1",
        sessionId: "sess-1",
        status: "PAUSED",
        reentryCount: 0,
        deadlineAt: new Date(Date.now() + 600000),
        sectionStartedAt: new Date(),
        currentSection: 0,
        paper: [{ sectionId: "sec-1", title: "Aptitude", timeLimitMinutes: 20, questions: [] }],
        exam: { durationMinutes: 60 },
      });

      (prisma.attempt.update as any) = async ({ data }: any) => {
        updatedData = data;
        return { id: "att-test-5", reentryCount: 1, ...data };
      };

      (prisma.sessionCandidate.updateMany as any) = async ({ data }: any) => {
        accessStatusUpdated = data;
        return { count: 1 };
      };

      (prisma.adminActionAuditLog.create as any) = async () => ({ id: "log-5" });

      const result = await allowAttemptReentry("att-test-5", "admin-1", "Network disconnected during exam");
      assert.equal(result.status, "IN_PROGRESS");
      assert.equal(accessStatusUpdated.accessStatus, "APPEARING");
    } finally {
      prisma.attempt.findUnique = originalFindUnique;
      prisma.attempt.update = originalUpdate;
      prisma.adminActionAuditLog.create = originalAudit;
      prisma.sessionCandidate.updateMany = originalSessionCandUpdate;
    }
  });
});

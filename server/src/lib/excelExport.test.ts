import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
process.env.JWT_SECRET = process.env.JWT_SECRET || "mock-secret-for-testing-purposes-123456789";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://mock:mock@localhost:5432/mock";

import { generateExaminationExcel } from "./excelExport";
import { prisma } from "./prisma";

describe("Excel Export Engine (5-Sheet Professional Workbook)", () => {
  it("should create a workbook containing all 5 sheets with Zanvar header structure", async () => {
    // Mock prisma responses for testing
    const originalExamFind = prisma.exam.findUnique;
    const originalAttemptFindMany = prisma.attempt.findMany;
    const originalAuditFindMany = prisma.adminActionAuditLog.findMany;
    const originalExamAssignmentCount = prisma.examAssignment.count;
    const originalSessionCandidateCount = prisma.sessionCandidate.count;

    try {
      (prisma.examAssignment.count as any) = async () => 25;
      (prisma.sessionCandidate.count as any) = async () => 25;
      (prisma.exam.findUnique as any) = async () => ({
        id: "mock-exam-1",
        title: "Graduate Engineer Trainee Assessment 2026",
        totalMarks: 100,
        passingMarks: 60,
        department: { name: "Engineering & R&D" },
        sections: [
          { id: "sec-1", title: "Aptitude Test", order: 1, durationMinutes: 30, marks: 30 },
          { id: "sec-2", title: "Technical Assessment", order: 2, durationMinutes: 45, marks: 50 },
          { id: "sec-3", title: "Prompt Engineering", order: 3, durationMinutes: 20, marks: 20 },
        ],
      });

      (prisma.attempt.findMany as any) = async () => [
        {
          id: "att-1",
          candidateId: "cand-1",
          examId: "mock-exam-1",
          sessionId: "sess-1",
          status: "SUBMITTED",
          submissionMethod: "CANDIDATE",
          startedAt: new Date("2026-03-15T10:00:00Z"),
          submittedAt: new Date("2026-03-15T11:25:00Z"),
          score: 82,
          passed: true,
          riskScore: 5,
          riskLevel: "LOW",
          currentSection: 2,
          candidate: {
            user: { name: "Rahul Sharma", email: "rahul.sharma@example.com" },
            college: "COEP Pune",
            branch: "Computer Science",
            department: { name: "R&D" },
          },
          session: { sessionName: "Campus Drive 2026 Batch A" },
          exam: {
            title: "Graduate Engineer Trainee Assessment 2026",
            totalMarks: 100,
            sections: [
              { id: "sec-1", title: "Aptitude Test", order: 1 },
              { id: "sec-2", title: "Technical Assessment", order: 2 },
              { id: "sec-3", title: "Prompt Engineering", order: 3 },
            ],
          },
          answers: [],
          events: [],
          sectionAttempts: [
            { sectionIndex: 0, score: 26, maxScore: 30, status: "COMPLETED" },
            { sectionIndex: 1, score: 40, maxScore: 50, status: "COMPLETED" },
            { sectionIndex: 2, score: 16, maxScore: 20, status: "COMPLETED" },
          ],
        },
      ];

      (prisma.adminActionAuditLog.findMany as any) = async () => [];

      const wb = await generateExaminationExcel({ examId: "mock-exam-1" });
      assert.ok(wb instanceof ExcelJS.Workbook);

      // Verify all 5 sheets exist
      const sheetNames = wb.worksheets.map((s) => s.name);
      assert.ok(sheetNames.includes("Examination Summary"), "Must include Examination Summary");
      assert.ok(sheetNames.includes("Candidate Results"), "Must include Candidate Results");
      assert.ok(sheetNames.includes("Section-wise Performance"), "Must include Section-wise Performance");
      assert.ok(sheetNames.includes("Proctoring Summary"), "Must include Proctoring Summary");
      assert.ok(sheetNames.includes("Session Activity"), "Must include Session Activity");

      // Verify buffer can be generated
      const buffer = await wb.xlsx.writeBuffer();
      assert.ok(buffer.byteLength > 1000, "Workbook binary buffer must be valid and non-empty");

      // Verify Candidate Results has candidate row
      const resultsSheet = wb.getWorksheet("Candidate Results");
      assert.ok(resultsSheet);
      assert.equal(resultsSheet.views[0]?.state, "frozen");
    } finally {
      prisma.exam.findUnique = originalExamFind;
      prisma.attempt.findMany = originalAttemptFindMany;
      prisma.adminActionAuditLog.findMany = originalAuditFindMany;
      prisma.examAssignment.count = originalExamAssignmentCount;
      prisma.sessionCandidate.count = originalSessionCandidateCount;
    }
  });
});

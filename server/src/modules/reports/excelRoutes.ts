import { Router } from "express";
import { z } from "zod";
import { ah, parse } from "../../lib/http";
import { requireStaff } from "../../middleware/auth";
import { audit } from "../../lib/audit";
import { generateExaminationExcel } from "../../lib/excelExport";
import { generateAssessmentReportWorkbook } from "../../lib/promptExcelExport";

export const excelReportRouter = Router();
excelReportRouter.use(requireStaff);

/**
 * MODULE 4: Official 3-Sheet Assessment Report Export
 * Sheets: Candidate Records, Question Performance, Prompt Attempts
 * Actions: Export All, Export by Session, Export by Branch, Export Individual Candidate
 */
excelReportRouter.get(
  "/assessment-export",
  ah(async (req, res) => {
    const scope = (req.query.scope ? String(req.query.scope) : "all") as "all" | "session" | "branch" | "candidate";
    const sessionId = req.query.sessionId ? String(req.query.sessionId) : undefined;
    const branch = req.query.branch ? String(req.query.branch) : undefined;
    const candidateId = req.query.candidateId ? String(req.query.candidateId) : undefined;
    const examId = req.query.examId ? String(req.query.examId) : undefined;

    const workbook = await generateAssessmentReportWorkbook({
      scope,
      sessionId,
      branch,
      candidateId,
      examId,
    });

    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `Zanvar-Assessment-Report-${scope}-${timestamp}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await audit(req, "report.assessment_excel_export", "Exam", scope, {
      scope,
      sessionId,
      branch,
      candidateId,
    });

    await workbook.xlsx.write(res);
    res.end();
  })
);

/**
 * Universal Excel Export endpoint with multi-sheet structure,
 * dynamic section columns, proctoring summary, and advanced filters.
 */
excelReportRouter.get(
  "/export",
  ah(async (req, res) => {
    const examId = req.query.examId ? String(req.query.examId) : undefined;
    const sessionId = req.query.sessionId ? String(req.query.sessionId) : undefined;
    const passFail = req.query.passFail ? (String(req.query.passFail) as "PASS" | "FAIL" | "ALL") : undefined;
    const minPercentage = req.query.minPercentage ? parseFloat(String(req.query.minPercentage)) : undefined;
    const includeIncompleteOrTerminated = req.query.includeIncomplete === "true" || req.query.includeIncomplete === "1";

    const workbook = await generateExaminationExcel({
      examId,
      sessionId,
      passFail,
      minPercentage,
      includeIncompleteOrTerminated,
    });

    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `Zanvar-Exam-Report-${timestamp}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await audit(req, "report.excel_export", "Exam", examId || sessionId || "ALL", {
      examId,
      sessionId,
      passFail,
      minPercentage,
    });

    await workbook.xlsx.write(res);
    res.end();
  })
);


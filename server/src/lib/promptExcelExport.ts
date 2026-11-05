import ExcelJS from "exceljs";
import { prisma } from "./prisma";

export interface AssessmentExportOptions {
  scope?: "all" | "session" | "branch" | "candidate";
  sessionId?: string;
  branch?: string;
  candidateId?: string;
  examId?: string;
}

const NAVY_HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF15294D" }, // Zanvar Dark Navy
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  name: "Segoe UI",
  size: 11,
  bold: true,
  color: { argb: "FFFFFFFF" },
};

const DATA_FONT: Partial<ExcelJS.Font> = {
  name: "Segoe UI",
  size: 10,
};

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFE2E8F0" } },
  left: { style: "thin", color: { argb: "FFE2E8F0" } },
  bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
  right: { style: "thin", color: { argb: "FFE2E8F0" } },
};

function formatDateTime(dt?: Date | string | null): string {
  if (!dt) return "N/A";
  const d = new Date(dt);
  if (isNaN(d.getTime())) return "N/A";
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function autoFitColumns(sheet: ExcelJS.Worksheet) {
  sheet.columns.forEach((column) => {
    let maxLen = 12;
    if (column.header) {
      maxLen = Math.max(maxLen, String(column.header).length + 3);
    }
    column.eachCell?.({ includeEmpty: false }, (cell) => {
      const val = cell.value;
      if (val !== null && val !== undefined) {
        const str = typeof val === "object" ? JSON.stringify(val) : String(val);
        // Cap single line length for wide text like prompts
        const firstLine = str.split("\n")[0];
        maxLen = Math.max(maxLen, Math.min(firstLine.length + 2, 50));
      }
    });
    column.width = Math.min(Math.max(maxLen, 12), 60);
  });
}

function applyHeaderStyle(sheet: ExcelJS.Worksheet) {
  const headerRow = sheet.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.fill = NAVY_HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = THIN_BORDER;
  });
}

/**
 * Generates the Official 3-Sheet XLSX Workbook:
 *   Sheet 1: Candidate Records
 *   Sheet 2: Question Performance
 *   Sheet 3: Prompt Attempts
 */
export async function generateAssessmentReportWorkbook(
  options: AssessmentExportOptions
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Zanvar Group Talent Assessment Portal";
  wb.created = new Date();

  // 1. Build Query Filters based on scope
  const candidateWhere: any = {};
  const attemptWhere: any = {};

  if (options.scope === "candidate" && options.candidateId) {
    candidateWhere.id = options.candidateId;
    attemptWhere.candidateId = options.candidateId;
  } else if (options.scope === "branch" && options.branch) {
    candidateWhere.branch = { contains: options.branch, mode: "insensitive" };
    attemptWhere.candidate = { branch: { contains: options.branch, mode: "insensitive" } };
  } else if (options.scope === "session" && options.sessionId) {
    attemptWhere.sessionId = options.sessionId;
  }

  if (options.examId) {
    attemptWhere.examId = options.examId;
  }

  // 2. Query Candidate Records & Attempts
  const attempts = await prisma.attempt.findMany({
    where: attemptWhere,
    include: {
      candidate: {
        include: {
          user: { select: { name: true, email: true } },
        },
      },
      session: { select: { sessionName: true, codeLastFour: true, codePrefix: true } },
      exam: { select: { title: true } },
      answers: {
        include: {
          question: true,
        },
      },
    },
    orderBy: { startedAt: "desc" },
  });

  // Query PromptAttempts matching attempts or candidates
  const attemptIds = attempts.map((a) => a.id);
  const promptAttempts = await prisma.promptAttempt.findMany({
    where: attemptIds.length ? { attemptId: { in: attemptIds } } : undefined,
    orderBy: [{ candidateId: "asc" }, { questionId: "asc" }, { attemptNumber: "asc" }],
  });

  // Query EvaluationResults
  const evaluationResults = await prisma.evaluationResult.findMany({
    where: attemptIds.length ? { attemptId: { in: attemptIds } } : undefined,
  });
  const evalMap = new Map<string, typeof evaluationResults[0]>();
  for (const er of evaluationResults) {
    evalMap.set(`${er.attemptId}_${er.questionId}`, er);
  }

  // ─────────────────────────────────────────────────────────────
  // SHEET 1: Candidate Records
  // ─────────────────────────────────────────────────────────────
  const sheet1 = wb.addWorksheet("Candidate Records", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet1.columns = [
    { header: "Candidate ID", key: "candidateId" },
    { header: "Candidate Name", key: "name" },
    { header: "Email", key: "email" },
    { header: "Branch", key: "branch" },
    { header: "Session Code", key: "sessionCode" },
    { header: "Examination Status", key: "status" },
    { header: "Total Marks", key: "totalMarks" },
    { header: "Start Time", key: "startTime" },
    { header: "Submission Time", key: "submissionTime" },
  ];

  for (const a of attempts) {
    const sCode = a.session
      ? (a.session.codePrefix ? `${a.session.codePrefix}-` : "") + a.session.codeLastFour
      : "Direct / Portal";

    const row = sheet1.addRow({
      candidateId: a.candidateId,
      name: a.candidate.user.name || "N/A",
      email: a.candidate.user.email || "N/A",
      branch: a.candidate.branch || "General",
      sessionCode: sCode,
      examinationStatus: a.status,
      totalMarks: a.score !== null ? a.score : 0,
      startTime: formatDateTime(a.startedAt),
      submissionTime: formatDateTime(a.submittedAt),
    });

    row.font = DATA_FONT;
    row.eachCell((c) => {
      c.border = THIN_BORDER;
    });
  }
  applyHeaderStyle(sheet1);
  autoFitColumns(sheet1);

  // ─────────────────────────────────────────────────────────────
  // SHEET 2: Question Performance
  // ─────────────────────────────────────────────────────────────
  const sheet2 = wb.addWorksheet("Question Performance", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet2.columns = [
    { header: "Candidate ID", key: "candidateId" },
    { header: "Question ID", key: "questionId" },
    { header: "Question Title", key: "questionTitle" },
    { header: "Attempt Count", key: "attemptCount" },
    { header: "Marks Obtained", key: "marksObtained" },
    { header: "Maximum Marks", key: "maximumMarks" },
    { header: "Test Cases Passed", key: "testCasesPassed" },
    { header: "Test Cases Failed", key: "testCasesFailed" },
    { header: "Evaluation Status", key: "evaluationStatus" },
  ];

  for (const a of attempts) {
    for (const ans of a.answers) {
      const q = ans.question;
      const key = `${a.id}_${q.id}`;
      const evalRes = evalMap.get(key);

      // Determine attempt count for prompt or standard questions
      const promptCount = promptAttempts.filter((pa) => pa.attemptId === a.id && pa.questionId === q.id).length;
      const attemptCount = promptCount > 0 ? promptCount : ans.textAnswer || ans.selectedOptionIds.length ? 1 : 0;

      const marksObtained = ans.marksAwarded !== null ? ans.marksAwarded : 0;
      const maxMarks = q.marks || 1;

      const passedTC = evalRes?.testCasesPassed ?? (ans.isCorrect ? 1 : 0);
      const failedTC = evalRes?.testCasesFailed ?? (ans.isCorrect === false ? 1 : 0);

      let evalStatus = "Evaluated";
      if (evalRes?.isManualOverride) evalStatus = "Manual Override";
      else if (ans.marksAwarded === null && (q.type === "DESCRIPTIVE" || q.type === "PROMPT")) evalStatus = "Pending Review";
      else if (ans.autoGraded) evalStatus = "Auto Graded";

      const title = (q.promptMeta as any)?.title || q.text.slice(0, 45) + (q.text.length > 45 ? "..." : "");

      const row = sheet2.addRow({
        candidateId: a.candidateId,
        questionId: q.id,
        questionTitle: title,
        attemptCount,
        marksObtained,
        maximumMarks: maxMarks,
        testCasesPassed: passedTC,
        testCasesFailed: failedTC,
        evaluationStatus: evalStatus,
      });

      row.font = DATA_FONT;
      row.eachCell((c) => {
        c.border = THIN_BORDER;
      });
    }
  }
  applyHeaderStyle(sheet2);
  autoFitColumns(sheet2);

  // ─────────────────────────────────────────────────────────────
  // SHEET 3: Prompt Attempts
  // ─────────────────────────────────────────────────────────────
  const sheet3 = wb.addWorksheet("Prompt Attempts", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet3.columns = [
    { header: "Candidate ID", key: "candidateId" },
    { header: "Question ID", key: "questionId" },
    { header: "Attempt Number", key: "attemptNumber" },
    { header: "Submitted Prompt", key: "submittedPrompt" },
    { header: "Generated AI Response", key: "generatedAIResponse" },
    { header: "Evaluation Score", key: "evaluationScore" },
    { header: "Submission Timestamp", key: "submissionTimestamp" },
  ];

  for (const pa of promptAttempts) {
    const key = `${pa.attemptId}_${pa.questionId}`;
    const evalRes = evalMap.get(key);
    const score = evalRes?.totalMarksAwarded ?? pa.score ?? 0;

    const row = sheet3.addRow({
      candidateId: pa.candidateId,
      questionId: pa.questionId,
      attemptNumber: pa.attemptNumber,
      submittedPrompt: pa.prompt || "N/A",
      generatedAIResponse: pa.aiResponse || "No response generated",
      evaluationScore: score,
      submissionTimestamp: formatDateTime(pa.submittedAt),
    });

    row.font = DATA_FONT;
    row.eachCell((c) => {
      c.border = THIN_BORDER;
    });
  }
  applyHeaderStyle(sheet3);
  autoFitColumns(sheet3);

  return wb;
}

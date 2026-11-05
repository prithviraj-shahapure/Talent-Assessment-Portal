import ExcelJS from "exceljs";
import { prisma } from "./prisma";
import type { Paper } from "./engine";

export interface ExportFilterOptions {
  examId?: string;
  sessionId?: string;
  status?: string;
  passFail?: "PASS" | "FAIL" | "ALL";
  minPercentage?: number;
  includeIncompleteOrTerminated?: boolean;
}

export async function generateExaminationExcel(options: ExportFilterOptions): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Zanvar Group Talent Assessment Portal";
  wb.created = new Date();

  // 1. Fetch Exam & Session Metadata
  let exam: any = null;
  let session: any = null;

  if (options.sessionId) {
    session = await prisma.examSession.findUnique({
      where: { id: options.sessionId },
      include: {
        exam: {
          include: {
            sections: { orderBy: { order: "asc" } },
            department: true,
          },
        },
      },
    });
    if (session) exam = session.exam;
  }

  if (!exam && options.examId) {
    exam = await prisma.exam.findUnique({
      where: { id: options.examId },
      include: {
        sections: { orderBy: { order: "asc" } },
        department: true,
      },
    });
  }

  // 2. Fetch Attempts matching criteria
  const attemptWhere: any = {};
  if (options.examId) attemptWhere.examId = options.examId;
  if (options.sessionId) attemptWhere.sessionId = options.sessionId;

  // By default, include only submitted, auto-submitted, or admin-submitted examinations
  if (!options.includeIncompleteOrTerminated) {
    attemptWhere.status = { in: ["SUBMITTED", "AUTO_SUBMITTED", "ADMIN_SUBMITTED", "EVALUATED"] };
  }

  const attempts = await prisma.attempt.findMany({
    where: attemptWhere,
    include: {
      candidate: {
        include: {
          user: true,
          department: true,
        },
      },
      session: true,
      exam: {
        include: { sections: { orderBy: { order: "asc" } } },
      },
      answers: {
        include: { question: true },
      },
      events: true,
      sectionAttempts: true,
    },
    orderBy: { score: "desc" },
  });

  // Filter pass/fail and min percentage if specified
  const filteredAttempts = attempts.filter((a) => {
    if (options.minPercentage !== undefined && (a.percentage ?? 0) < options.minPercentage) {
      return false;
    }
    if (options.passFail === "PASS" && !a.passed) return false;
    if (options.passFail === "FAIL" && a.passed) return false;
    return true;
  });

  // Collect all unique sections across attempts for dynamic column generation
  const sectionsList: { id: string; title: string; maxMarks: number }[] = [];
  const sectionIdSet = new Set<string>();

  if (exam?.sections) {
    exam.sections.forEach((s: any) => {
      if (!sectionIdSet.has(s.id)) {
        sectionIdSet.add(s.id);
        sectionsList.push({ id: s.id, title: s.title, maxMarks: s.questions?.reduce((acc: number, q: any) => acc + (q.marks || 1), 0) || 0 });
      }
    });
  }

  // Also check paper snapshots if custom
  filteredAttempts.forEach((a) => {
    const paper = a.paper as unknown as Paper;
    if (Array.isArray(paper)) {
      paper.forEach((s) => {
        if (!sectionIdSet.has(s.sectionId)) {
          sectionIdSet.add(s.sectionId);
          sectionsList.push({
            id: s.sectionId,
            title: s.title,
            maxMarks: s.questions?.reduce((acc, q) => acc + q.marks, 0) || 0,
          });
        }
      });
    }
  });

  // Calculate statistics
  const totalRegistered = session ? await prisma.sessionCandidate.count({ where: { sessionId: session.id } }) : (exam ? await prisma.examAssignment.count({ where: { examId: exam.id } }) : filteredAttempts.length);
  const totalAppeared = filteredAttempts.length;
  const submittedCount = filteredAttempts.filter((a) => a.status === "SUBMITTED" || a.status === "EVALUATED").length;
  const autoSubmittedCount = filteredAttempts.filter((a) => a.status === "AUTO_SUBMITTED").length;
  const adminSubmittedCount = filteredAttempts.filter((a) => a.status === "ADMIN_SUBMITTED").length;
  const scores = filteredAttempts.map((a) => a.score ?? 0);
  const avgScore = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : 0;
  const highestScore = scores.length ? Math.max(...scores) : 0;
  const lowestScore = scores.length ? Math.min(...scores) : 0;
  const passCount = filteredAttempts.filter((a) => a.passed).length;
  const failCount = filteredAttempts.filter((a) => a.passed === false).length;

  // ─────────────────────────────────────────────────────────────────────────────
  // SHEET 1: EXAMINATION SUMMARY
  // ─────────────────────────────────────────────────────────────────────────────
  const wsSummary = wb.addWorksheet("Examination Summary");
  wsSummary.views = [{ showGridLines: true }];

  // Zanvar Header Style
  wsSummary.mergeCells("A1:D1");
  const titleCell = wsSummary.getCell("A1");
  titleCell.value = "ZANVAR GROUP · TALENT ASSESSMENT PORTAL";
  titleCell.font = { name: "Calibri", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F1F3D" } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  wsSummary.getRow(1).height = 36;

  wsSummary.mergeCells("A2:D2");
  const subCell = wsSummary.getCell("A2");
  subCell.value = "Comprehensive Examination & Session Performance Summary";
  subCell.font = { name: "Calibri", size: 11, italic: true, color: { argb: "FF4B5563" } };
  subCell.alignment = { horizontal: "center", vertical: "middle" };
  wsSummary.getRow(2).height = 22;

  const summaryData = [
    ["Organization", "Zanvar Group"],
    ["Examination Name", exam?.title || "All Examinations"],
    ["Session Name", session?.sessionName || "All Sessions"],
    ["Examination Date", session ? session.startsAt.toLocaleDateString("en-IN") : new Date().toLocaleDateString("en-IN")],
    ["Report Generated At", new Date().toLocaleString("en-IN")],
    ["", ""],
    ["Total Registered Candidates", totalRegistered],
    ["Total Candidates Appeared", totalAppeared],
    ["Total Candidates Submitted", submittedCount],
    ["Total Auto-Submitted (Time Expired)", autoSubmittedCount],
    ["Total Admin-Submitted (Force Submit)", adminSubmittedCount],
    ["", ""],
    ["Average Score", avgScore],
    ["Highest Score", highestScore],
    ["Lowest Score", lowestScore],
    ["Passing Candidates", passCount],
    ["Failing Candidates", failCount],
  ];

  summaryData.forEach(([k, v], idx) => {
    const row = wsSummary.addRow([k, v]);
    if (k && !v) return;
    if (k) {
      row.getCell(1).font = { bold: true, color: { argb: "FF1F2937" } };
      row.getCell(2).font = { name: "Calibri" };
    }
  });

  wsSummary.getColumn(1).width = 34;
  wsSummary.getColumn(2).width = 38;

  // ─────────────────────────────────────────────────────────────────────────────
  // SHEET 2: CANDIDATE RESULTS
  // ─────────────────────────────────────────────────────────────────────────────
  const wsResults = wb.addWorksheet("Candidate Results");
  wsResults.views = [{ state: "frozen", ySplit: 1, showGridLines: true }];

  // Dynamic section columns
  const sectionCols = sectionsList.map((s, idx) => ({
    header: `${s.title} Score`,
    key: `sec_${idx}`,
    width: 18,
  }));

  wsResults.columns = [
    { header: "Sr. No.", key: "srNo", width: 8 },
    { header: "Candidate ID", key: "candidateId", width: 16 },
    { header: "Full Name", key: "name", width: 22 },
    { header: "Email Address", key: "email", width: 26 },
    { header: "Mobile", key: "mobile", width: 15 },
    { header: "College / University", key: "college", width: 26 },
    { header: "Branch", key: "branch", width: 18 },
    { header: "Internship Role", key: "position", width: 20 },
    { header: "Session Code", key: "sessionCode", width: 14 },
    { header: "Exam Status", key: "status", width: 16 },
    { header: "Started At", key: "startedAt", width: 18 },
    { header: "Submitted At", key: "submittedAt", width: 18 },
    { header: "Total Duration", key: "duration", width: 14 },
    ...sectionCols,
    { header: "Total Marks", key: "score", width: 12 },
    { header: "Maximum Marks", key: "maxScore", width: 14 },
    { header: "Percentage", key: "percentage", width: 12 },
    { header: "Result", key: "result", width: 12 },
  ];

  // Header row formatting
  const headerRow = wsResults.getRow(1);
  headerRow.height = 26;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F1F3D" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });

  filteredAttempts.forEach((a, i) => {
    const ansMap = new Map(a.answers.map((x) => [x.questionId, x.marksAwarded ?? 0]));
    const paper = a.paper as unknown as Paper;

    // Calculate score per dynamic section
    const secScores: Record<string, number> = {};
    sectionsList.forEach((s, idx) => {
      const match = Array.isArray(paper) ? paper.find((p) => p.sectionId === s.id || p.title === s.title) : null;
      if (match) {
        secScores[`sec_${idx}`] = Math.round(match.questions.reduce((sum, q) => sum + (ansMap.get(q.questionId) ?? 0), 0) * 100) / 100;
      } else {
        secScores[`sec_${idx}`] = 0;
      }
    });

    const durationSec = a.submittedAt ? Math.round((a.submittedAt.getTime() - a.startedAt.getTime()) / 1000) : null;
    const durationStr = durationSec ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s` : "—";

    const row = wsResults.addRow({
      srNo: i + 1,
      candidateId: a.candidate?.id ? a.candidate.id.slice(-8).toUpperCase() : (a.candidateId || "—"),
      name: a.candidate?.user?.name ?? "—",
      email: a.candidate?.user?.email ?? "—",
      mobile: a.candidate?.mobile ?? "—",
      college: a.candidate?.college ?? "—",
      branch: a.candidate?.branch ?? "—",
      position: a.exam?.position || "Engineering Trainee",
      sessionCode: a.session?.codeLastFour ? `••-${a.session.codeLastFour}` : "DIRECT",
      status: a.status ? a.status.replace("_", " ") : "—",
      startedAt: a.startedAt ? a.startedAt.toLocaleTimeString("en-IN") : "—",
      submittedAt: a.submittedAt ? a.submittedAt.toLocaleTimeString("en-IN") : "—",
      duration: durationStr,
      ...secScores,
      score: a.score ?? 0,
      maxScore: a.maxScore ?? 0,
      percentage: a.percentage ? `${a.percentage}%` : "0%",
      result: a.needsManualEval ? "Review" : a.passed ? "PASS" : "FAIL",
    });

    // Color code pass/fail
    const resultCell = row.getCell("result");
    if (a.passed) {
      resultCell.font = { bold: true, color: { argb: "FF047857" } };
    } else if (a.passed === false) {
      resultCell.font = { bold: true, color: { argb: "FFB91C1C" } };
    }
  });

  // Enable filters on results table
  wsResults.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: wsResults.columns.length },
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // SHEET 3: SECTION-WISE PERFORMANCE
  // ─────────────────────────────────────────────────────────────────────────────
  const wsSec = wb.addWorksheet("Section-wise Performance");
  wsSec.views = [{ state: "frozen", ySplit: 1, showGridLines: true }];

  wsSec.columns = [
    { header: "Candidate Name", key: "name", width: 22 },
    { header: "Candidate ID", key: "candidateId", width: 16 },
    { header: "Section Name", key: "sectionTitle", width: 22 },
    { header: "Maximum Marks", key: "maxMarks", width: 14 },
    { header: "Obtained Marks", key: "score", width: 14 },
    { header: "Percentage", key: "percentage", width: 12 },
    { header: "Time Taken", key: "timeTaken", width: 14 },
    { header: "Section Status", key: "status", width: 14 },
    { header: "Correct", key: "correct", width: 10 },
    { header: "Incorrect", key: "incorrect", width: 10 },
    { header: "Unanswered", key: "unanswered", width: 12 },
  ];

  wsSec.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  wsSec.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F1F3D" } };

  filteredAttempts.forEach((a) => {
    const paper = a.paper as unknown as Paper;
    const ansMap = new Map(a.answers.map((x) => [x.questionId, x]));

    if (Array.isArray(paper)) {
      paper.forEach((sec, sIdx) => {
        const secAtt = a.sectionAttempts.find((sa) => sa.sectionIndex === sIdx);
        let correct = 0;
        let incorrect = 0;
        let unanswered = 0;

        sec.questions.forEach((q) => {
          const ans = ansMap.get(q.questionId);
          if (!ans || (!ans.selectedOptionIds.length && !ans.textAnswer?.trim())) {
            unanswered++;
          } else if (ans.isCorrect) {
            correct++;
          } else {
            incorrect++;
          }
        });

        const sMax = sec.questions.reduce((sum, q) => sum + q.marks, 0);
        const sScore = Math.round(sec.questions.reduce((sum, q) => sum + (ansMap.get(q.questionId)?.marksAwarded ?? 0), 0) * 100) / 100;
        const pct = sMax > 0 ? `${Math.round((sScore / sMax) * 1000) / 10}%` : "0%";

        wsSec.addRow({
          name: a.candidate?.user?.name ?? "—",
          candidateId: a.candidate?.id ? a.candidate.id.slice(-8).toUpperCase() : (a.candidateId || "—"),
          sectionTitle: sec.title,
          maxMarks: sMax,
          score: sScore,
          percentage: pct,
          timeTaken: sec.timeLimitMinutes ? `${sec.timeLimitMinutes}m` : "Untimed",
          status: secAtt?.status || "COMPLETED",
          correct,
          incorrect,
          unanswered,
        });
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SHEET 4: PROCTORING SUMMARY
  // ─────────────────────────────────────────────────────────────────────────────
  const wsProc = wb.addWorksheet("Proctoring Summary");
  wsProc.views = [{ state: "frozen", ySplit: 1, showGridLines: true }];

  wsProc.columns = [
    { header: "Candidate Name", key: "name", width: 22 },
    { header: "Candidate ID", key: "candidateId", width: 16 },
    { header: "Total Proctoring Events", key: "totalEvents", width: 20 },
    { header: "Face Absence Events", key: "faceAbsence", width: 18 },
    { header: "Multiple Face Events", key: "multiFace", width: 18 },
    { header: "Tab Switching Events", key: "tabSwitch", width: 18 },
    { header: "Fullscreen Exit Events", key: "fullscreenExit", width: 18 },
    { header: "Camera Disconnected", key: "cameraDisconn", width: 18 },
    { header: "Mic Audio Activity", key: "audioSpike", width: 18 },
    { header: "Risk Score", key: "riskScore", width: 12 },
    { header: "Review Status", key: "reviewStatus", width: 14 },
  ];

  wsProc.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  wsProc.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F1F3D" } };

  filteredAttempts.forEach((a) => {
    const events = a.events || [];
    const faceAbsence = events.filter((e) => e.type.includes("FACE_NOT_FOUND") || e.type.includes("LOOKING_AWAY")).length;
    const multiFace = events.filter((e) => e.type.includes("MULTIPLE_FACES")).length;
    const tabSwitch = events.filter((e) => e.type.includes("TAB_SWITCH") || e.type.includes("FOCUS_LOST")).length;
    const fullscreenExit = events.filter((e) => e.type.includes("FULLSCREEN_EXIT")).length;
    const cameraDisconn = events.filter((e) => e.type.includes("CAMERA_LOST") || e.type.includes("DEVICE_DISCONNECTED")).length;
    const audioSpike = events.filter((e) => e.type.includes("AUDIO_SPIKE")).length;

    wsProc.addRow({
      name: a.candidate?.user?.name ?? "—",
      candidateId: a.candidate?.id ? a.candidate.id.slice(-8).toUpperCase() : (a.candidateId || "—"),
      totalEvents: events.length,
      faceAbsence,
      multiFace,
      tabSwitch,
      fullscreenExit,
      cameraDisconn,
      audioSpike,
      riskScore: `${a.riskScore}/100`,
      reviewStatus: a.riskLevel === "NORMAL" ? "Verified" : `Flagged (${a.riskLevel})`,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SHEET 5: SESSION ACTIVITY
  // ─────────────────────────────────────────────────────────────────────────────
  const wsAct = wb.addWorksheet("Session Activity");
  wsAct.views = [{ state: "frozen", ySplit: 1, showGridLines: true }];

  wsAct.columns = [
    { header: "Candidate Name", key: "name", width: 22 },
    { header: "Candidate ID", key: "candidateId", width: 16 },
    { header: "Login / Entry Time", key: "loginTime", width: 18 },
    { header: "Examination Start", key: "startTime", width: 18 },
    { header: "Pause Events", key: "pauseEvents", width: 14 },
    { header: "Resume Events", key: "resumeEvents", width: 14 },
    { header: "Disconnection Events", key: "disconnEvents", width: 18 },
    { header: "Re-entry Events", key: "reentryCount", width: 14 },
    { header: "Submission Time", key: "submitTime", width: 18 },
    { header: "Submission Method", key: "submitMethod", width: 18 },
  ];

  wsAct.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  wsAct.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F1F3D" } };

  filteredAttempts.forEach((a) => {
    const events = a.events || [];
    const pauseEvents = events.filter((e) => e.type.includes("PAUSE")).length + (a.pausedAt ? 1 : 0);
    const resumeEvents = events.filter((e) => e.type.includes("RESUME")).length;
    const disconnEvents = events.filter((e) => e.type.includes("DISCONNECTED") || e.type.includes("OFFLINE")).length;

    wsAct.addRow({
      name: a.candidate?.user?.name ?? "—",
      candidateId: a.candidate?.id ? a.candidate.id.slice(-8).toUpperCase() : (a.candidateId || "—"),
      loginTime: a.startedAt ? a.startedAt.toLocaleTimeString("en-IN") : "—",
      startTime: a.startedAt ? a.startedAt.toLocaleTimeString("en-IN") : "—",
      pauseEvents,
      resumeEvents,
      disconnEvents,
      reentryCount: a.reentryCount ?? 0,
      submitTime: a.submittedAt ? a.submittedAt.toLocaleTimeString("en-IN") : "—",
      submitMethod: a.submissionMethod || (a.status === "AUTO_SUBMITTED" ? "Timer Expiry" : a.status === "ADMIN_SUBMITTED" ? "Admin Force" : "Candidate Normal"),
    });
  });

  return wb;
}

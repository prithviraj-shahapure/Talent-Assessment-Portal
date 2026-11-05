import { Router, type Response } from "express";
import PDFDocument from "pdfkit";
import { prisma } from "../../lib/prisma";
import { ah } from "../../lib/http";
import { requireStaff } from "../../middleware/auth";
import { audit } from "../../lib/audit";
import { attemptReview } from "../evaluation/routes";
import { leaderboard } from "../results/routes";
import { getSettings } from "../../lib/settings";

export const reportsRouter = Router();
reportsRouter.use(requireStaff);

const NAVY = "#0f1f3d";
const MUTED = "#5b6478";
const LINE = "#d9dde5";

function startDoc(res: Response, filename: string, title: string, subtitle: string, org: string) {
  const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true, info: { Title: title, Author: org } });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);
  doc.rect(0, 0, doc.page.width, 6).fill(NAVY);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9).text(`${org.toUpperCase()} · TALENT ASSESSMENT PORTAL`, 48, 30, { characterSpacing: 1.5 });
  doc.moveDown(1.2).fontSize(18).text(title);
  doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(subtitle);
  doc.moveDown(0.6);
  hr(doc);
  return doc;
}
function hr(doc: PDFKit.PDFDocument) {
  doc.moveTo(48, doc.y).lineTo(doc.page.width - 48, doc.y).strokeColor(LINE).lineWidth(1).stroke();
  doc.moveDown(0.6);
}
function heading(doc: PDFKit.PDFDocument, t: string) {
  if (doc.y > doc.page.height - 140) doc.addPage();
  doc.moveDown(0.4).font("Helvetica-Bold").fontSize(11).fillColor(NAVY).text(t.toUpperCase(), { characterSpacing: 0.8 });
  doc.moveDown(0.3);
}
function kv(doc: PDFKit.PDFDocument, pairs: [string, string][], cols = 3) {
  const w = (doc.page.width - 96) / cols;
  const startY = doc.y;
  pairs.forEach(([k, v], i) => {
    const x = 48 + (i % cols) * w;
    const y = startY + Math.floor(i / cols) * 34;
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(k.toUpperCase(), x, y, { width: w - 8 });
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827").text(v, x, y + 11, { width: w - 8 });
  });
  doc.x = 48;
  doc.y = startY + Math.ceil(pairs.length / cols) * 34 + 4;
}
function table(doc: PDFKit.PDFDocument, headers: string[], widths: number[], rows: string[][]) {
  const draw = (cells: string[], bold: boolean) => {
    if (doc.y > doc.page.height - 70) doc.addPage();
    const y = doc.y;
    let x = 48;
    const h = Math.max(...cells.map((c, i) => doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).heightOfString(c, { width: widths[i] - 6 }))) + 8;
    if (bold) doc.rect(48, y, widths.reduce((a, b) => a + b, 0), h).fill("#eef1f6");
    cells.forEach((c, i) => {
      doc.fillColor(bold ? NAVY : "#1f2937").font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).text(c, x + 3, y + 4, { width: widths[i] - 6 });
      x += widths[i];
    });
    doc.moveTo(48, y + h).lineTo(48 + widths.reduce((a, b) => a + b, 0), y + h).strokeColor(LINE).lineWidth(0.5).stroke();
    doc.x = 48;
    doc.y = y + h;
  };
  draw(headers, true);
  rows.forEach((r) => draw(r, false));
  doc.moveDown(0.5);
}
function footer(doc: PDFKit.PDFDocument) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(
      `Generated ${new Date().toLocaleString("en-IN")} · Confidential — for recruitment use only · Page ${i + 1} of ${range.count}`,
      48,
      doc.page.height - 36,
      { width: doc.page.width - 96, align: "center", lineBreak: false },
    );
  }
}
const fmtTime = (s: number | null) => (s == null ? "—" : `${Math.floor(s / 60)}m ${s % 60}s`);

reportsRouter.get(
  "/attempts/:id/pdf",
  ah(async (req, res) => {
    const r = await attemptReview(req.params.id);
    const settings = await getSettings();
    const { rows } = await leaderboard(r.exam.id);
    const rank = rows.find((x) => x.attemptId === r.id)?.rank;
    const events = await prisma.proctorEvent.findMany({ where: { attemptId: r.id }, orderBy: { occurredAt: "asc" } });
    await audit(req, "report.candidate_pdf", "Attempt", r.id);
    const doc = startDoc(res, `candidate-report-${r.candidate.user.name.replace(/\W+/g, "-")}.pdf`, "Candidate Performance Report", `${r.exam.title} · Attempt ${r.attemptNo}`, settings.organisationName);

    heading(doc, "Candidate");
    kv(doc, [
      ["Name", r.candidate.user.name],
      ["Email", r.candidate.user.email],
      ["Mobile", r.candidate.mobile],
      ["College", r.candidate.college],
      ["Degree / Branch", `${r.candidate.degree} · ${r.candidate.branch}`],
      ["Graduation year", String(r.candidate.graduationYear)],
    ]);
    heading(doc, "Result summary");
    kv(doc, [
      ["Score", `${r.score ?? 0} / ${r.maxScore ?? 0}`],
      ["Percentage", `${r.percentage ?? 0}%`],
      ["Result", r.needsManualEval ? "Pending evaluation" : r.passed ? "PASS" : "FAIL"],
      ["Rank", rank ? `${rank} of ${rows.length}` : "—"],
      ["Time taken", fmtTime(r.timeTakenSec)],
      ["Passing marks", String(r.exam.passingMarks)],
    ]);
    heading(doc, "Section-wise performance");
    table(doc, ["Section", "Score", "Max", "%"], [260, 80, 80, 79], r.sections.map((s) => [s.title, String(s.score), String(s.max), s.max ? `${Math.round((s.score / s.max) * 1000) / 10}%` : "—"]));

    heading(doc, "Question-wise evaluation");
    table(
      doc,
      ["#", "Question", "Type", "Marks", "Awarded", "Outcome"],
      [26, 250, 66, 46, 52, 59],
      r.sections.flatMap((s) =>
        s.questions.map((q) => [
          String(q.number),
          q.text.length > 140 ? q.text.slice(0, 137) + "…" : q.text,
          q.type.replace("_", " "),
          String(q.marks),
          q.marksAwarded == null ? "—" : String(q.marksAwarded),
          q.marksAwarded == null ? (q.textAnswer || q.options.some((o) => o.selected) ? "To evaluate" : "Unanswered") : q.isCorrect ? "Correct" : q.textAnswer || q.options.some((o) => o.selected) ? (q.marksAwarded > 0 ? "Partial" : "Incorrect") : "Unanswered",
        ]),
      ),
    );

    heading(doc, "Proctoring summary (advisory)");
    kv(doc, [
      ["Risk score", `${r.riskScore} / 100`],
      ["Risk level", r.riskLevel],
      ["Events logged", String(events.length)],
    ]);
    doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(MUTED).text("Risk scores are indicators for human review only and are not proof of malpractice. Browser-based monitoring cannot detect secondary devices, virtual machines or all forms of screen capture.", { width: doc.page.width - 96 });
    doc.moveDown(0.5);
    const counted = events.filter((e) => e.weightApplied > 0);
    if (counted.length) {
      table(doc, ["Time", "Event", "Severity", "Points", "Reviewed"], [80, 220, 70, 60, 69], counted.map((e) => [e.occurredAt.toLocaleTimeString("en-IN"), e.message ?? e.type, e.severity, `+${e.weightApplied}`, e.reviewed ? "Yes" : "No"]));
    }
    footer(doc);
    doc.end();
  }),
);

reportsRouter.get(
  "/exams/:examId/pdf",
  ah(async (req, res) => {
    const settings = await getSettings();
    const exam = await prisma.exam.findUniqueOrThrow({ where: { id: req.params.examId }, include: { department: true, _count: { select: { assignments: true } } } });
    const { rows } = await leaderboard(exam.id);
    await audit(req, "report.exam_pdf", "Exam", exam.id);
    const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="exam-report-${exam.title.replace(/\W+/g, "-").slice(0, 50)}.pdf"`);
    doc.pipe(res);
    doc.rect(0, 0, doc.page.width, 6).fill(NAVY);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9).text(`${settings.organisationName.toUpperCase()} · TALENT ASSESSMENT PORTAL`, 48, 30, { characterSpacing: 1.5 });
    doc.moveDown(1.2).fontSize(18).text("Examination Summary Report");
    doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(`${exam.title}${exam.department ? " · " + exam.department.name : ""}`);
    doc.moveDown(0.6);
    hr(doc);
    const evaluated = rows.filter((r) => !r.needsManualEval);
    const pct = evaluated.map((r) => r.percentage);
    heading(doc, "Overview");
    kv(doc, [
      ["Window", `${exam.startAt.toLocaleDateString("en-IN")} – ${exam.endAt.toLocaleDateString("en-IN")}`],
      ["Duration", `${exam.durationMinutes} min`],
      ["Total / passing marks", `${exam.totalMarks} / ${exam.passingMarks}`],
      ["Assigned", String(exam._count.assignments)],
      ["Submitted", String(rows.length)],
      ["Pending evaluation", String(rows.length - evaluated.length)],
      ["Average", pct.length ? `${Math.round((pct.reduce((a, b) => a + b, 0) / pct.length) * 10) / 10}%` : "—"],
      ["Pass rate", evaluated.length ? `${Math.round((evaluated.filter((r) => r.passed).length / evaluated.length) * 1000) / 10}%` : "—"],
      ["Flagged (medium/high)", String(rows.filter((r) => r.riskLevel === "MEDIUM" || r.riskLevel === "HIGH").length)],
    ]);
    heading(doc, "Leaderboard");
    table(
      doc,
      ["Rank", "Candidate", "College", "Score", "%", "Result", "Risk"],
      [36, 120, 140, 50, 45, 55, 53],
      rows.map((r) => [String(r.rank), r.name, r.college, `${r.score}/${r.maxScore}`, `${r.percentage}`, r.needsManualEval ? "Pending" : r.passed ? "Pass" : "Fail", r.riskLevel]),
    );
    doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(MUTED).text("Risk levels are advisory indicators for human review and must not be used as the sole basis for any decision.", 48);
    footer(doc);
    doc.end();
  }),
);

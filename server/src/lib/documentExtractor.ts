import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import ExcelJS from "exceljs";
import { badRequest } from "./http";
import type { ParsedQuestion } from "./txtParser";

export type SupportedExtension = "txt" | "docx" | "doc" | "pdf" | "rtf" | "xlsx" | "csv";

export interface ExtractionResult {
  text: string;
  structuredQuestions?: ParsedQuestion[];
  detectedType: SupportedExtension;
  isSyllabusOrDistribution?: boolean;
  syllabusNotice?: string;
  wordCount: number;
}

/** Maximum allowed upload size (25 MB) */
export const MAX_DOCUMENT_FILE_SIZE = 25 * 1024 * 1024;

export const SUPPORTED_EXTENSIONS = [".txt", ".docx", ".doc", ".pdf", ".rtf", ".xlsx", ".csv"] as const;

/**
 * Validates file signature (magic bytes) to ensure file content matches extension.
 */
export function validateFileSignature(buffer: Buffer, originalName: string): SupportedExtension {
  const ext = originalName.split(".").pop()?.toLowerCase();

  if (buffer.length === 0) {
    throw badRequest(`File '${originalName}' is empty.`);
  }

  // 1. PDF
  if (buffer.subarray(0, 4).toString() === "%PDF") {
    return "pdf";
  }

  // 2. RTF
  if (buffer.subarray(0, 5).toString() === "{\\rtf") {
    return "rtf";
  }

  // 3. Legacy Word (OLE2 Compound Document)
  if (
    buffer.length >= 8 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 &&
    buffer[5] === 0xb1 &&
    buffer[6] === 0x1a &&
    buffer[7] === 0xe1
  ) {
    return "doc";
  }

  // 4. PK Zip Containers (DOCX or XLSX)
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    if (ext === "xlsx") return "xlsx";
    return "docx";
  }

  // 5. CSV
  if (ext === "csv") {
    return "csv";
  }

  // 6. Plain Text
  if (ext === "txt") {
    return "txt";
  }

  // If extension matches one of our allowed types, allow fallback
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "doc") return "doc";
  if (ext === "rtf") return "rtf";
  if (ext === "xlsx") return "xlsx";

  throw badRequest(
    `Unsupported file format for '${originalName}'. Supported formats: .txt, .docx, .doc, .pdf, .rtf, .xlsx, .csv`
  );
}

/**
 * Sanitizes extracted text: removes null bytes, normalizes line breaks, strips dangerous scripts.
 */
export function sanitizeText(text: string): string {
  return text
    .replace(/\0/g, "") // Null bytes
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "") // Scripts
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // Zero-width spaces
    .trim();
}

/**
 * Extracts raw text from PDF files using pdf-parse.
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  try {
    const uint8 = new Uint8Array(buffer);
    const parser = new PDFParse(uint8);
    const result = await parser.getText();
    const raw = typeof result === "string" ? result : result.text || "";
    return sanitizeText(raw);
  } catch (err: any) {
    if (err.name === "PasswordException" || String(err).includes("password")) {
      throw badRequest("This PDF document is password-protected. Please upload an unprotected copy.");
    }
    throw badRequest(`Failed to read PDF document: ${err.message || "corrupted or unreadable format"}`);
  }
}

/**
 * Extracts formatted markdown text from Microsoft Word (.docx) files using mammoth.
 * Preserves headings (# Heading), lists, and tables (| col1 | col2 |).
 */
export async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  try {
    const mdResult = await (mammoth as any).convertToMarkdown({ buffer });
    if (mdResult?.value && mdResult.value.trim().length > 10) {
      return sanitizeText(mdResult.value);
    }
    const rawResult = await mammoth.extractRawText({ buffer });
    return sanitizeText(rawResult.value);
  } catch (err: any) {
    try {
      const rawResult = await mammoth.extractRawText({ buffer });
      return sanitizeText(rawResult.value);
    } catch {
      throw badRequest(`Failed to read Word (.docx) document: ${err.message || "corrupted file"}`);
    }
  }
}

/**
 * Extracts raw text from legacy Microsoft Word (.doc) binary files.
 * Reads ASCII and UTF-16LE text streams from the WordDocument container.
 */
export async function extractTextFromDoc(buffer: Buffer): Promise<string> {
  try {
    const pieces: string[] = [];
    const len = buffer.length;

    // 1. Scan for printable ASCII runs (length >= 4)
    let currentAscii = "";
    for (let i = 0; i < len; i++) {
      const byte = buffer[i];
      if ((byte >= 32 && byte <= 126) || byte === 10 || byte === 13 || byte === 9) {
        currentAscii += String.fromCharCode(byte);
      } else {
        if (currentAscii.trim().length >= 4) {
          pieces.push(currentAscii.trim());
        }
        currentAscii = "";
      }
    }
    if (currentAscii.trim().length >= 4) pieces.push(currentAscii.trim());

    // 2. Scan for UTF-16LE runs (common in Word 97-2004)
    let currentUtf16 = "";
    for (let i = 0; i < len - 1; i += 2) {
      const code = buffer.readUInt16LE(i);
      if ((code >= 32 && code <= 126) || code === 10 || code === 13 || code === 9) {
        currentUtf16 += String.fromCharCode(code);
      } else {
        if (currentUtf16.trim().length >= 4) {
          pieces.push(currentUtf16.trim());
        }
        currentUtf16 = "";
      }
    }
    if (currentUtf16.trim().length >= 4) pieces.push(currentUtf16.trim());

    // Deduplicate and filter noise
    const seen = new Set<string>();
    const filtered: string[] = [];
    for (const p of pieces) {
      const clean = p.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").trim();
      // Filter out OLE metadata strings
      if (
        clean.length > 5 &&
        !clean.startsWith("Microsoft") &&
        !clean.startsWith("CompObj") &&
        !clean.startsWith("WordDocument") &&
        !clean.startsWith("SummaryInformation") &&
        !clean.startsWith("DocumentSummaryInformation") &&
        !seen.has(clean)
      ) {
        seen.add(clean);
        filtered.push(clean);
      }
    }

    if (filtered.length === 0) {
      throw new Error("No readable text found in legacy Word document.");
    }

    return sanitizeText(filtered.join("\n\n"));
  } catch (err: any) {
    throw badRequest(`Failed to read legacy Word (.doc) document: ${err.message || "corrupted binary structure"}`);
  }
}

/**
 * Extracts plain text from Rich Text Format (.rtf) documents.
 */
export function extractTextFromRtf(buffer: Buffer): string {
  try {
    let rtf = buffer.toString("utf-8");

    // Replace line break tags
    rtf = rtf.replace(/\\par[d]?\b/g, "\n").replace(/\\line\b/g, "\n").replace(/\\tab\b/g, "\t");

    // Remove headers, font tables, color tables, stylesheets
    rtf = rtf.replace(/\{\\fonttbl[\s\S]*?\}/g, "");
    rtf = rtf.replace(/\{\\colortbl[\s\S]*?\}/g, "");
    rtf = rtf.replace(/\{\\stylesheet[\s\S]*?\}/g, "");
    rtf = rtf.replace(/\{\\\*[\s\S]*?\}/g, ""); // Ignorable destination groups

    // Decode hex escapes \'hh
    rtf = rtf.replace(/\\'([0-9a-fA-F]{2})/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));

    // Decode unicode escapes \u1234?
    rtf = rtf.replace(/\\u(-?\d+)\??/g, (_match, dec) => {
      const code = parseInt(dec, 10);
      return String.fromCharCode(code < 0 ? code + 65536 : code);
    });

    // Remove remaining backslash commands (e.g. \b, \i, \fs24, \cf0)
    rtf = rtf.replace(/\\[a-zA-Z]+-?\d* ?/g, "");

    // Remove remaining braces
    rtf = rtf.replace(/[\{\}]/g, "");

    return sanitizeText(rtf);
  } catch (err: any) {
    throw badRequest(`Failed to read RTF document: ${err.message || "corrupted RTF content"}`);
  }
}

/**
 * Extracts structured questions and text from Excel (.xlsx) or CSV spreadsheets using ExcelJS.
 */
export async function extractFromSpreadsheet(
  buffer: Buffer,
  isCsv: boolean
): Promise<{ text: string; structuredQuestions?: ParsedQuestion[] }> {
  try {
    const workbook = new ExcelJS.Workbook();
    if (isCsv) {
      // Read CSV from buffer
      const { Readable } = await import("stream");
      const stream = Readable.from(buffer.toString("utf-8"));
      await workbook.csv.read(stream);
    } else {
      await workbook.xlsx.load(buffer as any);
    }

    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount === 0) {
      return { text: "" };
    }

    // Inspect header row to detect structured question columns
    const headerRow = worksheet.getRow(1);
    const headers: Record<string, number> = {};

    headerRow.eachCell((cell, colNumber) => {
      const val = String(cell.value || "").trim().toLowerCase();
      if (val.includes("question") || val === "q" || val === "problem") headers["question"] = colNumber;
      else if (val.includes("option a") || val === "a" || val === "opt a" || val === "option 1") headers["optA"] = colNumber;
      else if (val.includes("option b") || val === "b" || val === "opt b" || val === "option 2") headers["optB"] = colNumber;
      else if (val.includes("option c") || val === "c" || val === "opt c" || val === "option 3") headers["optC"] = colNumber;
      else if (val.includes("option d") || val === "d" || val === "opt d" || val === "option 4") headers["optD"] = colNumber;
      else if (val.includes("option e") || val === "e" || val === "opt e" || val === "option 5") headers["optE"] = colNumber;
      else if (val.includes("answer") || val === "ans" || val === "correct" || val === "key") headers["answer"] = colNumber;
      else if (val.includes("explanation") || val === "exp" || val === "solution" || val === "rationale") headers["explanation"] = colNumber;
      else if (val.includes("section") || val === "subject" || val === "category" || val === "topic") headers["section"] = colNumber;
      else if (val.includes("marks") || val === "points") headers["marks"] = colNumber;
      else if (val.includes("negative") || val === "penalty") headers["negativeMarks"] = colNumber;
      else if (val.includes("difficulty") || val === "level") headers["difficulty"] = colNumber;
      else if (val.includes("type")) headers["type"] = colNumber;
    });

    const isStructuredTable = headers["question"] !== undefined;
    const structuredQuestions: ParsedQuestion[] = [];
    const textLines: string[] = [];

    let currentSection = "Aptitude Test";

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1 && isStructuredTable) return; // Skip header

      if (isStructuredTable && headers["question"]) {
        const qText = String(row.getCell(headers["question"]).value || "").trim();
        if (!qText) return;

        const secVal = headers["section"] ? String(row.getCell(headers["section"]).value || "").trim() : "";
        if (secVal) currentSection = secVal;

        const options: Array<{ key: string; text: string }> = [];
        if (headers["optA"] && row.getCell(headers["optA"]).value) options.push({ key: "A", text: String(row.getCell(headers["optA"]).value).trim() });
        if (headers["optB"] && row.getCell(headers["optB"]).value) options.push({ key: "B", text: String(row.getCell(headers["optB"]).value).trim() });
        if (headers["optC"] && row.getCell(headers["optC"]).value) options.push({ key: "C", text: String(row.getCell(headers["optC"]).value).trim() });
        if (headers["optD"] && row.getCell(headers["optD"]).value) options.push({ key: "D", text: String(row.getCell(headers["optD"]).value).trim() });
        if (headers["optE"] && row.getCell(headers["optE"]).value) options.push({ key: "E", text: String(row.getCell(headers["optE"]).value).trim() });

        const rawAns = headers["answer"] ? String(row.getCell(headers["answer"]).value || "").trim() : "";
        const correctAnswers = rawAns ? rawAns.split(/[,&]|\band\b/i).map((s) => s.trim().toUpperCase()).filter(Boolean) : [];

        const explanation = headers["explanation"] ? String(row.getCell(headers["explanation"]).value || "").trim() : undefined;
        const marksVal = headers["marks"] ? parseFloat(String(row.getCell(headers["marks"]).value)) : 1;
        const negVal = headers["negativeMarks"] ? parseFloat(String(row.getCell(headers["negativeMarks"]).value)) : 0;
        const diffVal = headers["difficulty"] ? String(row.getCell(headers["difficulty"]).value).toUpperCase().trim() : "MEDIUM";
        const difficulty = diffVal === "EASY" || diffVal === "HARD" ? diffVal : "MEDIUM";

        // Determine question type
        let type: ParsedQuestion["type"] = "SINGLE";
        if (options.length === 0) {
          type = correctAnswers.length > 0 && !isNaN(Number(correctAnswers[0])) ? "NUMERICAL" : correctAnswers.length > 0 ? "SHORT" : "DESCRIPTIVE";
        } else if (options.length === 2 && options.some((o) => o.text.toLowerCase() === "true")) {
          type = "TRUE_FALSE";
        } else if (correctAnswers.length > 1) {
          type = "MULTIPLE";
        }

        const valid = options.length >= 2 && correctAnswers.length > 0;

        structuredQuestions.push({
          sectionTitle: currentSection,
          questionNumber: `Q${structuredQuestions.length + 1}`,
          text: qText,
          type,
          options,
          correctAnswers,
          explanation: explanation || undefined,
          marks: !isNaN(marksVal) ? marksVal : 1,
          negativeMarks: !isNaN(negVal) ? negVal : 0,
          difficulty,
          validationErrors: valid ? [] : ["Incomplete question: verify options and answer key."],
          status: valid ? "VALID" : "MISSING_ANSWER",
          sourceType: "TXT_IMPORT",
        });

        // Also output formatted text representation for transparency
        textLines.push(`SECTION: ${currentSection}`);
        textLines.push(`Q${structuredQuestions.length}. ${qText}`);
        options.forEach((o) => textLines.push(`${o.key}) ${o.text}`));
        if (correctAnswers.length > 0) textLines.push(`Correct Answer: ${correctAnswers.join(", ")}`);
        if (explanation) textLines.push(`Explanation: ${explanation}`);
        textLines.push(`Marks: ${marksVal}`);
        textLines.push("");
      } else {
        // Freeform spreadsheet row: concatenate non-empty cells
        const rowVals: string[] = [];
        row.eachCell((cell) => {
          const val = String(cell.value || "").trim();
          if (val) rowVals.push(val);
        });
        if (rowVals.length > 0) {
          textLines.push(rowVals.join("\t"));
        }
      }
    });

    return {
      text: sanitizeText(textLines.join("\n")),
      structuredQuestions: structuredQuestions.length > 0 ? structuredQuestions : undefined,
    };
  } catch (err: any) {
    throw badRequest(`Failed to read spreadsheet file: ${err.message || "corrupted spreadsheet"}`);
  }
}

/**
 * Identifies whether an uploaded document contains a syllabus, course blueprint,
 * or question distribution table rather than actual test questions.
 */
export function detectSyllabusOrDistribution(text: string): {
  isSyllabus: boolean;
  topicsDetected: string[];
  notice?: string;
} {
  const upper = text.toUpperCase();

  const syllabusKeywords = [
    "SYLLABUS",
    "COURSE OUTLINE",
    "LEARNING OBJECTIVES",
    "EXAMINATION BLUEPRINT",
    "MARKING SCHEME",
    "QUESTION DISTRIBUTION",
    "WEIGHTAGE TABLE",
    "CURRICULUM",
    "MODULE 1",
    "UNIT 1",
    "TOPICS COVERED",
  ];

  let keywordHits = 0;
  for (const kw of syllabusKeywords) {
    if (upper.includes(kw)) keywordHits++;
  }

  // Check if there are explicit MCQ options like A., B., C., D.
  const hasOptions = /[A-D]\)\s+[^\n]+|[A-D]\.\s+[^\n]+/g.test(text);
  const hasAnswers = /(?:Correct\s+Answer|Ans|Answer)\s*[:\-=]/i.test(text);

  // If high syllabus indicators and no actual question/answer patterns
  if (keywordHits >= 2 && !hasOptions && !hasAnswers) {
    // Extract detected topics/units
    const topicLines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^(?:Unit|Module|Chapter|Topic|\d+\.)\s+.+/i.test(l))
      .slice(0, 10);

    return {
      isSyllabus: true,
      topicsDetected: topicLines,
      notice:
        "Document identified as a course syllabus or question distribution outline rather than an explicit question paper. Use 'AI-Assisted Generation' to generate questions from these syllabus topics.",
    };
  }

  return { isSyllabus: false, topicsDetected: [] };
}

/**
 * Universal document extractor entry point: handles .txt, .docx, .doc, .pdf, .rtf, .xlsx, .csv.
 */
export async function extractTextFromDocument(buffer: Buffer, originalName: string): Promise<ExtractionResult> {
  const detectedType = validateFileSignature(buffer, originalName);

  let text = "";
  let structuredQuestions: ParsedQuestion[] | undefined;

  switch (detectedType) {
    case "txt":
      text = sanitizeText(buffer.toString("utf-8"));
      break;

    case "pdf":
      text = await extractTextFromPdf(buffer);
      break;

    case "docx":
      text = await extractTextFromDocx(buffer);
      break;

    case "doc":
      text = await extractTextFromDoc(buffer);
      break;

    case "rtf":
      text = extractTextFromRtf(buffer);
      break;

    case "xlsx":
    case "csv": {
      const result = await extractFromSpreadsheet(buffer, detectedType === "csv");
      text = result.text;
      structuredQuestions = result.structuredQuestions;
      break;
    }

    default:
      throw badRequest(`Unsupported file format '${originalName}'`);
  }

  if (!text.trim() && (!structuredQuestions || structuredQuestions.length === 0)) {
    throw badRequest(`No readable text could be extracted from '${originalName}'. Please verify the file is not corrupted or empty.`);
  }

  const syllabusCheck = detectSyllabusOrDistribution(text);

  return {
    text,
    structuredQuestions,
    detectedType,
    isSyllabusOrDistribution: syllabusCheck.isSyllabus,
    syllabusNotice: syllabusCheck.notice,
    wordCount: text.split(/\s+/).filter(Boolean).length,
  };
}


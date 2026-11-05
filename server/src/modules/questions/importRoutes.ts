import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { prisma } from "../../lib/prisma";
import { ah, badRequest, notFound, parse } from "../../lib/http";
import { requireStaff } from "../../middleware/auth";
import { audit } from "../../lib/audit";
import { parseTxtQuestions, type ParsedQuestion } from "../../lib/txtParser";
import { generateOrExtractQuestions } from "../../lib/aiGenerator";
import {
  extractTextFromDocument,
  validateFileSignature,
  MAX_DOCUMENT_FILE_SIZE,
  type SupportedExtension,
} from "../../lib/documentExtractor";

export const questionImportRouter = Router();
questionImportRouter.use(requireStaff);

const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_FILE_SIZE },
});

// Handler for parsing documents (.txt, .docx, .doc, .pdf, .rtf, .xlsx, .csv) & extracting questions
async function handleDocumentExtraction(req: any, res: any) {
  const rawFiles: Express.Multer.File[] = [];

  if (req.file) {
    rawFiles.push(req.file);
  }
  if (Array.isArray(req.files)) {
    rawFiles.push(...req.files);
  } else if (req.files && typeof req.files === "object") {
    Object.values(req.files).forEach((f) => {
      if (Array.isArray(f)) rawFiles.push(...f);
      else if (f) rawFiles.push(f as Express.Multer.File);
    });
  }

  // Deduplicate files by filename and size
  const uploadedFiles: Express.Multer.File[] = [];
  const seenFiles = new Set<string>();
  for (const f of rawFiles) {
    const key = `${f.originalname}_${f.size}`;
    if (!seenFiles.has(key)) {
      seenFiles.add(key);
      uploadedFiles.push(f);
    }
  }

  const filesProcessed: Array<{
    name: string;
    size: number;
    type: SupportedExtension;
    words: number;
  }> = [];

  const textChunks: string[] = [];
  const directSpreadsheetQuestions: ParsedQuestion[] = [];
  let isSyllabusOrDistribution = false;
  let syllabusNotice: string | undefined;

  for (const f of uploadedFiles) {
    try {
      const extResult = await extractTextFromDocument(f.buffer, f.originalname);
      filesProcessed.push({
        name: f.originalname,
        size: f.size,
        type: extResult.detectedType,
        words: extResult.wordCount,
      });

      if (extResult.text && extResult.text.trim()) {
        textChunks.push(extResult.text.trim());
      }
      if (extResult.structuredQuestions && extResult.structuredQuestions.length > 0) {
        directSpreadsheetQuestions.push(...extResult.structuredQuestions);
      }
      if (extResult.isSyllabusOrDistribution) {
        isSyllabusOrDistribution = true;
        syllabusNotice = extResult.syllabusNotice;
      }
    } catch (err: any) {
      console.error(`Extraction error in '${f.originalname}':`, err);
      throw badRequest(`Extraction error in '${f.originalname}': ${err.message || "Failed to parse document"}`);
    }
  }

  // Handle pasted text if provided
  const pastedText = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (pastedText) {
    textChunks.push(pastedText);
  }

  // Validate that either files or pasted text was provided
  if (uploadedFiles.length === 0 && !pastedText) {
    throw badRequest(
      "Please upload question papers (.txt, .docx, .doc, .pdf, .rtf, .xlsx, .csv) or paste question text."
    );
  }

  if (textChunks.length === 0 && directSpreadsheetQuestions.length === 0) {
    throw badRequest(
      "No readable questions or text could be extracted from the uploaded document(s). Please verify file contents and formatting."
    );
  }

  const combinedText = textChunks.join("\n\n");
  const defaultSection = req.body.defaultSection ? String(req.body.defaultSection) : undefined;
  const isAiAssist = req.body.aiAssist === "true" || req.body.aiAssist === true;
  const primaryFileName = uploadedFiles.length > 0 ? uploadedFiles.map((f) => f.originalname).join(", ") : (req.body.fileName || "manual_paste.txt");

  let parsedQuestions: ParsedQuestion[] = [];
  let generatedCount = 0;

  if (isAiAssist) {
    // Mode B: AI-Assisted Generation from uploaded syllabus/material
    const { questions, generatedCount: genCount } = await generateOrExtractQuestions(combinedText, {
      sectionTitle: defaultSection,
      generateAdditional: req.body.generateAdditional === "true" || req.body.generateAdditional === true,
      targetCount: req.body.targetCount ? parseInt(req.body.targetCount, 10) : undefined,
    });
    parsedQuestions = questions;
    generatedCount = genCount;
  } else {
    // Mode A: Direct Extraction without modifying question wording or answers
    if (combinedText.trim()) {
      const parsed = parseTxtQuestions(combinedText, defaultSection);
      parsedQuestions = parsed.questions;
    }
    // Include structured questions from spreadsheets directly
    if (directSpreadsheetQuestions.length > 0) {
      parsedQuestions.push(...directSpreadsheetQuestions);
    }
  }

  const validCount = parsedQuestions.filter((q) => q.status === "VALID").length;
  const sectionsDetected = Array.from(
    new Set(parsedQuestions.map((q) => q.sectionTitle || defaultSection || "Aptitude Test"))
  );

  const result = {
    sectionsDetected,
    questions: parsedQuestions,
    totalQuestions: parsedQuestions.length,
    validQuestions: validCount,
    invalidQuestions: parsedQuestions.length - validCount,
    generatedCount,
    filesProcessed,
    isSyllabusOrDistribution,
    syllabusNotice,
  };

  // Save QuestionImport record in Prisma
  const record = await prisma.questionImport.create({
    data: {
      examId: req.body.examId ? String(req.body.examId) : null,
      fileName: primaryFileName.slice(0, 200),
      source: isAiAssist ? "AI_GENERATION" : "TXT",
      totalQuestions: result.totalQuestions,
      validQuestions: result.validQuestions,
      invalidQuestions: result.invalidQuestions,
      status: "PENDING",
      parsedData: result as object,
      createdById: req.user!.id,
    },
  });

  res.json({
    importId: record.id,
    ...result,
  });
}

// 1. Upload Documents & Parse questions (Accepts .txt, .docx, .doc, .pdf, .rtf, .xlsx, .csv)
questionImportRouter.post("/parse-document", docUpload.any(), ah(handleDocumentExtraction));
// Backward compatible endpoint for existing callers
questionImportRouter.post("/parse-txt", docUpload.any(), ah(handleDocumentExtraction));

// 2. Commit approved questions to the database / exam section
const commitSchema = z.object({
  examId: z.string().optional().nullable(),
  sectionId: z.string().optional().nullable(),
  questions: z.array(
    z.object({
      sectionTitle: z.string().optional(),
      text: z.string().min(3),
      type: z.enum(["SINGLE", "MULTIPLE", "TRUE_FALSE", "SHORT", "DESCRIPTIVE", "CODING", "NUMERICAL"]),
      options: z.array(z.object({ key: z.string(), text: z.string() })),
      correctAnswers: z.array(z.string()),
      explanation: z.string().optional().nullable(),
      marks: z.number().min(0).default(1),
      negativeMarks: z.number().min(0).default(0),
      difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).default("MEDIUM"),
      sourceType: z.enum(["TXT_IMPORT", "AI_GENERATED"]).default("TXT_IMPORT"),
      approvalStatus: z.enum(["APPROVED", "PENDING_REVIEW", "REJECTED"]).default("APPROVED"),
    })
  ),
});

questionImportRouter.post(
  "/commit",
  ah(async (req, res) => {
    const { examId, sectionId, questions } = parse(commitSchema, req.body);

    if (questions.length === 0) {
      throw badRequest("No questions to commit");
    }

    const createdIds: string[] = [];

    // Process questions within transaction or sequence
    for (const q of questions) {
      // Find or create category based on sectionTitle
      let categoryId: string | null = null;
      if (q.sectionTitle) {
        const cat = await prisma.questionCategory.upsert({
          where: { name: q.sectionTitle.trim() },
          create: { name: q.sectionTitle.trim() },
          update: {},
        });
        categoryId = cat.id;
      }

      // Determine accepted answers if short/numerical
      const acceptedAnswers =
        q.type === "SHORT" || q.type === "NUMERICAL" ? q.correctAnswers : [];

      const createdQ = await prisma.question.create({
        data: {
          type: q.type,
          text: q.text,
          explanation: q.explanation,
          categoryId,
          difficulty: q.difficulty,
          marks: q.marks,
          negativeMarks: q.negativeMarks,
          acceptedAnswers,
          sourceType: q.sourceType,
          approvalStatus: q.approvalStatus,
          sectionTitle: q.sectionTitle,
          createdById: req.user!.id,
          options: {
            create: q.options.map((opt, idx) => ({
              text: opt.text,
              order: idx,
              isCorrect: q.correctAnswers.some(
                (ans) =>
                  ans.trim().toUpperCase() === opt.key.trim().toUpperCase() ||
                  ans.trim().toLowerCase() === opt.text.trim().toLowerCase()
              ),
            })),
          },
        },
      });

      createdIds.push(createdQ.id);

      // If sectionId is specified, bind question to exam section
      if (sectionId) {
        const count = await prisma.examQuestion.count({ where: { sectionId } });
        await prisma.examQuestion.create({
          data: {
            sectionId,
            questionId: createdQ.id,
            order: count,
            marks: q.marks,
          },
        });
      }
    }

    // Recompute total marks if section was part of an exam
    if (examId) {
      const sections = await prisma.examSection.findMany({
        where: { examId },
        include: { questions: { include: { question: true } }, randomRules: true },
      });
      const total = sections.reduce(
        (sum, s) =>
          sum +
          s.questions.reduce((a, q) => a + (q.marks ?? q.question.marks), 0) +
          s.randomRules.reduce((a, r) => a + r.count * (r.marksEach ?? 1), 0),
        0
      );
      await prisma.exam.update({ where: { id: examId }, data: { totalMarks: total } });
    }

    await audit(req, "questions.import_committed", "Question", createdIds.length.toString(), {
      examId,
      sectionId,
      count: createdIds.length,
    });

    res.json({ success: true, count: createdIds.length, questionIds: createdIds });
  })
);


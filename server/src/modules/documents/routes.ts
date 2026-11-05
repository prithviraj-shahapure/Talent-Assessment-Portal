import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { prisma } from "../../lib/prisma";
import { ah, badRequest, notFound, parse } from "../../lib/http";
import { requireStaff } from "../../middleware/auth";
import { audit } from "../../lib/audit";
import { parseTxtQuestions, type ParsedQuestion } from "../../lib/txtParser";
import { generateOrExtractQuestions } from "../../lib/aiGenerator";
import { firestore } from "../../lib/firestore";
import {
  extractTextFromDocument,
  MAX_DOCUMENT_FILE_SIZE,
} from "../../lib/documentExtractor";

export const documentsRouter = Router();
documentsRouter.use(requireStaff);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_FILE_SIZE },
});

/**
 * POST /api/documents/upload
 * Upload one or multiple question papers (.docx, .doc, .pdf, .rtf, .xlsx, .csv, .txt).
 * Each document is processed INDEPENDENTLY and never merged with other documents.
 */
documentsRouter.post(
  "/upload",
  upload.any(),
  ah(async (req, res) => {
    const rawFiles: Express.Multer.File[] = [];
    if (req.file) rawFiles.push(req.file);
    if (Array.isArray(req.files)) {
      rawFiles.push(...req.files);
    } else if (req.files && typeof req.files === "object") {
      Object.values(req.files).forEach((f) => {
        if (Array.isArray(f)) rawFiles.push(...f);
        else if (f) rawFiles.push(f as Express.Multer.File);
      });
    }

    const pastedText = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (rawFiles.length === 0 && !pastedText) {
      throw badRequest("Please upload question papers (.docx, .doc, .pdf, .rtf, .xlsx, .csv, .txt) or paste text.");
    }

    const assignedStageId = req.body.assignedStageId ? String(req.body.assignedStageId).trim() : null;
    const examId = req.body.examId ? String(req.body.examId).trim() : null;
    const isAiAssist = req.body.aiAssist === "true" || req.body.aiAssist === true;
    const targetCount = req.body.targetCount ? parseInt(req.body.targetCount, 10) : undefined;

    // Deduplicate files by name and size
    const filesToProcess: Express.Multer.File[] = [];
    const seen = new Set<string>();
    for (const f of rawFiles) {
      const key = `${f.originalname}_${f.size}`;
      if (!seen.has(key)) {
        seen.add(key);
        filesToProcess.push(f);
      }
    }

    const createdDocuments: any[] = [];

    // Helper to process a single document content
    async function processSingleDocument(params: {
      fileName: string;
      buffer?: Buffer;
      text?: string;
      size: number;
    }) {
      let extractedText = params.text || "";
      let detectedType = "txt";
      let directQuestions: ParsedQuestion[] = [];

      if (params.buffer) {
        const extResult = await extractTextFromDocument(params.buffer, params.fileName);
        extractedText = extResult.text || "";
        detectedType = extResult.detectedType;
        if (extResult.structuredQuestions && extResult.structuredQuestions.length > 0) {
          directQuestions = extResult.structuredQuestions;
        }
      }

      if (!extractedText.trim() && directQuestions.length === 0) {
        throw badRequest(`No readable questions or text could be extracted from '${params.fileName}'.`);
      }

      // Default section name: if assigned to a stage, use stage name; otherwise General Questions
      let defaultSecName = "General Questions";
      if (assignedStageId) {
        const stageNames: Record<string, string> = {
          aptitude: "Aptitude Test",
          logical_reasoning: "Logical Reasoning",
          custom: "Custom Assessment",
          verbal: "Verbal Ability",
          coding: "Practical Coding Test",
        };
        defaultSecName = stageNames[assignedStageId] || assignedStageId;
      }

      let parsedQuestions: ParsedQuestion[] = [];
      let parsedSections: Array<{
        sectionTitle: string;
        sectionOrder: number;
        questions: ParsedQuestion[];
        totalQuestions: number;
        totalMarks: number;
      }> = [];

      if (isAiAssist) {
        // AI-Assisted generation (only when explicitly requested)
        const { questions } = await generateOrExtractQuestions(extractedText, {
          sectionTitle: defaultSecName,
          generateAdditional: true,
          targetCount,
        });
        parsedQuestions = questions;
        parsedSections = [
          {
            sectionTitle: defaultSecName,
            sectionOrder: 0,
            questions: parsedQuestions,
            totalQuestions: parsedQuestions.length,
            totalMarks: parsedQuestions.reduce((s, q) => s + (q.marks || 1), 0),
          },
        ];
      } else {
        // Direct Extraction from document (preserve sections, tables, options, answers)
        if (extractedText.trim()) {
          const parsed = parseTxtQuestions(extractedText, defaultSecName);
          parsedQuestions = parsed.questions;
          parsedSections = parsed.sections;
        }
        if (directQuestions.length > 0) {
          // Merge spreadsheet structured questions into sections
          const ssMap = new Map<string, ParsedQuestion[]>();
          for (const q of directQuestions) {
            const sec = q.sectionTitle || defaultSecName;
            if (!ssMap.has(sec)) ssMap.set(sec, []);
            ssMap.get(sec)!.push(q);
          }
          for (const [title, qs] of ssMap.entries()) {
            const existing = parsedSections.find((s) => s.sectionTitle.toLowerCase() === title.toLowerCase());
            if (existing) {
              existing.questions.push(...qs);
              existing.totalQuestions = existing.questions.length;
              existing.totalMarks = existing.questions.reduce((sum, q) => sum + (q.marks || 1), 0);
            } else {
              parsedSections.push({
                sectionTitle: title,
                sectionOrder: parsedSections.length,
                questions: qs,
                totalQuestions: qs.length,
                totalMarks: qs.reduce((sum, q) => sum + (q.marks || 1), 0),
              });
            }
          }
        }
      }

      // If document had no sections detected, ensure at least one default section
      if (parsedSections.length === 0) {
        parsedSections = [
          {
            sectionTitle: defaultSecName,
            sectionOrder: 0,
            questions: parsedQuestions,
            totalQuestions: parsedQuestions.length,
            totalMarks: parsedQuestions.reduce((s, q) => s + (q.marks || 1), 0),
          },
        ];
      }

      const totalQuestionsCount = parsedSections.reduce((s, sec) => s + sec.questions.length, 0);

      // 1. Create independent ExamDocument record
      const cleanDocName = params.fileName.replace(/\.[^/.]+$/, "").replace(/[_\-]+/g, " ").trim();

      const docRecord = await prisma.examDocument.create({
        data: {
          documentName: cleanDocName || params.fileName,
          originalFileName: params.fileName,
          fileType: detectedType,
          fileSize: params.size,
          rawText: extractedText,
          processingStatus: "PARSED",
          totalSections: parsedSections.length,
          totalQuestions: totalQuestionsCount,
          assignedStageId,
          assignedExamId: examId,
          uploadedById: req.user?.id,
          metadata: {
            isAiGenerated: isAiAssist,
            sectionsDetected: parsedSections.map((s) => s.sectionTitle),
          },
        },
      });

      // 2. Create independent DocumentSection and Question records
      const createdSections: any[] = [];

      for (let secIdx = 0; secIdx < parsedSections.length; secIdx++) {
        const sec = parsedSections[secIdx];
        const secRecord = await prisma.documentSection.create({
          data: {
            documentId: docRecord.id,
            sectionTitle: sec.sectionTitle,
            sectionOrder: secIdx,
            totalQuestions: sec.questions.length,
            totalMarks: sec.totalMarks,
          },
        });

        // Create questions for this section
        const questionCreates = [];
        for (let qIdx = 0; qIdx < sec.questions.length; qIdx++) {
          const q = sec.questions[qIdx];
          const acceptedAnswers = q.type === "SHORT" || q.type === "NUMERICAL" ? q.correctAnswers : [];

          const qCreated = await prisma.question.create({
            data: {
              documentId: docRecord.id,
              documentSectionId: secRecord.id,
              questionOrder: qIdx,
              type: q.type,
              text: q.text,
              explanation: q.explanation,
              difficulty: q.difficulty,
              marks: q.marks,
              negativeMarks: q.negativeMarks,
              acceptedAnswers,
              sourceType: isAiAssist ? "AI_GENERATED" : "EXTRACTED",
              approvalStatus: "APPROVED",
              sectionTitle: sec.sectionTitle,
              createdById: req.user?.id,
              options: {
                create: q.options.map((opt, oIdx) => ({
                  text: opt.text,
                  order: oIdx,
                  isCorrect: q.correctAnswers.some(
                    (ans) =>
                      ans.trim().toUpperCase() === opt.key.trim().toUpperCase() ||
                      ans.trim().toLowerCase() === opt.text.trim().toLowerCase()
                  ),
                })),
              },
            },
            include: { options: true },
          });

          questionCreates.push(qCreated);

          // Sync question to Firestore
          await firestore.saveQuestion({
            questionId: qCreated.id,
            documentId: docRecord.id,
            sectionId: secRecord.id,
            questionOrder: qIdx,
            type: qCreated.type,
            text: qCreated.text,
            marks: qCreated.marks,
            negativeMarks: qCreated.negativeMarks,
            difficulty: qCreated.difficulty,
            createdAt: qCreated.createdAt.toISOString(),
          });
        }

        createdSections.push({
          ...secRecord,
          questions: questionCreates,
        });

        // Sync section to Firestore
        await firestore.saveDocumentSection({
          sectionId: secRecord.id,
          documentId: docRecord.id,
          sectionTitle: secRecord.sectionTitle,
          sectionOrder: secRecord.sectionOrder,
          totalQuestions: secRecord.totalQuestions,
          totalMarks: secRecord.totalMarks,
        });
      }

      // Sync document to Firestore
      await firestore.saveExamDocument({
        documentId: docRecord.id,
        documentName: docRecord.documentName,
        originalFileName: docRecord.originalFileName,
        fileType: docRecord.fileType,
        uploadedAt: docRecord.uploadedAt.toISOString(),
        uploadedBy: req.user?.email || req.user?.id,
        processingStatus: docRecord.processingStatus,
        totalSections: docRecord.totalSections,
        totalQuestions: docRecord.totalQuestions,
        assignedStageId: docRecord.assignedStageId,
      });

      return {
        ...docRecord,
        sections: createdSections,
      };
    }

    // Process each uploaded file separately
    for (const file of filesToProcess) {
      try {
        const docResult = await processSingleDocument({
          fileName: file.originalname,
          buffer: file.buffer,
          size: file.size,
        });
        createdDocuments.push(docResult);
      } catch (err: any) {
        console.error(`Error processing '${file.originalname}':`, err);
        throw badRequest(`Processing failed for '${file.originalname}': ${err.message || "Unknown error"}`);
      }
    }

    // Process pasted text if no files were uploaded
    if (filesToProcess.length === 0 && pastedText) {
      const docResult = await processSingleDocument({
        fileName: req.body.fileName || "Pasted_Question_Paper.txt",
        text: pastedText,
        size: Buffer.byteLength(pastedText, "utf-8"),
      });
      createdDocuments.push(docResult);
    }

    await audit(req, "document.upload_batch", "ExamDocument", undefined, {
      count: createdDocuments.length,
      files: createdDocuments.map((d) => d.originalFileName),
      assignedStageId,
    });

    res.status(201).json({
      success: true,
      count: createdDocuments.length,
      documents: createdDocuments,
    });
  })
);

/**
 * GET /api/documents
 * List all uploaded documents with their sections and question counts.
 */
documentsRouter.get(
  "/",
  ah(async (req, res) => {
    const stageId = req.query.stageId ? String(req.query.stageId) : undefined;
    const examId = req.query.examId ? String(req.query.examId) : undefined;

    const where: any = {};
    if (stageId) where.assignedStageId = stageId;
    if (examId) where.assignedExamId = examId;

    const docs = await prisma.examDocument.findMany({
      where,
      orderBy: { uploadedAt: "desc" },
      include: {
        sections: {
          orderBy: { sectionOrder: "asc" },
          select: {
            id: true,
            sectionTitle: true,
            sectionOrder: true,
            totalQuestions: true,
            totalMarks: true,
            timeLimitMinutes: true,
          },
        },
      },
    });

    res.json(docs);
  })
);

/**
 * GET /api/documents/:id
 * Get full document details, sections, and questions.
 */
documentsRouter.get(
  "/:id",
  ah(async (req, res) => {
    const doc = await prisma.examDocument.findUnique({
      where: { id: req.params.id },
      include: {
        sections: {
          orderBy: { sectionOrder: "asc" },
          include: {
            questions: {
              orderBy: { questionOrder: "asc" },
              include: { options: { orderBy: { order: "asc" } } },
            },
          },
        },
      },
    });

    if (!doc) throw notFound("Exam document");
    res.json(doc);
  })
);

/**
 * PATCH /api/documents/:id
 * Update document metadata (name, assignedStageId, assignedExamId).
 */
documentsRouter.patch(
  "/:id",
  ah(async (req, res) => {
    const body = parse(
      z.object({
        documentName: z.string().optional(),
        assignedStageId: z.string().optional().nullable(),
        assignedExamId: z.string().optional().nullable(),
        processingStatus: z.enum(["PARSED", "PROCESSING", "ASSIGNED", "ERROR"]).optional(),
      }),
      req.body
    );

    const updated = await prisma.examDocument.update({
      where: { id: req.params.id },
      data: body,
      include: { sections: true },
    });

    await firestore.saveExamDocument({
      documentId: updated.id,
      documentName: updated.documentName,
      originalFileName: updated.originalFileName,
      fileType: updated.fileType,
      uploadedAt: updated.uploadedAt.toISOString(),
      uploadedBy: req.user?.email || req.user?.id,
      processingStatus: updated.processingStatus,
      totalSections: updated.totalSections,
      totalQuestions: updated.totalQuestions,
      assignedStageId: updated.assignedStageId,
    });

    res.json(updated);
  })
);

/**
 * DELETE /api/documents/:id
 * Delete document and cascade delete its sections and questions.
 * Leaves all other documents intact.
 */
documentsRouter.delete(
  "/:id",
  ah(async (req, res) => {
    const doc = await prisma.examDocument.findUnique({
      where: { id: req.params.id },
    });
    if (!doc) throw notFound("Exam document");

    await prisma.examDocument.delete({
      where: { id: req.params.id },
    });

    await firestore.deleteExamDocument(req.params.id);

    await audit(req, "document.delete", "ExamDocument", req.params.id, {
      fileName: doc.originalFileName,
    });

    res.json({ success: true, deletedId: req.params.id });
  })
);

/**
 * POST /api/documents/:id/reprocess
 * Reprocesses ONLY this document from its stored rawText.
 * Leaves all other documents untouched.
 */
documentsRouter.post(
  "/:id/reprocess",
  ah(async (req, res) => {
    const doc = await prisma.examDocument.findUnique({
      where: { id: req.params.id },
    });
    if (!doc) throw notFound("Exam document");

    if (!doc.rawText || !doc.rawText.trim()) {
      throw badRequest("Document does not contain stored text for reprocessing.");
    }

    // Delete existing sections and questions belonging ONLY to this document
    await prisma.question.deleteMany({ where: { documentId: doc.id } });
    await prisma.documentSection.deleteMany({ where: { documentId: doc.id } });

    const defaultSec = doc.assignedStageId || "General Questions";
    const parsed = parseTxtQuestions(doc.rawText, defaultSec);

    let parsedSections = parsed.sections;
    if (parsedSections.length === 0) {
      parsedSections = [
        {
          sectionTitle: defaultSec,
          sectionOrder: 0,
          questions: parsed.questions,
          totalQuestions: parsed.questions.length,
          totalMarks: parsed.questions.reduce((s, q) => s + (q.marks || 1), 0),
        },
      ];
    }

    const createdSections = [];
    for (let secIdx = 0; secIdx < parsedSections.length; secIdx++) {
      const sec = parsedSections[secIdx];
      const secRecord = await prisma.documentSection.create({
        data: {
          documentId: doc.id,
          sectionTitle: sec.sectionTitle,
          sectionOrder: secIdx,
          totalQuestions: sec.questions.length,
          totalMarks: sec.totalMarks,
        },
      });

      const qCreatedList = [];
      for (let qIdx = 0; qIdx < sec.questions.length; qIdx++) {
        const q = sec.questions[qIdx];
        const qCreated = await prisma.question.create({
          data: {
            documentId: doc.id,
            documentSectionId: secRecord.id,
            questionOrder: qIdx,
            type: q.type,
            text: q.text,
            explanation: q.explanation,
            difficulty: q.difficulty,
            marks: q.marks,
            negativeMarks: q.negativeMarks,
            acceptedAnswers: q.correctAnswers,
            sourceType: "EXTRACTED",
            approvalStatus: "APPROVED",
            sectionTitle: sec.sectionTitle,
            createdById: req.user?.id,
            options: {
              create: q.options.map((opt, oIdx) => ({
                text: opt.text,
                order: oIdx,
                isCorrect: q.correctAnswers.some((ans) => ans.toUpperCase() === opt.key.toUpperCase()),
              })),
            },
          },
          include: { options: true },
        });
        qCreatedList.push(qCreated);
      }

      createdSections.push({
        ...secRecord,
        questions: qCreatedList,
      });
    }

    const totalQCount = parsedSections.reduce((sum, s) => sum + s.questions.length, 0);

    const updatedDoc = await prisma.examDocument.update({
      where: { id: doc.id },
      data: {
        totalSections: createdSections.length,
        totalQuestions: totalQCount,
        processingStatus: "PARSED",
      },
      include: { sections: true },
    });

    await audit(req, "document.reprocess", "ExamDocument", doc.id, {
      totalSections: createdSections.length,
      totalQuestions: totalQCount,
    });

    res.json({
      success: true,
      document: {
        ...updatedDoc,
        sections: createdSections,
      },
    });
  })
);

/**
 * PATCH /api/documents/:documentId/sections/:sectionId
 * Update a specific document section.
 */
documentsRouter.patch(
  "/:documentId/sections/:sectionId",
  ah(async (req, res) => {
    const body = parse(
      z.object({
        sectionTitle: z.string().optional(),
        timeLimitMinutes: z.number().optional().nullable(),
        totalMarks: z.number().optional(),
      }),
      req.body
    );

    const updated = await prisma.documentSection.update({
      where: { id: req.params.sectionId, documentId: req.params.documentId },
      data: body,
    });

    res.json(updated);
  })
);

/**
 * PATCH /api/documents/:documentId/questions/:questionId
 * Edit an individual question in a document section.
 */
documentsRouter.patch(
  "/:documentId/questions/:questionId",
  ah(async (req, res) => {
    const body = parse(
      z.object({
        text: z.string().min(3).optional(),
        type: z.enum(["SINGLE", "MULTIPLE", "TRUE_FALSE", "SHORT", "DESCRIPTIVE", "CODING", "NUMERICAL", "PROMPT"]).optional(),
        difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).optional(),
        marks: z.number().min(0).optional(),
        negativeMarks: z.number().min(0).optional(),
        explanation: z.string().optional().nullable(),
        options: z.array(z.object({ text: z.string(), isCorrect: z.boolean(), order: z.number().optional() })).optional(),
      }),
      req.body
    );

    const q = await prisma.question.findUnique({
      where: { id: req.params.questionId, documentId: req.params.documentId },
    });
    if (!q) throw notFound("Question");

    const updateData: any = {
      text: body.text,
      type: body.type,
      difficulty: body.difficulty,
      marks: body.marks,
      negativeMarks: body.negativeMarks,
      explanation: body.explanation,
    };

    if (body.options) {
      // Re-create options
      await prisma.questionOption.deleteMany({ where: { questionId: q.id } });
      updateData.options = {
        create: body.options.map((opt, i) => ({
          text: opt.text,
          isCorrect: opt.isCorrect,
          order: opt.order ?? i,
        })),
      };
    }

    const updated = await prisma.question.update({
      where: { id: q.id },
      data: updateData,
      include: { options: true },
    });

    res.json(updated);
  })
);

/**
 * DELETE /api/documents/:documentId/questions/:questionId
 * Delete a single question from a document section.
 */
documentsRouter.delete(
  "/:documentId/questions/:questionId",
  ah(async (req, res) => {
    const q = await prisma.question.findUnique({
      where: { id: req.params.questionId, documentId: req.params.documentId },
      include: { documentSection: true },
    });
    if (!q) throw notFound("Question");

    await prisma.question.delete({ where: { id: q.id } });

    // Update section and document question counts
    if (q.documentSectionId) {
      const remainingSecQuestions = await prisma.question.findMany({
        where: { documentSectionId: q.documentSectionId },
      });
      const secMarks = remainingSecQuestions.reduce((sum, item) => sum + item.marks, 0);
      await prisma.documentSection.update({
        where: { id: q.documentSectionId },
        data: {
          totalQuestions: remainingSecQuestions.length,
          totalMarks: secMarks,
        },
      });
    }

    const docQuestions = await prisma.question.count({
      where: { documentId: req.params.documentId },
    });
    await prisma.examDocument.update({
      where: { id: req.params.documentId },
      data: { totalQuestions: docQuestions },
    });

    res.json({ success: true, deletedQuestionId: q.id });
  })
);

/**
 * POST /api/documents/generate-paper
 * Document-wise examination configuration:
 * Generates an examination stage or populates an exam exclusively from the selected document and sections.
 */
const generatePaperSchema = z.object({
  examId: z.string(),
  documentId: z.string(),
  stageId: z.string().optional(), // e.g. "aptitude", "technical", etc.
  targetSectionId: z.string().optional(), // specific ExamSection id to populate
  selectedSectionIds: z.array(z.string()).min(1), // documentSection ids
  questionsPerSection: z.number().min(1).optional(),
  marksOverride: z.number().min(0).optional(),
  negativeMarksOverride: z.number().min(0).optional(),
  randomize: z.boolean().default(false),
});

documentsRouter.post(
  "/generate-paper",
  ah(async (req, res) => {
    const body = parse(generatePaperSchema, req.body);

    const exam = await prisma.exam.findUnique({
      where: { id: body.examId },
      include: { sections: true },
    });
    if (!exam) throw notFound("Exam");

    const doc = await prisma.examDocument.findUnique({
      where: { id: body.documentId },
      include: {
        sections: {
          where: { id: { in: body.selectedSectionIds } },
          include: {
            questions: {
              orderBy: { questionOrder: "asc" },
            },
          },
        },
      },
    });
    if (!doc) throw notFound("Exam document");

    let targetExamSectionId = body.targetSectionId;

    // If targetSectionId is not specified, find or create ExamSection for stageId or document name
    if (!targetExamSectionId) {
      const stageNameMap: Record<string, string> = {
        aptitude: "Aptitude Test",
        logical_reasoning: "Logical Reasoning",
        custom: "Custom Assessment",
        verbal: "Verbal Ability",
        coding: "Practical Coding Test",
      };
      const stageTitle = (body.stageId && stageNameMap[body.stageId]) || doc.documentName || "Assessment Stage";

      // Look for existing section matching title or stageType
      let existingSec = exam.sections.find(
        (s) =>
          (body.stageId && s.sectionType?.toLowerCase() === body.stageId.toLowerCase()) ||
          s.title.toLowerCase() === stageTitle.toLowerCase()
      );

      if (!existingSec) {
        existingSec = await prisma.examSection.create({
          data: {
            examId: exam.id,
            title: stageTitle,
            order: exam.sections.length,
            sectionType: body.stageId?.toUpperCase() || "DOCUMENT_STAGE",
            isMandatory: true,
          },
        });
      }
      targetExamSectionId = existingSec.id;
    }

    // Collect questions ONLY from the chosen document and selected sections
    const questionsToBind: Array<{ id: string; marks: number }> = [];

    for (const sec of doc.sections) {
      let pool = sec.questions;
      if (body.randomize) {
        pool = [...pool].sort(() => Math.random() - 0.5);
      }
      if (body.questionsPerSection && body.questionsPerSection < pool.length) {
        pool = pool.slice(0, body.questionsPerSection);
      }
      for (const q of pool) {
        questionsToBind.push({
          id: q.id,
          marks: body.marksOverride !== undefined ? body.marksOverride : q.marks,
        });
      }
    }

    if (questionsToBind.length === 0) {
      throw badRequest("No questions found in the selected document sections.");
    }

    // Attach questions to target exam section
    let currentOrder = await prisma.examQuestion.count({
      where: { sectionId: targetExamSectionId },
    });

    for (const item of questionsToBind) {
      // Avoid duplicate binding of same question to same exam section
      const exists = await prisma.examQuestion.findUnique({
        where: {
          sectionId_questionId: {
            sectionId: targetExamSectionId,
            questionId: item.id,
          },
        },
      });

      if (!exists) {
        await prisma.examQuestion.create({
          data: {
            sectionId: targetExamSectionId,
            questionId: item.id,
            order: currentOrder++,
            marks: item.marks,
          },
        });
      }
    }

    // Recompute total marks for the exam
    const allSections = await prisma.examSection.findMany({
      where: { examId: exam.id },
      include: {
        questions: { include: { question: true } },
        randomRules: true,
      },
    });
    const totalMarks = allSections.reduce(
      (sum, s) =>
        sum +
        s.questions.reduce((a, q) => a + (q.marks ?? q.question.marks), 0) +
        s.randomRules.reduce((a, r) => a + r.count * (r.marksEach ?? 1), 0),
      0
    );
    await prisma.exam.update({
      where: { id: exam.id },
      data: { totalMarks },
    });

    // Mark document as ASSIGNED
    await prisma.examDocument.update({
      where: { id: doc.id },
      data: {
        processingStatus: "ASSIGNED",
        assignedExamId: exam.id,
        assignedStageId: body.stageId || doc.assignedStageId,
      },
    });

    await audit(req, "document.generate_paper", "Exam", exam.id, {
      documentId: doc.id,
      targetSectionId: targetExamSectionId,
      questionsAdded: questionsToBind.length,
      totalMarks,
    });

    res.json({
      success: true,
      examId: exam.id,
      targetSectionId: targetExamSectionId,
      questionsAdded: questionsToBind.length,
      totalMarks,
    });
  })
);


import { Router } from "express";
import { z } from "zod";
import ExcelJS from "exceljs";
import { prisma, type Prisma, type QuestionType } from "../../lib/prisma";
import { ah, badRequest, notFound, pageParams, parse } from "../../lib/http";
import { requireStaff } from "../../middleware/auth";
import { sheetUpload } from "../../middleware/upload";
import { audit } from "../../lib/audit";

export const questionsRouter = Router();
questionsRouter.use(requireStaff);

// ───────────── Categories ─────────────
questionsRouter.get(
  "/categories",
  ah(async (_req, res) => {
    res.json(await prisma.questionCategory.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { questions: { where: { isActive: true } } } } } }));
  }),
);
const catSchema = z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(300).optional().nullable() });
questionsRouter.post(
  "/categories",
  ah(async (req, res) => {
    const c = await prisma.questionCategory.create({ data: parse(catSchema, req.body) });
    await audit(req, "category.create", "QuestionCategory", c.id, { name: c.name });
    res.status(201).json(c);
  }),
);
questionsRouter.patch(
  "/categories/:id",
  ah(async (req, res) => {
    res.json(await prisma.questionCategory.update({ where: { id: req.params.id }, data: parse(catSchema.partial(), req.body) }));
  }),
);
questionsRouter.delete(
  "/categories/:id",
  ah(async (req, res) => {
    const count = await prisma.question.count({ where: { categoryId: req.params.id } });
    if (count > 0) throw badRequest("Move or delete the questions in this category first");
    await prisma.questionCategory.delete({ where: { id: req.params.id } });
    await audit(req, "category.delete", "QuestionCategory", req.params.id);
    res.json({ ok: true });
  }),
);

// ───────────── Questions ─────────────
const TYPES = ["SINGLE", "MULTIPLE", "TRUE_FALSE", "SHORT", "DESCRIPTIVE", "CODING", "NUMERICAL"] as const;
const optionSchema = z.object({ id: z.string().optional(), text: z.string().trim().min(1).max(2000), isCorrect: z.boolean() });
const questionSchema = z.object({
  type: z.enum(TYPES),
  text: z.string().trim().min(3).max(10000),
  explanation: z.string().trim().max(5000).optional().nullable(),
  categoryId: z.string().optional().nullable(),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).default("MEDIUM"),
  marks: z.number().min(0).max(100).default(1),
  negativeMarks: z.number().min(0).max(100).default(0),
  acceptedAnswers: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  numericTolerance: z.number().min(0).optional().nullable(),
  codeLanguage: z.string().max(40).optional().nullable(),
  codeStarter: z.string().max(10000).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(15).default([]),
  options: z.array(optionSchema).max(10).default([]),
});
type QuestionInput = z.infer<typeof questionSchema>;

function validateQuestion(q: QuestionInput): string | null {
  const correct = q.options.filter((o) => o.isCorrect).length;
  switch (q.type) {
    case "SINGLE":
      if (q.options.length < 2) return "Add at least two options";
      if (correct !== 1) return "Single-correct questions need exactly one correct option";
      break;
    case "MULTIPLE":
      if (q.options.length < 2) return "Add at least two options";
      if (correct < 1) return "Mark at least one option as correct";
      break;
    case "TRUE_FALSE":
      if (q.options.length !== 2 || correct !== 1) return "True/False questions need the two options True and False with one marked correct";
      break;
    case "NUMERICAL":
      if (q.acceptedAnswers.length !== 1 || Number.isNaN(Number(q.acceptedAnswers[0]))) return "Numerical questions need one numeric correct answer";
      break;
  }
  return null;
}

const optionTypes: QuestionType[] = ["SINGLE", "MULTIPLE", "TRUE_FALSE"];

questionsRouter.get(
  "/",
  ah(async (req, res) => {
    const { skip, take, page, pageSize } = pageParams(req.query);
    const where: Prisma.QuestionWhereInput = { isActive: req.query.inactive === "1" ? undefined : true };
    if (req.query.q) where.OR = [{ text: { contains: String(req.query.q), mode: "insensitive" } }, { tags: { has: String(req.query.q).toLowerCase() } }];
    if (req.query.type) where.type = String(req.query.type) as QuestionType;
    if (req.query.difficulty) where.difficulty = String(req.query.difficulty) as Prisma.EnumDifficultyFilter["equals"];
    if (req.query.categoryId) where.categoryId = String(req.query.categoryId);
    if (req.query.exclude) where.id = { notIn: String(req.query.exclude).split(",") };
    const [items, total] = await Promise.all([
      prisma.question.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: { category: { select: { id: true, name: true } }, options: { orderBy: { order: "asc" } }, _count: { select: { examQuestions: true } } },
      }),
      prisma.question.count({ where }),
    ]);
    res.json({ items, total, page, pageSize });
  }),
);

questionsRouter.get(
  "/stats",
  ah(async (_req, res) => {
    const [byType, byDifficulty, total] = await Promise.all([
      prisma.question.groupBy({ by: ["type"], where: { isActive: true }, _count: true }),
      prisma.question.groupBy({ by: ["difficulty"], where: { isActive: true }, _count: true }),
      prisma.question.count({ where: { isActive: true } }),
    ]);
    res.json({ total, byType, byDifficulty });
  }),
);

questionsRouter.get(
  "/:id",
  ah(async (req, res) => {
    const q = await prisma.question.findUnique({ where: { id: req.params.id }, include: { options: { orderBy: { order: "asc" } }, category: true } });
    if (!q) throw notFound("Question");
    res.json(q);
  }),
);

questionsRouter.post(
  "/",
  ah(async (req, res) => {
    const body = parse(questionSchema, req.body);
    const err = validateQuestion(body);
    if (err) throw badRequest(err);
    const { options, ...data } = body;
    const q = await prisma.question.create({
      data: {
        ...data,
        tags: data.tags.map((t) => t.toLowerCase()),
        createdById: req.user!.id,
        options: optionTypes.includes(body.type) ? { create: options.map((o, i) => ({ text: o.text, isCorrect: o.isCorrect, order: i })) } : undefined,
      },
      include: { options: true },
    });
    await audit(req, "question.create", "Question", q.id, { type: q.type });
    res.status(201).json(q);
  }),
);

questionsRouter.put(
  "/:id",
  ah(async (req, res) => {
    const body = parse(questionSchema, req.body);
    const err = validateQuestion(body);
    if (err) throw badRequest(err);
    const existing = await prisma.question.findUnique({ where: { id: req.params.id }, include: { options: true, _count: { select: { answers: true } } } });
    if (!existing) throw notFound("Question");
    const inUse = existing._count.answers > 0;
    if (inUse && existing.type !== body.type) throw badRequest("This question has been answered in an examination; its type cannot be changed. Duplicate it instead.");
    const keepIds = new Set(body.options.filter((o) => o.id).map((o) => o.id));
    const removed = existing.options.filter((o) => !keepIds.has(o.id));
    if (inUse && removed.length) throw badRequest("Options of an answered question cannot be removed. Duplicate the question to restructure it.");

    const { options, ...data } = body;
    await prisma.$transaction(async (tx) => {
      await tx.question.update({ where: { id: existing.id }, data: { ...data, tags: data.tags.map((t) => t.toLowerCase()) } });
      if (!optionTypes.includes(body.type)) {
        await tx.questionOption.deleteMany({ where: { questionId: existing.id } });
        return;
      }
      await tx.questionOption.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } });
      for (const [i, o] of options.entries()) {
        if (o.id && existing.options.some((e) => e.id === o.id)) await tx.questionOption.update({ where: { id: o.id }, data: { text: o.text, isCorrect: o.isCorrect, order: i } });
        else await tx.questionOption.create({ data: { questionId: existing.id, text: o.text, isCorrect: o.isCorrect, order: i } });
      }
    });
    await audit(req, "question.update", "Question", existing.id);
    res.json(await prisma.question.findUnique({ where: { id: existing.id }, include: { options: { orderBy: { order: "asc" } } } }));
  }),
);

questionsRouter.post(
  "/:id/duplicate",
  ah(async (req, res) => {
    const q = await prisma.question.findUnique({ where: { id: req.params.id }, include: { options: true } });
    if (!q) throw notFound("Question");
    const { id: _id, createdAt: _c, updatedAt: _u, options, createdById: _cb, ...rest } = q;
    const copy = await prisma.question.create({
      data: { ...rest, text: `${q.text} (copy)`, createdById: req.user!.id, options: { create: options.map((o) => ({ text: o.text, isCorrect: o.isCorrect, order: o.order })) } },
    });
    res.status(201).json(copy);
  }),
);

questionsRouter.delete(
  "/:id",
  ah(async (req, res) => {
    const q = await prisma.question.findUnique({ where: { id: req.params.id }, include: { _count: { select: { answers: true, examQuestions: true } } } });
    if (!q) throw notFound("Question");
    if (q._count.answers > 0 || q._count.examQuestions > 0) {
      await prisma.question.update({ where: { id: q.id }, data: { isActive: false } });
      await audit(req, "question.archive", "Question", q.id);
      return res.json({ ok: true, archived: true });
    }
    await prisma.question.delete({ where: { id: q.id } });
    await audit(req, "question.delete", "Question", q.id);
    res.json({ ok: true, archived: false });
  }),
);

// ───────────── Bulk import ─────────────
const TEMPLATE_HEADERS = ["type", "text", "option_a", "option_b", "option_c", "option_d", "option_e", "option_f", "correct", "marks", "negative_marks", "difficulty", "category", "tolerance", "explanation", "tags"];

questionsRouter.get(
  "/import/template",
  ah(async (_req, res) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Questions");
    ws.addRow(TEMPLATE_HEADERS);
    ws.addRow(["SINGLE", "Which material is commonly used for indexable turning inserts?", "Mild steel", "Tungsten carbide", "Aluminium", "Brass", "", "", "B", 1, 0.25, "EASY", "Mechanical", "", "Carbide offers hot hardness.", "machining,inserts"]);
    ws.addRow(["MULTIPLE", "Select all non-destructive testing methods.", "Ultrasonic testing", "Tensile test", "Magnetic particle inspection", "Charpy impact", "", "", "A,C", 2, 0, "MEDIUM", "Quality", "", "", "ndt"]);
    ws.addRow(["TRUE_FALSE", "Cast iron has better damping capacity than steel.", "", "", "", "", "", "", "True", 1, 0, "EASY", "Mechanical", "", "", ""]);
    ws.addRow(["NUMERICAL", "A shaft rotates at 1200 rpm. What is its speed in rev/s?", "", "", "", "", "", "", "20", 2, 0, "EASY", "Aptitude", "0", "", ""]);
    ws.addRow(["SHORT", "Expand the abbreviation CNC.", "", "", "", "", "", "", "Computer Numerical Control|Computerised Numerical Control", 1, 0, "EASY", "Mechanical", "", "", ""]);
    ws.addRow(["DESCRIPTIVE", "Explain the PDCA cycle with a shop-floor example.", "", "", "", "", "", "", "", 5, 0, "MEDIUM", "Quality", "", "", ""]);
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((c) => (c.width = 18));
    ws.getColumn(2).width = 60;
    const notes = wb.addWorksheet("Instructions");
    [
      ["Column", "How to fill"],
      ["type", "SINGLE, MULTIPLE, TRUE_FALSE, SHORT, DESCRIPTIVE, CODING or NUMERICAL"],
      ["option_a..option_f", "Options for SINGLE / MULTIPLE (2–6). Leave blank for other types."],
      ["correct", "SINGLE: one letter (B). MULTIPLE: letters separated by commas (A,C). TRUE_FALSE: True or False. NUMERICAL: the number. SHORT: accepted answers separated by |"],
      ["marks / negative_marks", "Numbers. Negative marks apply only if the exam enables negative marking."],
      ["difficulty", "EASY, MEDIUM or HARD"],
      ["category", "Category name — created automatically if it does not exist"],
      ["tolerance", "NUMERICAL only — allowed ± difference"],
      ["tags", "Comma-separated keywords"],
    ].forEach((r) => notes.addRow(r));
    notes.getColumn(1).width = 24;
    notes.getColumn(2).width = 110;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="question-import-template.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  }),
);

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return String(v.text);
    if ("result" in v) return String(v.result ?? "");
  }
  return String(v);
}

questionsRouter.post(
  "/import",
  sheetUpload.single("file"),
  ah(async (req, res) => {
    if (!req.file) throw badRequest("Choose a file to import");
    const dryRun = req.query.dryRun === "1";
    const wb = new ExcelJS.Workbook();
    if (/\.csv$/i.test(req.file.originalname)) {
      const { Readable } = await import("stream");
      await wb.csv.read(Readable.from(req.file.buffer));
    } else {
      await wb.xlsx.load(req.file.buffer as unknown as ArrayBuffer);
    }
    const ws = wb.worksheets[0];
    if (!ws) throw badRequest("The file has no worksheet");
    const header = (ws.getRow(1).values as ExcelJS.CellValue[]).slice(1).map((h) => cellText(h).trim().toLowerCase());
    const col = (name: string) => header.indexOf(name);
    if (col("type") < 0 || col("text") < 0) throw badRequest("The first row must contain the template headers (type, text, …)");

    const categories = new Map((await prisma.questionCategory.findMany()).map((c) => [c.name.toLowerCase(), c.id]));
    const errors: { row: number; error: string }[] = [];
    const valid: { row: number; input: QuestionInput; categoryName: string }[] = [];

    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const get = (n: string) => (col(n) >= 0 ? cellText(row.getCell(col(n) + 1).value).trim() : "");
      if (!get("type") && !get("text")) return;
      try {
        const type = get("type").toUpperCase().replace(/[\s/-]+/g, "_") as QuestionType;
        if (!TYPES.includes(type as (typeof TYPES)[number])) throw new Error(`Unknown type "${get("type")}"`);
        const letters = ["a", "b", "c", "d", "e", "f"];
        let options: { text: string; isCorrect: boolean }[] = [];
        const correct = get("correct");
        let acceptedAnswers: string[] = [];
        if (type === "SINGLE" || type === "MULTIPLE") {
          const marked = correct.toUpperCase().split(/[,;\s]+/).filter(Boolean);
          options = letters.map((l) => ({ l, text: get(`option_${l}`) })).filter((o) => o.text).map((o) => ({ text: o.text, isCorrect: marked.includes(o.l.toUpperCase()) }));
        } else if (type === "TRUE_FALSE") {
          const v = correct.toLowerCase();
          if (!["true", "false", "t", "f"].includes(v)) throw new Error("correct must be True or False");
          const isTrue = v.startsWith("t");
          options = [{ text: "True", isCorrect: isTrue }, { text: "False", isCorrect: !isTrue }];
        } else if (type === "NUMERICAL") {
          acceptedAnswers = [correct];
        } else if (type === "SHORT") {
          acceptedAnswers = correct.split("|").map((s) => s.trim()).filter(Boolean);
        }
        const input = questionSchema.parse({
          type,
          text: get("text"),
          explanation: get("explanation") || null,
          difficulty: (get("difficulty") || "MEDIUM").toUpperCase(),
          marks: get("marks") ? Number(get("marks")) : 1,
          negativeMarks: get("negative_marks") ? Number(get("negative_marks")) : 0,
          acceptedAnswers,
          numericTolerance: get("tolerance") ? Number(get("tolerance")) : null,
          tags: get("tags") ? get("tags").split(",").map((t) => t.trim()).filter(Boolean) : [],
          options,
        });
        const v = validateQuestion(input);
        if (v) throw new Error(v);
        valid.push({ row: rowNumber, input, categoryName: get("category") });
      } catch (e) {
        const msg = e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : (e as Error).message;
        errors.push({ row: rowNumber, error: msg });
      }
    });

    if (dryRun) return res.json({ dryRun: true, valid: valid.length, errors, preview: valid.slice(0, 10).map((v) => ({ row: v.row, type: v.input.type, text: v.input.text.slice(0, 120), category: v.categoryName })) });

    let created = 0;
    for (const v of valid) {
      let categoryId: string | null = null;
      if (v.categoryName) {
        const key = v.categoryName.toLowerCase();
        if (!categories.has(key)) {
          const c = await prisma.questionCategory.create({ data: { name: v.categoryName } });
          categories.set(key, c.id);
        }
        categoryId = categories.get(key)!;
      }
      const { options, ...data } = v.input;
      await prisma.question.create({
        data: { ...data, tags: data.tags.map((t) => t.toLowerCase()), categoryId, createdById: req.user!.id, options: options.length ? { create: options.map((o, i) => ({ ...o, order: i })) } : undefined },
      });
      created++;
    }
    await audit(req, "question.import", "Question", undefined, { file: req.file.originalname, created, failed: errors.length });
    res.json({ created, errors });
  }),
);

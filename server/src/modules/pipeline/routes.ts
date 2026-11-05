import { Router } from "express";
import { z } from "zod";
import { prisma, type PipelineStage } from "../../lib/prisma";
import { ah, notFound, parse } from "../../lib/http";
import { requireStaff } from "../../middleware/auth";
import { audit } from "../../lib/audit";
import { STAGES } from "../candidates/routes";
import { emailLayout, sendMail } from "../../lib/mailer";

export const pipelineRouter = Router();
pipelineRouter.use(requireStaff);

pipelineRouter.get(
  "/",
  ah(async (req, res) => {
    const examId = req.query.examId ? String(req.query.examId) : undefined;
    const candidates = await prisma.candidateProfile.findMany({
      where: { user: { isActive: true }, ...(examId ? { assignments: { some: { examId } } } : {}), ...(req.query.q ? { user: { isActive: true, name: { contains: String(req.query.q), mode: "insensitive" } } } : {}) },
      include: {
        user: { select: { name: true, email: true } },
        attempts: { where: { status: { not: "IN_PROGRESS" }, ...(examId ? { examId } : {}) }, select: { id: true, percentage: true, riskLevel: true, passed: true, exam: { select: { title: true } } }, orderBy: { percentage: "desc" }, take: 1 },
      },
      orderBy: { updatedAt: "desc" },
    });
    const columns = STAGES.map((stage) => ({
      stage,
      candidates: candidates
        .filter((c) => c.stage === stage)
        .map((c) => ({
          id: c.id,
          name: c.user.name,
          email: c.user.email,
          college: c.college,
          degree: c.degree,
          branch: c.branch,
          graduationYear: c.graduationYear,
          best: c.attempts[0] ? { attemptId: c.attempts[0].id, percentage: c.attempts[0].percentage, riskLevel: c.attempts[0].riskLevel, passed: c.attempts[0].passed, exam: c.attempts[0].exam.title } : null,
          updatedAt: c.updatedAt,
        }))
        .sort((a, b) => (b.best?.percentage ?? -1) - (a.best?.percentage ?? -1)),
    }));
    res.json(columns);
  }),
);

pipelineRouter.post(
  "/move",
  ah(async (req, res) => {
    const body = parse(
      z.object({ candidateIds: z.array(z.string()).min(1).max(500), stage: z.enum(STAGES as [PipelineStage, ...PipelineStage[]]), note: z.string().max(1000).optional().nullable(), notify: z.boolean().default(false) }),
      req.body,
    );
    const cands = await prisma.candidateProfile.findMany({ where: { id: { in: body.candidateIds } }, include: { user: { select: { email: true, name: true } } } });
    if (!cands.length) throw notFound("Candidates");
    for (const c of cands) {
      if (c.stage === body.stage) continue;
      await prisma.$transaction([
        prisma.candidateProfile.update({ where: { id: c.id }, data: { stage: body.stage } }),
        prisma.pipelineHistory.create({ data: { candidateId: c.id, fromStage: c.stage, toStage: body.stage, note: body.note ?? null, changedById: req.user!.id } }),
      ]);
      if (body.notify && ["SHORTLISTED", "INTERVIEW", "SELECTED"].includes(body.stage)) {
        const msg: Record<string, string> = {
          SHORTLISTED: "Congratulations — you have been shortlisted for the next stage of the Zanvar Group selection process. Our HR team will contact you with details.",
          INTERVIEW: "You have been invited for an interview with Zanvar Group. Our HR team will contact you to schedule it.",
          SELECTED: "Congratulations — you have been selected. Our HR team will contact you with the offer details.",
        };
        await sendMail(c.user.email, "Update on your application — Zanvar Group", `Dear ${c.user.name},\n\n${msg[body.stage]}`, emailLayout("Application update", `<p>Dear ${c.user.name},</p><p>${msg[body.stage]}</p>`));
      }
    }
    await audit(req, "pipeline.move", "CandidateProfile", undefined, { candidateIds: body.candidateIds, stage: body.stage, notify: body.notify });
    res.json({ ok: true, moved: cands.length });
  }),
);

pipelineRouter.get(
  "/history/:candidateId",
  ah(async (req, res) => {
    res.json(await prisma.pipelineHistory.findMany({ where: { candidateId: req.params.candidateId }, orderBy: { createdAt: "desc" }, include: { changedBy: { select: { name: true } } } }));
  }),
);

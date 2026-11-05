import { prisma, type PipelineStage } from "./prisma";
import { badRequest, notFound } from "./http";

export interface Eligibility {
  degrees?: string[];
  branches?: string[];
  graduationYears?: number[];
  colleges?: string[];
}

export function checkEligibility(
  elig: Eligibility | null | undefined,
  p: { degree: string; branch: string; graduationYear: number; college: string },
): string | null {
  if (!elig) return null;
  const inList = (list: string[] | undefined, v: string) => !list || list.length === 0 || list.some((x) => x.trim().toLowerCase() === v.trim().toLowerCase());
  if (!inList(elig.degrees, p.degree)) return `This examination is open to ${elig.degrees!.join(", ")} candidates only`;
  if (!inList(elig.branches, p.branch)) return `This examination is open to ${elig.branches!.join(", ")} branches only`;
  if (elig.graduationYears?.length && !elig.graduationYears.includes(p.graduationYear))
    return `This examination is open to graduation years ${elig.graduationYears.join(", ")} only`;
  if (!inList(elig.colleges, p.college)) return "Your college is not eligible for this examination";
  return null;
}

const STAGE_ORDER: PipelineStage[] = ["REGISTERED", "ELIGIBLE", "EXAM_SCHEDULED", "EXAM_COMPLETED", "EVALUATION", "SHORTLISTED", "INTERVIEW", "SELECTED", "REJECTED"];

/** Moves a candidate forward in the pipeline (never backwards automatically). */
export async function advanceStage(candidateId: string, to: PipelineStage, note?: string, changedById?: string | null) {
  const c = await prisma.candidateProfile.findUnique({ where: { id: candidateId }, select: { stage: true } });
  if (!c) return;
  if (["SHORTLISTED", "INTERVIEW", "SELECTED", "REJECTED"].includes(c.stage)) return;
  if (STAGE_ORDER.indexOf(to) <= STAGE_ORDER.indexOf(c.stage)) return;
  await prisma.$transaction([
    prisma.candidateProfile.update({ where: { id: candidateId }, data: { stage: to } }),
    prisma.pipelineHistory.create({ data: { candidateId, fromStage: c.stage, toStage: to, note: note ?? "Automatic update", changedById: changedById ?? null } }),
  ]);
}

export async function redeemInvitation(candidateId: string, email: string, rawCode: string) {
  const code = rawCode.trim().toUpperCase();
  const inv = await prisma.invitation.findUnique({ where: { code }, include: { exam: true } });
  if (!inv) throw notFound("Invitation code");
  if (inv.exam.status !== "PUBLISHED") throw badRequest("This examination is not open yet");
  if (inv.expiresAt && inv.expiresAt < new Date()) throw badRequest("This invitation code has expired");
  if (inv.exam.endAt < new Date()) throw badRequest("This examination has already ended");
  if (inv.email && inv.email.toLowerCase() !== email.toLowerCase()) throw badRequest("This invitation was issued to a different email address");
  const existing = await prisma.examAssignment.findUnique({ where: { examId_candidateId: { examId: inv.examId, candidateId } } });
  if (existing) return { exam: inv.exam, alreadyAssigned: true };
  if (inv.usedCount >= inv.maxUses) throw badRequest("This invitation code has reached its usage limit");
  const profile = await prisma.candidateProfile.findUniqueOrThrow({ where: { id: candidateId } });
  const reason = checkEligibility(inv.exam.eligibility as Eligibility | null, profile);
  if (reason) throw badRequest(reason);

  await prisma.$transaction([
    prisma.examAssignment.create({ data: { examId: inv.examId, candidateId, invitationCode: code } }),
    prisma.invitation.update({ where: { id: inv.id }, data: { usedCount: { increment: 1 } } }),
  ]);
  await advanceStage(candidateId, "EXAM_SCHEDULED", `Invited to ${inv.exam.title}`);
  return { exam: inv.exam, alreadyAssigned: false };
}

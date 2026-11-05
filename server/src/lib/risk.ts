import { prisma, type Severity } from "./prisma";
import { getSettings, type Settings } from "./settings";

export function riskLevel(score: number, s: Settings) {
  if (score >= s.riskThresholds.high) return "HIGH";
  if (score >= s.riskThresholds.medium) return "MEDIUM";
  if (score >= s.riskThresholds.low) return "LOW";
  return "NORMAL";
}

export interface IncomingEvent {
  type: string;
  message?: string;
  occurredAt: Date;
  meta?: Record<string, unknown>;
  evidenceId?: string | null;
}

/**
 * Records a proctoring event and recomputes the attempt's advisory risk score.
 * Score = Σ weights of counted events, where an event counts only if it is past the
 * per-type grace count, outside the cooldown of the previous counted event of the same
 * type, and the type has not reached its contribution cap. Final score capped at 100.
 */
export async function recordEvent(attemptId: string, ev: IncomingEvent) {
  const settings = await getSettings();
  const attempt = await prisma.attempt.findUnique({ where: { id: attemptId }, select: { id: true, examId: true, candidateId: true } });
  if (!attempt) throw new Error("Attempt not found");
  const rule = settings.riskRules[ev.type];

  return prisma.$transaction(async (tx) => {
    let weightApplied = 0;
    if (rule && rule.weight > 0) {
      const prior = await tx.proctorEvent.findMany({
        where: { attemptId, type: ev.type },
        select: { occurredAt: true, weightApplied: true },
        orderBy: { occurredAt: "asc" },
      });
      const contributed = prior.reduce((a, p) => a + p.weightApplied, 0);
      const lastCounted = [...prior].reverse().find((p) => p.weightApplied > 0);
      const inCooldown = lastCounted && ev.occurredAt.getTime() - lastCounted.occurredAt.getTime() < rule.cooldownSec * 1000;
      const lastAny = prior[prior.length - 1];
      const duplicate = lastAny && Math.abs(ev.occurredAt.getTime() - lastAny.occurredAt.getTime()) < 1000;
      if (prior.length >= rule.graceCount && !inCooldown && !duplicate && contributed < rule.maxContribution) {
        weightApplied = Math.min(rule.weight, rule.maxContribution - contributed);
      }
    }
    const created = await tx.proctorEvent.create({
      data: {
        attemptId,
        examId: attempt.examId,
        candidateId: attempt.candidateId,
        type: ev.type,
        severity: (rule?.severity ?? "INFO") as Severity,
        message: ev.message ?? rule?.label ?? ev.type,
        weightApplied,
        meta: (ev.meta ?? undefined) as object | undefined,
        evidenceId: ev.evidenceId ?? null,
        occurredAt: ev.occurredAt,
      },
    });
    const agg = await tx.proctorEvent.aggregate({ where: { attemptId }, _sum: { weightApplied: true } });
    const score = Math.min(100, agg._sum.weightApplied ?? 0);
    const level = riskLevel(score, settings);
    await tx.attempt.update({ where: { id: attemptId }, data: { riskScore: score, riskLevel: level } });
    return { event: created, riskScore: score, riskLevel: level };
  });
}

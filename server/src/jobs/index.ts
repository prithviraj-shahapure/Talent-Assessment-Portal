import { prisma } from "../lib/prisma";
import { finalizeAttempt } from "../lib/attempts";
import { storage } from "../lib/storage";
import type { Paper } from "../lib/engine";

/** Server-side timer enforcement: auto-submits attempts whose deadline has passed, even if the browser is closed. */
async function sweepExpiredAttempts() {
  const now = Date.now();
  const due = await prisma.attempt.findMany({ where: { status: "IN_PROGRESS" }, select: { id: true, deadlineAt: true, currentSection: true, sectionStartedAt: true, paper: true } });
  for (const a of due) {
    const paper = a.paper as unknown as Paper;
    const last = paper.length - 1;
    const lastLimit = paper[last]?.timeLimitMinutes;
    const lastSectionOver = a.currentSection === last && lastLimit && a.sectionStartedAt && now > a.sectionStartedAt.getTime() + lastLimit * 60_000 + 10_000;
    if (now > a.deadlineAt.getTime() + 10_000 || lastSectionOver) {
      try {
        await finalizeAttempt(a.id, true);
        console.log(`[jobs] auto-submitted attempt ${a.id}`);
      } catch (e) {
        console.error("[jobs] auto-submit failed", a.id, e);
      }
    }
  }
}

/** Retention policy: deletes evidence and verification photos past their expiry date. */
async function purgeExpiredEvidence() {
  const expired = await prisma.evidenceFile.findMany({ where: { expiresAt: { lt: new Date() } }, take: 500 });
  for (const ev of expired) {
    await storage.remove(ev.storageKey);
    await prisma.evidenceFile.delete({ where: { id: ev.id } });
  }
  if (expired.length) {
    await prisma.auditLog.create({ data: { action: "retention.purge", entity: "EvidenceFile", details: { deleted: expired.length } } });
    console.log(`[jobs] retention purge removed ${expired.length} evidence file(s)`);
  }
  // expired one-time tokens
  await prisma.emailToken.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 7 * 86400_000) } } });
}

export function startJobs() {
  const run = (fn: () => Promise<void>, name: string) => fn().catch((e) => console.error(`[jobs] ${name}`, e));
  run(sweepExpiredAttempts, "sweep");
  setInterval(() => run(sweepExpiredAttempts, "sweep"), 15_000).unref();
  run(purgeExpiredEvidence, "purge");
  setInterval(() => run(purgeExpiredEvidence, "purge"), 6 * 3600_000).unref();
}

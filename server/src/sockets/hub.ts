import type { Server } from "socket.io";

export interface LiveStatus {
  attemptId: string;
  examId: string;
  candidateId: string;
  candidateName: string;
  examTitle: string;
  deadlineAt: string;
  currentQuestion: number;
  totalQuestions: number;
  answered: number;
  camera: "ON" | "OFF" | "NOT_REQUIRED";
  microphone: "ON" | "OFF" | "NOT_REQUIRED";
  focused: boolean;
  fullscreen: boolean;
  faceCount: number | null;
  audioLevel: number;
  connected: boolean;
  status: "ACTIVE" | "SUBMITTED" | "AUTO_SUBMITTED" | "DISCONNECTED";
  eventCount: number;
  riskScore: number;
  riskLevel: string;
  lastSeenAt: string;
  previewAllowed: boolean;
  multiFaceViolations?: number;
  screenshotViolations?: number;
  tabSwitchViolations?: number;
}

/**
 * In-memory hub for live proctoring state. Status snapshots are kept here (not in the DB)
 * because they change every few seconds; durable facts (events, risk) are persisted separately.
 * For multi-instance deployments replace with the Socket.IO Redis adapter + Redis hash.
 */
class LiveHub {
  io: Server | null = null;
  statuses = new Map<string, LiveStatus>();

  attach(io: Server) {
    this.io = io;
  }

  update(attemptId: string, patch: Partial<LiveStatus>) {
    const prev = this.statuses.get(attemptId);
    if (!prev && !patch.examId) return;
    const next = { ...(prev as LiveStatus), ...patch, attemptId, lastSeenAt: new Date().toISOString() };
    this.statuses.set(attemptId, next);
    this.io?.to("hr:live").to(`hr:exam:${next.examId}`).emit("live:status", next);
  }

  event(examId: string, attemptId: string, payload: Record<string, unknown>) {
    const s = this.statuses.get(attemptId);
    if (s) {
      if (typeof payload.riskScore === "number") {
        s.riskScore = payload.riskScore as number;
        s.riskLevel = String(payload.riskLevel);
        s.eventCount += 1;
      }
      if (typeof payload.multiFaceViolations === "number") {
        s.multiFaceViolations = payload.multiFaceViolations as number;
      }
      if (typeof payload.screenshotViolations === "number") {
        s.screenshotViolations = payload.screenshotViolations as number;
      }
      if (typeof payload.tabSwitchViolations === "number") {
        s.tabSwitchViolations = payload.tabSwitchViolations as number;
      }
    }
    this.io?.to("hr:live").to(`hr:exam:${examId}`).to(`hr:attempt:${attemptId}`).emit("live:event", { attemptId, examId, ...payload });
  }

  frame(attemptId: string, examId: string, image: string) {
    // Low-resolution preview frames go only to HR users currently watching this exam/attempt.
    this.io?.to(`hr:exam:${examId}`).to(`hr:attempt:${attemptId}`).to("hr:live").emit("live:frame", { attemptId, image, at: Date.now() });
  }

  attemptEnded(attemptId: string, examId: string, status: "SUBMITTED" | "AUTO_SUBMITTED") {
    const s = this.statuses.get(attemptId);
    if (s) {
      s.status = status;
      s.connected = false;
    }
    this.io?.to("hr:live").to(`hr:exam:${examId}`).emit("live:ended", { attemptId, examId, status });
    this.io?.to(`attempt:${attemptId}`).emit("attempt:ended", { status });
    // forget finished attempts after 30 minutes
    setTimeout(() => this.statuses.delete(attemptId), 30 * 60 * 1000).unref();
  }

  attemptPaused(attemptId: string, examId: string, reason?: string) {
    this.io?.to(`attempt:${attemptId}`).emit("attempt:paused", { attemptId, reason });
    this.io?.to("hr:live").to(`hr:exam:${examId}`).to(`hr:attempt:${attemptId}`).emit("live:attempt:paused", { attemptId, examId, reason });
  }

  attemptResumed(attemptId: string, examId: string) {
    this.io?.to(`attempt:${attemptId}`).emit("attempt:resumed", { attemptId });
    this.io?.to("hr:live").to(`hr:exam:${examId}`).to(`hr:attempt:${attemptId}`).emit("live:attempt:resumed", { attemptId, examId });
  }

  attemptTerminated(attemptId: string, examId: string, reason?: string) {
    const s = this.statuses.get(attemptId);
    if (s) {
      s.connected = false;
    }
    this.io?.to(`attempt:${attemptId}`).emit("attempt:terminated", { attemptId, reason });
    this.io?.to("hr:live").to(`hr:exam:${examId}`).to(`hr:attempt:${attemptId}`).emit("live:attempt:terminated", { attemptId, examId, reason });
  }

  attemptForceSubmitted(attemptId: string, examId: string, reason?: string) {
    this.attemptEnded(attemptId, examId, "AUTO_SUBMITTED");
    this.io?.to(`attempt:${attemptId}`).emit("attempt:force-submitted", { attemptId, reason });
  }

  sessionPaused(sessionId: string, examId: string, reason?: string) {
    this.io?.to(`session:${sessionId}`).emit("session:paused", { sessionId, reason });
    this.io?.to("hr:live").to(`hr:exam:${examId}`).emit("live:session:paused", { sessionId, reason });
  }

  sessionResumed(sessionId: string, examId: string) {
    this.io?.to(`session:${sessionId}`).emit("session:resumed", { sessionId });
    this.io?.to("hr:live").to(`hr:exam:${examId}`).emit("live:session:resumed", { sessionId });
  }

  sessionTerminated(sessionId: string, examId: string, reason?: string) {
    this.io?.to(`session:${sessionId}`).emit("session:terminated", { sessionId, reason });
    this.io?.to("hr:live").to(`hr:exam:${examId}`).emit("live:session:terminated", { sessionId, reason });
  }

  list(examId?: string) {
    return [...this.statuses.values()].filter((s) => !examId || s.examId === examId);
  }
}

export const liveHub = new LiveHub();

import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import cookie from "cookie";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AUTH_COOKIE, verifySession } from "../lib/tokens";
import { env } from "../config/env";
import { liveHub } from "./hub";
import { recordEvent } from "../lib/risk";
import type { Paper } from "../lib/engine";

interface SocketUser {
  id: string;
  role: string;
  candidateId: string | null;
  name: string;
}

const statusSchema = z.object({
  camera: z.enum(["ON", "OFF", "NOT_REQUIRED"]).optional(),
  microphone: z.enum(["ON", "OFF", "NOT_REQUIRED"]).optional(),
  focused: z.boolean().optional(),
  fullscreen: z.boolean().optional(),
  faceCount: z.number().int().min(0).max(10).nullable().optional(),
  audioLevel: z.number().min(0).max(1).optional(),
  currentQuestion: z.number().int().min(0).max(1000).optional(),
});

export function initSockets(server: HttpServer) {
  const io = new Server(server, {
    cors: { origin: env.clientOrigin, credentials: true },
    maxHttpBufferSize: 200_000, // preview frames are small JPEGs
    pingInterval: 10_000,
    pingTimeout: 15_000,
  });
  liveHub.attach(io);
  const disconnectTimers = new Map<string, NodeJS.Timeout>();

  io.use(async (socket, next) => {
    try {
      const cookies = cookie.parse(socket.handshake.headers.cookie ?? "");
      const payload = cookies[AUTH_COOKIE] ? verifySession(cookies[AUTH_COOKIE]) : null;
      if (!payload) return next(new Error("unauthorized"));
      const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, role: true, isActive: true, name: true, candidate: { select: { id: true } } } });
      if (!user?.isActive) return next(new Error("unauthorized"));
      socket.data.user = { id: user.id, role: user.role, candidateId: user.candidate?.id ?? null, name: user.name } satisfies SocketUser;
      next();
    } catch (e) {
      next(e as Error);
    }
  });

  io.on("connection", (socket) => {
    const user = socket.data.user as SocketUser;
    const isStaff = user.role === "SUPER_ADMIN" || user.role === "HR_ADMIN";

    // ───── HR side ─────
    if (isStaff) {
      socket.on("hr:watch", (p: { examId?: string } | undefined, ack?: (s: unknown) => void) => {
        for (const room of socket.rooms) if (room.startsWith("hr:")) socket.leave(room);
        socket.join(p?.examId ? `hr:exam:${p.examId}` : "hr:live");
        ack?.(liveHub.list(p?.examId));
      });
      socket.on("hr:watch-attempt", (p: { attemptId: string }) => p?.attemptId && socket.join(`hr:attempt:${p.attemptId}`));
      socket.on("hr:unwatch-attempt", (p: { attemptId: string }) => p?.attemptId && socket.leave(`hr:attempt:${p.attemptId}`));
      return;
    }

    // ───── Candidate side ─────
    let attemptId: string | null = null;
    let examId: string | null = null;
    let previewAllowed = false;
    let lastFrameAt = 0;

    socket.on("candidate:join", async (p: { attemptId: string }, ack?: (r: unknown) => void) => {
      try {
        const a = await prisma.attempt.findUnique({ where: { id: String(p?.attemptId) }, include: { exam: true, candidate: { include: { user: { select: { name: true } } } }, _count: { select: { events: true } } } });
        if (!a || a.candidateId !== user.candidateId || (a.status !== "IN_PROGRESS" && a.status !== "PAUSED")) return ack?.({ ok: false });
        attemptId = a.id;
        examId = a.examId;
        const info = (a.clientInfo ?? {}) as { webcamRequired?: boolean; microphoneRequired?: boolean };
        previewAllowed = a.exam.livePreview && !!info.webcamRequired;
        socket.join(`attempt:${a.id}`);
        if (a.sessionId) socket.join(`session:${a.sessionId}`);
        const t = disconnectTimers.get(a.id);
        if (t) {
          clearTimeout(t);
          disconnectTimers.delete(a.id);
        }
        const paper = a.paper as unknown as Paper;
        const answered = await prisma.answer.count({ where: { attemptId: a.id, OR: [{ selectedOptionIds: { isEmpty: false } }, { textAnswer: { not: null } }] } });
        liveHub.update(a.id, {
          attemptId: a.id,
          examId: a.examId,
          candidateId: a.candidateId,
          candidateName: a.candidate.user.name,
          examTitle: a.exam.title,
          deadlineAt: a.deadlineAt.toISOString(),
          currentQuestion: a.currentQuestion,
          totalQuestions: paper.reduce((n, s) => n + s.questions.length, 0),
          answered,
          camera: info.webcamRequired ? "OFF" : "NOT_REQUIRED",
          microphone: info.microphoneRequired ? "OFF" : "NOT_REQUIRED",
          focused: true,
          fullscreen: false,
          faceCount: null,
          audioLevel: 0,
          connected: true,
          status: "ACTIVE",
          eventCount: a._count.events,
          riskScore: a.riskScore,
          riskLevel: a.riskLevel,
          previewAllowed,
        });
        await prisma.attempt.update({ where: { id: a.id }, data: { lastSeenAt: new Date() } });
        ack?.({ ok: true, previewAllowed });
      } catch (e) {
        console.error("[socket] join failed", e);
        ack?.({ ok: false });
      }
    });

    socket.on("candidate:status", (raw: unknown) => {
      if (!attemptId) return;
      const r = statusSchema.safeParse(raw);
      if (!r.success) return;
      liveHub.update(attemptId, { ...r.data, connected: true, status: "ACTIVE" });
    });

    socket.on("candidate:frame", (p: { image?: string }) => {
      if (!attemptId || !examId || !previewAllowed) return;
      const now = Date.now();
      if (now - lastFrameAt < 1500) return; // throttle
      if (typeof p?.image !== "string" || !p.image.startsWith("data:image/jpeg;base64,") || p.image.length > 60_000) return;
      lastFrameAt = now;
      liveHub.frame(attemptId, examId, p.image);
    });

    socket.on("disconnect", () => {
      if (!attemptId) return;
      const id = attemptId;
      liveHub.update(id, { connected: false, status: "DISCONNECTED" });
      // Log a connection-loss event only if the candidate does not reconnect promptly
      disconnectTimers.set(
        id,
        setTimeout(async () => {
          disconnectTimers.delete(id);
          const a = await prisma.attempt.findUnique({ where: { id }, select: { status: true, examId: true } });
          if (a?.status === "IN_PROGRESS") {
            const r = await recordEvent(id, { type: "CONNECTION_LOST", occurredAt: new Date(), message: "Live connection lost for more than 20 seconds" });
            liveHub.event(a.examId, id, { id: r.event.id, type: r.event.type, severity: r.event.severity, message: r.event.message, occurredAt: r.event.occurredAt, weightApplied: 0, riskScore: r.riskScore, riskLevel: r.riskLevel });
          }
        }, 20_000),
      );
    });
  });

  return io;
}

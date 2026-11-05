import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { prisma, type SessionStatus } from "../../lib/prisma";
import { ah, badRequest, clientIp, forbidden, notFound, parse, unauthorized } from "../../lib/http";
import { requireStaff } from "../../middleware/auth";
import { audit } from "../../lib/audit";
import {
  generateRandomSessionCode,
  hashSessionCode,
  normalizeSessionCode,
  signSessionAccessToken,
  verifySessionAccessToken,
  SESSION_ACCESS_COOKIE,
} from "../../lib/sessions";
import { checkEligibility, type Eligibility } from "../../lib/invites";
import { AUTH_COOKIE, signSession } from "../../lib/tokens";
import { sessionCookieOptions } from "../../lib/cookies";

export const sessionsRouter = Router();

// Rate limiter for public verification endpoint: max 10 requests per 15 mins per IP/User to prevent brute force
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many verification attempts. Please wait a few minutes and try again." },
});

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC / CANDIDATE ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Public candidate verification landing endpoint.
 * Validates session code, candidate identity, eligibility, capacity, status, and creates necessary associations.
 */
sessionsRouter.post(
  "/verify",
  verifyLimiter,
  ah(async (req, res) => {
    const body = parse(
      z.object({
        sessionCode: z.string().trim().min(3).max(64),
        identifier: z.string().trim().min(3).max(120), // email or candidateId
      }),
      req.body
    );

    const normCode = normalizeSessionCode(body.sessionCode);
    const codeHash = hashSessionCode(normCode);

    // 1. Verify session code exists (check ExamSession first)
    let session = await prisma.examSession.findUnique({
      where: { sessionCodeHash: codeHash },
      include: {
        exam: {
          include: {
            sections: { orderBy: { order: "asc" } },
          },
        },
        _count: { select: { candidates: true } },
      },
    });

    // Check stripped code hash (without hyphens) if not found
    if (!session) {
      const stripped = normCode.replace(/[^A-Z0-9]/g, "");
      const strippedHash = hashSessionCode(stripped);
      session = await prisma.examSession.findUnique({
        where: { sessionCodeHash: strippedHash },
        include: {
          exam: {
            include: {
              sections: { orderBy: { order: "asc" } },
            },
          },
          _count: { select: { candidates: true } },
        },
      });
    }

    // If not found in ExamSession, verify if the code is a valid Examination Invitation Code or Assignment Code
    if (!session) {
      const stripped = normCode.replace(/[^A-Z0-9]/g, "");

      // Look up invitation by code
      const invitation = await prisma.invitation.findFirst({
        where: {
          OR: [
            { code: { equals: normCode, mode: "insensitive" } },
            { code: { equals: body.sessionCode.trim(), mode: "insensitive" } },
            { code: { equals: stripped, mode: "insensitive" } },
          ],
        },
        include: {
          exam: {
            include: {
              sections: { orderBy: { order: "asc" } },
            },
          },
        },
      });

      let matchedExam = invitation?.exam;

      // Also check candidate's assigned exams for this invitation code
      if (!matchedExam) {
        const assignment = await prisma.examAssignment.findFirst({
          where: {
            OR: [
              { invitationCode: { equals: normCode, mode: "insensitive" } },
              { invitationCode: { equals: body.sessionCode.trim(), mode: "insensitive" } },
              { invitationCode: { equals: stripped, mode: "insensitive" } },
            ],
          },
          include: {
            exam: {
              include: {
                sections: { orderBy: { order: "asc" } },
              },
            },
          },
        });
        if (assignment) {
          matchedExam = assignment.exam;
        }
      }

      if (matchedExam) {
        // Find existing active session for this exam, or auto-provision an active session
        session = await prisma.examSession.findFirst({
          where: {
            examId: matchedExam.id,
            status: { in: ["ACTIVE", "SCHEDULED"] },
          },
          include: {
            exam: {
              include: {
                sections: { orderBy: { order: "asc" } },
              },
            },
            _count: { select: { candidates: true } },
          },
        });

        if (!session) {
          const codeLastFour = normCode.slice(-4);
          const codePrefix = normCode.length > 4 ? normCode.slice(0, 4) : "";
          session = await prisma.examSession.create({
            data: {
              sessionName: `${matchedExam.title} - Main Session`,
              examId: matchedExam.id,
              sessionCodeHash: codeHash,
              codePrefix,
              codeLastFour,
              startsAt: matchedExam.startAt || new Date(Date.now() - 3600000),
              endsAt: matchedExam.endAt && matchedExam.endAt > new Date() ? matchedExam.endAt : new Date(Date.now() + 30 * 24 * 3600000),
              maxCandidates: 1000,
              maxAttempts: matchedExam.maxAttempts || 3,
              status: "ACTIVE",
              createdById: matchedExam.createdById,
            },
            include: {
              exam: {
                include: {
                  sections: { orderBy: { order: "asc" } },
                },
              },
              _count: { select: { candidates: true } },
            },
          });
        }
      }
    }

    if (!session) {
      await prisma.auditLog.create({
        data: {
          action: "session.verify_failed",
          entity: "ExamSession",
          details: { reason: "Invalid session code", identifier: body.identifier, rawCode: body.sessionCode },
          ipAddress: clientIp(req),
        },
      });
      throw badRequest("Invalid Session Code.");
    }

    // 2. Check session status
    const now = new Date();

    // Auto-sync session end time if exam window is wider
    if (session.exam.endAt && session.exam.endAt > session.endsAt) {
      session.endsAt = session.exam.endAt;
      await prisma.examSession.update({
        where: { id: session.id },
        data: { endsAt: session.exam.endAt },
      });
    }
    if (session.status === "REVOKED") {
      await prisma.sessionAuditLog.create({
        data: {
          sessionId: session.id,
          eventType: "ACCESS_DENIED",
          metadata: { reason: "Session Revoked", identifier: body.identifier },
          ipAddress: clientIp(req),
        },
      });
      throw badRequest("This examination session has been revoked by HR.");
    }
    if (session.status === "PAUSED") {
      await prisma.sessionAuditLog.create({
        data: {
          sessionId: session.id,
          eventType: "ACCESS_DENIED",
          metadata: { reason: "Session Paused", identifier: body.identifier },
          ipAddress: clientIp(req),
        },
      });
      throw badRequest("Examination Currently Paused. Please contact the proctor or wait for HR to resume.");
    }
    if (session.status === "COMPLETED") {
      await prisma.sessionAuditLog.create({
        data: {
          sessionId: session.id,
          eventType: "ACCESS_DENIED",
          metadata: { reason: "Session Completed", identifier: body.identifier },
          ipAddress: clientIp(req),
        },
      });
      throw badRequest("This examination session has ended.");
    }
    if (session.status === "EXPIRED" || now > session.endsAt) {
      await prisma.sessionAuditLog.create({
        data: {
          sessionId: session.id,
          eventType: "ACCESS_DENIED",
          metadata: { reason: "Session Expired", identifier: body.identifier },
          ipAddress: clientIp(req),
        },
      });
      throw badRequest("Session Expired.");
    }
    if (now < session.startsAt) {
      await prisma.sessionAuditLog.create({
        data: {
          sessionId: session.id,
          eventType: "ACCESS_DENIED",
          metadata: { reason: "Session Not Started", identifier: body.identifier },
          ipAddress: clientIp(req),
        },
      });
      throw badRequest(`Session Has Not Started Yet. Access opens at ${session.startsAt.toLocaleString("en-IN")}.`);
    }

    // Check exam status
    if (session.exam.status !== "PUBLISHED") {
      throw badRequest("This examination is not open.");
    }

    // 3. Resolve Candidate by email or candidateId (or user ID)
    const isEmail = body.identifier.includes("@");
    let candidate = await prisma.candidateProfile.findFirst({
      where: isEmail
        ? { user: { email: { equals: body.identifier.toLowerCase(), mode: "insensitive" } } }
        : { OR: [{ id: body.identifier }, { userId: body.identifier }] },
      include: { user: true },
    });

    // If candidate does not exist yet and it's a valid email, auto-provision temporary candidate account so invited candidates can join effortlessly!
    if (!candidate && isEmail) {
      const email = body.identifier.toLowerCase();
      // Check if user exists without candidate profile
      let user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        user = await prisma.user.create({
          data: {
            email,
            name: email.split("@")[0],
            passwordHash: "$2a$12$UnsetCandidateAccountTemporaryPlaceholderHash123",
            role: "CANDIDATE",
            emailVerified: true,
          },
        });
      }
      candidate = await prisma.candidateProfile.create({
        data: {
          userId: user.id,
          mobile: "0000000000",
          college: "Invited Candidate",
          degree: "B.Tech",
          branch: "Engineering",
          currentYear: "Final",
          graduationYear: new Date().getFullYear(),
        },
        include: { user: true },
      });
    }

    if (!candidate) {
      throw badRequest("Candidate Not Found. Please register or enter your registered email address.");
    }

    // 4. Check candidate eligibility
    const eligReason = checkEligibility(
      (session.eligibility || session.exam.eligibility) as Eligibility | null,
      candidate
    );
    if (eligReason) {
      // Log audit
      await prisma.sessionAuditLog.create({
        data: {
          sessionId: session.id,
          candidateId: candidate.id,
          eventType: "ACCESS_DENIED",
          metadata: { reason: "Ineligible", details: eligReason },
          ipAddress: clientIp(req),
        },
      });
      throw badRequest(`Candidate Not Eligible: ${eligReason}`);
    }

    // 5. Check session capacity
    // Check if candidate is already in this session
    const existingSessionCand = await prisma.sessionCandidate.findUnique({
      where: { sessionId_candidateId: { sessionId: session.id, candidateId: candidate.id } },
    });

    if (!existingSessionCand && session._count.candidates >= session.maxCandidates) {
      throw badRequest("Maximum Candidate Capacity Reached for this session.");
    }

    // 6. Check Attempt limit
    const attemptsCount = await prisma.attempt.count({
      where: { examId: session.examId, candidateId: candidate.id },
    });
    if (attemptsCount >= session.maxAttempts) {
      throw badRequest("Examination Already Completed. You have used all permitted attempts for this session.");
    }

    // Check if candidate currently has an ongoing attempt
    const activeAttempt = await prisma.attempt.findFirst({
      where: { examId: session.examId, candidateId: candidate.id, status: "IN_PROGRESS", deadlineAt: { gt: now } },
      select: { id: true },
    });

    // 7. Register / update SessionCandidate mapping
    const sessionCand = await prisma.sessionCandidate.upsert({
      where: { sessionId_candidateId: { sessionId: session.id, candidateId: candidate.id } },
      create: {
        sessionId: session.id,
        candidateId: candidate.id,
        accessStatus: activeAttempt ? "APPEARING" : "JOINED",
        joinedAt: now,
      },
      update: {
        accessStatus: activeAttempt ? "APPEARING" : "JOINED",
        joinedAt: existingSessionCand?.joinedAt || now,
      },
    });

    // Ensure ExamAssignment exists so candidate can take this exam
    await prisma.examAssignment.upsert({
      where: { examId_candidateId: { examId: session.examId, candidateId: candidate.id } },
      create: {
        examId: session.examId,
        candidateId: candidate.id,
        invitationCode: session.codeLastFour,
      },
      update: {},
    });

    // 8. Generate short-lived secure session access token
    const sessionAccessToken = signSessionAccessToken(candidate.id, session.id, session.examId);

    // Set auth cookie if candidate is not already logged in
    res.cookie(AUTH_COOKIE, signSession(candidate.user.id, candidate.user.role), sessionCookieOptions());
    res.cookie(SESSION_ACCESS_COOKIE, sessionAccessToken, sessionCookieOptions());

    // 9. Record session audit log
    await prisma.sessionAuditLog.create({
      data: {
        sessionId: session.id,
        candidateId: candidate.id,
        eventType: "ACCESS_GRANTED",
        metadata: {
          sessionName: session.sessionName,
          examTitle: session.exam.title,
          activeAttemptId: activeAttempt?.id ?? null,
        },
        ipAddress: clientIp(req),
      },
    });

    res.json({
      success: true,
      sessionAccessToken,
      sessionId: session.id,
      sessionName: session.sessionName,
      examId: session.exam.id,
      examTitle: session.exam.title,
      durationMinutes: session.exam.durationMinutes,
      activeAttemptId: activeAttempt?.id ?? null,
      sections: session.exam.sections.map((s) => ({
        id: s.id,
        title: s.title,
        timeLimitMinutes: s.timeLimitMinutes,
      })),
      candidate: {
        id: candidate.id,
        name: candidate.user.name,
        email: candidate.user.email,
      },
    });
  })
);

/**
 * GET /api/sessions/verify-status/:examId
 * Check if the candidate has an authorized session for this examination.
 */
sessionsRouter.get(
  "/verify-status/:examId",
  ah(async (req, res) => {
    const examId = req.params.examId;
    const now = new Date();

    // 1. If candidate is logged in and already has an active ongoing attempt, permit resume immediately
    if (req.user?.candidateId) {
      const activeAttempt = await prisma.attempt.findFirst({
        where: { examId, candidateId: req.user.candidateId, status: "IN_PROGRESS", deadlineAt: { gt: now } },
        select: { id: true, sessionId: true },
      });
      if (activeAttempt) {
        return res.json({
          verified: true,
          activeAttemptId: activeAttempt.id,
          sessionId: activeAttempt.sessionId,
          resumed: true,
        });
      }
    }

    // 2. Check session access token from cookie or header
    const token = (req.cookies[SESSION_ACCESS_COOKIE] as string) || (req.headers["x-session-token"] as string);
    if (!token) {
      return res.json({ verified: false, reason: "NO_TOKEN" });
    }

    const payload = verifySessionAccessToken(token);
    if (!payload || payload.examId !== examId) {
      return res.json({ verified: false, reason: "MISMATCHED_OR_EXPIRED" });
    }

    // Check candidate ID if logged in
    if (req.user?.candidateId && payload.candidateId !== req.user.candidateId) {
      return res.json({ verified: false, reason: "CANDIDATE_MISMATCH" });
    }

    // 3. Verify session in DB
    const session = await prisma.examSession.findUnique({
      where: { id: payload.sessionId },
      select: { id: true, sessionName: true, status: true, startsAt: true, endsAt: true },
    });

    if (!session) {
      return res.json({ verified: false, reason: "SESSION_NOT_FOUND" });
    }

    if (session.status === "REVOKED") {
      return res.json({ verified: false, status: "REVOKED", reason: "This examination session has been revoked by HR." });
    }
    if (session.status === "PAUSED") {
      return res.json({ verified: false, status: "PAUSED", reason: "Examination Currently Paused by HR." });
    }
    if (session.status === "COMPLETED" || session.status === "EXPIRED" || now > session.endsAt) {
      return res.json({ verified: false, status: "EXPIRED", reason: "This examination session has expired." });
    }
    if (now < session.startsAt) {
      return res.json({ verified: false, status: "SCHEDULED", reason: `Session access opens at ${session.startsAt.toLocaleString("en-IN")}.` });
    }

    res.json({
      verified: true,
      sessionId: session.id,
      sessionName: session.sessionName,
      activeAttemptId: null,
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// HR / STAFF SESSION MANAGEMENT ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

sessionsRouter.use(requireStaff);

/**
 * List all sessions with counts, status, and metrics.
 */
sessionsRouter.get(
  "/",
  ah(async (req, res) => {
    const { status, examId } = req.query;

    const where: any = {};
    if (status) where.status = String(status);
    if (examId) where.examId = String(examId);

    const sessions = await prisma.examSession.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        exam: { select: { id: true, title: true, durationMinutes: true, totalMarks: true } },
        createdBy: { select: { name: true } },
        _count: {
          select: {
            candidates: true,
            attempts: true,
          },
        },
        candidates: {
          select: { accessStatus: true },
        },
      },
    });

    // Calculate aggregated metrics
    const now = new Date();
    const formatted = sessions.map((s) => {
      // Auto-update expired status in response view
      let computedStatus: string = s.status;
      if (s.status === "SCHEDULED" && now >= s.startsAt && now <= s.endsAt) {
        computedStatus = "ACTIVE";
      } else if (s.status !== "REVOKED" && s.status !== "PAUSED" && now > s.endsAt) {
        computedStatus = "EXPIRED";
      }

      const joinedCount = s.candidates.filter((c) => c.accessStatus === "JOINED" || c.accessStatus === "APPEARING" || c.accessStatus === "COMPLETED").length;
      const appearingCount = s.candidates.filter((c) => c.accessStatus === "APPEARING").length;
      const completedCount = s.candidates.filter((c) => c.accessStatus === "COMPLETED").length;

      return {
        id: s.id,
        sessionName: s.sessionName,
        examId: s.examId,
        examTitle: s.exam.title,
        examDurationMinutes: s.exam.durationMinutes,
        codeLastFour: s.codeLastFour,
        codePrefix: s.codePrefix,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        maxCandidates: s.maxCandidates,
        maxAttempts: s.maxAttempts,
        status: computedStatus,
        createdByName: s.createdBy?.name || "System",
        createdAt: s.createdAt,
        totalInvited: s._count.candidates,
        joinedCount,
        appearingCount,
        completedCount,
      };
    });

    const metrics = {
      totalSessions: formatted.length,
      activeSessions: formatted.filter((s) => s.status === "ACTIVE").length,
      scheduledSessions: formatted.filter((s) => s.status === "SCHEDULED").length,
      expiredSessions: formatted.filter((s) => s.status === "EXPIRED").length,
      totalInvited: formatted.reduce((sum, s) => sum + s.totalInvited, 0),
      totalJoined: formatted.reduce((sum, s) => sum + s.joinedCount, 0),
      totalAppearing: formatted.reduce((sum, s) => sum + s.appearingCount, 0),
      totalCompleted: formatted.reduce((sum, s) => sum + s.completedCount, 0),
    };

    res.json({ sessions: formatted, metrics });
  })
);

/**
 * Get single session details with candidates list.
 */
sessionsRouter.get(
  "/:id",
  ah(async (req, res) => {
    const session = await prisma.examSession.findUnique({
      where: { id: req.params.id },
      include: {
        exam: true,
        createdBy: { select: { name: true } },
        candidates: {
          include: {
            candidate: {
              include: {
                user: { select: { name: true, email: true } },
              },
            },
          },
          orderBy: { invitedAt: "desc" },
        },
        auditLogs: {
          take: 20,
          orderBy: { eventTimestamp: "desc" },
        },
      },
    });

    if (!session) throw notFound("Session");

    res.json(session);
  })
);

/**
 * Create a new examination session with generated or custom session code.
 * Returns the plaintext session code ONCE in the response so HR can copy it.
 */
const createSessionSchema = z.object({
  sessionName: z.string().trim().min(2).max(120),
  examId: z.string(),
  customCode: z.string().trim().min(3).max(32).optional().nullable(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  maxCandidates: z.number().int().min(1).max(5000).default(100),
  maxAttempts: z.number().int().min(1).max(10).default(1),
  status: z.enum(["SCHEDULED", "ACTIVE", "PAUSED"]).default("SCHEDULED"),
  eligibility: z.record(z.unknown()).optional().nullable(),
});

sessionsRouter.post(
  "/",
  ah(async (req, res) => {
    const body = parse(createSessionSchema, req.body);

    if (body.endsAt <= body.startsAt) {
      throw badRequest("Session end time must be after start time");
    }

    const exam = await prisma.exam.findUnique({ where: { id: body.examId } });
    if (!exam) throw notFound("Examination");

    // Generate or use custom code
    let rawCode: string;
    if (body.customCode && body.customCode.trim().length >= 3) {
      rawCode = body.customCode.trim().toUpperCase();
    } else {
      rawCode = generateRandomSessionCode("ZG");
    }

    const normCode = normalizeSessionCode(rawCode);
    const codeHash = hashSessionCode(normCode);

    // Uniqueness validation
    const existing = await prisma.examSession.findUnique({
      where: { sessionCodeHash: codeHash },
    });
    if (existing) {
      throw badRequest(`Session code '${rawCode}' is already in use. Please specify a different code.`);
    }

    const lastFour = rawCode.slice(-4);
    const prefix = rawCode.length > 4 ? rawCode.slice(0, 4) : "";

    const session = await prisma.examSession.create({
      data: {
        sessionName: body.sessionName,
        examId: body.examId,
        sessionCodeHash: codeHash,
        codeLastFour: lastFour,
        codePrefix: prefix,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        maxCandidates: body.maxCandidates,
        maxAttempts: body.maxAttempts,
        status: body.status as SessionStatus,
        eligibility: (body.eligibility ?? undefined) as any,
        createdById: req.user!.id,
      },
    });

    await prisma.sessionAuditLog.create({
      data: {
        sessionId: session.id,
        eventType: "SESSION_CREATED",
        metadata: {
          sessionName: session.sessionName,
          codeLastFour: lastFour,
        },
        ipAddress: clientIp(req),
      },
    });

    await audit(req, "session.create", "ExamSession", session.id, {
      name: session.sessionName,
      examId: session.examId,
    });

    // Plaintext code is returned ONLY here
    res.status(201).json({
      session,
      generatedCode: rawCode,
    });
  })
);

/**
 * Regenerate session code for a session.
 * Replaces the hash with a newly generated or custom code.
 */
sessionsRouter.post(
  "/:id/regenerate-code",
  ah(async (req, res) => {
    const session = await prisma.examSession.findUnique({ where: { id: req.params.id } });
    if (!session) throw notFound("Session");

    const custom = req.body?.customCode ? String(req.body.customCode).trim() : null;
    const rawCode = custom && custom.length >= 3 ? custom.toUpperCase() : generateRandomSessionCode("ZG");

    const normCode = normalizeSessionCode(rawCode);
    const codeHash = hashSessionCode(normCode);

    const existing = await prisma.examSession.findUnique({ where: { sessionCodeHash: codeHash } });
    if (existing && existing.id !== session.id) {
      throw badRequest(`Session code '${rawCode}' is already in use.`);
    }

    const lastFour = rawCode.slice(-4);
    const prefix = rawCode.length > 4 ? rawCode.slice(0, 4) : "";

    await prisma.examSession.update({
      where: { id: session.id },
      data: {
        sessionCodeHash: codeHash,
        codeLastFour: lastFour,
        codePrefix: prefix,
      },
    });

    await prisma.sessionAuditLog.create({
      data: {
        sessionId: session.id,
        eventType: "CODE_REGENERATED",
        metadata: { newLastFour: lastFour },
        ipAddress: clientIp(req),
      },
    });

    await audit(req, "session.regenerate_code", "ExamSession", session.id);

    res.json({
      success: true,
      newCode: rawCode,
      codeLastFour: lastFour,
    });
  })
);

/**
 * Update session status (e.g. Pause, Resume, Revoke, Complete).
 */
sessionsRouter.post(
  "/:id/status",
  ah(async (req, res) => {
    const { status } = parse(
      z.object({ status: z.enum(["SCHEDULED", "ACTIVE", "PAUSED", "EXPIRED", "COMPLETED", "REVOKED"]) }),
      req.body
    );

    const session = await prisma.examSession.update({
      where: { id: req.params.id },
      data: { status: status as SessionStatus },
    });

    await prisma.sessionAuditLog.create({
      data: {
        sessionId: session.id,
        eventType: `STATUS_${status}`,
        metadata: { newStatus: status },
        ipAddress: clientIp(req),
      },
    });

    await audit(req, `session.status_${status.toLowerCase()}`, "ExamSession", session.id);

    res.json(session);
  })
);

/**
 * Add / assign candidates to session.
 */
sessionsRouter.post(
  "/:id/candidates",
  ah(async (req, res) => {
    const session = await prisma.examSession.findUnique({ where: { id: req.params.id } });
    if (!session) throw notFound("Session");

    const { candidateIds, emails } = parse(
      z.object({
        candidateIds: z.array(z.string()).default([]),
        emails: z.array(z.string().email()).default([]),
      }),
      req.body
    );

    const idsToAdd = new Set<string>(candidateIds);

    // Resolve emails to candidate profile IDs
    if (emails.length > 0) {
      const matched = await prisma.candidateProfile.findMany({
        where: { user: { email: { in: emails.map((e) => e.toLowerCase()) } } },
        select: { id: true },
      });
      matched.forEach((c) => idsToAdd.add(c.id));
    }

    let addedCount = 0;
    for (const cid of idsToAdd) {
      try {
        await prisma.sessionCandidate.upsert({
          where: { sessionId_candidateId: { sessionId: session.id, candidateId: cid } },
          create: { sessionId: session.id, candidateId: cid, accessStatus: "INVITED" },
          update: {},
        });
        // Also ensure ExamAssignment
        await prisma.examAssignment.upsert({
          where: { examId_candidateId: { examId: session.examId, candidateId: cid } },
          create: { examId: session.examId, candidateId: cid, invitationCode: session.codeLastFour },
          update: {},
        });
        addedCount++;
      } catch {
        // Skip duplicate
      }
    }

    await audit(req, "session.candidates_assigned", "ExamSession", session.id, { count: addedCount });

    res.json({ success: true, addedCount });
  })
);

/**
 * Remove a candidate from a session.
 */
sessionsRouter.delete(
  "/:id/candidates/:candidateId",
  ah(async (req, res) => {
    await prisma.sessionCandidate.deleteMany({
      where: { sessionId: req.params.id, candidateId: req.params.candidateId },
    });
    res.json({ ok: true });
  })
);


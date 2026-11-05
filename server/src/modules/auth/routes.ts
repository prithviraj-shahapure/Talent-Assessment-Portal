import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { prisma } from "../../lib/prisma";
import { ah, badRequest, conflict, parse, unauthorized } from "../../lib/http";
import { AUTH_COOKIE, CSRF_COOKIE, randomToken, sha256, signSession } from "../../lib/tokens";
import { csrfCookieOptions, sessionCookieOptions } from "../../lib/cookies";
import { requireAuth } from "../../middleware/auth";
import { resumeUpload, sniff } from "../../middleware/upload";
import { storage } from "../../lib/storage";
import { audit } from "../../lib/audit";
import { emailLayout, sendMail } from "../../lib/mailer";
import { env } from "../../config/env";
import { getSettings } from "../../lib/settings";
import { redeemInvitation } from "../../lib/invites";
import { firebaseWebConfig, verifyGoogleIdToken } from "../../lib/google";
import { firestore } from "../../lib/firestore";

export const authRouter = Router();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many attempts. Please wait a few minutes and try again." } });

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128)
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/[0-9]/, "Password must contain a number");

authRouter.get("/csrf", (req, res) => {
  let token = req.cookies?.[CSRF_COOKIE];
  if (!token) {
    token = randomToken(24);
    res.cookie(CSRF_COOKIE, token, csrfCookieOptions());
  }
  res.json({ token });
});

authRouter.post(
  "/login",
  authLimiter,
  ah(async (req, res) => {
    const body = parse(z.object({ email: z.string().email(), password: z.string().min(1).max(200) }), req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    const ok = user ? await bcrypt.compare(body.password, user.passwordHash) : await bcrypt.compare(body.password, "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
    if (!user || !ok) {
      await audit(req, "auth.login_failed", "User", user?.id, { email: body.email }, user?.id ?? null);
      throw unauthorized("Incorrect email or password");
    }
    if (!user.isActive) throw unauthorized("This account has been deactivated. Contact HR.");
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    res.cookie(AUTH_COOKIE, signSession(user.id, user.role), sessionCookieOptions());
    await audit(req, "auth.login", "User", user.id, undefined, user.id);
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, emailVerified: user.emailVerified } });
  }),
);

/** Which sign-in methods the web app should offer (Firebase web config is public, not secret). */
authRouter.get("/providers", (_req, res) => {
  res.json({ google: firebaseWebConfig() });
});

/**
 * Google sign-in (Firebase). Existing accounts are signed in (and linked on first use).
 * A new Google user is NOT created here: the app sends them to the registration form,
 * pre-filled from Google, to add the candidate details, consent and invitation code.
 */
authRouter.post(
  "/google",
  authLimiter,
  ah(async (req, res) => {
    const { idToken } = parse(z.object({ idToken: z.string().min(20).max(4096) }), req.body);
    const g = await verifyGoogleIdToken(idToken);
    let user = await prisma.user.findUnique({ where: { googleUid: g.uid } });
    if (!user) {
      user = await prisma.user.findUnique({ where: { email: g.email } });
      if (user?.googleUid && user.googleUid !== g.uid) {
        await audit(req, "auth.google_mismatch", "User", user.id, { email: g.email }, user.id);
        throw conflict("This account is linked to a different Google account. Sign in with your password.");
      }
    }
    if (!user) return res.json({ needsRegistration: true, email: g.email, name: g.name });
    if (user.role !== "CANDIDATE" && !env.googleStaffSignIn) throw unauthorized("Staff accounts must sign in with their password.");
    if (!user.isActive) throw unauthorized("This account has been deactivated. Contact HR.");
    const linking = !user.googleUid;
    const targetRole = g.roleClaim || user.role;
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        googleUid: g.uid,
        role: targetRole,
        emailVerified: true,
        lastLoginAt: new Date(),
      },
    });
    res.cookie(AUTH_COOKIE, signSession(user.id, user.role), sessionCookieOptions());
    await audit(req, linking ? "auth.google_linked" : "auth.login_google", "User", user.id, { email: g.email }, user.id);
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, emailVerified: user.emailVerified } });
  }),
);

authRouter.post(
  "/logout",
  ah(async (req, res) => {
    if (req.user) await audit(req, "auth.logout", "User", req.user.id);
    res.clearCookie(AUTH_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
    res.json({ ok: true });
  }),
);

authRouter.get(
  "/me",
  ah(async (req, res) => {
    if (!req.user) return res.json({ user: null });
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, email: true, role: true, emailVerified: true, candidate: { select: { id: true, stage: true, college: true, degree: true, branch: true, resumeName: true } } },
    });
    res.json({ user });
  }),
);

const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  password: passwordSchema.optional(),
  /** Firebase ID token when the candidate registers with Google instead of a password */
  googleIdToken: z.string().min(20).max(4096).optional(),
  mobile: z.string().trim().regex(/^[+]?[0-9 -]{10,15}$/, "Enter a valid mobile number"),
  college: z.string().trim().min(2).max(200),
  degree: z.string().trim().min(1).max(80),
  branch: z.string().trim().min(1).max(120),
  currentYear: z.string().trim().min(1).max(30),
  graduationYear: z.coerce.number().int().min(2000).max(2040),
  invitationCode: z.string().trim().max(40).optional().or(z.literal("")),
  consent: z.union([z.literal("true"), z.literal(true)]),
});

async function issueVerification(userId: string, email: string, name: string) {
  const token = randomToken();
  await prisma.emailToken.create({ data: { userId, tokenHash: sha256(token), type: "VERIFY_EMAIL", expiresAt: new Date(Date.now() + 48 * 3600 * 1000) } });
  const url = `${env.appUrl}/verify-email?token=${token}`;
  await sendMail(
    email,
    "Verify your email — Zanvar Group Talent Assessment",
    `Hello ${name},\n\nPlease verify your email address to activate your candidate account:\n${url}\n\nThis link expires in 48 hours.`,
    emailLayout("Verify your email address", `<p>Hello ${name},</p><p>Please verify your email address to activate your candidate account. This link expires in 48 hours.</p>`, "Verify email", url),
  );
  return url;
}

authRouter.post(
  "/register",
  authLimiter,
  resumeUpload.single("resume"),
  ah(async (req, res) => {
    const body = parse(registerSchema, req.body);
    const settings = await getSettings();
    // Registering with Google: the email comes from the verified Google account, and it counts as verified.
    const google = body.googleIdToken ? await verifyGoogleIdToken(body.googleIdToken) : null;
    if (!google && !body.password) throw badRequest("password: Choose a password");
    const email = google ? google.email : body.email.toLowerCase();
    if (await prisma.user.findUnique({ where: { email } })) throw conflict("An account with this email already exists. Sign in instead.");
    if (google && (await prisma.user.findUnique({ where: { googleUid: google.uid } }))) throw conflict("This Google account is already registered. Sign in instead.");

    if (body.invitationCode) {
      const inv = await prisma.invitation.findUnique({ where: { code: body.invitationCode.trim().toUpperCase() } });
      if (!inv) throw badRequest("Invitation code not recognised");
    }

    let resumeKey: string | undefined;
    let resumeName: string | undefined;
    if (req.file) {
      const kind = sniff(req.file.buffer);
      if (!kind || !["pdf", "doc", "docx"].includes(kind)) throw badRequest("Resume file content is not a valid PDF or Word document");
      resumeKey = await storage.put("resumes", req.file.buffer, kind);
      resumeName = req.file.originalname.slice(0, 150);
    }

    // Google-only accounts get an unusable random password; "Forgot password" can set a real one later.
    const passwordHash = await bcrypt.hash(body.password ?? randomToken(32), 12);
    const user = await prisma.user.create({
      data: {
        email,
        name: body.name,
        passwordHash,
        googleUid: google?.uid,
        emailVerified: !!google,
        role: "CANDIDATE",
        candidate: {
          create: {
            mobile: body.mobile,
            college: body.college,
            degree: body.degree,
            branch: body.branch,
            currentYear: body.currentYear,
            graduationYear: body.graduationYear,
            resumeKey,
            resumeName,
            pipeline: { create: { toStage: "REGISTERED", note: "Self-registration" } },
            consents: { create: { policyVersion: settings.privacyPolicyVersion, webcam: false, microphone: false, evidence: false, ipAddress: req.ip, userAgent: req.get("user-agent")?.slice(0, 300) } },
          },
        },
      },
      include: { candidate: true },
    });

    let inviteMessage: string | null = null;
    if (body.invitationCode) {
      try {
        const r = await redeemInvitation(user.candidate!.id, email, body.invitationCode);
        inviteMessage = `You have been registered for ${r.exam.title}.`;
      } catch (e) {
        inviteMessage = `Account created, but the invitation could not be applied: ${(e as Error).message}`;
      }
    }

    if (user.candidate) {
      await firestore.saveCandidate({
        candidateId: user.candidate.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        mobile: user.candidate.mobile,
        college: user.candidate.college,
        degree: user.candidate.degree,
        branch: user.candidate.branch,
        currentYear: user.candidate.currentYear,
        graduationYear: user.candidate.graduationYear,
        stage: user.candidate.stage,
        createdAt: user.candidate.createdAt.toISOString(),
        updatedAt: user.candidate.updatedAt.toISOString(),
      });
    }

    const verifyUrl = google ? null : await issueVerification(user.id, email, user.name);
    res.cookie(AUTH_COOKIE, signSession(user.id, user.role), sessionCookieOptions());
    await audit(req, "candidate.register", "User", user.id, { invitationCode: body.invitationCode || null, method: google ? "google" : "password" }, user.id);
    res.status(201).json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role, emailVerified: user.emailVerified },
      inviteMessage,
      ...(env.isProd || !verifyUrl ? {} : { devVerifyUrl: verifyUrl }),
    });
  }),
);

authRouter.post(
  "/verify-email",
  ah(async (req, res) => {
    const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.body);
    const rec = await prisma.emailToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!rec || rec.type !== "VERIFY_EMAIL" || rec.usedAt || rec.expiresAt < new Date()) throw badRequest("This verification link is invalid or has expired");
    await prisma.$transaction([
      prisma.user.update({ where: { id: rec.userId }, data: { emailVerified: true } }),
      prisma.emailToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
    ]);
    await audit(req, "auth.email_verified", "User", rec.userId, undefined, rec.userId);
    res.json({ ok: true });
  }),
);

authRouter.post(
  "/resend-verification",
  authLimiter,
  requireAuth,
  ah(async (req, res) => {
    if (req.user!.emailVerified) return res.json({ ok: true, alreadyVerified: true });
    const url = await issueVerification(req.user!.id, req.user!.email, req.user!.name);
    res.json({ ok: true, ...(env.isProd ? {} : { devVerifyUrl: url }) });
  }),
);

authRouter.post(
  "/forgot-password",
  authLimiter,
  ah(async (req, res) => {
    const { email } = parse(z.object({ email: z.string().email() }), req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    let devUrl: string | undefined;
    if (user && user.isActive) {
      const token = randomToken();
      await prisma.emailToken.create({ data: { userId: user.id, tokenHash: sha256(token), type: "RESET_PASSWORD", expiresAt: new Date(Date.now() + 3600 * 1000) } });
      devUrl = `${env.appUrl}/reset-password?token=${token}`;
      await sendMail(user.email, "Reset your password — Zanvar Group Talent Assessment", `Reset your password using this link (valid for 1 hour):\n${devUrl}`, emailLayout("Reset your password", "<p>Use the button below to choose a new password. The link is valid for one hour.</p>", "Reset password", devUrl));
      await audit(req, "auth.password_reset_requested", "User", user.id, undefined, user.id);
    }
    // Same response whether or not the account exists (prevents account enumeration)
    res.json({ ok: true, ...(env.isProd || !devUrl ? {} : { devResetUrl: devUrl }) });
  }),
);

authRouter.post(
  "/reset-password",
  authLimiter,
  ah(async (req, res) => {
    const body = parse(z.object({ token: z.string().min(10).max(200), password: passwordSchema }), req.body);
    const rec = await prisma.emailToken.findUnique({ where: { tokenHash: sha256(body.token) } });
    if (!rec || rec.type !== "RESET_PASSWORD" || rec.usedAt || rec.expiresAt < new Date()) throw badRequest("This reset link is invalid or has expired");
    await prisma.$transaction([
      prisma.user.update({ where: { id: rec.userId }, data: { passwordHash: await bcrypt.hash(body.password, 12) } }),
      prisma.emailToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
    ]);
    await audit(req, "auth.password_reset", "User", rec.userId, undefined, rec.userId);
    res.json({ ok: true });
  }),
);

authRouter.post(
  "/change-password",
  requireAuth,
  ah(async (req, res) => {
    const body = parse(z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }), req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) throw badRequest("Current password is incorrect");
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(body.newPassword, 12) } });
    await audit(req, "auth.password_changed", "User", user.id);
    res.json({ ok: true });
  }),
);

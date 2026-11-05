import { Router } from "express";
import { z } from "zod";
import { ah, parse } from "../../lib/http";
import { requireStaff, requireSuperAdmin } from "../../middleware/auth";
import { DEFAULT_RISK_RULES, getSettings, updateSettings } from "../../lib/settings";
import { audit } from "../../lib/audit";

export const settingsRouter = Router();

// Privacy notice and proctoring thresholds are needed by candidates too
settingsRouter.get(
  "/public",
  ah(async (_req, res) => {
    const s = await getSettings();
    res.json({
      organisationName: s.organisationName,
      privacyNotice: s.privacyNotice,
      privacyPolicyVersion: s.privacyPolicyVersion,
      evidenceRetentionDays: s.evidenceRetentionDays,
      verificationPhotoRetentionDays: s.verificationPhotoRetentionDays,
      faceMissingSeconds: s.faceMissingSeconds,
      lookingAwaySeconds: s.lookingAwaySeconds,
      audioThreshold: s.audioThreshold,
      livePreviewIntervalSec: s.livePreviewIntervalSec,
      allowSelfRegistrationWithoutInvite: s.allowSelfRegistrationWithoutInvite,
    });
  }),
);

settingsRouter.get("/", requireStaff, ah(async (_req, res) => res.json({ settings: await getSettings(), defaults: { riskRules: DEFAULT_RISK_RULES } })));

const ruleSchema = z.object({
  label: z.string().min(1).max(100),
  weight: z.number().int().min(0).max(100),
  cooldownSec: z.number().int().min(0).max(3600),
  maxContribution: z.number().int().min(0).max(100),
  graceCount: z.number().int().min(0).max(20),
  severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH"]),
});

settingsRouter.put(
  "/",
  requireSuperAdmin,
  ah(async (req, res) => {
    const body = parse(
      z
        .object({
          organisationName: z.string().min(2).max(100),
          riskRules: z.record(ruleSchema),
          riskThresholds: z.object({ low: z.number().int().min(1).max(99), medium: z.number().int().min(1).max(99), high: z.number().int().min(1).max(100) }).refine((t) => t.low < t.medium && t.medium < t.high, "Thresholds must increase: low < medium < high"),
          faceMissingSeconds: z.number().int().min(2).max(120),
          lookingAwaySeconds: z.number().int().min(2).max(120),
          audioThreshold: z.number().min(0.01).max(1),
          evidenceRetentionDays: z.number().int().min(1).max(3650),
          verificationPhotoRetentionDays: z.number().int().min(1).max(3650),
          privacyPolicyVersion: z.string().min(1).max(40),
          privacyNotice: z.string().min(50).max(10000),
          livePreviewIntervalSec: z.number().int().min(2).max(60),
          allowSelfRegistrationWithoutInvite: z.boolean(),
        })
        .partial(),
      req.body,
    );
    const s = await updateSettings(body);
    await audit(req, "settings.update", "SystemSetting", undefined, { keys: Object.keys(body) });
    res.json({ settings: s });
  }),
);

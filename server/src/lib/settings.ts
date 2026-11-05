import { prisma } from "./prisma";

export interface RiskRule {
  label: string;
  weight: number;
  /** Seconds after a counted event during which repeats of the same type add nothing (prevents inflation). */
  cooldownSec: number;
  /** Maximum points this event type can contribute to one attempt. */
  maxContribution: number;
  /** Number of initial occurrences tolerated before points apply ("repeated" behaviour). */
  graceCount: number;
  severity: "INFO" | "LOW" | "MEDIUM" | "HIGH";
}

export interface Settings {
  organisationName: string;
  riskRules: Record<string, RiskRule>;
  riskThresholds: { low: number; medium: number; high: number };
  faceMissingSeconds: number;
  lookingAwaySeconds: number;
  audioThreshold: number;
  evidenceRetentionDays: number;
  verificationPhotoRetentionDays: number;
  privacyPolicyVersion: string;
  privacyNotice: string;
  livePreviewIntervalSec: number;
  allowSelfRegistrationWithoutInvite: boolean;
}

export const DEFAULT_RISK_RULES: Record<string, RiskRule> = {
  FACE_MISSING: { label: "Face missing for prolonged period", weight: 10, cooldownSec: 30, maxContribution: 40, graceCount: 0, severity: "MEDIUM" },
  MULTIPLE_FACES: { label: "Multiple faces detected", weight: 25, cooldownSec: 60, maxContribution: 50, graceCount: 0, severity: "HIGH" },
  TAB_SWITCH: { label: "Repeated tab switching", weight: 10, cooldownSec: 10, maxContribution: 40, graceCount: 1, severity: "MEDIUM" },
  FULLSCREEN_EXIT: { label: "Fullscreen exit", weight: 10, cooldownSec: 15, maxContribution: 30, graceCount: 0, severity: "MEDIUM" },
  CAMERA_DISCONNECTED: { label: "Camera disconnected", weight: 15, cooldownSec: 60, maxContribution: 30, graceCount: 0, severity: "HIGH" },
  FOCUS_LOST: { label: "Repeated window focus loss", weight: 5, cooldownSec: 10, maxContribution: 25, graceCount: 1, severity: "LOW" },
  LOOKING_AWAY: { label: "Head turned away for prolonged period", weight: 5, cooldownSec: 30, maxContribution: 20, graceCount: 1, severity: "LOW" },
  MIC_DISCONNECTED: { label: "Microphone disconnected", weight: 5, cooldownSec: 60, maxContribution: 10, graceCount: 0, severity: "LOW" },
  AUDIO_ACTIVITY: { label: "Sustained audio activity", weight: 2, cooldownSec: 60, maxContribution: 10, graceCount: 2, severity: "INFO" },
  COPY: { label: "Copy attempt", weight: 3, cooldownSec: 10, maxContribution: 12, graceCount: 0, severity: "LOW" },
  PASTE: { label: "Paste attempt", weight: 5, cooldownSec: 10, maxContribution: 15, graceCount: 0, severity: "LOW" },
  CUT: { label: "Cut attempt", weight: 3, cooldownSec: 10, maxContribution: 9, graceCount: 0, severity: "LOW" },
  CONTEXT_MENU: { label: "Right-click / context menu", weight: 1, cooldownSec: 10, maxContribution: 5, graceCount: 1, severity: "INFO" },
  RESTRICTED_SHORTCUT: { label: "Restricted keyboard shortcut", weight: 2, cooldownSec: 10, maxContribution: 10, graceCount: 1, severity: "LOW" },
  CONNECTION_LOST: { label: "Connection lost", weight: 0, cooldownSec: 30, maxContribution: 0, graceCount: 0, severity: "INFO" },
  DEVTOOLS_SUSPECTED: { label: "Developer tools suspected", weight: 5, cooldownSec: 60, maxContribution: 10, graceCount: 0, severity: "LOW" },
};

export const DEFAULT_SETTINGS: Settings = {
  organisationName: "Zanvar Group",
  riskRules: DEFAULT_RISK_RULES,
  riskThresholds: { low: 20, medium: 40, high: 70 },
  faceMissingSeconds: 8,
  lookingAwaySeconds: 6,
  audioThreshold: 0.12,
  evidenceRetentionDays: 90,
  verificationPhotoRetentionDays: 180,
  privacyPolicyVersion: "2026-11-v1",
  privacyNotice:
    "Zanvar Group processes your personal data for the limited purpose of conducting this recruitment assessment, " +
    "in line with the Digital Personal Data Protection Act, 2023. During the examination your webcam is used to check that a face " +
    "is present and to detect additional faces; your microphone is used only to measure sound levels — no audio is recorded or uploaded. " +
    "Browser activity such as tab switches, fullscreen exits and copy/paste attempts is logged. A verification photo is captured at the start. " +
    "If the examination enables evidence capture and you consent to it, still snapshots may be saved when an event is flagged. " +
    "Flags are reviewed by a person — no candidate is disqualified automatically. Data is retained only for the periods stated and is " +
    "accessible only to authorised HR staff. You may request access, correction or erasure by contacting hr@zanvargroup.com. " +
    "If you cannot use a webcam or microphone, you may request an alternative arrangement before the examination.",
  livePreviewIntervalSec: 5,
  allowSelfRegistrationWithoutInvite: true,
};

let cache: { value: Settings; at: number } | null = null;

export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const rows = await prisma.systemSetting.findMany();
  const merged: Settings = structuredClone(DEFAULT_SETTINGS);
  for (const r of rows) {
    if (r.key === "riskRules") merged.riskRules = { ...DEFAULT_RISK_RULES, ...(r.value as unknown as Record<string, RiskRule>) };
    else (merged as unknown as Record<string, unknown>)[r.key] = r.value;
  }
  cache = { value: merged, at: Date.now() };
  return merged;
}

export async function updateSettings(patch: Partial<Settings>) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: value as object },
      update: { value: value as object },
    });
  }
  cache = null;
  return getSettings();
}

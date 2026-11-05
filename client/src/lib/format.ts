import type { PipelineStage, QuestionType } from "./types";

const dtf = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const df = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const tf = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const fmtDateTime = (d?: string | Date | null) => (d ? dtf.format(new Date(d)) : "—");
export const fmtDate = (d?: string | Date | null) => (d ? df.format(new Date(d)) : "—");
export const fmtTime = (d?: string | Date | null) => (d ? tf.format(new Date(d)) : "—");
export const fmtNum = (n?: number | null, digits = 1) => (n === null || n === undefined ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(digits));
export const fmtPct = (n?: number | null) => (n === null || n === undefined ? "—" : `${fmtNum(n)}%`);
export function fmtDuration(sec?: number | null) {
  if (sec === null || sec === undefined) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, "0")}s`;
}
export function clock(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${h ? String(h).padStart(2, "0") + ":" : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
export function relTime(d: string | Date) {
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return fmtDate(d);
}
export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  SINGLE: "Single correct",
  MULTIPLE: "Multiple correct",
  TRUE_FALSE: "True / False",
  SHORT: "Short answer",
  DESCRIPTIVE: "Descriptive",
  CODING: "Coding",
  NUMERICAL: "Numerical",
};
export const STAGE_LABEL: Record<PipelineStage, string> = {
  REGISTERED: "Registered",
  ELIGIBLE: "Eligible",
  EXAM_SCHEDULED: "Exam scheduled",
  EXAM_COMPLETED: "Exam completed",
  EVALUATION: "Evaluation",
  SHORTLISTED: "Shortlisted",
  INTERVIEW: "Interview",
  SELECTED: "Selected",
  REJECTED: "Rejected",
};
export const STAGES = Object.keys(STAGE_LABEL) as PipelineStage[];
export const EVENT_LABEL: Record<string, string> = {
  FACE_MISSING: "Face not visible",
  MULTIPLE_FACES: "Multiple faces",
  TAB_SWITCH: "Tab switched",
  FULLSCREEN_EXIT: "Exited fullscreen",
  CAMERA_DISCONNECTED: "Camera disconnected",
  FOCUS_LOST: "Window focus lost",
  LOOKING_AWAY: "Looking away",
  MIC_DISCONNECTED: "Microphone disconnected",
  AUDIO_ACTIVITY: "Sustained audio",
  COPY: "Copy attempt",
  PASTE: "Paste attempt",
  CUT: "Cut attempt",
  CONTEXT_MENU: "Right-click",
  RESTRICTED_SHORTCUT: "Restricted shortcut",
  CONNECTION_LOST: "Connection lost",
  DEVTOOLS_SUSPECTED: "Dev tools suspected",
  FACE_RETURNED: "Face visible again",
  CAMERA_RECONNECTED: "Camera reconnected",
  MIC_RECONNECTED: "Microphone reconnected",
  FULLSCREEN_ENTERED: "Fullscreen restored",
  FOCUS_RETURNED: "Focus returned",
  SESSION_RESUMED: "Session resumed",
  DETECTOR_UNAVAILABLE: "Face detector unavailable",
  PERMISSION_DENIED: "Permission denied",
};

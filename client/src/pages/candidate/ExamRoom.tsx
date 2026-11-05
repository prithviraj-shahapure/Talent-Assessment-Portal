import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, Bookmark, Camera, CameraOff, ChevronLeft, ChevronRight, CloudOff, Eye, Lock, Maximize, MessageSquare, Mic, MicOff, Pause, Save, Send, ShieldAlert, Wifi, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { Alert, Badge, Button, Checkbox, Dialog, Spinner } from "@/components/ui";
import { BrandMark } from "@/components/Brand";
import { clock, QUESTION_TYPE_LABEL } from "@/lib/format";
import type { QuestionType } from "@/lib/types";
import { acquireMedia, captureFrame, enterFullscreen, mediaStore, stopMedia } from "@/proctoring/media";
import { ProctorSession, type ProctorStatus, type Warning } from "@/proctoring/ProctorSession";
import { cn } from "@/lib/cn";
import CodingIDE from "@/components/coding/CodingIDE";
import PromptIDE from "@/components/prompt/PromptIDE";

interface Q {
  id: string;
  type: QuestionType;
  text: string;
  marks: number;
  negativeMarks: number;
  codeLanguage: string | null;
  codeStarter: string | null;
  promptMeta?: any;
  options: { id: string; text: string }[];
  answer: { selectedOptionIds: string[]; textAnswer: string | null; markedForReview: boolean } | null;
  hidden?: undefined;
}
interface HiddenQ { id: string; hidden: true; answered: boolean }
interface State {
  id: string;
  status: string;
  finished: boolean;
  isPaused?: boolean;
  pausedAt?: string | null;
  remainingSecondsAtPause?: number | null;
  sectionRemainingSecondsAtPause?: number | null;
  isTerminated?: boolean;
  terminatedReason?: string | null;
  submissionMethod?: string | null;
  tabSwitchViolations?: number;
  screenshotViolations?: number;
  autoSubmittedReason?: string | null;
  serverNow: string;
  verificationDone: boolean;
  deadlineAt: string;
  sectionDeadlineAt: string | null;
  currentSection: number;
  currentQuestion: number;
  exam: { id: string; title: string; proctoringEnabled: boolean; requireWebcam: boolean; requireMicrophone: boolean; requireFullscreen: boolean; evidenceCapture: boolean; livePreview: boolean; negativeMarking: boolean; sectionTimeLimits: boolean };
  sections: { index: number; title: string; timeLimitMinutes: number | null; passingMarks?: number; negativeMarks?: number; instructions?: string | null; status?: string; locked: boolean; questions: (Q | HiddenQ)[] }[];
}
interface Ans { selectedOptionIds: string[]; textAnswer: string | null; markedForReview: boolean }
interface PublicSettings { faceMissingSeconds: number; lookingAwaySeconds: number; audioThreshold: number; livePreviewIntervalSec: number }

const isAnswered = (a?: Ans) => !!a && (a.selectedOptionIds.length > 0 || !!a.textAnswer?.trim());
const LS = (id: string) => `zv_pending_${id}`;

export default function ExamRoom() {
  const { attemptId } = useParams();
  const nav = useNavigate();
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, Ans>>({});
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0); // index within the visible (current) section list
  const [sectionIdx, setSectionIdx] = useState(0);
  const [offset, setOffset] = useState(0); // serverNow - clientNow
  const [now, setNow] = useState(Date.now());
  const [gate, setGate] = useState<null | "media" | "fullscreen">(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const [status, setStatus] = useState<ProctorStatus | null>(null);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [proctorMsg, setProctorMsg] = useState<{ text: string; at: string } | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "pending" | "offline">("saved");
  const [submitOpen, setSubmitOpen] = useState(false);
  const [sectionOpen, setSectionOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tabSwitchViolations, setTabSwitchViolations] = useState(0);
  const [screenshotViolations, setScreenshotViolations] = useState(0);
  const [violationModal, setViolationModal] = useState<string | null>(null);
  const dirty = useRef<Map<string, Ans & { questionId: string }>>(new Map());
  const videoRef = useRef<HTMLVideoElement>(null);
  const session = useRef<ProctorSession | null>(null);
  const settings = useRef<PublicSettings | null>(null);
  const finishing = useRef(false);

  // ───── Load state ─────
  const load = useCallback(async () => {
    try {
      const s = await api<State>(`/attempts/${attemptId}/state`);
      if (s.isTerminated || s.status === "TERMINATED") {
        cleanup();
        setState(s);
        return s;
      }
      if (s.finished && !s.isPaused) {
        cleanup();
        nav(`/candidate/submitted/${attemptId}`, { replace: true });
        return null;
      }
      setOffset(new Date(s.serverNow).getTime() - Date.now());
      setState(s);
      if (typeof s.tabSwitchViolations === "number") setTabSwitchViolations(s.tabSwitchViolations);
      if (typeof s.screenshotViolations === "number") setScreenshotViolations(s.screenshotViolations);
      setSectionIdx(s.currentSection);
      const a: Record<string, Ans> = {};
      s.sections.forEach((sec) => sec.questions.forEach((q) => !q.hidden && q.answer && (a[q.id] = q.answer)));
      // restore answers that were changed offline and not yet saved
      try {
        const pending = JSON.parse(localStorage.getItem(LS(attemptId!)) ?? "{}") as Record<string, Ans & { questionId: string }>;
        Object.values(pending).forEach((p) => {
          a[p.questionId] = { selectedOptionIds: p.selectedOptionIds, textAnswer: p.textAnswer, markedForReview: p.markedForReview };
          dirty.current.set(p.questionId, p);
        });
      } catch {
        /* ignore */
      }
      setAnswers((prev) => ({ ...a, ...Object.fromEntries(Object.entries(prev).filter(([k]) => dirty.current.has(k))) }));
      return s;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, [attemptId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false; // guards against React StrictMode double-mount starting two sessions
    load().then(async (s) => {
      if (!s || cancelled) return;
      settings.current = await api<PublicSettings>("/settings/public");
      if (cancelled) return;
      const needMedia = s.exam.requireWebcam || s.exam.requireMicrophone;
      const haveMedia = !!mediaStore.stream && mediaStore.stream.getTracks().every((t) => t.readyState === "live");
      // Fresh start straight from the lobby: no "resume" gate, even if fullscreen could not be entered
      // (the fullscreen overlay and a FULLSCREEN_EXIT event handle that case).
      const fresh = mediaStore.justStarted === s.id;
      mediaStore.justStarted = null;
      if (needMedia && !haveMedia) setGate("media");
      else if (!fresh && s.exam.requireFullscreen && !document.fullscreenElement) setGate("fullscreen");
      else startProctoring(s, false);
    });
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => {
      cancelled = true;
      clearInterval(t);
      cleanup();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function cleanup() {
    session.current?.stop();
    session.current = null;
  }

  async function startProctoring(s: State, resumed: boolean) {
    if (session.current || !s.exam.proctoringEnabled) return;
    const video = videoRef.current!;
    if (mediaStore.stream && s.exam.requireWebcam) {
      video.srcObject = mediaStore.stream;
      await video.play().catch(() => undefined);
    }
    // a resumed session without a verification photo (e.g. upload failed) captures one now
    if (s.exam.requireWebcam && !s.verificationDone) {
      setTimeout(async () => {
        const b = await captureFrame(video, 640, 0.85);
        if (b) {
          const fd = new FormData();
          fd.append("kind", "VERIFICATION_PHOTO");
          fd.append("image", b, "verification.jpg");
          await api(`/attempts/${s.id}/evidence`, { form: fd }).catch(() => undefined);
        }
      }, 1500);
    }
    const ps = settings.current ?? { faceMissingSeconds: 8, lookingAwaySeconds: 6, audioThreshold: 0.12, livePreviewIntervalSec: 5 };
    const sess = new ProctorSession(video, mediaStore.stream, getSocket(), {
      attemptId: s.id,
      requireWebcam: s.exam.requireWebcam,
      requireMicrophone: s.exam.requireMicrophone,
      requireFullscreen: s.exam.requireFullscreen,
      evidenceCapture: s.exam.evidenceCapture,
      initialTabSwitchCount: s.tabSwitchViolations ?? tabSwitchViolations,
      initialScreenshotCount: s.screenshotViolations ?? screenshotViolations,
      ...ps,
    });
    sess.onStatus = setStatus;
    sess.onViolationUpdate = (v) => {
      setTabSwitchViolations(v.tabSwitch);
      setScreenshotViolations(v.screenshot);
    };
    sess.onAutoSubmit = async (_reason) => {
      setViolationModal("Maximum violation limit reached. Your examination has been automatically submitted.");
      await flush();
      try {
        await api(`/attempts/${attemptId}/submit`, { body: { reason: "AUTO_SUBMITTED_VIOLATION" } });
      } catch {
        /* backend auto-submits */
      }
      setTimeout(() => {
        finish();
      }, 1500);
    };
    sess.onWarning = (w, key) =>
      setWarnings((list) => {
        const k = w?.key ?? key;
        const rest = list.filter((x) => x.key !== k);
        return w ? [...rest, w] : rest;
      });
    session.current = sess;
    await sess.start();
    if (resumed) sess.log("SESSION_RESUMED", "Candidate resumed the examination after a reload or disconnection");
  }

  // ───── Autosave ─────
  const flush = useCallback(async () => {
    if (!dirty.current.size || !attemptId) return;
    const batch = [...dirty.current.values()];
    setSaveState("saving");
    try {
      const r = await api<{ saved: string[]; rejected: { questionId: string }[] }>(`/attempts/${attemptId}/answers`, { method: "PUT", body: { answers: batch } });
      for (const b of batch) {
        const cur = dirty.current.get(b.questionId);
        if (cur === b) dirty.current.delete(b.questionId); // only clear if unchanged since
      }
      r.rejected.forEach((x) => dirty.current.delete(x.questionId));
      localStorage.setItem(LS(attemptId), JSON.stringify(Object.fromEntries(dirty.current)));
      setSaveState(dirty.current.size ? "pending" : "saved");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        dirty.current.clear();
        localStorage.removeItem(LS(attemptId));
        return finish();
      }
      setSaveState(navigator.onLine ? "pending" : "offline");
    }
  }, [attemptId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ───── Socket: proctor messages & session control ─────
  useEffect(() => {
    const s = getSocket();
    const onMsg = (m: { text: string; at: string }) => setProctorMsg(m);
    const onEnded = () => finish();
    const onPaused = () => {
      flush();
      load();
    };
    const onResumed = () => {
      load();
    };
    const onTerminated = () => {
      cleanup();
      load();
    };
    const onForceSubmitted = () => finish();

    s.on("proctor:message", onMsg);
    s.on("attempt:ended", onEnded);
    s.on("attempt:paused", onPaused);
    s.on("session:paused", onPaused);
    s.on("attempt:resumed", onResumed);
    s.on("session:resumed", onResumed);
    s.on("attempt:terminated", onTerminated);
    s.on("session:terminated", onTerminated);
    s.on("attempt:force-submitted", onForceSubmitted);

    return () => {
      s.off("proctor:message", onMsg);
      s.off("attempt:ended", onEnded);
      s.off("attempt:paused", onPaused);
      s.off("session:paused", onPaused);
      s.off("attempt:resumed", onResumed);
      s.off("session:resumed", onResumed);
      s.off("attempt:terminated", onTerminated);
      s.off("session:terminated", onTerminated);
      s.off("attempt:force-submitted", onForceSubmitted);
    };
  }, [load, flush]); // eslint-disable-line react-hooks/exhaustive-deps

  // ───── Autosave timer (with random jitter to prevent thundering herd across 300+ candidates) ─────
  useEffect(() => {
    let timer: number;
    let active = true;

    const scheduleNext = () => {
      if (!active) return;
      // 5000ms base + 0 to 2500ms random jitter spreads requests evenly
      const delay = 5000 + Math.floor(Math.random() * 2500);
      timer = window.setTimeout(async () => {
        await flush();
        scheduleNext();
      }, delay);
    };

    scheduleNext();
    const online = () => flush();
    window.addEventListener("online", online);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (finishing.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener("online", online);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [flush]);

  const debounce = useRef<number>();
  const isPaused = !!(state?.isPaused || state?.status === "PAUSED");

  const update = (qid: string, patch: Partial<Ans>) => {
    if (isPaused) return;
    setAnswers((prev) => {
      const cur = prev[qid] ?? { selectedOptionIds: [], textAnswer: null, markedForReview: false };
      const next = { ...cur, ...patch };
      const rec = { ...next, questionId: qid };
      dirty.current.set(qid, rec);
      try {
        localStorage.setItem(LS(attemptId!), JSON.stringify(Object.fromEntries(dirty.current)));
      } catch {
        /* storage full or blocked */
      }
      return { ...prev, [qid]: next };
    });
    setSaveState("pending");
    clearTimeout(debounce.current);
    debounce.current = window.setTimeout(flush, 900);
  };

  // ───── Derived ─────
  const section = state?.sections[sectionIdx];
  const visible = useMemo(() => (section?.questions.filter((q) => !q.hidden) as Q[]) ?? [], [section]);
  const q = visible[cursor];
  const globalIndex = useMemo(() => {
    if (!state) return 0;
    let n = 0;
    for (let i = 0; i < sectionIdx; i++) n += state.sections[i].questions.length;
    return n + cursor;
  }, [state, sectionIdx, cursor]);
  const serverNow = now + offset;
  const remaining = state
    ? isPaused && state.remainingSecondsAtPause != null
      ? state.remainingSecondsAtPause * 1000
      : Math.max(0, new Date(state.deadlineAt).getTime() - serverNow)
    : 0;
  const sectionRemaining = state?.sectionDeadlineAt
    ? isPaused && state.sectionRemainingSecondsAtPause != null
      ? state.sectionRemainingSecondsAtPause * 1000
      : Math.max(0, new Date(state.sectionDeadlineAt).getTime() - serverNow)
    : null;
  const total = state?.sections.reduce((n, s) => n + s.questions.length, 0) ?? 0;
  const answeredCount = state ? state.sections.flatMap((s) => s.questions).filter((x) => (x.hidden ? x.answered : isAnswered(answers[x.id]))).length : 0;
  const markedCount = Object.values(answers).filter((a) => a.markedForReview).length;
  const isLastSection = state ? sectionIdx >= state.sections.length - 1 : true;

  // Auto-poll state when paused to recover seamlessly as soon as admin resumes
  useEffect(() => {
    if (!isPaused) return;
    const interval = setInterval(() => {
      load();
    }, 4000);
    return () => clearInterval(interval);
  }, [isPaused, load]);

  useEffect(() => {
    if (q) {
      setVisited((v) => new Set(v).add(q.id));
      session.current?.setQuestion(globalIndex);
      api(`/attempts/${attemptId}/position`, { body: { currentQuestion: globalIndex } }).catch(() => undefined);
    }
  }, [q?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ───── Timers ─────
  useEffect(() => {
    if (!state || finishing.current || gate || isPaused) return;
    if (remaining <= 0) submit(true);
    else if (sectionRemaining !== null && sectionRemaining <= 0 && !isLastSection) {
      flush().then(() => load().then(() => setCursor(0)));
    } else if (sectionRemaining !== null && sectionRemaining <= 0 && isLastSection) submit(true);
  }, [remaining <= 0, sectionRemaining !== null && sectionRemaining <= 0, isPaused]); // eslint-disable-line react-hooks/exhaustive-deps

  async function finish() {
    if (finishing.current) return;
    finishing.current = true;
    await session.current?.stop();
    session.current = null;
    stopMedia(mediaStore.stream);
    mediaStore.stream = null;
    mediaStore.verificationPhoto = null;
    localStorage.removeItem(LS(attemptId!));
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    nav(`/candidate/submitted/${attemptId}`, { replace: true });
  }

  async function submit(timeUp = false) {
    if (submitting) return;
    setSubmitting(true);
    await flush();
    try {
      await api(`/attempts/${attemptId}/submit`, { body: { reason: timeUp ? "TIME_UP" : "CANDIDATE" } });
    } catch {
      /* the server-side sweeper will auto-submit if this request fails */
    }
    await finish();
  }

  // ───── Gate (resume after reload / lost devices) ─────
  const openGate = async () => {
    setGateError(null);
    try {
      if (!state) return;
      if (gate === "media") {
        stopMedia(mediaStore.stream);
        mediaStore.stream = await acquireMedia(state.exam.requireWebcam, state.exam.requireMicrophone);
      }
      if (state.exam.requireFullscreen && !document.fullscreenElement) await enterFullscreen();
      setGate(null);
      await startProctoring(state, true);
    } catch (e) {
      setGateError((e as Error).message);
    }
  };

  if (error)
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
        <Alert tone="bad" title="This examination could not be loaded">{error}<div className="mt-3"><Button size="sm" variant="secondary" onClick={() => nav("/candidate")}>Back to my examinations</Button></div></Alert>
      </div>
    );

  if (state?.isTerminated || state?.status === "TERMINATED") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-sand-100 p-6">
        <div className="w-full max-w-lg rounded-xl border border-bad-300 bg-white p-8 text-center shadow-lg">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-bad-100 text-bad-600">
            <ShieldAlert className="h-9 w-9" />
          </div>
          <h1 className="mt-5 text-2xl font-bold text-navy-950">Examination Terminated</h1>
          <p className="mt-2 text-sm text-ink-600">
            Your examination attempt has been officially terminated by the administrator.
          </p>

          <div className="mt-6 rounded-lg border border-line bg-canvas p-4 text-left">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Termination Reason</div>
            <div className="mt-1 text-sm font-medium text-ink-900">
              {state.terminatedReason || "Administrative decision / Proctoring policy violation"}
            </div>
            {state.exam?.title && (
              <div className="mt-2 text-xs text-ink-500">
                Examination: <span className="font-medium text-ink-700">{state.exam.title}</span>
              </div>
            )}
          </div>

          <div className="mt-6">
            <Button size="lg" className="w-full" onClick={() => nav("/candidate")}>
              Return to Candidate Portal
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!state || !section) return <Spinner className="min-h-screen" label="Loading your examination…" />;

  const fullscreenLost = state.exam.requireFullscreen && status && !status.fullscreen && !gate;
  const cameraLost = state.exam.requireWebcam && status?.camera === "OFF";
  const ans = q ? answers[q.id] : undefined;

  return (
    <div className="flex h-screen flex-col bg-canvas select-none" onCopy={(e) => e.preventDefault()}>
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-white/10 bg-navy-900 px-4 text-white">
        <div className="flex min-w-0 items-center gap-3">
          <BrandMark className="h-7 w-7" />
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-semibold">{state.exam.title}</div>
            <div className="truncate text-[11.5px] text-white/55">{section.title}{state.exam.sectionTimeLimits && ` · section ${sectionIdx + 1} of ${state.sections.length}`}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[12px]">
          <span className={cn("hidden items-center gap-1.5 sm:flex", saveState === "offline" ? "text-signal-500" : "text-white/70")}>
            {saveState === "offline" ? <CloudOff className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
            {saveState === "saved" ? "All answers saved" : saveState === "saving" ? "Saving…" : saveState === "offline" ? "Offline — answers kept on this device" : "Saving shortly…"}
          </span>
          <Button size="sm" variant="signal" onClick={() => { setAck(false); setSubmitOpen(true); }}>
            <Send className="h-3.5 w-3.5" /> Submit
          </Button>
        </div>
      </header>

      {/* STAGE PROGRESSION STEPPER BANNER */}
      {state && (
        <div className="shrink-0 bg-sand-100/90 border-b border-line px-4 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3 max-w-7xl mx-auto">
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
              <span className="text-[11px] font-semibold text-ink-500 uppercase tracking-wider mr-1 hidden sm:inline">
                Examination Stages:
              </span>
              {state.sections.map((s, si) => {
                const isCurrent = si === state.currentSection;
                const isPassed = si < state.currentSection || s.status === "COMPLETED" || s.status === "EXPIRED";
                const isFuture = si > state.currentSection;

                return (
                  <div key={s.index} className="flex items-center gap-1.5">
                    <div
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-all shadow-xs",
                        isCurrent
                          ? "bg-navy-900 text-white font-semibold ring-2 ring-navy-900/30"
                          : isPassed
                          ? "bg-emerald-100/80 text-emerald-900 border border-emerald-300"
                          : "bg-white text-ink-400 border border-line"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-mono",
                          isCurrent
                            ? "bg-white text-navy-900 font-bold"
                            : isPassed
                            ? "bg-emerald-700 text-white"
                            : "bg-sand-200 text-ink-500"
                        )}
                      >
                        {isPassed ? "✓" : si + 1}
                      </span>
                      <span>{s.title}</span>
                      {isPassed && <span className="text-[10px] text-emerald-800 font-normal ml-0.5">Locked</span>}
                      {isFuture && <span className="text-[10px] text-ink-400 ml-0.5">Locked</span>}
                      {isCurrent && s.timeLimitMinutes && (
                        <span className="text-[10px] bg-white/20 px-1 rounded ml-1 font-mono">
                          {s.timeLimitMinutes}m
                        </span>
                      )}
                    </div>
                    {si < state.sections.length - 1 && <span className="text-ink-400 text-xs font-bold">→</span>}
                  </div>
                );
              })}
              <span className="text-ink-400 text-xs font-bold">→</span>
              <span className="px-2 py-1 rounded bg-sand-200 text-ink-600 text-[11px] font-semibold">
                Completed
              </span>
            </div>

            {section?.instructions && (
              <div className="hidden lg:block text-[11.5px] text-ink-600 italic truncate max-w-sm">
                "{section.instructions}"
              </div>
            )}
          </div>
        </div>
      )}

      {(warnings.length > 0 || proctorMsg) && (
        <div className="shrink-0 space-y-px">
          {proctorMsg && (
            <div className="flex items-center gap-2 bg-steel-600 px-4 py-2 text-[13px] text-white">
              <MessageSquare className="h-4 w-4" /> <b>Message from proctor:</b> {proctorMsg.text}
              <button className="ml-auto opacity-70 hover:opacity-100" onClick={() => setProctorMsg(null)} aria-label="Dismiss"><X className="h-4 w-4" /></button>
            </div>
          )}
          {warnings.map((w) => (
            <div key={w.key} className={cn("flex items-center gap-2 px-4 py-2 text-[13px]", w.tone === "bad" ? "bg-bad-600 text-white" : "bg-signal-100 text-[#7a4f0e]")}>
              <AlertTriangle className="h-4 w-4 shrink-0" /> {w.text}
              <button className="ml-auto opacity-70 hover:opacity-100" onClick={() => setWarnings((l) => l.filter((x) => x.key !== w.key))} aria-label="Dismiss"><X className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* LEFT: navigation */}
        <aside className="hidden w-[248px] shrink-0 flex-col border-r border-line bg-white md:flex">
          <div className="border-b border-line px-4 py-3">
            <div className="label-caps">Questions</div>
            <div className="num mt-1 text-[13px]">{answeredCount} of {total} answered</div>
            <div className="mt-2 h-1.5 rounded-sm bg-canvas"><div className="h-1.5 rounded-sm bg-navy-700" style={{ width: `${(answeredCount / Math.max(1, total)) * 100}%` }} /></div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 scrollbar-thin">
            {state.sections.map((s, si) => (
              <div key={s.index} className="mb-4">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-700">
                  {s.locked && <Lock className="h-3 w-3 text-ink-400" />}
                  {s.title}
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {s.questions.map((qq, qi) => {
                    let n = 0;
                    for (let i = 0; i < si; i++) n += state.sections[i].questions.length;
                    const a = qq.hidden ? undefined : answers[qq.id];
                    const answered = qq.hidden ? qq.answered : isAnswered(a);
                    const current = si === sectionIdx && qi === cursor;
                    return (
                      <button
                        key={qq.id}
                        disabled={!!qq.hidden}
                        onClick={() => { setSectionIdx(si); setCursor(qi); }}
                        className={cn(
                          "relative h-8 rounded text-[12px] font-medium num transition-colors disabled:cursor-not-allowed",
                          answered ? "bg-navy-800 text-white" : visited.has(qq.id) ? "border border-bad-600/40 bg-bad-50 text-bad-600" : "border border-line bg-white text-ink-700 hover:border-navy-500/40",
                          a?.markedForReview && "!bg-signal-500 !text-navy-950 !border-signal-500",
                          qq.hidden && "opacity-40",
                          current && "ring-2 ring-steel-500 ring-offset-1",
                        )}
                        aria-label={`Question ${n + qi + 1}`}
                      >
                        {n + qi + 1}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 border-t border-line px-4 py-3 text-[11px] text-ink-700">
            <Legend cls="bg-navy-800" label="Answered" />
            <Legend cls="bg-signal-500" label="Marked for review" />
            <Legend cls="border border-bad-600/40 bg-bad-50" label="Not answered" />
            <Legend cls="border border-line bg-white" label="Not visited" />
          </div>
        </aside>

        {/* CENTER: question */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {q ? (
              <div className={cn("mx-auto px-5 py-6 sm:px-8", q.type === "CODING" || q.type === "PROMPT" ? "max-w-6xl" : "max-w-3xl")}>
                <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-ink-500">
                  <span className="num rounded bg-navy-900 px-2 py-0.5 text-[12px] font-semibold text-white">Question {globalIndex + 1}</span>
                  <span>{QUESTION_TYPE_LABEL[q.type]}</span>·
                  <span className="num">{q.marks} mark{q.marks === 1 ? "" : "s"}</span>
                  {q.negativeMarks > 0 && <Badge tone="bad">−{q.negativeMarks} if wrong</Badge>}
                  {ans?.markedForReview && <Badge tone="signal">Marked for review</Badge>}
                </div>
                <div className="prose-q text-[15.5px] leading-relaxed text-ink-900">{q.text}</div>
                <div className="mt-6">
                  <AnswerInput q={q} a={ans} attemptId={attemptId} onChange={(p) => update(q.id, p)} />
                </div>
              </div>
            ) : (
              <div className="p-10 text-center text-ink-500">No questions in this section.</div>
            )}
          </div>
          {/* BOTTOM: actions */}
          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line bg-white px-4 py-3">
            <div className="flex gap-2">
              <Button variant="secondary" disabled={cursor === 0} onClick={() => setCursor((c) => c - 1)}>
                <ChevronLeft className="h-4 w-4" /> Previous
              </Button>
              <Button variant="outline" disabled={!q} onClick={() => { if (!q) return; update(q.id, { markedForReview: !ans?.markedForReview }); if (!ans?.markedForReview && cursor < visible.length - 1) setCursor((c) => c + 1); }}>
                <Bookmark className="h-4 w-4" /> {ans?.markedForReview ? "Unmark review" : "Mark for review"}
              </Button>
              {q && isAnswered(ans) && (
                <Button variant="ghost" onClick={() => update(q.id, { selectedOptionIds: [], textAnswer: null })}>Clear</Button>
              )}
            </div>
            <div className="flex gap-2">
              {cursor < visible.length - 1 ? (
                <Button onClick={() => { flush(); setCursor((c) => c + 1); }}>
                  Save & Next <ChevronRight className="h-4 w-4" />
                </Button>
              ) : state.exam.sectionTimeLimits && !isLastSection ? (
                <Button onClick={() => setSectionOpen(true)}>Finish section <ChevronRight className="h-4 w-4" /></Button>
              ) : !state.exam.sectionTimeLimits && sectionIdx < state.sections.length - 1 ? (
                <Button onClick={() => { flush(); setSectionIdx((s) => s + 1); setCursor(0); }}>
                  Next section <ChevronRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button variant="signal" onClick={() => { flush(); setAck(false); setSubmitOpen(true); }}>
                  <Send className="h-4 w-4" /> Submit examination
                </Button>
              )}
            </div>
          </footer>
        </main>

        {/* RIGHT: timer, camera, indicators */}
        <aside className="hidden w-[272px] shrink-0 flex-col gap-3 border-l border-line bg-white p-3 lg:flex">
          <div className={cn("rounded border px-3 py-3 text-center", remaining < 5 * 60_000 ? "border-bad-100 bg-bad-50" : "border-line bg-canvas/60")}>
            <div className="label-caps">Time remaining</div>
            <div className={cn("num mt-1 text-[30px] font-medium leading-none", remaining < 5 * 60_000 ? "text-bad-600" : "text-ink-900")}>{clock(remaining)}</div>
            {sectionRemaining !== null && <div className="num mt-1.5 text-[12px] text-ink-500">Section: {clock(sectionRemaining)}</div>}
          </div>

          {/* LIVE VIOLATION COUNTER */}
          <div className="rounded border border-line bg-canvas/60 p-3 text-xs space-y-2">
            <div className="flex items-center justify-between border-b border-line pb-1.5">
              <span className="font-bold uppercase tracking-wider text-[11px] text-navy-950 flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5 text-navy-800" />
                VIOLATION STATUS
              </span>
              <span className="text-[10px] text-ink-500 font-medium">Limit: 2</span>
            </div>

            <div className="space-y-1.5 pt-0.5">
              {/* Tab Switching */}
              <div className="flex items-center justify-between">
                <span className="text-ink-700 font-medium flex items-center gap-1.5">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      tabSwitchViolations === 0 ? "bg-ok-600" : tabSwitchViolations === 1 ? "bg-amber-500 animate-pulse" : "bg-bad-600"
                    )}
                  />
                  Tab Switching
                </span>
                <span
                  className={cn(
                    "num font-mono px-1.5 py-0.5 rounded text-[11.5px] font-bold border",
                    tabSwitchViolations === 0 && "bg-ok-50 text-ok-700 border-ok-200",
                    tabSwitchViolations === 1 && "bg-amber-100 text-amber-800 border-amber-300 font-extrabold",
                    tabSwitchViolations >= 2 && "bg-bad-100 text-bad-700 border-bad-300 font-extrabold"
                  )}
                >
                  {tabSwitchViolations}/2
                </span>
              </div>

              {/* Screenshot Attempts */}
              <div className="flex items-center justify-between">
                <span className="text-ink-700 font-medium flex items-center gap-1.5">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      screenshotViolations === 0 ? "bg-ok-600" : screenshotViolations === 1 ? "bg-amber-500 animate-pulse" : "bg-bad-600"
                    )}
                  />
                  Screenshot Attempts
                </span>
                <span
                  className={cn(
                    "num font-mono px-1.5 py-0.5 rounded text-[11.5px] font-bold border",
                    screenshotViolations === 0 && "bg-ok-50 text-ok-700 border-ok-200",
                    screenshotViolations === 1 && "bg-amber-100 text-amber-800 border-amber-300 font-extrabold",
                    screenshotViolations >= 2 && "bg-bad-100 text-bad-700 border-bad-300 font-extrabold"
                  )}
                >
                  {screenshotViolations}/2
                </span>
              </div>
            </div>

            <div className="text-[10px] text-ink-500 leading-tight pt-1 border-t border-line">
              {tabSwitchViolations >= 2 || screenshotViolations >= 2 ? (
                <span className="text-bad-600 font-semibold">Violation limit reached. Examination submitted.</span>
              ) : tabSwitchViolations === 1 || screenshotViolations === 1 ? (
                <span className="text-amber-700 font-semibold">Warning: 1 more violation will auto-submit exam.</span>
              ) : (
                <span>2 violations in any category will automatically submit exam.</span>
              )}
            </div>
          </div>

          <div className="relative aspect-[4/3] overflow-hidden rounded bg-navy-950">
            <video ref={videoRef} muted playsInline className={cn("h-full w-full -scale-x-100 object-cover", !state.exam.requireWebcam && "hidden")} />
            {!state.exam.requireWebcam && <div className="flex h-full items-center justify-center text-[12px] text-white/40">Camera not required</div>}
            {state.exam.requireWebcam && status?.faceCount !== null && status?.faceCount !== undefined && status.faceCount !== 1 && (
              <div className="absolute inset-x-0 bottom-0 bg-bad-600/90 px-2 py-1 text-center text-[11.5px] font-medium text-white">{status.faceCount === 0 ? "Face not visible" : "Multiple faces"}</div>
            )}
          </div>
          <ul className="space-y-1.5 text-[12.5px]">
            {state.exam.requireWebcam && <Ind ok={status?.camera === "ON"} on={<Camera className="h-3.5 w-3.5" />} off={<CameraOff className="h-3.5 w-3.5" />} label="Camera" />}
            {state.exam.requireMicrophone && (
              <li className="flex items-center gap-2">
                <span className={status?.microphone === "ON" ? "text-ok-600" : "text-bad-600"}>{status?.microphone === "ON" ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}</span>
                Microphone
                <span className="ml-auto h-1.5 w-16 overflow-hidden rounded-sm bg-canvas"><span className="block h-full bg-ok-600" style={{ width: `${Math.min(100, (status?.audioLevel ?? 0) * 250)}%` }} /></span>
              </li>
            )}
            <Ind ok={status?.online !== false} on={<Wifi className="h-3.5 w-3.5" />} off={<CloudOff className="h-3.5 w-3.5" />} label={status?.online === false ? "Reconnecting…" : "Connected"} />
            {state.exam.requireFullscreen && <Ind ok={!!status?.fullscreen} on={<Maximize className="h-3.5 w-3.5" />} off={<Maximize className="h-3.5 w-3.5" />} label="Fullscreen" />}
            {state.exam.requireWebcam && status?.detector === "none" && <li className="text-[11.5px] text-ink-500">Face detection unavailable on this device — HR will review manually.</li>}
          </ul>
          <div className="mt-auto rounded border border-line bg-canvas/60 p-2.5 text-[11.5px] leading-snug text-ink-500">
            <Eye className="mb-1 h-3.5 w-3.5" />
            {state.exam.proctoringEnabled ? "This session is proctored. Flags are reviewed by HR and never decide your result automatically." : "Answers save automatically. The timer keeps running on the server if you lose your connection."}
          </div>
        </aside>
      </div>

      {/* Mobile timer & violation status */}
      <div className="fixed right-3 top-16 flex items-center gap-1.5 lg:hidden z-20">
        <div className={cn(
          "rounded px-2 py-1 font-mono text-[11px] font-bold border shadow-xs",
          (tabSwitchViolations > 0 || screenshotViolations > 0)
            ? "bg-amber-50 text-amber-900 border-amber-300"
            : "bg-white text-ink-700 border-line"
        )}>
          T: {tabSwitchViolations}/2 · S: {screenshotViolations}/2
        </div>
        <div className="rounded bg-navy-900 px-2.5 py-1 font-mono text-[13px] text-white shadow">
          {clock(remaining)}
        </div>
      </div>

      {/* PAUSED OVERLAY */}
      {isPaused && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/90 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xl rounded-xl border border-white/10 bg-white p-8 text-center shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-700 ring-8 ring-amber-50">
              <Pause className="h-8 w-8" />
            </div>

            <Badge tone="warn" className="mt-4 px-3 py-1 font-semibold uppercase tracking-wider text-[11px]">
              Session Paused by Administrator
            </Badge>

            <h2 className="mt-3 text-2xl font-bold text-navy-950">Examination Temporarily Paused</h2>

            <p className="mt-2 text-sm text-ink-600 leading-relaxed">
              The examination administrator has temporarily paused this session.
              All your progress, answers, and section status have been securely saved on the server.
              Your examination timer is completely frozen.
            </p>

            <div className="mt-6 grid grid-cols-3 gap-3 rounded-lg border border-line bg-canvas p-4 text-center">
              <div>
                <div className="text-[10px] uppercase font-semibold text-ink-400">Current Stage</div>
                <div className="mt-1 text-xs font-bold text-navy-950 truncate">{section?.title || "Stage"}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-semibold text-ink-400">Saved Answers</div>
                <div className="mt-1 text-xs font-bold text-navy-950">{answeredCount} of {total}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-semibold text-ink-400">Frozen Time Left</div>
                <div className="mt-1 text-xs font-bold font-mono text-amber-700">{clock(remaining)}</div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-center gap-2.5 text-xs text-ink-500 font-medium">
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
              </span>
              <span>Waiting for administrator to resume the examination...</span>
            </div>

            <p className="mt-2 text-[11px] text-ink-400">
              Please do not close this window. Your test will continue automatically as soon as the session resumes.
            </p>
          </div>
        </div>
      )}

      {/* Blocking overlays */}
      {(gate || fullscreenLost || cameraLost) && !submitting && !isPaused && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-navy-950/85 p-4">
          <div className="w-full max-w-md rounded-md bg-white p-6 text-center shadow-pop">
            {gate ? (
              <>
                <h2 className="text-[18px] font-semibold">Resume your examination</h2>
                <p className="mt-2 text-[13.5px] text-ink-700">
                  {gate === "media" ? "Your camera and microphone need to be reconnected" : "The examination must run in fullscreen"}. Your answers are saved and the timer has continued on the server — <b className="num">{clock(remaining)}</b> remaining.
                </p>
                {gateError && <Alert tone="bad" className="mt-3 text-left">{gateError}</Alert>}
                <Button size="lg" className="mt-5 w-full" onClick={openGate}>Continue examination</Button>
              </>
            ) : cameraLost ? (
              <>
                <CameraOff className="mx-auto h-9 w-9 text-bad-600" />
                <h2 className="mt-2 text-[18px] font-semibold">Camera disconnected</h2>
                <p className="mt-2 text-[13.5px] text-ink-700">Reconnect your camera to continue. This has been recorded. The timer is still running.</p>
                <Button
                  size="lg"
                  className="mt-5 w-full"
                  onClick={async () => {
                    session.current?.stop();
                    session.current = null;
                    setGate("media");
                  }}
                >
                  Reconnect camera
                </Button>
              </>
            ) : (
              <>
                <Maximize className="mx-auto h-9 w-9 text-bad-600" />
                <h2 className="mt-2 text-[18px] font-semibold">Return to fullscreen</h2>
                <p className="mt-2 text-[13.5px] text-ink-700">This examination must run in fullscreen. Time outside fullscreen is recorded, and the timer is still running.</p>
                <Button size="lg" className="mt-5 w-full" onClick={() => void enterFullscreen()}>Return to fullscreen</Button>
              </>
            )}
          </div>
        </div>
      )}

      <Dialog
        open={sectionOpen}
        onClose={() => setSectionOpen(false)}
        title={`Submit & Continue: ${section?.title}?`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSectionOpen(false)}>
              Stay in Section
            </Button>
            <Button
              onClick={async () => {
                setSectionOpen(false);
                await flush();
                await api(`/attempts/${attemptId}/next-section`, { method: "POST" });
                await load();
                setCursor(0);
              }}
            >
              Lock & Proceed to Next Stage
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-[13px] text-ink-700">
          <p>
            Are you sure you want to finish <b>{section?.title}</b> and move to the next stage?
          </p>
          <div className="p-3 bg-amber-50 rounded border border-amber-200 text-amber-900 text-xs">
            <strong>Critical:</strong> Once submitted, <b>{section?.title}</b> will immediately lock. You cannot revisit this stage or change your answers. Early completion does not roll over extra time to subsequent sections.
          </div>
        </div>
      </Dialog>

      <Dialog open={submitOpen} onClose={() => setSubmitOpen(false)} title="Submit your examination?" dismissable={!submitting}>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded border border-line p-3"><div className="num text-[22px] font-medium text-ok-600">{answeredCount}</div><div className="label-caps">Answered</div></div>
          <div className="rounded border border-line p-3"><div className="num text-[22px] font-medium text-bad-600">{total - answeredCount}</div><div className="label-caps">Not answered</div></div>
          <div className="rounded border border-line p-3"><div className="num text-[22px] font-medium text-[#8a5a12]">{markedCount}</div><div className="label-caps">Marked for review</div></div>
        </div>
        <Alert tone="warn" className="mt-4" title="This cannot be undone">
          Once submitted, you cannot change any answer or re-enter this attempt. {remaining > 60_000 && <>You still have <b className="num">{clock(remaining)}</b> left.</>}
        </Alert>
        <Checkbox className="mt-4" checked={ack} onChange={(e) => setAck(e.target.checked)} label="I have reviewed my answers and want to submit now." />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setSubmitOpen(false)} disabled={submitting}>Return to examination</Button>
          <Button variant="danger" disabled={!ack} loading={submitting} onClick={() => submit(false)}>Submit examination</Button>
        </div>
      </Dialog>

      {/* VIOLATION AUTO-SUBMIT MODAL */}
      {violationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/90 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border-2 border-bad-600 bg-white p-6 text-center shadow-2xl animate-in fade-in zoom-in-95">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-bad-100 text-bad-600">
              <ShieldAlert className="h-8 w-8" />
            </div>
            <Badge tone="bad" className="mt-3 px-2.5 py-1 font-semibold uppercase tracking-wider text-[11px]">
              Violation Limit Reached
            </Badge>
            <h2 className="mt-3 text-xl font-bold text-navy-950">Examination Auto-Submitted</h2>
            <p className="mt-2 text-sm text-ink-700 leading-relaxed font-medium">
              {violationModal}
            </p>
            <div className="mt-4 rounded-lg bg-sand-100 p-3 text-left text-xs text-ink-600 border border-line">
              <div className="font-semibold text-navy-900 mb-1">Strict Anti-Malpractice System:</div>
              <div>• All answers saved up to the moment of violation.</div>
              <div>• Detailed timestamps & candidate event logs sent to HR.</div>
              <div>• Examination is now locked to prevent further modifications.</div>
            </div>
            <div className="mt-5">
              <Button className="w-full bg-navy-900 hover:bg-navy-800 text-white font-medium" onClick={() => finish()}>
                Proceed to Submission Summary
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className={cn("h-3 w-3 rounded-sm", cls)} />{label}</span>;
}
function Ind({ ok, on, off, label }: { ok: boolean; on: React.ReactNode; off: React.ReactNode; label: string }) {
  return <li className="flex items-center gap-2"><span className={ok ? "text-ok-600" : "text-bad-600"}>{ok ? on : off}</span>{label}<span className={cn("ml-auto h-1.5 w-1.5 rounded-full", ok ? "bg-ok-600" : "bg-bad-600")} /></li>;
}

function AnswerInput({ q, a, attemptId, onChange }: { q: Q; a?: Ans; attemptId?: string; onChange: (p: Partial<Ans>) => void }) {
  const sel = a?.selectedOptionIds ?? [];
  if (q.type === "SINGLE" || q.type === "TRUE_FALSE" || q.type === "MULTIPLE") {
    const multi = q.type === "MULTIPLE";
    return (
      <div className="space-y-2.5" role={multi ? "group" : "radiogroup"}>
        {multi && <div className="text-[12.5px] text-ink-500">Select all that apply.</div>}
        {q.options.map((o, i) => {
          const on = sel.includes(o.id);
          return (
            <button
              key={o.id}
              role={multi ? "checkbox" : "radio"}
              aria-checked={on}
              onClick={() => onChange({ selectedOptionIds: multi ? (on ? sel.filter((x) => x !== o.id) : [...sel, o.id]) : [o.id] })}
              className={cn("flex w-full items-start gap-3 rounded-md border bg-white px-4 py-3 text-left text-[14.5px] transition-colors", on ? "border-navy-800 bg-navy-50 ring-1 ring-navy-800" : "border-line hover:border-navy-500/50")}
            >
              <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border text-[12px] font-semibold", multi ? "rounded" : "rounded-full", on ? "border-navy-900 bg-navy-900 text-white" : "border-line-strong text-ink-500")}>
                {q.type === "TRUE_FALSE" ? (i === 0 ? "T" : "F") : String.fromCharCode(65 + i)}
              </span>
              <span className="prose-q flex-1">{o.text}</span>
            </button>
          );
        })}
      </div>
    );
  }
  if (q.type === "NUMERICAL")
    return (
      <label className="block max-w-xs">
        <span className="label-caps">Your answer (number)</span>
        <input inputMode="decimal" className="num mt-1 h-11 w-full rounded border border-line-strong bg-white px-3 text-[16px] focus:border-steel-500 focus:outline-none focus:ring-2 focus:ring-steel-500/20" value={a?.textAnswer ?? ""} onChange={(e) => onChange({ textAnswer: e.target.value.replace(/[^0-9.\-eE]/g, "") })} placeholder="e.g. 25" />
      </label>
    );
  if (q.type === "SHORT")
    return (
      <label className="block">
        <span className="label-caps">Your answer</span>
        <input className="mt-1 h-11 w-full select-text rounded border border-line-strong bg-white px-3 text-[15px] focus:border-steel-500 focus:outline-none focus:ring-2 focus:ring-steel-500/20" maxLength={500} value={a?.textAnswer ?? ""} onChange={(e) => onChange({ textAnswer: e.target.value })} />
      </label>
    );
  if (q.type === "CODING")
    return (
      <CodingIDE
        questionId={q.id}
        allowedLanguagesRaw={q.codeLanguage}
        starterCodeRaw={q.codeStarter}
        textAnswer={a?.textAnswer}
        attemptId={attemptId}
        onChange={(patch) => onChange({ textAnswer: patch.textAnswer })}
      />
    );
  if (q.type === "PROMPT")
    return (
      <PromptIDE
        questionId={q.id}
        attemptId={attemptId}
        questionText={q.text}
        maxMarks={q.marks}
        promptMeta={q.promptMeta}
        textAnswer={a?.textAnswer}
        onChange={(patch) => onChange({ textAnswer: patch.textAnswer })}
      />
    );
  const words = (a?.textAnswer ?? "").trim().split(/\s+/).filter(Boolean).length;
  return (
    <div>
      <textarea className="min-h-[300px] w-full select-text rounded border border-line-strong bg-white p-3 text-[14.5px] leading-relaxed focus:border-steel-500 focus:outline-none focus:ring-2 focus:ring-steel-500/20" maxLength={30000} value={a?.textAnswer ?? ""} onChange={(e) => onChange({ textAnswer: e.target.value })} placeholder="Write your answer here." />
      <div className="num mt-1 text-right text-[12px] text-ink-500">{words} words</div>
    </div>
  );
}

import type { Socket } from "socket.io-client";
import { api } from "@/lib/api";
import { AudioMeter, captureDataUrl, captureFrame } from "./media";
import { FaceAnalyzer } from "./faceDetector";

export interface ProctorConfig {
  attemptId: string;
  requireWebcam: boolean;
  requireMicrophone: boolean;
  requireFullscreen: boolean;
  evidenceCapture: boolean;
  faceMissingSeconds: number;
  lookingAwaySeconds: number;
  audioThreshold: number;
  livePreviewIntervalSec: number;
  initialMultiFaceCount?: number;
  maxAllowedMultiFace?: number;
}

export interface ProctorStatus {
  camera: "ON" | "OFF" | "NOT_REQUIRED";
  microphone: "ON" | "OFF" | "NOT_REQUIRED";
  focused: boolean;
  fullscreen: boolean;
  faceCount: number | null;
  audioLevel: number;
  detector: "landmarker" | "detector" | "none" | "loading";
  online: boolean;
}

export type Warning = { key: string; text: string; tone: "warn" | "bad" };

interface QueuedEvent { type: string; occurredAt: string; message?: string; meta?: Record<string, unknown>; evidenceId?: string | null }

const EVIDENCE_TYPES = new Set(["MULTIPLE_FACES", "FACE_MISSING", "LOOKING_AWAY"]);
const RESTRICTED_KEYS = new Set(["p", "s", "u", "f", "g", "j", "o", "r", "h"]);

/**
 * Client-side proctoring. Detects events locally and sends them to the server, which owns
 * scoring. All checks are best-effort: a browser cannot prevent secondary devices, virtual
 * machines or external screen capture.
 */
export class ProctorSession {
  private video: HTMLVideoElement;
  private stream: MediaStream | null;
  private socket: Socket;
  private cfg: ProctorConfig;
  private analyzer = new FaceAnalyzer();
  private audio = new AudioMeter();
  private queue: QueuedEvent[] = [];
  private timers: number[] = [];
  private cleanups: (() => void)[] = [];
  private stopped = false;
  private previewAllowed = false;
  private currentQuestion = 0;
  // episode tracking
  private noFaceSince: number | null = null;
  private noFaceFlagged = false;
  private multiSince: number | null = null;
  private multiFlagged = false;
  private multiClearSince: number | null = null;
  private multiFaceCount = 0;
  private awaySince: number | null = null;
  private awayFlagged = false;
  private loudSamples: number[] = [];
  private lastAudioFlag = 0;
  private cameraOk = true;
  private micOk = true;
  status: ProctorStatus;
  onStatus: (s: ProctorStatus) => void = () => undefined;
  onWarning: (w: Warning | null, key?: string) => void = () => undefined;
  onEventLogged: (type: string) => void = () => undefined;
  onAutoSubmit?: (reason: string, violationCount: number) => void;

  constructor(video: HTMLVideoElement, stream: MediaStream | null, socket: Socket, cfg: ProctorConfig) {
    this.video = video;
    this.stream = stream;
    this.socket = socket;
    this.cfg = cfg;
    this.multiFaceCount = cfg.initialMultiFaceCount ?? 0;
    this.status = {
      camera: cfg.requireWebcam ? (stream?.getVideoTracks()[0]?.readyState === "live" ? "ON" : "OFF") : "NOT_REQUIRED",
      microphone: cfg.requireMicrophone ? (stream?.getAudioTracks()[0]?.readyState === "live" ? "ON" : "OFF") : "NOT_REQUIRED",
      focused: document.hasFocus(),
      fullscreen: !!document.fullscreenElement,
      faceCount: null,
      audioLevel: 0,
      detector: cfg.requireWebcam ? "loading" : "none",
      online: navigator.onLine,
    };
  }

  setQuestion(i: number) {
    this.currentQuestion = i;
  }

  async start() {
    this.joinSocket();
    this.attachBrowserMonitors();
    this.attachTrackMonitors();
    if (this.stream && this.cfg.requireMicrophone && this.audio.start(this.stream)) {
      this.every(250, () => this.audioTick());
    }
    this.every(3000, () => this.flush());
    this.every(2000, () => this.sendStatus());
    if (this.cfg.requireFullscreen && !document.fullscreenElement) {
      // The browser refused or could not enter fullscreen — record it so HR sees it.
      this.log("FULLSCREEN_EXIT", "Examination is not running in fullscreen");
      this.onWarning({ key: "fullscreen", text: "This examination must run in fullscreen. Return to fullscreen to continue.", tone: "bad" });
    }
    if (this.cfg.requireWebcam) {
      this.every(Math.max(2, this.cfg.livePreviewIntervalSec) * 1000, () => this.sendFrame());
      this.analyzer.init().then((ok) => {
        this.status.detector = ok ? this.analyzer.mode : "none";
        if (!ok) this.log("DETECTOR_UNAVAILABLE", this.analyzer.error ?? undefined);
        this.emitStatus();
        if (ok) this.faceLoop();
      });
    }
  }

  private every(ms: number, fn: () => void) {
    this.timers.push(window.setInterval(fn, ms));
  }

  private joinSocket() {
    const join = () =>
      this.socket.emit("candidate:join", { attemptId: this.cfg.attemptId }, (r: { ok: boolean; previewAllowed?: boolean }) => {
        this.previewAllowed = !!r?.previewAllowed;
        this.sendStatus();
      });
    if (this.socket.connected) join();
    this.socket.on("connect", join);
    const onDisc = () => {
      this.status.online = false;
      this.emitStatus();
    };
    const onConn = () => {
      this.status.online = true;
      this.emitStatus();
    };
    this.socket.on("disconnect", onDisc);
    this.socket.on("connect", onConn);
    this.cleanups.push(() => {
      this.socket.off("connect", join);
      this.socket.off("disconnect", onDisc);
      this.socket.off("connect", onConn);
    });
  }

  // ───── Browser activity ─────
  private attachBrowserMonitors() {
    const on = <K extends keyof DocumentEventMap>(target: Document | Window, ev: K | string, fn: (e: Event) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(ev, fn, opts);
      this.cleanups.push(() => target.removeEventListener(ev, fn, opts));
    };
    let unloading = false; // a reload/navigation is not a tab switch
    let lastScreenshotKeyTime = 0;

    // Detect browser screen-capture / screen-sharing permission calls
    if (typeof navigator !== "undefined" && navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function") {
      const origGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getDisplayMedia = async (...args) => {
        this.log("SCREEN_CAPTURE_DETECTED", "Browser screen-sharing or display capture invoked");
        this.onWarning({ key: "screencap", text: "Screen sharing and screen capture are strictly prohibited during the examination.", tone: "bad" });
        return origGetDisplayMedia(...args);
      };
      this.cleanups.push(() => {
        navigator.mediaDevices.getDisplayMedia = origGetDisplayMedia;
      });
    }

    on(window, "pagehide", () => (unloading = true));
    on(document, "visibilitychange", () => {
      if (unloading) return;
      if (document.visibilityState === "hidden") {
        this.log("TAB_SWITCH", "Examination tab hidden (switched tab or minimised window)");
        this.status.focused = false;
      } else {
        this.status.focused = document.hasFocus();
        this.onWarning({ key: "tab", text: "Switching tabs or windows is recorded. Stay on the examination page.", tone: "bad" });
      }
      this.emitStatus();
    });
    on(window, "blur", () => {
      // If window blur happened right after a screenshot key/modifier, capture snipping tool event
      if (Date.now() - lastScreenshotKeyTime < 1500) {
        this.log("SNIPPING_TOOL_DETECTED", "Screen snipping utility caused window focus loss");
        this.onWarning({ key: "screenshot", text: "Screen snipping tools are prohibited during the examination.", tone: "bad" });
      }
      // When the tab is hidden the visibilitychange event covers it
      setTimeout(() => {
        if (document.visibilityState === "visible" && !document.hasFocus()) {
          this.log("FOCUS_LOST", "Examination window lost focus");
          this.status.focused = false;
          this.emitStatus();
        }
      }, 150);
    });
    on(window, "focus", () => {
      this.status.focused = true;
      this.emitStatus();
    });
    on(document, "fullscreenchange", () => {
      this.status.fullscreen = !!document.fullscreenElement;
      if (!this.status.fullscreen && this.cfg.requireFullscreen && !this.stopped) {
        this.log("FULLSCREEN_EXIT", "Exited fullscreen mode");
        this.onWarning({ key: "fullscreen", text: "You left fullscreen. Return to fullscreen to continue.", tone: "bad" });
      } else if (this.status.fullscreen) {
        this.onWarning(null, "fullscreen");
      }
      this.emitStatus();
    });
    const clip = (type: "COPY" | "PASTE" | "CUT") => (e: Event) => {
      e.preventDefault();
      this.log(type, `${type.charAt(0)}${type.slice(1).toLowerCase()} attempt blocked`);
      this.onWarning({ key: "clip", text: "Copy, cut and paste are disabled during the examination.", tone: "warn" });
    };
    on(document, "copy", clip("COPY"));
    on(document, "paste", clip("PASTE"));
    on(document, "cut", clip("CUT"));
    on(document, "contextmenu", (e) => {
      e.preventDefault();
      this.log("CONTEXT_MENU");
    });
    on(document, "dragstart", (e) => e.preventDefault());

    // Screenshot & restricted shortcut monitoring on keydown
    on(
      document,
      "keydown",
      (ev) => {
        const e = ev as KeyboardEvent;
        const k = e.key.toLowerCase();
        const mod = e.ctrlKey || e.metaKey;

        // 1. PrintScreen key
        if (e.key === "PrintScreen" || e.code === "PrintScreen" || e.keyCode === 44) {
          e.preventDefault();
          lastScreenshotKeyTime = Date.now();
          this.log("SCREENSHOT_ATTEMPT", "PrintScreen shortcut detected", { key: e.key, code: e.code });
          this.onWarning({ key: "screenshot", text: "Taking screenshots is strictly prohibited during the examination.", tone: "bad" });
          return;
        }

        // 2. Windows Screen Snipping shortcut (Win + Shift + S)
        const isWinShiftS = (e.metaKey || e.key === "Meta" || e.key === "OS") && e.shiftKey && (k === "s" || e.code === "KeyS");
        if (isWinShiftS) {
          e.preventDefault();
          lastScreenshotKeyTime = Date.now();
          this.log("SNIPPING_TOOL_DETECTED", "Windows Screen Snipping shortcut (Win+Shift+S) detected", { shortcut: "Win+Shift+S" });
          this.onWarning({ key: "screenshot", text: "Screen snipping tools are prohibited during the examination.", tone: "bad" });
          return;
        }

        // 3. macOS screenshot shortcuts (Cmd + Shift + 3 / 4 / 5 / 6)
        const isMacScreenshot = e.metaKey && e.shiftKey && ["3", "4", "5", "6"].includes(e.key);
        if (isMacScreenshot) {
          e.preventDefault();
          lastScreenshotKeyTime = Date.now();
          this.log("SCREENSHOT_ATTEMPT", `macOS screen capture shortcut (Cmd+Shift+${e.key}) detected`, { shortcut: `Cmd+Shift+${e.key}` });
          this.onWarning({ key: "screenshot", text: "Taking screenshots is strictly prohibited during the examination.", tone: "bad" });
          return;
        }

        // 4. Print or Save-as-PDF shortcut (Ctrl/Cmd + P)
        if (mod && k === "p") {
          e.preventDefault();
          this.log("SCREENSHOT_ATTEMPT", "Print / Save-as-PDF shortcut (Ctrl/Cmd+P) blocked", { shortcut: "Ctrl/Cmd+P" });
          this.onWarning({ key: "screenshot", text: "Printing or exporting examination content is prohibited.", tone: "bad" });
          return;
        }

        // 5. Developer Tools inspection
        const devtools = e.key === "F12" || (mod && e.shiftKey && ["i", "j", "c"].includes(k));
        if (devtools) {
          e.preventDefault();
          this.log("DEVTOOLS_SUSPECTED", `Shortcut ${describe(e)}`);
          return;
        }

        // 6. Generic restricted keyboard shortcuts
        if ((mod && RESTRICTED_KEYS.has(k)) || (e.altKey && e.key === "Tab") || (e.metaKey && !e.ctrlKey && k === "tab")) {
          e.preventDefault();
          this.log("RESTRICTED_SHORTCUT", `Shortcut ${describe(e)}`);
        }
      },
      { capture: true },
    );

    // Screenshot monitoring on keyup (for OS platforms firing PrintScreen on keyup)
    on(
      document,
      "keyup",
      (ev) => {
        const e = ev as KeyboardEvent;
        if (e.key === "PrintScreen" || e.code === "PrintScreen" || e.keyCode === 44) {
          lastScreenshotKeyTime = Date.now();
          this.log("SCREENSHOT_ATTEMPT", "PrintScreen key released (screenshot suspected)", { event: "keyup" });
          this.onWarning({ key: "screenshot", text: "Taking screenshots is strictly prohibited.", tone: "bad" });
        }
      },
      { capture: true },
    );
    on(window, "online", () => {
      this.status.online = true;
      this.flush();
      this.emitStatus();
    });
    on(window, "offline", () => {
      this.status.online = false;
      this.emitStatus();
    });
  }

  // ───── Camera / microphone tracks ─────
  private attachTrackMonitors() {
    const v = this.stream?.getVideoTracks()[0];
    const a = this.stream?.getAudioTracks()[0];
    if (v && this.cfg.requireWebcam) {
      const ended = () => this.setCamera(false);
      v.addEventListener("ended", ended);
      v.addEventListener("mute", ended);
      v.addEventListener("unmute", () => this.setCamera(true));
      this.cleanups.push(() => v.removeEventListener("ended", ended));
    }
    if (a && this.cfg.requireMicrophone) {
      const ended = () => this.setMic(false);
      a.addEventListener("ended", ended);
      this.cleanups.push(() => a.removeEventListener("ended", ended));
    }
    this.every(2000, () => {
      if (this.cfg.requireWebcam) this.setCamera(!!v && v.readyState === "live" && !v.muted);
      if (this.cfg.requireMicrophone) this.setMic(!!a && a.readyState === "live");
    });
  }

  private setCamera(ok: boolean) {
    if (ok === this.cameraOk) return;
    this.cameraOk = ok;
    this.status.camera = ok ? "ON" : "OFF";
    this.log(ok ? "CAMERA_RECONNECTED" : "CAMERA_DISCONNECTED");
    this.onWarning(ok ? null : { key: "camera", text: "Your camera has disconnected. Reconnect it to continue.", tone: "bad" }, "camera");
    this.emitStatus();
  }
  private setMic(ok: boolean) {
    if (ok === this.micOk) return;
    this.micOk = ok;
    this.status.microphone = ok ? "ON" : "OFF";
    this.log(ok ? "MIC_RECONNECTED" : "MIC_DISCONNECTED");
    this.onWarning(ok ? null : { key: "mic", text: "Your microphone has disconnected.", tone: "bad" }, "mic");
    this.emitStatus();
  }

  // ───── Face analysis (≈2.5 fps) ─────
  private faceLoop() {
    const tick = () => {
      if (this.stopped) return;
      const now = performance.now();
      const r = this.analyzer.analyze(this.video, now);
      if (r) this.handleFace(r.faceCount, r.yaw, r.pitch);
      this.timers.push(window.setTimeout(tick, 400));
    };
    tick();
  }

  private handleFace(count: number, yaw: number | null, pitch: number | null) {
    const t = Date.now();
    this.status.faceCount = count;
    // No face
    if (count === 0) {
      this.noFaceSince ??= t;
      if (!this.noFaceFlagged && t - this.noFaceSince >= this.cfg.faceMissingSeconds * 1000) {
        this.noFaceFlagged = true;
        this.log("FACE_MISSING", `No face visible for ${this.cfg.faceMissingSeconds}+ seconds`);
      }
      if (t - this.noFaceSince > 2000) this.onWarning({ key: "face", text: "We can't see your face. Stay in front of the camera.", tone: "bad" });
    } else {
      if (this.noFaceFlagged) this.log("FACE_RETURNED", `Face visible again after ${Math.round((t - (this.noFaceSince ?? t)) / 1000)}s`);
      if (this.noFaceSince) this.onWarning(null, "face");
      this.noFaceSince = null;
      this.noFaceFlagged = false;
    }
    // Multiple faces (must persist ~1.5 s to avoid single-frame false positives, only counting once per incident)
    if (count > 1) {
      this.multiSince ??= t;
      this.multiClearSince = null;
      if (!this.multiFlagged && t - this.multiSince >= 1500) {
        this.multiFlagged = true;
        this.multiFaceCount += 1;
        const countNum = this.multiFaceCount;
        const maxAllowed = this.cfg.maxAllowedMultiFace ?? 2;

        if (countNum <= maxAllowed) {
          const warnText =
            countNum === maxAllowed
              ? `FINAL WARNING (${countNum}/${maxAllowed}): Multiple faces detected (${count} faces)! The 3rd detection will automatically terminate and submit your examination immediately.`
              : `Warning ${countNum}/${maxAllowed}: Multiple faces detected (${count} faces)! Only you should be visible on camera. Allowed: ${maxAllowed} warnings before auto-submission.`;
          this.onWarning({ key: "multi", text: warnText, tone: "bad" });
          this.log("MULTIPLE_FACES", `Multiple faces detected (Warning ${countNum}/${maxAllowed})`, {
            faceCount: count,
            violationCount: countNum,
            maxAllowed,
          });
        } else {
          this.onWarning({
            key: "multi",
            text: `EXAM AUTO-SUBMITTED: Multiple faces detected 3 times (exceeded ${maxAllowed} allowed warnings). Submitting examination now...`,
            tone: "bad",
          });
          this.log("MULTIPLE_FACES", `3rd multiple-face detection (${count} faces): Exam auto-submitted (total 3 detections reached)`, {
            faceCount: count,
            violationCount: countNum,
            maxAllowed,
            autoSubmitted: true,
          });
          this.onAutoSubmit?.("MULTIPLE_FACES", countNum);
        }
      }
    } else {
      if (this.multiFlagged || this.multiSince) {
        this.multiClearSince ??= t;
        // Require at least 2 seconds of clean frame (<= 1 face) before ending this incident
        if (t - this.multiClearSince >= 2000) {
          this.multiSince = null;
          this.multiFlagged = false;
          this.multiClearSince = null;
          this.onWarning(null, "multi");
        }
      }
    }
    // Head pose: looking away
    const away = count === 1 && ((yaw !== null && Math.abs(yaw) > 35) || (pitch !== null && (pitch > 30 || pitch < -25)));
    if (away) {
      this.awaySince ??= t;
      if (!this.awayFlagged && t - this.awaySince >= this.cfg.lookingAwaySeconds * 1000) {
        this.awayFlagged = true;
        this.log("LOOKING_AWAY", "Head turned away from the screen", { yaw: yaw && Math.round(yaw), pitch: pitch && Math.round(pitch) });
      }
    } else {
      this.awaySince = null;
      this.awayFlagged = false;
    }
  }

  // ───── Audio ─────
  private audioTick() {
    const lvl = this.audio.level();
    this.status.audioLevel = lvl;
    const t = Date.now();
    if (lvl > this.cfg.audioThreshold) this.loudSamples.push(t);
    this.loudSamples = this.loudSamples.filter((x) => t - x < 6000);
    // sustained activity: >60% of the last 6 s above threshold
    if (this.loudSamples.length >= 15 && t - this.lastAudioFlag > 30_000) {
      this.lastAudioFlag = t;
      this.log("AUDIO_ACTIVITY", "Sustained sound above the threshold", { level: Math.round(lvl * 100) / 100 });
    }
  }

  // ───── Event logging ─────
  log(type: string, message?: string, meta?: Record<string, unknown>) {
    if (this.stopped) return;
    const ev: QueuedEvent = { type, occurredAt: new Date().toISOString(), message, meta };
    this.onEventLogged(type);
    if (this.cfg.evidenceCapture && EVIDENCE_TYPES.has(type) && this.video.videoWidth) {
      captureFrame(this.video, 640, 0.75).then(async (blob) => {
        if (blob) {
          try {
            const fd = new FormData();
            fd.append("kind", "SNAPSHOT");
            fd.append("image", blob, "snapshot.jpg");
            const r = await api<{ id: string }>(`/attempts/${this.cfg.attemptId}/evidence`, { form: fd });
            ev.evidenceId = r.id;
          } catch {
            /* evidence is optional */
          }
        }
        this.queue.push(ev);
        this.flush();
      });
      return;
    }
    this.queue.push(ev);
    if (["MULTIPLE_FACES", "CAMERA_DISCONNECTED", "FULLSCREEN_EXIT", "TAB_SWITCH"].includes(type)) this.flush();
  }

  private flushing = false;
  async flush(keepalive = false) {
    if (this.flushing || !this.queue.length) return;
    this.flushing = true;
    const batch = this.queue.splice(0, 50);
    try {
      await api(`/attempts/${this.cfg.attemptId}/events`, { body: { events: batch }, keepalive });
    } catch {
      this.queue.unshift(...batch); // retry later
    } finally {
      this.flushing = false;
    }
  }

  private emitStatus() {
    this.onStatus({ ...this.status });
  }
  private sendStatus() {
    this.emitStatus();
    if (!this.socket.connected) return;
    this.socket.emit("candidate:status", {
      camera: this.status.camera,
      microphone: this.status.microphone,
      focused: this.status.focused && document.visibilityState === "visible",
      fullscreen: this.status.fullscreen,
      faceCount: this.status.faceCount,
      audioLevel: Math.round(this.status.audioLevel * 100) / 100,
      currentQuestion: this.currentQuestion,
      multiFaceViolations: this.multiFaceCount,
    });
  }
  private sendFrame() {
    if (!this.previewAllowed || !this.socket.connected || document.visibilityState !== "visible") return;
    const url = captureDataUrl(this.video, 160, 0.55);
    if (url) this.socket.emit("candidate:frame", { image: url });
  }

  async stop() {
    this.stopped = true;
    this.timers.forEach((t) => {
      clearInterval(t);
      clearTimeout(t);
    });
    this.cleanups.forEach((c) => c());
    this.audio.stop();
    this.analyzer.close();
    await this.flush(true);
  }
}

function describe(e: KeyboardEvent) {
  return [e.ctrlKey && "Ctrl", e.metaKey && "Cmd", e.altKey && "Alt", e.shiftKey && "Shift", e.key].filter(Boolean).join("+");
}

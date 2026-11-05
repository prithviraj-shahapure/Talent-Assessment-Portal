import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Camera, Check, CheckCircle2, Circle, Clock, HandHelping, KeyRound, Loader2, Maximize, Mic, MonitorCheck, RefreshCw, ShieldCheck, User, Wifi, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/lib/auth";
import { getSocket } from "@/lib/socket";
import { Alert, Badge, Button, Card, Checkbox, Dialog, Field, Input, Spinner, Textarea, useToast } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { acquireMedia, AudioMeter, browserInfo, captureFrame, enterFullscreen, mediaStore, stopMedia } from "@/proctoring/media";
import { FaceAnalyzer } from "@/proctoring/faceDetector";
import { cn } from "@/lib/cn";

interface LobbyExam {
  id: string;
  title: string;
  description: string | null;
  position: string | null;
  department?: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  totalMarks: number;
  passingMarks: number;
  negativeMarking: boolean;
  instructions: string | null;
  sections: { id: string; title: string; timeLimitMinutes: number | null }[];
  sectionTimeLimits: boolean;
  questionCount: number;
  proctoring: { enabled: boolean; requireWebcam: boolean; requireMicrophone: boolean; requireFullscreen: boolean; evidenceCapture: boolean; livePreview: boolean };
  phase: "UPCOMING" | "OPEN" | "CLOSED";
  attemptsUsed: number;
  attemptsAllowed: number;
  inProgressAttemptId: string | null;
  emailVerified: boolean;
  accommodation: { status: string; reason: string; response: string | null } | null;
}
interface PublicSettings { privacyNotice: string; privacyPolicyVersion: string; evidenceRetentionDays: number; verificationPhotoRetentionDays: number }

type StepKey = "instructions" | "consent" | "system" | "devices" | "photo" | "environment";
const STEP_LABEL: Record<StepKey, string> = { instructions: "Instructions", consent: "Privacy & consent", system: "System check", devices: "Camera & microphone", photo: "Verification photo", environment: "Environment & start" };

export default function ExamLobby() {
  const { examId } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { data: exam, loading, reload } = useApi<LobbyExam>(`/me/exams/${examId}`, [examId]);
  const { data: ps } = useApi<PublicSettings>("/settings/public");
  const [step, setStep] = useState(0);
  const [consent, setConsent] = useState({ notice: false, webcam: false, microphone: false, evidence: false });
  const [accOpen, setAccOpen] = useState(false);

  // ── Session Code Verification Gate State ──
  const [sessionVerified, setSessionVerified] = useState<boolean | null>(null);
  const [sessionChecking, setSessionChecking] = useState(true);
  const [sessionCode, setSessionCode] = useState("");
  const [identifier, setIdentifier] = useState(user?.email || "");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (user?.email && !identifier) {
      setIdentifier(user.email);
    }
  }, [user?.email, identifier]);

  useEffect(() => {
    let active = true;
    setSessionChecking(true);
    api<{ verified: boolean; activeAttemptId?: string | null; reason?: string; status?: string }>(`/sessions/verify-status/${examId}`)
      .then((res) => {
        if (!active) return;
        if (res.activeAttemptId) {
          // Ongoing attempt exists: restore/reconnect directly!
          nav(`/exam/${res.activeAttemptId}`, { replace: true });
          return;
        }
        setSessionVerified(res.verified);
      })
      .catch(() => {
        if (active) setSessionVerified(false);
      })
      .finally(() => {
        if (active) setSessionChecking(false);
      });
    return () => {
      active = false;
    };
  }, [examId, nav]);

  const handleVerifySession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionCode.trim() || !identifier.trim()) {
      setVerifyError("Please enter both your examination session code and registered email or candidate ID.");
      return;
    }
    setVerifying(true);
    setVerifyError(null);
    try {
      const res = await api<{
        success: boolean;
        examId: string;
        activeAttemptId: string | null;
      }>("/sessions/verify", {
        method: "POST",
        body: {
          sessionCode: sessionCode.trim(),
          identifier: identifier.trim(),
        },
      });

      if (res.examId !== examId) {
        setVerifyError("This session code is for a different examination. Please enter the valid session code for this examination.");
        return;
      }

      if (res.activeAttemptId) {
        nav(`/exam/${res.activeAttemptId}`, { replace: true });
        return;
      }

      setSessionVerified(true);
      toast("Session code verified successfully", "ok");
      reload();
    } catch (err) {
      setVerifyError((err as Error).message || "Verification failed. Please check your credentials.");
    } finally {
      setVerifying(false);
    }
  };

  useEffect(() => () => {
    // leaving the lobby without starting: release devices
    if (!startedRef.current) {
      stopMedia(mediaStore.stream);
      mediaStore.stream = null;
    }
  }, []);
  const startedRef = useRef(false);

  if (loading || !exam || !ps || sessionChecking) return <Spinner />;
  const p = exam.proctoring;
  const steps: StepKey[] = ["instructions", "consent", "system", ...(p.requireWebcam || p.requireMicrophone ? (["devices"] as StepKey[]) : []), ...(p.requireWebcam ? (["photo"] as StepKey[]) : []), "environment"];
  const key = steps[step];
  const next = () => setStep((s) => Math.min(steps.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  if (exam.inProgressAttemptId)
    return (
      <Card className="mx-auto max-w-xl">
        <div className="py-4 text-center">
          <RefreshCw className="mx-auto h-10 w-10 text-signal-500" />
          <h1 className="mt-3 text-[20px] font-semibold">Your examination is in progress</h1>
          <p className="mt-1 text-[13.5px] text-ink-500">The timer kept running on the server while you were away. Resume to continue where you left off.</p>
          <Button className="mt-5" size="lg" variant="signal" onClick={() => nav(`/exam/${exam.inProgressAttemptId}`)}>Resume examination</Button>
        </div>
      </Card>
    );

  // ── SESSION CODE VERIFICATION GATE ──
  if (!sessionVerified) {
    return (
      <div className="mx-auto max-w-lg py-8">
        <Link to="/candidate" className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-ink-500 hover:text-ink-900">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to My Examinations
        </Link>
        <Card className="border-t-4 border-t-navy-900 shadow-xl p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-navy-900 text-white shadow-md">
              <KeyRound className="h-6 w-6 text-signal-400" />
            </div>
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-ink-400">Zero-Trust Verification Gate</div>
              <h1 className="text-xl font-bold text-navy-950">Session Code Verification</h1>
            </div>
          </div>

          <p className="text-sm text-ink-600 mb-6">
            To access <strong className="text-navy-900">{exam.title}</strong>, enter your examination session code and registered email or candidate ID.
          </p>

          {verifyError && (
            <Alert tone="bad" className="mb-5 text-left">
              {verifyError}
            </Alert>
          )}

          <form onSubmit={handleVerifySession} className="space-y-4">
            <Field label="Examination Session Code" hint="Provided in your Zanvar recruitment invitation email (e.g. ZG-TECH-8472)">
              <Input
                className="font-mono text-base uppercase font-semibold tracking-wider h-11 pl-3"
                placeholder="E.G. ZG-TECH-8472"
                value={sessionCode}
                onChange={(e) => setSessionCode(e.target.value.toUpperCase())}
                required
              />
            </Field>

            <Field label="Registered Email or Candidate ID" hint="The email or candidate ID linked to your application">
              <Input
                type="text"
                className="h-11 mt-1 text-sm"
                placeholder="your.email@example.com or Candidate ID"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
            </Field>

            <div className="pt-2">
              <Button
                type="submit"
                size="lg"
                loading={verifying}
                disabled={!sessionCode.trim() || !identifier.trim()}
                className="w-full bg-navy-900 hover:bg-navy-800 text-white font-semibold py-3 shadow-md"
              >
                Verify & Enter Examination <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </form>

          <div className="mt-6 rounded-lg bg-sand-100 p-3.5 border border-line text-xs text-ink-600 flex items-start gap-2.5">
            <ShieldCheck className="h-4 w-4 text-ok-600 shrink-0 mt-0.5" />
            <div>
              <strong>Secure Access Gate:</strong> Session codes verify schedule validity, candidate authorization, and capacity limits before opening the assessment lobby.
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const blocked =
    exam.phase === "UPCOMING" ? `This examination opens on ${fmtDateTime(exam.startAt)}.` : exam.phase === "CLOSED" ? "This examination window has closed." : exam.attemptsUsed >= exam.attemptsAllowed ? "You have used all permitted attempts for this examination." : !exam.emailVerified ? "Verify your email address before starting. Use the link in the banner above." : null;

  return (
    <div>
      <Link to="/candidate" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-ink-500 hover:text-ink-900"><ArrowLeft className="h-3.5 w-3.5" /> My examinations</Link>
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold">{exam.title}</h1>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-500">
            {exam.department && <span>{exam.department}</span>}
            <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {exam.durationMinutes} minutes</span>
            <span className="num">{exam.questionCount} questions · {exam.totalMarks} marks</span>
            <span>Closes {fmtDateTime(exam.endAt)}</span>
          </div>
        </div>
      </div>
      {blocked ? (
        <Alert tone="warn">{blocked}</Alert>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
          <ol className="card h-fit p-2">
            {steps.map((s, i) => (
              <li key={s} className={cn("flex items-center gap-2.5 rounded px-2.5 py-2 text-[13px]", i === step ? "bg-navy-50 font-semibold text-navy-900" : i < step ? "text-ink-700" : "text-ink-400")}>
                {i < step ? <CheckCircle2 className="h-4 w-4 text-ok-600" /> : i === step ? <span className="flex h-4 w-4 items-center justify-center rounded-full bg-navy-900 text-[10px] text-white">{i + 1}</span> : <Circle className="h-4 w-4" />}
                {STEP_LABEL[s]}
              </li>
            ))}
          </ol>
          <div className="min-w-0">
            {key === "instructions" && (
              <Card title="Examination instructions">
                <div className="grid gap-3 sm:grid-cols-4 mb-4">
                  <Info label="Duration" value={`${exam.durationMinutes} min`} />
                  <Info label="Questions" value={exam.questionCount} />
                  <Info label="Total marks" value={exam.totalMarks} />
                  <Info label="Negative marking" value={exam.negativeMarking ? "Yes" : "No"} />
                </div>
                {exam.sections.length > 1 && (
                  <div className="mb-4">
                    <div className="label-caps mb-1.5">Sections</div>
                    <ol className="space-y-1 text-[13px]">
                      {exam.sections.map((s, i) => <li key={s.id}>{i + 1}. {s.title}{exam.sectionTimeLimits && s.timeLimitMinutes ? <span className="text-ink-500"> — {s.timeLimitMinutes} min (sections are taken in order and lock once finished)</span> : ""}</li>)}
                    </ol>
                  </div>
                )}
                <div className="prose-q rounded border border-line bg-canvas/60 p-4 text-[13.5px]">{exam.instructions || "Answer all questions within the time limit."}</div>
                {p.enabled && (
                  <Alert tone="navy" className="mt-4" title="This examination is proctored">
                    {[p.requireWebcam && "your webcam", p.requireMicrophone && "your microphone's sound level", "browser activity"].filter(Boolean).join(", ")} will be monitored. You'll be asked for consent in the next step.
                  </Alert>
                )}
                {exam.accommodation ? (
                  <Alert tone={exam.accommodation.status === "APPROVED" ? "ok" : exam.accommodation.status === "DECLINED" ? "bad" : "warn"} className="mt-4" title={`Accommodation request ${exam.accommodation.status.toLowerCase()}`}>
                    {exam.accommodation.response ?? "HR will review your request before the window closes."}
                  </Alert>
                ) : (
                  p.enabled && (
                    <button onClick={() => setAccOpen(true)} className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-steel-600 hover:underline">
                      <HandHelping className="h-4 w-4" /> Can't use a webcam or microphone, or need extra time? Request an alternative arrangement
                    </button>
                  )
                )}
                <Footer next={next} />
              </Card>
            )}
            {key === "consent" && (
              <Card title="Privacy notice & consent" subtitle={`Policy version ${ps.privacyPolicyVersion}`}>
                <div className="max-h-56 overflow-y-auto rounded border border-line bg-canvas/60 p-4 text-[13px] leading-relaxed scrollbar-thin">{ps.privacyNotice}</div>
                <div className="mt-3 rounded border border-line p-3 text-[12.5px] text-ink-700">
                  <div className="label-caps mb-1">What is collected for this examination</div>
                  <ul className="list-disc space-y-0.5 pl-4">
                    {p.requireWebcam && <li>A verification photo at the start (kept {ps.verificationPhotoRetentionDays} days). Face <b>presence</b> is checked on your device — this is not facial recognition.</li>}
                    {p.requireWebcam && p.livePreview && <li>Small, low-resolution preview images shown live to authorised HR proctors. These are not stored.</li>}
                    {p.requireMicrophone && <li>Sound <b>level</b> only. No audio is recorded or uploaded.</li>}
                    <li>Browser events: tab switches, focus loss, fullscreen exits, copy/paste attempts, with timestamps.</li>
                    {p.evidenceCapture && <li>Optional: still snapshots when an event is flagged (kept {ps.evidenceRetentionDays} days).</li>}
                    <li>Flags are reviewed by a person. You will not be disqualified automatically.</li>
                  </ul>
                </div>
                <div className="mt-4 space-y-3">
                  <Checkbox checked={consent.notice} onChange={(e) => setConsent({ ...consent, notice: e.target.checked })} label="I have read and understood the privacy notice." />
                  {p.requireWebcam && <Checkbox checked={consent.webcam} onChange={(e) => setConsent({ ...consent, webcam: e.target.checked })} label="I consent to webcam monitoring for this examination." description="Required for this examination." />}
                  {p.requireMicrophone && <Checkbox checked={consent.microphone} onChange={(e) => setConsent({ ...consent, microphone: e.target.checked })} label="I consent to microphone sound-level monitoring." description="Required for this examination." />}
                  {p.evidenceCapture && <Checkbox checked={consent.evidence} onChange={(e) => setConsent({ ...consent, evidence: e.target.checked })} label="I consent to evidence snapshots being saved when an event is flagged." description="Optional. If you decline, only the event record is kept." />}
                </div>
                <Footer back={back} next={next} disabled={!consent.notice || (p.requireWebcam && !consent.webcam) || (p.requireMicrophone && !consent.microphone)} />
              </Card>
            )}
            {key === "system" && <SystemCheck back={back} next={next} needsMedia={p.requireWebcam || p.requireMicrophone} />}
            {key === "devices" && <DeviceCheck back={back} next={next} video={p.requireWebcam} audio={p.requireMicrophone} />}
            {key === "photo" && <PhotoStep back={back} next={next} />}
            {key === "environment" && (
              <EnvironmentStep
                back={back}
                requireFullscreen={p.requireFullscreen}
                onStart={async () => {
                  try {
                    const bi = browserInfo();
                    const r = await api<{ attemptId: string }>("/attempts/start", {
                      body: {
                        examId: exam.id,
                        consent: { webcam: consent.webcam, microphone: consent.microphone, evidence: consent.evidence, privacyNotice: true },
                        clientInfo: { userAgent: bi.userAgent, browser: `${bi.name} ${bi.version}`, screen: `${screen.width}x${screen.height}`, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
                      },
                    });
                    if (mediaStore.verificationPhoto) {
                      const fd = new FormData();
                      fd.append("kind", "VERIFICATION_PHOTO");
                      fd.append("image", mediaStore.verificationPhoto, "verification.jpg");
                      await api(`/attempts/${r.attemptId}/evidence`, { form: fd }).catch(() => undefined);
                    }
                    mediaStore.consent = { webcam: consent.webcam, microphone: consent.microphone, evidence: consent.evidence };
                    mediaStore.justStarted = r.attemptId;
                    startedRef.current = true;
                    nav(`/exam/${r.attemptId}`, { replace: true });
                  } catch (e) {
                    toast((e as Error).message, "bad");
                    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
                    reload();
                  }
                }}
              />
            )}
          </div>
        </div>
      )}
      <AccommodationDialog open={accOpen} onClose={() => setAccOpen(false)} examId={exam.id} onDone={reload} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded border border-line px-3 py-2"><div className="label-caps">{label}</div><div className="num text-[15px] font-medium">{value}</div></div>;
}

function Footer({ back, next, disabled, nextLabel = "Continue" }: { back?: () => void; next: () => void; disabled?: boolean; nextLabel?: string }) {
  return (
    <div className="mt-5 flex justify-between border-t border-line pt-4">
      {back ? <Button variant="ghost" onClick={back}><ArrowLeft className="h-4 w-4" /> Back</Button> : <span />}
      <Button onClick={next} disabled={disabled}>{nextLabel} <ArrowRight className="h-4 w-4" /></Button>
    </div>
  );
}

type CheckState = "pending" | "ok" | "fail" | "warn";
function CheckRow({ icon, label, state, detail }: { icon: React.ReactNode; label: string; state: CheckState; detail?: string }) {
  return (
    <li className="flex items-start gap-3 border-b border-line py-2.5 last:border-b-0">
      <span className="mt-0.5 text-ink-400">{icon}</span>
      <div className="flex-1">
        <div className="text-[13.5px] font-medium">{label}</div>
        {detail && <div className="text-[12px] text-ink-500">{detail}</div>}
      </div>
      {state === "pending" ? <Loader2 className="h-4 w-4 animate-spin text-ink-400" /> : state === "ok" ? <CheckCircle2 className="h-5 w-5 text-ok-600" /> : state === "warn" ? <Badge tone="warn">Check</Badge> : <XCircle className="h-5 w-5 text-bad-600" />}
    </li>
  );
}

function SystemCheck({ back, next, needsMedia }: { back: () => void; next: () => void; needsMedia: boolean }) {
  const [res, setRes] = useState<Record<string, { state: CheckState; detail: string }>>({});
  const run = async () => {
    const r: typeof res = {};
    const bi = browserInfo();
    r.browser = { state: bi.mobile ? "fail" : bi.supported ? "ok" : "warn", detail: bi.mobile ? "Mobile devices are not supported. Use a laptop or desktop." : `${bi.name} ${bi.version}${bi.supported ? "" : " — Chrome or Edge (latest) recommended"}` };
    r.screen = { state: window.screen.width >= 1024 ? "ok" : "fail", detail: `${window.screen.width}×${window.screen.height}${window.screen.width < 1024 ? " — a larger screen is required" : ""}` };
    const hasGum = typeof navigator.mediaDevices?.getUserMedia === "function";
    r.media = { state: !needsMedia || hasGum ? "ok" : "fail", detail: needsMedia ? (hasGum ? "Camera and microphone APIs available" : "Camera/microphone access not supported in this browser") : "Not required" };
    r.fullscreen = { state: document.fullscreenEnabled ? "ok" : "warn", detail: document.fullscreenEnabled ? "Supported" : "Fullscreen is not available in this browser" };
    setRes({ ...r, network: { state: "pending", detail: "Testing…" }, realtime: { state: "pending", detail: "Connecting…" } });
    const t0 = performance.now();
    try {
      await api("/health");
      const ms = Math.round(performance.now() - t0);
      r.network = { state: ms < 1500 ? "ok" : "warn", detail: `Server reachable · ${ms} ms` };
    } catch {
      r.network = { state: "fail", detail: "Cannot reach the examination server" };
    }
    setRes({ ...r, realtime: { state: "pending", detail: "Connecting…" } });
    const s = getSocket();
    const ok = await new Promise<boolean>((resolve) => {
      if (s.connected) return resolve(true);
      const timer = setTimeout(() => resolve(false), 6000);
      s.once("connect", () => {
        clearTimeout(timer);
        resolve(true);
      });
      s.connect();
    });
    r.realtime = { state: ok ? "ok" : "warn", detail: ok ? "Live connection established" : "Live connection blocked — your network may restrict WebSockets. You can continue, but proctoring status may be delayed." };
    setRes({ ...r });
  };
  useEffect(() => {
    run();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const failed = Object.values(res).some((x) => x.state === "fail");
  const pending = Object.values(res).some((x) => x.state === "pending") || Object.keys(res).length < 6;
  return (
    <Card title="System compatibility check" actions={<Button size="sm" variant="ghost" onClick={run}><RefreshCw className="h-3.5 w-3.5" /> Re-run</Button>}>
      <ul>
        <CheckRow icon={<MonitorCheck className="h-4 w-4" />} label="Browser" {...(res.browser ?? { state: "pending" })} />
        <CheckRow icon={<MonitorCheck className="h-4 w-4" />} label="Screen size" {...(res.screen ?? { state: "pending" })} />
        <CheckRow icon={<Camera className="h-4 w-4" />} label="Camera & microphone support" {...(res.media ?? { state: "pending" })} />
        <CheckRow icon={<Maximize className="h-4 w-4" />} label="Fullscreen" {...(res.fullscreen ?? { state: "pending" })} />
        <CheckRow icon={<Wifi className="h-4 w-4" />} label="Network" {...(res.network ?? { state: "pending" })} />
        <CheckRow icon={<Wifi className="h-4 w-4" />} label="Real-time connection" {...(res.realtime ?? { state: "pending" })} />
      </ul>
      {failed && <Alert tone="bad" className="mt-3">Fix the items marked in red before continuing.</Alert>}
      <Footer back={back} next={next} disabled={failed || pending} />
    </Card>
  );
}

function DeviceCheck({ back, next, video, audio }: { back: () => void; next: () => void; video: boolean; audio: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(!!mediaStore.stream);
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const [faces, setFaces] = useState<number | null>(null);
  const [detector, setDetector] = useState<"loading" | "ok" | "none">(video ? "loading" : "none");
  const analyzer = useRef<FaceAnalyzer | null>(null);

  const request = async () => {
    setError(null);
    try {
      stopMedia(mediaStore.stream);
      mediaStore.stream = await acquireMedia(video, audio);
      setReady(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    if (!mediaStore.stream) request();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready || !mediaStore.stream) return;
    if (ref.current && video) {
      ref.current.srcObject = mediaStore.stream;
      ref.current.play().catch(() => undefined);
    }
    const meter = new AudioMeter();
    if (audio) meter.start(mediaStore.stream);
    const t = setInterval(() => {
      const l = meter.level();
      setLevel(l);
      setPeak((p) => Math.max(p, l));
    }, 120);
    let stop = false;
    if (video) {
      analyzer.current = new FaceAnalyzer();
      analyzer.current.init().then((ok) => {
        setDetector(ok ? "ok" : "none");
        const loop = () => {
          if (stop || !ref.current) return;
          const r = analyzer.current?.analyze(ref.current, performance.now());
          if (r) setFaces(r.faceCount);
          setTimeout(loop, 400);
        };
        if (ok) loop();
      });
    }
    return () => {
      stop = true;
      clearInterval(t);
      meter.stop();
      analyzer.current?.close();
    };
  }, [ready, video, audio]);

  const camOk = !video || (ready && !!mediaStore.stream?.getVideoTracks()[0]);
  const micOk = !audio || (ready && !!mediaStore.stream?.getAudioTracks()[0]);
  const faceOk = !video || detector === "none" || faces === 1;
  return (
    <Card title="Camera & microphone">
      {error && (
        <Alert tone="bad" className="mb-3" title="We couldn't access your devices">
          {error}
          <div className="mt-2"><Button size="sm" variant="secondary" onClick={request}>Try again</Button></div>
        </Alert>
      )}
      <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
        {video && (
          <div className="relative aspect-[4/3] overflow-hidden rounded bg-navy-950">
            <video ref={ref} muted playsInline className="h-full w-full -scale-x-100 object-cover" />
            {!ready && <div className="absolute inset-0 flex items-center justify-center text-[13px] text-white/60">Waiting for camera permission…</div>}
            {ready && detector === "ok" && (
              <div className={cn("absolute left-2 top-2 rounded px-2 py-1 text-[12px] font-medium text-white", faces === 1 ? "bg-ok-600" : "bg-bad-600")}>
                {faces === null ? "Detecting…" : faces === 1 ? "Face detected" : faces === 0 ? "No face detected" : `${faces} faces detected`}
              </div>
            )}
          </div>
        )}
        <ul className="self-start">
          {video && <CheckRow icon={<Camera className="h-4 w-4" />} label="Camera" state={camOk ? "ok" : ready ? "fail" : "pending"} detail={mediaStore.stream?.getVideoTracks()[0]?.label || undefined} />}
          {audio && (
            <li className="border-b border-line py-2.5">
              <div className="flex items-center gap-3">
                <Mic className="h-4 w-4 text-ink-400" />
                <span className="flex-1 text-[13.5px] font-medium">Microphone</span>
                {micOk ? (peak > 0.05 ? <CheckCircle2 className="h-5 w-5 text-ok-600" /> : <Badge tone="warn">Say something</Badge>) : <Loader2 className="h-4 w-4 animate-spin text-ink-400" />}
              </div>
              <div className="ml-7 mt-2 h-2 overflow-hidden rounded-sm bg-canvas"><div className="h-full bg-ok-600 transition-[width] duration-100" style={{ width: `${Math.min(100, level * 250)}%` }} /></div>
              <div className="ml-7 mt-1 text-[11.5px] text-ink-500">Speak to test the level. Only the level is measured — nothing is recorded.</div>
            </li>
          )}
          {video && (
            <CheckRow
              icon={<User className="h-4 w-4" />}
              label="Face visibility"
              state={detector === "loading" ? "pending" : detector === "none" ? "warn" : faceOk ? "ok" : "fail"}
              detail={detector === "none" ? "Face detection could not load on this device. You can continue; HR will review the session manually." : faceOk ? "Exactly one face visible" : "Make sure only your face is clearly visible, in good light."}
            />
          )}
        </ul>
      </div>
      <Footer back={back} next={next} disabled={!camOk || !micOk || !faceOk} />
    </Card>
  );
}

function PhotoStep({ back, next }: { back: () => void; next: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [photo, setPhoto] = useState<string | null>(mediaStore.verificationPhoto ? URL.createObjectURL(mediaStore.verificationPhoto) : null);
  useEffect(() => {
    if (ref.current && mediaStore.stream) {
      ref.current.srcObject = mediaStore.stream;
      ref.current.play().catch(() => undefined);
    }
  }, [photo]);
  return (
    <Card title="Verification photo" subtitle="Look at the camera with your face clearly visible. This photo is shown to HR alongside your session — it is not used for automated identification.">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="relative aspect-[4/3] overflow-hidden rounded bg-navy-950">
          {photo ? <img src={photo} alt="Your verification photo" className="h-full w-full -scale-x-100 object-cover" /> : <video ref={ref} muted playsInline className="h-full w-full -scale-x-100 object-cover" />}
          {!photo && <div className="pointer-events-none absolute inset-[18%] rounded-[50%] border-2 border-dashed border-white/50" />}
        </div>
        <div className="flex flex-col justify-center gap-3">
          {!photo ? (
            <Button
              size="lg"
              onClick={async () => {
                if (!ref.current) return;
                const b = await captureFrame(ref.current, 640, 0.85);
                if (b) {
                  mediaStore.verificationPhoto = b;
                  setPhoto(URL.createObjectURL(b));
                }
              }}
            >
              <Camera className="h-4 w-4" /> Capture photo
            </Button>
          ) : (
            <>
              <Alert tone="ok">Photo captured. Make sure your face is clear and well lit.</Alert>
              <Button variant="secondary" onClick={() => { mediaStore.verificationPhoto = null; setPhoto(null); }}>
                <RefreshCw className="h-4 w-4" /> Retake
              </Button>
            </>
          )}
        </div>
      </div>
      <Footer back={back} next={next} disabled={!photo} />
    </Card>
  );
}

function EnvironmentStep({ back, onStart, requireFullscreen }: { back: () => void; onStart: () => Promise<void>; requireFullscreen: boolean }) {
  const [c, setC] = useState({ alone: false, materials: false, rules: false });
  const [busy, setBusy] = useState(false);
  const all = c.alone && c.materials && c.rules;
  return (
    <Card title="Environment check">
      <div className="space-y-3">
        <Checkbox checked={c.alone} onChange={(e) => setC({ ...c, alone: e.target.checked })} label="I am alone in a quiet, well-lit room." />
        <Checkbox checked={c.materials} onChange={(e) => setC({ ...c, materials: e.target.checked })} label="I do not have notes, books, phones or other devices within reach." />
        <Checkbox checked={c.rules} onChange={(e) => setC({ ...c, rules: e.target.checked })} label="I understand that switching tabs, leaving fullscreen and copy/paste are recorded, and that the examination submits automatically when time is up." />
      </div>
      <Alert tone="navy" className="mt-4" icon={<ShieldCheck className="h-4 w-4" />}>
        When you click <b>Start examination</b>{requireFullscreen ? ", your screen will switch to fullscreen and" : ""} the timer starts immediately. It keeps running even if you lose your connection.
      </Alert>
      <div className="mt-5 flex justify-between border-t border-line pt-4">
        <Button variant="ghost" onClick={back}><ArrowLeft className="h-4 w-4" /> Back</Button>
        <Button
          size="lg"
          variant="signal"
          disabled={!all}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            if (requireFullscreen) await enterFullscreen();
            await onStart();
            setBusy(false);
          }}
        >
          <Check className="h-4 w-4" /> Start examination
        </Button>
      </div>
    </Card>
  );
}

function AccommodationDialog({ open, onClose, examId, onDone }: { open: boolean; onClose: () => void; examId: string; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Request an alternative arrangement"
      description="HR will review your request. Describe what you need and why."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            disabled={reason.trim().length < 10}
            onClick={async () => {
              try {
                await api(`/me/exams/${examId}/accommodation`, { body: { reason } });
                toast("Request submitted");
                onClose();
                onDone();
              } catch (e) {
                toast((e as Error).message, "bad");
              }
            }}
          >
            Submit request
          </Button>
        </>
      }
    >
      <Field label="Details" hint="For example: no working webcam, a disability that needs extra time, or another accessibility need.">
        <Textarea rows={5} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Dialog>
  );
}

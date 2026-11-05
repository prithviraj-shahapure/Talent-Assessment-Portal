import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Camera, CameraOff, ClipboardCheck, Eye, EyeOff, Maximize, MessageSquare, Mic, MicOff, Send, Square, WifiOff } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { getSocket } from "@/lib/socket";
import { Alert, Badge, Button, Card, ConfirmDialog, Input, KeyValue, PageHeader, RiskBadge, Spinner, useToast } from "@/components/ui";
import { EventTimeline, type ProctorEventRow } from "@/components/proctor/EventTimeline";
import { clock, fmtDateTime } from "@/lib/format";
import type { LiveStatus } from "@/lib/types";
import { useNow } from "./LiveProctoring";
import { cn } from "@/lib/cn";

interface AttemptDetail {
  id: string;
  examId: string;
  status: string;
  startedAt: string;
  deadlineAt: string;
  submittedAt: string | null;
  riskScore: number;
  riskLevel: string;
  attemptNo: number;
  ipAddress: string | null;
  clientInfo: Record<string, unknown> | null;
  totalQuestions: number;
  exam: { id: string; title: string; durationMinutes: number; evidenceCapture: boolean; livePreview: boolean };
  candidate: { id: string; college: string; user: { name: string; email: string } };
  events: ProctorEventRow[];
  evidence: { id: string; kind: string; createdAt: string }[];
  consent: { webcam: boolean; microphone: boolean; evidence: boolean; acceptedAt: string; policyVersion: string } | null;
  live: LiveStatus | null;
}

export default function AttemptMonitor() {
  const { attemptId } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data, loading, reload, setData } = useApi<AttemptDetail>(`/proctoring/attempts/${attemptId}`, [attemptId]);
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [forceOpen, setForceOpen] = useState(false);
  const now = useNow();

  useEffect(() => {
    if (data?.live) setLive(data.live);
  }, [data?.live]);

  useEffect(() => {
    if (!attemptId || !data) return;
    const s = getSocket();
    const join = () => {
      s.emit("hr:watch", { examId: data.examId });
      s.emit("hr:watch-attempt", { attemptId });
    };
    if (s.connected) join();
    s.on("connect", join);
    const onStatus = (st: LiveStatus) => st.attemptId === attemptId && setLive(st);
    const onFrame = (f: { attemptId: string; image: string }) => f.attemptId === attemptId && setFrame(f.image);
    const onEvent = (e: { attemptId: string; id: string; type: string; severity: ProctorEventRow["severity"]; message: string; occurredAt: string; weightApplied: number; riskScore: number; riskLevel: string; hasEvidence?: boolean }) => {
      if (e.attemptId !== attemptId) return;
      setData((d) =>
        d
          ? {
              ...d,
              riskScore: e.riskScore,
              riskLevel: e.riskLevel,
              events: [...d.events, { id: e.id, type: e.type, severity: e.severity, message: e.message, occurredAt: e.occurredAt, weightApplied: e.weightApplied, evidenceId: null, reviewed: false, reviewNote: null }],
            }
          : d,
      );
      if (e.hasEvidence) setTimeout(reload, 500);
    };
    const onEnded = (e: { attemptId: string }) => e.attemptId === attemptId && reload();
    s.on("live:status", onStatus);
    s.on("live:frame", onFrame);
    s.on("live:event", onEvent);
    s.on("live:ended", onEnded);
    return () => {
      s.emit("hr:unwatch-attempt", { attemptId });
      s.off("connect", join);
      s.off("live:status", onStatus);
      s.off("live:frame", onFrame);
      s.off("live:event", onEvent);
      s.off("live:ended", onEnded);
    };
  }, [attemptId, data?.examId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !data) return <Spinner />;
  const active = data.status === "IN_PROGRESS";
  const verification = data.evidence.find((e) => e.kind === "VERIFICATION_PHOTO");
  const snapshots = data.evidence.filter((e) => e.kind === "SNAPSHOT");
  const info = (data.clientInfo ?? {}) as { userAgent?: string; screen?: string; timezone?: string };

  return (
    <div>
      <PageHeader
        back={
          <Link to="/admin/live" className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-ink-500 hover:text-ink-900">
            <ArrowLeft className="h-3.5 w-3.5" /> Live proctoring
          </Link>
        }
        title={data.candidate.user.name}
        subtitle={`${data.exam.title} · attempt ${data.attemptNo}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => nav(`/admin/attempts/${data.id}`)}>
              <ClipboardCheck className="h-4 w-4" /> Answers & evaluation
            </Button>
            {active && (
              <Button variant="danger" onClick={() => setForceOpen(true)}>
                <Square className="h-4 w-4" /> End attempt
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="space-y-5 min-w-0">
          <Card padded={false}>
            <div className="relative aspect-video bg-navy-950">
              {frame && active ? (
                <img src={frame} alt="Live preview" className="h-full w-full object-contain" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-[13px] text-white/45">
                  {active ? (live?.connected === false ? <WifiOff className="h-8 w-8" /> : <Camera className="h-8 w-8" />) : <Eye className="h-8 w-8" />}
                  {active ? (live?.connected === false ? "Candidate disconnected" : data.exam.livePreview ? "Waiting for preview frame…" : "Live preview is disabled for this examination") : "Attempt finished"}
                </div>
              )}
              {active && <div className="absolute right-3 top-3 rounded bg-black/60 px-2 py-1 font-mono text-[14px] text-white">{clock(new Date(data.deadlineAt).getTime() - now)}</div>}
            </div>
            {active && <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-5">
              <Indicator ok={live?.camera !== "OFF"} label="Camera" on={<Camera className="h-4 w-4" />} off={<CameraOff className="h-4 w-4" />} na={live?.camera === "NOT_REQUIRED"} />
              <Indicator ok={live?.microphone !== "OFF"} label="Microphone" on={<Mic className="h-4 w-4" />} off={<MicOff className="h-4 w-4" />} na={live?.microphone === "NOT_REQUIRED"} />
              <Indicator ok={!!live?.focused} label="Focus" on={<Eye className="h-4 w-4" />} off={<EyeOff className="h-4 w-4" />} />
              <Indicator ok={!!live?.fullscreen} label="Fullscreen" on={<Maximize className="h-4 w-4" />} off={<Maximize className="h-4 w-4" />} />
              <div className="bg-white px-3 py-2.5">
                <div className="label-caps">Faces</div>
                <div className={cn("num text-[15px] font-medium", live?.faceCount !== 1 && live?.faceCount !== null && "text-bad-600")}>{live?.faceCount ?? "—"}</div>
              </div>
            </div>}
          </Card>
          {active && (
            <Card title="Message the candidate" subtitle="Shown as a banner on the candidate's screen. Recorded in the audit log.">
              <form
                className="flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await api(`/proctoring/attempts/${data.id}/message`, { body: { text: msg } });
                    toast("Message sent");
                    setMsg("");
                  } catch (err) {
                    toast((err as Error).message, "bad");
                  }
                }}
              >
                <Input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="e.g. Please keep your face within the camera frame." maxLength={300} />
                <Button type="submit" disabled={msg.trim().length < 2}>
                  <Send className="h-4 w-4" />
                </Button>
              </form>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {["Please keep your face visible to the camera.", "Please return to fullscreen.", "Please do not switch tabs during the examination.", "Only you should be present in the room."].map((t) => (
                  <button key={t} onClick={() => setMsg(t)} className="rounded border border-line bg-canvas px-2 py-1 text-[12px] text-ink-700 hover:border-navy-500/40">
                    <MessageSquare className="mr-1 inline h-3 w-3" />
                    {t}
                  </button>
                ))}
              </div>
            </Card>
          )}
          <Card title="Session details">
            <KeyValue
              items={[
                ["Status", <Badge key="s" tone={active ? "ok" : "navy"}>{data.status.replace("_", " ").toLowerCase()}</Badge>],
                ["Progress", live ? `Q ${live.currentQuestion + 1} of ${live.totalQuestions} · ${live.answered} answered` : `${data.totalQuestions} questions`],
                ["Risk", <RiskBadge key="r" level={data.riskLevel} score={data.riskScore} />],
                ["Started", fmtDateTime(data.startedAt)],
                ["Deadline", fmtDateTime(data.deadlineAt)],
                ["Submitted", fmtDateTime(data.submittedAt)],
                ["IP address", data.ipAddress ?? "—"],
                ["Browser", info.userAgent ? String(info.userAgent).slice(0, 60) : "—"],
                ["Consent", data.consent ? `Webcam ${data.consent.webcam ? "✓" : "✗"} · Mic ${data.consent.microphone ? "✓" : "✗"} · Evidence ${data.consent.evidence ? "✓" : "✗"}` : "—"],
              ]}
            />
          </Card>
          <div className="grid gap-5 sm:grid-cols-2">
            <Card title="Verification photo" subtitle="Captured before the examination started. Not an identity check.">
              {verification ? <img src={`/api/proctoring/evidence/${verification.id}`} alt="Verification" className="w-full rounded border border-line" /> : <div className="text-[13px] text-ink-500">No verification photo.</div>}
            </Card>
            <Card title={`Evidence snapshots (${snapshots.length})`} subtitle={data.exam.evidenceCapture ? (data.consent?.evidence ? "Captured on flagged events" : "Candidate did not consent") : "Disabled for this examination"}>
              <div className="grid grid-cols-3 gap-1.5">
                {snapshots.slice(-9).map((s) => (
                  <a key={s.id} href={`/api/proctoring/evidence/${s.id}`} target="_blank" rel="noreferrer">
                    <img src={`/api/proctoring/evidence/${s.id}`} alt="Snapshot" className="aspect-[4/3] w-full rounded border border-line object-cover" />
                  </a>
                ))}
              </div>
            </Card>
          </div>
        </div>
        <Card
          title="Event timeline"
          subtitle={`${data.events.length} event(s) · score is advisory`}
          padded={false}
          className="h-fit"
          actions={
            data.events.some((e) => !e.reviewed && e.weightApplied > 0) && (
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  await api(`/proctoring/attempts/${data.id}/review-all`, { body: { reviewNote: "Reviewed" } });
                  toast("All events marked reviewed");
                  reload();
                }}
              >
                Mark all reviewed
              </Button>
            )
          }
        >
          <Alert tone="navy" className="m-3">Risk score {data.riskScore}/100. Points are added only after the grace count and cooldown for each event type. Review the events — do not decide on the score alone.</Alert>
          <div className="max-h-[70vh] overflow-y-auto scrollbar-thin">
            <EventTimeline events={data.events} startedAt={data.startedAt} onChange={reload} />
          </div>
        </Card>
      </div>
      <ConfirmDialog
        open={forceOpen}
        onClose={() => setForceOpen(false)}
        title="End this attempt now?"
        body="The attempt will be submitted with the answers saved so far. Use this only for a technical issue or a decision you have reviewed — never on the risk score alone."
        tone="danger"
        confirmLabel="Submit attempt"
        requireReason
        onConfirm={async (reason) => {
          await api(`/proctoring/attempts/${data.id}/force-submit`, { body: { reason } });
          toast("Attempt submitted");
          reload();
        }}
      />
    </div>
  );
}

function Indicator({ ok, label, on, off, na }: { ok: boolean; label: string; on: React.ReactNode; off: React.ReactNode; na?: boolean }) {
  return (
    <div className="bg-white px-3 py-2.5">
      <div className="label-caps">{label}</div>
      <div className={cn("mt-0.5 flex items-center gap-1.5 text-[13px] font-medium", na ? "text-ink-400" : ok ? "text-ok-600" : "text-bad-600")}>
        {ok || na ? on : off}
        {na ? "Not required" : ok ? "OK" : "Issue"}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Camera, CameraOff, Eye, EyeOff, Maximize, Mic, MicOff, MonitorPlay, Radio, Users, WifiOff } from "lucide-react";
import { api, qs } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { getSocket } from "@/lib/socket";
import { Alert, Badge, Card, EmptyState, PageHeader, RiskBadge, Select, Spinner, Tabs } from "@/components/ui";
import { clock, EVENT_LABEL, relTime } from "@/lib/format";
import type { Exam, LiveStatus } from "@/lib/types";
import { cn } from "@/lib/cn";

type Filter = "all" | "active" | "normal" | "review" | "high" | "submitted" | "disconnected";

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export default function LiveProctoring() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const examId = params.get("examId") ?? "";
  const [filter, setFilter] = useState<Filter>("all");
  const { data: exams } = useApi<Exam[]>("/exams?phase=live");
  const { data: initial, loading } = useApi<LiveStatus[]>(`/proctoring/live${qs({ examId })}`, [examId]);
  const [rows, setRows] = useState<Map<string, LiveStatus>>(new Map());
  const [frames, setFrames] = useState<Record<string, string>>({});
  const [feed, setFeed] = useState<{ attemptId: string; type: string; message: string; severity: string; at: string; name: string }[]>([]);
  const [connected, setConnected] = useState(false);
  const now = useNow();

  useEffect(() => {
    if (initial) setRows(new Map(initial.map((r) => [r.attemptId, r])));
  }, [initial]);

  useEffect(() => {
    const s = getSocket();
    const watch = () => {
      setConnected(true);
      s.emit("hr:watch", { examId: examId || undefined });
    };
    if (s.connected) watch();
    s.on("connect", watch);
    s.on("disconnect", () => setConnected(false));
    const onStatus = (st: LiveStatus) => setRows((m) => new Map(m).set(st.attemptId, { ...m.get(st.attemptId), ...st }));
    const onFrame = (f: { attemptId: string; image: string }) => setFrames((x) => ({ ...x, [f.attemptId]: f.image }));
    const onEvent = (e: { attemptId: string; type: string; message: string; severity: string; occurredAt: string; riskScore: number; riskLevel: string; weightApplied: number; multiFaceViolations?: number }) => {
      setRows((m) => {
        const cur = m.get(e.attemptId);
        if (!cur) return m;
        const n = new Map(m);
        n.set(e.attemptId, {
          ...cur,
          riskScore: e.riskScore,
          riskLevel: e.riskLevel as LiveStatus["riskLevel"],
          eventCount: cur.eventCount + 1,
          multiFaceViolations: e.multiFaceViolations !== undefined ? e.multiFaceViolations : cur.multiFaceViolations,
        });
        return n;
      });
      if (e.weightApplied > 0 || e.severity !== "INFO")
        setFeed((f) => [{ attemptId: e.attemptId, type: e.type, message: e.message, severity: e.severity, at: e.occurredAt, name: "" }, ...f].slice(0, 30));
    };
    const onEnded = (e: { attemptId: string; status: LiveStatus["status"] }) => setRows((m) => {
      const cur = m.get(e.attemptId);
      return cur ? new Map(m).set(e.attemptId, { ...cur, status: e.status, connected: false }) : m;
    });
    s.on("live:status", onStatus);
    s.on("live:frame", onFrame);
    s.on("live:event", onEvent);
    s.on("live:ended", onEnded);
    return () => {
      s.off("connect", watch);
      s.off("live:status", onStatus);
      s.off("live:frame", onFrame);
      s.off("live:event", onEvent);
      s.off("live:ended", onEnded);
    };
  }, [examId]);

  const all = useMemo(() => [...rows.values()].sort((a, b) => (a.status === "ACTIVE" ? 0 : 1) - (b.status === "ACTIVE" ? 0 : 1) || b.riskScore - a.riskScore), [rows]);
  const match = (r: LiveStatus, f: Filter) =>
    f === "all" ||
    (f === "active" && r.status === "ACTIVE") ||
    (f === "normal" && r.riskLevel === "NORMAL" && r.status === "ACTIVE") ||
    (f === "review" && (r.riskLevel === "LOW" || r.riskLevel === "MEDIUM")) ||
    (f === "high" && r.riskLevel === "HIGH") ||
    (f === "submitted" && (r.status === "SUBMITTED" || r.status === "AUTO_SUBMITTED")) ||
    (f === "disconnected" && r.status === "DISCONNECTED");
  const list = all.filter((r) => match(r, filter));
  const count = (f: Filter) => all.filter((r) => match(r, f)).length;
  const nameOf = (id: string) => rows.get(id)?.candidateName ?? "Candidate";

  return (
    <div>
      <PageHeader
        title="Live Proctoring"
        subtitle="Real-time status of candidates currently taking examinations."
        actions={
          <>
            <span className={cn("inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-[12px] font-medium", connected ? "border-ok-100 bg-ok-50 text-ok-600" : "border-bad-100 bg-bad-50 text-bad-600")}>
              <Radio className={cn("h-3.5 w-3.5", connected && "animate-pulse2")} /> {connected ? "Live" : "Reconnecting…"}
            </span>
            <Select className="w-72" value={examId} onChange={(e) => setParams(e.target.value ? { examId: e.target.value } : {})}>
              <option value="">All live examinations</option>
              {exams?.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </Select>
          </>
        }
      />
      <Alert tone="navy" className="mb-4">
        Flags and risk levels are indicators for human review, not proof of malpractice. Browser monitoring cannot detect secondary devices or virtual machines. Preview frames are low-resolution and are not stored.
      </Alert>
      <div className="grid gap-5 2xl:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <Tabs
            className="mb-4"
            value={filter}
            onChange={setFilter}
            items={[
              { value: "all", label: "All candidates", count: count("all") },
              { value: "active", label: "Active", count: count("active") },
              { value: "normal", label: "Normal", count: count("normal") },
              { value: "review", label: "Under review", count: count("review") },
              { value: "high", label: "High concern", count: count("high") },
              { value: "submitted", label: "Submitted", count: count("submitted") },
              { value: "disconnected", label: "Disconnected", count: count("disconnected") },
            ]}
          />
          {loading && !rows.size ? (
            <Spinner />
          ) : !list.length ? (
            <Card>
              <EmptyState icon={<MonitorPlay className="h-8 w-8" />} title={rows.size ? "No candidates in this view" : "No candidates are in an examination right now"} body="Candidates appear here as soon as they start an examination." />
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((r) => {
                const remaining = new Date(r.deadlineAt).getTime() - now;
                const ended = r.status === "SUBMITTED" || r.status === "AUTO_SUBMITTED";
                return (
                  <button key={r.attemptId} onClick={() => nav(`/admin/live/${r.attemptId}`)} className={cn("card overflow-hidden text-left transition-all hover:shadow-pop", r.riskLevel === "HIGH" && !ended && "border-bad-600/50 ring-1 ring-bad-600/30")}>
                    <div className="relative aspect-[4/3] bg-navy-950">
                      {frames[r.attemptId] && !ended ? (
                        <img src={frames[r.attemptId]} alt={`Live preview of ${r.candidateName}`} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-1.5 text-white/40 text-[12px]">
                          {ended ? <Eye className="h-6 w-6" /> : r.status === "DISCONNECTED" ? <WifiOff className="h-6 w-6" /> : r.previewAllowed ? <Camera className="h-6 w-6" /> : <CameraOff className="h-6 w-6" />}
                          {ended ? "Examination submitted" : r.status === "DISCONNECTED" ? "Disconnected" : r.previewAllowed ? "Waiting for preview…" : "Preview not enabled"}
                        </div>
                      )}
                      <div className="absolute left-2 top-2 flex gap-1">
                        {r.status === "ACTIVE" && <span className="rounded bg-ok-600 px-1.5 py-0.5 text-[10.5px] font-semibold text-white">LIVE</span>}
                        {r.faceCount !== null && r.faceCount !== 1 && r.status === "ACTIVE" && (
                          <span className="rounded bg-bad-600 px-1.5 py-0.5 text-[10.5px] font-semibold text-white">{r.faceCount === 0 ? "NO FACE" : `${r.faceCount} FACES`}</span>
                        )}
                      </div>
                      {!ended && (
                        <div className={cn("absolute right-2 top-2 rounded px-1.5 py-0.5 font-mono text-[12px] font-medium", remaining < 5 * 60_000 ? "bg-bad-600 text-white" : "bg-black/60 text-white")}>{clock(remaining)}</div>
                      )}
                      <div className="absolute bottom-2 left-2 flex gap-1">
                        <StatusIcon ok={r.camera !== "OFF"} na={r.camera === "NOT_REQUIRED"} on={<Camera className="h-3.5 w-3.5" />} off={<CameraOff className="h-3.5 w-3.5" />} label="Camera" />
                        <StatusIcon ok={r.microphone !== "OFF"} na={r.microphone === "NOT_REQUIRED"} on={<Mic className="h-3.5 w-3.5" />} off={<MicOff className="h-3.5 w-3.5" />} label="Microphone" />
                        <StatusIcon ok={r.focused} on={<Eye className="h-3.5 w-3.5" />} off={<EyeOff className="h-3.5 w-3.5" />} label="Focus" />
                        <StatusIcon ok={r.fullscreen} on={<Maximize className="h-3.5 w-3.5" />} off={<Maximize className="h-3.5 w-3.5" />} label="Fullscreen" />
                      </div>
                      {r.microphone === "ON" && !ended && (
                        <div className="absolute bottom-2 right-2 h-1.5 w-14 overflow-hidden rounded bg-white/20" title="Audio level">
                          <div className="h-full bg-signal-500 transition-all" style={{ width: `${Math.min(100, r.audioLevel * 300)}%` }} />
                        </div>
                      )}
                    </div>
                    <div className="px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate font-semibold text-[13.5px]">{r.candidateName}</div>
                        <RiskBadge level={r.riskLevel} score={r.riskScore} />
                      </div>
                      <div className="truncate text-[12px] text-ink-500">{r.examTitle}</div>
                      <div className="mt-2 flex items-center justify-between text-[12px] text-ink-700">
                        <span className="num">
                          Q {Math.min(r.currentQuestion + 1, r.totalQuestions)}/{r.totalQuestions} · {r.answered} answered
                        </span>
                        <div className="flex items-center gap-2">
                          {r.multiFaceViolations && r.multiFaceViolations > 0 ? (
                            <span className={cn("inline-flex items-center gap-1 num font-semibold text-[11px]", r.multiFaceViolations >= 3 ? "text-bad-600" : "text-warn-600")} title="Multiple face detections">
                              <Users className="h-3 w-3" /> Multi: {r.multiFaceViolations}/2
                            </span>
                          ) : null}
                          <span className={cn("inline-flex items-center gap-1 num", r.eventCount > 0 && "text-warn-600")}>
                            <AlertTriangle className="h-3 w-3" /> {r.eventCount}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <Card title="Event stream" subtitle="Flags as they happen" padded={false} className="h-fit 2xl:sticky 2xl:top-6">
          {!feed.length ? (
            <EmptyState icon={<Users className="h-6 w-6" />} title="No new events" body="New flags will appear here." />
          ) : (
            <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto scrollbar-thin">
              {feed.map((e, i) => (
                <li key={i} className="cursor-pointer px-3 py-2 hover:bg-navy-50/50" onClick={() => nav(`/admin/live/${e.attemptId}`)}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12.5px] font-medium">{nameOf(e.attemptId)}</span>
                    <Badge tone={e.severity === "HIGH" ? "bad" : e.severity === "MEDIUM" ? "warn" : "steel"}>{e.severity}</Badge>
                  </div>
                  <div className="text-[12px] text-ink-500">
                    {e.message ? e.message : (EVENT_LABEL[e.type] ?? e.type)} · {relTime(e.at)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function StatusIcon({ ok, na, on, off, label }: { ok: boolean; na?: boolean; on: React.ReactNode; off: React.ReactNode; label: string }) {
  if (na) return null;
  return (
    <span title={`${label}: ${ok ? "OK" : "issue"}`} className={cn("flex h-6 w-6 items-center justify-center rounded", ok ? "bg-black/55 text-white" : "bg-bad-600 text-white")}>
      {ok ? on : off}
    </span>
  );
}

export async function sendProctorMessage(attemptId: string, text: string) {
  return api(`/proctoring/attempts/${attemptId}/message`, { body: { text } });
}

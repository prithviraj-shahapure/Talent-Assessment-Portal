import { useState } from "react";
import { CheckCircle2, Circle, ImageIcon } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, Dialog, EmptyState, useToast } from "@/components/ui";
import { EVENT_LABEL, fmtTime } from "@/lib/format";
import { cn } from "@/lib/cn";

export interface ProctorEventRow {
  id: string;
  type: string;
  severity: "INFO" | "LOW" | "MEDIUM" | "HIGH";
  message: string | null;
  weightApplied: number;
  occurredAt: string;
  evidenceId: string | null;
  reviewed: boolean;
  reviewNote: string | null;
  reviewedBy?: { name: string } | null;
  meta?: Record<string, unknown> | null;
}

const sevTone = (s: string) => (s === "HIGH" ? "bad" : s === "MEDIUM" ? "warn" : s === "LOW" ? "steel" : "neutral") as "bad" | "warn" | "steel" | "neutral";

export function EventTimeline({ events, startedAt, onChange, showInfo = true }: { events: ProctorEventRow[]; startedAt: string; onChange?: () => void; showInfo?: boolean }) {
  const toast = useToast();
  const [evidence, setEvidence] = useState<string | null>(null);
  const list = showInfo ? events : events.filter((e) => e.severity !== "INFO" || e.weightApplied > 0);
  const offset = (t: string) => {
    const s = Math.max(0, Math.floor((new Date(t).getTime() - new Date(startedAt).getTime()) / 1000));
    return `+${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };
  if (!list.length) return <EmptyState title="No proctoring events" body="Nothing was flagged during this attempt." />;
  return (
    <>
      <ol className="relative">
        {list.map((e) => (
          <li key={e.id} className="relative flex gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
            <div className="w-[86px] shrink-0 pt-0.5 whitespace-nowrap">
              <div className="num text-[12px] font-medium text-ink-900">{offset(e.occurredAt)}</div>
              <div className="num text-[11px] text-ink-400">{fmtTime(e.occurredAt)}</div>
            </div>
            <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", e.severity === "HIGH" ? "bg-bad-600" : e.severity === "MEDIUM" ? "bg-warn-600" : e.severity === "LOW" ? "bg-steel-500" : "bg-ink-300")} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium">{EVENT_LABEL[e.type] ?? e.type}</span>
                <Badge tone={sevTone(e.severity)}>{e.severity.toLowerCase()}</Badge>
                {e.weightApplied > 0 ? <span className="num text-[11.5px] font-medium text-bad-600">+{e.weightApplied}</span> : <span className="text-[11.5px] text-ink-400">no points (grace / cooldown)</span>}
              </div>
              {e.message && e.message !== EVENT_LABEL[e.type] && <div className="text-[12px] text-ink-500">{e.message}</div>}
              {e.reviewNote && <div className="mt-0.5 text-[12px] text-ok-600">Reviewed{e.reviewedBy ? ` by ${e.reviewedBy.name}` : ""}: {e.reviewNote}</div>}
            </div>
            <div className="flex shrink-0 items-start gap-1">
              {e.evidenceId && (
                <Button size="sm" variant="ghost" onClick={() => setEvidence(e.evidenceId)} title="View evidence snapshot">
                  <ImageIcon className="h-3.5 w-3.5" />
                </Button>
              )}
              {onChange && (e.weightApplied > 0 || e.severity !== "INFO") && (
                <Button
                  size="sm"
                  variant="ghost"
                  title={e.reviewed ? "Reviewed" : "Mark reviewed"}
                  onClick={async () => {
                    let note: string | null = null;
                    if (!e.reviewed) note = window.prompt("Review note (optional)", "") ?? null;
                    await api(`/proctoring/events/${e.id}`, { method: "PATCH", body: { reviewed: !e.reviewed, reviewNote: e.reviewed ? null : note } });
                    toast(e.reviewed ? "Marked unreviewed" : "Event reviewed");
                    onChange();
                  }}
                >
                  {e.reviewed ? <CheckCircle2 className="h-4 w-4 text-ok-600" /> : <Circle className="h-4 w-4 text-ink-300" />}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ol>
      <Dialog open={!!evidence} onClose={() => setEvidence(null)} title="Evidence snapshot" description="Access to this image is recorded in the audit log." size="lg">
        {evidence && <img src={`/api/proctoring/evidence/${evidence}`} alt="Evidence snapshot" className="w-full rounded border border-line" />}
      </Dialog>
    </>
  );
}

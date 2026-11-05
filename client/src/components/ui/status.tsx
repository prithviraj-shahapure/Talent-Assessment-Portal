import { Badge } from "./feedback";
import { STAGE_LABEL } from "@/lib/format";
import type { PipelineStage, RiskLevel } from "@/lib/types";
import { cn } from "@/lib/cn";

export function RiskBadge({ level, score }: { level: RiskLevel | string; score?: number }) {
  const map: Record<string, { tone: "ok" | "steel" | "warn" | "bad"; label: string }> = {
    NORMAL: { tone: "ok", label: "Normal" },
    LOW: { tone: "steel", label: "Low concern" },
    MEDIUM: { tone: "warn", label: "Medium concern" },
    HIGH: { tone: "bad", label: "High concern" },
  };
  const m = map[level] ?? map.NORMAL;
  return (
    <Badge tone={m.tone} dot>
      {m.label}
      {score !== undefined && <span className="num opacity-80">· {score}</span>}
    </Badge>
  );
}

export function StageBadge({ stage }: { stage: PipelineStage }) {
  const tone = stage === "SELECTED" ? "ok" : stage === "REJECTED" ? "bad" : stage === "SHORTLISTED" || stage === "INTERVIEW" ? "signal" : stage === "EVALUATION" || stage === "EXAM_COMPLETED" ? "steel" : "neutral";
  return <Badge tone={tone}>{STAGE_LABEL[stage]}</Badge>;
}

export function ExamStatusBadge({ status, startAt, endAt }: { status: string; startAt: string; endAt: string }) {
  if (status === "DRAFT") return <Badge tone="neutral">Draft</Badge>;
  if (status === "ARCHIVED") return <Badge tone="neutral">Archived</Badge>;
  const now = Date.now();
  if (now < new Date(startAt).getTime()) return <Badge tone="navy">Scheduled</Badge>;
  if (now > new Date(endAt).getTime()) return <Badge tone="neutral">Closed</Badge>;
  return (
    <Badge tone="ok" dot>
      Live
    </Badge>
  );
}

export function Dot({ on, warn, className, title }: { on: boolean; warn?: boolean; className?: string; title?: string }) {
  return <span title={title} className={cn("inline-block h-2 w-2 rounded-full", on ? (warn ? "bg-warn-600" : "bg-ok-600") : "bg-bad-600", className)} />;
}

export function ResultBadge({ passed, pending }: { passed: boolean | null; pending?: boolean }) {
  if (pending || passed === null) return <Badge tone="warn">Pending</Badge>;
  return passed ? <Badge tone="ok">Pass</Badge> : <Badge tone="bad">Fail</Badge>;
}

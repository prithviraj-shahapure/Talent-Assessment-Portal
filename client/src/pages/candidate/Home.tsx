import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CalendarClock, CheckCircle2, Clock, FileText, KeyRound, PlayCircle, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/lib/auth";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Spinner, useToast } from "@/components/ui";
import { fmtDateTime, fmtPct } from "@/lib/format";

interface MyExam {
  exam: { id: string; title: string; description: string | null; position: string | null; startAt: string; endAt: string; durationMinutes: number; totalMarks: number; maxAttempts: number; department: { name: string } | null };
  phase: "UPCOMING" | "OPEN" | "CLOSED";
  attemptsUsed: number;
  attemptsAllowed: number;
  inProgressAttemptId: string | null;
  canStart: boolean;
  attempts: { id: string; attemptNo: number; status: string; submittedAt: string | null; resultVisible: boolean; score?: number | null; maxScore?: number | null; percentage?: number | null; passed?: boolean | null }[];
}

export default function CandidateHome() {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { data, loading, reload } = useApi<MyExam[]>("/me/exams");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const open = data?.filter((d) => d.phase === "OPEN") ?? [];
  const upcoming = data?.filter((d) => d.phase === "UPCOMING") ?? [];
  const closed = data?.filter((d) => d.phase === "CLOSED") ?? [];

  return (
    <div>
      <PageHeader eyebrow="Candidate portal" title={`Welcome, ${user?.name.split(" ")[0]}`} subtitle="Your assigned examinations and results." />
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5 min-w-0">
          {loading ? (
            <Spinner />
          ) : !data?.length ? (
            <Card>
              <EmptyState icon={<FileText className="h-8 w-8" />} title="No examinations assigned yet" body="Enter the invitation code from your invitation email or campus notice to register for an examination." />
            </Card>
          ) : (
            <>
              {open.length > 0 && <Section title="Open now">{open.map((e) => <ExamCard key={e.exam.id} e={e} onOpen={() => nav(`/candidate/exams/${e.exam.id}`)} onResult={(id) => nav(`/candidate/results/${id}`)} />)}</Section>}
              {upcoming.length > 0 && <Section title="Upcoming">{upcoming.map((e) => <ExamCard key={e.exam.id} e={e} onOpen={() => nav(`/candidate/exams/${e.exam.id}`)} onResult={(id) => nav(`/candidate/results/${id}`)} />)}</Section>}
              {closed.length > 0 && <Section title="Past examinations">{closed.map((e) => <ExamCard key={e.exam.id} e={e} onOpen={() => nav(`/candidate/exams/${e.exam.id}`)} onResult={(id) => nav(`/candidate/results/${id}`)} />)}</Section>}
            </>
          )}
        </div>
        <div className="space-y-5">
          <Card title="Have an invitation code?">
            <form
              className="space-y-2"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  const r = await api<{ title: string; alreadyAssigned: boolean }>("/me/redeem", { body: { code } });
                  toast(r.alreadyAssigned ? `You are already registered for ${r.title}` : `Registered for ${r.title}`);
                  setCode("");
                  reload();
                } catch (err) {
                  toast((err as Error).message, "bad");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Input className="font-mono uppercase" placeholder="e.g. GET-MECH-2026" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
              <Button type="submit" className="w-full" loading={busy} disabled={code.trim().length < 4}>
                <KeyRound className="h-4 w-4" /> Apply code
              </Button>
            </form>
          </Card>
          <Card title="Before your examination">
            <ul className="space-y-2.5 text-[13px] text-ink-700">
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok-600" /> Use a laptop or desktop with Chrome or Edge.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok-600" /> Keep a working webcam and microphone connected.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok-600" /> Sit alone in a quiet, well-lit room with a stable internet connection.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok-600" /> Close other applications that use the camera (Teams, Zoom).</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="label-caps mb-2">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ExamCard({ e, onOpen, onResult }: { e: MyExam; onOpen: () => void; onResult: (id: string) => void }) {
  const last = e.attempts[0];
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {e.phase === "OPEN" ? <Badge tone="ok" dot>Open</Badge> : e.phase === "UPCOMING" ? <Badge tone="navy">Upcoming</Badge> : <Badge>Closed</Badge>}
            {e.exam.department && <span className="text-[12px] text-ink-500">{e.exam.department.name}</span>}
          </div>
          <h3 className="mt-1.5 text-[16px] font-semibold">{e.exam.title}</h3>
          {e.exam.position && <div className="text-[13px] text-ink-500">{e.exam.position}</div>}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-700">
            <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5 text-ink-400" /> {fmtDateTime(e.exam.startAt)} – {fmtDateTime(e.exam.endAt)}</span>
            <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5 text-ink-400" /> {e.exam.durationMinutes} min</span>
            <span className="num">{e.exam.totalMarks} marks</span>
            <span>Attempts {e.attemptsUsed}/{e.attemptsAllowed}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          {e.inProgressAttemptId ? (
            <Button variant="signal" onClick={onOpen}><RotateCcw className="h-4 w-4" /> Resume examination</Button>
          ) : e.canStart ? (
            <Button onClick={onOpen}><PlayCircle className="h-4 w-4" /> Start examination</Button>
          ) : e.phase === "UPCOMING" ? (
            <Button variant="secondary" onClick={onOpen}>View details <ArrowRight className="h-4 w-4" /></Button>
          ) : null}
        </div>
      </div>
      {last && last.status !== "IN_PROGRESS" && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-canvas/60 px-4 py-2.5 text-[13px]">
          <span className="text-ink-700">Submitted {fmtDateTime(last.submittedAt)}</span>
          {last.resultVisible ? (
            <span className="flex items-center gap-3">
              <span className="num font-medium">{last.score}/{last.maxScore} · {fmtPct(last.percentage)}</span>
              {last.passed ? <Badge tone="ok">Qualified</Badge> : <Badge tone="neutral">Not qualified</Badge>}
              <Button size="sm" variant="secondary" onClick={() => onResult(last.id)}>View result</Button>
            </span>
          ) : (
            <span className="text-ink-500">Result not yet released</span>
          )}
        </div>
      )}
    </div>
  );
}



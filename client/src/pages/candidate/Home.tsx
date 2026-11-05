import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CalendarClock, CheckCircle2, Clock, Compass, FileText, KeyRound, PlayCircle, RotateCcw, Search } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/lib/auth";
import { Alert, Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Spinner, useToast } from "@/components/ui";
import { BrandMark } from "@/components/Brand";
import { fmtDateTime, fmtPct } from "@/lib/format";
import { cn } from "@/lib/cn";

interface MyExam {
  exam: {
    id: string;
    title: string;
    description: string | null;
    position: string | null;
    startAt: string;
    endAt: string;
    durationMinutes: number;
    totalMarks: number;
    maxAttempts: number;
    department: { name: string } | null;
  };
  phase: "UPCOMING" | "OPEN" | "CLOSED";
  attemptsUsed: number;
  attemptsAllowed: number;
  inProgressAttemptId: string | null;
  canStart: boolean;
  attempts: {
    id: string;
    attemptNo: number;
    status: string;
    submittedAt: string | null;
    resultVisible: boolean;
    score?: number | null;
    maxScore?: number | null;
    percentage?: number | null;
    passed?: boolean | null;
  }[];
}

interface AvailableExam {
  id: string;
  title: string;
  description: string | null;
  position: string | null;
  department: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  totalMarks: number;
  passingMarks: number;
  maxAttempts: number;
  isAssigned: boolean;
  attemptsUsed: number;
  phase: "UPCOMING" | "OPEN" | "CLOSED";
}

export default function CandidateHome() {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<"my" | "available">("my");
  const { data: myExams, loading: loadingMy, reload: reloadMy } = useApi<MyExam[]>("/me/exams");
  const { data: availableExams, loading: loadingAvail, reload: reloadAvail } = useApi<AvailableExam[]>("/me/available-exams");

  // Sidebar direct session code entry
  const [quickCode, setQuickCode] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);

  // Apply modal state
  const [selectedExam, setSelectedExam] = useState<AvailableExam | null>(null);
  const [applyCode, setApplyCode] = useState("");
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const openExams = myExams?.filter((d) => d.phase === "OPEN") ?? [];
  const upcomingExams = myExams?.filter((d) => d.phase === "UPCOMING") ?? [];
  const closedExams = myExams?.filter((d) => d.phase === "CLOSED") ?? [];

  const handleApplySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExam || !applyCode.trim()) return;

    setApplyBusy(true);
    setApplyError(null);
    try {
      await api<{ ok: boolean; examId: string }>("/me/apply", {
        body: { examId: selectedExam.id, sessionCode: applyCode.trim() },
      });
      toast("Session code verified! Proceeding to examination...", "ok");
      const targetExamId = selectedExam.id;
      setSelectedExam(null);
      setApplyCode("");
      await Promise.all([reloadMy(), reloadAvail()]);
      nav(`/candidate/exams/${targetExamId}`);
    } catch (err) {
      setApplyError((err as Error).message || "Verification failed. Please check the session code.");
    } finally {
      setApplyBusy(false);
    }
  };

  const handleQuickCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickCode.trim()) return;

    setQuickBusy(true);
    try {
      const r = await api<{ examId?: string; title: string; alreadyAssigned: boolean }>("/me/redeem", {
        body: { code: quickCode.trim() },
      });
      toast(r.alreadyAssigned ? `You are registered for ${r.title}` : `Successfully registered for ${r.title}`, "ok");
      setQuickCode("");
      await Promise.all([reloadMy(), reloadAvail()]);
      if (r.examId) {
        nav(`/candidate/exams/${r.examId}`);
      }
    } catch (err) {
      toast((err as Error).message || "Invalid session code", "bad");
    } finally {
      setQuickBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Candidate Portal"
        title={`Welcome, ${user?.name.split(" ")[0] || "Candidate"}`}
        subtitle="Manage your examination registrations, browse available drives, and start assessments."
      />

      {/* Tabs */}
      <div className="mb-6 flex border-b border-line">
        <button
          type="button"
          onClick={() => setActiveTab("my")}
          className={cn(
            "flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-medium transition-colors",
            activeTab === "my"
              ? "border-navy-900 text-navy-950 font-semibold"
              : "border-transparent text-ink-500 hover:border-line hover:text-ink-800"
          )}
        >
          <span>My Examinations</span>
          {myExams && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-semibold",
                activeTab === "my" ? "bg-navy-900 text-white" : "bg-sand-200 text-ink-700"
              )}
            >
              {myExams.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("available")}
          className={cn(
            "flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-medium transition-colors",
            activeTab === "available"
              ? "border-navy-900 text-navy-950 font-semibold"
              : "border-transparent text-ink-500 hover:border-line hover:text-ink-800"
          )}
        >
          <Compass className="h-4 w-4" />
          <span>Browse Available Examinations</span>
          {availableExams && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-semibold",
                activeTab === "available" ? "bg-navy-900 text-white" : "bg-sand-200 text-ink-700"
              )}
            >
              {availableExams.length}
            </span>
          )}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Main Content Area */}
        <div className="space-y-6 min-w-0">
          {activeTab === "my" ? (
            /* Tab 1: My Assigned Examinations */
            loadingMy ? (
              <div className="py-12 flex justify-center"><Spinner /></div>
            ) : !myExams?.length ? (
              <Card className="p-8 text-center">
                <EmptyState
                  icon={<FileText className="h-8 w-8 text-ink-400" />}
                  title="No examinations assigned yet"
                  body="Browse available examinations to apply with your Session Code, or enter an examination session code directly."
                  action={
                    <Button variant="primary" onClick={() => setActiveTab("available")}>
                      <Compass className="h-4 w-4 mr-1.5" /> Browse Available Examinations
                    </Button>
                  }
                />
              </Card>
            ) : (
              <>
                {openExams.length > 0 && (
                  <Section title="Open Now">
                    {openExams.map((e) => (
                      <MyExamCard
                        key={e.exam.id}
                        e={e}
                        onOpen={() => nav(`/candidate/exams/${e.exam.id}`)}
                        onResult={(id) => nav(`/candidate/results/${id}`)}
                      />
                    ))}
                  </Section>
                )}
                {upcomingExams.length > 0 && (
                  <Section title="Upcoming">
                    {upcomingExams.map((e) => (
                      <MyExamCard
                        key={e.exam.id}
                        e={e}
                        onOpen={() => nav(`/candidate/exams/${e.exam.id}`)}
                        onResult={(id) => nav(`/candidate/results/${id}`)}
                      />
                    ))}
                  </Section>
                )}
                {closedExams.length > 0 && (
                  <Section title="Past Examinations">
                    {closedExams.map((e) => (
                      <MyExamCard
                        key={e.exam.id}
                        e={e}
                        onOpen={() => nav(`/candidate/exams/${e.exam.id}`)}
                        onResult={(id) => nav(`/candidate/results/${id}`)}
                      />
                    ))}
                  </Section>
                )}
              </>
            )
          ) : (
            /* Tab 2: Browse Available Examinations */
            loadingAvail ? (
              <div className="py-12 flex justify-center"><Spinner /></div>
            ) : !availableExams?.length ? (
              <Card className="p-8 text-center">
                <EmptyState
                  icon={<Search className="h-8 w-8 text-ink-400" />}
                  title="No public examinations scheduled"
                  body="There are no published examinations open for self-application at this time. If you received a session code via email, enter it in the session code box."
                />
              </Card>
            ) : (
              <div className="space-y-4">
                {availableExams.map((exam) => (
                  <AvailableExamCard
                    key={exam.id}
                    exam={exam}
                    onApply={() => {
                      setSelectedExam(exam);
                      setApplyCode("");
                      setApplyError(null);
                    }}
                    onOpen={() => nav(`/candidate/exams/${exam.id}`)}
                  />
                ))}
              </div>
            )
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          <Card className="p-5 shadow-sm border-t-2 border-t-navy-900">
            <div className="flex items-center gap-2 mb-2 font-semibold text-navy-950 text-sm">
              <KeyRound className="h-4 w-4 text-navy-800" />
              <span>Enter Session Code</span>
            </div>
            <p className="text-xs text-ink-500 mb-3">
              Received a test invitation code from Zanvar HR? Apply it here to unlock your exam.
            </p>
            <form onSubmit={handleQuickCodeSubmit} className="space-y-3">
              <Input
                className="font-mono text-sm uppercase font-medium h-10"
                placeholder="E.G. ZG-TECH-8472"
                value={quickCode}
                onChange={(e) => setQuickCode(e.target.value.toUpperCase())}
                required
              />
              <Button
                type="submit"
                size="sm"
                className="w-full bg-navy-900 hover:bg-navy-800 text-white font-medium"
                loading={quickBusy}
                disabled={quickCode.trim().length < 3}
              >
                Verify & Register
              </Button>
            </form>
          </Card>

          <Card title="Candidate Checklist" className="p-5">
            <ul className="space-y-2.5 text-[12.5px] text-ink-700">
              <li className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok-600" />
                <span>Use a laptop or desktop computer running Chrome or Edge.</span>
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok-600" />
                <span>Ensure your webcam and microphone are connected and allowed.</span>
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok-600" />
                <span>Sit in a quiet, well-lit room with an unobstructed face view.</span>
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok-600" />
                <span>Close any screen sharing or background communication software.</span>
              </li>
            </ul>
          </Card>
        </div>
      </div>

      {/* Apply for Test Modal */}
      <Dialog
        open={!!selectedExam}
        onClose={() => {
          setSelectedExam(null);
          setApplyError(null);
        }}
        size="md"
        title={
          <div className="flex items-center gap-2.5">
            <BrandMark className="h-6 w-6" />
            <span className="font-bold text-navy-900 text-base">Apply for Examination</span>
          </div>
        }
      >
        {selectedExam && (
          <form onSubmit={handleApplySubmit} className="space-y-4 pt-1">
            <div className="rounded-lg border border-line bg-canvas p-3.5 text-xs space-y-1">
              <div className="text-ink-500 font-medium">{selectedExam.department}</div>
              <div className="text-sm font-semibold text-navy-950">{selectedExam.title}</div>
              {selectedExam.position && <div className="text-ink-600">{selectedExam.position}</div>}
              <div className="pt-1.5 flex flex-wrap gap-x-4 text-ink-600">
                <span>Duration: <strong>{selectedExam.durationMinutes} min</strong></span>
                <span>Marks: <strong>{selectedExam.totalMarks}</strong></span>
                <span>Pass: <strong>{selectedExam.passingMarks}</strong></span>
              </div>
            </div>

            <p className="text-xs text-ink-600">
              Please enter the examination session code assigned for this recruitment drive to confirm your eligibility.
            </p>

            {applyError && (
              <Alert tone="bad" className="text-xs">
                {applyError}
              </Alert>
            )}

            <Field label="Examination Session Code">
              <Input
                className="font-mono text-sm uppercase font-semibold tracking-wider h-11 pl-3"
                placeholder="E.G. ZG-TECH-8472"
                value={applyCode}
                onChange={(e) => setApplyCode(e.target.value.toUpperCase())}
                required
                autoFocus
              />
            </Field>

            <div className="flex justify-end gap-2 pt-3 border-t border-line">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSelectedExam(null);
                  setApplyError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="bg-navy-900 hover:bg-navy-800 text-white font-medium"
                loading={applyBusy}
                disabled={!applyCode.trim()}
              >
                Verify & Continue <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="label-caps mb-2.5 text-xs text-ink-500 tracking-wider font-semibold">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function MyExamCard({
  e,
  onOpen,
  onResult,
}: {
  e: MyExam;
  onOpen: () => void;
  onResult: (id: string) => void;
}) {
  const last = e.attempts[0];
  return (
    <div className="card overflow-hidden border border-line shadow-sm hover:border-line-strong transition-colors">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {e.phase === "OPEN" ? (
              <Badge tone="ok" dot>Open Now</Badge>
            ) : e.phase === "UPCOMING" ? (
              <Badge tone="navy">Upcoming</Badge>
            ) : (
              <Badge>Closed</Badge>
            )}
            {e.exam.department && <span className="text-[12px] text-ink-500">{e.exam.department.name}</span>}
          </div>
          <h3 className="mt-1.5 text-[15.5px] font-semibold text-navy-950">{e.exam.title}</h3>
          {e.exam.position && <div className="text-[12.5px] text-ink-500">{e.exam.position}</div>}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-600">
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="h-3.5 w-3.5 text-ink-400" /> {fmtDateTime(e.exam.startAt)} – {fmtDateTime(e.exam.endAt)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-ink-400" /> {e.exam.durationMinutes} min
            </span>
            <span className="num">{e.exam.totalMarks} marks</span>
            <span>Attempts {e.attemptsUsed}/{e.attemptsAllowed}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          {e.inProgressAttemptId ? (
            <Button variant="signal" size="sm" onClick={onOpen}>
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Resume Examination
            </Button>
          ) : e.canStart ? (
            <Button size="sm" className="bg-navy-900 hover:bg-navy-800 text-white" onClick={onOpen}>
              <PlayCircle className="h-3.5 w-3.5 mr-1.5" /> Start Examination
            </Button>
          ) : e.phase === "UPCOMING" ? (
            <Button variant="secondary" size="sm" onClick={onOpen}>
              View Details <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={onOpen}>
              View Details
            </Button>
          )}
        </div>
      </div>
      {last && last.status !== "IN_PROGRESS" && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-canvas/60 px-4 py-2 text-[12.5px]">
          <span className="text-ink-600">Submitted {fmtDateTime(last.submittedAt)}</span>
          {last.resultVisible ? (
            <span className="flex items-center gap-3">
              <span className="num font-medium text-navy-950">
                {last.score}/{last.maxScore} · {fmtPct(last.percentage)}
              </span>
              {last.passed ? <Badge tone="ok">Qualified</Badge> : <Badge tone="neutral">Not Qualified</Badge>}
              <Button size="sm" variant="secondary" onClick={() => onResult(last.id)}>
                View Result
              </Button>
            </span>
          ) : (
            <span className="text-ink-500">Result under evaluation</span>
          )}
        </div>
      )}
    </div>
  );
}

function AvailableExamCard({
  exam,
  onApply,
  onOpen,
}: {
  exam: AvailableExam;
  onApply: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="card p-4 border border-line shadow-sm hover:border-line-strong transition-colors flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {exam.phase === "OPEN" ? (
            <Badge tone="ok" dot>Open for Assessment</Badge>
          ) : (
            <Badge tone="navy">Upcoming Drive</Badge>
          )}
          <span className="text-[12px] text-ink-500">{exam.department}</span>
        </div>
        <h3 className="mt-1.5 text-[15.5px] font-semibold text-navy-950">{exam.title}</h3>
        {exam.position && <div className="text-[12.5px] text-ink-500">{exam.position}</div>}
        {exam.description && (
          <p className="mt-1 text-xs text-ink-600 line-clamp-2 max-w-2xl">{exam.description}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-600">
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="h-3.5 w-3.5 text-ink-400" /> {fmtDateTime(exam.startAt)} – {fmtDateTime(exam.endAt)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-ink-400" /> {exam.durationMinutes} min
          </span>
          <span className="num">{exam.totalMarks} marks</span>
          <span>Passing: {exam.passingMarks}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center">
        {exam.isAssigned ? (
          <Button variant="secondary" size="sm" onClick={onOpen}>
            Go to Examination <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        ) : (
          <Button
            size="sm"
            className="bg-navy-900 hover:bg-navy-800 text-white font-medium shadow-sm"
            onClick={onApply}
          >
            Apply for Test <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

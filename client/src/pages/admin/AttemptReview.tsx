import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Camera, Check, Download, Layers, MonitorPlay, X } from "lucide-react";
import { api, download } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { Alert, Badge, Button, Card, Input, PageHeader, ResultBadge, RiskBadge, Spinner, StageBadge, Tabs, Textarea, useToast } from "@/components/ui";
import { EventTimeline, type ProctorEventRow } from "@/components/proctor/EventTimeline";
import { EVENT_LABEL, fmtDateTime, fmtDuration, fmtPct, QUESTION_TYPE_LABEL } from "@/lib/format";
import type { PipelineStage, QuestionType } from "@/lib/types";
import { cn } from "@/lib/cn";

interface ReviewQ {
  number: number;
  questionId: string;
  answerId: string | null;
  type: QuestionType;
  text: string;
  category: string | null;
  marks: number;
  negativeMarks: number;
  explanation: string | null;
  acceptedAnswers: string[];
  numericTolerance: number | null;
  codeLanguage: string | null;
  options: { id: string; text: string; isCorrect: boolean; selected: boolean }[];
  textAnswer: string | null;
  markedForReview: boolean;
  isCorrect: boolean | null;
  marksAwarded: number | null;
  autoGraded: boolean;
  evaluator: string | null;
  evaluatorNote: string | null;
  needsManual: boolean;
}
interface Review {
  id: string;
  status: string;
  attemptNo: number;
  startedAt: string;
  submittedAt: string | null;
  score: number | null;
  maxScore: number | null;
  percentage: number | null;
  passed: boolean | null;
  needsManualEval: boolean;
  submissionMethod?: string | null;
  riskScore: number;
  riskLevel: string;
  timeTakenSec: number | null;
  exam: { id: string; title: string; passingMarks: number; negativeMarking: boolean; resultsReleased: boolean };
  candidate: { id: string; college: string; degree: string; branch: string; stage: PipelineStage; user: { name: string; email: string } };
  sections: { title: string; score: number; max: number; questions: ReviewQ[] }[];
}

export default function AttemptReview() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<"answers" | "proctoring">(params.get("tab") === "proctoring" ? "proctoring" : "answers");
  const [filter, setFilter] = useState<"all" | "manual" | "wrong">(params.get("grade") ? "manual" : "all");
  const { data: r, loading, reload } = useApi<Review>(`/evaluation/attempts/${id}`, [id]);
  const { data: proctor, reload: reloadP } = useApi<{ events: ProctorEventRow[]; startedAt: string }>(`/proctoring/attempts/${id}`, [id]);
  if (loading || !r) return <Spinner />;
  const all = r.sections.flatMap((s) => s.questions.map((q) => ({ ...q, section: s.title })));
  const pending = all.filter((q) => q.needsManual && q.marksAwarded === null).length;
  const shown = all.filter((q) => filter === "all" || (filter === "manual" && (q.needsManual || q.evaluator)) || (filter === "wrong" && q.isCorrect === false));

  return (
    <div>
      <PageHeader
        back={
          <button onClick={() => nav(-1)} className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-ink-500 hover:text-ink-900">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
        }
        title={
          <span>
            <Link to={`/admin/candidates/${r.candidate.id}`} className="hover:underline">{r.candidate.user.name}</Link>
          </span>
        }
        subtitle={`${r.exam.title} · attempt ${r.attemptNo} · ${r.status.replace("_", " ").toLowerCase()}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => nav(`/admin/live/${r.id}`)}>
              <MonitorPlay className="h-4 w-4" /> Proctoring view
            </Button>
            <Button variant="secondary" onClick={() => download(`/reports/attempts/${r.id}/pdf`, "candidate-report.pdf").catch((e) => toast(e.message, "bad"))}>
              <Download className="h-4 w-4" /> PDF report
            </Button>
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Metric label="Score" value={`${r.score ?? 0} / ${r.maxScore ?? 0}`} />
        <Metric label="Percentage" value={fmtPct(r.percentage)} />
        <Metric label="Result" value={<ResultBadge passed={r.passed} pending={r.needsManualEval} />} />
        <Metric label="Time taken" value={fmtDuration(r.timeTakenSec)} />
        <Metric label="Proctoring" value={<RiskBadge level={r.riskLevel} score={r.riskScore} />} />
        <Metric label="Stage" value={<StageBadge stage={r.candidate.stage} />} />
      </div>
      {pending > 0 && <Alert tone="warn" className="mb-4" title={`${pending} answer(s) need manual evaluation`}>Award marks below. The result is finalised once every answer has been graded.</Alert>}
      {r.submissionMethod === "AUTO_SUBMITTED_VIOLATION" && (
        <Alert tone="bad" className="mb-4" title="Auto-Submitted: Strict Anti-Malpractice Violation Limit Reached">
          This examination was auto-submitted because the candidate reached the maximum violation limit (2 tab switches or 2 screenshot attempts). All answers saved prior to the event were preserved for evaluation.
        </Alert>
      )}

      <div className="grid gap-5 xl:grid-cols-[260px_1fr]">
        <Card title="Section-wise" className="h-fit">
          <div className="space-y-3">
            {r.sections.map((s) => (
              <div key={s.title}>
                <div className="flex justify-between text-[12.5px]">
                  <span className="font-medium">{s.title}</span>
                  <span className="num">{s.score}/{s.max}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-sm bg-canvas">
                  <div className="h-1.5 rounded-sm bg-navy-700" style={{ width: `${s.max ? Math.max(0, (s.score / s.max) * 100) : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-line pt-3 text-[12px] text-ink-500 space-y-1">
            <div>Correct: <b className="num text-ok-600">{all.filter((q) => q.isCorrect).length}</b></div>
            <div>Incorrect: <b className="num text-bad-600">{all.filter((q) => q.isCorrect === false && (q.textAnswer || q.options.some((o) => o.selected))).length}</b></div>
            <div>Unanswered: <b className="num">{all.filter((q) => !q.textAnswer && !q.options.some((o) => o.selected)).length}</b></div>
            <div>Submitted: {fmtDateTime(r.submittedAt)}</div>
          </div>
        </Card>
        <div className="min-w-0">
          <Tabs
            className="mb-4"
            value={tab}
            onChange={setTab}
            items={[
              { value: "answers", label: "Question-wise evaluation", count: all.length },
              { value: "proctoring", label: "Proctoring timeline", count: proctor?.events.length },
            ]}
          />
          {tab === "answers" ? (
            <>
              <div className="mb-3 flex gap-1.5">
                {(["all", "manual", "wrong"] as const).map((f) => (
                  <button key={f} onClick={() => setFilter(f)} className={cn("rounded border px-2.5 py-1 text-[12.5px]", filter === f ? "border-navy-900 bg-navy-900 text-white" : "border-line bg-white")}>
                    {f === "all" ? "All questions" : f === "manual" ? "Manual evaluation" : "Incorrect"}
                  </button>
                ))}
              </div>
              <div className="space-y-3">
                {shown.map((q) => (
                  <QuestionReview key={q.questionId} q={q} section={q.section} onGraded={reload} />
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-4">
              {/* TAB SWITCHING VIOLATIONS CARD */}
              {(() => {
                const tabEvents = proctor?.events.filter((e) => e.type === "TAB_SWITCH") ?? [];
                if (tabEvents.length > 0) {
                  return (
                    <Card className={cn("border-l-4", tabEvents.length >= 2 ? "border-l-bad-600 bg-bad-50/20" : "border-l-amber-500 bg-amber-50/20")}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", tabEvents.length >= 2 ? "bg-bad-100 text-bad-700" : "bg-amber-100 text-amber-800")}>
                            <Layers className="h-5 w-5" />
                          </div>
                          <div>
                            <h3 className="text-[14.5px] font-semibold text-navy-950">
                              Tab Switching Violations ({tabEvents.length} recorded{tabEvents.length >= 2 ? " — Threshold Reached" : ""})
                            </h3>
                            <p className="text-[12px] text-ink-500">
                              Page visibility loss and tab switching events recorded during the assessment.
                            </p>
                          </div>
                        </div>
                        <Badge tone={tabEvents.length >= 2 ? "bad" : "warn"} className="font-semibold">
                          {tabEvents.length}/2 {tabEvents.length >= 2 ? "Limit Exceeded" : "Recorded"}
                        </Badge>
                      </div>

                      <div className="mt-3 divide-y divide-line rounded border border-line bg-white">
                        {tabEvents.map((ev) => (
                          <div key={ev.id} className="flex items-center justify-between p-3 text-[12.5px]">
                            <div className="space-y-0.5">
                              <div className="font-medium text-navy-950 flex items-center gap-2">
                                <span>{EVENT_LABEL[ev.type] ?? ev.type}</span>
                                <Badge tone={ev.severity === "HIGH" ? "bad" : "warn"}>{ev.severity}</Badge>
                              </div>
                              <div className="text-[12px] text-ink-500">{ev.message || "Candidate switched away from the examination tab"}</div>
                            </div>
                            <div className="text-right text-[11.5px] text-ink-500 num">
                              {fmtDateTime(ev.occurredAt)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  );
                }
                return (
                  <div className="rounded-lg border border-line bg-sand-50/60 p-3.5 text-[12.5px] text-ink-600 flex items-center gap-2.5">
                    <Layers className="h-4 w-4 text-ok-600 shrink-0" />
                    <span><b>Tab Integrity:</b> Clean session — 0 tab switching or window minimization events detected.</span>
                  </div>
                );
              })()}

              {(() => {
                const screenshotEvents = proctor?.events.filter((e) =>
                  ["SCREENSHOT_ATTEMPT", "SNIPPING_TOOL_DETECTED", "SCREEN_CAPTURE_DETECTED"].includes(e.type)
                ) ?? [];
                if (screenshotEvents.length > 0) {
                  return (
                    <Card className="border-l-4 border-l-bad-600 bg-bad-50/20">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-bad-100 text-bad-700">
                            <Camera className="h-5 w-5" />
                          </div>
                          <div>
                            <h3 className="text-[14.5px] font-semibold text-bad-950">
                              Screenshot & Screen Capture Violations ({screenshotEvents.length} flagged)
                            </h3>
                            <p className="text-[12px] text-ink-500">
                              Reviewable security indicators recorded during examination execution.
                            </p>
                          </div>
                        </div>
                        <Badge tone="bad" className="font-semibold">{screenshotEvents.length} Event{screenshotEvents.length > 1 ? "s" : ""}</Badge>
                      </div>

                      <div className="mt-3 divide-y divide-line rounded border border-line bg-white">
                        {screenshotEvents.map((ev) => (
                          <div key={ev.id} className="flex items-center justify-between p-3 text-[12.5px]">
                            <div className="space-y-0.5">
                              <div className="font-medium text-navy-950 flex items-center gap-2">
                                <span>{EVENT_LABEL[ev.type] ?? ev.type}</span>
                                <Badge tone={ev.severity === "HIGH" ? "bad" : "warn"}>{ev.severity}</Badge>
                              </div>
                              <div className="text-[12px] text-ink-500">{ev.message || "Screenshot attempt recorded by proctoring engine"}</div>
                            </div>
                            <div className="text-right text-[11.5px] text-ink-500 num">
                              {fmtDateTime(ev.occurredAt)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  );
                }
                return (
                  <div className="rounded-lg border border-line bg-sand-50/60 p-3.5 text-[12.5px] text-ink-600 flex items-center gap-2.5">
                    <Camera className="h-4 w-4 text-ok-600 shrink-0" />
                    <span><b>Screenshot Security:</b> Clean session — 0 screenshot or screen capture shortcuts were detected.</span>
                  </div>
                );
              })()}
              <Card padded={false}>{proctor ? <EventTimeline events={proctor.events} startedAt={proctor.startedAt} onChange={reloadP} /> : <Spinner />}</Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card px-3 py-2.5">
      <div className="label-caps">{label}</div>
      <div className={cn("mt-1 text-[15px] font-medium", typeof value === "string" && "num")}>{value}</div>
    </div>
  );
}

function QuestionReview({ q, section, onGraded }: { q: ReviewQ; section: string; onGraded: () => void }) {
  const toast = useToast();
  const [marks, setMarks] = useState<string>(q.marksAwarded != null ? String(q.marksAwarded) : "");
  const [note, setNote] = useState(q.evaluatorNote ?? "");
  const [busy, setBusy] = useState(false);
  const answered = !!q.textAnswer?.trim() || q.options.some((o) => o.selected);
  const canGrade = !!q.answerId && answered && q.type !== "SINGLE" && q.type !== "MULTIPLE" && q.type !== "TRUE_FALSE";
  const border = q.marksAwarded === null && q.needsManual ? "border-l-warn-600" : q.isCorrect ? "border-l-ok-600" : !answered ? "border-l-line-strong" : (q.marksAwarded ?? 0) > 0 ? "border-l-steel-500" : "border-l-bad-600";

  return (
    <div className={cn("card border-l-[3px] p-4", border)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-[12px] text-ink-500">
          <span className="num rounded bg-navy-900 px-1.5 py-0.5 text-[11px] font-medium text-white">Q{q.number}</span>
          {section} · {QUESTION_TYPE_LABEL[q.type]}
          {q.category && <> · {q.category}</>}
          {q.markedForReview && <Badge tone="signal">Marked for review</Badge>}
        </div>
        <div className="num text-[13px]">
          <b className={cn(q.marksAwarded == null ? "text-warn-600" : (q.marksAwarded ?? 0) > 0 ? "text-ok-600" : (q.marksAwarded ?? 0) < 0 ? "text-bad-600" : "")}>{q.marksAwarded ?? "—"}</b> / {q.marks}
          {q.negativeMarks > 0 && <span className="text-ink-400"> (−{q.negativeMarks})</span>}
        </div>
      </div>
      <div className="prose-q mt-2 text-[13.5px]">{q.text}</div>
      {q.options.length > 0 && (
        <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {q.options.map((o, i) => (
            <div key={o.id} className={cn("flex items-center gap-2 rounded border px-2.5 py-1.5 text-[12.5px]", o.isCorrect ? "border-ok-100 bg-ok-50" : o.selected ? "border-bad-100 bg-bad-50" : "border-line")}>
              <span className="num text-ink-400">{String.fromCharCode(65 + i)}</span>
              <span className="flex-1">{o.text}</span>
              {o.selected && (o.isCorrect ? <Check className="h-3.5 w-3.5 text-ok-600" /> : <X className="h-3.5 w-3.5 text-bad-600" />)}
              {o.selected && <span className="text-[11px] text-ink-500">selected</span>}
            </div>
          ))}
        </div>
      )}
      {q.options.length === 0 && (
        <div className="mt-3">
          <div className="label-caps mb-1">Candidate's answer</div>
          {answered ? (
            <div>
              {q.type === "CODING" ? (
                (() => {
                  let lang = q.codeLanguage;
                  let code = q.textAnswer ?? "";
                  try {
                    const parsed = JSON.parse(q.textAnswer ?? "");
                    if (parsed && typeof parsed === "object" && parsed.code) {
                      lang = parsed.language || lang;
                      code = parsed.code;
                    }
                  } catch {
                    /* raw string */
                  }
                  return (
                    <div>
                      {lang && (
                        <div className="mb-1.5 flex items-center gap-2">
                          <span className="rounded bg-navy-800 px-2 py-0.5 font-mono text-[11px] font-bold uppercase text-signal-400 border border-navy-700">
                            Language: {lang}
                          </span>
                        </div>
                      )}
                      <pre className="whitespace-pre-wrap break-words rounded border border-navy-800 bg-navy-950 p-3 font-mono text-[12.5px] text-white/90">
                        {code}
                      </pre>
                    </div>
                  );
                })()
              ) : (
                <pre className="whitespace-pre-wrap break-words rounded border border-line bg-canvas p-3 font-sans text-[13px]">
                  {q.textAnswer}
                </pre>
              )}
            </div>
          ) : (
            <div className="text-[13px] text-ink-400">Not answered</div>
          )}
          {(q.type === "SHORT" || q.type === "NUMERICAL") && q.acceptedAnswers.length > 0 && (
            <div className="mt-2 text-[12px] text-ink-500">
              Expected: {q.acceptedAnswers.join(" | ")}
              {q.numericTolerance ? ` (± ${q.numericTolerance})` : ""}
            </div>
          )}
        </div>
      )}
      {q.explanation && <div className="mt-2 text-[12px] text-ink-500">Explanation: {q.explanation}</div>}
      {canGrade && (
        <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:items-end">
          <label className="block">
            <span className="label-caps block">Marks (max {q.marks})</span>
            <Input type="number" step="0.5" min={q.negativeMarks ? -q.negativeMarks : 0} max={q.marks} value={marks} onChange={(e) => setMarks(e.target.value)} className="num mt-1 w-28" />
          </label>
          <label className="block flex-1">
            <span className="label-caps block">Evaluator note</span>
            <Textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 min-h-[36px]" placeholder="Optional — visible to the candidate if results are released" />
          </label>
          <Button
            loading={busy}
            disabled={marks === ""}
            onClick={async () => {
              setBusy(true);
              try {
                const res = await api<{ needsManualEval: boolean; score: number }>(`/evaluation/answers/${q.answerId}`, { method: "PUT", body: { marksAwarded: Number(marks), note: note || null } });
                toast(res.needsManualEval ? "Marks saved" : `Evaluation complete — final score ${res.score}`);
                onGraded();
              } catch (e) {
                toast((e as Error).message, "bad");
              } finally {
                setBusy(false);
              }
            }}
          >
            {q.evaluator ? "Update" : "Save marks"}
          </Button>
        </div>
      )}
      {q.evaluator && <div className="mt-1.5 text-[11.5px] text-ink-400">Graded by {q.evaluator}</div>}
      {!q.evaluator && q.autoGraded && q.options.length === 0 && answered && <div className="mt-1.5 text-[11.5px] text-ink-400">Auto-graded{canGrade ? " — you can override" : ""}</div>}
    </div>
  );
}

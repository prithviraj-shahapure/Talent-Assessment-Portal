import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Eye, EyeOff, FileSpreadsheet, GitCompare, Search, Star, Trophy } from "lucide-react";
import { api, download, qs } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { Alert, Badge, Button, Card, Checkbox, ConfirmDialog, Dialog, EmptyState, Input, PageHeader, ResultBadge, RiskBadge, Select, Spinner, StageBadge, StatCard, Tabs, useToast } from "@/components/ui";
import { ExportExcelModal } from "@/components/ExportExcelModal";
import { fmtDuration, fmtPct, QUESTION_TYPE_LABEL } from "@/lib/format";
import type { Exam, PipelineStage, QuestionType } from "@/lib/types";
import { CHART, tooltipStyle } from "./Dashboard";
import { cn } from "@/lib/cn";

interface Row {
  rank: number;
  attemptId: string;
  candidateId: string;
  name: string;
  email: string;
  college: string;
  degree: string;
  branch: string;
  stage: PipelineStage;
  status: string;
  score: number;
  maxScore: number;
  percentage: number;
  passed: boolean | null;
  needsManualEval: boolean;
  timeTakenSec: number | null;
  riskScore: number;
  riskLevel: string;
  sections: { title: string; score: number; max: number }[];
}
interface ResultData {
  exam: { id: string; title: string; passingMarks: number; totalMarks: number };
  summary: { assigned: number; inProgress: number; submitted: number; pendingEvaluation: number; average: number | null; highest: number | null; lowest: number | null; passed: number; failed: number; flagged: number };
  distribution: { range: string; count: number }[];
  sectionAverages: { title: string; avgPercentage: number }[];
  questionAnalytics: { questionId: string; text: string; type: QuestionType; attempted: number; correct: number; correctRate: number }[];
  rows: Row[];
}

export default function Results() {
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { data: exams } = useApi<Exam[]>("/exams");
  const withResults = useMemo(() => (exams ?? []).filter((e) => (e.submittedCount ?? 0) > 0 || (e._count?.attempts ?? 0) > 0), [exams]);
  const examId = params.get("examId") ?? withResults[0]?.id ?? "";
  const exam = exams?.find((e) => e.id === examId);
  const { data, loading, reload } = useApi<ResultData>(examId ? `/results/exams/${examId}` : null, [examId]);
  const [tab, setTab] = useState<"leaderboard" | "analytics">("leaderboard");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [resultFilter, setResultFilter] = useState("");
  const [compare, setCompare] = useState(false);
  const [shortlist, setShortlist] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  useEffect(() => setSelected(new Set()), [examId]);

  const rows = (data?.rows ?? []).filter(
    (r) =>
      (!q || `${r.name} ${r.email} ${r.college}`.toLowerCase().includes(q.toLowerCase())) &&
      (!resultFilter || (resultFilter === "pass" && r.passed) || (resultFilter === "fail" && r.passed === false) || (resultFilter === "pending" && r.needsManualEval) || (resultFilter === "flagged" && (r.riskLevel === "MEDIUM" || r.riskLevel === "HIGH"))),
  );
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else if (n.size < 50) n.add(id);
    return n;
  });

  return (
    <div>
      <PageHeader
        title="Results & Rankings"
        subtitle="Leaderboards, analytics and shortlisting per examination. Rank uses the best attempt; ties share a rank and are ordered by time taken."
        actions={
          <Select className="w-80" value={examId} onChange={(e) => setParams({ examId: e.target.value })}>
            {!withResults.length && <option value="">No examinations with results</option>}
            {withResults.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </Select>
        }
      />
      {!examId ? (
        <Card><EmptyState icon={<Trophy className="h-8 w-8" />} title="No results yet" body="Results appear once candidates submit an examination." /></Card>
      ) : loading || !data ? (
        <Spinner />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <StatCard label="Submitted" value={`${data.summary.submitted}/${data.summary.assigned}`} sub={data.summary.inProgress ? `${data.summary.inProgress} in progress` : undefined} />
            <StatCard label="Average" value={fmtPct(data.summary.average)} />
            <StatCard label="Highest" value={fmtPct(data.summary.highest)} tone="signal" />
            <StatCard label="Lowest" value={fmtPct(data.summary.lowest)} />
            <StatCard label="Passed" value={data.summary.passed} tone="ok" />
            <StatCard label="Failed" value={data.summary.failed} tone="bad" />
            <StatCard label="Pending eval." value={data.summary.pendingEvaluation} tone="warn" onClick={() => nav("/admin/evaluation")} />
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge tone={exam?.resultsReleased ? "ok" : "neutral"}>{exam?.resultsReleased ? "Results released to candidates" : exam?.resultPublication === "MANUAL" ? "Results not released" : exam?.resultPublication === "IMMEDIATE" ? "Auto-release: immediate" : "Auto-release: after window closes"}</Badge>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setReleaseOpen(true)}>
                {exam?.resultsReleased ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {exam?.resultsReleased ? "Withdraw results" : "Release results"}
              </Button>
              <Button variant="secondary" onClick={() => download(`/results/exams/${examId}/export${qs({ format: "csv" })}`, "results.csv")}><Download className="h-4 w-4" /> CSV</Button>
              <Button variant="signal" onClick={() => setExportOpen(true)}>
                <FileSpreadsheet className="h-4 w-4" /> Multi-Sheet Excel (.xlsx)
              </Button>
              <Button variant="secondary" onClick={() => download(`/reports/exams/${examId}/pdf`, "exam-report.pdf")}><Download className="h-4 w-4" /> PDF</Button>
            </div>
          </div>
          <Tabs className="mb-4" value={tab} onChange={setTab} items={[{ value: "leaderboard", label: "Leaderboard", count: data.rows.length }, { value: "analytics", label: "Analytics" }]} />

          {tab === "leaderboard" ? (
            <Card padded={false}>
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" />
                  <Input className="pl-8" placeholder="Search candidates" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <Select className="w-full sm:w-40" value={resultFilter} onChange={(e) => setResultFilter(e.target.value)}>
                  <option value="">All results</option>
                  <option value="pass">Passed</option>
                  <option value="fail">Failed</option>
                  <option value="pending">Pending evaluation</option>
                  <option value="flagged">Flagged (medium/high)</option>
                </Select>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-[12.5px] text-ink-500">{selected.size} selected</span>
                  <Button size="sm" variant="secondary" disabled={selected.size < 2 || selected.size > 4} onClick={() => setCompare(true)} title="Select 2–4 candidates">
                    <GitCompare className="h-3.5 w-3.5" /> Compare
                  </Button>
                  <Button size="sm" variant="signal" disabled={!selected.size} onClick={() => setShortlist(true)}>
                    <Star className="h-3.5 w-3.5" /> Shortlist
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th className="w-8" />
                      <th className="w-12">Rank</th>
                      <th>Candidate</th>
                      <th className="text-right">Score</th>
                      <th className="text-right">%</th>
                      {data.rows[0]?.sections.map((s) => <th key={s.title} className="text-right max-w-[120px] truncate" title={s.title}>{s.title.length > 16 ? s.title.slice(0, 15) + "…" : s.title}</th>)}
                      <th>Result</th>
                      <th className="text-right">Time</th>
                      <th>Proctoring</th>
                      <th>Stage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.attemptId} className={cn("row-hover", selected.has(r.attemptId) && "bg-steel-100/40")} onClick={() => nav(`/admin/attempts/${r.attemptId}`)}>
                        <td onClick={(e) => e.stopPropagation()}>
                          <Checkbox label="" checked={selected.has(r.attemptId)} onChange={() => toggle(r.attemptId)} />
                        </td>
                        <td>
                          <span className={cn("num inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-[12px] font-semibold", r.rank === 1 ? "bg-signal-500 text-navy-950" : r.rank <= 3 ? "bg-navy-900 text-white" : "bg-canvas text-ink-700")}>{r.rank}</span>
                        </td>
                        <td>
                          <div className="font-medium">{r.name}</div>
                          <div className="max-w-[260px] truncate text-[12px] text-ink-500">{r.college}</div>
                        </td>
                        <td className="num text-right">{r.score}<span className="text-ink-400">/{r.maxScore}</span></td>
                        <td className="num text-right font-medium">{fmtPct(r.percentage)}</td>
                        {r.sections.map((s) => <td key={s.title} className="num text-right text-[12.5px]">{s.score}<span className="text-ink-400">/{s.max}</span></td>)}
                        <td><ResultBadge passed={r.passed} pending={r.needsManualEval} /></td>
                        <td className="num whitespace-nowrap text-right text-[12.5px]">{fmtDuration(r.timeTakenSec)}</td>
                        <td><RiskBadge level={r.riskLevel} score={r.riskScore} /></td>
                        <td><StageBadge stage={r.stage} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              <Card title="Score distribution" subtitle="Evaluated attempts, by percentage band">
                <div className="h-[240px]">
                  <ResponsiveContainer>
                    <BarChart data={data.distribution} margin={{ left: -20, right: 8, top: 8 }}>
                      <CartesianGrid stroke={CHART.grid} vertical={false} />
                      <XAxis dataKey="range" tick={{ fontSize: 11, fill: CHART.text }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: CHART.text }} axisLine={false} tickLine={false} />
                      <Tooltip {...tooltipStyle} formatter={(v) => [v, "Candidates"]} />
                      <Bar dataKey="count" fill={CHART.navy} radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card title="Section-wise average" subtitle="Average percentage per section">
                <div className="h-[240px]">
                  <ResponsiveContainer>
                    <BarChart data={data.sectionAverages} layout="vertical" margin={{ left: 10, right: 20 }}>
                      <CartesianGrid stroke={CHART.grid} horizontal={false} />
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: CHART.text }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="title" width={170} tick={{ fontSize: 11, fill: CHART.text }} axisLine={false} tickLine={false} />
                      <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v}%`, "Average"]} />
                      <Bar dataKey="avgPercentage" fill={CHART.steel} radius={[0, 2, 2, 0]} barSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card title="Question difficulty analysis" subtitle="Correct rate among candidates who attempted — lowest first" padded={false} className="xl:col-span-2">
                <table className="table-base">
                  <thead>
                    <tr><th>Question</th><th>Type</th><th className="text-right">Attempted</th><th className="text-right">Correct</th><th className="w-56">Correct rate</th></tr>
                  </thead>
                  <tbody>
                    {data.questionAnalytics.filter((x) => x.type !== "DESCRIPTIVE" && x.type !== "CODING").slice(0, 25).map((x) => (
                      <tr key={x.questionId}>
                        <td className="max-w-[520px]"><div className="line-clamp-2 text-[12.5px]">{x.text}</div></td>
                        <td className="text-[12px] whitespace-nowrap">{QUESTION_TYPE_LABEL[x.type]}</td>
                        <td className="num text-right">{x.attempted}</td>
                        <td className="num text-right">{x.correct}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 rounded-sm bg-canvas"><div className={cn("h-1.5 rounded-sm", x.correctRate < 35 ? "bg-bad-600" : x.correctRate < 65 ? "bg-signal-500" : "bg-ok-600")} style={{ width: `${x.correctRate}%` }} /></div>
                            <span className="num w-12 text-right text-[12px]">{x.correctRate}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          )}
        </>
      )}

      {compare && <CompareDialog ids={[...selected]} onClose={() => setCompare(false)} />}
      <ConfirmDialog
        open={shortlist}
        onClose={() => setShortlist(false)}
        title={`Shortlist ${selected.size} candidate(s)?`}
        body={
          <>
            They move to the <b>Shortlisted</b> stage of the recruitment pipeline and are notified by email. Check flagged proctoring sessions before shortlisting.
            {data && [...selected].some((id) => data.rows.find((r) => r.attemptId === id)?.riskLevel === "HIGH") && <Alert tone="warn" className="mt-3">At least one selected candidate has a high-concern proctoring session. Make sure it has been reviewed.</Alert>}
          </>
        }
        confirmLabel="Shortlist & notify"
        onConfirm={async () => {
          const ids = [...new Set((data?.rows ?? []).filter((r) => selected.has(r.attemptId)).map((r) => r.candidateId))];
          await api("/pipeline/move", { body: { candidateIds: ids, stage: "SHORTLISTED", notify: true, note: `Shortlisted from ${data?.exam.title}` } });
          toast(`${ids.length} candidate(s) shortlisted`);
          setSelected(new Set());
          reload();
        }}
      />
      <ConfirmDialog
        open={releaseOpen}
        onClose={() => setReleaseOpen(false)}
        title={exam?.resultsReleased ? "Withdraw results?" : "Release results to candidates?"}
        body={exam?.resultsReleased ? "Candidates will no longer be able to see their scores." : "Candidates will see their score, section-wise performance and question-wise feedback with correct answers."}
        confirmLabel={exam?.resultsReleased ? "Withdraw" : "Release results"}
        onConfirm={async () => {
          try {
            await api(`/exams/${examId}/release-results`, { body: { released: !exam?.resultsReleased } });
            toast(exam?.resultsReleased ? "Results withdrawn" : "Results released");
            window.location.reload();
          } catch (e) {
            toast((e as Error).message, "bad");
          }
        }}
      />

      <ExportExcelModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        examId={examId}
      />
    </div>
  );
}

interface CompareRow { attemptId: string; name: string; college: string; degree: string; branch: string; graduationYear: number; stage: PipelineStage; rank: number | null; score: number | null; maxScore: number | null; percentage: number | null; passed: boolean | null; timeTakenSec: number | null; riskScore: number; riskLevel: string; sections: { title: string; score: number; max: number }[]; correct: number; wrong: number; unanswered: number }

function CompareDialog({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const { data, loading, error } = useApi<CompareRow[]>(`/results/compare?attemptIds=${ids.join(",")}`, [ids.join(",")]);
  const best = (vals: (number | null)[], higher = true) => {
    const nums = vals.filter((v): v is number => v !== null);
    return nums.length ? (higher ? Math.max(...nums) : Math.min(...nums)) : null;
  };
  const row = (label: string, vals: React.ReactNode[], highlight?: number[]) => (
    <tr>
      <td className="label-caps !text-ink-500 whitespace-nowrap">{label}</td>
      {vals.map((v, i) => <td key={i} className={cn("num text-[13px]", highlight?.includes(i) && "font-semibold text-ok-600")}>{v}</td>)}
    </tr>
  );
  return (
    <Dialog open onClose={onClose} size="xl" title="Candidate comparison">
      {loading ? <Spinner /> : error ? <Alert tone="bad">{error}</Alert> : data && (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr><th />{data.map((d) => <th key={d.attemptId} className="!normal-case !tracking-normal !text-[13px] !text-ink-900">{d.name}</th>)}</tr>
            </thead>
            <tbody>
              {row("College", data.map((d) => <span className="font-sans text-[12px]">{d.college}</span>))}
              {row("Degree", data.map((d) => <span className="font-sans">{d.degree} · {d.branch} · {d.graduationYear}</span>))}
              {row("Rank", data.map((d) => d.rank ?? "—"), data.map((d, i) => (d.rank === best(data.map((x) => x.rank), false) ? i : -1)))}
              {row("Score", data.map((d) => `${d.score}/${d.maxScore}`), data.map((d, i) => (d.score === best(data.map((x) => x.score)) ? i : -1)))}
              {row("Percentage", data.map((d) => fmtPct(d.percentage)))}
              {row("Result", data.map((d) => <ResultBadge passed={d.passed} />))}
              {data[0].sections.map((s, si) => row(s.title, data.map((d) => `${d.sections[si]?.score ?? 0}/${d.sections[si]?.max ?? 0}`), data.map((d, i) => (d.sections[si]?.score === best(data.map((x) => x.sections[si]?.score ?? null)) ? i : -1))))}
              {row("Correct / wrong / blank", data.map((d) => `${d.correct} / ${d.wrong} / ${d.unanswered}`))}
              {row("Time taken", data.map((d) => fmtDuration(d.timeTakenSec)), data.map((d, i) => (d.timeTakenSec === best(data.map((x) => x.timeTakenSec), false) ? i : -1)))}
              {row("Proctoring", data.map((d) => <RiskBadge level={d.riskLevel} score={d.riskScore} />))}
              {row("Stage", data.map((d) => <StageBadge stage={d.stage} />))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}

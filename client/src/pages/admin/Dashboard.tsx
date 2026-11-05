import { useNavigate } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, Gauge, MonitorPlay, Radio, Star, Users, UserCheck } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { Badge, Card, EmptyState, PageHeader, Spinner, StatCard } from "@/components/ui";
import { EVENT_LABEL, fmtDate, relTime, STAGE_LABEL } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import type { PipelineStage } from "@/lib/types";

interface Dash {
  stats: { totalCandidates: number; registeredCandidates: number; activeExams: number; completedExams: number; upcomingExams: number; underReview: number; shortlisted: number; averageScore: number | null; pendingAccommodations: number; liveAttempts: number };
  registrations: { date: string; count: number }[];
  participation: { examId: string; title: string; department: string; assigned: number; attempted: number; submitted: number; avgPercentage: number; maxPercentage: number; passed: number; failed: number }[];
  passFail: { name: string; value: number }[];
  departments: { department: string; candidates: number; passed: number }[];
  stages: { stage: PipelineStage; count: number }[];
  recentEvents: { id: string; attemptId: string; type: string; severity: string; message: string; occurredAt: string; candidate: string; exam: string }[];
}

export const CHART = { navy: "#15294d", steel: "#3b78dc", signal: "#e8a33d", ok: "#15803d", bad: "#b42318", muted: "#b8bfcc", grid: "#e9edf2", text: "#5b6478" };
const axis = { fontSize: 11, fill: CHART.text, fontFamily: "IBM Plex Sans" };
const shortTitle = (t: string) => (t.length > 22 ? t.slice(0, 21) + "…" : t);
export const tooltipStyle = { contentStyle: { borderRadius: 6, border: "1px solid #e1e5ec", fontSize: 12, boxShadow: "0 8px 24px -8px rgba(8,19,42,.25)" }, cursor: { fill: "rgba(13,29,58,.04)" } };

export default function Dashboard() {
  const { data, loading } = useApi<Dash>("/dashboard");
  const nav = useNavigate();
  const { user } = useAuth();
  if (loading || !data) return <Spinner />;
  const s = data.stats;
  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={fmtDate(new Date())}
        title={`${greeting}, ${user?.name.split(" ")[0]}`}
        subtitle="Recruitment and examination activity across Zanvar Group."
        actions={
          s.liveAttempts > 0 ? (
            <button onClick={() => nav("/admin/live")} className="flex items-center gap-2 rounded border border-ok-100 bg-ok-50 px-3 py-1.5 text-[13px] font-medium text-ok-600 hover:bg-ok-100">
              <Radio className="h-4 w-4 animate-pulse2" /> {s.liveAttempts} candidate{s.liveAttempts > 1 ? "s" : ""} in examination now
            </button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total candidates" value={s.totalCandidates} icon={<Users className="h-4 w-4" />} onClick={() => nav("/admin/candidates")} />
        <StatCard label="Registered (verified)" value={s.registeredCandidates} sub={`${s.totalCandidates - s.registeredCandidates} awaiting email verification`} icon={<UserCheck className="h-4 w-4" />} />
        <StatCard label="Active examinations" value={s.activeExams} tone="ok" icon={<MonitorPlay className="h-4 w-4" />} onClick={() => nav("/admin/exams")} />
        <StatCard label="Completed examinations" value={s.completedExams} icon={<CheckCircle2 className="h-4 w-4" />} />
        <StatCard label="Upcoming examinations" value={s.upcomingExams} icon={<CalendarClock className="h-4 w-4" />} />
        <StatCard label="Candidates under review" value={s.underReview} tone="warn" sub="Manual evaluation or flagged sessions" icon={<AlertTriangle className="h-4 w-4" />} onClick={() => nav("/admin/evaluation")} />
        <StatCard label="Shortlisted" value={s.shortlisted} tone="signal" sub="Shortlisted, interview or selected" icon={<Star className="h-4 w-4" />} onClick={() => nav("/admin/pipeline")} />
        <StatCard label="Average score" value={s.averageScore === null ? "—" : `${s.averageScore}%`} icon={<Gauge className="h-4 w-4" />} onClick={() => nav("/admin/results")} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Candidate registrations" subtitle="Last 30 days" className="xl:col-span-2">
          <div className="h-[230px]">
            <ResponsiveContainer>
              <AreaChart data={data.registrations} margin={{ left: -20, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="reg" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={CHART.steel} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={CHART.steel} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="date" tick={axis} tickFormatter={(d) => fmtDate(d).slice(0, 6)} interval={4} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={axis} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} labelFormatter={(d) => fmtDate(d)} formatter={(v) => [v, "Registrations"]} />
                <Area type="monotone" dataKey="count" stroke={CHART.steel} strokeWidth={2} fill="url(#reg)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Pass / fail distribution" subtitle="All evaluated attempts">
          <div className="h-[230px]">
            {data.passFail.every((p) => p.value === 0) ? (
              <EmptyState title="No results yet" />
            ) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={data.passFail} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2} stroke="none">
                    {data.passFail.map((_, i) => (
                      <Cell key={i} fill={[CHART.ok, CHART.bad, CHART.signal][i]} />
                    ))}
                  </Pie>
                  <Tooltip {...tooltipStyle} />
                  <Legend iconType="square" iconSize={9} wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Examination participation" subtitle="Assigned vs attempted vs submitted">
          <div className="h-[260px]">
            {data.participation.length === 0 ? (
              <EmptyState title="No examination participation data yet" body="Participation charts will populate once candidates are assigned to examinations." />
            ) : (
              <ResponsiveContainer>
                <BarChart data={data.participation} margin={{ left: -20, right: 8, top: 8 }} barGap={2}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="title" tick={axis} tickFormatter={shortTitle} axisLine={false} tickLine={false} interval={0} />
                  <YAxis allowDecimals={false} tick={axis} axisLine={false} tickLine={false} />
                  <Tooltip {...tooltipStyle} />
                  <Legend iconType="square" iconSize={9} wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="assigned" name="Assigned" fill={CHART.muted} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="attempted" name="Attempted" fill={CHART.steel} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="submitted" name="Submitted" fill={CHART.navy} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
        <Card title="Examination performance comparison" subtitle="Average and highest score (%)">
          <div className="h-[260px]">
            {data.participation.filter((p) => p.submitted > 0).length === 0 ? (
              <EmptyState title="No submitted examinations yet" body="Performance metrics will appear after candidate submissions." />
            ) : (
              <ResponsiveContainer>
                <BarChart data={data.participation.filter((p) => p.submitted > 0)} margin={{ left: -20, right: 8, top: 8 }} layout="horizontal">
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="title" tick={axis} tickFormatter={shortTitle} axisLine={false} tickLine={false} interval={0} />
                  <YAxis domain={[0, 100]} tick={axis} axisLine={false} tickLine={false} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => `${v}%`} />
                  <Legend iconType="square" iconSize={9} wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="avgPercentage" name="Average %" fill={CHART.steel} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="maxPercentage" name="Highest %" fill={CHART.signal} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Department-wise candidates" subtitle="By examination department">
          {data.departments.length === 0 ? (
            <EmptyState title="No department data yet" />
          ) : (
            <div className="h-[240px]">
              <ResponsiveContainer>
                <BarChart data={data.departments} layout="vertical" margin={{ left: 10, right: 16 }}>
                  <CartesianGrid stroke={CHART.grid} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={axis} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="department" tick={axis} width={130} axisLine={false} tickLine={false} />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="candidates" name="Candidates" fill={CHART.navy} radius={[0, 2, 2, 0]} barSize={14} />
                  <Bar dataKey="passed" name="Passed" fill={CHART.ok} radius={[0, 2, 2, 0]} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card title="Recruitment pipeline" subtitle="Candidates by stage" actions={<button className="text-[12px] font-medium text-steel-600 hover:underline" onClick={() => nav("/admin/pipeline")}>Open pipeline</button>}>
          <div className="space-y-2">
            {(Object.keys(STAGE_LABEL) as PipelineStage[]).map((st) => {
              const c = data.stages.find((x) => x.stage === st)?.count ?? 0;
              const max = Math.max(1, ...data.stages.map((x) => x.count));
              return (
                <div key={st} className="flex items-center gap-3 text-[12.5px]">
                  <div className="w-[110px] shrink-0 text-ink-700">{STAGE_LABEL[st]}</div>
                  <div className="h-2 flex-1 rounded-sm bg-canvas">
                    <div className={`h-2 rounded-sm ${st === "SELECTED" ? "bg-ok-600" : st === "REJECTED" ? "bg-bad-600" : st === "SHORTLISTED" || st === "INTERVIEW" ? "bg-signal-500" : "bg-navy-700"}`} style={{ width: `${(c / max) * 100}%` }} />
                  </div>
                  <div className="num w-6 text-right">{c}</div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Recent proctoring flags" padded={false} actions={<button className="text-[12px] font-medium text-steel-600 hover:underline" onClick={() => nav("/admin/evaluation?tab=flagged")}>Review</button>}>
          {data.recentEvents.length === 0 ? (
            <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="No flagged events" />
          ) : (
            <ul className="divide-y divide-line">
              {data.recentEvents.map((e) => (
                <li key={e.id} className="flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-navy-50/50" onClick={() => nav(`/admin/attempts/${e.attemptId}?tab=proctoring`)}>
                  <Badge tone={e.severity === "HIGH" ? "bad" : e.severity === "MEDIUM" ? "warn" : "steel"} className="mt-0.5">
                    {e.severity}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{EVENT_LABEL[e.type] ?? e.type} · {e.candidate}</div>
                    <div className="truncate text-[12px] text-ink-500">{e.exam}</div>
                  </div>
                  <div className="shrink-0 text-[11.5px] text-ink-400">{relTime(e.occurredAt)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {s.pendingAccommodations > 0 && (
        <button onClick={() => nav("/admin/evaluation?tab=accommodations")} className="w-full rounded border border-warn-100 bg-warn-50 px-4 py-3 text-left text-[13px] text-warn-600 hover:bg-warn-100">
          <b>{s.pendingAccommodations}</b> accommodation request{s.pendingAccommodations > 1 ? "s" : ""} awaiting a decision →
        </button>
      )}
    </div>
  );
}

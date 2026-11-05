import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ClipboardCheck, HandHelping, ShieldAlert } from "lucide-react";
import { api, qs } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, Field, Input, PageHeader, RiskBadge, Select, Spinner, Tabs, Textarea, useToast } from "@/components/ui";
import { fmtDateTime, relTime } from "@/lib/format";
import type { Exam } from "@/lib/types";

type Tab = "manual" | "flagged" | "accommodations";

export default function Evaluation() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "manual";
  const [examId, setExamId] = useState("");
  const { data: exams } = useApi<Exam[]>("/exams");
  return (
    <div>
      <PageHeader
        title="Evaluation & Review"
        subtitle="Grade descriptive and coding answers, review flagged sessions and respond to accommodation requests."
        actions={
          tab !== "accommodations" && (
            <Select className="w-72" value={examId} onChange={(e) => setExamId(e.target.value)}>
              <option value="">All examinations</option>
              {exams?.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </Select>
          )
        }
      />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={(t) => setParams({ tab: t })}
        items={[
          { value: "manual", label: "Manual evaluation" },
          { value: "flagged", label: "Flagged sessions" },
          { value: "accommodations", label: "Accommodation requests" },
        ]}
      />
      {tab === "manual" && <ManualQueue examId={examId} />}
      {tab === "flagged" && <Flagged examId={examId} />}
      {tab === "accommodations" && <Accommodations />}
    </div>
  );
}

function ManualQueue({ examId }: { examId: string }) {
  const nav = useNavigate();
  const { data, loading } = useApi<{ id: string; submittedAt: string; pendingAnswers: number; score: number | null; maxScore: number | null; exam: { title: string }; candidate: { user: { name: string; email: string } } }[]>(`/evaluation/queue${qs({ examId })}`, [examId]);
  return (
    <Card padded={false}>
      {loading ? (
        <Spinner />
      ) : !data?.length ? (
        <EmptyState icon={<ClipboardCheck className="h-7 w-7" />} title="Nothing to evaluate" body="Submitted attempts with descriptive, coding or open short answers appear here." />
      ) : (
        <table className="table-base">
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Examination</th>
              <th className="text-right">Answers to grade</th>
              <th className="text-right">Auto score so far</th>
              <th>Submitted</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((a) => (
              <tr key={a.id} className="row-hover" onClick={() => nav(`/admin/attempts/${a.id}?grade=1`)}>
                <td>
                  <div className="font-medium">{a.candidate.user.name}</div>
                  <div className="text-[12px] text-ink-500">{a.candidate.user.email}</div>
                </td>
                <td className="text-[13px]">{a.exam.title}</td>
                <td className="num text-right"><Badge tone="warn">{a.pendingAnswers}</Badge></td>
                <td className="num text-right">{a.score ?? 0} / {a.maxScore}</td>
                <td className="text-[12.5px] text-ink-500">{relTime(a.submittedAt)}</td>
                <td className="text-right"><Button size="sm">Evaluate</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function Flagged({ examId }: { examId: string }) {
  const nav = useNavigate();
  const [level, setLevel] = useState("");
  const { data, loading } = useApi<{ id: string; riskScore: number; riskLevel: string; submittedAt: string; unreviewed: number; _count: { events: number }; exam: { title: string }; candidate: { user: { name: string; email: string } } }[]>(`/proctoring/review${qs({ examId, level })}`, [examId, level]);
  return (
    <Card
      padded={false}
      title="Sessions with proctoring flags"
      subtitle="Sorted by risk score. Every decision should be based on reviewing the events and evidence."
      actions={
        <Select className="h-8 w-44" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">All levels</option>
          <option value="HIGH">High concern</option>
          <option value="MEDIUM">Medium concern</option>
          <option value="LOW">Low concern</option>
          <option value="NORMAL">Normal (with events)</option>
        </Select>
      }
    >
      {loading ? (
        <Spinner />
      ) : !data?.length ? (
        <EmptyState icon={<ShieldAlert className="h-7 w-7" />} title="No flagged sessions" />
      ) : (
        <table className="table-base">
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Examination</th>
              <th>Risk</th>
              <th className="text-right">Events</th>
              <th className="text-right">Unreviewed</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {data.map((a) => (
              <tr key={a.id} className="row-hover" onClick={() => nav(`/admin/live/${a.id}`)}>
                <td>
                  <div className="font-medium">{a.candidate.user.name}</div>
                  <div className="text-[12px] text-ink-500">{a.candidate.user.email}</div>
                </td>
                <td className="text-[13px]">{a.exam.title}</td>
                <td><RiskBadge level={a.riskLevel} score={a.riskScore} /></td>
                <td className="num text-right">{a._count.events}</td>
                <td className="num text-right">{a.unreviewed > 0 ? <Badge tone="warn">{a.unreviewed}</Badge> : <span className="text-ok-600">✓</span>}</td>
                <td className="text-[12.5px] text-ink-500 whitespace-nowrap">{fmtDateTime(a.submittedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

interface Acc { id: string; reason: string; status: string; response: string | null; extraMinutes: number; waiveWebcam: boolean; waiveMicrophone: boolean; createdAt: string; exam: { id: string; title: string }; candidate: { id: string; user: { name: string; email: string } } }

function Accommodations() {
  const toast = useToast();
  const [status, setStatus] = useState("PENDING");
  const { data, loading, reload } = useApi<Acc[]>(`/candidates/accommodations/all${qs({ status })}`, [status]);
  const [open, setOpen] = useState<Acc | null>(null);
  const [form, setForm] = useState({ response: "", extraMinutes: 0, waiveWebcam: false, waiveMicrophone: false });
  const respond = async (s: "APPROVED" | "DECLINED") => {
    try {
      await api(`/candidates/accommodations/${open!.id}`, { method: "PATCH", body: { ...(s === "APPROVED" ? form : { extraMinutes: 0, waiveWebcam: false, waiveMicrophone: false }), status: s, response: form.response || null } });
      toast(s === "APPROVED" ? "Request approved" : "Request declined");
      setOpen(null);
      reload();
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  };
  return (
    <Card
      padded={false}
      title="Alternative arrangement requests"
      subtitle="Candidates who cannot meet webcam or microphone requirements, or need extra time."
      actions={
        <Select className="h-8 w-36" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="DECLINED">Declined</option>
          <option value="">All</option>
        </Select>
      }
    >
      {loading ? (
        <Spinner />
      ) : !data?.length ? (
        <EmptyState icon={<HandHelping className="h-7 w-7" />} title="No requests" />
      ) : (
        <ul className="divide-y divide-line">
          {data.map((a) => (
            <li key={a.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="font-medium">
                  {a.candidate.user.name} <span className="font-normal text-ink-500">· {a.exam.title}</span>
                </div>
                <p className="mt-1 text-[13px] text-ink-700">{a.reason}</p>
                <div className="mt-1 text-[12px] text-ink-500">
                  {fmtDateTime(a.createdAt)}
                  {a.response && <> · HR: {a.response}</>}
                  {a.status === "APPROVED" && (
                    <>
                      {a.extraMinutes > 0 && ` · +${a.extraMinutes} min`}
                      {a.waiveWebcam && " · webcam waived"}
                      {a.waiveMicrophone && " · microphone waived"}
                    </>
                  )}
                </div>
              </div>
              {a.status === "PENDING" ? (
                <Button size="sm" onClick={() => { setOpen(a); setForm({ response: "", extraMinutes: 0, waiveWebcam: false, waiveMicrophone: false }); }}>
                  Respond
                </Button>
              ) : (
                <Badge tone={a.status === "APPROVED" ? "ok" : "bad"}>{a.status.toLowerCase()}</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={!!open}
        onClose={() => setOpen(null)}
        title="Respond to request"
        description={open ? `${open.candidate.user.name} · ${open.exam.title}` : ""}
        footer={
          <>
            <Button variant="secondary" onClick={() => respond("DECLINED")}>Decline</Button>
            <Button onClick={() => respond("APPROVED")}>Approve</Button>
          </>
        }
      >
        {open && (
          <div className="space-y-3">
            <div className="rounded border border-line bg-canvas p-3 text-[13px]">{open.reason}</div>
            <Field label="Response to candidate">
              <Textarea rows={3} value={form.response} onChange={(e) => setForm({ ...form, response: e.target.value })} />
            </Field>
            <div className="label-caps pt-1">If approving</div>
            <Checkbox checked={form.waiveWebcam} onChange={(e) => setForm({ ...form, waiveWebcam: e.target.checked })} label="Waive webcam requirement" />
            <Checkbox checked={form.waiveMicrophone} onChange={(e) => setForm({ ...form, waiveMicrophone: e.target.checked })} label="Waive microphone requirement" />
            <Field label="Extra time (minutes)">
              <Input type="number" min={0} max={240} value={form.extraMinutes} onChange={(e) => setForm({ ...form, extraMinutes: Number(e.target.value) })} />
            </Field>
          </div>
        )}
      </Dialog>
    </Card>
  );
}

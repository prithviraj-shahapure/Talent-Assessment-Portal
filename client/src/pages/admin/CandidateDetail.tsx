import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, FileText, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/lib/auth";
import { Badge, Button, Card, ConfirmDialog, EmptyState, KeyValue, PageHeader, ResultBadge, RiskBadge, Select, Spinner, StageBadge, Switch, Textarea, useToast } from "@/components/ui";
import { fmtDateTime, fmtPct, STAGE_LABEL, STAGES } from "@/lib/format";
import type { PipelineStage } from "@/lib/types";

interface Detail {
  id: string;
  mobile: string;
  college: string;
  degree: string;
  branch: string;
  currentYear: string;
  graduationYear: number;
  stage: PipelineStage;
  hrNotes: string | null;
  hasResume: boolean;
  resumeName: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string; emailVerified: boolean; isActive: boolean; lastLoginAt: string | null; createdAt: string };
  assignments: { id: string; assignedAt: string; invitationCode: string | null; exam: { id: string; title: string; startAt: string; endAt: string; status: string } }[];
  attempts: { id: string; attemptNo: number; status: string; startedAt: string; submittedAt: string | null; score: number | null; maxScore: number | null; percentage: number | null; passed: boolean | null; needsManualEval: boolean; riskScore: number; riskLevel: string; exam: { id: string; title: string }; _count: { events: number } }[];
  pipeline: { id: string; fromStage: PipelineStage | null; toStage: PipelineStage; note: string | null; createdAt: string; changedBy: { name: string } | null }[];
  consents: { id: string; policyVersion: string; webcam: boolean; microphone: boolean; evidence: boolean; acceptedAt: string; examId: string | null }[];
  accommodations: { id: string; reason: string; status: string; response: string | null; createdAt: string; exam: { title: string } }[];
}

export default function CandidateDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const { data: c, loading, reload } = useApi<Detail>(`/candidates/${id}`, [id]);
  const [notes, setNotes] = useState<string | null>(null);
  const [stage, setStage] = useState<PipelineStage | "">("");
  const [erase, setErase] = useState(false);
  if (loading || !c) return <Spinner />;

  return (
    <div>
      <PageHeader
        back={
          <Link to="/admin/candidates" className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-ink-500 hover:text-ink-900">
            <ArrowLeft className="h-3.5 w-3.5" /> Candidates
          </Link>
        }
        title={c.user.name}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StageBadge stage={c.stage} />
            {c.user.email} · {c.mobile}
            {!c.user.emailVerified && <Badge tone="warn">Email unverified</Badge>}
            {!c.user.isActive && <Badge tone="bad">Deactivated</Badge>}
          </span>
        }
        actions={
          <>
            {c.hasResume && (
              <a href={`/api/candidates/${c.id}/resume`} target="_blank" rel="noreferrer">
                <Button variant="secondary">
                  <FileText className="h-4 w-4" /> View resume
                </Button>
              </a>
            )}
            {user?.role === "SUPER_ADMIN" && (
              <Button variant="ghost" onClick={() => setErase(true)} title="Erase personal data">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5 min-w-0">
          <Card title="Profile">
            <KeyValue
              items={[
                ["College / University", c.college],
                ["Degree", c.degree],
                ["Branch", c.branch],
                ["Current year", c.currentYear],
                ["Graduation year", c.graduationYear],
                ["Registered", fmtDateTime(c.createdAt)],
                ["Last sign-in", fmtDateTime(c.user.lastLoginAt)],
                ["Resume", c.resumeName ?? "Not uploaded"],
              ]}
            />
          </Card>
          <Card title="Examination attempts" padded={false}>
            {!c.attempts.length ? (
              <EmptyState title="No attempts yet" />
            ) : (
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Examination</th>
                    <th>Status</th>
                    <th className="text-right">Score</th>
                    <th>Result</th>
                    <th>Proctoring</th>
                    <th>Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {c.attempts.map((a) => (
                    <tr key={a.id} className="row-hover" onClick={() => nav(`/admin/attempts/${a.id}`)}>
                      <td>
                        <div className="font-medium">{a.exam.title}</div>
                        <div className="text-[12px] text-ink-500">Attempt {a.attemptNo}</div>
                      </td>
                      <td className="text-[12.5px]">{a.status.replace("_", " ").toLowerCase()}</td>
                      <td className="num text-right">
                        {a.score ?? "—"} / {a.maxScore ?? "—"}
                        <div className="text-[12px] text-ink-500">{fmtPct(a.percentage)}</div>
                      </td>
                      <td>{a.status === "IN_PROGRESS" ? "—" : <ResultBadge passed={a.passed} pending={a.needsManualEval} />}</td>
                      <td>
                        <RiskBadge level={a.riskLevel} score={a.riskScore} />
                        <div className="text-[11.5px] text-ink-500 mt-0.5">{a._count.events} event(s)</div>
                      </td>
                      <td className="text-[12.5px] text-ink-500 whitespace-nowrap">{fmtDateTime(a.submittedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title="Assigned examinations" padded={false}>
            {!c.assignments.length ? (
              <EmptyState title="Not assigned to any examination" />
            ) : (
              <ul className="divide-y divide-line">
                {c.assignments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between px-4 py-2.5 text-[13px]">
                    <Link to={`/admin/exams/${a.exam.id}`} className="font-medium hover:underline">
                      {a.exam.title}
                    </Link>
                    <span className="text-[12px] text-ink-500">
                      {a.invitationCode && <span className="font-mono mr-2">{a.invitationCode}</span>}
                      {fmtDateTime(a.assignedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Consent records" subtitle="Privacy notice acceptance (DPDP Act)" padded={false}>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Accepted</th>
                  <th>Policy</th>
                  <th>Webcam</th>
                  <th>Microphone</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {c.consents.map((x) => (
                  <tr key={x.id}>
                    <td className="text-[12.5px]">
                      {fmtDateTime(x.acceptedAt)}
                      <div className="text-ink-500">{x.examId ? "Before examination" : "At registration"}</div>
                    </td>
                    <td className="font-mono text-[12px]">{x.policyVersion}</td>
                    <td>{x.webcam ? "Yes" : "No"}</td>
                    <td>{x.microphone ? "Yes" : "No"}</td>
                    <td>{x.evidence ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Recruitment stage">
            <div className="flex gap-2">
              <Select value={stage || c.stage} onChange={(e) => setStage(e.target.value as PipelineStage)}>
                {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
              </Select>
              <Button
                disabled={!stage || stage === c.stage}
                onClick={async () => {
                  await api("/pipeline/move", { body: { candidateIds: [c.id], stage } });
                  toast(`Moved to ${STAGE_LABEL[stage as PipelineStage]}`);
                  setStage("");
                  reload();
                }}
              >
                Update
              </Button>
            </div>
            <ol className="mt-4 space-y-3 border-l border-line pl-4">
              {c.pipeline.map((p) => (
                <li key={p.id} className="relative text-[12.5px]">
                  <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-navy-700" />
                  <div className="font-medium">{STAGE_LABEL[p.toStage]}</div>
                  <div className="text-ink-500">
                    {fmtDateTime(p.createdAt)} · {p.changedBy?.name ?? "System"}
                  </div>
                  {p.note && <div className="text-ink-500">{p.note}</div>}
                </li>
              ))}
            </ol>
          </Card>
          <Card title="HR notes" subtitle="Visible to HR staff only">
            <Textarea rows={5} value={notes ?? c.hrNotes ?? ""} onChange={(e) => setNotes(e.target.value)} placeholder="Interview feedback, follow-ups…" />
            <Button
              className="mt-2"
              size="sm"
              disabled={notes === null}
              onClick={async () => {
                await api(`/candidates/${c.id}`, { method: "PATCH", body: { hrNotes: notes } });
                toast("Notes saved");
                setNotes(null);
                reload();
              }}
            >
              Save notes
            </Button>
          </Card>
          {c.accommodations.length > 0 && (
            <Card title="Accommodation requests">
              {c.accommodations.map((a) => (
                <div key={a.id} className="mb-3 text-[12.5px] last:mb-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{a.exam.title}</span>
                    <Badge tone={a.status === "APPROVED" ? "ok" : a.status === "DECLINED" ? "bad" : "warn"}>{a.status.toLowerCase()}</Badge>
                  </div>
                  <p className="mt-1 text-ink-700">{a.reason}</p>
                  {a.response && <p className="mt-1 text-ink-500">HR: {a.response}</p>}
                </div>
              ))}
              <Link to="/admin/evaluation?tab=accommodations" className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-steel-600">
                Manage <ExternalLink className="h-3 w-3" />
              </Link>
            </Card>
          )}
          <Card title="Account">
            <Switch
              checked={c.user.isActive}
              label="Account active"
              description="Deactivated candidates cannot sign in"
              onChange={async (v) => {
                await api(`/candidates/${c.id}`, { method: "PATCH", body: { isActive: v } });
                toast(v ? "Account activated" : "Account deactivated");
                reload();
              }}
            />
          </Card>
        </div>
      </div>
      <ConfirmDialog
        open={erase}
        onClose={() => setErase(false)}
        title="Erase this candidate's personal data?"
        body="Permanently deletes the account, profile, resume, attempts, answers, proctoring events and evidence. Use this for a verified data-erasure request under the DPDP Act. This cannot be undone."
        tone="danger"
        confirmLabel="Erase permanently"
        onConfirm={async () => {
          await api(`/candidates/${c.id}`, { method: "DELETE" });
          toast("Candidate data erased");
          nav("/admin/candidates");
        }}
      />
    </div>
  );
}

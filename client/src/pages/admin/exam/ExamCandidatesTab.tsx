import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, SlidersHorizontal, Trash2, UserPlus } from "lucide-react";
import { api, qs } from "@/lib/api";
import { useApi, useDebounced } from "@/hooks/useApi";
import { Alert, Badge, Button, Card, Checkbox, Dialog, EmptyState, Field, Input, Pagination, RiskBadge, Spinner, useToast } from "@/components/ui";
import { fmtDateTime, fmtPct } from "@/lib/format";
import type { Exam, Paged } from "@/lib/types";

interface Assignment {
  id: string;
  candidateId: string;
  assignedAt: string;
  invitationCode: string | null;
  extraAttempts: number;
  extraMinutes: number;
  candidate: {
    id: string;
    college: string;
    degree: string;
    branch: string;
    stage: string;
    user: { name: string; email: string; emailVerified: boolean };
    attempts: { id: string; status: string; score: number | null; percentage: number | null; riskLevel: string; riskScore: number; attemptNo: number; submittedAt: string | null }[];
  };
}

export function ExamCandidatesTab({ exam, reload }: { exam: Exam; reload: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const { data, loading, reload: reloadA } = useApi<Assignment[]>(`/exams/${exam.id}/assignments`);
  const [assignOpen, setAssignOpen] = useState(false);
  const [adjust, setAdjust] = useState<Assignment | null>(null);
  const [filter, setFilter] = useState("");
  const rows = (data ?? []).filter((a) => !filter || `${a.candidate.user.name} ${a.candidate.user.email} ${a.candidate.college}`.toLowerCase().includes(filter.toLowerCase()));
  const statusOf = (a: Assignment) => {
    const t = a.candidate.attempts[0];
    if (!t) return <Badge tone="neutral">Not started</Badge>;
    if (t.status === "IN_PROGRESS") return <Badge tone="ok" dot>In progress</Badge>;
    if (t.status === "EVALUATED") return <Badge tone="navy">Evaluated</Badge>;
    return <Badge tone="steel">{t.status === "AUTO_SUBMITTED" ? "Auto-submitted" : "Submitted"}</Badge>;
  };

  return (
    <Card
      padded={false}
      title="Assigned candidates"
      subtitle="Candidates who can take this examination"
      actions={
        <>
          <div className="relative hidden sm:block">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-ink-400" />
            <Input className="h-8 w-56 pl-8" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <Button size="sm" onClick={() => setAssignOpen(true)}>
            <UserPlus className="h-3.5 w-3.5" /> Assign candidates
          </Button>
        </>
      }
    >
      {loading ? (
        <Spinner />
      ) : !rows.length ? (
        <EmptyState title="No candidates assigned" body="Assign registered candidates directly, or share an invitation code." />
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Education</th>
                <th>Status</th>
                <th className="text-right">Score</th>
                <th>Risk</th>
                <th>Assigned</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const t = a.candidate.attempts[0];
                return (
                  <tr key={a.id} className="row-hover" onClick={() => (t ? nav(`/admin/attempts/${t.id}`) : nav(`/admin/candidates/${a.candidateId}`))}>
                    <td>
                      <div className="font-medium">{a.candidate.user.name}</div>
                      <div className="text-[12px] text-ink-500">
                        {a.candidate.user.email}
                        {!a.candidate.user.emailVerified && <span className="ml-1.5 text-warn-600">· unverified</span>}
                      </div>
                    </td>
                    <td className="text-[12.5px]">
                      <div className="truncate max-w-[240px]">{a.candidate.college}</div>
                      <div className="text-ink-500">
                        {a.candidate.degree} · {a.candidate.branch}
                      </div>
                    </td>
                    <td>
                      {statusOf(a)}
                      {(a.extraAttempts > 0 || a.extraMinutes > 0) && (
                        <div className="mt-1 text-[11px] text-steel-600">
                          {a.extraAttempts > 0 && `+${a.extraAttempts} attempt `}
                          {a.extraMinutes > 0 && `+${a.extraMinutes} min`}
                        </div>
                      )}
                    </td>
                    <td className="num text-right">{t?.percentage != null ? fmtPct(t.percentage) : "—"}</td>
                    <td>{t ? <RiskBadge level={t.riskLevel} score={t.riskScore} /> : "—"}</td>
                    <td className="text-[12px] text-ink-500 whitespace-nowrap">
                      {fmtDateTime(a.assignedAt)}
                      {a.invitationCode && <div className="font-mono">{a.invitationCode}</div>}
                    </td>
                    <td className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="ghost" title="Extra time / attempts" onClick={() => setAdjust(a)}>
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                      </Button>
                      {!t && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Remove"
                          onClick={async () => {
                            try {
                              await api(`/exams/${exam.id}/assignments/${a.candidateId}`, { method: "DELETE" });
                              toast("Candidate removed");
                              reloadA();
                              reload();
                            } catch (e) {
                              toast((e as Error).message, "bad");
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {assignOpen && (
        <AssignDialog
          exam={exam}
          assigned={new Set((data ?? []).map((a) => a.candidateId))}
          onClose={() => setAssignOpen(false)}
          onDone={() => {
            reloadA();
            reload();
          }}
        />
      )}
      {adjust && <AdjustDialog exam={exam} a={adjust} onClose={() => setAdjust(null)} onDone={reloadA} />}
    </Card>
  );
}

function AssignDialog({ exam, assigned, onClose, onDone }: { exam: Exam; assigned: Set<string>; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[] | null>(null);
  const dq = useDebounced(q);
  const { data, loading } = useApi<Paged<{ id: string; college: string; degree: string; branch: string; graduationYear: number; user: { name: string; email: string } }>>(`/candidates${qs({ q: dq, page, pageSize: 12 })}`, [dq, page]);
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Assign candidates"
      description={`To: ${exam.title}`}
      footer={
        <>
          <Checkbox className="mr-auto self-center" checked={override} onChange={(e) => setOverride(e.target.checked)} label="Override eligibility rules" />
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            disabled={!selected.size}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api<{ assigned: number; skipped: { name: string; reason: string }[] }>(`/exams/${exam.id}/assignments`, { body: { candidateIds: [...selected], override } });
                toast(`${r.assigned} candidate(s) assigned`);
                setSkipped(r.skipped.length ? r.skipped : null);
                setSelected(new Set());
                onDone();
                if (!r.skipped.length) onClose();
              } catch (e) {
                toast((e as Error).message, "bad");
              } finally {
                setBusy(false);
              }
            }}
          >
            Assign {selected.size || ""}
          </Button>
        </>
      }
    >
      {skipped && (
        <Alert tone="warn" className="mb-3" title={`${skipped.length} candidate(s) not eligible`}>
          {skipped.map((s) => (
            <div key={s.name}>
              {s.name}: {s.reason}
            </div>
          ))}
        </Alert>
      )}
      <div className="relative mb-3">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" />
        <Input className="pl-8" placeholder="Search by name, email, college or mobile" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} autoFocus />
      </div>
      <div className="rounded border border-line">
        {loading && !data ? (
          <Spinner />
        ) : (
          <table className="table-base">
            <tbody>
              {data?.items.map((c) => {
                const already = assigned.has(c.id);
                return (
                  <tr key={c.id} className={already ? "opacity-50" : "row-hover"} onClick={() => !already && setSelected((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}>
                    <td className="w-8">
                      <input type="checkbox" className="h-4 w-4 accent-navy-900" disabled={already} checked={already || selected.has(c.id)} readOnly />
                    </td>
                    <td>
                      <div className="font-medium">{c.user.name}</div>
                      <div className="text-[12px] text-ink-500">{c.user.email}</div>
                    </td>
                    <td className="text-[12.5px]">
                      {c.degree} · {c.branch}
                      <div className="text-ink-500 truncate max-w-[260px]">{c.college} · {c.graduationYear}</div>
                    </td>
                    <td className="text-[12px] text-ink-500">{already ? "Already assigned" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
      </div>
    </Dialog>
  );
}

function AdjustDialog({ exam, a, onClose, onDone }: { exam: Exam; a: Assignment; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [extraAttempts, setExtraAttempts] = useState(a.extraAttempts);
  const [extraMinutes, setExtraMinutes] = useState(a.extraMinutes);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Adjust attempts and time"
      description={a.candidate.user.name}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              try {
                await api(`/exams/${exam.id}/assignments/${a.candidateId}`, { method: "PATCH", body: { extraAttempts, extraMinutes } });
                toast("Saved — recorded in the audit log");
                onDone();
                onClose();
              } catch (e) {
                toast((e as Error).message, "bad");
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Additional attempts" hint={`Base allowance: ${exam.maxAttempts}. Use after a verified technical failure.`}>
          <Input type="number" min={0} max={5} value={extraAttempts} onChange={(e) => setExtraAttempts(Number(e.target.value))} />
        </Field>
        <Field label="Additional minutes" hint="Applies to attempts started after this change (e.g. an approved accommodation).">
          <Input type="number" min={0} max={240} value={extraMinutes} onChange={(e) => setExtraMinutes(Number(e.target.value))} />
        </Field>
      </div>
    </Dialog>
  );
}

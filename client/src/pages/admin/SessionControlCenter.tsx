import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  FileSpreadsheet,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  UserCheck,
  UserX,
} from "lucide-react";
import { Badge, Button, Card, Dialog, Field, Input, PageHeader, Spinner, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { fmtDateTime } from "@/lib/format";
import { ExportExcelModal } from "@/components/ExportExcelModal";

interface CandidateControlRow {
  candidateId: string;
  candidateProfileId: string;
  name: string;
  email: string;
  mobile: string;
  college: string;
  branch: string;
  accessStatus: string;
  examStatus: string; // ACTIVE | PAUSED | DISCONNECTED | SUBMITTED | AUTO_SUBMITTED | ADMIN_SUBMITTED | TERMINATED | NOT_STARTED
  attemptId: string | null;
  attemptNo: number;
  currentSection: string;
  currentSectionIdx: number;
  timeRemainingSec: number | null;
  answeredCount: number;
  proctoringStatus: string;
  riskScore: number;
  lastActivity: string;
  reentryCount: number;
}

interface LiveControlData {
  session: {
    id: string;
    sessionName: string;
    examId: string;
    codeLastFour: string;
    codePrefix: string | null;
    startsAt: string;
    endsAt: string;
    maxCandidates: number;
    maxAttempts: number;
    status: string;
    exam: {
      id: string;
      title: string;
      durationMinutes: number;
      totalMarks: number;
      sections: { id: string; title: string; timeLimitMinutes: number | null }[];
    };
  };
  metrics: {
    totalRegistered: number;
    joined: number;
    currentlyActive: number;
    paused: number;
    submitted: number;
    disconnected: number;
    terminated: number;
  };
  candidates: CandidateControlRow[];
}

export default function SessionControlCenter() {
  const { id } = useParams();
  const toast = useToast();
  const { data, loading, reload } = useApi<LiveControlData>(`/sessions-control/${id}/live-control`, [id]);

  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());

  // Action Dialogs
  const [actionDialog, setActionDialog] = useState<{
    type: "SESSION_PAUSE" | "SESSION_RESUME" | "SESSION_TERMINATE" | "SESSION_RECOVER" | "CANDIDATE_PAUSE" | "CANDIDATE_RESUME" | "CANDIDATE_FORCE_SUBMIT" | "CANDIDATE_TERMINATE" | "CANDIDATE_REENTRY" | "BULK_ACTION";
    candidateId?: string;
    candidateName?: string;
    bulkAction?: "PAUSE" | "RESUME" | "FORCE_SUBMIT";
  } | null>(null);

  const [reason, setReason] = useState("");
  const [extendMinutes, setExtendMinutes] = useState(30);
  const [busy, setBusy] = useState(false);

  // Export Modal
  const [exportOpen, setExportOpen] = useState(false);

  if (loading || !data) return <Spinner />;

  const { session, metrics, candidates } = data;

  // Filter candidates
  const filteredCandidates = candidates.filter((c) => {
    if (filterStatus === "ACTIVE" && c.examStatus !== "ACTIVE") return false;
    if (filterStatus === "PAUSED" && c.examStatus !== "PAUSED") return false;
    if (filterStatus === "DISCONNECTED" && c.examStatus !== "DISCONNECTED") return false;
    if (filterStatus === "SUBMITTED" && !["SUBMITTED", "AUTO_SUBMITTED", "ADMIN_SUBMITTED", "EVALUATED"].includes(c.examStatus)) return false;
    if (filterStatus === "TERMINATED" && c.examStatus !== "TERMINATED") return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.college.toLowerCase().includes(q);
    }
    return true;
  });

  const toggleSelect = (candId: string) => {
    const next = new Set(selectedCandidates);
    if (next.has(candId)) next.delete(candId);
    else next.add(candId);
    setSelectedCandidates(next);
  };

  const toggleSelectAll = () => {
    if (selectedCandidates.size === filteredCandidates.length) {
      setSelectedCandidates(new Set());
    } else {
      setSelectedCandidates(new Set(filteredCandidates.map((c) => c.candidateId)));
    }
  };

  const executeAction = async () => {
    if (!actionDialog) return;
    setBusy(true);

    try {
      if (actionDialog.type === "SESSION_PAUSE") {
        await api(`/sessions-control/${session.id}/pause`, { method: "POST", body: { reason } });
        toast("Entire session has been paused.");
      } else if (actionDialog.type === "SESSION_RESUME") {
        await api(`/sessions-control/${session.id}/resume`, { method: "POST", body: { reason } });
        toast("Entire session has been resumed.");
      } else if (actionDialog.type === "SESSION_TERMINATE") {
        await api(`/sessions-control/${session.id}/terminate`, { method: "POST", body: { reason } });
        toast("Examination session terminated.");
      } else if (actionDialog.type === "SESSION_RECOVER") {
        await api(`/sessions-control/${session.id}/recover`, { method: "POST", body: { reason, extendMinutes } });
        toast("Terminated session recovered by Super Admin.");
      } else if (actionDialog.candidateId) {
        const act =
          actionDialog.type === "CANDIDATE_PAUSE"
            ? "pause"
            : actionDialog.type === "CANDIDATE_RESUME"
            ? "resume"
            : actionDialog.type === "CANDIDATE_FORCE_SUBMIT"
            ? "force-submit"
            : actionDialog.type === "CANDIDATE_TERMINATE"
            ? "terminate"
            : "allow-reentry";

        await api(`/sessions-control/${session.id}/candidates/${actionDialog.candidateId}/${act}`, {
          method: "POST",
          body: { reason },
        });
        toast(`Candidate action '${act}' executed.`);
      } else if (actionDialog.type === "BULK_ACTION" && actionDialog.bulkAction) {
        await api(`/sessions-control/${session.id}/bulk-action`, {
          method: "POST",
          body: {
            action: actionDialog.bulkAction,
            candidateIds: Array.from(selectedCandidates),
            reason,
          },
        });
        toast(`Bulk ${actionDialog.bulkAction} applied.`);
        setSelectedCandidates(new Set());
      }

      setActionDialog(null);
      setReason("");
      reload();
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const getStatusBadge = (st: string) => {
    switch (st) {
      case "ACTIVE":
        return <Badge tone="ok">Active</Badge>;
      case "PAUSED":
        return <Badge tone="warn">Paused</Badge>;
      case "DISCONNECTED":
        return <Badge tone="warn">Disconnected</Badge>;
      case "SUBMITTED":
      case "EVALUATED":
        return <Badge tone="navy">Submitted</Badge>;
      case "AUTO_SUBMITTED":
        return <Badge tone="navy">Auto Submitted</Badge>;
      case "ADMIN_SUBMITTED":
        return <Badge tone="navy">Admin Submitted</Badge>;
      case "TERMINATED":
        return <Badge tone="bad">Terminated</Badge>;
      default:
        return <Badge tone="neutral">Not Started</Badge>;
    }
  };

  const formatSec = (sec: number | null) => {
    if (sec === null || sec < 0) return "—";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s < 10 ? "0" : ""}${s}s`;
  };

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        back={
          <Link to="/admin/sessions" className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-ink-500 hover:text-ink-900">
            <ArrowLeft className="h-3.5 w-3.5" /> Session Management
          </Link>
        }
        title={session.sessionName}
        subtitle={
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
            <span className="font-semibold text-navy-900">{session.exam.title}</span>
            <span>·</span>
            <span className="font-mono bg-sand-100 px-2 py-0.5 rounded border border-line font-bold text-navy-900">
              Code: ••-{session.codeLastFour}
            </span>
            <span>·</span>
            <span>Window: {fmtDateTime(session.startsAt)} — {fmtDateTime(session.endsAt)}</span>
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setExportOpen(true)}>
              <FileSpreadsheet className="h-4 w-4" /> Export Excel (.xlsx)
            </Button>

            {session.status === "ACTIVE" ? (
              <Button variant="secondary" onClick={() => setActionDialog({ type: "SESSION_PAUSE" })}>
                <Pause className="h-4 w-4 text-amber-600" /> Pause Session
              </Button>
            ) : session.status === "PAUSED" ? (
              <Button variant="secondary" onClick={() => setActionDialog({ type: "SESSION_RESUME" })}>
                <Play className="h-4 w-4 text-emerald-600" /> Resume Session
              </Button>
            ) : null}

            {session.status !== "TERMINATED" ? (
              <Button variant="danger" onClick={() => setActionDialog({ type: "SESSION_TERMINATE" })}>
                <ShieldAlert className="h-4 w-4" /> Terminate Session
              </Button>
            ) : (
              <Button onClick={() => setActionDialog({ type: "SESSION_RECOVER" })}>
                <RefreshCw className="h-4 w-4" /> Recover Session (Super Admin)
              </Button>
            )}
          </div>
        }
      />

      {/* Live Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-7 gap-2.5 text-xs">
        <div className="p-3 bg-white rounded-lg border border-line shadow-xs">
          <span className="text-ink-500 block mb-1">Registered</span>
          <span className="font-bold text-lg font-mono text-ink-900">{metrics.totalRegistered}</span>
        </div>
        <div className="p-3 bg-white rounded-lg border border-line shadow-xs">
          <span className="text-ink-500 block mb-1">Joined</span>
          <span className="font-bold text-lg font-mono text-steel-700">{metrics.joined}</span>
        </div>
        <div className="p-3 bg-white rounded-lg border border-line shadow-xs">
          <span className="text-ink-500 block mb-1">Active</span>
          <span className="font-bold text-lg font-mono text-emerald-700">{metrics.currentlyActive}</span>
        </div>
        <div className="p-3 bg-white rounded-lg border border-line shadow-xs">
          <span className="text-ink-500 block mb-1">Paused</span>
          <span className="font-bold text-lg font-mono text-amber-600">{metrics.paused}</span>
        </div>
        <div className="p-3 bg-white rounded-lg border border-line shadow-xs">
          <span className="text-ink-500 block mb-1">Submitted</span>
          <span className="font-bold text-lg font-mono text-navy-900">{metrics.submitted}</span>
        </div>
        <div className="p-3 bg-white rounded-lg border border-line shadow-xs">
          <span className="text-ink-500 block mb-1">Disconnected</span>
          <span className="font-bold text-lg font-mono text-amber-700">{metrics.disconnected}</span>
        </div>
        <div className="p-3 bg-white rounded-lg border border-line shadow-xs">
          <span className="text-ink-500 block mb-1">Terminated</span>
          <span className="font-bold text-lg font-mono text-rose-700">{metrics.terminated}</span>
        </div>
      </div>

      {/* Main Candidate Monitoring Table */}
      <Card padded={false}>
        {/* Filter and Bulk Bar */}
        <div className="p-3.5 border-b border-line bg-surface/50 flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Status Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: "ALL", label: `All (${candidates.length})` },
              { id: "ACTIVE", label: `Active (${metrics.currentlyActive})` },
              { id: "PAUSED", label: `Paused (${metrics.paused})` },
              { id: "DISCONNECTED", label: `Disconnected (${metrics.disconnected})` },
              { id: "SUBMITTED", label: `Submitted (${metrics.submitted})` },
              { id: "TERMINATED", label: `Terminated (${metrics.terminated})` },
            ].map((st) => (
              <button
                key={st.id}
                onClick={() => setFilterStatus(st.id)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  filterStatus === st.id
                    ? "bg-navy-900 text-white font-semibold"
                    : "bg-white text-ink-600 hover:bg-sand-100 border border-line"
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-ink-400" />
            <Input
              className="pl-8 text-xs py-1.5"
              placeholder="Search candidate name, email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Bulk Action Controls */}
        {selectedCandidates.size > 0 && (
          <div className="p-3 bg-navy-900 text-white flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="font-medium">
              {selectedCandidates.size} candidate(s) selected
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setActionDialog({ type: "BULK_ACTION", bulkAction: "PAUSE" })}
              >
                <Pause className="h-3.5 w-3.5" /> Pause Selected
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setActionDialog({ type: "BULK_ACTION", bulkAction: "RESUME" })}
              >
                <Play className="h-3.5 w-3.5" /> Resume Selected
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => setActionDialog({ type: "BULK_ACTION", bulkAction: "FORCE_SUBMIT" })}
              >
                Force Submit Selected
              </Button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="table-base text-xs">
            <thead>
              <tr>
                <th className="w-8">
                  <input
                    type="checkbox"
                    checked={selectedCandidates.size === filteredCandidates.length && filteredCandidates.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-line text-navy-900 h-3.5 w-3.5"
                  />
                </th>
                <th>Candidate Name</th>
                <th>Status</th>
                <th>Current Stage</th>
                <th className="text-right">Time Left</th>
                <th className="text-right">Answered</th>
                <th>Proctoring</th>
                <th>Last Active</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCandidates.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-ink-500">
                    No candidates found matching the selected filter.
                  </td>
                </tr>
              ) : (
                filteredCandidates.map((c) => (
                  <tr key={c.candidateId} className="hover:bg-sand-50/50">
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedCandidates.has(c.candidateId)}
                        onChange={() => toggleSelect(c.candidateId)}
                        className="rounded border-line text-navy-900 h-3.5 w-3.5"
                      />
                    </td>
                    <td>
                      <span className="font-semibold text-navy-900 block">{c.name}</span>
                      <span className="text-[11px] text-ink-400 block font-mono">{c.email}</span>
                    </td>
                    <td>{getStatusBadge(c.examStatus)}</td>
                    <td className="font-medium text-ink-800">
                      {c.currentSection}
                    </td>
                    <td className="text-right font-mono font-medium">
                      {formatSec(c.timeRemainingSec)}
                    </td>
                    <td className="text-right font-mono">
                      {c.answeredCount}
                    </td>
                    <td>
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded ${
                          c.riskScore > 40
                            ? "bg-rose-50 text-rose-700 border border-rose-200"
                            : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        }`}
                      >
                        {c.proctoringStatus}
                      </span>
                    </td>
                    <td className="text-[11px] text-ink-500">
                      {fmtDateTime(c.lastActivity)}
                    </td>
                    <td className="text-right">
                      <div className="inline-flex items-center gap-1">
                        {c.examStatus === "ACTIVE" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setActionDialog({
                                type: "CANDIDATE_PAUSE",
                                candidateId: c.candidateId,
                                candidateName: c.name,
                              })
                            }
                            title="Pause Candidate"
                          >
                            <Pause className="h-3.5 w-3.5 text-amber-600" />
                          </Button>
                        )}

                        {c.examStatus === "PAUSED" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setActionDialog({
                                type: "CANDIDATE_RESUME",
                                candidateId: c.candidateId,
                                candidateName: c.name,
                              })
                            }
                            title="Resume Candidate"
                          >
                            <Play className="h-3.5 w-3.5 text-emerald-600" />
                          </Button>
                        )}

                        {(c.examStatus === "ACTIVE" || c.examStatus === "PAUSED" || c.examStatus === "DISCONNECTED") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setActionDialog({
                                type: "CANDIDATE_FORCE_SUBMIT",
                                candidateId: c.candidateId,
                                candidateName: c.name,
                              })
                            }
                            title="Force Submit Candidate"
                          >
                            <UserCheck className="h-3.5 w-3.5 text-navy-800" />
                          </Button>
                        )}

                        {c.examStatus === "DISCONNECTED" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setActionDialog({
                                type: "CANDIDATE_REENTRY",
                                candidateId: c.candidateId,
                                candidateName: c.name,
                              })
                            }
                            title="Allow Re-entry"
                          >
                            <RefreshCw className="h-3.5 w-3.5 text-emerald-600" />
                          </Button>
                        )}

                        {c.examStatus !== "TERMINATED" && !["SUBMITTED", "AUTO_SUBMITTED", "ADMIN_SUBMITTED", "EVALUATED"].includes(c.examStatus) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setActionDialog({
                                type: "CANDIDATE_TERMINATE",
                                candidateId: c.candidateId,
                                candidateName: c.name,
                              })
                            }
                            title="Terminate Candidate Attempt"
                          >
                            <UserX className="h-3.5 w-3.5 text-rose-600" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Action Confirmation Modal */}
      {actionDialog && (
        <Dialog
          open={!!actionDialog}
          onClose={() => setActionDialog(null)}
          title={`Confirm Action: ${actionDialog.type.replace(/_/g, " ")}`}
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setActionDialog(null)}>
                Cancel
              </Button>
              <Button loading={busy} onClick={executeAction}>
                Confirm & Apply
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-xs">
            <p className="text-ink-700">
              {actionDialog.candidateName
                ? `You are performing this action on candidate: ${actionDialog.candidateName}.`
                : actionDialog.type === "BULK_ACTION"
                ? `You are performing bulk ${actionDialog.bulkAction} on ${selectedCandidates.size} candidate(s).`
                : `You are modifying the entire session: ${session.sessionName}.`}
            </p>

            {actionDialog.type === "SESSION_RECOVER" && (
              <Field label="Extend Window (Minutes)">
                <Input
                  type="number"
                  min={5}
                  max={180}
                  value={extendMinutes}
                  onChange={(e) => setExtendMinutes(parseInt(e.target.value, 10) || 30)}
                />
              </Field>
            )}

            <Field
              label="Action Reason"
              required={actionDialog.type.includes("TERMINATE") || actionDialog.type.includes("FORCE_SUBMIT") || actionDialog.type.includes("RECOVER")}
            >
              <Input
                placeholder="Specify the operational reason..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          </div>
        </Dialog>
      )}

      {/* Export Excel Modal */}
      <ExportExcelModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        sessionId={session.id}
        examId={session.examId}
      />
    </div>
  );
}

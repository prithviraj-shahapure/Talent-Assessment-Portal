import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, Copy, FileSpreadsheet, Lock, Pause, Play, Plus, RefreshCw, ShieldAlert, Trash2, Users } from "lucide-react";
import { Badge, Button, Card, Dialog, Field, Input, PageHeader, Select, Spinner, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { fmtDateTime } from "@/lib/format";
import type { Exam } from "@/lib/types";
import { ExportExcelModal } from "@/components/ExportExcelModal";

interface SessionItem {
  id: string;
  sessionName: string;
  examId: string;
  examTitle: string;
  examDurationMinutes: number;
  codeLastFour: string;
  codePrefix: string | null;
  startsAt: string;
  endsAt: string;
  maxCandidates: number;
  maxAttempts: number;
  status: "SCHEDULED" | "ACTIVE" | "PAUSED" | "EXPIRED" | "COMPLETED" | "REVOKED";
  createdByName: string;
  createdAt: string;
  totalInvited: number;
  joinedCount: number;
  appearingCount: number;
  completedCount: number;
}

interface SessionMetrics {
  totalSessions: number;
  activeSessions: number;
  scheduledSessions: number;
  expiredSessions: number;
  totalInvited: number;
  totalJoined: number;
  totalAppearing: number;
  totalCompleted: number;
}

export default function SessionManagement() {
  const nav = useNavigate();
  const toast = useToast();
  const { data, loading, reload } = useApi<{ sessions: SessionItem[]; metrics: SessionMetrics }>("/sessions");
  const { data: exams } = useApi<Exam[]>("/exams?status=PUBLISHED");
  const [exportModalOpen, setExportModalOpen] = useState(false);

  // Create Modal
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sessionForm, setSessionForm] = useState({
    sessionName: "",
    examId: "",
    customCode: "",
    startsAt: new Date().toISOString().slice(0, 16),
    endsAt: new Date(Date.now() + 86400_000).toISOString().slice(0, 16),
    maxCandidates: 100,
    maxAttempts: 1,
    status: "SCHEDULED" as const,
  });

  // Created Code Reveal Modal
  const [revealedCode, setRevealedCode] = useState<string | null>(null);

  // Manage candidates modal
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const { data: sessionDetail, reload: reloadDetail } = useApi<any>(selectedSession ? `/sessions/${selectedSession}` : null, [selectedSession]);
  const [newEmails, setNewEmails] = useState("");
  const [assigning, setAssigning] = useState(false);

  const handleCreate = async () => {
    if (!sessionForm.sessionName.trim() || !sessionForm.examId) {
      toast("Please provide session name and select an examination", "bad");
      return;
    }
    setCreating(true);
    try {
      const res = await api<{ session: SessionItem; generatedCode: string }>("/sessions", {
        method: "POST",
        body: sessionForm,
      });

      setCreateOpen(false);
      setRevealedCode(res.generatedCode);
      toast("Session created successfully!");
      reload();
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setCreating(false);
    }
  };

  const handleStatusChange = async (id: string, status: string) => {
    try {
      await api(`/sessions/${id}/status`, {
        method: "POST",
        body: { status },
      });
      toast(`Session marked as ${status}`);
      reload();
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  };

  const handleRegenerateCode = async (id: string) => {
    const custom = prompt("Enter a custom session code, or leave blank to generate automatically:");
    if (custom === null) return;

    try {
      const res = await api<{ newCode: string }>(`/sessions/${id}/regenerate-code`, {
        method: "POST",
        body: { customCode: custom.trim() || null },
      });
      setRevealedCode(res.newCode);
      toast("Session code regenerated!");
      reload();
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  };

  const handleAddCandidates = async () => {
    if (!newEmails.trim() || !selectedSession) return;
    const emailList = newEmails
      .split(/[\n,;]+/)
      .map((e) => e.trim())
      .filter((e) => e.includes("@"));

    if (emailList.length === 0) {
      toast("No valid emails found", "bad");
      return;
    }

    setAssigning(true);
    try {
      await api(`/sessions/${selectedSession}/candidates`, {
        method: "POST",
        body: { emails: emailList },
      });
      toast(`Added ${emailList.length} candidate(s) to session`);
      setNewEmails("");
      reloadDetail();
      reload();
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setAssigning(false);
    }
  };

  const statusTone = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return "ok";
      case "SCHEDULED":
        return "navy";
      case "PAUSED":
        return "warn";
      case "EXPIRED":
        return "neutral";
      case "REVOKED":
        return "bad";
      default:
        return "neutral";
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Session Code Management"
        subtitle="Generate unique, cryptographically hashed session codes and manage candidate batches with schedule, capacity, and anti-cheat controls."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setExportModalOpen(true)}>
              <FileSpreadsheet className="h-4 w-4" /> Export Report (.xlsx)
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Create Examination Session
            </Button>
          </div>
        }
      />

      {/* Metrics Cards */}
      {data?.metrics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-3.5 bg-white rounded-lg border border-line shadow-xs">
            <span className="text-ink-500 block mb-1">Active Sessions</span>
            <span className="font-bold text-xl text-emerald-700 font-mono">{data.metrics.activeSessions}</span>
          </div>
          <div className="p-3.5 bg-white rounded-lg border border-line shadow-xs">
            <span className="text-ink-500 block mb-1">Scheduled Sessions</span>
            <span className="font-bold text-xl text-navy-900 font-mono">{data.metrics.scheduledSessions}</span>
          </div>
          <div className="p-3.5 bg-white rounded-lg border border-line shadow-xs">
            <span className="text-ink-500 block mb-1">Candidates Joined</span>
            <span className="font-bold text-xl text-steel-700 font-mono">
              {data.metrics.totalJoined} / {data.metrics.totalInvited}
            </span>
          </div>
          <div className="p-3.5 bg-white rounded-lg border border-line shadow-xs">
            <span className="text-ink-500 block mb-1">Currently Appearing</span>
            <span className="font-bold text-xl text-amber-600 font-mono">{data.metrics.totalAppearing}</span>
          </div>
        </div>
      )}

      {/* Sessions Table */}
      <Card padded={false} title="Configured Examination Sessions">
        {loading && !data ? (
          <Spinner />
        ) : !data?.sessions.length ? (
          <div className="p-10 text-center text-xs text-ink-500">
            No examination sessions found. Create a session to generate session codes for candidates.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base text-xs">
              <thead>
                <tr>
                  <th>Session Name</th>
                  <th>Associated Exam</th>
                  <th>Session Code</th>
                  <th>Window Schedule</th>
                  <th className="text-right">Capacity</th>
                  <th className="text-right">Joined</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.map((s) => (
                  <tr key={s.id} className="hover:bg-sand-50/50">
                    <td className="font-semibold text-navy-900">
                      {s.sessionName}
                      <span className="text-[11px] text-ink-400 block font-normal">By {s.createdByName}</span>
                    </td>
                    <td>
                      <span className="font-medium text-ink-900">{s.examTitle}</span>
                      <span className="text-[11px] text-ink-500 block font-mono">{s.examDurationMinutes}m</span>
                    </td>
                    <td>
                      <div className="inline-flex items-center gap-1.5 font-mono font-bold bg-sand-100 px-2 py-1 rounded border border-line">
                        <Lock className="h-3 w-3 text-ink-400" />
                        <span>{s.codePrefix ? `${s.codePrefix}-••-` : "••••-"}</span>
                        <span className="text-navy-900">{s.codeLastFour}</span>
                      </div>
                    </td>
                    <td className="text-[11px] text-ink-600">
                      <div>{fmtDateTime(s.startsAt)}</div>
                      <div className="text-ink-400">to {fmtDateTime(s.endsAt)}</div>
                    </td>
                    <td className="text-right font-mono">{s.maxCandidates}</td>
                    <td className="text-right font-mono">
                      <span className="font-bold text-emerald-700">{s.joinedCount}</span>
                      <span className="text-ink-400">/{s.totalInvited}</span>
                    </td>
                    <td>
                      <Badge tone={statusTone(s.status) as any}>{s.status}</Badge>
                    </td>
                    <td className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => nav(`/admin/sessions/${s.id}/control`)}
                          title="Open Session Control Center"
                        >
                          <Activity className="h-3.5 w-3.5 text-navy-800" /> Control
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedSession(s.id)}
                          title="Manage Candidates"
                        >
                          <Users className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRegenerateCode(s.id)}
                          title="Regenerate Code"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                        {s.status === "ACTIVE" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleStatusChange(s.id, "PAUSED")}
                            title="Pause Session"
                          >
                            <Pause className="h-3.5 w-3.5 text-amber-600" />
                          </Button>
                        ) : s.status === "PAUSED" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleStatusChange(s.id, "ACTIVE")}
                            title="Resume Session"
                          >
                            <Play className="h-3.5 w-3.5 text-emerald-600" />
                          </Button>
                        ) : null}
                        {s.status !== "REVOKED" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (confirm(`Revoke session "${s.sessionName}"? Candidates will no longer be able to access the exam.`)) {
                                handleStatusChange(s.id, "REVOKED");
                              }
                            }}
                            title="Revoke Session"
                          >
                            <ShieldAlert className="h-3.5 w-3.5 text-rose-600" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create Session Dialog */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create New Examination Session"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button loading={creating} onClick={handleCreate}>
              Generate Session Code
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-xs">
          <Field label="Session Name" required hint="e.g. Campus Recruitment 2026 - Batch A">
            <Input
              value={sessionForm.sessionName}
              onChange={(e) => setSessionForm({ ...sessionForm, sessionName: e.target.value })}
              placeholder="e.g. Batch A - Technical Assessment"
            />
          </Field>

          <Field label="Associated Examination" required>
            <Select
              value={sessionForm.examId}
              onChange={(e) => setSessionForm({ ...sessionForm, examId: e.target.value })}
            >
              <option value="">Select an examination...</option>
              {exams?.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.title} ({ex.durationMinutes}m · {ex.totalMarks}M)
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Custom Session Code (Optional)"
            hint="Leave blank to automatically generate a secure, unpredictable code like ZG-TECH-8472."
          >
            <Input
              value={sessionForm.customCode}
              onChange={(e) => setSessionForm({ ...sessionForm, customCode: e.target.value.toUpperCase() })}
              placeholder="e.g. ZANVAR2026 or APTI2026"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Session Start Time" required>
              <Input
                type="datetime-local"
                value={sessionForm.startsAt}
                onChange={(e) => setSessionForm({ ...sessionForm, startsAt: e.target.value })}
              />
            </Field>
            <Field label="Session End Time" required>
              <Input
                type="datetime-local"
                value={sessionForm.endsAt}
                onChange={(e) => setSessionForm({ ...sessionForm, endsAt: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Max Candidate Capacity">
              <Input
                type="number"
                min={1}
                value={sessionForm.maxCandidates}
                onChange={(e) => setSessionForm({ ...sessionForm, maxCandidates: parseInt(e.target.value, 10) || 100 })}
              />
            </Field>
            <Field label="Max Attempts Per Candidate">
              <Input
                type="number"
                min={1}
                max={5}
                value={sessionForm.maxAttempts}
                onChange={(e) => setSessionForm({ ...sessionForm, maxAttempts: parseInt(e.target.value, 10) || 1 })}
              />
            </Field>
          </div>
        </div>
      </Dialog>

      {/* Session Code Reveal Modal */}
      {revealedCode && (
        <Dialog
          open={!!revealedCode}
          onClose={() => setRevealedCode(null)}
          title="Session Code Generated"
          size="sm"
        >
          <div className="space-y-4 text-center">
            <div className="p-4 bg-navy-900 text-white rounded-lg">
              <span className="text-[11px] text-white/70 block uppercase tracking-wider mb-1 font-semibold">
                Candidate Access Code
              </span>
              <div className="font-mono text-2xl font-bold tracking-widest text-amber-300 select-all">
                {revealedCode}
              </div>
            </div>

            <p className="text-xs text-ink-600 leading-relaxed">
              <strong>Security Notice:</strong> This code is stored cryptographically hashed in the database. Share this code with candidates now or copy it to your clipboard.
            </p>

            <div className="flex gap-2 justify-center pt-2">
              <Button
                variant="secondary"
                onClick={() => {
                  navigator.clipboard.writeText(revealedCode);
                  toast("Session code copied to clipboard!");
                }}
              >
                <Copy className="h-4 w-4" /> Copy Code
              </Button>
              <Button onClick={() => setRevealedCode(null)}>Done</Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Candidate Assignment Modal */}
      {selectedSession && sessionDetail && (
        <Dialog
          open={!!selectedSession}
          onClose={() => setSelectedSession(null)}
          title={`Session Candidates: ${sessionDetail.sessionName}`}
          size="lg"
        >
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-surface rounded-lg border border-line">
              <h4 className="font-semibold text-navy-900 mb-1">Invite Candidates by Email</h4>
              <p className="text-[11px] text-ink-500 mb-2">
                Enter emails separated by commas or newlines. Candidates will be pre-mapped to this session.
              </p>
              <div className="flex gap-2">
                <textarea
                  rows={2}
                  className="flex-1 rounded border border-line p-2 font-mono text-xs focus:ring-1 focus:ring-navy-900"
                  placeholder="candidate1@example.com, candidate2@example.com"
                  value={newEmails}
                  onChange={(e) => setNewEmails(e.target.value)}
                />
                <Button loading={assigning} onClick={handleAddCandidates}>
                  Assign Candidates
                </Button>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="font-semibold text-navy-900">
                  Assigned Candidates ({sessionDetail.candidates?.length || 0})
                </span>
                <span className="text-[11px] text-ink-500">
                  Capacity: {sessionDetail.maxCandidates}
                </span>
              </div>
              <div className="max-h-60 overflow-y-auto border border-line rounded-lg">
                <table className="table-base text-xs">
                  <thead>
                    <tr>
                      <th>Candidate Name</th>
                      <th>Email</th>
                      <th>Access Status</th>
                      <th>Joined At</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {sessionDetail.candidates?.map((sc: any) => (
                      <tr key={sc.id}>
                        <td className="font-medium text-navy-900">{sc.candidate?.user?.name}</td>
                        <td className="font-mono text-ink-600">{sc.candidate?.user?.email}</td>
                        <td>
                          <Badge tone={statusTone(sc.accessStatus) as any}>{sc.accessStatus}</Badge>
                        </td>
                        <td className="text-ink-500 font-mono text-[11px]">
                          {sc.joinedAt ? fmtDateTime(sc.joinedAt) : "Not yet"}
                        </td>
                        <td className="text-right">
                          <button
                            className="p-1 rounded text-ink-400 hover:text-rose-600"
                            onClick={async () => {
                              await api(`/sessions/${selectedSession}/candidates/${sc.candidateId}`, {
                                method: "DELETE",
                              });
                              toast("Candidate removed from session");
                              reloadDetail();
                              reload();
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Dialog>
      )}

      <ExportExcelModal
        open={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
      />
    </div>
  );
}

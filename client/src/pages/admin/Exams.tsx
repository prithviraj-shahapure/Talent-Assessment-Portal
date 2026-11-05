import { useMemo, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  Archive,
  Copy,
  Edit3,
  Eye,
  FileText,
  MoreVertical,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useApi, useDebounced } from "@/hooks/useApi";
import { useAuth } from "@/lib/auth";
import { api, qs } from "@/lib/api";
import {
  Alert,
  Button,
  Card,
  Dialog,
  EmptyState,
  ExamStatusBadge,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Tabs,
  Toolbar,
  useToast,
} from "@/components/ui";
import { fmtDateTime, fmtPct } from "@/lib/format";
import type { Department, Exam } from "@/lib/types";
import { cn } from "@/lib/cn";

type Phase = "all" | "live" | "upcoming" | "completed" | "draft" | "archived";

interface DeletionImpact {
  examId: string;
  examTitle: string;
  status: string;
  department: string;
  sessionCount: number;
  activeSessionCount: number;
  candidateCount: number;
  attemptCount: number;
  completedAttemptsCount: number;
  hasAttempts: boolean;
  canPermanentDelete: boolean;
  actionType: "ARCHIVE" | "PERMANENT_DELETE";
  isOwner: boolean;
  isSuperAdmin: boolean;
  warningMessage: string;
}

export default function Exams() {
  const nav = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>("all");
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const dq = useDebounced(q);

  const queryParams = useMemo(() => {
    const base: Record<string, string> = { q: dq, departmentId: dept };
    if (phase === "draft") base.status = "DRAFT";
    else if (phase === "archived") base.status = "ARCHIVED";
    else if (phase !== "all") base.phase = phase;
    return base;
  }, [dq, dept, phase]);

  const { data, loading, reload } = useApi<Exam[]>(`/exams${qs(queryParams)}`, [dq, dept, phase]);
  const { data: depts } = useApi<Department[]>("/departments");
  const counts = useMemo(() => data?.length ?? 0, [data]);

  // Delete / Archive Modal State
  const [deleteTarget, setDeleteTarget] = useState<Exam | null>(null);
  const [impact, setImpact] = useState<DeletionImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Duplicating state
  const [dupBusy, setDupBusy] = useState<string | null>(null);

  const handleOpenDeleteModal = async (exam: Exam) => {
    setDeleteTarget(exam);
    setConfirmName("");
    setDeleteReason("");
    setImpactLoading(true);
    setImpact(null);
    try {
      const res = await api<DeletionImpact>(`/exams/${exam.id}/deletion-impact`);
      setImpact(res);
    } catch (err) {
      toast((err as Error).message || "Failed to load deletion impact", "bad");
      setDeleteTarget(null);
    } finally {
      setImpactLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !impact) return;
    setDeleteBusy(true);
    try {
      const res = await api<{ success: boolean; mode: string; message: string }>(`/exams/${deleteTarget.id}/delete`, {
        method: "POST",
        body: {
          confirmationName: confirmName.trim(),
          reason: deleteReason.trim(),
        },
      });

      toast(res.message || "Operation completed successfully", "ok");
      setDeleteTarget(null);
      reload();
    } catch (err) {
      toast((err as Error).message || "Failed to delete examination", "bad");
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleDuplicate = async (examId: string) => {
    setDupBusy(examId);
    try {
      const copy = await api<Exam>(`/exams/${examId}/duplicate`, { method: "POST" });
      toast(`Duplicated examination as "${copy.title}"`, "ok");
      reload();
      nav(`/admin/exams/${copy.id}`);
    } catch (err) {
      toast((err as Error).message || "Failed to duplicate examination", "bad");
    } finally {
      setDupBusy(null);
    }
  };

  const isConfirmationMatched = useMemo(() => {
    if (!deleteTarget || !impact) return false;
    // For exams with attempts or non-draft exams, require typing exact title
    if (impact.hasAttempts || deleteTarget.status !== "DRAFT") {
      return confirmName.trim().toLowerCase() === deleteTarget.title.trim().toLowerCase();
    }
    return true;
  }, [confirmName, deleteTarget, impact]);

  return (
    <div>
      <PageHeader
        title="Examinations"
        subtitle="Create, schedule, publish, and manage assessments."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => nav("/admin/exams/new")}>
              <Plus className="h-4 w-4" /> Quick Exam
            </Button>
            <Button onClick={() => nav("/admin/exams/wizard")}>
              <Plus className="h-4 w-4" /> Multi-Stage Builder
            </Button>
          </div>
        }
      />

      <Card padded={false}>
        <Tabs
          className="px-3"
          value={phase}
          onChange={setPhase}
          items={[
            { value: "all", label: "All" },
            { value: "live", label: "Live" },
            { value: "upcoming", label: "Upcoming" },
            { value: "completed", label: "Completed" },
            { value: "draft", label: "Drafts" },
            { value: "archived", label: "Archived" },
          ]}
        />
        <Toolbar>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" />
            <Input className="pl-8" placeholder="Search examinations..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-full sm:w-56" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">All departments</option>
            {depts?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <span className="ml-auto text-[12px] text-ink-500 num">{counts} examination(s)</span>
        </Toolbar>

        {loading && !data ? (
          <Spinner />
        ) : !data?.length ? (
          <EmptyState
            icon={<FileText className="h-7 w-7" />}
            title="No examinations found"
            body="Create an examination to start assessing candidates."
            action={<Button onClick={() => nav("/admin/exams/wizard")}>Create Examination</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Examination</th>
                  <th>Status</th>
                  <th>Window</th>
                  <th className="text-right">Duration</th>
                  <th className="text-right">Marks</th>
                  <th className="text-right">Assigned</th>
                  <th className="text-right">Submitted</th>
                  <th className="text-right">Avg score</th>
                  <th className="text-right pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.map((e) => (
                  <tr
                    key={e.id}
                    className="row-hover cursor-pointer"
                    onClick={() => nav(`/admin/exams/${e.id}`)}
                  >
                    <td className="max-w-[320px]">
                      <div className="font-medium text-ink-900 truncate">{e.title}</div>
                      <div className="text-[12px] text-ink-500 truncate">
                        {[e.department?.name, e.position].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </td>
                    <td>
                      <ExamStatusBadge status={e.status} startAt={e.startAt} endAt={e.endAt} />
                    </td>
                    <td className="whitespace-nowrap text-[12.5px] text-ink-700">
                      {fmtDateTime(e.startAt)}
                      <div className="text-ink-400">to {fmtDateTime(e.endAt)}</div>
                    </td>
                    <td className="num text-right">{e.durationMinutes} min</td>
                    <td className="num text-right">
                      {e.totalMarks}
                      <span className="text-ink-400"> / pass {e.passingMarks}</span>
                    </td>
                    <td className="num text-right">{e._count?.assignments ?? 0}</td>
                    <td className="num text-right">{e.submittedCount ?? 0}</td>
                    <td className="num text-right">{fmtPct(e.avgPercentage ? Math.round(e.avgPercentage * 10) / 10 : null)}</td>
                    <td
                      className="text-right whitespace-nowrap pr-4"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      <ExamRowActionsMenu
                        exam={e}
                        isSuperAdmin={user?.role === "SUPER_ADMIN"}
                        currentUserId={user?.id}
                        isDuplicating={dupBusy === e.id}
                        onView={() => nav(`/admin/exams/${e.id}`)}
                        onEdit={() => nav(`/admin/exams/${e.id}`)}
                        onDuplicate={() => handleDuplicate(e.id)}
                        onDelete={() => handleOpenDeleteModal(e)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── SECURE DELETION & ARCHIVAL CONFIRMATION MODAL ───────────────────────── */}
      <Dialog
        open={!!deleteTarget}
        onClose={() => !deleteBusy && setDeleteTarget(null)}
        title={
          impact?.hasAttempts
            ? "Archive Examination & Revoke Access"
            : deleteTarget?.status === "DRAFT"
            ? "Delete Draft Examination"
            : "Permanently Delete Examination"
        }
        size="lg"
      >
        {impactLoading ? (
          <div className="py-12 text-center">
            <Spinner className="mx-auto" />
            <p className="mt-3 text-sm text-ink-500">Inspecting examination dependency graph and candidate records...</p>
          </div>
        ) : impact && deleteTarget ? (
          <div className="space-y-4">
            {/* Header Details */}
            <div className="rounded-lg bg-sand-100 p-4 border border-line">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs uppercase font-mono tracking-wider text-ink-500">
                  {impact.department}
                </span>
                <ExamStatusBadge status={deleteTarget.status} startAt={deleteTarget.startAt} endAt={deleteTarget.endAt} />
              </div>
              <h3 className="mt-1 text-base font-bold text-navy-950">{deleteTarget.title}</h3>
            </div>

            {/* Impact Metric Cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-line bg-white p-3 text-center">
                <div className="text-[11px] font-semibold text-ink-500 uppercase">Sessions</div>
                <div className="mt-1 text-xl font-bold num text-navy-950">{impact.sessionCount}</div>
                {impact.activeSessionCount > 0 && (
                  <div className="text-[10.5px] text-bad-600 font-medium">
                    {impact.activeSessionCount} active
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-line bg-white p-3 text-center">
                <div className="text-[11px] font-semibold text-ink-500 uppercase">Registered</div>
                <div className="mt-1 text-xl font-bold num text-navy-950">{impact.candidateCount}</div>
                <div className="text-[10.5px] text-ink-400">candidates</div>
              </div>
              <div className="rounded-lg border border-line bg-white p-3 text-center">
                <div className="text-[11px] font-semibold text-ink-500 uppercase">Attempts</div>
                <div className="mt-1 text-xl font-bold num text-navy-950">{impact.attemptCount}</div>
                <div className="text-[10.5px] text-ok-600 font-medium">
                  {impact.completedAttemptsCount} completed
                </div>
              </div>
            </div>

            {/* Integrity Rules Banner */}
            {impact.hasAttempts ? (
              <Alert tone="warn" title="Recruiting Record Integrity Protection">
                <p className="text-xs leading-relaxed">
                  Candidates have attempted this examination. To preserve recruitment records, audit compliance, and candidate scoring history, this examination will be <strong>safely archived</strong> instead of deleted. All associated active session codes will be revoked to prevent new submissions.
                </p>
              </Alert>
            ) : (
              <Alert tone="bad" title="Permanent Record Deletion">
                <p className="text-xs leading-relaxed">
                  This examination has 0 candidate attempts. Proceeding will permanently delete this examination, its sections, questions configurations, and session codes from the database.
                </p>
              </Alert>
            )}

            {/* Confirmation Name Input */}
            {(impact.hasAttempts || deleteTarget.status !== "DRAFT") && (
              <div className="space-y-1.5 pt-1">
                <Field
                  label={`Type examination name to confirm ${impact.hasAttempts ? "archival" : "deletion"}`}
                  hint={`Please type exactly: "${deleteTarget.title}"`}
                >
                  <Input
                    className="font-medium text-sm mt-1"
                    placeholder={deleteTarget.title}
                    value={confirmName}
                    onChange={(e) => setConfirmName(e.target.value)}
                    autoFocus
                  />
                </Field>
              </div>
            )}

            {/* Optional Reason Input */}
            <Field label="Administrative Reason (Optional)" hint="Recorded in the system audit logs for compliance tracking">
              <Input
                className="text-sm mt-1"
                placeholder="e.g. Completed recruitment drive or deprecated syllabus"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
              />
            </Field>

            {/* Dialog Footer Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-line">
              <Button
                variant="secondary"
                disabled={deleteBusy}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={deleteBusy}
                disabled={!isConfirmationMatched}
                onClick={handleConfirmDelete}
              >
                {impact.hasAttempts ? (
                  <>
                    <Archive className="h-4 w-4 mr-1.5" /> Archive & Revoke Sessions
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4 mr-1.5" /> Permanently Delete Exam
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// THREE-DOT ACTIONS MENU WITH REACT PORTAL TO PREVENT CLIPPING
// ─────────────────────────────────────────────────────────────────────────────

interface ExamRowActionsMenuProps {
  exam: Exam;
  isSuperAdmin: boolean;
  currentUserId?: string;
  isDuplicating: boolean;
  onView: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function ExamRowActionsMenu({
  exam,
  isSuperAdmin,
  currentUserId,
  isDuplicating,
  onView,
  onEdit,
  onDuplicate,
  onDelete,
}: ExamRowActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const isOwner = exam.createdById === currentUserId || !exam.createdById;
  const canDeleteOrArchive = isSuperAdmin || isOwner;

  const updatePos = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 4,
        right: Math.max(12, window.innerWidth - rect.right),
      });
    }
  };

  const toggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open) {
      updatePos();
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleScrollOrResize() {
      if (open) updatePos();
    }
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [open]);

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleMenu}
        aria-label="Examination actions menu"
        className={cn(
          "rounded-lg p-1.5 text-ink-500 hover:bg-sand-200 hover:text-navy-950 transition-colors focus:outline-none",
          open && "bg-sand-200 text-navy-950"
        )}
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            top: `${pos.top}px`,
            right: `${pos.right}px`,
            zIndex: 999999,
          }}
          className="w-48 rounded-xl border border-line bg-white p-1 shadow-xl animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => { setOpen(false); onView(); }}
            className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-ink-700 hover:bg-sand-100 hover:text-navy-950 transition-colors"
          >
            <Eye className="h-3.5 w-3.5 text-ink-500" />
            <span>View Examination</span>
          </button>

          <button
            type="button"
            onClick={() => { setOpen(false); onEdit(); }}
            className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-ink-700 hover:bg-sand-100 hover:text-navy-950 transition-colors"
          >
            <Edit3 className="h-3.5 w-3.5 text-ink-500" />
            <span>Edit Configuration</span>
          </button>

          <button
            type="button"
            disabled={isDuplicating}
            onClick={() => { setOpen(false); onDuplicate(); }}
            className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-ink-700 hover:bg-sand-100 hover:text-navy-950 transition-colors"
          >
            <Copy className="h-3.5 w-3.5 text-ink-500" />
            <span>{isDuplicating ? "Duplicating..." : "Duplicate Exam"}</span>
          </button>

          {canDeleteOrArchive && (
            <>
              <div className="my-1 border-t border-line" />
              <button
                type="button"
                onClick={() => { setOpen(false); onDelete(); }}
                className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-bad-600 hover:bg-bad-50 transition-colors font-medium"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>{exam.status === "ARCHIVED" ? "Delete Permanently" : "Delete / Archive"}</span>
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

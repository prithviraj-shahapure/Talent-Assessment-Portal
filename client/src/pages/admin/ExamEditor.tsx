import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Archive, ArrowLeft, Copy, MonitorPlay, Rocket, Trash2, Trophy, Undo2 } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { Alert, Button, ConfirmDialog, ExamStatusBadge, PageHeader, Spinner, Tabs, useToast } from "@/components/ui";
import type { Exam } from "@/lib/types";
import { ExamSettingsForm } from "./exam/ExamSettingsForm";
import { ExamQuestionsTab, type ExamDetail } from "./exam/ExamQuestionsTab";
import { ExamInvitationsTab } from "./exam/ExamInvitationsTab";
import { ExamCandidatesTab } from "./exam/ExamCandidatesTab";

type Tab = "settings" | "questions" | "invitations" | "candidates";

export default function ExamEditor() {
  const { id } = useParams();
  const isNew = id === "new";
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || (isNew ? "settings" : "questions");
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });
  const { data: exam, loading, reload } = useApi<ExamDetail>(isNew ? null : `/exams/${id}`, [id]);
  const [confirm, setConfirm] = useState<null | "delete" | "archive" | "draft">(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (isNew) document.title = "New examination · Zanvar";
    else if (exam) document.title = `${exam.title} · Zanvar`;
  }, [exam, isNew]);

  if (!isNew && (loading || !exam)) return <Spinner />;

  const changeStatus = async (status: Exam["status"]) => {
    setBusy(true);
    try {
      await api(`/exams/${id}/status`, { body: { status } });
      toast(status === "PUBLISHED" ? "Examination published" : status === "ARCHIVED" ? "Examination archived" : "Moved back to draft");
      reload();
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const hasAttempts = (exam?._count?.attempts ?? 0) > 0;

  return (
    <div>
      <PageHeader
        back={
          <Link to="/admin/exams" className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-ink-500 hover:text-ink-900">
            <ArrowLeft className="h-3.5 w-3.5" /> Examinations
          </Link>
        }
        title={isNew ? "New examination" : exam!.title}
        subtitle={
          isNew ? (
            "Set up the details and schedule. You can add questions after saving."
          ) : (
            <span className="inline-flex flex-wrap items-center gap-2">
              <ExamStatusBadge status={exam!.status} startAt={exam!.startAt} endAt={exam!.endAt} />
              <span className="num">{exam!.totalMarks} marks</span>·<span className="num">{exam!.durationMinutes} min</span>·<span>{exam!._count?.assignments ?? 0} assigned</span>·<span>{exam!._count?.attempts ?? 0} attempts</span>
            </span>
          )
        }
        actions={
          !isNew && (
            <>
              {exam!.status === "PUBLISHED" && (
                <Button variant="secondary" onClick={() => nav(`/admin/live?examId=${id}`)}>
                  <MonitorPlay className="h-4 w-4" /> Monitor
                </Button>
              )}
              {hasAttempts && (
                <Button variant="secondary" onClick={() => nav(`/admin/results?examId=${id}`)}>
                  <Trophy className="h-4 w-4" /> Results
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={async () => {
                  const c = await api<{ id: string }>(`/exams/${id}/duplicate`, { method: "POST" });
                  toast("Copy created as draft");
                  nav(`/admin/exams/${c.id}?tab=settings`);
                }}
              >
                <Copy className="h-4 w-4" /> Duplicate
              </Button>
              {exam!.status === "DRAFT" && (
                <>
                  {!hasAttempts && (
                    <Button variant="ghost" onClick={() => setConfirm("delete")} aria-label="Delete">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                  <Button loading={busy} onClick={() => changeStatus("PUBLISHED")}>
                    <Rocket className="h-4 w-4" /> Publish
                  </Button>
                </>
              )}
              {exam!.status === "PUBLISHED" && (
                <>
                  {!hasAttempts && (
                    <Button variant="secondary" onClick={() => setConfirm("draft")}>
                      <Undo2 className="h-4 w-4" /> Unpublish
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => setConfirm("archive")}>
                    <Archive className="h-4 w-4" /> Archive
                  </Button>
                </>
              )}
              {exam!.status === "ARCHIVED" && (
                <>
                  <Button variant="secondary" loading={busy} onClick={() => changeStatus("PUBLISHED")}>
                    Restore
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirm("delete")} aria-label="Delete">
                    <Trash2 className="h-4 w-4 text-bad-600" />
                  </Button>
                </>
              )}
            </>
          )
        }
      />

      {!isNew && exam!.status === "DRAFT" && <Alert className="mb-4" tone="navy">This examination is a draft. Candidates cannot see it until you publish it.</Alert>}
      {!isNew && hasAttempts && <Alert className="mb-4" tone="warn">Candidates have attempted this examination, so its questions and sections are locked. Schedule and settings can still be changed.</Alert>}

      {!isNew && (
        <Tabs
          className="mb-5"
          value={tab}
          onChange={setTab}
          items={[
            { value: "questions", label: "Sections & questions" },
            { value: "settings", label: "Settings & proctoring" },
            { value: "invitations", label: "Invitations", count: exam!._count?.invitations },
            { value: "candidates", label: "Candidates", count: exam!._count?.assignments },
          ]}
        />
      )}

      {(isNew || tab === "settings") && (
        <ExamSettingsForm
          exam={isNew ? null : exam!}
          onSaved={(saved) => {
            if (isNew) nav(`/admin/exams/${saved.id}?tab=questions`, { replace: true });
            else reload();
          }}
        />
      )}
      {!isNew && tab === "questions" && <ExamQuestionsTab exam={exam!} locked={hasAttempts} reload={reload} />}
      {!isNew && tab === "invitations" && <ExamInvitationsTab exam={exam!} reload={reload} />}
      {!isNew && tab === "candidates" && <ExamCandidatesTab exam={exam!} reload={reload} />}

      <ConfirmDialog
        open={confirm === "delete"}
        onClose={() => setConfirm(null)}
        title="Delete examination?"
        body="This will securely process the examination: if candidates have attempted it, records will be archived and sessions revoked; if it has 0 attempts, it will be deleted."
        tone="danger"
        confirmLabel="Delete / Archive"
        onConfirm={async () => {
          try {
            const res = await api<{ success: boolean; mode: string; message: string }>(`/exams/${id}/delete`, {
              method: "POST",
              body: { confirmationName: exam?.title },
            });
            toast(res.message || "Examination removed");
            nav("/admin/exams");
          } catch (e) {
            toast((e as Error).message, "bad");
          }
        }}
      />
      <ConfirmDialog open={confirm === "archive"} onClose={() => setConfirm(null)} title="Archive examination?" body="Candidates will no longer be able to start it. Existing results remain available." confirmLabel="Archive" onConfirm={() => changeStatus("ARCHIVED")} />
      <ConfirmDialog open={confirm === "draft"} onClose={() => setConfirm(null)} title="Move back to draft?" body="Candidates will no longer see this examination until it is published again." confirmLabel="Unpublish" onConfirm={() => changeStatus("DRAFT")} />
    </div>
  );
}

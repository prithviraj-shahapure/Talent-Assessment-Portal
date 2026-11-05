import { Fragment, useState } from "react";
import { Copy, Download, FileUp, FolderTree, LibraryBig, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { api, download, qs } from "@/lib/api";
import { useApi, useDebounced } from "@/hooks/useApi";
import { Alert, Badge, Button, Card, Dialog, EmptyState, Input, PageHeader, Pagination, Select, Spinner, Toolbar, useToast } from "@/components/ui";
import { QUESTION_TYPE_LABEL } from "@/lib/format";
import type { Category, Paged, Question } from "@/lib/types";
import { QuestionForm } from "./question/QuestionForm";
import { QuestionReviewModal } from "./QuestionReviewModal";
import { cn } from "@/lib/cn";

export default function QuestionBank() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const { data, loading, reload } = useApi<Paged<Question>>(`/questions${qs({ q: dq, type, difficulty, categoryId, page, pageSize: 20 })}`, [dq, type, difficulty, categoryId, page]);
  const { data: cats, reload: reloadCats } = useApi<Category[]>("/questions/categories");
  const { data: stats, reload: reloadStats } = useApi<{ total: number; byType: { type: string; _count: number }[]; byDifficulty: { difficulty: string; _count: number }[] }>("/questions/stats");
  const [editing, setEditing] = useState<Question | "new" | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [txtModalOpen, setTxtModalOpen] = useState(false);
  const [catsOpen, setCatsOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const refreshAll = () => {
    reload();
    reloadCats();
    reloadStats();
  };

  return (
    <div>
      <PageHeader
        title="Question Bank"
        subtitle="Reusable questions for all examinations. Questions answered in an examination are archived rather than deleted."
        actions={
          <>
            <Button variant="secondary" onClick={() => setCatsOpen(true)}>
              <FolderTree className="h-4 w-4" /> Categories
            </Button>
            <Button variant="secondary" onClick={() => setTxtModalOpen(true)}>
              <FileUp className="h-4 w-4" /> Upload Paper / AI
            </Button>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              <Download className="h-4 w-4" /> Excel Import
            </Button>
            <Button onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" /> New question
            </Button>
          </>
        }
      />
      {stats && (
        <div className="mb-4 flex flex-wrap gap-2 text-[12.5px]">
          <span className="rounded border border-line bg-white px-2.5 py-1">
            <span className="num font-semibold">{stats.total}</span> active questions
          </span>
          {stats.byType.map((t) => (
            <button key={t.type} onClick={() => { setType(type === t.type ? "" : t.type); setPage(1); }} className={cn("rounded border px-2.5 py-1 transition-colors", type === t.type ? "border-navy-900 bg-navy-900 text-white" : "border-line bg-white hover:border-navy-500/40")}>
              {QUESTION_TYPE_LABEL[t.type as keyof typeof QUESTION_TYPE_LABEL]} <span className="num opacity-70">{t._count}</span>
            </button>
          ))}
        </div>
      )}
      <Card padded={false}>
        <Toolbar>
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" />
            <Input className="pl-8" placeholder="Search question text or tag" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <Select className="w-full sm:w-52" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }}>
            <option value="">All categories</option>
            {cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select className="w-full sm:w-44" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
            <option value="">All types</option>
            {Object.entries(QUESTION_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select className="w-full sm:w-36" value={difficulty} onChange={(e) => { setDifficulty(e.target.value); setPage(1); }}>
            <option value="">All difficulty</option>
            <option value="EASY">Easy</option>
            <option value="MEDIUM">Medium</option>
            <option value="HARD">Hard</option>
          </Select>
        </Toolbar>
        {loading && !data ? (
          <Spinner />
        ) : !data?.items.length ? (
          <EmptyState icon={<LibraryBig className="h-7 w-7" />} title="No questions found" body="Create questions one by one or import them from Excel." action={<Button onClick={() => setEditing("new")}>New question</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Type</th>
                  <th>Category</th>
                  <th>Difficulty</th>
                  <th className="text-right">Marks</th>
                  <th className="text-right">Used in</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((qq) => (
                  <Fragment key={qq.id}>
                    <tr className="row-hover" onClick={() => setExpanded(expanded === qq.id ? null : qq.id)}>
                      <td className="max-w-[520px]">
                        <div className={expanded === qq.id ? "prose-q" : "line-clamp-2"}>{qq.text}</div>
                        {qq.tags.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{qq.tags.map((t) => <span key={t} className="rounded bg-canvas px-1.5 text-[11px] text-ink-500">#{t}</span>)}</div>}
                      </td>
                      <td className="whitespace-nowrap text-[12.5px]">{QUESTION_TYPE_LABEL[qq.type]}</td>
                      <td className="text-[12.5px]">{qq.category?.name ?? <span className="text-ink-400">—</span>}</td>
                      <td>
                        <Badge tone={qq.difficulty === "EASY" ? "ok" : qq.difficulty === "MEDIUM" ? "steel" : "warn"}>{qq.difficulty.toLowerCase()}</Badge>
                      </td>
                      <td className="num text-right">
                        {qq.marks}
                        {qq.negativeMarks > 0 && <span className="text-bad-600"> −{qq.negativeMarks}</span>}
                      </td>
                      <td className="num text-right">{qq._count?.examQuestions ?? 0}</td>
                      <td className="whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="ghost" title="Edit" onClick={() => setEditing(qq)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" title="Duplicate" onClick={async () => { await api(`/questions/${qq.id}/duplicate`, { method: "POST" }); toast("Question duplicated"); refreshAll(); }}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Delete"
                          onClick={async () => {
                            const r = await api<{ archived: boolean }>(`/questions/${qq.id}`, { method: "DELETE" });
                            toast(r.archived ? "Question archived (it is used in an examination)" : "Question deleted");
                            refreshAll();
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                    {expanded === qq.id && (
                      <tr className="bg-canvas/60">
                        <td colSpan={7} className="!py-3">
                          <AnswerKey q={qq} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
      </Card>

      {editing && (
        <QuestionForm
          question={editing === "new" ? null : editing}
          categories={cats ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refreshAll();
          }}
        />
      )}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} onDone={refreshAll} />}
      <QuestionReviewModal open={txtModalOpen} onClose={() => setTxtModalOpen(false)} onSuccess={refreshAll} />
      {catsOpen && <CategoriesDialog cats={cats ?? []} onClose={() => setCatsOpen(false)} onChange={refreshAll} />}
    </div>
  );
}

function AnswerKey({ q }: { q: Question }) {
  if (q.options.length)
    return (
      <div className="grid gap-1.5 sm:grid-cols-2">
        {q.options.map((o, i) => (
          <div key={o.id} className={cn("rounded border px-2.5 py-1.5 text-[12.5px]", o.isCorrect ? "border-ok-100 bg-ok-50 text-ok-600 font-medium" : "border-line bg-white")}>
            <span className="num mr-2 text-ink-400">{String.fromCharCode(65 + i)}</span>
            {o.text}
          </div>
        ))}
        {q.explanation && <div className="sm:col-span-2 text-[12px] text-ink-500">Explanation: {q.explanation}</div>}
      </div>
    );
  if (q.type === "NUMERICAL") return <div className="text-[12.5px]">Answer: <b className="num">{q.acceptedAnswers[0]}</b> {q.numericTolerance ? `± ${q.numericTolerance}` : ""}</div>;
  if (q.type === "SHORT") return <div className="text-[12.5px]">{q.acceptedAnswers.length ? <>Accepted answers: {q.acceptedAnswers.map((a) => <Badge key={a} tone="ok" className="mr-1">{a}</Badge>)}</> : "Evaluated manually (no accepted answers set)"}</div>;
  if (q.type === "CODING") return <pre className="max-h-48 overflow-auto rounded bg-navy-950 p-3 font-mono text-[12px] text-white/90">{q.codeStarter || "// No starter code"}</pre>;
  return <div className="text-[12.5px] text-ink-500">Evaluated manually by HR.</div>;
}

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ valid: number; errors: { row: number; error: string }[]; preview: { row: number; type: string; text: string; category: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (dry: boolean) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api<{ created?: number; valid?: number; errors: { row: number; error: string }[]; preview?: { row: number; type: string; text: string; category: string }[] }>(`/questions/import${dry ? "?dryRun=1" : ""}`, { form: fd });
      if (dry) setPreview(r as never);
      else {
        toast(`${r.created} question(s) imported${r.errors.length ? `, ${r.errors.length} row(s) skipped` : ""}`);
        onDone();
        onClose();
      }
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Bulk import questions"
      description="Upload a CSV or Excel file in the template format. Check the preview, then import."
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={() => download("/questions/import/template", "question-import-template.xlsx")}>
            <Download className="h-4 w-4" /> Download template
          </Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {!preview ? (
            <Button disabled={!file} loading={busy} onClick={() => send(true)}>Check file</Button>
          ) : (
            <Button disabled={!preview.valid} loading={busy} onClick={() => send(false)}>Import {preview.valid} question(s)</Button>
          )}
        </>
      }
    >
      <label className="flex cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed border-line-strong bg-canvas/50 px-4 py-8 text-center hover:border-navy-500/50">
        <FileUp className="h-6 w-6 text-ink-400" />
        <span className="mt-2 text-[13.5px] font-medium">{file ? file.name : "Choose a .xlsx or .csv file"}</span>
        <span className="text-[12px] text-ink-500">Maximum 5 MB</span>
        <input type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
      </label>
      {preview && (
        <div className="mt-4 space-y-3">
          <Alert tone={preview.errors.length ? "warn" : "ok"} title={`${preview.valid} valid row(s), ${preview.errors.length} with errors`}>
            {preview.errors.length > 0 && <span>Rows with errors will be skipped. Fix them in the file and re-upload to include them.</span>}
          </Alert>
          {preview.errors.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded border border-bad-100 bg-bad-50 p-2 text-[12px] scrollbar-thin">
              {preview.errors.map((e) => (
                <div key={e.row}>
                  <b className="num">Row {e.row}:</b> {e.error}
                </div>
              ))}
            </div>
          )}
          {preview.preview.length > 0 && (
            <table className="table-base rounded border border-line">
              <thead><tr><th>Row</th><th>Type</th><th>Question</th><th>Category</th></tr></thead>
              <tbody>
                {preview.preview.map((p) => (
                  <tr key={p.row}><td className="num">{p.row}</td><td className="text-[12px]">{p.type}</td><td className="text-[12.5px]">{p.text}</td><td className="text-[12px]">{p.category || "—"}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Dialog>
  );
}

function CategoriesDialog({ cats, onClose, onChange }: { cats: Category[]; onClose: () => void; onChange: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  return (
    <Dialog open onClose={onClose} title="Question categories" size="sm">
      <form
        className="mb-3 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/questions/categories", { body: { name } });
            setName("");
            onChange();
          } catch (err) {
            toast((err as Error).message, "bad");
          }
        }}
      >
        <Input placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={name.trim().length < 2}>Add</Button>
      </form>
      <ul className="divide-y divide-line rounded border border-line">
        {cats.map((c) => (
          <li key={c.id} className="flex items-center justify-between px-3 py-2 text-[13px]">
            <span>
              {c.name} <span className="num text-ink-400">({c._count?.questions ?? 0})</span>
            </span>
            <button
              className="rounded p-1 text-ink-400 hover:text-bad-600"
              aria-label="Delete category"
              onClick={async () => {
                try {
                  await api(`/questions/categories/${c.id}`, { method: "DELETE" });
                  onChange();
                } catch (err) {
                  toast((err as Error).message, "bad");
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

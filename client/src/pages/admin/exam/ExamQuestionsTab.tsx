import { useState } from "react";
import { Dices, FileUp, Pencil, Plus, Search, Shuffle, Trash2 } from "lucide-react";
import { api, qs } from "@/lib/api";
import { useApi, useDebounced } from "@/hooks/useApi";
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, Field, Input, Pagination, Select, Spinner, useToast } from "@/components/ui";
import { QUESTION_TYPE_LABEL } from "@/lib/format";
import type { Category, Difficulty, Exam, Paged, Question, QuestionType } from "@/lib/types";
import { QuestionReviewModal } from "../QuestionReviewModal";

export interface ExamDetail extends Exam {
  sections: {
    id: string;
    title: string;
    description: string | null;
    order: number;
    timeLimitMinutes: number | null;
    passingMarks?: number;
    negativeMarks?: number;
    instructions?: string | null;
    isMandatory?: boolean;
    sectionType?: string | null;
    difficultyConfig?: Record<string, number> | null;
    questions: { id: string; order: number; marks: number | null; question: { id: string; text: string; type: QuestionType; difficulty: Difficulty; marks: number; isActive: boolean; category: { name: string } | null } }[];
    randomRules: { id: string; categoryId: string | null; difficulty: Difficulty | null; type: QuestionType | null; count: number; marksEach: number | null; category: { name: string } | null }[];
  }[];
  rulePools: Record<string, number>;
}

const diffTone = (d: Difficulty) => (d === "EASY" ? "ok" : d === "MEDIUM" ? "steel" : "warn") as "ok" | "steel" | "warn";

export function ExamQuestionsTab({ exam, locked, reload }: { exam: ExamDetail; locked: boolean; reload: () => void }) {
  const toast = useToast();
  const [sectionDialog, setSectionDialog] = useState<null | { id?: string; title: string; description: string; timeLimitMinutes: string }>(null);
  const [picker, setPicker] = useState<string | null>(null);
  const [ruleFor, setRuleFor] = useState<string | null>(null);
  const [txtModalSectionId, setTxtModalSectionId] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok);
      reload();
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  };
  const usedIds = exam.sections.flatMap((s) => s.questions.map((q) => q.question.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[13px] text-ink-500">
          <span className="num font-medium text-ink-900">{exam.sections.reduce((n, s) => n + s.questions.length + s.randomRules.reduce((a, r) => a + r.count, 0), 0)}</span> questions per candidate ·{" "}
          <span className="num font-medium text-ink-900">{exam.totalMarks}</span> total marks · pass mark <span className="num">{exam.passingMarks}</span>
          {exam.randomizeQuestions && (
            <span className="ml-2 inline-flex items-center gap-1 text-steel-600">
              <Shuffle className="h-3.5 w-3.5" /> order randomised per candidate
            </span>
          )}
        </div>
        {!locked && (
          <Button variant="secondary" onClick={() => setSectionDialog({ title: `Section ${String.fromCharCode(65 + exam.sections.length)}`, description: "", timeLimitMinutes: "" })}>
            <Plus className="h-4 w-4" /> Add section
          </Button>
        )}
      </div>

      {exam.sections.map((s, si) => {
        const marks = s.questions.reduce((a, q) => a + (q.marks ?? q.question.marks), 0) + s.randomRules.reduce((a, r) => a + r.count * (r.marksEach ?? 1), 0);
        return (
          <Card
            key={s.id}
            padded={false}
            title={
              <span className="flex items-center gap-2">
                <span className="num flex h-5 w-5 items-center justify-center rounded bg-navy-900 text-[11px] text-white">{si + 1}</span>
                {s.title}
                {exam.sectionTimeLimits && <Badge tone={s.timeLimitMinutes ? "navy" : "warn"}>{s.timeLimitMinutes ? `${s.timeLimitMinutes} min` : "No time limit set"}</Badge>}
              </span>
            }
            subtitle={`${s.questions.length} fixed question(s)${s.randomRules.length ? ` + ${s.randomRules.reduce((a, r) => a + r.count, 0)} random` : ""} · ${marks} marks`}
            actions={
              !locked && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setSectionDialog({ id: s.id, title: s.title, description: s.description ?? "", timeLimitMinutes: s.timeLimitMinutes ? String(s.timeLimitMinutes) : "" })}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setTxtModalSectionId(s.id)}>
                    <FileUp className="h-3.5 w-3.5" /> Upload Paper / AI
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setRuleFor(s.id)}>
                    <Dices className="h-3.5 w-3.5" /> Random from bank
                  </Button>
                  <Button size="sm" onClick={() => setPicker(s.id)}>
                    <Plus className="h-3.5 w-3.5" /> Add questions
                  </Button>
                  {exam.sections.length > 1 && (
                    <Button size="sm" variant="ghost" onClick={() => confirm(`Delete section "${s.title}"?`) && run(() => api(`/exams/sections/${s.id}`, { method: "DELETE" }), "Section deleted")}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </>
              )
            }
          >
            {s.questions.length === 0 && s.randomRules.length === 0 ? (
              <EmptyState title="No questions in this section" body="Add questions from the question bank, or add a rule that picks random questions for each candidate." />
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th className="w-10">#</th>
                      <th>Question</th>
                      <th>Type</th>
                      <th>Difficulty</th>
                      <th className="text-right w-28">Marks</th>
                      {!locked && <th className="w-10" />}
                    </tr>
                  </thead>
                  <tbody>
                    {s.questions.map((eq, i) => (
                      <tr key={eq.id}>
                        <td className="num text-ink-400">{i + 1}</td>
                        <td className="max-w-[520px]">
                          <div className="line-clamp-2">{eq.question.text}</div>
                          <div className="text-[11.5px] text-ink-400">
                            {eq.question.category?.name ?? "Uncategorised"}
                            {!eq.question.isActive && <span className="ml-2 text-bad-600">Archived — will be skipped</span>}
                          </div>
                        </td>
                        <td className="whitespace-nowrap text-[12.5px]">{QUESTION_TYPE_LABEL[eq.question.type]}</td>
                        <td>
                          <Badge tone={diffTone(eq.question.difficulty)}>{eq.question.difficulty.toLowerCase()}</Badge>
                        </td>
                        <td className="text-right">
                          {locked ? (
                            <span className="num">{eq.marks ?? eq.question.marks}</span>
                          ) : (
                            <Input
                              type="number"
                              step="0.5"
                              min={0}
                              defaultValue={eq.marks ?? eq.question.marks}
                              className="h-7 w-20 text-right num ml-auto"
                              onBlur={(e) => {
                                const v = Number(e.target.value);
                                if (v !== (eq.marks ?? eq.question.marks)) run(() => api(`/exams/sections/${s.id}/questions/${eq.id}`, { method: "PATCH", body: { marks: v } }), "Marks updated");
                              }}
                            />
                          )}
                        </td>
                        {!locked && (
                          <td>
                            <button className="rounded p-1 text-ink-400 hover:bg-bad-50 hover:text-bad-600" aria-label="Remove" onClick={() => run(() => api(`/exams/sections/${s.id}/questions/${eq.id}`, { method: "DELETE" }))}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {s.randomRules.map((r) => (
                      <tr key={r.id} className="bg-steel-100/25">
                        <td>
                          <Dices className="h-4 w-4 text-steel-600" />
                        </td>
                        <td>
                          <div className="font-medium">
                            {r.count} random question{r.count > 1 ? "s" : ""} from the bank
                          </div>
                          <div className="text-[11.5px] text-ink-500">
                            {[r.category?.name ?? "Any category", r.type ? QUESTION_TYPE_LABEL[r.type] : "any type", r.difficulty ? r.difficulty.toLowerCase() : "any difficulty"].join(" · ")} — pool of{" "}
                            <span className={exam.rulePools[r.id] < r.count ? "text-bad-600 font-medium" : ""}>{exam.rulePools[r.id] ?? 0}</span>
                          </div>
                        </td>
                        <td className="text-[12.5px]">Random pick</td>
                        <td />
                        <td className="num text-right">
                          {r.marksEach ?? 1} each
                        </td>
                        {!locked && (
                          <td>
                            <button className="rounded p-1 text-ink-400 hover:bg-bad-50 hover:text-bad-600" aria-label="Remove rule" onClick={() => run(() => api(`/exams/rules/${r.id}`, { method: "DELETE" }))}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}

      <Dialog
        open={!!sectionDialog}
        onClose={() => setSectionDialog(null)}
        title={sectionDialog?.id ? "Edit section" : "Add section"}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSectionDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                run(async () => {
                  const body = { title: sectionDialog!.title, description: sectionDialog!.description || null, timeLimitMinutes: sectionDialog!.timeLimitMinutes ? Number(sectionDialog!.timeLimitMinutes) : null };
                  if (sectionDialog!.id) await api(`/exams/sections/${sectionDialog!.id}`, { method: "PATCH", body });
                  else await api(`/exams/${exam.id}/sections`, { body });
                  setSectionDialog(null);
                }, "Section saved")
              }
            >
              Save
            </Button>
          </>
        }
      >
        {sectionDialog && (
          <div className="space-y-3">
            <Field label="Section title" required>
              <Input value={sectionDialog.title} onChange={(e) => setSectionDialog({ ...sectionDialog, title: e.target.value })} />
            </Field>
            <Field label="Description">
              <Input value={sectionDialog.description} onChange={(e) => setSectionDialog({ ...sectionDialog, description: e.target.value })} />
            </Field>
            <Field label="Time limit (minutes)" hint={exam.sectionTimeLimits ? "Required because section time limits are enabled" : "Only used when section time limits are enabled in settings"}>
              <Input type="number" min={1} value={sectionDialog.timeLimitMinutes} onChange={(e) => setSectionDialog({ ...sectionDialog, timeLimitMinutes: e.target.value })} />
            </Field>
          </div>
        )}
      </Dialog>

      {picker && <QuestionPicker sectionId={picker} exclude={usedIds} onClose={() => setPicker(null)} onAdded={reload} />}
      {ruleFor && <RandomRuleDialog sectionId={ruleFor} onClose={() => setRuleFor(null)} onAdded={reload} />}
      {txtModalSectionId && (
        <QuestionReviewModal
          open
          onClose={() => setTxtModalSectionId(null)}
          examId={exam.id}
          sectionId={txtModalSectionId}
          targetSections={exam.sections.map((sec) => ({ id: sec.id, title: sec.title }))}
          onSuccess={() => {
            setTxtModalSectionId(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function QuestionPicker({ sectionId, exclude, onClose, onAdded }: { sectionId: string; exclude: string[]; onClose: () => void; onAdded: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const dq = useDebounced(q);
  const { data: cats } = useApi<Category[]>("/questions/categories");
  const { data, loading } = useApi<Paged<Question>>(`/questions${qs({ q: dq, type, difficulty, categoryId, page, pageSize: 15, exclude: exclude.join(",") })}`, [dq, type, difficulty, categoryId, page]);
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title="Add questions from the bank"
      description="Questions already used in this examination are hidden."
      footer={
        <>
          <span className="mr-auto self-center text-[13px] text-ink-500">{selected.size} selected</span>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!selected.size}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api<{ added: number }>(`/exams/sections/${sectionId}/questions`, { body: { questionIds: [...selected] } });
                toast(`${r.added} question(s) added`);
                onAdded();
                onClose();
              } catch (e) {
                toast((e as Error).message, "bad");
              } finally {
                setBusy(false);
              }
            }}
          >
            Add {selected.size || ""} question{selected.size === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <div className="mb-3 grid gap-2 sm:grid-cols-4">
        <div className="relative sm:col-span-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" />
          <Input className="pl-8" placeholder="Search text or tag" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }}>
          <option value="">All categories</option>
          {cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
          <option value="">All types</option>
          {Object.entries(QUESTION_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select value={difficulty} onChange={(e) => { setDifficulty(e.target.value); setPage(1); }}>
          <option value="">All difficulties</option>
          <option value="EASY">Easy</option>
          <option value="MEDIUM">Medium</option>
          <option value="HARD">Hard</option>
        </Select>
      </div>
      <div className="rounded border border-line">
        {loading && !data ? (
          <Spinner />
        ) : !data?.items.length ? (
          <EmptyState title="No matching questions" />
        ) : (
          <table className="table-base">
            <tbody>
              {data.items.map((qq) => (
                <tr key={qq.id} className="row-hover" onClick={() => toggle(qq.id)}>
                  <td className="w-8" onClick={(e) => e.stopPropagation()}>
                    <Checkbox label="" checked={selected.has(qq.id)} onChange={() => toggle(qq.id)} />
                  </td>
                  <td>
                    <div className="line-clamp-2">{qq.text}</div>
                    <div className="text-[11.5px] text-ink-400">{qq.category?.name ?? "Uncategorised"}</div>
                  </td>
                  <td className="whitespace-nowrap text-[12.5px]">{QUESTION_TYPE_LABEL[qq.type]}</td>
                  <td><Badge tone={diffTone(qq.difficulty)}>{qq.difficulty.toLowerCase()}</Badge></td>
                  <td className="num text-right">{qq.marks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
      </div>
    </Dialog>
  );
}

function RandomRuleDialog({ sectionId, onClose, onAdded }: { sectionId: string; onClose: () => void; onAdded: () => void }) {
  const toast = useToast();
  const { data: cats } = useApi<Category[]>("/questions/categories");
  const [r, setR] = useState({ categoryId: "", type: "", difficulty: "", count: 5, marksEach: 1 });
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Random questions from the bank"
      description="Each candidate receives a different random set, fixed when they start."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/exams/sections/${sectionId}/rules`, { body: { categoryId: r.categoryId || null, type: r.type || null, difficulty: r.difficulty || null, count: Number(r.count), marksEach: Number(r.marksEach) } });
                toast("Rule added");
                onAdded();
                onClose();
              } catch (e) {
                toast((e as Error).message, "bad");
              } finally {
                setBusy(false);
              }
            }}
          >
            Add rule
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Category" className="sm:col-span-2">
          <Select value={r.categoryId} onChange={(e) => setR({ ...r, categoryId: e.target.value })}>
            <option value="">Any category</option>
            {cats?.map((c) => <option key={c.id} value={c.id}>{c.name} ({c._count?.questions ?? 0})</option>)}
          </Select>
        </Field>
        <Field label="Question type">
          <Select value={r.type} onChange={(e) => setR({ ...r, type: e.target.value })}>
            <option value="">Any type</option>
            {Object.entries(QUESTION_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Difficulty">
          <Select value={r.difficulty} onChange={(e) => setR({ ...r, difficulty: e.target.value })}>
            <option value="">Any</option>
            <option value="EASY">Easy</option>
            <option value="MEDIUM">Medium</option>
            <option value="HARD">Hard</option>
          </Select>
        </Field>
        <Field label="Number of questions">
          <Input type="number" min={1} value={r.count} onChange={(e) => setR({ ...r, count: Number(e.target.value) })} />
        </Field>
        <Field label="Marks each">
          <Input type="number" min={0} step="0.5" value={r.marksEach} onChange={(e) => setR({ ...r, marksEach: Number(e.target.value) })} />
        </Field>
      </div>
    </Dialog>
  );
}

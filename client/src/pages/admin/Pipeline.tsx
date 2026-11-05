import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { GripVertical, Search } from "lucide-react";
import { api, qs } from "@/lib/api";
import { useApi, useDebounced } from "@/hooks/useApi";
import { Button, Checkbox, Dialog, Field, Input, PageHeader, RiskBadge, Select, Spinner, Textarea, useToast } from "@/components/ui";
import { fmtPct, STAGE_LABEL, STAGES } from "@/lib/format";
import type { Exam, PipelineStage } from "@/lib/types";
import { cn } from "@/lib/cn";

interface CardC { id: string; name: string; email: string; college: string; degree: string; branch: string; graduationYear: number; best: { attemptId: string; percentage: number | null; riskLevel: string; passed: boolean | null; exam: string } | null }

const accent: Partial<Record<PipelineStage, string>> = { SHORTLISTED: "bg-signal-500", INTERVIEW: "bg-signal-500", SELECTED: "bg-ok-600", REJECTED: "bg-bad-600", EVALUATION: "bg-steel-500", EXAM_COMPLETED: "bg-steel-500" };

export default function Pipeline() {
  const nav = useNavigate();
  const toast = useToast();
  const [examId, setExamId] = useState("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const { data: exams } = useApi<Exam[]>("/exams");
  const { data, loading, reload, setData } = useApi<{ stage: PipelineStage; candidates: CardC[] }[]>(`/pipeline${qs({ examId, q: dq })}`, [examId, dq]);
  const [dragOver, setDragOver] = useState<PipelineStage | null>(null);
  const [move, setMove] = useState<{ ids: string[]; to: PipelineStage; names: string[] } | null>(null);
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStage, setBulkStage] = useState<PipelineStage>("SHORTLISTED");

  const doMove = async () => {
    if (!move) return;
    // optimistic update
    setData((cols) => {
      if (!cols) return cols;
      const moving = cols.flatMap((c) => c.candidates).filter((c) => move.ids.includes(c.id));
      return cols.map((c) => ({ ...c, candidates: c.stage === move.to ? [...moving, ...c.candidates.filter((x) => !move.ids.includes(x.id))] : c.candidates.filter((x) => !move.ids.includes(x.id)) }));
    });
    try {
      await api("/pipeline/move", { body: { candidateIds: move.ids, stage: move.to, note: note || null, notify } });
      toast(`Moved to ${STAGE_LABEL[move.to]}`);
    } catch (e) {
      toast((e as Error).message, "bad");
    }
    setMove(null);
    setNote("");
    setSelected(new Set());
    reload();
  };

  return (
    <div>
      <PageHeader
        title="Recruitment Pipeline"
        subtitle="Drag candidates between stages, or select several and move them together. Every move is recorded in the candidate's history."
        actions={
          <>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" />
              <Input className="w-56 pl-8" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select className="w-72" value={examId} onChange={(e) => setExamId(e.target.value)}>
              <option value="">All candidates</option>
              {exams?.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </Select>
          </>
        }
      />
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-navy-100 bg-navy-50 px-3 py-2 text-[13px]">
          <b>{selected.size}</b> selected — move to
          <Select className="h-8 w-44" value={bulkStage} onChange={(e) => setBulkStage(e.target.value as PipelineStage)}>
            {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </Select>
          <Button size="sm" onClick={() => setMove({ ids: [...selected], to: bulkStage, names: [] })}>Move</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}
      {loading && !data ? (
        <Spinner />
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 pb-4 scrollbar-thin sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex min-w-max gap-3">
            {data?.map((col) => (
              <div
                key={col.stage}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(col.stage);
                }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(null);
                  const id = e.dataTransfer.getData("text/plain");
                  const c = data.flatMap((x) => x.candidates).find((x) => x.id === id);
                  if (c && !col.candidates.some((x) => x.id === id)) setMove({ ids: selected.has(id) ? [...selected] : [id], to: col.stage, names: [c.name] });
                }}
                className={cn("flex w-[264px] flex-col rounded-md border bg-white/60", dragOver === col.stage ? "border-steel-500 bg-steel-100/40" : "border-line")}
              >
                <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full", accent[col.stage] ?? "bg-navy-700")} />
                    <span className="text-[12.5px] font-semibold">{STAGE_LABEL[col.stage]}</span>
                  </div>
                  <span className="num rounded bg-canvas px-1.5 text-[11.5px] text-ink-500">{col.candidates.length}</span>
                </div>
                <div className="flex max-h-[68vh] min-h-[120px] flex-col gap-2 overflow-y-auto p-2 scrollbar-thin">
                  {col.candidates.map((c) => (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", c.id)}
                      className={cn("group cursor-grab rounded border bg-white p-2.5 shadow-card active:cursor-grabbing", selected.has(c.id) ? "border-steel-500" : "border-line hover:border-navy-500/40")}
                    >
                      <div className="flex items-start gap-1.5">
                        <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-300" />
                        <button className="min-w-0 flex-1 text-left" onClick={() => nav(`/admin/candidates/${c.id}`)}>
                          <div className="truncate text-[13px] font-medium hover:underline">{c.name}</div>
                          <div className="truncate text-[11.5px] text-ink-500">{c.degree} · {c.branch}</div>
                          <div className="truncate text-[11.5px] text-ink-400">{c.college}</div>
                        </button>
                        <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-navy-900" checked={selected.has(c.id)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} aria-label="Select" />
                      </div>
                      {c.best && (
                        <div className="mt-2 flex items-center justify-between border-t border-line pt-1.5">
                          <span className={cn("num text-[12.5px] font-semibold", c.best.passed ? "text-ok-600" : c.best.passed === false ? "text-bad-600" : "text-ink-700")}>{fmtPct(c.best.percentage)}</span>
                          {c.best.riskLevel !== "NORMAL" && <RiskBadge level={c.best.riskLevel} />}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <Dialog
        open={!!move}
        onClose={() => setMove(null)}
        title={`Move to ${move ? STAGE_LABEL[move.to] : ""}`}
        description={move ? (move.names.length === 1 && move.ids.length === 1 ? move.names[0] : `${move.ids.length} candidate(s)`) : ""}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setMove(null)}>Cancel</Button>
            <Button onClick={doMove}>Move</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Note (optional)">
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason or interview feedback" />
          </Field>
          {move && ["SHORTLISTED", "INTERVIEW", "SELECTED"].includes(move.to) && <Checkbox checked={notify} onChange={(e) => setNotify(e.target.checked)} label="Email the candidate about this update" />}
        </div>
      </Dialog>
    </div>
  );
}

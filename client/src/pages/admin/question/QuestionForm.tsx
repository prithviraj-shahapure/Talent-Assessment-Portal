import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Alert, Button, Dialog, Field, Input, Select, TagInput, Textarea, useToast } from "@/components/ui";
import { QUESTION_TYPE_LABEL } from "@/lib/format";
import type { Category, Difficulty, Option, Question, QuestionType } from "@/lib/types";
import { cn } from "@/lib/cn";

export function QuestionForm({ question, categories, onClose, onSaved }: { question: Question | null; categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [type, setType] = useState<QuestionType>(question?.type ?? "SINGLE");
  const [text, setText] = useState(question?.text ?? "");
  const [explanation, setExplanation] = useState(question?.explanation ?? "");
  const [categoryId, setCategoryId] = useState(question?.categoryId ?? "");
  const [difficulty, setDifficulty] = useState<Difficulty>(question?.difficulty ?? "MEDIUM");
  const [marks, setMarks] = useState(question?.marks ?? 1);
  const [negativeMarks, setNegativeMarks] = useState(question?.negativeMarks ?? 0);
  const [options, setOptions] = useState<Option[]>(
    question?.options.length ? question.options.map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect })) : [{ text: "", isCorrect: true }, { text: "", isCorrect: false }, { text: "", isCorrect: false }, { text: "", isCorrect: false }],
  );
  const [tfAnswer, setTfAnswer] = useState<boolean>(question?.type === "TRUE_FALSE" ? !!question.options.find((o) => o.text === "True")?.isCorrect : true);
  const [accepted, setAccepted] = useState<string[]>(question?.acceptedAnswers ?? []);
  const [numeric, setNumeric] = useState(question?.type === "NUMERICAL" ? question.acceptedAnswers[0] ?? "" : "");
  const [tolerance, setTolerance] = useState<string>(question?.numericTolerance != null ? String(question.numericTolerance) : "0");
  const [codeLanguage, setCodeLanguage] = useState(question?.codeLanguage ?? "all");
  const [codeStarter, setCodeStarter] = useState(question?.codeStarter ?? "");
  const [promptTitle, setPromptTitle] = useState(question?.promptMeta?.title ?? "");
  const [promptScenario, setPromptScenario] = useState(question?.promptMeta?.scenario ?? "");
  const [promptRequirements, setPromptRequirements] = useState(
    question?.promptMeta?.requirements?.join("\n") ?? ""
  );
  const [promptExpectedOutput, setPromptExpectedOutput] = useState(
    question?.promptMeta?.expectedOutput ?? ""
  );
  const [tags, setTags] = useState<string[]>(question?.tags ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isChoice = type === "SINGLE" || type === "MULTIPLE";
  const setCorrect = (i: number) => setOptions(options.map((o, j) => (type === "SINGLE" ? { ...o, isCorrect: i === j } : i === j ? { ...o, isCorrect: !o.isCorrect } : o)));

  const save = async () => {
    setError(null);
    let opts: Option[] = [];
    if (isChoice) opts = options.filter((o) => o.text.trim());
    if (type === "TRUE_FALSE") {
      const existing = question?.type === "TRUE_FALSE" ? question.options : [];
      opts = [
        { id: existing.find((o) => o.text === "True")?.id, text: "True", isCorrect: tfAnswer },
        { id: existing.find((o) => o.text === "False")?.id, text: "False", isCorrect: !tfAnswer },
      ];
    }
    const body = {
      type,
      text,
      explanation: explanation || null,
      categoryId: categoryId || null,
      difficulty,
      marks: Number(marks),
      negativeMarks: Number(negativeMarks),
      acceptedAnswers: type === "NUMERICAL" ? [numeric.trim()] : type === "SHORT" ? accepted : [],
      numericTolerance: type === "NUMERICAL" ? Number(tolerance || 0) : null,
      codeLanguage: type === "CODING" ? codeLanguage : null,
      codeStarter: type === "CODING" ? codeStarter : null,
      promptMeta:
        type === "PROMPT"
          ? {
              title: promptTitle.trim() || undefined,
              scenario: promptScenario.trim() || undefined,
              requirements: promptRequirements
                .split("\n")
                .map((r) => r.trim())
                .filter(Boolean),
              expectedOutput: promptExpectedOutput.trim() || undefined,
              maxAttempts: 2,
            }
          : null,
      tags,
      options: opts,
    };
    setBusy(true);
    try {
      if (question) await api(`/questions/${question.id}`, { method: "PUT", body });
      else await api("/questions", { body });
      toast(question ? "Question updated" : "Question created");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={question ? "Edit question" : "New question"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={save}>{question ? "Save changes" : "Create question"}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Question type" className="sm:col-span-2">
            <Select value={type} onChange={(e) => setType(e.target.value as QuestionType)} disabled={!!question && (question._count?.examQuestions ?? 0) > 0}>
              {Object.entries(QUESTION_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Category" className="sm:col-span-2">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Uncategorised</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Question" required>
          <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type the question. Line breaks are preserved." />
        </Field>

        {isChoice && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12.5px] font-medium text-ink-700">Options — {type === "SINGLE" ? "select the one correct answer" : "select all correct answers"}</span>
              {options.length < 6 && (
                <button type="button" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-steel-600" onClick={() => setOptions([...options, { text: "", isCorrect: false }])}>
                  <Plus className="h-3.5 w-3.5" /> Add option
                </button>
              )}
            </div>
            <div className="space-y-2">
              {options.map((o, i) => (
                <div key={i} className={cn("flex items-center gap-2 rounded border px-2 py-1.5", o.isCorrect ? "border-ok-100 bg-ok-50" : "border-line")}>
                  <button type="button" onClick={() => setCorrect(i)} aria-label="Mark correct" className={cn("flex h-5 w-5 shrink-0 items-center justify-center border text-[11px] font-semibold", type === "SINGLE" ? "rounded-full" : "rounded-sm", o.isCorrect ? "border-ok-600 bg-ok-600 text-white" : "border-line-strong bg-white text-ink-400")}>
                    {String.fromCharCode(65 + i)}
                  </button>
                  <input className="h-8 flex-1 bg-transparent text-[13.5px] outline-none" value={o.text} placeholder={`Option ${String.fromCharCode(65 + i)}`} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                  {options.length > 2 && (
                    <button type="button" className="rounded p-1 text-ink-400 hover:text-bad-600" onClick={() => setOptions(options.filter((_, j) => j !== i))} aria-label="Remove option">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {type === "TRUE_FALSE" && (
          <Field label="Correct answer">
            <div className="flex gap-2">
              {[true, false].map((v) => (
                <button key={String(v)} type="button" onClick={() => setTfAnswer(v)} className={cn("h-9 w-28 rounded border text-[13px] font-medium", tfAnswer === v ? "border-ok-600 bg-ok-50 text-ok-600" : "border-line-strong bg-white")}>
                  {v ? "True" : "False"}
                </button>
              ))}
            </div>
          </Field>
        )}
        {type === "NUMERICAL" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Correct value" required><Input inputMode="decimal" value={numeric} onChange={(e) => setNumeric(e.target.value)} className="num" /></Field>
            <Field label="Tolerance (±)" hint="0 for an exact match"><Input type="number" step="any" min={0} value={tolerance} onChange={(e) => setTolerance(e.target.value)} className="num" /></Field>
          </div>
        )}
        {type === "SHORT" && (
          <Field label="Accepted answers" hint="Case-insensitive exact match. Leave empty to evaluate manually.">
            <TagInput value={accepted} onChange={setAccepted} placeholder="Type an answer and press Enter" />
          </Field>
        )}
        {type === "CODING" && (
          <div className="grid gap-3">
            <Field label="Allowed Programming Languages" hint="Controls which languages appear in the candidate's editor dropdown.">
              <Select value={codeLanguage} onChange={(e) => setCodeLanguage(e.target.value)}>
                <option value="all">All Languages (C, C++, Java, Python 3) [Default]</option>
                <option value="python_only">Python 3 Only</option>
                <option value="c_only">C (GCC) Only</option>
                <option value="cpp_only">C++ (G++) Only</option>
                <option value="java_only">Java (OpenJDK) Only</option>
                <option value="c,cpp">C & C++ Only</option>
              </Select>
            </Field>
            <Field label="Default Starter Code (Optional)" hint="Candidates will start with standard templates or this custom template.">
              <Textarea rows={6} value={codeStarter} onChange={(e) => setCodeStarter(e.target.value)} className="font-mono text-[12.5px]" spellCheck={false} />
            </Field>
          </div>
        )}
        {type === "PROMPT" && (
          <div className="space-y-3 rounded-lg border border-steel-200 bg-steel-50/30 p-3">
            <span className="font-semibold text-steel-900 block text-xs">Prompt Engineering Scenario Configuration</span>
            <Field label="Assessment Title" hint="e.g. Zero-Downtime Microservices Migration Prompt">
              <Input value={promptTitle} onChange={(e) => setPromptTitle(e.target.value)} placeholder="Title of the prompt problem" />
            </Field>
            <Field label="Scenario Description" hint="Detailed background, domain constraints and problem setting">
              <Textarea rows={3} value={promptScenario} onChange={(e) => setPromptScenario(e.target.value)} placeholder="Describe the technical scenario..." />
            </Field>
            <Field label="Technical Requirements" hint="Enter one requirement per line">
              <Textarea rows={4} value={promptRequirements} onChange={(e) => setPromptRequirements(e.target.value)} placeholder="1. Define system role and constraints&#10;2. Multi-phase backward compatible DDL&#10;3. Lock timeout configuration" />
            </Field>
            <Field label="Expected Output Format" hint="e.g. Structured JSON or Python code">
              <Input value={promptExpectedOutput} onChange={(e) => setPromptExpectedOutput(e.target.value)} placeholder="e.g. Structured JSON matching execution plan" />
            </Field>
          </div>
        )}
        {type === "PROMPT" && <Alert tone="navy">Prompt Engineering questions permit up to 2 candidate attempts and support automated rubric evaluation with HR manual override capability.</Alert>}
        {(type === "DESCRIPTIVE" || type === "CODING") && <Alert tone="navy">This question type is evaluated manually in Evaluation & Review.</Alert>}

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Difficulty">
            <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
              <option value="EASY">Easy</option>
              <option value="MEDIUM">Medium</option>
              <option value="HARD">Hard</option>
            </Select>
          </Field>
          <Field label="Marks"><Input type="number" min={0} step="0.5" value={marks} onChange={(e) => setMarks(Number(e.target.value))} className="num" /></Field>
          <Field label="Negative marks" hint="Applied only if the exam enables it"><Input type="number" min={0} step="0.25" value={negativeMarks} onChange={(e) => setNegativeMarks(Number(e.target.value))} className="num" /></Field>
        </div>
        <Field label="Explanation (shown in released results)">
          <Textarea rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
        </Field>
        <Field label="Tags">
          <TagInput value={tags} onChange={setTags} placeholder="e.g. machining" />
        </Field>
      </div>
    </Dialog>
  );
}

import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Check, X } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { Alert, Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { fmtDateTime, fmtPct, QUESTION_TYPE_LABEL } from "@/lib/format";
import type { QuestionType } from "@/lib/types";
import { cn } from "@/lib/cn";

interface R {
  exam: { title: string; passingMarks: number };
  submittedAt: string;
  score: number;
  maxScore: number;
  percentage: number;
  passed: boolean;
  sections: { title: string; score: number; max: number; questions: { number: number; text: string; type: QuestionType; marks: number; marksAwarded: number; isCorrect: boolean | null; explanation: string | null; options: { id: string; text: string; isCorrect: boolean; selected: boolean }[]; textAnswer: string | null; acceptedAnswers: string[]; evaluatorNote: string | null }[] }[];
}

export default function ResultView() {
  const { attemptId } = useParams();
  const { data: r, loading, error } = useApi<R>(`/me/results/${attemptId}`, [attemptId]);
  if (loading) return <Spinner />;
  if (error || !r) return <Alert tone="warn">{error ?? "Result unavailable"}</Alert>;
  return (
    <div>
      <PageHeader
        back={<Link to="/candidate" className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-ink-500 hover:text-ink-900"><ArrowLeft className="h-3.5 w-3.5" /> My examinations</Link>}
        title={r.exam.title}
        subtitle={`Submitted ${fmtDateTime(r.submittedAt)}`}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card p-4"><div className="label-caps">Score</div><div className="num mt-1 text-[24px]">{r.score}<span className="text-ink-400 text-[16px]">/{r.maxScore}</span></div></div>
        <div className="card p-4"><div className="label-caps">Percentage</div><div className="num mt-1 text-[24px]">{fmtPct(r.percentage)}</div></div>
        <div className="card p-4"><div className="label-caps">Result</div><div className="mt-2">{r.passed ? <Badge tone="ok">Qualified</Badge> : <Badge>Not qualified</Badge>}</div></div>
        <div className="card p-4"><div className="label-caps">Qualifying marks</div><div className="num mt-1 text-[24px]">{r.exam.passingMarks}</div></div>
      </div>
      <Card title="Section-wise performance" className="mb-5">
        <div className="grid gap-4 sm:grid-cols-3">
          {r.sections.map((s) => (
            <div key={s.title}>
              <div className="flex justify-between text-[13px]"><span className="font-medium">{s.title}</span><span className="num">{s.score}/{s.max}</span></div>
              <div className="mt-1.5 h-2 rounded-sm bg-canvas"><div className="h-2 rounded-sm bg-navy-700" style={{ width: `${s.max ? Math.max(0, (s.score / s.max) * 100) : 0}%` }} /></div>
            </div>
          ))}
        </div>
      </Card>
      <div className="space-y-3">
        {r.sections.flatMap((s) => s.questions.map((q) => ({ ...q, section: s.title }))).map((q, i) => (
          <div key={i} className={cn("card border-l-[3px] p-4", q.isCorrect ? "border-l-ok-600" : q.marksAwarded > 0 ? "border-l-steel-500" : "border-l-bad-600")}>
            <div className="flex justify-between text-[12px] text-ink-500">
              <span>Q{i + 1} · {q.section} · {QUESTION_TYPE_LABEL[q.type]}</span>
              <span className="num font-medium text-ink-900">{q.marksAwarded}/{q.marks}</span>
            </div>
            <div className="prose-q mt-1.5 text-[13.5px]">{q.text}</div>
            {q.options.length > 0 ? (
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {q.options.map((o) => (
                  <div key={o.id} className={cn("flex items-center gap-2 rounded border px-2.5 py-1.5 text-[12.5px]", o.isCorrect ? "border-ok-100 bg-ok-50" : o.selected ? "border-bad-100 bg-bad-50" : "border-line")}>
                    <span className="flex-1">{o.text}</span>
                    {o.selected && (o.isCorrect ? <Check className="h-3.5 w-3.5 text-ok-600" /> : <X className="h-3.5 w-3.5 text-bad-600" />)}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-[13px]">
                <span className="text-ink-500">Your answer: </span>
                <span className="whitespace-pre-wrap">{q.textAnswer || "—"}</span>
                {q.acceptedAnswers.length > 0 && <div className="text-[12px] text-ok-600">Correct answer: {q.acceptedAnswers[0]}</div>}
              </div>
            )}
            {q.explanation && <div className="mt-2 text-[12px] text-ink-500">{q.explanation}</div>}
            {q.evaluatorNote && <div className="mt-1 text-[12px] text-steel-600">Evaluator: {q.evaluatorNote}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

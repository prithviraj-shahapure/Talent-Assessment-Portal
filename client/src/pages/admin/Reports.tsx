import { useState } from "react";
import { FileSpreadsheet, FileText, Users } from "lucide-react";
import { download, qs } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { Button, Card, Field, PageHeader, Select, useToast } from "@/components/ui";
import { STAGE_LABEL, STAGES } from "@/lib/format";
import type { Exam } from "@/lib/types";

export default function Reports() {
  const toast = useToast();
  const { data: exams } = useApi<Exam[]>("/exams");
  const [examId, setExamId] = useState("");
  const [stage, setStage] = useState("");
  const [candExam, setCandExam] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, path: string, name: string) => {
    setBusy(key);
    try {
      await download(path, name);
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(null);
    }
  };
  const examList = (exams ?? []).filter((e) => e.status !== "DRAFT");
  const eid = examId || examList[0]?.id || "";

  return (
    <div>
      <PageHeader title="Reports" subtitle="Download examination results, candidate lists and performance reports. Every export is recorded in the audit log." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Examination results" subtitle="Leaderboard with section-wise scores, result, time taken and proctoring level">
          <Field label="Examination">
            <Select value={eid} onChange={(e) => setExamId(e.target.value)}>
              {examList.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </Select>
          </Field>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={!eid} loading={busy === "xlsx"} onClick={() => run("xlsx", `/results/exams/${eid}/export`, "results.xlsx")}><FileSpreadsheet className="h-4 w-4" /> Excel</Button>
            <Button variant="secondary" disabled={!eid} loading={busy === "csv"} onClick={() => run("csv", `/results/exams/${eid}/export?format=csv`, "results.csv")}><FileSpreadsheet className="h-4 w-4" /> CSV</Button>
            <Button variant="secondary" disabled={!eid} loading={busy === "pdf"} onClick={() => run("pdf", `/reports/exams/${eid}/pdf`, "exam-report.pdf")}><FileText className="h-4 w-4" /> Summary PDF</Button>
          </div>
        </Card>
        <Card title="Candidate register" subtitle="Profiles, education, stage and examinations taken">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Stage">
              <Select value={stage} onChange={(e) => setStage(e.target.value)}>
                <option value="">All stages</option>
                {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
              </Select>
            </Field>
            <Field label="Examination">
              <Select value={candExam} onChange={(e) => setCandExam(e.target.value)}>
                <option value="">Any</option>
                {examList.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
              </Select>
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button loading={busy === "cx"} onClick={() => run("cx", `/candidates/export${qs({ stage, examId: candExam })}`, "candidates.xlsx")}><Users className="h-4 w-4" /> Excel</Button>
            <Button variant="secondary" loading={busy === "cc"} onClick={() => run("cc", `/candidates/export${qs({ stage, examId: candExam, format: "csv" })}`, "candidates.csv")}><Users className="h-4 w-4" /> CSV</Button>
          </div>
        </Card>
        <Card title="Individual candidate reports" subtitle="Detailed PDF with section-wise and question-wise evaluation and a proctoring summary" className="lg:col-span-2">
          <p className="text-[13px] text-ink-700">Open any attempt from <b>Results & Rankings</b> or a candidate's profile and choose <b>PDF report</b>.</p>
        </Card>
      </div>
    </div>
  );
}

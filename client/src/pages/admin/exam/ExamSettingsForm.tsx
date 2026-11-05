import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { Alert, Button, Card, Field, Input, Select, Switch, TagInput, Textarea, useToast } from "@/components/ui";
import type { Department, Exam } from "@/lib/types";

export const toLocalInput = (iso: string | Date) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const DEFAULT_INSTRUCTIONS = `1. Use a laptop or desktop with Google Chrome or Microsoft Edge.
2. Keep your face clearly visible to the webcam throughout. Sit alone in a quiet, well-lit room.
3. The examination runs in fullscreen. Switching tabs, leaving fullscreen or copying/pasting is logged.
4. Answers are saved automatically. If your connection drops, reconnect and resume — the timer keeps running.
5. The examination is submitted automatically when time is up.
6. Mobile phones, notes and other people are not permitted.`;

export function ExamSettingsForm({ exam, onSaved }: { exam: Exam | null; onSaved: (e: Exam) => void }) {
  const toast = useToast();
  const { data: depts } = useApi<Department[]>("/departments");
  const tomorrow = new Date(Date.now() + 86400_000);
  tomorrow.setHours(10, 0, 0, 0);
  const [f, setF] = useState(() => ({
    title: exam?.title ?? "",
    description: exam?.description ?? "",
    departmentId: exam?.departmentId ?? "",
    position: exam?.position ?? "",
    category: exam?.category ?? "",
    startAt: toLocalInput(exam?.startAt ?? tomorrow),
    endAt: toLocalInput(exam?.endAt ?? new Date(tomorrow.getTime() + 7 * 86400_000)),
    durationMinutes: exam?.durationMinutes ?? 60,
    passingMarks: exam?.passingMarks ?? 0,
    negativeMarking: exam?.negativeMarking ?? false,
    maxAttempts: exam?.maxAttempts ?? 1,
    randomizeQuestions: exam?.randomizeQuestions ?? true,
    randomizeOptions: exam?.randomizeOptions ?? true,
    sectionTimeLimits: exam?.sectionTimeLimits ?? false,
    instructions: exam?.instructions ?? DEFAULT_INSTRUCTIONS,
    resultPublication: exam?.resultPublication ?? "MANUAL",
    proctoringEnabled: exam?.proctoringEnabled ?? true,
    requireWebcam: exam?.requireWebcam ?? true,
    requireMicrophone: exam?.requireMicrophone ?? true,
    requireFullscreen: exam?.requireFullscreen ?? true,
    evidenceCapture: exam?.evidenceCapture ?? false,
    livePreview: exam?.livePreview ?? true,
    eligDegrees: exam?.eligibility?.degrees ?? [],
    eligBranches: exam?.eligibility?.branches ?? [],
    eligYears: (exam?.eligibility?.graduationYears ?? []).map(String),
    eligColleges: exam?.eligibility?.colleges ?? [],
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [f]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      const body = {
        title: f.title,
        description: f.description || null,
        departmentId: f.departmentId || null,
        position: f.position || null,
        category: f.category || null,
        startAt: new Date(f.startAt).toISOString(),
        endAt: new Date(f.endAt).toISOString(),
        durationMinutes: Number(f.durationMinutes),
        passingMarks: Number(f.passingMarks),
        negativeMarking: f.negativeMarking,
        maxAttempts: Number(f.maxAttempts),
        randomizeQuestions: f.randomizeQuestions,
        randomizeOptions: f.randomizeOptions,
        sectionTimeLimits: f.sectionTimeLimits,
        instructions: f.instructions || null,
        resultPublication: f.resultPublication,
        proctoringEnabled: f.proctoringEnabled,
        requireWebcam: f.proctoringEnabled && f.requireWebcam,
        requireMicrophone: f.proctoringEnabled && f.requireMicrophone,
        requireFullscreen: f.requireFullscreen,
        evidenceCapture: f.proctoringEnabled && f.requireWebcam && f.evidenceCapture,
        livePreview: f.proctoringEnabled && f.requireWebcam && f.livePreview,
        eligibility:
          f.eligDegrees.length || f.eligBranches.length || f.eligYears.length || f.eligColleges.length
            ? { degrees: f.eligDegrees, branches: f.eligBranches, graduationYears: f.eligYears.map(Number).filter((n) => !Number.isNaN(n)), colleges: f.eligColleges }
            : null,
      };
      const saved = exam ? await api<Exam>(`/exams/${exam.id}`, { method: "PUT", body }) : await api<Exam>("/exams", { body });
      toast(exam ? "Settings saved" : "Examination created");
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="grid gap-5 xl:grid-cols-[1fr_380px]"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="space-y-5 min-w-0">
        {error && <Alert tone="bad">{error}</Alert>}
        <Card title="Examination details">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Examination title" required className="sm:col-span-2">
              <Input required minLength={3} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Graduate Engineer Trainee — Mechanical" />
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <Textarea rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} />
            </Field>
            <Field label="Department">
              <Select value={f.departmentId} onChange={(e) => set("departmentId", e.target.value)}>
                <option value="">— Select —</option>
                {depts?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Position / internship role">
              <Input value={f.position} onChange={(e) => set("position", e.target.value)} placeholder="e.g. Graduate Engineer Trainee" />
            </Field>
            <Field label="Examination category">
              <Input value={f.category} onChange={(e) => set("category", e.target.value)} placeholder="e.g. Campus recruitment, Internship" list="exam-categories" />
              <datalist id="exam-categories">
                {["Campus Recruitment", "Internship", "Walk-in Drive", "Apprenticeship", "Lateral Hiring"].map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
          </div>
        </Card>

        <Card title="Schedule & scoring">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Opens at" required>
              <Input type="datetime-local" required value={f.startAt} onChange={(e) => set("startAt", e.target.value)} />
            </Field>
            <Field label="Closes at" required>
              <Input type="datetime-local" required value={f.endAt} onChange={(e) => set("endAt", e.target.value)} />
            </Field>
            <Field label="Duration (minutes)" required hint="Attempts also end when the window closes">
              <Input type="number" min={1} max={600} required value={f.durationMinutes} onChange={(e) => set("durationMinutes", Number(e.target.value))} />
            </Field>
            <Field label="Total marks" hint="Calculated from the questions added">
              <Input disabled value={exam?.totalMarks ?? 0} className="num" />
            </Field>
            <Field label="Passing marks" required>
              <Input type="number" min={0} step="0.5" value={f.passingMarks} onChange={(e) => set("passingMarks", Number(e.target.value))} />
            </Field>
            <Field label="Attempts allowed" required>
              <Input type="number" min={1} max={10} value={f.maxAttempts} onChange={(e) => set("maxAttempts", Number(e.target.value))} />
            </Field>
            <Field label="Result publication" className="lg:col-span-3 sm:col-span-2">
              <Select value={f.resultPublication} onChange={(e) => set("resultPublication", e.target.value as Exam["resultPublication"])}>
                <option value="MANUAL">Manual — HR releases results</option>
                <option value="AFTER_EXAM_END">Automatically after the examination window closes</option>
                <option value="IMMEDIATE">Immediately after evaluation</option>
              </Select>
            </Field>
          </div>
          <div className="mt-4 grid gap-x-8 sm:grid-cols-2 border-t border-line pt-3">
            <Switch checked={f.negativeMarking} onChange={(v) => set("negativeMarking", v)} label="Negative marking" description="Deduct each question's negative marks for wrong answers" />
            <Switch checked={f.randomizeQuestions} onChange={(v) => set("randomizeQuestions", v)} label="Randomise question order" description="Each candidate gets a different order within sections" />
            <Switch checked={f.randomizeOptions} onChange={(v) => set("randomizeOptions", v)} label="Randomise answer options" description="Shuffle options for MCQ questions" />
            <Switch checked={f.sectionTimeLimits} onChange={(v) => set("sectionTimeLimits", v)} label="Section-wise time limits" description="Sections are taken in order; each has its own timer and locks when done" />
          </div>
        </Card>

        <Card title="Instructions to candidates">
          <Textarea rows={9} value={f.instructions} onChange={(e) => set("instructions", e.target.value)} className="font-mono text-[12.5px]" />
        </Card>

        <Card title="Candidate eligibility" subtitle="Leave empty to allow everyone. Applied when a candidate is invited or assigned.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Degrees" hint="Press Enter after each value">
              <TagInput value={f.eligDegrees} onChange={(v) => set("eligDegrees", v)} placeholder="e.g. B.E." />
            </Field>
            <Field label="Branches">
              <TagInput value={f.eligBranches} onChange={(v) => set("eligBranches", v)} placeholder="e.g. Mechanical Engineering" />
            </Field>
            <Field label="Graduation years">
              <TagInput value={f.eligYears} onChange={(v) => set("eligYears", v.filter((x) => /^\d{4}$/.test(x)))} placeholder="e.g. 2026" />
            </Field>
            <Field label="Colleges">
              <TagInput value={f.eligColleges} onChange={(v) => set("eligColleges", v)} placeholder="Exact college name" />
            </Field>
          </div>
        </Card>
      </div>

      <div className="space-y-5">
        <Card title="Proctoring">
          <Switch checked={f.proctoringEnabled} onChange={(v) => set("proctoringEnabled", v)} label="Enable proctoring" description="Webcam, microphone and browser activity monitoring" />
          <div className="ml-1 border-l-2 border-line pl-3">
            <Switch disabled={!f.proctoringEnabled} checked={f.requireWebcam} onChange={(v) => set("requireWebcam", v)} label="Require webcam" description="Face presence and multiple-face detection" />
            <Switch disabled={!f.proctoringEnabled} checked={f.requireMicrophone} onChange={(v) => set("requireMicrophone", v)} label="Require microphone" description="Audio level monitoring only — no recording" />
            <Switch disabled={!f.proctoringEnabled || !f.requireWebcam} checked={f.livePreview} onChange={(v) => set("livePreview", v)} label="Live preview for HR" description="Low-resolution frames every few seconds, not stored" />
            <Switch disabled={!f.proctoringEnabled || !f.requireWebcam} checked={f.evidenceCapture} onChange={(v) => set("evidenceCapture", v)} label="Evidence snapshots" description="Save a still image when an event is flagged — only if the candidate consents" />
          </div>
          <Switch checked={f.requireFullscreen} onChange={(v) => set("requireFullscreen", v)} label="Require fullscreen" description="Fullscreen exits are logged" />
          <Alert className="mt-3" tone="warn">
            Browser monitoring cannot detect secondary phones, virtual machines or all screen recording. Risk scores are for human review only.
          </Alert>
        </Card>
        <div className="sticky top-4">
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            <Save className="h-4 w-4" /> {exam ? "Save settings" : "Create examination"}
          </Button>
        </div>
      </div>
    </form>
  );
}

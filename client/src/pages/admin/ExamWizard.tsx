import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Layers, MoveDown, MoveUp, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, Field, Input, PageHeader, Textarea, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { QuestionReviewModal } from "./QuestionReviewModal";
import { Step4DocumentManagement } from "./wizard/Step4DocumentManagement";

const AVAILABLE_SECTIONS = [
  { id: "aptitude", title: "Aptitude Test", defaultDuration: 30, defaultQuestions: 30, defaultMarks: 30, passingMarks: 18, type: "APTITUDE", desc: "General numerical, analytical and cognitive problem solving." },
  { id: "logical", title: "Logical Reasoning", defaultDuration: 25, defaultQuestions: 25, defaultMarks: 25, passingMarks: 15, type: "APTITUDE", desc: "Deductive, inductive, and pattern recognition assessments." },
  { id: "quant", title: "Quantitative Aptitude", defaultDuration: 30, defaultQuestions: 25, defaultMarks: 25, passingMarks: 15, type: "APTITUDE", desc: "Arithmetic, algebra, and mathematical reasoning." },
  { id: "verbal", title: "Verbal Ability", defaultDuration: 20, defaultQuestions: 20, defaultMarks: 20, passingMarks: 12, type: "APTITUDE", desc: "Reading comprehension, grammar, and vocabulary." },
  { id: "technical", title: "Technical Test", defaultDuration: 45, defaultQuestions: 25, defaultMarks: 50, passingMarks: 25, type: "TECHNICAL", desc: "Core computer science and engineering competencies." },
  { id: "prog_fund", title: "Programming Fundamentals", defaultDuration: 30, defaultQuestions: 20, defaultMarks: 40, passingMarks: 20, type: "TECHNICAL", desc: "Control structures, OOP concepts, algorithms, and syntax." },
  { id: "dsa", title: "Data Structures & Algorithms", defaultDuration: 45, defaultQuestions: 20, defaultMarks: 50, passingMarks: 25, type: "TECHNICAL", desc: "Trees, graphs, dynamic programming, sorting and complexity." },
  { id: "dbms", title: "Database Management Systems", defaultDuration: 30, defaultQuestions: 20, defaultMarks: 30, passingMarks: 15, type: "TECHNICAL", desc: "SQL queries, normalization, indexing, and ACID properties." },
  { id: "aiml", title: "Artificial Intelligence & Machine Learning", defaultDuration: 40, defaultQuestions: 20, defaultMarks: 40, passingMarks: 20, type: "TECHNICAL", desc: "Supervised/unsupervised learning, neural networks, and NLP." },
  { id: "cn", title: "Computer Networks", defaultDuration: 25, defaultQuestions: 20, defaultMarks: 25, passingMarks: 12, type: "TECHNICAL", desc: "OSI model, TCP/IP, routing, DNS, and HTTP protocols." },
  { id: "os", title: "Operating Systems", defaultDuration: 25, defaultQuestions: 20, defaultMarks: 25, passingMarks: 12, type: "TECHNICAL", desc: "Processes, threads, memory management, and file systems." },
  { id: "prompt_eng", title: "Prompt Engineering", defaultDuration: 20, defaultQuestions: 10, defaultMarks: 20, passingMarks: 10, type: "PROMPT_ENGINEERING", desc: "Context injection, few-shot prompting, and AI alignment." },
  { id: "coding_test", title: "Practical Coding Test", defaultDuration: 60, defaultQuestions: 3, defaultMarks: 60, passingMarks: 30, type: "TECHNICAL", desc: "Hands-on algorithmic programming challenges." },
  { id: "descriptive", title: "Descriptive Assessment", defaultDuration: 30, defaultQuestions: 5, defaultMarks: 25, passingMarks: 12, type: "CUSTOM", desc: "Subjective long-form engineering essays and architecture critiques." },
  { id: "custom", title: "Custom Assessment", defaultDuration: 30, defaultQuestions: 15, defaultMarks: 30, passingMarks: 15, type: "CUSTOM", desc: "Fully custom role-specific questions and domain criteria." },
];

interface WizardSection {
  id: string;
  title: string;
  description: string;
  durationMinutes: number;
  totalMarks: number;
  passingMarks: number;
  negativeMarks: number;
  totalQuestions: number;
  isMandatory: boolean;
  questionTypes: string[];
  easyPct: number;
  mediumPct: number;
  hardPct: number;
  instructions: string;
}

export default function ExamWizard() {
  const nav = useNavigate();
  const toast = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [saving, setSaving] = useState(false);

  // STEP 1: Basic Information
  const [basic, setBasic] = useState({
    title: "",
    description: "",
    position: "Software Engineering Intern",
    departmentId: "",
    startAt: new Date(Date.now() + 3600_000).toISOString().slice(0, 16),
    endAt: new Date(Date.now() + 86400_000).toISOString().slice(0, 16),
    maxAttempts: 1,
    instructions: "Please ensure a quiet environment with working webcam and microphone. Sections must be answered sequentially.",
    passingMarks: 50,
  });

  // STEP 2: Selected Sections List (Order preserved)
  const [selectedSectionIds, setSelectedSectionIds] = useState<string[]>([
    "aptitude",
    "technical",
    "prompt_eng",
  ]);

  // STEP 3: Detailed Section Configurations
  const [sectionsConfig, setSectionsConfig] = useState<Record<string, WizardSection>>(() => {
    const init: Record<string, WizardSection> = {};
    AVAILABLE_SECTIONS.forEach((sec) => {
      init[sec.id] = {
        id: sec.id,
        title: sec.title,
        description: sec.desc,
        durationMinutes: sec.defaultDuration,
        totalMarks: sec.defaultMarks,
        passingMarks: sec.passingMarks,
        negativeMarks: 0.25,
        totalQuestions: sec.defaultQuestions,
        isMandatory: true,
        questionTypes: ["MCQ"],
        easyPct: 30,
        mediumPct: 50,
        hardPct: 20,
        instructions: `Complete the ${sec.title} within the allotted time. Unsubmitted answers will automatically freeze when the timer concludes.`,
      };
    });
    return init;
  });

  const [activeConfigTab, setActiveConfigTab] = useState<string>("aptitude");

  // STEP 4: Questions Management / Upload
  const [importModalOpen, setImportModalOpen] = useState(false);

  // STEP 5: Proctoring Configuration
  const [proctoring, setProctoring] = useState({
    proctoringEnabled: true,
    requireWebcam: true,
    requireMicrophone: true,
    requireFullscreen: true,
    evidenceCapture: true,
    livePreview: true,
    faceDetection: true,
    multipleFaceDetection: true,
    faceAbsenceDetection: true,
    audioMonitoring: true,
    tabSwitchDetection: true,
    copyPasteMonitoring: true,
    browserFocusMonitoring: true,
  });

  const totalDuration = selectedSectionIds.reduce((sum, id) => sum + (sectionsConfig[id]?.durationMinutes || 0), 0);
  const totalMarks = selectedSectionIds.reduce((sum, id) => sum + (sectionsConfig[id]?.totalMarks || 0), 0);

  const moveSection = (from: number, to: number) => {
    if (to < 0 || to >= selectedSectionIds.length) return;
    const next = [...selectedSectionIds];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setSelectedSectionIds(next);
  };

  const toggleSection = (id: string) => {
    if (selectedSectionIds.includes(id)) {
      if (selectedSectionIds.length === 1) {
        toast("The examination must contain at least one stage.", "bad");
        return;
      }
      setSelectedSectionIds(selectedSectionIds.filter((x) => x !== id));
    } else {
      setSelectedSectionIds([...selectedSectionIds, id]);
    }
  };

  const handlePublish = async (asDraft = false) => {
    if (!basic.title.trim()) {
      toast("Please specify an examination title.", "bad");
      setCurrentStep(1);
      return;
    }
    setSaving(true);
    try {
      // 1. Create Exam
      const examData = {
        title: basic.title,
        description: basic.description,
        position: basic.position,
        departmentId: basic.departmentId || null,
        startAt: new Date(basic.startAt),
        endAt: new Date(basic.endAt),
        durationMinutes: totalDuration,
        passingMarks: basic.passingMarks,
        negativeMarking: true,
        maxAttempts: basic.maxAttempts,
        sectionTimeLimits: true, // Multi-stage strictly uses section timers
        randomizeQuestions: true,
        randomizeOptions: true,
        instructions: basic.instructions,
        status: asDraft ? "DRAFT" : "PUBLISHED",
        proctoringEnabled: proctoring.proctoringEnabled,
        requireWebcam: proctoring.requireWebcam,
        requireMicrophone: proctoring.requireMicrophone,
        requireFullscreen: proctoring.requireFullscreen,
        evidenceCapture: proctoring.evidenceCapture,
        livePreview: proctoring.livePreview,
      };

      const created = await api<{ id: string }>("/exams", {
        method: "POST",
        body: examData,
      });

      // 2. Clear default single section and create configured sections
      // Fetch default section created on POST /exams
      const examDetail = await api<{ sections: { id: string }[] }>(`/exams/${created.id}`);
      if (examDetail.sections.length > 0) {
        await api(`/exams/sections/${examDetail.sections[0].id}`, { method: "DELETE" }).catch(() => {});
      }

      // 3. Create all multi-stage sections
      // Fetch any uploaded documents to auto-bind questions for each stage
      let existingDocs: any[] = [];
      try {
        existingDocs = await api<any[]>("/documents");
      } catch (err) {
        console.warn("Could not fetch documents for auto-binding:", err);
      }

      for (let i = 0; i < selectedSectionIds.length; i++) {
        const secId = selectedSectionIds[i];
        const cfg = sectionsConfig[secId];
        const createdSec = await api<{ id: string }>(`/exams/${created.id}/sections`, {
          method: "POST",
          body: {
            title: cfg.title,
            description: cfg.description,
            order: i,
            timeLimitMinutes: cfg.durationMinutes,
            passingMarks: cfg.passingMarks,
            negativeMarks: cfg.negativeMarks,
            instructions: cfg.instructions,
            isMandatory: cfg.isMandatory,
            sectionType: cfg.id.toUpperCase(),
            difficultyConfig: { easy: cfg.easyPct, medium: cfg.mediumPct, hard: cfg.hardPct },
          },
        });

        // Auto-bind questions from documents assigned to this stage
        const matchingDocs = existingDocs.filter((d) => d.assignedStageId === secId);
        for (const doc of matchingDocs) {
          try {
            const docDetail = await api<any>(`/documents/${doc.id}`);
            const secIds = docDetail.sections?.map((s: any) => s.id) || [];
            if (secIds.length > 0 && createdSec?.id) {
              await api("/documents/generate-paper", {
                method: "POST",
                body: {
                  examId: created.id,
                  documentId: doc.id,
                  targetSectionId: createdSec.id,
                  selectedSectionIds: secIds,
                },
              });
            }
          } catch (bindErr) {
            console.warn(`Failed to auto-bind doc ${doc.id} to stage ${secId}:`, bindErr);
          }
        }
      }

      toast(asDraft ? "Multi-stage examination saved as draft" : "Multi-stage examination published successfully!");
      nav(`/admin/exams/${created.id}?tab=questions`);
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto pb-16 space-y-6">
      <PageHeader
        back={
          <button onClick={() => nav("/admin/exams")} className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-ink-500 hover:text-ink-900">
            <ArrowLeft className="h-3.5 w-3.5" /> Cancel & Back to Exams
          </button>
        }
        title="Multi-Stage Examination Builder"
        subtitle="Configure multi-section recruitment exams with independent time limits and sequential progression."
      />

      {/* Wizard Stepper Progress Bar */}
      <div className="grid grid-cols-6 gap-2 p-2 bg-white rounded-lg border border-line shadow-xs text-xs font-medium">
        {[
          { num: 1, label: "Basic Info" },
          { num: 2, label: "Select Sections" },
          { num: 3, label: "Section Config" },
          { num: 4, label: "Questions" },
          { num: 5, label: "Proctoring" },
          { num: 6, label: "Review & Publish" },
        ].map((s) => (
          <button
            key={s.num}
            onClick={() => setCurrentStep(s.num)}
            className={`flex items-center justify-center gap-2 py-2 px-1 rounded-md transition-colors ${
              currentStep === s.num
                ? "bg-navy-900 text-white font-semibold"
                : currentStep > s.num
                ? "text-emerald-700 bg-emerald-50/60"
                : "text-ink-500 hover:bg-sand-50"
            }`}
          >
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-mono ${
                currentStep === s.num
                  ? "bg-white text-navy-900 font-bold"
                  : currentStep > s.num
                  ? "bg-emerald-600 text-white"
                  : "bg-sand-200 text-ink-600"
              }`}
            >
              {currentStep > s.num ? <Check className="h-3 w-3" /> : s.num}
            </span>
            <span className="hidden sm:inline truncate">{s.label}</span>
          </button>
        ))}
      </div>

      {/* STEP 1: Basic Information */}
      {currentStep === 1 && (
        <Card title="Step 1: Examination Basic Information" subtitle="Set the primary title, candidate role, window schedule, and instructions.">
          <div className="space-y-4 max-w-2xl text-xs">
            <Field label="Examination Name" required>
              <Input
                value={basic.title}
                onChange={(e) => setBasic({ ...basic, title: e.target.value })}
                placeholder="e.g. Zanvar Group Campus Recruitment 2026 - Engineering"
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Internship Position / Role">
                <Input
                  value={basic.position}
                  onChange={(e) => setBasic({ ...basic, position: e.target.value })}
                  placeholder="e.g. Graduate Engineer Trainee (GET)"
                />
              </Field>
              <Field label="Maximum Attempts per Candidate">
                <Input
                  type="number"
                  min={1}
                  max={5}
                  value={basic.maxAttempts}
                  onChange={(e) => setBasic({ ...basic, maxAttempts: parseInt(e.target.value, 10) || 1 })}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Examination Window Opens" required>
                <Input
                  type="datetime-local"
                  value={basic.startAt}
                  onChange={(e) => setBasic({ ...basic, startAt: e.target.value })}
                />
              </Field>
              <Field label="Examination Window Closes" required>
                <Input
                  type="datetime-local"
                  value={basic.endAt}
                  onChange={(e) => setBasic({ ...basic, endAt: e.target.value })}
                />
              </Field>
            </div>

            <Field label="Description & Scope">
              <Textarea
                rows={3}
                value={basic.description}
                onChange={(e) => setBasic({ ...basic, description: e.target.value })}
                placeholder="Describe the assessment objectives and general guidelines for candidates."
              />
            </Field>

            <Field label="General Examination Instructions">
              <Textarea
                rows={4}
                value={basic.instructions}
                onChange={(e) => setBasic({ ...basic, instructions: e.target.value })}
              />
            </Field>
          </div>
        </Card>
      )}

      {/* STEP 2: Select Examination Sections */}
      {currentStep === 2 && (
        <Card
          title="Step 2: Select Examination Stages"
          subtitle="Enable the stages for this examination and arrange their sequential progression order."
          actions={
            <div className="text-xs text-ink-500 font-medium">
              <span className="text-navy-900 font-bold">{selectedSectionIds.length}</span> stages enabled ·{" "}
              <span className="font-mono font-bold text-navy-900">{totalDuration}</span> min total
            </div>
          }
        >
          <div className="space-y-6">
            {/* Sequential Flow Diagram */}
            <div className="p-4 bg-navy-900/5 border border-navy-900/20 rounded-lg">
              <div className="text-xs font-semibold text-navy-900 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Layers className="h-4 w-4" /> Sequential Candidate Progression Order
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {selectedSectionIds.map((secId, i) => (
                  <div key={secId} className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 px-3 py-1.5 bg-navy-900 text-white rounded font-medium shadow-xs">
                      <span className="font-mono opacity-60 mr-0.5">{i + 1}.</span> {sectionsConfig[secId]?.title || secId}
                      <span className="text-[10px] bg-white/20 px-1 rounded ml-1 font-mono">
                        {sectionsConfig[secId]?.durationMinutes}m
                      </span>
                    </span>
                    {i < selectedSectionIds.length - 1 && <ArrowRight className="h-4 w-4 text-ink-400 shrink-0" />}
                  </div>
                ))}
                <span className="text-ink-400">→</span>
                <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded font-semibold text-[11px]">
                  COMPLETED
                </span>
              </div>
            </div>

            {/* Grid of Sections to Enable / Reorder */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {AVAILABLE_SECTIONS.map((sec) => {
                const isSelected = selectedSectionIds.includes(sec.id);
                const orderIdx = selectedSectionIds.indexOf(sec.id);
                return (
                  <div
                    key={sec.id}
                    onClick={() => toggleSection(sec.id)}
                    className={`cursor-pointer rounded-lg border p-4 transition-all ${
                      isSelected
                        ? "border-navy-900 bg-white ring-1 ring-navy-900/30 shadow-xs"
                        : "border-line bg-surface/50 hover:bg-white opacity-60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="rounded border-line text-navy-900 h-4 w-4 pointer-events-none"
                        />
                        <span className="font-bold text-xs text-navy-900">{sec.title}</span>
                      </div>
                      {isSelected && (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <button
                            disabled={orderIdx === 0}
                            onClick={() => moveSection(orderIdx, orderIdx - 1)}
                            className="p-1 rounded hover:bg-sand-100 disabled:opacity-30"
                            title="Move Earlier"
                          >
                            <MoveUp className="h-3 w-3" />
                          </button>
                          <button
                            disabled={orderIdx === selectedSectionIds.length - 1}
                            onClick={() => moveSection(orderIdx, orderIdx + 1)}
                            className="p-1 rounded hover:bg-sand-100 disabled:opacity-30"
                            title="Move Later"
                          >
                            <MoveDown className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-ink-500 mb-3 line-clamp-2">{sec.desc}</p>
                    <div className="flex items-center justify-between text-[11px] text-ink-600 font-mono">
                      <span>{sec.defaultDuration} mins</span>
                      <span>{sec.defaultQuestions} questions</span>
                      <span>{sec.defaultMarks} marks</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* STEP 3: Detailed Section Configuration */}
      {currentStep === 3 && (
        <Card title="Step 3: Section Parameters & Marking Scheme" subtitle="Configure time limits, passing scores, question distributions and instructions per section.">
          <div className="space-y-6">
            {/* Stage Selector Tabs */}
            <div className="flex flex-wrap gap-2 border-b border-line pb-3">
              {selectedSectionIds.map((secId, i) => (
                <button
                  key={secId}
                  onClick={() => setActiveConfigTab(secId)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    activeConfigTab === secId
                      ? "bg-navy-900 text-white"
                      : "bg-surface hover:bg-sand-100 text-ink-700 border border-line"
                  }`}
                >
                  <span className="font-mono opacity-60 mr-1">{i + 1}.</span> {sectionsConfig[secId]?.title || secId}
                </button>
              ))}
            </div>

            {/* Active Section Config Form */}
            {sectionsConfig[activeConfigTab] && (
              <div className="space-y-4 max-w-2xl text-xs">
                <div className="p-3 bg-sand-50 rounded-lg border border-line flex items-center justify-between">
                  <span className="font-semibold text-navy-900 text-sm">
                    {sectionsConfig[activeConfigTab].title}
                  </span>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sectionsConfig[activeConfigTab].isMandatory}
                      onChange={(e) =>
                        setSectionsConfig({
                          ...sectionsConfig,
                          [activeConfigTab]: { ...sectionsConfig[activeConfigTab], isMandatory: e.target.checked },
                        })
                      }
                      className="rounded border-line text-navy-900 h-4 w-4"
                    />
                    <span className="font-medium text-ink-800">Mandatory Section</span>
                  </label>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Field label="Duration (Minutes)" required>
                    <Input
                      type="number"
                      min={1}
                      max={300}
                      value={sectionsConfig[activeConfigTab].durationMinutes}
                      onChange={(e) =>
                        setSectionsConfig({
                          ...sectionsConfig,
                          [activeConfigTab]: {
                            ...sectionsConfig[activeConfigTab],
                            durationMinutes: parseInt(e.target.value, 10) || 0,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="Total Questions" required>
                    <Input
                      type="number"
                      min={1}
                      value={sectionsConfig[activeConfigTab].totalQuestions}
                      onChange={(e) =>
                        setSectionsConfig({
                          ...sectionsConfig,
                          [activeConfigTab]: {
                            ...sectionsConfig[activeConfigTab],
                            totalQuestions: parseInt(e.target.value, 10) || 0,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="Total Marks" required>
                    <Input
                      type="number"
                      min={1}
                      value={sectionsConfig[activeConfigTab].totalMarks}
                      onChange={(e) =>
                        setSectionsConfig({
                          ...sectionsConfig,
                          [activeConfigTab]: {
                            ...sectionsConfig[activeConfigTab],
                            totalMarks: parseFloat(e.target.value) || 0,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="Passing Marks" required>
                    <Input
                      type="number"
                      min={0}
                      value={sectionsConfig[activeConfigTab].passingMarks}
                      onChange={(e) =>
                        setSectionsConfig({
                          ...sectionsConfig,
                          [activeConfigTab]: {
                            ...sectionsConfig[activeConfigTab],
                            passingMarks: parseFloat(e.target.value) || 0,
                          },
                        })
                      }
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Negative Marking per Wrong Answer">
                    <Input
                      type="number"
                      step="0.05"
                      min={0}
                      value={sectionsConfig[activeConfigTab].negativeMarks}
                      onChange={(e) =>
                        setSectionsConfig({
                          ...sectionsConfig,
                          [activeConfigTab]: {
                            ...sectionsConfig[activeConfigTab],
                            negativeMarks: parseFloat(e.target.value) || 0,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="Question Formats">
                    <Input
                      value={sectionsConfig[activeConfigTab].questionTypes.join(", ")}
                      onChange={(e) =>
                        setSectionsConfig({
                          ...sectionsConfig,
                          [activeConfigTab]: {
                            ...sectionsConfig[activeConfigTab],
                            questionTypes: e.target.value.split(",").map((s) => s.trim()),
                          },
                        })
                      }
                      placeholder="e.g. MCQ, Coding, Descriptive"
                    />
                  </Field>
                </div>

                <div className="p-3 bg-surface rounded-lg border border-line space-y-2">
                  <div className="font-semibold text-ink-800">Target Difficulty Distribution (%)</div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <span className="text-[11px] text-ink-500">Easy %:</span>
                      <Input
                        type="number"
                        value={sectionsConfig[activeConfigTab].easyPct}
                        onChange={(e) =>
                          setSectionsConfig({
                            ...sectionsConfig,
                            [activeConfigTab]: {
                              ...sectionsConfig[activeConfigTab],
                              easyPct: parseInt(e.target.value, 10) || 0,
                            },
                          })
                        }
                      />
                    </div>
                    <div>
                      <span className="text-[11px] text-ink-500">Medium %:</span>
                      <Input
                        type="number"
                        value={sectionsConfig[activeConfigTab].mediumPct}
                        onChange={(e) =>
                          setSectionsConfig({
                            ...sectionsConfig,
                            [activeConfigTab]: {
                              ...sectionsConfig[activeConfigTab],
                              mediumPct: parseInt(e.target.value, 10) || 0,
                            },
                          })
                        }
                      />
                    </div>
                    <div>
                      <span className="text-[11px] text-ink-500">Hard %:</span>
                      <Input
                        type="number"
                        value={sectionsConfig[activeConfigTab].hardPct}
                        onChange={(e) =>
                          setSectionsConfig({
                            ...sectionsConfig,
                            [activeConfigTab]: {
                              ...sectionsConfig[activeConfigTab],
                              hardPct: parseInt(e.target.value, 10) || 0,
                            },
                          })
                        }
                      />
                    </div>
                  </div>
                </div>

                <Field label="Stage-Specific Instructions">
                  <Textarea
                    rows={2}
                    value={sectionsConfig[activeConfigTab].instructions}
                    onChange={(e) =>
                      setSectionsConfig({
                        ...sectionsConfig,
                        [activeConfigTab]: { ...sectionsConfig[activeConfigTab], instructions: e.target.value },
                      })
                    }
                  />
                </Field>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* STEP 4: Question Management & Document Paper Generator */}
      {currentStep === 4 && (
        <Card
          title="Step 4: Question Management & Document Paper Generator"
          subtitle="Upload and manage independent question papers (.docx, .doc, .pdf, .xlsx, .csv, .rtf, .txt). Every document maintains its own sections, questions, and examination stage assignment without merging."
        >
          <Step4DocumentManagement
            selectedSectionIds={selectedSectionIds}
            sectionsConfig={sectionsConfig}
            onStageUpdated={() => {
              toast("Examination stage successfully updated from document.");
            }}
          />
        </Card>
      )}

      {/* STEP 5: Proctoring Configuration */}
      {currentStep === 5 && (
        <Card
          title="Step 5: Proctoring & Anti-Cheat Protocols"
          subtitle="Configure on-device AI telemetry and proctoring constraints across the entire examination."
        >
          <div className="space-y-4 max-w-2xl text-xs">
            <div className="p-3.5 bg-sand-50 rounded-lg border border-line flex items-center justify-between">
              <div>
                <span className="font-semibold text-navy-900">Enable Automated Proctoring</span>
                <p className="text-[11px] text-ink-500">Requires candidate verification before entering examination lobby.</p>
              </div>
              <input
                type="checkbox"
                checked={proctoring.proctoringEnabled}
                onChange={(e) => setProctoring({ ...proctoring, proctoringEnabled: e.target.checked })}
                className="rounded border-line text-navy-900 h-5 w-5"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              {[
                { key: "requireWebcam", label: "Webcam Monitoring", desc: "Monitors candidate presence via continuous video feed." },
                { key: "faceDetection", label: "AI Face Tracking", desc: "Detects candidate face pose and alignment using MediaPipe." },
                { key: "multipleFaceDetection", label: "Multiple Face Alert", desc: "Flags when additional unauthorized persons appear in camera frame." },
                { key: "faceAbsenceDetection", label: "Face Absence Detection", desc: "Logs an alert when candidate leaves the workspace or camera view." },
                { key: "requireMicrophone", label: "Microphone Audio Activity", desc: "Analyzes ambient volume spikes and background conversation." },
                { key: "requireFullscreen", label: "Fullscreen Lock", desc: "Mandates continuous fullscreen mode throughout the test." },
                { key: "tabSwitchDetection", label: "Tab Switching Detection", desc: "Detects when window loses focus or candidate switches applications." },
                { key: "copyPasteMonitoring", label: "Copy / Paste Interception", desc: "Restricts clipboard actions and logs copy/paste events." },
                { key: "browserFocusMonitoring", label: "Browser Focus Monitoring", desc: "Tracks candidate cursor and browser window activity." },
                { key: "evidenceCapture", label: "Evidence Snapshots", desc: "Captures encrypted evidence snapshots upon behavioral anomalies." },
              ].map((opt) => (
                <div key={opt.key} className="p-3 rounded border border-line bg-white flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    id={opt.key}
                    checked={(proctoring as any)[opt.key]}
                    onChange={(e) => setProctoring({ ...proctoring, [opt.key]: e.target.checked })}
                    className="rounded border-line text-navy-900 h-4 w-4 mt-0.5"
                  />
                  <label htmlFor={opt.key} className="cursor-pointer">
                    <span className="font-semibold text-navy-900 block">{opt.label}</span>
                    <span className="text-[11px] text-ink-500 leading-snug">{opt.desc}</span>
                  </label>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* STEP 6: Review and Publish */}
      {currentStep === 6 && (
        <Card
          title="Step 6: Review & Finalize Examination"
          subtitle="Confirm examination parameters, sequential stages, passing criteria, and proctoring safeguards."
        >
          <div className="space-y-6 text-xs">
            {/* Summary Highlights */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-surface rounded-lg border border-line">
                <span className="text-ink-500 block mb-1">Stages</span>
                <span className="font-bold text-lg text-navy-900">{selectedSectionIds.length}</span>
              </div>
              <div className="p-3 bg-surface rounded-lg border border-line">
                <span className="text-ink-500 block mb-1">Total Duration</span>
                <span className="font-bold text-lg text-navy-900 font-mono">{totalDuration} min</span>
              </div>
              <div className="p-3 bg-surface rounded-lg border border-line">
                <span className="text-ink-500 block mb-1">Total Marks</span>
                <span className="font-bold text-lg text-navy-900 font-mono">{totalMarks}</span>
              </div>
              <div className="p-3 bg-surface rounded-lg border border-line">
                <span className="text-ink-500 block mb-1">Pass Mark</span>
                <span className="font-bold text-lg text-emerald-700 font-mono">{basic.passingMarks}</span>
              </div>
            </div>

            {/* Stages Sequence Table */}
            <div>
              <h4 className="font-semibold text-xs text-navy-900 mb-2">Configured Sequential Flow</h4>
              <div className="border border-line rounded-lg overflow-hidden">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Sequence</th>
                      <th>Stage Title</th>
                      <th className="text-right">Duration</th>
                      <th className="text-right">Marks</th>
                      <th className="text-right">Passing</th>
                      <th className="text-right">Negative</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedSectionIds.map((secId, i) => {
                      const cfg = sectionsConfig[secId];
                      return (
                        <tr key={secId}>
                          <td className="font-mono font-bold text-navy-900">Stage {i + 1}</td>
                          <td className="font-medium text-ink-900">{cfg.title}</td>
                          <td className="text-right font-mono">{cfg.durationMinutes} min</td>
                          <td className="text-right font-mono">{cfg.totalMarks}</td>
                          <td className="text-right font-mono">{cfg.passingMarks}</td>
                          <td className="text-right font-mono">{cfg.negativeMarks}</td>
                          <td>
                            <Badge tone="ok">Configured</Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Proctoring Summary */}
            <div className="p-3 bg-sand-50 rounded-lg border border-line flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-700" />
                <div>
                  <span className="font-bold text-navy-900">Proctoring Enforcement Active</span>
                  <p className="text-[11px] text-ink-500">Webcam, Face Landmarker, Microphone, and Fullscreen Guard configured.</p>
                </div>
              </div>
              <Badge tone="navy">Protected</Badge>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-line">
              <Button variant="secondary" loading={saving} onClick={() => handlePublish(true)}>
                Save as Draft
              </Button>
              <Button loading={saving} onClick={() => handlePublish(false)}>
                Publish Multi-Stage Examination
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Navigation Buttons */}
      <div className="flex justify-between items-center pt-2">
        <Button
          variant="ghost"
          disabled={currentStep === 1}
          onClick={() => setCurrentStep((prev) => Math.max(1, prev - 1))}
        >
          <ArrowLeft className="h-4 w-4" /> Previous Step
        </Button>
        {currentStep < 6 && (
          <Button onClick={() => setCurrentStep((prev) => Math.min(6, prev + 1))}>
            Next Step <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Question Review & Upload Modal */}
      <QuestionReviewModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        targetSections={selectedSectionIds.map((id) => ({
          id,
          title: sectionsConfig[id]?.title || id,
        }))}
        onSuccess={() => {
          toast("Questions imported successfully into question bank.");
        }}
      />
    </div>
  );
}

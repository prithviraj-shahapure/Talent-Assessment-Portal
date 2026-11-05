import { useState, useRef } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Edit3,
  Trash2,
  Check,
  UploadCloud,
  Sparkles,
  FileCheck,
  FileText,
  FileSpreadsheet,
  X,
  Loader2,
} from "lucide-react";
import { Badge, Button, Dialog, Input, Select, Textarea, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import type { QuestionType, Difficulty } from "@/lib/types";

export interface ParsedOption {
  key: string;
  text: string;
}

export interface ReviewQuestion {
  rawIndex?: number;
  sectionTitle?: string;
  questionNumber?: string;
  text: string;
  type: QuestionType;
  options: ParsedOption[];
  correctAnswers: string[];
  explanation?: string;
  marks: number;
  negativeMarks: number;
  difficulty: Difficulty;
  validationErrors: string[];
  status: "VALID" | "MISSING_ANSWER" | "MISSING_OPTIONS" | "INVALID_FORMAT" | "DUPLICATE" | "REQUIRES_REVIEW";
  sourceType: "TXT_IMPORT" | "AI_GENERATED";
  approvalStatus?: "APPROVED" | "PENDING_REVIEW" | "REJECTED";
}

interface Props {
  open: boolean;
  onClose: () => void;
  examId?: string;
  sectionId?: string;
  targetSections?: { id: string; title: string }[];
  onSuccess?: () => void;
}

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const ALLOWED_EXTENSIONS = [".txt", ".docx", ".doc", ".pdf", ".rtf", ".xlsx", ".csv"];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileTypeInfo(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "pdf":
      return { badge: "PDF", tone: "bg-red-50 text-red-700 border-red-200", icon: FileText };
    case "docx":
      return { badge: "DOCX", tone: "bg-blue-50 text-blue-700 border-blue-200", icon: FileText };
    case "doc":
      return { badge: "DOC", tone: "bg-sky-50 text-sky-700 border-sky-200", icon: FileText };
    case "xlsx":
      return { badge: "XLSX", tone: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: FileSpreadsheet };
    case "csv":
      return { badge: "CSV", tone: "bg-teal-50 text-teal-700 border-teal-200", icon: FileSpreadsheet };
    case "rtf":
      return { badge: "RTF", tone: "bg-purple-50 text-purple-700 border-purple-200", icon: FileText };
    default:
      return { badge: "TXT", tone: "bg-sand-100 text-ink-700 border-line", icon: FileText };
  }
}

export function QuestionReviewModal({ open, onClose, examId, sectionId, targetSections = [], onSuccess }: Props) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [rawText, setRawText] = useState("");
  const [mode, setMode] = useState<"DIRECT" | "AI_ASSIST">("DIRECT");
  const [defaultSection, setDefaultSection] = useState(targetSections[0]?.title || "Aptitude Test");
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [syllabusNotice, setSyllabusNotice] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const [questions, setQuestions] = useState<ReviewQuestion[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<ReviewQuestion | null>(null);

  const handleFilesAdded = (newFiles: FileList | File[]) => {
    setParseError(null);
    const added: File[] = [];

    for (let i = 0; i < newFiles.length; i++) {
      const f = newFiles[i];
      const ext = "." + (f.name.split(".").pop()?.toLowerCase() || "");

      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        toast(`'${f.name}' is not supported. Allowed formats: .txt, .docx, .doc, .pdf, .rtf, .xlsx, .csv`, "bad");
        continue;
      }

      if (f.size > MAX_FILE_SIZE) {
        toast(`'${f.name}' exceeds the 25 MB file size limit.`, "bad");
        continue;
      }

      // Avoid exact duplicate files in the list
      if (!files.some((existing) => existing.name === f.name && existing.size === f.size)) {
        added.push(f);
      }
    }

    if (added.length > 0) {
      setFiles((prev) => [...prev, ...added]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesAdded(e.dataTransfer.files);
    }
  };

  const handleParse = async () => {
    if (files.length === 0 && !rawText.trim()) {
      toast("Please upload at least one document or paste question text", "bad");
      return;
    }

    setParsing(true);
    setParseError(null);
    setSyllabusNotice(null);

    try {
      const formData = new FormData();
      files.forEach((f) => {
        formData.append("files", f);
      });
      if (files.length === 1) {
        formData.append("file", files[0]);
      }

      if (rawText.trim()) {
        formData.append("text", rawText.trim());
      }
      formData.append("defaultSection", defaultSection);
      if (mode === "AI_ASSIST") {
        formData.append("aiAssist", "true");
        formData.append("generateAdditional", "true");
      }
      if (examId) formData.append("examId", examId);

      const res = await api<{
        questions: ReviewQuestion[];
        sectionsDetected: string[];
        totalQuestions: number;
        validQuestions: number;
        invalidQuestions: number;
        generatedCount: number;
        filesProcessed: Array<{ name: string; size: number; type: string; words: number }>;
        isSyllabusOrDistribution?: boolean;
        syllabusNotice?: string;
      }>("/questions-import/parse-document", {
        method: "POST",
        form: formData,
        body: formData,
      });

      if (res.isSyllabusOrDistribution && res.syllabusNotice) {
        setSyllabusNotice(res.syllabusNotice);
      }

      if (res.questions.length === 0) {
        if (res.isSyllabusOrDistribution) {
          toast("Document detected as syllabus/outline. Switch to AI-Assisted Generation mode.", "bad");
          return;
        }
        setParseError("No questions could be extracted. Please check the document format and question numbering.");
        return;
      }

      // Default all valid or AI-generated questions to approved or review
      const formatted = res.questions.map((q) => ({
        ...q,
        approvalStatus: q.sourceType === "AI_GENERATED" || q.status !== "VALID" ? "PENDING_REVIEW" : "APPROVED",
      })) as ReviewQuestion[];

      setQuestions(formatted);

      // Select all valid by default
      const validSet = new Set<number>();
      formatted.forEach((q, idx) => {
        if (q.status === "VALID") validSet.add(idx);
      });
      setSelectedIndices(validSet);

      toast(`Successfully parsed ${res.totalQuestions} questions (${res.validQuestions} valid).`);
    } catch (e: any) {
      const errMsg = e.message || "Failed to extract questions from document.";
      setParseError(errMsg);
      toast(errMsg, "bad");
    } finally {
      setParsing(false);
    }
  };

  const handleCommit = async () => {
    const toCommit = questions.filter((_, idx) => selectedIndices.has(idx));
    if (toCommit.length === 0) {
      toast("Please select at least one question to import", "bad");
      return;
    }

    const invalidSelected = toCommit.filter((q) => q.status !== "VALID" && q.approvalStatus !== "APPROVED");
    if (invalidSelected.length > 0) {
      toast(
        `Cannot import ${invalidSelected.length} question(s) with validation errors. Review and resolve them first.`,
        "bad"
      );
      return;
    }

    setCommitting(true);
    try {
      await api("/questions-import/commit", {
        method: "POST",
        body: {
          examId,
          sectionId,
          questions: toCommit.map((q) => ({
            sectionTitle: q.sectionTitle,
            text: q.text,
            type: q.type,
            options: q.options,
            correctAnswers: q.correctAnswers,
            explanation: q.explanation,
            marks: q.marks,
            negativeMarks: q.negativeMarks,
            difficulty: q.difficulty,
            sourceType: q.sourceType,
            approvalStatus: q.approvalStatus || "APPROVED",
          })),
        },
      });

      toast(`Imported ${toCommit.length} question(s) successfully!`);
      if (onSuccess) onSuccess();
      onClose();
    } catch (e: any) {
      toast(e.message || "Failed to commit questions.", "bad");
    } finally {
      setCommitting(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIndices.size === questions.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(questions.map((_, i) => i)));
    }
  };

  const deleteQuestion = (idx: number) => {
    setQuestions((prev) => prev.filter((_, i) => i !== idx));
    const nextSel = new Set<number>();
    selectedIndices.forEach((i) => {
      if (i < idx) nextSel.add(i);
      else if (i > idx) nextSel.add(i - 1);
    });
    setSelectedIndices(nextSel);
  };

  const openEdit = (idx: number) => {
    setEditingIdx(idx);
    setEditForm(JSON.parse(JSON.stringify(questions[idx])));
  };

  const saveEdit = () => {
    if (editingIdx === null || !editForm) return;

    const validKeys = new Set(editForm.options.map((o) => o.key.toUpperCase()));
    const validTexts = new Set(editForm.options.map((o) => o.text.trim().toLowerCase()));
    const matched = editForm.correctAnswers.filter(
      (a) => validKeys.has(a.toUpperCase()) || validTexts.has(a.trim().toLowerCase())
    );

    let status = editForm.status;
    const errors: string[] = [];
    if (editForm.options.length < 2 && editForm.type === "SINGLE") {
      errors.push("At least two options are required.");
      status = "MISSING_OPTIONS";
    } else if (editForm.correctAnswers.length === 0) {
      errors.push("Correct answer is required.");
      status = "MISSING_ANSWER";
    } else if (matched.length === 0 && editForm.type === "SINGLE") {
      errors.push("Answer does not match available options.");
      status = "INVALID_FORMAT";
    } else {
      status = "VALID";
    }

    const updated = {
      ...editForm,
      status,
      validationErrors: errors,
      approvalStatus: "APPROVED" as const,
    };

    setQuestions((prev) => prev.map((q, i) => (i === editingIdx ? updated : q)));
    setEditingIdx(null);
    setEditForm(null);
    toast("Question updated and marked valid.");
  };

  const getStatusBadge = (status: ReviewQuestion["status"], approval?: string) => {
    if (approval === "PENDING_REVIEW") return <Badge tone="warn">Requires Review</Badge>;
    switch (status) {
      case "VALID":
        return <Badge tone="ok">Valid Question</Badge>;
      case "MISSING_ANSWER":
        return <Badge tone="warn">Missing Answer</Badge>;
      case "MISSING_OPTIONS":
        return <Badge tone="warn">Missing Options</Badge>;
      case "DUPLICATE":
        return <Badge tone="warn">Duplicate Question</Badge>;
      case "REQUIRES_REVIEW":
        return <Badge tone="navy">AI-Generated (Review)</Badge>;
      default:
        return <Badge tone="warn">Invalid Format</Badge>;
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Upload Questions & Generate Examination" size="xl">
      <div className="space-y-6">
        {questions.length === 0 ? (
          <div className="space-y-5">
            {/* Syllabus Alert Banner */}
            {syllabusNotice && (
              <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1.5">
                  <div className="font-semibold text-xs">Course Blueprint / Syllabus Detected</div>
                  <p className="text-[11.5px] text-amber-800 leading-relaxed">{syllabusNotice}</p>
                  {mode === "DIRECT" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="mt-1 text-xs bg-amber-600 text-white hover:bg-amber-700 border-none font-medium"
                      onClick={() => {
                        setMode("AI_ASSIST");
                        toast("Switched to AI-Assisted Generation mode. Click 'Extract & Generate Questions' to proceed.");
                      }}
                    >
                      <Sparkles className="h-3.5 w-3.5 mr-1" /> Switch to AI-Assisted Generation
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Parsing Error Banner */}
            {parseError && (
              <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2.5">
                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1">
                  <div className="font-semibold text-xs">Document Extraction Notice</div>
                  <p className="text-[11.5px] text-rose-800 leading-relaxed">{parseError}</p>
                </div>
              </div>
            )}

            {/* Drag & Drop Upload Zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`rounded-xl border-2 border-dashed p-7 text-center cursor-pointer transition-all ${
                isDragging
                  ? "border-navy-900 bg-navy-50/70 scale-[0.99]"
                  : "border-line bg-sand-50/40 hover:bg-sand-50 hover:border-ink-400"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".txt,.docx,.doc,.pdf,.rtf,.xlsx,.csv,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain,application/rtf"
                onChange={(e) => {
                  if (e.target.files) handleFilesAdded(e.target.files);
                  e.target.value = "";
                }}
                className="hidden"
              />

              <div className="flex justify-center mb-2.5">
                <div className="p-3 rounded-full bg-navy-50 text-navy-900">
                  <UploadCloud className="h-7 w-7 text-navy-800" />
                </div>
              </div>

              <p className="text-sm font-semibold text-ink-900 mb-1">
                Upload Question Paper or Study Material
              </p>
              <p className="text-xs text-ink-500 mb-3.5">
                Drag and drop your documents here, or click to browse from your device
              </p>

              {/* Supported Extensions Pills */}
              <div className="flex flex-wrap items-center justify-center gap-1.5 max-w-xl mx-auto">
                <span className="text-[10.5px] text-ink-400 font-medium mr-1">Supported Formats:</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-red-100/70 text-red-800 border border-red-200">
                  .PDF
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-blue-100/70 text-blue-800 border border-blue-200">
                  .DOCX
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-sky-100/70 text-sky-800 border border-sky-200">
                  .DOC
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-100/70 text-emerald-800 border border-emerald-200">
                  .XLSX
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-teal-100/70 text-teal-800 border border-teal-200">
                  .CSV
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-purple-100/70 text-purple-800 border border-purple-200">
                  .RTF
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-sand-200 text-ink-800 border border-sand-300">
                  .TXT
                </span>
                <span className="text-[10.5px] text-ink-400 ml-1">· Max 25 MB per file</span>
              </div>
            </div>

            {/* Uploaded Files List */}
            {files.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-ink-600 font-medium px-1">
                  <span>Selected Documents ({files.length}):</span>
                  <button
                    type="button"
                    onClick={() => setFiles([])}
                    className="text-xs text-rose-600 hover:underline font-normal"
                  >
                    Clear All
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto p-1">
                  {files.map((f, idx) => {
                    const info = getFileTypeInfo(f.name);
                    const FileIcon = info.icon;
                    return (
                      <div
                        key={idx}
                        className="flex items-center justify-between gap-2.5 p-2.5 rounded-lg border border-line bg-surface text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold border ${info.tone}`}
                          >
                            {info.badge}
                          </span>
                          <FileIcon className="h-4 w-4 text-ink-500 shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium text-ink-900 truncate" title={f.name}>
                              {f.name}
                            </p>
                            <p className="text-[10px] text-ink-400 font-mono">{formatFileSize(f.size)}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFile(idx);
                          }}
                          className="p-1 rounded text-ink-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                          title="Remove file"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Direct Text Paste Option */}
            <div className="space-y-2">
              <div className="text-center text-xs text-ink-400 font-medium">— OR PASTE QUESTION TEXT DIRECTLY —</div>
              <Textarea
                placeholder={`APTITUDE ASSESSMENT\n\nQ1. What is 15% of 200?\nA. 20\nB. 25\nC. 30\nD. 35\nCorrect Answer: C\nExplanation: 15% of 200 = 30.\nMarks: 1\nDifficulty: Easy\n\nSECTION: Technical Core\nQ2. Which data structure uses FIFO ordering?\nA. Stack\nB. Queue\nC. Tree\nD. Graph\nCorrect Answer: B\nExplanation: Queue follows First-In, First-Out principle.`}
                rows={6}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                className="font-mono text-xs"
              />
            </div>

            {/* Mode Selection Cards */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-ink-700 block">Extraction & Processing Mode:</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Direct Extraction */}
                <div
                  onClick={() => setMode("DIRECT")}
                  className={`p-3.5 rounded-lg border cursor-pointer transition-all ${
                    mode === "DIRECT"
                      ? "border-navy-900 bg-navy-50/50 shadow-sm ring-1 ring-navy-900"
                      : "border-line bg-surface hover:border-ink-300"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <input
                      type="radio"
                      id="modeDirect"
                      checked={mode === "DIRECT"}
                      onChange={() => setMode("DIRECT")}
                      className="text-navy-900 focus:ring-navy-900 h-4 w-4"
                    />
                    <label htmlFor="modeDirect" className="text-xs font-semibold text-navy-900 flex items-center gap-1.5 cursor-pointer">
                      <FileCheck className="h-3.5 w-3.5 text-navy-800" /> Direct Extraction
                    </label>
                  </div>
                  <p className="text-[11px] text-ink-600 pl-6 leading-relaxed">
                    Extract existing questions, MCQ options, and answer keys without modifying wording or answers.
                  </p>
                </div>

                {/* AI-Assisted Generation */}
                <div
                  onClick={() => setMode("AI_ASSIST")}
                  className={`p-3.5 rounded-lg border cursor-pointer transition-all ${
                    mode === "AI_ASSIST"
                      ? "border-amber-600 bg-amber-50/50 shadow-sm ring-1 ring-amber-600"
                      : "border-line bg-surface hover:border-ink-300"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <input
                      type="radio"
                      id="modeAi"
                      checked={mode === "AI_ASSIST"}
                      onChange={() => setMode("AI_ASSIST")}
                      className="text-amber-600 focus:ring-amber-600 h-4 w-4"
                    />
                    <label htmlFor="modeAi" className="text-xs font-semibold text-amber-900 flex items-center gap-1.5 cursor-pointer">
                      <Sparkles className="h-3.5 w-3.5 text-amber-500" /> AI-Assisted Generation
                    </label>
                  </div>
                  <p className="text-[11px] text-ink-600 pl-6 leading-relaxed">
                    Generate comprehensive assessment questions from uploaded syllabus, blueprints, or study notes.
                  </p>
                </div>
              </div>
            </div>

            {/* Configuration Row: Default Section */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-lg bg-sand-50/70 border border-line">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-ink-700">Assign to Section:</span>
                {targetSections.length > 0 ? (
                  <Select
                    className="w-48 text-xs"
                    value={defaultSection}
                    onChange={(e) => setDefaultSection(e.target.value)}
                  >
                    {targetSections.map((sec) => (
                      <option key={sec.id} value={sec.title}>
                        {sec.title}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    className="w-48 text-xs"
                    value={defaultSection}
                    onChange={(e) => setDefaultSection(e.target.value)}
                    placeholder="Section title (e.g. Aptitude Test)"
                  />
                )}
              </div>
              <span className="text-[11px] text-ink-500">
                Section headings in uploaded documents will automatically override this default.
              </span>
            </div>

            {/* Action Buttons & Progress */}
            {parsing && (
              <div className="p-3 rounded-lg bg-navy-50 border border-navy-200 text-xs text-navy-900 flex items-center gap-2.5">
                <Loader2 className="h-4 w-4 animate-spin text-navy-900 shrink-0" />
                <span>
                  Extracting content and parsing questions from {files.length || 1} source(s)... Please wait.
                </span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-line">
              <Button variant="ghost" onClick={onClose} disabled={parsing}>
                Cancel
              </Button>
              <Button loading={parsing} onClick={handleParse}>
                {mode === "AI_ASSIST" ? "Extract & Generate Questions" : "Extract & Review Questions"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Header toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-surface rounded-lg border border-line text-xs">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedIndices.size === questions.length && questions.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-line text-navy-900 h-4 w-4"
                  />
                  <span>
                    Select All ({selectedIndices.size}/{questions.length})
                  </span>
                </label>
                <span className="text-ink-300">|</span>
                <span className="text-ink-600">
                  Valid: <strong className="text-emerald-700">{questions.filter((q) => q.status === "VALID").length}</strong> · Invalid/Review:{" "}
                  <strong className="text-amber-700">{questions.filter((q) => q.status !== "VALID").length}</strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setQuestions([]);
                    setSyllabusNotice(null);
                    setParseError(null);
                  }}
                >
                  Reset & Upload Another
                </Button>
                <Button size="sm" loading={committing} onClick={handleCommit}>
                  Commit Selected ({selectedIndices.size})
                </Button>
              </div>
            </div>

            {/* Questions list */}
            <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-1">
              {questions.map((q, idx) => (
                <div
                  key={idx}
                  className={`rounded-lg border p-4 transition-colors ${
                    selectedIndices.has(idx) ? "border-navy-900/40 bg-white" : "border-line bg-sand-50/40 opacity-75"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={selectedIndices.has(idx)}
                        onChange={() => {
                          const next = new Set(selectedIndices);
                          if (next.has(idx)) next.delete(idx);
                          else next.add(idx);
                          setSelectedIndices(next);
                        }}
                        className="rounded border-line text-navy-900 h-4 w-4 mt-0.5"
                      />
                      <span className="font-semibold text-xs text-navy-900">
                        {q.sectionTitle} · Q{idx + 1}
                      </span>
                      {getStatusBadge(q.status, q.approvalStatus)}
                      {q.sourceType === "AI_GENERATED" && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                          <Sparkles className="h-3 w-3" /> AI
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-ink-500 font-mono text-[11px]">{q.marks}M</span>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(idx)} title="Edit Question">
                        <Edit3 className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteQuestion(idx)} title="Delete">
                        <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                      </Button>
                    </div>
                  </div>

                  <p className="text-xs text-ink-900 font-medium mb-3 whitespace-pre-wrap">{q.text}</p>

                  {/* Options */}
                  {q.options.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2 text-xs">
                      {q.options.map((opt, oi) => {
                        const isCorrect = q.correctAnswers.some(
                          (ans) =>
                            ans.trim().toUpperCase() === opt.key.trim().toUpperCase() ||
                            ans.trim().toLowerCase() === opt.text.trim().toLowerCase()
                        );
                        return (
                          <div
                            key={oi}
                            className={`p-2 rounded border flex items-center gap-2 ${
                              isCorrect
                                ? "bg-emerald-50/70 border-emerald-300 text-emerald-950 font-medium"
                                : "bg-surface border-line text-ink-700"
                            }`}
                          >
                            <span className="font-mono font-semibold text-[11px] px-1.5 py-0.5 rounded bg-white/70 border border-line">
                              {opt.key}
                            </span>
                            <span>{opt.text}</span>
                            {isCorrect && <Check className="h-3.5 w-3.5 text-emerald-600 ml-auto shrink-0" />}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Explanation & Validation Errors */}
                  {q.explanation && (
                    <div className="text-[11px] text-ink-600 bg-sand-50 p-2 rounded border border-line mb-2">
                      <strong className="text-ink-800">Explanation:</strong> {q.explanation}
                    </div>
                  )}

                  {q.validationErrors.length > 0 && (
                    <div className="text-[11px] text-rose-700 bg-rose-50 p-2 rounded border border-rose-200 space-y-1">
                      {q.validationErrors.map((err, ei) => (
                        <div key={ei} className="flex items-center gap-1.5">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          <span>{err}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-line">
              <span className="text-xs text-ink-500">{selectedIndices.size} question(s) selected for import</span>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Close
                </Button>
                <Button loading={committing} onClick={handleCommit}>
                  Approve & Import Selected Questions
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Modal */}
        {editForm && (
          <Dialog open={editingIdx !== null} onClose={() => setEditingIdx(null)} title="Edit Question Details" size="lg">
            <div className="space-y-4 text-xs">
              <div>
                <label className="font-medium text-ink-700 block mb-1">Section Assignment</label>
                <Input
                  value={editForm.sectionTitle || ""}
                  onChange={(e) => setEditForm({ ...editForm, sectionTitle: e.target.value })}
                  placeholder="Section Title"
                />
              </div>

              <div>
                <label className="font-medium text-ink-700 block mb-1">Question Content</label>
                <Textarea
                  rows={3}
                  value={editForm.text}
                  onChange={(e) => setEditForm({ ...editForm, text: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="font-medium text-ink-700 block mb-1">Marks</label>
                  <Input
                    type="number"
                    value={editForm.marks}
                    onChange={(e) => setEditForm({ ...editForm, marks: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <label className="font-medium text-ink-700 block mb-1">Negative Marks</label>
                  <Input
                    type="number"
                    value={editForm.negativeMarks}
                    onChange={(e) => setEditForm({ ...editForm, negativeMarks: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <label className="font-medium text-ink-700 block mb-1">Difficulty</label>
                  <Select
                    value={editForm.difficulty}
                    onChange={(e) => setEditForm({ ...editForm, difficulty: e.target.value as Difficulty })}
                  >
                    <option value="EASY">Easy</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HARD">Hard</option>
                  </Select>
                </div>
              </div>

              {/* Options & Answers */}
              <div>
                <label className="font-medium text-ink-700 block mb-1">Options</label>
                <div className="space-y-2">
                  {editForm.options.map((opt, oi) => (
                    <div key={oi} className="flex items-center gap-2">
                      <span className="w-8 font-mono text-center font-bold">{opt.key}</span>
                      <Input
                        value={opt.text}
                        onChange={(e) => {
                          const next = [...editForm.options];
                          next[oi].text = e.target.value;
                          setEditForm({ ...editForm, options: next });
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const isSel = editForm.correctAnswers.includes(opt.key);
                          const nextAnswers = isSel
                            ? editForm.correctAnswers.filter((a) => a !== opt.key)
                            : [...editForm.correctAnswers, opt.key];
                          setEditForm({ ...editForm, correctAnswers: nextAnswers });
                        }}
                        className={`px-2 py-1 rounded text-xs border font-medium ${
                          editForm.correctAnswers.includes(opt.key)
                            ? "bg-emerald-600 text-white border-emerald-600"
                            : "bg-surface border-line text-ink-600"
                        }`}
                      >
                        {editForm.correctAnswers.includes(opt.key) ? "Correct" : "Mark Correct"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="font-medium text-ink-700 block mb-1">Explanation</label>
                <Textarea
                  rows={2}
                  value={editForm.explanation || ""}
                  onChange={(e) => setEditForm({ ...editForm, explanation: e.target.value })}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-line">
                <Button variant="ghost" onClick={() => setEditingIdx(null)}>
                  Cancel
                </Button>
                <Button onClick={saveEdit}>Save & Validate</Button>
              </div>
            </div>
          </Dialog>
        )}
      </div>
    </Dialog>
  );
}

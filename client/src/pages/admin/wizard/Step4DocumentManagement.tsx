import { useState, useEffect, useRef } from "react";
import {
  FileText,
  FileSpreadsheet,
  FileUp,
  Sparkles,
  Layers,
  ChevronDown,
  ChevronRight,
  Trash2,
  Edit3,
  RotateCcw,
  HelpCircle,
  Shuffle,
  Eye,
  CheckCircle2,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Input,
  Select,
  Spinner,
  Textarea,
  useToast,
} from "@/components/ui";
import { api } from "@/lib/api";
import type { ExamDocument, Question, Difficulty, QuestionType } from "@/lib/types";

interface Props {
  examId?: string;
  selectedSectionIds: string[];
  sectionsConfig?: Record<string, { title: string; durationMinutes: number; totalMarks: number; passingMarks: number }>;
  onStageUpdated?: () => void;
}

const STAGE_OPTIONS = [
  { value: "aptitude", label: "Aptitude Test" },
  { value: "logical_reasoning", label: "Logical Reasoning" },
  { value: "custom", label: "Custom Assessment" },
  { value: "verbal", label: "Verbal Ability" },
  { value: "coding", label: "Practical Coding Test" },
];

function getFileIcon(type: string) {
  if (type === "xlsx" || type === "csv") {
    return <FileSpreadsheet className="h-4 w-4 text-emerald-600" />;
  }
  if (type === "pdf") {
    return <FileText className="h-4 w-4 text-red-600" />;
  }
  return <FileText className="h-4 w-4 text-navy-800" />;
}

export function Step4DocumentManagement({
  examId,
  selectedSectionIds,
  onStageUpdated,
}: Props) {
  const toast = useToast();

  const [documents, setDocuments] = useState<ExamDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<ExamDocument | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // Upload modal state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadStageId, setUploadStageId] = useState<string>("");
  const [isAiAssist, setIsAiAssist] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Paper Generation modal state
  const [paperGenDoc, setPaperGenDoc] = useState<ExamDocument | null>(null);
  const [targetStageId, setTargetStageId] = useState<string>("");
  const [selectedSectionIdsToInclude, setSelectedSectionIdsToInclude] = useState<Set<string>>(new Set());
  const [questionsPerSection, setQuestionsPerSection] = useState<string>("");
  const [marksOverride, setMarksOverride] = useState<string>("");
  const [randomizeOrder, setRandomizeOrder] = useState(false);
  const [generatingPaper, setGeneratingPaper] = useState(false);

  // Edit Question modal state
  const [editQuestion, setEditQuestion] = useState<Question | null>(null);
  const [editForm, setEditForm] = useState<{
    text: string;
    type: QuestionType;
    difficulty: Difficulty;
    marks: number;
    explanation: string;
    options: Array<{ text: string; isCorrect: boolean }>;
  } | null>(null);
  const [savingQuestion, setSavingQuestion] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<
    | { type: "doc"; id: string; name: string }
    | { type: "question"; docId: string; qId: string }
    | null
  >(null);
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const docs = await api<ExamDocument[]>("/documents");
      setDocuments(docs);
      if (docs.length > 0 && !selectedDocId) {
        setSelectedDocId(docs[0].id);
      }
    } catch (e: any) {
      toast(e.message || "Failed to load documents", "bad");
    } finally {
      setLoading(false);
    }
  };

  const fetchDocumentDetails = async (id: string) => {
    try {
      const doc = await api<ExamDocument>(`/documents/${id}`);
      setSelectedDoc(doc);
      // Automatically expand the first section
      if (doc.sections && doc.sections.length > 0) {
        setExpandedSections(new Set([doc.sections[0].id]));
      }
    } catch (e: any) {
      toast(e.message || "Failed to load document details", "bad");
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  useEffect(() => {
    if (selectedDocId) {
      fetchDocumentDetails(selectedDocId);
    } else {
      setSelectedDoc(null);
    }
  }, [selectedDocId]);

  const toggleSectionExpand = (secId: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(secId)) next.delete(secId);
      else next.add(secId);
      return next;
    });
  };

  // Upload handler
  const handleUploadSubmit = async () => {
    if (uploadFiles.length === 0) {
      toast("Please select at least one document to upload", "bad");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      uploadFiles.forEach((f) => formData.append("files", f));
      if (uploadStageId) formData.append("assignedStageId", uploadStageId);
      if (examId) formData.append("examId", examId);
      if (isAiAssist) formData.append("aiAssist", "true");

      const res = await api<{ success: boolean; count: number; documents: ExamDocument[] }>("/documents/upload", {
        method: "POST",
        body: formData,
      });

      toast(`Successfully uploaded & parsed ${res.count} document(s).`);
      setUploadOpen(false);
      setUploadFiles([]);
      await fetchDocuments();
      if (res.documents?.[0]?.id) {
        setSelectedDocId(res.documents[0].id);
      }
    } catch (e: any) {
      toast(e.message || "Upload failed", "bad");
    } finally {
      setUploading(false);
    }
  };

  // Reprocess handler
  const handleReprocess = async (docId: string) => {
    setReprocessingId(docId);
    try {
      await api(`/documents/${docId}/reprocess`, { method: "POST" });
      toast("Document successfully reprocessed.");
      await fetchDocuments();
      if (selectedDocId === docId) {
        await fetchDocumentDetails(docId);
      }
    } catch (e: any) {
      toast(e.message || "Failed to reprocess document", "bad");
    } finally {
      setReprocessingId(null);
    }
  };

  // Delete handler
  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;

    try {
      if (deleteTarget.type === "doc") {
        await api(`/documents/${deleteTarget.id}`, { method: "DELETE" });
        toast("Document deleted successfully.");
        if (selectedDocId === deleteTarget.id) {
          setSelectedDocId(null);
        }
        await fetchDocuments();
      } else if (deleteTarget.type === "question") {
        await api(`/documents/${deleteTarget.docId}/questions/${deleteTarget.qId}`, { method: "DELETE" });
        toast("Question deleted successfully.");
        await fetchDocumentDetails(deleteTarget.docId);
        await fetchDocuments();
      }
    } catch (e: any) {
      toast(e.message || "Delete failed", "bad");
    } finally {
      setDeleteTarget(null);
    }
  };

  // Edit question opener
  const openEditQuestion = (q: Question) => {
    setEditQuestion(q);
    setEditForm({
      text: q.text,
      type: q.type,
      difficulty: q.difficulty,
      marks: q.marks,
      explanation: q.explanation || "",
      options: q.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect })),
    });
  };

  // Save question handler
  const handleSaveQuestion = async () => {
    if (!editQuestion || !editForm || !selectedDocId) return;

    setSavingQuestion(true);
    try {
      await api(`/documents/${selectedDocId}/questions/${editQuestion.id}`, {
        method: "PATCH",
        body: editForm,
      });
      toast("Question updated successfully.");
      setEditQuestion(null);
      await fetchDocumentDetails(selectedDocId);
    } catch (e: any) {
      toast(e.message || "Failed to save question", "bad");
    } finally {
      setSavingQuestion(false);
    }
  };

  // Open Paper Generation Modal
  const openPaperGen = (doc: ExamDocument) => {
    setPaperGenDoc(doc);
    setTargetStageId(doc.assignedStageId || selectedSectionIds[0] || "aptitude");
    // Select all sections of this document by default
    const allSecIds = new Set(doc.sections?.map((s) => s.id) || []);
    setSelectedSectionIdsToInclude(allSecIds);
    setQuestionsPerSection("");
    setMarksOverride("");
    setRandomizeOrder(false);
  };

  // Generate Paper Submit
  const handleGeneratePaperSubmit = async () => {
    if (!paperGenDoc || !examId) {
      toast("Please ensure the examination is initialized before generating stages.", "bad");
      return;
    }

    if (selectedSectionIdsToInclude.size === 0) {
      toast("Please select at least one section from this document.", "bad");
      return;
    }

    setGeneratingPaper(true);
    try {
      await api("/documents/generate-paper", {
        method: "POST",
        body: {
          examId,
          documentId: paperGenDoc.id,
          stageId: targetStageId,
          selectedSectionIds: Array.from(selectedSectionIdsToInclude),
          questionsPerSection: questionsPerSection ? parseInt(questionsPerSection, 10) : undefined,
          marksOverride: marksOverride ? parseFloat(marksOverride) : undefined,
          randomize: randomizeOrder,
        },
      });

      toast(`Successfully generated examination stage from '${paperGenDoc.documentName}'.`);
      setPaperGenDoc(null);
      await fetchDocuments();
      if (onStageUpdated) onStageUpdated();
    } catch (e: any) {
      toast(e.message || "Failed to generate examination paper", "bad");
    } finally {
      setGeneratingPaper(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Step 4 Banner */}
      <div className="p-4 bg-navy-900 text-white rounded-lg flex flex-wrap items-center justify-between gap-4">
        <div>
          <h4 className="font-semibold text-sm mb-1 flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-amber-400" /> Independent Question Papers & Section Management
          </h4>
          <p className="text-xs text-white/80 max-w-2xl leading-relaxed">
            Every uploaded document (.docx, .doc, .pdf, .rtf, .xlsx, .csv, .txt) is preserved as an independent question paper with its own sections, questions, and marks. Never merged across documents.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => setUploadOpen(true)}
          className="bg-white text-navy-900 hover:bg-sand-100 font-semibold"
        >
          <FileUp className="h-4 w-4" /> Upload Question Paper
        </Button>
      </div>

      {/* A. Uploaded Documents View */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-xs text-ink-700 uppercase tracking-wider flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-navy-800" /> Uploaded Documents ({documents.length})
          </h4>
          <span className="text-[11px] text-ink-500">
            Select a document to inspect sections, edit questions, or assign to an examination stage.
          </span>
        </div>

        {loading ? (
          <div className="p-8 text-center bg-white rounded-lg border border-line">
            <Spinner className="mx-auto" />
            <p className="text-xs text-ink-500 mt-2">Loading question documents...</p>
          </div>
        ) : documents.length === 0 ? (
          <EmptyState
            icon={<FileUp className="h-8 w-8 text-navy-800" />}
            title="No question papers uploaded yet"
            body="Upload Word (.docx), PDF, Excel, or text files to create independent question papers with structured sections."
            action={
              <Button size="sm" onClick={() => setUploadOpen(true)}>
                <FileUp className="h-4 w-4" /> Upload First Paper
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {documents.map((doc) => {
              const isSelected = selectedDocId === doc.id;
              const isReprocessing = reprocessingId === doc.id;

              return (
                <div
                  key={doc.id}
                  onClick={() => setSelectedDocId(doc.id)}
                  className={`p-3.5 rounded-lg border transition-all cursor-pointer relative flex flex-col justify-between ${
                    isSelected
                      ? "border-navy-900 bg-navy-50/40 shadow-xs"
                      : "border-line bg-white hover:border-navy-400"
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        {getFileIcon(doc.fileType)}
                        <span className="font-bold text-xs text-navy-900 line-clamp-1" title={doc.documentName}>
                          {doc.documentName}
                        </span>
                      </div>
                      <Badge tone={doc.processingStatus === "ASSIGNED" ? "ok" : "navy"}>
                        {doc.processingStatus}
                      </Badge>
                    </div>

                    <p className="text-[11px] text-ink-500 truncate mb-2" title={doc.originalFileName}>
                      File: {doc.originalFileName}
                    </p>

                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-600 mb-3">
                      <span className="inline-flex items-center gap-1 bg-surface px-1.5 py-0.5 rounded border border-line">
                        <Layers className="h-3 w-3 text-steel-600" /> {doc.totalSections} section(s)
                      </span>
                      <span className="inline-flex items-center gap-1 bg-surface px-1.5 py-0.5 rounded border border-line">
                        <HelpCircle className="h-3 w-3 text-steel-600" /> {doc.totalQuestions} questions
                      </span>
                      {doc.assignedStageId && (
                        <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded border border-amber-200 font-medium">
                          Stage: {doc.assignedStageId}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="pt-2 border-t border-line/60 flex items-center justify-between gap-1 text-[11px]">
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant={isSelected ? "primary" : "secondary"}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedDocId(doc.id);
                        }}
                      >
                        <Eye className="h-3 w-3" /> Inspect
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          openPaperGen(doc);
                        }}
                        title="Configure and generate exam stage from this document"
                      >
                        <Shuffle className="h-3 w-3" /> Assign
                      </Button>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isReprocessing}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReprocess(doc.id);
                        }}
                        title="Reprocess this document from stored content"
                      >
                        {isReprocessing ? <Spinner className="h-3 w-3" /> : <RotateCcw className="h-3 w-3" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget({ type: "doc", id: doc.id, name: doc.documentName });
                        }}
                        title="Delete this document and its sections"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* B. Section Preview & Question Management */}
      {selectedDoc && (
        <Card
          title={
            <div className="flex items-center justify-between w-full">
              <span className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-navy-800" />
                <span>{selectedDoc.documentName}</span>
                <span className="text-xs font-normal text-ink-500">
                  ({selectedDoc.sections?.length || 0} sections · {selectedDoc.totalQuestions} questions)
                </span>
              </span>
              <Button size="sm" variant="secondary" onClick={() => openPaperGen(selectedDoc)}>
                <Shuffle className="h-3.5 w-3.5" /> Generate Exam Stage from Document
              </Button>
            </div>
          }
          subtitle="Sections and questions are isolated strictly to this document. Edit or remove questions without altering other documents."
        >
          <div className="space-y-4">
            {selectedDoc.sections?.map((sec, secIdx) => {
              const isExpanded = expandedSections.has(sec.id);
              return (
                <div key={sec.id} className="border border-line rounded-lg overflow-hidden bg-white">
                  {/* Section Accordion Header */}
                  <div
                    onClick={() => toggleSectionExpand(sec.id)}
                    className="p-3 bg-surface hover:bg-sand-50 transition-colors cursor-pointer flex items-center justify-between gap-3 select-none"
                  >
                    <div className="flex items-center gap-2.5">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-ink-500" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-ink-500" />
                      )}
                      <div>
                        <span className="font-bold text-xs text-navy-900">
                          {secIdx + 1}. {sec.sectionTitle}
                        </span>
                        <div className="text-[11px] text-ink-500 flex items-center gap-2 mt-0.5">
                          <span>{sec.questions?.length || sec.totalQuestions} questions</span>
                          <span>·</span>
                          <span>{sec.totalMarks} marks total</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                      <Badge tone="steel">Section {secIdx + 1}</Badge>
                    </div>
                  </div>

                  {/* Section Questions Body */}
                  {isExpanded && (
                    <div className="p-3 divide-y divide-line/60 space-y-3">
                      {sec.questions && sec.questions.length > 0 ? (
                        sec.questions.map((q, qIdx) => (
                          <div key={q.id} className="pt-3 first:pt-0">
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-2 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-xs font-bold text-navy-900 bg-sand-100 px-1.5 py-0.5 rounded">
                                    Q{qIdx + 1}
                                  </span>
                                  <Badge tone="navy">{q.type}</Badge>
                                  <Badge tone={q.difficulty === "EASY" ? "ok" : q.difficulty === "HARD" ? "warn" : "steel"}>
                                    {q.difficulty}
                                  </Badge>
                                  <span className="text-[11px] text-ink-500 font-mono">
                                    {q.marks} mark{q.marks !== 1 ? "s" : ""}
                                    {q.negativeMarks > 0 && ` (-${q.negativeMarks})`}
                                  </span>
                                  <Badge tone={q.sourceType === "AI_GENERATED" ? "warn" : "ok"}>
                                    {q.sourceType === "AI_GENERATED" ? "AI Generated" : "Extracted"}
                                  </Badge>
                                </div>

                                {/* Question Text (Preserving Markdown & Tables) */}
                                <div className="text-xs text-ink-900 whitespace-pre-wrap font-sans font-medium leading-relaxed bg-surface/50 p-2.5 rounded border border-line/40">
                                  {q.text}
                                </div>

                                {/* Options if MCQ */}
                                {q.options && q.options.length > 0 && (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                                    {q.options.map((opt, oIdx) => (
                                      <div
                                        key={opt.id || oIdx}
                                        className={`p-2 rounded text-[11px] border flex items-center justify-between gap-2 ${
                                          opt.isCorrect
                                            ? "border-emerald-300 bg-emerald-50/70 text-emerald-900 font-semibold"
                                            : "border-line bg-white text-ink-700"
                                        }`}
                                      >
                                        <div className="flex items-center gap-1.5">
                                          <span className="font-mono font-bold text-ink-500">
                                            {String.fromCharCode(65 + oIdx)}.
                                          </span>
                                          <span>{opt.text}</span>
                                        </div>
                                        {opt.isCorrect && (
                                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Explanation */}
                                {q.explanation && (
                                  <div className="text-[11px] text-ink-600 bg-sand-50 p-2 rounded border border-line">
                                    <span className="font-semibold text-navy-900">Explanation: </span>
                                    {q.explanation}
                                  </div>
                                )}
                              </div>

                              {/* Question Action Buttons */}
                              <div className="flex items-center gap-1 shrink-0 pt-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => openEditQuestion(q)}
                                  title="Edit question text, options or marks"
                                >
                                  <Edit3 className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                  onClick={() => setDeleteTarget({ type: "question", docId: selectedDoc.id, qId: q.id })}
                                  title="Delete question from this document"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-ink-500 py-3 text-center">No questions found in this section.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* C. Dialog: Multi-Document Upload */}
      <Dialog
        open={uploadOpen}
        onClose={() => {
          if (!uploading) setUploadOpen(false);
        }}
        title="Upload Independent Question Papers"
        size="lg"
      >
        <div className="space-y-4 text-xs">
          <p className="text-ink-600">
            Upload one or multiple examination papers (.docx, .doc, .pdf, .rtf, .xlsx, .csv, .txt). Each document is stored separately without overwriting or merging with previous uploads.
          </p>

          {/* Drag & Drop Area */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="p-6 border-2 border-dashed border-line rounded-lg text-center cursor-pointer hover:border-navy-900 transition-colors bg-sand-50/50"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".docx,.doc,.pdf,.rtf,.xlsx,.csv,.txt"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) {
                  setUploadFiles(Array.from(e.target.files));
                }
              }}
            />
            <FileUp className="h-8 w-8 text-navy-900 mx-auto mb-2" />
            <p className="font-semibold text-navy-900">Click to choose question papers</p>
            <p className="text-[11px] text-ink-500 mt-1">Supports DOCX, PDF, Excel, CSV, RTF, TXT</p>
          </div>

          {/* Selected Files List */}
          {uploadFiles.length > 0 && (
            <div className="space-y-1.5 max-h-36 overflow-y-auto border border-line p-2 rounded bg-white">
              <span className="font-semibold text-[11px] text-ink-700 block">
                Selected Files ({uploadFiles.length}):
              </span>
              {uploadFiles.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-[11px] py-1 border-b last:border-0 border-line/60">
                  <span className="truncate max-w-xs">{f.name}</span>
                  <span className="font-mono text-ink-500">{(f.size / 1024).toFixed(1)} KB</span>
                </div>
              ))}
            </div>
          )}

          {/* Optional Stage Target */}
          <div>
            <label className="font-semibold text-navy-900 block mb-1">
              Associate with Examination Stage (Optional)
            </label>
            <Select
              value={uploadStageId}
              onChange={(e) => setUploadStageId(e.target.value)}
            >
              <option value="">Unassigned (Central Question Paper)</option>
              {STAGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>

          {/* AI Generation Checkbox */}
          <div className="p-3 bg-surface rounded border border-line flex items-start gap-2.5">
            <input
              type="checkbox"
              id="aiAssistCheck"
              checked={isAiAssist}
              onChange={(e) => setIsAiAssist(e.target.checked)}
              className="rounded border-line text-navy-900 h-4 w-4 mt-0.5"
            />
            <label htmlFor="aiAssistCheck" className="cursor-pointer">
              <span className="font-semibold text-navy-900 block">AI-Assisted Question Generation</span>
              <span className="text-[11px] text-ink-500">
                Leave unchecked to preserve and extract the exact questions from the document. Check only if you wish to generate additional AI questions from syllabus/study material.
              </span>
            </label>
          </div>

          {/* Footer Actions */}
          <div className="flex justify-end gap-2 pt-3 border-t border-line">
            <Button variant="ghost" disabled={uploading} onClick={() => setUploadOpen(false)}>
              Cancel
            </Button>
            <Button disabled={uploading || uploadFiles.length === 0} onClick={handleUploadSubmit}>
              {uploading ? (
                <>
                  <Spinner className="h-4 w-4" /> Parsing Documents...
                </>
              ) : (
                <>
                  <FileUp className="h-4 w-4" /> Process {uploadFiles.length} Paper(s)
                </>
              )}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* D. Dialog: Document-Wise Examination Paper Generator */}
      {paperGenDoc && (
        <Dialog
          open={!!paperGenDoc}
          onClose={() => {
            if (!generatingPaper) setPaperGenDoc(null);
          }}
          title={`Generate Examination Stage from '${paperGenDoc.documentName}'`}
          size="lg"
        >
          <div className="space-y-4 text-xs">
            <p className="text-ink-600 leading-relaxed">
              Configure which sections and questions to include from this paper. Questions from other documents will never be included.
            </p>

            {/* Target Stage */}
            <div>
              <label className="font-semibold text-navy-900 block mb-1">
                Target Examination Stage
              </label>
              <Select
                value={targetStageId}
                onChange={(e) => setTargetStageId(e.target.value)}
              >
                {STAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>

            {/* Select Sections */}
            <div>
              <label className="font-semibold text-navy-900 block mb-1.5">
                Select Sections to Include from this Document
              </label>
              <div className="space-y-1.5 max-h-48 overflow-y-auto border border-line p-2.5 rounded bg-surface">
                {paperGenDoc.sections?.map((sec) => {
                  const checked = selectedSectionIdsToInclude.has(sec.id);
                  return (
                    <label
                      key={sec.id}
                      className="flex items-center justify-between p-2 rounded bg-white border border-line cursor-pointer hover:bg-sand-50"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set(selectedSectionIdsToInclude);
                            if (e.target.checked) next.add(sec.id);
                            else next.delete(sec.id);
                            setSelectedSectionIdsToInclude(next);
                          }}
                          className="rounded border-line text-navy-900 h-4 w-4"
                        />
                        <span className="font-semibold text-navy-900">{sec.sectionTitle}</span>
                      </div>
                      <span className="text-[11px] text-ink-500 font-mono">
                        {sec.totalQuestions} questions ({sec.totalMarks} marks)
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Parameters Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-semibold text-navy-900 block mb-1">
                  Questions per Section (Optional)
                </label>
                <Input
                  type="number"
                  placeholder="All available"
                  value={questionsPerSection}
                  onChange={(e) => setQuestionsPerSection(e.target.value)}
                />
              </div>
              <div>
                <label className="font-semibold text-navy-900 block mb-1">
                  Marks per Question Override
                </label>
                <Input
                  type="number"
                  placeholder="Keep original"
                  value={marksOverride}
                  onChange={(e) => setMarksOverride(e.target.value)}
                />
              </div>
            </div>

            {/* Randomize order */}
            <label className="flex items-center gap-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={randomizeOrder}
                onChange={(e) => setRandomizeOrder(e.target.checked)}
                className="rounded border-line text-navy-900 h-4 w-4"
              />
              <span className="font-medium text-navy-900 flex items-center gap-1.5">
                <Shuffle className="h-3.5 w-3.5 text-steel-600" /> Randomize question sequence
              </span>
            </label>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-3 border-t border-line">
              <Button variant="ghost" disabled={generatingPaper} onClick={() => setPaperGenDoc(null)}>
                Cancel
              </Button>
              <Button disabled={generatingPaper || selectedSectionIdsToInclude.size === 0} onClick={handleGeneratePaperSubmit}>
                {generatingPaper ? (
                  <>
                    <Spinner className="h-4 w-4" /> Generating Paper...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" /> Generate Stage Paper
                  </>
                )}
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* E. Dialog: Edit Question */}
      {editQuestion && editForm && (
        <Dialog
          open={!!editQuestion}
          onClose={() => {
            if (!savingQuestion) setEditQuestion(null);
          }}
          title="Edit Question"
          size="lg"
        >
          <div className="space-y-4 text-xs">
            <div>
              <label className="font-semibold text-navy-900 block mb-1">Question Statement</label>
              <Textarea
                rows={4}
                value={editForm.text}
                onChange={(e) => setEditForm({ ...editForm, text: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="font-semibold text-navy-900 block mb-1">Type</label>
                <Select
                  value={editForm.type}
                  onChange={(e) => setEditForm({ ...editForm, type: e.target.value as QuestionType })}
                >
                  <option value="SINGLE">Single MCQ</option>
                  <option value="MULTIPLE">Multiple MCQ</option>
                  <option value="TRUE_FALSE">True / False</option>
                  <option value="NUMERICAL">Numerical</option>
                  <option value="SHORT">Short Answer</option>
                  <option value="DESCRIPTIVE">Descriptive</option>
                  <option value="CODING">Coding</option>
                  <option value="PROMPT">Prompt Engineering</option>
                </Select>
              </div>

              <div>
                <label className="font-semibold text-navy-900 block mb-1">Difficulty</label>
                <Select
                  value={editForm.difficulty}
                  onChange={(e) => setEditForm({ ...editForm, difficulty: e.target.value as Difficulty })}
                >
                  <option value="EASY">Easy</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HARD">Hard</option>
                </Select>
              </div>

              <div>
                <label className="font-semibold text-navy-900 block mb-1">Marks</label>
                <Input
                  type="number"
                  value={editForm.marks}
                  onChange={(e) => setEditForm({ ...editForm, marks: parseFloat(e.target.value) || 1 })}
                />
              </div>
            </div>

            {/* Options editor if MCQ */}
            {editForm.options.length > 0 && (
              <div className="space-y-2">
                <span className="font-semibold text-navy-900 block">MCQ Options</span>
                {editForm.options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="font-mono font-bold text-ink-500 w-5">
                      {String.fromCharCode(65 + i)}.
                    </span>
                    <Input
                      value={opt.text}
                      onChange={(e) => {
                        const next = [...editForm.options];
                        next[i].text = e.target.value;
                        setEditForm({ ...editForm, options: next });
                      }}
                      className="flex-1"
                    />
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type={editForm.type === "MULTIPLE" ? "checkbox" : "radio"}
                        name="correctAnswerOption"
                        checked={opt.isCorrect}
                        onChange={(e) => {
                          const next = editForm.options.map((o, idx) => {
                            if (editForm.type === "MULTIPLE") {
                              return idx === i ? { ...o, isCorrect: e.target.checked } : o;
                            }
                            return { ...o, isCorrect: idx === i };
                          });
                          setEditForm({ ...editForm, options: next });
                        }}
                        className="rounded border-line text-navy-900"
                      />
                      <span className="text-[11px] text-ink-700">Correct</span>
                    </label>
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className="font-semibold text-navy-900 block mb-1">Explanation</label>
              <Textarea
                rows={2}
                value={editForm.explanation}
                onChange={(e) => setEditForm({ ...editForm, explanation: e.target.value })}
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-line">
              <Button variant="ghost" disabled={savingQuestion} onClick={() => setEditQuestion(null)}>
                Cancel
              </Button>
              <Button disabled={savingQuestion} onClick={handleSaveQuestion}>
                {savingQuestion ? <Spinner className="h-4 w-4" /> : "Save Changes"}
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* F. Delete Confirmation Dialog */}
      {deleteTarget && (
        <Dialog
          open={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          title={deleteTarget.type === "doc" ? "Delete Question Document?" : "Delete Question?"}
          size="sm"
        >
          <div className="space-y-4 text-xs">
            <p className="text-ink-600">
              {deleteTarget.type === "doc"
                ? `Are you sure you want to permanently delete '${deleteTarget.name}'? All extracted sections and questions belonging to this paper will be removed. Other documents will remain untouched.`
                : "Are you sure you want to delete this question? Other questions in this document and other papers will remain unchanged."}
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-line">
              <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={handleDeleteConfirm}>
                Confirm Delete
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

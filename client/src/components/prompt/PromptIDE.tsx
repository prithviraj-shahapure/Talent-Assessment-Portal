import { useState, useEffect, useMemo } from "react";
import {
  Sparkles,
  Play,
  Lock,
  Terminal,
  FileCode,
  ShieldAlert,
} from "lucide-react";
import { Badge, Button, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

interface PromptAttemptItem {
  attemptNumber: number;
  prompt: string;
  response: string | null;
  submittedAt: string;
}

interface SavedPromptPayload {
  attempts: PromptAttemptItem[];
  currentAttempt: number;
  locked?: boolean;
}

interface PromptIDEProps {
  questionId: string;
  attemptId?: string;
  questionText: string;
  maxMarks: number;
  promptMeta?: {
    title?: string;
    scenario?: string;
    requirements?: string[];
    expectedOutput?: string;
    criteria?: { name: string; marks: number }[];
    maxAttempts?: number;
  } | null;
  textAnswer?: string | null;
  onChange: (patch: { textAnswer: string }) => void;
}

export default function PromptIDE({
  questionId,
  attemptId,
  questionText,
  maxMarks,
  promptMeta,
  textAnswer,
  onChange,
}: PromptIDEProps) {
  const toast = useToast();

  // Parse initial state from answer payload
  const initialData = useMemo<SavedPromptPayload>(() => {
    if (textAnswer && textAnswer.trim()) {
      try {
        const parsed = JSON.parse(textAnswer);
        if (parsed && typeof parsed === "object") {
          return {
            attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [],
            currentAttempt: parsed.currentAttempt || (parsed.attempts?.length ? parsed.attempts.length : 1),
            locked: !!parsed.locked,
          };
        }
      } catch {
        // legacy string
      }
    }
    return {
      attempts: [],
      currentAttempt: 1,
      locked: false,
    };
  }, [questionId, textAnswer]);

  const [attempts, setAttempts] = useState<PromptAttemptItem[]>(initialData.attempts);
  const [activeTab, setActiveTab] = useState<number>(initialData.attempts.length ? initialData.attempts.length : 1);
  const [currentPrompt, setCurrentPrompt] = useState<string>("");
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isLocked, setIsLocked] = useState<boolean>(!!initialData.locked);
  const [providerError, setProviderError] = useState<string | null>(null);

  // Initialize prompt for the active tab
  useEffect(() => {
    const existing = attempts.find((a) => a.attemptNumber === activeTab);
    if (existing) {
      setCurrentPrompt(existing.prompt);
    } else if (activeTab === 2 && attempts.length >= 1) {
      // Pre-fill with attempt 1 prompt to allow easy iteration
      setCurrentPrompt(attempts[0].prompt);
    } else {
      setCurrentPrompt("");
    }
  }, [activeTab, attempts]);

  const activeAttempt = attempts.find((a) => a.attemptNumber === activeTab);
  const canAttemptMore = attempts.length < 2 && !isLocked;

  const handleRunPrompt = async () => {
    if (!currentPrompt.trim()) {
      toast("Please write your prompt before executing", "bad");
      return;
    }
    if (!attemptId) {
      toast("Examination attempt not active", "bad");
      return;
    }
    if (attempts.length >= 2) {
      toast("Maximum 2 attempts permitted for this question", "bad");
      return;
    }

    setIsRunning(true);
    setProviderError(null);

    try {
      const res = await api<{
        success: boolean;
        attemptNumber: number;
        aiResponse: string | null;
        error: string | null;
        provider?: string;
      }>("/prompt/run", {
        method: "POST",
        body: {
          attemptId,
          questionId,
          prompt: currentPrompt,
          attemptNumber: attempts.length + 1,
        },
      });

      if (!res.success && res.error) {
        setProviderError(res.error);
        toast(res.error, "bad");
      }

      const newAttemptItem: PromptAttemptItem = {
        attemptNumber: res.attemptNumber,
        prompt: currentPrompt,
        response: res.aiResponse || (res.error ? `[Unavailable: ${res.error}]` : null),
        submittedAt: new Date().toISOString(),
      };

      const updatedAttempts = [...attempts.filter((a) => a.attemptNumber !== res.attemptNumber), newAttemptItem].sort(
        (a, b) => a.attemptNumber - b.attemptNumber
      );

      setAttempts(updatedAttempts);
      setActiveTab(res.attemptNumber);

      const payload: SavedPromptPayload = {
        attempts: updatedAttempts,
        currentAttempt: res.attemptNumber,
        locked: updatedAttempts.length >= 2,
      };

      if (updatedAttempts.length >= 2) {
        setIsLocked(true);
      }

      onChange({ textAnswer: JSON.stringify(payload) });
      toast(`Attempt ${res.attemptNumber} of 2 executed!`);
    } catch (err: any) {
      toast(err.message || "Failed to execute prompt", "bad");
    } finally {
      setIsRunning(false);
    }
  };

  const handleLockQuestion = async () => {
    if (attempts.length === 0) {
      toast("Execute at least one prompt attempt before locking", "bad");
      return;
    }
    if (!window.confirm("Finalize and lock this Prompt Engineering question? No further edits will be allowed.")) {
      return;
    }

    setIsLocked(true);
    const payload: SavedPromptPayload = {
      attempts,
      currentAttempt: attempts.length,
      locked: true,
    };
    onChange({ textAnswer: JSON.stringify(payload) });

    // Trigger evaluation
    if (attemptId) {
      try {
        await api("/prompt/evaluate", {
          method: "POST",
          body: { attemptId, questionId, finalSubmit: true },
        });
      } catch {
        /* evaluation sync in background */
      }
    }

    toast("Question locked successfully", "ok");
  };

  const reqList: string[] = promptMeta?.requirements || [];

  return (
    <div className="space-y-4">
      {/* Header Banner */}
      <div className="rounded-lg border border-navy-900/10 bg-navy-900/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-navy-900 text-white shadow-xs">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-navy-900">
                {promptMeta?.title || "Prompt Engineering Assessment"}
              </h3>
              <p className="text-[12px] text-ink-500">
                Formulate an optimal prompt to solve the technical scenario below. Maximum 2 attempts.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={attempts.length === 0 ? "steel" : attempts.length === 1 ? "warn" : "ok"}>
              Attempt {Math.min(attempts.length + (canAttemptMore ? 1 : 0), 2)} of 2
            </Badge>
            {isLocked && <Badge tone="bad">Locked</Badge>}
            <Badge tone="steel">{maxMarks} Marks</Badge>
          </div>
        </div>
      </div>

      {/* Technical Problem Statement & Scenario Card */}
      <div className="rounded-lg border border-line bg-white p-4 text-xs shadow-xs">
        <div className="flex items-center gap-2 text-ink-700 font-semibold mb-2">
          <Terminal className="h-4 w-4 text-steel-600" />
          <span>Technical Scenario & Objectives</span>
        </div>
        <p className="text-ink-800 text-[13px] leading-relaxed mb-3">
          {promptMeta?.scenario || questionText}
        </p>

        {reqList.length > 0 && (
          <div className="mt-3 rounded border border-line-strong bg-sand-50/50 p-3">
            <span className="block font-semibold text-ink-700 mb-1.5 uppercase tracking-wider text-[11px]">
              Technical Requirements:
            </span>
            <ul className="space-y-1.5">
              {reqList.map((req, idx) => (
                <li key={idx} className="flex items-start gap-2 text-[12.5px] text-ink-700">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-navy-900/10 text-[10px] font-bold text-navy-900">
                    {idx + 1}
                  </span>
                  <span>{req}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {promptMeta?.expectedOutput && (
          <div className="mt-3 rounded border border-steel-200 bg-steel-50/50 p-2.5 text-[12px]">
            <span className="font-semibold text-steel-700 block mb-0.5">Expected Output Format:</span>
            <code className="text-ink-800 font-mono text-[11.5px]">{promptMeta.expectedOutput}</code>
          </div>
        )}
      </div>

      {/* Provider Unavailable Alert (if any) */}
      {providerError && (
        <div className="rounded-lg border border-bad-200 bg-bad-50 p-3 text-xs text-bad-700 flex items-start gap-2.5">
          <ShieldAlert className="h-5 w-5 shrink-0 text-bad-600 mt-0.5" />
          <div>
            <span className="font-semibold block">AI Provider Service Notice</span>
            <span>{providerError}</span>
          </div>
        </div>
      )}

      {/* Attempt Navigation Tabs */}
      <div className="flex items-center justify-between border-b border-line pb-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab(1)}
            className={cn(
              "rounded px-3 py-1.5 text-xs font-semibold transition-all",
              activeTab === 1
                ? "bg-navy-900 text-white shadow-xs"
                : "bg-sand-100 text-ink-600 hover:bg-sand-200"
            )}
          >
            Attempt 1 {attempts.find((a) => a.attemptNumber === 1) && "✓"}
          </button>

          {(attempts.length >= 1 || activeTab === 2) && (
            <button
              type="button"
              onClick={() => setActiveTab(2)}
              className={cn(
                "rounded px-3 py-1.5 text-xs font-semibold transition-all",
                activeTab === 2
                  ? "bg-navy-900 text-white shadow-xs"
                  : "bg-sand-100 text-ink-600 hover:bg-sand-200"
              )}
            >
              Attempt 2 (Improvement) {attempts.find((a) => a.attemptNumber === 2) && "✓"}
            </button>
          )}
        </div>

        <div className="text-[11.5px] text-ink-400">
          {attempts.length}/2 Attempts Used
        </div>
      </div>

      {/* Main Workspace Grid */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* LEFT COLUMN: Prompt Editor */}
        <div className="flex flex-col rounded-lg border border-line bg-white shadow-xs">
          <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5 bg-canvas/40">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-700">
              <FileCode className="h-4 w-4 text-steel-600" />
              <span>Prompt Editor (Attempt {activeTab})</span>
            </div>
            <span className="text-[11px] font-mono text-ink-400">
              {currentPrompt.length} chars · ~{Math.ceil(currentPrompt.length / 4)} tokens
            </span>
          </div>

          <div className="p-3">
            <textarea
              rows={12}
              disabled={isLocked || (activeAttempt && activeTab !== attempts.length + (canAttemptMore ? 1 : 0))}
              value={currentPrompt}
              onChange={(e) => setCurrentPrompt(e.target.value)}
              placeholder={`Write your structured prompt for Attempt ${activeTab} here...\n\nExample:\nYou are an expert database architect. Design a zero-downtime Blue/Green migration...`}
              className="w-full resize-none rounded border border-line-strong bg-sand-50/20 p-3 font-mono text-[13px] leading-relaxed text-ink-900 focus:border-steel-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-steel-500/20 disabled:bg-sand-100/60 disabled:text-ink-600"
            />
          </div>

          <div className="flex items-center justify-between border-t border-line px-3.5 py-2.5 bg-canvas/30">
            <span className="text-[11px] text-ink-500">
              {isLocked
                ? "Question locked."
                : activeAttempt
                ? `Attempt ${activeTab} already submitted.`
                : `Submit Attempt ${activeTab} to generate AI response.`}
            </span>

            {!isLocked && !activeAttempt && (
              <Button loading={isRunning} onClick={handleRunPrompt}>
                <Play className="h-3.5 w-3.5 mr-1" /> Run with AI
              </Button>
            )}

            {!isLocked && activeAttempt && activeTab === 1 && attempts.length === 1 && (
              <Button variant="secondary" onClick={() => setActiveTab(2)}>
                Iterate & Improve in Attempt 2 →
              </Button>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: AI Response & Evaluation View */}
        <div className="flex flex-col rounded-lg border border-line bg-white shadow-xs">
          <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5 bg-canvas/40">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-700">
              <Terminal className="h-4 w-4 text-emerald-600" />
              <span>AI Response Output (Attempt {activeTab})</span>
            </div>
            {activeAttempt?.submittedAt && (
              <span className="text-[11px] text-ink-400">
                {new Date(activeAttempt.submittedAt).toLocaleTimeString()}
              </span>
            )}
          </div>

          <div className="flex-1 p-3">
            {isRunning ? (
              <div className="flex h-56 flex-col items-center justify-center gap-2 text-ink-500">
                <Sparkles className="h-6 w-6 animate-spin text-steel-500" />
                <span className="text-xs">Generating AI response through backend...</span>
              </div>
            ) : activeAttempt?.response ? (
              <div className="h-[280px] overflow-y-auto rounded border border-line-strong bg-navy-950 p-3 font-mono text-[12.5px] leading-relaxed text-emerald-300">
                <pre className="whitespace-pre-wrap break-words">{activeAttempt.response}</pre>
              </div>
            ) : (
              <div className="flex h-56 flex-col items-center justify-center gap-1.5 rounded border border-dashed border-line text-ink-400">
                <Terminal className="h-7 w-7 opacity-40" />
                <span className="text-xs font-medium">No response generated yet for Attempt {activeTab}</span>
                <span className="text-[11px] text-ink-400">Click "Run with AI" to test your prompt</span>
              </div>
            )}
          </div>

          {/* Action Footer */}
          <div className="flex items-center justify-between border-t border-line px-3.5 py-2.5 bg-canvas/30">
            <div>
              {attempts.length >= 2 && !isLocked && (
                <span className="text-[11.5px] font-medium text-warn-600">
                  Maximum attempts reached. Ready to finalize.
                </span>
              )}
            </div>

            {!isLocked && attempts.length > 0 && (
              <Button variant="secondary" onClick={handleLockQuestion}>
                <Lock className="h-3.5 w-3.5 mr-1 text-ink-600" /> Finalize & Lock Question
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

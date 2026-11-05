import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import Editor from "@monaco-editor/react";
import {
  Play,
  RotateCcw,
  Maximize2,
  Minimize2,
  Terminal,
  Code2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Cpu,
  ChevronDown,
  Sparkles,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

export interface CodingLanguage {
  id: "c" | "cpp" | "java" | "python";
  name: string;
  runtime: string;
  judge0Id: number;
  monacoLang: string;
  badge: string;
}

export const ALL_LANGUAGES: CodingLanguage[] = [
  { id: "c", name: "C", runtime: "GCC 11.1", judge0Id: 50, monacoLang: "c", badge: "C" },
  { id: "cpp", name: "C++", runtime: "G++ 11.1", judge0Id: 54, monacoLang: "cpp", badge: "C++" },
  { id: "java", name: "Java", runtime: "OpenJDK 17", judge0Id: 62, monacoLang: "java", badge: "JAVA" },
  { id: "python", name: "Python", runtime: "Python 3.10", judge0Id: 71, monacoLang: "python", badge: "PY" },
];

export const STARTER_CODES: Record<string, string> = {
  c: `#include <stdio.h>

int main() {
    // Write your solution here
    return 0;
}
`,
  cpp: `#include <iostream>
using namespace std;

int main() {
    // Write your solution here
    return 0;
}
`,
  java: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        // Write your solution here
        Scanner scanner = new Scanner(System.in);
    }
}
`,
  python: `import sys

def main():
    # Write your solution here
    pass

if __name__ == "__main__":
    main()
`,
};

interface ExecutionResult {
  success: boolean;
  language: string;
  stdout: string;
  stderr: string;
  compile_output: string | null;
  status: "ACCEPTED" | "WRONG_ANSWER" | "COMPILATION_ERROR" | "TIME_LIMIT_EXCEEDED" | "RUNTIME_ERROR" | string;
  time: string;
  memory: string;
  source?: string;
}

interface SavedCodePayload {
  language: "c" | "cpp" | "java" | "python";
  code: string;
  drafts: Record<string, string>;
}

interface CodingIDEProps {
  questionId: string;
  allowedLanguagesRaw?: string | null;
  starterCodeRaw?: string | null;
  textAnswer?: string | null;
  attemptId?: string;
  onChange: (patch: { textAnswer: string }) => void;
}

// Normalize allowed languages configured by Admin
function parseAllowedLanguages(raw?: string | null): CodingLanguage[] {
  // If not specified or legacy 'all', 'python', 'javascript' defaults, enable all 4 supported languages
  if (
    !raw ||
    raw.trim() === "" ||
    raw.toLowerCase() === "all" ||
    raw.toLowerCase() === "python" ||
    raw.toLowerCase() === "javascript"
  ) {
    return ALL_LANGUAGES;
  }

  const tokens = raw
    .toLowerCase()
    .split(/[,|\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const matched: CodingLanguage[] = [];
  for (const token of tokens) {
    let id: CodingLanguage["id"] | null = null;
    if (token === "c" || token === "c_only" || token === "gcc") id = "c";
    else if (token === "cpp" || token === "c++" || token === "g++" || token === "cpp_only") id = "cpp";
    else if (token === "java" || token === "openjdk" || token === "java_only") id = "java";
    else if (token === "python" || token === "python3" || token === "py" || token === "python_only") id = "python";

    if (id) {
      const found = ALL_LANGUAGES.find((l) => l.id === id);
      if (found && !matched.some((m) => m.id === id)) {
        matched.push(found);
      }
    }
  }

  return matched.length > 0 ? matched : ALL_LANGUAGES;
}

export default function CodingIDE({
  questionId,
  allowedLanguagesRaw,
  starterCodeRaw,
  textAnswer,
  attemptId,
  onChange,
}: CodingIDEProps) {
  const [dynamicLanguages, setDynamicLanguages] = useState<CodingLanguage[]>(ALL_LANGUAGES);
  const [judge0Info, setJudge0Info] = useState<{ connected: boolean; url?: string } | null>(null);

  // Retrieve supported language configuration & Judge0 status dynamically from backend
  useEffect(() => {
    let active = true;
    api<{
      judge0Connected: boolean;
      judge0Url?: string;
      languages: Array<{
        id: "c" | "cpp" | "java" | "python";
        name: string;
        runtime: string;
        judge0Id: number;
        judge0Runtime?: string | null;
        available?: boolean;
      }>;
    }>("/compiler/languages")
      .then((res) => {
        if (!active || !res.languages) return;
        setJudge0Info({ connected: res.judge0Connected, url: res.judge0Url });
        const merged = ALL_LANGUAGES.map((base) => {
          const match = res.languages.find((l) => l.id === base.id);
          if (match) {
            return {
              ...base,
              judge0Id: match.judge0Id || base.judge0Id,
            };
          }
          return base;
        });
        setDynamicLanguages(merged);
      })
      .catch(() => {
        // Fallback to built-in compiler configurations
      });
    return () => {
      active = false;
    };
  }, []);

  const allowedLanguages = useMemo(() => {
    const parsed = parseAllowedLanguages(allowedLanguagesRaw);
    return parsed.map((p) => dynamicLanguages.find((d) => d.id === p.id) || p);
  }, [allowedLanguagesRaw, dynamicLanguages]);

  const defaultLang = allowedLanguages[0]?.id || "c";

  // Parse saved JSON answer or handle legacy raw code string
  const initialData = useMemo<{
    language: CodingLanguage["id"];
    drafts: Record<string, string>;
  }>(() => {
    let lang = defaultLang;
    const drafts: Record<string, string> = { ...STARTER_CODES };

    // If custom starter code supplied for default language
    if (starterCodeRaw && starterCodeRaw.trim()) {
      drafts[defaultLang] = starterCodeRaw;
    }

    if (textAnswer && textAnswer.trim()) {
      try {
        const parsed = JSON.parse(textAnswer) as SavedCodePayload;
        if (parsed && typeof parsed === "object") {
          if (parsed.language && allowedLanguages.some((l) => l.id === parsed.language)) {
            lang = parsed.language;
          }
          if (parsed.drafts && typeof parsed.drafts === "object") {
            Object.assign(drafts, parsed.drafts);
          }
          if (parsed.code) {
            drafts[lang] = parsed.code;
          }
        }
      } catch {
        // Legacy plain text code saved directly
        drafts[defaultLang] = textAnswer;
      }
    }

    return { language: lang, drafts };
  }, [questionId, textAnswer, defaultLang, allowedLanguages, starterCodeRaw]);

  const [currentLang, setCurrentLang] = useState<CodingLanguage["id"]>(initialData.language);
  const [drafts, setDrafts] = useState<Record<string, string>>(initialData.drafts);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeTab, setActiveTab] = useState<"input" | "output">("output");
  const [customInput, setCustomInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [execResult, setExecResult] = useState<ExecutionResult | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const updateDropdownPos = () => {
    if (buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      setDropdownPos({
        top: r.bottom + 6,
        right: Math.max(12, window.innerWidth - r.right),
      });
    }
  };

  const toggleDropdown = () => {
    if (!dropdownOpen) {
      updateDropdownPos();
      setDropdownOpen(true);
    } else {
      setDropdownOpen(false);
    }
  };

  // Close dropdown on outside click or reposition on scroll/resize
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    function handleScrollOrResize() {
      if (dropdownOpen) {
        updateDropdownPos();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [dropdownOpen]);

  const currentCode = drafts[currentLang] ?? STARTER_CODES[currentLang] ?? "";
  const currentLangMeta = ALL_LANGUAGES.find((l) => l.id === currentLang) || ALL_LANGUAGES[0];

  // Sync code change to parent without resetting timer
  const handleCodeChange = (newCode: string | undefined) => {
    const val = newCode ?? "";
    const updatedDrafts = { ...drafts, [currentLang]: val };
    setDrafts(updatedDrafts);

    const payload: SavedCodePayload = {
      language: currentLang,
      code: val,
      drafts: updatedDrafts,
    };
    onChange({ textAnswer: JSON.stringify(payload) });
  };

  // Language switch handler: preserves code per language, updates starter code if empty, updates syntax highlighting
  const handleLanguageChange = (newLang: CodingLanguage["id"]) => {
    if (newLang === currentLang) {
      setDropdownOpen(false);
      return;
    }

    // Save existing code under current language
    const updatedDrafts = { ...drafts };
    if (!updatedDrafts[newLang]) {
      updatedDrafts[newLang] = STARTER_CODES[newLang];
    }

    setCurrentLang(newLang);
    setDrafts(updatedDrafts);
    setDropdownOpen(false);

    // Save state payload with new language
    const payload: SavedCodePayload = {
      language: newLang,
      code: updatedDrafts[newLang],
      drafts: updatedDrafts,
    };
    onChange({ textAnswer: JSON.stringify(payload) });
  };

  const handleResetStarter = () => {
    if (!window.confirm(`Reset ${currentLangMeta.name} code to starter template?`)) return;
    const starter = STARTER_CODES[currentLang];
    handleCodeChange(starter);
  };

  const handleRunCode = async () => {
    setIsRunning(true);
    setActiveTab("output");
    try {
      const res = await api<ExecutionResult>("/compiler/run", {
        method: "POST",
        body: {
          language: currentLang,
          sourceCode: currentCode,
          stdin: customInput,
          questionId,
          attemptId,
        },
      });
      setExecResult(res);
    } catch (err) {
      setExecResult({
        success: false,
        language: currentLang,
        stdout: "",
        stderr: (err as Error).message || "Execution request failed",
        compile_output: null,
        status: "RUNTIME_ERROR",
        time: "0.00s",
        memory: "0.0 MB",
      });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border border-navy-800/60 bg-navy-950 text-white shadow-xl overflow-hidden transition-all",
        isFullscreen ? "fixed inset-0 z-50 rounded-none border-none" : "w-full my-3"
      )}
    >
      {/* ── TOOLBAR ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-navy-800/80 bg-navy-900/90 px-4 py-2.5 backdrop-blur-sm">
        {/* Left Toolbar Items: Editor Title & Language Runtime Pill */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-steel-400 font-semibold text-xs tracking-wider uppercase">
            <Code2 className="h-4 w-4 text-steel-400" />
            <span>Monaco Code IDE</span>
          </div>

          <span className="hidden sm:inline-flex items-center gap-1 rounded bg-navy-800/70 px-2 py-0.5 text-[11px] font-mono text-ink-300 border border-navy-700/60">
            <Sparkles className="h-3 w-3 text-signal-400" />
            <span>{currentLangMeta.runtime}</span>
          </span>
        </div>

        {/* Right Toolbar Items: PROMINENT LANGUAGE SELECTOR DROPDOWN + Controls */}
        <div className="flex items-center gap-2.5">
          {/* Reset Template */}
          <button
            type="button"
            onClick={handleResetStarter}
            title="Reset to starter template"
            className="flex items-center gap-1.5 rounded-lg border border-navy-700/70 bg-navy-800/50 px-2.5 py-1.5 text-xs text-ink-300 hover:bg-navy-700 hover:text-white transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Reset</span>
          </button>

          {/* Fullscreen Toggle */}
          <button
            type="button"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Editor"}
            className="rounded-lg border border-navy-700/70 bg-navy-800/50 p-1.5 text-ink-300 hover:bg-navy-700 hover:text-white transition-colors"
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>

          {/* ── PROGRAMMING LANGUAGE SELECTION DROPDOWN (PROMINENT AT TOP-RIGHT) ── */}
          <div className="relative">
            <button
              ref={buttonRef}
              type="button"
              onClick={toggleDropdown}
              className={cn(
                "group flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-sm transition-all focus:outline-none",
                dropdownOpen
                  ? "border-signal-500 bg-navy-800 text-white ring-2 ring-signal-500/20"
                  : "border-steel-600/70 bg-gradient-to-r from-navy-800 to-navy-850 text-white hover:border-steel-400 hover:bg-navy-700"
              )}
              aria-label="Select Programming Language"
            >
              <span className="w-10 text-center rounded bg-navy-950/80 px-1.5 py-0.5 font-mono text-[10.5px] font-bold tracking-wider text-signal-400 border border-signal-500/30">
                {currentLangMeta.badge}
              </span>
              <span className="font-semibold text-[13px] text-white tracking-tight">{currentLangMeta.name}</span>
              <span className="text-[11px] font-mono text-ink-400 hidden sm:inline-block">({currentLangMeta.runtime})</span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 text-ink-400 transition-transform group-hover:text-white",
                  dropdownOpen && "rotate-180 text-signal-400"
                )}
              />
            </button>

            {/* Dropdown Menu rendered via React Portal outside overflow & stacking contexts */}
            {dropdownOpen && dropdownPos && createPortal(
              <div
                ref={dropdownRef}
                style={{
                  position: "fixed",
                  top: `${dropdownPos.top}px`,
                  right: `${dropdownPos.right}px`,
                  zIndex: 999999,
                }}
                className="w-60 rounded-xl border border-navy-700 bg-navy-900/98 p-1.5 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
              >
                <div className="px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-400 border-b border-navy-800/80 flex items-center justify-between">
                  <span>Language</span>
                  <span className="font-mono text-[9px] text-signal-400/80 lowercase">
                    {judge0Info?.connected ? "judge0" : "sandbox"}
                  </span>
                </div>
                <div className="mt-1 space-y-0.5">
                  {allowedLanguages.map((lang) => {
                    const isSelected = lang.id === currentLang;
                    return (
                      <button
                        key={lang.id}
                        type="button"
                        onClick={() => handleLanguageChange(lang.id)}
                        className={cn(
                          "w-full flex items-center justify-between rounded-lg px-2.5 py-2 text-left transition-colors",
                          isSelected
                            ? "bg-steel-600/30 text-white font-semibold border border-steel-500/30 shadow-sm"
                            : "text-ink-200 hover:bg-navy-800 hover:text-white"
                        )}
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className={cn(
                              "w-11 text-center shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider border",
                              isSelected
                                ? "bg-signal-500 text-navy-950 border-signal-400 font-bold shadow-sm"
                                : "bg-navy-800 text-ink-300 border-navy-700"
                            )}
                          >
                            {lang.badge}
                          </span>
                          <div className="min-w-0">
                            <div className={cn(
                              "text-[13px] font-semibold leading-tight tracking-tight",
                              isSelected ? "text-white" : "text-ink-100"
                            )}>
                              {lang.name}
                            </div>
                            <div className="text-[11px] text-ink-400 font-mono mt-0.5">
                              {lang.runtime}
                            </div>
                          </div>
                        </div>
                        {isSelected && <CheckCircle2 className="h-4 w-4 text-signal-400 shrink-0 ml-2" />}
                      </button>
                    );
                  })}
                </div>
              </div>,
              document.body
            )}
          </div>
        </div>
      </div>

      {/* ── MONACO CODE EDITOR ──────────────────────────────────────────────── */}
      <div className={cn("relative transition-all", isFullscreen ? "flex-1" : "h-[420px]")}>
        <Editor
          height="100%"
          language={currentLangMeta.monacoLang}
          value={currentCode}
          theme="vs-dark"
          onChange={handleCodeChange}
          options={{
            fontFamily: "'IBM Plex Mono', 'Cascadia Code', Consolas, monospace",
            fontSize: 13.5,
            lineNumbers: "on",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 4,
            cursorBlinking: "smooth",
            smoothScrolling: true,
            formatOnPaste: true,
            formatOnType: true,
            padding: { top: 12, bottom: 12 },
          }}
          loading={
            <div className="flex h-full items-center justify-center text-sm text-ink-400">
              <Sparkles className="mr-2 h-4 w-4 animate-spin text-signal-400" />
              Initializing Monaco Editor ({currentLangMeta.name})...
            </div>
          }
        />
      </div>

      {/* ── BOTTOM DRAWER: CONSOLE, CUSTOM INPUT & EXECUTION STATUS ───────────── */}
      <div className="border-t border-navy-800 bg-navy-900/90">
        {/* Drawer Header Tabs + Run Code Action */}
        <div className="flex items-center justify-between border-b border-navy-800/80 px-4 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("output")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
                activeTab === "output"
                  ? "bg-navy-800 text-signal-400 border border-signal-500/30"
                  : "text-ink-400 hover:text-white"
              )}
            >
              <Terminal className="h-3.5 w-3.5" />
              <span>Console Output</span>
              {execResult && (
                <span
                  className={cn(
                    "ml-1 h-2 w-2 rounded-full",
                    execResult.status === "ACCEPTED" ? "bg-ok-500" : "bg-bad-500"
                  )}
                />
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("input")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
                activeTab === "input"
                  ? "bg-navy-800 text-signal-400 border border-signal-500/30"
                  : "text-ink-400 hover:text-white"
              )}
            >
              <Info className="h-3.5 w-3.5" />
              <span>Custom Input (stdin)</span>
              {customInput.trim() && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-signal-400" />}
            </button>
          </div>

          {/* Run Code Execution Trigger */}
          <div className="flex items-center gap-2">
            {execResult && (
              <div className="hidden sm:flex items-center gap-2 text-[11px] text-ink-400 font-mono">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3 text-ink-400" /> {execResult.time}
                </span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <Cpu className="h-3 w-3 text-ink-400" /> {execResult.memory}
                </span>
              </div>
            )}

            <Button
              size="sm"
              variant="primary"
              disabled={isRunning}
              loading={isRunning}
              onClick={handleRunCode}
              className="bg-signal-500 hover:bg-signal-400 text-navy-950 font-bold px-3.5 py-1 shadow-sm transition-all"
            >
              {!isRunning && <Play className="h-3.5 w-3.5 mr-1.5 fill-current" />}
              Run Code
            </Button>
          </div>
        </div>

        {/* Tab Body */}
        <div className="max-h-48 min-h-28 overflow-y-auto p-3 font-mono text-xs scrollbar-thin">
          {activeTab === "input" ? (
            <div>
              <div className="mb-1 text-[11px] text-ink-400">
                Provide custom standard input for testing your {currentLangMeta.name} code:
              </div>
              <textarea
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder="Enter standard input (stdin) lines here..."
                rows={3}
                className="w-full rounded border border-navy-700 bg-navy-950 p-2 text-ink-100 placeholder-ink-600 focus:border-signal-500 focus:outline-none"
              />
            </div>
          ) : (
            <div>
              {isRunning ? (
                <div className="flex items-center gap-2 py-4 text-ink-400">
                  <Sparkles className="h-4 w-4 animate-spin text-signal-400" />
                  <span>Compiling and executing {currentLangMeta.name} in secure sandbox...</span>
                </div>
              ) : execResult ? (
                <div className="space-y-2">
                  {/* Status Banner */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-navy-800/80 pb-1.5">
                    <div className="flex items-center gap-2">
                      {execResult.status === "ACCEPTED" ? (
                        <span className="inline-flex items-center gap-1 rounded bg-ok-900/60 px-2 py-0.5 text-[11px] font-bold text-ok-400 border border-ok-700/60">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Execution Successful
                        </span>
                      ) : execResult.status === "COMPILATION_ERROR" ? (
                        <span className="inline-flex items-center gap-1 rounded bg-bad-900/60 px-2 py-0.5 text-[11px] font-bold text-bad-400 border border-bad-700/60">
                          <XCircle className="h-3.5 w-3.5" /> Compilation Error
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-900/60 px-2 py-0.5 text-[11px] font-bold text-amber-400 border border-amber-700/60">
                          <AlertTriangle className="h-3.5 w-3.5" /> {execResult.status}
                        </span>
                      )}
                      <span className="text-[11px] text-ink-400">
                        Language: <b className="text-white">{currentLangMeta.name}</b>
                      </span>
                    </div>

                    <div className="text-[11px] text-ink-400 font-mono">
                      Time: {execResult.time} | Memory: {execResult.memory}
                    </div>
                  </div>

                  {/* Compilation output */}
                  {execResult.compile_output && (
                    <div>
                      <div className="text-[11px] font-semibold text-bad-400">Compiler Diagnostic:</div>
                      <pre className="mt-1 whitespace-pre-wrap rounded bg-bad-950/40 p-2 text-bad-300 border border-bad-900/60">
                        {execResult.compile_output}
                      </pre>
                    </div>
                  )}

                  {/* Standard output */}
                  {execResult.stdout && (
                    <div>
                      <div className="text-[11px] font-semibold text-ink-400">Standard Output (stdout):</div>
                      <pre className="mt-1 whitespace-pre-wrap rounded bg-navy-950 p-2 text-ink-100 border border-navy-800">
                        {execResult.stdout}
                      </pre>
                    </div>
                  )}

                  {/* Standard error */}
                  {execResult.stderr && (
                    <div>
                      <div className="text-[11px] font-semibold text-amber-400">Standard Error (stderr):</div>
                      <pre className="mt-1 whitespace-pre-wrap rounded bg-amber-950/40 p-2 text-amber-300 border border-amber-900/60">
                        {execResult.stderr}
                      </pre>
                    </div>
                  )}

                  {!execResult.stdout && !execResult.stderr && !execResult.compile_output && (
                    <div className="text-ink-500 italic py-2">
                      Program finished with no output.
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-3 text-ink-500 flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-ink-600" />
                  <span>Click "Run Code" above to execute your solution against sample input or custom test cases.</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


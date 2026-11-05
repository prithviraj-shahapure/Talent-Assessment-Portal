import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "navy" | "ok" | "warn" | "bad" | "steel" | "signal";
const tones: Record<Tone, string> = {
  neutral: "bg-canvas text-ink-700 border-line",
  navy: "bg-navy-50 text-navy-800 border-navy-100",
  ok: "bg-ok-50 text-ok-600 border-ok-100",
  warn: "bg-warn-50 text-warn-600 border-warn-100",
  bad: "bg-bad-50 text-bad-600 border-bad-100",
  steel: "bg-steel-100/60 text-steel-600 border-steel-100",
  signal: "bg-signal-100 text-[#8a5a12] border-signal-100",
};
export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded border px-1.5 py-[1px] text-[11.5px] font-medium whitespace-nowrap", tones[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 py-10 text-ink-500 text-[13px]", className)}>
      <Loader2 className="h-4 w-4 animate-spin" />
      {label ?? "Loading…"}
    </div>
  );
}

export function EmptyState({ icon, title, body, action, className }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center px-6 py-12", className)}>
      {icon && <div className="mb-3 text-ink-300">{icon}</div>}
      <div className="font-semibold text-ink-900">{title}</div>
      {body && <div className="mt-1 max-w-md text-[13px] text-ink-500">{body}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "navy", title, children, className, icon }: { tone?: "navy" | "ok" | "warn" | "bad"; title?: ReactNode; children?: ReactNode; className?: string; icon?: ReactNode }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "warn" ? AlertTriangle : tone === "bad" ? XCircle : Info;
  return (
    <div className={cn("flex gap-3 rounded border px-3.5 py-3 text-[13px]", tones[tone], className)}>
      <span className="mt-[1px] shrink-0">{icon ?? <Icon className="h-4 w-4" />}</span>
      <div className="min-w-0">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn(title && "mt-0.5", "text-ink-700")}>{children}</div>}
      </div>
    </div>
  );
}

// ───── Toasts ─────
interface Toast { id: number; tone: "ok" | "bad" | "navy" | "warn"; text: string }
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "bad" ? 6500 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[min(380px,calc(100vw-32px))]" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cn("animate-fade-in flex items-start gap-2.5 rounded-md border bg-white px-3.5 py-3 shadow-pop text-[13px]", t.tone === "bad" ? "border-bad-100" : "border-line")}>
            {t.tone === "ok" ? <CheckCircle2 className="h-4 w-4 text-ok-600 mt-[1px]" /> : t.tone === "bad" ? <XCircle className="h-4 w-4 text-bad-600 mt-[1px]" /> : t.tone === "warn" ? <AlertTriangle className="h-4 w-4 text-warn-600 mt-[1px]" /> : <Info className="h-4 w-4 text-navy-700 mt-[1px]" />}
            <span className="flex-1 text-ink-900">{t.text}</span>
            <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="text-ink-400 hover:text-ink-700" aria-label="Dismiss">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

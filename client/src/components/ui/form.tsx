import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const fieldBase =
  "w-full rounded border border-line-strong bg-white px-3 text-[13.5px] text-ink-900 placeholder:text-ink-400 transition-colors focus:border-steel-500 focus:outline-none focus:ring-2 focus:ring-steel-500/20 disabled:bg-canvas disabled:text-ink-500";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(fieldBase, "h-9", className)} {...p} />
));
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, "py-2 min-h-[84px] leading-relaxed", className)} {...p} />
));
Textarea.displayName = "Textarea";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select
    ref={ref}
    className={cn(
      fieldBase,
      "h-9 appearance-none pr-8 bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%235b6478%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-no-repeat bg-[right_10px_center]",
      className,
    )}
    {...p}
  >
    {children}
  </select>
));
Select.displayName = "Select";

export function Field({ label, hint, error, required, children, className }: { label: ReactNode; hint?: ReactNode; error?: string | null; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[12.5px] font-medium text-ink-700">
        {label}
        {required && <span className="ml-0.5 text-bad-600">*</span>}
      </span>
      {children}
      {error ? <span className="mt-1 block text-[12px] text-bad-600">{error}</span> : hint ? <span className="mt-1 block text-[12px] text-ink-500">{hint}</span> : null}
    </label>
  );
}

export function Checkbox({ label, description, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("flex items-start gap-2.5 cursor-pointer select-none", p.disabled && "opacity-60 cursor-not-allowed", className)}>
      <input id={id} type="checkbox" className="mt-[3px] h-4 w-4 shrink-0 rounded-sm border-line-strong accent-navy-900" {...p} />
      <span>
        <span className="text-[13.5px] text-ink-900">{label}</span>
        {description && <span className="block text-[12px] text-ink-500 mt-0.5">{description}</span>}
      </span>
    </label>
  );
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 py-2", disabled && "opacity-60")}>
      <div>
        <div className="text-[13.5px] font-medium text-ink-900">{label}</div>
        {description && <div className="text-[12px] text-ink-500 mt-0.5 max-w-prose">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-navy-900" : "bg-line-strong")}
      >
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </button>
    </div>
  );
}

export function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  return (
    <div className={cn(fieldBase, "flex flex-wrap items-center gap-1.5 min-h-9 py-1.5")}>
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded bg-navy-50 border border-navy-100 px-1.5 py-0.5 text-[12px] text-navy-800">
          {t}
          <button type="button" className="text-ink-400 hover:text-bad-600" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove ${t}`}>
            ×
          </button>
        </span>
      ))}
      <input
        className="flex-1 min-w-[100px] outline-none bg-transparent text-[13px]"
        placeholder={placeholder}
        onKeyDown={(e) => {
          const el = e.currentTarget;
          if ((e.key === "Enter" || e.key === ",") && el.value.trim()) {
            e.preventDefault();
            const v = el.value.trim().replace(/,$/, "");
            if (!value.includes(v)) onChange([...value, v]);
            el.value = "";
          } else if (e.key === "Backspace" && !el.value && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={(e) => {
          const v = e.currentTarget.value.trim();
          if (v && !value.includes(v)) onChange([...value, v]);
          e.currentTarget.value = "";
        }}
      />
    </div>
  );
}

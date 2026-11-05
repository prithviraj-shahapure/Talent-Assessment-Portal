import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

export function Card({ children, className, title, actions, padded = true, subtitle }: { children: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; padded?: boolean }) {
  return (
    <section className={cn("card", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && <h3 className="text-[13.5px] font-semibold text-ink-900">{title}</h3>}
            {subtitle && <p className="text-[12px] text-ink-500 mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cn(padded && "p-4")}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back}
        {eyebrow && <div className="label-caps mb-1">{eyebrow}</div>}
        <h1 className="text-[22px] font-semibold text-ink-900 leading-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-[13.5px] text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, sub, icon, tone = "navy", onClick }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: "navy" | "ok" | "warn" | "bad" | "signal"; onClick?: () => void }) {
  const bar = { navy: "bg-navy-700", ok: "bg-ok-600", warn: "bg-warn-600", bad: "bg-bad-600", signal: "bg-signal-500" }[tone];
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className={cn("card relative overflow-hidden text-left px-4 py-3.5 transition-colors", onClick && "hover:border-navy-500/40 cursor-pointer")}>
      <span className={cn("absolute left-0 top-0 h-full w-[3px]", bar)} />
      <div className="flex items-start justify-between">
        <div className="label-caps">{label}</div>
        {icon && <div className="text-ink-300">{icon}</div>}
      </div>
      <div className="num mt-2 text-[26px] font-medium leading-none text-ink-900">{value}</div>
      {sub && <div className="mt-1.5 text-[12px] text-ink-500">{sub}</div>}
    </button>
  );
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    <div className={cn("flex gap-1 border-b border-line overflow-x-auto scrollbar-thin", className)} role="tablist">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cn(
            "relative -mb-px whitespace-nowrap px-3 py-2.5 text-[13px] font-medium transition-colors border-b-2",
            value === it.value ? "border-navy-900 text-navy-900" : "border-transparent text-ink-500 hover:text-ink-900",
          )}
        >
          {it.label}
          {it.count !== undefined && <span className={cn("ml-1.5 num rounded px-1 text-[11px]", value === it.value ? "bg-navy-900 text-white" : "bg-canvas text-ink-500")}>{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between border-t border-line px-3 py-2.5 text-[12.5px] text-ink-500">
      <span className="num">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="num px-2">
          {page} / {pages}
        </span>
        <Button variant="ghost" size="icon" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5", className)}>{children}</div>;
}

export function KeyValue({ items, cols = 3 }: { items: [ReactNode, ReactNode][]; cols?: 2 | 3 | 4 }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3", cols === 2 ? "sm:grid-cols-2" : cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4")}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="label-caps">{k}</dt>
          <dd className="mt-0.5 text-[13.5px] text-ink-900 break-words">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

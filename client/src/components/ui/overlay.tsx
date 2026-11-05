import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./button";
import { Textarea } from "./form";

export function Dialog({ open, onClose, title, description, children, footer, size = "md", dismissable = true }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" | "xl"; dismissable?: boolean }) {
  useEffect(() => {
    if (!open || !dismissable) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose, dismissable]);
  if (!open) return null;
  const w = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-950/45 p-4 sm:pt-[8vh]" onMouseDown={(e) => dismissable && e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className={cn("animate-fade-in w-full rounded-md bg-white shadow-pop", w)}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[16px] font-semibold text-ink-900">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-ink-500">{description}</p>}
          </div>
          {dismissable && (
            <button onClick={onClose} className="rounded p-1 text-ink-400 hover:bg-canvas hover:text-ink-700" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line bg-canvas/60 px-5 py-3 rounded-b-md">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel = "Confirm", tone = "primary", requireReason, reasonLabel }: { open: boolean; onClose: () => void; onConfirm: (reason?: string) => Promise<void> | void; title: string; body?: ReactNode; confirmLabel?: string; tone?: "primary" | "danger"; requireReason?: boolean; reasonLabel?: string }) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            loading={busy}
            disabled={requireReason && reason.trim().length < 5}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(reason.trim() || undefined);
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body && <div className="text-[13.5px] text-ink-700">{body}</div>}
      {requireReason && (
        <div className="mt-3">
          <div className="mb-1.5 text-[12.5px] font-medium text-ink-700">{reasonLabel ?? "Reason (recorded in the audit log)"}</div>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </div>
      )}
    </Dialog>
  );
}

export function Drawer({ open, onClose, title, children, width = "max-w-2xl" }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-navy-950/35" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cn("h-full w-full bg-white shadow-pop flex flex-col animate-fade-in", width)}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="font-semibold text-[15px]">{title}</div>
          <button onClick={onClose} className="rounded p-1 text-ink-400 hover:bg-canvas" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

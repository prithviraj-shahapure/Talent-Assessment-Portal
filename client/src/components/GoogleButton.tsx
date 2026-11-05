import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { getProviders, warmGoogle } from "@/lib/google";

/** "Continue with Google" — only shown when the server has Firebase configured. */
export function GoogleButton({ onClick, busy, label = "Continue with Google" }: { onClick: () => void; busy?: boolean; label?: string }) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    getProviders().then((p) => {
      setEnabled(!!p.google);
      if (p.google) warmGoogle();
    });
  }, []);
  if (!enabled) return null;
  return (
    <>
      <Button type="button" variant="secondary" size="lg" className="w-full" loading={busy} onClick={onClick}>
        <AccountGlyph />
        {label}
      </Button>
      <div className="my-5 flex items-center gap-3 text-[11.5px] uppercase tracking-wide text-ink-400">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
    </>
  );
}

/** Neutral account glyph (no third-party logo artwork). */
function AccountGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

import { cn } from "@/lib/cn";

export function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src="/zanvar-logo.png"
      alt="Zanvar Group Logo"
      className={cn("h-7 w-7 shrink-0 object-contain select-none", className)}
    />
  );
}

export function Brand({ inverse, compact }: { inverse?: boolean; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark />
      {!compact && (
        <div className="leading-none">
          <div className={cn("text-[13px] font-bold tracking-[0.16em]", inverse ? "text-white" : "text-navy-900")}>ZANVAR GROUP</div>
          <div className={cn("mt-1 text-[10.5px] font-medium tracking-[0.06em] uppercase", inverse ? "text-white/55" : "text-ink-500")}>Talent Assessment Portal</div>
        </div>
      )}
    </div>
  );
}

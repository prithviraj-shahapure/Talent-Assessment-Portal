import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline" | "signal";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary: "bg-navy-900 text-white hover:bg-navy-800 active:bg-navy-950 border border-navy-900",
  secondary: "bg-white text-ink-900 border border-line-strong hover:bg-navy-50 hover:border-navy-500/40",
  outline: "bg-transparent text-navy-900 border border-navy-900/70 hover:bg-navy-50",
  ghost: "bg-transparent text-ink-700 hover:bg-navy-50 border border-transparent",
  danger: "bg-bad-600 text-white hover:bg-[#9b1c13] border border-bad-600",
  signal: "bg-signal-500 text-navy-950 hover:brightness-95 border border-signal-500 font-semibold",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-9 px-4 text-[13px] gap-2",
  lg: "h-11 px-5 text-[14px] gap-2",
  icon: "h-8 w-8 p-0 justify-center",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant = "primary", size = "md", loading, disabled, children, ...props }, ref) => (
  <button
    ref={ref}
    disabled={disabled || loading}
    className={cn(
      "inline-flex items-center justify-center rounded font-medium transition-colors whitespace-nowrap select-none disabled:opacity-50 disabled:pointer-events-none",
      variants[variant],
      sizes[size],
      className,
    )}
    {...props}
  >
    {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
    {children}
  </button>
));
Button.displayName = "Button";

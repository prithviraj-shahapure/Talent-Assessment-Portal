import type { ReactNode } from "react";
import { Camera, ShieldCheck, Timer } from "lucide-react";
import { Brand } from "@/components/Brand";

export default function AuthLayout({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(380px,44%)_1fr]">
      <aside className="relative hidden overflow-hidden bg-navy-900 text-white lg:flex lg:flex-col lg:justify-between p-10">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "36px 36px" }} />
        <div className="relative">
          <Brand inverse />
        </div>
        <div className="relative max-w-md">
          <div className="mb-3 h-1 w-12 bg-signal-500" />
          <h1 className="text-[30px] font-semibold leading-tight tracking-tight">Assessment and intern recruitment for Zanvar Group.</h1>
          <p className="mt-3 text-[14px] text-white/65">Take your examination securely from any laptop or desktop. Results are reviewed by the Zanvar HR team.</p>
          <ul className="mt-8 space-y-3 text-[13px] text-white/80">
            <li className="flex gap-3"><Timer className="h-4 w-4 mt-0.5 text-signal-500" /> Server-timed examinations with automatic saving</li>
            <li className="flex gap-3"><Camera className="h-4 w-4 mt-0.5 text-signal-500" /> Webcam-based proctoring, only with your consent</li>
            <li className="flex gap-3"><ShieldCheck className="h-4 w-4 mt-0.5 text-signal-500" /> Every flag reviewed by a person — never decided automatically</li>
          </ul>
        </div>
        <div className="relative text-[12px] text-white/40">Zanvar Group · Kolhapur, Maharashtra</div>
      </aside>
      <main className="flex items-start justify-center px-4 py-10 sm:px-8 lg:items-center">
        <div className={wide ? "w-full max-w-2xl" : "w-full max-w-sm"}>
          <div className="mb-8 lg:hidden">
            <Brand />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

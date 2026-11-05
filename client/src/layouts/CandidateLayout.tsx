import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Brand } from "@/components/Brand";
import { cn } from "@/lib/cn";
import { Alert, Button, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useState } from "react";

export default function CandidateLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const link = (to: string, label: string) => (
    <NavLink to={to} end className={({ isActive }) => cn("px-3 py-2 text-[13px] font-medium rounded transition-colors", isActive ? "text-navy-900 bg-navy-50" : "text-ink-500 hover:text-ink-900")}>
      {label}
    </NavLink>
  );
  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-20 border-b border-line bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Brand />
          <nav className="hidden sm:flex items-center gap-1">
            {link("/candidate", "My Examinations")}
            {link("/candidate/profile", "Profile")}
          </nav>
          <div className="flex items-center gap-3">
            <div className="hidden md:block text-right leading-tight">
              <div className="text-[13px] font-medium">{user?.name}</div>
              <div className="text-[11.5px] text-ink-500">{user?.email}</div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await logout();
                nav("/login");
              }}
            >
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </div>
        </div>
        <nav className="flex sm:hidden gap-1 px-4 pb-2">
          {link("/candidate", "My Examinations")}
          {link("/candidate/profile", "Profile")}
        </nav>
      </header>
      {user && !user.emailVerified && (
        <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-4">
          <Alert tone="warn" title="Verify your email address">
            We sent a verification link to <b>{user.email}</b>. You must verify your email before you can start an examination.{" "}
            <button
              disabled={sending}
              className="font-medium text-navy-800 underline underline-offset-2"
              onClick={async () => {
                setSending(true);
                try {
                  const r = await api<{ devVerifyUrl?: string }>("/auth/resend-verification", { method: "POST" });
                  toast("Verification email sent");
                  if (r.devVerifyUrl) setDevLink(r.devVerifyUrl);
                } catch (e) {
                  toast((e as Error).message, "bad");
                } finally {
                  setSending(false);
                }
              }}
            >
              Resend email
            </button>
            {devLink && (
              <div className="mt-1 text-[12px]">
                Development mode — <a className="underline" href={devLink}>open verification link</a>
              </div>
            )}
          </Alert>
        </div>
      )}
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-6xl px-4 sm:px-6 pb-8 text-[12px] text-ink-400">© {new Date().getFullYear()} Zanvar Group · Your data is processed under the Digital Personal Data Protection Act, 2023.</footer>
    </div>
  );
}

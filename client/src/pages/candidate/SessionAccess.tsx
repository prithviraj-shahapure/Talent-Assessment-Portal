import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ArrowRight, KeyRound, LogIn, ShieldCheck } from "lucide-react";
import { Alert, Button, Input } from "@/components/ui";
import { Brand } from "@/components/Brand";
import { api } from "@/lib/api";
import { isStaff, useAuth } from "@/lib/auth";

interface SessionVerifyResponse {
  success: boolean;
  sessionAccessToken: string;
  sessionId: string;
  sessionName: string;
  examId: string;
  examTitle: string;
  durationMinutes: number;
  activeAttemptId: string | null;
  sections: { id: string; title: string; timeLimitMinutes: number | null }[];
  candidate: { id: string; name: string; email: string };
}

export default function SessionAccess() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [sessionCode, setSessionCode] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user && isStaff(user)) {
    return <Navigate to="/admin" replace />;
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionCode.trim() || !identifier.trim()) {
      setError("Please enter both the session code and your email or candidate ID.");
      return;
    }
    setError(null);
    setLoading(true);

    try {
      const res = await api<SessionVerifyResponse>("/sessions/verify", {
        method: "POST",
        body: {
          sessionCode: sessionCode.trim(),
          identifier: identifier.trim(),
        },
      });

      // If active attempt is already in progress, redirect straight into ExamRoom
      if (res.activeAttemptId) {
        nav(`/exam/${res.activeAttemptId}`);
      } else {
        // Direct candidate into Exam Lobby with session pre-authenticated
        nav(`/candidate/exams/${res.examId}`);
      }
    } catch (err) {
      setError((err as Error).message || "Verification failed. Please check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-sand-50 flex flex-col justify-between selection:bg-navy-900 selection:text-white">
      {/* Top Header */}
      <header className="border-b border-line bg-white/80 backdrop-blur-sm sticky top-0 z-10 px-6 py-3.5 flex items-center justify-between">
        <Brand />
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-block text-[11px] font-mono uppercase tracking-wider text-ink-500 bg-sand-100 px-2.5 py-1 rounded border border-line">
            Zero-Trust Assessment Portal
          </span>
          <Link to="/login">
            <Button variant="secondary" size="sm" className="font-semibold text-navy-900 border-navy-900/20 hover:bg-navy-50">
              <LogIn className="h-3.5 w-3.5 mr-1.5" /> Staff / Admin Login
            </Button>
          </Link>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-white rounded-xl shadow-lg border border-line p-6 sm:p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center p-3 bg-navy-900 text-white rounded-xl shadow-md mb-2">
              <KeyRound className="h-6 w-6" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-navy-900 tracking-tight">
              Zanvar Group | Online Assessment
            </h1>
            <p className="text-xs sm:text-sm text-ink-500 max-w-xs mx-auto">
              Welcome to the Zanvar Group Talent Assessment Portal. Enter your examination session code to continue.
            </p>
          </div>

          {error && (
            <Alert tone="bad">
              {error}
            </Alert>
          )}

          <form onSubmit={handleVerify} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-ink-700 uppercase tracking-wider mb-1.5">
                Examination Session Code
              </label>
              <div className="relative">
                <Input
                  className="font-mono text-center text-lg tracking-widest uppercase font-bold py-2.5 bg-sand-50/50 border-line-strong focus:border-navy-900"
                  placeholder="e.g. ZG-TECH-8472"
                  value={sessionCode}
                  onChange={(e) => setSessionCode(e.target.value.toUpperCase())}
                  required
                  autoFocus
                />
              </div>
              <span className="text-[11px] text-ink-400 mt-1 block">
                Provided in your Zanvar recruitment invitation email.
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink-700 uppercase tracking-wider mb-1.5">
                Registered Email or Candidate ID
              </label>
              <Input
                type="text"
                placeholder="name@example.com or ZV-1234"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
            </div>

            <Button
              type="submit"
              size="lg"
              className="w-full text-sm font-semibold py-3 mt-2"
              loading={loading}
            >
              Verify & Continue <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </form>

          {/* Security Guarantee Box */}
          <div className="p-3 bg-sand-50/80 rounded-lg border border-line text-[11.5px] text-ink-600 space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-navy-900">
              <ShieldCheck className="h-4 w-4 text-emerald-700 shrink-0" />
              <span>Secure Session Verification</span>
            </div>
            <p className="leading-snug text-ink-500">
              Session codes verify candidate assignment, schedule window, capacity, and anti-cheat telemetry safeguards before examination lobby entry.
            </p>
          </div>

          {/* Staff Login Link */}
          <div className="pt-2 border-t border-line text-center space-y-1">
            <div className="text-xs text-ink-500">
              Are you an Administrator, Proctor or HR Staff?
            </div>
            <Link to="/login" className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-navy-900 hover:text-navy-700 hover:underline">
              <LogIn className="h-3.5 w-3.5" /> Sign in to Admin & Superadmin Portal →
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-4 border-t border-line text-center text-xs text-ink-400 bg-white">
        © {new Date().getFullYear()} Zanvar Group Human Resources & Talent Assessment. All rights reserved.
      </footer>
    </div>
  );
}

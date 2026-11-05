import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ArrowRight, LogIn } from "lucide-react";
import { Alert, Button, Input } from "@/components/ui";
import { Brand, BrandMark } from "@/components/Brand";
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
      <header className="border-b border-line bg-white px-6 py-3.5 flex items-center justify-between">
        <Brand />
        <Link to="/login">
          <Button variant="secondary" size="sm" className="font-medium text-navy-900 border-line hover:bg-sand-50">
            <LogIn className="h-3.5 w-3.5 mr-1.5" /> Staff Login
          </Button>
        </Link>
      </header>

      {/* Main Container */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-white rounded-xl shadow-sm border border-line p-6 sm:p-8 space-y-6">
          {/* Zanvar Group Logo on left with ZANVAR GROUP text to its right */}
          <div className="flex items-center justify-center gap-3">
            <BrandMark className="h-9 w-9" />
            <div className="text-left">
              <div className="text-base font-bold tracking-[0.16em] text-navy-900">ZANVAR GROUP</div>
              <div className="text-[11px] font-medium tracking-[0.06em] uppercase text-ink-500">Talent Assessment Portal</div>
            </div>
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
              <Input
                className="font-mono text-center text-lg tracking-widest uppercase font-bold py-2.5 bg-sand-50/50 border-line focus:border-navy-900"
                placeholder="e.g. ZG-TECH-8472"
                value={sessionCode}
                onChange={(e) => setSessionCode(e.target.value.toUpperCase())}
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink-700 uppercase tracking-wider mb-1.5">
                Registered Email or Candidate ID
              </label>
              <Input
                type="text"
                placeholder="name@example.com or Candidate ID"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
            </div>

            <Button
              type="submit"
              size="lg"
              className="w-full text-sm font-semibold py-2.5 mt-2"
              loading={loading}
            >
              Verify & Continue <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </form>

          {/* Minimal Staff/Admin Login Link */}
          <div className="pt-3 border-t border-line text-center">
            <Link to="/login" className="text-xs text-ink-500 hover:text-navy-900 font-medium transition-colors">
              Staff / Admin Sign In →
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-4 border-t border-line text-center text-xs text-ink-400 bg-white">
        © {new Date().getFullYear()} Zanvar Group. All rights reserved.
      </footer>
    </div>
  );
}

import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import AuthLayout from "@/layouts/AuthLayout";
import { Alert, Button, Field, Input } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { GoogleButton } from "@/components/GoogleButton";
import { googleSignIn, loginWithGoogle } from "@/lib/google";

export default function Login() {
  const { login, refresh } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gBusy, setGBusy] = useState(false);
  const go = (role: string) => nav(next && next.startsWith("/") ? next : role === "CANDIDATE" ? "/candidate" : "/admin", { replace: true });
  const google = async () => {
    setError(null);
    setGBusy(true);
    try {
      const g = await googleSignIn();
      if (!g) return;
      const r = await loginWithGoogle(g.idToken);
      if ("user" in r) {
        await refresh();
        go(r.user.role);
      } else {
        // New person: finish registration with the Google account (email already verified by Google)
        nav(`/register${loc.search}`, { state: { google: { email: r.email, name: r.name } } });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGBusy(false);
    }
  };
  const next = new URLSearchParams(loc.search).get("next");

  return (
    <AuthLayout>
      <h2 className="text-[22px] font-semibold">Sign in</h2>
      <p className="mt-1 text-[13.5px] text-ink-500">Candidates and Zanvar HR staff sign in here.</p>
      <div className="mt-6">
        <GoogleButton onClick={google} busy={gBusy} />
      </div>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const u = await login(email.trim(), password);
            go(u.role);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Email address">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-[12.5px] font-medium text-steel-600 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Sign in
        </Button>
      </form>

      {/* Quick Role Fill Presets for Local Testing */}
      <div className="mt-4 p-3 bg-sand-50 rounded-lg border border-line text-xs">
        <div className="text-[11px] font-semibold text-ink-500 uppercase tracking-wider mb-2">
          Quick Demo Credentials:
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="px-2 py-1 rounded bg-navy-900 text-white font-medium text-[11px] hover:bg-navy-800 transition-colors"
            onClick={() => {
              setEmail("superadmin@zanvargroup.com");
              setPassword("Admin@2026");
            }}
          >
            Super Admin
          </button>
          <button
            type="button"
            className="px-2 py-1 rounded bg-navy-800 text-white font-medium text-[11px] hover:bg-navy-700 transition-colors"
            onClick={() => {
              setEmail("hr@zanvargroup.com");
              setPassword("Hr@2026");
            }}
          >
            HR Admin
          </button>
          <button
            type="button"
            className="px-2 py-1 rounded bg-sand-200 text-ink-800 font-medium text-[11px] hover:bg-sand-300 transition-colors"
            onClick={() => {
              setEmail("candidate@example.com");
              setPassword("Candidate@2026");
            }}
          >
            Candidate
          </button>
        </div>
      </div>

      <div className="mt-6 border-t border-line pt-4 space-y-2 text-[13px] text-ink-500">
        <div>
          Have an examination session code?{" "}
          <Link to="/session" className="font-semibold text-navy-900 hover:underline">
            Enter Session Code →
          </Link>
        </div>
        <div>
          New candidate?{" "}
          <Link to={`/register${loc.search}`} className="font-medium text-navy-900 hover:underline">
            Create your account
          </Link>
        </div>
      </div>
    </AuthLayout>
  );
}

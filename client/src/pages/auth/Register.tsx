import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { FileUp } from "lucide-react";
import AuthLayout from "@/layouts/AuthLayout";
import { Alert, Button, Checkbox, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { GoogleButton } from "@/components/GoogleButton";
import { currentGoogleIdToken, googleSignIn, googleSignOut, loginWithGoogle } from "@/lib/google";

const DEGREES = ["B.E.", "B.Tech", "Diploma", "M.E.", "M.Tech", "B.Sc", "M.Sc", "BCA", "MCA", "MBA", "ITI", "Other"];
const YEARS = ["First Year", "Second Year", "Third Year", "Final Year", "Graduated"];

export default function Register() {
  const [params] = useSearchParams();
  const { refresh } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  // Set when the person came from "Continue with Google" (email already verified by Google)
  const [google, setGoogle] = useState<{ email: string; name: string } | null>((loc.state as { google?: { email: string; name: string } } | null)?.google ?? null);
  const [gBusy, setGBusy] = useState(false);
  const [form, setForm] = useState({ name: google?.name ?? "", email: google?.email ?? "", password: "", confirm: "", mobile: "", college: "", degree: "B.E.", branch: "", currentYear: "Final Year", graduationYear: String(new Date().getFullYear() + 1), invitationCode: params.get("code") ?? "" });
  const [resume, setResume] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ inviteMessage: string | null; devVerifyUrl?: string } | null>(null);
  const [privacy, setPrivacy] = useState<string>("");
  useEffect(() => {
    api<{ privacyNotice: string }>("/settings/public").then((s) => setPrivacy(s.privacyNotice)).catch(() => undefined);
  }, []);
  const startGoogle = async () => {
    setError(null);
    setGBusy(true);
    try {
      const g = await googleSignIn();
      if (!g) return;
      const r = await loginWithGoogle(g.idToken);
      if ("user" in r) {
        // Already registered — signed straight in
        await refresh();
        nav(r.user.role === "CANDIDATE" ? "/candidate" : "/admin", { replace: true });
        return;
      }
      setGoogle({ email: r.email, name: r.name });
      setForm((f) => ({ ...f, email: r.email, name: f.name || r.name, password: "", confirm: "" }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGBusy(false);
    }
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  if (done) {
    return (
      <AuthLayout>
        <h2 className="text-[22px] font-semibold">Account created</h2>
        <p className="mt-2 text-[13.5px] text-ink-700">
          {google ? (
            <>Your account is linked to the Google account <b>{form.email}</b>. Next time, just use <b>Continue with Google</b> to sign in.</>
          ) : (
            <>We have sent a verification link to <b>{form.email}</b>. Verify your email before starting an examination.</>
          )}
        </p>
        {done.inviteMessage && <Alert className="mt-4" tone={done.inviteMessage.startsWith("Account created, but") ? "warn" : "ok"}>{done.inviteMessage}</Alert>}
        {done.devVerifyUrl && (
          <Alert className="mt-4" tone="navy" title="Development mode">
            Email is not configured, so here is your verification link: <a className="underline break-all" href={done.devVerifyUrl}>verify email</a>
          </Alert>
        )}
        <Button className="mt-6 w-full" size="lg" onClick={() => nav("/candidate")}>
          Continue to my examinations
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout wide>
      <h2 className="text-[22px] font-semibold">Candidate registration</h2>
      <p className="mt-1 text-[13.5px] text-ink-500">
        Already registered? <Link to="/login" className="font-medium text-navy-900 hover:underline">Sign in</Link>
      </p>
      <div className="mt-6 max-w-sm">
        {!google && <GoogleButton onClick={startGoogle} busy={gBusy} label="Register with Google" />}
      </div>
      {google && (
        <Alert tone="ok" className="mb-5">
          Registering with the Google account <b>{google.email}</b> — no password needed. Fill in your details below.{" "}
          <button type="button" className="font-medium underline" onClick={() => { void googleSignOut(); setGoogle(null); setForm((f) => ({ ...f, email: "" })); }}>
            Use a password instead
          </button>
        </Alert>
      )}
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          if (!google && form.password !== form.confirm) return setError("Passwords do not match");
          if (!consent) return setError("Please accept the privacy notice to continue");
          setBusy(true);
          try {
            const fd = new FormData();
            Object.entries(form).forEach(([k, v]) => k !== "confirm" && !(google && k === "password") && fd.append(k, v));
            if (google) {
              const token = await currentGoogleIdToken();
              if (!token) {
                setGoogle(null);
                throw new Error("Your Google sign-in has expired. Click Continue with Google again, or choose a password.");
              }
              fd.append("googleIdToken", token);
            }
            fd.append("consent", "true");
            if (resume) fd.append("resume", resume);
            const r = await api<{ inviteMessage: string | null; devVerifyUrl?: string }>("/auth/register", { form: fd });
            await refresh();
            if (google) await googleSignOut();
            setDone(r);
          } catch (err) {
            setError((err as Error).message);
            window.scrollTo({ top: 0, behavior: "smooth" });
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <Alert tone="bad">{error}</Alert>}
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="label-caps mb-3">Personal details</legend>
          <Field label="Full name" required className="sm:col-span-2"><Input required value={form.name} onChange={set("name")} autoComplete="name" /></Field>
          <Field label="Email" required hint={google ? "From your Google account" : undefined}><Input type="email" required value={form.email} onChange={set("email")} autoComplete="email" readOnly={!!google} className={google ? "bg-canvas text-ink-500" : undefined} /></Field>
          <Field label="Mobile number" required><Input required inputMode="tel" placeholder="10-digit mobile" value={form.mobile} onChange={set("mobile")} /></Field>
          {!google && (
            <>
              <Field label="Password" required hint="At least 8 characters with a letter and a number"><Input type="password" required minLength={8} value={form.password} onChange={set("password")} autoComplete="new-password" /></Field>
              <Field label="Confirm password" required><Input type="password" required value={form.confirm} onChange={set("confirm")} autoComplete="new-password" /></Field>
            </>
          )}
        </fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="label-caps mb-3">Education</legend>
          <Field label="College / University" required className="sm:col-span-2"><Input required value={form.college} onChange={set("college")} /></Field>
          <Field label="Degree" required>
            <Select value={form.degree} onChange={set("degree")}>{DEGREES.map((d) => <option key={d}>{d}</option>)}</Select>
          </Field>
          <Field label="Branch / Specialisation" required><Input required placeholder="e.g. Mechanical Engineering" value={form.branch} onChange={set("branch")} /></Field>
          <Field label="Current year" required>
            <Select value={form.currentYear} onChange={set("currentYear")}>{YEARS.map((d) => <option key={d}>{d}</option>)}</Select>
          </Field>
          <Field label="Graduation year" required><Input type="number" min={2000} max={2040} required value={form.graduationYear} onChange={set("graduationYear")} /></Field>
        </fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="label-caps mb-3">Application</legend>
          <Field label="Resume" hint="PDF or Word, up to 5 MB">
            <label className="flex h-9 cursor-pointer items-center gap-2 rounded border border-dashed border-line-strong bg-white px-3 text-[13px] text-ink-700 hover:border-navy-500/50">
              <FileUp className="h-4 w-4 text-ink-400" />
              <span className="truncate">{resume ? resume.name : "Choose file…"}</span>
              <input type="file" className="hidden" accept=".pdf,.doc,.docx" onChange={(e) => setResume(e.target.files?.[0] ?? null)} />
            </label>
          </Field>
          <Field label="Examination invitation code" hint="From your invitation email or campus notice">
            <Input value={form.invitationCode} onChange={(e) => setForm({ ...form, invitationCode: e.target.value.toUpperCase() })} placeholder="e.g. GET-MECH-2026" className="font-mono uppercase" />
          </Field>
        </fieldset>
        <div className="rounded border border-line bg-white p-3.5">
          <div className="label-caps mb-1.5">Privacy notice</div>
          <p className="max-h-32 overflow-y-auto pr-2 text-[12.5px] leading-relaxed text-ink-700 scrollbar-thin">{privacy || "Loading…"}</p>
          <Checkbox className="mt-3" checked={consent} onChange={(e) => setConsent(e.target.checked)} label="I have read the privacy notice and consent to Zanvar Group processing my registration data for recruitment." />
        </div>
        <Button type="submit" size="lg" className="w-full sm:w-auto" loading={busy}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}

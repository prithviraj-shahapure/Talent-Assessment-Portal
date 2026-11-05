import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import AuthLayout from "@/layouts/AuthLayout";
import { Alert, Button, Field, Input } from "@/components/ui";
import { api } from "@/lib/api";

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<{ devResetUrl?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthLayout>
      <h2 className="text-[22px] font-semibold">Reset password</h2>
      {sent ? (
        <>
          <Alert className="mt-5" tone="ok">If an account exists for {email}, a reset link has been sent. It is valid for one hour.</Alert>
          {sent.devResetUrl && <Alert className="mt-3" tone="navy" title="Development mode"><a className="underline" href={sent.devResetUrl}>Open reset link</a></Alert>}
        </>
      ) : (
        <form
          className="mt-6 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              setSent(await api("/auth/forgot-password", { body: { email } }));
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {error && <Alert tone="bad">{error}</Alert>}
          <Field label="Email address"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
          <Button type="submit" size="lg" className="w-full" loading={busy}>Send reset link</Button>
        </form>
      )}
      <Link to="/login" className="mt-6 inline-block text-[13px] font-medium text-steel-600 hover:underline">Back to sign in</Link>
    </AuthLayout>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthLayout>
      <h2 className="text-[22px] font-semibold">Choose a new password</h2>
      <form
        className="mt-6 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (pw !== pw2) return setError("Passwords do not match");
          setBusy(true);
          setError(null);
          try {
            await api("/auth/reset-password", { body: { token: params.get("token"), password: pw } });
            nav("/login");
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="New password" hint="At least 8 characters with a letter and a number"><Input type="password" required value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label="Confirm password"><Input type="password" required value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
        <Button type="submit" size="lg" className="w-full" loading={busy}>Update password</Button>
      </form>
    </AuthLayout>
  );
}

import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, XCircle } from "lucide-react";
import AuthLayout from "@/layouts/AuthLayout";
import { Button, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const { refresh, user } = useAuth();
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [msg, setMsg] = useState("");
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    api("/auth/verify-email", { body: { token: params.get("token") ?? "" } })
      .then(async () => {
        setState("ok");
        await refresh();
      })
      .catch((e) => {
        setState("error");
        setMsg(e.message);
      });
  }, [params, refresh]);
  return (
    <AuthLayout>
      {state === "loading" && <Spinner label="Verifying your email…" />}
      {state === "ok" && (
        <div>
          <CheckCircle2 className="h-10 w-10 text-ok-600" />
          <h2 className="mt-3 text-[22px] font-semibold">Email verified</h2>
          <p className="mt-1 text-[13.5px] text-ink-500">Your account is active. You can now take your assigned examinations.</p>
          <Link to={user ? "/candidate" : "/login"}><Button className="mt-6 w-full" size="lg">Continue</Button></Link>
        </div>
      )}
      {state === "error" && (
        <div>
          <XCircle className="h-10 w-10 text-bad-600" />
          <h2 className="mt-3 text-[22px] font-semibold">Verification failed</h2>
          <p className="mt-1 text-[13.5px] text-ink-500">{msg}. Sign in and request a new link from your dashboard.</p>
          <Link to="/login"><Button className="mt-6 w-full" size="lg" variant="secondary">Go to sign in</Button></Link>
        </div>
      )}
    </AuthLayout>
  );
}

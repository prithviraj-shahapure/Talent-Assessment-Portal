import { useEffect, useState } from "react";
import { FileUp } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/lib/auth";
import { Alert, Button, Card, Field, Input, PageHeader, Spinner, StageBadge, useToast } from "@/components/ui";
import type { PipelineStage } from "@/lib/types";

interface P { mobile: string; college: string; degree: string; branch: string; currentYear: string; graduationYear: number; resumeName: string | null; hasResume: boolean; stage: PipelineStage; user: { name: string; email: string; emailVerified: boolean } }

export default function Profile() {
  const toast = useToast();
  const { refresh } = useAuth();
  const { data, loading, reload } = useApi<P>("/me/profile");
  const [f, setF] = useState<Omit<P, "resumeName" | "hasResume" | "stage" | "user"> & { name: string } | null>(null);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setF({ name: data.user.name, mobile: data.mobile, college: data.college, degree: data.degree, branch: data.branch, currentYear: data.currentYear, graduationYear: data.graduationYear });
  }, [data]);
  if (loading || !data || !f) return <Spinner />;
  return (
    <div>
      <PageHeader title="My profile" subtitle={data.user.email} actions={<StageBadge stage={data.stage} />} />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <Card title="Personal & education details">
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await api("/me/profile", { method: "PUT", body: { ...f, graduationYear: Number(f.graduationYear) } });
                toast("Profile updated");
                refresh();
                reload();
              } catch (err) {
                toast((err as Error).message, "bad");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Full name" className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Mobile"><Input value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></Field>
            <Field label="College / University"><Input value={f.college} onChange={(e) => setF({ ...f, college: e.target.value })} /></Field>
            <Field label="Degree"><Input value={f.degree} onChange={(e) => setF({ ...f, degree: e.target.value })} /></Field>
            <Field label="Branch"><Input value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })} /></Field>
            <Field label="Current year"><Input value={f.currentYear} onChange={(e) => setF({ ...f, currentYear: e.target.value })} /></Field>
            <Field label="Graduation year"><Input type="number" value={f.graduationYear} onChange={(e) => setF({ ...f, graduationYear: Number(e.target.value) })} /></Field>
            <div className="sm:col-span-2"><Button type="submit" loading={busy}>Save profile</Button></div>
          </form>
        </Card>
        <div className="space-y-5">
          <Card title="Resume">
            {data.hasResume ? <p className="mb-3 text-[13px]">Current: <b>{data.resumeName}</b></p> : <Alert tone="warn" className="mb-3">No resume uploaded yet.</Alert>}
            <label className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded border border-line-strong bg-white text-[13px] font-medium hover:bg-navy-50">
              <FileUp className="h-4 w-4" /> {data.hasResume ? "Replace resume" : "Upload resume"}
              <input
                type="file"
                className="hidden"
                accept=".pdf,.doc,.docx"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const fd = new FormData();
                  fd.append("resume", file);
                  try {
                    await api("/me/resume", { form: fd });
                    toast("Resume uploaded");
                    reload();
                  } catch (err) {
                    toast((err as Error).message, "bad");
                  }
                }}
              />
            </label>
            <p className="mt-2 text-[12px] text-ink-500">PDF or Word, up to 5 MB.</p>
          </Card>
          <Card title="Change password">
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api("/auth/change-password", { body: pw });
                  toast("Password changed");
                  setPw({ currentPassword: "", newPassword: "" });
                } catch (err) {
                  toast((err as Error).message, "bad");
                }
              }}
            >
              <Field label="Current password"><Input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
              <Field label="New password"><Input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
              <Button type="submit" variant="secondary" disabled={!pw.currentPassword || pw.newPassword.length < 8}>Change password</Button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}

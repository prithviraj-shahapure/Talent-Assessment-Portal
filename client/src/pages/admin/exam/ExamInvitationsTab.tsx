import { useState } from "react";
import { Copy, Link2, Mail, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { Alert, Badge, Button, Card, Checkbox, Dialog, EmptyState, Field, Input, Spinner, Tabs, Textarea, useToast } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import type { Exam } from "@/lib/types";
import { toLocalInput } from "./ExamSettingsForm";

interface Invitation { id: string; code: string; email: string | null; maxUses: number; usedCount: number; expiresAt: string | null; createdAt: string; createdBy: { name: string } | null }

export function ExamInvitationsTab({ exam, reload }: { exam: Exam; reload: () => void }) {
  const toast = useToast();
  const { data, loading, reload: reloadInv } = useApi<Invitation[]>(`/exams/${exam.id}/invitations`);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"shared" | "personal">("shared");
  const [maxUses, setMaxUses] = useState(100);
  const [expiresAt, setExpiresAt] = useState(toLocalInput(exam.endAt));
  const [emails, setEmails] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const copy = (text: string, what = "Copied") => navigator.clipboard.writeText(text).then(() => toast(what));
  const registerUrl = (code: string) => `${window.location.origin}/register?code=${code}`;

  return (
    <div className="space-y-4">
      {exam.status !== "PUBLISHED" && <Alert tone="warn">Invitation codes only work once the examination is published.</Alert>}
      <Card
        padded={false}
        title="Invitation codes"
        subtitle="Candidates enter a code at registration (or from their dashboard) to be assigned to this examination. Eligibility rules are checked on use."
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Generate invitations
          </Button>
        }
      >
        {loading ? (
          <Spinner />
        ) : !data?.length ? (
          <EmptyState icon={<Link2 className="h-7 w-7" />} title="No invitations yet" body="Create a shared code for a campus drive, or personal invitations sent by email." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Type</th>
                  <th className="text-right">Used</th>
                  <th>Expires</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((inv) => {
                  const expired = inv.expiresAt && new Date(inv.expiresAt) < new Date();
                  const full = inv.usedCount >= inv.maxUses;
                  return (
                    <tr key={inv.id}>
                      <td>
                        <span className="font-mono text-[13px] font-medium">{inv.code}</span>
                        {(expired || full) && (
                          <Badge tone="neutral" className="ml-2">
                            {expired ? "Expired" : "Used up"}
                          </Badge>
                        )}
                      </td>
                      <td className="text-[12.5px]">{inv.email ? <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5 text-ink-400" />{inv.email}</span> : "Shared code"}</td>
                      <td className="num text-right">
                        {inv.usedCount} / {inv.maxUses}
                      </td>
                      <td className="text-[12.5px]">{inv.expiresAt ? fmtDateTime(inv.expiresAt) : "—"}</td>
                      <td className="text-[12.5px] text-ink-500">
                        {fmtDateTime(inv.createdAt)}
                        {inv.createdBy && <div>{inv.createdBy.name}</div>}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => copy(inv.code, "Code copied")} title="Copy code">
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => copy(registerUrl(inv.code), "Registration link copied")} title="Copy registration link">
                          <Link2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Revoke"
                          onClick={async () => {
                            await api(`/exams/invitations/${inv.id}`, { method: "DELETE" });
                            toast("Invitation revoked");
                            reloadInv();
                            reload();
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Generate invitations"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const list = emails.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
                  const r = await api<Invitation[]>(`/exams/${exam.id}/invitations`, { body: { mode, maxUses, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null, emails: list, sendEmail } });
                  toast(mode === "shared" ? `Code ${r[0].code} created` : `${r.length} invitation(s) created${sendEmail ? " and emailed" : ""}`);
                  setOpen(false);
                  setEmails("");
                  reloadInv();
                  reload();
                } catch (e) {
                  toast((e as Error).message, "bad");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Generate
            </Button>
          </>
        }
      >
        <Tabs
          className="mb-4"
          value={mode}
          onChange={setMode}
          items={[
            { value: "shared", label: "Shared code" },
            { value: "personal", label: "Personal email invitations" },
          ]}
        />
        <div className="space-y-3">
          {mode === "shared" ? (
            <Field label="Maximum uses" hint="e.g. the expected number of candidates in a campus drive">
              <Input type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))} />
            </Field>
          ) : (
            <>
              <Field label="Candidate email addresses" hint="One per line, or separated by commas. Existing candidates are assigned directly.">
                <Textarea rows={6} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder={"student1@college.edu\nstudent2@college.edu"} className="font-mono text-[12.5px]" />
              </Field>
              <Checkbox checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} label="Email each candidate their personal code and registration link" />
            </>
          )}
          <Field label="Expires at">
            <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

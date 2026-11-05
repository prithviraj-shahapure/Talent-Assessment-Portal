import { useEffect, useState } from "react";
import { Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/lib/auth";
import { Alert, Button, Card, Field, Input, PageHeader, Select, Spinner, Switch, Tabs, Textarea, useToast } from "@/components/ui";
import { EVENT_LABEL } from "@/lib/format";
import type { Department } from "@/lib/types";

interface Rule { label: string; weight: number; cooldownSec: number; maxContribution: number; graceCount: number; severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" }
interface S {
  organisationName: string;
  riskRules: Record<string, Rule>;
  riskThresholds: { low: number; medium: number; high: number };
  faceMissingSeconds: number;
  lookingAwaySeconds: number;
  audioThreshold: number;
  evidenceRetentionDays: number;
  verificationPhotoRetentionDays: number;
  privacyPolicyVersion: string;
  privacyNotice: string;
  livePreviewIntervalSec: number;
  allowSelfRegistrationWithoutInvite: boolean;
}

export default function Settings() {
  const { user } = useAuth();
  const toast = useToast();
  const canEdit = user?.role === "SUPER_ADMIN";
  const { data, loading } = useApi<{ settings: S; defaults: { riskRules: Record<string, Rule> } }>("/settings");
  const [s, setS] = useState<S | null>(null);
  const [tab, setTab] = useState<"risk" | "privacy" | "general" | "departments">("risk");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setS(data.settings);
  }, [data]);
  if (loading || !s || !data) return <Spinner />;

  const save = async () => {
    setBusy(true);
    try {
      const r = await api<{ settings: S }>("/settings", { method: "PUT", body: s });
      setS(r.settings);
      toast("Settings saved");
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const setRule = (k: string, patch: Partial<Rule>) => setS({ ...s, riskRules: { ...s.riskRules, [k]: { ...s.riskRules[k], ...patch } } });
  const num = (v: string) => (v === "" ? 0 : Number(v));

  return (
    <div>
      <PageHeader
        title="System Settings"
        subtitle={canEdit ? "Proctoring rules, privacy and retention, and organisation settings." : "Read-only — only a Super Admin can change settings."}
        actions={canEdit && tab !== "departments" && <Button loading={busy} onClick={save}><Save className="h-4 w-4" /> Save changes</Button>}
      />
      <Tabs className="mb-5" value={tab} onChange={setTab} items={[{ value: "risk", label: "Risk engine" }, { value: "privacy", label: "Privacy & retention" }, { value: "general", label: "General" }, { value: "departments", label: "Departments" }]} />
      <fieldset disabled={!canEdit} className="contents">
        {tab === "risk" && (
          <div className="space-y-5">
            <Alert tone="navy" title="How the advisory risk score works">
              Each event type adds its <b>weight</b> to the attempt's score, but only after the <b>grace count</b> (tolerated occurrences), never twice within the <b>cooldown</b>, and never beyond the type's <b>cap</b>. The total is capped at 100. Scores support human review — no candidate is disqualified automatically.
            </Alert>
            <Card title="Concern thresholds">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Low concern from"><Input type="number" value={s.riskThresholds.low} onChange={(e) => setS({ ...s, riskThresholds: { ...s.riskThresholds, low: num(e.target.value) } })} /></Field>
                <Field label="Medium concern from"><Input type="number" value={s.riskThresholds.medium} onChange={(e) => setS({ ...s, riskThresholds: { ...s.riskThresholds, medium: num(e.target.value) } })} /></Field>
                <Field label="High concern from"><Input type="number" value={s.riskThresholds.high} onChange={(e) => setS({ ...s, riskThresholds: { ...s.riskThresholds, high: num(e.target.value) } })} /></Field>
              </div>
              <div className="mt-3 flex h-2.5 overflow-hidden rounded-sm text-[0px]">
                <div className="bg-ok-600" style={{ width: `${s.riskThresholds.low}%` }} />
                <div className="bg-steel-500" style={{ width: `${s.riskThresholds.medium - s.riskThresholds.low}%` }} />
                <div className="bg-warn-600" style={{ width: `${s.riskThresholds.high - s.riskThresholds.medium}%` }} />
                <div className="bg-bad-600 flex-1" />
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-ink-500 num"><span>0 Normal</span><span>100</span></div>
            </Card>
            <Card title="Event weights" padded={false} actions={canEdit && <Button size="sm" variant="ghost" onClick={() => setS({ ...s, riskRules: data.defaults.riskRules })}><RotateCcw className="h-3.5 w-3.5" /> Restore defaults</Button>}>
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead><tr><th>Event</th><th>Severity</th><th className="text-right">Weight</th><th className="text-right">Grace count</th><th className="text-right">Cooldown (s)</th><th className="text-right">Cap</th></tr></thead>
                  <tbody>
                    {Object.entries(s.riskRules).map(([k, r]) => (
                      <tr key={k}>
                        <td><div className="font-medium">{EVENT_LABEL[k] ?? k}</div><div className="text-[11.5px] text-ink-500">{r.label}</div></td>
                        <td>
                          <Select className="h-8 w-28" value={r.severity} onChange={(e) => setRule(k, { severity: e.target.value as Rule["severity"] })}>
                            {["INFO", "LOW", "MEDIUM", "HIGH"].map((x) => <option key={x}>{x}</option>)}
                          </Select>
                        </td>
                        {(["weight", "graceCount", "cooldownSec", "maxContribution"] as const).map((f) => (
                          <td key={f} className="text-right"><Input type="number" min={0} className="num ml-auto h-8 w-20 text-right" value={r[f]} onChange={(e) => setRule(k, { [f]: num(e.target.value) })} /></td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="Detection sensitivity">
              <div className="grid gap-4 sm:grid-cols-4">
                <Field label="Face missing after (s)" hint="Continuous absence before flagging"><Input type="number" value={s.faceMissingSeconds} onChange={(e) => setS({ ...s, faceMissingSeconds: num(e.target.value) })} /></Field>
                <Field label="Looking away after (s)"><Input type="number" value={s.lookingAwaySeconds} onChange={(e) => setS({ ...s, lookingAwaySeconds: num(e.target.value) })} /></Field>
                <Field label="Audio level threshold" hint="0.01–1 (RMS). Higher = less sensitive"><Input type="number" step="0.01" value={s.audioThreshold} onChange={(e) => setS({ ...s, audioThreshold: Number(e.target.value) })} /></Field>
                <Field label="Live preview interval (s)"><Input type="number" value={s.livePreviewIntervalSec} onChange={(e) => setS({ ...s, livePreviewIntervalSec: num(e.target.value) })} /></Field>
              </div>
            </Card>
          </div>
        )}
        {tab === "privacy" && (
          <div className="space-y-5">
            <Card title="Privacy notice" subtitle="Shown at registration and before every proctored examination. Change the version when the text changes — consent is recorded against it.">
              <Field label="Policy version" className="mb-3 max-w-xs"><Input value={s.privacyPolicyVersion} onChange={(e) => setS({ ...s, privacyPolicyVersion: e.target.value })} /></Field>
              <Textarea rows={12} value={s.privacyNotice} onChange={(e) => setS({ ...s, privacyNotice: e.target.value })} />
            </Card>
            <Card title="Retention" subtitle="Expired files are deleted automatically by the server.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Evidence snapshots (days)"><Input type="number" value={s.evidenceRetentionDays} onChange={(e) => setS({ ...s, evidenceRetentionDays: num(e.target.value) })} /></Field>
                <Field label="Verification photos (days)"><Input type="number" value={s.verificationPhotoRetentionDays} onChange={(e) => setS({ ...s, verificationPhotoRetentionDays: num(e.target.value) })} /></Field>
              </div>
              <p className="mt-3 text-[12px] text-ink-500">Changes apply to files captured after saving. Raw microphone audio is never recorded or stored.</p>
            </Card>
          </div>
        )}
        {tab === "general" && (
          <Card title="General">
            <Field label="Organisation name" className="max-w-md"><Input value={s.organisationName} onChange={(e) => setS({ ...s, organisationName: e.target.value })} /></Field>
            <div className="mt-3 max-w-xl"><Switch checked={s.allowSelfRegistrationWithoutInvite} onChange={(v) => setS({ ...s, allowSelfRegistrationWithoutInvite: v })} label="Allow registration without an invitation code" description="When off, candidates must enter a valid invitation code to register." /></div>
          </Card>
        )}
      </fieldset>
      {tab === "departments" && <Departments />}
    </div>
  );
}

function Departments() {
  const toast = useToast();
  const { user } = useAuth();
  const { data, reload } = useApi<Department[]>("/departments");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  return (
    <Card title="Departments" padded={false}>
      <form
        className="flex flex-wrap gap-2 border-b border-line p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/departments", { body: { name, code } });
            setName("");
            setCode("");
            reload();
          } catch (err) {
            toast((err as Error).message, "bad");
          }
        }}
      >
        <Input className="w-64" placeholder="Department name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input className="w-28 font-mono uppercase" placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} />
        <Button type="submit" disabled={name.length < 2 || code.length < 2}><Plus className="h-4 w-4" /> Add</Button>
      </form>
      <table className="table-base">
        <thead><tr><th>Name</th><th>Code</th><th className="text-right">Examinations</th><th className="text-right">Candidates</th><th /></tr></thead>
        <tbody>
          {data?.map((d) => (
            <tr key={d.id}>
              <td className="font-medium">{d.name}</td>
              <td className="font-mono text-[12.5px]">{d.code}</td>
              <td className="num text-right">{d._count?.exams}</td>
              <td className="num text-right">{d._count?.candidates}</td>
              <td className="text-right">
                {user?.role === "SUPER_ADMIN" && (
                  <Button size="sm" variant="ghost" onClick={async () => { try { await api(`/departments/${d.id}`, { method: "DELETE" }); reload(); } catch (e) { toast((e as Error).message, "bad"); } }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

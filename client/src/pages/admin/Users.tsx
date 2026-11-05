import { useState } from "react";
import { Plus, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/lib/auth";
import { Alert, Badge, Button, Card, Dialog, Field, Input, PageHeader, Select, Spinner, Switch, useToast } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import type { Paged, Role } from "@/lib/types";

interface Staff { id: string; name: string; email: string; role: Role; isActive: boolean; lastLoginAt: string | null; createdAt: string }

export default function Users() {
  const toast = useToast();
  const { user } = useAuth();
  const { data, loading, reload } = useApi<Paged<Staff>>("/users?pageSize=200");
  const [edit, setEdit] = useState<Partial<Staff> & { password?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (edit!.id) await api(`/users/${edit!.id}`, { method: "PATCH", body: { name: edit!.name, role: edit!.role, isActive: edit!.isActive, ...(edit!.password ? { password: edit!.password } : {}) } });
      else await api("/users", { body: { name: edit!.name, email: edit!.email, role: edit!.role, password: edit!.password } });
      toast("User saved");
      setEdit(null);
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Users & Roles"
        subtitle="Staff accounts with access to the administration console."
        actions={<Button onClick={() => setEdit({ role: "HR_ADMIN", isActive: true, name: "", email: "", password: "" })}><Plus className="h-4 w-4" /> Add user</Button>}
      />
      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <Card>
          <div className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-navy-700" /> Super Admin</div>
          <p className="mt-1 text-[12.5px] text-ink-500">Everything an HR Admin can do, plus user and role management, system settings, risk configuration, audit logs, evidence deletion and candidate data erasure.</p>
        </Card>
        <Card>
          <div className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-steel-600" /> HR Admin</div>
          <p className="mt-1 text-[12.5px] text-ink-500">Create and publish examinations, manage the question bank and candidates, send invitations, monitor live examinations, review flags, evaluate answers, view results and shortlist.</p>
        </Card>
      </div>
      <Card padded={false}>
        {loading ? (
          <Spinner />
        ) : (
          <table className="table-base">
            <thead>
              <tr><th>Name</th><th>Role</th><th>Status</th><th>Last sign-in</th><th>Created</th><th /></tr>
            </thead>
            <tbody>
              {data?.items.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="font-medium">{u.name} {u.id === user?.id && <span className="text-[12px] text-ink-400">(you)</span>}</div>
                    <div className="text-[12px] text-ink-500">{u.email}</div>
                  </td>
                  <td><Badge tone={u.role === "SUPER_ADMIN" ? "navy" : "steel"}>{u.role === "SUPER_ADMIN" ? "Super Admin" : "HR Admin"}</Badge></td>
                  <td>{u.isActive ? <Badge tone="ok" dot>Active</Badge> : <Badge tone="bad">Deactivated</Badge>}</td>
                  <td className="text-[12.5px] text-ink-500">{fmtDateTime(u.lastLoginAt)}</td>
                  <td className="text-[12.5px] text-ink-500">{fmtDateTime(u.createdAt)}</td>
                  <td className="text-right"><Button size="sm" variant="secondary" onClick={() => setEdit({ ...u, password: "" })}>Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? "Edit user" : "Add user"}
        size="sm"
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}
      >
        {edit && (
          <div className="space-y-3">
            {error && <Alert tone="bad">{error}</Alert>}
            <Field label="Full name" required><Input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Email" required><Input type="email" disabled={!!edit.id} value={edit.email ?? ""} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="Role">
              <Select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as Role })}>
                <option value="HR_ADMIN">HR Admin</option>
                <option value="SUPER_ADMIN">Super Admin</option>
              </Select>
            </Field>
            <Field label={edit.id ? "Reset password" : "Initial password"} required={!edit.id} hint="At least 8 characters with a letter and a number">
              <Input type="password" value={edit.password ?? ""} onChange={(e) => setEdit({ ...edit, password: e.target.value })} autoComplete="new-password" />
            </Field>
            {edit.id && <Switch checked={!!edit.isActive} onChange={(v) => setEdit({ ...edit, isActive: v })} label="Account active" disabled={edit.id === user?.id} />}
          </div>
        )}
      </Dialog>
    </div>
  );
}

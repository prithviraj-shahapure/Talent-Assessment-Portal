import { Fragment, useState } from "react";
import { Search } from "lucide-react";
import { qs } from "@/lib/api";
import { useApi, useDebounced } from "@/hooks/useApi";
import { Badge, Card, EmptyState, Input, PageHeader, Pagination, Select, Spinner, Toolbar } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import type { Paged } from "@/lib/types";

interface Log { id: string; action: string; entity: string | null; entityId: string | null; details: Record<string, unknown> | null; ipAddress: string | null; createdAt: string; user: { name: string; email: string; role: string } | null }

const ENTITIES = ["User", "Exam", "Question", "QuestionCategory", "CandidateProfile", "Attempt", "Answer", "ProctorEvent", "EvidenceFile", "Invitation", "AccommodationRequest", "SystemSetting", "Department"];

export default function Audit() {
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const da = useDebounced(action);
  const { data, loading } = useApi<Paged<Log>>(`/audit${qs({ action: da, entity, from, to, page, pageSize: 50 })}`, [da, entity, from, to, page]);
  const tone = (a: string) => (a.includes("delete") || a.includes("erase") || a.includes("failed") || a.includes("force") ? "bad" : a.includes("login") || a.includes("logout") ? "neutral" : a.includes("view") || a.includes("export") ? "steel" : "navy") as "bad" | "neutral" | "steel" | "navy";
  return (
    <div>
      <PageHeader title="Audit Logs" subtitle="Security-relevant actions: sign-ins, configuration changes, evaluations, data access and exports." />
      <Card padded={false}>
        <Toolbar>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" />
            <Input className="pl-8" placeholder="Action contains…" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} />
          </div>
          <Select className="w-full sm:w-52" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }}>
            <option value="">All entities</option>
            {ENTITIES.map((e) => <option key={e}>{e}</option>)}
          </Select>
          <Input type="date" className="w-full sm:w-40" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label="From date" />
          <Input type="date" className="w-full sm:w-40" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} aria-label="To date" />
        </Toolbar>
        {loading && !data ? (
          <Spinner />
        ) : !data?.items.length ? (
          <EmptyState title="No log entries" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>IP</th></tr></thead>
              <tbody>
                {data.items.map((l) => (
                  <Fragment key={l.id}>
                    <tr className="row-hover" onClick={() => setOpen(open === l.id ? null : l.id)}>
                      <td className="num whitespace-nowrap text-[12.5px]">{fmtDateTime(l.createdAt)}</td>
                      <td className="text-[12.5px]">{l.user ? <>{l.user.name}<div className="text-ink-500">{l.user.email}</div></> : <span className="text-ink-400">System</span>}</td>
                      <td><Badge tone={tone(l.action)} className="font-mono">{l.action}</Badge></td>
                      <td className="text-[12px] text-ink-500">{l.entity}{l.entityId && <div className="font-mono text-[11px]">{l.entityId}</div>}</td>
                      <td className="font-mono text-[12px] text-ink-500">{l.ipAddress ?? "—"}</td>
                    </tr>
                    {open === l.id && l.details && (
                      <tr><td colSpan={5} className="bg-canvas"><pre className="whitespace-pre-wrap font-mono text-[11.5px] text-ink-700">{JSON.stringify(l.details, null, 2)}</pre></td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
      </Card>
    </div>
  );
}

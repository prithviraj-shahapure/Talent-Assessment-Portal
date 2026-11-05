import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, FileText, Search, UsersRound } from "lucide-react";
import { download, qs } from "@/lib/api";
import { useApi, useDebounced } from "@/hooks/useApi";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Pagination, RiskBadge, Select, Spinner, StageBadge, Toolbar, useToast } from "@/components/ui";
import { fmtDate, fmtPct, STAGE_LABEL, STAGES } from "@/lib/format";
import type { Exam, Paged, PipelineStage } from "@/lib/types";

interface Row {
  id: string;
  mobile: string;
  college: string;
  degree: string;
  branch: string;
  graduationYear: number;
  stage: PipelineStage;
  createdAt: string;
  hasResume: boolean;
  bestPercentage: number | null;
  attemptsCount: number;
  highestRisk: string | null;
  user: { name: string; email: string; emailVerified: boolean; isActive: boolean };
  _count: { assignments: number };
}

export default function Candidates() {
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState({ q: "", stage: "", degree: "", graduationYear: "", examId: "", riskLevel: "", sort: "newest" });
  const [page, setPage] = useState(1);
  const dq = useDebounced(f.q);
  const params = { ...f, q: dq };
  const { data, loading } = useApi<Paged<Row>>(`/candidates${qs({ ...params, page, pageSize: 25 })}`, [JSON.stringify(params), page]);
  const { data: facets } = useApi<{ degrees: string[]; graduationYears: number[] }>("/candidates/facets");
  const { data: exams } = useApi<Exam[]>("/exams");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setF({ ...f, [k]: e.target.value });
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        title="Candidates"
        subtitle="Everyone who has registered on the portal."
        actions={
          <>
            <Button variant="secondary" onClick={() => download(`/candidates/export${qs({ ...params, format: "csv" })}`, "candidates.csv").catch((e) => toast(e.message, "bad"))}>
              <Download className="h-4 w-4" /> CSV
            </Button>
            <Button variant="secondary" onClick={() => download(`/candidates/export${qs(params)}`, "candidates.xlsx").catch((e) => toast(e.message, "bad"))}>
              <Download className="h-4 w-4" /> Excel
            </Button>
          </>
        }
      />
      <Card padded={false}>
        <Toolbar>
          <div className="relative w-full lg:w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" />
            <Input className="pl-8" placeholder="Name, email, mobile or college" value={f.q} onChange={set("q")} />
          </div>
          <Select className="w-full sm:w-44" value={f.stage} onChange={set("stage")}>
            <option value="">All stages</option>
            {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </Select>
          <Select className="w-full sm:w-56" value={f.examId} onChange={set("examId")}>
            <option value="">Any examination</option>
            {exams?.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </Select>
          <Select className="w-full sm:w-32" value={f.degree} onChange={set("degree")}>
            <option value="">Any degree</option>
            {facets?.degrees.map((d) => <option key={d}>{d}</option>)}
          </Select>
          <Select className="w-full sm:w-32" value={f.graduationYear} onChange={set("graduationYear")}>
            <option value="">Any year</option>
            {facets?.graduationYears.map((d) => <option key={d}>{d}</option>)}
          </Select>
          <Select className="w-full sm:w-40" value={f.riskLevel} onChange={set("riskLevel")}>
            <option value="">Any risk</option>
            <option value="LOW">Low concern</option>
            <option value="MEDIUM">Medium concern</option>
            <option value="HIGH">High concern</option>
          </Select>
          <Select className="w-full sm:w-32" value={f.sort} onChange={set("sort")}>
            <option value="newest">Newest</option>
            <option value="name">Name A–Z</option>
          </Select>
        </Toolbar>
        {loading && !data ? (
          <Spinner />
        ) : !data?.items.length ? (
          <EmptyState icon={<UsersRound className="h-7 w-7" />} title="No candidates match these filters" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>College</th>
                  <th>Degree</th>
                  <th className="text-right">Grad.</th>
                  <th>Stage</th>
                  <th className="text-right">Exams</th>
                  <th className="text-right">Best %</th>
                  <th>Risk</th>
                  <th>Registered</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id} className="row-hover" onClick={() => nav(`/admin/candidates/${c.id}`)}>
                    <td>
                      <div className="flex items-center gap-1.5 font-medium">
                        {c.user.name}
                        {c.hasResume && <FileText className="h-3.5 w-3.5 text-ink-400" aria-label="Resume uploaded" />}
                        {!c.user.isActive && <Badge tone="bad">Inactive</Badge>}
                      </div>
                      <div className="text-[12px] text-ink-500">
                        {c.user.email}
                        {!c.user.emailVerified && <span className="text-warn-600"> · unverified</span>}
                      </div>
                    </td>
                    <td className="max-w-[240px] truncate text-[12.5px]">{c.college}</td>
                    <td className="text-[12.5px]">
                      {c.degree}
                      <div className="text-ink-500 truncate max-w-[160px]">{c.branch}</div>
                    </td>
                    <td className="num text-right">{c.graduationYear}</td>
                    <td><StageBadge stage={c.stage} /></td>
                    <td className="num text-right">{c._count.assignments}</td>
                    <td className="num text-right">{fmtPct(c.bestPercentage)}</td>
                    <td>{c.highestRisk ? <RiskBadge level={c.highestRisk} /> : <span className="text-ink-400">—</span>}</td>
                    <td className="text-[12.5px] text-ink-500 whitespace-nowrap">{fmtDate(c.createdAt)}</td>
                  </tr>
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

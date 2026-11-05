import { useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { Button, Dialog, Field, Input, Select, useToast } from "@/components/ui";
import { download, qs } from "@/lib/api";
import { useApi } from "@/hooks/useApi";

interface Props {
  open: boolean;
  onClose: () => void;
  examId?: string;
  sessionId?: string;
  candidateId?: string;
}

export function ExportExcelModal({ open, onClose, examId, sessionId: initialSessionId, candidateId: initialCandidateId }: Props) {
  const toast = useToast();
  const [reportType, setReportType] = useState<"assessment" | "comprehensive">("assessment");
  const [scope, setScope] = useState<"all" | "session" | "branch" | "candidate">(
    initialCandidateId ? "candidate" : initialSessionId ? "session" : "all"
  );
  const [sessionId, setSessionId] = useState<string>(initialSessionId || "");
  const [branch, setBranch] = useState<string>("Computer Science & Engineering");
  const [candidateId, setCandidateId] = useState<string>(initialCandidateId || "");
  const [passFail, setPassFail] = useState<string>("ALL");
  const [downloading, setDownloading] = useState(false);

  const { data: sessionData } = useApi<{ sessions: { id: string; sessionName: string; codeLastFour: string }[] }>("/sessions");

  const handleDownload = async () => {
    setDownloading(true);
    try {
      if (reportType === "assessment") {
        // Module 4: 3-Sheet Assessment Report
        const query = qs({
          scope,
          sessionId: scope === "session" ? sessionId || undefined : undefined,
          branch: scope === "branch" ? branch || undefined : undefined,
          candidateId: scope === "candidate" ? candidateId.trim() || undefined : undefined,
          examId,
        });

        const filename = `Zanvar-Assessment-Report-${scope}-${new Date().toISOString().slice(0, 10)}.xlsx`;
        await download(`/excel-reports/assessment-export${query}`, filename);
        toast("3-Sheet Assessment Report (.xlsx) downloaded successfully!");
      } else {
        // Full examination export
        const query = qs({
          examId,
          sessionId: sessionId || undefined,
          passFail: passFail === "ALL" ? undefined : passFail,
        });

        const filename = `Zanvar-Exam-Report-${new Date().toISOString().slice(0, 10)}.xlsx`;
        await download(`/excel-reports/export${query}`, filename);
        toast("Excel report downloaded successfully!");
      }
      onClose();
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Export Examination Report to Excel (.xlsx)" size="md">
      <div className="space-y-4 text-xs">
        {/* Information Callout */}
        <div className="p-3 bg-navy-900/5 rounded-lg border border-navy-900/10 flex items-start gap-2.5">
          <FileSpreadsheet className="h-5 w-5 text-navy-900 shrink-0 mt-0.5" />
          <div className="leading-snug">
            <span className="font-semibold text-navy-900 block">
              {reportType === "assessment"
                ? "Official 3-Sheet Assessment Workbook (Module 4)"
                : "Full Comprehensive Examination Summary"}
            </span>
            <span className="text-[11px] text-ink-500">
              {reportType === "assessment"
                ? "Generates Sheet 1 (Candidate Records), Sheet 2 (Question Performance), and Sheet 3 (Prompt Attempts) with formatted timestamps and evaluation breakdowns."
                : "Detailed candidate result sheets with proctoring audit summaries."}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <Field label="Report Type">
            <Select value={reportType} onChange={(e) => setReportType(e.target.value as any)}>
              <option value="assessment">3-Sheet Assessment & Prompt Report (Module 4)</option>
              <option value="comprehensive">Comprehensive Examination Results</option>
            </Select>
          </Field>

          {reportType === "assessment" && (
            <>
              <Field label="Export Action / Scope">
                <Select value={scope} onChange={(e) => setScope(e.target.value as any)}>
                  <option value="all">Export All Candidates</option>
                  <option value="session">Export by Examination Session</option>
                  <option value="branch">Export by Academic Branch</option>
                  <option value="candidate">Export Individual Candidate Report</option>
                </Select>
              </Field>

              {scope === "session" && (
                <Field label="Select Session" required>
                  <Select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
                    <option value="">Select a session...</option>
                    {sessionData?.sessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.sessionName} (Code: ••••{s.codeLastFour})
                      </option>
                    ))}
                  </Select>
                </Field>
              )}

              {scope === "branch" && (
                <Field label="Target Branch / Department" required>
                  <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
                    <option value="Computer Science">Computer Science and Engineering (CSE)</option>
                    <option value="Artificial Intelligence">AI & Machine Learning (AIML)</option>
                    <option value="Data Science">Data Science (DS)</option>
                    <option value="Information Technology">Information Technology (IT)</option>
                    <option value="Mechanical">Mechanical Engineering</option>
                  </Select>
                </Field>
              )}

              {scope === "candidate" && (
                <Field label="Candidate ID or User Email" required>
                  <Input
                    placeholder="e.g. cand_cmw... or candidate@example.com"
                    value={candidateId}
                    onChange={(e) => setCandidateId(e.target.value)}
                  />
                </Field>
              )}
            </>
          )}

          {reportType === "comprehensive" && (
            <Field label="Candidate Result Filter">
              <Select value={passFail} onChange={(e) => setPassFail(e.target.value)}>
                <option value="ALL">All Appeared Candidates</option>
                <option value="PASS">Passing Candidates Only</option>
                <option value="FAIL">Failing Candidates Only</option>
              </Select>
            </Field>
          )}
        </div>

        <div className="flex justify-between items-center pt-3 border-t border-line">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={downloading} onClick={handleDownload}>
            <Download className="h-4 w-4 mr-1" /> Download XLSX Workbook
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

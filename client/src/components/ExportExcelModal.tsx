import { useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { Button, Dialog, Field, Input, Select, useToast } from "@/components/ui";
import { download, qs } from "@/lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
  examId?: string;
  sessionId?: string;
}

export function ExportExcelModal({ open, onClose, examId, sessionId }: Props) {
  const toast = useToast();
  const [passFail, setPassFail] = useState<string>("ALL");
  const [minPercentage, setMinPercentage] = useState<string>("");
  const [includeIncomplete, setIncludeIncomplete] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const query = qs({
        examId,
        sessionId,
        passFail: passFail === "ALL" ? undefined : passFail,
        minPercentage: minPercentage ? parseFloat(minPercentage) : undefined,
        includeIncomplete: includeIncomplete ? "1" : undefined,
      });

      const filename = `Zanvar-Exam-Report-${new Date().toISOString().slice(0, 10)}.xlsx`;
      await download(`/excel-reports/export${query}`, filename);
      toast("Excel report downloaded successfully!");
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
        <div className="p-3 bg-navy-900/5 rounded-lg border border-navy-900/10 flex items-start gap-2.5">
          <FileSpreadsheet className="h-5 w-5 text-navy-900 shrink-0 mt-0.5" />
          <div className="leading-snug">
            <span className="font-semibold text-navy-900 block">5-Sheet Official HR Workbook</span>
            <span className="text-[11px] text-ink-500">
              Generates Examination Summary, Dynamic Candidate Results, Section-wise Breakdown, Proctoring Summary, and Session Activity.
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <Field label="Candidate Result Filter">
            <Select value={passFail} onChange={(e) => setPassFail(e.target.value)}>
              <option value="ALL">All Appeared Candidates</option>
              <option value="PASS">Passing Candidates Only</option>
              <option value="FAIL">Failing Candidates Only</option>
            </Select>
          </Field>

          <Field label="Minimum Percentage (%)">
            <Input
              type="number"
              min={0}
              max={100}
              placeholder="e.g. 60"
              value={minPercentage}
              onChange={(e) => setMinPercentage(e.target.value)}
            />
          </Field>

          <div className="p-3 bg-sand-50 rounded-lg border border-line flex items-center justify-between">
            <div>
              <span className="font-semibold text-navy-900 block">Include Incomplete / Terminated Attempts</span>
              <span className="text-[11px] text-ink-500">By default, only submitted candidates are exported.</span>
            </div>
            <input
              type="checkbox"
              checked={includeIncomplete}
              onChange={(e) => setIncludeIncomplete(e.target.checked)}
              className="rounded border-line text-navy-900 h-4 w-4"
            />
          </div>
        </div>

        <div className="flex justify-between items-center pt-3 border-t border-line">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={downloading} onClick={handleDownload}>
            <Download className="h-4 w-4 mr-1" /> Download Excel Report
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

import { Link, useParams } from "react-router-dom";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { Button, Card, Spinner } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";

export default function Submitted() {
  const { attemptId } = useParams();
  const { data, loading } = useApi<{
    status: string;
    exam: { title: string };
    finished: boolean;
    autoSubmittedReason?: string;
    submissionMethod?: string;
    multiFaceCount?: number;
    tabSwitchCount?: number;
    screenshotCount?: number;
  }>(`/attempts/${attemptId}/state`, [attemptId]);

  if (loading || !data) return <Spinner />;

  const isViolationAutoSubmit =
    data.submissionMethod === "AUTO_SUBMITTED_VIOLATION" ||
    data.autoSubmittedReason === "AUTO_SUBMITTED_VIOLATION";
  const isMultiFaceViolation =
    data.autoSubmittedReason === "MULTIPLE_FACES" ||
    (data.status === "AUTO_SUBMITTED" && (data.multiFaceCount ?? 0) >= 3);

  return (
    <Card className="mx-auto mt-8 max-w-xl text-center shadow-md">
      <div className="py-6 px-4">
        {isViolationAutoSubmit ? (
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <ShieldAlert className="h-8 w-8" />
          </div>
        ) : (
          <CheckCircle2 className="mx-auto h-12 w-12 text-ok-600" />
        )}

        <h1 className="mt-4 text-[22px] font-semibold text-navy-950">
          {isViolationAutoSubmit ? "Examination Auto-Submitted (Violation Limit)" : "Examination Submitted"}
        </h1>
        <p className="mt-1 text-sm text-ink-500">{data.exam.title}</p>

        {isViolationAutoSubmit ? (
          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50/70 p-4 text-left text-xs space-y-2">
            <div className="font-semibold text-amber-900 text-[13px]">
              Anti-Malpractice System Policy Limit Reached
            </div>
            <p className="text-ink-700 leading-relaxed">
              Your examination was automatically submitted because the permitted violation limit (maximum 2 confirmed tab switches or detected screenshot attempts) was reached during your test.
            </p>
            <div className="pt-1 flex flex-wrap gap-4 text-ink-700 font-mono text-[11.5px]">
              {data.tabSwitchCount !== undefined && (
                <span>Tab Switches: <strong>{data.tabSwitchCount}/2</strong></span>
              )}
              {data.screenshotCount !== undefined && (
                <span>Screenshot Attempts: <strong>{data.screenshotCount}/2</strong></span>
              )}
            </div>
            <p className="text-ink-500 text-[11px] pt-1 border-t border-amber-200/60">
              All questions answered up to the moment of auto-submission have been securely saved and proctoring audit logs preserved for HR evaluation.
            </p>
          </div>
        ) : (
          <p className="mt-4 text-[13.5px] text-ink-700">
            {isMultiFaceViolation
              ? "Your examination was automatically submitted because multiple faces were detected 3 times, exceeding the permitted limit of 2 warnings. Violation count and incident timestamps have been recorded in the database."
              : data.status === "AUTO_SUBMITTED"
              ? "Your time was up, so your saved answers were submitted automatically."
              : data.status === "ADMIN_SUBMITTED"
              ? "Your examination was finalized and submitted by the administrator/proctor."
              : data.status === "TERMINATED"
              ? "Your examination attempt was terminated by the administrator."
              : "Your answers have been recorded."}{" "}
            Results will be shared once the HR team releases them.
          </p>
        )}

        <p className="mt-4 text-[12px] text-ink-400">Recorded at {fmtDateTime(new Date())}</p>
        <Link to="/candidate">
          <Button className="mt-6 bg-navy-900 hover:bg-navy-800 text-white">Back to my examinations</Button>
        </Link>
      </div>
    </Card>
  );
}

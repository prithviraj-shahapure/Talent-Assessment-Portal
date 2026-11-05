import { Link, useParams } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { Button, Card, Spinner } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";

export default function Submitted() {
  const { attemptId } = useParams();
  const { data, loading } = useApi<{ status: string; exam: { title: string }; finished: boolean; autoSubmittedReason?: string; multiFaceCount?: number }>(`/attempts/${attemptId}/state`, [attemptId]);
  if (loading || !data) return <Spinner />;

  const isMultiFaceViolation = data.autoSubmittedReason === "MULTIPLE_FACES" || (data.status === "AUTO_SUBMITTED" && (data.multiFaceCount ?? 0) >= 3);

  return (
    <Card className="mx-auto mt-8 max-w-xl text-center">
      <div className="py-6">
        <CheckCircle2 className="mx-auto h-12 w-12 text-ok-600" />
        <h1 className="mt-4 text-[22px] font-semibold">Examination submitted</h1>
        <p className="mt-1 text-ink-500">{data.exam.title}</p>
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
        <p className="mt-1 text-[12px] text-ink-400">Recorded at {fmtDateTime(new Date())}</p>
        <Link to="/candidate"><Button className="mt-6">Back to my examinations</Button></Link>
      </div>
    </Card>
  );
}

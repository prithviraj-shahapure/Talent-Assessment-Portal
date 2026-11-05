import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth, isStaff } from "./lib/auth";
import { Spinner } from "./components/ui";
import AdminLayout from "./layouts/AdminLayout";
import CandidateLayout from "./layouts/CandidateLayout";
import Login from "./pages/auth/Login";
import Register from "./pages/auth/Register";
import VerifyEmail from "./pages/auth/Verify";
import { ForgotPassword, ResetPassword } from "./pages/auth/Password";

const Dashboard = lazy(() => import("./pages/admin/Dashboard"));
const Exams = lazy(() => import("./pages/admin/Exams"));
const ExamEditor = lazy(() => import("./pages/admin/ExamEditor"));
const ExamWizard = lazy(() => import("./pages/admin/ExamWizard"));
const SessionManagement = lazy(() => import("./pages/admin/SessionManagement"));
const SessionControlCenter = lazy(() => import("./pages/admin/SessionControlCenter"));
const QuestionBank = lazy(() => import("./pages/admin/QuestionBank"));
const Candidates = lazy(() => import("./pages/admin/Candidates"));
const CandidateDetail = lazy(() => import("./pages/admin/CandidateDetail"));
const LiveProctoring = lazy(() => import("./pages/admin/LiveProctoring"));
const AttemptMonitor = lazy(() => import("./pages/admin/AttemptMonitor"));
const Evaluation = lazy(() => import("./pages/admin/Evaluation"));
const AttemptReview = lazy(() => import("./pages/admin/AttemptReview"));
const Results = lazy(() => import("./pages/admin/Results"));
const Pipeline = lazy(() => import("./pages/admin/Pipeline"));
const Reports = lazy(() => import("./pages/admin/Reports"));
const Users = lazy(() => import("./pages/admin/Users"));
const Settings = lazy(() => import("./pages/admin/Settings"));
const Audit = lazy(() => import("./pages/admin/Audit"));

const CandidateHome = lazy(() => import("./pages/candidate/Home"));
const SessionAccess = lazy(() => import("./pages/candidate/SessionAccess"));
const Profile = lazy(() => import("./pages/candidate/Profile"));
const ExamLobby = lazy(() => import("./pages/candidate/ExamLobby"));
const ExamRoom = lazy(() => import("./pages/candidate/ExamRoom"));
const Submitted = lazy(() => import("./pages/candidate/Submitted"));
const ResultView = lazy(() => import("./pages/candidate/ResultView"));

function Guard({ allow, children }: { allow: "staff" | "super" | "candidate"; children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner className="min-h-screen" />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (allow === "candidate" && user.role !== "CANDIDATE") return <Navigate to="/admin" replace />;
  if (allow === "staff" && !isStaff(user)) return <Navigate to="/candidate" replace />;
  if (allow === "super" && user.role !== "SUPER_ADMIN") return <Navigate to="/admin" replace />;
  return <>{children}</>;
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner className="min-h-screen" />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === "CANDIDATE" ? "/candidate" : "/admin"} replace />;
}

export default function App() {
  return (
    <Suspense fallback={<Spinner className="min-h-[60vh]" />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/session" element={<SessionAccess />} />
        <Route path="/portal" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route path="/admin" element={<Guard allow="staff"><AdminLayout /></Guard>}>
          <Route index element={<Dashboard />} />
          <Route path="exams" element={<Exams />} />
          <Route path="exams/wizard" element={<ExamWizard />} />
          <Route path="exams/:id" element={<ExamEditor />} />
          <Route path="sessions" element={<SessionManagement />} />
          <Route path="sessions/:id/control" element={<SessionControlCenter />} />
          <Route path="questions" element={<QuestionBank />} />
          <Route path="candidates" element={<Candidates />} />
          <Route path="candidates/:id" element={<CandidateDetail />} />
          <Route path="live" element={<LiveProctoring />} />
          <Route path="live/:attemptId" element={<AttemptMonitor />} />
          <Route path="evaluation" element={<Evaluation />} />
          <Route path="attempts/:id" element={<AttemptReview />} />
          <Route path="results" element={<Results />} />
          <Route path="pipeline" element={<Pipeline />} />
          <Route path="reports" element={<Reports />} />
          <Route path="users" element={<Guard allow="super"><Users /></Guard>} />
          <Route path="settings" element={<Settings />} />
          <Route path="audit" element={<Guard allow="super"><Audit /></Guard>} />
        </Route>

        <Route path="/candidate" element={<Guard allow="candidate"><CandidateLayout /></Guard>}>
          <Route index element={<CandidateHome />} />
          <Route path="profile" element={<Profile />} />
          <Route path="exams/:examId" element={<ExamLobby />} />
          <Route path="lobby/:examId" element={<ExamLobby />} />
          <Route path="results/:attemptId" element={<ResultView />} />
          <Route path="submitted/:attemptId" element={<Submitted />} />
        </Route>
        <Route path="/exam/:attemptId" element={<Guard allow="candidate"><ExamRoom /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

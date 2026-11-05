export type Role = "SUPER_ADMIN" | "HR_ADMIN" | "CANDIDATE";
export type QuestionType = "SINGLE" | "MULTIPLE" | "TRUE_FALSE" | "SHORT" | "DESCRIPTIVE" | "CODING" | "NUMERICAL";
export type Difficulty = "EASY" | "MEDIUM" | "HARD";
export type PipelineStage = "REGISTERED" | "ELIGIBLE" | "EXAM_SCHEDULED" | "EXAM_COMPLETED" | "EVALUATION" | "SHORTLISTED" | "INTERVIEW" | "SELECTED" | "REJECTED";
export type RiskLevel = "NORMAL" | "LOW" | "MEDIUM" | "HIGH";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  emailVerified: boolean;
  candidate?: { id: string; stage: PipelineStage; college: string; degree: string; branch: string; resumeName: string | null } | null;
}
export interface Department { id: string; name: string; code: string; _count?: { exams: number; candidates: number } }
export interface Category { id: string; name: string; description?: string | null; _count?: { questions: number } }
export interface Option { id?: string; text: string; isCorrect: boolean }
export interface Question {
  id: string;
  type: QuestionType;
  text: string;
  explanation: string | null;
  categoryId: string | null;
  category?: { id: string; name: string } | null;
  difficulty: Difficulty;
  marks: number;
  negativeMarks: number;
  acceptedAnswers: string[];
  numericTolerance: number | null;
  codeLanguage: string | null;
  codeStarter: string | null;
  tags: string[];
  isActive: boolean;
  sourceType?: string;
  approvalStatus?: string;
  sectionTitle?: string | null;
  options: (Option & { id: string })[];
  _count?: { examQuestions: number };
}
export interface Exam {
  id: string;
  title: string;
  description: string | null;
  departmentId: string | null;
  department?: { id: string; name: string } | null;
  createdById?: string | null;
  position: string | null;
  category: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  startAt: string;
  endAt: string;
  durationMinutes: number;
  totalMarks: number;
  passingMarks: number;
  negativeMarking: boolean;
  maxAttempts: number;
  randomizeQuestions: boolean;
  randomizeOptions: boolean;
  sectionTimeLimits: boolean;
  instructions: string | null;
  eligibility: { degrees?: string[]; branches?: string[]; graduationYears?: number[]; colleges?: string[] } | null;
  resultPublication: "MANUAL" | "IMMEDIATE" | "AFTER_EXAM_END";
  resultsReleased: boolean;
  proctoringEnabled: boolean;
  requireWebcam: boolean;
  requireMicrophone: boolean;
  requireFullscreen: boolean;
  evidenceCapture: boolean;
  livePreview: boolean;
  _count?: { assignments: number; attempts: number; sections?: number; invitations: number };
  submittedCount?: number;
  avgPercentage?: number | null;
}
export interface LiveStatus {
  attemptId: string;
  examId: string;
  candidateId: string;
  candidateName: string;
  examTitle: string;
  deadlineAt: string;
  currentQuestion: number;
  totalQuestions: number;
  answered: number;
  camera: "ON" | "OFF" | "NOT_REQUIRED";
  microphone: "ON" | "OFF" | "NOT_REQUIRED";
  focused: boolean;
  fullscreen: boolean;
  faceCount: number | null;
  audioLevel: number;
  connected: boolean;
  status: "ACTIVE" | "SUBMITTED" | "AUTO_SUBMITTED" | "DISCONNECTED";
  eventCount: number;
  riskScore: number;
  riskLevel: RiskLevel;
  lastSeenAt: string;
  previewAllowed: boolean;
  multiFaceViolations?: number;
}
export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }

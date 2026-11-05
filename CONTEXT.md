# Project Context: Zanvar Group Talent Assessment Portal

> **Purpose of this document:** Complete architectural, functional, data model, and development context for developers, AI assistants, and maintainers working on the Zanvar Group Talent Assessment Portal.

---

## 1. Executive Summary

- **Project Name:** Zanvar Group Talent Assessment Portal
- **Primary Domain:** Enterprise Online Examination, Automated & AI Proctoring, Intern & Talent Recruitment Pipeline.
- **Organization:** Zanvar Group HR & Recruitment Team.
- **Core Value Proposition:** A secure, zero-trust exam platform where tests are frozen on the server, anti-cheat signals are captured using on-device ML (MediaPipe) without heavy video streaming, and candidate progress flows directly into an HR evaluation and recruitment pipeline.

---

## 2. Technology Stack & Key Libraries

### 2.1 Backend (`server/`)
- **Runtime:** Node.js (20+ LTS, ES/CommonJS via `tsx` for dev, `tsc` for build)
- **Framework:** Express 4.x
- **Database & ORM:** PostgreSQL 14+ (bundled with zero-setup embedded PostgreSQL 17 for quick local dev), Prisma ORM 7 (`@prisma/client`, `@prisma/adapter-pg`)
- **Real-Time Communication:** Socket.IO 4.x (WebSockets for HR live proctoring hub & candidate telemetry)
- **Authentication:** JWT in secure HTTP-only cookies (`jsonwebtoken`, `cookie-parser`), Bcrypt password hashing (`bcryptjs`)
- **Validation:** Zod schemas for request payload validation
- **Reporting & Exports:** ExcelJS (`.xlsx` export), PDFKit (`.pdf` scorecards and candidate reports)
- **Email:** Nodemailer (SMTP with console fallback for local dev)
- **Security:** Helmet, CORS, Express Rate Limit, magic-byte file signature validation on uploads

### 2.2 Frontend (`client/`)
- **Framework & Build:** React 18, TypeScript, Vite
- **Styling:** Tailwind CSS 3.4, `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`
- **Component Primitives:** Radix/Shadcn-style modular components with `lucide-react` icons
- **Computer Vision / AI Proctoring:** Google MediaPipe Vision (`@mediapipe/tasks-vision`) utilizing `FaceLandmarker` with local WebAssembly models and fallback to browser `FaceDetector` / CDN
- **Charts & Dashboards:** Recharts 2.x
- **Routing:** React Router DOM 6.x
- **Optional External Auth:** Firebase JS SDK (Google OAuth)

---

## 3. Directory & Workspace Structure

```
Exam-Portal-main/
├── package.json               # Root monorepo workspace configuration
├── start-local.cmd            # One-click Windows starter with embedded PostgreSQL
├── README.md                  # Quick start and operational guide
│
├── server/
│   ├── prisma/
│   │   ├── schema.prisma      # Source-of-truth Prisma data model
│   │   ├── migrations/        # SQL migration history
│   │   ├── seed.ts            # Default roles, demo exams, questions, and candidates
│   │   ├── create-admin.ts    # CLI utility to provision Super Admin users
│   │   └── create-db.ts       # Database bootstrap utility
│   ├── src/
│   │   ├── index.ts           # Application entry point & HTTP listener
│   │   ├── app.ts             # Express middleware pipeline & route mounts
│   │   ├── config/env.ts      # Strict environment validation via Zod
│   │   ├── sockets/           # Socket.IO connection handling & proctoring room hubs
│   │   ├── jobs/              # Sweeper jobs: Auto-submit (15s) and data retention purge (6h)
│   │   ├── lib/               # Core business logic:
│   │   │   ├── engine.ts      # Paper generation (randomization, freeze) & grading engine
│   │   │   ├── risk.ts        # Proctoring risk calculation engine
│   │   │   ├── attempts.ts    # Attempt finalization & score locks
│   │   │   ├── invites.ts     # Code verification & eligibility rules
│   │   │   ├── storage.ts     # Local filesystem / disk storage abstraction
│   │   │   ├── mailer.ts      # Email dispatch (verification, invites, resets)
│   │   │   └── audit.ts       # Immutable audit logging helper
│   │   ├── middleware/        # auth.ts, csrf.ts, upload.ts, rateLimit.ts
│   │   └── modules/           # Feature-based REST controllers & routers:
│   │       ├── auth/          # Login, Register, Forgot Password, Google Auth
│   │       ├── exams/         # CRUD exams, sections, rules, publish/archive
│   │       ├── questions/     # Question bank, categories, bulk CSV/Excel import
│   │       ├── attempts/      # Start attempt, autosave answer, submit, extra time
│   │       ├── proctoring/    # Ingest proctor events, evidence upload, HR live feed
│   │       ├── evaluation/    # Manual grading queue for descriptive/coding answers
│   │       ├── results/       # Leaderboards, score breakdown, result publication
│   │       ├── candidates/    # Candidate profiles, eligibility check, status update
│   │       ├── pipeline/      # Recruitment stages (Registered -> Shortlisted -> Selected)
│   │       ├── dashboard/     # High-level metrics for HR
│   │       ├── reports/       # PDF scorecard & Excel candidate lists
│   │       ├── settings/      # Dynamic system settings & risk thresholds
│   │       ├── audit/         # System-wide audit log query
│   │       └── users/         # Admin user management & RBAC
│   └── storage/               # Resumes, snapshots, verification photos
│
└── client/
    ├── public/
    │   └── mediapipe/         # Offline WebAssembly binaries and FaceLandmarker models
    ├── src/
    │   ├── layouts/           # AdminLayout (sidebar), CandidateLayout, AuthLayout
    │   ├── proctoring/        # MediaPipe runner, audio level analyzer, ProctorSession
    │   ├── hooks/             # useAuth, useSocket, useTimer, useAutosave
    │   ├── lib/               # API client, utility functions, formatters
    │   ├── components/ui/     # Button, Modal, Table, Badge, Dropdown, Input...
    │   └── pages/
    │       ├── auth/          # Login.tsx, Register.tsx, Verify.tsx, Password.tsx
    │       ├── candidate/
    │       │   ├── Home.tsx         # Available exams & history
    │       │   ├── Profile.tsx      # Academic profile & resume upload
    │       │   ├── ExamLobby.tsx    # 7-step pre-exam verification flow
    │       │   ├── ExamRoom.tsx     # The locked exam environment with autosave
    │       │   ├── Submitted.tsx    # Post-submission confirmation
    │       │   └── ResultView.tsx   # Detailed candidate scorecard (when released)
    │       └── admin/
    │           ├── Dashboard.tsx      # Analytics & status summary
    │           ├── Exams.tsx          # Exam list & management
    │           ├── ExamEditor.tsx     # Sections, question bank linkage, settings
    │           ├── QuestionBank.tsx   # Filterable question pool
    │           ├── LiveProctoring.tsx # Real-time mosaic of active test takers
    │           ├── AttemptMonitor.tsx # Single-attempt live inspector
    │           ├── AttemptReview.tsx  # Post-exam attempt review & flag clearance
    │           ├── Evaluation.tsx     # Subjective & coding manual grading
    │           ├── Results.tsx        # Ranking, percentile, score release
    │           ├── Pipeline.tsx       # Drag-and-drop / stage recruitment funnel
    │           ├── Candidates.tsx     # Directory of all applicants
    │           ├── Reports.tsx        # Batch report generation
    │           ├── Settings.tsx       # Configurable risk weights & system variables
    │           ├── Users.tsx          # Staff management
    │           └── Audit.tsx          # Audit event log viewer
```

---

## 4. Key Data Models (Prisma)

### Identity & Access
- `User`: System user record (`id`, `email`, `passwordHash`, `googleUid`, `name`, `role`: `SUPER_ADMIN | HR_ADMIN | CANDIDATE`, `isActive`, `emailVerified`).
- `CandidateProfile`: Extended student info (`mobile`, `college`, `degree`, `branch`, `currentYear`, `graduationYear`, `resumeKey`, `stage`: `REGISTERED` → `SELECTED`).
- `EmailToken`: Verification & password reset tokens with single-use expiration.

### Assessment Structure
- `Exam`: Top-level exam configuration (`title`, `code`, `instructions`, `durationMinutes`, `startWindow`, `endWindow`, `status`: `DRAFT | PUBLISHED | ARCHIVED`, `resultPublication`: `MANUAL | IMMEDIATE | AFTER_EXAM_END`, proctoring flags).
- `ExamSection`: Modular sections within an exam (e.g., "Aptitude", "Core Mechanical", "Coding") with individual timers or aggregate timers.
- `Question`: Question bank entity (`type`: `SINGLE`, `MULTIPLE`, `TRUE_FALSE`, `SHORT`, `DESCRIPTIVE`, `CODING`, `NUMERICAL`, `points`, `negativePoints`, `difficulty`, `departmentId`).
- `QuestionOption`: Options for MCQ questions.
- `ExamQuestion`: Fixed questions tied to an exam section.
- `SectionRandomRule`: Rules for pulling random questions dynamically per candidate from specific categories.

### Exam Runtime & Grading
- `Attempt`: A candidate's instance of an exam (`candidateId`, `examId`, `status`: `IN_PROGRESS | SUBMITTED | AUTO_SUBMITTED | EVALUATED`, `paperData`: JSON snapshot of questions/options, `serverDeadline`, `totalScore`, `riskScore`).
- `Answer`: Candidate's response to an individual question (`selectedOptionIds`, `textValue`, `numericValue`, `codeValue`, `isCorrect`, `awardedPoints`, `evaluationStatus`, `evaluatorFeedback`).
- `ProctorEvent`: Recorded telemetry events (`FACE_NOT_FOUND`, `MULTIPLE_FACES`, `LOOKING_AWAY`, `TAB_SWITCH`, `FULLSCREEN_EXIT`, `AUDIO_SPIKE`, `DEVICE_DISCONNECTED`, `SEVERITY`: `INFO | LOW | MEDIUM | HIGH`).
- `EvidenceFile`: Secure snapshots captured during anomalies or candidate verification photos.
- `PipelineHistory` & `AuditLog`: Immutable history of candidate stage transitions and system administrative events.

---

## 5. Core Architectural Mechanisms

### 5.1 Frozen Paper Model
To prevent cheating, question leaking, or mid-exam configuration changes:
1. When a candidate starts (`POST /attempts/start`), the server compiles all fixed questions and resolves all random selection rules.
2. Question and option order is randomized per candidate.
3. The generated question set is sanitized (correct answers stripped) and serialized directly into `attempt.paperData`.
4. Subsequent exam requests serve this static snapshot.

### 5.2 Server-Authoritative Timer & Sweeper
- Deadlines are never dictated by the client's clock. The server computes:
  $$\text{Deadline} = \min(\text{StartTime} + \text{Duration} + \text{ApprovedExtraTime},\, \text{ExamEndWindow})$$
- A background sweeper job (`jobs/auto-submit.ts`) runs every 15 seconds to automatically finalize and auto-submit expired attempts.

### 5.3 On-Device Computer Vision & Privacy
- **MediaPipe FaceLandmarker:** Runs inside the candidate's browser via WebAssembly (`client/public/mediapipe/`).
- Only lightweight metadata (e.g., face coordinate bounds, gaze vectors, confidence scores) is checked.
- No heavy video stream is uploaded to the server, protecting candidate bandwidth.
- Low-resolution thumbnails (160px JPEG) are transmitted via Socket.IO only during active live proctoring to authorized HR rooms.

### 5.4 Risk Calculation Engine (`server/src/lib/risk.ts`)
Each proctoring violation updates the candidate's advisory risk score (0 to 100):
- **Weights:** Different severities assigned to different signals (e.g., multiple faces > looking away).
- **Grace Count:** Occurrences within grace limit are ignored (e.g., first 2 brief focus losses).
- **Cooldown:** Multiple alerts within seconds are deduplicated.
- **Human-in-the-Loop:** Risk score is strictly advisory; no automatic disqualification occurs without HR review.

---

## 6. Authentication & Roles

| Role | Access Permissions |
|---|---|
| **SUPER_ADMIN** | Full system control: manage staff accounts, adjust global system settings & risk weights, view complete audit logs, create/delete any exam or candidate. |
| **HR_ADMIN** | Create exams & question banks, review candidates, conduct live proctoring, grade evaluations, manage recruitment pipeline, export reports. |
| **CANDIDATE** | Access registration, pre-exam checks lobby, take assigned exams, view individual result scorecard once released. |

---

## 7. Development & Runtime Configuration

### Essential Environment Variables (`server/.env`)
- `PORT`: API server port (default: `4000`)
- `DATABASE_URL`: PostgreSQL connection string (default embedded: `postgresql://postgres:postgres@127.0.0.1:5433/zanvar_exam`)
- `JWT_SECRET`: High-entropy secret for cookie signing
- `SERVE_CLIENT`: `true` to serve the React production bundle from Express
- `FIREBASE_*`: Optional Google authentication keys
- `SMTP_*`: Mail transport configurations (prints to console if absent)

### CLI Commands
- `npm run dev`: Runs server (`:4000`) and client (`:5173`) concurrently with hot-reload.
- `npm run build`: Compiles TypeScript backend and Vite frontend for production.
- `npm run db:deploy`: Runs pending Prisma SQL migrations.
- `npm run db:seed`: Seeds initial roles, exams, and demo accounts.
- `npm run create-admin -- <email> "<name>" "<password>"`: Generates or updates a Super Admin user.


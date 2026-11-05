# Zanvar Group — Talent Assessment Portal

Online examination, proctoring and intern-recruitment platform for the Zanvar Group HR team.

- **Session Code & Secure Examination Access**: Unique cryptographic session codes (`ZG-TECH-8472`, `ZANVAR2026`, etc.) with HMAC-SHA256 salted storage, capacity limits, active/paused/revoked statuses, candidate pre-mapping, rate-limiting, and short-lived access tokens.
- **Candidate Assessment Landing**: Dedicated zero-trust entry portal (`Zanvar Group | Online Assessment`) where candidates enter their session code and registered email/ID for multi-point eligibility and capacity verification before entering the pre-exam lobby.
- **Multi-Stage Examination Engine**: Dynamic configuration of independent stages (Aptitude, Technical, Prompt Engineering, Custom) with independent durations, question pools, marks, passing scores, and instructions.
- **Sequential Examination Flow**: Server-authoritative strict sequential stage transitions (`APTITUDE -> TECHNICAL -> PROMPT ENGINEERING -> COMPLETED`) with immutable stage answer locking, independent countdown timers, and reload/closure persistence.
- **TXT Question Paper Generator & AI Engine**: Upload raw `.txt` files in Formats A, B, or C; auto-detects section headers, MCQ options, answers, explanations, and difficulty levels. Includes optional AI-assisted extraction and generation mode with full review and approval controls.
- **HR / Admin console**: Session Code Management dashboard, Multi-step Examination Builder wizard, question review workspace, live proctoring, evaluation, results and rankings with section-wise analytics, recruitment pipeline, and audit logs.
- **Candidate portal**: Candidate session entry, registration with invitation codes, email verification, guided pre-exam checks, proctored examination room with stage stepper, and released results.

---

## 1. Requirements

| Software | Version |
|---|---|
| Node.js | 20 LTS or newer (22/24 recommended) |
| PostgreSQL | 14 or newer |
| Browser (candidates) | Latest Google Chrome or Microsoft Edge on a laptop/desktop |

> **Camera and microphone only work on a secure origin.** The site must be opened on `https://…` or `http://localhost`. On a LAN or for production, put the portal behind HTTPS (see §6).

## 2. Quick start (no PostgreSQL install needed)

Double-click **`start-local.cmd`**. On the first run it:
- installs dependencies
- starts a private PostgreSQL 17 that keeps its data in `.pgdata\` inside the project (port 5433, reachable only from this computer)
- creates `server\.env`, applies the migrations and loads the demo data
- opens http://localhost:5173

Later runs start in a few seconds, and dependencies are reinstalled automatically when `package-lock.json` changes. Press **Ctrl+C** in the window to stop the portal and its database. To reset all data, stop the portal and delete `.pgdata\` and `server\.seeded`.

To use your own PostgreSQL server instead, follow §2a, or edit `DATABASE_URL` in `server\.env` and delete the `LOCAL_EMBEDDED_DB=true` line.

## 2a. Manual setup with your own PostgreSQL (Windows, PowerShell)

```powershell
cd C:\Harmony\ExamPortal

# 1. Create the database (or use pgAdmin → Create → Database → zanvar_exam)
createdb -U postgres zanvar_exam

# 2. Configure the server
copy server\.env.example server\.env
notepad server\.env        # set DATABASE_URL password and a long JWT_SECRET

# 3. Install dependencies
#    (also generates the Prisma client, and copies/downloads the MediaPipe face models)
npm install

# 4. Create the tables and load the demo data
npm run db:deploy
npm run db:seed            # WARNING: the seed wipes all data — development only

# 5. Run (API on :4000, web app on :5173)
npm run dev
```

Open **http://localhost:5173**.

### Demo accounts (from the seed)

| Role | Email | Password |
|---|---|---|
| Super Admin | superadmin@zanvargroup.com | Admin@2026 |
| HR Admin | hr@zanvargroup.com | Hr@2026 |
| Candidate | candidate@example.com | Candidate@2026 |

Invitation codes: `GET-MECH-2026` (live now), `IT-INTERN-2026` (upcoming, timed sections), `QA-DIP-2026` (closed, results released).
All other seeded candidates use the password `Candidate@2026`.

Without SMTP settings, emails (verification, invitations, password reset) are printed to the server console. In development the registration and “resend” screens also show the verification link directly.

## 2b. Google sign-in (Firebase) — optional

Candidates and staff can use **Continue with Google** on the sign-in and registration pages. Firebase only confirms which Google account the person owns; the portal still issues its own session, roles and audit log. The button is hidden until Firebase is configured.

**One-time setup (about 5 minutes):**
1. Open https://console.firebase.google.com → **Add project** (Google Analytics is not needed).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable**, choose a support email, **Save**.
3. **Authentication → Settings → Authorized domains**: `localhost` is there by default. Add your production domain (for example `careers.zanvargroup.com`) before going live.
4. **Project settings (gear) → General → Your apps → Web (`</>`)**: register an app (no hosting needed) and copy the `firebaseConfig` values into `server\.env`:
   ```
   FIREBASE_API_KEY=AIza...
   FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   FIREBASE_PROJECT_ID=your-project
   FIREBASE_APP_ID=1:1234567890:web:abc123
   ```
   These are public identifiers, not secrets. No service-account key is needed: the server checks each Google sign-in token against Google's published signing keys.
5. Restart the portal.

**How it behaves**
- **Existing account** (same email): signed in, and the Google account is linked on first use. After that, only that Google account can sign in to it with Google. Signing in with a password still works.
- **New candidate**: goes to the registration form with the name and email filled in from Google and no password fields. The details, privacy consent and invitation code are still required. The email counts as verified, so no verification email is sent.
- **HR / Super Admin**: can sign in with Google only when the Google email matches their existing account. New staff accounts are never created this way. Set `GOOGLE_STAFF_SIGNIN=false` to make staff use passwords only.
- A Google-only candidate who later wants a password uses **Forgot password**.
- Deactivated accounts are blocked. Google sign-ins and account links are recorded in the audit log (`auth.login_google`, `auth.google_linked`).

## 3. Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | API + web app with hot reload |
| `npm run build` | Production build (`server/dist`, `client/dist`) |
| `npm start` | Run the built API (serves the web app too when `SERVE_CLIENT=true`) |
| `npm run db:deploy` | Apply database migrations |
| `npm run db:migrate` | Create a new migration after editing `schema.prisma` (development) |
| `npm run db:seed` | Reset and load demo data |
| `npm run create-admin -- <email> "<name>" "<password>"` | Create or reset a Super Admin |
| `npm run db:studio -w server` | Browse the database in Prisma Studio |
| `npm run typecheck` | TypeScript check of server and client |

## 4. Architecture

```
ExamPortal/
├─ server/                     Express + TypeScript + Prisma 7 (pg adapter) + Socket.IO
│  ├─ prisma/
│  │  ├─ schema.prisma         Data model (single source of truth)
│  │  ├─ migrations/           SQL migrations
│  │  └─ seed.ts               Demo data
│  ├─ prisma.config.ts         Prisma 7 configuration (DB URL, seed)
│  └─ src/
│     ├─ config/env.ts         Environment validation
│     ├─ lib/                  engine (paper building, grading), risk engine, settings,
│     │                        attempts (finalise), invites/eligibility, storage, mailer, audit
│     ├─ middleware/           auth (JWT cookie, roles), CSRF, uploads (magic-byte checks)
│     ├─ modules/<feature>/    REST routes: auth, users, departments, questions, exams,
│     │                        candidates, me, attempts, proctoring, evaluation, results,
│     │                        pipeline, dashboard, settings, audit, reports
│     ├─ sockets/              Socket.IO auth + live proctoring hub
│     └─ jobs/                 Auto-submit sweeper (15 s), retention purge (6 h)
└─ client/                     React 18 + Vite + TypeScript + Tailwind (shadcn-style components)
   └─ src/
      ├─ components/ui/        Button, form controls, dialogs, tables, badges, toasts…
      ├─ layouts/              Admin (sidebar), Candidate (top bar), Auth
      ├─ pages/admin/          Dashboard, Exams + editor, Question bank, Candidates, Live
      │                        proctoring, Attempt monitor, Evaluation, Results, Pipeline,
      │                        Reports, Users, Settings, Audit
      ├─ pages/candidate/      Home, Profile, Exam lobby (checks), Exam room, Results
      └─ proctoring/           MediaPipe face analysis, media/audio helpers, ProctorSession
```

### Main tables
`User`, `CandidateProfile`, `Department`, `QuestionCategory`, `Question`, `QuestionOption`, `Exam`, `ExamSection`, `ExamQuestion`, `SectionRandomRule`, `Invitation`, `ExamAssignment`, `Attempt`, `Answer`, `ProctorEvent`, `EvidenceFile`, `ConsentRecord`, `AccommodationRequest`, `PipelineHistory`, `AuditLog`, `SystemSetting`, `EmailToken`.

### How an examination runs
1. HR creates an exam: sections, fixed questions and/or random-from-bank rules, then publishes it and shares an invitation code (or assigns candidates directly). Eligibility rules are checked when a code is used.
2. The candidate verifies their email, then goes through instructions → privacy consent → system check → camera/microphone test (with face check) → verification photo → environment confirmation → fullscreen.
3. `POST /attempts/start` builds a **frozen paper** for that candidate: random picks, question order and option order are fixed and stored on the attempt. The **deadline is stored on the server**: start time + duration (+ approved extra time), capped at the exam window.
4. Answers autosave every few seconds (and are kept in local storage if the network drops). Reloading the page resumes the same attempt.
5. On submit, time-up or the server sweeper, the attempt is locked exactly once and graded. Objective questions are auto-graded (including negative marking, numeric tolerance and accepted short answers). Descriptive and coding answers go to the **Evaluation** queue.
6. HR reviews results, rankings, flags and evidence, shortlists candidates and releases results.

Correct answers are never sent to the candidate's browser before results are released, and client-side marks and timers are never trusted.

## 5. Proctoring

| Signal | How | Notes |
|---|---|---|
| Face present / multiple faces / looking away | MediaPipe FaceLandmarker in the browser (FaceDetector fallback), about 2.5 frames/s | Detects **presence**, not identity. Thresholds are set in Settings. |
| Camera / microphone disconnected | Media track state | A blocking overlay asks the candidate to reconnect. |
| Audio activity | Web Audio RMS level | **No audio is recorded or uploaded.** Sound levels never decide malpractice on their own. |
| Tab switch, focus loss, fullscreen exit | Visibility, focus and fullscreen APIs | Reloading the page is not counted as a tab switch. |
| Copy / cut / paste / right-click / restricted shortcuts | DOM events (blocked and logged) | |
| Live view for HR | Socket.IO. Small 160 px JPEG frames every few seconds, only to authorised HR rooms | Not stored. |
| Evidence snapshots | Uploaded only when the exam enables them **and** the candidate consents | Deleted automatically after the retention period. |

**Risk engine** (`server/src/lib/risk.ts`, configurable in *Settings → Risk engine*):
- Each event type has a weight, a grace count (occurrences that are tolerated), a cooldown (no double counting) and a cap.
- The score is capped at 100. Levels: Normal (0–19), Low (20–39), Medium (40–69), High (70–100).
- **The score is advisory only.** Nothing disqualifies a candidate automatically. HR reviews each event, marks it reviewed, and can message the candidate or end the attempt with a recorded reason.

**Limitations (told to candidates and HR):** a browser cannot detect secondary phones, a second person outside the camera view, virtual machines, remote-desktop tools or all forms of screen recording.

**Face models:** `npm install` copies the MediaPipe WebAssembly runtime into `client/public/mediapipe/` and downloads the two face models there, so exams can run without depending on Google's CDN. If that download fails, the browser loads the models from Google's CDN instead. If neither works, the exam continues, the event `DETECTOR_UNAVAILABLE` is logged, and HR reviews the session manually.

## 6. Production deployment

1. Copy `server/.env.example` to `server/.env` and set:
   - `NODE_ENV=production`
   - a strong `JWT_SECRET`
   - `COOKIE_SECURE=true`
   - `SERVE_CLIENT=true`
   - `CLIENT_ORIGIN` and `APP_URL` set to your HTTPS URL
   - `TRUST_PROXY=true` if the portal is behind IIS, nginx or a load balancer
   - the SMTP settings
2. Build and migrate:
   ```powershell
   npm install
   npm run build
   npm run db:deploy
   ```
   Then create the first Super Admin. This does not touch any other data:
   ```powershell
   npm run create-admin -- admin@zanvargroup.com "System Administrator" "YourStr0ngPassword"
   ```
3. Start it with `npm start`, running under a service manager (NSSM, PM2 or Windows Service).
4. Put HTTPS in front with IIS (URL Rewrite + ARR, with WebSockets enabled), nginx or Caddy, proxying everything to `http://localhost:4000`, including `/socket.io` (WebSocket upgrade).
5. Back up the PostgreSQL database and the `server/storage` folder, which holds resumes, verification photos and evidence.
6. For several server instances, add the Socket.IO Redis adapter and move live status into Redis (see `sockets/hub.ts`). Replace `lib/storage.ts` with S3 or Azure Blob for object storage.

## 7. Security summary
- JWT in an HttpOnly, SameSite=Lax cookie. Optional Google sign-in through Firebase: the server verifies each Firebase ID token's signature, project, issuer, expiry, Google provider and verified email. Passwords are hashed with bcrypt (cost 12). Email verification is required before starting an exam.
- Double-submit CSRF token on every state-changing request. Helmet with a strict content security policy. CORS restricted to the configured origin.
- Rate limits on login/registration, on autosave and event endpoints, and on the API overall.
- All input is validated with Zod. Uploads are checked by content (magic bytes), not by file extension. Files are stored outside the web root and served only through authorised routes.
- Role checks on every route. Candidates can only access their own attempts. Answer keys are never included in candidate responses.
- The audit log covers sign-ins, configuration changes, exam publishing, evaluation, exports, evidence and resume access, and data erasure.

## 8. Privacy (DPDP Act, 2023)
- The privacy notice (versioned) is shown at registration and before each proctored exam. Consent is stored per exam as a `ConsentRecord`, including the policy version, IP address and browser.
- Candidates can request an alternative arrangement, such as waiving the webcam or microphone requirement or getting extra time. HR approves or declines it in *Evaluation & Review → Accommodation requests*.
- Retention periods for evidence and verification photos are configurable and expired files are purged automatically. A Super Admin can erase all of a candidate's data from the candidate profile.
- There is no covert recording. Raw audio is never captured.

## 9. Known limitations / next steps
- **Coding questions** are answered in a code editor and **marked manually**. Running candidate code needs an isolated sandbox (for example Judge0 or containers), which is not included.
- Face detection checks for a face; it does not verify identity. Identity verification would need a separate, explicitly configured process.
- Live status for the proctoring grid is held in the server's memory, so a single API instance is assumed (see §6.6 for scaling).
=======
# Exam-Portal
>>>>>>> f500d2b6351476fa0ab76afe0adf26addeb64891

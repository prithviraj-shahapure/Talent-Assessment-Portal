import { io } from "socket.io-client";
import { prisma } from "../server/src/lib/prisma";
import { signSession } from "../server/src/lib/tokens";

const API_BASE = "http://localhost:4000/api";

async function run() {
  console.log("=== Starting Multiple-Face Auto-Submission Verification Test ===");

  // 1. Find or create an HR admin user
  let admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });
  if (!admin) {
    admin = await prisma.user.create({
      data: {
        email: "admin.test@zanvar.local",
        name: "Admin Tester",
        role: "SUPER_ADMIN",
        passwordHash: "dummy",
        emailVerified: true,
      },
    });
  }

  // 2. Find or create a candidate user
  let candUser = await prisma.user.findFirst({
    where: { role: "CANDIDATE", candidate: { isNot: null } },
    include: { candidate: true },
  });
  if (!candUser) {
    candUser = await prisma.user.create({
      data: {
        email: "cand.test@zanvar.local",
        name: "Candidate MultiFace Tester",
        role: "CANDIDATE",
        passwordHash: "dummy",
        emailVerified: true,
        candidate: {
          create: {
            college: "Test University",
            degree: "B.Tech",
            branch: "CSE",
            stage: "EXAM_SCHEDULED",
          },
        },
      },
      include: { candidate: true },
    });
  }

  // 3. Find or create a published exam with webcam enabled
  let exam = await prisma.exam.findFirst({
    where: { status: "PUBLISHED", proctoringEnabled: true, requireWebcam: true },
  });

  if (!exam) {
    exam = await prisma.exam.create({
      data: {
        title: "Multi-Face Auto Submit Test Exam",
        status: "PUBLISHED",
        startAt: new Date(Date.now() - 3600_000),
        endAt: new Date(Date.now() + 86400_000),
        durationMinutes: 60,
        totalMarks: 10,
        passingMarks: 5,
        proctoringEnabled: true,
        requireWebcam: true,
      },
    });
  }

  // Ensure candidate is assigned to exam
  await prisma.examAssignment.upsert({
    where: {
      examId_candidateId: {
        examId: exam.id,
        candidateId: candUser.candidate.id,
      },
    },
    create: {
      examId: exam.id,
      candidateId: candUser.candidate.id,
    },
    update: {},
  });

  // Clean up any previous test attempt
  await prisma.attempt.deleteMany({
    where: { candidateId: candUser.candidate.id, attemptNo: 999 },
  });

  // Find a question in database or create one
  let question = await prisma.question.findFirst({ include: { options: true } });
  if (!question) {
    question = await prisma.question.create({
      data: {
        text: "Sample question?",
        type: "SINGLE",
        marks: 1,
        options: {
          create: [
            { text: "Option A", isCorrect: true },
            { text: "Option B", isCorrect: false },
          ],
        },
      },
      include: { options: true },
    });
  }

  // Create an active attempt
  const attempt = await prisma.attempt.create({
    data: {
      examId: exam.id,
      candidateId: candUser.candidate.id,
      attemptNo: 999,
      status: "IN_PROGRESS",
      startedAt: new Date(),
      deadlineAt: new Date(Date.now() + 60 * 60_000),
      paper: [
        {
          title: "Section 1",
          questions: [
            { questionId: question.id, marks: 1, optionOrder: question.options.map((o) => o.id) },
          ],
        },
      ],
      clientInfo: {
        webcamRequired: true,
        microphoneRequired: false,
        evidenceConsent: false,
      },
    },
  });

  console.log(`Created test attempt ${attempt.id} for candidate ${candUser.name}`);

  const adminToken = signSession(admin.id, "SUPER_ADMIN");
  const candToken = signSession(candUser.id, "CANDIDATE");

  // 4. Connect HR Socket.IO client
  const hrSocket = io("http://localhost:4000", {
    extraHeaders: {
      Cookie: `zv_session=${adminToken}`,
    },
    transports: ["websocket"],
  });

  const hrEvents = [];
  let hrEndedStatus = null;

  await new Promise((resolve, reject) => {
    hrSocket.on("connect", () => {
      console.log("HR socket connected successfully");
      hrSocket.emit("hr:watch", { examId: exam.id });
      resolve();
    });
    hrSocket.on("connect_error", (err) => reject(err));
  });

  hrSocket.on("live:event", (ev) => {
    if (ev.attemptId === attempt.id) {
      console.log(`[HR received live:event] type=${ev.type}, message="${ev.message}", severity=${ev.severity}, violations=${ev.multiFaceViolations}, autoSubmitted=${ev.autoSubmitted}`);
      hrEvents.push(ev);
    }
  });

  hrSocket.on("live:ended", (ended) => {
    if (ended.attemptId === attempt.id) {
      console.log(`[HR received live:ended] status=${ended.status}`);
      hrEndedStatus = ended.status;
    }
  });

  const csrfToken = "test-csrf-token-1234567890";

  // Helper to post proctor events
  async function postEvent(msg, meta = {}) {
    const res = await fetch(`${API_BASE}/attempts/${attempt.id}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `zv_session=${candToken}; zv_csrf=${csrfToken}`,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        events: [
          {
            type: "MULTIPLE_FACES",
            occurredAt: new Date().toISOString(),
            message: msg,
            meta,
          },
        ],
      }),
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      console.error(`postEvent HTTP ${res.status}:`, text);
      return { error: text, status: res.status };
    }
  }

  // 5. Test Detections 1 and 2 (Warnings, allowed to continue)
  console.log("\n--- Testing Detections 1 and 2 (allowed warnings) ---");
  for (let i = 1; i <= 2; i++) {
    const res = await postEvent(`Multiple faces detected (Warning ${i}/2)`, {
      faceCount: 2,
      violationCount: i,
      maxAllowed: 2,
    });
    console.log(`Detection ${i} posted: accepted = ${res.accepted}`);

    // Verify DB state
    const curAttempt = await prisma.attempt.findUnique({
      where: { id: attempt.id },
    });
    const multiCount = await prisma.proctorEvent.count({
      where: { attemptId: attempt.id, type: "MULTIPLE_FACES" },
    });

    if (curAttempt.status !== "IN_PROGRESS") {
      throw new Error(`Attempt should be IN_PROGRESS after detection ${i}, but is ${curAttempt.status}`);
    }
    if (multiCount !== i) {
      throw new Error(`Expected DB proctorEvent count ${i}, got ${multiCount}`);
    }
    if (curAttempt.clientInfo?.multiFaceViolations !== i) {
      throw new Error(`Expected clientInfo.multiFaceViolations ${i}, got ${curAttempt.clientInfo?.multiFaceViolations}`);
    }
    console.log(`✓ Detection ${i}: Status is IN_PROGRESS, DB violations count = ${multiCount}/2`);
    await new Promise((r) => setTimeout(r, 200));
  }

  // Check state endpoint before 3rd detection
  const stateResRaw = await fetch(`${API_BASE}/attempts/${attempt.id}/state`, {
    headers: { Cookie: `zv_session=${candToken}` },
  });
  const stateResText = await stateResRaw.text();
  let stateRes;
  try {
    stateRes = JSON.parse(stateResText);
  } catch {
    console.error(`state endpoint HTTP ${stateResRaw.status}:`, stateResText);
  }
  console.log(`state endpoint response (HTTP ${stateResRaw.status}):`, stateRes);
  if (stateRes.finished !== false || stateRes.multiFaceCount !== 2) {
    throw new Error(`State before 3rd detection invalid: finished=${stateRes.finished}, count=${stateRes.multiFaceCount}`);
  }
  console.log(`✓ GET /state verifies: finished = false, multiFaceCount = 2`);

  // 6. Test 3rd Detection: Must immediately auto-submit
  console.log("\n--- Testing 3rd Detection (Trigger Immediate Auto-Submission) ---");
  const res3 = await postEvent("3rd multiple-face detection (2 faces): Exam auto-submitted", {
    faceCount: 2,
    violationCount: 3,
    maxAllowed: 2,
    autoSubmitted: true,
  });
  console.log(`Detection 3 posted: accepted = ${res3.accepted}`);

  await new Promise((r) => setTimeout(r, 600));

  // Verify DB status is AUTO_SUBMITTED or EVALUATED
  const finalAttempt = await prisma.attempt.findUnique({
    where: { id: attempt.id },
  });
  const finalCount = await prisma.proctorEvent.count({
    where: { attemptId: attempt.id, type: "MULTIPLE_FACES" },
  });

  if (!["AUTO_SUBMITTED", "EVALUATED"].includes(finalAttempt.status)) {
    throw new Error(`Expected status AUTO_SUBMITTED or EVALUATED, got ${finalAttempt.status}`);
  }
  if (finalCount !== 3) {
    throw new Error(`Expected 3 DB proctor events, got ${finalCount}`);
  }
  if (finalAttempt.clientInfo?.autoSubmittedReason !== "MULTIPLE_FACES") {
    throw new Error(`Expected autoSubmittedReason "MULTIPLE_FACES", got ${finalAttempt.clientInfo?.autoSubmittedReason}`);
  }
  console.log(`✓ Final attempt status in DB: ${finalAttempt.status} (submittedAt: ${finalAttempt.submittedAt})`);
  console.log("✓ clientInfo.autoSubmittedReason in DB: MULTIPLE_FACES");
  console.log("✓ Total MULTIPLE_FACES proctor events in DB: 3");

  // Verify candidate lockout
  console.log("\n--- Testing Candidate Lockout ---");
  const ansRes = await fetch(`${API_BASE}/attempts/${attempt.id}/answers`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: `zv_session=${candToken}; zv_csrf=${csrfToken}`,
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify({
      answers: [{ questionId: question.id, selectedOptionIds: [question.options[0]?.id ?? "o1"] }],
    }),
  });
  if (ansRes.status !== 409) {
    throw new Error(`Expected 409 Conflict when submitting answers after exam ended, got ${ansRes.status}`);
  }
  console.log("✓ PUT /answers correctly rejected with 409 Conflict");

  const stateAfterRes = await fetch(`${API_BASE}/attempts/${attempt.id}/state`, {
    headers: { Cookie: `zv_session=${candToken}` },
  }).then((r) => r.json());
  if (stateAfterRes.finished !== true || stateAfterRes.autoSubmittedReason !== "MULTIPLE_FACES" || stateAfterRes.multiFaceCount !== 3) {
    throw new Error(`State after auto-submission mismatch: ${JSON.stringify(stateAfterRes)}`);
  }
  console.log(`✓ GET /state after auto-submit verifies: finished = true, autoSubmittedReason = "MULTIPLE_FACES", multiFaceCount = 3`);

  // Verify HR dashboard received events and live:ended
  console.log("\n--- Verifying Admin/HR Real-time Notifications ---");
  const autoSubmitEvent = hrEvents.find((e) => e.autoSubmitted === true);
  if (!autoSubmitEvent) {
    throw new Error("HR did not receive auto-submit event over socket!");
  }
  console.log("✓ HR received real-time auto-submit alert event:", autoSubmitEvent.message);

  if (hrEndedStatus !== "AUTO_SUBMITTED") {
    throw new Error(`Expected HR live:ended status "AUTO_SUBMITTED", got ${hrEndedStatus}`);
  }
  console.log("✓ HR received real-time live:ended notification with status AUTO_SUBMITTED");

  // Cleanup test attempt
  await prisma.attempt.delete({ where: { id: attempt.id } });
  console.log("Cleaned up test attempt.");

  hrSocket.disconnect();
  await prisma.$disconnect();

  console.log("\n========================================================");
  console.log(" ALL 8 EXPECTED BEHAVIOURS VERIFIED SUCCESSFULLY! ✓✓✓");
  console.log("========================================================");
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

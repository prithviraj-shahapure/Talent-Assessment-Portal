/* eslint-disable no-console */
/**
 * Development seed — WIPES ALL DATA and loads demo content.
 * Run with: npm run db:seed
 */
import bcrypt from "bcryptjs";
import { prisma, type Difficulty, type QuestionType, type PipelineStage } from "../src/lib/prisma";
import { buildPaper, evaluateAttempt, type Paper } from "../src/lib/engine";
import { recordEvent } from "../src/lib/risk";

let seed = 20261103;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
const days = (n: number) => new Date(Date.now() + n * 86400_000);
const minutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

type Q = { type: QuestionType; text: string; cat: string; diff: Difficulty; marks?: number; neg?: number; options?: [string, boolean][]; accepted?: string[]; tol?: number; explanation?: string; lang?: string; starter?: string; tags?: string[] };

const QUESTIONS: Q[] = [
  // Quantitative aptitude
  { type: "SINGLE", cat: "Quantitative Aptitude", diff: "EASY", text: "A CNC machine produces 48 components in 6 hours. How many components will it produce in 9 hours at the same rate?", options: [["64", false], ["72", true], ["78", false], ["81", false]], neg: 0.25 },
  { type: "SINGLE", cat: "Quantitative Aptitude", diff: "MEDIUM", text: "The price of a casting rose from ₹1,250 to ₹1,400. What is the percentage increase?", options: [["10%", false], ["11.2%", false], ["12%", true], ["15%", false]], neg: 0.25 },
  { type: "NUMERICAL", cat: "Quantitative Aptitude", diff: "EASY", text: "A shaft rotates at 1,500 rpm. How many revolutions does it make per second?", accepted: ["25"], tol: 0, marks: 2 },
  { type: "SINGLE", cat: "Quantitative Aptitude", diff: "MEDIUM", text: "Two machines A and B can finish a batch in 12 hours and 18 hours respectively. Working together, how long will they take?", options: [["6.6 hours", false], ["7.2 hours", true], ["7.5 hours", false], ["8 hours", false]], neg: 0.25 },
  { type: "NUMERICAL", cat: "Quantitative Aptitude", diff: "MEDIUM", text: "Out of 800 inspected parts, 18 were rejected. What is the rejection rate in percent? (round to 2 decimals)", accepted: ["2.25"], tol: 0.01, marks: 2 },
  { type: "SINGLE", cat: "Quantitative Aptitude", diff: "HARD", text: "A tank is filled by pipe P in 20 min and emptied by pipe Q in 30 min. If both are opened together on an empty tank, when will it be full?", options: [["50 min", false], ["60 min", true], ["45 min", false], ["40 min", false]], neg: 0.25 },
  // Logical reasoning
  { type: "SINGLE", cat: "Logical Reasoning", diff: "EASY", text: "Find the next number in the series: 3, 7, 15, 31, 63, ?", options: [["95", false], ["127", true], ["125", false], ["131", false]], neg: 0.25 },
  { type: "SINGLE", cat: "Logical Reasoning", diff: "MEDIUM", text: "If LATHE is coded as MBUIF, how is DRILL coded?", options: [["ESJMM", true], ["ESHMM", false], ["CSJMM", false], ["ERJMM", false]], neg: 0.25 },
  { type: "TRUE_FALSE", cat: "Logical Reasoning", diff: "EASY", text: "Statement: All gauges are calibrated. Some calibrated instruments are digital. Conclusion: Some gauges are definitely digital.", options: [["True", false], ["False", true]] },
  { type: "SINGLE", cat: "Logical Reasoning", diff: "MEDIUM", text: "Pointing to a man, Ravi said, \"His mother is the only daughter of my mother.\" How is the man related to Ravi?", options: [["Brother", false], ["Nephew", true], ["Cousin", false], ["Son", false]], neg: 0.25 },
  { type: "MULTIPLE", cat: "Logical Reasoning", diff: "HARD", text: "Which of the following numbers are divisible by both 4 and 6?", options: [["36", true], ["42", false], ["60", true], ["84", true], ["90", false]], marks: 2 },
  // Mechanical engineering
  { type: "SINGLE", cat: "Mechanical Engineering", diff: "EASY", text: "Which property allows a material to be drawn into thin wires?", options: [["Malleability", false], ["Ductility", true], ["Hardness", false], ["Brittleness", false]], neg: 0.25 },
  { type: "SINGLE", cat: "Mechanical Engineering", diff: "MEDIUM", text: "The ratio of lateral strain to longitudinal strain is called:", options: [["Young's modulus", false], ["Bulk modulus", false], ["Poisson's ratio", true], ["Shear modulus", false]], neg: 0.25 },
  { type: "TRUE_FALSE", cat: "Mechanical Engineering", diff: "EASY", text: "Grey cast iron has better vibration damping capacity than mild steel.", options: [["True", true], ["False", false]] },
  { type: "SINGLE", cat: "Mechanical Engineering", diff: "MEDIUM", text: "In a four-stroke engine, the camshaft rotates at:", options: [["Twice the crankshaft speed", false], ["Same speed as the crankshaft", false], ["Half the crankshaft speed", true], ["One-fourth of the crankshaft speed", false]], neg: 0.25 },
  { type: "MULTIPLE", cat: "Mechanical Engineering", diff: "MEDIUM", text: "Which of the following are heat treatment processes?", options: [["Annealing", true], ["Knurling", false], ["Normalising", true], ["Tempering", true], ["Reaming", false]], marks: 2 },
  { type: "NUMERICAL", cat: "Mechanical Engineering", diff: "HARD", text: "A steel bar of cross-section 100 mm² carries an axial load of 20 kN. What is the stress in N/mm² (MPa)?", accepted: ["200"], tol: 0, marks: 2 },
  { type: "SHORT", cat: "Mechanical Engineering", diff: "EASY", text: "What does the abbreviation GD&T stand for?", accepted: ["Geometric Dimensioning and Tolerancing", "Geometrical Dimensioning and Tolerancing", "Geometric Dimensioning & Tolerancing"] },
  // Manufacturing & machining
  { type: "SINGLE", cat: "Manufacturing & Machining", diff: "EASY", text: "Indexable turning inserts are most commonly made of:", options: [["High-speed steel", false], ["Tungsten carbide", true], ["Mild steel", false], ["Cast iron", false]], neg: 0.25 },
  { type: "SINGLE", cat: "Manufacturing & Machining", diff: "MEDIUM", text: "In the ISO insert designation CNMG 120408, the digits '08' indicate:", options: [["Insert thickness 0.8 mm", false], ["Nose radius 0.8 mm", true], ["Cutting edge length 8 mm", false], ["Clearance angle 8°", false]], neg: 0.25 },
  { type: "SINGLE", cat: "Manufacturing & Machining", diff: "MEDIUM", text: "Which casting defect is caused by gas entrapment in the molten metal?", options: [["Cold shut", false], ["Blowhole", true], ["Hot tear", false], ["Misrun", false]], neg: 0.25 },
  { type: "NUMERICAL", cat: "Manufacturing & Machining", diff: "MEDIUM", text: "Calculate the spindle speed (rpm) for turning a Ø100 mm bar at a cutting speed of 157 m/min. (Use π = 3.14)", accepted: ["500"], tol: 1, marks: 2 },
  { type: "TRUE_FALSE", cat: "Manufacturing & Machining", diff: "EASY", text: "In an HMC (horizontal machining centre), the spindle axis is horizontal.", options: [["True", true], ["False", false]] },
  { type: "MULTIPLE", cat: "Manufacturing & Machining", diff: "HARD", text: "Which of the following increase tool life in turning?", options: [["Reducing cutting speed", true], ["Using appropriate coolant", true], ["Increasing depth of cut excessively", false], ["Using a coated carbide insert", true]], marks: 2 },
  { type: "SINGLE", cat: "Manufacturing & Machining", diff: "HARD", text: "Taylor's tool life equation is expressed as:", options: [["VT = C", false], ["VTⁿ = C", true], ["V/Tⁿ = C", false], ["VⁿT = C", false]], neg: 0.25 },
  { type: "DESCRIPTIVE", cat: "Manufacturing & Machining", diff: "MEDIUM", text: "A batch of machined brackets shows bore diameters drifting towards the upper tolerance limit over a shift. List the likely causes and describe how you would investigate and correct the problem.", marks: 10 },
  // Quality & metrology
  { type: "SINGLE", cat: "Quality & Metrology", diff: "EASY", text: "Which instrument is most suitable for measuring a bore diameter of 25 ± 0.01 mm?", options: [["Steel rule", false], ["Vernier caliper (0.02 mm)", false], ["Bore gauge / air gauge", true], ["Measuring tape", false]], neg: 0.25 },
  { type: "SINGLE", cat: "Quality & Metrology", diff: "MEDIUM", text: "A process with Cpk = 1.33 indicates that:", options: [["The process is not capable", false], ["The process is capable with ±4σ to the nearest limit", true], ["The process mean is outside the limits", false], ["There is no variation", false]], neg: 0.25 },
  { type: "MULTIPLE", cat: "Quality & Metrology", diff: "MEDIUM", text: "Select all non-destructive testing (NDT) methods.", options: [["Ultrasonic testing", true], ["Tensile testing", false], ["Magnetic particle inspection", true], ["Dye penetrant testing", true], ["Charpy impact test", false]], marks: 2 },
  { type: "SHORT", cat: "Quality & Metrology", diff: "EASY", text: "Expand the abbreviation PPAP.", accepted: ["Production Part Approval Process"] },
  { type: "TRUE_FALSE", cat: "Quality & Metrology", diff: "EASY", text: "In a control chart, a point outside the control limits always means the part is out of specification.", options: [["True", false], ["False", true]] },
  { type: "SINGLE", cat: "Quality & Metrology", diff: "HARD", text: "Which of the 7 QC tools is best suited to identify the vital few causes contributing to most defects?", options: [["Histogram", false], ["Pareto chart", true], ["Scatter diagram", false], ["Check sheet", false]], neg: 0.25 },
  { type: "DESCRIPTIVE", cat: "Quality & Metrology", diff: "MEDIUM", text: "Explain the PDCA cycle with an example from a machining or foundry shop floor.", marks: 5 },
  { type: "SINGLE", cat: "Quality & Metrology", diff: "MEDIUM", text: "The least count of a metric micrometer with 0.5 mm pitch and 50 thimble divisions is:", options: [["0.1 mm", false], ["0.02 mm", false], ["0.01 mm", true], ["0.001 mm", false]], neg: 0.25 },
  // Electrical
  { type: "SINGLE", cat: "Electrical Engineering", diff: "EASY", text: "The unit of electrical resistance is:", options: [["Volt", false], ["Ampere", false], ["Ohm", true], ["Watt", false]] },
  { type: "NUMERICAL", cat: "Electrical Engineering", diff: "MEDIUM", text: "A 230 V heater draws 5 A. What is its power in watts?", accepted: ["1150"], tol: 0, marks: 2 },
  { type: "TRUE_FALSE", cat: "Electrical Engineering", diff: "MEDIUM", text: "A three-phase induction motor's rotor speed is always slightly less than the synchronous speed during normal operation.", options: [["True", true], ["False", false]] },
  { type: "SINGLE", cat: "Electrical Engineering", diff: "MEDIUM", text: "Which device protects a motor circuit against sustained overload?", options: [["Fuse only", false], ["Thermal overload relay", true], ["Capacitor", false], ["Transformer", false]], neg: 0.25 },
  // Programming
  { type: "SINGLE", cat: "Programming", diff: "EASY", text: "What is the output of: print(len([1, [2, 3], 4])) in Python?", options: [["3", true], ["4", false], ["2", false], ["Error", false]] },
  { type: "SINGLE", cat: "Programming", diff: "MEDIUM", text: "Which SQL clause filters rows after aggregation?", options: [["WHERE", false], ["HAVING", true], ["GROUP BY", false], ["ORDER BY", false]] },
  { type: "MULTIPLE", cat: "Programming", diff: "MEDIUM", text: "Which of these are valid HTTP methods?", options: [["GET", true], ["PATCH", true], ["FETCH", false], ["DELETE", true]], marks: 2 },
  { type: "TRUE_FALSE", cat: "Programming", diff: "EASY", text: "In JavaScript, `===` compares both value and type.", options: [["True", true], ["False", false]] },
  { type: "SHORT", cat: "Programming", diff: "MEDIUM", text: "Which data structure works on the First-In-First-Out (FIFO) principle?", accepted: ["Queue", "A queue"] },
  { type: "CODING", cat: "Programming", diff: "MEDIUM", lang: "python", marks: 10, text: "Write a function `oee(availability, performance, quality)` that returns Overall Equipment Effectiveness as a percentage rounded to one decimal place. Then write a second function that, given a list of daily OEE values, returns the longest run of consecutive days with OEE ≥ 85.", starter: "def oee(availability: float, performance: float, quality: float) -> float:\n    # your code here\n    pass\n\n\ndef longest_good_run(values: list[float]) -> int:\n    # your code here\n    pass\n" },
  { type: "CODING", cat: "Programming", diff: "HARD", lang: "javascript", marks: 10, text: "Given an array of machine downtime events `{ machine: string, start: number, end: number }` (minutes), write a function that returns total downtime per machine, merging overlapping intervals for the same machine.", starter: "function downtimeByMachine(events) {\n  // your code here\n}\n" },
  { type: "DESCRIPTIVE", cat: "Programming", diff: "MEDIUM", marks: 5, text: "Describe how you would design a simple system to collect cycle-time data from CNC machines and show it on a dashboard. Mention the main components and data flow." },
];

const FIRST = ["Aarav", "Aditya", "Akash", "Aniket", "Ankita", "Atharva", "Gauri", "Harshad", "Ishita", "Kunal", "Mansi", "Neha", "Omkar", "Pooja", "Prathamesh", "Priya", "Rohan", "Rutuja", "Sakshi", "Sanket", "Shreya", "Siddharth", "Snehal", "Sourabh", "Tanvi", "Tejas", "Vaishnavi", "Yash"];
const LAST = ["Patil", "Kulkarni", "Jadhav", "Deshmukh", "Shinde", "Pawar", "Chougule", "Mane", "Desai", "Joshi", "Kadam", "Gaikwad", "Salunkhe", "Shirke", "More", "Bhosale"];
const COLLEGES = [
  "KIT's College of Engineering, Kolhapur",
  "D.K.T.E. Society's Textile & Engineering Institute, Ichalkaranji",
  "Walchand College of Engineering, Sangli",
  "Rajarambapu Institute of Technology, Islampur",
  "D. Y. Patil College of Engineering & Technology, Kolhapur",
  "Sanjay Ghodawat University, Kolhapur",
  "Government Polytechnic, Kolhapur",
  "Shivaji University, Kolhapur",
  "COEP Technological University, Pune",
];
const BRANCHES: Record<string, string[]> = {
  "B.E.": ["Mechanical Engineering", "Production Engineering", "Electrical Engineering", "Computer Science & Engineering", "Automobile Engineering"],
  "B.Tech": ["Mechanical Engineering", "Computer Science & Engineering", "Electronics & Telecommunication"],
  Diploma: ["Mechanical Engineering", "Production Technology", "Electrical Engineering"],
};

async function wipe() {
  const tables = ["AuditLog", "PipelineHistory", "AccommodationRequest", "ConsentRecord", "ProctorEvent", "EvidenceFile", "Answer", "Attempt", "ExamAssignment", "Invitation", "SectionRandomRule", "ExamQuestion", "ExamSection", "Exam", "QuestionOption", "Question", "QuestionCategory", "CandidateProfile", "EmailToken", "Department", "User", "SystemSetting"];
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t}"`).join(", ")} CASCADE`);
}

async function main() {
  console.log("Seeding Zanvar Group Talent Assessment Portal…");
  await wipe();

  const [adminHash, hrHash, candHash] = await Promise.all([bcrypt.hash("Admin@2026", 12), bcrypt.hash("Hr@2026", 12), bcrypt.hash("Candidate@2026", 12)]);
  const superAdmin = await prisma.user.create({ data: { email: "superadmin@zanvargroup.com", name: "System Administrator", role: "SUPER_ADMIN", passwordHash: adminHash, emailVerified: true } });
  const hr = await prisma.user.create({ data: { email: "hr@zanvargroup.com", name: "Meera Kulkarni", role: "HR_ADMIN", passwordHash: hrHash, emailVerified: true } });
  await prisma.user.create({ data: { email: "hr.recruit@zanvargroup.com", name: "Sandeep Shinde", role: "HR_ADMIN", passwordHash: hrHash, emailVerified: true } });

  const deptDefs = [
    ["Production Engineering", "PROD"],
    ["Quality Assurance", "QA"],
    ["Design & Development", "DES"],
    ["Maintenance", "MNT"],
    ["Information Technology", "IT"],
    ["Supply Chain", "SCM"],
  ];
  const depts: Record<string, string> = {};
  for (const [name, code] of deptDefs) depts[code] = (await prisma.department.create({ data: { name, code } })).id;

  const cats: Record<string, string> = {};
  for (const name of [...new Set(QUESTIONS.map((q) => q.cat))]) cats[name] = (await prisma.questionCategory.create({ data: { name } })).id;

  const qIds: Record<string, string[]> = {};
  for (const q of QUESTIONS) {
    const created = await prisma.question.create({
      data: {
        type: q.type,
        text: q.text,
        categoryId: cats[q.cat],
        difficulty: q.diff,
        marks: q.marks ?? 1,
        negativeMarks: q.neg ?? 0,
        acceptedAnswers: q.accepted ?? [],
        numericTolerance: q.tol ?? null,
        explanation: q.explanation ?? null,
        codeLanguage: q.lang ?? null,
        codeStarter: q.starter ?? null,
        tags: q.tags ?? [],
        createdById: hr.id,
        options: q.options ? { create: q.options.map(([text, isCorrect], i) => ({ text, isCorrect, order: i })) } : undefined,
      },
    });
    (qIds[q.cat] ??= []).push(created.id);
  }
  const byCat = (c: string, types?: QuestionType[]) => QUESTIONS.map((q, i) => ({ q, i })).filter(({ q }) => q.cat === c && (!types || types.includes(q.type)));
  const allIds = await prisma.question.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, text: true } });
  const idOf = (text: string) => allIds.find((x) => x.text === text)!.id;

  const instructions = `1. The examination must be taken on a laptop or desktop computer using Google Chrome or Microsoft Edge.
2. Keep your face clearly visible to the webcam throughout. Sit in a well-lit, quiet room, alone.
3. The examination runs in fullscreen. Do not switch tabs, open other applications or exit fullscreen — these actions are logged.
4. Answers are saved automatically. If your connection drops, reconnect and resume — your timer keeps running on the server.
5. The examination is submitted automatically when the time is up.
6. Mobile phones, notes, calculators (unless stated) and other people are not permitted.
7. Flagged activity is reviewed by the HR team. No candidate is disqualified automatically.`;

  // ── Exam 1: live now ──
  const live = await prisma.exam.create({
    data: {
      title: "Graduate Engineer Trainee — Mechanical (Nov 2026)",
      description: "Aptitude and technical assessment for Graduate Engineer Trainee positions in machining and foundry operations.",
      departmentId: depts.PROD,
      position: "Graduate Engineer Trainee (GET) — Mechanical",
      category: "Campus Recruitment",
      status: "PUBLISHED",
      startAt: days(-2),
      endAt: days(14),
      durationMinutes: 45,
      passingMarks: 15,
      negativeMarking: true,
      maxAttempts: 1,
      instructions,
      eligibility: { degrees: ["B.E.", "B.Tech"], graduationYears: [2026, 2027] },
      resultPublication: "MANUAL",
      evidenceCapture: true,
      createdById: hr.id,
      sections: {
        create: [
          { title: "Aptitude & Reasoning", order: 0 },
          { title: "Technical — Mechanical & Manufacturing", order: 1 },
          { title: "Problem Solving (Descriptive)", order: 2 },
        ],
      },
    },
    include: { sections: { orderBy: { order: "asc" } } },
  });
  const [s1, s2, s3] = live.sections;
  const aptitude = [...byCat("Quantitative Aptitude").slice(0, 4), ...byCat("Logical Reasoning").slice(0, 3)];
  await prisma.examQuestion.createMany({ data: aptitude.map(({ q }, i) => ({ sectionId: s1.id, questionId: idOf(q.text), order: i })) });
  const tech = [...byCat("Mechanical Engineering"), ...byCat("Manufacturing & Machining", ["SINGLE", "MULTIPLE", "NUMERICAL", "TRUE_FALSE"])];
  await prisma.examQuestion.createMany({ data: tech.map(({ q }, i) => ({ sectionId: s2.id, questionId: idOf(q.text), order: i })) });
  await prisma.sectionRandomRule.create({ data: { sectionId: s2.id, categoryId: cats["Quality & Metrology"], type: "SINGLE", count: 2, marksEach: 1 } });
  await prisma.examQuestion.create({ data: { sectionId: s3.id, questionId: idOf(QUESTIONS.find((q) => q.type === "DESCRIPTIVE" && q.cat === "Manufacturing & Machining")!.text), order: 0 } });

  // ── Exam 2: completed, results released ──
  const qa = await prisma.exam.create({
    data: {
      title: "Diploma Trainee — Quality Inspection",
      description: "Assessment for diploma trainees joining the Quality Assurance department (inspection & metrology).",
      departmentId: depts.QA,
      position: "Diploma Engineer Trainee — Quality",
      category: "Walk-in Drive",
      status: "PUBLISHED",
      startAt: days(-20),
      endAt: days(-12),
      durationMinutes: 30,
      passingMarks: 9,
      negativeMarking: false,
      maxAttempts: 1,
      instructions,
      resultPublication: "MANUAL",
      resultsReleased: true,
      evidenceCapture: false,
      createdById: hr.id,
      sections: { create: [{ title: "Quality & Metrology", order: 0 }, { title: "General Aptitude", order: 1 }] },
    },
    include: { sections: { orderBy: { order: "asc" } } },
  });
  await prisma.examQuestion.createMany({ data: byCat("Quality & Metrology", ["SINGLE", "MULTIPLE", "TRUE_FALSE", "SHORT"]).map(({ q }, i) => ({ sectionId: qa.sections[0].id, questionId: idOf(q.text), order: i })) });
  await prisma.examQuestion.createMany({ data: [...byCat("Quantitative Aptitude").slice(0, 3), ...byCat("Electrical Engineering").slice(0, 2)].map(({ q }, i) => ({ sectionId: qa.sections[1].id, questionId: idOf(q.text), order: i })) });

  // ── Exam 3: upcoming, timed sections ──
  const it = await prisma.exam.create({
    data: {
      title: "IT Intern — Software Development",
      description: "Programming fundamentals and a coding exercise for the Digital Manufacturing / IT internship.",
      departmentId: depts.IT,
      position: "Software Development Intern",
      category: "Internship",
      status: "PUBLISHED",
      startAt: days(5),
      endAt: days(12),
      durationMinutes: 60,
      passingMarks: 15,
      maxAttempts: 1,
      sectionTimeLimits: true,
      instructions,
      resultPublication: "AFTER_EXAM_END",
      createdById: hr.id,
      sections: { create: [{ title: "Fundamentals", order: 0, timeLimitMinutes: 20 }, { title: "Coding", order: 1, timeLimitMinutes: 40 }] },
    },
    include: { sections: { orderBy: { order: "asc" } } },
  });
  await prisma.examQuestion.createMany({ data: byCat("Programming", ["SINGLE", "MULTIPLE", "TRUE_FALSE", "SHORT"]).map(({ q }, i) => ({ sectionId: it.sections[0].id, questionId: idOf(q.text), order: i })) });
  await prisma.examQuestion.createMany({ data: byCat("Programming", ["CODING", "DESCRIPTIVE"]).map(({ q }, i) => ({ sectionId: it.sections[1].id, questionId: idOf(q.text), order: i })) });

  // ── Exam 4: draft ──
  await prisma.exam.create({
    data: { title: "Maintenance Apprentice Assessment", departmentId: depts.MNT, position: "Maintenance Apprentice (Electrical)", category: "Apprenticeship", status: "DRAFT", startAt: days(20), endAt: days(25), durationMinutes: 40, passingMarks: 10, createdById: hr.id, sections: { create: [{ title: "Electrical Basics", order: 0 }] } },
  });

  // recompute totals
  for (const e of [live, qa, it]) {
    const { maxScore } = await buildPaper(e.id);
    await prisma.exam.update({ where: { id: e.id }, data: { totalMarks: maxScore } });
  }

  await prisma.invitation.createMany({
    data: [
      { examId: live.id, code: "GET-MECH-2026", maxUses: 500, usedCount: 0, createdById: hr.id, expiresAt: days(14) },
      { examId: it.id, code: "IT-INTERN-2026", maxUses: 100, createdById: hr.id, expiresAt: days(12) },
      { examId: qa.id, code: "QA-DIP-2026", maxUses: 200, usedCount: 0, createdById: hr.id },
    ],
  });

  // ── Candidates ──
  const demo = await prisma.user.create({
    data: {
      email: "candidate@example.com",
      name: "Rahul Patil",
      role: "CANDIDATE",
      passwordHash: candHash,
      emailVerified: true,
      candidate: { create: { mobile: "9876543210", college: COLLEGES[0], degree: "B.E.", branch: "Mechanical Engineering", currentYear: "Final Year", graduationYear: 2026, pipeline: { create: { toStage: "REGISTERED", note: "Self-registration" } } } },
    },
    include: { candidate: true },
  });
  await prisma.examAssignment.create({ data: { examId: live.id, candidateId: demo.candidate!.id, invitationCode: "GET-MECH-2026" } });
  await prisma.examAssignment.create({ data: { examId: it.id, candidateId: demo.candidate!.id, invitationCode: "IT-INTERN-2026" } });
  await prisma.candidateProfile.update({ where: { id: demo.candidate!.id }, data: { stage: "EXAM_SCHEDULED" } });

  const used = new Set<string>();
  const people: { userId: string; candidateId: string; degree: string; skill: number; createdAt: Date }[] = [];
  for (let i = 0; i < 34; i++) {
    let name = "";
    do name = `${pick(FIRST)} ${pick(LAST)}`;
    while (used.has(name));
    used.add(name);
    const degree = i < 18 ? pick(["B.E.", "B.Tech"]) : i < 28 ? "Diploma" : "B.E.";
    const createdAt = days(-Math.floor(rand() * 29) - (i < 18 ? 0 : 0));
    const u = await prisma.user.create({
      data: {
        email: `${name.toLowerCase().replace(/\s+/g, ".")}${i}@example.com`,
        name,
        role: "CANDIDATE",
        passwordHash: candHash,
        emailVerified: rand() > 0.08,
        createdAt,
        candidate: {
          create: {
            mobile: `9${Math.floor(100000000 + rand() * 899999999)}`,
            college: degree === "Diploma" ? pick([COLLEGES[6], COLLEGES[1], COLLEGES[4]]) : pick(COLLEGES.filter((_, k) => k !== 6)),
            degree,
            branch: pick(BRANCHES[degree]),
            currentYear: pick(["Final Year", "Third Year", "Graduated"]),
            graduationYear: pick([2025, 2026, 2026, 2027]),
            createdAt,
            pipeline: { create: { toStage: "REGISTERED", note: "Self-registration", createdAt } },
          },
        },
      },
      include: { candidate: true },
    });
    people.push({ userId: u.id, candidateId: u.candidate!.id, degree, skill: 0.35 + rand() * 0.6, createdAt });
  }

  async function simulate(examId: string, p: (typeof people)[number], startedAt: Date, opts: { flag?: "low" | "medium" | "high"; descriptive?: boolean }) {
    const exam = await prisma.exam.findUniqueOrThrow({ where: { id: examId } });
    const { paper, maxScore } = await buildPaper(examId);
    const taken = Math.floor(exam.durationMinutes * (0.55 + rand() * 0.4));
    const submittedAt = minutes(startedAt, taken);
    const attempt = await prisma.attempt.create({
      data: {
        examId,
        candidateId: p.candidateId,
        attemptNo: 1,
        status: rand() > 0.9 ? "AUTO_SUBMITTED" : "SUBMITTED",
        startedAt,
        deadlineAt: minutes(startedAt, exam.durationMinutes),
        submittedAt,
        paper: paper as unknown as object,
        maxScore,
        sectionStartedAt: startedAt,
        clientInfo: { webcamRequired: true, microphoneRequired: true, evidenceConsent: exam.evidenceCapture, userAgent: "Chrome 130 / Windows 11" },
        ipAddress: "10.0.12." + Math.floor(rand() * 200),
      },
    });
    const qs = await prisma.question.findMany({ where: { id: { in: (paper as Paper).flatMap((s) => s.questions.map((q) => q.questionId)) } }, include: { options: true } });
    for (const q of qs) {
      if (rand() > 0.93) continue; // unanswered
      const correct = rand() < p.skill;
      let selectedOptionIds: string[] = [];
      let textAnswer: string | null = null;
      if (q.type === "SINGLE" || q.type === "TRUE_FALSE") selectedOptionIds = [correct ? q.options.find((o) => o.isCorrect)!.id : pick(q.options.filter((o) => !o.isCorrect)).id];
      else if (q.type === "MULTIPLE") selectedOptionIds = correct ? q.options.filter((o) => o.isCorrect).map((o) => o.id) : [q.options[0].id];
      else if (q.type === "NUMERICAL") textAnswer = correct ? q.acceptedAnswers[0] : String(Number(q.acceptedAnswers[0]) + 7);
      else if (q.type === "SHORT") textAnswer = correct ? q.acceptedAnswers[0] : "Not sure";
      else if (q.type === "DESCRIPTIVE" && opts.descriptive)
        textAnswer =
          "Likely causes: tool wear on the boring bar insert, thermal growth of the spindle during the shift, coolant concentration changes, and offset drift. I would first plot bore size against time using the hourly SPC data, check insert wear at the point of drift, verify machine warm-up practice and coolant temperature, and then correct by setting a tool-life counter, adding in-process gauging with automatic offset compensation and standardising warm-up cycles.";
      else if (q.type === "DESCRIPTIVE") continue;
      await prisma.answer.create({ data: { attemptId: attempt.id, questionId: q.id, selectedOptionIds, textAnswer, savedAt: minutes(startedAt, Math.floor(rand() * taken)) } });
    }
    await evaluateAttempt(attempt.id);
    // proctoring events
    const evs: [string, number][] = [];
    if (opts.flag === "low") evs.push(["TAB_SWITCH", 4], ["TAB_SWITCH", 9], ["FOCUS_LOST", 12], ["FOCUS_LOST", 20], ["COPY", 15]);
    if (opts.flag === "medium") evs.push(["TAB_SWITCH", 3], ["TAB_SWITCH", 6], ["TAB_SWITCH", 11], ["FULLSCREEN_EXIT", 7], ["FACE_MISSING", 13], ["PASTE", 14], ["FOCUS_LOST", 16], ["FOCUS_LOST", 19]);
    if (opts.flag === "high") evs.push(["MULTIPLE_FACES", 5], ["FACE_MISSING", 8], ["MULTIPLE_FACES", 14], ["TAB_SWITCH", 9], ["TAB_SWITCH", 12], ["FULLSCREEN_EXIT", 10], ["CAMERA_DISCONNECTED", 17], ["PASTE", 18]);
    if (!opts.flag && rand() > 0.5) evs.push(["FOCUS_LOST", 6], ["AUDIO_ACTIVITY", 10]);
    for (const [type, m] of evs) await recordEvent(attempt.id, { type, occurredAt: minutes(startedAt, m), meta: { simulated: true } });
    return prisma.attempt.findUniqueOrThrow({ where: { id: attempt.id } });
  }

  async function setStage(candidateId: string, history: PipelineStage[], at: Date) {
    let prev: PipelineStage = "REGISTERED";
    for (const [i, s] of history.entries()) {
      await prisma.pipelineHistory.create({ data: { candidateId, fromStage: prev, toStage: s, createdAt: minutes(at, i * 60), changedById: ["SHORTLISTED", "INTERVIEW", "SELECTED", "REJECTED"].includes(s) ? hr.id : null, note: ["SHORTLISTED", "INTERVIEW", "SELECTED", "REJECTED"].includes(s) ? "HR decision" : "Automatic update" } });
      prev = s;
    }
    await prisma.candidateProfile.update({ where: { id: candidateId }, data: { stage: prev } });
  }

  // Completed QA exam — diploma candidates
  const diploma = people.filter((p) => p.degree === "Diploma");
  const qaFlags: (undefined | "low" | "medium" | "high")[] = [undefined, "low", undefined, "medium", undefined, undefined, "high", undefined, "low", undefined];
  const qaAttempts = [];
  for (const [i, p] of diploma.entries()) {
    await prisma.examAssignment.create({ data: { examId: qa.id, candidateId: p.candidateId, invitationCode: "QA-DIP-2026", assignedAt: days(-21) } });
    const a = await simulate(qa.id, p, minutes(days(-19 + (i % 6)), 600 + i * 7), { flag: qaFlags[i % qaFlags.length] });
    qaAttempts.push({ p, a });
  }
  await prisma.invitation.update({ where: { code: "QA-DIP-2026" }, data: { usedCount: diploma.length } });
  qaAttempts.sort((x, y) => (y.a.score ?? 0) - (x.a.score ?? 0));
  for (const [i, { p, a }] of qaAttempts.entries()) {
    const base: PipelineStage[] = ["EXAM_SCHEDULED", "EXAM_COMPLETED", "EVALUATION"];
    const extra: PipelineStage[] = i === 0 ? ["SHORTLISTED", "INTERVIEW", "SELECTED"] : i === 1 ? ["SHORTLISTED", "INTERVIEW"] : i < 4 && a.riskLevel !== "HIGH" ? ["SHORTLISTED"] : a.passed === false && i > 6 ? ["REJECTED"] : [];
    await setStage(p.candidateId, [...base, ...extra], days(-18));
  }

  // Live GET exam — engineering candidates: some submitted (descriptive pending), rest scheduled
  const eng = people.filter((p) => p.degree !== "Diploma");
  const liveFlags: (undefined | "low" | "medium" | "high")[] = [undefined, "medium", undefined, "low", undefined, "high", undefined];
  for (const [i, p] of eng.entries()) {
    const prof = await prisma.candidateProfile.findUniqueOrThrow({ where: { id: p.candidateId } });
    if (![2026, 2027].includes(prof.graduationYear)) {
      await prisma.candidateProfile.update({ where: { id: p.candidateId }, data: { graduationYear: 2026 } });
    }
    await prisma.examAssignment.create({ data: { examId: live.id, candidateId: p.candidateId, invitationCode: "GET-MECH-2026", assignedAt: days(-3) } });
    if (i < 9) {
      await simulate(live.id, p, minutes(days(-1 - (i % 2)), 540 + i * 11), { flag: liveFlags[i % liveFlags.length], descriptive: true });
      await setStage(p.candidateId, ["EXAM_SCHEDULED", "EXAM_COMPLETED"], days(-2));
    } else {
      await setStage(p.candidateId, ["ELIGIBLE", "EXAM_SCHEDULED"], days(-3));
    }
  }
  await prisma.invitation.update({ where: { code: "GET-MECH-2026" }, data: { usedCount: eng.length + 1 } });

  // A couple of IT intern assignments & an accommodation request
  for (const p of eng.slice(-4)) await prisma.examAssignment.create({ data: { examId: it.id, candidateId: p.candidateId, invitationCode: "IT-INTERN-2026" } });
  await prisma.accommodationRequest.create({
    data: { examId: live.id, candidateId: eng[12].candidateId, reason: "My laptop's built-in microphone is faulty and I cannot arrange an external microphone before the exam window closes. Requesting to take the exam with webcam only." },
  });

  await prisma.auditLog.createMany({
    data: [
      { action: "auth.login", entity: "User", entityId: superAdmin.id, userId: superAdmin.id, ipAddress: "10.0.12.4", createdAt: days(-1) },
      { action: "exam.published", entity: "Exam", entityId: live.id, userId: hr.id, details: { title: live.title }, ipAddress: "10.0.12.18", createdAt: days(-3) },
      { action: "exam.results_released", entity: "Exam", entityId: qa.id, userId: hr.id, ipAddress: "10.0.12.18", createdAt: days(-11) },
      { action: "seed.loaded", details: { note: "Demo data loaded" } },
    ],
  });

  console.log(`
Seed complete.
  Super Admin : superadmin@zanvargroup.com / Admin@2026
  HR Admin    : hr@zanvargroup.com / Hr@2026
  Candidate   : candidate@example.com / Candidate@2026  (assigned to the live GET exam)
  Invite codes: GET-MECH-2026 (live) · IT-INTERN-2026 (upcoming) · QA-DIP-2026 (closed)
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

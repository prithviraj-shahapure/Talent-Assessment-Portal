/* eslint-disable no-console */
/**
 * Production-ready clean database seed.
 * Seeds initial Super Admin, HR Admin, standard engineering departments,
 * system settings, and reusable question categories.
 * No dummy candidates or simulated examination attempts.
 */
import bcrypt from "bcryptjs";
import { prisma, type Difficulty, type QuestionType } from "../src/lib/prisma";
import { DEFAULT_SETTINGS } from "../src/lib/settings";

type Q = {
  type: QuestionType;
  text: string;
  cat: string;
  diff: Difficulty;
  marks?: number;
  neg?: number;
  options?: [string, boolean][];
  accepted?: string[];
  tol?: number;
  explanation?: string;
  lang?: string;
  starter?: string;
  promptMeta?: any;
  tags?: string[];
};

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
  // Quality & metrology
  { type: "SINGLE", cat: "Quality & Metrology", diff: "EASY", text: "Which instrument is most suitable for measuring a bore diameter of 25 ± 0.01 mm?", options: [["Steel rule", false], ["Vernier caliper (0.02 mm)", false], ["Bore gauge / air gauge", true], ["Measuring tape", false]], neg: 0.25 },
  { type: "SINGLE", cat: "Quality & Metrology", diff: "MEDIUM", text: "A process with Cpk = 1.33 indicates that:", options: [["The process is not capable", false], ["The process is capable with ±4σ to the nearest limit", true], ["The process mean is outside the limits", false], ["There is no variation", false]], neg: 0.25 },
  { type: "MULTIPLE", cat: "Quality & Metrology", diff: "MEDIUM", text: "Select all non-destructive testing (NDT) methods.", options: [["Ultrasonic testing", true], ["Tensile testing", false], ["Magnetic particle inspection", true], ["Dye penetrant testing", true], ["Charpy impact test", false]], marks: 2 },
  { type: "SHORT", cat: "Quality & Metrology", diff: "EASY", text: "Expand the abbreviation PPAP.", accepted: ["Production Part Approval Process"] },
  { type: "TRUE_FALSE", cat: "Quality & Metrology", diff: "EASY", text: "In a control chart, a point outside the control limits always means the part is out of specification.", options: [["True", false], ["False", true]] },
  { type: "SINGLE", cat: "Quality & Metrology", diff: "HARD", text: "Which of the 7 QC tools is best suited to identify the vital few causes contributing to most defects?", options: [["Histogram", false], ["Pareto chart", true], ["Scatter diagram", false], ["Check sheet", false]], neg: 0.25 },
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
  // Prompt Engineering Module (CSE, AIML, Data Science)
  {
    type: "PROMPT",
    cat: "Prompt Engineering",
    diff: "HARD",
    marks: 10,
    text: "Zero-Downtime Microservices Database Migration Prompt (CSE Track)",
    promptMeta: {
      title: "Zero-Downtime Microservices Database Migration Prompt",
      scenario: "You are the Principal Database Engineer for an e-commerce platform processing 10,000 orders/minute. The order database runs on PostgreSQL 15. The 'orders' table contains 50M rows. You must add a non-nullable 'fulfillment_hub_id' UUID column with a foreign key constraint and backfill historical data from a legacy warehouse lookup without taking write locks or exceeding 50ms lock timeouts.",
      requirements: [
        "Define an authoritative system persona and operating constraints.",
        "Request a multi-phase backward-compatible migration plan (DDL, backfill batching, triggers, validation).",
        "Mandate explicit statement_timeout and lock_timeout safety controls.",
        "Require automated verification queries and a rollback trigger.",
        "Output strictly valid JSON conforming to an execution plan schema."
      ],
      expectedOutput: "Valid JSON schema detailing phase sequence, SQL scripts, backfill queries, and rollback triggers.",
      maxAttempts: 2,
    },
    tags: ["cse", "prompt-engineering", "databases", "postgresql"],
  },
  {
    type: "PROMPT",
    cat: "Prompt Engineering",
    diff: "HARD",
    marks: 10,
    text: "Few-Shot Chain-of-Thought Defect Classification Prompt (AIML Track)",
    promptMeta: {
      title: "Few-Shot Chain-of-Thought Defect Classification Prompt",
      scenario: "An automated optical inspection (AOI) vision system in Zanvar Group's high-pressure die casting foundry inspects engine blocks. The computer vision model confuses minor hairline surface oxidation with critical subsurface shrinkage porosity. Formulate a Few-Shot Chain-of-Thought (CoT) system prompt to classify defects from visual sensor measurements and telemetry.",
      requirements: [
        "Define strict taxonomy and definitions for 4 defect classes: Blowhole, Cold Shut, Shrinkage Porosity, and Surface Oxidation.",
        "Provide 2 complete Few-Shot exemplars demonstrating step-by-step physical reasoning.",
        "Enforce strict JSON output with defectType, confidenceScore (0.00 to 1.00), and rootCauseReasoning.",
        "Include rejection criteria for indeterminate or blurred sensor captures."
      ],
      expectedOutput: "Valid JSON schema with defectType, confidenceScore, and rootCauseReasoning.",
      maxAttempts: 2,
    },
    tags: ["aiml", "prompt-engineering", "computer-vision", "manufacturing"],
  },
  {
    type: "PROMPT",
    cat: "Prompt Engineering",
    diff: "HARD",
    marks: 10,
    text: "Dynamic Feature Engineering & Leakage Detection Prompt (Data Science Track)",
    promptMeta: {
      title: "Dynamic Feature Engineering & Leakage Detection Prompt",
      scenario: "A predictive maintenance model for CNC turning centers suffered from target leakage when historical feature pipelines accidentally computed rolling mean vibration metrics that included sensor logs recorded during the failure incident itself. Write a prompt to analyze a data dictionary and generate leak-free vectorized window aggregations.",
      requirements: [
        "Define explicit temporal point-in-time cutoff boundaries to prevent look-ahead bias.",
        "Specify vectorized 7-day, 30-day, and 90-day rolling aggregation rules.",
        "Incorporate an automated data leakage risk audit heuristic.",
        "Request executable Python code with unit test assertions."
      ],
      expectedOutput: "Clean Python code block with leak detection audit table and clean rolling window computation.",
      maxAttempts: 2,
    },
    tags: ["datascience", "prompt-engineering", "feature-engineering", "machine-learning"],
  },
];

async function main() {
  console.log("Seeding Zanvar Group Talent Assessment Portal (Clean Baseline)…");

  const [adminHash, hrHash] = await Promise.all([
    bcrypt.hash("Admin@2026", 12),
    bcrypt.hash("Hr@2026", 12),
  ]);

  // Ensure Admin accounts exist
  await prisma.user.upsert({
    where: { email: "superadmin@zanvargroup.com" },
    update: {
      name: "Super Admin",
      role: "SUPER_ADMIN",
      passwordHash: adminHash,
      emailVerified: true,
      isActive: true,
    },
    create: {
      email: "superadmin@zanvargroup.com",
      name: "Super Admin",
      role: "SUPER_ADMIN",
      passwordHash: adminHash,
      emailVerified: true,
      isActive: true,
    },
  });

  const hr = await prisma.user.upsert({
    where: { email: "hr@zanvargroup.com" },
    update: {
      name: "HR Admin",
      role: "HR_ADMIN",
      passwordHash: hrHash,
      emailVerified: true,
      isActive: true,
    },
    create: {
      email: "hr@zanvargroup.com",
      name: "HR Admin",
      role: "HR_ADMIN",
      passwordHash: hrHash,
      emailVerified: true,
      isActive: true,
    },
  });

  await prisma.user.upsert({
    where: { email: "cyclistprithvi@gmail.com" },
    update: {
      name: "Prithviraj Shahapure",
      role: "SUPER_ADMIN",
      isActive: true,
      emailVerified: true,
    },
    create: {
      email: "cyclistprithvi@gmail.com",
      name: "Prithviraj Shahapure",
      role: "SUPER_ADMIN",
      isActive: true,
      emailVerified: true,
      passwordHash: adminHash,
    },
  });

  // Default Departments
  const deptDefs = [
    ["Production Engineering", "PROD"],
    ["Quality Assurance", "QA"],
    ["Design & Development", "DES"],
    ["Maintenance", "MNT"],
    ["Information Technology", "IT"],
    ["Supply Chain", "SCM"],
  ];

  for (const [name, code] of deptDefs) {
    await prisma.department.upsert({
      where: { code },
      update: { name },
      create: { name, code },
    });
  }

  // Question Categories
  const cats: Record<string, string> = {};
  for (const name of [...new Set(QUESTIONS.map((q) => q.cat))]) {
    const cat = await prisma.questionCategory.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    cats[name] = cat.id;
  }

  // Populate Question Bank with missing questions
  for (const q of QUESTIONS) {
    const existing = await prisma.question.findFirst({ where: { text: q.text } });
    if (!existing) {
      await prisma.question.create({
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
          promptMeta: q.promptMeta ?? undefined,
          tags: q.tags ?? [],
          createdById: hr.id,
          options: q.options
            ? { create: q.options.map(([text, isCorrect], i) => ({ text, isCorrect, order: i })) }
            : undefined,
        },
      });
    }
  }

  // Initialize System Settings
  await prisma.systemSetting.createMany({
    data: Object.entries(DEFAULT_SETTINGS).map(([key, val]) => ({ key, value: val as object })),
    skipDuplicates: true,
  });

  console.log(`
Clean baseline seed completed.
  Super Admin : superadmin@zanvargroup.com / Admin@2026
  HR Admin    : hr@zanvargroup.com / Hr@2026
  Clean question bank and departments initialized.
  No dummy candidates, no sample exams, and no fake attempts created.
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

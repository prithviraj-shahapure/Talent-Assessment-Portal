/**
 * Text File Question Parser
 * Supports Format A, Format B, Format C, section headings, answers, explanations, marks, difficulty, question types.
 */

export interface ParsedOption {
  key: string; // "A", "B", "C", "D" etc.
  text: string;
}

export interface ParsedQuestion {
  rawIndex?: number;
  sectionTitle?: string;
  questionNumber?: string;
  text: string;
  type: "SINGLE" | "MULTIPLE" | "TRUE_FALSE" | "SHORT" | "DESCRIPTIVE" | "CODING" | "NUMERICAL" | "PROMPT";
  options: ParsedOption[];
  correctAnswers: string[]; // e.g. ["A"], ["B", "C"], or ["30"]
  explanation?: string;
  marks: number;
  negativeMarks: number;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  validationErrors: string[];
  status: "VALID" | "MISSING_ANSWER" | "MISSING_OPTIONS" | "INVALID_FORMAT" | "DUPLICATE" | "REQUIRES_REVIEW";
  sourceType: "TXT_IMPORT" | "AI_GENERATED";
}

export interface ExtractedSection {
  sectionTitle: string;
  sectionOrder: number;
  questions: ParsedQuestion[];
  totalQuestions: number;
  totalMarks: number;
}

export interface ParseResult {
  sectionsDetected: string[];
  questions: ParsedQuestion[];
  totalQuestions: number;
  validQuestions: number;
  invalidQuestions: number;
  sections: ExtractedSection[];
}

// Regex patterns
const SECTION_HEADER_REGEX = /^(?:={3,}\s*)?(?:SECTION|STAGE|PART)?\s*([A-Z0-9\s&/_-]+?)(?:\s*TEST|\s*SECTION|\s*ASSESSMENT)?\s*(?:={3,})?$/i;
const KNOWN_SECTIONS = [
  "APTITUDE",
  "APTITUDE TEST",
  "LOGICAL REASONING",
  "QUANTITATIVE APTITUDE",
  "VERBAL ABILITY",
  "TECHNICAL",
  "TECHNICAL TEST",
  "PROGRAMMING FUNDAMENTALS",
  "DATA STRUCTURES & ALGORITHMS",
  "DATABASE MANAGEMENT SYSTEMS",
  "ARTIFICIAL INTELLIGENCE & MACHINE LEARNING",
  "COMPUTER NETWORKS",
  "OPERATING SYSTEMS",
  "PROMPT ENGINEERING",
  "PROMPT ENGINEERING TEST",
  "PRACTICAL CODING TEST",
  "DESCRIPTIVE ASSESSMENT",
  "CUSTOM ASSESSMENT",
];

export function isSectionHeading(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 100) return null;

  // Do not treat markdown table rows, option lines, or question starts as section headings
  if (trimmed.startsWith("|") && trimmed.endsWith("|")) return null;
  if (/^[A-Ha-h0-9][\.\)\:]\s+/.test(trimmed)) return null;
  if (/^(?:Q(?:uestion)?\s*\d+|\b\d+[\.\)\-])\s+/i.test(trimmed)) return null;
  if (/^(?:Correct\s+Answer|Correct|Answer|Ans|Explanation|Exp|Marks?|Points?|Difficulty)\s*[:\-=]/i.test(trimmed)) return null;

  // Strip markdown hashes, dashes, bullet points, asterisks, brackets, equal signs
  const clean = trimmed
    .replace(/^#+\s*/, "")
    .replace(/^[=\-\*\_]{2,}\s*/, "")
    .replace(/\s*[=\-\*\_]{2,}$/, "")
    .replace(/^\[\s*|\s*\]$/g, "")
    .trim();

  const upper = clean.toUpperCase();

  // 1. Explicit Section / Stage / Part pattern:
  // "Section A: Programming", "Section 1 - Aptitude Test", "Section B: Database Management",
  // "Stage 1: Technical Assessment", "Part A: Verbal Ability", "Section A", "Section 1"
  const secCodeMatch = clean.match(/^(?:SECTION|STAGE|PART)\s+([A-Za-z0-9]+)(?:\s*[:\-–]\s*(.+))?$/i);
  if (secCodeMatch) {
    const code = secCodeMatch[1].trim().toUpperCase();
    const title = secCodeMatch[2]?.trim();
    if (title) {
      return `Section ${code}: ${title}`;
    }
    return `Section ${code}`;
  }

  // 2. Generic label without code: "Section: Programming", "Stage: Aptitude", "Section - Technical Assessment"
  const genericMatch = clean.match(/^(?:SECTION|STAGE|PART)\s*[:\-–]\s*(.+)$/i);
  if (genericMatch && genericMatch[1]) {
    return genericMatch[1].trim();
  }

  // 3. Known section names (e.g. "APTITUDE", "LOGICAL REASONING", "TECHNICAL", "COMPUTER NETWORKS", etc.)
  for (const s of KNOWN_SECTIONS) {
    if (upper === s || upper === `${s}:` || upper.startsWith(`${s} -`) || upper.startsWith(`${s} :`) || upper.startsWith(`${s} –`)) {
      return clean.replace(/[:\-–]$/, "").trim();
    }
  }

  // 4. Markdown headers containing test/assessment/domain keywords (e.g. "### Programming Assessment")
  if (trimmed.startsWith("#") && /(?:test|assessment|section|stage|module|aptitude|reasoning|programming|database|network|systems|verbal|coding)/i.test(clean)) {
    return clean;
  }

  return null;
}

export function parseTxtQuestions(content: string, defaultSection?: string): ParseResult {
  const lines = content.split(/\r?\n/);
  const questions: ParsedQuestion[] = [];
  const sectionsDetected = new Set<string>();

  // If no sections are detected in the document, default to "General Questions"
  let currentSection = defaultSection || "General Questions";
  let hasExplicitSection = false;
  let currentQ: Partial<ParsedQuestion> | null = null;
  let textBuffer: string[] = [];
  let readingMode: "QUESTION" | "EXPLANATION" | "OPTIONS" = "QUESTION";

  function finalizeQuestion() {
    if (!currentQ && textBuffer.length === 0) return;
    const qText = (currentQ?.text || textBuffer.join("\n")).trim();
    if (!qText && (!currentQ?.options || currentQ.options.length === 0)) {
      currentQ = null;
      textBuffer = [];
      return;
    }

    const secTitle = currentQ?.sectionTitle || currentSection;

    const q: ParsedQuestion = {
      sectionTitle: secTitle,
      questionNumber: currentQ?.questionNumber,
      text: qText,
      type: currentQ?.type || "SINGLE",
      options: currentQ?.options || [],
      correctAnswers: currentQ?.correctAnswers || [],
      explanation: currentQ?.explanation?.trim(),
      marks: currentQ?.marks !== undefined ? currentQ.marks : 1,
      negativeMarks: currentQ?.negativeMarks !== undefined ? currentQ.negativeMarks : 0,
      difficulty: currentQ?.difficulty || "MEDIUM",
      validationErrors: [],
      status: "VALID",
      sourceType: "TXT_IMPORT",
    };

    // Auto-detect type if options are empty
    if (q.options.length === 0) {
      if (q.correctAnswers.length > 0 && !isNaN(Number(q.correctAnswers[0]))) {
        q.type = "NUMERICAL";
      } else if (q.correctAnswers.length > 0) {
        q.type = "SHORT";
      } else {
        q.type = "DESCRIPTIVE";
      }
    } else if (q.options.length === 2 && q.options.some((o) => o.text.toLowerCase() === "true") && q.options.some((o) => o.text.toLowerCase() === "false")) {
      q.type = "TRUE_FALSE";
    } else if (q.correctAnswers.length > 1) {
      q.type = "MULTIPLE";
    }

    // Validation
    if (q.type === "SINGLE" || q.type === "MULTIPLE" || q.type === "TRUE_FALSE") {
      if (q.options.length < 2) {
        q.validationErrors.push("Options missing: Multiple choice questions must have at least 2 options.");
        q.status = "MISSING_OPTIONS";
      }
      if (q.correctAnswers.length === 0) {
        q.validationErrors.push("Correct answer missing.");
        q.status = "MISSING_ANSWER";
      } else {
        // Verify that correct answer matches one of the options
        const validKeys = new Set(q.options.map((o) => o.key.toUpperCase()));
        const validTexts = new Set(q.options.map((o) => o.text.trim().toLowerCase()));
        const matched = q.correctAnswers.filter((a) => validKeys.has(a.toUpperCase()) || validTexts.has(a.trim().toLowerCase()));
        if (matched.length === 0) {
          q.validationErrors.push(`Correct answer '${q.correctAnswers.join(", ")}' does not match any available option key (${[...validKeys].join(", ")}).`);
          q.status = "INVALID_FORMAT";
        }
      }
    } else if (q.type === "NUMERICAL") {
      if (q.correctAnswers.length === 0 || isNaN(Number(q.correctAnswers[0]))) {
        q.validationErrors.push("Numerical question requires a valid numeric answer.");
        q.status = "MISSING_ANSWER";
      }
    }

    questions.push(q);
    currentQ = null;
    textBuffer = [];
    readingMode = "QUESTION";
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    // Preserve Markdown / ASCII table rows inside question or explanation text
    if (line.startsWith("|") && line.endsWith("|")) {
      if (readingMode === "EXPLANATION" && currentQ) {
        currentQ.explanation = (currentQ.explanation ? currentQ.explanation + "\n" : "") + line;
      } else {
        textBuffer.push(line);
      }
      continue;
    }

    // Check if line is a section heading
    const detectedSec = isSectionHeading(line);
    if (detectedSec) {
      finalizeQuestion();
      currentSection = detectedSec;
      hasExplicitSection = true;
      sectionsDetected.add(detectedSec);
      continue;
    }

    // Check Question Start:
    // Format A: Q1. / Q1) / Question 1: / Question:
    // Format B: 1) / 1. / 1 -
    const qMatch = line.match(/^(?:Q(?:uestion)?\s*(\d+)[\.\):\-]?|\b(\d+)[\.\)\-])\s+(.+)$/i) || line.match(/^(?:Question|Q)\s*:\s*(.+)$/i);
    if (qMatch) {
      finalizeQuestion();
      currentQ = {
        sectionTitle: currentSection,
        questionNumber: qMatch[1] || qMatch[2] || `${questions.length + 1}`,
        options: [],
        correctAnswers: [],
        marks: 1,
        negativeMarks: 0,
        difficulty: "MEDIUM",
      };
      textBuffer = [qMatch[3] || qMatch[1] || ""];
      readingMode = "QUESTION";
      continue;
    }

    // Check Option Line:
    // Format A: A. Option / A) Option / (A) Option / [A] Option
    // Format B: a) Option / a. Option
    // Format C: - Option / * Option
    const optMatch = line.match(/^[\(\[]?([A-Ha-h0-9])[\)\]\.\:]\s+(.+)$/);
    const bulletMatch = line.match(/^[\-\*]\s+(.+)$/);

    if (optMatch && (currentQ || textBuffer.length > 0)) {
      if (!currentQ) {
        currentQ = {
          sectionTitle: currentSection,
          options: [],
          correctAnswers: [],
          marks: 1,
          negativeMarks: 0,
          difficulty: "MEDIUM",
        };
      }
      if (textBuffer.length > 0 && !currentQ.text) {
        currentQ.text = textBuffer.join("\n").trim();
        textBuffer = [];
      }
      currentQ.options = currentQ.options || [];
      currentQ.options.push({
        key: optMatch[1].toUpperCase(),
        text: optMatch[2].trim(),
      });
      readingMode = "OPTIONS";
      continue;
    } else if (bulletMatch && (currentQ || textBuffer.length > 0)) {
      if (!currentQ) {
        currentQ = {
          sectionTitle: currentSection,
          options: [],
          correctAnswers: [],
          marks: 1,
          negativeMarks: 0,
          difficulty: "MEDIUM",
        };
      }
      if (textBuffer.length > 0 && !currentQ.text) {
        currentQ.text = textBuffer.join("\n").trim();
        textBuffer = [];
      }
      const nextKey = String.fromCharCode(65 + (currentQ.options?.length || 0));
      currentQ.options = currentQ.options || [];
      currentQ.options.push({
        key: nextKey,
        text: bulletMatch[1].trim(),
      });
      readingMode = "OPTIONS";
      continue;
    }

    // Check Correct Answer:
    // "Correct Answer: C" / "Answer: B, C" / "Ans: A" / "Correct: A"
    const ansMatch = line.match(/^(?:Correct\s+Answer|Correct|Answer|Ans)\s*[:\-=]\s*(.+)$/i);
    if (ansMatch) {
      if (!currentQ) {
        currentQ = {
          sectionTitle: currentSection,
          options: [],
          correctAnswers: [],
          marks: 1,
          negativeMarks: 0,
          difficulty: "MEDIUM",
        };
      }
      if (textBuffer.length > 0 && !currentQ.text) {
        currentQ.text = textBuffer.join("\n").trim();
        textBuffer = [];
      }
      const rawAns = ansMatch[1].trim();
      // Split if multiple, e.g. "A, B" or "A and C"
      const parts = rawAns
        .split(/[,&]|\band\b/i)
        .map((s) => s.trim().replace(/^[\(\[]|[\)\]\.]$/g, "").toUpperCase())
        .filter(Boolean);
      currentQ.correctAnswers = parts;
      continue;
    }

    // Check Explanation:
    // "Explanation: 15% of 200 = 30" / "Exp: ..." / "Rationale: ..."
    const expMatch = line.match(/^(?:Explanation|Exp|Rationale)\s*[:\-=]\s*(.+)$/i);
    if (expMatch) {
      if (currentQ) {
        currentQ.explanation = expMatch[1].trim();
        readingMode = "EXPLANATION";
      }
      continue;
    }

    // Check Marks:
    // "Marks: 2" / "Mark: 1" / "Points: 2"
    const marksMatch = line.match(/^(?:Marks?|Points?)\s*[:\-=]\s*([0-9\.]+)/i);
    if (marksMatch && currentQ) {
      currentQ.marks = parseFloat(marksMatch[1]);
      continue;
    }

    // Check Negative Marks:
    // "Negative Marks: 0.25" / "Negative: 0.5" / "Penalty: 0.25"
    const negMatch = line.match(/^(?:Negative\s*Marks?|Negative|Penalty)\s*[:\-=]\s*([0-9\.]+)/i);
    if (negMatch && currentQ) {
      currentQ.negativeMarks = parseFloat(negMatch[1]);
      continue;
    }

    // Check Difficulty:
    // "Difficulty: Easy" / "Level: Medium"
    const diffMatch = line.match(/^(?:Difficulty|Level)\s*[:\-=]\s*(Easy|Medium|Hard)/i);
    if (diffMatch && currentQ) {
      currentQ.difficulty = diffMatch[1].toUpperCase() as "EASY" | "MEDIUM" | "HARD";
      continue;
    }

    // Check Type:
    // "Type: MCQ" / "Question Type: Coding"
    const typeMatch = line.match(/^(?:Question\s*Type|Type)\s*[:\-=]\s*(.+)$/i);
    if (typeMatch && currentQ) {
      const t = typeMatch[1].toUpperCase().trim();
      if (t.includes("CODING")) currentQ.type = "CODING";
      else if (t.includes("DESCRIPTIVE") || t.includes("SUBJECTIVE")) currentQ.type = "DESCRIPTIVE";
      else if (t.includes("SHORT")) currentQ.type = "SHORT";
      else if (t.includes("NUMERICAL")) currentQ.type = "NUMERICAL";
      else if (t.includes("TRUE") || t.includes("FALSE")) currentQ.type = "TRUE_FALSE";
      else if (t.includes("MULTI") && t.includes("SELECT")) currentQ.type = "MULTIPLE";
      else currentQ.type = "SINGLE";
      continue;
    }

    // If reading explanation, append
    if (readingMode === "EXPLANATION" && currentQ) {
      currentQ.explanation = (currentQ.explanation ? currentQ.explanation + "\n" : "") + line;
      continue;
    }

    // Otherwise append to text buffer
    textBuffer.push(line);
  }

  finalizeQuestion();

  // Duplicate question text detection
  const seenTexts = new Map<string, number>();
  for (let i = 0; i < questions.length; i++) {
    const normText = questions[i].text.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seenTexts.has(normText)) {
      questions[i].status = "DUPLICATE";
      questions[i].validationErrors.push(`Duplicate question detected: Matches Question ${seenTexts.get(normText)! + 1}.`);
    } else {
      seenTexts.set(normText, i);
    }
  }

  const validCount = questions.filter((q) => q.status === "VALID").length;

  // Build independent sections preserving exact document appearance order
  const sectionsMap = new Map<string, ParsedQuestion[]>();
  for (const q of questions) {
    const title = q.sectionTitle || defaultSection || "General Questions";
    if (!sectionsMap.has(title)) {
      sectionsMap.set(title, []);
    }
    sectionsMap.get(title)!.push(q);
  }

  const sections: ExtractedSection[] = [];
  let secOrder = 0;
  for (const [title, secQuestions] of sectionsMap.entries()) {
    const totalMarks = secQuestions.reduce((sum, q) => sum + (q.marks || 1), 0);
    sections.push({
      sectionTitle: title,
      sectionOrder: secOrder++,
      questions: secQuestions,
      totalQuestions: secQuestions.length,
      totalMarks,
    });
  }

  return {
    sectionsDetected: Array.from(sectionsDetected),
    questions,
    totalQuestions: questions.length,
    validQuestions: validCount,
    invalidQuestions: questions.length - validCount,
    sections,
  };
}

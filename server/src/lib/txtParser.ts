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

interface QuestionStartMatch {
  number: string;
  statement: string;
}

export function matchQuestionStart(line: string): QuestionStartMatch | null {
  const trimmed = line.trim();

  // Pattern 1: Q1. / Q.1 / Q. 1 / Q 1 / Q-1 / Que. 1 / Question 1 / Question No. 1 / Q.No. 1 / 1. / 1)
  const qPrefixMatch = trimmed.match(
    /^(?:Q(?:uestion|ue|ues)?\.?\s*(?:No\.?)?\s*(\d+)|\b(\d+))[\.\:\)\-–]?\s+(.*)$/i
  );
  if (qPrefixMatch) {
    const num = qPrefixMatch[1] || qPrefixMatch[2];
    const rest = (qPrefixMatch[3] || "").trim();
    return { number: num, statement: rest };
  }

  // Pattern 2: Parenthesized or bracketed numbers: (1) statement / [1] statement
  const bracketNumMatch = trimmed.match(/^[\(\[](\d+)[\)\]]\s*[\.\:\-]?\s*(.*)$/);
  if (bracketNumMatch) {
    return { number: bracketNumMatch[1], statement: bracketNumMatch[2].trim() };
  }

  // Pattern 3: Standalone header: "Question 1", "Question: 1", "Q. 1", "Q1", "Question No. 1"
  const standaloneMatch = trimmed.match(/^(?:Question|Que|Ques|Q)\s*(?:No\.?)?\s*[:\.\-–]?\s*(\d+)\s*$/i);
  if (standaloneMatch) {
    return { number: standaloneMatch[1], statement: "" };
  }

  // Pattern 4: "Question:" / "Q:" without number
  const unnumberedMatch = trimmed.match(/^(?:Question|Q)\s*[:\-–]\s*(.+)$/i);
  if (unnumberedMatch) {
    return { number: "", statement: unnumberedMatch[1].trim() };
  }

  return null;
}

export function parseInlineOptions(line: string): ParsedOption[] | null {
  const trimmed = line.trim();
  const regex = /(?:^|\s{2,}|\t|\s+)(?:[\(\[]?([A-Ea-e])[\)\]\.\:]\s*)([^\(\[]+?)(?=(?:\s{2,}|\t|\s+[\(\[]?[A-Ea-e][\)\]\.\:]|$))/g;
  const matches: ParsedOption[] = [];
  let m: RegExpExecArray | null;

  while ((m = regex.exec(trimmed)) !== null) {
    const key = m[1].toUpperCase();
    const text = m[2].trim();
    if (text) {
      matches.push({ key, text });
    }
  }

  if (matches.length >= 2) {
    const keys = matches.map((x) => x.key);
    if (keys[0] === "A" && keys[1] === "B") {
      return matches;
    }
  }

  return null;
}

export function matchSingleOption(line: string): ParsedOption | null {
  const trimmed = line.trim();

  // 1. Letters: A. / A) / (A) / [A] / a. / a) / (a) / [a] / A:
  const letterMatch = trimmed.match(/^[\(\[]?([A-Ha-h])[\)\]\.\:]\s+(.+)$/);
  if (letterMatch) {
    return {
      key: letterMatch[1].toUpperCase(),
      text: letterMatch[2].trim(),
    };
  }

  // 2. Numeric options: 1) / 2) / (1) / (2) / [1] / [2] (NOT 1. to prevent collision with questions)
  const numOptMatch = trimmed.match(/^[\(\[]([1-9])[\)\]]\s+(.+)$/) || trimmed.match(/^([1-9])\)\s+(.+)$/);
  if (numOptMatch) {
    const keyNum = parseInt(numOptMatch[1], 10);
    const key = String.fromCharCode(64 + keyNum); // 1 -> A, 2 -> B
    return {
      key,
      text: numOptMatch[2].trim(),
    };
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

    // 1. Check Question Start
    const qStart = matchQuestionStart(line);
    if (qStart) {
      finalizeQuestion();
      currentQ = {
        sectionTitle: currentSection,
        questionNumber: qStart.number || `${questions.length + 1}`,
        options: [],
        correctAnswers: [],
        marks: 1,
        negativeMarks: 0,
        difficulty: "MEDIUM",
      };
      if (qStart.statement) {
        textBuffer = [qStart.statement];
      } else {
        textBuffer = [];
      }
      readingMode = "QUESTION";
      continue;
    }

    // 2. Check Inline Options: (A)... (B)... (C)... (D)...
    const inlineOpts = parseInlineOptions(line);
    if (inlineOpts) {
      // Question Boundary Protection: If option 'A' arrives and currentQ already has options, finalize previous!
      if (inlineOpts[0].key === "A" && currentQ && currentQ.options && currentQ.options.length > 0) {
        const newText = textBuffer.join("\n").trim();
        textBuffer = [];
        finalizeQuestion();
        currentQ = {
          sectionTitle: currentSection,
          questionNumber: `${questions.length + 1}`,
          options: [],
          correctAnswers: [],
          marks: 1,
          negativeMarks: 0,
          difficulty: "MEDIUM",
          text: newText,
        };
      }

      if (!currentQ) {
        currentQ = {
          sectionTitle: currentSection,
          questionNumber: `${questions.length + 1}`,
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
      currentQ.options.push(...inlineOpts);
      readingMode = "OPTIONS";
      continue;
    }

    // 3. Check Single Option Line: A. / A) / (A) / [A] / 1) / (1)
    const singleOpt = matchSingleOption(line);
    if (singleOpt) {
      // Question Boundary Protection: If option is 'A' and currentQ already has options, finalize previous!
      if (singleOpt.key === "A" && currentQ && currentQ.options && currentQ.options.length > 0) {
        const newText = textBuffer.join("\n").trim();
        textBuffer = [];
        finalizeQuestion();
        currentQ = {
          sectionTitle: currentSection,
          questionNumber: `${questions.length + 1}`,
          options: [],
          correctAnswers: [],
          marks: 1,
          negativeMarks: 0,
          difficulty: "MEDIUM",
          text: newText,
        };
      }

      if (!currentQ) {
        currentQ = {
          sectionTitle: currentSection,
          questionNumber: `${questions.length + 1}`,
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
      currentQ.options.push(singleOpt);
      readingMode = "OPTIONS";
      continue;
    }

    // 4. Check Bullet Option: - Option / * Option
    const bulletMatch = line.match(/^[\-\*]\s+(.+)$/);
    if (bulletMatch && (currentQ || textBuffer.length > 0)) {
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

    // 5. Check Correct Answer
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

    // 6. Check Explanation
    const expMatch = line.match(/^(?:Explanation|Exp|Rationale)\s*[:\-=]\s*(.+)$/i);
    if (expMatch) {
      if (currentQ) {
        currentQ.explanation = expMatch[1].trim();
        readingMode = "EXPLANATION";
      }
      continue;
    }

    // 7. Check Marks
    const marksMatch = line.match(/^(?:Marks?|Points?)\s*[:\-=]\s*([0-9\.]+)/i);
    if (marksMatch && currentQ) {
      currentQ.marks = parseFloat(marksMatch[1]);
      continue;
    }

    // 8. Check Negative Marks
    const negMatch = line.match(/^(?:Negative\s*Marks?|Negative|Penalty)\s*[:\-=]\s*([0-9\.]+)/i);
    if (negMatch && currentQ) {
      currentQ.negativeMarks = parseFloat(negMatch[1]);
      continue;
    }

    // 9. Check Difficulty
    const diffMatch = line.match(/^(?:Difficulty|Level)\s*[:\-=]\s*(Easy|Medium|Hard)/i);
    if (diffMatch && currentQ) {
      currentQ.difficulty = diffMatch[1].toUpperCase() as "EASY" | "MEDIUM" | "HARD";
      continue;
    }

    // 10. Check Type
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

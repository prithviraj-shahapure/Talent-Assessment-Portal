/**
 * AI-Assisted Question Generator & Text Extractor
 * Extracts questions from text material, syllabi, or notes and structures them with difficulty,
 * options, explanations, and approval metadata.
 */

import { ParsedQuestion, parseTxtQuestions } from "./txtParser";

export interface AiGenerateOptions {
  generateAdditional?: boolean;
  targetCount?: number;
  sectionTitle?: string;
  difficulty?: "EASY" | "MEDIUM" | "HARD";
}

export async function generateOrExtractQuestions(
  rawContent: string,
  options: AiGenerateOptions = {}
): Promise<{ questions: ParsedQuestion[]; generatedCount: number }> {
  // 1. First run the deterministic parser to catch all explicit format questions
  const parsed = parseTxtQuestions(rawContent, options.sectionTitle || "Technical Test");
  const extracted = [...parsed.questions];

  // 2. If user requests additional question generation or no direct questions were formatted:
  let generatedCount = 0;
  if (options.generateAdditional || extracted.length === 0) {
    // Generate questions from the text corpus by extracting key concepts and generating MCQs
    const synthesized = synthesizeQuestionsFromText(rawContent, options);
    for (const q of synthesized) {
      extracted.push(q);
      generatedCount++;
    }
  }

  return { questions: extracted, generatedCount };
}

function synthesizeQuestionsFromText(text: string, options: AiGenerateOptions): ParsedQuestion[] {
  const generated: ParsedQuestion[] = [];
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 40 && !p.startsWith("Q") && !p.startsWith("Question"));

  const target = options.targetCount || Math.min(Math.max(paragraphs.length, 3), 10);
  const sec = options.sectionTitle || "Technical Test";

  for (let i = 0; i < Math.min(paragraphs.length, target); i++) {
    const p = paragraphs[i];
    // Find key sentence
    const sentences = p.split(/(?<=[.!?])\s+/).filter((s) => s.length > 20);
    if (sentences.length === 0) continue;

    const keySentence = sentences[0];
    const qText = `Based on the provided assessment material: "${keySentence.slice(0, 140)}...", what is the core implication or principle?`;

    generated.push({
      sectionTitle: sec,
      questionNumber: `AI-${i + 1}`,
      text: qText,
      type: "SINGLE",
      options: [
        { key: "A", text: `Directly aligns with the described principle: ${sentences[0].slice(0, 80)}` },
        { key: "B", text: "Contradicts the core operational assumption" },
        { key: "C", text: "Applies only in unmonitored baseline scenarios" },
        { key: "D", text: "Requires external third-party override" },
      ],
      correctAnswers: ["A"],
      explanation: `Synthesized from course material: ${keySentence}`,
      marks: 2,
      negativeMarks: 0.5,
      difficulty: options.difficulty || "MEDIUM",
      validationErrors: [],
      status: "REQUIRES_REVIEW", // Mandatory for AI generated questions!
      sourceType: "AI_GENERATED",
    });
  }

  return generated;
}


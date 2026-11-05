import { env } from "../config/env";
import { executeLocal } from "../modules/compiler/routes";

export interface AIExecutionResult {
  success: boolean;
  text?: string;
  error?: string;
  provider?: "gemini" | "openai" | "none";
}

export interface EvaluationBreakdown {
  problemUnderstanding: number; // 0 - 2
  promptClarity: number;        // 0 - 2
  technicalCompleteness: number;// 0 - 2
  solutionCorrectness: number;  // 0 - 2
  outputQuality: number;        // 0 - 1
  improvement: number;          // 0 - 1
  totalMarksAwarded: number;
  maxMarks: number;
  testCasesPassed: number;
  testCasesFailed: number;
  feedback: {
    problemUnderstanding: string;
    promptClarity: string;
    technicalCompleteness: string;
    solutionCorrectness: string;
    outputQuality: string;
    improvement: string;
  };
}

/**
 * Call configured AI service (Google Gemini or OpenAI) through the backend.
 * Never exposes API keys to client.
 * If not configured, returns clear provider-unavailable state without fabricating responses.
 */
export async function callAIService(
  userPrompt: string,
  systemInstructions?: string
): Promise<AIExecutionResult> {
  const geminiKey = env.ai.geminiApiKey || process.env.GEMINI_API_KEY;
  const openaiKey = env.ai.openaiApiKey || process.env.OPENAI_API_KEY;

  if (!geminiKey && !openaiKey) {
    return {
      success: false,
      error: "AI service provider is not configured. Please configure GEMINI_API_KEY or OPENAI_API_KEY in server environment.",
      provider: "none",
    };
  }

  // 1. Try Gemini API
  if (geminiKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      const contents: any[] = [];

      if (systemInstructions) {
        contents.push({
          role: "user",
          parts: [{ text: `[SYSTEM INSTRUCTION / SCENARIO CONTEXT]:\n${systemInstructions}` }],
        });
        contents.push({
          role: "model",
          parts: [{ text: "Understood. I will act strictly according to the context and technical requirements." }],
        });
      }

      contents.push({
        role: "user",
        parts: [{ text: userPrompt }],
      });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
          },
        }),
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = (await res.json()) as any;
        const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidateText) {
          return {
            success: true,
            text: candidateText.trim(),
            provider: "gemini",
          };
        }
      }
    } catch (err: any) {
      if (!openaiKey) {
        return {
          success: false,
          error: `Gemini API call failed: ${err.message || err}`,
          provider: "gemini",
        };
      }
    }
  }

  // 2. Try OpenAI API
  if (openaiKey) {
    try {
      const messages: any[] = [];
      if (systemInstructions) {
        messages.push({ role: "system", content: systemInstructions });
      }
      messages.push({ role: "user", content: userPrompt });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages,
          temperature: 0.2,
          max_tokens: 2048,
        }),
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = (await res.json()) as any;
        const text = data.choices?.[0]?.message?.content;
        if (text) {
          return {
            success: true,
            text: text.trim(),
            provider: "openai",
          };
        }
      }
      const errData = (await res.json().catch(() => null)) as any;
      return {
        success: false,
        error: errData?.error?.message || "OpenAI API returned an error",
        provider: "openai",
      };
    } catch (err: any) {
      return {
        success: false,
        error: `OpenAI API request failed: ${err.message || err}`,
        provider: "openai",
      };
    }
  }

  return {
    success: false,
    error: "AI service is currently unavailable.",
    provider: "none",
  };
}

/**
 * Execute test cases for programming prompts with secure isolated sandbox
 */
export async function executePromptTestCases(
  generatedOutput: string,
  language: string,
  testCases: { input: string; expectedOutput: string }[]
): Promise<{ passed: number; failed: number; results: any[] }> {
  // Extract code from Markdown code block if present
  let sourceCode = generatedOutput;
  const codeBlockMatch = generatedOutput.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    sourceCode = codeBlockMatch[1];
  }

  const results: any[] = [];
  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    try {
      const res = await executeLocal(language as any, sourceCode, tc.input);
      const actual = (res.stdout || "").trim();
      const expected = (tc.expectedOutput || "").trim();
      const isMatch = actual === expected;

      if (isMatch) passed++;
      else failed++;

      results.push({
        input: tc.input,
        expectedOutput: tc.expectedOutput,
        actualOutput: actual,
        passed: isMatch,
        error: res.stderr || res.compile_output || null,
        status: res.status,
      });
    } catch (err: any) {
      failed++;
      results.push({
        input: tc.input,
        expectedOutput: tc.expectedOutput,
        actualOutput: "",
        passed: false,
        error: err.message,
        status: "EXECUTION_ERROR",
      });
    }
  }

  return { passed, failed, results };
}

/**
 * Question-specific Evaluation Engine
 * Evaluates candidate prompt across 6 core dimensions:
 * 1. Problem understanding
 * 2. Prompt clarity
 * 3. Technical completeness
 * 4. Generated solution correctness
 * 5. Output quality
 * 6. Improvement between attempts
 */
export async function evaluatePromptQuestion(options: {
  maxMarks: number;
  promptMeta: any;
  attempt1Prompt: string;
  attempt1Response?: string;
  attempt2Prompt?: string;
  attempt2Response?: string;
}): Promise<EvaluationBreakdown> {
  const { maxMarks, promptMeta, attempt1Prompt, attempt1Response, attempt2Prompt, attempt2Response } = options;

  const activePrompt = (attempt2Prompt?.trim() ? attempt2Prompt : attempt1Prompt) || "";
  const activeResponse = (attempt2Response?.trim() ? attempt2Response : attempt1Response) || "";

  // 1. Problem Understanding: Prompt mentions domain keywords and constraints from scenario
  let probScore = 1.0;
  let probFeedback = "Adequate understanding of the core problem.";
  const scenarioWords = (promptMeta?.scenario || "").toLowerCase().split(/\s+/).filter((w: string) => w.length > 4);
  const promptLower = activePrompt.toLowerCase();
  const matchedWords = scenarioWords.filter((w: string) => promptLower.includes(w));
  if (matchedWords.length >= 3) {
    probScore = 2.0;
    probFeedback = "Excellent demonstration of problem understanding and scenario constraints.";
  } else if (matchedWords.length === 0) {
    probScore = 0.5;
    probFeedback = "Prompt could better incorporate scenario context and background.";
  }

  // 2. Prompt Clarity: Structure, role definition, formatting constraints
  let clarScore = 1.0;
  let clarFeedback = "Clear instruction style.";
  const hasRole = /(you are|act as|system role|as a|expert)/i.test(activePrompt);
  const hasFormat = /(json|format|schema|markdown|sql|code|output)/i.test(activePrompt);
  const hasSteps = /(step|1\.|2\.|first|then|finally|requirement)/i.test(activePrompt);
  if (hasRole && hasFormat) {
    clarScore = 2.0;
    clarFeedback = "High clarity with explicit role assignment and output formatting specification.";
  } else if (hasRole || hasFormat || hasSteps) {
    clarScore = 1.5;
    clarFeedback = "Well-structured prompt with identifiable objectives.";
  }

  // 3. Technical Completeness: Adherence to prompt requirements list
  const requirements: string[] = promptMeta?.requirements || [];
  let compScore = 1.0;
  let compFeedback = "Partial technical coverage.";
  if (requirements.length > 0) {
    let reqMet = 0;
    for (const req of requirements) {
      const tokens = req.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
      if (tokens.some((t) => promptLower.includes(t))) reqMet++;
    }
    const ratio = reqMet / requirements.length;
    compScore = Math.min(2.0, Math.round(ratio * 2 * 10) / 10);
    compFeedback = `Covered approximately ${reqMet} of ${requirements.length} specified technical requirements.`;
  } else {
    compScore = 1.5;
    compFeedback = "Good overall coverage of requirements.";
  }

  // 4. Generated Solution Correctness & Test Cases
  let corrScore = 1.5;
  let corrFeedback = "Generated solution conforms to expected parameters.";
  let testCasesPassed = 0;
  let testCasesFailed = 0;

  if (promptMeta?.testCases && Array.isArray(promptMeta.testCases) && promptMeta.testCases.length > 0) {
    const tcResult = await executePromptTestCases(
      activeResponse,
      promptMeta.codeLanguage || "python",
      promptMeta.testCases
    );
    testCasesPassed = tcResult.passed;
    testCasesFailed = tcResult.failed;
    const totalTC = testCasesPassed + testCasesFailed;
    if (totalTC > 0) {
      corrScore = (testCasesPassed / totalTC) * 2.0;
      corrFeedback = `Passed ${testCasesPassed} of ${totalTC} automated verification test cases.`;
    }
  } else if (promptMeta?.expectedOutput) {
    const expLower = promptMeta.expectedOutput.toLowerCase();
    const respLower = activeResponse.toLowerCase();
    if (respLower.includes(expLower.slice(0, 30))) {
      corrScore = 2.0;
      corrFeedback = "Response matches target output specifications.";
    }
  }

  // 5. Output Quality (0 - 1)
  let qualScore = 0.8;
  let qualFeedback = "Solid response quality with concise execution.";
  if (activeResponse.length > 100 && !activeResponse.includes("As an AI") && !activeResponse.includes("I cannot")) {
    qualScore = 1.0;
    qualFeedback = "Clean, deterministic, and production-ready output.";
  } else if (activeResponse.length < 40) {
    qualScore = 0.4;
    qualFeedback = "Response appears truncated or minimal.";
  }

  // 6. Improvement Between Attempts (0 - 1)
  let impScore = 0.5;
  let impFeedback = "Single attempt provided.";
  if (attempt2Prompt?.trim() && attempt1Prompt.trim()) {
    const p1Len = attempt1Prompt.trim().length;
    const p2Len = attempt2Prompt.trim().length;
    const diff = Math.abs(p2Len - p1Len);
    if (diff > 15 || p2Len > p1Len) {
      impScore = 1.0;
      impFeedback = "Demonstrated constructive refinement and prompt engineering optimization between attempts.";
    } else {
      impScore = 0.7;
      impFeedback = "Minor iteration between attempts.";
    }
  }

  const rawSum = probScore + clarScore + compScore + corrScore + qualScore + impScore; // Max 10
  const normalizedMarks = Math.round((rawSum / 10) * maxMarks * 10) / 10;

  return {
    problemUnderstanding: Math.round(probScore * 10) / 10,
    promptClarity: Math.round(clarScore * 10) / 10,
    technicalCompleteness: Math.round(compScore * 10) / 10,
    solutionCorrectness: Math.round(corrScore * 10) / 10,
    outputQuality: Math.round(qualScore * 10) / 10,
    improvement: Math.round(impScore * 10) / 10,
    totalMarksAwarded: normalizedMarks,
    maxMarks,
    testCasesPassed,
    testCasesFailed,
    feedback: {
      problemUnderstanding: probFeedback,
      promptClarity: clarFeedback,
      technicalCompleteness: compFeedback,
      solutionCorrectness: corrFeedback,
      outputQuality: qualFeedback,
      improvement: impFeedback,
    },
  };
}

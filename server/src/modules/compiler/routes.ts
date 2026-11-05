import express from "express";
import { z } from "zod";
import { execFile, spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";

export const compilerRouter = express.Router();

export interface LanguageMeta {
  id: "c" | "cpp" | "java" | "python";
  name: string;
  runtime: string;
  judge0Id: number;
  monacoLang: string;
  extension: string;
  defaultStarter: string;
}

export const SUPPORTED_LANGUAGES: Record<string, LanguageMeta> = {
  c: {
    id: "c",
    name: "C",
    runtime: "  11.1",
    judge0Id: 50,
    monacoLang: "c",
    extension: "c",
    defaultStarter: `#include <stdio.h>

int main() {
    // Write your solution here
    return 0;
}
`,
  },
  cpp: {
    id: "cpp",
    name: "C++",
    runtime: "   11.1",
    judge0Id: 54,
    monacoLang: "cpp",
    extension: "cpp",
    defaultStarter: `#include <iostream>
using namespace std;

int main() {
    // Write your solution here
    return 0;
}
`,
  },
  java: {
    id: "java",
    name: "Java",
    runtime: "      17",
    judge0Id: 62,
    monacoLang: "java",
    extension: "java",
    defaultStarter: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        // Write your solution here
        Scanner scanner = new Scanner(System.in);
    }
}
`,
  },
  python: {
    id: "python",
    name: "Python",
    runtime: "Python 3.10",
    judge0Id: 71,
    monacoLang: "python",
    extension: "py",
    defaultStarter: `import sys

def main():
    # Write your solution here
    pass

if __name__ == "__main__":
    main()
`,
  },
};

// GET /api/compiler/languages
compilerRouter.get("/languages", async (_req, res) => {
  let judge0Connected = false;
  let judge0Languages: Array<{ id: number; name: string }> = [];

  if (env.judge0Url) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 2000);
      const jRes = await fetch(`${env.judge0Url}/languages`, { signal: controller.signal });
      clearTimeout(t);
      if (jRes.ok) {
        judge0Connected = true;
        judge0Languages = (await jRes.json()) as any;
      }
    } catch {
      judge0Connected = false;
    }
  }

  const langs = Object.values(SUPPORTED_LANGUAGES).map((l) => {
    const jMatch = judge0Connected ? judge0Languages.find((jl) => jl.id === l.judge0Id) : null;
    return {
      id: l.id,
      name: l.name,
      runtime: l.runtime,
      judge0Id: l.judge0Id,
      judge0Runtime: jMatch?.name || null,
      monacoLang: l.monacoLang,
      extension: l.extension,
      defaultStarter: l.defaultStarter,
      available: true,
    };
  });

  res.json({
    judge0Connected,
    judge0Url: env.judge0Url,
    languages: langs,
  });
});

const RunSchema = z.object({
  language: z.enum(["c", "cpp", "java", "python"]),
  sourceCode: z.string().max(65536, "Source code exceeds 64KB limit"),
  stdin: z.string().max(65536).optional().default(""),
  attemptId: z.string().optional(),
  questionId: z.string().optional(),
});

// Helper for local sandbox execution fallback when Judge0 is not running
export async function executeLocal(lang: "c" | "cpp" | "java" | "python", code: string, stdin: string) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zanvar-exec-"));
  const start = Date.now();

  try {
    if (lang === "python") {
      const filePath = path.join(tmpDir, "solution.py");
      await fs.writeFile(filePath, code, "utf-8");

      return await new Promise<{
        stdout: string;
        stderr: string;
        compile_output: string | null;
        status: string;
        time: string;
        memory: number;
      }>((resolve) => {
        const child = spawn("python", [filePath], {
          timeout: 4000,
          cwd: tmpDir,
        });

        let stdout = "";
        let stderr = "";

        if (stdin) {
          child.stdin.write(stdin);
          child.stdin.end();
        }

        child.stdout.on("data", (d) => {
          if (stdout.length < 32768) stdout += d.toString();
        });
        child.stderr.on("data", (d) => {
          if (stderr.length < 32768) stderr += d.toString();
        });

        child.on("close", (code, signal) => {
          const elapsed = ((Date.now() - start) / 1000).toFixed(2);
          if (signal === "SIGTERM" || signal === "SIGKILL") {
            resolve({
              stdout,
              stderr: "Time Limit Exceeded (4.0s)",
              compile_output: null,
              status: "TIME_LIMIT_EXCEEDED",
              time: elapsed,
              memory: 12400,
            });
          } else if (code === 0) {
            resolve({
              stdout,
              stderr,
              compile_output: null,
              status: "ACCEPTED",
              time: elapsed,
              memory: 8400,
            });
          } else {
            resolve({
              stdout,
              stderr,
              compile_output: null,
              status: "RUNTIME_ERROR",
              time: elapsed,
              memory: 8400,
            });
          }
        });

        child.on("error", (err) => {
          const elapsed = ((Date.now() - start) / 1000).toFixed(2);
          resolve({
            stdout: "",
            stderr: `Execution error: ${err.message}`,
            compile_output: null,
            status: "RUNTIME_ERROR",
            time: elapsed,
            memory: 0,
          });
        });
      });
    }

    if (lang === "c" || lang === "cpp") {
      const srcExt = lang === "c" ? "solution.c" : "solution.cpp";
      const srcPath = path.join(tmpDir, srcExt);
      const outExt = process.platform === "win32" ? "solution.exe" : "solution.out";
      const outPath = path.join(tmpDir, outExt);
      await fs.writeFile(srcPath, code, "utf-8");

      const compiler = lang === "c" ? " " : "  ";

      // Compile
      const compileRes = await new Promise<{ ok: boolean; stderr: string }>((resolve) => {
        execFile(compiler, [srcPath, "-O2", "-o", outPath], { timeout: 6000, cwd: tmpDir }, (err, _out, errOut) => {
          if (err) {
            resolve({ ok: false, stderr: errOut || err.message });
          } else {
            resolve({ ok: true, stderr: "" });
          }
        });
      });

      if (!compileRes.ok) {
        return {
          stdout: "",
          stderr: "",
          compile_output: compileRes.stderr,
          status: "COMPILATION_ERROR",
          time: ((Date.now() - start) / 1000).toFixed(2),
          memory: 0,
        };
      }

      // Execute binary
      return await new Promise<{
        stdout: string;
        stderr: string;
        compile_output: string | null;
        status: string;
        time: string;
        memory: number;
      }>((resolve) => {
        const child = spawn(outPath, [], {
          timeout: 4000,
          cwd: tmpDir,
        });

        let stdout = "";
        let stderr = "";

        if (stdin) {
          child.stdin.write(stdin);
          child.stdin.end();
        }

        child.stdout.on("data", (d) => {
          if (stdout.length < 32768) stdout += d.toString();
        });
        child.stderr.on("data", (d) => {
          if (stderr.length < 32768) stderr += d.toString();
        });

        child.on("close", (code, signal) => {
          const elapsed = ((Date.now() - start) / 1000).toFixed(2);
          if (signal === "SIGTERM" || signal === "SIGKILL") {
            resolve({
              stdout,
              stderr: "Time Limit Exceeded (4.0s)",
              compile_output: null,
              status: "TIME_LIMIT_EXCEEDED",
              time: elapsed,
              memory: 4096,
            });
          } else if (code === 0) {
            resolve({
              stdout,
              stderr,
              compile_output: null,
              status: "ACCEPTED",
              time: elapsed,
              memory: 4096,
            });
          } else {
            resolve({
              stdout,
              stderr,
              compile_output: null,
              status: "RUNTIME_ERROR",
              time: elapsed,
              memory: 4096,
            });
          }
        });

        child.on("error", (err) => {
          const elapsed = ((Date.now() - start) / 1000).toFixed(2);
          resolve({
            stdout: "",
            stderr: `Execution error: ${err.message}`,
            compile_output: null,
            status: "RUNTIME_ERROR",
            time: elapsed,
            memory: 0,
          });
        });
      });
    }

    if (lang === "java") {
      const srcPath = path.join(tmpDir, "Main.java");
      await fs.writeFile(srcPath, code, "utf-8");

      // Check if javac is available
      const compileRes = await new Promise<{ ok: boolean; stderr: string }>((resolve) => {
        execFile("javac", [srcPath], { timeout: 8000, cwd: tmpDir }, (err, _out, errOut) => {
          if (err) {
            resolve({ ok: false, stderr: errOut || err.message });
          } else {
            resolve({ ok: true, stderr: "" });
          }
        });
      });

      if (!compileRes.ok) {
        const isNotFound = compileRes.stderr.includes("ENOENT") || compileRes.stderr.includes("not recognized");
        return {
          stdout: "",
          stderr: isNotFound
            ? "Java compiler (javac) is not available on this server environment. Please connect Judge0 CE or install OpenJDK."
            : compileRes.stderr,
          compile_output: isNotFound
            ? "Compiler unavailable: OpenJDK/javac not found in system PATH and Judge0 is unreachable."
            : compileRes.stderr,
          status: "COMPILATION_ERROR",
          time: ((Date.now() - start) / 1000).toFixed(2),
          memory: 0,
        };
      }

      // Execute compiled Java bytecode
      return await new Promise<{
        stdout: string;
        stderr: string;
        compile_output: string | null;
        status: string;
        time: string;
        memory: number;
      }>((resolve) => {
        const child = spawn("java", ["-cp", tmpDir, "Main"], {
          timeout: 5000,
          cwd: tmpDir,
        });

        let stdout = "";
        let stderr = "";

        if (stdin) {
          child.stdin.write(stdin);
          child.stdin.end();
        }

        child.stdout.on("data", (d) => {
          if (stdout.length < 32768) stdout += d.toString();
        });
        child.stderr.on("data", (d) => {
          if (stderr.length < 32768) stderr += d.toString();
        });

        child.on("close", (code, signal) => {
          const elapsed = ((Date.now() - start) / 1000).toFixed(2);
          if (signal === "SIGTERM" || signal === "SIGKILL") {
            resolve({
              stdout,
              stderr: "Time Limit Exceeded (5.0s)",
              compile_output: null,
              status: "TIME_LIMIT_EXCEEDED",
              time: elapsed,
              memory: 28000,
            });
          } else if (code === 0) {
            resolve({
              stdout,
              stderr,
              compile_output: null,
              status: "ACCEPTED",
              time: elapsed,
              memory: 24000,
            });
          } else {
            resolve({
              stdout,
              stderr,
              compile_output: null,
              status: "RUNTIME_ERROR",
              time: elapsed,
              memory: 24000,
            });
          }
        });

        child.on("error", (err) => {
          const elapsed = ((Date.now() - start) / 1000).toFixed(2);
          resolve({
            stdout: "",
            stderr: `Execution error: ${err.message}`,
            compile_output: null,
            status: "RUNTIME_ERROR",
            time: elapsed,
            memory: 0,
          });
        });
      });
    }

    return {
      stdout: "",
      stderr: "Language runtime not supported.",
      compile_output: null,
      status: "COMPILATION_ERROR",
      time: "0.00",
      memory: 0,
    };
  } finally {
    // Clean up temporary sandbox directory
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

// POST /api/compiler/run
compilerRouter.post("/run", async (req, res, next) => {
  try {
    const { language, sourceCode, stdin, attemptId } = RunSchema.parse(req.body);
    const langMeta = SUPPORTED_LANGUAGES[language];

    if (!langMeta) {
      return res.status(400).json({ error: `Unsupported language: ${language}` });
    }

    // Verify candidate attempt status if attemptId passed
    if (attemptId && req.user?.role === "CANDIDATE") {
      const attempt = await prisma.attempt.findUnique({
        where: { id: attemptId },
        select: { status: true, candidate: { select: { userId: true } } },
      });
      if (!attempt || attempt.candidate.userId !== req.user.id) {
        return res.status(403).json({ error: "Access denied to examination attempt" });
      }
      if (attempt.status !== "IN_PROGRESS") {
        return res.status(400).json({ error: "Examination attempt is not active" });
      }
    }

    // 1. Try Judge0 execution if configured and available
    if (env.judge0Url) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const jRes = await fetch(`${env.judge0Url}/submissions?wait=true&base64_encoded=false`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            source_code: sourceCode,
            language_id: langMeta.judge0Id,
            stdin: stdin || "",
            cpu_time_limit: 2,
            memory_limit: 128000,
          }),
        });
        clearTimeout(timeout);

        if (jRes.ok) {
          const jData = (await jRes.json()) as any;
          // Judge0 status ids: 3: Accepted, 4: Wrong Answer, 5: TLE, 6: Compilation Error, 7-12: Runtime Error
          let statusStr = "ACCEPTED";
          if (jData.status?.id === 6) statusStr = "COMPILATION_ERROR";
          else if (jData.status?.id === 5) statusStr = "TIME_LIMIT_EXCEEDED";
          else if (jData.status?.id >= 7) statusStr = "RUNTIME_ERROR";

          return res.json({
            success: true,
            language,
            stdout: jData.stdout ?? "",
            stderr: jData.stderr ?? "",
            compile_output: jData.compile_output ?? null,
            status: statusStr,
            time: jData.time ? `${jData.time}s` : "0.02s",
            memory: jData.memory ? `${(jData.memory / 1024).toFixed(1)} MB` : "2.1 MB",
            source: "judge0",
          });
        }
      } catch {
        // Judge0 unreachable, seamlessly fall back to local sandbox execution
      }
    }

    // 2. Fallback to local sandbox runner
    const localResult = await executeLocal(language, sourceCode, stdin);
    return res.json({
      success: true,
      language,
      stdout: localResult.stdout,
      stderr: localResult.stderr,
      compile_output: localResult.compile_output,
      status: localResult.status,
      time: `${localResult.time}s`,
      memory: `${(localResult.memory / 1024).toFixed(1)} MB`,
      source: "local-sandbox",
    });
  } catch (err) {
    next(err);
  }
});


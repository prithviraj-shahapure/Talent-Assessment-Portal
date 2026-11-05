import path from "path";
import fs from "fs";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { env } from "./config/env";
import { errorHandler, clientIp } from "./lib/http";
import { loadUser } from "./middleware/auth";
import { csrfProtection } from "./middleware/csrf";
import { authRouter } from "./modules/auth/routes";
import { usersRouter } from "./modules/users/routes";
import { departmentsRouter } from "./modules/departments/routes";
import { questionsRouter } from "./modules/questions/routes";
import { questionImportRouter } from "./modules/questions/importRoutes";
import { sessionsRouter } from "./modules/sessions/routes";
import { sessionControlRouter } from "./modules/sessions/controlRoutes";
import { excelReportRouter } from "./modules/reports/excelRoutes";
import { examsRouter } from "./modules/exams/routes";
import { candidatesRouter } from "./modules/candidates/routes";
import { meRouter } from "./modules/me/routes";
import { attemptsRouter } from "./modules/attempts/routes";
import { proctoringRouter } from "./modules/proctoring/routes";
import { evaluationRouter } from "./modules/evaluation/routes";
import { resultsRouter } from "./modules/results/routes";
import { pipelineRouter } from "./modules/pipeline/routes";
import { dashboardRouter } from "./modules/dashboard/routes";
import { settingsRouter } from "./modules/settings/routes";
import { auditRouter } from "./modules/audit/routes";
import { reportsRouter } from "./modules/reports/routes";
import { compilerRouter } from "./modules/compiler/routes";
import { promptRouter } from "./modules/prompt/routes";
import { documentsRouter } from "./modules/documents/routes";

export function createApp() {
  const app = express();
  if (env.trustProxy) app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "script-src": ["'self'", "'wasm-unsafe-eval'", "https://cdn.jsdelivr.net", "https://apis.google.com"],
          "connect-src": ["'self'", "ws:", "wss:", "https://cdn.jsdelivr.net", "https://storage.googleapis.com", "https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com"],
          // Firebase Google sign-in uses a helper frame on the project's auth domain
          "frame-src": ["'self'", ...(env.firebase.authDomain ? [`https://${env.firebase.authDomain}`] : []), "https://accounts.google.com"],
          "img-src": ["'self'", "data:", "blob:", "https://lh3.googleusercontent.com"],
          "media-src": ["'self'", "blob:"],
          "worker-src": ["'self'", "blob:"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "font-src": ["'self'", "data:"],
        },
      },
      crossOriginEmbedderPolicy: false,
      // the Google sign-in popup must be able to report back to this window
      crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    }),
  );
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (env.clientOrigin.includes(origin) || origin.endsWith(".trycloudflare.com") || env.serveClient) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  app.use(cookieParser());

  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  api.use(loadUser);
  // High-concurrency rate limiter: keys by user ID when logged in; keys by IP with high ceiling (50,000 / 15m) when unauthenticated
  // This prevents campus NAT / college Wi-Fi bottlenecks where 300+ students share one public IP
  api.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: (req) => (req.user?.id ? 5000 : 50_000),
      keyGenerator: (req) => req.user?.id ?? clientIp(req),
      standardHeaders: true,
      legacyHeaders: false,
    })
  );
  api.use(csrfProtection);
  api.get("/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  api.use("/auth", authRouter);
  api.use("/users", usersRouter);
  api.use("/departments", departmentsRouter);
  api.use("/questions", questionsRouter);
  api.use("/questions-import", questionImportRouter);
  api.use("/documents", documentsRouter);
  api.use("/sessions", sessionsRouter);
  api.use("/sessions-control", sessionControlRouter);
  api.use("/excel-reports", excelReportRouter);
  api.use("/exams", examsRouter);
  api.use("/candidates", candidatesRouter);
  api.use("/me", meRouter);
  api.use("/attempts", attemptsRouter);
  api.use("/proctoring", proctoringRouter);
  api.use("/evaluation", evaluationRouter);
  api.use("/results", resultsRouter);
  api.use("/pipeline", pipelineRouter);
  api.use("/dashboard", dashboardRouter);
  api.use("/settings", settingsRouter);
  api.use("/audit", auditRouter);
  api.use("/reports", reportsRouter);
  api.use("/compiler", compilerRouter);
  api.use("/prompt", promptRouter);
  api.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use("/api", api);

  // Production: serve the built React app from the same origin
  const clientDist = path.resolve(__dirname, "../../client/dist");
  if (env.serveClient && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: "7d" }));
    app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
  }

  app.use(errorHandler);
  return app;
}

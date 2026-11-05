import "dotenv/config";
import path from "path";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing required environment variable ${name}`);
  return v;
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const jwtSecret = required("JWT_SECRET");
if (nodeEnv === "production" && jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters in production");
}

export const env = {
  nodeEnv,
  isProd: nodeEnv === "production",
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  clientOrigin: (process.env.CLIENT_ORIGIN ?? "http://localhost:5173").split(",").map((s) => s.trim()),
  appUrl: process.env.APP_URL ?? "http://localhost:5173",
  jwtSecret,
  jwtExpiresHours: Number(process.env.JWT_EXPIRES_HOURS ?? 12),
  cookieSecure: (process.env.COOKIE_SECURE ?? (nodeEnv === "production" ? "true" : "false")) === "true",
  storageDir: path.resolve(process.cwd(), process.env.STORAGE_DIR ?? "./storage"),
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.MAIL_FROM ?? "Zanvar Group Talent Portal <no-reply@localhost>",
  },
  firebase: {
    apiKey: process.env.FIREBASE_API_KEY ?? "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.FIREBASE_PROJECT_ID ?? "",
    appId: process.env.FIREBASE_APP_ID ?? "",
  },
  /** Let existing HR / Super Admin accounts sign in with Google (only when the Google email matches the account). */
  googleStaffSignIn: (process.env.GOOGLE_STAFF_SIGNIN ?? "true") === "true",
  judge0Url: process.env.JUDGE0_URL ?? "http://localhost:2358",
  trustProxy: process.env.TRUST_PROXY === "true",
  serveClient: process.env.SERVE_CLIENT === "true",
};

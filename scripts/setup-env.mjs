// Creates server/.env on first run (asks for the PostgreSQL connection details).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, "server", ".env");
if (fs.existsSync(envPath)) {
  console.log("server\\.env already exists — keeping it.");
  process.exit(0);
}
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();
const ask = async (q, d) => {
  process.stdout.write(`${q}${d ? ` [${d}]` : ""}: `);
  const { value } = await lines.next();
  if (!process.stdin.isTTY) process.stdout.write("\n");
  return (value ?? "").trim() || d || "";
};
console.log("\nFirst-time setup — PostgreSQL connection details\n");
const host = await ask("PostgreSQL host", "localhost");
const port = await ask("PostgreSQL port", "5432");
const user = await ask("PostgreSQL user", "postgres");
const password = await ask("PostgreSQL password for that user");
const db = await ask("Database name", "zanvar_exam");
rl.close();
const url = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}?schema=public`;
const example = fs.readFileSync(path.join(root, "server", ".env.example"), "utf8");
const env = example
  .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL="${url}"`)
  .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${crypto.randomBytes(48).toString("base64url")}`);
fs.writeFileSync(envPath, env);
console.log("Created server\\.env\n");

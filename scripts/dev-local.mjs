// Runs the whole portal locally with a private PostgreSQL that lives in .pgdata/
// (no PostgreSQL installation or password needed).
//
//   node scripts/dev-local.mjs env            -> only create/update server/.env (used before npm install)
//   node scripts/dev-local.mjs check-install  -> exit code 1 when dependencies must be (re)installed
//   node scripts/dev-local.mjs mark-installed -> remember that dependencies match package-lock.json
//   node scripts/dev-local.mjs       -> start database, migrate, seed (first run), start the app
//
// To use your own PostgreSQL server instead, set DATABASE_URL in server/.env and
// remove the line LOCAL_EMBEDDED_DB=true.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, "server", ".env");
const dataDir = path.join(root, ".pgdata");
const seededFlag = path.join(root, "server", ".seeded");
const PORT = 5434;
const USER = "postgres";
const PASSWORD = "zanvar-local"; // only reachable from this computer (localhost)
const DB = "zanvar_exam";

const installMarker = path.join(root, "node_modules", ".zanvar-install-hash");
const lockHash = () => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "package-lock.json"))).digest("hex");

const FIREBASE_BLOCK = `
# -- Google sign-in (Firebase Authentication) -- optional --
# Firebase console > Project settings > General > Your apps > Web app > SDK config.
# Leave empty to hide the "Continue with Google" button.
FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=
FIREBASE_PROJECT_ID=
FIREBASE_APP_ID=
# Let existing HR / Super Admin accounts also sign in with Google (true/false)
GOOGLE_STAFF_SIGNIN=true
`;

function ensureEnv() {
  if (fs.existsSync(envPath)) {
    // Add settings introduced after this .env was created (values stay empty until filled in).
    const cur = fs.readFileSync(envPath, "utf8");
    if (!/^FIREBASE_PROJECT_ID=/m.test(cur)) {
      fs.appendFileSync(envPath, FIREBASE_BLOCK);
      console.log("Added Google sign-in settings (empty) to server\\.env");
    }
    return;
  }
  const example = fs.readFileSync(path.join(root, "server", ".env.example"), "utf8");
  const env =
    example
      .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL="postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DB}?schema=public"`)
      .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${crypto.randomBytes(48).toString("base64url")}`) +
    "\n# Built-in local database (data in .pgdata). Remove this line to use your own PostgreSQL.\nLOCAL_EMBEDDED_DB=true\n";
  fs.writeFileSync(envPath, env);
  console.log("Created server\\.env (built-in local database).");
}

// Everything is also written to local-start.log for troubleshooting.
const logFile = fs.createWriteStream(path.join(root, "local-start.log"), { flags: "w" });
const log = (...a) => {
  const line = a.join(" ");
  console.log(line);
  logFile.write(line + "\n");
};
function spawnLogged(cmd, args) {
  const p = spawn(cmd, args, { cwd: root, stdio: ["inherit", "pipe", "pipe"], shell: true });
  p.stdout.on("data", (d) => { process.stdout.write(d); logFile.write(d); });
  p.stderr.on("data", (d) => { process.stderr.write(d); logFile.write(d); });
  return p;
}
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawnLogged(cmd, args);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} failed (exit ${code})`))));
  });
}

async function main() {
  const mode = process.argv[2];
  if (mode === "check-install") {
    const ok = fs.existsSync(installMarker) && fs.readFileSync(installMarker, "utf8").trim() === lockHash();
    process.exit(ok ? 0 : 1);
  }
  if (mode === "mark-installed") {
    fs.writeFileSync(installMarker, lockHash());
    return;
  }
  ensureEnv();
  if (mode === "env") return;

  const useEmbedded = /^LOCAL_EMBEDDED_DB=true$/m.test(fs.readFileSync(envPath, "utf8"));
  let pg = null;
  if (useEmbedded) {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    pg = new EmbeddedPostgres({ databaseDir: dataDir, user: USER, password: PASSWORD, port: PORT, persistent: true, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
    if (!fs.existsSync(path.join(dataDir, "PG_VERSION"))) {
      log("Setting up the built-in database (first run)...");
      await pg.initialise();
    }
    try {
      await pg.start();
    } catch (e) {
      // Already running (e.g. the window was closed last time without Ctrl+C)? Reuse it.
      const { default: pgLib } = await import("pg");
      const probe = new pgLib.Client({ host: "localhost", port: PORT, user: USER, password: PASSWORD, database: "postgres" });
      try {
        await probe.connect();
        await probe.end();
        log("Built-in database was already running - reusing it.");
        pg = null; // not ours to stop
      } catch {
        // Fallback for Windows administrator privilege restriction
        const pgctl = path.join(root, "node_modules", "@embedded-postgres", "windows-x64", "native", "bin", "pg_ctl.exe");
        if (process.platform === "win32" && fs.existsSync(pgctl)) {
          try {
            const pidFile = path.join(dataDir, "postmaster.pid");
            if (fs.existsSync(pidFile)) {
              try { fs.unlinkSync(pidFile); } catch {}
            }
            await run(`"${pgctl}"`, ["start", "-D", `"${dataDir}"`, "-l", `"${path.join(root, "pg.log")}"`, "-o", `"-p ${PORT}"`]);
            log(`Database running on localhost:${PORT} via pg_ctl`);
            pg = { stop: async () => run(`"${pgctl}"`, ["stop", "-D", `"${dataDir}"`, "-m", "fast"]) };
          } catch (ctlErr) {
            throw new Error(`Could not start the built-in database: ${ctlErr?.message || ctlErr}. If another program uses port ${PORT}, close it and try again.`);
          }
        } else {
          throw new Error(`Could not start the built-in database: ${e?.message || e}. If another program uses port ${PORT}, close it and try again.`);
        }
      }
    }
    const { default: pgLib2 } = await import("pg");
    const client = new pgLib2.Client({ host: "localhost", port: PORT, user: USER, password: PASSWORD, database: "postgres" });
    await client.connect();
    const r = await client.query("SELECT pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname = $1", [DB]);
    if (r.rowCount && r.rows[0].enc !== "UTF8") {
      if (fs.existsSync(seededFlag)) throw new Error(`Database ${DB} uses ${r.rows[0].enc} encoding; it must be UTF8. Back up your data, delete the .pgdata folder and start again.`);
      log(`Recreating database ${DB} with UTF-8 encoding (was ${r.rows[0].enc})...`);
      await client.query(`DROP DATABASE ${DB} WITH (FORCE)`);
    }
    if (!r.rowCount || r.rows[0].enc !== "UTF8") {
      await client.query(`CREATE DATABASE ${DB} ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
    }
    // Windows clusters default the *connection* encoding to WIN1252; force UTF-8 for every client.
    await client.query("ALTER SYSTEM SET client_encoding = 'UTF8'");
    await client.query("SELECT pg_reload_conf()");
    await client.query(`ALTER DATABASE ${DB} SET client_encoding = 'UTF8'`);
    const enc = await client.query("SELECT pg_encoding_to_char(encoding) AS db FROM pg_database WHERE datname = $1", [DB]);
    log(`[launcher v3] database encoding ${enc.rows[0].db}, client encoding forced to UTF8`);
    await client.end();
    log(`Database running on localhost:${PORT} (data folder: .pgdata)`);
  } else {
    await run("npm", ["run", "db:create", "-w", "server"]);
  }

  let stopping = false;
  const stop = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    if (pg) {
      console.log("\nStopping database...");
      await pg.stop().catch(() => {});
    }
    process.exit(code);
  };
  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));

  try {
    log("Applying database migrations...");
    await run("npm", ["run", "db:deploy"]);
    const cleanFlag = path.join(root, "server", ".clean-v1");
    if (!fs.existsSync(cleanFlag)) {
      log("Purging all legacy dummy / demo data from database...");
      await run("npm", ["run", "db:clean", "-w", "server"]);
      fs.writeFileSync(cleanFlag, new Date().toISOString());
    }
    if (!fs.existsSync(seededFlag)) {
      log("Loading clean baseline seed...");
      await run("npm", ["run", "db:seed"]);
      fs.writeFileSync(seededFlag, new Date().toISOString());
    }
  } catch (e) {
    log(`\n[X] ${e.message}`);
    return stop(1);
  }

  log(`
============================================================
  Portal starting - open http://localhost:5173
  HR login:     hr@zanvargroup.com / Hr@2026
  Super Admin:  superadmin@zanvargroup.com / Admin@2026
  Press Ctrl+C (or close this window) to stop.
============================================================
`);
  if (process.platform === "win32") spawn("cmd", ["/c", "timeout /t 12 >nul & start http://localhost:5173"], { detached: true, stdio: "ignore" }).unref();
  const app = spawnLogged("npm", ["run", "dev"]);
  app.on("exit", (code) => stop(code ?? 0));
}

main().catch((e) => {
  console.error("\n[X] " + (e?.message || e));
  try { fs.appendFileSync(path.join(root, "local-start.log"), "\n[X] " + (e?.stack || e) + "\n"); } catch {}
  process.exit(1);
});

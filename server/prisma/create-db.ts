// Creates the database named in DATABASE_URL if it does not exist yet.
import "dotenv/config";
import { Client } from "pg";

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  const dbName = decodeURIComponent(url.pathname.slice(1));
  url.pathname = "/postgres";
  url.search = "";
  const client = new Client({ connectionString: url.toString() });
  try {
    await client.connect();
  } catch (e) {
    console.error(`\nCould not connect to PostgreSQL: ${(e as Error).message}`);
    console.error("Check that PostgreSQL is running and the password in server\\.env is correct (delete server\\.env to re-enter it).\n");
    process.exit(1);
  }
  const r = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (r.rowCount) console.log(`Database "${dbName}" exists.`);
  else {
    await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    console.log(`Created database "${dbName}".`);
  }
  await client.end();
}
main();

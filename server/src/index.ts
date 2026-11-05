import http from "http";
import fs from "fs";
import { env } from "./config/env";
import { createApp } from "./app";
import { initSockets } from "./sockets";
import { startJobs } from "./jobs";
import { prisma } from "./lib/prisma";

async function main() {
  fs.mkdirSync(env.storageDir, { recursive: true });
  await prisma.$queryRaw`SELECT 1`;
  const app = createApp();
  const server = http.createServer(app);
  initSockets(server);
  startJobs();
  server.listen(env.port, () => {
    console.log(`Zanvar Talent Assessment API listening on http://localhost:${env.port} (${env.nodeEnv}) [doc-extractor-v1]`);
  });
  const shutdown = async () => {
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error("Failed to start server:", e);
  process.exit(1);
});

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { env } from "../config/env";

// client_encoding: Windows PostgreSQL installs often default to WIN1252, which cannot store ₹ and other symbols
const adapter = new PrismaPg({ connectionString: env.databaseUrl, client_encoding: "UTF8" } as ConstructorParameters<typeof PrismaPg>[0]);
export const prisma = new PrismaClient({ adapter });
export * from "../generated/prisma/client";

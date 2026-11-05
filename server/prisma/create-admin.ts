/**
 * Creates (or resets) a Super Admin without touching other data.
 * Usage: npm run create-admin -- admin@zanvargroup.com "Full Name" "StrongPassw0rd"
 */
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";

async function main() {
  const [email, name, password] = process.argv.slice(2);
  if (!email || !name || !password || password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    console.error('Usage: npm run create-admin -- <email> "<full name>" "<password: 8+ chars, letters and numbers>"');
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    create: { email: email.toLowerCase(), name, passwordHash, role: "SUPER_ADMIN", emailVerified: true },
    update: { name, passwordHash, role: "SUPER_ADMIN", isActive: true },
  });
  await prisma.auditLog.create({ data: { action: "user.create_admin_cli", entity: "User", entityId: user.id, details: { email: user.email } } });
  console.log(`Super Admin ready: ${user.email}`);
}
main().finally(() => prisma.$disconnect());

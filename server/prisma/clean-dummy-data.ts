import { prisma } from "../src/lib/prisma";
import bcrypt from "bcryptjs";

async function clean() {
  console.log("=== CLEANING ALL DUMMY DATA FROM DATABASE ===");

  // 1. Delete all candidate-related attempts, answers, proctor events
  console.log("Deleting answers, proctor events, attempts...");
  await prisma.answer.deleteMany({});
  await prisma.candidateSectionAttempt.deleteMany({});
  await prisma.proctorEvent.deleteMany({});
  await prisma.evidenceFile.deleteMany({});
  await prisma.attempt.deleteMany({});

  // 2. Delete assignments, invitations, session control
  console.log("Deleting session codes, invitations, exam assignments...");
  await prisma.sessionCandidate.deleteMany({});
  await prisma.sessionAuditLog.deleteMany({});
  await prisma.adminActionAuditLog.deleteMany({});
  await prisma.examAssignment.deleteMany({});
  await prisma.invitation.deleteMany({});
  await prisma.accommodationRequest.deleteMany({});
  await prisma.pipelineHistory.deleteMany({});
  await prisma.consentRecord.deleteMany({});
  await prisma.emailToken.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.examSession.deleteMany({});

  // 3. Delete all candidate profiles and candidate users
  console.log("Deleting demo candidate profiles and candidate accounts...");
  await prisma.candidateProfile.deleteMany({});
  const deletedCandidates = await prisma.user.deleteMany({
    where: { role: "CANDIDATE" },
  });
  console.log(`Deleted ${deletedCandidates.count} candidate users.`);

  // 4. Delete demo exams created by seed
  console.log("Deleting demo exams and sections...");
  await prisma.examQuestion.deleteMany({});
  await prisma.sectionRandomRule.deleteMany({});
  await prisma.examSection.deleteMany({});
  const deletedExams = await prisma.exam.deleteMany({});
  console.log(`Deleted ${deletedExams.count} demo exams.`);

  // 5. Ensure Super Admin and HR Admin exist with active status
  console.log("Ensuring Super Admin and HR Admin accounts are active and clean...");
  const superHash = await bcrypt.hash("Admin@2026", 10);
  const hrHash = await bcrypt.hash("Hr@2026", 10);

  await prisma.user.upsert({
    where: { email: "superadmin@zanvargroup.com" },
    update: {
      name: "Super Admin",
      role: "SUPER_ADMIN",
      isActive: true,
      emailVerified: true,
      passwordHash: superHash,
    },
    create: {
      email: "superadmin@zanvargroup.com",
      name: "Super Admin",
      role: "SUPER_ADMIN",
      isActive: true,
      emailVerified: true,
      passwordHash: superHash,
    },
  });

  await prisma.user.upsert({
    where: { email: "hr@zanvargroup.com" },
    update: {
      name: "HR Admin",
      role: "HR_ADMIN",
      isActive: true,
      emailVerified: true,
      passwordHash: hrHash,
    },
    create: {
      email: "hr@zanvargroup.com",
      name: "HR Admin",
      role: "HR_ADMIN",
      isActive: true,
      emailVerified: true,
      passwordHash: hrHash,
    },
  });

  await prisma.user.upsert({
    where: { email: "cyclistprithvi@gmail.com" },
    update: {
      role: "SUPER_ADMIN",
      isActive: true,
      emailVerified: true,
    },
    create: {
      email: "cyclistprithvi@gmail.com",
      name: "Prithviraj Shahapure",
      role: "SUPER_ADMIN",
      isActive: true,
      emailVerified: true,
      passwordHash: superHash,
    },
  });

  // Verify counts
  const users = await prisma.user.count();
  const cands = await prisma.candidateProfile.count();
  const exams = await prisma.exam.count();
  const attempts = await prisma.attempt.count();

  console.log("\n=== DATABASE CLEANUP COMPLETE ===");
  console.log(`Total Users: ${users} (Super Admin & HR Admin)`);
  console.log(`Total Candidates: ${cands} (Clean 0)`);
  console.log(`Total Exams: ${exams} (Clean 0)`);
  console.log(`Total Attempts: ${attempts} (Clean 0)`);

  await prisma.$disconnect();
}

clean().catch((err) => {
  console.error("Cleanup error:", err);
  process.exit(1);
});

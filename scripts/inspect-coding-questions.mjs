import pkg from "@prisma/client";
const { PrismaClient } = pkg;
const prisma = new PrismaClient();

async function main() {
  const qs = await prisma.question.findMany({
    where: { type: "CODING" },
    select: { id: true, text: true, codeLanguage: true },
  });
  console.log("Found coding questions:", qs.length);
  for (const q of qs) {
    console.log(q);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());


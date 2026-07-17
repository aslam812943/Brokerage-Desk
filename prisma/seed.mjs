import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function upsertUser(rawUsername, password, role) {
  if (!rawUsername || !password) {
    console.log(`Skipping ${role} seed — SEED_${role}_USERNAME/PASSWORD not set in .env`);
    return;
  }
  const username = rawUsername.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { username },
    update: { passwordHash, role },
    create: { username, passwordHash, role },
  });
  console.log(`Seeded user "${username}" with role ${role}`);
}

async function main() {
  await upsertUser(process.env.SEED_ADMIN_USERNAME, process.env.SEED_ADMIN_PASSWORD, "ADMIN");
  await upsertUser(process.env.SEED_VIEWER_USERNAME, process.env.SEED_VIEWER_PASSWORD, "VIEWER");

  await prisma.targets.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, monthly: 0, dealerMonthly: {} },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../src/generated/prisma/client';
import seedData from './seed-rules.json';

const url = process.env.DATABASE_URL ?? 'file:./dev.db';
const adapter = new PrismaBetterSqlite3({ url });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding database...');

  // Upsert user
  const user = await prisma.user.upsert({
    where: { email: seedData.user.email },
    update: { name: seedData.user.name },
    create: {
      name: seedData.user.name,
      email: seedData.user.email,
    },
  });

  console.log(`User: ${user.name} (${user.id})`);

  // Upsert profile entries
  for (const entry of seedData.profile) {
    await prisma.userProfile.upsert({
      where: { userId_key: { userId: user.id, key: entry.key } },
      update: { value: entry.value },
      create: { userId: user.id, key: entry.key, value: entry.value },
    });
  }

  console.log(`Profile: ${seedData.profile.length} entries`);

  // Insert rules (skip duplicates by trigger+userId)
  let created = 0;
  let skipped = 0;

  for (const rule of seedData.rules) {
    const existing = await prisma.triageRule.findFirst({
      where: { userId: user.id, trigger: rule.trigger },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await prisma.triageRule.create({
      data: {
        userId: user.id,
        trigger: rule.trigger,
        action: rule.action,
        priority: rule.priority,
        digestSummaryTemplate: rule.digestSummaryTemplate,
        categoryLabel: rule.categoryLabel ?? null,
        notes: rule.notes,
        source: rule.source,
      },
    });
    created++;
  }

  console.log(`Rules: ${created} created, ${skipped} skipped`);
  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

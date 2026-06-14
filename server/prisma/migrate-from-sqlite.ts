/**
 * One-time migration: copy data from the old SQLite dev.db into Postgres.
 *
 * Usage (from server/):
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/emailos_dev \
 *     npx ts-node --project tsconfig.seed.json prisma/migrate-from-sqlite.ts ./dev.db
 *
 * - Reads the SQLite file given as the first argument (default: ./dev.db) using
 *   Node's built-in `node:sqlite` (Node 22+), so no extra dependency is needed.
 * - Writes into the Postgres database named by DATABASE_URL via Prisma.
 * - Preserves primary keys, so re-running is a no-op for already-copied rows.
 * - Run `prisma migrate deploy` against the target Postgres first so the schema
 *   exists.
 */
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const sqlitePath = resolve(process.argv[2] ?? './dev.db');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL (target Postgres) is not set');
if (connectionString.startsWith('file:')) {
  throw new Error('DATABASE_URL points at SQLite; set it to the target Postgres URL');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

type Row = Record<string, unknown>;

function toDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number' || typeof v === 'bigint') return new Date(Number(v));
  return new Date(String(v));
}

function reqDate(v: unknown): Date {
  return toDate(v) ?? new Date();
}

function toBool(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function toNullableBool(v: unknown): boolean | null {
  return v == null ? null : toBool(v);
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function nullableStr(v: unknown): string | null {
  return v == null ? null : String(v);
}

async function main() {
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  const read = (table: string): Row[] => {
    const exists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(table);
    if (!exists) return [];
    return db.prepare(`SELECT * FROM "${table}"`).all() as Row[];
  };

  const summary: Record<string, number> = {};

  // User
  const users = read('User');
  for (const u of users) {
    await prisma.user.upsert({
      where: { id: str(u.id) },
      update: {},
      create: {
        id: str(u.id),
        name: str(u.name),
        email: str(u.email),
        createdAt: reqDate(u.createdAt),
        accessToken: nullableStr(u.accessToken),
        refreshToken: nullableStr(u.refreshToken),
        tokenExpiry: toDate(u.tokenExpiry),
      },
    });
  }
  summary.User = users.length;

  // UserProfile
  const profiles = read('UserProfile');
  for (const p of profiles) {
    await prisma.userProfile.upsert({
      where: { id: str(p.id) },
      update: {},
      create: { id: str(p.id), userId: str(p.userId), key: str(p.key), value: str(p.value) },
    });
  }
  summary.UserProfile = profiles.length;

  // TriageRule — two passes so self-referential parentId always resolves.
  const rules = read('TriageRule');
  for (const r of rules) {
    await prisma.triageRule.upsert({
      where: { id: str(r.id) },
      update: {},
      create: {
        id: str(r.id),
        userId: str(r.userId),
        trigger: str(r.trigger),
        action: str(r.action),
        priority: str(r.priority),
        categoryLabel: nullableStr(r.categoryLabel),
        digestSummaryTemplate: str(r.digestSummaryTemplate),
        notes: nullableStr(r.notes),
        source: str(r.source),
        isActive: r.isActive == null ? true : toBool(r.isActive),
        pendingSuggestion: nullableStr(r.pendingSuggestion),
        createdAt: reqDate(r.createdAt),
        updatedAt: reqDate(r.updatedAt),
      },
    });
  }
  for (const r of rules) {
    if (r.parentId != null) {
      await prisma.triageRule.update({
        where: { id: str(r.id) },
        data: { parentId: str(r.parentId) },
      });
    }
  }
  summary.TriageRule = rules.length;

  // TriageDecision
  const decisions = read('TriageDecision');
  for (const d of decisions) {
    await prisma.triageDecision.upsert({
      where: { id: str(d.id) },
      update: {},
      create: {
        id: str(d.id),
        threadId: str(d.threadId),
        userId: str(d.userId),
        ruleId: nullableStr(d.ruleId),
        priority: str(d.priority),
        digestSummary: str(d.digestSummary),
        decidedAt: reqDate(d.decidedAt),
        confirmedByUser: toBool(d.confirmedByUser),
        wasCorrect: toNullableBool(d.wasCorrect),
        archivedAt: toDate(d.archivedAt),
        userFlagged: toBool(d.userFlagged),
      },
    });
  }
  summary.TriageDecision = decisions.length;

  // ThreadCache
  const threads = read('ThreadCache');
  for (const t of threads) {
    await prisma.threadCache.upsert({
      where: { id: str(t.id) },
      update: {},
      create: {
        id: str(t.id),
        userId: str(t.userId),
        subject: str(t.subject),
        sender: str(t.sender),
        snippet: str(t.snippet),
        date: str(t.date),
        labelIds: str(t.labelIds),
        toAddresses: str(t.toAddresses),
        listId: nullableStr(t.listId),
        htmlBody: nullableStr(t.htmlBody),
        plaintextBody: nullableStr(t.plaintextBody),
        cachedAt: reqDate(t.cachedAt),
        updatedAt: reqDate(t.updatedAt),
      },
    });
  }
  summary.ThreadCache = threads.length;

  // CachedMessage
  const messages = read('CachedMessage');
  for (const m of messages) {
    await prisma.cachedMessage.upsert({
      where: { id: str(m.id) },
      update: {},
      create: {
        id: str(m.id),
        threadId: str(m.threadId),
        userId: str(m.userId),
        sender: str(m.sender),
        toRecipients: str(m.toRecipients),
        date: str(m.date),
        subject: str(m.subject),
        snippet: str(m.snippet),
        htmlBody: nullableStr(m.htmlBody),
        plaintextBody: nullableStr(m.plaintextBody),
        isUnread: toBool(m.isUnread),
        labelIds: str(m.labelIds),
        listId: nullableStr(m.listId),
        position: Number(m.position ?? 0),
        cachedAt: reqDate(m.cachedAt),
      },
    });
  }
  summary.CachedMessage = messages.length;

  db.close();
  console.log('Migration complete. Rows copied:');
  for (const [table, count] of Object.entries(summary)) {
    console.log(`  ${table}: ${count}`);
  }
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

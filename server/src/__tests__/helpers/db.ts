import { prisma } from '../../db';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prismaAny = prisma as any;

export { prisma };

export async function resetDb(): Promise<void> {
  await prisma.triageDecision.deleteMany();
  await prismaAny.cachedMessage.deleteMany();
  await prisma.threadCache.deleteMany();
  await prisma.triageRule.deleteMany();
  await prisma.userProfile.deleteMany();
  await prisma.user.deleteMany();
}

export async function createTestUser(overrides: {
  email?: string;
  name?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: Date;
} = {}) {
  return prisma.user.create({
    data: {
      email: 'test@example.com',
      name: 'Test User',
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      tokenExpiry: new Date(new Date('2099-01-01').getTime()),
      ...overrides,
    },
  });
}

export async function createTestRule(userId: string, overrides: {
  trigger?: object;
  priority?: string;
  digestSummaryTemplate?: string;
  notes?: string;
} = {}) {
  const { trigger = { type: 'sender_domain', domain: 'example.com' }, priority = 'T3', digestSummaryTemplate = 'Summary: {subject}', notes } = overrides;
  return prisma.triageRule.create({
    data: {
      userId,
      trigger: JSON.stringify(trigger),
      action: 'digest',
      priority,
      digestSummaryTemplate,
      notes: notes ?? null,
      source: 'taught',
    },
  });
}

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';

// --- Hoisted mock refs ---
const { mockThreadsModify } = vi.hoisted(() => ({
  mockThreadsModify: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: function OAuth2Client() {
    return {
      generateAuthUrl: vi.fn().mockReturnValue('https://accounts.google.com/test'),
      getToken: vi.fn().mockResolvedValue({
        tokens: { access_token: 'tok', refresh_token: 'rtok', expiry_date: new Date('2099-01-01').getTime() },
      }),
      getTokenInfo: vi.fn().mockResolvedValue({ email: 'test@example.com' }),
      setCredentials: vi.fn(),
      refreshAccessToken: vi.fn().mockResolvedValue({
        credentials: { access_token: 'refreshed', expiry_date: new Date('2099-01-01').getTime() },
      }),
      on: vi.fn(),
    };
  },
}));

vi.mock('../../scheduler', () => ({ startScheduler: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: function Anthropic() { return { messages: { create: vi.fn() } }; },
}));

vi.mock('googleapis', () => ({
  google: {
    gmail: vi.fn().mockReturnValue({
      users: {
        threads: {
          list: vi.fn().mockResolvedValue({ data: { threads: [], nextPageToken: null } }),
          get: vi.fn().mockResolvedValue({ data: { messages: [] } }),
          modify: mockThreadsModify,
        },
        labels: { get: vi.fn() },
      },
    }),
  },
}));

import { app } from '../../app';
import { resetDb, prisma } from '../helpers/db';

let agent: ReturnType<typeof request.agent>;
let userId: string;

beforeAll(async () => {
  await resetDb();
  agent = request.agent(app);
  await agent.get('/auth/callback?code=test-code').expect(200);
  const user = await prisma.user.findUnique({ where: { email: 'test@example.com' } });
  userId = user!.id;
});

afterAll(async () => {
  await resetDb();
});

beforeEach(async () => {
  await prisma.triageDecision.deleteMany();
  await prisma.threadCache.deleteMany();
  await prisma.triageRule.deleteMany();
  // Only delete non-test users
  await prisma.user.deleteMany({ where: { email: { not: 'test@example.com' } } });
  mockThreadsModify.mockReset();
  mockThreadsModify.mockResolvedValue({});
});

async function createDecision(threadId: string, priority: string) {
  return prisma.triageDecision.create({
    data: { threadId, userId, priority, digestSummary: `Summary for ${threadId}` },
  });
}

async function seedThreadCache(threadId: string) {
  return prisma.threadCache.create({
    data: {
      id: threadId,
      userId,
      subject: `Subject: ${threadId}`,
      sender: 'sender@example.com',
      snippet: 'snippet',
      date: '2024-01-01',
      labelIds: '["INBOX","UNREAD"]',
    },
  });
}

describe('GET /api/gmail/decisions', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/gmail/decisions');
    expect(res.status).toBe(401);
  });

  it('groups active decisions by priority tier', async () => {
    await createDecision('th-t1', 'T1');
    await createDecision('th-t2', 'T2');
    await createDecision('th-t3', 'T3');
    await createDecision('th-t4', 'T4');

    const res = await agent.get('/api/gmail/decisions');
    expect(res.status).toBe(200);
    expect(res.body.T1).toHaveLength(1);
    expect(res.body.T2).toHaveLength(1);
    expect(res.body.T3).toHaveLength(1);
    expect(res.body.T4).toHaveLength(1);
  });

  it('excludes archived decisions', async () => {
    await prisma.triageDecision.create({
      data: { threadId: 'archived-th', userId, priority: 'T1', digestSummary: 'x', archivedAt: new Date() },
    });

    const res = await agent.get('/api/gmail/decisions');
    expect(res.body.T1).toHaveLength(0);
  });

  it('includes thread metadata from ThreadCache', async () => {
    await seedThreadCache('th-with-cache');
    await createDecision('th-with-cache', 'T2');

    const res = await agent.get('/api/gmail/decisions');
    const decision = res.body.T2[0] as { thread: { subject: string } };
    expect(decision.thread.subject).toBe('Subject: th-with-cache');
  });

  it('reflects messageCount and unreadCount from cachedMessages', async () => {
    const prismaAny = prisma as any;
    await seedThreadCache('th-counts');
    await createDecision('th-counts', 'T3');
    await prismaAny.cachedMessage.createMany({
      data: [
        { id: 'msg-1', threadId: 'th-counts', userId, sender: 's@x.com', date: '2024-01-01', subject: 'S', snippet: '', isUnread: true,  labelIds: '["UNREAD"]', position: 0 },
        { id: 'msg-2', threadId: 'th-counts', userId, sender: 's@x.com', date: '2024-01-01', subject: 'S', snippet: '', isUnread: false, labelIds: '[]',        position: 1 },
      ],
    });

    const res = await agent.get('/api/gmail/decisions');
    const decision = res.body.T3[0] as { thread: { messageCount: number; unreadCount: number } };
    expect(decision.thread.messageCount).toBe(2);
    expect(decision.thread.unreadCount).toBe(1);
  });
});

describe('GET /api/gmail/decisions error handling', () => {
  it('returns 500 when a database error occurs', async () => {
    vi.spyOn(prisma.triageDecision, 'findMany').mockRejectedValueOnce(new Error('DB error'));
    const res = await agent.get('/api/gmail/decisions');
    expect(res.status).toBe(500);
    vi.restoreAllMocks();
  });
});

describe('POST /api/gmail/decisions/:id/confirm', () => {
  it('returns 404 for non-existent decision', async () => {
    const res = await agent.post('/api/gmail/decisions/nonexistent/confirm');
    expect(res.status).toBe(404);
  });

  it('confirms T1/T2 decision: sets confirmedByUser and wasCorrect, removes UNREAD only', async () => {
    const d = await createDecision('th-t1-confirm', 'T1');
    const res = await agent.post(`/api/gmail/decisions/${d.id}/confirm`);
    expect(res.status).toBe(200);

    const updated = await prisma.triageDecision.findUnique({ where: { id: d.id } });
    expect(updated!.confirmedByUser).toBe(true);
    expect(updated!.wasCorrect).toBe(true);
    expect(updated!.archivedAt).toBeNull();

    const call = mockThreadsModify.mock.calls[0]![0] as { requestBody: { removeLabelIds: string[] } };
    expect(call.requestBody.removeLabelIds).toEqual(['UNREAD']);
  });

  it('returns 500 when a database error occurs in confirm', async () => {
    const d = await createDecision('th-confirm-err', 'T1');
    vi.spyOn(prisma.triageDecision, 'update').mockRejectedValueOnce(new Error('DB error'));
    const res = await agent.post(`/api/gmail/decisions/${d.id}/confirm`);
    expect(res.status).toBe(500);
    vi.restoreAllMocks();
  });

  it('confirms T3 decision: archives it and removes INBOX + UNREAD', async () => {
    const d = await createDecision('th-t3-confirm', 'T3');
    await agent.post(`/api/gmail/decisions/${d.id}/confirm`);

    const updated = await prisma.triageDecision.findUnique({ where: { id: d.id } });
    expect(updated!.archivedAt).not.toBeNull();

    const call = mockThreadsModify.mock.calls[0]![0] as { requestBody: { removeLabelIds: string[] } };
    expect(call.requestBody.removeLabelIds).toContain('INBOX');
    expect(call.requestBody.removeLabelIds).toContain('UNREAD');
  });
});

describe('POST /api/gmail/decisions/:id/done', () => {
  it('returns 404 for non-existent decision', async () => {
    const res = await agent.post('/api/gmail/decisions/nonexistent/done');
    expect(res.status).toBe(404);
  });

  it('archives decision and removes INBOX + UNREAD labels', async () => {
    const d = await createDecision('th-done', 'T1');
    const res = await agent.post(`/api/gmail/decisions/${d.id}/done`);
    expect(res.status).toBe(200);

    const updated = await prisma.triageDecision.findUnique({ where: { id: d.id } });
    expect(updated!.archivedAt).not.toBeNull();
    expect(updated!.wasCorrect).toBe(true);
    expect(updated!.confirmedByUser).toBe(true);

    const call = mockThreadsModify.mock.calls[0]![0] as { requestBody: { removeLabelIds: string[] } };
    expect(call.requestBody.removeLabelIds).toContain('INBOX');
    expect(call.requestBody.removeLabelIds).toContain('UNREAD');
  });
});

describe('POST /api/gmail/decisions/:id/done', () => {
  it('returns 500 when a database error occurs', async () => {
    const d = await createDecision('th-done-err', 'T1');
    vi.spyOn(prisma.triageDecision, 'update').mockRejectedValueOnce(new Error('DB error'));
    const res = await agent.post(`/api/gmail/decisions/${d.id}/done`);
    expect(res.status).toBe(500);
    vi.restoreAllMocks();
  });
});

describe('POST /api/gmail/decisions/:id/followup', () => {
  it('returns 404 for non-existent decision', async () => {
    const res = await agent.post('/api/gmail/decisions/nonexistent/followup');
    expect(res.status).toBe(404);
  });

  it('sets userFlagged=true, changes priority to T2, removes UNREAD', async () => {
    const d = await createDecision('th-followup', 'T3');
    const res = await agent.post(`/api/gmail/decisions/${d.id}/followup`);
    expect(res.status).toBe(200);

    const updated = await prisma.triageDecision.findUnique({ where: { id: d.id } });
    expect(updated!.userFlagged).toBe(true);
    expect(updated!.priority).toBe('T2');
    expect(updated!.archivedAt).toBeNull();

    const call = mockThreadsModify.mock.calls[0]![0] as { requestBody: { removeLabelIds: string[] } };
    expect(call.requestBody.removeLabelIds).toEqual(['UNREAD']);
  });

  it('returns 500 when a database error occurs', async () => {
    const d = await createDecision('th-followup-err', 'T3');
    vi.spyOn(prisma.triageDecision, 'update').mockRejectedValueOnce(new Error('DB error'));
    const res = await agent.post(`/api/gmail/decisions/${d.id}/followup`);
    expect(res.status).toBe(500);
    vi.restoreAllMocks();
  });
});

describe('POST /api/gmail/decisions/confirm-all', () => {
  it('returns ok with processed=0 when decisionIds is empty', async () => {
    const res = await agent.post('/api/gmail/decisions/confirm-all').send({ decisionIds: [], tier: 'T1' });
    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(0);
  });

  it('bulk confirms T1 decisions without archiving', async () => {
    const d1 = await createDecision('th-bulk-1', 'T1');
    const d2 = await createDecision('th-bulk-2', 'T1');

    const res = await agent.post('/api/gmail/decisions/confirm-all').send({
      decisionIds: [d1.id, d2.id],
      tier: 'T1',
    });
    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(2);

    const updated = await prisma.triageDecision.findMany({ where: { id: { in: [d1.id, d2.id] } } });
    for (const d of updated) {
      expect(d.confirmedByUser).toBe(true);
      expect(d.archivedAt).toBeNull();
    }
  });

  it('bulk confirms T3 decisions with archive', async () => {
    const d = await createDecision('th-bulk-t3', 'T3');

    await agent.post('/api/gmail/decisions/confirm-all').send({ decisionIds: [d.id], tier: 'T3' });

    const updated = await prisma.triageDecision.findUnique({ where: { id: d.id } });
    expect(updated!.archivedAt).not.toBeNull();
  });

  it('returns 500 when a database error occurs', async () => {
    const d = await createDecision('th-db-err', 'T1');
    vi.spyOn(prisma.triageDecision, 'updateMany').mockRejectedValueOnce(new Error('DB error'));
    const res = await agent.post('/api/gmail/decisions/confirm-all').send({
      decisionIds: [d.id],
      tier: 'T1',
    });
    expect(res.status).toBe(500);
    vi.restoreAllMocks();
  });
});

describe('POST /api/gmail/decisions/:id/misclassified', () => {
  it('returns 404 for non-existent decision', async () => {
    const res = await agent.post('/api/gmail/decisions/nonexistent/misclassified');
    expect(res.status).toBe(404);
  });

  it('sets wasCorrect=false and archives the decision', async () => {
    const d = await createDecision('th-misc', 'T2');
    const res = await agent.post(`/api/gmail/decisions/${d.id}/misclassified`);
    expect(res.status).toBe(200);
    expect(res.body.threadId).toBe('th-misc');

    const updated = await prisma.triageDecision.findUnique({ where: { id: d.id } });
    expect(updated!.wasCorrect).toBe(false);
    expect(updated!.archivedAt).not.toBeNull();
  });

  it('rejects decisions belonging to another user with 404', async () => {
    const otherUser = await prisma.user.create({
      data: { email: 'other@example.com', name: 'Other' },
    });
    const d = await prisma.triageDecision.create({
      data: { threadId: 'other-th', userId: otherUser.id, priority: 'T1', digestSummary: 'x' },
    });

    const res = await agent.post(`/api/gmail/decisions/${d.id}/misclassified`);
    expect(res.status).toBe(404);
  });

  it('returns 500 when a database error occurs', async () => {
    const d = await createDecision('th-misc-err', 'T2');
    vi.spyOn(prisma.triageDecision, 'update').mockRejectedValueOnce(new Error('DB error'));
    const res = await agent.post(`/api/gmail/decisions/${d.id}/misclassified`);
    expect(res.status).toBe(500);
    vi.restoreAllMocks();
  });
});

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';

// --- Hoisted mock refs ---
const { mockCreate, mockThreadsList, mockThreadsGet } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockThreadsList: vi.fn(),
  mockThreadsGet: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: function Anthropic() {
    return { messages: { create: mockCreate } };
  },
}));

vi.mock('googleapis', () => ({
  google: {
    gmail: vi.fn().mockReturnValue({
      users: {
        threads: { list: mockThreadsList, get: mockThreadsGet, modify: vi.fn() },
        labels: { get: vi.fn() },
      },
    }),
  },
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
  await prisma.user.deleteMany({ where: { email: { not: 'test@example.com' } } });
  mockCreate.mockReset();
  mockThreadsList.mockReset();
  mockThreadsGet.mockReset();
  mockThreadsList.mockResolvedValue({ data: { threads: [], nextPageToken: null } });
  // Safe default so unexpected calls don't throw on detail.data
  mockThreadsGet.mockResolvedValue({ data: { id: '', messages: [] } });
});

const THREAD_CONTEXT = {
  subject: 'Your Invoice',
  sender: 'billing@acme.com',
  snippet: 'Invoice #1234 is ready',
  date: '2024-01-01',
  threadId: 'th-invoice',
};

describe('POST /api/agent/teach', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/agent/teach').send({ messages: [], threadContext: THREAD_CONTEXT });
    expect(res.status).toBe(401);
  });

  it('calls Anthropic API and returns response text', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'What priority should this email be?' }],
    });

    const res = await agent.post('/api/agent/teach').send({
      messages: [{ role: 'user', content: 'What should I do with billing emails?' }],
      threadContext: THREAD_CONTEXT,
    });

    expect(res.status).toBe(200);
    expect(res.body.response).toBe('What priority should this email be?');
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it('includes thread context in the system prompt', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'ok' }] });

    await agent.post('/api/agent/teach').send({
      messages: [{ role: 'user', content: 'help' }],
      threadContext: THREAD_CONTEXT,
    });

    const call = mockCreate.mock.calls[0]![0] as { system: string };
    expect(call.system).toContain('Your Invoice');
    expect(call.system).toContain('billing@acme.com');
  });

  it('injects existing rules into the system prompt', async () => {
    await prisma.triageRule.create({
      data: {
        userId,
        trigger: JSON.stringify({ type: 'sender_domain', domain: 'acme.com' }),
        action: 'digest',
        priority: 'T3',
        digestSummaryTemplate: 'Invoice: {amount}',
        source: 'agent',
      },
    });

    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'ok' }] });

    await agent.post('/api/agent/teach').send({
      messages: [{ role: 'user', content: 'help' }],
      threadContext: THREAD_CONTEXT,
    });

    const call = mockCreate.mock.calls[0]![0] as { system: string };
    expect(call.system).toContain('acme.com');
  });

  it('returns 500 when Anthropic API throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API failure'));

    const res = await agent.post('/api/agent/teach').send({
      messages: [{ role: 'user', content: 'help' }],
      threadContext: THREAD_CONTEXT,
    });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Agent request failed');
  });

  it('returns 500 when ANTHROPIC_MODEL env var is missing', async () => {
    const original = process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_MODEL;

    const res = await agent.post('/api/agent/teach').send({
      messages: [],
      threadContext: THREAD_CONTEXT,
    });
    expect(res.status).toBe(500);

    process.env.ANTHROPIC_MODEL = original;
  });

  it('includes userContext in the system prompt when provided', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'ok' }] });
    await agent.post('/api/agent/teach').send({
      messages: [{ role: 'user', content: 'help' }],
      threadContext: THREAD_CONTEXT,
      userContext: 'This user runs a startup inbox.',
    });
    const call = mockCreate.mock.calls[0]![0] as { system: string };
    expect(call.system).toContain('This user runs a startup inbox.');
  });

  it('includes rule notes in the injected existing-rules list', async () => {
    await prisma.triageRule.create({
      data: {
        userId,
        trigger: JSON.stringify({ type: 'sender', sender: 'boss@corp.com' }),
        action: 'digest',
        priority: 'T1',
        digestSummaryTemplate: 'Boss: {subject}',
        notes: 'VIP sender — never delay',
        source: 'agent',
      },
    });
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'ok' }] });
    await agent.post('/api/agent/teach').send({
      messages: [{ role: 'user', content: 'help' }],
      threadContext: THREAD_CONTEXT,
    });
    const call = mockCreate.mock.calls[0]![0] as { system: string };
    expect(call.system).toContain('VIP sender — never delay');
  });
});

describe('POST /api/agent/rules', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/agent/rules').send({ rule: {} });
    expect(res.status).toBe(401);
  });

  it('creates a new TriageRule with valid sender_domain trigger', async () => {
    const res = await agent.post('/api/agent/rules').send({
      rule: {
        trigger: { type: 'sender_domain', domain: 'acme.com' },
        action: 'digest',
        priority: 'T3',
        digestSummaryTemplate: 'From ACME: {subject}',
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.ruleId).toBeTruthy();

    const rule = await prisma.triageRule.findUnique({ where: { id: res.body.ruleId } });
    expect(rule).not.toBeNull();
    expect(rule!.priority).toBe('T3');
  });

  it('updates existing rule when existingRuleId is provided', async () => {
    const existing = await prisma.triageRule.create({
      data: {
        userId,
        trigger: JSON.stringify({ type: 'sender_domain', domain: 'old.com' }),
        action: 'digest',
        priority: 'T4',
        digestSummaryTemplate: 'old template',
        source: 'agent',
      },
    });

    await agent.post('/api/agent/rules').send({
      rule: {
        existingRuleId: existing.id,
        trigger: { type: 'sender_domain', domain: 'new.com' },
        action: 'digest',
        priority: 'T2',
        digestSummaryTemplate: 'new template',
      },
    });

    const updated = await prisma.triageRule.findUnique({ where: { id: existing.id } });
    expect(updated!.priority).toBe('T2');
    expect(JSON.parse(updated!.trigger).domain).toBe('new.com');
  });

  it('saves rule with raw trigger string when trigger JSON is invalid (normalizeTrigger catch)', async () => {
    const res = await agent.post('/api/agent/rules').send({
      rule: {
        trigger: 'not-valid-json{', // normalizeTrigger catch returns raw string
        action: 'digest',
        priority: 'T3',
        digestSummaryTemplate: 'x',
      },
    });
    // Rule is saved with the raw trigger; no Gmail match since trigger can't parse
    expect(res.status).toBe(200);
    expect(res.body.ruleId).toBeTruthy();
    expect(res.body.matchingThreads).toEqual([]);
  });

  it('returns empty matchingThreads when user has no Gmail access token', async () => {
    await prisma.user.update({ where: { email: 'test@example.com' }, data: { accessToken: null } });

    const res = await agent.post('/api/agent/rules').send({
      rule: {
        trigger: { type: 'sender_domain', domain: 'acme.com' },
        action: 'digest',
        priority: 'T3',
        digestSummaryTemplate: 'x',
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.matchingThreads).toEqual([]);

    // Restore token so remaining tests authenticate properly
    await prisma.user.update({ where: { email: 'test@example.com' }, data: { accessToken: 'tok' } });
  });

  it('returns 404 when existingRuleId belongs to another user', async () => {
    const other = await prisma.user.create({ data: { email: 'other2@example.com', name: 'Other' } });
    const rule = await prisma.triageRule.create({
      data: {
        userId: other.id,
        trigger: JSON.stringify({ type: 'sender_domain', domain: 'x.com' }),
        action: 'digest',
        priority: 'T3',
        digestSummaryTemplate: 'x',
        source: 'agent',
      },
    });

    const res = await agent.post('/api/agent/rules').send({
      rule: {
        existingRuleId: rule.id,
        trigger: { type: 'sender_domain', domain: 'x.com' },
        action: 'digest',
        priority: 'T3',
        digestSummaryTemplate: 'x',
      },
    });
    expect(res.status).toBe(404);
  });

  it('returns matching threads from the inbox', async () => {
    mockThreadsList.mockResolvedValueOnce({
      data: { threads: [{ id: 'th-match', snippet: 'invoice' }], nextPageToken: null },
    });
    mockThreadsGet.mockResolvedValueOnce({
      data: {
        messages: [{
          id: 'msg-1',
          payload: {
            headers: [
              { name: 'Subject', value: 'Your Invoice' },
              { name: 'From', value: 'billing@acme.com' },
              { name: 'Date', value: '2024-01-01' },
              { name: 'To', value: 'me@example.com' },
            ],
            mimeType: 'text/plain',
            body: { data: Buffer.from('invoice body').toString('base64url') },
          },
          labelIds: ['INBOX'],
          snippet: 'invoice',
        }],
      },
    });

    const res = await agent.post('/api/agent/rules').send({
      rule: {
        trigger: { type: 'sender_domain', domain: 'acme.com' },
        action: 'digest',
        priority: 'T3',
        digestSummaryTemplate: 'Invoice from ACME',
      },
    });

    expect(res.body.matchingThreads).toHaveLength(1);
    expect(res.body.matchingThreads[0].threadId).toBe('th-match');
  });

  it('uses cached thread metadata when matching threads in the inbox', async () => {
    // Seed a fresh ThreadCache entry so the route takes the else/cache-hit path
    await prisma.threadCache.create({
      data: {
        id: 'th-cached-rules',
        userId,
        subject: 'Cached Email',
        sender: 'billing@acme.com',
        snippet: 'cached',
        date: '2024-01-01',
        labelIds: '["INBOX"]',
        toAddresses: '["me@example.com"]',
      },
    });

    mockThreadsList.mockResolvedValueOnce({
      data: { threads: [{ id: 'th-cached-rules', snippet: 'cached' }], nextPageToken: null },
    });

    const res = await agent.post('/api/agent/rules').send({
      rule: {
        trigger: { type: 'sender_domain', domain: 'acme.com' },
        action: 'digest',
        priority: 'T3',
        digestSummaryTemplate: 'x',
      },
    });
    expect(res.status).toBe(200);
    expect(mockThreadsGet).not.toHaveBeenCalled(); // served from cache
    const ids = (res.body.matchingThreads as Array<{ threadId: string }>).map((t) => t.threadId);
    expect(ids).toContain('th-cached-rules');
  });

  it('stores JSON.stringify of trigger when trigger is an invalid object (normalizeTrigger object fallback)', async () => {
    const badTrigger = { type: 'unknown_trigger_type', extra: 'x' };
    const res = await agent.post('/api/agent/rules').send({
      rule: { trigger: badTrigger, action: 'digest', priority: 'T3', digestSummaryTemplate: 'x' },
    });
    expect(res.status).toBe(200);
    const rule = await prisma.triageRule.findUnique({ where: { id: res.body.ruleId } });
    expect(rule!.trigger).toBe(JSON.stringify(badTrigger));
  });

  it('scans all pages when the Gmail inbox spans multiple pages', async () => {
    mockThreadsList
      .mockResolvedValueOnce({
        data: { threads: [{ id: 'p1-th', snippet: 'page one' }], nextPageToken: 'page2-token' },
      })
      .mockResolvedValueOnce({
        data: { threads: [{ id: 'p2-th', snippet: 'page two' }], nextPageToken: null },
      });
    mockThreadsGet
      .mockResolvedValueOnce({
        data: {
          messages: [{
            id: 'p1-msg',
            payload: {
              headers: [
                { name: 'Subject', value: 'Page 1 Email' },
                { name: 'From', value: 'sender@acme.com' },
                { name: 'Date', value: '2024-01-01' },
                { name: 'To', value: 'me@example.com' },
              ],
              mimeType: 'text/plain',
              body: { data: Buffer.from('body').toString('base64url') },
            },
            labelIds: ['INBOX'],
            snippet: 'page one',
          }],
        },
      })
      .mockResolvedValueOnce({
        data: {
          messages: [{
            id: 'p2-msg',
            payload: {
              headers: [
                { name: 'Subject', value: 'Page 2 Email' },
                { name: 'From', value: 'sender@acme.com' },
                { name: 'Date', value: '2024-01-01' },
                { name: 'To', value: 'me@example.com' },
              ],
              mimeType: 'text/plain',
              body: { data: Buffer.from('body').toString('base64url') },
            },
            labelIds: ['INBOX'],
            snippet: 'page two',
          }],
        },
      });

    const res = await agent.post('/api/agent/rules').send({
      rule: { trigger: { type: 'sender_domain', domain: 'acme.com' }, action: 'digest', priority: 'T3', digestSummaryTemplate: 'x' },
    });

    expect(mockThreadsList).toHaveBeenCalledTimes(2);
    const ids = (res.body.matchingThreads as Array<{ threadId: string }>).map((t) => t.threadId);
    expect(ids).toContain('p1-th');
    expect(ids).toContain('p2-th');
  });

  it('skips threads whose id is null in the inbox listing', async () => {
    mockThreadsList.mockResolvedValueOnce({
      data: {
        threads: [
          { id: null, snippet: 'no-id' },
          { id: 'th-real', snippet: 'real' },
        ],
        nextPageToken: null,
      },
    });
    mockThreadsGet.mockResolvedValueOnce({
      data: {
        messages: [{
          id: 'msg-real',
          payload: {
            headers: [
              { name: 'Subject', value: 'Real Thread' },
              { name: 'From', value: 'sender@acme.com' },
              { name: 'Date', value: '2024-01-01' },
              { name: 'To', value: 'me@example.com' },
            ],
            mimeType: 'text/plain',
            body: { data: Buffer.from('body').toString('base64url') },
          },
          labelIds: ['INBOX'],
          snippet: 'real',
        }],
      },
    });

    const res = await agent.post('/api/agent/rules').send({
      rule: { trigger: { type: 'sender_domain', domain: 'acme.com' }, action: 'digest', priority: 'T3', digestSummaryTemplate: 'x' },
    });

    expect(mockThreadsGet).toHaveBeenCalledOnce();
    const ids = (res.body.matchingThreads as Array<{ threadId: string }>).map((t) => t.threadId);
    expect(ids).toContain('th-real');
  });

  it('returns an empty matchingThreads list when inbox threads do not match the rule', async () => {
    mockThreadsList.mockResolvedValueOnce({
      data: { threads: [{ id: 'th-nomatch', snippet: 'other domain' }], nextPageToken: null },
    });
    mockThreadsGet.mockResolvedValueOnce({
      data: {
        messages: [{
          id: 'msg-nomatch',
          payload: {
            headers: [
              { name: 'Subject', value: 'Newsletter' },
              { name: 'From', value: 'news@otherdomain.com' },
              { name: 'Date', value: '2024-01-01' },
              { name: 'To', value: 'me@example.com' },
            ],
            mimeType: 'text/plain',
            body: { data: Buffer.from('body').toString('base64url') },
          },
          labelIds: ['INBOX'],
          snippet: 'other domain',
        }],
      },
    });

    const res = await agent.post('/api/agent/rules').send({
      rule: { trigger: { type: 'sender_domain', domain: 'acme.com' }, action: 'digest', priority: 'T3', digestSummaryTemplate: 'x' },
    });

    expect(res.body.matchingThreads).toHaveLength(0);
    expect(mockThreadsGet).toHaveBeenCalledOnce();
  });

  it('returns 500 when a database error occurs while saving the rule', async () => {
    vi.spyOn(prisma.triageRule, 'create').mockRejectedValueOnce(new Error('DB error'));
    const res = await agent.post('/api/agent/rules').send({
      rule: {
        trigger: { type: 'sender_domain', domain: 'acme.com' },
        action: 'digest',
        priority: 'T3',
        digestSummaryTemplate: 'x',
      },
    });
    expect(res.status).toBe(500);
    vi.restoreAllMocks();
  });

  it('skips already-decided threads in matching results', async () => {
    // wasCorrect: true ensures the filter `wasCorrect: { not: false }` matches this row
    await prisma.triageDecision.create({
      data: { threadId: 'already-decided', userId, priority: 'T1', digestSummary: 'x', wasCorrect: true },
    });

    mockThreadsList.mockResolvedValueOnce({
      data: {
        threads: [
          { id: 'already-decided', snippet: 'decided' },
          { id: 'new-th', snippet: 'new' },
        ],
        nextPageToken: null,
      },
    });
    mockThreadsGet.mockResolvedValueOnce({
      data: {
        messages: [{
          id: 'msg-new',
          payload: {
            headers: [
              { name: 'Subject', value: 'New Email' },
              { name: 'From', value: 'sender@acme.com' },
              { name: 'Date', value: '2024-01-01' },
              { name: 'To', value: 'me@example.com' },
            ],
            mimeType: 'text/plain',
            body: { data: Buffer.from('body').toString('base64url') },
          },
          labelIds: ['INBOX'],
          snippet: 'new',
        }],
      },
    });

    const res = await agent.post('/api/agent/rules').send({
      rule: {
        trigger: { type: 'sender_domain', domain: 'acme.com' },
        action: 'digest',
        priority: 'T3',
        digestSummaryTemplate: 'x',
      },
    });

    const ids = (res.body.matchingThreads as Array<{ threadId: string }>).map((t) => t.threadId);
    expect(ids).not.toContain('already-decided');
  });
});

describe('POST /api/agent/rules/:ruleId/apply', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/agent/rules/any-id/apply').send({ threadIds: [] });
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-existent rule', async () => {
    const res = await agent.post('/api/agent/rules/nonexistent/apply').send({ threadIds: [] });
    expect(res.status).toBe(404);
  });

  it('creates TriageDecision for each thread with digest summary', async () => {
    const rule = await prisma.triageRule.create({
      data: {
        userId,
        trigger: JSON.stringify({ type: 'sender_domain', domain: 'acme.com' }),
        action: 'digest',
        priority: 'T3',
        digestSummaryTemplate: 'Invoice: {subject}',
        source: 'agent',
      },
    });
    await prisma.threadCache.create({
      data: {
        id: 'th-apply',
        userId,
        subject: 'Apply Test',
        sender: 'billing@acme.com',
        snippet: 'apply snippet',
        date: '2024-01-01',
        labelIds: '["INBOX"]',
      },
    });

    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Invoice: Apply Test' }] });

    const res = await agent.post(`/api/agent/rules/${rule.id}/apply`).send({
      threadIds: ['th-apply'],
    });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(1);

    const decision = await prisma.triageDecision.findFirst({ where: { threadId: 'th-apply', userId } });
    expect(decision).not.toBeNull();
    expect(decision!.priority).toBe('T3');
  });

  it('skips threads already decided (non-wrong) and counts them', async () => {
    const rule = await prisma.triageRule.create({
      data: {
        userId,
        trigger: JSON.stringify({ type: 'sender_domain', domain: 'acme.com' }),
        action: 'digest',
        priority: 'T3',
        digestSummaryTemplate: 'x',
        source: 'agent',
      },
    });
    // wasCorrect: true ensures the blocking decision filter `wasCorrect: { not: false }` matches
    await prisma.triageDecision.create({
      data: { threadId: 'already-th', userId, priority: 'T1', digestSummary: 'existing', wasCorrect: true },
    });

    const res = await agent.post(`/api/agent/rules/${rule.id}/apply`).send({
      threadIds: ['already-th'],
    });
    expect(res.body.applied).toBe(1);
    const decisions = await prisma.triageDecision.findMany({ where: { threadId: 'already-th', userId } });
    expect(decisions).toHaveLength(1);
  });

  it('closes a wasCorrect=false decision and creates a new one (wrong-decision archive path)', async () => {
    const rule = await prisma.triageRule.create({
      data: {
        userId,
        trigger: JSON.stringify({ type: 'sender_domain', domain: 'acme.com' }),
        action: 'digest',
        priority: 'T2',
        digestSummaryTemplate: 'Fixed: {subject}',
        source: 'agent',
      },
    });
    const wrongDecision = await prisma.triageDecision.create({
      data: { threadId: 'wrong-th', userId, priority: 'T4', digestSummary: 'wrong', wasCorrect: false },
    });
    await prisma.threadCache.create({
      data: {
        id: 'wrong-th',
        userId,
        subject: 'Misclassified Email',
        sender: 'billing@acme.com',
        snippet: 'snippet',
        date: '2024-01-01',
        labelIds: '["INBOX"]',
      },
    });

    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Fixed: Misclassified Email' }] });

    const res = await agent.post(`/api/agent/rules/${rule.id}/apply`).send({
      threadIds: ['wrong-th'],
    });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(1);

    // Old wrong decision should be archived
    const old = await prisma.triageDecision.findUnique({ where: { id: wrongDecision.id } });
    expect(old!.archivedAt).not.toBeNull();

    // New active decision should exist with the correct priority
    const newDec = await prisma.triageDecision.findFirst({ where: { threadId: 'wrong-th', userId, archivedAt: null } });
    expect(newDec).not.toBeNull();
    expect(newDec!.priority).toBe('T2');
  });

  it('fetches and caches thread from Gmail when no cache exists during apply', async () => {
    const rule = await prisma.triageRule.create({
      data: {
        userId,
        trigger: JSON.stringify({ type: 'sender_domain', domain: 'acme.com' }),
        action: 'digest',
        priority: 'T3',
        digestSummaryTemplate: 'Summary',
        source: 'agent',
      },
    });
    // No threadCache entry — fetchAndCacheThread must be called
    mockThreadsGet.mockResolvedValueOnce({
      data: {
        id: 'uncached-apply-th',
        messages: [{
          id: 'msg-uncached-apply',
          payload: {
            headers: [
              { name: 'Subject', value: 'Uncached Apply' },
              { name: 'From', value: 'billing@acme.com' },
              { name: 'Date', value: '2024-01-01' },
              { name: 'To', value: 'me@example.com' },
            ],
            mimeType: 'text/plain',
            body: { data: Buffer.from('body').toString('base64url') },
          },
          labelIds: [],
          snippet: '',
        }],
      },
    });
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Fetched summary' }] });

    const res = await agent.post(`/api/agent/rules/${rule.id}/apply`).send({
      threadIds: ['uncached-apply-th'],
    });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(1);
    expect(mockThreadsGet).toHaveBeenCalledOnce();

    const cached = await prisma.threadCache.findUnique({ where: { id: 'uncached-apply-th' } });
    expect(cached).not.toBeNull();
  });

  it('returns 400 when user has no Gmail tokens during apply', async () => {
    const rule = await prisma.triageRule.create({
      data: {
        userId,
        trigger: JSON.stringify({ type: 'sender_domain', domain: 'acme.com' }),
        action: 'digest',
        priority: 'T3',
        digestSummaryTemplate: 'x',
        source: 'agent',
      },
    });
    await prisma.user.update({ where: { email: 'test@example.com' }, data: { accessToken: null } });

    const res = await agent.post(`/api/agent/rules/${rule.id}/apply`).send({ threadIds: ['th-1'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No Gmail tokens');

    await prisma.user.update({ where: { email: 'test@example.com' }, data: { accessToken: 'tok' } });
  });

  it('returns 500 when an unexpected error occurs during apply', async () => {
    const rule = await prisma.triageRule.create({
      data: {
        userId,
        trigger: JSON.stringify({ type: 'sender_domain', domain: 'acme.com' }),
        action: 'digest',
        priority: 'T3',
        digestSummaryTemplate: 'x',
        source: 'agent',
      },
    });
    await prisma.threadCache.create({
      data: {
        id: 'th-apply-err',
        userId,
        subject: 'Error Test',
        sender: 'billing@acme.com',
        snippet: 's',
        date: '2024-01-01',
        labelIds: '["INBOX"]',
      },
    });

    // Make buildDigestSummary throw by having Anthropic fail without a fallback snippet
    mockCreate.mockRejectedValueOnce(new Error('API failure'));
    // Override the mock so the error propagates (no snippet fallback since summarizer catches internally)
    // The error must come from prisma or some other non-caught path
    vi.spyOn(prisma.triageDecision, 'create').mockRejectedValueOnce(new Error('DB error'));

    const res = await agent.post(`/api/agent/rules/${rule.id}/apply`).send({
      threadIds: ['th-apply-err'],
    });
    expect(res.status).toBe(500);
    vi.restoreAllMocks();
  });
});

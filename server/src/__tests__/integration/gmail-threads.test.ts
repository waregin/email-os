import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';

// --- Hoisted mock refs ---
const { mockThreadsList, mockThreadsGet, mockThreadsModify, mockLabelsGet } = vi.hoisted(() => ({
  mockThreadsList: vi.fn(),
  mockThreadsGet: vi.fn(),
  mockThreadsModify: vi.fn(),
  mockLabelsGet: vi.fn(),
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
        threads: { list: mockThreadsList, get: mockThreadsGet, modify: mockThreadsModify },
        labels: { get: mockLabelsGet },
      },
    }),
  },
}));

import { app } from '../../app';
import { resetDb, prisma } from '../helpers/db';

function makeThreadGetResponse(subject: string, sender: string, date = 'Mon, 1 Jan 2024 12:00:00 +0000', threadId?: string) {
  return {
    data: {
      ...(threadId ? { id: threadId } : {}),
      messages: [{
        id: 'msg-1',
        payload: {
          headers: [
            { name: 'Subject', value: subject },
            { name: 'From', value: sender },
            { name: 'Date', value: date },
            { name: 'To', value: 'me@example.com' },
          ],
          mimeType: 'text/plain',
          body: { data: Buffer.from('Test email body').toString('base64url') },
        },
        labelIds: ['INBOX', 'UNREAD'],
        snippet: 'Test snippet',
      }],
    },
  };
}

let agent: ReturnType<typeof request.agent>;

beforeAll(async () => {
  await resetDb();
  agent = request.agent(app);
  await agent.get('/auth/callback?code=test-code').expect(200);
});

afterAll(async () => {
  await resetDb();
});

beforeEach(async () => {
  // Reset mocks but keep session active
  await prisma.triageDecision.deleteMany();
  await prisma.threadCache.deleteMany();
  mockThreadsList.mockReset();
  mockThreadsGet.mockReset();
  mockThreadsModify.mockReset();
  mockLabelsGet.mockReset();
});

describe('GET /api/gmail/threads', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/gmail/threads');
    expect(res.status).toBe(401);
  });

  it('lists threads with subject, sender, and date metadata', async () => {
    mockThreadsList.mockResolvedValueOnce({
      data: { threads: [{ id: 'th-1', snippet: 'snippet text' }], nextPageToken: null },
    });
    mockThreadsGet.mockResolvedValueOnce(makeThreadGetResponse('Test Subject', 'alice@example.com'));

    const res = await agent.get('/api/gmail/threads');
    expect(res.status).toBe(200);
    expect(res.body.threads).toHaveLength(1);
    expect(res.body.threads[0].subject).toBe('Test Subject');
    expect(res.body.threads[0].sender).toBe('alice@example.com');
  });

  it('passes search query q to Gmail API', async () => {
    mockThreadsList.mockResolvedValueOnce({ data: { threads: [], nextPageToken: null } });

    await agent.get('/api/gmail/threads?q=label:important');
    const call = mockThreadsList.mock.calls[0]![0] as { q: string };
    expect(call.q).toBe('label:important');
  });

  it('filters to undecided threads when undecided=true', async () => {
    const user = await prisma.user.findUnique({ where: { email: 'test@example.com' } });
    await prisma.triageDecision.create({
      data: { threadId: 'decided-thread-id', userId: user!.id, priority: 'T3', digestSummary: 'x' },
    });

    mockThreadsList.mockResolvedValueOnce({
      data: {
        threads: [
          { id: 'decided-thread-id', snippet: 'decided' },
          { id: 'new-thread-id', snippet: 'new' },
        ],
        nextPageToken: null,
      },
    });
    mockThreadsGet.mockResolvedValueOnce(makeThreadGetResponse('New Thread', 'bob@example.com'));

    const res = await agent.get('/api/gmail/threads?undecided=true');
    expect(res.status).toBe(200);
    const ids = (res.body.threads as Array<{ id: string }>).map((t) => t.id);
    expect(ids).not.toContain('decided-thread-id');
    expect(ids).toContain('new-thread-id');
  });

  it('returns 500 when Gmail API fails', async () => {
    mockThreadsList.mockRejectedValueOnce(new Error('Gmail API error'));
    const res = await agent.get('/api/gmail/threads');
    expect(res.status).toBe(500);
  });

  it('paginates to a second page when the first page has only decided threads (undecided=true)', async () => {
    const user = await prisma.user.findUnique({ where: { email: 'test@example.com' } });
    await prisma.triageDecision.create({
      data: { threadId: 'decided-p1', userId: user!.id, priority: 'T2', digestSummary: 'x' },
    });
    mockThreadsList
      .mockResolvedValueOnce({
        data: { threads: [{ id: 'decided-p1', snippet: 'x' }], nextPageToken: 'page2' },
      })
      .mockResolvedValueOnce({
        data: { threads: [{ id: 'fresh-p2', snippet: 'y' }], nextPageToken: null },
      });
    mockThreadsGet.mockResolvedValueOnce(makeThreadGetResponse('Fresh', 'sender@example.com'));

    const res = await agent.get('/api/gmail/threads?undecided=true');
    expect(res.status).toBe(200);
    expect(mockThreadsList).toHaveBeenCalledTimes(2);
    const ids = (res.body.threads as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toContain('fresh-p2');
    expect(ids).not.toContain('decided-p1');
  });

  it('falls back to default values when one thread metadata fetch fails inside the batch', async () => {
    mockThreadsList.mockResolvedValueOnce({
      data: {
        threads: [
          { id: 'th-ok', snippet: 'ok' },
          { id: 'th-fail', snippet: 'fail' },
        ],
        nextPageToken: null,
      },
    });
    mockThreadsGet
      .mockResolvedValueOnce(makeThreadGetResponse('Good Subject', 'ok@example.com'))
      .mockRejectedValueOnce(new Error('individual fetch error'));

    const res = await agent.get('/api/gmail/threads');
    expect(res.status).toBe(200);
    expect(res.body.threads).toHaveLength(2);
    const failing = (res.body.threads as Array<{ id: string; subject: string }>).find(t => t.id === 'th-fail');
    expect(failing!.subject).toBe('(no subject)');
    expect(failing!.sender).toBe('');
  });
});

describe('GET /api/gmail/threads/:id', () => {
  it('serves thread from CachedMessage when cache is fresh', async () => {
    const user = await prisma.user.findUnique({ where: { email: 'test@example.com' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prismaAny = prisma as any;
    await prisma.threadCache.create({
      data: {
        id: 'cached-thread',
        userId: user!.id,
        subject: 'Cached Subject',
        sender: 'cached@example.com',
        snippet: 'cached snippet',
        date: '2024-01-01',
        labelIds: '["INBOX"]',
        toAddresses: '["me@example.com"]',
      },
    });
    await prismaAny.cachedMessage.create({
      data: {
        id: 'cached-msg-1',
        threadId: 'cached-thread',
        userId: user!.id,
        sender: 'cached@example.com',
        toRecipients: '["me@example.com"]',
        date: '2024-01-01',
        subject: 'Cached Subject',
        snippet: 'cached snippet',
        isUnread: false,
        labelIds: '["INBOX"]',
        position: 0,
      },
    });

    const res = await agent.get('/api/gmail/threads/cached-thread');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('cached-thread');
    expect(res.body.messages[0].subject).toBe('Cached Subject');
    expect(mockThreadsGet).not.toHaveBeenCalled();
  });

  it('parses a multipart/alternative email body (html + plain)', async () => {
    mockThreadsGet.mockResolvedValueOnce({
      data: {
        id: 'multipart-th',
        messages: [{
          id: 'msg-multipart',
          payload: {
            mimeType: 'multipart/alternative',
            parts: [
              { mimeType: 'text/plain', body: { data: Buffer.from('Plain text').toString('base64url') } },
              { mimeType: 'text/html', body: { data: Buffer.from('<p>HTML</p>').toString('base64url') } },
            ],
          },
          labelIds: ['INBOX'],
          snippet: 'multipart snippet',
        }],
      },
    });

    const res = await agent.get('/api/gmail/threads/multipart-th');
    expect(res.status).toBe(200);
    expect(res.body.messages[0].plaintextBody).toBe('Plain text');
    expect(res.body.messages[0].htmlBody).toBe('<p>HTML</p>');
  });

  it('fetches from Gmail when no cache exists', async () => {
    mockThreadsGet.mockResolvedValueOnce(makeThreadGetResponse('Fresh Subject', 'fresh@example.com', undefined, 'fresh-thread'));

    const res = await agent.get('/api/gmail/threads/fresh-thread');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('fresh-thread');
    expect(mockThreadsGet).toHaveBeenCalledOnce();
  });

  it('returns 500 when Gmail API throws on single-thread fetch', async () => {
    mockThreadsGet.mockRejectedValueOnce(new Error('network error'));
    const res = await agent.get('/api/gmail/threads/error-thread');
    expect(res.status).toBe(500);
  });

  it('sets toRecipients to empty array when To header is absent', async () => {
    mockThreadsGet.mockResolvedValueOnce({
      data: {
        id: 'no-to-th',
        messages: [{
          id: 'msg-1',
          payload: {
            mimeType: 'text/plain',
            headers: [
              { name: 'Subject', value: 'No To' },
              { name: 'From', value: 'sender@example.com' },
              { name: 'Date', value: '2024-01-01' },
            ],
            body: { data: Buffer.from('body').toString('base64url') },
          },
          labelIds: ['INBOX'],
          snippet: 'snippet',
        }],
      },
    });
    const res = await agent.get('/api/gmail/threads/no-to-th');
    expect(res.status).toBe(200);
    expect(res.body.messages[0].toRecipients).toEqual([]);
  });

  it('sets labelIds and isUnread to defaults when labelIds is absent on a message', async () => {
    mockThreadsGet.mockResolvedValueOnce({
      data: {
        id: 'no-labels-th',
        messages: [{
          id: 'msg-1',
          payload: {
            mimeType: 'text/plain',
            headers: [{ name: 'Subject', value: 'No Labels' }],
            body: {},
          },
          snippet: 'snippet',
        }],
      },
    });
    const res = await agent.get('/api/gmail/threads/no-labels-th');
    expect(res.status).toBe(200);
    expect(res.body.messages[0].isUnread).toBe(false);
    expect(res.body.messages[0].labelIds).toEqual([]);
  });
});

describe('POST /api/gmail/threads/:id/archive', () => {
  it('calls Gmail modify to remove INBOX label', async () => {
    mockThreadsModify.mockResolvedValueOnce({});
    const res = await agent.post('/api/gmail/threads/th-1/archive');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const call = mockThreadsModify.mock.calls[0]![0] as { requestBody: { removeLabelIds: string[] } };
    expect(call.requestBody.removeLabelIds).toContain('INBOX');
  });

  it('returns 500 when Gmail modify throws', async () => {
    mockThreadsModify.mockRejectedValueOnce(new Error('Gmail error'));
    const res = await agent.post('/api/gmail/threads/th-1/archive');
    expect(res.status).toBe(500);
  });
});

describe('POST /api/gmail/threads/:id/read', () => {
  it('calls Gmail modify to remove UNREAD label', async () => {
    mockThreadsModify.mockResolvedValueOnce({});
    const res = await agent.post('/api/gmail/threads/th-1/read');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const call = mockThreadsModify.mock.calls[0]![0] as { requestBody: { removeLabelIds: string[] } };
    expect(call.requestBody.removeLabelIds).toContain('UNREAD');
  });

  it('returns 500 when Gmail modify throws', async () => {
    mockThreadsModify.mockRejectedValueOnce(new Error('Gmail error'));
    const res = await agent.post('/api/gmail/threads/th-1/read');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/gmail/unread-count', () => {
  it('returns threadsUnread count from Gmail labels API', async () => {
    mockLabelsGet.mockResolvedValueOnce({ data: { threadsUnread: 42 } });
    const res = await agent.get('/api/gmail/unread-count');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(42);
  });

  it('returns 500 when Gmail labels API throws', async () => {
    mockLabelsGet.mockRejectedValueOnce(new Error('Gmail error'));
    const res = await agent.get('/api/gmail/unread-count');
    expect(res.status).toBe(500);
  });
});

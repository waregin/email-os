import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';

// --- Hoisted mock refs ---
const { mockThreadsGet, mockLabelsGet } = vi.hoisted(() => ({
  mockThreadsGet: vi.fn(),
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
        threads: { get: mockThreadsGet },
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
  mockThreadsGet.mockReset();
  mockLabelsGet.mockReset();
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

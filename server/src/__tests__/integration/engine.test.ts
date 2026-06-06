import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Hoisted mock refs ---
const { mockCreate, mockThreadsList, mockThreadsGet, capturedCallbacks } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockThreadsList: vi.fn(),
  mockThreadsGet: vi.fn(),
  capturedCallbacks: { tokens: null as ((t: unknown) => void) | null },
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
        threads: { list: mockThreadsList, get: mockThreadsGet },
        labels: { get: vi.fn() },
      },
    }),
  },
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: function OAuth2Client() {
    return {
      setCredentials: vi.fn(),
      on: vi.fn().mockImplementation((event: string, cb: (t: unknown) => void) => {
        if (event === 'tokens') capturedCallbacks.tokens = cb;
      }),
      refreshAccessToken: vi.fn().mockResolvedValue({
        credentials: { access_token: 'refreshed', expiry_date: new Date('2099-01-01').getTime() },
      }),
    };
  },
}));

import { runTriagePass } from '../../engine';
import { resetDb, prisma, createTestUser, createTestRule } from '../helpers/db';

function makeGmailThread(id: string, subject: string, sender: string) {
  return {
    data: {
      id,
      messages: [{
        id: `msg-${id}`,
        payload: {
          headers: [
            { name: 'Subject', value: subject },
            { name: 'From', value: sender },
            { name: 'Date', value: 'Mon, 1 Jan 2024 12:00:00 +0000' },
            { name: 'To', value: 'me@example.com' },
          ],
          mimeType: 'text/plain',
          body: { data: Buffer.from(`Body of ${subject}`).toString('base64url') },
        },
        labelIds: ['INBOX', 'UNREAD'],
        snippet: `Snippet of ${id}`,
      }],
    },
  };
}

beforeEach(async () => {
  await resetDb();
  mockCreate.mockReset();
  mockThreadsList.mockReset();
  mockThreadsGet.mockReset();
  capturedCallbacks.tokens = null;
  mockThreadsList.mockResolvedValue({ data: { threads: [], nextPageToken: null } });
  mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'AI digest summary' }] });
});

afterEach(async () => {
  await resetDb();
});

describe('runTriagePass', () => {
  it('returns zeros when user has no tokens', async () => {
    const user = await prisma.user.create({
      data: { email: 'notok@example.com', name: 'No Token User' },
    });

    const result = await runTriagePass(user.id);
    expect(result).toEqual({ fetched: 0, processed: 0, matched: 0, unmatched: 0 });
    expect(mockThreadsList).not.toHaveBeenCalled();
  });

  it('ignores inactive rules — thread is unmatched', async () => {
    const user = await createTestUser();
    await prisma.triageRule.create({
      data: {
        userId: user.id,
        trigger: JSON.stringify({ type: 'sender_domain', domain: 'acme.com' }),
        action: 'digest',
        priority: 'T3',
        digestSummaryTemplate: '{subject}',
        source: 'taught',
        isActive: false,
      },
    });
    mockThreadsList.mockResolvedValueOnce({
      data: { threads: [{ id: 'th-inactive', snippet: 'x' }], nextPageToken: null },
    });
    mockThreadsGet.mockResolvedValueOnce(makeGmailThread('th-inactive', 'Invoice', 'billing@acme.com'));

    const result = await runTriagePass(user.id);
    expect(result.matched).toBe(0);
    expect(result.unmatched).toBe(1);
  });

  it('prefers a taught rule over an ai_guess rule for the same thread', async () => {
    const user = await createTestUser();
    // ai_guess rule created first — would win under old time-only ordering
    await prisma.triageRule.create({
      data: {
        userId: user.id,
        trigger: JSON.stringify({ type: 'sender_domain', domain: 'acme.com' }),
        action: 'digest',
        priority: 'T3',
        digestSummaryTemplate: 'AI guess',
        source: 'ai_guess',
        isActive: true,
      },
    });
    await createTestRule(user.id, { trigger: { type: 'sender_domain', domain: 'acme.com' }, priority: 'T3' });

    mockThreadsList.mockResolvedValueOnce({
      data: { threads: [{ id: 'th-rank', snippet: 'x' }], nextPageToken: null },
    });
    mockThreadsGet.mockResolvedValueOnce(makeGmailThread('th-rank', 'Invoice', 'billing@acme.com'));

    await runTriagePass(user.id);

    const decision = await prisma.triageDecision.findFirst({ where: { threadId: 'th-rank', userId: user.id } });
    expect(decision).not.toBeNull();
    const rule = await prisma.triageRule.findUnique({ where: { id: decision!.ruleId! } });
    expect(rule!.source).toBe('taught');
  });

  it('matches a T1 rule before a T2 rule for the same thread', async () => {
    const user = await createTestUser();
    await createTestRule(user.id, { trigger: { type: 'sender_domain', domain: 'acme.com' }, priority: 'T2' });
    await createTestRule(user.id, { trigger: { type: 'sender_domain', domain: 'acme.com' }, priority: 'T1' });

    mockThreadsList.mockResolvedValueOnce({
      data: { threads: [{ id: 'th-tier', snippet: 'x' }], nextPageToken: null },
    });
    mockThreadsGet.mockResolvedValueOnce(makeGmailThread('th-tier', 'Urgent', 'billing@acme.com'));

    await runTriagePass(user.id);

    const decision = await prisma.triageDecision.findFirst({ where: { threadId: 'th-tier', userId: user.id } });
    expect(decision!.priority).toBe('T1');
  });

  it('returns correct stats when no rules exist', async () => {
    const user = await createTestUser();
    mockThreadsList.mockResolvedValueOnce({
      data: { threads: [{ id: 'th-1', snippet: 'x' }, { id: 'th-2', snippet: 'x' }], nextPageToken: null },
    });
    mockThreadsGet
      .mockResolvedValueOnce(makeGmailThread('th-1', 'Subject', 'sender@unknown.com'))
      .mockResolvedValueOnce(makeGmailThread('th-2', 'Subject2', 'other@unknown.com'));

    const result = await runTriagePass(user.id);
    expect(result.fetched).toBe(2);
    expect(result.matched).toBe(0);
    expect(result.unmatched).toBe(2);
  });

  it('skips threads with an active non-archived decision', async () => {
    const user = await createTestUser();
    await prisma.triageDecision.create({
      data: { threadId: 'decided-th', userId: user.id, priority: 'T2', digestSummary: 'x' },
    });

    mockThreadsList.mockResolvedValueOnce({
      data: { threads: [{ id: 'decided-th', snippet: 'x' }], nextPageToken: null },
    });

    const result = await runTriagePass(user.id);
    expect(result.fetched).toBe(1);
    expect(result.processed).toBe(0);
    expect(mockThreadsGet).not.toHaveBeenCalled();
  });

  it('re-triages a thread whose previous decision was archived', async () => {
    const user = await createTestUser();
    await createTestRule(user.id, { trigger: { type: 'sender_domain', domain: 'acme.com' }, priority: 'T2' });
    await prisma.triageDecision.create({
      data: { threadId: 'returned-th', userId: user.id, priority: 'T2', digestSummary: 'old', archivedAt: new Date() },
    });

    mockThreadsList.mockResolvedValueOnce({
      data: { threads: [{ id: 'returned-th', snippet: 'x' }], nextPageToken: null },
    });
    mockThreadsGet.mockResolvedValueOnce(makeGmailThread('returned-th', 'Back in inbox', 'billing@acme.com'));

    const result = await runTriagePass(user.id);
    expect(result.processed).toBe(1);
    expect(result.matched).toBe(1);

    const decisions = await prisma.triageDecision.findMany({
      where: { threadId: 'returned-th', userId: user.id },
    });
    expect(decisions).toHaveLength(2);
    expect(decisions.filter((d) => d.archivedAt === null)).toHaveLength(1);
  });

  it('uses cached thread metadata when cache is fresh (no Gmail API call)', async () => {
    const user = await createTestUser();
    await createTestRule(user.id, { trigger: { type: 'sender_domain', domain: 'acme.com' }, priority: 'T3' });
    await prisma.threadCache.create({
      data: {
        id: 'cached-th',
        userId: user.id,
        subject: 'Cached Email',
        sender: 'billing@acme.com',
        snippet: 'cached snippet',
        date: '2024-01-01',
        labelIds: '["INBOX"]',
        toAddresses: '["me@example.com"]',
      },
    });

    mockThreadsList.mockResolvedValueOnce({
      data: { threads: [{ id: 'cached-th', snippet: 'cached snippet' }], nextPageToken: null },
    });

    await runTriagePass(user.id);

    expect(mockThreadsGet).not.toHaveBeenCalled();
    const decision = await prisma.triageDecision.findFirst({ where: { threadId: 'cached-th', userId: user.id } });
    expect(decision).not.toBeNull();
    expect(decision!.priority).toBe('T3');
  });

  it('fetches from Gmail and caches when no cache exists', async () => {
    const user = await createTestUser();
    await createTestRule(user.id, { trigger: { type: 'sender_domain', domain: 'acme.com' }, priority: 'T2' });

    mockThreadsList.mockResolvedValueOnce({
      data: { threads: [{ id: 'new-th', snippet: 'new snippet' }], nextPageToken: null },
    });
    mockThreadsGet.mockResolvedValueOnce(makeGmailThread('new-th', 'New Email', 'billing@acme.com'));

    await runTriagePass(user.id);

    expect(mockThreadsGet).toHaveBeenCalledOnce();
    const cached = await prisma.threadCache.findUnique({ where: { id: 'new-th' } });
    expect(cached).not.toBeNull();
    expect(cached!.subject).toBe('New Email');
  });

  it('creates TriageDecision with correct priority when rule matches', async () => {
    const user = await createTestUser();
    await createTestRule(user.id, { trigger: { type: 'sender_domain', domain: 'acme.com' }, priority: 'T1' });

    mockThreadsList.mockResolvedValueOnce({
      data: { threads: [{ id: 'match-th', snippet: 'x' }], nextPageToken: null },
    });
    mockThreadsGet.mockResolvedValueOnce(makeGmailThread('match-th', 'Matched', 'billing@acme.com'));

    const result = await runTriagePass(user.id);
    expect(result.matched).toBe(1);

    const decision = await prisma.triageDecision.findFirst({ where: { threadId: 'match-th', userId: user.id } });
    expect(decision!.priority).toBe('T1');
  });

  it('generates digest summary via buildDigestSummary for each matched thread', async () => {
    const user = await createTestUser();
    await createTestRule(user.id, {
      trigger: { type: 'sender_domain', domain: 'acme.com' },
      priority: 'T3',
      digestSummaryTemplate: 'From: {sender}',
    });

    mockThreadsList.mockResolvedValueOnce({
      data: { threads: [{ id: 'digest-th', snippet: 'x' }], nextPageToken: null },
    });
    mockThreadsGet.mockResolvedValueOnce(makeGmailThread('digest-th', 'Digest Test', 'billing@acme.com'));
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'From: billing@acme.com' }] });

    await runTriagePass(user.id);

    const decision = await prisma.triageDecision.findFirst({ where: { threadId: 'digest-th', userId: user.id } });
    expect(decision!.digestSummary).toBe('From: billing@acme.com');
  });

  it('handles paginated inbox by fetching all pages', async () => {
    const user = await createTestUser();

    mockThreadsList
      .mockResolvedValueOnce({
        data: { threads: [{ id: 'th-page1', snippet: 'x' }], nextPageToken: 'next-token' },
      })
      .mockResolvedValueOnce({
        data: { threads: [{ id: 'th-page2', snippet: 'x' }], nextPageToken: null },
      });
    mockThreadsGet
      .mockResolvedValueOnce(makeGmailThread('th-page1', 'Page1', 'sender@unknown.com'))
      .mockResolvedValueOnce(makeGmailThread('th-page2', 'Page2', 'sender@unknown.com'));

    const result = await runTriagePass(user.id);
    expect(result.fetched).toBe(2);
    expect(mockThreadsList).toHaveBeenCalledTimes(2);
  });

  it('returns correct final stats across matched and unmatched threads', async () => {
    const user = await createTestUser();
    await createTestRule(user.id, { trigger: { type: 'sender_domain', domain: 'acme.com' }, priority: 'T3' });

    mockThreadsList.mockResolvedValueOnce({
      data: {
        threads: [
          { id: 'th-match', snippet: 'match' },
          { id: 'th-no-match', snippet: 'no-match' },
        ],
        nextPageToken: null,
      },
    });
    mockThreadsGet
      .mockResolvedValueOnce(makeGmailThread('th-match', 'Matched', 'billing@acme.com'))
      .mockResolvedValueOnce(makeGmailThread('th-no-match', 'No Match', 'someone@other.com'));

    const result = await runTriagePass(user.id);
    expect(result.fetched).toBe(2);
    expect(result.processed).toBe(2);
    expect(result.matched).toBe(1);
    expect(result.unmatched).toBe(1);
  });

  it('handles null threads array in Gmail list response', async () => {
    const user = await createTestUser();
    mockThreadsList.mockResolvedValueOnce({ data: { threads: null, nextPageToken: null } });
    const result = await runTriagePass(user.id);
    expect(result.fetched).toBe(0);
    expect(result.processed).toBe(0);
  });

  it('skips inbox entries with a null id', async () => {
    const user = await createTestUser();
    mockThreadsList.mockResolvedValueOnce({
      data: { threads: [{ id: null, snippet: 'x' }, { id: 'valid-th', snippet: 'x' }], nextPageToken: null },
    });
    mockThreadsGet.mockResolvedValueOnce(makeGmailThread('valid-th', 'Subject', 'sender@unknown.com'));
    const result = await runTriagePass(user.id);
    expect(result.fetched).toBe(2);
    expect(result.processed).toBe(1);
  });

  it('uses detail.data.snippet when raw snippet is empty', async () => {
    const user = await createTestUser();
    mockThreadsList.mockResolvedValueOnce({
      data: { threads: [{ id: 'th-1', snippet: '' }], nextPageToken: null },
    });
    mockThreadsGet.mockResolvedValueOnce({
      data: {
        id: 'th-1',
        snippet: 'detail-level snippet',
        messages: [{
          id: 'msg-th-1',
          payload: {
            headers: [
              { name: 'Subject', value: 'Subject' },
              { name: 'From', value: 'sender@unknown.com' },
              { name: 'Date', value: '2024-01-01' },
              { name: 'To', value: 'me@example.com' },
            ],
            mimeType: 'text/plain',
            body: { data: Buffer.from('body').toString('base64url') },
          },
          labelIds: ['INBOX'],
          snippet: '',
        }],
      },
    });
    await runTriagePass(user.id);
    const cache = await prisma.threadCache.findUnique({ where: { id: 'th-1' } });
    expect(cache!.snippet).toBe('detail-level snippet');
  });

  it('handles thread response with an empty messages array', async () => {
    const user = await createTestUser();
    mockThreadsList.mockResolvedValueOnce({
      data: { threads: [{ id: 'empty-msg-th', snippet: 'x' }], nextPageToken: null },
    });
    mockThreadsGet.mockResolvedValueOnce({ data: { id: 'empty-msg-th', messages: [] } });
    const result = await runTriagePass(user.id);
    expect(result.processed).toBe(1);
    const cache = await prisma.threadCache.findUnique({ where: { id: 'empty-msg-th' } });
    expect(cache!.subject).toBe('(no subject)');
    expect(cache!.labelIds).toBe('[]');
  });

  it('resolves toAddresses to empty array when ThreadCache.toAddresses is an empty string', async () => {
    const user = await createTestUser();
    await createTestRule(user.id, { trigger: { type: 'sender_domain', domain: 'acme.com' }, priority: 'T3' });
    await prisma.threadCache.create({
      data: {
        id: 'no-to-th',
        userId: user.id,
        subject: 'Cached',
        sender: 'billing@acme.com',
        snippet: 'snippet',
        date: '2024-01-01',
        labelIds: '["INBOX"]',
        toAddresses: '',
      },
    });
    mockThreadsList.mockResolvedValueOnce({
      data: { threads: [{ id: 'no-to-th', snippet: 'snippet' }], nextPageToken: null },
    });
    const result = await runTriagePass(user.id);
    expect(result.processed).toBe(1);
    expect(mockThreadsGet).not.toHaveBeenCalled();
  });

  it('persists refreshed OAuth tokens to DB when the tokens event fires', async () => {
    const user = await createTestUser();
    mockThreadsList.mockResolvedValueOnce({ data: { threads: [], nextPageToken: null } });

    await runTriagePass(user.id);

    expect(capturedCallbacks.tokens).toBeDefined();
    await capturedCallbacks.tokens!({ access_token: 'oauth-refreshed', expiry_date: Date.now() + 7200000 });

    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updated!.accessToken).toBe('oauth-refreshed');
  });
});

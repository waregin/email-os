import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { gmail_v1 } from 'googleapis';

const mockDeleteMany = vi.fn().mockReturnValue({});
const mockCreateMany = vi.fn().mockReturnValue({});
const mockTransaction = vi.fn().mockResolvedValue([]);

vi.mock('../../db', () => ({
  prisma: {
    cachedMessage: { deleteMany: mockDeleteMany, createMany: mockCreateMany },
    $transaction: mockTransaction,
  },
}));

import { upsertCachedMessages } from '../../utils/thread-cache';

function msg(overrides: Partial<gmail_v1.Schema$Message> = {}): gmail_v1.Schema$Message {
  return {
    id: 'msg-1',
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: 'sender@example.com' },
        { name: 'To', value: 'me@example.com' },
        { name: 'Subject', value: 'Test Subject' },
        { name: 'Date', value: '2024-01-01' },
      ],
      body: { data: Buffer.from('body').toString('base64url') },
    },
    labelIds: ['INBOX'],
    snippet: 'test snippet',
    ...overrides,
  };
}

function getCreateData(): Array<Record<string, unknown>> {
  return (mockCreateMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>> }).data;
}

beforeEach(() => {
  mockDeleteMany.mockReset().mockReturnValue({});
  mockCreateMany.mockReset().mockReturnValue({});
  mockTransaction.mockReset().mockResolvedValue([]);
});

describe('upsertCachedMessages', () => {
  it('returns without touching the DB when messages array is empty', async () => {
    await upsertCachedMessages('th-1', 'user-1', []);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns without touching the DB when no messages have an id', async () => {
    await upsertCachedMessages('th-1', 'user-1', [{ snippet: 'x' }]);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('falls back to "(no subject)" when Subject header is absent', async () => {
    await upsertCachedMessages('th-1', 'user-1', [
      msg({ payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'a@b.com' }], body: {} } }),
    ]);
    expect(getCreateData()[0].subject).toBe('(no subject)');
  });

  it('uses empty toRecipients when To header is absent', async () => {
    await upsertCachedMessages('th-1', 'user-1', [
      msg({ payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: 'Hi' }], body: {} } }),
    ]);
    expect(getCreateData()[0].toRecipients).toBe('[]');
  });

  it('uses empty string for snippet when msg.snippet is absent', async () => {
    await upsertCachedMessages('th-1', 'user-1', [msg({ snippet: undefined })]);
    expect(getCreateData()[0].snippet).toBe('');
  });

  it('uses null html and plaintext body when msg.payload is absent', async () => {
    await upsertCachedMessages('th-1', 'user-1', [msg({ payload: undefined })]);
    const d = getCreateData()[0];
    expect(d.htmlBody).toBeNull();
    expect(d.plaintextBody).toBeNull();
  });

  it('uses empty headers when msg.payload is absent — sender and date fall back to empty string', async () => {
    await upsertCachedMessages('th-1', 'user-1', [msg({ payload: undefined })]);
    const d = getCreateData()[0];
    expect(d.sender).toBe('');
    expect(d.date).toBe('');
  });

  it('marks message as unread when UNREAD label is present', async () => {
    await upsertCachedMessages('th-1', 'user-1', [msg({ labelIds: ['INBOX', 'UNREAD'] })]);
    expect(getCreateData()[0].isUnread).toBe(true);
  });

  it('marks message as read when UNREAD label is absent', async () => {
    await upsertCachedMessages('th-1', 'user-1', [msg({ labelIds: ['INBOX'] })]);
    expect(getCreateData()[0].isUnread).toBe(false);
  });

  it('assigns sequential positions when multiple messages are provided', async () => {
    await upsertCachedMessages('th-1', 'user-1', [
      msg({ id: 'msg-a' }),
      msg({ id: 'msg-b' }),
    ]);
    const data = getCreateData();
    expect(data[0].position).toBe(0);
    expect(data[1].position).toBe(1);
  });
});

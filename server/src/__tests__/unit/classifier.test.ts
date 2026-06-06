import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: function Anthropic() {
    return { messages: { create: mockCreate } };
  },
}));

import Anthropic from '@anthropic-ai/sdk';
import { classifyThreadsWithAI } from '../../classifier';
import type { ThreadData } from '../../matcher';
import type { TriageRule } from '../../generated/prisma/client';

function makeThread(overrides: Partial<ThreadData> & { threadId: string }): ThreadData {
  return {
    subject: 'Hello',
    sender: 'Alice <alice@example.com>',
    senderAddress: 'alice@example.com',
    senderDomain: 'example.com',
    senderName: 'Alice',
    listId: null,
    snippet: 'Hello world',
    toAddresses: ['me@example.com'],
    labelIds: ['INBOX'],
    isSelfSent: false,
    ...overrides,
  };
}

function makeRule(overrides: Partial<TriageRule> & { id: string }): TriageRule {
  return {
    userId: 'u1',
    trigger: JSON.stringify({ type: 'sender_domain', domain: 'example.com' }),
    action: 'digest',
    priority: 'T3',
    categoryLabel: null,
    digestSummaryTemplate: '{subject}',
    notes: null,
    source: 'taught',
    isActive: true,
    parentId: null,
    pendingSuggestion: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const anthropic = new Anthropic({ apiKey: 'test' });

function validResponse(items: Array<object | null>): object {
  return { content: [{ type: 'text', text: JSON.stringify(items) }] };
}

beforeEach(() => {
  mockCreate.mockReset();
});

describe('classifyThreadsWithAI', () => {
  it('returns empty array for empty input without calling Anthropic', async () => {
    const result = await classifyThreadsWithAI([], [], anthropic);
    expect(result).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns all nulls when ANTHROPIC_MODEL env var is missing', async () => {
    const original = process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_MODEL;

    const result = await classifyThreadsWithAI([makeThread({ threadId: 't1' })], [], anthropic);
    expect(result).toEqual([null]);
    expect(mockCreate).not.toHaveBeenCalled();

    process.env.ANTHROPIC_MODEL = original;
  });

  it('returns a valid classification from a well-formed response', async () => {
    mockCreate.mockResolvedValueOnce(validResponse([{
      threadId: 't1',
      tier: 'T3',
      digestSummary: 'Newsletter from Alice',
      digestSummaryTemplate: 'Newsletter from {sender}',
      trigger: { type: 'sender_domain', domain: 'example.com' },
    }]));

    const result = await classifyThreadsWithAI([makeThread({ threadId: 't1' })], [], anthropic);
    expect(result).toHaveLength(1);
    expect(result[0]).not.toBeNull();
    expect(result[0]!.tier).toBe('T3');
    expect(result[0]!.threadId).toBe('t1');
    expect(result[0]!.digestSummary).toBe('Newsletter from Alice');
  });

  it('preserves null elements from the AI response', async () => {
    mockCreate.mockResolvedValueOnce(validResponse([
      { threadId: 't1', tier: 'T2', digestSummary: 'x', digestSummaryTemplate: 'y', trigger: { type: 'sender', sender: 'a@b.com' } },
      null,
    ]));

    const threads = [makeThread({ threadId: 't1' }), makeThread({ threadId: 't2' })];
    const result = await classifyThreadsWithAI(threads, [], anthropic);
    expect(result[0]).not.toBeNull();
    expect(result[1]).toBeNull();
  });

  it('returns all nulls when Anthropic throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API error'));

    const threads = [makeThread({ threadId: 't1' }), makeThread({ threadId: 't2' })];
    const result = await classifyThreadsWithAI(threads, [], anthropic);
    expect(result).toEqual([null, null]);
  });

  it('returns all nulls for malformed JSON response', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'not json at all' }] });

    const result = await classifyThreadsWithAI([makeThread({ threadId: 't1' })], [], anthropic);
    expect(result).toEqual([null]);
  });

  it('returns null for response elements with invalid tier', async () => {
    mockCreate.mockResolvedValueOnce(validResponse([{
      threadId: 't1',
      tier: 'T9',
      digestSummary: 'x',
      digestSummaryTemplate: 'y',
      trigger: { type: 'sender_domain', domain: 'x.com' },
    }]));

    const result = await classifyThreadsWithAI([makeThread({ threadId: 't1' })], [], anthropic);
    expect(result).toEqual([null]);
  });

  it('preserves categoryLabel on T4 classifications', async () => {
    mockCreate.mockResolvedValueOnce(validResponse([{
      threadId: 't1',
      tier: 'T4',
      categoryLabel: 'Newsletters',
      digestSummary: 'x',
      digestSummaryTemplate: 'y',
      trigger: { type: 'sender_domain', domain: 'news.com' },
    }]));

    const result = await classifyThreadsWithAI([makeThread({ threadId: 't1' })], [], anthropic);
    expect(result[0]!.categoryLabel).toBe('Newsletters');
  });

  it('preserves existingRuleId when AI proposes a modification', async () => {
    mockCreate.mockResolvedValueOnce(validResponse([{
      threadId: 't1',
      tier: 'T3',
      digestSummary: 'x',
      digestSummaryTemplate: 'y',
      trigger: { type: 'sender_domain', domain: 'example.com' },
      existingRuleId: 'rule-abc',
    }]));

    const result = await classifyThreadsWithAI([makeThread({ threadId: 't1' })], [], anthropic);
    expect(result[0]!.existingRuleId).toBe('rule-abc');
  });

  it('injects existing rules into the system prompt', async () => {
    mockCreate.mockResolvedValueOnce(validResponse([null]));

    const rule = makeRule({ id: 'r1', source: 'taught', priority: 'T2' });
    await classifyThreadsWithAI([makeThread({ threadId: 't1' })], [rule], anthropic);

    const call = mockCreate.mock.calls[0]![0] as { system: Array<{ text: string }> };
    expect(call.system[0]!.text).toContain('r1');
    expect(call.system[0]!.text).toContain('taught');
  });

  it('includes cache_control on the system prompt block', async () => {
    mockCreate.mockResolvedValueOnce(validResponse([null]));

    await classifyThreadsWithAI([makeThread({ threadId: 't1' })], [], anthropic);

    const call = mockCreate.mock.calls[0]![0] as { system: Array<{ cache_control?: object }> };
    expect(call.system[0]!.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('sends thread data as a JSON user message', async () => {
    mockCreate.mockResolvedValueOnce(validResponse([null]));

    const thread = makeThread({ threadId: 't1', subject: 'My Subject' });
    await classifyThreadsWithAI([thread], [], anthropic);

    const call = mockCreate.mock.calls[0]![0] as { messages: Array<{ content: string }> };
    const payload = JSON.parse(call.messages[0]!.content) as Array<{ subject: string }>;
    expect(payload[0]!.subject).toBe('My Subject');
  });
});

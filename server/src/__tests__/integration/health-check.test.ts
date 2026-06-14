import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Hoisted mock refs ---
const { mockBatchesCreate, mockBatchesRetrieve, mockBatchesResults } = vi.hoisted(() => ({
  mockBatchesCreate: vi.fn(),
  mockBatchesRetrieve: vi.fn(),
  mockBatchesResults: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: function Anthropic() {
    return {
      messages: {
        batches: {
          create: mockBatchesCreate,
          retrieve: mockBatchesRetrieve,
          results: mockBatchesResults,
        },
      },
    };
  },
}));

import { runHealthCheck } from '../../health-check';
import { resetDb, prisma, createTestUser } from '../helpers/db';

const ANTHROPIC_API_KEY = 'test-key';
const ANTHROPIC_MODEL = 'test-model';

function makeSuggestion(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    trigger: { type: 'sender_domain', domain: 'improved.com' },
    priority: 'T3',
    digestSummaryTemplate: 'Updated: {subject}',
    notes: '',
    reason: 'Trigger was too broad',
    ...overrides,
  };
}

async function makeEndedBatch(suggestions: Record<string, unknown>[]) {
  mockBatchesCreate.mockResolvedValue({ id: 'batch_1', processing_status: 'ended' });
  mockBatchesRetrieve.mockResolvedValue({ processing_status: 'ended' });
  mockBatchesResults.mockResolvedValue(
    (async function* () {
      for (let i = 0; i < suggestions.length; i++) {
        yield {
          custom_id: `rule-${i}`,
          result: {
            type: 'succeeded',
            message: {
              content: [{ type: 'text', text: JSON.stringify(suggestions[i]) }],
            },
          },
        };
      }
    })(),
  );
}

let userId: string;

beforeEach(async () => {
  await resetDb();
  mockBatchesCreate.mockReset();
  mockBatchesRetrieve.mockReset();
  mockBatchesResults.mockReset();
  process.env.ANTHROPIC_API_KEY = ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_MODEL = ANTHROPIC_MODEL;
  // Keep the batch poll loop near-instant so polling tests run on real timers
  // (fake timers would stall the pg driver's async socket I/O).
  process.env.HEALTH_CHECK_POLL_INTERVAL_MS = '1';
  delete process.env.HEALTH_CHECK_MAX_POLLS;
  const user = await createTestUser();
  userId = user.id;
});

afterEach(async () => {
  await resetDb();
});

describe('runHealthCheck', () => {
  it('does nothing when no rules exist', async () => {
    await runHealthCheck(userId);
    expect(mockBatchesCreate).not.toHaveBeenCalled();
  });

  it('does nothing when a rule has fewer than 5 decisions', async () => {
    const rule = await prisma.triageRule.create({
      data: { userId, trigger: JSON.stringify({ type: 'sender_domain', domain: 'a.com' }), action: 'digest', priority: 'T3', digestSummaryTemplate: '{subject}', source: 'taught' },
    });
    // 4 decisions, 2 rejected (50% but only 4 total)
    for (let i = 0; i < 4; i++) {
      await prisma.triageDecision.create({
        data: { userId, threadId: `t${i}`, ruleId: rule.id, priority: 'T3', digestSummary: 's', wasCorrect: i < 2 ? false : null },
      });
    }
    await runHealthCheck(userId);
    expect(mockBatchesCreate).not.toHaveBeenCalled();
  });

  it('does nothing when rejection rate is at or below 30%', async () => {
    const rule = await prisma.triageRule.create({
      data: { userId, trigger: JSON.stringify({ type: 'sender_domain', domain: 'a.com' }), action: 'digest', priority: 'T3', digestSummaryTemplate: '{subject}', source: 'taught' },
    });
    // 10 decisions, 3 rejected (30% — exactly at threshold, not over)
    for (let i = 0; i < 10; i++) {
      await prisma.triageDecision.create({
        data: { userId, threadId: `t${i}`, ruleId: rule.id, priority: 'T3', digestSummary: 's', wasCorrect: i < 3 ? false : null },
      });
    }
    await runHealthCheck(userId);
    expect(mockBatchesCreate).not.toHaveBeenCalled();
  });

  it('auto-versions an unhealthy ai_guess rule without user review', async () => {
    const rule = await prisma.triageRule.create({
      data: { userId, trigger: JSON.stringify({ type: 'sender_domain', domain: 'old.com' }), action: 'digest', priority: 'T3', digestSummaryTemplate: 'Old: {subject}', source: 'ai_guess' },
    });
    // 5 decisions, 4 rejected (80%)
    for (let i = 0; i < 5; i++) {
      await prisma.triageDecision.create({
        data: { userId, threadId: `t${i}`, ruleId: rule.id, priority: 'T3', digestSummary: 's', wasCorrect: i < 4 ? false : null },
      });
    }

    const suggestion = makeSuggestion({ digestSummaryTemplate: 'New: {subject}' });

    mockBatchesCreate.mockResolvedValue({ id: 'batch_1', processing_status: 'ended' });
    mockBatchesRetrieve.mockResolvedValue({ processing_status: 'ended' });
    mockBatchesResults.mockResolvedValue(
      (async function* () {
        yield {
          custom_id: rule.id,
          result: { type: 'succeeded', message: { content: [{ type: 'text', text: JSON.stringify(suggestion) }] } },
        };
      })(),
    );

    await runHealthCheck(userId);

    const oldRule = await prisma.triageRule.findUnique({ where: { id: rule.id } });
    expect(oldRule?.isActive).toBe(false);
    expect(oldRule?.pendingSuggestion).toBeNull();

    const newRule = await prisma.triageRule.findFirst({ where: { userId, isActive: true, parentId: rule.id } });
    expect(newRule).not.toBeNull();
    expect(newRule?.source).toBe('ai_guess');
    expect(newRule?.digestSummaryTemplate).toBe('New: {subject}');
    expect(JSON.parse(newRule!.trigger)).toMatchObject({ type: 'sender_domain', domain: 'improved.com' });
  });

  it('skips auto-version when a T4 ai_guess rule changes to non-T4 but neither suggestion nor rule provides a digestSummaryTemplate', async () => {
    const rule = await prisma.triageRule.create({
      data: {
        userId,
        trigger: JSON.stringify({ type: 'sender_domain', domain: 'newsletters.com' }),
        action: 'digest',
        priority: 'T4',
        categoryLabel: 'Newsletters',
        digestSummaryTemplate: '', // T4 rule has no meaningful template
        source: 'ai_guess',
      },
    });
    for (let i = 0; i < 5; i++) {
      await prisma.triageDecision.create({
        data: { userId, threadId: `t${i}`, ruleId: rule.id, priority: 'T4', digestSummary: 's', wasCorrect: i < 4 ? false : null },
      });
    }

    // Suggestion proposes T2 but omits digestSummaryTemplate
    const suggestion = { trigger: { type: 'sender_domain', domain: 'newsletters.com' }, priority: 'T2', reason: 'needs action' };
    mockBatchesCreate.mockResolvedValue({ id: 'batch_1', processing_status: 'ended' });
    mockBatchesRetrieve.mockResolvedValue({ processing_status: 'ended' });
    mockBatchesResults.mockResolvedValue(
      (async function* () {
        yield {
          custom_id: rule.id,
          result: { type: 'succeeded', message: { content: [{ type: 'text', text: JSON.stringify(suggestion) }] } },
        };
      })(),
    );

    await runHealthCheck(userId);

    // Rule should remain active and unchanged — auto-version was skipped
    const unchanged = await prisma.triageRule.findUnique({ where: { id: rule.id } });
    expect(unchanged!.isActive).toBe(true);
    const children = await prisma.triageRule.findMany({ where: { parentId: rule.id } });
    expect(children).toHaveLength(0);
  });

  it('clears categoryLabel in auto-versioned ai_guess rule when priority changes from T4 to non-T4', async () => {
    const rule = await prisma.triageRule.create({
      data: {
        userId,
        trigger: JSON.stringify({ type: 'sender_domain', domain: 'newsletters.com' }),
        action: 'digest',
        priority: 'T4',
        categoryLabel: 'Newsletters',
        digestSummaryTemplate: '{subject}',
        source: 'ai_guess',
      },
    });
    for (let i = 0; i < 5; i++) {
      await prisma.triageDecision.create({
        data: { userId, threadId: `t${i}`, ruleId: rule.id, priority: 'T4', digestSummary: 's', wasCorrect: i < 4 ? false : null },
      });
    }

    const suggestion = makeSuggestion({ priority: 'T2', digestSummaryTemplate: 'Newsletter: {subject}' });
    mockBatchesCreate.mockResolvedValue({ id: 'batch_1', processing_status: 'ended' });
    mockBatchesRetrieve.mockResolvedValue({ processing_status: 'ended' });
    mockBatchesResults.mockResolvedValue(
      (async function* () {
        yield {
          custom_id: rule.id,
          result: { type: 'succeeded', message: { content: [{ type: 'text', text: JSON.stringify(suggestion) }] } },
        };
      })(),
    );

    await runHealthCheck(userId);

    const newRule = await prisma.triageRule.findFirst({ where: { userId, isActive: true, parentId: rule.id } });
    expect(newRule).not.toBeNull();
    expect(newRule!.priority).toBe('T2');
    expect(newRule!.categoryLabel).toBeNull();
    expect(newRule!.digestSummaryTemplate).toBe('Newsletter: {subject}');
  });

  it('writes pendingSuggestion for an unhealthy taught rule without auto-versioning', async () => {
    const rule = await prisma.triageRule.create({
      data: { userId, trigger: JSON.stringify({ type: 'sender', sender: 'old@example.com' }), action: 'digest', priority: 'T2', digestSummaryTemplate: 'Old: {subject}', source: 'taught' },
    });
    // 6 decisions, 5 rejected (~83%)
    for (let i = 0; i < 6; i++) {
      await prisma.triageDecision.create({
        data: { userId, threadId: `t${i}`, ruleId: rule.id, priority: 'T2', digestSummary: 's', wasCorrect: i < 5 ? false : null },
      });
    }

    const suggestion = makeSuggestion({ priority: 'T2', reason: 'Sender too generic' });

    mockBatchesCreate.mockResolvedValue({ id: 'batch_2', processing_status: 'ended' });
    mockBatchesRetrieve.mockResolvedValue({ processing_status: 'ended' });
    mockBatchesResults.mockResolvedValue(
      (async function* () {
        yield {
          custom_id: rule.id,
          result: { type: 'succeeded', message: { content: [{ type: 'text', text: JSON.stringify(suggestion) }] } },
        };
      })(),
    );

    await runHealthCheck(userId);

    const updated = await prisma.triageRule.findUnique({ where: { id: rule.id } });
    expect(updated?.isActive).toBe(true);
    expect(updated?.pendingSuggestion).not.toBeNull();
    const parsed = JSON.parse(updated!.pendingSuggestion!);
    expect(parsed.reason).toBe('Sender too generic');
    expect(parsed.digestSummaryTemplate).toBe('Updated: {subject}');
  });

  it('writes pendingSuggestion for an unhealthy manual rule without auto-versioning', async () => {
    const rule = await prisma.triageRule.create({
      data: { userId, trigger: JSON.stringify({ type: 'self_sent' }), action: 'digest', priority: 'T1', digestSummaryTemplate: '{subject}', source: 'manual' },
    });
    for (let i = 0; i < 7; i++) {
      await prisma.triageDecision.create({
        data: { userId, threadId: `t${i}`, ruleId: rule.id, priority: 'T1', digestSummary: 's', wasCorrect: i < 5 ? false : null },
      });
    }

    const suggestion = makeSuggestion({ priority: 'T1', reason: 'Manual rule too broad' });

    mockBatchesCreate.mockResolvedValue({ id: 'batch_3', processing_status: 'ended' });
    mockBatchesRetrieve.mockResolvedValue({ processing_status: 'ended' });
    mockBatchesResults.mockResolvedValue(
      (async function* () {
        yield {
          custom_id: rule.id,
          result: { type: 'succeeded', message: { content: [{ type: 'text', text: JSON.stringify(suggestion) }] } },
        };
      })(),
    );

    await runHealthCheck(userId);

    const updated = await prisma.triageRule.findUnique({ where: { id: rule.id } });
    expect(updated?.isActive).toBe(true);
    expect(updated?.pendingSuggestion).not.toBeNull();
  });

  it('skips a result when the AI returns invalid JSON', async () => {
    const rule = await prisma.triageRule.create({
      data: { userId, trigger: JSON.stringify({ type: 'sender_domain', domain: 'a.com' }), action: 'digest', priority: 'T3', digestSummaryTemplate: '{subject}', source: 'taught' },
    });
    for (let i = 0; i < 5; i++) {
      await prisma.triageDecision.create({
        data: { userId, threadId: `t${i}`, ruleId: rule.id, priority: 'T3', digestSummary: 's', wasCorrect: i < 4 ? false : null },
      });
    }

    mockBatchesCreate.mockResolvedValue({ id: 'batch_4', processing_status: 'ended' });
    mockBatchesRetrieve.mockResolvedValue({ processing_status: 'ended' });
    mockBatchesResults.mockResolvedValue(
      (async function* () {
        yield {
          custom_id: rule.id,
          result: { type: 'succeeded', message: { content: [{ type: 'text', text: 'not valid json' }] } },
        };
      })(),
    );

    await runHealthCheck(userId);

    const unchanged = await prisma.triageRule.findUnique({ where: { id: rule.id } });
    expect(unchanged?.isActive).toBe(true);
    expect(unchanged?.pendingSuggestion).toBeNull();
  });

  it('skips non-succeeded batch results', async () => {
    const rule = await prisma.triageRule.create({
      data: { userId, trigger: JSON.stringify({ type: 'sender_domain', domain: 'a.com' }), action: 'digest', priority: 'T3', digestSummaryTemplate: '{subject}', source: 'taught' },
    });
    for (let i = 0; i < 5; i++) {
      await prisma.triageDecision.create({
        data: { userId, threadId: `t${i}`, ruleId: rule.id, priority: 'T3', digestSummary: 's', wasCorrect: i < 4 ? false : null },
      });
    }

    mockBatchesCreate.mockResolvedValue({ id: 'batch_5', processing_status: 'ended' });
    mockBatchesRetrieve.mockResolvedValue({ processing_status: 'ended' });
    mockBatchesResults.mockResolvedValue(
      (async function* () {
        yield { custom_id: rule.id, result: { type: 'errored', error: { message: 'API error' } } };
      })(),
    );

    await runHealthCheck(userId);

    const unchanged = await prisma.triageRule.findUnique({ where: { id: rule.id } });
    expect(unchanged?.isActive).toBe(true);
    expect(unchanged?.pendingSuggestion).toBeNull();
  });

  it('polls until batch status is ended', async () => {
    const rule = await prisma.triageRule.create({
      data: { userId, trigger: JSON.stringify({ type: 'sender_domain', domain: 'a.com' }), action: 'digest', priority: 'T3', digestSummaryTemplate: '{subject}', source: 'taught' },
    });
    for (let i = 0; i < 5; i++) {
      await prisma.triageDecision.create({
        data: { userId, threadId: `t${i}`, ruleId: rule.id, priority: 'T3', digestSummary: 's', wasCorrect: i < 4 ? false : null },
      });
    }

    const suggestion = makeSuggestion();
    mockBatchesCreate.mockResolvedValue({ id: 'batch_6', processing_status: 'in_progress' });
    // First retrieve: in_progress; second: ended
    mockBatchesRetrieve
      .mockResolvedValueOnce({ processing_status: 'in_progress' })
      .mockResolvedValueOnce({ processing_status: 'ended' });
    mockBatchesResults.mockResolvedValue(
      (async function* () {
        yield {
          custom_id: rule.id,
          result: { type: 'succeeded', message: { content: [{ type: 'text', text: JSON.stringify(suggestion) }] } },
        };
      })(),
    );

    await runHealthCheck(userId);

    expect(mockBatchesRetrieve).toHaveBeenCalledTimes(2);
    const updated = await prisma.triageRule.findUnique({ where: { id: rule.id } });
    expect(updated?.pendingSuggestion).not.toBeNull();
  });

  it('gives up and makes no changes when batch never completes within MAX_POLLS', async () => {
    const rule = await prisma.triageRule.create({
      data: { userId, trigger: JSON.stringify({ type: 'sender_domain', domain: 'a.com' }), action: 'digest', priority: 'T3', digestSummaryTemplate: '{subject}', source: 'taught' },
    });
    for (let i = 0; i < 5; i++) {
      await prisma.triageDecision.create({
        data: { userId, threadId: `t${i}`, ruleId: rule.id, priority: 'T3', digestSummary: 's', wasCorrect: i < 4 ? false : null },
      });
    }

    mockBatchesCreate.mockResolvedValue({ id: 'batch_never', processing_status: 'in_progress' });
    mockBatchesRetrieve.mockResolvedValue({ processing_status: 'in_progress' });
    process.env.HEALTH_CHECK_MAX_POLLS = '3';

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runHealthCheck(userId);

    expect(mockBatchesRetrieve).toHaveBeenCalledTimes(3);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('did not complete'));
    consoleSpy.mockRestore();
    expect(mockBatchesResults).not.toHaveBeenCalled();

    const unchanged = await prisma.triageRule.findUnique({ where: { id: rule.id } });
    expect(unchanged?.isActive).toBe(true);
    expect(unchanged?.pendingSuggestion).toBeNull();
  });

  it('does nothing when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await runHealthCheck(userId);
    expect(mockBatchesCreate).not.toHaveBeenCalled();
  });
});

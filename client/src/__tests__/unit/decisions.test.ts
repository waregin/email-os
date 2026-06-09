import { describe, it, expect } from 'vitest';
import { dedupeDecisions, sortTierItems, buildGroups } from '../../utils/decisions';
import type { DecisionsState } from '../../utils/decisions';
import type { DecisionWithThread } from '../../api';

function makeDecision(overrides: Partial<DecisionWithThread> & { decisionId: string; threadId: string }): DecisionWithThread {
  return {
    priority: 'T3',
    categoryLabel: null,
    digestSummary: 'summary',
    decidedAt: '2024-01-01T00:00:00Z',
    confirmedByUser: false,
    userFlagged: false,
    thread: {
      subject: 'Subject',
      sender: 'sender@example.com',
      date: '2024-01-01T00:00:00Z',
      snippet: 'snippet',
      unreadCount: 0,
      messageCount: 1,
    },
    ...overrides,
  };
}

function emptyState(): DecisionsState {
  return { T1: [], T2: [], T3: [], T4: [], T5: [] };
}

describe('dedupeDecisions', () => {
  it('removes duplicate threadIds within a tier, keeping the first', () => {
    const state = emptyState();
    state.T1 = [
      makeDecision({ decisionId: 'd1', threadId: 'thread-a' }),
      makeDecision({ decisionId: 'd2', threadId: 'thread-a' }), // duplicate
      makeDecision({ decisionId: 'd3', threadId: 'thread-b' }),
    ];
    const result = dedupeDecisions(state);
    expect(result.T1).toHaveLength(2);
    expect(result.T1[0]!.decisionId).toBe('d1');
    expect(result.T1[1]!.decisionId).toBe('d3');
  });

  it('dedupes each tier independently', () => {
    const state = emptyState();
    state.T1 = [makeDecision({ decisionId: 'd1', threadId: 'shared' })];
    state.T2 = [makeDecision({ decisionId: 'd2', threadId: 'shared' })]; // same threadId, different tier
    const result = dedupeDecisions(state);
    expect(result.T1).toHaveLength(1);
    expect(result.T2).toHaveLength(1);
  });

  it('preserves order of non-duplicate items', () => {
    const state = emptyState();
    state.T3 = [
      makeDecision({ decisionId: 'd1', threadId: 'a' }),
      makeDecision({ decisionId: 'd2', threadId: 'b' }),
      makeDecision({ decisionId: 'd3', threadId: 'c' }),
    ];
    const result = dedupeDecisions(state);
    expect(result.T3.map((d) => d.decisionId)).toEqual(['d1', 'd2', 'd3']);
  });

  it('handles empty tiers without error', () => {
    const result = dedupeDecisions(emptyState());
    expect(result).toEqual(emptyState());
  });

  it('sorts T1/T2/T3 by thread date ascending', () => {
    const state = emptyState();
    state.T2 = [
      makeDecision({ decisionId: 'd1', threadId: 'a', thread: { subject: '', sender: '', date: '2024-12-01T00:00:00Z', snippet: '', unreadCount: 0, messageCount: 1 } }),
      makeDecision({ decisionId: 'd2', threadId: 'b', thread: { subject: '', sender: '', date: '2024-01-01T00:00:00Z', snippet: '', unreadCount: 0, messageCount: 1 } }),
    ];
    const result = dedupeDecisions(state);
    expect(result.T2.map((d) => d.decisionId)).toEqual(['d2', 'd1']);
  });

  it('sorts T5 by thread date ascending like T1/T2/T3', () => {
    const state = emptyState();
    state.T5 = [
      makeDecision({ decisionId: 'd1', threadId: 'a', thread: { subject: '', sender: '', date: '2024-12-01T00:00:00Z', snippet: '', unreadCount: 0, messageCount: 1 } }),
      makeDecision({ decisionId: 'd2', threadId: 'b', thread: { subject: '', sender: '', date: '2024-01-01T00:00:00Z', snippet: '', unreadCount: 0, messageCount: 1 } }),
    ];
    const result = dedupeDecisions(state);
    expect(result.T5.map((d) => d.decisionId)).toEqual(['d2', 'd1']);
  });

  it('does not sort T4 (order left to buildGroups on the client)', () => {
    const state = emptyState();
    state.T4 = [
      makeDecision({ decisionId: 'd1', threadId: 'a', thread: { subject: '', sender: '', date: '2024-12-01T00:00:00Z', snippet: '', unreadCount: 0, messageCount: 1 } }),
      makeDecision({ decisionId: 'd2', threadId: 'b', thread: { subject: '', sender: '', date: '2024-01-01T00:00:00Z', snippet: '', unreadCount: 0, messageCount: 1 } }),
    ];
    const result = dedupeDecisions(state);
    expect(result.T4.map((d) => d.decisionId)).toEqual(['d1', 'd2']);
  });
});

describe('sortTierItems', () => {
  it('sorts items oldest thread date first', () => {
    const items = [
      makeDecision({ decisionId: 'd1', threadId: 'a', thread: { subject: '', sender: '', date: '2024-06-01T00:00:00Z', snippet: '', unreadCount: 0, messageCount: 1 } }),
      makeDecision({ decisionId: 'd2', threadId: 'b', thread: { subject: '', sender: '', date: '2024-01-01T00:00:00Z', snippet: '', unreadCount: 0, messageCount: 1 } }),
    ];
    const sorted = sortTierItems(items);
    expect(sorted.map((i) => i.decisionId)).toEqual(['d2', 'd1']);
  });

  it('treats items with unparseable dates as epoch 0 (sorts them first)', () => {
    const items = [
      makeDecision({ decisionId: 'd1', threadId: 'a', thread: { subject: '', sender: '', date: '2024-06-01T00:00:00Z', snippet: '', unreadCount: 0, messageCount: 1 } }),
      makeDecision({ decisionId: 'd2', threadId: 'b', thread: { subject: '', sender: '', date: '', snippet: '', unreadCount: 0, messageCount: 1 } }),
    ];
    const sorted = sortTierItems(items);
    expect(sorted[0]!.decisionId).toBe('d2'); // empty date → 0, sorts first
  });

  it('does not mutate the original array', () => {
    const items = [
      makeDecision({ decisionId: 'd1', threadId: 'a' }),
      makeDecision({ decisionId: 'd2', threadId: 'b' }),
    ];
    const original = [...items];
    sortTierItems(items);
    expect(items.map((i) => i.decisionId)).toEqual(original.map((i) => i.decisionId));
  });
});

describe('dedupeDecisions', () => {
  it('groups items by categoryLabel', () => {
    const items = [
      makeDecision({ decisionId: 'd1', threadId: 'a', categoryLabel: 'Newsletters' }),
      makeDecision({ decisionId: 'd2', threadId: 'b', categoryLabel: 'Newsletters' }),
      makeDecision({ decisionId: 'd3', threadId: 'c', categoryLabel: 'Receipts' }),
    ];
    const groups = buildGroups(items);
    const newsletters = groups.find((g) => g.label === 'Newsletters');
    expect(newsletters!.items).toHaveLength(2);
  });

  it('uses "Other" as the key when categoryLabel is null', () => {
    const items = [makeDecision({ decisionId: 'd1', threadId: 'a', categoryLabel: null })];
    const groups = buildGroups(items);
    expect(groups[0]!.label).toBe('Other');
  });

  it('sorts groups alphabetically with "Other" last', () => {
    const items = [
      makeDecision({ decisionId: 'd1', threadId: 'a', categoryLabel: null }), // Other
      makeDecision({ decisionId: 'd2', threadId: 'b', categoryLabel: 'Zebra' }),
      makeDecision({ decisionId: 'd3', threadId: 'c', categoryLabel: 'Apple' }),
    ];
    const labels = buildGroups(items).map((g) => g.label);
    expect(labels).toEqual(['Apple', 'Zebra', 'Other']);
  });

  it('places a named group before "Other" regardless of insertion order', () => {
    const items = [
      makeDecision({ decisionId: 'd1', threadId: 'a', categoryLabel: 'Newsletters' }),
      makeDecision({ decisionId: 'd2', threadId: 'b', categoryLabel: null }), // Other inserted first in map
    ];
    const labels = buildGroups(items).map((g) => g.label);
    expect(labels).toEqual(['Newsletters', 'Other']);
  });

  it('sorts items within a group by thread date ascending', () => {
    const items = [
      makeDecision({ decisionId: 'd1', threadId: 'a', categoryLabel: 'News', thread: { subject: '', sender: '', date: '2024-03-01T00:00:00Z', snippet: '', unreadCount: 0, messageCount: 1 } }),
      makeDecision({ decisionId: 'd2', threadId: 'b', categoryLabel: 'News', thread: { subject: '', sender: '', date: '2024-01-01T00:00:00Z', snippet: '', unreadCount: 0, messageCount: 1 } }),
    ];
    const news = buildGroups(items).find((g) => g.label === 'News');
    expect(news!.items.map((i) => i.decisionId)).toEqual(['d2', 'd1']);
  });

  it('returns an empty array for empty input', () => {
    expect(buildGroups([])).toEqual([]);
  });
});

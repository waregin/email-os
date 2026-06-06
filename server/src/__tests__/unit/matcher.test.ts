import { describe, it, expect } from 'vitest';
import { matchThread } from '../../matcher';
import type { TriageRule } from '../../generated/prisma/client';

function rule(id: string, priority: string, trigger: object, createdAt = new Date()): TriageRule {
  return {
    id,
    userId: 'u1',
    trigger: JSON.stringify(trigger),
    action: 'digest',
    priority,
    categoryLabel: null,
    digestSummaryTemplate: '',
    notes: null,
    source: 'manual',
    createdAt,
    updatedAt: createdAt,
  };
}

const BASE_THREAD = {
  threadId: 't1',
  subject: 'Hello World',
  sender: 'Alice <alice@chase.com>',
  senderAddress: 'alice@chase.com',
  senderDomain: 'chase.com',
  senderName: 'Alice',
  toAddresses: ['me@example.com'],
  snippet: 'Your statement is ready',
  labelIds: ['INBOX', 'UNREAD'],
  isSelfSent: false,
};

describe('matchThread — priority and ordering', () => {
  it('returns the T1 rule when T1 and T2 both match', () => {
    const rules = [
      rule('r2', 'T2', { type: 'sender_domain', domain: 'chase.com' }, new Date('2024-01-01')),
      rule('r1', 'T1', { type: 'sender_domain', domain: 'chase.com' }, new Date('2024-01-02')),
    ];
    expect(matchThread(BASE_THREAD, rules)?.id).toBe('r1');
  });

  it('breaks ties within same priority by createdAt (older first)', () => {
    const rules = [
      rule('r-newer', 'T2', { type: 'sender_domain', domain: 'chase.com' }, new Date('2024-06-01')),
      rule('r-older', 'T2', { type: 'sender_domain', domain: 'chase.com' }, new Date('2024-01-01')),
    ];
    expect(matchThread(BASE_THREAD, rules)?.id).toBe('r-older');
  });

  it('returns null when no rule matches', () => {
    const rules = [rule('r1', 'T1', { type: 'sender_domain', domain: 'google.com' })];
    expect(matchThread(BASE_THREAD, rules)).toBeNull();
  });

  it('skips rules with invalid trigger JSON and continues to next', () => {
    const bad: TriageRule = { ...rule('r-bad', 'T1', {}), trigger: 'not-json{' };
    const good = rule('r-good', 'T2', { type: 'sender_domain', domain: 'chase.com' });
    expect(matchThread(BASE_THREAD, [bad, good])?.id).toBe('r-good');
  });
});

describe('sender_domain trigger', () => {
  it('matches exact domain', () => {
    const r = rule('r1', 'T3', { type: 'sender_domain', domain: 'chase.com' });
    expect(matchThread(BASE_THREAD, [r])).not.toBeNull();
  });

  it('matches subdomain via endsWith', () => {
    const thread = { ...BASE_THREAD, senderDomain: 'mail.chase.com' };
    const r = rule('r1', 'T3', { type: 'sender_domain', domain: 'chase.com' });
    expect(matchThread(thread, [r])).not.toBeNull();
  });

  it('is case-insensitive', () => {
    const thread = { ...BASE_THREAD, senderDomain: 'CHASE.COM' };
    const r = rule('r1', 'T3', { type: 'sender_domain', domain: 'chase.com' });
    expect(matchThread(thread, [r])).not.toBeNull();
  });

  it('does not match unrelated domain', () => {
    const r = rule('r1', 'T3', { type: 'sender_domain', domain: 'google.com' });
    expect(matchThread(BASE_THREAD, [r])).toBeNull();
  });

  it('secondary subjectOrSnippetContainsAny blocks match when pattern absent', () => {
    const r = rule('r1', 'T3', {
      type: 'sender_domain',
      domain: 'chase.com',
      subjectOrSnippetContainsAny: ['invoice', 'overdue'],
    });
    expect(matchThread(BASE_THREAD, [r])).toBeNull();
  });

  it('secondary subjectOrSnippetContainsAny passes when any pattern present', () => {
    const r = rule('r1', 'T3', {
      type: 'sender_domain',
      domain: 'chase.com',
      subjectOrSnippetContainsAny: ['statement', 'invoice'],
    });
    expect(matchThread(BASE_THREAD, [r])).not.toBeNull();
  });

  it('secondary subjectOrSnippetContainsAll blocks when not all patterns present', () => {
    const r = rule('r1', 'T3', {
      type: 'sender_domain',
      domain: 'chase.com',
      subjectOrSnippetContainsAll: ['statement', 'overdue'],
    });
    expect(matchThread(BASE_THREAD, [r])).toBeNull();
  });

  it('secondary subjectOrSnippetContainsAll passes when all patterns present', () => {
    const r = rule('r1', 'T3', {
      type: 'sender_domain',
      domain: 'chase.com',
      subjectOrSnippetContainsAll: ['statement', 'ready'],
    });
    expect(matchThread(BASE_THREAD, [r])).not.toBeNull();
  });
});

describe('sender trigger', () => {
  it('matches exact sender address', () => {
    const r = rule('r1', 'T2', { type: 'sender', sender: 'alice@chase.com' });
    expect(matchThread(BASE_THREAD, [r])).not.toBeNull();
  });

  it('is case-insensitive', () => {
    const r = rule('r1', 'T2', { type: 'sender', sender: 'ALICE@CHASE.COM' });
    expect(matchThread(BASE_THREAD, [r])).not.toBeNull();
  });

  it('does not match different sender', () => {
    const r = rule('r1', 'T2', { type: 'sender', sender: 'bob@chase.com' });
    expect(matchThread(BASE_THREAD, [r])).toBeNull();
  });
});

describe('self_sent trigger', () => {
  it('matches when isSelfSent is true', () => {
    const thread = { ...BASE_THREAD, isSelfSent: true };
    const r = rule('r1', 'T4', { type: 'self_sent' });
    expect(matchThread(thread, [r])).not.toBeNull();
  });

  it('does not match when isSelfSent is false', () => {
    const r = rule('r1', 'T4', { type: 'self_sent' });
    expect(matchThread(BASE_THREAD, [r])).toBeNull();
  });
});

describe('subject_or_snippet_contains_any trigger', () => {
  it('matches when any pattern is in subject', () => {
    const r = rule('r1', 'T3', { type: 'subject_or_snippet_contains_any', patterns: ['hello', 'bye'] });
    expect(matchThread(BASE_THREAD, [r])).not.toBeNull();
  });

  it('matches when any pattern is in snippet', () => {
    const r = rule('r1', 'T3', { type: 'subject_or_snippet_contains_any', patterns: ['statement', 'invoice'] });
    expect(matchThread(BASE_THREAD, [r])).not.toBeNull();
  });

  it('does not match when no pattern is present', () => {
    const r = rule('r1', 'T3', { type: 'subject_or_snippet_contains_any', patterns: ['overdue', 'urgent'] });
    expect(matchThread(BASE_THREAD, [r])).toBeNull();
  });

  it('does not match when patterns array is empty', () => {
    const r = rule('r1', 'T3', { type: 'subject_or_snippet_contains_any', patterns: [] });
    expect(matchThread(BASE_THREAD, [r])).toBeNull();
  });

  it('is case-insensitive', () => {
    const r = rule('r1', 'T3', { type: 'subject_or_snippet_contains_any', patterns: ['HELLO'] });
    expect(matchThread(BASE_THREAD, [r])).not.toBeNull();
  });
});

describe('subject_or_snippet_contains_all trigger', () => {
  it('matches when all patterns are present across subject and snippet', () => {
    // "Hello" in subject, "statement" in snippet
    const r = rule('r1', 'T3', { type: 'subject_or_snippet_contains_all', patterns: ['hello', 'statement'] });
    expect(matchThread(BASE_THREAD, [r])).not.toBeNull();
  });

  it('does not match when only some patterns are present', () => {
    const r = rule('r1', 'T3', { type: 'subject_or_snippet_contains_all', patterns: ['hello', 'overdue'] });
    expect(matchThread(BASE_THREAD, [r])).toBeNull();
  });

  it('does not match when patterns array is empty', () => {
    const r = rule('r1', 'T3', { type: 'subject_or_snippet_contains_all', patterns: [] });
    expect(matchThread(BASE_THREAD, [r])).toBeNull();
  });
});

describe('address trigger', () => {
  it('matches when toAddress is contained in a recipient', () => {
    const r = rule('r1', 'T4', { type: 'address', toAddress: 'me@example.com' });
    expect(matchThread(BASE_THREAD, [r])).not.toBeNull();
  });

  it('matches partial address (substring)', () => {
    const r = rule('r1', 'T4', { type: 'address', toAddress: 'example.com' });
    expect(matchThread(BASE_THREAD, [r])).not.toBeNull();
  });

  it('is case-insensitive', () => {
    const r = rule('r1', 'T4', { type: 'address', toAddress: 'ME@EXAMPLE.COM' });
    expect(matchThread(BASE_THREAD, [r])).not.toBeNull();
  });

  it('does not match when toAddress is not in any recipient', () => {
    const r = rule('r1', 'T4', { type: 'address', toAddress: 'other@example.com' });
    expect(matchThread(BASE_THREAD, [r])).toBeNull();
  });

  it('does not match when toAddresses is empty', () => {
    const thread = { ...BASE_THREAD, toAddresses: [] };
    const r = rule('r1', 'T4', { type: 'address', toAddress: 'me@example.com' });
    expect(matchThread(thread, [r])).toBeNull();
  });
});

describe('sender_name_contains trigger', () => {
  it('matches when display name contains the pattern', () => {
    const r = rule('r1', 'T3', { type: 'sender_name_contains', pattern: 'Alice' });
    expect(matchThread(BASE_THREAD, [r])).not.toBeNull();
  });

  it('is case-insensitive', () => {
    const r = rule('r1', 'T3', { type: 'sender_name_contains', pattern: 'alice' });
    expect(matchThread(BASE_THREAD, [r])).not.toBeNull();
  });

  it('matches a substring of the display name', () => {
    const thread = { ...BASE_THREAD, sender: 'Alice Smith <alice@example.com>', senderName: 'Alice Smith' };
    const r = rule('r1', 'T3', { type: 'sender_name_contains', pattern: 'Smith' });
    expect(matchThread(thread, [r])).not.toBeNull();
  });

  it('does not match the email address — only the display name', () => {
    const r = rule('r1', 'T3', { type: 'sender_name_contains', pattern: 'chase.com' });
    expect(matchThread(BASE_THREAD, [r])).toBeNull();
  });

  it('does not match when there is no display name', () => {
    const thread = { ...BASE_THREAD, sender: 'alice@example.com', senderName: '' };
    const r = rule('r1', 'T3', { type: 'sender_name_contains', pattern: 'alice' });
    expect(matchThread(thread, [r])).toBeNull();
  });

  it('does not match when pattern is not in the display name', () => {
    const r = rule('r1', 'T3', { type: 'sender_name_contains', pattern: 'Bob' });
    expect(matchThread(BASE_THREAD, [r])).toBeNull();
  });
});

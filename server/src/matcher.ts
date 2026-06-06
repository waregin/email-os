import type { TriageRule as TriageRuleRecord } from './generated/prisma/client';

export interface ThreadData {
  threadId: string;
  subject: string;
  sender: string;
  senderAddress: string;
  senderDomain: string;
  senderName: string;
  toAddresses: string[];
  snippet: string;
  labelIds: string[];
  isSelfSent: boolean;
}

export const TRIGGER_TYPES = {
  SENDER_DOMAIN: 'sender_domain',
  SENDER: 'sender',
  SELF_SENT: 'self_sent',
  SENDER_NAME_CONTAINS: 'sender_name_contains',
  SUBJECT_OR_SNIPPET_CONTAINS_ANY: 'subject_or_snippet_contains_any',
  SUBJECT_OR_SNIPPET_CONTAINS_ALL: 'subject_or_snippet_contains_all',
  ADDRESS: 'address',
} as const;

interface TriggerBase {
  subjectOrSnippetContainsAny?: string[];
  subjectOrSnippetContainsAll?: string[];
}

interface SenderDomainTrigger extends TriggerBase {
  type: typeof TRIGGER_TYPES.SENDER_DOMAIN;
  domain: string;
}

interface SenderTrigger extends TriggerBase {
  type: typeof TRIGGER_TYPES.SENDER;
  sender: string;
}

interface SelfSentTrigger extends TriggerBase {
  type: typeof TRIGGER_TYPES.SELF_SENT;
}

interface SubjectOrSnippetContainsAnyTrigger {
  type: typeof TRIGGER_TYPES.SUBJECT_OR_SNIPPET_CONTAINS_ANY;
  patterns: string[];
}

interface SubjectOrSnippetContainsAllTrigger {
  type: typeof TRIGGER_TYPES.SUBJECT_OR_SNIPPET_CONTAINS_ALL;
  patterns: string[];
}

interface SenderNameContainsTrigger {
  type: typeof TRIGGER_TYPES.SENDER_NAME_CONTAINS;
  pattern: string;
}

interface AddressTrigger {
  type: typeof TRIGGER_TYPES.ADDRESS;
  toAddress: string;
}

type Trigger =
  | SenderDomainTrigger
  | SenderTrigger
  | SelfSentTrigger
  | SenderNameContainsTrigger
  | SubjectOrSnippetContainsAnyTrigger
  | SubjectOrSnippetContainsAllTrigger
  | AddressTrigger;

const RULE_PRIORITY_ORDER = ['T1', 'T2', 'T3', 'T4', 'T5'];
const SOURCE_RANK: Record<string, number> = { manual: 1, taught: 2, ai_guess: 3 };

function matchesTrigger(thread: ThreadData, trigger: Trigger): boolean {
  const subjectLower = thread.subject.toLowerCase();
  const snippetLower = thread.snippet.toLowerCase();
  const inEither = (term: string) => {
    const t = term.toLowerCase();
    return subjectLower.includes(t) || snippetLower.includes(t);
  };

  const checkSecondary = (t: TriggerBase): boolean => {
    if (t.subjectOrSnippetContainsAny && !t.subjectOrSnippetContainsAny.some(inEither)) return false;
    if (t.subjectOrSnippetContainsAll && !t.subjectOrSnippetContainsAll.every(inEither)) return false;
    return true;
  };

  switch (trigger.type) {
    case TRIGGER_TYPES.SENDER_DOMAIN: {
      const threadDomain = thread.senderDomain.toLowerCase();
      const ruleDomain = trigger.domain.toLowerCase();
      if (threadDomain !== ruleDomain && !threadDomain.endsWith(`.${ruleDomain}`)) return false;
      return checkSecondary(trigger);
    }
    case TRIGGER_TYPES.SENDER: {
      if (thread.senderAddress.toLowerCase() !== trigger.sender.toLowerCase()) return false;
      return checkSecondary(trigger);
    }
    case TRIGGER_TYPES.SELF_SENT: {
      if (!thread.isSelfSent) return false;
      return checkSecondary(trigger);
    }
    case TRIGGER_TYPES.SUBJECT_OR_SNIPPET_CONTAINS_ANY: {
      return trigger.patterns.length > 0 && trigger.patterns.some(inEither);
    }
    case TRIGGER_TYPES.SUBJECT_OR_SNIPPET_CONTAINS_ALL: {
      return trigger.patterns.length > 0 && trigger.patterns.every(inEither);
    }
    case TRIGGER_TYPES.SENDER_NAME_CONTAINS: {
      const name = thread.senderName.toLowerCase();
      return name.length > 0 && name.includes(trigger.pattern.toLowerCase());
    }
    case TRIGGER_TYPES.ADDRESS: {
      return thread.toAddresses.some((addr) => addr.toLowerCase().includes(trigger.toAddress.toLowerCase()));
    }
  }
}

export function matchThread(thread: ThreadData, rules: TriageRuleRecord[]): TriageRuleRecord | null {
  const sorted = [...rules].sort((a, b) => {
    const pa = RULE_PRIORITY_ORDER.indexOf(a.priority);
    const pb = RULE_PRIORITY_ORDER.indexOf(b.priority);
    if (pa !== pb) return pa - pb;
    const sa = SOURCE_RANK[a.source] ?? 99;
    const sb = SOURCE_RANK[b.source] ?? 99;
    if (sa !== sb) return sa - sb;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  for (const rule of sorted) {
    let trigger: Trigger;
    try {
      trigger = JSON.parse(rule.trigger) as Trigger;
    } catch {
      continue;
    }
    if (matchesTrigger(thread, trigger)) return rule;
  }

  return null;
}

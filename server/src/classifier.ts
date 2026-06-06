import Anthropic from '@anthropic-ai/sdk';
import type { TriageRule } from './generated/prisma/client';
import type { ThreadData } from './matcher';

export interface ThreadClassification {
  threadId: string;
  tier: string;
  categoryLabel?: string;
  digestSummary: string;
  digestSummaryTemplate: string;
  trigger: object;
  existingRuleId?: string;
}

const STATIC_PROMPT = `You are an email triage classifier. Given a batch of unclassified email threads and the user's existing triage rules, classify each thread into a priority tier and propose a rule to catch similar emails in future.

Priority tiers:
- T1 Immediate Attention: requires same-day awareness or action
- T2 Action Required: needs deliberate followup, not necessarily today
- T3 Summarized: a short digest summary is sufficient; user rarely opens the original
- T4 Browse: full content needed; cannot be meaningfully summarized; requires a categoryLabel for grouping

Classification rules:
- Do NOT propose a rule that duplicates the scope of an existing confirmed rule (source: manual or taught). Return null for that thread instead — it should already be matched.
- If an existing ai_guess rule covers a similar pattern, prefer modifying it: include its id as existingRuleId rather than creating a duplicate.
- Always include categoryLabel when tier is T4.
- Return null for any thread you cannot confidently classify.

Output a JSON array with exactly one element per input thread, in the same order as the input. Each element is either a classification object or null:

[
  {
    "threadId": "<id from input>",
    "tier": "T1|T2|T3|T4",
    "categoryLabel": "<label for grouping — T4 only>",
    "digestSummary": "<one sentence summary of this specific email>",
    "digestSummaryTemplate": "<reusable template using {sender}, {subject}, {snippet}, {date} placeholders>",
    "trigger": <trigger object — see supported formats>,
    "existingRuleId": "<id of existing ai_guess rule to update instead of creating new — omit if creating new>"
  },
  null
]

Supported trigger formats:
- {"type":"sender_domain","domain":"example.com"}
- {"type":"sender","sender":"user@example.com"}
- {"type":"sender_name_contains","pattern":"Name"}
- {"type":"list_id","listId":"list.example.com"}
- {"type":"subject_or_snippet_contains_any","patterns":["term1","term2"]}
- {"type":"subject_or_snippet_contains_all","patterns":["term1","term2"]}
- {"type":"address","toAddress":"list@example.com"}

Output only the JSON array — no explanation, no markdown fences.`;

function buildSystemPrompt(existingRules: TriageRule[]): string {
  if (existingRules.length === 0) return STATIC_PROMPT;

  const ruleLines = existingRules.map(
    (r) =>
      `- id:${r.id} source:${r.source} priority:${r.priority} trigger:${r.trigger}${r.categoryLabel ? ` category:${r.categoryLabel}` : ''}`,
  );
  return `${STATIC_PROMPT}\n\nExisting rules:\n${ruleLines.join('\n')}`;
}

function parseResponse(
  text: string,
  threads: ThreadData[],
): Array<ThreadClassification | null> {
  const nulls = () => threads.map(() => null as null);
  try {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) return nulls();

    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return nulls();

    return parsed.map((item) => {
      if (item === null || item === undefined) return null;
      if (typeof item !== 'object') return null;
      const c = item as Record<string, unknown>;
      if (typeof c.threadId !== 'string') return null;
      if (typeof c.tier !== 'string' || !['T1', 'T2', 'T3', 'T4'].includes(c.tier)) return null;
      if (typeof c.digestSummary !== 'string' || !c.digestSummary) return null;
      if (typeof c.digestSummaryTemplate !== 'string' || !c.digestSummaryTemplate) return null;
      if (typeof c.trigger !== 'object' || !c.trigger) return null;

      const result: ThreadClassification = {
        threadId: c.threadId,
        tier: c.tier,
        digestSummary: c.digestSummary,
        digestSummaryTemplate: c.digestSummaryTemplate,
        trigger: c.trigger as object,
      };
      if (typeof c.categoryLabel === 'string') result.categoryLabel = c.categoryLabel;
      if (typeof c.existingRuleId === 'string') result.existingRuleId = c.existingRuleId;
      return result;
    });
  } catch {
    return nulls();
  }
}

export async function classifyThreadsWithAI(
  threads: ThreadData[],
  existingRules: TriageRule[],
  anthropic: Anthropic,
): Promise<Array<ThreadClassification | null>> {
  if (threads.length === 0) return [];

  const model = process.env.ANTHROPIC_MODEL;
  if (!model) return threads.map(() => null);

  const systemPrompt = buildSystemPrompt(existingRules);
  const payload = threads.map(({ threadId, subject, sender, senderAddress, senderDomain, senderName, listId, snippet, toAddresses }) => ({
    threadId, subject, sender, senderAddress, senderDomain, senderName, listId, snippet, toAddresses,
  }));

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 2048,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    });

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    if (!textBlock) return threads.map(() => null);
    return parseResponse(textBlock.text, threads);
  } catch {
    return threads.map(() => null);
  }
}

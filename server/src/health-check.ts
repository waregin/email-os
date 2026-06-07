import Anthropic from '@anthropic-ai/sdk';
import { prisma } from './db';

const POLL_INTERVAL_MS = 10_000;
const MAX_POLLS = 60;

const HEALTH_SYSTEM_PROMPT = `You are analyzing an email triage rule that has a high user rejection rate. Suggest a more precise version that reduces false positives.

Return ONLY a JSON object with this exact shape — no markdown, no explanation outside the JSON:
{
  "trigger": <improved trigger object>,
  "priority": "<T1|T2|T3|T4>",
  "categoryLabel": "<for T4 only — omit for T1/T2/T3>",
  "digestSummaryTemplate": "<template with {subject}, {sender}, {date}, {snippet} placeholders>",
  "notes": "<exceptions or edge cases, or empty string>",
  "reason": "<one sentence: what was wrong and what changed>"
}

Trigger formats:
{"type":"sender_domain","domain":"example.com"}
{"type":"sender","sender":"user@example.com"}
{"type":"sender_name_contains","pattern":"Name"}
{"type":"list_id","listId":"mylist.example.com"}
{"type":"address","toAddress":"list@example.com"}
{"type":"subject_or_snippet_contains_any","patterns":["term1","term2"]}
{"type":"subject_or_snippet_contains_all","patterns":["term1","term2"]}
{"type":"self_sent"}

sender_domain/sender/self_sent may also include:
"subjectOrSnippetContainsAny": ["term1"]
"subjectOrSnippetContainsAll": ["term1"]`;

export async function runHealthCheck(userId: string): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL;
  if (!apiKey || !model) return;

  const rules = await prisma.triageRule.findMany({
    where: { userId, isActive: true },
    include: {
      decisions: {
        where: { archivedAt: null },
        select: { wasCorrect: true },
      },
    },
  });

  const unhealthyRules = rules.filter((rule) => {
    const total = rule.decisions.length;
    if (total < 5) return false;
    const rejections = rule.decisions.filter((d) => d.wasCorrect === false).length;
    return rejections / total > 0.3;
  });

  if (unhealthyRules.length === 0) return;

  const anthropic = new Anthropic({ apiKey });

  const batchRequests = unhealthyRules.map((rule) => {
    const total = rule.decisions.length;
    const rejections = rule.decisions.filter((d) => d.wasCorrect === false).length;
    const rejectionPct = Math.round((rejections / total) * 100);

    const lines = [
      `Rejection rate: ${rejections}/${total} decisions rejected (${rejectionPct}%)`,
      `Current trigger: ${rule.trigger}`,
      `Current priority: ${rule.priority}`,
      `Current template: "${rule.digestSummaryTemplate}"`,
    ];
    if (rule.categoryLabel) lines.push(`Category label: ${rule.categoryLabel}`);
    if (rule.notes) lines.push(`Notes: ${rule.notes}`);

    return {
      custom_id: rule.id,
      params: {
        model,
        max_tokens: 512,
        system: HEALTH_SYSTEM_PROMPT,
        messages: [{ role: 'user' as const, content: lines.join('\n') }],
      },
    };
  });

  const batch = await anthropic.messages.batches.create({ requests: batchRequests });

  let polls = 0;
  let batchStatus = batch.processing_status;
  while (batchStatus !== 'ended' && polls < MAX_POLLS) {
    const updated = await anthropic.messages.batches.retrieve(batch.id);
    batchStatus = updated.processing_status;
    polls++;
    if (batchStatus !== 'ended') {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  if (batchStatus !== 'ended') {
    console.error(`Health check batch ${batch.id} did not complete after ${MAX_POLLS} polls`);
    return;
  }

  const ruleMap = new Map(unhealthyRules.map((r) => [r.id, r]));
  const results = await anthropic.messages.batches.results(batch.id);

  for await (const item of results) {
    if (item.result.type !== 'succeeded') continue;

    const rule = ruleMap.get(item.custom_id);
    if (!rule) continue;

    const textBlock = item.result.message.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    );
    if (!textBlock) continue;

    let suggestion: unknown;
    try {
      suggestion = JSON.parse(textBlock.text.trim());
    } catch {
      console.error(`Health check: failed to parse suggestion for rule ${rule.id}`);
      continue;
    }

    if (rule.source === 'ai_guess') {
      // Auto-version: apply the suggestion immediately without user review
      await prisma.triageRule.update({ where: { id: rule.id }, data: { isActive: false } });
      await prisma.triageRule.create({
        data: {
          userId,
          source: 'ai_guess',
          isActive: true,
          parentId: rule.id,
          trigger: JSON.stringify((suggestion as Record<string, unknown>).trigger ?? JSON.parse(rule.trigger)),
          action: 'digest',
          priority: String((suggestion as Record<string, unknown>).priority ?? rule.priority),
          categoryLabel: String((suggestion as Record<string, unknown>).categoryLabel ?? '') || rule.categoryLabel,
          digestSummaryTemplate: String(
            (suggestion as Record<string, unknown>).digestSummaryTemplate ?? rule.digestSummaryTemplate,
          ),
          notes: String((suggestion as Record<string, unknown>).notes ?? rule.notes ?? '') || null,
        },
      });
    } else {
      // taught / manual: surface for user review via pendingSuggestion
      await prisma.triageRule.update({
        where: { id: rule.id },
        data: { pendingSuggestion: JSON.stringify(suggestion) },
      });
    }
  }
}

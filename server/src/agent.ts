import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';
import { prisma } from './db';
import { z } from 'zod';
import { matchThread, TRIGGER_TYPES } from './matcher';
import type { ThreadData } from './matcher';
import { buildDigestSummary } from './summarizer';
import { extractAddress, extractDomain, extractBody, upsertCachedMessages } from './engine';
import { CACHE_TTL_MS } from './constants';
import { buildGmailClient } from './utils/auth';
import { makeHeaderGetter } from './utils/gmail';

export const agentRouter = Router();

const SYSTEM_PROMPT_BASE = `You are the triage agent for Email OS, a smart email client. Your job is to learn the user's email triage rules by having a conversation about specific emails.

When the user shows you an email thread and asks you to learn from it, you should:
1. Ask clarifying questions to understand what the user wants to do with this email and why
2. Identify the pattern — what about this email (sender, subject, content, labels) should trigger this rule in future
3. Propose a specific, concrete rule in this structure: { trigger, action, priority (T1/T2/T3/T4), digestSummaryTemplate, notes }
4. Ask the user to confirm or refine the rule
5. Once confirmed, state that you will search for other threads where this rule might apply

Priority tiers:
- T1 Immediate Attention: surface at top, requires same-day awareness or action
- T2 Action Required: needs deliberate followup, not necessarily today
- T3 Summarized: short digest summary is sufficient; user rarely needs to open the original email
- T4 Browse: full content needed; email cannot be meaningfully summarized; grouped by category in the Browse panel

Rules:
- Be concise
- Ask one clarifying question at a time
- Do not propose a rule until you understand the user's intent
- Do not apply a rule until the user explicitly confirms it
- Primary concern: the user must never miss anything critically important

When you are ready to propose a rule (after confirming the user's intent), you MUST format the rule proposal exactly as follows — this format is required for the system to save the rule:

RULE_PROPOSAL:
{
  "existingRuleId": "<id of rule being modified, or omit if creating new>",
  "trigger": <trigger object — see formats below>,
  "action": "digest",
  "priority": "<T1|T2|T3|T4>",
  "digestSummaryTemplate": "<template with {field} placeholders>",
  "notes": "<any exceptions or edge cases>"
}

Trigger formats:

Match on subject or snippet (primary):
- {"type":"subject_or_snippet_contains_any","patterns":["term1","term2"]}  ← fires if subject or snippet contains ANY pattern
- {"type":"subject_or_snippet_contains_all","patterns":["term1","term2"]}  ← fires if subject or snippet contains ALL patterns

Match on sender or recipient (primary):
- {"type":"sender_domain","domain":"example.com"}
- {"type":"sender","sender":"user@example.com"}
- {"type":"self_sent"}
- {"type":"address","toAddress":"list@example.com"}

Optional secondary filter (sender_domain / sender / self_sent only):
- "subjectOrSnippetContainsAny": ["term1","term2"]  ← also require ANY of these in subject or snippet
- "subjectOrSnippetContainsAll": ["term1","term2"]  ← also require ALL of these in subject or snippet
- Both may appear on the same rule; both must pass.

Allowed fields — no others will be saved:
  subject_or_snippet_contains_any / _all  →  type, patterns
  sender_domain  →  type, domain, subjectOrSnippetContainsAny, subjectOrSnippetContainsAll
  sender         →  type, sender, subjectOrSnippetContainsAny, subjectOrSnippetContainsAll
  self_sent      →  type, subjectOrSnippetContainsAny, subjectOrSnippetContainsAll
  address        →  type, toAddress

When modifying an existing rule, always include "existingRuleId" so the system updates it instead of creating a duplicate.
After the RULE_PROPOSAL block you may continue with a brief explanation, but the JSON block must be valid and complete.`;

const STARTER_MESSAGE: Anthropic.MessageParam = { role: 'user', content: 'Hi' };

agentRouter.post('/teach', async (req, res) => {
  try {
    const { messages, threadContext, userContext = '' } = req.body as {
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      threadContext: { subject: string; sender: string; snippet: string; date: string; threadId: string };
      userContext?: string;
    };

    const model = process.env.ANTHROPIC_MODEL;
    if (!model) {
      res.status(500).json({ error: 'ANTHROPIC_MODEL env var is not set' });
      return;
    }

    const contextLines = [
      'Current email context:',
      `Subject: ${threadContext.subject}`,
      `From: ${threadContext.sender}`,
      `Date: ${threadContext.date}`,
      `Preview: ${threadContext.snippet}`,
    ];
    if (userContext) contextLines.push('', userContext);

    // Inject existing rules so the agent can reference them by id
    const userId = req.session.userId;
    if (userId) {
      const existingRules = await prisma.triageRule.findMany({
        where: { userId },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      });
      if (existingRules.length > 0) {
        contextLines.push('', 'Existing rules (reference by existingRuleId when modifying):');
        for (const r of existingRules) {
          contextLines.push(
            `- id: ${r.id} | priority: ${r.priority} | trigger: ${r.trigger} | template: "${r.digestSummaryTemplate}"${r.notes ? ` | notes: ${r.notes}` : ''}`,
          );
        }
      }
    }

    const systemPrompt = `${SYSTEM_PROMPT_BASE}\n\n${contextLines.join('\n')}`;

    const apiMessages: Anthropic.MessageParam[] = [STARTER_MESSAGE, ...messages];

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const completion = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: apiMessages,
    });

    const textBlock = completion.content.find((b: Anthropic.ContentBlock): b is Anthropic.TextBlock => b.type === 'text');
    const text = textBlock?.text ?? '';
    res.json({ response: text });
  } catch {
    res.status(500).json({ error: 'Agent request failed' });
  }
});

async function buildGmailClientForUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.accessToken) return null;

  const auth = buildGmailClient(user);
  return { gmail: google.gmail({ version: 'v1', auth }), user };
}

async function fetchAndCacheThread(
  gmail: ReturnType<typeof google.gmail>,
  threadId: string,
  userId: string,
  snippet: string,
): Promise<{ subject: string; sender: string; snippet: string; date: string; labelIds: string[]; toAddresses: string[]; htmlBody: string | null; plaintextBody: string | null }> {
  const detail = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
  const messages = detail.data.messages ?? [];
  const last = messages[messages.length - 1];
  const headers = last?.payload?.headers ?? [];
  const h = makeHeaderGetter(headers);

  const subject = h('Subject') || '(no subject)';
  const sender = h('From');
  const date = h('Date');
  const resolvedSnippet = snippet || detail.data.snippet || '';
  const labelIds = last?.labelIds ?? [];
  const toHeader = h('To');
  const toAddresses = toHeader ? toHeader.split(',').map((s) => s.trim()) : [];
  const body = last?.payload ? extractBody(last.payload) : { html: null, plain: null };

  await prisma.threadCache.upsert({
    where: { id: threadId },
    update: { userId, subject, sender, snippet: resolvedSnippet, date, labelIds: JSON.stringify(labelIds), toAddresses: JSON.stringify(toAddresses), htmlBody: body.html, plaintextBody: body.plain, cachedAt: new Date() },
    create: { id: threadId, userId, subject, sender, snippet: resolvedSnippet, date, labelIds: JSON.stringify(labelIds), toAddresses: JSON.stringify(toAddresses), htmlBody: body.html, plaintextBody: body.plain },
  });
  await upsertCachedMessages(threadId, userId, messages);

  return { subject, sender, snippet: resolvedSnippet, date, labelIds, toAddresses, htmlBody: body.html, plaintextBody: body.plain };
}

const triggerBaseSchema = z.object({
  subjectOrSnippetContainsAny: z.array(z.string()).optional(),
  subjectOrSnippetContainsAll: z.array(z.string()).optional(),
});

const triggerSchema = z.discriminatedUnion('type', [
  triggerBaseSchema.extend({ type: z.literal(TRIGGER_TYPES.SENDER_DOMAIN), domain: z.string() }),
  triggerBaseSchema.extend({ type: z.literal(TRIGGER_TYPES.SENDER), sender: z.string() }),
  triggerBaseSchema.extend({ type: z.literal(TRIGGER_TYPES.SELF_SENT) }),
  z.object({ type: z.literal(TRIGGER_TYPES.SUBJECT_OR_SNIPPET_CONTAINS_ANY), patterns: z.array(z.string()).min(1) }),
  z.object({ type: z.literal(TRIGGER_TYPES.SUBJECT_OR_SNIPPET_CONTAINS_ALL), patterns: z.array(z.string()).min(1) }),
  z.object({ type: z.literal(TRIGGER_TYPES.ADDRESS), toAddress: z.string() }),
]);

function normalizeTrigger(raw: unknown): string {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return JSON.stringify(triggerSchema.parse(parsed));
  } catch {
    return typeof raw === 'string' ? raw : JSON.stringify(raw);
  }
}

agentRouter.post('/rules', async (req, res) => {
  try {
    const userId = req.session.userId;
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const { rule } = req.body as {
      rule: {
        existingRuleId?: string;
        trigger: string;
        action: string;
        priority: string;
        digestSummaryTemplate: string;
        notes?: string;
      };
    };

    const normalizedTrigger = normalizeTrigger(rule.trigger);
    const ruleData = {
      trigger: normalizedTrigger,
      action: rule.action,
      priority: rule.priority,
      digestSummaryTemplate: rule.digestSummaryTemplate,
      notes: rule.notes ?? null,
    };

    let savedRule;
    if (rule.existingRuleId) {
      const existing = await prisma.triageRule.findUnique({ where: { id: rule.existingRuleId } });
      if (!existing || existing.userId !== userId) {
        res.status(404).json({ error: 'Rule not found' });
        return;
      }
      savedRule = await prisma.triageRule.update({ where: { id: rule.existingRuleId }, data: ruleData });
    } else {
      savedRule = await prisma.triageRule.create({ data: { userId, source: 'agent', ...ruleData } });
    }

    const gmailCtx = await buildGmailClientForUser(userId);
    if (!gmailCtx) {
      res.json({ ruleId: savedRule.id, matchingThreads: [] });
      return;
    }
    const { gmail, user } = gmailCtx;

    // Paginate all inbox threads
    const rawThreads: Array<{ id?: string | null; snippet?: string | null }> = [];
    let pageToken: string | undefined;
    do {
      const page = await gmail.users.threads.list({
        userId: 'me',
        q: 'in:inbox',
        maxResults: 100,
        ...(pageToken ? { pageToken } : {}),
      });
      rawThreads.push(...(page.data.threads ?? []));
      pageToken = page.data.nextPageToken ?? undefined;
    } while (pageToken);

    // Bulk fetch non-archived decisions to skip already-decided threads.
    // Exclude wasCorrect=false: those decisions were marked wrong and should be re-evaluated here.
    const existingDecisions = await prisma.triageDecision.findMany({
      where: { userId, archivedAt: null, wasCorrect: { not: false } },
      select: { threadId: true },
    });
    const decidedThreadIds = new Set(existingDecisions.map((d) => d.threadId));

    const matchingThreads: Array<{ threadId: string; subject: string; sender: string; date: string; snippet: string }> = [];

    for (const raw of rawThreads) {
      if (!raw.id) continue;
      if (decidedThreadIds.has(raw.id)) continue;

      const cached = await prisma.threadCache.findUnique({ where: { id: raw.id } });
      const ageMs = cached ? Date.now() - new Date(cached.cachedAt).getTime() : Infinity;
      const stale = !cached || ageMs > CACHE_TTL_MS;

      let subject: string;
      let sender: string;
      let snippet: string;
      let date: string;
      let labelIds: string[];
      let toAddresses: string[];

      if (stale) {
        const fetched = await fetchAndCacheThread(gmail, raw.id, userId, raw.snippet ?? '');
        subject = fetched.subject;
        sender = fetched.sender;
        snippet = fetched.snippet;
        date = fetched.date;
        labelIds = fetched.labelIds;
        toAddresses = fetched.toAddresses;
      } else {
        subject = cached!.subject;
        sender = cached!.sender;
        snippet = cached!.snippet;
        date = cached!.date;
        labelIds = JSON.parse(cached!.labelIds) as string[];
        toAddresses = cached!.toAddresses ? (JSON.parse(cached!.toAddresses) as string[]) : [];
      }

      const senderAddress = extractAddress(sender);
      const senderDomain = extractDomain(senderAddress);

      const threadData: ThreadData = {
        threadId: raw.id,
        subject,
        sender,
        senderAddress,
        senderDomain,
        toAddresses,
        snippet,
        labelIds,
        isSelfSent: senderAddress === user.email.toLowerCase(),
      };

      const matched = matchThread(threadData, [savedRule]);
      if (matched) {
        matchingThreads.push({ threadId: raw.id, subject, sender, date, snippet });
      }
    }

    res.json({ ruleId: savedRule.id, matchingThreads });
  } catch {
    res.status(500).json({ error: 'Failed to save rule' });
  }
});

agentRouter.post('/rules/:ruleId/apply', async (req, res) => {
  try {
    const userId = req.session.userId;
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const { ruleId } = req.params;
    const { threadIds } = req.body as { threadIds: string[] };

    const rule = await prisma.triageRule.findUnique({ where: { id: ruleId } });
    if (!rule || rule.userId !== userId) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }

    const gmailCtx = await buildGmailClientForUser(userId);
    if (!gmailCtx) { res.status(400).json({ error: 'No Gmail tokens' }); return; }
    const { gmail } = gmailCtx;

    // Bulk load cached entries and existing non-archived decisions.
    // Blocking decisions: wasCorrect is null or true — a concurrent triage pass may have run.
    // Wrong decisions: wasCorrect=false — user flagged these; close them before creating the new one.
    const [caches, blockingDecisions, wrongDecisions] = await Promise.all([
      prisma.threadCache.findMany({ where: { id: { in: threadIds } } }),
      prisma.triageDecision.findMany({ where: { threadId: { in: threadIds }, userId, archivedAt: null, wasCorrect: { not: false } }, select: { threadId: true } }),
      prisma.triageDecision.findMany({ where: { threadId: { in: threadIds }, userId, archivedAt: null, wasCorrect: false }, select: { threadId: true, id: true } }),
    ]);
    const cacheMap = new Map(caches.map((c) => [c.id, c]));
    const alreadyDecidedIds = new Set(blockingDecisions.map((d) => d.threadId));
    const wrongDecisionMap = new Map(wrongDecisions.map((d) => [d.threadId, d.id]));

    let applied = 0;

    for (const threadId of threadIds) {
      // Triage pass may have run since the checklist was shown — skip rather than duplicate
      if (alreadyDecidedIds.has(threadId)) { applied++; continue; }

      // Close the wrong decision so there is never more than one active decision per thread
      const wrongDecisionId = wrongDecisionMap.get(threadId);
      if (wrongDecisionId) {
        await prisma.triageDecision.update({ where: { id: wrongDecisionId }, data: { archivedAt: new Date() } });
      }

      const cached = cacheMap.get(threadId);

      let subject: string;
      let sender: string;
      let date: string;
      let snippet: string;
      let plaintextBody: string | null;
      let htmlBody: string | null;

      if (cached) {
        subject = cached.subject;
        sender = cached.sender;
        date = cached.date;
        snippet = cached.snippet;
        plaintextBody = cached.plaintextBody ?? null;
        htmlBody = cached.htmlBody ?? null;
      } else {
        const fetched = await fetchAndCacheThread(gmail, threadId, userId, '');
        subject = fetched.subject;
        sender = fetched.sender;
        date = fetched.date;
        snippet = fetched.snippet;
        plaintextBody = fetched.plaintextBody;
        htmlBody = fetched.htmlBody;
      }

      const digestSummary = await buildDigestSummary(rule.digestSummaryTemplate, {
        subject,
        sender,
        date,
        snippet,
        plaintextBody,
        htmlBody,
      });

      await prisma.triageDecision.create({
        data: {
          threadId,
          userId,
          ruleId: rule.id,
          priority: rule.priority,
          digestSummary,
        },
      });

      applied++;
    }

    res.json({ ok: true, applied });
  } catch {
    res.status(500).json({ error: 'Failed to apply rule' });
  }
});

import { google } from 'googleapis';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from './db';
import { matchThread } from './matcher';
import type { ThreadData } from './matcher';
import { buildDigestSummary } from './summarizer';
import { buildGmailClient } from './utils/auth';
import { extractAddress, extractDomain, extractSenderName, resolveThreadMetadata } from './utils/thread-cache';
import { classifyThreadsWithAI } from './classifier';

const AI_CHUNK_SIZE = 15;

interface UnmatchedThread {
  threadId: string;
  threadData: ThreadData;
  date: string;
  plaintextBody: string | null;
  htmlBody: string | null;
}

export async function runTriagePass(userId: string): Promise<{
  fetched: number;
  processed: number;
  matched: number;
  aiClassified: number;
  t5Fallback: number;
}> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.accessToken) {
    return { fetched: 0, processed: 0, matched: 0, aiClassified: 0, t5Fallback: 0 };
  }

  const rules = await prisma.triageRule.findMany({
    where: { userId, isActive: true },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });

  const gmail = google.gmail({ version: 'v1', auth: buildGmailClient(user) });

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

  // Archive decisions for threads no longer in inbox (moved to spam, deleted, archived by user, etc.)
  const inboxThreadIds = new Set(rawThreads.flatMap((t) => (t.id ? [t.id] : [])));
  const allActiveDecisions = await prisma.triageDecision.findMany({
    where: { userId, archivedAt: null },
    select: { id: true, threadId: true },
  });
  const staleDecisionIds = allActiveDecisions
    .filter((d) => !inboxThreadIds.has(d.threadId))
    .map((d) => d.id);
  if (staleDecisionIds.length > 0) {
    await prisma.triageDecision.updateMany({
      where: { id: { in: staleDecisionIds } },
      data: { archivedAt: new Date() },
    });
  }

  // Bulk-load active non-null-ruleId decisions to skip already-decided threads.
  // T5 decisions (ruleId: null) are intentionally excluded so those threads are re-evaluated.
  const activeDecisions = await prisma.triageDecision.findMany({
    where: { userId, archivedAt: null, ruleId: { not: null } },
    select: { threadId: true },
  });
  const decidedThreadIds = new Set(activeDecisions.map((d) => d.threadId));

  // Pre-load existing T5 decisions for all potentially processable threads so both Pass 1
  // (rule-matched) and Pass 2 (AI-classified) can archive them before creating replacements.
  const processableIds = rawThreads.flatMap((t) => (t.id && !decidedThreadIds.has(t.id) ? [t.id] : []));
  const existingT5Decisions = await prisma.triageDecision.findMany({
    where: { threadId: { in: processableIds }, userId, archivedAt: null, ruleId: null },
    select: { id: true, threadId: true },
  });
  const t5DecisionMap = new Map(existingT5Decisions.map((d) => [d.threadId, d.id]));

  let processed = 0;
  let matched = 0;
  const unmatchedThreads: UnmatchedThread[] = [];

  // Pass 1 — rule matching
  for (const raw of rawThreads) {
    if (!raw.id) continue;
    if (decidedThreadIds.has(raw.id)) continue;

    processed++;

    const { subject, sender, snippet, date, labelIds, toAddresses, listId, htmlBody, plaintextBody } =
      await resolveThreadMetadata(gmail, raw.id, userId, raw.snippet ?? '');

    const senderAddress = extractAddress(sender);
    const senderDomain = extractDomain(senderAddress);

    const threadData: ThreadData = {
      threadId: raw.id,
      subject,
      sender,
      senderAddress,
      senderDomain,
      senderName: extractSenderName(sender),
      listId,
      toAddresses,
      snippet,
      labelIds,
      isSelfSent: senderAddress === user.email.toLowerCase(),
    };

    const matchedRule = matchThread(threadData, rules);

    if (matchedRule) {
      const t5Id = t5DecisionMap.get(raw.id);
      if (t5Id) await prisma.triageDecision.update({ where: { id: t5Id }, data: { archivedAt: new Date() } });

      const digestSummary = await buildDigestSummary(matchedRule.digestSummaryTemplate, {
        subject,
        sender,
        date,
        snippet,
        plaintextBody,
        htmlBody,
      });

      await prisma.triageDecision.create({
        data: {
          threadId: raw.id,
          userId,
          ruleId: matchedRule.id,
          priority: matchedRule.priority,
          digestSummary,
        },
      });
      matched++;

      // Brief pause between matched threads to stay within Gmail API rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    } else {
      unmatchedThreads.push({ threadId: raw.id, threadData, date, plaintextBody, htmlBody });
    }
  }

  if (unmatchedThreads.length === 0) {
    return { fetched: rawThreads.length, processed, matched, aiClassified: 0, t5Fallback: 0 };
  }


  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let aiClassified = 0;
  let t5Fallback = 0;

  // Pass 2 — AI classification (chunked)
  for (let i = 0; i < unmatchedThreads.length; i += AI_CHUNK_SIZE) {
    const chunk = unmatchedThreads.slice(i, i + AI_CHUNK_SIZE);

    // Re-check against rules first — a previous chunk may have added new ai_guess rules
    const aiNeeded: UnmatchedThread[] = [];
    for (const t of chunk) {
      const m = matchThread(t.threadData, rules);
      if (m) {
        const t5Id = t5DecisionMap.get(t.threadId);
        if (t5Id) await prisma.triageDecision.update({ where: { id: t5Id }, data: { archivedAt: new Date() } });
        const digestSummary = await buildDigestSummary(m.digestSummaryTemplate, {
          subject: t.threadData.subject,
          sender: t.threadData.sender,
          date: t.date,
          snippet: t.threadData.snippet,
          plaintextBody: t.plaintextBody,
          htmlBody: t.htmlBody,
        });
        await prisma.triageDecision.create({
          data: { threadId: t.threadId, userId, ruleId: m.id, priority: m.priority, digestSummary },
        });
        aiClassified++;
      } else {
        aiNeeded.push(t);
      }
    }

    if (aiNeeded.length === 0) continue;

    const results = await classifyThreadsWithAI(aiNeeded.map((t) => t.threadData), rules, anthropic);

    for (let j = 0; j < aiNeeded.length; j++) {
      const t = aiNeeded[j]!;
      const cls = results[j];
      const t5Id = t5DecisionMap.get(t.threadId);

      if (cls) {
        let newRule: (typeof rules)[number];

        if (cls.existingRuleId) {
          const existingIdx = rules.findIndex(
            (r) => r.id === cls.existingRuleId && r.source === 'ai_guess' && r.isActive,
          );
          if (existingIdx !== -1) {
            const existing = rules[existingIdx]!;
            await prisma.triageRule.update({ where: { id: existing.id }, data: { isActive: false } });
            newRule = await prisma.triageRule.create({
              data: {
                userId,
                source: 'ai_guess',
                isActive: true,
                parentId: existing.id,
                trigger: JSON.stringify(cls.trigger),
                action: 'digest',
                priority: cls.tier,
                categoryLabel: cls.categoryLabel ?? null,
                digestSummaryTemplate: cls.digestSummaryTemplate,
              },
            });
            rules.splice(existingIdx, 1);
          } else {
            newRule = await prisma.triageRule.create({
              data: {
                userId,
                source: 'ai_guess',
                isActive: true,
                trigger: JSON.stringify(cls.trigger),
                action: 'digest',
                priority: cls.tier,
                categoryLabel: cls.categoryLabel ?? null,
                digestSummaryTemplate: cls.digestSummaryTemplate,
              },
            });
          }
        } else {
          newRule = await prisma.triageRule.create({
            data: {
              userId,
              source: 'ai_guess',
              isActive: true,
              trigger: JSON.stringify(cls.trigger),
              action: 'digest',
              priority: cls.tier,
              categoryLabel: cls.categoryLabel ?? null,
              digestSummaryTemplate: cls.digestSummaryTemplate,
            },
          });
        }

        // Make this rule available to matchThread for subsequent chunks
        rules.push(newRule);

        if (t5Id) await prisma.triageDecision.update({ where: { id: t5Id }, data: { archivedAt: new Date() } });
        await prisma.triageDecision.create({
          data: {
            threadId: t.threadId,
            userId,
            ruleId: newRule.id,
            priority: newRule.priority,
            digestSummary: cls.digestSummary,
          },
        });
        aiClassified++;
      } else {
        if (t5Id) await prisma.triageDecision.update({ where: { id: t5Id }, data: { archivedAt: new Date() } });
        await prisma.triageDecision.create({
          data: { threadId: t.threadId, userId, ruleId: null, priority: 'T5', digestSummary: 'Unclassified' },
        });
        t5Fallback++;
      }
    }
  }

  return { fetched: rawThreads.length, processed, matched, aiClassified, t5Fallback };
}

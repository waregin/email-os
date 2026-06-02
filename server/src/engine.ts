import { google } from 'googleapis';
import { prisma } from './db';
import { matchThread } from './matcher';
import type { ThreadData } from './matcher';
import { buildDigestSummary } from './summarizer';
import { buildGmailClient } from './utils/auth';
import { extractAddress, extractDomain, resolveThreadMetadata } from './utils/thread-cache';

export async function runTriagePass(userId: string): Promise<{ fetched: number; processed: number; matched: number; unmatched: number }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.accessToken) {
    return { fetched: 0, processed: 0, matched: 0, unmatched: 0 };
  }

  const rules = await prisma.triageRule.findMany({
    where: { userId },
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

  let processed = 0;
  let matched = 0;
  let unmatched = 0;

  for (const raw of rawThreads) {
    if (!raw.id) continue;

    // Skip if already decided and no new message has arrived since
    const existing = await prisma.triageDecision.findFirst({
      where: { threadId: raw.id, userId, archivedAt: null },
      orderBy: { decidedAt: 'desc' },
    });
    let newMessageArrived = false;
    if (existing) {
      if (existing.lastMessageId) {
        const threadDetail = await gmail.users.threads.get({
          userId: 'me',
          id: raw.id,
          format: 'minimal',
        });
        const messages = threadDetail.data.messages ?? [];
        const currentLastId = messages[messages.length - 1]?.id;
        if (!currentLastId || currentLastId === existing.lastMessageId) continue;
        newMessageArrived = true;
      }
      // No lastMessageId: fall through to process and backfill
    }

    processed++;

    const { subject, sender, snippet, date, labelIds, toAddresses, htmlBody, plaintextBody, lastMessageId } =
      await resolveThreadMetadata(gmail, raw.id, userId, raw.snippet ?? '');

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

    const matchedRule = matchThread(threadData, rules);

    if (matchedRule) {
      const digestSummary = await buildDigestSummary(matchedRule.digestSummaryTemplate, {
        subject,
        sender,
        date,
        snippet,
        plaintextBody,
        htmlBody,
      });

      if (existing && !existing.lastMessageId) {
        // Backfill: legacy decision — update in place with current lastMessageId
        await prisma.triageDecision.update({
          where: { id: existing.id },
          data: { ruleId: matchedRule.id, priority: matchedRule.priority, digestSummary, lastMessageId },
        });
      } else {
        if (newMessageArrived && existing) {
          // Archive the stale decision before creating the replacement
          await prisma.triageDecision.update({
            where: { id: existing.id },
            data: { archivedAt: new Date() },
          });
        }
        await prisma.triageDecision.create({
          data: {
            threadId: raw.id,
            userId,
            ruleId: matchedRule.id,
            priority: matchedRule.priority,
            digestSummary,
            lastMessageId,
          },
        });
      }
      matched++;

      // Brief pause between matched threads to stay within Gmail API rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    } else {
      if (existing && !existing.lastMessageId) {
        // Backfill: legacy decision — update lastMessageId baseline
        await prisma.triageDecision.update({
          where: { id: existing.id },
          data: { lastMessageId },
        });
      } else if (newMessageArrived && existing) {
        // No rule matched — update the lastMessageId baseline without archiving so the
        // decision stays visible in the UI and the next pass doesn't re-trigger
        await prisma.triageDecision.update({
          where: { id: existing.id },
          data: { lastMessageId },
        });
      }
      unmatched++;
    }
  }

  return { fetched: rawThreads.length, processed, matched, unmatched };
}

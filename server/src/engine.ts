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

  let processed = 0;
  let matched = 0;
  let unmatched = 0;

  for (const raw of rawThreads) {
    if (!raw.id) continue;

    const hasActiveDecision = await prisma.triageDecision.findFirst({
      where: { threadId: raw.id, userId, archivedAt: null },
      select: { id: true },
    });
    if (hasActiveDecision) continue;

    processed++;

    const { subject, sender, snippet, date, labelIds, toAddresses, htmlBody, plaintextBody } =
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
      unmatched++;
    }
  }

  return { fetched: rawThreads.length, processed, matched, unmatched };
}

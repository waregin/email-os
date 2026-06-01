import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';
import { prisma } from './db';
import { matchThread } from './matcher';
import type { ThreadData } from './matcher';
import { buildDigestSummary } from './summarizer';
import { CACHE_TTL_MS } from './constants';
import { createOAuthClient, applyCredentials } from './utils/auth';
import { makeHeaderGetter } from './utils/gmail';

export function extractAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match?.[1]?.toLowerCase() ?? from.toLowerCase().trim();
}

export function extractDomain(address: string): string {
  return address.split('@')[1] ?? '';
}

export async function upsertCachedMessages(
  threadId: string,
  userId: string,
  messages: gmail_v1.Schema$Message[],
): Promise<void> {
  const validMessages = messages.filter((m) => m.id);
  if (validMessages.length === 0) return;
  const now = new Date();
  await prisma.cachedMessage.deleteMany({ where: { threadId } });
  await prisma.cachedMessage.createMany({
    data: validMessages.map((msg, position) => {
      const headers = msg.payload?.headers ?? [];
      const h = makeHeaderGetter(headers);
      const body = msg.payload ? extractBody(msg.payload) : { html: null, plain: null };
      const msgLabelIds = msg.labelIds ?? [];
      const toHeader = h('To');
      return {
        id: msg.id!,
        threadId,
        userId,
        sender: h('From'),
        toRecipients: JSON.stringify(toHeader ? toHeader.split(',').map((s) => s.trim()) : []),
        date: h('Date'),
        subject: h('Subject') || '(no subject)',
        snippet: msg.snippet ?? '',
        htmlBody: body.html,
        plaintextBody: body.plain,
        isUnread: msgLabelIds.includes('UNREAD'),
        labelIds: JSON.stringify(msgLabelIds),
        position,
        cachedAt: now,
      };
    }),
  });
}

export function extractBody(payload: gmail_v1.Schema$MessagePart): { html: string | null; plain: string | null } {
  const mime = payload.mimeType ?? '';

  if (mime === 'text/html') {
    const data = payload.body?.data;
    return { html: data ? Buffer.from(data, 'base64url').toString('utf-8') : null, plain: null };
  }

  if (mime === 'text/plain') {
    const data = payload.body?.data;
    return { html: null, plain: data ? Buffer.from(data, 'base64url').toString('utf-8') : null };
  }

  if (mime.startsWith('multipart/')) {
    let html: string | null = null;
    let plain: string | null = null;
    for (const part of payload.parts ?? []) {
      const extracted = extractBody(part);
      if (extracted.html && !html) html = extracted.html;
      if (extracted.plain && !plain) plain = extracted.plain;
    }
    return { html, plain };
  }

  return { html: null, plain: null };
}

export async function runTriagePass(userId: string): Promise<{ fetched: number; processed: number; matched: number; unmatched: number }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.accessToken) {
    return { fetched: 0, processed: 0, matched: 0, unmatched: 0 };
  }

  const rules = await prisma.triageRule.findMany({
    where: { userId },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });

  const auth = createOAuthClient();
  applyCredentials(auth, user);

  // Persist refreshed tokens back to DB if they change
  auth.on('tokens', async (tokens) => {
    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(tokens.access_token ? { accessToken: tokens.access_token } : {}),
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        ...(tokens.expiry_date ? { tokenExpiry: new Date(tokens.expiry_date) } : {}),
      },
    });
  });

  const gmail = google.gmail({ version: 'v1', auth });

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

    // Skip if already decided
    const existing = await prisma.triageDecision.findFirst({
      where: { threadId: raw.id, userId },
    });
    if (existing) continue;

    processed++;

    // Resolve metadata from cache or Gmail
    const cached = await prisma.threadCache.findUnique({ where: { id: raw.id } });
    const ageMs = cached ? Date.now() - new Date(cached.cachedAt).getTime() : Infinity;
    const stale = !cached || ageMs > CACHE_TTL_MS;

    let subject: string;
    let sender: string;
    let snippet: string;
    let date: string;
    let labelIds: string[];
    let toAddresses: string[];
    let htmlBody: string | null;
    let plaintextBody: string | null;

    if (stale) {
      const detail = await gmail.users.threads.get({
        userId: 'me',
        id: raw.id,
        format: 'full',
      });

      const messages = detail.data.messages ?? [];
      const last = messages[messages.length - 1];
      const headers = last?.payload?.headers ?? [];
      const h = makeHeaderGetter(headers);

      subject = h('Subject') || '(no subject)';
      sender = h('From');
      date = h('Date');
      snippet = raw.snippet ?? detail.data.snippet ?? '';
      labelIds = last?.labelIds ?? [];
      const toHeader = h('To');
      toAddresses = toHeader ? toHeader.split(',').map((s) => s.trim()) : [];

      const body = last?.payload ? extractBody(last.payload) : { html: null, plain: null };
      htmlBody = body.html;
      plaintextBody = body.plain;

      await prisma.threadCache.upsert({
        where: { id: raw.id },
        update: { userId, subject, sender, snippet, date, labelIds: JSON.stringify(labelIds), toAddresses: JSON.stringify(toAddresses), htmlBody, plaintextBody, cachedAt: new Date() },
        create: { id: raw.id, userId, subject, sender, snippet, date, labelIds: JSON.stringify(labelIds), toAddresses: JSON.stringify(toAddresses), htmlBody, plaintextBody },
      });
      await upsertCachedMessages(raw.id, userId, messages);
    } else {
      subject = cached.subject;
      sender = cached.sender;
      snippet = cached.snippet;
      date = cached.date;
      labelIds = JSON.parse(cached.labelIds) as string[];
      toAddresses = cached.toAddresses ? (JSON.parse(cached.toAddresses) as string[]) : [];
      htmlBody = cached.htmlBody ?? null;
      plaintextBody = cached.plaintextBody ?? null;
    }

    const senderAddress = extractAddress(sender);
    const senderDomain = extractDomain(senderAddress);
    const userEmail = user.email.toLowerCase();

    const threadData: ThreadData = {
      threadId: raw.id,
      subject,
      sender,
      senderAddress,
      senderDomain,
      toAddresses,
      snippet,
      labelIds,
      isSelfSent: senderAddress === userEmail,
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

      await new Promise(resolve => setTimeout(resolve, 100));
    } else {
      unmatched++;
    }
  }

  return { fetched: rawThreads.length, processed, matched, unmatched };
}

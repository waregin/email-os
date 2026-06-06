import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';
import { prisma } from '../db';
import { CACHE_TTL_MS } from '../constants';
import { makeHeaderGetter } from './gmail';

export function extractAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match?.[1]?.toLowerCase() ?? from.toLowerCase().trim();
}

export function extractDomain(address: string): string {
  return address.split('@')[1] ?? '';
}

export function extractSenderName(sender: string): string {
  const match = /^(.+?)\s*<[^>]+>/.exec(sender.trim());
  return match?.[1]?.trim() ?? '';
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

export async function upsertCachedMessages(
  threadId: string,
  userId: string,
  messages: gmail_v1.Schema$Message[],
): Promise<void> {
  const validMessages = messages.filter((m) => m.id);
  if (validMessages.length === 0) return;
  const now = new Date();
  await prisma.$transaction([
    prisma.cachedMessage.deleteMany({ where: { threadId } }),
    prisma.cachedMessage.createMany({
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
    }),
  ]);
}

export async function resolveThreadMetadata(
  gmail: ReturnType<typeof google.gmail>,
  threadId: string,
  userId: string,
  snippet: string,
): Promise<{
  subject: string;
  sender: string;
  snippet: string;
  date: string;
  labelIds: string[];
  toAddresses: string[];
  htmlBody: string | null;
  plaintextBody: string | null;
}> {
  const cached = await prisma.threadCache.findUnique({ where: { id: threadId } });
  const ageMs = cached ? Date.now() - new Date(cached.cachedAt).getTime() : Infinity;

  if (!cached || ageMs > CACHE_TTL_MS) {
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

  return {
    subject: cached.subject,
    sender: cached.sender,
    snippet: cached.snippet,
    date: cached.date,
    labelIds: JSON.parse(cached.labelIds) as string[],
    toAddresses: cached.toAddresses ? (JSON.parse(cached.toAddresses) as string[]) : [],
    htmlBody: cached.htmlBody ?? null,
    plaintextBody: cached.plaintextBody ?? null,
  };
}

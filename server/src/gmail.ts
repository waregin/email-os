import { Router } from 'express';
import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';
import { getAuthenticatedClient } from './middleware';
import { prisma } from './db';
import { extractBody } from './utils/thread-cache';
import { CACHE_TTL_MS } from './constants';
import { makeHeaderGetter } from './utils/gmail';


interface MessageDetail {
  id: string;
  sender: string;
  toRecipients: string[];
  date: string;
  subject: string;
  snippet: string;
  htmlBody: string | null;
  plaintextBody: string | null;
  isUnread: boolean;
  labelIds: string[];
}

interface ThreadDetail {
  id: string;
  messages: MessageDetail[];
}

function transformMessage(msg: gmail_v1.Schema$Message): MessageDetail {
  const headers = msg.payload?.headers ?? [];
  const h = makeHeaderGetter(headers);

  const toHeader = h('To');
  const toRecipients = toHeader ? toHeader.split(',').map((s) => s.trim()) : [];

  const { html, plain } = msg.payload ? extractBody(msg.payload) : { html: null, plain: null };
  const labelIds = msg.labelIds ?? [];

  return {
    id: msg.id ?? '',
    sender: h('From'),
    toRecipients,
    date: h('Date'),
    subject: h('Subject'),
    snippet: msg.snippet ?? '',
    htmlBody: html,
    plaintextBody: plain,
    isUnread: labelIds.includes('UNREAD'),
    labelIds,
  };
}

export const gmailRouter = Router();

// List inbox threads enriched with From/Subject/Date headers
gmailRouter.get('/threads', async (req, res) => {
  try {
    const auth = getAuthenticatedClient(req);
    const gmail = google.gmail({ version: 'v1', auth });

    const maxResults = Number(req.query.maxResults ?? 50);
    const pageToken = req.query.pageToken as string | undefined;
    const q = (req.query.q as string | undefined) ?? 'in:inbox';
    const undecidedOnly = req.query.undecided === 'true';

    let decidedThreadIds = new Set<string>();
    if (undecidedOnly && req.session.userId) {
      const activeDecisions = await prisma.triageDecision.findMany({
        where: { userId: req.session.userId, archivedAt: null },
        select: { threadId: true },
      });
      decidedThreadIds = new Set(activeDecisions.map((d) => d.threadId));
    }

    // When filtering to undecided, loop through Gmail pages until we have maxResults
    // undecided threads — a single page often yields far fewer due to decided threads.
    const collected: gmail_v1.Schema$Thread[] = [];
    let currentPageToken = pageToken;
    let nextPageToken: string | undefined;

    do {
      const listResponse = await gmail.users.threads.list({
        userId: 'me',
        maxResults: 50,
        ...(currentPageToken ? { pageToken: currentPageToken } : {}),
        q,
      });
      nextPageToken = listResponse.data.nextPageToken ?? undefined;
      for (const t of listResponse.data.threads ?? []) {
        if (!decidedThreadIds.has(t.id!)) collected.push(t);
      }
      currentPageToken = nextPageToken;
    } while (undecidedOnly && collected.length < maxResults && currentPageToken);

    const threads = await Promise.all(
      collected.map(async (thread) => {
        try {
          const detail = await gmail.users.threads.get({
            userId: 'me',
            id: thread.id!,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date'],
          });

          const messages = detail.data.messages ?? [];
          const lastMsg = messages[messages.length - 1];
          const headers: gmail_v1.Schema$MessagePartHeader[] =
            lastMsg?.payload?.headers ?? [];
          const h = makeHeaderGetter(headers);

          const unreadCount = messages.filter((m) => m.labelIds?.includes('UNREAD')).length;

          return {
            id: thread.id,
            snippet: thread.snippet ?? '',
            subject: h('Subject') || '(no subject)',
            sender: h('From'),
            date: h('Date'),
            isUnread: lastMsg?.labelIds?.includes('UNREAD') ?? false,
            unreadCount,
          };
        } catch {
          return {
            id: thread.id,
            snippet: thread.snippet ?? '',
            subject: '(no subject)',
            sender: '',
            date: '',
            isUnread: false,
            unreadCount: 0,
          };
        }
      })
    );

    res.json({ threads, nextPageToken });
  } catch {
    res.status(500).json({ error: 'Failed to fetch threads' });
  }
});

// Get a single thread by ID — serves from CachedMessage if fresh, falls back to Gmail API
gmailRouter.get('/threads/:id', async (req, res) => {
  try {
    const threadId = req.params.id;
    const userId = req.session.userId;

    if (userId) {
      const cachedMessages = await prisma.cachedMessage.findMany({
        where: { threadId, userId },
        orderBy: { position: 'asc' },
      });
      const [firstCached] = cachedMessages;
      if (firstCached && Date.now() - new Date(firstCached.cachedAt).getTime() < CACHE_TTL_MS) {
        res.json({
          id: threadId,
          messages: cachedMessages.map((m: { id: string; sender: string; toRecipients: string; date: string; subject: string; snippet: string; htmlBody: string | null; plaintextBody: string | null; isUnread: boolean; labelIds: string }) => ({
            id: m.id,
            sender: m.sender,
            toRecipients: JSON.parse(m.toRecipients) as string[],
            date: m.date,
            subject: m.subject,
            snippet: m.snippet,
            htmlBody: m.htmlBody,
            plaintextBody: m.plaintextBody,
            isUnread: m.isUnread,
            labelIds: JSON.parse(m.labelIds) as string[],
          })),
        });
        return;
      }
    }

    const auth = getAuthenticatedClient(req);
    const gmail = google.gmail({ version: 'v1', auth });

    const response = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full',
    });

    const raw = response.data;
    const thread: ThreadDetail = {
      id: raw.id ?? '',
      messages: (raw.messages ?? []).map(transformMessage),
    };

    res.json(thread);
  } catch {
    res.status(500).json({ error: 'Failed to fetch thread' });
  }
});

// Archive a thread (remove INBOX label)
gmailRouter.post('/threads/:id/archive', async (req, res) => {
  try {
    const auth = getAuthenticatedClient(req);
    const gmail = google.gmail({ version: 'v1', auth });

    await gmail.users.threads.modify({
      userId: 'me',
      id: req.params.id,
      requestBody: {
        removeLabelIds: ['INBOX'],
      },
    });

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to archive thread' });
  }
});

// Mark a thread as read
gmailRouter.post('/threads/:id/read', async (req, res) => {
  try {
    const auth = getAuthenticatedClient(req);
    const gmail = google.gmail({ version: 'v1', auth });

    await gmail.users.threads.modify({
      userId: 'me',
      id: req.params.id,
      requestBody: {
        removeLabelIds: ['UNREAD'],
      },
    });

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to mark thread as read' });
  }
});

// List active triage decisions grouped by priority, with thread metadata
gmailRouter.get('/decisions', async (req, res) => {
  try {
    const userId = req.session.userId;
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const decisions = await prisma.triageDecision.findMany({
      where: { userId, archivedAt: null },
      orderBy: { decidedAt: 'desc' },
      include: { rule: true },
    });

    const threadIds = decisions.map((d) => d.threadId);
    const [caches, msgStats] = await Promise.all([
      prisma.threadCache.findMany({ where: { id: { in: threadIds } } }),
      prisma.cachedMessage.findMany({
        where: { threadId: { in: threadIds } },
        select: { threadId: true, isUnread: true },
      }) as Promise<Array<{ threadId: string; isUnread: boolean }>>,
    ]);
    const cacheMap = new Map(caches.map((c) => [c.id, c]));
    const messageCountMap = new Map<string, number>();
    const unreadCountMap = new Map<string, number>();
    for (const m of msgStats) {
      messageCountMap.set(m.threadId, (messageCountMap.get(m.threadId) ?? 0) + 1);
      if (m.isUnread) unreadCountMap.set(m.threadId, (unreadCountMap.get(m.threadId) ?? 0) + 1);
    }

    type DecisionWithThread = {
      decisionId: string;
      threadId: string;
      priority: string;
      categoryLabel: string | null;
      digestSummary: string;
      decidedAt: string;
      confirmedByUser: boolean;
      userFlagged: boolean;
      thread: { subject: string; sender: string; date: string; snippet: string; unreadCount: number; messageCount: number };
    };

    const grouped: Record<string, DecisionWithThread[]> = { T1: [], T2: [], T3: [], T4: [], T5: [] };

    for (const d of decisions) {
      const cache = cacheMap.get(d.threadId);
      const bucket = grouped[d.priority] ?? grouped['T4']!;
      bucket.push({
        decisionId: d.id,
        threadId: d.threadId,
        priority: d.priority,
        categoryLabel: d.rule?.categoryLabel ?? null,
        digestSummary: d.digestSummary,
        decidedAt: d.decidedAt.toISOString(),
        confirmedByUser: d.confirmedByUser,
        userFlagged: d.userFlagged,
        thread: {
          subject: cache?.subject ?? '',
          sender: cache?.sender ?? '',
          date: cache?.date ?? '',
          snippet: cache?.snippet ?? '',
          unreadCount: unreadCountMap.get(d.threadId) ?? 0,
          messageCount: messageCountMap.get(d.threadId) ?? 0,
        },
      });
    }

    res.json(grouped);
  } catch {
    res.status(500).json({ error: 'Failed to list decisions' });
  }
});

// T1/T2 confirm: marks read, does NOT archive
gmailRouter.post('/decisions/:id/confirm', async (req, res) => {
  try {
    const userId = req.session.userId;
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const decision = await prisma.triageDecision.findUnique({ where: { id: req.params.id } });
    if (!decision || decision.userId !== userId) {
      res.status(404).json({ error: 'Decision not found' }); return;
    }

    const isT34 = decision.priority === 'T3' || decision.priority === 'T4';

    await prisma.triageDecision.update({
      where: { id: decision.id },
      data: {
        confirmedByUser: true,
        wasCorrect: true,
        ...(isT34 ? { archivedAt: new Date() } : {}),
      },
    });

    const auth = getAuthenticatedClient(req);
    const gmail = google.gmail({ version: 'v1', auth });
    await gmail.users.threads.modify({
      userId: 'me',
      id: decision.threadId,
      requestBody: { removeLabelIds: isT34 ? ['INBOX', 'UNREAD'] : ['UNREAD'] },
    });

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to confirm decision' });
  }
});

// T1/T2 done: completes action and archives
gmailRouter.post('/decisions/:id/done', async (req, res) => {
  try {
    const userId = req.session.userId;
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const decision = await prisma.triageDecision.findUnique({ where: { id: req.params.id } });
    if (!decision || decision.userId !== userId) {
      res.status(404).json({ error: 'Decision not found' }); return;
    }

    await prisma.triageDecision.update({
      where: { id: decision.id },
      data: { wasCorrect: true, confirmedByUser: true, archivedAt: new Date() },
    });

    const auth = getAuthenticatedClient(req);
    const gmail = google.gmail({ version: 'v1', auth });
    await gmail.users.threads.modify({
      userId: 'me',
      id: decision.threadId,
      requestBody: { removeLabelIds: ['INBOX', 'UNREAD'] },
    });

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to mark decision done' });
  }
});

// T3/T4 followup: folds into T2
gmailRouter.post('/decisions/:id/followup', async (req, res) => {
  try {
    const userId = req.session.userId;
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const { note } = (req.body ?? {}) as { note?: string };

    const decision = await prisma.triageDecision.findUnique({ where: { id: req.params.id } });
    if (!decision || decision.userId !== userId) {
      res.status(404).json({ error: 'Decision not found' }); return;
    }

    // A followup note records why the user is following up; it replaces the
    // generic T3/T4 summary on the resulting T2 decision. Omit when blank.
    const trimmedNote = typeof note === 'string' ? note.trim() : '';
    await prisma.triageDecision.update({
      where: { id: decision.id },
      data: {
        wasCorrect: true,
        confirmedByUser: true,
        userFlagged: true,
        priority: 'T2',
        ...(trimmedNote ? { digestSummary: trimmedNote } : {}),
      },
    });

    const auth = getAuthenticatedClient(req);
    const gmail = google.gmail({ version: 'v1', auth });
    await gmail.users.threads.modify({
      userId: 'me',
      id: decision.threadId,
      requestBody: { removeLabelIds: ['UNREAD'] },
    });

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to followup decision' });
  }
});

// Bulk confirm for a panel snapshot
gmailRouter.post('/decisions/confirm-all', async (req, res) => {
  try {
    const userId = req.session.userId;
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const { decisionIds, tier } = req.body as { decisionIds: string[]; tier: string };
    if (!Array.isArray(decisionIds) || decisionIds.length === 0) {
      res.json({ ok: true, processed: 0 }); return;
    }

    const isT34 = tier === 'T3' || tier === 'T4';

    const decisions = await prisma.triageDecision.findMany({
      where: { id: { in: decisionIds }, userId },
      select: { id: true, threadId: true },
    });

    if (decisions.length === 0) { res.json({ ok: true, processed: 0 }); return; }

    const validIds = decisions.map((d) => d.id);
    const threadIds = decisions.map((d) => d.threadId);

    await prisma.triageDecision.updateMany({
      where: { id: { in: validIds } },
      data: {
        wasCorrect: true,
        confirmedByUser: true,
        ...(isT34 ? { archivedAt: new Date() } : {}),
      },
    });

    const auth = getAuthenticatedClient(req);
    const gmail = google.gmail({ version: 'v1', auth });
    await Promise.all(
      threadIds.map((threadId) =>
        gmail.users.threads.modify({
          userId: 'me',
          id: threadId,
          requestBody: { removeLabelIds: isT34 ? ['INBOX', 'UNREAD'] : ['UNREAD'] },
        }).catch(() => {}),
      ),
    );

    res.json({ ok: true, processed: decisions.length });
  } catch {
    res.status(500).json({ error: 'Failed to confirm-all decisions' });
  }
});

// Mark a decision as misclassified and close it (thread stays in inbox)
gmailRouter.post('/decisions/:id/misclassified', async (req, res) => {
  try {
    const userId = req.session.userId;
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const decision = await prisma.triageDecision.findUnique({ where: { id: req.params.id } });
    if (!decision || decision.userId !== userId) {
      res.status(404).json({ error: 'Decision not found' }); return;
    }

    await prisma.triageDecision.update({
      where: { id: decision.id },
      data: { wasCorrect: false, archivedAt: new Date() },
    });

    res.json({ ok: true, threadId: decision.threadId });
  } catch {
    res.status(500).json({ error: 'Failed to record misclassification' });
  }
});

// Get unread count
gmailRouter.get('/unread-count', async (req, res) => {
  try {
    const auth = getAuthenticatedClient(req);
    const gmail = google.gmail({ version: 'v1', auth });

    const response = await gmail.users.labels.get({
      userId: 'me',
      id: 'INBOX',
    });

    res.json({ count: response.data.threadsUnread ?? 0 });
  } catch {
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

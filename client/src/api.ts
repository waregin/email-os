export interface MessageDetail {
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

export interface ThreadDetail {
  id: string;
  messages: MessageDetail[];
}

export interface Thread {
  id: string;
  snippet: string;
  subject: string;
  sender: string;
  date: string;
  isUnread: boolean;
  unreadCount: number;
}

export interface MatchingThread {
  threadId: string;
  subject: string;
  sender: string;
  date: string;
  snippet: string;
}

export interface DecisionWithThread {
  decisionId: string;
  threadId: string;
  priority: string;
  categoryLabel: string | null;
  digestSummary: string;
  decidedAt: string;
  confirmedByUser: boolean;
  userFlagged: boolean;
  thread: {
    subject: string;
    sender: string;
    date: string;
    snippet: string;
    unreadCount: number;
    messageCount: number;
  };
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  getStatus: () =>
    request<{ authenticated: boolean }>('/api/status'),

  getThread: (id: string) =>
    request<ThreadDetail>(`/api/gmail/threads/${id}`),

  getUnreadCount: () =>
    request<{ count: number }>('/api/gmail/unread-count'),

  getDecisions: () =>
    request<{ T1: DecisionWithThread[]; T2: DecisionWithThread[]; T3: DecisionWithThread[]; T4: DecisionWithThread[]; T5: DecisionWithThread[] }>(
      '/api/gmail/decisions',
    ),

  confirmDecision: (decisionId: string) =>
    request<{ ok: boolean }>(`/api/gmail/decisions/${decisionId}/confirm`, { method: 'POST' }),

  doneDecision: (decisionId: string) =>
    request<{ ok: boolean }>(`/api/gmail/decisions/${decisionId}/done`, { method: 'POST' }),

  followupDecision: (decisionId: string, note?: string) =>
    request<{ ok: boolean }>(`/api/gmail/decisions/${decisionId}/followup`, {
      method: 'POST',
      body: JSON.stringify(note ? { note } : {}),
    }),

  confirmAll: (decisionIds: string[], tier: string) =>
    request<{ ok: boolean; processed: number }>('/api/gmail/decisions/confirm-all', {
      method: 'POST',
      body: JSON.stringify({ decisionIds, tier }),
    }),

  misclassifiedDecision: (decisionId: string) =>
    request<{ ok: boolean; threadId: string }>(`/api/gmail/decisions/${decisionId}/misclassified`, { method: 'POST' }),

  saveRule: (rule: {
    existingRuleId?: string;
    trigger: string;
    action: string;
    priority: string;
    digestSummaryTemplate: string;
    notes?: string;
  }) =>
    request<{ ruleId: string; matchingThreads: MatchingThread[] }>('/api/agent/rules', {
      method: 'POST',
      body: JSON.stringify({ rule }),
    }),

  applyRule: (ruleId: string, threadIds: string[]) =>
    request<{ ok: boolean; applied: number }>(`/api/agent/rules/${ruleId}/apply`, {
      method: 'POST',
      body: JSON.stringify({ threadIds }),
    }),

  teachMessage: (payload: {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    threadContext: { subject: string; sender: string; snippet: string; date: string; threadId: string };
    userContext?: string;
  }) =>
    request<{ response: string }>('/api/agent/teach', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

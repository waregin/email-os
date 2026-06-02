import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from './api';
import type { Thread, DecisionWithThread, MatchingThread } from './api';
import { ThreadDetail } from './components/ThreadDetail';
import { DigestPanel } from './components/DigestPanel';
import { parseSender, formatDate } from './utils/text';
import { dedupeDecisions } from './utils/decisions';
import type { DecisionsState } from './utils/decisions';
import { parseProposal, describeTrigger } from './utils/rules';
import type { ProposedRule } from './utils/rules';

type AuthState = 'loading' | 'unauthenticated' | 'authenticated';

function updateFavicon(count: number): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;

  const label = count < 100 ? String(count) : '100+';
  const textLength = label.length == 1 ? 15 : label.length == 2 ? 20 : 30;

  if (!label) {
    link.type = 'image/svg+xml';
    link.href = '/favicon.svg';
    return;
  }

  const fontSize = 23;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="22" rx="5" fill="#00d3e8"/>
  <rect x="4" y="0" width="24" height="22" rx="2" fill="#001b3d"/>
  <path d="M0 0 L16 9 L32 0" fill="none" stroke="#62e9f7" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="${30-textLength}" y="12" width="${textLength+2}" height="20" rx="2" fill="#661414"/>
  <text x="31" y="22" text-anchor="end" dominant-baseline="central" fill="white" font-family="system-ui,sans-serif" font-weight="bold"
   font-size="${fontSize}" textLength="${textLength}" lengthAdjust="spacingAndGlyphs">${label}</text>
</svg>`;

  link.type = 'image/svg+xml';
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export default function App() {
  const [authState, setAuthState] = useState<AuthState>('loading');

  useEffect(() => {
    api.getStatus()
      .then(({ authenticated }) => setAuthState(authenticated ? 'authenticated' : 'unauthenticated'))
      .catch(() => setAuthState('unauthenticated'));
  }, []);

  useEffect(() => {
    if (authState !== 'authenticated') return;
    const updateTitle = () => {
      api.getUnreadCount()
        .then(({ count }) => {
          document.title = count > 0 ? `(${count}) Email OS` : 'Email OS';
          updateFavicon(count);
        })
        .catch(() => {});
    };
    updateTitle();
    const id = setInterval(updateTitle, 60_000);
    return () => clearInterval(id);
  }, [authState]);

  if (authState === 'loading') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <span className="text-gray-600 text-sm">Loading…</span>
      </div>
    );
  }

  if (authState === 'unauthenticated') return <LoginScreen />;
  return <MainApp />;
}

function LoginScreen() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-gray-100 mb-1">Email OS</h1>
        <p className="text-sm text-gray-500 mb-8">Your intelligent inbox</p>
        <a
          href="/auth/google"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-gray-900 text-sm font-medium rounded-lg hover:bg-gray-100 transition-colors"
        >
          Sign in with Google
        </a>
      </div>
    </div>
  );
}

const DIGEST_PANELS = [
  { tier: 'T1' as const, label: 'T1 Immediate Attention', accent: 'border-red-500/30 bg-red-500/5'    },
  { tier: 'T2' as const, label: 'T2 Action Required',     accent: 'border-amber-500/30 bg-amber-500/5' },
  { tier: 'T3' as const, label: 'T3 Summarized',          accent: 'border-blue-500/30 bg-blue-500/5'  },
  { tier: 'T4' as const, label: 'T4 Browse',              accent: 'border-gray-700 bg-gray-900/30'    },
];

function MainApp() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [teachThread, setTeachThread] = useState<Thread | null>(null);
  const [decisions, setDecisions] = useState<DecisionsState>({ T1: [], T2: [], T3: [], T4: [] });
  const [openTier, setOpenTier] = useState<'T1' | 'T2' | 'T3' | 'T4' | null>('T1');

  useEffect(() => {
    api.getThreads({ undecided: true })
      .then(({ threads, nextPageToken }) => {
        setThreads(threads);
        setNextPageToken(nextPageToken);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    api.getDecisions().then((d) => setDecisions(dedupeDecisions(d))).catch(() => {});
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      api.getDecisions().then((d) => setDecisions(dedupeDecisions(d))).catch(() => {});
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  function loadMore() {
    if (!nextPageToken || loadingMore) return;
    setLoadingMore(true);
    api.getThreads({ pageToken: nextPageToken, undecided: true })
      .then(({ threads: more, nextPageToken: next }) => {
        setThreads((prev) => [...prev, ...more]);
        setNextPageToken(next);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadingMore(false));
  }

  function removeDecision(decisionId: string) {
    setDecisions((prev) => {
      const result = { ...prev };
      for (const tier of ['T1', 'T2', 'T3', 'T4'] as const) {
        if (result[tier].some((d) => d.decisionId === decisionId)) {
          result[tier] = result[tier].filter((d) => d.decisionId !== decisionId);
          return result;
        }
      }
      return prev;
    });
  }

  function prependThreadIfMissing(detail: import('./api').ThreadDetail) {
    const lastMsg = detail.messages[detail.messages.length - 1];
    if (!lastMsg) return;
    const tempThread: Thread = {
      id: detail.id,
      snippet: lastMsg.snippet,
      subject: lastMsg.subject,
      sender: lastMsg.sender,
      date: lastMsg.date,
      isUnread: lastMsg.isUnread,
      unreadCount: detail.messages.filter((m) => m.isUnread).length,
    };
    setThreads((prev) => (prev.some((t) => t.id === detail.id) ? prev : [tempThread, ...prev]));
  }

  function handleConfirm(decisionId: string) {
    setDecisions((prev) => {
      const result = { ...prev };
      for (const t of ['T1', 'T2', 'T3', 'T4'] as const) {
        if (result[t].some((d) => d.decisionId === decisionId)) {
          result[t] = result[t].map((d) =>
            d.decisionId === decisionId ? { ...d, confirmedByUser: true } : d,
          );
          return result;
        }
      }
      return prev;
    });
    api.confirmDecision(decisionId).catch(() => {});
  }

  function handleDone(decisionId: string) {
    removeDecision(decisionId);
    api.doneDecision(decisionId).catch(() => {});
  }

  function handleFollowup(decisionId: string) {
    setDecisions((prev) => {
      let found: DecisionWithThread | undefined;
      let fromTier: 'T3' | 'T4' | undefined;
      for (const t of ['T3', 'T4'] as const) {
        const item = prev[t].find((d) => d.decisionId === decisionId);
        if (item) { found = item; fromTier = t; break; }
      }
      if (!found || !fromTier) return prev;
      return {
        ...prev,
        [fromTier]: prev[fromTier].filter((d) => d.decisionId !== decisionId),
        T2: [{ ...found, userFlagged: true, priority: 'T2' }, ...prev.T2],
      };
    });
    api.followupDecision(decisionId).catch(() => {});
  }

  function handleConfirmAll(decisionIds: string[], tier: string) {
    const idSet = new Set(decisionIds);
    if (tier === 'T1' || tier === 'T2') {
      const t = tier as 'T1' | 'T2';
      setDecisions((prev) => ({
        ...prev,
        [t]: prev[t].map((d) =>
          idSet.has(d.decisionId) ? { ...d, confirmedByUser: true } : d,
        ),
      }));
    } else {
      const t = tier as 'T3' | 'T4';
      setDecisions((prev) => ({
        ...prev,
        [t]: prev[t].filter((d) => !idSet.has(d.decisionId)),
      }));
    }
    api.confirmAll(decisionIds, tier).catch(() => {});
  }

  async function handleMisclassified(decisionId: string, threadId: string) {
    removeDecision(decisionId);
    api.misclassifiedDecision(decisionId).catch(() => {});
    if (!threads.some((t) => t.id === threadId)) {
      try {
        const detail = await api.getThread(threadId);
        prependThreadIfMissing(detail);
      } catch {}
    }
  }

  const handleTeachClose = useCallback(() => setTeachThread(null), []);
  const handleDecisionsRefresh = useCallback(() => {
    api.getDecisions().then((d) => setDecisions(dedupeDecisions(d))).catch(() => {});
  }, []);

  const decidedThreadIds = new Set(
    [...decisions.T1, ...decisions.T2, ...decisions.T3, ...decisions.T4].map((d) => d.threadId),
  );
  const inboxThreads = threads.filter((t) => !decidedThreadIds.has(t.id));

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="w-full min-[750px]:w-1/2 mx-auto px-4 py-6 space-y-8">

        <header className="flex items-center justify-between border-b border-gray-800 pb-4">
          <h1 className="text-base font-semibold tracking-tight text-gray-100">Email OS</h1>
        </header>

        {/* Digest */}
        <section className="space-y-3">
          <SectionLabel>Digest</SectionLabel>
          <div className="space-y-2">
            {DIGEST_PANELS.map(({ tier, label, accent }) => (
              <DigestPanel
                key={tier}
                tier={tier}
                label={label}
                accent={accent}
                items={decisions[tier]}
                isOpen={openTier === tier}
                onToggle={() => setOpenTier((prev) => (prev === tier ? null : tier))}
                onConfirm={handleConfirm}
                onDone={handleDone}
                onFollowup={handleFollowup}
                onMisclassified={handleMisclassified}
                onConfirmAll={handleConfirmAll}
                onViewThread={() => {}}
              />
            ))}
          </div>
        </section>

        {/* Thread list */}
        <section className="space-y-3">
          <SectionLabel>Inbox{!loading ? ` (${inboxThreads.length})` : ''}</SectionLabel>
          {loading && <p className="text-sm text-gray-600 py-2">Loading threads…</p>}
          {error   && <p className="text-sm text-red-400 py-2">Error: {error}</p>}
          {!loading && !error && inboxThreads.length === 0 && (
            <p className="text-sm text-gray-600 py-2">No threads found.</p>
          )}
          {inboxThreads.length > 0 && (
            <div className="rounded-lg border border-gray-800 overflow-clip divide-y divide-gray-800">
              {inboxThreads.map((thread) => (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  expanded={expandedId === thread.id}
                  onToggle={() => setExpandedId(expandedId === thread.id ? null : thread.id)}
                  onTeach={(t) => setTeachThread(t)}
                />
              ))}
              {nextPageToken && (
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="w-full px-4 py-3 text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-900/60 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors text-center bg-gray-900/20 tracking-wider"
                >
                  {loadingMore ? 'LOADING…' : 'LOAD MORE…'}
                </button>
              )}
            </div>
          )}
        </section>


      </div>

      <TeachPanel
        thread={teachThread}
        onClose={handleTeachClose}
        onDecisionsRefresh={handleDecisionsRefresh}
      />
    </div>
  );
}

type ChatMessage = { role: 'user' | 'assistant'; content: string };

const PRIORITY_BADGE: Record<string, string> = {
  T1: 'bg-red-500/20 text-red-400 border border-red-500/30',
  T2: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  T3: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  T4: 'bg-gray-700 text-gray-400 border border-gray-600',
};
const PRIORITY_LABEL: Record<string, string> = {
  T1: 'T1 Immediate Attention', T2: 'T2 Action Required', T3: 'T3 Summarized', T4: 'T4 Browse',
};

type RulePhase = 'pending' | 'saving' | 'threads' | 'applying' | 'done' | 'no-matches';

function TeachPanel({
  thread,
  onClose,
  onDecisionsRefresh,
}: {
  thread: Thread | null;
  onClose: () => void;
  onDecisionsRefresh: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [rulePhase, setRulePhase] = useState<RulePhase | null>(null);
  const [savedRuleId, setSavedRuleId] = useState<string | null>(null);
  const [matchingThreads, setMatchingThreads] = useState<MatchingThread[]>([]);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [doneMessage, setDoneMessage] = useState('');

  useEffect(() => {
    if (!thread) {
      setMessages([]);
      setInput('');
      setError(null);
      setRulePhase(null);
      setSavedRuleId(null);
      setMatchingThreads([]);
      setCheckedIds([]);
      setDoneMessage('');
      return;
    }

    setMessages([]);
    setError(null);
    setRulePhase(null);
    setLoading(true);

    api.teachMessage({
      messages: [],
      threadContext: { subject: thread.subject, sender: thread.sender, snippet: thread.snippet, date: thread.date, threadId: thread.id },
    })
      .then(({ response }) => setMessages([{ role: 'assistant', content: response }]))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [thread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, rulePhase, matchingThreads]);

  useEffect(() => {
    if (rulePhase !== 'done') return;
    const id = setTimeout(() => { onDecisionsRefresh(); onClose(); }, 2000);
    return () => clearTimeout(id);
  }, [rulePhase, onDecisionsRefresh, onClose]);

  async function sendText(text: string) {
    if (loading || !thread) return;
    const userMsg: ChatMessage = { role: 'user', content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setLoading(true);
    setError(null);

    try {
      const { response } = await api.teachMessage({
        messages: next,
        threadContext: { subject: thread.subject, sender: thread.sender, snippet: thread.snippet, date: thread.date, threadId: thread.id },
      });
      setMessages([...next, { role: 'assistant', content: response }]);
      if (parseProposal(response).proposal) {
        setRulePhase(null);
        setSavedRuleId(null);
        setMatchingThreads([]);
        setCheckedIds([]);
        setDoneMessage('');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage() {
    if (!input.trim() || loading || !thread) return;
    const text = input.trim();
    setInput('');
    await sendText(text);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  async function handleConfirmRule(proposal: ProposedRule) {
    setRulePhase('saving');
    const trigger = typeof proposal.trigger === 'string'
      ? proposal.trigger
      : JSON.stringify(proposal.trigger);
    try {
      const { ruleId, matchingThreads: threads } = await api.saveRule({
        existingRuleId: typeof proposal.existingRuleId === 'string' ? proposal.existingRuleId : undefined,
        trigger,
        action: proposal.action,
        priority: proposal.priority,
        digestSummaryTemplate: proposal.digestSummaryTemplate,
        notes: proposal.notes,
      });
      setSavedRuleId(ruleId);
      if (threads.length === 0) {
        setRulePhase('no-matches');
      } else {
        setMatchingThreads(threads);
        setCheckedIds(threads.map((t) => t.threadId));
        setRulePhase('threads');
      }
    } catch (err) {
      setError((err as Error).message);
      setRulePhase('pending');
    }
  }

  async function handleApply() {
    if (!savedRuleId || checkedIds.length === 0) return;
    setRulePhase('applying');
    try {
      const { applied } = await api.applyRule(savedRuleId, checkedIds);
      setDoneMessage(`Applied to ${applied} thread${applied !== 1 ? 's' : ''}. Moving to digest…`);
      setRulePhase('done');
    } catch (err) {
      setError((err as Error).message);
      setRulePhase('threads');
    }
  }

  function handleSkip() {
    setDoneMessage('Rule saved.');
    setRulePhase('done');
  }

  function toggleThread(threadId: string) {
    setCheckedIds((prev) =>
      prev.includes(threadId) ? prev.filter((id) => id !== threadId) : [...prev, threadId],
    );
  }

  if (!thread) return null;

  const lastProposalIdx = messages.reduce(
    (acc, msg, i) => (msg.role === 'assistant' && parseProposal(msg.content).proposal ? i : acc),
    -1,
  );

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-gray-900 border-l border-gray-800 z-50 flex flex-col shadow-2xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
        <div className="min-w-0">
          <span className="text-sm font-medium text-gray-200">Teach</span>
          <p className="text-xs text-gray-600 truncate mt-0.5">{thread.subject}</p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-200 transition-colors text-lg leading-none shrink-0 ml-2"
          aria-label="Close teach panel"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 px-4 py-4 overflow-y-auto space-y-3">
        {messages.map((msg, i) => {
          if (msg.role === 'assistant') {
            const { before, proposal, after } = parseProposal(msg.content);
            const isActiveProposal = proposal !== null && i === lastProposalIdx;

            if (proposal) {
              const badgeClass = PRIORITY_BADGE[proposal.priority] ?? PRIORITY_BADGE.T4;
              return (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[92%] rounded-xl px-3 py-2.5 text-sm bg-gray-800 text-gray-200 rounded-bl-sm space-y-2.5">
                    {before && <p className="whitespace-pre-wrap text-gray-300">{before}</p>}

                    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3 space-y-2">
                      <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded ${badgeClass}`}>
                        {PRIORITY_LABEL[proposal.priority] ?? proposal.priority}
                      </span>
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">Trigger</p>
                        <p className="text-xs text-gray-300">{describeTrigger(proposal.trigger)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">Digest template</p>
                        <p className="text-xs text-gray-300 italic">{proposal.digestSummaryTemplate}</p>
                      </div>
                      {proposal.notes && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">Notes</p>
                          <p className="text-xs text-gray-400">{proposal.notes}</p>
                        </div>
                      )}
                    </div>

                    {after && <p className="whitespace-pre-wrap text-gray-300">{after}</p>}

                    {isActiveProposal && rulePhase === null && (
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => { setRulePhase('pending'); handleConfirmRule(proposal); }}
                          className="flex-1 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 transition-colors"
                        >
                          Confirm rule
                        </button>
                        <button
                          onClick={() => sendText('Please revise the rule')}
                          className="flex-1 px-3 py-1.5 bg-gray-700 text-gray-300 text-xs rounded-lg hover:bg-gray-600 transition-colors"
                        >
                          Revise
                        </button>
                      </div>
                    )}

                    {isActiveProposal && rulePhase === 'saving' && (
                      <p className="text-xs text-gray-400 pt-1">Searching inbox for matching threads…</p>
                    )}

                    {isActiveProposal && rulePhase === 'threads' && (
                      <div className="space-y-2 pt-1">
                        <p className="text-xs text-gray-400">
                          Found {matchingThreads.length} matching thread{matchingThreads.length !== 1 ? 's' : ''}.
                        </p>
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {matchingThreads.map((t) => (
                            <label key={t.threadId} className="flex items-start gap-2 cursor-pointer group">
                              <input
                                type="checkbox"
                                checked={checkedIds.includes(t.threadId)}
                                onChange={() => toggleThread(t.threadId)}
                                className="mt-0.5 shrink-0 accent-blue-500"
                              />
                              <span className="text-xs text-gray-300 leading-tight group-hover:text-gray-100">
                                <span className="font-medium">{t.subject}</span>
                                <span className="text-gray-500"> · {t.sender}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={handleApply}
                            disabled={checkedIds.length === 0}
                            className="flex-1 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            Apply to {checkedIds.length} thread{checkedIds.length !== 1 ? 's' : ''}
                          </button>
                          <button
                            onClick={handleSkip}
                            className="flex-1 px-3 py-1.5 bg-gray-700 text-gray-300 text-xs rounded-lg hover:bg-gray-600 transition-colors"
                          >
                            Skip — save rule only
                          </button>
                        </div>
                      </div>
                    )}

                    {isActiveProposal && rulePhase === 'applying' && (
                      <p className="text-xs text-gray-400 pt-1">Applying rule…</p>
                    )}

                    {isActiveProposal && rulePhase === 'done' && (
                      <p className="text-xs text-green-400 pt-1">{doneMessage}</p>
                    )}

                    {isActiveProposal && rulePhase === 'no-matches' && (
                      <div className="pt-1 space-y-1">
                        <p className="text-xs text-amber-400">Rule saved, but no matching threads were found in your inbox. The trigger may need adjustment — you can continue the conversation to refine it.</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            }
          }

          return (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : 'bg-gray-800 text-gray-200 rounded-bl-sm'
                }`}
              >
                {msg.content}
              </div>
            </div>
          );
        })}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-800 rounded-xl rounded-bl-sm px-3 py-2 text-sm text-gray-500">…</div>
          </div>
        )}
        {error && <p className="text-xs text-red-400 text-center px-2">{error}</p>}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 py-3 border-t border-gray-800 shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            placeholder="Type a message… (Enter to send)"
            rows={2}
            className="flex-1 bg-gray-800 text-gray-200 text-sm rounded-lg px-3 py-2 resize-none placeholder-gray-600 disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-gray-600 leading-snug"
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="shrink-0 px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wider">{children}</h2>
  );
}

function TeachButton({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 text-xs text-gray-500 hover:text-gray-300 px-2 py-1 rounded border border-gray-700 hover:border-gray-600 transition-colors"
    >
      Teach
    </button>
  );
}

function ThreadRow({
  thread,
  expanded,
  onToggle,
  onTeach,
}: {
  thread: Thread;
  expanded: boolean;
  onToggle: () => void;
  onTeach: (thread: Thread) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (expanded && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [expanded]);

  return (
    <div ref={rowRef}>
      <div
        className={`sticky top-0 z-10 ${expanded ? 'bg-gray-950' : ''}`}
      >
        <div
          className={`flex items-center gap-2 px-4 py-3 hover:bg-gray-900/60 transition-colors ${
            thread.isUnread ? 'bg-gray-900/40' : ''
          } ${expanded ? 'border-b border-gray-800' : ''}`}
        >
          <div
            className="flex-1 min-w-0 cursor-pointer"
            onClick={onToggle}
          >
            <div className="flex items-baseline justify-between gap-3 min-w-0">
              <span className="flex items-baseline gap-1.5 truncate min-w-0">
                <span className={`text-sm truncate ${thread.isUnread ? 'font-semibold text-gray-100' : 'text-gray-300'}`}>
                  {parseSender(thread.sender)}
                </span>
                {thread.unreadCount > 1 && (
                  <span className="text-xs font-semibold text-blue-400 shrink-0">{thread.unreadCount}</span>
                )}
              </span>
              <span className="text-xs text-gray-600 whitespace-nowrap shrink-0">
                {formatDate(thread.date)}
              </span>
            </div>
            <div className={`text-sm truncate mt-0.5 ${thread.isUnread ? 'text-gray-200' : 'text-gray-400'}`}>
              {thread.subject}
            </div>
            {thread.snippet && (
              <div className="text-xs text-gray-600 truncate mt-0.5">{thread.snippet}</div>
            )}
          </div>
          <TeachButton onClick={(e) => { e.stopPropagation(); onTeach(thread); }} />
        </div>
      </div>
      {expanded && (
        <div className="bg-gray-900">
          <ThreadDetail threadId={thread.id} />
          <div className="px-4 py-3 border-t border-gray-800 flex justify-end">
            <TeachButton onClick={() => onTeach(thread)} />
          </div>
        </div>
      )}
    </div>
  );
}

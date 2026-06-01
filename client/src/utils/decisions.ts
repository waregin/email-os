import type { DecisionWithThread } from '../api';

export type DecisionsState = {
  T1: DecisionWithThread[];
  T2: DecisionWithThread[];
  T3: DecisionWithThread[];
  T4: DecisionWithThread[];
};

// Keep the first decision per threadId within each tier — guards against DB duplicates
// created by a race between the agent apply endpoint and the scheduled triage pass.
export function dedupeDecisions(d: DecisionsState): DecisionsState {
  const dedup = (items: DecisionWithThread[]) => {
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.threadId)) return false;
      seen.add(item.threadId);
      return true;
    });
  };
  return { T1: dedup(d.T1), T2: dedup(d.T2), T3: dedup(d.T3), T4: dedup(d.T4) };
}

export function buildGroups(items: DecisionWithThread[]) {
  const groupMap = new Map<string, DecisionWithThread[]>();
  for (const item of items) {
    const key = item.categoryLabel ?? 'Other';
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(item);
  }
  return Array.from(groupMap.entries())
    .sort(([a], [b]) => {
      if (a === 'Other' && b !== 'Other') return 1;
      if (b === 'Other' && a !== 'Other') return -1;
      return a.localeCompare(b);
    })
    .map(([label, groupItems]) => ({
      label,
      items: [...groupItems].sort(
        (a, b) => new Date(a.thread.date).getTime() - new Date(b.thread.date).getTime(),
      ),
    }));
}

import { useState, useEffect, useRef } from 'react';
import type { DecisionWithThread } from '../api';
import { ThreadDetail } from './ThreadDetail';
import { parseSender, formatDate } from '../utils/text';
import { buildGroups } from '../utils/decisions';

interface DigestPanelProps {
  tier: 'T1' | 'T2' | 'T3' | 'T4';
  label: string;
  accent: string;
  items: DecisionWithThread[];
  isOpen: boolean;
  onToggle: () => void;
  onConfirm: (decisionId: string) => void;
  onDone: (decisionId: string) => void;
  onFollowup: (decisionId: string, note?: string) => void;
  onMisclassified: (decisionId: string, threadId: string) => void;
  onConfirmAll: (decisionIds: string[], tier: string) => void;
  onViewThread: (threadId: string) => void;
}

function DigestItemRow({
  item,
  expanded,
  isT12,
  isT4,
  onToggle,
  onDone,
  onConfirm,
  onFollowup,
  onMisclassified,
}: {
  item: DecisionWithThread;
  expanded: boolean;
  isT12: boolean;
  isT4: boolean;
  onToggle: () => void;
  onDone: (decisionId: string) => void;
  onConfirm: (decisionId: string) => void;
  onFollowup: (decisionId: string, note?: string) => void;
  onMisclassified: (decisionId: string, threadId: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const prevExpanded = useRef(expanded);
  const [followupMode, setFollowupMode] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (prevExpanded.current === expanded) return;
    prevExpanded.current = expanded;
    rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [expanded]);

  const confirmed = item.confirmedByUser;

  function openFollowup() {
    setNote(item.thread.subject);
    setFollowupMode(true);
  }

  function confirmFollowup() {
    onFollowup(item.decisionId, note);
    setFollowupMode(false);
  }

  return (
    <div ref={rowRef} className={confirmed ? 'opacity-50' : ''}>
      <div className={`sticky top-0 z-10 ${expanded ? 'bg-gray-950' : ''}`}>
      <div
        className={`flex items-start gap-2 px-4 py-3 hover:bg-white/5 transition-colors group cursor-pointer ${expanded ? 'border-b border-gray-800/60' : ''}`}
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-1.5 min-w-0">
              <span className={`text-sm truncate ${confirmed ? 'text-gray-400' : 'text-gray-200 font-medium'}`}>
                {parseSender(item.thread.sender)}
              </span>
              {item.thread.unreadCount > 1 && (
                <span className="text-xs font-semibold text-blue-400 shrink-0">{item.thread.unreadCount}</span>
              )}
              {item.userFlagged && (
                <span className="text-xs text-amber-500 shrink-0 font-normal">
                  ↩ Followup
                </span>
              )}
            </div>
            <span className="text-xs text-gray-600 whitespace-nowrap shrink-0">
              {formatDate(item.thread.date)}
            </span>
          </div>
          {isT4 ? (
            <>
              <div className="text-sm truncate text-gray-400 mt-0.5">{item.thread.subject}</div>
              {item.thread.snippet && (
                <div className="text-xs text-gray-600 truncate mt-0.5">{item.thread.snippet}</div>
              )}
            </>
          ) : (
            <div className="text-xs text-gray-400 break-words whitespace-normal mt-0.5">
              {item.digestSummary}
            </div>
          )}
        </div>
        <div
          className="flex gap-1 shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          {isT12 ? (
            item.userFlagged ? (
              <button
                onClick={() => onDone(item.decisionId)}
                className="text-xs px-2 py-0.5 rounded border border-gray-700 text-gray-400 hover:text-blue-400 hover:border-blue-700 transition-colors"
              >
                Done
              </button>
            ) : (
              <>
                {!confirmed && (
                  <button
                    onClick={() => onConfirm(item.decisionId)}
                    className="text-xs px-2 py-0.5 rounded border border-gray-700 text-gray-400 hover:text-green-400 hover:border-green-700 transition-colors"
                  >
                    Confirm
                  </button>
                )}
                <button
                  onClick={() => onDone(item.decisionId)}
                  className="text-xs px-2 py-0.5 rounded border border-gray-700 text-gray-400 hover:text-blue-400 hover:border-blue-700 transition-colors"
                >
                  Done
                </button>
                <button
                  onClick={() => onMisclassified(item.decisionId, item.threadId)}
                  className="text-xs px-2 py-0.5 rounded border border-gray-700 text-gray-400 hover:text-red-400 hover:border-red-700 transition-colors"
                >
                  Wrong
                </button>
              </>
            )
          ) : (
            <>
              <button
                onClick={() => onConfirm(item.decisionId)}
                className="text-xs px-2 py-0.5 rounded border border-gray-700 text-gray-400 hover:text-green-400 hover:border-green-700 transition-colors"
              >
                Confirm
              </button>
              <button
                onClick={openFollowup}
                className="text-xs px-2 py-0.5 rounded border border-gray-700 text-gray-400 hover:text-orange-400 hover:border-orange-500 transition-colors"
              >
                Followup
              </button>
              <button
                onClick={() => onMisclassified(item.decisionId, item.threadId)}
                className="text-xs px-2 py-0.5 rounded border border-gray-700 text-gray-400 hover:text-red-400 hover:border-red-700 transition-colors"
              >
                Wrong
              </button>
            </>
          )}
        </div>
      </div>
      </div>
      {followupMode && (
        <div
          className="flex items-center gap-2 px-4 py-2 border-b border-gray-800/60 bg-gray-900/30"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmFollowup();
              if (e.key === 'Escape') setFollowupMode(false);
            }}
            autoFocus
            placeholder="Why are you following up?"
            aria-label="Followup note"
            className="flex-1 min-w-0 text-xs bg-gray-950 border border-gray-700 rounded px-2 py-1 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
          />
          <button
            onClick={confirmFollowup}
            className="text-xs px-2 py-0.5 rounded border border-gray-700 text-gray-400 hover:text-orange-400 hover:border-orange-500 transition-colors shrink-0"
          >
            Confirm
          </button>
          <button
            onClick={() => setFollowupMode(false)}
            className="text-xs px-2 py-0.5 rounded border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors shrink-0"
          >
            Cancel
          </button>
        </div>
      )}
      {expanded && (
        <div className="bg-gray-950/40">
          <ThreadDetail threadId={item.threadId} />
        </div>
      )}
    </div>
  );
}

function DigestGroupPanel({
  groupLabel,
  groupItems,
  isOpen,
  onToggle,
  expandedDecisionId,
  setExpandedDecisionId,
  onViewThread,
  onDone,
  onConfirm,
  onFollowup,
  onMisclassified,
  onConfirmAll,
}: {
  groupLabel: string;
  groupItems: DecisionWithThread[];
  isOpen: boolean;
  onToggle: () => void;
  expandedDecisionId: string | null;
  setExpandedDecisionId: (id: string | null) => void;
  onViewThread: (threadId: string) => void;
  onDone: (id: string) => void;
  onConfirm: (id: string) => void;
  onFollowup: (id: string, note?: string) => void;
  onMisclassified: (id: string, threadId: string) => void;
  onConfirmAll: (items: DecisionWithThread[]) => void;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  const prevIsOpen = useRef(isOpen);

  useEffect(() => {
    if (prevIsOpen.current === isOpen) return;
    prevIsOpen.current = isOpen;
    if (isOpen) {
      groupRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [isOpen]);

  return (
    <div ref={groupRef} className="border-t border-white/10 first:border-t-0">
      <button
        className="w-full flex items-center justify-between px-4 py-2 text-left hover:bg-white/5 transition-colors"
        onClick={onToggle}
      >
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          {groupLabel} ({groupItems.length})
        </span>
        <span className="text-gray-500 text-xs">{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen && (
        <>
          <div className="divide-y divide-gray-800/60">
            {groupItems.map((item) => (
              <DigestItemRow
                key={item.decisionId}
                item={item}
                expanded={expandedDecisionId === item.decisionId}
                isT12={false}
                isT4={true}
                onToggle={() => {
                  const opening = expandedDecisionId !== item.decisionId;
                  setExpandedDecisionId(opening ? item.decisionId : null);
                  if (opening) onViewThread(item.threadId);
                }}
                onDone={onDone}
                onConfirm={onConfirm}
                onFollowup={onFollowup}
                onMisclassified={onMisclassified}
              />
            ))}
          </div>
          <div className="px-4 py-2 flex justify-end">
            <button
              onClick={() => onConfirmAll(groupItems)}
              className="text-xs px-3 py-1 rounded border border-gray-700 text-gray-400 hover:text-green-400 hover:border-green-700 transition-colors"
            >
              Confirm all
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function DigestPanel({
  tier,
  label,
  accent,
  items,
  isOpen,
  onToggle,
  onConfirm,
  onDone,
  onFollowup,
  onMisclassified,
  onConfirmAll,
  onViewThread,
}: DigestPanelProps) {
  const isT12 = tier === 'T1' || tier === 'T2';
  const isT4 = tier === 'T4';
  const [snapshotItems, setSnapshotItems] = useState<DecisionWithThread[]>([]);
  const [expandedDecisionId, setExpandedDecisionId] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const snapshotTaken = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const prevIsOpen = useRef(isOpen);

  useEffect(() => {
    if (prevIsOpen.current === isOpen) return;
    prevIsOpen.current = isOpen;
    if (isOpen) {
      panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && !snapshotTaken.current && items.length > 0) {
      snapshotTaken.current = true;
      setSnapshotItems([...items]);
    }
  }, [isOpen, items]);

  function handleToggle() {
    if (!isOpen) {
      snapshotTaken.current = true;
      setSnapshotItems([...items]);
    } else {
      snapshotTaken.current = false;
    }
    onToggle();
  }

  function removeFromSnapshot(decisionId: string) {
    setSnapshotItems((prev) => prev.filter((item) => item.decisionId !== decisionId));
    setExpandedDecisionId((prev) => (prev === decisionId ? null : prev));
  }

  function handleConfirm(decisionId: string) {
    if (isT12) {
      setSnapshotItems((prev) =>
        prev.map((item) =>
          item.decisionId === decisionId ? { ...item, confirmedByUser: true } : item,
        ),
      );
    } else {
      removeFromSnapshot(decisionId);
    }
    onConfirm(decisionId);
  }

  function handleDone(decisionId: string) {
    removeFromSnapshot(decisionId);
    onDone(decisionId);
  }

  function handleFollowup(decisionId: string, note?: string) {
    removeFromSnapshot(decisionId);
    onFollowup(decisionId, note);
  }

  function handleMisclassified(decisionId: string, threadId: string) {
    removeFromSnapshot(decisionId);
    onMisclassified(decisionId, threadId);
  }

  function handleConfirmAll() {
    if (isT12) {
      const unconfirmedIds = snapshotItems
        .filter((i) => !i.confirmedByUser)
        .map((i) => i.decisionId);
      if (unconfirmedIds.length === 0) return;
      setSnapshotItems((prev) => prev.map((i) => ({ ...i, confirmedByUser: true })));
      onConfirmAll(unconfirmedIds, tier);
    } else {
      if (snapshotItems.length === 0) return;
      const allIds = snapshotItems.map((i) => i.decisionId);
      setSnapshotItems([]);
      onConfirmAll(allIds, tier);
    }
  }

  function handleGroupConfirmAll(groupItems: DecisionWithThread[]) {
    if (groupItems.length === 0) return;
    const ids = groupItems.map((i) => i.decisionId);
    setSnapshotItems((prev) => prev.filter((item) => !ids.includes(item.decisionId)));
    onConfirmAll(ids, tier);
  }

  function toggleGroupCollapsed(groupLabel: string) {
    setOpenGroup((prev) => (prev === groupLabel ? null : groupLabel));
  }

  const badgeCount = isOpen ? snapshotItems.length : items.length;

  return (
    <div ref={panelRef} className={`rounded-lg border ${accent} overflow-clip`}>
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
        onClick={handleToggle}
      >
        <span className="text-sm font-medium text-gray-200">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold bg-gray-800 text-gray-300 rounded-full px-2 py-0.5 min-w-[1.5rem] text-center">
            {badgeCount}
          </span>
          <span className="text-gray-500 text-xs">{isOpen ? '▲' : '▼'}</span>
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-white/10">
          {snapshotItems.length === 0 ? (
            <div className="px-4 py-5 text-sm text-gray-500 text-center">All caught up ✓</div>
          ) : isT4 ? (
            <>
              {buildGroups(snapshotItems).map(({ label: groupLabel, items: groupItems }) => (
                <DigestGroupPanel
                  key={groupLabel}
                  groupLabel={groupLabel}
                  groupItems={groupItems}
                  isOpen={openGroup === groupLabel}
                  onToggle={() => toggleGroupCollapsed(groupLabel)}
                  expandedDecisionId={expandedDecisionId}
                  setExpandedDecisionId={setExpandedDecisionId}
                  onViewThread={onViewThread}
                  onDone={handleDone}
                  onConfirm={handleConfirm}
                  onFollowup={handleFollowup}
                  onMisclassified={handleMisclassified}
                  onConfirmAll={handleGroupConfirmAll}
                />
              ))}
            </>
          ) : (
            <>
              <div className="divide-y divide-gray-800/60">
                {snapshotItems.map((item) => (
                  <DigestItemRow
                    key={item.decisionId}
                    item={item}
                    expanded={expandedDecisionId === item.decisionId}
                    isT12={isT12}
                    isT4={false}
                    onToggle={() => {
                      const opening = expandedDecisionId !== item.decisionId;
                      setExpandedDecisionId(opening ? item.decisionId : null);
                      if (opening) onViewThread(item.threadId);
                    }}
                    onDone={handleDone}
                    onConfirm={handleConfirm}
                    onFollowup={handleFollowup}
                    onMisclassified={handleMisclassified}
                  />
                ))}
              </div>
              <div className="px-4 py-2 border-t border-gray-800/60 flex justify-end">
                <button
                  onClick={handleConfirmAll}
                  className="text-xs px-3 py-1 rounded border border-gray-700 text-gray-400 hover:text-green-400 hover:border-green-700 transition-colors"
                >
                  Confirm all
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

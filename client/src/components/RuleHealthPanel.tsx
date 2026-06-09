import type { RuleWithSuggestion } from '../api';
import { describeTrigger } from '../utils/rules';

interface SuggestionData {
  trigger?: unknown;
  priority?: string;
  categoryLabel?: string;
  digestSummaryTemplate?: string;
  notes?: string;
  reason?: string;
}

function parseSuggestion(json: string): SuggestionData {
  try {
    return JSON.parse(json) as SuggestionData;
  } catch {
    return {};
  }
}

const PRIORITY_BADGE: Record<string, string> = {
  T1: 'bg-red-500/20 text-red-400 border border-red-500/30',
  T2: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  T3: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  T4: 'bg-gray-700 text-gray-300 border border-gray-600',
};

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${PRIORITY_BADGE[priority] ?? 'bg-gray-700 text-gray-400'}`}>
      {priority}
    </span>
  );
}

interface SuggestionCardProps {
  rule: RuleWithSuggestion;
  onAccept: () => void;
  onDismiss: () => void;
}

function SuggestionCard({ rule, onAccept, onDismiss }: SuggestionCardProps) {
  const suggestion = parseSuggestion(rule.pendingSuggestion);

  const currentTrigger = describeTrigger(rule.trigger);
  const proposedTrigger = suggestion.trigger ? describeTrigger(suggestion.trigger) : currentTrigger;
  const proposedPriority = suggestion.priority ?? rule.priority;
  const proposedTemplate = suggestion.digestSummaryTemplate ?? rule.digestSummaryTemplate;

  const triggerChanged = proposedTrigger !== currentTrigger;
  const priorityChanged = proposedPriority !== rule.priority;
  const templateChanged = proposedTemplate !== rule.digestSummaryTemplate;

  return (
    <div className="border border-amber-600/30 bg-amber-500/5 rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 uppercase tracking-wide">{rule.source}</span>
            <PriorityBadge priority={rule.priority} />
          </div>
          <p className="text-sm text-gray-300 truncate">{currentTrigger}</p>
        </div>
      </div>

      {/* Proposed changes */}
      <div className="border-t border-amber-600/20 pt-3 space-y-2">
        <p className="text-xs text-amber-400/80 font-medium uppercase tracking-wide">Proposed changes</p>

        {triggerChanged && (
          <div className="space-y-0.5">
            <p className="text-xs text-gray-500">Trigger</p>
            <p className="text-sm text-gray-200">{proposedTrigger}</p>
          </div>
        )}

        {priorityChanged && (
          <div className="flex items-center gap-2">
            <p className="text-xs text-gray-500">Priority</p>
            <PriorityBadge priority={proposedPriority} />
          </div>
        )}

        {templateChanged && (
          <div className="space-y-0.5">
            <p className="text-xs text-gray-500">Template</p>
            <p className="text-sm text-gray-200 font-mono">{proposedTemplate}</p>
          </div>
        )}

        {!triggerChanged && !priorityChanged && !templateChanged && (
          <p className="text-xs text-gray-500">No field changes — see reason below</p>
        )}
      </div>

      {/* Reason */}
      {suggestion.reason && (
        <p className="text-xs text-gray-500 italic">{suggestion.reason}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onAccept}
          className="text-xs px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 border border-amber-600/40 rounded transition-colors"
        >
          Accept
        </button>
        <button
          onClick={onDismiss}
          className="text-xs px-3 py-1.5 text-gray-400 hover:text-gray-200 transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

interface RuleHealthPanelProps {
  suggestions: RuleWithSuggestion[];
  onAccept: (ruleId: string) => void;
  onDismiss: (ruleId: string) => void;
}

export function RuleHealthPanel({ suggestions, onAccept, onDismiss }: RuleHealthPanelProps) {
  if (suggestions.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500">Rule Health</h2>
        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-600/20 text-amber-400 border border-amber-600/30">
          {suggestions.length}
        </span>
      </div>
      <div className="space-y-2">
        {suggestions.map((rule) => (
          <SuggestionCard
            key={rule.id}
            rule={rule}
            onAccept={() => onAccept(rule.id)}
            onDismiss={() => onDismiss(rule.id)}
          />
        ))}
      </div>
    </section>
  );
}

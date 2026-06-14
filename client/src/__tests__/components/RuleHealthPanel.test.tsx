import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RuleHealthPanel } from '../../components/RuleHealthPanel';
import type { RuleWithSuggestion } from '../../api';

function makeRule(overrides: Partial<RuleWithSuggestion> = {}): RuleWithSuggestion {
  return {
    id: 'rule-1',
    trigger: JSON.stringify({ type: 'sender_domain', domain: 'old.com' }),
    priority: 'T3',
    categoryLabel: null,
    digestSummaryTemplate: 'Old: {subject}',
    notes: null,
    source: 'taught',
    pendingSuggestion: JSON.stringify({
      trigger: { type: 'sender_domain', domain: 'improved.com' },
      priority: 'T2',
      digestSummaryTemplate: 'New: {subject}',
      reason: 'Trigger was too broad',
    }),
    ...overrides,
  };
}

describe('RuleHealthPanel', () => {
  it('renders nothing when suggestions list is empty', () => {
    const { container } = render(
      <RuleHealthPanel suggestions={[]} onAccept={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the Rule Health section heading when there are suggestions', () => {
    render(
      <RuleHealthPanel suggestions={[makeRule()]} onAccept={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(screen.getByText('Rule Health')).toBeInTheDocument();
  });

  it('shows a count badge equal to the number of suggestions', () => {
    render(
      <RuleHealthPanel suggestions={[makeRule(), makeRule({ id: 'rule-2' })]} onAccept={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows the current trigger description', () => {
    render(
      <RuleHealthPanel suggestions={[makeRule()]} onAccept={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(screen.getByText('From @old.com')).toBeInTheDocument();
  });

  it('shows the proposed trigger when it differs from the current', () => {
    render(
      <RuleHealthPanel suggestions={[makeRule()]} onAccept={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(screen.getByText('From @improved.com')).toBeInTheDocument();
  });

  it('shows the proposed template when it differs from the current', () => {
    render(
      <RuleHealthPanel suggestions={[makeRule()]} onAccept={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(screen.getByText('New: {subject}')).toBeInTheDocument();
  });

  it('shows the reason text', () => {
    render(
      <RuleHealthPanel suggestions={[makeRule()]} onAccept={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(screen.getByText('Trigger was too broad')).toBeInTheDocument();
  });

  it('shows "No field changes" when trigger, priority, and template are all unchanged', () => {
    const suggestion = JSON.stringify({
      trigger: { type: 'sender_domain', domain: 'old.com' },
      priority: 'T3',
      digestSummaryTemplate: 'Old: {subject}',
      reason: 'Looks fine actually',
    });
    render(
      <RuleHealthPanel
        suggestions={[makeRule({ pendingSuggestion: suggestion })]}
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('No field changes — see reason below')).toBeInTheDocument();
  });

  it('calls onAccept with the rule id when Accept is clicked', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(
      <RuleHealthPanel suggestions={[makeRule()]} onAccept={onAccept} onDismiss={vi.fn()} />,
    );
    await user.click(screen.getByText('Accept'));
    expect(onAccept).toHaveBeenCalledWith('rule-1');
  });

  it('calls onDismiss with the rule id when Dismiss is clicked', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <RuleHealthPanel suggestions={[makeRule()]} onAccept={vi.fn()} onDismiss={onDismiss} />,
    );
    await user.click(screen.getByText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledWith('rule-1');
  });

  it('renders gracefully when pendingSuggestion is invalid JSON', () => {
    render(
      <RuleHealthPanel
        suggestions={[makeRule({ pendingSuggestion: 'not-json' })]}
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    // Component renders without throwing; no proposed fields shown since parse returned {}
    expect(screen.getByText('Rule Health')).toBeInTheDocument();
    expect(screen.getByText('No field changes — see reason below')).toBeInTheDocument();
  });

  it('renders one card per suggestion', () => {
    const rules = [
      makeRule({ id: 'r1' }),
      makeRule({ id: 'r2', trigger: JSON.stringify({ type: 'sender', sender: 'bob@example.com' }) }),
    ];
    render(<RuleHealthPanel suggestions={rules} onAccept={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getAllByText('Accept')).toHaveLength(2);
  });
});

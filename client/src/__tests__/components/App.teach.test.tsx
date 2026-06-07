import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import type { DecisionWithThread } from '../../api';

vi.mock('../../api', () => ({
  api: {
    getStatus: vi.fn(),
    getUnreadCount: vi.fn(),
    getThreads: vi.fn(),
    getDecisions: vi.fn(),
    getThread: vi.fn(),
    teachMessage: vi.fn(),
    saveRule: vi.fn(),
    applyRule: vi.fn(),
    misclassifiedDecision: vi.fn(),
  },
}));

import { api } from '../../api';
const mockApi = vi.mocked(api);

const EMPTY = { T1: [], T2: [], T3: [], T4: [], T5: [] };

// An unclassified (T5) decision — the teach flow is now reached by teaching a
// T5 item: open the T5 panel, click Teach, pick the correct tier.
const T5_DECISION: DecisionWithThread = {
  decisionId: 'd1',
  threadId: 't1',
  priority: 'T5',
  categoryLabel: null,
  digestSummary: 'Unclassified',
  decidedAt: '2024-01-01T00:00:00Z',
  confirmedByUser: false,
  userFlagged: false,
  thread: {
    subject: 'Invoice #1234',
    sender: 'Acme Billing <billing@acme.com>',
    date: '2024-01-01T00:00:00Z',
    snippet: 'Your invoice is ready',
    unreadCount: 1,
    messageCount: 1,
  },
};

// An assistant reply that embeds a rule proposal
const PROPOSAL_RESPONSE = `Here is a rule I propose.
RULE_PROPOSAL:
{"trigger":{"type":"sender_domain","domain":"acme.com"},"action":"digest","priority":"T3","digestSummaryTemplate":"Invoice from {sender}"}
Does that look right?`;

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.getStatus.mockResolvedValue({ authenticated: true });
  mockApi.getUnreadCount.mockResolvedValue({ count: 0 });
  mockApi.getThreads.mockResolvedValue({ threads: [] });
  mockApi.getDecisions.mockResolvedValue({ ...EMPTY, T5: [T5_DECISION] });
  mockApi.getThread.mockResolvedValue({ id: 't1', messages: [] });
  mockApi.saveRule.mockResolvedValue({ ruleId: 'r1', matchingThreads: [] });
  mockApi.applyRule.mockResolvedValue({ ok: true, applied: 1 });
  mockApi.misclassifiedDecision.mockResolvedValue({ ok: true, threadId: 't1' });
});

// Open the T5 panel, click the item's Teach button, and pick the correct tier —
// which opens the TeachPanel with that tier as context.
async function openTeachPanel(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByText('T5 Unclassified')).toBeInTheDocument());
  await user.click(screen.getByText('T5 Unclassified'));
  await waitFor(() => expect(screen.getByText('Invoice #1234')).toBeInTheDocument());
  await user.click(screen.getByText('Teach'));
  await user.click(screen.getByLabelText('Move to T3'));
}

describe('TeachPanel open + conversation', () => {
  it('opens the panel and sends an initial teach request, showing the assistant reply', async () => {
    const user = userEvent.setup();
    mockApi.teachMessage.mockResolvedValueOnce({ response: 'What should I do with this email?' });
    render(<App />);
    await openTeachPanel(user);

    await waitFor(() => expect(screen.getByText('What should I do with this email?')).toBeInTheDocument());
    // Initial request carries the thread context and an empty message history
    expect(mockApi.teachMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [],
        threadContext: expect.objectContaining({ subject: 'Invoice #1234', threadId: 't1' }),
      }),
    );
  });

  it('sends a typed message and appends the new assistant reply', async () => {
    const user = userEvent.setup();
    mockApi.teachMessage
      .mockResolvedValueOnce({ response: 'Tell me more.' })
      .mockResolvedValueOnce({ response: 'Got it, thanks.' });
    render(<App />);
    await openTeachPanel(user);
    await waitFor(() => expect(screen.getByText('Tell me more.')).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText(/Type a message/), 'Treat acme as T3');
    await user.click(screen.getByText('Send'));

    await waitFor(() => expect(screen.getByText('Got it, thanks.')).toBeInTheDocument());
    // Second call includes the user's message in history
    expect(mockApi.teachMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([{ role: 'user', content: 'Treat acme as T3' }]),
      }),
    );
  });

  it('shows an error message when the initial teach request fails', async () => {
    const user = userEvent.setup();
    mockApi.teachMessage.mockRejectedValueOnce(new Error('Agent unavailable'));
    render(<App />);
    await openTeachPanel(user);

    await waitFor(() => expect(screen.getByText('Agent unavailable')).toBeInTheDocument());
  });

  it('closes the panel when the close button is clicked', async () => {
    const user = userEvent.setup();
    mockApi.teachMessage.mockResolvedValueOnce({ response: 'Hello there' });
    render(<App />);
    await openTeachPanel(user);
    await waitFor(() => expect(screen.getByText('Hello there')).toBeInTheDocument());

    await user.click(screen.getByLabelText('Close teach panel'));
    await waitFor(() => expect(screen.queryByText('Hello there')).not.toBeInTheDocument());
  });
});

describe('TeachPanel rule proposal flow', () => {
  it('renders a proposal card with the described trigger, priority and template', async () => {
    const user = userEvent.setup();
    mockApi.teachMessage.mockResolvedValueOnce({ response: PROPOSAL_RESPONSE });
    render(<App />);
    await openTeachPanel(user);

    await waitFor(() => expect(screen.getByText('From @acme.com')).toBeInTheDocument());
    // "T3 Summarized" also appears as a background digest-panel label, so scope to the teach panel
    const panel = screen.getByLabelText('Close teach panel').closest('.fixed') as HTMLElement;
    expect(within(panel).getByText('T3 Summarized')).toBeInTheDocument();
    expect(screen.getByText('Invoice from {sender}')).toBeInTheDocument();
    // The surrounding prose is preserved
    expect(screen.getByText('Here is a rule I propose.')).toBeInTheDocument();
    expect(screen.getByText('Does that look right?')).toBeInTheDocument();
    // The interactive controls are present
    expect(screen.getByText('Confirm rule')).toBeInTheDocument();
    expect(screen.getByText('Revise')).toBeInTheDocument();
  });

  it('confirming a rule saves it and shows the matching threads to apply', async () => {
    const user = userEvent.setup();
    mockApi.teachMessage.mockResolvedValueOnce({ response: PROPOSAL_RESPONSE });
    mockApi.saveRule.mockResolvedValueOnce({
      ruleId: 'r1',
      matchingThreads: [{ threadId: 't1', subject: 'Invoice #1234', sender: 'Acme', date: '', snippet: '' }],
    });
    render(<App />);
    await openTeachPanel(user);
    await waitFor(() => expect(screen.getByText('Confirm rule')).toBeInTheDocument());

    await user.click(screen.getByText('Confirm rule'));

    expect(mockApi.saveRule).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'T3', trigger: '{"type":"sender_domain","domain":"acme.com"}' }),
    );
    await waitFor(() => expect(screen.getByText('Found 1 matching thread.')).toBeInTheDocument());
    expect(screen.getByText('Apply to 1 thread')).toBeInTheDocument();
  });

  it('applying the rule to selected threads calls api.applyRule and shows a done message', async () => {
    const user = userEvent.setup();
    mockApi.teachMessage.mockResolvedValueOnce({ response: PROPOSAL_RESPONSE });
    mockApi.saveRule.mockResolvedValueOnce({
      ruleId: 'r1',
      matchingThreads: [{ threadId: 't1', subject: 'Invoice #1234', sender: 'Acme', date: '', snippet: '' }],
    });
    mockApi.applyRule.mockResolvedValueOnce({ ok: true, applied: 1 });
    render(<App />);
    await openTeachPanel(user);
    await waitFor(() => expect(screen.getByText('Confirm rule')).toBeInTheDocument());
    await user.click(screen.getByText('Confirm rule'));
    await waitFor(() => expect(screen.getByText('Apply to 1 thread')).toBeInTheDocument());

    await user.click(screen.getByText('Apply to 1 thread'));

    expect(mockApi.applyRule).toHaveBeenCalledWith('r1', ['t1']);
    await waitFor(() => expect(screen.getByText(/Applied to 1 thread/)).toBeInTheDocument());
  });

  it('shows the no-matches notice when the saved rule matches nothing', async () => {
    const user = userEvent.setup();
    mockApi.teachMessage.mockResolvedValueOnce({ response: PROPOSAL_RESPONSE });
    mockApi.saveRule.mockResolvedValueOnce({ ruleId: 'r1', matchingThreads: [] });
    render(<App />);
    await openTeachPanel(user);
    await waitFor(() => expect(screen.getByText('Confirm rule')).toBeInTheDocument());

    await user.click(screen.getByText('Confirm rule'));

    await waitFor(() => expect(screen.getByText(/no matching threads were found/)).toBeInTheDocument());
  });

  it('skipping after confirm saves the rule only and shows a saved message', async () => {
    const user = userEvent.setup();
    mockApi.teachMessage.mockResolvedValueOnce({ response: PROPOSAL_RESPONSE });
    mockApi.saveRule.mockResolvedValueOnce({
      ruleId: 'r1',
      matchingThreads: [{ threadId: 't1', subject: 'Invoice #1234', sender: 'Acme', date: '', snippet: '' }],
    });
    render(<App />);
    await openTeachPanel(user);
    await waitFor(() => expect(screen.getByText('Confirm rule')).toBeInTheDocument());
    await user.click(screen.getByText('Confirm rule'));
    await waitFor(() => expect(screen.getByText('Skip — save rule only')).toBeInTheDocument());

    await user.click(screen.getByText('Skip — save rule only'));

    await waitFor(() => expect(screen.getByText('Rule saved.')).toBeInTheDocument());
    expect(mockApi.applyRule).not.toHaveBeenCalled();
  });

  it('receiving a revised proposal resets rule phase so the new proposal can be confirmed', async () => {
    const user = userEvent.setup();
    const REVISED_RESPONSE = `I've updated the rule.
RULE_PROPOSAL:
{"trigger":{"type":"sender_domain","domain":"acme.com"},"action":"digest","priority":"T2","digestSummaryTemplate":"Updated: {subject}"}
Better?`;
    mockApi.teachMessage
      .mockResolvedValueOnce({ response: PROPOSAL_RESPONSE })
      .mockResolvedValueOnce({ response: REVISED_RESPONSE });
    render(<App />);
    await openTeachPanel(user);
    await waitFor(() => expect(screen.getByText('Revise')).toBeInTheDocument());

    await user.click(screen.getByText('Revise'));

    // The new proposal replaces the old one — rule-phase was reset so Confirm rule is actionable
    await waitFor(() => expect(screen.getByText('Updated: {subject}')).toBeInTheDocument());
    expect(screen.getAllByText('Confirm rule')).not.toHaveLength(0);
  });

  it('shows an error and restores the thread list when applying the rule fails', async () => {
    const user = userEvent.setup();
    mockApi.teachMessage.mockResolvedValueOnce({ response: PROPOSAL_RESPONSE });
    mockApi.saveRule.mockResolvedValueOnce({
      ruleId: 'r1',
      matchingThreads: [{ threadId: 't1', subject: 'Invoice #1234', sender: 'Acme', date: '', snippet: '' }],
    });
    mockApi.applyRule.mockRejectedValueOnce(new Error('Apply failed'));
    render(<App />);
    await openTeachPanel(user);
    await waitFor(() => expect(screen.getByText('Confirm rule')).toBeInTheDocument());
    await user.click(screen.getByText('Confirm rule'));
    await waitFor(() => expect(screen.getByText('Apply to 1 thread')).toBeInTheDocument());

    await user.click(screen.getByText('Apply to 1 thread'));

    await waitFor(() => expect(screen.getByText('Apply failed')).toBeInTheDocument());
    // rulePhase restored to 'threads' — the thread list and Apply button are still present
    expect(screen.getByText('Apply to 1 thread')).toBeInTheDocument();
  });
});

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
    confirmDecision: vi.fn(),
    doneDecision: vi.fn(),
    followupDecision: vi.fn(),
    misclassifiedDecision: vi.fn(),
    confirmAll: vi.fn(),
    teachMessage: vi.fn(),
    saveRule: vi.fn(),
    applyRule: vi.fn(),
  },
}));

import { api } from '../../api';
const mockApi = vi.mocked(api);

const EMPTY = { T1: [], T2: [], T3: [], T4: [] };

function decision(overrides: Partial<DecisionWithThread> & { decisionId: string; threadId: string; priority: string }): DecisionWithThread {
  return {
    categoryLabel: null,
    digestSummary: 'A digest summary',
    decidedAt: '2024-01-01T00:00:00Z',
    confirmedByUser: false,
    userFlagged: false,
    thread: {
      subject: 'Thread subject',
      sender: 'Alice <alice@example.com>',
      date: '2024-01-01T00:00:00Z',
      snippet: 'thread snippet',
      unreadCount: 0,
      messageCount: 1,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.getStatus.mockResolvedValue({ authenticated: true });
  mockApi.getUnreadCount.mockResolvedValue({ count: 0 });
  mockApi.getThreads.mockResolvedValue({ threads: [] });
  mockApi.getThread.mockResolvedValue({ id: 'x', messages: [] });
  mockApi.getDecisions.mockResolvedValue(EMPTY);
  mockApi.confirmDecision.mockResolvedValue({ ok: true });
  mockApi.doneDecision.mockResolvedValue({ ok: true });
  mockApi.followupDecision.mockResolvedValue({ ok: true });
  mockApi.misclassifiedDecision.mockResolvedValue({ ok: true, threadId: 't1' });
  mockApi.confirmAll.mockResolvedValue({ ok: true, processed: 1 });
  mockApi.teachMessage.mockResolvedValue({ response: 'ok' });
  mockApi.saveRule.mockResolvedValue({ ruleId: 'r1', matchingThreads: [] });
  mockApi.applyRule.mockResolvedValue({ ok: true, applied: 0 });
});

describe('MainApp decision handlers', () => {
  it('confirming a T1 item calls api.confirmDecision and fades the row', async () => {
    const user = userEvent.setup();
    mockApi.getDecisions.mockResolvedValue({
      ...EMPTY,
      T1: [decision({ decisionId: 'd1', threadId: 't1', priority: 'T1', digestSummary: 'Pay the bill' })],
    });
    const { container } = render(<App />);
    // T1 panel is open by default
    await waitFor(() => expect(screen.getByText('Pay the bill')).toBeInTheDocument());

    await user.click(screen.getByText('Confirm'));

    expect(mockApi.confirmDecision).toHaveBeenCalledWith('d1');
    await waitFor(() => expect(container.querySelector('.opacity-50')).toBeInTheDocument());
  });

  it('marking a T1 item Done calls api.doneDecision and removes the row', async () => {
    const user = userEvent.setup();
    mockApi.getDecisions.mockResolvedValue({
      ...EMPTY,
      T1: [decision({ decisionId: 'd1', threadId: 't1', priority: 'T1', digestSummary: 'Pay the bill' })],
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Pay the bill')).toBeInTheDocument());

    await user.click(screen.getByText('Done'));

    expect(mockApi.doneDecision).toHaveBeenCalledWith('d1');
    await waitFor(() => expect(screen.queryByText('Pay the bill')).not.toBeInTheDocument());
  });

  it('marking a T1 item Wrong and picking a tier opens teach with the correct-tier userContext', async () => {
    const user = userEvent.setup();
    mockApi.getDecisions.mockResolvedValue({
      ...EMPTY,
      T1: [decision({ decisionId: 'd1', threadId: 'tX', priority: 'T1', digestSummary: 'Wrongly classified', thread: { subject: 'Mis-tiered', sender: 'Alice <a@b.com>', date: '2024-01-01T00:00:00Z', snippet: 'snip', unreadCount: 0, messageCount: 1 } })],
    });
    mockApi.teachMessage.mockResolvedValue({ response: 'Here is my hypothesis.' });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Wrongly classified')).toBeInTheDocument());

    await user.click(screen.getByText('Wrong'));
    await user.click(screen.getByLabelText('Move to T3'));

    // Picking a tier alone must not archive yet — that happens on rule save
    expect(mockApi.misclassifiedDecision).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mockApi.teachMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          threadContext: expect.objectContaining({ threadId: 'tX' }),
          userContext: expect.stringContaining('T3'),
        }),
      ),
    );
  });

  it('confirming a re-taught rule archives the original decision before saving', async () => {
    const user = userEvent.setup();
    mockApi.getDecisions.mockResolvedValue({
      ...EMPTY,
      T1: [decision({ decisionId: 'd1', threadId: 'tX', priority: 'T1', digestSummary: 'Wrongly classified' })],
    });
    mockApi.teachMessage.mockResolvedValue({
      response: 'RULE_PROPOSAL:\n{"trigger":{"type":"sender_domain","domain":"a.com"},"action":"digest","priority":"T3","digestSummaryTemplate":"{subject}"}',
    });
    mockApi.saveRule.mockResolvedValue({ ruleId: 'r1', matchingThreads: [] });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Wrongly classified')).toBeInTheDocument());

    await user.click(screen.getByText('Wrong'));
    await user.click(screen.getByLabelText('Move to T3'));
    await waitFor(() => expect(screen.getByText('Confirm rule')).toBeInTheDocument());
    await user.click(screen.getByText('Confirm rule'));

    await waitFor(() => expect(mockApi.misclassifiedDecision).toHaveBeenCalledWith('d1'));
    expect(mockApi.saveRule).toHaveBeenCalled();
  });

  it('Confirm all on T1 calls api.confirmAll with only the unconfirmed decision IDs', async () => {
    const user = userEvent.setup();
    mockApi.getDecisions.mockResolvedValue({
      ...EMPTY,
      T1: [
        decision({ decisionId: 'd1', threadId: 't1', priority: 'T1', digestSummary: 'first', confirmedByUser: false }),
        decision({ decisionId: 'd2', threadId: 't2', priority: 'T1', digestSummary: 'second', confirmedByUser: true }),
      ],
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText('first')).toBeInTheDocument());

    await user.click(screen.getByText('Confirm all'));

    expect(mockApi.confirmAll).toHaveBeenCalledWith(['d1'], 'T1');
  });

  it('Confirm all on T3 calls api.confirmAll and removes items from the panel', async () => {
    const user = userEvent.setup();
    mockApi.getDecisions.mockResolvedValue({
      ...EMPTY,
      T3: [
        decision({ decisionId: 'd1', threadId: 't1', priority: 'T3', digestSummary: 'summary one' }),
        decision({ decisionId: 'd2', threadId: 't2', priority: 'T3', digestSummary: 'summary two' }),
      ],
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText('T3 Summarized')).toBeInTheDocument());
    await user.click(screen.getByText('T3 Summarized'));
    await waitFor(() => expect(screen.getByText('summary one')).toBeInTheDocument());

    await user.click(screen.getByText('Confirm all'));

    expect(mockApi.confirmAll).toHaveBeenCalledWith(['d1', 'd2'], 'T3');
    await waitFor(() => expect(screen.queryByText('summary one')).not.toBeInTheDocument());
    expect(screen.queryByText('summary two')).not.toBeInTheDocument();
  });

  it('followed-up item lands in date-sorted position in T2, not prepended at top', async () => {
    const user = userEvent.setup();
    mockApi.getDecisions.mockResolvedValue({
      ...EMPTY,
      T2: [
        decision({ decisionId: 'd-old', threadId: 't-old', priority: 'T2', thread: { subject: 'Old', sender: 'Old <old@example.com>', date: '2024-01-01T00:00:00Z', snippet: '', unreadCount: 0, messageCount: 1 } }),
        decision({ decisionId: 'd-new', threadId: 't-new', priority: 'T2', thread: { subject: 'New', sender: 'New <new@example.com>', date: '2024-12-01T00:00:00Z', snippet: '', unreadCount: 0, messageCount: 1 } }),
      ],
      T3: [
        decision({ decisionId: 'd-mid', threadId: 't-mid', priority: 'T3', digestSummary: 'Mid item', thread: { subject: 'Mid', sender: 'Mid <mid@example.com>', date: '2024-06-01T00:00:00Z', snippet: '', unreadCount: 0, messageCount: 1 } }),
      ],
    });
    render(<App />);

    // Open T3 and follow up the item
    await waitFor(() => expect(screen.getByText('T3 Summarized')).toBeInTheDocument());
    await user.click(screen.getByText('T3 Summarized'));
    await waitFor(() => expect(screen.getByText('Mid item')).toBeInTheDocument());
    await user.click(screen.getByText('Followup'));
    const noteInput = screen.getByLabelText('Followup note');
    await user.click(within(noteInput.closest('div')!).getByText('Confirm'));

    // Open T2 and check that items appear oldest-first (Old, Mid, New)
    await waitFor(() => expect(screen.getByText('T2 Action Required')).toBeInTheDocument());
    await user.click(screen.getByText('T2 Action Required'));
    await waitFor(() => {
      const senders = screen.getAllByText(/Old|Mid|New/).map((el) => el.textContent);
      const oldIdx = senders.findIndex((s) => s?.includes('Old'));
      const midIdx = senders.findIndex((s) => s?.includes('Mid'));
      const newIdx = senders.findIndex((s) => s?.includes('New'));
      expect(oldIdx).toBeLessThan(midIdx);
      expect(midIdx).toBeLessThan(newIdx);
    });
  });

  it('following up a T3 item calls api.followupDecision and removes it from the T3 panel', async () => {
    const user = userEvent.setup();
    mockApi.getDecisions.mockResolvedValue({
      ...EMPTY,
      T3: [decision({ decisionId: 'd1', threadId: 't1', priority: 'T3', digestSummary: 'Summarized item' })],
    });
    render(<App />);
    // T3 panel is collapsed by default — open it
    await waitFor(() => expect(screen.getByText('T3 Summarized')).toBeInTheDocument());
    await user.click(screen.getByText('T3 Summarized'));

    await waitFor(() => expect(screen.getByText('Summarized item')).toBeInTheDocument());
    await user.click(screen.getByText('Followup'));
    const noteInput = screen.getByLabelText('Followup note');
    await user.click(within(noteInput.closest('div')!).getByText('Confirm'));

    // Note is prefilled with the thread subject and passed through to the API
    expect(mockApi.followupDecision).toHaveBeenCalledWith('d1', 'Thread subject');
    await waitFor(() => expect(screen.queryByText('Summarized item')).not.toBeInTheDocument());
  });
});

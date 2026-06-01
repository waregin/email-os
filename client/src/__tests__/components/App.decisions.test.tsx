import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

  it('marking a T1 item Wrong calls api.misclassifiedDecision and fetches the thread back into the inbox', async () => {
    const user = userEvent.setup();
    mockApi.getDecisions.mockResolvedValue({
      ...EMPTY,
      T1: [decision({ decisionId: 'd1', threadId: 'tX', priority: 'T1', digestSummary: 'Wrongly classified' })],
    });
    // Thread is not in the inbox list, so handleMisclassified should fetch it
    mockApi.getThread.mockResolvedValue({
      id: 'tX',
      messages: [{
        id: 'm1', sender: 'Alice <a@b.com>', toRecipients: [], date: '2024-01-01T00:00:00Z',
        subject: 'Recovered', snippet: 'snip', htmlBody: null, plaintextBody: 'body', isUnread: false, labelIds: [],
      }],
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Wrongly classified')).toBeInTheDocument());

    await user.click(screen.getByText('Wrong'));

    expect(mockApi.misclassifiedDecision).toHaveBeenCalledWith('d1');
    await waitFor(() => expect(mockApi.getThread).toHaveBeenCalledWith('tX'));
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

    expect(mockApi.followupDecision).toHaveBeenCalledWith('d1');
    await waitFor(() => expect(screen.queryByText('Summarized item')).not.toBeInTheDocument());
  });
});

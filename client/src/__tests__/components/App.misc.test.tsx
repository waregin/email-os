import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import type { DecisionWithThread } from '../../api';

vi.mock('../../api', () => ({
  api: {
    getStatus: vi.fn(),
    getUnreadCount: vi.fn(),
    getDecisions: vi.fn(),
    getThread: vi.fn(),
    teachMessage: vi.fn(),
    saveRule: vi.fn(),
    applyRule: vi.fn(),
    misclassifiedDecision: vi.fn(),
    getRulesWithSuggestions: vi.fn(),
  },
}));

import { api } from '../../api';
const mockApi = vi.mocked(api);

const EMPTY = { T1: [], T2: [], T3: [], T4: [], T5: [] };

function t5Decision(subject: string): DecisionWithThread {
  return {
    decisionId: 'd1', threadId: 't1', priority: 'T5', categoryLabel: null,
    digestSummary: 'Unclassified', decidedAt: '2024-01-01T00:00:00Z',
    confirmedByUser: false, userFlagged: false,
    thread: { subject, sender: 'Acme <billing@acme.com>', date: '2024-01-01T00:00:00Z', snippet: 'snippet', unreadCount: 1, messageCount: 1 },
  };
}

// Open the T5 panel, click the item's Teach button, and pick a tier — which
// opens the TeachPanel.
async function teachT5Item(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByText('T5 Unclassified')).toBeInTheDocument());
  await user.click(screen.getByText('T5 Unclassified'));
  await user.click(screen.getByText('Teach'));
  await user.click(screen.getByLabelText('Move to T3'));
}

const PROPOSAL_RESPONSE = `Proposed.
RULE_PROPOSAL:
{"trigger":{"type":"sender_domain","domain":"acme.com"},"action":"digest","priority":"T3","digestSummaryTemplate":"Invoice"}
Ok?`;

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.getStatus.mockResolvedValue({ authenticated: true });
  mockApi.getUnreadCount.mockResolvedValue({ count: 0 });
  mockApi.getDecisions.mockResolvedValue(EMPTY);
  mockApi.getRulesWithSuggestions.mockResolvedValue([]);
  mockApi.getThread.mockResolvedValue({ id: 'x', messages: [] });
  mockApi.misclassifiedDecision.mockResolvedValue({ ok: true, threadId: 't1' });
});

afterEach(() => {
  document.title = '';
  document.querySelectorAll('link[rel="icon"]').forEach((l) => l.remove());
});

describe('favicon badge', () => {
  it('writes an SVG data-URL favicon with the unread count', async () => {
    const link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);

    mockApi.getStatus.mockResolvedValueOnce({ authenticated: true });
    mockApi.getUnreadCount.mockResolvedValue({ count: 7 });
    render(<App />);

    await waitFor(() => expect(link.href).toContain('data:image/svg+xml'));
    // The count is rendered into the SVG text (URL-encoded)
    expect(decodeURIComponent(link.href)).toContain('>7<');
  });

  it('caps the badge label at "100+" for large counts', async () => {
    const link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);

    mockApi.getStatus.mockResolvedValueOnce({ authenticated: true });
    mockApi.getUnreadCount.mockResolvedValue({ count: 150 });
    render(<App />);

    await waitFor(() => expect(link.href).toContain('data:image/svg+xml'));
    expect(decodeURIComponent(link.href)).toContain('100+');
  });
});

describe('TeachPanel revise and error paths', () => {
  it('clicking Revise sends a revision request to the agent', async () => {
    const user = userEvent.setup();
    mockApi.getDecisions.mockResolvedValue({ ...EMPTY, T5: [t5Decision('Invoice')] });
    mockApi.teachMessage
      .mockResolvedValueOnce({ response: PROPOSAL_RESPONSE })
      .mockResolvedValueOnce({ response: 'Revised version coming up.' });
    render(<App />);
    await teachT5Item(user);
    await waitFor(() => expect(screen.getByText('Revise')).toBeInTheDocument());

    await user.click(screen.getByText('Revise'));

    expect(mockApi.teachMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([{ role: 'user', content: 'Please revise the rule' }]),
      }),
    );
  });

  it('shows an error and keeps the proposal actionable when saving the rule fails', async () => {
    const user = userEvent.setup();
    mockApi.getDecisions.mockResolvedValue({ ...EMPTY, T5: [t5Decision('Invoice')] });
    mockApi.teachMessage.mockResolvedValueOnce({ response: PROPOSAL_RESPONSE });
    mockApi.saveRule.mockRejectedValueOnce(new Error('Save failed'));
    render(<App />);
    await teachT5Item(user);
    await waitFor(() => expect(screen.getByText('Confirm rule')).toBeInTheDocument());

    await user.click(screen.getByText('Confirm rule'));

    await waitFor(() => expect(screen.getByText('Save failed')).toBeInTheDocument());
  });
});

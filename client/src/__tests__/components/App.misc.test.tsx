import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import type { Thread } from '../../api';

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
  },
}));

import { api } from '../../api';
const mockApi = vi.mocked(api);

const EMPTY = { T1: [], T2: [], T3: [], T4: [] };

function thread(id: string, subject: string): Thread {
  return {
    id, snippet: 'snippet', subject, sender: 'Acme <billing@acme.com>',
    date: '2024-01-01T00:00:00Z', isUnread: true, unreadCount: 1,
  };
}

const PROPOSAL_RESPONSE = `Proposed.
RULE_PROPOSAL:
{"trigger":{"type":"sender_domain","domain":"acme.com"},"action":"digest","priority":"T3","digestSummaryTemplate":"Invoice"}
Ok?`;

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.getStatus.mockResolvedValue({ authenticated: true });
  mockApi.getUnreadCount.mockResolvedValue({ count: 0 });
  mockApi.getThreads.mockResolvedValue({ threads: [] });
  mockApi.getDecisions.mockResolvedValue(EMPTY);
  mockApi.getThread.mockResolvedValue({ id: 'x', messages: [] });
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

describe('inbox pagination', () => {
  it('loads the next page of threads when "Load More" is clicked', async () => {
    const user = userEvent.setup();
    mockApi.getThreads
      .mockResolvedValueOnce({ threads: [thread('t1', 'First page')], nextPageToken: 'tok' })
      .mockResolvedValueOnce({ threads: [thread('t2', 'Second page')], nextPageToken: undefined });
    render(<App />);
    await waitFor(() => expect(screen.getByText('First page')).toBeInTheDocument());

    await user.click(screen.getByText('LOAD MORE…'));

    await waitFor(() => expect(screen.getByText('Second page')).toBeInTheDocument());
    expect(mockApi.getThreads).toHaveBeenLastCalledWith(
      expect.objectContaining({ pageToken: 'tok', undecided: true }),
    );
  });
});

describe('TeachPanel revise and error paths', () => {
  it('clicking Revise sends a revision request to the agent', async () => {
    const user = userEvent.setup();
    mockApi.getThreads.mockResolvedValue({ threads: [thread('t1', 'Invoice')] });
    mockApi.teachMessage
      .mockResolvedValueOnce({ response: PROPOSAL_RESPONSE })
      .mockResolvedValueOnce({ response: 'Revised version coming up.' });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Invoice')).toBeInTheDocument());
    await user.click(screen.getByText('Teach'));
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
    mockApi.getThreads.mockResolvedValue({ threads: [thread('t1', 'Invoice')] });
    mockApi.teachMessage.mockResolvedValueOnce({ response: PROPOSAL_RESPONSE });
    mockApi.saveRule.mockRejectedValueOnce(new Error('Save failed'));
    render(<App />);
    await waitFor(() => expect(screen.getByText('Invoice')).toBeInTheDocument());
    await user.click(screen.getByText('Teach'));
    await waitFor(() => expect(screen.getByText('Confirm rule')).toBeInTheDocument());

    await user.click(screen.getByText('Confirm rule'));

    await waitFor(() => expect(screen.getByText('Save failed')).toBeInTheDocument());
  });
});

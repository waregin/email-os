import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import App from '../../App';

vi.mock('../../api', () => ({
  api: {
    getStatus: vi.fn(),
    getUnreadCount: vi.fn(),
    getDecisions: vi.fn(),
    getThread: vi.fn(),
  },
}));

import { api } from '../../api';
const mockApi = vi.mocked(api);

const EMPTY_DECISIONS = { T1: [], T2: [], T3: [], T4: [], T5: [] };

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults; individual tests override getStatus
  mockApi.getUnreadCount.mockResolvedValue({ count: 0 });
  mockApi.getDecisions.mockResolvedValue(EMPTY_DECISIONS);
});

afterEach(() => {
  document.title = '';
});

describe('App authentication state', () => {
  it('shows a loading state on initial render before status resolves', () => {
    mockApi.getStatus.mockReturnValueOnce(new Promise(() => {})); // never resolves
    render(<App />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders the login screen when unauthenticated', async () => {
    mockApi.getStatus.mockResolvedValueOnce({ authenticated: false });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('Sign in with Google')).toBeInTheDocument();
    });
    const link = screen.getByText('Sign in with Google').closest('a');
    expect(link).toHaveAttribute('href', '/auth/google');
  });

  it('renders the login screen when the status check rejects', async () => {
    mockApi.getStatus.mockRejectedValueOnce(new Error('network'));
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('Sign in with Google')).toBeInTheDocument();
    });
  });

  it('renders the digest when authenticated, with no inbox section', async () => {
    mockApi.getStatus.mockResolvedValueOnce({ authenticated: true });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('Digest')).toBeInTheDocument();
    });
    expect(screen.getByText('T1 Immediate Attention')).toBeInTheDocument();
    // The inbox section was removed in Phase 6 — unclassified threads live in T5 now
    expect(screen.queryByText(/^Inbox/)).not.toBeInTheDocument();
  });
});

describe('App T5 Unclassified panel', () => {
  const t5Decision = {
    decisionId: 'd5', threadId: 't5', priority: 'T5', categoryLabel: null,
    digestSummary: 'Unclassified', decidedAt: '2024-01-01T00:00:00Z',
    confirmedByUser: false, userFlagged: false,
    thread: { subject: 'Mystery email', sender: 'a@b.com', date: '2024-01-01T00:00:00Z', snippet: 'snip', unreadCount: 0, messageCount: 1 },
  };

  it('does not render the T5 panel when there are no T5 decisions', async () => {
    mockApi.getStatus.mockResolvedValueOnce({ authenticated: true });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Digest')).toBeInTheDocument());
    expect(screen.queryByText('T5 Unclassified')).not.toBeInTheDocument();
  });

  it('renders the T5 panel when there are T5 decisions', async () => {
    mockApi.getStatus.mockResolvedValueOnce({ authenticated: true });
    mockApi.getDecisions.mockResolvedValue({ ...EMPTY_DECISIONS, T5: [t5Decision] });
    render(<App />);
    await waitFor(() => expect(screen.getByText('T5 Unclassified')).toBeInTheDocument());
  });
});

describe('App authenticated side effects', () => {
  it('fetches decisions on mount when authenticated', async () => {
    mockApi.getStatus.mockResolvedValueOnce({ authenticated: true });
    render(<App />);
    await waitFor(() => {
      expect(mockApi.getDecisions).toHaveBeenCalled();
    });
  });

  it('updates the document title with the unread count', async () => {
    mockApi.getStatus.mockResolvedValueOnce({ authenticated: true });
    mockApi.getUnreadCount.mockResolvedValue({ count: 5 });
    render(<App />);
    await waitFor(() => {
      expect(document.title).toBe('(5) Email OS');
    });
  });

  it('sets a plain title when there are no unread messages', async () => {
    mockApi.getStatus.mockResolvedValueOnce({ authenticated: true });
    mockApi.getUnreadCount.mockResolvedValue({ count: 0 });
    render(<App />);
    await waitFor(() => {
      expect(document.title).toBe('Email OS');
    });
  });
});

describe('App refresh button', () => {
  it('re-fetches decisions when clicked', async () => {
    mockApi.getStatus.mockResolvedValueOnce({ authenticated: true });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Digest')).toBeInTheDocument());

    // Ignore the initial mount fetch; only count what the click triggers
    mockApi.getDecisions.mockClear();

    fireEvent.click(screen.getByLabelText('Refresh'));

    await waitFor(() => {
      expect(mockApi.getDecisions).toHaveBeenCalled();
    });
  });

  it('disables the refresh button while a refresh is in flight', async () => {
    mockApi.getStatus.mockResolvedValueOnce({ authenticated: true });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Digest')).toBeInTheDocument());

    // Make the refresh fetch hang so the in-flight state persists
    mockApi.getDecisions.mockReturnValueOnce(new Promise(() => {}));

    const button = screen.getByLabelText('Refresh');
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
  });
});

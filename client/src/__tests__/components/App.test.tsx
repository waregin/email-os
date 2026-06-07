import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import App from '../../App';

vi.mock('../../api', () => ({
  api: {
    getStatus: vi.fn(),
    getUnreadCount: vi.fn(),
    getThreads: vi.fn(),
    getDecisions: vi.fn(),
    getThread: vi.fn(),
  },
}));

import { api } from '../../api';
const mockApi = vi.mocked(api);

const EMPTY_DECISIONS = { T1: [], T2: [], T3: [], T4: [] };

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults; individual tests override getStatus
  mockApi.getUnreadCount.mockResolvedValue({ count: 0 });
  mockApi.getThreads.mockResolvedValue({ threads: [] });
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

  it('renders the main app (digest + inbox) when authenticated', async () => {
    mockApi.getStatus.mockResolvedValueOnce({ authenticated: true });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('Digest')).toBeInTheDocument();
    });
    expect(screen.getByText('T1 Immediate Attention')).toBeInTheDocument();
    // Inbox section label is present (count appended once threads load)
    expect(screen.getByText(/^Inbox/)).toBeInTheDocument();
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
  it('re-fetches threads and decisions when clicked', async () => {
    mockApi.getStatus.mockResolvedValueOnce({ authenticated: true });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Digest')).toBeInTheDocument());

    // Ignore the initial mount fetches; only count what the click triggers
    mockApi.getThreads.mockClear();
    mockApi.getDecisions.mockClear();

    fireEvent.click(screen.getByLabelText('Refresh'));

    await waitFor(() => {
      expect(mockApi.getThreads).toHaveBeenCalledWith({ undecided: true });
      expect(mockApi.getDecisions).toHaveBeenCalled();
    });
  });

  it('disables the refresh button while a refresh is in flight', async () => {
    mockApi.getStatus.mockResolvedValueOnce({ authenticated: true });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Digest')).toBeInTheDocument());

    // Make the refresh fetches hang so the in-flight state persists
    mockApi.getThreads.mockReturnValueOnce(new Promise(() => {}));
    mockApi.getDecisions.mockReturnValueOnce(new Promise(() => {}));

    const button = screen.getByLabelText('Refresh');
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
  });
});

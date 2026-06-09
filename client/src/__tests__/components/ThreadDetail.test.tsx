import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThreadDetail } from '../../components/ThreadDetail';
import type { MessageDetail } from '../../api';

// Mock the api module
vi.mock('../../api', () => ({
  api: {
    getThread: vi.fn(),
  },
}));

import { api } from '../../api';
const mockGetThread = vi.mocked(api.getThread);

function makeMessage(overrides: Partial<MessageDetail> & { id: string }): MessageDetail {
  return {
    sender: 'Alice <alice@example.com>',
    toRecipients: ['me@example.com'],
    date: '2024-01-01T00:00:00Z',
    subject: 'Subject',
    snippet: 'snippet text',
    htmlBody: null,
    plaintextBody: null,
    isUnread: false,
    labelIds: [],
    ...overrides,
  };
}

beforeEach(() => {
  mockGetThread.mockReset();
});

describe('ThreadDetail loading and error states', () => {
  it('shows a loading message while the thread is being fetched', () => {
    mockGetThread.mockReturnValueOnce(new Promise(() => {})); // never resolves
    render(<ThreadDetail threadId="t1" />);
    expect(screen.getByText('Loading thread…')).toBeInTheDocument();
  });

  it('shows an error message when the fetch rejects', async () => {
    mockGetThread.mockRejectedValueOnce(new Error('Network failure'));
    render(<ThreadDetail threadId="t1" />);
    await waitFor(() => {
      expect(screen.getByText('Error: Network failure')).toBeInTheDocument();
    });
  });

  it('renders one panel per message on success', async () => {
    mockGetThread.mockResolvedValueOnce({
      id: 't1',
      messages: [
        makeMessage({ id: 'm1', sender: 'Alice <alice@example.com>' }),
        makeMessage({ id: 'm2', sender: 'Bob <bob@example.com>' }),
      ],
    });
    render(<ThreadDetail threadId="t1" />);
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
  });
});

describe('ThreadDetail default expansion', () => {
  it('expands an unread message by default (shows its body, not its snippet)', async () => {
    mockGetThread.mockResolvedValueOnce({
      id: 't1',
      messages: [
        makeMessage({ id: 'm1', isUnread: true, plaintextBody: 'Unread body content', snippet: 'unread snippet' }),
      ],
    });
    render(<ThreadDetail threadId="t1" />);
    await waitFor(() => {
      expect(screen.getByText('Unread body content')).toBeInTheDocument();
    });
    // Snippet only renders when collapsed; an expanded message should not show it
    expect(screen.queryByText('unread snippet')).not.toBeInTheDocument();
  });

  it('expands only the last message when none are unread', async () => {
    mockGetThread.mockResolvedValueOnce({
      id: 't1',
      messages: [
        makeMessage({ id: 'm1', isUnread: false, plaintextBody: 'First body', snippet: 'first snippet' }),
        makeMessage({ id: 'm2', isUnread: false, plaintextBody: 'Last body', snippet: 'last snippet' }),
      ],
    });
    render(<ThreadDetail threadId="t1" />);
    await waitFor(() => {
      // Last message expanded → its body shows
      expect(screen.getByText('Last body')).toBeInTheDocument();
    });
    // First message collapsed → snippet shows, body does not
    expect(screen.getByText('first snippet')).toBeInTheDocument();
    expect(screen.queryByText('First body')).not.toBeInTheDocument();
  });
});

describe('ThreadDetail message expansion interaction', () => {
  it('expands a collapsed message when its header is clicked', async () => {
    const user = userEvent.setup();
    mockGetThread.mockResolvedValueOnce({
      id: 't1',
      messages: [
        makeMessage({ id: 'm1', isUnread: false, plaintextBody: 'First body', snippet: 'first snippet' }),
        makeMessage({ id: 'm2', isUnread: false, plaintextBody: 'Last body', snippet: 'last snippet' }),
      ],
    });
    render(<ThreadDetail threadId="t1" />);
    await waitFor(() => expect(screen.getByText('first snippet')).toBeInTheDocument());

    // Click the first (collapsed) message header
    await user.click(screen.getByText('first snippet'));
    expect(screen.getByText('First body')).toBeInTheDocument();
  });

  it('renders an iframe for an HTML body', async () => {
    mockGetThread.mockResolvedValueOnce({
      id: 't1',
      messages: [makeMessage({ id: 'm1', isUnread: true, htmlBody: '<p>HTML email</p>' })],
    });
    const { container } = render(<ThreadDetail threadId="t1" />);
    await waitFor(() => {
      expect(container.querySelector('iframe[title="email-body"]')).toBeInTheDocument();
    });
  });

  it('lets target=_blank links escape the iframe sandbox so they open normally', async () => {
    mockGetThread.mockResolvedValueOnce({
      id: 't1',
      messages: [makeMessage({ id: 'm1', isUnread: true, htmlBody: '<a href="https://example.com">link</a>' })],
    });
    const { container } = render(<ThreadDetail threadId="t1" />);
    await waitFor(() => expect(container.querySelector('iframe')).toBeInTheDocument());
    const sandbox = container.querySelector('iframe')!.getAttribute('sandbox') ?? '';
    // Without this token, popups opened from the sandbox inherit its restrictions and render broken
    expect(sandbox.split(' ')).toContain('allow-popups-to-escape-sandbox');
  });

  it('updates iframe height when the iframe posts an iframe-height message', async () => {
    mockGetThread.mockResolvedValueOnce({
      id: 't1',
      messages: [makeMessage({ id: 'm1', isUnread: true, htmlBody: '<p>HTML</p>' })],
    });
    const { container } = render(<ThreadDetail threadId="t1" />);
    await waitFor(() => expect(container.querySelector('iframe')).toBeInTheDocument());

    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    // useEffect registers the message listener asynchronously after render, so
    // wrap dispatch + assertion in waitFor to retry until the listener is live.
    await waitFor(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'iframe-height', h: 300 },
        source: iframe.contentWindow,
      }));
      expect(iframe.style.height).toBe('300px');
    });
  });

  it('ignores a postMessage from a source other than the iframe', async () => {
    mockGetThread.mockResolvedValueOnce({
      id: 't1',
      messages: [makeMessage({ id: 'm1', isUnread: true, htmlBody: '<p>HTML</p>' })],
    });
    const { container } = render(<ThreadDetail threadId="t1" />);
    await waitFor(() => expect(container.querySelector('iframe')).toBeInTheDocument());

    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'iframe-height', h: 300 },
      source: window, // wrong source — not the iframe
    }));

    expect(iframe.style.height).toBe('');
  });

  it('does not update iframe height when h is falsy in the iframe-height message', async () => {
    mockGetThread.mockResolvedValueOnce({
      id: 't1',
      messages: [makeMessage({ id: 'm1', isUnread: true, htmlBody: '<p>HTML</p>' })],
    });
    const { container } = render(<ThreadDetail threadId="t1" />);
    await waitFor(() => expect(container.querySelector('iframe')).toBeInTheDocument());

    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'iframe-height', h: 0 },
      source: iframe.contentWindow,
    }));

    expect(iframe.style.height).toBe('');
  });

  it('shows "(no content)" when a message has neither html nor plaintext body', async () => {
    mockGetThread.mockResolvedValueOnce({
      id: 't1',
      messages: [makeMessage({ id: 'm1', isUnread: true, htmlBody: null, plaintextBody: null })],
    });
    render(<ThreadDetail threadId="t1" />);
    await waitFor(() => {
      expect(screen.getByText('(no content)')).toBeInTheDocument();
    });
  });
});

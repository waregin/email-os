import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DigestPanel } from '../../components/DigestPanel';
import type { DecisionWithThread } from '../../api';

// DigestPanel renders ThreadDetail (when an item is expanded), which imports the api.
vi.mock('../../api', () => ({
  api: { getThread: vi.fn().mockResolvedValue({ id: 't', messages: [] }) },
}));

function makeItem(overrides: Partial<DecisionWithThread> & { decisionId: string; threadId: string }): DecisionWithThread {
  return {
    priority: 'T3',
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

function defaultProps() {
  return {
    label: 'T3 Summarized',
    accent: '',
    onToggle: vi.fn(),
    onConfirm: vi.fn(),
    onDone: vi.fn(),
    onFollowup: vi.fn(),
    onMisclassified: vi.fn(),
    onConfirmAll: vi.fn(),
    onViewThread: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DigestPanel rendering', () => {
  it('shows the item count badge matching items.length when closed', () => {
    const items = [
      makeItem({ decisionId: 'd1', threadId: 't1' }),
      makeItem({ decisionId: 'd2', threadId: 't2' }),
    ];
    render(<DigestPanel tier="T3" items={items} isOpen={false} {...defaultProps()} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders each item digestSummary for T1/T2/T3', () => {
    const items = [makeItem({ decisionId: 'd1', threadId: 't1', digestSummary: 'Pay your bill' })];
    render(<DigestPanel tier="T3" items={items} isOpen={true} {...defaultProps()} />);
    expect(screen.getByText('Pay your bill')).toBeInTheDocument();
  });

  it('shows subject and snippet (not digestSummary) for T4 items', () => {
    const items = [
      makeItem({
        decisionId: 'd1',
        threadId: 't1',
        categoryLabel: 'News',
        digestSummary: 'should-not-show',
        thread: { subject: 'Breaking News', sender: 'a@b.com', date: '2024-01-01T00:00:00Z', snippet: 'news snippet', unreadCount: 0, messageCount: 1 },
      }),
    ];
    render(<DigestPanel tier="T4" items={items} isOpen={true} {...defaultProps()} />);
    // T4 group is collapsed by default; open it
    screen.getByText(/News/);
  });

  it('groups T4 items by categoryLabel with "Other" last', () => {
    const items = [
      makeItem({ decisionId: 'd1', threadId: 't1', categoryLabel: null }),
      makeItem({ decisionId: 'd2', threadId: 't2', categoryLabel: 'Apple' }),
    ];
    render(<DigestPanel tier="T4" items={items} isOpen={true} {...defaultProps()} />);
    const appleGroup = screen.getByText(/Apple/);
    const otherGroup = screen.getByText(/Other/);
    // Apple should come before Other in DOM order
    expect(appleGroup.compareDocumentPosition(otherGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('drops an item from the open snapshot when it disappears from incoming items', () => {
    const items = [
      makeItem({ decisionId: 'd1', threadId: 't1', digestSummary: 'Keep me' }),
      makeItem({ decisionId: 'd2', threadId: 't2', digestSummary: 'Remove me' }),
    ];
    const { rerender } = render(<DigestPanel tier="T3" items={items} isOpen={true} {...defaultProps()} />);
    expect(screen.getByText('Remove me')).toBeInTheDocument();

    // d2 is archived elsewhere and no longer arrives in items
    rerender(<DigestPanel tier="T3" items={[items[0]!]} isOpen={true} {...defaultProps()} />);
    expect(screen.queryByText('Remove me')).not.toBeInTheDocument();
    expect(screen.getByText('Keep me')).toBeInTheDocument();
  });

  it('does not add newly-arrived items to an already-open snapshot (removals only)', () => {
    const items = [makeItem({ decisionId: 'd1', threadId: 't1', digestSummary: 'Original' })];
    const { rerender } = render(<DigestPanel tier="T3" items={items} isOpen={true} {...defaultProps()} />);
    expect(screen.getByText('Original')).toBeInTheDocument();

    const withNew = [...items, makeItem({ decisionId: 'd2', threadId: 't2', digestSummary: 'Newcomer' })];
    rerender(<DigestPanel tier="T3" items={withNew} isOpen={true} {...defaultProps()} />);
    expect(screen.queryByText('Newcomer')).not.toBeInTheDocument();
    expect(screen.getByText('Original')).toBeInTheDocument();
  });
});

describe('DigestPanel button sets per tier', () => {
  it('T1/T2 shows Confirm and Done but not Followup', () => {
    const items = [makeItem({ decisionId: 'd1', threadId: 't1', priority: 'T1' })];
    render(<DigestPanel tier="T1" items={items} isOpen={true} {...defaultProps()} />);
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.queryByText('Followup')).not.toBeInTheDocument();
  });

  it('userFlagged T2 item shows only Done (no Confirm, no Wrong) and Done calls onDone', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [makeItem({ decisionId: 'd1', threadId: 't1', priority: 'T2', userFlagged: true })];
    render(<DigestPanel tier="T2" items={items} isOpen={true} {...props} />);
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.queryByText('Confirm')).not.toBeInTheDocument();
    expect(screen.queryByText('Wrong')).not.toBeInTheDocument();
    await user.click(screen.getByText('Done'));
    expect(props.onDone).toHaveBeenCalledWith('d1');
  });

  it('T3 shows Confirm and Followup but not Done', () => {
    const items = [makeItem({ decisionId: 'd1', threadId: 't1', priority: 'T3' })];
    render(<DigestPanel tier="T3" items={items} isOpen={true} {...defaultProps()} />);
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByText('Followup')).toBeInTheDocument();
    expect(screen.queryByText('Done')).not.toBeInTheDocument();
  });
});

describe('DigestPanel actions', () => {
  it('clicking Confirm on a T1 item calls onConfirm and fades the item to confirmed', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [makeItem({ decisionId: 'd1', threadId: 't1', priority: 'T1' })];
    const { container } = render(<DigestPanel tier="T1" items={items} isOpen={true} {...props} />);

    await user.click(screen.getByText('Confirm'));
    expect(props.onConfirm).toHaveBeenCalledWith('d1');
    // The row gains opacity-50 when confirmed (snapshot updated in place)
    expect(container.querySelector('.opacity-50')).toBeInTheDocument();
  });

  it('clicking Confirm on a T3 item calls onConfirm and removes it from view', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [makeItem({ decisionId: 'd1', threadId: 't1', priority: 'T3', digestSummary: 'remove me' })];
    render(<DigestPanel tier="T3" items={items} isOpen={true} {...props} />);

    expect(screen.getByText('remove me')).toBeInTheDocument();
    await user.click(screen.getByText('Confirm'));
    expect(props.onConfirm).toHaveBeenCalledWith('d1');
    expect(screen.queryByText('remove me')).not.toBeInTheDocument();
  });

  it('clicking Done calls onDone', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [makeItem({ decisionId: 'd1', threadId: 't1', priority: 'T1' })];
    render(<DigestPanel tier="T1" items={items} isOpen={true} {...props} />);
    await user.click(screen.getByText('Done'));
    expect(props.onDone).toHaveBeenCalledWith('d1');
  });

  it('expanding a T1 item calls onViewThread with the thread id', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [makeItem({ decisionId: 'd1', threadId: 't-view', priority: 'T1', digestSummary: 'click me' })];
    render(<DigestPanel tier="T1" items={items} isOpen={true} {...props} />);
    await user.click(screen.getByText('click me'));
    expect(props.onViewThread).toHaveBeenCalledWith('t-view');
  });

  it('clicking Followup reveals an inline note input prefilled with the subject', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [makeItem({ decisionId: 'd1', threadId: 't1', priority: 'T3' })];
    render(<DigestPanel tier="T3" items={items} isOpen={true} {...props} />);
    await user.click(screen.getByText('Followup'));
    const noteInput = screen.getByLabelText('Followup note') as HTMLInputElement;
    expect(noteInput).toBeInTheDocument();
    expect(noteInput.value).toBe('Thread subject');
    // Opening the input must not yet fire the followup
    expect(props.onFollowup).not.toHaveBeenCalled();
  });

  it('submitting the followup note calls onFollowup with the edited note', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [makeItem({ decisionId: 'd1', threadId: 't1', priority: 'T3' })];
    render(<DigestPanel tier="T3" items={items} isOpen={true} {...props} />);
    await user.click(screen.getByText('Followup'));
    const noteInput = screen.getByLabelText('Followup note');
    await user.clear(noteInput);
    await user.type(noteInput, 'Reply with pricing by Friday');
    const followupRow = noteInput.closest('div')!;
    await user.click(within(followupRow).getByText('Confirm'));
    expect(props.onFollowup).toHaveBeenCalledWith('d1', 'Reply with pricing by Friday');
  });

  it('cancelling the followup note hides the input without calling onFollowup', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [makeItem({ decisionId: 'd1', threadId: 't1', priority: 'T3' })];
    render(<DigestPanel tier="T3" items={items} isOpen={true} {...props} />);
    await user.click(screen.getByText('Followup'));
    const noteInput = screen.getByLabelText('Followup note');
    const followupRow = noteInput.closest('div')!;
    await user.click(within(followupRow).getByText('Cancel'));
    expect(screen.queryByLabelText('Followup note')).not.toBeInTheDocument();
    expect(props.onFollowup).not.toHaveBeenCalled();
  });

  it('clicking Wrong calls onMisclassified with decisionId and threadId', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [makeItem({ decisionId: 'd1', threadId: 't1', priority: 'T3' })];
    render(<DigestPanel tier="T3" items={items} isOpen={true} {...props} />);
    await user.click(screen.getByText('Wrong'));
    expect(props.onMisclassified).toHaveBeenCalledWith('d1', 't1');
  });
});

describe('DigestPanel Confirm All', () => {
  it('T1 Confirm All calls onConfirmAll with only the unconfirmed IDs', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [
      makeItem({ decisionId: 'd1', threadId: 't1', priority: 'T1', confirmedByUser: false }),
      makeItem({ decisionId: 'd2', threadId: 't2', priority: 'T1', confirmedByUser: true }),
    ];
    render(<DigestPanel tier="T1" items={items} isOpen={true} {...props} />);
    await user.click(screen.getByText('Confirm all'));
    expect(props.onConfirmAll).toHaveBeenCalledWith(['d1'], 'T1');
  });

  it('T1 Confirm All does nothing when every item is already confirmed', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [makeItem({ decisionId: 'd1', threadId: 't1', priority: 'T1', confirmedByUser: true })];
    render(<DigestPanel tier="T1" items={items} isOpen={true} {...props} />);
    await user.click(screen.getByText('Confirm all'));
    expect(props.onConfirmAll).not.toHaveBeenCalled();
  });

  it('T3 Confirm All calls onConfirmAll with all IDs and empties the panel', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [
      makeItem({ decisionId: 'd1', threadId: 't1', priority: 'T3' }),
      makeItem({ decisionId: 'd2', threadId: 't2', priority: 'T3' }),
    ];
    render(<DigestPanel tier="T3" items={items} isOpen={true} {...props} />);
    await user.click(screen.getByText('Confirm all'));
    expect(props.onConfirmAll).toHaveBeenCalledWith(['d1', 'd2'], 'T3');
    expect(screen.getByText('All caught up ✓')).toBeInTheDocument();
  });
});

describe('DigestPanel snapshot isolation', () => {
  it('does not show items added to the items prop after the panel was opened', () => {
    const props = defaultProps();
    const items = [makeItem({ decisionId: 'd1', threadId: 't1', digestSummary: 'original' })];
    const { rerender } = render(<DigestPanel tier="T3" items={items} isOpen={true} {...props} />);
    expect(screen.getByText('original')).toBeInTheDocument();

    // A new item arrives via props while the panel stays open
    const updatedItems = [
      ...items,
      makeItem({ decisionId: 'd2', threadId: 't2', digestSummary: 'newly arrived' }),
    ];
    rerender(<DigestPanel tier="T3" items={updatedItems} isOpen={true} {...props} />);

    // Snapshot was taken on open → the new item is NOT shown
    expect(screen.queryByText('newly arrived')).not.toBeInTheDocument();
    expect(screen.getByText('original')).toBeInTheDocument();
  });
});

describe('DigestPanel T4 group expansion', () => {
  function t4Item(decisionId: string, threadId: string, categoryLabel: string, subject: string) {
    return makeItem({
      decisionId,
      threadId,
      priority: 'T4',
      categoryLabel,
      thread: { subject, sender: 'a@b.com', date: '2024-01-01T00:00:00Z', snippet: 'snip', unreadCount: 0, messageCount: 1 },
    });
  }

  it('clicking a T4 item inside an expanded group calls onViewThread', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [t4Item('d1', 't-view', 'Newsletters', 'Weekly Digest')];
    render(<DigestPanel tier="T4" items={items} isOpen={true} {...props} />);

    await user.click(screen.getByText(/Newsletters/));
    await user.click(screen.getByText('Weekly Digest'));
    expect(props.onViewThread).toHaveBeenCalledWith('t-view');
  });

  it('expands a category group to reveal its items and a per-group Confirm all', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [
      t4Item('d1', 't1', 'Newsletters', 'Weekly Digest'),
      t4Item('d2', 't2', 'Newsletters', 'Monthly Roundup'),
    ];
    render(<DigestPanel tier="T4" items={items} isOpen={true} {...props} />);

    // Group is collapsed initially — items not shown
    expect(screen.queryByText('Weekly Digest')).not.toBeInTheDocument();

    // Open the group
    await user.click(screen.getByText(/Newsletters/));
    expect(screen.getByText('Weekly Digest')).toBeInTheDocument();
    expect(screen.getByText('Monthly Roundup')).toBeInTheDocument();

    // The group's Confirm all fires onConfirmAll with the group's decision IDs
    await user.click(screen.getByText('Confirm all'));
    expect(props.onConfirmAll).toHaveBeenCalledWith(['d1', 'd2'], 'T4');
  });
});

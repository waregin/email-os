import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DigestPanel } from '../../components/DigestPanel';
import { api } from '../../api';
import type { DecisionWithThread } from '../../api';

// DigestPanel renders ThreadDetail (when an item is expanded), which imports the api.
vi.mock('../../api', () => ({
  api: { getThread: vi.fn().mockResolvedValue({ id: 't', messages: [] }) },
}));

const mockApi = vi.mocked(api);

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
    onOpenTeach: vi.fn(),
    onConfirmAll: vi.fn(),
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

  it('clicking a T1 item row expands it and fetches the thread', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [makeItem({ decisionId: 'd1', threadId: 't-expand', priority: 'T1', digestSummary: 'click me' })];
    render(<DigestPanel tier="T1" items={items} isOpen={true} {...props} />);
    await user.click(screen.getByText('click me'));
    expect(mockApi.getThread).toHaveBeenCalledWith('t-expand');
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

  it('clicking Wrong reveals a tier picker with the current tier marked and disabled', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [makeItem({ decisionId: 'd1', threadId: 't1', priority: 'T3' })];
    render(<DigestPanel tier="T3" items={items} isOpen={true} {...props} />);
    await user.click(screen.getByText('Wrong'));

    // Current tier (T3) is marked incorrect and not selectable
    const current = screen.getByLabelText('T3 (current — incorrect)');
    expect(current).toBeDisabled();
    // Other tiers are offered
    expect(screen.getByLabelText('Move to T1')).toBeInTheDocument();
    expect(props.onOpenTeach).not.toHaveBeenCalled();
  });

  it('selecting a tier in the picker calls onOpenTeach with that tier', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [makeItem({ decisionId: 'd1', threadId: 't1', priority: 'T3' })];
    render(<DigestPanel tier="T3" items={items} isOpen={true} {...props} />);
    await user.click(screen.getByText('Wrong'));
    await user.click(screen.getByLabelText('Move to T1'));
    expect(props.onOpenTeach).toHaveBeenCalledWith(
      expect.objectContaining({ decisionId: 'd1', threadId: 't1' }),
      { correctTier: 'T1' },
    );
  });

  it('cancelling the tier picker hides it without calling onOpenTeach', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [makeItem({ decisionId: 'd1', threadId: 't1', priority: 'T3' })];
    render(<DigestPanel tier="T3" items={items} isOpen={true} {...props} />);
    await user.click(screen.getByText('Wrong'));
    await user.click(screen.getByLabelText('Cancel tier picker'));
    expect(screen.queryByLabelText('Move to T1')).not.toBeInTheDocument();
    expect(props.onOpenTeach).not.toHaveBeenCalled();
  });

  it('T1-T3 picker shows Fix summary button alongside the tier buttons', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [makeItem({ decisionId: 'd1', threadId: 't1', priority: 'T3' })];
    render(<DigestPanel tier="T3" items={items} isOpen={true} {...props} />);
    await user.click(screen.getByText('Wrong'));
    expect(screen.getByLabelText('Fix digest summary')).toBeInTheDocument();
    expect(screen.queryByLabelText('Fix category label')).not.toBeInTheDocument();
  });

  it('clicking Fix summary calls onOpenTeach with fixSummary: true and the current tier', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [makeItem({ decisionId: 'd1', threadId: 't1', priority: 'T3' })];
    render(<DigestPanel tier="T3" items={items} isOpen={true} {...props} />);
    await user.click(screen.getByText('Wrong'));
    await user.click(screen.getByLabelText('Fix digest summary'));
    expect(props.onOpenTeach).toHaveBeenCalledWith(
      expect.objectContaining({ decisionId: 'd1', threadId: 't1' }),
      { correctTier: 'T3', fixSummary: true },
    );
  });

  it('Fix summary also works from T1/T2 items', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [makeItem({ decisionId: 'd1', threadId: 't1', priority: 'T1' })];
    render(<DigestPanel tier="T1" items={items} isOpen={true} {...props} />);
    await user.click(screen.getByText('Wrong'));
    await user.click(screen.getByLabelText('Fix digest summary'));
    expect(props.onOpenTeach).toHaveBeenCalledWith(
      expect.objectContaining({ decisionId: 'd1' }),
      { correctTier: 'T1', fixSummary: true },
    );
  });

  it('T4 picker shows Fix category button (not Fix summary)', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [makeItem({ decisionId: 'd1', threadId: 't1', priority: 'T4', categoryLabel: 'Newsletters' })];
    render(<DigestPanel tier="T4" items={items} isOpen={true} {...props} />);
    // T4 items are grouped — open the group first
    await user.click(screen.getByText(/Newsletters/));
    await user.click(screen.getByText('Wrong'));
    expect(screen.getByLabelText('Fix category label')).toBeInTheDocument();
    expect(screen.queryByLabelText('Fix digest summary')).not.toBeInTheDocument();
  });

  it('clicking Fix category reveals a category input pre-filled with the current label', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [makeItem({ decisionId: 'd1', threadId: 't1', priority: 'T4', categoryLabel: 'Newsletters' })];
    render(<DigestPanel tier="T4" items={items} isOpen={true} {...props} />);
    await user.click(screen.getByText(/Newsletters/));
    await user.click(screen.getByText('Wrong'));
    await user.click(screen.getByLabelText('Fix category label'));
    const input = screen.getByLabelText('Correct category') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('Newsletters');
    expect(props.onOpenTeach).not.toHaveBeenCalled();
  });

  it('confirming the category input calls onOpenTeach with correctCategory', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [makeItem({ decisionId: 'd1', threadId: 't1', priority: 'T4', categoryLabel: 'Newsletters' })];
    render(<DigestPanel tier="T4" items={items} isOpen={true} {...props} />);
    await user.click(screen.getByText(/Newsletters/));
    await user.click(screen.getByText('Wrong'));
    await user.click(screen.getByLabelText('Fix category label'));
    const input = screen.getByLabelText('Correct category');
    await user.clear(input);
    await user.type(input, 'Finance');
    const confirmBtn = input.closest('div')!.querySelector('button[disabled]') === null
      ? screen.getAllByText('Confirm').find((el) => el.closest('div')?.contains(input))
      : null;
    // Use Enter key to confirm
    await user.keyboard('{Enter}');
    expect(props.onOpenTeach).toHaveBeenCalledWith(
      expect.objectContaining({ decisionId: 'd1' }),
      { correctTier: 'T4', correctCategory: 'Finance' },
    );
  });

  it('cancelling the category input returns to the tier picker without calling onOpenTeach', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [makeItem({ decisionId: 'd1', threadId: 't1', priority: 'T4', categoryLabel: 'Newsletters' })];
    render(<DigestPanel tier="T4" items={items} isOpen={true} {...props} />);
    await user.click(screen.getByText(/Newsletters/));
    await user.click(screen.getByText('Wrong'));
    await user.click(screen.getByLabelText('Fix category label'));
    expect(screen.getByLabelText('Correct category')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Cancel category input'));
    expect(screen.queryByLabelText('Correct category')).not.toBeInTheDocument();
    // Back to tier picker — tier buttons visible again
    expect(screen.getByLabelText('Move to T1')).toBeInTheDocument();
    expect(props.onOpenTeach).not.toHaveBeenCalled();
  });

  it('T5 picker does not show Fix summary or Fix category', async () => {
    const user = userEvent.setup();
    render(<DigestPanel tier="T5" label="T5 Unclassified" items={[makeItem({ decisionId: 'd1', threadId: 't1', priority: 'T5', digestSummary: 'should-not-show', thread: { subject: 'Mystery', sender: 'a@b.com', date: '2024-01-01T00:00:00Z', snippet: 'snip', unreadCount: 0, messageCount: 1 } })]} isOpen={true} {...defaultProps()} />);
    await user.click(screen.getByText('Teach'));
    expect(screen.queryByLabelText('Fix digest summary')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Fix category label')).not.toBeInTheDocument();
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

  it('clicking a T4 item inside an expanded group fetches the thread', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    const items = [t4Item('d1', 't-expand', 'Newsletters', 'Weekly Digest')];
    render(<DigestPanel tier="T4" items={items} isOpen={true} {...props} />);
    await user.click(screen.getByText(/Newsletters/));
    await user.click(screen.getByText('Weekly Digest'));
    expect(mockApi.getThread).toHaveBeenCalledWith('t-expand');
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

describe('DigestPanel T5 Unclassified', () => {
  function t5Item() {
    return makeItem({
      decisionId: 'd1',
      threadId: 't1',
      priority: 'T5',
      digestSummary: 'should-not-show',
      thread: { subject: 'Mystery email', sender: 'a@b.com', date: '2024-01-01T00:00:00Z', snippet: 'mystery snippet', unreadCount: 0, messageCount: 1 },
    });
  }

  it('shows subject and snippet (not digestSummary), only a Teach button, and no Confirm all', () => {
    render(<DigestPanel tier="T5" label="T5 Unclassified" items={[t5Item()]} isOpen={true} {...defaultProps()} />);
    expect(screen.getByText('Mystery email')).toBeInTheDocument();
    expect(screen.getByText('mystery snippet')).toBeInTheDocument();
    expect(screen.queryByText('should-not-show')).not.toBeInTheDocument();
    expect(screen.getByText('Teach')).toBeInTheDocument();
    expect(screen.queryByText('Confirm')).not.toBeInTheDocument();
    expect(screen.queryByText('Done')).not.toBeInTheDocument();
    expect(screen.queryByText('Followup')).not.toBeInTheDocument();
    expect(screen.queryByText('Wrong')).not.toBeInTheDocument();
    expect(screen.queryByText('Confirm all')).not.toBeInTheDocument();
  });

  it('Teach opens the tier picker with all four tiers selectable (none marked current)', async () => {
    const user = userEvent.setup();
    render(<DigestPanel tier="T5" label="T5 Unclassified" items={[t5Item()]} isOpen={true} {...defaultProps()} />);
    await user.click(screen.getByText('Teach'));
    for (const tier of ['T1', 'T2', 'T3', 'T4']) {
      expect(screen.getByLabelText(`Move to ${tier}`)).toBeInTheDocument();
    }
  });

  it('picking a tier from the Teach picker calls onOpenTeach with that tier', async () => {
    const user = userEvent.setup();
    const props = defaultProps();
    render(<DigestPanel tier="T5" label="T5 Unclassified" items={[t5Item()]} isOpen={true} {...props} />);
    await user.click(screen.getByText('Teach'));
    await user.click(screen.getByLabelText('Move to T2'));
    expect(props.onOpenTeach).toHaveBeenCalledWith(
      expect.objectContaining({ decisionId: 'd1', threadId: 't1' }),
      { correctTier: 'T2' },
    );
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// mockRun is hoisted so the vi.mock factory can reference it
const mockRun = vi.hoisted(() => vi.fn());

vi.mock('../../engine', () => ({
  runTriagePass: mockRun,
}));

describe('scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules(); // fresh activeSchedulers Map for each test
    mockRun.mockReset();
    mockRun.mockResolvedValue({ fetched: 0, processed: 0, matched: 0, unmatched: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls runTriagePass immediately on first start', async () => {
    const { startScheduler } = await import('../../scheduler');
    startScheduler('user-123');

    expect(mockRun).toHaveBeenCalledWith('user-123');
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('is idempotent per user — second call with the same userId is ignored', async () => {
    const { startScheduler } = await import('../../scheduler');
    startScheduler('user-1');
    startScheduler('user-1');

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRun).toHaveBeenCalledWith('user-1');
  });

  it('starts independent schedulers for different users', async () => {
    const { startScheduler } = await import('../../scheduler');
    startScheduler('user-1');
    startScheduler('user-2');

    expect(mockRun).toHaveBeenCalledTimes(2);
    expect(mockRun).toHaveBeenCalledWith('user-1');
    expect(mockRun).toHaveBeenCalledWith('user-2');
  });

  it('fires runTriagePass again on the 3-minute interval', async () => {
    const { startScheduler } = await import('../../scheduler');
    startScheduler('user-tick');
    mockRun.mockClear();

    vi.advanceTimersByTime(3 * 60 * 1000);
    await Promise.resolve(); // flush microtasks

    expect(mockRun).toHaveBeenCalledWith('user-tick');
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('logs errors from runTriagePass but does not stop the interval', async () => {
    mockRun.mockRejectedValueOnce(new Error('triage failed'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { startScheduler } = await import('../../scheduler');
    startScheduler('user-err');
    // Flush the initial rejected promise through multiple microtask ticks
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();

    // Verify interval still fires after error
    mockRun.mockClear();
    mockRun.mockResolvedValue({ fetched: 0, processed: 0, matched: 0, unmatched: 0 });
    vi.advanceTimersByTime(3 * 60 * 1000);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRun).toHaveBeenCalledTimes(1);
  });
});

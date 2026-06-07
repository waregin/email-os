import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// mockRun is hoisted so the vi.mock factory can reference it
const { mockRun, mockHealthCheck } = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockHealthCheck: vi.fn(),
}));

vi.mock('../../engine', () => ({
  runTriagePass: mockRun,
}));

vi.mock('../../health-check', () => ({
  runHealthCheck: mockHealthCheck,
}));

describe('scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules(); // fresh activeSchedulers Map for each test
    mockRun.mockReset();
    mockHealthCheck.mockReset();
    mockRun.mockResolvedValue({ fetched: 0, processed: 0, matched: 0, t5Fallback: 0 });
    mockHealthCheck.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls runTriagePass immediately on first start', async () => {
    const { startScheduler } = await import('../../scheduler');
    startScheduler('user-123');
    await Promise.resolve();

    expect(mockRun).toHaveBeenCalledWith('user-123');
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('calls runHealthCheck immediately on first start', async () => {
    const { startScheduler } = await import('../../scheduler');
    startScheduler('user-123');
    await Promise.resolve();

    expect(mockHealthCheck).toHaveBeenCalledWith('user-123');
    expect(mockHealthCheck).toHaveBeenCalledTimes(1);
  });

  it('is idempotent per user — second call with the same userId is ignored', async () => {
    const { startScheduler } = await import('../../scheduler');
    startScheduler('user-1');
    startScheduler('user-1');
    await Promise.resolve();

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRun).toHaveBeenCalledWith('user-1');
  });

  it('starts independent schedulers for different users', async () => {
    const { startScheduler } = await import('../../scheduler');
    startScheduler('user-1');
    startScheduler('user-2');
    await Promise.resolve();

    expect(mockRun).toHaveBeenCalledTimes(2);
    expect(mockRun).toHaveBeenCalledWith('user-1');
    expect(mockRun).toHaveBeenCalledWith('user-2');
  });

  it('fires runTriagePass again on the 3-minute interval', async () => {
    const { startScheduler } = await import('../../scheduler');
    startScheduler('user-tick');
    mockRun.mockClear();

    vi.advanceTimersByTime(3 * 60 * 1000);
    await Promise.resolve();

    expect(mockRun).toHaveBeenCalledWith('user-tick');
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('fires runHealthCheck again on the 24-hour interval', async () => {
    const { startScheduler } = await import('../../scheduler');
    startScheduler('user-health');
    mockHealthCheck.mockClear();

    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    await Promise.resolve();

    expect(mockHealthCheck).toHaveBeenCalledWith('user-health');
    expect(mockHealthCheck).toHaveBeenCalledTimes(1);
  });

  it('logs errors from runTriagePass but does not stop the interval', async () => {
    mockRun.mockRejectedValueOnce(new Error('triage failed'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { startScheduler } = await import('../../scheduler');
    startScheduler('user-err');
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();

    // Verify interval still fires after error
    mockRun.mockClear();
    mockRun.mockResolvedValue({ fetched: 0, processed: 0, matched: 0, t5Fallback: 0 });
    vi.advanceTimersByTime(3 * 60 * 1000);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('logs errors from runHealthCheck but does not stop the interval', async () => {
    mockHealthCheck.mockRejectedValueOnce(new Error('health check failed'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { startScheduler } = await import('../../scheduler');
    startScheduler('user-health-err');
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

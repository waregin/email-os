import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from '../../api';

const mockFetch = vi.fn();

function okJson(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
  } as Response);
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api request helper', () => {
  it('includes credentials and JSON content-type on every request', async () => {
    mockFetch.mockReturnValueOnce(okJson({ authenticated: true }));
    await api.getStatus();
    const [, options] = mockFetch.mock.calls[0]!;
    expect(options.credentials).toBe('include');
    expect(options.headers['Content-Type']).toBe('application/json');
  });

  it('throws with the server error message when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Something broke' }),
    } as Response);
    await expect(api.getStatus()).rejects.toThrow('Something broke');
  });

  it('throws with an HTTP status fallback when error body has no message', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
    } as Response);
    await expect(api.getStatus()).rejects.toThrow('HTTP 404');
  });
});

describe('GET endpoints', () => {
  it('getStatus calls /api/status', async () => {
    mockFetch.mockReturnValueOnce(okJson({ authenticated: false }));
    const result = await api.getStatus();
    expect(mockFetch.mock.calls[0]![0]).toBe('/api/status');
    expect(result).toEqual({ authenticated: false });
  });

  it('getThread calls /api/gmail/threads/:id', async () => {
    mockFetch.mockReturnValueOnce(okJson({ id: 'abc', messages: [] }));
    await api.getThread('abc');
    expect(mockFetch.mock.calls[0]![0]).toBe('/api/gmail/threads/abc');
  });

  it('getUnreadCount calls /api/gmail/unread-count', async () => {
    mockFetch.mockReturnValueOnce(okJson({ count: 3 }));
    const result = await api.getUnreadCount();
    expect(mockFetch.mock.calls[0]![0]).toBe('/api/gmail/unread-count');
    expect(result.count).toBe(3);
  });

  it('getDecisions calls /api/gmail/decisions', async () => {
    mockFetch.mockReturnValueOnce(okJson({ T1: [], T2: [], T3: [], T4: [] }));
    await api.getDecisions();
    expect(mockFetch.mock.calls[0]![0]).toBe('/api/gmail/decisions');
  });
});

describe('POST decision endpoints', () => {
  it('confirmDecision posts to the confirm path', async () => {
    mockFetch.mockReturnValueOnce(okJson({ ok: true }));
    await api.confirmDecision('d1');
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toBe('/api/gmail/decisions/d1/confirm');
    expect(options.method).toBe('POST');
  });

  it('doneDecision posts to the done path', async () => {
    mockFetch.mockReturnValueOnce(okJson({ ok: true }));
    await api.doneDecision('d1');
    expect(mockFetch.mock.calls[0]![0]).toBe('/api/gmail/decisions/d1/done');
    expect(mockFetch.mock.calls[0]![1].method).toBe('POST');
  });

  it('followupDecision posts to the followup path', async () => {
    mockFetch.mockReturnValueOnce(okJson({ ok: true }));
    await api.followupDecision('d1');
    expect(mockFetch.mock.calls[0]![0]).toBe('/api/gmail/decisions/d1/followup');
  });

  it('misclassifiedDecision posts to the misclassified path', async () => {
    mockFetch.mockReturnValueOnce(okJson({ ok: true, threadId: 't1' }));
    await api.misclassifiedDecision('d1');
    expect(mockFetch.mock.calls[0]![0]).toBe('/api/gmail/decisions/d1/misclassified');
  });

  it('confirmAll posts decisionIds and tier in the body', async () => {
    mockFetch.mockReturnValueOnce(okJson({ ok: true, processed: 2 }));
    await api.confirmAll(['d1', 'd2'], 'T1');
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toBe('/api/gmail/decisions/confirm-all');
    expect(JSON.parse(options.body)).toEqual({ decisionIds: ['d1', 'd2'], tier: 'T1' });
  });
});

describe('POST agent endpoints', () => {
  it('saveRule wraps the rule in a { rule } body', async () => {
    mockFetch.mockReturnValueOnce(okJson({ ruleId: 'r1', matchingThreads: [] }));
    const rule = { trigger: '{}', action: 'digest', priority: 'T3', digestSummaryTemplate: 't' };
    await api.saveRule(rule);
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toBe('/api/agent/rules');
    expect(JSON.parse(options.body)).toEqual({ rule });
  });

  it('applyRule posts threadIds to the apply path', async () => {
    mockFetch.mockReturnValueOnce(okJson({ ok: true, applied: 2 }));
    await api.applyRule('r1', ['t1', 't2']);
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toBe('/api/agent/rules/r1/apply');
    expect(JSON.parse(options.body)).toEqual({ threadIds: ['t1', 't2'] });
  });

  it('teachMessage posts the full payload', async () => {
    mockFetch.mockReturnValueOnce(okJson({ response: 'hello' }));
    const payload = {
      messages: [{ role: 'user' as const, content: 'hi' }],
      threadContext: { subject: 's', sender: 'a@b.com', snippet: 'x', date: 'd', threadId: 't1' },
    };
    await api.teachMessage(payload);
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toBe('/api/agent/teach');
    expect(JSON.parse(options.body)).toEqual(payload);
  });

  it('getRulesWithSuggestions calls GET /api/agent/rules/with-suggestions', async () => {
    mockFetch.mockReturnValueOnce(okJson([]));
    await api.getRulesWithSuggestions();
    expect(mockFetch.mock.calls[0]![0]).toBe('/api/agent/rules/with-suggestions');
  });

  it('acceptSuggestion posts to the accept path', async () => {
    mockFetch.mockReturnValueOnce(okJson({ ok: true, ruleId: 'r2' }));
    await api.acceptSuggestion('r1');
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toBe('/api/agent/rules/r1/suggestion/accept');
    expect(options.method).toBe('POST');
  });

  it('dismissSuggestion posts to the dismiss path', async () => {
    mockFetch.mockReturnValueOnce(okJson({ ok: true }));
    await api.dismissSuggestion('r1');
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toBe('/api/agent/rules/r1/suggestion/dismiss');
    expect(options.method).toBe('POST');
  });
});

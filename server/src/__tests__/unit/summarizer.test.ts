import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Hoisted mock refs ---
const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: function Anthropic() {
    return { messages: { create: mockCreate } };
  },
}));

import { buildDigestSummary } from '../../summarizer';

const THREAD = {
  subject: 'Your invoice is ready',
  sender: 'billing@acme.com',
  date: 'Mon, 1 Jan 2024 12:00:00 +0000',
  snippet: 'Invoice #1234 is available',
  plaintextBody: 'Dear customer, your invoice #1234 is ready for download.',
  htmlBody: '<p>Dear customer, your invoice #1234 is ready for download.</p>',
};

beforeEach(() => {
  mockCreate.mockReset();
});

describe('buildDigestSummary', () => {
  it('returns empty string immediately for empty template without calling API', async () => {
    const result = await buildDigestSummary('', THREAD);
    expect(result).toBe('');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns empty string for whitespace-only template without calling API', async () => {
    const result = await buildDigestSummary('   ', THREAD);
    expect(result).toBe('');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('calls Anthropic API with template and email content, returns filled summary', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Invoice #1234 ready for download' }],
    });
    const result = await buildDigestSummary('Invoice {number} is {status}', THREAD);
    expect(result).toBe('Invoice #1234 ready for download');
    expect(mockCreate).toHaveBeenCalledOnce();
    const call = mockCreate.mock.calls[0]![0] as { messages: Array<{ content: string }> };
    expect(call.messages[0]!.content).toContain('Invoice {number} is {status}');
  });

  it('prefers plaintextBody over htmlBody when building the prompt', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'summary' }],
    });
    await buildDigestSummary('Summary: {text}', THREAD);
    const call = mockCreate.mock.calls[0]![0] as { messages: Array<{ content: string }> };
    expect(call.messages[0]!.content).toContain(THREAD.plaintextBody);
    expect(call.messages[0]!.content).not.toContain(THREAD.htmlBody);
  });

  it('strips HTML and uses htmlBody when no plaintext body', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'html summary' }],
    });
    const thread = { ...THREAD, plaintextBody: null };
    await buildDigestSummary('Summary', thread);
    const call = mockCreate.mock.calls[0]![0] as { messages: Array<{ content: string }> };
    expect(call.messages[0]!.content).not.toContain('<p>');
    expect(call.messages[0]!.content).toContain('Dear customer');
  });

  it('falls back to snippet when no body at all', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'snippet summary' }],
    });
    const thread = { ...THREAD, plaintextBody: null, htmlBody: null };
    await buildDigestSummary('Summary', thread);
    const call = mockCreate.mock.calls[0]![0] as { messages: Array<{ content: string }> };
    expect(call.messages[0]!.content).toContain(THREAD.snippet);
  });

  it('returns snippet on Anthropic API error (does not throw)', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API error'));
    const result = await buildDigestSummary('Summary: {text}', THREAD);
    expect(result).toBe(THREAD.snippet);
  });

  it('throws when ANTHROPIC_DIGEST_MODEL env var is not set', async () => {
    const original = process.env.ANTHROPIC_DIGEST_MODEL;
    delete process.env.ANTHROPIC_DIGEST_MODEL;
    await expect(buildDigestSummary('template', THREAD)).rejects.toThrow('ANTHROPIC_DIGEST_MODEL env var is not set');
    process.env.ANTHROPIC_DIGEST_MODEL = original;
  });

  it('falls back to snippet when API response contains no text block', async () => {
    mockCreate.mockResolvedValueOnce({ content: [] }); // no text block in response
    const result = await buildDigestSummary('Summary', THREAD);
    expect(result).toBe(THREAD.snippet);
  });
});

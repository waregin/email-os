import Anthropic from '@anthropic-ai/sdk';

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function buildDigestSummary(
  template: string,
  thread: {
    subject: string;
    sender: string;
    date: string;
    snippet: string;
    plaintextBody: string | null;
    htmlBody: string | null;
  }
): Promise<string> {
  if (!template || template.trim() === '') return '';

  const model = process.env.ANTHROPIC_DIGEST_MODEL;
  if (!model) throw new Error('ANTHROPIC_DIGEST_MODEL env var is not set');

  const body =
    thread.plaintextBody ??
    (thread.htmlBody ? stripHtml(thread.htmlBody) : null) ??
    thread.snippet;

  const prompt =
    `You are helping build a digest summary for an email triage system.\n\n` +
    `Given this digest template: "${template}"\n` +
    `And this email:\n` +
    `Subject: ${thread.subject}\n` +
    `From: ${thread.sender}\n` +
    `Date: ${thread.date}\n` +
    `Body:\n${body}\n\n` +
    `Fill in any {field} placeholders in the template with values extracted from the email content. ` +
    `Return only the completed summary string. If a field cannot be found, remove the placeholder ` +
    `and the surrounding punctuation gracefully. Never invent values.`;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
    return text?.trim() ?? thread.snippet;
  } catch {
    return thread.snippet;
  }
}

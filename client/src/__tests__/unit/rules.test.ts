import { describe, it, expect } from 'vitest';
import { parseProposal, describeTrigger } from '../../utils/rules';

describe('parseProposal', () => {
  it('returns the whole content as "before" with null proposal when no marker is present', () => {
    const result = parseProposal('Just a regular chat message.');
    expect(result).toEqual({ before: 'Just a regular chat message.', proposal: null, after: '' });
  });

  it('extracts a valid JSON proposal with surrounding text', () => {
    const content = `Here is my suggestion.
RULE_PROPOSAL:
{"trigger":{"type":"sender_domain","domain":"chase.com"},"action":"digest","priority":"T3","digestSummaryTemplate":"Statement ready"}
Let me know if that works.`;
    const result = parseProposal(content);
    expect(result.before).toBe('Here is my suggestion.');
    expect(result.proposal).not.toBeNull();
    expect(result.proposal!.priority).toBe('T3');
    expect(result.after).toBe('Let me know if that works.');
  });

  it('handles nested braces in the JSON via depth counting', () => {
    const content = `RULE_PROPOSAL:
{"trigger":{"type":"sender","sender":"a@b.com","nested":{"x":1}},"action":"digest","priority":"T1","digestSummaryTemplate":"x"}`;
    const result = parseProposal(content);
    expect(result.proposal).not.toBeNull();
    expect(result.proposal!.priority).toBe('T1');
  });

  it('returns null proposal for malformed JSON', () => {
    const content = `RULE_PROPOSAL:
{not valid json}`;
    const result = parseProposal(content);
    expect(result.proposal).toBeNull();
    expect(result.before).toBe(content);
  });

  it('returns null proposal when marker present but no opening brace follows', () => {
    const content = 'RULE_PROPOSAL: coming soon';
    const result = parseProposal(content);
    expect(result.proposal).toBeNull();
  });

  it('returns null proposal when braces never balance', () => {
    const content = 'RULE_PROPOSAL:\n{"unclosed": true';
    const result = parseProposal(content);
    expect(result.proposal).toBeNull();
  });

  it('captures text after the closing brace in "after"', () => {
    const content = `RULE_PROPOSAL:\n{"trigger":{},"action":"digest","priority":"T2","digestSummaryTemplate":"t"}\ntrailing note`;
    const result = parseProposal(content);
    expect(result.after).toBe('trailing note');
  });

  it('preserves categoryLabel when present in the proposal JSON', () => {
    const content = `RULE_PROPOSAL:
{"trigger":{"type":"sender_domain","domain":"news.com"},"action":"digest","priority":"T4","categoryLabel":"Newsletters","digestSummaryTemplate":"{subject}"}`;
    const result = parseProposal(content);
    expect(result.proposal).not.toBeNull();
    expect(result.proposal!.categoryLabel).toBe('Newsletters');
  });

  it('leaves categoryLabel undefined when absent from the proposal JSON', () => {
    const content = `RULE_PROPOSAL:
{"trigger":{"type":"sender_domain","domain":"acme.com"},"action":"digest","priority":"T3","digestSummaryTemplate":"{subject}"}`;
    const result = parseProposal(content);
    expect(result.proposal).not.toBeNull();
    expect(result.proposal!.categoryLabel).toBeUndefined();
  });
});

describe('describeTrigger', () => {
  it('describes a sender_domain trigger', () => {
    expect(describeTrigger({ type: 'sender_domain', domain: 'chase.com' })).toBe('From @chase.com');
  });

  it('describes a sender_domain trigger with a secondary any-of filter', () => {
    expect(describeTrigger({ type: 'sender_domain', domain: 'chase.com', subjectOrSnippetContainsAny: ['statement'] }))
      .toBe('From @chase.com + subject/snippet contains any of: "statement"');
  });

  it('describes a sender_domain trigger with a secondary all-of filter', () => {
    expect(describeTrigger({ type: 'sender_domain', domain: 'chase.com', subjectOrSnippetContainsAll: ['receipt', 'invoice'] }))
      .toBe('From @chase.com + subject/snippet contains all of: "receipt", "invoice"');
  });

  it('describes a sender trigger', () => {
    expect(describeTrigger({ type: 'sender', sender: 'alice@example.com' })).toBe('From alice@example.com');
  });

  it('describes a self_sent trigger', () => {
    expect(describeTrigger({ type: 'self_sent' })).toBe('Self-sent emails');
  });

  it('describes a subject_or_snippet_contains_any trigger', () => {
    expect(describeTrigger({ type: 'subject_or_snippet_contains_any', patterns: ['invoice'] }))
      .toBe('Subject/snippet contains any of: "invoice"');
  });

  it('describes a subject_or_snippet_contains_all trigger', () => {
    expect(describeTrigger({ type: 'subject_or_snippet_contains_all', patterns: ['receipt', 'order'] }))
      .toBe('Subject/snippet contains all of: "receipt", "order"');
  });

  it('describes a sender_name_contains trigger', () => {
    expect(describeTrigger({ type: 'sender_name_contains', pattern: 'John Smith' })).toBe('Sender name contains "John Smith"');
  });

  it('falls back to raw JSON for sender_name_contains with no pattern field', () => {
    const trigger = { type: 'sender_name_contains' };
    expect(describeTrigger(trigger)).toBe(JSON.stringify(trigger));
  });

  it('describes an address trigger', () => {
    expect(describeTrigger({ type: 'address', toAddress: 'list@example.com' })).toBe('Sent to list@example.com');
  });

  it('falls back to raw JSON when a required field is missing', () => {
    const trigger = { type: 'sender_domain' }; // no domain
    expect(describeTrigger(trigger)).toBe(JSON.stringify(trigger));
  });

  it('falls back to raw JSON for a sender trigger with no sender field', () => {
    const trigger = { type: 'sender' };
    expect(describeTrigger(trigger)).toBe(JSON.stringify(trigger));
  });

  it('falls back to raw JSON for subject_or_snippet_contains_any with no patterns', () => {
    const trigger = { type: 'subject_or_snippet_contains_any' };
    expect(describeTrigger(trigger)).toBe(JSON.stringify(trigger));
  });

  it('falls back to raw JSON for subject_or_snippet_contains_all with no patterns', () => {
    const trigger = { type: 'subject_or_snippet_contains_all' };
    expect(describeTrigger(trigger)).toBe(JSON.stringify(trigger));
  });

  it('falls back to raw JSON for an address trigger with no toAddress field', () => {
    const trigger = { type: 'address' };
    expect(describeTrigger(trigger)).toBe(JSON.stringify(trigger));
  });

  it('returns raw JSON for an unknown trigger type', () => {
    const trigger = { type: 'mystery' };
    expect(describeTrigger(trigger)).toBe(JSON.stringify(trigger));
  });

  it('parses a trigger passed as a JSON string', () => {
    expect(describeTrigger('{"type":"sender_domain","domain":"x.com"}')).toBe('From @x.com');
  });

  it('returns the raw string when given an unparseable string', () => {
    expect(describeTrigger('not json')).toBe('not json');
  });
});

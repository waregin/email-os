export interface ProposedRule {
  existingRuleId?: string;
  trigger: unknown;
  action: string;
  priority: string;
  categoryLabel?: string;
  digestSummaryTemplate: string;
  notes?: string;
}

export function parseProposal(content: string): { before: string; proposal: ProposedRule | null; after: string } {
  const idx = content.indexOf('RULE_PROPOSAL:');
  if (idx === -1) return { before: content, proposal: null, after: '' };

  const before = content.slice(0, idx).trim();
  const rest = content.slice(idx + 'RULE_PROPOSAL:'.length).trim();

  const jsonStart = rest.indexOf('{');
  if (jsonStart === -1) return { before: content, proposal: null, after: '' };

  let depth = 0;
  let jsonEnd = -1;
  for (let i = jsonStart; i < rest.length; i++) {
    if (rest[i] === '{') depth++;
    else if (rest[i] === '}') { depth--; if (depth === 0) { jsonEnd = i; break; } }
  }
  if (jsonEnd === -1) return { before: content, proposal: null, after: '' };

  const jsonStr = rest.slice(jsonStart, jsonEnd + 1);
  const after = rest.slice(jsonEnd + 1).trim();

  try {
    return { before, proposal: JSON.parse(jsonStr) as ProposedRule, after };
  } catch {
    return { before: content, proposal: null, after: '' };
  }
}

export function describeTrigger(trigger: unknown): string {
  const raw = typeof trigger === 'string' ? trigger : JSON.stringify(trigger);
  try {
    const t = (typeof trigger === 'string' ? JSON.parse(trigger) : trigger) as Record<string, unknown>;

    function secondaryFilters(): string {
      const any = t.subjectOrSnippetContainsAny as string[] | undefined;
      const all = t.subjectOrSnippetContainsAll as string[] | undefined;
      const parts: string[] = [];
      if (any?.length) parts.push(`subject/snippet contains any of: ${any.map((s) => `"${s}"`).join(', ')}`);
      if (all?.length) parts.push(`subject/snippet contains all of: ${all.map((s) => `"${s}"`).join(', ')}`);
      return parts.length ? ` + ${parts.join(' + ')}` : '';
    }

    switch (t.type) {
      case 'sender_domain': {
        const domain = t.domain as string | undefined;
        return domain ? `From @${domain}${secondaryFilters()}` : raw;
      }
      case 'sender': {
        const sender = t.sender as string | undefined;
        return sender ? `From ${sender}${secondaryFilters()}` : raw;
      }
      case 'self_sent':
        return `Self-sent emails${secondaryFilters()}`;
      case 'sender_name_contains': {
        const pattern = t.pattern as string | undefined;
        return pattern ? `Sender name contains "${pattern}"` : raw;
      }
      case 'subject_or_snippet_contains_any': {
        const patterns = t.patterns as string[] | undefined;
        return patterns?.length
          ? `Subject/snippet contains any of: ${patterns.map((p) => `"${p}"`).join(', ')}`
          : raw;
      }
      case 'subject_or_snippet_contains_all': {
        const patterns = t.patterns as string[] | undefined;
        return patterns?.length
          ? `Subject/snippet contains all of: ${patterns.map((p) => `"${p}"`).join(', ')}`
          : raw;
      }
      case 'list_id': {
        const listId = t.listId as string | undefined;
        return listId ? `Mailing list: ${listId}` : raw;
      }
      case 'address': {
        const addr = t.toAddress as string | undefined;
        return addr ? `Sent to ${addr}` : raw;
      }
      default: return raw;
    }
  } catch {
    return raw;
  }
}

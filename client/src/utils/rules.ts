export interface ProposedRule {
  existingRuleId?: string;
  trigger: unknown;
  action: string;
  priority: string;
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
    const t = (typeof trigger === 'string' ? JSON.parse(trigger) : trigger) as Record<string, string | undefined>;
    const pick = (...keys: string[]) => keys.map((k) => t[k]).find((v) => v !== undefined && v !== '');
    switch (t.type) {
      case 'sender_domain': {
        const domain = pick('domain');
        const sub = pick('subjectContains');
        return domain ? `From @${domain}${sub ? ` + subject contains "${sub}"` : ''}` : raw;
      }
      case 'sender': {
        const sender = pick('sender', 'email', 'address');
        const sub = pick('subjectContains');
        return sender ? `From ${sender}${sub ? ` + subject contains "${sub}"` : ''}` : raw;
      }
      case 'self_sent': {
        const sub = pick('subjectContains');
        return `Self-sent emails${sub ? ` with subject "${sub}"` : ''}`;
      }
      case 'subject_contains': {
        const val = pick('subjectContains', 'contains', 'keyword', 'text');
        return val ? `Subject contains "${val}"` : raw;
      }
      case 'subject_or_body_contains': {
        const val = pick('contains', 'subjectContains', 'keyword', 'text');
        const or = pick('orContains');
        return val ? `Subject/body contains "${val}"${or ? ` and "${or}"` : ''}` : raw;
      }
      case 'address': {
        const addr = pick('toAddress', 'address', 'email');
        return addr ? `Sent to ${addr}` : raw;
      }
      default: return raw;
    }
  } catch {
    return raw;
  }
}

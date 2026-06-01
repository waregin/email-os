export function parseSender(from: string): string {
  if (!from) return 'Unknown';
  const match = from.match(/^"?([^"<]+)"?\s*(?:<[^>]+>)?$/);
  return match?.[1]?.trim() || from;
}

export function formatDate(raw: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
}

import type { gmail_v1 } from 'googleapis';

export function makeHeaderGetter(headers: gmail_v1.Schema$MessagePartHeader[]) {
  return (name: string) =>
    headers.find((hdr) => hdr.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

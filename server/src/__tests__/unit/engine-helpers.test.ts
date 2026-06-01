import { describe, it, expect } from 'vitest';
import { extractAddress, extractDomain, extractBody } from '../../engine';

describe('extractAddress', () => {
  it('parses "Name <email>" format', () => {
    expect(extractAddress('Alice <alice@example.com>')).toBe('alice@example.com');
  });

  it('lowercases the address', () => {
    expect(extractAddress('ALICE@EXAMPLE.COM')).toBe('alice@example.com');
    expect(extractAddress('Alice <ALICE@EXAMPLE.COM>')).toBe('alice@example.com');
  });

  it('falls back to the raw string when no angle brackets', () => {
    expect(extractAddress('alice@example.com')).toBe('alice@example.com');
  });

  it('trims whitespace from the raw fallback', () => {
    expect(extractAddress('  alice@example.com  ')).toBe('alice@example.com');
  });

  it('handles empty string', () => {
    expect(extractAddress('')).toBe('');
  });
});

describe('extractDomain', () => {
  it('extracts the domain after @', () => {
    expect(extractDomain('alice@example.com')).toBe('example.com');
  });

  it('returns empty string when no @ present', () => {
    expect(extractDomain('not-an-email')).toBe('');
  });

  it('handles subdomains correctly', () => {
    expect(extractDomain('alice@mail.example.com')).toBe('mail.example.com');
  });
});

describe('extractBody', () => {
  function b64(str: string) {
    return Buffer.from(str).toString('base64url');
  }

  it('extracts text/plain body', () => {
    const result = extractBody({
      mimeType: 'text/plain',
      body: { data: b64('Hello plain text') },
    });
    expect(result.plain).toBe('Hello plain text');
    expect(result.html).toBeNull();
  });

  it('extracts text/html body', () => {
    const result = extractBody({
      mimeType: 'text/html',
      body: { data: b64('<p>Hello HTML</p>') },
    });
    expect(result.html).toBe('<p>Hello HTML</p>');
    expect(result.plain).toBeNull();
  });

  it('returns nulls for missing body data', () => {
    expect(extractBody({ mimeType: 'text/plain', body: {} })).toEqual({ html: null, plain: null });
    expect(extractBody({ mimeType: 'text/html', body: {} })).toEqual({ html: null, plain: null });
  });

  it('recurses into multipart and returns both plain and html', () => {
    const result = extractBody({
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: b64('plain part') } },
        { mimeType: 'text/html', body: { data: b64('<b>html part</b>') } },
      ],
    });
    expect(result.plain).toBe('plain part');
    expect(result.html).toBe('<b>html part</b>');
  });

  it('recurses into nested multipart', () => {
    const result = extractBody({
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: b64('nested plain') } },
          ],
        },
      ],
    });
    expect(result.plain).toBe('nested plain');
  });

  it('returns nulls for unknown mime type', () => {
    const result = extractBody({ mimeType: 'application/pdf', body: { data: b64('binary') } });
    expect(result).toEqual({ html: null, plain: null });
  });

  it('returns nulls for missing mimeType', () => {
    const result = extractBody({ body: { data: b64('data') } });
    expect(result).toEqual({ html: null, plain: null });
  });

  it('handles multipart with no parts array', () => {
    const result = extractBody({ mimeType: 'multipart/alternative' });
    expect(result).toEqual({ html: null, plain: null });
  });
});

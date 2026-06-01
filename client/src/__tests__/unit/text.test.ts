import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseSender, formatDate } from '../../utils/text';

describe('parseSender', () => {
  it('extracts the name from "Name <email>" format', () => {
    expect(parseSender('Alice Smith <alice@example.com>')).toBe('Alice Smith');
  });

  it('returns the bare address when there is no display name', () => {
    expect(parseSender('alice@example.com')).toBe('alice@example.com');
  });

  it('returns "Unknown" for an empty string', () => {
    expect(parseSender('')).toBe('Unknown');
  });

  it('strips surrounding quotes from a quoted display name', () => {
    expect(parseSender('"Alice Smith" <alice@example.com>')).toBe('Alice Smith');
  });

  it('trims surrounding whitespace from the extracted name', () => {
    expect(parseSender('  Bob  <bob@example.com>')).toBe('Bob');
  });
});

describe('formatDate', () => {
  // Pin "now" so relative formatting is deterministic
  const FIXED_NOW = new Date('2024-06-15T12:00:00');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty string for empty input', () => {
    expect(formatDate('')).toBe('');
  });

  it('passes through a non-parseable date string unchanged', () => {
    expect(formatDate('not a date')).toBe('not a date');
  });

  it('formats a same-day date as a time (HH:MM)', () => {
    const result = formatDate('2024-06-15T09:30:00');
    // Time format varies by locale; assert it looks like a time, not a date
    expect(result).toMatch(/\d{1,2}:\d{2}/);
    expect(result).not.toMatch(/Jun/);
  });

  it('formats a same-year, different-day date as "Mon D"', () => {
    const result = formatDate('2024-03-10T09:30:00');
    expect(result).toContain('Mar');
    expect(result).toContain('10');
    expect(result).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it('formats a different-year date with a 2-digit year', () => {
    const result = formatDate('2022-03-10T09:30:00');
    expect(result).toContain('Mar');
    expect(result).toMatch(/22/);
  });
});

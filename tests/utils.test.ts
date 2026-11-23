import { describe, expect, it } from 'vitest';
import { updated } from '../src/lib/utils';

describe('updated', () => {
  const now = Date.parse('2026-11-22T12:00Z');
  it('says how long ago for recent times', () => {
    expect(updated('2026-11-22T11:59Z', now)).toBe('updated just now');
    expect(updated('2026-11-22T11:20Z', now)).toBe('updated 40m ago');
    expect(updated('2026-11-22T09:00Z', now)).toBe('updated 3h ago');
  });
  it('gives the date for older times and plain dates', () => {
    expect(updated('2026-11-18T09:00Z', now)).toMatch(/^updated .*18/);
    expect(updated('2026-11-22', now)).toMatch(/^updated .*22/);
    expect(updated('nonsense', now)).toBe('');
  });
});

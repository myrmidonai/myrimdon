import { describe, it, expect } from 'vitest';
import { isOscillating } from '../../src/core/autonomy/similarity-detector.js';

describe('isOscillating', () => {
  it('returns true when SHA-256 sets are identical', () => {
    const prev = ['abc123', 'def456'];
    const curr = ['abc123', 'def456'];
    expect(isOscillating(prev, curr)).toBe(true);
  });

  it('returns false when outputs differ', () => {
    const prev = ['abc123'];
    const curr = ['abc123', 'new789'];
    expect(isOscillating(prev, curr)).toBe(false);
  });

  it('returns false when no previous outputs', () => {
    expect(isOscillating([], ['abc123'])).toBe(false);
  });

  it('returns false when both empty (first attempt)', () => {
    expect(isOscillating([], [])).toBe(false);
  });
});

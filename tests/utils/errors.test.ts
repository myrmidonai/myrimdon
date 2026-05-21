import { describe, it, expect } from 'vitest';
import { MyrmidonError } from '../../src/utils/errors.js';

describe('MyrmidonError', () => {
  it('sets code and message', () => {
    const err = new MyrmidonError('CONFIG_NOT_FOUND', 'no config here');
    expect(err.code).toBe('CONFIG_NOT_FOUND');
    expect(err.message).toBe('no config here');
    expect(err.name).toBe('MyrmidonError');
    expect(err).toBeInstanceOf(Error);
  });

  it('wraps cause', () => {
    const cause = new Error('original');
    const err = new MyrmidonError('WRAP', 'wrapped', { cause });
    expect(err.cause).toBe(cause);
  });
});

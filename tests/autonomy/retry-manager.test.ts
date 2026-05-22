import { describe, it, expect } from 'vitest';
import { RetryManager } from '../../src/core/autonomy/retry-manager.js';

describe('RetryManager', () => {
  it('auto-retries below notifyAttempt', () => {
    const rm = new RetryManager({ maxAttempts: 3, notifyAttempt: 2, retryIntervalMs: 0 });
    expect(rm.onFailure(1)).toEqual({ action: 'retry', notify: false });
  });

  it('retries and notifies at notifyAttempt', () => {
    const rm = new RetryManager({ maxAttempts: 3, notifyAttempt: 2, retryIntervalMs: 0 });
    expect(rm.onFailure(2)).toEqual({ action: 'retry', notify: true });
  });

  it('pauses at maxAttempts', () => {
    const rm = new RetryManager({ maxAttempts: 3, notifyAttempt: 2, retryIntervalMs: 0 });
    expect(rm.onFailure(3)).toEqual({ action: 'pause', notify: true });
  });

  it('pauses immediately on oscillation regardless of attempt count', () => {
    const rm = new RetryManager({ maxAttempts: 10, notifyAttempt: 8, retryIntervalMs: 0 });
    expect(rm.onOscillation()).toEqual({ action: 'pause', notify: true });
  });
});

export interface RetryConfig {
  maxAttempts: number;
  notifyAttempt: number;
  retryIntervalMs: number;
}

export type RetryDecision = { action: 'retry' | 'pause'; notify: boolean };

export class RetryManager {
  constructor(private readonly cfg: RetryConfig) {}

  onFailure(attemptNumber: number): RetryDecision {
    if (attemptNumber >= this.cfg.maxAttempts) return { action: 'pause', notify: true };
    const notify = attemptNumber >= this.cfg.notifyAttempt;
    return { action: 'retry', notify };
  }

  onOscillation(): RetryDecision {
    return { action: 'pause', notify: true };
  }
}

export function defaultRetryConfig(overrides?: Partial<RetryConfig>): RetryConfig {
  return { maxAttempts: 3, notifyAttempt: 2, retryIntervalMs: 30_000, ...overrides };
}

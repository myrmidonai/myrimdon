import type { Scheduler, Lease } from '../scheduler.js';

export class NoopScheduler implements Scheduler {
  async claim(runId: string): Promise<Lease> {
    return { runId, fencingToken: 1 };
  }
  async renew(_lease: Lease): Promise<void> {}
  async release(_lease: Lease): Promise<void> {}
}

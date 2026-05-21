export type TimerId =
  | 'workflow-poll'
  | 'agent-heartbeat'
  | 'client-timeout'
  | 'stuck-detection'
  | 'state-consistency'
  | 'external-dep-watch';

export interface TimerConfig {
  intervalMs: number;
  callback: () => Promise<void>;
}

export class TimerManager {
  private readonly handles = new Map<TimerId, ReturnType<typeof setInterval>>();
  private readonly active = new Set<TimerId>();

  start(id: TimerId, config: TimerConfig): void {
    this.stop(id);
    const handle = setInterval(() => {
      if (this.active.has(id)) return; // overlap protection
      this.active.add(id);
      config.callback().finally(() => this.active.delete(id));
    }, config.intervalMs);
    this.handles.set(id, handle);
  }

  stop(id: TimerId): void {
    const handle = this.handles.get(id);
    if (handle !== undefined) {
      clearInterval(handle);
      this.handles.delete(id);
    }
  }

  stopAll(): void {
    for (const id of [...this.handles.keys()]) this.stop(id);
  }

  isRunning(id: TimerId): boolean {
    return this.handles.has(id);
  }
}

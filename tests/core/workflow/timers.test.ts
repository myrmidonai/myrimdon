import { describe, it, expect, vi, afterEach } from 'vitest';
import { TimerManager } from '../../../src/core/workflow/timers.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('TimerManager', () => {
  it('fires callback after interval', async () => {
    vi.useFakeTimers();
    const mgr = new TimerManager();
    const calls: number[] = [];
    mgr.start('workflow-poll', { intervalMs: 100, callback: async () => { calls.push(Date.now()); } });
    await vi.advanceTimersByTimeAsync(250);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    mgr.stopAll();
  });

  it('isRunning() returns true after start, false after stop', () => {
    vi.useFakeTimers();
    const mgr = new TimerManager();
    mgr.start('agent-heartbeat', { intervalMs: 1000, callback: async () => undefined });
    expect(mgr.isRunning('agent-heartbeat')).toBe(true);
    mgr.stop('agent-heartbeat');
    expect(mgr.isRunning('agent-heartbeat')).toBe(false);
  });

  it('stopAll() clears all timers', () => {
    vi.useFakeTimers();
    const mgr = new TimerManager();
    mgr.start('workflow-poll', { intervalMs: 1000, callback: async () => undefined });
    mgr.start('agent-heartbeat', { intervalMs: 1000, callback: async () => undefined });
    mgr.stopAll();
    expect(mgr.isRunning('workflow-poll')).toBe(false);
    expect(mgr.isRunning('agent-heartbeat')).toBe(false);
  });

  it('overlap protection: does not fire again while previous callback is still running', async () => {
    vi.useFakeTimers();
    const mgr = new TimerManager();
    let concurrent = 0;
    let maxConcurrent = 0;
    mgr.start('workflow-poll', {
      intervalMs: 50,
      callback: async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
        concurrent--;
      },
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(maxConcurrent).toBe(1);
    mgr.stopAll();
  });
});

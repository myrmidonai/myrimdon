import { spawn as nodeSpawn } from 'node:child_process';
import type { ExecutionBackend, SpawnOpts, WorkerHandle, HeartbeatStatus } from '../execution-backend.js';

export class LocalExecutionBackend implements ExecutionBackend {
  async spawn(opts: SpawnOpts): Promise<WorkerHandle> {
    // Stub: spawn a no-op process. Replaced in Task 9 with real claude dispatch.
    const child = nodeSpawn(process.execPath, ['--version'], { detached: false });
    return { pid: child.pid ?? 0, worktreePath: opts.worktreePath, execId: opts.execId };
  }

  async heartbeat(handle: WorkerHandle): Promise<HeartbeatStatus> {
    try {
      process.kill(handle.pid, 0);
      return { alive: true, lastSeen: Date.now() };
    } catch {
      return { alive: false, lastSeen: 0 };
    }
  }

  async kill(handle: WorkerHandle, signal: 'SIGTERM' | 'SIGKILL'): Promise<void> {
    try { process.kill(handle.pid, signal); } catch { /* already dead */ }
  }
}

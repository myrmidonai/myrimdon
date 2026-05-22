import { spawn as nodeSpawn, execSync } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { ExecutionBackend, SpawnOpts, WorkerHandle, HeartbeatStatus } from '../execution-backend.js';

export class LocalExecutionBackend implements ExecutionBackend {
  constructor(private readonly projectRoot: string = process.cwd()) {}

  async spawn(opts: SpawnOpts): Promise<WorkerHandle> {
    const { execId, worktreePath, dispatchFilePath } = opts;

    // Ensure worktree directory exists (created by engine before calling spawn)
    if (!existsSync(worktreePath)) {
      throw new Error(`Worktree path does not exist: ${worktreePath}`);
    }

    // Spawn claude-code CLI: read DISPATCH.md as stdin, run in worktree
    // claude --no-tui reads from stdin by default when stdin is not a terminal
    const child = nodeSpawn(
      'claude',
      ['--no-tui'],
      {
        cwd: worktreePath,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
      },
    );

    // Write DISPATCH.md content to stdin and close
    const dispatchContent = readFileSync(dispatchFilePath, 'utf8');
    child.stdin?.write(dispatchContent);
    child.stdin?.end();

    child.unref(); // allow parent to exit independently

    const pid = child.pid ?? 0;
    return { pid, worktreePath, execId };
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

export function createWorktree(projectRoot: string, runId: string, nodeId: string): string {
  const branch = `myrmidon/${runId.slice(0, 8)}/${nodeId}`;
  const worktreePath = resolve(projectRoot, '.myrmidon', 'runs', runId, nodeId, 'worktree');
  mkdirSync(dirname(worktreePath), { recursive: true });
  try {
    execSync(`git worktree add "${worktreePath}" -b "${branch}"`, { cwd: projectRoot, stdio: 'pipe' });
  } catch (err) {
    // If branch already exists, just add the worktree pointing to HEAD
    execSync(`git worktree add "${worktreePath}" HEAD`, { cwd: projectRoot, stdio: 'pipe' });
  }
  return worktreePath;
}

export function removeWorktree(projectRoot: string, worktreePath: string): void {
  try {
    execSync(`git worktree remove --force "${worktreePath}"`, { cwd: projectRoot, stdio: 'pipe' });
  } catch { /* ignore if already removed */ }
}

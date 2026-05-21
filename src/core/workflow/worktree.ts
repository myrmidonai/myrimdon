import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';

export interface WorktreeEntry {
  branch: string;
  path: string;
  port: number;
  agent: string | null;
  status: string;
}

export class WorktreeManager {
  constructor(
    private readonly projectRoot: string,
    private readonly db: Database.Database,
    private readonly basePort: number,
  ) {}

  allocatePort(taskId: string): number {
    const offset = Math.abs(hashString(taskId)) % 1000;
    const primary = this.basePort + offset;

    const occupied = (port: number) =>
      !!this.db
        .prepare("SELECT 1 FROM worktrees WHERE port = ? AND status = 'active'")
        .get(port);

    if (!occupied(primary)) return primary;

    const fallback = this.basePort + 500 + offset;
    if (!occupied(fallback)) return fallback;

    throw new Error(`Cannot allocate port for task ${taskId}: both ${primary} and ${fallback} are in use`);
  }

  create(opts: { branch: string; taskId: string; agent: string }): string {
    const port = this.allocatePort(opts.taskId);
    const worktreePath = resolve(this.projectRoot, '.myrmidon', 'worktrees', opts.branch);
    mkdirSync(resolve(this.projectRoot, '.myrmidon', 'worktrees'), { recursive: true });

    execSync(`git worktree add -b ${opts.branch} ${worktreePath}`, {
      cwd: this.projectRoot,
      stdio: 'pipe',
    });

    this.db
      .prepare(
        'INSERT INTO worktrees (branch, path, task_id, port, agent, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(opts.branch, worktreePath, opts.taskId, port, opts.agent, new Date().toISOString(), 'active');

    return worktreePath;
  }

  remove(branch: string): void {
    const row = this.db
      .prepare('SELECT path FROM worktrees WHERE branch = ?')
      .get(branch) as { path: string } | undefined;
    if (!row) return;

    try {
      execSync(`git worktree remove --force ${row.path}`, {
        cwd: this.projectRoot,
        stdio: 'pipe',
      });
    } catch {
      // Best-effort removal; ignore filesystem errors
    }

    this.db
      .prepare("UPDATE worktrees SET status = 'removed' WHERE branch = ?")
      .run(branch);
  }

  list(): WorktreeEntry[] {
    return this.db
      .prepare('SELECT branch, path, port, agent, status FROM worktrees')
      .all() as WorktreeEntry[];
  }
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // coerce to 32-bit int
  }
  return hash;
}

import type Database from 'better-sqlite3';
import type { NotificationBus } from './notifications.js';

export interface MonitorConfig {
  stuckThresholdMs: number;
  heartbeatIntervalMs: number;
}

interface ExecProc {
  id: number;
  session_id: string;
  agent_id: string;
  pid: number;
}

interface NodeExec {
  status: string;
}

export class AgentMonitor {
  constructor(
    private readonly db: Database.Database,
    private readonly bus: NotificationBus,
    private readonly config: MonitorConfig,
  ) {}

  async checkHeartbeats(): Promise<void> {
    const procs = this.db
      .prepare("SELECT id, session_id, agent_id, pid FROM executor_procs WHERE killed_at IS NULL")
      .all() as ExecProc[];

    for (const proc of procs) {
      if (isPidAlive(proc.pid)) continue;

      const now = new Date().toISOString();
      this.db.prepare('UPDATE executor_procs SET killed_at = ? WHERE id = ?').run(now, proc.id);

      const exec = this.db
        .prepare("SELECT status FROM node_executions WHERE id = ?")
        .get(proc.session_id) as NodeExec | undefined;

      if (exec?.status === 'running') {
        this.db
          .prepare(
            "UPDATE node_executions SET status = 'failed', error = ?, completed_at = ? WHERE id = ?",
          )
          .run('Process died unexpectedly', now, proc.session_id);
        await this.bus.notify('node_failed', { sessionId: proc.session_id, agentId: proc.agent_id });
      }
    }
  }

  async checkStuckAgents(): Promise<void> {
    const threshold = new Date(Date.now() - this.config.stuckThresholdMs).toISOString();
    const stuck = this.db
      .prepare(
        "SELECT id, node_id FROM node_executions WHERE status = 'running' AND started_at < ?",
      )
      .all(threshold) as Array<{ id: string; node_id: string }>;

    for (const exec of stuck) {
      await this.bus.notify('agent_stuck', { executionId: exec.id, nodeId: exec.node_id });
    }
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

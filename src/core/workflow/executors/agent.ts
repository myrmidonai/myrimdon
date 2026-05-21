import type { NodeExecutor, NodeContext, NodeResult } from '../executor-registry.js';
import { buildDispatchPrompt, writeDispatchPrompt } from '../dispatcher.js';

export class AgentExecutor implements NodeExecutor {
  readonly type = 'agent' as const;

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const { node, workflowId, runId, db, config, runtimeAdapter, projectRoot } = ctx;

    const executorKey = node.executor ?? 'sonnet';
    const executorConfig = config.executors[executorKey];
    if (!executorConfig) {
      return { status: 'failed', error: `Executor '${executorKey}' not found in config` };
    }

    const prompt = buildDispatchPrompt({ node, workflowId, runId, db, config, projectRoot });
    const promptFile = writeDispatchPrompt({ prompt, projectRoot });

    let spawnedProc: { pid: number; kill: (s: 'SIGTERM' | 'SIGKILL') => void };
    try {
      spawnedProc = await runtimeAdapter.spawn({
        promptFile,
        cwd: projectRoot,
        dbPath: prompt.dbPath,
        env: {},
      });
    } catch (err) {
      return { status: 'failed', error: String(err) };
    }

    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO executor_procs (session_id, agent_id, task_id, pid, proc_type, started_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(ctx.executionId, node.id, node.id, spawnedProc.pid, 'agent', now);

    return { status: 'running', outputJson: { pid: spawnedProc.pid, promptFile } };
  }
}
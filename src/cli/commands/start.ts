import { Command } from 'commander';
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { loadConfig } from '../../core/config/loader.js';
import { openDatabase } from '../../core/database/client.js';
import { WorkflowEngine } from '../../core/workflow/engine.js';
import { ExecutorRegistry } from '../../core/workflow/executor-registry.js';
import { TriggerExecutor } from '../../core/workflow/executors/trigger.js';
import { ConditionExecutor } from '../../core/workflow/executors/condition.js';
import { ParallelForkExecutor, JoinExecutor } from '../../core/workflow/executors/parallel.js';
import { TransformExecutor } from '../../core/workflow/executors/transform.js';
import { LoopExecutor } from '../../core/workflow/executors/loop.js';
import { HumanApprovalExecutor } from '../../core/workflow/executors/human-approval.js';
import { AgentExecutor } from '../../core/workflow/executors/agent.js';
import { TimerManager } from '../../core/workflow/timers.js';
import { AgentMonitor } from '../../core/workflow/monitor.js';
import { ConsoleBus } from '../../core/workflow/notifications.js';
import { createRuntimeAdapter } from '../../core/workflow/runtime-adapter.js';

export function makeStartCommand(): Command {
  const cmd = new Command('start')
    .description('Start a workflow run')
    .option('--workflow <id>', 'workflow ID to run')
    .option('--resume', 'resume the most recent interrupted run')
    .option('--no-tui', 'headless mode (console output only)')
    .action(async (opts: { workflow?: string; resume?: boolean }) => {
      const cwd = process.cwd();
      const config = await loadConfig(cwd);
      const db = openDatabase(cwd);

      const firstExecutor = Object.values(config.executors)[0];
      const defaultRuntime = firstExecutor?.runtime ?? 'claude-code';
      const adapter = createRuntimeAdapter(defaultRuntime);

      const registry = new ExecutorRegistry();
      registry.register(new TriggerExecutor());
      registry.register(new ConditionExecutor());
      registry.register(new ParallelForkExecutor());
      registry.register(new JoinExecutor());
      registry.register(new TransformExecutor());
      registry.register(new LoopExecutor());
      registry.register(new HumanApprovalExecutor());
      registry.register(new AgentExecutor());

      const bus = new ConsoleBus();
      const engine = new WorkflowEngine(db, registry, adapter, bus, config, cwd);

      if (opts.resume) {
        await engine.recover();
        console.log('[engine] Recovered from previous run');
      } else {
        const workflowId = opts.workflow ?? config.workflows?.[0];
        if (!workflowId) {
          console.error('No workflow specified. Use --workflow <id> or add workflows to config.');
          process.exit(1);
        }
        const runId = await engine.start(workflowId);
        console.log(`[engine] Started workflow "${workflowId}" run=${runId}`);
      }

      const stuckMs = 60_000;
      const monitor = new AgentMonitor(db, bus, { stuckThresholdMs: stuckMs, heartbeatIntervalMs: 15_000 });

      const timers = new TimerManager();

      const pollMs = 30_000;
      timers.start('workflow-poll', {
        intervalMs: pollMs,
        callback: async () => engine.tick(),
      });
      timers.start('agent-heartbeat', {
        intervalMs: 15_000,
        callback: async () => monitor.checkHeartbeats(),
      });
      timers.start('stuck-detection', {
        intervalMs: stuckMs,
        callback: async () => monitor.checkStuckAgents(),
      });

      // Write PID file for stop command
      const pidFile = resolve(cwd, '.myrmidon', 'runtime', 'engine.pid');
      mkdirSync(resolve(cwd, '.myrmidon', 'runtime'), { recursive: true });
      writeFileSync(pidFile, String(process.pid), 'utf8');

      const shutdown = () => {
        console.log('\n[engine] Shutting down...');
        timers.stopAll();
        db.close();
        process.exit(0);
      };
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);

      console.log('[engine] Running. Press Ctrl+C to stop.');

      // Initial tick immediately
      await engine.tick();
    });

  return cmd;
}

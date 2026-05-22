import { Command } from 'commander';
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { loadConfig } from '../../core/config/loader.js';
import { openDatabase } from '../../core/database/client.js';
import { WorkflowEngine } from '../../core/engine/workflow-engine.js';
import { ExecutorRegistry } from '../../core/workflow/executor-registry.js';
import { TriggerExecutor } from '../../core/workflow/executors/trigger.js';
import { ConditionExecutor } from '../../core/workflow/executors/condition.js';
import { ParallelForkExecutor, JoinExecutor } from '../../core/workflow/executors/parallel.js';
import { TransformExecutor } from '../../core/workflow/executors/transform.js';
import { LoopExecutor } from '../../core/workflow/executors/loop.js';
import { HumanApprovalExecutor } from '../../core/workflow/executors/human-approval.js';
import { AgentExecutor } from '../../core/workflow/executors/agent.js';
import { TimerManager } from '../../core/workflow/timers.js';
import { ConsoleBus } from '../../core/workflow/notifications.js';
import { SqliteStateStore } from '../../core/foundation/impl/sqlite-state-store.js';
import { LocalArtifactStore } from '../../core/foundation/impl/local-artifact-store.js';
import { LocalExecutionBackend } from '../../core/foundation/impl/local-execution-backend.js';
import { NoopScheduler } from '../../core/foundation/impl/noop-scheduler.js';
import { Reconciler } from '../../core/reconciler/reconciler.js';
import { softwareDevAgileWorkflow } from '../../core/templates/software-dev-agile/index.js';
import { startTUI } from '../../tui/index.js';

export function makeStartCommand(): Command {
  const cmd = new Command('start')
    .description('Start a workflow run')
    .option('--workflow <id>', 'workflow ID to run')
    .option('--resume', 'resume the most recent interrupted run')
    .option('--no-tui', 'headless mode (console output only)')
    .action(async (opts: { workflow?: string; resume?: boolean; tui?: boolean }) => {
      const cwd = process.cwd();
      const config = await loadConfig(cwd);
      const db = openDatabase(cwd);

      const stateStore = new SqliteStateStore(db);
      const artifactStore = new LocalArtifactStore(cwd);
      const backend = new LocalExecutionBackend(cwd);
      const scheduler = new NoopScheduler();

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
      const engine = new WorkflowEngine(stateStore, artifactStore, backend, scheduler, registry, cwd, bus);
      engine.register(softwareDevAgileWorkflow);

      const reconciler = new Reconciler(stateStore, artifactStore, db);
      reconciler.start();

      if (opts.resume) {
        await engine.recover();
        console.log('[engine] Recovered from previous run');
      } else {
        const workflowId = opts.workflow ?? 'software-dev-agile';
        const runId = await engine.start(workflowId);
        console.log(`[engine] Started workflow "${workflowId}" run=${runId}`);
      }

      const timers = new TimerManager();
      const pollMs = 30_000;
      timers.start('workflow-poll', {
        intervalMs: pollMs,
        callback: async () => engine.tick(),
      });

      // Write PID file for stop command
      const pidFile = resolve(cwd, '.myrmidon', 'runtime', 'engine.pid');
      mkdirSync(resolve(cwd, '.myrmidon', 'runtime'), { recursive: true });
      writeFileSync(pidFile, String(process.pid), 'utf8');

      const shutdown = () => {
        console.log('\n[engine] Shutting down...');
        reconciler.stop();
        timers.stopAll();
        db.close();
        process.exit(0);
      };
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);

      if (opts.tui !== false) {
        startTUI(db, stateStore);
      } else {
        console.log('[engine] Running in headless mode. Press Ctrl+C to stop.');
      }

      // Initial tick immediately
      await engine.tick();
    });

  return cmd;
}

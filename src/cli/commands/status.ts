import { Command } from 'commander';
import { openDatabase } from '../../core/database/client.js';

export function makeStatusCommand(): Command {
  return new Command('status')
    .description('Show the current workflow run status')
    .option('--json', 'output as JSON')
    .action((opts: { json?: boolean }) => {
      const db = openDatabase(process.cwd());

      const run = db
        .prepare(
          "SELECT id, workflow_id, status, started_at, completed_at FROM workflow_runs ORDER BY started_at DESC LIMIT 1",
        )
        .get() as { id: string; workflow_id: string; status: string; started_at: string; completed_at: string | null } | undefined;

      if (!run) {
        console.log('No workflow runs found.');
        db.close();
        return;
      }

      const execs = db
        .prepare('SELECT node_id, status, started_at, completed_at FROM node_executions WHERE run_id = ?')
        .all(run.id) as Array<{ node_id: string; status: string; started_at: string | null; completed_at: string | null }>;

      if (opts.json) {
        console.log(JSON.stringify({ run, nodes: execs }, null, 2));
      } else {
        console.log(`Workflow:  ${run.workflow_id}`);
        console.log(`Run ID:    ${run.id}`);
        console.log(`Status:    ${run.status}`);
        console.log(`Started:   ${run.started_at}`);
        if (run.completed_at) console.log(`Completed: ${run.completed_at}`);
        console.log('\nNodes:');
        for (const exec of execs) {
          console.log(`  ${exec.node_id.padEnd(24)} ${exec.status}`);
        }
      }

      db.close();
    });
}

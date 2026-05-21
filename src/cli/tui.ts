import { openDatabase } from '../core/database/client.js';

export async function launchTUI(): Promise<void> {
  // @ts-expect-error inquirer v9 lacks TypeScript definitions
  const { default: inquirer } = await import('inquirer');

  console.log('\n  Myrmidon — AI Workflow Engine\n');

  const db = openDatabase(process.cwd());

  // Show latest run status
  const run = db
    .prepare(
      "SELECT id, workflow_id, status, started_at FROM workflow_runs ORDER BY started_at DESC LIMIT 1",
    )
    .get() as { id: string; workflow_id: string; status: string; started_at: string } | undefined;

  if (run) {
    console.log(`  Latest run: ${run.workflow_id} — ${run.status} (${run.started_at})\n`);
  } else {
    console.log('  No workflow runs yet.\n');
  }
  db.close();

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: 'Start workflow', value: 'start' },
        { name: 'View status', value: 'status' },
        { name: 'List workflows', value: 'list' },
        { name: 'Exit', value: 'exit' },
      ],
    },
  ]);

  switch (action) {
    case 'start': {
      console.log('\nRun: myrmidon start --workflow <id>');
      break;
    }
    case 'status': {
      const { execSync } = await import('node:child_process');
      try {
        execSync('npx myrmidon status', { stdio: 'inherit' });
      } catch {
        // ignore exit code
      }
      break;
    }
    case 'list': {
      const { execSync } = await import('node:child_process');
      try {
        execSync('npx myrmidon workflow list', { stdio: 'inherit' });
      } catch {
        // ignore exit code
      }
      break;
    }
    case 'exit':
    default:
      console.log('Goodbye!');
      break;
  }
}

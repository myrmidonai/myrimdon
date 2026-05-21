import { Command } from 'commander';
import { openDatabase } from '../../core/database/client.js';
import { WorkflowDefSchema } from '../../core/workflow/schema.js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function makeWorkflowCommand(): Command {
  const cmd = new Command('workflow').description('Manage workflow definitions');

  cmd
    .command('list')
    .description('List registered workflows')
    .action(() => {
      const db = openDatabase(process.cwd());
      const rows = db
        .prepare('SELECT id, version, name, updated_at FROM workflows ORDER BY id')
        .all() as Array<{ id: string; version: string; name: string; updated_at: string }>;
      if (rows.length === 0) {
        console.log('No workflows registered. Use `workflow load <path>` to add one.');
      } else {
        for (const row of rows) {
          console.log(`  ${row.id.padEnd(32)} v${row.version}  ${row.name}`);
        }
      }
      db.close();
    });

  cmd
    .command('load <path>')
    .description('Load a workflow DSL file into the database')
    .action(async (filePath: string) => {
      const absPath = resolve(process.cwd(), filePath);
      if (!existsSync(absPath)) {
        console.error(`File not found: ${absPath}`);
        process.exit(1);
      }
      // Dynamic import for TypeScript/ESM DSL files
      const mod = await import(absPath) as Record<string, unknown>;
      const exported = Object.values(mod).find((v) => v && typeof v === 'object' && 'nodes' in (v as object));
      if (!exported) {
        console.error('Could not find a WorkflowDef export in', filePath);
        process.exit(1);
      }
      const result = WorkflowDefSchema.safeParse(exported);
      if (!result.success) {
        console.error('Invalid workflow definition:', result.error.message);
        process.exit(1);
      }
      const db = openDatabase(process.cwd());
      const now = new Date().toISOString();
      db.prepare(
        'INSERT OR REPLACE INTO workflows (id, version, name, def_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(result.data.id, result.data.version, result.data.name, JSON.stringify(result.data), now, now);
      console.log(`[workflow] Loaded "${result.data.id}" v${result.data.version}`);
      db.close();
    });

  cmd
    .command('validate <id>')
    .description('Validate a registered workflow definition')
    .action((id: string) => {
      const db = openDatabase(process.cwd());
      const row = db
        .prepare('SELECT def_json FROM workflows WHERE id = ?')
        .get(id) as { def_json: string } | undefined;
      if (!row) {
        console.error(`Workflow "${id}" not found`);
        process.exit(1);
      }
      const def = JSON.parse(row.def_json) as unknown;
      const result = WorkflowDefSchema.safeParse(def);
      if (result.success) {
        console.log(`✓ Workflow "${id}" is valid (${result.data.nodes.length} nodes, ${result.data.edges.length} edges)`);
      } else {
        console.error(`✗ Workflow "${id}" is invalid:`);
        console.error(result.error.message);
        process.exit(1);
      }
      db.close();
    });

  cmd
    .command('show <id>')
    .description('Show workflow definition details')
    .action((id: string) => {
      const db = openDatabase(process.cwd());
      const row = db
        .prepare('SELECT def_json FROM workflows WHERE id = ?')
        .get(id) as { def_json: string } | undefined;
      if (!row) {
        console.error(`Workflow "${id}" not found`);
        process.exit(1);
      }
      console.log(JSON.stringify(JSON.parse(row.def_json), null, 2));
      db.close();
    });

  cmd
    .command('runs [id]')
    .description('List workflow run history')
    .action((id?: string) => {
      const db = openDatabase(process.cwd());
      const rows = id
        ? (db
            .prepare('SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 20')
            .all(id) as Array<Record<string, unknown>>)
        : (db
            .prepare('SELECT * FROM workflow_runs ORDER BY started_at DESC LIMIT 20')
            .all() as Array<Record<string, unknown>>);
      if (rows.length === 0) {
        console.log('No runs found.');
      } else {
        for (const row of rows) {
          console.log(
            `  ${String(row['id']).slice(0, 8)}  ${String(row['workflow_id']).padEnd(24)}  ${String(row['status']).padEnd(12)}  ${String(row['started_at'])}`,
          );
        }
      }
      db.close();
    });

  return cmd;
}

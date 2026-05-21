import { Command } from 'commander';
import { loadConfig } from '../../core/config/loader.js';
import { openDatabase } from '../../core/database/client.js';
import { MyrmidonError } from '../../utils/errors.js';

export function makeConfigCommand(): Command {
  const cmd = new Command('config').description('Manage Myrmidon configuration');

  cmd.command('validate')
    .description('Validate myrmidon.config.ts against schema')
    .action(async () => {
      try {
        const config = await loadConfig(process.cwd());
        console.log('✓ myrmidon.config.ts is valid');
        console.log(`  project:   ${config.project.name} (${config.project.lang})`);
        console.log(`  executors: ${Object.keys(config.executors).join(', ')}`);
        console.log(`  basePort:  ${config.basePort}`);
        process.exit(0);
      } catch (err) {
        console.error(`✗ ${err instanceof MyrmidonError ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  cmd.command('get <key>')
    .description('Get a config value by dot-path (e.g. project.name)')
    .action(async (key: string) => {
      try {
        const config = await loadConfig(process.cwd());
        const value = key.split('.').reduce((obj: unknown, k) => {
          if (obj !== null && typeof obj === 'object') return (obj as Record<string, unknown>)[k];
          return undefined;
        }, config as unknown);

        if (value === undefined) {
          console.error(`Key not found: ${key}`);
          process.exit(1);
        }
        console.log(typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value));
      } catch (err) {
        console.error(err instanceof MyrmidonError ? err.message : String(err));
        process.exit(1);
      }
    });

  cmd.command('set <key> <value>')
    .description('Store a runtime config override in SQLite')
    .action(async (key: string, value: string) => {
      const db = openDatabase(process.cwd());
      db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(`config.override.${key}`, value);
      console.log(`✓ Runtime override set: ${key} = ${value}`);
    });

  return cmd;
}

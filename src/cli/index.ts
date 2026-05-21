import { program } from 'commander';
import { createRequire } from 'node:module';
import { makeInitCommand } from './commands/init.js';
import { makeConfigCommand } from './commands/config.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

program
  .name('myrmidon')
  .description('AI Agent Orchestrator for software development')
  .version(pkg.version, '-v, --version');

program.addCommand(makeInitCommand());
program.addCommand(makeConfigCommand());

await program.parseAsync(process.argv);

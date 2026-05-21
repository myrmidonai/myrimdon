import { program } from 'commander';
import { createRequire } from 'node:module';
import { makeInitCommand } from './commands/init.js';
import { makeConfigCommand } from './commands/config.js';
import { makeStartCommand } from './commands/start.js';
import { makeStopCommand } from './commands/stop.js';
import { makeStatusCommand } from './commands/status.js';
import { makeWorkflowCommand } from './commands/workflow.js';
import { launchTUI } from './tui.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

program
  .name('myrmidon')
  .description('AI Agent Orchestrator for software development')
  .version(pkg.version, '-v, --version');

program.addCommand(makeInitCommand());
program.addCommand(makeConfigCommand());
program.addCommand(makeStartCommand());
program.addCommand(makeStopCommand());
program.addCommand(makeStatusCommand());
program.addCommand(makeWorkflowCommand());

const args = process.argv.slice(2);
if (args.length === 0) {
  await launchTUI();
} else {
  await program.parseAsync(process.argv);
}

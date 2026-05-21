import { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function makeStopCommand(): Command {
  return new Command('stop')
    .description('Send SIGTERM to the running engine process')
    .action(() => {
      const pidFile = resolve(process.cwd(), '.myrmidon', 'runtime', 'engine.pid');
      if (!existsSync(pidFile)) {
        console.error('No engine.pid found — is the engine running?');
        process.exit(1);
      }
      const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`[engine] Sent SIGTERM to PID ${pid}`);
      } catch {
        console.error(`[engine] Could not signal PID ${pid} — process may already be stopped`);
      }
    });
}

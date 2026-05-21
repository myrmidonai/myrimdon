import { spawn } from 'node:child_process';
import type { RuntimeId } from '../config/schema.js';

export interface SpawnOpts {
  promptFile: string;
  cwd: string;
  dbPath: string;
  env: Record<string, string>;
}

export interface SpawnedProcess {
  pid: number;
  kill(signal: 'SIGTERM' | 'SIGKILL'): void;
}

export interface RuntimeAdapter {
  readonly runtimeId: RuntimeId;
  spawn(opts: SpawnOpts): Promise<SpawnedProcess>;
}

export class ClaudeCodeAdapter implements RuntimeAdapter {
  readonly runtimeId: RuntimeId = 'claude-code';

  async spawn(opts: SpawnOpts): Promise<SpawnedProcess> {
    const child = spawn('claude', ['--print', `--prompt-file=${opts.promptFile}`], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      detached: true,
      stdio: 'ignore',
    });
    if (child.pid === undefined) throw new Error('Failed to spawn claude process — pid undefined');
    child.unref();
    const pid = child.pid;
    return {
      pid,
      kill: (signal) => process.kill(pid, signal),
    };
  }
}

export class OpenCodeAdapter implements RuntimeAdapter {
  readonly runtimeId: RuntimeId = 'opencode';

  async spawn(_opts: SpawnOpts): Promise<SpawnedProcess> {
    throw new Error('OpenCode runtime is not yet implemented');
  }
}

export function createRuntimeAdapter(runtimeId: RuntimeId): RuntimeAdapter {
  if (runtimeId === 'claude-code') return new ClaudeCodeAdapter();
  if (runtimeId === 'opencode') return new OpenCodeAdapter();
  throw new Error(`Unsupported runtime: ${runtimeId}`);
}

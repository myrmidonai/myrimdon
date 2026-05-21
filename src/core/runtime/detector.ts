import { spawnSync } from 'node:child_process';
import type { RuntimeId } from '../config/schema.js';

export type { RuntimeId };

export interface RuntimeInfo {
  id: RuntimeId;
  command: string;
  version: string;
  installUrl: string;
  installCmd: string;
}

const RUNTIMES: Array<Omit<RuntimeInfo, 'version'>> = [
  { id: 'claude-code', command: 'claude',   installUrl: 'https://claude.ai/code',                      installCmd: 'npx @anthropic-ai/claude-code' },
  { id: 'opencode',    command: 'opencode', installUrl: 'https://opencode.ai',                         installCmd: 'npm install -g opencode' },
  { id: 'gemini-cli',  command: 'gemini',   installUrl: 'https://github.com/google-gemini/gemini-cli', installCmd: 'npm install -g @google/gemini-cli' },
  { id: 'kimi-codex',  command: 'kimi',     installUrl: 'https://github.com/MoonshotAI/kimi-codex',   installCmd: 'pip install kimi-codex' },
];

export function detectRuntimes(): RuntimeInfo[] {
  const found: RuntimeInfo[] = [];
  for (const rt of RUNTIMES) {
    const result = spawnSync(rt.command, ['--version'], { encoding: 'utf-8', timeout: 5000 });
    if (result.status === 0) {
      const version = (result.stdout ?? result.stderr ?? '').trim().split('\n')[0] ?? '';
      found.push({ ...rt, version });
    }
  }
  return found;
}

export function getRuntimeInstallGuide(): string {
  return RUNTIMES
    .map(rt => `  ${rt.id.padEnd(14)} ${rt.installCmd.padEnd(42)} ${rt.installUrl}`)
    .join('\n');
}

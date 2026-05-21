// tests/integration/init-flow.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as cp from 'node:child_process';
import { makeInitCommand } from '../../src/cli/commands/init.js';
import { loadConfig } from '../../src/core/config/loader.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawnSync: vi.fn() };
});

let tmpDir: string;
afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore Windows EPERM on open DB handles */ }
  vi.restoreAllMocks();
});

describe('myrmidon init (direct mode)', () => {
  it('creates a complete project structure and valid config', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-integration-'));

    // Mock runtime detection: only claude-code available
    vi.mocked(cp.spawnSync).mockImplementation((cmd) => {
      if (cmd === 'claude') return { status: 0, stdout: 'claude 1.2.3\n', stderr: '' } as ReturnType<typeof cp.spawnSync>;
      return { status: 1, stdout: '', stderr: '' } as ReturnType<typeof cp.spawnSync>;
    });

    // Mock cwd so the project is created inside tmpDir
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const cmd = makeInitCommand();
    await cmd.parseAsync([
      'node', 'myrmidon', 'my-shop',
      '--lang', 'zh',
      '--template', 'default',
      '--base-port', '31000',
    ]).catch((e: Error) => {
      // process.exit throws in test — only fail for unexpected errors
      if (!e.message.startsWith('exit')) throw e;
    });

    const projectDir = join(tmpDir, 'my-shop');

    // Directory structure
    expect(existsSync(join(projectDir, '.myrmidon/runtime'))).toBe(true);
    expect(existsSync(join(projectDir, '.myrmidon/logs'))).toBe(true);
    expect(existsSync(join(projectDir, 'docs/design/ui/components'))).toBe(true);

    // Generated files
    expect(existsSync(join(projectDir, 'myrmidon.config.ts'))).toBe(true);
    expect(existsSync(join(projectDir, '.env.example'))).toBe(true);
    expect(existsSync(join(projectDir, '.gitignore'))).toBe(true);
    expect(existsSync(join(projectDir, '.myrmidon/runtime/myrmidon.db'))).toBe(true);

    // Config is loadable and valid
    const config = await loadConfig(projectDir);
    expect(config.project.name).toBe('my-shop');
    expect(config.project.lang).toBe('zh');
    expect(config.executors['sonnet']?.runtime).toBe('claude-code');

    // .gitignore excludes .env
    const gitignore = readFileSync(join(projectDir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('.env');
    expect(gitignore).toContain('.myrmidon/runtime/');

    // .env.example has ANTHROPIC_API_KEY
    const envExample = readFileSync(join(projectDir, '.env.example'), 'utf-8');
    expect(envExample).toContain('ANTHROPIC_API_KEY=');
  });

  it('handles --add mode for existing projects (idempotent)', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-integration-'));
    vi.mocked(cp.spawnSync).mockImplementation((cmd) =>
      cmd === 'claude'
        ? { status: 0, stdout: 'claude 1.2.3\n', stderr: '' } as ReturnType<typeof cp.spawnSync>
        : { status: 1, stdout: '', stderr: '' } as ReturnType<typeof cp.spawnSync>
    );
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const run = () =>
      makeInitCommand().parseAsync(['node', 'myrmidon', '--add', '--lang', 'zh']).catch(e => {
        if (!e.message.startsWith('exit')) throw e;
      });

    await run();
    await run(); // second run must not throw

    const config = await loadConfig(tmpDir);
    expect(config.project.lang).toBe('zh');
  });
});

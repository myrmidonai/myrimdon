import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeConfigCommand } from '../../../src/cli/commands/config.js';

let tmpDir: string;
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); vi.restoreAllMocks(); });

const validConfigContent = `
export default {
  project: { name: 'acme', lang: 'zh', description: '' },
  executors: { sonnet: { runtime: 'claude-code', model: 'claude-sonnet-4-6', maxContextTokens: 200000 } },
};
`;

describe('config validate', () => {
  it('exits 0 for a valid config', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-cfg-'));
    writeFileSync(join(tmpDir, 'myrmidon.config.ts'), validConfigContent, 'utf-8');
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit:0'); });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const cmd = makeConfigCommand();
    await expect(cmd.parseAsync(['node', 'myrmidon', 'validate'])).rejects.toThrow('exit:0');
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(consoleSpy.mock.calls.flat().join(' ')).toContain('valid');
  });

  it('exits 1 for missing config', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-cfg-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit:1'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const cmd = makeConfigCommand();
    await expect(cmd.parseAsync(['node', 'myrmidon', 'validate'])).rejects.toThrow('exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('config get', () => {
  it('prints the value for a valid key path', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-cfg-'));
    writeFileSync(join(tmpDir, 'myrmidon.config.ts'), validConfigContent, 'utf-8');
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const cmd = makeConfigCommand();
    await cmd.parseAsync(['node', 'myrmidon', 'get', 'project.name']).catch(() => {});
    expect(consoleSpy.mock.calls.flat().join(' ')).toContain('acme');
  });
});

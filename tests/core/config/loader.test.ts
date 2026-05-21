import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../../src/core/config/loader.js';

let tmpDir: string;
afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

describe('loadConfig', () => {
  it('loads and validates a valid myrmidon.config.ts', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-loader-'));
    writeFileSync(join(tmpDir, 'myrmidon.config.ts'), `
      export default {
        project: { name: 'test-proj', lang: 'zh', description: '' },
        executors: { sonnet: { runtime: 'claude-code', model: 'claude-sonnet-4-6', maxContextTokens: 200000 } },
      };
    `, 'utf-8');

    const config = await loadConfig(tmpDir);
    expect(config.project.name).toBe('test-proj');
    expect(config.basePort).toBe(31000); // default applied
  });

  it('throws MyrmidonError(CONFIG_NOT_FOUND) when file is missing', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-loader-'));
    await expect(loadConfig(tmpDir)).rejects.toMatchObject({
      code: 'CONFIG_NOT_FOUND',
    });
  });

  it('throws MyrmidonError(CONFIG_INVALID) when schema fails', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-loader-'));
    writeFileSync(join(tmpDir, 'myrmidon.config.ts'), `
      export default { project: { lang: 'zh' }, executors: {} };
    `, 'utf-8');

    await expect(loadConfig(tmpDir)).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    });
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaffold } from '../../../src/core/init/scaffolder.js';

const baseOpts = {
  name: 'my-app',
  lang: 'zh' as const,
  template: 'default' as const,
  basePort: 31000,
  runtime: 'claude-code' as const,
  isExisting: false,
};

let tmpDir: string;
afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore Windows EPERM on open DB handles */ }
});

describe('scaffold', () => {
  it('creates required directories', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-scaffold-'));
    scaffold({ ...baseOpts, targetDir: tmpDir });

    expect(existsSync(join(tmpDir, '.myrmidon/runtime'))).toBe(true);
    expect(existsSync(join(tmpDir, '.myrmidon/logs'))).toBe(true);
    expect(existsSync(join(tmpDir, 'docs/design/ui/components'))).toBe(true);
    expect(existsSync(join(tmpDir, '.claude/rules'))).toBe(true);
  });

  it('creates myrmidon.config.ts', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-scaffold-'));
    scaffold({ ...baseOpts, targetDir: tmpDir });
    const content = readFileSync(join(tmpDir, 'myrmidon.config.ts'), 'utf-8');
    expect(content).toContain("name: 'my-app'");
  });

  it('creates .env.example with ANTHROPIC_API_KEY', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-scaffold-'));
    scaffold({ ...baseOpts, targetDir: tmpDir });
    const content = readFileSync(join(tmpDir, '.env.example'), 'utf-8');
    expect(content).toContain('ANTHROPIC_API_KEY=');
  });

  it('.gitignore includes .env and runtime dir', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-scaffold-'));
    scaffold({ ...baseOpts, targetDir: tmpDir });
    const content = readFileSync(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toContain('.env');
    expect(content).toContain('.myrmidon/runtime/');
  });

  it('creates SQLite database', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-scaffold-'));
    scaffold({ ...baseOpts, targetDir: tmpDir });
    expect(existsSync(join(tmpDir, '.myrmidon/runtime/myrmidon.db'))).toBe(true);
  });

  it('is idempotent — second run does not throw or overwrite config', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-scaffold-'));
    scaffold({ ...baseOpts, targetDir: tmpDir });
    const before = readFileSync(join(tmpDir, 'myrmidon.config.ts'), 'utf-8');
    const result2 = scaffold({ ...baseOpts, targetDir: tmpDir });
    const after = readFileSync(join(tmpDir, 'myrmidon.config.ts'), 'utf-8');
    expect(after).toBe(before);
    expect(result2.skipped).toContain('myrmidon.config.ts');
  });

  it('appends missing .gitignore entries without overwriting existing ones', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myrmidon-scaffold-'));
    // Pre-create .gitignore with one entry
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(tmpDir, '.gitignore'), 'node_modules/\n', 'utf-8');
    scaffold({ ...baseOpts, targetDir: tmpDir });
    const content = readFileSync(join(tmpDir, '.gitignore'), 'utf-8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.env');
  });
});

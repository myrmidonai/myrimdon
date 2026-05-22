import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalArtifactStore } from '../../src/core/foundation/impl/local-artifact-store.js';

describe('LocalArtifactStore', () => {
  let dir: string;
  let store: LocalArtifactStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'myrmidon-test-'));
    store = new LocalArtifactStore(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('exists returns false for unknown artifact', async () => {
    store.register('a1', 'output/a1.md');
    expect(await store.exists('a1')).toBe(false);
  });

  it('exists returns true after file is written', async () => {
    store.register('a1', 'output/a1.md');
    mkdirSync(join(dir, 'output'), { recursive: true });
    writeFileSync(join(dir, 'output', 'a1.md'), 'hello');
    expect(await store.exists('a1')).toBe(true);
  });

  it('stat returns mtime and size', async () => {
    store.register('a1', 'output/a1.md');
    mkdirSync(join(dir, 'output'), { recursive: true });
    writeFileSync(join(dir, 'output', 'a1.md'), 'hello world');
    const s = await store.stat('a1');
    expect(s.size).toBe(11);
    expect(s.mtime).toBeGreaterThan(0);
  });

  it('stat throws if artifact not registered', async () => {
    await expect(store.stat('unknown')).rejects.toThrow('not registered');
  });

  it('put writes content and returns sha256', async () => {
    store.register('a1', 'output/a1.md');
    const checksum = await store.put('a1', Buffer.from('content'));
    expect(checksum).toHaveLength(64); // sha256 hex
    expect(await store.exists('a1')).toBe(true);
  });
});

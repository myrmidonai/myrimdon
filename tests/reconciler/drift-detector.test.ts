import { describe, it, expect, vi } from 'vitest';
import { detectMissingArtifacts, detectPhantomRunning } from '../../src/core/reconciler/drift-detector.js';
import type { ArtifactStore } from '../../src/core/foundation/artifact-store.js';

describe('detectMissingArtifacts', () => {
  it('returns ids of valid artifacts that no longer exist on disk', async () => {
    const store: ArtifactStore = {
      exists: async (id) => id !== 'a2',
      stat: vi.fn(), get: vi.fn(), put: vi.fn(),
    };
    const rows = [
      { id: 'a1', status: 'valid' },
      { id: 'a2', status: 'valid' },
      { id: 'a3', status: 'generating' }, // not valid, skip
    ];
    const missing = await detectMissingArtifacts(rows, store);
    expect(missing).toEqual(['a2']);
  });
});

describe('detectPhantomRunning', () => {
  it('returns execIds of running nodes with dead process', () => {
    const procs = [
      { session_id: 'exec-1', pid: 99999999 }, // dead
      { session_id: 'exec-2', pid: process.pid }, // alive (current process)
    ];
    const phantom = detectPhantomRunning(procs);
    expect(phantom).toContain('exec-1');
    expect(phantom).not.toContain('exec-2');
  });
});

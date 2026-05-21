import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectRuntimes, getRuntimeInstallGuide } from '../../../src/core/runtime/detector.js';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

import * as cp from 'node:child_process';

describe('detectRuntimes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns runtimes whose command exits 0', () => {
    const mockSpawnSync = vi.mocked(cp.spawnSync);
    mockSpawnSync.mockImplementation((cmd) => {
      if (cmd === 'claude') return { status: 0, stdout: 'claude 1.2.3\n', stderr: '' } as ReturnType<typeof cp.spawnSync>;
      return { status: 1, stdout: '', stderr: '' } as ReturnType<typeof cp.spawnSync>;
    });

    const found = detectRuntimes();
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe('claude-code');
    expect(found[0]?.version).toBe('claude 1.2.3');
  });

  it('returns empty array when no runtime is installed', () => {
    const mockSpawnSync = vi.mocked(cp.spawnSync);
    mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '' } as ReturnType<typeof cp.spawnSync>);
    expect(detectRuntimes()).toHaveLength(0);
  });

  it('returns multiple runtimes when several are installed', () => {
    const mockSpawnSync = vi.mocked(cp.spawnSync);
    mockSpawnSync.mockImplementation((cmd) => {
      if (cmd === 'claude' || cmd === 'opencode') {
        return { status: 0, stdout: `${cmd} 0.1.0\n`, stderr: '' } as ReturnType<typeof cp.spawnSync>;
      }
      return { status: 1, stdout: '', stderr: '' } as ReturnType<typeof cp.spawnSync>;
    });
    expect(detectRuntimes()).toHaveLength(2);
  });
});

describe('getRuntimeInstallGuide', () => {
  it('includes all 4 supported runtimes', () => {
    const guide = getRuntimeInstallGuide();
    expect(guide).toContain('claude-code');
    expect(guide).toContain('opencode');
    expect(guide).toContain('gemini-cli');
    expect(guide).toContain('kimi-codex');
  });
});

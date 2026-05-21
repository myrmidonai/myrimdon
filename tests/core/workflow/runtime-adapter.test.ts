import { describe, it, expect } from 'vitest';
import { createRuntimeAdapter, ClaudeCodeAdapter, OpenCodeAdapter } from '../../../src/core/workflow/runtime-adapter.js';

describe('createRuntimeAdapter', () => {
  it('returns ClaudeCodeAdapter for claude-code', () => {
    const adapter = createRuntimeAdapter('claude-code');
    expect(adapter).toBeInstanceOf(ClaudeCodeAdapter);
    expect(adapter.runtimeId).toBe('claude-code');
  });

  it('returns OpenCodeAdapter for opencode', () => {
    const adapter = createRuntimeAdapter('opencode');
    expect(adapter).toBeInstanceOf(OpenCodeAdapter);
    expect(adapter.runtimeId).toBe('opencode');
  });

  it('throws for unsupported runtime', () => {
    // @ts-expect-error — testing runtime boundary
    expect(() => createRuntimeAdapter('unknown')).toThrow();
  });
});

describe('OpenCodeAdapter.spawn', () => {
  it('throws not-implemented error', async () => {
    const adapter = new OpenCodeAdapter();
    await expect(
      adapter.spawn({ promptFile: 'x.json', cwd: '/tmp', dbPath: '/tmp/db', env: {} }),
    ).rejects.toThrow();
  });
});

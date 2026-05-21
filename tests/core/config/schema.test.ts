import { describe, it, expect } from 'vitest';
import { MyrmidonConfigSchema, defineConfig } from '../../../src/core/config/schema.js';

const minimal = {
  project: { name: 'acme', lang: 'zh', description: '' },
  executors: {
    sonnet: { runtime: 'claude-code', model: 'claude-sonnet-4-6', maxContextTokens: 200_000 },
  },
};

describe('MyrmidonConfigSchema', () => {
  it('accepts a minimal valid config', () => {
    const result = MyrmidonConfigSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('applies defaults for optional fields', () => {
    const result = MyrmidonConfigSchema.safeParse(minimal);
    expect(result.success && result.data.basePort).toBe(31000);
    expect(result.success && result.data.runtime.maxRetries).toBe(3);
    expect(result.success && result.data.tui.lang).toBe('zh');
    expect(result.success && result.data.audit.retention).toBe('30d');
  });

  it('rejects a config with missing project.name', () => {
    const bad = { ...minimal, project: { lang: 'zh' } };
    const result = MyrmidonConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects an executor with unknown runtime', () => {
    const bad = {
      ...minimal,
      executors: { bad: { runtime: 'unknown-runtime', model: 'x', maxContextTokens: 1000 } },
    };
    const result = MyrmidonConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('accepts a config with a workflows array', () => {
    const withWorkflows = {
      ...minimal,
      workflows: ['software-dev-agile', './workflows/my-flow.ts'],
    };
    const result = MyrmidonConfigSchema.safeParse(withWorkflows);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.workflows).toEqual(['software-dev-agile', './workflows/my-flow.ts']);
    }
  });

  it('accepts a config without the workflows field', () => {
    const result = MyrmidonConfigSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.workflows).toBeUndefined();
    }
  });
});

describe('defineConfig', () => {
  it('is an identity function returning the same object', () => {
    const config = defineConfig(minimal as Parameters<typeof defineConfig>[0]);
    expect(config).toBe(minimal);
  });
});

import { describe, it, expect } from 'vitest';
import { ExecutorRegistry } from '../../../src/core/workflow/executor-registry.js';
import type { NodeExecutor, NodeContext, NodeResult } from '../../../src/core/workflow/executor-registry.js';

const mockExecutor: NodeExecutor = {
  type: 'trigger',
  async execute(_ctx: NodeContext): Promise<NodeResult> {
    return { status: 'completed' };
  },
};

describe('ExecutorRegistry', () => {
  it('registers and retrieves an executor by type', () => {
    const registry = new ExecutorRegistry();
    registry.register(mockExecutor);
    expect(registry.get('trigger')).toBe(mockExecutor);
  });

  it('has() returns true for registered type', () => {
    const registry = new ExecutorRegistry();
    registry.register(mockExecutor);
    expect(registry.has('trigger')).toBe(true);
  });

  it('has() returns false for unregistered type', () => {
    const registry = new ExecutorRegistry();
    expect(registry.has('agent')).toBe(false);
  });

  it('get() throws for unregistered type', () => {
    const registry = new ExecutorRegistry();
    expect(() => registry.get('agent')).toThrow('No executor registered for node type: agent');
  });

  it('later registration overwrites earlier one', () => {
    const registry = new ExecutorRegistry();
    const first: NodeExecutor = { type: 'trigger', execute: async () => ({ status: 'completed' }) };
    const second: NodeExecutor = { type: 'trigger', execute: async () => ({ status: 'failed' }) };
    registry.register(first);
    registry.register(second);
    expect(registry.get('trigger')).toBe(second);
  });
});

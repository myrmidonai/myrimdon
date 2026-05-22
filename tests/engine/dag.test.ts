import { describe, it, expect } from 'vitest';
import { isUpstreamComplete, getIncomingEdges } from '../../src/core/engine/dag.js';
import type { WorkflowDef } from '../../src/core/workflow/schema.js';

const simpleDef: WorkflowDef = {
  id: 'test', version: '1.0', name: 'Test',
  nodes: [
    { id: 'a', type: 'trigger', name: 'A' },
    { id: 'b', type: 'agent', name: 'B' },
    { id: 'c', type: 'join', name: 'C' },
  ],
  edges: [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
  ],
};

describe('isUpstreamComplete', () => {
  it('trigger node with no incoming edges is always ready', () => {
    const statuses = new Map<string, string>([['a', 'pending']]);
    expect(isUpstreamComplete(simpleDef, 'a', statuses)).toBe(true);
  });

  it('agent node ready when upstream completed', () => {
    const statuses = new Map([['a', 'completed'], ['b', 'pending']]);
    expect(isUpstreamComplete(simpleDef, 'b', statuses)).toBe(true);
  });

  it('agent node not ready when upstream pending', () => {
    const statuses = new Map([['a', 'pending'], ['b', 'pending']]);
    expect(isUpstreamComplete(simpleDef, 'b', statuses)).toBe(false);
  });

  it('join node requires ALL upstreams completed', () => {
    const def: WorkflowDef = {
      id: 'test', version: '1.0', name: 'Test',
      nodes: [
        { id: 'a', type: 'parallel_fork', name: 'A' },
        { id: 'b', type: 'agent', name: 'B' },
        { id: 'c', type: 'agent', name: 'C' },
        { id: 'd', type: 'join', name: 'D' },
      ],
      edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }, { from: 'c', to: 'd' }],
    };
    const statuses = new Map([['a', 'completed'], ['b', 'completed'], ['c', 'pending'], ['d', 'pending']]);
    expect(isUpstreamComplete(def, 'd', statuses)).toBe(false);
    statuses.set('c', 'completed');
    expect(isUpstreamComplete(def, 'd', statuses)).toBe(true);
  });
});

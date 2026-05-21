import { describe, it, expect } from 'vitest';
import { softwareDevAgileWorkflow } from '../../../src/core/templates/software-dev-agile.js';

describe('softwareDevAgileWorkflow', () => {
  it('has the expected id', () => {
    expect(softwareDevAgileWorkflow.id).toBe('software-dev-agile');
  });

  it('has at least 8 nodes', () => {
    expect(softwareDevAgileWorkflow.nodes.length).toBeGreaterThanOrEqual(8);
  });

  it('every edge references existing node ids', () => {
    const nodeIds = new Set(softwareDevAgileWorkflow.nodes.map((n) => n.id));
    for (const edge of softwareDevAgileWorkflow.edges) {
      expect(nodeIds.has(edge.from), `Edge from="${edge.from}" not in nodes`).toBe(true);
      expect(nodeIds.has(edge.to), `Edge to="${edge.to}" not in nodes`).toBe(true);
    }
  });

  it('has exactly one trigger node', () => {
    const triggers = softwareDevAgileWorkflow.nodes.filter((n) => n.type === 'trigger');
    expect(triggers).toHaveLength(1);
  });
});

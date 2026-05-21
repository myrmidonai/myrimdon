import { describe, it, expect } from 'vitest';
import { WorkflowDefSchema, defineWorkflow } from '../../../src/core/workflow/schema.js';

const minimalWorkflow = {
  id: 'test-flow',
  version: '1.0.0',
  name: 'Test Flow',
  nodes: [{ id: 'start', type: 'trigger', name: 'Start' }],
  edges: [],
};

describe('WorkflowDefSchema', () => {
  it('accepts a minimal valid workflow', () => {
    const result = WorkflowDefSchema.safeParse(minimalWorkflow);
    expect(result.success).toBe(true);
  });

  it('rejects workflow with no nodes', () => {
    const bad = { ...minimalWorkflow, nodes: [] };
    expect(WorkflowDefSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown node type', () => {
    const bad = {
      ...minimalWorkflow,
      nodes: [{ id: 'x', type: 'unknown_type', name: 'X' }],
    };
    expect(WorkflowDefSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts a node with artifacts', () => {
    const wf = {
      ...minimalWorkflow,
      nodes: [
        {
          id: 'writer',
          type: 'agent',
          name: 'Writer',
          agentRole: 'pm',
          artifacts: {
            consumes: [],
            produces: [{ id: 'doc', path: 'docs/doc.md' }],
          },
        },
      ],
    };
    expect(WorkflowDefSchema.safeParse(wf).success).toBe(true);
  });

  it('accepts human_approval config on a node', () => {
    const wf = {
      ...minimalWorkflow,
      nodes: [
        {
          id: 'approval',
          type: 'human_approval',
          name: 'Approve',
          humanApproval: {
            message: 'Please review',
            onTimeout: 'auto_approve',
            allowedActions: ['approve', 'reject'],
          },
        },
      ],
    };
    expect(WorkflowDefSchema.safeParse(wf).success).toBe(true);
  });
});

describe('defineWorkflow', () => {
  it('parses and returns a WorkflowDef', () => {
    const wf = defineWorkflow(minimalWorkflow);
    expect(wf.id).toBe('test-flow');
    expect(wf.nodes).toHaveLength(1);
  });

  it('throws ZodError on invalid input', () => {
    expect(() => defineWorkflow({ id: '', version: '1', name: 'x', nodes: [], edges: [] })).toThrow();
  });
});

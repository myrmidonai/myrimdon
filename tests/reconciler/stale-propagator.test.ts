import { describe, it, expect } from 'vitest';
import { propagateStale, buildDepGraph } from '../../src/core/reconciler/stale-propagator.js';

describe('buildDepGraph', () => {
  it('builds downstream map from artifact rows', () => {
    const artifacts = [
      { id: 'a', upstream_ids: null },
      { id: 'b', upstream_ids: '["a"]' },
      { id: 'c', upstream_ids: '["a","b"]' },
    ];
    const graph = buildDepGraph(artifacts);
    expect(graph.get('a')).toContain('b');
    expect(graph.get('a')).toContain('c');
    expect(graph.get('b')).toContain('c');
  });
});

describe('propagateStale', () => {
  it('marks direct downstream as stale', () => {
    const graph = new Map([['a', ['b']], ['b', ['c']]]);
    const stale = propagateStale('a', graph, 10);
    expect(stale).toContain('b');
    expect(stale).toContain('c');
    expect(stale).not.toContain('a');
  });

  it('respects max depth', () => {
    // chain: a→b→c→d, maxDepth=1 → only b
    const graph = new Map([['a', ['b']], ['b', ['c']], ['c', ['d']]]);
    const stale = propagateStale('a', graph, 1);
    expect(stale).toContain('b');
    expect(stale).not.toContain('c');
  });

  it('handles no downstream gracefully', () => {
    const graph = new Map<string, string[]>();
    expect(propagateStale('a', graph, 10)).toHaveLength(0);
  });
});

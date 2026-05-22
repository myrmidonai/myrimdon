export interface ArtifactRow {
  id: string;
  upstream_ids: string | null;
}

export function buildDepGraph(artifacts: ArtifactRow[]): Map<string, string[]> {
  const downstream = new Map<string, string[]>();
  for (const a of artifacts) {
    const upstreams: string[] = a.upstream_ids ? JSON.parse(a.upstream_ids) : [];
    for (const upId of upstreams) {
      if (!downstream.has(upId)) downstream.set(upId, []);
      downstream.get(upId)!.push(a.id);
    }
  }
  return downstream;
}

export function propagateStale(
  changedId: string,
  downstream: Map<string, string[]>,
  maxDepth: number,
): string[] {
  const stale = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: changedId, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;
    for (const child of downstream.get(id) ?? []) {
      if (!stale.has(child)) {
        stale.add(child);
        queue.push({ id: child, depth: depth + 1 });
      }
    }
  }

  return [...stale];
}

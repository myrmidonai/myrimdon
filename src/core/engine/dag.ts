import type { WorkflowDef, EdgeDef } from '../workflow/schema.js';

export function getIncomingEdges(def: WorkflowDef, nodeId: string): EdgeDef[] {
  return def.edges.filter((e) => e.to === nodeId);
}

export function isUpstreamComplete(
  def: WorkflowDef,
  nodeId: string,
  nodeStatuses: Map<string, string>,
): boolean {
  const incoming = getIncomingEdges(def, nodeId);
  if (incoming.length === 0) return true;

  const node = def.nodes.find((n) => n.id === nodeId);
  const isJoin = node?.type === 'join';

  const check = (edge: EdgeDef) => nodeStatuses.get(edge.from) === 'completed';
  return isJoin ? incoming.every(check) : incoming.some(check);
}

export function inputArtifactIds(def: WorkflowDef, nodeId: string): string[] {
  const node = def.nodes.find((n) => n.id === nodeId);
  return node?.artifacts?.consumes.map((r) => r.id) ?? [];
}

export function outputArtifactIds(def: WorkflowDef, nodeId: string): string[] {
  const node = def.nodes.find((n) => n.id === nodeId);
  return node?.artifacts?.produces.map((a) => a.id) ?? [];
}

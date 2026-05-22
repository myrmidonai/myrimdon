export type WorkflowRunStatus = 'running' | 'paused' | 'completed' | 'failed';
export type NodeStatus =
  | 'pending' | 'running' | 'completed' | 'failed'
  | 'skipped' | 'waiting_human' | 'stale_blocked';
export type ArtifactStatus =
  | 'pending' | 'generating' | 'needs_validation'
  | 'valid' | 'invalid' | 'needs_review' | 'stale' | 'orphaned';

const NODE_TRANSITIONS: Partial<Record<NodeStatus, NodeStatus[]>> = {
  pending: ['running', 'stale_blocked', 'skipped'],
  running: ['completed', 'failed', 'waiting_human'],
  failed: ['pending'],
  waiting_human: ['completed', 'failed'],
  stale_blocked: ['pending'],
};

const ARTIFACT_TRANSITIONS: Partial<Record<ArtifactStatus, ArtifactStatus[]>> = {
  pending: ['generating'],
  generating: ['needs_validation', 'invalid'],
  needs_validation: ['valid', 'invalid', 'needs_review'],
  valid: ['stale', 'orphaned'],
  invalid: ['generating'],
  needs_review: ['valid', 'invalid'],
  stale: ['generating'],
};

export function canTransitionNode(from: NodeStatus, to: NodeStatus): boolean {
  return NODE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionArtifact(from: ArtifactStatus, to: ArtifactStatus): boolean {
  return ARTIFACT_TRANSITIONS[from]?.includes(to) ?? false;
}

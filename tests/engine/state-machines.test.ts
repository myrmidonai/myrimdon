import { describe, it, expect } from 'vitest';
import { canTransitionNode, canTransitionArtifact } from '../../src/core/engine/state-machines.js';

describe('canTransitionNode', () => {
  it('pending → running is valid', () => expect(canTransitionNode('pending', 'running')).toBe(true));
  it('completed → running is invalid', () => expect(canTransitionNode('completed', 'running')).toBe(false));
  it('failed → pending is valid (retry)', () => expect(canTransitionNode('failed', 'pending')).toBe(true));
  it('running → waiting_human is valid', () => expect(canTransitionNode('running', 'waiting_human')).toBe(true));
});

describe('canTransitionArtifact', () => {
  it('pending → generating is valid', () => expect(canTransitionArtifact('pending', 'generating')).toBe(true));
  it('valid → stale is valid', () => expect(canTransitionArtifact('valid', 'stale')).toBe(true));
  it('orphaned → generating is invalid', () => expect(canTransitionArtifact('orphaned', 'generating')).toBe(false));
  it('needs_review → valid is valid', () => expect(canTransitionArtifact('needs_review', 'valid')).toBe(true));
});

import { describe, it, expect } from 'vitest';
import { ConditionExecutor } from '../../../../src/core/workflow/executors/condition.js';
import { ParallelForkExecutor, JoinExecutor } from '../../../../src/core/workflow/executors/parallel.js';
import { TransformExecutor } from '../../../../src/core/workflow/executors/transform.js';
import { TriggerExecutor } from '../../../../src/core/workflow/executors/trigger.js';
import { LoopExecutor } from '../../../../src/core/workflow/executors/loop.js';
import type { NodeContext } from '../../../../src/core/workflow/executor-registry.js';

// A minimal stub — we only need the fields each executor actually reads
const ctx = {} as NodeContext;

describe('Simple executors', () => {
  it('ConditionExecutor returns completed', async () => {
    const result = await new ConditionExecutor().execute(ctx);
    expect(result.status).toBe('completed');
  });

  it('ParallelForkExecutor returns completed', async () => {
    const result = await new ParallelForkExecutor().execute(ctx);
    expect(result.status).toBe('completed');
  });

  it('JoinExecutor returns completed', async () => {
    const result = await new JoinExecutor().execute(ctx);
    expect(result.status).toBe('completed');
  });

  it('TransformExecutor returns completed', async () => {
    const result = await new TransformExecutor().execute(ctx);
    expect(result.status).toBe('completed');
  });

  it('TriggerExecutor returns completed', async () => {
    const result = await new TriggerExecutor().execute(ctx);
    expect(result.status).toBe('completed');
  });

  it('LoopExecutor returns completed', async () => {
    const result = await new LoopExecutor().execute(ctx);
    expect(result.status).toBe('completed');
  });

  it('each executor has the correct type property', () => {
    expect(new ConditionExecutor().type).toBe('condition');
    expect(new ParallelForkExecutor().type).toBe('parallel_fork');
    expect(new JoinExecutor().type).toBe('join');
    expect(new TransformExecutor().type).toBe('transform');
    expect(new TriggerExecutor().type).toBe('trigger');
    expect(new LoopExecutor().type).toBe('loop');
  });
});

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NodeDef } from '../workflow/schema.js';
import type { ArtifactStore } from '../foundation/artifact-store.js';

export interface DispatchContext {
  workflowName: string;
  node: NodeDef;
  runId: string;
  projectRoot: string;
  artifactStore: ArtifactStore;
  feedbackJson?: string; // structured feedback from prior rejection
}

export async function buildDispatchContent(ctx: DispatchContext): Promise<string> {
  const { workflowName, node, runId, projectRoot, artifactStore } = ctx;
  const continueFile = resolve(projectRoot, '.myrmidon', 'runs', runId, node.id, 'continue.md');
  const continueContent = existsSync(continueFile) ? readFileSync(continueFile, 'utf8') : null;

  const consumesSummaries: string[] = [];
  for (const ref of node.artifacts?.consumes ?? []) {
    const exists = await artifactStore.exists(ref.id);
    if (exists) {
      const stream = await artifactStore.get(ref.id);
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(Buffer.from(c));
      const content = Buffer.concat(chunks).toString('utf8');
      const summary = content.length > 2000 ? content.slice(0, 2000) + '\n... [truncated]' : content;
      consumesSummaries.push(`### ${ref.id}\n${summary}`);
    }
  }

  const producesPaths = (node.artifacts?.produces ?? []).map((a) => `- ${a.path}`).join('\n');
  const allowedTools = (node.mcpTools ?? []).join(', ') || 'standard file tools';

  return `<!-- Layer 1: Fresh Session Declaration -->
You are starting a fresh session with no prior context outside what is provided here.

<!-- Layer 2: Observation Masking -->
You have access ONLY to the following upstream artifacts:
${consumesSummaries.length > 0 ? consumesSummaries.join('\n\n') : '(no upstream artifacts)'}

<!-- Layer 3: Pre-Compaction Snapshot -->
${continueContent ? `Resume from prior session:\n${continueContent}` : '(no prior session)'}
${ctx.feedbackJson ? `\nFeedback from prior rejection:\n${ctx.feedbackJson}` : ''}

<!-- Layer 4: Phase Anchor -->
Workflow: ${workflowName}
Node: ${node.name} (${node.id})
Role: ${node.agentRole ?? 'agent'}

Your task is to produce the following artifacts:
${producesPaths || '(no artifacts to produce)'}

<!-- Layer 5: 70% Pressure Monitor -->
When your context window reaches approximately 70% capacity, immediately write a summary snapshot to:
.myrmidon/runs/${runId}/${node.id}/continue.md

Include: what you have completed, what remains, any decisions made, relevant state. Then terminate your session gracefully.

<!-- Layer 6: Sandboxed Execution -->
Allowed tools: ${allowedTools}
Forbidden: modifying files outside the current worktree, accessing system state APIs, reading other workflow run directories.

<!-- Layer 7: Tool Result Truncation -->
When a tool returns more than 10,000 characters, truncate the result to the first 10,000 characters before processing.
`;
}

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type Database from 'better-sqlite3';
import type { NodeDef, ArtifactDef } from './schema.js';
import type { MyrmidonConfig } from '../config/schema.js';

export interface ResolvedArtifact {
  id: string;
  path: string;
  status: string;
}

export interface DispatchPrompt {
  runId: string;
  node: { id: string; name: string; description: string };
  artifacts: {
    consumes: ResolvedArtifact[];
    produces: ArtifactDef[];
  };
  constitution: {
    role: string;
    allowedTools: string[];
    forbiddenTools: string[];
    skills: string[];
    mcpTools: string[];
    contextRecoveryInstructions: string;
    outputLanguage: string;
  };
  dbPath: string;
  continueFile: string;
  maxTokenBudget: number;
}

export function buildDispatchPrompt(opts: {
  node: NodeDef;
  workflowId: string;
  runId: string;
  db: Database.Database;
  config: MyrmidonConfig;
  projectRoot: string;
}): DispatchPrompt {
  const { node, runId, db, config, projectRoot } = opts;

  const consumes: ResolvedArtifact[] = (node.artifacts?.consumes ?? []).map((ref) => {
    const row = db
      .prepare('SELECT id, file_path, status FROM artifacts WHERE id = ? AND run_id = ?')
      .get(ref.id, runId) as { id: string; file_path: string; status: string } | undefined;
    return row
      ? { id: row.id, path: row.file_path, status: row.status }
      : { id: ref.id, path: '', status: 'missing' };
  });

  const agentRole = node.agentRole ? config.agentRoles[node.agentRole] : undefined;
  const constitution = {
    role: node.agentRole ?? 'general',
    allowedTools: agentRole?.allowedTools ?? [],
    forbiddenTools: agentRole?.forbiddenTools ?? [],
    skills: [...(agentRole?.skills ?? []), ...(node.skills ?? [])],
    mcpTools: [...(agentRole?.mcpTools ?? []), ...(node.mcpTools ?? [])],
    contextRecoveryInstructions: agentRole?.contextRecoveryInstructions ?? '',
    outputLanguage: agentRole?.outputLanguage ?? 'zh',
  };

  const dbPath = resolve(projectRoot, '.myrmidon', 'runtime', 'myrmidon.db');
  const continueFile = resolve(
    projectRoot,
    '.myrmidon',
    'runtime',
    'continue',
    `${runId}-${node.id}.md`,
  );

  return {
    runId,
    node: { id: node.id, name: node.name, description: node.description ?? '' },
    artifacts: { consumes, produces: node.artifacts?.produces ?? [] },
    constitution,
    dbPath,
    continueFile,
    maxTokenBudget: config.dispatch.maxDispatchPromptTokens,
  };
}

export function writeDispatchPrompt(opts: {
  prompt: DispatchPrompt;
  projectRoot: string;
}): string {
  const { prompt, projectRoot } = opts;
  const filePath = resolve(
    projectRoot,
    '.myrmidon',
    'runtime',
    'dispatch',
    `${prompt.runId}-${prompt.node.id}.json`,
  );
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(prompt, null, 2), 'utf8');
  return filePath;
}

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateConfig, generateEnvExample, generateGitignoreEntries, generateClaudeMd, type TemplateOptions } from './templates.js';
import { openDatabase } from '../database/client.js';

export type ScaffoldOptions = TemplateOptions;

export interface ScaffoldResult {
  created: string[];
  skipped: string[];
  appended: string[];
}

const DIRECTORIES = [
  '.myrmidon/runtime',
  '.myrmidon/logs',
  '.myrmidon/prompts',
  '.myrmidon/skills',
  'docs/prd',
  'docs/requirements',
  'docs/design/architecture',
  'docs/design/ui/components',
  'docs/epics',
  'docs/sprints',
  'docs/qa',
  'docs/security',
  'docs/ops',
  'docs/decisions',
  '.claude/rules',
];

export function scaffold(opts: ScaffoldOptions): ScaffoldResult {
  const result: ScaffoldResult = { created: [], skipped: [], appended: [] };
  const base = opts.targetDir;

  for (const dir of DIRECTORIES) {
    const full = resolve(base, dir);
    if (!existsSync(full)) {
      mkdirSync(full, { recursive: true });
      result.created.push(dir + '/');
    }
  }

  createOrSkip(base, 'myrmidon.config.ts', generateConfig(opts), result);
  createOrSkip(base, '.env.example', generateEnvExample(), result);
  appendMissing(base, '.gitignore', generateGitignoreEntries(), result);
  appendSection(base, 'CLAUDE.md', generateClaudeMd(opts), '## Myrmidon', result);

  openDatabase(base);

  return result;
}

function createOrSkip(base: string, rel: string, content: string, result: ScaffoldResult): void {
  const full = resolve(base, rel);
  if (!existsSync(full)) {
    writeFileSync(full, content, 'utf-8');
    result.created.push(rel);
  } else {
    result.skipped.push(rel);
  }
}

function appendMissing(base: string, rel: string, newContent: string, result: ScaffoldResult): void {
  const full = resolve(base, rel);
  if (!existsSync(full)) {
    writeFileSync(full, newContent, 'utf-8');
    result.created.push(rel);
    return;
  }
  const existing = readFileSync(full, 'utf-8');
  const missing = newContent.split('\n').filter(line => line.trim() && !existing.includes(line));
  if (missing.length > 0) {
    writeFileSync(full, existing.trimEnd() + '\n' + missing.join('\n') + '\n', 'utf-8');
    result.appended.push(rel);
  } else {
    result.skipped.push(rel);
  }
}

function appendSection(base: string, rel: string, section: string, marker: string, result: ScaffoldResult): void {
  const full = resolve(base, rel);
  if (!existsSync(full)) {
    writeFileSync(full, section, 'utf-8');
    result.created.push(rel);
    return;
  }
  const existing = readFileSync(full, 'utf-8');
  if (!existing.includes(marker)) {
    writeFileSync(full, existing.trimEnd() + '\n\n' + section, 'utf-8');
    result.appended.push(rel);
  } else {
    result.skipped.push(rel);
  }
}

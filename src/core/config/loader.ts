import { createJiti } from 'jiti';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { MyrmidonConfigSchema, type MyrmidonConfig } from './schema.js';
import { MyrmidonError } from '../../utils/errors.js';

export async function loadConfig(baseDir: string): Promise<MyrmidonConfig> {
  const configPath = resolve(baseDir, 'myrmidon.config.ts');
  if (!existsSync(configPath)) {
    throw new MyrmidonError('CONFIG_NOT_FOUND', `No myrmidon.config.ts in ${baseDir}. Run: myrmidon init`);
  }

  const jiti = createJiti(import.meta.url, { moduleCache: false });
  let raw: unknown;
  try {
    const mod = await jiti.import(configPath, { default: true });
    raw = mod;
  } catch (cause) {
    throw new MyrmidonError('CONFIG_LOAD_ERROR', `Failed to load myrmidon.config.ts: ${String(cause)}`, { cause });
  }

  const result = MyrmidonConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new MyrmidonError('CONFIG_INVALID', `Invalid myrmidon.config.ts:\n${issues}`);
  }

  return result.data;
}

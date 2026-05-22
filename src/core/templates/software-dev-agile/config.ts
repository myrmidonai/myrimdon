import type { AgentRole } from './roles.js';

export interface SoftwareDevAgileConfig {
  portAllocation: { base: number; range: number };
  monorepo: { packages: string[] };
  coderOverrides: Record<string, Partial<AgentRole>>;
  externalDependencies: string[];
}

export const DEFAULT_CONFIG: SoftwareDevAgileConfig = {
  portAllocation: { base: 3000, range: 100 },
  monorepo: { packages: ['packages/backend', 'packages/frontend'] },
  coderOverrides: {},
  externalDependencies: [],
};

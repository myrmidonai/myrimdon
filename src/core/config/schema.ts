import { z } from 'zod';

const RuntimeIdSchema = z.enum(['claude-code', 'opencode', 'gemini-cli', 'kimi-codex']);

const ExecutorSchema = z.object({
  runtime: RuntimeIdSchema.optional(),
  model: z.string().min(1),
  maxContextTokens: z.number().int().positive(),
});

const AgentRoleSchema = z.object({
  systemPrompt: z.string(),
  allowedTools: z.array(z.string()),
  forbiddenTools: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  mcpTools: z.array(z.string()).default([]),
  outputLanguage: z.enum(['zh', 'en']).default('zh'),
  contextRecoveryInstructions: z.string().default(''),
});

const AppSchema = z.object({
  root: z.string(),
  testCmd: z.string(),
  devCmd: z.string().optional(),
  basePort: z.number().int().positive(),
  coderOverrides: z.object({
    systemPromptAppend: z.string().optional(),
    skills: z.array(z.string()).default([]),
    additionalRules: z.array(z.string()).default([]),
  }).optional(),
  reviewRules: z.object({
    rulesFile: z.string().optional(),
    checklistItems: z.array(z.string()).default([]),
  }).optional(),
});

export const MyrmidonConfigSchema = z.object({
  project: z.object({
    name: z.string().min(1),
    lang: z.enum(['zh', 'en']).default('zh'),
    description: z.string().default(''),
  }),
  tui: z.object({
    lang: z.enum(['zh', 'en']).default('zh'),
  }).default({ lang: 'zh' }),
  audit: z.object({
    retention: z.string().default('30d'),
  }).default({ retention: '30d' }),
  basePort: z.number().int().positive().default(31000),
  executors: z.record(z.string(), ExecutorSchema),
  agentRoles: z.record(z.string(), AgentRoleSchema).default({}),
  agents: z.record(z.string(), z.object({
    role: z.string(),
    executor: z.string(),
    maxInstances: z.number().int().positive().optional(),
  })).default({}),
  apps: z.record(z.string(), AppSchema).optional(),
  externalDependencies: z.array(z.object({
    name: z.string(),
    path: z.string(),
    watchFor: z.enum(['changes']),
  })).default([]),
  runtime: z.object({
    maxRetries: z.number().int().nonnegative().default(3),
  }).default({ maxRetries: 3 }),
  dispatch: z.object({
    contextPressureThreshold: z.number().min(0).max(1).default(0.7),
    wrapUpSignalMessage: z.string().default('Context window is near capacity. Please write continue.md and exit.'),
    maxDispatchPromptTokens: z.number().int().positive().default(8000),
    toolResultMaxChars: z.number().int().positive().default(800),
    tokenProfile: z.enum(['budget', 'balanced', 'quality']).default('balanced'),
    contextEstimateThresholds: z.object({
      small:  z.number().int().positive().default(8_000),
      medium: z.number().int().positive().default(32_000),
      large:  z.number().int().positive().default(100_000),
    }).default({}),
  }).default({}),
  notifications: z.object({
    channels: z.array(z.object({ type: z.string() }).passthrough()).default([]),
  }).default({ channels: [] }),
  workflows: z.array(z.string()).optional(),
});

export type MyrmidonConfig = z.infer<typeof MyrmidonConfigSchema>;
export type RuntimeId = z.infer<typeof RuntimeIdSchema>;

export function defineConfig(config: z.input<typeof MyrmidonConfigSchema>): z.input<typeof MyrmidonConfigSchema> {
  return config;
}

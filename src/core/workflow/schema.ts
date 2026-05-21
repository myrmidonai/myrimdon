import { z } from 'zod';

export const NodeTypeSchema = z.enum([
  'agent',
  'human_approval',
  'condition',
  'parallel_fork',
  'join',
  'transform',
  'trigger',
  'loop',
]);
export type NodeType = z.infer<typeof NodeTypeSchema>;

const ArtifactRefSchema = z.object({ id: z.string() });
const ArtifactDefSchema = z.object({ id: z.string(), path: z.string() });

const HookDefSchema = z.object({
  type: z.enum(['skill', 'script', 'notify', 'transform']),
  ref: z.string(),
  args: z.record(z.string(), z.unknown()).optional(),
});

const PluginRefSchema = z.object({
  id: z.string(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const ValidatorDefSchema = z.object({
  required: z.array(z.string()).optional(),
});

export const HumanApprovalDefSchema = z.object({
  message: z.string(),
  timeoutMs: z.number().int().positive().optional(),
  onTimeout: z.enum(['auto_approve', 'auto_reject', 'escalate']),
  notifyChannels: z.array(z.string()).optional(),
  allowedActions: z.array(z.enum(['approve', 'reject', 'defer'])),
  onReject: z.string().optional(),
});

export const NodeDefSchema = z.object({
  id: z.string().min(1),
  type: NodeTypeSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  agentRole: z.string().optional(),
  executor: z.string().optional(),
  skills: z.array(z.string()).optional(),
  mcpTools: z.array(z.string()).optional(),
  plugins: z.array(PluginRefSchema).optional(),
  artifacts: z
    .object({
      consumes: z.array(ArtifactRefSchema),
      produces: z.array(ArtifactDefSchema),
    })
    .optional(),
  inputValidator: ValidatorDefSchema.optional(),
  outputValidator: ValidatorDefSchema.optional(),
  hooks: z
    .object({
      pre: z.array(HookDefSchema).optional(),
      post: z.array(HookDefSchema).optional(),
      onError: z.array(HookDefSchema).optional(),
    })
    .optional(),
  humanApproval: HumanApprovalDefSchema.optional(),
  retry: z
    .object({
      maxAttempts: z.number().int().positive().default(3),
      backoffMs: z.number().int().nonnegative().default(5000),
    })
    .optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const EdgeDefSchema = z.object({
  from: z.string(),
  to: z.string(),
  condition: z.string().optional(),
  label: z.string().optional(),
});

const WorkflowConfigSchema = z.object({
  maxParallelNodes: z.number().int().positive().optional(),
  defaultTimeoutMs: z.number().int().positive().optional(),
  timers: z
    .object({
      workflowPollMs: z.number().int().positive().optional(),
      heartbeatMs: z.number().int().positive().optional(),
      clientTimeoutMs: z.number().int().positive().optional(),
      stuckDetectionMs: z.number().int().positive().optional(),
      consistencyMs: z.number().int().positive().optional(),
      externalDepWatchMs: z.number().int().positive().optional(),
    })
    .optional(),
});

export const WorkflowDefSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  nodes: z.array(NodeDefSchema).min(1),
  edges: z.array(EdgeDefSchema),
  config: WorkflowConfigSchema.optional(),
});

export type NodeDef = z.infer<typeof NodeDefSchema>;
export type EdgeDef = z.infer<typeof EdgeDefSchema>;
export type WorkflowDef = z.infer<typeof WorkflowDefSchema>;
export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;
export type HumanApprovalDef = z.infer<typeof HumanApprovalDefSchema>;
export type ArtifactDef = z.infer<typeof ArtifactDefSchema>;
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;

export function defineWorkflow(
  def: z.input<typeof WorkflowDefSchema>,
): WorkflowDef {
  return WorkflowDefSchema.parse(def);
}

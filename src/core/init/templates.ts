import type { RuntimeId } from '../config/schema.js';

export interface TemplateOptions {
  name: string;
  lang: 'zh' | 'en';
  template: 'default' | 'web' | 'mobile' | 'saas' | 'monorepo';
  basePort: number;
  runtime: RuntimeId;
  isExisting: boolean;
  targetDir: string;
}

export function generateConfig(opts: TemplateOptions): string {
  return `// @ts-ignore — defineConfig is a passthrough type helper
const defineConfig = (c) => c;

export default defineConfig({
  project: {
    name: '${opts.name}',
    lang: '${opts.lang}',
    description: '',
  },

  tui: { lang: '${opts.lang}' },
  audit: { retention: '30d' },
  basePort: ${opts.basePort},

  executors: {
    sonnet: {
      runtime: '${opts.runtime}',
      model: 'claude-sonnet-4-6',
      maxContextTokens: 200_000,
    },
  },

  agentRoles: {},
  agents: {},

  // workflows: ['software-dev-agile'],
});
`;
}

export function generateEnvExample(): string {
  return `# Claude Code / Anthropic API
ANTHROPIC_API_KEY=

# Notifications (fill as needed)
SLACK_WEBHOOK_URL=
WECOM_WEBHOOK_URL=
SMTP_PASS=

# External integrations (fill as needed)
FIGMA_TOKEN=
GITHUB_TOKEN=
LINEAR_API_KEY=
`;
}

export function generateGitignoreEntries(): string {
  return `.env
.myrmidon/runtime/
.myrmidon/logs/
node_modules/
dist/
`;
}

export function generateClaudeMd(opts: TemplateOptions): string {
  return `## Myrmidon

This project is orchestrated by Myrmidon.

- Config: \`myrmidon.config.ts\`
- Runtime: ${opts.runtime}
- Start: \`myrmidon start\`
- Status: \`myrmidon status\`
`;
}

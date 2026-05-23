import { defineConfig } from './src/core/config/schema.js';

export default defineConfig({
  project: {
    name: 'myrmidon-smoke-test',
    lang: 'en',
    description: 'Smoke test project',
  },
  executors: {
    sonnet: {
      model: 'claude-sonnet-4',
      maxContextTokens: 200_000,
    },
  },
  agentRoles: {},
});

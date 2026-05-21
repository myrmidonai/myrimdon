import { describe, it, expect } from 'vitest';
import {
  generateConfig,
  generateEnvExample,
  generateGitignoreEntries,
  generateClaudeMd,
} from '../../../src/core/init/templates.js';

const baseOpts = {
  name: 'my-app',
  lang: 'zh' as const,
  template: 'default' as const,
  basePort: 31000,
  runtime: 'claude-code' as const,
  isExisting: false,
  targetDir: '/tmp/my-app',
};

describe('generateConfig', () => {
  it('includes project name and runtime', () => {
    const out = generateConfig(baseOpts);
    expect(out).toContain("name: 'my-app'");
    expect(out).toContain("runtime: 'claude-code'");
    expect(out).toContain('basePort: 31000');
  });

  it('is valid TypeScript (contains defineConfig call)', () => {
    expect(generateConfig(baseOpts)).toContain('defineConfig(');
  });
});

describe('generateEnvExample', () => {
  it('includes ANTHROPIC_API_KEY', () => {
    expect(generateEnvExample()).toContain('ANTHROPIC_API_KEY=');
  });
  it('includes notification keys', () => {
    const out = generateEnvExample();
    expect(out).toContain('SLACK_WEBHOOK_URL=');
    expect(out).toContain('SMTP_PASS=');
  });
});

describe('generateGitignoreEntries', () => {
  it('includes .env and runtime dir', () => {
    const out = generateGitignoreEntries();
    expect(out).toContain('.env\n');
    expect(out).toContain('.myrmidon/runtime/');
    expect(out).toContain('.myrmidon/logs/');
  });
});

describe('generateClaudeMd', () => {
  it('includes ## Myrmidon section', () => {
    expect(generateClaudeMd(baseOpts)).toContain('## Myrmidon');
  });
});

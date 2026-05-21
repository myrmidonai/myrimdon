import { Command } from 'commander';
import { resolve } from 'node:path';
import { runWizard } from '../../core/init/wizard.js';
import { scaffold } from '../../core/init/scaffolder.js';
import { detectRuntimes } from '../../core/runtime/detector.js';
import { loadConfig } from '../../core/config/loader.js';
import { MyrmidonError } from '../../utils/errors.js';
import type { RuntimeId } from '../../core/config/schema.js';

export function makeInitCommand(): Command {
  const cmd = new Command('init');
  cmd.description('Initialize a Myrmidon project or add to an existing one');
  cmd.argument('[name]', 'Project name (new projects only)');
  cmd.option('--lang <lang>', 'Document language: zh | en', 'zh');
  cmd.option('--template <template>', 'Template: default | web | mobile | saas | monorepo', 'default');
  cmd.option('--base-port <port>', 'Base port for worktrees', '31000');
  cmd.option('--runtime <runtime>', 'AI runtime: claude-code | opencode | gemini-cli | kimi-codex');
  cmd.option('--add', 'Add Myrmidon to existing project in current directory');
  cmd.option('--yes', 'Skip prompts, use defaults (CI mode)');

  cmd.action(async (name: string | undefined, opts: {
    lang: string; template: string; basePort: string;
    runtime?: string; add?: boolean; yes?: boolean;
  }) => {
    try {
      const hasExplicitArgs = Boolean(name ?? opts.add ?? opts.yes);
      let answers;

      if (!hasExplicitArgs) {
        answers = await runWizard();
      } else {
        const detected = detectRuntimes();
        const runtime = (opts.runtime ?? detected[0]?.id) as RuntimeId | undefined;
        if (!runtime) {
          console.error('✗ No runtime detected. Install one or pass --runtime <id>.');
          process.exit(1);
        }
        answers = {
          isExisting: Boolean(opts.add),
          name: name ?? process.cwd().split('/').pop() ?? 'my-project',
          lang: opts.lang as 'zh' | 'en',
          template: opts.template as 'default' | 'web' | 'mobile' | 'saas' | 'monorepo',
          basePort: parseInt(opts.basePort, 10),
          runtime,
        };
      }

      const targetDir = answers.isExisting
        ? process.cwd()
        : resolve(process.cwd(), answers.name);

      console.log('\nInitializing Myrmidon...\n');
      const result = scaffold({ ...answers, targetDir });

      for (const f of result.created) console.log(`  ✓ created   ${f}`);
      for (const f of result.appended) console.log(`  + appended  ${f}`);
      for (const f of result.skipped) console.log(`  ─ skipped   ${f}`);

      console.log('\nValidating configuration...');
      const config = await loadConfig(targetDir);
      console.log(`✓ Config valid — project: ${config.project.name}`);
      console.log(`\n✓ Done! Next: cd ${answers.name} && myrmidon start`);
    } catch (err) {
      if (err instanceof MyrmidonError) {
        console.error(`\n✗ ${err.message}`);
      } else {
        console.error(`\n✗ Unexpected error: ${String(err)}`);
      }
      process.exit(1);
    }
  });

  return cmd;
}

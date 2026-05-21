import { detectRuntimes, getRuntimeInstallGuide, type RuntimeId } from '../runtime/detector.js';
import { MyrmidonError } from '../../utils/errors.js';

export interface WizardAnswers {
  isExisting: boolean;
  name: string;
  lang: 'zh' | 'en';
  template: 'default' | 'web' | 'mobile' | 'saas' | 'monorepo';
  basePort: number;
  runtime: RuntimeId;
}

export async function runWizard(): Promise<WizardAnswers> {
  // @ts-expect-error inquirer v9 lacks TypeScript definitions
  const { default: inquirer } = await import('inquirer');
  const detected = detectRuntimes();

  if (detected.length === 0) {
    throw new MyrmidonError(
      'NO_RUNTIME',
      `No supported AI runtime detected.\n\nInstall one:\n${getRuntimeInstallGuide()}\n\nThen retry.`,
    );
  }

  const runtimeChoices = detected.map(rt => ({
    name: `${rt.id.padEnd(14)} ${rt.version}`,
    value: rt.id as RuntimeId,
  }));

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'mode',
      message: 'New project or add Myrmidon to existing project?',
      choices: [
        { name: 'New project', value: 'new' },
        { name: 'Existing project (current directory)', value: 'existing' },
      ],
    },
    {
      type: 'input',
      name: 'name',
      message: 'Project name:',
      when: (a: { mode: string }) => a.mode === 'new',
      validate: (v: string) => v.trim().length > 0 || 'Project name is required',
    },
    {
      type: 'list',
      name: 'lang',
      message: 'Document language:',
      choices: [{ name: '中文 (zh)', value: 'zh' }, { name: 'English (en)', value: 'en' }],
    },
    {
      type: 'list',
      name: 'template',
      message: 'Project template:',
      choices: ['default', 'web', 'mobile', 'saas', 'monorepo'],
    },
    {
      type: 'number',
      name: 'basePort',
      message: 'Base port for worktrees:',
      default: 31000,
      validate: (v: number) => (v > 1024 && v < 65000) || 'Must be 1025–64999',
    },
    detected.length === 1
      ? {
          type: 'confirm',
          name: 'runtimeConfirm',
          message: `Use ${detected[0]!.id} (${detected[0]!.version})?`,
          default: true,
        }
      : {
          type: 'list',
          name: 'runtime',
          message: 'Select AI runtime:',
          choices: runtimeChoices,
        },
  ]) as Record<string, unknown>;

  const runtime: RuntimeId = detected.length === 1
    ? (answers.runtimeConfirm as boolean ? detected[0]!.id : (() => { throw new MyrmidonError('NO_RUNTIME', 'Runtime selection cancelled'); })())
    : answers.runtime as RuntimeId;

  return {
    isExisting: answers.mode === 'existing',
    name: (answers.name as string | undefined) ?? process.cwd().split('/').pop() ?? 'my-project',
    lang: answers.lang as 'zh' | 'en',
    template: answers.template as 'default' | 'web' | 'mobile' | 'saas' | 'monorepo',
    basePort: answers.basePort as number,
    runtime,
  };
}

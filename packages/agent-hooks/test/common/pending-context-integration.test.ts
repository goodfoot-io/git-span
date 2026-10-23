/** Real native selection crosses the shell driver and ordinary delivery history without losing context. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDefaultPlannedTouchStore, runLayeredBashTouches } from '../../src/common/bash-attribution.js';
import { createDiskMemoStore } from '../../src/common/span-surface.js';
import { createDefaultTouchExecutors, runTouchHook } from '../../src/common/touch-core.js';
import { makeTempRepo } from '../helpers.js';
import { buildWorkspaceGitSpan } from '../real-bundle-helpers.js';
import { makeTempLayout } from '../session-layout-helpers.js';

let binary = '';
const previousPath = process.env.PATH;
beforeAll(() => {
  const built = buildWorkspaceGitSpan();
  binary = built.binary;
  process.env.PATH = `${built.pathDir}${delimiter}${previousPath ?? ''}`;
}, 600_000);
afterAll(() => {
  if (previousPath === undefined) delete process.env.PATH;
  else process.env.PATH = previousPath;
});

function fixture() {
  const repo = makeTempRepo();
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo.root, encoding: 'utf8' });
  const span = (...args: string[]): string => execFileSync(binary, args, { cwd: repo.root, encoding: 'utf8' });
  const original = Array.from({ length: 20 }, (_, index) => `value_${index} = ${index}\n`).join('');
  writeFileSync(join(repo.root, 'foo.py'), original);
  writeFileSync(join(repo.root, 'counterpart.py'), 'validate = True\n');
  writeFileSync(join(repo.root, 'unrelated.py'), 'unrelated = True\n');
  git('add', '.');
  git('-c', 'user.name=Pending Test', '-c', 'user.email=pending@example.test', 'commit', '-qm', 'baseline');
  span('add', 'selected-relationship', 'foo.py#L1-L2', 'counterpart.py');
  span('why', 'selected-relationship', 'Discovery supplies the inputs that validation checks.');
  span('add', 'unchanged-range', 'foo.py#L15-L16');
  span('add', 'other-change', 'unrelated.py');
  git('add', '.span');
  git('-c', 'user.name=Pending Test', '-c', 'user.email=pending@example.test', 'commit', '-qm', 'relationships');
  writeFileSync(join(repo.root, 'foo.py'), original.replace('value_0 = 0', 'value_0 = 900'));
  writeFileSync(join(repo.root, 'unrelated.py'), 'unrelated = False\n');
  return { ...repo, git };
}

describe('native pending report integration', () => {
  it.each([
    'git diff -- foo.py',
    'git diff --name-only -- foo.py',
    'git diff --quiet -- foo.py',
    'git diff -U100 -- foo.py'
  ])('delivers exactly the complete selected relationships for %s after ordinary touch delivery', async (command) => {
    const repo = fixture();
    const temp = makeTempLayout();
    try {
      const before = repo.git('status', '--porcelain');
      const logger = { warn: (_message: string) => {} };
      const memo = createDiskMemoStore(logger, temp.layout);
      const executors = createDefaultTouchExecutors();
      const ordinary = await runTouchHook(
        {
          kind: 'read',
          sessionId: 'integration',
          cwd: repo.root,
          filePath: join(repo.root, 'foo.py'),
          observedRange: { start: 1, end: 2 }
        },
        executors,
        memo,
        undefined,
        logger
      );
      expect(ordinary.additionalContext).not.toBeNull();
      expect(memo.getSurfaced('integration').size).toBeGreaterThan(0);
      const blocks = await runLayeredBashTouches(
        command,
        repo.root,
        'integration',
        'inspection',
        { exit_code: command.includes('--quiet') ? 1 : 0, output: '' },
        executors,
        memo,
        logger,
        createDefaultPlannedTouchStore(temp.layout)
      );
      const output = blocks.join('');
      expect(output).toContain('## selected-relationship');
      expect(output).toContain('counterpart.py');
      expect(output).toContain('Discovery supplies the inputs that validation checks.');
      expect(output).toMatch(/foo\.py\s*#L1-L2 — changed/);
      expect(output).not.toContain('## other-change');
      expect(output).not.toContain('## unchanged-range');
      expect(output.match(/<git-span>/g)).toHaveLength(1);
      expect(repo.git('status', '--porcelain')).toBe(before);
    } finally {
      temp.cleanup();
      repo.cleanup();
    }
  });

  it('preserves status layers that cancel in a HEAD comparison and reports native unsupported selection errors', async () => {
    const repo = fixture();
    const temp = makeTempLayout();
    try {
      repo.git('add', 'foo.py');
      writeFileSync(join(repo.root, 'foo.py'), repo.git('show', 'HEAD:foo.py'));
      const logger = { warn: (_message: string) => {} };
      const executors = createDefaultTouchExecutors();
      const memo = createDiskMemoStore(logger, temp.layout);
      const store = createDefaultPlannedTouchStore(temp.layout);
      const run = (command: string) =>
        runLayeredBashTouches(
          command,
          repo.root,
          'integration',
          undefined,
          { exit_code: 0, output: '' },
          executors,
          memo,
          logger,
          store
        );
      expect((await run('git status --short -- foo.py')).join('')).toContain('## selected-relationship');
      expect(await run('git diff HEAD -- foo.py')).toEqual([]);
      const failure = (await run('git diff --ignore-all-space -- foo.py')).join('');
      expect(failure).toMatch(/Complete pending context unavailable/);
      expect(failure).not.toContain('<git-span>');
    } finally {
      temp.cleanup();
      repo.cleanup();
    }
  });
  it('preserves unrelated ordinary read attribution in an unsupported compound', async () => {
    const repo = fixture();
    const temp = makeTempLayout();
    try {
      const warnings: string[] = [];
      const logger = {
        warn: (message: string) => {
          warnings.push(message);
        }
      };
      const blocks = await runLayeredBashTouches(
        'cat foo.py; git status',
        repo.root,
        'integration',
        'compound',
        { exit_code: 0, output: '' },
        createDefaultTouchExecutors(),
        createDiskMemoStore(logger, temp.layout),
        logger,
        createDefaultPlannedTouchStore(temp.layout)
      );
      expect(warnings).toContain('git-span pending inspection unsupported');
      expect(blocks.join('')).toContain('foo.py');
      expect(blocks.join('')).not.toContain('## selected-relationship');
    } finally {
      temp.cleanup();
      repo.cleanup();
    }
  });
});

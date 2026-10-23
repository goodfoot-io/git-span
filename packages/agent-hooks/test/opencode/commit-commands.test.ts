/** Commit and push remain advisory while status delivers full pending span context. */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assemblePlugin } from '../../src/opencode/index.js';
import { present } from '../helpers.js';
import { addLineSpan, buildWorkspaceGitSpan, commitRepo, makeRealBundleRepo } from '../real-bundle-helpers.js';
import { makeTempLayout } from '../session-layout-helpers.js';

describe('opencode commit commands', () => {
  let pathDir: string;
  const previousPath = process.env.PATH;
  beforeAll(() => {
    pathDir = buildWorkspaceGitSpan().pathDir;
    process.env.PATH = `${pathDir}${delimiter}${previousPath ?? ''}`;
  }, 600_000);
  afterAll(() => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  });
  it.each(['git commit -m change', 'git push', 'git status'])(
    'preserves %s execution and supplies pending context only for status',
    async (command) => {
      const repo = makeRealBundleRepo(pathDir);
      const temp = makeTempLayout();
      const warnings: string[] = [];
      try {
        writeFileSync(join(repo.root, 'tracked.ts'), 'export const x = 1;\n');
        commitRepo(repo, 'seed tracked file');
        addLineSpan(repo, 'test/changed-anchor', 'tracked.ts', 1, 1);
        commitRepo(repo, 'record span');
        writeFileSync(join(repo.root, 'tracked.ts'), 'export const x = 2;\n');
        writeFileSync(join(repo.root, 'uncovered.ts'), 'export const y = 1;\n');
        const drift = spawnSync('git', ['span', 'drift', '--format', 'porcelain'], {
          cwd: repo.root,
          env: repo.env,
          encoding: 'utf8'
        });
        expect(drift.status).toBe(1);
        expect(drift.stdout).toContain('CHANGED');
        const hooks = assemblePlugin({
          directory: repo.root,
          layout: temp.layout,
          logger: { warn: (message) => warnings.push(message) }
        });
        const input = { tool: 'bash', sessionID: 'session', callID: 'call' };
        const before = { args: { command } };
        await expect(
          present(hooks['tool.execute.before'], 'the tool.execute.before hook')(input, before)
        ).resolves.toBeUndefined();
        expect(before).toEqual({ args: { command } });
        const after = { output: 'original result', metadata: { output: 'original result', exit: 0 } };
        await present(hooks['tool.execute.after'], 'the tool.execute.after hook')(
          { ...input, args: before.args },
          after
        );
        if (command === 'git status') {
          expect(after.output).toContain('original result');
          expect(after.output).toContain('## test/changed-anchor');
          expect(after.output).toMatch(/tracked\.ts\s*#L1-L1 — changed/);
        } else expect(after.output).toBe('original result');
        expect(warnings).toEqual([]);
        await present(hooks.dispose, 'the dispose hook')();
      } finally {
        temp.cleanup();
        repo.cleanup();
      }
    }
  );
});

/** Commit, push and status calls traverse the real plugin without commit-time span work. */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { assemblePlugin } from '../../src/opencode/index.js';
import { addLineSpan, buildWorkspaceGitSpan, commitRepo, makeRealBundleRepo } from '../real-bundle-helpers.js';
import { makeTempLayout } from '../session-layout-helpers.js';

describe('opencode commit commands', () => {
  let pathDir: string;
  beforeAll(() => {
    pathDir = buildWorkspaceGitSpan().pathDir;
  }, 600_000);
  it.each(['git commit -m change', 'git push', 'git status'])(
    'allows %s without span context or report state',
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
        await expect(hooks['tool.execute.before']!(input, before)).resolves.toBeUndefined();
        expect(before).toEqual({ args: { command } });
        const after = { output: 'original result', metadata: { output: 'original result', exit: 0 } };
        await hooks['tool.execute.after']!({ ...input, args: before.args }, after);
        expect(after.output).toBe('original result');
        expect(warnings).toEqual([]);
        await hooks.dispose!();
      } finally {
        temp.cleanup();
        repo.cleanup();
      }
    }
  );
});

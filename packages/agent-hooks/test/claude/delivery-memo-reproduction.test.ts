/** D4/D4b: new evidence and repository identity must survive session deduplication. */
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { Logger } from '@goodfoot/agent-hooks/claude-code';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHandler } from '../../src/claude/post-tool-use.js';
import { makeTempRepo } from '../helpers.js';
import { buildWorkspaceGitSpan } from '../real-bundle-helpers.js';
import { makeTempLayout } from '../session-layout-helpers.js';

let binary: string;
const cleanups: (() => void)[] = [];
const logger = new Logger();

beforeAll(() => {
  const built = buildWorkspaceGitSpan();
  binary = built.binary;
  vi.stubEnv('PATH', `${built.pathDir}${delimiter}${process.env.PATH ?? ''}`);
}, 600_000);
afterAll(() => vi.unstubAllEnvs());
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function setupRepo(value = 1) {
  const repo = makeTempRepo();
  cleanups.push(repo.cleanup);
  const file = join(repo.root, 'app.py');
  const setValue = (next: number) => writeFileSync(file, `value = ${next}\nother = 0\n`);
  setValue(value);
  writeFileSync(join(repo.root, 'witness.txt'), 'Source and witness must agree.\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo.root, stdio: 'pipe' });
  const commit = () => {
    git('add', '.');
    git('-c', 'user.name=Probe', '-c', 'user.email=probe@example.invalid', 'commit', '-qm', 'fixture');
  };
  commit();
  execFileSync(binary, ['add', 'probe', 'app.py#L1-L1', 'witness.txt#L1-L1'], { cwd: repo.root });
  execFileSync(binary, ['why', 'probe', 'Source and witness must agree.'], { cwd: repo.root });
  commit();
  return { root: repo.root, file, setValue };
}

function setupHook() {
  const temp = makeTempLayout();
  cleanups.push(temp.cleanup);
  // The production disk memo is intentionally shared across every invocation and repo.
  const handler = createHandler(undefined, undefined, temp.layout);
  let invocation = 0;
  return async (
    repo: ReturnType<typeof setupRepo>,
    tool: 'Read' | 'Edit' = 'Read',
    value = 1,
    session = 'delivery-reproduction'
  ) => {
    const input = {
      hook_event_name: 'PostToolUse' as const,
      session_id: session,
      transcript_path: '/tmp/delivery-reproduction.jsonl',
      cwd: repo.root,
      tool_use_id: `delivery-${++invocation}`,
      tool_name: tool,
      tool_response: {},
      tool_input:
        tool === 'Read'
          ? { file_path: repo.file, offset: 1, limit: 1 }
          : { file_path: repo.file, old_string: `value = ${value - 1}`, new_string: `value = ${value}` }
    };
    const result = await handler(input as Parameters<typeof handler>[0], { logger });
    return result?.stdout.hookSpecificOutput?.additionalContext ?? '';
  };
}

describe('delivery memo correctness reproductions', () => {
  it('D4: re-delivers a second distinct CHANGED revision after Read', async () => {
    const repo = setupRepo();
    const hook = setupHook();
    expect(await hook(repo)).toContain('is anchored in: probe');
    expect(await hook(repo)).toBe(''); // Identical evidence remains deduplicated.
    repo.setValue(2);
    expect(await hook(repo)).toContain('(changed in probe)');
    expect(await hook(repo)).toBe('');
    repo.setValue(3);
    const secondChange = await hook(repo);
    // A fresh session proves the missing block is memo suppression, not missing context.
    expect(await hook(repo, 'Read', 3, 'fresh-session')).toContain('(changed in probe)');
    expect(secondChange).toContain('(changed in probe)');
  });

  it('D4b: re-delivers a second Edit while the CLI still reports CHANGED', async () => {
    const repo = setupRepo();
    const hook = setupHook();
    expect(await hook(repo)).toContain('is anchored in: probe');
    repo.setValue(2);
    expect(await hook(repo, 'Edit', 2)).toContain('(changed in probe)');
    expect(await hook(repo)).toBe('');
    repo.setValue(3);
    const secondEdit = await hook(repo, 'Edit', 3);
    const drift = spawnSync(binary, ['drift'], { cwd: repo.root, encoding: 'utf8' });
    expect(drift.status).toBe(1);
    expect(drift.stdout).toContain('app.py#L1-L1 — changed in the working tree');
    expect(secondEdit).toContain('(changed in probe)');
  });

  it('D4: delivers the same-named span from another repository in one session', async () => {
    const first = setupRepo();
    const second = setupRepo(100);
    const hook = setupHook();
    expect(await hook(first)).toContain('is anchored in: probe');
    expect(await hook(first)).toBe('');
    const otherRepo = await hook(second);
    expect(await hook(second, 'Read', 100, 'fresh-session')).toContain('is anchored in: probe');
    expect(otherRepo).toContain('is anchored in: probe');
  });
});

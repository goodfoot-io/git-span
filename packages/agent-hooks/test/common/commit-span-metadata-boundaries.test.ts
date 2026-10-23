/** Real receipt drains must not create review notes for span metadata commits. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { enrollCommitInvocation, terminalCommitInvocation } from '../../src/common/commit-runtime.js';
import { inspectCommitSpanMetadata } from '../../src/common/commit-span-metadata.js';
import { buildWorkspaceGitSpan } from '../real-bundle-helpers.js';

let binary: string;
let scratch: string;
let repo: string;
const git = (args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
beforeAll(() => {
  binary = buildWorkspaceGitSpan().binary;
}, 600000);
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'span-note-exclusion-'));
  repo = join(scratch, 'repo');
  mkdirSync(repo);
  git(['init', '-q']);
  git(['config', 'user.name', 'Note Agent']);
  git(['config', 'user.email', 'notes@example.test']);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(scratch, { recursive: true, force: true });
});

const inspect = () => inspectCommitSpanMetadata('git', repo, git(['rev-parse', 'HEAD']), performance.now() + 3000);
function commit(paths: string[]) {
  for (const path of paths) {
    mkdirSync(join(repo, path, '..'), { recursive: true });
    writeFileSync(join(repo, path), 'content');
  }
  git(['add', '-A']);
  git(['commit', '-q', '--allow-empty', '-m', 'test']);
}

it.each([
  { paths: ['.span/a'], expected: 'metadata-only' },
  { paths: ['.spans/a'], expected: 'metadata-only' },
  { paths: ['.span/a', 'source.ts'], expected: 'material' },
  { paths: ['.span-source/a'], expected: 'material' },
  { paths: ['.span/a\nsource.ts'], expected: 'metadata-only' },
  { paths: ['source\n.span/a'], expected: 'material' },
  { paths: [], expected: 'empty' }
])('classifies root commit paths $paths as $expected', async ({ paths, expected }) => {
  commit(paths);
  expect(await inspect()).toBe(expected);
});

it.each(['config', 'environment'] as const)(
  'honors the %s span root and keeps default metadata excluded',
  async (kind) => {
    if (kind === 'config') git(['config', 'git-span.dir', 'custom/root']);
    else {
      git(['config', 'git-span.dir', 'ignored-root']);
      vi.stubEnv('GIT_SPAN_DIR', join(repo, 'custom/root'));
    }
    commit(['custom/root/review.json', '.span/default.json']);
    expect(await inspect()).toBe('metadata-only');
  }
);

it('treats a rename out of span metadata as material', async () => {
  commit(['.span/review.json']);
  git(['mv', '.span/review.json', 'source.ts']);
  git(['commit', '-q', '-m', 'rename']);
  expect(await inspect()).toBe('material');
});

it('checks all merge parents', async () => {
  commit(['base.ts']);
  git(['checkout', '-q', '-b', 'side']);
  commit(['side.ts']);
  git(['checkout', '-q', '-']);
  commit(['.span/review.json']);
  git(['merge', '-q', '--no-ff', '-m', 'merge', 'side']);
  expect(await inspect()).toBe('material');
});

it('reclassifies previously published receipts before writing notes and retains inspection failures', async () => {
  const input = {
    host: 'claude' as const,
    sessionId: 'retry-session',
    toolUseId: 'commit',
    cwd: repo,
    toolInput: { command: 'git commit -q -m metadata' }
  };
  const options = { stateRoot: join(scratch, 'receipts'), notesExecutable: binary, lockExecutable: binary };
  const warnings: string[] = [];
  const logger = { warn: (message: string) => warnings.push(message) };
  expect((await enrollCommitInvocation(input, options, logger)).kind).toBe('enrolled');
  commit(['custom/review.json']);
  expect(
    await terminalCommitInvocation(input, { ...options, notesExecutable: '/missing-notes' }, logger)
  ).toMatchObject({
    acknowledged: 0,
    pending: 1
  });
  const config = join(repo, '.git', 'config');
  const originalConfig = readFileSync(config, 'utf8');
  // Corrupt only configuration after publication: a failed inspection must keep its receipt retryable.
  writeFileSync(config, '[invalid');
  warnings.length = 0;
  expect(await terminalCommitInvocation(input, options, logger)).toMatchObject({ acknowledged: 0, pending: 1 });
  expect(warnings).toEqual([expect.stringContaining('note commit inspection unavailable')]);
  writeFileSync(config, originalConfig);
  git(['config', 'git-span.dir', 'custom']);
  warnings.length = 0;
  expect(await terminalCommitInvocation(input, options, logger)).toMatchObject({ acknowledged: 1, pending: 0 });
  const listed = JSON.parse(
    execFileSync(binary, ['notes', 'list', '--format', 'json'], { cwd: repo, encoding: 'utf8' })
  );
  expect(listed.notes).toEqual([]);
  expect(warnings).toEqual([]);
});

it.each([{ paths: ['.span/review.json', 'source.ts'] }, { paths: [] }])(
  'records notes for mixed and empty commits ($paths)',
  async ({ paths }) => {
    const input = {
      host: 'codex' as const,
      sessionId: 'material-session',
      toolUseId: 'commit',
      cwd: repo,
      toolInput: { command: 'git commit -q --allow-empty -m material' }
    };
    const options = { stateRoot: join(scratch, 'receipts'), notesExecutable: binary, lockExecutable: binary };
    const warnings: string[] = [];
    const logger = { warn: (message: string) => warnings.push(message) };
    expect((await enrollCommitInvocation(input, options, logger)).kind).toBe('enrolled');
    commit(paths);
    expect(await terminalCommitInvocation(input, options, logger)).toMatchObject({ acknowledged: 1, pending: 0 });
    const listed = JSON.parse(
      execFileSync(binary, ['notes', 'list', '--format', 'json'], { cwd: repo, encoding: 'utf8' })
    );
    expect(listed.notes).toHaveLength(1);
    expect(warnings).toEqual([]);
  }
);

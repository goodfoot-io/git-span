/** Real receipt drains must not create review notes for span metadata commits. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { enrollCommitInvocation, terminalCommitInvocation } from '../../src/common/commit-runtime.js';
import { buildWorkspaceGitSpan } from '../real-bundle-helpers.js';

let binary: string;
let scratch: string;
let repo: string;
let sequence = 0;
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

it.each(['claude', 'codex'] as const)('does not write %s notes for metadata-only commits', async (host) => {
  mkdirSync(join(repo, '.span'));
  writeFileSync(join(repo, '.span', 'review.json'), '{}');
  git(['add', '.span']);
  const input = {
    host,
    sessionId: 'metadata-session',
    toolUseId: `commit-${sequence++}`,
    cwd: repo,
    toolInput: { command: 'git commit -q -m metadata' }
  };
  const options = { stateRoot: join(scratch, 'receipts'), notesExecutable: binary, lockExecutable: binary };
  const warnings: string[] = [];
  const logger = { warn: (message: string) => warnings.push(message) };
  expect((await enrollCommitInvocation(input, options, logger)).kind).toBe('enrolled');
  git(['commit', '-q', '-m', 'metadata']);
  expect(await terminalCommitInvocation(input, options, logger)).toMatchObject({ acknowledged: 1, pending: 0 });
  const listed = JSON.parse(
    execFileSync(binary, ['notes', 'list', '--format', 'json'], { cwd: repo, encoding: 'utf8' })
  );
  expect(listed.notes).toEqual([]);
  expect(warnings).toEqual([]);
});

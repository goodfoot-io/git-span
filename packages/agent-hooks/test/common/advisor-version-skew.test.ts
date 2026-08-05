/**
 * Reproduction: hook/binary version skew must not present as an ordinary scan
 * failure.
 *
 * The plugin bundle and the `git-span` binary install through independent
 * channels — the marketplace and npm — so one being newer than the other is a
 * routine state for however long a user waits between the two updates. It fires
 * in both directions, and the *lagging plugin* is the more common one: npm's
 * postinstall runs whenever a project's dependencies are installed, while the
 * plugin waits on a marketplace sync.
 *
 * Either way the binary's argument parser rejects the command with exit 2 and a
 * usage block naming whichever subcommand it guessed at — a command the user
 * never ran. That is empty stdout plus non-empty stderr, which is exactly the
 * hard-scan-failure shape, so it used to resolve to a generic `scan-failed`
 * warning that pointed at a repository problem that does not exist. The `--fix`
 * executor was worse: it swallowed the error outright, so auto-reanchoring
 * stopped with no signal at all.
 *
 * Unlike the other advisor tests, these exercise `createDefaultAdvisorExecutors`
 * against a real binary on PATH rather than injected fakes — the defect lives
 * entirely in the subprocess layer those fakes stand in for. The binary is a
 * shim script, so the test does not depend on which real git-span happens to be
 * installed and can stage both directions of skew.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AdvisorIncompatibleCliError,
  type AdvisorMemoState,
  AdvisorScanError,
  createDefaultAdvisorExecutors,
  evaluateAdvisor,
  REQUIRED_GIT_SPAN_VERSION
} from '../../src/common/advisor-core.js';

/** An in-memory {@link AdvisorMemoState} — one Set of presented digests. */
function memoryMemoState(): AdvisorMemoState {
  const seen = new Set<string>();
  return {
    has: (digest) => seen.has(digest),
    record: (digest) => {
      seen.add(digest);
      return true;
    }
  };
}

/**
 * A repo plus a `git-span` shim on PATH.
 *
 * `git span <sub>` dispatches to whatever `git-span` PATH resolves to, so
 * prepending a directory containing an executable of that name is enough to
 * stand in for any binary version. `process.env.PATH` is mutated because the
 * executors under test deliberately inherit the ambient environment — passing
 * an env through would test a code path production never takes.
 */
interface Harness {
  root: string;
  cleanup: () => void;
}

function makeHarness(shim: string): Harness {
  const root = mkdtempSync(nodePath.join(tmpdir(), 'advisor-skew-'));
  execFileSync('git', ['init', '-q', root], { stdio: 'ignore' });
  execFileSync('git', ['-C', root, 'config', 'user.email', 't@t'], { stdio: 'ignore' });
  execFileSync('git', ['-C', root, 'config', 'user.name', 't'], { stdio: 'ignore' });
  fs.writeFileSync(nodePath.join(root, 'f.txt'), 'one\ntwo\n');
  execFileSync('git', ['-C', root, 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', root, 'commit', '-qm', 'seed'], { stdio: 'ignore' });

  const binDir = nodePath.join(root, '.shim-bin');
  fs.mkdirSync(binDir);
  const shimPath = nodePath.join(binDir, 'git-span');
  fs.writeFileSync(shimPath, shim, { mode: 0o755 });

  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}${nodePath.delimiter}${previousPath ?? ''}`;
  return {
    root,
    cleanup: () => {
      process.env.PATH = previousPath;
      rmSync(root, { recursive: true, force: true });
    }
  };
}

/**
 * A binary that rejects the command at the argument parser, reporting
 * `version` for `--version`. This is what both directions of skew look like on
 * the wire: clap writes a usage block and exits 2, naming a subcommand the
 * caller never asked for.
 */
function parseRejectingShim(version: string): string {
  return [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then',
    `  echo "git-span ${version}"`,
    '  exit 0',
    'fi',
    '>&2 echo "error: unexpected argument \'--format\' found"',
    '>&2 echo ""',
    '>&2 echo "Usage: git-span show <NAME>"',
    'exit 2'
  ].join('\n');
}

/**
 * A binary that understands the command and fails while running it — the
 * genuine scan failure the skew must stay distinguishable from. No usage block,
 * because nothing was mis-parsed.
 */
const SCAN_FAILING_SHIM = [
  '#!/bin/sh',
  'if [ "$1" = "--version" ]; then',
  `  echo "git-span ${REQUIRED_GIT_SPAN_VERSION}"`,
  '  exit 0',
  'fi',
  '>&2 echo "error: could not read anchor file \\`f.txt\\`: Permission denied"',
  'exit 1'
].join('\n');

describe('advisor version skew', () => {
  let harness: Harness | null = null;

  beforeEach(() => {
    harness = null;
  });
  afterEach(() => {
    harness?.cleanup();
    harness = null;
  });

  describe('a binary older than the plugin', () => {
    const OLD = '1.0.141';

    it('raises an incompatible-CLI error from the drift executor, not a scan error', async () => {
      harness = makeHarness(parseRejectingShim(OLD));
      const executors = createDefaultAdvisorExecutors();
      await expect(executors.drift(['f.txt'], harness.root)).rejects.toBeInstanceOf(AdvisorIncompatibleCliError);
      await expect(executors.drift(['f.txt'], harness.root)).rejects.toMatchObject({
        installedVersion: OLD
      });
    });

    it('no longer lets the --fix executor swallow it', async () => {
      harness = makeHarness(parseRejectingShim(OLD));
      const executors = createDefaultAdvisorExecutors();
      // The whole point: `fix` returns void and used to `void err` every
      // failure, so auto-reanchoring stopped with nothing to show for it.
      await expect(executors.fix(['f.txt'], harness.root)).rejects.toBeInstanceOf(AdvisorIncompatibleCliError);
    });

    it('resolves to a scan-failed result whose cause and message name the skew', async () => {
      harness = makeHarness(parseRejectingShim(OLD));
      const result = await evaluateAdvisor(['f.txt'], harness.root, createDefaultAdvisorExecutors(), memoryMemoState());
      expect(result).toMatchObject({ decision: 'allow', kind: 'scan-failed' });
      expect(result).toHaveProperty('cause', 'incompatible-cli');
      const reason = (result as { reason: string }).reason;
      expect(reason).toContain(OLD);
      expect(reason).toContain(REQUIRED_GIT_SPAN_VERSION);
      expect(reason).toContain('npm install -g git-span');
      expect(reason).toContain('binary is older than the plugin');
      // The changeset genuinely was not verified, and the message must keep
      // saying so — naming the cause is not the same as downgrading the warning.
      expect(reason).toContain('NOT verified');
      // The CLI's own stderr is a delimited artifact of the message now, not
      // an untagged trailing sentence: the `<git-span-error>` block brackets
      // it — opening tag on its own line, the `git-span reported:` line
      // indented beneath it, closing tag on its own line as the message's
      // final line.
      expect(reason).toContain(
        ['<git-span-error>', "  git-span reported: error: unexpected argument '--format' found"].join('\n')
      );
      expect(reason).toContain(['Usage: git-span show <NAME>', '</git-span-error>'].join('\n'));
      expect(reason.endsWith('</git-span-error>')).toBe(true);
    });
  });

  describe('a binary newer than the plugin', () => {
    // The lagging-plugin direction: the binary has moved on and retired the
    // subcommand the installed bundle still issues.
    const NEW = '1.9.0';

    it('is still classified as skew, and says which side is stale', async () => {
      harness = makeHarness(parseRejectingShim(NEW));
      const result = await evaluateAdvisor(['f.txt'], harness.root, createDefaultAdvisorExecutors(), memoryMemoState());
      expect(result).toHaveProperty('cause', 'incompatible-cli');
      const reason = (result as { reason: string }).reason;
      expect(reason).toContain(NEW);
      expect(reason).toContain('plugin is older than the binary');
    });
  });

  describe('a binary that understood the command and failed anyway', () => {
    it('stays an ordinary scan failure', async () => {
      harness = makeHarness(SCAN_FAILING_SHIM);
      const executors = createDefaultAdvisorExecutors();
      const err = await executors.drift(['f.txt'], harness.root).then(
        () => null,
        (e: unknown) => e
      );
      expect(err).toBeInstanceOf(AdvisorScanError);
      expect(err).not.toBeInstanceOf(AdvisorIncompatibleCliError);
    });

    it('is still swallowed by --fix, whose exit code is not the source of truth', async () => {
      harness = makeHarness(SCAN_FAILING_SHIM);
      const executors = createDefaultAdvisorExecutors();
      // `drift --fix` exits non-zero on drift it healed, so its exit code has
      // never been meaningful; only the parse-level rejection is.
      await expect(executors.fix(['f.txt'], harness.root)).resolves.toBeUndefined();
    });

    it('resolves to scan-failed with the aborted cause', async () => {
      harness = makeHarness(SCAN_FAILING_SHIM);
      const result = await evaluateAdvisor(['f.txt'], harness.root, createDefaultAdvisorExecutors(), memoryMemoState());
      expect(result).toMatchObject({ decision: 'allow', kind: 'scan-failed' });
      expect(result).toHaveProperty('cause', 'aborted');
      const reason = (result as { reason: string }).reason;
      expect(reason).not.toContain('npm install -g git-span');
      expect(reason).toContain('Permission denied');
      // The failed command's stderr rides as a delimited block — opening tag
      // on its own line, the diagnostic indented beneath, closing tag on its
      // own line — matching the `<git-span>` context-block styling.
      expect(reason).toContain(
        [
          '<git-span-error>',
          '  error: could not read anchor file `f.txt`: Permission denied',
          '</git-span-error>'
        ].join('\n')
      );
    });
  });
});

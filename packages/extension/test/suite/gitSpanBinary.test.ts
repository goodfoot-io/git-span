/**
 * Tests for the Git Span CLI spawn helper: PATH resolution plus the
 * cancellation and output-cap hardening of {@link runGitSpanCommand} --
 * pre-aborted refusal, SIGTERM-to-SIGKILL escalation, byte-capped output with
 * truncation metadata, and the internal rejection deadline for children that
 * ignore every kill signal.
 *
 * Kill-signal scenarios are skipped on Windows: its signal model cannot
 * express a child that ignores SIGTERM (kills terminate unconditionally), so
 * the escalation and deadline paths have no observable equivalent there.
 *
 * @summary Git Span CLI PATH resolution and spawn-hardening tests.
 * @module test/suite/gitSpanBinary.test
 */

import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  describeGitSpanOutputTruncation,
  resolveGitSpanBinaryOnPath,
  runGitSpanCommand
} from '../../src/utils/gitSpanBinary.js';

describe('gitSpanBinary', function () {
  // Real child processes plus kill-signal grace periods; keep plain-mocha's
  // 2 s default from clipping the escalation and deadline scenarios.
  this.timeout(15000);

  it('resolves git-span on PATH when present', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-span-path-'));
    try {
      writeFixtureBinary(tempDir);
      const resolved = await resolveGitSpanBinaryOnPath(
        process.platform,
        `${tempDir}${path.delimiter}${process.env['PATH'] ?? ''}`
      );
      assert.ok(resolved, 'Expected Git Span binary to resolve from PATH');
      assert.strictEqual(typeof resolved, 'string');
      assert.ok(resolved.length > 0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('runs a fast child to completion with no truncation flags set', async () => {
    const scriptPath = writeScript('git-span-run-', `process.stdout.write('hello-ok');\n`);
    try {
      const result = await runGitSpanCommand(process.execPath, [scriptPath]);
      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.stdout, 'hello-ok');
      assert.strictEqual(result.stderr, '');
      assert.strictEqual(result.stdoutTruncated, false);
      assert.strictEqual(result.stderrTruncated, false);
      assert.strictEqual(describeGitSpanOutputTruncation(result), '');
    } finally {
      removeScriptDir(scriptPath);
    }
  });

  it('rejects without spawning when the signal is already aborted', async () => {
    const scriptPath = writeScript('git-span-abort-', `process.stdout.write('should never run');\n`);
    try {
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        runGitSpanCommand(process.execPath, [scriptPath], controller.signal),
        /Aborted before spawn/
      );
    } finally {
      removeScriptDir(scriptPath);
    }
  });

  it('caps buffered bytes per stream and carries truncation metadata', async () => {
    const scriptPath = writeScript(
      'git-span-cap-',
      // 3 MiB per stream against a 64 KiB cap: both streams must truncate,
      // keep exactly the leading cap in ASCII bytes, and still report the
      // child's real exit code.
      `const big = 'x'.repeat(1024 * 1024);\nfor (let i = 0; i < 3; i++) {\n  process.stdout.write(big);\n  process.stderr.write(big);\n}\nprocess.exit(3);\n`
    );
    try {
      const result = await runGitSpanCommand(process.execPath, [scriptPath], undefined, undefined, {
        maxOutputBytes: 64 * 1024
      });
      assert.strictEqual(result.exitCode, 3);
      assert.strictEqual(result.stdout.length, 64 * 1024, 'stdout keeps exactly the capped leading bytes');
      assert.match(result.stdout, /^x+$/);
      assert.strictEqual(result.stderr.length, 64 * 1024, 'stderr keeps exactly the capped leading bytes');
      assert.strictEqual(result.stdoutTruncated, true);
      assert.strictEqual(result.stderrTruncated, true);
      assert.strictEqual(describeGitSpanOutputTruncation(result), ' (output truncated: stdout, stderr)');
    } finally {
      removeScriptDir(scriptPath);
    }
  });

  it('escalates to SIGKILL when a child ignores SIGTERM after abort', async function () {
    if (process.platform === 'win32') {
      this.skip();
    }
    const scriptPath = writeScript(
      'git-span-escalate-',
      `process.on('SIGTERM', () => {});\nsetInterval(() => {}, 250);\n`
    );
    try {
      const controller = new AbortController();
      // The deadline must not be what ends this: with it set far out of
      // reach, only the abort-driven SIGKILL escalation can settle the
      // promise while the child ignores SIGTERM.
      const startedAt = Date.now();
      const settled = runGitSpanCommand(process.execPath, [scriptPath], controller.signal, undefined, {
        killGraceMs: 300,
        deadlineMs: 60000
      });
      await delay(150);
      controller.abort();
      const result = await settled;
      const elapsedMs = Date.now() - startedAt;
      assert.strictEqual(result.exitCode, 1, 'a signal-killed child reports the null-code exit as 1');
      assert.ok(elapsedMs < 20000, `SIGTERM-immune child must die via SIGKILL promptly, took ${elapsedMs}ms`);
      await assertNoSurvivingScript(scriptPath);
    } finally {
      removeScriptDir(scriptPath);
    }
  });

  it('rejects within the internal deadline for a child that survives everything', async function () {
    if (process.platform === 'win32') {
      this.skip();
    }
    const scriptPath = writeScript(
      'git-span-deadline-',
      `process.on('SIGTERM', () => {});\nsetInterval(() => {}, 250);\n`
    );
    try {
      const startedAt = Date.now();
      const settled = runGitSpanCommand(process.execPath, [scriptPath], undefined, undefined, { deadlineMs: 800 });
      await assert.rejects(settled, /did not exit within 800ms and was killed/);
      const elapsedMs = Date.now() - startedAt;
      assert.ok(elapsedMs < 10000, `deadline must bound the wait tightly, took ${elapsedMs}ms`);
      await assertNoSurvivingScript(scriptPath);
    } finally {
      removeScriptDir(scriptPath);
    }
  });
});

/**
 * Write a Node script fixture into a fresh temp directory, to run as
 * `<node> <script>`; the parent never passes signals semantics the script
 * does not implement.
 *
 * @param prefix - mkdtemp prefix; also names the script inside.
 * @param body - Script source.
 * @returns Absolute path to the written script.
 */
function writeScript(prefix: string, body: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const scriptPath = path.join(directory, `${prefix.replace(/-$/, '')}.js`);
  fs.writeFileSync(scriptPath, body);
  return scriptPath;
}

/**
 * Remove the temp directory holding a fixture script.
 *
 * @param scriptPath - Absolute path returned by {@linkcode writeScript}.
 * @returns Nothing.
 */
function removeScriptDir(scriptPath: string): void {
  fs.rmSync(path.dirname(scriptPath), { recursive: true, force: true });
}

/**
 * Resolve after a macrotask delay.
 *
 * @param ms - Milliseconds to wait.
 * @returns Promise resolving once the delay elapses.
 */
function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Assert a fixture script has no surviving OS process: any process whose
 * command line still names the script means a kill path leaked a child.
 *
 * Polls briefly so a just-delivered SIGKILL's asynchronous reap cannot race
 * the check. Best-effort by design -- where `pgrep` is unavailable (non-Linux
 * CI images) the leak cannot be observed here, but the settlement-time
 * assertions above still bound every kill path.
 *
 * @param scriptPath - Fixture script the child was spawned with.
 * @returns Promise resolving once no surviving process is observed.
 * @throws Assertion error listing any surviving process command lines.
 */
async function assertNoSurvivingScript(scriptPath: string): Promise<void> {
  if (process.platform !== 'linux') {
    return;
  }
  const deadline = Date.now() + 2000;
  let lastListing = '';
  while (Date.now() < deadline) {
    try {
      lastListing = execFileSync('pgrep', ['-af', scriptPath], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
    } catch {
      // Non-zero pgrep exit means no match: exactly what we want.
      return;
    }
    await delay(100);
  }
  assert.deepStrictEqual(lastListing.trim(), '', 'fixture children must not survive their parent test');
}

/**
 * Legacy PATH-resolution fixture binary writer.
 *
 * @param directory - Directory to place the binary in.
 * @param fileName - Output file name, defaulting per platform to the
 *   extensioned form a Windows PATHEXT lookup requires.
 * @returns Absolute path to the written binary.
 */
function writeFixtureBinary(
  directory: string,
  fileName = process.platform === 'win32' ? 'git-span.cmd' : 'git-span'
): string {
  const scriptPath = path.join(directory, fileName);

  if (process.platform === 'win32') {
    fs.writeFileSync(
      scriptPath,
      "@echo off\r\nnode -e \"const args=process.argv.slice(1);if(args[0]==='list'){process.stdout.write('[]');process.exit(0)}process.stdout.write('[]');\"\r\n"
    );
    return scriptPath;
  }

  fs.writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'list') {
  process.stdout.write('[]');
  process.exit(0);
}
process.stdout.write('[]');
`,
    { mode: 0o755 }
  );
  return scriptPath;
}

/**
 * Git Span CLI binary resolution and process-spawning helpers.
 *
 * Resolves `git-span` from PATH and captures command output. No managed
 * install, download, or checksum verification -- the binary must be
 * installed independently (npm, Homebrew, or direct download).
 *
 * @summary Git Span CLI PATH resolution and process helpers.
 */

import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import * as path from 'node:path';

export interface GitSpanCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** True when stdout hit the byte cap and only its leading bytes were kept. */
  stdoutTruncated: boolean;
  /** True when stderr hit the byte cap and only its leading bytes were kept. */
  stderrTruncated: boolean;
}

/**
 * Tunables for {@linkcode runGitSpanCommand}. Every field is optional; the
 * defaults are sized against the render session's caller-side timeout
 * (`SPAN_RENDER_TIMEOUT_MS`, 10 s) so abort-driven cancellation always
 * settles first and the deadline is a backstop, never the primary path.
 */
export interface GitSpanCommandOptions {
  /**
   * Milliseconds to wait after the aborting SIGTERM before escalating to
   * SIGKILL.
   */
  killGraceMs?: number;
  /**
   * Internal wall-clock rejection deadline, in milliseconds from spawn, for a
   * child (or its pipe-holding descendants) that outlives both SIGTERM and
   * SIGKILL settlement. Should exceed the caller's own timeout slightly --
   * the default clears the render session's 10 s budget plus the SIGKILL
   * escalation grace with margin.
   */
  deadlineMs?: number;
  /** Maximum bytes buffered per output stream before truncation. */
  maxOutputBytes?: number;
}

/** Default per-stream cap on buffered command output: 10 MiB. */
const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

/** Default SIGTERM-to-SIGKILL escalation grace on abort: 2 s. */
const DEFAULT_KILL_GRACE_MS = 2000;

/** Default internal rejection deadline for one spawned command: 15 s. */
const DEFAULT_DEADLINE_MS = 15000;

/**
 * Byte-bounded accumulator for one child stdio stream.
 *
 * Chunks arrive as Buffers and are capped at the byte level as they land:
 * past the cap, incoming bytes are counted and dropped instead of retained,
 * so a chatty child cannot exhaust memory via string concatenation. The kept
 * bytes are decoded once at close; a chunk boundary may split a multi-byte
 * UTF-8 sequence, which decodes as U+FFFD at that point -- acceptable for
 * diagnostic output.
 */
class CappedStreamBuffer {
  private readonly chunks: Buffer[] = [];

  private keptBytes = 0;

  private totalBytes = 0;

  constructor(private readonly maxBytes: number) {}

  /**
   * Buffer one raw chunk, keeping at most the remaining cap in bytes.
   *
   * @param chunk - Raw bytes emitted by the stream.
   * @returns Nothing.
   */
  push(chunk: Buffer): void {
    this.totalBytes += chunk.length;
    const room = this.maxBytes - this.keptBytes;
    if (room <= 0) {
      return;
    }
    if (chunk.length > room) {
      this.chunks.push(chunk.subarray(0, room));
      this.keptBytes = this.maxBytes;
      return;
    }
    this.chunks.push(chunk);
    this.keptBytes += chunk.length;
  }

  /**
   * Whether any byte was received beyond the cap.
   *
   * @returns True when at least one byte was counted then dropped.
   */
  get truncated(): boolean {
    return this.totalBytes > this.keptBytes;
  }

  /**
   * Decode everything kept, once, at close.
   *
   * @returns The retained leading bytes of the stream as UTF-8 text.
   */
  text(): string {
    return Buffer.concat(this.chunks).toString('utf-8');
  }
}

export class GitSpanBinaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitSpanBinaryError';
  }
}

/**
 * Normalize an unknown binary-resolution failure into a user-facing message.
 *
 * @param error - Error thrown while resolving or installing the binary.
 * @returns Human-readable error message.
 */
export function getGitSpanBinaryErrorMessage(error: unknown): string {
  if (error instanceof GitSpanBinaryError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Locate a Git Span binary on PATH.
 *
 * @param platform - Host platform used for executable name resolution.
 * @param envPath - PATH value to search.
 * @returns Absolute path to the binary when present, otherwise null.
 */
export async function resolveGitSpanBinaryOnPath(
  platform: NodeJS.Platform = process.platform,
  envPath: string = process.env['PATH'] ?? ''
): Promise<string | null> {
  return findExecutableOnPath(platform === 'win32' ? 'git-span.exe' : 'git-span', platform, envPath);
}

/**
 * Describe which captured streams a byte cap truncated, for appending to
 * error messages built from a command result.
 *
 * @param result - Command result (or its truncation flags) to describe.
 * @returns `''` when nothing was truncated, otherwise e.g.
 *   `' (output truncated: stdout, stderr)'`.
 */
export function describeGitSpanOutputTruncation(
  result: Pick<GitSpanCommandResult, 'stdoutTruncated' | 'stderrTruncated'>
): string {
  const streams = [result.stdoutTruncated ? 'stdout' : undefined, result.stderrTruncated ? 'stderr' : undefined].filter(
    (stream) => stream !== undefined
  );
  return streams.length > 0 ? ` (output truncated: ${streams.join(', ')})` : '';
}

/**
 * Spawn an executable by absolute path and capture its output.
 *
 * Named for its original and primary caller, the Git Span CLI, but the
 * implementation is binary-agnostic: it is also the single spawn path used to
 * invoke `git` directly (see {@link ../spanViewer/spanTimestamp.js}), so the
 * package never grows a second way to shell out.
 *
 * Cancellation is layered so no child can wedge the caller:
 *
 * - An already-aborted signal refuses to spawn (see below).
 * - Abort sends SIGTERM once, then escalates to SIGKILL after
 *   {@link GitSpanCommandOptions.killGraceMs} if the child is still running.
 * - An internal deadline ({@link GitSpanCommandOptions.deadlineMs}) rejects
 *   even when a SIGTERM-immune child or its pipe-holding descendants keep
 *   stdio open -- the promise never pends past the caller's own timeout.
 *
 * stdout/stderr are buffered byte-capped per stream; past the cap extra bytes
 * are dropped and reported via the result's truncation flags, which callers
 * should carry into error messages via
 * {@linkcode describeGitSpanOutputTruncation}.
 *
 * @param binaryPath - Absolute path to the executable to spawn.
 * @param args - CLI arguments to pass through.
 * @param signal - Optional AbortSignal to cancel the running process.
 * @param cwd - Optional working directory for the git-span process.
 * @param options - Optional caps and deadlines overriding the defaults.
 * @returns Command stdout, stderr, exit code, and per-stream truncation flags.
 */
export function runGitSpanCommand(
  binaryPath: string,
  args: string[],
  signal?: AbortSignal,
  cwd?: string,
  options?: GitSpanCommandOptions
): Promise<GitSpanCommandResult> {
  const killGraceMs = options?.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const deadlineMs = options?.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const maxOutputBytes = options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return new Promise((resolve, reject) => {
    // An already-aborted signal can never deliver its 'abort' event to a
    // listener registered below, so the child would run to completion with no
    // way to cancel it. Refuse to spawn instead of leaking the process.
    if (signal?.aborted) {
      reject(new Error('Aborted before spawn'));
      return;
    }

    const stdoutBuffer = new CappedStreamBuffer(maxOutputBytes);
    const stderrBuffer = new CappedStreamBuffer(maxOutputBytes);

    const child = spawn(binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd });

    let settled = false;
    let killGraceTimer: ReturnType<typeof setTimeout> | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

    const forceKill = (): void => {
      child.kill('SIGKILL');
      // Release our pipe ends: descendants that inherited them could
      // otherwise hold stdio open (and 'close' pending) indefinitely.
      child.stdout.destroy();
      child.stderr.destroy();
    };

    const onAbort = (): void => {
      // False means the child already exited and no signal was delivered;
      // there is nothing left to escalate for this abort.
      if (settled || !child.kill('SIGTERM')) {
        return;
      }
      killGraceTimer = setTimeout(() => {
        if (!settled) {
          forceKill();
        }
      }, killGraceMs);
    };

    const cleanup = (): void => {
      settled = true;
      if (deadlineTimer !== undefined) {
        clearTimeout(deadlineTimer);
      }
      if (killGraceTimer !== undefined) {
        clearTimeout(killGraceTimer);
      }
      signal?.removeEventListener('abort', onAbort);
    };

    child.stdout.on('data', (chunk: Buffer) => stdoutBuffer.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrBuffer.push(chunk));

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      cleanup();
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }
      cleanup();
      resolve({
        stdout: stdoutBuffer.text(),
        stderr: stderrBuffer.text(),
        exitCode: code ?? 1,
        stdoutTruncated: stdoutBuffer.truncated,
        stderrTruncated: stderrBuffer.truncated
      });
    });

    // Backstop deadline: a SIGTERM-immune child -- or grandchildren that
    // inherited our pipes and keep 'close' from firing -- must not leave the
    // caller's promise pending past its own clearTimeout-based budget. Fail
    // closed with whatever output was captured by then.
    deadlineTimer = setTimeout(() => {
      if (settled) {
        return;
      }
      cleanup();
      forceKill();
      reject(
        new Error(
          `child process did not exit within ${deadlineMs}ms and was killed` +
            describeTruncationFlags(stdoutBuffer.truncated, stderrBuffer.truncated)
        )
      );
    }, deadlineMs);

    if (signal != null) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Shared message suffix naming which streams were truncated.
 *
 * @param stdoutTruncated - Whether the stdout buffer hit its cap.
 * @param stderrTruncated - Whether the stderr buffer hit its cap.
 * @returns `''`, or `' (output truncated: ...)'`.
 */
function describeTruncationFlags(stdoutTruncated: boolean, stderrTruncated: boolean): string {
  return describeGitSpanOutputTruncation({ stdoutTruncated, stderrTruncated });
}

async function findExecutableOnPath(
  executableName: string,
  platform: NodeJS.Platform,
  envPath: string
): Promise<string | null> {
  const directories = envPath
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const windowsExts = (process.env['PATHEXT'] ?? '.EXE;.CMD;.BAT;.COM').split(';').map((entry) => entry.toLowerCase());

  for (const directory of directories) {
    if (platform === 'win32') {
      const base = executableName.endsWith('.exe') ? executableName.slice(0, -4) : executableName;
      for (const extension of windowsExts) {
        const candidate = path.join(directory, `${base}${extension}`);
        try {
          await access(candidate, constants.F_OK);
          return candidate;
        } catch {
          // Continue searching.
          void 0;
        }
      }
      continue;
    }

    const candidate = path.join(directory, executableName);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching.
      void 0;
    }
  }

  return null;
}

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
 * Spawn the resolved Git Span CLI by absolute path and capture its output.
 *
 * @param binaryPath - Absolute path to the git-span executable.
 * @param args - CLI arguments to pass through.
 * @param signal - Optional AbortSignal to cancel the running process.
 * @param cwd - Optional working directory for the git-span process.
 * @returns Command stdout, stderr, and exit code.
 */
export function runGitSpanCommand(
  binaryPath: string,
  args: string[],
  signal?: AbortSignal,
  cwd?: string
): Promise<GitSpanCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    if (signal != null) {
      const onAbort = () => child.kill();
      signal.addEventListener('abort', onAbort, { once: true });
      child.on('close', () => signal.removeEventListener('abort', onAbort));
    }
  });
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

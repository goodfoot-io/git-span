/** Actual Git and notes subprocess adapters, with bounded metadata/evidence reads. */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync
} from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { CommitRepository, CommitValidation } from './commit-contracts.js';
import type { CommitReflogAppend, CommitReflogCheckpoint } from './commit-git.js';
import type { CommitNotesCommand, CommitNotesResult } from './commit-io.js';

export function executableOnPath(name: string): string {
  const candidates = isAbsolute(name)
    ? [name]
    : (process.env.PATH ?? '')
        .split(delimiter)
        .filter(Boolean)
        .map((directory) => resolve(directory, name));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      if (lstatSync(candidate).isFile() || lstatSync(candidate).isSymbolicLink()) return realpathSync(candidate);
    } catch {
      /* Try the next executable candidate. */
    }
  }
  throw new Error(`${name} executable is unavailable`);
}
function probe(executable: string, argv: readonly string[], cwd: string): string {
  const result = spawnSync(executable, [...argv], {
    cwd,
    encoding: 'utf8',
    timeout: 1000,
    maxBuffer: 65536,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.error || result.status !== 0) throw new Error('Git repository probe failed');
  return result.stdout.trimEnd();
}
export function resolveCommitRepository(
  executable: string,
  globalArguments: readonly string[],
  originalCwd: string
): CommitRepository {
  const fields = probe(
    executable,
    [
      ...globalArguments,
      'rev-parse',
      '--path-format=absolute',
      '--git-dir',
      '--git-common-dir',
      '--show-object-format'
    ],
    originalCwd
  ).split('\n');
  const [gitDirectoryField, commonDirectoryField, objectFormat, ...extraFields] = fields;
  if (
    gitDirectoryField === undefined ||
    commonDirectoryField === undefined ||
    extraFields.length > 0 ||
    (objectFormat !== 'sha1' && objectFormat !== 'sha256')
  )
    throw new Error('unsupported Git repository format');
  const cwd = realpathSync(probe(executable, [...globalArguments, 'rev-parse', '--show-toplevel'], originalCwd));
  const gitDirectory = realpathSync(gitDirectoryField);
  const commonDirectory = realpathSync(commonDirectoryField);
  if (gitRefBackend(executable, globalArguments, originalCwd) !== 'files')
    throw new Error('unsupported Git ref backend');
  return {
    cwd,
    gitDirectory,
    commonDirectory,
    headReflog: join(gitDirectory, 'logs', 'HEAD'),
    objectFormat
  };
}
/** Missing extensions.refStorage means the established files backend. */
export function gitRefBackend(executable: string, globalArguments: readonly string[], cwd: string): string {
  const result = spawnSync(executable, [...globalArguments, 'config', '--get', 'extensions.refStorage'], {
    cwd,
    encoding: 'utf8',
    timeout: 1000,
    maxBuffer: 4096
  });
  if (result.error || (result.status !== 0 && result.status !== 1)) throw new Error('Git ref backend probe failed');
  return result.status === 1 ? 'files' : result.stdout.trim();
}
/** Fingerprint the bounded tail of the old prefix so truncate-and-regrow cannot masquerade as append. */
function prefixDigest(descriptor: number, length: number): string {
  const bytes = Buffer.alloc(Math.min(length, 4096));
  let offset = 0;
  while (offset < bytes.length) {
    const count = readSync(descriptor, bytes, offset, bytes.length - offset, length - bytes.length + offset);
    if (count === 0) throw new Error('reflog prefix truncated');
    offset += count;
  }
  return createHash('sha256').update(bytes).digest('hex');
}
export function checkpointCommitReflog(path: string): CommitReflogCheckpoint {
  if (!existsSync(path)) return { existed: false, offset: 0 };
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw new Error('unsupported HEAD reflog');
    return {
      existed: true,
      device: String(stat.dev),
      inode: String(stat.ino),
      offset: stat.size,
      prefixDigest: prefixDigest(descriptor, stat.size)
    };
  } finally {
    closeSync(descriptor);
  }
}
export function readCommitReflogAppend(
  path: string,
  checkpoint: CommitReflogCheckpoint,
  maxBytes: number
): CommitReflogAppend | null {
  if (!existsSync(path)) return null;
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw new Error('HEAD reflog is not a file');
    if (checkpoint.existed && prefixDigest(descriptor, checkpoint.offset) !== checkpoint.prefixDigest)
      throw new Error('observed reflog prefix changed');
    const length = stat.size - checkpoint.offset;
    const exceededBudget = length > maxBytes;
    const bytes = Buffer.alloc(Math.max(0, Math.min(length, maxBytes)));
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, checkpoint.offset + offset);
      if (count === 0) break;
      offset += count;
    }
    return {
      device: String(stat.dev),
      inode: String(stat.ino),
      fileSize: stat.size,
      bytes: bytes.subarray(0, offset),
      exceededBudget
    };
  } finally {
    closeSync(descriptor);
  }
}
export function verifyCommitObject(
  executable: string,
  repository: CommitRepository,
  sha: string
): CommitValidation<string> {
  try {
    const format = probe(
      executable,
      ['--git-dir', repository.gitDirectory, 'rev-parse', '--show-object-format'],
      repository.commonDirectory
    );
    const type = probe(
      executable,
      ['--git-dir', repository.gitDirectory, 'cat-file', '-t', sha],
      repository.commonDirectory
    );
    return format === repository.objectFormat && type === 'commit'
      ? { ok: true, value: sha }
      : { ok: false, reason: 'witness is not a commit object in the actual object format' };
  } catch {
    return { ok: false, reason: 'commit object verification failed' };
  }
}
export async function executeCommitNotes(executable: string, command: CommitNotesCommand): Promise<CommitNotesResult> {
  return new Promise((resolveResult) => {
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let timedOut = false;
    let outputExceeded = false;
    let finished = false;
    const grouped = process.platform !== 'win32';
    const child = spawn(executable, [...command.argv], {
      cwd: command.cwd,
      detached: grouped,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const finish = (exitCode: number | null, signal: string | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      resolveResult({ exitCode, signal, stdout, stderr, timedOut, outputExceeded });
    };
    const terminate = () => {
      try {
        if (grouped && child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        /* The owned group may have already exited. */
      }
      finish(null, 'SIGKILL');
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, command.timeoutMs);
    const append = (kind: 'stdout' | 'stderr', chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > command.maxOutputBytes) {
        outputExceeded = true;
        terminate();
        return;
      }
      if (kind === 'stdout') stdout += stdoutDecoder.write(chunk);
      else stderr += stderrDecoder.write(chunk);
    };
    child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));
    child.stdin.on('error', () => {
      /* Early CLI termination is reported by its exit status. */
    });
    child.stdin.end(command.stdin ?? '');
    child.once('error', () => finish(127, null));
    child.once('close', (exitCode, signal) => finish(exitCode, signal));
  });
}

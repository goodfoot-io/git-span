/** Private atomic receipt storage and serialized ownership recovery. */
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  opendirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { CommitPostIdentity } from './commit-contracts.js';
import {
  COMMIT_RECEIPT_LIMITS,
  type CommitClaimOwner,
  type CommitOwnerLiveness,
  decideCommitClaim
} from './commit-lifecycle.js';

export function identityKey(identity: CommitPostIdentity): string {
  return createHash('sha256')
    .update(JSON.stringify([identity.host, identity.sessionId, identity.toolUseId]))
    .digest('hex');
}
export function privateDirectory(path: string): void {
  if (!isAbsolute(path)) throw new Error('receipt state root must be absolute');
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    (process.getuid && stat.uid !== process.getuid())
  ) {
    throw new Error('receipt directory is not private');
  }
}
export function readJson(path: string, maximumBytes = 1_048_576): unknown {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumBytes)
    throw new Error('invalid bounded receipt file');
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}
export function atomicJson(path: string, value: unknown, immutable = false): void {
  const temporary = join(dirname(path), `.publish-${randomBytes(16).toString('hex')}`);
  try {
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    if (immutable) linkSync(temporary, path);
    else renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
export function boundedEntries(directory: string, cap: number, deadline = Infinity): string[] {
  if (!existsSync(directory)) return [];
  const stream = opendirSync(directory);
  const names: string[] = [];
  try {
    for (;;) {
      if (performance.now() >= deadline) throw new Error('receipt phase deadline exhausted');
      const entry = stream.readSync();
      if (!entry) break;
      if (names.length >= cap) throw new Error('receipt entry count exceeds budget');
      names.push(entry.name);
    }
  } finally {
    stream.closeSync();
  }
  return names;
}
export function ownerLiveness(owner: CommitClaimOwner): CommitOwnerLiveness {
  try {
    process.kill(owner.pid, 0);
    return 'alive';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'dead' : 'uncertain';
  }
}
function ownerRecord(value: unknown): CommitClaimOwner | null {
  if (typeof value !== 'object' || value === null) return null;
  const owner = value as Partial<CommitClaimOwner>;
  return typeof owner.token === 'string' &&
    /^[a-zA-Z0-9_-]{1,256}$/.test(owner.token) &&
    typeof owner.pid === 'number' &&
    Number.isSafeInteger(owner.pid) &&
    owner.pid > 0
    ? (owner as CommitClaimOwner)
    : null;
}
export interface ReceiptClaim {
  readonly owner: CommitClaimOwner;
  release(): void;
}

/** A short guard serializes every primary claim mutation. A crashed/uncertain guard fails closed. */
export async function acquireReceiptClaim(root: string, key: string, deadline: number): Promise<ReceiptClaim | null> {
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error('invalid receipt claim key');
  const directory = join(root, 'claims');
  privateDirectory(directory);
  const path = join(directory, `${key}.json`);
  const guard = join(directory, `${key}.guard`);
  const owner: CommitClaimOwner = { token: randomBytes(16).toString('hex'), pid: process.pid };
  while (performance.now() < deadline) {
    let guarded = false;
    try {
      try {
        mkdirSync(guard, { mode: 0o700 });
        guarded = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        return null;
      }
      let prior: CommitClaimOwner | null = null;
      if (existsSync(path)) {
        prior = ownerRecord(readJson(path, 4096));
        if (prior === null) return null;
      }
      const decision = decideCommitClaim(
        prior,
        prior === null ? 'uncertain' : ownerLiveness(prior),
        deadline - performance.now()
      );
      if (decision === 'acquire' || decision === 'recover') {
        if (prior !== null) unlinkSync(path);
        atomicJson(path, owner, true);
        return {
          owner,
          release: () => {
            let releaseGuard = false;
            try {
              mkdirSync(guard, { mode: 0o700 });
              releaseGuard = true;
              const current = ownerRecord(readJson(path, 4096));
              if (current?.token !== owner.token || current.pid !== owner.pid)
                throw new Error('receipt claim ownership changed');
              unlinkSync(path);
            } finally {
              if (releaseGuard) rmSync(guard, { recursive: true });
            }
          }
        };
      }
      if (decision === 'refuse') return null;
    } finally {
      if (guarded) rmSync(guard, { recursive: true });
    }
    await delay(Math.min(20, Math.max(0, deadline - performance.now())));
  }
  return null;
}

interface Usage {
  invocations: number;
  totalBytes: number;
}
export async function reserveReceiptCapacity(
  root: string,
  invocationDelta: number,
  byteDelta: number,
  deadline: number
): Promise<boolean> {
  const claim = await acquireReceiptClaim(root, 'capacity', deadline);
  if (!claim) return false;
  try {
    const path = join(root, 'usage.json');
    let usage: Usage = { invocations: 0, totalBytes: 0 };
    if (existsSync(path)) usage = readJson(path, 4096) as Usage;
    if (
      !Number.isSafeInteger(usage.invocations) ||
      !Number.isSafeInteger(usage.totalBytes) ||
      usage.invocations < 0 ||
      usage.totalBytes < 0
    )
      return false;
    const next = { invocations: usage.invocations + invocationDelta, totalBytes: usage.totalBytes + byteDelta };
    if (
      next.invocations < 0 ||
      next.invocations > COMMIT_RECEIPT_LIMITS.invocations ||
      next.totalBytes < 0 ||
      next.totalBytes > COMMIT_RECEIPT_LIMITS.totalBytes
    )
      return false;
    atomicJson(path, next);
    return true;
  } finally {
    claim.release();
  }
}

/** Fail-closed file creation also checks the current user's ownership on existing state. */
export function privateEmptyFile(path: string): void {
  const descriptor = openSync(path, 'wx', 0o600);
  closeSync(descriptor);
}

export function appendReceiptDiagnostic(directory: string, message: string): void {
  const path = join(directory, 'diagnostics.json');
  try {
    const prior = existsSync(path) ? readJson(path, 16384) : [];
    if (!Array.isArray(prior) || prior.length >= 16) return;
    const bounded = message.slice(0, 512);
    if (!prior.includes(bounded)) atomicJson(path, [...prior, bounded]);
  } catch {
    /* Evidence diagnostics cannot alter the user's Git outcome. */
  }
}

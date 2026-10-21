/** Private atomic receipt storage and serialized ownership recovery. */
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
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
import { errnoCode, isRecord } from './guards.js';
import { acquireNativeReceiptLock } from './receipt-lock.js';

export function identityKey(identity: CommitPostIdentity): string {
  return createHash('sha256')
    .update(JSON.stringify([identity.host, identity.sessionId, identity.toolUseId]))
    .digest('hex');
}
export async function privateDirectory(path: string, deadline: number): Promise<void> {
  if (!isAbsolute(path)) throw new Error('receipt state root must be absolute');
  if (performance.now() >= deadline) throw new Error('receipt directory phase deadline exhausted');
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const owner = process.getuid?.();
  const descriptor =
    owner === undefined ? undefined : openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    for (;;) {
      const stat = descriptor === undefined ? lstatSync(path) : fstatSync(descriptor);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
        throw new Error('receipt directory is not private');
      if (owner === undefined || stat.uid === owner) return;
      // Directory-entry publication on virtiofs can temporarily misreport uid 0.
      // Keep checking this retained inode; only the exact owner ever authorizes it.
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw new Error('receipt directory ownership unavailable within phase deadline');
      await delay(Math.min(5, remaining));
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
export function readJson(path: string, maximumBytes: number = COMMIT_RECEIPT_LIMITS.jsonFileBytes): unknown {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumBytes)
    throw new Error('invalid bounded receipt file');
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return parsed;
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
    return errnoCode(error) === 'ESRCH' ? 'dead' : 'uncertain';
  }
}
function ownerRecord(value: unknown): CommitClaimOwner | null {
  if (!isRecord(value)) return null;
  const { token, pid } = value;
  return typeof token === 'string' &&
    /^[a-zA-Z0-9_-]{1,256}$/.test(token) &&
    typeof pid === 'number' &&
    Number.isSafeInteger(pid) &&
    pid > 0
    ? { token, pid }
    : null;
}
export interface ReceiptClaim {
  readonly owner: CommitClaimOwner;
  release(): Promise<void>;
}

/**
 * Hold a crash-released OS mutex across the entire claim; ownerless guards are unused.
 * Native lock stripes have separate roles: invocation -> association.
 * Never acquire nested invocation/association claims or nested generic fixture claims.
 */
export async function acquireReceiptClaim(
  root: string,
  key: string,
  deadline: number,
  executable?: string
): Promise<ReceiptClaim | null> {
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error('invalid receipt claim key');
  const directory = join(root, 'claims');
  await privateDirectory(directory, deadline);
  const path = join(directory, `${key}.json`);
  const owner: CommitClaimOwner = { token: randomBytes(16).toString('hex'), pid: process.pid };
  while (performance.now() < deadline) {
    const lock = await acquireNativeReceiptLock(directory, key, deadline, executable);
    let retained = false;
    try {
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
        retained = true;
        return {
          owner,
          release: async () => {
            try {
              const current = ownerRecord(readJson(path, 4096));
              if (current?.token !== owner.token || current.pid !== owner.pid)
                throw new Error('receipt claim ownership changed');
              unlinkSync(path);
            } finally {
              await lock.release();
            }
          }
        };
      }
      if (decision === 'refuse') return null;
    } finally {
      if (!retained) await lock.release();
    }
    await delay(Math.min(20, Math.max(0, deadline - performance.now())));
  }
  return null;
}

/** Fail-closed file creation also checks the current user's ownership on existing state. */

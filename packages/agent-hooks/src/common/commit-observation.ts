/** Reflog observation records a superset of commits made during a tool invocation. */
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { CommitEnrollment, CommitReceipt, CommitRepository } from './commit-contracts.js';
import { validateCommitReceipt } from './commit-contracts.js';
import { type CommitReflogCheckpoint, parseCommitGitInvocation } from './commit-git.js';
import { COMMIT_RECEIPT_LIMITS } from './commit-limits.js';
import { checkpointCommitReflog, readCommitReflogAppend, resolveCommitRepository } from './commit-native-io.js';
import { isRecord } from './guards.js';
import { argvOf, splitTopLevel, stripWrappers } from './shell-split.js';

export interface CommitObservation {
  readonly repository: CommitRepository;
  readonly checkpoint: CommitReflogCheckpoint;
}

/** Observe the invocation cwd and statically visible cd/Git targets, without executing shell text. */
export function checkpointCommitInvocation(enrollment: CommitEnrollment, deadline: number): CommitObservation[] {
  const observations = new Map<string, CommitObservation>();
  const add = (cwd: string, args: readonly string[]) => {
    if (performance.now() >= deadline) throw new Error('repository observation deadline exhausted');
    let repository: CommitRepository;
    try {
      repository = resolveCommitRepository(enrollment.gitExecutable, args, cwd);
    } catch {
      // A shell tool may run outside a repository; only resolvable repositories are observed.
      return;
    }
    if (observations.has(repository.headReflog)) return;
    if (observations.size >= 32) throw new Error('repository observation count exceeds budget');
    observations.set(repository.headReflog, { repository, checkpoint: checkpointCommitReflog(repository.headReflog) });
  };
  let cwd = enrollment.cwd;
  add(cwd, []);
  for (const stage of splitTopLevel(enrollment.originalCommand).stages) {
    const args = stripWrappers(argvOf(stage.text) ?? []);
    const executable = args[0]?.split('/').at(-1);
    if (executable === 'cd' && args.length === 2 && args[1] && !/[`$~*?]/.test(args[1])) {
      cwd = resolve(cwd, args[1]);
      add(cwd, []);
    } else if (executable === 'git') {
      const parsed = parseCommitGitInvocation(args.slice(1), cwd);
      if (parsed.ok && !parsed.value.globalArguments.some((arg) => /[`$~*?]/.test(arg))) {
        add(cwd, parsed.value.globalArguments);
      }
    }
  }
  return [...observations.values()];
}

/** Decode bounded persisted checkpoints; no later tool input is used to select repositories. */
export function readCommitObservations(value: unknown, enrollment: CommitEnrollment): CommitObservation[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error('invalid commit observations');
  return value.map((item) => {
    if (!isRecord(item) || !isRecord(item.checkpoint)) throw new Error('invalid commit observation');
    const receipt = validateCommitReceipt(
      {
        schemaVersion: 1,
        invocationKey: enrollment.invocationKey,
        nonce: 'observation',
        sha: 'a'.repeat(isRecord(item.repository) && item.repository.objectFormat === 'sha256' ? 64 : 40),
        repository: item.repository
      },
      enrollment
    );
    const point = item.checkpoint;
    if (!receipt.ok || !Number.isSafeInteger(point.offset) || (point.offset as number) < 0)
      throw new Error('invalid commit observation checkpoint');
    let checkpoint: CommitReflogCheckpoint;
    if (point.existed === false && point.offset === 0) checkpoint = { existed: false, offset: 0 };
    else if (
      point.existed === true &&
      typeof point.device === 'string' &&
      typeof point.inode === 'string' &&
      typeof point.prefixDigest === 'string' &&
      /^[a-f0-9]{64}$/.test(point.prefixDigest)
    )
      checkpoint = {
        existed: true,
        device: point.device,
        inode: point.inode,
        offset: point.offset as number,
        prefixDigest: point.prefixDigest
      };
    else throw new Error('invalid commit observation identity');
    return { repository: receipt.value.repository, checkpoint };
  });
}

/** Include every appended commit entry, including ambiguous entries from overlapping invocations. */
export function observedCommitReceipts(observation: CommitObservation, enrollment: CommitEnrollment): CommitReceipt[] {
  const { repository, checkpoint } = observation;
  const append = readCommitReflogAppend(repository.headReflog, checkpoint, COMMIT_RECEIPT_LIMITS.reflogBytes);
  if (append === null) {
    if (checkpoint.existed) throw new Error('observed reflog disappeared');
    return [];
  }
  if (checkpoint.existed && (checkpoint.device !== append.device || checkpoint.inode !== append.inode))
    throw new Error('observed reflog replaced');
  if (append.exceededBudget) throw new Error('reflog evidence exceeds budget');
  if (append.fileSize < checkpoint.offset || append.fileSize - checkpoint.offset !== append.bytes.byteLength)
    throw new Error('observed reflog truncated or incomplete read');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(append.bytes);
  if (text === '') return [];
  if (!text.endsWith('\n')) throw new Error('incomplete observed reflog');
  const length = repository.objectFormat === 'sha1' ? 40 : 64;
  const record = new RegExp(`^([0-9a-f]{${length}}) ([0-9a-f]{${length}}) .+ <[^>]*> [0-9]+ [+-][0-9]{4}\\t(.+)$`);
  const commits = new Set<string>();
  for (const line of text.slice(0, -1).split('\n')) {
    const match = record.exec(line);
    if (!match) throw new Error('malformed observed reflog');
    const sha = match[2];
    const action = match[3];
    if (sha && action && !/^(?:checkout|reset|fetch|branch): /.test(action) && !/^0+$/.test(sha)) commits.add(sha);
  }
  if (commits.size > COMMIT_RECEIPT_LIMITS.receiptsPerInvocation)
    throw new Error('observed commit count exceeds budget');
  return [...commits].map((sha) => ({
    schemaVersion: 1,
    invocationKey: enrollment.invocationKey,
    nonce: `observed-${createHash('sha256').update(repository.gitDirectory).digest('hex')}-${sha}`,
    sha,
    repository
  }));
}

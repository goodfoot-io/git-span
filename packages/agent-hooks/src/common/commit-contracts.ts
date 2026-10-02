/** Immutable invocation and receipt contracts; all validation is independent of host SDKs and filesystem IO. */
import { isAbsolute } from 'node:path';
import { COMMIT_RECEIPT_LIMITS } from './commit-limits.js';
export type CommitHost = 'claude' | 'codex';
export type CommitObjectFormat = 'sha1' | 'sha256';
export type CommitValidation<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/** Frozen at enrollment. A locator unavailable at enrollment is omitted, never guessed from another invocation. */
export interface CommitEnrollment {
  readonly schemaVersion: 1;
  readonly invocationKey: string;
  readonly host: CommitHost;
  readonly sessionId: string;
  readonly toolUseId: string;
  readonly originalInput: Readonly<Record<string, unknown>>;
  readonly originalCommand: string;
  readonly cwd: string;
  readonly gitExecutable: string;
  readonly transcriptLocator?: string;
}

/** Canonical repository identity is resolved before the builtin commit executes. */
export interface CommitRepository {
  readonly cwd: string;
  readonly gitDirectory: string;
  readonly commonDirectory: string;
  readonly headReflog: string;
  readonly objectFormat: CommitObjectFormat;
}

/** A receipt proves creation independently of shell response text or later HEAD movement. */
export interface CommitReceipt {
  readonly schemaVersion: 1;
  readonly invocationKey: string;
  readonly nonce: string;
  readonly sha: string;
  readonly repository: CommitRepository;
}

/** The durable CLI document deliberately excludes invocation identity, nonce and timestamps. */
export interface CommitNoteDocument {
  readonly schemaVersion: 1;
  readonly host: CommitHost;
  readonly sessionId: string;
  readonly transcriptLocator?: string;
}

export interface CommitPostIdentity {
  readonly host: CommitHost;
  readonly sessionId: string;
  readonly toolUseId: string;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = 4096): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0');
}

function absolute(value: unknown): value is string {
  return text(value) && isAbsolute(value);
}

function key(value: unknown): value is string {
  return text(value, COMMIT_RECEIPT_LIMITS.identityKeyBytes) && /^[a-zA-Z0-9_-]+$/.test(value);
}

function reject(reason: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason };
}

/** Validate a persisted enrollment without adopting fields from a later hook. */
export function validateCommitEnrollment(value: unknown): CommitValidation<CommitEnrollment> {
  if (!object(value) || value.schemaVersion !== 1) return reject('invalid enrollment schema');
  if (value.host !== 'claude' && value.host !== 'codex') return reject('unsupported commit host');
  if (!key(value.invocationKey) || !text(value.sessionId) || !text(value.toolUseId)) {
    return reject('invalid invocation identity');
  }
  if (!absolute(value.cwd) || !absolute(value.gitExecutable)) return reject('enrollment paths must be absolute');
  if (!object(value.originalInput) || !text(value.originalCommand, COMMIT_RECEIPT_LIMITS.jsonFileBytes)) {
    return reject('invalid original tool input');
  }
  if (value.transcriptLocator !== undefined && !text(value.transcriptLocator))
    return reject('invalid transcript locator');
  try {
    if (Buffer.byteLength(JSON.stringify(value.originalInput)) > COMMIT_RECEIPT_LIMITS.jsonFileBytes)
      return reject('original input exceeds budget');
  } catch {
    return reject('original input is not serializable');
  }
  const enrollment: CommitEnrollment = {
    schemaVersion: 1,
    invocationKey: value.invocationKey,
    host: value.host,
    sessionId: value.sessionId,
    toolUseId: value.toolUseId,
    originalInput: value.originalInput,
    originalCommand: value.originalCommand,
    cwd: value.cwd,
    gitExecutable: value.gitExecutable,
    ...(value.transcriptLocator === undefined ? {} : { transcriptLocator: value.transcriptLocator })
  };
  return { ok: true, value: enrollment };
}

/** Validate a receipt's complete object ID and originating enrollment reference. */
export function validateCommitReceipt(value: unknown, enrollment: CommitEnrollment): CommitValidation<CommitReceipt> {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    value.invocationKey !== enrollment.invocationKey ||
    !key(value.nonce)
  ) {
    return reject('invalid receipt identity');
  }
  const repo = value.repository;
  if (
    !object(repo) ||
    !absolute(repo.cwd) ||
    !absolute(repo.gitDirectory) ||
    !absolute(repo.commonDirectory) ||
    !absolute(repo.headReflog)
  ) {
    return reject('receipt repository paths must be absolute');
  }
  if (repo.objectFormat !== 'sha1' && repo.objectFormat !== 'sha256') return reject('unsupported object format');
  const pattern = repo.objectFormat === 'sha1' ? /^[0-9a-f]{40}$/ : /^[0-9a-f]{64}$/;
  if (typeof value.sha !== 'string' || !pattern.test(value.sha) || /^0+$/.test(value.sha))
    return reject('invalid full commit SHA');
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      invocationKey: value.invocationKey,
      nonce: value.nonce,
      sha: value.sha,
      repository: {
        cwd: repo.cwd,
        gitDirectory: repo.gitDirectory,
        commonDirectory: repo.commonDirectory,
        headReflog: repo.headReflog,
        objectFormat: repo.objectFormat
      }
    }
  };
}

/** Match a terminal post and restore the exact original command, input and cwd. */
export function restoreCommitInvocation(
  enrollment: CommitEnrollment,
  post: CommitPostIdentity
): CommitValidation<{
  readonly input: Readonly<Record<string, unknown>>;
  readonly command: string;
  readonly cwd: string;
}> {
  if (
    enrollment.host !== post.host ||
    enrollment.sessionId !== post.sessionId ||
    enrollment.toolUseId !== post.toolUseId
  ) {
    return reject('post does not match enrolled invocation');
  }
  return {
    ok: true,
    value: { input: enrollment.originalInput, command: enrollment.originalCommand, cwd: enrollment.cwd }
  };
}

/** Freeze the deterministic document from the original enrollment. */
export function createCommitNoteDocument(enrollment: CommitEnrollment): CommitNoteDocument {
  return {
    schemaVersion: 1,
    host: enrollment.host,
    sessionId: enrollment.sessionId,
    ...(enrollment.transcriptLocator === undefined ? {} : { transcriptLocator: enrollment.transcriptLocator })
  };
}

/** Produce stable JSON for CLI stdin and byte-identical retries. */
export function serializeCommitNoteDocument(document: CommitNoteDocument): string {
  return JSON.stringify({
    schemaVersion: document.schemaVersion,
    host: document.host,
    sessionId: document.sessionId,
    ...(document.transcriptLocator === undefined ? {} : { transcriptLocator: document.transcriptLocator })
  });
}

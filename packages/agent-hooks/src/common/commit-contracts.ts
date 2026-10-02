/** Immutable invocation and receipt contracts; all validation is independent of host SDKs and filesystem IO. */
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

/** Validate a persisted enrollment without adopting fields from a later hook. */
export function validateCommitEnrollment(_value: unknown): CommitValidation<CommitEnrollment> {
  throw new Error('Not Implemented');
}

/** Validate a receipt's complete object ID and originating enrollment reference. */
export function validateCommitReceipt(_value: unknown, _enrollment: CommitEnrollment): CommitValidation<CommitReceipt> {
  throw new Error('Not Implemented');
}

/** Match a terminal post and restore the exact original command, input and cwd. */
export function restoreCommitInvocation(
  _enrollment: CommitEnrollment,
  _post: CommitPostIdentity
): CommitValidation<{
  readonly input: Readonly<Record<string, unknown>>;
  readonly command: string;
  readonly cwd: string;
}> {
  throw new Error('Not Implemented');
}

/** Freeze the deterministic document from the original enrollment. */
export function createCommitNoteDocument(_enrollment: CommitEnrollment): CommitNoteDocument {
  throw new Error('Not Implemented');
}

/** Produce stable JSON for CLI stdin and byte-identical retries. */
export function serializeCommitNoteDocument(_document: CommitNoteDocument): string {
  throw new Error('Not Implemented');
}

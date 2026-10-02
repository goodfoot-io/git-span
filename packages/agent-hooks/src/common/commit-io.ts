/** Injectable IO ports use real implementations in acceptance checks, independent of host SDKs. */

import type { CommitRepository, CommitValidation } from './commit-contracts.js';
import type { CommitReflogAppend, CommitReflogCheckpoint } from './commit-git.js';
import type { CommitClaimOwner, CommitOwnerLiveness } from './commit-lifecycle.js';

export interface CommitProcessResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
}

export interface CommitGitIO {
  /** Probe from the ORIGINAL child cwd with original global options; never apply -C again to effectiveCwd. */
  resolveRepository(
    executable: string,
    globalArguments: readonly string[],
    cwd: string
  ): Promise<CommitValidation<CommitRepository>>;
  /** Verify the witnessed full SHA resolves to a commit object using the repository actual object format. */
  validateCommitObject(repository: CommitRepository, sha: string): Promise<CommitValidation<string>>;
  checkpoint(reflogPath: string): Promise<CommitValidation<CommitReflogCheckpoint>>;
  readAppend(
    reflogPath: string,
    checkpoint: CommitReflogCheckpoint,
    maxBytes: number
  ): Promise<CommitValidation<CommitReflogAppend | null>>;
  /** Inherited stdio; caller environment is unchanged except this child's unique GIT_REFLOG_ACTION. */
  execute(
    executable: string,
    argv: readonly string[],
    cwd: string,
    reflogAction?: string
  ): Promise<CommitProcessResult>;
}

export interface CommitNotesCommand {
  readonly cwd: string;
  readonly argv: readonly string[];
  readonly stdin?: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface CommitNotesResult extends CommitProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly outputExceeded: boolean;
}

export interface CommitNotesIO {
  /** Existing notes CLI only; no native database adapter is permitted. */
  execute(command: CommitNotesCommand): Promise<CommitNotesResult>;
}

export interface CommitClaimIO {
  readonly nowMs: () => number;
  readonly createOwner: () => CommitClaimOwner;
  /** Exclusive private publication; no check-then-create race. */
  acquire(key: string, owner: CommitClaimOwner): Promise<boolean>;
  inspect(key: string): Promise<CommitValidation<CommitClaimOwner | null>>;
  liveness(owner: CommitClaimOwner): Promise<CommitOwnerLiveness>;
  /** Serialize recovery/release before comparing owner tokens; a read-then-unlink race is not sufficient. */
  remove(key: string, expectedOwner: CommitClaimOwner): Promise<boolean>;
}

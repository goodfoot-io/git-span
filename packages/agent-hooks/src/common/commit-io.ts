/** Injectable IO ports use real implementations in acceptance checks, independent of host SDKs. */

import type { CommitRepository, CommitValidation } from './commit-contracts.js';
import type { CommitReflogAppend, CommitReflogCheckpoint } from './commit-git.js';
import type { CommitClaimOwner, CommitOwnerLiveness } from './commit-lifecycle.js';

export interface CommitProcessResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
}

export interface CommitGitIO {
  /** Probe using the frozen absolute Git and original global options before executing the actual command. */
  resolveRepository(
    executable: string,
    globalArguments: readonly string[],
    cwd: string
  ): Promise<CommitValidation<CommitRepository>>;
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
  /** Recovery and release compare the exact owner token atomically. */
  remove(key: string, expectedOwner: CommitClaimOwner): Promise<boolean>;
}

/** Injectable IO ports use real implementations in acceptance checks, independent of host SDKs. */

import type { CommitValidation } from './commit-contracts.js';
import type { CommitClaimOwner, CommitOwnerLiveness } from './commit-lifecycle.js';

export interface CommitProcessResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
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

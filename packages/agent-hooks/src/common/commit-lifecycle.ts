/** Receipt lifecycle is separate from existing touch consumption and never changes the user's shell status. */
import type { CommitEnrollment, CommitPostIdentity, CommitReceipt, CommitValidation } from './commit-contracts.js';

export const COMMIT_RECEIPT_LIMITS = {
  reflogBytes: 1_048_576,
  receiptsPerInvocation: 256,
  bytesPerInvocation: 4_194_304,
  invocations: 4096,
  totalBytes: 67_108_864,
  abandonedRetentionMs: 86_400_000,
  drainMs: 3000,
  cliMs: 2000
} as const;

export type CommitInvocationStatus = 'active' | 'completed' | 'acknowledged' | 'retired';

export interface CommitInvocationState {
  readonly enrollment: CommitEnrollment;
  readonly status: CommitInvocationStatus;
  readonly pendingNonces: readonly string[];
  readonly liveLease: boolean;
  readonly lastActivityMs: number;
}

export type CommitLifecycleEvent =
  | { readonly kind: 'receipt'; readonly receipt: CommitReceipt; readonly nowMs: number }
  | { readonly kind: 'terminal'; readonly identity: CommitPostIdentity; readonly nowMs: number }
  | { readonly kind: 'acknowledge'; readonly nonce: string; readonly nowMs: number }
  | { readonly kind: 'cleanup'; readonly host: 'claude' | 'codex'; readonly nowMs: number }
  | { readonly kind: 'expire'; readonly nowMs: number };

/** Codex turn cleanup retains active yielded enrollment; retired keys never reopen. */
export function transitionCommitInvocation(
  _state: CommitInvocationState,
  _event: CommitLifecycleEvent
): CommitValidation<CommitInvocationState> {
  throw new Error('Not Implemented');
}

export interface CommitStateUsage {
  readonly invocations: number;
  readonly totalBytes: number;
  readonly invocationReceipts: number;
  readonly invocationBytes: number;
}

/** Reject overflow before new publication; callers diagnose once and allow the original command unchanged. */
export function validateCommitStateCapacity(
  _usage: CommitStateUsage,
  _additional: CommitStateUsage
): CommitValidation<CommitStateUsage> {
  throw new Error('Not Implemented');
}

export interface CommitClaimOwner {
  readonly token: string;
  readonly pid: number;
}

export type CommitOwnerLiveness = 'alive' | 'dead' | 'uncertain';
export type CommitClaimDecision = 'acquire' | 'recover' | 'wait' | 'refuse';

/** Recovery requires confirmed dead ownership; live or uncertain owners are never stolen. */
export function decideCommitClaim(
  _owner: CommitClaimOwner | null,
  _liveness: CommitOwnerLiveness,
  _remainingMs: number
): CommitClaimDecision {
  throw new Error('Not Implemented');
}

/** Remaining monotonic phase budget constrains each CLI call and claim attempt. */
export function commitCliBudgetMs(_phaseStartedMs: number, _nowMs: number): number {
  throw new Error('Not Implemented');
}

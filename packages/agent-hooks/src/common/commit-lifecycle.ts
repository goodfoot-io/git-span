/** Receipt lifecycle is separate from existing touch consumption and never changes the user's shell status. */

import type { CommitEnrollment, CommitPostIdentity, CommitReceipt, CommitValidation } from './commit-contracts.js';
import { restoreCommitInvocation, validateCommitReceipt } from './commit-contracts.js';
import { COMMIT_RECEIPT_LIMITS } from './commit-limits.js';

export { COMMIT_RECEIPT_LIMITS } from './commit-limits.js';

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
  state: CommitInvocationState,
  event: CommitLifecycleEvent
): CommitValidation<CommitInvocationState> {
  const reject = (reason: string): CommitValidation<CommitInvocationState> => ({ ok: false, reason });
  const keep = (): CommitValidation<CommitInvocationState> => ({ ok: true, value: state });
  if (!Number.isFinite(event.nowMs) || event.nowMs < state.lastActivityMs) return reject('invalid lifecycle clock');
  if (state.status === 'retired') {
    return event.kind === 'cleanup' || event.kind === 'expire' ? keep() : reject('invocation is retired');
  }
  switch (event.kind) {
    case 'receipt': {
      if (state.status !== 'active') return reject('receipt publication requires an active invocation');
      const receipt = validateCommitReceipt(event.receipt, state.enrollment);
      if (!receipt.ok) return receipt;
      if (state.pendingNonces.includes(event.receipt.nonce)) return keep();
      if (state.pendingNonces.length >= COMMIT_RECEIPT_LIMITS.receiptsPerInvocation)
        return reject('receipt count exceeds budget');
      return {
        ok: true,
        value: { ...state, pendingNonces: [...state.pendingNonces, event.receipt.nonce], lastActivityMs: event.nowMs }
      };
    }
    case 'terminal': {
      const match = restoreCommitInvocation(state.enrollment, event.identity);
      if (!match.ok) return match;
      if (state.status !== 'active') return keep();
      return {
        ok: true,
        value: {
          ...state,
          status: state.pendingNonces.length === 0 ? 'acknowledged' : 'completed',
          liveLease: false,
          lastActivityMs: event.nowMs
        }
      };
    }
    case 'acknowledge': {
      if (state.status !== 'completed' || !state.pendingNonces.includes(event.nonce))
        return reject('unknown or premature receipt acknowledgment');
      const pendingNonces = state.pendingNonces.filter((nonce) => nonce !== event.nonce);
      return {
        ok: true,
        value: {
          ...state,
          status: pendingNonces.length === 0 ? 'acknowledged' : 'completed',
          pendingNonces,
          lastActivityMs: event.nowMs
        }
      };
    }
    case 'cleanup':
      if (event.host !== state.enrollment.host) return reject('cleanup host mismatch');
      if (state.liveLease || state.status !== 'acknowledged') return keep();
      return { ok: true, value: { ...state, status: 'retired', lastActivityMs: event.nowMs } };
    case 'expire':
      if (state.liveLease || event.nowMs - state.lastActivityMs < COMMIT_RECEIPT_LIMITS.abandonedRetentionMs)
        return keep();
      return { ok: true, value: { ...state, status: 'retired', pendingNonces: [], lastActivityMs: event.nowMs } };
  }
}

export interface CommitStateUsage {
  readonly invocations: number;
  readonly totalBytes: number;
  readonly invocationReceipts: number;
  readonly invocationBytes: number;
}

/** Reject overflow before new publication; callers diagnose once and allow the original command unchanged. */
export function validateCommitStateCapacity(
  usage: CommitStateUsage,
  additional: CommitStateUsage
): CommitValidation<CommitStateUsage> {
  const limits: CommitStateUsage = {
    invocations: COMMIT_RECEIPT_LIMITS.invocations,
    totalBytes: COMMIT_RECEIPT_LIMITS.totalBytes,
    invocationReceipts: COMMIT_RECEIPT_LIMITS.receiptsPerInvocation,
    invocationBytes: COMMIT_RECEIPT_LIMITS.bytesPerInvocation
  };
  const total = { ...usage };
  for (const key of Object.keys(limits) as (keyof CommitStateUsage)[]) {
    if (
      !Number.isSafeInteger(usage[key]) ||
      usage[key] < 0 ||
      !Number.isSafeInteger(additional[key]) ||
      additional[key] < 0
    )
      return { ok: false, reason: 'invalid receipt capacity accounting' };
    total[key] = usage[key] + additional[key];
    if (!Number.isSafeInteger(total[key]) || total[key] > limits[key])
      return { ok: false, reason: 'receipt state capacity exceeded' };
  }
  return { ok: true, value: total };
}

export interface CommitClaimOwner {
  readonly token: string;
  readonly pid: number;
}

export type CommitOwnerLiveness = 'alive' | 'dead' | 'uncertain';
export type CommitClaimDecision = 'acquire' | 'recover' | 'wait' | 'refuse';

/** Recovery requires confirmed dead ownership; live or uncertain owners are never stolen. */
export function decideCommitClaim(
  owner: CommitClaimOwner | null,
  liveness: CommitOwnerLiveness,
  remainingMs: number
): CommitClaimDecision {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 'refuse';
  if (owner === null) return 'acquire';
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || !/^[a-zA-Z0-9_-]{1,256}$/.test(owner.token))
    return 'refuse';
  if (liveness === 'dead') return 'recover';
  return liveness === 'alive' ? 'wait' : 'refuse';
}

/** Remaining monotonic phase budget constrains each CLI call and claim attempt. */
export function commitCliBudgetMs(phaseStartedMs: number, nowMs: number): number {
  if (!Number.isFinite(phaseStartedMs) || !Number.isFinite(nowMs) || nowMs < phaseStartedMs) return 0;
  return Math.max(
    0,
    Math.floor(Math.min(COMMIT_RECEIPT_LIMITS.cliMs, COMMIT_RECEIPT_LIMITS.drainMs - (nowMs - phaseStartedMs)))
  );
}

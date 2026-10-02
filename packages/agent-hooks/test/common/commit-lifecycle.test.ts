import { describe, expect, it } from 'vitest';
import {
  COMMIT_RECEIPT_LIMITS,
  type CommitInvocationState,
  commitCliBudgetMs,
  decideCommitClaim,
  transitionCommitInvocation,
  validateCommitStateCapacity
} from '../../src/common/commit-lifecycle.js';
import { enrollment, nonce, receipt } from './commit-fixtures.js';

const active: CommitInvocationState = {
  enrollment,
  status: 'active',
  pendingNonces: [],
  liveLease: true,
  lastActivityMs: 0
};
const completed: CommitInvocationState = { ...active, status: 'completed', pendingNonces: [nonce], liveLease: false };
const owner = { token: 'owner-1234567890abcdef', pid: 1000 };
const emptyUsage = { invocations: 0, totalBytes: 0, invocationReceipts: 0, invocationBytes: 0 };

describe('independent invocation lifecycle', () => {
  it('publishes a receipt without completing active yielded execution', () => {
    expect(transitionCommitInvocation(active, { kind: 'receipt', receipt, nowMs: 1 })).toMatchObject({
      ok: true,
      value: { status: 'active', pendingNonces: [nonce], liveLease: true }
    });
  });
  it('deduplicates identical receipt nonce publication', () => {
    expect(
      transitionCommitInvocation({ ...active, pendingNonces: [nonce] }, { kind: 'receipt', receipt, nowMs: 1 })
    ).toMatchObject({ ok: true, value: { pendingNonces: [nonce] } });
  });
  it('rejects another invocation receipt', () => {
    expect(
      transitionCommitInvocation(active, { kind: 'receipt', receipt: { ...receipt, invocationKey: 'other' }, nowMs: 1 })
        .ok
    ).toBe(false);
  });
  it('marks a correlated terminal delivery completed while retaining pending evidence', () => {
    expect(
      transitionCommitInvocation(
        { ...active, pendingNonces: [nonce] },
        { kind: 'terminal', identity: enrollment, nowMs: 1 }
      )
    ).toMatchObject({ ok: true, value: { status: 'completed', pendingNonces: [nonce], liveLease: false } });
  });
  it('rejects another session terminal delivery', () => {
    expect(
      transitionCommitInvocation(active, {
        kind: 'terminal',
        identity: { ...enrollment, sessionId: 'other' },
        nowMs: 1
      }).ok
    ).toBe(false);
  });
  it('replaying a terminal event cannot reopen acknowledged work', () => {
    expect(
      transitionCommitInvocation(
        { ...completed, status: 'acknowledged', pendingNonces: [] },
        { kind: 'terminal', identity: enrollment, nowMs: 1 }
      )
    ).toMatchObject({ ok: true, value: { status: 'acknowledged', pendingNonces: [] } });
  });
  it('acknowledges only the successfully recorded receipt', () => {
    expect(
      transitionCommitInvocation(
        { ...completed, pendingNonces: [nonce, 'second'] },
        { kind: 'acknowledge', nonce, nowMs: 1 }
      )
    ).toMatchObject({ ok: true, value: { status: 'completed', pendingNonces: ['second'] } });
    expect(transitionCommitInvocation(completed, { kind: 'acknowledge', nonce, nowMs: 1 })).toMatchObject({
      ok: true,
      value: { status: 'acknowledged', pendingNonces: [] }
    });
  });
  it('unknown acknowledgment cannot erase another receipt', () => {
    expect(transitionCommitInvocation(completed, { kind: 'acknowledge', nonce: 'other', nowMs: 1 }).ok).toBe(false);
  });
  it('Codex Stop preserves the continuing session and active yielded enrollment', () => {
    const codex = { ...active, enrollment: { ...enrollment, host: 'codex' as const } };
    expect(transitionCommitInvocation(codex, { kind: 'cleanup', host: 'codex', nowMs: 1 })).toEqual({
      ok: true,
      value: codex
    });
  });
  it.each(['claude', 'codex'] as const)('%s cleanup retains completed pending evidence for retry', (host) => {
    const state = { ...completed, enrollment: { ...enrollment, host } };
    expect(transitionCommitInvocation(state, { kind: 'cleanup', host, nowMs: 1 })).toMatchObject({
      ok: true,
      value: { status: 'completed', pendingNonces: [nonce] }
    });
  });
  it('Claude cleanup retires drained acknowledged enrollment', () => {
    expect(
      transitionCommitInvocation(
        { ...completed, status: 'acknowledged', pendingNonces: [] },
        { kind: 'cleanup', host: 'claude', nowMs: 1 }
      )
    ).toMatchObject({ ok: true, value: { status: 'retired' } });
  });
  it('retired keys cannot reopen on late posts', () => {
    expect(
      transitionCommitInvocation(
        { ...completed, status: 'retired', pendingNonces: [] },
        { kind: 'terminal', identity: enrollment, nowMs: 1 }
      ).ok
    ).toBe(false);
  });
  it('retains abandoned pending work within the 24-hour window', () => {
    expect(
      transitionCommitInvocation(completed, { kind: 'expire', nowMs: COMMIT_RECEIPT_LIMITS.abandonedRetentionMs - 1 })
    ).toMatchObject({ ok: true, value: { status: 'completed', pendingNonces: [nonce] } });
  });
  it('expires abandoned evidence but preserves a live invocation lease', () => {
    const nowMs = COMMIT_RECEIPT_LIMITS.abandonedRetentionMs + 1;
    expect(transitionCommitInvocation(completed, { kind: 'expire', nowMs })).toMatchObject({
      ok: true,
      value: { status: 'retired', pendingNonces: [] }
    });
    expect(transitionCommitInvocation(active, { kind: 'expire', nowMs })).toEqual({ ok: true, value: active });
  });
});

describe('bounded capacity, claims and drain deadline', () => {
  it('allows exact capacity limits', () => {
    const additional = {
      invocations: COMMIT_RECEIPT_LIMITS.invocations,
      totalBytes: COMMIT_RECEIPT_LIMITS.totalBytes,
      invocationReceipts: COMMIT_RECEIPT_LIMITS.receiptsPerInvocation,
      invocationBytes: COMMIT_RECEIPT_LIMITS.bytesPerInvocation
    };
    expect(validateCommitStateCapacity(emptyUsage, additional)).toEqual({ ok: true, value: additional });
  });
  it.each([
    { invocations: COMMIT_RECEIPT_LIMITS.invocations + 1 },
    { totalBytes: COMMIT_RECEIPT_LIMITS.totalBytes + 1 },
    { invocationReceipts: COMMIT_RECEIPT_LIMITS.receiptsPerInvocation + 1 },
    { invocationBytes: COMMIT_RECEIPT_LIMITS.bytesPerInvocation + 1 },
    { invocationBytes: -1 },
    { invocationReceipts: 0.5 },
    { totalBytes: Number.NaN }
  ])('rejects overflow or invalid capacity accounting %#', (changed) => {
    expect(validateCommitStateCapacity(emptyUsage, { ...emptyUsage, ...changed }).ok).toBe(false);
  });
  it.each([
    [null, 'uncertain', 100, 'acquire'],
    [owner, 'dead', 100, 'recover'],
    [owner, 'alive', 100, 'wait'],
    [owner, 'uncertain', 100, 'refuse'],
    [owner, 'dead', 0, 'refuse'],
    [null, 'dead', 0, 'refuse']
  ] as const)(
    'handles ownership without stealing live or uncertain claims %#',
    (claimOwner, liveness, remainingMs, expected) => {
      expect(decideCommitClaim(claimOwner, liveness, remainingMs)).toBe(expected);
    }
  );
  it.each([
    [0, 0, 2000],
    [100, 1000, 2000],
    [0, 1500, 1500],
    [0, 2999, 1],
    [0, 3000, 0],
    [0, 4000, 0]
  ])('caps each CLI call by the remaining monotonic drain budget %#', (started, now, expected) => {
    expect(commitCliBudgetMs(started, now)).toBe(expected);
  });
});

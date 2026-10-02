/** Immutable values exercising the pure contracts; no filesystem or framework mocks. */
import type { CommitEnrollment, CommitReceipt } from '../../src/common/commit-contracts.js';

export const enrollment: CommitEnrollment = {
  schemaVersion: 1,
  invocationKey: 'invocation-1234567890abcdef',
  host: 'claude',
  sessionId: 'session-a',
  toolUseId: 'tool-a',
  originalInput: { command: 'git commit -q --allow-empty -m example', timeout: 10000 },
  originalCommand: 'git commit -q --allow-empty -m example',
  cwd: '/repo',
  gitExecutable: '/usr/bin/git'
};
export const sha = 'a'.repeat(40);
export const nonce = 'receipt-1234567890abcdef';
export const receipt: CommitReceipt = {
  schemaVersion: 1,
  invocationKey: enrollment.invocationKey,
  nonce,
  sha,
  repository: {
    cwd: '/repo',
    gitDirectory: '/repo/.git',
    commonDirectory: '/repo/.git',
    headReflog: '/repo/.git/logs/HEAD',
    objectFormat: 'sha1'
  }
};

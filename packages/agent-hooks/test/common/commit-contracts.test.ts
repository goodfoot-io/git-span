import { describe, expect, it } from 'vitest';
import {
  createCommitNoteDocument,
  restoreCommitInvocation,
  serializeCommitNoteDocument,
  validateCommitEnrollment,
  validateCommitReceipt
} from '../../src/common/commit-contracts.js';
import { enrollment, receipt } from './commit-fixtures.js';

describe('immutable commit enrollment and receipts', () => {
  it.each(['claude', 'codex'] as const)('accepts frozen %s identity without a locator', (host) => {
    expect(validateCommitEnrollment({ ...enrollment, host })).toEqual({ ok: true, value: { ...enrollment, host } });
  });
  it('retains a supplied transcript locator without reading transcript contents', () => {
    const value = { ...enrollment, transcriptLocator: '/transcripts/session.jsonl' };
    expect(validateCommitEnrollment(value)).toEqual({ ok: true, value });
  });
  it.each([
    null,
    { ...enrollment, schemaVersion: 2 },
    { ...enrollment, host: 'opencode' },
    { ...enrollment, invocationKey: '../escape' },
    { ...enrollment, invocationKey: '' },
    { ...enrollment, sessionId: '' },
    { ...enrollment, sessionId: 's'.repeat(4097) },
    { ...enrollment, toolUseId: '' },
    { ...enrollment, cwd: 'relative' },
    { ...enrollment, gitExecutable: 'git' },
    { ...enrollment, transcriptLocator: '' },
    { ...enrollment, originalInput: null },
    { ...enrollment, originalCommand: 7 }
  ])('rejects unsafe or incomplete enrollment %#', (value) => {
    expect(validateCommitEnrollment(value).ok).toBe(false);
  });
  it.each(['sha1', 'sha256'] as const)('accepts the repository full %s SHA', (objectFormat) => {
    const value = {
      ...receipt,
      sha: 'b'.repeat(objectFormat === 'sha1' ? 40 : 64),
      repository: { ...receipt.repository, objectFormat }
    };
    expect(validateCommitReceipt(value, enrollment)).toEqual({ ok: true, value });
  });
  it.each([
    { ...receipt, invocationKey: 'other-invocation' },
    { ...receipt, nonce: '' },
    { ...receipt, sha: 'abc123' },
    { ...receipt, sha: 'z'.repeat(40) },
    { ...receipt, sha: '0'.repeat(40) },
    { ...receipt, sha: 'a'.repeat(64) },
    { ...receipt, repository: { ...receipt.repository, gitDirectory: 'relative' } },
    { ...receipt, repository: { ...receipt.repository, commonDirectory: 'relative' } },
    { ...receipt, repository: { ...receipt.repository, headReflog: 'relative' } },
    { ...receipt, repository: { ...receipt.repository, objectFormat: 'unknown' } }
  ])('rejects forged or malformed receipt %#', (value) => {
    expect(validateCommitReceipt(value, enrollment).ok).toBe(false);
  });
  it('restores original command, input fields and cwd only for the correlated post', () => {
    expect(restoreCommitInvocation(enrollment, enrollment)).toEqual({
      ok: true,
      value: { input: enrollment.originalInput, command: enrollment.originalCommand, cwd: enrollment.cwd }
    });
  });
  it.each([{ host: 'codex' as const }, { sessionId: 'later-session' }, { toolUseId: 'later-tool' }])(
    'rejects post identity mismatch %#',
    (changed) => {
      expect(restoreCommitInvocation(enrollment, { ...enrollment, ...changed }).ok).toBe(false);
    }
  );
  it('omits unavailable locators and all transient metadata from the durable document', () => {
    expect(createCommitNoteDocument(enrollment)).toEqual({ schemaVersion: 1, host: 'claude', sessionId: 'session-a' });
  });
  it('serializes a frozen locator and document in stable order for identical retries', () => {
    const document = createCommitNoteDocument({ ...enrollment, transcriptLocator: '/transcripts/a' });
    expect(serializeCommitNoteDocument(document)).toBe(
      '{"schemaVersion":1,"host":"claude","sessionId":"session-a","transcriptLocator":"/transcripts/a"}'
    );
    expect(
      serializeCommitNoteDocument({
        sessionId: 'session-a',
        transcriptLocator: '/transcripts/a',
        host: 'claude',
        schemaVersion: 1
      })
    ).toBe(serializeCommitNoteDocument(document));
  });
});

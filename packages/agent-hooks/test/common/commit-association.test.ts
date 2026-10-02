import { describe, expect, it } from 'vitest';
import {
  commitAssociationKey,
  selectCommitAssociation,
  validateCommitNotesAdd,
  validateCommitNotesList
} from '../../src/common/commit-association.js';
import type { CommitNoteDocument } from '../../src/common/commit-contracts.js';
import { receipt, sha } from './commit-fixtures.js';

const document: CommitNoteDocument = { schemaVersion: 1, host: 'claude', sessionId: 'session-a' };
function envelope(operation: string, notes: unknown[]) {
  return { schema_version: 1, operation, notes };
}
function note(value: unknown = document, commitSha = sha) {
  return { id: 1, commit_sha: commitSha, document: value };
}

describe('durable association and CLI acknowledgments', () => {
  it('shares claim identity across linked worktrees for the same common repository', () => {
    const linked = {
      ...receipt,
      invocationKey: 'other',
      nonce: 'other',
      repository: { ...receipt.repository, cwd: '/linked', gitDirectory: '/repo/.git/worktrees/linked' }
    };
    expect(commitAssociationKey(linked, document)).toBe(commitAssociationKey(receipt, document));
  });
  it.each([
    { ...document, host: 'codex' as const },
    { ...document, sessionId: 'session-b' }
  ])('isolates host and session claim identity %#', (value) => {
    expect(commitAssociationKey(receipt, value)).not.toBe(commitAssociationKey(receipt, document));
  });
  it('isolates repository and SHA while excluding locator differences', () => {
    expect(commitAssociationKey({ ...receipt, sha: 'b'.repeat(40) }, document)).not.toBe(
      commitAssociationKey(receipt, document)
    );
    expect(
      commitAssociationKey(
        { ...receipt, repository: { ...receipt.repository, commonDirectory: '/other/.git' } },
        document
      )
    ).not.toBe(commitAssociationKey(receipt, document));
    expect(commitAssociationKey(receipt, { ...document, transcriptLocator: '/new' })).toBe(
      commitAssociationKey(receipt, document)
    );
  });
  it('adds the frozen document when there is no existing matching association', () => {
    expect(
      selectCommitAssociation(document, [
        { document: { ...document, sessionId: 'other' } },
        { document: { schemaVersion: 2 } }
      ])
    ).toEqual({ kind: 'add', document });
  });
  it('recovers a lost add acknowledgment by reusing an existing identical association', () => {
    expect(selectCommitAssociation(document, [{ document }])).toEqual({
      kind: 'reuse',
      document,
      locatorConflict: false
    });
  });
  it('preserves an absent earlier locator and diagnoses a conflicting later locator', () => {
    expect(selectCommitAssociation({ ...document, transcriptLocator: '/later' }, [{ document }])).toEqual({
      kind: 'reuse',
      document,
      locatorConflict: true
    });
  });
  it('preserves an earlier locator when the retry has no locator', () => {
    const existing = { ...document, transcriptLocator: '/earlier' };
    expect(selectCommitAssociation(document, [{ document: existing }])).toEqual({
      kind: 'reuse',
      document: existing,
      locatorConflict: false
    });
  });
  it('refuses ambiguous multiple matching associations', () => {
    expect(
      selectCommitAssociation(document, [{ document }, { document: { ...document, transcriptLocator: '/other' } }])
    ).toMatchObject({ kind: 'reject' });
  });
  it('accepts an empty exact-SHA list envelope', () => {
    expect(validateCommitNotesList(envelope('list', []), sha)).toEqual({ ok: true, value: [] });
  });
  it('accepts arbitrary documents on the exact SHA without assigning their session', () => {
    expect(validateCommitNotesList(envelope('list', [note({ user: 'unrelated' })]), sha)).toEqual({
      ok: true,
      value: [{ document: { user: 'unrelated' } }]
    });
  });
  it.each([
    null,
    { schema_version: 2, operation: 'list', notes: [] },
    envelope('add', [note()]),
    envelope('list', [note(document, 'b'.repeat(40))]),
    envelope('list', [{ ...note(), id: 0 }]),
    envelope('list', [{ ...note(), id: Number.MAX_SAFE_INTEGER + 1 }]),
    envelope('list', [{ id: 1, commit_sha: sha }])
  ])('refuses malformed or incorrectly selected CLI lists %#', (value) => {
    expect(validateCommitNotesList(value, sha).ok).toBe(false);
  });
  it('acknowledges only the expected exact SHA and frozen document', () => {
    expect(validateCommitNotesAdd(envelope('add', [note()]), sha, document)).toEqual({ ok: true, value: document });
  });
  it.each([
    envelope('add', []),
    envelope('add', [note(), note()]),
    envelope('list', [note()]),
    envelope('add', [note(document, 'b'.repeat(40))]),
    envelope('add', [note({ ...document, sessionId: 'later' })]),
    envelope('add', [note({ ...document, transcriptLocator: '/unexpected' })]),
    { schema_version: 2, operation: 'add', notes: [note()] }
  ])('keeps receipts pending after invalid CLI acknowledgment %#', (value) => {
    expect(validateCommitNotesAdd(value, sha, document).ok).toBe(false);
  });
});

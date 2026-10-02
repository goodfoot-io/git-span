/** Pure notes CLI envelope and duplicate-association decisions; no direct notes-database writes. */
import type { CommitNoteDocument, CommitReceipt, CommitValidation } from './commit-contracts.js';

export interface CommitExistingNote {
  readonly document: unknown;
}

export type CommitAssociationDecision =
  | { readonly kind: 'add'; readonly document: CommitNoteDocument }
  | { readonly kind: 'reuse'; readonly document: CommitNoteDocument; readonly locatorConflict: boolean }
  | { readonly kind: 'reject'; readonly reason: string };

/** Scope the cross-invocation claim to canonical common-repository/host/session/full-SHA identity. */
export function commitAssociationKey(_receipt: CommitReceipt, _document: CommitNoteDocument): string {
  throw new Error('Not Implemented');
}

/** Select an existing matching host/session document, preserving its original optional locator. */
export function selectCommitAssociation(
  _document: CommitNoteDocument,
  _existing: readonly CommitExistingNote[]
): CommitAssociationDecision {
  throw new Error('Not Implemented');
}

/** Validate the schema-version 1 exact-SHA list envelope before interpreting document matches. */
export function validateCommitNotesList(
  _value: unknown,
  _sha: string
): CommitValidation<readonly CommitExistingNote[]> {
  throw new Error('Not Implemented');
}

/** Only an add envelope containing the expected full SHA and exact document can acknowledge a receipt. */
export function validateCommitNotesAdd(
  _value: unknown,
  _sha: string,
  _document: CommitNoteDocument
): CommitValidation<CommitNoteDocument> {
  throw new Error('Not Implemented');
}

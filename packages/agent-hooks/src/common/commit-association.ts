/** Pure notes CLI envelope and duplicate-association decisions; no direct notes-database writes. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { CommitNoteDocument, CommitReceipt, CommitValidation } from './commit-contracts.js';
import { isRecord } from './guards.js';

export interface CommitExistingNote {
  readonly document: unknown;
}

export type CommitAssociationDecision =
  | { readonly kind: 'add'; readonly document: CommitNoteDocument }
  | { readonly kind: 'reuse'; readonly document: CommitNoteDocument; readonly locatorConflict: boolean }
  | { readonly kind: 'reject'; readonly reason: string };

function noteDocument(value: unknown): CommitNoteDocument | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || (value.host !== 'claude' && value.host !== 'codex')) return null;
  if (
    typeof value.sessionId !== 'string' ||
    value.sessionId.length === 0 ||
    value.sessionId.length > 4096 ||
    value.sessionId.includes('\0')
  )
    return null;
  if (Object.keys(value).some((key) => !['schemaVersion', 'host', 'sessionId', 'transcriptLocator'].includes(key)))
    return null;
  if (
    value.transcriptLocator !== undefined &&
    (typeof value.transcriptLocator !== 'string' ||
      value.transcriptLocator.length === 0 ||
      value.transcriptLocator.length > 4096 ||
      value.transcriptLocator.includes('\0'))
  )
    return null;
  return {
    schemaVersion: 1,
    host: value.host,
    sessionId: value.sessionId,
    ...(value.transcriptLocator === undefined ? {} : { transcriptLocator: value.transcriptLocator })
  };
}

/** Scope the cross-invocation claim to canonical common-repository/host/session/full-SHA identity. */
export function commitAssociationKey(receipt: CommitReceipt, document: CommitNoteDocument): string {
  return createHash('sha256')
    .update(JSON.stringify([receipt.repository.commonDirectory, document.host, document.sessionId, receipt.sha]))
    .digest('hex');
}

/** Select an existing matching host/session document, preserving its original optional locator. */
export function selectCommitAssociation(
  document: CommitNoteDocument,
  existing: readonly CommitExistingNote[]
): CommitAssociationDecision {
  if (!noteDocument(document)) return { kind: 'reject', reason: 'invalid association document' };
  const matches: CommitNoteDocument[] = [];
  for (const note of existing) {
    const value = noteDocument(note.document);
    if (value && value.host === document.host && value.sessionId === document.sessionId) matches.push(value);
  }
  const [original, ...others] = matches;
  if (others.length > 0) return { kind: 'reject', reason: 'ambiguous existing commit associations' };
  if (original === undefined) return { kind: 'add', document };
  return {
    kind: 'reuse',
    document: original,
    locatorConflict:
      document.transcriptLocator !== undefined && original.transcriptLocator !== document.transcriptLocator
  };
}

function validateEnvelope(
  value: unknown,
  sha: string,
  operation: 'add' | 'list'
): CommitValidation<readonly CommitExistingNote[]> {
  const reject = (reason: string): CommitValidation<readonly CommitExistingNote[]> => ({ ok: false, reason });
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha) || /^0+$/.test(sha)) return reject('invalid full SHA selection');
  if (!isRecord(value) || value.schema_version !== 1 || value.operation !== operation || !Array.isArray(value.notes))
    return reject('invalid notes CLI envelope');
  const result: CommitExistingNote[] = [];
  const ids = new Set<number>();
  for (const note of value.notes) {
    if (
      !isRecord(note) ||
      typeof note.id !== 'number' ||
      !Number.isSafeInteger(note.id) ||
      note.id <= 0 ||
      ids.has(note.id) ||
      note.commit_sha !== sha ||
      !Object.hasOwn(note, 'document') ||
      note.document === undefined
    ) {
      return reject('invalid exact-SHA notes record');
    }
    ids.add(note.id);
    result.push({ document: note.document });
  }
  return { ok: true, value: result };
}

/** Validate the schema-version 1 exact-SHA list envelope before interpreting document matches. */
export function validateCommitNotesList(value: unknown, sha: string): CommitValidation<readonly CommitExistingNote[]> {
  return validateEnvelope(value, sha, 'list');
}

/** Only an add envelope containing the expected full SHA and exact document can acknowledge a receipt. */
export function validateCommitNotesAdd(
  value: unknown,
  sha: string,
  document: CommitNoteDocument
): CommitValidation<CommitNoteDocument> {
  const envelope = validateEnvelope(value, sha, 'add');
  if (!envelope.ok) return envelope;
  const [acknowledged, ...extra] = envelope.value;
  if (
    acknowledged === undefined ||
    extra.length > 0 ||
    !noteDocument(document) ||
    !isDeepStrictEqual(acknowledged.document, document)
  ) {
    return { ok: false, reason: 'notes acknowledgment does not match frozen document' };
  }
  return { ok: true, value: document };
}

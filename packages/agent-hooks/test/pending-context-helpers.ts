/** Complete native schema fixture shared by pending inspection delivery checks. */
import { type ContextDocument, decodeContextDocument } from '../src/common/touch-core.js';

export function pendingContextDocument(): ContextDocument {
  return decodeContextDocument(
    JSON.stringify({
      schema_version: 2,
      scopes: [],
      mutation: {
        requested: false,
        rewritten: false,
        spans_touched: 0,
        anchors_updated: 0,
        anchors_removed: 0,
        identities_collapsed: 0
      },
      spans: [
        {
          name: 'input-contract',
          evidence_revision: 'a'.repeat(64),
          why: 'Discovery selects intended inputs before strict validation.\n\nKeep the complete explanation.',
          overlaps: [],
          anchors: [
            {
              ordinal: 0,
              id: 'a',
              anchored: { path: 'src/select.ts', extent: { kind: 'lines', start: 10, end: 15 } },
              current: { path: 'src/select.ts', extent: { kind: 'lines', start: 20, end: 25 } },
              status: { code: 'CHANGED' },
              source: 'WORKTREE',
              sources: ['WORKTREE']
            },
            {
              ordinal: 1,
              id: 'b',
              anchored: { path: 'other/validate.ts', extent: { kind: 'whole' } },
              current: { path: 'other/validate.ts', extent: { kind: 'whole' } },
              status: { code: 'FRESH' },
              source: 'WORKTREE',
              sources: ['WORKTREE']
            },
            {
              ordinal: 2,
              id: 'c',
              anchored: { path: 'old.ts', extent: { kind: 'lines', start: 1, end: 2 } },
              current: null,
              status: { code: 'DELETED' },
              source: 'INDEX',
              sources: ['INDEX']
            },
            {
              ordinal: 3,
              id: 'd',
              anchored: { path: 'unavailable.ts', extent: { kind: 'whole' } },
              current: null,
              status: { code: 'CONTENT_UNAVAILABLE', reason: 'IO_ERROR', detail: null },
              source: null,
              sources: []
            }
          ]
        }
      ]
    })
  );
}

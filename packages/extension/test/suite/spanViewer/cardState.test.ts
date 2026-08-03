/**
 * Tests for the persisted per-card open/closed state.
 *
 * The store is the only thing standing between a reader's collapse and the
 * full DOM replacement every posted document performs, and it consumes a value
 * (`getState()`) that is `unknown` by contract -- so both the happy path and
 * every malformed shape are pinned here rather than through the webview, which
 * has no DOM in the extension host.
 *
 * @summary Validation, keying, pruning, and restore tests for `cardState`.
 * @module test/suite/spanViewer/cardState.test
 */

import * as assert from 'node:assert/strict';
import type { PostedDocument } from '../../../src/spanViewer/types.js';
import {
  anchorCardKey,
  CardOpenStore,
  commitCardKey,
  DECLARATION_CARD_KEY,
  documentCardKeys,
  parsePersistedCardState,
  pruneCardState,
  serializeCardState,
  type WebviewStateHost
} from '../../../src/spanViewer/webview/cardState.js';

/** The span every fixture in this file describes. */
const SPAN = 'checkout-flow';

/**
 * A `getState`/`setState` pair backed by a plain field, standing in for the
 * webview API the extension host does not have.
 */
class FakeStateHost implements WebviewStateHost {
  state: unknown;
  writes = 0;

  constructor(initial?: unknown) {
    this.state = initial;
  }

  getState(): unknown {
    return this.state;
  }

  setState(state: unknown): void {
    this.state = state;
    this.writes += 1;
  }
}

/**
 * A posted document carrying the given anchor addresses and commit hashes.
 *
 * @param addresses - Anchor addresses to render cards for.
 * @param hashes - History commit hashes to render entries for.
 * @param uncommitted - Whether the declaration has an uncommitted edit.
 * @returns A document whose cards are exactly those addresses and hashes.
 */
function postedDocument(addresses: string[], hashes: string[] = [], uncommitted = false): PostedDocument {
  const posted: PostedDocument = {
    spanName: SPAN,
    why: 'because',
    stale: false,
    staleReasons: [],
    anchors: addresses.map((address) => ({
      kind: 'changed',
      address,
      path: address.split('#')[0] ?? address,
      range: null
    })),
    history: hashes.map((hash) => ({ hash, date: '2026-07-15T00:00:00Z', summary: 'commit', blocks: [] }))
  };
  if (uncommitted) {
    posted.uncommittedEdit = 'unavailable';
  }
  return posted;
}

describe('spanViewer/cardState', () => {
  describe('keys', () => {
    it('namespaces anchors and commits apart', () => {
      assert.equal(anchorCardKey('src/a.ts#L1-L4'), 'anchor:src/a.ts#L1-L4');
      assert.equal(commitCardKey('abc123'), 'commit:abc123');
      assert.notEqual(anchorCardKey('abc123'), commitCardKey('abc123'));
    });

    // A moved range is a different card: the reader's choice was about the old
    // extent, so the new address must not inherit it.
    it('distinguishes addresses that differ only by range', () => {
      assert.notEqual(anchorCardKey('src/a.ts#L1-L4'), anchorCardKey('src/a.ts#L2-L5'));
    });

    it('enumerates a document in render order', () => {
      const posted = postedDocument(['src/a.ts#L1-L4', 'src/b.ts'], ['deadbee'], true);
      assert.deepEqual(documentCardKeys(posted), [
        DECLARATION_CARD_KEY,
        'anchor:src/a.ts#L1-L4',
        'anchor:src/b.ts',
        'commit:deadbee'
      ]);
    });

    it('omits the declaration key when there is no uncommitted edit', () => {
      assert.deepEqual(documentCardKeys(postedDocument(['src/a.ts'])), ['anchor:src/a.ts']);
    });

    it('enumerates nothing for an empty document', () => {
      assert.deepEqual(documentCardKeys(postedDocument([])), []);
    });
  });

  describe('parsePersistedCardState', () => {
    it('reads back a record written for the same span', () => {
      const raw = { span: SPAN, cards: { 'anchor:src/a.ts': false, 'commit:abc': true } };
      const cards = parsePersistedCardState(raw, SPAN);
      assert.equal(cards.get('anchor:src/a.ts'), false);
      assert.equal(cards.get('commit:abc'), true);
      assert.equal(cards.size, 2);
    });

    it('reads back an empty record', () => {
      assert.equal(parsePersistedCardState({ span: SPAN, cards: {} }, SPAN).size, 0);
    });

    // Absent state is the ordinary first-open case, not a fault.
    it('yields nothing for absent state', () => {
      assert.equal(parsePersistedCardState(undefined, SPAN).size, 0);
      assert.equal(parsePersistedCardState(null, SPAN).size, 0);
    });

    it('yields nothing for a non-object', () => {
      assert.equal(parsePersistedCardState('{}', SPAN).size, 0);
      assert.equal(parsePersistedCardState(7, SPAN).size, 0);
      assert.equal(parsePersistedCardState(true, SPAN).size, 0);
    });

    it('yields nothing for an array', () => {
      assert.equal(parsePersistedCardState([{ span: SPAN, cards: {} }], SPAN).size, 0);
    });

    // A record naming another span must never lay one document's layout over
    // another's, however it came to be in this panel's state.
    it('yields nothing for a record naming a different span', () => {
      const raw = { span: 'other-span', cards: { 'anchor:src/a.ts': false } };
      assert.equal(parsePersistedCardState(raw, SPAN).size, 0);
    });

    it('yields nothing when the span field is missing or not a string', () => {
      assert.equal(parsePersistedCardState({ cards: {} }, SPAN).size, 0);
      assert.equal(parsePersistedCardState({ span: 3, cards: {} }, SPAN).size, 0);
    });

    it('yields nothing when cards is absent or not a plain object', () => {
      assert.equal(parsePersistedCardState({ span: SPAN }, SPAN).size, 0);
      assert.equal(parsePersistedCardState({ span: SPAN, cards: null }, SPAN).size, 0);
      assert.equal(parsePersistedCardState({ span: SPAN, cards: 'open' }, SPAN).size, 0);
      assert.equal(parsePersistedCardState({ span: SPAN, cards: ['open'] }, SPAN).size, 0);
    });

    // One bad entry discards the record whole: a partially-trusted record
    // would apply some choices and silently drop others.
    it('yields nothing when any entry is not a boolean', () => {
      const raw = { span: SPAN, cards: { good: true, bad: 'true' } };
      assert.equal(parsePersistedCardState(raw, SPAN).size, 0);
    });

    it('treats a __proto__ entry as an ordinary key', () => {
      const raw = JSON.parse(`{"span":"${SPAN}","cards":{"__proto__":true,"anchor:src/a.ts":false}}`) as unknown;
      const cards = parsePersistedCardState(raw, SPAN);
      assert.equal(cards.get('__proto__'), true);
      assert.equal(cards.get('anchor:src/a.ts'), false);
      assert.equal(Object.getPrototypeOf({}), Object.prototype);
    });
  });

  describe('serializeCardState', () => {
    it('round-trips through JSON', () => {
      const cards = new Map([
        ['anchor:src/a.ts', false],
        ['commit:abc', true]
      ]);
      const raw = JSON.parse(JSON.stringify(serializeCardState(SPAN, cards))) as unknown;
      assert.deepEqual(parsePersistedCardState(raw, SPAN), cards);
    });

    it('writes a __proto__ key as an own property', () => {
      const record = serializeCardState(SPAN, new Map([['__proto__', true]]));
      assert.equal(Object.hasOwn(record.cards, '__proto__'), true);
      assert.equal(Object.getPrototypeOf(record.cards), Object.prototype);
    });
  });

  describe('pruneCardState', () => {
    it('keeps only the live keys', () => {
      const cards = new Map([
        ['anchor:src/a.ts', false],
        ['anchor:src/gone.ts', true]
      ]);
      const pruned = pruneCardState(cards, ['anchor:src/a.ts', 'anchor:src/new.ts']);
      assert.deepEqual([...pruned], [['anchor:src/a.ts', false]]);
    });

    it('leaves the input untouched', () => {
      const cards = new Map([['anchor:src/a.ts', false]]);
      pruneCardState(cards, []);
      assert.equal(cards.size, 1);
    });
  });

  describe('CardOpenStore', () => {
    it('restores a card the reader closed', () => {
      const host = new FakeStateHost({ span: SPAN, cards: { 'anchor:src/a.ts': false } });
      const store = new CardOpenStore(host);
      store.adopt(postedDocument(['src/a.ts']));
      assert.equal(store.choice('anchor:src/a.ts'), false);
    });

    it('restores a card the reader opened', () => {
      const host = new FakeStateHost({ span: SPAN, cards: { 'commit:abc': true } });
      const store = new CardOpenStore(host);
      store.adopt(postedDocument([], ['abc']));
      assert.equal(store.choice('commit:abc'), true);
    });

    // The signal the caller turns into "measure the body instead".
    it('reports no choice for a card the reader never touched', () => {
      const host = new FakeStateHost({ span: SPAN, cards: { 'anchor:src/a.ts': false } });
      const store = new CardOpenStore(host);
      store.adopt(postedDocument(['src/a.ts', 'src/b.ts']));
      assert.equal(store.choice('anchor:src/b.ts'), undefined);
    });

    it('reports no choice at all when the persisted record is malformed', () => {
      const host = new FakeStateHost({ span: SPAN, cards: { 'anchor:src/a.ts': 'closed' } });
      const store = new CardOpenStore(host);
      store.adopt(postedDocument(['src/a.ts']));
      assert.equal(store.choice('anchor:src/a.ts'), undefined);
    });

    it('reports no choice at all when there is no persisted state', () => {
      const store = new CardOpenStore(new FakeStateHost());
      store.adopt(postedDocument(['src/a.ts']));
      assert.equal(store.choice('anchor:src/a.ts'), undefined);
    });

    it('ignores a record left behind for a different span', () => {
      const host = new FakeStateHost({ span: 'other-span', cards: { 'anchor:src/a.ts': false } });
      const store = new CardOpenStore(host);
      store.adopt(postedDocument(['src/a.ts']));
      assert.equal(store.choice('anchor:src/a.ts'), undefined);
      assert.deepEqual(host.state, { span: SPAN, cards: {} });
    });

    it('records a toggle and persists it immediately', () => {
      const host = new FakeStateHost();
      const store = new CardOpenStore(host);
      store.adopt(postedDocument(['src/a.ts']));
      store.record('anchor:src/a.ts', false);
      assert.equal(store.choice('anchor:src/a.ts'), false);
      assert.deepEqual(host.state, { span: SPAN, cards: { 'anchor:src/a.ts': false } });
    });

    it('carries a recorded toggle into the next render of the same document', () => {
      const host = new FakeStateHost();
      const first = new CardOpenStore(host);
      first.adopt(postedDocument(['src/a.ts']));
      first.record('anchor:src/a.ts', false);

      const second = new CardOpenStore(host);
      second.adopt(postedDocument(['src/a.ts']));
      assert.equal(second.choice('anchor:src/a.ts'), false);
    });

    // A choice about an address the document no longer has is dropped, so the
    // record cannot grow without bound as anchors move.
    it('drops choices about cards the document no longer renders', () => {
      const host = new FakeStateHost({
        span: SPAN,
        cards: { 'anchor:src/a.ts#L1-L4': false, 'anchor:src/a.ts#L9-L12': true }
      });
      const store = new CardOpenStore(host);
      store.adopt(postedDocument(['src/a.ts#L9-L12']));
      assert.equal(store.choice('anchor:src/a.ts#L1-L4'), undefined);
      assert.equal(store.choice('anchor:src/a.ts#L9-L12'), true);
      assert.deepEqual(host.state, { span: SPAN, cards: { 'anchor:src/a.ts#L9-L12': true } });
    });

    it('persists the pruned record on every adopt', () => {
      const host = new FakeStateHost();
      const store = new CardOpenStore(host);
      store.adopt(postedDocument(['src/a.ts']));
      assert.equal(host.writes, 1);
      assert.deepEqual(host.state, { span: SPAN, cards: {} });
    });
  });
});

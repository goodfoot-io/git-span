/**
 * The reader's per-card open/closed choices, persisted across re-renders.
 *
 * Every posted document replaces the whole DOM, so without this a reader who
 * collapsed a noisy anchor would find it open again the moment the file was
 * saved. The store keeps one boolean per card, keyed by anchor address or
 * commit hash, and hands it back on the next render.
 *
 * Three rules define what is stored:
 *
 * - **Choices only, never defaults.** Nothing is written when a card takes the
 *   {@link ./collapseRule.js | rendered-height} default; only a toggle the
 *   reader performed is recorded. Writing defaults would freeze each card's
 *   layout at its first render for the rest of the session -- an anchor that
 *   grew past the threshold on save would stay open forever, which is exactly
 *   what the height rule exists to prevent.
 * - **Open or closed, never a height.** The same diff renders 181px in two
 *   columns and 212px inline, so a persisted height would be wrong the moment
 *   the panel crossed the {@link ./diffLayout.js | side-by-side breakpoint}.
 *   Heights are always re-measured; only the boolean survives.
 * - **Scoped to one span.** `setState` is per webview panel and a custom text
 *   editor's panel is bound to one document for its lifetime, so records
 *   cannot cross spans in practice -- but the webview cannot verify that, so
 *   the span name is stored alongside and a record naming a different span is
 *   discarded rather than applied to the wrong document.
 *
 * State comes back from `getState()` as `unknown` -- it round-trips through
 * JSON and was written by whatever version of this bundle ran last -- so it is
 * validated on the way in, and anything not exactly the expected shape is
 * dropped. Discarding costs the reader their toggles; trusting a malformed
 * record would hide content behind a state nothing on the page explains.
 *
 * Kept free of DOM imports so it runs in the extension host, where the test
 * suite executes and no DOM exists.
 *
 * @summary Persisted open/closed state for span-viewer cards.
 * @module spanViewer/webview/cardState
 */

import type { PostedDocument } from '../types.js';

/**
 * The record as it is written to and read from the webview's persisted state.
 *
 * Plain JSON: `Map` does not survive the `JSON.stringify` VS Code applies to
 * `setState`, so the in-memory `Map` is serialized to an object at the
 * boundary and nowhere else.
 */
export interface PersistedCardState {
  /** The span this record describes; a mismatch discards it. */
  span: string;
  /** Card key to the open state the reader chose for it. */
  cards: Record<string, boolean>;
}

/**
 * The `getState`/`setState` half of the injected `acquireVsCodeApi()` object.
 *
 * Declared structurally so the store can be exercised against a plain fake in
 * the extension host, where no webview API exists.
 */
export interface WebviewStateHost {
  getState(): unknown;
  setState(state: unknown): void;
}

/** The key of the uncommitted-declaration card, of which a document has one. */
export const DECLARATION_CARD_KEY = 'declaration';

/**
 * The state key for an anchor card.
 *
 * Keyed by declared address rather than path: an anchor whose range moves is a
 * different card to the reader, and re-deriving the same key would apply a
 * choice made about different content. The new address is simply unknown, so
 * the card falls back to the height rule.
 *
 * @param address - The anchor's declared address (`path#Lstart-Lend`).
 * @returns The namespaced state key.
 * @throws Never.
 */
export function anchorCardKey(address: string): string {
  return `anchor:${address}`;
}

/**
 * The state key for a history accordion entry.
 *
 * @param hash - The commit's full hash.
 * @returns The namespaced state key.
 * @throws Never.
 */
export function commitCardKey(hash: string): string {
  return `commit:${hash}`;
}

/**
 * Every card key a posted document renders, in document order.
 *
 * The store prunes to this set on each render, so a choice made about an
 * anchor that has since been removed or re-addressed does not accumulate in
 * the persisted record.
 *
 * @param posted - The document about to be rendered.
 * @returns The keys of every card that document produces.
 * @throws Never.
 */
export function documentCardKeys(posted: PostedDocument): string[] {
  const keys: string[] = [];
  if (posted.uncommittedEdit !== undefined) {
    keys.push(DECLARATION_CARD_KEY);
  }
  for (const anchor of posted.anchors) {
    keys.push(anchorCardKey(anchor.address));
  }
  for (const commit of posted.history) {
    keys.push(commitCardKey(commit.hash));
  }
  return keys;
}

/**
 * Validate a value read back from `getState()` into the choices it holds for
 * one span.
 *
 * Everything that is not exactly a {@linkcode PersistedCardState} for `span`
 * -- absent, a primitive, an array, a foreign span, a non-boolean entry --
 * yields an empty map, which leaves every card on the rendered-height rule.
 *
 * @param raw - The value `getState()` returned.
 * @param span - The span being rendered.
 * @returns The reader's choices, empty when the record is unusable.
 * @throws Never.
 */
export function parsePersistedCardState(raw: unknown, span: string): Map<string, boolean> {
  const cards = new Map<string, boolean>();
  if (typeof raw !== 'object' || raw === null) {
    return cards;
  }
  const candidate = raw as { span?: unknown; cards?: unknown };
  if (candidate.span !== span) {
    return cards;
  }
  if (typeof candidate.cards !== 'object' || candidate.cards === null || Array.isArray(candidate.cards)) {
    return cards;
  }
  for (const [key, value] of Object.entries(candidate.cards)) {
    if (typeof value !== 'boolean') {
      return new Map();
    }
    cards.set(key, value);
  }
  return cards;
}

/**
 * Serialize the in-memory choices for `setState`.
 *
 * Built with `Object.fromEntries`, which defines own properties: a card key of
 * `__proto__` becomes an ordinary entry instead of reassigning the object's
 * prototype.
 *
 * @param span - The span the record describes.
 * @param cards - The reader's choices.
 * @returns The JSON-shaped record to persist.
 * @throws Never.
 */
export function serializeCardState(span: string, cards: ReadonlyMap<string, boolean>): PersistedCardState {
  return { span, cards: Object.fromEntries(cards) };
}

/**
 * Drop every choice whose card the document no longer renders.
 *
 * @param cards - The choices read back from persisted state.
 * @param liveKeys - The keys the document about to render produces.
 * @returns A new map holding only the live choices.
 * @throws Never.
 */
export function pruneCardState(cards: ReadonlyMap<string, boolean>, liveKeys: Iterable<string>): Map<string, boolean> {
  const live = new Set(liveKeys);
  const pruned = new Map<string, boolean>();
  for (const [key, open] of cards) {
    if (live.has(key)) {
      pruned.set(key, open);
    }
  }
  return pruned;
}

/**
 * The webview's card-state store: reads the persisted record at the start of
 * each render and records the reader's toggles as they happen.
 */
export class CardOpenStore {
  private readonly host: WebviewStateHost;
  private span = '';
  private cards: Map<string, boolean> = new Map();

  /**
   * Bind the store to the webview's persisted-state API.
   *
   * @param host - The `getState`/`setState` pair to persist through.
   * @throws Never.
   */
  constructor(host: WebviewStateHost) {
    this.host = host;
  }

  /**
   * Adopt the persisted record for a document about to render, pruned to the
   * cards that document actually has.
   *
   * Writes the pruned record straight back, so a span whose anchors churn does
   * not grow an unbounded record of choices about addresses that no longer
   * exist.
   *
   * @param posted - The document about to be rendered.
   * @throws Never.
   */
  adopt(posted: PostedDocument): void {
    this.span = posted.spanName;
    this.cards = pruneCardState(parsePersistedCardState(this.host.getState(), this.span), documentCardKeys(posted));
    this.flush();
  }

  /**
   * The reader's choice for one card.
   *
   * @param key - The card's state key.
   * @returns The chosen open state, or `undefined` when the reader has never
   *   toggled this card -- the caller then applies the rendered-height rule.
   * @throws Never.
   */
  choice(key: string): boolean | undefined {
    return this.cards.get(key);
  }

  /**
   * Record a toggle the reader performed.
   *
   * @param key - The card's state key.
   * @param open - The state the reader put the card into.
   * @throws Never.
   */
  record(key: string, open: boolean): void {
    this.cards.set(key, open);
    this.flush();
  }

  private flush(): void {
    this.host.setState(serializeCardState(this.span, this.cards));
  }
}

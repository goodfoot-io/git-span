/**
 * The anchor renderer must survive a Node with no `Intl` global at all — a
 * build configured `--with-intl=none`. `hooks.json` invokes a bare `node` off
 * the user's `PATH`, so `engines.node` guarantees nothing about the ICU build
 * flag, and the earlier module-scope `new Intl.Segmenter(...)` turned that into
 * a `ReferenceError` at *import*: before any of the hooks' fail-closed
 * `try/catch` blocks existed to catch it, the process exited 1, which Claude
 * Code treats as a non-blocking hook error. The commit gate silently allowed
 * the commit and every drift reminder silently vanished.
 *
 * These tests import the module fresh with `Intl` deleted from `globalThis`.
 * The contract is not "identical output" — column alignment is measured
 * crudely without grapheme segmentation — it is that the module *imports*, the
 * renderer *runs*, and the anchor list is still printed in full.
 *
 * Where a test does compare the two renders byte for byte, the fixture is
 * *all-ASCII*, the one range over which the crude per-code-point measure and
 * grapheme segmentation provably agree; the test names say so. Byte-identity
 * is false in general, and the last test pins that divergence as a fact rather
 * than leaving it implied.
 *
 * Both measures live behind a lazily-built segmenter, so every comparison here
 * must render the with-`Intl` reference *before* `importWithoutIntl()` deletes
 * the global — otherwise the reference builds its segmenter in the deleted
 * world, caches the same `null`, and both sides of the comparison become the
 * no-`Intl` renderer.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAnchorTree as renderWithIntl, type TreeAnchor } from '../../src/common/anchor-tree.js';

const originalIntl = Reflect.getOwnPropertyDescriptor(globalThis, 'Intl');

/** Import a fresh copy of the renderer with `Intl` absent from the global scope. */
async function importWithoutIntl(): Promise<typeof import('../../src/common/anchor-tree.js')> {
  Reflect.deleteProperty(globalThis, 'Intl');
  expect(typeof (globalThis as Record<string, unknown>).Intl).toBe('undefined');
  vi.resetModules();
  return await import('../../src/common/anchor-tree.js');
}

afterEach(() => {
  if (originalIntl !== undefined) Reflect.defineProperty(globalThis, 'Intl', originalIntl);
  vi.resetModules();
});

describe('rendering on a Node built without Intl', () => {
  it('imports without throwing, and on an all-ASCII list matches the with-`Intl` render byte for byte', async () => {
    const anchors: TreeAnchor[] = [
      { path: 'web/checkout.tsx', ranges: [{ range: { kind: 'range', start: 4, end: 6 }, suffix: ' — changed' }] },
      { path: 'api/charge.ts', ranges: [{ range: { kind: 'range', start: 30, end: 76 }, suffix: '' }] }
    ];
    // Rendered while `Intl` is still present — see the header note on laziness.
    const withIntl = renderWithIntl(anchors);
    const { renderAnchorTree } = await importWithoutIntl();

    // Every real anchor path in this repository is ASCII, where the crude
    // per-code-point measure and grapheme segmentation agree exactly. Outside
    // ASCII they do not — see the multi-code-point grapheme test below.
    expect(renderAnchorTree(anchors)).toEqual(withIntl);
    expect(renderAnchorTree(anchors)[0]).toContain('#L4-L6 — changed');
  });

  it('loses only column alignment, never a line, on names it can no longer measure exactly', async () => {
    const { renderAnchorTree } = await importWithoutIntl();

    const lines = renderAnchorTree([
      { path: 'é.ts', ranges: [{ range: { kind: 'range', start: 1, end: 2 }, suffix: '' }] },
      { path: 'abcdefg.ts', ranges: [{ range: { kind: 'range', start: 3, end: 4 }, suffix: '' }] }
    ]);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('#L1-L2');
    expect(lines[1]).toContain('#L3-L4');
  });

  it('renders ASCII whole-file, truncated and bare-path anchors unchanged, since none depend on measurement', async () => {
    const anchors: TreeAnchor[] = [
      { path: 'z.ts', ranges: [{ range: { kind: 'whole-file' }, suffix: ' — changed' }] },
      { path: 'y.ts', ranges: [{ range: { kind: 'truncated' }, suffix: '' }] },
      { path: 'w.ts', ranges: [] }
    ];
    const withIntl = renderWithIntl(anchors);
    const { renderAnchorTree } = await importWithoutIntl();

    expect(renderAnchorTree(anchors)).toEqual([
      '├─ z.ts — changed',
      '├─ y.ts (truncated in source — anchor incomplete)',
      '└─ w.ts'
    ]);
    expect(renderAnchorTree(anchors)).toEqual(withIntl);
  });

  it('pads a multi-code-point grapheme differently from the with-`Intl` render — the accepted cost of not crashing', async () => {
    // A ZWJ emoji sequence is exactly what the fallback cannot measure: it
    // counts each of the sequence's code points, where segmentation counts the
    // whole cluster once. The name is therefore over-measured and its sibling
    // group pads to a different column. Byte-identity is not the contract; not
    // crashing, and never dropping a line, is.
    const anchors: TreeAnchor[] = [
      { path: '👩‍💻dev.ts', ranges: [{ range: { kind: 'range', start: 1, end: 5 }, suffix: '' }] },
      { path: 'abcdefghij.ts', ranges: [{ range: { kind: 'range', start: 7, end: 9 }, suffix: '' }] }
    ];
    const withIntl = renderWithIntl(anchors);
    const { renderAnchorTree } = await importWithoutIntl();
    const withoutIntl = renderAnchorTree(anchors);

    expect(withoutIntl).not.toEqual(withIntl);
    expect(withoutIntl[0]).not.toEqual(withIntl[0]);
    // Both still print every anchor in full — only the column moved.
    expect(withIntl).toHaveLength(2);
    expect(withoutIntl).toHaveLength(2);
    expect(withoutIntl[0]).toContain('👩‍💻dev.ts');
    expect(withoutIntl[0]).toContain('#L1-L5');
    expect(withoutIntl[1]).toContain('#L7-L9');
    // The divergence is padding only: the same tokens, differently spaced.
    expect(withoutIntl[0]?.replace(/ +/gu, ' ')).toEqual(withIntl[0]?.replace(/ +/gu, ' '));
  });
});

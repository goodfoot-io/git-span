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
  it('imports without throwing and renders an all-ASCII list byte-identically', async () => {
    const anchors: TreeAnchor[] = [
      { path: 'web/checkout.tsx', ranges: [{ range: { kind: 'range', start: 4, end: 6 }, suffix: ' — changed' }] },
      { path: 'api/charge.ts', ranges: [{ range: { kind: 'range', start: 30, end: 76 }, suffix: '' }] }
    ];
    const { renderAnchorTree } = await importWithoutIntl();

    // Every real anchor path in this repository is ASCII, where the crude
    // per-code-point measure and grapheme segmentation agree exactly.
    expect(renderAnchorTree(anchors)).toEqual(renderWithIntl(anchors));
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

  it('renders whole-file, truncated and bare-path anchors unchanged, since none depend on measurement', async () => {
    const anchors: TreeAnchor[] = [
      { path: 'z.ts', ranges: [{ range: { kind: 'whole-file' }, suffix: ' — changed' }] },
      { path: 'y.ts', ranges: [{ range: { kind: 'truncated' }, suffix: '' }] },
      { path: 'w.ts', ranges: [] }
    ];
    const { renderAnchorTree } = await importWithoutIntl();

    expect(renderAnchorTree(anchors)).toEqual([
      '├─ z.ts — changed',
      '├─ y.ts (truncated in source — anchor incomplete)',
      '└─ w.ts'
    ]);
    expect(renderAnchorTree(anchors)).toEqual(renderWithIntl(anchors));
  });
});

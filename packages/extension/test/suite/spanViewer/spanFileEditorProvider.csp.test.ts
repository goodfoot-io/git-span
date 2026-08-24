/**
 * Unit tests for the CSP construction shared by both of the span viewer's
 * HTML surfaces (`spanFileEditorProvider.ts`): the nonce source is
 * cryptographic, one builder serves both surfaces, and each surface's policy
 * is pinned byte-for-byte against its pre-extraction form so no future edit
 * can silently diverge them.
 *
 * @summary Unit tests for the shared webview CSP builder.
 * @module test/suite/spanViewer/spanFileEditorProvider.csp.test
 */

import * as assert from 'node:assert';
import type * as vscode from 'vscode';
import { testOnlyBuildCsp, testOnlyMakeNonce } from '../../../src/spanViewer/spanFileEditorProvider.js';

/** Sample nonce standing in for a real `crypto.randomBytes(16)` base64 value. */
const SAMPLE_NONCE = 'SAMPLE+NONCE/Wv3nCE0B9kQ=';
/** Sample `webview.cspSource` origin standing in for VS Code's resource root. */
const SAMPLE_ORIGIN = 'https://mock.csp.source';

/** A minimal `vscode.Webview` stand-in carrying just the field CSP building reads. */
const SAMPLE_WEBVIEW = { cspSource: SAMPLE_ORIGIN } as vscode.Webview;

/** The fallback panel's exact pre-extraction policy (byte-pinned). */
const PANEL_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-SAMPLE+NONCE/Wv3nCE0B9kQ=';";

/** The Monaco webview's exact pre-extraction policy (byte-pinned). */
const WEBVIEW_CSP =
  "default-src 'none'; style-src 'unsafe-inline' https://mock.csp.source; script-src 'nonce-SAMPLE+NONCE/Wv3nCE0B9kQ='; font-src 'self' https://mock.csp.source; worker-src blob:; connect-src https://mock.csp.source; img-src https://mock.csp.source;";

/**
 * Split a serialized CSP into `{ name, value }` directives.
 *
 * @param csp - The serialized CSP header content.
 * @returns One entry per `;`-separated directive.
 */
function directivesOf(csp: string): { name: string; value: string }[] {
  return csp
    .split(';')
    .map((directive) => directive.trim())
    .filter((directive) => directive.length > 0)
    .map((directive) => {
      const [name, ...rest] = directive.split(' ');
      return { name: name ?? '', value: rest.join(' ') };
    });
}

describe('spanFileEditorProvider CSP', () => {
  it('pins both surfaces byte-for-byte against their pre-extraction policies', () => {
    assert.strictEqual(testOnlyBuildCsp(SAMPLE_NONCE, null), PANEL_CSP);
    assert.strictEqual(testOnlyBuildCsp(SAMPLE_NONCE, SAMPLE_WEBVIEW), WEBVIEW_CSP);
  });

  it('embeds the given nonce in every produced policy', () => {
    for (const csp of [testOnlyBuildCsp(SAMPLE_NONCE, null), testOnlyBuildCsp(SAMPLE_NONCE, SAMPLE_WEBVIEW)]) {
      assert.ok(csp.includes(`script-src 'nonce-${SAMPLE_NONCE}'`), `expected nonce-scoped script-src, got: ${csp}`);
      assert.strictEqual(
        csp.split(`'nonce-${SAMPLE_NONCE}'`).length - 1,
        1,
        'expected the nonce to appear exactly once'
      );
    }
  });

  it('sources nonces from crypto, not a PRNG: two calls never collide', () => {
    const nonces = new Set(Array.from({ length: 100 }, () => testOnlyMakeNonce()));
    assert.strictEqual(nonces.size, 100, 'expected 100 draws to yield 100 distinct nonces');
    for (const nonce of nonces) {
      // 16 bytes base64-encodes to exactly 22 alphabet characters plus '==' padding.
      assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/, `expected a 16-byte base64 nonce, got: ${nonce}`);
    }
  });

  it('keeps both surfaces on one covenant: identical apart from the webview-only resource allowances', () => {
    const panel = directivesOf(testOnlyBuildCsp(SAMPLE_NONCE, null));
    const webview = directivesOf(testOnlyBuildCsp(SAMPLE_NONCE, SAMPLE_WEBVIEW));

    // Shared prefix: default-src, style-src (origin-less), script-src -- identical values.
    assert.deepStrictEqual(panel[0], webview[0], 'default-src must be identical');
    assert.strictEqual(panel[1]?.name, 'style-src');
    assert.strictEqual(webview[1]?.name, 'style-src');
    assert.strictEqual(
      webview[1]?.value,
      `${panel[1]?.value} ${SAMPLE_ORIGIN}`,
      'the webview style-src must be exactly the panel style-src plus the resource origin'
    );
    assert.deepStrictEqual(panel[2], webview[2], 'script-src must be identical');

    // The ONLY other differences are the four webview-only resource directives.
    const panelNames = new Set(panel.map(({ name }) => name));
    const webviewNames = new Set(webview.map(({ name }) => name));
    assert.deepStrictEqual([...panelNames].sort(), ['default-src', 'script-src', 'style-src']);
    assert.deepStrictEqual(
      [...webviewNames].filter((name) => !panelNames.has(name)).sort(),
      ['connect-src', 'font-src', 'img-src', 'worker-src'],
      'expected the directive-set delta to be exactly the four resource allowances'
    );
  });
});

/**
 * Tests for the injected-CSS-variable to Monaco-hex color normalizer.
 *
 * @summary Theme color normalization tests.
 * @module test/suite/spanViewer/themeColor.test
 */

import * as assert from 'node:assert';
import { normalizeThemeColor } from '../../../src/spanViewer/webview/themeColor.js';

describe('themeColor', () => {
  describe('normalizeThemeColor', () => {
    describe('rgba() conversion', () => {
      it('converts a fractional alpha to #RRGGBBAA', () => {
        // diffEditor.insertedLineBackground's default: RGBA(155, 185, 85, .2).
        assert.strictEqual(normalizeThemeColor('rgba(155, 185, 85, 0.2)'), '#9bb95533');
      });

      it('converts the removed-line default to the registry hex it mirrors', () => {
        // diffEditor.removedLineBackground is RGBA(255, 0, 0, .2), and
        // diffEditor.removedTextBackground registers the literal '#ff000033'.
        assert.strictEqual(normalizeThemeColor('rgba(255, 0, 0, 0.2)'), '#ff000033');
      });

      it('emits compact #RRGGBB when the color is fully opaque', () => {
        assert.strictEqual(normalizeThemeColor('rgba(18, 52, 86, 1)'), '#123456');
      });

      it('preserves a fully transparent color as alpha 00', () => {
        assert.strictEqual(normalizeThemeColor('rgba(18, 52, 86, 0)'), '#12345600');
      });

      it('accepts rgb() without an alpha channel', () => {
        assert.strictEqual(normalizeThemeColor('rgb(155, 185, 85)'), '#9bb955');
      });

      it('accepts rgba() spelled without an alpha channel', () => {
        assert.strictEqual(normalizeThemeColor('rgba(155, 185, 85)'), '#9bb955');
      });

      it('tolerates absent and irregular whitespace', () => {
        assert.strictEqual(normalizeThemeColor('rgba(155,185,85,0.2)'), '#9bb95533');
        assert.strictEqual(normalizeThemeColor('  rgba(  155 , 185 , 85 , 0.2 )  '), '#9bb95533');
      });

      it('is case insensitive on the function name', () => {
        assert.strictEqual(normalizeThemeColor('RGBA(155, 185, 85, 0.2)'), '#9bb95533');
      });

      it('accepts an alpha written without a leading zero', () => {
        assert.strictEqual(normalizeThemeColor('rgba(18, 52, 86, .5)'), '#12345680');
      });

      it('clamps channels above 255', () => {
        assert.strictEqual(normalizeThemeColor('rgb(999, 300, 0)'), '#ffff00');
      });
    });

    describe('alpha rounding', () => {
      // Math.round(alpha * 255), matching VS Code's own Color.Format.CSS.formatHexA
      // so a normalized value round-trips to the bytes VS Code would have written.
      const cases: ReadonlyArray<readonly [string, string]> = [
        ['0.001', '#12345600'],
        ['0.002', '#12345601'],
        ['0.2', '#12345633'],
        ['0.5', '#12345680'],
        ['0.998', '#123456fe'],
        ['0.999', '#123456ff']
      ];

      for (const [alpha, expected] of cases) {
        it(`rounds alpha ${alpha} to ${expected.slice(7)}`, () => {
          assert.strictEqual(normalizeThemeColor(`rgba(18, 52, 86, ${alpha})`), expected);
        });
      }
    });

    describe('hex passthrough', () => {
      it('passes through the four lengths Monaco parses', () => {
        // Monaco's parseHex accepts exactly #RGB, #RGBA, #RRGGBB, #RRGGBBAA.
        assert.strictEqual(normalizeThemeColor('#abc'), '#abc');
        assert.strictEqual(normalizeThemeColor('#abcd'), '#abcd');
        assert.strictEqual(normalizeThemeColor('#9bb955'), '#9bb955');
        assert.strictEqual(normalizeThemeColor('#9bb95533'), '#9bb95533');
      });

      it('preserves uppercase hex digits unchanged', () => {
        assert.strictEqual(normalizeThemeColor('#9BB95533'), '#9BB95533');
      });

      it('trims surrounding whitespace', () => {
        assert.strictEqual(normalizeThemeColor('  #9bb955  '), '#9bb955');
      });

      it('rejects hex lengths Monaco cannot parse', () => {
        assert.strictEqual(normalizeThemeColor('#ab'), null);
        assert.strictEqual(normalizeThemeColor('#abcde'), null);
        assert.strictEqual(normalizeThemeColor('#abcdefa'), null);
        assert.strictEqual(normalizeThemeColor('#abcdefabc'), null);
      });

      it('rejects non-hex digits that Monaco would silently read as zero', () => {
        // parseHex's _parseHexDigit maps unknown characters to 0, so #gggggg
        // would parse as black rather than fail -- validation must happen here.
        assert.strictEqual(normalizeThemeColor('#gggggg'), null);
        assert.strictEqual(normalizeThemeColor('#12345z'), null);
      });
    });

    describe('rejected values', () => {
      it('returns null for an empty or whitespace-only value', () => {
        // getPropertyValue returns '' for a variable VS Code did not inject.
        assert.strictEqual(normalizeThemeColor(''), null);
        assert.strictEqual(normalizeThemeColor('   '), null);
        assert.strictEqual(normalizeThemeColor('\n\t '), null);
      });

      it('returns null for an alpha outside 0-1', () => {
        assert.strictEqual(normalizeThemeColor('rgba(18, 52, 86, 1.5)'), null);
      });

      it('returns null for color forms VS Code never emits', () => {
        // Unmatched values degrade to Monaco's inherited base palette, which is
        // strictly better than fromHex()'s Color.red fallback.
        assert.strictEqual(normalizeThemeColor('hsl(120, 50%, 50%)'), null);
        assert.strictEqual(normalizeThemeColor('rgb(50%, 20%, 10%)'), null);
        assert.strictEqual(normalizeThemeColor('rgba(18, 52, 86, 20%)'), null);
        assert.strictEqual(normalizeThemeColor('rgb(18 52 86 / 0.2)'), null);
        assert.strictEqual(normalizeThemeColor('transparent'), null);
        assert.strictEqual(normalizeThemeColor('red'), null);
      });

      it('returns null for malformed rgb() syntax', () => {
        assert.strictEqual(normalizeThemeColor('rgb(18, 52)'), null);
        assert.strictEqual(normalizeThemeColor('rgb(18, 52, 86'), null);
        assert.strictEqual(normalizeThemeColor('rgb(18, 52, 86, 0.2, 5)'), null);
        assert.strictEqual(normalizeThemeColor('rgb(-18, 52, 86)'), null);
        assert.strictEqual(normalizeThemeColor('garbage'), null);
      });
    });
  });
});

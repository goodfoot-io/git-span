/**
 * Tests for the collapsible card's disclosure-chevron codicon class.
 *
 * The exact class strings are pinned here rather than imported, so a rename
 * inside the module fails these tests instead of silently shipping a chevron
 * codicon that does not exist in the bundled font.
 *
 * @summary Disclosure chevron icon tests.
 * @module test/suite/spanViewer/disclosureIcon.test
 */

import * as assert from 'node:assert';
import { disclosureIconClass } from '../../../src/spanViewer/webview/disclosureIcon.js';

describe('disclosureIcon', () => {
  describe('disclosureIconClass', () => {
    it('points the chevron down when the card is expanded', () => {
      assert.strictEqual(disclosureIconClass(true), 'codicon codicon-chevron-down');
    });

    it('points the chevron right when the card is collapsed', () => {
      assert.strictEqual(disclosureIconClass(false), 'codicon codicon-chevron-right');
    });

    it('returns a complete class attribute, base codicon class included', () => {
      // The value is assigned straight to className, so it must carry the
      // base `codicon` class that loads the icon font, not just the modifier.
      for (const open of [true, false]) {
        const parts = disclosureIconClass(open).split(' ');
        assert.ok(parts.includes('codicon'), `missing base class for open=${open}`);
        assert.strictEqual(parts.length, 2, `unexpected class count for open=${open}`);
      }
    });

    it('distinguishes the two states', () => {
      assert.notStrictEqual(disclosureIconClass(true), disclosureIconClass(false));
    });
  });
});

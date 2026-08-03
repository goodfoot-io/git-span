/**
 * Tests for the relative + absolute age label shared by the History
 * accordion's commit dates and the "Updated ..." declaration line.
 *
 * The absolute half renders through `toLocaleString` with the host's default
 * locale and time zone, so no assertion here pins its literal text -- doing so
 * would pass only on the machine that wrote it. The composition of the two
 * halves is asserted against a locally computed expectation instead, and the
 * relative half is pinned exactly by injecting `now`.
 *
 * @summary Age label formatting tests.
 * @module test/suite/spanViewer/formatAge.test
 */

import * as assert from 'node:assert';
import { formatAge } from '../../../src/spanViewer/webview/formatAge.js';

/** A fixed instant to measure every relative-age case against. */
const NOW = Date.parse('2026-08-03T12:00:00.000Z');

/**
 * An ISO timestamp exactly `seconds` before {@linkcode NOW}.
 *
 * @param seconds - How far before `NOW` the timestamp should sit.
 * @returns The ISO string for that instant.
 */
function ago(seconds: number): string {
  return new Date(NOW - seconds * 1000).toISOString();
}

/**
 * The absolute half `formatAge` is expected to render for `isoDate`, computed
 * with the same locale-sensitive API so the assertion holds on any host.
 *
 * @param isoDate - The timestamp being labelled.
 * @returns The expected parenthesised absolute rendering.
 */
function absolute(isoDate: string): string {
  return new Date(isoDate).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

describe('formatAge', () => {
  describe('relative half', () => {
    it('reads "just now" below the 45-second threshold', () => {
      assert.strictEqual(formatAge(ago(0), NOW).split(' (')[0], 'just now');
      assert.strictEqual(formatAge(ago(44), NOW).split(' (')[0], 'just now');
    });

    it('switches to minutes at the 45-second threshold', () => {
      assert.strictEqual(formatAge(ago(45), NOW).split(' (')[0], '1 minute ago');
    });

    it('singularises exactly one unit and pluralises the rest', () => {
      assert.strictEqual(formatAge(ago(3600), NOW).split(' (')[0], '1 hour ago');
      assert.strictEqual(formatAge(ago(7200), NOW).split(' (')[0], '2 hours ago');
      assert.strictEqual(formatAge(ago(86400), NOW).split(' (')[0], '1 day ago');
      assert.strictEqual(formatAge(ago(172800), NOW).split(' (')[0], '2 days ago');
    });

    it('crosses each unit boundary into the next scale', () => {
      // One second under each cutoff still reports the smaller unit.
      assert.strictEqual(formatAge(ago(3599), NOW).split(' (')[0], '60 minutes ago');
      assert.strictEqual(formatAge(ago(86399), NOW).split(' (')[0], '24 hours ago');
      assert.strictEqual(formatAge(ago(604799), NOW).split(' (')[0], '7 days ago');
      assert.strictEqual(formatAge(ago(2591999), NOW).split(' (')[0], '4 weeks ago');
      assert.strictEqual(formatAge(ago(31535999), NOW).split(' (')[0], '12 months ago');
    });

    it('reports weeks, months and years on the coarse scales', () => {
      assert.strictEqual(formatAge(ago(604800), NOW).split(' (')[0], '1 week ago');
      assert.strictEqual(formatAge(ago(1814400), NOW).split(' (')[0], '3 weeks ago');
      assert.strictEqual(formatAge(ago(2592000), NOW).split(' (')[0], '1 month ago');
      assert.strictEqual(formatAge(ago(31536000), NOW).split(' (')[0], '1 year ago');
      assert.strictEqual(formatAge(ago(63072000), NOW).split(' (')[0], '2 years ago');
    });

    it('clamps a future timestamp to "just now" rather than a negative age', () => {
      assert.strictEqual(formatAge(ago(-86400), NOW).split(' (')[0], 'just now');
    });
  });

  describe('absolute half', () => {
    it('appends the parenthesised absolute rendering of the same instant', () => {
      const iso = ago(1814400);
      assert.strictEqual(formatAge(iso, NOW), `3 weeks ago (${absolute(iso)})`);
    });

    it('renders the instant it was given, not the reference time', () => {
      const iso = ago(31536000);
      assert.notStrictEqual(absolute(iso), absolute(new Date(NOW).toISOString()));
      assert.ok(formatAge(iso, NOW).endsWith(`(${absolute(iso)})`));
    });
  });

  describe('unparseable input', () => {
    it('echoes a non-date string back verbatim rather than inventing an epoch', () => {
      assert.strictEqual(formatAge('not a date', NOW), 'not a date');
      assert.strictEqual(formatAge('', NOW), '');
    });
  });

  it('defaults the reference time to now when none is given', () => {
    assert.strictEqual(formatAge(new Date().toISOString()).split(' (')[0], 'just now');
  });
});

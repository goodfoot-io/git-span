/**
 * Tests for the `.span` declaration file's last-edited timestamp resolution:
 * which of the two sources leads, how each falls back, and that an
 * unresolvable pair yields `undefined` rather than a fabricated date.
 *
 * The readers are injected so every branch -- including "git is absent and the
 * file cannot be stat'ed", which no real workspace can be coerced into on
 * demand -- is reachable deterministically.
 *
 * @summary Span declaration timestamp resolution tests.
 * @module test/suite/spanViewer/spanTimestamp.test
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readCommittedDate, readMtime, resolveSpanUpdatedAt } from '../../../src/spanViewer/spanTimestamp.js';

const COMMITTED = '2026-07-15T15:58:00.000Z';
const MODIFIED = '2026-08-03T13:12:00.000Z';

/**
 * A reader that always resolves to `value`.
 *
 * @param value - The value to resolve with.
 * @returns A reader returning `value`.
 */
function constant(value: string | null): () => Promise<string | null> {
  return () => Promise.resolve(value);
}

describe('spanTimestamp', () => {
  describe('resolveSpanUpdatedAt', () => {
    const base = { repoRoot: '/repo', relativePath: '.span/my-span' };

    it('prefers the committed date when the declaration is clean', async () => {
      const result = await resolveSpanUpdatedAt({
        ...base,
        dirty: false,
        readCommittedDate: constant(COMMITTED),
        readMtime: constant(MODIFIED)
      });
      assert.strictEqual(result, COMMITTED);
    });

    it('prefers the worktree mtime when the declaration is dirty', async () => {
      const result = await resolveSpanUpdatedAt({
        ...base,
        dirty: true,
        readCommittedDate: constant(COMMITTED),
        readMtime: constant(MODIFIED)
      });
      assert.strictEqual(result, MODIFIED);
    });

    it('falls back to the mtime for an untracked or never-committed declaration', async () => {
      // `git log` exits 0 with empty stdout for an untracked path, which the
      // reader reports as null -- the file exists, so its mtime is genuinely
      // when it was last edited.
      const result = await resolveSpanUpdatedAt({
        ...base,
        dirty: false,
        readCommittedDate: constant(null),
        readMtime: constant(MODIFIED)
      });
      assert.strictEqual(result, MODIFIED);
    });

    it('falls back to the committed date when a dirty declaration cannot be stat-ed', async () => {
      const result = await resolveSpanUpdatedAt({
        ...base,
        dirty: true,
        readCommittedDate: constant(COMMITTED),
        readMtime: constant(null)
      });
      assert.strictEqual(result, COMMITTED);
    });

    it('returns undefined when neither source resolves, never a fabricated date', async () => {
      for (const dirty of [false, true]) {
        const result = await resolveSpanUpdatedAt({
          ...base,
          dirty,
          readCommittedDate: constant(null),
          readMtime: constant(null)
        });
        assert.strictEqual(result, undefined, `Expected undefined with dirty=${dirty}`);
      }
    });

    it('stats the declaration at its repo-root-joined absolute path', async () => {
      let statted: string | null = null;
      await resolveSpanUpdatedAt({
        repoRoot: path.sep === '\\' ? 'C:\\repo' : '/repo',
        relativePath: '.span/nested/my-span',
        dirty: true,
        readCommittedDate: constant(null),
        readMtime: (filePath) => {
          statted = filePath;
          return Promise.resolve(MODIFIED);
        }
      });
      assert.strictEqual(statted, path.join(path.sep === '\\' ? 'C:\\repo' : '/repo', '.span/nested/my-span'));
    });

    it('passes the repo-relative path through to the git reader unchanged', async () => {
      let queried: [string, string] | null = null;
      await resolveSpanUpdatedAt({
        ...base,
        dirty: false,
        readCommittedDate: (repoRoot, relativePath) => {
          queried = [repoRoot, relativePath];
          return Promise.resolve(COMMITTED);
        },
        readMtime: constant(null)
      });
      assert.deepStrictEqual(queried, ['/repo', '.span/my-span']);
    });
  });

  describe('readMtime', () => {
    it('reports an existing file’s mtime as an ISO string', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'span-timestamp-'));
      const filePath = path.join(dir, 'declaration');
      try {
        fs.writeFileSync(filePath, 'contents\n');
        const result = await readMtime(filePath);
        assert.ok(result !== null, 'Expected a stat of an existing file to succeed');
        assert.ok(!Number.isNaN(Date.parse(result)), `Expected a parseable ISO string, got: ${result}`);
        assert.strictEqual(result, new Date(fs.statSync(filePath).mtimeMs).toISOString());
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('reports null for an absent file rather than throwing', async () => {
      assert.strictEqual(await readMtime(path.join(os.tmpdir(), 'span-timestamp-definitely-absent')), null);
    });
  });

  describe('readCommittedDate', () => {
    it('reports null outside a repository rather than throwing', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'span-timestamp-nogit-'));
      try {
        assert.strictEqual(await readCommittedDate(dir, '.span/my-span'), null);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('reports null for a path with no commits inside a real repository', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'span-timestamp-git-'));
      try {
        fs.mkdirSync(path.join(dir, '.git'));
        // A directory named .git without objects is not a usable repository:
        // git exits non-zero, which must surface as null, not a throw.
        assert.strictEqual(await readCommittedDate(dir, '.span/my-span'), null);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

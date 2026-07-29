/**
 * Skipped acceptance checks for mechanical-change.ts (Phase 2 of the TDD
 * bootstrap described in plans/initial.md). Phase 1 declared `Hunk`,
 * `FileDiff`, `MechanicalVerdict`, and stub `parseUnifiedDiff`,
 * `isNeverSpannedPath`, `isMechanicalDiff`, `classifyMechanical` — each
 * throwing `Not Implemented`. This file writes the contract's acceptance
 * checks against those stubs so Phase 3's implementation has a fixed target.
 * Every case here is marked `.skip` — none are expected to run (the stubs
 * throw); Phase 3 unskips them one by one while implementing minimally
 * against each.
 *
 * Test inputs are derived from the validated prototype
 * (`att-b40d4ca0…_classify.ts`, referenced from plans/initial.md) — its exact
 * regexes and hunk-pairing logic produced the plan's measured numbers — but
 * none of that implementation is copied into `mechanical-change.ts` here;
 * that porting is Phase 3's job.
 */

import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  classifyMechanical,
  type FileDiff,
  isMechanicalDiff,
  isNeverSpannedPath,
  parseUnifiedDiff
} from '../../src/common/mechanical-change.js';

const FIXTURES_DIR = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** One repo-relative path's diff, built by hand rather than parsed, for tests targeting classification rules in isolation. */
function fileDiff(overrides: Partial<FileDiff> = {}): FileDiff {
  return { path: 'src/app.ts', hunks: [], binary: false, structural: false, ...overrides };
}

describe('mechanical-change (Phase 2 — skipped acceptance checks)', () => {
  // -------------------------------------------------------------------------
  // parseUnifiedDiff
  // -------------------------------------------------------------------------

  describe('parseUnifiedDiff', () => {
    it('parses a multi-file diff into one FileDiff per file, in order', () => {
      const text = [
        'diff --git a/a.json b/a.json',
        'index 111..222 100644',
        '--- a/a.json',
        '+++ b/a.json',
        '@@ -3 +3 @@',
        '-  "version": "1.0.140",',
        '+  "version": "1.0.141",',
        'diff --git a/b.json b/b.json',
        'index 333..444 100644',
        '--- a/b.json',
        '+++ b/b.json',
        '@@ -3 +3 @@',
        '-  "version": "1.0.140",',
        '+  "version": "1.0.141",'
      ].join('\n');

      const files = parseUnifiedDiff(text);

      expect(files).toHaveLength(2);
      expect(files[0].path).toBe('a.json');
      expect(files[1].path).toBe('b.json');
    });

    it('sets binary: true for a "Binary files ... differ" diff', () => {
      const text = [
        'diff --git a/image.png b/image.png',
        'index 111..222 100644',
        'Binary files a/image.png and b/image.png differ'
      ].join('\n');

      const files = parseUnifiedDiff(text);

      expect(files).toHaveLength(1);
      expect(files[0].binary).toBe(true);
      expect(files[0].hunks).toEqual([]);
    });

    it('sets structural: true for a rename', () => {
      const text = [
        'diff --git a/old-name.ts b/new-name.ts',
        'similarity index 100%',
        'rename from old-name.ts',
        'rename to new-name.ts'
      ].join('\n');

      const files = parseUnifiedDiff(text);

      expect(files).toHaveLength(1);
      expect(files[0].structural).toBe(true);
    });

    it('sets structural: true for a mode-only change', () => {
      const text = ['diff --git a/script.sh b/script.sh', 'old mode 100644', 'new mode 100755'].join('\n');

      const files = parseUnifiedDiff(text);

      expect(files).toHaveLength(1);
      expect(files[0].structural).toBe(true);
      expect(files[0].hunks).toEqual([]);
    });

    it('sets structural: true for a new file', () => {
      const text = [
        'diff --git a/new.ts b/new.ts',
        'new file mode 100644',
        'index 000..111',
        '--- /dev/null',
        '+++ b/new.ts',
        '@@ -0,0 +1 @@',
        '+export const x = 1;'
      ].join('\n');

      const files = parseUnifiedDiff(text);

      expect(files).toHaveLength(1);
      expect(files[0].structural).toBe(true);
    });

    it('sets structural: true for a deleted file', () => {
      const text = [
        'diff --git a/gone.ts b/gone.ts',
        'deleted file mode 100644',
        'index 111..000',
        '--- a/gone.ts',
        '+++ /dev/null',
        '@@ -1 +0,0 @@',
        '-export const x = 1;'
      ].join('\n');

      const files = parseUnifiedDiff(text);

      expect(files).toHaveLength(1);
      expect(files[0].structural).toBe(true);
    });

    it('pairs -U0 hunk removed/added arrays correctly, including multiple hunks in one file', () => {
      const text = [
        'diff --git a/a.json b/a.json',
        'index 111..222 100644',
        '--- a/a.json',
        '+++ b/a.json',
        '@@ -3 +3 @@',
        '-  "version": "1.0.140",',
        '+  "version": "1.0.141",',
        '@@ -10,2 +10,2 @@',
        '-  "a": "1.0.140",',
        '-  "b": "1.0.140",',
        '+  "a": "1.0.141",',
        '+  "b": "1.0.141",'
      ].join('\n');

      const files = parseUnifiedDiff(text);

      expect(files[0].hunks).toHaveLength(2);
      expect(files[0].hunks[0]).toEqual({ removed: ['  "version": "1.0.140",'], added: ['  "version": "1.0.141",'] });
      expect(files[0].hunks[1]).toEqual({
        removed: ['  "a": "1.0.140",', '  "b": "1.0.140",'],
        added: ['  "a": "1.0.141",', '  "b": "1.0.141",']
      });
    });

    it('a file with no hunks (e.g. mode-only) yields an empty hunks array', () => {
      const text = ['diff --git a/script.sh b/script.sh', 'old mode 100644', 'new mode 100755'].join('\n');

      const files = parseUnifiedDiff(text);

      expect(files[0].hunks).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // isMechanicalDiff — content rules, in isolation
  // -------------------------------------------------------------------------

  describe('isMechanicalDiff — semver rewrite', () => {
    it('a bare semver token rewrite is mechanical', () => {
      const file = fileDiff({
        hunks: [{ removed: ['  "version": "1.0.140",'], added: ['  "version": "1.0.141",'] }]
      });

      expect(isMechanicalDiff(file)).toEqual({ mechanical: true });
    });

    it(// Pinned explicitly: the man-page `v1.0.140` form has no word boundary
    // between `v` and the leading digit, so it fails to match without the
    // optional `v` in the semver regex (`/\bv?\d+\.\d+\.\d+.../`). This is
    // the exact case plans/initial.md's Classification rules section calls
    // out as load-bearing.
    'the man-page v1.0.140 form (leading bare "v", no word boundary before the digit) is recognized', () => {
      const thLine = fileDiff({
        hunks: [{ removed: ['.TH git-span 1  "git-span 1.0.140" '], added: ['.TH git-span 1  "git-span 1.0.141" '] }]
      });
      const bareVLine = fileDiff({ hunks: [{ removed: ['v1.0.140'], added: ['v1.0.141'] }] });

      expect(isMechanicalDiff(thLine)).toEqual({ mechanical: true });
      expect(isMechanicalDiff(bareVLine)).toEqual({ mechanical: true });
    });

    it(// The narrow `version:`-field-only variant misses dependency-pin lines
    // like this one (no "version" key at all) — the general token regex is
    // required, not the narrow one, per plans/initial.md's Classification
    // rules section (416 files caught vs. 75).
    'a dependency-pin line ("git-span-linux-x64": "1.0.141") is recognized without a "version" field', () => {
      const file = fileDiff({
        hunks: [
          {
            removed: ['    "git-span-linux-x64": "1.0.140",'],
            added: ['    "git-span-linux-x64": "1.0.141",']
          }
        ]
      });

      expect(isMechanicalDiff(file)).toEqual({ mechanical: true });
    });

    it('a semver rewrite with prerelease/build metadata is mechanical', () => {
      const file = fileDiff({
        hunks: [
          { removed: ['  "version": "1.0.140-beta.1+build.5",'], added: ['  "version": "1.0.141-beta.2+build.6",'] }
        ]
      });

      expect(isMechanicalDiff(file)).toEqual({ mechanical: true });
    });
  });

  describe('isMechanicalDiff — checksum churn', () => {
    it('a checksum field with a hex payload rewrite is mechanical', () => {
      const file = fileDiff({
        hunks: [
          {
            removed: ['  checksum: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
            added: ['  checksum: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']
          }
        ]
      });

      expect(isMechanicalDiff(file)).toEqual({ mechanical: true });
    });

    it('an integrity field with a sha512- payload rewrite is mechanical', () => {
      const file = fileDiff({
        hunks: [
          {
            removed: ['  "integrity": "sha512-aaaaAAAAbbbbBBBBccccCCCCddddDDDDeeeeEEEE=="'],
            added: ['  "integrity": "sha512-ffffFFFFggggGGGGhhhhHHHHiiiiIIIIjjjjJJJJ=="']
          }
        ]
      });

      expect(isMechanicalDiff(file)).toEqual({ mechanical: true });
    });

    it('a resolution field rewrite is mechanical', () => {
      const file = fileDiff({
        hunks: [
          {
            removed: ['  resolution: "foo@npm:1.0.140"'],
            added: ['  resolution: "foo@npm:1.0.141"']
          }
        ]
      });

      expect(isMechanicalDiff(file)).toEqual({ mechanical: true });
    });

    it('a hash field with a sha256- payload rewrite is mechanical', () => {
      const file = fileDiff({
        hunks: [
          {
            removed: ['  hash: "sha256-aaaaAAAAbbbbBBBBccccCCCCddddDDDDeeeeEEEEffffFFFF"'],
            added: ['  hash: "sha256-11112222333344445555666677778888999900001111"']
          }
        ]
      });

      expect(isMechanicalDiff(file)).toEqual({ mechanical: true });
    });

    it('a digest field with a hex payload rewrite is mechanical', () => {
      const file = fileDiff({
        hunks: [
          {
            removed: ['  digest: 0123456789abcdef0123456789abcdef01234567'],
            added: ['  digest: fedcba9876543210fedcba9876543210fedcba9']
          }
        ]
      });

      expect(isMechanicalDiff(file)).toEqual({ mechanical: true });
    });
  });

  describe('isMechanicalDiff — timestamp churn', () => {
    it('an ISO-8601 timestamp rewrite is mechanical', () => {
      const file = fileDiff({
        hunks: [
          {
            removed: ['  "generated": "2024-01-15T10:30:00.000Z"'],
            added: ['  "generated": "2024-06-02T18:12:45.512Z"']
          }
        ]
      });

      expect(isMechanicalDiff(file)).toEqual({ mechanical: true });
    });

    it('a 10-digit epoch timestamp rewrite is mechanical', () => {
      const file = fileDiff({
        hunks: [{ removed: ['  "builtAt": 1700000000'], added: ['  "builtAt": 1712345678'] }]
      });

      expect(isMechanicalDiff(file)).toEqual({ mechanical: true });
    });

    it('a 13-digit epoch (millisecond) timestamp rewrite is mechanical', () => {
      const file = fileDiff({
        hunks: [{ removed: ['  "builtAtMs": 1700000000000'], added: ['  "builtAtMs": 1712345678901'] }]
      });

      expect(isMechanicalDiff(file)).toEqual({ mechanical: true });
    });
  });

  // -------------------------------------------------------------------------
  // isMechanicalDiff — rejections
  // -------------------------------------------------------------------------

  describe('isMechanicalDiff — rejections', () => {
    it('a pure-insertion hunk (0 removed, N added) is rejected as unbalanced', () => {
      const file = fileDiff({ hunks: [{ removed: [], added: ['  "newField": "1.0.141",'] }] });

      const verdict = isMechanicalDiff(file);

      expect(verdict.mechanical).toBe(false);
    });

    it('a pure-deletion hunk (N removed, 0 added) is rejected as unbalanced', () => {
      const file = fileDiff({ hunks: [{ removed: ['  "oldField": "1.0.140",'], added: [] }] });

      const verdict = isMechanicalDiff(file);

      expect(verdict.mechanical).toBe(false);
    });

    it('an N→M hunk where N !== M is rejected as unbalanced', () => {
      // packages/extension/package.json in ad902127: one line reformatted
      // into five — exactly the shape balanced-hunk-count rejects.
      const file = fileDiff({
        hunks: [
          {
            removed: ['  "version": "1.0.140",'],
            added: ['  "version":', '    "1.0.141",', '  "extra": true,', '  "another": 1,', '  "yetMore": 2,']
          }
        ]
      });

      const verdict = isMechanicalDiff(file);

      expect(verdict.mechanical).toBe(false);
    });

    it('a file with zero hunks is rejected', () => {
      const file = fileDiff({ hunks: [] });

      const verdict = isMechanicalDiff(file);

      expect(verdict.mechanical).toBe(false);
    });

    it('a binary file is rejected', () => {
      const file = fileDiff({ binary: true, hunks: [] });

      const verdict = isMechanicalDiff(file);

      expect(verdict.mechanical).toBe(false);
    });

    it('a structural change (rename/add/delete/mode) is rejected', () => {
      const file = fileDiff({ structural: true, hunks: [] });

      const verdict = isMechanicalDiff(file);

      expect(verdict.mechanical).toBe(false);
    });

    it('any hunk containing a genuinely semantic line pair rejects the whole file, even alongside mechanical hunks', () => {
      const file = fileDiff({
        hunks: [
          { removed: ['  "version": "1.0.140",'], added: ['  "version": "1.0.141",'] },
          { removed: ['    "test": "vitest-unchanged",'], added: ['    "test": "vitest run",'] }
        ]
      });

      const verdict = isMechanicalDiff(file);

      expect(verdict.mechanical).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // isNeverSpannedPath
  // -------------------------------------------------------------------------

  describe('isNeverSpannedPath — noise basenames', () => {
    it('matches yarn.lock, Cargo.lock, package-lock.json, and .DS_Store at any depth', () => {
      expect(isNeverSpannedPath('yarn.lock')).toBe(true);
      expect(isNeverSpannedPath('packages/git-span/Cargo.lock')).toBe(true);
      expect(isNeverSpannedPath('package-lock.json')).toBe(true);
      expect(isNeverSpannedPath('packages/foo/.DS_Store')).toBe(true);
    });

    it('matches the remaining seeded lockfile basenames', () => {
      expect(isNeverSpannedPath('pnpm-lock.yaml')).toBe(true);
      expect(isNeverSpannedPath('npm-shrinkwrap.json')).toBe(true);
      expect(isNeverSpannedPath('poetry.lock')).toBe(true);
      expect(isNeverSpannedPath('Pipfile.lock')).toBe(true);
      expect(isNeverSpannedPath('go.sum')).toBe(true);
      expect(isNeverSpannedPath('composer.lock')).toBe(true);
      expect(isNeverSpannedPath('Gemfile.lock')).toBe(true);
      expect(isNeverSpannedPath('flake.lock')).toBe(true);
    });
  });

  describe('isNeverSpannedPath — noise suffixes', () => {
    it('matches .log, .tsbuildinfo, .min.js, .min.css, and .map', () => {
      expect(isNeverSpannedPath('packages/foo/debug.log')).toBe(true);
      expect(isNeverSpannedPath('packages/foo/tsconfig.tsbuildinfo')).toBe(true);
      expect(isNeverSpannedPath('packages/foo/dist/bundle.min.js')).toBe(true);
      expect(isNeverSpannedPath('packages/foo/dist/bundle.min.css')).toBe(true);
      expect(isNeverSpannedPath('packages/foo/dist/bundle.js.map')).toBe(true);
    });
  });

  describe('isNeverSpannedPath — noise segments', () => {
    it('matches node_modules, __pycache__, .cache, and __snapshots__ anywhere in the path', () => {
      expect(isNeverSpannedPath('node_modules/foo/index.js')).toBe(true);
      expect(isNeverSpannedPath('packages/foo/node_modules/bar/index.js')).toBe(true);
      expect(isNeverSpannedPath('scripts/__pycache__/mod.pyc')).toBe(true);
      expect(isNeverSpannedPath('packages/foo/.cache/entry')).toBe(true);
      expect(isNeverSpannedPath('test/__snapshots__/foo.test.ts.snap')).toBe(true);
    });
  });

  describe('isNeverSpannedPath — generated segments', () => {
    it('matches dist, build, out, coverage, and .next anywhere in the path', () => {
      expect(isNeverSpannedPath('packages/agent-hooks/dist/index.js')).toBe(true);
      expect(isNeverSpannedPath('packages/extension/build/main.js')).toBe(true);
      expect(isNeverSpannedPath('packages/cli/out/bin.js')).toBe(true);
      expect(isNeverSpannedPath('coverage/lcov.info')).toBe(true);
      expect(isNeverSpannedPath('packages/website/.next/server/pages.js')).toBe(true);
    });
  });

  describe('isNeverSpannedPath — negative cases', () => {
    it('an ordinary source file is not never-spanned', () => {
      expect(isNeverSpannedPath('packages/foo/src/bar.ts')).toBe(false);
    });

    it('a package.json is not never-spanned (it is not a lockfile)', () => {
      expect(isNeverSpannedPath('packages/foo/package.json')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // classifyMechanical — composition
  // -------------------------------------------------------------------------

  describe('classifyMechanical — composition', () => {
    it('a path on the category list is mechanical regardless of content, even content the content layer would reject', () => {
      // A lockfile carries no implicit dependency worth a span regardless of
      // its contents — a real dependency addition (unbalanced hunk, which
      // isMechanicalDiff alone would reject) is still suppressed by path
      // shape alone.
      const file = fileDiff({
        path: 'yarn.lock',
        hunks: [{ removed: [], added: ['"new-dependency@npm:^2.0.0":', '  version: 2.0.0'] }]
      });

      expect(classifyMechanical(file)).toEqual({ mechanical: true });
    });

    it('a non-category path falls through to the content layer and is judged by its diff', () => {
      const mechanicalFile = fileDiff({
        path: 'packages/foo/package.json',
        hunks: [{ removed: ['  "version": "1.0.140",'], added: ['  "version": "1.0.141",'] }]
      });
      const semanticFile = fileDiff({
        path: 'packages/foo/package.json',
        hunks: [{ removed: ['    "test": "vitest-unchanged",'], added: ['    "test": "vitest run",'] }]
      });

      expect(classifyMechanical(mechanicalFile)).toEqual({ mechanical: true });
      expect(classifyMechanical(semanticFile).mechanical).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // classifyMechanical — accepted decision
  // -------------------------------------------------------------------------

  describe('classifyMechanical — accepted decisions', () => {
    it(// Accepted decision, not a bug (commit e4fb3baf): the single build-config
    // version pin in the entire history is the intended reading of "obvious
    // version bump" per plans/initial.md's Classification rules section.
    ".devcontainer/Dockerfile's ARG SCCACHE_VERSION bump classifies mechanical (per commit e4fb3baf)", () => {
      const file = fileDiff({
        path: '.devcontainer/Dockerfile',
        hunks: [{ removed: ['ARG SCCACHE_VERSION=0.10.0'], added: ['ARG SCCACHE_VERSION=0.15.0'] }]
      });

      expect(classifyMechanical(file)).toEqual({ mechanical: true });
    });
  });

  // -------------------------------------------------------------------------
  // Regression fixture — commit 79030d00 (a real release-bump commit)
  // -------------------------------------------------------------------------

  describe('classifyMechanical — regression fixture from commit 79030d00', () => {
    it(// Built from `git diff -U0 -M 79030d00^ 79030d00` (checked into
    // fixtures/79030d00.diff verbatim, no line content altered). Of the 20
    // files this release-bump commit touched, 18 are pure semver/version-pin
    // churn; the two genuinely semantic edits — a `-m` flag removed from a
    // test helper's `execFileSync` call, and `packages/discover`'s `test`
    // script changed from a stub to `vitest run` — must still be flagged.
    'classifies 18 of 20 files mechanical, leaving exactly porcelain-contract.test.ts and discover/package.json flagged', () => {
      const diffText = fs.readFileSync(nodePath.join(FIXTURES_DIR, '79030d00.diff'), 'utf8');
      const files = parseUnifiedDiff(diffText);

      expect(files).toHaveLength(20);

      const mechanical = files.filter((f) => classifyMechanical(f).mechanical);
      const semantic = files.filter((f) => !classifyMechanical(f).mechanical);

      expect(mechanical).toHaveLength(18);
      expect(semantic.map((f) => f.path).sort()).toEqual(
        ['packages/agent-hooks/test/common/porcelain-contract.test.ts', 'packages/discover/package.json'].sort()
      );
    });
  });
});

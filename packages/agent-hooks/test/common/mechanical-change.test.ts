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
  isClassifiablePath,
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
    it('matches .tsbuildinfo, .min.js, .min.css, and .map', () => {
      expect(isNeverSpannedPath('packages/foo/tsconfig.tsbuildinfo')).toBe(true);
      expect(isNeverSpannedPath('packages/foo/dist/bundle.min.js')).toBe(true);
      expect(isNeverSpannedPath('packages/foo/dist/bundle.min.css')).toBe(true);
      expect(isNeverSpannedPath('packages/foo/dist/bundle.js.map')).toBe(true);
    });

    it('does not match .log — a tracked log can be a hand-authored fixture', () => {
      expect(isNeverSpannedPath('packages/foo/debug.log')).toBe(false);
      expect(isNeverSpannedPath('packages/foo/test/fixtures/sample.log')).toBe(false);
    });

    // The suffixes above are only reachable because the category layer runs
    // ahead of the manifest gate. While the gate came first, a `.map` was
    // refused as non-manifest-shaped before its suffix was ever tested, and
    // these `isNeverSpannedPath` assertions passed while the composed verdict
    // was the opposite — the suite read as covering behavior no user saw.
    it('suppresses minified output and sourcemaps through the composed verdict, not just the inner layer', () => {
      for (const path of [
        'packages/foo/dist/bundle.min.js',
        'packages/foo/dist/bundle.min.css',
        'packages/foo/dist/bundle.js.map',
        'packages/foo/tsconfig.tsbuildinfo'
      ]) {
        const file = fileDiff({
          path,
          hunks: [{ removed: ['export const a=1;'], added: ['export const a=1,b=2;'] }]
        });
        expect(classifyMechanical(file).mechanical).toBe(true);
      }
    });

    it('reports a .log through the composed verdict', () => {
      const file = fileDiff({
        path: 'packages/foo/test/fixtures/sample.log',
        hunks: [{ removed: ['2024-01-01 ok'], added: ['2024-01-02 ok'] }]
      });
      expect(classifyMechanical(file).mechanical).toBe(false);
    });
  });

  describe('isNeverSpannedPath — noise segments', () => {
    it('matches only vendored segments nobody hand-writes into', () => {
      expect(isNeverSpannedPath('node_modules/foo/index.js')).toBe(true);
      expect(isNeverSpannedPath('packages/foo/node_modules/bar/index.js')).toBe(true);
      expect(isNeverSpannedPath('scripts/__pycache__/mod.pyc')).toBe(true);
    });
  });

  describe('isNeverSpannedPath — segments that can shadow hand-written files', () => {
    // A match here is unconditional, content-blind silence, so the bar for
    // listing a segment is "nobody could plausibly hand-author under this
    // name". `dist`, `build`, `out`, `coverage`, and `.next` all fail that
    // bar — this repo tracks hand-written esbuild drivers under
    // `packages/extension/scripts/build/` — and `.cache`/`__snapshots__`
    // fail it too, since a snapshot can encode a real contract. They were
    // seeded from `packages/discover/src/scan.ts`, where a match only means
    // "skip while indexing" rather than "stay silent forever".
    it('does not match generated-output segment names', () => {
      expect(isNeverSpannedPath('packages/agent-hooks/dist/index.js')).toBe(false);
      expect(isNeverSpannedPath('packages/extension/build/main.js')).toBe(false);
      expect(isNeverSpannedPath('packages/cli/out/bin.js')).toBe(false);
      expect(isNeverSpannedPath('coverage/lcov.info')).toBe(false);
      expect(isNeverSpannedPath('packages/website/.next/server/pages.js')).toBe(false);
    });

    it('does not match .cache or __snapshots__', () => {
      expect(isNeverSpannedPath('packages/foo/.cache/entry')).toBe(false);
      expect(isNeverSpannedPath('test/__snapshots__/foo.test.ts.snap')).toBe(false);
    });

    it('still suppresses minified and sourcemap output under a generated dir', () => {
      // The suffix rules, not the segment name, are what carry generated
      // output — a `.min.js` or `.map` cannot be hand-authored source.
      expect(isNeverSpannedPath('packages/foo/dist/bundle.min.js')).toBe(true);
      expect(isNeverSpannedPath('packages/foo/dist/bundle.js.map')).toBe(true);
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
  // Negative corpus — semantic edits the first implementation suppressed
  // -------------------------------------------------------------------------

  describe('classifyMechanical — semantic single-line edits must stay flagged', () => {
    // Every input here is a real semantic edit the shipped rules classified
    // mechanical (finding 1). Buffer sizes, timeouts/TTLs, pinned API
    // date-versions, hostnames, and version-comparison constants are exactly
    // the values most likely to carry an implicit coupling.
    const cases: Array<[label: string, removed: string, added: string]> = [
      ['a buffer-size constant', 'const MAX_BYTES = 1073741824;', 'const MAX_BYTES = 2147483648;'],
      ['a 10-digit timeout', '  timeoutMs: 1000000000,', '  timeoutMs: 5000000000,'],
      ['a 13-digit TTL', 'const TTL = 1000000000000;', 'const TTL = 9000000000000;'],
      ['a pinned API date-version', "  apiVersion: '2024-01-01',", "  apiVersion: '2025-06-01',"],
      // Narrow on purpose: only an IP edit leaving the *final* octet untouched
      // was ever suppressed — SEMVER_RE consumes three octets, so a trailing-octet
      // change survived the mask and was already flagged.
      ['an IP literal whose final octet is unchanged', 'host = "192.168.2.1"', 'host = "192.168.1.1"'],
      ['a version-comparison constant', 'if (v === "1.2.3") allow();', 'if (v === "9.9.9") allow();']
    ];

    for (const [label, removed, added] of cases) {
      it(`${label} in a .ts source file is not mechanical`, () => {
        const file = fileDiff({ path: 'packages/foo/src/limits.ts', hunks: [{ removed: [removed], added: [added] }] });

        expect(classifyMechanical(file).mechanical).toBe(false);
      });

      it(`${label} is refused by the content rules themselves, not only by the manifest gate`, () => {
        // Pinned separately so the narrowing of TIMESTAMP_RE and SEMVER_RE is
        // load-bearing on its own: calling isMechanicalDiff directly bypasses
        // classifyMechanical's path gate, so only the line rules can reject.
        // (The path is non-manifest so the semver rule's line-shape gate also
        // applies — inside a manifest a dotted triple *is* a version pin.)
        const file = fileDiff({ path: 'config/limits.conf', hunks: [{ removed: [removed], added: [added] }] });

        expect(isMechanicalDiff(file).mechanical).toBe(false);
      });
    }
  });

  describe('classifyMechanical — the content layer is gated on a manifest allowlist', () => {
    it('refuses any non-manifest path even when the diff content would match a rule', () => {
      // Fail-closed: an extension nobody enumerated (.kt, .tf, .proto) is
      // refused for the same reason a .ts file is — not because it appears on a
      // list, but because it does not appear on the allowlist.
      const mechanicalLooking = { removed: ['  "version": "1.0.140",'], added: ['  "version": "1.0.141",'] };
      for (const path of [
        'src/a.ts',
        'src/a.tsx',
        'src/a.js',
        'src/a.mjs',
        'src/a.cjs',
        'src/a.rs',
        'README.md',
        'docs/a.mdx',
        'scripts/a.sh',
        '.github/workflows/ci.yml',
        'config/a.yaml',
        'src/a.css',
        'site/a.html',
        'src/Main.kt',
        'infra/main.tf',
        'proto/api.proto',
        'tsconfig.json',
        'packages/foo/config.json'
      ]) {
        expect(classifyMechanical(fileDiff({ path, hunks: [mechanicalLooking] })).mechanical).toBe(false);
      }
    });

    it('admits the manifest, lockfile, man-page, and Dockerfile shapes the classifier exists to suppress', () => {
      expect(isClassifiablePath('packages/foo/package.json')).toBe(true);
      expect(isClassifiablePath('packages/git-span/Cargo.toml')).toBe(true);
      expect(isClassifiablePath('packages/git-span/Cargo.lock')).toBe(true);
      expect(isClassifiablePath('packages/git-span/man/git-span.1')).toBe(true);
      expect(isClassifiablePath('.devcontainer/Dockerfile')).toBe(true);
      expect(isClassifiablePath('plugins-claude/git-span/.claude-plugin/plugin.json')).toBe(true);
      expect(isClassifiablePath('.claude-plugin/marketplace.json')).toBe(true);
      expect(isClassifiablePath('packages/foo/src/bar.ts')).toBe(false);
      expect(isClassifiablePath('plugins-claude/git-span/hooks/bin/advisor.mjs')).toBe(false);
    });

    it('a hand-authored script under build/ is refused by both layers independently', () => {
      // packages/extension/scripts/build/build-production.js is a tracked,
      // hand-authored esbuild script whose only change here is version-shaped —
      // so the content rules alone would call it mechanical. Two independent
      // defenses must each refuse it, and this asserts both rather than
      // relying on either:
      //   1. the segment list no longer matches `build/` at all, so the
      //      category layer cannot short-circuit it content-blind; and
      //   2. the path is not manifest-shaped, so the allowlist gate refuses
      //      it before any line rule runs.
      // Defense 1 is what makes hoisting isNeverSpannedPath ahead of the diff
      // read safe: hoisting a predicate that still matched `build/` would turn
      // today's intermittent suppression into a deterministic one.
      const file = fileDiff({
        path: 'packages/extension/scripts/build/build-production.js',
        hunks: [{ removed: ['  "version": "1.0.140",'], added: ['  "version": "1.0.141",'] }]
      });

      expect(isNeverSpannedPath(file.path)).toBe(false);
      expect(isClassifiablePath(file.path)).toBe(false);
      expect(classifyMechanical(file).mechanical).toBe(false);
    });

    it('a lockfile still short-circuits the category layer, since a lockfile is allowlisted', () => {
      const file = fileDiff({ path: 'packages/foo/yarn.lock', hunks: [] });

      expect(classifyMechanical(file)).toEqual({ mechanical: true });
    });
  });

  // -------------------------------------------------------------------------
  // parseUnifiedDiff — dash/plus-leading content lines (finding 2)
  // -------------------------------------------------------------------------

  describe('parseUnifiedDiff — content lines beginning with -- or ++', () => {
    it('records a deleted bare "---" line that is a hunk\'s sole non-mechanical content', () => {
      // The exact trigger, and it is narrow: the eaten dash line must be the
      // *only* non-mechanical content in the hunk. A genuine 2-removed/1-added
      // deletion is then fabricated into a balanced 1/1 semver pair — the
      // parser manufacturing the very balance the balanced-hunk rule exists to
      // refuse. The companion check below pins the adjacent shape that does not
      // fire, so this pair marks the boundary rather than just the defect.
      const text = [
        'diff --git a/docs/ci.md b/docs/ci.md',
        'index 111..222 100644',
        '--- a/docs/ci.md',
        '+++ b/docs/ci.md',
        '@@ -2,2 +2 @@ title: CI & git integration',
        '-version: 1.0.140',
        '----',
        '+version: 1.0.141'
      ].join('\n');

      const files = parseUnifiedDiff(text);

      expect(files).toHaveLength(1);
      expect(files[0].hunks).toHaveLength(1);
      // The counts are the assertion that matters — they are what the guard
      // corrupted, and a verdict-only check would pass against a parser that got
      // them wrong for a compensating reason.
      expect(files[0].hunks[0].removed).toHaveLength(2);
      expect(files[0].hunks[0].added).toHaveLength(1);
      expect(files[0].hunks[0]).toEqual({ removed: ['version: 1.0.140', '---'], added: ['version: 1.0.141'] });
      // Unbalanced once the deletion is recorded — rejected by the content rules
      // alone, independently of classifyMechanical's manifest gate.
      expect(isMechanicalDiff(files[0]).mechanical).toBe(false);
    });

    it('a dash-line deletion alongside surviving semantic content is already unbalanced (boundary companion)', () => {
      // This adjacent shape does *not* trigger the defect: the surviving
      // semantic line leaves the hunk 2-removed vs 1-added even after the dash
      // line is eaten, so it was flagged before the parser fix too. Recorded to
      // keep the trigger's narrowness explicit.
      const text = [
        'diff --git a/docs/ci.md b/docs/ci.md',
        'index 111..222 100644',
        '--- a/docs/ci.md',
        '+++ b/docs/ci.md',
        '@@ -2,3 +2 @@ title: CI',
        '-version: 1.0.140',
        '----',
        '-Do not remove the sentinel; loader.ts parses up to it.',
        '+version: 1.0.141'
      ].join('\n');

      const files = parseUnifiedDiff(text);

      expect(files[0].hunks[0].removed).toHaveLength(3);
      expect(files[0].hunks[0].added).toHaveLength(1);
      expect(isMechanicalDiff(files[0]).mechanical).toBe(false);
    });

    it('records --/++-leading lines as content in a balanced hunk (CSS custom properties, CLI flags)', () => {
      const text = [
        'diff --git a/theme.txt b/theme.txt',
        'index 111..222 100644',
        '--- a/theme.txt',
        '+++ b/theme.txt',
        '@@ -1,2 +1,2 @@',
        '---accent: #111;',
        '---radius: 2px;',
        '+++accent: #222;',
        '+++radius: 4px;'
      ].join('\n');

      const files = parseUnifiedDiff(text);

      expect(files[0].hunks).toHaveLength(1);
      expect(files[0].hunks[0]).toEqual({
        removed: ['--accent: #111;', '--radius: 2px;'],
        added: ['++accent: #222;', '++radius: 4px;']
      });
      expect(isMechanicalDiff(files[0]).mechanical).toBe(false);
    });

    it('still parses file headers and hunk headers correctly when no hunk is open', () => {
      const text = [
        'diff --git a/a.json b/a.json',
        'index 111..222 100644',
        '--- a/a.json',
        '+++ b/a.json',
        '@@ -3 +3 @@',
        '-  "version": "1.0.140",',
        '+  "version": "1.0.141",'
      ].join('\n');

      const files = parseUnifiedDiff(text);

      expect(files).toHaveLength(1);
      expect(files[0].path).toBe('a.json');
      expect(files[0].hunks).toHaveLength(1);
      expect(files[0].hunks[0].removed).toHaveLength(1);
      expect(files[0].hunks[0].added).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Rule gates (findings 1)
  // -------------------------------------------------------------------------

  describe('isMechanicalDiff — rule gates', () => {
    it('masks an epoch integer only on a line naming a time', () => {
      const timestamped = fileDiff({
        path: 'meta.conf',
        hunks: [{ removed: ['  builtAt: 1700000000'], added: ['  builtAt: 1712345678'] }]
      });
      const plainNumber = fileDiff({
        path: 'meta.conf',
        hunks: [{ removed: ['  maxBytes: 1700000000'], added: ['  maxBytes: 1712345678'] }]
      });

      expect(isMechanicalDiff(timestamped)).toEqual({ mechanical: true });
      expect(isMechanicalDiff(plainNumber).mechanical).toBe(false);
    });

    it('masks a semver only in a version-adjacent context or a manifest-shaped path', () => {
      const bareTripleInProse = fileDiff({
        path: 'notes.txt',
        hunks: [{ removed: ['see section 1.2.3 for details'], added: ['see section 9.9.9 for details'] }]
      });
      const manifest = fileDiff({
        path: 'packages/foo/package.json',
        hunks: [{ removed: ['    "git-span-linux-x64": "1.0.140",'], added: ['    "git-span-linux-x64": "1.0.141",'] }]
      });

      expect(isMechanicalDiff(bareTripleInProse).mechanical).toBe(false);
      expect(isMechanicalDiff(manifest)).toEqual({ mechanical: true });
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

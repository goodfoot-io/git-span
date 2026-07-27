/**
 * Behavioral tests for {@link buildPathExtractor}: every recognized token
 * form, anchor syntax, punctuation stripping, ambiguous/unique resolution,
 * range clamping, relative-path resolution, and dedup/order guarantees.
 *
 * @summary Tests for repo-path extraction from free text.
 */

import { describe, expect, it } from 'vitest';
import { buildPathExtractor } from '../src/paths.js';
import type { RepoScan } from '../src/types.js';

/**
 * Splits fixture content into the line array a real scan would store,
 * without producing a spurious trailing empty line.
 *
 * @param text - Fixture file content to split.
 * @returns The content split on `\n`, one entry per line.
 */
function linesOf(text: string): string[] {
  return text.split('\n');
}

/**
 * Builds a minimal {@link RepoScan} for a fixed set of files. `textFiles`
 * supplies content for files that should be scannable; files present only
 * in `files` simulate binary/asset entries with no text or line data.
 *
 * @param files - Every tracked file path the fixture scan should list.
 * @param textFiles - Content for the subset of `files` that should be scannable.
 * @returns A minimal RepoScan built from the given files and content.
 */
function makeScan(files: readonly string[], textFiles: Readonly<Record<string, string>> = {}): RepoScan {
  const text = new Map<string, string>();
  const lines = new Map<string, readonly string[]>();
  for (const [path, content] of Object.entries(textFiles)) {
    text.set(path, content);
    lines.set(path, linesOf(content));
  }
  const topLevelDirs = new Set<string>();
  for (const file of files) {
    const slash = file.indexOf('/');
    if (slash > 0) {
      topLevelDirs.add(file.slice(0, slash));
    }
  }
  return {
    root: '/repo',
    files: [...files].sort(),
    text,
    lines,
    topLevelDirs,
    docsDirs: ['documentation/']
  };
}

const FILES = [
  'packages/foo/bar.ts',
  'packages/foo/baz.ts',
  'packages/alpha/shared.ts',
  'packages/beta/shared.ts',
  'tools/span-recovery/recover_spans.py',
  'documentation/guide.md',
  'documentation/setup/quick.md',
  'documentation/setup/steps.md',
  'scripts/deploy.sh',
  'packages/legacy/scripts/build.sh',
  'public/logo.png'
];

const TEXT_FILES = {
  'packages/foo/bar.ts': Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n'),
  'packages/foo/baz.ts': ['line 1', 'line 2', 'line 3'].join('\n')
};

const scan = makeScan(FILES, TEXT_FILES);
const extract = buildPathExtractor(scan);

describe('buildPathExtractor', () => {
  describe('token form (a): topLevelDir-prefixed relative path', () => {
    it('resolves a path rooted directly at a topLevelDir', () => {
      const refs = extract('see packages/foo/bar.ts for details');
      expect(refs).toEqual([{ raw: 'packages/foo/bar.ts', loc: { path: 'packages/foo/bar.ts' } }]);
    });
  });

  describe('token form (b): absolute-style /<topLevelDir>/... markdown-link form', () => {
    it('strips the leading slash and resolves', () => {
      const refs = extract('[bar](/packages/foo/bar.ts)');
      expect(refs).toEqual([{ raw: '/packages/foo/bar.ts', loc: { path: 'packages/foo/bar.ts' } }]);
    });

    it('drops a leading-slash token whose first segment is not a topLevelDir', () => {
      const refs = extract('see /etc/passwd for nothing relevant');
      expect(refs).toEqual([]);
    });
  });

  describe('token form (c): relative ./ or ../ resolved against basePath', () => {
    it('resolves ./ against the directory of basePath', () => {
      const refs = extract('see ./steps.md', 'documentation/setup/quick.md');
      expect(refs).toEqual([{ raw: './steps.md', loc: { path: 'documentation/setup/steps.md' } }]);
    });

    it('resolves ../ against the directory of basePath', () => {
      const refs = extract('see ../guide.md', 'documentation/setup/steps.md');
      expect(refs).toEqual([{ raw: '../guide.md', loc: { path: 'documentation/guide.md' } }]);
    });

    it('resolves relative tokens against the repo root when basePath is omitted', () => {
      const refs = extract('see ./documentation/guide.md');
      expect(refs).toEqual([{ raw: './documentation/guide.md', loc: { path: 'documentation/guide.md' } }]);
    });
  });

  describe('token form (d): bare name.ext resolved by unique basename', () => {
    it('resolves a long enough bare filename that matches exactly one file', () => {
      const refs = extract('run recover_spans.py to regenerate candidates');
      expect(refs).toEqual([{ raw: 'recover_spans.py', loc: { path: 'tools/span-recovery/recover_spans.py' } }]);
    });

    it('does not resolve a bare token shorter than 8 characters', () => {
      const refs = extract('edit a.ts now');
      expect(refs).toEqual([]);
    });

    it('does not resolve a bare token without a file-like extension', () => {
      const refs = extract('the identifier longtoken has no extension');
      expect(refs).toEqual([]);
    });
  });

  describe('trailing anchors parsed into start/end', () => {
    it('parses #L<start> with no range as start === end', () => {
      const refs = extract('packages/foo/bar.ts#L4');
      expect(refs).toEqual([{ raw: 'packages/foo/bar.ts', loc: { path: 'packages/foo/bar.ts', start: 4, end: 4 } }]);
    });

    it('parses #L<start>-L<end>', () => {
      const refs = extract('packages/foo/bar.ts#L2-L5');
      expect(refs).toEqual([{ raw: 'packages/foo/bar.ts', loc: { path: 'packages/foo/bar.ts', start: 2, end: 5 } }]);
    });

    it('parses #L<start>-<end> (no L on the end number)', () => {
      const refs = extract('packages/foo/bar.ts#L2-5');
      expect(refs).toEqual([{ raw: 'packages/foo/bar.ts', loc: { path: 'packages/foo/bar.ts', start: 2, end: 5 } }]);
    });

    it('parses :<start> with no range as start === end', () => {
      const refs = extract('packages/foo/bar.ts:3');
      expect(refs).toEqual([{ raw: 'packages/foo/bar.ts', loc: { path: 'packages/foo/bar.ts', start: 3, end: 3 } }]);
    });

    it('parses :L<start>-L<end>', () => {
      const refs = extract('packages/foo/bar.ts:L2-L9');
      expect(refs).toEqual([{ raw: 'packages/foo/bar.ts', loc: { path: 'packages/foo/bar.ts', start: 2, end: 9 } }]);
    });
  });

  describe('trailing punctuation stripped before matching', () => {
    it('strips a sentence-ending period', () => {
      const refs = extract('see packages/foo/bar.ts.');
      expect(refs).toEqual([{ raw: 'packages/foo/bar.ts', loc: { path: 'packages/foo/bar.ts' } }]);
    });

    it('strips a trailing comma and enclosing punctuation', () => {
      const refs = extract('(packages/foo/bar.ts), also packages/foo/baz.ts;');
      expect(refs).toEqual([
        { raw: 'packages/foo/bar.ts', loc: { path: 'packages/foo/bar.ts' } },
        { raw: 'packages/foo/baz.ts', loc: { path: 'packages/foo/baz.ts' } }
      ]);
    });
  });

  describe('resolution: exact vs. unique suffix vs. ambiguous', () => {
    it('resolves a non-exact token that is a unique suffix of exactly one file', () => {
      const refs = extract('run scripts/build.sh to compile');
      expect(refs).toEqual([{ raw: 'scripts/build.sh', loc: { path: 'packages/legacy/scripts/build.sh' } }]);
    });

    it('drops a bare basename that matches more than one file', () => {
      const refs = extract('shared.ts holds the common bits');
      expect(refs).toEqual([]);
    });
  });

  describe('range clamping against scan.lines', () => {
    it('clamps end to the line count when it overshoots', () => {
      const refs = extract('packages/foo/baz.ts#L2-L10');
      expect(refs).toEqual([{ raw: 'packages/foo/baz.ts', loc: { path: 'packages/foo/baz.ts', start: 2, end: 3 } }]);
    });

    it('drops the range entirely when start exceeds the line count', () => {
      const refs = extract('packages/foo/baz.ts#L5');
      expect(refs).toEqual([{ raw: 'packages/foo/baz.ts', loc: { path: 'packages/foo/baz.ts' } }]);
    });

    it('keeps the file-level loc without a range when the file has no text entry', () => {
      const refs = extract('public/logo.png#L1-L5');
      expect(refs).toEqual([{ raw: 'public/logo.png', loc: { path: 'public/logo.png' } }]);
    });
  });

  describe('dedup and order', () => {
    it('dedups identical (path, start, end) and preserves first-seen order', () => {
      const refs = extract('packages/foo/bar.ts#L1-L3 then packages/foo/baz.ts then packages/foo/bar.ts#L1-L3 again');
      expect(refs).toEqual([
        { raw: 'packages/foo/bar.ts', loc: { path: 'packages/foo/bar.ts', start: 1, end: 3 } },
        { raw: 'packages/foo/baz.ts', loc: { path: 'packages/foo/baz.ts' } }
      ]);
    });

    it('keeps distinct ranges of the same file as separate entries', () => {
      const refs = extract('packages/foo/bar.ts#L1-L3 and packages/foo/bar.ts#L5-L6');
      expect(refs).toEqual([
        { raw: 'packages/foo/bar.ts', loc: { path: 'packages/foo/bar.ts', start: 1, end: 3 } },
        { raw: 'packages/foo/bar.ts', loc: { path: 'packages/foo/bar.ts', start: 5, end: 6 } }
      ]);
    });
  });
});

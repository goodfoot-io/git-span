/**
 * Implementation-to-test naming coupling signal.
 *
 * Test files conventionally name the implementation file they exercise
 * (`foo.test.ts` <-> `foo.ts`). That naming convention is not itself proof
 * of coupling — a stem match alone is emitted only when corroborated by
 * co-change history or a shared distinctive literal, so this signal never
 * fires on naming coincidence alone.
 *
 * @summary Detects corroborated impl<->test file pairs by naming convention.
 */

import type { Candidate, ChangeGroup, DiscoverConfig, RepoHistory, RepoScan, Signal } from '../types.js';

const SIGNAL_NAME = 'impl-test';
const BASE_SCORE = 0.6;
const BOTH_CORROBORATED_SCORE = 0.66;
const SCORE_CAP = 0.7;
const MIN_CORROBORATING_GROUPS = 2;
const MIN_LITERAL_LEN = 12;

/** Directory segments that mark "this is the test tree", stripped before prefix comparison. */
const TEST_DIR_MARKERS = new Set(['test', 'tests', '__tests__']);
/** Directory segments that mark "this is the source tree", stripped from impl candidates for symmetry. */
const IMPL_DIR_MARKERS = new Set(['src']);

interface TestFileShape {
  readonly stem: string;
  readonly tryExts: readonly string[];
}

const TS_JS_TEST_SUFFIXES = ['.test.ts', '.spec.ts', '.test.tsx', '.test.js'] as const;
const TS_JS_TRY_EXTS = ['.ts', '.tsx', '.js'] as const;

/**
 * Detects whether a path follows a known impl<->test naming convention.
 *
 * @param path - Repository-relative path to classify.
 * @returns The derived stem and candidate impl extensions to try, or null.
 */
function detectTestFile(path: string): TestFileShape | null {
  const base = path.slice(path.lastIndexOf('/') + 1);
  for (const suffix of TS_JS_TEST_SUFFIXES) {
    if (base.endsWith(suffix)) {
      return { stem: base.slice(0, -suffix.length), tryExts: TS_JS_TRY_EXTS };
    }
  }
  if (base.startsWith('test_') && base.endsWith('.py')) {
    return { stem: base.slice('test_'.length, -'.py'.length), tryExts: ['.py'] };
  }
  if (base.endsWith('_test.go')) {
    return { stem: base.slice(0, -'_test.go'.length), tryExts: ['.go'] };
  }
  if (base.endsWith('Tests.java')) {
    return { stem: base.slice(0, -'Tests.java'.length), tryExts: ['.java'] };
  }
  if (base.endsWith('Test.java')) {
    return { stem: base.slice(0, -'Test.java'.length), tryExts: ['.java'] };
  }
  return null;
}

function dirSegments(path: string): string[] {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? [] : path.slice(0, slash).split('/');
}

function normalizedDirSegments(path: string, markers: ReadonlySet<string>): string[] {
  return dirSegments(path).filter((segment) => !markers.has(segment));
}

function commonPrefixLength(a: readonly string[], b: readonly string[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Resolves the unique implementation file for a detected test file, using
 * longest normalized-directory-prefix matching to disambiguate when several
 * files share the derived basename. Returns null when no candidate exists
 * or when the top prefix length is tied between multiple candidates.
 *
 * @param testPath - Path of the detected test file.
 * @param shape - Derived stem and extension try-order.
 * @param filesByBasename - Index of scan files grouped by basename.
 * @returns The resolved implementation path, or null.
 */
function resolveImpl(
  testPath: string,
  shape: TestFileShape,
  filesByBasename: ReadonlyMap<string, readonly string[]>
): string | null {
  for (const ext of shape.tryExts) {
    const candidates = filesByBasename.get(`${shape.stem}${ext}`);
    if (candidates === undefined || candidates.length === 0) continue;
    if (candidates.length === 1) return candidates[0] ?? null;

    const testKey = normalizedDirSegments(testPath, TEST_DIR_MARKERS);
    let bestPath: string | null = null;
    let bestLen = -1;
    let tied = false;
    for (const candidate of candidates) {
      const implKey = normalizedDirSegments(candidate, IMPL_DIR_MARKERS);
      const len = commonPrefixLength(testKey, implKey);
      if (len > bestLen) {
        bestLen = len;
        bestPath = candidate;
        tied = false;
      } else if (len === bestLen) {
        tied = true;
      }
    }
    return tied ? null : bestPath;
  }
  return null;
}

const QUOTE_RES: readonly RegExp[] = [/"([^"\\\n]+)"/g, /'([^'\\\n]+)'/g, /`([^`\\\n]+)`/g];
const VERSION_LIKE_RE = /^v?\d+[\d.]*$/;

interface FileIndex {
  readonly exact: ReadonlySet<string>;
  readonly byBasename: ReadonlyMap<string, readonly string[]>;
}

function isScanFilePath(token: string, index: FileIndex): boolean {
  if (!token.includes('/')) return false;
  if (index.exact.has(token)) return true;
  const base = token.slice(token.lastIndexOf('/') + 1);
  const candidates = index.byBasename.get(base);
  if (!candidates) return false;
  return candidates.some((file) => file === token || file.endsWith(`/${token}`));
}

/**
 * Extracts qualifying quoted-string literals from a file's full text, using
 * the same acceptance rules as the shared-literals signal (length, URL,
 * version, and scan-path exclusions). Reimplemented locally so this module
 * has no dependency on its sibling.
 *
 * @param text - Full text of a file.
 * @param index - Scan-file lookup used to exclude path-like literals.
 * @returns Set of distinct qualifying literal tokens found in the text.
 */
function quotedLiterals(text: string, index: FileIndex): Set<string> {
  const tokens = new Set<string>();
  for (const re of QUOTE_RES) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null = re.exec(text);
    while (match !== null) {
      const trimmed = (match[1] ?? '').trim();
      if (
        trimmed.length >= MIN_LITERAL_LEN &&
        !trimmed.includes('://') &&
        !VERSION_LIKE_RE.test(trimmed) &&
        !isScanFilePath(trimmed, index)
      ) {
        tokens.add(trimmed);
      }
      match = re.exec(text);
    }
  }
  return tokens;
}

function hasSharedLiteral(implText: string, testText: string, index: FileIndex): boolean {
  const implLiterals = quotedLiterals(implText, index);
  if (implLiterals.size === 0) return false;
  for (const token of quotedLiterals(testText, index)) {
    if (implLiterals.has(token)) return true;
  }
  return false;
}

function countCorroboratingGroups(a: string, b: string, changeGroups: readonly ChangeGroup[]): number {
  let count = 0;
  for (const group of changeGroups) {
    if (group.files.includes(a) && group.files.includes(b)) count++;
  }
  return count;
}

/**
 * Signal that pairs implementation files with their corroborated test files.
 */
export const implTestSignal: Signal = {
  name: SIGNAL_NAME,

  applies(scan: RepoScan, history: RepoHistory): boolean {
    return history.changeGroups.length > 0 || scan.text.size > 0;
  },

  run(scan: RepoScan, history: RepoHistory, _config: DiscoverConfig): Candidate[] {
    const filesByBasename = new Map<string, string[]>();
    const exact = new Set(scan.files);
    for (const path of scan.files) {
      const base = path.slice(path.lastIndexOf('/') + 1);
      const existing = filesByBasename.get(base);
      if (existing) {
        existing.push(path);
      } else {
        filesByBasename.set(base, [path]);
      }
    }
    const index: FileIndex = { exact, byBasename: filesByBasename };

    const candidates: Candidate[] = [];
    for (const testPath of scan.files) {
      const shape = detectTestFile(testPath);
      if (shape === null) continue;
      const implPath = resolveImpl(testPath, shape, filesByBasename);
      if (implPath === null) continue;

      const groupCount = countCorroboratingGroups(implPath, testPath, history.changeGroups);
      const groupCorroborated = groupCount >= MIN_CORROBORATING_GROUPS;
      const implText = scan.text.get(implPath);
      const testText = scan.text.get(testPath);
      const literalCorroborated =
        implText !== undefined && testText !== undefined && hasSharedLiteral(implText, testText, index);

      if (!groupCorroborated && !literalCorroborated) continue;

      const score = Math.min(
        SCORE_CAP,
        groupCorroborated && literalCorroborated ? BOTH_CORROBORATED_SCORE : BASE_SCORE
      );
      candidates.push({
        locs: [{ path: implPath }, { path: testPath }],
        score,
        signal: SIGNAL_NAME,
        evidence: [`impltest:${groupCount}`]
      });
    }

    candidates.sort((x, y) => {
      if (y.score !== x.score) return y.score - x.score;
      const xa = x.locs[0]?.path ?? '';
      const xb = x.locs[1]?.path ?? '';
      const ya = y.locs[0]?.path ?? '';
      const yb = y.locs[1]?.path ?? '';
      return xa === ya ? xb.localeCompare(yb) : xa.localeCompare(ya);
    });

    return candidates;
  }
};

/**
 * Unit tests for {@link escapeGlobPattern} -- the helper that makes literal
 * filesystem paths safe to pass wherever VS Code expects a GlobPattern
 * (`createFileSystemWatcher` above all).
 *
 * The semantic assertions run against a faithful port of VS Code's glob
 * translation (`parseRegExp` and friends from `src/vs/base/common/glob.ts`,
 * MIT licensed) rather than a hand-rolled guess, so a future VS Code glob
 * change that breaks the encoding fails here instead of silently in the
 * watcher layer. The port covers the regex path of VS Code's parser only;
 * its trivia fast paths (T1-T5, exact-string/basename shortcuts for
 * wildcard-free shapes) are accept/reject-equivalent to the regex path and
 * every pattern asserted against the matcher contains a metacharacter, which
 * the trivia shapes cannot.
 *
 * @summary Unit tests for the glob escaping helper.
 * @module test/suite/spanViewer/globEscape.test
 */

import * as assert from 'node:assert';
import * as path from 'node:path';
import { escapeGlobPattern } from '../../../src/spanViewer/globEscape.js';

// ---------------------------------------------------------------------------
// Faithful port of VS Code's glob -> RegExp translation
// (microsoft/vscode src/vs/base/common/glob.ts, MIT license). Verbatim logic,
// renamed exports avoided -- these are test-local reference copies.
// ---------------------------------------------------------------------------

/** Any slash or backslash, mirroring VS Code's `PATH_REGEX`. */
const PATH_REGEX = '[/\\\\]';

/** Any non-slash and non-backslash, mirroring VS Code's `NO_PATH_REGEX`. */
const NO_PATH_REGEX = '[^/\\\\]';

/**
 * Mirrors VS Code's `escapeRegExpCharacters` from `src/vs/base/common/strings.ts`.
 *
 * @param value - Text to escape for embedding in a RegExp source.
 * @returns Regex-safe text.
 */
function escapeRegExpCharacters(value: string): string {
  return value.replace(/[\\{}*+?|^$.[\]()]/g, '\\$&');
}

/**
 * Mirrors VS Code's `splitGlobAware`: splits on `splitChar` while respecting
 * brace and bracket nesting.
 *
 * @param pattern - Glob pattern to split.
 * @param splitChar - The character to split on.
 * @returns Segments.
 */
function splitGlobAware(pattern: string, splitChar: string): string[] {
  if (!pattern) {
    return [];
  }

  const segments: string[] = [];

  let inBraces = false;
  let inBrackets = false;

  let curVal = '';
  for (const char of pattern) {
    switch (char) {
      case splitChar: {
        if (!inBraces && !inBrackets) {
          segments.push(curVal);
          curVal = '';

          continue;
        }
        break;
      }
      case '{': {
        inBraces = true;
        break;
      }
      case '}': {
        inBraces = false;
        break;
      }
      case '[': {
        inBrackets = true;
        break;
      }
      case ']': {
        inBrackets = false;
        break;
      }
    }

    curVal += char;
  }

  // Tail
  if (curVal) {
    segments.push(curVal);
  }

  return segments;
}

/**
 * Mirrors VS Code's `starsToRegExp`.
 *
 * @param starCount - Number of consecutive stars the segment collapsed to.
 * @param isLastPattern - Whether the segment ends the whole pattern.
 * @returns RegExp source for the stars.
 */
function starsToRegExp(starCount: number, isLastPattern?: boolean): string {
  switch (starCount) {
    case 0: {
      return '';
    }
    case 1: {
      return `${NO_PATH_REGEX}*?`; // 1 star matches any number of characters except path separator - non greedy (?)
    }
    default: {
      return `(?:${PATH_REGEX}|${NO_PATH_REGEX}+${PATH_REGEX}${isLastPattern ? `|${PATH_REGEX}${NO_PATH_REGEX}+` : ''})*?`;
    }
  }
}

/**
 * Mirrors VS Code's `parseRegExp`: translates a glob pattern into a RegExp
 * source. This is the codepath every pattern containing a metacharacter
 * takes in VS Code (trivia fast paths only fire for metachar-free shapes).
 *
 * @param pattern - Glob pattern to translate.
 * @returns RegExp source anchored by the caller.
 */
function parseRegExp(pattern: string): string {
  if (!pattern) {
    return '';
  }

  let regEx = '';

  // Split up into segments for each slash found
  const segments = splitGlobAware(pattern, '/');

  // Special case where we only have globstars
  if (segments.every((segment) => segment === '**')) {
    regEx = '.*';
  }

  // Build regex over segments
  else {
    let previousSegmentWasGlobStar = false;
    segments.forEach((segment, index) => {
      // Treat globstar specially
      if (segment === '**') {
        // if we have more than one globstar after another, just ignore it
        if (previousSegmentWasGlobStar) {
          return;
        }

        regEx += starsToRegExp(2, index === segments.length - 1);
      }

      // Anything else, not globstar
      else {
        // States
        let inBraces = false;
        let braceVal = '';

        let inBrackets = false;
        let bracketVal = '';

        for (const char of segment) {
          // Support brace expansion
          if (char !== '}' && inBraces) {
            braceVal += char;
            continue;
          }

          // Support brackets
          if (
            inBrackets &&
            (char !== ']' || !bracketVal) /* ] is literally only allowed as first character in brackets to match it */
          ) {
            let res: string;

            // range operator
            if (char === '-') {
              res = char;
            }

            // negation operator (only valid on first index in bracket)
            else if ((char === '^' || char === '!') && !bracketVal) {
              res = '^';
            }

            // glob split matching is not allowed within character ranges
            else if (char === '/') {
              res = '';
            }

            // anything else gets escaped
            else {
              res = escapeRegExpCharacters(char);
            }

            bracketVal += res;
            continue;
          }

          switch (char) {
            case '{': {
              inBraces = true;
              continue;
            }

            case '[': {
              inBrackets = true;
              continue;
            }

            case '}': {
              const choices = splitGlobAware(braceVal, ',');

              // Converts {foo,bar} => [foo|bar]
              const braceRegExp = `(?:${choices.map((choice) => parseRegExp(choice)).join('|')})`;

              regEx += braceRegExp;

              inBraces = false;
              braceVal = '';

              break;
            }

            case ']': {
              regEx += `[${bracketVal}]`;

              inBrackets = false;
              bracketVal = '';

              break;
            }

            case '?': {
              regEx += NO_PATH_REGEX; // 1 ? matches any single character except path separator (/ and \)
              continue;
            }

            case '*': {
              regEx += starsToRegExp(1);
              continue;
            }

            default: {
              regEx += escapeRegExpCharacters(char);
            }
          }
        }

        // Tail: Add the slash we had split on if there is more to come and
        // the remaining pattern is not a globstar.
        if (
          index < segments.length - 1 && // more segments to come after this
          (segments[index + 1] !== '**' || index + 2 < segments.length)
        ) {
          regEx += PATH_REGEX;
        }
      }

      // update globstar state
      previousSegmentWasGlobStar = segment === '**';
    });
  }

  return regEx;
}

/**
 * Mirrors VS Code's glob matching semantics for the patterns under test:
 * anchors the ported translation into a RegExp and tests the candidate.
 *
 * @param pattern - Glob pattern (as VS Code would receive it).
 * @param candidatePath - Literal path to test against the pattern.
 * @returns Whether VS Code's glob engine would match the path.
 */
function vscodeGlobMatches(pattern: string, candidatePath: string): boolean {
  return new RegExp(`^${parseRegExp(pattern)}$`).test(candidatePath);
}

describe('globEscape', () => {
  describe('escapeGlobPattern', () => {
    it('leaves a plain path unchanged', () => {
      assert.strictEqual(escapeGlobPattern('/repo/src/api.ts'), '/repo/src/api.ts');
      assert.strictEqual(escapeGlobPattern('README.md'), 'README.md');
    });

    it('wraps each glob metacharacter in a single-element character class', () => {
      assert.strictEqual(escapeGlobPattern('*'), '[*]');
      assert.strictEqual(escapeGlobPattern('?'), '[?]');
      assert.strictEqual(escapeGlobPattern('{'), '[{]');
      assert.strictEqual(escapeGlobPattern('}'), '[}]');
      assert.strictEqual(escapeGlobPattern('['), '[[]');
      assert.strictEqual(escapeGlobPattern(']'), '[]]');
    });

    it('escapes every metacharacter in place within a longer path', () => {
      assert.strictEqual(escapeGlobPattern('src/a*b?c{d}e[f]g/h.ts'), 'src/a[*]b[?]c[{]d[}]e[[]f[]]g/h.ts');
    });

    it('keeps separators and ordinary characters untouched', () => {
      assert.strictEqual(escapeGlobPattern('dir.sub/my-file_01.txt'), 'dir.sub/my-file_01.txt');
    });
  });

  describe('vscode-glob semantics (reference parseRegExp port)', () => {
    it('matches the bracketed directory literally after escaping', () => {
      const pattern = escapeGlobPattern('src/[generated]/api.ts');

      assert.ok(vscodeGlobMatches(pattern, 'src/[generated]/api.ts'), `${pattern} should match its own literal path`);
    });

    it('no longer matches the character-class expansions the raw path did (the bug)', () => {
      // The unescaped path parses `[generated]` as a single-character class,
      // which is exactly why the old watcher never fired.
      assert.ok(vscodeGlobMatches('src/[generated]/api.ts', 'src/g/api.ts'));
      assert.ok(!vscodeGlobMatches('src/[generated]/api.ts', 'src/generated/api.ts'));

      const pattern = escapeGlobPattern('src/[generated]/api.ts');
      assert.ok(!vscodeGlobMatches(pattern, 'src/g/api.ts'), 'escaped pattern must not match class expansions');
      assert.ok(!vscodeGlobMatches(pattern, 'src/n/api.ts'));
    });

    it('round-trips a path containing every metacharacter', () => {
      const literal = 'gen/{a,b}/v?/w*/x[0-9]y/file.ts';
      const pattern = escapeGlobPattern(literal);

      assert.ok(vscodeGlobMatches(pattern, literal), `${pattern} should match ${literal}`);
      assert.ok(!vscodeGlobMatches(pattern, 'gen/a/v1/w2/x3y/file.ts'), 'wildcard meanings must be neutralized');
    });

    it('matches the joined absolute form the provider actually builds', () => {
      const repoRoot = '/home/dev/repo';
      const anchorPath = 'src/[generated]/api.ts';
      const watchedPath = path.join(repoRoot, anchorPath);
      const pattern = escapeGlobPattern(watchedPath);

      assert.ok(vscodeGlobMatches(pattern, watchedPath));
    });
  });
});

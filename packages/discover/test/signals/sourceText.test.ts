/**
 * Tests that the signal sources stay text-classifiable: no raw NUL bytes in
 * the source files themselves (so grep/file/editors/agent tooling treat them
 * as UTF-8 text), while the pair-key separators those sources define still
 * resolve to exactly one NUL character at runtime so scan outputs stay
 * byte-stable.
 *
 * @summary Signal sources contain no raw NULs; runtime separators stay NUL.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SIGNALS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/signals');

const TEXT_CLASSIFIED_SOURCES = ['cochange.ts', 'sharedLiterals.ts'] as const;

/** Unescape a subset of JS string escapes (`\uXXXX`, `\xXX`, `\\`, `\n`, `\t`) to its runtime value. */
function unescapeJs(source: string): string {
  return source.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_match, esc: string) => {
    if (esc.startsWith('u')) return String.fromCharCode(Number.parseInt(esc.slice(1), 16));
    if (esc.startsWith('x')) return String.fromCharCode(Number.parseInt(esc.slice(1), 16));
    if (esc === 'n') return '\n';
    if (esc === 't') return '\t';
    return esc;
  });
}

describe('signal sources are text-classifiable', () => {
  for (const name of TEXT_CLASSIFIED_SOURCES) {
    it(`has no raw NUL bytes: src/signals/${name}`, () => {
      const bytes = readFileSync(join(SIGNALS_DIR, name));
      const nulOffsets: number[] = [];
      bytes.forEach((byte, offset) => {
        if (byte === 0x00) nulOffsets.push(offset);
      });
      expect(nulOffsets, `raw NUL bytes at offsets ${nulOffsets.join(', ')}`).toEqual([]);
    });
  }
});

describe('pair-key separators remain a single NUL at runtime', () => {
  it('PAIR_KEY_SEP in cochange.ts decodes to exactly one NUL', () => {
    const source = readFileSync(join(SIGNALS_DIR, 'cochange.ts'), 'utf8');
    const match = /const PAIR_KEY_SEP = ('(?:[^'\\]|\\.)*');/.exec(source);
    expect(match, 'PAIR_KEY_SEP declaration found').not.toBeNull();
    const raw = match?.[1] ?? '';
    expect(unescapeJs(raw.slice(1, -1))).toBe('\u0000');
  });

  it('pairKey() joiner in sharedLiterals.ts decodes to exactly one NUL', () => {
    const source = readFileSync(join(SIGNALS_DIR, 'sharedLiterals.ts'), 'utf8');
    const match =
      /function pairKey\(a: string, b: string\): string \{\n {2}return a < b \? `\$\{a\}(.*?)\$\{b\}` : `\$\{b\}(.*?)\$\{a\}`;/.exec(
        source
      );
    expect(match, 'pairKey template literals found').not.toBeNull();
    expect(unescapeJs(match?.[1] ?? '')).toBe('\u0000');
    expect(unescapeJs(match?.[2] ?? '')).toBe('\u0000');
  });
});

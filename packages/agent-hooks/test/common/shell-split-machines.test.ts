import { describe, expect, it } from 'vitest';
import { createScan, stepBraceContent, stepQuote } from '../../src/common/shell-split-machines.js';

/** Drive one machine step with the cursor parked at `at`. */
function scanAt(cmd: string, at: number) {
  const s = createScan(cmd);
  s.i = at;
  return s;
}

describe('quoting machine', () => {
  it('single-quote spans copy content verbatim and close on the next quote', () => {
    const s = scanAt("'a b|c'", 0);
    s.buf = "'";
    s.i = 1;
    s.inSquote = true;
    for (const expected of ['a', ' ', 'b', '|', 'c']) {
      expect(stepQuote(s)).toBe(true);
      expect(s.buf.endsWith(expected)).toBe(true);
      expect(s.inSquote).toBe(true);
    }
    expect(stepQuote(s)).toBe(true);
    expect(s.inSquote).toBe(false);
    expect(s.i).toBe(7);
  });

  it('double-quote spans honor backslash escapes and copy them verbatim', () => {
    const s = scanAt('"a\\"b\\$c"', 0);
    s.inDquote = true;
    s.i = 1;
    // Walks: a, \" escape pair, b, \$ escape pair, c — every step consumed.
    while (s.i < s.cmd.length - 1) {
      expect(stepQuote(s)).toBe(true);
    }
    expect(s.inDquote).toBe(true);
    expect(stepQuote(s)).toBe(true);
    expect(s.inDquote).toBe(false);
    // The buffer keeps the raw source from the cursor on — escapes are
    // preserved as typed.
    expect(s.buf).toBe('a\\"b\\$c"');
  });

  it('an unquoted backslash consumes the escaped character as one pair', () => {
    const s = scanAt('a\\|b', 1);
    expect(stepQuote(s)).toBe(true);
    expect(s.buf).toBe('\\|');
    expect(s.i).toBe(3);
  });

  it('reports unquoted text as unconsumed', () => {
    const s = scanAt('echo hi', 0);
    expect(stepQuote(s)).toBe(false);
    expect(s.i).toBe(0);
    expect(s.buf).toBe('');
  });
});

describe('brace-expansion opacity machine', () => {
  it('is inactive at depth zero', () => {
    const s = scanAt('${x}', 0);
    expect(stepBraceContent(s)).toBe(false);
    expect(s.i).toBe(0);
  });

  it('consumes content opaquely until the closing brace decrements out', () => {
    const s = scanAt('${x:-$(echo y)}rest', 0);
    s.braceDepth = 1;
    s.i = 1;
    let steps = 0;
    while (stepBraceContent(s)) steps += 1;
    // Every char through the matching `}` was consumed; `rest` remains.
    expect(steps).toBe(14);
    expect(s.braceDepth).toBe(0);
    expect(s.buf.startsWith('{x:-$(echo y)}')).toBe(true);
    expect(s.i).toBe(15);
  });

  it('nested closers decrement one level per closing brace', () => {
    const s = scanAt('${a${b}c}', 4);
    s.braceDepth = 2;
    // `{` at 4 and `b` at 5 are interior content — depth unchanged.
    expect(stepBraceContent(s)).toBe(true);
    expect(s.i).toBe(5);
    expect(s.braceDepth).toBe(2);
    s.i = 5;
    expect(stepBraceContent(s)).toBe(true);
    expect(s.braceDepth).toBe(2);
    // `}` at 6 closes the inner expansion; `}` at 8 closes the outer one.
    s.i = 6;
    expect(stepBraceContent(s)).toBe(true);
    expect(s.braceDepth).toBe(1);
    s.i = 8;
    expect(stepBraceContent(s)).toBe(true);
    expect(s.braceDepth).toBe(0);
  });
});

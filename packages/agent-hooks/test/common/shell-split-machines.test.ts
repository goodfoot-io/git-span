import { describe, expect, it } from 'vitest';
import {
  createScan,
  finishScan,
  rejectEmptyConstructList,
  skipTopLevelComment,
  stepBoundaryOperator,
  stepBraceContent,
  stepCaseRegion,
  stepConstructWord,
  stepHeredocBody,
  stepHeredocDelimiterNewline,
  stepHeredocOpen,
  stepHereString,
  stepParen,
  stepQuote,
  stepRedirectToken
} from '../../src/common/shell-split-machines.js';

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

describe('here-string machine', () => {
  it('consumes exactly three <s when the run is not longer and the previous char is not <', () => {
    const s = scanAt('cat <<<x', 4);
    expect(stepHereString(s)).toBe(true);
    expect(s.buf).toBe('<<<');
    expect(s.i).toBe(7);
  });

  it('declines four-< runs and < glued to a preceding <', () => {
    const four = scanAt('a <<<< b', 2);
    expect(stepHereString(four)).toBe(false);
    expect(four.i).toBe(2);
    const glued = scanAt('a <<<< b', 3);
    expect(stepHereString(glued)).toBe(false);
  });

  it('is inactive inside a paren level', () => {
    const s = scanAt('( cat <<<x )', 6);
    s.depth = 1;
    expect(stepHereString(s)).toBe(false);
    expect(s.i).toBe(6);
  });
});

describe('heredoc machines', () => {
  describe('stepHeredocOpen', () => {
    it('registers a bare-delimiter close matcher and strips operator+delimiter from the stage text', () => {
      const s = scanAt('cat <<EOF\nbody', 4);
      expect(stepHeredocOpen(s)).toBe(true);
      expect(s.heredocs).toHaveLength(1);
      expect(s.heredocs[0].close.test('EOF')).toBe(true);
      expect(s.heredocs[0].close.test('EOF ')).toBe(true);
      expect(s.heredocs[0].close.test(' x')).toBe(false);
      expect(s.bufHeredoc).toBe(true);
      expect(s.buf).toBe('');
      // The cursor clears the operator+delimiter even though they never
      // reached the buffer (stripped at top level).
      expect(s.i).toBe(9);
    });

    it('<<- allows tab-prefixed close lines', () => {
      const s = scanAt('cat <<- EOF', 4);
      expect(stepHeredocOpen(s)).toBe(true);
      expect(s.heredocs[0].close.test('\tEOF')).toBe(true);
      expect(s.heredocs[0].close.test(' EOF')).toBe(false);
    });

    it('quoted delimiters match literally, regex chars included', () => {
      const s = scanAt("cat <<'A.B'", 4);
      expect(stepHeredocOpen(s)).toBe(true);
      expect(s.heredocs[0].close.test('A.B')).toBe(true);
      expect(s.heredocs[0].close.test('AXB')).toBe(false);
    });

    it('keeps the operator+delimiter in the buffer inside an open construct', () => {
      const s = scanAt('{ cat <<EOF', 6);
      s.levels[0].push({ kind: 'brace', body: true });
      expect(stepHeredocOpen(s)).toBe(true);
      expect(s.buf).toBe('<<EOF');
      expect(s.i).toBe(11);
    });

    it('declines when no delimiter word follows', () => {
      const s = scanAt('cat <<\n', 4);
      expect(stepHeredocOpen(s)).toBe(false);
      expect(s.heredocs).toHaveLength(0);
    });
  });

  describe('stepHeredocBody', () => {
    it('scans raw lines until the delimiter line and exits body mode', () => {
      const s = scanAt('x\nEOF\nrest', 0);
      s.inBody = true;
      s.heredocs.push({ close: /^EOF[ \t]*$/ });
      // Body line: opaque, stays out of the buffer, cursor jumps whole lines.
      expect(stepHeredocBody(s)).toBe(true);
      expect(s.inBody).toBe(true);
      expect(s.buf).toBe('');
      expect(s.i).toBe(2);
      expect(stepHeredocBody(s)).toBe(true);
      expect(s.inBody).toBe(false);
      expect(s.heredocs).toHaveLength(0);
      expect(s.i).toBe(6);
      // Body mode closed — the machine declines and the walk resumes.
      expect(stepHeredocBody(s)).toBe(false);
    });

    it('folds body lines into the buffer while a construct frame is open', () => {
      const s = scanAt('line1\nline2', 0);
      s.inBody = true;
      s.heredocs.push({ close: /^NOPE$/ });
      s.levels[0].push({ kind: 'if', body: false });
      expect(stepHeredocBody(s)).toBe(true);
      expect(s.buf).toBe('line1\n');
      expect(s.i).toBe(6);
    });
  });

  describe('stepHeredocDelimiterNewline', () => {
    it('declines newlines with no pending heredoc', () => {
      const s = scanAt('echo hi\n', 7);
      expect(stepHeredocDelimiterNewline(s)).toBe(false);
    });

    it('flushes the delimiter stage, starts body mode, and does not advance listStart', () => {
      const s = scanAt('cat f <<EOF\nbody', 11);
      s.heredocs.push({ close: /^EOF[ \t]*$/ });
      s.buf = 'cat f';
      // The delimiter operator registered earlier marked the buffered stage.
      s.bufHeredoc = true;
      s.listStart = 0;
      expect(stepHeredocDelimiterNewline(s)).toBe(true);
      expect(s.parts).toEqual([{ text: 'cat f', precededBy: 'start', heredoc: true }]);
      expect(s.inBody).toBe(true);
      expect(s.listStart).toBe(0);
      expect(s.i).toBe(12);
    });
  });
});

describe('case-region machine', () => {
  /** An open region parked at `at` with the given position state. */
  function caseAt(cmd: string, at: number, pos: 'subject' | 'pattern-start' | 'pattern' | 'command') {
    const s = scanAt(cmd, at);
    s.caseRegion = { pos, cmdEmpty: pos === 'command', localDepth: 0 };
    return s;
  }

  it('declines when no region is open or local depth is positive', () => {
    const noRegion = scanAt('x)', 0);
    expect(stepCaseRegion(noRegion)).toBe(false);
    const nested = caseAt('(x)', 1, 'pattern');
    nested.caseRegion!.localDepth = 1;
    expect(stepCaseRegion(nested)).toBe(false);
  });

  it(';; returns to pattern-start; a bare ; lands at command start with an empty list item', () => {
    const semi = caseAt('a);; b', 2, 'command');
    expect(stepCaseRegion(semi)).toBe(true);
    expect(semi.caseRegion!.pos).toBe('pattern-start');
    expect(semi.i).toBe(4);

    const item = caseAt('a;b', 1, 'pattern');
    expect(stepCaseRegion(item)).toBe(true);
    expect(item.caseRegion!.pos).toBe('command');
    expect(item.caseRegion!.cmdEmpty).toBe(true);
  });

  it('a newline in pattern position rejects the list; elsewhere it just resets the list item', () => {
    const bad = caseAt('pat\ntail', 3, 'pattern');
    expect(stepCaseRegion(bad)).toBe(true);
    expect(bad.malformed).toBe('unclosed-case');
    expect(bad.parts).toHaveLength(0);
    expect(bad.i).toBe(bad.n);

    const ok = caseAt('cmd\nmore', 3, 'command');
    expect(stepCaseRegion(ok)).toBe(true);
    expect(ok.caseRegion!.pos).toBe('command');
    expect(ok.caseRegion!.cmdEmpty).toBe(true);
  });

  it('esac closes the region from pattern-start and resets the construct keyword flag, but is a word mid-item', () => {
    const close = caseAt('esac; rest', 0, 'pattern-start');
    close.afterKeyword = true;
    expect(stepCaseRegion(close)).toBe(true);
    expect(close.caseRegion).toBeNull();
    expect(close.afterKeyword).toBe(false);
    expect(close.buf).toBe('esac');

    const word = caseAt('echo esac)', 5, 'command');
    word.caseRegion!.cmdEmpty = false;
    expect(stepCaseRegion(word)).toBe(true);
    expect(word.caseRegion!.pos).toBe('command');
    expect(word.buf).toBe('esac');
  });

  it('in ends the subject and the next word opens a pattern', () => {
    const inWord = caseAt('in *.txt', 0, 'subject');
    expect(stepCaseRegion(inWord)).toBe(true);
    expect(inWord.caseRegion!.pos).toBe('pattern-start');

    const pattern = caseAt('*.txt)', 0, 'pattern-start');
    expect(stepCaseRegion(pattern)).toBe(true);
    expect(pattern.caseRegion!.pos).toBe('pattern');
  });

  it('a paren falls through so the nesting machine can bump the local depth', () => {
    const paren = caseAt('(x', 0, 'pattern');
    expect(stepCaseRegion(paren)).toBe(false);
  });
});

describe('nesting machine', () => {
  describe('stepParen', () => {
    it('pushes a fresh construct level per ( and pops it on ), crediting an enclosing brace body', () => {
      const s = scanAt('{ ( echo ) }', 0);
      s.levels[0].push({ kind: 'brace', body: false });
      s.i = 2;
      expect(stepParen(s)).toBe(true);
      expect(s.depth).toBe(1);
      expect(s.levels[0][0].body).toBe(true);
      expect(s.levels).toHaveLength(2);
      s.i = 9;
      expect(stepParen(s)).toBe(true);
      expect(s.depth).toBe(0);
      expect(s.levels).toHaveLength(1);
    });

    it('a stray ) at depth 0 rejects as unbalanced-paren', () => {
      const s = scanAt('echo x)', 6);
      expect(stepParen(s)).toBe(true);
      expect(s.malformed).toBe('unbalanced-paren');
      expect(s.parts).toHaveLength(0);
    });

    it(') over a non-empty construct level fires unclosed-construct before restoring', () => {
      const s = scanAt('( if true; fi )', 14);
      s.depth = 1;
      s.levels.push([{ kind: 'if', body: true }]);
      expect(stepParen(s)).toBe(true);
      expect(s.malformed).toBe('unclosed-construct');
      // The rejecting list's stages are gone but the frame was NOT popped
      // first — fire-before-restore.
      expect(s.depth).toBe(1);
    });

    it('inside a case region, parens move the region-local depth only', () => {
      const s = scanAt('case $(x) in', 6);
      s.caseRegion = { pos: 'pattern', cmdEmpty: false, localDepth: 0 };
      expect(stepParen(s)).toBe(true);
      expect(s.caseRegion.localDepth).toBe(1);
      expect(s.depth).toBe(0);
      s.i = 8;
      expect(stepParen(s)).toBe(true);
      // The close went through the region-local depth (no global pop), and a
      // depth-decrementing ) leaves the position state untouched.
      expect(s.caseRegion.localDepth).toBe(0);
      expect(s.caseRegion.pos).toBe('pattern');
    });
  });

  describe('stepConstructWord', () => {
    it('if/then/fi drive a kind-matched stack with the empty-list guard armed between', () => {
      const s = scanAt('if true; then true; fi', 0);
      expect(stepConstructWord(s)).toBe(true);
      expect(s.levels[0]).toEqual([{ kind: 'if', body: false }]);
      expect(s.afterKeyword).toBe(true);
      // `then` arrives at command position (the buffer ends with `; `).
      s.buf = 'if true; ';
      s.i = 9;
      expect(stepConstructWord(s)).toBe(true);
      expect(s.levels[0]).toEqual([{ kind: 'if', body: true }]);
      s.buf = 'if true; then true; ';
      s.i = 20;
      expect(stepConstructWord(s)).toBe(true);
      expect(s.levels[0]).toHaveLength(0);
      expect(s.afterKeyword).toBe(false);
    });

    it('fi without an open if rejects', () => {
      const s = scanAt('echo; fi', 6);
      expect(stepConstructWord(s)).toBe(true);
      expect(s.malformed).toBe('unclosed-construct');
    });

    it('case opens a case-region frame and disarms the empty-list guard', () => {
      const s = scanAt('case $x in', 0);
      s.afterKeyword = false;
      expect(stepConstructWord(s)).toBe(true);
      expect(s.caseRegion).toEqual({ pos: 'subject', cmdEmpty: false, localDepth: 0 });
      expect(s.afterKeyword).toBe(false);
    });

    it('{ opens a brace group at command position or after a function name; {cat is a word', () => {
      const fnShape = scanAt('f() { :; }', 4);
      fnShape.buf = 'f()';
      fnShape.i = 4;
      expect(stepConstructWord(fnShape)).toBe(true);
      expect(fnShape.levels[0]).toEqual([{ kind: 'brace', body: false }]);

      const word = scanAt('cat {a}', 4);
      word.buf = 'cat ';
      word.i = 4;
      expect(stepConstructWord(word)).toBe(true);
      expect(word.levels[0]).toHaveLength(0);
      expect(word.buf).toBe('cat {a}');
    });

    it('an argument-position ordinary word advances the function-name handoff without opening frames', () => {
      const s = scanAt('function f g', 9);
      s.functionSeen = true;
      s.nameSeen = false;
      s.afterKeyword = true;
      s.buf = 'function f ';
      expect(stepConstructWord(s)).toBe(true);
      expect(s.nameSeen).toBe(true);
      expect(s.afterKeyword).toBe(false);
      expect(s.levels[0]).toHaveLength(0);
    });

    it('declines when a case region is open or the char is a metachar', () => {
      const inCase = scanAt('esac)', 0);
      inCase.caseRegion = { pos: 'pattern-start', cmdEmpty: false, localDepth: 0 };
      expect(stepConstructWord(inCase)).toBe(false);

      const meta = scanAt('a && b', 2);
      meta.buf = 'a ';
      expect(stepConstructWord(meta)).toBe(false);
    });
  });

  describe('rejectEmptyConstructList', () => {
    it('rejects ; / & right after an opener keyword inside a construct', () => {
      const s = scanAt('if ; fi', 3);
      s.levels[0].push({ kind: 'if', body: false });
      s.afterKeyword = true;
      expect(rejectEmptyConstructList(s)).toBe(true);
      expect(s.malformed).toBe('unclosed-construct');
    });

    it('leaves operators alone outside constructs or when no keyword precedes', () => {
      const outside = scanAt('a; b', 1);
      outside.buf = 'a';
      expect(rejectEmptyConstructList(outside)).toBe(false);
      const unarmed = scanAt('if true;', 8);
      unarmed.levels[0].push({ kind: 'if', body: true });
      unarmed.afterKeyword = false;
      expect(rejectEmptyConstructList(unarmed)).toBe(false);
    });
  });
});

describe('boundary-operator machine', () => {
  it('&& flushes the buffered stage under the and operator', () => {
    const s = scanAt('rm -rf x && echo done', 9);
    s.buf = 'rm -rf x';
    expect(stepBoundaryOperator(s)).toBe(true);
    expect(s.parts).toEqual([{ text: 'rm -rf x', precededBy: 'start' }]);
    expect(s.pendingOp).toBe('and');
    expect(s.i).toBe(11);
  });

  it('a newline after an unconsumed pipe is a continuation, not a separator', () => {
    const s = scanAt('cat f |\nsed', 7);
    s.buf = '';
    s.pendingOp = 'pipe';
    expect(stepBoundaryOperator(s)).toBe(true);
    expect(s.parts).toHaveLength(0);
    expect(s.pendingOp).toBe('pipe');
    expect(s.i).toBe(8);
  });

  it('& inside a dup redirect token is text, not a background operator', () => {
    const dup = scanAt('cat f 2>&1', 8);
    dup.buf = 'cat f 2>';
    expect(stepBoundaryOperator(dup)).toBe(true);
    expect(dup.buf).toBe('cat f 2>&');
    expect(dup.parts).toHaveLength(0);
  });

  it('declines inside a paren level', () => {
    const s = scanAt('( a && b )', 4);
    s.depth = 1;
    s.buf = 'a ';
    expect(stepBoundaryOperator(s)).toBe(false);
  });
});

describe('redirect-token machine and comment skip', () => {
  it('rejects two redirect tokens in a row mid-stage', () => {
    const s = scanAt('cat > > out', 6);
    s.buf = 'cat > ';
    expect(stepRedirectToken(s)).toBe(true);
    expect(s.malformed).toBe('dangling-operator');
  });

  it('${ opens brace opacity; the machine declines other chars at depth', () => {
    const open = scanAt('echo ${x}', 5);
    open.buf = 'echo ';
    expect(stepRedirectToken(open)).toBe(true);
    expect(open.braceDepth).toBe(1);

    const plain = scanAt('echo hi', 5);
    plain.buf = 'echo ';
    expect(stepRedirectToken(plain)).toBe(false);
  });

  it('# comments run to end of line only at word starts and depth 0', () => {
    const comment = scanAt('echo # trailing\nnext', 5);
    comment.buf = 'echo ';
    expect(skipTopLevelComment(comment)).toBe(true);
    expect(comment.i).toBe(15);
    const midWord = scanAt('a#b', 1);
    midWord.buf = 'a';
    expect(skipTopLevelComment(midWord)).toBe(false);
  });
});

describe('finishScan', () => {
  it('emits verdicts in bash order — unclosed quote before dangling operator', () => {
    const s = createScan("echo 'x |");
    s.i = s.n;
    s.inSquote = true;
    s.pendingOp = 'pipe';
    expect(finishScan(s)).toEqual({ stages: [], malformed: 'unclosed-quote' });
  });

  it('an unterminated heredoc flushes the delimiter stage as the partial', () => {
    const s = createScan('cat <<EOF');
    s.i = s.n;
    s.heredocs.push({ close: /^EOF[ \t]*$/ });
    s.buf = 'cat';
    // The delimiter operator registered earlier marked the buffered stage.
    s.bufHeredoc = true;
    expect(finishScan(s)).toEqual({
      stages: [{ text: 'cat', precededBy: 'start', heredoc: true }],
      malformed: 'unterminated-heredoc'
    });
  });
});

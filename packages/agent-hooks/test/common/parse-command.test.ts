/**
 * Tests for the Bash command-analysis parser
 * (packages/agent-hooks/src/common/parse-command.ts), ported from the
 * command-analysis test suite that shipped with the parser (att-fa25ad2a
 * parseCommand.test.mts) and extended with the two evidence-backed idiom
 * extensions added in this card: bare `cat`/`nl` whole-file reads and
 * multi-range `sed -n` scripts.
 *
 * The parser classifies a Bash `command` string into the file path(s) + line
 * range(s) it statically, reliably reads or writes. These tests exercise it
 * against real fixture files in a temp directory, and a real (throwaway) git
 * repo for the `git show`/`git log -L` idioms.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type ParseOptions,
  parseCommand,
  parseCommandDetailed,
  type SpanMatch
} from '../../src/common/parse-command.js';
import { splitTopLevel } from '../../src/common/shell-split.js';
import { makeTempRepo } from '../helpers.js';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'parseCommand-test-'));
  const twentyLines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
  writeFileSync(join(dir, 'twenty.txt'), `${twentyLines}\n`);
  writeFileSync(join(dir, 'five.txt'), `${Array.from({ length: 5 }, (_, i) => `l${i + 1}`).join('\n')}\n`);
  writeFileSync(join(dir, 'empty.txt'), '');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('bare cat/nl whole-file reads', () => {
  it('bare cat file resolves to whole-file range', () => {
    const spans = parseCommand(`cat ${join(dir, 'twenty.txt')}`);
    expect(spans).toEqual([{ lineStart: 1, lineEnd: 20, absolutePath: join(dir, 'twenty.txt') }]);
  });

  it('bare nl file resolves to whole-file range', () => {
    const spans = parseCommand(`nl ${join(dir, 'five.txt')}`);
    expect(spans).toEqual([{ lineStart: 1, lineEnd: 5, absolutePath: join(dir, 'five.txt') }]);
  });

  it('cat file | head -N still only emits the head range (pipe source, no standalone cat span)', () => {
    const spans = parseCommand(`cat ${join(dir, 'twenty.txt')} | head -3`);
    // Only the head range; bare cat is a pipe source, not a standalone read
    expect(spans).toEqual([{ lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'twenty.txt') }]);
  });

  it('cat with no file argument (stdin) does not match', () => {
    expect(parseCommand('cat')).toEqual([]);
  });
});

describe('multi-range sed -n', () => {
  it('two ranges on one file emit two spans', () => {
    const spans = parseCommand(`sed -n '2,4p;6,8p' ${join(dir, 'twenty.txt')}`);
    expect(spans).toEqual([
      { lineStart: 2, lineEnd: 4, absolutePath: join(dir, 'twenty.txt') },
      { lineStart: 6, lineEnd: 8, absolutePath: join(dir, 'twenty.txt') }
    ]);
  });

  it('single-range sed -n still works (regression)', () => {
    const spans = parseCommand(`sed -n '10,20p' ${join(dir, 'twenty.txt')}`);
    expect(spans).toEqual([{ lineStart: 10, lineEnd: 20, absolutePath: join(dir, 'twenty.txt') }]);
  });

  it('mixed script (range + non-range segments) only emits matching ranges', () => {
    const spans = parseCommand(`sed -n '2,4p;d;6,8p' ${join(dir, 'twenty.txt')}`);
    expect(spans).toEqual([
      { lineStart: 2, lineEnd: 4, absolutePath: join(dir, 'twenty.txt') },
      { lineStart: 6, lineEnd: 8, absolutePath: join(dir, 'twenty.txt') }
    ]);
  });
});

describe('sed -n range', () => {
  it('numeric,numeric', () => {
    const spans = parseCommand(`sed -n '10,20p' ${join(dir, 'twenty.txt')}`);
    expect(spans).toEqual([{ lineStart: 10, lineEnd: 20, absolutePath: join(dir, 'twenty.txt') }]);
  });

  it('numeric,$ resolves against real EOF', () => {
    const spans = parseCommand(`sed -n '15,$p' ${join(dir, 'twenty.txt')}`);
    expect(spans).toEqual([{ lineStart: 15, lineEnd: 20, absolutePath: join(dir, 'twenty.txt') }]);
  });

  it('single line address', () => {
    const spans = parseCommand(`sed -n '3p' ${join(dir, 'five.txt')}`);
    expect(spans).toEqual([{ lineStart: 3, lineEnd: 3, absolutePath: join(dir, 'five.txt') }]);
  });

  it('unquoted numeric range', () => {
    const spans = parseCommand(`sed -n 1,4p ${join(dir, 'five.txt')}`);
    expect(spans).toEqual([{ lineStart: 1, lineEnd: 4, absolutePath: join(dir, 'five.txt') }]);
  });

  it('no -n flag does not match (prints whole file plus dupes, not a range read)', () => {
    expect(parseCommand(`sed 's/a/b/' ${join(dir, 'five.txt')}`)).toEqual([]);
  });

  it('embedded in a larger && chain: an opaque first stage poisons the chain (plan §2 owned consequence)', () => {
    // `echo` is not a known-status stage — its unknown status gates everything
    // downstream in the `&&` chain, so sed never emits (plan §2: `echo start &&
    // sed f` emits nothing).
    const spans = parseCommand(`echo start && sed -n '1,2p' ${join(dir, 'five.txt')} && echo done`);
    expect(spans).toEqual([]);
  });

  it('a known-success gate opens: true && sed emits the range', () => {
    const spans = parseCommand(`true && sed -n '1,2p' ${join(dir, 'five.txt')}`);
    expect(spans).toEqual([{ lineStart: 1, lineEnd: 2, absolutePath: join(dir, 'five.txt') }]);
  });
});

describe('head', () => {
  it('-n N with file', () => {
    const spans = parseCommand(`head -n 5 ${join(dir, 'twenty.txt')}`);
    expect(spans).toEqual([{ lineStart: 1, lineEnd: 5, absolutePath: join(dir, 'twenty.txt') }]);
  });

  it('legacy -N form', () => {
    const spans = parseCommand(`head -30 ${join(dir, 'twenty.txt')}`);
    expect(spans).toEqual([{ lineStart: 1, lineEnd: 20, absolutePath: join(dir, 'twenty.txt') }]);
  });

  it('no count defaults to 10', () => {
    const spans = parseCommand(`head ${join(dir, 'twenty.txt')}`);
    expect(spans).toEqual([{ lineStart: 1, lineEnd: 10, absolutePath: join(dir, 'twenty.txt') }]);
  });

  it('no trailing file (reading stdin/a pipe) does not match', () => {
    expect(parseCommand('git log --oneline | head -20')).toEqual([]);
  });
});

describe('tail', () => {
  it('-n +N (from start) resolves against real EOF', () => {
    const spans = parseCommand(`tail -n +18 ${join(dir, 'twenty.txt')}`);
    expect(spans).toEqual([{ lineStart: 18, lineEnd: 20, absolutePath: join(dir, 'twenty.txt') }]);
  });

  it('-n N (from end) resolves against real EOF', () => {
    const spans = parseCommand(`tail -n 3 ${join(dir, 'twenty.txt')}`);
    expect(spans).toEqual([{ lineStart: 18, lineEnd: 20, absolutePath: join(dir, 'twenty.txt') }]);
  });

  it('-f (follow) is disqualified: open-ended, not a bounded range', () => {
    expect(parseCommand(`tail -f ${join(dir, 'twenty.txt')}`)).toEqual([]);
  });

  it('missing file: idiom matched but unresolved, not silently wrong', () => {
    const detailed = parseCommandDetailed(`tail -n 5 ${join(dir, 'does-not-exist.txt')}`);
    expect(detailed.length).toBe(1);
    expect(detailed[0].status).toBe('unresolved');
  });
});

describe('git show rev:path', () => {
  let repo: { root: string; cleanup: () => void };
  beforeAll(() => {
    repo = makeTempRepo();
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo.root });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo.root });
    writeFileSync(join(repo.root, 'blob.ts'), 'a\nb\nc\nd\ne\nf\ng\nh\n');
    execFileSync('git', ['add', 'blob.ts'], { cwd: repo.root });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo.root });
  });
  afterAll(() => repo.cleanup());

  it('HEAD:path resolves whole-file range from the real blob', () => {
    const spans = parseCommand('git show HEAD:blob.ts', { cwd: repo.root });
    expect(spans).toEqual([{ lineStart: 1, lineEnd: 8, absolutePath: join(repo.root, 'blob.ts') }]);
  });

  it('git -C <dir> show rev:path uses -C as the resolution directory', () => {
    const spans = parseCommand(`git -C ${repo.root} show HEAD:blob.ts`, { cwd: '/' });
    expect(spans).toEqual([{ lineStart: 1, lineEnd: 8, absolutePath: join(repo.root, 'blob.ts') }]);
  });

  it('git show without a rev:path colon does not match', () => {
    expect(parseCommand('git show HEAD --stat', { cwd: repo.root })).toEqual([]);
  });

  it('unknown revision: matched idiom, unresolved result', () => {
    const detailed = parseCommandDetailed('git show not-a-real-rev:blob.ts', { cwd: repo.root });
    expect(detailed.length).toBe(1);
    expect(detailed[0].status).toBe('unresolved');
  });

  it('piped into sed -n emits only the narrow range (the window algebra absorbs the one-hop whole-file read)', () => {
    const spans = parseCommand("git show HEAD:blob.ts | sed -n '2,4p'", { cwd: repo.root });
    expect(spans).toEqual([{ lineStart: 2, lineEnd: 4, absolutePath: join(repo.root, 'blob.ts') }]);
  });

  it('piped into head -N', () => {
    const spans = parseCommand('git show HEAD:blob.ts | head -3', { cwd: repo.root });
    expect(spans).toEqual([{ lineStart: 1, lineEnd: 3, absolutePath: join(repo.root, 'blob.ts') }]);
  });
});

describe('git log -L', () => {
  it('fully literal, needs no fs/git access', () => {
    const spans = parseCommand('git log -L 12,40:src/Router.ts');
    expect(spans).toEqual([{ lineStart: 12, lineEnd: 40, absolutePath: join(process.cwd(), 'src/Router.ts') }]);
  });

  it('fused -L12,40:path form', () => {
    const spans = parseCommand('git log -L12,40:src/Router.ts');
    expect(spans).toEqual([{ lineStart: 12, lineEnd: 40, absolutePath: join(process.cwd(), 'src/Router.ts') }]);
  });
});

describe('heredoc writes', () => {
  it('cat > file <<EOF overwrite: whole body is the range, and the span carries the body', () => {
    const cmd = `cat > ${join(dir, 'out1.txt')} <<'EOF'\nalpha\nbeta\ngamma\nEOF\n`;
    const spans = parseCommand(cmd);
    expect(spans).toEqual([
      { lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'out1.txt'), body: 'alpha\nbeta\ngamma', redirect: '>' }
    ]);
  });

  it('cat >> file <<EOF append: range starts after existing EOF, and the span carries the appended body', () => {
    const target = join(dir, 'five.txt');
    const cmd = `cat >> ${target} <<'EOF'\nnew1\nnew2\nEOF\n`;
    const spans = parseCommand(cmd);
    expect(spans).toEqual([{ lineStart: 6, lineEnd: 7, absolutePath: target, body: 'new1\nnew2', redirect: '>>' }]);
  });

  it('heredoc body containing && is not mis-split by the outer command splitter', () => {
    const cmd = `cat > ${join(dir, 'out2.sh')} <<'EOF'\necho a && echo b\necho c\nEOF\n`;
    const spans = parseCommand(cmd);
    expect(spans).toEqual([
      { lineStart: 1, lineEnd: 2, absolutePath: join(dir, 'out2.sh'), body: 'echo a && echo b\necho c', redirect: '>' }
    ]);
  });

  it('two heredocs in one command both resolve, in order', () => {
    const cmd = `cat > ${join(dir, 'a.txt')} <<'EOF'\nx\nEOF\ncat > ${join(dir, 'b.txt')} <<'EOF'\ny\nz\nEOF\n`;
    const spans = parseCommand(cmd);
    expect(spans).toEqual([
      { lineStart: 1, lineEnd: 1, absolutePath: join(dir, 'a.txt'), body: 'x', redirect: '>' },
      { lineStart: 1, lineEnd: 2, absolutePath: join(dir, 'b.txt'), body: 'y\nz', redirect: '>' }
    ]);
  });

  it('empty-body > heredoc truncates the file: emits a write span with an empty body', () => {
    const target = join(dir, 'trunc.txt');
    const cmd = `cat > ${target} <<'EOF'\nEOF\n`;
    const detailed = parseCommandDetailed(cmd);
    expect(detailed).toEqual([
      {
        status: 'resolved',
        idiom: 'heredoc-write',
        span: { lineStart: 1, lineEnd: 1, absolutePath: target, body: '', redirect: '>' }
      }
    ]);
  });

  it('empty-body >> heredoc appends nothing: no span', () => {
    const cmd = `cat >> ${join(dir, 'five.txt')} <<'EOF'\nEOF\n`;
    expect(parseCommand(cmd)).toEqual([]);
  });
});

describe('pipe-source propagation (one hop only)', () => {
  it('cat file | head -N', () => {
    const spans = parseCommand(`cat ${join(dir, 'twenty.txt')} | head -3`);
    expect(spans).toEqual([{ lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'twenty.txt') }]);
  });

  it('nl file | sed -n range', () => {
    const spans = parseCommand(`nl -ba ${join(dir, 'twenty.txt')} | sed -n '2,4p'`);
    expect(spans).toEqual([{ lineStart: 2, lineEnd: 4, absolutePath: join(dir, 'twenty.txt') }]);
  });

  it('does not propagate two hops: a non-consumer middle stage severs the window, the source emits its whole-file read', () => {
    const spans = parseCommand(`cat ${join(dir, 'twenty.txt')} | grep foo | head -3`);
    expect(spans).toEqual([{ lineStart: 1, lineEnd: 20, absolutePath: join(dir, 'twenty.txt') }]);
  });

  it('cat file | newline sed -n: the newline continues the pipeline (no standalone cat span, precise range)', () => {
    const spans = parseCommand(`cat ${join(dir, 'twenty.txt')} |\nsed -n '2,4p'`);
    expect(spans).toEqual([{ lineStart: 2, lineEnd: 4, absolutePath: join(dir, 'twenty.txt') }]);
  });

  it('cat file | newline head -N: the newline continues the pipeline', () => {
    const spans = parseCommand(`cat ${join(dir, 'twenty.txt')} |\nhead -3`);
    expect(spans).toEqual([{ lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'twenty.txt') }]);
  });

  it('plain newline still separates commands: standalone cat span stays', () => {
    const spans = parseCommand(`cat ${join(dir, 'twenty.txt')}\nhead -3 ${join(dir, 'five.txt')}`);
    expect(spans).toEqual([
      { lineStart: 1, lineEnd: 20, absolutePath: join(dir, 'twenty.txt') },
      { lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'five.txt') }
    ]);
  });
});

describe('cd tracking within one command', () => {
  it('cd /abs; relative sed resolves against the new dir', () => {
    const spans = parseCommand(`cd ${dir}; sed -n '1,2p' five.txt`, { cwd: '/nonexistent' });
    expect(spans).toEqual([{ lineStart: 1, lineEnd: 2, absolutePath: join(dir, 'five.txt') }]);
  });

  it('cd /abs && sed emits nothing: cd is opaque and poisons the && chain (plan §2 owned consequence)', () => {
    // `cd` is not a known-status stage — plan §2 owns `cd X && sed f` → nothing.
    const spans = parseCommand(`cd ${dir} && sed -n '1,2p' five.txt`, { cwd: '/nonexistent' });
    expect(spans).toEqual([]);
  });

  it('cd "$VAR" (unresolvable) falls back to the seed cwd, not "/"', () => {
    const spans = parseCommand('cd "$WORKSPACE_PATH"; sed -n \'1,2p\' five.txt', { cwd: dir });
    expect(spans).toEqual([{ lineStart: 1, lineEnd: 2, absolutePath: join(dir, 'five.txt') }]);
  });
});

describe('unresolvable paths are excluded from parseCommand, surfaced by parseCommandDetailed', () => {
  it('shell variable in path', () => {
    expect(parseCommand('sed -n \'1,2p\' "$D/file.txt"')).toEqual([]);
    const detailed = parseCommandDetailed('sed -n \'1,2p\' "$D/file.txt"');
    expect(detailed.length).toBe(1);
    expect(detailed[0].status).toBe('unresolved');
  });

  it('glob in path', () => {
    expect(parseCommand('head -5 *.txt')).toEqual([]);
  });
});

describe('multiple statements in one command', () => {
  it('two sed calls resolve independently, in order', () => {
    const spans = parseCommand(`sed -n '1,2p' ${join(dir, 'five.txt')}; sed -n '3,4p' ${join(dir, 'twenty.txt')}`);
    expect(spans).toEqual([
      { lineStart: 1, lineEnd: 2, absolutePath: join(dir, 'five.txt') },
      { lineStart: 3, lineEnd: 4, absolutePath: join(dir, 'twenty.txt') }
    ]);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — execution-aware walk contract.
//
// Every fixture bullet of plans/execution-aware-walk.md's Phase 2 section,
// transcribed as checks (one `describe.skip` group per concern, so each
// concern can be unskipped once its machinery lands). The commands below use
// the plan's arrow form — command → expected touches — with the plan's
// parenthetical annotations as row notes. `[]` means no touches; `1–2` means
// a line range; "whole-file" means a whole-file touch; `+`-separated entries
// mean multiple touches in order. Descriptors are canonicalized against the
// fixture cwd (files resolve to absolute paths, whole-file 1..TOTAL collapses
// to `{ file }`) before comparison with the walk's `SpanMatch[]` output.
//
// The Phase 2 splitter machinery (plan §3) is implemented: the kind-matched
// construct stack, the case-region machine, and the heredoc machinery in
// shell-split.ts decide sections 2, 3, 4, and 15, so their rows run. The
// execution walk (`analyzeExecution`, plan §2) decides the walk-owned rows in
// sections 1, 2, 4, 5, 7, 8, 9, 10, and 15. Still skipped: the sections that
// depend on stripRedirects (plan §4, the rows of section 1/6), the
// wrapper/variable surfaces (§5/§7), and the workdir threading (§6/§8) land in
// later dispatches.
// ---------------------------------------------------------------------------

type ExpectedTouch = { file: string; lo?: number; hi?: number } | { write: string } | { unresolved: string };
type CanonicalTouch = { file: string; lo?: number; hi?: number } | { write: string } | { unresolved: string };
type FixtureRow = readonly [
  cmd: string,
  expected: ExpectedTouch[],
  opts: ParseOptions | undefined,
  note: string | undefined
];

// The fixture dirs are created at module scope, not in beforeAll: the rows of
// the it.each tables below embed their absolute paths at collection time, and
// collection runs before any hook.
const TOTAL = 20;
const twentyLines = Array.from({ length: TOTAL }, (_, i) => `line ${i + 1}`).join('\n');
const p2Dir = mkdtempSync(join(tmpdir(), 'execution-aware-walk-'));
for (const name of ['f', 'g', 'h', 'a', 'b']) writeFileSync(join(p2Dir, name), `${twentyLines}\n`);
mkdirSync(join(p2Dir, 'sub'));
writeFileSync(join(p2Dir, 'sub', 'f'), `${twentyLines}\n`);
const p2Repo = (() => {
  const repo = makeTempRepo();
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo.root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo.root });
  writeFileSync(join(repo.root, 'f'), `${twentyLines}\n`);
  execFileSync('git', ['add', 'f'], { cwd: repo.root });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo.root });
  return repo;
})();

afterAll(() => {
  rmSync(p2Dir, { recursive: true, force: true });
  p2Repo.cleanup();
});

describe('execution-aware walk — Phase 2 contract', () => {
  const whole = (file: string): ExpectedTouch => ({ file });
  const range = (file: string, lo: number, hi: number): ExpectedTouch => ({ file, lo, hi });
  const writeTo = (file: string): ExpectedTouch => ({ write: file });
  const unresolved = (fileArg: string): ExpectedTouch => ({ unresolved: fileArg });

  /** Walk output → canonical descriptor space. */
  function canonicalize(matches: SpanMatch[]): CanonicalTouch[] {
    return matches.map((m) => {
      if (m.status === 'unresolved') return { unresolved: m.fileArg };
      if (m.idiom === 'heredoc-write') return { write: m.span.absolutePath };
      const { lineStart, lineEnd } = m.span;
      if (lineStart === 1 && lineEnd === TOTAL) return { file: m.span.absolutePath };
      return { file: m.span.absolutePath, lo: lineStart, hi: lineEnd };
    });
  }

  /** Expected descriptor → canonical descriptor (relative names join against the base). */
  function canonicalizeTouch(e: ExpectedTouch, base: string): CanonicalTouch {
    if ('write' in e) return { write: join(base, e.write) };
    if ('unresolved' in e) return { unresolved: e.unresolved };
    if (e.lo === undefined || (e.lo === 1 && e.hi === TOTAL)) return { file: join(base, e.file) };
    return { file: join(base, e.file), lo: e.lo, hi: e.hi };
  }

  /** Parse `cmd` and assert the walk's touches equal the expected set. */
  function expectTouches(cmd: string, expected: ExpectedTouch[], opts: ParseOptions = {}): void {
    const cwd = opts.cwd ?? p2Dir;
    const matches = parseCommandDetailed(cmd, { cwd, env: {}, ...opts });
    expect(canonicalize(matches)).toEqual(expected.map((e) => canonicalizeTouch(e, cwd)));
  }

  describe('1. operators — full union, continuation gate, redirect-&, read-side stripping', () => {
    it('emits the full operator union per boundary', () => {
      const ops = splitTopLevel('a && b || c; d\ne & f | g |& h').stages.map((s) => s.precededBy);
      expect(ops).toEqual(['start', 'and', 'or', 'semicolon', 'newline', 'background', 'pipe', 'pipe']);
    });

    it("|& splits as 'pipe'", () => {
      const ops = splitTopLevel("cat f |& sed -n '1,2p' g").stages.map((s) => s.precededBy);
      expect(ops).toEqual(['start', 'pipe']);
    });

    it("& splits as 'background'", () => {
      const ops = splitTopLevel("false & sed -n '1,2p' f").stages.map((s) => s.precededBy);
      expect(ops).toEqual(['start', 'background']);
    });

    it('a trailing & is a clean background boundary, not a junk stage', () => {
      expect(splitTopLevel("sed -n '1,2p' f > /dev/null &").stages).toEqual([
        { text: "sed -n '1,2p' f > /dev/null", precededBy: 'start' }
      ]);
    });

    const ROWS: FixtureRow[] = [
      ["false &&\nsed -n '1,2p' f", [], undefined, 'newline preserves the and gate — the sed is still gated off'],
      [
        'false ||\ncat f',
        [whole('f')],
        undefined,
        'newline preserves the or gate — the failed predicate opens it (the plan L163 "true ||" spelling contradicts §2 and group 8: true || X runs nothing in bash)'
      ],
      ['cat f |\nhead -3', [range('f', 1, 3)], undefined, 'existing pipe continuation'],
      [
        'cat f | head -1\ncat g',
        [range('f', 1, 1), whole('g')],
        undefined,
        'newline after a complete stage is a separator — the walk must not merge cat g into the pipeline'
      ],
      ['cat f\nhead -3 g', [whole('f'), range('g', 1, 3)], undefined, 'unchanged']
    ];

    const REDIRECT_ROWS: FixtureRow[] = [
      ["cat f 2>&1 && sed -n '1,2p' g", [whole('f')], undefined, undefined],
      [
        "cat f 2>&1 | sed -n '2,4p'",
        [range('f', 2, 4)],
        undefined,
        'stripped source is a clean one-file cat; 2>&1 never severs'
      ],
      [
        'cat f &> /dev/null | head -3',
        [whole('f')],
        undefined,
        "&> is a stdout-form redirect — the source's pipe is empty, head consumes nothing"
      ],
      ['head -3 f > out', [range('f', 1, 3)], undefined, undefined],
      ["sed -n '1,5p' f > out", [range('f', 1, 5)], undefined, undefined],
      ['cat f > out', [whole('f')], undefined, undefined],
      ['cat f | head -3 > out', [range('f', 1, 3)], undefined, undefined],
      ["sed -n '1,2p' f > /dev/null &", [range('f', 1, 2)], undefined, 'clean background boundary']
    ];

    it.each<FixtureRow>(ROWS)('%s', (cmd, expected, opts) => {
      expectTouches(cmd, expected, opts);
    });

    it.each<FixtureRow>(REDIRECT_ROWS)('%s', (cmd, expected, opts) => {
      expectTouches(cmd, expected, opts);
    });
  });

  describe('2. malformed — verdict kinds and list scope', () => {
    it.skip('every expectation is probe-pinned against bash (exit 2 — bash parses the full text, errors, and runs nothing)', () => {
      expect(true).toBe(true);
    });

    const ROWS: FixtureRow[] = [
      ["cat f && echo 'oops", [], undefined, "unclosed quote loses cat f's read too"],
      ["sed -n '1,2p' f &&", [], undefined, undefined],
      ['cat f &&\n', [], undefined, 'dangling operator across a continuation newline'],
      ['cat f |', [], undefined, undefined],
      ['cat f |&', [], undefined, undefined],
      ["sed -n '1,2p' f && # note", [], undefined, "a trailing comment doesn't rescue an unconsumed operator"],
      ['echo $((1+2', [], undefined, 'unclosed paren at EOF'],
      ["cat f && echo x) && sed -n '1,2p' g", [], undefined, 'stray ) at depth 0'],
      ["cat f | ! sed -n '1,2p' g", [], undefined, undefined],
      ['false | ! true', [], undefined, undefined],
      ['cat f &', [whole('f')], undefined, 'trailing & is valid background'],
      ['cat f;', [whole('f')], undefined, 'valid terminator'],
      ['cat f <<', [], undefined, '<< with no delimiter word — the dangling-redirect branch of dangling-operator'],
      ["cat f\necho 'oops", [whole('f')], undefined, undefined],
      ['cat f\nsed g &&', [whole('f')], undefined, undefined],
      ["echo 'oops\ncat f", [], undefined, 'the open quote carries both lines into one list']
    ];

    // This row's expectation is determined by analyzeExecution (the
    // opaque-gate bar on the `&&` chain, not the splitter verdict).
    const SKIPPED_ROWS: FixtureRow[] = [
      [
        "cat f <<EOF && sed -n '1,2p' g",
        [whole('f')],
        undefined,
        "sed gates on cat's unknown status — the opaque-gate bar, not the verdict"
      ]
    ];

    // These rows are decided by the heredoc machinery, the case-region
    // machine, the construct machine, and the list-scope verdict semantics —
    // all Phase 2 splitter machinery (plan §3).
    const SPLITTER_ROWS: FixtureRow[] = [
      ['cat f <<EOF\nbody', [whole('f')], undefined, 'unterminated heredoc: bash warns, cat runs, the tail is body'],
      [
        "cat f <<EOF; sed -n '1,2p' g",
        [whole('f'), range('g', 1, 2)],
        undefined,
        "the delimiter's line splits normally — bash warns and runs both"
      ],
      [
        "cat f <<EOF\ncat g\nEOF\nsed -n '1,2p' h",
        [whole('f'), range('h', 1, 2)],
        undefined,
        "heredoc body is opaque — no g touch (today the body's cat g splits into a phantom stage)"
      ],
      ['cat f\nif true; then', [whole('f')], undefined, 'cat ran, then exit 2'],
      ['cat f\ncase $x in a) echo hi', [whole('f')], undefined, undefined],
      [
        "cat f\n( if true; then )\nsed -n '1,2p' g",
        [whole('f')],
        undefined,
        'the rejection is terminal — the well-formed sed after the error is dead'
      ],
      ['cat f\n( if true; then )\ncat g', [whole('f')], undefined, undefined],
      [
        "cat f\n( if true; then echo hi; fi )\nsed -n '1,2p' g",
        [whole('f'), range('g', 1, 2)],
        undefined,
        'a valid middle list walks normally, exit 0'
      ],
      ['if true; then\ncat f', [], undefined, 'the open construct carries the tail into one list'],
      ['case $x in a) cat f\ncat g', [], undefined, 'an open case region is not a boundary — unclosed-case at EOF'],
      ['if false; then\ncat f\nfi', [], undefined, 'exit 0 — the body never runs — multi-line body phantom'],
      ['cat f\nif false; then\ncat g\nfi', [whole('f')], undefined, 'exit 0 — f only']
    ];

    it.each<FixtureRow>(ROWS)('%s', (cmd, expected, opts) => {
      expectTouches(cmd, expected, opts);
    });

    it.each<FixtureRow>(SPLITTER_ROWS)('%s', (cmd, expected, opts) => {
      expectTouches(cmd, expected, opts);
    });

    it.each<FixtureRow>(SKIPPED_ROWS)('%s', (cmd, expected, opts) => {
      expectTouches(cmd, expected, opts);
    });
  });

  describe('3. malformed — delimiter-line completeness and construct balance', () => {
    const ROWS: FixtureRow[] = [
      [
        'cat f <<EOF; case $x in a) echo hi',
        [],
        undefined,
        "an unclosed case opened on the delimiter's line dominates the partial — the cat read dies"
      ],
      ['cat f <<EOF && case $x in a) echo hi', [], undefined, 'same, && form'],
      ['cat f <<EOF; if true; then echo hi', [], undefined, 'unclosed if — unclosed-construct'],
      ['cat f <<EOF; { echo hi', [], undefined, 'unclosed brace group'],
      ['cat f <<EOF; ( echo hi', [], undefined, 'unclosed subshell — unbalanced-paren dominates'],
      [
        'if true\nthen cat f <<EOF\nbody',
        [],
        undefined,
        "a construct opened before the delimiter's line, still open — exit 2"
      ],
      ['cat f <<EOF; case $x in a) echo hi;; esac; echo AFTER', [whole('f')], undefined, undefined],
      ['cat f <<EOF; if true; then echo hi; fi', [whole('f')], undefined, undefined],
      ['cat f <<EOF; { echo hi; }', [whole('f')], undefined, undefined],
      ['cat f <<EOF; for i in a b; do echo hi; done', [whole('f')], undefined, undefined],
      ['cat f <<EOF; echo {', [whole('f')], undefined, '{ in argument position is a word — nothing opens'],
      ['cat f; if true; then', [], undefined, undefined],
      ['cat f; while true; do', [], undefined, undefined],
      ['cat f; select x in a; do', [], undefined, undefined],
      ['cat f; { echo hi', [], undefined, undefined],
      ['cat f; {', [], undefined, undefined],
      ['f() { cat f', [], undefined, undefined],
      ['( if true; then ); cat f', [], undefined, undefined],
      ['echo $(if true; then) && cat f', [], undefined, undefined],
      ['echo $(if true; then); cat f', [], undefined, undefined],
      ["( if true; then ) | sed -n '1,2p' g", [], undefined, undefined],
      ['( ( if true; then ) ); cat f', [], undefined, undefined],
      [
        '( while true; do ); cat f',
        [],
        undefined,
        'an unclosed construct on a paren level fires at the ) — fire-before-restore'
      ],
      [
        'echo $(case $x in a) cat f); cat g',
        [],
        undefined,
        'a case region is not a stack — it outlives the paren close and fires unclosed-case at EOF'
      ],
      ['( if true; then echo hi; fi ); cat f', [whole('f')], undefined, undefined],
      [
        'if true; then ( echo hi ); fi; cat f',
        [whole('f')],
        undefined,
        'an outer construct survives an inner clean pop'
      ],
      ['cat f; if x; fi', [], undefined, "a closer with no body — bash: unexpected token `fi'"],
      ['cat f; for i in a b; done', [], undefined, 'no do'],
      ['cat f; then echo hi', [], undefined, undefined],
      ['cat f; do', [], undefined, undefined],
      ['cat f; elif x; then y', [], undefined, 'context keywords with no matching opener'],
      ['cat f; fi', [], undefined, undefined],
      ['cat f; done', [], undefined, undefined],
      ['cat f; }', [], undefined, undefined],
      ['cat f; esac', [], undefined, undefined],
      ['cat f; if true; then; fi', [], undefined, 'empty then-list — bash errors at the ;'],
      ['cat f; { ; }', [], undefined, undefined],
      ['if; then x; fi', [], undefined, undefined],
      ['for i in a b; do; done', [], undefined, undefined],
      ['if x; then y; else; fi', [], undefined, undefined],
      ['{ }', [], undefined, undefined],
      ['f() { }', [], undefined, undefined],
      ['{ echo }', [], undefined, 'the } is an argument word — the group dies at EOF'],
      ['cat f; if true; then echo hi; fi', [whole('f')], undefined, undefined],
      ['cat f; for i in a b; do echo hi; done', [whole('f')], undefined, undefined],
      ['cat f; { echo hi; }', [whole('f')], undefined, undefined],
      ['cat f; until true; do echo hi; done', [whole('f')], undefined, undefined],
      [
        'cat f; if x; then y; fi',
        [whole('f')],
        undefined,
        'valid bash — x fails at runtime, exit 127, the list still runs'
      ],
      [
        "cat f; if true; then echo hi; fi; sed -n '1,2p' g",
        [whole('f'), range('g', 1, 2)],
        undefined,
        'constructs fold to one stage — the tail still runs'
      ],
      ['cat f; echo hi }', [whole('f')], undefined, 'argument-position } is a word'],
      ['echo then', [], undefined, 'argument-position keywords are words — valid bash, echo opaque'],
      ['echo fi', [], undefined, undefined],
      ['f() { cat f; }', [], undefined, 'function definition — exit 0, the body never runs'],
      ['function f { cat f; }', [], undefined, undefined],
      ['if true; then\nx; fi', [], undefined, 'newline after then is fine — x fails at runtime, construct valid']
    ];

    it.each<FixtureRow>(ROWS)('%s', (cmd, expected, opts) => {
      expectTouches(cmd, expected, opts);
    });
  });

  describe('4. malformed — case regions (every valid shape probe-pinned)', () => {
    // These rows' expectations are determined by analyzeExecution — the
    // executed-assignment table and the opaque-gate bar on the `&&` chain.
    const SKIPPED_ROWS: FixtureRow[] = [
      [
        "x=a; case $x in a) cat f;; esac; sed -n '1,2p' g",
        [whole('f'), range('g', 1, 2)],
        undefined,
        'the subject $x resolves to a from the executed-assignment table and the pattern is fully literal — the decidable-control rule attributes the matched branch'
      ],
      ["case $x in a) sed -n '1,2p' g;; esac && cat f", [], undefined, 'opaque case stage gates the tail']
    ];

    const ROWS: FixtureRow[] = [
      [
        'case $x in a|b) cat f;; esac',
        [],
        undefined,
        'in-pattern | is pattern syntax, not a pipe split — and the region is opaque'
      ],
      [
        'case $x in a) case $y in b) cat f;; esac;; esac',
        [],
        undefined,
        'nested regions — the inner case is region text; the outer region is one opaque stage'
      ],
      [
        'for i in a; do case $i in a) cat f;; esac; done',
        [],
        undefined,
        '$i is a loop variable, never bound into the assignment table — a fail-closed miss'
      ],
      [
        'case $x in a) echo case;; esac; cat f',
        [whole('f')],
        undefined,
        "the region is one opaque case stage — the body's echo case never touches"
      ],
      [
        'case $x in a|esac) cat f;; esac',
        [],
        undefined,
        'mid-pattern esac is a pattern word — and the region is opaque'
      ],
      ['case $x in a) echo $(echo esac);; esac; cat f', [whole('f')], undefined, 'esac inside $(…) never closes'],
      [
        'case $x in a) cat f <<EOF\nbody\nEOF;; esac',
        [],
        undefined,
        'the delimiter line EOF;; esac is not a bare EOF — the heredoc swallows the esac — nothing runs'
      ],
      [
        "cat f && case $x in a) sed -n '1,2p' g;; esac",
        [whole('f')],
        undefined,
        "one cat-argv stage — the region's sed is an argument, never matches"
      ],
      ['case $x in a) cat f', [], undefined, 'unclosed region — exit 2'],
      ['case $x in a) cat f <<EOF\nbody', [], undefined, 'the esac is swallowed by the unterminated heredoc body'],
      ['echo $(case $x in a) cat f;; esac)', [], undefined, 'one opaque echo stage'],
      ['echo case; cat f', [whole('f')], undefined, 'argument-position case opens nothing']
    ];

    it.each<FixtureRow>(ROWS)('%s', (cmd, expected, opts) => {
      expectTouches(cmd, expected, opts);
    });

    it.each<FixtureRow>(SKIPPED_ROWS)('%s', (cmd, expected, opts) => {
      expectTouches(cmd, expected, opts);
    });
  });

  describe('5. malformed — decidable constructs (every expectation probe-pinned against GNU bash 5.2.37)', () => {
    const ROWS: FixtureRow[] = [
      ['if true; then cat f; fi', [whole('f')], undefined, undefined],
      ["if true; then cat f; else sed -n '1,2p' g; fi", [whole('f')], undefined, 'else dead'],
      ["if false; then cat f; fi; sed -n '1,2p' g", [range('g', 1, 2)], undefined, 'no-branch exits 0'],
      [
        "if false; then cat f; fi && sed -n '1,2p' g",
        [range('g', 1, 2)],
        undefined,
        'the known-success status opens the gate'
      ],
      [
        "if true; then cat f; fi && sed -n '1,2p' g",
        [whole('f')],
        undefined,
        'a branch-final one-file source is unknown status — the gate closes; the range loss is the acknowledged fail-closed divergence'
      ],
      ["x=a; case $x in a) cat f;; esac && sed -n '1,2p' g", [whole('f')], undefined, 'the case-&& twin, same rule'],
      ["if false; then cat f; elif true; then sed -n '1,2p' g; fi", [range('g', 1, 2)], undefined, 'elif chain'],
      ['if ! false; then cat f; fi', [whole('f')], undefined, 'known-status condition lists'],
      ['if false || true; then cat f; fi', [whole('f')], undefined, undefined],
      ['if grep -q x f; then cat g; fi', [], undefined, 'unknown condition stays opaque'],
      ["while false; do cat f; done; sed -n '1,2p' g", [range('g', 1, 2)], undefined, undefined],
      ["until true; do cat f; done; sed -n '1,2p' g", [range('g', 1, 2)], undefined, undefined],
      [
        "while true; do break; done; sed -n '1,2p' g",
        [range('g', 1, 2)],
        undefined,
        'an own-depth break completes one iteration and exits the loop'
      ],
      [
        "while true; do cat f; break; done; sed -n '1,2p' g",
        [whole('f'), range('g', 1, 2)],
        undefined,
        'the pre-break body runs once'
      ],
      [
        "while true; do cat f; break; cat g; done; sed -n '1,2p' h",
        [whole('f'), range('h', 1, 2)],
        undefined,
        'the break terminates the body list'
      ],
      [
        "while true; do break; done && sed -n '1,2p' g",
        [range('g', 1, 2)],
        undefined,
        'a break-exiting loop exits success — the gate opens'
      ],
      [
        "while true; do if true; then break; fi; done; sed -n '1,2p' g",
        [range('g', 1, 2)],
        undefined,
        "a decidable guard's break surfaces as an own-depth stage"
      ],
      [
        "while true; do if false; then break; fi; done; sed -n '1,2p' g",
        [],
        undefined,
        'the break provably never fires — the loop never exits (timeout 124)'
      ],
      [
        "while true; do continue; done; sed -n '1,2p' g",
        [],
        undefined,
        'an own-depth continue never returns (timeout 124)'
      ],
      [
        "while true; do continue; break; done; sed -n '1,2p' g",
        [],
        undefined,
        'the continue runs first — the break is dead'
      ],
      ["while true; do break; continue; done; sed -n '1,2p' g", [range('g', 1, 2)], undefined, 'the break runs first'],
      [
        "while true; do while true; do break; done; done; sed -n '1,2p' g",
        [],
        undefined,
        'the inner break exits the inner loop only'
      ],
      [
        "while true; do while true; do break 2; done; done; sed -n '1,2p' g",
        [range('g', 1, 2)],
        undefined,
        'the depth-2 escape registers with the outer loop'
      ],
      [
        "while true; do cat f; if grep -q c f; then break; fi; done; sed -n '1,2p' g",
        [whole('f'), range('g', 1, 2)],
        undefined,
        'a break hidden in an opaque guard — ambiguous termination — the certain prefix attributes, the sed phantom when the guard never fires is the owned cost'
      ],
      [
        "while true; do cat f; if grep -q c f; then echo hi; fi; done; sed -n '1,2p' g",
        [whole('f')],
        undefined,
        'no break anywhere — the loop provably never exits'
      ],
      [
        "while true; do if grep -q zzz f; then break; else exit 1; fi; done; sed -n '1,2p' g",
        [],
        undefined,
        'the hidden exit fires fail-closed — bash exits 1, nothing runs'
      ],
      [
        "f() { break; }; while true; do f; done; sed -n '1,2p' g",
        [],
        undefined,
        'a def-body break is a runtime error — never a loop exit — the loop provably never exits'
      ],
      [
        "for i in a b; do cat f; done; sed -n '1,2p' g",
        [whole('f'), range('g', 1, 2)],
        undefined,
        'non-empty literal list — body runs, loop exits 0'
      ],
      ["for i in; do cat f; done; sed -n '1,2p' g", [range('g', 1, 2)], undefined, 'empty list — body never runs'],
      ['{ cat f; }', [whole('f')], undefined, undefined],
      ['( cat f )', [whole('f')], undefined, undefined],
      [
        '( cd sub; cat f )',
        [whole('sub/f')],
        undefined,
        "a subshell cd re-bases within the subshell's fresh directory frame only"
      ],
      [
        "x=a; case $x in a) cat f;; esac; sed -n '1,2p' g",
        [whole('f'), range('g', 1, 2)],
        undefined,
        'the decidable match — tracked a subject, literal pattern'
      ],
      [
        "x=a; case $x in a) cat f;; *) sed -n '1,2p' g;; esac",
        [whole('f')],
        undefined,
        'first literal match wins — the glob branch is dead and unconstrained'
      ],
      [
        "x=a; case $x in a|*) cat f;; esac; sed -n '1,2p' g",
        [whole('f'), range('g', 1, 2)],
        undefined,
        'the first | alternative matches — decidable'
      ],
      [
        "x=a; case $x in *|a) cat f;; esac; sed -n '1,2p' g",
        [range('g', 1, 2)],
        undefined,
        'a glob alternative before any literal match — undecidable — the case contributes nothing'
      ],
      [
        "x=a; case $x in b) cat f;; a) cat g;; esac; sed -n '1,2p' h",
        [whole('g'), range('h', 1, 2)],
        undefined,
        'earlier patterns are literal non-matches'
      ],
      [
        'x=a; case $x in a) echo "esac"; cat f;; esac; sed -n \'1,2p\' g',
        [whole('f'), range('g', 1, 2)],
        undefined,
        'quoted esac is body text — the quote-aware clause scan'
      ],
      [
        'x=a; case $x in a) echo "x;; y"; cat f;; esac; sed -n \'1,2p\' g',
        [whole('f'), range('g', 1, 2)],
        undefined,
        'quoted ;; is body text'
      ],
      [
        "x=b; case $x in a) cat f;; esac && sed -n '1,2p' g",
        [range('g', 1, 2)],
        undefined,
        'decidable no-match exits 0 — the gate opens'
      ],
      [
        "x=a; case $x in a) cat f | sed -n '2,4p';; esac",
        [range('f', 2, 4)],
        undefined,
        "the matched branch's pipeline narrows"
      ],
      [
        'x=a; case $x in "a") cat f;; esac',
        [whole('f')],
        undefined,
        'quoted literals — quotes stripped, glob chars literal'
      ],
      ["x='a*'; case $x in 'a*') cat f;; esac", [whole('f')], undefined, undefined],
      [
        'x=a; case $x in a) if true; then cat f; fi;; esac',
        [whole('f')],
        undefined,
        'nested decidable constructs evaluate recursively'
      ],
      [
        'x=a; case $x in a) { cat f; };; esac',
        [whole('f')],
        undefined,
        'unconditional groups inside a branch evaluate recursively'
      ],
      [
        "x=a; case $x in *) sed -n '1,2p' g;; a) cat f;; esac",
        [],
        undefined,
        'glob before the literal — bash prints 1–2 of g'
      ],
      ['x=a; case $x in a|b) cat f;; esac', [], undefined, 'alternation — bash prints f'],
      ['x=a; case $x in a) cat f;;& b) cat g;; esac', [], undefined, ';;& fallthrough — bash prints f'],
      ['case $x in a) cat f;; esac', [], undefined, 'unresolvable subject — bash runs nothing here'],
      [
        'x=a; case $x in a) if true; then;; esac',
        [],
        undefined,
        "a construct open at the branch's end — bash errors at the ;;"
      ],
      ['x=a; case $x in a) { cat f;; esac', [], undefined, "unclosed group at the branch's end"],
      ['x=a; case $x in a) cat f &&;; esac', [], undefined, "a dangling operator at the branch's end"],
      [
        "x=a; case $x in a) echo 'oops;; esac",
        [],
        undefined,
        "the quote scan is global — the region's state never survives an unclosed quote"
      ]
    ];

    it.each<FixtureRow>(ROWS)('%s', (cmd, expected, opts) => {
      expectTouches(cmd, expected, opts);
    });
  });

  describe('6. malformed — ${…} and dangling redirect tokens', () => {
    const ROWS: FixtureRow[] = [
      ["x='abc)'; echo ${x%)}", [], undefined, 'valid bash — no verdict; echo is opaque anyway'],
      ['echo ${x//(/}', [], undefined, 'a ( inside a brace never triggers'],
      ['echo ${x', [], undefined, 'unclosed brace is a full-line parse error — the clean stage loses its read too'],
      ['cat f && echo ${x', [], undefined, undefined],
      ['cat f >', [], undefined, undefined],
      ['cat f 2>', [], undefined, undefined],
      ['cat f <<<', [], undefined, undefined],
      ['cat f >|', [], undefined, undefined],
      ['cat f <', [], undefined, undefined],
      ['cat f > # note', [], undefined, "a trailing comment doesn't rescue the token"],
      ['cat f > ; echo hi', [], undefined, undefined],
      ['cat f > & echo hi', [], undefined, undefined],
      ['cat f > | head -3', [], undefined, undefined],
      ['cat f > && echo hi', [], undefined, undefined],
      ['cat f >\nhead -3 g', [], undefined, 'a redirect target never continues onto a later line'],
      ['cat f > > out', [], undefined, 'a redirect token immediately followed by another redirect token has no target'],
      ['cat f > 2>&1', [], undefined, undefined]
    ];

    const REDIRECT_ROWS: FixtureRow[] = [
      ['cat f > out', [whole('f')], undefined, 'target present'],
      [
        'cat f > out\nhead -3 g',
        [whole('f'), range('g', 1, 3)],
        undefined,
        'completed redirect, newline then splits normally'
      ],
      ['cat f 2>&1 > out', [whole('f')], undefined, 'complete dup form followed by a targeted redirect is valid'],
      ["cat f 2>&1 | sed -n '2,4p'", [range('f', 2, 4)], undefined, 'dup form with both fds is not dangling']
    ];

    it.each<FixtureRow>(ROWS)('%s', (cmd, expected, opts) => {
      expectTouches(cmd, expected, opts);
    });

    it.each<FixtureRow>(REDIRECT_ROWS)('%s', (cmd, expected, opts) => {
      expectTouches(cmd, expected, opts);
    });
  });

  describe('7. comments', () => {
    const ROWS: FixtureRow[] = [
      ['true && # c\ncat f', [whole('f')], undefined, undefined],
      ["sed -n '1,2p' f # note", [range('f', 1, 2)], undefined, undefined],
      ['cat f # note', [whole('f')], undefined, undefined],
      ['cat f # note\nhead -3 g', [whole('f'), range('g', 1, 3)], undefined, undefined]
    ];

    // The `[]` expectation needs analyzeExecution's and-gate (the splitter
    // keeps the 'and' gate; gating off the sed is the walk's job).
    const SKIPPED_ROWS: FixtureRow[] = [
      ["false && # explain\nsed -n '1,2p' f", [], undefined, 'gate preserved across the comment']
    ];

    it.each<FixtureRow>(ROWS)('%s', (cmd, expected, opts) => {
      expectTouches(cmd, expected, opts);
    });

    it.each<FixtureRow>(SKIPPED_ROWS)('%s', (cmd, expected, opts) => {
      expectTouches(cmd, expected, opts);
    });
  });

  describe('8. control flow — chain gating, ! negation, opaque gates', () => {
    const ROWS: FixtureRow[] = [
      ["false && sed -n '1,2p' f", [], undefined, undefined],
      ["true || sed -n '1,2p' f", [], undefined, undefined],
      ["false || sed -n '1,2p' f", [range('f', 1, 2)], undefined, undefined],
      ["true && sed -n '1,2p' f", [range('f', 1, 2)], undefined, undefined],
      ["! false && sed -n '1,2p' f", [range('f', 1, 2)], undefined, undefined],
      ["false; sed -n '1,2p' f", [range('f', 1, 2)], undefined, undefined],
      [
        "false && a || sed -n '1,2p' f",
        [range('f', 1, 2)],
        undefined,
        'a is skipped by the known failure; the or re-opens the chain'
      ],
      ["false | true && sed -n '1,2p' f", [range('f', 1, 2)], undefined, 'a known-success pipeline opens the gate'],
      ["false && cat f | sed -n '1,5p'", [], undefined, undefined],
      ["true && cat f | sed -n '1,5p'", [range('f', 1, 5)], undefined, undefined],
      [
        "false && cat f | sed -n '1,5p'\ncat g",
        [whole('g')],
        undefined,
        'the gate binds only the pipeline group; the separated cat g list still runs'
      ],
      ["grep -q x f && sed -n '1,2p' g", [], undefined, undefined],
      ["grep -q x f || sed -n '1,2p' g", [], undefined, undefined],
      ["cd sub && sed -n '1,2p' f", [], undefined, undefined],
      ["cd sub; sed -n '1,2p' f", [range('sub/f', 1, 2)], undefined, undefined],
      ["! true && sed -n '1,2p' f", [], undefined, undefined],
      [
        "false && cd sub; sed -n '1,2p' f",
        [range('f', 1, 2)],
        undefined,
        "the Directories bullet's [] for this shape contradicts §2 chain semantics and this bullet; the ; opens a fresh chain and bash provably runs the sed — probe: exit 0"
      ],
      ["! ! true && sed -n '1,2p' f", [range('f', 1, 2)], undefined, 'even ! count is identity'],
      [
        "! false | true && sed -n '1,2p' f",
        [],
        undefined,
        'group-level negation of a successful pipeline — bash prints nothing'
      ],
      ["! true | false && sed -n '1,2p' f", [range('f', 1, 2)], undefined, 'negated failing pipeline gates on'],
      ["! sed -n '1,2p' f", [range('f', 1, 2)], undefined, 'leading ! strips before matcher dispatch'],
      ["echo a ! b | sed -n '1,2p'", [], undefined, 'mid-argv ! is an ordinary word — the echo stage is opaque']
    ];

    it.each<FixtureRow>(ROWS)('%s', (cmd, expected, opts) => {
      expectTouches(cmd, expected, opts);
    });
  });

  describe('9. errexit and terminators (every expectation probe-pinned)', () => {
    const ROWS: FixtureRow[] = [
      ["set -e; false; sed -n '1,2p' f", [], undefined, undefined],
      ["set -e; true; sed -n '1,2p' f", [range('f', 1, 2)], undefined, undefined],
      [
        "set -e; false && echo no; sed -n '1,2p' f",
        [range('f', 1, 2)],
        undefined,
        'exempt failure — bash provably runs sed'
      ],
      ["set -e; true && false; sed -n '1,2p' f", [], undefined, undefined],
      ["set -e; false || sed -n '1,2p' f", [range('f', 1, 2)], undefined, undefined],
      ["set -e; ! true; sed -n '1,2p' f", [range('f', 1, 2)], undefined, 'a !-inverted failure never fires errexit'],
      ["set -e; false | true; sed -n '1,2p' f", [range('f', 1, 2)], undefined, 'pipeline members are exempt'],
      ["set -e; cat f | false; sed -n '1,2p' g", [whole('f')], undefined, 'the pipeline ran, then the shell died'],
      ["set -e; grep -q x f; sed -n '1,2p' g", [], undefined, 'liveness unknowable'],
      ["set -e; grep -q x f || true; sed -n '1,2p' g", [range('g', 1, 2)], undefined, 'alive on every path'],
      ["set +e; false; sed -n '1,2p' f", [range('f', 1, 2)], undefined, 'cleared'],
      [
        "set -e; set +e | true; false; sed -n '1,2p' f",
        [],
        undefined,
        "a pipe-position set +e runs in the pipeline's subshell — the parent's errexit never clears"
      ],
      ["set -eo pipefail; true; sed -n '1,2p' f", [range('f', 1, 2)], undefined, undefined],
      [
        "set -euo pipefail; false; sed -n '1,2p' f",
        [],
        undefined,
        'the standard header spellings — the o letter consumes the next word — turn errexit on'
      ],
      ["set -euxo pipefail; false; sed -n '1,2p' f", [], undefined, undefined],
      ["set -z && sed -n '1,2p' f", [], undefined, 'an unrecognized flag never claims success'],
      ["exit 1; sed -n '1,2p' f", [], undefined, undefined],
      ["false && exit 1; sed -n '1,2p' f", [range('f', 1, 2)], undefined, 'skipped exit terminates nothing'],
      [
        "grep -q x f && exit 1; sed -n '1,2p' g",
        [],
        undefined,
        'an exit that may have run behind an opaque gate terminates fail-closed'
      ],
      [
        "builtin exit 1; sed -n '1,2p' g",
        [],
        undefined,
        "bare or command/builtin-wrapped terminator words reach the shell's builtin"
      ],
      ["builtin exec true; sed -n '1,2p' g", [], undefined, undefined],
      ["command exit 1; sed -n '1,2p' g", [], undefined, undefined],
      ["command exec true; sed -n '1,2p' g", [], undefined, undefined],
      [
        "env FOO=1 exit 1; sed -n '1,2p' g",
        [range('g', 1, 2)],
        undefined,
        "child-exec'd terminator words are inert — bash errors and continues"
      ],
      ["timeout 5 exit 1; sed -n '1,2p' g", [range('g', 1, 2)], undefined, undefined],
      ["/usr/bin/exit 1; sed -n '1,2p' g", [range('g', 1, 2)], undefined, undefined],
      [
        "builtin true && sed -n '1,2p' g",
        [range('g', 1, 2)],
        undefined,
        'the restricted builtin strip forwards to the known-status set'
      ],
      ["builtin sed -n '1,2p' f", [], undefined, 'builtin before a non-builtin errors — nothing read'],
      [
        "if grep -q c f; then exit 1; fi; sed -n '1,2p' g",
        [],
        undefined,
        'a may-run exit inside an opaque interior terminates'
      ],
      [
        "if grep -q zzz f; then exit 1; fi; sed -n '1,2p' g",
        [],
        undefined,
        'the fail-closed side — bash prints 1–2 of g, the miss is owned'
      ],
      ["if grep -q c f; then exit 1; fi && sed -n '1,2p' g", [], undefined, 'the fire kills the gated tail too'],
      [
        "for x in a b; do if grep -q c f; then exit 1; fi; done; sed -n '1,2p' g",
        [],
        undefined,
        "the fire reaches the enclosing walk through a decidable for's interior"
      ],
      [
        "for x in a b; do if grep -q c f; then exec true; fi; done; sed -n '1,2p' g",
        [],
        undefined,
        'a may-run exec inside the opaque interior fires identically'
      ],
      [
        "for x in a b; do if grep -q c f; then exec true; fi; done\nsed -n '1,2p' g",
        [],
        undefined,
        'the newline-separated twin fires identically'
      ],
      [
        "if grep -q c f; then false && exit 1; fi; sed -n '1,2p' g",
        [range('g', 1, 2)],
        undefined,
        'a known-skipped exit never fires'
      ],
      [
        "if grep -q c f; then if false; then exit 1; fi; fi; sed -n '1,2p' g",
        [range('g', 1, 2)],
        undefined,
        "a dead decidable branch's exit never fires"
      ],
      ["if grep -q c f; then if true; then exit 1; fi; fi; sed -n '1,2p' g", [], undefined, "a taken branch's does"],
      [
        "( exit 1 ); sed -n '1,2p' g",
        [range('g', 1, 2)],
        undefined,
        'the subshell is a process boundary — the exit kills only the subshell'
      ],
      [
        "( if grep -q c f; then exit 1; fi ); sed -n '1,2p' g",
        [range('g', 1, 2)],
        undefined,
        'the boundary holds through the scan'
      ],
      [
        "if grep -q c f; then exit 1; fi | sed -n '1,2p' g",
        [range('g', 1, 2)],
        undefined,
        'every pipeline position contains the exit'
      ],
      [
        "if grep -q c f; then while true; do :; done; fi; sed -n '1,2p' h",
        [],
        undefined,
        'a may-run never-exit loop inside an opaque interior fires the never-return (bash hangs, exit 124)'
      ],
      [
        "if grep -q zzz f; then while true; do :; done; fi; sed -n '1,2p' h",
        [],
        undefined,
        'the never-fired twin — bash prints 1–2 of h, the miss owned'
      ],
      [
        "( while true; do :; done ); sed -n '1,2p' g",
        [],
        undefined,
        'the never-return escapes the subshell — the parent waits for it'
      ],
      ["while true; do :; done & sed -n '1,2p' g", [range('g', 1, 2)], undefined, 'a background hang blocks nothing'],
      [
        "while true; do :; done | sed -n '1,2p' g",
        [range('g', 1, 2)],
        undefined,
        "a never-exit loop's pipeline siblings run concurrently — the sed reads while the loop spins"
      ],
      [
        "f() { while true; do :; done; }; f; sed -n '1,2p' g",
        [],
        undefined,
        'a call to a never-returning def terminates the walk'
      ],
      [
        "x=a; case $x in a) exit 1;; esac; sed -n '1,2p' g",
        [],
        undefined,
        'a decidable branch ending in exit propagates the terminator'
      ],
      ["if true; then exit 1; fi; sed -n '1,2p' g", [], undefined, undefined],
      ["for x in a b; do exit 1; done; sed -n '1,2p' g", [], undefined, undefined],
      [
        "x=a; case $x in a) exec true;; esac; sed -n '1,2p' g",
        [],
        undefined,
        'a branch-final exec propagates identically'
      ],
      ["if true; then exec true; fi; sed -n '1,2p' g", [], undefined, undefined],
      ["for x in a b; do exec true; done; sed -n '1,2p' g", [], undefined, undefined],
      [
        "f() { exit 1; }; f; sed -n '1,2p' g",
        [],
        undefined,
        'a registered def whose body may run exit makes the call terminate'
      ],
      ["f() { exit 1; }; sed -n '1,2p' g", [range('g', 1, 2)], undefined, 'a never-called def terminates nothing'],
      ["f() { exec true; }; f; sed -n '1,2p' g", [], undefined, 'the exec variant'],
      ["f() { g; }; g() { exit 1; }; f; sed -n '1,2p' g", [], undefined, 'def-to-def calls resolve transitively'],
      [
        "f() { return 1; exit 1; }; f; sed -n '1,2p' g",
        [range('g', 1, 2)],
        undefined,
        'a provably-firing return stops the body scan — the exit never fires'
      ],
      [
        "f() { if true; then return 1; fi; exit 1; }; f; sed -n '1,2p' g",
        [range('g', 1, 2)],
        undefined,
        'a decidable-selected return stops'
      ],
      [
        "f() { while true; do return 1; done; exit 1; }; f; sed -n '1,2p' g",
        [range('g', 1, 2)],
        undefined,
        'a return inside a constant-success loop stops the scan — the loop is not never-exit'
      ],
      [
        "f() { return 1; while true; do :; done; }; f; sed -n '1,2p' g",
        [range('g', 1, 2)],
        undefined,
        "the return kills the later never-exit loop's never-return registration"
      ],
      [
        "f() { if false; then return 1; fi; exit 1; }; f; sed -n '1,2p' g",
        [],
        undefined,
        'a decidable-unselected return never stops — the exit fires'
      ],
      [
        "f() { while false; do return 1; done; exit 1; }; f; sed -n '1,2p' g",
        [],
        undefined,
        'a never-run return never stops'
      ],
      [
        "f() { grep -q c f || return 1; exit 1; }; f; sed -n '1,2p' g",
        [],
        undefined,
        'an opaque-guarded return never stops — the exit fires fail-closed'
      ],
      ["exec sed -n '1,2p' f; cat g", [range('f', 1, 2)], undefined, 'exec replaces the shell — cat g never runs'],
      ["exec true; sed -n '1,2p' f", [], undefined, undefined],
      ["exec nosuchcmd; sed -n '1,2p' f", [], undefined, 'a failed exec exits a non-interactive shell'],
      ["return; sed -n '1,2p' f", [range('f', 1, 2)], undefined, 'top-level return errors, shell continues'],
      ["false & sed -n '1,2p' f", [range('f', 1, 2)], undefined, undefined],
      ["set -e; false & sed -n '1,2p' f", [range('f', 1, 2)], undefined, undefined]
    ];

    it.each<FixtureRow>(ROWS)('%s', (cmd, expected, opts) => {
      expectTouches(cmd, expected, opts);
    });
  });

  describe('10. pipefail (probe-pinned)', () => {
    const ROWS: FixtureRow[] = [
      [
        "set -eo pipefail; false | true; sed -n '1,2p' f",
        [],
        undefined,
        'the failing member kills under pipefail — bash exits 1, nothing after'
      ],
      ["set -eo pipefail; true | true; sed -n '1,2p' f", [range('f', 1, 2)], undefined, undefined],
      [
        "set -eo pipefail; cat f | false; sed -n '1,2p' g",
        [whole('f')],
        undefined,
        'the pipeline ran, then the shell died'
      ],
      [
        "set -eo pipefail; false | true || sed -n '1,2p' f",
        [range('f', 1, 2)],
        undefined,
        'the pipeline is a non-final || member — exempt, sed runs'
      ],
      ["set -eo pipefail; false | true && sed -n '1,2p' f", [], undefined, undefined],
      [
        "set -eo pipefail; grep -q x /dev/null | true; sed -n '1,2p' f",
        [],
        undefined,
        'an unknown member makes the pipeline status unknown under pipefail — liveness unknowable'
      ],
      [
        "set -eo pipefail; set +o pipefail; false | true; sed -n '1,2p' f",
        [range('f', 1, 2)],
        undefined,
        'flag cleared — bash prints on'
      ]
    ];

    it.each<FixtureRow>(ROWS)('%s', (cmd, expected, opts) => {
      expectTouches(cmd, expected, opts);
    });
  });

  describe('11. pipelines (window algebra)', () => {
    const ROWS: FixtureRow[] = [
      ["cat f | sed -n '2,4p'", [range('f', 2, 4)], undefined, '2–4 only'],
      ['cat f | head -20', [whole('f')], undefined, '1–20, clamped to the file'],
      ['cat f | head -n +5', [range('f', 1, 5)], undefined, 'probe-pinned GNU semantics — -n +N is first-N for head'],
      ['cat f | tail -5', [range('f', 16, 20)], undefined, 'last 5'],
      ["cat f | head -20 | sed -n '2,4p'", [range('f', 2, 4)], undefined, undefined],
      ["cat f | sed -n '2,4p' | head -3", [range('f', 2, 4)], undefined, undefined],
      ["cat f | head -2 | sed -n '3,4p'", [range('f', 1, 2)], undefined, 'last non-empty window'],
      ["cat f | sed -n '2,4p' | grep x", [range('f', 2, 4)], undefined, undefined],
      ['cat f | grep x | head -3', [whole('f')], undefined, undefined],
      ['cat f | grep', [whole('f')], undefined, 'grep takes no ranges'],
      ['cat f | jq .', [whole('f')], undefined, undefined],
      [
        "cat f | sed -n '2,4p;8,9p'",
        [range('f', 2, 4), range('f', 8, 9)],
        undefined,
        'bash prints exactly both ranges'
      ],
      [
        "cat f | sed -n '2,4p;8,9p' | head -1",
        [range('f', 2, 4), range('f', 8, 9)],
        undefined,
        'downstream reads fall inside the pair'
      ],
      [
        "cat f | head -2 | sed -n '3,4p;8,9p'",
        [range('f', 1, 2)],
        undefined,
        'every range clamps empty — the pre-transform window survives'
      ],
      [
        "sed -n '2,4p;8,9p' f",
        [range('f', 2, 4), range('f', 8, 9)],
        undefined,
        'direct multi-range sed keeps its two spans'
      ],
      ["git show HEAD:f | sed -n '2,4p'", [range('f', 2, 4)], { cwd: p2Repo.root }, '2–4 only'],
      ['git show HEAD:f | head -3', [range('f', 1, 3)], { cwd: p2Repo.root }, '1–3 only'],
      ['git show HEAD:f | grep x', [whole('f')], { cwd: p2Repo.root }, undefined],
      ["nl -ba f | sed -n '2,4p'", [range('f', 2, 4)], undefined, undefined],
      ["cat a | sed -n '1,5p' b", [whole('a'), range('b', 1, 5)], undefined, 'the trailing file arg is a second read'],
      ["cat f |\nsed -n '2,4p'", [range('f', 2, 4)], undefined, 'pipe-newline continuation unchanged'],
      ["cat a b | sed -n '2,4p'", [whole('a'), whole('b')], undefined, undefined],
      ['cat a b | head -3', [whole('a'), whole('b')], undefined, undefined],
      ["nl -ba a b | sed -n '2,4p'", [whole('a'), whole('b')], undefined, undefined],
      ['cat a b | grep x', [whole('a'), whole('b')], undefined, undefined],
      ["cat a - | sed -n '1,3p'", [whole('a')], undefined, 'the stdin marker disqualifies narrowing'],
      ["nl -s , a b | sed -n '2,4p'", [whole('a'), whole('b')], undefined, 'arg-taking flag consumes the ,'],
      ["cat f > out | sed -n '2,4p'", [whole('f')], undefined, 'the pipe is empty — sed prints nothing'],
      [
        "cat f | sed -n '2,4p' > out",
        [range('f', 2, 4)],
        undefined,
        'the redirect only moves output; the read happened'
      ],
      [
        "cat f | sed -n '2,4p' > out | grep x",
        [range('f', 2, 4)],
        undefined,
        'alignment severs after the redirected stage'
      ],
      ["cat f 2> err | sed -n '2,4p'", [range('f', 2, 4)], undefined, 'stderr redirects never sever'],
      [
        'cat f | head +5',
        [whole('f')],
        undefined,
        'bare +N in stdin position is a non-consumer — sever, whole-file of the source'
      ]
    ];

    // Still skipped: GNU head treats bare +N as a file (never a count), so the
    // natural expectation is the 1–10 window plus a +5 file artifact — the
    // `whole('f')` fixture is not derivable from the algebra.
    const SKIPPED_ROWS: FixtureRow[] = [
      [
        'head +5 f',
        [whole('f')],
        undefined,
        'GNU head treats bare +N as a file — the bare-+N count handling is tail-only'
      ]
    ];

    it.each<FixtureRow>(ROWS)('%s', (cmd, expected, opts) => {
      expectTouches(cmd, expected, opts);
    });

    it.skip.each<FixtureRow>(SKIPPED_ROWS)('%s', (cmd, expected, opts) => {
      expectTouches(cmd, expected, opts);
    });
  });

  describe('12. wrappers', () => {
    const ROWS: FixtureRow[] = [
      ["/usr/bin/sed -n '1,2p' f", [range('f', 1, 2)], undefined, 'absolute path with a recognized basename strips'],
      ["command sed -n '1,2p' f", [range('f', 1, 2)], undefined, undefined],
      ["env FOO=1 sed -n '1,2p' f", [range('f', 1, 2)], undefined, undefined],
      ["timeout 5 sed -n '1,2p' f", [range('f', 1, 2)], undefined, undefined],
      ["timeout 5s sed -n '1,2p' f", [range('f', 1, 2)], undefined, undefined],
      [
        "command env A=1 timeout 5 sed -n '1,2p' f",
        [range('f', 1, 2)],
        undefined,
        'stacked wrappers strip to a fixed point'
      ],
      ['env A=1 cat f | head -3', [range('f', 1, 3)], undefined, 'wrapped sources narrow'],
      ["env -i sed -n '1,2p' f", [], undefined, 'env -i is not an env NAME=value prefix — fail closed'],
      ["timeout --invalid sed -n '1,2p' f", [], undefined, 'an unrecognized timeout flag fails closed'],
      ["command true && sed -n '1,2p' f", [range('f', 1, 2)], undefined, undefined],
      ['command -v sed', [], undefined, 'query — runs nothing'],
      ['command -V sed', [], undefined, undefined],
      ["command -p sed -n '1,2p' f", [range('f', 1, 2)], undefined, undefined],
      ["./sed -n '2,4p' f", [], undefined, 'relative colliding path — a local script named sed is not the coreutil'],
      ['./git show HEAD:f', [], { cwd: p2Repo.root }, 'a local script named git is not the adapter'],
      ['../bin/cat f', [], undefined, 'only /-prefixed paths strip']
    ];

    it.each<FixtureRow>(ROWS)('%s', (cmd, expected, opts) => {
      expectTouches(cmd, expected, opts);
    });
  });

  describe.skip('13. variables (injected env — the walk never defaults to process.env in these checks)', () => {
    const ROWS: FixtureRow[] = [
      [
        'cat "$WORKSPACE_PATH/f"',
        [whole(join(p2Dir, 'f'))],
        { env: { WORKSPACE_PATH: p2Dir } },
        'an allowlisted name resolves from the hook env'
      ],
      [
        "cat '$WORKSPACE_PATH/f'",
        [unresolved('$WORKSPACE_PATH/f')],
        undefined,
        'single-quoted — literal, stays unresolved'
      ],
      ['cat $VAR/f', [whole(join(p2Dir, 'f'))], { env: { VAR: p2Dir } }, '$VAR and ${VAR} resolve'],
      ['cat ${VAR}/f', [whole(join(p2Dir, 'f'))], { env: { VAR: p2Dir } }, undefined],
      ['cat $HOME/f', [whole(join(p2Dir, 'f'))], { env: { HOME: p2Dir } }, undefined],
      [
        'cd "$WORKSPACE_PATH"; cat f',
        [whole(join(p2Dir, 'f'))],
        { cwd: '/', env: { WORKSPACE_PATH: p2Dir } },
        'a cd target expands from the allowlisted env before resolving'
      ],
      [
        `A=${p2Dir}; cat $A/f`,
        [whole(join(p2Dir, 'f'))],
        undefined,
        'resolves via the executed-assignment table (substituted with a real dir)'
      ],
      [`A=${p2Dir} cat $A/f`, [unresolved('$A/f')], undefined, 'a prefix assignment does not feed its own words'],
      ['cat $(pwd)/f', [unresolved('$(pwd)/f')], undefined, 'command substitution stays unresolved'],
      ['cat ${!X}/f', [unresolved('${!X}/f')], undefined, 'indirect expansion stays unresolved'],
      ['cat $?/f', [unresolved('$?/f')], undefined, 'special parameters stay unresolved'],
      ['cat "$HOME/f"', [unresolved('$HOME/f')], undefined, 'an allowlisted name absent from the env stays unresolved'],
      ['cat $PWD/f', [whole(join(p2Dir, 'f'))], { env: { PWD: p2Dir } }, '$PWD resolves against the tracked dir'],
      [`X=${p2Dir}; unset X; cat $X/f`, [unresolved('$X/f')], undefined, 'unset deletes the table entry'],
      [
        `X=${p2Dir}; export X; cat $X/f`,
        [whole(join(p2Dir, 'f'))],
        undefined,
        'export without a value is a table no-op'
      ]
    ];

    it.each<FixtureRow>(ROWS)('%s', (cmd, expected, opts) => {
      expectTouches(cmd, expected, opts);
    });
  });

  describe.skip('14. directories — cd certainty (the adapter workdir fixtures live in cross-adapter-contract.test.ts)', () => {
    const ROWS: FixtureRow[] = [
      [
        "cd $UNKNOWN; sed -n '1,2p' f",
        [unresolved('f')],
        undefined,
        'an unresolvable cd target makes the dir uncertain — never the stale pre-cd dir'
      ],
      [
        "cd sub; cd -; sed -n '1,2p' f",
        [range('f', 1, 2)],
        undefined,
        'cd - resolves against the previous tracked path'
      ],
      [
        "cd -; sed -n '1,2p' f",
        [range('f', 1, 2)],
        undefined,
        'bare cd - with no prior cd — the previous tracked path is the seed cwd'
      ],
      ["cd; sed -n '1,2p' f", [range('f', 1, 2)], { env: { HOME: p2Dir } }, 'bare cd is $HOME'],
      [
        "cd; sed -n '1,2p' f",
        [range('sub/f', 1, 2)],
        { env: { HOME: 'sub' } },
        'a relative $HOME re-bases like any literal cd target'
      ],
      ["grep -q x f && cd sub; sed -n '1,2p' f", [unresolved('f')], undefined, 'a may-have-run cd poisons certainty'],
      [
        `cd $X; cd ${p2Dir}; sed -n '1,2p' f`,
        [range(join(p2Dir, 'f'), 1, 2)],
        undefined,
        'a literal cd restores certainty'
      ],
      [`cd ${p2Dir} | sed -n '1,2p' f`, [range('f', 1, 2)], undefined, 'a pipe-position cd never re-bases — subshell'],
      [
        "x=a; case $x in a) cd sub;; esac; sed -n '1,2p' f",
        [range('sub/f', 1, 2)],
        undefined,
        "a decidable branch's cd re-bases like any executed stage"
      ]
    ];

    it.each<FixtureRow>(ROWS)('%s', (cmd, expected, opts) => {
      expectTouches(cmd, expected, opts);
    });
  });

  describe('15. heredocs', () => {
    // These rows' expectations are determined by analyzeExecution — the gated
    // write/stage never runs.
    const SKIPPED_ROWS: FixtureRow[] = [
      ['false && cat > f <<EOF', [], undefined, 'the gated write never runs'],
      [
        "cat > f <<EOF && sed -n '1,2p' g",
        [writeTo('f')],
        undefined,
        'write yes, sed suppressed (write masking unchanged)'
      ],
      ['false && cat f <<EOF\nbody', [], undefined, 'gated heredoc stage']
    ];

    const ROWS: FixtureRow[] = [
      ['cat > f <<EOF\nbody\nEOF', [writeTo('f')], undefined, 'whole-body write; the closing line is a separator'],
      ['cat >> f <<EOF\nbody\nEOF', [writeTo('f')], undefined, 'append — no truncate'],
      [
        'cat f <<EOF\nbody\nEOF',
        [whole('f')],
        undefined,
        "a heredoc without a redirect is body text — the stage keeps its own reads (changed from today's unmatch)"
      ],
      [
        "cat f <<EOF\ncat g\nEOF\nsed -n '1,2p' h",
        [whole('f'), range('h', 1, 2)],
        undefined,
        'body text never becomes stages — no g touch (today the body splits and cat g is a phantom)'
      ],
      ['cat f <<EOF\nbody', [whole('f')], undefined, 'unterminated — bash warns and runs cat; the tail is body'],
      [
        'cat f <<EOF # note\nbody\nEOF',
        [whole('f')],
        undefined,
        'a trailing comment after the delimiter is no longer unmatchable'
      ]
    ];

    it.each<FixtureRow>(ROWS)('%s', (cmd, expected, opts) => {
      expectTouches(cmd, expected, opts);
    });

    it.each<FixtureRow>(SKIPPED_ROWS)('%s', (cmd, expected, opts) => {
      expectTouches(cmd, expected, opts);
    });
  });
});

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
 *
 * Every resolved span carries its `operation` kind, the ordinal
 * `simpleCommandIndex` of its simple command within the compound, and —
 * where the simple command was joined with `&&`/`||` — the `join` operator
 * (plan §1, §3 step 2).
 *
 * The trailing describe blocks are the card's Phase 2 acceptance checks for
 * the write-touch family grammars (plan §5) — all `it.skip`, written against
 * the Phase 1 stubs so Phase 3 can unskip them one family at a time.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Idiom, parseCommand, parseCommandDetailed } from '../../src/common/parse-command.js';
import { makeTempRepo } from '../helpers.js';

// ---------------------------------------------------------------------------
// Patch-text fixtures (plan §5.7). `PATCH_NOTES_DIFF` is also written to disk
// as `p.diff` for the file-source checks (`git apply <file>` / `< file.diff`).
// ---------------------------------------------------------------------------

const PATCH_NOTES_DIFF = [
  '--- a/notes.txt',
  '+++ b/notes.txt',
  '@@ -1,3 +1,3 @@',
  ' one',
  '-two',
  "+two'",
  ' three'
].join('\n');

/** A count-changing hunk (3 → 4 lines): any position below it shifts → whole-file. */
const PATCH_GROWING_DIFF = [
  '--- a/notes.txt',
  '+++ b/notes.txt',
  '@@ -1,3 +1,4 @@',
  ' one',
  '-two',
  '+two',
  '+two-and-half',
  ' three'
].join('\n');

const PATCH_BINARY_DIFF = ['--- a/img.bin', '+++ b/img.bin', 'Binary files a/img.bin and b/img.bin differ'].join('\n');

const PATCH_RENAME_DIFF = [
  'diff --git a/old.txt b/new.txt',
  'similarity index 100%',
  'rename from old.txt',
  'rename to new.txt'
].join('\n');

/** Git-format deletion (`deleted file mode` header) → `delete`. */
const PATCH_DELETED_DIFF = [
  'diff --git a/gone.txt b/gone.txt',
  'deleted file mode 100644',
  'index 1234567..0000000',
  '--- a/gone.txt',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-g1',
  '-g2'
].join('\n');

/** `diff -u`-format deletion — no `deleted file mode` header, `+++ /dev/null` only → `delete`. */
const PATCH_DEVNULL_DIFF = ['--- a/gone.txt', '+++ /dev/null', '@@ -1,2 +0,0 @@', '-g1', '-g2'].join('\n');

const PATCH_NEW_DIFF = [
  'diff --git a/new.txt b/new.txt',
  'new file mode 100644',
  'index 0000000..1234567',
  '--- /dev/null',
  '+++ b/new.txt',
  '@@ -0,0 +1,2 @@',
  '+n1',
  '+n2'
].join('\n');

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'parseCommand-test-'));
  const twentyLines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
  writeFileSync(join(dir, 'twenty.txt'), `${twentyLines}\n`);
  writeFileSync(join(dir, 'five.txt'), `${Array.from({ length: 5 }, (_, i) => `l${i + 1}`).join('\n')}\n`);
  writeFileSync(join(dir, 'empty.txt'), '');
  // Fixtures for the write-touch family grammars (plan §5): a real directory
  // (dest-dir decisions stat it), sources with known line counts (whole-file
  // read spans resolve against fs), and formatter operands.
  mkdirSync(join(dir, 'destdir'));
  writeFileSync(join(dir, 'src.txt'), 's1\ns2\ns3\ns4\n');
  writeFileSync(join(dir, 'plain.txt'), 'p1\np2\n');
  writeFileSync(join(dir, 'dst.txt'), 'd1\nd2\n');
  writeFileSync(join(dir, 'notes.txt'), 'one\ntwo\nthree\n');
  writeFileSync(join(dir, 'p.diff'), PATCH_NOTES_DIFF);
  writeFileSync(join(dir, 'f.cpp'), 'int main() {}\n');
  writeFileSync(join(dir, 'f.py'), 'print(1)\n');
  writeFileSync(join(dir, 'f.ts'), 'export const x = 1;\n');
  writeFileSync(join(dir, 'f.go'), 'package main\n');
  writeFileSync(join(dir, 'f.rs'), 'fn main() {}\n');
  writeFileSync(join(dir, 'f.sh'), 'echo hi\n');
  writeFileSync(join(dir, 'f.tf'), 'resource "x" "y" {}\n');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('bare cat/nl whole-file reads', () => {
  it('bare cat file resolves to whole-file range', () => {
    const spans = parseCommand(`cat ${join(dir, 'twenty.txt')}`);
    expect(spans).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 20, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('bare nl file resolves to whole-file range', () => {
    const spans = parseCommand(`nl ${join(dir, 'five.txt')}`);
    expect(spans).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 5, absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('cat file | head -N still only emits the head range (pipe source, no standalone cat span)', () => {
    const spans = parseCommand(`cat ${join(dir, 'twenty.txt')} | head -3`);
    // Only the head range; bare cat is a pipe source, not a standalone read
    expect(spans).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 1 }
    ]);
  });

  it('cat with no file argument (stdin) does not match', () => {
    expect(parseCommand('cat')).toEqual([]);
  });
});

describe('multi-range sed -n', () => {
  it('two ranges on one file emit two spans', () => {
    const spans = parseCommand(`sed -n '2,4p;6,8p' ${join(dir, 'twenty.txt')}`);
    expect(spans).toEqual([
      { operation: 'read', lineStart: 2, lineEnd: 4, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 },
      { operation: 'read', lineStart: 6, lineEnd: 8, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('single-range sed -n still works (regression)', () => {
    const spans = parseCommand(`sed -n '10,20p' ${join(dir, 'twenty.txt')}`);
    expect(spans).toEqual([
      { operation: 'read', lineStart: 10, lineEnd: 20, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('mixed script (range + non-range segments) only emits matching ranges', () => {
    const spans = parseCommand(`sed -n '2,4p;d;6,8p' ${join(dir, 'twenty.txt')}`);
    expect(spans).toEqual([
      { operation: 'read', lineStart: 2, lineEnd: 4, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 },
      { operation: 'read', lineStart: 6, lineEnd: 8, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 }
    ]);
  });
});

describe('sed -n range', () => {
  it('numeric,numeric', () => {
    const spans = parseCommand(`sed -n '10,20p' ${join(dir, 'twenty.txt')}`);
    expect(spans).toEqual([
      { operation: 'read', lineStart: 10, lineEnd: 20, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('numeric,$ resolves against real EOF', () => {
    const spans = parseCommand(`sed -n '15,$p' ${join(dir, 'twenty.txt')}`);
    expect(spans).toEqual([
      { operation: 'read', lineStart: 15, lineEnd: 20, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('single line address', () => {
    const spans = parseCommand(`sed -n '3p' ${join(dir, 'five.txt')}`);
    expect(spans).toEqual([
      { operation: 'read', lineStart: 3, lineEnd: 3, absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('unquoted numeric range', () => {
    const spans = parseCommand(`sed -n 1,4p ${join(dir, 'five.txt')}`);
    expect(spans).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 4, absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('no -n flag does not match (prints whole file plus dupes, not a range read)', () => {
    expect(parseCommand(`sed 's/a/b/' ${join(dir, 'five.txt')}`)).toEqual([]);
  });

  it('embedded in a larger && chain', () => {
    const spans = parseCommand(`echo start && sed -n '1,2p' ${join(dir, 'five.txt')} && echo done`);
    expect(spans).toEqual([
      {
        operation: 'read',
        lineStart: 1,
        lineEnd: 2,
        absolutePath: join(dir, 'five.txt'),
        simpleCommandIndex: 1,
        join: '&&'
      }
    ]);
  });
});

describe('head', () => {
  it('-n N with file', () => {
    const spans = parseCommand(`head -n 5 ${join(dir, 'twenty.txt')}`);
    expect(spans).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 5, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('legacy -N form', () => {
    const spans = parseCommand(`head -30 ${join(dir, 'twenty.txt')}`);
    expect(spans).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 20, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('no count defaults to 10', () => {
    const spans = parseCommand(`head ${join(dir, 'twenty.txt')}`);
    expect(spans).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 10, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('no trailing file (reading stdin/a pipe) does not match', () => {
    expect(parseCommand('git log --oneline | head -20')).toEqual([]);
  });
});

describe('tail', () => {
  it('-n +N (from start) resolves against real EOF', () => {
    const spans = parseCommand(`tail -n +18 ${join(dir, 'twenty.txt')}`);
    expect(spans).toEqual([
      { operation: 'read', lineStart: 18, lineEnd: 20, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('-n N (from end) resolves against real EOF', () => {
    const spans = parseCommand(`tail -n 3 ${join(dir, 'twenty.txt')}`);
    expect(spans).toEqual([
      { operation: 'read', lineStart: 18, lineEnd: 20, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 }
    ]);
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
    const spans = parseCommand('git show HEAD:blob.ts', repo.root);
    expect(spans).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 8, absolutePath: join(repo.root, 'blob.ts'), simpleCommandIndex: 0 }
    ]);
  });

  it('git -C <dir> show rev:path uses -C as the resolution directory', () => {
    const spans = parseCommand(`git -C ${repo.root} show HEAD:blob.ts`, '/');
    expect(spans).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 8, absolutePath: join(repo.root, 'blob.ts'), simpleCommandIndex: 0 }
    ]);
  });

  it('git show without a rev:path colon does not match', () => {
    expect(parseCommand('git show HEAD --stat', repo.root)).toEqual([]);
  });

  it('unknown revision: matched idiom, unresolved result', () => {
    const detailed = parseCommandDetailed('git show not-a-real-rev:blob.ts', repo.root);
    expect(detailed.length).toBe(1);
    expect(detailed[0].status).toBe('unresolved');
  });

  it('piped into sed -n yields both the whole-file span and the precise range (verbatim blob content, unlike git log -L)', () => {
    const spans = parseCommand("git show HEAD:blob.ts | sed -n '2,4p'", repo.root);
    expect(spans).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 8, absolutePath: join(repo.root, 'blob.ts'), simpleCommandIndex: 0 },
      { operation: 'read', lineStart: 2, lineEnd: 4, absolutePath: join(repo.root, 'blob.ts'), simpleCommandIndex: 1 }
    ]);
  });

  it('piped into head -N', () => {
    const spans = parseCommand('git show HEAD:blob.ts | head -3', repo.root);
    expect(spans).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 8, absolutePath: join(repo.root, 'blob.ts'), simpleCommandIndex: 0 },
      { operation: 'read', lineStart: 1, lineEnd: 3, absolutePath: join(repo.root, 'blob.ts'), simpleCommandIndex: 1 }
    ]);
  });
});

describe('git log -L', () => {
  it('fully literal, needs no fs/git access', () => {
    const spans = parseCommand('git log -L 12,40:src/Router.ts');
    expect(spans).toEqual([
      {
        operation: 'read',
        lineStart: 12,
        lineEnd: 40,
        absolutePath: join(process.cwd(), 'src/Router.ts'),
        simpleCommandIndex: 0
      }
    ]);
  });

  it('fused -L12,40:path form', () => {
    const spans = parseCommand('git log -L12,40:src/Router.ts');
    expect(spans).toEqual([
      {
        operation: 'read',
        lineStart: 12,
        lineEnd: 40,
        absolutePath: join(process.cwd(), 'src/Router.ts'),
        simpleCommandIndex: 0
      }
    ]);
  });
});

describe('heredoc writes', () => {
  it('cat > file <<EOF overwrite: whole-file write span without a line range', () => {
    const cmd = `cat > ${join(dir, 'out1.txt')} <<'EOF'\nalpha\nbeta\ngamma\nEOF\n`;
    const spans = parseCommand(cmd);
    expect(spans).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'out1.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('cat >> file <<EOF append: whole-file write span carrying the appended body', () => {
    const target = join(dir, 'five.txt');
    const cmd = `cat >> ${target} <<'EOF'\nnew1\nnew2\nEOF\n`;
    const spans = parseCommand(cmd);
    expect(spans).toEqual([
      { operation: 'append', absolutePath: target, written: 'new1\nnew2', simpleCommandIndex: 0 }
    ]);
  });

  it('heredoc body containing && is not mis-split by the outer command splitter', () => {
    const cmd = `cat > ${join(dir, 'out2.sh')} <<'EOF'\necho a && echo b\necho c\nEOF\n`;
    const spans = parseCommand(cmd);
    expect(spans).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'out2.sh'), simpleCommandIndex: 0 }
    ]);
  });

  it('two heredocs in one command both resolve, in order', () => {
    const cmd = `cat > ${join(dir, 'a.txt')} <<'EOF'\nx\nEOF\ncat > ${join(dir, 'b.txt')} <<'EOF'\ny\nz\nEOF\n`;
    const spans = parseCommand(cmd);
    expect(spans).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'a.txt'), simpleCommandIndex: 0 },
      { operation: 'create-overwrite', absolutePath: join(dir, 'b.txt'), simpleCommandIndex: 1 }
    ]);
  });

  it('empty-body > heredoc truncates the file: emits a truncate span', () => {
    const target = join(dir, 'trunc.txt');
    const cmd = `cat > ${target} <<'EOF'\nEOF\n`;
    const detailed = parseCommandDetailed(cmd);
    expect(detailed).toEqual([
      {
        status: 'resolved',
        idiom: 'heredoc-write',
        span: { operation: 'truncate', absolutePath: target, simpleCommandIndex: 0 }
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
    expect(spans).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 1 }
    ]);
  });

  it('nl file | sed -n range', () => {
    const spans = parseCommand(`nl -ba ${join(dir, 'twenty.txt')} | sed -n '2,4p'`);
    expect(spans).toEqual([
      { operation: 'read', lineStart: 2, lineEnd: 4, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 1 }
    ]);
  });

  it('does not propagate two hops', () => {
    const spans = parseCommand(`cat ${join(dir, 'twenty.txt')} | grep foo | head -3`);
    expect(spans).toEqual([]);
  });

  it('cat file | newline sed -n: the newline continues the pipeline (no standalone cat span, precise range)', () => {
    const spans = parseCommand(`cat ${join(dir, 'twenty.txt')} |\nsed -n '2,4p'`);
    expect(spans).toEqual([
      { operation: 'read', lineStart: 2, lineEnd: 4, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 1 }
    ]);
  });

  it('cat file | newline head -N: the newline continues the pipeline', () => {
    const spans = parseCommand(`cat ${join(dir, 'twenty.txt')} |\nhead -3`);
    expect(spans).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 1 }
    ]);
  });

  it('plain newline still separates commands: standalone cat span stays', () => {
    const spans = parseCommand(`cat ${join(dir, 'twenty.txt')}\nhead -3 ${join(dir, 'five.txt')}`);
    expect(spans).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 20, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 },
      { operation: 'read', lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 1 }
    ]);
  });
});

describe('cd tracking within one command', () => {
  it('cd /abs && relative sed resolves against the new dir', () => {
    const spans = parseCommand(`cd ${dir} && sed -n '1,2p' five.txt`, '/nonexistent');
    expect(spans).toEqual([
      {
        operation: 'read',
        lineStart: 1,
        lineEnd: 2,
        absolutePath: join(dir, 'five.txt'),
        simpleCommandIndex: 1,
        join: '&&'
      }
    ]);
  });

  it('cd "$VAR" (unresolvable) falls back to the seed cwd, not "/"', () => {
    const spans = parseCommand('cd "$WORKSPACE_PATH" && sed -n \'1,2p\' five.txt', dir);
    expect(spans).toEqual([
      {
        operation: 'read',
        lineStart: 1,
        lineEnd: 2,
        absolutePath: join(dir, 'five.txt'),
        simpleCommandIndex: 1,
        join: '&&'
      }
    ]);
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
      { operation: 'read', lineStart: 1, lineEnd: 2, absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 },
      { operation: 'read', lineStart: 3, lineEnd: 4, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 1 }
    ]);
  });
});

// ===========================================================================
// Phase 2 — write-touch family acceptance checks (plan §5). All checks are
// `it.skip`: they pin the Phase 3 outcomes the family grammars must produce,
// compiling against the Phase 1 stubs today.
// ===========================================================================

function expectUnresolved(cmd: string, idiom: Idiom, cwd?: string): void {
  const detailed = parseCommandDetailed(cmd, cwd);
  expect(detailed.length).toBeGreaterThan(0);
  expect(detailed[0].status).toBe('unresolved');
  if (detailed[0].status === 'unresolved') expect(detailed[0].idiom).toBe(idiom);
}

describe('redirections — truncating and appending writes (§5.1)', () => {
  it('echo > f: create-overwrite whole-file write (no body threaded)', () => {
    expect(parseCommand(`echo x > ${join(dir, 'f')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'f'), simpleCommandIndex: 0 }
    ]);
  });

  it('echo >> f: append threading the literal body', () => {
    expect(parseCommand(`echo x >> ${join(dir, 'f')}`)).toEqual([
      { operation: 'append', absolutePath: join(dir, 'f'), written: 'x\n', simpleCommandIndex: 0 }
    ]);
  });

  it('printf >> f: the printf literal is threaded without a trailing newline', () => {
    expect(parseCommand(`printf 'x' >> ${join(dir, 'f')}`)).toEqual([
      { operation: 'append', absolutePath: join(dir, 'f'), written: 'x', simpleCommandIndex: 0 }
    ]);
  });

  it('&> f: stdout+stderr capture is a create-overwrite', () => {
    expect(parseCommand(`echo alpha beta &> ${join(dir, 'f')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'f'), simpleCommandIndex: 0 }
    ]);
  });

  it('&>> f: append, body not threaded (double-redirect ambiguity fails closed)', () => {
    expect(parseCommand(`echo x &>> ${join(dir, 'f')}`)).toEqual([
      { operation: 'append', absolutePath: join(dir, 'f'), simpleCommandIndex: 0 }
    ]);
  });

  it('fd-specific redirects are excluded: 2> err, 3> f, 2>&1, 2>/dev/null', () => {
    expect(parseCommand(`echo x 2> ${join(dir, 'err')}`)).toEqual([]);
    expect(parseCommand(`echo x 3> ${join(dir, 'f')}`)).toEqual([]);
    expect(parseCommand('echo x 2>&1')).toEqual([]);
    expect(parseCommand(`echo x 2>/dev/null`)).toEqual([]);
  });

  it('an fd-excluded stderr redirect does not suppress the stdout write', () => {
    expect(parseCommand(`echo x > ${join(dir, 'out')} 2> ${join(dir, 'err')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'out'), simpleCommandIndex: 0 }
    ]);
  });

  it(': > f and bare > f truncate', () => {
    expect(parseCommand(`: > ${join(dir, 'f')}`)).toEqual([
      { operation: 'truncate', absolutePath: join(dir, 'f'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`> ${join(dir, 'f')}`)).toEqual([
      { operation: 'truncate', absolutePath: join(dir, 'f'), simpleCommandIndex: 0 }
    ]);
  });

  it(': >> f appends nothing: no touch', () => {
    expect(parseCommand(`: >> ${join(dir, 'f')}`)).toEqual([]);
  });

  it('a quoted ">" is a literal argument, not a redirect', () => {
    expect(parseCommand(`echo '>' ${join(dir, 'f')}`)).toEqual([]);
  });

  it('attached targets: >f and >>f', () => {
    expect(parseCommand(`echo x >${join(dir, 'f')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'f'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`echo x >>${join(dir, 'f')}`)).toEqual([
      { operation: 'append', absolutePath: join(dir, 'f'), written: 'x\n', simpleCommandIndex: 0 }
    ]);
  });

  it('a quoted redirect target may contain spaces', () => {
    const target = join(dir, 'my file');
    expect(parseCommand(`echo x > "${target}"`)).toEqual([
      { operation: 'create-overwrite', absolutePath: target, simpleCommandIndex: 0 }
    ]);
  });

  it('an arbitrary command with a redirect gets no write touch (ls > f, grep x f > g, python3 x.py > out)', () => {
    expect(parseCommand(`ls > ${join(dir, 'f')}`)).toEqual([]);
    expect(parseCommand(`grep x ${join(dir, 'src.txt')} > ${join(dir, 'g')}`)).toEqual([]);
    expect(parseCommand(`python3 ${join(dir, 'x.py')} > ${join(dir, 'out')}`)).toEqual([]);
  });

  it('a read-family command with a redirect keeps its read span but gets no write touch (cat f > g)', () => {
    expect(parseCommand(`cat ${join(dir, 'src.txt')} > ${join(dir, 'g')}`)).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 4, absolutePath: join(dir, 'src.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('echo x > a > b: every content redirect resolves, in order', () => {
    expect(parseCommand(`echo x > ${join(dir, 'a')} > ${join(dir, 'b')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'a'), simpleCommandIndex: 0 },
      { operation: 'create-overwrite', absolutePath: join(dir, 'b'), simpleCommandIndex: 0 }
    ]);
  });

  it('bare tee f: create-overwrite; tee -a f: whole-file append', () => {
    expect(parseCommand(`tee ${join(dir, 'f')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'f'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`tee -a ${join(dir, 'f')}`)).toEqual([
      { operation: 'append', absolutePath: join(dir, 'f'), simpleCommandIndex: 0 }
    ]);
  });
});

describe('heredoc orderings and hosts (§5.2)', () => {
  it('cat <<EOF > f: the target may precede the redirect', () => {
    const cmd = `cat <<'EOF' > ${join(dir, 'f')}\nbody\nEOF\n`;
    expect(parseCommand(cmd)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'f'), simpleCommandIndex: 0 }
    ]);
  });

  it('cat <<EOF >> f: the body is threaded as an append', () => {
    const cmd = `cat <<'EOF' >> ${join(dir, 'f')}\nalpha\nbeta\nEOF\n`;
    expect(parseCommand(cmd)).toEqual([
      { operation: 'append', absolutePath: join(dir, 'f'), written: 'alpha\nbeta', simpleCommandIndex: 0 }
    ]);
  });

  it('a quoted heredoc target may contain spaces', () => {
    const target = join(dir, 'my file');
    const cmd = `cat > "${target}" <<'EOF'\nbody\nEOF\n`;
    expect(parseCommand(cmd)).toEqual([{ operation: 'create-overwrite', absolutePath: target, simpleCommandIndex: 0 }]);
  });

  it('tee f <<EOF: create-overwrite', () => {
    const cmd = `tee ${join(dir, 'f')} <<'EOF'\nalpha\nbeta\nEOF\n`;
    expect(parseCommand(cmd)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'f'), simpleCommandIndex: 0 }
    ]);
  });

  it('tee -a f <<EOF: append threading the body', () => {
    const cmd = `tee -a ${join(dir, 'f')} <<'EOF'\nalpha\nbeta\nEOF\n`;
    expect(parseCommand(cmd)).toEqual([
      { operation: 'append', absolutePath: join(dir, 'f'), written: 'alpha\nbeta', simpleCommandIndex: 0 }
    ]);
  });

  it('tee <<EOF f: option and file-operand positions are free', () => {
    const cmd = `tee <<'EOF' ${join(dir, 'f')}\nbody\nEOF\n`;
    expect(parseCommand(cmd)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'f'), simpleCommandIndex: 0 }
    ]);
  });

  it('echo x | tee f: create-overwrite from a literal pipe source', () => {
    expect(parseCommand(`echo x | tee ${join(dir, 'f')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'f'), simpleCommandIndex: 1 }
    ]);
  });

  it('echo x | tee -a f: append threading the literal body', () => {
    expect(parseCommand(`echo x | tee -a ${join(dir, 'f')}`)).toEqual([
      { operation: 'append', absolutePath: join(dir, 'f'), written: 'x\n', simpleCommandIndex: 1 }
    ]);
  });

  it('stdin-patch heredoc: git apply - <<EOF resolves the hunk targets', () => {
    const cmd = `git apply - <<'EOF'\n${PATCH_NOTES_DIFF}\nEOF\n`;
    expect(parseCommand(cmd, dir)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'notes.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('<<- strips leading tabs from the body', () => {
    const cmd = `cat > ${join(dir, 'f')} <<-EOF\n\tindented\nEOF\n`;
    expect(parseCommand(cmd)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'f'), simpleCommandIndex: 0 }
    ]);
  });

  it('a bare unquoted delimiter still resolves the heredoc', () => {
    const cmd = `cat > ${join(dir, 'f')} <<EOF\nbody\nEOF\n`;
    expect(parseCommand(cmd)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'f'), simpleCommandIndex: 0 }
    ]);
  });

  it('non-family hosts: python3 - <<EOF > out and ls > out <<EOF touch nothing', () => {
    expect(parseCommand(`python3 - <<'EOF' > ${join(dir, 'out')}\nprint(1)\nEOF\n`)).toEqual([]);
    expect(parseCommand(`ls > ${join(dir, 'out')} <<'EOF'\nbody\nEOF\n`)).toEqual([]);
  });

  it('a read-family command with a heredoc stdin keeps no file spans (the source is stdin)', () => {
    const cmd = `sed -n '1,2p' <<'EOF' > ${join(dir, 'out')}\nalpha\nbeta\nEOF\n`;
    expect(parseCommand(cmd)).toEqual([]);
  });
});

describe('cp and install destinations (§5.3)', () => {
  it('cp src dst: read on the source, create-overwrite on the dest', () => {
    expect(parseCommand(`cp ${join(dir, 'src.txt')} ${join(dir, 'dst.txt')}`)).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 4, absolutePath: join(dir, 'src.txt'), simpleCommandIndex: 0 },
      { operation: 'create-overwrite', absolutePath: join(dir, 'dst.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('cp src dir/: a directory dest appends the basename', () => {
    expect(parseCommand(`cp ${join(dir, 'src.txt')} ${join(dir, 'destdir')}/`)).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 4, absolutePath: join(dir, 'src.txt'), simpleCommandIndex: 0 },
      { operation: 'create-overwrite', absolutePath: join(dir, 'destdir/src.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('cp a b dir/: both sources resolve, in order', () => {
    expect(parseCommand(`cp ${join(dir, 'src.txt')} ${join(dir, 'plain.txt')} ${join(dir, 'destdir')}/`)).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 4, absolutePath: join(dir, 'src.txt'), simpleCommandIndex: 0 },
      { operation: 'read', lineStart: 1, lineEnd: 2, absolutePath: join(dir, 'plain.txt'), simpleCommandIndex: 0 },
      { operation: 'create-overwrite', absolutePath: join(dir, 'destdir/src.txt'), simpleCommandIndex: 0 },
      { operation: 'create-overwrite', absolutePath: join(dir, 'destdir/plain.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('cp a b dst (multi-source, non-directory dest) is unresolved', () => {
    expect(parseCommand(`cp ${join(dir, 'src.txt')} ${join(dir, 'plain.txt')} ${join(dir, 'dst.txt')}`)).toEqual([]);
    expectUnresolved(`cp ${join(dir, 'src.txt')} ${join(dir, 'plain.txt')} ${join(dir, 'dst.txt')}`, 'cp-write');
  });

  it('cp -t dir a b: the -t value is a directory, dests append basenames', () => {
    expect(parseCommand(`cp -t ${join(dir, 'destdir')} ${join(dir, 'src.txt')} ${join(dir, 'plain.txt')}`)).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 4, absolutePath: join(dir, 'src.txt'), simpleCommandIndex: 0 },
      { operation: 'read', lineStart: 1, lineEnd: 2, absolutePath: join(dir, 'plain.txt'), simpleCommandIndex: 0 },
      { operation: 'create-overwrite', absolutePath: join(dir, 'destdir/src.txt'), simpleCommandIndex: 0 },
      { operation: 'create-overwrite', absolutePath: join(dir, 'destdir/plain.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('cp -t file src is unresolved (the -t value is not a directory)', () => {
    expectUnresolved(`cp -t ${join(dir, 'dst.txt')} ${join(dir, 'src.txt')}`, 'cp-write');
  });

  it('cp --target-directory=dir src', () => {
    expect(parseCommand(`cp --target-directory=${join(dir, 'destdir')} ${join(dir, 'src.txt')}`)).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 4, absolutePath: join(dir, 'src.txt'), simpleCommandIndex: 0 },
      { operation: 'create-overwrite', absolutePath: join(dir, 'destdir/src.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('cp -b fails closed (backup naming is version-dependent)', () => {
    expect(parseCommand(`cp -b ${join(dir, 'src.txt')} ${join(dir, 'dst.txt')}`)).toEqual([]);
  });

  it('install -s src dst: existence-gated read + create-overwrite', () => {
    expect(parseCommand(`install -s ${join(dir, 'src.txt')} ${join(dir, 'dst.txt')}`)).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 4, absolutePath: join(dir, 'src.txt'), simpleCommandIndex: 0 },
      { operation: 'create-overwrite', absolutePath: join(dir, 'dst.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('install -m 644 src dst: mode options do not break the pair', () => {
    expect(parseCommand(`install -m 644 ${join(dir, 'src.txt')} ${join(dir, 'dst.txt')}`)).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 4, absolutePath: join(dir, 'src.txt'), simpleCommandIndex: 0 },
      { operation: 'create-overwrite', absolutePath: join(dir, 'dst.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('install -d dir: the directory is not a file touch', () => {
    expect(parseCommand(`install -d ${join(dir, 'destdir')}`)).toEqual([]);
  });

  it('FOO=1 cp src dst: env assignments are stripped', () => {
    expect(parseCommand(`FOO=1 cp ${join(dir, 'src.txt')} ${join(dir, 'dst.txt')}`)).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 4, absolutePath: join(dir, 'src.txt'), simpleCommandIndex: 0 },
      { operation: 'create-overwrite', absolutePath: join(dir, 'dst.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('command cp src dst: the command builtin is stripped', () => {
    expect(parseCommand(`command cp ${join(dir, 'src.txt')} ${join(dir, 'dst.txt')}`)).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 4, absolutePath: join(dir, 'src.txt'), simpleCommandIndex: 0 },
      { operation: 'create-overwrite', absolutePath: join(dir, 'dst.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('sudo cp src dst: foreign executables fail closed (unresolved)', () => {
    expect(parseCommand(`sudo cp ${join(dir, 'src.txt')} ${join(dir, 'dst.txt')}`)).toEqual([]);
    expectUnresolved(`sudo cp ${join(dir, 'src.txt')} ${join(dir, 'dst.txt')}`, 'cp-write');
  });
});

describe('mv and git mv — source delete + dest write (§5.4)', () => {
  it('mv src moved: delete on the source, rename-copy on the dest', () => {
    expect(parseCommand(`mv ${join(dir, 'src.txt')} ${join(dir, 'moved.txt')}`)).toEqual([
      { operation: 'delete', absolutePath: join(dir, 'src.txt'), simpleCommandIndex: 0 },
      { operation: 'rename-copy', absolutePath: join(dir, 'moved.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('mv src dir/: the directory dest appends the basename', () => {
    expect(parseCommand(`mv ${join(dir, 'src.txt')} ${join(dir, 'destdir')}/`)).toEqual([
      { operation: 'delete', absolutePath: join(dir, 'src.txt'), simpleCommandIndex: 0 },
      { operation: 'rename-copy', absolutePath: join(dir, 'destdir/src.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('mv -t dir a b: every source/dest pair resolves', () => {
    expect(parseCommand(`mv -t ${join(dir, 'destdir')} ${join(dir, 'src.txt')} ${join(dir, 'plain.txt')}`)).toEqual([
      { operation: 'delete', absolutePath: join(dir, 'src.txt'), simpleCommandIndex: 0 },
      { operation: 'delete', absolutePath: join(dir, 'plain.txt'), simpleCommandIndex: 0 },
      { operation: 'rename-copy', absolutePath: join(dir, 'destdir/src.txt'), simpleCommandIndex: 0 },
      { operation: 'rename-copy', absolutePath: join(dir, 'destdir/plain.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('git mv src moved: the same pair', () => {
    expect(parseCommand(`git mv ${join(dir, 'src.txt')} ${join(dir, 'moved.txt')}`)).toEqual([
      { operation: 'delete', absolutePath: join(dir, 'src.txt'), simpleCommandIndex: 0 },
      { operation: 'rename-copy', absolutePath: join(dir, 'moved.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('git -C dir mv src moved resolves against dir', () => {
    expect(parseCommand(`git -C ${dir} mv src.txt moved.txt`, '/')).toEqual([
      { operation: 'delete', absolutePath: join(dir, 'src.txt'), simpleCommandIndex: 0 },
      { operation: 'rename-copy', absolutePath: join(dir, 'moved.txt'), simpleCommandIndex: 0 }
    ]);
  });
});

describe('rm and git rm (§5.5)', () => {
  it('rm f: delete', () => {
    expect(parseCommand(`rm ${join(dir, 'plain.txt')}`)).toEqual([
      { operation: 'delete', absolutePath: join(dir, 'plain.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('rm a b: every operand is a delete', () => {
    expect(parseCommand(`rm ${join(dir, 'plain.txt')} ${join(dir, 'dst.txt')}`)).toEqual([
      { operation: 'delete', absolutePath: join(dir, 'plain.txt'), simpleCommandIndex: 0 },
      { operation: 'delete', absolutePath: join(dir, 'dst.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('rm -r dir: recursive removal touches nothing', () => {
    expect(parseCommand(`rm -r ${join(dir, 'destdir')}`)).toEqual([]);
  });

  it('rm -R / -d / --recursive all exclude', () => {
    expect(parseCommand(`rm -R ${join(dir, 'plain.txt')}`)).toEqual([]);
    expect(parseCommand(`rm -d ${join(dir, 'destdir')}`)).toEqual([]);
    expect(parseCommand(`rm --recursive ${join(dir, 'plain.txt')}`)).toEqual([]);
  });

  it('rm -- f: the -- separator is stripped', () => {
    expect(parseCommand(`rm -- ${join(dir, 'plain.txt')}`)).toEqual([
      { operation: 'delete', absolutePath: join(dir, 'plain.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('git rm f: delete', () => {
    expect(parseCommand(`git rm ${join(dir, 'plain.txt')}`)).toEqual([
      { operation: 'delete', absolutePath: join(dir, 'plain.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('git rm --cached f: the index-only removal touches nothing', () => {
    expect(parseCommand(`git rm --cached ${join(dir, 'plain.txt')}`)).toEqual([]);
  });
});

describe('truncate (§5.5)', () => {
  it('truncate -s 0 f: size 0 truncates', () => {
    expect(parseCommand(`truncate -s 0 ${join(dir, 'plain.txt')}`)).toEqual([
      { operation: 'truncate', absolutePath: join(dir, 'plain.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('truncate -s 100 f: any absolute size truncates', () => {
    expect(parseCommand(`truncate -s 100 ${join(dir, 'plain.txt')}`)).toEqual([
      { operation: 'truncate', absolutePath: join(dir, 'plain.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('truncate -s +10 / -s -10: relative sizes truncate', () => {
    expect(parseCommand(`truncate -s +10 ${join(dir, 'plain.txt')}`)).toEqual([
      { operation: 'truncate', absolutePath: join(dir, 'plain.txt'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`truncate -s -10 ${join(dir, 'plain.txt')}`)).toEqual([
      { operation: 'truncate', absolutePath: join(dir, 'plain.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('truncate -r ref f: reference-file sizing truncates', () => {
    expect(parseCommand(`truncate -r ${join(dir, 'src.txt')} ${join(dir, 'plain.txt')}`)).toEqual([
      { operation: 'truncate', absolutePath: join(dir, 'plain.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('truncate f without -s/-r truncates nothing', () => {
    expect(parseCommand(`truncate ${join(dir, 'plain.txt')}`)).toEqual([]);
  });

  it('truncate -c -s 0 f: -c is compatible', () => {
    expect(parseCommand(`truncate -c -s 0 ${join(dir, 'plain.txt')}`)).toEqual([
      { operation: 'truncate', absolutePath: join(dir, 'plain.txt'), simpleCommandIndex: 0 }
    ]);
  });
});

describe('sed -i in-place edits (§5.6)', () => {
  it.skip('a numeric address range scopes the modify to the exact range', () => {
    expect(parseCommand(`sed -i '2,4s/x/y/' ${join(dir, 'twenty.txt')}`)).toEqual([
      { operation: 'modify', lineStart: 2, lineEnd: 4, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('a single numeric address is a single-line range', () => {
    expect(parseCommand(`sed -i '3s/x/y/' ${join(dir, 'five.txt')}`)).toEqual([
      { operation: 'modify', lineStart: 3, lineEnd: 3, absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('a pattern address is a whole-file modify', () => {
    expect(parseCommand(`sed -i '/x/s/y/z/' ${join(dir, 'twenty.txt')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('a count-changing script (2d) is a whole-file modify', () => {
    expect(parseCommand(`sed -i '2d' ${join(dir, 'twenty.txt')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('an attached suffix: modify + backup create-overwrite on f.bak', () => {
    expect(parseCommand(`sed -i.bak 's/x/y/' ${join(dir, 'twenty.txt')}`)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 20, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 },
      { operation: 'create-overwrite', absolutePath: join(dir, 'twenty.txt.bak'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('a separate suffix: modify + backup create-overwrite on f.bak', () => {
    expect(parseCommand(`sed -i .bak 's/x/y/' ${join(dir, 'twenty.txt')}`)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 20, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 },
      { operation: 'create-overwrite', absolutePath: join(dir, 'twenty.txt.bak'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('an empty separate suffix is an in-place modify with no backup', () => {
    expect(parseCommand(`sed -i '' 's/x/y/' ${join(dir, 'twenty.txt')}`)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 20, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('script-first: the script is never a suffix, f is the file', () => {
    expect(parseCommand(`sed -i 's/x/y/' ${join(dir, 'twenty.txt')}`)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 20, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('-e script: modify on f', () => {
    expect(parseCommand(`sed -i -e 's/x/y/' ${join(dir, 'twenty.txt')}`)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 20, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('sed -i without a script is unresolved', () => {
    expectUnresolved(`sed -i '' ${join(dir, 'twenty.txt')}`, 'sed-inplace');
  });
});

describe('patch and git apply (§5.7)', () => {
  it.skip('git apply <file>: hunks resolve targets, ranges from the hunk headers', () => {
    expect(parseCommand(`git apply ${join(dir, 'p.diff')}`, dir)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'notes.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('git apply - < file: the stdin < source is read as patch text', () => {
    expect(parseCommand(`git apply - < ${join(dir, 'p.diff')}`, dir)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'notes.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('patch -p1 < file', () => {
    expect(parseCommand(`patch -p1 < ${join(dir, 'p.diff')}`, dir)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'notes.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('a heredoc patch body resolves the hunk targets', () => {
    const cmd = `patch -p1 <<'EOF'\n${PATCH_NOTES_DIFF}\nEOF\n`;
    expect(parseCommand(cmd, dir)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'notes.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('read-only modes: --check / --stat / --numstat / --summary touch nothing', () => {
    expect(parseCommand(`git apply --check ${join(dir, 'p.diff')}`, dir)).toEqual([]);
    expect(parseCommand(`git apply --stat ${join(dir, 'p.diff')}`, dir)).toEqual([]);
    expect(parseCommand(`git apply --numstat ${join(dir, 'p.diff')}`, dir)).toEqual([]);
    expect(parseCommand(`git apply --summary ${join(dir, 'p.diff')}`, dir)).toEqual([]);
  });

  it.skip('patch --dry-run is read-only', () => {
    expect(parseCommand(`patch --dry-run < ${join(dir, 'p.diff')}`, dir)).toEqual([]);
  });

  it.skip('git apply --cached: the index write touches nothing', () => {
    expect(parseCommand(`git apply --cached ${join(dir, 'p.diff')}`, dir)).toEqual([]);
  });

  it.skip('git apply --index applies to the tree and the index → modify', () => {
    expect(parseCommand(`git apply --index ${join(dir, 'p.diff')}`, dir)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'notes.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('patch -N: patch options are compatible', () => {
    expect(parseCommand(`patch -N < ${join(dir, 'p.diff')}`, dir)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'notes.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('--directory=sub fails closed (unresolved)', () => {
    expectUnresolved(`git apply --directory=sub ${join(dir, 'p.diff')}`, 'patch-write');
  });

  it.skip('a binary patch resolves a whole-file modify', () => {
    const cmd = `git apply <<'EOF'\n${PATCH_BINARY_DIFF}\nEOF\n`;
    expect(parseCommand(cmd, dir)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'img.bin'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('a rename patch resolves source delete + dest rename-copy', () => {
    const cmd = `git apply <<'EOF'\n${PATCH_RENAME_DIFF}\nEOF\n`;
    expect(parseCommand(cmd, dir)).toEqual([
      { operation: 'delete', absolutePath: join(dir, 'old.txt'), simpleCommandIndex: 0 },
      { operation: 'rename-copy', absolutePath: join(dir, 'new.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('a deleted-file header resolves delete', () => {
    const cmd = `git apply <<'EOF'\n${PATCH_DELETED_DIFF}\nEOF\n`;
    expect(parseCommand(cmd, dir)).toEqual([
      { operation: 'delete', absolutePath: join(dir, 'gone.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('a +++ /dev/null-only deletion (diff -u style) resolves delete', () => {
    const cmd = `git apply <<'EOF'\n${PATCH_DEVNULL_DIFF}\nEOF\n`;
    expect(parseCommand(cmd, dir)).toEqual([
      { operation: 'delete', absolutePath: join(dir, 'gone.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('a new-file header resolves create-overwrite', () => {
    const cmd = `git apply <<'EOF'\n${PATCH_NEW_DIFF}\nEOF\n`;
    expect(parseCommand(cmd, dir)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'new.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('a count-changing hunk resolves a whole-file modify', () => {
    const cmd = `git apply <<'EOF'\n${PATCH_GROWING_DIFF}\nEOF\n`;
    expect(parseCommand(cmd, dir)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'notes.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('patch f: the operand is a target, not a patch — no source, no touch', () => {
    expect(parseCommand(`patch ${join(dir, 'notes.txt')}`)).toEqual([]);
  });

  it.skip('a variable patch path is unresolved', () => {
    expectUnresolved('git apply "$PATCH_FILE"', 'patch-write');
  });

  it.skip('a piped patch (git diff | git apply) is unresolved', () => {
    expect(parseCommand('git diff | git apply')).toEqual([]);
    expectUnresolved('git diff | git apply', 'patch-write');
  });
});

describe('formatters and fixers (§5.8)', () => {
  it.skip('prettier: --write fires, --check is read-only', () => {
    expect(parseCommand(`prettier --write ${join(dir, 'f.ts')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.ts'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`prettier --check ${join(dir, 'f.ts')}`)).toEqual([]);
  });

  it.skip('eslint: --fix fires, bare lints, --fix-dry-run never collides with --fix', () => {
    expect(parseCommand(`eslint --fix ${join(dir, 'f.ts')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.ts'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`eslint ${join(dir, 'f.ts')}`)).toEqual([]);
    expect(parseCommand(`eslint --fix-dry-run ${join(dir, 'f.ts')}`)).toEqual([]);
  });

  it.skip('clang-format: bare emits to stdout (no touch), -i fires', () => {
    expect(parseCommand(`clang-format ${join(dir, 'f.cpp')}`)).toEqual([]);
    expect(parseCommand(`clang-format -i ${join(dir, 'f.cpp')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.cpp'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('black: bare is in-place, --check is read-only', () => {
    expect(parseCommand(`black ${join(dir, 'f.py')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.py'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`black --check ${join(dir, 'f.py')}`)).toEqual([]);
  });

  it.skip('ruff: check is a linter (even --fix), format is an in-place formatter', () => {
    expect(parseCommand(`ruff check ${join(dir, 'f.py')}`)).toEqual([]);
    expect(parseCommand(`ruff check --fix ${join(dir, 'f.py')}`)).toEqual([]);
    expect(parseCommand(`ruff format ${join(dir, 'f.py')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.py'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`ruff format --check ${join(dir, 'f.py')}`)).toEqual([]);
  });

  it.skip('deno fmt fires; --check is read-only', () => {
    expect(parseCommand(`deno fmt ${join(dir, 'f.ts')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.ts'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`deno fmt --check ${join(dir, 'f.ts')}`)).toEqual([]);
  });

  it.skip('gofmt: -w fires, -l is read-only, bare emits to stdout', () => {
    expect(parseCommand(`gofmt -w ${join(dir, 'f.go')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.go'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`gofmt -l ${join(dir, 'f.go')}`)).toEqual([]);
    expect(parseCommand(`gofmt ${join(dir, 'f.go')}`)).toEqual([]);
  });

  it.skip('rustfmt: bare is in-place, --check is read-only', () => {
    expect(parseCommand(`rustfmt ${join(dir, 'f.rs')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.rs'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`rustfmt --check ${join(dir, 'f.rs')}`)).toEqual([]);
  });

  it.skip('terraform fmt fires; -check is read-only', () => {
    expect(parseCommand(`terraform fmt ${join(dir, 'f.tf')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.tf'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`terraform fmt -check ${join(dir, 'f.tf')}`)).toEqual([]);
  });

  it.skip('isort: bare is in-place, --check-only is read-only', () => {
    expect(parseCommand(`isort ${join(dir, 'f.py')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.py'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`isort --check-only ${join(dir, 'f.py')}`)).toEqual([]);
  });

  it.skip('biome: check --write fires, bare check lints', () => {
    expect(parseCommand(`biome check --write ${join(dir, 'f.ts')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.ts'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`biome check ${join(dir, 'f.ts')}`)).toEqual([]);
  });

  it.skip('shfmt: -w fires, -d is read-only', () => {
    expect(parseCommand(`shfmt -w ${join(dir, 'f.sh')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.sh'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`shfmt -d ${join(dir, 'f.sh')}`)).toEqual([]);
  });

  it.skip('yapf: -i fires, --diff is read-only', () => {
    expect(parseCommand(`yapf -i ${join(dir, 'f.py')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.py'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`yapf --diff ${join(dir, 'f.py')}`)).toEqual([]);
  });

  it.skip('autopep8: -i fires, -d is read-only', () => {
    expect(parseCommand(`autopep8 -i ${join(dir, 'f.py')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.py'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`autopep8 -d ${join(dir, 'f.py')}`)).toEqual([]);
  });

  it.skip('goimports: -w fires, bare emits to stdout', () => {
    expect(parseCommand(`goimports -w ${join(dir, 'f.go')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.go'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`goimports ${join(dir, 'f.go')}`)).toEqual([]);
  });

  it.skip('dprint: fmt fires, check is read-only', () => {
    expect(parseCommand(`dprint fmt ${join(dir, 'f.ts')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.ts'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`dprint check ${join(dir, 'f.ts')}`)).toEqual([]);
  });

  it.skip('npx prettier --write fires through the transparent wrapper', () => {
    expect(parseCommand(`npx prettier --write ${join(dir, 'f.ts')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.ts'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('npx --no-install eslint --fix fires', () => {
    expect(parseCommand(`npx --no-install eslint --fix ${join(dir, 'f.ts')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.ts'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('npx -y prettier --write fires', () => {
    expect(parseCommand(`npx -y prettier --write ${join(dir, 'f.ts')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.ts'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('yarn / pnpm exec / bunx / npm exec wrappers strip cleanly', () => {
    expect(parseCommand(`yarn prettier --write ${join(dir, 'f.ts')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.ts'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`pnpm exec prettier --write ${join(dir, 'f.ts')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.ts'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`bunx prettier --write ${join(dir, 'f.ts')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.ts'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`npm exec prettier --write ${join(dir, 'f.ts')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.ts'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('a quoted npx invocation (string-form) is unresolved', () => {
    expectUnresolved(`npx "prettier --write ${join(dir, 'f.ts')}"`, 'formatter-write');
  });

  it.skip('npx --package=foo prettier --write f is unresolved (argv altered)', () => {
    expectUnresolved(`npx --package=foo prettier --write ${join(dir, 'f.ts')}`, 'formatter-write');
  });

  it.skip('an unknown executable with --write fires nothing', () => {
    expect(parseCommand(`somefixer --write ${join(dir, 'f.ts')}`)).toEqual([]);
  });
});

describe('git restore and git checkout pathspecs (§5.9)', () => {
  it.skip('git restore f: create-overwrite', () => {
    expect(parseCommand(`git restore ${join(dir, 'five.txt')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('git restore --source=tree f: the -s value is a tree, not a pathspec', () => {
    expect(parseCommand(`git restore --source=HEAD~1 ${join(dir, 'five.txt')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`git restore -s HEAD~1 ${join(dir, 'five.txt')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('git restore --staged --worktree f: both sides → create-overwrite', () => {
    expect(parseCommand(`git restore --staged --worktree ${join(dir, 'five.txt')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`git restore -W ${join(dir, 'five.txt')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('git restore --staged f: the index-only write touches nothing', () => {
    expect(parseCommand(`git restore --staged ${join(dir, 'five.txt')}`)).toEqual([]);
  });

  it.skip('git restore -m f: conflict-resolution restore touches nothing', () => {
    expect(parseCommand(`git restore -m ${join(dir, 'five.txt')}`)).toEqual([]);
  });

  it.skip('git restore --patch f: interactive hunk selection is unresolved', () => {
    expectUnresolved(`git restore --patch ${join(dir, 'five.txt')}`, 'git-restore-write');
  });

  it.skip('git restore -- f: the -- separator is stripped', () => {
    expect(parseCommand(`git restore -- ${join(dir, 'five.txt')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('git restore .: directory-shaped pathspecs are unresolved', () => {
    expectUnresolved('git restore .', 'git-restore-write');
  });

  it.skip('git restore dir/ and dir: directory-shaped pathspecs are unresolved', () => {
    expectUnresolved(`git restore ${join(dir, 'destdir')}/`, 'git-restore-write');
    expectUnresolved(`git restore ${join(dir, 'destdir')}`, 'git-restore-write');
  });

  it.skip('git checkout -- f: create-overwrite', () => {
    expect(parseCommand(`git checkout -- ${join(dir, 'five.txt')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('git checkout f: a branch operand touches nothing', () => {
    expect(parseCommand(`git checkout ${join(dir, 'five.txt')}`)).toEqual([]);
  });

  it.skip('git checkout -b new: no pathspec, no touch', () => {
    expect(parseCommand('git checkout -b feature/x')).toEqual([]);
  });

  it.skip('git checkout -- dir: directory-shaped → unresolved', () => {
    expectUnresolved(`git checkout -- ${join(dir, 'destdir')}`, 'git-checkout-write');
    expectUnresolved('git checkout -- .', 'git-checkout-write');
  });

  it.skip('git checkout branch -- f: the pathspec after the ref resolves', () => {
    expect(parseCommand(`git checkout main -- ${join(dir, 'five.txt')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it.skip('git -C dir restore five.txt resolves against dir', () => {
    expect(parseCommand(`git -C ${dir} restore five.txt`, '/')).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 }
    ]);
  });
});

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
 * The trailing describe blocks are the card's Phase 2 acceptance checks:
 * the write-touch family grammars (plan §5), unskipped as each family
 * landed, then main's execution-aware-walk contract (merged below).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Idiom,
  type ParseOptions,
  parseCommand,
  parseCommandDetailed,
  type SpanMatch
} from '../../src/common/parse-command.js';
import { splitTopLevel } from '../../src/common/shell-split.js';
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

/** `diff -u`-format creation — no `new file mode` header, `--- /dev/null` only → `create-overwrite`. */
const PATCH_DIFFU_NEW_DIFF = ['--- /dev/null', '+++ nf.txt', '@@ -0,0 +1 @@', '+n1'].join('\n');

/** `diff -u`-format headers carrying the tab-separated timestamp column (the `--- f.txt\t<ts>` shape). */
const PATCH_TAB_TS_DIFF = [
  '--- notes.txt\t2024-01-01 00:00:00.000000000 +0000',
  '+++ notes.txt\t2024-01-01 00:00:01.000000000 +0000',
  '@@ -1,3 +1,3 @@',
  ' one',
  '-two',
  "+two'",
  ' three'
].join('\n');

/** CRLF-terminated patch text (`\r` on every line, Windows-authored). */
const PATCH_CRLF_DIFF = [
  '--- a/notes.txt\r',
  '+++ b/notes.txt\r',
  '@@ -1,3 +1,3 @@\r',
  ' one\r',
  '-two\r',
  "+two'\r",
  ' three\r'
].join('\n');

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
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'sub', 'five.txt'), `${Array.from({ length: 5 }, (_, i) => `l${i + 1}`).join('\n')}\n`);
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

  it('embedded in a larger && chain: an opaque first stage poisons the chain (plan §2 owned consequence)', () => {
    // `echo` is not a known-status stage — its unknown status gates everything
    // downstream in the `&&` chain, so sed never emits (plan §2: `echo start &&
    // sed f` emits nothing).
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
    const spans = parseCommand(`git -C ${repo.root} show HEAD:blob.ts`, { cwd: '/' });
    expect(spans).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 8, absolutePath: join(repo.root, 'blob.ts'), simpleCommandIndex: 0 }
    ]);
  });

  it('git show without a rev:path colon does not match', () => {
    expect(parseCommand('git show HEAD --stat', { cwd: repo.root })).toEqual([]);
  });

  it('unknown revision: matched idiom, unresolved result', () => {
    const detailed = parseCommandDetailed('git show not-a-real-rev:blob.ts', { cwd: repo.root });
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
  it('cat > file <<EOF overwrite: whole-file write span threading the literal body', () => {
    const cmd = `cat > ${join(dir, 'out1.txt')} <<'EOF'\nalpha\nbeta\ngamma\nEOF\n`;
    const spans = parseCommand(cmd);
    expect(spans).toEqual([
      {
        operation: 'create-overwrite',
        absolutePath: join(dir, 'out1.txt'),
        written: 'alpha\nbeta\ngamma\n',
        simpleCommandIndex: 0
      }
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
      {
        operation: 'create-overwrite',
        absolutePath: join(dir, 'out2.sh'),
        written: 'echo a && echo b\necho c\n',
        simpleCommandIndex: 0
      }
    ]);
  });

  it('two heredocs in one command both resolve, in order', () => {
    const cmd = `cat > ${join(dir, 'a.txt')} <<'EOF'\nx\nEOF\ncat > ${join(dir, 'b.txt')} <<'EOF'\ny\nz\nEOF\n`;
    const spans = parseCommand(cmd);
    expect(spans).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'a.txt'), written: 'x\n', simpleCommandIndex: 0 },
      { operation: 'create-overwrite', absolutePath: join(dir, 'b.txt'), written: 'y\nz\n', simpleCommandIndex: 1 }
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

  it('cd "$WORKSPACE_PATH"; cd sub — the seed persists, so a later literal cd re-bases from it', () => {
    const spans = parseCommand('cd "$WORKSPACE_PATH"; cd sub; sed -n \'1,2p\' five.txt', dir);
    expect(spans).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 2, absolutePath: join(dir, 'sub', 'five.txt'), simpleCommandIndex: 2 }
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
  it('echo > f: create-overwrite whole-file write threading the literal body', () => {
    expect(parseCommand(`echo x > ${join(dir, 'f')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'f'), written: 'x\n', simpleCommandIndex: 0 }
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
      { operation: 'create-overwrite', absolutePath: join(dir, 'out'), written: 'x\n', simpleCommandIndex: 0 }
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

  it('exec > f truncates (the fd-1 target is static even though exec writes nothing)', () => {
    expect(parseCommand(`exec > ${join(dir, 'f')}`)).toEqual([
      { operation: 'truncate', absolutePath: join(dir, 'f'), simpleCommandIndex: 0 }
    ]);
  });

  it('exec > f with a dup redirect still truncates; exec >> f appends nothing', () => {
    expect(parseCommand(`exec > ${join(dir, 'f')} 2>&1`)).toEqual([
      { operation: 'truncate', absolutePath: join(dir, 'f'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`exec >> ${join(dir, 'f')}`)).toEqual([]);
    expect(parseCommand(`exec 2> ${join(dir, 'err')}`)).toEqual([]);
  });

  it(': >> f appends nothing: no touch', () => {
    expect(parseCommand(`: >> ${join(dir, 'f')}`)).toEqual([]);
  });

  it('a quoted ">" is a literal argument, not a redirect', () => {
    expect(parseCommand(`echo '>' ${join(dir, 'f')}`)).toEqual([]);
  });

  it('attached targets: >f and >>f', () => {
    expect(parseCommand(`echo x >${join(dir, 'f')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'f'), written: 'x\n', simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`echo x >>${join(dir, 'f')}`)).toEqual([
      { operation: 'append', absolutePath: join(dir, 'f'), written: 'x\n', simpleCommandIndex: 0 }
    ]);
  });

  it('a quoted redirect target may contain spaces', () => {
    const target = join(dir, 'my file');
    expect(parseCommand(`echo x > "${target}"`)).toEqual([
      { operation: 'create-overwrite', absolutePath: target, written: 'x\n', simpleCommandIndex: 0 }
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
      { operation: 'create-overwrite', absolutePath: join(dir, 'f'), written: 'body\n', simpleCommandIndex: 0 }
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
    expect(parseCommand(cmd)).toEqual([
      { operation: 'create-overwrite', absolutePath: target, written: 'body\n', simpleCommandIndex: 0 }
    ]);
  });

  it('tee f <<EOF: create-overwrite threading the body', () => {
    const cmd = `tee ${join(dir, 'f')} <<'EOF'\nalpha\nbeta\nEOF\n`;
    expect(parseCommand(cmd)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'f'), written: 'alpha\nbeta\n', simpleCommandIndex: 0 }
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
      { operation: 'create-overwrite', absolutePath: join(dir, 'f'), written: 'body\n', simpleCommandIndex: 0 }
    ]);
  });

  it('echo x | tee f: create-overwrite threading the literal pipe source', () => {
    expect(parseCommand(`echo x | tee ${join(dir, 'f')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'f'), written: 'x\n', simpleCommandIndex: 1 }
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
      { operation: 'create-overwrite', absolutePath: join(dir, 'f'), written: 'indented\n', simpleCommandIndex: 0 }
    ]);
  });

  it('a bare unquoted delimiter still resolves the heredoc', () => {
    const cmd = `cat > ${join(dir, 'f')} <<EOF\nbody\nEOF\n`;
    expect(parseCommand(cmd)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'f'), written: 'body\n', simpleCommandIndex: 0 }
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

  it('an unquoted delimiter with $ in the body never threads it as exact content', () => {
    // The shell expands $HOME before cat reads the body, so the bytes the
    // file gets are not the body's raw text — the span stays existence-gated.
    const cmd = `cat > ${join(dir, 'f')} <<EOF\n$HOME is $HOME\nEOF\n`;
    expect(parseCommand(cmd)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'f'), simpleCommandIndex: 0 }
    ]);
  });

  it('an unquoted delimiter with a backtick body threads nothing either', () => {
    const cmd = `cat > ${join(dir, 'f')} <<EOF\n\`date\`\nEOF\n`;
    expect(parseCommand(cmd)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'f'), simpleCommandIndex: 0 }
    ]);
  });

  it('an unquoted expandable body on an append threads nothing (existence-gated append)', () => {
    const cmd = `cat >> ${join(dir, 'f')} <<EOF\n$X\nEOF\n`;
    expect(parseCommand(cmd)).toEqual([{ operation: 'append', absolutePath: join(dir, 'f'), simpleCommandIndex: 0 }]);
  });

  it('a quoted delimiter keeps threading exact content even with $ in the body (control)', () => {
    const cmd = `cat > ${join(dir, 'f')} <<'EOF'\n$HOME\nEOF\n`;
    expect(parseCommand(cmd)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'f'), written: '$HOME\n', simpleCommandIndex: 0 }
    ]);
  });

  it('a backslash-escaped delimiter quotes the body too (<<\\EOF)', () => {
    const cmd = `cat > ${join(dir, 'f')} <<\\EOF\n$HOME\nEOF\n`;
    expect(parseCommand(cmd)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'f'), written: '$HOME\n', simpleCommandIndex: 0 }
    ]);
  });

  it('an unquoted body with a plain backslash still threads (no shell-processed escape)', () => {
    const cmd = `cat > ${join(dir, 'f')} <<EOF\nalpha\\beta\nEOF\n`;
    expect(parseCommand(cmd)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'f'), written: 'alpha\\beta\n', simpleCommandIndex: 0 }
    ]);
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

  it('env FOO=bar cp src dst: assignments after the env wrapper are stripped', () => {
    expect(parseCommand(`env FOO=bar cp ${join(dir, 'src.txt')} ${join(dir, 'dst.txt')}`)).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 4, absolutePath: join(dir, 'src.txt'), simpleCommandIndex: 0 },
      { operation: 'create-overwrite', absolutePath: join(dir, 'dst.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('env FOO=1 BAR=2 cp src dst: every leading assignment is stripped', () => {
    expect(parseCommand(`env FOO=1 BAR=2 cp ${join(dir, 'src.txt')} ${join(dir, 'dst.txt')}`)).toEqual([
      { operation: 'read', lineStart: 1, lineEnd: 4, absolutePath: join(dir, 'src.txt'), simpleCommandIndex: 0 },
      { operation: 'create-overwrite', absolutePath: join(dir, 'dst.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('cp -n src dst: the no-clobber flag is consumed, the pair still parses', () => {
    expect(parseCommand(`cp -n ${join(dir, 'src.txt')} ${join(dir, 'dst.txt')}`)).toEqual([
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
  it('truncate -s 0 f: size 0 truncates (empty gate)', () => {
    expect(parseCommand(`truncate -s 0 ${join(dir, 'plain.txt')}`)).toEqual([
      { operation: 'truncate', absolutePath: join(dir, 'plain.txt'), size: 0, simpleCommandIndex: 0 }
    ]);
  });

  it('truncate -s 100 f: the statically evaluated size rides the span', () => {
    expect(parseCommand(`truncate -s 100 ${join(dir, 'plain.txt')}`)).toEqual([
      { operation: 'truncate', absolutePath: join(dir, 'plain.txt'), size: 100, simpleCommandIndex: 0 }
    ]);
  });

  it('truncate -s 2K f: the K suffix is statically evaluated', () => {
    expect(parseCommand(`truncate -s 2K ${join(dir, 'plain.txt')}`)).toEqual([
      { operation: 'truncate', absolutePath: join(dir, 'plain.txt'), size: 2048, simpleCommandIndex: 0 }
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
      { operation: 'truncate', absolutePath: join(dir, 'plain.txt'), size: 0, simpleCommandIndex: 0 }
    ]);
  });
});

describe('sed -i in-place edits (§5.6)', () => {
  it('a numeric address range scopes the modify to the exact range', () => {
    expect(parseCommand(`sed -i '2,4s/x/y/' ${join(dir, 'twenty.txt')}`)).toEqual([
      { operation: 'modify', lineStart: 2, lineEnd: 4, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('a single numeric address is a single-line range', () => {
    expect(parseCommand(`sed -i '3s/x/y/' ${join(dir, 'five.txt')}`)).toEqual([
      { operation: 'modify', lineStart: 3, lineEnd: 3, absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('a pattern address is a whole-file modify', () => {
    expect(parseCommand(`sed -i '/x/s/y/z/' ${join(dir, 'twenty.txt')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('a count-changing script (2d) is a whole-file modify', () => {
    expect(parseCommand(`sed -i '2d' ${join(dir, 'twenty.txt')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('an attached suffix: modify + backup create-overwrite on f.bak', () => {
    expect(parseCommand(`sed -i.bak 's/x/y/' ${join(dir, 'twenty.txt')}`)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 20, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 },
      { operation: 'create-overwrite', absolutePath: join(dir, 'twenty.txt.bak'), simpleCommandIndex: 0 }
    ]);
  });

  it('a separate suffix: modify + backup create-overwrite on f.bak', () => {
    expect(parseCommand(`sed -i .bak 's/x/y/' ${join(dir, 'twenty.txt')}`)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 20, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 },
      { operation: 'create-overwrite', absolutePath: join(dir, 'twenty.txt.bak'), simpleCommandIndex: 0 }
    ]);
  });

  it('an empty separate suffix is an in-place modify with no backup', () => {
    expect(parseCommand(`sed -i '' 's/x/y/' ${join(dir, 'twenty.txt')}`)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 20, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('script-first: the script is never a suffix, f is the file', () => {
    expect(parseCommand(`sed -i 's/x/y/' ${join(dir, 'twenty.txt')}`)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 20, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('-e script: modify on f', () => {
    expect(parseCommand(`sed -i -e 's/x/y/' ${join(dir, 'twenty.txt')}`)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 20, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('sed -i without a script is unresolved', () => {
    expectUnresolved(`sed -i '' ${join(dir, 'twenty.txt')}`, 'sed-inplace');
  });

  it('multi-file bare -i: the script word after -i is never a suffix (the multi-file sed misparse)', () => {
    // `sed -i s/a/b/ f g`: the script is the word right after bare -i (GNU's
    // reading), so both files are operands — neither may be swallowed as a
    // BSD separate suffix.
    expect(parseCommand(`sed -i s/a/b/ ${join(dir, 'twenty.txt')} ${join(dir, 'five.txt')}`)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 20, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 },
      { operation: 'modify', lineStart: 1, lineEnd: 5, absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('multi-file with an attached suffix: both files modify, both backups fire', () => {
    expect(parseCommand(`sed -i.bak s/a/b/ ${join(dir, 'twenty.txt')} ${join(dir, 'five.txt')}`)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 20, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 },
      { operation: 'create-overwrite', absolutePath: join(dir, 'twenty.txt.bak'), simpleCommandIndex: 0 },
      { operation: 'modify', lineStart: 1, lineEnd: 5, absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 },
      { operation: 'create-overwrite', absolutePath: join(dir, 'five.txt.bak'), simpleCommandIndex: 0 }
    ]);
  });

  it('multi-file with a BSD separate suffix: suffix-shaped word still reads as the suffix', () => {
    expect(parseCommand(`sed -i .bak s/a/b/ ${join(dir, 'twenty.txt')} ${join(dir, 'five.txt')}`)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 20, absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 },
      { operation: 'create-overwrite', absolutePath: join(dir, 'twenty.txt.bak'), simpleCommandIndex: 0 },
      { operation: 'modify', lineStart: 1, lineEnd: 5, absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 },
      { operation: 'create-overwrite', absolutePath: join(dir, 'five.txt.bak'), simpleCommandIndex: 0 }
    ]);
  });

  it('an address-leading script word after bare -i is a script, not a suffix', () => {
    expect(parseCommand(`sed -i 2d ${join(dir, 'twenty.txt')} ${join(dir, 'five.txt')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'twenty.txt'), simpleCommandIndex: 0 },
      { operation: 'modify', absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 }
    ]);
  });
});

describe('patch and git apply (§5.7)', () => {
  it('git apply <file>: hunks resolve targets, ranges from the hunk headers', () => {
    expect(parseCommand(`git apply ${join(dir, 'p.diff')}`, dir)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'notes.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('git apply - < file: the stdin < source is read as patch text', () => {
    expect(parseCommand(`git apply - < ${join(dir, 'p.diff')}`, dir)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'notes.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('patch -p1 < file', () => {
    expect(parseCommand(`patch -p1 < ${join(dir, 'p.diff')}`, dir)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'notes.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('a heredoc patch body resolves the hunk targets', () => {
    const cmd = `patch -p1 <<'EOF'\n${PATCH_NOTES_DIFF}\nEOF\n`;
    expect(parseCommand(cmd, dir)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'notes.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('read-only modes: --check / --stat / --numstat / --summary touch nothing', () => {
    expect(parseCommand(`git apply --check ${join(dir, 'p.diff')}`, dir)).toEqual([]);
    expect(parseCommand(`git apply --stat ${join(dir, 'p.diff')}`, dir)).toEqual([]);
    expect(parseCommand(`git apply --numstat ${join(dir, 'p.diff')}`, dir)).toEqual([]);
    expect(parseCommand(`git apply --summary ${join(dir, 'p.diff')}`, dir)).toEqual([]);
  });

  it('patch --dry-run is read-only', () => {
    expect(parseCommand(`patch --dry-run < ${join(dir, 'p.diff')}`, dir)).toEqual([]);
  });

  it('git apply --cached: the index write touches nothing', () => {
    expect(parseCommand(`git apply --cached ${join(dir, 'p.diff')}`, dir)).toEqual([]);
  });

  it('git apply --index applies to the tree and the index → modify', () => {
    expect(parseCommand(`git apply --index ${join(dir, 'p.diff')}`, dir)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'notes.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('patch -N: patch options are compatible', () => {
    expect(parseCommand(`patch -N < ${join(dir, 'p.diff')}`, dir)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'notes.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('--directory=sub fails closed (unresolved)', () => {
    expectUnresolved(`git apply --directory=sub ${join(dir, 'p.diff')}`, 'patch-write');
  });

  it('a binary patch resolves a whole-file modify', () => {
    const cmd = `git apply <<'EOF'\n${PATCH_BINARY_DIFF}\nEOF\n`;
    expect(parseCommand(cmd, dir)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'img.bin'), simpleCommandIndex: 0 }
    ]);
  });

  it('a rename patch resolves source delete + dest rename-copy', () => {
    const cmd = `git apply <<'EOF'\n${PATCH_RENAME_DIFF}\nEOF\n`;
    expect(parseCommand(cmd, dir)).toEqual([
      { operation: 'delete', absolutePath: join(dir, 'old.txt'), simpleCommandIndex: 0 },
      { operation: 'rename-copy', absolutePath: join(dir, 'new.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('a deleted-file header resolves delete', () => {
    const cmd = `git apply <<'EOF'\n${PATCH_DELETED_DIFF}\nEOF\n`;
    expect(parseCommand(cmd, dir)).toEqual([
      { operation: 'delete', absolutePath: join(dir, 'gone.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('a +++ /dev/null-only deletion (diff -u style) resolves delete', () => {
    const cmd = `git apply <<'EOF'\n${PATCH_DEVNULL_DIFF}\nEOF\n`;
    expect(parseCommand(cmd, dir)).toEqual([
      { operation: 'delete', absolutePath: join(dir, 'gone.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('a --- /dev/null-only creation (diff -u style, no new file mode header) resolves create-overwrite', () => {
    const cmd = `git apply <<'EOF'\n${PATCH_DIFFU_NEW_DIFF}\nEOF\n`;
    expect(parseCommand(cmd, dir)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'nf.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('a new-file header resolves create-overwrite', () => {
    const cmd = `git apply <<'EOF'\n${PATCH_NEW_DIFF}\nEOF\n`;
    expect(parseCommand(cmd, dir)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'new.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('a count-changing hunk resolves a whole-file modify', () => {
    const cmd = `git apply <<'EOF'\n${PATCH_GROWING_DIFF}\nEOF\n`;
    expect(parseCommand(cmd, dir)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'notes.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('diff -u headers with a tab+timestamp: patch -p0 targets the --- side', () => {
    const cmd = `patch -p0 <<'EOF'\n${PATCH_TAB_TS_DIFF}\nEOF\n`;
    expect(parseCommand(cmd, dir)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'notes.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('diff -u headers with a tab+timestamp: git apply reads them too', () => {
    const cmd = `git apply <<'EOF'\n${PATCH_TAB_TS_DIFF}\nEOF\n`;
    expect(parseCommand(cmd, dir)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'notes.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('CRLF patch text parses: the \\r never pollutes headers or hunk headers', () => {
    const cmd = `patch -p1 <<'EOF'\n${PATCH_CRLF_DIFF}\nEOF\n`;
    expect(parseCommand(cmd, dir)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'notes.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('diff -u f f.new: the +++ side is a label — the --- side is the target', () => {
    const diff = ['--- notes.txt', '+++ notes.new', '@@ -1,3 +1,3 @@', ' one', '-two', '+two!', ' three'].join('\n');
    const cmd = `patch -p0 <<'EOF'\n${diff}\nEOF\n`;
    expect(parseCommand(cmd, dir)).toEqual([
      { operation: 'modify', lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'notes.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('patch f: the operand is a target, not a patch — no source, no touch', () => {
    expect(parseCommand(`patch ${join(dir, 'notes.txt')}`)).toEqual([]);
  });

  it('a variable patch path is unresolved', () => {
    expectUnresolved('git apply "$PATCH_FILE"', 'patch-write');
  });

  it('a piped patch (git diff | git apply) is unresolved', () => {
    expect(parseCommand('git diff | git apply')).toEqual([]);
    expectUnresolved('git diff | git apply', 'patch-write');
  });
});

describe('formatters and fixers (§5.8)', () => {
  it('prettier: --write fires, --check is read-only', () => {
    expect(parseCommand(`prettier --write ${join(dir, 'f.ts')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.ts'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`prettier --check ${join(dir, 'f.ts')}`)).toEqual([]);
  });

  it('eslint: --fix fires, bare lints, --fix-dry-run never collides with --fix', () => {
    expect(parseCommand(`eslint --fix ${join(dir, 'f.ts')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.ts'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`eslint ${join(dir, 'f.ts')}`)).toEqual([]);
    expect(parseCommand(`eslint --fix-dry-run ${join(dir, 'f.ts')}`)).toEqual([]);
  });

  it('clang-format: bare emits to stdout (no touch), -i fires', () => {
    expect(parseCommand(`clang-format ${join(dir, 'f.cpp')}`)).toEqual([]);
    expect(parseCommand(`clang-format -i ${join(dir, 'f.cpp')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.cpp'), simpleCommandIndex: 0 }
    ]);
  });

  it('black: bare is in-place, --check is read-only', () => {
    expect(parseCommand(`black ${join(dir, 'f.py')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.py'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`black --check ${join(dir, 'f.py')}`)).toEqual([]);
  });

  it('ruff: check --fix fixes, format is an in-place formatter, bare check lints', () => {
    expect(parseCommand(`ruff check ${join(dir, 'f.py')}`)).toEqual([]);
    expect(parseCommand(`ruff check --fix ${join(dir, 'f.py')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.py'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`ruff format ${join(dir, 'f.py')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.py'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`ruff format --check ${join(dir, 'f.py')}`)).toEqual([]);
  });

  it('deno fmt fires; --check is read-only', () => {
    expect(parseCommand(`deno fmt ${join(dir, 'f.ts')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.ts'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`deno fmt --check ${join(dir, 'f.ts')}`)).toEqual([]);
  });

  it('gofmt: -w fires, -l is read-only, bare emits to stdout', () => {
    expect(parseCommand(`gofmt -w ${join(dir, 'f.go')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.go'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`gofmt -l ${join(dir, 'f.go')}`)).toEqual([]);
    expect(parseCommand(`gofmt ${join(dir, 'f.go')}`)).toEqual([]);
  });

  it('rustfmt: bare is in-place, --check is read-only', () => {
    expect(parseCommand(`rustfmt ${join(dir, 'f.rs')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.rs'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`rustfmt --check ${join(dir, 'f.rs')}`)).toEqual([]);
  });

  it('terraform fmt fires; -check is read-only', () => {
    expect(parseCommand(`terraform fmt ${join(dir, 'f.tf')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.tf'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`terraform fmt -check ${join(dir, 'f.tf')}`)).toEqual([]);
  });

  it('isort: bare is in-place, --check-only is read-only', () => {
    expect(parseCommand(`isort ${join(dir, 'f.py')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.py'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`isort --check-only ${join(dir, 'f.py')}`)).toEqual([]);
  });

  it('biome: check --write fires, bare check lints', () => {
    expect(parseCommand(`biome check --write ${join(dir, 'f.ts')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.ts'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`biome check ${join(dir, 'f.ts')}`)).toEqual([]);
  });

  it('shfmt: -w fires, -d is read-only', () => {
    expect(parseCommand(`shfmt -w ${join(dir, 'f.sh')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.sh'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`shfmt -d ${join(dir, 'f.sh')}`)).toEqual([]);
  });

  it('yapf: -i fires, --diff is read-only', () => {
    expect(parseCommand(`yapf -i ${join(dir, 'f.py')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.py'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`yapf --diff ${join(dir, 'f.py')}`)).toEqual([]);
  });

  it('autopep8: -i fires, -d is read-only', () => {
    expect(parseCommand(`autopep8 -i ${join(dir, 'f.py')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.py'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`autopep8 -d ${join(dir, 'f.py')}`)).toEqual([]);
  });

  it('goimports: -w fires, bare emits to stdout', () => {
    expect(parseCommand(`goimports -w ${join(dir, 'f.go')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.go'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`goimports ${join(dir, 'f.go')}`)).toEqual([]);
  });

  it('dprint: fmt fires, check is read-only', () => {
    expect(parseCommand(`dprint fmt ${join(dir, 'f.ts')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.ts'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`dprint check ${join(dir, 'f.ts')}`)).toEqual([]);
  });

  it('npx prettier --write fires through the transparent wrapper', () => {
    expect(parseCommand(`npx prettier --write ${join(dir, 'f.ts')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.ts'), simpleCommandIndex: 0 }
    ]);
  });

  it('npx --no-install eslint --fix fires', () => {
    expect(parseCommand(`npx --no-install eslint --fix ${join(dir, 'f.ts')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.ts'), simpleCommandIndex: 0 }
    ]);
  });

  it('npx -y prettier --write fires', () => {
    expect(parseCommand(`npx -y prettier --write ${join(dir, 'f.ts')}`)).toEqual([
      { operation: 'modify', absolutePath: join(dir, 'f.ts'), simpleCommandIndex: 0 }
    ]);
  });

  it('yarn / pnpm exec / bunx / npm exec wrappers strip cleanly', () => {
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

  it('a quoted npx invocation (string-form) is unresolved', () => {
    expectUnresolved(`npx "prettier --write ${join(dir, 'f.ts')}"`, 'formatter-write');
  });

  it('npx --package=foo prettier --write f is unresolved (argv altered)', () => {
    expectUnresolved(`npx --package=foo prettier --write ${join(dir, 'f.ts')}`, 'formatter-write');
  });

  it('an unknown executable with --write fires nothing', () => {
    expect(parseCommand(`somefixer --write ${join(dir, 'f.ts')}`)).toEqual([]);
  });
});

describe('git restore and git checkout pathspecs (§5.9)', () => {
  it('git restore f: create-overwrite', () => {
    expect(parseCommand(`git restore ${join(dir, 'five.txt')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('git restore --source=tree f: the -s value is a tree, not a pathspec', () => {
    expect(parseCommand(`git restore --source=HEAD~1 ${join(dir, 'five.txt')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`git restore -s HEAD~1 ${join(dir, 'five.txt')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('git restore --staged --worktree f: both sides → create-overwrite', () => {
    expect(parseCommand(`git restore --staged --worktree ${join(dir, 'five.txt')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 }
    ]);
    expect(parseCommand(`git restore -W ${join(dir, 'five.txt')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('git restore --staged f: the index-only write touches nothing', () => {
    expect(parseCommand(`git restore --staged ${join(dir, 'five.txt')}`)).toEqual([]);
  });

  it('git restore -m f: conflict-resolution restore touches nothing', () => {
    expect(parseCommand(`git restore -m ${join(dir, 'five.txt')}`)).toEqual([]);
  });

  it('git restore --patch f: interactive hunk selection is unresolved', () => {
    expectUnresolved(`git restore --patch ${join(dir, 'five.txt')}`, 'git-restore-write');
  });

  it('git restore -- f: the -- separator is stripped', () => {
    expect(parseCommand(`git restore -- ${join(dir, 'five.txt')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('git restore .: directory-shaped pathspecs are unresolved', () => {
    expectUnresolved('git restore .', 'git-restore-write');
  });

  it('git restore dir/ and dir: directory-shaped pathspecs are unresolved', () => {
    expectUnresolved(`git restore ${join(dir, 'destdir')}/`, 'git-restore-write');
    expectUnresolved(`git restore ${join(dir, 'destdir')}`, 'git-restore-write');
  });

  it('git checkout -- f: create-overwrite', () => {
    expect(parseCommand(`git checkout -- ${join(dir, 'five.txt')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('git checkout f: a branch operand touches nothing', () => {
    expect(parseCommand(`git checkout ${join(dir, 'five.txt')}`)).toEqual([]);
  });

  it('git checkout -b new: no pathspec, no touch', () => {
    expect(parseCommand('git checkout -b feature/x')).toEqual([]);
  });

  it('git checkout -- dir: directory-shaped → unresolved', () => {
    expectUnresolved(`git checkout -- ${join(dir, 'destdir')}`, 'git-checkout-write');
    expectUnresolved('git checkout -- .', 'git-checkout-write');
  });

  it('git checkout branch -- f: the pathspec after the ref resolves', () => {
    expect(parseCommand(`git checkout main -- ${join(dir, 'five.txt')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 }
    ]);
  });

  it('git -C dir restore five.txt resolves against dir', () => {
    expect(parseCommand(`git -C ${dir} restore five.txt`, '/')).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'five.txt'), simpleCommandIndex: 0 }
    ]);
  });
});

describe('span-less builtin guards (§3 step 2)', () => {
  it('false && echo x > f: the guard carries its exit status, the write still parses', () => {
    const detailed = parseCommandDetailed(`false && echo x > ${join(dir, 'f')}`);
    expect(detailed).toEqual([
      { status: 'builtin-guard', simpleCommandIndex: 0, join: undefined, exitStatus: 1 },
      {
        status: 'resolved',
        idiom: 'redirect-write',
        span: {
          operation: 'create-overwrite',
          absolutePath: join(dir, 'f'),
          written: 'x\n',
          simpleCommandIndex: 1,
          join: '&&'
        }
      }
    ]);
    // parseCommand filters guards out with the unresolveds.
    expect(parseCommand(`false && echo x > ${join(dir, 'f')}`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'f'), written: 'x\n', simpleCommandIndex: 1, join: '&&' }
    ]);
  });

  it('true || echo x > f: the guard marks the succeeded join, the write still parses', () => {
    const detailed = parseCommandDetailed(`true || echo x > ${join(dir, 'f')}`);
    expect(detailed).toEqual([
      { status: 'builtin-guard', simpleCommandIndex: 0, join: undefined, exitStatus: 0 },
      {
        status: 'resolved',
        idiom: 'redirect-write',
        span: {
          operation: 'create-overwrite',
          absolutePath: join(dir, 'f'),
          written: 'x\n',
          simpleCommandIndex: 1,
          join: '||'
        }
      }
    ]);
  });

  it(': as a guard: a bare `:` exits 0', () => {
    const detailed = parseCommandDetailed(`: && echo x > ${join(dir, 'f')}`);
    expect(detailed[0]).toEqual({ status: 'builtin-guard', simpleCommandIndex: 0, join: undefined, exitStatus: 0 });
  });

  it('a guard inside a compound still emits spans for the other commands', () => {
    expect(parseCommand(`cd ${dir} && false && echo x > f`)).toEqual([
      { operation: 'create-overwrite', absolutePath: join(dir, 'f'), written: 'x\n', simpleCommandIndex: 2, join: '&&' }
    ]);
  });

  it('a plain unknown span-less command emits no guard (fail open)', () => {
    expect(parseCommandDetailed(`whatever || echo x > ${join(dir, 'f')}`, dir)).toEqual([
      {
        status: 'resolved',
        idiom: 'redirect-write',
        span: {
          operation: 'create-overwrite',
          absolutePath: join(dir, 'f'),
          written: 'x\n',
          simpleCommandIndex: 1,
          join: '||'
        }
      }
    ]);
  });
});

describe('find -delete is deliberately not covered (§5.5)', () => {
  it('find . -name "*.txt" -delete emits no span (paths are directory-content-dependent)', () => {
    expect(parseCommand('find . -name "*.txt" -delete')).toEqual([]);
    expect(parseCommand(`find ${dir} -name report.txt -delete`)).toEqual([]);
  });
});
// ---------------------------------------------------------------------------
// Phase 2 — execution-aware walk contract, merged.
//
// The branch (HEAD of this merge) replaced the emission path with the
// write-touch family grammars and driver-side gating (plan §5, §3); main's
// execution walk (`analyzeExecution`) survives only as dead-but-exported
// machinery (xtrace-oracle.test.ts imports it). These rows pin what the
// merged parser actually emits: main's `splitTopLevel` decides the malformed,
// case-region, and comment rows in sections 2, 3, 4, 6, and 7; the heredoc
// machinery and the emission path decide sections 1 and 15. The walk-owned
// rows main pinned — chain gating (sections 1, 7, 8), decidable constructs
// (5), errexit and pipefail (9, 10), pipeline window algebra (11), wrappers
// (12), variable expansion (13), and cd certainty (14) — are superseded: the
// merged parser always emits spans and stamps each with its `join` operator,
// deferring gating to the driver in bash-touch.ts, so those sections were
// dropped in the merge. `builtin-guard` matches (span-less deterministic
// exit statuses: false/true/:) are the driver's join inputs, not touches —
// canonicalize below filters them.
//
// The commands below use the plan's arrow form — command → expected touches —
// with the plan's parenthetical annotations as row notes. `[]` means no
// touches; `1–2` means a line range; "whole-file" means a whole-file touch;
// `+`-separated entries mean multiple touches in order. Descriptors are
// canonicalized against the fixture cwd (files resolve to absolute paths,
// whole-file 1..TOTAL collapses to `{ file }`) before comparison with the
// parser's `SpanMatch[]` output.
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
afterAll(() => {
  rmSync(p2Dir, { recursive: true, force: true });
});
describe('execution-aware walk — Phase 2 contract', () => {
  const whole = (file: string): ExpectedTouch => ({ file });
  const range = (file: string, lo: number, hi: number): ExpectedTouch => ({ file, lo, hi });
  const writeTo = (file: string): ExpectedTouch => ({ write: file });

  /** Walk output → canonical descriptor space. */
  function canonicalize(matches: SpanMatch[]): CanonicalTouch[] {
    // `builtin-guard` matches are the driver's join inputs, not touches — the
    // parser emits them for span-less deterministic commands (`false`/`true`/
    // `:` in `&&`/`||` chains), and they carry no span to canonicalize.
    return matches.flatMap<CanonicalTouch>((m) => {
      if (m.status === 'builtin-guard') return [];
      if (m.status === 'unresolved') return [{ unresolved: m.fileArg }];
      if (m.idiom === 'heredoc-write') return [{ write: m.span.absolutePath }];
      const { lineStart, lineEnd } = m.span;
      if (lineStart === 1 && lineEnd === TOTAL) return [{ file: m.span.absolutePath }];
      return [{ file: m.span.absolutePath, lo: lineStart, hi: lineEnd }];
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
      [
        "cat f 2>&1 | sed -n '2,4p'",
        [range('f', 2, 4)],
        undefined,
        'stripped source is a clean one-file cat; 2>&1 never severs'
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

    // These rows are decided by the heredoc machinery, the case-region
    // machine, the construct machine, and the list-scope verdict semantics —
    // all Phase 2 splitter machinery (plan §3).
    const SPLITTER_ROWS: FixtureRow[] = [
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
  });

  describe('15. heredocs', () => {
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
      ]
    ];

    it.each<FixtureRow>(ROWS)('%s', (cmd, expected, opts) => {
      expectTouches(cmd, expected, opts);
    });
  });
});

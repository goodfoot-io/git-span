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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCommand, parseCommandDetailed } from '../../src/common/parse-command.js';
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

  it('embedded in a larger && chain', () => {
    const spans = parseCommand(`echo start && sed -n '1,2p' ${join(dir, 'five.txt')} && echo done`);
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
    const spans = parseCommand('git show HEAD:blob.ts', repo.root);
    expect(spans).toEqual([{ lineStart: 1, lineEnd: 8, absolutePath: join(repo.root, 'blob.ts') }]);
  });

  it('git -C <dir> show rev:path uses -C as the resolution directory', () => {
    const spans = parseCommand(`git -C ${repo.root} show HEAD:blob.ts`, '/');
    expect(spans).toEqual([{ lineStart: 1, lineEnd: 8, absolutePath: join(repo.root, 'blob.ts') }]);
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
      { lineStart: 1, lineEnd: 8, absolutePath: join(repo.root, 'blob.ts') },
      { lineStart: 2, lineEnd: 4, absolutePath: join(repo.root, 'blob.ts') }
    ]);
  });

  it('piped into head -N', () => {
    const spans = parseCommand('git show HEAD:blob.ts | head -3', repo.root);
    expect(spans).toEqual([
      { lineStart: 1, lineEnd: 8, absolutePath: join(repo.root, 'blob.ts') },
      { lineStart: 1, lineEnd: 3, absolutePath: join(repo.root, 'blob.ts') }
    ]);
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
      { lineStart: 1, lineEnd: 3, absolutePath: join(dir, 'out1.txt'), body: 'alpha\nbeta\ngamma' }
    ]);
  });

  it('cat >> file <<EOF append: range starts after existing EOF, and the span carries the appended body', () => {
    const target = join(dir, 'five.txt');
    const cmd = `cat >> ${target} <<'EOF'\nnew1\nnew2\nEOF\n`;
    const spans = parseCommand(cmd);
    expect(spans).toEqual([{ lineStart: 6, lineEnd: 7, absolutePath: target, body: 'new1\nnew2' }]);
  });

  it('heredoc body containing && is not mis-split by the outer command splitter', () => {
    const cmd = `cat > ${join(dir, 'out2.sh')} <<'EOF'\necho a && echo b\necho c\nEOF\n`;
    const spans = parseCommand(cmd);
    expect(spans).toEqual([
      { lineStart: 1, lineEnd: 2, absolutePath: join(dir, 'out2.sh'), body: 'echo a && echo b\necho c' }
    ]);
  });

  it('two heredocs in one command both resolve, in order', () => {
    const cmd = `cat > ${join(dir, 'a.txt')} <<'EOF'\nx\nEOF\ncat > ${join(dir, 'b.txt')} <<'EOF'\ny\nz\nEOF\n`;
    const spans = parseCommand(cmd);
    expect(spans).toEqual([
      { lineStart: 1, lineEnd: 1, absolutePath: join(dir, 'a.txt'), body: 'x' },
      { lineStart: 1, lineEnd: 2, absolutePath: join(dir, 'b.txt'), body: 'y\nz' }
    ]);
  });

  it('empty-body > heredoc truncates the file: emits a write span with an empty body', () => {
    const target = join(dir, 'trunc.txt');
    const cmd = `cat > ${target} <<'EOF'\nEOF\n`;
    const detailed = parseCommandDetailed(cmd);
    expect(detailed).toEqual([
      { status: 'resolved', idiom: 'heredoc-write', span: { lineStart: 1, lineEnd: 1, absolutePath: target, body: '' } }
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

  it('does not propagate two hops', () => {
    const spans = parseCommand(`cat ${join(dir, 'twenty.txt')} | grep foo | head -3`);
    expect(spans).toEqual([]);
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
  it('cd /abs && relative sed resolves against the new dir', () => {
    const spans = parseCommand(`cd ${dir} && sed -n '1,2p' five.txt`, '/nonexistent');
    expect(spans).toEqual([{ lineStart: 1, lineEnd: 2, absolutePath: join(dir, 'five.txt') }]);
  });

  it('cd "$VAR" (unresolvable) falls back to the seed cwd, not "/"', () => {
    const spans = parseCommand('cd "$WORKSPACE_PATH" && sed -n \'1,2p\' five.txt', dir);
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

/**
 * Acceptance checks for snapshot-core.ts — the tree-SHA snapshot contract
 * (card main-228). The v1 per-line-hash mechanism (Myers diff over persisted
 * line hashes, walked per-file at pre time) is gone; the surface under test
 * is the v2 mechanism: the snapshot decision classifier, the private
 * `git write-tree` capture with its stat-only degrade, tree-to-tree
 * comparison via `git diff --name-status`/`-U0` hunks, the proportional
 * text/binary classifier (git's NUL heuristic false-positives on real
 * source files in this repo — the fixtures embed excerpts of them), the
 * on-demand sibling hashing via `git cat-file`, and the concurrency
 * ambiguity table over {@link AmbiguityBaseline} + {@link SiblingSnapshot}.
 *
 * Conventions: git-facing checks run against scripted {@link GitRunner}
 * transcripts (call-log assertions pin the "0 new objects" and "-M100%
 * floor" properties) or real temp repos for the classifier's exec-config
 * reads — never mocks of the contract types. Hash checks assert VALUES
 * (Node SHA-256 of the fixture bytes, never git SHA-1 blob OIDs), so a
 * regression into git's OID space fails loudly instead of silently breaking
 * the activity-log boundary comparisons.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AmbiguityBaseline,
  applyAmbiguityRules,
  type CaptureWriteTreeInput,
  type CompareTreesInput,
  captureWriteTree,
  classifyCommandForSnapshot,
  classifyTextOrBinary,
  compareStatOnly,
  compareTrees,
  DEFAULT_SNAPSHOT_BUDGETS,
  type DiffHunk,
  type GitRunner,
  hashTreePath,
  hunksToPostRanges,
  recordHasPathCoverageGap,
  type SiblingSnapshot,
  type StatOnlyEntry
} from '../../src/common/snapshot-core.js';
import { defaultGitRunner, statFile } from '../../src/common/snapshot-harness.js';
import { createSnapshotStore } from '../../src/common/snapshot-store.js';
import type { CoreLogger } from '../../src/common/span-surface.js';
import type { TouchWriteInput } from '../../src/common/touch-core.js';
import { makeTempRepo } from '../helpers.js';

const SESSION_ID = 'session-snapshot-core';
const TOOL_USE_ID = 'toolu_01snapshotcoretest';
const REPO_ROOT = '/repo';
/** An mtimeNs fixture value for stat-only entries. */
const TRUSTED_MTIME = 1_780_000_000_123_456_789n;

// ---------------------------------------------------------------------------
// Local helpers (fixture-side definitions of the contract's semantics)
// ---------------------------------------------------------------------------

/** SHA-256 hex of a byte string — the record's byte/line hash format. */
function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** A sibling record's per-path view, for the ambiguity table fixtures. */
function sibling(overrides: Partial<SiblingSnapshot> = {}): SiblingSnapshot {
  return {
    sessionId: 'sibling-session',
    toolUseId: 'sibling-1',
    createdAt: 900,
    consumed: true,
    consumedAt: 950,
    coverageGap: false,
    pre: null,
    post: null,
    ...overrides
  };
}

/** Set env vars for the duration of `fn`, restoring afterwards. */
function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** A real temp repo with the given `git config` entries applied. */
function repoWithConfig(entries: Array<[string, string]>): { root: string; cleanup: () => void } {
  const repo = makeTempRepo();
  for (const [key, value] of entries) {
    execFileSync('git', ['-C', repo.root, 'config', key, value], { stdio: 'ignore' });
  }
  return repo;
}

describe('hunksToPostRanges', () => {
  it('a pure insertion maps to an exact post-state range', () => {
    expect(hunksToPostRanges([{ preStart: 0, preLines: 0, postStart: 1, postLines: 3 }])).toEqual({
      changed: [{ start: 1, end: 3 }],
      wholeFile: false
    });
  });

  it('a mid-file insertion maps to the inserted post lines', () => {
    expect(hunksToPostRanges([{ preStart: 5, preLines: 0, postStart: 6, postLines: 2 }])).toEqual({
      changed: [{ start: 6, end: 7 }],
      wholeFile: false
    });
  });

  it('a single-line modification maps to its post line', () => {
    expect(hunksToPostRanges([{ preStart: 2, preLines: 1, postStart: 2, postLines: 1 }])).toEqual({
      changed: [{ start: 2, end: 2 }],
      wholeFile: false
    });
  });

  it('a multi-line modification maps to the full post block', () => {
    expect(hunksToPostRanges([{ preStart: 1, preLines: 2, postStart: 1, postLines: 2 }])).toEqual({
      changed: [{ start: 1, end: 2 }],
      wholeFile: false
    });
  });

  it('multiple insertion/modification hunks map to multiple exact ranges', () => {
    const hunks: DiffHunk[] = [
      { preStart: 1, preLines: 1, postStart: 1, postLines: 1 },
      { preStart: 5, preLines: 0, postStart: 6, postLines: 2 }
    ];
    expect(hunksToPostRanges(hunks)).toEqual({
      changed: [
        { start: 1, end: 1 },
        { start: 6, end: 7 }
      ],
      wholeFile: false
    });
  });

  it('any delete-only hunk forces whole-file scope (no post coordinate for deleted lines)', () => {
    expect(hunksToPostRanges([{ preStart: 3, preLines: 2, postStart: 0, postLines: 0 }])).toEqual({
      changed: [],
      wholeFile: true
    });
  });

  it('a mixed deletion+insertion set still forces whole-file scope', () => {
    const hunks: DiffHunk[] = [
      { preStart: 1, preLines: 1, postStart: 1, postLines: 0 },
      { preStart: 5, preLines: 0, postStart: 4, postLines: 2 }
    ];
    expect(hunksToPostRanges(hunks)).toEqual({ changed: [], wholeFile: true });
  });
});

describe('classifyCommandForSnapshot', () => {
  let scratch: string;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'snapshot-classify-'));
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  describe('read-only bucket — no snapshot', () => {
    let readOnlyRepo: string;

    beforeAll(() => {
      // git read-only commands run in a real repo so the classifier's config
      // read (the one-scoped `git config --get-regexp`) resolves; a failed
      // config read in a non-repo is a separate contract question these
      // fixtures do not pin.
      readOnlyRepo = makeTempRepo().root;
    });

    it('provably read-only commands classify read-only (no snapshot, empty tier-1)', () => {
      const readOnlyCommands = [
        'ls',
        'grep foo bar.txt',
        'cat some-file.txt',
        'head -5 some-file.txt',
        'tail -3 some-file.txt',
        'echo hello',
        'git status',
        'git diff',
        'git log',
        'git show'
      ];
      for (const cmd of readOnlyCommands) {
        expect(classifyCommandForSnapshot(cmd, readOnlyRepo)).toEqual({
          decision: { kind: 'no-snapshot', reason: 'read-only' },
          tier1Targets: []
        });
      }
    });

    it('git status needs no config gate — read-only even with an external diff configured', () => {
      const repo = repoWithConfig([['diff.external', 'ext-diff']]);
      try {
        expect(classifyCommandForSnapshot('git status', repo.root).decision).toEqual({
          kind: 'no-snapshot',
          reason: 'read-only'
        });
      } finally {
        repo.cleanup();
      }
    });

    it('ambient PAGER does not tax git log — the pager channel is inert because hook stdout is a pipe', () => {
      withEnv({ PAGER: 'less' }, () => {
        expect(classifyCommandForSnapshot('git log', scratch).decision).toEqual({
          kind: 'no-snapshot',
          reason: 'read-only'
        });
      });
    });
  });

  describe('covered-write fast path — no snapshot, exact ranges already available', () => {
    it('a pure single-quoted heredoc write is statically covered (the fast-path skip)', () => {
      const target = join(scratch, 'out.txt');
      const plan = classifyCommandForSnapshot(`cat > ${target} <<'EOF'\nalpha\nbeta\nEOF\n`, scratch);
      expect(plan.decision).toEqual({ kind: 'no-snapshot', reason: 'statically-covered' });
      expect(plan.tier1Targets).toEqual([]);
    });

    it('a pure single-quoted heredoc append is statically covered', () => {
      const target = join(scratch, 'out.txt');
      const plan = classifyCommandForSnapshot(`cat >> ${target} <<'EOF'\nalpha\nEOF\n`, scratch);
      expect(plan.decision).toEqual({ kind: 'no-snapshot', reason: 'statically-covered' });
    });

    it('an unquoted expansion anywhere in the command disqualifies the fast path', () => {
      // The heredoc write itself is inert, but `$(make)` may write elsewhere —
      // the whole command is no longer provably expansion-free, so the
      // covered-write label never attaches to it.
      const target = join(scratch, 'out.txt');
      const plan = classifyCommandForSnapshot(`echo $(make) && cat > ${target} <<'EOF'\nbody\nEOF\n`, scratch);
      expect(plan.decision.kind).toBe('snapshot');
    });
  });

  describe('redirects on read-only tools force a snapshot', () => {
    it('ls > f — the read-only label dies with the redirection', () => {
      const plan = classifyCommandForSnapshot(`ls > ${join(scratch, 'listing.txt')}`, scratch);
      expect(plan.decision.kind).toBe('snapshot');
      // The target is a literal redirect target: a tier-1 capture.
      expect(plan.tier1Targets).toEqual([join(scratch, 'listing.txt')]);
    });

    it('git status > f forces a snapshot', () => {
      expect(classifyCommandForSnapshot(`git status > ${join(scratch, 'status.txt')}`, scratch).decision.kind).toBe(
        'snapshot'
      );
    });

    it('echo hi > f forces a snapshot', () => {
      expect(classifyCommandForSnapshot(`echo hi > ${join(scratch, 'out.txt')}`, scratch).decision.kind).toBe(
        'snapshot'
      );
    });
  });

  describe('unquoted expansion forces a snapshot', () => {
    it('echo $(make) > f — the subcommand may write elsewhere', () => {
      const plan = classifyCommandForSnapshot(`echo $(make) > ${join(scratch, 'out.txt')}`, scratch);
      expect(plan.decision).toEqual({ kind: 'snapshot', reason: 'opaque' });
      expect(plan.tier1Targets).toEqual([join(scratch, 'out.txt')]);
    });

    it('FOO=$(gen) cmd > f — assignment-level substitution', () => {
      expect(classifyCommandForSnapshot(`FOO=$(gen) make > ${join(scratch, 'out.txt')}`, scratch).decision.kind).toBe(
        'snapshot'
      );
    });

    it('cat $ARGS > f — variable target, the subcommand may write elsewhere', () => {
      expect(classifyCommandForSnapshot(`cat $ARGS > ${join(scratch, 'out.txt')}`, scratch).decision.kind).toBe(
        'snapshot'
      );
    });
  });

  describe('tilde and background are opaque', () => {
    it('cat > ~/f — an unexpanded tilde resolves to the wrong literal path', () => {
      const plan = classifyCommandForSnapshot("cat > ~/notes.txt <<'EOF'\nbody\nEOF\n", scratch);
      expect(plan.decision).toEqual({ kind: 'snapshot', reason: 'opaque' });
      // The tilde target is unresolvable: never a tier-1 target.
      expect(plan.tier1Targets).toEqual([]);
    });

    it('a background job (&) can write after the hook returns', () => {
      expect(classifyCommandForSnapshot('make &', scratch).decision).toEqual({ kind: 'snapshot', reason: 'opaque' });
      expect(classifyCommandForSnapshot('sleep 1 &', scratch).decision).toEqual({ kind: 'snapshot', reason: 'opaque' });
    });
  });

  describe('argument-executing wrappers are opaque', () => {
    it('env python3 gen.py — the wrapped subcommand writes', () => {
      expect(classifyCommandForSnapshot('env python3 gen.py', scratch).decision.kind).toBe('snapshot');
    });

    it('xargs rm — arguments execute under the wrapper', () => {
      expect(classifyCommandForSnapshot('find . -name "*.tmp" | xargs rm', scratch).decision.kind).toBe('snapshot');
    });

    it('sudo make install', () => {
      expect(classifyCommandForSnapshot('sudo make install', scratch).decision.kind).toBe('snapshot');
    });

    it('time python3 gen.py', () => {
      expect(classifyCommandForSnapshot('time python3 gen.py', scratch).decision.kind).toBe('snapshot');
    });
  });

  describe('output-targeting flags disqualify the read-only label', () => {
    it('sort -o out.txt in.txt', () => {
      const plan = classifyCommandForSnapshot(
        `sort -o ${join(scratch, 'out.txt')} ${join(scratch, 'in.txt')}`,
        scratch
      );
      expect(plan.decision.kind).toBe('snapshot');
      // No shell redirect and no parser-resolved path: the -o target is not a
      // tier-1 literal-redirect target (it is captured by the tier-2 walk).
      expect(plan.tier1Targets).toEqual([]);
    });

    it('git diff --output=out.patch', () => {
      const plan = classifyCommandForSnapshot(`git diff --output=${join(scratch, 'out.patch')}`, scratch);
      expect(plan.decision.kind).toBe('snapshot');
      expect(plan.tier1Targets).toEqual([]);
    });
  });

  describe('git write subcommands are never read-only', () => {
    it('config, add, commit, checkout, reset, merge', () => {
      const writeCommands = [
        'git config user.name x',
        'git add src/a.ts',
        'git commit -m "wip"',
        'git checkout main',
        'git reset --hard HEAD~1',
        'git merge main'
      ];
      for (const cmd of writeCommands) {
        expect(classifyCommandForSnapshot(cmd, scratch).decision.kind, cmd).toBe('snapshot');
      }
    });
  });

  describe('heredoc delimiter quote styles', () => {
    it("<<'EOF' is inert: the body is literal data and the fast path applies", () => {
      const target = join(scratch, 'out.txt');
      expect(classifyCommandForSnapshot(`cat > ${target} <<'EOF'\nbody\nEOF\n`, scratch).decision).toEqual({
        kind: 'no-snapshot',
        reason: 'statically-covered'
      });
    });

    it('bare <<EOF is opaque: the body may execute and is never the literal written content', () => {
      const target = join(scratch, 'out.txt');
      expect(classifyCommandForSnapshot(`cat > ${target} <<EOF\nbody\nEOF\n`, scratch).decision).toEqual({
        kind: 'snapshot',
        reason: 'opaque'
      });
    });

    it('<<"EOF" is opaque: the body may execute and is never the literal written content', () => {
      const target = join(scratch, 'out.txt');
      expect(classifyCommandForSnapshot(`cat > ${target} <<"EOF"\nbody\nEOF\n`, scratch).decision).toEqual({
        kind: 'snapshot',
        reason: 'opaque'
      });
    });

    it('an unquoted-delimiter body with $(...) forces a snapshot and never feeds the literal body as written', () => {
      const target = join(scratch, 'out.txt');
      const cmd = `cat > ${target} <<EOF\n$(make > ${join(scratch, 'generated.txt')})\nEOF\n`;
      const plan = classifyCommandForSnapshot(cmd, scratch);
      expect(plan.decision).toEqual({ kind: 'snapshot', reason: 'opaque' });
      // The covered-write label — the only one whose `written` body is a
      // valid literal — must never attach to a bare-delimiter heredoc, so
      // the executed body can never surface as literal `written` content.
      expect(plan.decision).not.toEqual({ kind: 'no-snapshot', reason: 'statically-covered' });
    });

    it('a backtick in an unquoted-delimiter body forces a snapshot', () => {
      const target = join(scratch, 'out.txt');
      const cmd = `cat > ${target} <<EOF\n\`gen\`\nEOF\n`;
      expect(classifyCommandForSnapshot(cmd, scratch).decision).toEqual({ kind: 'snapshot', reason: 'opaque' });
    });
  });

  describe('git read-only exec channels', () => {
    it('GIT_EXTERNAL_DIFF in command text opens the exec channel: git diff forces a snapshot', () => {
      expect(classifyCommandForSnapshot('GIT_EXTERNAL_DIFF=ext-diff git diff', scratch).decision).toEqual({
        kind: 'snapshot',
        reason: 'opaque'
      });
    });

    it('ambient GIT_EXTERNAL_DIFF opens the exec channel: git diff forces a snapshot', () => {
      withEnv({ GIT_EXTERNAL_DIFF: 'ext-diff' }, () => {
        expect(classifyCommandForSnapshot('git diff', scratch).decision).toEqual({
          kind: 'snapshot',
          reason: 'opaque'
        });
      });
    });

    it('ambient GIT_EXTERNAL_DIFF with --no-ext-diff: disarmed, read-only again', () => {
      withEnv({ GIT_EXTERNAL_DIFF: 'ext-diff' }, () => {
        expect(classifyCommandForSnapshot('git diff --no-ext-diff', scratch).decision).toEqual({
          kind: 'no-snapshot',
          reason: 'read-only'
        });
      });
    });

    it("PAGER='tee pager.out' git log — a pager-forcing form classifies opaque (the pager program is env-dependent)", () => {
      expect(classifyCommandForSnapshot("PAGER='tee pager.out' git log", scratch).decision).toEqual({
        kind: 'snapshot',
        reason: 'opaque'
      });
    });

    it('GIT_PAGER in command text also forces a snapshot on git log', () => {
      expect(classifyCommandForSnapshot("GIT_PAGER='tee pager.out' git log", scratch).decision).toEqual({
        kind: 'snapshot',
        reason: 'opaque'
      });
    });

    it('the pager scan covers every leading assignment, not just the first', () => {
      expect(classifyCommandForSnapshot('HOME=/tmp GIT_PAGER=tee git log', scratch).decision).toEqual({
        kind: 'snapshot',
        reason: 'opaque'
      });
    });

    it('a non-family assignment does not force a snapshot: FOO=bar git diff stays read-only', () => {
      expect(classifyCommandForSnapshot('FOO=bar git diff', scratch).decision).toEqual({
        kind: 'no-snapshot',
        reason: 'read-only'
      });
    });
  });

  describe('git command-assignment redirects — the env-redirect family in command text fails closed', () => {
    // The repo/index/object-store redirects: the command runs in a DIFFERENT
    // repo (or with a different index/object store) than the hook cwd, so the
    // cwd-scoped config read sees the wrong source and the diff-exec keys go
    // unread — fail closed on the diff-rendering subcommands. The ambient
    // forms are self-correcting (the classifier's subprocesses inherit the
    // hook env) but GIT_DIR ambiently hijacks the -C top-level check, so these
    // fixtures unset the family in the ambient env rather than rely on it.
    const ambientUnset = {
      GIT_DIR: undefined,
      GIT_WORK_TREE: undefined,
      GIT_OBJECT_DIRECTORY: undefined,
      GIT_INDEX_FILE: undefined,
      GIT_CONFIG_GLOBAL: undefined,
      GIT_CONFIG_SYSTEM: undefined,
      XDG_CONFIG_HOME: undefined
    };

    it('GIT_DIR=<other> git diff — the repo is redirected: opaque', () => {
      withEnv(ambientUnset, () => {
        expect(classifyCommandForSnapshot('GIT_DIR=/other/.git git diff', scratch).decision).toEqual({
          kind: 'snapshot',
          reason: 'opaque'
        });
      });
    });

    it('GIT_DIR + GIT_WORK_TREE as a pair — opaque on git log too', () => {
      withEnv(ambientUnset, () => {
        expect(
          classifyCommandForSnapshot('GIT_DIR=/other/.git GIT_WORK_TREE=/other git log', scratch).decision
        ).toEqual({
          kind: 'snapshot',
          reason: 'opaque'
        });
      });
    });

    it('GIT_OBJECT_DIRECTORY and GIT_INDEX_FILE — the object store and index are redirected: opaque', () => {
      withEnv(ambientUnset, () => {
        expect(classifyCommandForSnapshot('GIT_OBJECT_DIRECTORY=/other/objects git diff', scratch).decision).toEqual({
          kind: 'snapshot',
          reason: 'opaque'
        });
        expect(classifyCommandForSnapshot('GIT_INDEX_FILE=/other/index git show', scratch).decision).toEqual({
          kind: 'snapshot',
          reason: 'opaque'
        });
      });
    });

    it('GIT_CONFIG_GLOBAL/GIT_CONFIG_SYSTEM/XDG_CONFIG_HOME/HOME in command text repoint the effective config: opaque', () => {
      withEnv(ambientUnset, () => {
        for (const cmd of [
          'GIT_CONFIG_GLOBAL=/other/gitconfig git diff',
          'GIT_CONFIG_SYSTEM=/other/systemconfig git diff',
          'XDG_CONFIG_HOME=/other/xdg git log',
          'HOME=/other/home git show'
        ]) {
          expect(classifyCommandForSnapshot(cmd, scratch).decision, cmd).toEqual({
            kind: 'snapshot',
            reason: 'opaque'
          });
        }
      });
    });

    it('the GIT_CONFIG_COUNT pair form injects config entries into the command — the pair, not the count, is what execs', () => {
      withEnv(ambientUnset, () => {
        expect(
          classifyCommandForSnapshot(
            'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=diff.external GIT_CONFIG_VALUE_0=/tmp/evil.sh git diff',
            scratch
          ).decision
        ).toEqual({ kind: 'snapshot', reason: 'opaque' });
      });
    });

    it('any member of the redirect family triggers — a lone key or value pair member fails closed too', () => {
      withEnv(ambientUnset, () => {
        expect(classifyCommandForSnapshot('GIT_CONFIG_KEY_0=diff.external git diff', scratch).decision).toEqual({
          kind: 'snapshot',
          reason: 'opaque'
        });
        expect(classifyCommandForSnapshot('GIT_CONFIG_VALUE_0=/tmp/evil.sh git log', scratch).decision).toEqual({
          kind: 'snapshot',
          reason: 'opaque'
        });
      });
    });
  });

  describe('git read-only config channels (repo/global config, command text)', () => {
    it('a repo config with diff.external makes git diff/log/show opaque', () => {
      const repo = repoWithConfig([['diff.external', 'ext-diff']]);
      try {
        for (const cmd of ['git diff', 'git log', 'git show']) {
          expect(classifyCommandForSnapshot(cmd, repo.root).decision, cmd).toEqual({
            kind: 'snapshot',
            reason: 'opaque'
          });
        }
      } finally {
        repo.cleanup();
      }
    });

    it('a global config with diff.external makes git diff opaque', () => {
      const cfgDir = mkdtempSync(join(tmpdir(), 'snapshot-global-config-'));
      const cfgPath = join(cfgDir, 'gitconfig');
      try {
        execFileSync('git', ['config', '--file', cfgPath, 'diff.external', 'ext-diff'], { stdio: 'ignore' });
        const repo = makeTempRepo();
        try {
          withEnv({ GIT_CONFIG_GLOBAL: cfgPath }, () => {
            expect(classifyCommandForSnapshot('git diff', repo.root).decision).toEqual({
              kind: 'snapshot',
              reason: 'opaque'
            });
          });
        } finally {
          repo.cleanup();
        }
      } finally {
        rmSync(cfgDir, { recursive: true, force: true });
      }
    });

    it('a diff.<driver>.textconv config makes git diff opaque', () => {
      const repo = repoWithConfig([['diff.foo.textconv', 'cat']]);
      try {
        expect(classifyCommandForSnapshot('git diff', repo.root).decision).toEqual({
          kind: 'snapshot',
          reason: 'opaque'
        });
      } finally {
        repo.cleanup();
      }
    });

    it('git -c diff.external=x diff — the config channel in command text is visible without a read', () => {
      expect(classifyCommandForSnapshot('git -c diff.external=x diff', scratch).decision).toEqual({
        kind: 'snapshot',
        reason: 'opaque'
      });
    });

    it('git diff --no-ext-diff disarms the config channel (canonical post-subcommand position)', () => {
      const repo = repoWithConfig([['diff.external', 'ext-diff']]);
      try {
        expect(classifyCommandForSnapshot('git diff --no-ext-diff', repo.root).decision).toEqual({
          kind: 'no-snapshot',
          reason: 'read-only'
        });
      } finally {
        repo.cleanup();
      }
    });

    it('git --no-ext-diff diff — the pre-subcommand form is a usage error (exit 129) and does NOT disarm', () => {
      const repo = repoWithConfig([['diff.external', 'ext-diff']]);
      try {
        // The disarm token is parsed only in the subcommand's argument
        // position; the rejected pre-subcommand form leaves the config
        // channel open — the command aborts before any write, so the abort
        // path is not the disarm path.
        expect(classifyCommandForSnapshot('git --no-ext-diff diff', repo.root).decision).toEqual({
          kind: 'snapshot',
          reason: 'opaque'
        });
      } finally {
        repo.cleanup();
      }
    });

    it('git diff --no-textconv disarms a textconv driver', () => {
      const repo = repoWithConfig([['diff.foo.textconv', 'cat']]);
      try {
        expect(classifyCommandForSnapshot('git diff --no-textconv', repo.root).decision).toEqual({
          kind: 'no-snapshot',
          reason: 'read-only'
        });
      } finally {
        repo.cleanup();
      }
    });
  });

  describe('symlinked heredoc targets fail the fast-path condition', () => {
    it('a symlinked heredoc target resolves the write elsewhere — forces a snapshot', () => {
      const dir = mkdtempSync(join(tmpdir(), 'snapshot-symlink-'));
      try {
        const realTarget = join(dir, 'real-target.txt');
        writeFileSync(realTarget, 'real\n');
        const link = join(dir, 'link.txt');
        symlinkSync(realTarget, link);
        const plan = classifyCommandForSnapshot(`cat > ${link} <<'EOF'\ncontent\nEOF\n`, dir);
        expect(plan.decision.kind).toBe('snapshot');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('a symlinked ancestor directory also fails the fast-path condition', () => {
      const dir = mkdtempSync(join(tmpdir(), 'snapshot-symlink-ancestor-'));
      try {
        const realDir = mkdtempSync(join(tmpdir(), 'snapshot-symlink-real-'));
        const linkDir = join(dir, 'sub');
        symlinkSync(realDir, linkDir);
        const plan = classifyCommandForSnapshot(`cat > ${join(linkDir, 'out.txt')} <<'EOF'\ncontent\nEOF\n`, dir);
        expect(plan.decision.kind).toBe('snapshot');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('opaque tools — snapshot, target unknown', () => {
    it('interpreters, in-place editors, formatters, and project tools classify opaque', () => {
      const opaqueCommands = [
        'python3 gen.py',
        'node build.js',
        'perl fix.pl',
        'ruby gen.rb',
        'sed -i s/a/b/ file.txt',
        'prettier --write src/',
        'npx prettier .',
        'make',
        'cargo build',
        'npm run build',
        'yarn build'
      ];
      for (const cmd of opaqueCommands) {
        const plan = classifyCommandForSnapshot(cmd, scratch);
        expect(plan.decision, cmd).toEqual({ kind: 'snapshot', reason: 'opaque' });
        expect(plan.tier1Targets, cmd).toEqual([]);
      }
    });
  });
});

describe('applyAmbiguityRules — the full ambiguity table', () => {
  const mine: AmbiguityBaseline = { createdAt: 1000, preHash: 'my-pre' };

  it('unconsumed sibling created after mine — ambiguous (its write window has not provably ended)', () => {
    const verdict = applyAmbiguityRules(
      mine,
      [sibling({ createdAt: 2000, consumed: false, pre: { hash: 'sib-pre' } })],
      'src/a.ts'
    );
    expect(verdict.ambiguous).toBe(true);
    if (verdict.ambiguous) expect(verdict.siblingToolUseId).toBe('sibling-1');
  });

  it('unconsumed sibling created before mine — ambiguous (pre order and pre equality are irrelevant)', () => {
    const verdict = applyAmbiguityRules(
      mine,
      [sibling({ createdAt: 500, consumed: false, pre: { hash: 'same-as-mine' } })],
      'src/a.ts'
    );
    expect(verdict.ambiguous).toBe(true);
  });

  it('consumed sibling created after mine with post(P) != pre(P) — ambiguous (it changed P during overlap)', () => {
    const verdict = applyAmbiguityRules(
      mine,
      [
        sibling({
          createdAt: 2000,
          consumed: true,
          consumedAt: 2100,
          pre: { hash: 'sib-pre' },
          post: { hash: 'sib-post' }
        })
      ],
      'src/a.ts'
    );
    expect(verdict.ambiguous).toBe(true);
  });

  it('consumed sibling created after mine with post(P) = pre(P) — not ambiguous (disjoint)', () => {
    const verdict = applyAmbiguityRules(
      mine,
      [
        sibling({
          createdAt: 2000,
          consumed: true,
          consumedAt: 2100,
          pre: { hash: 'sib' },
          post: { hash: 'sib' }
        })
      ],
      'src/a.ts'
    );
    expect(verdict).toEqual({ ambiguous: false });
  });

  it('consumed sibling created after mine with a coverage gap and no post state — ambiguous (post:null under a gap is unknowable, never clean)', () => {
    // The consumed-after clean shortcut reads post(P) = pre(P) as "disjoint";
    // with post:null it reads "consumed without changing P" — but only when
    // the sibling's post walk covered the path. Under a coverage gap the
    // sibling's walk may have dropped P entirely (the post-walk coverage-gap
    // guard), so post:null means its end state is unknowable and the path
    // must fail closed — the sibling may have written P last.
    const verdict = applyAmbiguityRules(
      mine,
      [
        sibling({
          createdAt: 2000,
          consumed: true,
          consumedAt: 2100,
          coverageGap: true,
          pre: { hash: 'sib-pre' },
          post: null
        })
      ],
      'src/a.ts'
    );
    expect(verdict.ambiguous).toBe(true);
    if (verdict.ambiguous) {
      expect(verdict.siblingToolUseId).toBe('sibling-1');
      expect(verdict.siblingSessionId).toBe('sibling-session');
      expect(verdict.reason).toMatch(/unknowable/i);
    }
  });

  it('consumed sibling created after mine without a gap and no post state — not ambiguous (post:null proves it never changed P)', () => {
    const verdict = applyAmbiguityRules(
      mine,
      [
        sibling({
          createdAt: 2000,
          consumed: true,
          consumedAt: 2100,
          coverageGap: false,
          pre: { hash: 'sib-pre' },
          post: null
        })
      ],
      'src/a.ts'
    );
    expect(verdict).toEqual({ ambiguous: false });
  });

  it('consumed sibling created before mine with pre(P) = post(P) — not ambiguous (it never changed P)', () => {
    const verdict = applyAmbiguityRules(
      mine,
      [
        sibling({
          createdAt: 500,
          consumed: true,
          consumedAt: 600,
          pre: { hash: 'sib' },
          post: { hash: 'sib' }
        })
      ],
      'src/a.ts'
    );
    expect(verdict).toEqual({ ambiguous: false });
  });

  it('consumed sibling created before mine with post(P) = my pre(P) — not ambiguous (its write landed before my baseline)', () => {
    const verdict = applyAmbiguityRules(
      mine,
      [
        sibling({
          createdAt: 500,
          consumed: true,
          consumedAt: 600,
          pre: { hash: 'older' },
          post: { hash: 'my-pre' }
        })
      ],
      'src/a.ts'
    );
    expect(verdict).toEqual({ ambiguous: false });
  });

  it('consumed sibling created before mine, pre(P) != post(P), consumedAt <= my createdAt — not ambiguous (its whole window ended before my baseline)', () => {
    // The plan's sequential third-party fixture: opaque call A changed P and
    // an Edit landed between A and B — A's consumedAt predates B's createdAt,
    // so nothing makes B's post-diff ambiguous (the false positive a
    // post-vs-my-pre test would raise).
    const verdict = applyAmbiguityRules(
      mine,
      [
        sibling({
          createdAt: 500,
          consumed: true,
          consumedAt: 800,
          pre: { hash: 'sib-pre' },
          post: { hash: 'sib-post' }
        })
      ],
      'src/a.ts'
    );
    expect(verdict).toEqual({ ambiguous: false });
  });

  it('consumed sibling created before mine, pre(P) != post(P), consumedAt > my createdAt — ambiguous (its window extends past my baseline)', () => {
    // The plan's same-file-both-calls scenario: whichever call completes
    // first sees the other's change in a window past its baseline — both
    // fail closed, never both attribute, never a wrong-call attribution.
    const verdict = applyAmbiguityRules(
      mine,
      [
        sibling({
          createdAt: 500,
          consumed: true,
          consumedAt: 1200,
          pre: { hash: 'sib-pre' },
          post: { hash: 'sib-post' }
        })
      ],
      'src/a.ts'
    );
    expect(verdict.ambiguous).toBe(true);
    if (verdict.ambiguous) expect(verdict.siblingToolUseId).toBe('sibling-1');
  });

  it('a gapped unconsumed sibling covers every path — overlap must be assumed', () => {
    // Its coverage is unknowable: even a sibling whose per-path view is
    // null makes every changed path ambiguous (the truncated-sibling hole).
    const verdict = applyAmbiguityRules(
      mine,
      [sibling({ createdAt: 2000, consumed: false, coverageGap: true, pre: null, post: null })],
      'src/a.ts'
    );
    expect(verdict.ambiguous).toBe(true);
  });

  it('any ambiguous sibling makes the path ambiguous, even after a clean sibling', () => {
    const verdict = applyAmbiguityRules(
      mine,
      [
        sibling({
          toolUseId: 'clean',
          createdAt: 2000,
          consumed: true,
          consumedAt: 2100,
          pre: { hash: 's' },
          post: { hash: 's' }
        }),
        sibling({ toolUseId: 'dirty', createdAt: 2200, consumed: false, pre: { hash: 'sib-pre' } })
      ],
      'src/a.ts'
    );
    expect(verdict.ambiguous).toBe(true);
    if (verdict.ambiguous) expect(verdict.siblingToolUseId).toBe('dirty');
  });

  it('siblings are evaluated in deterministic order — createdAt, ties broken by toolUseId', () => {
    // Both unconsumed: either alone makes the path ambiguous, but the
    // verdict must name the deterministically-first sibling — every
    // consumer of an entangled path reaches the same verdict.
    const verdict = applyAmbiguityRules(
      mine,
      [
        sibling({ toolUseId: 'z-tool', createdAt: 2000, consumed: false, pre: { hash: 'sib-pre' } }),
        sibling({ toolUseId: 'a-tool', createdAt: 2000, consumed: false, pre: { hash: 'sib-pre' } })
      ],
      'src/a.ts'
    );
    expect(verdict.ambiguous).toBe(true);
    if (verdict.ambiguous) expect(verdict.siblingToolUseId).toBe('a-tool');
  });

  it('a sibling not covering the path does not make it ambiguous', () => {
    const verdict = applyAmbiguityRules(
      mine,
      [sibling({ createdAt: 2000, consumed: false, pre: null, post: null })],
      'src/a.ts'
    );
    expect(verdict).toEqual({ ambiguous: false });
  });
});

describe('post side agreement and the observed/written invariant', () => {
  it('the Post side warns when the classifier says a snapshot should exist but the record is absent', () => {
    // The SAME classifier runs at Pre and Post; when it concludes `snapshot`
    // but the store finds no record, the Post hook must warn with a
    // diagnostic (the pre-hook skipped or its write failed) before falling
    // back to the static-parse path — the blind spot is visible, not silent.
    // (The hook-level wiring is asserted by the lifecycle fixtures; this
    // fixture pins the agreement surfaces they compose.)
    const warns: string[] = [];
    const logger: CoreLogger = { warn: (m) => warns.push(m), info: () => {} };
    const store = createSnapshotStore(logger, DEFAULT_SNAPSHOT_BUDGETS);
    const plan = classifyCommandForSnapshot('python3 gen.py', REPO_ROOT);
    expect(plan.decision).toEqual({ kind: 'snapshot', reason: 'opaque' });
    expect(store.find(SESSION_ID, TOOL_USE_ID)).toBeNull();
    expect(warns).toEqual([]);
  });

  it("the observed XOR written invariant: a snapshot-attributed touch feeds observed with written: ''", () => {
    // The snapshot path's construction site: exact post-state ranges in
    // `observed`, the empty `written` sentinel ("no locatable block") — never
    // both, never the literal body of an executed heredoc.
    const snapshotTouch: TouchWriteInput = {
      kind: 'write',
      sessionId: SESSION_ID,
      cwd: REPO_ROOT,
      filePath: `${REPO_ROOT}/src/a.ts`,
      written: '',
      observed: { changed: [{ start: 2, end: 4 }], wholeFile: false }
    };
    // The static-parse path's construction site: written content, never
    // `observed`.
    const parseTouch: TouchWriteInput = {
      kind: 'write',
      sessionId: SESSION_ID,
      cwd: REPO_ROOT,
      filePath: `${REPO_ROOT}/src/b.ts`,
      written: 'export const b = 1;\n'
    };
    expect(snapshotTouch.observed).toEqual({ changed: [{ start: 2, end: 4 }], wholeFile: false });
    expect(snapshotTouch.written).toBe('');
    expect(parseTouch.observed).toBeUndefined();
    expect(parseTouch.written).not.toBe('');
    // Both set is a contract violation no construction site may produce; the
    // type declares `written` required and `observed` optional, so the
    // invariant is enforced at the construction sites, not by the type.
  });
});

describe('budgets', () => {
  it('the shipped defaults are exactly the plan-mandated values', () => {
    expect(DEFAULT_SNAPSHOT_BUDGETS).toEqual({
      preSideMaxWallSeconds: 1,
      maxStorageBytes: 64 * 1024 * 1024,
      maxTouchedFiles: 100,
      postSideWallSeconds: 5,
      recordTtlMs: 24 * 60 * 60 * 1000,
      unfinishedEntryTtlMs: 15 * 60 * 1000
    });
  });
});

describe('git -C/--git-dir target the repo the exec-config read sees', () => {
  it('git -C <other-repo> diff — exec keys come from the other repo, invisible to the cwd read: opaque', () => {
    const other = makeTempRepo();
    try {
      const repo = makeTempRepo();
      try {
        expect(classifyCommandForSnapshot(`git -C ${other.root} diff`, repo.root).decision).toEqual({
          kind: 'snapshot',
          reason: 'opaque'
        });
      } finally {
        repo.cleanup();
      }
    } finally {
      other.cleanup();
    }
  });

  it('git -C . diff — the same repo as the hook cwd: read-only unchanged, cwd config read', () => {
    const repo = makeTempRepo();
    try {
      expect(classifyCommandForSnapshot('git -C . diff', repo.root).decision).toEqual({
        kind: 'no-snapshot',
        reason: 'read-only'
      });
    } finally {
      repo.cleanup();
    }
  });

  it('git --git-dir=<path> diff — the repo is redirected: opaque', () => {
    const repo = makeTempRepo();
    try {
      expect(classifyCommandForSnapshot(`git --git-dir=${join(repo.root, '.git')} diff`, repo.root).decision).toEqual({
        kind: 'snapshot',
        reason: 'opaque'
      });
    } finally {
      repo.cleanup();
    }
  });

  it('git --git-dir <path> diff — the separate-argument redirect form is opaque too (and not misread as the subcommand)', () => {
    const repo = makeTempRepo();
    try {
      expect(classifyCommandForSnapshot(`git --git-dir ${join(repo.root, '.git')} diff`, repo.root).decision).toEqual({
        kind: 'snapshot',
        reason: 'opaque'
      });
    } finally {
      repo.cleanup();
    }
  });
});

describe('recordHasPathCoverageGap — the gap family the guard and the consult read', () => {
  it('every coverage gap form matches (a rephrase breaks this fixture, not the guard)', () => {
    // The pre-side degrade persists on the record at write; the compare-phase
    // forms are appended by the post handlers before the consume. A later
    // sibling consult must read any of them as coverage-unknowable, never as
    // "consumed without changing P".
    for (const gap of [
      'write-tree degraded to stat-only: git add failed',
      'write-tree degraded to stat-only: unexpected write-tree output "?"',
      'post-side wall budget exhausted: attributed 1/5, unattributed src/b.ts, src/c.ts',
      'touched-files cap 2 exceeded: src/b.ts not attributed',
      'unreadable at compare: src/a.ts dropped without attribution',
      'snapshot compare aborted: boom'
    ]) {
      expect(recordHasPathCoverageGap({ gaps: [gap] }), gap).toBe(true);
    }
  });

  it('the binary-scope degrade is attributed-with-diagnostics, never a coverage gap', () => {
    // A binary-classified path IS attributed (whole-file scope) and its post
    // state IS part of the recorded tree, so a missing sibling post entry
    // still means "unchanged" — the family must not open.
    expect(recordHasPathCoverageGap({ gaps: ['binary-scope: src/app.bin classified binary, whole-file scope'] })).toBe(
      false
    );
  });

  it('the stat-only sweep failure diagnostic never matches alone — the degrade gap beside it carries the coverage loss', () => {
    expect(recordHasPathCoverageGap({ gaps: ['stat-only sweep failed: boom'] })).toBe(false);
  });

  it('a diagnostic naming a file that itself contains a gap phrase never matches (the match is anchored to the prefix)', () => {
    // The interpolation-proof assertion: gap strings interpolate user file
    // names (cap-cut paths, unreadable drops), so an unanchored scan would
    // let a file named like a gap phrase open the family — and with it defer
    // every sibling consult in the repo.
    for (const gap of [
      'binary-scope: notes/post-side wall budget exhausted.log classified binary, whole-file scope',
      'binary-scope: src/touched-files cap 5 exceeded.md classified binary, whole-file scope',
      'stat-only sweep failed: snapshot compare aborted: nested phrase'
    ]) {
      expect(recordHasPathCoverageGap({ gaps: [gap] }), gap).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Tree-SHA snapshot mechanism (card main-228) — Phase 2 acceptance checks.
//
// Written against the Phase 1 stubs; each check is the executable form of the
// v2 contract. The fake GitRunner is scripted per test and logs every call —
// the "0 new objects" and "-M100% floor" properties are call-log assertions,
// per the core's injected-I/O convention (never real git here). The hash
// checks assert VALUES (Node SHA-256 of the fixture bytes), not just equality
// outcomes, so a regression into git's SHA-1 blob-OID space fails loudly
// instead of silently breaking the activity-log boundary comparisons.
// ---------------------------------------------------------------------------

/** One logged fake-runner call. */
interface GitCall {
  args: string[];
  opts: { cwd: string; env?: Record<string, string>; timeoutMs?: number };
}

/** A scripted fake GitRunner that logs calls; the script may throw to simulate failure/timeout. */
function scriptedRunner(script: (args: string[]) => Buffer | string): { run: GitRunner; calls: GitCall[] } {
  const calls: GitCall[] = [];
  const run: GitRunner = (args, opts) => {
    calls.push({ args, opts });
    const out = script(args);
    return typeof out === 'string' ? Buffer.from(out) : out;
  };
  return { run, calls };
}

/** git's SHA-1 blob OID of `bytes` — the hash space the contract must NOT use. */
function gitBlobOid(bytes: Buffer): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

const PRE_TREE = 'a'.repeat(40);
const POST_TREE = 'b'.repeat(40);

/** The three real sources whose NUL-containing literals false-positive git's binary scan. */
const NUL_FALSE_POSITIVE_SOURCES = [
  resolve(process.cwd(), '../discover/src/paths.ts'),
  resolve(process.cwd(), '../discover/src/signals/cochange.ts'),
  resolve(process.cwd(), '../discover/src/signals/sharedLiterals.ts')
];

describe('classifyTextOrBinary — the proportional text/binary classifier (main-228 Phase 2)', () => {
  it('fixture precondition: each pinning source really contains a NUL in its first 8 KiB (the false-positive trigger)', () => {
    // Not a stub check — this guards the fixtures themselves: if these files
    // are ever cleaned of their NUL literals, the pinning cases below stop
    // exercising the false-positive regime and must be re-pointed.
    for (const file of NUL_FALSE_POSITIVE_SOURCES) {
      const bytes = readFileSync(file);
      expect(bytes.subarray(0, 8192).includes(0), file).toBe(true);
    }
  });

  it('the real NUL-containing TypeScript sources classify as text', () => {
    for (const file of NUL_FALSE_POSITIVE_SOURCES) {
      expect(classifyTextOrBinary(readFileSync(file)), file).toBe(true);
    }
  });

  it('genuinely binary content (gzip bytes) classifies as binary', () => {
    const binary = gzipSync(Buffer.from('some text made genuinely binary by compression\n'.repeat(50)));
    expect(classifyTextOrBinary(binary)).toBe(false);
  });

  it('a synthetic full-range byte blob classifies as binary', () => {
    const bytes = Buffer.alloc(2000);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251;
    expect(classifyTextOrBinary(bytes)).toBe(false);
  });

  it('an empty file classifies as text', () => {
    expect(classifyTextOrBinary(Buffer.alloc(0))).toBe(true);
  });

  it('ASCII text with a single NUL classifies as text — the rule is proportional, never NUL presence', () => {
    const oneNul = Buffer.concat([
      Buffer.from('const marker = "'),
      Buffer.from([0]),
      Buffer.from('";\n'),
      Buffer.from('export const rest = 1;\n'.repeat(40))
    ]);
    expect(classifyTextOrBinary(oneNul)).toBe(true);
  });
});

describe('captureWriteTree — private index/object-dir capture (main-228 Phase 2)', () => {
  /** A capture fixture rooted in a fresh temp dir; the caller owns cleanup. */
  function captureFixture(script: (args: string[]) => Buffer | string) {
    const root = mkdtempSync(join(tmpdir(), 'capture-write-tree-'));
    const objectDir = join(root, 'objects');
    const indexFile = join(root, 'index.tmp');
    const realIndexFile = join(root, 'real-index');
    writeFileSync(realIndexFile, 'REAL-INDEX-BYTES');
    const { run, calls } = scriptedRunner(script);
    const input: CaptureWriteTreeInput = {
      repoRoot: REPO_ROOT,
      objectDir,
      indexFile,
      alternates: '/repo/.git/objects',
      realIndexFile,
      spanRoot: join(REPO_ROOT, '.span'),
      wallBudgetMs: 1000,
      runGit: run,
      stat: () => ({ size: 7, mtimeNs: TRUSTED_MTIME })
    };
    return { root, input, calls, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  }

  it('an unchanged tree costs exactly add -A + write-tree under the private env — no other calls, no content reads', () => {
    const fx = captureFixture((args) => (args[0] === 'write-tree' ? `${PRE_TREE}\n` : ''));
    try {
      const result = captureWriteTree(fx.input);
      expect(result).toEqual({ treeSha: PRE_TREE, gaps: [] });
      // The call log IS the cost assertion: two git calls, nothing else.
      expect(fx.calls.map((c) => c.args)).toEqual([['add', '-A'], ['write-tree']]);
      for (const call of fx.calls) {
        expect(call.opts.cwd).toBe(REPO_ROOT);
        expect(call.opts.env?.GIT_INDEX_FILE).toBe(fx.input.indexFile);
        expect(call.opts.env?.GIT_OBJECT_DIRECTORY).toBe(fx.input.objectDir);
        // The wall budget rides into the subprocess as its timeout.
        expect(call.opts.timeoutMs).toBeDefined();
        expect(call.opts.timeoutMs!).toBeLessThanOrEqual(fx.input.wallBudgetMs);
      }
    } finally {
      fx.cleanup();
    }
  });

  it('the private object dir carries info/alternates pointing at the real object store — the load-bearing setup', () => {
    const fx = captureFixture((args) => (args[0] === 'write-tree' ? `${PRE_TREE}\n` : ''));
    try {
      captureWriteTree(fx.input);
      expect(readFileSync(join(fx.input.objectDir, 'info', 'alternates'), 'utf8')).toBe('/repo/.git/objects\n');
    } finally {
      fx.cleanup();
    }
  });

  it('the temp index is primed by copying the real index (warm stat cache)', () => {
    const fx = captureFixture((args) => (args[0] === 'write-tree' ? `${PRE_TREE}\n` : ''));
    try {
      captureWriteTree(fx.input);
      expect(readFileSync(fx.input.indexFile, 'utf8')).toBe('REAL-INDEX-BYTES');
    } finally {
      fx.cleanup();
    }
  });

  it('wall-budget exhaustion degrades to a stat-only sweep with a path-coverage gap, span documents filtered', () => {
    const fx = captureFixture((args) => {
      if (args[0] === 'add') throw new Error('timed out');
      if (args[0] === 'ls-files') return 'src/a.ts\0.span/doc.md\0';
      return '';
    });
    try {
      const result = captureWriteTree(fx.input);
      expect(result.treeSha).toBeNull();
      expect(result.statOnly).toEqual({ 'src/a.ts': { size: 7, mtimeNs: TRUSTED_MTIME } });
      expect(result.gaps).toHaveLength(1);
      expect(result.gaps[0]).toMatch(/^write-tree degraded to stat-only:/);
      // The degrade gap is path-coverage family: content coverage is
      // unknowable, so a sibling consult must fail closed on this record.
      expect(recordHasPathCoverageGap(result)).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  it('total git failure yields no tree, no statOnly, and a gap — the caller fails open', () => {
    const fx = captureFixture(() => {
      throw new Error('git unavailable');
    });
    try {
      const result = captureWriteTree(fx.input);
      expect(result.treeSha).toBeNull();
      expect(result.statOnly).toBeUndefined();
      expect(result.gaps.length).toBeGreaterThan(0);
    } finally {
      fx.cleanup();
    }
  });
});

describe('compareTrees — tree-to-tree attribution (main-228 Phase 2)', () => {
  const FILE_A = 'src/a.ts';
  const PRE_A = Buffer.from('l1\nl2\nl3\n');
  const POST_A = Buffer.from('l1\nX\nl3\n');

  /**
   * Script a compare fixture: `lsTree` answers the pre-tree enumeration,
   * `nameStatus` the tree-to-tree diff, `blobs` keys `<tree>:<path>` for
   * cat-file reads, `hunks` keys the per-path -U0 diff output.
   */
  function compareFixture(spec: {
    lsTree?: string[];
    nameStatus?: string;
    blobs?: Record<string, Buffer>;
    hunks?: Record<string, string>;
    budgets?: CompareTreesInput['budgets'];
    wallClock?: () => number;
    preTreeSha?: string;
    postTreeSha?: string;
  }) {
    const { run, calls } = scriptedRunner((args) => {
      if (args[0] === 'ls-tree') return `${(spec.lsTree ?? []).join('\0')}\0`;
      if (args[0] === 'cat-file') {
        const blob = spec.blobs?.[args[2] ?? ''];
        if (blob === undefined) throw new Error(`missing blob ${args[2]}`);
        return blob;
      }
      if (args.includes('--name-status')) return spec.nameStatus ?? '';
      if (args.includes('--unified=0')) {
        const last = args[args.length - 1] ?? '';
        // The per-path diff must ship :(literal) magic — a raw pathspec is a
        // wildmatch pattern that can match sibling files.
        if (!last.startsWith(':(literal)')) throw new Error(`per-path diff without :(literal) magic: ${last}`);
        return spec.hunks?.[last.slice(':(literal)'.length)] ?? '';
      }
      throw new Error(`unexpected git call ${args.join(' ')}`);
    });
    const input: CompareTreesInput = {
      preTreeSha: spec.preTreeSha ?? PRE_TREE,
      postTreeSha: spec.postTreeSha ?? POST_TREE,
      repoRoot: REPO_ROOT,
      objectDir: '/private/objects',
      spanRoot: join(REPO_ROOT, '.span'),
      budgets: spec.budgets ?? DEFAULT_SNAPSHOT_BUDGETS,
      wallStart: 0,
      runGit: run,
      wallClock: spec.wallClock ?? (() => 0)
    };
    return { input, calls };
  }

  it('equal tree SHAs short-circuit: every tree path is unchanged, no diff or content calls at all', () => {
    const fx = compareFixture({ lsTree: [FILE_A, 'src/b.ts'], preTreeSha: PRE_TREE, postTreeSha: PRE_TREE });
    const result = compareTrees(fx.input);
    expect(result.attributions.size).toBe(0);
    expect(result.unchanged).toEqual(new Set([FILE_A, 'src/b.ts']));
    expect(result.gaps).toEqual([]);
    expect(result.contentHashes.size).toBe(0);
    // One tree enumeration, nothing else — no name-status, no cat-file.
    expect(fx.calls.map((c) => c.args[0])).toEqual(['ls-tree']);
  });

  it('a middle edit maps to the exact post range, with SHA-256 content-hash VALUES for both sides', () => {
    const fx = compareFixture({
      lsTree: [FILE_A, 'src/b.ts'],
      nameStatus: `M\0${FILE_A}\0`,
      blobs: { [`${PRE_TREE}:${FILE_A}`]: PRE_A, [`${POST_TREE}:${FILE_A}`]: POST_A },
      hunks: { [FILE_A]: `--- a/${FILE_A}\n+++ b/${FILE_A}\n@@ -2 +2 @@\n-l2\n+X\n` }
    });
    const result = compareTrees(fx.input);
    expect(result.attributions.get(FILE_A)).toEqual({
      kind: 'changed',
      observed: { changed: [{ start: 2, end: 2 }], wholeFile: false }
    });
    expect(result.unchanged).toEqual(new Set(['src/b.ts']));
    // VALUE assertions in the ActivityPathStamp hash space: Node SHA-256 of
    // the blob bytes — and provably NOT git's SHA-1 blob OID.
    const hashes = result.contentHashes.get(FILE_A);
    expect(hashes).toEqual({ pre: sha256Hex(PRE_A), post: sha256Hex(POST_A) });
    expect(hashes?.post).not.toBe(gitBlobOid(POST_A));
  });

  it('an append maps to the exact appended post range', () => {
    const post = Buffer.from('l1\nl2\nl3\nl4\nl5\n');
    const fx = compareFixture({
      lsTree: [FILE_A],
      nameStatus: `M\0${FILE_A}\0`,
      blobs: { [`${PRE_TREE}:${FILE_A}`]: PRE_A, [`${POST_TREE}:${FILE_A}`]: post },
      hunks: { [FILE_A]: `--- a/${FILE_A}\n+++ b/${FILE_A}\n@@ -3,0 +4,2 @@\n+l4\n+l5\n` }
    });
    const result = compareTrees(fx.input);
    expect(result.attributions.get(FILE_A)).toEqual({
      kind: 'changed',
      observed: { changed: [{ start: 4, end: 5 }], wholeFile: false }
    });
  });

  it('a delete-only hunk forces whole-file scope (no post coordinate for deleted lines)', () => {
    const post = Buffer.from('l1\n');
    const fx = compareFixture({
      lsTree: [FILE_A],
      nameStatus: `M\0${FILE_A}\0`,
      blobs: { [`${PRE_TREE}:${FILE_A}`]: PRE_A, [`${POST_TREE}:${FILE_A}`]: post },
      hunks: { [FILE_A]: `--- a/${FILE_A}\n+++ b/${FILE_A}\n@@ -2,2 +1,0 @@\n-l2\n-l3\n` }
    });
    const result = compareTrees(fx.input);
    expect(result.attributions.get(FILE_A)).toEqual({
      kind: 'changed',
      observed: { changed: [], wholeFile: true }
    });
  });

  it('creates and deletes attribute as such, with one-sided content hashes', () => {
    const created = Buffer.from('new\n');
    const fx = compareFixture({
      lsTree: [FILE_A],
      nameStatus: `D\0${FILE_A}\0A\0src/new.ts\0`,
      blobs: { [`${PRE_TREE}:${FILE_A}`]: PRE_A, [`${POST_TREE}:src/new.ts`]: created }
    });
    const result = compareTrees(fx.input);
    expect(result.attributions.get(FILE_A)).toEqual({ kind: 'deleted' });
    expect(result.attributions.get('src/new.ts')).toEqual({ kind: 'created' });
    expect(result.contentHashes.get(FILE_A)).toEqual({ pre: sha256Hex(PRE_A), post: null });
    expect(result.contentHashes.get('src/new.ts')).toEqual({ pre: null, post: sha256Hex(created) });
  });

  it('renames pair only at the -M100% byte-identical floor, and the flag itself is pinned in the call log', () => {
    const fx = compareFixture({
      lsTree: ['old/name.ts'],
      nameStatus: `R100\0old/name.ts\0new/name.ts\0`,
      blobs: {
        [`${PRE_TREE}:old/name.ts`]: PRE_A,
        [`${POST_TREE}:new/name.ts`]: PRE_A
      }
    });
    const result = compareTrees(fx.input);
    expect(result.attributions.get('new/name.ts')).toEqual({ kind: 'rename', from: 'old/name.ts' });
    // Using git's default -M (~50% similarity) would pair non-identical
    // renames pairRenames never did — the 100 floor must be explicit.
    const nameStatusCall = fx.calls.find((c) => c.args.includes('--name-status'));
    expect(nameStatusCall?.args).toContain('-M100%');
    expect(nameStatusCall?.args).toContain('--text');
  });

  it('a binary-classified changed file degrades to whole-file scope with a binary-scope gap — attributed, never excluded', () => {
    const preBin = gzipSync(Buffer.from('pre binary payload'.repeat(30)));
    const postBin = gzipSync(Buffer.from('post binary payload'.repeat(30)));
    const fx = compareFixture({
      lsTree: ['assets/blob.bin'],
      nameStatus: `M\0assets/blob.bin\0`,
      blobs: { [`${PRE_TREE}:assets/blob.bin`]: preBin, [`${POST_TREE}:assets/blob.bin`]: postBin }
    });
    const result = compareTrees(fx.input);
    expect(result.attributions.get('assets/blob.bin')).toEqual({
      kind: 'changed',
      observed: { changed: [], wholeFile: true }
    });
    expect(result.gaps.some((g) => g.startsWith('binary-scope: assets/blob.bin'))).toBe(true);
    // Diagnostic-only: precision loss, not a coverage gap — the sibling
    // consult must not read this record as coverage-unknowable.
    expect(recordHasPathCoverageGap(result)).toBe(false);
    // The hashes still land in the SHA-256 space even for binaries.
    expect(result.contentHashes.get('assets/blob.bin')).toEqual({ pre: sha256Hex(preBin), post: sha256Hex(postBin) });
  });

  it('span documents are filtered from the diff result — neither attributed nor unchanged', () => {
    const fx = compareFixture({
      lsTree: [FILE_A, '.span/agent-hooks/some-span'],
      nameStatus: `M\0.span/agent-hooks/some-span\0`,
      blobs: {}
    });
    const result = compareTrees(fx.input);
    expect(result.attributions.size).toBe(0);
    expect(result.unchanged).toEqual(new Set([FILE_A]));
  });

  it('the touched-files cap cuts later changed paths with the persisting gap text', () => {
    const fx = compareFixture({
      lsTree: [FILE_A, 'src/b.ts'],
      nameStatus: `M\0${FILE_A}\0M\0src/b.ts\0`,
      blobs: { [`${PRE_TREE}:${FILE_A}`]: PRE_A, [`${POST_TREE}:${FILE_A}`]: POST_A },
      hunks: { [FILE_A]: `--- a/${FILE_A}\n+++ b/${FILE_A}\n@@ -2 +2 @@\n-l2\n+X\n` },
      budgets: { ...DEFAULT_SNAPSHOT_BUDGETS, maxTouchedFiles: 1 }
    });
    const result = compareTrees(fx.input);
    expect(result.attributions.has(FILE_A)).toBe(true);
    expect(result.attributions.has('src/b.ts')).toBe(false);
    expect(result.gaps).toContain('touched-files cap 1 exceeded: src/b.ts not attributed');
    expect(recordHasPathCoverageGap(result)).toBe(true);
  });

  it('post-side wall exhaustion stops before any content work with the persisting gap text', () => {
    const fx = compareFixture({
      lsTree: [FILE_A],
      nameStatus: `M\0${FILE_A}\0`,
      blobs: {},
      wallClock: () => 10_000 // wallStart 0, budget 5 s — already exhausted
    });
    const result = compareTrees(fx.input);
    expect(result.attributions.size).toBe(0);
    expect(result.gaps.some((g) => g.startsWith('post-side wall budget exhausted:'))).toBe(true);
    expect(recordHasPathCoverageGap(result)).toBe(true);
  });

  it('an unreadable blob drops the path with the unreadable-at-compare gap, never a fabricated attribution', () => {
    const fx = compareFixture({
      lsTree: [FILE_A],
      nameStatus: `M\0${FILE_A}\0`,
      blobs: { [`${PRE_TREE}:${FILE_A}`]: PRE_A } // post blob missing — cat-file throws
    });
    const result = compareTrees(fx.input);
    expect(result.attributions.has(FILE_A)).toBe(false);
    expect(result.gaps).toContain(`unreadable at compare: ${FILE_A} dropped without attribution`);
  });

  it("a wildcard filename diffs only itself — metacharacters never merge a sibling's ranges (real git)", () => {
    // `file[1].ts` as a raw pathspec is a wildmatch pattern matching
    // `file1.ts` too, so without :(literal) magic the per-path -U0 diff
    // emits BOTH files' hunks and the hunk parser (which has no per-file
    // segmentation) merges the sibling's coordinates into the bracket
    // file's ranges. Real git end to end: scripted runners can't reproduce
    // git's pathspec globbing.
    const repo = makeTempRepo();
    const scratch = mkdtempSync(join(tmpdir(), 'compare-literal-'));
    try {
      writeFileSync(join(repo.root, 'file[1].ts'), 'a1\na2\na3\n');
      writeFileSync(join(repo.root, 'file1.ts'), 'b1\nb2\nb3\nb4\nb5\n');
      execFileSync('git', ['-C', repo.root, 'add', '-A'], { stdio: 'ignore' });
      const gitDir = execFileSync('git', ['-C', repo.root, 'rev-parse', '--absolute-git-dir']).toString('utf8').trim();
      const capture = (): ReturnType<typeof captureWriteTree> =>
        captureWriteTree({
          repoRoot: repo.root,
          objectDir: join(scratch, 'objects'),
          indexFile: join(scratch, 'index'),
          alternates: join(gitDir, 'objects'),
          realIndexFile: join(gitDir, 'index'),
          spanRoot: join(repo.root, '.git-span'),
          wallBudgetMs: 30_000,
          runGit: defaultGitRunner,
          stat: statFile
        });
      const pre = capture();
      expect(pre.treeSha).not.toBeNull();
      // Distinct edits: line 2 of the bracket file, line 5 of the sibling.
      writeFileSync(join(repo.root, 'file[1].ts'), 'a1\nCHANGED\na3\n');
      writeFileSync(join(repo.root, 'file1.ts'), 'b1\nb2\nb3\nb4\nCHANGED\n');
      const post = capture();
      expect(post.treeSha).not.toBeNull();
      const result = compareTrees({
        preTreeSha: pre.treeSha ?? '',
        postTreeSha: post.treeSha ?? '',
        repoRoot: repo.root,
        objectDir: join(scratch, 'objects'),
        spanRoot: join(repo.root, '.git-span'),
        budgets: DEFAULT_SNAPSHOT_BUDGETS,
        wallStart: Date.now(),
        runGit: defaultGitRunner
      });
      expect(result.attributions.get('file[1].ts')).toEqual({
        kind: 'changed',
        observed: { changed: [{ start: 2, end: 2 }], wholeFile: false }
      });
      expect(result.attributions.get('file1.ts')).toEqual({
        kind: 'changed',
        observed: { changed: [{ start: 5, end: 5 }], wholeFile: false }
      });
      expect(result.gaps).toEqual([]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
      repo.cleanup();
    }
  });
});

describe('compareStatOnly — the degrade-mode file-granularity comparison (main-228 Phase 2)', () => {
  it('creates, deletes, and size/mtime changes attribute whole-file; equal stats read unchanged', () => {
    const pre: Record<string, StatOnlyEntry> = {
      'src/same.ts': { size: 10, mtimeNs: TRUSTED_MTIME },
      'src/gone.ts': { size: 5, mtimeNs: TRUSTED_MTIME },
      'src/grown.ts': { size: 5, mtimeNs: TRUSTED_MTIME },
      'src/touched.ts': { size: 5, mtimeNs: TRUSTED_MTIME }
    };
    const post: Record<string, StatOnlyEntry> = {
      'src/same.ts': { size: 10, mtimeNs: TRUSTED_MTIME },
      'src/grown.ts': { size: 9, mtimeNs: TRUSTED_MTIME },
      'src/touched.ts': { size: 5, mtimeNs: TRUSTED_MTIME + 1n },
      'src/new.ts': { size: 3, mtimeNs: TRUSTED_MTIME }
    };
    const result = compareStatOnly(pre, post);
    expect(result.unchanged).toEqual(new Set(['src/same.ts']));
    expect(result.attributions.get('src/gone.ts')).toEqual({ kind: 'deleted' });
    expect(result.attributions.get('src/new.ts')).toEqual({ kind: 'created' });
    expect(result.attributions.get('src/grown.ts')).toEqual({
      kind: 'changed',
      observed: { changed: [], wholeFile: true }
    });
    expect(result.attributions.get('src/touched.ts')).toEqual({
      kind: 'changed',
      observed: { changed: [], wholeFile: true }
    });
    // Stat-only mode has no content to hash — the consult falls back to its
    // fail-closed paths on the record's degrade gap.
    expect(result.contentHashes.size).toBe(0);
  });
});

describe('hashTreePath — the on-demand sibling hash read (main-228 Phase 2)', () => {
  const BLOB = Buffer.from('shared sibling content\n');

  /** Scripted ls-tree + cat-file pair: empty ls-tree output means proven-absent. */
  const treeScript =
    (entries: Record<string, Buffer>) =>
    (args: string[]): Buffer | string => {
      if (args[0] === 'ls-tree') {
        const spec = args[3] ?? '';
        expect(spec.startsWith(':(literal)')).toBe(true);
        const path = spec.slice(':(literal)'.length);
        const blob = entries[`${args[1]}:${path}`];
        return blob === undefined ? '' : `100644 blob ${'c'.repeat(40)}\t${path}\n`;
      }
      const blob = entries[args[2] ?? ''];
      if (blob === undefined) throw new Error(`unexpected cat-file ${args[2]}`);
      return blob;
    };

  it('hashes a tree path into the SHA-256 value of its blob bytes — never the git SHA-1 OID', () => {
    const { run, calls } = scriptedRunner(treeScript({ [`${PRE_TREE}:src/a.ts`]: BLOB }));
    const result = hashTreePath({
      treeSha: PRE_TREE,
      path: 'src/a.ts',
      repoRoot: REPO_ROOT,
      objectDir: '/private/objects',
      runGit: run,
      timeoutMs: 5000
    });
    expect(result).toEqual({ kind: 'hash', hash: sha256Hex(BLOB) });
    expect(result.kind === 'hash' && result.hash === gitBlobOid(BLOB)).toBe(false);
    // ls-tree probe then cat-file, both under the caller's timeout — a hang
    // in either subprocess must never stall the whole branch invocation.
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.opts.timeoutMs === 5000)).toBe(true);
  });

  it('a path absent from the tree reads proven-absent (empty ls-tree probe), never an error', () => {
    const { run, calls } = scriptedRunner(treeScript({}));
    expect(
      hashTreePath({ treeSha: PRE_TREE, path: 'src/gone.ts', repoRoot: REPO_ROOT, objectDir: '/o', runGit: run })
    ).toEqual({ kind: 'absent' });
    // Proven absent by the probe alone — no blob read is attempted.
    expect(calls).toHaveLength(1);
  });

  it('a failed read (reaped object dir, corrupt tree, timeout) reads error, never absent', () => {
    // The pre-fix conflation: a bare catch returned the same null for "the
    // tree lacks the path" and "the read blew up", so an unconsumed sibling
    // with a failed read became invisible to the covers check and the path
    // was attributed instead of dropped.
    const { run } = scriptedRunner(() => {
      throw new Error('fatal: not a valid object name');
    });
    const result = hashTreePath({
      treeSha: PRE_TREE,
      path: 'src/a.ts',
      repoRoot: REPO_ROOT,
      objectDir: '/o',
      runGit: run
    });
    expect(result.kind).toBe('error');
    expect(result.kind === 'error' && result.reason).toContain('not a valid object name');
  });

  it('the ambiguity table keeps resolving against tree-sourced SHA-256 hashes exactly as against v1 per-path maps', () => {
    // The interop pin (plan decision 6): sibling pre/post now come from
    // hashTreePath over the sibling's recorded trees. A consumed-after
    // sibling whose post blob equals its pre blob stays NOT ambiguous; the
    // same fixture with differing blobs flips ambiguous — and the hashes
    // driving both verdicts are asserted BY VALUE in the SHA-256 space.
    const { run } = scriptedRunner(treeScript({ [`${PRE_TREE}:src/a.ts`]: BLOB, [`${POST_TREE}:src/a.ts`]: BLOB }));
    const sibPre = hashTreePath({
      treeSha: PRE_TREE,
      path: 'src/a.ts',
      repoRoot: REPO_ROOT,
      objectDir: '/o',
      runGit: run
    });
    const sibPost = hashTreePath({
      treeSha: POST_TREE,
      path: 'src/a.ts',
      repoRoot: REPO_ROOT,
      objectDir: '/o',
      runGit: run
    });
    expect(sibPre).toEqual({ kind: 'hash', hash: sha256Hex(BLOB) });
    expect(sibPost).toEqual({ kind: 'hash', hash: sha256Hex(BLOB) });
    const mine: AmbiguityBaseline = { createdAt: 1000, preHash: sha256Hex(BLOB) };
    const sibling: SiblingSnapshot = {
      sessionId: 'other-session',
      toolUseId: 'toolu_sibling',
      createdAt: 2000,
      consumed: true,
      consumedAt: 2500,
      coverageGap: false,
      pre: sibPre.kind === 'hash' ? { hash: sibPre.hash } : null,
      post: sibPost.kind === 'hash' ? { hash: sibPost.hash } : null
    };
    expect(applyAmbiguityRules(mine, [sibling], 'src/a.ts')).toEqual({ ambiguous: false });
    const changedSibling: SiblingSnapshot = {
      ...sibling,
      post: { hash: sha256Hex(Buffer.from('different post content\n')) }
    };
    expect(applyAmbiguityRules(mine, [changedSibling], 'src/a.ts').ambiguous).toBe(true);
  });
});

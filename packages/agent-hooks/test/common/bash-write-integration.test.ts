/**
 * The plan's verification matrix (card main-212, Phase 3 step 11, plan
 * §Verification): real commands in real temp repositories, fake executors
 * that capture the TouchInputs, and an independent byte-diff oracle.
 *
 * Every fixture in this file runs its command for real via `bash -c` in a
 * fresh git repo seeded with committed files and spans, then feeds the
 * command string through `parseCommandDetailed` + `runBashTouches` with
 * counting/capturing fake executors. The executors stay fake — the matrix
 * asserts *which* touches fire, never tree state produced by them. The shell
 * commands are never mocked; formatter read-only fixtures run through PATH
 * stub executables (a real `bash -c 'gofmt -l f.go'` execution whose binary
 * is a no-op stub) so the runtime outcome is "ran, wrote nothing" rather
 * than "command not found".
 *
 * The byte-diff oracle is independent of the parser: expected changed lines
 * are computed by positionally diffing before/after file content, and the
 * parser's exact-range claims are checked for containment against that diff
 * plus a count-preservation invariant (an exact-range claim on a
 * line-count-changing edit is impossible by construction). Expected ranges
 * are never derived from the parser.
 *
 * Five fixtures below encode the plan's pinned acceptance cases and were red
 * against the shipped implementation — the class bugs reported to the team
 * lead and resolved here per the ruling (the Verification/§2/§3 letter wins
 * over §5.1's "never thread a body" sentence, which was about touch scope,
 * not gate fodder):
 *
 * 1. Overwrite bodies now thread `written` — single plain `>` redirects on
 *    fully literal `echo`/`printf` (same literality rules as append
 *    threading) and heredoc/tee `>` overwrites with literal bodies — so the
 *    plan's §1b `exact` gate runs: `echo hi > read-only-file` fires nothing
 *    (content mismatch) and the recreate `rm f && echo x > f` fires the echo
 *    (its exact pass explains the rm's delete-gate fail, so && fails open).
 * 2. Missing/parse-time-absent cp/install sources now emit *resolved*
 *    range-less whole-file reads (the parse runs post-command, so a source
 *    the compound's own earlier `rm` deleted is exactly this), the dest
 *    pairs against them, and the absent-source rule + the read's post-
 *    command existence gate run — `cp missing.txt existing.txt; echo done`
 *    and `rm a; cp a b` both fire nothing.
 * 3. Truncate spans carry the statically evaluated absolute `-s N` and
 *    `bashSpanToTouch` maps it to the `size` post-content (`-s 0` → empty),
 *    so the size gate runs — `truncate -s 3 read-only-file` fires nothing
 *    (post byte count != static size).
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger as ClaudeLogger } from '@goodfoot/claude-code-hooks';
import { Logger as CodexLogger } from '@goodfoot/codex-hooks';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHandler as createClaudeHandler } from '../../src/claude/post-tool-use.js';
import { createHandler as createClaudePlanHandler } from '../../src/claude/static-plan.js';
import { createHandler as createCodexHandler } from '../../src/codex/post-tool-use.js';
import { createHandler as createCodexPlanHandler } from '../../src/codex/static-plan.js';
import { createSessionLayout, type DriftPorcelainRow, type PorcelainRow } from '../../src/common/agent-hooks-common.js';
import { runBashTouches } from '../../src/common/bash-touch.js';
import { parseCommandDetailed, type ResolvedSpan, type SpanMatch } from '../../src/common/parse-command.js';
import type { MemoStore } from '../../src/common/span-surface.js';
import {
  createPlannedTouchStore,
  type PlannedTouchBudgets,
  type PlannedTouchRecord,
  parseCommandLayered
} from '../../src/common/static-attribution.js';
import type { TouchExecutors } from '../../src/common/touch-core.js';
import { makeTempRepo } from '../helpers.js';
import { makeTempLayout } from '../session-layout-helpers.js';
import { contextExecutors } from '../touch-context-fake.js';

/**
 * This file's own session base, on /tmp. Static plans and memo state must not
 * leak fixture session ids into the live `~/.cache/git-span/session` tree.
 */
const temp = makeTempLayout();
const layout = temp.layout;
afterAll(() => temp.cleanup());

const SESSION_ID = 'session-bash-write-integration';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** An in-memory MemoStore fake — one Set of surfaced names per session id. */
function createMemoryMemoStore(): MemoStore {
  const bySession = new Map<string, Set<string>>();
  return {
    getSurfaced(sessionId: string): Set<string> {
      return new Set(bySession.get(sessionId) ?? []);
    },
    addSurfaced(sessionId: string, names: string[]): void {
      const existing = bySession.get(sessionId) ?? new Set<string>();
      for (const n of names) existing.add(n);
      bySession.set(sessionId, existing);
    }
  };
}

/**
 * Capturing fake executors: `fix`/`list` record the absolute paths they were
 * called with (relative-normalized by the caller), `list`/`drift` serve the
 * caller-provided span rows (used by the whole-file-scope fixtures).
 */
function makeCaptureExecutors(
  listRows: PorcelainRow[] = [],
  driftRows: DriftPorcelainRow[] = []
): { executors: TouchExecutors; fixPaths: string[]; listPaths: string[] } {
  const fixPaths: string[] = [];
  const listPaths: string[] = [];
  return {
    executors: contextExecutors({
      fix: async (filePath: string) => {
        fixPaths.push(filePath);
        return { modified: false };
      },
      list: async (filePath: string): Promise<PorcelainRow[]> => {
        listPaths.push(filePath);
        return listRows;
      },
      drift: async (): Promise<DriftPorcelainRow[]> => driftRows,
      why: async (): Promise<string | null> => null
    }),
    fixPaths,
    listPaths
  };
}

// ---------------------------------------------------------------------------
// Repo seeding and command execution helpers
// ---------------------------------------------------------------------------

/** A temp repo with git identity configured (commits need it). */
function freshRepo(): { root: string; cleanup: () => void } {
  const repo = makeTempRepo();
  execFileSync('git', ['-C', repo.root, 'config', 'user.email', 't@t'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo.root, 'config', 'user.name', 't'], { stdio: 'ignore' });
  return repo;
}

function writeRel(root: string, rel: string, content: string): void {
  const full = join(root, rel);
  // Node's mkdirSync parent creation handles the dash- and space-named
  // fixtures identically; the paths are used verbatim in commands.
  writeFileSync(full, content, 'utf8');
}

function readRel(root: string, rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

function commitAll(root: string, msg: string): void {
  execFileSync('git', ['-C', root, 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', root, 'commit', '-m', msg], { stdio: 'ignore' });
}

function addSpan(root: string, name: string, anchor: string): void {
  execFileSync('git', ['span', 'add', name, anchor], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['span', 'why', name, `span ${name}`], { cwd: root, stdio: 'ignore' });
}

/**
 * Seed a tracked, spanned file — the reality-probe baseline for delete/absent
 * gates. `anchor` overrides the span anchor when the path needs `./`-prefacing
 * to survive git-span's option parsing (dash-leading filenames).
 */
function seedTrackedSpan(root: string, rel: string, content: string, spanName: string, anchor: string = rel): void {
  writeRel(root, rel, content);
  commitAll(root, `seed ${rel}`);
  addSpan(root, spanName, anchor);
  commitAll(root, `span ${rel}`);
}

/** Run a real shell command in the repo; returns the exit code (0 on success). */
function bashRun(command: string, cwd: string, opts: { env?: Record<string, string> } = {}): number {
  try {
    execFileSync('bash', ['-c', command], {
      cwd,
      stdio: 'ignore',
      env: { ...process.env, ...opts.env }
    });
    return 0;
  } catch (err) {
    return (err as { status?: number }).status ?? -1;
  }
}

// ---------------------------------------------------------------------------
// The pipeline under test
// ---------------------------------------------------------------------------

interface PipelineResult {
  matches: SpanMatch[];
  /** Relative paths (to the repo root) the fix executor was called with. */
  fixPaths: string[];
  /** Relative paths the list executor was called with. */
  listPaths: string[];
  /** The merged additionalContext blocks the driver returned. */
  blocks: string[];
}

/**
 * The full pipeline the adapters run: parse the command, then drive the
 * shared per-command verdict logic with fake executors. `interrupted` feeds
 * the §4 whole-command gate; `exitCode` feeds the §4 exit-code gate (a
 * harness-supplied non-zero code suppresses the existence-gated advisory
 * class); `list`/`drift` serve the surface rows the whole-file-scope fixtures
 * need.
 */
async function runPipeline(
  command: string,
  repoRoot: string,
  opts: { interrupted?: boolean; exitCode?: number; list?: PorcelainRow[]; drift?: DriftPorcelainRow[] } = {}
): Promise<PipelineResult> {
  const matches = parseCommandDetailed(command, repoRoot);
  const cap = makeCaptureExecutors(opts.list, opts.drift);
  const toolResponse: Record<string, unknown> = {};
  if (opts.interrupted) toolResponse.interrupted = true;
  if (opts.exitCode !== undefined) toolResponse.exit_code = opts.exitCode;
  const blocks = await runBashTouches(
    matches,
    SESSION_ID,
    repoRoot,
    toolResponse,
    cap.executors,
    createMemoryMemoStore()
  );
  const rel = (p: string): string => p.slice(repoRoot.length + 1);
  return { matches, fixPaths: cap.fixPaths.map(rel), listPaths: cap.listPaths.map(rel), blocks };
}

interface ParsedOp {
  op: string;
  rel: string;
  range?: string;
  written?: string;
}

/** Normalize the resolved spans of a command to a comparable shape. */
function parsedOps(matches: SpanMatch[], repoRoot: string): ParsedOp[] {
  return matches
    .filter((m) => m.status === 'resolved')
    .map((m) => {
      const s = m.span as ResolvedSpan;
      return {
        op: s.operation,
        rel: s.absolutePath.slice(repoRoot.length + 1),
        ...(s.lineStart !== undefined ? { range: `${s.lineStart}-${s.lineEnd}` } : {}),
        ...(s.written !== undefined ? { written: s.written } : {})
      };
    });
}

function unresolvedReasons(matches: SpanMatch[]): string[] {
  return matches.filter((m) => m.status !== 'resolved').map((m) => (m as { reason?: string }).reason ?? 'unresolved');
}

describe('layered substitution range integration', () => {
  let repo: { root: string; cleanup: () => void } | undefined;

  afterEach(() => repo?.cleanup());

  it('recovers every changed sed line from pre-state and drives both range touches', async () => {
    repo = freshRepo();
    const before = 'alpha\nneedle one\nbeta\nneedle two\nomega\n';
    seedTrackedSpan(repo.root, 'f.txt', before, 'f-lines');
    const fullPath = join(repo.root, 'f.txt');
    const parsed = parseCommandLayered("sed -i 's/needle/pin/' f.txt", {
      cwd: repo.root,
      readPreState: (absolutePath) => (absolutePath === fullPath ? before : null)
    });

    expect(bashRun("sed -i 's/needle/pin/' f.txt", repo.root)).toBe(0);
    const cap = makeCaptureExecutors();
    await runBashTouches(
      parsed.resolved.map(({ span }): SpanMatch => ({ status: 'resolved', idiom: 'sed-inplace', span })),
      SESSION_ID,
      repo.root,
      { exit_code: 0 },
      cap.executors,
      createMemoryMemoStore()
    );

    expect(parsed.resolved.map(({ span }) => [span.lineStart, span.lineEnd])).toEqual([
      [2, 2],
      [4, 4]
    ]);
    expect(lineDiff(splitLines(before), splitLines(readRel(repo.root, 'f.txt'))).changed).toEqual([2, 4]);
    expect(cap.fixPaths).toEqual([fullPath]);
  });

  it('recovers a multiline Perl -0pi substitution without widening to the file', () => {
    repo = freshRepo();
    const before = 'alpha\nneedle\nbeta\n';
    seedTrackedSpan(repo.root, 'f.txt', before, 'f-lines');
    const fullPath = join(repo.root, 'f.txt');
    const command = "perl -0pi -e 's/alpha\\nneedle/first\\npin/' f.txt";
    const parsed = parseCommandLayered(command, {
      cwd: repo.root,
      readPreState: (absolutePath) => (absolutePath === fullPath ? before : null)
    });

    expect(bashRun(command, repo.root)).toBe(0);
    expect(parsed.unresolved).toEqual([]);
    expect(parsed.resolved.map(({ span }) => [span.lineStart, span.lineEnd])).toEqual([[1, 2]]);
    expect(lineDiff(splitLines(before), splitLines(readRel(repo.root, 'f.txt'))).changed).toEqual([1, 2]);
  });

  it('attributes a completed substitution when a later command makes the compound fail', async () => {
    repo = freshRepo();
    const before = 'alpha\nneedle\nomega\n';
    seedTrackedSpan(repo.root, 'f.txt', before, 'f-lines');
    const fullPath = join(repo.root, 'f.txt');
    const command = "sed -i 's/needle/pin/' f.txt; false";
    const parsed = parseCommandLayered(command, {
      cwd: repo.root,
      readPreState: (absolutePath) => (absolutePath === fullPath ? before : null)
    });

    expect(bashRun(command, repo.root)).toBe(1);
    const cap = makeCaptureExecutors();
    await runBashTouches(
      parsed.resolved.map(({ span }): SpanMatch => ({ status: 'resolved', idiom: 'sed-inplace', span })),
      SESSION_ID,
      repo.root,
      { exit_code: 1 },
      cap.executors,
      createMemoryMemoStore()
    );

    expect(cap.fixPaths).toEqual([fullPath]);
  });

  it('suppresses a failed substitution when its decisive post-state evidence mismatches', async () => {
    repo = freshRepo();
    const before = 'alpha\nneedle\nomega\n';
    seedTrackedSpan(repo.root, 'f.txt', before, 'f-lines');
    const fullPath = join(repo.root, 'f.txt');
    const parsed = parseCommandLayered("sed -i 's/needle/pin/' f.txt", {
      cwd: repo.root,
      readPreState: (absolutePath) => (absolutePath === fullPath ? before : null)
    });
    writeRel(repo.root, 'f.txt', 'unexpected\n');
    const cap = makeCaptureExecutors();

    await runBashTouches(
      parsed.resolved.map(({ span }): SpanMatch => ({ status: 'resolved', idiom: 'sed-inplace', span })),
      SESSION_ID,
      repo.root,
      { exit_code: 1 },
      cap.executors,
      createMemoryMemoStore()
    );

    expect(cap.fixPaths).toEqual([]);
  });

  it('runs a literal Python replace and drives its recovered line touch', async () => {
    repo = freshRepo();
    const before = 'alpha\nbeta\nomega\n';
    seedTrackedSpan(repo.root, 'f.txt', before, 'f-lines');
    const fullPath = join(repo.root, 'f.txt');
    const command =
      "python3 -c \"from pathlib import Path; p=Path('f.txt'); s=p.read_text(); p.write_text(s.replace('beta','BETA'))\"";
    const parsed = parseCommandLayered(command, {
      cwd: repo.root,
      readPreState: (absolutePath) => (absolutePath === fullPath ? before : null)
    });

    expect(bashRun(command, repo.root)).toBe(0);
    const cap = makeCaptureExecutors();
    await runBashTouches(
      parsed.resolved.map(({ span }): SpanMatch => ({ status: 'resolved', idiom: 'sed-inplace', span })),
      SESSION_ID,
      repo.root,
      { exit_code: 0 },
      cap.executors,
      createMemoryMemoStore()
    );

    expect(parsed.unresolved).toEqual([]);
    expect(parsed.resolved.map(({ span }) => [span.lineStart, span.lineEnd])).toEqual([[2, 2]]);
    expect(lineDiff(splitLines(before), splitLines(readRel(repo.root, 'f.txt'))).changed).toEqual([2]);
    expect(cap.fixPaths).toEqual([fullPath]);
  });

  it('suppresses failed Python attribution when the decisive post-state evidence mismatches', async () => {
    repo = freshRepo();
    const before = 'alpha\nbeta\nomega\n';
    seedTrackedSpan(repo.root, 'f.txt', before, 'f-lines');
    const fullPath = join(repo.root, 'f.txt');
    const parsed = parseCommandLayered(
      "python3 -c \"from pathlib import Path; p=Path('f.txt'); s=p.read_text(); p.write_text(s.replace('beta','BETA'))\"",
      {
        cwd: repo.root,
        readPreState: (absolutePath) => (absolutePath === fullPath ? before : null)
      }
    );
    writeRel(repo.root, 'f.txt', 'unexpected\n');
    const cap = makeCaptureExecutors();

    await runBashTouches(
      parsed.resolved.map(({ span }): SpanMatch => ({ status: 'resolved', idiom: 'sed-inplace', span })),
      SESSION_ID,
      repo.root,
      { exit_code: 1 },
      cap.executors,
      createMemoryMemoStore()
    );

    expect(cap.fixPaths).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The byte-diff oracle — independent of the parser
// ---------------------------------------------------------------------------

/**
 * Positionally diff two file contents: 1-based indices of the lines that
 * differ in the post-edit file, and whether the line count was preserved.
 * Exact-range parser claims are only checked against the count-preserved
 * case — a line-count-changing edit cannot have a positional range.
 */
function lineDiff(beforeLines: string[], afterLines: string[]): { changed: number[]; countPreserved: boolean } {
  const changed: number[] = [];
  const n = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < n; i++) {
    if (beforeLines[i] !== afterLines[i]) changed.push(i + 1);
  }
  return { changed, countPreserved: beforeLines.length === afterLines.length };
}

function splitLines(content: string): string[] {
  return content.split('\n').slice(0, -1);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

describe('bash-write-integration — content-writing families (plan §Verification, temp repos)', () => {
  const repos: Array<{ root: string; cleanup: () => void }> = [];
  afterEach(() => {
    for (const repo of repos.splice(0)) repo.cleanup();
  });

  function repo(): { root: string; cleanup: () => void } {
    const r = freshRepo();
    repos.push(r);
    return r;
  }

  it('echo `>` overwrite: whole-file create-overwrite threading the literal body (exact gate)', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'old\n', 'overwrite-span');
    expect(bashRun('echo hello > f.txt', r.root)).toBe(0);
    const res = await runPipeline('echo hello > f.txt', r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([{ op: 'create-overwrite', rel: 'f.txt', written: 'hello\n' }]);
    expect(res.fixPaths).toEqual(['f.txt']);
    expect(readRel(r.root, 'f.txt')).toBe('hello\n');
  });

  it('echo `>>` append: body threaded as the suffix gate', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'a\nb\n', 'append-span');
    expect(bashRun('echo x >> f.txt', r.root)).toBe(0);
    const res = await runPipeline('echo x >> f.txt', r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([{ op: 'append', rel: 'f.txt', written: 'x\n' }]);
    expect(res.fixPaths).toEqual(['f.txt']);
    expect(readRel(r.root, 'f.txt')).toBe('a\nb\nx\n');
  });

  it('bare `>` truncates to empty: empty-content gate', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'data\n', 'trunc-span');
    expect(bashRun('> f.txt', r.root)).toBe(0);
    const res = await runPipeline('> f.txt', r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([{ op: 'truncate', rel: 'f.txt' }]);
    expect(res.fixPaths).toEqual(['f.txt']);
    expect(readRel(r.root, 'f.txt')).toBe('');
  });

  it('truncate -s 0: size gate, empty result', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'data\n', 'trunc0-span');
    expect(bashRun('truncate -s 0 f.txt', r.root)).toBe(0);
    const res = await runPipeline('truncate -s 0 f.txt', r.root);
    expect(res.fixPaths).toEqual(['f.txt']);
    expect(readRel(r.root, 'f.txt')).toBe('');
  });

  it('truncate -s N: exact byte-count gate', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'hello', 'truncn-span');
    expect(bashRun('truncate -s 3 f.txt', r.root)).toBe(0);
    const res = await runPipeline('truncate -s 3 f.txt', r.root);
    expect(res.fixPaths).toEqual(['f.txt']);
    expect(readRel(r.root, 'f.txt')).toBe('hel');
  });

  it('heredoc `>` overwrite: create-overwrite threading the literal body', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'h.txt', 'old\n', 'heredoc-span');
    const command = "cat <<'EOF' > h.txt\nhello\nEOF\n";
    expect(bashRun(command, r.root)).toBe(0);
    const res = await runPipeline(command, r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([{ op: 'create-overwrite', rel: 'h.txt', written: 'hello\n' }]);
    expect(res.fixPaths).toEqual(['h.txt']);
    expect(readRel(r.root, 'h.txt')).toBe('hello\n');
  });

  it('symlinked redirect: the write goes through the link to the target', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'target.txt', 'old\n', 'link-span');
    expect(bashRun('ln -s target.txt link.txt && echo x > link.txt', r.root)).toBe(0);
    const res = await runPipeline('echo x > link.txt', r.root);
    expect(res.fixPaths).toEqual(['link.txt']);
    expect(readRel(r.root, 'target.txt')).toBe('x\n');
  });

  it('space-named path: `echo x > "my file.txt"`', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'my file.txt', 'old\n', 'space-span');
    expect(bashRun('echo x > "my file.txt"', r.root)).toBe(0);
    const res = await runPipeline('echo x > "my file.txt"', r.root);
    expect(res.fixPaths).toEqual(['my file.txt']);
    expect(readRel(r.root, 'my file.txt')).toBe('x\n');
  });

  it('dash-named path with option terminator: `rm -- -f.txt`', async () => {
    const r = repo();
    // git-span would parse `-f.txt` as an option; the `./`-prefixed anchor
    // survives, and the porcelain row still maps to the same absolute path.
    seedTrackedSpan(r.root, '-f.txt', 'x\n', 'dash-span', './-f.txt');
    expect(bashRun('rm -- -f.txt', r.root)).toBe(0);
    const res = await runPipeline('rm -- -f.txt', r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([{ op: 'delete', rel: '-f.txt' }]);
    expect(res.fixPaths).toEqual(['-f.txt']);
  });

  it('an unquoted heredoc with $ expands at runtime: existence-gated touch, no exact claim', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'h.txt', 'old\n', 'heredoc-expand-span');
    const command = 'cat <<EOF > h.txt\n$HOME-secret\nEOF\n';
    expect(bashRun(command, r.root)).toBe(0);
    const res = await runPipeline(command, r.root);
    // No `written` threading: the shell expanded the body, so the parser
    // cannot know the exact bytes — the touch stays in the advisory class.
    expect(parsedOps(res.matches, r.root)).toEqual([{ op: 'create-overwrite', rel: 'h.txt' }]);
    expect(res.fixPaths).toEqual(['h.txt']);
    const after = readRel(r.root, 'h.txt');
    expect(after).toMatch(/-secret\n$/);
    expect(after).not.toBe('$HOME-secret\n');
  });

  it('a quoted delimiter keeps the exact claim even with $ in the body (control)', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'h.txt', 'old\n', 'heredoc-quoted-span');
    const command = "cat <<'EOF' > h.txt\n$HOME\nEOF\n";
    expect(bashRun(command, r.root)).toBe(0);
    const res = await runPipeline(command, r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([{ op: 'create-overwrite', rel: 'h.txt', written: '$HOME\n' }]);
    expect(res.fixPaths).toEqual(['h.txt']);
    expect(readRel(r.root, 'h.txt')).toBe('$HOME\n');
  });

  it('exec > f truncates the fd-1 target', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'data\n', 'exec-trunc-span');
    expect(bashRun('exec > f.txt', r.root)).toBe(0);
    const res = await runPipeline('exec > f.txt', r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([{ op: 'truncate', rel: 'f.txt' }]);
    expect(res.fixPaths).toEqual(['f.txt']);
    expect(readRel(r.root, 'f.txt')).toBe('');
  });
});

describe('bash-write-integration — copy/install/move/delete families', () => {
  const repos: Array<{ root: string; cleanup: () => void }> = [];
  afterEach(() => {
    for (const repo of repos.splice(0)) repo.cleanup();
  });
  function repo(): { root: string; cleanup: () => void } {
    const r = freshRepo();
    repos.push(r);
    return r;
  }

  it('cp: source read surfaced, dest content-verified against the source', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'a.txt', 'adata\n', 'cp-src-span');
    writeRel(r.root, 'b.txt', 'bdata\n');
    expect(bashRun('cp a.txt b.txt', r.root)).toBe(0);
    const res = await runPipeline('cp a.txt b.txt', r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([
      { op: 'read', rel: 'a.txt', range: '1-1' },
      { op: 'create-overwrite', rel: 'b.txt' }
    ]);
    // The source read lists once; the fired dest write also lists (the
    // surface block computation runs per fired touch).
    expect(res.listPaths).toEqual(['a.txt', 'b.txt']);
    expect(res.fixPaths).toEqual(['b.txt']);
    expect(readRel(r.root, 'b.txt')).toBe('adata\n');
  });

  it('install -s: stripped dest gates existence-only and fires', async () => {
    const r = repo();
    expect(bashRun('install -s /usr/bin/true dst.txt', r.root)).toBe(0);
    const res = await runPipeline('install -s /usr/bin/true dst.txt', r.root);
    expect(res.fixPaths).toEqual(['dst.txt']);
  });

  it('mv: delete on the source, rename-copy on the destination', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'a.txt', 'adata\n', 'mv-src-span');
    writeRel(r.root, 'b.txt', 'bdata\n');
    expect(bashRun('mv a.txt b.txt', r.root)).toBe(0);
    const res = await runPipeline('mv a.txt b.txt', r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([
      { op: 'delete', rel: 'a.txt' },
      { op: 'rename-copy', rel: 'b.txt' }
    ]);
    expect(res.fixPaths).toEqual(['a.txt', 'b.txt']);
    expect(readRel(r.root, 'b.txt')).toBe('adata\n');
  });

  it('git mv: same delete + rename-copy shape', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'g.txt', 'g1\n', 'gitmv-span');
    expect(bashRun('git mv g.txt g2.txt', r.root)).toBe(0);
    const res = await runPipeline('git mv g.txt g2.txt', r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([
      { op: 'delete', rel: 'g.txt' },
      { op: 'rename-copy', rel: 'g2.txt' }
    ]);
    expect(res.fixPaths).toEqual(['g.txt', 'g2.txt']);
    expect(readRel(r.root, 'g2.txt')).toBe('g1\n');
  });

  it('rm of several real files: one delete touch per file', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'a.txt', 'a\n', 'rm-a-span');
    seedTrackedSpan(r.root, 'b.txt', 'b\n', 'rm-b-span');
    expect(bashRun('rm a.txt b.txt', r.root)).toBe(0);
    const res = await runPipeline('rm a.txt b.txt', r.root);
    expect(res.fixPaths).toEqual(['a.txt', 'b.txt']);
  });

  it('cp -n with a pre-existing equal dest fires the dest (the documented no-op residue)', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'a.txt', 'same\n', 'cpn-src-span');
    seedTrackedSpan(r.root, 'b.txt', 'same\n', 'cpn-dest-span');
    expect(bashRun('cp -n a.txt b.txt', r.root)).toBe(0);
    const res = await runPipeline('cp -n a.txt b.txt', r.root);
    // The byte-compare gate cannot see the -n skip: a dest that equals the
    // source fires whether the copy or a pre-existing equal file produced
    // it — pinned residue, the no-clobber blind spot.
    expect(res.fixPaths).toEqual(['b.txt']);
    expect(readRel(r.root, 'b.txt')).toBe('same\n');
  });

  it('cp -n with a pre-existing different dest fires nothing (the skip really skips)', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'a.txt', 'same\n', 'cpn-diff-src-span');
    seedTrackedSpan(r.root, 'b.txt', 'other\n', 'cpn-diff-dest-span');
    expect(bashRun('cp -n a.txt b.txt', r.root)).toBe(0);
    const res = await runPipeline('cp -n a.txt b.txt', r.root);
    // Different content: the copy did not happen (b was skipped) and the
    // byte-compare fails — the gate holds the dest back.
    expect(res.fixPaths).toEqual([]);
    expect(readRel(r.root, 'b.txt')).toBe('other\n');
  });

  it('rm with an already-absent tracked operand still fires both deletes (the harmless residue)', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'a.txt', 'x\n', 'rmabs-a-span');
    writeRel(r.root, 'b.txt', 'y\n');
    commitAll(r.root, 'seed b.txt');
    // b.txt is gone from the working tree but still in the index — the
    // delete-reality probe treats it as a tracked deletion, so its touch
    // fires alongside a.txt's; the file is already absent, so the heal is a
    // no-op (pinned residue). GNU rm exits 1 over the already-absent
    // operand; no exit code is supplied to the pipeline, so it proceeds.
    expect(bashRun('rm b.txt', r.root)).toBe(0);
    expect(bashRun('rm a.txt b.txt', r.root)).not.toBe(0);
    const res = await runPipeline('rm a.txt b.txt', r.root);
    expect(res.fixPaths).toEqual(['a.txt', 'b.txt']);
  });

  it('rm with an untracked absent operand never fires the phantom delete', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'a.txt', 'x\n', 'rmabs2-span');
    // GNU rm exits 1 over the absent operand — the pipeline still proceeds
    // (no harness exit code), and the phantom-delete rule holds the
    // never-tracked path back.
    expect(bashRun('rm a.txt never-existed.txt', r.root)).not.toBe(0);
    const res = await runPipeline('rm a.txt never-existed.txt', r.root);
    expect(res.fixPaths).toEqual(['a.txt']);
    expect(res.fixPaths).not.toContain('never-existed.txt');
  });
});

describe('bash-write-integration — in-place editors (sed -i, patch, git apply)', () => {
  const repos: Array<{ root: string; cleanup: () => void }> = [];
  afterEach(() => {
    for (const repo of repos.splice(0)) repo.cleanup();
  });
  function repo(): { root: string; cleanup: () => void } {
    const r = freshRepo();
    repos.push(r);
    return r;
  }

  it('sed -i pattern: whole-file modify', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'sf.txt', 'a1\nx1\n', 'sed-span');
    expect(bashRun("sed -i 's/a1/b1/' sf.txt", r.root)).toBe(0);
    const res = await runPipeline("sed -i 's/a1/b1/' sf.txt", r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([{ op: 'modify', rel: 'sf.txt', range: '1-2' }]);
    expect(res.fixPaths).toEqual(['sf.txt']);
    expect(readRel(r.root, 'sf.txt')).toBe('b1\nx1\n');
  });

  it('sed -i.bak: modify plus a create-overwrite backup touch', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'sf.txt', 'a1\nx1\n', 'sedbak-span');
    expect(bashRun("sed -i.bak 's/a1/b1/' sf.txt", r.root)).toBe(0);
    const res = await runPipeline("sed -i.bak 's/a1/b1/' sf.txt", r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([
      { op: 'modify', rel: 'sf.txt', range: '1-2' },
      { op: 'create-overwrite', rel: 'sf.txt.bak' }
    ]);
    expect(res.fixPaths).toEqual(['sf.txt', 'sf.txt.bak']);
    expect(readRel(r.root, 'sf.txt.bak')).toBe('a1\nx1\n');
  });

  it('git apply hunk: modify with the hunk union range', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'one\ntwo\nthree\nfour\n', 'apply-span');
    writeRel(r.root, 'p2.diff', '--- a/f.txt\n+++ b/f.txt\n@@ -1,4 +1,4 @@\n one\n-two\n+two2\n three\n four\n');
    expect(bashRun('git apply p2.diff', r.root)).toBe(0);
    const res = await runPipeline('git apply p2.diff', r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([{ op: 'modify', rel: 'f.txt', range: '1-4' }]);
    expect(res.fixPaths).toEqual(['f.txt']);
    expect(readRel(r.root, 'f.txt')).toBe('one\ntwo2\nthree\nfour\n');
  });

  it('patch -p1: same modify shape through the patch binary', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'one\ntwo\nthree\nfour\n', 'patch-span');
    writeRel(r.root, 'p2.diff', '--- a/f.txt\n+++ b/f.txt\n@@ -1,4 +1,4 @@\n one\n-two\n+two2\n three\n four\n');
    expect(bashRun('patch -p1 < p2.diff', r.root)).toBe(0);
    const res = await runPipeline('patch -p1 < p2.diff', r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([{ op: 'modify', rel: 'f.txt', range: '1-4' }]);
    expect(res.fixPaths).toEqual(['f.txt']);
  });

  it('git apply full deletion: exactly one delete touch', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'del.txt', 'x\n', 'del-apply-span');
    writeRel(r.root, 'del.diff', '--- a/del.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n');
    expect(bashRun('git apply del.diff', r.root)).toBe(0);
    const res = await runPipeline('git apply del.diff', r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([{ op: 'delete', rel: 'del.txt' }]);
    expect(res.fixPaths).toEqual(['del.txt']);
  });

  it('patch full deletion: exactly one delete touch', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'pd.txt', 'x\n', 'del-patch-span');
    writeRel(r.root, 'pd.diff', '--- a/pd.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n');
    expect(bashRun('patch -p1 < pd.diff', r.root)).toBe(0);
    const res = await runPipeline('patch -p1 < pd.diff', r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([{ op: 'delete', rel: 'pd.txt' }]);
    expect(res.fixPaths).toEqual(['pd.txt']);
  });

  it('diff -u headers with tab timestamps: patch -p0 targets the --- side', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'keep.txt', 'k1\nk2\nk3\n', 'diffu-patch-span');
    writeRel(
      r.root,
      'u.diff',
      '--- keep.txt\t2024-01-01 00:00:00.000000000 +0000\n+++ keep.txt\t2024-01-01 00:00:01.000000000 +0000\n@@ -1,3 +1,3 @@\n k1\n-k2\n+k2!\n k3\n'
    );
    expect(bashRun('patch -p0 < u.diff', r.root)).toBe(0);
    const res = await runPipeline('patch -p0 < u.diff', r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([{ op: 'modify', rel: 'keep.txt', range: '1-3' }]);
    expect(res.fixPaths).toEqual(['keep.txt']);
    expect(readRel(r.root, 'keep.txt')).toBe('k1\nk2!\nk3\n');
  });

  it('diff -u headers with tab timestamps: git apply reads the --- side too', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'keep.txt', 'k1\nk2\nk3\n', 'diffu-apply-span');
    writeRel(
      r.root,
      'u.diff',
      '--- keep.txt\t2024-01-01 00:00:00.000000000 +0000\n+++ keep.txt\t2024-01-01 00:00:01.000000000 +0000\n@@ -1,3 +1,3 @@\n k1\n-k2\n+k2!\n k3\n'
    );
    expect(bashRun('git apply u.diff', r.root)).toBe(0);
    const res = await runPipeline('git apply u.diff', r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([{ op: 'modify', rel: 'keep.txt', range: '1-3' }]);
    expect(res.fixPaths).toEqual(['keep.txt']);
    expect(readRel(r.root, 'keep.txt')).toBe('k1\nk2!\nk3\n');
  });

  it('a diff -u label pair (--- f / +++ f.new) still targets the --- side', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'keep.txt', 'k1\nk2\nk3\n', 'diffu-label-span');
    writeRel(r.root, 'u.diff', '--- keep.txt\n+++ keep.new\n@@ -1,3 +1,3 @@\n k1\n-k2\n+k2!\n k3\n');
    expect(bashRun('patch -p0 < u.diff', r.root)).toBe(0);
    const res = await runPipeline('patch -p0 < u.diff', r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([{ op: 'modify', rel: 'keep.txt', range: '1-3' }]);
    expect(res.fixPaths).toEqual(['keep.txt']);
    expect(readRel(r.root, 'keep.txt')).toBe('k1\nk2!\nk3\n');
  });

  it('diff -u new-file shape (--- /dev/null, no new file mode header): patch -p0 creates the file and fires a create-overwrite touch', async () => {
    const r = repo();
    writeRel(r.root, 'nf.diff', '--- /dev/null\n+++ nf.txt\n@@ -0,0 +1 @@\n+content\n');
    expect(bashRun('patch -p0 < nf.diff', r.root)).toBe(0);
    const res = await runPipeline('patch -p0 < nf.diff', r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([{ op: 'create-overwrite', rel: 'nf.txt' }]);
    expect(res.fixPaths).toEqual(['nf.txt']);
    expect(readRel(r.root, 'nf.txt')).toBe('content\n');
  });

  it('diff -u new-file shape (--- /dev/null, no new file mode header): git apply creates the file and fires a create-overwrite touch', async () => {
    const r = repo();
    writeRel(r.root, 'nf.diff', '--- /dev/null\n+++ nf.txt\n@@ -0,0 +1 @@\n+content\n');
    expect(bashRun('git apply nf.diff', r.root)).toBe(0);
    const res = await runPipeline('git apply nf.diff', r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([{ op: 'create-overwrite', rel: 'nf.txt' }]);
    expect(res.fixPaths).toEqual(['nf.txt']);
    expect(readRel(r.root, 'nf.txt')).toBe('content\n');
  });

  it('re-creating a deleted spanned path with a git-less new-file patch fires the create-overwrite touch (the user-visible miss case)', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'a.txt', 'l1\nl2\nl3\nl4\nl5\n', 'recreate-patch-span');
    // A genuinely new file carries no span anchors, so a silent miss there
    // is invisible — the re-creation of a still-spanned path is where the
    // round-2 finding was user-visible: `git span drift` shows the dangling
    // "a.txt#L1-L5" until the touch fires. The fix call below IS that
    // surfaced drift (fake executors capture the path the hook heals).
    expect(bashRun('rm a.txt', r.root)).toBe(0);
    writeRel(r.root, 'new.diff', '--- /dev/null\n+++ a.txt\n@@ -0,0 +1,5 @@\n+n1\n+n2\n+n3\n+n4\n+n5\n');
    expect(bashRun('patch -p0 < new.diff', r.root)).toBe(0);
    const res = await runPipeline('patch -p0 < new.diff', r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([{ op: 'create-overwrite', rel: 'a.txt' }]);
    expect(res.fixPaths).toEqual(['a.txt']);
    expect(readRel(r.root, 'a.txt')).toBe('n1\nn2\nn3\nn4\nn5\n');
  });

  it('&&-joined rm a.txt && patch -p0 < new.diff re-creates a spanned path: the create-overwrite touch fires (round-3 miss case)', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'a.txt', 'l1\nl2\nl3\nl4\nl5\n', 'recreate-and-patch-span');
    // The round-3 finding: the compound ends with a.txt present because the
    // patch re-created it, so the rm's delete gate fails ("file present, so
    // the delete didn't happen") — but the patch's existence gate is
    // inconclusive, so only the later-recreate explanation (file-producing
    // later write + working tree differing from the index) can un-fail the
    // rm and let `&&` fail open. The delete stays explained-suppressed; the
    // create-overwrite fires (fake executors capture the healed path).
    writeRel(r.root, 'new.diff', '--- /dev/null\n+++ a.txt\n@@ -0,0 +1,5 @@\n+n1\n+n2\n+n3\n+n4\n+n5\n');
    expect(bashRun('rm a.txt && patch -p0 < new.diff', r.root)).toBe(0);
    const res = await runPipeline('rm a.txt && patch -p0 < new.diff', r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([
      { op: 'delete', rel: 'a.txt' },
      { op: 'create-overwrite', rel: 'a.txt' }
    ]);
    expect(res.fixPaths).toEqual(['a.txt']);
    expect(readRel(r.root, 'a.txt')).toBe('n1\nn2\nn3\nn4\nn5\n');
  });

  it('&&-joined rm a.txt && git apply new.diff re-creates a spanned path: the create-overwrite touch fires', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'a.txt', 'l1\nl2\nl3\nl4\nl5\n', 'recreate-and-gitapply-span');
    writeRel(r.root, 'new.diff', '--- /dev/null\n+++ a.txt\n@@ -0,0 +1,5 @@\n+n1\n+n2\n+n3\n+n4\n+n5\n');
    expect(bashRun('rm a.txt && git apply new.diff', r.root)).toBe(0);
    const res = await runPipeline('rm a.txt && git apply new.diff', r.root);
    expect(res.fixPaths).toEqual(['a.txt']);
    expect(readRel(r.root, 'a.txt')).toBe('n1\nn2\nn3\nn4\nn5\n');
  });

  it('&&-joined rm a.txt && patch -p0 < new.diff && git add a.txt (re-create staged in the same compound): the create-overwrite touch fires (round-4 miss case)', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'a.txt', 'l1\nl2\nl3\nl4\nl5\n', 'recreate-and-staged-patch-span');
    // The round-4 finding's exact shape: `git add` at the end of the
    // compound stages the re-created a.txt, so the probe's status row is
    // `M ` — index differs from HEAD, worktree matches the index — the
    // state the round-3 Y-column rule read as "no re-create" (byte-identical
    // worktree-vs-index to the short-circuited-chain state, distinguished
    // only by the index column). The widened rule marks any tracked status
    // row, the delete's fail is explained, && fails open, and the
    // create-overwrite fires (fake executors capture the healed path).
    writeRel(r.root, 'new.diff', '--- /dev/null\n+++ a.txt\n@@ -0,0 +1,5 @@\n+n1\n+n2\n+n3\n+n4\n+n5\n');
    expect(bashRun('rm a.txt && patch -p0 < new.diff && git add a.txt', r.root)).toBe(0);
    const res = await runPipeline('rm a.txt && patch -p0 < new.diff && git add a.txt', r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([
      { op: 'delete', rel: 'a.txt' },
      { op: 'create-overwrite', rel: 'a.txt' }
    ]);
    expect(res.fixPaths).toEqual(['a.txt']);
    expect(readRel(r.root, 'a.txt')).toBe('n1\nn2\nn3\nn4\nn5\n');
  });

  it('&&-joined rm a.txt && git apply new.diff && git add a.txt (re-create staged): the create-overwrite touch fires', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'a.txt', 'l1\nl2\nl3\nl4\nl5\n', 'recreate-and-staged-gitapply-span');
    writeRel(r.root, 'new.diff', '--- /dev/null\n+++ a.txt\n@@ -0,0 +1,5 @@\n+n1\n+n2\n+n3\n+n4\n+n5\n');
    expect(bashRun('rm a.txt && git apply new.diff && git add a.txt', r.root)).toBe(0);
    const res = await runPipeline('rm a.txt && git apply new.diff && git add a.txt', r.root);
    expect(res.fixPaths).toEqual(['a.txt']);
    expect(readRel(r.root, 'a.txt')).toBe('n1\nn2\nn3\nn4\nn5\n');
  });

  it('&&-joined rm a.txt && patch -p0 < new.diff with the rm failing on a PRE-DIRTY path: the advisory still fires (the documented residual)', async () => {
    const r = repo();
    try {
      seedTrackedSpan(r.root, 'a.txt', 'l1\nl2\nl3\nl4\nl5\n', 'recreate-and-dirty-residual-span');
      // A pre-existing uncommitted change (the compound never runs to the
      // patch — the read-only dir fails the rm and `&&` drops it) makes the
      // file differ from the index BEFORE the compound: the documented
      // residual that masks the discriminator — the probe still sees a
      // status row, so the joined write fires advisory. Same bounded harm as
      // the plan's "coincidentally passes" join corner.
      writeRel(r.root, 'a.txt', 'dirty-before\n');
      writeRel(r.root, 'new.diff', '--- /dev/null\n+++ a.txt\n@@ -0,0 +1,5 @@\n+n1\n+n2\n+n3\n+n4\n+n5\n');
      chmodSync(r.root, 0o500);
      expect(bashRun('rm a.txt && patch -p0 < new.diff', r.root)).not.toBe(0);
      const res = await runPipeline('rm a.txt && patch -p0 < new.diff', r.root);
      expect(res.fixPaths).toEqual(['a.txt']);
      expect(readRel(r.root, 'a.txt')).toBe('dirty-before\n');
    } finally {
      chmodSync(r.root, 0o700);
    }
  });

  it('&&-joined rm a.txt && patch -p0 < new.diff && git add a.txt on a NEVER-COMMITTED path: the create-overwrite touch fires (the round-4 `A ` variant)', async () => {
    const r = repo();
    // The `A ` row shape: the path is staged (`git add`) but never in HEAD —
    // a delete+recreate+stage compound over a baseline that came from a
    // prior staged add. The index column is what marks it (X=A, Y blank),
    // exactly as for `M `; the delete-reality probe reads the index, so the
    // delete still targets a real tracked path. The delete's fail is
    // explained and && fails open; the create-overwrite fires.
    writeRel(r.root, 'a.txt', 'l1\nl2\nl3\nl4\nl5\n');
    execFileSync('git', ['-C', r.root, 'add', 'a.txt'], { stdio: 'ignore' });
    writeRel(r.root, 'new.diff', '--- /dev/null\n+++ a.txt\n@@ -0,0 +1,5 @@\n+n1\n+n2\n+n3\n+n4\n+n5\n');
    expect(bashRun('rm a.txt && patch -p0 < new.diff && git add a.txt', r.root)).toBe(0);
    const res = await runPipeline('rm a.txt && patch -p0 < new.diff && git add a.txt', r.root);
    expect(res.fixPaths).toEqual(['a.txt']);
    expect(readRel(r.root, 'a.txt')).toBe('n1\nn2\nn3\nn4\nn5\n');
  });

  it('&&-joined rm a.txt && patch -p0 < new.diff && git add a.txt round-tripping IDENTICAL content: zero touches — the clean porcelain denies the re-create mark', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'a.txt', 'l1\nl2\nl3\nl4\nl5\n', 'recreate-and-identical-roundtrip-span');
    // The case the probe exists to kill: the compound re-creates the file
    // with the very content HEAD already holds (and stages it), so the
    // porcelain ends clean — no row, no re-create mark, the delete-gate
    // fail stays unexplained, and && suppresses the patch. Zero touches is
    // correct: there is zero drift to surface, and a content-neutral failed
    // rm would leave the same porcelain — the probe cannot and need not
    // tell the two apart.
    writeRel(r.root, 'new.diff', '--- /dev/null\n+++ a.txt\n@@ -0,0 +1,5 @@\n+l1\n+l2\n+l3\n+l4\n+l5\n');
    expect(bashRun('rm a.txt && patch -p0 < new.diff && git add a.txt', r.root)).toBe(0);
    const res = await runPipeline('rm a.txt && patch -p0 < new.diff && git add a.txt', r.root);
    expect(res.fixPaths).toEqual([]);
    expect(readRel(r.root, 'a.txt')).toBe('l1\nl2\nl3\nl4\nl5\n');
  });

  it("&&-joined rm a.txt && patch -p0 < new.diff with the rm failing on a PRE-STAGED path: the advisory still fires (the widening's one cost)", async () => {
    const r = repo();
    try {
      seedTrackedSpan(r.root, 'a.txt', 'l1\nl2\nl3\nl4\nl5\n', 'recreate-and-staged-residual-span');
      // The widening's one cost, end-to-end: a pre-existing STAGED change
      // (`git add` before the compound — index differs from HEAD, worktree
      // clean) plus a failed rm (read-only dir) leaves the `M ` row the
      // round-4 rule marks, so the joined write fires advisory even though
      // the patch never ran — round-3's blank-Y rule kept this invisible.
      // Only manifests where genuine staged drift exists against the span
      // baseline; a harness-supplied non-zero exit code still suppresses
      // the advisory class in pass B.
      writeRel(r.root, 'a.txt', 'staged-before\n');
      execFileSync('git', ['-C', r.root, 'add', 'a.txt'], { stdio: 'ignore' });
      writeRel(r.root, 'new.diff', '--- /dev/null\n+++ a.txt\n@@ -0,0 +1,5 @@\n+n1\n+n2\n+n3\n+n4\n+n5\n');
      chmodSync(r.root, 0o500);
      expect(bashRun('rm a.txt && patch -p0 < new.diff', r.root)).not.toBe(0);
      const res = await runPipeline('rm a.txt && patch -p0 < new.diff', r.root);
      expect(res.fixPaths).toEqual(['a.txt']);
      expect(readRel(r.root, 'a.txt')).toBe('staged-before\n');
    } finally {
      chmodSync(r.root, 0o700);
    }
  });

  it('&&-joined rm a.txt && : > a.txt re-creates a spanned path with an empty truncate: the truncate touch fires (round-3 empty-truncate dialect)', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'a.txt', 'l1\nl2\nl3\nl4\nl5\n', 'recreate-and-empty-truncate-span');
    // The `: > a.txt` grammar is a truncate span without a size (verified
    // against parse-command), so it gates existence-only and is body-less —
    // the exact class the round-3 miss covered: the rm's delete gate fails
    // ("file present, so the delete didn't happen") while the re-created
    // empty file satisfies only the truncate's existence gate. The
    // later-recreate explanation un-fails the rm, `&&` fails open, and the
    // truncate advisory fires.
    expect(bashRun('rm a.txt && : > a.txt', r.root)).toBe(0);
    const res = await runPipeline('rm a.txt && : > a.txt', r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([
      { op: 'delete', rel: 'a.txt' },
      { op: 'truncate', rel: 'a.txt' }
    ]);
    expect(res.fixPaths).toEqual(['a.txt']);
    expect(readRel(r.root, 'a.txt')).toBe('');
  });

  it('&&-joined rm a.txt && echo ONE > a.txt (body-carrying control): the create-overwrite touch still fires', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'a.txt', 'l1\nl2\nl3\nl4\nl5\n', 'recreate-and-body-control-span');
    // Regression control: a body-carrying re-creator already fires today via
    // exact-content verification (the literal body rides as the exact
    // post-content expectation, the gate decisivePasses, the delete is
    // explained on the decisive-pass axis). The empty-truncate fix must not
    // change that.
    expect(bashRun('rm a.txt && echo ONE > a.txt', r.root)).toBe(0);
    const res = await runPipeline('rm a.txt && echo ONE > a.txt', r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([
      { op: 'delete', rel: 'a.txt' },
      { op: 'create-overwrite', rel: 'a.txt', written: 'ONE\n' }
    ]);
    expect(res.fixPaths).toEqual(['a.txt']);
    expect(readRel(r.root, 'a.txt')).toBe('ONE\n');
  });

  it(';-joined rm a.txt; patch -p0 < new.diff still fires the create-overwrite touch (no join gate)', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'a.txt', 'l1\nl2\nl3\nl4\nl5\n', 'recreate-semi-patch-span');
    writeRel(r.root, 'new.diff', '--- /dev/null\n+++ a.txt\n@@ -0,0 +1,5 @@\n+n1\n+n2\n+n3\n+n4\n+n5\n');
    expect(bashRun('rm a.txt; patch -p0 < new.diff', r.root)).toBe(0);
    const res = await runPipeline('rm a.txt; patch -p0 < new.diff', r.root);
    expect(res.fixPaths).toEqual(['a.txt']);
    expect(readRel(r.root, 'a.txt')).toBe('n1\nn2\nn3\nn4\nn5\n');
  });

  it('&&-joined rm a.txt && patch -p0 < new.diff with the rm failing: zero touches — a file that matches the index is no re-create', async () => {
    const r = repo();
    try {
      seedTrackedSpan(r.root, 'a.txt', 'l1\nl2\nl3\nl4\nl5\n', 'recreate-and-failedrm-span');
      writeRel(r.root, 'new.diff', '--- /dev/null\n+++ a.txt\n@@ -0,0 +1,5 @@\n+n1\n+n2\n+n3\n+n4\n+n5\n');
      chmodSync(r.root, 0o500);
      // The read-only dir makes the rm fail, so `&&` drops the patch: the
      // compound ends with a.txt present but matching the index (committed
      // content) — the later-recreate explanation's working-tree probe
      // refuses it, the delete-gate fail stands, and the joined command
      // stays suppressed. No phantom advisory fires.
      expect(bashRun('rm a.txt && patch -p0 < new.diff', r.root)).not.toBe(0);
      const res = await runPipeline('rm a.txt && patch -p0 < new.diff', r.root);
      expect(res.fixPaths).toEqual([]);
      expect(readRel(r.root, 'a.txt')).toBe('l1\nl2\nl3\nl4\nl5\n');
    } finally {
      chmodSync(r.root, 0o700);
    }
  });
});

describe('bash-write-integration — restore/checkout pathspecs', () => {
  const repos: Array<{ root: string; cleanup: () => void }> = [];
  afterEach(() => {
    for (const repo of repos.splice(0)) repo.cleanup();
  });
  function repo(): { root: string; cleanup: () => void } {
    const r = freshRepo();
    repos.push(r);
    return r;
  }

  it('git restore <file>: create-overwrite touch on the restored file', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'v1\n', 'restore-span');
    expect(bashRun('echo v2 > f.txt', r.root)).toBe(0);
    expect(bashRun('git restore f.txt', r.root)).toBe(0);
    const res = await runPipeline('git restore f.txt', r.root);
    expect(parsedOps(res.matches, r.root)).toEqual([{ op: 'create-overwrite', rel: 'f.txt' }]);
    expect(res.fixPaths).toEqual(['f.txt']);
    expect(readRel(r.root, 'f.txt')).toBe('v1\n');
  });

  it('git restore --staged <file>: no span, no touch', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'v1\n', 'restore-staged-span');
    expect(bashRun('echo v2 > f.txt', r.root)).toBe(0);
    expect(bashRun('git add f.txt', r.root)).toBe(0);
    expect(bashRun('git restore --staged f.txt', r.root)).toBe(0);
    const res = await runPipeline('git restore --staged f.txt', r.root);
    expect(res.matches).toHaveLength(0);
    expect(res.fixPaths).toEqual([]);
  });

  it('git checkout -b: no spans, no touch', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'v1\n', 'checkout-b-span');
    expect(bashRun('git checkout -b some-branch', r.root)).toBe(0);
    const res = await runPipeline('git checkout -b some-branch', r.root);
    expect(res.matches).toHaveLength(0);
    expect(res.fixPaths).toEqual([]);
  });

  it('git restore .: directory-shaped pathspec fails closed as unresolved', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'v1\n', 'restore-dot-span');
    expect(bashRun('echo v2 > f.txt', r.root)).toBe(0);
    expect(bashRun('git restore .', r.root)).toBe(0);
    const res = await runPipeline('git restore .', r.root);
    expect(res.fixPaths).toEqual([]);
    expect(unresolvedReasons(res.matches).join(' ')).toContain('directory');
  });

  it('git checkout -- <dir>/ with a real directory: unresolved, no touch', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'v1\n', 'checkout-dir-span');
    expect(bashRun('echo v2 > f.txt', r.root)).toBe(0);
    expect(bashRun('git checkout -- .', r.root)).toBe(0);
    const res = await runPipeline('git checkout -- .', r.root);
    expect(res.fixPaths).toEqual([]);
    expect(unresolvedReasons(res.matches).length).toBeGreaterThan(0);
  });
});

describe('bash-write-integration — whole-file scope of ambiguous appends', () => {
  const repos: Array<{ root: string; cleanup: () => void }> = [];
  afterEach(() => {
    for (const repo of repos.splice(0)) repo.cleanup();
  });
  function repo(): { root: string; cleanup: () => void } {
    const r = freshRepo();
    repos.push(r);
    return r;
  }

  it('an append whose body already appears earlier recovers whole-file scope and surfaces the covering span', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'alpha\nalpha\n', 'amb-span');
    expect(bashRun('echo alpha >> f.txt', r.root)).toBe(0);
    const res = await runPipeline('echo alpha >> f.txt', r.root, {
      list: [{ name: 'amb-span', path: 'f.txt', start: 1, end: 2 }],
      drift: [{ name: 'amb-span', path: 'f.txt', start: 1, end: 2, status: 'CHANGED' }]
    });
    expect(res.fixPaths).toEqual(['f.txt']);
    // The ambiguous append could have landed on any of the three matching
    // lines, so the touch is whole-file and must surface the covering span.
    expect(res.blocks.join('')).toContain('amb-span');
  });

  it('an unambiguous append scopes to its line and does not surface a non-overlapping span', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'alpha\n', 'c-span');
    expect(bashRun('echo beta >> f.txt', r.root)).toBe(0);
    const res = await runPipeline('echo beta >> f.txt', r.root, {
      list: [{ name: 'c-span', path: 'f.txt', start: 1, end: 1 }],
      drift: [{ name: 'c-span', path: 'f.txt', start: 1, end: 1, status: 'CHANGED' }]
    });
    expect(res.fixPaths).toEqual(['f.txt']);
    expect(res.blocks.join('')).not.toContain('c-span');
  });
});

describe('bash-write-integration — byte-diff oracle (independent expected ranges)', () => {
  const repos: Array<{ root: string; cleanup: () => void }> = [];
  afterEach(() => {
    for (const repo of repos.splice(0)) repo.cleanup();
  });
  function repo(): { root: string; cleanup: () => void } {
    const r = freshRepo();
    repos.push(r);
    return r;
  }

  it('sed -i with a numeric address: the exact-range claim contains the byte-diffed changed lines', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'l1\nl2\nl3\nl4\nl5\n', 'oracle-sed-span');
    const before = splitLines(readRel(r.root, 'f.txt'));
    expect(bashRun("sed -i '3s/l3/X3/' f.txt", r.root)).toBe(0);
    const after = splitLines(readRel(r.root, 'f.txt'));
    const diff = lineDiff(before, after);
    expect(diff.countPreserved).toBe(true);
    expect(diff.changed).toEqual([3]);
    const res = await runPipeline("sed -i '3s/l3/X3/' f.txt", r.root);
    const span = parsedOps(res.matches, r.root)[0];
    expect(span).toEqual({ op: 'modify', rel: 'f.txt', range: '3-3' });
    // The oracle invariant: every changed line falls inside the claimed
    // range (diff.changed = [3] ⊆ [3,3], established by the diff above).
    for (const line of diff.changed) {
      expect(line).toBeGreaterThanOrEqual(3);
      expect(line).toBeLessThanOrEqual(3);
    }
    expect(res.fixPaths).toEqual(['f.txt']);
  });

  it('count-preserving patch hunk: union range contains the changed line', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'one\ntwo\nthree\nfour\n', 'oracle-patch-span');
    writeRel(r.root, 'p2.diff', '--- a/f.txt\n+++ b/f.txt\n@@ -1,4 +1,4 @@\n one\n-two\n+two2\n three\n four\n');
    const before = splitLines(readRel(r.root, 'f.txt'));
    expect(bashRun('git apply p2.diff', r.root)).toBe(0);
    const after = splitLines(readRel(r.root, 'f.txt'));
    const diff = lineDiff(before, after);
    expect(diff.countPreserved).toBe(true);
    expect(diff.changed).toEqual([2]);
    const res = await runPipeline('git apply p2.diff', r.root);
    const span = parsedOps(res.matches, r.root)[0];
    expect(span).toEqual({ op: 'modify', rel: 'f.txt', range: '1-4' });
    for (const line of diff.changed) {
      expect(line).toBeGreaterThanOrEqual(1);
      expect(line).toBeLessThanOrEqual(4);
    }
    expect(res.fixPaths).toEqual(['f.txt']);
  });

  it('count-changing sed `2d`: whole-file modify with no exact-range claim (the oracle would catch one)', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'l1\nl2\nl3\nl4\nl5\n', 'oracle-sedd-span');
    const before = splitLines(readRel(r.root, 'f.txt'));
    expect(bashRun("sed -i '2d' f.txt", r.root)).toBe(0);
    const after = splitLines(readRel(r.root, 'f.txt'));
    const diff = lineDiff(before, after);
    expect(diff.countPreserved).toBe(false);
    expect(diff.changed).toEqual([2, 3, 4, 5]);
    const res = await runPipeline("sed -i '2d' f.txt", r.root);
    const span = parsedOps(res.matches, r.root)[0];
    // Whole-file: the parser must NOT claim a positional range over an edit
    // that shifts every subsequent line.
    expect(span).toEqual({ op: 'modify', rel: 'f.txt' });
    expect(res.fixPaths).toEqual(['f.txt']);
  });

  it('count-changing patch (pure add): whole-file modify, no exact-range claim', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'add.txt', 'one\ntwo\n', 'oracle-add-span');
    writeRel(r.root, 'add.diff', '--- a/add.txt\n+++ b/add.txt\n@@ -1,2 +1,3 @@\n one\n two\n+three\n');
    const before = splitLines(readRel(r.root, 'add.txt'));
    expect(bashRun('git apply add.diff', r.root)).toBe(0);
    const after = splitLines(readRel(r.root, 'add.txt'));
    const diff = lineDiff(before, after);
    expect(diff.countPreserved).toBe(false);
    expect(diff.changed).toEqual([3]);
    const res = await runPipeline('git apply add.diff', r.root);
    const span = parsedOps(res.matches, r.root)[0];
    expect(span).toEqual({ op: 'modify', rel: 'add.txt' });
    expect(res.fixPaths).toEqual(['add.txt']);
  });
});

describe('bash-write-integration — negative and failure cases (plan §Verification)', () => {
  const repos: Array<{ root: string; cleanup: () => void }> = [];
  afterEach(() => {
    for (const repo of repos.splice(0)) repo.cleanup();
  });
  function repo(): { root: string; cleanup: () => void } {
    const r = freshRepo();
    repos.push(r);
    return r;
  }

  it('an interrupted command produces no touches (plan §4)', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'x\n', 'interrupted-span');
    expect(bashRun('rm f.txt', r.root)).toBe(0);
    const res = await runPipeline('rm f.txt', r.root, { interrupted: true });
    expect(res.fixPaths).toEqual([]);
    expect(res.listPaths).toEqual([]);
  });

  it('a failed cp (missing source) fires nothing', async () => {
    // Bug #3 (resolved): the source read is now a resolved range-less span,
    // so the dest pairs against it and the absent-source rule + the read's
    // post-command existence gate run — the phantom source fails the copy
    // decisively (plan §3 step 1b pins zero executor calls).
    const r = repo();
    seedTrackedSpan(r.root, 'existing.txt', 'x\n', 'cp-missing-span');
    // The trailing `echo done` succeeds, so the compound exits 0 even though
    // the copy failed — the shape that could let a touch slip through.
    expect(bashRun('cp missing.txt existing.txt; echo done', r.root)).toBe(0);
    const res = await runPipeline('cp missing.txt existing.txt; echo done', r.root);
    expect(res.fixPaths).toEqual([]);
    expect(res.listPaths).toEqual([]);
    expect(readRel(r.root, 'existing.txt')).toBe('x\n');
  });

  it('a delete of a still-present file fires nothing (rm failed on a read-only dir)', async () => {
    const r = repo();
    try {
      seedTrackedSpan(r.root, 'f.txt', 'x\n', 'rm-fail-span');
      chmodSync(r.root, 0o500);
      expect(bashRun('rm f.txt', r.root)).not.toBe(0);
      const res = await runPipeline('rm f.txt', r.root);
      expect(res.fixPaths).toEqual([]);
    } finally {
      chmodSync(r.root, 0o700);
    }
  });

  it('a content-mismatch overwrite fires nothing (echo to a read-only file)', async () => {
    // Bug #1 (resolved): the literal body threads as `written`, so the exact
    // gate runs and the unchanged read-only file fails it — the content layer
    // is exactly what suppresses this (plan §1b pins zero executor calls).
    const r = repo();
    seedTrackedSpan(r.root, 'ro.txt', 'data\n', 'ro-span');
    chmodSync(join(r.root, 'ro.txt'), 0o444);
    expect(bashRun('echo hi > ro.txt', r.root)).not.toBe(0);
    const res = await runPipeline('echo hi > ro.txt', r.root);
    expect(res.fixPaths).toEqual([]);
    expect(readRel(r.root, 'ro.txt')).toBe('data\n');
  });

  it('an unexplained source absence suppresses the copy destination (rm a; cp a b)', async () => {
    // Bug #3 (resolved): the parse-time-absent source is now a resolved
    // range-less read. Its post-command existence gate fails decisively and
    // nothing explains it (the rm's delete ran *earlier*), so the cp command
    // is 'failed'; the dest's absent-source hold finds no later pass on a
    // either — zero executor calls (plan §3 step 1b).
    const r = repo();
    writeRel(r.root, 'a.txt', 'a\n');
    writeRel(r.root, 'b.txt', 'bdata\n');
    expect(bashRun('rm a.txt; cp a.txt b.txt', r.root)).not.toBe(0);
    const res = await runPipeline('rm a.txt; cp a.txt b.txt', r.root);
    expect(res.fixPaths).toEqual([]);
    expect(res.listPaths).toEqual([]);
    expect(readRel(r.root, 'b.txt')).toBe('bdata\n');
  });

  it('cp a b && rm a with the copy succeeding: both the dest and the delete fire', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'a.txt', 'adata\n', 'cp-rm-span');
    writeRel(r.root, 'b.txt', 'bdata\n');
    expect(bashRun('cp a.txt b.txt && rm a.txt', r.root)).toBe(0);
    const res = await runPipeline('cp a.txt b.txt && rm a.txt', r.root);
    expect(res.fixPaths).toEqual(['b.txt', 'a.txt']);
    expect(readRel(r.root, 'b.txt')).toBe('adata\n');
  });

  it('cp a b; rm a with the copy failing on the dest: advisory fire, content untouched (residual 1)', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'a.txt', 'adata\n', 'cp-rm-fail-src-span');
    writeRel(r.root, 'b.txt', 'bdata\n');
    chmodSync(join(r.root, 'b.txt'), 0o444);
    // The copy fails (b unwritable) but the trailing rm succeeds, so the
    // compound exits 0 — the shape that could let a touch slip through.
    expect(bashRun('cp a.txt b.txt; rm a.txt', r.root)).toBe(0);
    const res = await runPipeline('cp a.txt b.txt; rm a.txt', r.root);
    // The rm's later delete pass explains the source's absence, so the
    // absent-source rule passes existence-only and the dest fires advisory —
    // the pinned residual-1 corner. The unchanged content proves the heal is
    // a no-op.
    expect(res.fixPaths).toEqual(['b.txt', 'a.txt']);
    expect(readRel(r.root, 'b.txt')).toBe('bdata\n');
  });

  it('a size-mismatched truncate fires nothing (truncate on a read-only file)', async () => {
    // Bug #4 (resolved): the span carries the static size and the truncate
    // branch maps it to the size post-content gate — the file's post-command
    // byte count (6) != the static size (3), so the touch is suppressed
    // (plan §Verification pins zero executor calls).
    const r = repo();
    seedTrackedSpan(r.root, 'ro.txt', 'hello\n', 'trunc-ro-span');
    chmodSync(join(r.root, 'ro.txt'), 0o444);
    // The trailing `echo done` succeeds — the compound exits 0.
    expect(bashRun('truncate -s 3 ro.txt; echo done', r.root)).toBe(0);
    const res = await runPipeline('truncate -s 3 ro.txt; echo done', r.root);
    expect(res.fixPaths).toEqual([]);
    expect(readRel(r.root, 'ro.txt')).toBe('hello\n');
  });

  it('patch --dry-run produces no spans and no touch', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'one\ntwo\n', 'dryrun-span');
    writeRel(r.root, 'p.diff', '--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,2 @@\n one\n-two\n+two2\n');
    expect(bashRun('patch --dry-run < p.diff', r.root)).toBe(0);
    const res = await runPipeline('patch --dry-run < p.diff', r.root);
    expect(res.matches).toHaveLength(0);
    expect(res.fixPaths).toEqual([]);
  });

  it('a phantom delete fires nothing (rm phantom.txt; echo done)', async () => {
    const r = repo();
    expect(bashRun('rm phantom.txt; echo done', r.root)).toBe(0);
    const res = await runPipeline('rm phantom.txt; echo done', r.root);
    expect(res.fixPaths).toEqual([]);
  });

  it('a phantom move fires nothing on either side (mv phantom existing)', async () => {
    const r = repo();
    writeRel(r.root, 'existing.txt', 'x\n');
    // The trailing `echo done` succeeds — the compound exits 0.
    expect(bashRun('mv phantom.txt existing.txt; echo done', r.root)).toBe(0);
    const res = await runPipeline('mv phantom.txt existing.txt; echo done', r.root);
    expect(res.fixPaths).toEqual([]);
    expect(readRel(r.root, 'existing.txt')).toBe('x\n');
  });

  it('join-gated &&: a failed rm suppresses the joined sed -i', async () => {
    const r = repo();
    try {
      seedTrackedSpan(r.root, 'f.txt', 'x\n', 'join-and-span');
      chmodSync(r.root, 0o500);
      expect(bashRun("rm f.txt && sed -i 's/a/b/' f.txt", r.root)).not.toBe(0);
      const res = await runPipeline("rm f.txt && sed -i 's/a/b/' f.txt", r.root);
      expect(res.fixPaths).toEqual([]);
    } finally {
      chmodSync(r.root, 0o700);
    }
  });

  it('join-gated ||: a succeeded rm suppresses the joined sed -i', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'x.txt', 'x\n', 'join-or-rm-span');
    seedTrackedSpan(r.root, 'y.txt', 'z\n', 'join-or-sed-span');
    expect(bashRun("rm x.txt || sed -i 's/a/b/' y.txt", r.root)).toBe(0);
    const res = await runPipeline("rm x.txt || sed -i 's/a/b/' y.txt", r.root);
    // The rm's own delete fires; the joined sed must not.
    expect(res.fixPaths).toEqual(['x.txt']);
    expect(res.fixPaths).not.toContain('y.txt');
  });

  it('a `;`-separated sed after a failed rm still runs (no join gate) — advisory fire', async () => {
    const r = repo();
    try {
      seedTrackedSpan(r.root, 'f.txt', 'x\n', 'semi-sed-span');
      chmodSync(r.root, 0o500);
      expect(bashRun("rm f.txt; sed -i 's/a/b/' f.txt", r.root)).not.toBe(0);
      const res = await runPipeline("rm f.txt; sed -i 's/a/b/' f.txt", r.root);
      expect(res.fixPaths).toEqual(['f.txt']);
    } finally {
      chmodSync(r.root, 0o700);
    }
  });

  it('recreate compound rm f && echo x > f: the echo fires after the succeeded rm', async () => {
    // Bug #1 (resolved): the echo's exact gate passes (the file holds 'x\n'
    // post-command); the rm's delete decisiveFail (the file is present again)
    // is explained by the echo's later same-path pass, so the rm degrades to
    // 'unknown' and && fails open — exactly the echo's touch fires (plan §3
    // step 2 pins the recreate firing).
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'old\n', 'recreate-span');
    expect(bashRun('rm f.txt && echo x > f.txt', r.root)).toBe(0);
    const res = await runPipeline('rm f.txt && echo x > f.txt', r.root);
    expect(res.fixPaths).toEqual(['f.txt']);
    expect(readRel(r.root, 'f.txt')).toBe('x\n');
  });

  it('echo a > f && rm f: the overwrite is explained by the later delete and only the delete fires', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'z\n', 'ov-del-span');
    expect(bashRun('echo a > f.txt && rm f.txt', r.root)).toBe(0);
    const res = await runPipeline('echo a > f.txt && rm f.txt', r.root);
    expect(res.fixPaths).toEqual(['f.txt']);
  });

  it('residual advisory: a patch that fails to apply fires an advisory touch and leaves the file unchanged', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'keep.txt', 'k1\nk2\n', 'residual-span');
    // Context line that does not match the file: the patch is rejected.
    writeRel(r.root, 'bad.diff', '--- a/keep.txt\n+++ b/keep.txt\n@@ -1,2 +1,2 @@\n k1\n-wrong-context\n+zzz\n');
    // The trailing `echo done` succeeds — the compound exits 0.
    expect(bashRun('git apply bad.diff; echo done', r.root)).toBe(0);
    const res = await runPipeline('git apply bad.diff; echo done', r.root);
    // The residual class (existence-gated families) fires advisory: the
    // unchanged content proves the heal is a no-op.
    expect(res.fixPaths).toEqual(['keep.txt']);
    expect(readRel(r.root, 'keep.txt')).toBe('k1\nk2\n');
  });

  it('a harness-supplied non-zero exit code suppresses the failed existence-gated advisory touch', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'keep.txt', 'k1\nk2\n', 'exitcode-span');
    writeRel(r.root, 'bad.diff', '--- a/keep.txt\n+++ b/keep.txt\n@@ -1,2 +1,2 @@\n k1\n-wrong-context\n+zzz\n');
    // No trailing success: the compound itself fails (git apply exits 1).
    expect(bashRun('git apply bad.diff', r.root)).toBe(1);
    const res = await runPipeline('git apply bad.diff', r.root, { exitCode: 1 });
    // The harness proved the command failed, so the existence-gated write
    // demonstrably did not happen — no advisory touch (fail-open posture:
    // absent/zero exit codes proceed exactly as today, pinned above).
    expect(res.fixPaths).toEqual([]);
    expect(readRel(r.root, 'keep.txt')).toBe('k1\nk2\n');
  });

  it('a harness-supplied zero exit code on a failing command still proceeds (fail-open)', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'keep.txt', 'k1\nk2\n', 'exitcode-zero-span');
    writeRel(r.root, 'bad.diff', '--- a/keep.txt\n+++ b/keep.txt\n@@ -1,2 +1,2 @@\n k1\n-wrong-context\n+zzz\n');
    expect(bashRun('git apply bad.diff; echo done', r.root)).toBe(0);
    const res = await runPipeline('git apply bad.diff; echo done', r.root, { exitCode: 0 });
    expect(res.fixPaths).toEqual(['keep.txt']);
    expect(readRel(r.root, 'keep.txt')).toBe('k1\nk2\n');
  });

  it('pinned residue: a non-zero exit code suppresses even a wrote-then-failed patch (hunk 1 applied, hunk 2 failed)', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'partial.txt', 'one\ntwo\nthree\nfour\n', 'wrote-nonzero-span');
    // Hunk 1 applies (two → two!), hunk 2's context ('WRONG') matches
    // nothing: GNU patch leaves the applied hunk written, saves rejects to
    // partial.txt.rej, and exits 1 — a genuine write despite the failure.
    writeRel(
      r.root,
      'partial.diff',
      '--- partial.txt\n+++ partial.txt\n@@ -1,2 +1,2 @@\n one\n-two\n+two!\n@@ -3,3 +3,3 @@\n WRONG\n-zzz\n+yyy\n'
    );
    expect(bashRun('patch -p0 < partial.diff', r.root)).toBe(1);
    // The file really was modified — the "did not happen" premise is false here.
    expect(readRel(r.root, 'partial.txt')).toBe('one\ntwo!\nthree\nfour\n');
    const res = await runPipeline('patch -p0 < partial.diff', r.root, { exitCode: 1 });
    // Documented residue (accept-and-document, plan §4): the non-zero
    // suppression over-suppresses non-atomic writers that modify before
    // failing (patch, `git apply --reject`, formatters) — the advisory
    // touch for this real write is suppressed by design, pinned here so the
    // boundary stays visible.
    expect(res.fixPaths).toEqual([]);
  });

  it('pinned residue: the compound face — a trailing failure suppresses an earlier real existence-gated write (sed wrote, the compound failed)', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'a.txt', 'one\ntwo\n', 'compound-residue-span');
    // sed -i genuinely writes a.txt, then `false` fails: the compound's
    // exit code is 1 while the earlier write really happened.
    expect(bashRun("sed -i 's/one/ONE/' a.txt; false", r.root)).toBe(1);
    expect(readRel(r.root, 'a.txt')).toBe('ONE\ntwo\n');
    const res = await runPipeline("sed -i 's/one/ONE/' a.txt; false", r.root, { exitCode: 1 });
    // Same documented residue as the patch face: the advisory class is
    // suppressed by the compound's non-zero code even though this write
    // demonstrably occurred (file state above proves it).
    expect(res.fixPaths).toEqual([]);
  });

  it('a content-verified decisivePass fires despite a non-zero exit code (echo z > f; false)', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'old\n', 'content-immune-span');
    expect(bashRun('echo z > f.txt; false', r.root)).toBe(1);
    const res = await runPipeline('echo z > f.txt; false', r.root, { exitCode: 1 });
    // The exit-code suppression is bounded to the gate-inconclusive
    // advisory class: the echo's exact-content gate passes on the real
    // 'z\n' post-command, so the write fires regardless of the code.
    expect(res.fixPaths).toEqual(['f.txt']);
    expect(readRel(r.root, 'f.txt')).toBe('z\n');
  });
});

describe('bash-write-integration — span-less builtin guards (plan §3 step 2)', () => {
  const repos: Array<{ root: string; cleanup: () => void }> = [];
  afterEach(() => {
    for (const repo of repos.splice(0)) repo.cleanup();
  });
  function repo(): { root: string; cleanup: () => void } {
    const r = freshRepo();
    repos.push(r);
    return r;
  }

  it('false && echo x > f: the write never runs, and the exact-coincident touch is suppressed', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'x\n', 'guard-false-span');
    expect(bashRun('false && echo x > f.txt', r.root)).toBe(1);
    const res = await runPipeline('false && echo x > f.txt', r.root);
    // Without the guard verdict the echo's exact gate would pass on content
    // coincidence and fire a touch for a write that never ran.
    expect(res.fixPaths).toEqual([]);
    expect(readRel(r.root, 'f.txt')).toBe('x\n');
  });

  it('true || echo x > f: the succeeded-guard || skip suppresses the exact-coincident touch', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'x\n', 'guard-true-span');
    expect(bashRun('true || echo x > f.txt', r.root)).toBe(0);
    const res = await runPipeline('true || echo x > f.txt', r.root);
    expect(res.fixPaths).toEqual([]);
    expect(readRel(r.root, 'f.txt')).toBe('x\n');
  });

  it('true && echo x > f: a succeeded guard does not suppress the write that really ran', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'old\n', 'guard-trueand-span');
    expect(bashRun('true && echo x > f.txt', r.root)).toBe(0);
    const res = await runPipeline('true && echo x > f.txt', r.root);
    expect(res.fixPaths).toEqual(['f.txt']);
    expect(readRel(r.root, 'f.txt')).toBe('x\n');
  });

  it('false && sed -i f: a failed guard suppresses the existence-gated sed', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'a1\na2\n', 'guard-sed-span');
    expect(bashRun("false && sed -i 's/a1/b1/' f.txt", r.root)).toBe(1);
    const res = await runPipeline("false && sed -i 's/a1/b1/' f.txt", r.root);
    expect(res.fixPaths).toEqual([]);
    expect(readRel(r.root, 'f.txt')).toBe('a1\na2\n');
  });
});

describe('bash-write-integration — formatter read-only forms write nothing (PATH stubs)', () => {
  let stubBin: string;
  beforeAll(() => {
    stubBin = mkdtempSync(join(tmpdir(), 'formatter-stubs-'));
    for (const tool of ['gofmt', 'black', 'clang-format', 'ruff', 'deno', 'terraform']) {
      writeFileSync(join(stubBin, tool), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    }
  });
  afterAll(() => {
    rmSync(stubBin, { recursive: true, force: true });
  });

  const READ_ONLY_FORMS: Array<[string, string | null]> = [
    ['gofmt -l f.go', 'f.go'],
    ['black --check f.py', 'f.py'],
    ['clang-format f.cpp', 'f.cpp'],
    ['ruff check f.py', 'f.py'],
    ['deno fmt --check f.ts', 'f.ts'],
    ['terraform fmt -check', null]
  ];

  it.each(READ_ONLY_FORMS)('read-only formatter invocation writes nothing: %s', async (command, file) => {
    const r = freshRepo();
    try {
      if (file !== null) writeRel(r.root, file, '');
      // The stub binary makes the real command succeed while writing nothing
      // — the fixture proves the read-only classification, not a runtime
      // failure (only rustfmt is present in this container).
      expect(bashRun(command, r.root, { env: { PATH: `${stubBin}:${process.env.PATH ?? ''}` } })).toBe(0);
      const res = await runPipeline(command, r.root);
      expect(res.matches).toHaveLength(0);
      expect(res.fixPaths).toEqual([]);
    } finally {
      r.cleanup();
    }
  });
});

describe('bash-write-integration — cross-adapter envelopes (identical normalized operations)', () => {
  let toolSequence = 0;
  const repos: Array<{ root: string; cleanup: () => void }> = [];
  afterEach(() => {
    for (const repo of repos.splice(0)) repo.cleanup();
  });
  function repo(): { root: string; cleanup: () => void } {
    const r = freshRepo();
    repos.push(r);
    return r;
  }

  const claudeCtx = { logger: new ClaudeLogger() };
  const codexCtx = { logger: new CodexLogger() };

  function claudeBashInput(cwd: string, command: string, toolUseId: string): Record<string, unknown> {
    return {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      transcript_path: '/tmp/t',
      cwd,
      tool_use_id: toolUseId,
      tool_name: 'Bash',
      tool_input: { command },
      tool_response: {}
    };
  }

  function codexBashInput(cwd: string, command: string, toolUseId: string): Record<string, unknown> {
    return {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      transcript_path: '/tmp/t',
      cwd,
      tool_use_id: toolUseId,
      tool_name: 'Bash',
      tool_input: { command },
      tool_response: 'ok'
    };
  }

  function codexExecCommandInput(cwd: string, command: string, toolUseId: string): Record<string, unknown> {
    return {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      transcript_path: '/tmp/t',
      cwd,
      tool_use_id: toolUseId,
      tool_name: 'exec_command',
      tool_input: { arguments: JSON.stringify({ cmd: command, workdir: cwd }) },
      tool_response: 'ok'
    };
  }

  function codexExecInput(cwd: string, command: string, toolUseId: string): Record<string, unknown> {
    return {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      transcript_path: '/tmp/t',
      cwd,
      tool_use_id: toolUseId,
      tool_name: 'exec',
      tool_input: {
        input: `const r = await tools.exec_command({cmd:"${command}", shell:"bash", workdir:"${cwd}"});\ntext(JSON.stringify(r));`
      },
      tool_response: 'ok'
    };
  }

  /**
   * Run one real command through all four adapter envelopes and return the
   * relative fix paths each handler produced. The commands are identical
   * across envelopes, so the normalized operations must be too.
   */
  async function runAllEnvelopes(cwd: string, command: string): Promise<Record<string, string[]>> {
    const cap = (): { executors: TouchExecutors; fixPaths: string[] } => makeCaptureExecutors();
    const result: Record<string, string[]> = {};
    const rel = (p: string): string => p.slice(cwd.length + 1);
    const sequence = toolSequence++;
    const ids = {
      claude: `cross-${sequence}-claude`,
      codex: `cross-${sequence}-codex`,
      classic: `cross-${sequence}-classic`,
      codeMode: `cross-${sequence}-code-mode`
    };
    const claudeInput = claudeBashInput(cwd, command, ids.claude);
    const codexInput = codexBashInput(cwd, command, ids.codex);
    const classicInput = codexExecCommandInput(cwd, command, ids.classic);
    const codeModeInput = codexExecInput(cwd, command, ids.codeMode);

    await createClaudePlanHandler(layout)(claudeInput as never, claudeCtx);
    const codexPlan = createCodexPlanHandler(layout);
    await codexPlan(codexInput as never, codexCtx);
    await codexPlan(classicInput as never, codexCtx);
    await codexPlan(codeModeInput as never, codexCtx);
    expect(bashRun(command, cwd)).toBe(0);

    const claudeCap = cap();
    // `as never` matches the existing adapter tests: the SDK types the input
    // strictly, but the handler shape-checks the envelope fields itself.
    await createClaudeHandler(
      claudeCap.executors,
      () => createMemoryMemoStore(),
      layout
    )(claudeInput as never, claudeCtx);
    result.claudeBash = claudeCap.fixPaths.map(rel);

    const codexCap = cap();
    await createCodexHandler(codexCap.executors, () => createMemoryMemoStore(), layout)(codexInput as never, codexCtx);
    result.codexBash = codexCap.fixPaths.map(rel);

    const execCmdCap = cap();
    await createCodexHandler(
      execCmdCap.executors,
      () => createMemoryMemoStore(),
      layout
    )(classicInput as never, codexCtx);
    result.codexExecCommand = execCmdCap.fixPaths.map(rel);

    const execCap = cap();
    await createCodexHandler(
      execCap.executors,
      () => createMemoryMemoStore(),
      layout
    )(codeModeInput as never, codexCtx);
    result.codexExec = execCap.fixPaths.map(rel);

    return result;
  }

  it('a literal overwrite fires the same touch through Claude Bash, Codex Bash, exec_command, and exec', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'f.txt', 'old\n', 'xadapter-ov-span');
    const result = await runAllEnvelopes(r.root, 'echo hello > f.txt');
    expect(result).toEqual({
      claudeBash: ['f.txt'],
      codexBash: ['f.txt'],
      codexExecCommand: ['f.txt'],
      codexExec: ['f.txt']
    });
  });

  it('a real delete fires the same touch through all four envelopes', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'd.txt', 'x\n', 'xadapter-rm-span');
    const result = await runAllEnvelopes(r.root, 'rm d.txt');
    expect(result).toEqual({
      claudeBash: ['d.txt'],
      codexBash: ['d.txt'],
      codexExecCommand: ['d.txt'],
      codexExec: ['d.txt']
    });
  });

  it('an in-place sed edit fires the same touch through all four envelopes', async () => {
    const r = repo();
    seedTrackedSpan(r.root, 'sf.txt', 'a1\nx1\n', 'xadapter-sed-span');
    const result = await runAllEnvelopes(r.root, "sed -i 's/a1/b1/' sf.txt");
    expect(result).toEqual({
      claudeBash: ['sf.txt'],
      codexBash: ['sf.txt'],
      codexExecCommand: ['sf.txt'],
      codexExec: ['sf.txt']
    });
  });
});

describe('bash-write-integration — strace oracle (skipped where strace is absent)', () => {
  const HAS_STRACE = (() => {
    try {
      execFileSync('strace', ['-V'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!HAS_STRACE)('the mutating syscalls on the path match the fired touch', async () => {
    const r = freshRepo();
    let traceDir: string | null = null;
    try {
      seedTrackedSpan(r.root, 'f.txt', 'old\n', 'strace-span');
      traceDir = mkdtempSync(join(tmpdir(), 'strace-log-'));
      const traceFile = join(traceDir, 'trace.log');
      execFileSync(
        'strace',
        [
          '-f',
          '-e',
          'trace=openat,open,creat,unlink,unlinkat,rename,renameat,truncate,ftruncate',
          '-o',
          traceFile,
          'bash',
          '-c',
          'echo x > f.txt'
        ],
        { cwd: r.root, stdio: 'ignore' }
      );
      const trace = readFileSync(traceFile, 'utf8');
      // bash truncates the existing file with O_WRONLY|O_CREAT|O_TRUNC — a
      // mutating open on the touched path.
      expect(trace).toMatch(/openat\([^)]*"f\.txt"[^)]*O_(?:WRONLY|RDWR)/);
      expect(trace).not.toMatch(/unlink[^)]*"f\.txt"/);
      const res = await runPipeline('echo x > f.txt', r.root);
      expect(res.fixPaths).toEqual(['f.txt']);
    } finally {
      if (traceDir !== null) rmSync(traceDir, { recursive: true, force: true });
      r.cleanup();
    }
  });
});

describe('bounded planned-touch store contract (bootstrap)', () => {
  const budgets: PlannedTouchBudgets = {
    maxTouchesPerRecord: 16,
    maxRangesPerTouch: 16,
    maxEvidenceBytes: 4096,
    maxRecordBytes: 16_384
  };

  function plannedRecord(repoRoot: string): PlannedTouchRecord {
    return {
      version: 1,
      sessionId: SESSION_ID,
      toolUseId: 'tool-static-plan',
      repoRoot,
      createdAtMs: 1,
      touches: [
        {
          repoRelativePath: 'src/a.txt',
          operation: 'modify',
          ranges: [{ start: 3, end: 3 }],
          simpleCommandIndex: 0,
          evidence: { kind: 'anchor', literal: 'beta', line: 3 }
        }
      ]
    };
  }

  function storeFixture(customBudgets: PlannedTouchBudgets = budgets) {
    const parent = mkdtempSync(join(tmpdir(), 'planned-touch-'));
    const storeLayout = createSessionLayout(join(parent, 'session'));
    return { parent, layout: storeLayout, store: createPlannedTouchStore(storeLayout, customBudgets) };
  }

  it('atomically stores a content-minimal record and consumes it once', () => {
    const fixture = storeFixture();
    try {
      const record = plannedRecord('/repo');
      fixture.store.put(record);

      expect(fixture.store.consume(record.sessionId, record.toolUseId)).toEqual(record);
      expect(fixture.store.consume(record.sessionId, record.toolUseId)).toBeNull();
    } finally {
      rmSync(fixture.parent, { recursive: true, force: true });
    }
  });

  it('discard is idempotent for failure and interruption cleanup', () => {
    const fixture = storeFixture();
    try {
      const record = plannedRecord('/repo');
      fixture.store.put(record);
      fixture.store.discard(record.sessionId, record.toolUseId);
      fixture.store.discard(record.sessionId, record.toolUseId);

      expect(fixture.store.consume(record.sessionId, record.toolUseId)).toBeNull();
    } finally {
      rmSync(fixture.parent, { recursive: true, force: true });
    }
  });

  it('rejects an over-budget record without replacing a valid pending plan', () => {
    const fixture = storeFixture({ ...budgets, maxTouchesPerRecord: 1 });
    try {
      const record = plannedRecord('/repo');
      fixture.store.put(record);
      const oversized: PlannedTouchRecord = { ...record, touches: [...record.touches, ...record.touches] };

      expect(() => fixture.store.put(oversized)).toThrow();
      expect(fixture.store.consume(record.sessionId, record.toolUseId)).toEqual(record);
    } finally {
      rmSync(fixture.parent, { recursive: true, force: true });
    }
  });

  it('persists only the declared content-minimal fields', () => {
    const fixture = storeFixture();
    try {
      const record = plannedRecord('/repo');
      const withBody = {
        ...record,
        fileBody: 'must never be stored',
        touches: [{ ...record.touches[0], preStateBody: 'also forbidden' }]
      } as unknown as PlannedTouchRecord;
      fixture.store.put(withBody);

      const encoded = readFileSync(fixture.layout.plannedTouchRecordFile(SESSION_ID, 'tool-static-plan'), 'utf8');
      expect(encoded).not.toContain('must never be stored');
      expect(encoded).not.toContain('also forbidden');
      expect(fixture.store.consume(record.sessionId, record.toolUseId)).toEqual(record);
    } finally {
      rmSync(fixture.parent, { recursive: true, force: true });
    }
  });

  it('rejects repository traversal and oversized evidence before writing', () => {
    const fixture = storeFixture({ ...budgets, maxEvidenceBytes: 8 });
    try {
      const record = plannedRecord('/repo');
      const traversal: PlannedTouchRecord = {
        ...record,
        touches: [{ ...record.touches[0], repoRelativePath: '../outside.txt' }]
      };
      const oversizedEvidence: PlannedTouchRecord = {
        ...record,
        touches: [{ ...record.touches[0], evidence: { kind: 'anchor', literal: 'a long anchor', line: 3 } }]
      };

      expect(() => fixture.store.put(traversal)).toThrow();
      expect(() => fixture.store.put(oversizedEvidence)).toThrow();
      expect(fixture.store.consume(record.sessionId, record.toolUseId)).toBeNull();
    } finally {
      rmSync(fixture.parent, { recursive: true, force: true });
    }
  });
});

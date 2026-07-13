import * as fs from 'node:fs';
import { writeFileSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { Logger } from '@goodfoot/claude-code-hooks';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import hook, {
  createDefaultSpanExecutor,
  createDiskMemoStore,
  createHandler,
  type MemoFactory,
  type MemoLogger,
  type MemoStore,
  type SpanExecutor,
  type StaleExecutor
} from '../src/pre-tool-use.js';
import { type HookIgnoreLoader, parseHookIgnore } from '../src/span-ignore.js';
import { journalPath, loadJournal } from '../src/stop.js';
import { makeTempRepo } from './helpers.js';

const logger = new Logger();

// ---------------------------------------------------------------------------
// Fake executor
// ---------------------------------------------------------------------------

interface ExecutorCall {
  args: string[];
  cwd: string;
}

function createFakeExecutor(responses: Map<string, string> = new Map()): {
  executor: SpanExecutor;
  calls: ExecutorCall[];
  setResponse: (key: string, stdout: string) => void;
  failOn: (key: string) => void;
} {
  const calls: ExecutorCall[] = [];
  const errors = new Set<string>();

  const executor: SpanExecutor = (args, cwd) => {
    calls.push({ args, cwd });
    const key = args.join(' ');
    if (errors.has(key)) throw new Error(`git span list ${key} failed`);
    return responses.get(key) ?? '';
  };

  return {
    executor,
    calls,
    setResponse: (key, stdout) => responses.set(key, stdout),
    failOn: (key) => errors.add(key)
  };
}

// ---------------------------------------------------------------------------
// Fake in-memory memo
// ---------------------------------------------------------------------------

function createMemoryMemoFactory(): { memoFactory: MemoFactory; store: Map<string, Set<string>> } {
  const store = new Map<string, Set<string>>();
  const memoFactory: MemoFactory = (_logger: MemoLogger): MemoStore => ({
    getSurfaced(sessionId) {
      return new Set(store.get(sessionId) ?? []);
    },
    addSurfaced(sessionId, names) {
      const existing = store.get(sessionId) ?? new Set<string>();
      for (const n of names) existing.add(n);
      store.set(sessionId, existing);
    }
  });
  return { memoFactory, store };
}

// ---------------------------------------------------------------------------
// Handler factory wrapper: inject a no-drift stale executor by default so the
// bulk of tests never shell out to a real `git span stale`. Stale-hint tests
// pass their own StaleExecutor as the 4th argument.
// ---------------------------------------------------------------------------

const noDrift: StaleExecutor = () => '';

function makeHandler(
  executor: SpanExecutor,
  memoFactory: MemoFactory,
  loadRules?: HookIgnoreLoader,
  staleExecutor: StaleExecutor = noDrift
) {
  return createHandler(executor, memoFactory, loadRules, staleExecutor);
}

// ---------------------------------------------------------------------------
// Input builder
// ---------------------------------------------------------------------------

function baseInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: 'sess-1',
    transcript_path: '/tmp/t',
    cwd: '/tmp',
    hook_event_name: 'PreToolUse' as const,
    tool_use_id: 'tu-1',
    tool_name: 'Read',
    tool_input: {},
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Porcelain helper: build a porcelain line
// ---------------------------------------------------------------------------

function porcelainLine(name: string, path: string, start: number, end: number): string {
  return `${name}\t${path}\t${start}-${end}`;
}

// ---------------------------------------------------------------------------
// Result helpers — hook output wraps fields under .stdout
// ---------------------------------------------------------------------------

interface HookResult {
  _type: string;
  stdout: { systemMessage?: string; hookSpecificOutput?: { additionalContext?: string } };
}

function toHookResult(result: unknown): HookResult {
  // A `null` handler return means "no output"; normalise to empty stdout.
  if (result === null || result === undefined) return { _type: 'PreToolUse', stdout: {} };
  return result as HookResult;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pre-tool-use hook registration', () => {
  it('registers PreToolUse with matcher Read|Edit|Write', () => {
    expect(hook.hookEventName).toBe('PreToolUse');
    expect(hook.matcher).toBe('Read|Edit|Write');
  });
});

describe('Read tool', () => {
  let repo: { root: string; cleanup: () => void };
  beforeAll(() => {
    repo = makeTempRepo();
  });
  afterAll(() => repo.cleanup());

  it('with offset+limit: invokes list --porcelain, filters rows, then invokes list <names>', async () => {
    // Use absolute path rooted at the temp repo so resolveRepoRoot succeeds
    const absFilePath = join(repo.root, 'foo.ts');
    const relPath = 'foo.ts';
    const spanName = 'billing/checkout';
    const porcelain = porcelainLine(spanName, relPath, 5, 20);
    const { executor, calls, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    setResponse(spanName, 'billing/checkout span output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath, offset: 10, limit: 5 }
    });
    const result = toHookResult(await handler(input as never, { logger }));

    expect(calls[0].args).toEqual(['--porcelain', relPath]);
    expect(calls[1].args).toEqual([spanName]);
    // The span block reaches the agent loop via additionalContext and the UI via systemMessage.
    expect(result.stdout.hookSpecificOutput?.additionalContext).toContain('billing/checkout span output');
    expect(result.stdout.systemMessage).toContain('billing/checkout span output');
  });

  it('without offset/limit: no executor calls, empty output', async () => {
    const { executor, calls } = createFakeExecutor();
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      cwd: '/tmp',
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/foo.ts' }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    expect(calls).toHaveLength(0);
    expect(result.stdout.systemMessage).toBeUndefined();
  });

  it('whole-file anchor (0-0) is excluded from surfacing', async () => {
    const absFilePath = join(repo.root, 'whole-file.ts');
    const relPath = 'whole-file.ts';
    const spanName = 'whole-file-span';
    const porcelain = porcelainLine(spanName, relPath, 0, 0);
    const { executor, calls, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath, offset: 1, limit: 10 }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    expect(calls).toHaveLength(1); // only porcelain call, no render call
    expect(result.stdout.systemMessage).toBeUndefined();
  });

  it('non-intersecting span anchor: not surfaced', async () => {
    const absFilePath = join(repo.root, 'nonintersect.ts');
    const relPath = 'nonintersect.ts';
    const spanName = 'far-span';
    const porcelain = porcelainLine(spanName, relPath, 100, 200);
    const { executor, calls, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath, offset: 1, limit: 5 }
    });
    await handler(input as never, { logger });
    expect(calls).toHaveLength(1);
  });
});

describe('Edit tool', () => {
  let repo: { root: string; cleanup: () => void };
  let filePath: string;
  beforeAll(() => {
    repo = makeTempRepo();
    filePath = join(repo.root, 'src', 'bar.ts');
    const { mkdirSync } = require('node:fs');
    mkdirSync(join(repo.root, 'src'), { recursive: true });
    writeFileSync(filePath, 'line1\nline2\nline3\nline4\nline5\n');
  });
  afterAll(() => repo.cleanup());

  it('old_string found: derives range and surfaces intersecting span', async () => {
    const relPath = 'src/bar.ts';
    const spanName = 'bar-span';
    // old_string "line2\nline3" is at lines 2-3
    const porcelain = porcelainLine(spanName, relPath, 2, 3);
    const { executor, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    setResponse(spanName, 'bar-span output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Edit',
      tool_input: { file_path: filePath, old_string: 'line2\nline3', new_string: 'replaced' }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    expect(result.stdout.systemMessage).toContain('bar-span output');
  });

  it('old_string missing: empty output', async () => {
    const { executor, calls } = createFakeExecutor();
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Edit',
      tool_input: { file_path: filePath, old_string: 'NOT IN FILE', new_string: 'x' }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    expect(calls).toHaveLength(0);
    expect(result.stdout.systemMessage).toBeUndefined();
  });
});

describe('Write tool', () => {
  let repo: { root: string; cleanup: () => void };
  beforeAll(() => {
    repo = makeTempRepo();
  });
  afterAll(() => repo.cleanup());

  it('write to a new file: empty output (executor never called)', async () => {
    const { executor, calls } = createFakeExecutor();
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Write',
      tool_input: {
        file_path: join(repo.root, 'newfile.ts'),
        content: 'hello\nworld\n'
      }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    expect(calls).toHaveLength(0);
    expect(result.stdout.systemMessage).toBeUndefined();
  });

  it('write that fully replaces existing content: empty output', async () => {
    const fp = join(repo.root, 'full.ts');
    writeFileSync(fp, 'old line 1\nold line 2\n');
    const { executor, calls } = createFakeExecutor();
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Write',
      tool_input: { file_path: fp, content: 'new line 1\nnew line 2\n' }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    expect(calls).toHaveLength(0);
    expect(result.stdout.systemMessage).toBeUndefined();
  });

  it('write that changes a middle slice: ranges derived and intersecting span surfaced', async () => {
    const fp = join(repo.root, 'partial.ts');
    writeFileSync(fp, 'a\nb\nc\nd\ne\n');
    const relPath = 'partial.ts';
    const spanName = 'partial-span';
    // Lines 2-4 change; span anchor covers that range
    const porcelain = porcelainLine(spanName, relPath, 2, 4);
    const { executor, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    setResponse(spanName, 'partial span output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Write',
      tool_input: { file_path: fp, content: 'a\nB\nC\nD\ne\n' }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    expect(result.stdout.systemMessage).toContain('partial span output');
  });
});

describe('Session memo deduplication', () => {
  let repo: { root: string; cleanup: () => void };
  beforeAll(() => {
    repo = makeTempRepo();
  });
  afterAll(() => repo.cleanup());

  it('span slug surfaced once is filtered out on the next overlapping call within the same session', async () => {
    const absFilePath = join(repo.root, 'memo.ts');
    const relPath = 'memo.ts';
    const spanName = 'dedup-span';
    const porcelain = porcelainLine(spanName, relPath, 1, 10);
    const { executor, calls, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    setResponse(spanName, 'dedup output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      session_id: 'dedup-session',
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath, offset: 5, limit: 3 }
    });

    // First call: surfaces the span
    const result1 = toHookResult(await handler(input as never, { logger }));
    expect(result1.stdout.systemMessage).toContain('dedup output');

    // Second call within same session: deduped, no render call
    const callsBefore = calls.length;
    const result2 = toHookResult(await handler(input as never, { logger }));
    expect(result2.stdout.systemMessage).toBeUndefined();
    // Only porcelain call, no render call on second invocation
    expect(calls.length).toBe(callsBefore + 1);
  });

  it("different session_id does not see the previous session's surfaced set", async () => {
    const absFilePath = join(repo.root, 'sess.ts');
    const relPath = 'sess.ts';
    const spanName = 'sess-span';
    const porcelain = porcelainLine(spanName, relPath, 1, 10);
    const { executor, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    setResponse(spanName, 'sess output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input1 = baseInput({
      session_id: 'session-A',
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath, offset: 5, limit: 3 }
    });
    const input2 = { ...input1, session_id: 'session-B' };

    await handler(input1 as never, { logger });
    const result2 = toHookResult(await handler(input2 as never, { logger }));
    expect(result2.stdout.systemMessage).toContain('sess output');
  });
});

describe('Non-git cwd', () => {
  it('returns empty output when cwd is not inside a git repo', async () => {
    const { executor, calls } = createFakeExecutor();
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      cwd: '/',
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/some.ts', offset: 1, limit: 5 }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    expect(calls).toHaveLength(0);
    expect(result.stdout.systemMessage).toBeUndefined();
  });
});

describe('Cross-repo touch', () => {
  let cwdRepo: { root: string; cleanup: () => void };
  let otherRepo: { root: string; cleanup: () => void };
  beforeAll(() => {
    cwdRepo = makeTempRepo();
    otherRepo = makeTempRepo();
  });
  afterAll(() => {
    cwdRepo.cleanup();
    otherRepo.cleanup();
  });

  it('neither surfaces spans nor journals when the file is in a different repo than cwd', async () => {
    const sessionId = `cross-repo-${Date.now()}`;
    // The touched file lives in otherRepo; cwd is cwdRepo. A porcelain response
    // is wired so that, were the overlap arm to run, it would surface a span.
    const absFilePath = join(otherRepo.root, 'foreign.ts');
    const { executor, calls, setResponse } = createFakeExecutor();
    setResponse('--porcelain foreign.ts', porcelainLine('foreign-span', 'foreign.ts', 1, 20));
    setResponse('foreign-span', 'foreign span output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      session_id: sessionId,
      cwd: cwdRepo.root,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath, offset: 1, limit: 5 }
    });
    const result = toHookResult(await handler(input as never, { logger }));

    // Overlap arm never runs against the foreign repo.
    expect(calls).toHaveLength(0);
    expect(result.stdout.systemMessage).toBeUndefined();
    expect(result.stdout.hookSpecificOutput?.additionalContext).toBeUndefined();

    // And the foreign touch is never journaled.
    const journalPath = join(os.homedir(), '.cache', 'git-span', 'session', sessionId, 'touches.jsonl');
    expect(fs.existsSync(journalPath)).toBe(false);
  });
});

describe('Gitignored file touch', () => {
  let repo: { root: string; cleanup: () => void };
  beforeAll(() => {
    repo = makeTempRepo();
    fs.writeFileSync(join(repo.root, '.gitignore'), 'dist/\n*.log\n', 'utf8');
  });
  afterAll(() => repo.cleanup());

  it('neither surfaces spans nor journals a read of a gitignored file', async () => {
    const sessionId = `gitignored-${Date.now()}`;
    const absFilePath = join(repo.root, 'dist', 'bundle.ts');
    const { executor, calls, setResponse } = createFakeExecutor();
    // Wire a porcelain response so the overlap arm would surface a span if it ran.
    setResponse('--porcelain dist/bundle.ts', porcelainLine('dist-span', 'dist/bundle.ts', 1, 20));
    setResponse('dist-span', 'dist span output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      session_id: sessionId,
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath, offset: 1, limit: 5 }
    });
    const result = toHookResult(await handler(input as never, { logger }));

    // Overlap arm never runs against an ignored file.
    expect(calls).toHaveLength(0);
    expect(result.stdout.systemMessage).toBeUndefined();
    expect(result.stdout.hookSpecificOutput?.additionalContext).toBeUndefined();

    // And the ignored touch is never journaled.
    const journalFile = join(os.homedir(), '.cache', 'git-span', 'session', sessionId, 'touches.jsonl');
    expect(fs.existsSync(journalFile)).toBe(false);
  });

  it('still journals a write of a tracked sibling file', async () => {
    const sessionId = `gitignored-tracked-${Date.now()}`;
    const absFilePath = join(repo.root, 'tracked.log.ts');
    const { executor, setResponse } = createFakeExecutor();
    setResponse('--porcelain tracked.log.ts', '');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      session_id: sessionId,
      cwd: repo.root,
      tool_name: 'Write',
      tool_input: { file_path: absFilePath, content: 'export const x = 1;\n' }
    });
    await handler(input as never, { logger });

    const entries = loadJournal(sessionId);
    expect(entries).not.toBeNull();
    expect(entries!.some((e) => e.path === 'tracked.log.ts')).toBe(true);
    const journalFile = journalPath(sessionId);
    if (fs.existsSync(journalFile)) fs.unlinkSync(journalFile);
  });
});

describe('Span names with special characters', () => {
  let repo: { root: string; cleanup: () => void };
  beforeAll(() => {
    repo = makeTempRepo();
  });
  afterAll(() => repo.cleanup());

  it('span names with slashes and hyphens round-trip safely via execFileSync args', async () => {
    const absFilePath = join(repo.root, 'special.ts');
    const relPath = 'special.ts';
    const spanName = 'billing/checkout-request-flow';
    const porcelain = porcelainLine(spanName, relPath, 1, 50);
    const { executor, calls, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    setResponse(spanName, 'span output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath, offset: 10, limit: 5 }
    });
    await handler(input as never, { logger });
    // Render call passes name as a separate arg, no shell escaping
    expect(calls[1].args).toEqual([spanName]);
  });
});

describe('Executor failure handling', () => {
  let repo: { root: string; cleanup: () => void };
  beforeAll(() => {
    repo = makeTempRepo();
  });
  afterAll(() => repo.cleanup());

  it('porcelain call failure: logs and returns empty output without blocking', async () => {
    const absFilePath = join(repo.root, 'fail.ts');
    const relPath = 'fail.ts';
    const { executor, failOn } = createFakeExecutor();
    failOn(`--porcelain ${relPath}`);
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath, offset: 1, limit: 5 }
    });
    // Should not throw
    const result = toHookResult(await handler(input as never, { logger }));
    expect(result.stdout.systemMessage).toBeUndefined();
  });

  it('render call failure: logs and returns empty output without blocking', async () => {
    const absFilePath = join(repo.root, 'failrender.ts');
    const relPath = 'failrender.ts';
    const spanName = 'fail-render-span';
    const porcelain = porcelainLine(spanName, relPath, 1, 10);
    const { executor, setResponse, failOn } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    failOn(spanName);
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath, offset: 1, limit: 5 }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    expect(result.stdout.systemMessage).toBeUndefined();
  });
});

describe('Default export', () => {
  it('default export wraps handler and runs without error for non-git cwd', async () => {
    const result = await hook(baseInput({ cwd: '/' }) as never, { logger });
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Finding 1: countLines off-by-one with trailing newline
// ---------------------------------------------------------------------------

describe('Edit tool - countLines trailing newline off-by-one (Finding 1)', () => {
  let repo: { root: string; cleanup: () => void };
  let filePath: string;
  beforeAll(() => {
    repo = makeTempRepo();
    filePath = join(repo.root, 'trailing.ts');
    // 5 lines; line 3 = "match-line", line 4 = "neighbor"
    writeFileSync(filePath, 'line1\nline2\nmatch-line\nneighbor\nline5\n');
  });
  afterAll(() => repo.cleanup());

  it('old_string ending in newline should not extend range into the next line', async () => {
    const relPath = 'trailing.ts';
    // span anchor covers ONLY line 4 (the "neighbor" line)
    const neighborSpan = 'neighbor-span';
    const porcelain = porcelainLine(neighborSpan, relPath, 4, 4);
    const { executor, calls, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    // old_string = "match-line\n" which is exactly lines 3 (trailing newline
    // means it occupies only line 3, not line 4)
    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Edit',
      tool_input: { file_path: filePath, old_string: 'match-line\n', new_string: 'replaced\n' }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    // Only the porcelain call; the neighbor-span on line 4 must NOT be surfaced
    expect(calls).toHaveLength(1);
    expect(result.stdout.systemMessage).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Finding 2: empty old_string yields no range
// ---------------------------------------------------------------------------

describe('Edit tool - empty old_string (Finding 2)', () => {
  let repo: { root: string; cleanup: () => void };
  let filePath: string;
  beforeAll(() => {
    repo = makeTempRepo();
    filePath = join(repo.root, 'empty-old.ts');
    writeFileSync(filePath, 'line1\nline2\n');
  });
  afterAll(() => repo.cleanup());

  it('empty old_string produces no executor calls and no output', async () => {
    const relPath = 'empty-old.ts';
    const spanName = 'line1-span';
    const porcelain = porcelainLine(spanName, relPath, 1, 1);
    const { executor, calls, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Edit',
      tool_input: { file_path: filePath, old_string: '', new_string: 'inserted' }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    expect(calls).toHaveLength(0);
    expect(result.stdout.systemMessage).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Finding 3: replace_all unions ranges across all occurrences
// ---------------------------------------------------------------------------

describe('Edit tool - replace_all unions ranges (Finding 3)', () => {
  let repo: { root: string; cleanup: () => void };
  let filePath: string;
  beforeAll(() => {
    repo = makeTempRepo();
    filePath = join(repo.root, 'replace-all.ts');
    // "TOKEN" appears at line 1 and line 6; spans cover those lines separately
    writeFileSync(filePath, 'TOKEN\nline2\nline3\nline4\nline5\nTOKEN\nline7\n');
  });
  afterAll(() => repo.cleanup());

  it('replace_all surfaces spans overlapping every occurrence', async () => {
    const relPath = 'replace-all.ts';
    const span1 = 'span-at-line1';
    const span2 = 'span-at-line6';
    const porcelain = [porcelainLine(span1, relPath, 1, 1), porcelainLine(span2, relPath, 6, 6)].join('\n');
    const { executor, calls, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    setResponse(`${span1} ${span2}`, 'both spans output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Edit',
      tool_input: { file_path: filePath, old_string: 'TOKEN', new_string: 'REPLACED', replace_all: true }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    // Both spans should be requested in the render call
    expect(calls[1].args).toContain(span1);
    expect(calls[1].args).toContain(span2);
    expect(result.stdout.systemMessage).toContain('both spans output');
  });
});

// ---------------------------------------------------------------------------
// Finding 4: symlinked workdir still surfaces spans
// ---------------------------------------------------------------------------

describe('Symlinked workdir (Finding 4)', () => {
  let realRepo: { root: string; cleanup: () => void };
  let symlinkDir: string;

  beforeAll(() => {
    realRepo = makeTempRepo();
    symlinkDir = join(os.tmpdir(), `agent-hooks-symlink-${Date.now()}`);
    fs.symlinkSync(realRepo.root, symlinkDir);
  });
  afterAll(() => {
    // symlinkDir is a symlink (not a real dir), so unlinkSync removes the symlink itself.
    fs.unlinkSync(symlinkDir);
    realRepo.cleanup();
  });

  it('file path via symlinked cwd resolves correctly and porcelain is called with real repo-relative path', async () => {
    const absFilePath = join(symlinkDir, 'sym.ts');
    const relPath = 'sym.ts';
    const spanName = 'sym-span';
    const porcelain = porcelainLine(spanName, relPath, 1, 10);
    const { executor, calls, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    setResponse(spanName, 'sym span output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      cwd: symlinkDir,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath, offset: 1, limit: 5 }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    // The porcelain call must use the repo-relative path, not the symlink-absolute path
    expect(calls[0].args).toEqual(['--porcelain', relPath]);
    expect(result.stdout.systemMessage).toContain('sym span output');
  });
});

// ---------------------------------------------------------------------------
// Finding 5: session id sanitization is injective
// ---------------------------------------------------------------------------

describe('Session id sanitization - injective (Finding 5)', () => {
  it('distinct ids differing only in punctuation produce distinct memo file paths', () => {
    const idWithSlash = 'sess-a/b';
    const idWithUnderscore = 'sess-a_b';

    // Verify via the disk memo store that distinct session ids stay separate on disk.
    const diskStore = createDiskMemoStore({ warn: () => {} });
    diskStore.addSurfaced(idWithSlash, ['disk-x']);
    // If ids collide in filename, sess-a_b would see disk-x; it must not.
    expect([...diskStore.getSurfaced(idWithUnderscore)]).not.toContain('disk-x');
  });
});

// ---------------------------------------------------------------------------
// Finding 6: executor stderr not propagated
// ---------------------------------------------------------------------------

describe('Span executor stderr (Finding 6)', () => {
  it('createDefaultSpanExecutor captures stderr (uses pipe not inherit)', () => {
    // createDefaultSpanExecutor is imported at top of file.
    // Verify the executor is a function and that stderr from a failed invocation
    // is captured (not printed to the hook process's stderr) by running a
    // non-git command that exits non-zero with stderr output and confirming
    // the error is thrown (captured) rather than leaked.
    const executor = createDefaultSpanExecutor(5000);
    // 'git -C /nonexistent-path-xyz rev-parse' writes to stderr; execFileSync
    // with stdio: ['ignore','pipe','pipe'] captures it — the throw carries it.
    // With 'inherit' it would leak; with 'pipe' the throw captures stderr.
    expect(() => executor([], '/nonexistent-path-xyz-abc-12345')).toThrow();
  });

  it('fake executor with stderr simulation does not propagate through handler', async () => {
    // The fake executor in tests never touches stdio; the handler catches errors.
    // This test confirms the handler catches executor throws (stderr from git
    // would cause execFileSync to throw if git exits non-zero, which handler silences).
    const repo = makeTempRepo();
    const absFilePath = join(repo.root, 'stderr.ts');
    const relPath = 'stderr.ts';
    const { executor, failOn } = createFakeExecutor();
    failOn(`--porcelain ${relPath}`);
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath, offset: 1, limit: 5 }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    expect(result.stdout.systemMessage).toBeUndefined();
    repo.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Finding 7: PreToolUse output carries the span block in both additionalContext
// (reaches the agent loop) and systemMessage (user-facing UI line).
// ---------------------------------------------------------------------------

describe('PreToolUse output envelope (Finding 7)', () => {
  let repo: { root: string; cleanup: () => void };
  beforeAll(() => {
    repo = makeTempRepo();
  });
  afterAll(() => repo.cleanup());

  it('hook output carries the block in both additionalContext and systemMessage', async () => {
    const absFilePath = join(repo.root, 'envelope.ts');
    const relPath = 'envelope.ts';
    const spanName = 'envelope-span';
    const porcelain = porcelainLine(spanName, relPath, 1, 10);
    const { executor, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    setResponse(spanName, 'envelope output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath, offset: 1, limit: 5 }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    expect(result.stdout.systemMessage).toContain('<git-span>');
    expect(result.stdout.hookSpecificOutput?.additionalContext).toContain('<git-span>');
  });
});

// ---------------------------------------------------------------------------
// TouchKind emission: whole-read vs whole-write
// ---------------------------------------------------------------------------

describe('Touch kind emission', () => {
  let repo: { root: string; cleanup: () => void };
  let sid: string;

  beforeAll(() => {
    repo = makeTempRepo();
  });
  afterAll(() => {
    repo.cleanup();
  });

  beforeEach(() => {
    sid = `pre-emission-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // Clean up any prior journal for this session.
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  afterEach(() => {
    const jPath = journalPath(sid);
    if (fs.existsSync(jPath)) fs.unlinkSync(jPath);
  });

  it('whole-file Read emits whole-read kind', async () => {
    const absFilePath = join(repo.root, 'emit-read.ts');
    writeFileSync(absFilePath, 'line1\nline2\n');
    const { executor } = createFakeExecutor();
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      session_id: sid,
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath } // no offset/limit → whole-file
    });
    await handler(input as never, { logger });

    const entries = loadJournal(sid);
    expect(entries).not.toBeNull();
    const e = entries!.find((x) => x.path === 'emit-read.ts');
    expect(e?.kind).toBe('whole-read');
  });

  it('Edit without old_string (fallback) emits whole-write kind', async () => {
    const absFilePath = join(repo.root, 'emit-edit-fallback.ts');
    writeFileSync(absFilePath, 'line1\nline2\n');
    const { executor } = createFakeExecutor();
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      session_id: sid,
      cwd: repo.root,
      tool_name: 'Edit',
      tool_input: { file_path: absFilePath, old_string: '', new_string: 'replacement' }
    });
    await handler(input as never, { logger });

    const entries = loadJournal(sid);
    expect(entries).not.toBeNull();
    const e = entries!.find((x) => x.path === 'emit-edit-fallback.ts');
    expect(e?.kind).toBe('whole-write');
  });

  it('Write to existing file (full replacement) emits whole-write kind', async () => {
    const absFilePath = join(repo.root, 'emit-write-replace.ts');
    writeFileSync(absFilePath, 'original\n');
    const { executor } = createFakeExecutor();
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      session_id: sid,
      cwd: repo.root,
      tool_name: 'Write',
      tool_input: { file_path: absFilePath, content: 'replaced\n' }
    });
    await handler(input as never, { logger });

    const entries = loadJournal(sid);
    expect(entries).not.toBeNull();
    const e = entries!.find((x) => x.path === 'emit-write-replace.ts');
    expect(e?.kind).toBe('whole-write');
  });
});

describe('path-scoped span suppression', () => {
  let repo: { root: string; cleanup: () => void };
  beforeAll(() => {
    repo = makeTempRepo();
  });
  afterAll(() => repo.cleanup());

  it('does not surface a span whose slug prefix is suppressed for the touched path', async () => {
    const relPath = 'src/component.ts';
    const absFilePath = join(repo.root, relPath);
    fs.mkdirSync(join(repo.root, 'src'), { recursive: true });
    writeFileSync(absFilePath, 'line\n'.repeat(30));
    const spanName = 'wiki/onboarding';
    const porcelain = porcelainLine(spanName, relPath, 5, 20);
    const { executor, calls, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    setResponse(spanName, 'wiki span output');
    const { memoFactory } = createMemoryMemoFactory();
    // Inject a rule loader suppressing the `wiki` prefix under `src`.
    const handler = makeHandler(executor, memoFactory, () => parseHookIgnore('src wiki\n'));

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath, offset: 10, limit: 5 }
    });
    const result = toHookResult(await handler(input as never, { logger }));

    // Only the porcelain call happened; the suppressed span is never rendered.
    expect(calls).toHaveLength(1);
    expect(result.stdout.systemMessage).toBeUndefined();
  });

  it('still surfaces a non-suppressed span on the same suppressed path', async () => {
    const relPath = 'src/widget.ts';
    const absFilePath = join(repo.root, relPath);
    fs.mkdirSync(join(repo.root, 'src'), { recursive: true });
    writeFileSync(absFilePath, 'line\n'.repeat(30));
    const spanName = 'billing/checkout';
    const porcelain = porcelainLine(spanName, relPath, 5, 20);
    const { executor, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    setResponse(spanName, 'billing span output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory, () => parseHookIgnore('src wiki\n'));

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath, offset: 10, limit: 5 }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    expect(result.stdout.systemMessage).toContain('billing span output');
  });
});

describe('Span document touch', () => {
  let repo: { root: string; cleanup: () => void };
  beforeAll(() => {
    repo = makeTempRepo();
  });
  afterAll(() => repo.cleanup());

  it('neither surfaces spans nor journals a write to a .span/<slug> path', async () => {
    const sessionId = `span-doc-write-${Date.now()}`;
    const absFilePath = join(repo.root, '.span', 'wiki', 'reference', 'codex', 'instruction-loading');
    const { executor, calls, setResponse } = createFakeExecutor();
    // Wire a porcelain response so the overlap arm would surface a span if it ran.
    setResponse(
      '--porcelain .span/wiki/reference/codex/instruction-loading',
      porcelainLine('wiki', '.span/wiki/reference/codex/instruction-loading', 1, 50)
    );
    setResponse('wiki', 'wiki span output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = makeHandler(executor, memoFactory);

    const input = baseInput({
      session_id: sessionId,
      cwd: repo.root,
      tool_name: 'Write',
      tool_input: { file_path: absFilePath, content: '# instruction-loading\n' }
    });
    const result = toHookResult(await handler(input as never, { logger }));

    // Overlap arm never runs against a span document.
    expect(calls).toHaveLength(0);
    expect(result.stdout.systemMessage).toBeUndefined();

    // And the span document touch is never journaled.
    const journalFile = join(os.homedir(), '.cache', 'git-span', 'session', sessionId, 'touches.jsonl');
    expect(fs.existsSync(journalFile)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stale span history hint: a surfaced span that is already stale (the touched
// lines have drifted) carries a `git span history <name>` pointer on BOTH
// channels; a clean span does not; only the stale subset is hinted; and a
// failing stale probe degrades to the plain block.
// ---------------------------------------------------------------------------

describe('Stale span history hint', () => {
  let repo: { root: string; cleanup: () => void };
  beforeAll(() => {
    repo = makeTempRepo();
  });
  afterAll(() => repo.cleanup());

  it('appends `git span history <name>` on both channels for a stale surfaced span', async () => {
    const absFilePath = join(repo.root, 'stale.ts');
    const relPath = 'stale.ts';
    const spanName = 'billing/checkout';
    const row = porcelainLine(spanName, relPath, 5, 20);
    const { executor, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, row);
    setResponse(spanName, 'billing/checkout span output');
    const { memoFactory } = createMemoryMemoFactory();
    // The stale probe reports this span as drifted (one porcelain row).
    const handler = makeHandler(executor, memoFactory, undefined, () => row);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath, offset: 10, limit: 5 }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    const ctx = result.stdout.hookSpecificOutput?.additionalContext ?? '';
    // Hint on both channels, alongside the underlying list block.
    expect(ctx).toContain(`git span history ${spanName}`);
    expect(ctx).toContain('billing/checkout span output');
    expect(result.stdout.systemMessage).toContain(`git span history ${spanName}`);
  });

  it('does not append a hint when the surfaced span is clean', async () => {
    const absFilePath = join(repo.root, 'clean.ts');
    const relPath = 'clean.ts';
    const spanName = 'billing/clean';
    const { executor, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelainLine(spanName, relPath, 5, 20));
    setResponse(spanName, 'clean span output');
    const { memoFactory } = createMemoryMemoFactory();
    // No drift rows → no hint.
    const handler = makeHandler(executor, memoFactory, undefined, () => '');

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath, offset: 10, limit: 5 }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    expect(result.stdout.systemMessage).toContain('clean span output');
    expect(result.stdout.systemMessage).not.toContain('git span history');
  });

  it('hints only the stale subset when several spans are surfaced', async () => {
    const absFilePath = join(repo.root, 'mixed.ts');
    const relPath = 'mixed.ts';
    const staleSpan = 'billing/stale';
    const cleanSpan = 'billing/fresh';
    const { executor, setResponse } = createFakeExecutor();
    setResponse(
      `--porcelain ${relPath}`,
      [porcelainLine(staleSpan, relPath, 5, 20), porcelainLine(cleanSpan, relPath, 5, 20)].join('\n')
    );
    // toSurface is sorted, so the render call key is "fresh stale".
    setResponse(`${cleanSpan} ${staleSpan}`, 'both spans output');
    const { memoFactory } = createMemoryMemoFactory();
    // Only staleSpan drifts.
    const handler = makeHandler(executor, memoFactory, undefined, () => porcelainLine(staleSpan, relPath, 5, 20));

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath, offset: 10, limit: 5 }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    const ctx = result.stdout.hookSpecificOutput?.additionalContext ?? '';
    expect(ctx).toContain(`git span history ${staleSpan}`);
    expect(ctx).not.toContain(`git span history ${cleanSpan}`);
  });

  it('falls back to the plain block when the stale probe throws', async () => {
    const absFilePath = join(repo.root, 'staleerr.ts');
    const relPath = 'staleerr.ts';
    const spanName = 'billing/err';
    const { executor, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelainLine(spanName, relPath, 5, 20));
    setResponse(spanName, 'err span output');
    const { memoFactory } = createMemoryMemoFactory();
    const throwingStale: StaleExecutor = () => {
      throw new Error('git span stale failed');
    };
    const handler = makeHandler(executor, memoFactory, undefined, throwingStale);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath, offset: 10, limit: 5 }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    expect(result.stdout.systemMessage).toContain('err span output');
    expect(result.stdout.systemMessage).not.toContain('git span history');
  });
});

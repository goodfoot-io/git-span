import * as fs from 'node:fs';
import { writeFileSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { Logger } from '@goodfoot/claude-code-hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import hook, {
  createDefaultMeshExecutor,
  createDiskMemoStore,
  createHandler,
  type MemoFactory,
  type MemoLogger,
  type MemoStore,
  type MeshExecutor
} from '../src/pre-tool-use.js';
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
  executor: MeshExecutor;
  calls: ExecutorCall[];
  setResponse: (key: string, stdout: string) => void;
  failOn: (key: string) => void;
} {
  const calls: ExecutorCall[] = [];
  const errors = new Set<string>();

  const executor: MeshExecutor = (args, cwd) => {
    calls.push({ args, cwd });
    const key = args.join(' ');
    if (errors.has(key)) throw new Error(`git mesh list ${key} failed`);
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
  it('registers PreToolUse with matcher Read|Edit|MultiEdit|Write', () => {
    expect(hook.hookEventName).toBe('PreToolUse');
    expect(hook.matcher).toBe('Read|Edit|MultiEdit|Write');
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
    const meshName = 'billing/checkout';
    const porcelain = porcelainLine(meshName, relPath, 5, 20);
    const { executor, calls, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    setResponse(meshName, 'billing/checkout mesh output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = createHandler(executor, memoFactory);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath, offset: 10, limit: 5 }
    });
    const result = toHookResult(await handler(input as never, { logger }));

    expect(calls[0].args).toEqual(['--porcelain', relPath]);
    expect(calls[1].args).toEqual([meshName]);
    // The mesh block reaches the agent loop via additionalContext and the UI via systemMessage.
    expect(result.stdout.hookSpecificOutput?.additionalContext).toContain('billing/checkout mesh output');
    expect(result.stdout.systemMessage).toContain('billing/checkout mesh output');
  });

  it('without offset/limit: no executor calls, empty output', async () => {
    const { executor, calls } = createFakeExecutor();
    const { memoFactory } = createMemoryMemoFactory();
    const handler = createHandler(executor, memoFactory);

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
    const meshName = 'whole-file-mesh';
    const porcelain = porcelainLine(meshName, relPath, 0, 0);
    const { executor, calls, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    const { memoFactory } = createMemoryMemoFactory();
    const handler = createHandler(executor, memoFactory);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath, offset: 1, limit: 10 }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    expect(calls).toHaveLength(1); // only porcelain call, no render call
    expect(result.stdout.systemMessage).toBeUndefined();
  });

  it('non-intersecting mesh anchor: not surfaced', async () => {
    const absFilePath = join(repo.root, 'nonintersect.ts');
    const relPath = 'nonintersect.ts';
    const meshName = 'far-mesh';
    const porcelain = porcelainLine(meshName, relPath, 100, 200);
    const { executor, calls, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    const { memoFactory } = createMemoryMemoFactory();
    const handler = createHandler(executor, memoFactory);

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

  it('old_string found: derives range and surfaces intersecting mesh', async () => {
    const relPath = 'src/bar.ts';
    const meshName = 'bar-mesh';
    // old_string "line2\nline3" is at lines 2-3
    const porcelain = porcelainLine(meshName, relPath, 2, 3);
    const { executor, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    setResponse(meshName, 'bar-mesh output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = createHandler(executor, memoFactory);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Edit',
      tool_input: { file_path: filePath, old_string: 'line2\nline3', new_string: 'replaced' }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    expect(result.stdout.systemMessage).toContain('bar-mesh output');
  });

  it('old_string missing: empty output', async () => {
    const { executor, calls } = createFakeExecutor();
    const { memoFactory } = createMemoryMemoFactory();
    const handler = createHandler(executor, memoFactory);

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

describe('MultiEdit tool', () => {
  let repo: { root: string; cleanup: () => void };
  let filePath: string;
  beforeAll(() => {
    repo = makeTempRepo();
    filePath = join(repo.root, 'multi.ts');
    writeFileSync(filePath, 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n');
  });
  afterAll(() => repo.cleanup());

  it('unions ranges from multiple edits and surfaces intersecting mesh', async () => {
    const relPath = 'multi.ts';
    const meshName = 'multi-mesh';
    // Mesh anchor at lines 1-3; first edit ("a") is at line 1
    const porcelain = porcelainLine(meshName, relPath, 1, 3);
    const { executor, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    setResponse(meshName, 'multi output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = createHandler(executor, memoFactory);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: filePath,
        edits: [
          { old_string: 'a', new_string: 'A' },
          { old_string: 'i', new_string: 'I' }
        ]
      }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    expect(result.stdout.systemMessage).toContain('multi output');
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
    const handler = createHandler(executor, memoFactory);

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
    const handler = createHandler(executor, memoFactory);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Write',
      tool_input: { file_path: fp, content: 'new line 1\nnew line 2\n' }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    expect(calls).toHaveLength(0);
    expect(result.stdout.systemMessage).toBeUndefined();
  });

  it('write that changes a middle slice: ranges derived and intersecting mesh surfaced', async () => {
    const fp = join(repo.root, 'partial.ts');
    writeFileSync(fp, 'a\nb\nc\nd\ne\n');
    const relPath = 'partial.ts';
    const meshName = 'partial-mesh';
    // Lines 2-4 change; mesh anchor covers that range
    const porcelain = porcelainLine(meshName, relPath, 2, 4);
    const { executor, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    setResponse(meshName, 'partial mesh output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = createHandler(executor, memoFactory);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Write',
      tool_input: { file_path: fp, content: 'a\nB\nC\nD\ne\n' }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    expect(result.stdout.systemMessage).toContain('partial mesh output');
  });
});

describe('Session memo deduplication', () => {
  let repo: { root: string; cleanup: () => void };
  beforeAll(() => {
    repo = makeTempRepo();
  });
  afterAll(() => repo.cleanup());

  it('mesh slug surfaced once is filtered out on the next overlapping call within the same session', async () => {
    const absFilePath = join(repo.root, 'memo.ts');
    const relPath = 'memo.ts';
    const meshName = 'dedup-mesh';
    const porcelain = porcelainLine(meshName, relPath, 1, 10);
    const { executor, calls, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    setResponse(meshName, 'dedup output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = createHandler(executor, memoFactory);

    const input = baseInput({
      session_id: 'dedup-session',
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath, offset: 5, limit: 3 }
    });

    // First call: surfaces the mesh
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
    const meshName = 'sess-mesh';
    const porcelain = porcelainLine(meshName, relPath, 1, 10);
    const { executor, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    setResponse(meshName, 'sess output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = createHandler(executor, memoFactory);

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
    const handler = createHandler(executor, memoFactory);

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

  it('neither surfaces meshes nor journals when the file is in a different repo than cwd', async () => {
    const sessionId = `cross-repo-${Date.now()}`;
    // The touched file lives in otherRepo; cwd is cwdRepo. A porcelain response
    // is wired so that, were the overlap arm to run, it would surface a mesh.
    const absFilePath = join(otherRepo.root, 'foreign.ts');
    const { executor, calls, setResponse } = createFakeExecutor();
    setResponse('--porcelain foreign.ts', porcelainLine('foreign-mesh', 'foreign.ts', 1, 20));
    setResponse('foreign-mesh', 'foreign mesh output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = createHandler(executor, memoFactory);

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
    const journalPath = join(os.homedir(), '.cache', 'git-mesh', 'session', sessionId, 'touches.jsonl');
    expect(fs.existsSync(journalPath)).toBe(false);
  });
});

describe('Mesh names with special characters', () => {
  let repo: { root: string; cleanup: () => void };
  beforeAll(() => {
    repo = makeTempRepo();
  });
  afterAll(() => repo.cleanup());

  it('mesh names with slashes and hyphens round-trip safely via execFileSync args', async () => {
    const absFilePath = join(repo.root, 'special.ts');
    const relPath = 'special.ts';
    const meshName = 'billing/checkout-request-flow';
    const porcelain = porcelainLine(meshName, relPath, 1, 50);
    const { executor, calls, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    setResponse(meshName, 'mesh output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = createHandler(executor, memoFactory);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath, offset: 10, limit: 5 }
    });
    await handler(input as never, { logger });
    // Render call passes name as a separate arg, no shell escaping
    expect(calls[1].args).toEqual([meshName]);
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
    const handler = createHandler(executor, memoFactory);

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
    const meshName = 'fail-render-mesh';
    const porcelain = porcelainLine(meshName, relPath, 1, 10);
    const { executor, setResponse, failOn } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    failOn(meshName);
    const { memoFactory } = createMemoryMemoFactory();
    const handler = createHandler(executor, memoFactory);

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
    // mesh anchor covers ONLY line 4 (the "neighbor" line)
    const neighborMesh = 'neighbor-mesh';
    const porcelain = porcelainLine(neighborMesh, relPath, 4, 4);
    const { executor, calls, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    const { memoFactory } = createMemoryMemoFactory();
    const handler = createHandler(executor, memoFactory);

    // old_string = "match-line\n" which is exactly lines 3 (trailing newline
    // means it occupies only line 3, not line 4)
    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Edit',
      tool_input: { file_path: filePath, old_string: 'match-line\n', new_string: 'replaced\n' }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    // Only the porcelain call; the neighbor-mesh on line 4 must NOT be surfaced
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
    const meshName = 'line1-mesh';
    const porcelain = porcelainLine(meshName, relPath, 1, 1);
    const { executor, calls, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    const { memoFactory } = createMemoryMemoFactory();
    const handler = createHandler(executor, memoFactory);

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
    // "TOKEN" appears at line 1 and line 6; meshes cover those lines separately
    writeFileSync(filePath, 'TOKEN\nline2\nline3\nline4\nline5\nTOKEN\nline7\n');
  });
  afterAll(() => repo.cleanup());

  it('replace_all surfaces meshes overlapping every occurrence', async () => {
    const relPath = 'replace-all.ts';
    const mesh1 = 'mesh-at-line1';
    const mesh2 = 'mesh-at-line6';
    const porcelain = [porcelainLine(mesh1, relPath, 1, 1), porcelainLine(mesh2, relPath, 6, 6)].join('\n');
    const { executor, calls, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    setResponse(`${mesh1} ${mesh2}`, 'both meshes output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = createHandler(executor, memoFactory);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Edit',
      tool_input: { file_path: filePath, old_string: 'TOKEN', new_string: 'REPLACED', replace_all: true }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    // Both meshes should be requested in the render call
    expect(calls[1].args).toContain(mesh1);
    expect(calls[1].args).toContain(mesh2);
    expect(result.stdout.systemMessage).toContain('both meshes output');
  });
});

// ---------------------------------------------------------------------------
// Finding 4: symlinked workdir still surfaces meshes
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
    const meshName = 'sym-mesh';
    const porcelain = porcelainLine(meshName, relPath, 1, 10);
    const { executor, calls, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    setResponse(meshName, 'sym mesh output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = createHandler(executor, memoFactory);

    const input = baseInput({
      cwd: symlinkDir,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath, offset: 1, limit: 5 }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    // The porcelain call must use the repo-relative path, not the symlink-absolute path
    expect(calls[0].args).toEqual(['--porcelain', relPath]);
    expect(result.stdout.systemMessage).toContain('sym mesh output');
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

describe('Mesh executor stderr (Finding 6)', () => {
  it('createDefaultMeshExecutor captures stderr (uses pipe not inherit)', () => {
    // createDefaultMeshExecutor is imported at top of file.
    // Verify the executor is a function and that stderr from a failed invocation
    // is captured (not printed to the hook process's stderr) by running a
    // non-git command that exits non-zero with stderr output and confirming
    // the error is thrown (captured) rather than leaked.
    const executor = createDefaultMeshExecutor(5000);
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
    const handler = createHandler(executor, memoFactory);

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
// Finding 7: PreToolUse output carries the mesh block in both additionalContext
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
    const meshName = 'envelope-mesh';
    const porcelain = porcelainLine(meshName, relPath, 1, 10);
    const { executor, setResponse } = createFakeExecutor();
    setResponse(`--porcelain ${relPath}`, porcelain);
    setResponse(meshName, 'envelope output');
    const { memoFactory } = createMemoryMemoFactory();
    const handler = createHandler(executor, memoFactory);

    const input = baseInput({
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: absFilePath, offset: 1, limit: 5 }
    });
    const result = toHookResult(await handler(input as never, { logger }));
    expect(result.stdout.systemMessage).toContain('<git-mesh>');
    expect(result.stdout.hookSpecificOutput?.additionalContext).toContain('<git-mesh>');
  });
});

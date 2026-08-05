/**
 * Tests for the Codex PostToolUse touch hook
 * (packages/agent-hooks/src/codex/post-tool-use.ts).
 *
 * The adapter narrows the confirmed apply_patch envelope into per-file anchors
 * and drives the shared runTouchHook core (whole-file scoped — Codex never
 * recovers a post-edit range) with injected executors and an in-memory memo. It
 * preserves the success-classification belt: a confirmed rejection suppresses
 * the touch, an unrecognized shape proceeds with a warning.
 *
 * Success fixtures are built by {@link printSummary}, mirroring Codex's real
 * `print_summary` (header `Success. Updated the following files:` then
 * `A/M/D <path>` lines) rather than pasting the literal the detector checks for.
 */

import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@goodfoot/codex-hooks';
import { describe, expect, it } from 'vitest';
import hook, {
  classifyApplyPatchResponse,
  createHandler,
  narrowCodeModeExec,
  narrowExecCommand
} from '../../src/codex/post-tool-use.js';
import type { DriftPorcelainRow, PorcelainRow, PorcelainStatus } from '../../src/common/agent-hooks-common.js';
import type { MemoFactory, MemoLogger, MemoStore } from '../../src/common/span-surface.js';
import type { TouchExecutors, TouchFixResult } from '../../src/common/touch-core.js';
import { makeTempRepo } from '../helpers.js';

const logger = new Logger();

function printSummary(paths: { added?: string[]; modified?: string[]; deleted?: string[] }): string {
  const lines = ['Success. Updated the following files:'];
  for (const p of paths.added ?? []) lines.push(`A ${p}`);
  for (const p of paths.modified ?? []) lines.push(`M ${p}`);
  for (const p of paths.deleted ?? []) lines.push(`D ${p}`);
  return `${lines.join('\n')}\n`;
}

const SUCCESS_RESPONSE = printSummary({ modified: ['foo.ts'] });
const FAILURE_RESPONSE = 'apply_patch verification failed: context not found in foo.ts';

/** Update `foo.ts` (block beta/gamma/delta). */
function updateEnvelope(path = 'foo.ts'): string {
  return [
    '*** Begin Patch',
    `*** Update File: ${path}`,
    '@@',
    ' beta',
    '-gamma',
    '+GAMMA',
    ' delta',
    '*** End Patch'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FakeOpts {
  list?: PorcelainRow[];
  drift?: DriftPorcelainRow[];
  reject?: boolean;
}
function makeExecutors(opts: FakeOpts = {}): {
  executors: TouchExecutors;
  calls: { fix: number; list: number; drift: number; why: number };
  fixPaths: string[];
  listPaths: string[];
} {
  const calls = { fix: 0, list: 0, drift: 0, why: 0 };
  const fixPaths: string[] = [];
  const listPaths: string[] = [];
  const boom = () => {
    throw new Error('spawn git ENOENT');
  };
  const executors: TouchExecutors = {
    fix: async (filePath): Promise<TouchFixResult> => {
      calls.fix += 1;
      fixPaths.push(filePath);
      if (opts.reject) boom();
      return { modified: false };
    },
    list: async (filePath): Promise<PorcelainRow[]> => {
      calls.list += 1;
      listPaths.push(filePath);
      if (opts.reject) boom();
      return opts.list ?? [];
    },
    drift: async (): Promise<DriftPorcelainRow[]> => {
      calls.drift += 1;
      if (opts.reject) boom();
      return opts.drift ?? [];
    },
    why: async (): Promise<string | null> => {
      calls.why += 1;
      if (opts.reject) boom();
      return 'Checkout request flow that carries a charge attempt from the browser to the Stripe-backed server.';
    }
  };
  return { executors, calls, fixPaths, listPaths };
}

function inMemoryMemoFactory(): MemoFactory {
  const store = new Map<string, Set<string>>();
  return (_logger: MemoLogger): MemoStore => ({
    getSurfaced: (sid) => new Set(store.get(sid) ?? []),
    addSurfaced: (sid, names) => {
      const s = store.get(sid) ?? new Set<string>();
      for (const n of names) s.add(n);
      store.set(sid, s);
    }
  });
}

const SPAN = 'billing/checkout-request-flow';
function porcelainRow(): PorcelainRow {
  return { name: SPAN, path: 'foo.ts', start: 1, end: 10 };
}
function driftRow(status: PorcelainStatus): DriftPorcelainRow {
  return { name: SPAN, path: 'foo.ts', start: 1, end: 10, status };
}

function warnCapturingLogger(): { logger: Logger; warnings: string[] } {
  const warnings: string[] = [];
  const capture = new Logger();
  capture.on('warn', (event) => warnings.push(event.message));
  return { logger: capture, warnings };
}

function postInput(cwd: string, command: unknown, toolResponse: unknown = SUCCESS_RESPONSE): Record<string, unknown> {
  return {
    hook_event_name: 'PostToolUse' as const,
    session_id: 'codex-sess',
    cwd,
    model: 'gpt-x',
    permission_mode: 'default',
    transcript_path: '/tmp/t',
    tool_name: 'apply_patch',
    tool_input: { command },
    tool_response: toolResponse,
    tool_use_id: 'tu-1',
    turn_id: 'turn-1'
  };
}

interface HookResult {
  stdout: { systemMessage?: string; hookSpecificOutput?: { additionalContext?: string } };
}
function toResult(raw: unknown): HookResult {
  if (raw === null || raw === undefined) return { stdout: {} };
  return raw as HookResult;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('codex post-tool-use hook registration', () => {
  it('registers PostToolUse with matcher apply_patch|exec_command|exec|Bash', () => {
    expect(hook.hookEventName).toBe('PostToolUse');
    expect(hook.matcher).toBe('apply_patch|exec_command|exec|Bash');
  });
});

describe('classifyApplyPatchResponse', () => {
  it('classifies a bare-string success as success', () => {
    expect(classifyApplyPatchResponse(SUCCESS_RESPONSE)).toBe('success');
    expect(classifyApplyPatchResponse({ output: SUCCESS_RESPONSE })).toBe('success');
  });
  it('classifies recovered-but-headerless text as failure', () => {
    expect(classifyApplyPatchResponse(FAILURE_RESPONSE)).toBe('failure');
    expect(classifyApplyPatchResponse('')).toBe('failure');
  });
  it('classifies an unrecoverable shape as unknown', () => {
    expect(classifyApplyPatchResponse({})).toBe('unknown');
    expect(classifyApplyPatchResponse(null)).toBe('unknown');
  });
});

describe('shell envelope narrowing', () => {
  it('narrowExecCommand recovers cmd from the classic JSON arguments envelope', () => {
    const toolInput = { arguments: JSON.stringify({ cmd: "sed -n '1,2p' /tmp/f", workdir: '/tmp' }) };
    expect(narrowExecCommand(toolInput)).toBe("sed -n '1,2p' /tmp/f");
  });

  it('narrowExecCommand returns null for non-JSON arguments, a missing cmd, or a non-envelope shape', () => {
    expect(narrowExecCommand({ arguments: 'not json' })).toBeNull();
    expect(narrowExecCommand({ arguments: '{"workdir": "/tmp"}' })).toBeNull();
    expect(narrowExecCommand({ arguments: 42 })).toBeNull();
    expect(narrowExecCommand({})).toBeNull();
    expect(narrowExecCommand(null)).toBeNull();
  });

  it('narrowCodeModeExec recovers cmd from an unquoted-key code-mode literal', () => {
    const result = narrowCodeModeExec({
      input:
        'const r = await tools.exec_command({cmd:"sed -n \'1,240p\' /path", shell:"bash", workdir:"/path"});\ntext(JSON.stringify(r));'
    });
    expect(result).toEqual({ matched: true, cmd: "sed -n '1,240p' /path" });
  });

  it('narrowCodeModeExec leaves an already-quoted literal untouched', () => {
    const result = narrowCodeModeExec({ input: 'tools.exec_command({"cmd":"echo hi", "workdir":"/tmp"})' });
    expect(result).toEqual({ matched: true, cmd: 'echo hi' });
  });

  it('narrowCodeModeExec does not mistake a comma-colon inside a string value for a key', () => {
    const result = narrowCodeModeExec({ input: 'tools.exec_command({cmd:"sed -i \'s/a,b:c/d/\' f", workdir:"/tmp"})' });
    expect(result).toEqual({ matched: true, cmd: "sed -i 's/a,b:c/d/' f" });
  });

  it('narrowCodeModeExec distinguishes an unmatched envelope from a matched-but-unparsable one', () => {
    expect(narrowCodeModeExec({ input: 'const x = 1;' })).toEqual({ matched: false, cmd: null });
    expect(narrowCodeModeExec(null)).toEqual({ matched: false, cmd: null });
    // Variable-built command: the call matches, but the literal cannot parse.
    expect(narrowCodeModeExec({ input: 'tools.exec_command({cmd: process.cwd()})' })).toEqual({
      matched: true,
      cmd: null
    });
  });
});

describe('codex post-tool-use touch signal', () => {
  it('heals and surfaces a semantic directive on a confirmed apply', async () => {
    const repo = makeTempRepo();
    try {
      const { executors, calls } = makeExecutors({ list: [porcelainRow()], drift: [driftRow('CHANGED')] });
      const handler = createHandler(executors, inMemoryMemoFactory());
      const result = toResult(await handler(postInput(repo.root, updateEnvelope()) as never, { logger } as never));

      expect(calls.fix).toBe(1);
      expect(result.stdout.hookSpecificOutput?.additionalContext).toContain(SPAN);
      expect(result.stdout.systemMessage).toContain(SPAN);
    } finally {
      repo.cleanup();
    }
  });

  it('suppresses the touch entirely on a confirmed rejection (no executor calls, no warn)', async () => {
    const repo = makeTempRepo();
    try {
      const { executors, calls } = makeExecutors({ list: [porcelainRow()], drift: [driftRow('CHANGED')] });
      const { logger: capture, warnings } = warnCapturingLogger();
      const handler = createHandler(executors, inMemoryMemoFactory());
      const result = toResult(
        await handler(postInput(repo.root, updateEnvelope(), FAILURE_RESPONSE) as never, { logger: capture } as never)
      );

      expect(calls.fix).toBe(0);
      expect(calls.list).toBe(0);
      expect(warnings).toHaveLength(0);
      expect(result.stdout.hookSpecificOutput?.additionalContext).toBeUndefined();
    } finally {
      repo.cleanup();
    }
  });

  it('runs the touch (and warns) when the tool_response shape is unrecognized', async () => {
    const repo = makeTempRepo();
    try {
      const { executors, calls } = makeExecutors({ list: [porcelainRow()], drift: [driftRow('CHANGED')] });
      const { logger: capture, warnings } = warnCapturingLogger();
      const handler = createHandler(executors, inMemoryMemoFactory());
      await handler(postInput(repo.root, updateEnvelope(), { exitCode: 0 }) as never, { logger: capture } as never);

      expect(calls.fix).toBe(1);
      expect(warnings.some((m) => m.includes('unrecognized'))).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it('fails open (empty output, no throw) when every executor rejects', async () => {
    const repo = makeTempRepo();
    try {
      const { executors } = makeExecutors({ reject: true });
      const handler = createHandler(executors, inMemoryMemoFactory());
      const result = toResult(await handler(postInput(repo.root, updateEnvelope()) as never, { logger } as never));
      expect(result.stdout.hookSpecificOutput?.additionalContext).toBeUndefined();
      expect(result.stdout.systemMessage).toBeUndefined();
    } finally {
      repo.cleanup();
    }
  });

  it('surfaces nothing for a non-apply_patch tool_input', async () => {
    const repo = makeTempRepo();
    try {
      const { executors, calls } = makeExecutors({ list: [porcelainRow()], drift: [driftRow('CHANGED')] });
      const handler = createHandler(executors, inMemoryMemoFactory());
      const result = toResult(await handler(postInput(repo.root, undefined) as never, { logger } as never));
      // narrowApplyPatchCommand rejects a missing command → no touch.
      expect(calls.fix).toBe(0);
      expect(result.stdout.hookSpecificOutput?.additionalContext).toBeUndefined();
    } finally {
      repo.cleanup();
    }
  });

  it('surfaces a touch for a shell command with a recognized read idiom (classic exec_command envelope)', async () => {
    const repo = makeTempRepo();
    try {
      const filePath = join(repo.root, 'mod.rs');
      writeFileSync(filePath, Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join('\n'));
      const { executors, calls } = makeExecutors({
        list: [{ name: SPAN, path: 'mod.rs', start: 39, end: 189 }],
        drift: [driftRow('CHANGED')]
      });
      const handler = createHandler(executors, inMemoryMemoFactory());
      const input = {
        ...postInput(repo.root, null),
        tool_name: 'exec_command',
        tool_input: { arguments: JSON.stringify({ cmd: `sed -n '39,60p' ${filePath}` }) }
      };

      const result = toResult(await handler(input as never, { logger } as never));
      expect(calls.fix).toBe(0); // read path never heals
      expect(result.stdout.hookSpecificOutput?.additionalContext).toContain(SPAN);
    } finally {
      repo.cleanup();
    }
  });

  it('surfaces a touch for a code-mode exec envelope (unquoted-key literal)', async () => {
    const repo = makeTempRepo();
    try {
      const filePath = join(repo.root, 'mod.rs');
      writeFileSync(filePath, Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join('\n'));
      const { executors } = makeExecutors({
        list: [{ name: SPAN, path: 'mod.rs', start: 39, end: 189 }],
        drift: [driftRow('CHANGED')]
      });
      const handler = createHandler(executors, inMemoryMemoFactory());
      const input = {
        ...postInput(repo.root, null),
        tool_name: 'exec',
        tool_input: {
          input: `const r = await tools.exec_command({cmd:"sed -n '39,60p' ${filePath}", shell:"bash", workdir:"${repo.root}"});\ntext(JSON.stringify(r));`
        }
      };

      const result = toResult(await handler(input as never, { logger } as never));
      expect(result.stdout.hookSpecificOutput?.additionalContext).toContain(SPAN);
    } finally {
      repo.cleanup();
    }
  });

  it('warns (but fails open) when a code-mode exec envelope matches yet cannot be parsed', async () => {
    const repo = makeTempRepo();
    try {
      const { executors, calls } = makeExecutors({ list: [porcelainRow()] });
      const { logger: capture, warnings } = warnCapturingLogger();
      const handler = createHandler(executors, inMemoryMemoFactory());
      const input = {
        ...postInput(repo.root, null),
        tool_name: 'exec',
        tool_input: { input: 'tools.exec_command({cmd: process.cwd()})' }
      };

      const result = toResult(await handler(input as never, { logger: capture } as never));
      expect(calls.list).toBe(0);
      expect(warnings.some((m) => m.includes('code-mode exec envelope'))).toBe(true);
      expect(result.stdout.hookSpecificOutput?.additionalContext).toBeUndefined();
    } finally {
      repo.cleanup();
    }
  });

  it('surfaces a touch for a Bash shell command (harness-unwrapped envelope — the live Codex shape)', async () => {
    const repo = makeTempRepo();
    try {
      const filePath = join(repo.root, 'mod.rs');
      writeFileSync(filePath, Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join('\n'));
      const { executors, calls } = makeExecutors({
        list: [{ name: SPAN, path: 'mod.rs', start: 39, end: 189 }],
        drift: [driftRow('CHANGED')]
      });
      const handler = createHandler(executors, inMemoryMemoFactory());
      const input = {
        ...postInput(repo.root, null),
        tool_name: 'Bash',
        tool_input: { command: `sed -n '39,60p' ${filePath}` }
      };

      const result = toResult(await handler(input as never, { logger } as never));
      expect(calls.fix).toBe(0); // read path never heals
      expect(result.stdout.hookSpecificOutput?.additionalContext).toContain(SPAN);
    } finally {
      repo.cleanup();
    }
  });

  it('returns undefined for a Bash command with no recognized idiom', async () => {
    const repo = makeTempRepo();
    try {
      const { executors, calls } = makeExecutors({ list: [porcelainRow()], drift: [driftRow('CHANGED')] });
      const handler = createHandler(executors, inMemoryMemoFactory());
      const input = {
        ...postInput(repo.root, null),
        tool_name: 'Bash',
        tool_input: { command: 'echo hello && git status' }
      };

      const result = await handler(input as never, { logger } as never);
      expect(result).toBeUndefined();
      expect(calls.list).toBe(0);
    } finally {
      repo.cleanup();
    }
  });

  it('a Bash heredoc > overwrite surfaces a span truncated beyond the new EOF (whole-file scope)', async () => {
    const repo = makeTempRepo();
    try {
      const filePath = join(repo.root, 'out.txt');
      // Post-edit state: the heredoc wrote only 3 lines, down from 10.
      writeFileSync(filePath, `${['alpha', 'beta', 'gamma'].join('\n')}\n`);
      const command = `cat > ${filePath} <<'EOF'\nalpha\nbeta\ngamma\nEOF\n`;
      const { executors, calls } = makeExecutors({
        list: [{ name: SPAN, path: 'out.txt', start: 8, end: 10 }],
        drift: [driftRow('DELETED')]
      });
      const handler = createHandler(executors, inMemoryMemoFactory());
      const input = {
        ...postInput(repo.root, null),
        tool_name: 'Bash',
        tool_input: { command }
      };

      const result = toResult(await handler(input as never, { logger } as never));
      expect(calls.fix).toBe(1); // write path heals
      // The span at lines 8-10 was beyond the new EOF (3 lines). With
      // `written: ''` (whole-file scope from `redirect: '>'`) the touch core
      // surfaces it as deleted — previously this was silent because the body
      // was not threaded into the touch.
      expect(result.stdout.hookSpecificOutput?.additionalContext).toContain(SPAN);
    } finally {
      repo.cleanup();
    }
  });

  it('a Bash heredoc >> append is scoped to the appended body, not the whole file', async () => {
    const repo = makeTempRepo();
    try {
      const filePath = join(repo.root, 'out.txt');
      // Post-edit state: original two lines + appended three lines.
      writeFileSync(filePath, `${['orig1', 'orig2', 'alpha', 'beta', 'gamma'].join('\n')}\n`);
      const command = `cat >> ${filePath} <<'EOF'\nalpha\nbeta\ngamma\nEOF\n`;
      const { executors, calls } = makeExecutors({
        list: [{ name: SPAN, path: 'out.txt', start: 1, end: 2 }],
        drift: [driftRow('CHANGED')]
      });
      const handler = createHandler(executors, inMemoryMemoFactory());
      const input = {
        ...postInput(repo.root, null),
        tool_name: 'Bash',
        tool_input: { command }
      };

      const result = toResult(await handler(input as never, { logger } as never));
      expect(calls.fix).toBe(1); // write path heals
      // The span anchored at lines 1-2 (original content) is outside the
      // appended body at lines 3-5. With `written: span.body` the touch is
      // scoped to the append range and this span does not surface — proving
      // the body reached the touch core.
      expect(result.stdout.hookSpecificOutput?.additionalContext).toBeUndefined();
    } finally {
      repo.cleanup();
    }
  });
});

describe('Bash write touches per family (Phase 2 — skipped acceptance checks)', () => {
  /** Seed post-command file state: write, git-add the tracked ones, then delete the null-content ones. */
  function seed(repo: { root: string }, files: Array<[string, string | null]>, tracked: string[] = []): void {
    for (const [rel, content] of files) {
      if (content !== null) writeFileSync(join(repo.root, rel), content);
    }
    if (tracked.length > 0) execFileSync('git', ['add', ...tracked], { cwd: repo.root });
    for (const [rel, content] of files) {
      if (content === null) rmSync(join(repo.root, rel), { force: true });
    }
  }

  function bashInput(repo: { root: string }, command: string): Record<string, unknown> {
    return {
      ...postInput(repo.root, null),
      tool_name: 'Bash',
      tool_input: { command }
    };
  }

  it.skip('redirection: echo hello > f produces a whole-file write touch on f', async () => {
    const repo = makeTempRepo();
    try {
      seed(repo, [['f.txt', 'hello\n']]);
      const { executors, fixPaths } = makeExecutors();
      const handler = createHandler(executors, inMemoryMemoFactory());

      await handler(bashInput(repo, `echo hello > ${join(repo.root, 'f.txt')}`) as never, { logger } as never);

      expect(fixPaths).toEqual([join(repo.root, 'f.txt')]);
    } finally {
      repo.cleanup();
    }
  });

  it.skip('redirection: echo x >> f threads the append body into the write touch', async () => {
    const repo = makeTempRepo();
    try {
      seed(repo, [['f.txt', 'a\nx\n']]);
      const { executors, fixPaths } = makeExecutors();
      const handler = createHandler(executors, inMemoryMemoFactory());

      await handler(bashInput(repo, `echo x >> ${join(repo.root, 'f.txt')}`) as never, { logger } as never);

      expect(fixPaths).toEqual([join(repo.root, 'f.txt')]);
    } finally {
      repo.cleanup();
    }
  });

  it.skip('heredoc: cat > f <<EOF produces a whole-file write touch on f', async () => {
    const repo = makeTempRepo();
    try {
      seed(repo, [['h.txt', 'alpha\n']]);
      const command = `cat > ${join(repo.root, 'h.txt')} <<'EOF'\nalpha\nEOF\n`;
      const { executors, fixPaths } = makeExecutors();
      const handler = createHandler(executors, inMemoryMemoFactory());

      await handler(bashInput(repo, command) as never, { logger } as never);

      expect(fixPaths).toEqual([join(repo.root, 'h.txt')]);
    } finally {
      repo.cleanup();
    }
  });

  it.skip('cp: read on the source, create-overwrite on the dest', async () => {
    const repo = makeTempRepo();
    try {
      seed(repo, [
        ['a.txt', 's1\ns2\n'],
        ['b.txt', 's1\ns2\n']
      ]);
      const { executors, fixPaths, listPaths } = makeExecutors();
      const handler = createHandler(executors, inMemoryMemoFactory());

      await handler(
        bashInput(repo, `cp ${join(repo.root, 'a.txt')} ${join(repo.root, 'b.txt')}`) as never,
        {
          logger
        } as never
      );

      expect(fixPaths).toEqual([join(repo.root, 'b.txt')]);
      expect(listPaths).toContain(join(repo.root, 'a.txt'));
    } finally {
      repo.cleanup();
    }
  });

  it.skip('mv: delete on the source, rename-copy on the dest', async () => {
    const repo = makeTempRepo();
    try {
      seed(
        repo,
        [
          ['a.txt', null],
          ['c.txt', 'a1\na2\n']
        ],
        ['a.txt']
      );
      const { executors, fixPaths } = makeExecutors();
      const handler = createHandler(executors, inMemoryMemoFactory());

      await handler(
        bashInput(repo, `mv ${join(repo.root, 'a.txt')} ${join(repo.root, 'c.txt')}`) as never,
        {
          logger
        } as never
      );

      expect(fixPaths).toEqual([join(repo.root, 'a.txt'), join(repo.root, 'c.txt')]);
    } finally {
      repo.cleanup();
    }
  });

  it.skip('rm: delete touch on a real (index-tracked, deleted) target', async () => {
    const repo = makeTempRepo();
    try {
      seed(repo, [['d.txt', null]], ['d.txt']);
      const { executors, fixPaths } = makeExecutors();
      const handler = createHandler(executors, inMemoryMemoFactory());

      await handler(bashInput(repo, `rm ${join(repo.root, 'd.txt')}`) as never, { logger } as never);

      expect(fixPaths).toEqual([join(repo.root, 'd.txt')]);
    } finally {
      repo.cleanup();
    }
  });

  it.skip('truncate -s 0: truncate touch on an empty post-command file', async () => {
    const repo = makeTempRepo();
    try {
      seed(repo, [['e.txt', '']]);
      const { executors, fixPaths } = makeExecutors();
      const handler = createHandler(executors, inMemoryMemoFactory());

      await handler(bashInput(repo, `truncate -s 0 ${join(repo.root, 'e.txt')}`) as never, { logger } as never);

      expect(fixPaths).toEqual([join(repo.root, 'e.txt')]);
    } finally {
      repo.cleanup();
    }
  });

  it.skip('sed -i: modify touch (script-first disambiguation)', async () => {
    const repo = makeTempRepo();
    try {
      seed(repo, [['s.txt', 'a\n']]);
      const { executors, fixPaths } = makeExecutors();
      const handler = createHandler(executors, inMemoryMemoFactory());

      await handler(bashInput(repo, `sed -i 's/a/b/' ${join(repo.root, 's.txt')}`) as never, { logger } as never);

      expect(fixPaths).toEqual([join(repo.root, 's.txt')]);
    } finally {
      repo.cleanup();
    }
  });

  it.skip('git apply: modify touch on the hunk target', async () => {
    const repo = makeTempRepo();
    try {
      const diff = ['--- a/notes.txt', '+++ b/notes.txt', '@@ -1,3 +1,3 @@', ' one', '-two', "+two'", ' three'].join(
        '\n'
      );
      seed(repo, [
        ['notes.txt', "one\ntwo'\nthree\n"],
        ['patch.diff', `${diff}\n`]
      ]);
      const { executors, fixPaths } = makeExecutors();
      const handler = createHandler(executors, inMemoryMemoFactory());

      await handler(bashInput(repo, `git apply ${join(repo.root, 'patch.diff')}`) as never, { logger } as never);

      expect(fixPaths).toEqual([join(repo.root, 'notes.txt')]);
    } finally {
      repo.cleanup();
    }
  });

  it.skip('formatter: prettier --write produces a modify touch', async () => {
    const repo = makeTempRepo();
    try {
      seed(repo, [['fmt.ts', 'export const x = 1;\n']]);
      const { executors, fixPaths } = makeExecutors();
      const handler = createHandler(executors, inMemoryMemoFactory());

      await handler(bashInput(repo, `prettier --write ${join(repo.root, 'fmt.ts')}`) as never, { logger } as never);

      expect(fixPaths).toEqual([join(repo.root, 'fmt.ts')]);
    } finally {
      repo.cleanup();
    }
  });

  it.skip('git restore f: create-overwrite touch', async () => {
    const repo = makeTempRepo();
    try {
      seed(repo, [['r.txt', 'x\n']]);
      const { executors, fixPaths } = makeExecutors();
      const handler = createHandler(executors, inMemoryMemoFactory());

      await handler(bashInput(repo, `git restore ${join(repo.root, 'r.txt')}`) as never, { logger } as never);

      expect(fixPaths).toEqual([join(repo.root, 'r.txt')]);
    } finally {
      repo.cleanup();
    }
  });

  it.skip('git checkout -- f: create-overwrite touch', async () => {
    const repo = makeTempRepo();
    try {
      seed(repo, [['k.txt', 'x\n']]);
      const { executors, fixPaths } = makeExecutors();
      const handler = createHandler(executors, inMemoryMemoFactory());

      await handler(bashInput(repo, `git checkout -- ${join(repo.root, 'k.txt')}`) as never, { logger } as never);

      expect(fixPaths).toEqual([join(repo.root, 'k.txt')]);
    } finally {
      repo.cleanup();
    }
  });

  it.skip('no touch for non-family hosts: ls > f and echo x 2> err', async () => {
    const repo = makeTempRepo();
    try {
      seed(repo, [
        ['f.txt', 'x\n'],
        ['err.txt', '']
      ]);
      const { executors, calls } = makeExecutors();
      const handler = createHandler(executors, inMemoryMemoFactory());

      await handler(bashInput(repo, `ls > ${join(repo.root, 'f.txt')}`) as never, { logger } as never);
      await handler(bashInput(repo, `echo x 2> ${join(repo.root, 'err.txt')}`) as never, { logger } as never);

      expect(calls).toEqual({ fix: 0, list: 0, drift: 0, why: 0 });
    } finally {
      repo.cleanup();
    }
  });
});

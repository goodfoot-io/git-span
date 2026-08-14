/**
 * Tests for the Claude PostToolUse touch hook
 * (packages/agent-hooks/src/claude/post-tool-use.ts).
 *
 * The adapter translates a Read/Edit/Write tool call into a TouchInput and drives
 * the shared runTouchHook core with injected executors and an in-memory memo.
 * These exercise the adapter's translation and fail-open wiring; the healing /
 * surfacing / cadence logic itself is covered by test/common/touch-core.test.ts.
 */

import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@goodfoot/claude-code-hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import hook, { createHandler } from '../../src/claude/post-tool-use.js';
import { createHandler as createStaticPlanHandler } from '../../src/claude/static-plan.js';
import type { DriftPorcelainRow, PorcelainRow, PorcelainStatus } from '../../src/common/agent-hooks-common.js';
import type { MemoFactory, MemoLogger, MemoStore } from '../../src/common/span-surface.js';
import type { TouchExecutors, TouchFixResult } from '../../src/common/touch-core.js';
import { makeTempRepo } from '../helpers.js';
import { makeTempLayout } from '../session-layout-helpers.js';

/**
 * This file's own session base, on /tmp. Static plans and memo state must not
 * leak fixture session ids into the live `~/.cache/git-span/session` tree.
 */
const temp = makeTempLayout();
const layout = temp.layout;
afterAll(() => temp.cleanup());

const logger = new Logger();

function trackAll(root: string): void {
  execFileSync('git', ['add', '-A'], { cwd: root });
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FakeOpts {
  list?: PorcelainRow[];
  drift?: DriftPorcelainRow[];
  fixModified?: boolean;
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
      return { modified: opts.fixModified ?? false };
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
      return WHY;
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
const WHY = 'Checkout request flow that carries a charge attempt from the browser to the Stripe-backed server.';
function porcelainRow(): PorcelainRow {
  return { name: SPAN, path: 'app.ts', start: 1, end: 10 };
}
function driftRow(status: PorcelainStatus): DriftPorcelainRow {
  return { name: SPAN, path: 'app.ts', start: 1, end: 10, status };
}

let nextToolUseId = 0;

function postInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  nextToolUseId += 1;
  return {
    hook_event_name: 'PostToolUse' as const,
    session_id: 'sess-1',
    transcript_path: '/tmp/t',
    cwd: '/tmp',
    tool_use_id: `tu-${nextToolUseId}`,
    tool_name: 'Read',
    tool_input: {},
    tool_response: {},
    ...overrides
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

describe('claude post-tool-use hook registration', () => {
  it('registers PostToolUse with matcher Read|Edit|Write|Bash', () => {
    expect(hook.hookEventName).toBe('PostToolUse');
    expect(hook.matcher).toBe('Read|Edit|Write|Bash');
  });
});

describe('claude post-tool-use touch signal', () => {
  let repo: { root: string; cleanup: () => void };
  beforeAll(() => {
    repo = makeTempRepo();
    // The Edit/Write fixtures target `app.ts` at the repo root, and the write
    // gate (plan §3 step 1) fails closed when the target is not on disk — the
    // hook runs post-tool, so the file exists by then.
    writeFileSync(join(repo.root, 'app.ts'), 'export const app = 1;\n');
    trackAll(repo.root);
  });
  afterAll(() => repo.cleanup());

  it('heals and folds a semantic directive on an Edit, on both output channels', async () => {
    const { executors, calls } = makeExecutors({ list: [porcelainRow()], drift: [driftRow('CHANGED')] });
    const handler = createHandler(executors, inMemoryMemoFactory(), layout);
    const input = postInput({
      cwd: repo.root,
      tool_name: 'Edit',
      tool_input: { file_path: join(repo.root, 'app.ts'), old_string: 'a', new_string: 'export const app = 1;\n' }
    });

    const result = toResult(await handler(input as never, { logger }));
    expect(calls.fix).toBe(1); // write path heals the tree
    const ctx = result.stdout.hookSpecificOutput?.additionalContext ?? '';
    expect(ctx).toContain(SPAN);
    expect(ctx).toContain('— changed');
    expect(result.stdout.systemMessage).toContain(SPAN);
  });

  it('never invokes fix on a Read and surfaces nothing for positional-only drift', async () => {
    const { executors, calls } = makeExecutors({ list: [porcelainRow()], drift: [driftRow('MOVED')] });
    const handler = createHandler(executors, inMemoryMemoFactory(), layout);
    const input = postInput({
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: join(repo.root, 'app.ts') }
    });

    const result = toResult(await handler(input as never, { logger }));
    expect(calls.fix).toBe(0); // read path never heals
    expect(result.stdout.systemMessage).toBeUndefined();
    expect(result.stdout.hookSpecificOutput?.additionalContext).toBeUndefined();
  });

  it('scopes a Read to its offset/limit window, not surfacing a span anchored outside it', async () => {
    const filePath = join(repo.root, 'mod.rs');
    writeFileSync(filePath, Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join('\n'));
    trackAll(repo.root);
    const { executors } = makeExecutors({ list: [{ name: SPAN, path: 'mod.rs', start: 371, end: 387 }] });
    const handler = createHandler(executors, inMemoryMemoFactory(), layout);
    const input = postInput({
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: filePath, offset: 39, limit: 60 }
    });

    const result = toResult(await handler(input as never, { logger }));
    expect(result.stdout.hookSpecificOutput?.additionalContext).toBeUndefined();
  });

  it('surfaces a span anchored inside a Read offset/limit window', async () => {
    const filePath = join(repo.root, 'mod.rs');
    writeFileSync(filePath, Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join('\n'));
    trackAll(repo.root);
    const { executors } = makeExecutors({ list: [{ name: SPAN, path: 'mod.rs', start: 39, end: 189 }] });
    const handler = createHandler(executors, inMemoryMemoFactory(), layout);
    const input = postInput({
      cwd: repo.root,
      tool_name: 'Read',
      tool_input: { file_path: filePath, offset: 39, limit: 60 }
    });

    const result = toResult(await handler(input as never, { logger }));
    expect(result.stdout.hookSpecificOutput?.additionalContext).toContain(SPAN);
  });

  it('fails open (empty output, no throw) when every executor rejects', async () => {
    const { executors } = makeExecutors({ reject: true });
    const handler = createHandler(executors, inMemoryMemoFactory(), layout);
    const input = postInput({
      cwd: repo.root,
      tool_name: 'Write',
      tool_input: { file_path: join(repo.root, 'app.ts'), content: 'export const app = 1;\n' }
    });

    const result = toResult(await handler(input as never, { logger }));
    expect(result.stdout.systemMessage).toBeUndefined();
    expect(result.stdout.hookSpecificOutput?.additionalContext).toBeUndefined();
  });

  it('does not run the touch core for an out-of-repo cwd', async () => {
    const { executors, calls } = makeExecutors({ list: [porcelainRow()], drift: [driftRow('CHANGED')] });
    const handler = createHandler(executors, inMemoryMemoFactory(), layout);
    const input = postInput({
      cwd: '/',
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/some.ts' }
    });

    const result = toResult(await handler(input as never, { logger }));
    expect(calls.list).toBe(0);
    expect(calls.fix).toBe(0);
    expect(result.stdout.systemMessage).toBeUndefined();
  });

  it('surfaces a span covered by a Bash read idiom, without healing', async () => {
    const filePath = join(repo.root, 'mod.rs');
    writeFileSync(filePath, Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join('\n'));
    trackAll(repo.root);
    const { executors, calls } = makeExecutors({
      list: [{ name: SPAN, path: 'mod.rs', start: 39, end: 189 }],
      drift: [driftRow('CHANGED')]
    });
    const handler = createHandler(executors, inMemoryMemoFactory(), layout);
    const input = postInput({
      cwd: repo.root,
      tool_name: 'Bash',
      tool_input: { command: `sed -n '39,60p' ${filePath}` }
    });

    const result = toResult(await handler(input as never, { logger }));
    expect(calls.fix).toBe(0); // read path never heals
    expect(result.stdout.hookSpecificOutput?.additionalContext).toContain(SPAN);
  });

  it('returns null for a Bash command with no recognized idiom (no executor calls)', async () => {
    const { executors, calls } = makeExecutors({ list: [porcelainRow()], drift: [driftRow('CHANGED')] });
    const handler = createHandler(executors, inMemoryMemoFactory(), layout);
    const input = postInput({
      cwd: repo.root,
      tool_name: 'Bash',
      tool_input: { command: 'echo hello && git status' }
    });

    const result = toResult(await handler(input as never, { logger }));
    expect(calls.list).toBe(0);
    expect(calls.fix).toBe(0);
    expect(result.stdout.systemMessage).toBeUndefined();
    expect(result.stdout.hookSpecificOutput?.additionalContext).toBeUndefined();
  });

  it('a Bash heredoc append is scoped to the written body, not the whole file', async () => {
    const filePath = join(repo.root, 'out.txt');
    // Post-edit state: original two lines + appended three lines.
    writeFileSync(filePath, `${['orig1', 'orig2', 'alpha', 'beta', 'gamma'].join('\n')}\n`);
    trackAll(repo.root);
    const command = `cat >> ${filePath} <<'EOF'\nalpha\nbeta\ngamma\nEOF\n`;
    const { executors, calls } = makeExecutors({
      list: [{ name: SPAN, path: 'out.txt', start: 1, end: 2 }],
      drift: [driftRow('CHANGED')]
    });
    const handler = createHandler(executors, inMemoryMemoFactory(), layout);
    const input = postInput({ cwd: repo.root, tool_name: 'Bash', tool_input: { command } });

    const result = toResult(await handler(input as never, { logger }));
    expect(calls.fix).toBe(1); // write path heals
    // The span anchored at lines 1-2 (original content) is outside the
    // appended body at lines 3-5. With `written: span.body` the touch is
    // scoped to the append range and this span does not surface — proving
    // the body reached the touch core (a whole-file touch would surface it).
    expect(result.stdout.hookSpecificOutput?.additionalContext).toBeUndefined();
  });

  it('a Bash heredoc write with the body present surfaces a span inside the written lines', async () => {
    const filePath = join(repo.root, 'out2.txt');
    writeFileSync(filePath, `${['alpha', 'beta', 'gamma'].join('\n')}\n`);
    trackAll(repo.root);
    const command = `cat > ${filePath} <<'EOF'\nalpha\nbeta\ngamma\nEOF\n`;
    const { executors } = makeExecutors({
      list: [{ name: SPAN, path: 'out2.txt', start: 1, end: 2 }],
      drift: [driftRow('CHANGED')]
    });
    const handler = createHandler(executors, inMemoryMemoFactory(), layout);
    const input = postInput({ cwd: repo.root, tool_name: 'Bash', tool_input: { command } });

    const result = toResult(await handler(input as never, { logger }));
    expect(result.stdout.hookSpecificOutput?.additionalContext).toContain(SPAN);
  });

  it('a Bash heredoc > overwrite surfaces a span truncated beyond the new EOF (whole-file scope)', async () => {
    const filePath = join(repo.root, 'out3.txt');
    // Post-edit state: the heredoc wrote only 3 lines, down from 10.
    writeFileSync(filePath, `${['alpha', 'beta', 'gamma'].join('\n')}\n`);
    trackAll(repo.root);
    const command = `cat > ${filePath} <<'EOF'\nalpha\nbeta\ngamma\nEOF\n`;
    const { executors, calls } = makeExecutors({
      list: [{ name: SPAN, path: 'out3.txt', start: 8, end: 10 }],
      drift: [driftRow('DELETED')]
    });
    const handler = createHandler(executors, inMemoryMemoFactory(), layout);
    const input = postInput({ cwd: repo.root, tool_name: 'Bash', tool_input: { command } });

    const result = toResult(await handler(input as never, { logger }));
    expect(calls.fix).toBe(1); // write path heals
    // The span at lines 8-10 was beyond the new EOF (3 lines). With
    // `written: ''` (whole-file scope from `redirect: '>'`) the touch core
    // surfaces it as deleted — previously this was silent because the body
    // was not threaded into the touch.
    expect(result.stdout.hookSpecificOutput?.additionalContext).toContain(SPAN);
  });

  // -------------------------------------------------------------------------
  // Response-derived Bash read touches (Phase 3e): the tool_response is a
  // second evidence source for grep/ripgrep and git diff/show/log -p
  // commands whose read windows live in the output, not the command text.
  // Every documented envelope shape must normalize to the same spans
  // (notes/response-envelope-shapes.md), and a truncated response must fail
  // closed — the inline stdout of a rawOutputPath spill is only a preview.
  // -------------------------------------------------------------------------

  describe('response-derived Bash read touches', () => {
    /** A 500-line mod.rs whose `list` fake anchors SPAN at lines 39-189. */
    function writeModRs(): string {
      const filePath = join(repo.root, 'mod.rs');
      writeFileSync(filePath, Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join('\n'));
      trackAll(repo.root);
      return filePath;
    }

    it('string, current-object, legacy-object, and text-block-array envelopes drive the same read touch', async () => {
      const filePath = writeModRs();
      const envelopes: unknown[] = [
        `${filePath}:50:alpha\n`,
        { stdout: `${filePath}:50:alpha\n`, stderr: '', rawOutputPath: undefined, interrupted: false },
        { output: `${filePath}:50:alpha\n`, success: true, exitCode: 0, filePath: undefined },
        [{ type: 'text', text: `${filePath}:50:alpha\n` }]
      ];
      for (const toolResponse of envelopes) {
        const { executors, calls } = makeExecutors({
          list: [{ name: SPAN, path: 'mod.rs', start: 39, end: 189 }],
          drift: [driftRow('CHANGED')]
        });
        const handler = createHandler(executors, inMemoryMemoFactory(), layout);
        const input = postInput({
          cwd: repo.root,
          tool_name: 'Bash',
          tool_input: { command: `rg -n alpha ${filePath}` },
          tool_response: toolResponse
        });

        const result = toResult(await handler(input as never, { logger }));
        expect(calls.fix).toBe(0); // read path never heals
        expect(result.stdout.hookSpecificOutput?.additionalContext, JSON.stringify(toolResponse)).toContain(SPAN);
      }
    });

    it('a response-derived touch is windowed to the response lines, not whole-file', async () => {
      const filePath = writeModRs();
      const { executors } = makeExecutors({
        list: [{ name: SPAN, path: 'mod.rs', start: 39, end: 189 }],
        drift: [driftRow('CHANGED')]
      });
      const handler = createHandler(executors, inMemoryMemoFactory(), layout);
      const input = postInput({
        cwd: repo.root,
        tool_name: 'Bash',
        tool_input: { command: `rg -n alpha ${filePath}` },
        tool_response: `${filePath}:400:alpha\n`
      });

      const result = toResult(await handler(input as never, { logger }));
      // Line 400 sits outside the span's 39-189 anchor; a whole-file-scoped
      // touch would surface it, so its absence proves the touch window came
      // from the response record.
      expect(result.stdout.hookSpecificOutput?.additionalContext).toBeUndefined();
    });

    it('a rawOutputPath spill fails closed, as do interrupted or timed-out responses (the interrupted gate)', async () => {
      const filePath = writeModRs();
      const { executors, calls } = makeExecutors({
        list: [{ name: SPAN, path: 'mod.rs', start: 39, end: 189 }],
        drift: [driftRow('CHANGED')]
      });
      const handler = createHandler(executors, inMemoryMemoFactory(), layout);
      const stdout = `${filePath}:50:alpha\n`;

      // Plan step 6's strict regime: `rawOutputPath` set means the inline
      // stdout is only a preview — the parser fails closed and invents no
      // touches.
      const spillInput = postInput({
        cwd: repo.root,
        tool_name: 'Bash',
        tool_input: { command: `rg -n alpha ${filePath}` },
        tool_response: { stdout, stderr: '', rawOutputPath: '/tmp/large.out', interrupted: false }
      });
      const spillResult = toResult(await handler(spillInput as never, { logger }));
      expect(calls.list).toBe(0);
      expect(spillResult.stdout.hookSpecificOutput?.additionalContext).toBeUndefined();

      // The interrupted gate (plan §4): `interrupted`/`timedOutAfterMs` mean
      // the command did not complete — no touches for the whole command,
      // whatever its spans. This supersedes the complete-records regime
      // (plan step 6), which parsed the fully-terminated records. Each
      // envelope gets its own session so the shared memo's surface dedupe
      // cannot mask a missing output.
      for (const [index, toolResponse] of [
        { stdout, stderr: '', interrupted: true },
        { stdout, stderr: '', timedOutAfterMs: 60_000 }
      ].entries()) {
        const listBefore = calls.list;
        const input = postInput({
          cwd: repo.root,
          session_id: `sess-two-regime-${index}`,
          tool_name: 'Bash',
          tool_input: { command: `rg -n alpha ${filePath}` },
          tool_response: toolResponse
        });
        const result = toResult(await handler(input as never, { logger }));
        expect(calls.list - listBefore, JSON.stringify(toolResponse)).toBe(0);
        expect(result.stdout.hookSpecificOutput?.additionalContext, JSON.stringify(toolResponse)).toBeUndefined();
      }
    });

    it('merges command-derived and response-derived spans, deduping the surface via the memo', async () => {
      const filePath = writeModRs();
      // `git log -p -L 39,60:mod.rs` is at once a command-derived read idiom
      // (parseCommandDetailed resolves the literal -L range) and a diff-form
      // git log (parseResponse decodes the patch response) — the two
      // evidence sources merge into overlapping read touches on one file.
      const command = `git log -p -L 39,60:${filePath}`;
      const diffResponse = [
        `diff --git a/${filePath} b/${filePath}`,
        'index 551e09f4..48593813 100644',
        `--- a/${filePath}`,
        `+++ b/${filePath}`,
        '@@ -39,6 +39,6 @@',
        ' line 39',
        ' line 40',
        '-line 41',
        '+line 41 CHANGED',
        ' line 42',
        ' line 43',
        ' line 44',
        ''
      ].join('\n');
      const { executors, calls } = makeExecutors({
        list: [{ name: SPAN, path: 'mod.rs', start: 39, end: 189 }],
        drift: []
      });
      const handler = createHandler(executors, inMemoryMemoFactory(), layout);
      const input = postInput({
        cwd: repo.root,
        tool_name: 'Bash',
        tool_input: { command },
        tool_response: diffResponse
      });

      const result = toResult(await handler(input as never, { logger }));
      expect(calls.fix).toBe(0); // both sources are reads
      expect(calls.list).toBe(2); // one touch per merged source
      const ctx = result.stdout.hookSpecificOutput?.additionalContext ?? '';
      expect(ctx).toContain(SPAN);
      // The response-derived hunk overlaps the command-derived range on the
      // same span; the per-session memo dedupes the duplicate surface.
      expect(ctx.match(/## billing\/checkout-request-flow/g) ?? []).toHaveLength(1);
    });
  });
});

describe('Bash write touches per family (Phase 2 — skipped acceptance checks)', () => {
  let repo: { root: string; cleanup: () => void };
  beforeAll(() => {
    repo = makeTempRepo();
  });
  afterAll(() => repo.cleanup());

  const p = (rel: string): string => join(repo.root, rel);

  /**
   * Seed post-command file state: write `files` (a `null` content is a
   * placeholder written so it can be tracked), git-add the tracked ones, then
   * delete the `null`-content ones. Index entries survive `rm`.
   */
  function seed(files: Array<[string, string | null]>, _tracked: string[] = []): void {
    for (const [rel, content] of files) {
      writeFileSync(p(rel), content ?? 'placeholder\n');
    }
    trackAll(repo.root);
    for (const [rel, content] of files) {
      if (content === null) rmSync(p(rel), { force: true });
    }
  }

  function bashInput(command: string): Record<string, unknown> {
    return postInput({ cwd: repo.root, tool_name: 'Bash', tool_input: { command } });
  }

  it('redirection: echo hello > f produces a whole-file write touch on f', async () => {
    seed([['f.txt', 'hello\n']]);
    const { executors, fixPaths } = makeExecutors();
    const handler = createHandler(executors, inMemoryMemoFactory(), layout);

    await handler(bashInput(`echo hello > ${p('f.txt')}`) as never, { logger });

    expect(fixPaths).toEqual([p('f.txt')]);
  });

  it('redirection: echo x >> f threads the append body into the write touch', async () => {
    seed([['f.txt', 'a\nx\n']]);
    const { executors, fixPaths } = makeExecutors();
    const handler = createHandler(executors, inMemoryMemoFactory(), layout);

    await handler(bashInput(`echo x >> ${p('f.txt')}`) as never, { logger });

    expect(fixPaths).toEqual([p('f.txt')]);
  });

  it('heredoc: cat > f <<EOF produces a whole-file write touch on f', async () => {
    seed([['h.txt', 'alpha\n']]);
    const command = `cat > ${p('h.txt')} <<'EOF'\nalpha\nEOF\n`;
    const { executors, fixPaths } = makeExecutors();
    const handler = createHandler(executors, inMemoryMemoFactory(), layout);

    await handler(bashInput(command) as never, { logger });

    expect(fixPaths).toEqual([p('h.txt')]);
  });

  it('cp: read on the source, create-overwrite on the dest', async () => {
    seed([
      ['a.txt', 's1\ns2\n'],
      ['b.txt', 's1\ns2\n']
    ]);
    const { executors, fixPaths, listPaths } = makeExecutors();
    const handler = createHandler(executors, inMemoryMemoFactory(), layout);

    await handler(bashInput(`cp ${p('a.txt')} ${p('b.txt')}`) as never, { logger });

    expect(fixPaths).toEqual([p('b.txt')]);
    expect(listPaths).toContain(p('a.txt'));
  });

  it('mv: delete on the source, rename-copy on the dest', async () => {
    seed(
      [
        ['a.txt', null],
        ['c.txt', 'a1\na2\n']
      ],
      ['a.txt']
    );
    const { executors, fixPaths } = makeExecutors();
    const handler = createHandler(executors, inMemoryMemoFactory(), layout);

    await handler(bashInput(`mv ${p('a.txt')} ${p('c.txt')}`) as never, { logger });

    expect(fixPaths).toEqual([p('a.txt'), p('c.txt')]);
  });

  it('rm: delete touch on a real (index-tracked, deleted) target', async () => {
    seed([['d.txt', null]], ['d.txt']);
    const { executors, fixPaths } = makeExecutors();
    const handler = createHandler(executors, inMemoryMemoFactory(), layout);

    await handler(bashInput(`rm ${p('d.txt')}`) as never, { logger });

    expect(fixPaths).toEqual([p('d.txt')]);
  });

  it('truncate -s 0: truncate touch on an empty post-command file', async () => {
    seed([['e.txt', '']]);
    const { executors, fixPaths } = makeExecutors();
    const handler = createHandler(executors, inMemoryMemoFactory(), layout);

    await handler(bashInput(`truncate -s 0 ${p('e.txt')}`) as never, { logger });

    expect(fixPaths).toEqual([p('e.txt')]);
  });

  it('sed -i: modify touch (script-first disambiguation)', async () => {
    seed([['s.txt', 'a\n']]);
    const { executors, fixPaths } = makeExecutors();
    const handler = createHandler(executors, inMemoryMemoFactory(), layout);
    const command = `sed -i 's/a/b/' ${p('s.txt')}`;
    await createStaticPlanHandler(layout)(
      {
        session_id: 'sess-1',
        tool_use_id: 'tu-sed-plan',
        cwd: repo.root,
        tool_name: 'Bash',
        tool_input: { command }
      } as never,
      { logger } as never
    );
    writeFileSync(p('s.txt'), 'b\n');

    await handler({ ...bashInput(command), tool_use_id: 'tu-sed-plan' } as never, { logger });

    expect(fixPaths).toEqual([p('s.txt')]);
  });

  it('git apply: modify touch on the hunk target', async () => {
    const diff = ['--- a/notes.txt', '+++ b/notes.txt', '@@ -1,3 +1,3 @@', ' one', '-two', "+two'", ' three'].join(
      '\n'
    );
    seed([
      ['notes.txt', "one\ntwo'\nthree\n"],
      ['patch.diff', `${diff}\n`]
    ]);
    const { executors, fixPaths } = makeExecutors();
    const handler = createHandler(executors, inMemoryMemoFactory(), layout);

    await handler(bashInput(`git apply ${p('patch.diff')}`) as never, { logger });

    expect(fixPaths).toEqual([p('notes.txt')]);
  });

  it('formatter: prettier --write produces a modify touch', async () => {
    seed([['fmt.ts', 'export const x = 1;\n']]);
    const { executors, fixPaths } = makeExecutors();
    const handler = createHandler(executors, inMemoryMemoFactory(), layout);

    await handler(bashInput(`prettier --write ${p('fmt.ts')}`) as never, { logger });

    expect(fixPaths).toEqual([p('fmt.ts')]);
  });

  it('git restore f: create-overwrite touch', async () => {
    seed([['r.txt', 'x\n']]);
    const { executors, fixPaths } = makeExecutors();
    const handler = createHandler(executors, inMemoryMemoFactory(), layout);

    await handler(bashInput(`git restore ${p('r.txt')}`) as never, { logger });

    expect(fixPaths).toEqual([p('r.txt')]);
  });

  it('git checkout -- f: create-overwrite touch', async () => {
    seed([['k.txt', 'x\n']]);
    const { executors, fixPaths } = makeExecutors();
    const handler = createHandler(executors, inMemoryMemoFactory(), layout);

    await handler(bashInput(`git checkout -- ${p('k.txt')}`) as never, { logger });

    expect(fixPaths).toEqual([p('k.txt')]);
  });

  it('no touch for non-family hosts: ls > f and echo x 2> err', async () => {
    seed([
      ['f.txt', 'x\n'],
      ['err.txt', '']
    ]);
    const { executors, calls } = makeExecutors();
    const handler = createHandler(executors, inMemoryMemoFactory(), layout);

    await handler(bashInput(`ls > ${p('f.txt')}`) as never, { logger });
    await handler(bashInput(`echo x 2> ${p('err.txt')}`) as never, { logger });

    expect(calls).toEqual({ fix: 0, list: 0, drift: 0, why: 0 });
  });
});

/**
 * Tests for the Codex PostToolUse hook (packages/agent-hooks/src/codex/post-tool-use.ts).
 *
 * Job A (journal): parse the confirmed apply_patch envelope into anchors and
 * append the write entries to the per-session touch journal the Stop core drains.
 * Two invariants are exercised against real timing semantics (no injected
 * reader): journaling is suppressed only on a *confirmed non-success*
 * tool_response (a genuine rejection), and every anchor is whole-file (no
 * post-edit range recovery). A real temp git repo backs the scope resolution.
 *
 * Success fixtures are built by {@link printSummary}, which mirrors Codex's real
 * `print_summary` (codex-rs/apply-patch/src/lib.rs:871 — header
 * `Success. Updated the following files:` then `A/M/D <path>` lines, fixed across
 * Add/Modify/Delete) rather than hand-typing the bare header the code checks for.
 */

import * as fs from 'node:fs';
import { Logger } from '@goodfoot/codex-hooks';
import { afterEach, describe, expect, it } from 'vitest';
import hook, { classifyApplyPatchResponse, createHandler } from '../../src/codex/post-tool-use.js';
import { type JournalEntry, journalPath, loadJournal } from '../../src/common/stop-core.js';
import { makeTempRepo } from '../helpers.js';

const logger = new Logger();

/**
 * Reproduce Codex's apply_patch success stdout — the exact shape of
 * `print_summary` in codex-rs/apply-patch/src/lib.rs:871:
 *
 *   writeln!(out, "Success. Updated the following files:")?;
 *   for path in &affected.added    { writeln!(out, "A {}", path.display())?; }
 *   for path in &affected.modified { writeln!(out, "M {}", path.display())?; }
 *   for path in &affected.deleted  { writeln!(out, "D {}", path.display())?; }
 *
 * Building the fixture from that format (rather than pasting the literal the
 * detector matches) keeps the test from being self-confirming.
 */
function printSummary(paths: { added?: string[]; modified?: string[]; deleted?: string[] }): string {
  const lines = ['Success. Updated the following files:'];
  for (const p of paths.added ?? []) lines.push(`A ${p}`);
  for (const p of paths.modified ?? []) lines.push(`M ${p}`);
  for (const p of paths.deleted ?? []) lines.push(`D ${p}`);
  return `${lines.join('\n')}\n`;
}

/** A realistic multi-file confirmed apply — Codex surfaces this verbatim as tool_response. */
const SUCCESS_RESPONSE = printSummary({ added: ['nested/new.ts'], modified: ['foo.ts'], deleted: ['old.ts'] });

/**
 * A genuine apply_patch rejection as the *model* sees it — Codex delivers a
 * failure via `FunctionCallError::RespondToModel(message)` as a bare
 * tool_response string (codex-rs/core/src/stream_events_utils.rs:392). This is
 * the verification-failure message from
 * codex-rs/core/src/tools/handlers/apply_patch.rs:367
 * ("apply_patch verification failed: {parse_error}"). Clearly lacks the success
 * header, so it must suppress journaling.
 */
const FAILURE_RESPONSE = 'apply_patch verification failed: context not found in foo.ts';

/** Update `foo.ts` line 3 (block beta/gamma/delta → lines 2-4). */
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

function addEnvelope(path = 'brand-new.ts'): string {
  return ['*** Begin Patch', `*** Add File: ${path}`, '+hello', '*** End Patch'].join('\n');
}

function postInput(
  sessionId: string,
  cwd: string,
  command: unknown,
  toolResponse: unknown = SUCCESS_RESPONSE
): Record<string, unknown> {
  return {
    hook_event_name: 'PostToolUse' as const,
    session_id: sessionId,
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

/** A logger that records the messages of every `warn` it receives. */
function warnCapturingLogger(): { logger: Logger; warnings: string[] } {
  const warnings: string[] = [];
  const capture = new Logger();
  capture.on('warn', (event) => warnings.push(event.message));
  return { logger: capture, warnings };
}

const sids: string[] = [];
afterEach(() => {
  for (const sid of sids) {
    const p = journalPath(sid);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  sids.length = 0;
});

function sid(label: string): string {
  const id = `codex-post-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sids.push(id);
  return id;
}

describe('codex post-tool-use hook registration', () => {
  it('registers PostToolUse with matcher apply_patch', () => {
    expect(hook.hookEventName).toBe('PostToolUse');
    expect(hook.matcher).toBe('apply_patch');
  });
});

describe('classifyApplyPatchResponse', () => {
  it("classifies a bare-string success (today's Codex shape) as success", () => {
    expect(classifyApplyPatchResponse(SUCCESS_RESPONSE)).toBe('success');
    // Every single-op variant carries the same fixed header.
    expect(classifyApplyPatchResponse(printSummary({ added: ['new.ts'] }))).toBe('success');
    expect(classifyApplyPatchResponse(printSummary({ modified: ['foo.ts'] }))).toBe('success');
    expect(classifyApplyPatchResponse(printSummary({ deleted: ['old.ts'] }))).toBe('success');
  });

  it('extracts and accepts success text from an object-wrapped tool_response', () => {
    // Durability against Codex ever wrapping the stdout instead of surfacing a
    // bare string (its FunctionCallOutputBody already has a ContentItems variant).
    expect(classifyApplyPatchResponse({ output: SUCCESS_RESPONSE })).toBe('success');
    expect(classifyApplyPatchResponse({ stdout: SUCCESS_RESPONSE })).toBe('success');
    expect(classifyApplyPatchResponse({ content: SUCCESS_RESPONSE })).toBe('success');
    expect(classifyApplyPatchResponse({ text: SUCCESS_RESPONSE })).toBe('success');
  });

  it('classifies recovered-but-headerless text as failure (a genuine rejection)', () => {
    expect(classifyApplyPatchResponse(FAILURE_RESPONSE)).toBe('failure');
    expect(classifyApplyPatchResponse({ output: FAILURE_RESPONSE })).toBe('failure');
    expect(classifyApplyPatchResponse('')).toBe('failure');
  });

  it('classifies an unrecoverable shape as unknown (default-to-journal territory)', () => {
    expect(classifyApplyPatchResponse({})).toBe('unknown');
    expect(classifyApplyPatchResponse({ exitCode: 0 })).toBe('unknown');
    expect(classifyApplyPatchResponse(undefined)).toBe('unknown');
    expect(classifyApplyPatchResponse(null)).toBe('unknown');
    expect(classifyApplyPatchResponse(42)).toBe('unknown');
    // A non-string field is not usable text → still unknown.
    expect(classifyApplyPatchResponse({ output: { nested: 'x' } })).toBe('unknown');
  });
});

describe('codex post-tool-use journaling', () => {
  it('journals an Update as a whole-write anchor with no range on success', async () => {
    const repo = makeTempRepo();
    try {
      const id = sid('write');
      // Write genuine (pre-edit) content: were range recovery still active at Post
      // it would read this file and coarsen/mis-anchor. We assert it does neither.
      fs.writeFileSync(`${repo.root}/foo.ts`, 'alpha\nbeta\ngamma\ndelta\nepsilon\n');
      const handler = createHandler();
      await handler(postInput(id, repo.root, updateEnvelope()) as never, { logger } as never);

      const entries = loadJournal(id) as JournalEntry[] | null;
      expect(entries).not.toBeNull();
      expect(entries).toHaveLength(1);
      expect(entries![0].tool).toBe('apply_patch');
      expect(entries![0].path).toBe('foo.ts');
      expect(entries![0].kind).toBe('whole-write');
      expect(entries![0].start).toBeUndefined();
      expect(entries![0].end).toBeUndefined();
      expect(entries![0].seen).toBe(false);
    } finally {
      repo.cleanup();
    }
  });

  it('journals a success whose tool_response is object-wrapped', async () => {
    const repo = makeTempRepo();
    try {
      const id = sid('wrapped');
      const handler = createHandler();
      // {output: "<print_summary>"} — the wrapper scenario the shape-tolerant
      // detector defends. Must journal exactly as a bare-string success would.
      await handler(
        postInput(id, repo.root, addEnvelope(), { output: printSummary({ added: ['brand-new.ts'] }) }) as never,
        { logger } as never
      );

      const entries = loadJournal(id) as JournalEntry[] | null;
      expect(entries).toHaveLength(1);
      expect(entries![0].path).toBe('brand-new.ts');
      expect(entries![0].kind).toBe('create');
    } finally {
      repo.cleanup();
    }
  });

  it('journals (and warns) when the tool_response shape is unrecognized', async () => {
    const repo = makeTempRepo();
    try {
      const id = sid('unknown');
      const { logger: capture, warnings } = warnCapturingLogger();
      const handler = createHandler();
      // No recoverable text. Codex core fires PostToolUse only on success, so
      // defaulting to journal here cannot manufacture a phantom write — and it
      // removes the "never journals" total-loss failure. Warn on the way through.
      await handler(
        postInput(id, repo.root, updateEnvelope(), { exitCode: 0 }) as never,
        {
          logger: capture
        } as never
      );

      const entries = loadJournal(id) as JournalEntry[] | null;
      expect(entries).toHaveLength(1);
      expect(entries![0].path).toBe('foo.ts');
      expect(entries![0].kind).toBe('whole-write');
      expect(warnings.some((m) => m.includes('unrecognized'))).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it('never recovers a post-edit range, even when the real reader can read the file', async () => {
    const repo = makeTempRepo();
    const savedCwd = process.cwd();
    try {
      const id = sid('postedit');
      // Reproduce the post-edit hazard against the *real* reader: run the hook
      // from the repo so `defaultReadPreEditFile('foo.ts')` resolves and reads
      // the on-disk file. The file is already POST-edit — the hunk's pre-edit
      // block (beta/gamma/delta) no longer sits where the edit happened (now
      // beta/GAMMA/delta at lines 2-4) but an untouched duplicate remains at
      // lines 6-8. Post-edit range recovery would uniquely (and wrongly) anchor
      // that copy as write 6-8. Whole-file journaling must ignore the file.
      fs.writeFileSync(`${repo.root}/foo.ts`, 'header\nbeta\nGAMMA\ndelta\ntail\nbeta\ngamma\ndelta\n');
      process.chdir(repo.root);
      const handler = createHandler();
      await handler(postInput(id, repo.root, updateEnvelope()) as never, { logger } as never);

      const entries = loadJournal(id) as JournalEntry[] | null;
      expect(entries).toHaveLength(1);
      expect(entries![0].kind).toBe('whole-write');
      expect(entries![0].start).toBeUndefined();
      expect(entries![0].end).toBeUndefined();
    } finally {
      process.chdir(savedCwd);
      repo.cleanup();
    }
  });

  it('journals an Add File envelope as a create anchor (no range) on success', async () => {
    const repo = makeTempRepo();
    try {
      const id = sid('create');
      const handler = createHandler();
      await handler(postInput(id, repo.root, addEnvelope()) as never, { logger } as never);

      const entries = loadJournal(id) as JournalEntry[] | null;
      expect(entries).not.toBeNull();
      expect(entries).toHaveLength(1);
      expect(entries![0].path).toBe('brand-new.ts');
      expect(entries![0].kind).toBe('create');
      expect(entries![0].start).toBeUndefined();
    } finally {
      repo.cleanup();
    }
  });

  it('journals nothing when the tool_response is a confirmed rejection', async () => {
    const repo = makeTempRepo();
    try {
      const id = sid('failed');
      const { logger: capture, warnings } = warnCapturingLogger();
      const handler = createHandler();
      // A rejected apply_patch whose text plainly lacks the success header:
      // journaling a write here would be a phantom → false drift. Suppress, and
      // do NOT warn — this is a recognized non-success, not an unknown shape.
      await handler(
        postInput(id, repo.root, updateEnvelope(), FAILURE_RESPONSE) as never,
        {
          logger: capture
        } as never
      );
      expect(loadJournal(id)).toBeNull();
      expect(warnings).toHaveLength(0);
    } finally {
      repo.cleanup();
    }
  });

  it('journals nothing for a non-apply_patch tool_input', async () => {
    const repo = makeTempRepo();
    try {
      const id = sid('noop');
      const handler = createHandler();
      await handler(
        {
          hook_event_name: 'PostToolUse',
          session_id: id,
          cwd: repo.root,
          model: 'gpt-x',
          permission_mode: 'default',
          transcript_path: '/tmp/t',
          tool_name: 'apply_patch',
          tool_input: { notCommand: 'x' },
          tool_response: SUCCESS_RESPONSE,
          tool_use_id: 'tu-1',
          turn_id: 'turn-1'
        } as never,
        { logger } as never
      );
      expect(loadJournal(id)).toBeNull();
    } finally {
      repo.cleanup();
    }
  });
});

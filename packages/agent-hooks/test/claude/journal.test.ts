/**
 * Tests for the per-session JSONL touch journal appended by pre-tool-use.ts.
 *
 * Each test creates a fresh temp repo, invokes createHandler with real
 * dependencies, then reads back the touches.jsonl file written to
 * ~/.cache/git-span/session/<sanitizedSessionId>/touches.jsonl.
 */

import * as fs from 'node:fs';
import { writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { join } from 'node:path';
import { Logger } from '@goodfoot/claude-code-hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHandler, type MemoFactory, type SpanExecutor } from '../../src/claude/pre-tool-use.js';
import { sanitizeSessionId } from '../../src/common/agent-hooks-common.js';
import { makeTempRepo } from '../helpers.js';

const logger = new Logger();

// ---------------------------------------------------------------------------
// Journal path helper
// ---------------------------------------------------------------------------

function journalPath(sessionId: string): string {
  return nodePath.join(os.homedir(), '.cache', 'git-span', 'session', sanitizeSessionId(sessionId), 'touches.jsonl');
}

function readJournal(sessionId: string): Array<Record<string, unknown>> {
  const path = journalPath(sessionId);
  if (!fs.existsSync(path)) return [];
  return fs
    .readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function clearJournal(sessionId: string): void {
  const path = journalPath(sessionId);
  if (fs.existsSync(path)) fs.unlinkSync(path);
}

// ---------------------------------------------------------------------------
// Fake no-op executor (journal runs regardless of executor output)
// ---------------------------------------------------------------------------

const noopExecutor: SpanExecutor = (_args, _cwd) => '';

// In-memory memo factory to avoid disk memo side effects
function inMemoryMemoFactory(): MemoFactory {
  const store = new Map<string, Set<string>>();
  return (_logger) => ({
    getSurfaced: (sid) => new Set(store.get(sid) ?? []),
    addSurfaced: (sid, names) => {
      const s = store.get(sid) ?? new Set<string>();
      for (const n of names) s.add(n);
      store.set(sid, s);
    }
  });
}

function baseInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hook_event_name: 'PreToolUse' as const,
    tool_use_id: 'tu-1',
    transcript_path: '/tmp/t',
    tool_name: 'Read',
    tool_input: {},
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Journal: Read with offset+limit → kind=read with range', () => {
  let repo: { root: string; cleanup: () => void };
  const sid = `journal-test-read-ranged-${Date.now()}`;

  beforeAll(() => {
    repo = makeTempRepo();
    clearJournal(sid);
  });
  afterAll(() => {
    repo.cleanup();
    clearJournal(sid);
  });

  it('appends a read entry with start/end', async () => {
    const handler = createHandler(noopExecutor, inMemoryMemoFactory());
    const fp = join(repo.root, 'file.ts');
    writeFileSync(fp, 'line1\nline2\nline3\n');

    await handler(
      baseInput({
        session_id: sid,
        cwd: repo.root,
        tool_name: 'Read',
        tool_input: { file_path: fp, offset: 2, limit: 3 }
      }) as never,
      { logger }
    );

    const entries = readJournal(sid);
    expect(entries).toHaveLength(1);
    expect(entries[0].tool).toBe('Read');
    expect(entries[0].kind).toBe('read');
    expect(typeof entries[0].start).toBe('number');
    expect(typeof entries[0].end).toBe('number');
    expect(entries[0].seen).toBe(false);
    expect(typeof entries[0].path).toBe('string');
  });
});

describe('Journal: Read without offset/limit → kind=whole', () => {
  let repo: { root: string; cleanup: () => void };
  const sid = `journal-test-read-whole-${Date.now()}`;

  beforeAll(() => {
    repo = makeTempRepo();
    clearJournal(sid);
  });
  afterAll(() => {
    repo.cleanup();
    clearJournal(sid);
  });

  it('appends a whole entry with no start/end', async () => {
    const handler = createHandler(noopExecutor, inMemoryMemoFactory());
    const fp = join(repo.root, 'whole.ts');
    writeFileSync(fp, 'line1\nline2\n');

    await handler(
      baseInput({
        session_id: sid,
        cwd: repo.root,
        tool_name: 'Read',
        tool_input: { file_path: fp }
      }) as never,
      { logger }
    );

    const entries = readJournal(sid);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('whole-read');
    expect(entries[0].start).toBeUndefined();
    expect(entries[0].end).toBeUndefined();
  });
});

describe('Journal: Edit with derivable old_string → kind=write with range', () => {
  let repo: { root: string; cleanup: () => void };
  const sid = `journal-test-edit-write-${Date.now()}`;

  beforeAll(() => {
    repo = makeTempRepo();
    clearJournal(sid);
  });
  afterAll(() => {
    repo.cleanup();
    clearJournal(sid);
  });

  it('appends a write entry with start/end', async () => {
    const handler = createHandler(noopExecutor, inMemoryMemoFactory());
    const fp = join(repo.root, 'edit.ts');
    writeFileSync(fp, 'line1\nline2\nline3\nline4\n');

    await handler(
      baseInput({
        session_id: sid,
        cwd: repo.root,
        tool_name: 'Edit',
        tool_input: { file_path: fp, old_string: 'line2\nline3', new_string: 'replaced' }
      }) as never,
      { logger }
    );

    const entries = readJournal(sid);
    expect(entries).toHaveLength(1);
    expect(entries[0].tool).toBe('Edit');
    expect(entries[0].kind).toBe('write');
    expect(entries[0].start).toBe(2);
    expect(entries[0].end).toBe(3);
  });
});

describe('Journal: Write to existing file (partial change) → kind=write with range', () => {
  let repo: { root: string; cleanup: () => void };
  const sid = `journal-test-write-partial-${Date.now()}`;

  beforeAll(() => {
    repo = makeTempRepo();
    clearJournal(sid);
  });
  afterAll(() => {
    repo.cleanup();
    clearJournal(sid);
  });

  it('appends a write entry', async () => {
    const handler = createHandler(noopExecutor, inMemoryMemoFactory());
    const fp = join(repo.root, 'partial.ts');
    writeFileSync(fp, 'a\nb\nc\nd\ne\n');

    await handler(
      baseInput({
        session_id: sid,
        cwd: repo.root,
        tool_name: 'Write',
        tool_input: { file_path: fp, content: 'a\nB\nC\nD\ne\n' }
      }) as never,
      { logger }
    );

    const entries = readJournal(sid);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('write');
    expect(typeof entries[0].start).toBe('number');
  });
});

describe('Journal: Write to existing file (full replacement) → kind=whole', () => {
  let repo: { root: string; cleanup: () => void };
  const sid = `journal-test-write-full-${Date.now()}`;

  beforeAll(() => {
    repo = makeTempRepo();
    clearJournal(sid);
  });
  afterAll(() => {
    repo.cleanup();
    clearJournal(sid);
  });

  it('appends a whole entry', async () => {
    const handler = createHandler(noopExecutor, inMemoryMemoFactory());
    const fp = join(repo.root, 'full.ts');
    writeFileSync(fp, 'old1\nold2\n');

    await handler(
      baseInput({
        session_id: sid,
        cwd: repo.root,
        tool_name: 'Write',
        tool_input: { file_path: fp, content: 'new1\nnew2\n' }
      }) as never,
      { logger }
    );

    const entries = readJournal(sid);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('whole-write');
    expect(entries[0].start).toBeUndefined();
  });
});

describe('Journal: Write to non-existent file → kind=create', () => {
  let repo: { root: string; cleanup: () => void };
  const sid = `journal-test-write-create-${Date.now()}`;

  beforeAll(() => {
    repo = makeTempRepo();
    clearJournal(sid);
  });
  afterAll(() => {
    repo.cleanup();
    clearJournal(sid);
  });

  it('appends a create entry', async () => {
    const handler = createHandler(noopExecutor, inMemoryMemoFactory());
    const fp = join(repo.root, 'brand-new-file.ts');
    // fp must NOT exist
    expect(fs.existsSync(fp)).toBe(false);

    await handler(
      baseInput({
        session_id: sid,
        cwd: repo.root,
        tool_name: 'Write',
        tool_input: { file_path: fp, content: 'hello\n' }
      }) as never,
      { logger }
    );

    const entries = readJournal(sid);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('create');
    expect(entries[0].start).toBeUndefined();
  });
});

describe('Journal: append failure does not throw', () => {
  let repo: { root: string; cleanup: () => void };

  beforeAll(() => {
    repo = makeTempRepo();
  });
  afterAll(() => repo.cleanup());

  it('handler returns normally even when journal dir cannot be created', async () => {
    // Use a session id that would require writing under a path that is
    // actually a file (not a directory) — mkdirSync will throw.
    const blocker = nodePath.join(os.homedir(), '.cache', 'git-span', 'session');
    // Ensure the parent exists, then create the session subdir as a file.
    fs.mkdirSync(blocker, { recursive: true });
    const sid = `journal-fail-test-${Date.now()}`;
    const sessionPath = nodePath.join(blocker, sanitizeSessionId(sid));
    // Write a file where mkdirSync would try to create a directory
    fs.writeFileSync(sessionPath, 'blocker');

    const handler = createHandler(noopExecutor, inMemoryMemoFactory());
    const fp = join(repo.root, 'safe.ts');
    writeFileSync(fp, 'x\n');

    let threw = false;
    try {
      await handler(
        baseInput({
          session_id: sid,
          cwd: repo.root,
          tool_name: 'Read',
          tool_input: { file_path: fp, offset: 1, limit: 1 }
        }) as never,
        { logger }
      );
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);

    // Cleanup the blocker file
    fs.unlinkSync(sessionPath);
  });
});

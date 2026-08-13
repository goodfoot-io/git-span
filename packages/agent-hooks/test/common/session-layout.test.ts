/**
 * Contract for the injected session layout
 * (packages/agent-hooks/src/common/agent-hooks-common.ts).
 *
 * Two things are pinned here. First, the *default* location: production must
 * keep resolving `~/.cache/git-span/session` now that the base is a value a
 * caller supplies rather than a module constant — this is what the old
 * `SESSION_BASE_DIR` assertion in memo-store.test.ts was really protecting,
 * and it is the one thing this card must not change. Second, the *relative*
 * layout under any base: a layout built on a temp directory has to name every
 * file exactly where the old free functions named it, or a test would be
 * exercising a different on-disk shape than production runs.
 */

import * as os from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessionLayout, DEFAULT_SESSION_LAYOUT, sanitizeSessionId } from '../../src/common/agent-hooks-common.js';

const BASE = '/tmp/layout-fixture/session';
const layout = createSessionLayout(BASE);

describe('DEFAULT_SESSION_LAYOUT', () => {
  it('resolves the production base, unchanged by making the base injectable', () => {
    expect(DEFAULT_SESSION_LAYOUT.base).toBe(join(os.homedir(), '.cache', 'git-span', 'session'));
  });

  it('puts the trash root beside the base, never inside it', () => {
    expect(DEFAULT_SESSION_LAYOUT.trashDir).toBe(join(os.homedir(), '.cache', 'git-span', 'session-trash'));
    expect(DEFAULT_SESSION_LAYOUT.trashDir.startsWith(`${DEFAULT_SESSION_LAYOUT.base}/`)).toBe(false);
  });
});

describe('createSessionLayout paths', () => {
  it('derives every session-scoped path from the base', () => {
    expect(layout.dir('s')).toBe(`${BASE}/s`);
    expect(layout.memoFile('s')).toBe(`${BASE}/s/touch-memo.json`);
    expect(layout.plannedTouchesDir('s')).toBe(`${BASE}/s/planned-touches`);
    expect(layout.plannedTouchRecordFile('s', 't')).toBe(`${BASE}/s/planned-touches/t.json`);
    expect(layout.plannedTouchConsumedFile('s', 't')).toBe(`${BASE}/s/planned-touches/t.consumed`);
  });

  it('trashes beside the base, matching the production sibling rule', () => {
    expect(layout.trashDir).toBe('/tmp/layout-fixture/session-trash');
  });

  it('sanitizes both the session id and the planned tool-use id', () => {
    const dirty = 'a/b c';
    expect(layout.dir(dirty)).toBe(`${BASE}/${sanitizeSessionId(dirty)}`);
    expect(layout.plannedTouchRecordFile(dirty, dirty)).toBe(
      `${BASE}/${sanitizeSessionId(dirty)}/planned-touches/${sanitizeSessionId(dirty)}.json`
    );
  });

  it('is frozen, so a caller cannot repoint one member of a layout', () => {
    expect(Object.isFrozen(layout)).toBe(true);
  });
});

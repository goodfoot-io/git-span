/**
 * The OpenCode host loader's contract for a module plugin: the default export
 * must be an object carrying a function `server` (plus optional string `id`),
 * and detection on that `server` key must succeed before the host falls back
 * to inspecting every named export — the entry also re-exports non-function
 * values (e.g. `OPENCODE_LOG_FILE_ENV`), which would hard-fail that fallback
 * with "Plugin export is not a function". These tests pin the shape so a
 * refactor cannot silently regress the load.
 */

import { describe, expect, it } from 'vitest';
import { default as moduleDefault, OPENCODE_LOG_FILE_ENV } from '../../src/opencode/index.js';

describe('opencode plugin module shape', () => {
  it('default-exports an object with a server function and string id', () => {
    expect(moduleDefault).toBeTypeOf('object');
    expect(moduleDefault).not.toBeNull();
    expect((moduleDefault as { id?: unknown }).id).toBeTypeOf('string');
    expect((moduleDefault as { id?: unknown }).id).toMatch(/^[a-z0-9-]+$/);
    expect((moduleDefault as { server?: unknown }).server).toBeTypeOf('function');
  });

  it('keeps the id in sync with the npm package name', () => {
    expect((moduleDefault as { id: string }).id).toBe('opencode-git-span');
    expect(OPENCODE_LOG_FILE_ENV).toBe('OPENCODE_GIT_SPAN_LOG_FILE');
  });
});

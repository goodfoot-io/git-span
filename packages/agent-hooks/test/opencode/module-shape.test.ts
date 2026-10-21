/** Pin the OpenCode V2 module's id and setup entry point. */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { default as moduleDefault, OPENCODE_LOG_FILE_ENV } from '../../src/opencode/index.js';

describe('opencode plugin module shape', () => {
  it('default-exports an object with a setup function and string id', () => {
    expect(moduleDefault).toBeTypeOf('object');
    expect(moduleDefault).not.toBeNull();
    expect((moduleDefault as { id?: unknown }).id).toBeTypeOf('string');
    expect((moduleDefault as { id?: unknown }).id).toMatch(/^[a-z0-9-]+$/);
    expect((moduleDefault as { setup?: unknown }).setup).toBeTypeOf('function');
  });

  it('loads the compiled V2 package through its declared entry point', async () => {
    const root = new URL('../../../../plugins-opencode/git-span/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
    const built = await import(new URL(manifest.main, root).href);
    expect(built.default.id).toBe(manifest.name);
    expect(built.default.setup).toBeTypeOf('function');
  });

  it('keeps the id in sync with the npm package name', () => {
    expect((moduleDefault as { id: string }).id).toBe('opencode-git-span');
    expect(OPENCODE_LOG_FILE_ENV).toBe('OPENCODE_GIT_SPAN_LOG_FILE');
  });
});

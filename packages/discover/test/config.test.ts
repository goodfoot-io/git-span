/**
 * Tests for {@link DEFAULT_CONFIG} and {@link resolveConfig}: the documented
 * defaults, override merging, exclude-entry normalization, and fail-closed
 * validation of malformed overrides.
 *
 * @summary Tests for DEFAULT_CONFIG and resolveConfig.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, resolveConfig } from '../src/config.js';

describe('resolveConfig', () => {
  it('resolves no-overrides and an empty-overrides call identically', () => {
    // Exercises the merge path itself (same code, two call shapes) rather
    // than re-asserting the DEFAULT_CONFIG literal.
    expect(resolveConfig()).toEqual(resolveConfig({}));
  });

  it('round-trips every default field through the merge unchanged', () => {
    const resolved = resolveConfig({});
    expect(resolved.exclude).toEqual(DEFAULT_CONFIG.exclude);
    expect(resolved.maxCandidates).toBe(DEFAULT_CONFIG.maxCandidates);
    expect(resolved.minScore).toBe(DEFAULT_CONFIG.minScore);
    expect(resolved.useCommitMessages).toBe(DEFAULT_CONFIG.useCommitMessages);
    expect(resolved.maxFileBytes).toBe(DEFAULT_CONFIG.maxFileBytes);
  });

  it('merges partial overrides over the defaults', () => {
    const resolved = resolveConfig({ minScore: 0.8, useCommitMessages: false });
    expect(resolved).toEqual({
      ...DEFAULT_CONFIG,
      minScore: 0.8,
      useCommitMessages: false
    });
  });

  it('normalizes a leading ./ and trailing / on exclude entries', () => {
    const resolved = resolveConfig({ exclude: ['./packages/foo/'] });
    expect(resolved.exclude).toEqual(['packages/foo']);
  });

  it('leaves an already-normalized exclude entry untouched', () => {
    const resolved = resolveConfig({ exclude: ['packages/foo'] });
    expect(resolved.exclude).toEqual(['packages/foo']);
  });

  it('normalizes multiple exclude entries independently', () => {
    const resolved = resolveConfig({ exclude: ['./a/', 'b', './c'] });
    expect(resolved.exclude).toEqual(['a', 'b', 'c']);
  });

  it('throws on an absolute exclude path', () => {
    expect(() => resolveConfig({ exclude: ['/etc/passwd'] })).toThrow();
  });

  it('throws on an exclude entry containing ..', () => {
    expect(() => resolveConfig({ exclude: ['packages/../secrets'] })).toThrow();
  });

  it('throws on a bare .. exclude entry', () => {
    expect(() => resolveConfig({ exclude: ['..'] })).toThrow();
  });

  it('throws on an exclude entry that is empty after normalization', () => {
    expect(() => resolveConfig({ exclude: ['./'] })).toThrow();
  });

  it('throws on a non-integer maxCandidates', () => {
    expect(() => resolveConfig({ maxCandidates: 1.5 })).toThrow();
  });

  it('throws on a maxCandidates below 1', () => {
    expect(() => resolveConfig({ maxCandidates: 0 })).toThrow();
  });

  it('throws on a minScore below 0', () => {
    expect(() => resolveConfig({ minScore: -0.1 })).toThrow();
  });

  it('throws on a minScore above 1', () => {
    expect(() => resolveConfig({ minScore: 1.1 })).toThrow();
  });

  it('accepts minScore at the 0 and 1 boundaries', () => {
    expect(resolveConfig({ minScore: 0 }).minScore).toBe(0);
    expect(resolveConfig({ minScore: 1 }).minScore).toBe(1);
  });

  it('throws on a maxFileBytes below 1', () => {
    expect(() => resolveConfig({ maxFileBytes: 0 })).toThrow();
  });
});

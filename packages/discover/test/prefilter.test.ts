/**
 * Tests for src/prefilter.ts's pure predicates. RepoContext construction
 * (createRepoContext) is covered separately in test/repo-context.test.ts
 * against real fixture repos, since it needs actual git history to exercise.
 */

import { describe, expect, it } from 'vitest';
import { isSpanPath, isSweepCommit } from '../src/prefilter.js';
import type { Commit } from '../src/types.js';

function fakeCommit(fileCount: number): Commit {
  return {
    sha: 'deadbeef',
    author: 'Test Author',
    date: '2024-01-01T00:00:00Z',
    message: 'test commit',
    files: Array.from({ length: fileCount }, (_, i) => ({ path: `file-${i}.ts`, hunks: [] }))
  };
}

describe('isSweepCommit', () => {
  it('excludes a commit touching more files than the threshold', () => {
    expect(isSweepCommit(fakeCommit(51), 50)).toBe(true);
  });

  it('keeps a commit touching exactly the threshold', () => {
    expect(isSweepCommit(fakeCommit(50), 50)).toBe(false);
  });

  it('keeps a commit touching far fewer files than the threshold', () => {
    expect(isSweepCommit(fakeCommit(2), 50)).toBe(false);
  });
});

describe('isSpanPath', () => {
  it('excludes the .span directory itself', () => {
    expect(isSpanPath('.span')).toBe(true);
  });

  it('excludes any file nested under .span/', () => {
    expect(isSpanPath('.span/records/foo.json')).toBe(true);
    expect(isSpanPath('.span/index.sqlite')).toBe(true);
  });

  it('keeps an ordinary source path', () => {
    expect(isSpanPath('src/app.ts')).toBe(false);
  });

  it('does not falsely match a sibling path that merely starts with the same prefix', () => {
    // ".spannable/x" is not under ".span/" — a naive `startsWith('.span')`
    // (without the trailing slash) would wrongly exclude it.
    expect(isSpanPath('.spannable/x')).toBe(false);
  });
});

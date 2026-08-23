/**
 * Tests for the OpenCode adapter's pure narrows
 * (packages/agent-hooks/src/opencode/narrows.ts): per-tool-id argument
 * extraction (garbage → null, never a throw) and the decision-10 bash
 * response mapping into what `normalizeBashResponse` consumes.
 */

import { describe, expect, it } from 'vitest';
import {
  narrowApplyPatchText,
  narrowBashArgs,
  narrowEditArgs,
  narrowReadArgs,
  narrowWriteArgs,
  toBashResponse
} from '../../src/opencode/narrows.js';

describe('narrowBashArgs', () => {
  it('extracts command and optional workdir', () => {
    expect(narrowBashArgs({ command: 'git commit -m x' })).toEqual({ command: 'git commit -m x' });
    expect(narrowBashArgs({ command: 'ls', workdir: '/repo' })).toEqual({ command: 'ls', workdir: '/repo' });
  });
  it('returns null on garbage input', () => {
    expect(narrowBashArgs(null)).toBeNull();
    expect(narrowBashArgs(undefined)).toBeNull();
    expect(narrowBashArgs('git commit')).toBeNull();
    expect(narrowBashArgs({})).toBeNull();
    expect(narrowBashArgs({ command: '' })).toBeNull();
    expect(narrowBashArgs({ command: 42 })).toBeNull();
  });
});

describe('narrowReadArgs', () => {
  it('keeps positive-int offset/limit and drops junk windows', () => {
    expect(narrowReadArgs({ filePath: '/r/f.ts' })).toEqual({ filePath: '/r/f.ts' });
    expect(narrowReadArgs({ filePath: '/r/f.ts', offset: 3, limit: 10 })).toEqual({
      filePath: '/r/f.ts',
      offset: 3,
      limit: 10
    });
    expect(narrowReadArgs({ filePath: '/r/f.ts', offset: 0, limit: -2, limitJunk: true })).toEqual({
      filePath: '/r/f.ts'
    });
  });
  it('returns null without a usable path', () => {
    expect(narrowReadArgs(null)).toBeNull();
    expect(narrowReadArgs({})).toBeNull();
    expect(narrowReadArgs({ filePath: '' })).toBeNull();
  });
});

describe('narrowEditArgs / narrowWriteArgs', () => {
  it('edit maps newString to written', () => {
    expect(narrowEditArgs({ filePath: '/r/f.ts', oldString: 'a', newString: 'b' })).toEqual({
      filePath: '/r/f.ts',
      written: 'b'
    });
    expect(narrowEditArgs({ filePath: '/r/f.ts', oldString: 'a' })).toBeNull();
  });
  it('write maps content to written', () => {
    expect(narrowWriteArgs({ content: 'body', filePath: '/r/new.ts' })).toEqual({
      filePath: '/r/new.ts',
      written: 'body'
    });
    expect(narrowWriteArgs({ content: 'body' })).toBeNull();
  });
  it('empty written content is a real write touch, not an unusable shape (cross-adapter parity)', () => {
    // The Claude twin records `written: ''` for identical inputs; dropping the
    // touch at the narrow would lose deletion-style edits/writes.
    expect(narrowEditArgs({ filePath: '/r/f.ts', oldString: 'a', newString: '' })).toEqual({
      filePath: '/r/f.ts',
      written: ''
    });
    expect(narrowWriteArgs({ content: '', filePath: '/r/f.ts' })).toEqual({ filePath: '/r/f.ts', written: '' });
  });
  it('absent or non-string written fields still narrow to null', () => {
    expect(narrowEditArgs({ filePath: '/r/f.ts', oldString: 'a', newString: 42 })).toBeNull();
    expect(narrowWriteArgs({ content: null, filePath: '/r/f.ts' })).toBeNull();
    expect(narrowWriteArgs({ filePath: '/r/f.ts' })).toBeNull();
    expect(narrowEditArgs(null)).toBeNull();
    expect(narrowWriteArgs(undefined)).toBeNull();
  });
});

describe('narrowApplyPatchText', () => {
  it('extracts patchText; null otherwise', () => {
    expect(narrowApplyPatchText({ patchText: '*** Begin Patch' })).toBe('*** Begin Patch');
    expect(narrowApplyPatchText({})).toBeNull();
    expect(narrowApplyPatchText(null)).toBeNull();
  });
});

describe('toBashResponse (decision-10 mapping)', () => {
  it('maps a numeric exit to exitStatus with interrupted false', () => {
    const mapped = toBashResponse('out', { output: 'out', exit: 0 });
    expect(mapped).toEqual({ output: 'out', exitStatus: 0, interrupted: false });
    expect(toBashResponse('', { output: '', exit: 1 }).exitStatus).toBe(1);
  });

  it('maps a null exit (aborted/timed out) to interrupted with no exitStatus', () => {
    const mapped = toBashResponse('partial', { output: 'partial', exit: null });
    expect(mapped).toEqual({ output: 'partial', exitStatus: undefined, interrupted: true });
  });

  it('flows truncation through rawOutputPath', () => {
    const mapped = toBashResponse('big', { output: 'big', exit: 0, truncated: true, outputPath: '/tmp/out.bin' });
    expect(mapped.rawOutputPath).toBe('/tmp/out.bin');
    // The host's redundant truncated boolean is not carried: normalization
    // re-derives truncation from rawOutputPath.
    expect(mapped).not.toHaveProperty('truncated');
  });

  it('missing or non-object metadata means no completion proof — suppressed as interrupted', () => {
    expect(toBashResponse('text', undefined)).toEqual({ output: 'text', exitStatus: undefined, interrupted: true });
    expect(toBashResponse('text', null)).toEqual({ output: 'text', exitStatus: undefined, interrupted: true });
    expect(toBashResponse(undefined, undefined)).toEqual({ output: '', exitStatus: undefined, interrupted: true });
  });

  it('prefers metadata.output over the appended output channel for the text source', () => {
    expect(toBashResponse('channel', { output: 'metadata', exit: 0 }).output).toBe('metadata');
    expect(toBashResponse('channel', { exit: 0 }).output).toBe('channel');
  });
});

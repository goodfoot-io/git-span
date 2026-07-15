/**
 * Unit + contract tests for the Codex `apply_patch` envelope parser.
 *
 * The parser is pure: it takes the raw `tool_input.command` patch string and an
 * injected `readPreEditFile` reader (so range recovery needs no real fs) and
 * returns one `AnchorSpec` per touched file. These tests exercise every touch
 * kind, range recovery, whole-file fallback, multi-file envelopes, and
 * malformed input, plus a contract suite fed real Codex-emitted envelopes.
 */

import { describe, expect, it } from 'vitest';
import type { ReadPreEditFile } from '../../src/codex/apply-patch.js';
import { parseApplyPatch } from '../../src/codex/apply-patch.js';
import type { AnchorSpec } from '../../src/common/agent-hooks-common.js';

// A reader backed by an in-memory map of path -> pre-edit content.
function readerFor(files: Record<string, string>): ReadPreEditFile {
  return (path: string) => (path in files ? files[path] : null);
}

// A reader that can never resolve any file (forces whole-file fallback).
const noFiles: ReadPreEditFile = () => null;

function anchorFor(anchors: AnchorSpec[], path: string): AnchorSpec | undefined {
  return anchors.find((a) => a.path === path);
}

describe('parseApplyPatch', () => {
  describe('single-hunk kinds', () => {
    it('maps *** Add File: to a create (whole-file) anchor', () => {
      const patch = ['*** Begin Patch', '*** Add File: src/new.ts', '+export const x = 1;', '*** End Patch'].join('\n');
      const anchors = parseApplyPatch(patch, noFiles);
      expect(anchors).toEqual([{ path: 'src/new.ts', kind: 'create' }]);
    });

    it('maps *** Update File: to a write with a recovered range when context is found', () => {
      const preEdit = ['line1', 'line2', 'line3', 'line4', 'line5'].join('\n');
      const patch = [
        '*** Begin Patch',
        '*** Update File: src/app.ts',
        '@@',
        ' line2',
        '-line3',
        '+line3-modified',
        ' line4',
        '*** End Patch'
      ].join('\n');
      const anchors = parseApplyPatch(patch, readerFor({ 'src/app.ts': preEdit }));
      // Pre-edit block is [line2, line3, line4] at 1-based lines 2..4.
      expect(anchors).toEqual([{ path: 'src/app.ts', kind: 'write', range: { start: 2, end: 4 } }]);
    });

    it('falls back to whole-write for an update when the pre-edit block cannot be located', () => {
      // Reader returns content, but the hunk block is not present in it.
      const preEdit = ['totally', 'different', 'content'].join('\n');
      const patch = [
        '*** Begin Patch',
        '*** Update File: src/app.ts',
        '@@',
        ' line2',
        '-line3',
        '+line3-modified',
        '*** End Patch'
      ].join('\n');
      const anchors = parseApplyPatch(patch, readerFor({ 'src/app.ts': preEdit }));
      expect(anchors).toEqual([{ path: 'src/app.ts', kind: 'whole-write' }]);
    });

    it('falls back to whole-write for an update when no reader can supply pre-edit content', () => {
      const patch = ['*** Begin Patch', '*** Update File: src/app.ts', '@@', ' a', '-b', '+c', '*** End Patch'].join(
        '\n'
      );
      const anchors = parseApplyPatch(patch, noFiles);
      expect(anchors).toEqual([{ path: 'src/app.ts', kind: 'whole-write' }]);
    });

    it('maps *** Delete File: to a whole-write anchor', () => {
      const patch = ['*** Begin Patch', '*** Delete File: src/gone.ts', '*** End Patch'].join('\n');
      const anchors = parseApplyPatch(patch, noFiles);
      expect(anchors).toEqual([{ path: 'src/gone.ts', kind: 'whole-write' }]);
    });
  });

  describe('multi-file envelope', () => {
    it('produces one anchor per file with the correct kinds', () => {
      const preEdit = ['alpha', 'beta', 'gamma', 'delta'].join('\n');
      const patch = [
        '*** Begin Patch',
        '*** Add File: src/added.ts',
        '+const added = true;',
        '*** Update File: src/updated.ts',
        '@@',
        ' beta',
        '-gamma',
        '+gamma2',
        '*** Delete File: src/deleted.ts',
        '*** End Patch'
      ].join('\n');
      const anchors = parseApplyPatch(patch, readerFor({ 'src/updated.ts': preEdit }));
      expect(anchors).toHaveLength(3);
      expect(anchorFor(anchors, 'src/added.ts')).toEqual({ path: 'src/added.ts', kind: 'create' });
      // Pre-edit block [beta, gamma] at lines 2..3.
      expect(anchorFor(anchors, 'src/updated.ts')).toEqual({
        path: 'src/updated.ts',
        kind: 'write',
        range: { start: 2, end: 3 }
      });
      expect(anchorFor(anchors, 'src/deleted.ts')).toEqual({ path: 'src/deleted.ts', kind: 'whole-write' });
    });
  });

  describe('range recovery details', () => {
    it('unions multiple chunks in one update into a single spanning range', () => {
      const preEdit = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n');
      const patch = [
        '*** Begin Patch',
        '*** Update File: src/multi.ts',
        '@@',
        ' b',
        '-c',
        '+c2',
        '@@',
        ' f',
        '-g',
        '+g2',
        '*** End Patch'
      ].join('\n');
      const anchors = parseApplyPatch(patch, readerFor({ 'src/multi.ts': preEdit }));
      // Chunk 1 block [b,c] at 2..3; chunk 2 block [f,g] at 6..7 → union 2..7.
      expect(anchors).toEqual([{ path: 'src/multi.ts', kind: 'write', range: { start: 2, end: 7 } }]);
    });

    it('disambiguates a duplicated block using the @@ change context', () => {
      const preEdit = ['dup', 'x', 'header', 'dup', 'y'].join('\n');
      const patch = [
        '*** Begin Patch',
        '*** Update File: src/dup.ts',
        '@@ header',
        ' dup',
        '-y',
        '+z',
        '*** End Patch'
      ].join('\n');
      const anchors = parseApplyPatch(patch, readerFor({ 'src/dup.ts': preEdit }));
      // 'dup' appears at lines 1 and 4; context 'header' (line 3) selects the
      // occurrence after it → block [dup, y] at 4..5.
      expect(anchors).toEqual([{ path: 'src/dup.ts', kind: 'write', range: { start: 4, end: 5 } }]);
    });

    it('falls back to whole-write when a duplicated block cannot be disambiguated', () => {
      const preEdit = ['dup', 'tail', 'mid', 'dup', 'tail'].join('\n');
      const patch = [
        '*** Begin Patch',
        '*** Update File: src/amb.ts',
        '@@',
        ' dup',
        ' tail',
        '+added',
        '*** End Patch'
      ].join('\n');
      const anchors = parseApplyPatch(patch, readerFor({ 'src/amb.ts': preEdit }));
      expect(anchors).toEqual([{ path: 'src/amb.ts', kind: 'whole-write' }]);
    });
  });

  describe('rename (Move to) updates', () => {
    it('anchors a renamed update on the destination path as whole-write', () => {
      const patch = [
        '*** Begin Patch',
        '*** Update File: src/old.ts',
        '*** Move to: src/new.ts',
        '@@',
        '-old',
        '+new',
        '*** End Patch'
      ].join('\n');
      const anchors = parseApplyPatch(patch, readerFor({ 'src/old.ts': 'old\n' }));
      expect(anchors).toEqual([{ path: 'src/new.ts', kind: 'whole-write' }]);
    });
  });

  describe('grammar leniency', () => {
    it('treats an indented *** Update File: line as an update context line, not a new hunk', () => {
      // Mirrors Codex's own leniency test: a leading space demotes a marker to
      // a context line inside an active update hunk.
      const preEdit = ['old a', '*** Update File: b.txt', 'tail'].join('\n');
      const patch = [
        '*** Begin Patch',
        '*** Update File: a.txt',
        '@@',
        '-old a',
        '+new a',
        ' *** Update File: b.txt',
        '*** End Patch'
      ].join('\n');
      const anchors = parseApplyPatch(patch, readerFor({ 'a.txt': preEdit }));
      // Only one file is touched (a.txt); the indented marker is context.
      expect(anchors).toHaveLength(1);
      expect(anchors[0].path).toBe('a.txt');
    });

    it('ignores an *** Environment ID: preamble line', () => {
      const patch = [
        '*** Begin Patch',
        '*** Environment ID: remote',
        '*** Add File: hello.txt',
        '+hello',
        '*** End Patch'
      ].join('\n');
      const anchors = parseApplyPatch(patch, noFiles);
      expect(anchors).toEqual([{ path: 'hello.txt', kind: 'create' }]);
    });
  });

  describe('malformed / empty input', () => {
    it('returns [] for an empty string', () => {
      expect(parseApplyPatch('', noFiles)).toEqual([]);
    });

    it('returns [] for whitespace-only input', () => {
      expect(parseApplyPatch('   \n\t\n', noFiles)).toEqual([]);
    });

    it('returns [] for input with no recognizable hunk headers', () => {
      expect(parseApplyPatch('this is not a patch at all', noFiles)).toEqual([]);
    });

    it('returns [] for a well-formed but empty patch', () => {
      expect(parseApplyPatch(['*** Begin Patch', '*** End Patch'].join('\n'), noFiles)).toEqual([]);
    });

    it('never throws on truncated input', () => {
      expect(() => parseApplyPatch('*** Begin Patch\n*** Update File: x.ts\n@@\n', noFiles)).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// Contract test: representative real Codex-emitted apply_patch envelopes.
//
// Analogous to porcelain-contract.test.ts — it feeds whole envelopes Codex
// actually emits (drawn from Codex's own streaming-parser fixtures) through the
// parser and asserts the resulting anchors form a valid, correctly-kinded set.
// ---------------------------------------------------------------------------

describe('Codex apply_patch contract', () => {
  // The seven-hunk envelope from Codex's own streaming_parser test suite,
  // covering add / update / delete / move-update in one patch.
  const SEVEN_HUNK_ENVELOPE = [
    '*** Begin Patch',
    '*** Add File: docs/release-notes.md',
    '+# Release notes',
    '+',
    '+## CLI',
    '+- Surface apply_patch progress while arguments stream.',
    '*** Update File: src/config.rs',
    '@@ impl Config',
    '-    pub apply_patch_progress: bool,',
    '+    pub stream_apply_patch_progress: bool,',
    '     pub include_diagnostics: bool,',
    '*** Delete File: src/legacy_patch_progress.rs',
    '*** Update File: crates/cli/src/main.rs',
    '*** Move to: crates/cli/src/bin/codex.rs',
    '@@ fn run()',
    '-    let args = Args::parse();',
    '+    let cli = Cli::parse();',
    '*** Add File: tests/fixtures/apply_patch_progress.json',
    '+{}',
    '*** Update File: README.md',
    '@@ Development workflow',
    ' Build the Rust workspace before opening a pull request.',
    '+When touching streamed tool calls, include parser coverage.',
    '*** Delete File: docs/old-apply-patch-progress.md',
    '*** End Patch'
  ].join('\n');

  it('extracts one anchor per touched file with valid shape', () => {
    const anchors = parseApplyPatch(SEVEN_HUNK_ENVELOPE, () => null);
    expect(anchors).toHaveLength(7);
    for (const a of anchors) {
      expect(typeof a.path).toBe('string');
      expect(a.path.length).toBeGreaterThan(0);
      expect(['read', 'write', 'whole-read', 'whole-write', 'create']).toContain(a.kind);
      if (a.kind === 'write') {
        expect(a.range).toBeDefined();
        expect(a.range!.start).toBeGreaterThanOrEqual(1);
        expect(a.range!.end).toBeGreaterThanOrEqual(a.range!.start);
      }
    }
  });

  it('maps the envelope hunks to the expected paths and kinds (no reader → updates whole-write)', () => {
    const anchors = parseApplyPatch(SEVEN_HUNK_ENVELOPE, () => null);
    expect(anchors.map((a) => [a.path, a.kind])).toEqual([
      ['docs/release-notes.md', 'create'],
      ['src/config.rs', 'whole-write'],
      ['src/legacy_patch_progress.rs', 'whole-write'],
      ['crates/cli/src/bin/codex.rs', 'whole-write'],
      ['tests/fixtures/apply_patch_progress.json', 'create'],
      ['README.md', 'whole-write'],
      ['docs/old-apply-patch-progress.md', 'whole-write']
    ]);
  });

  it('recovers a real update range when the pre-edit file is available', () => {
    const readmePreEdit = [
      '# Project',
      '',
      'Development workflow',
      'Build the Rust workspace before opening a pull request.',
      'Then run the tests.'
    ].join('\n');
    const anchors = parseApplyPatch(SEVEN_HUNK_ENVELOPE, readerFor({ 'README.md': readmePreEdit }));
    const readme = anchorFor(anchors, 'README.md');
    // Context 'Development workflow' (line 3) then the ' Build...' context line
    // (line 4) form the pre-edit block → range 4..4.
    expect(readme).toEqual({ path: 'README.md', kind: 'write', range: { start: 4, end: 4 } });
  });
});

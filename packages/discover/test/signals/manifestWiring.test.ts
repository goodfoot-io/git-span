/**
 * Tests for the extension-manifest wiring coupling signal.
 *
 * @summary Verifies contributes-id extraction, registrar scoring, and malformed-manifest handling.
 */

import { describe, expect, it } from 'vitest';
import { manifestWiringSignal } from '../../src/signals/manifestWiring.js';
import type { DiscoverConfig, RepoHistory, RepoScan } from '../../src/types.js';

function makeScan(files: Record<string, string>): RepoScan {
  const paths = Object.keys(files).sort();
  const text = new Map<string, string>();
  const lines = new Map<string, readonly string[]>();
  for (const path of paths) {
    const content = files[path] ?? '';
    text.set(path, content);
    lines.set(path, content.split('\n'));
  }
  return {
    root: '/repo',
    files: paths,
    text,
    lines,
    topLevelDirs: new Set(),
    docsDirs: []
  };
}

function makeHistory(): RepoHistory {
  return { commits: [], messages: new Map(), changeGroups: [], messageQuality: 0 };
}

function makeConfig(): DiscoverConfig {
  return { exclude: [], maxCandidates: 300, minScore: 0.5, useCommitMessages: true, maxFileBytes: 1_200_000 };
}

const MANIFEST_PATH = 'packages/ext/package.json';

function manifestJson(): string {
  return JSON.stringify({
    name: 'ext',
    contributes: {
      commands: [
        { command: 'myext.doThing', title: 'Do Thing' },
        { command: 'myext.otherThing', title: 'Other Thing' }
      ]
    }
  });
}

describe('manifestWiringSignal', () => {
  it('does not apply when no manifest declares contributes', () => {
    const scan = makeScan({
      'packages/ext/package.json': JSON.stringify({ name: 'ext' }),
      'src/index.ts': 'export {};\n'
    });
    expect(manifestWiringSignal.applies(scan, makeHistory(), makeConfig())).toBe(false);
  });

  it('applies when a manifest declares an object-valued contributes', () => {
    const scan = makeScan({ [MANIFEST_PATH]: manifestJson() });
    expect(manifestWiringSignal.applies(scan, makeHistory(), makeConfig())).toBe(true);
  });

  it('scores a registration call at 0.70', () => {
    const scan = makeScan({
      [MANIFEST_PATH]: manifestJson(),
      'packages/ext/src/extension.ts': [
        "import * as vscode from 'vscode';",
        'export function activate(context) {',
        "  vscode.commands.registerCommand('myext.doThing', () => run());",
        '}',
        ''
      ].join('\n')
    });

    const candidates = manifestWiringSignal.run(scan, makeHistory(), makeConfig());
    const pair = candidates.find((c) => c.locs.some((loc) => loc.path === 'packages/ext/src/extension.ts'));

    expect(pair).toBeDefined();
    expect(pair?.signal).toBe('manifest-wiring');
    expect(pair?.score).toBeCloseTo(0.7);
    expect(pair?.evidence).toContain('manifest:myext.doThing');
    const registrarLoc = pair?.locs.find((loc) => loc.path === 'packages/ext/src/extension.ts');
    expect(registrarLoc?.start).toBe(3);
    const manifestLoc = pair?.locs.find((loc) => loc.path === MANIFEST_PATH);
    expect(manifestLoc?.start).toBeUndefined();
  });

  it('scores a plain mention at 0.58', () => {
    const scan = makeScan({
      [MANIFEST_PATH]: manifestJson(),
      'packages/ext/src/notes.ts': '// Related: myext.otherThing is triggered from the palette.\n'
    });

    const candidates = manifestWiringSignal.run(scan, makeHistory(), makeConfig());
    const pair = candidates.find((c) => c.locs.some((loc) => loc.path === 'packages/ext/src/notes.ts'));

    expect(pair).toBeDefined();
    expect(pair?.score).toBeCloseTo(0.58);
    expect(pair?.evidence).toContain('manifest:myext.otherThing');
  });

  it('extracts ids from a contributes.configuration properties object', () => {
    const scan = makeScan({
      [MANIFEST_PATH]: JSON.stringify({
        contributes: { configuration: { properties: { 'myext.enableFeatureFlag': { type: 'boolean' } } } }
      }),
      'packages/ext/src/config.ts': "const v = vscode.workspace.getConfiguration().get('myext.enableFeatureFlag');\n"
    });

    const candidates = manifestWiringSignal.run(scan, makeHistory(), makeConfig());

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.score).toBeCloseTo(0.7);
    expect(candidates[0]?.evidence).toContain('manifest:myext.enableFeatureFlag');
  });

  it('skips a malformed package.json without throwing, alongside a valid manifest', () => {
    const scan = makeScan({
      [MANIFEST_PATH]: manifestJson(),
      'packages/ext/src/extension.ts': "vscode.commands.registerCommand('myext.doThing', () => run());\n",
      'packages/bad/package.json': '{ this is not valid json',
      'packages/bad/src/index.ts': 'export {};\n'
    });

    expect(() => manifestWiringSignal.run(scan, makeHistory(), makeConfig())).not.toThrow();
    const candidates = manifestWiringSignal.run(scan, makeHistory(), makeConfig());
    expect(candidates.every((c) => c.locs.every((loc) => !loc.path.startsWith('packages/bad/')))).toBe(true);
  });
});

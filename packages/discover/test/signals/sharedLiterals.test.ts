/**
 * Tests for the shared-literals coupling signal.
 *
 * @summary Verifies rare-literal pairing, boilerplate dropping, and scoring.
 */

import { describe, expect, it } from 'vitest';
import { sharedLiteralsSignal } from '../../src/signals/sharedLiterals.js';
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

describe('sharedLiteralsSignal', () => {
  it('always applies', () => {
    expect(sharedLiteralsSignal.applies(makeScan({}), makeHistory(), makeConfig())).toBe(true);
  });

  it('pairs two files sharing a distinctive quoted-string literal', () => {
    const scan = makeScan({
      'src/a.ts': 'const token = "uniqueSharedABC";\n',
      'src/b.ts': 'const other = "uniqueSharedABC";\n'
    });
    const [candidate] = sharedLiteralsSignal.run(scan, makeHistory(), makeConfig());
    expect(candidate).toBeDefined();
    expect(candidate?.signal).toBe('shared-literals');
    expect(candidate?.score).toBeCloseTo(0.5);
    expect(candidate?.evidence).toContain('lit:1');
    expect(candidate?.locs.map((loc) => loc.path).sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('does not pair files whose only shared text is a dependency-pin line', () => {
    const scan = makeScan({
      'pkg/a/package.json': '{\n  "some-really-long-dependency-name": "^1.4.2"\n}\n',
      'pkg/b/package.json': '{\n  "some-really-long-dependency-name": "^1.4.2"\n}\n'
    });
    const candidates = sharedLiteralsSignal.run(scan, makeHistory(), makeConfig());
    expect(candidates).toHaveLength(0);
  });

  it('drops a literal shared across five or more files', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 5; i++) {
      files[`src/file${i}.ts`] = 'const shared = "boilerplateConstantValue";\n';
    }
    const candidates = sharedLiteralsSignal.run(makeScan(files), makeHistory(), makeConfig());
    expect(candidates).toHaveLength(0);
  });

  it('scores three shared literals higher than one shared literal', () => {
    const onePair = makeScan({
      'src/a.ts': 'const token = "uniqueSharedABC";\n',
      'src/b.ts': 'const other = "uniqueSharedABC";\n'
    });
    const threeShared = ['sharedLiteralOneHere', 'sharedLiteralTwoHere', 'sharedLiteralThreeHere'];
    const threeFileContent = `${threeShared.map((tok, i) => `const v${i} = "${tok}";`).join('\n')}\n`;
    const threePair = makeScan({
      'src/c.ts': threeFileContent,
      'src/d.ts': threeFileContent
    });
    const [oneCandidate] = sharedLiteralsSignal.run(onePair, makeHistory(), makeConfig());
    const [threeCandidate] = sharedLiteralsSignal.run(threePair, makeHistory(), makeConfig());
    expect(oneCandidate?.score).toBeCloseTo(0.5);
    expect(threeCandidate?.score).toBeCloseTo(0.72);
    expect(threeCandidate?.score ?? 0).toBeGreaterThan(oneCandidate?.score ?? 0);
  });

  it('applies the ALL_CAPS underscore/length threshold', () => {
    const scan = makeScan({
      'src/a.ts': 'if (flag === LONG_FEATURE_TOGGLE || x === MY_KEY) run();\n',
      'src/b.ts': 'const LONG_FEATURE_TOGGLE = true;\nconst MY_KEY = 2;\n'
    });
    const [candidate] = sharedLiteralsSignal.run(scan, makeHistory(), makeConfig());
    expect(candidate?.evidence).toContain('lit:1');
  });

  it('pairs files sharing a >=5-digit non-round numeric literal', () => {
    const scan = makeScan({
      'src/a.ts': 'const code = 483921;\n',
      'src/b.ts': 'const code = 483921;\n'
    });
    const candidates = sharedLiteralsSignal.run(scan, makeHistory(), makeConfig());
    expect(candidates).toHaveLength(1);
  });

  it('excludes round numbers like 100000 from numeric literal matching', () => {
    const scan = makeScan({
      'src/a.ts': 'const code = 100000;\n',
      'src/b.ts': 'const code = 100000;\n'
    });
    const candidates = sharedLiteralsSignal.run(scan, makeHistory(), makeConfig());
    expect(candidates).toHaveLength(0);
  });

  it('does not treat a quoted scan file path as a rare literal', () => {
    const scan = makeScan({
      'src/a.ts': 'const ref1 = "src/shared/target.ts";\n',
      'src/b.ts': 'const ref2 = "src/shared/target.ts";\n',
      'src/shared/target.ts': 'export const x = 1;\n'
    });
    const candidates = sharedLiteralsSignal.run(scan, makeHistory(), makeConfig());
    expect(candidates).toHaveLength(0);
  });
});

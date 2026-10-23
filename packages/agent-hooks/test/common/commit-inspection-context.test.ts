/** Consumer contract for complete commit-review context, independent of touch cadence. */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type CommitInspectionContextDocument,
  type CommitInspectionContextExecutor,
  createDefaultCommitInspectionExecutor,
  decodeCommitInspectionContext,
  renderCommitInspectionContext,
  runCommitInspectionContext
} from '../../src/common/commit-inspection-context.js';
import type { ContextAnchor, ContextSpan } from '../../src/common/touch-core.js';
import { makeTempRepo } from '../helpers.js';
import {
  addLineSpan,
  buildWorkspaceGitSpan,
  commitRepo,
  makeRealBundleRepo,
  writeRepoFile
} from '../real-bundle-helpers.js';

const FIRST = 'a'.repeat(40);
const SECOND = 'b'.repeat(40);

function anchor(overrides: Partial<ContextAnchor> = {}): ContextAnchor {
  return {
    ordinal: 0,
    id: 'relationship:src/old.ts:L2-L3',
    anchored: { path: 'src/old.ts', extent: { kind: 'lines', start: 2, end: 3 } },
    current: { path: 'src/new.ts', extent: { kind: 'lines', start: 7, end: 8 } },
    status: { code: 'MOVED' },
    source: 'WORKTREE',
    sources: ['HEAD', 'WORKTREE'],
    ...overrides
  };
}

function span(overrides: Partial<ContextSpan> = {}): ContextSpan {
  return {
    name: 'relationship',
    evidence_revision: 'c'.repeat(64),
    why: 'First explanation sentence. Second explanation remains complete.',
    overlaps: [],
    anchors: [anchor()],
    ...overrides
  };
}

function document(overrides: Partial<CommitInspectionContextDocument> = {}): CommitInspectionContextDocument {
  return { schema_version: 1, commits: [FIRST], spans: [span()], ...overrides };
}

/** Real argv child implements the native protocol so executor tests exercise process IO. */
function protocolChild(script: string): CommitInspectionContextExecutor {
  return createDefaultCommitInspectionExecutor((argv) => ({
    executable: process.execPath,
    argv: ['-e', script, '--', ...argv]
  }));
}

describe('commit inspection envelope', () => {
  it('accepts the exact complete set independent of order and deduplicates requested identities', () => {
    const input = document({ commits: [SECOND, FIRST] });
    expect(decodeCommitInspectionContext(JSON.stringify(input), [FIRST, SECOND, FIRST])).toEqual(input);
    const sha256 = 'd'.repeat(64);
    expect(decodeCommitInspectionContext(JSON.stringify(document({ commits: [sha256] })), [sha256]).commits).toEqual([
      sha256
    ]);
  });

  it('rejects missing, extra, duplicate, malformed, abbreviated, and mixed-format identities', () => {
    for (const commits of [[], [FIRST, SECOND], [FIRST, FIRST], ['HEAD'], [FIRST.slice(0, 12)], ['a'.repeat(64)]]) {
      expect(() => decodeCommitInspectionContext(JSON.stringify(document({ commits })), [FIRST])).toThrow();
    }
    expect(() =>
      decodeCommitInspectionContext(JSON.stringify(document({ commits: [FIRST, 'd'.repeat(64)] })), [
        FIRST,
        'd'.repeat(64)
      ])
    ).toThrow();
  });

  it('rejects unknown envelope fields, schema versions, malformed spans, overlaps, and duplicate names', () => {
    for (const invalid of [
      { ...document(), scopes: [] },
      { ...document(), mutation: {} },
      { ...document(), schema_version: 2 },
      document({ spans: [span({ evidence_revision: 'invalid' })] }),
      document({ spans: [span(), span()] }),
      document({ spans: [span({ anchors: [anchor({ ordinal: 4 })] })] }),
      { ...document(), spans: [{ ...span(), overlaps: [{ scope: 0 }] }] }
    ]) {
      expect(() => decodeCommitInspectionContext(JSON.stringify(invalid), [FIRST])).toThrow();
    }
  });

  it('rejects malformed JSON and native data beyond the 16 MiB envelope limit', () => {
    expect(() => decodeCommitInspectionContext('{', [FIRST])).toThrow();
    expect(() =>
      decodeCommitInspectionContext(
        JSON.stringify(document({ spans: [span({ why: 'x'.repeat(16 * 1024 * 1024) })] })),
        [FIRST]
      )
    ).toThrow();
  });
});

describe('complete commit context rendering', () => {
  it('uses current coordinates, complete counterparts and full explanation without generic touch framing', () => {
    const counterpart = anchor({
      ordinal: 1,
      id: 'counterpart',
      anchored: { path: 'elsewhere/counterpart.ts', extent: { kind: 'whole' } },
      current: { path: 'elsewhere/counterpart.ts', extent: { kind: 'whole' } },
      status: { code: 'FRESH' }
    });
    const output = renderCommitInspectionContext(
      document({ spans: [span({ anchors: [anchor(), counterpart] }), span({ name: 'second' })] })
    );
    expect(output).toContain('<git-span>');
    expect(output).toContain('</git-span>');
    expect(output).toContain('## relationship');
    expect(output).toContain('new.ts');
    expect(output).toContain('#L7-L8');
    expect(output).not.toContain('old.ts');
    expect(output).toContain('counterpart.ts');
    expect(output).toContain('Second explanation remains complete.');
    expect(output).toContain('\n\n---\n\n## second');
    expect(output).not.toMatch(/Coupling|repair|once per session|read extent|discovery index/i);
  });

  it('preserves every nonfresh status and unavailable reason, with declared locations for absent anchors', () => {
    for (const code of ['MOVED', 'CHANGED', 'DELETED', 'CONFLICT', 'SUBMODULE', 'RESOLVED_PENDING_COMMIT'] as const) {
      const output = renderCommitInspectionContext(
        document({ spans: [span({ anchors: [anchor({ status: { code }, current: null })] })] })
      );
      expect(output).toContain('old.ts');
      expect(output).toContain(` — ${code.toLowerCase().replaceAll('_', ' ')}`);
    }
    const output = renderCommitInspectionContext(
      document({
        spans: [
          span({
            anchors: [
              anchor({
                current: null,
                status: { code: 'CONTENT_UNAVAILABLE', reason: 'LFS_NOT_FETCHED', detail: 'Fetch required' }
              })
            ]
          })
        ]
      })
    );
    expect(output).toContain('old.ts');
    expect(output).toMatch(/lfs.*not.*fetched/i);
  });

  it('returns no empty wrapper and rejects oversized UTF-8 reports rather than truncating them', () => {
    expect(renderCommitInspectionContext(document({ spans: [] }))).toBeNull();
    expect(() => renderCommitInspectionContext(document({ spans: [span({ why: '界'.repeat(23_000) })] }))).toThrow();
  });

  it('delivers identical complete content on repeated inspections without session snapshot state', () => {
    const input = document();
    expect(renderCommitInspectionContext(input)).toEqual(renderCommitInspectionContext(input));
  });
});

describe('native process and atomic delivery', () => {
  it('invokes the native command with immutable argv in the effective repository without metadata mutation', async () => {
    const repo = makeTempRepo();
    try {
      const before = readdirSync(repo.root);
      const executor = protocolChild(`
        const expected = ['commit-context', ${JSON.stringify(FIRST)}];
        if (JSON.stringify(process.argv.slice(1)) !== JSON.stringify(expected)) process.exit(9);
        if (process.cwd() !== ${JSON.stringify(repo.root)}) process.exit(8);
        process.stdout.write(${JSON.stringify(JSON.stringify(document()))});
      `);
      const result = await executor({ repoRoot: repo.root, commits: [FIRST], timeoutMs: 1000 });
      expect(result).toEqual({ ok: true, document: document() });
      expect(readdirSync(repo.root)).toEqual(before);
      expect(existsSync(`${repo.root}/.span`)).toBe(false);
      expect(execFileSync('git', ['status', '--porcelain'], { cwd: repo.root, encoding: 'utf8' })).toBe('');
    } finally {
      repo.cleanup();
    }
  });

  it('turns native process errors, malformed output, mismatch, and timeout into explicit failures', async () => {
    const repo = makeTempRepo();
    try {
      for (const script of [
        'process.exit(2)',
        'process.stdout.write("{")',
        `process.stdout.write(${JSON.stringify(JSON.stringify(document({ commits: [SECOND] })))});`,
        'setTimeout(() => {}, 5000)'
      ]) {
        const result = await protocolChild(script)({ repoRoot: repo.root, commits: [FIRST], timeoutMs: 100 });
        expect(result.ok).toBe(false);
      }
    } finally {
      repo.cleanup();
    }
  });

  it('returns complete reports and empty selections without a partial or empty wrapper', async () => {
    const executor: CommitInspectionContextExecutor = async () => ({ ok: true, document: document() });
    expect(
      await runCommitInspectionContext({ repoRoot: '/repo', commits: [FIRST] }, performance.now() + 1000, executor)
    ).toContain('## relationship');
    const empty: CommitInspectionContextExecutor = async () => ({ ok: true, document: document({ spans: [] }) });
    expect(
      await runCommitInspectionContext({ repoRoot: '/repo', commits: [FIRST] }, performance.now() + 1000, empty)
    ).toBeNull();
    expect(
      await runCommitInspectionContext({ repoRoot: '/repo', commits: [] }, performance.now() + 1000, executor)
    ).toBeNull();
  });

  it('bounds native time by five seconds and the remaining shared driver deadline', async () => {
    const budgets: number[] = [];
    const executor: CommitInspectionContextExecutor = async (request) => {
      budgets.push(request.timeoutMs);
      return { ok: true, document: document() };
    };
    await runCommitInspectionContext({ repoRoot: '/repo', commits: [FIRST] }, performance.now() + 8000, executor);
    await runCommitInspectionContext({ repoRoot: '/repo', commits: [FIRST] }, performance.now() + 2000, executor);
    expect(budgets[0]).toBeLessThanOrEqual(5000);
    expect(budgets[1]).toBeLessThanOrEqual(2000);
    expect(budgets[1]).toBeGreaterThan(0);
  });

  it('emits an unavailable notice and safely quoted retrieval command on failure or expired deadline', async () => {
    const selection = { repoRoot: "/tmp/repo 'quoted' $(unsafe)", commits: [FIRST] };
    const executor: CommitInspectionContextExecutor = async () => ({ ok: false, reason: 'native unavailable' });
    const output = await runCommitInspectionContext(selection, performance.now() + 1000, executor);
    expect(output).toMatch(/unavailable/i);
    expect(output).toContain("'/tmp/repo '\\''quoted'\\'' $(unsafe)'");
    expect(output).toContain('commit-context');
    expect(output).toContain(FIRST);
    expect(output).not.toContain('<git-span>');
    const expired = await runCommitInspectionContext(selection, performance.now() - 1, executor);
    expect(expired).toMatch(/unavailable/i);
    expect(expired).not.toContain('<git-span>');
  });

  it('bounds unavailable notices for 4096 SHA256 identities without printing a partial commit set', async () => {
    const commits = Array.from({ length: 4096 }, (_, index) => index.toString(16).padStart(64, '0'));
    const executor: CommitInspectionContextExecutor = async () => ({ ok: false, reason: 'bounded failure' });
    const output = await runCommitInspectionContext({ repoRoot: '/repo', commits }, performance.now() + 1000, executor);
    expect(Buffer.byteLength(output ?? '')).toBeLessThanOrEqual(4096);
    expect(output).toContain('4096 commits');
    expect(output).toContain('cannot fit');
    expect(output).not.toContain(commits[0]);
    expect(output).not.toContain('<git-span>');
  });

  it('rejects an injected incomplete envelope, oversized rendering, and completion after the deadline atomically', async () => {
    const selection = { repoRoot: '/repo', commits: [FIRST] };
    for (const input of [document({ commits: [SECOND] }), document({ spans: [span({ why: 'x'.repeat(70_000) })] })]) {
      const executor: CommitInspectionContextExecutor = async () => ({ ok: true, document: input });
      const output = await runCommitInspectionContext(selection, performance.now() + 1000, executor);
      expect(output).toMatch(/unavailable/i);
      expect(output).not.toContain('<git-span>');
    }
    const late: CommitInspectionContextExecutor = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { ok: true, document: document() };
    };
    expect(await runCommitInspectionContext(selection, performance.now() + 1, late)).not.toContain('<git-span>');
  });
});

describe('workspace native commit context integration', () => {
  it('decodes and renders real historical overlap with full current counterparts without rewriting definitions', async () => {
    const native = buildWorkspaceGitSpan();
    const repo = makeRealBundleRepo(native.pathDir);
    try {
      writeRepoFile(repo, 'src/main.ts', 'original\n');
      writeRepoFile(repo, 'src/counterpart.ts', 'counterpart\n');
      writeRepoFile(repo, 'src/unrelated.ts', 'unrelated\n');
      commitRepo(repo, 'Create files');
      addLineSpan(repo, 'related', 'src/main.ts', 1, 1, 'Both anchors carry the same contract.');
      addLineSpan(repo, 'related', 'src/counterpart.ts', 1, 1, 'Both anchors carry the same contract.');
      addLineSpan(repo, 'unrelated', 'src/unrelated.ts', 1, 1);
      commitRepo(repo, 'Record relationships');
      writeRepoFile(repo, 'src/main.ts', 'modified\n');
      commitRepo(repo, 'Change selected anchor');
      const oid = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repo.root,
        env: repo.env,
        encoding: 'utf8'
      }).trim();
      const files = execFileSync('git', ['ls-files', '-z', '.span'], {
        cwd: repo.root,
        env: repo.env,
        encoding: 'utf8'
      })
        .split('\0')
        .filter(Boolean);
      const definitions = files.map((path) => readFileSync(join(repo.root, path), 'utf8'));
      const executor = createDefaultCommitInspectionExecutor((argv) => ({
        executable: native.binary,
        argv: [...argv]
      }));
      const result = await executor({ repoRoot: repo.root, commits: [oid], timeoutMs: 5000 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.reason);
      expect(result.document.commits).toEqual([oid]);
      expect(result.document.spans.map((item) => item.name)).toEqual(['related']);
      expect(result.document.spans[0]?.anchors).toHaveLength(2);
      const output = renderCommitInspectionContext(result.document);
      expect(output).toContain('main.ts');
      expect(output).toContain('counterpart.ts');
      expect(output).toContain('changed');
      expect(output).not.toContain('unrelated');
      expect(files.map((path) => readFileSync(join(repo.root, path), 'utf8'))).toEqual(definitions);
      expect(execFileSync('git', ['status', '--porcelain'], { cwd: repo.root, env: repo.env, encoding: 'utf8' })).toBe(
        ''
      );
    } finally {
      repo.cleanup();
    }
  }, 600_000);
});

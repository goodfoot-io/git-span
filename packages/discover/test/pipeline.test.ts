/**
 * Full-pipeline integration test (Stage 2): a real fixture repo run through
 * all 7 signals → grouping → scoring pass 1 → both disqualifiers → scoring
 * pass 2 → rename-tracking → JSON + markdown output.
 *
 * Asserts the two end-to-end guarantees the card requires: the `.span/`
 * directory is never touched, and anchors are emitted in `path#Lstart-Lend`
 * shape (whole-file anchors as bare `path`).
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discover } from '../src/cli.js';
import { toJson, toMarkdown } from '../src/output.js';
import { scoreEvidence } from '../src/scoring.js';
import type { AnchorGroup, RepoContext, Signal, SignalEvidence } from '../src/types.js';

/**
 * Signal-mocking seam for the rename-tracking-dedup test below: `discover()`
 * builds `ALL_SIGNALS` once from this module's exports at import time, so a
 * per-test override has to live *inside* a wrapper function captured at
 * import time, not swap which functions are exported. When
 * `signalOverride.value` is set, the first wrapped signal returns exactly
 * those groups (every other wrapped signal returns `[]`, so the override
 * fires once per `discover()` call, not once per real signal); otherwise
 * every wrapped signal delegates to the real implementation, leaving every
 * other test in this file running the genuine pipeline.
 */
const signalOverride: { value: AnchorGroup[] | null } = { value: null };

vi.mock('../src/signals/index.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, Signal>>();
  const keys = Object.keys(actual);
  const wrapped: Record<string, Signal> = {};
  keys.forEach((key, index) => {
    wrapped[key] = async (ctx: RepoContext) => {
      if (signalOverride.value) return index === 0 ? signalOverride.value : [];
      return actual[key](ctx);
    };
  });
  return wrapped;
});

function git(cwd: string, args: string[], isoDate?: string): void {
  const env = isoDate ? { ...process.env, GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate } : process.env;
  execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore', env });
}

function write(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

/** Recursively snapshot relative-path → content for every file under `root`. */
function snapshotTree(root: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
    const abs = path.join(entry.parentPath ?? root, entry.name);
    if (entry.isFile()) out.set(path.relative(root, abs), fs.readFileSync(abs, 'utf8'));
  }
  return out;
}

const T0 = '2024-03-01T00:00:00+00:00';
const T0_1M = '2024-03-01T00:01:00+00:00';
const T0_2M = '2024-03-01T00:02:00+00:00';
const T0_3M = '2024-03-01T00:03:00+00:00';

describe('full pipeline', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'git-span-discover-pipeline-'));
    git(repoRoot, ['init', '--quiet', '--initial-branch=main']);
    git(repoRoot, ['config', 'user.email', 'fixture@example.com']);
    git(repoRoot, ['config', 'user.name', 'Fixture Builder']);
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    signalOverride.value = null;
  });

  it('mines a fixture repo end-to-end, leaving .span/ untouched and emitting path#Lstart-Lend anchors', async () => {
    // A pre-existing .span/ record — the pipeline must never read or write it.
    write(repoRoot, '.span/records/legacy.json', '{"anchor":"do-not-touch"}\n');

    // alpha.ts and beta.ts are created in separate, close-in-time commits
    // (time-window/same-author-session evidence, range-anchored), then
    // touched together in the same commit twice more (association-rules
    // evidence — a real repeated co-change, not mere temporal coincidence).
    // After the pass-1/pass-2 threshold recalibration (this card), no single
    // circumstantial signal — however strong — clears the bar alone; a
    // fixture needs genuine multi-signal corroboration to produce a
    // surviving group, same as it would on a real repository.
    write(repoRoot, 'alpha.ts', 'const alpha = 1;\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '--quiet', '-m', 'add alpha.ts and a span record'], T0);

    write(repoRoot, 'beta.ts', 'const beta = 2;\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '--quiet', '-m', 'add beta.ts'], T0_1M);

    write(repoRoot, 'gamma.ts', 'const gamma = 3;\n');
    write(repoRoot, 'alpha.ts', 'const alpha = 1;\nconst alphaAgain = 1;\n');
    write(repoRoot, 'beta.ts', 'const beta = 2;\nconst betaAgain = 2;\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '--quiet', '-m', 'add gamma.ts, touch alpha.ts and beta.ts together'], T0_2M);

    write(repoRoot, 'alpha.ts', 'const alpha = 1;\nconst alphaAgain = 1;\nconst alphaThird = 1;\n');
    write(repoRoot, 'beta.ts', 'const beta = 2;\nconst betaAgain = 2;\nconst betaThird = 2;\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '--quiet', '-m', 'touch alpha.ts and beta.ts together again'], T0_3M);

    const spanBefore = snapshotTree(path.join(repoRoot, '.span'));
    expect(spanBefore.size).toBeGreaterThan(0);

    const groups = await discover(repoRoot);

    // The pipeline produced a non-empty report from local history alone.
    expect(groups.length).toBeGreaterThan(0);

    // .span/ guard: contents byte-identical, and git sees no working-tree changes.
    const spanAfter = snapshotTree(path.join(repoRoot, '.span'));
    expect(spanAfter).toEqual(spanBefore);
    const status = execFileSync('git', ['-C', repoRoot, 'status', '--porcelain'], { encoding: 'utf8' });
    expect(status.trim()).toBe('');
    expect(status).not.toContain('.span');

    // Anchor shape: every anchor is either `path` or `path#Lstart-Lend`.
    const anchorPattern = /^[^#]+(#L\d+-L\d+)?$/;
    const allAnchors = groups.flatMap((g) =>
      g.anchors.map((a) => (a.startLine !== undefined ? `${a.path}#L${a.startLine}-L${a.endLine}` : a.path))
    );
    for (const anchor of allAnchors) expect(anchor).toMatch(anchorPattern);

    // At least one range-anchored candidate survived to output.
    const hasRangeAnchor = groups.some((g) => g.anchors.some((a) => a.startLine !== undefined));
    expect(hasRangeAnchor).toBe(true);

    // No emitted anchor references a .span/ path.
    for (const anchor of allAnchors) expect(anchor.startsWith('.span')).toBe(false);

    // Both renderers succeed on the real output.
    const json = JSON.parse(toJson(groups));
    expect(Array.isArray(json.groups)).toBe(true);
    expect(json.groups[0].anchors.every((a: string) => anchorPattern.test(a))).toBe(true);
    expect(toMarkdown(groups)).toContain('# Implicit dependency candidates');
  });

  it('degrades to an empty groups result for a zero-commit repo instead of throwing', async () => {
    // repoRoot from beforeEach is `git init`'d but has zero commits — the
    // natural boundary case a fresh, unused project would hit (finding 1).
    await expect(discover(repoRoot)).resolves.toEqual([]);
  });

  it('dedupes two distinct pass-2 survivor groups that resolve to the same surviving anchor set at HEAD', async () => {
    // a.ts and b.ts survive to HEAD; x.ts and y.ts are each deleted in a
    // later commit. Two synthetic pass-1/pass-2 survivor groups — {a,b,x} and
    // {a,b,y} — are distinct pre-resolution (grouping's full-match check
    // doesn't merge them: x and y don't overlap), but rename-tracking drops
    // the deleted third anchor from each, so both resolve to the identical
    // {a,b} pair at HEAD. discover()'s output must contain exactly one entry
    // for that pair, not two — the gap this test was written to close.
    write(repoRoot, 'a.ts', 'const a = 1;\n');
    write(repoRoot, 'b.ts', 'const b = 2;\n');
    write(repoRoot, 'x.ts', 'const x = 3;\n');
    write(repoRoot, 'y.ts', 'const y = 4;\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '--quiet', '-m', 'add a.ts, b.ts, x.ts, y.ts'], T0);

    fs.rmSync(path.join(repoRoot, 'x.ts'));
    fs.rmSync(path.join(repoRoot, 'y.ts'));
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '--quiet', '-m', 'delete x.ts and y.ts'], T0_1M);

    const groupWithX: AnchorGroup = {
      anchors: [{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'x.ts' }],
      evidence: [{ signal: 'association-rules', strength: 1, detail: 'synthetic: a+b+x' }],
      score: 0
    };
    const groupWithY: AnchorGroup = {
      anchors: [{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'y.ts' }],
      evidence: [{ signal: 'association-rules', strength: 1, detail: 'synthetic: a+b+y' }],
      score: 0
    };
    signalOverride.value = [groupWithX, groupWithY];

    const groups = await discover(repoRoot);

    const abPair = groups.filter(
      (g) =>
        g.anchors.length === 2 && g.anchors.some((a) => a.path === 'a.ts') && g.anchors.some((a) => a.path === 'b.ts')
    );
    expect(abPair).toHaveLength(1);

    // Evidence from both original groups survived the merge.
    const details = abPair[0].signals.map((e) => e.detail);
    expect(details).toContain('synthetic: a+b+x');
    expect(details).toContain('synthetic: a+b+y');
  });
});

/**
 * Stage 4 (n-ary near-clique grouping) integration tests (a)-(f).
 *
 * Each drives the real `discover()` pipeline over a committed fixture repo,
 * injecting the *signal* layer via `signalOverride` (2-anchor whole-file
 * `AnchorGroup`s — exactly the shape the real pairwise signals emit) so the
 * weighted-graph → near-clique-extraction → per-candidate-gate →
 * subset-suppression path is exercised end to end, while disqualifier firing
 * is controlled through genuine file *content* (real `raw-path-inclusion`
 * runs, not a mock). Fixture file stems are ≥4 chars and non-generic so
 * `raw-path-inclusion` treats a bare-filename reference as a real match.
 *
 * NOTE (flagged for review): test (a)'s byte-equivalence assertion is at
 * *fixture* scale (a single 2-file pair reconstructed identically to the old
 * `mergeAnchorGroups` pipeline), not the real-repo 294-group corpus
 * comparison. It pins the reconstruction *mechanism* (anchors via
 * `collapseAnchors`, evidence via the union/sort, PASS1/PASS2 gating), which
 * is where a regression would surface, but it is not a full-corpus diff.
 */
describe('Stage 4 n-ary near-clique grouping', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'git-span-discover-stage4-'));
    git(repoRoot, ['init', '--quiet', '--initial-branch=main']);
    git(repoRoot, ['config', 'user.email', 'fixture@example.com']);
    git(repoRoot, ['config', 'user.name', 'Fixture Builder']);
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    signalOverride.value = null;
  });

  /** Commits every `path → content` entry in one commit. */
  function commitFiles(files: Record<string, string>): void {
    for (const [rel, content] of Object.entries(files)) write(repoRoot, rel, content);
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '--quiet', '-m', 'fixture'], T0);
  }

  function assoc(strength: number, commits?: string[]): SignalEvidence {
    return { signal: 'association-rules', strength, ...(commits ? { commits } : {}) };
  }

  /** A 2-anchor whole-file signal group — the exact shape a real pairwise signal emits. */
  function pairGroup(pathA: string, pathB: string, evidence: SignalEvidence[]): AnchorGroup {
    return { anchors: [{ path: pathA }, { path: pathB }], evidence, score: 0 };
  }

  const pathsOf = (g: { anchors: { path: string }[] }): Set<string> => new Set(g.anchors.map((a) => a.path));

  // -- (a) --------------------------------------------------------------------
  it('(a) reproduces a 2-file group byte-equivalently, including the no-match floor', async () => {
    // alpha.ts and bravo.ts are clean and never reference each other — the
    // disqualifiers fire nothing, so both emit their EPSILON=0.02 no-match
    // floor (the "no-match-floor case"). Two association-rules observations of
    // the *same* pair (distinct commits) must union into one 2-file group whose
    // anchors, evidence order, and score match the old mergeAnchorGroups path.
    commitFiles({ 'alpha.ts': 'const alpha = 1;\n', 'bravo.ts': 'const bravo = 2;\n' });
    signalOverride.value = [
      pairGroup('alpha.ts', 'bravo.ts', [assoc(1, ['c1'])]),
      pairGroup('alpha.ts', 'bravo.ts', [assoc(1, ['c2'])])
    ];

    const groups = await discover(repoRoot);
    expect(groups).toHaveLength(1);

    const json = JSON.parse(toJson(groups));
    const group = json.groups[0];

    // Anchors: exactly the two whole-file paths, sorted.
    expect(group.anchors).toEqual(['alpha.ts', 'bravo.ts']);

    // Evidence union: both observations retained, deterministically ordered.
    expect(group.signals).toEqual([
      { signal: 'association-rules', strength: 1, commits: ['c1'] },
      { signal: 'association-rules', strength: 1, commits: ['c2'] }
    ]);

    // No-match floor: both disqualifiers report their sub-0.5 floor (never
    // absent, never firing) — the byte-equivalent payload the old pipeline
    // stored, with the internal `edge` tag stripped at the JSON boundary.
    const labels = new Set(group.disqualifiers.map((d: { disqualifier: string }) => d.disqualifier));
    expect(labels).toEqual(new Set(['raw-path-inclusion', 'tree-sitter-reference']));
    for (const d of group.disqualifiers) {
      expect(d.strength).toBeLessThan(0.5);
      expect(d.edge).toBeUndefined();
    }

    // Score is the pass-2 blend, essentially undented by the neutral floor.
    expect(group.score).toBeGreaterThan(0.99);
  });

  // -- (b) --------------------------------------------------------------------
  it('(b) keeps a 4-file full clique with one disqualified edge as a near-clique scored at the min surviving edge', async () => {
    // echo.ts names delta.ts, so raw-path-inclusion demotes the delta–echo
    // edge to a gap; the bravo–charlie edge is deliberately the weakest present
    // edge (strength 0.7), so the clique's min-edge score must land on it — not
    // on any of the four strong (strength 1) edges, and not on the gap's raw
    // weight.
    commitFiles({
      'bravo.ts': 'const bravo = 1;\n',
      'charlie.ts': 'const charlie = 1;\n',
      'delta.ts': 'const delta = 1;\n',
      'echo.ts': '// uses delta.ts\nconst echo = 1;\n'
    });
    signalOverride.value = [
      pairGroup('bravo.ts', 'charlie.ts', [assoc(0.7)]),
      pairGroup('bravo.ts', 'delta.ts', [assoc(1)]),
      pairGroup('bravo.ts', 'echo.ts', [assoc(1)]),
      pairGroup('charlie.ts', 'delta.ts', [assoc(1)]),
      pairGroup('charlie.ts', 'echo.ts', [assoc(1)]),
      pairGroup('delta.ts', 'echo.ts', [assoc(1)])
    ];

    const groups = await discover(repoRoot);
    expect(groups).toHaveLength(1);
    expect(pathsOf(groups[0])).toEqual(new Set(['bravo.ts', 'charlie.ts', 'delta.ts', 'echo.ts']));

    // Score pinned to the weakest present edge (bravo–charlie), strictly below
    // the strong edges' weight — proof it is the per-clique *minimum*, not a
    // pooled sum, and that the disqualified gap's raw weight didn't win.
    const weakEdge = scoreEvidence([assoc(0.7)]);
    const strongEdge = scoreEvidence([assoc(1)]);
    expect(groups[0].score).toBeGreaterThan(0.85);
    expect(groups[0].score).toBeLessThanOrEqual(weakEdge + 1e-9);
    expect(groups[0].score).toBeGreaterThan(weakEdge - 0.05);
    expect(groups[0].score).toBeLessThan(strongEdge);
  });

  // -- (c) --------------------------------------------------------------------
  it('(c) rejects a candidate with two gaps while its clean sub-clique survives', async () => {
    // quebec.ts names both mike.ts and november.ts (two disqualified edges),
    // and has no oscar edge at all (a third gap) — the 4-node candidate is
    // dropped outright. The clean {mike, november, oscar} triangle, which
    // excludes the compromised node, survives on its own.
    commitFiles({
      'mike.ts': 'const mike = 1;\n',
      'november.ts': 'const november = 1;\n',
      'oscar.ts': 'const oscar = 1;\n',
      'quebec.ts': '// mike.ts november.ts\nconst quebec = 1;\n'
    });
    signalOverride.value = [
      pairGroup('mike.ts', 'november.ts', [assoc(1)]),
      pairGroup('mike.ts', 'oscar.ts', [assoc(1)]),
      pairGroup('november.ts', 'oscar.ts', [assoc(1)]),
      pairGroup('mike.ts', 'quebec.ts', [assoc(1)]),
      pairGroup('november.ts', 'quebec.ts', [assoc(1)])
    ];

    const groups = await discover(repoRoot);
    expect(groups).toHaveLength(1);
    expect(pathsOf(groups[0])).toEqual(new Set(['mike.ts', 'november.ts', 'oscar.ts']));
    // quebec never appears in any surviving group.
    expect(groups.some((g) => pathsOf(g).has('quebec.ts'))).toBe(false);
  });

  // -- (d) --------------------------------------------------------------------
  it('(d) rejects a near-clique whose gap is weak (~0.5) but keeps one whose gap clears reportThreshold(3,1)', async () => {
    // Two independent hub-and-spoke triples, all files clean (no disqualifiers
    // fire). Both hub edges sit at 0.7 → ~0.905 (clique edges, but below the
    // 2-node PASS1 bar, so they never surface as 2-node groups and pollute the
    // assertion). The surviving trio's gap carries genuine weak evidence
    // (strength 0.53 → ~0.822 ≥ 0.75), so MISSING_EDGE_PENALTY lets it through;
    // the rejected trio's gap has no evidence at all (raw weight 0.5 < 0.75).
    commitFiles({
      'sierra.ts': 'const sierra = 1;\n',
      'tango.ts': 'const tango = 1;\n',
      'uniform.ts': 'const uniform = 1;\n',
      'victor.ts': 'const victor = 1;\n',
      'whiskey.ts': 'const whiskey = 1;\n',
      'xray.ts': 'const xray = 1;\n'
    });
    signalOverride.value = [
      // Survivor: sierra hubs tango & uniform strongly; tango–uniform is the weak gap.
      pairGroup('sierra.ts', 'tango.ts', [assoc(0.7)]),
      pairGroup('sierra.ts', 'uniform.ts', [assoc(0.7)]),
      pairGroup('tango.ts', 'uniform.ts', [assoc(0.53)]),
      // Reject: victor hubs whiskey & xray; whiskey–xray gap has no evidence (~0.5).
      pairGroup('victor.ts', 'whiskey.ts', [assoc(0.7)]),
      pairGroup('victor.ts', 'xray.ts', [assoc(0.7)])
    ];

    const groups = await discover(repoRoot);
    expect(groups).toHaveLength(1);
    expect(pathsOf(groups[0])).toEqual(new Set(['sierra.ts', 'tango.ts', 'uniform.ts']));
    // Score rides the surviving gap's raw weight (the min of the three pairs).
    expect(groups[0].score).toBeCloseTo(scoreEvidence([assoc(0.53)]), 6);
    // The weak-gap trio produced nothing.
    expect(groups.some((g) => ['victor.ts', 'whiskey.ts', 'xray.ts'].some((p) => pathsOf(g).has(p)))).toBe(false);
  });

  // -- (e) --------------------------------------------------------------------
  it('(e) reports a qualifying 2-node subset even though its 3-node superset was extracted and then failed its gate', async () => {
    // The ordering-bug regression: {papa, quebec, romeo} is extracted as a full
    // triangle, but romeo.ts names both papa.ts and quebec.ts, disqualifying
    // two of its edges → the 3-node candidate fails. The clean {papa, quebec}
    // pair must still be reported — subset suppression runs *after* scoring, so
    // a failed superset can no longer swallow it.
    commitFiles({
      'papa.ts': 'const papa = 1;\n',
      'quebec.ts': 'const quebec = 1;\n',
      'romeo.ts': '// papa.ts quebec.ts\nconst romeo = 1;\n'
    });
    signalOverride.value = [
      pairGroup('papa.ts', 'quebec.ts', [assoc(1)]),
      pairGroup('papa.ts', 'romeo.ts', [assoc(1)]),
      pairGroup('quebec.ts', 'romeo.ts', [assoc(1)])
    ];

    const groups = await discover(repoRoot);
    expect(groups).toHaveLength(1);
    expect(pathsOf(groups[0])).toEqual(new Set(['papa.ts', 'quebec.ts']));
    expect(groups.some((g) => pathsOf(g).has('romeo.ts'))).toBe(false);
    expect(groups[0].score).toBeGreaterThan(0.99);
  });

  // -- (f) --------------------------------------------------------------------
  it('(f) suppresses the 2-node subsets of a qualifying 3-node clique', async () => {
    // A clean full triangle qualifies; each of its three 2-node subsets would
    // qualify on its own, but strict-subset suppression drops them so only the
    // maximal {alpha, bravo, charlie} group is reported.
    commitFiles({
      'alpha.ts': 'const alpha = 1;\n',
      'bravo.ts': 'const bravo = 1;\n',
      'charlie.ts': 'const charlie = 1;\n'
    });
    signalOverride.value = [
      pairGroup('alpha.ts', 'bravo.ts', [assoc(1)]),
      pairGroup('alpha.ts', 'charlie.ts', [assoc(1)]),
      pairGroup('bravo.ts', 'charlie.ts', [assoc(1)])
    ];

    const groups = await discover(repoRoot);
    expect(groups).toHaveLength(1);
    expect(pathsOf(groups[0])).toEqual(new Set(['alpha.ts', 'bravo.ts', 'charlie.ts']));
    // No 2-node subset leaked through.
    expect(groups.every((g) => g.anchors.length === 3)).toBe(true);
  });
});

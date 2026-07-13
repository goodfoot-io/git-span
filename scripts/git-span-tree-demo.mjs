#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, matchesGlob, normalize, relative, sep } from 'node:path';

function fail(message) {
  console.error(`git-span-tree-demo: ${message}`);
  process.exit(1);
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function gitTry(args) {
  try {
    return git(args);
  } catch {
    return '';
  }
}

function resolveSpanRoot(repoRoot) {
  const configured =
    process.env.GIT_SPAN_DIR || gitTry(['config', '--get', 'git-span.dir']) || '.span';
  if (isAbsolute(configured)) {
    fail(`span root must be repository-relative: ${configured}`);
  }

  const resolved = normalize(join(repoRoot, configured));
  const relativeRoot = relative(repoRoot, resolved);
  if (relativeRoot === '..' || relativeRoot.startsWith(`..${sep}`)) {
    fail(`span root escapes the repository: ${configured}`);
  }
  return resolved;
}

function listSpanFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSpanFiles(path));
    } else if (entry.isFile() && !entry.name.startsWith('.')) {
      files.push(path);
    }
  }
  return files.sort();
}

function parseSpanAnchors(path) {
  const anchors = [];
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (line === '') break;

    const match = /^(.*?)\s+\S+:\S+$/.exec(line);
    if (!match) {
      fail(`cannot parse anchor line in ${path}: ${line}`);
    }
    anchors.push(match[1].replace(/#L\d+-L\d+$/, ''));
  }
  return anchors;
}

function addEdge(graph, left, right, weight) {
  if (left === right) return;
  if (!graph.has(left)) graph.set(left, new Map());
  if (!graph.has(right)) graph.set(right, new Map());
  graph.get(left).set(right, (graph.get(left).get(right) ?? 0) + weight);
  graph.get(right).set(left, (graph.get(right).get(left) ?? 0) + weight);
}

function buildGraph(spanFiles) {
  const graph = new Map();

  for (const spanFile of spanFiles) {
    const counts = new Map();
    for (const path of parseSpanAnchors(spanFile)) {
      counts.set(path, (counts.get(path) ?? 0) + 1);
      if (!graph.has(path)) graph.set(path, new Map());
    }

    const paths = [...counts.keys()].sort();
    for (let left = 0; left < paths.length; left++) {
      for (let right = left + 1; right < paths.length; right++) {
        addEdge(graph, paths[left], paths[right], counts.get(paths[left]) * counts.get(paths[right]));
      }
    }
  }

  return graph;
}

// A bare directory prefix (`packages`) matches everything beneath it, so it is
// equivalent to `packages/**` / `packages/**/*`. An exact glob still wins first.
function matchesPattern(path, pattern) {
  return matchesGlob(path, pattern) || matchesGlob(path, `${pattern.replace(/\/+$/, '')}/**/*`);
}

// Globs are written relative to the current working directory; anchored paths
// are repository-relative, so prepend the cwd's repo-relative prefix to each.
function repoRelativePatterns(repoRoot, patterns) {
  const cwdRelative = relative(repoRoot, process.cwd());
  if (cwdRelative === '..' || cwdRelative.startsWith(`..${sep}`)) {
    fail(`current directory escapes the repository: ${process.cwd()}`);
  }
  const prefix = cwdRelative === '' ? '' : cwdRelative.split(sep).join('/');
  return patterns.map((pattern) => (prefix === '' ? pattern : `${prefix}/${pattern}`));
}

function findRoots(paths, patterns) {
  const roots = new Set();
  for (const pattern of patterns) {
    const matches = paths.filter((path) => matchesPattern(path, pattern));
    if (matches.length === 0) {
      fail(`pattern matched no anchored files: ${pattern}`);
    }
    for (const path of matches) roots.add(path);
  }
  return roots;
}

// Enumerate every maximal clique among `candidates` (Bron–Kerbosch with a
// pivot), using the span graph for adjacency. A clique is a set in which every
// pair is directly connected; a candidate with no edge to another candidate
// comes back as a one-element clique. Cliques may overlap — a file shared by
// two cliques appears in both, since dropping the edge would hide a real
// propagation path.
function maximalCliques(graph, candidates) {
  const inScope = new Set(candidates);
  const neighborsInScope = (path) => {
    const result = new Set();
    for (const neighbor of graph.get(path).keys()) {
      if (inScope.has(neighbor)) result.add(neighbor);
    }
    return result;
  };

  const cliques = [];
  const search = (included, remaining, excluded) => {
    if (remaining.size === 0 && excluded.size === 0) {
      cliques.push([...included]);
      return;
    }

    let pivot = null;
    let pivotReach = -1;
    for (const candidate of [...remaining, ...excluded]) {
      const reach = [...neighborsInScope(candidate)].filter((n) => remaining.has(n)).length;
      if (reach > pivotReach) {
        pivotReach = reach;
        pivot = candidate;
      }
    }
    const pivotNeighbors = pivot === null ? new Set() : neighborsInScope(pivot);

    for (const vertex of [...remaining]) {
      if (pivotNeighbors.has(vertex)) continue;
      const adjacency = neighborsInScope(vertex);
      search(
        new Set(included).add(vertex),
        new Set([...remaining].filter((n) => adjacency.has(n))),
        new Set([...excluded].filter((n) => adjacency.has(n))),
      );
      remaining.delete(vertex);
      excluded.add(vertex);
    }
  };

  search(new Set(), new Set(candidates), new Set());
  return cliques;
}

// Order a clique's members most-connected-within-the-clique first, then by path.
function orderMembers(graph, clique) {
  const internalWeight = (path) => {
    let sum = 0;
    const edges = graph.get(path);
    for (const other of clique) if (other !== path) sum += edges.get(other) ?? 0;
    return sum;
  };
  return [...clique].sort(
    (left, right) => internalWeight(right) - internalWeight(left) || left.localeCompare(right),
  );
}

// Expand a clique into a subtree. The clique's children are the maximal cliques
// formed among the union of its members' external neighbors. A clique expands
// once, as a unit, so interconnected siblings are not re-listed under one
// another. Loops are guarded per-branch: `ancestors` holds every file on the
// path from a root to here, so none is re-expanded as its own descendant.
function expandClique(graph, members, ancestors, depth, maxDepth) {
  const node = { members, children: [] };
  if (depth >= maxDepth) return node;

  const nextAncestors = new Set(ancestors);
  for (const member of members) nextAncestors.add(member);

  const candidates = new Set();
  for (const member of members) {
    for (const neighbor of graph.get(member).keys()) {
      if (!nextAncestors.has(neighbor)) candidates.add(neighbor);
    }
  }
  if (candidates.size === 0) return node;

  const childCliques = maximalCliques(graph, [...candidates].sort()).map((clique) =>
    orderMembers(graph, clique),
  );

  // Order child cliques by the strongest edge linking them back to this clique.
  const linkWeight = (clique) => {
    let best = 0;
    for (const member of members) {
      const edges = graph.get(member);
      for (const child of clique) best = Math.max(best, edges.get(child) ?? 0);
    }
    return best;
  };
  childCliques.sort(
    (left, right) => linkWeight(right) - linkWeight(left) || left[0].localeCompare(right[0]),
  );

  for (const clique of childCliques) {
    node.children.push(expandClique(graph, clique, nextAncestors, depth + 1, maxDepth));
  }
  return node;
}

function renderNode(node, indent = '') {
  const lines = [`${indent}- ${node.members.join(', ')}`];
  for (const child of node.children) {
    lines.push(...renderNode(child, `${indent}  `));
  }
  return lines;
}

function parseDepth(value) {
  if (value === undefined) fail('-d/--depth requires a value');
  const depth = Number(value);
  if (!Number.isInteger(depth) || depth < 0) {
    fail(`depth must be a non-negative integer: ${value}`);
  }
  return depth;
}

function parseArgs(argv) {
  const patterns = [];
  // Files may recur across branches, so the expansion is over simple paths and
  // grows exponentially with depth. Default shallow; callers opt into more.
  let maxDepth = 3;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '-d' || arg === '--depth') {
      maxDepth = parseDepth(argv[++index]);
    } else if (arg.startsWith('--depth=')) {
      maxDepth = parseDepth(arg.slice('--depth='.length));
    } else if (arg.startsWith('-d=')) {
      maxDepth = parseDepth(arg.slice('-d='.length));
    } else if (arg.startsWith('-')) {
      fail(`unknown option: ${arg}`);
    } else {
      patterns.push(arg);
    }
  }
  // No globs means the whole tree relative to the current directory.
  if (patterns.length === 0) patterns.push('**/*');
  return { patterns, maxDepth };
}

const { patterns, maxDepth } = parseArgs(process.argv.slice(2));

const repoRoot = git(['rev-parse', '--show-toplevel']);
const spanRoot = resolveSpanRoot(repoRoot);
if (!existsSync(spanRoot) || !statSync(spanRoot).isDirectory()) {
  fail(`span root does not exist: ${relative(repoRoot, spanRoot) || '.'}`);
}

const graph = buildGraph(listSpanFiles(spanRoot));
const roots = findRoots([...graph.keys()].sort(), repoRelativePatterns(repoRoot, patterns));

// The matched roots are themselves grouped into cliques before expansion.
const rootCliques = maximalCliques(graph, [...roots].sort()).map((clique) =>
  orderMembers(graph, clique),
);
const internalWeight = (clique) => {
  let sum = 0;
  for (const left of clique) {
    const edges = graph.get(left);
    for (const right of clique) if (left < right) sum += edges.get(right) ?? 0;
  }
  return sum;
};
rootCliques.sort(
  (left, right) => internalWeight(right) - internalWeight(left) || left[0].localeCompare(right[0]),
);
const forest = rootCliques.map((clique) => expandClique(graph, clique, new Set(), 0, maxDepth));

console.log(forest.flatMap((node) => renderNode(node)).join('\n'));

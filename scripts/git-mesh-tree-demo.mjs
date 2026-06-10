#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, matchesGlob, normalize, relative, sep } from 'node:path';

function fail(message) {
  console.error(`git-mesh-tree-demo: ${message}`);
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

function resolveMeshRoot(repoRoot) {
  const configured =
    process.env.GIT_MESH_DIR || gitTry(['config', '--get', 'git-mesh.dir']) || '.mesh';
  if (isAbsolute(configured)) {
    fail(`mesh root must be repository-relative: ${configured}`);
  }

  const resolved = normalize(join(repoRoot, configured));
  const relativeRoot = relative(repoRoot, resolved);
  if (relativeRoot === '..' || relativeRoot.startsWith(`..${sep}`)) {
    fail(`mesh root escapes the repository: ${configured}`);
  }
  return resolved;
}

function listMeshFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMeshFiles(path));
    } else if (entry.isFile() && !entry.name.startsWith('.')) {
      files.push(path);
    }
  }
  return files.sort();
}

function parseMeshAnchors(path) {
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

function buildGraph(meshFiles) {
  const graph = new Map();

  for (const meshFile of meshFiles) {
    const counts = new Map();
    for (const path of parseMeshAnchors(meshFile)) {
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

// Expand a file into a subtree. A file may surface under many parents and at
// many depths, so loops are guarded per-branch: `ancestors` holds every file
// on the path from a root to here, and a neighbor already on that path is not
// re-expanded. Children are ordered by edge weight (closeness) then by path.
function expand(graph, path, ancestors, depth, maxDepth) {
  const node = { path, children: [] };
  if (depth >= maxDepth) return node;

  const neighbors = [...graph.get(path)]
    .filter(([neighbor]) => !ancestors.has(neighbor))
    .sort(([leftPath, leftWeight], [rightPath, rightWeight]) => {
      return rightWeight - leftWeight || leftPath.localeCompare(rightPath);
    });

  const nextAncestors = new Set(ancestors).add(path);
  for (const [neighbor] of neighbors) {
    node.children.push(expand(graph, neighbor, nextAncestors, depth + 1, maxDepth));
  }
  return node;
}

function renderNode(node, indent = '') {
  const lines = [`${indent}- ${node.path}`];
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
const meshRoot = resolveMeshRoot(repoRoot);
if (!existsSync(meshRoot) || !statSync(meshRoot).isDirectory()) {
  fail(`mesh root does not exist: ${relative(repoRoot, meshRoot) || '.'}`);
}

const graph = buildGraph(listMeshFiles(meshRoot));
const roots = findRoots([...graph.keys()].sort(), repoRelativePatterns(repoRoot, patterns));
const forest = [...roots].sort().map((root) => expand(graph, root, new Set(), 0, maxDepth));

console.log(forest.flatMap((node) => renderNode(node)).join('\n'));

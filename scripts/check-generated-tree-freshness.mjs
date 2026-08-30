#!/usr/bin/env node
/**
 * The single staleness gate for every committed generated tree, shared by
 * scripts/validate.sh and the release workflow so the two can never measure
 * different things again (the local gate once used `git diff` — blind to
 * untracked files — while CI used `git status`, so a newly rendered skill
 * passed locally and failed at tag time).
 *
 * Two properties the previous in-place gates lacked:
 *
 * 1. **The gate observes drift instead of healing it.** For the skills
 *    suite the rebuild it runs cannot alter what the diff then measures:
 *    the build driver snapshots modified tracked bytes before publishing and
 *    refuses (restoring them, exit 2) rather than overwrite a hand-edit,
 *    refuses untracked files in the trees before publishing at all, and
 *    exits 3 when the CLI produced no verifiable render. Only a build that
 *    demonstrably rendered every tree without touching uncommitted bytes
 *    reaches the staleness measurement — which is then equivalent to diffing
 *    a scratch render against the committed trees.
 *
 * 2. **The failure text diagnoses before it advises.** "Commit the rebuilt
 *    trees" is correct in exactly one of the three states a dirty tree can
 *    mean; in the other two (an unverifiable no-op render, a hand-edit
 *    sitting in generated output) that advice permanently enshrines the
 *    problem. Each driver exit code gets its own message, and only the
 *    genuine-drift one ever says "commit".
 *
 * Usage: node scripts/check-generated-tree-freshness.mjs <skills|hooks>
 * @module
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry, repo } from './agent-skills-registry.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));

/**
 * The hook-bundle trees are rebuilt by their own build steps (yarn build
 * locally, the dedicated workflow steps in CI); this gate only measures them.
 */
const HOOKS_TREES = [
  'plugins-claude/git-span/hooks',
  'plugins-codex/git-span/hooks',
  'plugins-opencode/git-span/dist',
  'plugins-antigravity/git-span/hooks.json',
  'plugins-antigravity/git-span/bin'
];

/**
 * The one staleness predicate: everything `git status --porcelain` sees in
 * the given trees — modified AND untracked AND deleted. Any single-kind
 * check (a bare `git diff`, an untracked-only scan) certifies states its
 * sibling gate rejects.
 * @param {string[]} trees
 */
function treeDirt(trees) {
  // --untracked-files=all: porcelain otherwise collapses a whole untracked
  // directory to one "dir/" line, hiding the file names the advice cites.
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '--', ...trees], {
    cwd: repo,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    process.stderr.write(`git status --porcelain failed:\n${result.stderr}\n`);
    process.exit(1);
  }
  /** @type {{ modified: string[], untracked: string[], deleted: string[] }} */
  const dirt = { modified: [], untracked: [], deleted: [] };
  for (const line of result.stdout.split('\n').filter(Boolean)) {
    const code = line.slice(0, 2);
    const file = line.slice(3);
    if (code === '??') dirt.untracked.push(file);
    else if (code.includes('D')) dirt.deleted.push(file);
    else dirt.modified.push(file);
  }
  return dirt;
}

/** @param {ReturnType<typeof treeDirt>} dirt */
function describeDirt(dirt) {
  return [
    ...dirt.modified.map((file) => `  ${file} (modified)`),
    ...dirt.untracked.map((file) => `  ${file} (new file, untracked)`),
    ...dirt.deleted.map((file) => `  ${file} (deleted)`)
  ].join('\n');
}

/** @param {string[]} trees @param {string} rebuildAdvice */
function requireClean(trees, rebuildAdvice) {
  const dirt = treeDirt(trees);
  if (dirt.modified.length + dirt.untracked.length + dirt.deleted.length === 0) return;
  process.stderr.write(
    `ERROR: the rebuild produced output that is not committed — the committed generated trees are stale:\n` +
      `${describeDirt(dirt)}\n${rebuildAdvice}\n`
  );
  process.exit(1);
}

const suite = process.argv[2];

if (suite === 'hooks') {
  requireClean(HOOKS_TREES, 'Commit the rebuilt plugin bundles together with the source change that reworked them.');
  console.log(`hooks trees fresh: ${HOOKS_TREES.join(', ')}`);
  process.exit(0);
}

if (suite !== 'skills') {
  process.stderr.write(`Usage: node scripts/check-generated-tree-freshness.mjs <skills|hooks>\n`);
  process.exit(1);
}

const trees = loadRegistry().plugins.flatMap((plugin) => plugin.targets.map((target) => target.path));

const build = spawnSync(process.execPath, [path.join(scripts, 'build-agent-skills.mjs')], {
  cwd: repo,
  stdio: 'inherit',
  env: process.env
});
if (build.error) throw build.error;

// Branch on the driver's exit-code contract (see build-agent-skills.mjs
// header). Only the genuine-drift case below ever advises committing.
if (build.status === 2) {
  process.stderr.write(
    `\nFRESHNESS GATE: uncommitted hand-edits sit inside the generated skill trees (named above,\n` +
      `each with the skills-src/ template it came from). Port the edit into that template, rebuild\n` +
      `with 'node scripts/build-agent-skills.mjs', and commit the template together with the rebuilt\n` +
      `trees. Do NOT commit the current tree bytes — an edit committed into generated output is\n` +
      `silently overwritten by the next rebuild.\n`
  );
  process.exit(1);
}
if (build.status === 3) {
  process.stderr.write(
    `\nFRESHNESS GATE: the build rendered no verifiable output (see above) — the render did not\n` +
      `demonstrably run, so no freshness verdict exists for the skill trees. Fix the build first\n` +
      `(an unresolved CLI path or broken invocation is the usual cause). Never commit the trees on\n` +
      `the strength of this state.\n`
  );
  process.exit(1);
}
if (build.status !== 0) {
  process.stderr.write(
    `\nFRESHNESS GATE: the skills build refused or failed before freshness could be measured — ` +
      `resolve the diagnostic above.\n`
  );
  process.exit(1);
}

requireClean(
  trees,
  'These trees are GENERATED from skills-src/. The rebuild verifiably rendered every target, so\n' +
    'this dirt is legitimate new output: commit the rebuilt trees together with the template\n' +
    'change that produced them (see skills-src/README.md).'
);
console.log(`skills trees fresh: ${trees.join(', ')}`);

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
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry, repo } from './agent-skills-registry.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));

/** @param {string} message @returns {never} */
function fail(message) {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
}

/**
 * ## Deriving the hook trees from the builds themselves
 *
 * The hook-bundle trees this gate measures used to be a hand-maintained
 * array beside a comment asking the next author to keep it in sync with the
 * `build:*` scripts — the exact enumeration-drift class the skills suite
 * already avoids by deriving its trees from the registry. A renamed `-o`
 * destination or a new platform's build script would have dropped out of
 * measurement while the gate kept printing "hooks trees fresh".
 *
 * The list is now observed, not declared: the gate reads the hook build
 * scripts out of the agent-hooks package.json (resolving `yarn <alias>`
 * chains), replays each one into a scratch directory, and measures whatever
 * the build actually wrote — not just the `-o` flag, which understates the
 * write set for every agent that emits companion bundles beside its
 * manifest (claude's `bin/`, codex's flat `.mjs` files, antigravity's
 * sibling `bin/`). Each derived tree must then exist in the working tree
 * (so a renamed destination goes red instead of silently unmeasured), and
 * the set of built agents must equal the registry's platform set in both
 * directions (so a platform added without a hook build — or a build for a
 * platform the registry dropped — goes red instead of unnoticed).
 */
const hooksWorkspace = process.env.AGENT_HOOKS_WORKSPACE
  ? path.resolve(process.env.AGENT_HOOKS_WORKSPACE)
  : path.join(repo, 'packages/agent-hooks');

/**
 * Split a package.json script string into tokens, treating a quoted span as
 * one token with the quotes stripped (the build scripts quote their `-i`
 * brace globs and `-o` paths).
 * @param {string} text
 */
function tokenizeScript(text) {
  return (text.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((raw) => raw.replace(/^["']|["']$/g, ''));
}

/**
 * Follow `yarn <name>` aliases (build:claude → build:hooks) until the script
 * text is no longer a bare reference to another script.
 * @param {Record<string, string>} scriptMap @param {string} text
 */
function resolveScriptAlias(scriptMap, text) {
  let current = text.trim();
  const seen = new Set();
  for (;;) {
    const match = current.match(/^yarn\s+(\S+)$/);
    if (match === null || scriptMap[match[1]] === undefined || seen.has(match[1])) return current;
    seen.add(match[1]);
    current = scriptMap[match[1]].trim();
  }
}

/**
 * @param {string[]} args @param {string[]} flags
 * @returns {string | undefined}
 */
function argValue(args, flags) {
  for (let i = 0; i < args.length; i += 1) {
    for (const flag of flags) {
      if (args[i] === flag) return args[i + 1];
      if (args[i].startsWith(`${flag}=`)) return args[i].slice(flag.length + 1);
    }
  }
  return undefined;
}

/** @param {string[]} args @param {string[]} flags @param {string} replacement */
function swapArgValue(args, flags, replacement) {
  const out = [...args];
  for (let i = 0; i < out.length; i += 1) {
    if (flags.includes(out[i])) {
      out[i + 1] = replacement;
      return out;
    }
    for (const flag of flags) {
      if (out[i].startsWith(`${flag}=`)) {
        out[i] = `${flag}=${replacement}`;
        return out;
      }
    }
  }
  return out;
}

/**
 * The derivation source: every package.json script that resolves to a
 * `yarn agent-hooks --agent <agent> … -o <dest>` invocation, one per agent.
 * @returns {{ wrapper: string, builds: { name: string, agent: string, args: string[], output: string }[] }}
 */
function hookBuildCommands() {
  const pkgPath = path.join(hooksWorkspace, 'package.json');
  /** @type {{ scripts?: Record<string, string> }} */
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch (error) {
    fail(
      `cannot read the hooks derivation source ${pkgPath}: ${error instanceof Error ? error.message : String(error)}\n` +
        `The hooks freshness gate derives its measured trees from the agent-hooks build scripts.`
    );
  }
  const scriptMap = pkg.scripts ?? {};
  const wrapperTokens = tokenizeScript(scriptMap['agent-hooks'] ?? '');
  if (wrapperTokens[0] !== 'node' || wrapperTokens.length !== 2) {
    fail(
      `the "agent-hooks" script in ${pkgPath} is not a plain "node <script>" command — ` +
        `the hooks gate cannot replay the builds to derive its measured trees (unparseable build script).`
    );
  }
  const wrapper = path.resolve(hooksWorkspace, wrapperTokens[1]);
  /** @type {Map<string, { name: string, agent: string, args: string[], output: string }>} */
  const byAgent = new Map();
  for (const [name, text] of Object.entries(scriptMap)) {
    if (name === 'agent-hooks') continue;
    const resolved = resolveScriptAlias(scriptMap, text);
    const match = resolved.match(/^yarn\s+agent-hooks\s+(.*)$/s);
    if (match === null) continue;
    const args = tokenizeScript(match[1]);
    const agent = argValue(args, ['--agent']);
    const output = argValue(args, ['-o', '--output']);
    if (agent === undefined || output === undefined) {
      fail(
        `hook build script "${name}" in ${pkgPath} invokes agent-hooks but its --agent/-o could not be ` +
          `parsed (unparseable build script) — the gate cannot derive the tree it writes.`
      );
    }
    if (!byAgent.has(agent)) byAgent.set(agent, { name, agent, args, output });
  }
  return { wrapper, builds: [...byAgent.values()] };
}

/** Basenames committed under `dir` at HEAD (empty when HEAD has no such dir). @param {string} dir */
function committedEntries(dir) {
  const result = spawnSync('git', ['ls-tree', '--name-only', 'HEAD', `${dir}/`], { cwd: repo, encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((entry) => path.posix.basename(entry));
}

/**
 * Replay one hook build into a scratch directory and map its complete write
 * set back onto the committed tree: a directory `-o` measures that
 * directory; a manifest `-o` measures the manifest's parent directory when
 * the build accounts for every committed entry in it (claude/codex layouts),
 * and only the written entries when the parent also holds unrelated content
 * (antigravity's plugin root).
 * @param {string} wrapper @param {{ name: string, agent: string, args: string[], output: string }} build
 * @returns {string[]} repo-relative tree paths this build's output occupies
 */
function treesWrittenBy(wrapper, build) {
  const realOut = path.resolve(hooksWorkspace, build.output);
  const relOut = path.relative(repo, realOut).split(path.sep).join('/');
  if (relOut.startsWith('..')) {
    fail(`hook build script "${build.name}" writes outside the repository (${realOut}) — nothing to measure.`);
  }
  const scratch = mkdtempSync(path.join(tmpdir(), `hooks-tree-${build.agent}-`));
  try {
    const scratchOut = path.join(scratch, path.basename(build.output));
    const result = spawnSync(process.execPath, [wrapper, ...swapArgValue(build.args, ['-o', '--output'], scratchOut)], {
      cwd: hooksWorkspace,
      encoding: 'utf8'
    });
    if (result.status !== 0) {
      fail(
        `scratch replay of hook build script "${build.name}" (agent ${build.agent}) failed — the gate derives its ` +
          `measured trees from what the builds write, so a failing build leaves them underivable:\n` +
          `${result.stdout}${result.stderr}`
      );
    }
    const written = readdirSync(scratch);
    if (written.length === 0) {
      fail(
        `scratch replay of hook build script "${build.name}" (agent ${build.agent}) wrote nothing — ` +
          `the gate cannot derive a measured tree from a build with no observable output.`
      );
    }
    if (existsSync(scratchOut) && statSync(scratchOut).isDirectory()) {
      const parent = path.posix.dirname(relOut);
      return [relOut, ...written.filter((entry) => entry !== path.basename(build.output)).map((e) => `${parent}/${e}`)];
    }
    const parent = path.posix.dirname(relOut);
    const writtenSet = new Set(written);
    const committed = committedEntries(parent);
    if (committed.length > 0 && committed.every((entry) => writtenSet.has(entry))) return [parent];
    return written.map((entry) => `${parent}/${entry}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Derive the measured hook trees from the builds, reconciling both directions. */
function deriveHooksTrees() {
  const { wrapper, builds } = hookBuildCommands();
  if (builds.length === 0) {
    fail(
      `no hook build scripts found in ${path.join(hooksWorkspace, 'package.json')} — the hooks freshness gate ` +
        `derives its measured trees from them and refuses to certify anything from an empty derivation.`
    );
  }

  // Both directions of the platform reconciliation: a registry platform with
  // no hook build is unmeasured; a hook build for a platform the registry
  // does not declare ships to no target.
  const buildAgents = new Set(builds.map((build) => build.agent));
  const registryPlatforms = new Set(
    loadRegistry().plugins.flatMap((plugin) => plugin.targets.map((target) => target.platform))
  );
  const problems = [];
  for (const platform of registryPlatforms) {
    if (!buildAgents.has(platform)) {
      problems.push(
        `the registry declares platform "${platform}" but packages/agent-hooks has no hook build script for it — ` +
          `that platform's hook output would be unmeasured by this gate. Add a build:* script for it (or remove ` +
          `the platform from the registry).`
      );
    }
  }
  for (const agent of buildAgents) {
    if (!registryPlatforms.has(agent)) {
      problems.push(
        `packages/agent-hooks builds hooks for agent "${agent}" but no registry target declares that platform — ` +
          `remove the build script or declare the platform in the registry.`
      );
    }
  }
  if (problems.length > 0) fail(problems.join('\n'));

  const trees = [...new Set(builds.flatMap((build) => treesWrittenBy(wrapper, build)))].sort();
  const missing = trees.filter((tree) => !existsSync(path.join(repo, tree)));
  if (missing.length > 0) {
    fail(
      `the hook builds write trees that do not exist in the working tree:\n` +
        missing.map((tree) => `  ${tree}`).join('\n') +
        `\nThe build destinations and the committed trees have diverged (a renamed -o path is the usual cause) — ` +
        `run 'yarn workspace agent-hooks build' and commit the result before this gate can certify anything.`
    );
  }
  return trees;
}

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
  const hooksTrees = deriveHooksTrees();
  requireClean(hooksTrees, 'Commit the rebuilt plugin bundles together with the source change that reworked them.');
  console.log(`hooks trees fresh: ${hooksTrees.join(', ')}`);
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

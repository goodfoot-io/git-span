#!/usr/bin/env node
/**
 * Renders every registry plugin's authored templates into its per-platform
 * skill trees, then verifies the render actually happened.
 *
 * The verification is not paranoia: the CLI's direct-invocation guard can
 * silently decline to run (see cliPath() in agent-skills-registry.mjs), and a
 * driver that trusts exit 0 then reports "wrote every tree" and "wrote
 * nothing" identically — validate.sh's freshness diff would compare the
 * committed tree against itself. So the driver requires positive per-target,
 * per-skill evidence from the CLI's stdout before believing anything built.
 *
 * Exit codes are part of the driver's interface — the freshness gate
 * (check-generated-tree-freshness.mjs) branches its advice on them:
 *   0  every target verifiably rendered, no uncommitted bytes harmed
 *   1  a guard refused, the CLI failed, or the publish left residue
 *   2  the publish would have destroyed uncommitted hand-edits (restored)
 *   3  the CLI exited 0 without verifiable evidence it rendered every tree
 *
 * Usage: node scripts/build-agent-skills.mjs [--check-targets]
 * @module
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertNoUntrackedInTargets,
  assertSafeTargets,
  assertSkillsMatchDisk,
  assertTargetsRenderFiles,
  cliArgs,
  expectedSkillsFor,
  loadRegistry,
  repo,
  templateFor
} from './agent-skills-registry.mjs';

const registry = loadRegistry();

// All four guards run before anything is built. Publishing renames the whole
// target directory away, so a target pointed one level too high does not
// corrupt the plugin's hand-maintained siblings -- it deletes them, atomically,
// on a build that exits 0. A check that notices afterwards is too late.
// A guard refusal is a named diagnostic for the author, not an internal
// error, so it prints as one — a stack trace here points at the guard
// instead of at the registry or worktree state the guard is describing.
try {
  assertSafeTargets(registry);
  assertTargetsRenderFiles(registry);
  assertSkillsMatchDisk(registry);
  assertNoUntrackedInTargets(registry);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1); // refusal: registry-guard-refused
}

// Lets CI ask "would this registry be safe to publish?" without publishing.
// The alternative -- a test asserting its own copy of the rules above -- is
// exactly the arrangement that lets the guard drift from what the build
// actually does.
if (process.argv.includes('--check-targets')) process.exit(0);

/** @typedef {import('./agent-skills-registry.mjs').SkillsPlugin} SkillsPlugin */
/** @typedef {import('./agent-skills-registry.mjs').SkillsTarget} SkillsTarget */

/** Every file under a directory, as repo-relative posix paths. */
/** @param {string} dir @returns {string[]} */
function walkFiles(dir) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(path.join(repo, dir), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...walkFiles(relative));
    else files.push(relative);
  }
  return files.sort();
}

/**
 * Stamp one rendered file with the template it was generated from, so a
 * reader about to hand-edit it is told where the edit actually belongs. The
 * placement is host-tolerated: after the frontmatter for SKILL.md files,
 * after the shebang for scripts, at the top otherwise. Injection is
 * deterministic, so rebuilt trees stay byte-identical to committed ones.
 * @param {SkillsPlugin} plugin
 * @param {SkillsTarget} target
 * @param {string} file repo-relative path of the rendered file
 */
function injectMarker(plugin, target, file) {
  const relativeToTarget = file.slice(target.path.length + 1);
  const marker = `Generated from ${templateFor(plugin, relativeToTarget)} by scripts/build-agent-skills.mjs — do not edit; change the template and rebuild.`;
  const absolute = path.join(repo, file);
  const content = readFileSync(absolute, 'utf8');
  if (file.endsWith('.md')) {
    const comment = `<!-- ${marker} -->\n`;
    if (content.startsWith('---\n')) {
      const close = content.indexOf('\n---\n', 3);
      if (close !== -1) {
        const cut = close + '\n---\n'.length;
        writeFileSync(absolute, `${content.slice(0, cut)}${comment}${content.slice(cut)}`);
        return;
      }
    }
    writeFileSync(absolute, `${comment}\n${content}`);
    return;
  }
  if (file.endsWith('.mjs')) {
    const comment = `// ${marker}\n`;
    if (content.startsWith('#!')) {
      const eol = content.indexOf('\n') + 1;
      writeFileSync(absolute, `${content.slice(0, eol)}${comment}${content.slice(eol)}`);
      return;
    }
    writeFileSync(absolute, `${comment}${content}`);
    return;
  }
  // refusal: no-marker-syntax
  throw new Error(
    `${plugin.name}: no generated-from marker syntax is defined for ${file} — ` +
      `teach injectMarker() this file type before shipping it in a rendered tree.`
  );
}

/**
 * The tracked files inside a plugin's targets that differ from HEAD before
 * the build runs, with their exact worktree bytes. Publishing replaces the
 * whole tree; whatever these files held is what a publish could destroy.
 * @param {SkillsPlugin} plugin
 * @returns {Map<string, Buffer>}
 */
function snapshotModifiedTracked(plugin) {
  /** @type {Map<string, Buffer>} */
  const snapshot = new Map();
  for (const target of plugin.targets) {
    const result = spawnSync('git', ['diff', '--name-only', 'HEAD', '--', target.path], {
      cwd: repo,
      encoding: 'utf8'
    });
    if (result.status !== 0) {
      // refusal: git-diff-failed
      throw new Error(`git diff --name-only HEAD -- ${target.path} failed:\n${result.stderr}`);
    }
    for (const file of result.stdout.split('\n').filter(Boolean)) {
      const absolute = path.join(repo, file);
      // A file deleted from the worktree holds nothing a publish can destroy;
      // regenerating deleted output is the expected recovery, not a loss.
      if (existsSync(absolute)) snapshot.set(file, readFileSync(absolute));
    }
  }
  return snapshot;
}

/**
 * Restore every snapshotted file whose bytes the publish changed, and return
 * the list of restorations. An empty return means the publish reproduced the
 * worktree exactly -- the modified files were prior build output, not edits.
 * @param {SkillsPlugin} plugin
 * @param {Map<string, Buffer>} snapshot
 */
function restoreDestroyedEdits(plugin, snapshot) {
  /** @type {string[]} */
  const destroyed = [];
  for (const [file, bytes] of snapshot) {
    const absolute = path.join(repo, file);
    if (existsSync(absolute) && Buffer.compare(readFileSync(absolute), bytes) === 0) continue;
    writeFileSync(absolute, bytes);
    let template = plugin.skillsSrc;
    const target = plugin.targets.find((candidate) => file.startsWith(`${candidate.path}/`));
    if (target) {
      try {
        template = templateFor(plugin, file.slice(target.path.length + 1));
      } catch {
        // A restored file with no surviving template still gets restored and
        // named; the generic skills-src pointer is the best provenance left.
      }
    }
    destroyed.push(`  ${file} (generated from ${template})`);
  }
  return destroyed;
}

for (const plugin of registry.plugins) {
  const snapshot = snapshotModifiedTracked(plugin);

  // The CLI writes "Warning: publication succeeded; cleanup residue ..." to
  // stderr and exits 0, so a driver reading only the exit code treats leaked
  // backup, stage, and lock paths as success. A leaked lock is the sharp one:
  // the next build fails with "Target lock contention" pointing nowhere near
  // the run that leaked it.
  const result = spawnSync(process.execPath, cliArgs(plugin, 'build'), {
    cwd: repo,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    encoding: 'utf8'
  });

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  if (result.error) throw result.error;

  /** @type {string[]} */
  const failures = [];
  /**
   * Verification failures get their own bucket (and exit code 3) because they
   * mean something categorically different from a failed build: the CLI
   * claimed success while producing no evidence it rendered every tree. The
   * freshness gate must never read that state as "stale trees — commit".
   * @type {string[]}
   */
  const unverified = [];

  if (result.status !== 0) {
    failures.push(`agent-skills build failed for ${plugin.name} (exit ${result.status}).`);
  } else if (stderr.split('\n').some((line) => line.includes('cleanup residue'))) {
    failures.push(`Refusing to report success for ${plugin.name}: publication left residue behind.`);
  } else {
    // Positive evidence the CLI actually ran and wrote every declared tree:
    // one "platform=outDir: files" stdout line per target, listing every
    // declared skill. Exit 0 with silence is exactly what the CLI produces
    // when its entrypoint guard silently declines to run, and what a partial
    // render produces for the targets it skipped.
    /** @type {Map<string, string[]>} */
    const written = new Map();
    for (const line of stdout.split('\n')) {
      const match = /^([^=]+)=([^:]+): (.+)$/.exec(line);
      if (match !== null) written.set(`${match[1]}=${match[2]}`, match[3].split(', '));
    }
    for (const target of plugin.targets) {
      const files = written.get(`${target.platform}=${target.path}`);
      if (files === undefined) {
        unverified.push(
          `${plugin.name}: the CLI reported nothing written for --target ${target.platform}=${target.path} — ` +
            `the build cannot be verified as having run for that tree.`
        );
        continue;
      }
      for (const skill of expectedSkillsFor(plugin, target.platform)) {
        if (!files.some((file) => file.startsWith(`${skill}/`))) {
          unverified.push(
            `${plugin.name}: the CLI's output for ${target.platform}=${target.path} lists no files for ` +
              `skill "${skill}" — the declared skill did not render into that tree.`
          );
        }
      }
    }

    if (failures.length === 0 && unverified.length === 0) {
      try {
        for (const target of plugin.targets) {
          const files = walkFiles(target.path);
          if (files.length === 0) {
            // The pre-build guard reasons from the registry's declarations;
            // this reads what was actually written. Git cannot commit an
            // empty directory, so an empty tree would exist only here.
            failures.push(`${plugin.name}: ${target.path} is empty after publishing.`);
            continue;
          }
          for (const file of files) injectMarker(plugin, target, file);
        }
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  // Runs on every path, success or failure: whatever the CLI did to the
  // worktree, uncommitted bytes it changed are put back before this process
  // reports anything.
  const destroyed = restoreDestroyedEdits(plugin, snapshot);
  if (destroyed.length > 0) {
    process.stderr.write(
      `\n${plugin.name}: this publish would have destroyed uncommitted changes in the rendered trees:\n` +
        `${destroyed.join('\n')}\n` +
        `These trees are GENERATED from skills-src/ — the changed bytes have been restored, not published.\n` +
        `Port hand-edits into the named template and rebuild; if the worktree changes were themselves\n` +
        `stale build output, discard them (git checkout -- <tree>) and rebuild.\n`
    );
    process.exit(2); // refusal: would-destroy-hand-edit
  }
  if (failures.length > 0) {
    process.stderr.write(`\n${failures.join('\n')}${unverified.length > 0 ? `\n${unverified.join('\n')}` : ''}\n`);
    process.exit(1); // refusal: verification-failures
  }
  if (unverified.length > 0) {
    process.stderr.write(`\n${unverified.join('\n')}\n`);
    process.exit(3); // refusal: no-verifiable-render
  }
}

/**
 * The one place the build driver, the lint driver, and CI turn registry
 * declarations into `@goodfoot/agent-skills` CLI invocations.
 *
 * Kept shared rather than copied because the drivers must agree about what a
 * plugin's flags are: a lint run that derives `--root` or `--platform-dir`
 * differently from the build run reports diagnostics about output nobody
 * ships, and misses the output everybody does.
 * @module
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Overridable via AGENT_SKILLS_REPO so the driver test suite can run the real
 * build and lint drivers end-to-end against a temporary fixture repository
 * (its own git history, skills-src, and node_modules symlink) instead of
 * mutating this one.
 */
export const repo = process.env.AGENT_SKILLS_REPO ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @typedef {object} SkillsTarget
 * @property {string} platform
 * @property {string} path
 *
 * @typedef {object} SkillsPlugin
 * @property {string} name
 * @property {string} skillsSrc
 * @property {string[]} skills
 * @property {string} claudePluginRoot
 * @property {string} codexPluginRoot
 * @property {string} opencodePluginRoot
 * @property {string} [antigravityPluginRoot]
 * @property {Record<string, string[]>} [skillPlatforms]
 * @property {SkillsTarget[]} targets
 * @property {string[]} platformDirs
 * @property {{ diagnostics: string[], reason: string }} [lintBaseline]
 *
 * @typedef {{ plugins: SkillsPlugin[] }} SkillsRegistry
 */

const DEFAULT_REGISTRY = path.join(repo, 'scripts/agent-skills-plugins.json');

/**
 * Overridable via AGENT_SKILLS_REGISTRY so a test can run a driver end-to-end
 * against a deliberately unsafe registry and observe the refusal, rather than
 * trusting a unit check on a copy of the rule.
 * @returns {SkillsRegistry}
 */
export function loadRegistry() {
  return JSON.parse(readFileSync(process.env.AGENT_SKILLS_REGISTRY ?? DEFAULT_REGISTRY, 'utf8'));
}

/**
 * Every path a plugin is permitted to publish into. git-span declares no
 * shared AGENTS.md-convention skills root (`.agents/skills` stays pointed at
 * `/workspace/.claude/skills`, untouched by the skills build), so only the
 * per-platform plugin skill leaves are allowed.
 * @param {SkillsPlugin} plugin
 */
function allowedTargets(plugin) {
  const targets = [
    `${plugin.claudePluginRoot}/skills`,
    `${plugin.codexPluginRoot}/skills`,
    `${plugin.opencodePluginRoot}/skills`
  ];
  if (plugin.antigravityPluginRoot) {
    targets.push(`${plugin.antigravityPluginRoot}/skills`);
  }
  return new Set(targets);
}

/**
 * An allow-list, not a list of known-bad shapes. Publishing renames the whole
 * target directory away, so a target pointed one level too high does not merely
 * write to the wrong place -- it deletes the plugin's hand-maintained siblings
 * (`.claude-plugin/`, `agents/`, `hooks/`, `dist/`, `package.json`) on a build
 * that exits 0. git-span's plugin roots all carry a hand-maintained `agents/`
 * directory beside `skills/`, so this hazard is live, not hypothetical.
 * `skills-src/git-span` is neither a plugin root nor a stray path under
 * `plugins-*`, and naming it would delete the authored templates the build
 * reads from.
 * @param {SkillsRegistry} registry
 */
export function assertSafeTargets(registry) {
  for (const plugin of registry.plugins) {
    if (plugin.targets.some((target) => target.platform === 'antigravity') && !plugin.antigravityPluginRoot) {
      throw new Error(`${plugin.name}: an Antigravity target requires antigravityPluginRoot`);
    }
    const allowed = allowedTargets(plugin);
    for (const target of plugin.targets) {
      if (!allowed.has(target.path)) {
        throw new Error(
          `${plugin.name}: --target ${target.platform}=${target.path} is not a declared skills tree. ` +
            `Publishing renames the whole directory away, so only ${[...allowed].join(', ')} may be published into.`
        );
      }
    }
  }
}

const ALL_PLATFORMS = ['claude-code', 'codex', 'opencode', 'antigravity'];

/**
 * The platforms a plugin's skills actually render to, after front-config gating.
 * @param {SkillsPlugin} plugin
 */
function renderedPlatforms(plugin) {
  return new Set((plugin.skills ?? []).flatMap((skill) => plugin.skillPlatforms?.[skill] ?? ALL_PLATFORMS));
}

/**
 * A target no skill renders into publishes an empty directory, and git cannot
 * store one. The tree then exists only on machines that have run a build:
 * `git status` stays clean, tests pass locally, and a fresh checkout fails on
 * trees that were never in the commit.
 *
 * Declared here rather than discovered after publishing, so the empty tree is
 * never created in the first place.
 * @param {SkillsRegistry} registry
 */
export function assertTargetsRenderFiles(registry) {
  for (const plugin of registry.plugins) {
    const rendered = renderedPlatforms(plugin);
    for (const target of plugin.targets) {
      if (!rendered.has(target.platform)) {
        throw new Error(
          `${plugin.name}: --target ${target.platform}=${target.path} would publish an empty directory. ` +
            `No skill renders to ${target.platform}, and git cannot commit an empty tree. ` +
            `Remove the target, or ship a skill that renders there.`
        );
      }
    }
  }
}

/**
 * The skills a plugin's declaration says should render into one platform's
 * tree, after front-config gating.
 * @param {SkillsPlugin} plugin
 * @param {string} platform
 */
export function expectedSkillsFor(plugin, platform) {
  return (plugin.skills ?? []).filter((skill) => (plugin.skillPlatforms?.[skill] ?? ALL_PLATFORMS).includes(platform));
}

/**
 * The registry's `skills` array must equal the set of skill directories on
 * disk, in both directions. The CLI renders by glob, so the array does not
 * drive rendering — but every downstream guard (target verification, the
 * release workflow's ship-completeness checks) reasons from it. A directory
 * the array does not name would be rendered but never verified; a name the
 * disk does not carry would be verified against nothing. Worse, a skill
 * directory whose entrypoint is a plain `SKILL.md` instead of `SKILL.md.eta`
 * is silently dropped from every rendered tree at exit 0, so the entrypoint's
 * existence is asserted here, before anything builds.
 * @param {SkillsRegistry} registry
 */
export function assertSkillsMatchDisk(registry) {
  for (const plugin of registry.plugins) {
    const srcRoot = path.resolve(repo, plugin.skillsSrc);
    const onDisk = readdirSync(srcRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const declared = [...(plugin.skills ?? [])].sort();
    for (const name of onDisk.filter((name) => !declared.includes(name))) {
      const entry = `${plugin.skillsSrc}/${name}/SKILL.md.eta`;
      throw new Error(
        `${plugin.name}: ${plugin.skillsSrc}/${name} exists on disk but is not declared in the registry's ` +
          `skills array${existsSync(path.join(srcRoot, name, 'SKILL.md.eta')) ? '' : `, and lacks ${entry} — without that entrypoint the CLI silently drops the whole skill from every rendered tree`}. ` +
          `Declare it in scripts/agent-skills-plugins.json (and give it a SKILL.md.eta) or remove the directory.`
      );
    }
    for (const name of declared.filter((name) => !onDisk.includes(name))) {
      throw new Error(
        `${plugin.name}: the registry declares skill "${name}" but ${plugin.skillsSrc}/${name} does not exist. ` +
          `Remove the declaration or restore the directory.`
      );
    }
    for (const name of declared) {
      if (!existsSync(path.join(srcRoot, name, 'SKILL.md.eta'))) {
        throw new Error(
          `${plugin.name}: ${plugin.skillsSrc}/${name} lacks SKILL.md.eta — a plain SKILL.md is silently ` +
            `dropped from every rendered tree. Author the entrypoint as SKILL.md.eta.`
        );
      }
    }
  }
}

/**
 * The authored template a rendered file came from: the `.eta` twin when one
 * exists, the verbatim-copied source otherwise. Throws on a rendered file with
 * no template -- output of unknown provenance means the driver's mapping no
 * longer matches how the CLI names its output, and any marker naming a
 * template would lie.
 * @param {SkillsPlugin} plugin
 * @param {string} relativeToTarget
 */
export function templateFor(plugin, relativeToTarget) {
  for (const candidate of [`${relativeToTarget}.eta`, relativeToTarget]) {
    const templatePath = `${plugin.skillsSrc}/${candidate}`;
    if (existsSync(path.join(repo, templatePath))) return templatePath;
  }
  throw new Error(
    `${plugin.name}: rendered file ${relativeToTarget} has no template under ${plugin.skillsSrc} — ` +
      `the driver's template mapping no longer matches the CLI's output naming.`
  );
}

/**
 * The rename that publishes a target takes the directory's whole prior
 * contents with it, tracked or not. Tracked losses come back from the index;
 * untracked ones are gone.
 *
 * The refusal message diagnoses each file before advising, because every
 * remediation branch it offers must reach a correct state: a file that maps
 * to a template is render output a previous build wrote and the committed
 * tree lacks — committing it is the only correct move (deleting it just
 * regenerates the same red state, invisibly to any diff-based check). A file
 * no template maps to is not render output at all, and publishing would
 * destroy it irrecoverably — it must move out. "Commit or move" as a single
 * undiagnosed offer gave each case the other's wrong branch.
 * @param {SkillsRegistry} registry
 */
export function assertNoUntrackedInTargets(registry) {
  for (const plugin of registry.plugins) {
    for (const target of plugin.targets) {
      /** @param {string[]} args */
      const gitLsFiles = (args) =>
        execFileSync('git', ['ls-files', ...args, '--', target.path], {
          cwd: repo,
          encoding: 'utf8'
        })
          .split('\n')
          .filter(Boolean);
      const untracked = [
        ...new Set([
          ...gitLsFiles(['--others', '--exclude-standard']),
          ...gitLsFiles(['--others', '--ignored', '--exclude-standard'])
        ])
      ].sort();
      if (untracked.length === 0) continue;
      const lines = untracked.map((file) => {
        try {
          const template = templateFor(plugin, file.slice(target.path.length + 1));
          return `  ${file} — new render output (from ${template}); commit it, then build again`;
        } catch {
          return `  ${file} — NOT render output (no template maps to it); publishing would destroy it irrecoverably — move it out of the generated tree`;
        }
      });
      throw new Error(
        `${plugin.name}: ${target.path} holds untracked files a publish would sweep away:\n${lines.join('\n')}\n` +
          `These trees are generated — see skills-src/README.md.`
      );
    }
  }
}

/**
 * The absolute, symlink-resolved path to the agent-skills CLI entrypoint.
 *
 * realpathSync is load-bearing, not cosmetic: the CLI's direct-invocation
 * guard compares `import.meta.url` (which Node resolves to the realpath for a
 * main module) against `process.argv[1]` verbatim. Spawned through a
 * symlinked `node_modules/@goodfoot` — the documented worktree provisioning
 * shape (scripts/ensure-worktree-local-generated.mjs) — the two disagree, the
 * guard never fires, and the process exits 0 having done nothing.
 * AGENT_SKILLS_CLI lets the driver test suite substitute a deliberately
 * silent stub and observe the drivers refuse it.
 */
export function cliPath() {
  return realpathSync(
    process.env.AGENT_SKILLS_CLI ?? path.join(repo, 'node_modules/@goodfoot/agent-skills/dist/cli.js')
  );
}

/**
 * The agent-skills CLI argv for one plugin, identical between build and lint.
 * @param {SkillsPlugin} plugin
 * @param {'build' | 'lint'} command
 */
export function cliArgs(plugin, command) {
  return [
    cliPath(),
    command,
    '--root',
    plugin.skillsSrc,
    ...plugin.targets.flatMap((target) => ['--target', `${target.platform}=${target.path}`]),
    ...plugin.platformDirs.flatMap((flag) => ['--platform-dir', flag]),
    '**/*'
  ];
}

/**
 * Diagnostics reduced to the sites they name: `<file>:<line>:<rule>`, deduped
 * because the same template site is reported once per target it renders into.
 * Comparing sites rather than raw lines keeps the registry's declared baseline
 * something a reviewer can read.
 * @param {string} stderr
 */
export function diagnosticSites(stderr) {
  const sites = stderr.split('\n').flatMap((line) => {
    const match = /^(.+?):(\d+):\d+ \[([^\]]+)\]/.exec(line);
    return match === null ? [] : [`${match[1]}:${match[2]}:${match[3]}`];
  });
  return [...new Set(sites)].sort();
}

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
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_REGISTRY = path.join(repo, 'scripts/agent-skills-plugins.json');

/**
 * Overridable via AGENT_SKILLS_REGISTRY so a test can run a driver end-to-end
 * against a deliberately unsafe registry and observe the refusal, rather than
 * trusting a unit check on a copy of the rule.
 */
export function loadRegistry() {
  return JSON.parse(readFileSync(process.env.AGENT_SKILLS_REGISTRY ?? DEFAULT_REGISTRY, 'utf8'));
}

/**
 * Every path a plugin is permitted to publish into. git-span declares no
 * shared AGENTS.md-convention skills root (`.agents/skills` stays pointed at
 * `/workspace/.claude/skills`, untouched by the skills build), so only the
 * per-platform plugin skill leaves are allowed.
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

/** The platforms a plugin's skills actually render to, after front-config gating. */
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
 * The rename that publishes a target takes the directory's whole prior
 * contents with it, tracked or not. Tracked losses come back from the index;
 * untracked ones are gone. Nothing downstream can restore them, so the refusal
 * has to come before the CLI runs.
 */
export function assertNoUntrackedInTargets(registry) {
  for (const plugin of registry.plugins) {
    for (const target of plugin.targets) {
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
      if (untracked.length > 0) {
        throw new Error(
          `${plugin.name}: ${target.path} holds untracked files that publishing would destroy irrecoverably:\n` +
            `${untracked.map((file) => `  ${file}`).join('\n')}\n` +
            `Commit or move them, then build again.`
        );
      }
    }
  }
}

/** The agent-skills CLI argv for one plugin, identical between build and lint. */
export function cliArgs(plugin, command) {
  return [
    'node_modules/@goodfoot/agent-skills/dist/cli.js',
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
 */
export function diagnosticSites(stderr) {
  const sites = stderr
    .split('\n')
    .map((line) => /^(.+?):(\d+):\d+ \[([^\]]+)\]/.exec(line))
    .filter((match) => match !== null)
    .map((match) => `${match[1]}:${match[2]}:${match[3]}`);
  return [...new Set(sites)].sort();
}

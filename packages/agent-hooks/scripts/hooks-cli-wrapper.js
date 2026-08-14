#!/usr/bin/env node
/**
 * Wraps the `@goodfoot/claude-code-hooks`/`@goodfoot/codex-hooks` CLIs so
 * every invocation -- whether reached via `yarn build:hooks`/`yarn
 * build:hooks:codex` or directly via `yarn claude-code-hooks`/`yarn
 * codex-hooks` (as the reproduction test in
 * test/common/hook-build-portability.test.ts does) -- gets its generated
 * `.mjs` output normalized afterward by
 * `scripts/normalize-hook-module-comments.js`.
 *
 * This package's package.json defines "claude-code-hooks" and "codex-hooks"
 * scripts that point here. Because Yarn resolves a bare `yarn <name>`
 * invocation against package.json scripts *before* falling back to a
 * same-named binary contributed by a dependency, `yarn claude-code-hooks
 * ...`/`yarn codex-hooks ...` run this wrapper instead of the raw CLI --
 * so the fix applies uniformly no matter which of those spellings invokes
 * the build.
 *
 * The wrapper forwards all CLI args unchanged to the real, installed CLI
 * (resolved by realpath through node_modules -- symlinked or not -- so the
 * actual compiled output is byte-for-byte what the CLI itself produces),
 * then post-processes only the `//` module-boundary comments in the
 * directory the `-o`/`--output` argument points at.
 *
 * Usage: node scripts/hooks-cli-wrapper.js <package-name> [...cli-args]
 *   package-name: "@goodfoot/claude-code-hooks" or "@goodfoot/codex-hooks"
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeModuleComments } from './normalize-hook-module-comments.js';

function findOutputPath(cliArgs) {
  for (let i = 0; i < cliArgs.length; i += 1) {
    const arg = cliArgs[i];
    if (arg === '-o' || arg === '--output') {
      return cliArgs[i + 1];
    }
    if (arg.startsWith('--output=')) {
      return arg.slice('--output='.length);
    }
    if (arg.startsWith('-o=')) {
      return arg.slice('-o='.length);
    }
  }
  return undefined;
}

function findInputPath(cliArgs) {
  for (let i = 0; i < cliArgs.length; i += 1) {
    const arg = cliArgs[i];
    if (arg === '-i' || arg === '--input') {
      return cliArgs[i + 1];
    }
    if (arg.startsWith('--input=')) {
      return arg.slice('--input='.length);
    }
    if (arg.startsWith('-i=')) {
      return arg.slice('-i='.length);
    }
  }
  return undefined;
}

function declaredBundleOrder(inputArg) {
  if (inputArg === undefined) return [];
  const brace = inputArg.match(/\{([^{}]+)\}/);
  const paths =
    brace === null
      ? [inputArg]
      : brace[1]
          .split(',')
          .map((part) => `${inputArg.slice(0, brace.index)}${part}${inputArg.slice(brace.index + brace[0].length)}`);
  return paths.map((path) => basename(path).replace(/\.[^.]+$/, ''));
}

function commandBundle(command) {
  return command.match(/([A-Za-z0-9-]+)\.mjs\b/)?.[1];
}

function canonicalizeHookManifest(outputPath, inputArg) {
  const manifest = JSON.parse(readFileSync(outputPath, 'utf8'));
  const declared = declaredBundleOrder(inputArg);
  const rankByBundle = new Map(declared.map((bundle, index) => [bundle, index]));
  const rankOfCommand = (command) => rankByBundle.get(commandBundle(command)) ?? Number.MAX_SAFE_INTEGER;
  const rankOfGroup = (group) => Math.min(...(group.hooks ?? []).map((hook) => rankOfCommand(hook.command)));
  const compareGroups = (left, right) => {
    const rank = rankOfGroup(left) - rankOfGroup(right);
    if (rank !== 0) return rank;
    return JSON.stringify(left).localeCompare(JSON.stringify(right));
  };

  const hookEntries = Object.entries(manifest.hooks ?? {});
  for (const [, groups] of hookEntries) {
    for (const group of groups) {
      group.hooks?.sort((left, right) => {
        const rank = rankOfCommand(left.command) - rankOfCommand(right.command);
        return rank !== 0 ? rank : left.command.localeCompare(right.command);
      });
    }
    groups.sort(compareGroups);
  }
  hookEntries.sort(([leftEvent, leftGroups], [rightEvent, rightGroups]) => {
    const leftRank = Math.min(...leftGroups.map(rankOfGroup));
    const rightRank = Math.min(...rightGroups.map(rankOfGroup));
    return leftRank !== rightRank ? leftRank - rightRank : leftEvent.localeCompare(rightEvent);
  });
  manifest.hooks = Object.fromEntries(hookEntries);

  if (Array.isArray(manifest.__generated?.files)) {
    manifest.__generated.files.sort((left, right) => {
      const leftRank = rankByBundle.get(left.replace(/\.mjs$/, '')) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = rankByBundle.get(right.replace(/\.mjs$/, '')) ?? Number.MAX_SAFE_INTEGER;
      return leftRank !== rightRank ? leftRank - rightRank : left.localeCompare(right);
    });
  }
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function main() {
  const [packageName, ...cliArgs] = process.argv.slice(2);
  if (!packageName) {
    process.stderr.write('Usage: hooks-cli-wrapper.js <package-name> [...cli-args]\n');
    process.exit(1);
  }

  const cliEntryUrl = import.meta.resolve(`${packageName}/cli`);
  const cliEntryPath = fileURLToPath(cliEntryUrl);

  const result = spawnSync(process.execPath, [cliEntryPath, ...cliArgs], {
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  const outputArg = findOutputPath(cliArgs);
  if (outputArg === undefined) {
    // Nothing was compiled to a hooks.json (e.g. --scaffold, --help); no
    // generated .mjs output to normalize.
    return;
  }
  const outputDir = dirname(resolve(process.cwd(), outputArg));
  normalizeModuleComments([outputDir]);
  canonicalizeHookManifest(resolve(process.cwd(), outputArg), findInputPath(cliArgs));
}

main().catch((error) => {
  process.stderr.write(`hooks-cli-wrapper: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

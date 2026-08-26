#!/usr/bin/env node
/**
 * Wraps the `@goodfoot/agent-hooks` CLI so every invocation preserves the
 * repository's deterministic manifest order and Claude timeout contract.
 *
 * It also converts each manifest's hook registration `timeout` from
 * milliseconds to seconds -- but only for the Claude CLI, which emits the
 * source value verbatim even though Claude Code reads the field as seconds
 * ("Seconds before canceling"). The Codex CLI performs the same division
 * itself (`timeoutMsToSeconds`) before writing its manifest, so its output
 * must pass through untouched; re-dividing it would shrink every ceiling a
 * thousandfold. Source authoring stays milliseconds across both adapters,
 * matching the codex pipeline.
 *
 * The wrapper forwards all CLI args unchanged to the real, installed CLI
 * and then canonicalizes the emitted manifest.
 *
 * Usage: node scripts/hooks-cli-wrapper.js --agent claude-code|codex [...cli-args]
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// Mirrors the codex-hooks CLI's own emit-time conversion exactly, including
// the 1-second floor: a sub-second ms budget would otherwise round down to a
// zero-second (never-cancelling) registration.
function timeoutMsToSeconds(timeoutMs) {
  return Math.max(1, Math.ceil(timeoutMs / 1000));
}

function convertHookTimeoutsToSeconds(outputPath) {
  const manifest = JSON.parse(readFileSync(outputPath, 'utf8'));
  for (const groups of Object.values(manifest.hooks ?? {})) {
    for (const group of groups ?? []) {
      for (const hook of group.hooks ?? []) {
        if (typeof hook.timeout === 'number') {
          hook.timeout = timeoutMsToSeconds(hook.timeout);
        }
      }
    }
  }
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function main() {
  const cliArgs = process.argv.slice(2);
  const agentIndex = cliArgs.indexOf('--agent');
  const agent =
    agentIndex === -1
      ? cliArgs.find((arg) => arg.startsWith('--agent='))?.slice('--agent='.length)
      : cliArgs[agentIndex + 1];
  if (agent !== 'claude-code' && agent !== 'codex') {
    process.stderr.write('Usage: hooks-cli-wrapper.js --agent claude-code|codex [...cli-args]\n');
    process.exit(1);
  }

  const packageEntryPath = fileURLToPath(import.meta.resolve('@goodfoot/agent-hooks'));
  const cliEntryPath = resolve(dirname(packageEntryPath), 'cli.js');

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
    // Nothing was compiled to a hooks.json (e.g. --scaffold, --help).
    return;
  }
  if (agent === 'claude-code') {
    // Only the Claude CLI needs the division -- the Codex CLI already emits
    // seconds, and converting its manifest again would corrupt it.
    convertHookTimeoutsToSeconds(resolve(process.cwd(), outputArg));
  }
  canonicalizeHookManifest(resolve(process.cwd(), outputArg), findInputPath(cliArgs));
}

main().catch((error) => {
  process.stderr.write(`hooks-cli-wrapper: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

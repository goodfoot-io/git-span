#!/usr/bin/env node
/**
 * Runs the bundler's own portability linter over every registry plugin, so a
 * template that stops being portable fails a check instead of quietly
 * rendering wrong on one platform.
 *
 * Diagnostics are compared against each plugin's declared `lintBaseline`
 * rather than required to be zero. The comparison is an exact set in both
 * directions: a new diagnostic fails, and so does a declared one that no
 * longer occurs, so the baseline cannot quietly outlive what it excuses.
 *
 * Usage: node scripts/lint-agent-skills.mjs
 * @module
 */

import { spawnSync } from 'node:child_process';
import { assertSafeTargets, cliArgs, cliPath, diagnosticSites, loadRegistry, repo } from './agent-skills-registry.mjs';

const registry = loadRegistry();
// A guard refusal is a named diagnostic, not an internal error — print the
// message, not a stack trace pointing at the guard.
try {
  assertSafeTargets(registry);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1); // refusal: registry-guard-refused
}

// Positive evidence the CLI executes at all before any lint result is
// believed: a clean lint run is silent by design, which makes it
// indistinguishable from a CLI whose entrypoint guard silently declined to
// run (see cliPath()). --version through the same spawn path must answer.
{
  const probe = spawnSync(process.execPath, [cliPath(), '--version'], {
    cwd: repo,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    encoding: 'utf8'
  });
  if (probe.error) throw probe.error;
  if (probe.status !== 0 || !/^\d+\.\d+\.\d+\s*$/.test(probe.stdout ?? '')) {
    process.stderr.write(
      `The agent-skills CLI produced no version output (exit ${probe.status}, stdout ${JSON.stringify(probe.stdout ?? '')}) — ` +
        `it did not actually execute, so no lint result from it can be trusted.\n`
    );
    process.exit(1); // refusal: cli-no-version
  }
}

let failed = false;

for (const plugin of registry.plugins) {
  const baseline = plugin.lintBaseline;
  if (!baseline || !Array.isArray(baseline.diagnostics)) {
    process.stderr.write(`${plugin.name}: registry declares no lintBaseline.\n`);
    failed = true;
    continue;
  }

  const result = spawnSync(process.execPath, cliArgs(plugin, 'lint'), {
    cwd: repo,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    encoding: 'utf8'
  });
  if (result.error) throw result.error;

  const observed = diagnosticSites(result.stderr ?? '');
  const declared = [...baseline.diagnostics].sort();

  const added = observed.filter((site) => !declared.includes(site));
  const stale = declared.filter((site) => !observed.includes(site));

  if (added.length > 0) {
    process.stderr.write(
      `\n${plugin.name}: ${added.length} lint diagnostic(s) not in the registry baseline:\n` +
        `${added.map((site) => `  ${site}`).join('\n')}\n`
    );
    failed = true;
  }
  if (stale.length > 0) {
    // "Reported nothing at all" and "these sites are now clean" demand
    // opposite responses: the first means the linter's verdict is missing
    // (deleting the baseline would bury that), the second that the baseline
    // has honestly shrunk.
    if (observed.length === 0) {
      process.stderr.write(
        `\n${plugin.name}: the linter reported no diagnostics at all while the baseline expects ${declared.length} — ` +
          `this usually means the linter did not really run over the templates. Verify the lint invocation ` +
          `before touching the baseline.\n`
      );
    } else {
      process.stderr.write(
        `\n${plugin.name}: ${stale.length} baseline site(s) are now clean — remove exactly these from the registry:\n` +
          `${stale.map((site) => `  ${site}`).join('\n')}\n`
      );
    }
    failed = true;
  }

  // A nonzero exit with no parseable diagnostics is an infrastructure
  // failure, not a lint verdict — surface it whatever the baseline holds.
  if (result.status !== 0 && observed.length === 0) {
    process.stderr.write(`\n${plugin.name}: lint exited ${result.status} with no reported diagnostics.\n`);
    if (result.stderr) process.stderr.write(result.stderr);
    failed = true;
  }

  if (added.length === 0 && stale.length === 0) {
    const note = declared.length === 0 ? 'clean' : `${declared.length} baselined: ${baseline.reason}`;
    process.stdout.write(`${plugin.name}: ${note}\n`);
  }
}

process.exit(failed ? 1 : 0); // refusal: aggregate-failures

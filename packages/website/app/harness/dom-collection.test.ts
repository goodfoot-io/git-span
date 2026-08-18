import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// The website vitest config's include glob only matches `app/**/*.test.ts`, so
// a colocated `.tsx` test is silently never collected, and `environment:
// 'node'` gives whatever does run no DOM to render into. Both gaps fail open:
// the suite stays green while asserting nothing. This self-check makes them
// loud. It plants a `.tsx` probe under `app/`, runs the package's own vitest
// over it, and asserts that the probe file was collected and its DOM assertion
// executed. See card main-260.
// vitest runs each suite with the package directory as cwd (directly and via
// the root `yarn test` foreach harness), and under the jsdom environment
// `import.meta.url` is an http:// URL — so the package root comes from cwd.
const packageRoot = process.cwd();

// The last candidate skips the `.bin` symlink because the devcontainer shares
// `.bin` with the primary checkout — through that link the binary would
// resolve to the shared vitest, which cannot see this checkout's jsdom.
const vitestCli = [
  path.join(packageRoot, 'node_modules', '.bin', 'vitest'),
  path.join(packageRoot, '..', '..', 'node_modules', '.bin', 'vitest'),
  path.join(packageRoot, '..', '..', 'node_modules', 'vitest', 'vitest.mjs')
].find((candidate) => existsSync(candidate));

// The deliberately failing assertion is gated on an environment variable set
// only by the spawned run, so if the outer suite ever collects the probe
// (e.g. a temp dir left behind by a crashed run) it still passes and cannot
// flake the suite red.
const probeContent = `// Planted at runtime by app/harness/dom-collection.test.ts.
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { GithubAltIcon } from '../components/icons';

it('renders a component and queries it by role and accessible name', () => {
  render(
    <section aria-label="dom probe surface">
      <GithubAltIcon size={20} />
    </section>
  );
  expect(
    screen.getByRole('region', { name: 'dom probe surface' }),
    'DOM probe: render and accessible-name query must succeed'
  ).toBeTruthy();
  if (process.env.DOM_PROBE_DELIBERATE_FAILURE === '1') {
    expect('collected .tsx file', 'DOM-PROBE-DELIBERATE-FAILURE').toBe('not collected');
  }
});
`;

function runProbe(probeDir: string): string {
  if (!vitestCli) {
    return 'vitest CLI not found';
  }
  let output = '';
  try {
    output += execFileSync(vitestCli, ['run', path.relative(packageRoot, probeDir), '--reporter=verbose'], {
      cwd: packageRoot,
      encoding: 'utf8',
      // The nested vitest pays the fumadocs-mdx startup cost before collecting
      // anything ([MDX] generation runs ~7.5s solo). The 25s budget was
      // exceeded under full-suite parallel load (root `yarn test` runs this
      // suite alongside seven other workspaces), killing the run mid-startup
      // and failing the collection assertion on truncated output — a load
      // race, not a collection failure. 60s is 6x the solo inner-run cost.
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, DOM_PROBE_DELIBERATE_FAILURE: '1' }
    });
  } catch (error) {
    // The spawned run exits non-zero both when the probe fails as designed and
    // when no test files match, so stdout/stderr carry the discriminating
    // evidence either way.
    const failed = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
    output += String(failed.stdout ?? '') + String(failed.stderr ?? '') + String(failed.message ?? '');
  }
  return output;
}

describe('website test harness', () => {
  const probeDir = mkdtempSync(path.join(packageRoot, 'app', '__dom-probe-'));

  afterAll(() => {
    rmSync(probeDir, { recursive: true, force: true });
  });

  it('collects and executes a .tsx test against a DOM', () => {
    expect(vitestCli, 'the vitest CLI could not be resolved from the website package or the repo root').toBeDefined();
    writeFileSync(path.join(probeDir, 'probe.test.tsx'), probeContent);
    const output = runProbe(probeDir);
    expect(output, 'the .tsx probe file should have been collected by the website vitest include glob').toContain(
      'probe.test.tsx'
    );
    expect(
      output,
      'the .tsx probe should have executed its DOM assertion, proving both collection and a DOM environment'
    ).toContain('DOM-PROBE-DELIBERATE-FAILURE');
  });
});

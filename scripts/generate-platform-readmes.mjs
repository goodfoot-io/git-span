#!/usr/bin/env node
// Render every npm platform package's README.md from the single template below
// so the five registry pages stay equivalent and cannot diverge (card main-335).
//
// The release workflow's "Prepare platform packages" step regenerates them
// before publish; CI runs this with --check to fail closed when a committed
// README drifts from the template.
//
//   node scripts/generate-platform-readmes.mjs           # write all five
//   node scripts/generate-platform-readmes.mjs --check   # verify, exit 1 on drift

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const npmDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'npm');
const checkOnly = process.argv.includes('--check');

// OS display labels keyed by each package manifest's single os guard value;
// an unrecognized guard fails closed in discoverPlatformPackages below.
/** @type {Record<string, string>} */
const OS_LABELS = { linux: 'Linux', darwin: 'macOS', win32: 'Windows' };

// The platform list is derived from the packages on disk (npm/git-span-*), and
// each package's os/cpu guards in its manifest are the source of truth for the
// wording — adding a platform package automatically gets it covered.
function discoverPlatformPackages() {
  return readdirSync(npmDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^git-span-/.test(entry.name))
    .map((entry) => {
      const dir = join(npmDir, entry.name);
      let manifest;
      try {
        manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`npm/${entry.name}/package.json is missing or unparseable: ${reason}`);
      }
      const os = Array.isArray(manifest.os) && typeof manifest.os[0] === 'string' ? manifest.os[0] : null;
      const cpu = Array.isArray(manifest.cpu) && typeof manifest.cpu[0] === 'string' ? manifest.cpu[0] : null;
      if (!os || !cpu || !(manifest.os.length === 1) || !(manifest.cpu.length === 1)) {
        throw new Error(`npm/${entry.name} must declare exactly one os and one cpu guard`);
      }
      if (!OS_LABELS[os]) {
        throw new Error(`npm/${entry.name}: no display label for os "${os}" — add one to OS_LABELS`);
      }
      return { name: entry.name, dir, os, cpu };
    });
}

/**
 * @param {{ name: string, dir: string, os: string, cpu: string }} pkg
 */
function renderReadme({ name, os, cpu }) {
  return `# ${name}

Platform-specific binary for [\`git-span\`](https://www.npmjs.com/package/git-span), a Rust CLI
that tracks implicit semantic dependencies between whole files or exact line ranges and surfaces drift.

This package is not meant to be installed directly — it is pulled in automatically as an
optional dependency of the \`git-span\` meta-package on ${OS_LABELS[os]} ${cpu} hosts.

Documentation: https://git-span.com
Source: https://github.com/goodfoot-io/git-span
`;
}

const packages = discoverPlatformPackages();
if (packages.length !== 5) {
  throw new Error(`expected exactly 5 platform packages under npm/, found ${packages.length}`);
}

const drifted = [];
for (const pkg of packages) {
  const readme = renderReadme(pkg);
  const target = join(pkg.dir, 'README.md');
  if (checkOnly) {
    let current = null;
    try {
      current = readFileSync(target, 'utf8');
    } catch {
      // missing README counts as drift
    }
    if (current !== readme) {
      drifted.push(`npm/${pkg.name}/README.md`);
      console.error(`DRIFT: npm/${pkg.name}/README.md does not match the generated template`);
    } else {
      console.log(`OK: npm/${pkg.name}/README.md`);
    }
  } else {
    writeFileSync(target, readme);
    console.log(`Wrote npm/${pkg.name}/README.md`);
  }
}

if (drifted.length > 0) {
  console.error(
    `\n${drifted.length} of ${packages.length} platform README(s) drifted from scripts/generate-platform-readmes.mjs.`
  );
  console.error('Run `node scripts/generate-platform-readmes.mjs` to regenerate, then commit.');
  process.exit(1);
}

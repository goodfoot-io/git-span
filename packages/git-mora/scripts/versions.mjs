import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const platforms = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64'];
const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = resolve(packageDirectory, '../..');
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function readJson(root, file) {
  return JSON.parse(readFileSync(join(root, file), 'utf8'));
}

function rustPackageBlock(text, lockfile) {
  const header = lockfile ? '[[package]]' : '[package]';
  const block = text
    .split(/(?=^\[)/m)
    .find((section) => section.startsWith(header) && /^name = "git-mora"$/m.test(section));
  if (!block) throw new Error('Missing git-mora Rust package entry.');
  return block;
}

export function checkVersions(root, tag) {
  const pkg = readJson(root, 'packages/git-mora/package.json');
  if (!semver.test(pkg.version)) throw new Error(`Invalid git-mora version: ${pkg.version}`);
  if (tag !== undefined && tag !== `git-mora-v${pkg.version}`) {
    throw new Error(`Release tag ${tag} does not match git-mora-v${pkg.version}.`);
  }
  const expectedNames = platforms.map((platform) => `git-mora-${platform}`).sort();
  if (JSON.stringify(Object.keys(pkg.optionalDependencies).sort()) !== JSON.stringify(expectedNames)) {
    throw new Error('git-mora optionalDependencies must contain exactly the five platform packages.');
  }
  for (const platform of platforms) {
    const name = `git-mora-${platform}`;
    const manifest = readJson(root, `npm/${name}/package.json`);
    const [os, cpu] = platform.split('-');
    if (manifest.name !== name || manifest.version !== pkg.version || pkg.optionalDependencies[name] !== pkg.version) {
      throw new Error(`${name} must match git-mora version ${pkg.version}.`);
    }
    if (
      JSON.stringify(manifest.os) !== JSON.stringify([os]) ||
      JSON.stringify(manifest.cpu) !== JSON.stringify([cpu])
    ) {
      throw new Error(`${name} has incorrect os/cpu constraints.`);
    }
  }
  for (const file of ['Cargo.toml', 'Cargo.lock']) {
    const block = rustPackageBlock(readFileSync(join(root, 'packages/git-mora', file), 'utf8'), file === 'Cargo.lock');
    if (!block.includes(`version = "${pkg.version}"\n`))
      throw new Error(`${file} must match git-mora version ${pkg.version}.`);
  }
  return pkg.version;
}

export function bumpVersion(root, level) {
  if (!['major', 'minor', 'patch'].includes(level)) throw new Error('Expected major, minor, or patch.');
  const current = checkVersions(root);
  const parts = current.split('.').map(Number);
  const index = ['major', 'minor', 'patch'].indexOf(level);
  parts[index] += 1;
  parts.fill(0, index + 1);
  const version = parts.join('.');
  for (const file of [
    'packages/git-mora/package.json',
    ...platforms.map((platform) => `npm/git-mora-${platform}/package.json`)
  ]) {
    const manifest = readJson(root, file);
    manifest.version = version;
    if (manifest.optionalDependencies) {
      for (const name of Object.keys(manifest.optionalDependencies)) manifest.optionalDependencies[name] = version;
    }
    writeFileSync(join(root, file), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  for (const file of ['Cargo.toml', 'Cargo.lock']) {
    const path = join(root, 'packages/git-mora', file);
    const text = readFileSync(path, 'utf8');
    const block = rustPackageBlock(text, file === 'Cargo.lock');
    writeFileSync(path, text.replace(block, block.replace(`version = "${current}"`, `version = "${version}"`)));
  }
  checkVersions(root);
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, argument, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error('Too many arguments.');
  if (command === 'check') {
    console.log(`git-mora ${checkVersions(repositoryRoot, argument)}: versions agree.`);
  } else if (command === 'bump') {
    const version = bumpVersion(repositoryRoot, argument ?? 'patch');
    console.log(`Bumped git-mora to ${version}.`);
  } else {
    throw new Error('Usage: versions.mjs check [git-mora-vVERSION] | bump [major|minor|patch]');
  }
}

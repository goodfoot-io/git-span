import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { bumpVersion, checkVersions, platforms } from './versions.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const source = join(root, 'packages/git-mora');

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'git-mora-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function versionFixture(t) {
  const dir = fixture(t);
  for (const file of ['package.json', 'Cargo.toml', 'Cargo.lock']) {
    const dest = join(dir, 'packages/git-mora', file);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(source, file), dest);
  }
  for (const platform of platforms) {
    const rel = `npm/git-mora-${platform}/package.json`;
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    cpSync(join(root, rel), join(dir, rel));
  }
  return dir;
}

test('versions agree and only matching mora tags can release', () => {
  const version = checkVersions(root);
  assert.equal(checkVersions(root, `git-mora-v${version}`), version);
  assert.throws(() => checkVersions(root, `git-span-v${version}`), /does not match/);
  assert.throws(() => checkVersions(root, 'git-mora-v999.0.0'), /does not match/);
});

test('independent bumps update all mora manifests and preserve dependency versions', (t) => {
  const [major, minor, patch] = checkVersions(root).split('.').map(Number);
  for (const [level, expected] of [
    ['major', `${major + 1}.0.0`],
    ['minor', `${major}.${minor + 1}.0`],
    ['patch', `${major}.${minor}.${patch + 1}`]
  ]) {
    const dir = versionFixture(t);
    // The fixture has no git-span manifests: a coupling to span makes this fail.
    assert.equal(bumpVersion(dir, level), expected);
    assert.equal(checkVersions(dir, `git-mora-v${expected}`), expected);
    const lock = readFileSync(join(dir, 'packages/git-mora/Cargo.lock'), 'utf8');
    assert.match(lock, /name = "clap"\nversion = "4\./);
  }
});

test('release validation fails on stale, missing, or mislabelled platform packages', (t) => {
  for (const change of ['version', 'os', 'missing']) {
    const dir = versionFixture(t);
    const file = join(dir, 'npm/git-mora-win32-x64/package.json');
    if (change === 'missing') rmSync(file);
    else {
      const manifest = JSON.parse(readFileSync(file, 'utf8'));
      manifest[change] = change === 'os' ? ['linux'] : '9.0.0';
      writeFileSync(file, JSON.stringify(manifest));
    }
    assert.throws(() => checkVersions(dir));
  }
});

test('source postinstall preserves the tracked placeholder', () => {
  const file = join(source, 'bin/git-mora.exe');
  const before = readFileSync(file);
  const result = spawnSync(process.execPath, [join(source, 'scripts/postinstall.js')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(file), before);
  assert.ok(!statSync(file).isSymbolicLink());
  assert.ok(!before.toString().startsWith('#!'));
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o111, 0);
});

test('installer selects each supported binary, including the Windows executable', (t) => {
  const code = readFileSync(join(source, 'scripts/postinstall.js'), 'utf8');
  for (const platform of platforms) {
    const dir = fixture(t);
    const [os, arch] = platform.split('-');
    const packageDir = join(dir, 'platform');
    const dest = join(dir, 'bin/git-mora.exe');
    mkdirSync(join(packageDir, 'bin'), { recursive: true });
    mkdirSync(dirname(dest));
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ version: '0.1.0' }));
    const binary = `native-${platform}`;
    writeFileSync(join(packageDir, 'bin', os === 'win32' ? 'git-mora.exe' : 'git-mora'), binary);
    writeFileSync(dest, 'placeholder');
    const fakeRequire = (name) => {
      if (name === '../package.json') return { version: '0.1.0' };
      if (name === 'node:fs') return { existsSync, readFileSync, copyFileSync: cpSync, chmodSync: () => {} };
      if (name === 'node:path') return { join, dirname };
      throw new Error(`Unexpected require ${name}`);
    };
    fakeRequire.resolve = (name) => {
      assert.equal(name, `git-mora-${platform}/package.json`);
      return join(packageDir, 'package.json');
    };
    const fakeProcess = { platform: os, arch, exitCode: 0 };
    vm.runInNewContext(code, { require: fakeRequire, __dirname: join(dir, 'scripts'), process: fakeProcess, console });
    assert.equal(fakeProcess.exitCode, 0);
    assert.equal(readFileSync(dest, 'utf8'), binary);
  }
});

test('consumer install fails closed for missing and mismatched platform packages', (t) => {
  for (const mismatch of [false, true]) {
    const dir = fixture(t);
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(join(dir, 'bin'));
    cpSync(join(source, 'scripts/postinstall.js'), join(dir, 'scripts/postinstall.js'));
    cpSync(join(source, 'package.json'), join(dir, 'package.json'));
    writeFileSync(join(dir, 'bin/git-mora.exe'), 'placeholder');
    if (mismatch) {
      const pkg = join(dir, 'node_modules', `git-mora-${process.platform}-${process.arch}`);
      mkdirSync(pkg, { recursive: true });
      writeFileSync(join(pkg, 'package.json'), JSON.stringify({ version: '9.0.0' }));
    }
    const result = spawnSync(process.execPath, [join(dir, 'scripts/postinstall.js')], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, mismatch ? /does not match/ : /installation failed/);
    assert.equal(readFileSync(join(dir, 'bin/git-mora.exe'), 'utf8'), 'placeholder');
  }
});

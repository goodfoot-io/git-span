#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

function main() {
  // A workspace install must leave the tracked placeholder untouched.
  if (fs.existsSync(path.join(__dirname, '..', 'Cargo.toml'))) {
    // Yarn marks bin entries executable while linking. A text placeholder
    // must fail with EACCES rather than being interpreted as a shell script.
    if (process.platform !== 'win32') fs.chmodSync(path.join(__dirname, '..', 'bin', 'git-mora.exe'), 0o644);
    console.log('git-mora: source checkout; run yarn workspace git-mora build:local to install the binary.');
    return;
  }

  const platform = `${process.platform}-${process.arch}`;
  const supported = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64'];
  if (!supported.includes(platform)) {
    throw new Error(`git-mora: no prebuilt binary for ${platform}.`);
  }

  const packageName = `git-mora-${platform}`;
  const manifestPath = require.resolve(`${packageName}/package.json`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const ownManifest = require('../package.json');
  if (manifest.version !== ownManifest.version) {
    throw new Error(`git-mora: ${packageName} version ${manifest.version} does not match ${ownManifest.version}.`);
  }

  const binaryName = process.platform === 'win32' ? 'git-mora.exe' : 'git-mora';
  const source = path.join(path.dirname(manifestPath), 'bin', binaryName);
  const destination = path.join(__dirname, '..', 'bin', 'git-mora.exe');
  // Copy over the regular-file placeholder; no symlinks or runtime Node wrapper.
  fs.copyFileSync(source, destination);
  if (process.platform !== 'win32') fs.chmodSync(destination, 0o755);
  console.log(`git-mora: installed native binary from ${packageName}.`);
}

try {
  main();
} catch (error) {
  console.error(`git-mora: installation failed: ${error.message}`);
  process.exitCode = 1;
}

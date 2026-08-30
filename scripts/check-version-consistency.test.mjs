import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scripts = dirname(fileURLToPath(import.meta.url));
const checker = join(scripts, 'check-version-consistency.mjs');

/**
 * @param {{ claude?: string, codex?: string, opencode?: string, antigravity?: string, marketplace?: string }} versions
 */
function fixture(versions) {
  const root = mkdtempSync(join(tmpdir(), 'version-consistency-'));
  spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
  /** @type {[string | undefined, string][]} */
  const manifests = [
    [versions.claude, 'plugins-claude/demo/.claude-plugin/plugin.json'],
    [versions.codex, 'plugins-codex/demo/.codex-plugin/plugin.json'],
    [versions.opencode, 'plugins-opencode/demo/package.json'],
    [versions.antigravity, 'plugins-antigravity/demo/plugin.json']
  ];
  for (const [version, path] of manifests) {
    // A directory without its manifest exercises the missing-manifest branch.
    mkdirSync(dirname(join(root, path)), { recursive: true });
    if (version !== undefined) {
      writeFileSync(join(root, path), `${JSON.stringify({ name: 'demo', version }, null, 2)}\n`);
    }
  }
  if (versions.marketplace !== undefined) {
    mkdirSync(join(root, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(root, '.claude-plugin/marketplace.json'),
      `${JSON.stringify({ name: 'demo', plugins: [{ name: 'demo', version: versions.marketplace }] }, null, 2)}\n`
    );
  }
  return root;
}

/** @param {string} root */
function check(root) {
  return spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8' });
}

test('passes when all four platform manifests and the marketplace entry agree', () => {
  const root = fixture({
    claude: '1.2.3',
    codex: '1.2.3',
    opencode: '1.2.3',
    antigravity: '1.2.3',
    marketplace: '1.2.3'
  });
  try {
    const result = check(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PASS: 1 plugin/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a platform manifest carrying a different version', () => {
  const root = fixture({
    claude: '1.2.3',
    codex: '1.2.3',
    opencode: '1.2.3',
    antigravity: '1.2.2',
    marketplace: '1.2.3'
  });
  try {
    const result = check(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /versions disagree/);
    assert.match(result.stderr, /plugins-antigravity\/demo\/plugin\.json=1\.2\.2/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a marketplace entry carrying a different version', () => {
  const root = fixture({
    claude: '1.2.3',
    codex: '1.2.3',
    opencode: '1.2.3',
    antigravity: '1.2.3',
    marketplace: '1.2.4'
  });
  try {
    const result = check(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /versions disagree/);
    assert.match(result.stderr, /marketplace\.json plugins entry "demo"=1\.2\.4/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a plugin missing one platform manifest while the others exist', () => {
  const root = fixture({ claude: '1.2.3', codex: '1.2.3', opencode: '1.2.3', marketplace: '1.2.3' });
  try {
    const result = check(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing platform manifest plugins-antigravity\/demo\/plugin\.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the real repository carries one version across every source', () => {
  const result = spawnSync(process.execPath, [checker], { cwd: scripts, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

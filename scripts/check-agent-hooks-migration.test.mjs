import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scanner = join(dirname(fileURLToPath(import.meta.url)), 'check-agent-hooks-migration.mjs');
const legacyClaude = '@goodfoot/' + 'claude-code-hooks';
const legacyCodex = '@goodfoot/' + 'codex-hooks';
const marketplaceSetting = [
  '{',
  '  "enabledPlugins": {',
  '    "claude-code-hooks@goodfoot": true,',
  '    "git-span@git-span": true',
  '  }',
  '}',
  ''
].join('\n');

/** @param {Record<string, string>} [files] */
function fixture(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'agent-hooks-migration-'));
  spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
  const allFiles = { '.claude/settings.json': marketplaceSetting, ...files };
  for (const [path, content] of Object.entries(allFiles)) {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
  return root;
}

/** @param {string} root */
function scan(root) {
  return spawnSync(process.execPath, [scanner], { cwd: root, encoding: 'utf8' });
}

test('passes a clean tracked tree and ignores untracked build state', () => {
  const root = fixture({ 'src/adapter.ts': "import '@goodfoot/agent-hooks/codex';\n" });
  try {
    writeFileSync(join(root, 'ignored-build.mjs'), legacyCodex);
    const result = scan(root);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ignores a tracked legacy file deleted from the working tree', () => {
  const root = fixture({ 'src/removed-adapter.ts': `import '${legacyClaude}';\n` });
  try {
    unlinkSync(join(root, 'src/removed-adapter.ts'));
    const result = scan(root);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [label, path, content] of [
  ['source', 'src/adapter.ts', `import '${legacyClaude}';\n`],
  ['prose', 'README.md', `Install ${legacyCodex} first.\n`],
  ['lockfile', 'yarn.lock', `"${legacyClaude}@npm:^1.0.0":\n`],
  ['bundle', 'plugins/hooks/advisor.mjs', `// node_modules/${legacyCodex}/dist/hooks.js\n`]
]) {
  test(`rejects a forbidden package in ${label} with its tracked path`, () => {
    const root = fixture({ [path]: content });
    try {
      const result = scan(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(path.replaceAll('.', '\\.')));
      assert.match(result.stderr, /superseded hook package/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('rejects drift in the exact retained marketplace setting', () => {
  const root = fixture({ '.claude/settings.json': '{"enabledPlugins":{"claude-code-hooks@goodfoot":false}}\n' });
  try {
    const result = scan(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /allowlist drift/);
    assert.match(result.stderr, /\.claude\/settings\.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

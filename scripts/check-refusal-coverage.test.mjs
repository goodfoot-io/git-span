/**
 * Hermetic controls for check-refusal-coverage.mjs: a fixture gate family
 * under REFUSAL_COVERAGE_ROOT proves each reconciliation direction goes red —
 * an unmarked refusal, an orphan marker, a marker with no map entry, a map
 * entry with no marker, a control whose test vanished, and a family/map
 * mismatch — and that the annotated baseline stays green.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const checker = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-refusal-coverage.mjs');

const REGISTRY = [
  "export const repo = '.';",
  '// refusal: bad-registry',
  "throw new Error('the registry is bad');",
  ''
].join('\n');

const GATE = [
  "import { repo } from './agent-skills-registry.mjs';",
  '/** @returns {never} */',
  'function fail(message) {',
  '  console.error(message);',
  '  process.exit(1); // refusal-channel',
  '}',
  "if (repo === 'red') fail('gate goes red'); // refusal: gate-red",
  ''
].join('\n');

const SUITE = [
  "test('registry refuses a bad registry', () => {});",
  "test('gate goes red on demand', () => {});",
  ''
].join('\n');

const MAP = {
  files: {
    'scripts/agent-skills-registry.mjs': {
      'bad-registry': { control: 'registry refuses a bad registry', suite: 'scripts/demo.test.mjs' }
    },
    'scripts/demo-gate.mjs': {
      'gate-red': { control: 'gate goes red on demand', suite: 'scripts/demo.test.mjs' }
    }
  }
};

/**
 * Build a fixture repo; each override replaces one file's content, and a
 * `null` value deletes nothing — extra files are added via extraFiles.
 * @param {{registry?: string, gate?: string, suite?: string, map?: unknown, extraFiles?: Record<string, string>}} overrides
 * @returns {string} fixture root
 */
function fixture(overrides = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'refusal-coverage-'));
  mkdirSync(path.join(root, 'scripts'));
  writeFileSync(path.join(root, 'scripts', 'agent-skills-registry.mjs'), overrides.registry ?? REGISTRY);
  writeFileSync(path.join(root, 'scripts', 'demo-gate.mjs'), overrides.gate ?? GATE);
  writeFileSync(path.join(root, 'scripts', 'demo.test.mjs'), overrides.suite ?? SUITE);
  writeFileSync(path.join(root, 'scripts', 'refusal-coverage.json'), JSON.stringify(overrides.map ?? MAP, null, 2));
  for (const [file, content] of Object.entries(overrides.extraFiles ?? {})) {
    writeFileSync(path.join(root, file), content);
  }
  return root;
}

/** @param {string} root @returns {{status: number | null, stdout: string, stderr: string}} */
function run(root) {
  const result = spawnSync(process.execPath, [checker], {
    env: {
      ...process.env,
      REFUSAL_COVERAGE_ROOT: root,
      REFUSAL_COVERAGE_MAP: path.join(root, 'scripts', 'refusal-coverage.json')
    },
    encoding: 'utf8'
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** @param {unknown} base @param {(map: any) => void} mutate @returns {unknown} */
function mutatedMap(base, mutate) {
  const clone = JSON.parse(JSON.stringify(base));
  mutate(clone);
  return clone;
}

test('coverage checker passes a fully annotated, fully mapped family', () => {
  const root = fixture();
  try {
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /refusal coverage: 2 sites across 2 gate scripts \(2 controlled, 0 accepted\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('coverage checker goes red on a refusal site with no marker', () => {
  const root = fixture({ gate: GATE.replace("fail('gate goes red'); // refusal: gate-red", "fail('gate goes red');") });
  try {
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /refusal site has no "\/\/ refusal: <id>" marker/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('coverage checker goes red on an orphan marker with no site under it', () => {
  const root = fixture({ gate: `${GATE}// refusal: ghost\n` });
  try {
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /orphan refusal marker "ghost"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('coverage checker goes red on a marked refusal the map does not cover', () => {
  const root = fixture({ gate: `${GATE}process.exit(2); // refusal: brand-new\n` });
  try {
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /refusal "brand-new" has no coverage entry/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('coverage checker goes red on a map entry whose refusal is gone', () => {
  const map = mutatedMap(MAP, (clone) => {
    clone.files['scripts/demo-gate.mjs']['gone-refusal'] = {
      control: 'gate goes red on demand',
      suite: 'scripts/demo.test.mjs'
    };
  });
  const root = fixture({ map });
  try {
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /entry "gone-refusal" for scripts\/demo-gate\.mjs matches no refusal site/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('coverage checker goes red when a control test no longer exists in its suite', () => {
  const root = fixture({ suite: "test('registry refuses a bad registry', () => {});\n" });
  try {
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /control "gate goes red on demand" for scripts\/demo-gate\.mjs#gate-red not found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('coverage checker goes red when the derived family and the map disagree', () => {
  const newImporter = [
    "import { repo } from './agent-skills-registry.mjs';",
    "if (repo === '') throw new Error('unconfigured'); // refusal: unconfigured",
    ''
  ].join('\n');
  const map = mutatedMap(MAP, (clone) => {
    delete clone.files['scripts/demo-gate.mjs'];
    clone.files['scripts/retired-gate.mjs'] = {};
  });
  const root = fixture({ map, extraFiles: { 'scripts/new-gate.mjs': newImporter } });
  try {
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /scripts\/new-gate\.mjs is in the measured gate family .* but has no entry/);
    assert.match(result.stderr, /scripts\/demo-gate\.mjs is in the measured gate family .* but has no entry/);
    assert.match(result.stderr, /lists scripts\/retired-gate\.mjs, which is not in the measured gate family/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('coverage checker refuses an empty enumeration for a family file', () => {
  const root = fixture({
    extraFiles: {
      'scripts/quiet-gate.mjs': "import { repo } from './agent-skills-registry.mjs';\nconsole.log(repo);\n"
    }
  });
  try {
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /scripts\/quiet-gate\.mjs: enumerated zero refusal sites/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

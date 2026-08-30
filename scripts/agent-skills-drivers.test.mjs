/**
 * End-to-end controls for the agent-skills build and lint drivers.
 *
 * Every test runs the real driver script as a child process against a
 * temporary fixture repository (its own git history, skills-src templates,
 * and a node_modules/@goodfoot symlink — the documented worktree
 * provisioning shape that made the un-realpathed CLI silently no-op), so the
 * refusals asserted here are the drivers' own, not a unit copy of the rules.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scripts = dirname(fileURLToPath(import.meta.url));
const realRepo = resolve(scripts, '..');

/** @param {string} root @param {string[]} args */
function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed:\n${result.stderr}`);
  return result.stdout;
}

/**
 * A fixture repository holding one plugin ("demo") with two targets and the
 * given skills-src skill directories.
 * @param {{ skills?: string[], onDisk?: Record<string, string>, baseline?: string[] }} [options]
 *   `skills` is the registry declaration; `onDisk` maps skill-dir names to
 *   their entrypoint filename (SKILL.md.eta unless overridden).
 */
function fixture({ skills = ['alpha'], onDisk = { alpha: 'SKILL.md.eta' }, baseline = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'agent-skills-drivers-'));
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);

  for (const [skill, entrypoint] of Object.entries(onDisk)) {
    const dir = join(root, 'skills-src/demo', skill);
    mkdirSync(join(dir, 'references'), { recursive: true });
    writeFileSync(
      join(dir, entrypoint),
      `---\nname: ${skill}\ndescription: A demo skill.\n---\n\n# ${skill}\n\nBody.\n`
    );
    writeFileSync(join(dir, 'references/notes.md'), `# ${skill} notes\n\nPlain copied reference.\n`);
  }
  mkdirSync(join(root, 'plugins-claude/demo'), { recursive: true });
  mkdirSync(join(root, 'plugins-codex/demo'), { recursive: true });

  writeFileSync(
    join(root, 'registry.json'),
    JSON.stringify(
      {
        plugins: [
          {
            name: 'demo',
            skillsSrc: 'skills-src/demo',
            skills,
            claudePluginRoot: 'plugins-claude/demo',
            codexPluginRoot: 'plugins-codex/demo',
            opencodePluginRoot: 'plugins-opencode/demo',
            targets: [
              { platform: 'claude-code', path: 'plugins-claude/demo/skills' },
              { platform: 'codex', path: 'plugins-codex/demo/skills' }
            ],
            platformDirs: [],
            lintBaseline: { diagnostics: baseline, reason: baseline.length > 0 ? 'fixture baseline' : '' }
          }
        ]
      },
      null,
      2
    )
  );

  // The provisioning shape under test: the package directory reachable only
  // through a symlink, exactly like a card worktree's shared node_modules.
  // The hooks gate's derivation source: a fixture agent-hooks workspace with
  // build scripts (one reached through a `yarn` alias) and a stub CLI wrapper
  // that writes a manifest plus a companion bin/ bundle — the sibling-write
  // shape the real builds have, which the `-o` flag alone understates. run()
  // points the gate here via AGENT_HOOKS_WORKSPACE.
  const hooksWorkspace = join(root, 'packages/agent-hooks');
  mkdirSync(join(hooksWorkspace, 'scripts'), { recursive: true });
  writeFileSync(
    join(hooksWorkspace, 'package.json'),
    JSON.stringify(
      {
        name: 'agent-hooks-fixture',
        type: 'module',
        scripts: {
          'build:claude': 'yarn build:hooks',
          'build:hooks': 'yarn agent-hooks --agent claude-code -i src -o "../../plugins-claude/demo/hooks/hooks.json"',
          'build:codex': 'yarn agent-hooks --agent codex -i src -o ../../plugins-codex/demo/hooks/hooks.json',
          'agent-hooks': 'node scripts/hooks-cli-wrapper.js'
        }
      },
      null,
      2
    )
  );
  writeFileSync(
    join(hooksWorkspace, 'scripts/hooks-cli-wrapper.js'),
    [
      "import { mkdirSync, writeFileSync } from 'node:fs';",
      "import { dirname, join } from 'node:path';",
      'const args = process.argv.slice(2);',
      "const out = args[args.indexOf('-o') + 1];",
      "const agent = args[args.indexOf('--agent') + 1];",
      "mkdirSync(join(dirname(out), 'bin'), { recursive: true });",
      'writeFileSync(out, `${JSON.stringify({ agent })}\\n`);',
      "writeFileSync(join(dirname(out), 'bin/hook.mjs'), 'export {};\\n');",
      ''
    ].join('\n')
  );
  for (const tree of ['plugins-claude/demo/hooks', 'plugins-codex/demo/hooks']) {
    mkdirSync(join(root, tree, 'bin'), { recursive: true });
    writeFileSync(join(root, tree, 'hooks.json'), '{}\n');
    writeFileSync(join(root, tree, 'bin/hook.mjs'), 'export {};\n');
  }

  mkdirSync(join(root, 'node_modules'));
  symlinkSync(join(realRepo, 'node_modules/@goodfoot'), join(root, 'node_modules/@goodfoot'), 'dir');

  git(root, ['add', '-A']);
  git(root, ['commit', '--quiet', '-m', 'init']);
  return root;
}

/**
 * Run a driver script against a fixture repository.
 * @param {string} script
 * @param {string} root
 * @param {Record<string, string>} [env]
 * @param {string[]} [args]
 */
function run(script, root, env = {}, args = []) {
  return spawnSync(process.execPath, [join(scripts, script), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      AGENT_SKILLS_REPO: root,
      AGENT_SKILLS_REGISTRY: join(root, 'registry.json'),
      AGENT_HOOKS_WORKSPACE: join(root, 'packages/agent-hooks'),
      ...env
    }
  });
}

/** @param {string} root @param {string} name @param {string} body */
function stub(root, name, body) {
  const file = join(root, name);
  writeFileSync(file, body);
  return file;
}

test('build renders through a symlinked node_modules and stamps generated-from markers', () => {
  const root = fixture();
  try {
    const result = run('build-agent-skills.mjs', root);
    assert.equal(result.status, 0, result.stderr);

    for (const target of ['plugins-claude/demo/skills', 'plugins-codex/demo/skills']) {
      const skillMd = readFileSync(join(root, target, 'alpha/SKILL.md'), 'utf8');
      assert.match(
        skillMd,
        /^---\nname: alpha\ndescription: A demo skill\.\n---\n<!-- Generated from skills-src\/demo\/alpha\/SKILL\.md\.eta by scripts\/build-agent-skills\.mjs/,
        `marker missing after frontmatter in ${target}`
      );
      const notes = readFileSync(join(root, target, 'alpha/references/notes.md'), 'utf8');
      assert.match(
        notes,
        /^<!-- Generated from skills-src\/demo\/alpha\/references\/notes\.md by scripts\/build-agent-skills\.mjs/
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('build fails closed when the CLI exits 0 having written nothing', () => {
  const root = fixture();
  try {
    const silent = stub(root, 'stub-silent.js', 'process.exit(0);\n');
    const result = run('build-agent-skills.mjs', root, { AGENT_SKILLS_CLI: silent });
    assert.equal(result.status, 3, 'a silent CLI must exit with the render-not-verified code');
    assert.match(result.stderr, /reported nothing written for --target claude-code=plugins-claude\/demo\/skills/);
    assert.match(result.stderr, /reported nothing written for --target codex=plugins-codex\/demo\/skills/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('build fails when the CLI reports some targets but not all', () => {
  const root = fixture();
  try {
    const partial = stub(
      root,
      'stub-first-target.js',
      [
        'const targets = [];',
        'for (let i = 2; i < process.argv.length; i += 1) {',
        "  if (process.argv[i] === '--target') targets.push(process.argv[i + 1]);",
        '}',
        "const [platform, outDir] = targets[0].split('=');",
        'console.log(`${platform}=${outDir}: alpha/SKILL.md, alpha/references/notes.md`);',
        'process.exit(0);',
        ''
      ].join('\n')
    );
    const result = run('build-agent-skills.mjs', root, { AGENT_SKILLS_CLI: partial });
    assert.equal(result.status, 3);
    assert.match(result.stderr, /reported nothing written for --target codex=plugins-codex\/demo\/skills/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('build fails when a declared skill is missing from a target listing', () => {
  const root = fixture({
    skills: ['alpha', 'beta'],
    onDisk: { alpha: 'SKILL.md.eta', beta: 'SKILL.md.eta' }
  });
  try {
    const alphaOnly = stub(
      root,
      'stub-alpha-only.js',
      [
        'for (let i = 2; i < process.argv.length; i += 1) {',
        "  if (process.argv[i] !== '--target') continue;",
        "  const [platform, outDir] = process.argv[i + 1].split('=');",
        '  console.log(`${platform}=${outDir}: alpha/SKILL.md, alpha/references/notes.md`);',
        '}',
        'process.exit(0);',
        ''
      ].join('\n')
    );
    const result = run('build-agent-skills.mjs', root, { AGENT_SKILLS_CLI: alphaOnly });
    assert.equal(result.status, 3);
    assert.match(result.stderr, /lists no files for skill "beta"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('build refuses a skills-src directory the registry does not declare, naming the missing entrypoint', () => {
  const root = fixture({
    skills: ['alpha'],
    onDisk: { alpha: 'SKILL.md.eta', gamma: 'SKILL.md' }
  });
  try {
    const result = run('build-agent-skills.mjs', root);
    assert.equal(result.status, 1, 'an undeclared skill directory must fail the build, not silently drop');
    assert.match(result.stderr, /skills-src\/demo\/gamma/);
    assert.match(result.stderr, /SKILL\.md\.eta/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('build refuses a registry skill with no directory on disk', () => {
  const root = fixture({ skills: ['alpha', 'delta'] });
  try {
    const result = run('build-agent-skills.mjs', root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /declares skill "delta"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('build refuses a declared skill whose entrypoint is a plain SKILL.md', () => {
  const root = fixture({ skills: ['alpha'], onDisk: { alpha: 'SKILL.md' } });
  try {
    const result = run('build-agent-skills.mjs', root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /skills-src\/demo\/alpha lacks SKILL\.md\.eta/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('build restores and refuses a hand-edited rendered file, naming its template', () => {
  const root = fixture();
  try {
    assert.equal(run('build-agent-skills.mjs', root).status, 0);
    git(root, ['add', '-A']);
    git(root, ['commit', '--quiet', '-m', 'rendered trees']);

    const edited = join(root, 'plugins-claude/demo/skills/alpha/SKILL.md');
    const handEdit = `${readFileSync(edited, 'utf8')}\nHAND EDIT\n`;
    writeFileSync(edited, handEdit);

    const result = run('build-agent-skills.mjs', root);
    assert.equal(result.status, 2, 'a publish over a hand-edit must fail with the destroyed-edit code');
    assert.match(result.stderr, /would have destroyed uncommitted changes/);
    assert.match(
      result.stderr,
      /plugins-claude\/demo\/skills\/alpha\/SKILL\.md \(generated from skills-src\/demo\/alpha\/SKILL\.md\.eta\)/
    );
    assert.equal(readFileSync(edited, 'utf8'), handEdit, 'the hand-edited bytes must survive the refusal');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('build stays green through the template-edit loop, including repeat builds before committing', () => {
  const root = fixture();
  try {
    assert.equal(run('build-agent-skills.mjs', root).status, 0);
    git(root, ['add', '-A']);
    git(root, ['commit', '--quiet', '-m', 'rendered trees']);

    const template = join(root, 'skills-src/demo/alpha/SKILL.md.eta');
    writeFileSync(template, `${readFileSync(template, 'utf8')}\nRevised.\n`);

    const first = run('build-agent-skills.mjs', root);
    assert.equal(first.status, 0, first.stderr);
    const second = run('build-agent-skills.mjs', root);
    assert.equal(second.status, 0, `an idempotent rebuild over uncommitted output must pass:\n${second.stderr}`);
    assert.match(readFileSync(join(root, 'plugins-codex/demo/skills/alpha/SKILL.md'), 'utf8'), /Revised\./);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Build the fixture's trees and commit everything, leaving the repository in
 * the fresh state every freshness-gate scenario starts from.
 * @param {string} root
 */
function buildAndCommit(root) {
  const built = run('build-agent-skills.mjs', root);
  assert.equal(built.status, 0, built.stderr);
  git(root, ['add', '-A']);
  git(root, ['commit', '--quiet', '-m', 'rendered trees']);
}

test('freshness gate passes on a committed fresh render', () => {
  const root = fixture();
  try {
    buildAndCommit(root);
    const result = run('check-generated-tree-freshness.mjs', root, {}, ['skills']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /skills trees fresh/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('freshness gate detects committed drift and advises committing the rebuilt trees', () => {
  const root = fixture();
  try {
    buildAndCommit(root);
    const template = join(root, 'skills-src/demo/alpha/SKILL.md.eta');
    writeFileSync(template, `${readFileSync(template, 'utf8')}\nDrifted.\n`);
    git(root, ['add', '-A']);
    git(root, ['commit', '--quiet', '-m', 'template change without rebuilt trees']);

    const result = run('check-generated-tree-freshness.mjs', root, {}, ['skills']);
    assert.equal(result.status, 1, 'committed drift must turn the gate red');
    assert.match(result.stderr, /rebuild produced output that is not committed/);
    assert.match(result.stderr, /plugins-claude\/demo\/skills\/alpha\/SKILL\.md \(modified\)/);
    assert.match(result.stderr, /commit the rebuilt trees/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('freshness gate turns red on new untracked render output', () => {
  // The primary add-a-skill/add-a-reference workflow: new templates render
  // NEW files, which arrive untracked. A diff-based gate is blind to them
  // and certifies locally what CI then rejects at tag time; the shared
  // predicate counts untracked paths in both gates.
  const root = fixture();
  try {
    buildAndCommit(root);
    writeFileSync(join(root, 'skills-src/demo/alpha/references/extra.md'), '# Extra\n\nNew reference.\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '--quiet', '-m', 'new reference template without rebuilt trees']);

    const result = run('check-generated-tree-freshness.mjs', root, {}, ['skills']);
    assert.equal(result.status, 1, 'a newly rendered untracked file must turn the gate red');
    assert.match(result.stderr, /plugins-claude\/demo\/skills\/alpha\/references\/extra\.md \(new file, untracked\)/);
    assert.match(result.stderr, /commit the rebuilt trees/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('freshness gate never advises committing when the render did not verifiably run', () => {
  const root = fixture();
  try {
    buildAndCommit(root);
    const silent = stub(root, 'stub-silent.js', 'process.exit(0);\n');
    const result = run('check-generated-tree-freshness.mjs', root, { AGENT_SKILLS_CLI: silent }, ['skills']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /did not\ndemonstrably run/);
    assert.doesNotMatch(
      result.stderr,
      /commit the rebuilt trees/,
      'a no-op render must never be advised into a commit'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('freshness gate routes a hand-edit to the template, preserving the edited bytes', () => {
  const root = fixture();
  try {
    buildAndCommit(root);
    const edited = join(root, 'plugins-claude/demo/skills/alpha/SKILL.md');
    const handEdit = `${readFileSync(edited, 'utf8')}\nHAND EDIT\n`;
    writeFileSync(edited, handEdit);

    const result = run('check-generated-tree-freshness.mjs', root, {}, ['skills']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Port the edit into that template/);
    assert.match(result.stderr, /generated from skills-src\/demo\/alpha\/SKILL\.md\.eta/);
    assert.doesNotMatch(result.stderr, /commit the rebuilt trees/);
    assert.equal(readFileSync(edited, 'utf8'), handEdit, 'the gate must observe the hand-edit, not heal it');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('freshness gate hooks suite derives its trees from the build scripts and counts untracked bundle files', () => {
  const root = fixture();
  try {
    const clean = run('check-generated-tree-freshness.mjs', root, {}, ['hooks']);
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(
      clean.stdout,
      /hooks trees fresh: plugins-claude\/demo\/hooks, plugins-codex\/demo\/hooks/,
      'the measured trees must be the ones the scratch replays observed the builds writing'
    );

    writeFileSync(join(root, 'plugins-claude/demo/hooks/stray.mjs'), 'export {};\n');
    const dirty = run('check-generated-tree-freshness.mjs', root, {}, ['hooks']);
    assert.equal(dirty.status, 1, 'an untracked bundle file must turn the hooks gate red');
    assert.match(dirty.stderr, /plugins-claude\/demo\/hooks\/stray\.mjs \(new file, untracked\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('hooks gate goes red when a platform build script is removed from the derivation source', () => {
  const root = fixture();
  try {
    const pkgPath = join(root, 'packages/agent-hooks/package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    delete pkg.scripts['build:codex'];
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    const result = run('check-generated-tree-freshness.mjs', root, {}, ['hooks']);
    assert.equal(result.status, 1, 'a registry platform whose build script disappeared must turn the gate red');
    assert.match(
      result.stderr,
      /registry declares platform "codex" but packages\/agent-hooks has no hook build script/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('hooks gate goes red when a build destination is renamed away from the committed tree', () => {
  const root = fixture();
  try {
    const pkgPath = join(root, 'packages/agent-hooks/package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    pkg.scripts['build:hooks'] = pkg.scripts['build:hooks'].replace('demo/hooks/', 'demo/hooks-renamed/');
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    const result = run('check-generated-tree-freshness.mjs', root, {}, ['hooks']);
    assert.equal(result.status, 1, 'a renamed -o destination must turn the gate red, never drop out of measurement');
    assert.match(result.stderr, /plugins-claude\/demo\/hooks-renamed/);
    assert.match(result.stderr, /do not exist in the working tree/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('hooks gate refuses a hook build for a platform the registry does not declare', () => {
  const root = fixture();
  try {
    const pkgPath = join(root, 'packages/agent-hooks/package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    pkg.scripts['build:antigravity'] =
      'yarn agent-hooks --agent antigravity -i src -o ../../plugins-antigravity/demo/hooks.json';
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    const result = run('check-generated-tree-freshness.mjs', root, {}, ['hooks']);
    assert.equal(result.status, 1, 'a build for an undeclared platform must be reconciled, not silently measured');
    assert.match(result.stderr, /builds hooks for agent "antigravity" but no registry target declares that platform/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('untracked guard diagnoses each file before advising, without a stack trace', () => {
  const root = fixture();
  try {
    buildAndCommit(root);
    // A mapped untracked file (render output the committed tree lacks) and a
    // stray no-template file get opposite advice: only the first may be
    // committed, only the second may be moved out.
    git(root, ['rm', '--cached', '--quiet', 'plugins-claude/demo/skills/alpha/references/notes.md']);
    git(root, ['commit', '--quiet', '-m', 'untrack one rendered file']);
    writeFileSync(join(root, 'plugins-claude/demo/skills/alpha/scratch.txt'), 'stray\n');

    const result = run('build-agent-skills.mjs', root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /references\/notes\.md — new render output \(from skills-src\/demo\/alpha\/references\/notes\.md\); commit it/
    );
    assert.match(result.stderr, /scratch\.txt — NOT render output \(no template maps to it\).*move it out/);
    assert.doesNotMatch(result.stderr, /notes\.md.*move it out/, 'render output must get no delete/move branch');
    assert.doesNotMatch(result.stderr, /\n\s+at /, 'a guard refusal must print as a diagnostic, not a stack trace');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('lint refuses a CLI that produces no version output at all', () => {
  const root = fixture();
  try {
    const silent = stub(root, 'stub-silent.js', 'process.exit(0);\n');
    const result = run('lint-agent-skills.mjs', root, { AGENT_SKILLS_CLI: silent });
    assert.equal(result.status, 1, 'a CLI that never executes must not read as a clean lint');
    assert.match(result.stderr, /did not actually execute/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('lint distinguishes "reported nothing at all" from "these sites are now clean"', () => {
  const root = fixture({ baseline: ['alpha/SKILL.md:1:fake-rule'] });
  try {
    const versionOnly = stub(
      root,
      'stub-version-only.js',
      ["if (process.argv.includes('--version')) console.log('9.9.9');", 'process.exit(0);', ''].join('\n')
    );
    const result = run('lint-agent-skills.mjs', root, { AGENT_SKILLS_CLI: versionOnly });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /reported no diagnostics at all/);
    assert.doesNotMatch(result.stderr, /now clean/, 'a silent linter must not be advised away as a shrunk baseline');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

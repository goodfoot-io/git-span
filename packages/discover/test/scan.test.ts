/**
 * Tests for {@link scanRepo} against a real temporary git repository,
 * covering noise/generated filtering, compiled-sibling detection,
 * `.gitattributes` linguist rules, binary/asset classification, docs-dir
 * inference, and fail-closed behavior on an unreadable tracked file.
 *
 * @summary Tests for scanRepo against a real temp git repository.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { scanRepo } from '../src/scan.js';
import type { DiscoverConfig } from '../src/types.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Discover Test',
  GIT_AUTHOR_EMAIL: 'discover-test@example.com',
  GIT_COMMITTER_NAME: 'Discover Test',
  GIT_COMMITTER_EMAIL: 'discover-test@example.com',
  GIT_AUTHOR_DATE: '2024-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2024-01-01T00:00:00Z'
};

/**
 * Run `git <args>` synchronously in `cwd`, discarding stdio.
 *
 * @param args - Arguments passed directly to git.
 * @param cwd - Directory to run the command in.
 */
function git(args: readonly string[], cwd: string): void {
  execFileSync('git', args, { cwd, env: GIT_ENV, stdio: 'ignore' });
}

/**
 * Write `content` to `root/relPath`, creating parent directories as needed.
 *
 * @param root - Absolute path to the fixture repository root.
 * @param relPath - Repository-relative POSIX path to write.
 * @param content - Raw content for the file.
 */
function writeFixtureFile(root: string, relPath: string, content: string | Buffer): void {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('scanRepo', () => {
  let root: string;
  let config: DiscoverConfig;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-scan-'));
    git(['init', '--initial-branch=main'], root);

    writeFixtureFile(root, 'src/a.ts', 'export const a = 1;\n');
    writeFixtureFile(root, 'lib/x.ts', 'export const x = 1;\n');
    writeFixtureFile(root, 'lib/x.js', 'export const x = 1;\n');
    writeFixtureFile(root, 'gen/marker.ts', '// @generated\nexport const marker = 1;\n');
    writeFixtureFile(root, 'yarn.lock', '# yarn lockfile v1\n');
    writeFixtureFile(root, 'assets/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]));
    writeFixtureFile(root, 'big/huge.txt', 'x'.repeat(200));
    writeFixtureFile(root, '.gitattributes', 'vendor/** linguist-vendored\n');
    writeFixtureFile(root, 'vendor/lib.js', 'module.exports = {};\n');
    writeFixtureFile(root, 'docs/a.md', '# A\n');
    writeFixtureFile(root, 'docs/b.md', '# B\n');
    writeFixtureFile(root, 'docs/c.md', '# C\n');
    writeFixtureFile(root, 'excluded/should-not-appear.ts', 'export const nope = 1;\n');
    fs.symlinkSync('docs', path.join(root, 'link-to-dir'));
    fs.symlinkSync('src/a.ts', path.join(root, 'link-to-file'));
    writeFixtureFile(root, 'attrs-src.txt', '*.js linguist-vendored\n');
    writeFixtureFile(root, 'linked/thing.js', 'module.exports = 1;\n');
    fs.symlinkSync('../attrs-src.txt', path.join(root, 'linked/.gitattributes'));
    fs.mkdirSync(path.join(root, 'sub2'));
    fs.symlinkSync('../docs', path.join(root, 'sub2/.gitattributes'));

    git(['add', '.'], root);
    git(['commit', '-m', 'Add fixture files'], root);

    config = resolveConfig({ exclude: ['excluded'] });
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('includes a normal tracked source file in files and text', () => {
    const scan = scanRepo(root, config);
    expect(scan.files).toContain('src/a.ts');
    expect(scan.text.get('src/a.ts')).toBe('export const a = 1;\n');
    expect(scan.lines.get('src/a.ts')).toEqual(['export const a = 1;', '']);
  });

  it('drops the compiled .js sibling of a .ts source', () => {
    const scan = scanRepo(root, config);
    expect(scan.files).toContain('lib/x.ts');
    expect(scan.files).not.toContain('lib/x.js');
    expect(scan.text.has('lib/x.js')).toBe(false);
  });

  it('drops a file whose head matches a generated-content marker', () => {
    const scan = scanRepo(root, config);
    expect(scan.files).not.toContain('gen/marker.ts');
    expect(scan.text.has('gen/marker.ts')).toBe(false);
  });

  it('drops noise lockfiles by basename', () => {
    const scan = scanRepo(root, config);
    expect(scan.files).not.toContain('yarn.lock');
    expect(scan.text.has('yarn.lock')).toBe(false);
  });

  it('keeps a binary asset in files but not in text', () => {
    const scan = scanRepo(root, config);
    expect(scan.files).toContain('assets/logo.png');
    expect(scan.text.has('assets/logo.png')).toBe(false);
  });

  it('ignores symlinked .gitattributes without crashing or applying rules through them', () => {
    const scan = scanRepo(root, config);
    // The rules behind linked/.gitattributes would vendor-drop *.js; git does
    // not honor symlinked attribute files, so thing.js must survive.
    expect(scan.files).toContain('linked/thing.js');
    expect(scan.text.has('linked/thing.js')).toBe(true);
    // The directory-target link is the EISDIR crash case; it stays a plain
    // referencable entry.
    expect(scan.files).toContain('sub2/.gitattributes');
    expect(scan.text.has('sub2/.gitattributes')).toBe(false);
  });

  it('keeps tracked symlinks referencable without reading through them', () => {
    const scan = scanRepo(root, config);
    expect(scan.files).toContain('link-to-dir');
    expect(scan.files).toContain('link-to-file');
    expect(scan.text.has('link-to-dir')).toBe(false);
    expect(scan.text.has('link-to-file')).toBe(false);
  });

  it('treats an oversize file as binary when maxFileBytes is small', () => {
    const smallConfig = resolveConfig({ exclude: ['excluded'], maxFileBytes: 16 });
    const scan = scanRepo(root, smallConfig);
    expect(scan.files).toContain('big/huge.txt');
    expect(scan.text.has('big/huge.txt')).toBe(false);
  });

  it('keeps an undersize file as scannable text under the default limit', () => {
    const scan = scanRepo(root, config);
    expect(scan.text.get('big/huge.txt')).toBe('x'.repeat(200));
  });

  it('drops a file matched by a linguist-vendored .gitattributes rule', () => {
    const scan = scanRepo(root, config);
    expect(scan.files).not.toContain('vendor/lib.js');
    expect(scan.text.has('vendor/lib.js')).toBe(false);
  });

  it('classifies a directory that is mostly markdown as a docs dir', () => {
    const scan = scanRepo(root, config);
    expect(scan.docsDirs).toContain('docs/');
  });

  it('computes topLevelDirs only from files that survive filtering', () => {
    const scan = scanRepo(root, config);
    expect(scan.topLevelDirs.has('src')).toBe(true);
    expect(scan.topLevelDirs.has('docs')).toBe(true);
    expect(scan.topLevelDirs.has('vendor')).toBe(false);
    expect(scan.topLevelDirs.has('excluded')).toBe(false);
  });

  it('excludes an entire configured prefix from files and text', () => {
    const scan = scanRepo(root, config);
    expect(scan.files.some((file) => file.startsWith('excluded/'))).toBe(false);
    expect(scan.text.has('excluded/should-not-appear.ts')).toBe(false);
  });

  it('sorts files ascending', () => {
    const scan = scanRepo(root, config);
    expect(scan.files).toEqual([...scan.files].sort());
  });

  it('reports the scanned root unchanged', () => {
    const scan = scanRepo(root, config);
    expect(scan.root).toBe(root);
  });

  it('throws when a tracked file is unreadable', () => {
    const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-scan-missing-'));
    try {
      git(['init', '--initial-branch=main'], missingRoot);
      writeFixtureFile(missingRoot, 'ghost.txt', 'boo\n');
      git(['add', '.'], missingRoot);
      git(['commit', '-m', 'Add ghost file'], missingRoot);
      fs.rmSync(path.join(missingRoot, 'ghost.txt'));

      expect(() => scanRepo(missingRoot, resolveConfig())).toThrow();
    } finally {
      fs.rmSync(missingRoot, { recursive: true, force: true });
    }
  });
});

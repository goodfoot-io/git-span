/**
 * Builds a throwaway git repo for the tree-sitter-reference disqualifier test
 * from the static source fixtures in `./src`. Built under the OS temp dir (via
 * `mkdtemp`) rather than under `test/fixtures/` so the nested `.git` is never
 * tracked by this repo — the static `./src` files are the committed fixtures,
 * this builder just assembles them into a real repo whose HEAD the disqualifier
 * can read through `RepoContext.fileAt`.
 *
 * Each fixture is stored with a trailing `.fixture` suffix (e.g.
 * `broken.ts.fixture`) so the repo's TypeScript config and biome — which scan
 * `test` for `.ts` files — never lint or typecheck a deliberately-broken `.ts`
 * fixture; the builder strips the suffix, restoring the real filename
 * (`broken.ts`) the disqualifier keys its grammar selection off of.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'src');
const FIXTURE_SUFFIX = '.fixture';

/**
 * Fixture stored-filenames under `./src`, each committed at the repo root at
 * HEAD under its real name (the stored name with `.fixture` stripped).
 */
const FIXTURE_FILES = [
  'helper.ts.fixture',
  'importer.ts.fixture',
  'alpha.ts.fixture',
  'beta.ts.fixture',
  'broken.ts.fixture',
  'widget.rs.fixture',
  'main.rs.fixture',
  'notes.md.fixture',
  'blob.bin.fixture'
] as const;

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

/** Creates a temp git repo with every fixture file committed at HEAD; returns its path. */
export function buildTreeSitterRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-span-discover-treesitter-'));
  git(dir, ['init', '--quiet', '--initial-branch=main']);
  git(dir, ['config', 'user.email', 'fixture@example.com']);
  git(dir, ['config', 'user.name', 'Fixture Builder']);

  for (const stored of FIXTURE_FILES) {
    const target = stored.slice(0, -FIXTURE_SUFFIX.length);
    fs.copyFileSync(path.join(SRC_DIR, stored), path.join(dir, target));
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '-m', 'Fixture sources']);
  return dir;
}

/** Removes a repo built by {@link buildTreeSitterRepo}. */
export function cleanupTreeSitterRepo(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

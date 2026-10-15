import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const platform = `${process.platform}-${process.arch}`;
const platformName = `git-mora-${platform}`;
const binaryName = process.platform === 'win32' ? 'git-mora.exe' : 'git-mora';
const dir = mkdtempSync(join(tmpdir(), 'git-mora-pack-'));

try {
  for (const [name, archive] of [
    [platformName, resolve(process.argv[2])],
    ['git-mora', resolve(process.argv[3])]
  ]) {
    const dest = join(dir, 'node_modules', name);
    mkdirSync(dest, { recursive: true });
    execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', dest]);
  }
  const meta = join(dir, 'node_modules/git-mora');
  const stub = join(meta, 'bin/git-mora.exe');
  assert.ok(lstatSync(stub).isFile() && !lstatSync(stub).isSymbolicLink());
  const placeholder = readFileSync(stub, 'utf8');
  assert.ok(placeholder.includes('replaces this file') && !placeholder.startsWith('#!') && placeholder.length < 1024);
  execFileSync(process.execPath, [join(meta, 'scripts/postinstall.js')], { cwd: dir, stdio: 'inherit' });
  assert.equal(execFileSync(stub, ['hello-world'], { encoding: 'utf8' }), 'Hello world\n');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  cpSync(stub, join(bin, binaryName));
  assert.equal(
    execFileSync('git', ['mora', 'hello-world'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` }
    }),
    'Hello world\n'
  );
  console.log(`PASS: packed ${platformName} installs and runs through git.`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

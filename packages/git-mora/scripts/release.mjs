import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkVersions } from './versions.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (process.argv.length !== 2) throw new Error('Usage: yarn workspace git-mora release');
const tag = `git-mora-v${checkVersions(root)}`;
if (git('branch', '--show-current') !== 'main') throw new Error('Release git-mora from main.');
if (git('status', '--porcelain')) throw new Error('Commit all changes before releasing.');
git('fetch', 'origin', 'main');
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) throw new Error('Local main must match origin/main.');
if (git('tag', '--list', tag)) throw new Error(`Local tag ${tag} already exists.`);
if (git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`)) throw new Error(`Remote tag ${tag} already exists.`);
git('tag', tag);
git('push', 'origin', `refs/tags/${tag}`);
console.log(`Released ${tag}.`);

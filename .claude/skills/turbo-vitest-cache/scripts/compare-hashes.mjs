#!/usr/bin/env node
// Compare turbo task hashes between two checkouts of the same repo (e.g. main checkout vs worktree).
// Usage: node compare-hashes.mjs <dirA> <dirB> [task=test:uncached]
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const [dirA, dirB, task = 'test:uncached'] = process.argv.slice(2);
if (!dirA || !dirB) {
  console.error('usage: compare-hashes.mjs <dirA> <dirB> [task]');
  process.exit(2);
}

function hashes(dir) {
  const out = execFileSync(join(dir, 'node_modules/.bin/turbo'), ['run', task, '--dry=json'], {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: 1 << 28
  });
  return new Map(JSON.parse(out).tasks.map((t) => [t.taskId, { hash: t.hash, inputs: t.inputs ?? {} }]));
}

const a = hashes(dirA);
const b = hashes(dirB);
let differing = 0;
for (const [id, ta] of a) {
  const tb = b.get(id);
  if (tb?.hash === ta.hash) continue;
  differing++;
  console.log(`DIFF ${id}`);
  const keys = new Set([...Object.keys(ta.inputs), ...Object.keys(tb?.inputs ?? {})]);
  let shown = 0;
  for (const k of keys) {
    if (ta.inputs[k] !== tb?.inputs[k] && shown++ < 10)
      console.log(`   ${k}  ${ta.inputs[k] ?? '-'} vs ${tb?.inputs[k] ?? '-'}`);
  }
}
console.log(`${a.size - differing}/${a.size} task hashes identical`);
process.exit(differing ? 1 : 0);

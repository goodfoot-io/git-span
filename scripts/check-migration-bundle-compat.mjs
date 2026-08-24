#!/usr/bin/env node
// Runtime-API compatibility gate for the migration bundle (card main-386-1).
//
// The bundle targets node20 (the oldest Node any testing installation may run),
// but esbuild enforces SYNTAX only — it happily inlines calls to runtime APIs
// that postdate the target. This scan fails on known post-node20 APIs so a
// dependency refresh (e.g. rkyv-js 0.3.x) cannot silently ship them.
// Extend PATTERNS as new Node releases add APIs; keep patterns tight to avoid
// false positives on unrelated identifiers.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bundle = process.argv[2] ?? join(here, 'dist', 'span-ref-to-tracked-file.cjs');

/** @type {[label: string, pattern: RegExp][]} */
const PATTERNS = [
  ['Array.fromAsync (Node 22)', /\bArray\s*\.\s*fromAsync\b/],
  ['Promise.withResolvers (Node 22)', /\bPromise\s*\.\s*withResolvers\b/],
  ['Object.groupBy (Node 21)', /\bObject\s*\.\s*groupBy\b/],
  ['Map.groupBy (Node 21)', /\bMap\s*\.\s*groupBy\b/],
  ['ArrayBuffer.prototype.transfer (Node 23)', /\bArrayBuffer\s*\.\s*prototype\s*\.\s*transfer\b/],
  ['RegExp.escape (Node 24)', /\bRegExp\s*\.\s*escape\b/],
  ['URL.canParse (Node 22)', /\bURL\s*\.\s*canParse\b/],
  ['Buffer.fromBase64/fromHex (Node 24)', /\bBuffer\s*\.\s*(fromBase64|fromHex)\b/],
  ['process.loadEnvFile (Node 21)', /\bprocess\s*\.\s*loadEnvFile\b/],
  ['module.enableCompileCache (Node 22)', /\bmodule\s*\.\s*enableCompileCache\b/],
  ['fs.glob/globSync (Node 22)', /\bfs\s*\.\s*globSync?\b/]
];

let source;
try {
  source = readFileSync(bundle, 'utf8');
} catch {
  console.error(`check-migration-bundle-compat: cannot read bundle at ${bundle}; run "yarn build:migration" first`);
  process.exit(1);
}

const hits = [];
for (const [label, pattern] of PATTERNS) {
  const match = pattern.exec(source);
  if (match) hits.push(`${label} -> ${JSON.stringify(match[0])}`);
}

if (hits.length > 0) {
  console.error(
    `check-migration-bundle-compat: bundle uses runtime APIs newer than its node20 target:\n  ${hits.join('\n  ')}\nRaise scripts/build-migration.mjs target only with evidence every testing installation runs that Node, or pin the dependency below the offending version.`
  );
  process.exit(1);
}
console.log('check-migration-bundle-compat: no post-node20 runtime APIs found');

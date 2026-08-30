#!/usr/bin/env node
/**
 * Writes the vocabulary glossary (agent-skills-vocabulary.mjs) into every
 * skill template that declares a generated vocab region, following the
 * repository's generated-region pattern (see sync-helper-reference.mjs).
 *
 * A template opts in with a one-line Eta scriptlet region:
 *
 *   <% /* BEGIN GENERATED VOCAB *\/ ... /* END GENERATED VOCAB *\/ %>
 *
 * The interior is replaced with `const vocab = it.variant({...})` built from
 * the glossary, so templates literally consume the shared table — a term can
 * only change in scripts/agent-skills-vocabulary.mjs, and a hand-edited copy
 * fails `--check` (wired into validate.sh and the release workflow).
 *
 * Usage: node scripts/sync-skill-vocabulary.mjs [--check]
 * @module
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vocabulary } from './agent-skills-vocabulary.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BEGIN = '/* BEGIN GENERATED VOCAB */';
const END = '/* END GENERATED VOCAB */';

const generated =
  `${BEGIN} const vocab = it.variant(${JSON.stringify(vocabulary)});` +
  ` /* edit scripts/agent-skills-vocabulary.mjs and run: node scripts/sync-skill-vocabulary.mjs */ ${END}`;

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (entry.name.endsWith('.eta')) files.push(absolute);
  }
  return files;
}

const check = process.argv.includes('--check');
/** @type {string[]} */
const stale = [];
let regions = 0;

for (const file of walk(path.join(repo, 'skills-src'))) {
  const content = readFileSync(file, 'utf8');
  const begin = content.indexOf(BEGIN);
  if (begin === -1) continue;
  const end = content.indexOf(END, begin);
  if (end === -1) {
    console.error(`${path.relative(repo, file)}: BEGIN GENERATED VOCAB without a matching END marker`);
    process.exit(1);
  }
  regions += 1;
  const updated = `${content.slice(0, begin)}${generated}${content.slice(end + END.length)}`;
  if (updated === content) continue;
  if (check) {
    stale.push(path.relative(repo, file));
  } else {
    writeFileSync(file, updated);
    console.log(`synced vocab region: ${path.relative(repo, file)}`);
  }
}

if (regions === 0) {
  console.error('No templates declare a GENERATED VOCAB region — the glossary is wired to nothing.');
  process.exit(1);
}
if (stale.length > 0) {
  console.error(
    `Vocabulary regions are stale in:\n${stale.map((file) => `  ${file}`).join('\n')}\n` +
      `Run: node scripts/sync-skill-vocabulary.mjs (the glossary lives in scripts/agent-skills-vocabulary.mjs).`
  );
  process.exit(1);
}

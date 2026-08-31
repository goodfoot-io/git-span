#!/usr/bin/env node
/**
 * Reconciles every refusal site in the agent-skills gate family against the
 * control that trips it — bidirectionally, the lint-baseline added/stale model
 * applied one level in. A refusal added without a control goes red; a control
 * entry outliving its refusal goes red; so the set of refusals and the set of
 * controls can never silently drift apart again.
 *
 * The measured family is derived, not hand-listed: agent-skills-registry.mjs
 * plus every non-test scripts/*.mjs that imports the registry or the
 * vocabulary module. A refusal site is mechanical: a non-comment line that
 * throws a new Error, calls process.exit with a nonzero status, or calls
 * fail(). Every site carries a `// refusal: <id>` marker (at end of line, or
 * as a standalone comment on the line directly above); a shared emission
 * channel — a line that exits on behalf of already-annotated callers, like
 * fail()'s own exit — opts out with `// refusal-channel`. Markers that sit on
 * nothing are orphans and fail, and a family file enumerating zero sites
 * fails, so the annotations cannot rot into decoration.
 *
 * Each marker id must have exactly one entry in scripts/refusal-coverage.json:
 * either a `control` (a test title that must literally exist in the named
 * suite file) or an `accepted` reason — the reviewed ledger for a refusal no
 * control trips yet.
 *
 * Hermetic tests override the measured tree via REFUSAL_COVERAGE_ROOT and the
 * map via REFUSAL_COVERAGE_MAP.
 *
 * Usage: node scripts/check-refusal-coverage.mjs
 * @module
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.REFUSAL_COVERAGE_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mapPath = process.env.REFUSAL_COVERAGE_MAP ?? path.join(root, 'scripts', 'refusal-coverage.json');
const mapName = path.relative(root, mapPath);

/** @type {string[]} */
const problems = [];

// --- Family derivation -----------------------------------------------------
// The registry module anchors the family; membership for everything else is
// "imports the registry or the vocabulary", so a new gate script joins the
// measured set the moment it is written, with no list to forget to update.
const importPattern = /from\s+['"]\.\/agent-skills-(?:registry|vocabulary)\.mjs['"]/;

/** @type {Map<string, string>} file (repo-relative posix) -> source */
const family = new Map();
for (const entry of readdirSync(path.join(root, 'scripts')).sort()) {
  if (!entry.endsWith('.mjs') || entry.endsWith('.test.mjs')) continue;
  const file = `scripts/${entry}`;
  const source = readFileSync(path.join(root, file), 'utf8');
  if (entry === 'agent-skills-registry.mjs' || importPattern.test(source)) family.set(file, source);
}

if (family.size === 0) {
  process.stderr.write(
    'refusal-coverage: derived an empty gate family — nothing to measure means nothing is policed. Refusing.\n'
  );
  process.exit(1);
}

// --- Site enumeration ------------------------------------------------------
const EOL_MARKER = /\/\/ refusal: ([a-z][a-z0-9-]*)\s*$/;
const CHANNEL_MARKER = /\/\/ refusal-channel\s*$/;

/** @param {string} trimmed @returns {boolean} */
function isCommentLine(trimmed) {
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
}

/**
 * The mechanical refusal predicate. Rethrown foreign errors (`throw x`) and
 * successful exits are not authored refusals and do not match.
 * @param {string} line
 * @returns {boolean}
 */
function isRefusalSite(line) {
  if (/throw new Error\(/.test(line)) return true;
  const exit = /process\.exit\(([^)]*)\)/.exec(line);
  if (exit !== null && exit[1].trim() !== '0') return true;
  if (/(?<![.\w])fail\(/.test(line) && !/function fail\(/.test(line)) return true;
  return false;
}

/** @type {Map<string, Map<string, number>>} file -> id -> line number */
const sitesByFile = new Map();

for (const [file, source] of family) {
  /** @type {Map<string, number>} */
  const ids = new Map();
  sitesByFile.set(file, ids);
  const lines = source.split('\n');
  /** Standalone marker line indices consumed by the site directly below. */
  const consumedStandalone = new Set();
  let siteCount = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    const standalone = /^\/\/ refusal: ([a-z][a-z0-9-]*)$/.exec(trimmed);

    if (isCommentLine(trimmed)) {
      if (standalone !== null && !consumedStandalone.has(i)) {
        const below = lines[i + 1] ?? '';
        if (!isCommentLine(below.trim()) && isRefusalSite(below)) {
          consumedStandalone.add(i);
          recordSite(file, ids, standalone[1], i + 2);
          siteCount += 1;
          i += 1; // the site line is accounted for; do not re-enumerate it
        } else {
          problems.push(
            `${file}:${i + 1}: orphan refusal marker "${standalone[1]}" — no refusal site sits directly below it.`
          );
        }
      }
      continue;
    }

    if (CHANNEL_MARKER.test(line)) {
      if (!isRefusalSite(line)) {
        problems.push(`${file}:${i + 1}: refusal-channel marker on a line that is not a refusal site.`);
      }
      // A channel line exits on behalf of callers that carry their own
      // markers; it is deliberately not a site of its own.
      continue;
    }

    const eol = EOL_MARKER.exec(line);
    if (isRefusalSite(line)) {
      if (eol === null) {
        problems.push(
          `${file}:${i + 1}: refusal site has no "// refusal: <id>" marker — annotate it and give the id a coverage entry in ${mapName}.`
        );
        continue;
      }
      recordSite(file, ids, eol[1], i + 1);
      siteCount += 1;
    } else if (eol !== null) {
      problems.push(`${file}:${i + 1}: orphan refusal marker "${eol[1]}" — the line is not a refusal site.`);
    }
  }

  if (siteCount === 0) {
    problems.push(
      `${file}: enumerated zero refusal sites — the file or the site predicate changed out from under this checker. Refusing the empty enumeration.`
    );
  }
}

/**
 * @param {string} file
 * @param {Map<string, number>} ids
 * @param {string} id
 * @param {number} lineNumber 1-based
 */
function recordSite(file, ids, id, lineNumber) {
  if (ids.has(id)) {
    problems.push(`${file}:${lineNumber}: duplicate refusal id "${id}" (first at line ${ids.get(id)}).`);
    return;
  }
  ids.set(id, lineNumber);
}

// --- Map reconciliation ----------------------------------------------------
/** @type {{files?: Record<string, Record<string, {control?: string, suite?: string, accepted?: string}>>}} */
let map = {};
try {
  map = JSON.parse(readFileSync(mapPath, 'utf8'));
} catch (error) {
  process.stderr.write(
    `refusal-coverage: cannot read ${mapName}: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
}
const mapFiles = map.files ?? {};

for (const file of family.keys()) {
  if (!(file in mapFiles)) {
    problems.push(
      `${file} is in the measured gate family (registry, or an importer of it or the vocabulary) but has no entry in ${mapName}.`
    );
  }
}
for (const file of Object.keys(mapFiles)) {
  if (!family.has(file)) {
    problems.push(`${mapName} lists ${file}, which is not in the measured gate family — remove the stale entry.`);
  }
}

let controlled = 0;
let accepted = 0;
/** @type {Map<string, string>} suite path -> content, read once */
const suiteCache = new Map();

for (const [file, entries] of Object.entries(mapFiles)) {
  const ids = sitesByFile.get(file) ?? new Map();
  for (const id of ids.keys()) {
    if (!(id in entries)) {
      problems.push(
        `${file}: refusal "${id}" has no coverage entry in ${mapName} — add a control, or an accepted entry with the reviewed reason.`
      );
    }
  }
  for (const [id, entry] of Object.entries(entries)) {
    if (!ids.has(id)) {
      problems.push(
        `${mapName}: entry "${id}" for ${file} matches no refusal site — the refusal is gone, so remove the stale entry.`
      );
      continue;
    }
    const hasControl = typeof entry.control === 'string';
    const hasAccepted = typeof entry.accepted === 'string' && entry.accepted.length > 0;
    if (hasControl === hasAccepted) {
      problems.push(`${mapName}: entry "${id}" for ${file} must have exactly one of "control" or "accepted".`);
      continue;
    }
    if (hasAccepted) {
      accepted += 1;
      continue;
    }
    controlled += 1;
    if (typeof entry.suite !== 'string') {
      problems.push(`${mapName}: entry "${id}" for ${file} names a control but no "suite" file to find it in.`);
      continue;
    }
    let suiteSource = suiteCache.get(entry.suite);
    if (suiteSource === undefined) {
      try {
        suiteSource = readFileSync(path.join(root, entry.suite), 'utf8');
      } catch {
        suiteSource = '';
      }
      suiteCache.set(entry.suite, suiteSource);
    }
    if (suiteSource === '') {
      problems.push(
        `${mapName}: entry "${id}" for ${file} names suite ${entry.suite}, which does not exist or is empty.`
      );
      continue;
    }
    if (!suiteSource.includes(`test('${entry.control}'`)) {
      problems.push(
        `${mapName}: control "${entry.control}" for ${file}#${id} not found in ${entry.suite} — ` +
          `expected a literal test('${entry.control}'. A renamed or deleted control must be renamed or replaced here too.`
      );
    }
  }
}

// --- Verdict ---------------------------------------------------------------
if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`);
  process.exit(1);
}

let totalSites = 0;
for (const ids of sitesByFile.values()) totalSites += ids.size;
process.stdout.write(
  `refusal coverage: ${totalSites} sites across ${family.size} gate scripts (${controlled} controlled, ${accepted} accepted)\n`
);

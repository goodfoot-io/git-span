#!/usr/bin/env node
// Generated from skills-src/git-span/hook-effect-analysis/scripts/baseline.mjs by scripts/build-agent-skills.mjs — do not edit; change the template and rebuild.
// The control. A raw hit rate is uninterpretable without one: in the
// analysis that motivated this skill, a figure that looked like a strong
// effect turned out to be about 1.3x chance once compared against files the
// hook never mentioned. This tool is not optional in the documented
// workflow — see SKILL.md — any raw-rate question routes through it first.
//
// Usage:
//   node baseline.mjs [--outcomes=<path>] [--emissions=<path>]
//                      [--activity=<path>] [--placebo-multiplier=<k>]
//                      [--min-records-left=<n>] [--seed=<n>]
//
// Options:
//   --outcomes=<path>          outcomes.mjs output (default: alongside this
//                              script, outcomes.jsonl)
//   --emissions=<path>         collect.mjs's emissions JSONL (default:
//                              alongside this script, emissions.jsonl) —
//                              used to recover each emission's project and
//                              its own (excluded) originating path
//   --activity=<path>          collect.mjs's activity index JSON (default:
//                              alongside this script, activity.json)
//   --placebo-multiplier=<k>   Placebo pool size per emission, as a
//                              multiple of its surfaced-entity count
//                              (default: 3, matching the original analysis)
//   --min-records-left=<n>     Also report the ratio restricted to rows with
//                              at least this much session left, to show it
//                              survives censoring adjustment (default: 200)
//   --seed=<n>                 PRNG seed for placebo sampling (default: 11,
//                              for reproducible runs)
//
// For each emission, samples `k × |surfaced entities|` paths from its
// project's touched-file universe (every repo-relative path any session in
// that project ever Read/Edit/Wrote), excluding the surfaced entities and
// the emission's own originating file. Reports the surfaced-vs-placebo
// touch/write rate, the enrichment ratio (surfaced rate / placebo rate),
// both overall and restricted to --min-records-left, plus simple
// per-predicate crosstabs (rate within a predicate vs rate outside it, both
// against their own placebo).
//
// This deliberately does not fit a multivariate model (the prototype's
// hand-rolled logistic regression had no standard errors and could not say
// which differences were significant) — see references/measurement-pitfalls.md.

import { readFileSync } from "node:fs";
import { argv, stderr } from "node:process";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const flags = {};
for (const a of argv.slice(2)) {
  if (!a.startsWith("--")) continue;
  const [k, v] = a.replace(/^--/, "").split("=");
  flags[k] = v ?? true;
}

const here = dirname(fileURLToPath(import.meta.url));
const OUTCOMES_PATH = flags.outcomes && flags.outcomes !== true ? resolve(String(flags.outcomes)) : resolve(here, "outcomes.jsonl");
const EMISSIONS_PATH = flags.emissions && flags.emissions !== true ? resolve(String(flags.emissions)) : resolve(here, "emissions.jsonl");
const ACTIVITY_PATH = flags.activity && flags.activity !== true ? resolve(String(flags.activity)) : resolve(here, "activity.json");
const K = Number(flags["placebo-multiplier"] ?? 3);
const MIN_RECORDS_LEFT = Number(flags["min-records-left"] ?? 200);
const SEED = Number(flags.seed ?? 11);

function toRepoRelative(filePath, cwd) {
  if (typeof filePath !== "string") return null;
  if (!isAbsolute(filePath)) return filePath;
  if (!cwd) return filePath;
  const rel = relative(cwd, filePath);
  return rel.startsWith("..") ? filePath : rel;
}

// mulberry32 — small deterministic PRNG so runs are reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
function sample(pool, n) {
  const arr = pool.slice();
  const picked = [];
  for (let i = 0; i < n && arr.length > 0; i++) {
    const j = Math.floor(rand() * arr.length);
    picked.push(arr[j]);
    arr.splice(j, 1);
  }
  return picked;
}

const outcomeRows = readFileSync(OUTCOMES_PATH, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const emissions = readFileSync(EMISSIONS_PATH, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const activityIndex = JSON.parse(readFileSync(ACTIVITY_PATH, "utf8"));

// emission key -> {project, originatingPath}
const emissionByKey = new Map();
for (const e of emissions) {
  const key = `${e.session} ${e.toolUseID}`;
  const originatingPath = toRepoRelative(e.toolInput?.file_path ?? e.toolInput?.notebook_path, e.project);
  emissionByKey.set(key, { project: e.project, originatingPath });
}

// project -> Set(repo-relative paths ever touched by any session in that project)
const universeByProject = new Map();
for (const [, { project, entries }] of Object.entries(activityIndex)) {
  if (!project) continue;
  if (!universeByProject.has(project)) universeByProject.set(project, new Set());
  const set = universeByProject.get(project);
  for (const a of entries) set.add(a.path);
}

// Group outcome rows by emission so placebo sampling is per-emission, matching
// the surfaced-entity count it's a multiple of.
const rowsByEmission = new Map();
for (const row of outcomeRows) {
  const key = `${row.session} ${row.toolUseID}`;
  if (!rowsByEmission.has(key)) rowsByEmission.set(key, []);
  rowsByEmission.get(key).push(row);
}

const surfaced = []; // {touched, written, recordsLeft, ...predicateFields}
const placebo = []; // {touched, written, recordsLeft}

for (const [key, rows] of rowsByEmission) {
  const info = emissionByKey.get(key);
  if (!info) continue;
  const universe = universeByProject.get(info.project);
  if (!universe) continue;

  const surfacedPaths = new Set(rows.map((r) => r.entity));
  for (const row of rows) {
    surfaced.push({
      touched: row.touched,
      written: row.written,
      recordsLeft: row.recordsLeft,
      seenBefore: row.seenBefore,
    });
  }

  const pool = [...universe].filter((p) => !surfacedPaths.has(p) && p !== info.originatingPath);
  const picked = sample(pool, K * surfacedPaths.size);
  const recordsLeft = rows[0]?.recordsLeft ?? 0;
  const activityEntries = activityIndex[key.split(" ")[0]]?.entries ?? [];
  const ordinal = rows[0]?.ordinal ?? 0;
  for (const p of picked) {
    const after = activityEntries.filter((a) => a.path === p && a.ordinal > ordinal);
    placebo.push({
      touched: after.length > 0,
      written: after.some((a) => ["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(a.toolName)),
      recordsLeft,
    });
  }
}

function rate(rows, field) {
  if (rows.length === 0) return null;
  return rows.filter((r) => r[field]).length / rows.length;
}
function fmtPct(x) { return x === null ? "n/a" : `${(100 * x).toFixed(1)}%`; }
function fmtRatio(a, b) { return a === null || b === null || b === 0 ? "n/a" : `${(a / b).toFixed(2)}x`; }

function report(label, S, P) {
  const sTouch = rate(S, "touched"), pTouch = rate(P, "touched");
  const sWrite = rate(S, "written"), pWrite = rate(P, "written");
  stderr.write(
    `[${label}] surfaced n=${S.length} touched=${fmtPct(sTouch)} written=${fmtPct(sWrite)}   ` +
    `placebo n=${P.length} touched=${fmtPct(pTouch)} written=${fmtPct(pWrite)}   ` +
    `enrichment(touched)=${fmtRatio(sTouch, pTouch)} enrichment(written)=${fmtRatio(sWrite, pWrite)}\n`,
  );
}

stderr.write(`=== placebo control (k=${K}) ===\n`);
report("all", surfaced, placebo);
report(`records-left>=${MIN_RECORDS_LEFT}`, surfaced.filter((r) => r.recordsLeft >= MIN_RECORDS_LEFT), placebo.filter((r) => r.recordsLeft >= MIN_RECORDS_LEFT));

stderr.write(`\n=== per-predicate crosstabs (touched rate, normalized against own placebo) ===\n`);
for (const [label, pred] of [
  ["seenBefore", (r) => r.seenBefore],
]) {
  const sIn = surfaced.filter(pred), sOut = surfaced.filter((r) => !pred(r));
  stderr.write(`  ${label}:      n=${sIn.length} touched=${fmtPct(rate(sIn, "touched"))}\n`);
  stderr.write(`  not ${label}:  n=${sOut.length} touched=${fmtPct(rate(sOut, "touched"))}\n`);
}

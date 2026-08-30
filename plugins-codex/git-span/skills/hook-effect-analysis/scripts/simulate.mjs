#!/usr/bin/env node
// Generated from skills-src/git-span/hook-effect-analysis/scripts/simulate.mjs by scripts/build-agent-skills.mjs — do not edit; change the template and rebuild.
// Evaluate a candidate suppression rule as a "what if" projection: what
// fraction of characters would a policy have saved, and what fraction of
// the touch/write outcomes outcomes.mjs already measured would it have kept.
// This never applies a policy to already-collected data as a fait accompli
// — it costs a proposal before anyone builds it.
//
// Usage:
//   node simulate.mjs --extract=<module-path> [--policy=<module-path>]
//                      [--outcomes=<path>] [--emissions=<path>]
//
// Options:
//   --extract=<module-path>  Required. Same extractor contract as
//                            outcomes.mjs's --extract, plus a named export
//                            `anchors(emittedText) => [{section, entity,
//                            line}]` giving the exact raw line for each
//                            anchor — needed here for real character costs.
//                            See extractors/git-span.mjs.
//   --policy=<module-path>   A .mjs module whose named exports are
//                            functions `(section, anchor) => boolean`,
//                            where `section = {name, text}` and
//                            `anchor = {entity, line, touched, written,
//                            seenBefore}`. Default: a small built-in set
//                            mirroring the original analysis's policies, as
//                            a runnable usage example.
//   --outcomes=<path>        outcomes.mjs output (default: alongside this
//                            script, outcomes.jsonl)
//   --emissions=<path>       collect.mjs's emissions JSONL (default:
//                            alongside this script, emissions.jsonl) — the
//                            source of the exact emitted text outcomes rows
//                            don't carry.
//
// Reports, per policy: total characters kept vs. the unfiltered baseline,
// and the fraction of touch/write outcomes retained.

import { readFileSync } from "node:fs";
import { argv, exit, stderr } from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const flags = {};
for (const a of argv.slice(2)) {
  if (!a.startsWith("--")) continue;
  const [k, v] = a.replace(/^--/, "").split("=");
  flags[k] = v ?? true;
}

const here = dirname(fileURLToPath(import.meta.url));
if (!flags.extract || flags.extract === true) {
  stderr.write("usage: node simulate.mjs --extract=<module-path> [--policy=<module-path>] [--outcomes=<path>] [--emissions=<path>]\n");
  exit(2);
}
const OUTCOMES_PATH = flags.outcomes && flags.outcomes !== true ? resolve(String(flags.outcomes)) : resolve(here, "outcomes.jsonl");
const EMISSIONS_PATH = flags.emissions && flags.emissions !== true ? resolve(String(flags.emissions)) : resolve(here, "emissions.jsonl");
const EXTRACT_PATH = resolve(String(flags.extract));
const POLICY_PATH = flags.policy && flags.policy !== true ? resolve(String(flags.policy)) : resolve(here, "policies", "default.mjs");

const { anchors: extractAnchors } = await import(pathToFileURL(EXTRACT_PATH).href);
if (typeof extractAnchors !== "function") {
  stderr.write(`error: ${EXTRACT_PATH} does not export a named 'anchors' function — simulate.mjs needs line-level anchor detail (see extractors/git-span.mjs)\n`);
  exit(1);
}
const policyModule = await import(pathToFileURL(POLICY_PATH).href);
const policies = Object.entries(policyModule).filter(([, v]) => typeof v === "function");
if (policies.length === 0) {
  stderr.write(`error: ${POLICY_PATH} exports no policy functions\n`);
  exit(1);
}

const outcomeRows = readFileSync(OUTCOMES_PATH, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const emissions = readFileSync(EMISSIONS_PATH, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

// (session, toolUseID, entity) -> outcome row, for attaching touched/written/seenBefore to anchors.
const outcomeByKey = new Map();
for (const row of outcomeRows) {
  outcomeByKey.set(`${row.session} ${row.toolUseID} ${row.entity}`, row);
}

// Build one emission record per hook emission with real text: {chars,
// sections: [{name, text, anchors: [{entity, line, touched, written,
// seenBefore}]}], overhead}.
const parsedEmissions = [];
for (const e of emissions) {
  if (typeof e.stdout !== "string" || !e.stdout.trim()) continue;
  let additionalContext;
  try {
    additionalContext = JSON.parse(e.stdout)?.hookSpecificOutput?.additionalContext;
  } catch {
    continue;
  }
  if (!additionalContext) continue;

  const rawAnchors = extractAnchors(additionalContext);
  if (rawAnchors.length === 0) continue;

  const sectionTexts = additionalContext.split(/(?=^## )/m).filter((s) => s.startsWith("## "));
  const sections = sectionTexts.map((text) => ({ name: text.slice(3).split("\n")[0].trim(), text, anchors: [] }));
  const byName = new Map(sections.map((s) => [s.name, s]));
  for (const a of rawAnchors) {
    const outcome = outcomeByKey.get(`${e.session} ${e.toolUseID} ${a.entity}`);
    const section = byName.get(a.section);
    if (!section) continue;
    section.anchors.push({
      entity: a.entity,
      line: a.line,
      touched: outcome?.touched ?? false,
      written: outcome?.written ?? false,
      seenBefore: outcome?.seenBefore ?? false,
    });
  }
  const sectionCharTotal = sections.reduce((s, sec) => s + sec.text.length, 0);
  parsedEmissions.push({
    chars: additionalContext.length,
    overhead: additionalContext.length - sectionCharTotal,
    sections,
  });
}

const TOTAL_CHARS = parsedEmissions.reduce((s, e) => s + e.chars, 0);
const TOTAL_WRITES = parsedEmissions.reduce((s, e) => s + e.sections.reduce((s2, sec) => s2 + sec.anchors.filter((a) => a.written).length, 0), 0);
const TOTAL_TOUCH = parsedEmissions.reduce((s, e) => s + e.sections.reduce((s2, sec) => s2 + sec.anchors.filter((a) => a.touched).length, 0), 0);

stderr.write(`population: ${parsedEmissions.length} emissions, ${TOTAL_CHARS} chars, ${TOTAL_WRITES} write-outcomes, ${TOTAL_TOUCH} touch-outcomes\n\n`);

for (const [name, keep] of policies) {
  let chars = 0, writes = 0, touch = 0;
  for (const e of parsedEmissions) {
    let keptAnySection = false;
    for (const sec of e.sections) {
      const kept = sec.anchors.filter((a) => keep(sec, a));
      const dropped = sec.anchors.filter((a) => !keep(sec, a));
      if (kept.length === 0) continue;
      keptAnySection = true;
      chars += sec.text.length - dropped.reduce((s, a) => s + a.line.length + 1, 0);
      for (const a of kept) {
        if (a.written) writes++;
        if (a.touched) touch++;
      }
    }
    if (keptAnySection) chars += e.overhead;
  }
  const savedPct = TOTAL_CHARS ? 100 * (1 - chars / TOTAL_CHARS) : 0;
  const writesPct = TOTAL_WRITES ? 100 * writes / TOTAL_WRITES : 0;
  const touchPct = TOTAL_TOUCH ? 100 * touch / TOTAL_TOUCH : 0;
  stderr.write(`${name.padEnd(30)} chars=${String(chars).padStart(8)} saved=${savedPct.toFixed(0).padStart(3)}%  writes=${String(writes).padStart(5)} kept=${writesPct.toFixed(0).padStart(3)}%  touch kept=${touchPct.toFixed(0).padStart(3)}%\n`);
}

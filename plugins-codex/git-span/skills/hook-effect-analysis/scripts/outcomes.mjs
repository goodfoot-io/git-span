#!/usr/bin/env node
// Join collect.mjs's emissions to the activity that followed them, producing
// one row per (emission, entity) with the corrections that are easy to miss
// and that silently invert the answer — self-reference exclusion, ordering,
// and censoring. These are this tool's responsibility, not the caller's:
// there is no flag to skip them and no code path that produces a row
// without them applied.
//
// Usage:
//   node outcomes.mjs --extract=<module-path> [--emissions=<path>]
//                      [--activity=<path>] [--out=<path>]
//
// Options:
//   --extract=<module-path>  Required. A .mjs module whose default export is
//                            a function (emittedText) => string[] pulling
//                            repo-relative entity paths out of a hook's
//                            emitted text. See extractors/git-span.mjs for a
//                            worked example. Nothing in this script knows
//                            what a span is — the extractor is the only
//                            place that can.
//   --emissions=<path>       collect.mjs's emissions JSONL (default:
//                            alongside this script, emissions.jsonl)
//   --activity=<path>        collect.mjs's activity index JSON (default:
//                            alongside this script, activity.json)
//   --out=<path>             Output path (default: alongside this script,
//                            outcomes.jsonl)
//
// For each emission, for each entity the extractor pulls out of its emitted
// text:
//   - excludes the entity if it equals the originating tool call's own file
//     (repo-relative comparison) — the entity a hook names is not credited
//     for the file already open in front of the agent.
//   - looks up activity for that exact path with ordinal > emission.ordinal
//     for touched/written, and ordinal < emission.ordinal for seenBefore —
//     activity before the emission is not a later outcome.
//   - reports recordsLeft = sessionLength - emission.ordinal on every row.
//     A low-opportunity row is never silently scored as a failure here;
//     baseline.mjs and references/ are where that judgment call is made.
//
// Output: one JSON object per line —
//   {session, hookName, toolUseID, entity, touched, written, seenBefore,
//    recordsLeft, ordinal}

import { readFileSync, writeFileSync } from "node:fs";
import { argv, exit, stderr } from "node:process";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const flags = {};
for (const a of argv.slice(2)) {
  if (!a.startsWith("--")) continue;
  const [k, v] = a.replace(/^--/, "").split("=");
  flags[k] = v ?? true;
}

const here = dirname(fileURLToPath(import.meta.url));
if (!flags.extract || flags.extract === true) {
  stderr.write("usage: node outcomes.mjs --extract=<module-path> [--emissions=<path>] [--activity=<path>] [--out=<path>]\n");
  exit(2);
}
const EMISSIONS_PATH = flags.emissions && flags.emissions !== true ? resolve(String(flags.emissions)) : resolve(here, "emissions.jsonl");
const ACTIVITY_PATH = flags.activity && flags.activity !== true ? resolve(String(flags.activity)) : resolve(here, "activity.json");
const OUT_PATH = flags.out && flags.out !== true ? resolve(String(flags.out)) : resolve(here, "outcomes.jsonl");
const EXTRACT_PATH = resolve(String(flags.extract));

const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

function toRepoRelative(filePath, cwd) {
  if (typeof filePath !== "string") return null;
  if (!isAbsolute(filePath)) return filePath;
  if (!cwd) return filePath;
  const rel = relative(cwd, filePath);
  return rel.startsWith("..") ? filePath : rel;
}

const { default: extract } = await import(pathToFileURL(EXTRACT_PATH).href);

const activityIndex = JSON.parse(readFileSync(ACTIVITY_PATH, "utf8"));
const emissionLines = readFileSync(EMISSIONS_PATH, "utf8").split("\n").filter(Boolean);

const out = [];
let skippedNoText = 0;

for (const line of emissionLines) {
  const emission = JSON.parse(line);
  const activity = activityIndex[emission.session]?.entries ?? [];

  let additionalContext = null;
  if (typeof emission.stdout === "string" && emission.stdout.trim()) {
    try {
      additionalContext = JSON.parse(emission.stdout)?.hookSpecificOutput?.additionalContext ?? null;
    } catch {
      additionalContext = null;
    }
  }
  if (!additionalContext) { skippedNoText++; continue; } // no text to extract entities from — not an error

  const originatingRaw = emission.toolInput?.file_path ?? emission.toolInput?.notebook_path;
  const originatingPath = toRepoRelative(originatingRaw, emission.project);

  const entities = extract(additionalContext);
  for (const entity of entities) {
    if (originatingPath !== null && entity === originatingPath) continue; // structural self-exclusion — no caller opt-out

    const after = activity.filter((a) => a.path === entity && a.ordinal > emission.ordinal);
    const before = activity.some((a) => a.path === entity && a.ordinal < emission.ordinal);

    out.push({
      session: emission.session,
      hookName: emission.hookName,
      toolUseID: emission.toolUseID,
      entity,
      touched: after.length > 0,
      written: after.some((a) => WRITE_TOOLS.has(a.toolName)),
      seenBefore: before,
      recordsLeft: emission.sessionLength - emission.ordinal,
      ordinal: emission.ordinal,
    });
  }
}

writeFileSync(OUT_PATH, out.map((r) => JSON.stringify(r)).join("\n") + (out.length ? "\n" : ""));
stderr.write(`${emissionLines.length} emissions read, ${skippedNoText} without extractable text, ${out.length} outcome rows written\noutcomes: ${OUT_PATH}\n`);

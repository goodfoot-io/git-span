#!/usr/bin/env node
// Walk Claude Code session transcripts — local or a remote host over ssh —
// and normalise every hook emission into one JSON-lines intermediate that
// outcomes.mjs / baseline.mjs / simulate.mjs all consume. This is the single
// transcript-parsing choke point: no other script in this skill re-walks the
// transcript store, so a 1.2 GB corpus is parsed once, not once per question.
//
// Usage:
//   node collect.mjs [--root=<path>] [--host=<ssh-host>] [--hook=<name>...]
//                     [--out=<path>] [--activity-out=<path>]
//
// Options:
//   --root=<path>          Local transcript root (default: ~/.claude/projects)
//   --host=<ssh-host>      Read transcripts from a remote host over ssh
//                          instead of --root. The remote root is resolved to
//                          an absolute path on the remote before globbing
//                          (never `~` and shell expansion under a
//                          non-interactive ssh, which silently reads as an
//                          empty corpus) and a failed ssh/tar is reported as
//                          an error distinct from "found nothing".
//   --hook=<name>          Only emissions whose attachment.hookName equals
//                          this value. Repeatable. Default: every hookName
//                          seen — filtering by hook is the caller's job, not
//                          this tool's, so nothing here knows what a span is.
//   --out=<path>           Emissions JSONL output (default: alongside this
//                          script, emissions.jsonl)
//   --activity-out=<path>  Activity index JSON output (default: alongside
//                          this script, activity.json)
//
// Output (emissions.jsonl): one JSON object per line —
//   {session, project, hookName, toolUseID, toolName, toolInput, ordinal,
//    sessionLength, stdout, isSidechain, agentId}
// A missing attachment.stdout is recorded as stdout: null; an empty string
// is kept as "" — the two are different states (see
// references/measurement-pitfalls.md) and conflating them is one of the
// errors this tool exists to prevent.
//
// Output (activity.json): {"<session>": {project, entries: [{ordinal, path,
// toolName}, ...]}} — one entry per Read/Edit/Write/MultiEdit/NotebookEdit
// tool call in that session, path resolved to repo-relative using the
// transcript's own `cwd` field (recorded as `project` alongside so
// baseline.mjs can group sessions into a project's touched-file universe
// without re-deriving it). outcomes.mjs and baseline.mjs answer "was this
// path touched" against this index instead of re-parsing a transcript.

import { readFileSync, writeFileSync, mkdtempSync, rmSync, openSync, closeSync, globSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { argv, exit, stderr } from "node:process";
import { homedir, tmpdir } from "node:os";
import { dirname, resolve, relative, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

// ─── args ────────────────────────────────────────────────────────────────────

const positional = [];
const flags = {};
for (const a of argv.slice(2)) {
  if (!a.startsWith("--")) { positional.push(a); continue; }
  const [k, v] = a.replace(/^--/, "").split("=");
  if (k === "hook") {
    (flags.hook ??= []).push(v ?? true);
  } else {
    flags[k] = v ?? true;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = flags.out && flags.out !== true ? resolve(String(flags.out)) : resolve(here, "emissions.jsonl");
const ACTIVITY_OUT_PATH = flags["activity-out"] && flags["activity-out"] !== true
  ? resolve(String(flags["activity-out"]))
  : resolve(here, "activity.json");
const HOOK_FILTER = flags.hook ? new Set(flags.hook.map(String)) : null;
const HOST = flags.host && flags.host !== true ? String(flags.host) : null;

const READ_TOOLS = new Set(["Read"]);
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const ACTIVITY_TOOLS = new Set([...READ_TOOLS, ...WRITE_TOOLS]);

// ─── resolve transcript root ─────────────────────────────────────────────────

let ROOT;
let cleanupDir = null;

if (HOST) {
  // Resolve the remote root to an absolute path first — passing `~` through
  // and assuming shell expansion under a non-interactive `ssh` is exactly
  // the bug recorded in references/measurement-pitfalls.md: it silently
  // reads as "the corpus is empty" when the ssh session starts in a
  // different directory.
  const echoResult = spawnSync("ssh", [HOST, "echo $HOME/.claude/projects"], { encoding: "utf8" });
  if (echoResult.status !== 0) {
    stderr.write(`error: could not resolve remote transcript root on ${HOST}: ${echoResult.stderr || echoResult.error}\n`);
    exit(1);
  }
  const remoteRoot = echoResult.stdout.trim();
  if (!remoteRoot) {
    stderr.write(`error: remote root resolved empty on ${HOST} (is $HOME set?)\n`);
    exit(1);
  }

  cleanupDir = mkdtempSync(join(tmpdir(), "hook-effect-analysis-"));
  const tarPath = join(cleanupDir, "transcripts.tar");
  const fd = openSync(tarPath, "w");
  // Single ssh + tar round trip instead of one ssh call per file — a corpus
  // can be thousands of files, and per-file ssh calls would dominate runtime.
  const tarResult = spawnSync(
    "ssh",
    [HOST, `tar -C '${remoteRoot.replace(/'/g, "'\\''")}' -cf - --exclude='*.tmp' .`],
    { stdio: ["ignore", fd, "pipe"] },
  );
  closeSync(fd);
  if (tarResult.status !== 0) {
    // Distinguish "ssh/tar failed" from "found nothing" — a missing `tar` on
    // the remote host, a dead host, or a bad key must not read as an empty
    // corpus. See references/measurement-pitfalls.md.
    rmSync(cleanupDir, { recursive: true, force: true });
    stderr.write(`error: remote tar of ${remoteRoot} on ${HOST} failed (exit ${tarResult.status}): ${tarResult.stderr}\n`);
    exit(1);
  }

  const extractDir = join(cleanupDir, "extracted");
  execFileSync("mkdir", ["-p", extractDir]);
  const extractResult = spawnSync("tar", ["-xf", tarPath, "-C", extractDir]);
  if (extractResult.status !== 0) {
    rmSync(cleanupDir, { recursive: true, force: true });
    stderr.write(`error: extracting transcripts fetched from ${HOST} failed: ${extractResult.stderr}\n`);
    exit(1);
  }
  ROOT = extractDir;
} else {
  ROOT = flags.root && flags.root !== true ? resolve(String(flags.root)) : resolve(homedir(), ".claude", "projects");
}

// ─── walk transcripts ────────────────────────────────────────────────────────

const files = globSync("**/*.jsonl", { cwd: ROOT }).sort();

if (files.length === 0) {
  // A genuinely empty corpus is a real, reportable outcome — distinct from
  // the ssh/tar failures above, which already exited non-zero.
  stderr.write(`no *.jsonl transcripts found under ${ROOT}\n`);
}

const emissionsOut = [];
const activityIndex = {};
let totalAttachments = 0;
let joined = 0;
let deduped = 0;

for (const relFile of files) {
  const absFile = join(ROOT, relFile);
  const session = relFile;
  let text;
  try {
    text = readFileSync(absFile, "utf8");
  } catch (e) {
    stderr.write(`warning: could not read ${absFile}: ${e.message}\n`);
    continue;
  }

  const records = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // Malformed line — skip it, not the whole transcript.
    }
  }
  const N = records.length;

  // tool_use records live in message.content[]; build id -> {ordinal, name,
  // input, cwd} so attachment.toolUseID can join by id rather than scanning
  // backwards for the nearest Read (which misattributes offset/limit on
  // records interleaved with other tool calls).
  const toolUseById = new Map();
  const activity = [];
  let lastCwd = null;

  for (let ordinal = 0; ordinal < N; ordinal++) {
    const rec = records[ordinal];
    if (typeof rec.cwd === "string") lastCwd = rec.cwd;
    const content = rec.message && rec.message.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (!item || item.type !== "tool_use") continue;
      const input = item.input ?? {};
      toolUseById.set(item.id, { ordinal, name: item.name, input, cwd: lastCwd });
      if (ACTIVITY_TOOLS.has(item.name)) {
        const fp = input.file_path ?? input.notebook_path;
        if (typeof fp === "string") {
          activity.push({ ordinal, path: toRepoRelative(fp, lastCwd), toolName: item.name });
        }
      }
    }
  }
  activityIndex[session] = { project: lastCwd, entries: activity };

  const seen = new Set();
  for (const rec of records) {
    if (rec.type !== "attachment") continue;
    const a = rec.attachment ?? {};
    const hookName = a.hookName;
    if (!hookName) continue;
    totalAttachments++;
    if (HOOK_FILTER && !HOOK_FILTER.has(hookName)) continue;

    const toolUseID = a.toolUseID;
    const dedupeKey = `${session} ${toolUseID} ${hookName}`;
    if (seen.has(dedupeKey)) { deduped++; continue; }
    seen.add(dedupeKey);

    const tu = toolUseById.get(toolUseID);
    if (!tu) continue; // no originating tool call in this transcript — zero join, not an error
    joined++;

    emissionsOut.push({
      session,
      project: tu.cwd,
      hookName,
      toolUseID,
      toolName: tu.name,
      toolInput: tu.input,
      ordinal: tu.ordinal,
      sessionLength: N,
      stdout: a.stdout === undefined ? null : a.stdout,
      isSidechain: Boolean(rec.isSidechain),
      agentId: rec.agentId ?? null,
    });
  }
}

function toRepoRelative(filePath, cwd) {
  if (!isAbsolute(filePath)) return filePath;
  if (!cwd) return filePath;
  const rel = relative(cwd, filePath);
  return rel.startsWith("..") ? filePath : rel;
}

writeFileSync(OUT_PATH, emissionsOut.map((e) => JSON.stringify(e)).join("\n") + (emissionsOut.length ? "\n" : ""));
writeFileSync(ACTIVITY_OUT_PATH, JSON.stringify(activityIndex));

if (cleanupDir) rmSync(cleanupDir, { recursive: true, force: true });

stderr.write(
  `${files.length} transcripts, ${totalAttachments} attachments seen, ${deduped} deduped, ${emissionsOut.length} emissions written\n` +
  `emissions: ${OUT_PATH}\nactivity index: ${ACTIVITY_OUT_PATH}\n`,
);

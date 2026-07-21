#!/usr/bin/env -S node --enable-source-maps
// ../../node_modules/@goodfoot/codex-hooks/dist/constants.js
var EVENTS_WITH_TEXT_OUTPUT = /* @__PURE__ */ new Set(["SessionStart", "UserPromptSubmit", "SubagentStart"]);

// ../../node_modules/@goodfoot/codex-hooks/dist/hooks.js
function attachMetadata(hookEventName, config, handler) {
  const hook = handler;
  hook.hookEventName = hookEventName;
  hook.timeout = config.timeout;
  hook.statusMessage = config.statusMessage;
  if ("matcher" in config && typeof config.matcher === "string") {
    hook.matcher = config.matcher;
  }
  return hook;
}
function preToolUseHook(config, handler) {
  return attachMetadata("PreToolUse", config, handler);
}

// ../../node_modules/@goodfoot/codex-hooks/dist/logger.js
import { closeSync, existsSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";
var DEFAULT_LOG_ENV_VAR = "CODEX_HOOKS_LOG_FILE";
var Logger = class {
  handlers = /* @__PURE__ */ new Map();
  fileInitialized = false;
  logFileFd = null;
  logFilePath = null;
  currentHookType;
  currentInput;
  constructor(config = {}) {
    this.logFilePath = config.logFilePath ?? process.env[config.logEnvVar ?? DEFAULT_LOG_ENV_VAR] ?? null;
  }
  setContext(hookType, input) {
    this.currentHookType = hookType;
    this.currentInput = input;
  }
  clearContext() {
    this.currentHookType = void 0;
    this.currentInput = void 0;
  }
  on(level, handler) {
    const existing = this.handlers.get(level) ?? /* @__PURE__ */ new Set();
    existing.add(handler);
    this.handlers.set(level, existing);
    return () => {
      existing.delete(handler);
      if (existing.size === 0) {
        this.handlers.delete(level);
      }
    };
  }
  debug(message, context) {
    this.emit("debug", message, context);
  }
  info(message, context) {
    this.emit("info", message, context);
  }
  warn(message, context) {
    this.emit("warn", message, context);
  }
  error(message, context) {
    this.emit("error", message, context);
  }
  logError(error, message, context) {
    this.emit("error", `${message}: ${error instanceof Error ? error.message : String(error)}`, context);
  }
  close() {
    if (this.logFileFd !== null) {
      closeSync(this.logFileFd);
      this.logFileFd = null;
    }
  }
  emit(level, message, context) {
    const event = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      hookType: this.currentHookType,
      message,
      ...this.currentInput !== void 0 ? { input: this.currentInput } : {},
      ...context !== void 0 ? { context } : {}
    };
    this.writeToFile(event);
    this.handlers.get(level)?.forEach((handler) => {
      handler(event);
    });
  }
  writeToFile(event) {
    if (this.logFilePath === null) {
      return;
    }
    if (!this.fileInitialized) {
      this.fileInitialized = true;
      const logDir = dirname(this.logFilePath);
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }
      this.logFileFd = openSync(this.logFilePath, "a");
    }
    if (this.logFileFd !== null) {
      writeSync(this.logFileFd, `${JSON.stringify(event)}
`);
    }
  }
};
var logger = new Logger();

// ../../node_modules/@goodfoot/codex-hooks/dist/outputs.js
var EXIT_CODES = {
  SUCCESS: 0,
  ERROR: 1,
  BLOCK: 2
};
var BlockError = class extends Error {
  reason;
  constructor(reason) {
    super(reason);
    this.name = "BlockError";
    this.reason = reason;
  }
};
function omitUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== void 0));
}
function buildOutput(type, stdout, stderr) {
  return {
    _type: type,
    stdout: omitUndefined(stdout),
    ...stderr !== void 0 ? { stderr } : {}
  };
}
function preToolUseOutput(options = {}) {
  const hasSpecific = options.additionalContext !== void 0 || options.permissionDecision !== void 0 || options.permissionDecisionReason !== void 0 || options.updatedInput !== void 0;
  const hookSpecificOutput = hasSpecific ? omitUndefined({
    hookEventName: "PreToolUse",
    additionalContext: options.additionalContext,
    permissionDecision: options.permissionDecision,
    permissionDecisionReason: options.permissionDecisionReason,
    updatedInput: options.updatedInput
  }) : void 0;
  return buildOutput("PreToolUse", {
    continue: options.continue,
    stopReason: options.stopReason,
    suppressOutput: options.suppressOutput,
    systemMessage: options.systemMessage,
    decision: options.decision,
    reason: options.reason,
    hookSpecificOutput
  });
}
function userPromptSubmitOutput(options = {}) {
  const hookSpecificOutput = options.additionalContext !== void 0 ? {
    hookEventName: "UserPromptSubmit",
    additionalContext: options.additionalContext
  } : void 0;
  return buildOutput("UserPromptSubmit", {
    continue: options.continue,
    stopReason: options.stopReason,
    suppressOutput: options.suppressOutput,
    systemMessage: options.systemMessage,
    decision: options.decision,
    reason: options.reason,
    hookSpecificOutput
  });
}
function sessionStartOutput(options = {}) {
  const hookSpecificOutput = options.additionalContext !== void 0 ? {
    hookEventName: "SessionStart",
    additionalContext: options.additionalContext
  } : void 0;
  return buildOutput("SessionStart", {
    continue: options.continue,
    stopReason: options.stopReason,
    suppressOutput: options.suppressOutput,
    systemMessage: options.systemMessage,
    hookSpecificOutput
  });
}
function subagentStartOutput(options = {}) {
  const hookSpecificOutput = options.additionalContext !== void 0 ? {
    hookEventName: "SubagentStart",
    additionalContext: options.additionalContext
  } : void 0;
  return buildOutput("SubagentStart", {
    continue: options.continue,
    stopReason: options.stopReason,
    suppressOutput: options.suppressOutput,
    systemMessage: options.systemMessage,
    hookSpecificOutput
  });
}

// ../../node_modules/@goodfoot/codex-hooks/dist/runtime.js
async function readStdin() {
  return new Promise((resolve2, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve2(chunks.join("")));
    process.stdin.on("error", reject);
  });
}
function parseStdinInput(stdinContent) {
  return JSON.parse(stdinContent);
}
function writeStdout(output) {
  process.stdout.write(JSON.stringify(output.stdout));
}
function normalizeStringOutput(hookEventName, result) {
  if (!EVENTS_WITH_TEXT_OUTPUT.has(hookEventName)) {
    throw new Error(`${hookEventName} hooks cannot return plain text`);
  }
  if (hookEventName === "SessionStart") {
    return sessionStartOutput({ additionalContext: result });
  }
  if (hookEventName === "SubagentStart") {
    return subagentStartOutput({ additionalContext: result });
  }
  return userPromptSubmitOutput({ additionalContext: result });
}
function convertToHookOutput(output) {
  return output.stderr !== void 0 ? { stdout: output.stdout, stderr: output.stderr } : { stdout: output.stdout };
}
async function execute(hookFn) {
  try {
    const stdinContent = await readStdin();
    const input = parseStdinInput(stdinContent);
    logger.setContext(hookFn.hookEventName, input);
    const context = { logger };
    const result = await hookFn(input, context);
    let output = { stdout: {} };
    if (typeof result === "string") {
      output = convertToHookOutput(normalizeStringOutput(hookFn.hookEventName, result));
    } else if (result !== void 0) {
      output = convertToHookOutput(result);
    }
    writeStdout(output);
    process.exit(EXIT_CODES.SUCCESS);
  } catch (error) {
    if (error instanceof BlockError) {
      process.stderr.write(`${error.reason}
`);
      process.exit(EXIT_CODES.BLOCK);
    }
    if (error instanceof Error) {
      process.stderr.write(`${error.stack ?? error.message}
`);
    } else {
      process.stderr.write(`${String(error)}
`);
    }
    process.exit(EXIT_CODES.ERROR);
  } finally {
    logger.clearContext();
    logger.close();
  }
}

// src/common/gate-core.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs4 from "node:fs";
import * as nodePath4 from "node:path";

// src/common/agent-hooks-common.ts
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
function toPosix(p) {
  return p.replace(/\\/g, "/");
}
function resolveRepoRoot(dir) {
  if (!dir) return null;
  try {
    const out = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8"
    });
    const trimmed = out.trim();
    return trimmed.length > 0 ? toPosix(trimmed) : null;
  } catch {
    return null;
  }
}
var SPAN_ROOT = ".span";
function isInsideSpanRoot(repoRelPath, spanRoot = SPAN_ROOT) {
  const root = spanRoot.replace(/\/+$/, "");
  return repoRelPath === root || repoRelPath.startsWith(`${root}/`);
}
function parsePorcelain(stdout) {
  const rows = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("	");
    if (parts.length < 3) continue;
    const [name, path, range] = parts;
    const dashIdx = range.indexOf("-");
    if (dashIdx === -1) continue;
    const start = parseInt(range.slice(0, dashIdx), 10);
    const end = parseInt(range.slice(dashIdx + 1), 10);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    rows.push({ name, path, start, end });
  }
  return rows;
}
var PORCELAIN_STATUSES = [
  "FRESH",
  "RESOLVED_PENDING_COMMIT",
  "MOVED",
  "CHANGED",
  "DELETED",
  "CONFLICT",
  "SUBMODULE",
  "LFS_NOT_FETCHED",
  "LFS_NOT_INSTALLED",
  "PROMISOR_MISSING",
  "SPARSE_EXCLUDED",
  "FILTER_FAILED",
  "IO_ERROR"
];
var PORCELAIN_STATUS_SET = new Set(PORCELAIN_STATUSES);
function parsePorcelainStatus(raw) {
  return PORCELAIN_STATUS_SET.has(raw) ? raw : null;
}
function isDebt(status) {
  switch (status) {
    case "FRESH":
    case "MOVED":
    case "RESOLVED_PENDING_COMMIT":
      return false;
    default:
      return true;
  }
}
function isEnvironmentalStatus(status) {
  switch (status) {
    case "CONFLICT":
    case "SUBMODULE":
    case "LFS_NOT_FETCHED":
    case "LFS_NOT_INSTALLED":
    case "PROMISOR_MISSING":
    case "SPARSE_EXCLUDED":
    case "FILTER_FAILED":
    case "IO_ERROR":
      return true;
    default:
      return false;
  }
}
function parseStalePorcelain(stdout) {
  const rows = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("	");
    if (parts.length < 6) continue;
    const [statusCol, , name, path, startCol, endCol] = parts;
    const status = parsePorcelainStatus(statusCol);
    if (!status) continue;
    const start = startCol === "(whole)" ? 0 : parseInt(startCol, 10);
    const end = endCol === "-" ? 0 : parseInt(endCol, 10);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    rows.push({ name, path, start, end, status });
  }
  return rows;
}
var SESSION_BASE_DIR = nodePath.join(os.homedir(), ".cache", "git-span", "session");
var THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1e3;
function resolveGitCommonDir(repoRoot) {
  const out = execFileSync("git", ["-C", repoRoot, "rev-parse", "--git-common-dir"], {
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8"
  });
  const trimmed = toPosix(out.trim());
  if (!nodePath.isAbsolute(trimmed)) {
    return toPosix(nodePath.resolve(repoRoot, trimmed));
  }
  return trimmed;
}
function queueRoot(repoRoot) {
  return nodePath.join(resolveGitCommonDir(repoRoot), "git-span");
}
function gateMemoDir(repoRoot) {
  return nodePath.join(queueRoot(repoRoot), "gate");
}

// src/common/gate-ignore.ts
import * as fs3 from "node:fs";
import * as nodePath3 from "node:path";

// src/common/span-ignore.ts
import * as fs2 from "node:fs";
import * as nodePath2 from "node:path";
var HOOK_IGNORE_REL = nodePath2.join(".span", ".hookignore");
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}
function ancestorPaths(path) {
  const parts = path.split("/");
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    out.push(parts.slice(0, i + 1).join("/"));
  }
  return out;
}
function compilePattern(pattern) {
  let pat = pattern;
  let dirOnly = false;
  if (pat.endsWith("/")) {
    dirOnly = true;
    pat = pat.slice(0, -1);
  }
  let anchored = pat.includes("/");
  if (pat.startsWith("/")) {
    anchored = true;
    pat = pat.slice(1);
  }
  const re = globToRegExp(pat);
  return (repoRelPath) => {
    if (anchored) {
      const segs = ancestorPaths(repoRelPath);
      const candidates2 = dirOnly ? segs.slice(0, -1) : segs;
      return candidates2.some((s) => re.test(s));
    }
    const components = repoRelPath.split("/");
    const candidates = dirOnly ? components.slice(0, -1) : components;
    return candidates.some((c) => re.test(c));
  };
}

// src/common/gate-ignore.ts
var GATE_IGNORE_REL = nodePath3.join(".span", ".gateignore");
function parseGateIgnore(content) {
  const rules = [];
  for (const rawLine of content.split("\n")) {
    const pattern = rawLine.trim();
    if (!pattern || pattern.startsWith("#")) continue;
    rules.push({ pattern, matches: compilePattern(pattern) });
  }
  return rules;
}
function loadGateIgnore(repoRoot) {
  try {
    const content = fs3.readFileSync(nodePath3.join(repoRoot, GATE_IGNORE_REL), "utf8");
    return parseGateIgnore(content);
  } catch {
    return [];
  }
}
function isGateIgnored(rules, repoRelPath) {
  return rules.some((rule) => rule.matches(repoRelPath));
}

// src/common/gate-core.ts
var GateScanError = class extends Error {
  detail;
  constructor(detail) {
    super(`git span stale could not complete its scan: ${detail}`);
    this.name = "GateScanError";
    this.detail = detail;
  }
};
function parseGitCommand(command) {
  for (const segment of splitSegments(command)) {
    const inv = matchGitInvocation(tokenize(segment));
    if (!inv) continue;
    if (inv.subcommand === "commit") {
      const dashDash = inv.args.indexOf("--");
      const paths = dashDash >= 0 ? inv.args.slice(dashDash + 1).filter((p) => p.length > 0) : [];
      return paths.length > 0 ? { kind: "commit", paths } : { kind: "commit" };
    }
    if (inv.subcommand === "push") {
      return { kind: "push" };
    }
  }
  return { kind: "none" };
}
var COMMIT_VALUE_OPTIONS = /* @__PURE__ */ new Set([
  "-m",
  "--message",
  "-F",
  "--file",
  "-C",
  "--reuse-message",
  "-c",
  "--reedit-message",
  "--author",
  "--date",
  "-t",
  "--template",
  "--fixup",
  "--squash",
  "--trailer",
  "--cleanup",
  "--gpg-sign"
]);
function commitStagesAll(command) {
  for (const segment of splitSegments(command)) {
    const inv = matchGitInvocation(tokenize(segment));
    if (!inv || inv.subcommand !== "commit") continue;
    const dashDash = inv.args.indexOf("--");
    const flagArgs = dashDash >= 0 ? inv.args.slice(0, dashDash) : inv.args;
    for (let i = 0; i < flagArgs.length; i++) {
      const arg = flagArgs[i];
      if (arg === "--all") return true;
      if (COMMIT_VALUE_OPTIONS.has(arg)) {
        i++;
        continue;
      }
      if (!arg.startsWith("--") && /^-[A-Za-z]*a[A-Za-z]*$/.test(arg)) return true;
    }
    return false;
  }
  return false;
}
var TWO_CHAR_OPERATORS = /* @__PURE__ */ new Set(["&&", "||"]);
var ONE_CHAR_SEPARATORS = /* @__PURE__ */ new Set([";", "|", "\n", "&", "(", ")"]);
function splitSegments(command) {
  const segments = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (TWO_CHAR_OPERATORS.has(command.slice(i, i + 2))) {
      segments.push(current);
      current = "";
      i++;
      continue;
    }
    if (ONE_CHAR_SEPARATORS.has(ch)) {
      segments.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments;
}
function tokenize(segment) {
  const tokens = [];
  let current = "";
  let has = false;
  let quote = null;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      has = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (ch === " " || ch === "	") {
      if (has) {
        tokens.push(current);
        current = "";
        has = false;
      }
      continue;
    }
    current += ch;
    has = true;
  }
  if (has) tokens.push(current);
  return tokens;
}
var GIT_VALUE_OPTIONS = /* @__PURE__ */ new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--super-prefix",
  "--exec-path",
  "--attr-source",
  "--config-env"
]);
function matchGitInvocation(tokens) {
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
  if (i >= tokens.length || tokens[i] !== "git") return null;
  i++;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "--") return null;
    if (!t.startsWith("-")) break;
    i += GIT_VALUE_OPTIONS.has(t) ? 2 : 1;
  }
  if (i >= tokens.length) return null;
  return { subcommand: tokens[i], args: tokens.slice(i + 1) };
}
async function resolveChangeset(kind, all, cwd, git, paths) {
  if (kind === "push") {
    return git.outgoingPaths(cwd);
  }
  if (paths && paths.length > 0) {
    return git.pathspecPaths(paths, cwd);
  }
  const staged = await git.stagedPaths(cwd);
  if (!all) return staged;
  const tracked = await git.trackedModifiedPaths(cwd);
  const seen = /* @__PURE__ */ new Set();
  const merged = [];
  for (const path of [...staged, ...tracked]) {
    if (seen.has(path)) continue;
    seen.add(path);
    merged.push(path);
  }
  return merged;
}
async function evaluateGate(paths, cwd, executors, memoState) {
  if (paths.length === 0) return { decision: "allow", kind: "silent" };
  try {
    await executors.fix(paths, cwd);
    const staleRows = await executors.stale(paths, cwd);
    const debtRows = staleRows.filter((row) => isDebt(row.status));
    const semantic = debtRows.filter((row) => !isEnvironmentalStatus(row.status));
    const environmental = debtRows.filter((row) => isEnvironmentalStatus(row.status));
    if (semantic.length > 0) {
      return {
        decision: "deny",
        kind: "semantic-staleness",
        findings: semantic,
        reason: renderStalenessReason(semantic)
      };
    }
    if (environmental.length > 0) {
      return {
        decision: "allow",
        kind: "environmental",
        conditions: environmental,
        reason: renderEnvironmentalReason(environmental)
      };
    }
    const covering = await executors.list(paths, cwd);
    const covered = new Set(covering.map((row) => row.path));
    const repoRoot = resolveRepoRoot(cwd);
    const gateIgnoreRules = repoRoot ? loadGateIgnore(repoRoot) : [];
    const uncovered = paths.filter(
      (path) => !covered.has(path) && !isInsideSpanRoot(path) && !isGateIgnored(gateIgnoreRules, path)
    );
    if (uncovered.length === 0) return { decision: "allow", kind: "silent" };
    const digest = gateStateDigest([], uncovered);
    if (memoState.has(digest)) return { decision: "allow", kind: "already-presented" };
    if (!memoState.record(digest)) return { decision: "allow", kind: "silent" };
    return { decision: "deny", kind: "uncovered-writes", uncovered, reason: renderUncoveredReason(uncovered) };
  } catch (err) {
    if (err instanceof GateScanError) {
      return { decision: "deny", kind: "scan-failed", reason: renderScanFailedReason(err.detail) };
    }
    return { decision: "allow", kind: "silent" };
  }
}
function anchorText(row) {
  if (row.start === 0 && row.end === 0) return row.path;
  return `${row.path}#L${row.start}-L${row.end}`;
}
function gateStateDigest(findings, uncovered) {
  const findingKeys = findings.map((row) => `${row.status}	${row.name}	${row.path}	${row.start}	${row.end}`).sort();
  const payload = JSON.stringify({ findings: findingKeys, uncovered: [...uncovered].sort() });
  return createHash("sha256").update(payload).digest("hex");
}
var ESCAPE_HATCH_LINE = "To proceed anyway (requires explicit user approval): prefix the command with `GIT_SPAN_GATE=skip`.";
function renderStalenessReason(findings) {
  const lines = findings.map((row) => `  - ${row.name} (${row.status}): ${anchorText(row)}`);
  return [
    "This changeset carries span debt \u2014 resolve it before this lands:",
    ...lines,
    "",
    "Update each span's anchors/why in this same change, or tell the user why the described coupling no longer holds, then retry.",
    ESCAPE_HATCH_LINE
  ].join("\n");
}
function renderEnvironmentalReason(conditions) {
  const lines = conditions.map((row) => `  - ${row.name} (${row.status}): ${anchorText(row)}`);
  return [
    "git-span could not evaluate these anchors, so the gate is not blocking on them:",
    ...lines,
    "",
    "This is an environmental condition (e.g. sparse checkout, unfetched LFS, partial-clone miss, or I/O error), not span drift you can fix by editing a span. Resolve the underlying checkout/fetch issue if this coupling needs verifying."
  ].join("\n");
}
function renderScanFailedReason(detail) {
  return [
    "git-span could not complete its staleness scan for this changeset, so it cannot confirm the change is free of span debt:",
    `  ${detail}`,
    "",
    "This is a hard scan failure (e.g. an unreadable anchor file that aborts the whole scoped query), not a clean result \u2014 the gate is holding the command rather than letting an unverified changeset through. Resolve the underlying read/scan error, then retry.",
    ESCAPE_HATCH_LINE
  ].join("\n");
}
function renderUncoveredReason(uncovered) {
  const lines = uncovered.map((path) => `  - ${path}`);
  return [
    "These changed files are covered by no span \u2014 consider whether they need one:",
    ...lines,
    "",
    "Declare a coupling with `git span add` if one genuinely exists, or just retry the command to proceed (this is a one-time check).",
    ESCAPE_HATCH_LINE
  ].join("\n");
}
function isGateSkipped(env) {
  return env["GIT_SPAN_GATE"] === "skip";
}
function commandSkipsGate(command) {
  for (const segment of splitSegments(command)) {
    const tokens = tokenize(segment);
    let i = 0;
    let sawSkip = false;
    while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) {
      if (tokens[i] === "GIT_SPAN_GATE=skip") sawSkip = true;
      i++;
    }
    if (sawSkip && tokens[i] === "git") return true;
  }
  return false;
}
var DEFAULT_TIMEOUT_MS = 1e4;
function gitLines(args, cwd, timeoutMs) {
  try {
    const out = execFileSync2("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: timeoutMs
    });
    return out.split("\n").map((line) => line.trim()).filter((line) => line.length > 0).map(toPosix);
  } catch {
    return [];
  }
}
function gitLinesOrNull(args, cwd, timeoutMs) {
  try {
    const out = execFileSync2("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: timeoutMs
    });
    return out.split("\n").map((line) => line.trim()).filter((line) => line.length > 0).map(toPosix);
  } catch {
    return null;
  }
}
function createDefaultGitExecutor(timeoutMs = DEFAULT_TIMEOUT_MS) {
  return {
    stagedPaths: async (cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot) return [];
      return gitLines(["-C", repoRoot, "diff", "--cached", "--name-only"], repoRoot, timeoutMs);
    },
    trackedModifiedPaths: async (cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot) return [];
      return gitLines(["-C", repoRoot, "diff", "--name-only"], repoRoot, timeoutMs);
    },
    outgoingPaths: async (cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot) return [];
      const upstream = gitLinesOrNull(["-C", repoRoot, "diff", "--name-only", "@{u}..HEAD"], repoRoot, timeoutMs);
      if (upstream !== null) return upstream;
      const base = gitLines(["-C", repoRoot, "merge-base", "HEAD", "origin/HEAD"], repoRoot, timeoutMs)[0];
      if (!base) return [];
      return gitLines(["-C", repoRoot, "diff", "--name-only", `${base}..HEAD`], repoRoot, timeoutMs);
    },
    pathspecPaths: async (paths, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return [];
      return gitLines(["-C", repoRoot, "diff", "HEAD", "--name-only", "--", ...paths], repoRoot, timeoutMs);
    }
  };
}
function createDefaultGateExecutors(timeoutMs = DEFAULT_TIMEOUT_MS) {
  return {
    fix: async (paths, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return;
      try {
        execFileSync2("git", ["span", "stale", ...paths, "--fix"], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs
        });
      } catch {
      }
    },
    stale: async (paths, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return [];
      let out;
      try {
        out = execFileSync2("git", ["span", "stale", "--format", "porcelain", ...paths], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs
        });
      } catch (err) {
        const stdout = err.stdout;
        const stderr = err.stderr;
        const stdoutText = typeof stdout === "string" ? stdout : "";
        const stderrText = typeof stderr === "string" ? stderr : "";
        if (stdoutText.trim().length === 0 && stderrText.trim().length > 0) {
          throw new GateScanError(stderrText.trim());
        }
        out = stdoutText;
      }
      return parseStalePorcelain(out);
    },
    list: async (paths, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return [];
      try {
        const out = execFileSync2("git", ["span", "list", "--porcelain", ...paths], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs
        });
        return parsePorcelain(out);
      } catch {
        return [];
      }
    }
  };
}
function createDiskGateMemoState(cwd) {
  const repoRoot = resolveRepoRoot(cwd);
  if (!repoRoot) {
    return { has: () => false, record: () => false };
  }
  const dir = gateMemoDir(repoRoot);
  return {
    has: (digest) => {
      try {
        return fs4.existsSync(nodePath4.join(dir, digest));
      } catch {
        return false;
      }
    },
    record: (digest) => {
      try {
        fs4.mkdirSync(dir, { recursive: true });
        fs4.writeFileSync(nodePath4.join(dir, digest), "");
        return true;
      } catch {
        return false;
      }
    }
  };
}

// src/codex/gate.ts
var CODEX_GATE_HARD_DENY = true;
var SKIP_NOTICE = "git-span gate bypassed (GIT_SPAN_GATE=skip) \u2014 span debt is not being checked for this command.";
function extractShellCommand(toolInput) {
  if (toolInput === null || typeof toolInput !== "object" || !("command" in toolInput)) return null;
  const command = toolInput.command;
  if (typeof command === "string") return command.length > 0 ? command : null;
  if (Array.isArray(command)) {
    const parts = command.filter((p) => typeof p === "string");
    if (parts.length === 0) return null;
    const flagIdx = parts.findIndex((p) => p === "-c" || p === "-lc" || p === "-ic");
    if (flagIdx >= 0 && parts[flagIdx + 1] !== void 0) return parts[flagIdx + 1];
    return parts.join(" ");
  }
  return null;
}
function createHandler(git = createDefaultGitExecutor(), executors = createDefaultGateExecutors(), memoFactory = createDiskGateMemoState, env = process.env, hardDeny = CODEX_GATE_HARD_DENY) {
  return async (input, ctx) => {
    try {
      ctx.logger.info("git-span gate observed shell tool", { tool_name: input.tool_name });
      const command = extractShellCommand(input.tool_input);
      if (command === null) return preToolUseOutput({});
      const parsed = parseGitCommand(command);
      if (parsed.kind === "none") return preToolUseOutput({});
      if (isGateSkipped(env) || commandSkipsGate(command)) {
        return preToolUseOutput({ systemMessage: SKIP_NOTICE });
      }
      const cwd = input.cwd ?? "";
      const all = parsed.kind === "commit" ? commitStagesAll(command) : false;
      const changeset = await resolveChangeset(parsed.kind, all, cwd, git, parsed.paths);
      const result = await evaluateGate(changeset, cwd, executors, memoFactory(cwd));
      if (result.decision !== "deny") {
        if (result.kind === "environmental") {
          ctx.logger.warn("git-span gate allowed with unresolvable anchors", { reason: result.reason });
          return preToolUseOutput({ additionalContext: result.reason, systemMessage: result.reason });
        }
        return preToolUseOutput({});
      }
      if (hardDeny) {
        return preToolUseOutput({
          permissionDecision: "deny",
          permissionDecisionReason: result.reason,
          systemMessage: result.reason
        });
      }
      const warning = `git-span gate could not block this command; span debt remains:
${result.reason}`;
      return preToolUseOutput({ additionalContext: warning, systemMessage: warning });
    } catch (err) {
      ctx.logger.warn("git-span gate failed open on an uncaught error", { err });
      return preToolUseOutput({});
    }
  };
}
var gate_default = preToolUseHook({ matcher: "Bash|shell|exec|local_shell", timeout: 1e4 }, createHandler());

// src/codex/gate-entry.ts
execute(gate_default);
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2NvbnN0YW50cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2dhdGUtY29yZS50cyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL2dhdGUtaWdub3JlLnRzIiwgInNyYy9jb21tb24vc3Bhbi1pZ25vcmUudHMiLCAic3JjL2NvZGV4L2dhdGUudHMiLCAic3JjL2NvZGV4L2dhdGUtZW50cnkudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImV4cG9ydCBjb25zdCBQQUNLQUdFX05BTUUgPSBcIkBnb29kZm9vdC9jb2RleC1ob29rc1wiO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfVElNRU9VVF9NUyA9IDYwMF8wMDA7XG5leHBvcnQgY29uc3QgREVGQVVMVF9TVEFUVVNfTUVTU0FHRSA9IHVuZGVmaW5lZDtcbmV4cG9ydCBjb25zdCBERUZBVUxUX0VTQlVJTERfTE9BREVSUyA9IHtcbiAgICBcIi5tZFwiOiBcInRleHRcIixcbn07XG5leHBvcnQgY29uc3QgSE9PS19GQUNUT1JZX1RPX0VWRU5UID0ge1xuICAgIHByZVRvb2xVc2VIb29rOiBcIlByZVRvb2xVc2VcIixcbiAgICBwb3N0VG9vbFVzZUhvb2s6IFwiUG9zdFRvb2xVc2VcIixcbiAgICBwZXJtaXNzaW9uUmVxdWVzdEhvb2s6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICB1c2VyUHJvbXB0U3VibWl0SG9vazogXCJVc2VyUHJvbXB0U3VibWl0XCIsXG4gICAgc2Vzc2lvblN0YXJ0SG9vazogXCJTZXNzaW9uU3RhcnRcIixcbiAgICBzdWJhZ2VudFN0YXJ0SG9vazogXCJTdWJhZ2VudFN0YXJ0XCIsXG4gICAgc3RvcEhvb2s6IFwiU3RvcFwiLFxuICAgIHN1YmFnZW50U3RvcEhvb2s6IFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgcHJlQ29tcGFjdEhvb2s6IFwiUHJlQ29tcGFjdFwiLFxuICAgIHBvc3RDb21wYWN0SG9vazogXCJQb3N0Q29tcGFjdFwiLFxufTtcbmV4cG9ydCBjb25zdCBFVkVOVFNfV0lUSF9NQVRDSEVSID0gbmV3IFNldChbXG4gICAgXCJQcmVUb29sVXNlXCIsXG4gICAgXCJQb3N0VG9vbFVzZVwiLFxuICAgIFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICBcIlNlc3Npb25TdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgXCJQcmVDb21wYWN0XCIsXG4gICAgXCJQb3N0Q29tcGFjdFwiLFxuXSk7XG5leHBvcnQgY29uc3QgRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQgPSBuZXcgU2V0KFtcIlNlc3Npb25TdGFydFwiLCBcIlVzZXJQcm9tcHRTdWJtaXRcIiwgXCJTdWJhZ2VudFN0YXJ0XCJdKTtcbiIsICJmdW5jdGlvbiBhdHRhY2hNZXRhZGF0YShob29rRXZlbnROYW1lLCBjb25maWcsIGhhbmRsZXIpIHtcbiAgICBjb25zdCBob29rID0gaGFuZGxlcjtcbiAgICBob29rLmhvb2tFdmVudE5hbWUgPSBob29rRXZlbnROYW1lO1xuICAgIGhvb2sudGltZW91dCA9IGNvbmZpZy50aW1lb3V0O1xuICAgIGhvb2suc3RhdHVzTWVzc2FnZSA9IGNvbmZpZy5zdGF0dXNNZXNzYWdlO1xuICAgIGlmIChcIm1hdGNoZXJcIiBpbiBjb25maWcgJiYgdHlwZW9mIGNvbmZpZy5tYXRjaGVyID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGhvb2subWF0Y2hlciA9IGNvbmZpZy5tYXRjaGVyO1xuICAgIH1cbiAgICByZXR1cm4gaG9vaztcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQcmVUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBvc3RUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcGVybWlzc2lvblJlcXVlc3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gdXNlclByb21wdFN1Ym1pdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiVXNlclByb21wdFN1Ym1pdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25TdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU2Vzc2lvblN0YXJ0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3ViYWdlbnRTdGFydFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN0b3BcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN1YmFnZW50U3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlByZUNvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUG9zdENvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbiIsICJpbXBvcnQgeyBjbG9zZVN5bmMsIGV4aXN0c1N5bmMsIG1rZGlyU3luYywgb3BlblN5bmMsIHdyaXRlU3luYyB9IGZyb20gXCJub2RlOmZzXCI7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuY29uc3QgREVGQVVMVF9MT0dfRU5WX1ZBUiA9IFwiQ09ERVhfSE9PS1NfTE9HX0ZJTEVcIjtcbmV4cG9ydCBjbGFzcyBMb2dnZXIge1xuICAgIGhhbmRsZXJzID0gbmV3IE1hcCgpO1xuICAgIGZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIGxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgbG9nRmlsZVBhdGggPSBudWxsO1xuICAgIGN1cnJlbnRIb29rVHlwZTtcbiAgICBjdXJyZW50SW5wdXQ7XG4gICAgY29uc3RydWN0b3IoY29uZmlnID0ge30pIHtcbiAgICAgICAgdGhpcy5sb2dGaWxlUGF0aCA9IGNvbmZpZy5sb2dGaWxlUGF0aCA/PyBwcm9jZXNzLmVudltjb25maWcubG9nRW52VmFyID8/IERFRkFVTFRfTE9HX0VOVl9WQVJdID8/IG51bGw7XG4gICAgfVxuICAgIHNldENvbnRleHQoaG9va1R5cGUsIGlucHV0KSB7XG4gICAgICAgIHRoaXMuY3VycmVudEhvb2tUeXBlID0gaG9va1R5cGU7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gaW5wdXQ7XG4gICAgfVxuICAgIGNsZWFyQ29udGV4dCgpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50SG9va1R5cGUgPSB1bmRlZmluZWQ7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBvbihsZXZlbCwgaGFuZGxlcikge1xuICAgICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKSA/PyBuZXcgU2V0KCk7XG4gICAgICAgIGV4aXN0aW5nLmFkZChoYW5kbGVyKTtcbiAgICAgICAgdGhpcy5oYW5kbGVycy5zZXQobGV2ZWwsIGV4aXN0aW5nKTtcbiAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgIGV4aXN0aW5nLmRlbGV0ZShoYW5kbGVyKTtcbiAgICAgICAgICAgIGlmIChleGlzdGluZy5zaXplID09PSAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5oYW5kbGVycy5kZWxldGUobGV2ZWwpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgIH1cbiAgICBkZWJ1ZyhtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImRlYnVnXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICBpbmZvKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiaW5mb1wiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgd2FybihtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcIndhcm5cIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGVycm9yKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZXJyb3JcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGxvZ0Vycm9yKGVycm9yLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImVycm9yXCIsIGAke21lc3NhZ2V9OiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLCBjb250ZXh0KTtcbiAgICB9XG4gICAgY2xvc2UoKSB7XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgY2xvc2VTeW5jKHRoaXMubG9nRmlsZUZkKTtcbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cbiAgICBlbWl0KGxldmVsLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0ge1xuICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICBsZXZlbCxcbiAgICAgICAgICAgIGhvb2tUeXBlOiB0aGlzLmN1cnJlbnRIb29rVHlwZSxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICAuLi4odGhpcy5jdXJyZW50SW5wdXQgIT09IHVuZGVmaW5lZCA/IHsgaW5wdXQ6IHRoaXMuY3VycmVudElucHV0IH0gOiB7fSksXG4gICAgICAgICAgICAuLi4oY29udGV4dCAhPT0gdW5kZWZpbmVkID8geyBjb250ZXh0IH0gOiB7fSksXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMud3JpdGVUb0ZpbGUoZXZlbnQpO1xuICAgICAgICB0aGlzLmhhbmRsZXJzLmdldChsZXZlbCk/LmZvckVhY2goKGhhbmRsZXIpID0+IHtcbiAgICAgICAgICAgIGhhbmRsZXIoZXZlbnQpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgd3JpdGVUb0ZpbGUoZXZlbnQpIHtcbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZVBhdGggPT09IG51bGwpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXRoaXMuZmlsZUluaXRpYWxpemVkKSB7XG4gICAgICAgICAgICB0aGlzLmZpbGVJbml0aWFsaXplZCA9IHRydWU7XG4gICAgICAgICAgICBjb25zdCBsb2dEaXIgPSBkaXJuYW1lKHRoaXMubG9nRmlsZVBhdGgpO1xuICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKGxvZ0RpcikpIHtcbiAgICAgICAgICAgICAgICBta2RpclN5bmMobG9nRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gb3BlblN5bmModGhpcy5sb2dGaWxlUGF0aCwgXCJhXCIpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgd3JpdGVTeW5jKHRoaXMubG9nRmlsZUZkLCBgJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuYCk7XG4gICAgICAgIH1cbiAgICB9XG59XG5leHBvcnQgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcigpO1xuIiwgImV4cG9ydCBjb25zdCBFWElUX0NPREVTID0ge1xuICAgIFNVQ0NFU1M6IDAsXG4gICAgRVJST1I6IDEsXG4gICAgQkxPQ0s6IDIsXG59O1xuZXhwb3J0IGNsYXNzIEJsb2NrRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gICAgcmVhc29uO1xuICAgIGNvbnN0cnVjdG9yKHJlYXNvbikge1xuICAgICAgICBzdXBlcihyZWFzb24pO1xuICAgICAgICB0aGlzLm5hbWUgPSBcIkJsb2NrRXJyb3JcIjtcbiAgICAgICAgdGhpcy5yZWFzb24gPSByZWFzb247XG4gICAgfVxufVxuZnVuY3Rpb24gb21pdFVuZGVmaW5lZCh2YWx1ZSkge1xuICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModmFsdWUpLmZpbHRlcigoWywgZW50cnldKSA9PiBlbnRyeSAhPT0gdW5kZWZpbmVkKSk7XG59XG5mdW5jdGlvbiBidWlsZE91dHB1dCh0eXBlLCBzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiB7XG4gICAgICAgIF90eXBlOiB0eXBlLFxuICAgICAgICBzdGRvdXQ6IG9taXRVbmRlZmluZWQoc3Rkb3V0KSxcbiAgICAgICAgLi4uKHN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRlcnIgfSA6IHt9KSxcbiAgICB9O1xufVxuZXhwb3J0IGZ1bmN0aW9uIHJhd091dHB1dChzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlJhd1wiLCBzdGRvdXQsIHN0ZGVycik7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvbiAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy51cGRhdGVkSW5wdXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBoYXNTcGVjaWZpY1xuICAgICAgICA/IG9taXRVbmRlZmluZWQoe1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQcmVUb29sVXNlXCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvbjogb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb24sXG4gICAgICAgICAgICBwZXJtaXNzaW9uRGVjaXNpb25SZWFzb246IG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uLFxuICAgICAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgfSlcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlVG9vbFVzZVwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZUxlZ2FjeUJsb2NrT3V0cHV0KG9wdGlvbnMpIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVUb29sVXNlXCIsIHtcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fCBvcHRpb25zLnVwZGF0ZWRNQ1BUb29sT3V0cHV0ICE9PSB1bmRlZmluZWQ7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gaGFzU3BlY2lmaWNcbiAgICAgICAgPyBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUG9zdFRvb2xVc2VcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICAgICAgdXBkYXRlZE1DUFRvb2xPdXRwdXQ6IG9wdGlvbnMudXBkYXRlZE1DUFRvb2xPdXRwdXQsXG4gICAgICAgIH0pXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBvc3RUb29sVXNlXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uUmVxdWVzdE91dHB1dChvcHRpb25zKSB7XG4gICAgY29uc3QgZGVjaXNpb24gPSBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgYmVoYXZpb3I6IG9wdGlvbnMuYmVoYXZpb3IsXG4gICAgICAgIG1lc3NhZ2U6IG9wdGlvbnMubWVzc2FnZSxcbiAgICAgICAgaW50ZXJydXB0OiBvcHRpb25zLmludGVycnVwdCxcbiAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgdXBkYXRlZFBlcm1pc3Npb25zOiBvcHRpb25zLnVwZGF0ZWRQZXJtaXNzaW9ucyxcbiAgICB9KTtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSB7XG4gICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICAgICAgZGVjaXNpb24sXG4gICAgfTtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQZXJtaXNzaW9uUmVxdWVzdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiVXNlclByb21wdFN1Ym1pdFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiVXNlclByb21wdFN1Ym1pdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiU2Vzc2lvblN0YXJ0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTZXNzaW9uU3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlN1YmFnZW50U3RhcnRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3RvcE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTdG9wXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdG9wT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RvcFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlQ29tcGFjdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdENvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUG9zdENvbXBhY3RcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgIH0pO1xufVxuIiwgImltcG9ydCB7IEVWRU5UU19XSVRIX1RFWFRfT1VUUFVUIH0gZnJvbSBcIi4vY29uc3RhbnRzLmpzXCI7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tIFwiLi9sb2dnZXIuanNcIjtcbmltcG9ydCB7IEJsb2NrRXJyb3IsIEVYSVRfQ09ERVMsIHNlc3Npb25TdGFydE91dHB1dCwgc3ViYWdlbnRTdGFydE91dHB1dCwgdXNlclByb21wdFN1Ym1pdE91dHB1dCwgfSBmcm9tIFwiLi9vdXRwdXRzLmpzXCI7XG5hc3luYyBmdW5jdGlvbiByZWFkU3RkaW4oKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgY2h1bmtzID0gW107XG4gICAgICAgIHByb2Nlc3Muc3RkaW4uc2V0RW5jb2RpbmcoXCJ1dGYtOFwiKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImRhdGFcIiwgKGNodW5rKSA9PiBjaHVua3MucHVzaChjaHVuaykpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZW5kXCIsICgpID0+IHJlc29sdmUoY2h1bmtzLmpvaW4oXCJcIikpKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImVycm9yXCIsIHJlamVjdCk7XG4gICAgfSk7XG59XG5mdW5jdGlvbiBwYXJzZVN0ZGluSW5wdXQoc3RkaW5Db250ZW50KSB7XG4gICAgcmV0dXJuIEpTT04ucGFyc2Uoc3RkaW5Db250ZW50KTtcbn1cbmZ1bmN0aW9uIHdyaXRlU3Rkb3V0KG91dHB1dCkge1xuICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKEpTT04uc3RyaW5naWZ5KG91dHB1dC5zdGRvdXQpKTtcbn1cbmZ1bmN0aW9uIG5vcm1hbGl6ZVN0cmluZ091dHB1dChob29rRXZlbnROYW1lLCByZXN1bHQpIHtcbiAgICBpZiAoIUVWRU5UU19XSVRIX1RFWFRfT1VUUFVULmhhcyhob29rRXZlbnROYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7aG9va0V2ZW50TmFtZX0gaG9va3MgY2Fubm90IHJldHVybiBwbGFpbiB0ZXh0YCk7XG4gICAgfVxuICAgIGlmIChob29rRXZlbnROYW1lID09PSBcIlNlc3Npb25TdGFydFwiKSB7XG4gICAgICAgIHJldHVybiBzZXNzaW9uU3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICBpZiAoaG9va0V2ZW50TmFtZSA9PT0gXCJTdWJhZ2VudFN0YXJ0XCIpIHtcbiAgICAgICAgcmV0dXJuIHN1YmFnZW50U3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICByZXR1cm4gdXNlclByb21wdFN1Ym1pdE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gY29udmVydFRvSG9va091dHB1dChvdXRwdXQpIHtcbiAgICByZXR1cm4gb3V0cHV0LnN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQsIHN0ZGVycjogb3V0cHV0LnN0ZGVyciB9IDogeyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQgfTtcbn1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBleGVjdXRlKGhvb2tGbikge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHN0ZGluQ29udGVudCA9IGF3YWl0IHJlYWRTdGRpbigpO1xuICAgICAgICBjb25zdCBpbnB1dCA9IHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpO1xuICAgICAgICBsb2dnZXIuc2V0Q29udGV4dChob29rRm4uaG9va0V2ZW50TmFtZSwgaW5wdXQpO1xuICAgICAgICBjb25zdCBjb250ZXh0ID0geyBsb2dnZXIgfTtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaG9va0ZuKGlucHV0LCBjb250ZXh0KTtcbiAgICAgICAgbGV0IG91dHB1dCA9IHsgc3Rkb3V0OiB7fSB9O1xuICAgICAgICBpZiAodHlwZW9mIHJlc3VsdCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgb3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChub3JtYWxpemVTdHJpbmdPdXRwdXQoaG9va0ZuLmhvb2tFdmVudE5hbWUsIHJlc3VsdCkpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHJlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBvdXRwdXQgPSBjb252ZXJ0VG9Ib29rT3V0cHV0KHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgICAgd3JpdGVTdGRvdXQob3V0cHV0KTtcbiAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuU1VDQ0VTUyk7XG4gICAgfVxuICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBCbG9ja0Vycm9yKSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtlcnJvci5yZWFzb259XFxuYCk7XG4gICAgICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5CTE9DSyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke2Vycm9yLnN0YWNrID8/IGVycm9yLm1lc3NhZ2V9XFxuYCk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtTdHJpbmcoZXJyb3IpfVxcbmApO1xuICAgICAgICB9XG4gICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLkVSUk9SKTtcbiAgICB9XG4gICAgZmluYWxseSB7XG4gICAgICAgIGxvZ2dlci5jbGVhckNvbnRleHQoKTtcbiAgICAgICAgbG9nZ2VyLmNsb3NlKCk7XG4gICAgfVxufVxuIiwgIi8qKlxuICogSGFybmVzcy1hZ25vc3RpYyBnYXRlIGNvcmUgKFBoYXNlIDMuMSBcdTIwMTQgY29udHJhY3QgYW5kIHN0dWJzKS5cbiAqXG4gKiBUaGlzIG1vZHVsZSBkZWNsYXJlcyB0aGUgUHJlVG9vbFVzZSBcImdhdGVcIiB0aGF0IGJvdGggdGhlIENsYXVkZSAoYEJhc2hgKSBhbmRcbiAqIENvZGV4IChzaGVsbC9leGVjKSBhZGFwdGVycyB3aWxsIGRyaXZlOiB3aGVuIHRoZSBhZ2VudCBydW5zIGBnaXQgY29tbWl0YCBvclxuICogYGdpdCBwdXNoYCBhbmQgdGhlIGNoYW5nZXNldCBpdCBpcyBhYm91dCB0byBsYW5kIGNhcnJpZXMgcmVhbCBzcGFuIGRlYnQsIHRoZVxuICogY29tbWFuZCBpcyBoZWxkIHdpdGggYSBjaGVja2xpc3Q7IHBvc2l0aW9uYWwgZHJpZnQgdGhlIHRvdWNoIGhvb2sgaGFzIGJlZW5cbiAqIGhlYWxpbmcgYWxsIGFsb25nIG5ldmVyIGJsb2Nrcy4gTGlrZSB7QGxpbmsgZmlsZTovLy4vdG91Y2gtY29yZS50c30gaXQgaW1wb3J0c1xuICogbm90aGluZyBmcm9tIGVpdGhlciBob29rIFNESyBhbmQgaXMgdHlwZWQgc3RydWN0dXJhbGx5LCBwZXIgdGhlIGBjb21tb24vYFxuICogbGF5ZXIgY29udmVudGlvbjogYWRhcHRlcnMgdHJhbnNsYXRlIHRoZWlyIFNESy1zcGVjaWZpYyBob29rIGlucHV0IGludG8gYVxuICogY29tbWFuZCBzdHJpbmcgKyBjd2QsIGluamVjdCBleGVjdXRpb24vc3RhdGUgZGVwZW5kZW5jaWVzLCBhbmQgdHJhbnNsYXRlIHRoZVxuICogcmV0dXJuZWQge0BsaW5rIEdhdGVSZXN1bHR9IGludG8gdGhlaXIgb3duIGRlbnkvYWxsb3cgb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogZ2F0ZS1jb3JlIGlzIGEgc2libGluZyBvZiB0b3VjaC1jb3JlLCBub3QgYSBkZXBlbmRlbnQ6IHRoZSB0d28gY29yZXMgYXJlXG4gKiBpbmRlcGVuZGVudCBhbmQgdGhpcyBtb2R1bGUgaW1wb3J0cyBub3RoaW5nIGZyb20gYHRvdWNoLWNvcmUudHNgLlxuICpcbiAqIFJldXNlZCBmcm9tIHRoZSBzaGFyZWQga2VybmVsIChub3QgcmVkZWZpbmVkKTogYGlzRGVidCgpYCAodGhlIHNpbmdsZVxuICogc291cmNlIG9mIHRydXRoIGZvciB0aGUgc2VtYW50aWMtb25seSBkZWJ0IGludmFyaWFudCBcdTIwMTQgYE1PVkVEYCBhbmRcbiAqIGBSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgYXJlIG5ldmVyIGRlYnQpLCB0aGUgcG9yY2VsYWluIHN0YXR1cyB2b2NhYnVsYXJ5XG4gKiAoYFBvcmNlbGFpblN0YXR1c2AvYFBvcmNlbGFpblJvd2AvYFN0YWxlUG9yY2VsYWluUm93YCksIGFuZCBgZ2F0ZU1lbW9EaXIoKWBcbiAqICh0aGUgYDxnaXQtY29tbW9uLWRpcj4vZ2l0LXNwYW4vZ2F0ZS9gIHBhdGggdGhlIGRpc2stYmFja2VkXG4gKiB7QGxpbmsgR2F0ZU1lbW9TdGF0ZX0gd2lsbCBwZXJzaXN0IHVuZGVyKSBcdTIwMTQgYWxsIGZyb20gYWdlbnQtaG9va3MtY29tbW9uLnRzLlxuICpcbiAqIEV2ZXJ5IGZ1bmN0aW9uIHdob3NlIHJlc3VsdCBkZXBlbmRzIG9uIHJlYWwgbG9naWMgaXMgYSBgTm90IEltcGxlbWVudGVkYCBzdHViXG4gKiBpbiB0aGlzIHBoYXNlOyBQaGFzZSAzLjIgd3JpdGVzIHNraXBwZWQgY2hlY2tzIGFnYWluc3QgdGhlc2Ugc2lnbmF0dXJlcyBhbmRcbiAqIFBoYXNlIDMuMyBpbXBsZW1lbnRzIHRoZW0uIFRoZSBvbmUgZXhjZXB0aW9uIGlzIHtAbGluayBpc0dhdGVTa2lwcGVkfSwgd2hpY2hcbiAqIGlzIHB1cmUgYW5kIGZ1bGx5IHNwZWNpZmllZCBieSBDQVJELm1kLCBzbyBpdCBpcyBpbXBsZW1lbnRlZCBoZXJlIChzZWUgaXRzXG4gKiBkb2MgY29tbWVudCBmb3IgdGhlIHJhdGlvbmFsZSkuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tICdub2RlOmNyeXB0byc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQge1xuICBnYXRlTWVtb0RpcixcbiAgaXNEZWJ0LFxuICBpc0Vudmlyb25tZW50YWxTdGF0dXMsXG4gIGlzSW5zaWRlU3BhblJvb3QsXG4gIHR5cGUgUG9yY2VsYWluUm93LFxuICBwYXJzZVBvcmNlbGFpbixcbiAgcGFyc2VTdGFsZVBvcmNlbGFpbixcbiAgcmVzb2x2ZVJlcG9Sb290LFxuICB0eXBlIFN0YWxlUG9yY2VsYWluUm93LFxuICB0b1Bvc2l4XG59IGZyb20gJy4vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcbmltcG9ydCB7IGlzR2F0ZUlnbm9yZWQsIGxvYWRHYXRlSWdub3JlIH0gZnJvbSAnLi9nYXRlLWlnbm9yZS5qcyc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2Nhbi1mYWlsdXJlIHNpZ25hbFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmFpc2VkIGJ5IHRoZSBgc3RhbGVgIGV4ZWN1dG9yIHdoZW4gYGdpdCBzcGFuIHN0YWxlYCBjb3VsZCBub3QgKmNvbXBsZXRlKiBpdHNcbiAqIHNjb3BlZCBzY2FuIFx1MjAxNCBhcyBvcHBvc2VkIHRvIGNvbXBsZXRpbmcgYW5kIHJlcG9ydGluZyBkcmlmdC4gYGdpdCBzcGFuIHN0YWxlYFxuICogZXhpdHMgbm9uLXplcm8gaW4gdHdvIHZlcnkgZGlmZmVyZW50IHNpdHVhdGlvbnM6IG9uIGxlZ2l0aW1hdGUgZHJpZnQgKHJlYWxcbiAqIHBvcmNlbGFpbiByb3dzIG9uIHN0ZG91dCkgYW5kIG9uIGEgaGFyZCBzY2FuIGZhaWx1cmUgKGUuZy4gYW4gdW5yZWFkYWJsZVxuICogYW5jaG9yIGZpbGUgYWJvcnRzIHRoZSB3aG9sZSBzY29wZWQgcXVlcnksIGxlYXZpbmcgc3Rkb3V0IGVtcHR5IGFuZCBhbiBlcnJvclxuICogb24gc3RkZXJyKS4gT25seSB0aGUgc2Vjb25kIHRocm93cyB0aGlzLCBzbyB7QGxpbmsgZXZhbHVhdGVHYXRlfSBjYW4gdGVsbCBhXG4gKiBzY2FuIHRoYXQgKnJhbiBjbGVhbiogKGVtcHR5IHJvd3MpIGZyb20gb25lIHRoYXQgKm5ldmVyIHJhbiogKGVtcHR5IHJvd3NcbiAqIGJlY2F1c2UgaXQgYWJvcnRlZCkgYW5kIHJlZnVzZSB0byByZWFkIHRoZSBsYXR0ZXIgYXMgYSBjbGVhbiBwYXNzLiBgZGV0YWlsYFxuICogY2FycmllcyB0aGUgQ0xJJ3Mgc3RkZXJyIGZvciB0aGUgc3VyZmFjZWQgcmVhc29uLlxuICovXG5leHBvcnQgY2xhc3MgR2F0ZVNjYW5FcnJvciBleHRlbmRzIEVycm9yIHtcbiAgcmVhZG9ubHkgZGV0YWlsOiBzdHJpbmc7XG4gIGNvbnN0cnVjdG9yKGRldGFpbDogc3RyaW5nKSB7XG4gICAgc3VwZXIoYGdpdCBzcGFuIHN0YWxlIGNvdWxkIG5vdCBjb21wbGV0ZSBpdHMgc2NhbjogJHtkZXRhaWx9YCk7XG4gICAgdGhpcy5uYW1lID0gJ0dhdGVTY2FuRXJyb3InO1xuICAgIHRoaXMuZGV0YWlsID0gZGV0YWlsO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQ29tbWFuZCBwYXJzaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBUaGUga2luZCBvZiBnYXRlZCBnaXQgY29tbWFuZCBhIHNoZWxsIGNvbW1hbmQgc3RyaW5nIHJlc29sdmVzIHRvLiBgJ25vbmUnYFxuICogaXMgdGhlIGNvbnNlcnZhdGl2ZSBmYWlsLW9wZW4gYW5zd2VyOiBhbnkgc2hhcGUge0BsaW5rIHBhcnNlR2l0Q29tbWFuZH0gZG9lc1xuICogbm90IGNvbmZpZGVudGx5IHJlY29nbml6ZSBhcyBhIGBnaXQgY29tbWl0YC9gZ2l0IHB1c2hgIG1hcHMgdG8gYCdub25lJ2AgYW5kXG4gKiB0aGUgZ2F0ZSBhbGxvd3MgdGhlIGNvbW1hbmQgdGhyb3VnaCB1bnRvdWNoZWQuXG4gKi9cbmV4cG9ydCB0eXBlIEdpdENvbW1hbmRLaW5kID0gJ2NvbW1pdCcgfCAncHVzaCcgfCAnbm9uZSc7XG5cbi8qKlxuICogVGhlIHJlc3VsdCBvZiBwYXJzaW5nIGEgc2hlbGwgY29tbWFuZCBzdHJpbmcgZm9yIGEgZ2F0ZWQgZ2l0IGludm9jYXRpb24uXG4gKlxuICogYHBhdGhzYCBjYXJyaWVzIG9ubHkgd2hhdCBpcyBwYXJzZWFibGUgZnJvbSB0aGUgY29tbWFuZCBsaW5lIGl0c2VsZiBcdTIwMTQgdGhlXG4gKiBleHBsaWNpdCBwYXRoc3BlY3MgYSBgZ2l0IGNvbW1pdCAtLSA8cGF0aD5cdTIwMjZgIGZvcm0gbmFtZXMuIEl0IGlzIGRlbGliZXJhdGVseVxuICogKm5vdCogdGhlIGNoYW5nZXNldDogdGhlIGZ1bGxlciByZXNvbHV0aW9uIChzdGFnZWQgZmlsZXMsIHRoZSBgLWFgL2AtYW1gXG4gKiBleHBhbnNpb24gYWdhaW5zdCB0cmFja2VkLW1vZGlmaWVkIGZpbGVzLCB0aGUgb3V0Z29pbmcgcHVzaCByYW5nZSkgaXNcbiAqIHtAbGluayByZXNvbHZlQ2hhbmdlc2V0fSdzIGpvYiwgZHJpdmVuIGZyb20gdGhlIHJlcG8gc3RhdGUsIG5vdCBmcm9tIHRoZVxuICogY29tbWFuZCB0ZXh0LiBgcGF0aHNgIGlzIG9taXR0ZWQgd2hlbiB0aGUgY29tbWFuZCBuYW1lcyBubyBleHBsaWNpdFxuICogcGF0aHNwZWMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGFyc2VkR2l0Q29tbWFuZCB7XG4gIGtpbmQ6IEdpdENvbW1hbmRLaW5kO1xuICBwYXRocz86IHN0cmluZ1tdO1xufVxuXG4vKipcbiAqIFdvcmQtYm91bmRhcnkgcGFyc2Ugb2YgYSBgZ2l0IGNvbW1pdGAgLyBgZ2l0IHB1c2hgIGludm9jYXRpb24gZW1iZWRkZWQgaW4gYW5cbiAqIGFyYml0cmFyeSBzaGVsbCBjb21tYW5kIHN0cmluZy5cbiAqXG4gKiBNdXN0IHJlY29nbml6ZSB0aGUgcmVhbCBzaGFwZXMgY29tbWl0cyBhbmQgcHVzaGVzIGFycml2ZSBpbjogY2hhaW5lZFxuICogY29tbWFuZHMgKGBcdTIwMjYgJiYgZ2l0IGNvbW1pdCBcdTIwMjZgLCBgXHUyMDI2OyBnaXQgcHVzaGAsIGBcdTIwMjYgfCBcdTIwMjZgKSwgYW4gZXhwbGljaXQgcmVwbyB2aWFcbiAqIGBnaXQgLUMgPGRpcj4gY29tbWl0IFx1MjAyNmAsIHRyYWlsaW5nIHBhdGhzcGVjcyBhZnRlciBgLS1gLCB0aGUgYC1hYC9gLWFtYFxuICogXCJjb21taXQgYWxsIHRyYWNrZWQtbW9kaWZpZWRcIiBmb3JtcywgYW5kIGludm9jYXRpb24gZnJvbSBhIGN3ZCBiZWxvdyB0aGUgcmVwb1xuICogcm9vdC4gTWF0Y2hpbmcgaXMgb24gd29yZCBib3VuZGFyaWVzLCBuZXZlciBzdWJzdHJpbmc6IGEgcGF0aCBvciBtZXNzYWdlIHRoYXRcbiAqIG1lcmVseSBjb250YWlucyB0aGUgdGV4dCBgZ2l0IGNvbW1pdGAgbXVzdCBub3QgdHJpcCB0aGUgZ2F0ZS5cbiAqXG4gKiBDb25zZXJ2YXRpdmUgYnkgY29udHJhY3Q6IHRoaXMgaXMgdGhlIGZhaWwtb3BlbiBwb2ludCBhdCB0aGUgcGFyc2UgbGF5ZXIsIG5vdFxuICogYSBwbGFjZSB0byBndWVzcy4gQW55IGNvbW1hbmQgd2hvc2Ugc2hhcGUgaXMgbm90IGNvbmZpZGVudGx5IGEgZ2F0ZWRcbiAqIGBnaXQgY29tbWl0YC9gZ2l0IHB1c2hgIFx1MjAxNCBhbiB1bmZhbWlsaWFyIHN1YmNvbW1hbmQsIGFuIGFsaWFzLCBhbiBvYmZ1c2NhdGVkXG4gKiBvciBkeW5hbWljYWxseS1idWlsdCBpbnZvY2F0aW9uIFx1MjAxNCByZXR1cm5zIGB7IGtpbmQ6ICdub25lJyB9YCBzbyB0aGUgZ2F0ZVxuICogYWxsb3dzIGl0IHJhdGhlciB0aGFuIGRlbnlpbmcgb24gYSBzaGFreSByZWFkLiAoU2VlIENBUkQubWQgXCJSaXNrcyBhbmRcbiAqIHJlcXVpcmVkIHNwaWtlcyBcdTIxOTIgQ29tbWFuZCBwYXJzaW5nXCIgYW5kIGRlc2lnbi1kZWNpc2lvbnMubWQgIzEuKVxuICpcbiAqIEBwYXJhbSBjb21tYW5kIFRoZSByYXcgc2hlbGwgY29tbWFuZCBzdHJpbmcgZnJvbSB0aGUgaG9vaydzIHRvb2wgaW5wdXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUdpdENvbW1hbmQoY29tbWFuZDogc3RyaW5nKTogUGFyc2VkR2l0Q29tbWFuZCB7XG4gIGZvciAoY29uc3Qgc2VnbWVudCBvZiBzcGxpdFNlZ21lbnRzKGNvbW1hbmQpKSB7XG4gICAgY29uc3QgaW52ID0gbWF0Y2hHaXRJbnZvY2F0aW9uKHRva2VuaXplKHNlZ21lbnQpKTtcbiAgICBpZiAoIWludikgY29udGludWU7XG4gICAgaWYgKGludi5zdWJjb21tYW5kID09PSAnY29tbWl0Jykge1xuICAgICAgY29uc3QgZGFzaERhc2ggPSBpbnYuYXJncy5pbmRleE9mKCctLScpO1xuICAgICAgY29uc3QgcGF0aHMgPSBkYXNoRGFzaCA+PSAwID8gaW52LmFyZ3Muc2xpY2UoZGFzaERhc2ggKyAxKS5maWx0ZXIoKHApID0+IHAubGVuZ3RoID4gMCkgOiBbXTtcbiAgICAgIHJldHVybiBwYXRocy5sZW5ndGggPiAwID8geyBraW5kOiAnY29tbWl0JywgcGF0aHMgfSA6IHsga2luZDogJ2NvbW1pdCcgfTtcbiAgICB9XG4gICAgaWYgKGludi5zdWJjb21tYW5kID09PSAncHVzaCcpIHtcbiAgICAgIHJldHVybiB7IGtpbmQ6ICdwdXNoJyB9O1xuICAgIH1cbiAgICAvLyBBIHJlY29nbml6ZWQgYGdpdGAgaW52b2NhdGlvbiB0aGF0IGlzIG5laXRoZXIgY29tbWl0IG5vciBwdXNoIChlLmcuXG4gICAgLy8gYGdpdCBhZGQgLiAmJiBnaXQgY29tbWl0IFx1MjAyNmApOiBrZWVwIHNjYW5uaW5nIGxhdGVyIHNlZ21lbnRzLlxuICB9XG4gIHJldHVybiB7IGtpbmQ6ICdub25lJyB9O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYSBgZ2l0IGNvbW1pdGAgaW4gdGhlIGNvbW1hbmQgaXMgYW4gYC1hYC9gLWFtYC9gLS1hbGxgIGZvcm0gXHUyMDE0IHRoZVxuICogXCJzdGFnZSBhbGwgdHJhY2tlZC1tb2RpZmllZCBmaWxlc1wiIHZhcmlhbnQgd2hvc2UgY2hhbmdlc2V0IHtAbGluayByZXNvbHZlQ2hhbmdlc2V0fVxuICogbXVzdCB3aWRlbiBiZXlvbmQgdGhlIGFscmVhZHktc3RhZ2VkIHNldC5cbiAqXG4gKiBUaGUgYGFsbGAgc2lnbmFsIGlzIGRlbGliZXJhdGVseSAqbm90KiBjYXJyaWVkIG9uIHtAbGluayBQYXJzZWRHaXRDb21tYW5kfVxuICogKHNlZSB0aGF0IHR5cGUncyBkb2MpOiB0aGUgYWRhcHRlciBkZXJpdmVzIGl0IGhlcmUgZnJvbSB0aGUgc2FtZSBjb21tYW5kIHRleHRcbiAqIGFuZCB0aHJlYWRzIGl0IGludG8ge0BsaW5rIHJlc29sdmVDaGFuZ2VzZXR9IGV4cGxpY2l0bHkuIENvbnNlcnZhdGl2ZTogb25seSBhXG4gKiBzaG9ydC1mbGFnIGdyb3VwIGNvbnRhaW5pbmcgYGFgIChgLWFgLCBgLWFtYCwgYC1tYWApIG9yIGFuIGV4cGxpY2l0IGAtLWFsbGAsXG4gKiBzY2FubmVkIGJlZm9yZSBhbnkgYC0tYCBwYXRoc3BlYyBzZXBhcmF0b3IsIGNvdW50cy5cbiAqXG4gKiBWYWx1ZS10YWtpbmcgY29tbWl0IG9wdGlvbnMgKGAtbWAsIGAtLW1lc3NhZ2VgLCBgLUZgLCBgLUNgLCBcdTIwMjYpIGNvbnN1bWUgdGhlaXJcbiAqIGZvbGxvd2luZyB0b2tlbiwgc28gaXQgaXMgbmV2ZXIgc2Nhbm5lZCBhcyBhIGZsYWc6IGEgbWVzc2FnZSB3b3JkIGxpa2VcbiAqIGAtYW5hbHlzaXNgIGluIGBnaXQgY29tbWl0IC1tIFwiLWFuYWx5c2lzXCJgIG11c3Qgbm90IGJlIG1pc3JlYWQgYXMgdGhlXG4gKiBgLS1hbGxgLWVxdWl2YWxlbnQgc2hvcnQtZmxhZyBjbHVzdGVyIGFuZCB3aWRlbiB0aGUgY2hhbmdlc2V0LlxuICovXG5jb25zdCBDT01NSVRfVkFMVUVfT1BUSU9OUyA9IG5ldyBTZXQoW1xuICAnLW0nLFxuICAnLS1tZXNzYWdlJyxcbiAgJy1GJyxcbiAgJy0tZmlsZScsXG4gICctQycsXG4gICctLXJldXNlLW1lc3NhZ2UnLFxuICAnLWMnLFxuICAnLS1yZWVkaXQtbWVzc2FnZScsXG4gICctLWF1dGhvcicsXG4gICctLWRhdGUnLFxuICAnLXQnLFxuICAnLS10ZW1wbGF0ZScsXG4gICctLWZpeHVwJyxcbiAgJy0tc3F1YXNoJyxcbiAgJy0tdHJhaWxlcicsXG4gICctLWNsZWFudXAnLFxuICAnLS1ncGctc2lnbidcbl0pO1xuXG5leHBvcnQgZnVuY3Rpb24gY29tbWl0U3RhZ2VzQWxsKGNvbW1hbmQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc3BsaXRTZWdtZW50cyhjb21tYW5kKSkge1xuICAgIGNvbnN0IGludiA9IG1hdGNoR2l0SW52b2NhdGlvbih0b2tlbml6ZShzZWdtZW50KSk7XG4gICAgaWYgKCFpbnYgfHwgaW52LnN1YmNvbW1hbmQgIT09ICdjb21taXQnKSBjb250aW51ZTtcbiAgICBjb25zdCBkYXNoRGFzaCA9IGludi5hcmdzLmluZGV4T2YoJy0tJyk7XG4gICAgY29uc3QgZmxhZ0FyZ3MgPSBkYXNoRGFzaCA+PSAwID8gaW52LmFyZ3Muc2xpY2UoMCwgZGFzaERhc2gpIDogaW52LmFyZ3M7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBmbGFnQXJncy5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3QgYXJnID0gZmxhZ0FyZ3NbaV07XG4gICAgICBpZiAoYXJnID09PSAnLS1hbGwnKSByZXR1cm4gdHJ1ZTtcbiAgICAgIC8vIEEgdmFsdWUtdGFraW5nIG9wdGlvbiBjb25zdW1lcyBpdHMgZm9sbG93aW5nIHRva2VuIFx1MjAxNCBza2lwIHRoYXQgdG9rZW4gc29cbiAgICAgIC8vIGEgbWVzc2FnZS9hdXRob3IvZGF0ZSBhcmd1bWVudCBpcyBuZXZlciBzY2FubmVkIGFzIGFuIGAtYWAgY2x1c3Rlci5cbiAgICAgIGlmIChDT01NSVRfVkFMVUVfT1BUSU9OUy5oYXMoYXJnKSkge1xuICAgICAgICBpKys7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKCFhcmcuc3RhcnRzV2l0aCgnLS0nKSAmJiAvXi1bQS1aYS16XSphW0EtWmEtel0qJC8udGVzdChhcmcpKSByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLy8gU2hlbGwgY29udHJvbCBvcGVyYXRvcnMgdGhhdCBzZXBhcmF0ZSBvbmUgc2ltcGxlIGNvbW1hbmQgZnJvbSB0aGUgbmV4dC5cbi8vIFNwbGl0dGluZyBvbiB0aGVzZSAob3V0c2lkZSBxdW90ZXMpIGlzb2xhdGVzIGVhY2ggY29tbWFuZCBzbyBhIGBnaXQgY29tbWl0YC9cbi8vIGBnaXQgcHVzaGAgY2hhaW5lZCBhZnRlciBgJiZgL2A7YC9gfGAgaXMgZm91bmQsIHdoaWxlIHRleHQgaW5zaWRlIGEgcXVvdGVkXG4vLyBhcmd1bWVudCAoYGVjaG8gXCJnaXQgY29tbWl0XCJgKSBzdGF5cyB3aXRoaW4gaXRzIG93biBub24tZ2l0IHNlZ21lbnQuXG5jb25zdCBUV09fQ0hBUl9PUEVSQVRPUlMgPSBuZXcgU2V0KFsnJiYnLCAnfHwnXSk7XG5jb25zdCBPTkVfQ0hBUl9TRVBBUkFUT1JTID0gbmV3IFNldChbJzsnLCAnfCcsICdcXG4nLCAnJicsICcoJywgJyknXSk7XG5cbi8qKiBTcGxpdCBhIHNoZWxsIGNvbW1hbmQgaW50byBzaW1wbGUtY29tbWFuZCBzZWdtZW50cywgcmVzcGVjdGluZyBxdW90ZXMuICovXG5mdW5jdGlvbiBzcGxpdFNlZ21lbnRzKGNvbW1hbmQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgc2VnbWVudHM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjdXJyZW50ID0gJyc7XG4gIGxldCBxdW90ZTogJ1wiJyB8IFwiJ1wiIHwgbnVsbCA9IG51bGw7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgY29tbWFuZC5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGNoID0gY29tbWFuZFtpXTtcbiAgICBpZiAocXVvdGUpIHtcbiAgICAgIGN1cnJlbnQgKz0gY2g7XG4gICAgICBpZiAoY2ggPT09IHF1b3RlKSBxdW90ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSAnXCInIHx8IGNoID09PSBcIidcIikge1xuICAgICAgcXVvdGUgPSBjaDtcbiAgICAgIGN1cnJlbnQgKz0gY2g7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKFRXT19DSEFSX09QRVJBVE9SUy5oYXMoY29tbWFuZC5zbGljZShpLCBpICsgMikpKSB7XG4gICAgICBzZWdtZW50cy5wdXNoKGN1cnJlbnQpO1xuICAgICAgY3VycmVudCA9ICcnO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChPTkVfQ0hBUl9TRVBBUkFUT1JTLmhhcyhjaCkpIHtcbiAgICAgIHNlZ21lbnRzLnB1c2goY3VycmVudCk7XG4gICAgICBjdXJyZW50ID0gJyc7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY3VycmVudCArPSBjaDtcbiAgfVxuICBzZWdtZW50cy5wdXNoKGN1cnJlbnQpO1xuICByZXR1cm4gc2VnbWVudHM7XG59XG5cbi8qKlxuICogVG9rZW5pemUgb25lIHNlZ21lbnQgaW50byBzaGVsbCB3b3JkcywgcmVzcGVjdGluZyBzaW5nbGUvZG91YmxlIHF1b3RlcyBhbmRcbiAqIHN0cmlwcGluZyB0aGUgcXVvdGUgY2hhcmFjdGVycy4gRGVsaWJlcmF0ZWx5IG1pbmltYWwgKG5vIGV4cGFuc2lvbiwgbm9cbiAqIGVzY2FwZSBoYW5kbGluZyBiZXlvbmQgcXVvdGVzKTogdGhlIGdvYWwgaXMgY29uZmlkZW50IHJlY29nbml0aW9uIG9mIGFcbiAqIGBnaXQgY29tbWl0YC9gcHVzaGAgc2hhcGUsIG5vdCBhIGZ1bGwgc2hlbGwgcGFyc2VyLlxuICovXG5mdW5jdGlvbiB0b2tlbml6ZShzZWdtZW50OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHRva2Vuczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGN1cnJlbnQgPSAnJztcbiAgbGV0IGhhcyA9IGZhbHNlO1xuICBsZXQgcXVvdGU6ICdcIicgfCBcIidcIiB8IG51bGwgPSBudWxsO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHNlZ21lbnQubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjaCA9IHNlZ21lbnRbaV07XG4gICAgaWYgKHF1b3RlKSB7XG4gICAgICBpZiAoY2ggPT09IHF1b3RlKSBxdW90ZSA9IG51bGw7XG4gICAgICBlbHNlIGN1cnJlbnQgKz0gY2g7XG4gICAgICBoYXMgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gJ1wiJyB8fCBjaCA9PT0gXCInXCIpIHtcbiAgICAgIHF1b3RlID0gY2g7XG4gICAgICBoYXMgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gJyAnIHx8IGNoID09PSAnXFx0Jykge1xuICAgICAgaWYgKGhhcykge1xuICAgICAgICB0b2tlbnMucHVzaChjdXJyZW50KTtcbiAgICAgICAgY3VycmVudCA9ICcnO1xuICAgICAgICBoYXMgPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjdXJyZW50ICs9IGNoO1xuICAgIGhhcyA9IHRydWU7XG4gIH1cbiAgaWYgKGhhcykgdG9rZW5zLnB1c2goY3VycmVudCk7XG4gIHJldHVybiB0b2tlbnM7XG59XG5cbi8qKiBHaXQgZ2xvYmFsIG9wdGlvbnMgdGhhdCBjb25zdW1lIGEgc2VwYXJhdGUgZm9sbG93aW5nIHZhbHVlIHRva2VuLiAqL1xuY29uc3QgR0lUX1ZBTFVFX09QVElPTlMgPSBuZXcgU2V0KFtcbiAgJy1DJyxcbiAgJy1jJyxcbiAgJy0tZ2l0LWRpcicsXG4gICctLXdvcmstdHJlZScsXG4gICctLW5hbWVzcGFjZScsXG4gICctLXN1cGVyLXByZWZpeCcsXG4gICctLWV4ZWMtcGF0aCcsXG4gICctLWF0dHItc291cmNlJyxcbiAgJy0tY29uZmlnLWVudidcbl0pO1xuXG5pbnRlcmZhY2UgR2l0SW52b2NhdGlvbiB7XG4gIHN1YmNvbW1hbmQ6IHN0cmluZztcbiAgYXJnczogc3RyaW5nW107XG59XG5cbi8qKlxuICogSWYgYSBzZWdtZW50J3MgdG9rZW5zIGFyZSBhIGBnaXQgPHN1YmNvbW1hbmQ+IFx1MjAyNmAgaW52b2NhdGlvbiwgcmV0dXJuIHRoZVxuICogc3ViY29tbWFuZCBhbmQgaXRzIHJlbWFpbmluZyBhcmdzOyBvdGhlcndpc2UgYG51bGxgLiBMZWFkaW5nIGBWQVI9dmFsdWVgXG4gKiBlbnZpcm9ubWVudCBhc3NpZ25tZW50cyBhbmQgYGdpdGAgZ2xvYmFsIG9wdGlvbnMgKGluY2x1ZGluZyB0aGUgdmFsdWUtdGFraW5nXG4gKiBvbmVzKSBhcmUgc2tpcHBlZCBzbyB0aGUgc3ViY29tbWFuZCBpcyBjb3JyZWN0bHkgbG9jYXRlZC5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hHaXRJbnZvY2F0aW9uKHRva2Vuczogc3RyaW5nW10pOiBHaXRJbnZvY2F0aW9uIHwgbnVsbCB7XG4gIGxldCBpID0gMDtcbiAgd2hpbGUgKGkgPCB0b2tlbnMubGVuZ3RoICYmIC9eW0EtWmEtel9dW0EtWmEtejAtOV9dKj0vLnRlc3QodG9rZW5zW2ldKSkgaSsrO1xuICBpZiAoaSA+PSB0b2tlbnMubGVuZ3RoIHx8IHRva2Vuc1tpXSAhPT0gJ2dpdCcpIHJldHVybiBudWxsO1xuICBpKys7XG4gIHdoaWxlIChpIDwgdG9rZW5zLmxlbmd0aCkge1xuICAgIGNvbnN0IHQgPSB0b2tlbnNbaV07XG4gICAgaWYgKHQgPT09ICctLScpIHJldHVybiBudWxsOyAvLyBhIGAtLWAgYmVmb3JlIGFueSBzdWJjb21tYW5kIGlzIG5vdCBhIHNoYXBlIHdlIHJlY29nbml6ZVxuICAgIGlmICghdC5zdGFydHNXaXRoKCctJykpIGJyZWFrO1xuICAgIGkgKz0gR0lUX1ZBTFVFX09QVElPTlMuaGFzKHQpID8gMiA6IDE7XG4gIH1cbiAgaWYgKGkgPj0gdG9rZW5zLmxlbmd0aCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IHN1YmNvbW1hbmQ6IHRva2Vuc1tpXSwgYXJnczogdG9rZW5zLnNsaWNlKGkgKyAxKSB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENoYW5nZXNldCByZXNvbHV0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBUaGUgaW5qZWN0ZWQgZ2l0IHN1cmZhY2Uge0BsaW5rIHJlc29sdmVDaGFuZ2VzZXR9IG5lZWRzIHRvIHR1cm4gYSBwYXJzZWRcbiAqIGNvbW1hbmQgaW50byB0aGUgY29uY3JldGUgbGlzdCBvZiBwYXRocyB0aGF0IHdvdWxkIGxhbmQuIEtlcHQgYXMgbmFycm93IGFzeW5jXG4gKiBmdW5jdGlvbnMgKHJhdGhlciB0aGFuIGEgcmF3IGNvbW1hbmQgcnVubmVyKSBmb2xsb3dpbmcgYHRvdWNoLWNvcmUudHNgJ3NcbiAqIGBUb3VjaEV4ZWN1dG9yc2AgcGF0dGVybiwgc28gUGhhc2UgMy4yJ3MgdGVzdHMgZmFrZSB0aGUgcmVwbyBzdGF0ZSB3aXRob3V0IGFcbiAqIHJlYWwgc3VicHJvY2VzcyBhbmQgdGhlIGNvcmUgbmV2ZXIgc3Bhd25zIG9uZSBpdHNlbGYuXG4gKlxuICogQWxsIHJldHVybmVkIHBhdGhzIGFyZSByZXBvLXJlbGF0aXZlIFBPU0lYIHBhdGhzLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEdpdEV4ZWN1dG9yIHtcbiAgLyoqXG4gICAqIFBhdGhzIHN0YWdlZCBmb3IgdGhlIG5leHQgY29tbWl0IFx1MjAxNCBgZ2l0IGRpZmYgLS1jYWNoZWQgLS1uYW1lLW9ubHlgLiBUaGVzZVxuICAgKiBhcmUgd2hhdCBhIHBsYWluIGBnaXQgY29tbWl0YCB3b3VsZCBsYW5kLlxuICAgKi9cbiAgc3RhZ2VkUGF0aHMoY3dkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZ1tdPjtcbiAgLyoqXG4gICAqIFRyYWNrZWQgZmlsZXMgd2l0aCB1bnN0YWdlZCB3b3JraW5nLXRyZWUgbW9kaWZpY2F0aW9ucyBcdTIwMTRcbiAgICogYGdpdCBkaWZmIC0tbmFtZS1vbmx5YC4gRm9sZGVkIGludG8gdGhlIGNoYW5nZXNldCBvbmx5IGZvciBgLWFgL2AtYW1gXG4gICAqIGZvcm1zLCB3aGljaCBzdGFnZSB0cmFja2VkLW1vZGlmaWVkIGZpbGVzIGltcGxpY2l0bHkgYXQgY29tbWl0IHRpbWUuXG4gICAqL1xuICB0cmFja2VkTW9kaWZpZWRQYXRocyhjd2Q6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nW10+O1xuICAvKipcbiAgICogUGF0aHMgaW4gdGhlIG91dGdvaW5nIHB1c2ggcmFuZ2UgXHUyMDE0IHRoZSBmaWxlcyBjaGFuZ2VkIGJ5IGBAe3V9Li5IRUFEYCwgd2l0aFxuICAgKiBhIG1lcmdlLWJhc2UtYWdhaW5zdC10aGUtZGVmYXVsdC1yZW1vdGUtYnJhbmNoIGZhbGxiYWNrIHdoZW4gbm8gdXBzdHJlYW0gaXNcbiAgICogY29uZmlndXJlZC4gVGhlc2UgYXJlIHdoYXQgYSBgZ2l0IHB1c2hgIHdvdWxkIHB1Ymxpc2guXG4gICAqL1xuICBvdXRnb2luZ1BhdGhzKGN3ZDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmdbXT47XG4gIC8qKlxuICAgKiBQYXRocyB1bmRlciB0aGUgZ2l2ZW4gZXhwbGljaXQgcGF0aHNwZWNzIHdob3NlIHdvcmtpbmctdHJlZSBjb250ZW50IGRpZmZlcnNcbiAgICogZnJvbSBgSEVBRGAgXHUyMDE0IGBnaXQgZGlmZiBIRUFEIC0tbmFtZS1vbmx5IC0tIDxwYXRoc3BlY3M+YC4gVGhpcyBpcyB3aGF0IGFcbiAgICogcGF0aHNwZWMtc2NvcGVkIGNvbW1pdCAoYGdpdCBjb21taXQgLS0gPHBhdGhzcGVjPlx1MjAyNmApIGFjdHVhbGx5IGxhbmRzOiB0aGVcbiAgICogY3VycmVudCB3b3JraW5nLXRyZWUgY29udGVudCBhdCB0aG9zZSBwYXRoc3BlY3MsIHJlZ2FyZGxlc3Mgb2Ygd2hhdCBlbHNlIGlzXG4gICAqIHN0YWdlZC4gVXNlZCB0byBzY29wZSB0aGUgY2hhbmdlc2V0IHdoZW4ge0BsaW5rIFBhcnNlZEdpdENvbW1hbmQucGF0aHN9IGlzXG4gICAqIHByZXNlbnQsIHNvIHRoZSBnYXRlIGV2YWx1YXRlcyBleGFjdGx5IHRoZSBmaWxlcyB0aGlzIGNvbW1pdCB0YWtlcyBcdTIwMTQgbmV2ZXJcbiAgICogYW4gdW5yZWxhdGVkIHN0YWdlZCBmaWxlLCBhbmQgbmV2ZXIgbWlzc2luZyBhIG1vZGlmaWVkLWJ1dC11bnN0YWdlZCBmaWxlXG4gICAqIG5hbWVkIGluIHRoZSBwYXRoc3BlYyAod2hpY2ggYGdpdCBkaWZmIC0tY2FjaGVkYCB3b3VsZCBuZXZlciBzdXJmYWNlKS5cbiAgICovXG4gIHBhdGhzcGVjUGF0aHMocGF0aHM6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nW10+O1xufVxuXG4vKipcbiAqIFJlc29sdmUgdGhlIGNvbmNyZXRlIGxpc3Qgb2YgcmVwby1yZWxhdGl2ZSBwYXRocyBhIGdhdGVkIGNvbW1hbmQgd291bGQgbGFuZCxcbiAqIHNvIHRoZSBnYXRlIGNhbiBzY29wZSBpdHMgc3RhbGVuZXNzL2NvdmVyYWdlIGNoZWNrIHRvIGV4YWN0bHkgdGhhdCBjaGFuZ2VzZXQuXG4gKlxuICogLSBgY29tbWl0YCB3aXRoIGV4cGxpY2l0IGBwYXRoc2AgKGEgYGdpdCBjb21taXQgLS0gPHBhdGhzcGVjPlx1MjAyNmAgZm9ybSk6IG9ubHlcbiAqICAgdGhlIHdvcmtpbmctdHJlZSBjb250ZW50IHVuZGVyIHRob3NlIHBhdGhzcGVjcyAoYHBhdGhzcGVjUGF0aHNgKSwgc2luY2UgYVxuICogICBwYXRoc3BlYy1zY29wZWQgY29tbWl0IGxhbmRzIGV4YWN0bHkgdGhhdCwgcmVnYXJkbGVzcyBvZiB0aGUgcmVzdCBvZiB0aGVcbiAqICAgc3RhZ2VkIHNldC4gYGFsbGAgaXMgaWdub3JlZCBcdTIwMTQgYC1hYCBhbmQgYW4gZXhwbGljaXQgcGF0aHNwZWMgZG8gbm90IGNvbWJpbmUuXG4gKiAtIGBjb21taXRgLCBubyBgcGF0aHNgOiB0aGUgc3RhZ2VkIHBhdGhzLCBwbHVzIFx1MjAxNCB3aGVuIGBhbGxgIGlzIHRydWUgKHRoZVxuICogICBjb21tYW5kIHdhcyBhbiBgLWFgL2AtYW1gIGZvcm0pIFx1MjAxNCB0aGUgdHJhY2tlZC1tb2RpZmllZCBwYXRocyB0aG9zZSBmb3Jtc1xuICogICBzdGFnZSBpbXBsaWNpdGx5LlxuICogLSBgcHVzaGA6IHRoZSBvdXRnb2luZyByYW5nZSBgQHt1fS4uSEVBRGAsIHdpdGggYSBtZXJnZS1iYXNlIGZhbGxiYWNrIHdoZW4gbm9cbiAqICAgdXBzdHJlYW0gaXMgY29uZmlndXJlZC4gYGFsbGAvYHBhdGhzYCBhcmUgbm90IG1lYW5pbmdmdWwgZm9yIGEgcHVzaCBhbmQgYXJlXG4gKiAgIGlnbm9yZWQuXG4gKlxuICogVGhlIGBhbGxgIGZsYWcgYW5kIGBwYXRoc2AgYXJlIHRocmVhZGVkIGluIGV4cGxpY2l0bHkgKHJhdGhlciB0aGFuIHJlYWQgYmFja1xuICogb3V0IG9mIHRoZSBjb21tYW5kKSBiZWNhdXNlIHRoZSBjYWxsZXIvYWRhcHRlciBkZXJpdmVzIHRoZW0gZnJvbSB0aGUgcGFyc2U6XG4gKiBgcGF0aHNgIGlzIHtAbGluayBQYXJzZWRHaXRDb21tYW5kLnBhdGhzfSwgYW5kIGBhbGxgICh3aGljaCB7QGxpbmsgUGFyc2VkR2l0Q29tbWFuZH1cbiAqIGludGVudGlvbmFsbHkgZG9lcyBub3QgY2FycnkpIGNvbWVzIGZyb20ge0BsaW5rIGNvbW1pdFN0YWdlc0FsbH0uXG4gKlxuICogQHBhcmFtIGtpbmQgV2hldGhlciB0aGUgY2hhbmdlc2V0IGlzIGEgY29tbWl0J3Mgc3RhZ2VkIHNldCBvciBhIHB1c2gncyByYW5nZS5cbiAqIEBwYXJhbSBhbGwgV2hldGhlciB0aGUgY29tbWl0IHdhcyBhbiBgLWFgL2AtYW1gIGZvcm0gKGlnbm9yZWQgZm9yIGBwdXNoYCkuXG4gKiBAcGFyYW0gY3dkIFRoZSB3b3JraW5nIGRpcmVjdG9yeSB0aGUgZ2l0IGNvbW1hbmQgcmFuIGluLlxuICogQHBhcmFtIGdpdCBUaGUgaW5qZWN0ZWQgZ2l0IHN1cmZhY2UgYmFja2luZyB0aGUgcmVzb2x1dGlvbi5cbiAqIEBwYXJhbSBwYXRocyBFeHBsaWNpdCBwYXRoc3BlY3MgZnJvbSBgZ2l0IGNvbW1pdCAtLSA8cGF0aHNwZWM+XHUyMDI2YCwgaWYgYW55LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUNoYW5nZXNldChcbiAga2luZDogJ2NvbW1pdCcgfCAncHVzaCcsXG4gIGFsbDogYm9vbGVhbixcbiAgY3dkOiBzdHJpbmcsXG4gIGdpdDogR2l0RXhlY3V0b3IsXG4gIHBhdGhzPzogc3RyaW5nW11cbik6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgaWYgKGtpbmQgPT09ICdwdXNoJykge1xuICAgIHJldHVybiBnaXQub3V0Z29pbmdQYXRocyhjd2QpO1xuICB9XG4gIC8vIEEgcGF0aHNwZWMtc2NvcGVkIGNvbW1pdCBsYW5kcyBvbmx5IHRoZSB3b3JraW5nLXRyZWUgY29udGVudCBhdCB0aG9zZVxuICAvLyBwYXRoc3BlY3MgXHUyMDE0IHNjb3BlIHRoZSBjaGFuZ2VzZXQgdG8gZXhhY3RseSB0aGF0LCBuZXZlciB0aGUgZnVsbCBzdGFnZWQgc2V0LlxuICBpZiAocGF0aHMgJiYgcGF0aHMubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiBnaXQucGF0aHNwZWNQYXRocyhwYXRocywgY3dkKTtcbiAgfVxuICBjb25zdCBzdGFnZWQgPSBhd2FpdCBnaXQuc3RhZ2VkUGF0aHMoY3dkKTtcbiAgaWYgKCFhbGwpIHJldHVybiBzdGFnZWQ7XG4gIGNvbnN0IHRyYWNrZWQgPSBhd2FpdCBnaXQudHJhY2tlZE1vZGlmaWVkUGF0aHMoY3dkKTtcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBjb25zdCBtZXJnZWQ6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgcGF0aCBvZiBbLi4uc3RhZ2VkLCAuLi50cmFja2VkXSkge1xuICAgIGlmIChzZWVuLmhhcyhwYXRoKSkgY29udGludWU7XG4gICAgc2Vlbi5hZGQocGF0aCk7XG4gICAgbWVyZ2VkLnB1c2gocGF0aCk7XG4gIH1cbiAgcmV0dXJuIG1lcmdlZDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBHYXRlIGV2YWx1YXRpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFRoZSBpbmplY3RlZCBleGVjdXRpb24gc3VyZmFjZSBnYXRlIGV2YWx1YXRpb24gbmVlZHMgXHUyMDE0IHRoZSBgZml4YC9gc3RhbGVgL1xuICogYGxpc3RgIGFzeW5jIGZ1bmN0aW9ucywgbWlycm9yaW5nIGB0b3VjaC1jb3JlLnRzYCdzIGBUb3VjaEV4ZWN1dG9yc2AuIFRlc3RzXG4gKiBpbmplY3QgZmFrZXMgcmV0dXJuaW5nIHN0cnVjdHVyZWQgZGF0YTsgdGhlIGNvcmUgbmV2ZXIgc3Bhd25zIGEgc3VicHJvY2Vzc1xuICogaXRzZWxmLiBBbGwgcGF0aHMgYXJlIHJlcG8tcmVsYXRpdmUgUE9TSVggcGF0aHMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgR2F0ZUV4ZWN1dG9ycyB7XG4gIC8qKlxuICAgKiBSdW4gYSBzY29wZWQgYGdpdCBzcGFuIHN0YWxlIDxwYXRocz4gLS1maXhgIFx1MjAxNCB0aGUgYmVsdC1hbmQtYnJhY2VzIGhlYWwgdGhhdFxuICAgKiBydW5zIGJlZm9yZSBjbGFzc2lmaWNhdGlvbiAocGVyIENBUkQubWQpLCByZS1hbmNob3JpbmcgYW55IHBvc2l0aW9uYWwgZHJpZnRcbiAgICogaW4gdGhlIGNoYW5nZXNldCB0aGF0IHRoZSB0b3VjaCBob29rIGhhcyBub3QgYWxyZWFkeSBoZWFsZWQuIFJlcG9ydHMgbm90aGluZztcbiAgICogaXRzIGVmZmVjdCBpcyBvbiB0aGUgd29ya2luZyB0cmVlLCBhbmQgdGhlIHN1YnNlcXVlbnQge0BsaW5rIEdhdGVFeGVjdXRvcnMuc3RhbGV9XG4gICAqIHJlYWQgb2JzZXJ2ZXMgdGhlIGhlYWxlZCBzdGF0ZS5cbiAgICovXG4gIGZpeChwYXRoczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPjtcbiAgLyoqXG4gICAqIFJ1biBhIHNjb3BlZCBgZ2l0IHNwYW4gc3RhbGUgLS1mb3JtYXQgcG9yY2VsYWluIDxwYXRocz5gIGFuZCByZXR1cm4gaXRzXG4gICAqIHBhcnNlZCByb3dzIFx1MjAxNCBvbmUgcGVyIGRyaWZ0ZWQgYW5jaG9yIGFtb25nIHRoZSBjaGFuZ2VzZXQncyBzcGFucywgZW1wdHkgd2hlblxuICAgKiBjbGVhbi4gRGVidCBpcyBjbGFzc2lmaWVkIGZyb20gdGhlc2Ugcm93cyB2aWEgYGlzRGVidCgpYDsgcG9zaXRpb25hbFxuICAgKiAoYE1PVkVEYC9gUkVTT0xWRURfUEVORElOR19DT01NSVRgKSByb3dzIGFyZSBuZXZlciBkZWJ0IGFuZCBuZXZlciBkZW55LlxuICAgKlxuICAgKiBBbiBlbXB0eSByZXN1bHQgbXVzdCBtZWFuIHRoZSBzY2FuICpyYW4gYW5kIGZvdW5kIG5vdGhpbmcqLCBuZXZlciB0aGF0IHRoZVxuICAgKiBzY2FuICpjb3VsZCBub3QgcnVuKi4gV2hlbiB0aGUgc2NvcGVkIHF1ZXJ5IGFib3J0cyBiZWZvcmUgY29tcGxldGluZyAoZS5nLlxuICAgKiBhbiB1bnJlYWRhYmxlIGFuY2hvciBmaWxlKSwgdGhlIGltcGxlbWVudGF0aW9uIHRocm93cyB7QGxpbmsgR2F0ZVNjYW5FcnJvcn1cbiAgICogcmF0aGVyIHRoYW4gcmV0dXJuaW5nIGBbXWAsIHNvIHtAbGluayBldmFsdWF0ZUdhdGV9IGRvZXMgbm90IG1pc3Rha2UgYW5cbiAgICogYWJvcnRlZCBzY2FuIGZvciBhIGNsZWFuIG9uZSBhbmQgc2lsZW50bHkgYWxsb3cgdW52ZXJpZmllZCBkZWJ0IHRocm91Z2guXG4gICAqL1xuICBzdGFsZShwYXRoczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKTogUHJvbWlzZTxTdGFsZVBvcmNlbGFpblJvd1tdPjtcbiAgLyoqXG4gICAqIFJ1biBhIHNjb3BlZCBgZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbiA8cGF0aHM+YCBhbmQgcmV0dXJuIHRoZSBjb3ZlcmluZ1xuICAgKiBhbmNob3JzLiBVc2VkIHRvIGNvbXB1dGUgKnVuY292ZXJlZCB3cml0ZXMqOiBhIGNoYW5nZWQgcGF0aCB3aXRoIHplcm9cbiAgICogY292ZXJpbmcgcm93cyBoZXJlIChtaW51cyBgLnNwYW4vKipgLCBnaXRpZ25vcmVkIHBhdGhzLCBhbmRcbiAgICogYC5zcGFuLy5nYXRlaWdub3JlYC1leGNsdWRlZCBwYXRocyBcdTIwMTQgc2VlIHtAbGluayBmaWxlOi8vLi9nYXRlLWlnbm9yZS50c30pXG4gICAqIGlzIGFuIHVuY292ZXJlZCB3cml0ZS5cbiAgICovXG4gIGxpc3QocGF0aHM6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZyk6IFByb21pc2U8UG9yY2VsYWluUm93W10+O1xufVxuXG4vKipcbiAqIFRoZSBnYXRlJ3MgcGVyLWNoYW5nZXNldCBtZW1vIFx1MjAxNCBcImhhdmUgSSBhbHJlYWR5IHByZXNlbnRlZCB0aGlzIGV4YWN0IGRlYnRcbiAqIHN0YXRlIG9uY2U/XCIgVGhlIHBlcnNpc3RlZCB1bml0IGlzIGEgZGlnZXN0IG9mIHRoZSBzb3J0ZWQgc3RhbGVuZXNzIGZpbmRpbmdzXG4gKiBwbHVzIHRoZSBzb3J0ZWQgdW5jb3ZlcmVkIHBhdGhzIChkZXNpZ24tZGVjaXNpb25zLm1kICM5J3MgXCJnYXRlIG9uY2UgcGVyXG4gKiBkaXN0aW5jdCBkZWJ0LXN0YXRlXCIpOyB0aGUgZGlzay1iYWNrZWQgaW1wbGVtZW50YXRpb24gc3RvcmVzIG9uZSBtYXJrZXIgcGVyXG4gKiBkaWdlc3QgdW5kZXIge0BsaW5rIGdhdGVNZW1vRGlyfSAoYDxnaXQtY29tbW9uLWRpcj4vZ2l0LXNwYW4vZ2F0ZS9gKSwgd2hlcmVcbiAqIHByZXNlbmNlIG1lYW5zIFwiYWxyZWFkeSBwcmVzZW50ZWQgb25jZS5cIiBJbmplY3RlZCBhcyBhIHN0b3JlIGFic3RyYWN0aW9uXG4gKiAobGlrZSBzcGFuLXN1cmZhY2UudHMncyBgTWVtb1N0b3JlYCkgc28gUGhhc2UgMy4yIGZha2VzIGl0IGluIG1lbW9yeS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBHYXRlTWVtb1N0YXRlIHtcbiAgLyoqIFdoZXRoZXIgdGhpcyBleGFjdCBkZWJ0LXN0YXRlIGRpZ2VzdCBoYXMgYWxyZWFkeSBiZWVuIHByZXNlbnRlZCBvbmNlLiAqL1xuICBoYXMoZGlnZXN0OiBzdHJpbmcpOiBib29sZWFuO1xuICAvKipcbiAgICogUmVjb3JkIHRoYXQgdGhpcyBkZWJ0LXN0YXRlIGRpZ2VzdCBoYXMgbm93IGJlZW4gcHJlc2VudGVkLCByZXR1cm5pbmdcbiAgICogd2hldGhlciB0aGUgcmVjb3JkIGFjdHVhbGx5IHBlcnNpc3RlZC4gYGZhbHNlYCBtZWFucyB0aGUgbWVtbyBjb3VsZCBub3QgYmVcbiAgICogd3JpdHRlbiAoZS5nLiBhbiB1bndyaXRhYmxlIG1lbW8gZGlyZWN0b3J5KSBcdTIwMTQgdGhlIGdhdGUgdHJlYXRzIHRoYXQgYXMgYVxuICAgKiBmYWlsLW9wZW4gc2lnbmFsIHJhdGhlciB0aGFuIGRlbnlpbmcsIGJlY2F1c2UgYSBub24tcGVyc2lzdGluZyBtZW1vIHdvdWxkXG4gICAqIHNpbGVudGx5IHR1cm4gXCJkZW55IG9uY2UsIHRoZW4gYWxsb3cgdGhlIGlkZW50aWNhbCByZXRyeVwiIGludG8gXCJkZW55IGV2ZXJ5XG4gICAqIHRpbWVcIiB3aXRoIG5vIGVzY2FwZS5cbiAgICovXG4gIHJlY29yZChkaWdlc3Q6IHN0cmluZyk6IGJvb2xlYW47XG59XG5cbi8qKlxuICogVGhlIGdhdGUncyBkZWNpc2lvbiBmb3Igb25lIGNvbW1hbmQsIGFzIGEgZGlzY3JpbWluYXRlZCB1bmlvbiB0aGUgYWRhcHRlclxuICogdHJhbnNsYXRlcyBpbnRvIGBwZXJtaXNzaW9uRGVjaXNpb246ICdkZW55J2AvYWxsb3cgKENsYXVkZSkgb3IgYSBibG9jay9hbGxvd1xuICogKENvZGV4KS4gYGRlY2lzaW9uYCBpcyB0aGUgY29hcnNlIGFsbG93L2RlbnkgdGhlIGhhcm5lc3MgYWN0cyBvbjsgYGtpbmRgXG4gKiByZWNvcmRzICp3aHkqLCBzbyB0aGUgYWRhcHRlciByZW5kZXJzIHRoZSByaWdodCBtZXNzYWdlIGFuZCBzbyB0ZXN0cyBhc3NlcnRcbiAqIHRoZSBleGFjdCBicmFuY2guXG4gKlxuICogLSBgYWxsb3dgIC8gYHNpbGVudGAgXHUyMDE0IG5vdGhpbmcgdG8gY2hlY2sgKG5vIHBhdGhzKSBvciB0aGUgY2hhbmdlc2V0IGlzIGNsZWFuO1xuICogICBhbGxvdyB3aXRoIG5vIG91dHB1dC4gSW50ZXJuYWwgZXJyb3JzIGFuZCBwYXJzZSBmYWlsdXJlcyBhbHNvIHJlc29sdmUgaGVyZTpcbiAqICAgdGhlIGdhdGUgZmFpbHMgb3BlbiBhbmQgbXVzdCBuZXZlciBicmljayBhIGNvbW1pdC5cbiAqIC0gYGFsbG93YCAvIGBhbHJlYWR5LXByZXNlbnRlZGAgXHUyMDE0IGRlYnQgaXMgcHJlc2VudCwgYnV0IHRoaXMgZXhhY3QgZGVidCBzdGF0ZVxuICogICB3YXMgYWxyZWFkeSBwcmVzZW50ZWQgb25jZSAodW5jb3ZlcmVkLXdyaXRlcyBjb25zaWRlci1vbmNlLCBvciBhbiB1bmNoYW5nZWRcbiAqICAgc3RhdGUpLiBUaGUgY29tbWFuZCBwYXNzZXMuXG4gKiAtIGBhbGxvd2AgLyBgZW52aXJvbm1lbnRhbGAgXHUyMDE0IHRoZSBjaGFuZ2VzZXQncyBvbmx5IHN0YWxlbmVzcyByb3dzIGFyZVxuICogICB0ZXJtaW5hbC9lbnZpcm9ubWVudGFsIGNvbmRpdGlvbnMgKGBDT05GTElDVGAsIGBTVUJNT0RVTEVgLCBgTEZTXypgLFxuICogICBgUFJPTUlTT1JfTUlTU0lOR2AsIGBTUEFSU0VfRVhDTFVERURgLCBgRklMVEVSX0ZBSUxFRGAsIGBJT19FUlJPUmApIHRoZSBDTElcbiAqICAgY291bGQgbm90IHJlc29sdmUgYXQgYWxsIFx1MjAxNCBub3Qgc3BhbiBkcmlmdCBhIHVzZXIgY2FuIGZpeCBieSBlZGl0aW5nIGEgc3Bhbi5cbiAqICAgVGhlIGdhdGUgZmFpbHMgT1BFTiAoYWxsb3cpIGJ1dCBjYXJyaWVzIGBjb25kaXRpb25zYC9gcmVhc29uYCBzbyB0aGUgYWRhcHRlclxuICogICBzdXJmYWNlcyB0aGUgY29uZGl0aW9uIGluc3RlYWQgb2Ygc3dhbGxvd2luZyBpdC4gRGVueWluZyBoZXJlIHdvdWxkIHJlLWRlbnlcbiAqICAgZm9yZXZlciBvbiBhbiBpbmZyYSBmYWlsdXJlIHRoZSB1c2VyIGNhbm5vdCBjbGVhciBmcm9tIHRoZSBnYXRlLlxuICogLSBgZGVueWAgLyBgc2VtYW50aWMtc3RhbGVuZXNzYCBcdTIwMTQgdGhlIGNoYW5nZXNldCBjYXJyaWVzIHNlbWFudGljIHN0YWxlbmVzcy5cbiAqICAgRGVueSB3aXRoIGBmaW5kaW5nc2AgcmVuZGVyZWQgYXMgYSBjaGVja2xpc3QgaW4gYHJlYXNvbmA7IHJlLWRlbmllcyBvbiBldmVyeVxuICogICByZXRyeSB1bnRpbCB0aGUgZmluZGluZ3MgY2hhbmdlIChzdGFsZW5lc3MgaXMgaGFyZC11bnRpbC1yZXNvbHZlZCkuXG4gKiAtIGBkZW55YCAvIGB1bmNvdmVyZWQtd3JpdGVzYCBcdTIwMTQgdGhlIGNoYW5nZXNldCBoYXMgY2hhbmdlZCBmaWxlcyBubyBzcGFuXG4gKiAgIGNvdmVycywgYW5kIHRoaXMgc3RhdGUgaGFzIG5vdCBiZWVuIHByZXNlbnRlZCBiZWZvcmUuIERlbnkgKipvbmNlKiosIGxpc3RpbmdcbiAqICAgYHVuY292ZXJlZGA7IHRoZSByZXRyeSB3aXRoIGFuIHVuY2hhbmdlZCBzdGF0ZSByZXNvbHZlcyB0byBgYWxyZWFkeS1wcmVzZW50ZWRgXG4gKiAgIGFuZCBwYXNzZXMgKGNvbnNpZGVyLW9uY2UsIHBlciBkZXNpZ24tZGVjaXNpb25zLm1kICMzKS5cbiAqIC0gYGRlbnlgIC8gYHNjYW4tZmFpbGVkYCBcdTIwMTQgYGdpdCBzcGFuIHN0YWxlYCBjb3VsZCBub3QgKmNvbXBsZXRlKiBpdHMgc2NvcGVkXG4gKiAgIHNjYW4gKGEge0BsaW5rIEdhdGVTY2FuRXJyb3J9LCBlLmcuIGFuIHVucmVhZGFibGUgYW5jaG9yIGZpbGUgYWJvcnRpbmcgdGhlXG4gKiAgIHdob2xlIHF1ZXJ5KS4gVGhpcyBpcyBkaXN0aW5jdCBmcm9tIGJvdGggYGVudmlyb25tZW50YWxgICh0aGUgc2NhbiBjb21wbGV0ZWRcbiAqICAgYW5kIGNhcnJpZWQgdGVybWluYWwgcm93cykgYW5kIGEgY2xlYW4gcGFzcyAodGhlIHNjYW4gY29tcGxldGVkIHdpdGggemVyb1xuICogICByb3dzKTogdGhlIHNjYW4gbmV2ZXIgcmFuIHRvIGNvbXBsZXRpb24sIHNvIGl0cyBlbXB0eSByZXN1bHQgaXMgbm90IGV2aWRlbmNlXG4gKiAgIG9mIFwibm8gZGVidC5cIiBUaGUgZ2F0ZSBmYWlscyBDTE9TRUQgaGVyZSBcdTIwMTQgYW4gdW52ZXJpZmlhYmxlIGNoYW5nZXNldCBtdXN0IG5vdFxuICogICByZWFkIGFzIGNsZWFuIFx1MjAxNCByZS1kZW55aW5nIHVudGlsIHRoZSBzY2FuIGNhbiBydW4sIHdpdGggYHJlYXNvbmAgbmFtaW5nIHRoZVxuICogICBmYWlsdXJlIGFuZCB0aGUgZXNjYXBlIGhhdGNoIGFzIHRoZSBkZWxpYmVyYXRlIG92ZXJyaWRlLlxuICovXG5leHBvcnQgdHlwZSBHYXRlUmVzdWx0ID1cbiAgfCB7IGRlY2lzaW9uOiAnYWxsb3cnOyBraW5kOiAnc2lsZW50JyB9XG4gIHwgeyBkZWNpc2lvbjogJ2FsbG93Jzsga2luZDogJ2FscmVhZHktcHJlc2VudGVkJyB9XG4gIHwgeyBkZWNpc2lvbjogJ2FsbG93Jzsga2luZDogJ2Vudmlyb25tZW50YWwnOyBjb25kaXRpb25zOiBTdGFsZVBvcmNlbGFpblJvd1tdOyByZWFzb246IHN0cmluZyB9XG4gIHwgeyBkZWNpc2lvbjogJ2RlbnknOyBraW5kOiAnc2VtYW50aWMtc3RhbGVuZXNzJzsgZmluZGluZ3M6IFN0YWxlUG9yY2VsYWluUm93W107IHJlYXNvbjogc3RyaW5nIH1cbiAgfCB7IGRlY2lzaW9uOiAnZGVueSc7IGtpbmQ6ICd1bmNvdmVyZWQtd3JpdGVzJzsgdW5jb3ZlcmVkOiBzdHJpbmdbXTsgcmVhc29uOiBzdHJpbmcgfVxuICB8IHsgZGVjaXNpb246ICdkZW55Jzsga2luZDogJ3NjYW4tZmFpbGVkJzsgcmVhc29uOiBzdHJpbmcgfTtcblxuLyoqXG4gKiBFdmFsdWF0ZSB0aGUgZ2F0ZSBmb3IgYSByZXNvbHZlZCBjaGFuZ2VzZXQgYW5kIGRlY2lkZSB3aGV0aGVyIHRvIGhvbGQgdGhlXG4gKiBjb21tYW5kLlxuICpcbiAqIFJ1bnMgYGV4ZWN1dG9ycy5maXhgIChzY29wZWQgYmVsdC1hbmQtYnJhY2VzIGBzdGFsZSAtLWZpeGApLCB0aGVuIHJlYWRzXG4gKiBgZXhlY3V0b3JzLnN0YWxlYCBhbmQgY2xhc3NpZmllcyBlYWNoIGRlYnQgcm93IChgaXNEZWJ0KClgKSBpbnRvICpzZW1hbnRpYypcbiAqIGRyaWZ0IGFuZCAqZW52aXJvbm1lbnRhbCogY29uZGl0aW9ucyAoYGlzRW52aXJvbm1lbnRhbFN0YXR1cygpYCkuIFNlbWFudGljXG4gKiBkcmlmdCAoYENIQU5HRURgL2BERUxFVEVEYCkgXHUyMTkyIGBkZW55YC9gc2VtYW50aWMtc3RhbGVuZXNzYCwgcmUtYmxvY2tpbmcgdW50aWxcbiAqIHRoZSBmaW5kaW5ncyBjaGFuZ2UuIEVudmlyb25tZW50YWwgY29uZGl0aW9ucyB0aGUgQ0xJIGNvdWxkIG5vdCByZXNvbHZlIGF0IGFsbFxuICogKGBDT05GTElDVGAvYFNVQk1PRFVMRWAvYExGU18qYC9gUFJPTUlTT1JfTUlTU0lOR2AvYFNQQVJTRV9FWENMVURFRGAvXG4gKiBgRklMVEVSX0ZBSUxFRGAvYElPX0VSUk9SYCkgXHUyMTkyIGBhbGxvd2AvYGVudmlyb25tZW50YWxgOiBmYWlsIE9QRU4sIHN1cmZhY2luZyB0aGVcbiAqIGNvbmRpdGlvbiByYXRoZXIgdGhhbiBkZW55aW5nIG9uIGFuIGluZnJhIGZhaWx1cmUgYSBzcGFuIGVkaXQgY2Fubm90IGZpeC5cbiAqIFVuY292ZXJlZCB3cml0ZXMgKGNoYW5nZWQgcGF0aHMgd2l0aCB6ZXJvIGNvdmVyYWdlIGZyb20gYGV4ZWN1dG9ycy5saXN0YCxcbiAqIG1pbnVzIGAuc3Bhbi8qKmAsIGFuZCBwYXRocyBtYXRjaGVkIGJ5IHRoZSByZXBvJ3MgYC5zcGFuLy5nYXRlaWdub3JlYCBcdTIwMTQgc2VlXG4gKiB7QGxpbmsgZmlsZTovLy4vZ2F0ZS1pZ25vcmUudHN9LCBsb2FkZWQgZGlyZWN0bHkgZnJvbSBkaXNrIHZpYVxuICogYHJlc29sdmVSZXBvUm9vdChjd2QpYCwgZmFpbC1vcGVuIHdoZW4gYWJzZW50L3VucmVhZGFibGUpIFx1MjE5MlxuICogYGRlbnlgL2B1bmNvdmVyZWQtd3JpdGVzYCB0aGUgZmlyc3QgdGltZSB0aGF0IHN0YXRlIGlzIHNlZW4sIHRoZW5cbiAqIGBhbGxvd2AvYGFscmVhZHktcHJlc2VudGVkYCBvbiByZXRyeS4gYE1PVkVEYCBhbmQgYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYFxuICogbmV2ZXIgY29udHJpYnV0ZSB0byBhbnkgYnJhbmNoIGFuZCBuZXZlciBkZW55LiBUaGUgZGlzdGluY3QtZGVidC1zdGF0ZSBkaWdlc3RcbiAqIChzb3J0ZWQgdW5jb3ZlcmVkIHBhdGhzKSBpcyBjaGVja2VkIGFuZCByZWNvcmRlZCB0aHJvdWdoIGBtZW1vU3RhdGVgOyBhXG4gKiBgbWVtb1N0YXRlLnJlY29yZGAgdGhhdCByZXBvcnRzIGZhaWx1cmUgKHVud3JpdGFibGUgbWVtbykgYWxzbyBmYWlscyBvcGVuLFxuICogc2luY2UgYSBub24tcGVyc2lzdGluZyBtZW1vIHdvdWxkIHJlLWRlbnkgdGhlIGlkZW50aWNhbCByZXRyeSBmb3JldmVyLiBBbnlcbiAqIGludGVybmFsIGVycm9yIHJlc29sdmVzIHRvIGBhbGxvd2AvYHNpbGVudGAgXHUyMDE0IHRoZSBnYXRlIGZhaWxzIG9wZW4gYW5kIG5ldmVyXG4gKiBicmlja3MgYSBjb21taXQuXG4gKlxuICogVGhlIG9uZSBleGNlcHRpb24gdG8gZmFpbC1vcGVuIGlzIGEge0BsaW5rIEdhdGVTY2FuRXJyb3J9IGZyb20gYGV4ZWN1dG9ycy5zdGFsZWA6XG4gKiBhIHNjYW4gdGhhdCAqY291bGQgbm90IGNvbXBsZXRlKiAoZS5nLiBhbiB1bnJlYWRhYmxlIGFuY2hvciBmaWxlIGFib3J0cyB0aGVcbiAqIHNjb3BlZCBxdWVyeSkgeWllbGRzIGFuIGVtcHR5IHJlc3VsdCB0aGF0IGlzIE5PVCBldmlkZW5jZSBvZiBhIGNsZWFuIGNoYW5nZXNldC5cbiAqIFJlc29sdmluZyB0aGF0IHRvIGBhbGxvd2AvYHNpbGVudGAgd291bGQgYmUgc2lsZW50IG5vbi1lbmZvcmNlbWVudCBcdTIwMTQgYSB1c2VyXG4gKiBiZWxpZXZlcyB0aGUgY2hlY2sgcmFuIGFuZCBwYXNzZWQgd2hlbiBpdCBuZXZlciBjb21wbGV0ZWQsIG1hc2tpbmcgcmVhbCBkZWJ0IG9uXG4gKiBhIHNpYmxpbmcgYW5jaG9yIHRoZSBxdWVyeSBuZXZlciByZWFjaGVkLiBTbyB0aGlzIG9uZSBjYXNlIGZhaWxzIENMT1NFRDpcbiAqIGBkZW55YC9gc2Nhbi1mYWlsZWRgLCBkaXN0aW5jdCBmcm9tIGJvdGggYSBjbGVhbiBwYXNzIGFuZCBhbiBgZW52aXJvbm1lbnRhbGBcbiAqIHJlc3VsdCwgcmUtZGVueWluZyB1bnRpbCB0aGUgc2NhbiBjYW4gYWN0dWFsbHkgcnVuICh3aXRoIHRoZSBlc2NhcGUgaGF0Y2ggYXMgdGhlXG4gKiBkZWxpYmVyYXRlIG92ZXJyaWRlKS5cbiAqXG4gKiBUaGUgYEdJVF9TUEFOX0dBVEU9c2tpcGAgZXNjYXBlIGhhdGNoIGlzICpub3QqIGNoZWNrZWQgaGVyZSBcdTIwMTQgaXQgaXMgYVxuICogcHJlLWNoZWNrIHRoZSBhZGFwdGVyIHJ1bnMgdmlhIHtAbGluayBpc0dhdGVTa2lwcGVkfSBiZWZvcmUgY2FsbGluZ1xuICogZXZhbHVhdGVHYXRlLCBzbyBhIGJ5cGFzcyBpcyBsb2dnZWQgYXMgYW4gZXhwbGljaXQgZXhjZXB0aW9uIGF0IHRoZSBhZGFwdGVyXG4gKiBib3VuZGFyeSByYXRoZXIgdGhhbiBmb2xkZWQgaW50byB0aGUgZGVjaXNpb24gaGVyZS5cbiAqXG4gKiBAcGFyYW0gcGF0aHMgVGhlIHJlc29sdmVkIGNoYW5nZXNldCBmcm9tIHtAbGluayByZXNvbHZlQ2hhbmdlc2V0fS4gRW1wdHkgXHUyMTkyXG4gKiAgIGBhbGxvd2AvYHNpbGVudGAuXG4gKiBAcGFyYW0gY3dkIFRoZSB3b3JraW5nIGRpcmVjdG9yeSB0aGUgZ2l0IGNvbW1hbmQgcmFuIGluLlxuICogQHBhcmFtIGV4ZWN1dG9ycyBUaGUgaW5qZWN0ZWQgYGZpeGAvYHN0YWxlYC9gbGlzdGAgc3VyZmFjZS5cbiAqIEBwYXJhbSBtZW1vU3RhdGUgVGhlIHBlci1jaGFuZ2VzZXQgZGVidC1zdGF0ZSBtZW1vLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZXZhbHVhdGVHYXRlKFxuICBwYXRoczogc3RyaW5nW10sXG4gIGN3ZDogc3RyaW5nLFxuICBleGVjdXRvcnM6IEdhdGVFeGVjdXRvcnMsXG4gIG1lbW9TdGF0ZTogR2F0ZU1lbW9TdGF0ZVxuKTogUHJvbWlzZTxHYXRlUmVzdWx0PiB7XG4gIGlmIChwYXRocy5sZW5ndGggPT09IDApIHJldHVybiB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnc2lsZW50JyB9O1xuICB0cnkge1xuICAgIC8vIEJlbHQtYW5kLWJyYWNlcyBoZWFsLCB0aGVuIGNsYXNzaWZ5IGFnYWluc3QgdGhlIGhlYWxlZCBzdGF0ZS5cbiAgICBhd2FpdCBleGVjdXRvcnMuZml4KHBhdGhzLCBjd2QpO1xuICAgIGNvbnN0IHN0YWxlUm93cyA9IGF3YWl0IGV4ZWN1dG9ycy5zdGFsZShwYXRocywgY3dkKTtcblxuICAgIC8vIFNwbGl0IGRlYnQgcm93cyBpbnRvIHNlbWFudGljIGRyaWZ0IChhIHVzZXIgY2FuIGZpeCBieSBlZGl0aW5nIGEgc3BhbilcbiAgICAvLyBhbmQgdGVybWluYWwvZW52aXJvbm1lbnRhbCBjb25kaXRpb25zICh0aGUgQ0xJIGNvdWxkIG5vdCByZXNvbHZlIHRoZVxuICAgIC8vIGFuY2hvciBhdCBhbGwgXHUyMDE0IHNwYXJzZSBjaGVja291dCwgdW5mZXRjaGVkIExGUywgcGFydGlhbC1jbG9uZSBtaXNzLCBJL09cbiAgICAvLyBlcnJvcikuIGBpc0RlYnQoKWAgaXMgdGhlIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGggZm9yIHdoYXQgaXMgZGVidCBhdCBhbGw7XG4gICAgLy8gYGlzRW52aXJvbm1lbnRhbFN0YXR1cygpYCBzcGxpdHMgdGhlIGZpeGFibGUgZnJvbSB0aGUgdW5yZXNvbHZhYmxlLlxuICAgIC8vIGBNT1ZFRGAvYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCBhcmUgbmV2ZXIgZGVidCBhbmQgbmV2ZXIgY29udHJpYnV0ZS5cbiAgICBjb25zdCBkZWJ0Um93cyA9IHN0YWxlUm93cy5maWx0ZXIoKHJvdykgPT4gaXNEZWJ0KHJvdy5zdGF0dXMpKTtcbiAgICBjb25zdCBzZW1hbnRpYyA9IGRlYnRSb3dzLmZpbHRlcigocm93KSA9PiAhaXNFbnZpcm9ubWVudGFsU3RhdHVzKHJvdy5zdGF0dXMpKTtcbiAgICBjb25zdCBlbnZpcm9ubWVudGFsID0gZGVidFJvd3MuZmlsdGVyKChyb3cpID0+IGlzRW52aXJvbm1lbnRhbFN0YXR1cyhyb3cuc3RhdHVzKSk7XG5cbiAgICAvLyBTZW1hbnRpYyBzdGFsZW5lc3MgaXMgaGFyZC11bnRpbC1yZXNvbHZlZDogZGVueSBldmVyeSB0aW1lIHVudGlsIHRoZVxuICAgIC8vIGZpbmRpbmdzIHRoZW1zZWx2ZXMgY2hhbmdlLlxuICAgIGlmIChzZW1hbnRpYy5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBkZWNpc2lvbjogJ2RlbnknLFxuICAgICAgICBraW5kOiAnc2VtYW50aWMtc3RhbGVuZXNzJyxcbiAgICAgICAgZmluZGluZ3M6IHNlbWFudGljLFxuICAgICAgICByZWFzb246IHJlbmRlclN0YWxlbmVzc1JlYXNvbihzZW1hbnRpYylcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gRW52aXJvbm1lbnRhbCBjb25kaXRpb25zIGFyZSBub3QgYSBzcGFuIGVkaXQgYXdheSBmcm9tIHJlc29sdXRpb246IGZhaWxcbiAgICAvLyBPUEVOIChhbGxvdykgXHUyMDE0IGJ1dCBjYXJyeSB0aGVtIHNvIHRoZSBhZGFwdGVyIHN1cmZhY2VzIHRoZSBjb25kaXRpb24gcmF0aGVyXG4gICAgLy8gdGhhbiBzd2FsbG93aW5nIGl0LiBEZW55aW5nIHdvdWxkIHJlLWRlbnkgZm9yZXZlciBvbiBhbiBpbmZyYSBmYWlsdXJlIHRoZVxuICAgIC8vIHVzZXIgY2Fubm90IGNsZWFyIGZyb20gdGhlIGdhdGUsIGNvbnRyYWRpY3RpbmcgdGhlIGZhaWwtb3BlbiBjb250cmFjdCB0aGVcbiAgICAvLyByZXN0IG9mIHRoZSBnYXRlIGFscmVhZHkgaG9ub3JzIGZvciBDTEktYWJzZW50L3RpbWVvdXQvcGFyc2UgZmFpbHVyZXMuXG4gICAgaWYgKGVudmlyb25tZW50YWwubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgZGVjaXNpb246ICdhbGxvdycsXG4gICAgICAgIGtpbmQ6ICdlbnZpcm9ubWVudGFsJyxcbiAgICAgICAgY29uZGl0aW9uczogZW52aXJvbm1lbnRhbCxcbiAgICAgICAgcmVhc29uOiByZW5kZXJFbnZpcm9ubWVudGFsUmVhc29uKGVudmlyb25tZW50YWwpXG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIFVuY292ZXJlZCB3cml0ZXM6IGNoYW5nZWQgcGF0aHMgd2l0aCB6ZXJvIGNvdmVyaW5nIHNwYW4sIG1pbnVzIGAuc3Bhbi8qKmBcbiAgICAvLyAoc3BhbiByZXBhaXJzIHJpZGUgdGhlIHNhbWUgY29tbWl0IGFuZCBtdXN0IG5ldmVyIHNlbGYtdHJpZ2dlciB0aGUgZ2F0ZSlcbiAgICAvLyBhbmQgcGF0aHMgdGhlIHJlcG8ncyB1c2VyLW93bmVkIGAuc3Bhbi8uZ2F0ZWlnbm9yZWAgZXhjbHVkZXMuIEdpdGlnbm9yZWRcbiAgICAvLyBwYXRocyBuZXZlciByZWFjaCBoZXJlIFx1MjAxNCBnaXQgZG9lcyBub3Qgc3RhZ2UvcHVibGlzaCB0aGVtLlxuICAgIGNvbnN0IGNvdmVyaW5nID0gYXdhaXQgZXhlY3V0b3JzLmxpc3QocGF0aHMsIGN3ZCk7XG4gICAgY29uc3QgY292ZXJlZCA9IG5ldyBTZXQoY292ZXJpbmcubWFwKChyb3cpID0+IHJvdy5wYXRoKSk7XG4gICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICBjb25zdCBnYXRlSWdub3JlUnVsZXMgPSByZXBvUm9vdCA/IGxvYWRHYXRlSWdub3JlKHJlcG9Sb290KSA6IFtdO1xuICAgIGNvbnN0IHVuY292ZXJlZCA9IHBhdGhzLmZpbHRlcihcbiAgICAgIChwYXRoKSA9PiAhY292ZXJlZC5oYXMocGF0aCkgJiYgIWlzSW5zaWRlU3BhblJvb3QocGF0aCkgJiYgIWlzR2F0ZUlnbm9yZWQoZ2F0ZUlnbm9yZVJ1bGVzLCBwYXRoKVxuICAgICk7XG4gICAgaWYgKHVuY292ZXJlZC5sZW5ndGggPT09IDApIHJldHVybiB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnc2lsZW50JyB9O1xuXG4gICAgLy8gQ29uc2lkZXItb25jZTogZGVueSB0aGUgZmlyc3QgdGltZSB0aGlzIGV4YWN0IGRlYnQgc3RhdGUgaXMgc2VlbiwgdGhlblxuICAgIC8vIHBhc3MgdGhlIHJldHJ5IHdpdGggYW4gdW5jaGFuZ2VkIHN0YXRlLiAoTm8gc2VtYW50aWMvZW52aXJvbm1lbnRhbCByb3dzXG4gICAgLy8gc3Vydml2ZSB0byBoZXJlIFx1MjAxNCBib3RoIGJyYW5jaGVzIGFib3ZlIGhhdmUgcmV0dXJuZWQgXHUyMDE0IHNvIHRoZSBkaWdlc3Qnc1xuICAgIC8vIGZpbmRpbmdzIGNvbXBvbmVudCBpcyBlbXB0eSBhbmQgdGhlIHN0YXRlIGlzIGtleWVkIGJ5IHRoZSB1bmNvdmVyZWQgc2V0LilcbiAgICBjb25zdCBkaWdlc3QgPSBnYXRlU3RhdGVEaWdlc3QoW10sIHVuY292ZXJlZCk7XG4gICAgaWYgKG1lbW9TdGF0ZS5oYXMoZGlnZXN0KSkgcmV0dXJuIHsgZGVjaXNpb246ICdhbGxvdycsIGtpbmQ6ICdhbHJlYWR5LXByZXNlbnRlZCcgfTtcbiAgICAvLyBBIG5vbi1wZXJzaXN0aW5nIG1lbW8gd3JpdGUgd291bGQgdHVybiBcImRlbnkgb25jZSwgdGhlbiBhbGxvdyB0aGUgcmV0cnlcIlxuICAgIC8vIGludG8gXCJkZW55IGV2ZXJ5IHRpbWVcIiB3aXRoIG5vIGVzY2FwZSBcdTIwMTQgZmFpbCBvcGVuIHJhdGhlciB0aGFuIGRlbnkuXG4gICAgaWYgKCFtZW1vU3RhdGUucmVjb3JkKGRpZ2VzdCkpIHJldHVybiB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnc2lsZW50JyB9O1xuICAgIHJldHVybiB7IGRlY2lzaW9uOiAnZGVueScsIGtpbmQ6ICd1bmNvdmVyZWQtd3JpdGVzJywgdW5jb3ZlcmVkLCByZWFzb246IHJlbmRlclVuY292ZXJlZFJlYXNvbih1bmNvdmVyZWQpIH07XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIC8vIEEgc2NhbiB0aGF0IGNvdWxkIG5vdCBDT01QTEVURSBpcyBub3QgYSBjbGVhbiByZXN1bHQgXHUyMDE0IGZhaWxpbmcgb3BlbiBoZXJlXG4gICAgLy8gd291bGQgc2lsZW50bHkgYWxsb3cgYSBjb21taXQgd2hvc2UgZGVidCB0aGUgYWJvcnRlZCBzY2FuIG5ldmVyIGdvdCB0b1xuICAgIC8vIGNoZWNrLiBGYWlsIGNsb3NlZCB3aXRoIGEgZGlzdGluZ3Vpc2hhYmxlIGBzY2FuLWZhaWxlZGAgZGVueSBpbnN0ZWFkLlxuICAgIGlmIChlcnIgaW5zdGFuY2VvZiBHYXRlU2NhbkVycm9yKSB7XG4gICAgICByZXR1cm4geyBkZWNpc2lvbjogJ2RlbnknLCBraW5kOiAnc2Nhbi1mYWlsZWQnLCByZWFzb246IHJlbmRlclNjYW5GYWlsZWRSZWFzb24oZXJyLmRldGFpbCkgfTtcbiAgICB9XG4gICAgLy8gRmFpbCBvcGVuOiBhbnkgb3RoZXIgaW50ZXJuYWwvQ0xJIGVycm9yIHJlc29sdmVzIHRvIGFsbG93LiBUaGUgZ2F0ZSBtdXN0XG4gICAgLy8gbmV2ZXIgYnJpY2sgYSBjb21taXQgb24gaXRzIG93biBmYWlsdXJlLlxuICAgIHJldHVybiB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnc2lsZW50JyB9O1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGVidC1zdGF0ZSBkaWdlc3QgYW5kIHJlYXNvbiByZW5kZXJpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogYHBhdGgjTHN0YXJ0LUxlbmRgLCBvciBhIGJhcmUgcGF0aCBmb3IgYSB3aG9sZS1maWxlIGFuY2hvci4gKi9cbmZ1bmN0aW9uIGFuY2hvclRleHQocm93OiBTdGFsZVBvcmNlbGFpblJvdyk6IHN0cmluZyB7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHJvdy5wYXRoO1xuICByZXR1cm4gYCR7cm93LnBhdGh9I0wke3Jvdy5zdGFydH0tTCR7cm93LmVuZH1gO1xufVxuXG4vKipcbiAqIFRoZSBkaXN0aW5jdC1kZWJ0LXN0YXRlIGRpZ2VzdCAoZGVzaWduLWRlY2lzaW9ucy5tZCAjOSk6IGEgc3RhYmxlIGhhc2ggb2YgdGhlXG4gKiBzb3J0ZWQgc3RhbGVuZXNzIGZpbmRpbmdzIHBsdXMgdGhlIHNvcnRlZCB1bmNvdmVyZWQgcGF0aHMuIFByZXNlbmNlIGluIHRoZVxuICogbWVtbyBtZWFucyBcInRoaXMgZXhhY3Qgc3RhdGUgd2FzIGFscmVhZHkgcHJlc2VudGVkIG9uY2UuXCJcbiAqL1xuZnVuY3Rpb24gZ2F0ZVN0YXRlRGlnZXN0KGZpbmRpbmdzOiBTdGFsZVBvcmNlbGFpblJvd1tdLCB1bmNvdmVyZWQ6IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgY29uc3QgZmluZGluZ0tleXMgPSBmaW5kaW5ncy5tYXAoKHJvdykgPT4gYCR7cm93LnN0YXR1c31cXHQke3Jvdy5uYW1lfVxcdCR7cm93LnBhdGh9XFx0JHtyb3cuc3RhcnR9XFx0JHtyb3cuZW5kfWApLnNvcnQoKTtcbiAgY29uc3QgcGF5bG9hZCA9IEpTT04uc3RyaW5naWZ5KHsgZmluZGluZ3M6IGZpbmRpbmdLZXlzLCB1bmNvdmVyZWQ6IFsuLi51bmNvdmVyZWRdLnNvcnQoKSB9KTtcbiAgcmV0dXJuIGNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZShwYXlsb2FkKS5kaWdlc3QoJ2hleCcpO1xufVxuXG4vKiogVGhlIGBHSVRfU1BBTl9HQVRFPXNraXBgIGVzY2FwZS1oYXRjaCBsaW5lIGFwcGVuZGVkIHRvIGV2ZXJ5IGRlbnkgcmVhc29uLiAqL1xuY29uc3QgRVNDQVBFX0hBVENIX0xJTkUgPVxuICAnVG8gcHJvY2VlZCBhbnl3YXkgKHJlcXVpcmVzIGV4cGxpY2l0IHVzZXIgYXBwcm92YWwpOiBwcmVmaXggdGhlIGNvbW1hbmQgd2l0aCBgR0lUX1NQQU5fR0FURT1za2lwYC4nO1xuXG4vKiogVGhlIGNoZWNrbGlzdCBhIHNlbWFudGljLXN0YWxlbmVzcyBkZW55IHJlbmRlcnMgaW50byBgcmVhc29uYC4gKi9cbmZ1bmN0aW9uIHJlbmRlclN0YWxlbmVzc1JlYXNvbihmaW5kaW5nczogU3RhbGVQb3JjZWxhaW5Sb3dbXSk6IHN0cmluZyB7XG4gIGNvbnN0IGxpbmVzID0gZmluZGluZ3MubWFwKChyb3cpID0+IGAgIC0gJHtyb3cubmFtZX0gKCR7cm93LnN0YXR1c30pOiAke2FuY2hvclRleHQocm93KX1gKTtcbiAgcmV0dXJuIFtcbiAgICAnVGhpcyBjaGFuZ2VzZXQgY2FycmllcyBzcGFuIGRlYnQgXHUyMDE0IHJlc29sdmUgaXQgYmVmb3JlIHRoaXMgbGFuZHM6JyxcbiAgICAuLi5saW5lcyxcbiAgICAnJyxcbiAgICBcIlVwZGF0ZSBlYWNoIHNwYW4ncyBhbmNob3JzL3doeSBpbiB0aGlzIHNhbWUgY2hhbmdlLCBvciB0ZWxsIHRoZSB1c2VyIHdoeSB0aGUgZGVzY3JpYmVkIGNvdXBsaW5nIG5vIGxvbmdlciBob2xkcywgdGhlbiByZXRyeS5cIixcbiAgICBFU0NBUEVfSEFUQ0hfTElORVxuICBdLmpvaW4oJ1xcbicpO1xufVxuXG4vKipcbiAqIFRoZSBhZHZpc29yeSBzdXJmYWNlZCB3aGVuIHRoZSBjaGFuZ2VzZXQncyBvbmx5IHN0YWxlbmVzcyBpcyBlbnZpcm9ubWVudGFsIFx1MjAxNFxuICogdGhlIGdhdGUgYWxsb3dzIGJ1dCBzYXlzIHdoeSwgc28gdGhlIHVucmVzb2x2YWJsZSBjb25kaXRpb24gaXMgbm90IHNpbGVudGx5XG4gKiBzd2FsbG93ZWQuIE5vIGVzY2FwZS1oYXRjaCBsaW5lOiB0aGUgY29tbWFuZCBhbHJlYWR5IHBhc3Nlcy5cbiAqL1xuZnVuY3Rpb24gcmVuZGVyRW52aXJvbm1lbnRhbFJlYXNvbihjb25kaXRpb25zOiBTdGFsZVBvcmNlbGFpblJvd1tdKTogc3RyaW5nIHtcbiAgY29uc3QgbGluZXMgPSBjb25kaXRpb25zLm1hcCgocm93KSA9PiBgICAtICR7cm93Lm5hbWV9ICgke3Jvdy5zdGF0dXN9KTogJHthbmNob3JUZXh0KHJvdyl9YCk7XG4gIHJldHVybiBbXG4gICAgJ2dpdC1zcGFuIGNvdWxkIG5vdCBldmFsdWF0ZSB0aGVzZSBhbmNob3JzLCBzbyB0aGUgZ2F0ZSBpcyBub3QgYmxvY2tpbmcgb24gdGhlbTonLFxuICAgIC4uLmxpbmVzLFxuICAgICcnLFxuICAgICdUaGlzIGlzIGFuIGVudmlyb25tZW50YWwgY29uZGl0aW9uIChlLmcuIHNwYXJzZSBjaGVja291dCwgdW5mZXRjaGVkIExGUywgcGFydGlhbC1jbG9uZSBtaXNzLCBvciBJL08gZXJyb3IpLCBub3Qgc3BhbiBkcmlmdCB5b3UgY2FuIGZpeCBieSBlZGl0aW5nIGEgc3Bhbi4gUmVzb2x2ZSB0aGUgdW5kZXJseWluZyBjaGVja291dC9mZXRjaCBpc3N1ZSBpZiB0aGlzIGNvdXBsaW5nIG5lZWRzIHZlcmlmeWluZy4nXG4gIF0uam9pbignXFxuJyk7XG59XG5cbi8qKlxuICogVGhlIGFkdmlzb3J5IGEgYHNjYW4tZmFpbGVkYCBkZW55IHJlbmRlcnMgaW50byBgcmVhc29uYC4gVW5saWtlIHRoZVxuICogZW52aXJvbm1lbnRhbCBhZHZpc29yeSAod2hpY2ggYWxsb3dzKSwgdGhpcyBob2xkcyB0aGUgY29tbWFuZDogdGhlIHNjYW4gY291bGRcbiAqIG5vdCBjb21wbGV0ZSwgc28gdGhlIGNoYW5nZXNldCBpcyB1bnZlcmlmaWVkIFx1MjAxNCBub3QgY29uZmlybWVkIGNsZWFuLiBOYW1lcyB0aGVcbiAqIHVuZGVybHlpbmcgZmFpbHVyZSBhbmQgb2ZmZXJzIHRoZSBlc2NhcGUgaGF0Y2ggYXMgdGhlIGRlbGliZXJhdGUgb3ZlcnJpZGUuXG4gKi9cbmZ1bmN0aW9uIHJlbmRlclNjYW5GYWlsZWRSZWFzb24oZGV0YWlsOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gW1xuICAgICdnaXQtc3BhbiBjb3VsZCBub3QgY29tcGxldGUgaXRzIHN0YWxlbmVzcyBzY2FuIGZvciB0aGlzIGNoYW5nZXNldCwgc28gaXQgY2Fubm90IGNvbmZpcm0gdGhlIGNoYW5nZSBpcyBmcmVlIG9mIHNwYW4gZGVidDonLFxuICAgIGAgICR7ZGV0YWlsfWAsXG4gICAgJycsXG4gICAgJ1RoaXMgaXMgYSBoYXJkIHNjYW4gZmFpbHVyZSAoZS5nLiBhbiB1bnJlYWRhYmxlIGFuY2hvciBmaWxlIHRoYXQgYWJvcnRzIHRoZSB3aG9sZSBzY29wZWQgcXVlcnkpLCBub3QgYSBjbGVhbiByZXN1bHQgXHUyMDE0IHRoZSBnYXRlIGlzIGhvbGRpbmcgdGhlIGNvbW1hbmQgcmF0aGVyIHRoYW4gbGV0dGluZyBhbiB1bnZlcmlmaWVkIGNoYW5nZXNldCB0aHJvdWdoLiBSZXNvbHZlIHRoZSB1bmRlcmx5aW5nIHJlYWQvc2NhbiBlcnJvciwgdGhlbiByZXRyeS4nLFxuICAgIEVTQ0FQRV9IQVRDSF9MSU5FXG4gIF0uam9pbignXFxuJyk7XG59XG5cbi8qKiBUaGUgb25lLXRpbWUgbGlzdCBhbiB1bmNvdmVyZWQtd3JpdGVzIGRlbnkgcmVuZGVycyBpbnRvIGByZWFzb25gLiAqL1xuZnVuY3Rpb24gcmVuZGVyVW5jb3ZlcmVkUmVhc29uKHVuY292ZXJlZDogc3RyaW5nW10pOiBzdHJpbmcge1xuICBjb25zdCBsaW5lcyA9IHVuY292ZXJlZC5tYXAoKHBhdGgpID0+IGAgIC0gJHtwYXRofWApO1xuICByZXR1cm4gW1xuICAgICdUaGVzZSBjaGFuZ2VkIGZpbGVzIGFyZSBjb3ZlcmVkIGJ5IG5vIHNwYW4gXHUyMDE0IGNvbnNpZGVyIHdoZXRoZXIgdGhleSBuZWVkIG9uZTonLFxuICAgIC4uLmxpbmVzLFxuICAgICcnLFxuICAgICdEZWNsYXJlIGEgY291cGxpbmcgd2l0aCBgZ2l0IHNwYW4gYWRkYCBpZiBvbmUgZ2VudWluZWx5IGV4aXN0cywgb3IganVzdCByZXRyeSB0aGUgY29tbWFuZCB0byBwcm9jZWVkICh0aGlzIGlzIGEgb25lLXRpbWUgY2hlY2spLicsXG4gICAgRVNDQVBFX0hBVENIX0xJTkVcbiAgXS5qb2luKCdcXG4nKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBFc2NhcGUgaGF0Y2hcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFdoZXRoZXIgdGhlIHRyYW5zY3JpcHQtdmlzaWJsZSBlc2NhcGUgaGF0Y2ggYEdJVF9TUEFOX0dBVEU9c2tpcGAgaXMgc2V0IGluIHRoZVxuICogYW1iaWVudC9zZXNzaW9uIGVudmlyb25tZW50LCBieXBhc3NpbmcgdGhlIGdhdGUgZm9yIGEgdXNlci1hcHByb3ZlZCBleGNlcHRpb25cbiAqIChDQVJELm1kIGFjY2VwdGFuY2UgY3JpdGVyaW9uIDU7IHRoZSBza2lsbCBkb2N1bWVudHMgdGhhdCBzZXR0aW5nIGl0IHJlcXVpcmVzXG4gKiBleHBsaWNpdCB1c2VyIGFwcHJvdmFsKS5cbiAqXG4gKiBUaGlzIGNvdmVycyB0aGUgKnNlc3Npb24tZW52KiBmb3JtICh0aGUgdmFyIGV4cG9ydGVkIGZvciB0aGUgd2hvbGUgc2Vzc2lvbikuXG4gKiBUaGUgKmlubGluZS1wcmVmaXgqIGZvcm0gZG9jdW1lbnRlZCBldmVyeXdoZXJlIFx1MjAxNCBgR0lUX1NQQU5fR0FURT1za2lwIGdpdFxuICogY29tbWl0IFx1MjAyNmAgdHlwZWQgYXMgb25lIEJhc2ggY29tbWFuZCBcdTIwMTQgbmV2ZXIgcmVhY2hlcyB0aGUgaG9vaydzIG93blxuICogYHByb2Nlc3MuZW52YCwgYmVjYXVzZSBhIGBQcmVUb29sVXNlYCBob29rIHJ1bnMgYXMgYSBzZXBhcmF0ZSBwcm9jZXNzICpiZWZvcmUqXG4gKiB0aGUgc2hlbGwgY29tbWFuZCB3aG9zZSBpbmxpbmUgYXNzaWdubWVudCBpdCB3b3VsZCBzZXQ7IHRoYXQgZm9ybSBpcyBkZXRlY3RlZFxuICogZnJvbSB0aGUgY29tbWFuZCBzdHJpbmcgYnkge0BsaW5rIGNvbW1hbmRTa2lwc0dhdGV9LiBBZGFwdGVycyBjaGVjayBib3RoLlxuICpcbiAqIEtlcHQgcHVyZSBvdmVyIHRoZSBwYXNzZWQgZW52IChyYXRoZXIgdGhhbiByZWFkaW5nIGBwcm9jZXNzLmVudmAgZGlyZWN0bHkpIHNvXG4gKiB0ZXN0cyBjYW4gZXhlcmNpc2UgYm90aCBicmFuY2hlcyB3aXRob3V0IG11dGF0aW5nIGdsb2JhbCBzdGF0ZS5cbiAqXG4gKiBAcGFyYW0gZW52IFRoZSBlbnZpcm9ubWVudCB0byByZWFkLCBlLmcuIGBwcm9jZXNzLmVudmAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0dhdGVTa2lwcGVkKGVudjogTm9kZUpTLlByb2Nlc3NFbnYgfCBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCB1bmRlZmluZWQ+KTogYm9vbGVhbiB7XG4gIHJldHVybiBlbnZbJ0dJVF9TUEFOX0dBVEUnXSA9PT0gJ3NraXAnO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhlIHJhdyBjb21tYW5kIHN0cmluZyBjYXJyaWVzIHRoZSBpbmxpbmUgZXNjYXBlLWhhdGNoIHByZWZpeFxuICogYEdJVF9TUEFOX0dBVEU9c2tpcGAgb24gYSBgZ2l0YCBpbnZvY2F0aW9uIFx1MjAxNCB0aGUgZXhhY3QgZG9jdW1lbnRlZCBnZXN0dXJlXG4gKiBgR0lUX1NQQU5fR0FURT1za2lwIGdpdCBjb21taXQgXHUyMDI2YCB0eXBlZCBhcyBvbmUgQmFzaCBjb21tYW5kLlxuICpcbiAqIEEgYFByZVRvb2xVc2VgIGhvb2sgcnVucyBhcyBpdHMgb3duIHByb2Nlc3MgKmJlZm9yZSogdGhlIHNoZWxsIGV4ZWN1dGVzIHRoZVxuICogY29tbWFuZCwgc28gYW4gaW5saW5lIGBWQVI9dmFsdWUgY21kYCBhc3NpZ25tZW50ICh3aGljaCBvbmx5IGFmZmVjdHMgdGhlXG4gKiBwcm9jZXNzIHRoZSBzaGVsbCBzcGF3bnMgYWZ0ZXJ3YXJkKSBuZXZlciBsYW5kcyBpbiB0aGUgaG9vaydzIG93blxuICogYHByb2Nlc3MuZW52YCBcdTIwMTQge0BsaW5rIGlzR2F0ZVNraXBwZWR9IGFsb25lIGNhbiB0aGVyZWZvcmUgbmV2ZXIgc2VlIGl0LiBUaGlzXG4gKiByZWNvdmVycyB0aGUgZmxhZyBmcm9tIHRoZSBjb21tYW5kIHRleHQgaXRzZWxmLCBzbyB0aGUgZG9jdW1lbnRlZCBvbmUtc2hvdCxcbiAqIHBlci1jb21tYW5kIGJ5cGFzcyBhY3R1YWxseSB3b3JrczogaXQgaW5zcGVjdHMgdGhlIGxlYWRpbmcgYFZBUj12YWx1ZWBcbiAqIGVudmlyb25tZW50IGFzc2lnbm1lbnRzIHtAbGluayBtYXRjaEdpdEludm9jYXRpb259IG90aGVyd2lzZSBzdHJpcHMsIGFuZFxuICogcmV0dXJucyB0cnVlIHdoZW4gb25lIG9mIHRoZW0gaXMgZXhhY3RseSBgR0lUX1NQQU5fR0FURT1za2lwYCBvbiBhIHNlZ21lbnRcbiAqIHRoYXQgdGhlbiBpbnZva2VzIGBnaXRgLlxuICpcbiAqIENvbnNlcnZhdGl2ZSBsaWtlIHRoZSByZXN0IG9mIHRoZSBwYXJzZXI6IHRoZSBhc3NpZ25tZW50IG11c3QgYmUgYSBsZWFkaW5nXG4gKiBwcmVmaXggb24gYSBgZ2l0YCBpbnZvY2F0aW9uIChub3QgYnVyaWVkIG1pZC1jb21tYW5kKSwgbWF0Y2hpbmcgdGhlIGV4YWN0XG4gKiBkb2N1bWVudGVkIHNoYXBlIGFuZCBub3RoaW5nIGxvb3Nlci5cbiAqXG4gKiBAcGFyYW0gY29tbWFuZCBUaGUgcmF3IHNoZWxsIGNvbW1hbmQgc3RyaW5nIGZyb20gdGhlIGhvb2sncyB0b29sIGlucHV0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29tbWFuZFNraXBzR2F0ZShjb21tYW5kOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgZm9yIChjb25zdCBzZWdtZW50IG9mIHNwbGl0U2VnbWVudHMoY29tbWFuZCkpIHtcbiAgICBjb25zdCB0b2tlbnMgPSB0b2tlbml6ZShzZWdtZW50KTtcbiAgICBsZXQgaSA9IDA7XG4gICAgbGV0IHNhd1NraXAgPSBmYWxzZTtcbiAgICB3aGlsZSAoaSA8IHRva2Vucy5sZW5ndGggJiYgL15bQS1aYS16X11bQS1aYS16MC05X10qPS8udGVzdCh0b2tlbnNbaV0pKSB7XG4gICAgICBpZiAodG9rZW5zW2ldID09PSAnR0lUX1NQQU5fR0FURT1za2lwJykgc2F3U2tpcCA9IHRydWU7XG4gICAgICBpKys7XG4gICAgfVxuICAgIGlmIChzYXdTa2lwICYmIHRva2Vuc1tpXSA9PT0gJ2dpdCcpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBEZWZhdWx0IHN1YnByb2Nlc3MvZGlzay1iYWNrZWQgZGVwZW5kZW5jaWVzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vXG4vLyBUaGUgcHJvZHVjdGlvbiBzdXJmYWNlcyBib3RoIGFkYXB0ZXJzIGluamVjdCBieSBkZWZhdWx0LCBmb2xsb3dpbmdcbi8vIHRvdWNoLWNvcmUudHMncyBgY3JlYXRlRGVmYXVsdFRvdWNoRXhlY3V0b3JzYCBzdHlsZTogZWFjaCBjYXB0dXJlcyBzdGRvdXQgZXZlblxuLy8gb24gYSBub24temVybyBleGl0IHdoZXJlIHRoZSBDTEkgc3RpbGwgZW1pdHMgdXNlZnVsIG91dHB1dCwgYW5kIGV2ZXJ5IGZhaWx1cmVcbi8vIG1vZGUgKGFic2VudCBiaW5hcnksIHRpbWVvdXQsIG5vIHJlcG8pIHN1cmZhY2VzIGFzIGFuIGVtcHR5L2NsZWFuIHJlc3VsdCBzb1xuLy8gdGhlIGdhdGUncyBmYWlsLW9wZW4gY29udHJhY3QgaG9sZHMgd2l0aG91dCB0aGUgYWRhcHRlciBhZGRpbmcgaXRzIG93bi5cblxuY29uc3QgREVGQVVMVF9USU1FT1VUX01TID0gMTBfMDAwO1xuXG4vKiogUnVuIGEgZ2l0IGNvbW1hbmQgYXQgYGN3ZGAsIHJldHVybmluZyB0cmltbWVkIG5vbi1lbXB0eSBQT1NJWCBvdXRwdXQgbGluZXMgKGVtcHR5IG9uIGFueSBmYWlsdXJlKS4gKi9cbmZ1bmN0aW9uIGdpdExpbmVzKGFyZ3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZywgdGltZW91dE1zOiBudW1iZXIpOiBzdHJpbmdbXSB7XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBhcmdzLCB7XG4gICAgICBjd2QsXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICB9KTtcbiAgICByZXR1cm4gb3V0XG4gICAgICAuc3BsaXQoJ1xcbicpXG4gICAgICAubWFwKChsaW5lKSA9PiBsaW5lLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoKGxpbmUpID0+IGxpbmUubGVuZ3RoID4gMClcbiAgICAgIC5tYXAodG9Qb3NpeCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBbXTtcbiAgfVxufVxuXG4vKipcbiAqIExpa2Uge0BsaW5rIGdpdExpbmVzfSBidXQgZGlzdGluZ3Vpc2hlcyBhICpmYWlsZWQqIGludm9jYXRpb24gKGBudWxsYCBcdTIwMTQgZS5nLlxuICogYEB7dX1gIHdpdGggbm8gdXBzdHJlYW0gY29uZmlndXJlZCkgZnJvbSBhICpzdWNjZXNzZnVsIGJ1dCBlbXB0eSogcmVzdWx0XG4gKiAoYFtdYCksIHNvIHRoZSBvdXRnb2luZy1yYW5nZSByZXNvbHV0aW9uIGtub3dzIHdoZW4gdG8gdHJ5IHRoZSBtZXJnZS1iYXNlXG4gKiBmYWxsYmFjayByYXRoZXIgdGhhbiBtaXN0YWtpbmcgXCJubyB1cHN0cmVhbVwiIGZvciBcIm5vdGhpbmcgdG8gcHVzaFwiLlxuICovXG5mdW5jdGlvbiBnaXRMaW5lc09yTnVsbChhcmdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcsIHRpbWVvdXRNczogbnVtYmVyKTogc3RyaW5nW10gfCBudWxsIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIGFyZ3MsIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgIH0pO1xuICAgIHJldHVybiBvdXRcbiAgICAgIC5zcGxpdCgnXFxuJylcbiAgICAgIC5tYXAoKGxpbmUpID0+IGxpbmUudHJpbSgpKVxuICAgICAgLmZpbHRlcigobGluZSkgPT4gbGluZS5sZW5ndGggPiAwKVxuICAgICAgLm1hcCh0b1Bvc2l4KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqIFRoZSBwcm9kdWN0aW9uIHtAbGluayBHaXRFeGVjdXRvcn06IGBnaXQgZGlmZmAgcmVhZHMgc2NvcGVkIHRvIHRoZSBDV0QgcmVwby4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0R2l0RXhlY3V0b3IodGltZW91dE1zOiBudW1iZXIgPSBERUZBVUxUX1RJTUVPVVRfTVMpOiBHaXRFeGVjdXRvciB7XG4gIHJldHVybiB7XG4gICAgc3RhZ2VkUGF0aHM6IGFzeW5jIChjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290KSByZXR1cm4gW107XG4gICAgICByZXR1cm4gZ2l0TGluZXMoWyctQycsIHJlcG9Sb290LCAnZGlmZicsICctLWNhY2hlZCcsICctLW5hbWUtb25seSddLCByZXBvUm9vdCwgdGltZW91dE1zKTtcbiAgICB9LFxuICAgIHRyYWNrZWRNb2RpZmllZFBhdGhzOiBhc3luYyAoY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCkgcmV0dXJuIFtdO1xuICAgICAgcmV0dXJuIGdpdExpbmVzKFsnLUMnLCByZXBvUm9vdCwgJ2RpZmYnLCAnLS1uYW1lLW9ubHknXSwgcmVwb1Jvb3QsIHRpbWVvdXRNcyk7XG4gICAgfSxcbiAgICBvdXRnb2luZ1BhdGhzOiBhc3luYyAoY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCkgcmV0dXJuIFtdO1xuICAgICAgY29uc3QgdXBzdHJlYW0gPSBnaXRMaW5lc09yTnVsbChbJy1DJywgcmVwb1Jvb3QsICdkaWZmJywgJy0tbmFtZS1vbmx5JywgJ0B7dX0uLkhFQUQnXSwgcmVwb1Jvb3QsIHRpbWVvdXRNcyk7XG4gICAgICBpZiAodXBzdHJlYW0gIT09IG51bGwpIHJldHVybiB1cHN0cmVhbTtcbiAgICAgIC8vIE5vIHVwc3RyZWFtIGNvbmZpZ3VyZWQ6IGZhbGwgYmFjayB0byB0aGUgbWVyZ2UtYmFzZSB3aXRoIHRoZSBkZWZhdWx0XG4gICAgICAvLyByZW1vdGUgYnJhbmNoIChgb3JpZ2luL0hFQURgKS4gSWYgdGhhdCB0b28gaXMgdW5yZXNvbHZhYmxlLCBmYWlsIG9wZW4uXG4gICAgICBjb25zdCBiYXNlID0gZ2l0TGluZXMoWyctQycsIHJlcG9Sb290LCAnbWVyZ2UtYmFzZScsICdIRUFEJywgJ29yaWdpbi9IRUFEJ10sIHJlcG9Sb290LCB0aW1lb3V0TXMpWzBdO1xuICAgICAgaWYgKCFiYXNlKSByZXR1cm4gW107XG4gICAgICByZXR1cm4gZ2l0TGluZXMoWyctQycsIHJlcG9Sb290LCAnZGlmZicsICctLW5hbWUtb25seScsIGAke2Jhc2V9Li5IRUFEYF0sIHJlcG9Sb290LCB0aW1lb3V0TXMpO1xuICAgIH0sXG4gICAgcGF0aHNwZWNQYXRoczogYXN5bmMgKHBhdGhzLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290IHx8IHBhdGhzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICAgICAgLy8gV29ya2luZy10cmVlIGNvbnRlbnQgdnMgSEVBRCwgc2NvcGVkIHRvIHRoZSBwYXRoc3BlY3MgXHUyMDE0IHRoZSBmaWxlcyBhXG4gICAgICAvLyBgZ2l0IGNvbW1pdCAtLSA8cGF0aHNwZWM+YCB3b3VsZCBhY3R1YWxseSBjaGFuZ2UgKHN0YWdlZCBvciBub3QpLlxuICAgICAgcmV0dXJuIGdpdExpbmVzKFsnLUMnLCByZXBvUm9vdCwgJ2RpZmYnLCAnSEVBRCcsICctLW5hbWUtb25seScsICctLScsIC4uLnBhdGhzXSwgcmVwb1Jvb3QsIHRpbWVvdXRNcyk7XG4gICAgfVxuICB9O1xufVxuXG4vKiogVGhlIHByb2R1Y3Rpb24ge0BsaW5rIEdhdGVFeGVjdXRvcnN9OiBzY29wZWQgYGdpdCBzcGFuYCBmaXgvc3RhbGUvbGlzdCBhdCB0aGUgcmVwbyByb290LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHRHYXRlRXhlY3V0b3JzKHRpbWVvdXRNczogbnVtYmVyID0gREVGQVVMVF9USU1FT1VUX01TKTogR2F0ZUV4ZWN1dG9ycyB7XG4gIHJldHVybiB7XG4gICAgZml4OiBhc3luYyAocGF0aHMsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGlmICghcmVwb1Jvb3QgfHwgcGF0aHMubGVuZ3RoID09PSAwKSByZXR1cm47XG4gICAgICB0cnkge1xuICAgICAgICBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdzdGFsZScsIC4uLnBhdGhzLCAnLS1maXgnXSwge1xuICAgICAgICAgIGN3ZDogcmVwb1Jvb3QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIGBnaXQgc3BhbiBzdGFsZWAgZXhpdHMgMSBvbiBkcmlmdCBldmVuIGFmdGVyIGhlYWxpbmcsIGFuZCBub24temVybyBvblxuICAgICAgICAvLyBnZW51aW5lIGZhaWx1cmU7IGVpdGhlciB3YXkgdGhlIHN1YnNlcXVlbnQgYHN0YWxlYCByZWFkIGlzIHRoZSBzb3VyY2VcbiAgICAgICAgLy8gb2YgdHJ1dGgsIHNvIHRoZSBleGl0IGNvZGUgaXMgaWdub3JlZCBoZXJlLlxuICAgICAgfVxuICAgIH0sXG4gICAgc3RhbGU6IGFzeW5jIChwYXRocywgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCB8fCBwYXRocy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgICAgIGxldCBvdXQ6IHN0cmluZztcbiAgICAgIHRyeSB7XG4gICAgICAgIG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ3N0YWxlJywgJy0tZm9ybWF0JywgJ3BvcmNlbGFpbicsIC4uLnBhdGhzXSwge1xuICAgICAgICAgIGN3ZDogcmVwb1Jvb3QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIC8vIGBnaXQgc3BhbiBzdGFsZWAgZXhpdHMgbm9uLXplcm8gaW4gdHdvIHZlcnkgZGlmZmVyZW50IHdheXMsIGFuZCB0aGV5XG4gICAgICAgIC8vIG11c3Qgbm90IGJlIGNvbmZsYXRlZDpcbiAgICAgICAgLy8gIC0gTGVnaXRpbWF0ZSBkcmlmdDogcmVhbCBwb3JjZWxhaW4gcm93cyBvbiBzdGRvdXQgZGVzY3JpYmluZyB0aGVcbiAgICAgICAgLy8gICAgZHJpZnQuIFBhcnNlIHRoZW0gKHRoaXMgaXMgdGhlIHdob2xlIHBvaW50IG9mIHRoZSByZWFkKS5cbiAgICAgICAgLy8gIC0gSGFyZCBzY2FuIGZhaWx1cmU6IHRoZSBzY29wZWQgcXVlcnkgYWJvcnRlZCBiZWZvcmUgY29tcGxldGluZyAoZS5nLlxuICAgICAgICAvLyAgICBhbiB1bnJlYWRhYmxlIGFuY2hvciBmaWxlKSwgd3JpdGluZyBhbiBlcnJvciB0byBzdGRlcnIgYW5kIGVtaXR0aW5nXG4gICAgICAgIC8vICAgIGVtcHR5IHN0ZG91dC4gQW4gZW1wdHkgcmVzdWx0IGhlcmUgaXMgTk9UIFwiY2xlYW5cIiBcdTIwMTQgdGhlIHNjYW4gbmV2ZXJcbiAgICAgICAgLy8gICAgcmFuIHRvIGNvbXBsZXRpb24gXHUyMDE0IHNvIHNpZ25hbCBpdCBkaXN0aW5jdGx5IHJhdGhlciB0aGFuIHBhcnNpbmcgdG9cbiAgICAgICAgLy8gICAgYFtdYCwgd2hpY2ggd291bGQgcmVhZCBhcyBhIGNsZWFuIHBhc3MgYW5kIHNpbGVudGx5IGFsbG93IHRoZSBjb21taXQuXG4gICAgICAgIGNvbnN0IHN0ZG91dCA9IChlcnIgYXMgeyBzdGRvdXQ/OiBzdHJpbmcgfSkuc3Rkb3V0O1xuICAgICAgICBjb25zdCBzdGRlcnIgPSAoZXJyIGFzIHsgc3RkZXJyPzogc3RyaW5nIH0pLnN0ZGVycjtcbiAgICAgICAgY29uc3Qgc3Rkb3V0VGV4dCA9IHR5cGVvZiBzdGRvdXQgPT09ICdzdHJpbmcnID8gc3Rkb3V0IDogJyc7XG4gICAgICAgIGNvbnN0IHN0ZGVyclRleHQgPSB0eXBlb2Ygc3RkZXJyID09PSAnc3RyaW5nJyA/IHN0ZGVyciA6ICcnO1xuICAgICAgICBpZiAoc3Rkb3V0VGV4dC50cmltKCkubGVuZ3RoID09PSAwICYmIHN0ZGVyclRleHQudHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICB0aHJvdyBuZXcgR2F0ZVNjYW5FcnJvcihzdGRlcnJUZXh0LnRyaW0oKSk7XG4gICAgICAgIH1cbiAgICAgICAgb3V0ID0gc3Rkb3V0VGV4dDtcbiAgICAgIH1cbiAgICAgIHJldHVybiBwYXJzZVN0YWxlUG9yY2VsYWluKG91dCk7XG4gICAgfSxcbiAgICBsaXN0OiBhc3luYyAocGF0aHMsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGlmICghcmVwb1Jvb3QgfHwgcGF0aHMubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdsaXN0JywgJy0tcG9yY2VsYWluJywgLi4ucGF0aHNdLCB7XG4gICAgICAgICAgY3dkOiByZXBvUm9vdCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBwYXJzZVBvcmNlbGFpbihvdXQpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG59XG5cbi8qKlxuICogVGhlIHByb2R1Y3Rpb24gZGlzay1iYWNrZWQge0BsaW5rIEdhdGVNZW1vU3RhdGV9OiBvbmUgbWFya2VyIGZpbGUgcGVyIGRlYnQtc3RhdGVcbiAqIGRpZ2VzdCB1bmRlciB7QGxpbmsgZ2F0ZU1lbW9EaXJ9IChgPGdpdC1jb21tb24tZGlyPi9naXQtc3Bhbi9nYXRlL2ApLCBmb2xsb3dpbmdcbiAqIHNwYW4tc3VyZmFjZS50cydzIGZpbGUtYmFja2VkIGBNZW1vU3RvcmVgIHBhdHRlcm4uIFRoZSBkaWdlc3QgaXMgYSBoZXggc2hhMjU2LFxuICogYSBzYWZlIGZpbGVuYW1lLiBCZXN0LWVmZm9ydCBhbmQgbm9uLXRocm93aW5nOiBhIG1lbW8gd2hvc2UgcmVwbyBjYW5ub3QgYmVcbiAqIHJlc29sdmVkIGRlZ3JhZGVzIHRvIGEgbm8tb3Agc3RvcmUgKG5ldmVyIHBlcnNpc3RzIFx1MjE5MiB1bmNvdmVyZWQgd291bGQgcmUtZGVueSxcbiAqIGJ1dCBhbiB1bnJlc29sdmFibGUgcmVwbyB5aWVsZHMgYW4gZW1wdHkgY2hhbmdlc2V0IHVwc3RyZWFtIGFueXdheSkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEaXNrR2F0ZU1lbW9TdGF0ZShjd2Q6IHN0cmluZyk6IEdhdGVNZW1vU3RhdGUge1xuICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICBpZiAoIXJlcG9Sb290KSB7XG4gICAgLy8gTm8gcmVzb2x2YWJsZSByZXBvIFx1MjE5MiB0aGUgbWVtbyBjYW5ub3QgcGVyc2lzdC4gUmVwb3J0IGBmYWxzZWAgZnJvbVxuICAgIC8vIGByZWNvcmRgIHNvIHRoZSBnYXRlIGZhaWxzIG9wZW4gcmF0aGVyIHRoYW4gZGVueWluZyB3aXRoIG5vIGVzY2FwZS5cbiAgICByZXR1cm4geyBoYXM6ICgpID0+IGZhbHNlLCByZWNvcmQ6ICgpID0+IGZhbHNlIH07XG4gIH1cbiAgY29uc3QgZGlyID0gZ2F0ZU1lbW9EaXIocmVwb1Jvb3QpO1xuICByZXR1cm4ge1xuICAgIGhhczogKGRpZ2VzdCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGZzLmV4aXN0c1N5bmMobm9kZVBhdGguam9pbihkaXIsIGRpZ2VzdCkpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICB9LFxuICAgIHJlY29yZDogKGRpZ2VzdCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgZnMubWtkaXJTeW5jKGRpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgICAgIGZzLndyaXRlRmlsZVN5bmMobm9kZVBhdGguam9pbihkaXIsIGRpZ2VzdCksICcnKTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gQSBmYWlsZWQgbWVtbyB3cml0ZSBtdXN0IG5ldmVyIGJyaWNrIHRoZSBjb21taXQgYW5kIG11c3QgbmV2ZXJcbiAgICAgICAgLy8gc2lsZW50bHkgcmUtZGVueSBmb3JldmVyOiByZXBvcnQgdGhlIGZhaWx1cmUgc28gdGhlIGdhdGUgZmFpbHMgb3Blbi5cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgIH1cbiAgfTtcbn1cbiIsICIvKipcbiAqIFNoYXJlZCBoZWxwZXJzIHVzZWQgYnkgbXVsdGlwbGUgYWdlbnQtaG9va3MgZW50cnkgcG9pbnRzLlxuICpcbiAqIEV4dHJhY3RlZCBmcm9tIHByZS10b29sLXVzZS50cyBzbyB0aGF0IHRoZSB1cGNvbWluZyBTdG9wIGhvb2sgKGFuZCBhbnlcbiAqIGZ1dHVyZSBob29rcykgY2FuIGltcG9ydCBwYXRoIHV0aWxpdGllcywgcmFuZ2UgaGVscGVycywgYW5kIHRoZVxuICogc2FuaXRpemVTZXNzaW9uSWQvZm9ybWF0QW5jaG9yIGZ1bmN0aW9ucyB3aXRob3V0IGRlcGVuZGluZyBvbiB0aGVcbiAqIFByZVRvb2xVc2Utc3BlY2lmaWMgbW9kdWxlLlxuICovXG5cbmltcG9ydCB7IGV4ZWNGaWxlU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG9zIGZyb20gJ25vZGU6b3MnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQYXRoIGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgZnVuY3Rpb24gdG9Qb3NpeChwOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG59XG5cbmZ1bmN0aW9uIGlzQWJzb2x1dGVQb3NpeChwOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHAuc3RhcnRzV2l0aCgnLycpIHx8IC9eW0EtWmEtel06XFwvLy50ZXN0KHApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYWJzcGF0aEFnYWluc3QoYmFzZTogc3RyaW5nLCB0YXJnZXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHQgPSB0b1Bvc2l4KHRhcmdldCk7XG4gIGlmIChpc0Fic29sdXRlUG9zaXgodCkpIHJldHVybiB0O1xuICBjb25zdCBiID0gdG9Qb3NpeChiYXNlKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgcmV0dXJuIGAke2J9LyR7dH1gO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVJlcG9Sb290KGRpcjogc3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbCk6IHN0cmluZyB8IG51bGwge1xuICBpZiAoIWRpcikgcmV0dXJuIG51bGw7XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgZGlyLCAncmV2LXBhcnNlJywgJy0tc2hvdy10b3BsZXZlbCddLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIGVuY29kaW5nOiAndXRmOCdcbiAgICB9KTtcbiAgICBjb25zdCB0cmltbWVkID0gb3V0LnRyaW0oKTtcbiAgICByZXR1cm4gdHJpbW1lZC5sZW5ndGggPiAwID8gdG9Qb3NpeCh0cmltbWVkKSA6IG51bGw7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbi8qKlxuICogUmVwb3J0IHdoZXRoZXIgYSByZXBvLXJlbGF0aXZlIHBhdGggaXMgZXhjbHVkZWQgYnkgZ2l0J3MgaWdub3JlIHJ1bGVzXG4gKiAoLmdpdGlnbm9yZSwgLmdpdC9pbmZvL2V4Y2x1ZGUsIGNvcmUuZXhjbHVkZXNGaWxlKS4gVXNlZCB0byBrZWVwIGlnbm9yZWRcbiAqIGZpbGVzIFx1MjAxNCBidWlsZCBvdXRwdXQsIGNhY2hlcywgbG9ncyBcdTIwMTQgb3V0IG9mIHRvdWNoIHRyYWNraW5nIGVudGlyZWx5LCBzb1xuICogdGhlIHRvdWNoIGhvb2sgbmV2ZXIgcmVwb3J0cyByZWFkcywgd3JpdGVzLCBvciB1bmNvdmVyZWQgd3JpdGVzIG9uIHRoZW0uXG4gKlxuICogYGdpdCBjaGVjay1pZ25vcmUgLXEgPHBhdGg+YCBleGl0cyAwIHdoZW4gdGhlIHBhdGggaXMgaWdub3JlZCwgMSB3aGVuIGl0IGlzXG4gKiBub3QsIGFuZCAxMjggb24gZXJyb3IuIGV4ZWNGaWxlU3luYyB0aHJvd3Mgb24gYW55IG5vbi16ZXJvIGV4aXQsIHNvIGEgY2xlYW5cbiAqIHJldHVybiBtZWFucyBcImlnbm9yZWRcIi4gQSBzdGF0dXMtMSB0aHJvdyBpcyB0aGUgZXhwZWN0ZWQgXCJub3QgaWdub3JlZFwiXG4gKiBzaWduYWw7IGFueSBvdGhlciBmYWlsdXJlIGlzIGFuIHVucmVsaWFibGUgYW5zd2VyLCBzbyB3ZSByZXBvcnQgYGZhbHNlYFxuICogKGRvIG5vdCBkcm9wIHRoZSB0b3VjaCkgcmF0aGVyIHRoYW4gc2lsZW50bHkgaGlkaW5nIGEgdHJhY2tlZCBmaWxlLlxuICovXG4vKipcbiAqIFRoZSBkZWZhdWx0IHNwYW4gcm9vdCBkaXJlY3RvcnksIHJlbGF0aXZlIHRvIHRoZSByZXBvIHJvb3QsIHVzZWQgd2hlbiBub1xuICogZW52aXJvbm1lbnQgdmFyaWFibGUgb3IgZ2l0IGNvbmZpZyBvdmVycmlkZXMgdGhlIGxvY2F0aW9uLlxuICovXG5leHBvcnQgY29uc3QgU1BBTl9ST09UID0gJy5zcGFuJztcblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBzcGFuIHJvb3QgZGlyZWN0b3J5IGZvciBhIGdpdmVuIHJlcG8sIG1pcnJvcmluZyB0aGUgUnVzdCBDTElcbiAqIHByZWNlZGVuY2UgKG1pbnVzIHRoZSAtLXNwYW4tZGlyIENMSSBmbGFnLCB3aGljaCBpcyBpbnZpc2libGUgdG8gZmlsZS13cml0ZVxuICogaG9va3MpOlxuICogICAxLiBHSVRfU1BBTl9ESVIgZW52aXJvbm1lbnQgdmFyaWFibGVcbiAqICAgMi4gYGdpdCBjb25maWcgZ2l0LXNwYW4uZGlyYCBpbiB0aGUgcmVwb1xuICogICAzLiBEZWZhdWx0OiBcIi5zcGFuXCJcbiAqXG4gKiBUaGUgcmV0dXJuZWQgdmFsdWUgaXMgYSBQT1NJWC1zdHlsZSBwYXRoIHdpdGggbm8gdHJhaWxpbmcgc2xhc2guXG4gKiBGYWlsLXNhZmU6IGFueSByZXNvbHV0aW9uIGVycm9yIGZhbGxzIGJhY2sgdG8gXCIuc3BhblwiIHNvIHRoZSBob29rIG5ldmVyXG4gKiBjcmFzaGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBlbnZEaXIgPSBwcm9jZXNzLmVudlsnR0lUX1NQQU5fRElSJ107XG4gIGlmIChlbnZEaXIgJiYgZW52RGlyLnRyaW0oKS5sZW5ndGggPiAwKSB7XG4gICAgcmV0dXJuIHRvUG9zaXgoZW52RGlyLnRyaW0oKSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIH1cbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ2NvbmZpZycsICdnaXQtc3Bhbi5kaXInXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnXG4gICAgfSk7XG4gICAgY29uc3QgdHJpbW1lZCA9IHRvUG9zaXgob3V0LnRyaW0oKSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gICAgaWYgKHRyaW1tZWQubGVuZ3RoID4gMCkgcmV0dXJuIHRyaW1tZWQ7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHZvaWQgZXJyOyAvLyBjb25maWcga2V5IGFic2VudCBvciBnaXQgZXJyb3IgXHUyMDE0IGZhbGwgdGhyb3VnaCB0byBkZWZhdWx0XG4gIH1cbiAgcmV0dXJuIFNQQU5fUk9PVDtcbn1cblxuLyoqXG4gKiBSZXBvcnQgd2hldGhlciBhIHJlcG8tcmVsYXRpdmUgUE9TSVggcGF0aCBmYWxscyBpbnNpZGUgdGhlIGdpdmVuIHNwYW4gcm9vdFxuICogZGlyZWN0b3J5LiBBIHBhdGggaXMgaW5zaWRlIHdoZW4gaXQgZXF1YWxzIHRoZSBzcGFuIHJvb3QgZXhhY3RseSBvciBpc1xuICogbmVzdGVkIGJlbmVhdGggaXQgKGkuZS4gc3RhcnRzIHdpdGggXCI8c3BhblJvb3Q+L1wiKS4gVGhlIFwiL1wiIGJvdW5kYXJ5IHByZXZlbnRzXG4gKiBmYWxzZSBwb3NpdGl2ZXMgZm9yIHNpYmxpbmdzIGxpa2UgXCIuc3BhbnMveFwiIG9yIFwiLnNwYW4tbm90ZXMveFwiLlxuICpcbiAqIFBhc3MgdGhlIHJlc3VsdCBvZiBgcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290KWAgYXMgYHNwYW5Sb290YC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzSW5zaWRlU3BhblJvb3QocmVwb1JlbFBhdGg6IHN0cmluZywgc3BhblJvb3Q6IHN0cmluZyA9IFNQQU5fUk9PVCk6IGJvb2xlYW4ge1xuICBjb25zdCByb290ID0gc3BhblJvb3QucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIHJldHVybiByZXBvUmVsUGF0aCA9PT0gcm9vdCB8fCByZXBvUmVsUGF0aC5zdGFydHNXaXRoKGAke3Jvb3R9L2ApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNHaXRJZ25vcmVkKHJlcG9Sb290OiBzdHJpbmcsIHJlcG9SZWxQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ2NoZWNrLWlnbm9yZScsICctcScsICctLScsIHJlcG9SZWxQYXRoXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ2lnbm9yZScsICdpZ25vcmUnXVxuICAgIH0pO1xuICAgIHJldHVybiB0cnVlO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB2b2lkIGVycjtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290OiBzdHJpbmcsIGFic1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHJvb3QgPSB0b1Bvc2l4KHJlcG9Sb290KTtcbiAgY29uc3QgYWJzID0gdG9Qb3NpeChhYnNQYXRoKTtcbiAgY29uc3QgcHJlZml4ID0gcm9vdC5lbmRzV2l0aCgnLycpID8gcm9vdCA6IGAke3Jvb3R9L2A7XG4gIHJldHVybiBhYnMuc3RhcnRzV2l0aChwcmVmaXgpID8gYWJzLnNsaWNlKHByZWZpeC5sZW5ndGgpIDogYWJzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2Fub25pY2FsaXplUGF0aChhYnNQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICB0cnkge1xuICAgIHJldHVybiB0b1Bvc2l4KGZzLnJlYWxwYXRoU3luYy5uYXRpdmUoYWJzUGF0aCkpO1xuICB9IGNhdGNoIHtcbiAgICAvLyBGaWxlIGRvZXNuJ3QgZXhpc3QgeWV0IChlLmcuIFdyaXRlIHRvIGEgbmV3IGZpbGUpOiBjYW5vbmljYWxpemUgdGhlXG4gICAgLy8gZGlyZWN0b3J5IGFuZCByZWpvaW4gdGhlIGJhc2VuYW1lIHNvIHN5bWxpbmtzIGluIHRoZSBwYXJlbnQgYXJlIHJlc29sdmVkLlxuICAgIHRyeSB7XG4gICAgICBjb25zdCBkaXIgPSB0b1Bvc2l4KGZzLnJlYWxwYXRoU3luYy5uYXRpdmUobm9kZVBhdGguZGlybmFtZShhYnNQYXRoKSkpO1xuICAgICAgcmV0dXJuIGAke2Rpcn0vJHtub2RlUGF0aC5iYXNlbmFtZShhYnNQYXRoKX1gO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gUGFyZW50IGRvZXNuJ3QgZXhpc3QgZWl0aGVyOyBmYWxsIGJhY2sgdG8gdGhlIHVuLWNhbm9uaWNhbGl6ZWQgcGF0aC5cbiAgICAgIHJldHVybiBhYnNQYXRoO1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZGVyaXZlUGF0aCh0b29sSW5wdXQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBjd2Q6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCBmcCA9IHRvb2xJbnB1dC5maWxlX3BhdGg7XG4gIGlmICh0eXBlb2YgZnAgIT09ICdzdHJpbmcnIHx8IGZwLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGFicyA9IGFic3BhdGhBZ2FpbnN0KGN3ZCwgZnApO1xuICByZXR1cm4gY2Fub25pY2FsaXplUGF0aChhYnMpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIExpbmUgcmFuZ2UgdHlwZXMgYW5kIGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIExpbmVSYW5nZSB7XG4gIHN0YXJ0OiBudW1iZXI7XG4gIGVuZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmFuZ2VzSW50ZXJzZWN0KGE6IExpbmVSYW5nZSwgYjogTGluZVJhbmdlKTogYm9vbGVhbiB7XG4gIHJldHVybiBhLnN0YXJ0IDw9IGIuZW5kICYmIGEuZW5kID49IGIuc3RhcnQ7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUG9yY2VsYWluIHJvdyBwYXJzaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBQb3JjZWxhaW5Sb3cge1xuICBuYW1lOiBzdHJpbmc7XG4gIHBhdGg6IHN0cmluZztcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVBvcmNlbGFpbihzdGRvdXQ6IHN0cmluZyk6IFBvcmNlbGFpblJvd1tdIHtcbiAgY29uc3Qgcm93czogUG9yY2VsYWluUm93W10gPSBbXTtcbiAgZm9yIChjb25zdCBsaW5lIG9mIHN0ZG91dC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkKSBjb250aW51ZTtcbiAgICBjb25zdCBwYXJ0cyA9IHRyaW1tZWQuc3BsaXQoJ1xcdCcpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPCAzKSBjb250aW51ZTtcbiAgICBjb25zdCBbbmFtZSwgcGF0aCwgcmFuZ2VdID0gcGFydHM7XG4gICAgY29uc3QgZGFzaElkeCA9IHJhbmdlLmluZGV4T2YoJy0nKTtcbiAgICBpZiAoZGFzaElkeCA9PT0gLTEpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHN0YXJ0ID0gcGFyc2VJbnQocmFuZ2Uuc2xpY2UoMCwgZGFzaElkeCksIDEwKTtcbiAgICBjb25zdCBlbmQgPSBwYXJzZUludChyYW5nZS5zbGljZShkYXNoSWR4ICsgMSksIDEwKTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0KSB8fCBOdW1iZXIuaXNOYU4oZW5kKSkgY29udGludWU7XG4gICAgcm93cy5wdXNoKHsgbmFtZSwgcGF0aCwgc3RhcnQsIGVuZCB9KTtcbiAgfVxuICByZXR1cm4gcm93cztcbn1cblxuLyoqXG4gKiBUaGUgZnVsbCBgZ2l0IHNwYW4gc3RhbGUgLS1mb3JtYXQgcG9yY2VsYWluYCBzdGF0dXMgdG9rZW4gdm9jYWJ1bGFyeSAodGhlXG4gKiBnaXQtc3BhbiBDTEkncyBwb3JjZWxhaW4gY29udHJhY3QpOiBgRlJFU0hgL2BNT1ZFRGAvYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYFxuICogYXJlIHBvc2l0aW9uYWwtb3ItY2xlYW4gYW5kIG5ldmVyIGRlYnQ7IGV2ZXJ5IG90aGVyIHRva2VuIGlzIHNlbWFudGljIGRyaWZ0XG4gKiBvciBhIHRlcm1pbmFsL2Vycm9yIGNvbmRpdGlvbiBhbmQgaXMgZGVidC4gU2VlIHtAbGluayBpc0RlYnR9IGZvciB0aGVcbiAqIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGggb24gdGhhdCBzcGxpdC5cbiAqL1xuZXhwb3J0IGNvbnN0IFBPUkNFTEFJTl9TVEFUVVNFUyA9IFtcbiAgJ0ZSRVNIJyxcbiAgJ1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUJyxcbiAgJ01PVkVEJyxcbiAgJ0NIQU5HRUQnLFxuICAnREVMRVRFRCcsXG4gICdDT05GTElDVCcsXG4gICdTVUJNT0RVTEUnLFxuICAnTEZTX05PVF9GRVRDSEVEJyxcbiAgJ0xGU19OT1RfSU5TVEFMTEVEJyxcbiAgJ1BST01JU09SX01JU1NJTkcnLFxuICAnU1BBUlNFX0VYQ0xVREVEJyxcbiAgJ0ZJTFRFUl9GQUlMRUQnLFxuICAnSU9fRVJST1InXG5dIGFzIGNvbnN0O1xuXG5leHBvcnQgdHlwZSBQb3JjZWxhaW5TdGF0dXMgPSAodHlwZW9mIFBPUkNFTEFJTl9TVEFUVVNFUylbbnVtYmVyXTtcblxuY29uc3QgUE9SQ0VMQUlOX1NUQVRVU19TRVQ6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFBPUkNFTEFJTl9TVEFUVVNFUyk7XG5cbmZ1bmN0aW9uIHBhcnNlUG9yY2VsYWluU3RhdHVzKHJhdzogc3RyaW5nKTogUG9yY2VsYWluU3RhdHVzIHwgbnVsbCB7XG4gIHJldHVybiBQT1JDRUxBSU5fU1RBVFVTX1NFVC5oYXMocmF3KSA/IChyYXcgYXMgUG9yY2VsYWluU3RhdHVzKSA6IG51bGw7XG59XG5cbi8qKiBBIGBwYXJzZVN0YWxlUG9yY2VsYWluYCByb3c6IGEge0BsaW5rIFBvcmNlbGFpblJvd30gcGx1cyBpdHMgc3RhdHVzIHRva2VuLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTdGFsZVBvcmNlbGFpblJvdyBleHRlbmRzIFBvcmNlbGFpblJvdyB7XG4gIHN0YXR1czogUG9yY2VsYWluU3RhdHVzO1xufVxuXG4vKipcbiAqIFRoZSBkZWJ0IGludmFyaWFudCAoc3lzdGVtLXdpZGU7IGNvbnN1bWVkIGJ5IGJvdGggdGhlIGZ1dHVyZSB0b3VjaC1jb3JlIGFuZFxuICogZ2F0ZS1jb3JlKTogb25seSBzZW1hbnRpYyBzdGF0dXNlcyBhcmUgZGVidC4gYENIQU5HRURgIGFuZCBgREVMRVRFRGAgYXJlXG4gKiBzZW1hbnRpYyBkcmlmdDsgdGhlIHJlbWFpbmluZyBub24tRlJFU0gvTU9WRUQvUkVTT0xWRURfUEVORElOR19DT01NSVQgdG9rZW5zXG4gKiBhcmUgdGVybWluYWwvZXJyb3IgY29uZGl0aW9ucyBhbmQgYXJlIHRyZWF0ZWQgYXMgZGVidCB0b28gKHRoZXkgYmxvY2sgb25cbiAqIHRoZWlyIG93biBtZXJpdHMgXHUyMDE0IHRoZSBDTEkgY291bGQgbm90IHJlc29sdmUgdGhlIGFuY2hvciBhdCBhbGwpLiBgRlJFU0hgLFxuICogYE1PVkVEYCwgYW5kIGBSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgYXJlIG5ldmVyIGRlYnQ6IHBvc2l0aW9uYWwgZHJpZnQgdGhlXG4gKiBDTEkgY2FuIGhlYWwgKG9yIGFscmVhZHkgaGFzKSBpcyBpbnZpc2libGUsIGFuZCBhIHBlbmRpbmctY29tbWl0IHJlc29sdXRpb25cbiAqIGlzIG5vdCBvdXRzdGFuZGluZyBkZWJ0LlxuICpcbiAqIE5vdGU6IHRoZSBwb3JjZWxhaW4gdm9jYWJ1bGFyeSBkb2VzIG5vdCBjdXJyZW50bHkgZGlzdGluZ3Vpc2hcbiAqIGNvbnRlbnQtZXF1aXZhbGVudCBgQ0hBTkdFRGAgKGUuZy4gd2hpdGVzcGFjZS1vbmx5IGRyaWZ0IGAtLWZpeGAgY2FuIGhlYWwpXG4gKiBmcm9tIGdlbnVpbmVseSBzZW1hbnRpYyBgQ0hBTkdFRGAgXHUyMDE0IHRoYXQgY2xhc3NpZmljYXRpb24gaXMgbm90IHByZXNlbnQgaW5cbiAqIGBnaXQgc3BhbiBzdGFsZSAtLWZvcm1hdCBwb3JjZWxhaW5gIG91dHB1dCB0b2RheS4gVW50aWwgdGhlIENMSSBleHBvc2VzIGl0LFxuICogZXZlcnkgYENIQU5HRURgIHJvdyBpcyB0cmVhdGVkIGFzIGRlYnQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0RlYnQoc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBib29sZWFuIHtcbiAgc3dpdGNoIChzdGF0dXMpIHtcbiAgICBjYXNlICdGUkVTSCc6XG4gICAgY2FzZSAnTU9WRUQnOlxuICAgIGNhc2UgJ1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUJzpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIHRydWU7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgdGVybWluYWwvZW52aXJvbm1lbnRhbCBzdGF0dXNlczogdGhlIENMSSBjb3VsZCBub3QgcmVzb2x2ZSB0aGUgYW5jaG9yIGF0XG4gKiBhbGwsIHNvIHRoZSByb3cgaXMgbm90IHNwYW4gZHJpZnQgYSB1c2VyIGNhbiBmaXggYnkgZWRpdGluZyBhIHNwYW4uIFRoZXNlIGFyZVxuICogYENPTkZMSUNUYCAodW5yZXNvbHZlZCBtZXJnZSksIGBTVUJNT0RVTEVgIChhbmNob3IgaW5zaWRlIGEgc3VibW9kdWxlKSxcbiAqIGBMRlNfTk9UX0ZFVENIRURgL2BMRlNfTk9UX0lOU1RBTExFRGAgKEdpdCBMRlMgY29udGVudCB1bmF2YWlsYWJsZSksXG4gKiBgUFJPTUlTT1JfTUlTU0lOR2AgKHBhcnRpYWwtY2xvbmUgb2JqZWN0IG5vdCBmZXRjaGVkKSwgYFNQQVJTRV9FWENMVURFRGBcbiAqIChwYXRoIG91dHNpZGUgdGhlIHNwYXJzZS1jaGVja291dCBjb25lKSwgYEZJTFRFUl9GQUlMRURgIChhIGNsZWFuL3NtdWRnZVxuICogZmlsdGVyIGVycm9yZWQpLCBhbmQgYElPX0VSUk9SYCAodHJhbnNpZW50IHJlYWQgZmFpbHVyZSkuXG4gKlxuICogVGhlc2UgYXJlIGEgc3RyaWN0IHN1YnNldCBvZiB7QGxpbmsgaXNEZWJ0fTogZXZlcnkgZW52aXJvbm1lbnRhbCBzdGF0dXMgaXNcbiAqIGFsc28gZGVidCAoaXQgYmxvY2tzIG9uIGl0cyBvd24gbWVyaXRzIHdoZW4gc3VyZmFjZWQgaW4gYSBzdGF0dXMgcmVwb3J0KSwgYnV0XG4gKiB0aGUgZ2F0ZSBtdXN0IHRyZWF0IHRoZW0gZGlmZmVyZW50bHkgZnJvbSAqc2VtYW50aWMqIGRyaWZ0IChgQ0hBTkdFRGAsXG4gKiBgREVMRVRFRGApLiBTZW1hbnRpYyBkcmlmdCBpcyBmaXhhYmxlIGJ5IGVkaXRpbmcgYSBzcGFuLCBzbyB0aGUgZ2F0ZSBmYWlsc1xuICogY2xvc2VkIG9uIGl0OyBhbiBlbnZpcm9ubWVudGFsIGNvbmRpdGlvbiBpcyBub3Qgc29tZXRoaW5nIGEgc3BhbiBlZGl0IGNhblxuICogcmVzb2x2ZSwgc28gdGhlIGdhdGUgZmFpbHMgT1BFTiBvbiBpdCAoYWxsb3csIGJ1dCBzdXJmYWNlIHRoZSBjb25kaXRpb24pIFx1MjAxNFxuICogcmUtZGVueWluZyBmb3JldmVyIG9uIGFuIGluZnJhIGZhaWx1cmUgdGhlIHVzZXIgY2Fubm90IGNsZWFyIGZyb20gaGVyZSB3b3VsZFxuICogY29udHJhZGljdCB0aGUgZmFpbC1vcGVuIGNvbnRyYWN0IHRoZSByZXN0IG9mIHRoZSBnYXRlIGFscmVhZHkgaG9ub3JzIGZvclxuICogQ0xJLWFic2VudC90aW1lb3V0L3BhcnNlLWZhaWx1cmUgY29uZGl0aW9ucy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRW52aXJvbm1lbnRhbFN0YXR1cyhzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IGJvb2xlYW4ge1xuICBzd2l0Y2ggKHN0YXR1cykge1xuICAgIGNhc2UgJ0NPTkZMSUNUJzpcbiAgICBjYXNlICdTVUJNT0RVTEUnOlxuICAgIGNhc2UgJ0xGU19OT1RfRkVUQ0hFRCc6XG4gICAgY2FzZSAnTEZTX05PVF9JTlNUQUxMRUQnOlxuICAgIGNhc2UgJ1BST01JU09SX01JU1NJTkcnOlxuICAgIGNhc2UgJ1NQQVJTRV9FWENMVURFRCc6XG4gICAgY2FzZSAnRklMVEVSX0ZBSUxFRCc6XG4gICAgY2FzZSAnSU9fRVJST1InOlxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIGBnaXQgc3BhbiBzdGFsZSAtLWZvcm1hdCBwb3JjZWxhaW5gIGVtaXRzIGEgZGlmZmVyZW50IHNoYXBlIHRoYW5cbiAqIGBsaXN0IC0tcG9yY2VsYWluYDogYSBgIyBwb3JjZWxhaW4gdjJgIGhlYWRlciwgYCMgZnV6enkgTmAgY29tbWVudCBsaW5lcyxcbiAqIGFuZCBvbmUgYDxzdGF0dXM+XFx0PHNyYz5cXHQ8bmFtZT5cXHQ8cGF0aD5cXHQ8c3RhcnQ+XFx0PGVuZD5gIHJvdyBwZXIgZHJpZnRlZFxuICogYW5jaG9yICh3aG9sZS1maWxlIGFuY2hvcnMgY2FycnkgYCh3aG9sZSlgL2AtYCBpbiBwbGFjZSBvZiB0aGUgbGluZSBjb2x1bW5zKS5cbiAqIFJvd3Mgd2hvc2Ugc3RhdHVzIHRva2VuIGlzIG5vdCBpbiB7QGxpbmsgUE9SQ0VMQUlOX1NUQVRVU0VTfSBhcmUgc2tpcHBlZCBcdTIwMTRcbiAqIGFuIHVucmVjb2duaXplZCB0b2tlbiBmcm9tIGEgbmV3ZXIgQ0xJIGlzIHRyZWF0ZWQgdGhlIHNhbWUgYXMgYSBtYWxmb3JtZWRcbiAqIGxpbmUgcmF0aGVyIHRoYW4gZ3Vlc3NlZCBhdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlU3RhbGVQb3JjZWxhaW4oc3Rkb3V0OiBzdHJpbmcpOiBTdGFsZVBvcmNlbGFpblJvd1tdIHtcbiAgY29uc3Qgcm93czogU3RhbGVQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygc3Rkb3V0LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQgfHwgdHJpbW1lZC5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHBhcnRzID0gdHJpbW1lZC5zcGxpdCgnXFx0Jyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDYpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFtzdGF0dXNDb2wsICwgbmFtZSwgcGF0aCwgc3RhcnRDb2wsIGVuZENvbF0gPSBwYXJ0cztcbiAgICBjb25zdCBzdGF0dXMgPSBwYXJzZVBvcmNlbGFpblN0YXR1cyhzdGF0dXNDb2wpO1xuICAgIGlmICghc3RhdHVzKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IHN0YXJ0Q29sID09PSAnKHdob2xlKScgPyAwIDogcGFyc2VJbnQoc3RhcnRDb2wsIDEwKTtcbiAgICBjb25zdCBlbmQgPSBlbmRDb2wgPT09ICctJyA/IDAgOiBwYXJzZUludChlbmRDb2wsIDEwKTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0KSB8fCBOdW1iZXIuaXNOYU4oZW5kKSkgY29udGludWU7XG4gICAgcm93cy5wdXNoKHsgbmFtZSwgcGF0aCwgc3RhcnQsIGVuZCwgc3RhdHVzIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFNlc3Npb24gSUQgc2FuaXRpemF0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBJbmplY3RpdmUgdHJhbnNmb3JtOiBwZXJjZW50LWVuY29kZSBieXRlcyBvdXRzaWRlIFtBLVphLXowLTkuXy1dIGFzICVISFxuICogKHVwcGVyY2FzZSBoZXgpLiBVc2VkIHRvIHByb2R1Y2Ugc2FmZSBmaWxlbmFtZXMgZnJvbSBhcmJpdHJhcnkgc2Vzc2lvbiBpZHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZVNlc3Npb25JZChzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzZXNzaW9uSWQucmVwbGFjZSgvW15BLVphLXowLTkuXy1dL2csIChjaCkgPT4ge1xuICAgIHJldHVybiBgJSR7Y2guY2hhckNvZGVBdCgwKS50b1N0cmluZygxNikudG9VcHBlckNhc2UoKS5wYWRTdGFydCgyLCAnMCcpfWA7XG4gIH0pO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBlci1zZXNzaW9uIGJhc2UgZGlyZWN0b3J5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLy8gQmFzZSBkaXIgc2hhcmVkIGJ5IGFsbCBwZXItc2Vzc2lvbiBzdGF0ZTogY3VycmVudGx5IGp1c3QgdGhlIHRvdWNoLWhvb2tcbi8vIHNlc3Npb24gbWVtbyAoc3Bhbi1zdXJmYWNlLnRzJ3MgTWVtb1N0b3JlKS4gRWFjaCBzZXNzaW9uIGdldHMgb25lXG4vLyBzdWJkaXJlY3Rvcnkga2V5ZWQgYnkgaXRzIHNhbml0aXplZCBpZCwgc28gZXZlcnkgd3JpdGVyL3JlYWRlciBmb3IgYSBnaXZlblxuLy8gc2Vzc2lvbiBhZ3JlZXMgb24gaXRzIGxvY2F0aW9uLlxuZXhwb3J0IGNvbnN0IFNFU1NJT05fQkFTRV9ESVIgPSBub2RlUGF0aC5qb2luKG9zLmhvbWVkaXIoKSwgJy5jYWNoZScsICdnaXQtc3BhbicsICdzZXNzaW9uJyk7XG5cbi8qKiBUaGUgcGVyLXNlc3Npb24gc3RhdGUgZGlyZWN0b3J5IGZvciBhIGdpdmVuIHNlc3Npb24gaWQuICovXG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvbkRpcihzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKFNFU1NJT05fQkFTRV9ESVIsIHNhbml0aXplU2Vzc2lvbklkKHNlc3Npb25JZCkpO1xufVxuXG5jb25zdCBUSElSVFlfREFZU19NUyA9IDMwICogMjQgKiA2MCAqIDYwICogMTAwMDtcblxuLyoqXG4gKiBPcHBvcnR1bmlzdGljYWxseSBwcnVuZSBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcmllcyB1bmRlclxuICoge0BsaW5rIFNFU1NJT05fQkFTRV9ESVJ9IHdob3NlIG10aW1lIGlzIG9sZGVyIHRoYW4gYG1heEFnZU1zYCAoZGVmYXVsdCAzMFxuICogZGF5cykuIEEgZGlyZWN0b3J5J3MgbXRpbWUgYWR2YW5jZXMgd2hlbmV2ZXIgYW4gZW50cnkgaW5zaWRlIGl0IGlzXG4gKiBjcmVhdGVkL3JlbmFtZWQvcmVtb3ZlZCwgc28gYW4gYWN0aXZlIHNlc3Npb24gKG1lbW8gd3JpdGVzKSBzdGF5cyBmcmVzaDtcbiAqIG9ubHkgZ2VudWluZWx5IGFiYW5kb25lZCBzZXNzaW9ucyBhZ2Ugb3V0LlxuICpcbiAqIEJlc3QtZWZmb3J0IGFuZCBub24tdGhyb3dpbmc6IGNhbGxlZCBvcHBvcnR1bmlzdGljYWxseSBmcm9tIGhvb2sgcmVhZC93cml0ZVxuICogcGF0aHMsIG5vdCBhIHNlcGFyYXRlIGNyb24tbGlrZSBtZWNoYW5pc20sIHNvIGEgZmFpbHVyZSBoZXJlIG11c3QgbmV2ZXJcbiAqIGJsb2NrIHRoZSBjYWxsZXIncyBhY3R1YWwgd29yay5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBydW5lU3RhbGVTZXNzaW9ucyhub3c6IG51bWJlciA9IERhdGUubm93KCksIG1heEFnZU1zOiBudW1iZXIgPSBUSElSVFlfREFZU19NUyk6IHZvaWQge1xuICBsZXQgZW50cmllczogZnMuRGlyZW50W107XG4gIHRyeSB7XG4gICAgZW50cmllcyA9IGZzLnJlYWRkaXJTeW5jKFNFU1NJT05fQkFTRV9ESVIsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuOyAvLyBiYXNlIGRpciBhYnNlbnQgb3IgdW5yZWFkYWJsZSBcdTIwMTQgbm90aGluZyB0byBwcnVuZVxuICB9XG4gIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgIGlmICghZW50cnkuaXNEaXJlY3RvcnkoKSkgY29udGludWU7XG4gICAgY29uc3QgZGlyUGF0aCA9IG5vZGVQYXRoLmpvaW4oU0VTU0lPTl9CQVNFX0RJUiwgZW50cnkubmFtZSk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0YXQgPSBmcy5zdGF0U3luYyhkaXJQYXRoKTtcbiAgICAgIGlmIChub3cgLSBzdGF0Lm10aW1lTXMgPiBtYXhBZ2VNcykge1xuICAgICAgICBmcy5ybVN5bmMoZGlyUGF0aCwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICAgICAgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gVmFuaXNoZWQgYmV0d2VlbiByZWFkZGlyIGFuZCBzdGF0LCBvciByZW1vdmFsIGZhaWxlZCBcdTIwMTQgc2tpcCBpdC4gQVxuICAgICAgLy8gYmVzdC1lZmZvcnQgcHJ1bmUgbXVzdCBuZXZlciB0aHJvdyBpbnRvIHRoZSBjYWxsZXIncyBob3QgcGF0aC5cbiAgICB9XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBraW5kIGFuZCBhbmNob3IgZm9ybWF0dGluZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB0eXBlIFRvdWNoS2luZCA9ICdyZWFkJyB8ICd3cml0ZScgfCAnd2hvbGUtcmVhZCcgfCAnd2hvbGUtd3JpdGUnIHwgJ2NyZWF0ZSc7XG5cbi8qKlxuICogRm9ybWF0IGEgc3BhbiBhbmNob3Igc3RyaW5nLlxuICpcbiAqIC0gYHdob2xlLXJlYWRgLCBgd2hvbGUtd3JpdGVgLCBhbmQgYGNyZWF0ZWA6IHJldHVybnMganVzdCB0aGUgcGF0aFxuICogLSBgcmVhZGAgYW5kIGB3cml0ZWA6IHJldHVybnMgYHBhdGgjTDxzdGFydD4tTDxlbmQ+YCAocmVxdWlyZXMgcmFuZ2UpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRBbmNob3IocGF0aDogc3RyaW5nLCBraW5kOiBUb3VjaEtpbmQsIHJhbmdlPzogTGluZVJhbmdlKTogc3RyaW5nIHtcbiAgaWYgKChraW5kID09PSAncmVhZCcgfHwga2luZCA9PT0gJ3dyaXRlJykgJiYgcmFuZ2UpIHtcbiAgICByZXR1cm4gYCR7cGF0aH0jTCR7cmFuZ2Uuc3RhcnR9LUwke3JhbmdlLmVuZH1gO1xuICB9XG4gIHJldHVybiBwYXRoO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEFuY2hvciBzcGVjIHR5cGVcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIEFuY2hvclNwZWMge1xuICBwYXRoOiBzdHJpbmc7XG4gIGtpbmQ6IFRvdWNoS2luZDtcbiAgcmFuZ2U/OiBMaW5lUmFuZ2U7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUXVldWUgZGlyZWN0b3J5IGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJlc29sdmUgdGhlIGdpdCBjb21tb24gZGlyZWN0b3J5IGZvciB0aGUgZ2l2ZW4gcmVwbyByb290LlxuICogVGhpcyBpcyB0aGUgc2hhcmVkIGRpcmVjdG9yeSAobm90IHRoZSB3b3JrdHJlZS1zcGVjaWZpYyAuZ2l0KSwgc28gcXVldWVcbiAqIHJlY29yZHMgc3Vydml2ZSB3b3JrdHJlZSBkZWxldGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVHaXRDb21tb25EaXIocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAncmV2LXBhcnNlJywgJy0tZ2l0LWNvbW1vbi1kaXInXSwge1xuICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgIGVuY29kaW5nOiAndXRmOCdcbiAgfSk7XG4gIGNvbnN0IHRyaW1tZWQgPSB0b1Bvc2l4KG91dC50cmltKCkpO1xuICAvLyBnaXQgcmV0dXJucyBhIHJlbGF0aXZlIHBhdGggKGUuZy4gXCIuZ2l0XCIpIGZvciBzaW1wbGUgcmVwb3MuIFJlc29sdmUgaXRcbiAgLy8gYWdhaW5zdCByZXBvUm9vdCBzbyBjYWxsZXJzIG5ldmVyIGRlcGVuZCBvbiBwcm9jZXNzLmN3ZCgpLlxuICBpZiAoIW5vZGVQYXRoLmlzQWJzb2x1dGUodHJpbW1lZCkpIHtcbiAgICByZXR1cm4gdG9Qb3NpeChub2RlUGF0aC5yZXNvbHZlKHJlcG9Sb290LCB0cmltbWVkKSk7XG4gIH1cbiAgcmV0dXJuIHRyaW1tZWQ7XG59XG5cbi8qKlxuICogUm9vdCBvZiB0aGUgZ2l0LXNwYW4gcXVldWUgZGlyZWN0b3J5IHRyZWUsIHVuZGVyIHRoZSBnaXQgY29tbW9uIGRpci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHF1ZXVlUm9vdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocmVzb2x2ZUdpdENvbW1vbkRpcihyZXBvUm9vdCksICdnaXQtc3BhbicpO1xufVxuXG4vKipcbiAqIERpcmVjdG9yeSBmb3IgdGhlIGdhdGUncyBwZXItY2hhbmdlc2V0IHN0YXRlIG1lbW9zIChkaWdlc3Qgb2Ygc29ydGVkXG4gKiBmaW5kaW5ncyArIHVuY292ZXJlZCBwYXRocyksIHVuZGVyIHRoZSBnaXQgY29tbW9uIGRpciBzbyBpdCBpcyBzaGFyZWRcbiAqIGFjcm9zcyB3b3JrdHJlZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnYXRlTWVtb0RpcihyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocXVldWVSb290KHJlcG9Sb290KSwgJ2dhdGUnKTtcbn1cbiIsICIvKipcbiAqIFBhdGggZXhjbHVzaW9uIGxpc3QgZm9yIHRoZSBnYXRlJ3MgdW5jb3ZlcmVkLXdyaXRlcyBjaGVjay5cbiAqXG4gKiBgZXZhbHVhdGVHYXRlYCBpbiB7QGxpbmsgZmlsZTovLy4vZ2F0ZS1jb3JlLnRzfSBhbHJlYWR5IGV4Y2x1ZGVzIGAuc3Bhbi8qKmBcbiAqIHBhdGhzIGZyb20gaXRzIHVuY292ZXJlZC13cml0ZXMgY29tcHV0YXRpb24gdW5jb25kaXRpb25hbGx5IChzcGFuIHJlcGFpcnNcbiAqIHJpZGUgdGhlIHNhbWUgY29tbWl0IGFuZCBtdXN0IG5ldmVyIHNlbGYtdHJpZ2dlciB0aGUgZ2F0ZSkuIFRoaXMgbW9kdWxlXG4gKiBhZGRzIGEgc2Vjb25kLCB1c2VyLWRlY2xhcmVkIGV4Y2x1c2lvbiBzb3VyY2Ugb24gdG9wIG9mIHRoYXQ6IGEgcmVwbyBvd25lclxuICogY2FuIGxpc3QgYWRkaXRpb25hbCBwYXRocyB0aGUgdW5jb3ZlcmVkLXdyaXRlcyBjaGVjayBzaG91bGQgbmV2ZXIgZmxhZyBcdTIwMTRcbiAqIGdlbmVyYXRlZCBvdXRwdXQsIHZlbmRvcmVkIGNvZGUsIGFueXRoaW5nIHRoYXQgd2lsbCBuZXZlciBnZXQgYSBzcGFuLlxuICpcbiAqIENvbmZpZyBsaXZlcyBhdCBgPHJlcG9Sb290Pi8uc3Bhbi8uZ2F0ZWlnbm9yZWAuIFVubGlrZVxuICoge0BsaW5rIGZpbGU6Ly8uL3NwYW4taWdub3JlLnRzfSdzIGAuc3Bhbi8uaG9va2lnbm9yZWAgXHUyMDE0IHdoaWNoIHRoZSBgZ2l0LXNwYW5gXG4gKiBSdXN0IENMSSBhdXRvLWNyZWF0ZXMgd2l0aCBjYW5vbmljYWwgY29udGVudCBcdTIwMTQgYC5nYXRlaWdub3JlYCBpc1xuICogKip1c2VyLW93bmVkKio6IG5vdGhpbmcgY3JlYXRlcyBvciBwb3B1bGF0ZXMgaXQsIHNvIGl0cyBhYnNlbmNlIGlzIHRoZVxuICogbm9ybWFsLCB1bmNvbmZpZ3VyZWQgc3RhdGUsIG5vdCBhIGJyb2tlbiBvbmUuXG4gKlxuICogRWFjaCBub24tY29tbWVudCBsaW5lIGlzIGEgc2luZ2xlIGdpdGlnbm9yZS1zdHlsZSBwYXRoIHBhdHRlcm4gKG5vIHRyYWlsaW5nXG4gKiBwcmVmaXggbGlzdCBcdTIwMTQgYSBgLmdhdGVpZ25vcmVgIGxpbmUgZWl0aGVyIGV4Y2x1ZGVzIGEgcGF0aCBmcm9tIHRoZVxuICogdW5jb3ZlcmVkLXdyaXRlcyBjaGVjayBvciBpdCBkb2Vzbid0LCB1bmxpa2UgYC5ob29raWdub3JlYCdzIHBlci1zcGFuLXNsdWdcbiAqIHN1cHByZXNzaW9uKTpcbiAqXG4gKiAgIHBhY2thZ2VzL2FnZW50LWhvb2tzL2dlbmVyYXRlZC8qKlxuICpcbiAqIFBhdHRlcm4gZ3JhbW1hciBpcyBpZGVudGljYWwgdG8gYC5ob29raWdub3JlYCdzIChzZWUgdGhhdCBtb2R1bGUncyBkb2NcbiAqIGNvbW1lbnQgZm9yIHRoZSBmdWxsIGdyYW1tYXIpIGFuZCByZXVzZXMgaXRzIGNvbXBpbGVkIG1hdGNoZXIgdmlhXG4gKiB7QGxpbmsgY29tcGlsZVBhdHRlcm59IHJhdGhlciB0aGFuIHJlaW1wbGVtZW50aW5nIHBhdGggbWF0Y2hpbmc6XG4gKlxuICogLSBCbGFuayBsaW5lcyBhbmQgbGluZXMgYmVnaW5uaW5nIHdpdGggYCNgIGFyZSBza2lwcGVkLlxuICogLSBBIHRyYWlsaW5nIGAvYCByZXN0cmljdHMgdGhlIHBhdHRlcm4gdG8gZGlyZWN0b3JpZXMuXG4gKiAtIEEgcGF0dGVybiBjb250YWluaW5nIGEgc2xhc2ggaXMgYW5jaG9yZWQgdG8gdGhlIHJlcG8gcm9vdDsgYSBwYXR0ZXJuIHdpdGhcbiAqICAgbm8gc2xhc2ggbWF0Y2hlcyBhIHNpbmdsZSBwYXRoIGNvbXBvbmVudCBhdCBhbnkgZGVwdGguXG4gKiAtIGAqYCBhbmQgYD9gIG1hdGNoIHdpdGhpbiBvbmUgcGF0aCBzZWdtZW50OyBgKipgIG1hdGNoZXMgYWNyb3NzIHNlZ21lbnRzLlxuICogLSBOZWdhdGlvbiAoYCFgKSBpcyBub3Qgc3VwcG9ydGVkLlxuICpcbiAqIEZhaWwtb3BlbjogYSBtaXNzaW5nIG9yIHVucmVhZGFibGUgYC5nYXRlaWdub3JlYCwgb3IgYSBtYWxmb3JtZWQgbGluZSxcbiAqIHlpZWxkcyBubyBhZGRpdGlvbmFsIGV4Y2x1c2lvbiBcdTIwMTQgdGhlIHVuY292ZXJlZC13cml0ZXMgY2hlY2sgc2ltcGx5IGZhbGxzXG4gKiBiYWNrIHRvIHRoZSBgLnNwYW4vKipgLW9ubHkgZXhjbHVzaW9uIGl0IGFscmVhZHkgYXBwbGllcy5cbiAqL1xuXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBjb21waWxlUGF0dGVybiB9IGZyb20gJy4vc3Bhbi1pZ25vcmUuanMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEdhdGVJZ25vcmVSdWxlIHtcbiAgLyoqIFRoZSByYXcgZ2l0aWdub3JlLXN0eWxlIHBhdHRlcm4sIHJldGFpbmVkIGZvciBkaWFnbm9zdGljcy4gKi9cbiAgcGF0dGVybjogc3RyaW5nO1xuICAvKiogVHJ1ZSB3aGVuIGByZXBvUmVsUGF0aGAgKFBPU0lYLCByZXBvLXJlbGF0aXZlKSBpcyBleGNsdWRlZCBieSB0aGlzIHJ1bGUuICovXG4gIG1hdGNoZXM6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuO1xufVxuXG5jb25zdCBHQVRFX0lHTk9SRV9SRUwgPSBub2RlUGF0aC5qb2luKCcuc3BhbicsICcuZ2F0ZWlnbm9yZScpO1xuXG4vKiogUGFyc2UgYC5nYXRlaWdub3JlYCB0ZXh0IGludG8gcnVsZXMsIHNraXBwaW5nIGNvbW1lbnRzIGFuZCBibGFuayBsaW5lcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUdhdGVJZ25vcmUoY29udGVudDogc3RyaW5nKTogR2F0ZUlnbm9yZVJ1bGVbXSB7XG4gIGNvbnN0IHJ1bGVzOiBHYXRlSWdub3JlUnVsZVtdID0gW107XG4gIGZvciAoY29uc3QgcmF3TGluZSBvZiBjb250ZW50LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHBhdHRlcm4gPSByYXdMaW5lLnRyaW0oKTtcbiAgICBpZiAoIXBhdHRlcm4gfHwgcGF0dGVybi5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIHJ1bGVzLnB1c2goeyBwYXR0ZXJuLCBtYXRjaGVzOiBjb21waWxlUGF0dGVybihwYXR0ZXJuKSB9KTtcbiAgfVxuICByZXR1cm4gcnVsZXM7XG59XG5cbi8qKlxuICogTG9hZCB0aGUgZXhjbHVzaW9uIHJ1bGVzIGZvciBhIHJlcG8uIEZhaWwtb3BlbjogYW55IHJlYWQgZmFpbHVyZSB5aWVsZHMgYW5cbiAqIGVtcHR5IHJ1bGUgc2V0LCBzbyBhbiBhYnNlbnQvdW5yZWFkYWJsZSBgLmdhdGVpZ25vcmVgIGV4Y2x1ZGVzIG5vdGhpbmdcbiAqIGJleW9uZCB0aGUgZ2F0ZSdzIHVuY29uZGl0aW9uYWwgYC5zcGFuLyoqYCBleGNsdXNpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsb2FkR2F0ZUlnbm9yZShyZXBvUm9vdDogc3RyaW5nKTogR2F0ZUlnbm9yZVJ1bGVbXSB7XG4gIHRyeSB7XG4gICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhub2RlUGF0aC5qb2luKHJlcG9Sb290LCBHQVRFX0lHTk9SRV9SRUwpLCAndXRmOCcpO1xuICAgIHJldHVybiBwYXJzZUdhdGVJZ25vcmUoY29udGVudCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBbXTtcbiAgfVxufVxuXG4vKiogVHJ1ZSB3aGVuIHNvbWUgcnVsZSBpbiBgcnVsZXNgIG1hdGNoZXMgYHJlcG9SZWxQYXRoYC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0dhdGVJZ25vcmVkKHJ1bGVzOiBHYXRlSWdub3JlUnVsZVtdLCByZXBvUmVsUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBydWxlcy5zb21lKChydWxlKSA9PiBydWxlLm1hdGNoZXMocmVwb1JlbFBhdGgpKTtcbn1cblxuLyoqIFNpZ25hdHVyZSBmb3IgaW5qZWN0aW5nIGEgcnVsZSBsb2FkZXIgKHByb2R1Y3Rpb24gZGVmYXVsdDoge0BsaW5rIGxvYWRHYXRlSWdub3JlfSkuICovXG5leHBvcnQgdHlwZSBHYXRlSWdub3JlTG9hZGVyID0gKHJlcG9Sb290OiBzdHJpbmcpID0+IEdhdGVJZ25vcmVSdWxlW107XG4iLCAiLyoqXG4gKiBQYXRoLXNjb3BlZCBzcGFuIHN1cHByZXNzaW9uIGZvciB0aGUgYWdlbnQgaG9va3MuXG4gKlxuICogU29tZSBzcGFucyBhcmUgbm9pc2Ugd2hlbiBicm93c2luZyBjZXJ0YWluIHBhcnRzIG9mIHRoZSB0cmVlIFx1MjAxNCB3aWtpIG9yXG4gKiBtYXJrZXRpbmcgc3BhbnMgdGhhdCBhbmNob3IgcHJvc2UsIHN1cmZhY2VkIGlubGluZSB3aGlsZSByZWFkaW5nIHNvdXJjZSxcbiAqIGFkZCBsaXR0bGUuIFRoaXMgbW9kdWxlIGxldHMgYSByZXBvIGRlY2xhcmUsIHBlciBwYXRoLCB3aGljaCBzcGFuIHNsdWdcbiAqIHByZWZpeGVzIHRvIGhvbGQgYmFjay5cbiAqXG4gKiBDb25maWcgbGl2ZXMgYXQgYDxyZXBvUm9vdD4vLnNwYW4vLmhvb2tpZ25vcmVgLiBFYWNoIG5vbi1jb21tZW50IGxpbmUgaXMgYVxuICogZ2l0aWdub3JlLXN0eWxlIHBhdGggcGF0dGVybiwgYSBzaW5nbGUgcnVuIG9mIHdoaXRlc3BhY2UsIHRoZW4gYVxuICogY29tbWEtc2VwYXJhdGVkIGxpc3Qgb2Ygc3BhbiBzbHVnIHByZWZpeGVzIHRvIHN1cHByZXNzIGZvciBwYXRocyB0aGUgcGF0dGVyblxuICogbWF0Y2hlczpcbiAqXG4gKiAgIHBhY2thZ2VzL2FnZW50LWhvb2tzL3NyYyB3aWtpLG1hcmtldGluZ1xuICpcbiAqIEEgc3BhbiB3aG9zZSBzbHVnIGJlZ2lucyB3aXRoIGB3aWtpYCBvciBgbWFya2V0aW5nYCAodGhlIHNsdWcgZXF1YWxzIHRoZVxuICogcHJlZml4LCBvciBpcyBgPHByZWZpeD4vXHUyMDI2YCkgaXMgdGhlbiBuZXZlciBzdXJmYWNlZCBmb3IgYW4gYW5jaG9yIHdob3NlIHBhdGhcbiAqIHNpdHMgdW5kZXIgYHBhY2thZ2VzL2FnZW50LWhvb2tzL3NyY2AgXHUyMDE0IG5laXRoZXIgaW5saW5lIGJ5IHRoZSBQcmVUb29sVXNlIGhvb2tcbiAqIG5vciBpbiB0aGUgU3RvcCBob29rJ3Mgc3RhbGUgLyByZWxhdGVkIHNlY3Rpb25zLlxuICpcbiAqIFBhdHRlcm4gZ3JhbW1hciBpcyBhIGRlbGliZXJhdGUgc3Vic2V0IG9mIGdpdGlnbm9yZTpcbiAqXG4gKiAtIEJsYW5rIGxpbmVzIGFuZCBsaW5lcyBiZWdpbm5pbmcgd2l0aCBgI2AgYXJlIHNraXBwZWQuXG4gKiAtIEEgdHJhaWxpbmcgYC9gIHJlc3RyaWN0cyB0aGUgcGF0dGVybiB0byBkaXJlY3RvcmllcyAodGhlIGxlYWYgZmlsZSBpcyBub3RcbiAqICAgaXRzZWxmIHRlc3RlZCwgb25seSBpdHMgYW5jZXN0b3IgZGlyZWN0b3JpZXMpLlxuICogLSBBIHBhdHRlcm4gY29udGFpbmluZyBhIHNsYXNoIGlzIGFuY2hvcmVkIHRvIHRoZSByZXBvIHJvb3Q7IGEgcGF0dGVybiB3aXRoXG4gKiAgIG5vIHNsYXNoIG1hdGNoZXMgYSBzaW5nbGUgcGF0aCBjb21wb25lbnQgYXQgYW55IGRlcHRoLlxuICogLSBgKmAgYW5kIGA/YCBtYXRjaCB3aXRoaW4gb25lIHBhdGggc2VnbWVudDsgYCoqYCBtYXRjaGVzIGFjcm9zcyBzZWdtZW50cy5cbiAqIC0gTmVnYXRpb24gKGAhYCkgaXMgbm90IHN1cHBvcnRlZC5cbiAqXG4gKiBTdXBwcmVzc2lvbiBpcyBmYWlsLW9wZW46IGEgbWlzc2luZyBvciB1bnJlYWRhYmxlIGAuaG9va2lnbm9yZWAsIG9yIGFcbiAqIG1hbGZvcm1lZCBsaW5lLCB5aWVsZHMgbm8gcnVsZSByYXRoZXIgdGhhbiBoaWRpbmcgc3BhbnMgdGhlIGF1dGhvciBkaWQgbm90XG4gKiBhc2sgdG8gaGlkZS5cbiAqL1xuXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgSWdub3JlUnVsZSB7XG4gIC8qKiBUaGUgcmF3IGdpdGlnbm9yZS1zdHlsZSBwYXR0ZXJuLCByZXRhaW5lZCBmb3IgZGlhZ25vc3RpY3MuICovXG4gIHBhdHRlcm46IHN0cmluZztcbiAgLyoqIFNwYW4gc2x1ZyBwcmVmaXhlcyBzdXBwcmVzc2VkIGZvciBwYXRocyB0aGlzIHJ1bGUgbWF0Y2hlcy4gKi9cbiAgcHJlZml4ZXM6IHN0cmluZ1tdO1xuICAvKiogVHJ1ZSB3aGVuIGByZXBvUmVsUGF0aGAgKFBPU0lYLCByZXBvLXJlbGF0aXZlKSBpcyBnb3Zlcm5lZCBieSB0aGlzIHJ1bGUuICovXG4gIG1hdGNoZXM6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuO1xufVxuXG5jb25zdCBIT09LX0lHTk9SRV9SRUwgPSBub2RlUGF0aC5qb2luKCcuc3BhbicsICcuaG9va2lnbm9yZScpO1xuXG4vKipcbiAqIFRyYW5zbGF0ZSBvbmUgZ2l0aWdub3JlLXN0eWxlIGdsb2Igc2VnbWVudCBpbnRvIGFuIGFuY2hvcmVkIFJlZ0V4cC4gYCpgIGFuZFxuICogYD9gIHN0YXkgd2l0aGluIGEgcGF0aCBzZWdtZW50OyBgKipgIChvcHRpb25hbGx5IGZvbGxvd2VkIGJ5IGAvYCkgc3BhbnMgdGhlbS5cbiAqL1xuZnVuY3Rpb24gZ2xvYlRvUmVnRXhwKGdsb2I6IHN0cmluZyk6IFJlZ0V4cCB7XG4gIGxldCByZSA9ICcnO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGdsb2IubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjID0gZ2xvYltpXTtcbiAgICBpZiAoYyA9PT0gJyonKSB7XG4gICAgICBpZiAoZ2xvYltpICsgMV0gPT09ICcqJykge1xuICAgICAgICByZSArPSAnLionO1xuICAgICAgICBpKys7XG4gICAgICAgIC8vIEFic29yYiBhIGZvbGxvd2luZyBzbGFzaCBzbyBgKiovZm9vYCBkb2VzIG5vdCBkZW1hbmQgYSBsaXRlcmFsIGAvYC5cbiAgICAgICAgaWYgKGdsb2JbaSArIDFdID09PSAnLycpIGkrKztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlICs9ICdbXi9dKic7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChjID09PSAnPycpIHtcbiAgICAgIHJlICs9ICdbXi9dJztcbiAgICB9IGVsc2Uge1xuICAgICAgcmUgKz0gYy5yZXBsYWNlKC9bLiteJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG5ldyBSZWdFeHAoYF4ke3JlfSRgKTtcbn1cblxuLyoqIEFuY2VzdG9yIHBhdGggY2hhaW46IGBhL2IvYy50c2AgXHUyMTkyIGBbJ2EnLCAnYS9iJywgJ2EvYi9jLnRzJ11gLiAqL1xuZnVuY3Rpb24gYW5jZXN0b3JQYXRocyhwYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHBhcnRzID0gcGF0aC5zcGxpdCgnLycpO1xuICBjb25zdCBvdXQ6IHN0cmluZ1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICBvdXQucHVzaChwYXJ0cy5zbGljZSgwLCBpICsgMSkuam9pbignLycpKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIENvbXBpbGUgYSBzaW5nbGUgZ2l0aWdub3JlLXN0eWxlIHBhdHRlcm4gKHRoaXMgbW9kdWxlJ3MgZ3JhbW1hciBcdTIwMTQgc2VlIHRoZVxuICogbW9kdWxlIGRvYyBjb21tZW50KSBpbnRvIGEgcGF0aCBwcmVkaWNhdGUuIEEgcGF0dGVybiBtYXRjaGVzIGEgZmlsZSB3aGVuIGl0XG4gKiBtYXRjaGVzIHRoZSBmaWxlJ3MgcGF0aCBvciBhbnkgYW5jZXN0b3IgZGlyZWN0b3J5IG9mIGl0LCBzbyBhIGRpcmVjdG9yeVxuICogcGF0dGVybiBzdXBwcmVzc2VzIGV2ZXJ5dGhpbmcgYmVuZWF0aCBpdC5cbiAqXG4gKiBFeHBvcnRlZCBzbyBvdGhlciBwYXRoLXNjb3BlZCBpZ25vcmUtZmlsZSBjb252ZW50aW9ucyAoZS5nLiBgLmdhdGVpZ25vcmVgXG4gKiBpbiBgZ2F0ZS1pZ25vcmUudHNgKSBjYW4gcmV1c2UgdGhlIGV4YWN0IG1hdGNoaW5nIHNlbWFudGljcyByYXRoZXIgdGhhblxuICogcmVpbXBsZW1lbnRpbmcgdGhlbS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbXBpbGVQYXR0ZXJuKHBhdHRlcm46IHN0cmluZyk6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuIHtcbiAgbGV0IHBhdCA9IHBhdHRlcm47XG4gIGxldCBkaXJPbmx5ID0gZmFsc2U7XG4gIGlmIChwYXQuZW5kc1dpdGgoJy8nKSkge1xuICAgIGRpck9ubHkgPSB0cnVlO1xuICAgIHBhdCA9IHBhdC5zbGljZSgwLCAtMSk7XG4gIH1cbiAgbGV0IGFuY2hvcmVkID0gcGF0LmluY2x1ZGVzKCcvJyk7XG4gIGlmIChwYXQuc3RhcnRzV2l0aCgnLycpKSB7XG4gICAgYW5jaG9yZWQgPSB0cnVlO1xuICAgIHBhdCA9IHBhdC5zbGljZSgxKTtcbiAgfVxuICBjb25zdCByZSA9IGdsb2JUb1JlZ0V4cChwYXQpO1xuXG4gIHJldHVybiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4ge1xuICAgIGlmIChhbmNob3JlZCkge1xuICAgICAgY29uc3Qgc2VncyA9IGFuY2VzdG9yUGF0aHMocmVwb1JlbFBhdGgpO1xuICAgICAgLy8gRm9yIGEgZGlyLW9ubHkgcGF0dGVybiwgbmV2ZXIgdGVzdCB0aGUgbGVhZiBmaWxlIGl0c2VsZi5cbiAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBkaXJPbmx5ID8gc2Vncy5zbGljZSgwLCAtMSkgOiBzZWdzO1xuICAgICAgcmV0dXJuIGNhbmRpZGF0ZXMuc29tZSgocykgPT4gcmUudGVzdChzKSk7XG4gICAgfVxuICAgIC8vIFVuYW5jaG9yZWQ6IG1hdGNoIGFnYWluc3QgaW5kaXZpZHVhbCBwYXRoIGNvbXBvbmVudHMgYXQgYW55IGRlcHRoLlxuICAgIGNvbnN0IGNvbXBvbmVudHMgPSByZXBvUmVsUGF0aC5zcGxpdCgnLycpO1xuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBkaXJPbmx5ID8gY29tcG9uZW50cy5zbGljZSgwLCAtMSkgOiBjb21wb25lbnRzO1xuICAgIHJldHVybiBjYW5kaWRhdGVzLnNvbWUoKGMpID0+IHJlLnRlc3QoYykpO1xuICB9O1xufVxuXG4vKiogUGFyc2UgYC5ob29raWdub3JlYCB0ZXh0IGludG8gcnVsZXMsIHNraXBwaW5nIGNvbW1lbnRzIGFuZCBtYWxmb3JtZWQgbGluZXMuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VIb29rSWdub3JlKGNvbnRlbnQ6IHN0cmluZyk6IElnbm9yZVJ1bGVbXSB7XG4gIGNvbnN0IHJ1bGVzOiBJZ25vcmVSdWxlW10gPSBbXTtcbiAgZm9yIChjb25zdCByYXdMaW5lIG9mIGNvbnRlbnQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgbGluZSA9IHJhd0xpbmUudHJpbSgpO1xuICAgIGlmICghbGluZSB8fCBsaW5lLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgLy8gYDxwYXR0ZXJuPjx3aGl0ZXNwYWNlPjxwcmVmaXhlcz5gIFx1MjAxNCBwYXR0ZXJuIGlzIHRoZSBmaXJzdCB0b2tlbiwgcHJlZml4ZXNcbiAgICAvLyB0aGUgc2Vjb25kLiBBIGxpbmUgd2l0aG91dCBib3RoIGlzIG1hbGZvcm1lZCBhbmQgc2tpcHBlZC5cbiAgICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL14oXFxTKylcXHMrKFxcUyspJC8pO1xuICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFssIHBhdHRlcm4sIHByZWZpeGVzUmF3XSA9IG1hdGNoO1xuICAgIGNvbnN0IHByZWZpeGVzID0gcHJlZml4ZXNSYXdcbiAgICAgIC5zcGxpdCgnLCcpXG4gICAgICAubWFwKChwKSA9PiBwLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gICAgaWYgKHByZWZpeGVzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgcnVsZXMucHVzaCh7IHBhdHRlcm4sIHByZWZpeGVzLCBtYXRjaGVzOiBjb21waWxlUGF0dGVybihwYXR0ZXJuKSB9KTtcbiAgfVxuICByZXR1cm4gcnVsZXM7XG59XG5cbi8qKlxuICogTG9hZCB0aGUgc3VwcHJlc3Npb24gcnVsZXMgZm9yIGEgcmVwby4gRmFpbC1vcGVuOiBhbnkgcmVhZCBvciBwYXJzZSBmYWlsdXJlXG4gKiB5aWVsZHMgYW4gZW1wdHkgcnVsZSBzZXQsIHNvIHNwYW5zIHN1cmZhY2UgYXMgbm9ybWFsIHdoZW4gbm8gY29uZmlnIGV4aXN0cy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxvYWRIb29rSWdub3JlKHJlcG9Sb290OiBzdHJpbmcpOiBJZ25vcmVSdWxlW10ge1xuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMobm9kZVBhdGguam9pbihyZXBvUm9vdCwgSE9PS19JR05PUkVfUkVMKSwgJ3V0ZjgnKTtcbiAgICByZXR1cm4gcGFyc2VIb29rSWdub3JlKGNvbnRlbnQpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gW107XG4gIH1cbn1cblxuLyoqIEEgc2x1ZyBjYXJyaWVzIGEgcHJlZml4IHdoZW4gaXQgZXF1YWxzIHRoZSBwcmVmaXggb3IgaXMgYDxwcmVmaXg+L1x1MjAyNmAuICovXG5mdW5jdGlvbiBzbHVnSGFzUHJlZml4KHNsdWc6IHN0cmluZywgcHJlZml4OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHNsdWcgPT09IHByZWZpeCB8fCBzbHVnLnN0YXJ0c1dpdGgoYCR7cHJlZml4fS9gKTtcbn1cblxuLyoqXG4gKiBUcnVlIHdoZW4gYSBzcGFuIGBzbHVnYCBzaG91bGQgYmUgc3VwcHJlc3NlZCBmb3IgYW4gYW5jaG9yIGF0IGByZXBvUmVsUGF0aGA6XG4gKiBzb21lIHJ1bGUgbWF0Y2hlcyB0aGUgcGF0aCBhbmQgbGlzdHMgYSBwcmVmaXggdGhlIHNsdWcgY2Fycmllcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzU3BhblN1cHByZXNzZWQocnVsZXM6IElnbm9yZVJ1bGVbXSwgcmVwb1JlbFBhdGg6IHN0cmluZywgc2x1Zzogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3QgcnVsZSBvZiBydWxlcykge1xuICAgIGlmICghcnVsZS5tYXRjaGVzKHJlcG9SZWxQYXRoKSkgY29udGludWU7XG4gICAgaWYgKHJ1bGUucHJlZml4ZXMuc29tZSgocCkgPT4gc2x1Z0hhc1ByZWZpeChzbHVnLCBwKSkpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqIFNpZ25hdHVyZSBmb3IgaW5qZWN0aW5nIGEgcnVsZSBsb2FkZXIgKHByb2R1Y3Rpb24gZGVmYXVsdDoge0BsaW5rIGxvYWRIb29rSWdub3JlfSkuICovXG5leHBvcnQgdHlwZSBIb29rSWdub3JlTG9hZGVyID0gKHJlcG9Sb290OiBzdHJpbmcpID0+IElnbm9yZVJ1bGVbXTtcbiIsICIvKipcbiAqIENvZGV4IFByZVRvb2xVc2UgZ2F0ZSBob29rIFx1MjAxNCBob2xkIGBnaXQgY29tbWl0YC9gZ2l0IHB1c2hgIG9uIHJlYWwgc3BhbiBkZWJ0LlxuICpcbiAqIFRoZSBDb2RleCB0d2luIG9mIFtjbGF1ZGUvZ2F0ZS50c10oLi9wYWNrYWdlcy9hZ2VudC1ob29rcy9zcmMvY2xhdWRlL2dhdGUudHMpOlxuICogc2FtZSBzaGFyZWQgZ2F0ZS1jb3JlIHBpcGVsaW5lICh7QGxpbmsgcGFyc2VHaXRDb21tYW5kfSBcdTIxOTIge0BsaW5rIHJlc29sdmVDaGFuZ2VzZXR9XG4gKiBcdTIxOTIge0BsaW5rIGV2YWx1YXRlR2F0ZX0pLCB0cmFuc2xhdGVkIGludG8gQ29kZXgncyBQcmVUb29sVXNlIG91dHB1dCBzaGFwZS4gQ29kZXhcbiAqIGRlbGl2ZXJzIGEgc2hlbGwgY29tbWFuZCBhcyBhbiBTREstdHlwZWQgYHVua25vd25gIGB0b29sX2lucHV0YDsgdGhpcyBoYW5kbGVyXG4gKiBuYXJyb3dzIGl0IChzdHJpbmcsIG9yIGEgYFtcImJhc2hcIixcIi1sY1wiLFwiPHNjcmlwdD5cIl1gL2FyZ3YgYXJyYXkpIGludG8gdGhlXG4gKiBjb21tYW5kIHN0cmluZyB0aGUgY29yZSBwYXJzZXMuXG4gKlxuICogXHUyNTAwXHUyNTAwIFVuY29uZmlybWVkIGRlbnkgKHNlZSBub3Rlcy9jb2RleC1kZW55LXNwaWtlLm1kKSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcbiAqIFdoZXRoZXIgQ29kZXgncyBgcGVybWlzc2lvbkRlY2lzaW9uOiAnZGVueSdgIGFjdHVhbGx5ICpibG9ja3MqIHRoZSBzaGVsbCB0b29sXG4gKiBsaXZlIHdhcyBuZXZlciBjb25maXJtZWQgaW4gdGhpcyByZXBvOiB0aGUgUGhhc2UgMCBzcGlrZSBjb3VsZCBub3QgZ2V0IGFcbiAqIGZyb20tc2NyYXRjaCBwbHVnaW4gdG8gbG9hZCwgc28gdGhlIGRlbnkgcGF0aCB3YXMgbmV2ZXIgZXhlcmNpc2VkIGVuZC10by1lbmQuXG4gKiBUaGUgb25seSBwb3NpdGl2ZSBldmlkZW5jZSBpcyBkb2N1bWVudGFyeSBcdTIwMTQgdGhlIGBAZ29vZGZvb3QvY29kZXgtaG9va3NgIFJFQURNRVxuICogKHRoZSBleGFjdCB2ZXJzaW9uIHRoaXMgcmVwbyBkZXBlbmRzIG9uKSBzaGlwcyBhIHdvcmtlZCBgcGVybWlzc2lvbkRlY2lzaW9uOlxuICogJ2RlbnknYCBleGFtcGxlIG1hdGNoZWQgb24gYFwiQmFzaFwiYC4gVGhpcyBhZGFwdGVyIHRoZXJlZm9yZSBzaGlwcyB0aGUgaGFyZC1kZW55XG4gKiBwYXRoIHBlciB0aGF0IFJFQURNRSAoe0BsaW5rIENPREVYX0dBVEVfSEFSRF9ERU5ZfSA9IGB0cnVlYCksIGJ1dCBrZWVwcyB0aGVcbiAqIENBUkQubWQtZG9jdW1lbnRlZCBmYWxsYmFjayBcdTIwMTQgYSBsb3VkIGBhZGRpdGlvbmFsQ29udGV4dGAgd2FybmluZyB0aGF0IGFsbG93c1xuICogdGhlIGNvbW1hbmQsIHdpdGggdGhlIENJIHJlY2lwZSBhcyBDb2RleCdzIGVuZm9yY2VtZW50IGJhY2tzdG9wIFx1MjAxNCBhcyBhIGNsZWFybHlcbiAqIHNlcGFyYWJsZSBicmFuY2ggYmVoaW5kIHRoYXQgb25lIGNvbnN0YW50LiBJZiBhIGxpdmUgc2Vzc2lvbiBzaG93cyBkZW55IGRvZXNcbiAqIG5vdCBmaXJlLCBmbGlwIHtAbGluayBDT0RFWF9HQVRFX0hBUkRfREVOWX0gdG8gYGZhbHNlYDsgbm90aGluZyBlbHNlIGNoYW5nZXMuXG4gKlxuICogVGhlIHNoZWxsIHRvb2wncyBleGFjdCBgdG9vbF9uYW1lYCBpcyBsaWtld2lzZSB1bmNvbmZpcm1lZCAodGhlIFJFQURNRSdzXG4gKiBleGFtcGxlIHVzZXMgYFwiQmFzaFwiYDsgQ29kZXggQ0xJIHRyYW5zY3JpcHRzIGluIHRoZSBzcGlrZSBsYWJlbGVkIHRoZSBjYWxsXG4gKiBgZXhlY2ApLiBUaGUgcmVnaXN0cmF0aW9uIG1hdGNoZXIgaXMgYnJvYWRlbmVkIHRvIHRoZSBwbGF1c2libGUgbmFtZXMgc28gdGhlXG4gKiBob29rIGFjdHVhbGx5IGZpcmVzLCBhbmQgZXZlcnkgZmlyZSBsb2dzIHRoZSBvYnNlcnZlZCBgdG9vbF9uYW1lYCBzbyB0aGUgZmlyc3RcbiAqIGxpdmUgcnVuIHJldmVhbHMgdGhlIGxpdGVyYWwgc3RyaW5nIHRvIG5hcnJvdyB0aGUgbWF0Y2hlciB0by5cbiAqXG4gKiBGYWlsLW9wZW4gYXQgZXZlcnkgbGF5ZXI6IGdhdGUtY29yZSByZXNvbHZlcyBpbnRlcm5hbCBlcnJvcnMgdG8gYWxsb3csIGFuZCB0aGlzXG4gKiBhZGFwdGVyIHdyYXBzIHRoZSB3aG9sZSBwYXRoIGluIGEgdHJ5L2NhdGNoIHRoYXQgYWxsb3dzLWFuZC1sb2dzIFx1MjAxNCB0aGUgZ2F0ZVxuICogbXVzdCBuZXZlciBicmljayBhIGNvbW1pdC4gVGhlIHRpbWVvdXQgaXMgbWlsbGlzZWNvbmRzIGhlcmUgKHRoZSBDb2RleCBDTElcbiAqIGRpdmlkZXMgdG8gc2Vjb25kcyBhdCBlbWl0KS5cbiAqL1xuXG5pbXBvcnQgeyB0eXBlIEhvb2tDb250ZXh0LCB0eXBlIFByZVRvb2xVc2VJbnB1dCwgcHJlVG9vbFVzZUhvb2ssIHByZVRvb2xVc2VPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY29kZXgtaG9va3MnO1xuaW1wb3J0IHtcbiAgY29tbWFuZFNraXBzR2F0ZSxcbiAgY29tbWl0U3RhZ2VzQWxsLFxuICBjcmVhdGVEZWZhdWx0R2F0ZUV4ZWN1dG9ycyxcbiAgY3JlYXRlRGVmYXVsdEdpdEV4ZWN1dG9yLFxuICBjcmVhdGVEaXNrR2F0ZU1lbW9TdGF0ZSxcbiAgZXZhbHVhdGVHYXRlLFxuICB0eXBlIEdhdGVFeGVjdXRvcnMsXG4gIHR5cGUgR2F0ZU1lbW9TdGF0ZSxcbiAgdHlwZSBHaXRFeGVjdXRvcixcbiAgaXNHYXRlU2tpcHBlZCxcbiAgcGFyc2VHaXRDb21tYW5kLFxuICByZXNvbHZlQ2hhbmdlc2V0XG59IGZyb20gJy4uL2NvbW1vbi9nYXRlLWNvcmUuanMnO1xuXG4vKipcbiAqIFdoZXRoZXIgQ29kZXgncyBgcGVybWlzc2lvbkRlY2lzaW9uOiAnZGVueSdgIGlzIHRydXN0ZWQgdG8gYmxvY2sgdGhlIHNoZWxsIHRvb2xcbiAqIGxpdmUuIFNoaXBzIGB0cnVlYCAoaGFyZCBkZW55KSBwZXIgdGhlIGBAZ29vZGZvb3QvY29kZXgtaG9va3NgIFJFQURNRSdzIHdvcmtlZFxuICogZXhhbXBsZS4gRmxpcCB0byBgZmFsc2VgIHRvIGFjdGl2YXRlIHRoZSBDQVJELm1kLWRvY3VtZW50ZWQgZmFsbGJhY2sgaWYgYSBsaXZlXG4gKiBzZXNzaW9uIHNob3dzIGRlbnkgZG9lcyBub3QgZmlyZSBcdTIwMTQgc2VlIG5vdGVzL2NvZGV4LWRlbnktc3Bpa2UubWQgYW5kIHRoaXNcbiAqIGZpbGUncyBoZWFkZXIuIFRoaXMgaXMgdGhlIHNpbmdsZSBzd2l0Y2ggdGhhdCBzZXBhcmF0ZXMgdGhlIHR3byBjb2RlIHBhdGhzLlxuICovXG5jb25zdCBDT0RFWF9HQVRFX0hBUkRfREVOWSA9IHRydWU7XG5cbi8qKiBUaGUgYHN5c3RlbU1lc3NhZ2VgIHNob3duIHdoZW4gYSBnYXRlZCBjb21tYW5kIHJ1bnMgdW5kZXIgYEdJVF9TUEFOX0dBVEU9c2tpcGAuICovXG5jb25zdCBTS0lQX05PVElDRSA9ICdnaXQtc3BhbiBnYXRlIGJ5cGFzc2VkIChHSVRfU1BBTl9HQVRFPXNraXApIFx1MjAxNCBzcGFuIGRlYnQgaXMgbm90IGJlaW5nIGNoZWNrZWQgZm9yIHRoaXMgY29tbWFuZC4nO1xuXG4vKipcbiAqIE5hcnJvdyBDb2RleCdzIGB1bmtub3duYCBzaGVsbCBgdG9vbF9pbnB1dGAgaW50byB0aGUgY29tbWFuZCBzdHJpbmcgdGhlIGNvcmVcbiAqIHBhcnNlcy4gSGFuZGxlcyBhIGJhcmUgYGNvbW1hbmRgIHN0cmluZywgYSBzaGVsbC13cmFwcGVyIGFyZ3ZcbiAqIChgW1wiYmFzaFwiLFwiLWxjXCIsXCI8c2NyaXB0PlwiXWAgXHUyMTkyIHRoZSBzY3JpcHQgYWZ0ZXIgYC1jYC9gLWxjYCksIGFuZCBhIGRpcmVjdCBhcmd2XG4gKiAoYFtcImdpdFwiLFwiY29tbWl0XCIsXHUyMDI2XWAgXHUyMTkyIHNwYWNlLWpvaW5lZCkuIFJldHVybnMgYG51bGxgIHdoZW4gbm8gY29tbWFuZCB0ZXh0IGlzXG4gKiByZWNvdmVyYWJsZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RTaGVsbENvbW1hbmQodG9vbElucHV0OiB1bmtub3duKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICh0b29sSW5wdXQgPT09IG51bGwgfHwgdHlwZW9mIHRvb2xJbnB1dCAhPT0gJ29iamVjdCcgfHwgISgnY29tbWFuZCcgaW4gdG9vbElucHV0KSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGNvbW1hbmQgPSAodG9vbElucHV0IGFzIHsgY29tbWFuZDogdW5rbm93biB9KS5jb21tYW5kO1xuICBpZiAodHlwZW9mIGNvbW1hbmQgPT09ICdzdHJpbmcnKSByZXR1cm4gY29tbWFuZC5sZW5ndGggPiAwID8gY29tbWFuZCA6IG51bGw7XG4gIGlmIChBcnJheS5pc0FycmF5KGNvbW1hbmQpKSB7XG4gICAgY29uc3QgcGFydHMgPSBjb21tYW5kLmZpbHRlcigocCk6IHAgaXMgc3RyaW5nID0+IHR5cGVvZiBwID09PSAnc3RyaW5nJyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgZmxhZ0lkeCA9IHBhcnRzLmZpbmRJbmRleCgocCkgPT4gcCA9PT0gJy1jJyB8fCBwID09PSAnLWxjJyB8fCBwID09PSAnLWljJyk7XG4gICAgaWYgKGZsYWdJZHggPj0gMCAmJiBwYXJ0c1tmbGFnSWR4ICsgMV0gIT09IHVuZGVmaW5lZCkgcmV0dXJuIHBhcnRzW2ZsYWdJZHggKyAxXTtcbiAgICByZXR1cm4gcGFydHMuam9pbignICcpO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlSGFuZGxlcihcbiAgZ2l0OiBHaXRFeGVjdXRvciA9IGNyZWF0ZURlZmF1bHRHaXRFeGVjdXRvcigpLFxuICBleGVjdXRvcnM6IEdhdGVFeGVjdXRvcnMgPSBjcmVhdGVEZWZhdWx0R2F0ZUV4ZWN1dG9ycygpLFxuICBtZW1vRmFjdG9yeTogKGN3ZDogc3RyaW5nKSA9PiBHYXRlTWVtb1N0YXRlID0gY3JlYXRlRGlza0dhdGVNZW1vU3RhdGUsXG4gIGVudjogTm9kZUpTLlByb2Nlc3NFbnYgPSBwcm9jZXNzLmVudixcbiAgLy8gVGhlIGhhcmQtZGVueSBzd2l0Y2ggaXMgYSBwYXJhbWV0ZXIgKGRlZmF1bHRpbmcgdG8gdGhlIHNoaXBwZWQgY29uc3RhbnQpIHNvXG4gIC8vIHRoZSBkb2N1bWVudGVkIGZhbGxiYWNrIGJyYW5jaCBpcyBkaXJlY3RseSBleGVyY2lzYWJsZSBpbiB0ZXN0cyB3aXRob3V0XG4gIC8vIG11dGF0aW5nIGEgbW9kdWxlLWxldmVsIGNvbnN0LiBQcm9kdWN0aW9uIHdpcmluZyBuZXZlciBwYXNzZXMgdGhpcyBcdTIwMTQgdGhlXG4gIC8vIGRlZmF1bHQgZXhwb3J0IGJlbG93IGNvbnN0cnVjdHMgdGhlIGhhbmRsZXIgd2l0aCB0aGUgY29uc3RhbnQncyB2YWx1ZS5cbiAgaGFyZERlbnk6IGJvb2xlYW4gPSBDT0RFWF9HQVRFX0hBUkRfREVOWVxuKSB7XG4gIHJldHVybiBhc3luYyAoaW5wdXQ6IFByZVRvb2xVc2VJbnB1dCwgY3R4OiBIb29rQ29udGV4dCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICAvLyBMb2cgdGhlIG9ic2VydmVkIHNoZWxsIHRvb2xfbmFtZSBzbyB0aGUgZmlyc3QgbGl2ZSBydW4gcmV2ZWFscyB0aGUgbGl0ZXJhbFxuICAgICAgLy8gc3RyaW5nIHRvIG5hcnJvdyB0aGUgbWF0Y2hlciB0byAodGhlIHNwaWtlIG5ldmVyIGNvbmZpcm1lZCBpdCBlbXBpcmljYWxseSkuXG4gICAgICBjdHgubG9nZ2VyLmluZm8oJ2dpdC1zcGFuIGdhdGUgb2JzZXJ2ZWQgc2hlbGwgdG9vbCcsIHsgdG9vbF9uYW1lOiBpbnB1dC50b29sX25hbWUgfSk7XG5cbiAgICAgIGNvbnN0IGNvbW1hbmQgPSBleHRyYWN0U2hlbGxDb21tYW5kKGlucHV0LnRvb2xfaW5wdXQpO1xuICAgICAgaWYgKGNvbW1hbmQgPT09IG51bGwpIHJldHVybiBwcmVUb29sVXNlT3V0cHV0KHt9KTtcblxuICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VHaXRDb21tYW5kKGNvbW1hbmQpO1xuICAgICAgaWYgKHBhcnNlZC5raW5kID09PSAnbm9uZScpIHJldHVybiBwcmVUb29sVXNlT3V0cHV0KHt9KTtcblxuICAgICAgLy8gQm90aCBlc2NhcGUtaGF0Y2ggZm9ybXMgYnlwYXNzLCBrZXB0IHRyYW5zY3JpcHQtdmlzaWJsZTogdGhlIHNlc3Npb24tZW52XG4gICAgICAvLyBmb3JtIGFuZCB0aGUgZG9jdW1lbnRlZCBpbmxpbmUtcHJlZml4IGZvcm0gKGBHSVRfU1BBTl9HQVRFPXNraXAgZ2l0XG4gICAgICAvLyBjb21taXQgXHUyMDI2YCksIHdoaWNoIG5ldmVyIHJlYWNoZXMgdGhlIGhvb2sncyBvd24gZW52IGFuZCBpcyByZWFkIGZyb20gdGhlXG4gICAgICAvLyBjb21tYW5kIHRleHQgdmlhIGBjb21tYW5kU2tpcHNHYXRlYC5cbiAgICAgIGlmIChpc0dhdGVTa2lwcGVkKGVudikgfHwgY29tbWFuZFNraXBzR2F0ZShjb21tYW5kKSkge1xuICAgICAgICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7IHN5c3RlbU1lc3NhZ2U6IFNLSVBfTk9USUNFIH0pO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBjd2QgPSBpbnB1dC5jd2QgPz8gJyc7XG4gICAgICBjb25zdCBhbGwgPSBwYXJzZWQua2luZCA9PT0gJ2NvbW1pdCcgPyBjb21taXRTdGFnZXNBbGwoY29tbWFuZCkgOiBmYWxzZTtcbiAgICAgIGNvbnN0IGNoYW5nZXNldCA9IGF3YWl0IHJlc29sdmVDaGFuZ2VzZXQocGFyc2VkLmtpbmQsIGFsbCwgY3dkLCBnaXQsIHBhcnNlZC5wYXRocyk7XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGV2YWx1YXRlR2F0ZShjaGFuZ2VzZXQsIGN3ZCwgZXhlY3V0b3JzLCBtZW1vRmFjdG9yeShjd2QpKTtcbiAgICAgIGlmIChyZXN1bHQuZGVjaXNpb24gIT09ICdkZW55Jykge1xuICAgICAgICAvLyBFbnZpcm9ubWVudGFsIHN0YWxlbmVzcyBhbGxvd3MgKGZhaWwtb3BlbikgYnV0IG11c3Qgbm90IGJlIHN3YWxsb3dlZDpcbiAgICAgICAgLy8gbG9nIGl0IGFuZCBzdXJmYWNlIHRoZSBjb25kaXRpb24gYXMgYWRkaXRpb25hbCBjb250ZXh0LlxuICAgICAgICBpZiAocmVzdWx0LmtpbmQgPT09ICdlbnZpcm9ubWVudGFsJykge1xuICAgICAgICAgIGN0eC5sb2dnZXIud2FybignZ2l0LXNwYW4gZ2F0ZSBhbGxvd2VkIHdpdGggdW5yZXNvbHZhYmxlIGFuY2hvcnMnLCB7IHJlYXNvbjogcmVzdWx0LnJlYXNvbiB9KTtcbiAgICAgICAgICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQucmVhc29uLCBzeXN0ZW1NZXNzYWdlOiByZXN1bHQucmVhc29uIH0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBwcmVUb29sVXNlT3V0cHV0KHt9KTtcbiAgICAgIH1cblxuICAgICAgaWYgKGhhcmREZW55KSB7XG4gICAgICAgIC8vIFByaW1hcnkgcGF0aCAocGVyIHRoZSBSRUFETUUpOiBhY3R1YWxseSBibG9jayB0aGUgY29tbWFuZC5cbiAgICAgICAgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoe1xuICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvbjogJ2RlbnknLFxuICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvblJlYXNvbjogcmVzdWx0LnJlYXNvbixcbiAgICAgICAgICBzeXN0ZW1NZXNzYWdlOiByZXN1bHQucmVhc29uXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgLy8gRmFsbGJhY2sgcGF0aCAoQ0FSRC5tZCBjb250aW5nZW5jeSk6IGNhbm5vdCBibG9jaywgc28gc3VyZmFjZSB0aGUgc2FtZVxuICAgICAgLy8gY2hlY2tsaXN0IGFzIGEgbG91ZCB3YXJuaW5nIGFuZCBhbGxvdyBcdTIwMTQgdGhlIENJIHJlY2lwZSBlbmZvcmNlcyBmb3IgQ29kZXguXG4gICAgICBjb25zdCB3YXJuaW5nID0gYGdpdC1zcGFuIGdhdGUgY291bGQgbm90IGJsb2NrIHRoaXMgY29tbWFuZDsgc3BhbiBkZWJ0IHJlbWFpbnM6XFxuJHtyZXN1bHQucmVhc29ufWA7XG4gICAgICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiB3YXJuaW5nLCBzeXN0ZW1NZXNzYWdlOiB3YXJuaW5nIH0pO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY3R4LmxvZ2dlci53YXJuKCdnaXQtc3BhbiBnYXRlIGZhaWxlZCBvcGVuIG9uIGFuIHVuY2F1Z2h0IGVycm9yJywgeyBlcnIgfSk7XG4gICAgICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7fSk7XG4gICAgfVxuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBwcmVUb29sVXNlSG9vayh7IG1hdGNoZXI6ICdCYXNofHNoZWxsfGV4ZWN8bG9jYWxfc2hlbGwnLCB0aW1lb3V0OiAxMF8wMDAgfSwgY3JlYXRlSGFuZGxlcigpKTtcbiIsICJpbXBvcnQgaG9vayBmcm9tIFwiLi9nYXRlLnRzXCI7XG5pbXBvcnQgeyBleGVjdXRlIH0gZnJvbSBcIi4uLy4uLy4uLy4uL25vZGVfbW9kdWxlcy9AZ29vZGZvb3QvY29kZXgtaG9va3MvZGlzdC9ydW50aW1lLmpzXCI7XG5leGVjdXRlKGhvb2spO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQTRCTyxJQUFNLDBCQUEwQixvQkFBSSxJQUFJLENBQUMsZ0JBQWdCLG9CQUFvQixlQUFlLENBQUM7OztBQzVCcEcsU0FBUyxlQUFlLGVBQWUsUUFBUSxTQUFTO0FBQ3BELFFBQU0sT0FBTztBQUNiLE9BQUssZ0JBQWdCO0FBQ3JCLE9BQUssVUFBVSxPQUFPO0FBQ3RCLE9BQUssZ0JBQWdCLE9BQU87QUFDNUIsTUFBSSxhQUFhLFVBQVUsT0FBTyxPQUFPLFlBQVksVUFBVTtBQUMzRCxTQUFLLFVBQVUsT0FBTztBQUFBLEVBQzFCO0FBQ0EsU0FBTztBQUNYO0FBQ08sU0FBUyxlQUFlLFFBQVEsU0FBUztBQUM1QyxTQUFPLGVBQWUsY0FBYyxRQUFRLE9BQU87QUFDdkQ7OztBQ1pBLFNBQVMsV0FBVyxZQUFZLFdBQVcsVUFBVSxpQkFBaUI7QUFDdEUsU0FBUyxlQUFlO0FBQ3hCLElBQU0sc0JBQXNCO0FBQ3JCLElBQU0sU0FBTixNQUFhO0FBQUEsRUFDaEIsV0FBVyxvQkFBSSxJQUFJO0FBQUEsRUFDbkIsa0JBQWtCO0FBQUEsRUFDbEIsWUFBWTtBQUFBLEVBQ1osY0FBYztBQUFBLEVBQ2Q7QUFBQSxFQUNBO0FBQUEsRUFDQSxZQUFZLFNBQVMsQ0FBQyxHQUFHO0FBQ3JCLFNBQUssY0FBYyxPQUFPLGVBQWUsUUFBUSxJQUFJLE9BQU8sYUFBYSxtQkFBbUIsS0FBSztBQUFBLEVBQ3JH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QkFBZ0IsT0FBTztBQUN0QyxVQUFJLE9BQU8sU0FBUyxPQUFRLFFBQU8saUJBQWlCLENBQUMsQ0FBQztBQU10RCxVQUFJLGNBQWMsR0FBRyxLQUFLLGlCQUFpQixPQUFPLEdBQUc7QUFDbkQsZUFBTyxpQkFBaUIsRUFBRSxlQUFlLFlBQVksQ0FBQztBQUFBLE1BQ3hEO0FBRUEsWUFBTSxNQUFNLE1BQU0sT0FBTztBQUN6QixZQUFNLE1BQU0sT0FBTyxTQUFTLFdBQVcsZ0JBQWdCLE9BQU8sSUFBSTtBQUNsRSxZQUFNLFlBQVksTUFBTSxpQkFBaUIsT0FBTyxNQUFNLEtBQUssS0FBSyxLQUFLLE9BQU8sS0FBSztBQUVqRixZQUFNLFNBQVMsTUFBTSxhQUFhLFdBQVcsS0FBSyxXQUFXLFlBQVksR0FBRyxDQUFDO0FBQzdFLFVBQUksT0FBTyxhQUFhLFFBQVE7QUFHOUIsWUFBSSxPQUFPLFNBQVMsaUJBQWlCO0FBQ25DLGNBQUksT0FBTyxLQUFLLG1EQUFtRCxFQUFFLFFBQVEsT0FBTyxPQUFPLENBQUM7QUFDNUYsaUJBQU8saUJBQWlCLEVBQUUsbUJBQW1CLE9BQU8sUUFBUSxlQUFlLE9BQU8sT0FBTyxDQUFDO0FBQUEsUUFDNUY7QUFDQSxlQUFPLGlCQUFpQixDQUFDLENBQUM7QUFBQSxNQUM1QjtBQUVBLFVBQUksVUFBVTtBQUVaLGVBQU8saUJBQWlCO0FBQUEsVUFDdEIsb0JBQW9CO0FBQUEsVUFDcEIsMEJBQTBCLE9BQU87QUFBQSxVQUNqQyxlQUFlLE9BQU87QUFBQSxRQUN4QixDQUFDO0FBQUEsTUFDSDtBQUdBLFlBQU0sVUFBVTtBQUFBLEVBQW1FLE9BQU8sTUFBTTtBQUNoRyxhQUFPLGlCQUFpQixFQUFFLG1CQUFtQixTQUFTLGVBQWUsUUFBUSxDQUFDO0FBQUEsSUFDaEYsU0FBUyxLQUFLO0FBQ1osVUFBSSxPQUFPLEtBQUssa0RBQWtELEVBQUUsSUFBSSxDQUFDO0FBQ3pFLGFBQU8saUJBQWlCLENBQUMsQ0FBQztBQUFBLElBQzVCO0FBQUEsRUFDRjtBQUNGO0FBRUEsSUFBTyxlQUFRLGVBQWUsRUFBRSxTQUFTLCtCQUErQixTQUFTLElBQU8sR0FBRyxjQUFjLENBQUM7OztBQ25KMUcsUUFBUSxZQUFJOyIsCiAgIm5hbWVzIjogWyJyZXNvbHZlIiwgImV4ZWNGaWxlU3luYyIsICJmcyIsICJub2RlUGF0aCIsICJmcyIsICJub2RlUGF0aCIsICJmcyIsICJub2RlUGF0aCIsICJjYW5kaWRhdGVzIiwgImV4ZWNGaWxlU3luYyJdCn0K

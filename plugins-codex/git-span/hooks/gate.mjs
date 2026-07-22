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
    let semanticAlreadyPresented = false;
    if (semantic.length > 0) {
      const semanticDigest = gateStateDigest(semantic, []);
      if (!memoState.has(semanticDigest)) {
        if (!memoState.record(semanticDigest)) return { decision: "allow", kind: "silent" };
        return {
          decision: "deny",
          kind: "semantic-staleness",
          findings: semantic,
          reason: renderStalenessReason(semantic)
        };
      }
      semanticAlreadyPresented = true;
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
    if (uncovered.length === 0) {
      return semanticAlreadyPresented ? { decision: "allow", kind: "already-presented" } : { decision: "allow", kind: "silent" };
    }
    const digest = gateStateDigest([], uncovered);
    if (memoState.has(digest)) return { decision: "allow", kind: "already-presented" };
    if (!memoState.record(digest)) return { decision: "allow", kind: "silent" };
    return { decision: "deny", kind: "uncovered-writes", uncovered, reason: renderUncoveredReason(uncovered) };
  } catch (err) {
    if (err instanceof GateScanError) {
      return { decision: "allow", kind: "scan-failed", reason: renderScanFailedReason(err.detail) };
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
function renderStalenessReason(findings) {
  const lines = findings.map((row) => `  - ${row.name} (${row.status}): ${anchorText(row)}`);
  return [
    "This changeset carries span debt \u2014 resolve it before this lands:",
    ...lines,
    "",
    "Update each span's anchors/why in this same change, or tell the user why the described coupling no longer holds, then retry."
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
    "git-span could not complete its staleness scan for this changeset, so its span debt was NOT verified:",
    `  ${detail}`,
    "",
    "The command is proceeding anyway. This is a hard scan failure (e.g. an unreadable anchor file that aborts the whole scoped query), not a clean result \u2014 resolve the underlying read/scan error if this coupling needs verifying."
  ].join("\n");
}
function renderUncoveredReason(uncovered) {
  const lines = uncovered.map((path) => `  - ${path}`);
  return [
    "Determine if you should document implicit semantic dependencies in these files:",
    ...lines,
    "",
    'Use `git span add <name> <path/to/anchor#Lstart-Lend>` then `git span why <name> -m "one sentence: name the subsystem, what it does across anchors"`, or just retry the command to proceed (this is a one-time check).'
  ].join("\n");
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
function createHandler(git = createDefaultGitExecutor(), executors = createDefaultGateExecutors(), memoFactory = createDiskGateMemoState, hardDeny = CODEX_GATE_HARD_DENY) {
  return async (input, ctx) => {
    try {
      ctx.logger.info("git-span gate observed shell tool", { tool_name: input.tool_name });
      const command = extractShellCommand(input.tool_input);
      if (command === null) return preToolUseOutput({});
      const parsed = parseGitCommand(command);
      if (parsed.kind === "none") return preToolUseOutput({});
      const cwd = input.cwd ?? "";
      const all = parsed.kind === "commit" ? commitStagesAll(command) : false;
      const changeset = await resolveChangeset(parsed.kind, all, cwd, git, parsed.paths);
      const result = await evaluateGate(changeset, cwd, executors, memoFactory(cwd));
      if (result.decision !== "deny") {
        if (result.kind === "environmental" || result.kind === "scan-failed") {
          ctx.logger.warn("git-span gate allowed with an unresolved condition", { reason: result.reason });
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2NvbnN0YW50cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2dhdGUtY29yZS50cyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL2dhdGUtaWdub3JlLnRzIiwgInNyYy9jb21tb24vc3Bhbi1pZ25vcmUudHMiLCAic3JjL2NvZGV4L2dhdGUudHMiLCAic3JjL2NvZGV4L2dhdGUtZW50cnkudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImV4cG9ydCBjb25zdCBQQUNLQUdFX05BTUUgPSBcIkBnb29kZm9vdC9jb2RleC1ob29rc1wiO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfVElNRU9VVF9NUyA9IDYwMF8wMDA7XG5leHBvcnQgY29uc3QgREVGQVVMVF9TVEFUVVNfTUVTU0FHRSA9IHVuZGVmaW5lZDtcbmV4cG9ydCBjb25zdCBERUZBVUxUX0VTQlVJTERfTE9BREVSUyA9IHtcbiAgICBcIi5tZFwiOiBcInRleHRcIixcbn07XG5leHBvcnQgY29uc3QgSE9PS19GQUNUT1JZX1RPX0VWRU5UID0ge1xuICAgIHByZVRvb2xVc2VIb29rOiBcIlByZVRvb2xVc2VcIixcbiAgICBwb3N0VG9vbFVzZUhvb2s6IFwiUG9zdFRvb2xVc2VcIixcbiAgICBwZXJtaXNzaW9uUmVxdWVzdEhvb2s6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICB1c2VyUHJvbXB0U3VibWl0SG9vazogXCJVc2VyUHJvbXB0U3VibWl0XCIsXG4gICAgc2Vzc2lvblN0YXJ0SG9vazogXCJTZXNzaW9uU3RhcnRcIixcbiAgICBzdWJhZ2VudFN0YXJ0SG9vazogXCJTdWJhZ2VudFN0YXJ0XCIsXG4gICAgc3RvcEhvb2s6IFwiU3RvcFwiLFxuICAgIHN1YmFnZW50U3RvcEhvb2s6IFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgcHJlQ29tcGFjdEhvb2s6IFwiUHJlQ29tcGFjdFwiLFxuICAgIHBvc3RDb21wYWN0SG9vazogXCJQb3N0Q29tcGFjdFwiLFxufTtcbmV4cG9ydCBjb25zdCBFVkVOVFNfV0lUSF9NQVRDSEVSID0gbmV3IFNldChbXG4gICAgXCJQcmVUb29sVXNlXCIsXG4gICAgXCJQb3N0VG9vbFVzZVwiLFxuICAgIFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICBcIlNlc3Npb25TdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgXCJQcmVDb21wYWN0XCIsXG4gICAgXCJQb3N0Q29tcGFjdFwiLFxuXSk7XG5leHBvcnQgY29uc3QgRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQgPSBuZXcgU2V0KFtcIlNlc3Npb25TdGFydFwiLCBcIlVzZXJQcm9tcHRTdWJtaXRcIiwgXCJTdWJhZ2VudFN0YXJ0XCJdKTtcbiIsICJmdW5jdGlvbiBhdHRhY2hNZXRhZGF0YShob29rRXZlbnROYW1lLCBjb25maWcsIGhhbmRsZXIpIHtcbiAgICBjb25zdCBob29rID0gaGFuZGxlcjtcbiAgICBob29rLmhvb2tFdmVudE5hbWUgPSBob29rRXZlbnROYW1lO1xuICAgIGhvb2sudGltZW91dCA9IGNvbmZpZy50aW1lb3V0O1xuICAgIGhvb2suc3RhdHVzTWVzc2FnZSA9IGNvbmZpZy5zdGF0dXNNZXNzYWdlO1xuICAgIGlmIChcIm1hdGNoZXJcIiBpbiBjb25maWcgJiYgdHlwZW9mIGNvbmZpZy5tYXRjaGVyID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGhvb2subWF0Y2hlciA9IGNvbmZpZy5tYXRjaGVyO1xuICAgIH1cbiAgICByZXR1cm4gaG9vaztcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQcmVUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBvc3RUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcGVybWlzc2lvblJlcXVlc3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gdXNlclByb21wdFN1Ym1pdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiVXNlclByb21wdFN1Ym1pdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25TdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU2Vzc2lvblN0YXJ0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3ViYWdlbnRTdGFydFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN0b3BcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN1YmFnZW50U3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlByZUNvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUG9zdENvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbiIsICJpbXBvcnQgeyBjbG9zZVN5bmMsIGV4aXN0c1N5bmMsIG1rZGlyU3luYywgb3BlblN5bmMsIHdyaXRlU3luYyB9IGZyb20gXCJub2RlOmZzXCI7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuY29uc3QgREVGQVVMVF9MT0dfRU5WX1ZBUiA9IFwiQ09ERVhfSE9PS1NfTE9HX0ZJTEVcIjtcbmV4cG9ydCBjbGFzcyBMb2dnZXIge1xuICAgIGhhbmRsZXJzID0gbmV3IE1hcCgpO1xuICAgIGZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIGxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgbG9nRmlsZVBhdGggPSBudWxsO1xuICAgIGN1cnJlbnRIb29rVHlwZTtcbiAgICBjdXJyZW50SW5wdXQ7XG4gICAgY29uc3RydWN0b3IoY29uZmlnID0ge30pIHtcbiAgICAgICAgdGhpcy5sb2dGaWxlUGF0aCA9IGNvbmZpZy5sb2dGaWxlUGF0aCA/PyBwcm9jZXNzLmVudltjb25maWcubG9nRW52VmFyID8/IERFRkFVTFRfTE9HX0VOVl9WQVJdID8/IG51bGw7XG4gICAgfVxuICAgIHNldENvbnRleHQoaG9va1R5cGUsIGlucHV0KSB7XG4gICAgICAgIHRoaXMuY3VycmVudEhvb2tUeXBlID0gaG9va1R5cGU7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gaW5wdXQ7XG4gICAgfVxuICAgIGNsZWFyQ29udGV4dCgpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50SG9va1R5cGUgPSB1bmRlZmluZWQ7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBvbihsZXZlbCwgaGFuZGxlcikge1xuICAgICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKSA/PyBuZXcgU2V0KCk7XG4gICAgICAgIGV4aXN0aW5nLmFkZChoYW5kbGVyKTtcbiAgICAgICAgdGhpcy5oYW5kbGVycy5zZXQobGV2ZWwsIGV4aXN0aW5nKTtcbiAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgIGV4aXN0aW5nLmRlbGV0ZShoYW5kbGVyKTtcbiAgICAgICAgICAgIGlmIChleGlzdGluZy5zaXplID09PSAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5oYW5kbGVycy5kZWxldGUobGV2ZWwpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgIH1cbiAgICBkZWJ1ZyhtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImRlYnVnXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICBpbmZvKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiaW5mb1wiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgd2FybihtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcIndhcm5cIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGVycm9yKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZXJyb3JcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGxvZ0Vycm9yKGVycm9yLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImVycm9yXCIsIGAke21lc3NhZ2V9OiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLCBjb250ZXh0KTtcbiAgICB9XG4gICAgY2xvc2UoKSB7XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgY2xvc2VTeW5jKHRoaXMubG9nRmlsZUZkKTtcbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cbiAgICBlbWl0KGxldmVsLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0ge1xuICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICBsZXZlbCxcbiAgICAgICAgICAgIGhvb2tUeXBlOiB0aGlzLmN1cnJlbnRIb29rVHlwZSxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICAuLi4odGhpcy5jdXJyZW50SW5wdXQgIT09IHVuZGVmaW5lZCA/IHsgaW5wdXQ6IHRoaXMuY3VycmVudElucHV0IH0gOiB7fSksXG4gICAgICAgICAgICAuLi4oY29udGV4dCAhPT0gdW5kZWZpbmVkID8geyBjb250ZXh0IH0gOiB7fSksXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMud3JpdGVUb0ZpbGUoZXZlbnQpO1xuICAgICAgICB0aGlzLmhhbmRsZXJzLmdldChsZXZlbCk/LmZvckVhY2goKGhhbmRsZXIpID0+IHtcbiAgICAgICAgICAgIGhhbmRsZXIoZXZlbnQpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgd3JpdGVUb0ZpbGUoZXZlbnQpIHtcbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZVBhdGggPT09IG51bGwpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXRoaXMuZmlsZUluaXRpYWxpemVkKSB7XG4gICAgICAgICAgICB0aGlzLmZpbGVJbml0aWFsaXplZCA9IHRydWU7XG4gICAgICAgICAgICBjb25zdCBsb2dEaXIgPSBkaXJuYW1lKHRoaXMubG9nRmlsZVBhdGgpO1xuICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKGxvZ0RpcikpIHtcbiAgICAgICAgICAgICAgICBta2RpclN5bmMobG9nRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gb3BlblN5bmModGhpcy5sb2dGaWxlUGF0aCwgXCJhXCIpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgd3JpdGVTeW5jKHRoaXMubG9nRmlsZUZkLCBgJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuYCk7XG4gICAgICAgIH1cbiAgICB9XG59XG5leHBvcnQgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcigpO1xuIiwgImV4cG9ydCBjb25zdCBFWElUX0NPREVTID0ge1xuICAgIFNVQ0NFU1M6IDAsXG4gICAgRVJST1I6IDEsXG4gICAgQkxPQ0s6IDIsXG59O1xuZXhwb3J0IGNsYXNzIEJsb2NrRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gICAgcmVhc29uO1xuICAgIGNvbnN0cnVjdG9yKHJlYXNvbikge1xuICAgICAgICBzdXBlcihyZWFzb24pO1xuICAgICAgICB0aGlzLm5hbWUgPSBcIkJsb2NrRXJyb3JcIjtcbiAgICAgICAgdGhpcy5yZWFzb24gPSByZWFzb247XG4gICAgfVxufVxuZnVuY3Rpb24gb21pdFVuZGVmaW5lZCh2YWx1ZSkge1xuICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModmFsdWUpLmZpbHRlcigoWywgZW50cnldKSA9PiBlbnRyeSAhPT0gdW5kZWZpbmVkKSk7XG59XG5mdW5jdGlvbiBidWlsZE91dHB1dCh0eXBlLCBzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiB7XG4gICAgICAgIF90eXBlOiB0eXBlLFxuICAgICAgICBzdGRvdXQ6IG9taXRVbmRlZmluZWQoc3Rkb3V0KSxcbiAgICAgICAgLi4uKHN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRlcnIgfSA6IHt9KSxcbiAgICB9O1xufVxuZXhwb3J0IGZ1bmN0aW9uIHJhd091dHB1dChzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlJhd1wiLCBzdGRvdXQsIHN0ZGVycik7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvbiAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy51cGRhdGVkSW5wdXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBoYXNTcGVjaWZpY1xuICAgICAgICA/IG9taXRVbmRlZmluZWQoe1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQcmVUb29sVXNlXCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvbjogb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb24sXG4gICAgICAgICAgICBwZXJtaXNzaW9uRGVjaXNpb25SZWFzb246IG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uLFxuICAgICAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgfSlcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlVG9vbFVzZVwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZUxlZ2FjeUJsb2NrT3V0cHV0KG9wdGlvbnMpIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVUb29sVXNlXCIsIHtcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fCBvcHRpb25zLnVwZGF0ZWRNQ1BUb29sT3V0cHV0ICE9PSB1bmRlZmluZWQ7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gaGFzU3BlY2lmaWNcbiAgICAgICAgPyBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUG9zdFRvb2xVc2VcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICAgICAgdXBkYXRlZE1DUFRvb2xPdXRwdXQ6IG9wdGlvbnMudXBkYXRlZE1DUFRvb2xPdXRwdXQsXG4gICAgICAgIH0pXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBvc3RUb29sVXNlXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uUmVxdWVzdE91dHB1dChvcHRpb25zKSB7XG4gICAgY29uc3QgZGVjaXNpb24gPSBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgYmVoYXZpb3I6IG9wdGlvbnMuYmVoYXZpb3IsXG4gICAgICAgIG1lc3NhZ2U6IG9wdGlvbnMubWVzc2FnZSxcbiAgICAgICAgaW50ZXJydXB0OiBvcHRpb25zLmludGVycnVwdCxcbiAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgdXBkYXRlZFBlcm1pc3Npb25zOiBvcHRpb25zLnVwZGF0ZWRQZXJtaXNzaW9ucyxcbiAgICB9KTtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSB7XG4gICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICAgICAgZGVjaXNpb24sXG4gICAgfTtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQZXJtaXNzaW9uUmVxdWVzdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiVXNlclByb21wdFN1Ym1pdFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiVXNlclByb21wdFN1Ym1pdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiU2Vzc2lvblN0YXJ0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTZXNzaW9uU3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlN1YmFnZW50U3RhcnRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3RvcE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTdG9wXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdG9wT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RvcFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlQ29tcGFjdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdENvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUG9zdENvbXBhY3RcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgIH0pO1xufVxuIiwgImltcG9ydCB7IEVWRU5UU19XSVRIX1RFWFRfT1VUUFVUIH0gZnJvbSBcIi4vY29uc3RhbnRzLmpzXCI7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tIFwiLi9sb2dnZXIuanNcIjtcbmltcG9ydCB7IEJsb2NrRXJyb3IsIEVYSVRfQ09ERVMsIHNlc3Npb25TdGFydE91dHB1dCwgc3ViYWdlbnRTdGFydE91dHB1dCwgdXNlclByb21wdFN1Ym1pdE91dHB1dCwgfSBmcm9tIFwiLi9vdXRwdXRzLmpzXCI7XG5hc3luYyBmdW5jdGlvbiByZWFkU3RkaW4oKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgY2h1bmtzID0gW107XG4gICAgICAgIHByb2Nlc3Muc3RkaW4uc2V0RW5jb2RpbmcoXCJ1dGYtOFwiKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImRhdGFcIiwgKGNodW5rKSA9PiBjaHVua3MucHVzaChjaHVuaykpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZW5kXCIsICgpID0+IHJlc29sdmUoY2h1bmtzLmpvaW4oXCJcIikpKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImVycm9yXCIsIHJlamVjdCk7XG4gICAgfSk7XG59XG5mdW5jdGlvbiBwYXJzZVN0ZGluSW5wdXQoc3RkaW5Db250ZW50KSB7XG4gICAgcmV0dXJuIEpTT04ucGFyc2Uoc3RkaW5Db250ZW50KTtcbn1cbmZ1bmN0aW9uIHdyaXRlU3Rkb3V0KG91dHB1dCkge1xuICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKEpTT04uc3RyaW5naWZ5KG91dHB1dC5zdGRvdXQpKTtcbn1cbmZ1bmN0aW9uIG5vcm1hbGl6ZVN0cmluZ091dHB1dChob29rRXZlbnROYW1lLCByZXN1bHQpIHtcbiAgICBpZiAoIUVWRU5UU19XSVRIX1RFWFRfT1VUUFVULmhhcyhob29rRXZlbnROYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7aG9va0V2ZW50TmFtZX0gaG9va3MgY2Fubm90IHJldHVybiBwbGFpbiB0ZXh0YCk7XG4gICAgfVxuICAgIGlmIChob29rRXZlbnROYW1lID09PSBcIlNlc3Npb25TdGFydFwiKSB7XG4gICAgICAgIHJldHVybiBzZXNzaW9uU3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICBpZiAoaG9va0V2ZW50TmFtZSA9PT0gXCJTdWJhZ2VudFN0YXJ0XCIpIHtcbiAgICAgICAgcmV0dXJuIHN1YmFnZW50U3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICByZXR1cm4gdXNlclByb21wdFN1Ym1pdE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gY29udmVydFRvSG9va091dHB1dChvdXRwdXQpIHtcbiAgICByZXR1cm4gb3V0cHV0LnN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQsIHN0ZGVycjogb3V0cHV0LnN0ZGVyciB9IDogeyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQgfTtcbn1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBleGVjdXRlKGhvb2tGbikge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHN0ZGluQ29udGVudCA9IGF3YWl0IHJlYWRTdGRpbigpO1xuICAgICAgICBjb25zdCBpbnB1dCA9IHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpO1xuICAgICAgICBsb2dnZXIuc2V0Q29udGV4dChob29rRm4uaG9va0V2ZW50TmFtZSwgaW5wdXQpO1xuICAgICAgICBjb25zdCBjb250ZXh0ID0geyBsb2dnZXIgfTtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaG9va0ZuKGlucHV0LCBjb250ZXh0KTtcbiAgICAgICAgbGV0IG91dHB1dCA9IHsgc3Rkb3V0OiB7fSB9O1xuICAgICAgICBpZiAodHlwZW9mIHJlc3VsdCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgb3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChub3JtYWxpemVTdHJpbmdPdXRwdXQoaG9va0ZuLmhvb2tFdmVudE5hbWUsIHJlc3VsdCkpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHJlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBvdXRwdXQgPSBjb252ZXJ0VG9Ib29rT3V0cHV0KHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgICAgd3JpdGVTdGRvdXQob3V0cHV0KTtcbiAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuU1VDQ0VTUyk7XG4gICAgfVxuICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBCbG9ja0Vycm9yKSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtlcnJvci5yZWFzb259XFxuYCk7XG4gICAgICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5CTE9DSyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke2Vycm9yLnN0YWNrID8/IGVycm9yLm1lc3NhZ2V9XFxuYCk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtTdHJpbmcoZXJyb3IpfVxcbmApO1xuICAgICAgICB9XG4gICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLkVSUk9SKTtcbiAgICB9XG4gICAgZmluYWxseSB7XG4gICAgICAgIGxvZ2dlci5jbGVhckNvbnRleHQoKTtcbiAgICAgICAgbG9nZ2VyLmNsb3NlKCk7XG4gICAgfVxufVxuIiwgIi8qKlxuICogSGFybmVzcy1hZ25vc3RpYyBnYXRlIGNvcmUgKFBoYXNlIDMuMSBcdTIwMTQgY29udHJhY3QgYW5kIHN0dWJzKS5cbiAqXG4gKiBUaGlzIG1vZHVsZSBkZWNsYXJlcyB0aGUgUHJlVG9vbFVzZSBcImdhdGVcIiB0aGF0IGJvdGggdGhlIENsYXVkZSAoYEJhc2hgKSBhbmRcbiAqIENvZGV4IChzaGVsbC9leGVjKSBhZGFwdGVycyB3aWxsIGRyaXZlOiB3aGVuIHRoZSBhZ2VudCBydW5zIGBnaXQgY29tbWl0YCBvclxuICogYGdpdCBwdXNoYCBhbmQgdGhlIGNoYW5nZXNldCBpdCBpcyBhYm91dCB0byBsYW5kIGNhcnJpZXMgcmVhbCBzcGFuIGRlYnQsIHRoZVxuICogY29tbWFuZCBpcyBoZWxkIHdpdGggYSBjaGVja2xpc3Q7IHBvc2l0aW9uYWwgZHJpZnQgdGhlIHRvdWNoIGhvb2sgaGFzIGJlZW5cbiAqIGhlYWxpbmcgYWxsIGFsb25nIG5ldmVyIGJsb2Nrcy4gTGlrZSB7QGxpbmsgZmlsZTovLy4vdG91Y2gtY29yZS50c30gaXQgaW1wb3J0c1xuICogbm90aGluZyBmcm9tIGVpdGhlciBob29rIFNESyBhbmQgaXMgdHlwZWQgc3RydWN0dXJhbGx5LCBwZXIgdGhlIGBjb21tb24vYFxuICogbGF5ZXIgY29udmVudGlvbjogYWRhcHRlcnMgdHJhbnNsYXRlIHRoZWlyIFNESy1zcGVjaWZpYyBob29rIGlucHV0IGludG8gYVxuICogY29tbWFuZCBzdHJpbmcgKyBjd2QsIGluamVjdCBleGVjdXRpb24vc3RhdGUgZGVwZW5kZW5jaWVzLCBhbmQgdHJhbnNsYXRlIHRoZVxuICogcmV0dXJuZWQge0BsaW5rIEdhdGVSZXN1bHR9IGludG8gdGhlaXIgb3duIGRlbnkvYWxsb3cgb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogZ2F0ZS1jb3JlIGlzIGEgc2libGluZyBvZiB0b3VjaC1jb3JlLCBub3QgYSBkZXBlbmRlbnQ6IHRoZSB0d28gY29yZXMgYXJlXG4gKiBpbmRlcGVuZGVudCBhbmQgdGhpcyBtb2R1bGUgaW1wb3J0cyBub3RoaW5nIGZyb20gYHRvdWNoLWNvcmUudHNgLlxuICpcbiAqIFJldXNlZCBmcm9tIHRoZSBzaGFyZWQga2VybmVsIChub3QgcmVkZWZpbmVkKTogYGlzRGVidCgpYCAodGhlIHNpbmdsZVxuICogc291cmNlIG9mIHRydXRoIGZvciB0aGUgc2VtYW50aWMtb25seSBkZWJ0IGludmFyaWFudCBcdTIwMTQgYE1PVkVEYCBhbmRcbiAqIGBSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgYXJlIG5ldmVyIGRlYnQpLCB0aGUgcG9yY2VsYWluIHN0YXR1cyB2b2NhYnVsYXJ5XG4gKiAoYFBvcmNlbGFpblN0YXR1c2AvYFBvcmNlbGFpblJvd2AvYFN0YWxlUG9yY2VsYWluUm93YCksIGFuZCBgZ2F0ZU1lbW9EaXIoKWBcbiAqICh0aGUgYDxnaXQtY29tbW9uLWRpcj4vZ2l0LXNwYW4vZ2F0ZS9gIHBhdGggdGhlIGRpc2stYmFja2VkXG4gKiB7QGxpbmsgR2F0ZU1lbW9TdGF0ZX0gd2lsbCBwZXJzaXN0IHVuZGVyKSBcdTIwMTQgYWxsIGZyb20gYWdlbnQtaG9va3MtY29tbW9uLnRzLlxuICpcbiAqIEV2ZXJ5IGZ1bmN0aW9uIHdob3NlIHJlc3VsdCBkZXBlbmRzIG9uIHJlYWwgbG9naWMgaXMgYSBgTm90IEltcGxlbWVudGVkYCBzdHViXG4gKiBpbiB0aGlzIHBoYXNlOyBQaGFzZSAzLjIgd3JpdGVzIHNraXBwZWQgY2hlY2tzIGFnYWluc3QgdGhlc2Ugc2lnbmF0dXJlcyBhbmRcbiAqIFBoYXNlIDMuMyBpbXBsZW1lbnRzIHRoZW0uXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tICdub2RlOmNyeXB0byc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQge1xuICBnYXRlTWVtb0RpcixcbiAgaXNEZWJ0LFxuICBpc0Vudmlyb25tZW50YWxTdGF0dXMsXG4gIGlzSW5zaWRlU3BhblJvb3QsXG4gIHR5cGUgUG9yY2VsYWluUm93LFxuICBwYXJzZVBvcmNlbGFpbixcbiAgcGFyc2VTdGFsZVBvcmNlbGFpbixcbiAgcmVzb2x2ZVJlcG9Sb290LFxuICB0eXBlIFN0YWxlUG9yY2VsYWluUm93LFxuICB0b1Bvc2l4XG59IGZyb20gJy4vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcbmltcG9ydCB7IGlzR2F0ZUlnbm9yZWQsIGxvYWRHYXRlSWdub3JlIH0gZnJvbSAnLi9nYXRlLWlnbm9yZS5qcyc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2Nhbi1mYWlsdXJlIHNpZ25hbFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmFpc2VkIGJ5IHRoZSBgc3RhbGVgIGV4ZWN1dG9yIHdoZW4gYGdpdCBzcGFuIHN0YWxlYCBjb3VsZCBub3QgKmNvbXBsZXRlKiBpdHNcbiAqIHNjb3BlZCBzY2FuIFx1MjAxNCBhcyBvcHBvc2VkIHRvIGNvbXBsZXRpbmcgYW5kIHJlcG9ydGluZyBkcmlmdC4gYGdpdCBzcGFuIHN0YWxlYFxuICogZXhpdHMgbm9uLXplcm8gaW4gdHdvIHZlcnkgZGlmZmVyZW50IHNpdHVhdGlvbnM6IG9uIGxlZ2l0aW1hdGUgZHJpZnQgKHJlYWxcbiAqIHBvcmNlbGFpbiByb3dzIG9uIHN0ZG91dCkgYW5kIG9uIGEgaGFyZCBzY2FuIGZhaWx1cmUgKGUuZy4gYW4gdW5yZWFkYWJsZVxuICogYW5jaG9yIGZpbGUgYWJvcnRzIHRoZSB3aG9sZSBzY29wZWQgcXVlcnksIGxlYXZpbmcgc3Rkb3V0IGVtcHR5IGFuZCBhbiBlcnJvclxuICogb24gc3RkZXJyKS4gT25seSB0aGUgc2Vjb25kIHRocm93cyB0aGlzLCBzbyB7QGxpbmsgZXZhbHVhdGVHYXRlfSBjYW4gdGVsbCBhXG4gKiBzY2FuIHRoYXQgKnJhbiBjbGVhbiogKGVtcHR5IHJvd3MpIGZyb20gb25lIHRoYXQgKm5ldmVyIHJhbiogKGVtcHR5IHJvd3NcbiAqIGJlY2F1c2UgaXQgYWJvcnRlZCkgYW5kIHJlZnVzZSB0byByZWFkIHRoZSBsYXR0ZXIgYXMgYSBjbGVhbiBwYXNzLiBgZGV0YWlsYFxuICogY2FycmllcyB0aGUgQ0xJJ3Mgc3RkZXJyIGZvciB0aGUgc3VyZmFjZWQgcmVhc29uLlxuICovXG5leHBvcnQgY2xhc3MgR2F0ZVNjYW5FcnJvciBleHRlbmRzIEVycm9yIHtcbiAgcmVhZG9ubHkgZGV0YWlsOiBzdHJpbmc7XG4gIGNvbnN0cnVjdG9yKGRldGFpbDogc3RyaW5nKSB7XG4gICAgc3VwZXIoYGdpdCBzcGFuIHN0YWxlIGNvdWxkIG5vdCBjb21wbGV0ZSBpdHMgc2NhbjogJHtkZXRhaWx9YCk7XG4gICAgdGhpcy5uYW1lID0gJ0dhdGVTY2FuRXJyb3InO1xuICAgIHRoaXMuZGV0YWlsID0gZGV0YWlsO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQ29tbWFuZCBwYXJzaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBUaGUga2luZCBvZiBnYXRlZCBnaXQgY29tbWFuZCBhIHNoZWxsIGNvbW1hbmQgc3RyaW5nIHJlc29sdmVzIHRvLiBgJ25vbmUnYFxuICogaXMgdGhlIGNvbnNlcnZhdGl2ZSBmYWlsLW9wZW4gYW5zd2VyOiBhbnkgc2hhcGUge0BsaW5rIHBhcnNlR2l0Q29tbWFuZH0gZG9lc1xuICogbm90IGNvbmZpZGVudGx5IHJlY29nbml6ZSBhcyBhIGBnaXQgY29tbWl0YC9gZ2l0IHB1c2hgIG1hcHMgdG8gYCdub25lJ2AgYW5kXG4gKiB0aGUgZ2F0ZSBhbGxvd3MgdGhlIGNvbW1hbmQgdGhyb3VnaCB1bnRvdWNoZWQuXG4gKi9cbmV4cG9ydCB0eXBlIEdpdENvbW1hbmRLaW5kID0gJ2NvbW1pdCcgfCAncHVzaCcgfCAnbm9uZSc7XG5cbi8qKlxuICogVGhlIHJlc3VsdCBvZiBwYXJzaW5nIGEgc2hlbGwgY29tbWFuZCBzdHJpbmcgZm9yIGEgZ2F0ZWQgZ2l0IGludm9jYXRpb24uXG4gKlxuICogYHBhdGhzYCBjYXJyaWVzIG9ubHkgd2hhdCBpcyBwYXJzZWFibGUgZnJvbSB0aGUgY29tbWFuZCBsaW5lIGl0c2VsZiBcdTIwMTQgdGhlXG4gKiBleHBsaWNpdCBwYXRoc3BlY3MgYSBgZ2l0IGNvbW1pdCAtLSA8cGF0aD5cdTIwMjZgIGZvcm0gbmFtZXMuIEl0IGlzIGRlbGliZXJhdGVseVxuICogKm5vdCogdGhlIGNoYW5nZXNldDogdGhlIGZ1bGxlciByZXNvbHV0aW9uIChzdGFnZWQgZmlsZXMsIHRoZSBgLWFgL2AtYW1gXG4gKiBleHBhbnNpb24gYWdhaW5zdCB0cmFja2VkLW1vZGlmaWVkIGZpbGVzLCB0aGUgb3V0Z29pbmcgcHVzaCByYW5nZSkgaXNcbiAqIHtAbGluayByZXNvbHZlQ2hhbmdlc2V0fSdzIGpvYiwgZHJpdmVuIGZyb20gdGhlIHJlcG8gc3RhdGUsIG5vdCBmcm9tIHRoZVxuICogY29tbWFuZCB0ZXh0LiBgcGF0aHNgIGlzIG9taXR0ZWQgd2hlbiB0aGUgY29tbWFuZCBuYW1lcyBubyBleHBsaWNpdFxuICogcGF0aHNwZWMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGFyc2VkR2l0Q29tbWFuZCB7XG4gIGtpbmQ6IEdpdENvbW1hbmRLaW5kO1xuICBwYXRocz86IHN0cmluZ1tdO1xufVxuXG4vKipcbiAqIFdvcmQtYm91bmRhcnkgcGFyc2Ugb2YgYSBgZ2l0IGNvbW1pdGAgLyBgZ2l0IHB1c2hgIGludm9jYXRpb24gZW1iZWRkZWQgaW4gYW5cbiAqIGFyYml0cmFyeSBzaGVsbCBjb21tYW5kIHN0cmluZy5cbiAqXG4gKiBNdXN0IHJlY29nbml6ZSB0aGUgcmVhbCBzaGFwZXMgY29tbWl0cyBhbmQgcHVzaGVzIGFycml2ZSBpbjogY2hhaW5lZFxuICogY29tbWFuZHMgKGBcdTIwMjYgJiYgZ2l0IGNvbW1pdCBcdTIwMjZgLCBgXHUyMDI2OyBnaXQgcHVzaGAsIGBcdTIwMjYgfCBcdTIwMjZgKSwgYW4gZXhwbGljaXQgcmVwbyB2aWFcbiAqIGBnaXQgLUMgPGRpcj4gY29tbWl0IFx1MjAyNmAsIHRyYWlsaW5nIHBhdGhzcGVjcyBhZnRlciBgLS1gLCB0aGUgYC1hYC9gLWFtYFxuICogXCJjb21taXQgYWxsIHRyYWNrZWQtbW9kaWZpZWRcIiBmb3JtcywgYW5kIGludm9jYXRpb24gZnJvbSBhIGN3ZCBiZWxvdyB0aGUgcmVwb1xuICogcm9vdC4gTWF0Y2hpbmcgaXMgb24gd29yZCBib3VuZGFyaWVzLCBuZXZlciBzdWJzdHJpbmc6IGEgcGF0aCBvciBtZXNzYWdlIHRoYXRcbiAqIG1lcmVseSBjb250YWlucyB0aGUgdGV4dCBgZ2l0IGNvbW1pdGAgbXVzdCBub3QgdHJpcCB0aGUgZ2F0ZS5cbiAqXG4gKiBDb25zZXJ2YXRpdmUgYnkgY29udHJhY3Q6IHRoaXMgaXMgdGhlIGZhaWwtb3BlbiBwb2ludCBhdCB0aGUgcGFyc2UgbGF5ZXIsIG5vdFxuICogYSBwbGFjZSB0byBndWVzcy4gQW55IGNvbW1hbmQgd2hvc2Ugc2hhcGUgaXMgbm90IGNvbmZpZGVudGx5IGEgZ2F0ZWRcbiAqIGBnaXQgY29tbWl0YC9gZ2l0IHB1c2hgIFx1MjAxNCBhbiB1bmZhbWlsaWFyIHN1YmNvbW1hbmQsIGFuIGFsaWFzLCBhbiBvYmZ1c2NhdGVkXG4gKiBvciBkeW5hbWljYWxseS1idWlsdCBpbnZvY2F0aW9uIFx1MjAxNCByZXR1cm5zIGB7IGtpbmQ6ICdub25lJyB9YCBzbyB0aGUgZ2F0ZVxuICogYWxsb3dzIGl0IHJhdGhlciB0aGFuIGRlbnlpbmcgb24gYSBzaGFreSByZWFkLiAoU2VlIENBUkQubWQgXCJSaXNrcyBhbmRcbiAqIHJlcXVpcmVkIHNwaWtlcyBcdTIxOTIgQ29tbWFuZCBwYXJzaW5nXCIgYW5kIGRlc2lnbi1kZWNpc2lvbnMubWQgIzEuKVxuICpcbiAqIEBwYXJhbSBjb21tYW5kIFRoZSByYXcgc2hlbGwgY29tbWFuZCBzdHJpbmcgZnJvbSB0aGUgaG9vaydzIHRvb2wgaW5wdXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUdpdENvbW1hbmQoY29tbWFuZDogc3RyaW5nKTogUGFyc2VkR2l0Q29tbWFuZCB7XG4gIGZvciAoY29uc3Qgc2VnbWVudCBvZiBzcGxpdFNlZ21lbnRzKGNvbW1hbmQpKSB7XG4gICAgY29uc3QgaW52ID0gbWF0Y2hHaXRJbnZvY2F0aW9uKHRva2VuaXplKHNlZ21lbnQpKTtcbiAgICBpZiAoIWludikgY29udGludWU7XG4gICAgaWYgKGludi5zdWJjb21tYW5kID09PSAnY29tbWl0Jykge1xuICAgICAgY29uc3QgZGFzaERhc2ggPSBpbnYuYXJncy5pbmRleE9mKCctLScpO1xuICAgICAgY29uc3QgcGF0aHMgPSBkYXNoRGFzaCA+PSAwID8gaW52LmFyZ3Muc2xpY2UoZGFzaERhc2ggKyAxKS5maWx0ZXIoKHApID0+IHAubGVuZ3RoID4gMCkgOiBbXTtcbiAgICAgIHJldHVybiBwYXRocy5sZW5ndGggPiAwID8geyBraW5kOiAnY29tbWl0JywgcGF0aHMgfSA6IHsga2luZDogJ2NvbW1pdCcgfTtcbiAgICB9XG4gICAgaWYgKGludi5zdWJjb21tYW5kID09PSAncHVzaCcpIHtcbiAgICAgIHJldHVybiB7IGtpbmQ6ICdwdXNoJyB9O1xuICAgIH1cbiAgICAvLyBBIHJlY29nbml6ZWQgYGdpdGAgaW52b2NhdGlvbiB0aGF0IGlzIG5laXRoZXIgY29tbWl0IG5vciBwdXNoIChlLmcuXG4gICAgLy8gYGdpdCBhZGQgLiAmJiBnaXQgY29tbWl0IFx1MjAyNmApOiBrZWVwIHNjYW5uaW5nIGxhdGVyIHNlZ21lbnRzLlxuICB9XG4gIHJldHVybiB7IGtpbmQ6ICdub25lJyB9O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYSBgZ2l0IGNvbW1pdGAgaW4gdGhlIGNvbW1hbmQgaXMgYW4gYC1hYC9gLWFtYC9gLS1hbGxgIGZvcm0gXHUyMDE0IHRoZVxuICogXCJzdGFnZSBhbGwgdHJhY2tlZC1tb2RpZmllZCBmaWxlc1wiIHZhcmlhbnQgd2hvc2UgY2hhbmdlc2V0IHtAbGluayByZXNvbHZlQ2hhbmdlc2V0fVxuICogbXVzdCB3aWRlbiBiZXlvbmQgdGhlIGFscmVhZHktc3RhZ2VkIHNldC5cbiAqXG4gKiBUaGUgYGFsbGAgc2lnbmFsIGlzIGRlbGliZXJhdGVseSAqbm90KiBjYXJyaWVkIG9uIHtAbGluayBQYXJzZWRHaXRDb21tYW5kfVxuICogKHNlZSB0aGF0IHR5cGUncyBkb2MpOiB0aGUgYWRhcHRlciBkZXJpdmVzIGl0IGhlcmUgZnJvbSB0aGUgc2FtZSBjb21tYW5kIHRleHRcbiAqIGFuZCB0aHJlYWRzIGl0IGludG8ge0BsaW5rIHJlc29sdmVDaGFuZ2VzZXR9IGV4cGxpY2l0bHkuIENvbnNlcnZhdGl2ZTogb25seSBhXG4gKiBzaG9ydC1mbGFnIGdyb3VwIGNvbnRhaW5pbmcgYGFgIChgLWFgLCBgLWFtYCwgYC1tYWApIG9yIGFuIGV4cGxpY2l0IGAtLWFsbGAsXG4gKiBzY2FubmVkIGJlZm9yZSBhbnkgYC0tYCBwYXRoc3BlYyBzZXBhcmF0b3IsIGNvdW50cy5cbiAqXG4gKiBWYWx1ZS10YWtpbmcgY29tbWl0IG9wdGlvbnMgKGAtbWAsIGAtLW1lc3NhZ2VgLCBgLUZgLCBgLUNgLCBcdTIwMjYpIGNvbnN1bWUgdGhlaXJcbiAqIGZvbGxvd2luZyB0b2tlbiwgc28gaXQgaXMgbmV2ZXIgc2Nhbm5lZCBhcyBhIGZsYWc6IGEgbWVzc2FnZSB3b3JkIGxpa2VcbiAqIGAtYW5hbHlzaXNgIGluIGBnaXQgY29tbWl0IC1tIFwiLWFuYWx5c2lzXCJgIG11c3Qgbm90IGJlIG1pc3JlYWQgYXMgdGhlXG4gKiBgLS1hbGxgLWVxdWl2YWxlbnQgc2hvcnQtZmxhZyBjbHVzdGVyIGFuZCB3aWRlbiB0aGUgY2hhbmdlc2V0LlxuICovXG5jb25zdCBDT01NSVRfVkFMVUVfT1BUSU9OUyA9IG5ldyBTZXQoW1xuICAnLW0nLFxuICAnLS1tZXNzYWdlJyxcbiAgJy1GJyxcbiAgJy0tZmlsZScsXG4gICctQycsXG4gICctLXJldXNlLW1lc3NhZ2UnLFxuICAnLWMnLFxuICAnLS1yZWVkaXQtbWVzc2FnZScsXG4gICctLWF1dGhvcicsXG4gICctLWRhdGUnLFxuICAnLXQnLFxuICAnLS10ZW1wbGF0ZScsXG4gICctLWZpeHVwJyxcbiAgJy0tc3F1YXNoJyxcbiAgJy0tdHJhaWxlcicsXG4gICctLWNsZWFudXAnLFxuICAnLS1ncGctc2lnbidcbl0pO1xuXG5leHBvcnQgZnVuY3Rpb24gY29tbWl0U3RhZ2VzQWxsKGNvbW1hbmQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc3BsaXRTZWdtZW50cyhjb21tYW5kKSkge1xuICAgIGNvbnN0IGludiA9IG1hdGNoR2l0SW52b2NhdGlvbih0b2tlbml6ZShzZWdtZW50KSk7XG4gICAgaWYgKCFpbnYgfHwgaW52LnN1YmNvbW1hbmQgIT09ICdjb21taXQnKSBjb250aW51ZTtcbiAgICBjb25zdCBkYXNoRGFzaCA9IGludi5hcmdzLmluZGV4T2YoJy0tJyk7XG4gICAgY29uc3QgZmxhZ0FyZ3MgPSBkYXNoRGFzaCA+PSAwID8gaW52LmFyZ3Muc2xpY2UoMCwgZGFzaERhc2gpIDogaW52LmFyZ3M7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBmbGFnQXJncy5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3QgYXJnID0gZmxhZ0FyZ3NbaV07XG4gICAgICBpZiAoYXJnID09PSAnLS1hbGwnKSByZXR1cm4gdHJ1ZTtcbiAgICAgIC8vIEEgdmFsdWUtdGFraW5nIG9wdGlvbiBjb25zdW1lcyBpdHMgZm9sbG93aW5nIHRva2VuIFx1MjAxNCBza2lwIHRoYXQgdG9rZW4gc29cbiAgICAgIC8vIGEgbWVzc2FnZS9hdXRob3IvZGF0ZSBhcmd1bWVudCBpcyBuZXZlciBzY2FubmVkIGFzIGFuIGAtYWAgY2x1c3Rlci5cbiAgICAgIGlmIChDT01NSVRfVkFMVUVfT1BUSU9OUy5oYXMoYXJnKSkge1xuICAgICAgICBpKys7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKCFhcmcuc3RhcnRzV2l0aCgnLS0nKSAmJiAvXi1bQS1aYS16XSphW0EtWmEtel0qJC8udGVzdChhcmcpKSByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLy8gU2hlbGwgY29udHJvbCBvcGVyYXRvcnMgdGhhdCBzZXBhcmF0ZSBvbmUgc2ltcGxlIGNvbW1hbmQgZnJvbSB0aGUgbmV4dC5cbi8vIFNwbGl0dGluZyBvbiB0aGVzZSAob3V0c2lkZSBxdW90ZXMpIGlzb2xhdGVzIGVhY2ggY29tbWFuZCBzbyBhIGBnaXQgY29tbWl0YC9cbi8vIGBnaXQgcHVzaGAgY2hhaW5lZCBhZnRlciBgJiZgL2A7YC9gfGAgaXMgZm91bmQsIHdoaWxlIHRleHQgaW5zaWRlIGEgcXVvdGVkXG4vLyBhcmd1bWVudCAoYGVjaG8gXCJnaXQgY29tbWl0XCJgKSBzdGF5cyB3aXRoaW4gaXRzIG93biBub24tZ2l0IHNlZ21lbnQuXG5jb25zdCBUV09fQ0hBUl9PUEVSQVRPUlMgPSBuZXcgU2V0KFsnJiYnLCAnfHwnXSk7XG5jb25zdCBPTkVfQ0hBUl9TRVBBUkFUT1JTID0gbmV3IFNldChbJzsnLCAnfCcsICdcXG4nLCAnJicsICcoJywgJyknXSk7XG5cbi8qKiBTcGxpdCBhIHNoZWxsIGNvbW1hbmQgaW50byBzaW1wbGUtY29tbWFuZCBzZWdtZW50cywgcmVzcGVjdGluZyBxdW90ZXMuICovXG5mdW5jdGlvbiBzcGxpdFNlZ21lbnRzKGNvbW1hbmQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgc2VnbWVudHM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjdXJyZW50ID0gJyc7XG4gIGxldCBxdW90ZTogJ1wiJyB8IFwiJ1wiIHwgbnVsbCA9IG51bGw7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgY29tbWFuZC5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGNoID0gY29tbWFuZFtpXTtcbiAgICBpZiAocXVvdGUpIHtcbiAgICAgIGN1cnJlbnQgKz0gY2g7XG4gICAgICBpZiAoY2ggPT09IHF1b3RlKSBxdW90ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSAnXCInIHx8IGNoID09PSBcIidcIikge1xuICAgICAgcXVvdGUgPSBjaDtcbiAgICAgIGN1cnJlbnQgKz0gY2g7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKFRXT19DSEFSX09QRVJBVE9SUy5oYXMoY29tbWFuZC5zbGljZShpLCBpICsgMikpKSB7XG4gICAgICBzZWdtZW50cy5wdXNoKGN1cnJlbnQpO1xuICAgICAgY3VycmVudCA9ICcnO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChPTkVfQ0hBUl9TRVBBUkFUT1JTLmhhcyhjaCkpIHtcbiAgICAgIHNlZ21lbnRzLnB1c2goY3VycmVudCk7XG4gICAgICBjdXJyZW50ID0gJyc7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY3VycmVudCArPSBjaDtcbiAgfVxuICBzZWdtZW50cy5wdXNoKGN1cnJlbnQpO1xuICByZXR1cm4gc2VnbWVudHM7XG59XG5cbi8qKlxuICogVG9rZW5pemUgb25lIHNlZ21lbnQgaW50byBzaGVsbCB3b3JkcywgcmVzcGVjdGluZyBzaW5nbGUvZG91YmxlIHF1b3RlcyBhbmRcbiAqIHN0cmlwcGluZyB0aGUgcXVvdGUgY2hhcmFjdGVycy4gRGVsaWJlcmF0ZWx5IG1pbmltYWwgKG5vIGV4cGFuc2lvbiwgbm9cbiAqIGVzY2FwZSBoYW5kbGluZyBiZXlvbmQgcXVvdGVzKTogdGhlIGdvYWwgaXMgY29uZmlkZW50IHJlY29nbml0aW9uIG9mIGFcbiAqIGBnaXQgY29tbWl0YC9gcHVzaGAgc2hhcGUsIG5vdCBhIGZ1bGwgc2hlbGwgcGFyc2VyLlxuICovXG5mdW5jdGlvbiB0b2tlbml6ZShzZWdtZW50OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHRva2Vuczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGN1cnJlbnQgPSAnJztcbiAgbGV0IGhhcyA9IGZhbHNlO1xuICBsZXQgcXVvdGU6ICdcIicgfCBcIidcIiB8IG51bGwgPSBudWxsO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHNlZ21lbnQubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjaCA9IHNlZ21lbnRbaV07XG4gICAgaWYgKHF1b3RlKSB7XG4gICAgICBpZiAoY2ggPT09IHF1b3RlKSBxdW90ZSA9IG51bGw7XG4gICAgICBlbHNlIGN1cnJlbnQgKz0gY2g7XG4gICAgICBoYXMgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gJ1wiJyB8fCBjaCA9PT0gXCInXCIpIHtcbiAgICAgIHF1b3RlID0gY2g7XG4gICAgICBoYXMgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gJyAnIHx8IGNoID09PSAnXFx0Jykge1xuICAgICAgaWYgKGhhcykge1xuICAgICAgICB0b2tlbnMucHVzaChjdXJyZW50KTtcbiAgICAgICAgY3VycmVudCA9ICcnO1xuICAgICAgICBoYXMgPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjdXJyZW50ICs9IGNoO1xuICAgIGhhcyA9IHRydWU7XG4gIH1cbiAgaWYgKGhhcykgdG9rZW5zLnB1c2goY3VycmVudCk7XG4gIHJldHVybiB0b2tlbnM7XG59XG5cbi8qKiBHaXQgZ2xvYmFsIG9wdGlvbnMgdGhhdCBjb25zdW1lIGEgc2VwYXJhdGUgZm9sbG93aW5nIHZhbHVlIHRva2VuLiAqL1xuY29uc3QgR0lUX1ZBTFVFX09QVElPTlMgPSBuZXcgU2V0KFtcbiAgJy1DJyxcbiAgJy1jJyxcbiAgJy0tZ2l0LWRpcicsXG4gICctLXdvcmstdHJlZScsXG4gICctLW5hbWVzcGFjZScsXG4gICctLXN1cGVyLXByZWZpeCcsXG4gICctLWV4ZWMtcGF0aCcsXG4gICctLWF0dHItc291cmNlJyxcbiAgJy0tY29uZmlnLWVudidcbl0pO1xuXG5pbnRlcmZhY2UgR2l0SW52b2NhdGlvbiB7XG4gIHN1YmNvbW1hbmQ6IHN0cmluZztcbiAgYXJnczogc3RyaW5nW107XG59XG5cbi8qKlxuICogSWYgYSBzZWdtZW50J3MgdG9rZW5zIGFyZSBhIGBnaXQgPHN1YmNvbW1hbmQ+IFx1MjAyNmAgaW52b2NhdGlvbiwgcmV0dXJuIHRoZVxuICogc3ViY29tbWFuZCBhbmQgaXRzIHJlbWFpbmluZyBhcmdzOyBvdGhlcndpc2UgYG51bGxgLiBMZWFkaW5nIGBWQVI9dmFsdWVgXG4gKiBlbnZpcm9ubWVudCBhc3NpZ25tZW50cyBhbmQgYGdpdGAgZ2xvYmFsIG9wdGlvbnMgKGluY2x1ZGluZyB0aGUgdmFsdWUtdGFraW5nXG4gKiBvbmVzKSBhcmUgc2tpcHBlZCBzbyB0aGUgc3ViY29tbWFuZCBpcyBjb3JyZWN0bHkgbG9jYXRlZC5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hHaXRJbnZvY2F0aW9uKHRva2Vuczogc3RyaW5nW10pOiBHaXRJbnZvY2F0aW9uIHwgbnVsbCB7XG4gIGxldCBpID0gMDtcbiAgd2hpbGUgKGkgPCB0b2tlbnMubGVuZ3RoICYmIC9eW0EtWmEtel9dW0EtWmEtejAtOV9dKj0vLnRlc3QodG9rZW5zW2ldKSkgaSsrO1xuICBpZiAoaSA+PSB0b2tlbnMubGVuZ3RoIHx8IHRva2Vuc1tpXSAhPT0gJ2dpdCcpIHJldHVybiBudWxsO1xuICBpKys7XG4gIHdoaWxlIChpIDwgdG9rZW5zLmxlbmd0aCkge1xuICAgIGNvbnN0IHQgPSB0b2tlbnNbaV07XG4gICAgaWYgKHQgPT09ICctLScpIHJldHVybiBudWxsOyAvLyBhIGAtLWAgYmVmb3JlIGFueSBzdWJjb21tYW5kIGlzIG5vdCBhIHNoYXBlIHdlIHJlY29nbml6ZVxuICAgIGlmICghdC5zdGFydHNXaXRoKCctJykpIGJyZWFrO1xuICAgIGkgKz0gR0lUX1ZBTFVFX09QVElPTlMuaGFzKHQpID8gMiA6IDE7XG4gIH1cbiAgaWYgKGkgPj0gdG9rZW5zLmxlbmd0aCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IHN1YmNvbW1hbmQ6IHRva2Vuc1tpXSwgYXJnczogdG9rZW5zLnNsaWNlKGkgKyAxKSB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENoYW5nZXNldCByZXNvbHV0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBUaGUgaW5qZWN0ZWQgZ2l0IHN1cmZhY2Uge0BsaW5rIHJlc29sdmVDaGFuZ2VzZXR9IG5lZWRzIHRvIHR1cm4gYSBwYXJzZWRcbiAqIGNvbW1hbmQgaW50byB0aGUgY29uY3JldGUgbGlzdCBvZiBwYXRocyB0aGF0IHdvdWxkIGxhbmQuIEtlcHQgYXMgbmFycm93IGFzeW5jXG4gKiBmdW5jdGlvbnMgKHJhdGhlciB0aGFuIGEgcmF3IGNvbW1hbmQgcnVubmVyKSBmb2xsb3dpbmcgYHRvdWNoLWNvcmUudHNgJ3NcbiAqIGBUb3VjaEV4ZWN1dG9yc2AgcGF0dGVybiwgc28gUGhhc2UgMy4yJ3MgdGVzdHMgZmFrZSB0aGUgcmVwbyBzdGF0ZSB3aXRob3V0IGFcbiAqIHJlYWwgc3VicHJvY2VzcyBhbmQgdGhlIGNvcmUgbmV2ZXIgc3Bhd25zIG9uZSBpdHNlbGYuXG4gKlxuICogQWxsIHJldHVybmVkIHBhdGhzIGFyZSByZXBvLXJlbGF0aXZlIFBPU0lYIHBhdGhzLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEdpdEV4ZWN1dG9yIHtcbiAgLyoqXG4gICAqIFBhdGhzIHN0YWdlZCBmb3IgdGhlIG5leHQgY29tbWl0IFx1MjAxNCBgZ2l0IGRpZmYgLS1jYWNoZWQgLS1uYW1lLW9ubHlgLiBUaGVzZVxuICAgKiBhcmUgd2hhdCBhIHBsYWluIGBnaXQgY29tbWl0YCB3b3VsZCBsYW5kLlxuICAgKi9cbiAgc3RhZ2VkUGF0aHMoY3dkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZ1tdPjtcbiAgLyoqXG4gICAqIFRyYWNrZWQgZmlsZXMgd2l0aCB1bnN0YWdlZCB3b3JraW5nLXRyZWUgbW9kaWZpY2F0aW9ucyBcdTIwMTRcbiAgICogYGdpdCBkaWZmIC0tbmFtZS1vbmx5YC4gRm9sZGVkIGludG8gdGhlIGNoYW5nZXNldCBvbmx5IGZvciBgLWFgL2AtYW1gXG4gICAqIGZvcm1zLCB3aGljaCBzdGFnZSB0cmFja2VkLW1vZGlmaWVkIGZpbGVzIGltcGxpY2l0bHkgYXQgY29tbWl0IHRpbWUuXG4gICAqL1xuICB0cmFja2VkTW9kaWZpZWRQYXRocyhjd2Q6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nW10+O1xuICAvKipcbiAgICogUGF0aHMgaW4gdGhlIG91dGdvaW5nIHB1c2ggcmFuZ2UgXHUyMDE0IHRoZSBmaWxlcyBjaGFuZ2VkIGJ5IGBAe3V9Li5IRUFEYCwgd2l0aFxuICAgKiBhIG1lcmdlLWJhc2UtYWdhaW5zdC10aGUtZGVmYXVsdC1yZW1vdGUtYnJhbmNoIGZhbGxiYWNrIHdoZW4gbm8gdXBzdHJlYW0gaXNcbiAgICogY29uZmlndXJlZC4gVGhlc2UgYXJlIHdoYXQgYSBgZ2l0IHB1c2hgIHdvdWxkIHB1Ymxpc2guXG4gICAqL1xuICBvdXRnb2luZ1BhdGhzKGN3ZDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmdbXT47XG4gIC8qKlxuICAgKiBQYXRocyB1bmRlciB0aGUgZ2l2ZW4gZXhwbGljaXQgcGF0aHNwZWNzIHdob3NlIHdvcmtpbmctdHJlZSBjb250ZW50IGRpZmZlcnNcbiAgICogZnJvbSBgSEVBRGAgXHUyMDE0IGBnaXQgZGlmZiBIRUFEIC0tbmFtZS1vbmx5IC0tIDxwYXRoc3BlY3M+YC4gVGhpcyBpcyB3aGF0IGFcbiAgICogcGF0aHNwZWMtc2NvcGVkIGNvbW1pdCAoYGdpdCBjb21taXQgLS0gPHBhdGhzcGVjPlx1MjAyNmApIGFjdHVhbGx5IGxhbmRzOiB0aGVcbiAgICogY3VycmVudCB3b3JraW5nLXRyZWUgY29udGVudCBhdCB0aG9zZSBwYXRoc3BlY3MsIHJlZ2FyZGxlc3Mgb2Ygd2hhdCBlbHNlIGlzXG4gICAqIHN0YWdlZC4gVXNlZCB0byBzY29wZSB0aGUgY2hhbmdlc2V0IHdoZW4ge0BsaW5rIFBhcnNlZEdpdENvbW1hbmQucGF0aHN9IGlzXG4gICAqIHByZXNlbnQsIHNvIHRoZSBnYXRlIGV2YWx1YXRlcyBleGFjdGx5IHRoZSBmaWxlcyB0aGlzIGNvbW1pdCB0YWtlcyBcdTIwMTQgbmV2ZXJcbiAgICogYW4gdW5yZWxhdGVkIHN0YWdlZCBmaWxlLCBhbmQgbmV2ZXIgbWlzc2luZyBhIG1vZGlmaWVkLWJ1dC11bnN0YWdlZCBmaWxlXG4gICAqIG5hbWVkIGluIHRoZSBwYXRoc3BlYyAod2hpY2ggYGdpdCBkaWZmIC0tY2FjaGVkYCB3b3VsZCBuZXZlciBzdXJmYWNlKS5cbiAgICovXG4gIHBhdGhzcGVjUGF0aHMocGF0aHM6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nW10+O1xufVxuXG4vKipcbiAqIFJlc29sdmUgdGhlIGNvbmNyZXRlIGxpc3Qgb2YgcmVwby1yZWxhdGl2ZSBwYXRocyBhIGdhdGVkIGNvbW1hbmQgd291bGQgbGFuZCxcbiAqIHNvIHRoZSBnYXRlIGNhbiBzY29wZSBpdHMgc3RhbGVuZXNzL2NvdmVyYWdlIGNoZWNrIHRvIGV4YWN0bHkgdGhhdCBjaGFuZ2VzZXQuXG4gKlxuICogLSBgY29tbWl0YCB3aXRoIGV4cGxpY2l0IGBwYXRoc2AgKGEgYGdpdCBjb21taXQgLS0gPHBhdGhzcGVjPlx1MjAyNmAgZm9ybSk6IG9ubHlcbiAqICAgdGhlIHdvcmtpbmctdHJlZSBjb250ZW50IHVuZGVyIHRob3NlIHBhdGhzcGVjcyAoYHBhdGhzcGVjUGF0aHNgKSwgc2luY2UgYVxuICogICBwYXRoc3BlYy1zY29wZWQgY29tbWl0IGxhbmRzIGV4YWN0bHkgdGhhdCwgcmVnYXJkbGVzcyBvZiB0aGUgcmVzdCBvZiB0aGVcbiAqICAgc3RhZ2VkIHNldC4gYGFsbGAgaXMgaWdub3JlZCBcdTIwMTQgYC1hYCBhbmQgYW4gZXhwbGljaXQgcGF0aHNwZWMgZG8gbm90IGNvbWJpbmUuXG4gKiAtIGBjb21taXRgLCBubyBgcGF0aHNgOiB0aGUgc3RhZ2VkIHBhdGhzLCBwbHVzIFx1MjAxNCB3aGVuIGBhbGxgIGlzIHRydWUgKHRoZVxuICogICBjb21tYW5kIHdhcyBhbiBgLWFgL2AtYW1gIGZvcm0pIFx1MjAxNCB0aGUgdHJhY2tlZC1tb2RpZmllZCBwYXRocyB0aG9zZSBmb3Jtc1xuICogICBzdGFnZSBpbXBsaWNpdGx5LlxuICogLSBgcHVzaGA6IHRoZSBvdXRnb2luZyByYW5nZSBgQHt1fS4uSEVBRGAsIHdpdGggYSBtZXJnZS1iYXNlIGZhbGxiYWNrIHdoZW4gbm9cbiAqICAgdXBzdHJlYW0gaXMgY29uZmlndXJlZC4gYGFsbGAvYHBhdGhzYCBhcmUgbm90IG1lYW5pbmdmdWwgZm9yIGEgcHVzaCBhbmQgYXJlXG4gKiAgIGlnbm9yZWQuXG4gKlxuICogVGhlIGBhbGxgIGZsYWcgYW5kIGBwYXRoc2AgYXJlIHRocmVhZGVkIGluIGV4cGxpY2l0bHkgKHJhdGhlciB0aGFuIHJlYWQgYmFja1xuICogb3V0IG9mIHRoZSBjb21tYW5kKSBiZWNhdXNlIHRoZSBjYWxsZXIvYWRhcHRlciBkZXJpdmVzIHRoZW0gZnJvbSB0aGUgcGFyc2U6XG4gKiBgcGF0aHNgIGlzIHtAbGluayBQYXJzZWRHaXRDb21tYW5kLnBhdGhzfSwgYW5kIGBhbGxgICh3aGljaCB7QGxpbmsgUGFyc2VkR2l0Q29tbWFuZH1cbiAqIGludGVudGlvbmFsbHkgZG9lcyBub3QgY2FycnkpIGNvbWVzIGZyb20ge0BsaW5rIGNvbW1pdFN0YWdlc0FsbH0uXG4gKlxuICogQHBhcmFtIGtpbmQgV2hldGhlciB0aGUgY2hhbmdlc2V0IGlzIGEgY29tbWl0J3Mgc3RhZ2VkIHNldCBvciBhIHB1c2gncyByYW5nZS5cbiAqIEBwYXJhbSBhbGwgV2hldGhlciB0aGUgY29tbWl0IHdhcyBhbiBgLWFgL2AtYW1gIGZvcm0gKGlnbm9yZWQgZm9yIGBwdXNoYCkuXG4gKiBAcGFyYW0gY3dkIFRoZSB3b3JraW5nIGRpcmVjdG9yeSB0aGUgZ2l0IGNvbW1hbmQgcmFuIGluLlxuICogQHBhcmFtIGdpdCBUaGUgaW5qZWN0ZWQgZ2l0IHN1cmZhY2UgYmFja2luZyB0aGUgcmVzb2x1dGlvbi5cbiAqIEBwYXJhbSBwYXRocyBFeHBsaWNpdCBwYXRoc3BlY3MgZnJvbSBgZ2l0IGNvbW1pdCAtLSA8cGF0aHNwZWM+XHUyMDI2YCwgaWYgYW55LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUNoYW5nZXNldChcbiAga2luZDogJ2NvbW1pdCcgfCAncHVzaCcsXG4gIGFsbDogYm9vbGVhbixcbiAgY3dkOiBzdHJpbmcsXG4gIGdpdDogR2l0RXhlY3V0b3IsXG4gIHBhdGhzPzogc3RyaW5nW11cbik6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgaWYgKGtpbmQgPT09ICdwdXNoJykge1xuICAgIHJldHVybiBnaXQub3V0Z29pbmdQYXRocyhjd2QpO1xuICB9XG4gIC8vIEEgcGF0aHNwZWMtc2NvcGVkIGNvbW1pdCBsYW5kcyBvbmx5IHRoZSB3b3JraW5nLXRyZWUgY29udGVudCBhdCB0aG9zZVxuICAvLyBwYXRoc3BlY3MgXHUyMDE0IHNjb3BlIHRoZSBjaGFuZ2VzZXQgdG8gZXhhY3RseSB0aGF0LCBuZXZlciB0aGUgZnVsbCBzdGFnZWQgc2V0LlxuICBpZiAocGF0aHMgJiYgcGF0aHMubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiBnaXQucGF0aHNwZWNQYXRocyhwYXRocywgY3dkKTtcbiAgfVxuICBjb25zdCBzdGFnZWQgPSBhd2FpdCBnaXQuc3RhZ2VkUGF0aHMoY3dkKTtcbiAgaWYgKCFhbGwpIHJldHVybiBzdGFnZWQ7XG4gIGNvbnN0IHRyYWNrZWQgPSBhd2FpdCBnaXQudHJhY2tlZE1vZGlmaWVkUGF0aHMoY3dkKTtcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBjb25zdCBtZXJnZWQ6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgcGF0aCBvZiBbLi4uc3RhZ2VkLCAuLi50cmFja2VkXSkge1xuICAgIGlmIChzZWVuLmhhcyhwYXRoKSkgY29udGludWU7XG4gICAgc2Vlbi5hZGQocGF0aCk7XG4gICAgbWVyZ2VkLnB1c2gocGF0aCk7XG4gIH1cbiAgcmV0dXJuIG1lcmdlZDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBHYXRlIGV2YWx1YXRpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFRoZSBpbmplY3RlZCBleGVjdXRpb24gc3VyZmFjZSBnYXRlIGV2YWx1YXRpb24gbmVlZHMgXHUyMDE0IHRoZSBgZml4YC9gc3RhbGVgL1xuICogYGxpc3RgIGFzeW5jIGZ1bmN0aW9ucywgbWlycm9yaW5nIGB0b3VjaC1jb3JlLnRzYCdzIGBUb3VjaEV4ZWN1dG9yc2AuIFRlc3RzXG4gKiBpbmplY3QgZmFrZXMgcmV0dXJuaW5nIHN0cnVjdHVyZWQgZGF0YTsgdGhlIGNvcmUgbmV2ZXIgc3Bhd25zIGEgc3VicHJvY2Vzc1xuICogaXRzZWxmLiBBbGwgcGF0aHMgYXJlIHJlcG8tcmVsYXRpdmUgUE9TSVggcGF0aHMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgR2F0ZUV4ZWN1dG9ycyB7XG4gIC8qKlxuICAgKiBSdW4gYSBzY29wZWQgYGdpdCBzcGFuIHN0YWxlIDxwYXRocz4gLS1maXhgIFx1MjAxNCB0aGUgYmVsdC1hbmQtYnJhY2VzIGhlYWwgdGhhdFxuICAgKiBydW5zIGJlZm9yZSBjbGFzc2lmaWNhdGlvbiAocGVyIENBUkQubWQpLCByZS1hbmNob3JpbmcgYW55IHBvc2l0aW9uYWwgZHJpZnRcbiAgICogaW4gdGhlIGNoYW5nZXNldCB0aGF0IHRoZSB0b3VjaCBob29rIGhhcyBub3QgYWxyZWFkeSBoZWFsZWQuIFJlcG9ydHMgbm90aGluZztcbiAgICogaXRzIGVmZmVjdCBpcyBvbiB0aGUgd29ya2luZyB0cmVlLCBhbmQgdGhlIHN1YnNlcXVlbnQge0BsaW5rIEdhdGVFeGVjdXRvcnMuc3RhbGV9XG4gICAqIHJlYWQgb2JzZXJ2ZXMgdGhlIGhlYWxlZCBzdGF0ZS5cbiAgICovXG4gIGZpeChwYXRoczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPjtcbiAgLyoqXG4gICAqIFJ1biBhIHNjb3BlZCBgZ2l0IHNwYW4gc3RhbGUgLS1mb3JtYXQgcG9yY2VsYWluIDxwYXRocz5gIGFuZCByZXR1cm4gaXRzXG4gICAqIHBhcnNlZCByb3dzIFx1MjAxNCBvbmUgcGVyIGRyaWZ0ZWQgYW5jaG9yIGFtb25nIHRoZSBjaGFuZ2VzZXQncyBzcGFucywgZW1wdHkgd2hlblxuICAgKiBjbGVhbi4gRGVidCBpcyBjbGFzc2lmaWVkIGZyb20gdGhlc2Ugcm93cyB2aWEgYGlzRGVidCgpYDsgcG9zaXRpb25hbFxuICAgKiAoYE1PVkVEYC9gUkVTT0xWRURfUEVORElOR19DT01NSVRgKSByb3dzIGFyZSBuZXZlciBkZWJ0IGFuZCBuZXZlciBkZW55LlxuICAgKlxuICAgKiBBbiBlbXB0eSByZXN1bHQgbXVzdCBtZWFuIHRoZSBzY2FuICpyYW4gYW5kIGZvdW5kIG5vdGhpbmcqLCBuZXZlciB0aGF0IHRoZVxuICAgKiBzY2FuICpjb3VsZCBub3QgcnVuKi4gV2hlbiB0aGUgc2NvcGVkIHF1ZXJ5IGFib3J0cyBiZWZvcmUgY29tcGxldGluZyAoZS5nLlxuICAgKiBhbiB1bnJlYWRhYmxlIGFuY2hvciBmaWxlKSwgdGhlIGltcGxlbWVudGF0aW9uIHRocm93cyB7QGxpbmsgR2F0ZVNjYW5FcnJvcn1cbiAgICogcmF0aGVyIHRoYW4gcmV0dXJuaW5nIGBbXWAsIHNvIHtAbGluayBldmFsdWF0ZUdhdGV9IGRvZXMgbm90IG1pc3Rha2UgYW5cbiAgICogYWJvcnRlZCBzY2FuIGZvciBhIGNsZWFuIG9uZSBhbmQgc2lsZW50bHkgYWxsb3cgdW52ZXJpZmllZCBkZWJ0IHRocm91Z2guXG4gICAqL1xuICBzdGFsZShwYXRoczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKTogUHJvbWlzZTxTdGFsZVBvcmNlbGFpblJvd1tdPjtcbiAgLyoqXG4gICAqIFJ1biBhIHNjb3BlZCBgZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbiA8cGF0aHM+YCBhbmQgcmV0dXJuIHRoZSBjb3ZlcmluZ1xuICAgKiBhbmNob3JzLiBVc2VkIHRvIGNvbXB1dGUgKnVuY292ZXJlZCB3cml0ZXMqOiBhIGNoYW5nZWQgcGF0aCB3aXRoIHplcm9cbiAgICogY292ZXJpbmcgcm93cyBoZXJlIChtaW51cyBgLnNwYW4vKipgLCBnaXRpZ25vcmVkIHBhdGhzLCBhbmRcbiAgICogYC5zcGFuLy5nYXRlaWdub3JlYC1leGNsdWRlZCBwYXRocyBcdTIwMTQgc2VlIHtAbGluayBmaWxlOi8vLi9nYXRlLWlnbm9yZS50c30pXG4gICAqIGlzIGFuIHVuY292ZXJlZCB3cml0ZS5cbiAgICovXG4gIGxpc3QocGF0aHM6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZyk6IFByb21pc2U8UG9yY2VsYWluUm93W10+O1xufVxuXG4vKipcbiAqIFRoZSBnYXRlJ3MgcGVyLWNoYW5nZXNldCBtZW1vIFx1MjAxNCBcImhhdmUgSSBhbHJlYWR5IHByZXNlbnRlZCB0aGlzIGV4YWN0IGRlYnRcbiAqIHN0YXRlIG9uY2U/XCIgVGhlIHBlcnNpc3RlZCB1bml0IGlzIGEgZGlnZXN0IG9mIHRoZSBzb3J0ZWQgc3RhbGVuZXNzIGZpbmRpbmdzXG4gKiBwbHVzIHRoZSBzb3J0ZWQgdW5jb3ZlcmVkIHBhdGhzIChkZXNpZ24tZGVjaXNpb25zLm1kICM5J3MgXCJnYXRlIG9uY2UgcGVyXG4gKiBkaXN0aW5jdCBkZWJ0LXN0YXRlXCIpOyB0aGUgZGlzay1iYWNrZWQgaW1wbGVtZW50YXRpb24gc3RvcmVzIG9uZSBtYXJrZXIgcGVyXG4gKiBkaWdlc3QgdW5kZXIge0BsaW5rIGdhdGVNZW1vRGlyfSAoYDxnaXQtY29tbW9uLWRpcj4vZ2l0LXNwYW4vZ2F0ZS9gKSwgd2hlcmVcbiAqIHByZXNlbmNlIG1lYW5zIFwiYWxyZWFkeSBwcmVzZW50ZWQgb25jZS5cIiBJbmplY3RlZCBhcyBhIHN0b3JlIGFic3RyYWN0aW9uXG4gKiAobGlrZSBzcGFuLXN1cmZhY2UudHMncyBgTWVtb1N0b3JlYCkgc28gUGhhc2UgMy4yIGZha2VzIGl0IGluIG1lbW9yeS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBHYXRlTWVtb1N0YXRlIHtcbiAgLyoqIFdoZXRoZXIgdGhpcyBleGFjdCBkZWJ0LXN0YXRlIGRpZ2VzdCBoYXMgYWxyZWFkeSBiZWVuIHByZXNlbnRlZCBvbmNlLiAqL1xuICBoYXMoZGlnZXN0OiBzdHJpbmcpOiBib29sZWFuO1xuICAvKipcbiAgICogUmVjb3JkIHRoYXQgdGhpcyBkZWJ0LXN0YXRlIGRpZ2VzdCBoYXMgbm93IGJlZW4gcHJlc2VudGVkLCByZXR1cm5pbmdcbiAgICogd2hldGhlciB0aGUgcmVjb3JkIGFjdHVhbGx5IHBlcnNpc3RlZC4gYGZhbHNlYCBtZWFucyB0aGUgbWVtbyBjb3VsZCBub3QgYmVcbiAgICogd3JpdHRlbiAoZS5nLiBhbiB1bndyaXRhYmxlIG1lbW8gZGlyZWN0b3J5KSBcdTIwMTQgdGhlIGdhdGUgdHJlYXRzIHRoYXQgYXMgYVxuICAgKiBmYWlsLW9wZW4gc2lnbmFsIHJhdGhlciB0aGFuIGRlbnlpbmcsIGJlY2F1c2UgYSBub24tcGVyc2lzdGluZyBtZW1vIHdvdWxkXG4gICAqIHNpbGVudGx5IHR1cm4gXCJkZW55IG9uY2UsIHRoZW4gYWxsb3cgdGhlIGlkZW50aWNhbCByZXRyeVwiIGludG8gXCJkZW55IGV2ZXJ5XG4gICAqIHRpbWVcIiB3aXRoIG5vIGVzY2FwZS5cbiAgICovXG4gIHJlY29yZChkaWdlc3Q6IHN0cmluZyk6IGJvb2xlYW47XG59XG5cbi8qKlxuICogVGhlIGdhdGUncyBkZWNpc2lvbiBmb3Igb25lIGNvbW1hbmQsIGFzIGEgZGlzY3JpbWluYXRlZCB1bmlvbiB0aGUgYWRhcHRlclxuICogdHJhbnNsYXRlcyBpbnRvIGBwZXJtaXNzaW9uRGVjaXNpb246ICdkZW55J2AvYWxsb3cgKENsYXVkZSkgb3IgYSBibG9jay9hbGxvd1xuICogKENvZGV4KS4gYGRlY2lzaW9uYCBpcyB0aGUgY29hcnNlIGFsbG93L2RlbnkgdGhlIGhhcm5lc3MgYWN0cyBvbjsgYGtpbmRgXG4gKiByZWNvcmRzICp3aHkqLCBzbyB0aGUgYWRhcHRlciByZW5kZXJzIHRoZSByaWdodCBtZXNzYWdlIGFuZCBzbyB0ZXN0cyBhc3NlcnRcbiAqIHRoZSBleGFjdCBicmFuY2guXG4gKlxuICogLSBgYWxsb3dgIC8gYHNpbGVudGAgXHUyMDE0IG5vdGhpbmcgdG8gY2hlY2sgKG5vIHBhdGhzKSBvciB0aGUgY2hhbmdlc2V0IGlzIGNsZWFuO1xuICogICBhbGxvdyB3aXRoIG5vIG91dHB1dC4gSW50ZXJuYWwgZXJyb3JzIGFuZCBwYXJzZSBmYWlsdXJlcyBhbHNvIHJlc29sdmUgaGVyZTpcbiAqICAgdGhlIGdhdGUgZmFpbHMgb3BlbiBhbmQgbXVzdCBuZXZlciBicmljayBhIGNvbW1pdC5cbiAqIC0gYGFsbG93YCAvIGBhbHJlYWR5LXByZXNlbnRlZGAgXHUyMDE0IGRlYnQgaXMgcHJlc2VudCwgYnV0IHRoaXMgZXhhY3QgZGVidCBzdGF0ZVxuICogICB3YXMgYWxyZWFkeSBwcmVzZW50ZWQgb25jZSAoc2VtYW50aWMtc3RhbGVuZXNzIG9yIHVuY292ZXJlZC13cml0ZXNcbiAqICAgY29uc2lkZXItb25jZSwgb3IgYW4gdW5jaGFuZ2VkIHN0YXRlKS4gVGhlIGNvbW1hbmQgcGFzc2VzLlxuICogLSBgYWxsb3dgIC8gYGVudmlyb25tZW50YWxgIFx1MjAxNCB0aGUgY2hhbmdlc2V0J3Mgb25seSBzdGFsZW5lc3Mgcm93cyBhcmVcbiAqICAgdGVybWluYWwvZW52aXJvbm1lbnRhbCBjb25kaXRpb25zIChgQ09ORkxJQ1RgLCBgU1VCTU9EVUxFYCwgYExGU18qYCxcbiAqICAgYFBST01JU09SX01JU1NJTkdgLCBgU1BBUlNFX0VYQ0xVREVEYCwgYEZJTFRFUl9GQUlMRURgLCBgSU9fRVJST1JgKSB0aGUgQ0xJXG4gKiAgIGNvdWxkIG5vdCByZXNvbHZlIGF0IGFsbCBcdTIwMTQgbm90IHNwYW4gZHJpZnQgYSB1c2VyIGNhbiBmaXggYnkgZWRpdGluZyBhIHNwYW4uXG4gKiAgIFRoZSBnYXRlIGZhaWxzIE9QRU4gKGFsbG93KSBidXQgY2FycmllcyBgY29uZGl0aW9uc2AvYHJlYXNvbmAgc28gdGhlIGFkYXB0ZXJcbiAqICAgc3VyZmFjZXMgdGhlIGNvbmRpdGlvbiBpbnN0ZWFkIG9mIHN3YWxsb3dpbmcgaXQuIERlbnlpbmcgaGVyZSB3b3VsZCByZS1kZW55XG4gKiAgIGZvcmV2ZXIgb24gYW4gaW5mcmEgZmFpbHVyZSB0aGUgdXNlciBjYW5ub3QgY2xlYXIgZnJvbSB0aGUgZ2F0ZS5cbiAqIC0gYGFsbG93YCAvIGBzY2FuLWZhaWxlZGAgXHUyMDE0IGBnaXQgc3BhbiBzdGFsZWAgY291bGQgbm90ICpjb21wbGV0ZSogaXRzIHNjb3BlZFxuICogICBzY2FuIChhIHtAbGluayBHYXRlU2NhbkVycm9yfSwgZS5nLiBhbiB1bnJlYWRhYmxlIGFuY2hvciBmaWxlIGFib3J0aW5nIHRoZVxuICogICB3aG9sZSBxdWVyeSkuIFRoaXMgaXMgZGlzdGluY3QgZnJvbSBib3RoIGBlbnZpcm9ubWVudGFsYCAodGhlIHNjYW4gY29tcGxldGVkXG4gKiAgIGFuZCBjYXJyaWVkIHRlcm1pbmFsIHJvd3MpIGFuZCBhIGNsZWFuIHBhc3MgKHRoZSBzY2FuIGNvbXBsZXRlZCB3aXRoIHplcm9cbiAqICAgcm93cyk6IHRoZSBzY2FuIG5ldmVyIHJhbiB0byBjb21wbGV0aW9uLCBzbyBpdHMgZW1wdHkgcmVzdWx0IGlzIG5vdCBldmlkZW5jZVxuICogICBvZiBcIm5vIGRlYnQuXCIgVGhlIGdhdGUgZmFpbHMgT1BFTiBoZXJlIHRvbyBcdTIwMTQgbWF0Y2hpbmcgYGVudmlyb25tZW50YWxgIFx1MjAxNFxuICogICBidXQga2VlcHMgaXRzIG93biBga2luZGAgYW5kIGEgYHJlYXNvbmAgbmFtaW5nIHRoZSBmYWlsdXJlLCBzbyB0aGUgYWRhcHRlclxuICogICBzdXJmYWNlcyBhIHdhcm5pbmcgdGhhdCBzcGFuIGRlYnQgd2FzIE5PVCB2ZXJpZmllZCBmb3IgdGhpcyBjaGFuZ2VzZXRcbiAqICAgaW5zdGVhZCBvZiBzdGF5aW5nIHNpbGVudC4gVGhlcmUgaXMgbm8gZGVidC1zdGF0ZSB0byBtZW1vaXplOiBldmVyeVxuICogICBldmFsdWF0aW9uIG9mIGEgc3RpbGwtZmFpbGluZyBzY2FuIHdhcm5zIGFnYWluLlxuICogLSBgZGVueWAgLyBgc2VtYW50aWMtc3RhbGVuZXNzYCBcdTIwMTQgdGhlIGNoYW5nZXNldCBjYXJyaWVzIHNlbWFudGljIHN0YWxlbmVzcyxcbiAqICAgYW5kIHRoaXMgZXhhY3QgZmluZGluZ3MgZGlnZXN0IGhhcyBub3QgYmVlbiBwcmVzZW50ZWQgYmVmb3JlLiBEZW55XG4gKiAgICoqb25jZSoqLCBsaXN0aW5nIGBmaW5kaW5nc2AgYXMgYSBjaGVja2xpc3QgaW4gYHJlYXNvbmA7IGFuIGlkZW50aWNhbFxuICogICByZXRyeSAodW5jaGFuZ2VkIGZpbmRpbmdzKSBmYWxscyB0aHJvdWdoIHRvIHRoZSBlbnZpcm9ubWVudGFsIGFuZFxuICogICB1bmNvdmVyZWQgY2hlY2tzIGFuZCByZXNvbHZlcyB0byBgYWxyZWFkeS1wcmVzZW50ZWRgIHdoZW4gb3RoZXJ3aXNlXG4gKiAgIGNsZWFuLiBDaGFuZ2VkIGZpbmRpbmdzIChhIG5ldyBkaWdlc3QpIGRlbnkgZnJlc2ggKGNvbnNpZGVyLW9uY2UgcGVyXG4gKiAgIGRpc3RpbmN0IGRlYnQgc3RhdGUsIHBlciBkZXNpZ24tZGVjaXNpb25zLm1kICMxKS5cbiAqIC0gYGRlbnlgIC8gYHVuY292ZXJlZC13cml0ZXNgIFx1MjAxNCB0aGUgY2hhbmdlc2V0IGhhcyBjaGFuZ2VkIGZpbGVzIG5vIHNwYW5cbiAqICAgY292ZXJzLCBhbmQgdGhpcyBzdGF0ZSBoYXMgbm90IGJlZW4gcHJlc2VudGVkIGJlZm9yZS4gRGVueSAqKm9uY2UqKiwgbGlzdGluZ1xuICogICBgdW5jb3ZlcmVkYDsgdGhlIHJldHJ5IHdpdGggYW4gdW5jaGFuZ2VkIHN0YXRlIHJlc29sdmVzIHRvIGBhbHJlYWR5LXByZXNlbnRlZGBcbiAqICAgYW5kIHBhc3NlcyAoY29uc2lkZXItb25jZSwgcGVyIGRlc2lnbi1kZWNpc2lvbnMubWQgIzMpLlxuICovXG5leHBvcnQgdHlwZSBHYXRlUmVzdWx0ID1cbiAgfCB7IGRlY2lzaW9uOiAnYWxsb3cnOyBraW5kOiAnc2lsZW50JyB9XG4gIHwgeyBkZWNpc2lvbjogJ2FsbG93Jzsga2luZDogJ2FscmVhZHktcHJlc2VudGVkJyB9XG4gIHwgeyBkZWNpc2lvbjogJ2FsbG93Jzsga2luZDogJ2Vudmlyb25tZW50YWwnOyBjb25kaXRpb25zOiBTdGFsZVBvcmNlbGFpblJvd1tdOyByZWFzb246IHN0cmluZyB9XG4gIHwgeyBkZWNpc2lvbjogJ2FsbG93Jzsga2luZDogJ3NjYW4tZmFpbGVkJzsgcmVhc29uOiBzdHJpbmcgfVxuICB8IHsgZGVjaXNpb246ICdkZW55Jzsga2luZDogJ3NlbWFudGljLXN0YWxlbmVzcyc7IGZpbmRpbmdzOiBTdGFsZVBvcmNlbGFpblJvd1tdOyByZWFzb246IHN0cmluZyB9XG4gIHwgeyBkZWNpc2lvbjogJ2RlbnknOyBraW5kOiAndW5jb3ZlcmVkLXdyaXRlcyc7IHVuY292ZXJlZDogc3RyaW5nW107IHJlYXNvbjogc3RyaW5nIH07XG5cbi8qKlxuICogRXZhbHVhdGUgdGhlIGdhdGUgZm9yIGEgcmVzb2x2ZWQgY2hhbmdlc2V0IGFuZCBkZWNpZGUgd2hldGhlciB0byBob2xkIHRoZVxuICogY29tbWFuZC5cbiAqXG4gKiBSdW5zIGBleGVjdXRvcnMuZml4YCAoc2NvcGVkIGJlbHQtYW5kLWJyYWNlcyBgc3RhbGUgLS1maXhgKSwgdGhlbiByZWFkc1xuICogYGV4ZWN1dG9ycy5zdGFsZWAgYW5kIGNsYXNzaWZpZXMgZWFjaCBkZWJ0IHJvdyAoYGlzRGVidCgpYCkgaW50byAqc2VtYW50aWMqXG4gKiBkcmlmdCBhbmQgKmVudmlyb25tZW50YWwqIGNvbmRpdGlvbnMgKGBpc0Vudmlyb25tZW50YWxTdGF0dXMoKWApLlxuICpcbiAqIFNlbWFudGljIGRyaWZ0IChgQ0hBTkdFRGAvYERFTEVURURgKSBpcyBjaGVja2VkIGFnYWluc3QgYG1lbW9TdGF0ZWAgdmlhIGl0c1xuICogb3duIGRpZ2VzdCAoYGdhdGVTdGF0ZURpZ2VzdChzZW1hbnRpYywgW10pYCksIHRoZSBzYW1lIGRpc3RpbmN0LWRlYnQtc3RhdGVcbiAqIG1lbW8gdGhlIHVuY292ZXJlZC13cml0ZXMgY2hlY2sgYWxyZWFkeSB1c2VzOiBub3QgeWV0IHByZXNlbnRlZCBcdTIxOTIgcmVjb3JkIGl0XG4gKiBhbmQgYGRlbnlgL2BzZW1hbnRpYy1zdGFsZW5lc3NgIChhIGBtZW1vU3RhdGUucmVjb3JkYCBmYWlsdXJlIGZhaWxzIG9wZW4gdG9cbiAqIGBhbGxvd2AvYHNpbGVudGAsIHNpbmNlIGEgbm9uLXBlcnNpc3RpbmcgbWVtbyB3b3VsZCByZS1kZW55IHRoZSBpZGVudGljYWxcbiAqIHJldHJ5IGZvcmV2ZXIpOyBhbHJlYWR5IHByZXNlbnRlZCBcdTIxOTIgKipmYWxsIHRocm91Z2gqKiByYXRoZXIgdGhhbiByZXR1cm5pbmcsXG4gKiBzbyBhIHJldHJ5IHN0aWxsIHN1cmZhY2VzIGVudmlyb25tZW50YWwgYWR2aXNvcmllcyBhbmQgc3RpbGwgcnVucyB0aGVcbiAqIHVuY292ZXJlZCBjaGVjay4gV2hldGhlciB0aGUgc2VtYW50aWMgc3RhdGUgd2FzIGFscmVhZHkgcHJlc2VudGVkIGlzXG4gKiB0cmFja2VkIHNvIHRoYXQsIGlmIHRoZSBldmFsdWF0aW9uIHRoZW4gZW5kcyBjbGVhbiwgaXQgcmVzb2x2ZXMgdG9cbiAqIGBhbGxvd2AvYGFscmVhZHktcHJlc2VudGVkYCByYXRoZXIgdGhhbiBhIGJhcmUgYGFsbG93YC9gc2lsZW50YCBcdTIwMTQgbWlycm9yaW5nXG4gKiB0aGUgdW5jb3ZlcmVkIGJyYW5jaCdzIG93biBtZW1vLWhpdCByZXN1bHQuIEEgY2hhbmdlc2V0IGNhcnJ5aW5nIGJvdGhcbiAqIHVucHJlc2VudGVkIHNlbWFudGljIHN0YWxlbmVzcyBhbmQgdW5wcmVzZW50ZWQgdW5jb3ZlcmVkIHdyaXRlcyB0aGVyZWZvcmVcbiAqIGRlbmllcyB0d2ljZSAoc3RhbGVuZXNzIGZpcnN0LCB1bmNvdmVyZWQgb24gdGhlIHJldHJ5KSBiZWZvcmUgYSB0aGlyZFxuICogYXR0ZW1wdCBwYXNzZXM7IGVkaXRpbmcgb25lIHN0YWxlIHNwYW4gd2hpbGUgYW5vdGhlciByZW1haW5zIHN0YWxlIHByb2R1Y2VzXG4gKiBhIG5ldyBmaW5kaW5ncyBzZXQsIGhlbmNlIGEgbmV3IGRpZ2VzdCBhbmQgb25lIGZyZXNoIGRlbnkuIERpZ2VzdCBjb2xsaXNpb25cbiAqIGJldHdlZW4gdGhlIHR3byBjYXRlZ29yaWVzIGlzIGltcG9zc2libGU6IHRoZSBwYXlsb2FkIGlzXG4gKiBgSlNPTi5zdHJpbmdpZnkoe2ZpbmRpbmdzLCB1bmNvdmVyZWR9KWAsIGFuZCB0aGUgc2VtYW50aWMgZGlnZXN0IHBvcHVsYXRlc1xuICogYGZpbmRpbmdzYCB3aGlsZSB0aGUgdW5jb3ZlcmVkIGRpZ2VzdCBwb3B1bGF0ZXMgYHVuY292ZXJlZGAuXG4gKlxuICogRW52aXJvbm1lbnRhbCBjb25kaXRpb25zIHRoZSBDTEkgY291bGQgbm90IHJlc29sdmUgYXQgYWxsXG4gKiAoYENPTkZMSUNUYC9gU1VCTU9EVUxFYC9gTEZTXypgL2BQUk9NSVNPUl9NSVNTSU5HYC9gU1BBUlNFX0VYQ0xVREVEYC9cbiAqIGBGSUxURVJfRkFJTEVEYC9gSU9fRVJST1JgKSBcdTIxOTIgYGFsbG93YC9gZW52aXJvbm1lbnRhbGA6IGZhaWwgT1BFTiwgc3VyZmFjaW5nIHRoZVxuICogY29uZGl0aW9uIHJhdGhlciB0aGFuIGRlbnlpbmcgb24gYW4gaW5mcmEgZmFpbHVyZSBhIHNwYW4gZWRpdCBjYW5ub3QgZml4LlxuICogVW5jb3ZlcmVkIHdyaXRlcyAoY2hhbmdlZCBwYXRocyB3aXRoIHplcm8gY292ZXJhZ2UgZnJvbSBgZXhlY3V0b3JzLmxpc3RgLFxuICogbWludXMgYC5zcGFuLyoqYCwgYW5kIHBhdGhzIG1hdGNoZWQgYnkgdGhlIHJlcG8ncyBgLnNwYW4vLmdhdGVpZ25vcmVgIFx1MjAxNCBzZWVcbiAqIHtAbGluayBmaWxlOi8vLi9nYXRlLWlnbm9yZS50c30sIGxvYWRlZCBkaXJlY3RseSBmcm9tIGRpc2sgdmlhXG4gKiBgcmVzb2x2ZVJlcG9Sb290KGN3ZClgLCBmYWlsLW9wZW4gd2hlbiBhYnNlbnQvdW5yZWFkYWJsZSkgXHUyMTkyXG4gKiBgZGVueWAvYHVuY292ZXJlZC13cml0ZXNgIHRoZSBmaXJzdCB0aW1lIHRoYXQgc3RhdGUgaXMgc2VlbiwgdGhlblxuICogYGFsbG93YC9gYWxyZWFkeS1wcmVzZW50ZWRgIG9uIHJldHJ5LiBgTU9WRURgIGFuZCBgUkVTT0xWRURfUEVORElOR19DT01NSVRgXG4gKiBuZXZlciBjb250cmlidXRlIHRvIGFueSBicmFuY2ggYW5kIG5ldmVyIGRlbnkuIEFueSBpbnRlcm5hbCBlcnJvciByZXNvbHZlc1xuICogdG8gYGFsbG93YC9gc2lsZW50YCBcdTIwMTQgdGhlIGdhdGUgZmFpbHMgb3BlbiBhbmQgbmV2ZXIgYnJpY2tzIGEgY29tbWl0LlxuICpcbiAqIEEge0BsaW5rIEdhdGVTY2FuRXJyb3J9IGZyb20gYGV4ZWN1dG9ycy5zdGFsZWAgaXMgdGhlIG9uZSBjYXNlIGhhbmRsZWRcbiAqIG91dHNpZGUgdGhhdCBmbG93OiBhIHNjYW4gdGhhdCAqY291bGQgbm90IGNvbXBsZXRlKiAoZS5nLiBhbiB1bnJlYWRhYmxlXG4gKiBhbmNob3IgZmlsZSBhYm9ydHMgdGhlIHNjb3BlZCBxdWVyeSkgeWllbGRzIGFuIGVtcHR5IHJlc3VsdCB0aGF0IGlzIE5PVFxuICogZXZpZGVuY2Ugb2YgYSBjbGVhbiBjaGFuZ2VzZXQuIFJlYWRpbmcgdGhhdCBhcyBgYWxsb3dgL2BzaWxlbnRgIHdvdWxkXG4gKiBzaWxlbnRseSBzd2FsbG93IHRoZSBmYWN0IHRoYXQgdmVyaWZpY2F0aW9uIG5ldmVyIGhhcHBlbmVkLCBzbyBpdCByZXNvbHZlc1xuICogaW5zdGVhZCB0byBpdHMgb3duIGBhbGxvd2AvYHNjYW4tZmFpbGVkYCBcdTIwMTQgZmFpbCBPUEVOIGxpa2UgYGVudmlyb25tZW50YWxgXG4gKiAodGhlIGNvbW1hbmQgaXMgbm90IGhlbGQpLCBidXQgd2l0aCBhIGRpc3RpbmN0IGBraW5kYCBhbmQgYHJlYXNvbmAgc28gdGhlXG4gKiBhZGFwdGVyIHN1cmZhY2VzIGEgd2FybmluZyB0aGF0IHNwYW4gZGVidCB3YXMgTk9UIHZlcmlmaWVkIGZvciB0aGlzXG4gKiBjaGFuZ2VzZXQgcmF0aGVyIHRoYW4gc3RheWluZyBzaWxlbnQuIFRoZXJlIGlzIG5vIGRlYnQtc3RhdGUgdG8gbWVtb2l6ZVxuICogaGVyZTogZXZlcnkgZXZhbHVhdGlvbiBvZiBhIHN0aWxsLWZhaWxpbmcgc2NhbiB3YXJucyBhZ2Fpbi5cbiAqXG4gKiBAcGFyYW0gcGF0aHMgVGhlIHJlc29sdmVkIGNoYW5nZXNldCBmcm9tIHtAbGluayByZXNvbHZlQ2hhbmdlc2V0fS4gRW1wdHkgXHUyMTkyXG4gKiAgIGBhbGxvd2AvYHNpbGVudGAuXG4gKiBAcGFyYW0gY3dkIFRoZSB3b3JraW5nIGRpcmVjdG9yeSB0aGUgZ2l0IGNvbW1hbmQgcmFuIGluLlxuICogQHBhcmFtIGV4ZWN1dG9ycyBUaGUgaW5qZWN0ZWQgYGZpeGAvYHN0YWxlYC9gbGlzdGAgc3VyZmFjZS5cbiAqIEBwYXJhbSBtZW1vU3RhdGUgVGhlIHBlci1jaGFuZ2VzZXQgZGVidC1zdGF0ZSBtZW1vLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZXZhbHVhdGVHYXRlKFxuICBwYXRoczogc3RyaW5nW10sXG4gIGN3ZDogc3RyaW5nLFxuICBleGVjdXRvcnM6IEdhdGVFeGVjdXRvcnMsXG4gIG1lbW9TdGF0ZTogR2F0ZU1lbW9TdGF0ZVxuKTogUHJvbWlzZTxHYXRlUmVzdWx0PiB7XG4gIGlmIChwYXRocy5sZW5ndGggPT09IDApIHJldHVybiB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnc2lsZW50JyB9O1xuICB0cnkge1xuICAgIC8vIEJlbHQtYW5kLWJyYWNlcyBoZWFsLCB0aGVuIGNsYXNzaWZ5IGFnYWluc3QgdGhlIGhlYWxlZCBzdGF0ZS5cbiAgICBhd2FpdCBleGVjdXRvcnMuZml4KHBhdGhzLCBjd2QpO1xuICAgIGNvbnN0IHN0YWxlUm93cyA9IGF3YWl0IGV4ZWN1dG9ycy5zdGFsZShwYXRocywgY3dkKTtcblxuICAgIC8vIFNwbGl0IGRlYnQgcm93cyBpbnRvIHNlbWFudGljIGRyaWZ0IChhIHVzZXIgY2FuIGZpeCBieSBlZGl0aW5nIGEgc3BhbilcbiAgICAvLyBhbmQgdGVybWluYWwvZW52aXJvbm1lbnRhbCBjb25kaXRpb25zICh0aGUgQ0xJIGNvdWxkIG5vdCByZXNvbHZlIHRoZVxuICAgIC8vIGFuY2hvciBhdCBhbGwgXHUyMDE0IHNwYXJzZSBjaGVja291dCwgdW5mZXRjaGVkIExGUywgcGFydGlhbC1jbG9uZSBtaXNzLCBJL09cbiAgICAvLyBlcnJvcikuIGBpc0RlYnQoKWAgaXMgdGhlIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGggZm9yIHdoYXQgaXMgZGVidCBhdCBhbGw7XG4gICAgLy8gYGlzRW52aXJvbm1lbnRhbFN0YXR1cygpYCBzcGxpdHMgdGhlIGZpeGFibGUgZnJvbSB0aGUgdW5yZXNvbHZhYmxlLlxuICAgIC8vIGBNT1ZFRGAvYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCBhcmUgbmV2ZXIgZGVidCBhbmQgbmV2ZXIgY29udHJpYnV0ZS5cbiAgICBjb25zdCBkZWJ0Um93cyA9IHN0YWxlUm93cy5maWx0ZXIoKHJvdykgPT4gaXNEZWJ0KHJvdy5zdGF0dXMpKTtcbiAgICBjb25zdCBzZW1hbnRpYyA9IGRlYnRSb3dzLmZpbHRlcigocm93KSA9PiAhaXNFbnZpcm9ubWVudGFsU3RhdHVzKHJvdy5zdGF0dXMpKTtcbiAgICBjb25zdCBlbnZpcm9ubWVudGFsID0gZGVidFJvd3MuZmlsdGVyKChyb3cpID0+IGlzRW52aXJvbm1lbnRhbFN0YXR1cyhyb3cuc3RhdHVzKSk7XG5cbiAgICAvLyBTZW1hbnRpYyBzdGFsZW5lc3Mgam9pbnMgdGhlIHNhbWUgZGlzdGluY3QtZGVidC1zdGF0ZSBtZW1vIHRoZSB1bmNvdmVyZWRcbiAgICAvLyBjaGVjayB1c2VzOiBkZW55IG9uY2UgcGVyIGZpbmRpbmdzIGRpZ2VzdCwgdGhlbiBmYWxsIHRocm91Z2ggKHJhdGhlciB0aGFuXG4gICAgLy8gcmV0dXJuaW5nKSBvbiBhbiBpZGVudGljYWwgcmV0cnkgc28gdGhlIHJlc3Qgb2YgdGhlIGV2YWx1YXRpb24gc3RpbGwgcnVucy5cbiAgICBsZXQgc2VtYW50aWNBbHJlYWR5UHJlc2VudGVkID0gZmFsc2U7XG4gICAgaWYgKHNlbWFudGljLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IHNlbWFudGljRGlnZXN0ID0gZ2F0ZVN0YXRlRGlnZXN0KHNlbWFudGljLCBbXSk7XG4gICAgICBpZiAoIW1lbW9TdGF0ZS5oYXMoc2VtYW50aWNEaWdlc3QpKSB7XG4gICAgICAgIC8vIEEgbm9uLXBlcnNpc3RpbmcgbWVtbyB3cml0ZSB3b3VsZCB0dXJuIFwiZGVueSBvbmNlLCB0aGVuIGFsbG93IHRoZVxuICAgICAgICAvLyByZXRyeVwiIGludG8gXCJkZW55IGV2ZXJ5IHRpbWVcIiB3aXRoIG5vIGVzY2FwZSBcdTIwMTQgZmFpbCBvcGVuIGluc3RlYWQuXG4gICAgICAgIGlmICghbWVtb1N0YXRlLnJlY29yZChzZW1hbnRpY0RpZ2VzdCkpIHJldHVybiB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnc2lsZW50JyB9O1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGRlY2lzaW9uOiAnZGVueScsXG4gICAgICAgICAga2luZDogJ3NlbWFudGljLXN0YWxlbmVzcycsXG4gICAgICAgICAgZmluZGluZ3M6IHNlbWFudGljLFxuICAgICAgICAgIHJlYXNvbjogcmVuZGVyU3RhbGVuZXNzUmVhc29uKHNlbWFudGljKVxuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgc2VtYW50aWNBbHJlYWR5UHJlc2VudGVkID0gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBFbnZpcm9ubWVudGFsIGNvbmRpdGlvbnMgYXJlIG5vdCBhIHNwYW4gZWRpdCBhd2F5IGZyb20gcmVzb2x1dGlvbjogZmFpbFxuICAgIC8vIE9QRU4gKGFsbG93KSBcdTIwMTQgYnV0IGNhcnJ5IHRoZW0gc28gdGhlIGFkYXB0ZXIgc3VyZmFjZXMgdGhlIGNvbmRpdGlvbiByYXRoZXJcbiAgICAvLyB0aGFuIHN3YWxsb3dpbmcgaXQuIERlbnlpbmcgd291bGQgcmUtZGVueSBmb3JldmVyIG9uIGFuIGluZnJhIGZhaWx1cmUgdGhlXG4gICAgLy8gdXNlciBjYW5ub3QgY2xlYXIgZnJvbSB0aGUgZ2F0ZSwgY29udHJhZGljdGluZyB0aGUgZmFpbC1vcGVuIGNvbnRyYWN0IHRoZVxuICAgIC8vIHJlc3Qgb2YgdGhlIGdhdGUgYWxyZWFkeSBob25vcnMgZm9yIENMSS1hYnNlbnQvdGltZW91dC9wYXJzZSBmYWlsdXJlcy5cbiAgICBpZiAoZW52aXJvbm1lbnRhbC5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBkZWNpc2lvbjogJ2FsbG93JyxcbiAgICAgICAga2luZDogJ2Vudmlyb25tZW50YWwnLFxuICAgICAgICBjb25kaXRpb25zOiBlbnZpcm9ubWVudGFsLFxuICAgICAgICByZWFzb246IHJlbmRlckVudmlyb25tZW50YWxSZWFzb24oZW52aXJvbm1lbnRhbClcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gVW5jb3ZlcmVkIHdyaXRlczogY2hhbmdlZCBwYXRocyB3aXRoIHplcm8gY292ZXJpbmcgc3BhbiwgbWludXMgYC5zcGFuLyoqYFxuICAgIC8vIChzcGFuIHJlcGFpcnMgcmlkZSB0aGUgc2FtZSBjb21taXQgYW5kIG11c3QgbmV2ZXIgc2VsZi10cmlnZ2VyIHRoZSBnYXRlKVxuICAgIC8vIGFuZCBwYXRocyB0aGUgcmVwbydzIHVzZXItb3duZWQgYC5zcGFuLy5nYXRlaWdub3JlYCBleGNsdWRlcy4gR2l0aWdub3JlZFxuICAgIC8vIHBhdGhzIG5ldmVyIHJlYWNoIGhlcmUgXHUyMDE0IGdpdCBkb2VzIG5vdCBzdGFnZS9wdWJsaXNoIHRoZW0uXG4gICAgY29uc3QgY292ZXJpbmcgPSBhd2FpdCBleGVjdXRvcnMubGlzdChwYXRocywgY3dkKTtcbiAgICBjb25zdCBjb3ZlcmVkID0gbmV3IFNldChjb3ZlcmluZy5tYXAoKHJvdykgPT4gcm93LnBhdGgpKTtcbiAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgIGNvbnN0IGdhdGVJZ25vcmVSdWxlcyA9IHJlcG9Sb290ID8gbG9hZEdhdGVJZ25vcmUocmVwb1Jvb3QpIDogW107XG4gICAgY29uc3QgdW5jb3ZlcmVkID0gcGF0aHMuZmlsdGVyKFxuICAgICAgKHBhdGgpID0+ICFjb3ZlcmVkLmhhcyhwYXRoKSAmJiAhaXNJbnNpZGVTcGFuUm9vdChwYXRoKSAmJiAhaXNHYXRlSWdub3JlZChnYXRlSWdub3JlUnVsZXMsIHBhdGgpXG4gICAgKTtcbiAgICBpZiAodW5jb3ZlcmVkLmxlbmd0aCA9PT0gMCkge1xuICAgICAgLy8gQSByZXRyeSB0aGF0IGZlbGwgdGhyb3VnaCBwYXN0IGFuIGFscmVhZHktcHJlc2VudGVkIHNlbWFudGljLXN0YWxlbmVzc1xuICAgICAgLy8gZGlnZXN0IGVuZHMgY2xlYW4gaGVyZTogc3VyZmFjZSBhbHJlYWR5LXByZXNlbnRlZCByYXRoZXIgdGhhbiBhIGJhcmVcbiAgICAgIC8vIHNpbGVudCBhbGxvdywgbWlycm9yaW5nIHRoZSB1bmNvdmVyZWQgYnJhbmNoJ3Mgb3duIG1lbW8taGl0IHJlc3VsdC5cbiAgICAgIHJldHVybiBzZW1hbnRpY0FscmVhZHlQcmVzZW50ZWRcbiAgICAgICAgPyB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnYWxyZWFkeS1wcmVzZW50ZWQnIH1cbiAgICAgICAgOiB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnc2lsZW50JyB9O1xuICAgIH1cblxuICAgIC8vIENvbnNpZGVyLW9uY2U6IGRlbnkgdGhlIGZpcnN0IHRpbWUgdGhpcyBleGFjdCBkZWJ0IHN0YXRlIGlzIHNlZW4sIHRoZW5cbiAgICAvLyBwYXNzIHRoZSByZXRyeSB3aXRoIGFuIHVuY2hhbmdlZCBzdGF0ZS4gKE5vIHNlbWFudGljIHJvd3Mgc3Vydml2ZSB0b1xuICAgIC8vIGhlcmUgdW5wcmVzZW50ZWQgXHUyMDE0IHRoZSBzZW1hbnRpYyBicmFuY2ggYWJvdmUgaGFzIGFscmVhZHkgcmV0dXJuZWQgZm9yXG4gICAgLy8gdGhhdCBjYXNlIFx1MjAxNCBzbyB0aGUgZGlnZXN0J3MgZmluZGluZ3MgY29tcG9uZW50IGlzIGVtcHR5IGFuZCB0aGUgc3RhdGVcbiAgICAvLyBpcyBrZXllZCBieSB0aGUgdW5jb3ZlcmVkIHNldC4pXG4gICAgY29uc3QgZGlnZXN0ID0gZ2F0ZVN0YXRlRGlnZXN0KFtdLCB1bmNvdmVyZWQpO1xuICAgIGlmIChtZW1vU3RhdGUuaGFzKGRpZ2VzdCkpIHJldHVybiB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnYWxyZWFkeS1wcmVzZW50ZWQnIH07XG4gICAgLy8gQSBub24tcGVyc2lzdGluZyBtZW1vIHdyaXRlIHdvdWxkIHR1cm4gXCJkZW55IG9uY2UsIHRoZW4gYWxsb3cgdGhlIHJldHJ5XCJcbiAgICAvLyBpbnRvIFwiZGVueSBldmVyeSB0aW1lXCIgd2l0aCBubyBlc2NhcGUgXHUyMDE0IGZhaWwgb3BlbiByYXRoZXIgdGhhbiBkZW55LlxuICAgIGlmICghbWVtb1N0YXRlLnJlY29yZChkaWdlc3QpKSByZXR1cm4geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ3NpbGVudCcgfTtcbiAgICByZXR1cm4geyBkZWNpc2lvbjogJ2RlbnknLCBraW5kOiAndW5jb3ZlcmVkLXdyaXRlcycsIHVuY292ZXJlZCwgcmVhc29uOiByZW5kZXJVbmNvdmVyZWRSZWFzb24odW5jb3ZlcmVkKSB9O1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICAvLyBBIHNjYW4gdGhhdCBjb3VsZCBub3QgQ09NUExFVEUgaXMgbm90IGEgY2xlYW4gcmVzdWx0LCBidXQgaXQgaXMgbm90XG4gICAgLy8gZGVidCBlaXRoZXIgXHUyMDE0IHRoZXJlIGlzIG5vdGhpbmcgaGVyZSBmb3IgYSB1c2VyIHRvIHJlc29sdmUgYnkgZWRpdGluZyBhXG4gICAgLy8gc3Bhbi4gRmFpbCBPUEVOIHdpdGggYSBkaXN0aW5ndWlzaGFibGUgYHNjYW4tZmFpbGVkYCB3YXJuaW5nIGluc3RlYWQgb2ZcbiAgICAvLyBzaWxlbnRseSByZWFkaW5nIHRoZSBhYm9ydGVkIHNjYW4ncyBlbXB0eSByZXN1bHQgYXMgY2xlYW4uXG4gICAgaWYgKGVyciBpbnN0YW5jZW9mIEdhdGVTY2FuRXJyb3IpIHtcbiAgICAgIHJldHVybiB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnc2Nhbi1mYWlsZWQnLCByZWFzb246IHJlbmRlclNjYW5GYWlsZWRSZWFzb24oZXJyLmRldGFpbCkgfTtcbiAgICB9XG4gICAgLy8gRmFpbCBvcGVuOiBhbnkgb3RoZXIgaW50ZXJuYWwvQ0xJIGVycm9yIHJlc29sdmVzIHRvIGFsbG93LiBUaGUgZ2F0ZSBtdXN0XG4gICAgLy8gbmV2ZXIgYnJpY2sgYSBjb21taXQgb24gaXRzIG93biBmYWlsdXJlLlxuICAgIHJldHVybiB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnc2lsZW50JyB9O1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGVidC1zdGF0ZSBkaWdlc3QgYW5kIHJlYXNvbiByZW5kZXJpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogYHBhdGgjTHN0YXJ0LUxlbmRgLCBvciBhIGJhcmUgcGF0aCBmb3IgYSB3aG9sZS1maWxlIGFuY2hvci4gKi9cbmZ1bmN0aW9uIGFuY2hvclRleHQocm93OiBTdGFsZVBvcmNlbGFpblJvdyk6IHN0cmluZyB7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHJvdy5wYXRoO1xuICByZXR1cm4gYCR7cm93LnBhdGh9I0wke3Jvdy5zdGFydH0tTCR7cm93LmVuZH1gO1xufVxuXG4vKipcbiAqIFRoZSBkaXN0aW5jdC1kZWJ0LXN0YXRlIGRpZ2VzdCAoZGVzaWduLWRlY2lzaW9ucy5tZCAjOSk6IGEgc3RhYmxlIGhhc2ggb2YgdGhlXG4gKiBzb3J0ZWQgc3RhbGVuZXNzIGZpbmRpbmdzIHBsdXMgdGhlIHNvcnRlZCB1bmNvdmVyZWQgcGF0aHMuIFByZXNlbmNlIGluIHRoZVxuICogbWVtbyBtZWFucyBcInRoaXMgZXhhY3Qgc3RhdGUgd2FzIGFscmVhZHkgcHJlc2VudGVkIG9uY2UuXCJcbiAqL1xuZnVuY3Rpb24gZ2F0ZVN0YXRlRGlnZXN0KGZpbmRpbmdzOiBTdGFsZVBvcmNlbGFpblJvd1tdLCB1bmNvdmVyZWQ6IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgY29uc3QgZmluZGluZ0tleXMgPSBmaW5kaW5ncy5tYXAoKHJvdykgPT4gYCR7cm93LnN0YXR1c31cXHQke3Jvdy5uYW1lfVxcdCR7cm93LnBhdGh9XFx0JHtyb3cuc3RhcnR9XFx0JHtyb3cuZW5kfWApLnNvcnQoKTtcbiAgY29uc3QgcGF5bG9hZCA9IEpTT04uc3RyaW5naWZ5KHsgZmluZGluZ3M6IGZpbmRpbmdLZXlzLCB1bmNvdmVyZWQ6IFsuLi51bmNvdmVyZWRdLnNvcnQoKSB9KTtcbiAgcmV0dXJuIGNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZShwYXlsb2FkKS5kaWdlc3QoJ2hleCcpO1xufVxuXG4vKiogVGhlIGNoZWNrbGlzdCBhIHNlbWFudGljLXN0YWxlbmVzcyBkZW55IHJlbmRlcnMgaW50byBgcmVhc29uYC4gKi9cbmZ1bmN0aW9uIHJlbmRlclN0YWxlbmVzc1JlYXNvbihmaW5kaW5nczogU3RhbGVQb3JjZWxhaW5Sb3dbXSk6IHN0cmluZyB7XG4gIGNvbnN0IGxpbmVzID0gZmluZGluZ3MubWFwKChyb3cpID0+IGAgIC0gJHtyb3cubmFtZX0gKCR7cm93LnN0YXR1c30pOiAke2FuY2hvclRleHQocm93KX1gKTtcbiAgcmV0dXJuIFtcbiAgICAnVGhpcyBjaGFuZ2VzZXQgY2FycmllcyBzcGFuIGRlYnQgXHUyMDE0IHJlc29sdmUgaXQgYmVmb3JlIHRoaXMgbGFuZHM6JyxcbiAgICAuLi5saW5lcyxcbiAgICAnJyxcbiAgICBcIlVwZGF0ZSBlYWNoIHNwYW4ncyBhbmNob3JzL3doeSBpbiB0aGlzIHNhbWUgY2hhbmdlLCBvciB0ZWxsIHRoZSB1c2VyIHdoeSB0aGUgZGVzY3JpYmVkIGNvdXBsaW5nIG5vIGxvbmdlciBob2xkcywgdGhlbiByZXRyeS5cIlxuICBdLmpvaW4oJ1xcbicpO1xufVxuXG4vKipcbiAqIFRoZSBhZHZpc29yeSBzdXJmYWNlZCB3aGVuIHRoZSBjaGFuZ2VzZXQncyBvbmx5IHN0YWxlbmVzcyBpcyBlbnZpcm9ubWVudGFsIFx1MjAxNFxuICogdGhlIGdhdGUgYWxsb3dzIGJ1dCBzYXlzIHdoeSwgc28gdGhlIHVucmVzb2x2YWJsZSBjb25kaXRpb24gaXMgbm90IHNpbGVudGx5XG4gKiBzd2FsbG93ZWQuIE5vIGVzY2FwZS1oYXRjaCBsaW5lOiB0aGUgY29tbWFuZCBhbHJlYWR5IHBhc3Nlcy5cbiAqL1xuZnVuY3Rpb24gcmVuZGVyRW52aXJvbm1lbnRhbFJlYXNvbihjb25kaXRpb25zOiBTdGFsZVBvcmNlbGFpblJvd1tdKTogc3RyaW5nIHtcbiAgY29uc3QgbGluZXMgPSBjb25kaXRpb25zLm1hcCgocm93KSA9PiBgICAtICR7cm93Lm5hbWV9ICgke3Jvdy5zdGF0dXN9KTogJHthbmNob3JUZXh0KHJvdyl9YCk7XG4gIHJldHVybiBbXG4gICAgJ2dpdC1zcGFuIGNvdWxkIG5vdCBldmFsdWF0ZSB0aGVzZSBhbmNob3JzLCBzbyB0aGUgZ2F0ZSBpcyBub3QgYmxvY2tpbmcgb24gdGhlbTonLFxuICAgIC4uLmxpbmVzLFxuICAgICcnLFxuICAgICdUaGlzIGlzIGFuIGVudmlyb25tZW50YWwgY29uZGl0aW9uIChlLmcuIHNwYXJzZSBjaGVja291dCwgdW5mZXRjaGVkIExGUywgcGFydGlhbC1jbG9uZSBtaXNzLCBvciBJL08gZXJyb3IpLCBub3Qgc3BhbiBkcmlmdCB5b3UgY2FuIGZpeCBieSBlZGl0aW5nIGEgc3Bhbi4gUmVzb2x2ZSB0aGUgdW5kZXJseWluZyBjaGVja291dC9mZXRjaCBpc3N1ZSBpZiB0aGlzIGNvdXBsaW5nIG5lZWRzIHZlcmlmeWluZy4nXG4gIF0uam9pbignXFxuJyk7XG59XG5cbi8qKlxuICogVGhlIGFkdmlzb3J5IGFuIGBhbGxvd2AvYHNjYW4tZmFpbGVkYCByZXN1bHQgcmVuZGVycyBpbnRvIGByZWFzb25gLiBVbmxpa2VcbiAqIHRoZSBlbnZpcm9ubWVudGFsIGFkdmlzb3J5LCB0aGlzIGlzIGEgd2FybmluZyBhYm91dCBhbiAqdW52ZXJpZmllZCpcbiAqIGNoYW5nZXNldCByYXRoZXIgdGhhbiBhIHJlc29sdmVkL3Rlcm1pbmFsIGNvbmRpdGlvbjogdGhlIHNjYW4gY291bGQgbm90XG4gKiBjb21wbGV0ZSwgc28gc3BhbiBkZWJ0IHdhcyBOT1QgdmVyaWZpZWQgZm9yIHRoaXMgY2hhbmdlc2V0IFx1MjAxNCBidXQgdGhlXG4gKiBjb21tYW5kIHByb2NlZWRzIGFueXdheSAoZmFpbC1vcGVuLCBtYXRjaGluZyBgZW52aXJvbm1lbnRhbGApLiBOYW1lcyB0aGVcbiAqIHVuZGVybHlpbmcgZmFpbHVyZSBzbyB0aGUgdXNlciBjYW4gcmVzb2x2ZSB0aGUgcmVhZC9zY2FuIGVycm9yIGlmIHRoZVxuICogY291cGxpbmcgbmVlZHMgdmVyaWZ5aW5nLlxuICovXG5mdW5jdGlvbiByZW5kZXJTY2FuRmFpbGVkUmVhc29uKGRldGFpbDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIFtcbiAgICAnZ2l0LXNwYW4gY291bGQgbm90IGNvbXBsZXRlIGl0cyBzdGFsZW5lc3Mgc2NhbiBmb3IgdGhpcyBjaGFuZ2VzZXQsIHNvIGl0cyBzcGFuIGRlYnQgd2FzIE5PVCB2ZXJpZmllZDonLFxuICAgIGAgICR7ZGV0YWlsfWAsXG4gICAgJycsXG4gICAgJ1RoZSBjb21tYW5kIGlzIHByb2NlZWRpbmcgYW55d2F5LiBUaGlzIGlzIGEgaGFyZCBzY2FuIGZhaWx1cmUgKGUuZy4gYW4gdW5yZWFkYWJsZSBhbmNob3IgZmlsZSB0aGF0IGFib3J0cyB0aGUgd2hvbGUgc2NvcGVkIHF1ZXJ5KSwgbm90IGEgY2xlYW4gcmVzdWx0IFx1MjAxNCByZXNvbHZlIHRoZSB1bmRlcmx5aW5nIHJlYWQvc2NhbiBlcnJvciBpZiB0aGlzIGNvdXBsaW5nIG5lZWRzIHZlcmlmeWluZy4nXG4gIF0uam9pbignXFxuJyk7XG59XG5cbi8qKiBUaGUgb25lLXRpbWUgbGlzdCBhbiB1bmNvdmVyZWQtd3JpdGVzIGRlbnkgcmVuZGVycyBpbnRvIGByZWFzb25gLiAqL1xuZnVuY3Rpb24gcmVuZGVyVW5jb3ZlcmVkUmVhc29uKHVuY292ZXJlZDogc3RyaW5nW10pOiBzdHJpbmcge1xuICBjb25zdCBsaW5lcyA9IHVuY292ZXJlZC5tYXAoKHBhdGgpID0+IGAgIC0gJHtwYXRofWApO1xuICByZXR1cm4gW1xuICAgICdEZXRlcm1pbmUgaWYgeW91IHNob3VsZCBkb2N1bWVudCBpbXBsaWNpdCBzZW1hbnRpYyBkZXBlbmRlbmNpZXMgaW4gdGhlc2UgZmlsZXM6JyxcbiAgICAuLi5saW5lcyxcbiAgICAnJyxcbiAgICAnVXNlIGBnaXQgc3BhbiBhZGQgPG5hbWU+IDxwYXRoL3RvL2FuY2hvciNMc3RhcnQtTGVuZD5gIHRoZW4gYGdpdCBzcGFuIHdoeSA8bmFtZT4gLW0gXCJvbmUgc2VudGVuY2U6IG5hbWUgdGhlIHN1YnN5c3RlbSwgd2hhdCBpdCBkb2VzIGFjcm9zcyBhbmNob3JzXCJgLCBvciBqdXN0IHJldHJ5IHRoZSBjb21tYW5kIHRvIHByb2NlZWQgKHRoaXMgaXMgYSBvbmUtdGltZSBjaGVjaykuJ1xuICBdLmpvaW4oJ1xcbicpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERlZmF1bHQgc3VicHJvY2Vzcy9kaXNrLWJhY2tlZCBkZXBlbmRlbmNpZXNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy9cbi8vIFRoZSBwcm9kdWN0aW9uIHN1cmZhY2VzIGJvdGggYWRhcHRlcnMgaW5qZWN0IGJ5IGRlZmF1bHQsIGZvbGxvd2luZ1xuLy8gdG91Y2gtY29yZS50cydzIGBjcmVhdGVEZWZhdWx0VG91Y2hFeGVjdXRvcnNgIHN0eWxlOiBlYWNoIGNhcHR1cmVzIHN0ZG91dCBldmVuXG4vLyBvbiBhIG5vbi16ZXJvIGV4aXQgd2hlcmUgdGhlIENMSSBzdGlsbCBlbWl0cyB1c2VmdWwgb3V0cHV0LCBhbmQgZXZlcnkgZmFpbHVyZVxuLy8gbW9kZSAoYWJzZW50IGJpbmFyeSwgdGltZW91dCwgbm8gcmVwbykgc3VyZmFjZXMgYXMgYW4gZW1wdHkvY2xlYW4gcmVzdWx0IHNvXG4vLyB0aGUgZ2F0ZSdzIGZhaWwtb3BlbiBjb250cmFjdCBob2xkcyB3aXRob3V0IHRoZSBhZGFwdGVyIGFkZGluZyBpdHMgb3duLlxuXG5jb25zdCBERUZBVUxUX1RJTUVPVVRfTVMgPSAxMF8wMDA7XG5cbi8qKiBSdW4gYSBnaXQgY29tbWFuZCBhdCBgY3dkYCwgcmV0dXJuaW5nIHRyaW1tZWQgbm9uLWVtcHR5IFBPU0lYIG91dHB1dCBsaW5lcyAoZW1wdHkgb24gYW55IGZhaWx1cmUpLiAqL1xuZnVuY3Rpb24gZ2l0TGluZXMoYXJnczogc3RyaW5nW10sIGN3ZDogc3RyaW5nLCB0aW1lb3V0TXM6IG51bWJlcik6IHN0cmluZ1tdIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIGFyZ3MsIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgIH0pO1xuICAgIHJldHVybiBvdXRcbiAgICAgIC5zcGxpdCgnXFxuJylcbiAgICAgIC5tYXAoKGxpbmUpID0+IGxpbmUudHJpbSgpKVxuICAgICAgLmZpbHRlcigobGluZSkgPT4gbGluZS5sZW5ndGggPiAwKVxuICAgICAgLm1hcCh0b1Bvc2l4KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG59XG5cbi8qKlxuICogTGlrZSB7QGxpbmsgZ2l0TGluZXN9IGJ1dCBkaXN0aW5ndWlzaGVzIGEgKmZhaWxlZCogaW52b2NhdGlvbiAoYG51bGxgIFx1MjAxNCBlLmcuXG4gKiBgQHt1fWAgd2l0aCBubyB1cHN0cmVhbSBjb25maWd1cmVkKSBmcm9tIGEgKnN1Y2Nlc3NmdWwgYnV0IGVtcHR5KiByZXN1bHRcbiAqIChgW11gKSwgc28gdGhlIG91dGdvaW5nLXJhbmdlIHJlc29sdXRpb24ga25vd3Mgd2hlbiB0byB0cnkgdGhlIG1lcmdlLWJhc2VcbiAqIGZhbGxiYWNrIHJhdGhlciB0aGFuIG1pc3Rha2luZyBcIm5vIHVwc3RyZWFtXCIgZm9yIFwibm90aGluZyB0byBwdXNoXCIuXG4gKi9cbmZ1bmN0aW9uIGdpdExpbmVzT3JOdWxsKGFyZ3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZywgdGltZW91dE1zOiBudW1iZXIpOiBzdHJpbmdbXSB8IG51bGwge1xuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgYXJncywge1xuICAgICAgY3dkLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgfSk7XG4gICAgcmV0dXJuIG91dFxuICAgICAgLnNwbGl0KCdcXG4nKVxuICAgICAgLm1hcCgobGluZSkgPT4gbGluZS50cmltKCkpXG4gICAgICAuZmlsdGVyKChsaW5lKSA9PiBsaW5lLmxlbmd0aCA+IDApXG4gICAgICAubWFwKHRvUG9zaXgpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKiogVGhlIHByb2R1Y3Rpb24ge0BsaW5rIEdpdEV4ZWN1dG9yfTogYGdpdCBkaWZmYCByZWFkcyBzY29wZWQgdG8gdGhlIENXRCByZXBvLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHRHaXRFeGVjdXRvcih0aW1lb3V0TXM6IG51bWJlciA9IERFRkFVTFRfVElNRU9VVF9NUyk6IEdpdEV4ZWN1dG9yIHtcbiAgcmV0dXJuIHtcbiAgICBzdGFnZWRQYXRoczogYXN5bmMgKGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGlmICghcmVwb1Jvb3QpIHJldHVybiBbXTtcbiAgICAgIHJldHVybiBnaXRMaW5lcyhbJy1DJywgcmVwb1Jvb3QsICdkaWZmJywgJy0tY2FjaGVkJywgJy0tbmFtZS1vbmx5J10sIHJlcG9Sb290LCB0aW1lb3V0TXMpO1xuICAgIH0sXG4gICAgdHJhY2tlZE1vZGlmaWVkUGF0aHM6IGFzeW5jIChjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290KSByZXR1cm4gW107XG4gICAgICByZXR1cm4gZ2l0TGluZXMoWyctQycsIHJlcG9Sb290LCAnZGlmZicsICctLW5hbWUtb25seSddLCByZXBvUm9vdCwgdGltZW91dE1zKTtcbiAgICB9LFxuICAgIG91dGdvaW5nUGF0aHM6IGFzeW5jIChjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290KSByZXR1cm4gW107XG4gICAgICBjb25zdCB1cHN0cmVhbSA9IGdpdExpbmVzT3JOdWxsKFsnLUMnLCByZXBvUm9vdCwgJ2RpZmYnLCAnLS1uYW1lLW9ubHknLCAnQHt1fS4uSEVBRCddLCByZXBvUm9vdCwgdGltZW91dE1zKTtcbiAgICAgIGlmICh1cHN0cmVhbSAhPT0gbnVsbCkgcmV0dXJuIHVwc3RyZWFtO1xuICAgICAgLy8gTm8gdXBzdHJlYW0gY29uZmlndXJlZDogZmFsbCBiYWNrIHRvIHRoZSBtZXJnZS1iYXNlIHdpdGggdGhlIGRlZmF1bHRcbiAgICAgIC8vIHJlbW90ZSBicmFuY2ggKGBvcmlnaW4vSEVBRGApLiBJZiB0aGF0IHRvbyBpcyB1bnJlc29sdmFibGUsIGZhaWwgb3Blbi5cbiAgICAgIGNvbnN0IGJhc2UgPSBnaXRMaW5lcyhbJy1DJywgcmVwb1Jvb3QsICdtZXJnZS1iYXNlJywgJ0hFQUQnLCAnb3JpZ2luL0hFQUQnXSwgcmVwb1Jvb3QsIHRpbWVvdXRNcylbMF07XG4gICAgICBpZiAoIWJhc2UpIHJldHVybiBbXTtcbiAgICAgIHJldHVybiBnaXRMaW5lcyhbJy1DJywgcmVwb1Jvb3QsICdkaWZmJywgJy0tbmFtZS1vbmx5JywgYCR7YmFzZX0uLkhFQURgXSwgcmVwb1Jvb3QsIHRpbWVvdXRNcyk7XG4gICAgfSxcbiAgICBwYXRoc3BlY1BhdGhzOiBhc3luYyAocGF0aHMsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGlmICghcmVwb1Jvb3QgfHwgcGF0aHMubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gICAgICAvLyBXb3JraW5nLXRyZWUgY29udGVudCB2cyBIRUFELCBzY29wZWQgdG8gdGhlIHBhdGhzcGVjcyBcdTIwMTQgdGhlIGZpbGVzIGFcbiAgICAgIC8vIGBnaXQgY29tbWl0IC0tIDxwYXRoc3BlYz5gIHdvdWxkIGFjdHVhbGx5IGNoYW5nZSAoc3RhZ2VkIG9yIG5vdCkuXG4gICAgICByZXR1cm4gZ2l0TGluZXMoWyctQycsIHJlcG9Sb290LCAnZGlmZicsICdIRUFEJywgJy0tbmFtZS1vbmx5JywgJy0tJywgLi4ucGF0aHNdLCByZXBvUm9vdCwgdGltZW91dE1zKTtcbiAgICB9XG4gIH07XG59XG5cbi8qKiBUaGUgcHJvZHVjdGlvbiB7QGxpbmsgR2F0ZUV4ZWN1dG9yc306IHNjb3BlZCBgZ2l0IHNwYW5gIGZpeC9zdGFsZS9saXN0IGF0IHRoZSByZXBvIHJvb3QuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdEdhdGVFeGVjdXRvcnModGltZW91dE1zOiBudW1iZXIgPSBERUZBVUxUX1RJTUVPVVRfTVMpOiBHYXRlRXhlY3V0b3JzIHtcbiAgcmV0dXJuIHtcbiAgICBmaXg6IGFzeW5jIChwYXRocywgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCB8fCBwYXRocy5sZW5ndGggPT09IDApIHJldHVybjtcbiAgICAgIHRyeSB7XG4gICAgICAgIGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ3N0YWxlJywgLi4ucGF0aHMsICctLWZpeCddLCB7XG4gICAgICAgICAgY3dkOiByZXBvUm9vdCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gYGdpdCBzcGFuIHN0YWxlYCBleGl0cyAxIG9uIGRyaWZ0IGV2ZW4gYWZ0ZXIgaGVhbGluZywgYW5kIG5vbi16ZXJvIG9uXG4gICAgICAgIC8vIGdlbnVpbmUgZmFpbHVyZTsgZWl0aGVyIHdheSB0aGUgc3Vic2VxdWVudCBgc3RhbGVgIHJlYWQgaXMgdGhlIHNvdXJjZVxuICAgICAgICAvLyBvZiB0cnV0aCwgc28gdGhlIGV4aXQgY29kZSBpcyBpZ25vcmVkIGhlcmUuXG4gICAgICB9XG4gICAgfSxcbiAgICBzdGFsZTogYXN5bmMgKHBhdGhzLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290IHx8IHBhdGhzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICAgICAgbGV0IG91dDogc3RyaW5nO1xuICAgICAgdHJ5IHtcbiAgICAgICAgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnc3RhbGUnLCAnLS1mb3JtYXQnLCAncG9yY2VsYWluJywgLi4ucGF0aHNdLCB7XG4gICAgICAgICAgY3dkOiByZXBvUm9vdCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgLy8gYGdpdCBzcGFuIHN0YWxlYCBleGl0cyBub24temVybyBpbiB0d28gdmVyeSBkaWZmZXJlbnQgd2F5cywgYW5kIHRoZXlcbiAgICAgICAgLy8gbXVzdCBub3QgYmUgY29uZmxhdGVkOlxuICAgICAgICAvLyAgLSBMZWdpdGltYXRlIGRyaWZ0OiByZWFsIHBvcmNlbGFpbiByb3dzIG9uIHN0ZG91dCBkZXNjcmliaW5nIHRoZVxuICAgICAgICAvLyAgICBkcmlmdC4gUGFyc2UgdGhlbSAodGhpcyBpcyB0aGUgd2hvbGUgcG9pbnQgb2YgdGhlIHJlYWQpLlxuICAgICAgICAvLyAgLSBIYXJkIHNjYW4gZmFpbHVyZTogdGhlIHNjb3BlZCBxdWVyeSBhYm9ydGVkIGJlZm9yZSBjb21wbGV0aW5nIChlLmcuXG4gICAgICAgIC8vICAgIGFuIHVucmVhZGFibGUgYW5jaG9yIGZpbGUpLCB3cml0aW5nIGFuIGVycm9yIHRvIHN0ZGVyciBhbmQgZW1pdHRpbmdcbiAgICAgICAgLy8gICAgZW1wdHkgc3Rkb3V0LiBBbiBlbXB0eSByZXN1bHQgaGVyZSBpcyBOT1QgXCJjbGVhblwiIFx1MjAxNCB0aGUgc2NhbiBuZXZlclxuICAgICAgICAvLyAgICByYW4gdG8gY29tcGxldGlvbiBcdTIwMTQgc28gc2lnbmFsIGl0IGRpc3RpbmN0bHkgcmF0aGVyIHRoYW4gcGFyc2luZyB0b1xuICAgICAgICAvLyAgICBgW11gLCB3aGljaCB3b3VsZCByZWFkIGFzIGEgY2xlYW4gcGFzcyBhbmQgc2lsZW50bHkgYWxsb3cgdGhlIGNvbW1pdC5cbiAgICAgICAgY29uc3Qgc3Rkb3V0ID0gKGVyciBhcyB7IHN0ZG91dD86IHN0cmluZyB9KS5zdGRvdXQ7XG4gICAgICAgIGNvbnN0IHN0ZGVyciA9IChlcnIgYXMgeyBzdGRlcnI/OiBzdHJpbmcgfSkuc3RkZXJyO1xuICAgICAgICBjb25zdCBzdGRvdXRUZXh0ID0gdHlwZW9mIHN0ZG91dCA9PT0gJ3N0cmluZycgPyBzdGRvdXQgOiAnJztcbiAgICAgICAgY29uc3Qgc3RkZXJyVGV4dCA9IHR5cGVvZiBzdGRlcnIgPT09ICdzdHJpbmcnID8gc3RkZXJyIDogJyc7XG4gICAgICAgIGlmIChzdGRvdXRUZXh0LnRyaW0oKS5sZW5ndGggPT09IDAgJiYgc3RkZXJyVGV4dC50cmltKCkubGVuZ3RoID4gMCkge1xuICAgICAgICAgIHRocm93IG5ldyBHYXRlU2NhbkVycm9yKHN0ZGVyclRleHQudHJpbSgpKTtcbiAgICAgICAgfVxuICAgICAgICBvdXQgPSBzdGRvdXRUZXh0O1xuICAgICAgfVxuICAgICAgcmV0dXJuIHBhcnNlU3RhbGVQb3JjZWxhaW4ob3V0KTtcbiAgICB9LFxuICAgIGxpc3Q6IGFzeW5jIChwYXRocywgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCB8fCBwYXRocy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2xpc3QnLCAnLS1wb3JjZWxhaW4nLCAuLi5wYXRoc10sIHtcbiAgICAgICAgICBjd2Q6IHJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHBhcnNlUG9yY2VsYWluKG91dCk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgfVxuICAgIH1cbiAgfTtcbn1cblxuLyoqXG4gKiBUaGUgcHJvZHVjdGlvbiBkaXNrLWJhY2tlZCB7QGxpbmsgR2F0ZU1lbW9TdGF0ZX06IG9uZSBtYXJrZXIgZmlsZSBwZXIgZGVidC1zdGF0ZVxuICogZGlnZXN0IHVuZGVyIHtAbGluayBnYXRlTWVtb0Rpcn0gKGA8Z2l0LWNvbW1vbi1kaXI+L2dpdC1zcGFuL2dhdGUvYCksIGZvbGxvd2luZ1xuICogc3Bhbi1zdXJmYWNlLnRzJ3MgZmlsZS1iYWNrZWQgYE1lbW9TdG9yZWAgcGF0dGVybi4gVGhlIGRpZ2VzdCBpcyBhIGhleCBzaGEyNTYsXG4gKiBhIHNhZmUgZmlsZW5hbWUuIEJlc3QtZWZmb3J0IGFuZCBub24tdGhyb3dpbmc6IGEgbWVtbyB3aG9zZSByZXBvIGNhbm5vdCBiZVxuICogcmVzb2x2ZWQgZGVncmFkZXMgdG8gYSBuby1vcCBzdG9yZSAobmV2ZXIgcGVyc2lzdHMgXHUyMTkyIHVuY292ZXJlZCB3b3VsZCByZS1kZW55LFxuICogYnV0IGFuIHVucmVzb2x2YWJsZSByZXBvIHlpZWxkcyBhbiBlbXB0eSBjaGFuZ2VzZXQgdXBzdHJlYW0gYW55d2F5KS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURpc2tHYXRlTWVtb1N0YXRlKGN3ZDogc3RyaW5nKTogR2F0ZU1lbW9TdGF0ZSB7XG4gIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gIGlmICghcmVwb1Jvb3QpIHtcbiAgICAvLyBObyByZXNvbHZhYmxlIHJlcG8gXHUyMTkyIHRoZSBtZW1vIGNhbm5vdCBwZXJzaXN0LiBSZXBvcnQgYGZhbHNlYCBmcm9tXG4gICAgLy8gYHJlY29yZGAgc28gdGhlIGdhdGUgZmFpbHMgb3BlbiByYXRoZXIgdGhhbiBkZW55aW5nIHdpdGggbm8gZXNjYXBlLlxuICAgIHJldHVybiB7IGhhczogKCkgPT4gZmFsc2UsIHJlY29yZDogKCkgPT4gZmFsc2UgfTtcbiAgfVxuICBjb25zdCBkaXIgPSBnYXRlTWVtb0RpcihyZXBvUm9vdCk7XG4gIHJldHVybiB7XG4gICAgaGFzOiAoZGlnZXN0KSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gZnMuZXhpc3RzU3luYyhub2RlUGF0aC5qb2luKGRpciwgZGlnZXN0KSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgIH0sXG4gICAgcmVjb3JkOiAoZGlnZXN0KSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBmcy5ta2RpclN5bmMoZGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgZnMud3JpdGVGaWxlU3luYyhub2RlUGF0aC5qb2luKGRpciwgZGlnZXN0KSwgJycpO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBBIGZhaWxlZCBtZW1vIHdyaXRlIG11c3QgbmV2ZXIgYnJpY2sgdGhlIGNvbW1pdCBhbmQgbXVzdCBuZXZlclxuICAgICAgICAvLyBzaWxlbnRseSByZS1kZW55IGZvcmV2ZXI6IHJlcG9ydCB0aGUgZmFpbHVyZSBzbyB0aGUgZ2F0ZSBmYWlscyBvcGVuLlxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgfVxuICB9O1xufVxuIiwgIi8qKlxuICogU2hhcmVkIGhlbHBlcnMgdXNlZCBieSBtdWx0aXBsZSBhZ2VudC1ob29rcyBlbnRyeSBwb2ludHMuXG4gKlxuICogRXh0cmFjdGVkIGZyb20gcHJlLXRvb2wtdXNlLnRzIHNvIHRoYXQgdGhlIHVwY29taW5nIFN0b3AgaG9vayAoYW5kIGFueVxuICogZnV0dXJlIGhvb2tzKSBjYW4gaW1wb3J0IHBhdGggdXRpbGl0aWVzLCByYW5nZSBoZWxwZXJzLCBhbmQgdGhlXG4gKiBzYW5pdGl6ZVNlc3Npb25JZC9mb3JtYXRBbmNob3IgZnVuY3Rpb25zIHdpdGhvdXQgZGVwZW5kaW5nIG9uIHRoZVxuICogUHJlVG9vbFVzZS1zcGVjaWZpYyBtb2R1bGUuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgb3MgZnJvbSAnbm9kZTpvcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBhdGggaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiB0b1Bvc2l4KHA6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBwLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbn1cblxuZnVuY3Rpb24gaXNBYnNvbHV0ZVBvc2l4KHA6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gcC5zdGFydHNXaXRoKCcvJykgfHwgL15bQS1aYS16XTpcXC8vLnRlc3QocCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhYnNwYXRoQWdhaW5zdChiYXNlOiBzdHJpbmcsIHRhcmdldDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdCA9IHRvUG9zaXgodGFyZ2V0KTtcbiAgaWYgKGlzQWJzb2x1dGVQb3NpeCh0KSkgcmV0dXJuIHQ7XG4gIGNvbnN0IGIgPSB0b1Bvc2l4KGJhc2UpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICByZXR1cm4gYCR7Yn0vJHt0fWA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUmVwb1Jvb3QoZGlyOiBzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICghZGlyKSByZXR1cm4gbnVsbDtcbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCBkaXIsICdyZXYtcGFyc2UnLCAnLS1zaG93LXRvcGxldmVsJ10sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4J1xuICAgIH0pO1xuICAgIGNvbnN0IHRyaW1tZWQgPSBvdXQudHJpbSgpO1xuICAgIHJldHVybiB0cmltbWVkLmxlbmd0aCA+IDAgPyB0b1Bvc2l4KHRyaW1tZWQpIDogbnVsbDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqXG4gKiBSZXBvcnQgd2hldGhlciBhIHJlcG8tcmVsYXRpdmUgcGF0aCBpcyBleGNsdWRlZCBieSBnaXQncyBpZ25vcmUgcnVsZXNcbiAqICguZ2l0aWdub3JlLCAuZ2l0L2luZm8vZXhjbHVkZSwgY29yZS5leGNsdWRlc0ZpbGUpLiBVc2VkIHRvIGtlZXAgaWdub3JlZFxuICogZmlsZXMgXHUyMDE0IGJ1aWxkIG91dHB1dCwgY2FjaGVzLCBsb2dzIFx1MjAxNCBvdXQgb2YgdG91Y2ggdHJhY2tpbmcgZW50aXJlbHksIHNvXG4gKiB0aGUgdG91Y2ggaG9vayBuZXZlciByZXBvcnRzIHJlYWRzLCB3cml0ZXMsIG9yIHVuY292ZXJlZCB3cml0ZXMgb24gdGhlbS5cbiAqXG4gKiBgZ2l0IGNoZWNrLWlnbm9yZSAtcSA8cGF0aD5gIGV4aXRzIDAgd2hlbiB0aGUgcGF0aCBpcyBpZ25vcmVkLCAxIHdoZW4gaXQgaXNcbiAqIG5vdCwgYW5kIDEyOCBvbiBlcnJvci4gZXhlY0ZpbGVTeW5jIHRocm93cyBvbiBhbnkgbm9uLXplcm8gZXhpdCwgc28gYSBjbGVhblxuICogcmV0dXJuIG1lYW5zIFwiaWdub3JlZFwiLiBBIHN0YXR1cy0xIHRocm93IGlzIHRoZSBleHBlY3RlZCBcIm5vdCBpZ25vcmVkXCJcbiAqIHNpZ25hbDsgYW55IG90aGVyIGZhaWx1cmUgaXMgYW4gdW5yZWxpYWJsZSBhbnN3ZXIsIHNvIHdlIHJlcG9ydCBgZmFsc2VgXG4gKiAoZG8gbm90IGRyb3AgdGhlIHRvdWNoKSByYXRoZXIgdGhhbiBzaWxlbnRseSBoaWRpbmcgYSB0cmFja2VkIGZpbGUuXG4gKi9cbi8qKlxuICogVGhlIGRlZmF1bHQgc3BhbiByb290IGRpcmVjdG9yeSwgcmVsYXRpdmUgdG8gdGhlIHJlcG8gcm9vdCwgdXNlZCB3aGVuIG5vXG4gKiBlbnZpcm9ubWVudCB2YXJpYWJsZSBvciBnaXQgY29uZmlnIG92ZXJyaWRlcyB0aGUgbG9jYXRpb24uXG4gKi9cbmV4cG9ydCBjb25zdCBTUEFOX1JPT1QgPSAnLnNwYW4nO1xuXG4vKipcbiAqIFJlc29sdmUgdGhlIHNwYW4gcm9vdCBkaXJlY3RvcnkgZm9yIGEgZ2l2ZW4gcmVwbywgbWlycm9yaW5nIHRoZSBSdXN0IENMSVxuICogcHJlY2VkZW5jZSAobWludXMgdGhlIC0tc3Bhbi1kaXIgQ0xJIGZsYWcsIHdoaWNoIGlzIGludmlzaWJsZSB0byBmaWxlLXdyaXRlXG4gKiBob29rcyk6XG4gKiAgIDEuIEdJVF9TUEFOX0RJUiBlbnZpcm9ubWVudCB2YXJpYWJsZVxuICogICAyLiBgZ2l0IGNvbmZpZyBnaXQtc3Bhbi5kaXJgIGluIHRoZSByZXBvXG4gKiAgIDMuIERlZmF1bHQ6IFwiLnNwYW5cIlxuICpcbiAqIFRoZSByZXR1cm5lZCB2YWx1ZSBpcyBhIFBPU0lYLXN0eWxlIHBhdGggd2l0aCBubyB0cmFpbGluZyBzbGFzaC5cbiAqIEZhaWwtc2FmZTogYW55IHJlc29sdXRpb24gZXJyb3IgZmFsbHMgYmFjayB0byBcIi5zcGFuXCIgc28gdGhlIGhvb2sgbmV2ZXJcbiAqIGNyYXNoZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGVudkRpciA9IHByb2Nlc3MuZW52WydHSVRfU1BBTl9ESVInXTtcbiAgaWYgKGVudkRpciAmJiBlbnZEaXIudHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4gdG9Qb3NpeChlbnZEaXIudHJpbSgpKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgfVxuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnY29uZmlnJywgJ2dpdC1zcGFuLmRpciddLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIGVuY29kaW5nOiAndXRmOCdcbiAgICB9KTtcbiAgICBjb25zdCB0cmltbWVkID0gdG9Qb3NpeChvdXQudHJpbSgpKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgICBpZiAodHJpbW1lZC5sZW5ndGggPiAwKSByZXR1cm4gdHJpbW1lZDtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdm9pZCBlcnI7IC8vIGNvbmZpZyBrZXkgYWJzZW50IG9yIGdpdCBlcnJvciBcdTIwMTQgZmFsbCB0aHJvdWdoIHRvIGRlZmF1bHRcbiAgfVxuICByZXR1cm4gU1BBTl9ST09UO1xufVxuXG4vKipcbiAqIFJlcG9ydCB3aGV0aGVyIGEgcmVwby1yZWxhdGl2ZSBQT1NJWCBwYXRoIGZhbGxzIGluc2lkZSB0aGUgZ2l2ZW4gc3BhbiByb290XG4gKiBkaXJlY3RvcnkuIEEgcGF0aCBpcyBpbnNpZGUgd2hlbiBpdCBlcXVhbHMgdGhlIHNwYW4gcm9vdCBleGFjdGx5IG9yIGlzXG4gKiBuZXN0ZWQgYmVuZWF0aCBpdCAoaS5lLiBzdGFydHMgd2l0aCBcIjxzcGFuUm9vdD4vXCIpLiBUaGUgXCIvXCIgYm91bmRhcnkgcHJldmVudHNcbiAqIGZhbHNlIHBvc2l0aXZlcyBmb3Igc2libGluZ3MgbGlrZSBcIi5zcGFucy94XCIgb3IgXCIuc3Bhbi1ub3Rlcy94XCIuXG4gKlxuICogUGFzcyB0aGUgcmVzdWx0IG9mIGByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3QpYCBhcyBgc3BhblJvb3RgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNJbnNpZGVTcGFuUm9vdChyZXBvUmVsUGF0aDogc3RyaW5nLCBzcGFuUm9vdDogc3RyaW5nID0gU1BBTl9ST09UKTogYm9vbGVhbiB7XG4gIGNvbnN0IHJvb3QgPSBzcGFuUm9vdC5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgcmV0dXJuIHJlcG9SZWxQYXRoID09PSByb290IHx8IHJlcG9SZWxQYXRoLnN0YXJ0c1dpdGgoYCR7cm9vdH0vYCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0dpdElnbm9yZWQocmVwb1Jvb3Q6IHN0cmluZywgcmVwb1JlbFBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnY2hlY2staWdub3JlJywgJy1xJywgJy0tJywgcmVwb1JlbFBhdGhdLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAnaWdub3JlJywgJ2lnbm9yZSddXG4gICAgfSk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHZvaWQgZXJyO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3Q6IHN0cmluZywgYWJzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgcm9vdCA9IHRvUG9zaXgocmVwb1Jvb3QpO1xuICBjb25zdCBhYnMgPSB0b1Bvc2l4KGFic1BhdGgpO1xuICBjb25zdCBwcmVmaXggPSByb290LmVuZHNXaXRoKCcvJykgPyByb290IDogYCR7cm9vdH0vYDtcbiAgcmV0dXJuIGFicy5zdGFydHNXaXRoKHByZWZpeCkgPyBhYnMuc2xpY2UocHJlZml4Lmxlbmd0aCkgOiBhYnM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5vbmljYWxpemVQYXRoKGFic1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHRvUG9zaXgoZnMucmVhbHBhdGhTeW5jLm5hdGl2ZShhYnNQYXRoKSk7XG4gIH0gY2F0Y2gge1xuICAgIC8vIEZpbGUgZG9lc24ndCBleGlzdCB5ZXQgKGUuZy4gV3JpdGUgdG8gYSBuZXcgZmlsZSk6IGNhbm9uaWNhbGl6ZSB0aGVcbiAgICAvLyBkaXJlY3RvcnkgYW5kIHJlam9pbiB0aGUgYmFzZW5hbWUgc28gc3ltbGlua3MgaW4gdGhlIHBhcmVudCBhcmUgcmVzb2x2ZWQuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGRpciA9IHRvUG9zaXgoZnMucmVhbHBhdGhTeW5jLm5hdGl2ZShub2RlUGF0aC5kaXJuYW1lKGFic1BhdGgpKSk7XG4gICAgICByZXR1cm4gYCR7ZGlyfS8ke25vZGVQYXRoLmJhc2VuYW1lKGFic1BhdGgpfWA7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBQYXJlbnQgZG9lc24ndCBleGlzdCBlaXRoZXI7IGZhbGwgYmFjayB0byB0aGUgdW4tY2Fub25pY2FsaXplZCBwYXRoLlxuICAgICAgcmV0dXJuIGFic1BhdGg7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkZXJpdmVQYXRoKHRvb2xJbnB1dDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGN3ZDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IGZwID0gdG9vbElucHV0LmZpbGVfcGF0aDtcbiAgaWYgKHR5cGVvZiBmcCAhPT0gJ3N0cmluZycgfHwgZnAubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgYWJzID0gYWJzcGF0aEFnYWluc3QoY3dkLCBmcCk7XG4gIHJldHVybiBjYW5vbmljYWxpemVQYXRoKGFicyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTGluZSByYW5nZSB0eXBlcyBhbmQgaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgTGluZVJhbmdlIHtcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByYW5nZXNJbnRlcnNlY3QoYTogTGluZVJhbmdlLCBiOiBMaW5lUmFuZ2UpOiBib29sZWFuIHtcbiAgcmV0dXJuIGEuc3RhcnQgPD0gYi5lbmQgJiYgYS5lbmQgPj0gYi5zdGFydDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQb3JjZWxhaW4gcm93IHBhcnNpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIFBvcmNlbGFpblJvdyB7XG4gIG5hbWU6IHN0cmluZztcbiAgcGF0aDogc3RyaW5nO1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlUG9yY2VsYWluKHN0ZG91dDogc3RyaW5nKTogUG9yY2VsYWluUm93W10ge1xuICBjb25zdCByb3dzOiBQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygc3Rkb3V0LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHBhcnRzID0gdHJpbW1lZC5zcGxpdCgnXFx0Jyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDMpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFtuYW1lLCBwYXRoLCByYW5nZV0gPSBwYXJ0cztcbiAgICBjb25zdCBkYXNoSWR4ID0gcmFuZ2UuaW5kZXhPZignLScpO1xuICAgIGlmIChkYXNoSWR4ID09PSAtMSkgY29udGludWU7XG4gICAgY29uc3Qgc3RhcnQgPSBwYXJzZUludChyYW5nZS5zbGljZSgwLCBkYXNoSWR4KSwgMTApO1xuICAgIGNvbnN0IGVuZCA9IHBhcnNlSW50KHJhbmdlLnNsaWNlKGRhc2hJZHggKyAxKSwgMTApO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpIHx8IE51bWJlci5pc05hTihlbmQpKSBjb250aW51ZTtcbiAgICByb3dzLnB1c2goeyBuYW1lLCBwYXRoLCBzdGFydCwgZW5kIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG4vKipcbiAqIFRoZSBmdWxsIGBnaXQgc3BhbiBzdGFsZSAtLWZvcm1hdCBwb3JjZWxhaW5gIHN0YXR1cyB0b2tlbiB2b2NhYnVsYXJ5ICh0aGVcbiAqIGdpdC1zcGFuIENMSSdzIHBvcmNlbGFpbiBjb250cmFjdCk6IGBGUkVTSGAvYE1PVkVEYC9gUkVTT0xWRURfUEVORElOR19DT01NSVRgXG4gKiBhcmUgcG9zaXRpb25hbC1vci1jbGVhbiBhbmQgbmV2ZXIgZGVidDsgZXZlcnkgb3RoZXIgdG9rZW4gaXMgc2VtYW50aWMgZHJpZnRcbiAqIG9yIGEgdGVybWluYWwvZXJyb3IgY29uZGl0aW9uIGFuZCBpcyBkZWJ0LiBTZWUge0BsaW5rIGlzRGVidH0gZm9yIHRoZVxuICogc2luZ2xlIHNvdXJjZSBvZiB0cnV0aCBvbiB0aGF0IHNwbGl0LlxuICovXG5leHBvcnQgY29uc3QgUE9SQ0VMQUlOX1NUQVRVU0VTID0gW1xuICAnRlJFU0gnLFxuICAnUkVTT0xWRURfUEVORElOR19DT01NSVQnLFxuICAnTU9WRUQnLFxuICAnQ0hBTkdFRCcsXG4gICdERUxFVEVEJyxcbiAgJ0NPTkZMSUNUJyxcbiAgJ1NVQk1PRFVMRScsXG4gICdMRlNfTk9UX0ZFVENIRUQnLFxuICAnTEZTX05PVF9JTlNUQUxMRUQnLFxuICAnUFJPTUlTT1JfTUlTU0lORycsXG4gICdTUEFSU0VfRVhDTFVERUQnLFxuICAnRklMVEVSX0ZBSUxFRCcsXG4gICdJT19FUlJPUidcbl0gYXMgY29uc3Q7XG5cbmV4cG9ydCB0eXBlIFBvcmNlbGFpblN0YXR1cyA9ICh0eXBlb2YgUE9SQ0VMQUlOX1NUQVRVU0VTKVtudW1iZXJdO1xuXG5jb25zdCBQT1JDRUxBSU5fU1RBVFVTX1NFVDogUmVhZG9ubHlTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoUE9SQ0VMQUlOX1NUQVRVU0VTKTtcblxuZnVuY3Rpb24gcGFyc2VQb3JjZWxhaW5TdGF0dXMocmF3OiBzdHJpbmcpOiBQb3JjZWxhaW5TdGF0dXMgfCBudWxsIHtcbiAgcmV0dXJuIFBPUkNFTEFJTl9TVEFUVVNfU0VULmhhcyhyYXcpID8gKHJhdyBhcyBQb3JjZWxhaW5TdGF0dXMpIDogbnVsbDtcbn1cblxuLyoqIEEgYHBhcnNlU3RhbGVQb3JjZWxhaW5gIHJvdzogYSB7QGxpbmsgUG9yY2VsYWluUm93fSBwbHVzIGl0cyBzdGF0dXMgdG9rZW4uICovXG5leHBvcnQgaW50ZXJmYWNlIFN0YWxlUG9yY2VsYWluUm93IGV4dGVuZHMgUG9yY2VsYWluUm93IHtcbiAgc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXM7XG59XG5cbi8qKlxuICogVGhlIGRlYnQgaW52YXJpYW50IChzeXN0ZW0td2lkZTsgY29uc3VtZWQgYnkgYm90aCB0aGUgZnV0dXJlIHRvdWNoLWNvcmUgYW5kXG4gKiBnYXRlLWNvcmUpOiBvbmx5IHNlbWFudGljIHN0YXR1c2VzIGFyZSBkZWJ0LiBgQ0hBTkdFRGAgYW5kIGBERUxFVEVEYCBhcmVcbiAqIHNlbWFudGljIGRyaWZ0OyB0aGUgcmVtYWluaW5nIG5vbi1GUkVTSC9NT1ZFRC9SRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCB0b2tlbnNcbiAqIGFyZSB0ZXJtaW5hbC9lcnJvciBjb25kaXRpb25zIGFuZCBhcmUgdHJlYXRlZCBhcyBkZWJ0IHRvbyAodGhleSBibG9jayBvblxuICogdGhlaXIgb3duIG1lcml0cyBcdTIwMTQgdGhlIENMSSBjb3VsZCBub3QgcmVzb2x2ZSB0aGUgYW5jaG9yIGF0IGFsbCkuIGBGUkVTSGAsXG4gKiBgTU9WRURgLCBhbmQgYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCBhcmUgbmV2ZXIgZGVidDogcG9zaXRpb25hbCBkcmlmdCB0aGVcbiAqIENMSSBjYW4gaGVhbCAob3IgYWxyZWFkeSBoYXMpIGlzIGludmlzaWJsZSwgYW5kIGEgcGVuZGluZy1jb21taXQgcmVzb2x1dGlvblxuICogaXMgbm90IG91dHN0YW5kaW5nIGRlYnQuXG4gKlxuICogTm90ZTogdGhlIHBvcmNlbGFpbiB2b2NhYnVsYXJ5IGRvZXMgbm90IGN1cnJlbnRseSBkaXN0aW5ndWlzaFxuICogY29udGVudC1lcXVpdmFsZW50IGBDSEFOR0VEYCAoZS5nLiB3aGl0ZXNwYWNlLW9ubHkgZHJpZnQgYC0tZml4YCBjYW4gaGVhbClcbiAqIGZyb20gZ2VudWluZWx5IHNlbWFudGljIGBDSEFOR0VEYCBcdTIwMTQgdGhhdCBjbGFzc2lmaWNhdGlvbiBpcyBub3QgcHJlc2VudCBpblxuICogYGdpdCBzcGFuIHN0YWxlIC0tZm9ybWF0IHBvcmNlbGFpbmAgb3V0cHV0IHRvZGF5LiBVbnRpbCB0aGUgQ0xJIGV4cG9zZXMgaXQsXG4gKiBldmVyeSBgQ0hBTkdFRGAgcm93IGlzIHRyZWF0ZWQgYXMgZGVidC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRGVidChzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IGJvb2xlYW4ge1xuICBzd2l0Y2ggKHN0YXR1cykge1xuICAgIGNhc2UgJ0ZSRVNIJzpcbiAgICBjYXNlICdNT1ZFRCc6XG4gICAgY2FzZSAnUkVTT0xWRURfUEVORElOR19DT01NSVQnOlxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSB0ZXJtaW5hbC9lbnZpcm9ubWVudGFsIHN0YXR1c2VzOiB0aGUgQ0xJIGNvdWxkIG5vdCByZXNvbHZlIHRoZSBhbmNob3IgYXRcbiAqIGFsbCwgc28gdGhlIHJvdyBpcyBub3Qgc3BhbiBkcmlmdCBhIHVzZXIgY2FuIGZpeCBieSBlZGl0aW5nIGEgc3Bhbi4gVGhlc2UgYXJlXG4gKiBgQ09ORkxJQ1RgICh1bnJlc29sdmVkIG1lcmdlKSwgYFNVQk1PRFVMRWAgKGFuY2hvciBpbnNpZGUgYSBzdWJtb2R1bGUpLFxuICogYExGU19OT1RfRkVUQ0hFRGAvYExGU19OT1RfSU5TVEFMTEVEYCAoR2l0IExGUyBjb250ZW50IHVuYXZhaWxhYmxlKSxcbiAqIGBQUk9NSVNPUl9NSVNTSU5HYCAocGFydGlhbC1jbG9uZSBvYmplY3Qgbm90IGZldGNoZWQpLCBgU1BBUlNFX0VYQ0xVREVEYFxuICogKHBhdGggb3V0c2lkZSB0aGUgc3BhcnNlLWNoZWNrb3V0IGNvbmUpLCBgRklMVEVSX0ZBSUxFRGAgKGEgY2xlYW4vc211ZGdlXG4gKiBmaWx0ZXIgZXJyb3JlZCksIGFuZCBgSU9fRVJST1JgICh0cmFuc2llbnQgcmVhZCBmYWlsdXJlKS5cbiAqXG4gKiBUaGVzZSBhcmUgYSBzdHJpY3Qgc3Vic2V0IG9mIHtAbGluayBpc0RlYnR9OiBldmVyeSBlbnZpcm9ubWVudGFsIHN0YXR1cyBpc1xuICogYWxzbyBkZWJ0IChpdCBibG9ja3Mgb24gaXRzIG93biBtZXJpdHMgd2hlbiBzdXJmYWNlZCBpbiBhIHN0YXR1cyByZXBvcnQpLCBidXRcbiAqIHRoZSBnYXRlIG11c3QgdHJlYXQgdGhlbSBkaWZmZXJlbnRseSBmcm9tICpzZW1hbnRpYyogZHJpZnQgKGBDSEFOR0VEYCxcbiAqIGBERUxFVEVEYCkuIFNlbWFudGljIGRyaWZ0IGlzIGZpeGFibGUgYnkgZWRpdGluZyBhIHNwYW4sIHNvIHRoZSBnYXRlIGZhaWxzXG4gKiBjbG9zZWQgb24gaXQ7IGFuIGVudmlyb25tZW50YWwgY29uZGl0aW9uIGlzIG5vdCBzb21ldGhpbmcgYSBzcGFuIGVkaXQgY2FuXG4gKiByZXNvbHZlLCBzbyB0aGUgZ2F0ZSBmYWlscyBPUEVOIG9uIGl0IChhbGxvdywgYnV0IHN1cmZhY2UgdGhlIGNvbmRpdGlvbikgXHUyMDE0XG4gKiByZS1kZW55aW5nIGZvcmV2ZXIgb24gYW4gaW5mcmEgZmFpbHVyZSB0aGUgdXNlciBjYW5ub3QgY2xlYXIgZnJvbSBoZXJlIHdvdWxkXG4gKiBjb250cmFkaWN0IHRoZSBmYWlsLW9wZW4gY29udHJhY3QgdGhlIHJlc3Qgb2YgdGhlIGdhdGUgYWxyZWFkeSBob25vcnMgZm9yXG4gKiBDTEktYWJzZW50L3RpbWVvdXQvcGFyc2UtZmFpbHVyZSBjb25kaXRpb25zLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNFbnZpcm9ubWVudGFsU3RhdHVzKHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogYm9vbGVhbiB7XG4gIHN3aXRjaCAoc3RhdHVzKSB7XG4gICAgY2FzZSAnQ09ORkxJQ1QnOlxuICAgIGNhc2UgJ1NVQk1PRFVMRSc6XG4gICAgY2FzZSAnTEZTX05PVF9GRVRDSEVEJzpcbiAgICBjYXNlICdMRlNfTk9UX0lOU1RBTExFRCc6XG4gICAgY2FzZSAnUFJPTUlTT1JfTUlTU0lORyc6XG4gICAgY2FzZSAnU1BBUlNFX0VYQ0xVREVEJzpcbiAgICBjYXNlICdGSUxURVJfRkFJTEVEJzpcbiAgICBjYXNlICdJT19FUlJPUic6XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKlxuICogYGdpdCBzcGFuIHN0YWxlIC0tZm9ybWF0IHBvcmNlbGFpbmAgZW1pdHMgYSBkaWZmZXJlbnQgc2hhcGUgdGhhblxuICogYGxpc3QgLS1wb3JjZWxhaW5gOiBhIGAjIHBvcmNlbGFpbiB2MmAgaGVhZGVyLCBgIyBmdXp6eSBOYCBjb21tZW50IGxpbmVzLFxuICogYW5kIG9uZSBgPHN0YXR1cz5cXHQ8c3JjPlxcdDxuYW1lPlxcdDxwYXRoPlxcdDxzdGFydD5cXHQ8ZW5kPmAgcm93IHBlciBkcmlmdGVkXG4gKiBhbmNob3IgKHdob2xlLWZpbGUgYW5jaG9ycyBjYXJyeSBgKHdob2xlKWAvYC1gIGluIHBsYWNlIG9mIHRoZSBsaW5lIGNvbHVtbnMpLlxuICogUm93cyB3aG9zZSBzdGF0dXMgdG9rZW4gaXMgbm90IGluIHtAbGluayBQT1JDRUxBSU5fU1RBVFVTRVN9IGFyZSBza2lwcGVkIFx1MjAxNFxuICogYW4gdW5yZWNvZ25pemVkIHRva2VuIGZyb20gYSBuZXdlciBDTEkgaXMgdHJlYXRlZCB0aGUgc2FtZSBhcyBhIG1hbGZvcm1lZFxuICogbGluZSByYXRoZXIgdGhhbiBndWVzc2VkIGF0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VTdGFsZVBvcmNlbGFpbihzdGRvdXQ6IHN0cmluZyk6IFN0YWxlUG9yY2VsYWluUm93W10ge1xuICBjb25zdCByb3dzOiBTdGFsZVBvcmNlbGFpblJvd1tdID0gW107XG4gIGZvciAoY29uc3QgbGluZSBvZiBzdGRvdXQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCB8fCB0cmltbWVkLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgY29uc3QgcGFydHMgPSB0cmltbWVkLnNwbGl0KCdcXHQnKTtcbiAgICBpZiAocGFydHMubGVuZ3RoIDwgNikgY29udGludWU7XG4gICAgY29uc3QgW3N0YXR1c0NvbCwgLCBuYW1lLCBwYXRoLCBzdGFydENvbCwgZW5kQ29sXSA9IHBhcnRzO1xuICAgIGNvbnN0IHN0YXR1cyA9IHBhcnNlUG9yY2VsYWluU3RhdHVzKHN0YXR1c0NvbCk7XG4gICAgaWYgKCFzdGF0dXMpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHN0YXJ0ID0gc3RhcnRDb2wgPT09ICcod2hvbGUpJyA/IDAgOiBwYXJzZUludChzdGFydENvbCwgMTApO1xuICAgIGNvbnN0IGVuZCA9IGVuZENvbCA9PT0gJy0nID8gMCA6IHBhcnNlSW50KGVuZENvbCwgMTApO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpIHx8IE51bWJlci5pc05hTihlbmQpKSBjb250aW51ZTtcbiAgICByb3dzLnB1c2goeyBuYW1lLCBwYXRoLCBzdGFydCwgZW5kLCBzdGF0dXMgfSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2Vzc2lvbiBJRCBzYW5pdGl6YXRpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIEluamVjdGl2ZSB0cmFuc2Zvcm06IHBlcmNlbnQtZW5jb2RlIGJ5dGVzIG91dHNpZGUgW0EtWmEtejAtOS5fLV0gYXMgJUhIXG4gKiAodXBwZXJjYXNlIGhleCkuIFVzZWQgdG8gcHJvZHVjZSBzYWZlIGZpbGVuYW1lcyBmcm9tIGFyYml0cmFyeSBzZXNzaW9uIGlkcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplU2Vzc2lvbklkKHNlc3Npb25JZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHNlc3Npb25JZC5yZXBsYWNlKC9bXkEtWmEtejAtOS5fLV0vZywgKGNoKSA9PiB7XG4gICAgcmV0dXJuIGAlJHtjaC5jaGFyQ29kZUF0KDApLnRvU3RyaW5nKDE2KS50b1VwcGVyQ2FzZSgpLnBhZFN0YXJ0KDIsICcwJyl9YDtcbiAgfSk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUGVyLXNlc3Npb24gYmFzZSBkaXJlY3Rvcnlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vLyBCYXNlIGRpciBzaGFyZWQgYnkgYWxsIHBlci1zZXNzaW9uIHN0YXRlOiBjdXJyZW50bHkganVzdCB0aGUgdG91Y2gtaG9va1xuLy8gc2Vzc2lvbiBtZW1vIChzcGFuLXN1cmZhY2UudHMncyBNZW1vU3RvcmUpLiBFYWNoIHNlc3Npb24gZ2V0cyBvbmVcbi8vIHN1YmRpcmVjdG9yeSBrZXllZCBieSBpdHMgc2FuaXRpemVkIGlkLCBzbyBldmVyeSB3cml0ZXIvcmVhZGVyIGZvciBhIGdpdmVuXG4vLyBzZXNzaW9uIGFncmVlcyBvbiBpdHMgbG9jYXRpb24uXG5leHBvcnQgY29uc3QgU0VTU0lPTl9CQVNFX0RJUiA9IG5vZGVQYXRoLmpvaW4ob3MuaG9tZWRpcigpLCAnLmNhY2hlJywgJ2dpdC1zcGFuJywgJ3Nlc3Npb24nKTtcblxuLyoqIFRoZSBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcnkgZm9yIGEgZ2l2ZW4gc2Vzc2lvbiBpZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uRGlyKHNlc3Npb25JZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4oU0VTU0lPTl9CQVNFX0RJUiwgc2FuaXRpemVTZXNzaW9uSWQoc2Vzc2lvbklkKSk7XG59XG5cbmNvbnN0IFRISVJUWV9EQVlTX01TID0gMzAgKiAyNCAqIDYwICogNjAgKiAxMDAwO1xuXG4vKipcbiAqIE9wcG9ydHVuaXN0aWNhbGx5IHBydW5lIHBlci1zZXNzaW9uIHN0YXRlIGRpcmVjdG9yaWVzIHVuZGVyXG4gKiB7QGxpbmsgU0VTU0lPTl9CQVNFX0RJUn0gd2hvc2UgbXRpbWUgaXMgb2xkZXIgdGhhbiBgbWF4QWdlTXNgIChkZWZhdWx0IDMwXG4gKiBkYXlzKS4gQSBkaXJlY3RvcnkncyBtdGltZSBhZHZhbmNlcyB3aGVuZXZlciBhbiBlbnRyeSBpbnNpZGUgaXQgaXNcbiAqIGNyZWF0ZWQvcmVuYW1lZC9yZW1vdmVkLCBzbyBhbiBhY3RpdmUgc2Vzc2lvbiAobWVtbyB3cml0ZXMpIHN0YXlzIGZyZXNoO1xuICogb25seSBnZW51aW5lbHkgYWJhbmRvbmVkIHNlc3Npb25zIGFnZSBvdXQuXG4gKlxuICogQmVzdC1lZmZvcnQgYW5kIG5vbi10aHJvd2luZzogY2FsbGVkIG9wcG9ydHVuaXN0aWNhbGx5IGZyb20gaG9vayByZWFkL3dyaXRlXG4gKiBwYXRocywgbm90IGEgc2VwYXJhdGUgY3Jvbi1saWtlIG1lY2hhbmlzbSwgc28gYSBmYWlsdXJlIGhlcmUgbXVzdCBuZXZlclxuICogYmxvY2sgdGhlIGNhbGxlcidzIGFjdHVhbCB3b3JrLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcHJ1bmVTdGFsZVNlc3Npb25zKG5vdzogbnVtYmVyID0gRGF0ZS5ub3coKSwgbWF4QWdlTXM6IG51bWJlciA9IFRISVJUWV9EQVlTX01TKTogdm9pZCB7XG4gIGxldCBlbnRyaWVzOiBmcy5EaXJlbnRbXTtcbiAgdHJ5IHtcbiAgICBlbnRyaWVzID0gZnMucmVhZGRpclN5bmMoU0VTU0lPTl9CQVNFX0RJUiwgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm47IC8vIGJhc2UgZGlyIGFic2VudCBvciB1bnJlYWRhYmxlIFx1MjAxNCBub3RoaW5nIHRvIHBydW5lXG4gIH1cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSB7XG4gICAgaWYgKCFlbnRyeS5pc0RpcmVjdG9yeSgpKSBjb250aW51ZTtcbiAgICBjb25zdCBkaXJQYXRoID0gbm9kZVBhdGguam9pbihTRVNTSU9OX0JBU0VfRElSLCBlbnRyeS5uYW1lKTtcbiAgICB0cnkge1xuICAgICAgY29uc3Qgc3RhdCA9IGZzLnN0YXRTeW5jKGRpclBhdGgpO1xuICAgICAgaWYgKG5vdyAtIHN0YXQubXRpbWVNcyA+IG1heEFnZU1zKSB7XG4gICAgICAgIGZzLnJtU3luYyhkaXJQYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XG4gICAgICB9XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBWYW5pc2hlZCBiZXR3ZWVuIHJlYWRkaXIgYW5kIHN0YXQsIG9yIHJlbW92YWwgZmFpbGVkIFx1MjAxNCBza2lwIGl0LiBBXG4gICAgICAvLyBiZXN0LWVmZm9ydCBwcnVuZSBtdXN0IG5ldmVyIHRocm93IGludG8gdGhlIGNhbGxlcidzIGhvdCBwYXRoLlxuICAgIH1cbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIGtpbmQgYW5kIGFuY2hvciBmb3JtYXR0aW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IHR5cGUgVG91Y2hLaW5kID0gJ3JlYWQnIHwgJ3dyaXRlJyB8ICd3aG9sZS1yZWFkJyB8ICd3aG9sZS13cml0ZScgfCAnY3JlYXRlJztcblxuLyoqXG4gKiBGb3JtYXQgYSBzcGFuIGFuY2hvciBzdHJpbmcuXG4gKlxuICogLSBgd2hvbGUtcmVhZGAsIGB3aG9sZS13cml0ZWAsIGFuZCBgY3JlYXRlYDogcmV0dXJucyBqdXN0IHRoZSBwYXRoXG4gKiAtIGByZWFkYCBhbmQgYHdyaXRlYDogcmV0dXJucyBgcGF0aCNMPHN0YXJ0Pi1MPGVuZD5gIChyZXF1aXJlcyByYW5nZSlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEFuY2hvcihwYXRoOiBzdHJpbmcsIGtpbmQ6IFRvdWNoS2luZCwgcmFuZ2U/OiBMaW5lUmFuZ2UpOiBzdHJpbmcge1xuICBpZiAoKGtpbmQgPT09ICdyZWFkJyB8fCBraW5kID09PSAnd3JpdGUnKSAmJiByYW5nZSkge1xuICAgIHJldHVybiBgJHtwYXRofSNMJHtyYW5nZS5zdGFydH0tTCR7cmFuZ2UuZW5kfWA7XG4gIH1cbiAgcmV0dXJuIHBhdGg7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQW5jaG9yIHNwZWMgdHlwZVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgQW5jaG9yU3BlYyB7XG4gIHBhdGg6IHN0cmluZztcbiAga2luZDogVG91Y2hLaW5kO1xuICByYW5nZT86IExpbmVSYW5nZTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBRdWV1ZSBkaXJlY3RvcnkgaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgZ2l0IGNvbW1vbiBkaXJlY3RvcnkgZm9yIHRoZSBnaXZlbiByZXBvIHJvb3QuXG4gKiBUaGlzIGlzIHRoZSBzaGFyZWQgZGlyZWN0b3J5IChub3QgdGhlIHdvcmt0cmVlLXNwZWNpZmljIC5naXQpLCBzbyBxdWV1ZVxuICogcmVjb3JkcyBzdXJ2aXZlIHdvcmt0cmVlIGRlbGV0aW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUdpdENvbW1vbkRpcihyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdyZXYtcGFyc2UnLCAnLS1naXQtY29tbW9uLWRpciddLCB7XG4gICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgZW5jb2Rpbmc6ICd1dGY4J1xuICB9KTtcbiAgY29uc3QgdHJpbW1lZCA9IHRvUG9zaXgob3V0LnRyaW0oKSk7XG4gIC8vIGdpdCByZXR1cm5zIGEgcmVsYXRpdmUgcGF0aCAoZS5nLiBcIi5naXRcIikgZm9yIHNpbXBsZSByZXBvcy4gUmVzb2x2ZSBpdFxuICAvLyBhZ2FpbnN0IHJlcG9Sb290IHNvIGNhbGxlcnMgbmV2ZXIgZGVwZW5kIG9uIHByb2Nlc3MuY3dkKCkuXG4gIGlmICghbm9kZVBhdGguaXNBYnNvbHV0ZSh0cmltbWVkKSkge1xuICAgIHJldHVybiB0b1Bvc2l4KG5vZGVQYXRoLnJlc29sdmUocmVwb1Jvb3QsIHRyaW1tZWQpKTtcbiAgfVxuICByZXR1cm4gdHJpbW1lZDtcbn1cblxuLyoqXG4gKiBSb290IG9mIHRoZSBnaXQtc3BhbiBxdWV1ZSBkaXJlY3RvcnkgdHJlZSwgdW5kZXIgdGhlIGdpdCBjb21tb24gZGlyLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcXVldWVSb290KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihyZXNvbHZlR2l0Q29tbW9uRGlyKHJlcG9Sb290KSwgJ2dpdC1zcGFuJyk7XG59XG5cbi8qKlxuICogRGlyZWN0b3J5IGZvciB0aGUgZ2F0ZSdzIHBlci1jaGFuZ2VzZXQgc3RhdGUgbWVtb3MgKGRpZ2VzdCBvZiBzb3J0ZWRcbiAqIGZpbmRpbmdzICsgdW5jb3ZlcmVkIHBhdGhzKSwgdW5kZXIgdGhlIGdpdCBjb21tb24gZGlyIHNvIGl0IGlzIHNoYXJlZFxuICogYWNyb3NzIHdvcmt0cmVlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdhdGVNZW1vRGlyKHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihxdWV1ZVJvb3QocmVwb1Jvb3QpLCAnZ2F0ZScpO1xufVxuIiwgIi8qKlxuICogUGF0aCBleGNsdXNpb24gbGlzdCBmb3IgdGhlIGdhdGUncyB1bmNvdmVyZWQtd3JpdGVzIGNoZWNrLlxuICpcbiAqIGBldmFsdWF0ZUdhdGVgIGluIHtAbGluayBmaWxlOi8vLi9nYXRlLWNvcmUudHN9IGFscmVhZHkgZXhjbHVkZXMgYC5zcGFuLyoqYFxuICogcGF0aHMgZnJvbSBpdHMgdW5jb3ZlcmVkLXdyaXRlcyBjb21wdXRhdGlvbiB1bmNvbmRpdGlvbmFsbHkgKHNwYW4gcmVwYWlyc1xuICogcmlkZSB0aGUgc2FtZSBjb21taXQgYW5kIG11c3QgbmV2ZXIgc2VsZi10cmlnZ2VyIHRoZSBnYXRlKS4gVGhpcyBtb2R1bGVcbiAqIGFkZHMgYSBzZWNvbmQsIHVzZXItZGVjbGFyZWQgZXhjbHVzaW9uIHNvdXJjZSBvbiB0b3Agb2YgdGhhdDogYSByZXBvIG93bmVyXG4gKiBjYW4gbGlzdCBhZGRpdGlvbmFsIHBhdGhzIHRoZSB1bmNvdmVyZWQtd3JpdGVzIGNoZWNrIHNob3VsZCBuZXZlciBmbGFnIFx1MjAxNFxuICogZ2VuZXJhdGVkIG91dHB1dCwgdmVuZG9yZWQgY29kZSwgYW55dGhpbmcgdGhhdCB3aWxsIG5ldmVyIGdldCBhIHNwYW4uXG4gKlxuICogQ29uZmlnIGxpdmVzIGF0IGA8cmVwb1Jvb3Q+Ly5zcGFuLy5nYXRlaWdub3JlYC4gVW5saWtlXG4gKiB7QGxpbmsgZmlsZTovLy4vc3Bhbi1pZ25vcmUudHN9J3MgYC5zcGFuLy5ob29raWdub3JlYCBcdTIwMTQgd2hpY2ggdGhlIGBnaXQtc3BhbmBcbiAqIFJ1c3QgQ0xJIGF1dG8tY3JlYXRlcyB3aXRoIGNhbm9uaWNhbCBjb250ZW50IFx1MjAxNCBgLmdhdGVpZ25vcmVgIGlzXG4gKiAqKnVzZXItb3duZWQqKjogbm90aGluZyBjcmVhdGVzIG9yIHBvcHVsYXRlcyBpdCwgc28gaXRzIGFic2VuY2UgaXMgdGhlXG4gKiBub3JtYWwsIHVuY29uZmlndXJlZCBzdGF0ZSwgbm90IGEgYnJva2VuIG9uZS5cbiAqXG4gKiBFYWNoIG5vbi1jb21tZW50IGxpbmUgaXMgYSBzaW5nbGUgZ2l0aWdub3JlLXN0eWxlIHBhdGggcGF0dGVybiAobm8gdHJhaWxpbmdcbiAqIHByZWZpeCBsaXN0IFx1MjAxNCBhIGAuZ2F0ZWlnbm9yZWAgbGluZSBlaXRoZXIgZXhjbHVkZXMgYSBwYXRoIGZyb20gdGhlXG4gKiB1bmNvdmVyZWQtd3JpdGVzIGNoZWNrIG9yIGl0IGRvZXNuJ3QsIHVubGlrZSBgLmhvb2tpZ25vcmVgJ3MgcGVyLXNwYW4tc2x1Z1xuICogc3VwcHJlc3Npb24pOlxuICpcbiAqICAgcGFja2FnZXMvYWdlbnQtaG9va3MvZ2VuZXJhdGVkLyoqXG4gKlxuICogUGF0dGVybiBncmFtbWFyIGlzIGlkZW50aWNhbCB0byBgLmhvb2tpZ25vcmVgJ3MgKHNlZSB0aGF0IG1vZHVsZSdzIGRvY1xuICogY29tbWVudCBmb3IgdGhlIGZ1bGwgZ3JhbW1hcikgYW5kIHJldXNlcyBpdHMgY29tcGlsZWQgbWF0Y2hlciB2aWFcbiAqIHtAbGluayBjb21waWxlUGF0dGVybn0gcmF0aGVyIHRoYW4gcmVpbXBsZW1lbnRpbmcgcGF0aCBtYXRjaGluZzpcbiAqXG4gKiAtIEJsYW5rIGxpbmVzIGFuZCBsaW5lcyBiZWdpbm5pbmcgd2l0aCBgI2AgYXJlIHNraXBwZWQuXG4gKiAtIEEgdHJhaWxpbmcgYC9gIHJlc3RyaWN0cyB0aGUgcGF0dGVybiB0byBkaXJlY3Rvcmllcy5cbiAqIC0gQSBwYXR0ZXJuIGNvbnRhaW5pbmcgYSBzbGFzaCBpcyBhbmNob3JlZCB0byB0aGUgcmVwbyByb290OyBhIHBhdHRlcm4gd2l0aFxuICogICBubyBzbGFzaCBtYXRjaGVzIGEgc2luZ2xlIHBhdGggY29tcG9uZW50IGF0IGFueSBkZXB0aC5cbiAqIC0gYCpgIGFuZCBgP2AgbWF0Y2ggd2l0aGluIG9uZSBwYXRoIHNlZ21lbnQ7IGAqKmAgbWF0Y2hlcyBhY3Jvc3Mgc2VnbWVudHMuXG4gKiAtIE5lZ2F0aW9uIChgIWApIGlzIG5vdCBzdXBwb3J0ZWQuXG4gKlxuICogRmFpbC1vcGVuOiBhIG1pc3Npbmcgb3IgdW5yZWFkYWJsZSBgLmdhdGVpZ25vcmVgLCBvciBhIG1hbGZvcm1lZCBsaW5lLFxuICogeWllbGRzIG5vIGFkZGl0aW9uYWwgZXhjbHVzaW9uIFx1MjAxNCB0aGUgdW5jb3ZlcmVkLXdyaXRlcyBjaGVjayBzaW1wbHkgZmFsbHNcbiAqIGJhY2sgdG8gdGhlIGAuc3Bhbi8qKmAtb25seSBleGNsdXNpb24gaXQgYWxyZWFkeSBhcHBsaWVzLlxuICovXG5cbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGNvbXBpbGVQYXR0ZXJuIH0gZnJvbSAnLi9zcGFuLWlnbm9yZS5qcyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgR2F0ZUlnbm9yZVJ1bGUge1xuICAvKiogVGhlIHJhdyBnaXRpZ25vcmUtc3R5bGUgcGF0dGVybiwgcmV0YWluZWQgZm9yIGRpYWdub3N0aWNzLiAqL1xuICBwYXR0ZXJuOiBzdHJpbmc7XG4gIC8qKiBUcnVlIHdoZW4gYHJlcG9SZWxQYXRoYCAoUE9TSVgsIHJlcG8tcmVsYXRpdmUpIGlzIGV4Y2x1ZGVkIGJ5IHRoaXMgcnVsZS4gKi9cbiAgbWF0Y2hlczogKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IGJvb2xlYW47XG59XG5cbmNvbnN0IEdBVEVfSUdOT1JFX1JFTCA9IG5vZGVQYXRoLmpvaW4oJy5zcGFuJywgJy5nYXRlaWdub3JlJyk7XG5cbi8qKiBQYXJzZSBgLmdhdGVpZ25vcmVgIHRleHQgaW50byBydWxlcywgc2tpcHBpbmcgY29tbWVudHMgYW5kIGJsYW5rIGxpbmVzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlR2F0ZUlnbm9yZShjb250ZW50OiBzdHJpbmcpOiBHYXRlSWdub3JlUnVsZVtdIHtcbiAgY29uc3QgcnVsZXM6IEdhdGVJZ25vcmVSdWxlW10gPSBbXTtcbiAgZm9yIChjb25zdCByYXdMaW5lIG9mIGNvbnRlbnQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgcGF0dGVybiA9IHJhd0xpbmUudHJpbSgpO1xuICAgIGlmICghcGF0dGVybiB8fCBwYXR0ZXJuLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgcnVsZXMucHVzaCh7IHBhdHRlcm4sIG1hdGNoZXM6IGNvbXBpbGVQYXR0ZXJuKHBhdHRlcm4pIH0pO1xuICB9XG4gIHJldHVybiBydWxlcztcbn1cblxuLyoqXG4gKiBMb2FkIHRoZSBleGNsdXNpb24gcnVsZXMgZm9yIGEgcmVwby4gRmFpbC1vcGVuOiBhbnkgcmVhZCBmYWlsdXJlIHlpZWxkcyBhblxuICogZW1wdHkgcnVsZSBzZXQsIHNvIGFuIGFic2VudC91bnJlYWRhYmxlIGAuZ2F0ZWlnbm9yZWAgZXhjbHVkZXMgbm90aGluZ1xuICogYmV5b25kIHRoZSBnYXRlJ3MgdW5jb25kaXRpb25hbCBgLnNwYW4vKipgIGV4Y2x1c2lvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxvYWRHYXRlSWdub3JlKHJlcG9Sb290OiBzdHJpbmcpOiBHYXRlSWdub3JlUnVsZVtdIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKG5vZGVQYXRoLmpvaW4ocmVwb1Jvb3QsIEdBVEVfSUdOT1JFX1JFTCksICd1dGY4Jyk7XG4gICAgcmV0dXJuIHBhcnNlR2F0ZUlnbm9yZShjb250ZW50KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG59XG5cbi8qKiBUcnVlIHdoZW4gc29tZSBydWxlIGluIGBydWxlc2AgbWF0Y2hlcyBgcmVwb1JlbFBhdGhgLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzR2F0ZUlnbm9yZWQocnVsZXM6IEdhdGVJZ25vcmVSdWxlW10sIHJlcG9SZWxQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHJ1bGVzLnNvbWUoKHJ1bGUpID0+IHJ1bGUubWF0Y2hlcyhyZXBvUmVsUGF0aCkpO1xufVxuXG4vKiogU2lnbmF0dXJlIGZvciBpbmplY3RpbmcgYSBydWxlIGxvYWRlciAocHJvZHVjdGlvbiBkZWZhdWx0OiB7QGxpbmsgbG9hZEdhdGVJZ25vcmV9KS4gKi9cbmV4cG9ydCB0eXBlIEdhdGVJZ25vcmVMb2FkZXIgPSAocmVwb1Jvb3Q6IHN0cmluZykgPT4gR2F0ZUlnbm9yZVJ1bGVbXTtcbiIsICIvKipcbiAqIFBhdGgtc2NvcGVkIHNwYW4gc3VwcHJlc3Npb24gZm9yIHRoZSBhZ2VudCBob29rcy5cbiAqXG4gKiBTb21lIHNwYW5zIGFyZSBub2lzZSB3aGVuIGJyb3dzaW5nIGNlcnRhaW4gcGFydHMgb2YgdGhlIHRyZWUgXHUyMDE0IHdpa2kgb3JcbiAqIG1hcmtldGluZyBzcGFucyB0aGF0IGFuY2hvciBwcm9zZSwgc3VyZmFjZWQgaW5saW5lIHdoaWxlIHJlYWRpbmcgc291cmNlLFxuICogYWRkIGxpdHRsZS4gVGhpcyBtb2R1bGUgbGV0cyBhIHJlcG8gZGVjbGFyZSwgcGVyIHBhdGgsIHdoaWNoIHNwYW4gc2x1Z1xuICogcHJlZml4ZXMgdG8gaG9sZCBiYWNrLlxuICpcbiAqIENvbmZpZyBsaXZlcyBhdCBgPHJlcG9Sb290Pi8uc3Bhbi8uaG9va2lnbm9yZWAuIEVhY2ggbm9uLWNvbW1lbnQgbGluZSBpcyBhXG4gKiBnaXRpZ25vcmUtc3R5bGUgcGF0aCBwYXR0ZXJuLCBhIHNpbmdsZSBydW4gb2Ygd2hpdGVzcGFjZSwgdGhlbiBhXG4gKiBjb21tYS1zZXBhcmF0ZWQgbGlzdCBvZiBzcGFuIHNsdWcgcHJlZml4ZXMgdG8gc3VwcHJlc3MgZm9yIHBhdGhzIHRoZSBwYXR0ZXJuXG4gKiBtYXRjaGVzOlxuICpcbiAqICAgcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjIHdpa2ksbWFya2V0aW5nXG4gKlxuICogQSBzcGFuIHdob3NlIHNsdWcgYmVnaW5zIHdpdGggYHdpa2lgIG9yIGBtYXJrZXRpbmdgICh0aGUgc2x1ZyBlcXVhbHMgdGhlXG4gKiBwcmVmaXgsIG9yIGlzIGA8cHJlZml4Pi9cdTIwMjZgKSBpcyB0aGVuIG5ldmVyIHN1cmZhY2VkIGZvciBhbiBhbmNob3Igd2hvc2UgcGF0aFxuICogc2l0cyB1bmRlciBgcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjYCBcdTIwMTQgbmVpdGhlciBpbmxpbmUgYnkgdGhlIFByZVRvb2xVc2UgaG9va1xuICogbm9yIGluIHRoZSBTdG9wIGhvb2sncyBzdGFsZSAvIHJlbGF0ZWQgc2VjdGlvbnMuXG4gKlxuICogUGF0dGVybiBncmFtbWFyIGlzIGEgZGVsaWJlcmF0ZSBzdWJzZXQgb2YgZ2l0aWdub3JlOlxuICpcbiAqIC0gQmxhbmsgbGluZXMgYW5kIGxpbmVzIGJlZ2lubmluZyB3aXRoIGAjYCBhcmUgc2tpcHBlZC5cbiAqIC0gQSB0cmFpbGluZyBgL2AgcmVzdHJpY3RzIHRoZSBwYXR0ZXJuIHRvIGRpcmVjdG9yaWVzICh0aGUgbGVhZiBmaWxlIGlzIG5vdFxuICogICBpdHNlbGYgdGVzdGVkLCBvbmx5IGl0cyBhbmNlc3RvciBkaXJlY3RvcmllcykuXG4gKiAtIEEgcGF0dGVybiBjb250YWluaW5nIGEgc2xhc2ggaXMgYW5jaG9yZWQgdG8gdGhlIHJlcG8gcm9vdDsgYSBwYXR0ZXJuIHdpdGhcbiAqICAgbm8gc2xhc2ggbWF0Y2hlcyBhIHNpbmdsZSBwYXRoIGNvbXBvbmVudCBhdCBhbnkgZGVwdGguXG4gKiAtIGAqYCBhbmQgYD9gIG1hdGNoIHdpdGhpbiBvbmUgcGF0aCBzZWdtZW50OyBgKipgIG1hdGNoZXMgYWNyb3NzIHNlZ21lbnRzLlxuICogLSBOZWdhdGlvbiAoYCFgKSBpcyBub3Qgc3VwcG9ydGVkLlxuICpcbiAqIFN1cHByZXNzaW9uIGlzIGZhaWwtb3BlbjogYSBtaXNzaW5nIG9yIHVucmVhZGFibGUgYC5ob29raWdub3JlYCwgb3IgYVxuICogbWFsZm9ybWVkIGxpbmUsIHlpZWxkcyBubyBydWxlIHJhdGhlciB0aGFuIGhpZGluZyBzcGFucyB0aGUgYXV0aG9yIGRpZCBub3RcbiAqIGFzayB0byBoaWRlLlxuICovXG5cbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcblxuZXhwb3J0IGludGVyZmFjZSBJZ25vcmVSdWxlIHtcbiAgLyoqIFRoZSByYXcgZ2l0aWdub3JlLXN0eWxlIHBhdHRlcm4sIHJldGFpbmVkIGZvciBkaWFnbm9zdGljcy4gKi9cbiAgcGF0dGVybjogc3RyaW5nO1xuICAvKiogU3BhbiBzbHVnIHByZWZpeGVzIHN1cHByZXNzZWQgZm9yIHBhdGhzIHRoaXMgcnVsZSBtYXRjaGVzLiAqL1xuICBwcmVmaXhlczogc3RyaW5nW107XG4gIC8qKiBUcnVlIHdoZW4gYHJlcG9SZWxQYXRoYCAoUE9TSVgsIHJlcG8tcmVsYXRpdmUpIGlzIGdvdmVybmVkIGJ5IHRoaXMgcnVsZS4gKi9cbiAgbWF0Y2hlczogKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IGJvb2xlYW47XG59XG5cbmNvbnN0IEhPT0tfSUdOT1JFX1JFTCA9IG5vZGVQYXRoLmpvaW4oJy5zcGFuJywgJy5ob29raWdub3JlJyk7XG5cbi8qKlxuICogVHJhbnNsYXRlIG9uZSBnaXRpZ25vcmUtc3R5bGUgZ2xvYiBzZWdtZW50IGludG8gYW4gYW5jaG9yZWQgUmVnRXhwLiBgKmAgYW5kXG4gKiBgP2Agc3RheSB3aXRoaW4gYSBwYXRoIHNlZ21lbnQ7IGAqKmAgKG9wdGlvbmFsbHkgZm9sbG93ZWQgYnkgYC9gKSBzcGFucyB0aGVtLlxuICovXG5mdW5jdGlvbiBnbG9iVG9SZWdFeHAoZ2xvYjogc3RyaW5nKTogUmVnRXhwIHtcbiAgbGV0IHJlID0gJyc7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgZ2xvYi5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGMgPSBnbG9iW2ldO1xuICAgIGlmIChjID09PSAnKicpIHtcbiAgICAgIGlmIChnbG9iW2kgKyAxXSA9PT0gJyonKSB7XG4gICAgICAgIHJlICs9ICcuKic7XG4gICAgICAgIGkrKztcbiAgICAgICAgLy8gQWJzb3JiIGEgZm9sbG93aW5nIHNsYXNoIHNvIGAqKi9mb29gIGRvZXMgbm90IGRlbWFuZCBhIGxpdGVyYWwgYC9gLlxuICAgICAgICBpZiAoZ2xvYltpICsgMV0gPT09ICcvJykgaSsrO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmUgKz0gJ1teL10qJztcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGMgPT09ICc/Jykge1xuICAgICAgcmUgKz0gJ1teL10nO1xuICAgIH0gZWxzZSB7XG4gICAgICByZSArPSBjLnJlcGxhY2UoL1suK14ke30oKXxbXFxdXFxcXF0vZywgJ1xcXFwkJicpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbmV3IFJlZ0V4cChgXiR7cmV9JGApO1xufVxuXG4vKiogQW5jZXN0b3IgcGF0aCBjaGFpbjogYGEvYi9jLnRzYCBcdTIxOTIgYFsnYScsICdhL2InLCAnYS9iL2MudHMnXWAuICovXG5mdW5jdGlvbiBhbmNlc3RvclBhdGhzKHBhdGg6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgcGFydHMgPSBwYXRoLnNwbGl0KCcvJyk7XG4gIGNvbnN0IG91dDogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIG91dC5wdXNoKHBhcnRzLnNsaWNlKDAsIGkgKyAxKS5qb2luKCcvJykpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKlxuICogQ29tcGlsZSBhIHNpbmdsZSBnaXRpZ25vcmUtc3R5bGUgcGF0dGVybiAodGhpcyBtb2R1bGUncyBncmFtbWFyIFx1MjAxNCBzZWUgdGhlXG4gKiBtb2R1bGUgZG9jIGNvbW1lbnQpIGludG8gYSBwYXRoIHByZWRpY2F0ZS4gQSBwYXR0ZXJuIG1hdGNoZXMgYSBmaWxlIHdoZW4gaXRcbiAqIG1hdGNoZXMgdGhlIGZpbGUncyBwYXRoIG9yIGFueSBhbmNlc3RvciBkaXJlY3Rvcnkgb2YgaXQsIHNvIGEgZGlyZWN0b3J5XG4gKiBwYXR0ZXJuIHN1cHByZXNzZXMgZXZlcnl0aGluZyBiZW5lYXRoIGl0LlxuICpcbiAqIEV4cG9ydGVkIHNvIG90aGVyIHBhdGgtc2NvcGVkIGlnbm9yZS1maWxlIGNvbnZlbnRpb25zIChlLmcuIGAuZ2F0ZWlnbm9yZWBcbiAqIGluIGBnYXRlLWlnbm9yZS50c2ApIGNhbiByZXVzZSB0aGUgZXhhY3QgbWF0Y2hpbmcgc2VtYW50aWNzIHJhdGhlciB0aGFuXG4gKiByZWltcGxlbWVudGluZyB0aGVtLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29tcGlsZVBhdHRlcm4ocGF0dGVybjogc3RyaW5nKTogKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IGJvb2xlYW4ge1xuICBsZXQgcGF0ID0gcGF0dGVybjtcbiAgbGV0IGRpck9ubHkgPSBmYWxzZTtcbiAgaWYgKHBhdC5lbmRzV2l0aCgnLycpKSB7XG4gICAgZGlyT25seSA9IHRydWU7XG4gICAgcGF0ID0gcGF0LnNsaWNlKDAsIC0xKTtcbiAgfVxuICBsZXQgYW5jaG9yZWQgPSBwYXQuaW5jbHVkZXMoJy8nKTtcbiAgaWYgKHBhdC5zdGFydHNXaXRoKCcvJykpIHtcbiAgICBhbmNob3JlZCA9IHRydWU7XG4gICAgcGF0ID0gcGF0LnNsaWNlKDEpO1xuICB9XG4gIGNvbnN0IHJlID0gZ2xvYlRvUmVnRXhwKHBhdCk7XG5cbiAgcmV0dXJuIChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiB7XG4gICAgaWYgKGFuY2hvcmVkKSB7XG4gICAgICBjb25zdCBzZWdzID0gYW5jZXN0b3JQYXRocyhyZXBvUmVsUGF0aCk7XG4gICAgICAvLyBGb3IgYSBkaXItb25seSBwYXR0ZXJuLCBuZXZlciB0ZXN0IHRoZSBsZWFmIGZpbGUgaXRzZWxmLlxuICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IGRpck9ubHkgPyBzZWdzLnNsaWNlKDAsIC0xKSA6IHNlZ3M7XG4gICAgICByZXR1cm4gY2FuZGlkYXRlcy5zb21lKChzKSA9PiByZS50ZXN0KHMpKTtcbiAgICB9XG4gICAgLy8gVW5hbmNob3JlZDogbWF0Y2ggYWdhaW5zdCBpbmRpdmlkdWFsIHBhdGggY29tcG9uZW50cyBhdCBhbnkgZGVwdGguXG4gICAgY29uc3QgY29tcG9uZW50cyA9IHJlcG9SZWxQYXRoLnNwbGl0KCcvJyk7XG4gICAgY29uc3QgY2FuZGlkYXRlcyA9IGRpck9ubHkgPyBjb21wb25lbnRzLnNsaWNlKDAsIC0xKSA6IGNvbXBvbmVudHM7XG4gICAgcmV0dXJuIGNhbmRpZGF0ZXMuc29tZSgoYykgPT4gcmUudGVzdChjKSk7XG4gIH07XG59XG5cbi8qKiBQYXJzZSBgLmhvb2tpZ25vcmVgIHRleHQgaW50byBydWxlcywgc2tpcHBpbmcgY29tbWVudHMgYW5kIG1hbGZvcm1lZCBsaW5lcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUhvb2tJZ25vcmUoY29udGVudDogc3RyaW5nKTogSWdub3JlUnVsZVtdIHtcbiAgY29uc3QgcnVsZXM6IElnbm9yZVJ1bGVbXSA9IFtdO1xuICBmb3IgKGNvbnN0IHJhd0xpbmUgb2YgY29udGVudC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCBsaW5lID0gcmF3TGluZS50cmltKCk7XG4gICAgaWYgKCFsaW5lIHx8IGxpbmUuc3RhcnRzV2l0aCgnIycpKSBjb250aW51ZTtcbiAgICAvLyBgPHBhdHRlcm4+PHdoaXRlc3BhY2U+PHByZWZpeGVzPmAgXHUyMDE0IHBhdHRlcm4gaXMgdGhlIGZpcnN0IHRva2VuLCBwcmVmaXhlc1xuICAgIC8vIHRoZSBzZWNvbmQuIEEgbGluZSB3aXRob3V0IGJvdGggaXMgbWFsZm9ybWVkIGFuZCBza2lwcGVkLlxuICAgIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXihcXFMrKVxccysoXFxTKykkLyk7XG4gICAgaWYgKCFtYXRjaCkgY29udGludWU7XG4gICAgY29uc3QgWywgcGF0dGVybiwgcHJlZml4ZXNSYXddID0gbWF0Y2g7XG4gICAgY29uc3QgcHJlZml4ZXMgPSBwcmVmaXhlc1Jhd1xuICAgICAgLnNwbGl0KCcsJylcbiAgICAgIC5tYXAoKHApID0+IHAudHJpbSgpKVxuICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgICBpZiAocHJlZml4ZXMubGVuZ3RoID09PSAwKSBjb250aW51ZTtcbiAgICBydWxlcy5wdXNoKHsgcGF0dGVybiwgcHJlZml4ZXMsIG1hdGNoZXM6IGNvbXBpbGVQYXR0ZXJuKHBhdHRlcm4pIH0pO1xuICB9XG4gIHJldHVybiBydWxlcztcbn1cblxuLyoqXG4gKiBMb2FkIHRoZSBzdXBwcmVzc2lvbiBydWxlcyBmb3IgYSByZXBvLiBGYWlsLW9wZW46IGFueSByZWFkIG9yIHBhcnNlIGZhaWx1cmVcbiAqIHlpZWxkcyBhbiBlbXB0eSBydWxlIHNldCwgc28gc3BhbnMgc3VyZmFjZSBhcyBub3JtYWwgd2hlbiBubyBjb25maWcgZXhpc3RzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbG9hZEhvb2tJZ25vcmUocmVwb1Jvb3Q6IHN0cmluZyk6IElnbm9yZVJ1bGVbXSB7XG4gIHRyeSB7XG4gICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhub2RlUGF0aC5qb2luKHJlcG9Sb290LCBIT09LX0lHTk9SRV9SRUwpLCAndXRmOCcpO1xuICAgIHJldHVybiBwYXJzZUhvb2tJZ25vcmUoY29udGVudCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBbXTtcbiAgfVxufVxuXG4vKiogQSBzbHVnIGNhcnJpZXMgYSBwcmVmaXggd2hlbiBpdCBlcXVhbHMgdGhlIHByZWZpeCBvciBpcyBgPHByZWZpeD4vXHUyMDI2YC4gKi9cbmZ1bmN0aW9uIHNsdWdIYXNQcmVmaXgoc2x1Zzogc3RyaW5nLCBwcmVmaXg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gc2x1ZyA9PT0gcHJlZml4IHx8IHNsdWcuc3RhcnRzV2l0aChgJHtwcmVmaXh9L2ApO1xufVxuXG4vKipcbiAqIFRydWUgd2hlbiBhIHNwYW4gYHNsdWdgIHNob3VsZCBiZSBzdXBwcmVzc2VkIGZvciBhbiBhbmNob3IgYXQgYHJlcG9SZWxQYXRoYDpcbiAqIHNvbWUgcnVsZSBtYXRjaGVzIHRoZSBwYXRoIGFuZCBsaXN0cyBhIHByZWZpeCB0aGUgc2x1ZyBjYXJyaWVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNTcGFuU3VwcHJlc3NlZChydWxlczogSWdub3JlUnVsZVtdLCByZXBvUmVsUGF0aDogc3RyaW5nLCBzbHVnOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgZm9yIChjb25zdCBydWxlIG9mIHJ1bGVzKSB7XG4gICAgaWYgKCFydWxlLm1hdGNoZXMocmVwb1JlbFBhdGgpKSBjb250aW51ZTtcbiAgICBpZiAocnVsZS5wcmVmaXhlcy5zb21lKChwKSA9PiBzbHVnSGFzUHJlZml4KHNsdWcsIHApKSkgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKiogU2lnbmF0dXJlIGZvciBpbmplY3RpbmcgYSBydWxlIGxvYWRlciAocHJvZHVjdGlvbiBkZWZhdWx0OiB7QGxpbmsgbG9hZEhvb2tJZ25vcmV9KS4gKi9cbmV4cG9ydCB0eXBlIEhvb2tJZ25vcmVMb2FkZXIgPSAocmVwb1Jvb3Q6IHN0cmluZykgPT4gSWdub3JlUnVsZVtdO1xuIiwgIi8qKlxuICogQ29kZXggUHJlVG9vbFVzZSBnYXRlIGhvb2sgXHUyMDE0IGhvbGQgYGdpdCBjb21taXRgL2BnaXQgcHVzaGAgb24gcmVhbCBzcGFuIGRlYnQuXG4gKlxuICogVGhlIENvZGV4IHR3aW4gb2YgW2NsYXVkZS9nYXRlLnRzXSguL3BhY2thZ2VzL2FnZW50LWhvb2tzL3NyYy9jbGF1ZGUvZ2F0ZS50cyk6XG4gKiBzYW1lIHNoYXJlZCBnYXRlLWNvcmUgcGlwZWxpbmUgKHtAbGluayBwYXJzZUdpdENvbW1hbmR9IFx1MjE5MiB7QGxpbmsgcmVzb2x2ZUNoYW5nZXNldH1cbiAqIFx1MjE5MiB7QGxpbmsgZXZhbHVhdGVHYXRlfSksIHRyYW5zbGF0ZWQgaW50byBDb2RleCdzIFByZVRvb2xVc2Ugb3V0cHV0IHNoYXBlLiBDb2RleFxuICogZGVsaXZlcnMgYSBzaGVsbCBjb21tYW5kIGFzIGFuIFNESy10eXBlZCBgdW5rbm93bmAgYHRvb2xfaW5wdXRgOyB0aGlzIGhhbmRsZXJcbiAqIG5hcnJvd3MgaXQgKHN0cmluZywgb3IgYSBgW1wiYmFzaFwiLFwiLWxjXCIsXCI8c2NyaXB0PlwiXWAvYXJndiBhcnJheSkgaW50byB0aGVcbiAqIGNvbW1hbmQgc3RyaW5nIHRoZSBjb3JlIHBhcnNlcy5cbiAqXG4gKiBcdTI1MDBcdTI1MDAgVW5jb25maXJtZWQgZGVueSAoc2VlIG5vdGVzL2NvZGV4LWRlbnktc3Bpa2UubWQpIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICogV2hldGhlciBDb2RleCdzIGBwZXJtaXNzaW9uRGVjaXNpb246ICdkZW55J2AgYWN0dWFsbHkgKmJsb2NrcyogdGhlIHNoZWxsIHRvb2xcbiAqIGxpdmUgd2FzIG5ldmVyIGNvbmZpcm1lZCBpbiB0aGlzIHJlcG86IHRoZSBQaGFzZSAwIHNwaWtlIGNvdWxkIG5vdCBnZXQgYVxuICogZnJvbS1zY3JhdGNoIHBsdWdpbiB0byBsb2FkLCBzbyB0aGUgZGVueSBwYXRoIHdhcyBuZXZlciBleGVyY2lzZWQgZW5kLXRvLWVuZC5cbiAqIFRoZSBvbmx5IHBvc2l0aXZlIGV2aWRlbmNlIGlzIGRvY3VtZW50YXJ5IFx1MjAxNCB0aGUgYEBnb29kZm9vdC9jb2RleC1ob29rc2AgUkVBRE1FXG4gKiAodGhlIGV4YWN0IHZlcnNpb24gdGhpcyByZXBvIGRlcGVuZHMgb24pIHNoaXBzIGEgd29ya2VkIGBwZXJtaXNzaW9uRGVjaXNpb246XG4gKiAnZGVueSdgIGV4YW1wbGUgbWF0Y2hlZCBvbiBgXCJCYXNoXCJgLiBUaGlzIGFkYXB0ZXIgdGhlcmVmb3JlIHNoaXBzIHRoZSBoYXJkLWRlbnlcbiAqIHBhdGggcGVyIHRoYXQgUkVBRE1FICh7QGxpbmsgQ09ERVhfR0FURV9IQVJEX0RFTll9ID0gYHRydWVgKSwgYnV0IGtlZXBzIHRoZVxuICogQ0FSRC5tZC1kb2N1bWVudGVkIGZhbGxiYWNrIFx1MjAxNCBhIGxvdWQgYGFkZGl0aW9uYWxDb250ZXh0YCB3YXJuaW5nIHRoYXQgYWxsb3dzXG4gKiB0aGUgY29tbWFuZCwgd2l0aCB0aGUgQ0kgcmVjaXBlIGFzIENvZGV4J3MgZW5mb3JjZW1lbnQgYmFja3N0b3AgXHUyMDE0IGFzIGEgY2xlYXJseVxuICogc2VwYXJhYmxlIGJyYW5jaCBiZWhpbmQgdGhhdCBvbmUgY29uc3RhbnQuIElmIGEgbGl2ZSBzZXNzaW9uIHNob3dzIGRlbnkgZG9lc1xuICogbm90IGZpcmUsIGZsaXAge0BsaW5rIENPREVYX0dBVEVfSEFSRF9ERU5ZfSB0byBgZmFsc2VgOyBub3RoaW5nIGVsc2UgY2hhbmdlcy5cbiAqXG4gKiBUaGUgc2hlbGwgdG9vbCdzIGV4YWN0IGB0b29sX25hbWVgIGlzIGxpa2V3aXNlIHVuY29uZmlybWVkICh0aGUgUkVBRE1FJ3NcbiAqIGV4YW1wbGUgdXNlcyBgXCJCYXNoXCJgOyBDb2RleCBDTEkgdHJhbnNjcmlwdHMgaW4gdGhlIHNwaWtlIGxhYmVsZWQgdGhlIGNhbGxcbiAqIGBleGVjYCkuIFRoZSByZWdpc3RyYXRpb24gbWF0Y2hlciBpcyBicm9hZGVuZWQgdG8gdGhlIHBsYXVzaWJsZSBuYW1lcyBzbyB0aGVcbiAqIGhvb2sgYWN0dWFsbHkgZmlyZXMsIGFuZCBldmVyeSBmaXJlIGxvZ3MgdGhlIG9ic2VydmVkIGB0b29sX25hbWVgIHNvIHRoZSBmaXJzdFxuICogbGl2ZSBydW4gcmV2ZWFscyB0aGUgbGl0ZXJhbCBzdHJpbmcgdG8gbmFycm93IHRoZSBtYXRjaGVyIHRvLlxuICpcbiAqIEZhaWwtb3BlbiBhdCBldmVyeSBsYXllcjogZ2F0ZS1jb3JlIHJlc29sdmVzIGludGVybmFsIGVycm9ycyB0byBhbGxvdywgYW5kIHRoaXNcbiAqIGFkYXB0ZXIgd3JhcHMgdGhlIHdob2xlIHBhdGggaW4gYSB0cnkvY2F0Y2ggdGhhdCBhbGxvd3MtYW5kLWxvZ3MgXHUyMDE0IHRoZSBnYXRlXG4gKiBtdXN0IG5ldmVyIGJyaWNrIGEgY29tbWl0LiBUaGUgdGltZW91dCBpcyBtaWxsaXNlY29uZHMgaGVyZSAodGhlIENvZGV4IENMSVxuICogZGl2aWRlcyB0byBzZWNvbmRzIGF0IGVtaXQpLlxuICovXG5cbmltcG9ydCB7IHR5cGUgSG9va0NvbnRleHQsIHR5cGUgUHJlVG9vbFVzZUlucHV0LCBwcmVUb29sVXNlSG9vaywgcHJlVG9vbFVzZU91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jb2RleC1ob29rcyc7XG5pbXBvcnQge1xuICBjb21taXRTdGFnZXNBbGwsXG4gIGNyZWF0ZURlZmF1bHRHYXRlRXhlY3V0b3JzLFxuICBjcmVhdGVEZWZhdWx0R2l0RXhlY3V0b3IsXG4gIGNyZWF0ZURpc2tHYXRlTWVtb1N0YXRlLFxuICBldmFsdWF0ZUdhdGUsXG4gIHR5cGUgR2F0ZUV4ZWN1dG9ycyxcbiAgdHlwZSBHYXRlTWVtb1N0YXRlLFxuICB0eXBlIEdpdEV4ZWN1dG9yLFxuICBwYXJzZUdpdENvbW1hbmQsXG4gIHJlc29sdmVDaGFuZ2VzZXRcbn0gZnJvbSAnLi4vY29tbW9uL2dhdGUtY29yZS5qcyc7XG5cbi8qKlxuICogV2hldGhlciBDb2RleCdzIGBwZXJtaXNzaW9uRGVjaXNpb246ICdkZW55J2AgaXMgdHJ1c3RlZCB0byBibG9jayB0aGUgc2hlbGwgdG9vbFxuICogbGl2ZS4gU2hpcHMgYHRydWVgIChoYXJkIGRlbnkpIHBlciB0aGUgYEBnb29kZm9vdC9jb2RleC1ob29rc2AgUkVBRE1FJ3Mgd29ya2VkXG4gKiBleGFtcGxlLiBGbGlwIHRvIGBmYWxzZWAgdG8gYWN0aXZhdGUgdGhlIENBUkQubWQtZG9jdW1lbnRlZCBmYWxsYmFjayBpZiBhIGxpdmVcbiAqIHNlc3Npb24gc2hvd3MgZGVueSBkb2VzIG5vdCBmaXJlIFx1MjAxNCBzZWUgbm90ZXMvY29kZXgtZGVueS1zcGlrZS5tZCBhbmQgdGhpc1xuICogZmlsZSdzIGhlYWRlci4gVGhpcyBpcyB0aGUgc2luZ2xlIHN3aXRjaCB0aGF0IHNlcGFyYXRlcyB0aGUgdHdvIGNvZGUgcGF0aHMuXG4gKi9cbmNvbnN0IENPREVYX0dBVEVfSEFSRF9ERU5ZID0gdHJ1ZTtcblxuLyoqXG4gKiBOYXJyb3cgQ29kZXgncyBgdW5rbm93bmAgc2hlbGwgYHRvb2xfaW5wdXRgIGludG8gdGhlIGNvbW1hbmQgc3RyaW5nIHRoZSBjb3JlXG4gKiBwYXJzZXMuIEhhbmRsZXMgYSBiYXJlIGBjb21tYW5kYCBzdHJpbmcsIGEgc2hlbGwtd3JhcHBlciBhcmd2XG4gKiAoYFtcImJhc2hcIixcIi1sY1wiLFwiPHNjcmlwdD5cIl1gIFx1MjE5MiB0aGUgc2NyaXB0IGFmdGVyIGAtY2AvYC1sY2ApLCBhbmQgYSBkaXJlY3QgYXJndlxuICogKGBbXCJnaXRcIixcImNvbW1pdFwiLFx1MjAyNl1gIFx1MjE5MiBzcGFjZS1qb2luZWQpLiBSZXR1cm5zIGBudWxsYCB3aGVuIG5vIGNvbW1hbmQgdGV4dCBpc1xuICogcmVjb3ZlcmFibGUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0U2hlbGxDb21tYW5kKHRvb2xJbnB1dDogdW5rbm93bik6IHN0cmluZyB8IG51bGwge1xuICBpZiAodG9vbElucHV0ID09PSBudWxsIHx8IHR5cGVvZiB0b29sSW5wdXQgIT09ICdvYmplY3QnIHx8ICEoJ2NvbW1hbmQnIGluIHRvb2xJbnB1dCkpIHJldHVybiBudWxsO1xuICBjb25zdCBjb21tYW5kID0gKHRvb2xJbnB1dCBhcyB7IGNvbW1hbmQ6IHVua25vd24gfSkuY29tbWFuZDtcbiAgaWYgKHR5cGVvZiBjb21tYW5kID09PSAnc3RyaW5nJykgcmV0dXJuIGNvbW1hbmQubGVuZ3RoID4gMCA/IGNvbW1hbmQgOiBudWxsO1xuICBpZiAoQXJyYXkuaXNBcnJheShjb21tYW5kKSkge1xuICAgIGNvbnN0IHBhcnRzID0gY29tbWFuZC5maWx0ZXIoKHApOiBwIGlzIHN0cmluZyA9PiB0eXBlb2YgcCA9PT0gJ3N0cmluZycpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGZsYWdJZHggPSBwYXJ0cy5maW5kSW5kZXgoKHApID0+IHAgPT09ICctYycgfHwgcCA9PT0gJy1sYycgfHwgcCA9PT0gJy1pYycpO1xuICAgIGlmIChmbGFnSWR4ID49IDAgJiYgcGFydHNbZmxhZ0lkeCArIDFdICE9PSB1bmRlZmluZWQpIHJldHVybiBwYXJ0c1tmbGFnSWR4ICsgMV07XG4gICAgcmV0dXJuIHBhcnRzLmpvaW4oJyAnKTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUhhbmRsZXIoXG4gIGdpdDogR2l0RXhlY3V0b3IgPSBjcmVhdGVEZWZhdWx0R2l0RXhlY3V0b3IoKSxcbiAgZXhlY3V0b3JzOiBHYXRlRXhlY3V0b3JzID0gY3JlYXRlRGVmYXVsdEdhdGVFeGVjdXRvcnMoKSxcbiAgbWVtb0ZhY3Rvcnk6IChjd2Q6IHN0cmluZykgPT4gR2F0ZU1lbW9TdGF0ZSA9IGNyZWF0ZURpc2tHYXRlTWVtb1N0YXRlLFxuICAvLyBUaGUgaGFyZC1kZW55IHN3aXRjaCBpcyBhIHBhcmFtZXRlciAoZGVmYXVsdGluZyB0byB0aGUgc2hpcHBlZCBjb25zdGFudCkgc29cbiAgLy8gdGhlIGRvY3VtZW50ZWQgZmFsbGJhY2sgYnJhbmNoIGlzIGRpcmVjdGx5IGV4ZXJjaXNhYmxlIGluIHRlc3RzIHdpdGhvdXRcbiAgLy8gbXV0YXRpbmcgYSBtb2R1bGUtbGV2ZWwgY29uc3QuIFByb2R1Y3Rpb24gd2lyaW5nIG5ldmVyIHBhc3NlcyB0aGlzIFx1MjAxNCB0aGVcbiAgLy8gZGVmYXVsdCBleHBvcnQgYmVsb3cgY29uc3RydWN0cyB0aGUgaGFuZGxlciB3aXRoIHRoZSBjb25zdGFudCdzIHZhbHVlLlxuICBoYXJkRGVueTogYm9vbGVhbiA9IENPREVYX0dBVEVfSEFSRF9ERU5ZXG4pIHtcbiAgcmV0dXJuIGFzeW5jIChpbnB1dDogUHJlVG9vbFVzZUlucHV0LCBjdHg6IEhvb2tDb250ZXh0KSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIExvZyB0aGUgb2JzZXJ2ZWQgc2hlbGwgdG9vbF9uYW1lIHNvIHRoZSBmaXJzdCBsaXZlIHJ1biByZXZlYWxzIHRoZSBsaXRlcmFsXG4gICAgICAvLyBzdHJpbmcgdG8gbmFycm93IHRoZSBtYXRjaGVyIHRvICh0aGUgc3Bpa2UgbmV2ZXIgY29uZmlybWVkIGl0IGVtcGlyaWNhbGx5KS5cbiAgICAgIGN0eC5sb2dnZXIuaW5mbygnZ2l0LXNwYW4gZ2F0ZSBvYnNlcnZlZCBzaGVsbCB0b29sJywgeyB0b29sX25hbWU6IGlucHV0LnRvb2xfbmFtZSB9KTtcblxuICAgICAgY29uc3QgY29tbWFuZCA9IGV4dHJhY3RTaGVsbENvbW1hbmQoaW5wdXQudG9vbF9pbnB1dCk7XG4gICAgICBpZiAoY29tbWFuZCA9PT0gbnVsbCkgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoe30pO1xuXG4gICAgICBjb25zdCBwYXJzZWQgPSBwYXJzZUdpdENvbW1hbmQoY29tbWFuZCk7XG4gICAgICBpZiAocGFyc2VkLmtpbmQgPT09ICdub25lJykgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoe30pO1xuXG4gICAgICBjb25zdCBjd2QgPSBpbnB1dC5jd2QgPz8gJyc7XG4gICAgICBjb25zdCBhbGwgPSBwYXJzZWQua2luZCA9PT0gJ2NvbW1pdCcgPyBjb21taXRTdGFnZXNBbGwoY29tbWFuZCkgOiBmYWxzZTtcbiAgICAgIGNvbnN0IGNoYW5nZXNldCA9IGF3YWl0IHJlc29sdmVDaGFuZ2VzZXQocGFyc2VkLmtpbmQsIGFsbCwgY3dkLCBnaXQsIHBhcnNlZC5wYXRocyk7XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGV2YWx1YXRlR2F0ZShjaGFuZ2VzZXQsIGN3ZCwgZXhlY3V0b3JzLCBtZW1vRmFjdG9yeShjd2QpKTtcbiAgICAgIGlmIChyZXN1bHQuZGVjaXNpb24gIT09ICdkZW55Jykge1xuICAgICAgICAvLyBFbnZpcm9ubWVudGFsIHN0YWxlbmVzcyBhbmQgYSBmYWlsZWQgc3RhbGVuZXNzIHNjYW4gYm90aCBhbGxvd1xuICAgICAgICAvLyAoZmFpbC1vcGVuKSBidXQgbXVzdCBub3QgYmUgc3dhbGxvd2VkOiBsb2cgYW5kIHN1cmZhY2UgdGhlIHJlYXNvbiBhc1xuICAgICAgICAvLyBhZGRpdGlvbmFsIGNvbnRleHQuXG4gICAgICAgIGlmIChyZXN1bHQua2luZCA9PT0gJ2Vudmlyb25tZW50YWwnIHx8IHJlc3VsdC5raW5kID09PSAnc2Nhbi1mYWlsZWQnKSB7XG4gICAgICAgICAgY3R4LmxvZ2dlci53YXJuKCdnaXQtc3BhbiBnYXRlIGFsbG93ZWQgd2l0aCBhbiB1bnJlc29sdmVkIGNvbmRpdGlvbicsIHsgcmVhc29uOiByZXN1bHQucmVhc29uIH0pO1xuICAgICAgICAgIHJldHVybiBwcmVUb29sVXNlT3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IHJlc3VsdC5yZWFzb24sIHN5c3RlbU1lc3NhZ2U6IHJlc3VsdC5yZWFzb24gfSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoe30pO1xuICAgICAgfVxuXG4gICAgICBpZiAoaGFyZERlbnkpIHtcbiAgICAgICAgLy8gUHJpbWFyeSBwYXRoIChwZXIgdGhlIFJFQURNRSk6IGFjdHVhbGx5IGJsb2NrIHRoZSBjb21tYW5kLlxuICAgICAgICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7XG4gICAgICAgICAgcGVybWlzc2lvbkRlY2lzaW9uOiAnZGVueScsXG4gICAgICAgICAgcGVybWlzc2lvbkRlY2lzaW9uUmVhc29uOiByZXN1bHQucmVhc29uLFxuICAgICAgICAgIHN5c3RlbU1lc3NhZ2U6IHJlc3VsdC5yZWFzb25cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICAvLyBGYWxsYmFjayBwYXRoIChDQVJELm1kIGNvbnRpbmdlbmN5KTogY2Fubm90IGJsb2NrLCBzbyBzdXJmYWNlIHRoZSBzYW1lXG4gICAgICAvLyBjaGVja2xpc3QgYXMgYSBsb3VkIHdhcm5pbmcgYW5kIGFsbG93IFx1MjAxNCB0aGUgQ0kgcmVjaXBlIGVuZm9yY2VzIGZvciBDb2RleC5cbiAgICAgIGNvbnN0IHdhcm5pbmcgPSBgZ2l0LXNwYW4gZ2F0ZSBjb3VsZCBub3QgYmxvY2sgdGhpcyBjb21tYW5kOyBzcGFuIGRlYnQgcmVtYWluczpcXG4ke3Jlc3VsdC5yZWFzb259YDtcbiAgICAgIHJldHVybiBwcmVUb29sVXNlT3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IHdhcm5pbmcsIHN5c3RlbU1lc3NhZ2U6IHdhcm5pbmcgfSk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjdHgubG9nZ2VyLndhcm4oJ2dpdC1zcGFuIGdhdGUgZmFpbGVkIG9wZW4gb24gYW4gdW5jYXVnaHQgZXJyb3InLCB7IGVyciB9KTtcbiAgICAgIHJldHVybiBwcmVUb29sVXNlT3V0cHV0KHt9KTtcbiAgICB9XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IHByZVRvb2xVc2VIb29rKHsgbWF0Y2hlcjogJ0Jhc2h8c2hlbGx8ZXhlY3xsb2NhbF9zaGVsbCcsIHRpbWVvdXQ6IDEwXzAwMCB9LCBjcmVhdGVIYW5kbGVyKCkpO1xuIiwgImltcG9ydCBob29rIGZyb20gXCIuL2dhdGUudHNcIjtcbmltcG9ydCB7IGV4ZWN1dGUgfSBmcm9tIFwiLi4vLi4vLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L3J1bnRpbWUuanNcIjtcbmV4ZWN1dGUoaG9vayk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBNEJPLElBQU0sMEJBQTBCLG9CQUFJLElBQUksQ0FBQyxnQkFBZ0Isb0JBQW9CLGVBQWUsQ0FBQzs7O0FDNUJwRyxTQUFTLGVBQWUsZUFBZSxRQUFRLFNBQVM7QUFDcEQsUUFBTSxPQUFPO0FBQ2IsT0FBSyxnQkFBZ0I7QUFDckIsT0FBSyxVQUFVLE9BQU87QUFDdEIsT0FBSyxnQkFBZ0IsT0FBTztBQUM1QixNQUFJLGFBQWEsVUFBVSxPQUFPLE9BQU8sWUFBWSxVQUFVO0FBQzNELFNBQUssVUFBVSxPQUFPO0FBQUEsRUFDMUI7QUFDQSxTQUFPO0FBQ1g7QUFDTyxTQUFTLGVBQWUsUUFBUSxTQUFTO0FBQzVDLFNBQU8sZUFBZSxjQUFjLFFBQVEsT0FBTztBQUN2RDs7O0FDWkEsU0FBUyxXQUFXLFlBQVksV0FBVyxVQUFVLGlCQUFpQjtBQUN0RSxTQUFTLGVBQWU7QUFDeEIsSUFBTSxzQkFBc0I7QUFDckIsSUFBTSxTQUFOLE1BQWE7QUFBQSxFQUNoQixXQUFXLG9CQUFJLElBQUk7QUFBQSxFQUNuQixrQkFBa0I7QUFBQSxFQUNsQixZQUFZO0FBQUEsRUFDWixjQUFjO0FBQUEsRUFDZDtBQUFBLEVBQ0E7QUFBQSxFQUNBLFlBQVksU0FBUyxDQUFDLEdBQUc7QUFDckIsU0FBSyxjQUFjLE9BQU8sZUFBZSxRQUFRLElBQUksT0FBTyxhQUFhLG1CQUFtQixLQUFLO0FBQUEsRUFDckc7QUFBQSxFQUNBLFdBQVcsVUFBVSxPQUFPO0FBQ3hCLFNBQUssa0JBQWtCO0FBQ3ZCLFNBQUssZUFBZTtBQUFBLEVBQ3hCO0FBQUEsRUFDQSxlQUFlO0FBQ1gsU0FBSyxrQkFBa0I7QUFDdkIsU0FBSyxlQUFlO0FBQUEsRUFDeEI7QUFBQSxFQUNBLEdBQUcsT0FBTyxTQUFTO0FBQ2YsVUFBTSxXQUFXLEtBQUssU0FBUyxJQUFJLEtBQUssS0FBSyxvQkFBSSxJQUFJO0FBQ3JELGFBQVMsSUFBSSxPQUFPO0FBQ3BCLFNBQUssU0FBUyxJQUFJLE9BQU8sUUFBUTtBQUNqQyxXQUFPLE1BQU07QUFDVCxlQUFTLE9BQU8sT0FBTztBQUN2QixVQUFJLFNBQVMsU0FBUyxHQUFHO0FBQ3JCLGFBQUssU0FBUyxPQUFPLEtBQUs7QUFBQSxNQUM5QjtBQUFBLElBQ0o7QUFBQSxFQUNKO0FBQUEsRUFDQSxNQUFNLFNBQVMsU0FBUztBQUNwQixTQUFLLEtBQUssU0FBUyxTQUFTLE9BQU87QUFBQSxFQUN2QztBQUFBLEVBQ0EsS0FBSyxTQUFTLFNBQVM7QUFDbkIsU0FBSyxLQUFLLFFBQVEsU0FBUyxPQUFPO0FBQUEsRUFDdEM7QUFBQSxFQUNBLEtBQUssU0FBUyxTQUFTO0FBQ25CLFNBQUssS0FBSyxRQUFRLFNBQVMsT0FBTztBQUFBLEVBQ3RDO0FBQUEsRUFDQSxNQUFNLFNBQVMsU0FBUztBQUNwQixTQUFLLEtBQUssU0FBUyxTQUFTLE9BQU87QUFBQSxFQUN2QztBQUFBLEVBQ0EsU0FBUyxPQUFPLFNBQVMsU0FBUztBQUM5QixTQUFLLEtBQUssU0FBUyxHQUFHLE9BQU8sS0FBSyxpQkFBaUIsUUFBUSxNQUFNLFVBQVUsT0FBTyxLQUFLLENBQUMsSUFBSSxPQUFPO0FBQUEsRUFDdkc7QUFBQSxFQUNBLFFBQVE7QUFDSixRQUFJLEtBQUssY0FBYyxNQUFNO0FBQ3pCLGdCQUFVLEtBQUssU0FBUztBQUN4QixXQUFLLFlBQVk7QUFBQSxJQUNyQjtBQUFBLEVBQ0o7QUFBQSxFQUNBLEtBQUssT0FBTyxTQUFTLFNBQVM7QUFDMUIsVUFBTSxRQUFRO0FBQUEsTUFDVixZQUFXLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQUEsTUFDbEM7QUFBQSxNQUNBLFVBQVUsS0FBSztBQUFBLE1BQ2Y7QUFBQSxNQUNBLEdBQUksS0FBSyxpQkFBaUIsU0FBWSxFQUFFLE9BQU8sS0FBSyxhQUFhLElBQUksQ0FBQztBQUFBLE1BQ3RFLEdBQUksWUFBWSxTQUFZLEVBQUUsUUFBUSxJQUFJLENBQUM7QUFBQSxJQUMvQztBQUNBLFNBQUssWUFBWSxLQUFLO0FBQ3RCLFNBQUssU0FBUyxJQUFJLEtBQUssR0FBRyxRQUFRLENBQUMsWUFBWTtBQUMzQyxjQUFRLEtBQUs7QUFBQSxJQUNqQixDQUFDO0FBQUEsRUFDTDtBQUFBLEVBQ0EsWUFBWSxPQUFPO0FBQ2YsUUFBSSxLQUFLLGdCQUFnQixNQUFNO0FBQzNCO0FBQUEsSUFDSjtBQUNBLFFBQUksQ0FBQyxLQUFLLGlCQUFpQjtBQUN2QixXQUFLLGtCQUFrQjtBQUN2QixZQUFNLFNBQVMsUUFBUSxLQUFLLFdBQVc7QUFDdkMsVUFBSSxDQUFDLFdBQVcsTUFBTSxHQUFHO0FBQ3JCLGtCQUFVLFFBQVEsRUFBRSxXQUFXLEtBQUssQ0FBQztBQUFBLE1BQ3pDO0FBQ0EsV0FBSyxZQUFZLFNBQVMsS0FBSyxhQUFhLEdBQUc7QUFBQSxJQUNuRDtBQUNBLFFBQUksS0FBSyxjQUFjLE1BQU07QUFDekIsZ0JBQVUsS0FBSyxXQUFXLEdBQUcsS0FBSyxVQUFVLEtBQUssQ0FBQztBQUFBLENBQUk7QUFBQSxJQUMxRDtBQUFBLEVBQ0o7QUFDSjtBQUNPLElBQU0sU0FBUyxJQUFJLE9BQU87OztBQ3BGMUIsSUFBTSxhQUFhO0FBQUEsRUFDdEIsU0FBUztBQUFBLEVBQ1QsT0FBTztBQUFBLEVBQ1AsT0FBTztBQUNYO0FBQ08sSUFBTSxhQUFOLGNBQXlCLE1BQU07QUFBQSxFQUNsQztBQUFBLEVBQ0EsWUFBWSxRQUFRO0FBQ2hCLFVBQU0sTUFBTTtBQUNaLFNBQUssT0FBTztBQUNaLFNBQUssU0FBUztBQUFBLEVBQ2xCO0FBQ0o7QUFDQSxTQUFTLGNBQWMsT0FBTztBQUMxQixTQUFPLE9BQU8sWUFBWSxPQUFPLFFBQVEsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDLEVBQUUsS0FBSyxNQUFNLFVBQVUsTUFBUyxDQUFDO0FBQzlGO0FBQ0EsU0FBUyxZQUFZLE1BQU0sUUFBUSxRQUFRO0FBQ3ZDLFNBQU87QUFBQSxJQUNILE9BQU87QUFBQSxJQUNQLFFBQVEsY0FBYyxNQUFNO0FBQUEsSUFDNUIsR0FBSSxXQUFXLFNBQVksRUFBRSxPQUFPLElBQUksQ0FBQztBQUFBLEVBQzdDO0FBQ0o7QUFJTyxTQUFTLGlCQUFpQixVQUFVLENBQUMsR0FBRztBQUMzQyxRQUFNLGNBQWMsUUFBUSxzQkFBc0IsVUFDOUMsUUFBUSx1QkFBdUIsVUFDL0IsUUFBUSw2QkFBNkIsVUFDckMsUUFBUSxpQkFBaUI7QUFDN0IsUUFBTSxxQkFBcUIsY0FDckIsY0FBYztBQUFBLElBQ1osZUFBZTtBQUFBLElBQ2YsbUJBQW1CLFFBQVE7QUFBQSxJQUMzQixvQkFBb0IsUUFBUTtBQUFBLElBQzVCLDBCQUEwQixRQUFRO0FBQUEsSUFDbEMsY0FBYyxRQUFRO0FBQUEsRUFDMUIsQ0FBQyxJQUNDO0FBQ04sU0FBTyxZQUFZLGNBQWM7QUFBQSxJQUM3QixVQUFVLFFBQVE7QUFBQSxJQUNsQixZQUFZLFFBQVE7QUFBQSxJQUNwQixnQkFBZ0IsUUFBUTtBQUFBLElBQ3hCLGVBQWUsUUFBUTtBQUFBLElBQ3ZCLFVBQVUsUUFBUTtBQUFBLElBQ2xCLFFBQVEsUUFBUTtBQUFBLElBQ2hCO0FBQUEsRUFDSixDQUFDO0FBQ0w7QUErQ08sU0FBUyx1QkFBdUIsVUFBVSxDQUFDLEdBQUc7QUFDakQsUUFBTSxxQkFBcUIsUUFBUSxzQkFBc0IsU0FDbkQ7QUFBQSxJQUNFLGVBQWU7QUFBQSxJQUNmLG1CQUFtQixRQUFRO0FBQUEsRUFDL0IsSUFDRTtBQUNOLFNBQU8sWUFBWSxvQkFBb0I7QUFBQSxJQUNuQyxVQUFVLFFBQVE7QUFBQSxJQUNsQixZQUFZLFFBQVE7QUFBQSxJQUNwQixnQkFBZ0IsUUFBUTtBQUFBLElBQ3hCLGVBQWUsUUFBUTtBQUFBLElBQ3ZCLFVBQVUsUUFBUTtBQUFBLElBQ2xCLFFBQVEsUUFBUTtBQUFBLElBQ2hCO0FBQUEsRUFDSixDQUFDO0FBQ0w7QUFDTyxTQUFTLG1CQUFtQixVQUFVLENBQUMsR0FBRztBQUM3QyxRQUFNLHFCQUFxQixRQUFRLHNCQUFzQixTQUNuRDtBQUFBLElBQ0UsZUFBZTtBQUFBLElBQ2YsbUJBQW1CLFFBQVE7QUFBQSxFQUMvQixJQUNFO0FBQ04sU0FBTyxZQUFZLGdCQUFnQjtBQUFBLElBQy9CLFVBQVUsUUFBUTtBQUFBLElBQ2xCLFlBQVksUUFBUTtBQUFBLElBQ3BCLGdCQUFnQixRQUFRO0FBQUEsSUFDeEIsZUFBZSxRQUFRO0FBQUEsSUFDdkI7QUFBQSxFQUNKLENBQUM7QUFDTDtBQUNPLFNBQVMsb0JBQW9CLFVBQVUsQ0FBQyxHQUFHO0FBQzlDLFFBQU0scUJBQXFCLFFBQVEsc0JBQXNCLFNBQ25EO0FBQUEsSUFDRSxlQUFlO0FBQUEsSUFDZixtQkFBbUIsUUFBUTtBQUFBLEVBQy9CLElBQ0U7QUFDTixTQUFPLFlBQVksaUJBQWlCO0FBQUEsSUFDaEMsVUFBVSxRQUFRO0FBQUEsSUFDbEIsWUFBWSxRQUFRO0FBQUEsSUFDcEIsZ0JBQWdCLFFBQVE7QUFBQSxJQUN4QixlQUFlLFFBQVE7QUFBQSxJQUN2QjtBQUFBLEVBQ0osQ0FBQztBQUNMOzs7QUMzSUEsZUFBZSxZQUFZO0FBQ3ZCLFNBQU8sSUFBSSxRQUFRLENBQUNBLFVBQVMsV0FBVztBQUNwQyxVQUFNLFNBQVMsQ0FBQztBQUNoQixZQUFRLE1BQU0sWUFBWSxPQUFPO0FBQ2pDLFlBQVEsTUFBTSxHQUFHLFFBQVEsQ0FBQyxVQUFVLE9BQU8sS0FBSyxLQUFLLENBQUM7QUFDdEQsWUFBUSxNQUFNLEdBQUcsT0FBTyxNQUFNQSxTQUFRLE9BQU8sS0FBSyxFQUFFLENBQUMsQ0FBQztBQUN0RCxZQUFRLE1BQU0sR0FBRyxTQUFTLE1BQU07QUFBQSxFQUNwQyxDQUFDO0FBQ0w7QUFDQSxTQUFTLGdCQUFnQixjQUFjO0FBQ25DLFNBQU8sS0FBSyxNQUFNLFlBQVk7QUFDbEM7QUFDQSxTQUFTLFlBQVksUUFBUTtBQUN6QixVQUFRLE9BQU8sTUFBTSxLQUFLLFVBQVUsT0FBTyxNQUFNLENBQUM7QUFDdEQ7QUFDQSxTQUFTLHNCQUFzQixlQUFlLFFBQVE7QUFDbEQsTUFBSSxDQUFDLHdCQUF3QixJQUFJLGFBQWEsR0FBRztBQUM3QyxVQUFNLElBQUksTUFBTSxHQUFHLGFBQWEsaUNBQWlDO0FBQUEsRUFDckU7QUFDQSxNQUFJLGtCQUFrQixnQkFBZ0I7QUFDbEMsV0FBTyxtQkFBbUIsRUFBRSxtQkFBbUIsT0FBTyxDQUFDO0FBQUEsRUFDM0Q7QUFDQSxNQUFJLGtCQUFrQixpQkFBaUI7QUFDbkMsV0FBTyxvQkFBb0IsRUFBRSxtQkFBbUIsT0FBTyxDQUFDO0FBQUEsRUFDNUQ7QUFDQSxTQUFPLHVCQUF1QixFQUFFLG1CQUFtQixPQUFPLENBQUM7QUFDL0Q7QUFDTyxTQUFTLG9CQUFvQixRQUFRO0FBQ3hDLFNBQU8sT0FBTyxXQUFXLFNBQVksRUFBRSxRQUFRLE9BQU8sUUFBUSxRQUFRLE9BQU8sT0FBTyxJQUFJLEVBQUUsUUFBUSxPQUFPLE9BQU87QUFDcEg7QUFDQSxlQUFzQixRQUFRLFFBQVE7QUFDbEMsTUFBSTtBQUNBLFVBQU0sZUFBZSxNQUFNLFVBQVU7QUFDckMsVUFBTSxRQUFRLGdCQUFnQixZQUFZO0FBQzFDLFdBQU8sV0FBVyxPQUFPLGVBQWUsS0FBSztBQUM3QyxVQUFNLFVBQVUsRUFBRSxPQUFPO0FBQ3pCLFVBQU0sU0FBUyxNQUFNLE9BQU8sT0FBTyxPQUFPO0FBQzFDLFFBQUksU0FBUyxFQUFFLFFBQVEsQ0FBQyxFQUFFO0FBQzFCLFFBQUksT0FBTyxXQUFXLFVBQVU7QUFDNUIsZUFBUyxvQkFBb0Isc0JBQXNCLE9BQU8sZUFBZSxNQUFNLENBQUM7QUFBQSxJQUNwRixXQUNTLFdBQVcsUUFBVztBQUMzQixlQUFTLG9CQUFvQixNQUFNO0FBQUEsSUFDdkM7QUFDQSxnQkFBWSxNQUFNO0FBQ2xCLFlBQVEsS0FBSyxXQUFXLE9BQU87QUFBQSxFQUNuQyxTQUNPLE9BQU87QUFDVixRQUFJLGlCQUFpQixZQUFZO0FBQzdCLGNBQVEsT0FBTyxNQUFNLEdBQUcsTUFBTSxNQUFNO0FBQUEsQ0FBSTtBQUN4QyxjQUFRLEtBQUssV0FBVyxLQUFLO0FBQUEsSUFDakM7QUFDQSxRQUFJLGlCQUFpQixPQUFPO0FBQ3hCLGNBQVEsT0FBTyxNQUFNLEdBQUcsTUFBTSxTQUFTLE1BQU0sT0FBTztBQUFBLENBQUk7QUFBQSxJQUM1RCxPQUNLO0FBQ0QsY0FBUSxPQUFPLE1BQU0sR0FBRyxPQUFPLEtBQUssQ0FBQztBQUFBLENBQUk7QUFBQSxJQUM3QztBQUNBLFlBQVEsS0FBSyxXQUFXLEtBQUs7QUFBQSxFQUNqQyxVQUNBO0FBQ0ksV0FBTyxhQUFhO0FBQ3BCLFdBQU8sTUFBTTtBQUFBLEVBQ2pCO0FBQ0o7OztBQ3ZDQSxTQUFTLGdCQUFBQyxxQkFBb0I7QUFDN0IsU0FBUyxrQkFBa0I7QUFDM0IsWUFBWUMsU0FBUTtBQUNwQixZQUFZQyxlQUFjOzs7QUN0QjFCLFNBQVMsb0JBQW9CO0FBQzdCLFlBQVksUUFBUTtBQUNwQixZQUFZLFFBQVE7QUFDcEIsWUFBWSxjQUFjO0FBTW5CLFNBQVMsUUFBUSxHQUFtQjtBQUN6QyxTQUFPLEVBQUUsUUFBUSxPQUFPLEdBQUc7QUFDN0I7QUFhTyxTQUFTLGdCQUFnQixLQUErQztBQUM3RSxNQUFJLENBQUMsSUFBSyxRQUFPO0FBQ2pCLE1BQUk7QUFDRixVQUFNLE1BQU0sYUFBYSxPQUFPLENBQUMsTUFBTSxLQUFLLGFBQWEsaUJBQWlCLEdBQUc7QUFBQSxNQUMzRSxPQUFPLENBQUMsVUFBVSxRQUFRLFFBQVE7QUFBQSxNQUNsQyxVQUFVO0FBQUEsSUFDWixDQUFDO0FBQ0QsVUFBTSxVQUFVLElBQUksS0FBSztBQUN6QixXQUFPLFFBQVEsU0FBUyxJQUFJLFFBQVEsT0FBTyxJQUFJO0FBQUEsRUFDakQsUUFBUTtBQUNOLFdBQU87QUFBQSxFQUNUO0FBQ0Y7QUFrQk8sSUFBTSxZQUFZO0FBd0NsQixTQUFTLGlCQUFpQixhQUFxQixXQUFtQixXQUFvQjtBQUMzRixRQUFNLE9BQU8sU0FBUyxRQUFRLFFBQVEsRUFBRTtBQUN4QyxTQUFPLGdCQUFnQixRQUFRLFlBQVksV0FBVyxHQUFHLElBQUksR0FBRztBQUNsRTtBQW9FTyxTQUFTLGVBQWUsUUFBZ0M7QUFDN0QsUUFBTSxPQUF1QixDQUFDO0FBQzlCLGFBQVcsUUFBUSxPQUFPLE1BQU0sSUFBSSxHQUFHO0FBQ3JDLFVBQU0sVUFBVSxLQUFLLEtBQUs7QUFDMUIsUUFBSSxDQUFDLFFBQVM7QUFDZCxVQUFNLFFBQVEsUUFBUSxNQUFNLEdBQUk7QUFDaEMsUUFBSSxNQUFNLFNBQVMsRUFBRztBQUN0QixVQUFNLENBQUMsTUFBTSxNQUFNLEtBQUssSUFBSTtBQUM1QixVQUFNLFVBQVUsTUFBTSxRQUFRLEdBQUc7QUFDakMsUUFBSSxZQUFZLEdBQUk7QUFDcEIsVUFBTSxRQUFRLFNBQVMsTUFBTSxNQUFNLEdBQUcsT0FBTyxHQUFHLEVBQUU7QUFDbEQsVUFBTSxNQUFNLFNBQVMsTUFBTSxNQUFNLFVBQVUsQ0FBQyxHQUFHLEVBQUU7QUFDakQsUUFBSSxPQUFPLE1BQU0sS0FBSyxLQUFLLE9BQU8sTUFBTSxHQUFHLEVBQUc7QUFDOUMsU0FBSyxLQUFLLEVBQUUsTUFBTSxNQUFNLE9BQU8sSUFBSSxDQUFDO0FBQUEsRUFDdEM7QUFDQSxTQUFPO0FBQ1Q7QUFTTyxJQUFNLHFCQUFxQjtBQUFBLEVBQ2hDO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQ0Y7QUFJQSxJQUFNLHVCQUE0QyxJQUFJLElBQUksa0JBQWtCO0FBRTVFLFNBQVMscUJBQXFCLEtBQXFDO0FBQ2pFLFNBQU8scUJBQXFCLElBQUksR0FBRyxJQUFLLE1BQTBCO0FBQ3BFO0FBdUJPLFNBQVMsT0FBTyxRQUFrQztBQUN2RCxVQUFRLFFBQVE7QUFBQSxJQUNkLEtBQUs7QUFBQSxJQUNMLEtBQUs7QUFBQSxJQUNMLEtBQUs7QUFDSCxhQUFPO0FBQUEsSUFDVDtBQUNFLGFBQU87QUFBQSxFQUNYO0FBQ0Y7QUFxQk8sU0FBUyxzQkFBc0IsUUFBa0M7QUFDdEUsVUFBUSxRQUFRO0FBQUEsSUFDZCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQ0gsYUFBTztBQUFBLElBQ1Q7QUFDRSxhQUFPO0FBQUEsRUFDWDtBQUNGO0FBV08sU0FBUyxvQkFBb0IsUUFBcUM7QUFDdkUsUUFBTSxPQUE0QixDQUFDO0FBQ25DLGFBQVcsUUFBUSxPQUFPLE1BQU0sSUFBSSxHQUFHO0FBQ3JDLFVBQU0sVUFBVSxLQUFLLEtBQUs7QUFDMUIsUUFBSSxDQUFDLFdBQVcsUUFBUSxXQUFXLEdBQUcsRUFBRztBQUN6QyxVQUFNLFFBQVEsUUFBUSxNQUFNLEdBQUk7QUFDaEMsUUFBSSxNQUFNLFNBQVMsRUFBRztBQUN0QixVQUFNLENBQUMsV0FBVyxFQUFFLE1BQU0sTUFBTSxVQUFVLE1BQU0sSUFBSTtBQUNwRCxVQUFNLFNBQVMscUJBQXFCLFNBQVM7QUFDN0MsUUFBSSxDQUFDLE9BQVE7QUFDYixVQUFNLFFBQVEsYUFBYSxZQUFZLElBQUksU0FBUyxVQUFVLEVBQUU7QUFDaEUsVUFBTSxNQUFNLFdBQVcsTUFBTSxJQUFJLFNBQVMsUUFBUSxFQUFFO0FBQ3BELFFBQUksT0FBTyxNQUFNLEtBQUssS0FBSyxPQUFPLE1BQU0sR0FBRyxFQUFHO0FBQzlDLFNBQUssS0FBSyxFQUFFLE1BQU0sTUFBTSxPQUFPLEtBQUssT0FBTyxDQUFDO0FBQUEsRUFDOUM7QUFDQSxTQUFPO0FBQ1Q7QUF3Qk8sSUFBTSxtQkFBNEIsY0FBUSxXQUFRLEdBQUcsVUFBVSxZQUFZLFNBQVM7QUFPM0YsSUFBTSxpQkFBaUIsS0FBSyxLQUFLLEtBQUssS0FBSztBQXlFcEMsU0FBUyxvQkFBb0IsVUFBMEI7QUFDNUQsUUFBTSxNQUFNLGFBQWEsT0FBTyxDQUFDLE1BQU0sVUFBVSxhQUFhLGtCQUFrQixHQUFHO0FBQUEsSUFDakYsT0FBTyxDQUFDLFVBQVUsUUFBUSxRQUFRO0FBQUEsSUFDbEMsVUFBVTtBQUFBLEVBQ1osQ0FBQztBQUNELFFBQU0sVUFBVSxRQUFRLElBQUksS0FBSyxDQUFDO0FBR2xDLE1BQUksQ0FBVSxvQkFBVyxPQUFPLEdBQUc7QUFDakMsV0FBTyxRQUFpQixpQkFBUSxVQUFVLE9BQU8sQ0FBQztBQUFBLEVBQ3BEO0FBQ0EsU0FBTztBQUNUO0FBS08sU0FBUyxVQUFVLFVBQTBCO0FBQ2xELFNBQWdCLGNBQUssb0JBQW9CLFFBQVEsR0FBRyxVQUFVO0FBQ2hFO0FBT08sU0FBUyxZQUFZLFVBQTBCO0FBQ3BELFNBQWdCLGNBQUssVUFBVSxRQUFRLEdBQUcsTUFBTTtBQUNsRDs7O0FDeFpBLFlBQVlDLFNBQVE7QUFDcEIsWUFBWUMsZUFBYzs7O0FDTDFCLFlBQVlDLFNBQVE7QUFDcEIsWUFBWUMsZUFBYztBQVcxQixJQUFNLGtCQUEyQixlQUFLLFNBQVMsYUFBYTtBQU01RCxTQUFTLGFBQWEsTUFBc0I7QUFDMUMsTUFBSSxLQUFLO0FBQ1QsV0FBUyxJQUFJLEdBQUcsSUFBSSxLQUFLLFFBQVEsS0FBSztBQUNwQyxVQUFNLElBQUksS0FBSyxDQUFDO0FBQ2hCLFFBQUksTUFBTSxLQUFLO0FBQ2IsVUFBSSxLQUFLLElBQUksQ0FBQyxNQUFNLEtBQUs7QUFDdkIsY0FBTTtBQUNOO0FBRUEsWUFBSSxLQUFLLElBQUksQ0FBQyxNQUFNLElBQUs7QUFBQSxNQUMzQixPQUFPO0FBQ0wsY0FBTTtBQUFBLE1BQ1I7QUFBQSxJQUNGLFdBQVcsTUFBTSxLQUFLO0FBQ3BCLFlBQU07QUFBQSxJQUNSLE9BQU87QUFDTCxZQUFNLEVBQUUsUUFBUSxxQkFBcUIsTUFBTTtBQUFBLElBQzdDO0FBQUEsRUFDRjtBQUNBLFNBQU8sSUFBSSxPQUFPLElBQUksRUFBRSxHQUFHO0FBQzdCO0FBR0EsU0FBUyxjQUFjLE1BQXdCO0FBQzdDLFFBQU0sUUFBUSxLQUFLLE1BQU0sR0FBRztBQUM1QixRQUFNLE1BQWdCLENBQUM7QUFDdkIsV0FBUyxJQUFJLEdBQUcsSUFBSSxNQUFNLFFBQVEsS0FBSztBQUNyQyxRQUFJLEtBQUssTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLEVBQUUsS0FBSyxHQUFHLENBQUM7QUFBQSxFQUMxQztBQUNBLFNBQU87QUFDVDtBQVlPLFNBQVMsZUFBZSxTQUFtRDtBQUNoRixNQUFJLE1BQU07QUFDVixNQUFJLFVBQVU7QUFDZCxNQUFJLElBQUksU0FBUyxHQUFHLEdBQUc7QUFDckIsY0FBVTtBQUNWLFVBQU0sSUFBSSxNQUFNLEdBQUcsRUFBRTtBQUFBLEVBQ3ZCO0FBQ0EsTUFBSSxXQUFXLElBQUksU0FBUyxHQUFHO0FBQy9CLE1BQUksSUFBSSxXQUFXLEdBQUcsR0FBRztBQUN2QixlQUFXO0FBQ1gsVUFBTSxJQUFJLE1BQU0sQ0FBQztBQUFBLEVBQ25CO0FBQ0EsUUFBTSxLQUFLLGFBQWEsR0FBRztBQUUzQixTQUFPLENBQUMsZ0JBQXdCO0FBQzlCLFFBQUksVUFBVTtBQUNaLFlBQU0sT0FBTyxjQUFjLFdBQVc7QUFFdEMsWUFBTUMsY0FBYSxVQUFVLEtBQUssTUFBTSxHQUFHLEVBQUUsSUFBSTtBQUNqRCxhQUFPQSxZQUFXLEtBQUssQ0FBQyxNQUFNLEdBQUcsS0FBSyxDQUFDLENBQUM7QUFBQSxJQUMxQztBQUVBLFVBQU0sYUFBYSxZQUFZLE1BQU0sR0FBRztBQUN4QyxVQUFNLGFBQWEsVUFBVSxXQUFXLE1BQU0sR0FBRyxFQUFFLElBQUk7QUFDdkQsV0FBTyxXQUFXLEtBQUssQ0FBQyxNQUFNLEdBQUcsS0FBSyxDQUFDLENBQUM7QUFBQSxFQUMxQztBQUNGOzs7QUR2RUEsSUFBTSxrQkFBMkIsZUFBSyxTQUFTLGFBQWE7QUFHckQsU0FBUyxnQkFBZ0IsU0FBbUM7QUFDakUsUUFBTSxRQUEwQixDQUFDO0FBQ2pDLGFBQVcsV0FBVyxRQUFRLE1BQU0sSUFBSSxHQUFHO0FBQ3pDLFVBQU0sVUFBVSxRQUFRLEtBQUs7QUFDN0IsUUFBSSxDQUFDLFdBQVcsUUFBUSxXQUFXLEdBQUcsRUFBRztBQUN6QyxVQUFNLEtBQUssRUFBRSxTQUFTLFNBQVMsZUFBZSxPQUFPLEVBQUUsQ0FBQztBQUFBLEVBQzFEO0FBQ0EsU0FBTztBQUNUO0FBT08sU0FBUyxlQUFlLFVBQW9DO0FBQ2pFLE1BQUk7QUFDRixVQUFNLFVBQWEsaUJBQXNCLGVBQUssVUFBVSxlQUFlLEdBQUcsTUFBTTtBQUNoRixXQUFPLGdCQUFnQixPQUFPO0FBQUEsRUFDaEMsUUFBUTtBQUNOLFdBQU8sQ0FBQztBQUFBLEVBQ1Y7QUFDRjtBQUdPLFNBQVMsY0FBYyxPQUF5QixhQUE4QjtBQUNuRixTQUFPLE1BQU0sS0FBSyxDQUFDLFNBQVMsS0FBSyxRQUFRLFdBQVcsQ0FBQztBQUN2RDs7O0FGbkJPLElBQU0sZ0JBQU4sY0FBNEIsTUFBTTtBQUFBLEVBQzlCO0FBQUEsRUFDVCxZQUFZLFFBQWdCO0FBQzFCLFVBQU0sK0NBQStDLE1BQU0sRUFBRTtBQUM3RCxTQUFLLE9BQU87QUFDWixTQUFLLFNBQVM7QUFBQSxFQUNoQjtBQUNGO0FBa0RPLFNBQVMsZ0JBQWdCLFNBQW1DO0FBQ2pFLGFBQVcsV0FBVyxjQUFjLE9BQU8sR0FBRztBQUM1QyxVQUFNLE1BQU0sbUJBQW1CLFNBQVMsT0FBTyxDQUFDO0FBQ2hELFFBQUksQ0FBQyxJQUFLO0FBQ1YsUUFBSSxJQUFJLGVBQWUsVUFBVTtBQUMvQixZQUFNLFdBQVcsSUFBSSxLQUFLLFFBQVEsSUFBSTtBQUN0QyxZQUFNLFFBQVEsWUFBWSxJQUFJLElBQUksS0FBSyxNQUFNLFdBQVcsQ0FBQyxFQUFFLE9BQU8sQ0FBQyxNQUFNLEVBQUUsU0FBUyxDQUFDLElBQUksQ0FBQztBQUMxRixhQUFPLE1BQU0sU0FBUyxJQUFJLEVBQUUsTUFBTSxVQUFVLE1BQU0sSUFBSSxFQUFFLE1BQU0sU0FBUztBQUFBLElBQ3pFO0FBQ0EsUUFBSSxJQUFJLGVBQWUsUUFBUTtBQUM3QixhQUFPLEVBQUUsTUFBTSxPQUFPO0FBQUEsSUFDeEI7QUFBQSxFQUdGO0FBQ0EsU0FBTyxFQUFFLE1BQU0sT0FBTztBQUN4QjtBQWtCQSxJQUFNLHVCQUF1QixvQkFBSSxJQUFJO0FBQUEsRUFDbkM7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQ0YsQ0FBQztBQUVNLFNBQVMsZ0JBQWdCLFNBQTBCO0FBQ3hELGFBQVcsV0FBVyxjQUFjLE9BQU8sR0FBRztBQUM1QyxVQUFNLE1BQU0sbUJBQW1CLFNBQVMsT0FBTyxDQUFDO0FBQ2hELFFBQUksQ0FBQyxPQUFPLElBQUksZUFBZSxTQUFVO0FBQ3pDLFVBQU0sV0FBVyxJQUFJLEtBQUssUUFBUSxJQUFJO0FBQ3RDLFVBQU0sV0FBVyxZQUFZLElBQUksSUFBSSxLQUFLLE1BQU0sR0FBRyxRQUFRLElBQUksSUFBSTtBQUNuRSxhQUFTLElBQUksR0FBRyxJQUFJLFNBQVMsUUFBUSxLQUFLO0FBQ3hDLFlBQU0sTUFBTSxTQUFTLENBQUM7QUFDdEIsVUFBSSxRQUFRLFFBQVMsUUFBTztBQUc1QixVQUFJLHFCQUFxQixJQUFJLEdBQUcsR0FBRztBQUNqQztBQUNBO0FBQUEsTUFDRjtBQUNBLFVBQUksQ0FBQyxJQUFJLFdBQVcsSUFBSSxLQUFLLHlCQUF5QixLQUFLLEdBQUcsRUFBRyxRQUFPO0FBQUEsSUFDMUU7QUFDQSxXQUFPO0FBQUEsRUFDVDtBQUNBLFNBQU87QUFDVDtBQU1BLElBQU0scUJBQXFCLG9CQUFJLElBQUksQ0FBQyxNQUFNLElBQUksQ0FBQztBQUMvQyxJQUFNLHNCQUFzQixvQkFBSSxJQUFJLENBQUMsS0FBSyxLQUFLLE1BQU0sS0FBSyxLQUFLLEdBQUcsQ0FBQztBQUduRSxTQUFTLGNBQWMsU0FBMkI7QUFDaEQsUUFBTSxXQUFxQixDQUFDO0FBQzVCLE1BQUksVUFBVTtBQUNkLE1BQUksUUFBMEI7QUFDOUIsV0FBUyxJQUFJLEdBQUcsSUFBSSxRQUFRLFFBQVEsS0FBSztBQUN2QyxVQUFNLEtBQUssUUFBUSxDQUFDO0FBQ3BCLFFBQUksT0FBTztBQUNULGlCQUFXO0FBQ1gsVUFBSSxPQUFPLE1BQU8sU0FBUTtBQUMxQjtBQUFBLElBQ0Y7QUFDQSxRQUFJLE9BQU8sT0FBTyxPQUFPLEtBQUs7QUFDNUIsY0FBUTtBQUNSLGlCQUFXO0FBQ1g7QUFBQSxJQUNGO0FBQ0EsUUFBSSxtQkFBbUIsSUFBSSxRQUFRLE1BQU0sR0FBRyxJQUFJLENBQUMsQ0FBQyxHQUFHO0FBQ25ELGVBQVMsS0FBSyxPQUFPO0FBQ3JCLGdCQUFVO0FBQ1Y7QUFDQTtBQUFBLElBQ0Y7QUFDQSxRQUFJLG9CQUFvQixJQUFJLEVBQUUsR0FBRztBQUMvQixlQUFTLEtBQUssT0FBTztBQUNyQixnQkFBVTtBQUNWO0FBQUEsSUFDRjtBQUNBLGVBQVc7QUFBQSxFQUNiO0FBQ0EsV0FBUyxLQUFLLE9BQU87QUFDckIsU0FBTztBQUNUO0FBUUEsU0FBUyxTQUFTLFNBQTJCO0FBQzNDLFFBQU0sU0FBbUIsQ0FBQztBQUMxQixNQUFJLFVBQVU7QUFDZCxNQUFJLE1BQU07QUFDVixNQUFJLFFBQTBCO0FBQzlCLFdBQVMsSUFBSSxHQUFHLElBQUksUUFBUSxRQUFRLEtBQUs7QUFDdkMsVUFBTSxLQUFLLFFBQVEsQ0FBQztBQUNwQixRQUFJLE9BQU87QUFDVCxVQUFJLE9BQU8sTUFBTyxTQUFRO0FBQUEsVUFDckIsWUFBVztBQUNoQixZQUFNO0FBQ047QUFBQSxJQUNGO0FBQ0EsUUFBSSxPQUFPLE9BQU8sT0FBTyxLQUFLO0FBQzVCLGNBQVE7QUFDUixZQUFNO0FBQ047QUFBQSxJQUNGO0FBQ0EsUUFBSSxPQUFPLE9BQU8sT0FBTyxLQUFNO0FBQzdCLFVBQUksS0FBSztBQUNQLGVBQU8sS0FBSyxPQUFPO0FBQ25CLGtCQUFVO0FBQ1YsY0FBTTtBQUFBLE1BQ1I7QUFDQTtBQUFBLElBQ0Y7QUFDQSxlQUFXO0FBQ1gsVUFBTTtBQUFBLEVBQ1I7QUFDQSxNQUFJLElBQUssUUFBTyxLQUFLLE9BQU87QUFDNUIsU0FBTztBQUNUO0FBR0EsSUFBTSxvQkFBb0Isb0JBQUksSUFBSTtBQUFBLEVBQ2hDO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFDRixDQUFDO0FBYUQsU0FBUyxtQkFBbUIsUUFBd0M7QUFDbEUsTUFBSSxJQUFJO0FBQ1IsU0FBTyxJQUFJLE9BQU8sVUFBVSwyQkFBMkIsS0FBSyxPQUFPLENBQUMsQ0FBQyxFQUFHO0FBQ3hFLE1BQUksS0FBSyxPQUFPLFVBQVUsT0FBTyxDQUFDLE1BQU0sTUFBTyxRQUFPO0FBQ3REO0FBQ0EsU0FBTyxJQUFJLE9BQU8sUUFBUTtBQUN4QixVQUFNLElBQUksT0FBTyxDQUFDO0FBQ2xCLFFBQUksTUFBTSxLQUFNLFFBQU87QUFDdkIsUUFBSSxDQUFDLEVBQUUsV0FBVyxHQUFHLEVBQUc7QUFDeEIsU0FBSyxrQkFBa0IsSUFBSSxDQUFDLElBQUksSUFBSTtBQUFBLEVBQ3RDO0FBQ0EsTUFBSSxLQUFLLE9BQU8sT0FBUSxRQUFPO0FBQy9CLFNBQU8sRUFBRSxZQUFZLE9BQU8sQ0FBQyxHQUFHLE1BQU0sT0FBTyxNQUFNLElBQUksQ0FBQyxFQUFFO0FBQzVEO0FBd0VBLGVBQXNCLGlCQUNwQixNQUNBLEtBQ0EsS0FDQSxLQUNBLE9BQ21CO0FBQ25CLE1BQUksU0FBUyxRQUFRO0FBQ25CLFdBQU8sSUFBSSxjQUFjLEdBQUc7QUFBQSxFQUM5QjtBQUdBLE1BQUksU0FBUyxNQUFNLFNBQVMsR0FBRztBQUM3QixXQUFPLElBQUksY0FBYyxPQUFPLEdBQUc7QUFBQSxFQUNyQztBQUNBLFFBQU0sU0FBUyxNQUFNLElBQUksWUFBWSxHQUFHO0FBQ3hDLE1BQUksQ0FBQyxJQUFLLFFBQU87QUFDakIsUUFBTSxVQUFVLE1BQU0sSUFBSSxxQkFBcUIsR0FBRztBQUNsRCxRQUFNLE9BQU8sb0JBQUksSUFBWTtBQUM3QixRQUFNLFNBQW1CLENBQUM7QUFDMUIsYUFBVyxRQUFRLENBQUMsR0FBRyxRQUFRLEdBQUcsT0FBTyxHQUFHO0FBQzFDLFFBQUksS0FBSyxJQUFJLElBQUksRUFBRztBQUNwQixTQUFLLElBQUksSUFBSTtBQUNiLFdBQU8sS0FBSyxJQUFJO0FBQUEsRUFDbEI7QUFDQSxTQUFPO0FBQ1Q7QUE4S0EsZUFBc0IsYUFDcEIsT0FDQSxLQUNBLFdBQ0EsV0FDcUI7QUFDckIsTUFBSSxNQUFNLFdBQVcsRUFBRyxRQUFPLEVBQUUsVUFBVSxTQUFTLE1BQU0sU0FBUztBQUNuRSxNQUFJO0FBRUYsVUFBTSxVQUFVLElBQUksT0FBTyxHQUFHO0FBQzlCLFVBQU0sWUFBWSxNQUFNLFVBQVUsTUFBTSxPQUFPLEdBQUc7QUFRbEQsVUFBTSxXQUFXLFVBQVUsT0FBTyxDQUFDLFFBQVEsT0FBTyxJQUFJLE1BQU0sQ0FBQztBQUM3RCxVQUFNLFdBQVcsU0FBUyxPQUFPLENBQUMsUUFBUSxDQUFDLHNCQUFzQixJQUFJLE1BQU0sQ0FBQztBQUM1RSxVQUFNLGdCQUFnQixTQUFTLE9BQU8sQ0FBQyxRQUFRLHNCQUFzQixJQUFJLE1BQU0sQ0FBQztBQUtoRixRQUFJLDJCQUEyQjtBQUMvQixRQUFJLFNBQVMsU0FBUyxHQUFHO0FBQ3ZCLFlBQU0saUJBQWlCLGdCQUFnQixVQUFVLENBQUMsQ0FBQztBQUNuRCxVQUFJLENBQUMsVUFBVSxJQUFJLGNBQWMsR0FBRztBQUdsQyxZQUFJLENBQUMsVUFBVSxPQUFPLGNBQWMsRUFBRyxRQUFPLEVBQUUsVUFBVSxTQUFTLE1BQU0sU0FBUztBQUNsRixlQUFPO0FBQUEsVUFDTCxVQUFVO0FBQUEsVUFDVixNQUFNO0FBQUEsVUFDTixVQUFVO0FBQUEsVUFDVixRQUFRLHNCQUFzQixRQUFRO0FBQUEsUUFDeEM7QUFBQSxNQUNGO0FBQ0EsaUNBQTJCO0FBQUEsSUFDN0I7QUFPQSxRQUFJLGNBQWMsU0FBUyxHQUFHO0FBQzVCLGFBQU87QUFBQSxRQUNMLFVBQVU7QUFBQSxRQUNWLE1BQU07QUFBQSxRQUNOLFlBQVk7QUFBQSxRQUNaLFFBQVEsMEJBQTBCLGFBQWE7QUFBQSxNQUNqRDtBQUFBLElBQ0Y7QUFNQSxVQUFNLFdBQVcsTUFBTSxVQUFVLEtBQUssT0FBTyxHQUFHO0FBQ2hELFVBQU0sVUFBVSxJQUFJLElBQUksU0FBUyxJQUFJLENBQUMsUUFBUSxJQUFJLElBQUksQ0FBQztBQUN2RCxVQUFNLFdBQVcsZ0JBQWdCLEdBQUc7QUFDcEMsVUFBTSxrQkFBa0IsV0FBVyxlQUFlLFFBQVEsSUFBSSxDQUFDO0FBQy9ELFVBQU0sWUFBWSxNQUFNO0FBQUEsTUFDdEIsQ0FBQyxTQUFTLENBQUMsUUFBUSxJQUFJLElBQUksS0FBSyxDQUFDLGlCQUFpQixJQUFJLEtBQUssQ0FBQyxjQUFjLGlCQUFpQixJQUFJO0FBQUEsSUFDakc7QUFDQSxRQUFJLFVBQVUsV0FBVyxHQUFHO0FBSTFCLGFBQU8sMkJBQ0gsRUFBRSxVQUFVLFNBQVMsTUFBTSxvQkFBb0IsSUFDL0MsRUFBRSxVQUFVLFNBQVMsTUFBTSxTQUFTO0FBQUEsSUFDMUM7QUFPQSxVQUFNLFNBQVMsZ0JBQWdCLENBQUMsR0FBRyxTQUFTO0FBQzVDLFFBQUksVUFBVSxJQUFJLE1BQU0sRUFBRyxRQUFPLEVBQUUsVUFBVSxTQUFTLE1BQU0sb0JBQW9CO0FBR2pGLFFBQUksQ0FBQyxVQUFVLE9BQU8sTUFBTSxFQUFHLFFBQU8sRUFBRSxVQUFVLFNBQVMsTUFBTSxTQUFTO0FBQzFFLFdBQU8sRUFBRSxVQUFVLFFBQVEsTUFBTSxvQkFBb0IsV0FBVyxRQUFRLHNCQUFzQixTQUFTLEVBQUU7QUFBQSxFQUMzRyxTQUFTLEtBQUs7QUFLWixRQUFJLGVBQWUsZUFBZTtBQUNoQyxhQUFPLEVBQUUsVUFBVSxTQUFTLE1BQU0sZUFBZSxRQUFRLHVCQUF1QixJQUFJLE1BQU0sRUFBRTtBQUFBLElBQzlGO0FBR0EsV0FBTyxFQUFFLFVBQVUsU0FBUyxNQUFNLFNBQVM7QUFBQSxFQUM3QztBQUNGO0FBT0EsU0FBUyxXQUFXLEtBQWdDO0FBQ2xELE1BQUksSUFBSSxVQUFVLEtBQUssSUFBSSxRQUFRLEVBQUcsUUFBTyxJQUFJO0FBQ2pELFNBQU8sR0FBRyxJQUFJLElBQUksS0FBSyxJQUFJLEtBQUssS0FBSyxJQUFJLEdBQUc7QUFDOUM7QUFPQSxTQUFTLGdCQUFnQixVQUErQixXQUE2QjtBQUNuRixRQUFNLGNBQWMsU0FBUyxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksTUFBTSxJQUFLLElBQUksSUFBSSxJQUFLLElBQUksSUFBSSxJQUFLLElBQUksS0FBSyxJQUFLLElBQUksR0FBRyxFQUFFLEVBQUUsS0FBSztBQUNwSCxRQUFNLFVBQVUsS0FBSyxVQUFVLEVBQUUsVUFBVSxhQUFhLFdBQVcsQ0FBQyxHQUFHLFNBQVMsRUFBRSxLQUFLLEVBQUUsQ0FBQztBQUMxRixTQUFPLFdBQVcsUUFBUSxFQUFFLE9BQU8sT0FBTyxFQUFFLE9BQU8sS0FBSztBQUMxRDtBQUdBLFNBQVMsc0JBQXNCLFVBQXVDO0FBQ3BFLFFBQU0sUUFBUSxTQUFTLElBQUksQ0FBQyxRQUFRLE9BQU8sSUFBSSxJQUFJLEtBQUssSUFBSSxNQUFNLE1BQU0sV0FBVyxHQUFHLENBQUMsRUFBRTtBQUN6RixTQUFPO0FBQUEsSUFDTDtBQUFBLElBQ0EsR0FBRztBQUFBLElBQ0g7QUFBQSxJQUNBO0FBQUEsRUFDRixFQUFFLEtBQUssSUFBSTtBQUNiO0FBT0EsU0FBUywwQkFBMEIsWUFBeUM7QUFDMUUsUUFBTSxRQUFRLFdBQVcsSUFBSSxDQUFDLFFBQVEsT0FBTyxJQUFJLElBQUksS0FBSyxJQUFJLE1BQU0sTUFBTSxXQUFXLEdBQUcsQ0FBQyxFQUFFO0FBQzNGLFNBQU87QUFBQSxJQUNMO0FBQUEsSUFDQSxHQUFHO0FBQUEsSUFDSDtBQUFBLElBQ0E7QUFBQSxFQUNGLEVBQUUsS0FBSyxJQUFJO0FBQ2I7QUFXQSxTQUFTLHVCQUF1QixRQUF3QjtBQUN0RCxTQUFPO0FBQUEsSUFDTDtBQUFBLElBQ0EsS0FBSyxNQUFNO0FBQUEsSUFDWDtBQUFBLElBQ0E7QUFBQSxFQUNGLEVBQUUsS0FBSyxJQUFJO0FBQ2I7QUFHQSxTQUFTLHNCQUFzQixXQUE2QjtBQUMxRCxRQUFNLFFBQVEsVUFBVSxJQUFJLENBQUMsU0FBUyxPQUFPLElBQUksRUFBRTtBQUNuRCxTQUFPO0FBQUEsSUFDTDtBQUFBLElBQ0EsR0FBRztBQUFBLElBQ0g7QUFBQSxJQUNBO0FBQUEsRUFDRixFQUFFLEtBQUssSUFBSTtBQUNiO0FBWUEsSUFBTSxxQkFBcUI7QUFHM0IsU0FBUyxTQUFTLE1BQWdCLEtBQWEsV0FBNkI7QUFDMUUsTUFBSTtBQUNGLFVBQU0sTUFBTUMsY0FBYSxPQUFPLE1BQU07QUFBQSxNQUNwQztBQUFBLE1BQ0EsVUFBVTtBQUFBLE1BQ1YsT0FBTyxDQUFDLFVBQVUsUUFBUSxRQUFRO0FBQUEsTUFDbEMsU0FBUztBQUFBLElBQ1gsQ0FBQztBQUNELFdBQU8sSUFDSixNQUFNLElBQUksRUFDVixJQUFJLENBQUMsU0FBUyxLQUFLLEtBQUssQ0FBQyxFQUN6QixPQUFPLENBQUMsU0FBUyxLQUFLLFNBQVMsQ0FBQyxFQUNoQyxJQUFJLE9BQU87QUFBQSxFQUNoQixRQUFRO0FBQ04sV0FBTyxDQUFDO0FBQUEsRUFDVjtBQUNGO0FBUUEsU0FBUyxlQUFlLE1BQWdCLEtBQWEsV0FBb0M7QUFDdkYsTUFBSTtBQUNGLFVBQU0sTUFBTUEsY0FBYSxPQUFPLE1BQU07QUFBQSxNQUNwQztBQUFBLE1BQ0EsVUFBVTtBQUFBLE1BQ1YsT0FBTyxDQUFDLFVBQVUsUUFBUSxRQUFRO0FBQUEsTUFDbEMsU0FBUztBQUFBLElBQ1gsQ0FBQztBQUNELFdBQU8sSUFDSixNQUFNLElBQUksRUFDVixJQUFJLENBQUMsU0FBUyxLQUFLLEtBQUssQ0FBQyxFQUN6QixPQUFPLENBQUMsU0FBUyxLQUFLLFNBQVMsQ0FBQyxFQUNoQyxJQUFJLE9BQU87QUFBQSxFQUNoQixRQUFRO0FBQ04sV0FBTztBQUFBLEVBQ1Q7QUFDRjtBQUdPLFNBQVMseUJBQXlCLFlBQW9CLG9CQUFpQztBQUM1RixTQUFPO0FBQUEsSUFDTCxhQUFhLE9BQU8sUUFBUTtBQUMxQixZQUFNLFdBQVcsZ0JBQWdCLEdBQUc7QUFDcEMsVUFBSSxDQUFDLFNBQVUsUUFBTyxDQUFDO0FBQ3ZCLGFBQU8sU0FBUyxDQUFDLE1BQU0sVUFBVSxRQUFRLFlBQVksYUFBYSxHQUFHLFVBQVUsU0FBUztBQUFBLElBQzFGO0FBQUEsSUFDQSxzQkFBc0IsT0FBTyxRQUFRO0FBQ25DLFlBQU0sV0FBVyxnQkFBZ0IsR0FBRztBQUNwQyxVQUFJLENBQUMsU0FBVSxRQUFPLENBQUM7QUFDdkIsYUFBTyxTQUFTLENBQUMsTUFBTSxVQUFVLFFBQVEsYUFBYSxHQUFHLFVBQVUsU0FBUztBQUFBLElBQzlFO0FBQUEsSUFDQSxlQUFlLE9BQU8sUUFBUTtBQUM1QixZQUFNLFdBQVcsZ0JBQWdCLEdBQUc7QUFDcEMsVUFBSSxDQUFDLFNBQVUsUUFBTyxDQUFDO0FBQ3ZCLFlBQU0sV0FBVyxlQUFlLENBQUMsTUFBTSxVQUFVLFFBQVEsZUFBZSxZQUFZLEdBQUcsVUFBVSxTQUFTO0FBQzFHLFVBQUksYUFBYSxLQUFNLFFBQU87QUFHOUIsWUFBTSxPQUFPLFNBQVMsQ0FBQyxNQUFNLFVBQVUsY0FBYyxRQUFRLGFBQWEsR0FBRyxVQUFVLFNBQVMsRUFBRSxDQUFDO0FBQ25HLFVBQUksQ0FBQyxLQUFNLFFBQU8sQ0FBQztBQUNuQixhQUFPLFNBQVMsQ0FBQyxNQUFNLFVBQVUsUUFBUSxlQUFlLEdBQUcsSUFBSSxRQUFRLEdBQUcsVUFBVSxTQUFTO0FBQUEsSUFDL0Y7QUFBQSxJQUNBLGVBQWUsT0FBTyxPQUFPLFFBQVE7QUFDbkMsWUFBTSxXQUFXLGdCQUFnQixHQUFHO0FBQ3BDLFVBQUksQ0FBQyxZQUFZLE1BQU0sV0FBVyxFQUFHLFFBQU8sQ0FBQztBQUc3QyxhQUFPLFNBQVMsQ0FBQyxNQUFNLFVBQVUsUUFBUSxRQUFRLGVBQWUsTUFBTSxHQUFHLEtBQUssR0FBRyxVQUFVLFNBQVM7QUFBQSxJQUN0RztBQUFBLEVBQ0Y7QUFDRjtBQUdPLFNBQVMsMkJBQTJCLFlBQW9CLG9CQUFtQztBQUNoRyxTQUFPO0FBQUEsSUFDTCxLQUFLLE9BQU8sT0FBTyxRQUFRO0FBQ3pCLFlBQU0sV0FBVyxnQkFBZ0IsR0FBRztBQUNwQyxVQUFJLENBQUMsWUFBWSxNQUFNLFdBQVcsRUFBRztBQUNyQyxVQUFJO0FBQ0YsUUFBQUEsY0FBYSxPQUFPLENBQUMsUUFBUSxTQUFTLEdBQUcsT0FBTyxPQUFPLEdBQUc7QUFBQSxVQUN4RCxLQUFLO0FBQUEsVUFDTCxVQUFVO0FBQUEsVUFDVixPQUFPLENBQUMsVUFBVSxRQUFRLE1BQU07QUFBQSxVQUNoQyxTQUFTO0FBQUEsUUFDWCxDQUFDO0FBQUEsTUFDSCxRQUFRO0FBQUEsTUFJUjtBQUFBLElBQ0Y7QUFBQSxJQUNBLE9BQU8sT0FBTyxPQUFPLFFBQVE7QUFDM0IsWUFBTSxXQUFXLGdCQUFnQixHQUFHO0FBQ3BDLFVBQUksQ0FBQyxZQUFZLE1BQU0sV0FBVyxFQUFHLFFBQU8sQ0FBQztBQUM3QyxVQUFJO0FBQ0osVUFBSTtBQUNGLGNBQU1BLGNBQWEsT0FBTyxDQUFDLFFBQVEsU0FBUyxZQUFZLGFBQWEsR0FBRyxLQUFLLEdBQUc7QUFBQSxVQUM5RSxLQUFLO0FBQUEsVUFDTCxVQUFVO0FBQUEsVUFDVixPQUFPLENBQUMsVUFBVSxRQUFRLE1BQU07QUFBQSxVQUNoQyxTQUFTO0FBQUEsUUFDWCxDQUFDO0FBQUEsTUFDSCxTQUFTLEtBQUs7QUFVWixjQUFNLFNBQVUsSUFBNEI7QUFDNUMsY0FBTSxTQUFVLElBQTRCO0FBQzVDLGNBQU0sYUFBYSxPQUFPLFdBQVcsV0FBVyxTQUFTO0FBQ3pELGNBQU0sYUFBYSxPQUFPLFdBQVcsV0FBVyxTQUFTO0FBQ3pELFlBQUksV0FBVyxLQUFLLEVBQUUsV0FBVyxLQUFLLFdBQVcsS0FBSyxFQUFFLFNBQVMsR0FBRztBQUNsRSxnQkFBTSxJQUFJLGNBQWMsV0FBVyxLQUFLLENBQUM7QUFBQSxRQUMzQztBQUNBLGNBQU07QUFBQSxNQUNSO0FBQ0EsYUFBTyxvQkFBb0IsR0FBRztBQUFBLElBQ2hDO0FBQUEsSUFDQSxNQUFNLE9BQU8sT0FBTyxRQUFRO0FBQzFCLFlBQU0sV0FBVyxnQkFBZ0IsR0FBRztBQUNwQyxVQUFJLENBQUMsWUFBWSxNQUFNLFdBQVcsRUFBRyxRQUFPLENBQUM7QUFDN0MsVUFBSTtBQUNGLGNBQU0sTUFBTUEsY0FBYSxPQUFPLENBQUMsUUFBUSxRQUFRLGVBQWUsR0FBRyxLQUFLLEdBQUc7QUFBQSxVQUN6RSxLQUFLO0FBQUEsVUFDTCxVQUFVO0FBQUEsVUFDVixPQUFPLENBQUMsVUFBVSxRQUFRLE1BQU07QUFBQSxVQUNoQyxTQUFTO0FBQUEsUUFDWCxDQUFDO0FBQ0QsZUFBTyxlQUFlLEdBQUc7QUFBQSxNQUMzQixRQUFRO0FBQ04sZUFBTyxDQUFDO0FBQUEsTUFDVjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0Y7QUFVTyxTQUFTLHdCQUF3QixLQUE0QjtBQUNsRSxRQUFNLFdBQVcsZ0JBQWdCLEdBQUc7QUFDcEMsTUFBSSxDQUFDLFVBQVU7QUFHYixXQUFPLEVBQUUsS0FBSyxNQUFNLE9BQU8sUUFBUSxNQUFNLE1BQU07QUFBQSxFQUNqRDtBQUNBLFFBQU0sTUFBTSxZQUFZLFFBQVE7QUFDaEMsU0FBTztBQUFBLElBQ0wsS0FBSyxDQUFDLFdBQVc7QUFDZixVQUFJO0FBQ0YsZUFBVSxlQUFvQixlQUFLLEtBQUssTUFBTSxDQUFDO0FBQUEsTUFDakQsUUFBUTtBQUNOLGVBQU87QUFBQSxNQUNUO0FBQUEsSUFDRjtBQUFBLElBQ0EsUUFBUSxDQUFDLFdBQVc7QUFDbEIsVUFBSTtBQUNGLFFBQUcsY0FBVSxLQUFLLEVBQUUsV0FBVyxLQUFLLENBQUM7QUFDckMsUUFBRyxrQkFBdUIsZUFBSyxLQUFLLE1BQU0sR0FBRyxFQUFFO0FBQy9DLGVBQU87QUFBQSxNQUNULFFBQVE7QUFHTixlQUFPO0FBQUEsTUFDVDtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0Y7OztBSWw0QkEsSUFBTSx1QkFBdUI7QUFTdEIsU0FBUyxvQkFBb0IsV0FBbUM7QUFDckUsTUFBSSxjQUFjLFFBQVEsT0FBTyxjQUFjLFlBQVksRUFBRSxhQUFhLFdBQVksUUFBTztBQUM3RixRQUFNLFVBQVcsVUFBbUM7QUFDcEQsTUFBSSxPQUFPLFlBQVksU0FBVSxRQUFPLFFBQVEsU0FBUyxJQUFJLFVBQVU7QUFDdkUsTUFBSSxNQUFNLFFBQVEsT0FBTyxHQUFHO0FBQzFCLFVBQU0sUUFBUSxRQUFRLE9BQU8sQ0FBQyxNQUFtQixPQUFPLE1BQU0sUUFBUTtBQUN0RSxRQUFJLE1BQU0sV0FBVyxFQUFHLFFBQU87QUFDL0IsVUFBTSxVQUFVLE1BQU0sVUFBVSxDQUFDLE1BQU0sTUFBTSxRQUFRLE1BQU0sU0FBUyxNQUFNLEtBQUs7QUFDL0UsUUFBSSxXQUFXLEtBQUssTUFBTSxVQUFVLENBQUMsTUFBTSxPQUFXLFFBQU8sTUFBTSxVQUFVLENBQUM7QUFDOUUsV0FBTyxNQUFNLEtBQUssR0FBRztBQUFBLEVBQ3ZCO0FBQ0EsU0FBTztBQUNUO0FBRU8sU0FBUyxjQUNkLE1BQW1CLHlCQUF5QixHQUM1QyxZQUEyQiwyQkFBMkIsR0FDdEQsY0FBOEMseUJBSzlDLFdBQW9CLHNCQUNwQjtBQUNBLFNBQU8sT0FBTyxPQUF3QixRQUFxQjtBQUN6RCxRQUFJO0FBR0YsVUFBSSxPQUFPLEtBQUsscUNBQXFDLEVBQUUsV0FBVyxNQUFNLFVBQVUsQ0FBQztBQUVuRixZQUFNLFVBQVUsb0JBQW9CLE1BQU0sVUFBVTtBQUNwRCxVQUFJLFlBQVksS0FBTSxRQUFPLGlCQUFpQixDQUFDLENBQUM7QUFFaEQsWUFBTSxTQUFTLGdCQUFnQixPQUFPO0FBQ3RDLFVBQUksT0FBTyxTQUFTLE9BQVEsUUFBTyxpQkFBaUIsQ0FBQyxDQUFDO0FBRXRELFlBQU0sTUFBTSxNQUFNLE9BQU87QUFDekIsWUFBTSxNQUFNLE9BQU8sU0FBUyxXQUFXLGdCQUFnQixPQUFPLElBQUk7QUFDbEUsWUFBTSxZQUFZLE1BQU0saUJBQWlCLE9BQU8sTUFBTSxLQUFLLEtBQUssS0FBSyxPQUFPLEtBQUs7QUFFakYsWUFBTSxTQUFTLE1BQU0sYUFBYSxXQUFXLEtBQUssV0FBVyxZQUFZLEdBQUcsQ0FBQztBQUM3RSxVQUFJLE9BQU8sYUFBYSxRQUFRO0FBSTlCLFlBQUksT0FBTyxTQUFTLG1CQUFtQixPQUFPLFNBQVMsZUFBZTtBQUNwRSxjQUFJLE9BQU8sS0FBSyxzREFBc0QsRUFBRSxRQUFRLE9BQU8sT0FBTyxDQUFDO0FBQy9GLGlCQUFPLGlCQUFpQixFQUFFLG1CQUFtQixPQUFPLFFBQVEsZUFBZSxPQUFPLE9BQU8sQ0FBQztBQUFBLFFBQzVGO0FBQ0EsZUFBTyxpQkFBaUIsQ0FBQyxDQUFDO0FBQUEsTUFDNUI7QUFFQSxVQUFJLFVBQVU7QUFFWixlQUFPLGlCQUFpQjtBQUFBLFVBQ3RCLG9CQUFvQjtBQUFBLFVBQ3BCLDBCQUEwQixPQUFPO0FBQUEsVUFDakMsZUFBZSxPQUFPO0FBQUEsUUFDeEIsQ0FBQztBQUFBLE1BQ0g7QUFHQSxZQUFNLFVBQVU7QUFBQSxFQUFtRSxPQUFPLE1BQU07QUFDaEcsYUFBTyxpQkFBaUIsRUFBRSxtQkFBbUIsU0FBUyxlQUFlLFFBQVEsQ0FBQztBQUFBLElBQ2hGLFNBQVMsS0FBSztBQUNaLFVBQUksT0FBTyxLQUFLLGtEQUFrRCxFQUFFLElBQUksQ0FBQztBQUN6RSxhQUFPLGlCQUFpQixDQUFDLENBQUM7QUFBQSxJQUM1QjtBQUFBLEVBQ0Y7QUFDRjtBQUVBLElBQU8sZUFBUSxlQUFlLEVBQUUsU0FBUywrQkFBK0IsU0FBUyxJQUFPLEdBQUcsY0FBYyxDQUFDOzs7QUN0STFHLFFBQVEsWUFBSTsiLAogICJuYW1lcyI6IFsicmVzb2x2ZSIsICJleGVjRmlsZVN5bmMiLCAiZnMiLCAibm9kZVBhdGgiLCAiZnMiLCAibm9kZVBhdGgiLCAiZnMiLCAibm9kZVBhdGgiLCAiY2FuZGlkYXRlcyIsICJleGVjRmlsZVN5bmMiXQp9Cg==

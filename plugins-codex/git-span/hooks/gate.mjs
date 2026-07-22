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
function humanStatusLabel(status) {
  return status.toLowerCase().replace(/_/g, " ");
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
    if (inv.subcommand === "status") {
      return { kind: "status" };
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
  if (kind === "status") {
    const [staged2, tracked2] = await Promise.all([git.stagedPaths(cwd), git.trackedModifiedPaths(cwd)]);
    return mergeUniquePaths(staged2, tracked2);
  }
  if (paths && paths.length > 0) {
    return git.pathspecPaths(paths, cwd);
  }
  const staged = await git.stagedPaths(cwd);
  if (!all) return staged;
  const tracked = await git.trackedModifiedPaths(cwd);
  return mergeUniquePaths(staged, tracked);
}
function mergeUniquePaths(...groups) {
  const seen = /* @__PURE__ */ new Set();
  const merged = [];
  for (const group of groups) {
    for (const path of group) {
      if (seen.has(path)) continue;
      seen.add(path);
      merged.push(path);
    }
  }
  return merged;
}
async function evaluateGate(paths, cwd, executors, memoState, mode = "enforce") {
  if (paths.length === 0) return { decision: "allow", kind: "silent" };
  try {
    await executors.fix(paths, cwd);
    const staleRows = await executors.stale(paths, cwd);
    const debtRows = staleRows.filter((row) => isDebt(row.status));
    const semantic = debtRows.filter((row) => !isEnvironmentalStatus(row.status));
    const environmental = debtRows.filter((row) => isEnvironmentalStatus(row.status));
    if (mode === "inform") {
      if (semantic.length > 0) {
        return {
          decision: "allow",
          kind: "semantic-staleness-info",
          findings: semantic,
          reason: renderStalenessReason(semantic, await fetchSpanBlocks(executors, semantic, cwd), "inform")
        };
      }
      if (environmental.length > 0) {
        return {
          decision: "allow",
          kind: "environmental",
          conditions: environmental,
          reason: renderEnvironmentalReason(environmental, await fetchSpanBlocks(executors, environmental, cwd))
        };
      }
      const uncovered2 = await computeUncoveredPaths(paths, cwd, executors);
      if (uncovered2.length === 0) return { decision: "allow", kind: "silent" };
      return {
        decision: "allow",
        kind: "uncovered-writes-info",
        uncovered: uncovered2,
        reason: renderUncoveredReason(uncovered2, "inform")
      };
    }
    let semanticAlreadyPresented = false;
    if (semantic.length > 0) {
      const semanticDigest = gateStateDigest(semantic, []);
      if (!memoState.has(semanticDigest)) {
        if (!memoState.record(semanticDigest)) return { decision: "allow", kind: "silent" };
        return {
          decision: "deny",
          kind: "semantic-staleness",
          findings: semantic,
          reason: renderStalenessReason(semantic, await fetchSpanBlocks(executors, semantic, cwd))
        };
      }
      semanticAlreadyPresented = true;
    }
    if (environmental.length > 0) {
      return {
        decision: "allow",
        kind: "environmental",
        conditions: environmental,
        reason: renderEnvironmentalReason(environmental, await fetchSpanBlocks(executors, environmental, cwd))
      };
    }
    const uncovered = await computeUncoveredPaths(paths, cwd, executors);
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
async function computeUncoveredPaths(paths, cwd, executors) {
  const covering = await executors.list(paths, cwd);
  const covered = new Set(covering.map((row) => row.path));
  const repoRoot = resolveRepoRoot(cwd);
  const gateIgnoreRules = repoRoot ? loadGateIgnore(repoRoot) : [];
  return paths.filter((path) => !covered.has(path) && !isInsideSpanRoot(path) && !isGateIgnored(gateIgnoreRules, path));
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
async function fetchSpanBlocks(executors, rows, cwd) {
  const names = [...new Set(rows.map((row) => row.name))].sort();
  try {
    return await executors.listBlocks(names, cwd);
  } catch {
    return "";
  }
}
function annotateBlocks(blocksText, rows) {
  const remaining = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const group = remaining.get(row.name);
    if (group) group.push(row);
    else remaining.set(row.name, [row]);
  }
  const out = [];
  let pending = [];
  let inBullets = false;
  const closeBullets = () => {
    for (const row of pending) out.push(`- ${anchorText(row)} \u2014 ${humanStatusLabel(row.status)}`);
    pending = [];
    inBullets = false;
  };
  const trimmed = blocksText.trim();
  if (trimmed.length > 0) {
    for (const line of trimmed.split("\n")) {
      const header = /^## (.+)$/.exec(line);
      if (header) {
        closeBullets();
        out.push(line);
        pending = remaining.get(header[1]) ?? [];
        remaining.delete(header[1]);
        inBullets = true;
        continue;
      }
      if (inBullets && line.startsWith("- ")) {
        const addr = line.slice(2);
        let idx = pending.findIndex((row) => anchorText(row) === addr);
        if (idx === -1) idx = pending.findIndex((row) => addr === row.path || addr.startsWith(`${row.path}#`));
        if (idx >= 0) {
          const [row] = pending.splice(idx, 1);
          out.push(`${line} \u2014 ${humanStatusLabel(row.status)}`);
        } else {
          out.push(line);
        }
        continue;
      }
      if (inBullets) closeBullets();
      out.push(line);
    }
    closeBullets();
  }
  for (const [name, group] of remaining) {
    if (out.length > 0) out.push("", "---", "");
    out.push(`## ${name}`);
    for (const row of group) out.push(`- ${anchorText(row)} \u2014 ${humanStatusLabel(row.status)}`);
  }
  return out.join("\n");
}
function renderStalenessReason(findings, blocksText, mode = "enforce") {
  const names = [...new Set(findings.map((row) => row.name))];
  const subject = names.length === 1 ? "an implicit dependency" : "implicit dependencies";
  const name = names.length === 1 ? names[0] : "<name>";
  const action = `\`git span add ${name} <path#Lstart-Lend>\` / \`git span why ${name} -m "..."\``;
  const closing = mode === "enforce" ? `Update the drifted locations or the description \u2014 ${action} \u2014 then retry. If a dependency no longer holds, tell the user instead.` : `Update the drifted locations or the description \u2014 ${action}. If a dependency no longer holds, tell the user instead.`;
  return [
    `This change leaves ${subject} out of date:`,
    "",
    annotateBlocks(blocksText, findings),
    "",
    "---",
    "",
    closing
  ].join("\n");
}
function renderEnvironmentalReason(conditions, blocksText) {
  return [
    "Could not check these implicit dependencies (unfetched LFS, sparse checkout, or similar) \u2014 not blocking:",
    "",
    annotateBlocks(blocksText, conditions),
    "",
    "---",
    "",
    "Fix the checkout/fetch issue if these dependencies need verifying."
  ].join("\n");
}
function renderScanFailedReason(detail) {
  return [
    "The implicit-dependency check could not run, so this change was NOT verified:",
    `  ${detail}`,
    "",
    "The command proceeds anyway. Fix the scan error if verification matters for this change."
  ].join("\n");
}
function renderUncoveredReason(uncovered, mode = "enforce") {
  const lines = uncovered.map((path) => `- ${path}`);
  const body = [
    "<git-span>",
    ...lines,
    "",
    "Determine if these files carry implicit dependencies, then use `git span` to document them:",
    "",
    "`git span add <name> <path#Lstart-Lend> [<path#Lstart-Lend>] ...`",
    '`git span why <name> -m "<why>"`',
    "",
    'The "<why>" is a single present-tense sentence naming what the ranges form together, specific enough to tell whether an edit lands inside it, with no rules or reminders.'
  ];
  if (mode === "enforce") {
    body.push("", "If none exist, retry the command to proceed (one-time check).");
  }
  body.push("", "Load the `git-span:git-span` skill for guidance.", "</git-span>");
  return body.join("\n");
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
    },
    listBlocks: async (names, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || names.length === 0) return "";
      try {
        return execFileSync2("git", ["span", "list", ...names], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs
        });
      } catch {
        return "";
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
      if (command === null) return void 0;
      const parsed = parseGitCommand(command);
      if (parsed.kind === "none") return void 0;
      const cwd = input.cwd ?? "";
      const all = parsed.kind === "commit" ? commitStagesAll(command) : false;
      const changeset = await resolveChangeset(parsed.kind, all, cwd, git, parsed.paths);
      const mode = parsed.kind === "status" ? "inform" : "enforce";
      const result = await evaluateGate(changeset, cwd, executors, memoFactory(cwd), mode);
      if (result.decision !== "deny") {
        if (result.kind === "environmental" || result.kind === "scan-failed") {
          ctx.logger.warn("git-span gate allowed with an unresolved condition", { reason: result.reason });
          return preToolUseOutput({ additionalContext: result.reason, systemMessage: result.reason });
        }
        if (result.kind === "semantic-staleness-info" || result.kind === "uncovered-writes-info") {
          return preToolUseOutput({ additionalContext: result.reason, systemMessage: result.reason });
        }
        return void 0;
      }
      if (hardDeny) {
        return preToolUseOutput({
          permissionDecision: "deny",
          permissionDecisionReason: result.reason,
          systemMessage: result.reason
        });
      }
      const warning = `Could not block this command \u2014 the issue below still needs resolving:
${result.reason}`;
      return preToolUseOutput({ additionalContext: warning, systemMessage: warning });
    } catch (err) {
      ctx.logger.warn("git-span gate failed open on an uncaught error", { err });
      return void 0;
    }
  };
}
var gate_default = preToolUseHook({ matcher: "Bash|shell|exec|local_shell", timeout: 1e4 }, createHandler());

// src/codex/gate-entry.ts
execute(gate_default);
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2NvbnN0YW50cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2dhdGUtY29yZS50cyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL2dhdGUtaWdub3JlLnRzIiwgInNyYy9jb21tb24vc3Bhbi1pZ25vcmUudHMiLCAic3JjL2NvZGV4L2dhdGUudHMiLCAic3JjL2NvZGV4L2dhdGUtZW50cnkudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImV4cG9ydCBjb25zdCBQQUNLQUdFX05BTUUgPSBcIkBnb29kZm9vdC9jb2RleC1ob29rc1wiO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfVElNRU9VVF9NUyA9IDYwMF8wMDA7XG5leHBvcnQgY29uc3QgREVGQVVMVF9TVEFUVVNfTUVTU0FHRSA9IHVuZGVmaW5lZDtcbmV4cG9ydCBjb25zdCBERUZBVUxUX0VTQlVJTERfTE9BREVSUyA9IHtcbiAgICBcIi5tZFwiOiBcInRleHRcIixcbn07XG5leHBvcnQgY29uc3QgSE9PS19GQUNUT1JZX1RPX0VWRU5UID0ge1xuICAgIHByZVRvb2xVc2VIb29rOiBcIlByZVRvb2xVc2VcIixcbiAgICBwb3N0VG9vbFVzZUhvb2s6IFwiUG9zdFRvb2xVc2VcIixcbiAgICBwZXJtaXNzaW9uUmVxdWVzdEhvb2s6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICB1c2VyUHJvbXB0U3VibWl0SG9vazogXCJVc2VyUHJvbXB0U3VibWl0XCIsXG4gICAgc2Vzc2lvblN0YXJ0SG9vazogXCJTZXNzaW9uU3RhcnRcIixcbiAgICBzdWJhZ2VudFN0YXJ0SG9vazogXCJTdWJhZ2VudFN0YXJ0XCIsXG4gICAgc3RvcEhvb2s6IFwiU3RvcFwiLFxuICAgIHN1YmFnZW50U3RvcEhvb2s6IFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgcHJlQ29tcGFjdEhvb2s6IFwiUHJlQ29tcGFjdFwiLFxuICAgIHBvc3RDb21wYWN0SG9vazogXCJQb3N0Q29tcGFjdFwiLFxufTtcbmV4cG9ydCBjb25zdCBFVkVOVFNfV0lUSF9NQVRDSEVSID0gbmV3IFNldChbXG4gICAgXCJQcmVUb29sVXNlXCIsXG4gICAgXCJQb3N0VG9vbFVzZVwiLFxuICAgIFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICBcIlNlc3Npb25TdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgXCJQcmVDb21wYWN0XCIsXG4gICAgXCJQb3N0Q29tcGFjdFwiLFxuXSk7XG5leHBvcnQgY29uc3QgRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQgPSBuZXcgU2V0KFtcIlNlc3Npb25TdGFydFwiLCBcIlVzZXJQcm9tcHRTdWJtaXRcIiwgXCJTdWJhZ2VudFN0YXJ0XCJdKTtcbiIsICJmdW5jdGlvbiBhdHRhY2hNZXRhZGF0YShob29rRXZlbnROYW1lLCBjb25maWcsIGhhbmRsZXIpIHtcbiAgICBjb25zdCBob29rID0gaGFuZGxlcjtcbiAgICBob29rLmhvb2tFdmVudE5hbWUgPSBob29rRXZlbnROYW1lO1xuICAgIGhvb2sudGltZW91dCA9IGNvbmZpZy50aW1lb3V0O1xuICAgIGhvb2suc3RhdHVzTWVzc2FnZSA9IGNvbmZpZy5zdGF0dXNNZXNzYWdlO1xuICAgIGlmIChcIm1hdGNoZXJcIiBpbiBjb25maWcgJiYgdHlwZW9mIGNvbmZpZy5tYXRjaGVyID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGhvb2subWF0Y2hlciA9IGNvbmZpZy5tYXRjaGVyO1xuICAgIH1cbiAgICByZXR1cm4gaG9vaztcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQcmVUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBvc3RUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcGVybWlzc2lvblJlcXVlc3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gdXNlclByb21wdFN1Ym1pdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiVXNlclByb21wdFN1Ym1pdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25TdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU2Vzc2lvblN0YXJ0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3ViYWdlbnRTdGFydFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN0b3BcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN1YmFnZW50U3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlByZUNvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUG9zdENvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbiIsICJpbXBvcnQgeyBjbG9zZVN5bmMsIGV4aXN0c1N5bmMsIG1rZGlyU3luYywgb3BlblN5bmMsIHdyaXRlU3luYyB9IGZyb20gXCJub2RlOmZzXCI7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuY29uc3QgREVGQVVMVF9MT0dfRU5WX1ZBUiA9IFwiQ09ERVhfSE9PS1NfTE9HX0ZJTEVcIjtcbmV4cG9ydCBjbGFzcyBMb2dnZXIge1xuICAgIGhhbmRsZXJzID0gbmV3IE1hcCgpO1xuICAgIGZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIGxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgbG9nRmlsZVBhdGggPSBudWxsO1xuICAgIGN1cnJlbnRIb29rVHlwZTtcbiAgICBjdXJyZW50SW5wdXQ7XG4gICAgY29uc3RydWN0b3IoY29uZmlnID0ge30pIHtcbiAgICAgICAgdGhpcy5sb2dGaWxlUGF0aCA9IGNvbmZpZy5sb2dGaWxlUGF0aCA/PyBwcm9jZXNzLmVudltjb25maWcubG9nRW52VmFyID8/IERFRkFVTFRfTE9HX0VOVl9WQVJdID8/IG51bGw7XG4gICAgfVxuICAgIHNldENvbnRleHQoaG9va1R5cGUsIGlucHV0KSB7XG4gICAgICAgIHRoaXMuY3VycmVudEhvb2tUeXBlID0gaG9va1R5cGU7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gaW5wdXQ7XG4gICAgfVxuICAgIGNsZWFyQ29udGV4dCgpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50SG9va1R5cGUgPSB1bmRlZmluZWQ7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBvbihsZXZlbCwgaGFuZGxlcikge1xuICAgICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKSA/PyBuZXcgU2V0KCk7XG4gICAgICAgIGV4aXN0aW5nLmFkZChoYW5kbGVyKTtcbiAgICAgICAgdGhpcy5oYW5kbGVycy5zZXQobGV2ZWwsIGV4aXN0aW5nKTtcbiAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgIGV4aXN0aW5nLmRlbGV0ZShoYW5kbGVyKTtcbiAgICAgICAgICAgIGlmIChleGlzdGluZy5zaXplID09PSAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5oYW5kbGVycy5kZWxldGUobGV2ZWwpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgIH1cbiAgICBkZWJ1ZyhtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImRlYnVnXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICBpbmZvKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiaW5mb1wiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgd2FybihtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcIndhcm5cIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGVycm9yKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZXJyb3JcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGxvZ0Vycm9yKGVycm9yLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImVycm9yXCIsIGAke21lc3NhZ2V9OiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLCBjb250ZXh0KTtcbiAgICB9XG4gICAgY2xvc2UoKSB7XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgY2xvc2VTeW5jKHRoaXMubG9nRmlsZUZkKTtcbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cbiAgICBlbWl0KGxldmVsLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0ge1xuICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICBsZXZlbCxcbiAgICAgICAgICAgIGhvb2tUeXBlOiB0aGlzLmN1cnJlbnRIb29rVHlwZSxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICAuLi4odGhpcy5jdXJyZW50SW5wdXQgIT09IHVuZGVmaW5lZCA/IHsgaW5wdXQ6IHRoaXMuY3VycmVudElucHV0IH0gOiB7fSksXG4gICAgICAgICAgICAuLi4oY29udGV4dCAhPT0gdW5kZWZpbmVkID8geyBjb250ZXh0IH0gOiB7fSksXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMud3JpdGVUb0ZpbGUoZXZlbnQpO1xuICAgICAgICB0aGlzLmhhbmRsZXJzLmdldChsZXZlbCk/LmZvckVhY2goKGhhbmRsZXIpID0+IHtcbiAgICAgICAgICAgIGhhbmRsZXIoZXZlbnQpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgd3JpdGVUb0ZpbGUoZXZlbnQpIHtcbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZVBhdGggPT09IG51bGwpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXRoaXMuZmlsZUluaXRpYWxpemVkKSB7XG4gICAgICAgICAgICB0aGlzLmZpbGVJbml0aWFsaXplZCA9IHRydWU7XG4gICAgICAgICAgICBjb25zdCBsb2dEaXIgPSBkaXJuYW1lKHRoaXMubG9nRmlsZVBhdGgpO1xuICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKGxvZ0RpcikpIHtcbiAgICAgICAgICAgICAgICBta2RpclN5bmMobG9nRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gb3BlblN5bmModGhpcy5sb2dGaWxlUGF0aCwgXCJhXCIpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgd3JpdGVTeW5jKHRoaXMubG9nRmlsZUZkLCBgJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuYCk7XG4gICAgICAgIH1cbiAgICB9XG59XG5leHBvcnQgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcigpO1xuIiwgImV4cG9ydCBjb25zdCBFWElUX0NPREVTID0ge1xuICAgIFNVQ0NFU1M6IDAsXG4gICAgRVJST1I6IDEsXG4gICAgQkxPQ0s6IDIsXG59O1xuZXhwb3J0IGNsYXNzIEJsb2NrRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gICAgcmVhc29uO1xuICAgIGNvbnN0cnVjdG9yKHJlYXNvbikge1xuICAgICAgICBzdXBlcihyZWFzb24pO1xuICAgICAgICB0aGlzLm5hbWUgPSBcIkJsb2NrRXJyb3JcIjtcbiAgICAgICAgdGhpcy5yZWFzb24gPSByZWFzb247XG4gICAgfVxufVxuZnVuY3Rpb24gb21pdFVuZGVmaW5lZCh2YWx1ZSkge1xuICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModmFsdWUpLmZpbHRlcigoWywgZW50cnldKSA9PiBlbnRyeSAhPT0gdW5kZWZpbmVkKSk7XG59XG5mdW5jdGlvbiBidWlsZE91dHB1dCh0eXBlLCBzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiB7XG4gICAgICAgIF90eXBlOiB0eXBlLFxuICAgICAgICBzdGRvdXQ6IG9taXRVbmRlZmluZWQoc3Rkb3V0KSxcbiAgICAgICAgLi4uKHN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRlcnIgfSA6IHt9KSxcbiAgICB9O1xufVxuZXhwb3J0IGZ1bmN0aW9uIHJhd091dHB1dChzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlJhd1wiLCBzdGRvdXQsIHN0ZGVycik7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvbiAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy51cGRhdGVkSW5wdXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBoYXNTcGVjaWZpY1xuICAgICAgICA/IG9taXRVbmRlZmluZWQoe1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQcmVUb29sVXNlXCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvbjogb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb24sXG4gICAgICAgICAgICBwZXJtaXNzaW9uRGVjaXNpb25SZWFzb246IG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uLFxuICAgICAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgfSlcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlVG9vbFVzZVwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZUxlZ2FjeUJsb2NrT3V0cHV0KG9wdGlvbnMpIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVUb29sVXNlXCIsIHtcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fCBvcHRpb25zLnVwZGF0ZWRNQ1BUb29sT3V0cHV0ICE9PSB1bmRlZmluZWQ7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gaGFzU3BlY2lmaWNcbiAgICAgICAgPyBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUG9zdFRvb2xVc2VcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICAgICAgdXBkYXRlZE1DUFRvb2xPdXRwdXQ6IG9wdGlvbnMudXBkYXRlZE1DUFRvb2xPdXRwdXQsXG4gICAgICAgIH0pXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBvc3RUb29sVXNlXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uUmVxdWVzdE91dHB1dChvcHRpb25zKSB7XG4gICAgY29uc3QgZGVjaXNpb24gPSBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgYmVoYXZpb3I6IG9wdGlvbnMuYmVoYXZpb3IsXG4gICAgICAgIG1lc3NhZ2U6IG9wdGlvbnMubWVzc2FnZSxcbiAgICAgICAgaW50ZXJydXB0OiBvcHRpb25zLmludGVycnVwdCxcbiAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgdXBkYXRlZFBlcm1pc3Npb25zOiBvcHRpb25zLnVwZGF0ZWRQZXJtaXNzaW9ucyxcbiAgICB9KTtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSB7XG4gICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICAgICAgZGVjaXNpb24sXG4gICAgfTtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQZXJtaXNzaW9uUmVxdWVzdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiVXNlclByb21wdFN1Ym1pdFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiVXNlclByb21wdFN1Ym1pdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiU2Vzc2lvblN0YXJ0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTZXNzaW9uU3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlN1YmFnZW50U3RhcnRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3RvcE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTdG9wXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdG9wT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RvcFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlQ29tcGFjdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdENvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUG9zdENvbXBhY3RcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgIH0pO1xufVxuIiwgImltcG9ydCB7IEVWRU5UU19XSVRIX1RFWFRfT1VUUFVUIH0gZnJvbSBcIi4vY29uc3RhbnRzLmpzXCI7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tIFwiLi9sb2dnZXIuanNcIjtcbmltcG9ydCB7IEJsb2NrRXJyb3IsIEVYSVRfQ09ERVMsIHNlc3Npb25TdGFydE91dHB1dCwgc3ViYWdlbnRTdGFydE91dHB1dCwgdXNlclByb21wdFN1Ym1pdE91dHB1dCwgfSBmcm9tIFwiLi9vdXRwdXRzLmpzXCI7XG5hc3luYyBmdW5jdGlvbiByZWFkU3RkaW4oKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgY2h1bmtzID0gW107XG4gICAgICAgIHByb2Nlc3Muc3RkaW4uc2V0RW5jb2RpbmcoXCJ1dGYtOFwiKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImRhdGFcIiwgKGNodW5rKSA9PiBjaHVua3MucHVzaChjaHVuaykpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZW5kXCIsICgpID0+IHJlc29sdmUoY2h1bmtzLmpvaW4oXCJcIikpKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImVycm9yXCIsIHJlamVjdCk7XG4gICAgfSk7XG59XG5mdW5jdGlvbiBwYXJzZVN0ZGluSW5wdXQoc3RkaW5Db250ZW50KSB7XG4gICAgcmV0dXJuIEpTT04ucGFyc2Uoc3RkaW5Db250ZW50KTtcbn1cbmZ1bmN0aW9uIHdyaXRlU3Rkb3V0KG91dHB1dCkge1xuICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKEpTT04uc3RyaW5naWZ5KG91dHB1dC5zdGRvdXQpKTtcbn1cbmZ1bmN0aW9uIG5vcm1hbGl6ZVN0cmluZ091dHB1dChob29rRXZlbnROYW1lLCByZXN1bHQpIHtcbiAgICBpZiAoIUVWRU5UU19XSVRIX1RFWFRfT1VUUFVULmhhcyhob29rRXZlbnROYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7aG9va0V2ZW50TmFtZX0gaG9va3MgY2Fubm90IHJldHVybiBwbGFpbiB0ZXh0YCk7XG4gICAgfVxuICAgIGlmIChob29rRXZlbnROYW1lID09PSBcIlNlc3Npb25TdGFydFwiKSB7XG4gICAgICAgIHJldHVybiBzZXNzaW9uU3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICBpZiAoaG9va0V2ZW50TmFtZSA9PT0gXCJTdWJhZ2VudFN0YXJ0XCIpIHtcbiAgICAgICAgcmV0dXJuIHN1YmFnZW50U3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICByZXR1cm4gdXNlclByb21wdFN1Ym1pdE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gY29udmVydFRvSG9va091dHB1dChvdXRwdXQpIHtcbiAgICByZXR1cm4gb3V0cHV0LnN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQsIHN0ZGVycjogb3V0cHV0LnN0ZGVyciB9IDogeyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQgfTtcbn1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBleGVjdXRlKGhvb2tGbikge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHN0ZGluQ29udGVudCA9IGF3YWl0IHJlYWRTdGRpbigpO1xuICAgICAgICBjb25zdCBpbnB1dCA9IHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpO1xuICAgICAgICBsb2dnZXIuc2V0Q29udGV4dChob29rRm4uaG9va0V2ZW50TmFtZSwgaW5wdXQpO1xuICAgICAgICBjb25zdCBjb250ZXh0ID0geyBsb2dnZXIgfTtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaG9va0ZuKGlucHV0LCBjb250ZXh0KTtcbiAgICAgICAgbGV0IG91dHB1dCA9IHsgc3Rkb3V0OiB7fSB9O1xuICAgICAgICBpZiAodHlwZW9mIHJlc3VsdCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgb3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChub3JtYWxpemVTdHJpbmdPdXRwdXQoaG9va0ZuLmhvb2tFdmVudE5hbWUsIHJlc3VsdCkpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHJlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBvdXRwdXQgPSBjb252ZXJ0VG9Ib29rT3V0cHV0KHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgICAgd3JpdGVTdGRvdXQob3V0cHV0KTtcbiAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuU1VDQ0VTUyk7XG4gICAgfVxuICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBCbG9ja0Vycm9yKSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtlcnJvci5yZWFzb259XFxuYCk7XG4gICAgICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5CTE9DSyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke2Vycm9yLnN0YWNrID8/IGVycm9yLm1lc3NhZ2V9XFxuYCk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtTdHJpbmcoZXJyb3IpfVxcbmApO1xuICAgICAgICB9XG4gICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLkVSUk9SKTtcbiAgICB9XG4gICAgZmluYWxseSB7XG4gICAgICAgIGxvZ2dlci5jbGVhckNvbnRleHQoKTtcbiAgICAgICAgbG9nZ2VyLmNsb3NlKCk7XG4gICAgfVxufVxuIiwgIi8qKlxuICogSGFybmVzcy1hZ25vc3RpYyBnYXRlIGNvcmUgKFBoYXNlIDMuMSBcdTIwMTQgY29udHJhY3QgYW5kIHN0dWJzKS5cbiAqXG4gKiBUaGlzIG1vZHVsZSBkZWNsYXJlcyB0aGUgUHJlVG9vbFVzZSBcImdhdGVcIiB0aGF0IGJvdGggdGhlIENsYXVkZSAoYEJhc2hgKSBhbmRcbiAqIENvZGV4IChzaGVsbC9leGVjKSBhZGFwdGVycyB3aWxsIGRyaXZlOiB3aGVuIHRoZSBhZ2VudCBydW5zIGBnaXQgY29tbWl0YCBvclxuICogYGdpdCBwdXNoYCBhbmQgdGhlIGNoYW5nZXNldCBpdCBpcyBhYm91dCB0byBsYW5kIGNhcnJpZXMgcmVhbCBzcGFuIGRlYnQsIHRoZVxuICogY29tbWFuZCBpcyBoZWxkIHdpdGggYSBjaGVja2xpc3Q7IHBvc2l0aW9uYWwgZHJpZnQgdGhlIHRvdWNoIGhvb2sgaGFzIGJlZW5cbiAqIGhlYWxpbmcgYWxsIGFsb25nIG5ldmVyIGJsb2Nrcy4gTGlrZSB7QGxpbmsgZmlsZTovLy4vdG91Y2gtY29yZS50c30gaXQgaW1wb3J0c1xuICogbm90aGluZyBmcm9tIGVpdGhlciBob29rIFNESyBhbmQgaXMgdHlwZWQgc3RydWN0dXJhbGx5LCBwZXIgdGhlIGBjb21tb24vYFxuICogbGF5ZXIgY29udmVudGlvbjogYWRhcHRlcnMgdHJhbnNsYXRlIHRoZWlyIFNESy1zcGVjaWZpYyBob29rIGlucHV0IGludG8gYVxuICogY29tbWFuZCBzdHJpbmcgKyBjd2QsIGluamVjdCBleGVjdXRpb24vc3RhdGUgZGVwZW5kZW5jaWVzLCBhbmQgdHJhbnNsYXRlIHRoZVxuICogcmV0dXJuZWQge0BsaW5rIEdhdGVSZXN1bHR9IGludG8gdGhlaXIgb3duIGRlbnkvYWxsb3cgb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogZ2F0ZS1jb3JlIGlzIGEgc2libGluZyBvZiB0b3VjaC1jb3JlLCBub3QgYSBkZXBlbmRlbnQ6IHRoZSB0d28gY29yZXMgYXJlXG4gKiBpbmRlcGVuZGVudCBhbmQgdGhpcyBtb2R1bGUgaW1wb3J0cyBub3RoaW5nIGZyb20gYHRvdWNoLWNvcmUudHNgLlxuICpcbiAqIFJldXNlZCBmcm9tIHRoZSBzaGFyZWQga2VybmVsIChub3QgcmVkZWZpbmVkKTogYGlzRGVidCgpYCAodGhlIHNpbmdsZVxuICogc291cmNlIG9mIHRydXRoIGZvciB0aGUgc2VtYW50aWMtb25seSBkZWJ0IGludmFyaWFudCBcdTIwMTQgYE1PVkVEYCBhbmRcbiAqIGBSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgYXJlIG5ldmVyIGRlYnQpLCB0aGUgcG9yY2VsYWluIHN0YXR1cyB2b2NhYnVsYXJ5XG4gKiAoYFBvcmNlbGFpblN0YXR1c2AvYFBvcmNlbGFpblJvd2AvYFN0YWxlUG9yY2VsYWluUm93YCksIGFuZCBgZ2F0ZU1lbW9EaXIoKWBcbiAqICh0aGUgYDxnaXQtY29tbW9uLWRpcj4vZ2l0LXNwYW4vZ2F0ZS9gIHBhdGggdGhlIGRpc2stYmFja2VkXG4gKiB7QGxpbmsgR2F0ZU1lbW9TdGF0ZX0gd2lsbCBwZXJzaXN0IHVuZGVyKSBcdTIwMTQgYWxsIGZyb20gYWdlbnQtaG9va3MtY29tbW9uLnRzLlxuICpcbiAqIEV2ZXJ5IGZ1bmN0aW9uIHdob3NlIHJlc3VsdCBkZXBlbmRzIG9uIHJlYWwgbG9naWMgaXMgYSBgTm90IEltcGxlbWVudGVkYCBzdHViXG4gKiBpbiB0aGlzIHBoYXNlOyBQaGFzZSAzLjIgd3JpdGVzIHNraXBwZWQgY2hlY2tzIGFnYWluc3QgdGhlc2Ugc2lnbmF0dXJlcyBhbmRcbiAqIFBoYXNlIDMuMyBpbXBsZW1lbnRzIHRoZW0uXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tICdub2RlOmNyeXB0byc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQge1xuICBnYXRlTWVtb0RpcixcbiAgaHVtYW5TdGF0dXNMYWJlbCxcbiAgaXNEZWJ0LFxuICBpc0Vudmlyb25tZW50YWxTdGF0dXMsXG4gIGlzSW5zaWRlU3BhblJvb3QsXG4gIHR5cGUgUG9yY2VsYWluUm93LFxuICBwYXJzZVBvcmNlbGFpbixcbiAgcGFyc2VTdGFsZVBvcmNlbGFpbixcbiAgcmVzb2x2ZVJlcG9Sb290LFxuICB0eXBlIFN0YWxlUG9yY2VsYWluUm93LFxuICB0b1Bvc2l4XG59IGZyb20gJy4vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcbmltcG9ydCB7IGlzR2F0ZUlnbm9yZWQsIGxvYWRHYXRlSWdub3JlIH0gZnJvbSAnLi9nYXRlLWlnbm9yZS5qcyc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2Nhbi1mYWlsdXJlIHNpZ25hbFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmFpc2VkIGJ5IHRoZSBgc3RhbGVgIGV4ZWN1dG9yIHdoZW4gYGdpdCBzcGFuIHN0YWxlYCBjb3VsZCBub3QgKmNvbXBsZXRlKiBpdHNcbiAqIHNjb3BlZCBzY2FuIFx1MjAxNCBhcyBvcHBvc2VkIHRvIGNvbXBsZXRpbmcgYW5kIHJlcG9ydGluZyBkcmlmdC4gYGdpdCBzcGFuIHN0YWxlYFxuICogZXhpdHMgbm9uLXplcm8gaW4gdHdvIHZlcnkgZGlmZmVyZW50IHNpdHVhdGlvbnM6IG9uIGxlZ2l0aW1hdGUgZHJpZnQgKHJlYWxcbiAqIHBvcmNlbGFpbiByb3dzIG9uIHN0ZG91dCkgYW5kIG9uIGEgaGFyZCBzY2FuIGZhaWx1cmUgKGUuZy4gYW4gdW5yZWFkYWJsZVxuICogYW5jaG9yIGZpbGUgYWJvcnRzIHRoZSB3aG9sZSBzY29wZWQgcXVlcnksIGxlYXZpbmcgc3Rkb3V0IGVtcHR5IGFuZCBhbiBlcnJvclxuICogb24gc3RkZXJyKS4gT25seSB0aGUgc2Vjb25kIHRocm93cyB0aGlzLCBzbyB7QGxpbmsgZXZhbHVhdGVHYXRlfSBjYW4gdGVsbCBhXG4gKiBzY2FuIHRoYXQgKnJhbiBjbGVhbiogKGVtcHR5IHJvd3MpIGZyb20gb25lIHRoYXQgKm5ldmVyIHJhbiogKGVtcHR5IHJvd3NcbiAqIGJlY2F1c2UgaXQgYWJvcnRlZCkgYW5kIHJlZnVzZSB0byByZWFkIHRoZSBsYXR0ZXIgYXMgYSBjbGVhbiBwYXNzLiBgZGV0YWlsYFxuICogY2FycmllcyB0aGUgQ0xJJ3Mgc3RkZXJyIGZvciB0aGUgc3VyZmFjZWQgcmVhc29uLlxuICovXG5leHBvcnQgY2xhc3MgR2F0ZVNjYW5FcnJvciBleHRlbmRzIEVycm9yIHtcbiAgcmVhZG9ubHkgZGV0YWlsOiBzdHJpbmc7XG4gIGNvbnN0cnVjdG9yKGRldGFpbDogc3RyaW5nKSB7XG4gICAgc3VwZXIoYGdpdCBzcGFuIHN0YWxlIGNvdWxkIG5vdCBjb21wbGV0ZSBpdHMgc2NhbjogJHtkZXRhaWx9YCk7XG4gICAgdGhpcy5uYW1lID0gJ0dhdGVTY2FuRXJyb3InO1xuICAgIHRoaXMuZGV0YWlsID0gZGV0YWlsO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQ29tbWFuZCBwYXJzaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBUaGUga2luZCBvZiBnYXRlZCBnaXQgY29tbWFuZCBhIHNoZWxsIGNvbW1hbmQgc3RyaW5nIHJlc29sdmVzIHRvLiBgJ25vbmUnYFxuICogaXMgdGhlIGNvbnNlcnZhdGl2ZSBmYWlsLW9wZW4gYW5zd2VyOiBhbnkgc2hhcGUge0BsaW5rIHBhcnNlR2l0Q29tbWFuZH0gZG9lc1xuICogbm90IGNvbmZpZGVudGx5IHJlY29nbml6ZSBhcyBhIGBnaXQgY29tbWl0YC9gZ2l0IHB1c2hgL2BnaXQgc3RhdHVzYCBtYXBzIHRvXG4gKiBgJ25vbmUnYCBhbmQgdGhlIGdhdGUgYWxsb3dzIHRoZSBjb21tYW5kIHRocm91Z2ggdW50b3VjaGVkLiBgJ3N0YXR1cydgIGlzXG4gKiBuZXZlciBkZW5pZWQgXHUyMDE0IHtAbGluayBldmFsdWF0ZUdhdGV9J3MgYCdpbmZvcm0nYCBtb2RlIG9ubHkgZXZlciBhbGxvd3MsXG4gKiBzdXJmYWNpbmcgYW55IHNwYW4gZGVidCBhcyBhZHZpc29yeSBjb250ZXh0LlxuICovXG5leHBvcnQgdHlwZSBHaXRDb21tYW5kS2luZCA9ICdjb21taXQnIHwgJ3B1c2gnIHwgJ3N0YXR1cycgfCAnbm9uZSc7XG5cbi8qKlxuICogVGhlIHJlc3VsdCBvZiBwYXJzaW5nIGEgc2hlbGwgY29tbWFuZCBzdHJpbmcgZm9yIGEgZ2F0ZWQgZ2l0IGludm9jYXRpb24uXG4gKlxuICogYHBhdGhzYCBjYXJyaWVzIG9ubHkgd2hhdCBpcyBwYXJzZWFibGUgZnJvbSB0aGUgY29tbWFuZCBsaW5lIGl0c2VsZiBcdTIwMTQgdGhlXG4gKiBleHBsaWNpdCBwYXRoc3BlY3MgYSBgZ2l0IGNvbW1pdCAtLSA8cGF0aD5cdTIwMjZgIGZvcm0gbmFtZXMuIEl0IGlzIGRlbGliZXJhdGVseVxuICogKm5vdCogdGhlIGNoYW5nZXNldDogdGhlIGZ1bGxlciByZXNvbHV0aW9uIChzdGFnZWQgZmlsZXMsIHRoZSBgLWFgL2AtYW1gXG4gKiBleHBhbnNpb24gYWdhaW5zdCB0cmFja2VkLW1vZGlmaWVkIGZpbGVzLCB0aGUgb3V0Z29pbmcgcHVzaCByYW5nZSkgaXNcbiAqIHtAbGluayByZXNvbHZlQ2hhbmdlc2V0fSdzIGpvYiwgZHJpdmVuIGZyb20gdGhlIHJlcG8gc3RhdGUsIG5vdCBmcm9tIHRoZVxuICogY29tbWFuZCB0ZXh0LiBgcGF0aHNgIGlzIG9taXR0ZWQgd2hlbiB0aGUgY29tbWFuZCBuYW1lcyBubyBleHBsaWNpdFxuICogcGF0aHNwZWMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGFyc2VkR2l0Q29tbWFuZCB7XG4gIGtpbmQ6IEdpdENvbW1hbmRLaW5kO1xuICBwYXRocz86IHN0cmluZ1tdO1xufVxuXG4vKipcbiAqIFdvcmQtYm91bmRhcnkgcGFyc2Ugb2YgYSBgZ2l0IGNvbW1pdGAgLyBgZ2l0IHB1c2hgIC8gYGdpdCBzdGF0dXNgIGludm9jYXRpb25cbiAqIGVtYmVkZGVkIGluIGFuIGFyYml0cmFyeSBzaGVsbCBjb21tYW5kIHN0cmluZy5cbiAqXG4gKiBNdXN0IHJlY29nbml6ZSB0aGUgcmVhbCBzaGFwZXMgY29tbWl0cywgcHVzaGVzLCBhbmQgc3RhdHVzIGNoZWNrcyBhcnJpdmUgaW46XG4gKiBjaGFpbmVkIGNvbW1hbmRzIChgXHUyMDI2ICYmIGdpdCBjb21taXQgXHUyMDI2YCwgYFx1MjAyNjsgZ2l0IHB1c2hgLCBgXHUyMDI2IHwgXHUyMDI2YCksIGFuIGV4cGxpY2l0XG4gKiByZXBvIHZpYSBgZ2l0IC1DIDxkaXI+IGNvbW1pdCBcdTIwMjZgLCB0cmFpbGluZyBwYXRoc3BlY3MgYWZ0ZXIgYC0tYCwgdGhlXG4gKiBgLWFgL2AtYW1gIFwiY29tbWl0IGFsbCB0cmFja2VkLW1vZGlmaWVkXCIgZm9ybXMsIGFuZCBpbnZvY2F0aW9uIGZyb20gYSBjd2RcbiAqIGJlbG93IHRoZSByZXBvIHJvb3QuIE1hdGNoaW5nIGlzIG9uIHdvcmQgYm91bmRhcmllcywgbmV2ZXIgc3Vic3RyaW5nOiBhIHBhdGhcbiAqIG9yIG1lc3NhZ2UgdGhhdCBtZXJlbHkgY29udGFpbnMgdGhlIHRleHQgYGdpdCBjb21taXRgIG11c3Qgbm90IHRyaXAgdGhlXG4gKiBnYXRlLlxuICpcbiAqIENvbnNlcnZhdGl2ZSBieSBjb250cmFjdDogdGhpcyBpcyB0aGUgZmFpbC1vcGVuIHBvaW50IGF0IHRoZSBwYXJzZSBsYXllciwgbm90XG4gKiBhIHBsYWNlIHRvIGd1ZXNzLiBBbnkgY29tbWFuZCB3aG9zZSBzaGFwZSBpcyBub3QgY29uZmlkZW50bHkgYSBnYXRlZFxuICogYGdpdCBjb21taXRgL2BnaXQgcHVzaGAvYGdpdCBzdGF0dXNgIFx1MjAxNCBhbiB1bmZhbWlsaWFyIHN1YmNvbW1hbmQsIGFuIGFsaWFzLCBhblxuICogb2JmdXNjYXRlZCBvciBkeW5hbWljYWxseS1idWlsdCBpbnZvY2F0aW9uIFx1MjAxNCByZXR1cm5zIGB7IGtpbmQ6ICdub25lJyB9YCBzbyB0aGVcbiAqIGdhdGUgYWxsb3dzIGl0IHJhdGhlciB0aGFuIGRlbnlpbmcgb24gYSBzaGFreSByZWFkLiAoU2VlIENBUkQubWQgXCJSaXNrcyBhbmRcbiAqIHJlcXVpcmVkIHNwaWtlcyBcdTIxOTIgQ29tbWFuZCBwYXJzaW5nXCIgYW5kIGRlc2lnbi1kZWNpc2lvbnMubWQgIzEuKVxuICpcbiAqIEBwYXJhbSBjb21tYW5kIFRoZSByYXcgc2hlbGwgY29tbWFuZCBzdHJpbmcgZnJvbSB0aGUgaG9vaydzIHRvb2wgaW5wdXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUdpdENvbW1hbmQoY29tbWFuZDogc3RyaW5nKTogUGFyc2VkR2l0Q29tbWFuZCB7XG4gIGZvciAoY29uc3Qgc2VnbWVudCBvZiBzcGxpdFNlZ21lbnRzKGNvbW1hbmQpKSB7XG4gICAgY29uc3QgaW52ID0gbWF0Y2hHaXRJbnZvY2F0aW9uKHRva2VuaXplKHNlZ21lbnQpKTtcbiAgICBpZiAoIWludikgY29udGludWU7XG4gICAgaWYgKGludi5zdWJjb21tYW5kID09PSAnY29tbWl0Jykge1xuICAgICAgY29uc3QgZGFzaERhc2ggPSBpbnYuYXJncy5pbmRleE9mKCctLScpO1xuICAgICAgY29uc3QgcGF0aHMgPSBkYXNoRGFzaCA+PSAwID8gaW52LmFyZ3Muc2xpY2UoZGFzaERhc2ggKyAxKS5maWx0ZXIoKHApID0+IHAubGVuZ3RoID4gMCkgOiBbXTtcbiAgICAgIHJldHVybiBwYXRocy5sZW5ndGggPiAwID8geyBraW5kOiAnY29tbWl0JywgcGF0aHMgfSA6IHsga2luZDogJ2NvbW1pdCcgfTtcbiAgICB9XG4gICAgaWYgKGludi5zdWJjb21tYW5kID09PSAncHVzaCcpIHtcbiAgICAgIHJldHVybiB7IGtpbmQ6ICdwdXNoJyB9O1xuICAgIH1cbiAgICBpZiAoaW52LnN1YmNvbW1hbmQgPT09ICdzdGF0dXMnKSB7XG4gICAgICByZXR1cm4geyBraW5kOiAnc3RhdHVzJyB9O1xuICAgIH1cbiAgICAvLyBBIHJlY29nbml6ZWQgYGdpdGAgaW52b2NhdGlvbiB0aGF0IGlzIG5laXRoZXIgY29tbWl0LCBwdXNoLCBub3Igc3RhdHVzXG4gICAgLy8gKGUuZy4gYGdpdCBhZGQgLiAmJiBnaXQgY29tbWl0IFx1MjAyNmApOiBrZWVwIHNjYW5uaW5nIGxhdGVyIHNlZ21lbnRzLlxuICB9XG4gIHJldHVybiB7IGtpbmQ6ICdub25lJyB9O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYSBgZ2l0IGNvbW1pdGAgaW4gdGhlIGNvbW1hbmQgaXMgYW4gYC1hYC9gLWFtYC9gLS1hbGxgIGZvcm0gXHUyMDE0IHRoZVxuICogXCJzdGFnZSBhbGwgdHJhY2tlZC1tb2RpZmllZCBmaWxlc1wiIHZhcmlhbnQgd2hvc2UgY2hhbmdlc2V0IHtAbGluayByZXNvbHZlQ2hhbmdlc2V0fVxuICogbXVzdCB3aWRlbiBiZXlvbmQgdGhlIGFscmVhZHktc3RhZ2VkIHNldC5cbiAqXG4gKiBUaGUgYGFsbGAgc2lnbmFsIGlzIGRlbGliZXJhdGVseSAqbm90KiBjYXJyaWVkIG9uIHtAbGluayBQYXJzZWRHaXRDb21tYW5kfVxuICogKHNlZSB0aGF0IHR5cGUncyBkb2MpOiB0aGUgYWRhcHRlciBkZXJpdmVzIGl0IGhlcmUgZnJvbSB0aGUgc2FtZSBjb21tYW5kIHRleHRcbiAqIGFuZCB0aHJlYWRzIGl0IGludG8ge0BsaW5rIHJlc29sdmVDaGFuZ2VzZXR9IGV4cGxpY2l0bHkuIENvbnNlcnZhdGl2ZTogb25seSBhXG4gKiBzaG9ydC1mbGFnIGdyb3VwIGNvbnRhaW5pbmcgYGFgIChgLWFgLCBgLWFtYCwgYC1tYWApIG9yIGFuIGV4cGxpY2l0IGAtLWFsbGAsXG4gKiBzY2FubmVkIGJlZm9yZSBhbnkgYC0tYCBwYXRoc3BlYyBzZXBhcmF0b3IsIGNvdW50cy5cbiAqXG4gKiBWYWx1ZS10YWtpbmcgY29tbWl0IG9wdGlvbnMgKGAtbWAsIGAtLW1lc3NhZ2VgLCBgLUZgLCBgLUNgLCBcdTIwMjYpIGNvbnN1bWUgdGhlaXJcbiAqIGZvbGxvd2luZyB0b2tlbiwgc28gaXQgaXMgbmV2ZXIgc2Nhbm5lZCBhcyBhIGZsYWc6IGEgbWVzc2FnZSB3b3JkIGxpa2VcbiAqIGAtYW5hbHlzaXNgIGluIGBnaXQgY29tbWl0IC1tIFwiLWFuYWx5c2lzXCJgIG11c3Qgbm90IGJlIG1pc3JlYWQgYXMgdGhlXG4gKiBgLS1hbGxgLWVxdWl2YWxlbnQgc2hvcnQtZmxhZyBjbHVzdGVyIGFuZCB3aWRlbiB0aGUgY2hhbmdlc2V0LlxuICovXG5jb25zdCBDT01NSVRfVkFMVUVfT1BUSU9OUyA9IG5ldyBTZXQoW1xuICAnLW0nLFxuICAnLS1tZXNzYWdlJyxcbiAgJy1GJyxcbiAgJy0tZmlsZScsXG4gICctQycsXG4gICctLXJldXNlLW1lc3NhZ2UnLFxuICAnLWMnLFxuICAnLS1yZWVkaXQtbWVzc2FnZScsXG4gICctLWF1dGhvcicsXG4gICctLWRhdGUnLFxuICAnLXQnLFxuICAnLS10ZW1wbGF0ZScsXG4gICctLWZpeHVwJyxcbiAgJy0tc3F1YXNoJyxcbiAgJy0tdHJhaWxlcicsXG4gICctLWNsZWFudXAnLFxuICAnLS1ncGctc2lnbidcbl0pO1xuXG5leHBvcnQgZnVuY3Rpb24gY29tbWl0U3RhZ2VzQWxsKGNvbW1hbmQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc3BsaXRTZWdtZW50cyhjb21tYW5kKSkge1xuICAgIGNvbnN0IGludiA9IG1hdGNoR2l0SW52b2NhdGlvbih0b2tlbml6ZShzZWdtZW50KSk7XG4gICAgaWYgKCFpbnYgfHwgaW52LnN1YmNvbW1hbmQgIT09ICdjb21taXQnKSBjb250aW51ZTtcbiAgICBjb25zdCBkYXNoRGFzaCA9IGludi5hcmdzLmluZGV4T2YoJy0tJyk7XG4gICAgY29uc3QgZmxhZ0FyZ3MgPSBkYXNoRGFzaCA+PSAwID8gaW52LmFyZ3Muc2xpY2UoMCwgZGFzaERhc2gpIDogaW52LmFyZ3M7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBmbGFnQXJncy5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3QgYXJnID0gZmxhZ0FyZ3NbaV07XG4gICAgICBpZiAoYXJnID09PSAnLS1hbGwnKSByZXR1cm4gdHJ1ZTtcbiAgICAgIC8vIEEgdmFsdWUtdGFraW5nIG9wdGlvbiBjb25zdW1lcyBpdHMgZm9sbG93aW5nIHRva2VuIFx1MjAxNCBza2lwIHRoYXQgdG9rZW4gc29cbiAgICAgIC8vIGEgbWVzc2FnZS9hdXRob3IvZGF0ZSBhcmd1bWVudCBpcyBuZXZlciBzY2FubmVkIGFzIGFuIGAtYWAgY2x1c3Rlci5cbiAgICAgIGlmIChDT01NSVRfVkFMVUVfT1BUSU9OUy5oYXMoYXJnKSkge1xuICAgICAgICBpKys7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKCFhcmcuc3RhcnRzV2l0aCgnLS0nKSAmJiAvXi1bQS1aYS16XSphW0EtWmEtel0qJC8udGVzdChhcmcpKSByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLy8gU2hlbGwgY29udHJvbCBvcGVyYXRvcnMgdGhhdCBzZXBhcmF0ZSBvbmUgc2ltcGxlIGNvbW1hbmQgZnJvbSB0aGUgbmV4dC5cbi8vIFNwbGl0dGluZyBvbiB0aGVzZSAob3V0c2lkZSBxdW90ZXMpIGlzb2xhdGVzIGVhY2ggY29tbWFuZCBzbyBhIGBnaXQgY29tbWl0YC9cbi8vIGBnaXQgcHVzaGAgY2hhaW5lZCBhZnRlciBgJiZgL2A7YC9gfGAgaXMgZm91bmQsIHdoaWxlIHRleHQgaW5zaWRlIGEgcXVvdGVkXG4vLyBhcmd1bWVudCAoYGVjaG8gXCJnaXQgY29tbWl0XCJgKSBzdGF5cyB3aXRoaW4gaXRzIG93biBub24tZ2l0IHNlZ21lbnQuXG5jb25zdCBUV09fQ0hBUl9PUEVSQVRPUlMgPSBuZXcgU2V0KFsnJiYnLCAnfHwnXSk7XG5jb25zdCBPTkVfQ0hBUl9TRVBBUkFUT1JTID0gbmV3IFNldChbJzsnLCAnfCcsICdcXG4nLCAnJicsICcoJywgJyknXSk7XG5cbi8qKiBTcGxpdCBhIHNoZWxsIGNvbW1hbmQgaW50byBzaW1wbGUtY29tbWFuZCBzZWdtZW50cywgcmVzcGVjdGluZyBxdW90ZXMuICovXG5mdW5jdGlvbiBzcGxpdFNlZ21lbnRzKGNvbW1hbmQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgc2VnbWVudHM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjdXJyZW50ID0gJyc7XG4gIGxldCBxdW90ZTogJ1wiJyB8IFwiJ1wiIHwgbnVsbCA9IG51bGw7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgY29tbWFuZC5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGNoID0gY29tbWFuZFtpXTtcbiAgICBpZiAocXVvdGUpIHtcbiAgICAgIGN1cnJlbnQgKz0gY2g7XG4gICAgICBpZiAoY2ggPT09IHF1b3RlKSBxdW90ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSAnXCInIHx8IGNoID09PSBcIidcIikge1xuICAgICAgcXVvdGUgPSBjaDtcbiAgICAgIGN1cnJlbnQgKz0gY2g7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKFRXT19DSEFSX09QRVJBVE9SUy5oYXMoY29tbWFuZC5zbGljZShpLCBpICsgMikpKSB7XG4gICAgICBzZWdtZW50cy5wdXNoKGN1cnJlbnQpO1xuICAgICAgY3VycmVudCA9ICcnO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChPTkVfQ0hBUl9TRVBBUkFUT1JTLmhhcyhjaCkpIHtcbiAgICAgIHNlZ21lbnRzLnB1c2goY3VycmVudCk7XG4gICAgICBjdXJyZW50ID0gJyc7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY3VycmVudCArPSBjaDtcbiAgfVxuICBzZWdtZW50cy5wdXNoKGN1cnJlbnQpO1xuICByZXR1cm4gc2VnbWVudHM7XG59XG5cbi8qKlxuICogVG9rZW5pemUgb25lIHNlZ21lbnQgaW50byBzaGVsbCB3b3JkcywgcmVzcGVjdGluZyBzaW5nbGUvZG91YmxlIHF1b3RlcyBhbmRcbiAqIHN0cmlwcGluZyB0aGUgcXVvdGUgY2hhcmFjdGVycy4gRGVsaWJlcmF0ZWx5IG1pbmltYWwgKG5vIGV4cGFuc2lvbiwgbm9cbiAqIGVzY2FwZSBoYW5kbGluZyBiZXlvbmQgcXVvdGVzKTogdGhlIGdvYWwgaXMgY29uZmlkZW50IHJlY29nbml0aW9uIG9mIGFcbiAqIGBnaXQgY29tbWl0YC9gcHVzaGAgc2hhcGUsIG5vdCBhIGZ1bGwgc2hlbGwgcGFyc2VyLlxuICovXG5mdW5jdGlvbiB0b2tlbml6ZShzZWdtZW50OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHRva2Vuczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGN1cnJlbnQgPSAnJztcbiAgbGV0IGhhcyA9IGZhbHNlO1xuICBsZXQgcXVvdGU6ICdcIicgfCBcIidcIiB8IG51bGwgPSBudWxsO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHNlZ21lbnQubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjaCA9IHNlZ21lbnRbaV07XG4gICAgaWYgKHF1b3RlKSB7XG4gICAgICBpZiAoY2ggPT09IHF1b3RlKSBxdW90ZSA9IG51bGw7XG4gICAgICBlbHNlIGN1cnJlbnQgKz0gY2g7XG4gICAgICBoYXMgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gJ1wiJyB8fCBjaCA9PT0gXCInXCIpIHtcbiAgICAgIHF1b3RlID0gY2g7XG4gICAgICBoYXMgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gJyAnIHx8IGNoID09PSAnXFx0Jykge1xuICAgICAgaWYgKGhhcykge1xuICAgICAgICB0b2tlbnMucHVzaChjdXJyZW50KTtcbiAgICAgICAgY3VycmVudCA9ICcnO1xuICAgICAgICBoYXMgPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjdXJyZW50ICs9IGNoO1xuICAgIGhhcyA9IHRydWU7XG4gIH1cbiAgaWYgKGhhcykgdG9rZW5zLnB1c2goY3VycmVudCk7XG4gIHJldHVybiB0b2tlbnM7XG59XG5cbi8qKiBHaXQgZ2xvYmFsIG9wdGlvbnMgdGhhdCBjb25zdW1lIGEgc2VwYXJhdGUgZm9sbG93aW5nIHZhbHVlIHRva2VuLiAqL1xuY29uc3QgR0lUX1ZBTFVFX09QVElPTlMgPSBuZXcgU2V0KFtcbiAgJy1DJyxcbiAgJy1jJyxcbiAgJy0tZ2l0LWRpcicsXG4gICctLXdvcmstdHJlZScsXG4gICctLW5hbWVzcGFjZScsXG4gICctLXN1cGVyLXByZWZpeCcsXG4gICctLWV4ZWMtcGF0aCcsXG4gICctLWF0dHItc291cmNlJyxcbiAgJy0tY29uZmlnLWVudidcbl0pO1xuXG5pbnRlcmZhY2UgR2l0SW52b2NhdGlvbiB7XG4gIHN1YmNvbW1hbmQ6IHN0cmluZztcbiAgYXJnczogc3RyaW5nW107XG59XG5cbi8qKlxuICogSWYgYSBzZWdtZW50J3MgdG9rZW5zIGFyZSBhIGBnaXQgPHN1YmNvbW1hbmQ+IFx1MjAyNmAgaW52b2NhdGlvbiwgcmV0dXJuIHRoZVxuICogc3ViY29tbWFuZCBhbmQgaXRzIHJlbWFpbmluZyBhcmdzOyBvdGhlcndpc2UgYG51bGxgLiBMZWFkaW5nIGBWQVI9dmFsdWVgXG4gKiBlbnZpcm9ubWVudCBhc3NpZ25tZW50cyBhbmQgYGdpdGAgZ2xvYmFsIG9wdGlvbnMgKGluY2x1ZGluZyB0aGUgdmFsdWUtdGFraW5nXG4gKiBvbmVzKSBhcmUgc2tpcHBlZCBzbyB0aGUgc3ViY29tbWFuZCBpcyBjb3JyZWN0bHkgbG9jYXRlZC5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hHaXRJbnZvY2F0aW9uKHRva2Vuczogc3RyaW5nW10pOiBHaXRJbnZvY2F0aW9uIHwgbnVsbCB7XG4gIGxldCBpID0gMDtcbiAgd2hpbGUgKGkgPCB0b2tlbnMubGVuZ3RoICYmIC9eW0EtWmEtel9dW0EtWmEtejAtOV9dKj0vLnRlc3QodG9rZW5zW2ldKSkgaSsrO1xuICBpZiAoaSA+PSB0b2tlbnMubGVuZ3RoIHx8IHRva2Vuc1tpXSAhPT0gJ2dpdCcpIHJldHVybiBudWxsO1xuICBpKys7XG4gIHdoaWxlIChpIDwgdG9rZW5zLmxlbmd0aCkge1xuICAgIGNvbnN0IHQgPSB0b2tlbnNbaV07XG4gICAgaWYgKHQgPT09ICctLScpIHJldHVybiBudWxsOyAvLyBhIGAtLWAgYmVmb3JlIGFueSBzdWJjb21tYW5kIGlzIG5vdCBhIHNoYXBlIHdlIHJlY29nbml6ZVxuICAgIGlmICghdC5zdGFydHNXaXRoKCctJykpIGJyZWFrO1xuICAgIGkgKz0gR0lUX1ZBTFVFX09QVElPTlMuaGFzKHQpID8gMiA6IDE7XG4gIH1cbiAgaWYgKGkgPj0gdG9rZW5zLmxlbmd0aCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IHN1YmNvbW1hbmQ6IHRva2Vuc1tpXSwgYXJnczogdG9rZW5zLnNsaWNlKGkgKyAxKSB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENoYW5nZXNldCByZXNvbHV0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBUaGUgaW5qZWN0ZWQgZ2l0IHN1cmZhY2Uge0BsaW5rIHJlc29sdmVDaGFuZ2VzZXR9IG5lZWRzIHRvIHR1cm4gYSBwYXJzZWRcbiAqIGNvbW1hbmQgaW50byB0aGUgY29uY3JldGUgbGlzdCBvZiBwYXRocyB0aGF0IHdvdWxkIGxhbmQuIEtlcHQgYXMgbmFycm93IGFzeW5jXG4gKiBmdW5jdGlvbnMgKHJhdGhlciB0aGFuIGEgcmF3IGNvbW1hbmQgcnVubmVyKSBmb2xsb3dpbmcgYHRvdWNoLWNvcmUudHNgJ3NcbiAqIGBUb3VjaEV4ZWN1dG9yc2AgcGF0dGVybiwgc28gUGhhc2UgMy4yJ3MgdGVzdHMgZmFrZSB0aGUgcmVwbyBzdGF0ZSB3aXRob3V0IGFcbiAqIHJlYWwgc3VicHJvY2VzcyBhbmQgdGhlIGNvcmUgbmV2ZXIgc3Bhd25zIG9uZSBpdHNlbGYuXG4gKlxuICogQWxsIHJldHVybmVkIHBhdGhzIGFyZSByZXBvLXJlbGF0aXZlIFBPU0lYIHBhdGhzLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEdpdEV4ZWN1dG9yIHtcbiAgLyoqXG4gICAqIFBhdGhzIHN0YWdlZCBmb3IgdGhlIG5leHQgY29tbWl0IFx1MjAxNCBgZ2l0IGRpZmYgLS1jYWNoZWQgLS1uYW1lLW9ubHlgLiBUaGVzZVxuICAgKiBhcmUgd2hhdCBhIHBsYWluIGBnaXQgY29tbWl0YCB3b3VsZCBsYW5kLlxuICAgKi9cbiAgc3RhZ2VkUGF0aHMoY3dkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZ1tdPjtcbiAgLyoqXG4gICAqIFRyYWNrZWQgZmlsZXMgd2l0aCB1bnN0YWdlZCB3b3JraW5nLXRyZWUgbW9kaWZpY2F0aW9ucyBcdTIwMTRcbiAgICogYGdpdCBkaWZmIC0tbmFtZS1vbmx5YC4gRm9sZGVkIGludG8gdGhlIGNoYW5nZXNldCBvbmx5IGZvciBgLWFgL2AtYW1gXG4gICAqIGZvcm1zLCB3aGljaCBzdGFnZSB0cmFja2VkLW1vZGlmaWVkIGZpbGVzIGltcGxpY2l0bHkgYXQgY29tbWl0IHRpbWUuXG4gICAqL1xuICB0cmFja2VkTW9kaWZpZWRQYXRocyhjd2Q6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nW10+O1xuICAvKipcbiAgICogUGF0aHMgaW4gdGhlIG91dGdvaW5nIHB1c2ggcmFuZ2UgXHUyMDE0IHRoZSBmaWxlcyBjaGFuZ2VkIGJ5IGBAe3V9Li5IRUFEYCwgd2l0aFxuICAgKiBhIG1lcmdlLWJhc2UtYWdhaW5zdC10aGUtZGVmYXVsdC1yZW1vdGUtYnJhbmNoIGZhbGxiYWNrIHdoZW4gbm8gdXBzdHJlYW0gaXNcbiAgICogY29uZmlndXJlZC4gVGhlc2UgYXJlIHdoYXQgYSBgZ2l0IHB1c2hgIHdvdWxkIHB1Ymxpc2guXG4gICAqL1xuICBvdXRnb2luZ1BhdGhzKGN3ZDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmdbXT47XG4gIC8qKlxuICAgKiBQYXRocyB1bmRlciB0aGUgZ2l2ZW4gZXhwbGljaXQgcGF0aHNwZWNzIHdob3NlIHdvcmtpbmctdHJlZSBjb250ZW50IGRpZmZlcnNcbiAgICogZnJvbSBgSEVBRGAgXHUyMDE0IGBnaXQgZGlmZiBIRUFEIC0tbmFtZS1vbmx5IC0tIDxwYXRoc3BlY3M+YC4gVGhpcyBpcyB3aGF0IGFcbiAgICogcGF0aHNwZWMtc2NvcGVkIGNvbW1pdCAoYGdpdCBjb21taXQgLS0gPHBhdGhzcGVjPlx1MjAyNmApIGFjdHVhbGx5IGxhbmRzOiB0aGVcbiAgICogY3VycmVudCB3b3JraW5nLXRyZWUgY29udGVudCBhdCB0aG9zZSBwYXRoc3BlY3MsIHJlZ2FyZGxlc3Mgb2Ygd2hhdCBlbHNlIGlzXG4gICAqIHN0YWdlZC4gVXNlZCB0byBzY29wZSB0aGUgY2hhbmdlc2V0IHdoZW4ge0BsaW5rIFBhcnNlZEdpdENvbW1hbmQucGF0aHN9IGlzXG4gICAqIHByZXNlbnQsIHNvIHRoZSBnYXRlIGV2YWx1YXRlcyBleGFjdGx5IHRoZSBmaWxlcyB0aGlzIGNvbW1pdCB0YWtlcyBcdTIwMTQgbmV2ZXJcbiAgICogYW4gdW5yZWxhdGVkIHN0YWdlZCBmaWxlLCBhbmQgbmV2ZXIgbWlzc2luZyBhIG1vZGlmaWVkLWJ1dC11bnN0YWdlZCBmaWxlXG4gICAqIG5hbWVkIGluIHRoZSBwYXRoc3BlYyAod2hpY2ggYGdpdCBkaWZmIC0tY2FjaGVkYCB3b3VsZCBuZXZlciBzdXJmYWNlKS5cbiAgICovXG4gIHBhdGhzcGVjUGF0aHMocGF0aHM6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nW10+O1xufVxuXG4vKipcbiAqIFJlc29sdmUgdGhlIGNvbmNyZXRlIGxpc3Qgb2YgcmVwby1yZWxhdGl2ZSBwYXRocyBhIGdhdGVkIGNvbW1hbmQgd291bGQgbGFuZCxcbiAqIHNvIHRoZSBnYXRlIGNhbiBzY29wZSBpdHMgc3RhbGVuZXNzL2NvdmVyYWdlIGNoZWNrIHRvIGV4YWN0bHkgdGhhdCBjaGFuZ2VzZXQuXG4gKlxuICogLSBgY29tbWl0YCB3aXRoIGV4cGxpY2l0IGBwYXRoc2AgKGEgYGdpdCBjb21taXQgLS0gPHBhdGhzcGVjPlx1MjAyNmAgZm9ybSk6IG9ubHlcbiAqICAgdGhlIHdvcmtpbmctdHJlZSBjb250ZW50IHVuZGVyIHRob3NlIHBhdGhzcGVjcyAoYHBhdGhzcGVjUGF0aHNgKSwgc2luY2UgYVxuICogICBwYXRoc3BlYy1zY29wZWQgY29tbWl0IGxhbmRzIGV4YWN0bHkgdGhhdCwgcmVnYXJkbGVzcyBvZiB0aGUgcmVzdCBvZiB0aGVcbiAqICAgc3RhZ2VkIHNldC4gYGFsbGAgaXMgaWdub3JlZCBcdTIwMTQgYC1hYCBhbmQgYW4gZXhwbGljaXQgcGF0aHNwZWMgZG8gbm90IGNvbWJpbmUuXG4gKiAtIGBjb21taXRgLCBubyBgcGF0aHNgOiB0aGUgc3RhZ2VkIHBhdGhzLCBwbHVzIFx1MjAxNCB3aGVuIGBhbGxgIGlzIHRydWUgKHRoZVxuICogICBjb21tYW5kIHdhcyBhbiBgLWFgL2AtYW1gIGZvcm0pIFx1MjAxNCB0aGUgdHJhY2tlZC1tb2RpZmllZCBwYXRocyB0aG9zZSBmb3Jtc1xuICogICBzdGFnZSBpbXBsaWNpdGx5LlxuICogLSBgcHVzaGA6IHRoZSBvdXRnb2luZyByYW5nZSBgQHt1fS4uSEVBRGAsIHdpdGggYSBtZXJnZS1iYXNlIGZhbGxiYWNrIHdoZW4gbm9cbiAqICAgdXBzdHJlYW0gaXMgY29uZmlndXJlZC4gYGFsbGAvYHBhdGhzYCBhcmUgbm90IG1lYW5pbmdmdWwgZm9yIGEgcHVzaCBhbmQgYXJlXG4gKiAgIGlnbm9yZWQuXG4gKiAtIGBzdGF0dXNgOiB0aGUgc3RhZ2VkIHBhdGhzIHBsdXMgdGhlIHRyYWNrZWQtbW9kaWZpZWQgcGF0aHMsIGRlZHVwbGljYXRlZCBcdTIwMTRcbiAqICAgdGhlIHNhbWUgd29ya2luZy10cmVlIHBpY3R1cmUgYGdpdCBzdGF0dXNgIGl0c2VsZiBwcmludHMsIHByZXZpZXdlZCBmb3JcbiAqICAgc3BhbiBkZWJ0LiBgYWxsYC9gcGF0aHNgIGFyZSBub3QgbWVhbmluZ2Z1bCBmb3IgYSBzdGF0dXMgY2hlY2sgYW5kIGFyZVxuICogICBpZ25vcmVkLlxuICpcbiAqIFRoZSBgYWxsYCBmbGFnIGFuZCBgcGF0aHNgIGFyZSB0aHJlYWRlZCBpbiBleHBsaWNpdGx5IChyYXRoZXIgdGhhbiByZWFkIGJhY2tcbiAqIG91dCBvZiB0aGUgY29tbWFuZCkgYmVjYXVzZSB0aGUgY2FsbGVyL2FkYXB0ZXIgZGVyaXZlcyB0aGVtIGZyb20gdGhlIHBhcnNlOlxuICogYHBhdGhzYCBpcyB7QGxpbmsgUGFyc2VkR2l0Q29tbWFuZC5wYXRoc30sIGFuZCBgYWxsYCAod2hpY2gge0BsaW5rIFBhcnNlZEdpdENvbW1hbmR9XG4gKiBpbnRlbnRpb25hbGx5IGRvZXMgbm90IGNhcnJ5KSBjb21lcyBmcm9tIHtAbGluayBjb21taXRTdGFnZXNBbGx9LlxuICpcbiAqIEBwYXJhbSBraW5kIFdoZXRoZXIgdGhlIGNoYW5nZXNldCBpcyBhIGNvbW1pdCdzIHN0YWdlZCBzZXQsIGEgcHVzaCdzIHJhbmdlLCBvciBhIHN0YXR1cyBwcmV2aWV3LlxuICogQHBhcmFtIGFsbCBXaGV0aGVyIHRoZSBjb21taXQgd2FzIGFuIGAtYWAvYC1hbWAgZm9ybSAoaWdub3JlZCBmb3IgYHB1c2hgL2BzdGF0dXNgKS5cbiAqIEBwYXJhbSBjd2QgVGhlIHdvcmtpbmcgZGlyZWN0b3J5IHRoZSBnaXQgY29tbWFuZCByYW4gaW4uXG4gKiBAcGFyYW0gZ2l0IFRoZSBpbmplY3RlZCBnaXQgc3VyZmFjZSBiYWNraW5nIHRoZSByZXNvbHV0aW9uLlxuICogQHBhcmFtIHBhdGhzIEV4cGxpY2l0IHBhdGhzcGVjcyBmcm9tIGBnaXQgY29tbWl0IC0tIDxwYXRoc3BlYz5cdTIwMjZgLCBpZiBhbnkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlQ2hhbmdlc2V0KFxuICBraW5kOiAnY29tbWl0JyB8ICdwdXNoJyB8ICdzdGF0dXMnLFxuICBhbGw6IGJvb2xlYW4sXG4gIGN3ZDogc3RyaW5nLFxuICBnaXQ6IEdpdEV4ZWN1dG9yLFxuICBwYXRocz86IHN0cmluZ1tdXG4pOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIGlmIChraW5kID09PSAncHVzaCcpIHtcbiAgICByZXR1cm4gZ2l0Lm91dGdvaW5nUGF0aHMoY3dkKTtcbiAgfVxuICBpZiAoa2luZCA9PT0gJ3N0YXR1cycpIHtcbiAgICBjb25zdCBbc3RhZ2VkLCB0cmFja2VkXSA9IGF3YWl0IFByb21pc2UuYWxsKFtnaXQuc3RhZ2VkUGF0aHMoY3dkKSwgZ2l0LnRyYWNrZWRNb2RpZmllZFBhdGhzKGN3ZCldKTtcbiAgICByZXR1cm4gbWVyZ2VVbmlxdWVQYXRocyhzdGFnZWQsIHRyYWNrZWQpO1xuICB9XG4gIC8vIEEgcGF0aHNwZWMtc2NvcGVkIGNvbW1pdCBsYW5kcyBvbmx5IHRoZSB3b3JraW5nLXRyZWUgY29udGVudCBhdCB0aG9zZVxuICAvLyBwYXRoc3BlY3MgXHUyMDE0IHNjb3BlIHRoZSBjaGFuZ2VzZXQgdG8gZXhhY3RseSB0aGF0LCBuZXZlciB0aGUgZnVsbCBzdGFnZWQgc2V0LlxuICBpZiAocGF0aHMgJiYgcGF0aHMubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiBnaXQucGF0aHNwZWNQYXRocyhwYXRocywgY3dkKTtcbiAgfVxuICBjb25zdCBzdGFnZWQgPSBhd2FpdCBnaXQuc3RhZ2VkUGF0aHMoY3dkKTtcbiAgaWYgKCFhbGwpIHJldHVybiBzdGFnZWQ7XG4gIGNvbnN0IHRyYWNrZWQgPSBhd2FpdCBnaXQudHJhY2tlZE1vZGlmaWVkUGF0aHMoY3dkKTtcbiAgcmV0dXJuIG1lcmdlVW5pcXVlUGF0aHMoc3RhZ2VkLCB0cmFja2VkKTtcbn1cblxuLyoqIENvbmNhdGVuYXRlIHBhdGggbGlzdHMgaW4gb3JkZXIsIGRyb3BwaW5nIGxhdGVyIGR1cGxpY2F0ZXMgb2YgYW4gZWFybGllciBwYXRoLiAqL1xuZnVuY3Rpb24gbWVyZ2VVbmlxdWVQYXRocyguLi5ncm91cHM6IHN0cmluZ1tdW10pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgY29uc3QgbWVyZ2VkOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGdyb3VwIG9mIGdyb3Vwcykge1xuICAgIGZvciAoY29uc3QgcGF0aCBvZiBncm91cCkge1xuICAgICAgaWYgKHNlZW4uaGFzKHBhdGgpKSBjb250aW51ZTtcbiAgICAgIHNlZW4uYWRkKHBhdGgpO1xuICAgICAgbWVyZ2VkLnB1c2gocGF0aCk7XG4gICAgfVxuICB9XG4gIHJldHVybiBtZXJnZWQ7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gR2F0ZSBldmFsdWF0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBUaGUgaW5qZWN0ZWQgZXhlY3V0aW9uIHN1cmZhY2UgZ2F0ZSBldmFsdWF0aW9uIG5lZWRzIFx1MjAxNCB0aGUgYGZpeGAvYHN0YWxlYC9cbiAqIGBsaXN0YCBhc3luYyBmdW5jdGlvbnMsIG1pcnJvcmluZyBgdG91Y2gtY29yZS50c2AncyBgVG91Y2hFeGVjdXRvcnNgLiBUZXN0c1xuICogaW5qZWN0IGZha2VzIHJldHVybmluZyBzdHJ1Y3R1cmVkIGRhdGE7IHRoZSBjb3JlIG5ldmVyIHNwYXducyBhIHN1YnByb2Nlc3NcbiAqIGl0c2VsZi4gQWxsIHBhdGhzIGFyZSByZXBvLXJlbGF0aXZlIFBPU0lYIHBhdGhzLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEdhdGVFeGVjdXRvcnMge1xuICAvKipcbiAgICogUnVuIGEgc2NvcGVkIGBnaXQgc3BhbiBzdGFsZSA8cGF0aHM+IC0tZml4YCBcdTIwMTQgdGhlIGJlbHQtYW5kLWJyYWNlcyBoZWFsIHRoYXRcbiAgICogcnVucyBiZWZvcmUgY2xhc3NpZmljYXRpb24gKHBlciBDQVJELm1kKSwgcmUtYW5jaG9yaW5nIGFueSBwb3NpdGlvbmFsIGRyaWZ0XG4gICAqIGluIHRoZSBjaGFuZ2VzZXQgdGhhdCB0aGUgdG91Y2ggaG9vayBoYXMgbm90IGFscmVhZHkgaGVhbGVkLiBSZXBvcnRzIG5vdGhpbmc7XG4gICAqIGl0cyBlZmZlY3QgaXMgb24gdGhlIHdvcmtpbmcgdHJlZSwgYW5kIHRoZSBzdWJzZXF1ZW50IHtAbGluayBHYXRlRXhlY3V0b3JzLnN0YWxlfVxuICAgKiByZWFkIG9ic2VydmVzIHRoZSBoZWFsZWQgc3RhdGUuXG4gICAqL1xuICBmaXgocGF0aHM6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZyk6IFByb21pc2U8dm9pZD47XG4gIC8qKlxuICAgKiBSdW4gYSBzY29wZWQgYGdpdCBzcGFuIHN0YWxlIC0tZm9ybWF0IHBvcmNlbGFpbiA8cGF0aHM+YCBhbmQgcmV0dXJuIGl0c1xuICAgKiBwYXJzZWQgcm93cyBcdTIwMTQgb25lIHBlciBkcmlmdGVkIGFuY2hvciBhbW9uZyB0aGUgY2hhbmdlc2V0J3Mgc3BhbnMsIGVtcHR5IHdoZW5cbiAgICogY2xlYW4uIERlYnQgaXMgY2xhc3NpZmllZCBmcm9tIHRoZXNlIHJvd3MgdmlhIGBpc0RlYnQoKWA7IHBvc2l0aW9uYWxcbiAgICogKGBNT1ZFRGAvYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCkgcm93cyBhcmUgbmV2ZXIgZGVidCBhbmQgbmV2ZXIgZGVueS5cbiAgICpcbiAgICogQW4gZW1wdHkgcmVzdWx0IG11c3QgbWVhbiB0aGUgc2NhbiAqcmFuIGFuZCBmb3VuZCBub3RoaW5nKiwgbmV2ZXIgdGhhdCB0aGVcbiAgICogc2NhbiAqY291bGQgbm90IHJ1biouIFdoZW4gdGhlIHNjb3BlZCBxdWVyeSBhYm9ydHMgYmVmb3JlIGNvbXBsZXRpbmcgKGUuZy5cbiAgICogYW4gdW5yZWFkYWJsZSBhbmNob3IgZmlsZSksIHRoZSBpbXBsZW1lbnRhdGlvbiB0aHJvd3Mge0BsaW5rIEdhdGVTY2FuRXJyb3J9XG4gICAqIHJhdGhlciB0aGFuIHJldHVybmluZyBgW11gLCBzbyB7QGxpbmsgZXZhbHVhdGVHYXRlfSBkb2VzIG5vdCBtaXN0YWtlIGFuXG4gICAqIGFib3J0ZWQgc2NhbiBmb3IgYSBjbGVhbiBvbmUgYW5kIHNpbGVudGx5IGFsbG93IHVudmVyaWZpZWQgZGVidCB0aHJvdWdoLlxuICAgKi9cbiAgc3RhbGUocGF0aHM6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZyk6IFByb21pc2U8U3RhbGVQb3JjZWxhaW5Sb3dbXT47XG4gIC8qKlxuICAgKiBSdW4gYSBzY29wZWQgYGdpdCBzcGFuIGxpc3QgLS1wb3JjZWxhaW4gPHBhdGhzPmAgYW5kIHJldHVybiB0aGUgY292ZXJpbmdcbiAgICogYW5jaG9ycy4gVXNlZCB0byBjb21wdXRlICp1bmNvdmVyZWQgd3JpdGVzKjogYSBjaGFuZ2VkIHBhdGggd2l0aCB6ZXJvXG4gICAqIGNvdmVyaW5nIHJvd3MgaGVyZSAobWludXMgYC5zcGFuLyoqYCwgZ2l0aWdub3JlZCBwYXRocywgYW5kXG4gICAqIGAuc3Bhbi8uZ2F0ZWlnbm9yZWAtZXhjbHVkZWQgcGF0aHMgXHUyMDE0IHNlZSB7QGxpbmsgZmlsZTovLy4vZ2F0ZS1pZ25vcmUudHN9KVxuICAgKiBpcyBhbiB1bmNvdmVyZWQgd3JpdGUuXG4gICAqL1xuICBsaXN0KHBhdGhzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpOiBQcm9taXNlPFBvcmNlbGFpblJvd1tdPjtcbiAgLyoqXG4gICAqIFJ1biBgZ2l0IHNwYW4gbGlzdCA8bmFtZXMuLi4+YCAoaHVtYW4gZm9ybWF0KSBhbmQgcmV0dXJuIGl0cyByYXcgc3Rkb3V0IFx1MjAxNFxuICAgKiBvbmUgYCMjIDxuYW1lPmAgYmxvY2sgcGVyIHNwYW4gKGFuY2hvciBidWxsZXRzICsgZGVzY3JpcHRpb24pLCBibG9ja3NcbiAgICogc2VwYXJhdGVkIGJ5IGAtLS1gLiBUaGUgZGVueS9hZHZpc29yeSByZW5kZXJlcnMgYW5ub3RhdGUgdGhlc2UgYmxvY2tzIHdpdGhcbiAgICogcGVyLWFuY2hvciBkcmlmdCBsYWJlbHMgc28gdGhlIHN1cmZhY2VkIG1lc3NhZ2UgY2FycmllcyB0aGUgZnVsbCBzcGFuXG4gICAqIChhbGwgbG9jYXRpb25zICsgZGVzY3JpcHRpb24pLCBub3QganVzdCB0aGUgZHJpZnRlZCByb3dzLiBSZXR1cm5zIGAnJ2Agb25cbiAgICogYW55IGZhaWx1cmU7IHtAbGluayBhbm5vdGF0ZUJsb2Nrc30gdGhlbiBzeW50aGVzaXplcyBtaW5pbWFsIGJsb2NrcyBmcm9tXG4gICAqIHRoZSBmaW5kaW5ncyB0aGVtc2VsdmVzIHNvIG5vIGZpbmRpbmcgaXMgZHJvcHBlZC5cbiAgICovXG4gIGxpc3RCbG9ja3MobmFtZXM6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPjtcbn1cblxuLyoqXG4gKiBUaGUgZ2F0ZSdzIHBlci1jaGFuZ2VzZXQgbWVtbyBcdTIwMTQgXCJoYXZlIEkgYWxyZWFkeSBwcmVzZW50ZWQgdGhpcyBleGFjdCBkZWJ0XG4gKiBzdGF0ZSBvbmNlP1wiIFRoZSBwZXJzaXN0ZWQgdW5pdCBpcyBhIGRpZ2VzdCBvZiB0aGUgc29ydGVkIHN0YWxlbmVzcyBmaW5kaW5nc1xuICogcGx1cyB0aGUgc29ydGVkIHVuY292ZXJlZCBwYXRocyAoZGVzaWduLWRlY2lzaW9ucy5tZCAjOSdzIFwiZ2F0ZSBvbmNlIHBlclxuICogZGlzdGluY3QgZGVidC1zdGF0ZVwiKTsgdGhlIGRpc2stYmFja2VkIGltcGxlbWVudGF0aW9uIHN0b3JlcyBvbmUgbWFya2VyIHBlclxuICogZGlnZXN0IHVuZGVyIHtAbGluayBnYXRlTWVtb0Rpcn0gKGA8Z2l0LWNvbW1vbi1kaXI+L2dpdC1zcGFuL2dhdGUvYCksIHdoZXJlXG4gKiBwcmVzZW5jZSBtZWFucyBcImFscmVhZHkgcHJlc2VudGVkIG9uY2UuXCIgSW5qZWN0ZWQgYXMgYSBzdG9yZSBhYnN0cmFjdGlvblxuICogKGxpa2Ugc3Bhbi1zdXJmYWNlLnRzJ3MgYE1lbW9TdG9yZWApIHNvIFBoYXNlIDMuMiBmYWtlcyBpdCBpbiBtZW1vcnkuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgR2F0ZU1lbW9TdGF0ZSB7XG4gIC8qKiBXaGV0aGVyIHRoaXMgZXhhY3QgZGVidC1zdGF0ZSBkaWdlc3QgaGFzIGFscmVhZHkgYmVlbiBwcmVzZW50ZWQgb25jZS4gKi9cbiAgaGFzKGRpZ2VzdDogc3RyaW5nKTogYm9vbGVhbjtcbiAgLyoqXG4gICAqIFJlY29yZCB0aGF0IHRoaXMgZGVidC1zdGF0ZSBkaWdlc3QgaGFzIG5vdyBiZWVuIHByZXNlbnRlZCwgcmV0dXJuaW5nXG4gICAqIHdoZXRoZXIgdGhlIHJlY29yZCBhY3R1YWxseSBwZXJzaXN0ZWQuIGBmYWxzZWAgbWVhbnMgdGhlIG1lbW8gY291bGQgbm90IGJlXG4gICAqIHdyaXR0ZW4gKGUuZy4gYW4gdW53cml0YWJsZSBtZW1vIGRpcmVjdG9yeSkgXHUyMDE0IHRoZSBnYXRlIHRyZWF0cyB0aGF0IGFzIGFcbiAgICogZmFpbC1vcGVuIHNpZ25hbCByYXRoZXIgdGhhbiBkZW55aW5nLCBiZWNhdXNlIGEgbm9uLXBlcnNpc3RpbmcgbWVtbyB3b3VsZFxuICAgKiBzaWxlbnRseSB0dXJuIFwiZGVueSBvbmNlLCB0aGVuIGFsbG93IHRoZSBpZGVudGljYWwgcmV0cnlcIiBpbnRvIFwiZGVueSBldmVyeVxuICAgKiB0aW1lXCIgd2l0aCBubyBlc2NhcGUuXG4gICAqL1xuICByZWNvcmQoZGlnZXN0OiBzdHJpbmcpOiBib29sZWFuO1xufVxuXG4vKipcbiAqIFRoZSBnYXRlJ3MgZGVjaXNpb24gZm9yIG9uZSBjb21tYW5kLCBhcyBhIGRpc2NyaW1pbmF0ZWQgdW5pb24gdGhlIGFkYXB0ZXJcbiAqIHRyYW5zbGF0ZXMgaW50byBgcGVybWlzc2lvbkRlY2lzaW9uOiAnZGVueSdgL2FsbG93IChDbGF1ZGUpIG9yIGEgYmxvY2svYWxsb3dcbiAqIChDb2RleCkuIGBkZWNpc2lvbmAgaXMgdGhlIGNvYXJzZSBhbGxvdy9kZW55IHRoZSBoYXJuZXNzIGFjdHMgb247IGBraW5kYFxuICogcmVjb3JkcyAqd2h5Kiwgc28gdGhlIGFkYXB0ZXIgcmVuZGVycyB0aGUgcmlnaHQgbWVzc2FnZSBhbmQgc28gdGVzdHMgYXNzZXJ0XG4gKiB0aGUgZXhhY3QgYnJhbmNoLlxuICpcbiAqIC0gYGFsbG93YCAvIGBzaWxlbnRgIFx1MjAxNCBub3RoaW5nIHRvIGNoZWNrIChubyBwYXRocykgb3IgdGhlIGNoYW5nZXNldCBpcyBjbGVhbjtcbiAqICAgYWxsb3cgd2l0aCBubyBvdXRwdXQuIEludGVybmFsIGVycm9ycyBhbmQgcGFyc2UgZmFpbHVyZXMgYWxzbyByZXNvbHZlIGhlcmU6XG4gKiAgIHRoZSBnYXRlIGZhaWxzIG9wZW4gYW5kIG11c3QgbmV2ZXIgYnJpY2sgYSBjb21taXQuXG4gKiAtIGBhbGxvd2AgLyBgYWxyZWFkeS1wcmVzZW50ZWRgIFx1MjAxNCBkZWJ0IGlzIHByZXNlbnQsIGJ1dCB0aGlzIGV4YWN0IGRlYnQgc3RhdGVcbiAqICAgd2FzIGFscmVhZHkgcHJlc2VudGVkIG9uY2UgKHNlbWFudGljLXN0YWxlbmVzcyBvciB1bmNvdmVyZWQtd3JpdGVzXG4gKiAgIGNvbnNpZGVyLW9uY2UsIG9yIGFuIHVuY2hhbmdlZCBzdGF0ZSkuIFRoZSBjb21tYW5kIHBhc3Nlcy5cbiAqIC0gYGFsbG93YCAvIGBlbnZpcm9ubWVudGFsYCBcdTIwMTQgdGhlIGNoYW5nZXNldCdzIG9ubHkgc3RhbGVuZXNzIHJvd3MgYXJlXG4gKiAgIHRlcm1pbmFsL2Vudmlyb25tZW50YWwgY29uZGl0aW9ucyAoYENPTkZMSUNUYCwgYFNVQk1PRFVMRWAsIGBMRlNfKmAsXG4gKiAgIGBQUk9NSVNPUl9NSVNTSU5HYCwgYFNQQVJTRV9FWENMVURFRGAsIGBGSUxURVJfRkFJTEVEYCwgYElPX0VSUk9SYCkgdGhlIENMSVxuICogICBjb3VsZCBub3QgcmVzb2x2ZSBhdCBhbGwgXHUyMDE0IG5vdCBzcGFuIGRyaWZ0IGEgdXNlciBjYW4gZml4IGJ5IGVkaXRpbmcgYSBzcGFuLlxuICogICBUaGUgZ2F0ZSBmYWlscyBPUEVOIChhbGxvdykgYnV0IGNhcnJpZXMgYGNvbmRpdGlvbnNgL2ByZWFzb25gIHNvIHRoZSBhZGFwdGVyXG4gKiAgIHN1cmZhY2VzIHRoZSBjb25kaXRpb24gaW5zdGVhZCBvZiBzd2FsbG93aW5nIGl0LiBEZW55aW5nIGhlcmUgd291bGQgcmUtZGVueVxuICogICBmb3JldmVyIG9uIGFuIGluZnJhIGZhaWx1cmUgdGhlIHVzZXIgY2Fubm90IGNsZWFyIGZyb20gdGhlIGdhdGUuXG4gKiAtIGBhbGxvd2AgLyBgc2Nhbi1mYWlsZWRgIFx1MjAxNCBgZ2l0IHNwYW4gc3RhbGVgIGNvdWxkIG5vdCAqY29tcGxldGUqIGl0cyBzY29wZWRcbiAqICAgc2NhbiAoYSB7QGxpbmsgR2F0ZVNjYW5FcnJvcn0sIGUuZy4gYW4gdW5yZWFkYWJsZSBhbmNob3IgZmlsZSBhYm9ydGluZyB0aGVcbiAqICAgd2hvbGUgcXVlcnkpLiBUaGlzIGlzIGRpc3RpbmN0IGZyb20gYm90aCBgZW52aXJvbm1lbnRhbGAgKHRoZSBzY2FuIGNvbXBsZXRlZFxuICogICBhbmQgY2FycmllZCB0ZXJtaW5hbCByb3dzKSBhbmQgYSBjbGVhbiBwYXNzICh0aGUgc2NhbiBjb21wbGV0ZWQgd2l0aCB6ZXJvXG4gKiAgIHJvd3MpOiB0aGUgc2NhbiBuZXZlciByYW4gdG8gY29tcGxldGlvbiwgc28gaXRzIGVtcHR5IHJlc3VsdCBpcyBub3QgZXZpZGVuY2VcbiAqICAgb2YgXCJubyBkZWJ0LlwiIFRoZSBnYXRlIGZhaWxzIE9QRU4gaGVyZSB0b28gXHUyMDE0IG1hdGNoaW5nIGBlbnZpcm9ubWVudGFsYCBcdTIwMTRcbiAqICAgYnV0IGtlZXBzIGl0cyBvd24gYGtpbmRgIGFuZCBhIGByZWFzb25gIG5hbWluZyB0aGUgZmFpbHVyZSwgc28gdGhlIGFkYXB0ZXJcbiAqICAgc3VyZmFjZXMgYSB3YXJuaW5nIHRoYXQgc3BhbiBkZWJ0IHdhcyBOT1QgdmVyaWZpZWQgZm9yIHRoaXMgY2hhbmdlc2V0XG4gKiAgIGluc3RlYWQgb2Ygc3RheWluZyBzaWxlbnQuIFRoZXJlIGlzIG5vIGRlYnQtc3RhdGUgdG8gbWVtb2l6ZTogZXZlcnlcbiAqICAgZXZhbHVhdGlvbiBvZiBhIHN0aWxsLWZhaWxpbmcgc2NhbiB3YXJucyBhZ2Fpbi5cbiAqIC0gYGRlbnlgIC8gYHNlbWFudGljLXN0YWxlbmVzc2AgXHUyMDE0IHRoZSBjaGFuZ2VzZXQgY2FycmllcyBzZW1hbnRpYyBzdGFsZW5lc3MsXG4gKiAgIGFuZCB0aGlzIGV4YWN0IGZpbmRpbmdzIGRpZ2VzdCBoYXMgbm90IGJlZW4gcHJlc2VudGVkIGJlZm9yZS4gRGVueVxuICogICAqKm9uY2UqKiwgbGlzdGluZyBgZmluZGluZ3NgIGFzIGEgY2hlY2tsaXN0IGluIGByZWFzb25gOyBhbiBpZGVudGljYWxcbiAqICAgcmV0cnkgKHVuY2hhbmdlZCBmaW5kaW5ncykgZmFsbHMgdGhyb3VnaCB0byB0aGUgZW52aXJvbm1lbnRhbCBhbmRcbiAqICAgdW5jb3ZlcmVkIGNoZWNrcyBhbmQgcmVzb2x2ZXMgdG8gYGFscmVhZHktcHJlc2VudGVkYCB3aGVuIG90aGVyd2lzZVxuICogICBjbGVhbi4gQ2hhbmdlZCBmaW5kaW5ncyAoYSBuZXcgZGlnZXN0KSBkZW55IGZyZXNoIChjb25zaWRlci1vbmNlIHBlclxuICogICBkaXN0aW5jdCBkZWJ0IHN0YXRlLCBwZXIgZGVzaWduLWRlY2lzaW9ucy5tZCAjMSkuXG4gKiAtIGBkZW55YCAvIGB1bmNvdmVyZWQtd3JpdGVzYCBcdTIwMTQgdGhlIGNoYW5nZXNldCBoYXMgY2hhbmdlZCBmaWxlcyBubyBzcGFuXG4gKiAgIGNvdmVycywgYW5kIHRoaXMgc3RhdGUgaGFzIG5vdCBiZWVuIHByZXNlbnRlZCBiZWZvcmUuIERlbnkgKipvbmNlKiosIGxpc3RpbmdcbiAqICAgYHVuY292ZXJlZGA7IHRoZSByZXRyeSB3aXRoIGFuIHVuY2hhbmdlZCBzdGF0ZSByZXNvbHZlcyB0byBgYWxyZWFkeS1wcmVzZW50ZWRgXG4gKiAgIGFuZCBwYXNzZXMgKGNvbnNpZGVyLW9uY2UsIHBlciBkZXNpZ24tZGVjaXNpb25zLm1kICMzKS5cbiAqIC0gYGFsbG93YCAvIGBzZW1hbnRpYy1zdGFsZW5lc3MtaW5mb2AsIGBhbGxvd2AgLyBgdW5jb3ZlcmVkLXdyaXRlcy1pbmZvYCBcdTIwMTRcbiAqICAgYCdpbmZvcm0nYC1tb2RlLW9ubHkgY291bnRlcnBhcnRzIG9mIHRoZSB0d28gYGRlbnlgIGtpbmRzIGFib3ZlOiBzYW1lXG4gKiAgIGBmaW5kaW5nc2AvYHVuY292ZXJlZGAvYHJlYXNvbmAgcGF5bG9hZCwgYnV0IG5ldmVyIGRlbmllcyBhbmQgbmV2ZXJcbiAqICAgY29uc3VsdHMgb3Igd3JpdGVzIGBtZW1vU3RhdGVgIChhIGBnaXQgc3RhdHVzYCBwcmV2aWV3IGlzIG5vdCBhIGRlYnQgc3RhdGVcbiAqICAgdG8gaG9sZCBvciBjb25zaWRlci1vbmNlIFx1MjAxNCBpdCByZS1yZXBvcnRzIHRoZSBzYW1lIGxpdmUgZGVidCBvbiBldmVyeSBjYWxsLFxuICogICBleGFjdGx5IGxpa2UgYGdpdCBzdGF0dXNgIGl0c2VsZiBkb2VzIGZvciB0aGUgd29ya2luZyB0cmVlKS5cbiAqL1xuZXhwb3J0IHR5cGUgR2F0ZVJlc3VsdCA9XG4gIHwgeyBkZWNpc2lvbjogJ2FsbG93Jzsga2luZDogJ3NpbGVudCcgfVxuICB8IHsgZGVjaXNpb246ICdhbGxvdyc7IGtpbmQ6ICdhbHJlYWR5LXByZXNlbnRlZCcgfVxuICB8IHsgZGVjaXNpb246ICdhbGxvdyc7IGtpbmQ6ICdlbnZpcm9ubWVudGFsJzsgY29uZGl0aW9uczogU3RhbGVQb3JjZWxhaW5Sb3dbXTsgcmVhc29uOiBzdHJpbmcgfVxuICB8IHsgZGVjaXNpb246ICdhbGxvdyc7IGtpbmQ6ICdzY2FuLWZhaWxlZCc7IHJlYXNvbjogc3RyaW5nIH1cbiAgfCB7IGRlY2lzaW9uOiAnYWxsb3cnOyBraW5kOiAnc2VtYW50aWMtc3RhbGVuZXNzLWluZm8nOyBmaW5kaW5nczogU3RhbGVQb3JjZWxhaW5Sb3dbXTsgcmVhc29uOiBzdHJpbmcgfVxuICB8IHsgZGVjaXNpb246ICdhbGxvdyc7IGtpbmQ6ICd1bmNvdmVyZWQtd3JpdGVzLWluZm8nOyB1bmNvdmVyZWQ6IHN0cmluZ1tdOyByZWFzb246IHN0cmluZyB9XG4gIHwgeyBkZWNpc2lvbjogJ2RlbnknOyBraW5kOiAnc2VtYW50aWMtc3RhbGVuZXNzJzsgZmluZGluZ3M6IFN0YWxlUG9yY2VsYWluUm93W107IHJlYXNvbjogc3RyaW5nIH1cbiAgfCB7IGRlY2lzaW9uOiAnZGVueSc7IGtpbmQ6ICd1bmNvdmVyZWQtd3JpdGVzJzsgdW5jb3ZlcmVkOiBzdHJpbmdbXTsgcmVhc29uOiBzdHJpbmcgfTtcblxuLyoqXG4gKiBXaGV0aGVyIHtAbGluayBldmFsdWF0ZUdhdGV9IG1heSBob2xkIHRoZSBjb21tYW5kIChgJ2VuZm9yY2UnYCwgdGhlIGRlZmF1bHQgXHUyMDE0XG4gKiB1c2VkIGZvciBgY29tbWl0YC9gcHVzaGApIG9yIG11c3Qgb25seSBldmVyIGFkdmlzZSAoYCdpbmZvcm0nYCBcdTIwMTQgdXNlZCBmb3JcbiAqIGBzdGF0dXNgKTogZXZlcnkgYnJhbmNoIHRoYXQgd291bGQgb3RoZXJ3aXNlIGBkZW55YCByZXR1cm5zIGl0cyBgLWluZm9gXG4gKiBgYWxsb3dgIGNvdW50ZXJwYXJ0IGluc3RlYWQsIGFuZCBgbWVtb1N0YXRlYCBpcyBuZXZlciByZWFkIG9yIHdyaXR0ZW4sIHNpbmNlXG4gKiBhbiBpbmZvcm1hdGlvbmFsIHByZXZpZXcgbXVzdCBub3Qgc3BlbmQgKG9yIGJlIGJsb2NrZWQgYnkpIHRoZSBjb25zaWRlci1vbmNlXG4gKiBjcmVkaXQgYSByZWFsIGBjb21taXRgL2BwdXNoYCByZWxpZXMgb24uXG4gKi9cbmV4cG9ydCB0eXBlIEdhdGVNb2RlID0gJ2VuZm9yY2UnIHwgJ2luZm9ybSc7XG5cbi8qKlxuICogRXZhbHVhdGUgdGhlIGdhdGUgZm9yIGEgcmVzb2x2ZWQgY2hhbmdlc2V0IGFuZCBkZWNpZGUgd2hldGhlciB0byBob2xkIHRoZVxuICogY29tbWFuZC5cbiAqXG4gKiBSdW5zIGBleGVjdXRvcnMuZml4YCAoc2NvcGVkIGJlbHQtYW5kLWJyYWNlcyBgc3RhbGUgLS1maXhgKSwgdGhlbiByZWFkc1xuICogYGV4ZWN1dG9ycy5zdGFsZWAgYW5kIGNsYXNzaWZpZXMgZWFjaCBkZWJ0IHJvdyAoYGlzRGVidCgpYCkgaW50byAqc2VtYW50aWMqXG4gKiBkcmlmdCBhbmQgKmVudmlyb25tZW50YWwqIGNvbmRpdGlvbnMgKGBpc0Vudmlyb25tZW50YWxTdGF0dXMoKWApLlxuICpcbiAqIFNlbWFudGljIGRyaWZ0IChgQ0hBTkdFRGAvYERFTEVURURgKSBpcyBjaGVja2VkIGFnYWluc3QgYG1lbW9TdGF0ZWAgdmlhIGl0c1xuICogb3duIGRpZ2VzdCAoYGdhdGVTdGF0ZURpZ2VzdChzZW1hbnRpYywgW10pYCksIHRoZSBzYW1lIGRpc3RpbmN0LWRlYnQtc3RhdGVcbiAqIG1lbW8gdGhlIHVuY292ZXJlZC13cml0ZXMgY2hlY2sgYWxyZWFkeSB1c2VzOiBub3QgeWV0IHByZXNlbnRlZCBcdTIxOTIgcmVjb3JkIGl0XG4gKiBhbmQgYGRlbnlgL2BzZW1hbnRpYy1zdGFsZW5lc3NgIChhIGBtZW1vU3RhdGUucmVjb3JkYCBmYWlsdXJlIGZhaWxzIG9wZW4gdG9cbiAqIGBhbGxvd2AvYHNpbGVudGAsIHNpbmNlIGEgbm9uLXBlcnNpc3RpbmcgbWVtbyB3b3VsZCByZS1kZW55IHRoZSBpZGVudGljYWxcbiAqIHJldHJ5IGZvcmV2ZXIpOyBhbHJlYWR5IHByZXNlbnRlZCBcdTIxOTIgKipmYWxsIHRocm91Z2gqKiByYXRoZXIgdGhhbiByZXR1cm5pbmcsXG4gKiBzbyBhIHJldHJ5IHN0aWxsIHN1cmZhY2VzIGVudmlyb25tZW50YWwgYWR2aXNvcmllcyBhbmQgc3RpbGwgcnVucyB0aGVcbiAqIHVuY292ZXJlZCBjaGVjay4gV2hldGhlciB0aGUgc2VtYW50aWMgc3RhdGUgd2FzIGFscmVhZHkgcHJlc2VudGVkIGlzXG4gKiB0cmFja2VkIHNvIHRoYXQsIGlmIHRoZSBldmFsdWF0aW9uIHRoZW4gZW5kcyBjbGVhbiwgaXQgcmVzb2x2ZXMgdG9cbiAqIGBhbGxvd2AvYGFscmVhZHktcHJlc2VudGVkYCByYXRoZXIgdGhhbiBhIGJhcmUgYGFsbG93YC9gc2lsZW50YCBcdTIwMTQgbWlycm9yaW5nXG4gKiB0aGUgdW5jb3ZlcmVkIGJyYW5jaCdzIG93biBtZW1vLWhpdCByZXN1bHQuIEEgY2hhbmdlc2V0IGNhcnJ5aW5nIGJvdGhcbiAqIHVucHJlc2VudGVkIHNlbWFudGljIHN0YWxlbmVzcyBhbmQgdW5wcmVzZW50ZWQgdW5jb3ZlcmVkIHdyaXRlcyB0aGVyZWZvcmVcbiAqIGRlbmllcyB0d2ljZSAoc3RhbGVuZXNzIGZpcnN0LCB1bmNvdmVyZWQgb24gdGhlIHJldHJ5KSBiZWZvcmUgYSB0aGlyZFxuICogYXR0ZW1wdCBwYXNzZXM7IGVkaXRpbmcgb25lIHN0YWxlIHNwYW4gd2hpbGUgYW5vdGhlciByZW1haW5zIHN0YWxlIHByb2R1Y2VzXG4gKiBhIG5ldyBmaW5kaW5ncyBzZXQsIGhlbmNlIGEgbmV3IGRpZ2VzdCBhbmQgb25lIGZyZXNoIGRlbnkuIERpZ2VzdCBjb2xsaXNpb25cbiAqIGJldHdlZW4gdGhlIHR3byBjYXRlZ29yaWVzIGlzIGltcG9zc2libGU6IHRoZSBwYXlsb2FkIGlzXG4gKiBgSlNPTi5zdHJpbmdpZnkoe2ZpbmRpbmdzLCB1bmNvdmVyZWR9KWAsIGFuZCB0aGUgc2VtYW50aWMgZGlnZXN0IHBvcHVsYXRlc1xuICogYGZpbmRpbmdzYCB3aGlsZSB0aGUgdW5jb3ZlcmVkIGRpZ2VzdCBwb3B1bGF0ZXMgYHVuY292ZXJlZGAuXG4gKlxuICogRW52aXJvbm1lbnRhbCBjb25kaXRpb25zIHRoZSBDTEkgY291bGQgbm90IHJlc29sdmUgYXQgYWxsXG4gKiAoYENPTkZMSUNUYC9gU1VCTU9EVUxFYC9gTEZTXypgL2BQUk9NSVNPUl9NSVNTSU5HYC9gU1BBUlNFX0VYQ0xVREVEYC9cbiAqIGBGSUxURVJfRkFJTEVEYC9gSU9fRVJST1JgKSBcdTIxOTIgYGFsbG93YC9gZW52aXJvbm1lbnRhbGA6IGZhaWwgT1BFTiwgc3VyZmFjaW5nIHRoZVxuICogY29uZGl0aW9uIHJhdGhlciB0aGFuIGRlbnlpbmcgb24gYW4gaW5mcmEgZmFpbHVyZSBhIHNwYW4gZWRpdCBjYW5ub3QgZml4LlxuICogVW5jb3ZlcmVkIHdyaXRlcyAoY2hhbmdlZCBwYXRocyB3aXRoIHplcm8gY292ZXJhZ2UgZnJvbSBgZXhlY3V0b3JzLmxpc3RgLFxuICogbWludXMgYC5zcGFuLyoqYCwgYW5kIHBhdGhzIG1hdGNoZWQgYnkgdGhlIHJlcG8ncyBgLnNwYW4vLmdhdGVpZ25vcmVgIFx1MjAxNCBzZWVcbiAqIHtAbGluayBmaWxlOi8vLi9nYXRlLWlnbm9yZS50c30sIGxvYWRlZCBkaXJlY3RseSBmcm9tIGRpc2sgdmlhXG4gKiBgcmVzb2x2ZVJlcG9Sb290KGN3ZClgLCBmYWlsLW9wZW4gd2hlbiBhYnNlbnQvdW5yZWFkYWJsZSkgXHUyMTkyXG4gKiBgZGVueWAvYHVuY292ZXJlZC13cml0ZXNgIHRoZSBmaXJzdCB0aW1lIHRoYXQgc3RhdGUgaXMgc2VlbiwgdGhlblxuICogYGFsbG93YC9gYWxyZWFkeS1wcmVzZW50ZWRgIG9uIHJldHJ5LiBgTU9WRURgIGFuZCBgUkVTT0xWRURfUEVORElOR19DT01NSVRgXG4gKiBuZXZlciBjb250cmlidXRlIHRvIGFueSBicmFuY2ggYW5kIG5ldmVyIGRlbnkuIEFueSBpbnRlcm5hbCBlcnJvciByZXNvbHZlc1xuICogdG8gYGFsbG93YC9gc2lsZW50YCBcdTIwMTQgdGhlIGdhdGUgZmFpbHMgb3BlbiBhbmQgbmV2ZXIgYnJpY2tzIGEgY29tbWl0LlxuICpcbiAqIEEge0BsaW5rIEdhdGVTY2FuRXJyb3J9IGZyb20gYGV4ZWN1dG9ycy5zdGFsZWAgaXMgdGhlIG9uZSBjYXNlIGhhbmRsZWRcbiAqIG91dHNpZGUgdGhhdCBmbG93OiBhIHNjYW4gdGhhdCAqY291bGQgbm90IGNvbXBsZXRlKiAoZS5nLiBhbiB1bnJlYWRhYmxlXG4gKiBhbmNob3IgZmlsZSBhYm9ydHMgdGhlIHNjb3BlZCBxdWVyeSkgeWllbGRzIGFuIGVtcHR5IHJlc3VsdCB0aGF0IGlzIE5PVFxuICogZXZpZGVuY2Ugb2YgYSBjbGVhbiBjaGFuZ2VzZXQuIFJlYWRpbmcgdGhhdCBhcyBgYWxsb3dgL2BzaWxlbnRgIHdvdWxkXG4gKiBzaWxlbnRseSBzd2FsbG93IHRoZSBmYWN0IHRoYXQgdmVyaWZpY2F0aW9uIG5ldmVyIGhhcHBlbmVkLCBzbyBpdCByZXNvbHZlc1xuICogaW5zdGVhZCB0byBpdHMgb3duIGBhbGxvd2AvYHNjYW4tZmFpbGVkYCBcdTIwMTQgZmFpbCBPUEVOIGxpa2UgYGVudmlyb25tZW50YWxgXG4gKiAodGhlIGNvbW1hbmQgaXMgbm90IGhlbGQpLCBidXQgd2l0aCBhIGRpc3RpbmN0IGBraW5kYCBhbmQgYHJlYXNvbmAgc28gdGhlXG4gKiBhZGFwdGVyIHN1cmZhY2VzIGEgd2FybmluZyB0aGF0IHNwYW4gZGVidCB3YXMgTk9UIHZlcmlmaWVkIGZvciB0aGlzXG4gKiBjaGFuZ2VzZXQgcmF0aGVyIHRoYW4gc3RheWluZyBzaWxlbnQuIFRoZXJlIGlzIG5vIGRlYnQtc3RhdGUgdG8gbWVtb2l6ZVxuICogaGVyZTogZXZlcnkgZXZhbHVhdGlvbiBvZiBhIHN0aWxsLWZhaWxpbmcgc2NhbiB3YXJucyBhZ2Fpbi5cbiAqXG4gKiBJbiBgJ2luZm9ybSdgIG1vZGUgKGBzdGF0dXNgKSwgdGhlIHNhbWUgY2xhc3NpZmljYXRpb24gcnVucyBidXQgbmVpdGhlclxuICogYGRlbnlgIGJyYW5jaCBmaXJlcyBhbmQgYG1lbW9TdGF0ZWAgaXMgbmV2ZXIgcmVhZCBvciB3cml0dGVuOiBzZW1hbnRpY1xuICogc3RhbGVuZXNzIHJlc29sdmVzIHRvIGBhbGxvd2AvYHNlbWFudGljLXN0YWxlbmVzcy1pbmZvYCBhbmQgdW5jb3ZlcmVkXG4gKiB3cml0ZXMgdG8gYGFsbG93YC9gdW5jb3ZlcmVkLXdyaXRlcy1pbmZvYCwgYm90aCBjYXJyeWluZyB0aGUgc2FtZVxuICogYGZpbmRpbmdzYC9gdW5jb3ZlcmVkYC9gcmVhc29uYCBwYXlsb2FkIHRoZSBgZGVueWAga2luZHMgd291bGQgaGF2ZS4gVGhlXG4gKiBlbnZpcm9ubWVudGFsL3NjYW4tZmFpbGVkL3NpbGVudCBicmFuY2hlcyBhcmUgdW5hZmZlY3RlZCBieSBtb2RlIFx1MjAxNCB0aGV5XG4gKiBhbHJlYWR5IGFsd2F5cyBhbGxvdy5cbiAqXG4gKiBAcGFyYW0gcGF0aHMgVGhlIHJlc29sdmVkIGNoYW5nZXNldCBmcm9tIHtAbGluayByZXNvbHZlQ2hhbmdlc2V0fS4gRW1wdHkgXHUyMTkyXG4gKiAgIGBhbGxvd2AvYHNpbGVudGAuXG4gKiBAcGFyYW0gY3dkIFRoZSB3b3JraW5nIGRpcmVjdG9yeSB0aGUgZ2l0IGNvbW1hbmQgcmFuIGluLlxuICogQHBhcmFtIGV4ZWN1dG9ycyBUaGUgaW5qZWN0ZWQgYGZpeGAvYHN0YWxlYC9gbGlzdGAgc3VyZmFjZS5cbiAqIEBwYXJhbSBtZW1vU3RhdGUgVGhlIHBlci1jaGFuZ2VzZXQgZGVidC1zdGF0ZSBtZW1vLiBVbnVzZWQgaW4gYCdpbmZvcm0nYCBtb2RlLlxuICogQHBhcmFtIG1vZGUgYCdlbmZvcmNlJ2AgKGRlZmF1bHQpIG1heSBkZW55OyBgJ2luZm9ybSdgIG9ubHkgZXZlciBhZHZpc2VzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZXZhbHVhdGVHYXRlKFxuICBwYXRoczogc3RyaW5nW10sXG4gIGN3ZDogc3RyaW5nLFxuICBleGVjdXRvcnM6IEdhdGVFeGVjdXRvcnMsXG4gIG1lbW9TdGF0ZTogR2F0ZU1lbW9TdGF0ZSxcbiAgbW9kZTogR2F0ZU1vZGUgPSAnZW5mb3JjZSdcbik6IFByb21pc2U8R2F0ZVJlc3VsdD4ge1xuICBpZiAocGF0aHMubGVuZ3RoID09PSAwKSByZXR1cm4geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ3NpbGVudCcgfTtcbiAgdHJ5IHtcbiAgICAvLyBCZWx0LWFuZC1icmFjZXMgaGVhbCwgdGhlbiBjbGFzc2lmeSBhZ2FpbnN0IHRoZSBoZWFsZWQgc3RhdGUuXG4gICAgYXdhaXQgZXhlY3V0b3JzLmZpeChwYXRocywgY3dkKTtcbiAgICBjb25zdCBzdGFsZVJvd3MgPSBhd2FpdCBleGVjdXRvcnMuc3RhbGUocGF0aHMsIGN3ZCk7XG5cbiAgICAvLyBTcGxpdCBkZWJ0IHJvd3MgaW50byBzZW1hbnRpYyBkcmlmdCAoYSB1c2VyIGNhbiBmaXggYnkgZWRpdGluZyBhIHNwYW4pXG4gICAgLy8gYW5kIHRlcm1pbmFsL2Vudmlyb25tZW50YWwgY29uZGl0aW9ucyAodGhlIENMSSBjb3VsZCBub3QgcmVzb2x2ZSB0aGVcbiAgICAvLyBhbmNob3IgYXQgYWxsIFx1MjAxNCBzcGFyc2UgY2hlY2tvdXQsIHVuZmV0Y2hlZCBMRlMsIHBhcnRpYWwtY2xvbmUgbWlzcywgSS9PXG4gICAgLy8gZXJyb3IpLiBgaXNEZWJ0KClgIGlzIHRoZSBzaW5nbGUgc291cmNlIG9mIHRydXRoIGZvciB3aGF0IGlzIGRlYnQgYXQgYWxsO1xuICAgIC8vIGBpc0Vudmlyb25tZW50YWxTdGF0dXMoKWAgc3BsaXRzIHRoZSBmaXhhYmxlIGZyb20gdGhlIHVucmVzb2x2YWJsZS5cbiAgICAvLyBgTU9WRURgL2BSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgYXJlIG5ldmVyIGRlYnQgYW5kIG5ldmVyIGNvbnRyaWJ1dGUuXG4gICAgY29uc3QgZGVidFJvd3MgPSBzdGFsZVJvd3MuZmlsdGVyKChyb3cpID0+IGlzRGVidChyb3cuc3RhdHVzKSk7XG4gICAgY29uc3Qgc2VtYW50aWMgPSBkZWJ0Um93cy5maWx0ZXIoKHJvdykgPT4gIWlzRW52aXJvbm1lbnRhbFN0YXR1cyhyb3cuc3RhdHVzKSk7XG4gICAgY29uc3QgZW52aXJvbm1lbnRhbCA9IGRlYnRSb3dzLmZpbHRlcigocm93KSA9PiBpc0Vudmlyb25tZW50YWxTdGF0dXMocm93LnN0YXR1cykpO1xuXG4gICAgaWYgKG1vZGUgPT09ICdpbmZvcm0nKSB7XG4gICAgICAvLyBBIHN0YXR1cyBwcmV2aWV3IG5ldmVyIGRlbmllcyBhbmQgbmV2ZXIgdG91Y2hlcyB0aGUgZW5mb3JjZSBtZW1vIFx1MjAxNCBpdFxuICAgICAgLy8ganVzdCByZXBvcnRzIHdoYXRldmVyIGRlYnQgaXMgbGl2ZSByaWdodCBub3csIGV2ZXJ5IHRpbWUgaXQncyBhc2tlZC5cbiAgICAgIGlmIChzZW1hbnRpYy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgZGVjaXNpb246ICdhbGxvdycsXG4gICAgICAgICAga2luZDogJ3NlbWFudGljLXN0YWxlbmVzcy1pbmZvJyxcbiAgICAgICAgICBmaW5kaW5nczogc2VtYW50aWMsXG4gICAgICAgICAgcmVhc29uOiByZW5kZXJTdGFsZW5lc3NSZWFzb24oc2VtYW50aWMsIGF3YWl0IGZldGNoU3BhbkJsb2NrcyhleGVjdXRvcnMsIHNlbWFudGljLCBjd2QpLCAnaW5mb3JtJylcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGlmIChlbnZpcm9ubWVudGFsLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBkZWNpc2lvbjogJ2FsbG93JyxcbiAgICAgICAgICBraW5kOiAnZW52aXJvbm1lbnRhbCcsXG4gICAgICAgICAgY29uZGl0aW9uczogZW52aXJvbm1lbnRhbCxcbiAgICAgICAgICByZWFzb246IHJlbmRlckVudmlyb25tZW50YWxSZWFzb24oZW52aXJvbm1lbnRhbCwgYXdhaXQgZmV0Y2hTcGFuQmxvY2tzKGV4ZWN1dG9ycywgZW52aXJvbm1lbnRhbCwgY3dkKSlcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHVuY292ZXJlZCA9IGF3YWl0IGNvbXB1dGVVbmNvdmVyZWRQYXRocyhwYXRocywgY3dkLCBleGVjdXRvcnMpO1xuICAgICAgaWYgKHVuY292ZXJlZC5sZW5ndGggPT09IDApIHJldHVybiB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnc2lsZW50JyB9O1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgZGVjaXNpb246ICdhbGxvdycsXG4gICAgICAgIGtpbmQ6ICd1bmNvdmVyZWQtd3JpdGVzLWluZm8nLFxuICAgICAgICB1bmNvdmVyZWQsXG4gICAgICAgIHJlYXNvbjogcmVuZGVyVW5jb3ZlcmVkUmVhc29uKHVuY292ZXJlZCwgJ2luZm9ybScpXG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIFNlbWFudGljIHN0YWxlbmVzcyBqb2lucyB0aGUgc2FtZSBkaXN0aW5jdC1kZWJ0LXN0YXRlIG1lbW8gdGhlIHVuY292ZXJlZFxuICAgIC8vIGNoZWNrIHVzZXM6IGRlbnkgb25jZSBwZXIgZmluZGluZ3MgZGlnZXN0LCB0aGVuIGZhbGwgdGhyb3VnaCAocmF0aGVyIHRoYW5cbiAgICAvLyByZXR1cm5pbmcpIG9uIGFuIGlkZW50aWNhbCByZXRyeSBzbyB0aGUgcmVzdCBvZiB0aGUgZXZhbHVhdGlvbiBzdGlsbCBydW5zLlxuICAgIGxldCBzZW1hbnRpY0FscmVhZHlQcmVzZW50ZWQgPSBmYWxzZTtcbiAgICBpZiAoc2VtYW50aWMubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3Qgc2VtYW50aWNEaWdlc3QgPSBnYXRlU3RhdGVEaWdlc3Qoc2VtYW50aWMsIFtdKTtcbiAgICAgIGlmICghbWVtb1N0YXRlLmhhcyhzZW1hbnRpY0RpZ2VzdCkpIHtcbiAgICAgICAgLy8gQSBub24tcGVyc2lzdGluZyBtZW1vIHdyaXRlIHdvdWxkIHR1cm4gXCJkZW55IG9uY2UsIHRoZW4gYWxsb3cgdGhlXG4gICAgICAgIC8vIHJldHJ5XCIgaW50byBcImRlbnkgZXZlcnkgdGltZVwiIHdpdGggbm8gZXNjYXBlIFx1MjAxNCBmYWlsIG9wZW4gaW5zdGVhZC5cbiAgICAgICAgaWYgKCFtZW1vU3RhdGUucmVjb3JkKHNlbWFudGljRGlnZXN0KSkgcmV0dXJuIHsgZGVjaXNpb246ICdhbGxvdycsIGtpbmQ6ICdzaWxlbnQnIH07XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgZGVjaXNpb246ICdkZW55JyxcbiAgICAgICAgICBraW5kOiAnc2VtYW50aWMtc3RhbGVuZXNzJyxcbiAgICAgICAgICBmaW5kaW5nczogc2VtYW50aWMsXG4gICAgICAgICAgcmVhc29uOiByZW5kZXJTdGFsZW5lc3NSZWFzb24oc2VtYW50aWMsIGF3YWl0IGZldGNoU3BhbkJsb2NrcyhleGVjdXRvcnMsIHNlbWFudGljLCBjd2QpKVxuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgc2VtYW50aWNBbHJlYWR5UHJlc2VudGVkID0gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBFbnZpcm9ubWVudGFsIGNvbmRpdGlvbnMgYXJlIG5vdCBhIHNwYW4gZWRpdCBhd2F5IGZyb20gcmVzb2x1dGlvbjogZmFpbFxuICAgIC8vIE9QRU4gKGFsbG93KSBcdTIwMTQgYnV0IGNhcnJ5IHRoZW0gc28gdGhlIGFkYXB0ZXIgc3VyZmFjZXMgdGhlIGNvbmRpdGlvbiByYXRoZXJcbiAgICAvLyB0aGFuIHN3YWxsb3dpbmcgaXQuIERlbnlpbmcgd291bGQgcmUtZGVueSBmb3JldmVyIG9uIGFuIGluZnJhIGZhaWx1cmUgdGhlXG4gICAgLy8gdXNlciBjYW5ub3QgY2xlYXIgZnJvbSB0aGUgZ2F0ZSwgY29udHJhZGljdGluZyB0aGUgZmFpbC1vcGVuIGNvbnRyYWN0IHRoZVxuICAgIC8vIHJlc3Qgb2YgdGhlIGdhdGUgYWxyZWFkeSBob25vcnMgZm9yIENMSS1hYnNlbnQvdGltZW91dC9wYXJzZSBmYWlsdXJlcy5cbiAgICBpZiAoZW52aXJvbm1lbnRhbC5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBkZWNpc2lvbjogJ2FsbG93JyxcbiAgICAgICAga2luZDogJ2Vudmlyb25tZW50YWwnLFxuICAgICAgICBjb25kaXRpb25zOiBlbnZpcm9ubWVudGFsLFxuICAgICAgICByZWFzb246IHJlbmRlckVudmlyb25tZW50YWxSZWFzb24oZW52aXJvbm1lbnRhbCwgYXdhaXQgZmV0Y2hTcGFuQmxvY2tzKGV4ZWN1dG9ycywgZW52aXJvbm1lbnRhbCwgY3dkKSlcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gVW5jb3ZlcmVkIHdyaXRlczogY2hhbmdlZCBwYXRocyB3aXRoIHplcm8gY292ZXJpbmcgc3BhbiwgbWludXMgYC5zcGFuLyoqYFxuICAgIC8vIChzcGFuIHJlcGFpcnMgcmlkZSB0aGUgc2FtZSBjb21taXQgYW5kIG11c3QgbmV2ZXIgc2VsZi10cmlnZ2VyIHRoZSBnYXRlKVxuICAgIC8vIGFuZCBwYXRocyB0aGUgcmVwbydzIHVzZXItb3duZWQgYC5zcGFuLy5nYXRlaWdub3JlYCBleGNsdWRlcy4gR2l0aWdub3JlZFxuICAgIC8vIHBhdGhzIG5ldmVyIHJlYWNoIGhlcmUgXHUyMDE0IGdpdCBkb2VzIG5vdCBzdGFnZS9wdWJsaXNoIHRoZW0uXG4gICAgY29uc3QgdW5jb3ZlcmVkID0gYXdhaXQgY29tcHV0ZVVuY292ZXJlZFBhdGhzKHBhdGhzLCBjd2QsIGV4ZWN1dG9ycyk7XG4gICAgaWYgKHVuY292ZXJlZC5sZW5ndGggPT09IDApIHtcbiAgICAgIC8vIEEgcmV0cnkgdGhhdCBmZWxsIHRocm91Z2ggcGFzdCBhbiBhbHJlYWR5LXByZXNlbnRlZCBzZW1hbnRpYy1zdGFsZW5lc3NcbiAgICAgIC8vIGRpZ2VzdCBlbmRzIGNsZWFuIGhlcmU6IHN1cmZhY2UgYWxyZWFkeS1wcmVzZW50ZWQgcmF0aGVyIHRoYW4gYSBiYXJlXG4gICAgICAvLyBzaWxlbnQgYWxsb3csIG1pcnJvcmluZyB0aGUgdW5jb3ZlcmVkIGJyYW5jaCdzIG93biBtZW1vLWhpdCByZXN1bHQuXG4gICAgICByZXR1cm4gc2VtYW50aWNBbHJlYWR5UHJlc2VudGVkXG4gICAgICAgID8geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ2FscmVhZHktcHJlc2VudGVkJyB9XG4gICAgICAgIDogeyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ3NpbGVudCcgfTtcbiAgICB9XG5cbiAgICAvLyBDb25zaWRlci1vbmNlOiBkZW55IHRoZSBmaXJzdCB0aW1lIHRoaXMgZXhhY3QgZGVidCBzdGF0ZSBpcyBzZWVuLCB0aGVuXG4gICAgLy8gcGFzcyB0aGUgcmV0cnkgd2l0aCBhbiB1bmNoYW5nZWQgc3RhdGUuIChObyBzZW1hbnRpYyByb3dzIHN1cnZpdmUgdG9cbiAgICAvLyBoZXJlIHVucHJlc2VudGVkIFx1MjAxNCB0aGUgc2VtYW50aWMgYnJhbmNoIGFib3ZlIGhhcyBhbHJlYWR5IHJldHVybmVkIGZvclxuICAgIC8vIHRoYXQgY2FzZSBcdTIwMTQgc28gdGhlIGRpZ2VzdCdzIGZpbmRpbmdzIGNvbXBvbmVudCBpcyBlbXB0eSBhbmQgdGhlIHN0YXRlXG4gICAgLy8gaXMga2V5ZWQgYnkgdGhlIHVuY292ZXJlZCBzZXQuKVxuICAgIGNvbnN0IGRpZ2VzdCA9IGdhdGVTdGF0ZURpZ2VzdChbXSwgdW5jb3ZlcmVkKTtcbiAgICBpZiAobWVtb1N0YXRlLmhhcyhkaWdlc3QpKSByZXR1cm4geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ2FscmVhZHktcHJlc2VudGVkJyB9O1xuICAgIC8vIEEgbm9uLXBlcnNpc3RpbmcgbWVtbyB3cml0ZSB3b3VsZCB0dXJuIFwiZGVueSBvbmNlLCB0aGVuIGFsbG93IHRoZSByZXRyeVwiXG4gICAgLy8gaW50byBcImRlbnkgZXZlcnkgdGltZVwiIHdpdGggbm8gZXNjYXBlIFx1MjAxNCBmYWlsIG9wZW4gcmF0aGVyIHRoYW4gZGVueS5cbiAgICBpZiAoIW1lbW9TdGF0ZS5yZWNvcmQoZGlnZXN0KSkgcmV0dXJuIHsgZGVjaXNpb246ICdhbGxvdycsIGtpbmQ6ICdzaWxlbnQnIH07XG4gICAgcmV0dXJuIHsgZGVjaXNpb246ICdkZW55Jywga2luZDogJ3VuY292ZXJlZC13cml0ZXMnLCB1bmNvdmVyZWQsIHJlYXNvbjogcmVuZGVyVW5jb3ZlcmVkUmVhc29uKHVuY292ZXJlZCkgfTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgLy8gQSBzY2FuIHRoYXQgY291bGQgbm90IENPTVBMRVRFIGlzIG5vdCBhIGNsZWFuIHJlc3VsdCwgYnV0IGl0IGlzIG5vdFxuICAgIC8vIGRlYnQgZWl0aGVyIFx1MjAxNCB0aGVyZSBpcyBub3RoaW5nIGhlcmUgZm9yIGEgdXNlciB0byByZXNvbHZlIGJ5IGVkaXRpbmcgYVxuICAgIC8vIHNwYW4uIEZhaWwgT1BFTiB3aXRoIGEgZGlzdGluZ3Vpc2hhYmxlIGBzY2FuLWZhaWxlZGAgd2FybmluZyBpbnN0ZWFkIG9mXG4gICAgLy8gc2lsZW50bHkgcmVhZGluZyB0aGUgYWJvcnRlZCBzY2FuJ3MgZW1wdHkgcmVzdWx0IGFzIGNsZWFuLlxuICAgIGlmIChlcnIgaW5zdGFuY2VvZiBHYXRlU2NhbkVycm9yKSB7XG4gICAgICByZXR1cm4geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ3NjYW4tZmFpbGVkJywgcmVhc29uOiByZW5kZXJTY2FuRmFpbGVkUmVhc29uKGVyci5kZXRhaWwpIH07XG4gICAgfVxuICAgIC8vIEZhaWwgb3BlbjogYW55IG90aGVyIGludGVybmFsL0NMSSBlcnJvciByZXNvbHZlcyB0byBhbGxvdy4gVGhlIGdhdGUgbXVzdFxuICAgIC8vIG5ldmVyIGJyaWNrIGEgY29tbWl0IG9uIGl0cyBvd24gZmFpbHVyZS5cbiAgICByZXR1cm4geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ3NpbGVudCcgfTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBjaGFuZ2VkIHBhdGhzIHdpdGggemVybyBjb3ZlcmluZyBzcGFuIFx1MjAxNCBtaW51cyBgLnNwYW4vKipgIChzcGFuIHJlcGFpcnNcbiAqIHJpZGUgdGhlIHNhbWUgY29tbWl0IGFuZCBtdXN0IG5ldmVyIHNlbGYtdHJpZ2dlciB0aGUgZ2F0ZSkgYW5kIHBhdGhzIHRoZVxuICogcmVwbydzIHVzZXItb3duZWQgYC5zcGFuLy5nYXRlaWdub3JlYCBleGNsdWRlcyAoZmFpbC1vcGVuIHdoZW4gYWJzZW50L1xuICogdW5yZWFkYWJsZSkuIFNoYXJlZCBieSBgZXZhbHVhdGVHYXRlYCdzIGAnZW5mb3JjZSdgIGFuZCBgJ2luZm9ybSdgIGJyYW5jaGVzLFxuICogd2hpY2ggZGlmZmVyIG9ubHkgaW4gd2hhdCB0aGV5IGRvIHdpdGggdGhlIHJlc3VsdCAoZGVueS1vbmNlIHZzLiBhblxuICogYWx3YXlzLWZyZXNoIGFkdmlzb3J5KS5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gY29tcHV0ZVVuY292ZXJlZFBhdGhzKHBhdGhzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcsIGV4ZWN1dG9yczogR2F0ZUV4ZWN1dG9ycyk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgY29uc3QgY292ZXJpbmcgPSBhd2FpdCBleGVjdXRvcnMubGlzdChwYXRocywgY3dkKTtcbiAgY29uc3QgY292ZXJlZCA9IG5ldyBTZXQoY292ZXJpbmcubWFwKChyb3cpID0+IHJvdy5wYXRoKSk7XG4gIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gIGNvbnN0IGdhdGVJZ25vcmVSdWxlcyA9IHJlcG9Sb290ID8gbG9hZEdhdGVJZ25vcmUocmVwb1Jvb3QpIDogW107XG4gIHJldHVybiBwYXRocy5maWx0ZXIoKHBhdGgpID0+ICFjb3ZlcmVkLmhhcyhwYXRoKSAmJiAhaXNJbnNpZGVTcGFuUm9vdChwYXRoKSAmJiAhaXNHYXRlSWdub3JlZChnYXRlSWdub3JlUnVsZXMsIHBhdGgpKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBEZWJ0LXN0YXRlIGRpZ2VzdCBhbmQgcmVhc29uIHJlbmRlcmluZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBgcGF0aCNMc3RhcnQtTGVuZGAsIG9yIGEgYmFyZSBwYXRoIGZvciBhIHdob2xlLWZpbGUgYW5jaG9yLiAqL1xuZnVuY3Rpb24gYW5jaG9yVGV4dChyb3c6IFN0YWxlUG9yY2VsYWluUm93KTogc3RyaW5nIHtcbiAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSByZXR1cm4gcm93LnBhdGg7XG4gIHJldHVybiBgJHtyb3cucGF0aH0jTCR7cm93LnN0YXJ0fS1MJHtyb3cuZW5kfWA7XG59XG5cbi8qKlxuICogVGhlIGRpc3RpbmN0LWRlYnQtc3RhdGUgZGlnZXN0IChkZXNpZ24tZGVjaXNpb25zLm1kICM5KTogYSBzdGFibGUgaGFzaCBvZiB0aGVcbiAqIHNvcnRlZCBzdGFsZW5lc3MgZmluZGluZ3MgcGx1cyB0aGUgc29ydGVkIHVuY292ZXJlZCBwYXRocy4gUHJlc2VuY2UgaW4gdGhlXG4gKiBtZW1vIG1lYW5zIFwidGhpcyBleGFjdCBzdGF0ZSB3YXMgYWxyZWFkeSBwcmVzZW50ZWQgb25jZS5cIlxuICovXG5mdW5jdGlvbiBnYXRlU3RhdGVEaWdlc3QoZmluZGluZ3M6IFN0YWxlUG9yY2VsYWluUm93W10sIHVuY292ZXJlZDogc3RyaW5nW10pOiBzdHJpbmcge1xuICBjb25zdCBmaW5kaW5nS2V5cyA9IGZpbmRpbmdzLm1hcCgocm93KSA9PiBgJHtyb3cuc3RhdHVzfVxcdCR7cm93Lm5hbWV9XFx0JHtyb3cucGF0aH1cXHQke3Jvdy5zdGFydH1cXHQke3Jvdy5lbmR9YCkuc29ydCgpO1xuICBjb25zdCBwYXlsb2FkID0gSlNPTi5zdHJpbmdpZnkoeyBmaW5kaW5nczogZmluZGluZ0tleXMsIHVuY292ZXJlZDogWy4uLnVuY292ZXJlZF0uc29ydCgpIH0pO1xuICByZXR1cm4gY3JlYXRlSGFzaCgnc2hhMjU2JykudXBkYXRlKHBheWxvYWQpLmRpZ2VzdCgnaGV4Jyk7XG59XG5cbi8qKlxuICogRmV0Y2ggdGhlIGh1bWFuLWZvcm1hdCBgIyMgPG5hbWU+YCBibG9ja3MgZm9yIHRoZSBzcGFucyBuYW1lZCBpbiBgcm93c2AsXG4gKiBmYWlsaW5nIHRvIGAnJ2AgKG5ldmVyIHRocm93aW5nKSBzbyBhIGxpc3QgZmFpbHVyZSBjYW4gbmV2ZXIgdHVybiBhIGRlbnlcbiAqIGludG8gYSBzaWxlbnQgYWxsb3cgdmlhIHtAbGluayBldmFsdWF0ZUdhdGV9J3Mgb3V0ZXIgY2F0Y2ggXHUyMDE0XG4gKiB7QGxpbmsgYW5ub3RhdGVCbG9ja3N9IHN5bnRoZXNpemVzIG1pbmltYWwgYmxvY2tzIGZyb20gdGhlIHJvd3MgaW5zdGVhZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZmV0Y2hTcGFuQmxvY2tzKGV4ZWN1dG9yczogR2F0ZUV4ZWN1dG9ycywgcm93czogU3RhbGVQb3JjZWxhaW5Sb3dbXSwgY3dkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBuYW1lcyA9IFsuLi5uZXcgU2V0KHJvd3MubWFwKChyb3cpID0+IHJvdy5uYW1lKSldLnNvcnQoKTtcbiAgdHJ5IHtcbiAgICByZXR1cm4gYXdhaXQgZXhlY3V0b3JzLmxpc3RCbG9ja3MobmFtZXMsIGN3ZCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnJztcbiAgfVxufVxuXG4vKipcbiAqIEFubm90YXRlIGBnaXQgc3BhbiBsaXN0YCBodW1hbiBibG9ja3Mgd2l0aCBwZXItYW5jaG9yIGRyaWZ0IGxhYmVsczogZWFjaFxuICogYnVsbGV0IHdob3NlIGFuY2hvciBtYXRjaGVzIGEgZmluZGluZyBnYWlucyBgIFx1MjAxNCA8bGFiZWw+YC4gQnVsbGV0cyBhcmUgb25seVxuICogdGhlIGNvbnRpZ3VvdXMgYC0gYCBydW4gZGlyZWN0bHkgdW5kZXIgYSBgIyMgPG5hbWU+YCBoZWFkZXIsIHNvIGFcbiAqIGRlc2NyaXB0aW9uIGxpbmUgdGhhdCBoYXBwZW5zIHRvIHN0YXJ0IHdpdGggYC0gYCBpcyBuZXZlciBhbm5vdGF0ZWQuXG4gKiBGaW5kaW5ncyB3aG9zZSBhbmNob3IgaGFzIG5vIG1hdGNoaW5nIGJ1bGxldCBhcmUgYXBwZW5kZWQgdG8gdGhlaXIgc3BhbidzXG4gKiBidWxsZXQgcnVuOyBzcGFucyBhYnNlbnQgZnJvbSBgYmxvY2tzVGV4dGAgZW50aXJlbHkgKG9yIGFuIGVtcHR5L2ZhaWxlZFxuICogbGlzdCByZWFkKSBnZXQgYSBzeW50aGVzaXplZCBtaW5pbWFsIGJsb2NrIFx1MjAxNCBubyBmaW5kaW5nIGlzIGV2ZXIgZHJvcHBlZC5cbiAqL1xuZnVuY3Rpb24gYW5ub3RhdGVCbG9ja3MoYmxvY2tzVGV4dDogc3RyaW5nLCByb3dzOiBTdGFsZVBvcmNlbGFpblJvd1tdKTogc3RyaW5nIHtcbiAgY29uc3QgcmVtYWluaW5nID0gbmV3IE1hcDxzdHJpbmcsIFN0YWxlUG9yY2VsYWluUm93W10+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBjb25zdCBncm91cCA9IHJlbWFpbmluZy5nZXQocm93Lm5hbWUpO1xuICAgIGlmIChncm91cCkgZ3JvdXAucHVzaChyb3cpO1xuICAgIGVsc2UgcmVtYWluaW5nLnNldChyb3cubmFtZSwgW3Jvd10pO1xuICB9XG5cbiAgY29uc3Qgb3V0OiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgcGVuZGluZzogU3RhbGVQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBsZXQgaW5CdWxsZXRzID0gZmFsc2U7XG4gIGNvbnN0IGNsb3NlQnVsbGV0cyA9ICgpOiB2b2lkID0+IHtcbiAgICBmb3IgKGNvbnN0IHJvdyBvZiBwZW5kaW5nKSBvdXQucHVzaChgLSAke2FuY2hvclRleHQocm93KX0gXHUyMDE0ICR7aHVtYW5TdGF0dXNMYWJlbChyb3cuc3RhdHVzKX1gKTtcbiAgICBwZW5kaW5nID0gW107XG4gICAgaW5CdWxsZXRzID0gZmFsc2U7XG4gIH07XG5cbiAgY29uc3QgdHJpbW1lZCA9IGJsb2Nrc1RleHQudHJpbSgpO1xuICBpZiAodHJpbW1lZC5sZW5ndGggPiAwKSB7XG4gICAgZm9yIChjb25zdCBsaW5lIG9mIHRyaW1tZWQuc3BsaXQoJ1xcbicpKSB7XG4gICAgICBjb25zdCBoZWFkZXIgPSAvXiMjICguKykkLy5leGVjKGxpbmUpO1xuICAgICAgaWYgKGhlYWRlcikge1xuICAgICAgICBjbG9zZUJ1bGxldHMoKTtcbiAgICAgICAgb3V0LnB1c2gobGluZSk7XG4gICAgICAgIHBlbmRpbmcgPSByZW1haW5pbmcuZ2V0KGhlYWRlclsxXSkgPz8gW107XG4gICAgICAgIHJlbWFpbmluZy5kZWxldGUoaGVhZGVyWzFdKTtcbiAgICAgICAgaW5CdWxsZXRzID0gdHJ1ZTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoaW5CdWxsZXRzICYmIGxpbmUuc3RhcnRzV2l0aCgnLSAnKSkge1xuICAgICAgICBjb25zdCBhZGRyID0gbGluZS5zbGljZSgyKTtcbiAgICAgICAgbGV0IGlkeCA9IHBlbmRpbmcuZmluZEluZGV4KChyb3cpID0+IGFuY2hvclRleHQocm93KSA9PT0gYWRkcik7XG4gICAgICAgIGlmIChpZHggPT09IC0xKSBpZHggPSBwZW5kaW5nLmZpbmRJbmRleCgocm93KSA9PiBhZGRyID09PSByb3cucGF0aCB8fCBhZGRyLnN0YXJ0c1dpdGgoYCR7cm93LnBhdGh9I2ApKTtcbiAgICAgICAgaWYgKGlkeCA+PSAwKSB7XG4gICAgICAgICAgY29uc3QgW3Jvd10gPSBwZW5kaW5nLnNwbGljZShpZHgsIDEpO1xuICAgICAgICAgIG91dC5wdXNoKGAke2xpbmV9IFx1MjAxNCAke2h1bWFuU3RhdHVzTGFiZWwocm93LnN0YXR1cyl9YCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgb3V0LnB1c2gobGluZSk7XG4gICAgICAgIH1cbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoaW5CdWxsZXRzKSBjbG9zZUJ1bGxldHMoKTtcbiAgICAgIG91dC5wdXNoKGxpbmUpO1xuICAgIH1cbiAgICBjbG9zZUJ1bGxldHMoKTtcbiAgfVxuXG4gIGZvciAoY29uc3QgW25hbWUsIGdyb3VwXSBvZiByZW1haW5pbmcpIHtcbiAgICBpZiAob3V0Lmxlbmd0aCA+IDApIG91dC5wdXNoKCcnLCAnLS0tJywgJycpO1xuICAgIG91dC5wdXNoKGAjIyAke25hbWV9YCk7XG4gICAgZm9yIChjb25zdCByb3cgb2YgZ3JvdXApIG91dC5wdXNoKGAtICR7YW5jaG9yVGV4dChyb3cpfSBcdTIwMTQgJHtodW1hblN0YXR1c0xhYmVsKHJvdy5zdGF0dXMpfWApO1xuICB9XG5cbiAgcmV0dXJuIG91dC5qb2luKCdcXG4nKTtcbn1cblxuLyoqXG4gKiBUaGUgZnVsbC1zcGFuIGNoZWNrbGlzdCBhIHNlbWFudGljLXN0YWxlbmVzcyBgZGVueWAgKG9yLCBpbiBgJ2luZm9ybSdgIG1vZGUsXG4gKiBhIGBzdGF0dXNgIGFkdmlzb3J5KSByZW5kZXJzIGludG8gYHJlYXNvbmAuIFRoZSBjbG9zaW5nIHNlbnRlbmNlIGRyb3BzIFwiXHUyMDE0XG4gKiB0aGVuIHJldHJ5XCIgaW4gYCdpbmZvcm0nYCBtb2RlOiBhIGBzdGF0dXNgIGNoZWNrIG5ldmVyIGhlbGQgYW55dGhpbmcsIHNvXG4gKiB0aGVyZSBpcyBub3RoaW5nIHRvIHJldHJ5LlxuICovXG5mdW5jdGlvbiByZW5kZXJTdGFsZW5lc3NSZWFzb24oZmluZGluZ3M6IFN0YWxlUG9yY2VsYWluUm93W10sIGJsb2Nrc1RleHQ6IHN0cmluZywgbW9kZTogR2F0ZU1vZGUgPSAnZW5mb3JjZScpOiBzdHJpbmcge1xuICBjb25zdCBuYW1lcyA9IFsuLi5uZXcgU2V0KGZpbmRpbmdzLm1hcCgocm93KSA9PiByb3cubmFtZSkpXTtcbiAgY29uc3Qgc3ViamVjdCA9IG5hbWVzLmxlbmd0aCA9PT0gMSA/ICdhbiBpbXBsaWNpdCBkZXBlbmRlbmN5JyA6ICdpbXBsaWNpdCBkZXBlbmRlbmNpZXMnO1xuICBjb25zdCBuYW1lID0gbmFtZXMubGVuZ3RoID09PSAxID8gbmFtZXNbMF0gOiAnPG5hbWU+JztcbiAgY29uc3QgYWN0aW9uID0gYFxcYGdpdCBzcGFuIGFkZCAke25hbWV9IDxwYXRoI0xzdGFydC1MZW5kPlxcYCAvIFxcYGdpdCBzcGFuIHdoeSAke25hbWV9IC1tIFwiLi4uXCJcXGBgO1xuICBjb25zdCBjbG9zaW5nID1cbiAgICBtb2RlID09PSAnZW5mb3JjZSdcbiAgICAgID8gYFVwZGF0ZSB0aGUgZHJpZnRlZCBsb2NhdGlvbnMgb3IgdGhlIGRlc2NyaXB0aW9uIFx1MjAxNCAke2FjdGlvbn0gXHUyMDE0IHRoZW4gcmV0cnkuIElmIGEgZGVwZW5kZW5jeSBubyBsb25nZXIgaG9sZHMsIHRlbGwgdGhlIHVzZXIgaW5zdGVhZC5gXG4gICAgICA6IGBVcGRhdGUgdGhlIGRyaWZ0ZWQgbG9jYXRpb25zIG9yIHRoZSBkZXNjcmlwdGlvbiBcdTIwMTQgJHthY3Rpb259LiBJZiBhIGRlcGVuZGVuY3kgbm8gbG9uZ2VyIGhvbGRzLCB0ZWxsIHRoZSB1c2VyIGluc3RlYWQuYDtcbiAgcmV0dXJuIFtcbiAgICBgVGhpcyBjaGFuZ2UgbGVhdmVzICR7c3ViamVjdH0gb3V0IG9mIGRhdGU6YCxcbiAgICAnJyxcbiAgICBhbm5vdGF0ZUJsb2NrcyhibG9ja3NUZXh0LCBmaW5kaW5ncyksXG4gICAgJycsXG4gICAgJy0tLScsXG4gICAgJycsXG4gICAgY2xvc2luZ1xuICBdLmpvaW4oJ1xcbicpO1xufVxuXG4vKipcbiAqIFRoZSBhZHZpc29yeSBzdXJmYWNlZCB3aGVuIHRoZSBjaGFuZ2VzZXQncyBvbmx5IHN0YWxlbmVzcyBpcyBlbnZpcm9ubWVudGFsIFx1MjAxNFxuICogdGhlIGdhdGUgYWxsb3dzIGJ1dCBzYXlzIHdoeSwgc28gdGhlIHVucmVzb2x2YWJsZSBjb25kaXRpb24gaXMgbm90IHNpbGVudGx5XG4gKiBzd2FsbG93ZWQuXG4gKi9cbmZ1bmN0aW9uIHJlbmRlckVudmlyb25tZW50YWxSZWFzb24oY29uZGl0aW9uczogU3RhbGVQb3JjZWxhaW5Sb3dbXSwgYmxvY2tzVGV4dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIFtcbiAgICAnQ291bGQgbm90IGNoZWNrIHRoZXNlIGltcGxpY2l0IGRlcGVuZGVuY2llcyAodW5mZXRjaGVkIExGUywgc3BhcnNlIGNoZWNrb3V0LCBvciBzaW1pbGFyKSBcdTIwMTQgbm90IGJsb2NraW5nOicsXG4gICAgJycsXG4gICAgYW5ub3RhdGVCbG9ja3MoYmxvY2tzVGV4dCwgY29uZGl0aW9ucyksXG4gICAgJycsXG4gICAgJy0tLScsXG4gICAgJycsXG4gICAgJ0ZpeCB0aGUgY2hlY2tvdXQvZmV0Y2ggaXNzdWUgaWYgdGhlc2UgZGVwZW5kZW5jaWVzIG5lZWQgdmVyaWZ5aW5nLidcbiAgXS5qb2luKCdcXG4nKTtcbn1cblxuLyoqXG4gKiBUaGUgYWR2aXNvcnkgYW4gYGFsbG93YC9gc2Nhbi1mYWlsZWRgIHJlc3VsdCByZW5kZXJzIGludG8gYHJlYXNvbmA6IHRoZSBzY2FuXG4gKiBjb3VsZCBub3QgY29tcGxldGUsIHNvIHRoZSBjaGFuZ2VzZXQgd2FzIE5PVCB2ZXJpZmllZCBcdTIwMTQgYnV0IHRoZSBjb21tYW5kXG4gKiBwcm9jZWVkcyBhbnl3YXkgKGZhaWwtb3BlbiwgbWF0Y2hpbmcgYGVudmlyb25tZW50YWxgKS5cbiAqL1xuZnVuY3Rpb24gcmVuZGVyU2NhbkZhaWxlZFJlYXNvbihkZXRhaWw6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBbXG4gICAgJ1RoZSBpbXBsaWNpdC1kZXBlbmRlbmN5IGNoZWNrIGNvdWxkIG5vdCBydW4sIHNvIHRoaXMgY2hhbmdlIHdhcyBOT1QgdmVyaWZpZWQ6JyxcbiAgICBgICAke2RldGFpbH1gLFxuICAgICcnLFxuICAgICdUaGUgY29tbWFuZCBwcm9jZWVkcyBhbnl3YXkuIEZpeCB0aGUgc2NhbiBlcnJvciBpZiB2ZXJpZmljYXRpb24gbWF0dGVycyBmb3IgdGhpcyBjaGFuZ2UuJ1xuICBdLmpvaW4oJ1xcbicpO1xufVxuXG4vKipcbiAqIFRoZSBsaXN0IGFuIHVuY292ZXJlZC13cml0ZXMgYGRlbnlgIChvciwgaW4gYCdpbmZvcm0nYCBtb2RlLCBhIGBzdGF0dXNgXG4gKiBhZHZpc29yeSkgcmVuZGVycyBpbnRvIGByZWFzb25gLCB3cmFwcGVkIGluIGEgYDxnaXQtc3Bhbj5gIGJsb2NrIG1hdGNoaW5nIHRoZVxuICogdG91Y2ggaG9vaydzIGJsb2NrIHN0eWxpbmcuIFRoZSBcInJldHJ5IHRoZSBjb21tYW5kIHRvIHByb2NlZWQgKG9uZS10aW1lXG4gKiBjaGVjaylcIiBzZW50ZW5jZSBkcm9wcyBlbnRpcmVseSBpbiBgJ2luZm9ybSdgIG1vZGU6IGEgYHN0YXR1c2AgY2hlY2sgbmV2ZXJcbiAqIGhlbGQgYW55dGhpbmcsIHNvIHRoZXJlIGlzIG5vdGhpbmcgdG8gcmV0cnkgYW5kIG5vIGNvbnNpZGVyLW9uY2Ugc3RhdGUgdG9cbiAqIGNsZWFyLlxuICovXG5mdW5jdGlvbiByZW5kZXJVbmNvdmVyZWRSZWFzb24odW5jb3ZlcmVkOiBzdHJpbmdbXSwgbW9kZTogR2F0ZU1vZGUgPSAnZW5mb3JjZScpOiBzdHJpbmcge1xuICBjb25zdCBsaW5lcyA9IHVuY292ZXJlZC5tYXAoKHBhdGgpID0+IGAtICR7cGF0aH1gKTtcbiAgY29uc3QgYm9keSA9IFtcbiAgICAnPGdpdC1zcGFuPicsXG4gICAgLi4ubGluZXMsXG4gICAgJycsXG4gICAgJ0RldGVybWluZSBpZiB0aGVzZSBmaWxlcyBjYXJyeSBpbXBsaWNpdCBkZXBlbmRlbmNpZXMsIHRoZW4gdXNlIGBnaXQgc3BhbmAgdG8gZG9jdW1lbnQgdGhlbTonLFxuICAgICcnLFxuICAgICdgZ2l0IHNwYW4gYWRkIDxuYW1lPiA8cGF0aCNMc3RhcnQtTGVuZD4gWzxwYXRoI0xzdGFydC1MZW5kPl0gLi4uYCcsXG4gICAgJ2BnaXQgc3BhbiB3aHkgPG5hbWU+IC1tIFwiPHdoeT5cImAnLFxuICAgICcnLFxuICAgICdUaGUgXCI8d2h5PlwiIGlzIGEgc2luZ2xlIHByZXNlbnQtdGVuc2Ugc2VudGVuY2UgbmFtaW5nIHdoYXQgdGhlIHJhbmdlcyBmb3JtIHRvZ2V0aGVyLCBzcGVjaWZpYyBlbm91Z2ggdG8gdGVsbCB3aGV0aGVyIGFuIGVkaXQgbGFuZHMgaW5zaWRlIGl0LCB3aXRoIG5vIHJ1bGVzIG9yIHJlbWluZGVycy4nXG4gIF07XG4gIGlmIChtb2RlID09PSAnZW5mb3JjZScpIHtcbiAgICBib2R5LnB1c2goJycsICdJZiBub25lIGV4aXN0LCByZXRyeSB0aGUgY29tbWFuZCB0byBwcm9jZWVkIChvbmUtdGltZSBjaGVjaykuJyk7XG4gIH1cbiAgYm9keS5wdXNoKCcnLCAnTG9hZCB0aGUgYGdpdC1zcGFuOmdpdC1zcGFuYCBza2lsbCBmb3IgZ3VpZGFuY2UuJywgJzwvZ2l0LXNwYW4+Jyk7XG4gIHJldHVybiBib2R5LmpvaW4oJ1xcbicpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERlZmF1bHQgc3VicHJvY2Vzcy9kaXNrLWJhY2tlZCBkZXBlbmRlbmNpZXNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy9cbi8vIFRoZSBwcm9kdWN0aW9uIHN1cmZhY2VzIGJvdGggYWRhcHRlcnMgaW5qZWN0IGJ5IGRlZmF1bHQsIGZvbGxvd2luZ1xuLy8gdG91Y2gtY29yZS50cydzIGBjcmVhdGVEZWZhdWx0VG91Y2hFeGVjdXRvcnNgIHN0eWxlOiBlYWNoIGNhcHR1cmVzIHN0ZG91dCBldmVuXG4vLyBvbiBhIG5vbi16ZXJvIGV4aXQgd2hlcmUgdGhlIENMSSBzdGlsbCBlbWl0cyB1c2VmdWwgb3V0cHV0LCBhbmQgZXZlcnkgZmFpbHVyZVxuLy8gbW9kZSAoYWJzZW50IGJpbmFyeSwgdGltZW91dCwgbm8gcmVwbykgc3VyZmFjZXMgYXMgYW4gZW1wdHkvY2xlYW4gcmVzdWx0IHNvXG4vLyB0aGUgZ2F0ZSdzIGZhaWwtb3BlbiBjb250cmFjdCBob2xkcyB3aXRob3V0IHRoZSBhZGFwdGVyIGFkZGluZyBpdHMgb3duLlxuXG5jb25zdCBERUZBVUxUX1RJTUVPVVRfTVMgPSAxMF8wMDA7XG5cbi8qKiBSdW4gYSBnaXQgY29tbWFuZCBhdCBgY3dkYCwgcmV0dXJuaW5nIHRyaW1tZWQgbm9uLWVtcHR5IFBPU0lYIG91dHB1dCBsaW5lcyAoZW1wdHkgb24gYW55IGZhaWx1cmUpLiAqL1xuZnVuY3Rpb24gZ2l0TGluZXMoYXJnczogc3RyaW5nW10sIGN3ZDogc3RyaW5nLCB0aW1lb3V0TXM6IG51bWJlcik6IHN0cmluZ1tdIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIGFyZ3MsIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgIH0pO1xuICAgIHJldHVybiBvdXRcbiAgICAgIC5zcGxpdCgnXFxuJylcbiAgICAgIC5tYXAoKGxpbmUpID0+IGxpbmUudHJpbSgpKVxuICAgICAgLmZpbHRlcigobGluZSkgPT4gbGluZS5sZW5ndGggPiAwKVxuICAgICAgLm1hcCh0b1Bvc2l4KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG59XG5cbi8qKlxuICogTGlrZSB7QGxpbmsgZ2l0TGluZXN9IGJ1dCBkaXN0aW5ndWlzaGVzIGEgKmZhaWxlZCogaW52b2NhdGlvbiAoYG51bGxgIFx1MjAxNCBlLmcuXG4gKiBgQHt1fWAgd2l0aCBubyB1cHN0cmVhbSBjb25maWd1cmVkKSBmcm9tIGEgKnN1Y2Nlc3NmdWwgYnV0IGVtcHR5KiByZXN1bHRcbiAqIChgW11gKSwgc28gdGhlIG91dGdvaW5nLXJhbmdlIHJlc29sdXRpb24ga25vd3Mgd2hlbiB0byB0cnkgdGhlIG1lcmdlLWJhc2VcbiAqIGZhbGxiYWNrIHJhdGhlciB0aGFuIG1pc3Rha2luZyBcIm5vIHVwc3RyZWFtXCIgZm9yIFwibm90aGluZyB0byBwdXNoXCIuXG4gKi9cbmZ1bmN0aW9uIGdpdExpbmVzT3JOdWxsKGFyZ3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZywgdGltZW91dE1zOiBudW1iZXIpOiBzdHJpbmdbXSB8IG51bGwge1xuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgYXJncywge1xuICAgICAgY3dkLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgfSk7XG4gICAgcmV0dXJuIG91dFxuICAgICAgLnNwbGl0KCdcXG4nKVxuICAgICAgLm1hcCgobGluZSkgPT4gbGluZS50cmltKCkpXG4gICAgICAuZmlsdGVyKChsaW5lKSA9PiBsaW5lLmxlbmd0aCA+IDApXG4gICAgICAubWFwKHRvUG9zaXgpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKiogVGhlIHByb2R1Y3Rpb24ge0BsaW5rIEdpdEV4ZWN1dG9yfTogYGdpdCBkaWZmYCByZWFkcyBzY29wZWQgdG8gdGhlIENXRCByZXBvLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHRHaXRFeGVjdXRvcih0aW1lb3V0TXM6IG51bWJlciA9IERFRkFVTFRfVElNRU9VVF9NUyk6IEdpdEV4ZWN1dG9yIHtcbiAgcmV0dXJuIHtcbiAgICBzdGFnZWRQYXRoczogYXN5bmMgKGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGlmICghcmVwb1Jvb3QpIHJldHVybiBbXTtcbiAgICAgIHJldHVybiBnaXRMaW5lcyhbJy1DJywgcmVwb1Jvb3QsICdkaWZmJywgJy0tY2FjaGVkJywgJy0tbmFtZS1vbmx5J10sIHJlcG9Sb290LCB0aW1lb3V0TXMpO1xuICAgIH0sXG4gICAgdHJhY2tlZE1vZGlmaWVkUGF0aHM6IGFzeW5jIChjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290KSByZXR1cm4gW107XG4gICAgICByZXR1cm4gZ2l0TGluZXMoWyctQycsIHJlcG9Sb290LCAnZGlmZicsICctLW5hbWUtb25seSddLCByZXBvUm9vdCwgdGltZW91dE1zKTtcbiAgICB9LFxuICAgIG91dGdvaW5nUGF0aHM6IGFzeW5jIChjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290KSByZXR1cm4gW107XG4gICAgICBjb25zdCB1cHN0cmVhbSA9IGdpdExpbmVzT3JOdWxsKFsnLUMnLCByZXBvUm9vdCwgJ2RpZmYnLCAnLS1uYW1lLW9ubHknLCAnQHt1fS4uSEVBRCddLCByZXBvUm9vdCwgdGltZW91dE1zKTtcbiAgICAgIGlmICh1cHN0cmVhbSAhPT0gbnVsbCkgcmV0dXJuIHVwc3RyZWFtO1xuICAgICAgLy8gTm8gdXBzdHJlYW0gY29uZmlndXJlZDogZmFsbCBiYWNrIHRvIHRoZSBtZXJnZS1iYXNlIHdpdGggdGhlIGRlZmF1bHRcbiAgICAgIC8vIHJlbW90ZSBicmFuY2ggKGBvcmlnaW4vSEVBRGApLiBJZiB0aGF0IHRvbyBpcyB1bnJlc29sdmFibGUsIGZhaWwgb3Blbi5cbiAgICAgIGNvbnN0IGJhc2UgPSBnaXRMaW5lcyhbJy1DJywgcmVwb1Jvb3QsICdtZXJnZS1iYXNlJywgJ0hFQUQnLCAnb3JpZ2luL0hFQUQnXSwgcmVwb1Jvb3QsIHRpbWVvdXRNcylbMF07XG4gICAgICBpZiAoIWJhc2UpIHJldHVybiBbXTtcbiAgICAgIHJldHVybiBnaXRMaW5lcyhbJy1DJywgcmVwb1Jvb3QsICdkaWZmJywgJy0tbmFtZS1vbmx5JywgYCR7YmFzZX0uLkhFQURgXSwgcmVwb1Jvb3QsIHRpbWVvdXRNcyk7XG4gICAgfSxcbiAgICBwYXRoc3BlY1BhdGhzOiBhc3luYyAocGF0aHMsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGlmICghcmVwb1Jvb3QgfHwgcGF0aHMubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gICAgICAvLyBXb3JraW5nLXRyZWUgY29udGVudCB2cyBIRUFELCBzY29wZWQgdG8gdGhlIHBhdGhzcGVjcyBcdTIwMTQgdGhlIGZpbGVzIGFcbiAgICAgIC8vIGBnaXQgY29tbWl0IC0tIDxwYXRoc3BlYz5gIHdvdWxkIGFjdHVhbGx5IGNoYW5nZSAoc3RhZ2VkIG9yIG5vdCkuXG4gICAgICByZXR1cm4gZ2l0TGluZXMoWyctQycsIHJlcG9Sb290LCAnZGlmZicsICdIRUFEJywgJy0tbmFtZS1vbmx5JywgJy0tJywgLi4ucGF0aHNdLCByZXBvUm9vdCwgdGltZW91dE1zKTtcbiAgICB9XG4gIH07XG59XG5cbi8qKiBUaGUgcHJvZHVjdGlvbiB7QGxpbmsgR2F0ZUV4ZWN1dG9yc306IHNjb3BlZCBgZ2l0IHNwYW5gIGZpeC9zdGFsZS9saXN0IGF0IHRoZSByZXBvIHJvb3QuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdEdhdGVFeGVjdXRvcnModGltZW91dE1zOiBudW1iZXIgPSBERUZBVUxUX1RJTUVPVVRfTVMpOiBHYXRlRXhlY3V0b3JzIHtcbiAgcmV0dXJuIHtcbiAgICBmaXg6IGFzeW5jIChwYXRocywgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCB8fCBwYXRocy5sZW5ndGggPT09IDApIHJldHVybjtcbiAgICAgIHRyeSB7XG4gICAgICAgIGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ3N0YWxlJywgLi4ucGF0aHMsICctLWZpeCddLCB7XG4gICAgICAgICAgY3dkOiByZXBvUm9vdCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gYGdpdCBzcGFuIHN0YWxlYCBleGl0cyAxIG9uIGRyaWZ0IGV2ZW4gYWZ0ZXIgaGVhbGluZywgYW5kIG5vbi16ZXJvIG9uXG4gICAgICAgIC8vIGdlbnVpbmUgZmFpbHVyZTsgZWl0aGVyIHdheSB0aGUgc3Vic2VxdWVudCBgc3RhbGVgIHJlYWQgaXMgdGhlIHNvdXJjZVxuICAgICAgICAvLyBvZiB0cnV0aCwgc28gdGhlIGV4aXQgY29kZSBpcyBpZ25vcmVkIGhlcmUuXG4gICAgICB9XG4gICAgfSxcbiAgICBzdGFsZTogYXN5bmMgKHBhdGhzLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290IHx8IHBhdGhzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICAgICAgbGV0IG91dDogc3RyaW5nO1xuICAgICAgdHJ5IHtcbiAgICAgICAgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnc3RhbGUnLCAnLS1mb3JtYXQnLCAncG9yY2VsYWluJywgLi4ucGF0aHNdLCB7XG4gICAgICAgICAgY3dkOiByZXBvUm9vdCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgLy8gYGdpdCBzcGFuIHN0YWxlYCBleGl0cyBub24temVybyBpbiB0d28gdmVyeSBkaWZmZXJlbnQgd2F5cywgYW5kIHRoZXlcbiAgICAgICAgLy8gbXVzdCBub3QgYmUgY29uZmxhdGVkOlxuICAgICAgICAvLyAgLSBMZWdpdGltYXRlIGRyaWZ0OiByZWFsIHBvcmNlbGFpbiByb3dzIG9uIHN0ZG91dCBkZXNjcmliaW5nIHRoZVxuICAgICAgICAvLyAgICBkcmlmdC4gUGFyc2UgdGhlbSAodGhpcyBpcyB0aGUgd2hvbGUgcG9pbnQgb2YgdGhlIHJlYWQpLlxuICAgICAgICAvLyAgLSBIYXJkIHNjYW4gZmFpbHVyZTogdGhlIHNjb3BlZCBxdWVyeSBhYm9ydGVkIGJlZm9yZSBjb21wbGV0aW5nIChlLmcuXG4gICAgICAgIC8vICAgIGFuIHVucmVhZGFibGUgYW5jaG9yIGZpbGUpLCB3cml0aW5nIGFuIGVycm9yIHRvIHN0ZGVyciBhbmQgZW1pdHRpbmdcbiAgICAgICAgLy8gICAgZW1wdHkgc3Rkb3V0LiBBbiBlbXB0eSByZXN1bHQgaGVyZSBpcyBOT1QgXCJjbGVhblwiIFx1MjAxNCB0aGUgc2NhbiBuZXZlclxuICAgICAgICAvLyAgICByYW4gdG8gY29tcGxldGlvbiBcdTIwMTQgc28gc2lnbmFsIGl0IGRpc3RpbmN0bHkgcmF0aGVyIHRoYW4gcGFyc2luZyB0b1xuICAgICAgICAvLyAgICBgW11gLCB3aGljaCB3b3VsZCByZWFkIGFzIGEgY2xlYW4gcGFzcyBhbmQgc2lsZW50bHkgYWxsb3cgdGhlIGNvbW1pdC5cbiAgICAgICAgY29uc3Qgc3Rkb3V0ID0gKGVyciBhcyB7IHN0ZG91dD86IHN0cmluZyB9KS5zdGRvdXQ7XG4gICAgICAgIGNvbnN0IHN0ZGVyciA9IChlcnIgYXMgeyBzdGRlcnI/OiBzdHJpbmcgfSkuc3RkZXJyO1xuICAgICAgICBjb25zdCBzdGRvdXRUZXh0ID0gdHlwZW9mIHN0ZG91dCA9PT0gJ3N0cmluZycgPyBzdGRvdXQgOiAnJztcbiAgICAgICAgY29uc3Qgc3RkZXJyVGV4dCA9IHR5cGVvZiBzdGRlcnIgPT09ICdzdHJpbmcnID8gc3RkZXJyIDogJyc7XG4gICAgICAgIGlmIChzdGRvdXRUZXh0LnRyaW0oKS5sZW5ndGggPT09IDAgJiYgc3RkZXJyVGV4dC50cmltKCkubGVuZ3RoID4gMCkge1xuICAgICAgICAgIHRocm93IG5ldyBHYXRlU2NhbkVycm9yKHN0ZGVyclRleHQudHJpbSgpKTtcbiAgICAgICAgfVxuICAgICAgICBvdXQgPSBzdGRvdXRUZXh0O1xuICAgICAgfVxuICAgICAgcmV0dXJuIHBhcnNlU3RhbGVQb3JjZWxhaW4ob3V0KTtcbiAgICB9LFxuICAgIGxpc3Q6IGFzeW5jIChwYXRocywgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCB8fCBwYXRocy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2xpc3QnLCAnLS1wb3JjZWxhaW4nLCAuLi5wYXRoc10sIHtcbiAgICAgICAgICBjd2Q6IHJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHBhcnNlUG9yY2VsYWluKG91dCk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgfVxuICAgIH0sXG4gICAgbGlzdEJsb2NrczogYXN5bmMgKG5hbWVzLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290IHx8IG5hbWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuICcnO1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2xpc3QnLCAuLi5uYW1lc10sIHtcbiAgICAgICAgICBjd2Q6IHJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBBIGZhaWxlZCBodW1hbi1mb3JtYXQgcmVhZCBvbmx5IGRlZ3JhZGVzIHRoZSByZW5kZXJlZCBtZXNzYWdlXG4gICAgICAgIC8vIChhbm5vdGF0ZUJsb2NrcyBzeW50aGVzaXplcyBtaW5pbWFsIGJsb2Nrcyk7IG5ldmVyIGEgZ2F0ZSBlcnJvci5cbiAgICAgICAgcmV0dXJuICcnO1xuICAgICAgfVxuICAgIH1cbiAgfTtcbn1cblxuLyoqXG4gKiBUaGUgcHJvZHVjdGlvbiBkaXNrLWJhY2tlZCB7QGxpbmsgR2F0ZU1lbW9TdGF0ZX06IG9uZSBtYXJrZXIgZmlsZSBwZXIgZGVidC1zdGF0ZVxuICogZGlnZXN0IHVuZGVyIHtAbGluayBnYXRlTWVtb0Rpcn0gKGA8Z2l0LWNvbW1vbi1kaXI+L2dpdC1zcGFuL2dhdGUvYCksIGZvbGxvd2luZ1xuICogc3Bhbi1zdXJmYWNlLnRzJ3MgZmlsZS1iYWNrZWQgYE1lbW9TdG9yZWAgcGF0dGVybi4gVGhlIGRpZ2VzdCBpcyBhIGhleCBzaGEyNTYsXG4gKiBhIHNhZmUgZmlsZW5hbWUuIEJlc3QtZWZmb3J0IGFuZCBub24tdGhyb3dpbmc6IGEgbWVtbyB3aG9zZSByZXBvIGNhbm5vdCBiZVxuICogcmVzb2x2ZWQgZGVncmFkZXMgdG8gYSBuby1vcCBzdG9yZSAobmV2ZXIgcGVyc2lzdHMgXHUyMTkyIHVuY292ZXJlZCB3b3VsZCByZS1kZW55LFxuICogYnV0IGFuIHVucmVzb2x2YWJsZSByZXBvIHlpZWxkcyBhbiBlbXB0eSBjaGFuZ2VzZXQgdXBzdHJlYW0gYW55d2F5KS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURpc2tHYXRlTWVtb1N0YXRlKGN3ZDogc3RyaW5nKTogR2F0ZU1lbW9TdGF0ZSB7XG4gIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gIGlmICghcmVwb1Jvb3QpIHtcbiAgICAvLyBObyByZXNvbHZhYmxlIHJlcG8gXHUyMTkyIHRoZSBtZW1vIGNhbm5vdCBwZXJzaXN0LiBSZXBvcnQgYGZhbHNlYCBmcm9tXG4gICAgLy8gYHJlY29yZGAgc28gdGhlIGdhdGUgZmFpbHMgb3BlbiByYXRoZXIgdGhhbiBkZW55aW5nIHdpdGggbm8gZXNjYXBlLlxuICAgIHJldHVybiB7IGhhczogKCkgPT4gZmFsc2UsIHJlY29yZDogKCkgPT4gZmFsc2UgfTtcbiAgfVxuICBjb25zdCBkaXIgPSBnYXRlTWVtb0RpcihyZXBvUm9vdCk7XG4gIHJldHVybiB7XG4gICAgaGFzOiAoZGlnZXN0KSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gZnMuZXhpc3RzU3luYyhub2RlUGF0aC5qb2luKGRpciwgZGlnZXN0KSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgIH0sXG4gICAgcmVjb3JkOiAoZGlnZXN0KSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBmcy5ta2RpclN5bmMoZGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgZnMud3JpdGVGaWxlU3luYyhub2RlUGF0aC5qb2luKGRpciwgZGlnZXN0KSwgJycpO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBBIGZhaWxlZCBtZW1vIHdyaXRlIG11c3QgbmV2ZXIgYnJpY2sgdGhlIGNvbW1pdCBhbmQgbXVzdCBuZXZlclxuICAgICAgICAvLyBzaWxlbnRseSByZS1kZW55IGZvcmV2ZXI6IHJlcG9ydCB0aGUgZmFpbHVyZSBzbyB0aGUgZ2F0ZSBmYWlscyBvcGVuLlxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgfVxuICB9O1xufVxuIiwgIi8qKlxuICogU2hhcmVkIGhlbHBlcnMgdXNlZCBieSBtdWx0aXBsZSBhZ2VudC1ob29rcyBlbnRyeSBwb2ludHMuXG4gKlxuICogRXh0cmFjdGVkIGZyb20gcHJlLXRvb2wtdXNlLnRzIHNvIHRoYXQgdGhlIHVwY29taW5nIFN0b3AgaG9vayAoYW5kIGFueVxuICogZnV0dXJlIGhvb2tzKSBjYW4gaW1wb3J0IHBhdGggdXRpbGl0aWVzLCByYW5nZSBoZWxwZXJzLCBhbmQgdGhlXG4gKiBzYW5pdGl6ZVNlc3Npb25JZC9mb3JtYXRBbmNob3IgZnVuY3Rpb25zIHdpdGhvdXQgZGVwZW5kaW5nIG9uIHRoZVxuICogUHJlVG9vbFVzZS1zcGVjaWZpYyBtb2R1bGUuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgb3MgZnJvbSAnbm9kZTpvcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBhdGggaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiB0b1Bvc2l4KHA6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBwLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbn1cblxuZnVuY3Rpb24gaXNBYnNvbHV0ZVBvc2l4KHA6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gcC5zdGFydHNXaXRoKCcvJykgfHwgL15bQS1aYS16XTpcXC8vLnRlc3QocCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhYnNwYXRoQWdhaW5zdChiYXNlOiBzdHJpbmcsIHRhcmdldDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdCA9IHRvUG9zaXgodGFyZ2V0KTtcbiAgaWYgKGlzQWJzb2x1dGVQb3NpeCh0KSkgcmV0dXJuIHQ7XG4gIGNvbnN0IGIgPSB0b1Bvc2l4KGJhc2UpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICByZXR1cm4gYCR7Yn0vJHt0fWA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUmVwb1Jvb3QoZGlyOiBzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICghZGlyKSByZXR1cm4gbnVsbDtcbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCBkaXIsICdyZXYtcGFyc2UnLCAnLS1zaG93LXRvcGxldmVsJ10sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4J1xuICAgIH0pO1xuICAgIGNvbnN0IHRyaW1tZWQgPSBvdXQudHJpbSgpO1xuICAgIHJldHVybiB0cmltbWVkLmxlbmd0aCA+IDAgPyB0b1Bvc2l4KHRyaW1tZWQpIDogbnVsbDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqXG4gKiBSZXBvcnQgd2hldGhlciBhIHJlcG8tcmVsYXRpdmUgcGF0aCBpcyBleGNsdWRlZCBieSBnaXQncyBpZ25vcmUgcnVsZXNcbiAqICguZ2l0aWdub3JlLCAuZ2l0L2luZm8vZXhjbHVkZSwgY29yZS5leGNsdWRlc0ZpbGUpLiBVc2VkIHRvIGtlZXAgaWdub3JlZFxuICogZmlsZXMgXHUyMDE0IGJ1aWxkIG91dHB1dCwgY2FjaGVzLCBsb2dzIFx1MjAxNCBvdXQgb2YgdG91Y2ggdHJhY2tpbmcgZW50aXJlbHksIHNvXG4gKiB0aGUgdG91Y2ggaG9vayBuZXZlciByZXBvcnRzIHJlYWRzLCB3cml0ZXMsIG9yIHVuY292ZXJlZCB3cml0ZXMgb24gdGhlbS5cbiAqXG4gKiBgZ2l0IGNoZWNrLWlnbm9yZSAtcSA8cGF0aD5gIGV4aXRzIDAgd2hlbiB0aGUgcGF0aCBpcyBpZ25vcmVkLCAxIHdoZW4gaXQgaXNcbiAqIG5vdCwgYW5kIDEyOCBvbiBlcnJvci4gZXhlY0ZpbGVTeW5jIHRocm93cyBvbiBhbnkgbm9uLXplcm8gZXhpdCwgc28gYSBjbGVhblxuICogcmV0dXJuIG1lYW5zIFwiaWdub3JlZFwiLiBBIHN0YXR1cy0xIHRocm93IGlzIHRoZSBleHBlY3RlZCBcIm5vdCBpZ25vcmVkXCJcbiAqIHNpZ25hbDsgYW55IG90aGVyIGZhaWx1cmUgaXMgYW4gdW5yZWxpYWJsZSBhbnN3ZXIsIHNvIHdlIHJlcG9ydCBgZmFsc2VgXG4gKiAoZG8gbm90IGRyb3AgdGhlIHRvdWNoKSByYXRoZXIgdGhhbiBzaWxlbnRseSBoaWRpbmcgYSB0cmFja2VkIGZpbGUuXG4gKi9cbi8qKlxuICogVGhlIGRlZmF1bHQgc3BhbiByb290IGRpcmVjdG9yeSwgcmVsYXRpdmUgdG8gdGhlIHJlcG8gcm9vdCwgdXNlZCB3aGVuIG5vXG4gKiBlbnZpcm9ubWVudCB2YXJpYWJsZSBvciBnaXQgY29uZmlnIG92ZXJyaWRlcyB0aGUgbG9jYXRpb24uXG4gKi9cbmV4cG9ydCBjb25zdCBTUEFOX1JPT1QgPSAnLnNwYW4nO1xuXG4vKipcbiAqIFJlc29sdmUgdGhlIHNwYW4gcm9vdCBkaXJlY3RvcnkgZm9yIGEgZ2l2ZW4gcmVwbywgbWlycm9yaW5nIHRoZSBSdXN0IENMSVxuICogcHJlY2VkZW5jZSAobWludXMgdGhlIC0tc3Bhbi1kaXIgQ0xJIGZsYWcsIHdoaWNoIGlzIGludmlzaWJsZSB0byBmaWxlLXdyaXRlXG4gKiBob29rcyk6XG4gKiAgIDEuIEdJVF9TUEFOX0RJUiBlbnZpcm9ubWVudCB2YXJpYWJsZVxuICogICAyLiBgZ2l0IGNvbmZpZyBnaXQtc3Bhbi5kaXJgIGluIHRoZSByZXBvXG4gKiAgIDMuIERlZmF1bHQ6IFwiLnNwYW5cIlxuICpcbiAqIFRoZSByZXR1cm5lZCB2YWx1ZSBpcyBhIFBPU0lYLXN0eWxlIHBhdGggd2l0aCBubyB0cmFpbGluZyBzbGFzaC5cbiAqIEZhaWwtc2FmZTogYW55IHJlc29sdXRpb24gZXJyb3IgZmFsbHMgYmFjayB0byBcIi5zcGFuXCIgc28gdGhlIGhvb2sgbmV2ZXJcbiAqIGNyYXNoZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGVudkRpciA9IHByb2Nlc3MuZW52WydHSVRfU1BBTl9ESVInXTtcbiAgaWYgKGVudkRpciAmJiBlbnZEaXIudHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4gdG9Qb3NpeChlbnZEaXIudHJpbSgpKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgfVxuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnY29uZmlnJywgJ2dpdC1zcGFuLmRpciddLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIGVuY29kaW5nOiAndXRmOCdcbiAgICB9KTtcbiAgICBjb25zdCB0cmltbWVkID0gdG9Qb3NpeChvdXQudHJpbSgpKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgICBpZiAodHJpbW1lZC5sZW5ndGggPiAwKSByZXR1cm4gdHJpbW1lZDtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdm9pZCBlcnI7IC8vIGNvbmZpZyBrZXkgYWJzZW50IG9yIGdpdCBlcnJvciBcdTIwMTQgZmFsbCB0aHJvdWdoIHRvIGRlZmF1bHRcbiAgfVxuICByZXR1cm4gU1BBTl9ST09UO1xufVxuXG4vKipcbiAqIFJlcG9ydCB3aGV0aGVyIGEgcmVwby1yZWxhdGl2ZSBQT1NJWCBwYXRoIGZhbGxzIGluc2lkZSB0aGUgZ2l2ZW4gc3BhbiByb290XG4gKiBkaXJlY3RvcnkuIEEgcGF0aCBpcyBpbnNpZGUgd2hlbiBpdCBlcXVhbHMgdGhlIHNwYW4gcm9vdCBleGFjdGx5IG9yIGlzXG4gKiBuZXN0ZWQgYmVuZWF0aCBpdCAoaS5lLiBzdGFydHMgd2l0aCBcIjxzcGFuUm9vdD4vXCIpLiBUaGUgXCIvXCIgYm91bmRhcnkgcHJldmVudHNcbiAqIGZhbHNlIHBvc2l0aXZlcyBmb3Igc2libGluZ3MgbGlrZSBcIi5zcGFucy94XCIgb3IgXCIuc3Bhbi1ub3Rlcy94XCIuXG4gKlxuICogUGFzcyB0aGUgcmVzdWx0IG9mIGByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3QpYCBhcyBgc3BhblJvb3RgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNJbnNpZGVTcGFuUm9vdChyZXBvUmVsUGF0aDogc3RyaW5nLCBzcGFuUm9vdDogc3RyaW5nID0gU1BBTl9ST09UKTogYm9vbGVhbiB7XG4gIGNvbnN0IHJvb3QgPSBzcGFuUm9vdC5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgcmV0dXJuIHJlcG9SZWxQYXRoID09PSByb290IHx8IHJlcG9SZWxQYXRoLnN0YXJ0c1dpdGgoYCR7cm9vdH0vYCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0dpdElnbm9yZWQocmVwb1Jvb3Q6IHN0cmluZywgcmVwb1JlbFBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnY2hlY2staWdub3JlJywgJy1xJywgJy0tJywgcmVwb1JlbFBhdGhdLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAnaWdub3JlJywgJ2lnbm9yZSddXG4gICAgfSk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHZvaWQgZXJyO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3Q6IHN0cmluZywgYWJzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgcm9vdCA9IHRvUG9zaXgocmVwb1Jvb3QpO1xuICBjb25zdCBhYnMgPSB0b1Bvc2l4KGFic1BhdGgpO1xuICBjb25zdCBwcmVmaXggPSByb290LmVuZHNXaXRoKCcvJykgPyByb290IDogYCR7cm9vdH0vYDtcbiAgcmV0dXJuIGFicy5zdGFydHNXaXRoKHByZWZpeCkgPyBhYnMuc2xpY2UocHJlZml4Lmxlbmd0aCkgOiBhYnM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5vbmljYWxpemVQYXRoKGFic1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHRvUG9zaXgoZnMucmVhbHBhdGhTeW5jLm5hdGl2ZShhYnNQYXRoKSk7XG4gIH0gY2F0Y2gge1xuICAgIC8vIEZpbGUgZG9lc24ndCBleGlzdCB5ZXQgKGUuZy4gV3JpdGUgdG8gYSBuZXcgZmlsZSk6IGNhbm9uaWNhbGl6ZSB0aGVcbiAgICAvLyBkaXJlY3RvcnkgYW5kIHJlam9pbiB0aGUgYmFzZW5hbWUgc28gc3ltbGlua3MgaW4gdGhlIHBhcmVudCBhcmUgcmVzb2x2ZWQuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGRpciA9IHRvUG9zaXgoZnMucmVhbHBhdGhTeW5jLm5hdGl2ZShub2RlUGF0aC5kaXJuYW1lKGFic1BhdGgpKSk7XG4gICAgICByZXR1cm4gYCR7ZGlyfS8ke25vZGVQYXRoLmJhc2VuYW1lKGFic1BhdGgpfWA7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBQYXJlbnQgZG9lc24ndCBleGlzdCBlaXRoZXI7IGZhbGwgYmFjayB0byB0aGUgdW4tY2Fub25pY2FsaXplZCBwYXRoLlxuICAgICAgcmV0dXJuIGFic1BhdGg7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkZXJpdmVQYXRoKHRvb2xJbnB1dDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGN3ZDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IGZwID0gdG9vbElucHV0LmZpbGVfcGF0aDtcbiAgaWYgKHR5cGVvZiBmcCAhPT0gJ3N0cmluZycgfHwgZnAubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgYWJzID0gYWJzcGF0aEFnYWluc3QoY3dkLCBmcCk7XG4gIHJldHVybiBjYW5vbmljYWxpemVQYXRoKGFicyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTGluZSByYW5nZSB0eXBlcyBhbmQgaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgTGluZVJhbmdlIHtcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByYW5nZXNJbnRlcnNlY3QoYTogTGluZVJhbmdlLCBiOiBMaW5lUmFuZ2UpOiBib29sZWFuIHtcbiAgcmV0dXJuIGEuc3RhcnQgPD0gYi5lbmQgJiYgYS5lbmQgPj0gYi5zdGFydDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQb3JjZWxhaW4gcm93IHBhcnNpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIFBvcmNlbGFpblJvdyB7XG4gIG5hbWU6IHN0cmluZztcbiAgcGF0aDogc3RyaW5nO1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlUG9yY2VsYWluKHN0ZG91dDogc3RyaW5nKTogUG9yY2VsYWluUm93W10ge1xuICBjb25zdCByb3dzOiBQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygc3Rkb3V0LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHBhcnRzID0gdHJpbW1lZC5zcGxpdCgnXFx0Jyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDMpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFtuYW1lLCBwYXRoLCByYW5nZV0gPSBwYXJ0cztcbiAgICBjb25zdCBkYXNoSWR4ID0gcmFuZ2UuaW5kZXhPZignLScpO1xuICAgIGlmIChkYXNoSWR4ID09PSAtMSkgY29udGludWU7XG4gICAgY29uc3Qgc3RhcnQgPSBwYXJzZUludChyYW5nZS5zbGljZSgwLCBkYXNoSWR4KSwgMTApO1xuICAgIGNvbnN0IGVuZCA9IHBhcnNlSW50KHJhbmdlLnNsaWNlKGRhc2hJZHggKyAxKSwgMTApO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpIHx8IE51bWJlci5pc05hTihlbmQpKSBjb250aW51ZTtcbiAgICByb3dzLnB1c2goeyBuYW1lLCBwYXRoLCBzdGFydCwgZW5kIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG4vKipcbiAqIFRoZSBmdWxsIGBnaXQgc3BhbiBzdGFsZSAtLWZvcm1hdCBwb3JjZWxhaW5gIHN0YXR1cyB0b2tlbiB2b2NhYnVsYXJ5ICh0aGVcbiAqIGdpdC1zcGFuIENMSSdzIHBvcmNlbGFpbiBjb250cmFjdCk6IGBGUkVTSGAvYE1PVkVEYC9gUkVTT0xWRURfUEVORElOR19DT01NSVRgXG4gKiBhcmUgcG9zaXRpb25hbC1vci1jbGVhbiBhbmQgbmV2ZXIgZGVidDsgZXZlcnkgb3RoZXIgdG9rZW4gaXMgc2VtYW50aWMgZHJpZnRcbiAqIG9yIGEgdGVybWluYWwvZXJyb3IgY29uZGl0aW9uIGFuZCBpcyBkZWJ0LiBTZWUge0BsaW5rIGlzRGVidH0gZm9yIHRoZVxuICogc2luZ2xlIHNvdXJjZSBvZiB0cnV0aCBvbiB0aGF0IHNwbGl0LlxuICovXG5leHBvcnQgY29uc3QgUE9SQ0VMQUlOX1NUQVRVU0VTID0gW1xuICAnRlJFU0gnLFxuICAnUkVTT0xWRURfUEVORElOR19DT01NSVQnLFxuICAnTU9WRUQnLFxuICAnQ0hBTkdFRCcsXG4gICdERUxFVEVEJyxcbiAgJ0NPTkZMSUNUJyxcbiAgJ1NVQk1PRFVMRScsXG4gICdMRlNfTk9UX0ZFVENIRUQnLFxuICAnTEZTX05PVF9JTlNUQUxMRUQnLFxuICAnUFJPTUlTT1JfTUlTU0lORycsXG4gICdTUEFSU0VfRVhDTFVERUQnLFxuICAnRklMVEVSX0ZBSUxFRCcsXG4gICdJT19FUlJPUidcbl0gYXMgY29uc3Q7XG5cbmV4cG9ydCB0eXBlIFBvcmNlbGFpblN0YXR1cyA9ICh0eXBlb2YgUE9SQ0VMQUlOX1NUQVRVU0VTKVtudW1iZXJdO1xuXG5jb25zdCBQT1JDRUxBSU5fU1RBVFVTX1NFVDogUmVhZG9ubHlTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoUE9SQ0VMQUlOX1NUQVRVU0VTKTtcblxuZnVuY3Rpb24gcGFyc2VQb3JjZWxhaW5TdGF0dXMocmF3OiBzdHJpbmcpOiBQb3JjZWxhaW5TdGF0dXMgfCBudWxsIHtcbiAgcmV0dXJuIFBPUkNFTEFJTl9TVEFUVVNfU0VULmhhcyhyYXcpID8gKHJhdyBhcyBQb3JjZWxhaW5TdGF0dXMpIDogbnVsbDtcbn1cblxuLyoqIEEgYHBhcnNlU3RhbGVQb3JjZWxhaW5gIHJvdzogYSB7QGxpbmsgUG9yY2VsYWluUm93fSBwbHVzIGl0cyBzdGF0dXMgdG9rZW4uICovXG5leHBvcnQgaW50ZXJmYWNlIFN0YWxlUG9yY2VsYWluUm93IGV4dGVuZHMgUG9yY2VsYWluUm93IHtcbiAgc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXM7XG59XG5cbi8qKlxuICogVGhlIGRlYnQgaW52YXJpYW50IChzeXN0ZW0td2lkZTsgY29uc3VtZWQgYnkgYm90aCB0aGUgZnV0dXJlIHRvdWNoLWNvcmUgYW5kXG4gKiBnYXRlLWNvcmUpOiBvbmx5IHNlbWFudGljIHN0YXR1c2VzIGFyZSBkZWJ0LiBgQ0hBTkdFRGAgYW5kIGBERUxFVEVEYCBhcmVcbiAqIHNlbWFudGljIGRyaWZ0OyB0aGUgcmVtYWluaW5nIG5vbi1GUkVTSC9NT1ZFRC9SRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCB0b2tlbnNcbiAqIGFyZSB0ZXJtaW5hbC9lcnJvciBjb25kaXRpb25zIGFuZCBhcmUgdHJlYXRlZCBhcyBkZWJ0IHRvbyAodGhleSBibG9jayBvblxuICogdGhlaXIgb3duIG1lcml0cyBcdTIwMTQgdGhlIENMSSBjb3VsZCBub3QgcmVzb2x2ZSB0aGUgYW5jaG9yIGF0IGFsbCkuIGBGUkVTSGAsXG4gKiBgTU9WRURgLCBhbmQgYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCBhcmUgbmV2ZXIgZGVidDogcG9zaXRpb25hbCBkcmlmdCB0aGVcbiAqIENMSSBjYW4gaGVhbCAob3IgYWxyZWFkeSBoYXMpIGlzIGludmlzaWJsZSwgYW5kIGEgcGVuZGluZy1jb21taXQgcmVzb2x1dGlvblxuICogaXMgbm90IG91dHN0YW5kaW5nIGRlYnQuXG4gKlxuICogTm90ZTogdGhlIHBvcmNlbGFpbiB2b2NhYnVsYXJ5IGRvZXMgbm90IGN1cnJlbnRseSBkaXN0aW5ndWlzaFxuICogY29udGVudC1lcXVpdmFsZW50IGBDSEFOR0VEYCAoZS5nLiB3aGl0ZXNwYWNlLW9ubHkgZHJpZnQgYC0tZml4YCBjYW4gaGVhbClcbiAqIGZyb20gZ2VudWluZWx5IHNlbWFudGljIGBDSEFOR0VEYCBcdTIwMTQgdGhhdCBjbGFzc2lmaWNhdGlvbiBpcyBub3QgcHJlc2VudCBpblxuICogYGdpdCBzcGFuIHN0YWxlIC0tZm9ybWF0IHBvcmNlbGFpbmAgb3V0cHV0IHRvZGF5LiBVbnRpbCB0aGUgQ0xJIGV4cG9zZXMgaXQsXG4gKiBldmVyeSBgQ0hBTkdFRGAgcm93IGlzIHRyZWF0ZWQgYXMgZGVidC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRGVidChzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IGJvb2xlYW4ge1xuICBzd2l0Y2ggKHN0YXR1cykge1xuICAgIGNhc2UgJ0ZSRVNIJzpcbiAgICBjYXNlICdNT1ZFRCc6XG4gICAgY2FzZSAnUkVTT0xWRURfUEVORElOR19DT01NSVQnOlxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgfVxufVxuXG4vKipcbiAqIExvd2VyY2FzZSBodW1hbiBsYWJlbCBmb3IgYSBwb3JjZWxhaW4gc3RhdHVzIHRva2VuIChgTEZTX05PVF9GRVRDSEVEYCBcdTIxOTJcbiAqIGBsZnMgbm90IGZldGNoZWRgKS4gVGhlIHNpbmdsZSBsYWJlbCBtYXBwaW5nIGZvciBldmVyeSBodW1hbi1mb3JtYXQgYW5jaG9yXG4gKiBzdWZmaXggXHUyMDE0IGJvdGggdGhlIHRvdWNoIGhvb2sncyBibG9jayBhbmQgdGhlIGdhdGUncyBtZXNzYWdlcyByZW5kZXIgdGhyb3VnaFxuICogdGhpcywgc28gYSBzdGF0dXMgbmV2ZXIgcmVhZHMgZGlmZmVyZW50bHkgYmV0d2VlbiB0aGUgdHdvLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaHVtYW5TdGF0dXNMYWJlbChzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IHN0cmluZyB7XG4gIHJldHVybiBzdGF0dXMudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9fL2csICcgJyk7XG59XG5cbi8qKlxuICogVGhlIHRlcm1pbmFsL2Vudmlyb25tZW50YWwgc3RhdHVzZXM6IHRoZSBDTEkgY291bGQgbm90IHJlc29sdmUgdGhlIGFuY2hvciBhdFxuICogYWxsLCBzbyB0aGUgcm93IGlzIG5vdCBzcGFuIGRyaWZ0IGEgdXNlciBjYW4gZml4IGJ5IGVkaXRpbmcgYSBzcGFuLiBUaGVzZSBhcmVcbiAqIGBDT05GTElDVGAgKHVucmVzb2x2ZWQgbWVyZ2UpLCBgU1VCTU9EVUxFYCAoYW5jaG9yIGluc2lkZSBhIHN1Ym1vZHVsZSksXG4gKiBgTEZTX05PVF9GRVRDSEVEYC9gTEZTX05PVF9JTlNUQUxMRURgIChHaXQgTEZTIGNvbnRlbnQgdW5hdmFpbGFibGUpLFxuICogYFBST01JU09SX01JU1NJTkdgIChwYXJ0aWFsLWNsb25lIG9iamVjdCBub3QgZmV0Y2hlZCksIGBTUEFSU0VfRVhDTFVERURgXG4gKiAocGF0aCBvdXRzaWRlIHRoZSBzcGFyc2UtY2hlY2tvdXQgY29uZSksIGBGSUxURVJfRkFJTEVEYCAoYSBjbGVhbi9zbXVkZ2VcbiAqIGZpbHRlciBlcnJvcmVkKSwgYW5kIGBJT19FUlJPUmAgKHRyYW5zaWVudCByZWFkIGZhaWx1cmUpLlxuICpcbiAqIFRoZXNlIGFyZSBhIHN0cmljdCBzdWJzZXQgb2Yge0BsaW5rIGlzRGVidH06IGV2ZXJ5IGVudmlyb25tZW50YWwgc3RhdHVzIGlzXG4gKiBhbHNvIGRlYnQgKGl0IGJsb2NrcyBvbiBpdHMgb3duIG1lcml0cyB3aGVuIHN1cmZhY2VkIGluIGEgc3RhdHVzIHJlcG9ydCksIGJ1dFxuICogdGhlIGdhdGUgbXVzdCB0cmVhdCB0aGVtIGRpZmZlcmVudGx5IGZyb20gKnNlbWFudGljKiBkcmlmdCAoYENIQU5HRURgLFxuICogYERFTEVURURgKS4gU2VtYW50aWMgZHJpZnQgaXMgZml4YWJsZSBieSBlZGl0aW5nIGEgc3Bhbiwgc28gdGhlIGdhdGUgZmFpbHNcbiAqIGNsb3NlZCBvbiBpdDsgYW4gZW52aXJvbm1lbnRhbCBjb25kaXRpb24gaXMgbm90IHNvbWV0aGluZyBhIHNwYW4gZWRpdCBjYW5cbiAqIHJlc29sdmUsIHNvIHRoZSBnYXRlIGZhaWxzIE9QRU4gb24gaXQgKGFsbG93LCBidXQgc3VyZmFjZSB0aGUgY29uZGl0aW9uKSBcdTIwMTRcbiAqIHJlLWRlbnlpbmcgZm9yZXZlciBvbiBhbiBpbmZyYSBmYWlsdXJlIHRoZSB1c2VyIGNhbm5vdCBjbGVhciBmcm9tIGhlcmUgd291bGRcbiAqIGNvbnRyYWRpY3QgdGhlIGZhaWwtb3BlbiBjb250cmFjdCB0aGUgcmVzdCBvZiB0aGUgZ2F0ZSBhbHJlYWR5IGhvbm9ycyBmb3JcbiAqIENMSS1hYnNlbnQvdGltZW91dC9wYXJzZS1mYWlsdXJlIGNvbmRpdGlvbnMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0Vudmlyb25tZW50YWxTdGF0dXMoc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBib29sZWFuIHtcbiAgc3dpdGNoIChzdGF0dXMpIHtcbiAgICBjYXNlICdDT05GTElDVCc6XG4gICAgY2FzZSAnU1VCTU9EVUxFJzpcbiAgICBjYXNlICdMRlNfTk9UX0ZFVENIRUQnOlxuICAgIGNhc2UgJ0xGU19OT1RfSU5TVEFMTEVEJzpcbiAgICBjYXNlICdQUk9NSVNPUl9NSVNTSU5HJzpcbiAgICBjYXNlICdTUEFSU0VfRVhDTFVERUQnOlxuICAgIGNhc2UgJ0ZJTFRFUl9GQUlMRUQnOlxuICAgIGNhc2UgJ0lPX0VSUk9SJzpcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBgZ2l0IHNwYW4gc3RhbGUgLS1mb3JtYXQgcG9yY2VsYWluYCBlbWl0cyBhIGRpZmZlcmVudCBzaGFwZSB0aGFuXG4gKiBgbGlzdCAtLXBvcmNlbGFpbmA6IGEgYCMgcG9yY2VsYWluIHYyYCBoZWFkZXIsIGAjIGZ1enp5IE5gIGNvbW1lbnQgbGluZXMsXG4gKiBhbmQgb25lIGA8c3RhdHVzPlxcdDxzcmM+XFx0PG5hbWU+XFx0PHBhdGg+XFx0PHN0YXJ0PlxcdDxlbmQ+YCByb3cgcGVyIGRyaWZ0ZWRcbiAqIGFuY2hvciAod2hvbGUtZmlsZSBhbmNob3JzIGNhcnJ5IGAod2hvbGUpYC9gLWAgaW4gcGxhY2Ugb2YgdGhlIGxpbmUgY29sdW1ucykuXG4gKiBSb3dzIHdob3NlIHN0YXR1cyB0b2tlbiBpcyBub3QgaW4ge0BsaW5rIFBPUkNFTEFJTl9TVEFUVVNFU30gYXJlIHNraXBwZWQgXHUyMDE0XG4gKiBhbiB1bnJlY29nbml6ZWQgdG9rZW4gZnJvbSBhIG5ld2VyIENMSSBpcyB0cmVhdGVkIHRoZSBzYW1lIGFzIGEgbWFsZm9ybWVkXG4gKiBsaW5lIHJhdGhlciB0aGFuIGd1ZXNzZWQgYXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVN0YWxlUG9yY2VsYWluKHN0ZG91dDogc3RyaW5nKTogU3RhbGVQb3JjZWxhaW5Sb3dbXSB7XG4gIGNvbnN0IHJvd3M6IFN0YWxlUG9yY2VsYWluUm93W10gPSBbXTtcbiAgZm9yIChjb25zdCBsaW5lIG9mIHN0ZG91dC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkIHx8IHRyaW1tZWQuc3RhcnRzV2l0aCgnIycpKSBjb250aW51ZTtcbiAgICBjb25zdCBwYXJ0cyA9IHRyaW1tZWQuc3BsaXQoJ1xcdCcpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPCA2KSBjb250aW51ZTtcbiAgICBjb25zdCBbc3RhdHVzQ29sLCAsIG5hbWUsIHBhdGgsIHN0YXJ0Q29sLCBlbmRDb2xdID0gcGFydHM7XG4gICAgY29uc3Qgc3RhdHVzID0gcGFyc2VQb3JjZWxhaW5TdGF0dXMoc3RhdHVzQ29sKTtcbiAgICBpZiAoIXN0YXR1cykgY29udGludWU7XG4gICAgY29uc3Qgc3RhcnQgPSBzdGFydENvbCA9PT0gJyh3aG9sZSknID8gMCA6IHBhcnNlSW50KHN0YXJ0Q29sLCAxMCk7XG4gICAgY29uc3QgZW5kID0gZW5kQ29sID09PSAnLScgPyAwIDogcGFyc2VJbnQoZW5kQ29sLCAxMCk7XG4gICAgaWYgKE51bWJlci5pc05hTihzdGFydCkgfHwgTnVtYmVyLmlzTmFOKGVuZCkpIGNvbnRpbnVlO1xuICAgIHJvd3MucHVzaCh7IG5hbWUsIHBhdGgsIHN0YXJ0LCBlbmQsIHN0YXR1cyB9KTtcbiAgfVxuICByZXR1cm4gcm93cztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTZXNzaW9uIElEIHNhbml0aXphdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogSW5qZWN0aXZlIHRyYW5zZm9ybTogcGVyY2VudC1lbmNvZGUgYnl0ZXMgb3V0c2lkZSBbQS1aYS16MC05Ll8tXSBhcyAlSEhcbiAqICh1cHBlcmNhc2UgaGV4KS4gVXNlZCB0byBwcm9kdWNlIHNhZmUgZmlsZW5hbWVzIGZyb20gYXJiaXRyYXJ5IHNlc3Npb24gaWRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemVTZXNzaW9uSWQoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gc2Vzc2lvbklkLnJlcGxhY2UoL1teQS1aYS16MC05Ll8tXS9nLCAoY2gpID0+IHtcbiAgICByZXR1cm4gYCUke2NoLmNoYXJDb2RlQXQoMCkudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCkucGFkU3RhcnQoMiwgJzAnKX1gO1xuICB9KTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQZXItc2Vzc2lvbiBiYXNlIGRpcmVjdG9yeVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIEJhc2UgZGlyIHNoYXJlZCBieSBhbGwgcGVyLXNlc3Npb24gc3RhdGU6IGN1cnJlbnRseSBqdXN0IHRoZSB0b3VjaC1ob29rXG4vLyBzZXNzaW9uIG1lbW8gKHNwYW4tc3VyZmFjZS50cydzIE1lbW9TdG9yZSkuIEVhY2ggc2Vzc2lvbiBnZXRzIG9uZVxuLy8gc3ViZGlyZWN0b3J5IGtleWVkIGJ5IGl0cyBzYW5pdGl6ZWQgaWQsIHNvIGV2ZXJ5IHdyaXRlci9yZWFkZXIgZm9yIGEgZ2l2ZW5cbi8vIHNlc3Npb24gYWdyZWVzIG9uIGl0cyBsb2NhdGlvbi5cbmV4cG9ydCBjb25zdCBTRVNTSU9OX0JBU0VfRElSID0gbm9kZVBhdGguam9pbihvcy5ob21lZGlyKCksICcuY2FjaGUnLCAnZ2l0LXNwYW4nLCAnc2Vzc2lvbicpO1xuXG4vKiogVGhlIHBlci1zZXNzaW9uIHN0YXRlIGRpcmVjdG9yeSBmb3IgYSBnaXZlbiBzZXNzaW9uIGlkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25EaXIoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihTRVNTSU9OX0JBU0VfRElSLCBzYW5pdGl6ZVNlc3Npb25JZChzZXNzaW9uSWQpKTtcbn1cblxuY29uc3QgVEhJUlRZX0RBWVNfTVMgPSAzMCAqIDI0ICogNjAgKiA2MCAqIDEwMDA7XG5cbi8qKlxuICogT3Bwb3J0dW5pc3RpY2FsbHkgcHJ1bmUgcGVyLXNlc3Npb24gc3RhdGUgZGlyZWN0b3JpZXMgdW5kZXJcbiAqIHtAbGluayBTRVNTSU9OX0JBU0VfRElSfSB3aG9zZSBtdGltZSBpcyBvbGRlciB0aGFuIGBtYXhBZ2VNc2AgKGRlZmF1bHQgMzBcbiAqIGRheXMpLiBBIGRpcmVjdG9yeSdzIG10aW1lIGFkdmFuY2VzIHdoZW5ldmVyIGFuIGVudHJ5IGluc2lkZSBpdCBpc1xuICogY3JlYXRlZC9yZW5hbWVkL3JlbW92ZWQsIHNvIGFuIGFjdGl2ZSBzZXNzaW9uIChtZW1vIHdyaXRlcykgc3RheXMgZnJlc2g7XG4gKiBvbmx5IGdlbnVpbmVseSBhYmFuZG9uZWQgc2Vzc2lvbnMgYWdlIG91dC5cbiAqXG4gKiBCZXN0LWVmZm9ydCBhbmQgbm9uLXRocm93aW5nOiBjYWxsZWQgb3Bwb3J0dW5pc3RpY2FsbHkgZnJvbSBob29rIHJlYWQvd3JpdGVcbiAqIHBhdGhzLCBub3QgYSBzZXBhcmF0ZSBjcm9uLWxpa2UgbWVjaGFuaXNtLCBzbyBhIGZhaWx1cmUgaGVyZSBtdXN0IG5ldmVyXG4gKiBibG9jayB0aGUgY2FsbGVyJ3MgYWN0dWFsIHdvcmsuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwcnVuZVN0YWxlU2Vzc2lvbnMobm93OiBudW1iZXIgPSBEYXRlLm5vdygpLCBtYXhBZ2VNczogbnVtYmVyID0gVEhJUlRZX0RBWVNfTVMpOiB2b2lkIHtcbiAgbGV0IGVudHJpZXM6IGZzLkRpcmVudFtdO1xuICB0cnkge1xuICAgIGVudHJpZXMgPSBmcy5yZWFkZGlyU3luYyhTRVNTSU9OX0JBU0VfRElSLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybjsgLy8gYmFzZSBkaXIgYWJzZW50IG9yIHVucmVhZGFibGUgXHUyMDE0IG5vdGhpbmcgdG8gcHJ1bmVcbiAgfVxuICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXMpIHtcbiAgICBpZiAoIWVudHJ5LmlzRGlyZWN0b3J5KCkpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGRpclBhdGggPSBub2RlUGF0aC5qb2luKFNFU1NJT05fQkFTRV9ESVIsIGVudHJ5Lm5hbWUpO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBzdGF0ID0gZnMuc3RhdFN5bmMoZGlyUGF0aCk7XG4gICAgICBpZiAobm93IC0gc3RhdC5tdGltZU1zID4gbWF4QWdlTXMpIHtcbiAgICAgICAgZnMucm1TeW5jKGRpclBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFZhbmlzaGVkIGJldHdlZW4gcmVhZGRpciBhbmQgc3RhdCwgb3IgcmVtb3ZhbCBmYWlsZWQgXHUyMDE0IHNraXAgaXQuIEFcbiAgICAgIC8vIGJlc3QtZWZmb3J0IHBydW5lIG11c3QgbmV2ZXIgdGhyb3cgaW50byB0aGUgY2FsbGVyJ3MgaG90IHBhdGguXG4gICAgfVxuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2gga2luZCBhbmQgYW5jaG9yIGZvcm1hdHRpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgdHlwZSBUb3VjaEtpbmQgPSAncmVhZCcgfCAnd3JpdGUnIHwgJ3dob2xlLXJlYWQnIHwgJ3dob2xlLXdyaXRlJyB8ICdjcmVhdGUnO1xuXG4vKipcbiAqIEZvcm1hdCBhIHNwYW4gYW5jaG9yIHN0cmluZy5cbiAqXG4gKiAtIGB3aG9sZS1yZWFkYCwgYHdob2xlLXdyaXRlYCwgYW5kIGBjcmVhdGVgOiByZXR1cm5zIGp1c3QgdGhlIHBhdGhcbiAqIC0gYHJlYWRgIGFuZCBgd3JpdGVgOiByZXR1cm5zIGBwYXRoI0w8c3RhcnQ+LUw8ZW5kPmAgKHJlcXVpcmVzIHJhbmdlKVxuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0QW5jaG9yKHBhdGg6IHN0cmluZywga2luZDogVG91Y2hLaW5kLCByYW5nZT86IExpbmVSYW5nZSk6IHN0cmluZyB7XG4gIGlmICgoa2luZCA9PT0gJ3JlYWQnIHx8IGtpbmQgPT09ICd3cml0ZScpICYmIHJhbmdlKSB7XG4gICAgcmV0dXJuIGAke3BhdGh9I0wke3JhbmdlLnN0YXJ0fS1MJHtyYW5nZS5lbmR9YDtcbiAgfVxuICByZXR1cm4gcGF0aDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBBbmNob3Igc3BlYyB0eXBlXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBBbmNob3JTcGVjIHtcbiAgcGF0aDogc3RyaW5nO1xuICBraW5kOiBUb3VjaEtpbmQ7XG4gIHJhbmdlPzogTGluZVJhbmdlO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFF1ZXVlIGRpcmVjdG9yeSBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBnaXQgY29tbW9uIGRpcmVjdG9yeSBmb3IgdGhlIGdpdmVuIHJlcG8gcm9vdC5cbiAqIFRoaXMgaXMgdGhlIHNoYXJlZCBkaXJlY3RvcnkgKG5vdCB0aGUgd29ya3RyZWUtc3BlY2lmaWMgLmdpdCksIHNvIHF1ZXVlXG4gKiByZWNvcmRzIHN1cnZpdmUgd29ya3RyZWUgZGVsZXRpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlR2l0Q29tbW9uRGlyKHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ3Jldi1wYXJzZScsICctLWdpdC1jb21tb24tZGlyJ10sIHtcbiAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICBlbmNvZGluZzogJ3V0ZjgnXG4gIH0pO1xuICBjb25zdCB0cmltbWVkID0gdG9Qb3NpeChvdXQudHJpbSgpKTtcbiAgLy8gZ2l0IHJldHVybnMgYSByZWxhdGl2ZSBwYXRoIChlLmcuIFwiLmdpdFwiKSBmb3Igc2ltcGxlIHJlcG9zLiBSZXNvbHZlIGl0XG4gIC8vIGFnYWluc3QgcmVwb1Jvb3Qgc28gY2FsbGVycyBuZXZlciBkZXBlbmQgb24gcHJvY2Vzcy5jd2QoKS5cbiAgaWYgKCFub2RlUGF0aC5pc0Fic29sdXRlKHRyaW1tZWQpKSB7XG4gICAgcmV0dXJuIHRvUG9zaXgobm9kZVBhdGgucmVzb2x2ZShyZXBvUm9vdCwgdHJpbW1lZCkpO1xuICB9XG4gIHJldHVybiB0cmltbWVkO1xufVxuXG4vKipcbiAqIFJvb3Qgb2YgdGhlIGdpdC1zcGFuIHF1ZXVlIGRpcmVjdG9yeSB0cmVlLCB1bmRlciB0aGUgZ2l0IGNvbW1vbiBkaXIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBxdWV1ZVJvb3QocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKHJlc29sdmVHaXRDb21tb25EaXIocmVwb1Jvb3QpLCAnZ2l0LXNwYW4nKTtcbn1cblxuLyoqXG4gKiBEaXJlY3RvcnkgZm9yIHRoZSBnYXRlJ3MgcGVyLWNoYW5nZXNldCBzdGF0ZSBtZW1vcyAoZGlnZXN0IG9mIHNvcnRlZFxuICogZmluZGluZ3MgKyB1bmNvdmVyZWQgcGF0aHMpLCB1bmRlciB0aGUgZ2l0IGNvbW1vbiBkaXIgc28gaXQgaXMgc2hhcmVkXG4gKiBhY3Jvc3Mgd29ya3RyZWVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2F0ZU1lbW9EaXIocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKHF1ZXVlUm9vdChyZXBvUm9vdCksICdnYXRlJyk7XG59XG4iLCAiLyoqXG4gKiBQYXRoIGV4Y2x1c2lvbiBsaXN0IGZvciB0aGUgZ2F0ZSdzIHVuY292ZXJlZC13cml0ZXMgY2hlY2suXG4gKlxuICogYGV2YWx1YXRlR2F0ZWAgaW4ge0BsaW5rIGZpbGU6Ly8uL2dhdGUtY29yZS50c30gYWxyZWFkeSBleGNsdWRlcyBgLnNwYW4vKipgXG4gKiBwYXRocyBmcm9tIGl0cyB1bmNvdmVyZWQtd3JpdGVzIGNvbXB1dGF0aW9uIHVuY29uZGl0aW9uYWxseSAoc3BhbiByZXBhaXJzXG4gKiByaWRlIHRoZSBzYW1lIGNvbW1pdCBhbmQgbXVzdCBuZXZlciBzZWxmLXRyaWdnZXIgdGhlIGdhdGUpLiBUaGlzIG1vZHVsZVxuICogYWRkcyBhIHNlY29uZCwgdXNlci1kZWNsYXJlZCBleGNsdXNpb24gc291cmNlIG9uIHRvcCBvZiB0aGF0OiBhIHJlcG8gb3duZXJcbiAqIGNhbiBsaXN0IGFkZGl0aW9uYWwgcGF0aHMgdGhlIHVuY292ZXJlZC13cml0ZXMgY2hlY2sgc2hvdWxkIG5ldmVyIGZsYWcgXHUyMDE0XG4gKiBnZW5lcmF0ZWQgb3V0cHV0LCB2ZW5kb3JlZCBjb2RlLCBhbnl0aGluZyB0aGF0IHdpbGwgbmV2ZXIgZ2V0IGEgc3Bhbi5cbiAqXG4gKiBDb25maWcgbGl2ZXMgYXQgYDxyZXBvUm9vdD4vLnNwYW4vLmdhdGVpZ25vcmVgLiBVbmxpa2VcbiAqIHtAbGluayBmaWxlOi8vLi9zcGFuLWlnbm9yZS50c30ncyBgLnNwYW4vLmhvb2tpZ25vcmVgIFx1MjAxNCB3aGljaCB0aGUgYGdpdC1zcGFuYFxuICogUnVzdCBDTEkgYXV0by1jcmVhdGVzIHdpdGggY2Fub25pY2FsIGNvbnRlbnQgXHUyMDE0IGAuZ2F0ZWlnbm9yZWAgaXNcbiAqICoqdXNlci1vd25lZCoqOiBub3RoaW5nIGNyZWF0ZXMgb3IgcG9wdWxhdGVzIGl0LCBzbyBpdHMgYWJzZW5jZSBpcyB0aGVcbiAqIG5vcm1hbCwgdW5jb25maWd1cmVkIHN0YXRlLCBub3QgYSBicm9rZW4gb25lLlxuICpcbiAqIEVhY2ggbm9uLWNvbW1lbnQgbGluZSBpcyBhIHNpbmdsZSBnaXRpZ25vcmUtc3R5bGUgcGF0aCBwYXR0ZXJuIChubyB0cmFpbGluZ1xuICogcHJlZml4IGxpc3QgXHUyMDE0IGEgYC5nYXRlaWdub3JlYCBsaW5lIGVpdGhlciBleGNsdWRlcyBhIHBhdGggZnJvbSB0aGVcbiAqIHVuY292ZXJlZC13cml0ZXMgY2hlY2sgb3IgaXQgZG9lc24ndCwgdW5saWtlIGAuaG9va2lnbm9yZWAncyBwZXItc3Bhbi1zbHVnXG4gKiBzdXBwcmVzc2lvbik6XG4gKlxuICogICBwYWNrYWdlcy9hZ2VudC1ob29rcy9nZW5lcmF0ZWQvKipcbiAqXG4gKiBQYXR0ZXJuIGdyYW1tYXIgaXMgaWRlbnRpY2FsIHRvIGAuaG9va2lnbm9yZWAncyAoc2VlIHRoYXQgbW9kdWxlJ3MgZG9jXG4gKiBjb21tZW50IGZvciB0aGUgZnVsbCBncmFtbWFyKSBhbmQgcmV1c2VzIGl0cyBjb21waWxlZCBtYXRjaGVyIHZpYVxuICoge0BsaW5rIGNvbXBpbGVQYXR0ZXJufSByYXRoZXIgdGhhbiByZWltcGxlbWVudGluZyBwYXRoIG1hdGNoaW5nOlxuICpcbiAqIC0gQmxhbmsgbGluZXMgYW5kIGxpbmVzIGJlZ2lubmluZyB3aXRoIGAjYCBhcmUgc2tpcHBlZC5cbiAqIC0gQSB0cmFpbGluZyBgL2AgcmVzdHJpY3RzIHRoZSBwYXR0ZXJuIHRvIGRpcmVjdG9yaWVzLlxuICogLSBBIHBhdHRlcm4gY29udGFpbmluZyBhIHNsYXNoIGlzIGFuY2hvcmVkIHRvIHRoZSByZXBvIHJvb3Q7IGEgcGF0dGVybiB3aXRoXG4gKiAgIG5vIHNsYXNoIG1hdGNoZXMgYSBzaW5nbGUgcGF0aCBjb21wb25lbnQgYXQgYW55IGRlcHRoLlxuICogLSBgKmAgYW5kIGA/YCBtYXRjaCB3aXRoaW4gb25lIHBhdGggc2VnbWVudDsgYCoqYCBtYXRjaGVzIGFjcm9zcyBzZWdtZW50cy5cbiAqIC0gTmVnYXRpb24gKGAhYCkgaXMgbm90IHN1cHBvcnRlZC5cbiAqXG4gKiBGYWlsLW9wZW46IGEgbWlzc2luZyBvciB1bnJlYWRhYmxlIGAuZ2F0ZWlnbm9yZWAsIG9yIGEgbWFsZm9ybWVkIGxpbmUsXG4gKiB5aWVsZHMgbm8gYWRkaXRpb25hbCBleGNsdXNpb24gXHUyMDE0IHRoZSB1bmNvdmVyZWQtd3JpdGVzIGNoZWNrIHNpbXBseSBmYWxsc1xuICogYmFjayB0byB0aGUgYC5zcGFuLyoqYC1vbmx5IGV4Y2x1c2lvbiBpdCBhbHJlYWR5IGFwcGxpZXMuXG4gKi9cblxuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgY29tcGlsZVBhdHRlcm4gfSBmcm9tICcuL3NwYW4taWdub3JlLmpzJztcblxuZXhwb3J0IGludGVyZmFjZSBHYXRlSWdub3JlUnVsZSB7XG4gIC8qKiBUaGUgcmF3IGdpdGlnbm9yZS1zdHlsZSBwYXR0ZXJuLCByZXRhaW5lZCBmb3IgZGlhZ25vc3RpY3MuICovXG4gIHBhdHRlcm46IHN0cmluZztcbiAgLyoqIFRydWUgd2hlbiBgcmVwb1JlbFBhdGhgIChQT1NJWCwgcmVwby1yZWxhdGl2ZSkgaXMgZXhjbHVkZWQgYnkgdGhpcyBydWxlLiAqL1xuICBtYXRjaGVzOiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4gYm9vbGVhbjtcbn1cblxuY29uc3QgR0FURV9JR05PUkVfUkVMID0gbm9kZVBhdGguam9pbignLnNwYW4nLCAnLmdhdGVpZ25vcmUnKTtcblxuLyoqIFBhcnNlIGAuZ2F0ZWlnbm9yZWAgdGV4dCBpbnRvIHJ1bGVzLCBza2lwcGluZyBjb21tZW50cyBhbmQgYmxhbmsgbGluZXMuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VHYXRlSWdub3JlKGNvbnRlbnQ6IHN0cmluZyk6IEdhdGVJZ25vcmVSdWxlW10ge1xuICBjb25zdCBydWxlczogR2F0ZUlnbm9yZVJ1bGVbXSA9IFtdO1xuICBmb3IgKGNvbnN0IHJhd0xpbmUgb2YgY29udGVudC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCBwYXR0ZXJuID0gcmF3TGluZS50cmltKCk7XG4gICAgaWYgKCFwYXR0ZXJuIHx8IHBhdHRlcm4uc3RhcnRzV2l0aCgnIycpKSBjb250aW51ZTtcbiAgICBydWxlcy5wdXNoKHsgcGF0dGVybiwgbWF0Y2hlczogY29tcGlsZVBhdHRlcm4ocGF0dGVybikgfSk7XG4gIH1cbiAgcmV0dXJuIHJ1bGVzO1xufVxuXG4vKipcbiAqIExvYWQgdGhlIGV4Y2x1c2lvbiBydWxlcyBmb3IgYSByZXBvLiBGYWlsLW9wZW46IGFueSByZWFkIGZhaWx1cmUgeWllbGRzIGFuXG4gKiBlbXB0eSBydWxlIHNldCwgc28gYW4gYWJzZW50L3VucmVhZGFibGUgYC5nYXRlaWdub3JlYCBleGNsdWRlcyBub3RoaW5nXG4gKiBiZXlvbmQgdGhlIGdhdGUncyB1bmNvbmRpdGlvbmFsIGAuc3Bhbi8qKmAgZXhjbHVzaW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbG9hZEdhdGVJZ25vcmUocmVwb1Jvb3Q6IHN0cmluZyk6IEdhdGVJZ25vcmVSdWxlW10ge1xuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMobm9kZVBhdGguam9pbihyZXBvUm9vdCwgR0FURV9JR05PUkVfUkVMKSwgJ3V0ZjgnKTtcbiAgICByZXR1cm4gcGFyc2VHYXRlSWdub3JlKGNvbnRlbnQpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gW107XG4gIH1cbn1cblxuLyoqIFRydWUgd2hlbiBzb21lIHJ1bGUgaW4gYHJ1bGVzYCBtYXRjaGVzIGByZXBvUmVsUGF0aGAuICovXG5leHBvcnQgZnVuY3Rpb24gaXNHYXRlSWdub3JlZChydWxlczogR2F0ZUlnbm9yZVJ1bGVbXSwgcmVwb1JlbFBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gcnVsZXMuc29tZSgocnVsZSkgPT4gcnVsZS5tYXRjaGVzKHJlcG9SZWxQYXRoKSk7XG59XG5cbi8qKiBTaWduYXR1cmUgZm9yIGluamVjdGluZyBhIHJ1bGUgbG9hZGVyIChwcm9kdWN0aW9uIGRlZmF1bHQ6IHtAbGluayBsb2FkR2F0ZUlnbm9yZX0pLiAqL1xuZXhwb3J0IHR5cGUgR2F0ZUlnbm9yZUxvYWRlciA9IChyZXBvUm9vdDogc3RyaW5nKSA9PiBHYXRlSWdub3JlUnVsZVtdO1xuIiwgIi8qKlxuICogUGF0aC1zY29wZWQgc3BhbiBzdXBwcmVzc2lvbiBmb3IgdGhlIGFnZW50IGhvb2tzLlxuICpcbiAqIFNvbWUgc3BhbnMgYXJlIG5vaXNlIHdoZW4gYnJvd3NpbmcgY2VydGFpbiBwYXJ0cyBvZiB0aGUgdHJlZSBcdTIwMTQgd2lraSBvclxuICogbWFya2V0aW5nIHNwYW5zIHRoYXQgYW5jaG9yIHByb3NlLCBzdXJmYWNlZCBpbmxpbmUgd2hpbGUgcmVhZGluZyBzb3VyY2UsXG4gKiBhZGQgbGl0dGxlLiBUaGlzIG1vZHVsZSBsZXRzIGEgcmVwbyBkZWNsYXJlLCBwZXIgcGF0aCwgd2hpY2ggc3BhbiBzbHVnXG4gKiBwcmVmaXhlcyB0byBob2xkIGJhY2suXG4gKlxuICogQ29uZmlnIGxpdmVzIGF0IGA8cmVwb1Jvb3Q+Ly5zcGFuLy5ob29raWdub3JlYC4gRWFjaCBub24tY29tbWVudCBsaW5lIGlzIGFcbiAqIGdpdGlnbm9yZS1zdHlsZSBwYXRoIHBhdHRlcm4sIGEgc2luZ2xlIHJ1biBvZiB3aGl0ZXNwYWNlLCB0aGVuIGFcbiAqIGNvbW1hLXNlcGFyYXRlZCBsaXN0IG9mIHNwYW4gc2x1ZyBwcmVmaXhlcyB0byBzdXBwcmVzcyBmb3IgcGF0aHMgdGhlIHBhdHRlcm5cbiAqIG1hdGNoZXM6XG4gKlxuICogICBwYWNrYWdlcy9hZ2VudC1ob29rcy9zcmMgd2lraSxtYXJrZXRpbmdcbiAqXG4gKiBBIHNwYW4gd2hvc2Ugc2x1ZyBiZWdpbnMgd2l0aCBgd2lraWAgb3IgYG1hcmtldGluZ2AgKHRoZSBzbHVnIGVxdWFscyB0aGVcbiAqIHByZWZpeCwgb3IgaXMgYDxwcmVmaXg+L1x1MjAyNmApIGlzIHRoZW4gbmV2ZXIgc3VyZmFjZWQgZm9yIGFuIGFuY2hvciB3aG9zZSBwYXRoXG4gKiBzaXRzIHVuZGVyIGBwYWNrYWdlcy9hZ2VudC1ob29rcy9zcmNgIFx1MjAxNCBuZWl0aGVyIGlubGluZSBieSB0aGUgUHJlVG9vbFVzZSBob29rXG4gKiBub3IgaW4gdGhlIFN0b3AgaG9vaydzIHN0YWxlIC8gcmVsYXRlZCBzZWN0aW9ucy5cbiAqXG4gKiBQYXR0ZXJuIGdyYW1tYXIgaXMgYSBkZWxpYmVyYXRlIHN1YnNldCBvZiBnaXRpZ25vcmU6XG4gKlxuICogLSBCbGFuayBsaW5lcyBhbmQgbGluZXMgYmVnaW5uaW5nIHdpdGggYCNgIGFyZSBza2lwcGVkLlxuICogLSBBIHRyYWlsaW5nIGAvYCByZXN0cmljdHMgdGhlIHBhdHRlcm4gdG8gZGlyZWN0b3JpZXMgKHRoZSBsZWFmIGZpbGUgaXMgbm90XG4gKiAgIGl0c2VsZiB0ZXN0ZWQsIG9ubHkgaXRzIGFuY2VzdG9yIGRpcmVjdG9yaWVzKS5cbiAqIC0gQSBwYXR0ZXJuIGNvbnRhaW5pbmcgYSBzbGFzaCBpcyBhbmNob3JlZCB0byB0aGUgcmVwbyByb290OyBhIHBhdHRlcm4gd2l0aFxuICogICBubyBzbGFzaCBtYXRjaGVzIGEgc2luZ2xlIHBhdGggY29tcG9uZW50IGF0IGFueSBkZXB0aC5cbiAqIC0gYCpgIGFuZCBgP2AgbWF0Y2ggd2l0aGluIG9uZSBwYXRoIHNlZ21lbnQ7IGAqKmAgbWF0Y2hlcyBhY3Jvc3Mgc2VnbWVudHMuXG4gKiAtIE5lZ2F0aW9uIChgIWApIGlzIG5vdCBzdXBwb3J0ZWQuXG4gKlxuICogU3VwcHJlc3Npb24gaXMgZmFpbC1vcGVuOiBhIG1pc3Npbmcgb3IgdW5yZWFkYWJsZSBgLmhvb2tpZ25vcmVgLCBvciBhXG4gKiBtYWxmb3JtZWQgbGluZSwgeWllbGRzIG5vIHJ1bGUgcmF0aGVyIHRoYW4gaGlkaW5nIHNwYW5zIHRoZSBhdXRob3IgZGlkIG5vdFxuICogYXNrIHRvIGhpZGUuXG4gKi9cblxuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuXG5leHBvcnQgaW50ZXJmYWNlIElnbm9yZVJ1bGUge1xuICAvKiogVGhlIHJhdyBnaXRpZ25vcmUtc3R5bGUgcGF0dGVybiwgcmV0YWluZWQgZm9yIGRpYWdub3N0aWNzLiAqL1xuICBwYXR0ZXJuOiBzdHJpbmc7XG4gIC8qKiBTcGFuIHNsdWcgcHJlZml4ZXMgc3VwcHJlc3NlZCBmb3IgcGF0aHMgdGhpcyBydWxlIG1hdGNoZXMuICovXG4gIHByZWZpeGVzOiBzdHJpbmdbXTtcbiAgLyoqIFRydWUgd2hlbiBgcmVwb1JlbFBhdGhgIChQT1NJWCwgcmVwby1yZWxhdGl2ZSkgaXMgZ292ZXJuZWQgYnkgdGhpcyBydWxlLiAqL1xuICBtYXRjaGVzOiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4gYm9vbGVhbjtcbn1cblxuY29uc3QgSE9PS19JR05PUkVfUkVMID0gbm9kZVBhdGguam9pbignLnNwYW4nLCAnLmhvb2tpZ25vcmUnKTtcblxuLyoqXG4gKiBUcmFuc2xhdGUgb25lIGdpdGlnbm9yZS1zdHlsZSBnbG9iIHNlZ21lbnQgaW50byBhbiBhbmNob3JlZCBSZWdFeHAuIGAqYCBhbmRcbiAqIGA/YCBzdGF5IHdpdGhpbiBhIHBhdGggc2VnbWVudDsgYCoqYCAob3B0aW9uYWxseSBmb2xsb3dlZCBieSBgL2ApIHNwYW5zIHRoZW0uXG4gKi9cbmZ1bmN0aW9uIGdsb2JUb1JlZ0V4cChnbG9iOiBzdHJpbmcpOiBSZWdFeHAge1xuICBsZXQgcmUgPSAnJztcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBnbG9iLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYyA9IGdsb2JbaV07XG4gICAgaWYgKGMgPT09ICcqJykge1xuICAgICAgaWYgKGdsb2JbaSArIDFdID09PSAnKicpIHtcbiAgICAgICAgcmUgKz0gJy4qJztcbiAgICAgICAgaSsrO1xuICAgICAgICAvLyBBYnNvcmIgYSBmb2xsb3dpbmcgc2xhc2ggc28gYCoqL2Zvb2AgZG9lcyBub3QgZGVtYW5kIGEgbGl0ZXJhbCBgL2AuXG4gICAgICAgIGlmIChnbG9iW2kgKyAxXSA9PT0gJy8nKSBpKys7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZSArPSAnW14vXSonO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoYyA9PT0gJz8nKSB7XG4gICAgICByZSArPSAnW14vXSc7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlICs9IGMucmVwbGFjZSgvWy4rXiR7fSgpfFtcXF1cXFxcXS9nLCAnXFxcXCQmJyk7XG4gICAgfVxuICB9XG4gIHJldHVybiBuZXcgUmVnRXhwKGBeJHtyZX0kYCk7XG59XG5cbi8qKiBBbmNlc3RvciBwYXRoIGNoYWluOiBgYS9iL2MudHNgIFx1MjE5MiBgWydhJywgJ2EvYicsICdhL2IvYy50cyddYC4gKi9cbmZ1bmN0aW9uIGFuY2VzdG9yUGF0aHMocGF0aDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBwYXJ0cyA9IHBhdGguc3BsaXQoJy8nKTtcbiAgY29uc3Qgb3V0OiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgb3V0LnB1c2gocGFydHMuc2xpY2UoMCwgaSArIDEpLmpvaW4oJy8nKSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBDb21waWxlIGEgc2luZ2xlIGdpdGlnbm9yZS1zdHlsZSBwYXR0ZXJuICh0aGlzIG1vZHVsZSdzIGdyYW1tYXIgXHUyMDE0IHNlZSB0aGVcbiAqIG1vZHVsZSBkb2MgY29tbWVudCkgaW50byBhIHBhdGggcHJlZGljYXRlLiBBIHBhdHRlcm4gbWF0Y2hlcyBhIGZpbGUgd2hlbiBpdFxuICogbWF0Y2hlcyB0aGUgZmlsZSdzIHBhdGggb3IgYW55IGFuY2VzdG9yIGRpcmVjdG9yeSBvZiBpdCwgc28gYSBkaXJlY3RvcnlcbiAqIHBhdHRlcm4gc3VwcHJlc3NlcyBldmVyeXRoaW5nIGJlbmVhdGggaXQuXG4gKlxuICogRXhwb3J0ZWQgc28gb3RoZXIgcGF0aC1zY29wZWQgaWdub3JlLWZpbGUgY29udmVudGlvbnMgKGUuZy4gYC5nYXRlaWdub3JlYFxuICogaW4gYGdhdGUtaWdub3JlLnRzYCkgY2FuIHJldXNlIHRoZSBleGFjdCBtYXRjaGluZyBzZW1hbnRpY3MgcmF0aGVyIHRoYW5cbiAqIHJlaW1wbGVtZW50aW5nIHRoZW0uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21waWxlUGF0dGVybihwYXR0ZXJuOiBzdHJpbmcpOiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4gYm9vbGVhbiB7XG4gIGxldCBwYXQgPSBwYXR0ZXJuO1xuICBsZXQgZGlyT25seSA9IGZhbHNlO1xuICBpZiAocGF0LmVuZHNXaXRoKCcvJykpIHtcbiAgICBkaXJPbmx5ID0gdHJ1ZTtcbiAgICBwYXQgPSBwYXQuc2xpY2UoMCwgLTEpO1xuICB9XG4gIGxldCBhbmNob3JlZCA9IHBhdC5pbmNsdWRlcygnLycpO1xuICBpZiAocGF0LnN0YXJ0c1dpdGgoJy8nKSkge1xuICAgIGFuY2hvcmVkID0gdHJ1ZTtcbiAgICBwYXQgPSBwYXQuc2xpY2UoMSk7XG4gIH1cbiAgY29uc3QgcmUgPSBnbG9iVG9SZWdFeHAocGF0KTtcblxuICByZXR1cm4gKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IHtcbiAgICBpZiAoYW5jaG9yZWQpIHtcbiAgICAgIGNvbnN0IHNlZ3MgPSBhbmNlc3RvclBhdGhzKHJlcG9SZWxQYXRoKTtcbiAgICAgIC8vIEZvciBhIGRpci1vbmx5IHBhdHRlcm4sIG5ldmVyIHRlc3QgdGhlIGxlYWYgZmlsZSBpdHNlbGYuXG4gICAgICBjb25zdCBjYW5kaWRhdGVzID0gZGlyT25seSA/IHNlZ3Muc2xpY2UoMCwgLTEpIDogc2VncztcbiAgICAgIHJldHVybiBjYW5kaWRhdGVzLnNvbWUoKHMpID0+IHJlLnRlc3QocykpO1xuICAgIH1cbiAgICAvLyBVbmFuY2hvcmVkOiBtYXRjaCBhZ2FpbnN0IGluZGl2aWR1YWwgcGF0aCBjb21wb25lbnRzIGF0IGFueSBkZXB0aC5cbiAgICBjb25zdCBjb21wb25lbnRzID0gcmVwb1JlbFBhdGguc3BsaXQoJy8nKTtcbiAgICBjb25zdCBjYW5kaWRhdGVzID0gZGlyT25seSA/IGNvbXBvbmVudHMuc2xpY2UoMCwgLTEpIDogY29tcG9uZW50cztcbiAgICByZXR1cm4gY2FuZGlkYXRlcy5zb21lKChjKSA9PiByZS50ZXN0KGMpKTtcbiAgfTtcbn1cblxuLyoqIFBhcnNlIGAuaG9va2lnbm9yZWAgdGV4dCBpbnRvIHJ1bGVzLCBza2lwcGluZyBjb21tZW50cyBhbmQgbWFsZm9ybWVkIGxpbmVzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlSG9va0lnbm9yZShjb250ZW50OiBzdHJpbmcpOiBJZ25vcmVSdWxlW10ge1xuICBjb25zdCBydWxlczogSWdub3JlUnVsZVtdID0gW107XG4gIGZvciAoY29uc3QgcmF3TGluZSBvZiBjb250ZW50LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IGxpbmUgPSByYXdMaW5lLnRyaW0oKTtcbiAgICBpZiAoIWxpbmUgfHwgbGluZS5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIC8vIGA8cGF0dGVybj48d2hpdGVzcGFjZT48cHJlZml4ZXM+YCBcdTIwMTQgcGF0dGVybiBpcyB0aGUgZmlyc3QgdG9rZW4sIHByZWZpeGVzXG4gICAgLy8gdGhlIHNlY29uZC4gQSBsaW5lIHdpdGhvdXQgYm90aCBpcyBtYWxmb3JtZWQgYW5kIHNraXBwZWQuXG4gICAgY29uc3QgbWF0Y2ggPSBsaW5lLm1hdGNoKC9eKFxcUyspXFxzKyhcXFMrKSQvKTtcbiAgICBpZiAoIW1hdGNoKSBjb250aW51ZTtcbiAgICBjb25zdCBbLCBwYXR0ZXJuLCBwcmVmaXhlc1Jhd10gPSBtYXRjaDtcbiAgICBjb25zdCBwcmVmaXhlcyA9IHByZWZpeGVzUmF3XG4gICAgICAuc3BsaXQoJywnKVxuICAgICAgLm1hcCgocCkgPT4gcC50cmltKCkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgIGlmIChwcmVmaXhlcy5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgIHJ1bGVzLnB1c2goeyBwYXR0ZXJuLCBwcmVmaXhlcywgbWF0Y2hlczogY29tcGlsZVBhdHRlcm4ocGF0dGVybikgfSk7XG4gIH1cbiAgcmV0dXJuIHJ1bGVzO1xufVxuXG4vKipcbiAqIExvYWQgdGhlIHN1cHByZXNzaW9uIHJ1bGVzIGZvciBhIHJlcG8uIEZhaWwtb3BlbjogYW55IHJlYWQgb3IgcGFyc2UgZmFpbHVyZVxuICogeWllbGRzIGFuIGVtcHR5IHJ1bGUgc2V0LCBzbyBzcGFucyBzdXJmYWNlIGFzIG5vcm1hbCB3aGVuIG5vIGNvbmZpZyBleGlzdHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsb2FkSG9va0lnbm9yZShyZXBvUm9vdDogc3RyaW5nKTogSWdub3JlUnVsZVtdIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKG5vZGVQYXRoLmpvaW4ocmVwb1Jvb3QsIEhPT0tfSUdOT1JFX1JFTCksICd1dGY4Jyk7XG4gICAgcmV0dXJuIHBhcnNlSG9va0lnbm9yZShjb250ZW50KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG59XG5cbi8qKiBBIHNsdWcgY2FycmllcyBhIHByZWZpeCB3aGVuIGl0IGVxdWFscyB0aGUgcHJlZml4IG9yIGlzIGA8cHJlZml4Pi9cdTIwMjZgLiAqL1xuZnVuY3Rpb24gc2x1Z0hhc1ByZWZpeChzbHVnOiBzdHJpbmcsIHByZWZpeDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBzbHVnID09PSBwcmVmaXggfHwgc2x1Zy5zdGFydHNXaXRoKGAke3ByZWZpeH0vYCk7XG59XG5cbi8qKlxuICogVHJ1ZSB3aGVuIGEgc3BhbiBgc2x1Z2Agc2hvdWxkIGJlIHN1cHByZXNzZWQgZm9yIGFuIGFuY2hvciBhdCBgcmVwb1JlbFBhdGhgOlxuICogc29tZSBydWxlIG1hdGNoZXMgdGhlIHBhdGggYW5kIGxpc3RzIGEgcHJlZml4IHRoZSBzbHVnIGNhcnJpZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1NwYW5TdXBwcmVzc2VkKHJ1bGVzOiBJZ25vcmVSdWxlW10sIHJlcG9SZWxQYXRoOiBzdHJpbmcsIHNsdWc6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IHJ1bGUgb2YgcnVsZXMpIHtcbiAgICBpZiAoIXJ1bGUubWF0Y2hlcyhyZXBvUmVsUGF0aCkpIGNvbnRpbnVlO1xuICAgIGlmIChydWxlLnByZWZpeGVzLnNvbWUoKHApID0+IHNsdWdIYXNQcmVmaXgoc2x1ZywgcCkpKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBTaWduYXR1cmUgZm9yIGluamVjdGluZyBhIHJ1bGUgbG9hZGVyIChwcm9kdWN0aW9uIGRlZmF1bHQ6IHtAbGluayBsb2FkSG9va0lnbm9yZX0pLiAqL1xuZXhwb3J0IHR5cGUgSG9va0lnbm9yZUxvYWRlciA9IChyZXBvUm9vdDogc3RyaW5nKSA9PiBJZ25vcmVSdWxlW107XG4iLCAiLyoqXG4gKiBDb2RleCBQcmVUb29sVXNlIGdhdGUgaG9vayBcdTIwMTQgaG9sZCBgZ2l0IGNvbW1pdGAvYGdpdCBwdXNoYCBvbiByZWFsIHNwYW4gZGVidCxcbiAqIGFuZCBhZHZpc2UgKG5ldmVyIGhvbGQpIG9uIGEgcGxhaW4gYGdpdCBzdGF0dXNgLlxuICpcbiAqIFRoZSBDb2RleCB0d2luIG9mIFtjbGF1ZGUvZ2F0ZS50c10oLi9wYWNrYWdlcy9hZ2VudC1ob29rcy9zcmMvY2xhdWRlL2dhdGUudHMpOlxuICogc2FtZSBzaGFyZWQgZ2F0ZS1jb3JlIHBpcGVsaW5lICh7QGxpbmsgcGFyc2VHaXRDb21tYW5kfSBcdTIxOTIge0BsaW5rIHJlc29sdmVDaGFuZ2VzZXR9XG4gKiBcdTIxOTIge0BsaW5rIGV2YWx1YXRlR2F0ZX0pLCB0cmFuc2xhdGVkIGludG8gQ29kZXgncyBQcmVUb29sVXNlIG91dHB1dCBzaGFwZS4gQ29kZXhcbiAqIGRlbGl2ZXJzIGEgc2hlbGwgY29tbWFuZCBhcyBhbiBTREstdHlwZWQgYHVua25vd25gIGB0b29sX2lucHV0YDsgdGhpcyBoYW5kbGVyXG4gKiBuYXJyb3dzIGl0IChzdHJpbmcsIG9yIGEgYFtcImJhc2hcIixcIi1sY1wiLFwiPHNjcmlwdD5cIl1gL2FyZ3YgYXJyYXkpIGludG8gdGhlXG4gKiBjb21tYW5kIHN0cmluZyB0aGUgY29yZSBwYXJzZXMuXG4gKlxuICogXHUyNTAwXHUyNTAwIFVuY29uZmlybWVkIGRlbnkgKHNlZSBub3Rlcy9jb2RleC1kZW55LXNwaWtlLm1kKSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcbiAqIFdoZXRoZXIgQ29kZXgncyBgcGVybWlzc2lvbkRlY2lzaW9uOiAnZGVueSdgIGFjdHVhbGx5ICpibG9ja3MqIHRoZSBzaGVsbCB0b29sXG4gKiBsaXZlIHdhcyBuZXZlciBjb25maXJtZWQgaW4gdGhpcyByZXBvOiB0aGUgUGhhc2UgMCBzcGlrZSBjb3VsZCBub3QgZ2V0IGFcbiAqIGZyb20tc2NyYXRjaCBwbHVnaW4gdG8gbG9hZCwgc28gdGhlIGRlbnkgcGF0aCB3YXMgbmV2ZXIgZXhlcmNpc2VkIGVuZC10by1lbmQuXG4gKiBUaGUgb25seSBwb3NpdGl2ZSBldmlkZW5jZSBpcyBkb2N1bWVudGFyeSBcdTIwMTQgdGhlIGBAZ29vZGZvb3QvY29kZXgtaG9va3NgIFJFQURNRVxuICogKHRoZSBleGFjdCB2ZXJzaW9uIHRoaXMgcmVwbyBkZXBlbmRzIG9uKSBzaGlwcyBhIHdvcmtlZCBgcGVybWlzc2lvbkRlY2lzaW9uOlxuICogJ2RlbnknYCBleGFtcGxlIG1hdGNoZWQgb24gYFwiQmFzaFwiYC4gVGhpcyBhZGFwdGVyIHRoZXJlZm9yZSBzaGlwcyB0aGUgaGFyZC1kZW55XG4gKiBwYXRoIHBlciB0aGF0IFJFQURNRSAoe0BsaW5rIENPREVYX0dBVEVfSEFSRF9ERU5ZfSA9IGB0cnVlYCksIGJ1dCBrZWVwcyB0aGVcbiAqIENBUkQubWQtZG9jdW1lbnRlZCBmYWxsYmFjayBcdTIwMTQgYSBsb3VkIGBhZGRpdGlvbmFsQ29udGV4dGAgd2FybmluZyB0aGF0IGFsbG93c1xuICogdGhlIGNvbW1hbmQsIHdpdGggdGhlIENJIHJlY2lwZSBhcyBDb2RleCdzIGVuZm9yY2VtZW50IGJhY2tzdG9wIFx1MjAxNCBhcyBhIGNsZWFybHlcbiAqIHNlcGFyYWJsZSBicmFuY2ggYmVoaW5kIHRoYXQgb25lIGNvbnN0YW50LiBJZiBhIGxpdmUgc2Vzc2lvbiBzaG93cyBkZW55IGRvZXNcbiAqIG5vdCBmaXJlLCBmbGlwIHtAbGluayBDT0RFWF9HQVRFX0hBUkRfREVOWX0gdG8gYGZhbHNlYDsgbm90aGluZyBlbHNlIGNoYW5nZXMuXG4gKlxuICogVGhlIHNoZWxsIHRvb2wncyBleGFjdCBgdG9vbF9uYW1lYCBpcyBsaWtld2lzZSB1bmNvbmZpcm1lZCAodGhlIFJFQURNRSdzXG4gKiBleGFtcGxlIHVzZXMgYFwiQmFzaFwiYDsgQ29kZXggQ0xJIHRyYW5zY3JpcHRzIGluIHRoZSBzcGlrZSBsYWJlbGVkIHRoZSBjYWxsXG4gKiBgZXhlY2ApLiBUaGUgcmVnaXN0cmF0aW9uIG1hdGNoZXIgaXMgYnJvYWRlbmVkIHRvIHRoZSBwbGF1c2libGUgbmFtZXMgc28gdGhlXG4gKiBob29rIGFjdHVhbGx5IGZpcmVzLCBhbmQgZXZlcnkgZmlyZSBsb2dzIHRoZSBvYnNlcnZlZCBgdG9vbF9uYW1lYCBzbyB0aGUgZmlyc3RcbiAqIGxpdmUgcnVuIHJldmVhbHMgdGhlIGxpdGVyYWwgc3RyaW5nIHRvIG5hcnJvdyB0aGUgbWF0Y2hlciB0by5cbiAqXG4gKiBGYWlsLW9wZW4gYXQgZXZlcnkgbGF5ZXI6IGdhdGUtY29yZSByZXNvbHZlcyBpbnRlcm5hbCBlcnJvcnMgdG8gYWxsb3csIGFuZCB0aGlzXG4gKiBhZGFwdGVyIHdyYXBzIHRoZSB3aG9sZSBwYXRoIGluIGEgdHJ5L2NhdGNoIHRoYXQgYWxsb3dzLWFuZC1sb2dzIFx1MjAxNCB0aGUgZ2F0ZVxuICogbXVzdCBuZXZlciBicmljayBhIGNvbW1pdC4gVGhlIHRpbWVvdXQgaXMgbWlsbGlzZWNvbmRzIGhlcmUgKHRoZSBDb2RleCBDTElcbiAqIGRpdmlkZXMgdG8gc2Vjb25kcyBhdCBlbWl0KS5cbiAqL1xuXG5pbXBvcnQgeyB0eXBlIEhvb2tDb250ZXh0LCB0eXBlIFByZVRvb2xVc2VJbnB1dCwgcHJlVG9vbFVzZUhvb2ssIHByZVRvb2xVc2VPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY29kZXgtaG9va3MnO1xuaW1wb3J0IHtcbiAgY29tbWl0U3RhZ2VzQWxsLFxuICBjcmVhdGVEZWZhdWx0R2F0ZUV4ZWN1dG9ycyxcbiAgY3JlYXRlRGVmYXVsdEdpdEV4ZWN1dG9yLFxuICBjcmVhdGVEaXNrR2F0ZU1lbW9TdGF0ZSxcbiAgZXZhbHVhdGVHYXRlLFxuICB0eXBlIEdhdGVFeGVjdXRvcnMsXG4gIHR5cGUgR2F0ZU1lbW9TdGF0ZSxcbiAgdHlwZSBHaXRFeGVjdXRvcixcbiAgcGFyc2VHaXRDb21tYW5kLFxuICByZXNvbHZlQ2hhbmdlc2V0XG59IGZyb20gJy4uL2NvbW1vbi9nYXRlLWNvcmUuanMnO1xuXG4vKipcbiAqIFdoZXRoZXIgQ29kZXgncyBgcGVybWlzc2lvbkRlY2lzaW9uOiAnZGVueSdgIGlzIHRydXN0ZWQgdG8gYmxvY2sgdGhlIHNoZWxsIHRvb2xcbiAqIGxpdmUuIFNoaXBzIGB0cnVlYCAoaGFyZCBkZW55KSBwZXIgdGhlIGBAZ29vZGZvb3QvY29kZXgtaG9va3NgIFJFQURNRSdzIHdvcmtlZFxuICogZXhhbXBsZS4gRmxpcCB0byBgZmFsc2VgIHRvIGFjdGl2YXRlIHRoZSBDQVJELm1kLWRvY3VtZW50ZWQgZmFsbGJhY2sgaWYgYSBsaXZlXG4gKiBzZXNzaW9uIHNob3dzIGRlbnkgZG9lcyBub3QgZmlyZSBcdTIwMTQgc2VlIG5vdGVzL2NvZGV4LWRlbnktc3Bpa2UubWQgYW5kIHRoaXNcbiAqIGZpbGUncyBoZWFkZXIuIFRoaXMgaXMgdGhlIHNpbmdsZSBzd2l0Y2ggdGhhdCBzZXBhcmF0ZXMgdGhlIHR3byBjb2RlIHBhdGhzLlxuICovXG5jb25zdCBDT0RFWF9HQVRFX0hBUkRfREVOWSA9IHRydWU7XG5cbi8qKlxuICogTmFycm93IENvZGV4J3MgYHVua25vd25gIHNoZWxsIGB0b29sX2lucHV0YCBpbnRvIHRoZSBjb21tYW5kIHN0cmluZyB0aGUgY29yZVxuICogcGFyc2VzLiBIYW5kbGVzIGEgYmFyZSBgY29tbWFuZGAgc3RyaW5nLCBhIHNoZWxsLXdyYXBwZXIgYXJndlxuICogKGBbXCJiYXNoXCIsXCItbGNcIixcIjxzY3JpcHQ+XCJdYCBcdTIxOTIgdGhlIHNjcmlwdCBhZnRlciBgLWNgL2AtbGNgKSwgYW5kIGEgZGlyZWN0IGFyZ3ZcbiAqIChgW1wiZ2l0XCIsXCJjb21taXRcIixcdTIwMjZdYCBcdTIxOTIgc3BhY2Utam9pbmVkKS4gUmV0dXJucyBgbnVsbGAgd2hlbiBubyBjb21tYW5kIHRleHQgaXNcbiAqIHJlY292ZXJhYmxlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdFNoZWxsQ29tbWFuZCh0b29sSW5wdXQ6IHVua25vd24pOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKHRvb2xJbnB1dCA9PT0gbnVsbCB8fCB0eXBlb2YgdG9vbElucHV0ICE9PSAnb2JqZWN0JyB8fCAhKCdjb21tYW5kJyBpbiB0b29sSW5wdXQpKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgY29tbWFuZCA9ICh0b29sSW5wdXQgYXMgeyBjb21tYW5kOiB1bmtub3duIH0pLmNvbW1hbmQ7XG4gIGlmICh0eXBlb2YgY29tbWFuZCA9PT0gJ3N0cmluZycpIHJldHVybiBjb21tYW5kLmxlbmd0aCA+IDAgPyBjb21tYW5kIDogbnVsbDtcbiAgaWYgKEFycmF5LmlzQXJyYXkoY29tbWFuZCkpIHtcbiAgICBjb25zdCBwYXJ0cyA9IGNvbW1hbmQuZmlsdGVyKChwKTogcCBpcyBzdHJpbmcgPT4gdHlwZW9mIHAgPT09ICdzdHJpbmcnKTtcbiAgICBpZiAocGFydHMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBmbGFnSWR4ID0gcGFydHMuZmluZEluZGV4KChwKSA9PiBwID09PSAnLWMnIHx8IHAgPT09ICctbGMnIHx8IHAgPT09ICctaWMnKTtcbiAgICBpZiAoZmxhZ0lkeCA+PSAwICYmIHBhcnRzW2ZsYWdJZHggKyAxXSAhPT0gdW5kZWZpbmVkKSByZXR1cm4gcGFydHNbZmxhZ0lkeCArIDFdO1xuICAgIHJldHVybiBwYXJ0cy5qb2luKCcgJyk7XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVIYW5kbGVyKFxuICBnaXQ6IEdpdEV4ZWN1dG9yID0gY3JlYXRlRGVmYXVsdEdpdEV4ZWN1dG9yKCksXG4gIGV4ZWN1dG9yczogR2F0ZUV4ZWN1dG9ycyA9IGNyZWF0ZURlZmF1bHRHYXRlRXhlY3V0b3JzKCksXG4gIG1lbW9GYWN0b3J5OiAoY3dkOiBzdHJpbmcpID0+IEdhdGVNZW1vU3RhdGUgPSBjcmVhdGVEaXNrR2F0ZU1lbW9TdGF0ZSxcbiAgLy8gVGhlIGhhcmQtZGVueSBzd2l0Y2ggaXMgYSBwYXJhbWV0ZXIgKGRlZmF1bHRpbmcgdG8gdGhlIHNoaXBwZWQgY29uc3RhbnQpIHNvXG4gIC8vIHRoZSBkb2N1bWVudGVkIGZhbGxiYWNrIGJyYW5jaCBpcyBkaXJlY3RseSBleGVyY2lzYWJsZSBpbiB0ZXN0cyB3aXRob3V0XG4gIC8vIG11dGF0aW5nIGEgbW9kdWxlLWxldmVsIGNvbnN0LiBQcm9kdWN0aW9uIHdpcmluZyBuZXZlciBwYXNzZXMgdGhpcyBcdTIwMTQgdGhlXG4gIC8vIGRlZmF1bHQgZXhwb3J0IGJlbG93IGNvbnN0cnVjdHMgdGhlIGhhbmRsZXIgd2l0aCB0aGUgY29uc3RhbnQncyB2YWx1ZS5cbiAgaGFyZERlbnk6IGJvb2xlYW4gPSBDT0RFWF9HQVRFX0hBUkRfREVOWVxuKSB7XG4gIHJldHVybiBhc3luYyAoaW5wdXQ6IFByZVRvb2xVc2VJbnB1dCwgY3R4OiBIb29rQ29udGV4dCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICAvLyBMb2cgdGhlIG9ic2VydmVkIHNoZWxsIHRvb2xfbmFtZSBzbyB0aGUgZmlyc3QgbGl2ZSBydW4gcmV2ZWFscyB0aGUgbGl0ZXJhbFxuICAgICAgLy8gc3RyaW5nIHRvIG5hcnJvdyB0aGUgbWF0Y2hlciB0byAodGhlIHNwaWtlIG5ldmVyIGNvbmZpcm1lZCBpdCBlbXBpcmljYWxseSkuXG4gICAgICBjdHgubG9nZ2VyLmluZm8oJ2dpdC1zcGFuIGdhdGUgb2JzZXJ2ZWQgc2hlbGwgdG9vbCcsIHsgdG9vbF9uYW1lOiBpbnB1dC50b29sX25hbWUgfSk7XG5cbiAgICAgIGNvbnN0IGNvbW1hbmQgPSBleHRyYWN0U2hlbGxDb21tYW5kKGlucHV0LnRvb2xfaW5wdXQpO1xuICAgICAgaWYgKGNvbW1hbmQgPT09IG51bGwpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlR2l0Q29tbWFuZChjb21tYW5kKTtcbiAgICAgIGlmIChwYXJzZWQua2luZCA9PT0gJ25vbmUnKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgICBjb25zdCBjd2QgPSBpbnB1dC5jd2QgPz8gJyc7XG4gICAgICBjb25zdCBhbGwgPSBwYXJzZWQua2luZCA9PT0gJ2NvbW1pdCcgPyBjb21taXRTdGFnZXNBbGwoY29tbWFuZCkgOiBmYWxzZTtcbiAgICAgIGNvbnN0IGNoYW5nZXNldCA9IGF3YWl0IHJlc29sdmVDaGFuZ2VzZXQocGFyc2VkLmtpbmQsIGFsbCwgY3dkLCBnaXQsIHBhcnNlZC5wYXRocyk7XG5cbiAgICAgIGNvbnN0IG1vZGUgPSBwYXJzZWQua2luZCA9PT0gJ3N0YXR1cycgPyAnaW5mb3JtJyA6ICdlbmZvcmNlJztcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGV2YWx1YXRlR2F0ZShjaGFuZ2VzZXQsIGN3ZCwgZXhlY3V0b3JzLCBtZW1vRmFjdG9yeShjd2QpLCBtb2RlKTtcbiAgICAgIGlmIChyZXN1bHQuZGVjaXNpb24gIT09ICdkZW55Jykge1xuICAgICAgICAvLyBFbnZpcm9ubWVudGFsIHN0YWxlbmVzcyBhbmQgYSBmYWlsZWQgc3RhbGVuZXNzIHNjYW4gYm90aCBhbGxvd1xuICAgICAgICAvLyAoZmFpbC1vcGVuKSBidXQgbXVzdCBub3QgYmUgc3dhbGxvd2VkOiBsb2cgYW5kIHN1cmZhY2UgdGhlIHJlYXNvbiBhc1xuICAgICAgICAvLyBhZGRpdGlvbmFsIGNvbnRleHQuXG4gICAgICAgIGlmIChyZXN1bHQua2luZCA9PT0gJ2Vudmlyb25tZW50YWwnIHx8IHJlc3VsdC5raW5kID09PSAnc2Nhbi1mYWlsZWQnKSB7XG4gICAgICAgICAgY3R4LmxvZ2dlci53YXJuKCdnaXQtc3BhbiBnYXRlIGFsbG93ZWQgd2l0aCBhbiB1bnJlc29sdmVkIGNvbmRpdGlvbicsIHsgcmVhc29uOiByZXN1bHQucmVhc29uIH0pO1xuICAgICAgICAgIHJldHVybiBwcmVUb29sVXNlT3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IHJlc3VsdC5yZWFzb24sIHN5c3RlbU1lc3NhZ2U6IHJlc3VsdC5yZWFzb24gfSk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gYHN0YXR1c2Atb25seSBhZHZpc29yeSBraW5kczogc3BhbiBkZWJ0IGV4aXN0cywgYnV0IGEgc3RhdHVzIGNoZWNrXG4gICAgICAgIC8vIG5ldmVyIGhvbGRzIHRoZSBjb21tYW5kIFx1MjAxNCBzdXJmYWNlIGl0IGFzIGluZm9ybWF0aW9uLCBub3QgYSB3YXJuaW5nLlxuICAgICAgICBpZiAocmVzdWx0LmtpbmQgPT09ICdzZW1hbnRpYy1zdGFsZW5lc3MtaW5mbycgfHwgcmVzdWx0LmtpbmQgPT09ICd1bmNvdmVyZWQtd3JpdGVzLWluZm8nKSB7XG4gICAgICAgICAgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0LnJlYXNvbiwgc3lzdGVtTWVzc2FnZTogcmVzdWx0LnJlYXNvbiB9KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBpZiAoaGFyZERlbnkpIHtcbiAgICAgICAgLy8gUHJpbWFyeSBwYXRoIChwZXIgdGhlIFJFQURNRSk6IGFjdHVhbGx5IGJsb2NrIHRoZSBjb21tYW5kLlxuICAgICAgICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7XG4gICAgICAgICAgcGVybWlzc2lvbkRlY2lzaW9uOiAnZGVueScsXG4gICAgICAgICAgcGVybWlzc2lvbkRlY2lzaW9uUmVhc29uOiByZXN1bHQucmVhc29uLFxuICAgICAgICAgIHN5c3RlbU1lc3NhZ2U6IHJlc3VsdC5yZWFzb25cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICAvLyBGYWxsYmFjayBwYXRoIChDQVJELm1kIGNvbnRpbmdlbmN5KTogY2Fubm90IGJsb2NrLCBzbyBzdXJmYWNlIHRoZSBzYW1lXG4gICAgICAvLyBjaGVja2xpc3QgYXMgYSBsb3VkIHdhcm5pbmcgYW5kIGFsbG93IFx1MjAxNCB0aGUgQ0kgcmVjaXBlIGVuZm9yY2VzIGZvciBDb2RleC5cbiAgICAgIGNvbnN0IHdhcm5pbmcgPSBgQ291bGQgbm90IGJsb2NrIHRoaXMgY29tbWFuZCBcdTIwMTQgdGhlIGlzc3VlIGJlbG93IHN0aWxsIG5lZWRzIHJlc29sdmluZzpcXG4ke3Jlc3VsdC5yZWFzb259YDtcbiAgICAgIHJldHVybiBwcmVUb29sVXNlT3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IHdhcm5pbmcsIHN5c3RlbU1lc3NhZ2U6IHdhcm5pbmcgfSk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjdHgubG9nZ2VyLndhcm4oJ2dpdC1zcGFuIGdhdGUgZmFpbGVkIG9wZW4gb24gYW4gdW5jYXVnaHQgZXJyb3InLCB7IGVyciB9KTtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBwcmVUb29sVXNlSG9vayh7IG1hdGNoZXI6ICdCYXNofHNoZWxsfGV4ZWN8bG9jYWxfc2hlbGwnLCB0aW1lb3V0OiAxMF8wMDAgfSwgY3JlYXRlSGFuZGxlcigpKTtcbiIsICJpbXBvcnQgaG9vayBmcm9tIFwiLi9nYXRlLnRzXCI7XG5pbXBvcnQgeyBleGVjdXRlIH0gZnJvbSBcIi4uLy4uLy4uLy4uL25vZGVfbW9kdWxlcy9AZ29vZGZvb3QvY29kZXgtaG9va3MvZGlzdC9ydW50aW1lLmpzXCI7XG5leGVjdXRlKGhvb2spO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQTRCTyxJQUFNLDBCQUEwQixvQkFBSSxJQUFJLENBQUMsZ0JBQWdCLG9CQUFvQixlQUFlLENBQUM7OztBQzVCcEcsU0FBUyxlQUFlLGVBQWUsUUFBUSxTQUFTO0FBQ3BELFFBQU0sT0FBTztBQUNiLE9BQUssZ0JBQWdCO0FBQ3JCLE9BQUssVUFBVSxPQUFPO0FBQ3RCLE9BQUssZ0JBQWdCLE9BQU87QUFDNUIsTUFBSSxhQUFhLFVBQVUsT0FBTyxPQUFPLFlBQVksVUFBVTtBQUMzRCxTQUFLLFVBQVUsT0FBTztBQUFBLEVBQzFCO0FBQ0EsU0FBTztBQUNYO0FBQ08sU0FBUyxlQUFlLFFBQVEsU0FBUztBQUM1QyxTQUFPLGVBQWUsY0FBYyxRQUFRLE9BQU87QUFDdkQ7OztBQ1pBLFNBQVMsV0FBVyxZQUFZLFdBQVcsVUFBVSxpQkFBaUI7QUFDdEUsU0FBUyxlQUFlO0FBQ3hCLElBQU0sc0JBQXNCO0FBQ3JCLElBQU0sU0FBTixNQUFhO0FBQUEsRUFDaEIsV0FBVyxvQkFBSSxJQUFJO0FBQUEsRUFDbkIsa0JBQWtCO0FBQUEsRUFDbEIsWUFBWTtBQUFBLEVBQ1osY0FBYztBQUFBLEVBQ2Q7QUFBQSxFQUNBO0FBQUEsRUFDQSxZQUFZLFNBQVMsQ0FBQyxHQUFHO0FBQ3JCLFNBQUssY0FBYyxPQUFPLGVBQWUsUUFBUSxJQUFJLE9BQU8sYUFBYSxtQkFBbUIsS0FBSztBQUFBLEVBQ3JHO0FBQUEsRUFDQSxXQUFXLFVBQVUsT0FBTztBQUN4QixTQUFLLGtCQUFrQjtBQUN2QixTQUFLLGVBQWU7QUFB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LE9BQU8sUUFBUSxlQUFlLE9BQU8sT0FBTyxDQUFDO0FBQUEsUUFDNUY7QUFDQSxlQUFPO0FBQUEsTUFDVDtBQUVBLFVBQUksVUFBVTtBQUVaLGVBQU8saUJBQWlCO0FBQUEsVUFDdEIsb0JBQW9CO0FBQUEsVUFDcEIsMEJBQTBCLE9BQU87QUFBQSxVQUNqQyxlQUFlLE9BQU87QUFBQSxRQUN4QixDQUFDO0FBQUEsTUFDSDtBQUdBLFlBQU0sVUFBVTtBQUFBLEVBQTBFLE9BQU8sTUFBTTtBQUN2RyxhQUFPLGlCQUFpQixFQUFFLG1CQUFtQixTQUFTLGVBQWUsUUFBUSxDQUFDO0FBQUEsSUFDaEYsU0FBUyxLQUFLO0FBQ1osVUFBSSxPQUFPLEtBQUssa0RBQWtELEVBQUUsSUFBSSxDQUFDO0FBQ3pFLGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUNGO0FBRUEsSUFBTyxlQUFRLGVBQWUsRUFBRSxTQUFTLCtCQUErQixTQUFTLElBQU8sR0FBRyxjQUFjLENBQUM7OztBQzdJMUcsUUFBUSxZQUFJOyIsCiAgIm5hbWVzIjogWyJyZXNvbHZlIiwgImV4ZWNGaWxlU3luYyIsICJmcyIsICJub2RlUGF0aCIsICJmcyIsICJub2RlUGF0aCIsICJmcyIsICJub2RlUGF0aCIsICJjYW5kaWRhdGVzIiwgInN0YWdlZCIsICJ0cmFja2VkIiwgInVuY292ZXJlZCIsICJleGVjRmlsZVN5bmMiXQp9Cg==

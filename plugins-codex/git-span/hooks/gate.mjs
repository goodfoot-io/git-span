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
        const seen3 = wasAlreadySeen(memoState, gateStateDigest(semantic, []));
        return {
          decision: "allow",
          kind: "semantic-staleness-info",
          findings: semantic,
          reason: renderStalenessReason(semantic, await fetchSpanBlocks(executors, semantic, cwd), "inform", seen3)
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
      const { uncovered: uncovered2, covering: covering2 } = await computeUncoveredPaths(paths, cwd, executors);
      if (uncovered2.length === 0) return { decision: "allow", kind: "silent" };
      const seen2 = wasAlreadySeen(memoState, gateStateDigest([], uncovered2));
      return {
        decision: "allow",
        kind: "uncovered-writes-info",
        uncovered: uncovered2,
        reason: renderUncoveredReason(uncovered2, covering2, "inform", seen2)
      };
    }
    let semanticAlreadyPresented = false;
    if (semantic.length > 0) {
      const semanticDigest = gateStateDigest(semantic, []);
      if (!memoState.has(semanticDigest)) {
        if (!memoState.record(semanticDigest)) return { decision: "allow", kind: "silent" };
        const seen2 = wasAlreadySeen(memoState, semanticDigest);
        return {
          decision: "deny",
          kind: "semantic-staleness",
          findings: semantic,
          reason: renderStalenessReason(semantic, await fetchSpanBlocks(executors, semantic, cwd), "enforce", seen2)
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
    const { uncovered, covering } = await computeUncoveredPaths(paths, cwd, executors);
    if (uncovered.length === 0) {
      return semanticAlreadyPresented ? { decision: "allow", kind: "already-presented" } : { decision: "allow", kind: "silent" };
    }
    const digest = gateStateDigest([], uncovered);
    if (memoState.has(digest)) return { decision: "allow", kind: "already-presented" };
    if (!memoState.record(digest)) return { decision: "allow", kind: "silent" };
    const seen = wasAlreadySeen(memoState, digest);
    return {
      decision: "deny",
      kind: "uncovered-writes",
      uncovered,
      reason: renderUncoveredReason(uncovered, covering, "enforce", seen)
    };
  } catch (err) {
    if (err instanceof GateScanError) {
      return { decision: "allow", kind: "scan-failed", reason: renderScanFailedReason(err.detail) };
    }
    return { decision: "allow", kind: "silent" };
  }
}
async function computeUncoveredPaths(paths, cwd, executors) {
  if (paths.length < 2) return { uncovered: [], covering: [] };
  const covering = await executors.list(paths, cwd);
  const covered = new Set(covering.map((row) => row.path));
  const repoRoot = resolveRepoRoot(cwd);
  const gateIgnoreRules = repoRoot ? loadGateIgnore(repoRoot) : [];
  const uncovered = paths.filter(
    (path) => !covered.has(path) && !isInsideSpanRoot(path) && !isGateIgnored(gateIgnoreRules, path)
  );
  return { uncovered, covering };
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
function wasAlreadySeen(memoState, digest) {
  const seenKey = `seen-${digest}`;
  const already = memoState.has(seenKey);
  memoState.record(seenKey);
  return already;
}
async function fetchSpanBlocks(executors, rows, cwd) {
  const names = [...new Set(rows.map((row) => row.name))].sort();
  try {
    return await executors.listBlocks(names, cwd);
  } catch {
    return "";
  }
}
function dedupeByAnchor(rows) {
  const order = [];
  const byAddr = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const addr = anchorText(row);
    let statuses = byAddr.get(addr);
    if (!statuses) {
      statuses = /* @__PURE__ */ new Set();
      byAddr.set(addr, statuses);
      order.push(addr);
    }
    statuses.add(row.status);
  }
  return order.map((addr) => ({ addr, statuses: [...byAddr.get(addr) ?? []].sort() }));
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
    for (const { addr, statuses } of dedupeByAnchor(pending)) {
      out.push(`- ${addr} \u2014 ${statuses.map(humanStatusLabel).join(", ")}`);
    }
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
        const exact = pending.filter((row) => anchorText(row) === addr);
        const matched = exact.length > 0 ? exact : pending.filter((row) => addr === row.path || addr.startsWith(`${row.path}#`));
        if (matched.length > 0) {
          const matchedSet = new Set(matched);
          pending = pending.filter((row) => !matchedSet.has(row));
          const statuses = [...new Set(matched.map((row) => row.status))].sort();
          out.push(`${line} \u2014 ${statuses.map(humanStatusLabel).join(", ")}`);
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
    for (const { addr, statuses } of dedupeByAnchor(group)) {
      out.push(`- ${addr} \u2014 ${statuses.map(humanStatusLabel).join(", ")}`);
    }
  }
  return out.join("\n");
}
function renderStalenessReason(findings, blocksText, mode = "enforce", alreadySeen = false) {
  const names = [...new Set(findings.map((row) => row.name))];
  const subject = names.length === 1 ? "an implicit dependency" : "implicit dependencies";
  const name = names.length === 1 ? names[0] : "<name>";
  const action = `\`git span add ${name} <path#Lstart-Lend>\` / \`git span why ${name} "..."\``;
  if (alreadySeen) {
    const paths = [...new Set(findings.map((row) => row.path))];
    const closing2 = mode === "enforce" ? `Already flagged above \u2014 update the drifted locations or the description, then retry.` : `Already flagged above \u2014 update the drifted locations or the description.`;
    return [`This change still leaves ${subject} out of date:`, ...paths.map((path) => `- ${path}`), "", closing2].join(
      "\n"
    );
  }
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
function wrapGitSpanContext(text) {
  if (text.includes("<git-span>")) return text;
  return `<git-span>
${text}
</git-span>`;
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
function groupCoveringByName(covering) {
  const byName = /* @__PURE__ */ new Map();
  for (const row of covering) {
    const anchors = byName.get(row.name) ?? /* @__PURE__ */ new Set();
    anchors.add(anchorText(row));
    byName.set(row.name, anchors);
  }
  return [...byName.keys()].sort().map((name) => ({ name, anchors: [...byName.get(name) ?? []].sort() }));
}
function renderRelatedSpansSection(covering) {
  if (covering.length === 0) return [];
  const lines = [
    "",
    "---",
    "",
    "Other files in this change already belong to spans \u2014 an uncovered file above might belong with one of these instead of a new one:"
  ];
  for (const { name, anchors } of groupCoveringByName(covering)) {
    lines.push("", `## ${name}`, ...anchors.map((anchor) => `- ${anchor}`));
  }
  return lines;
}
function renderUncoveredReason(uncovered, covering, mode = "enforce", alreadySeen = false) {
  const lines = uncovered.map((path) => `- ${path}`);
  if (alreadySeen) {
    const body2 = ["<git-span>", ...lines, "", "Already flagged for git-span review above."];
    body2.push(...renderRelatedSpansSection(covering));
    if (mode === "enforce") {
      body2.push("", "If none exist, retry the command to proceed (one-time check).");
    }
    body2.push("</git-span>");
    return body2.join("\n");
  }
  const body = [
    "<git-span>",
    ...lines,
    "",
    uncovered.length === 1 ? "Determine if this file carries implicit dependencies, then use `git span` to document them:" : "Determine if these files carry implicit dependencies, then use `git span` to document them:",
    "",
    "`git span add <name> <path#Lstart-Lend> [<path#Lstart-Lend>] ...`",
    '`git span why <name> "<why>"`',
    "",
    'The "<why>" is a single present-tense sentence naming what the ranges form together, specific enough to tell whether an edit lands inside it, with no rules or reminders.'
  ];
  body.push(...renderRelatedSpansSection(covering));
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
      } catch (err) {
        void err;
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
          return preToolUseOutput({
            additionalContext: wrapGitSpanContext(result.reason),
            systemMessage: result.reason
          });
        }
        if (result.kind === "semantic-staleness-info" || result.kind === "uncovered-writes-info") {
          return preToolUseOutput({
            additionalContext: wrapGitSpanContext(result.reason),
            systemMessage: result.reason
          });
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
      return preToolUseOutput({ additionalContext: wrapGitSpanContext(warning), systemMessage: warning });
    } catch (err) {
      ctx.logger.warn("git-span gate failed open on an uncaught error", { err });
      return void 0;
    }
  };
}
var gate_default = preToolUseHook({ matcher: "Bash|shell|exec|local_shell", timeout: 1e4 }, createHandler());

// src/codex/gate-entry.ts
execute(gate_default);
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2NvbnN0YW50cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2dhdGUtY29yZS50cyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL2dhdGUtaWdub3JlLnRzIiwgInNyYy9jb21tb24vc3Bhbi1pZ25vcmUudHMiLCAic3JjL2NvZGV4L2dhdGUudHMiLCAic3JjL2NvZGV4L2dhdGUtZW50cnkudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImV4cG9ydCBjb25zdCBQQUNLQUdFX05BTUUgPSBcIkBnb29kZm9vdC9jb2RleC1ob29rc1wiO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfVElNRU9VVF9NUyA9IDYwMF8wMDA7XG5leHBvcnQgY29uc3QgREVGQVVMVF9TVEFUVVNfTUVTU0FHRSA9IHVuZGVmaW5lZDtcbmV4cG9ydCBjb25zdCBERUZBVUxUX0VTQlVJTERfTE9BREVSUyA9IHtcbiAgICBcIi5tZFwiOiBcInRleHRcIixcbn07XG5leHBvcnQgY29uc3QgSE9PS19GQUNUT1JZX1RPX0VWRU5UID0ge1xuICAgIHByZVRvb2xVc2VIb29rOiBcIlByZVRvb2xVc2VcIixcbiAgICBwb3N0VG9vbFVzZUhvb2s6IFwiUG9zdFRvb2xVc2VcIixcbiAgICBwZXJtaXNzaW9uUmVxdWVzdEhvb2s6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICB1c2VyUHJvbXB0U3VibWl0SG9vazogXCJVc2VyUHJvbXB0U3VibWl0XCIsXG4gICAgc2Vzc2lvblN0YXJ0SG9vazogXCJTZXNzaW9uU3RhcnRcIixcbiAgICBzdWJhZ2VudFN0YXJ0SG9vazogXCJTdWJhZ2VudFN0YXJ0XCIsXG4gICAgc3RvcEhvb2s6IFwiU3RvcFwiLFxuICAgIHN1YmFnZW50U3RvcEhvb2s6IFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgcHJlQ29tcGFjdEhvb2s6IFwiUHJlQ29tcGFjdFwiLFxuICAgIHBvc3RDb21wYWN0SG9vazogXCJQb3N0Q29tcGFjdFwiLFxufTtcbmV4cG9ydCBjb25zdCBFVkVOVFNfV0lUSF9NQVRDSEVSID0gbmV3IFNldChbXG4gICAgXCJQcmVUb29sVXNlXCIsXG4gICAgXCJQb3N0VG9vbFVzZVwiLFxuICAgIFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICBcIlNlc3Npb25TdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgXCJQcmVDb21wYWN0XCIsXG4gICAgXCJQb3N0Q29tcGFjdFwiLFxuXSk7XG5leHBvcnQgY29uc3QgRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQgPSBuZXcgU2V0KFtcIlNlc3Npb25TdGFydFwiLCBcIlVzZXJQcm9tcHRTdWJtaXRcIiwgXCJTdWJhZ2VudFN0YXJ0XCJdKTtcbiIsICJmdW5jdGlvbiBhdHRhY2hNZXRhZGF0YShob29rRXZlbnROYW1lLCBjb25maWcsIGhhbmRsZXIpIHtcbiAgICBjb25zdCBob29rID0gaGFuZGxlcjtcbiAgICBob29rLmhvb2tFdmVudE5hbWUgPSBob29rRXZlbnROYW1lO1xuICAgIGhvb2sudGltZW91dCA9IGNvbmZpZy50aW1lb3V0O1xuICAgIGhvb2suc3RhdHVzTWVzc2FnZSA9IGNvbmZpZy5zdGF0dXNNZXNzYWdlO1xuICAgIGlmIChcIm1hdGNoZXJcIiBpbiBjb25maWcgJiYgdHlwZW9mIGNvbmZpZy5tYXRjaGVyID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGhvb2subWF0Y2hlciA9IGNvbmZpZy5tYXRjaGVyO1xuICAgIH1cbiAgICByZXR1cm4gaG9vaztcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQcmVUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBvc3RUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcGVybWlzc2lvblJlcXVlc3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gdXNlclByb21wdFN1Ym1pdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiVXNlclByb21wdFN1Ym1pdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25TdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU2Vzc2lvblN0YXJ0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3ViYWdlbnRTdGFydFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN0b3BcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN1YmFnZW50U3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlByZUNvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUG9zdENvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbiIsICJpbXBvcnQgeyBjbG9zZVN5bmMsIGV4aXN0c1N5bmMsIG1rZGlyU3luYywgb3BlblN5bmMsIHdyaXRlU3luYyB9IGZyb20gXCJub2RlOmZzXCI7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuY29uc3QgREVGQVVMVF9MT0dfRU5WX1ZBUiA9IFwiQ09ERVhfSE9PS1NfTE9HX0ZJTEVcIjtcbmV4cG9ydCBjbGFzcyBMb2dnZXIge1xuICAgIGhhbmRsZXJzID0gbmV3IE1hcCgpO1xuICAgIGZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIGxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgbG9nRmlsZVBhdGggPSBudWxsO1xuICAgIGN1cnJlbnRIb29rVHlwZTtcbiAgICBjdXJyZW50SW5wdXQ7XG4gICAgY29uc3RydWN0b3IoY29uZmlnID0ge30pIHtcbiAgICAgICAgdGhpcy5sb2dGaWxlUGF0aCA9IGNvbmZpZy5sb2dGaWxlUGF0aCA/PyBwcm9jZXNzLmVudltjb25maWcubG9nRW52VmFyID8/IERFRkFVTFRfTE9HX0VOVl9WQVJdID8/IG51bGw7XG4gICAgfVxuICAgIHNldENvbnRleHQoaG9va1R5cGUsIGlucHV0KSB7XG4gICAgICAgIHRoaXMuY3VycmVudEhvb2tUeXBlID0gaG9va1R5cGU7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gaW5wdXQ7XG4gICAgfVxuICAgIGNsZWFyQ29udGV4dCgpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50SG9va1R5cGUgPSB1bmRlZmluZWQ7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBvbihsZXZlbCwgaGFuZGxlcikge1xuICAgICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKSA/PyBuZXcgU2V0KCk7XG4gICAgICAgIGV4aXN0aW5nLmFkZChoYW5kbGVyKTtcbiAgICAgICAgdGhpcy5oYW5kbGVycy5zZXQobGV2ZWwsIGV4aXN0aW5nKTtcbiAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgIGV4aXN0aW5nLmRlbGV0ZShoYW5kbGVyKTtcbiAgICAgICAgICAgIGlmIChleGlzdGluZy5zaXplID09PSAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5oYW5kbGVycy5kZWxldGUobGV2ZWwpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgIH1cbiAgICBkZWJ1ZyhtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImRlYnVnXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICBpbmZvKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiaW5mb1wiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgd2FybihtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcIndhcm5cIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGVycm9yKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZXJyb3JcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGxvZ0Vycm9yKGVycm9yLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImVycm9yXCIsIGAke21lc3NhZ2V9OiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLCBjb250ZXh0KTtcbiAgICB9XG4gICAgY2xvc2UoKSB7XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgY2xvc2VTeW5jKHRoaXMubG9nRmlsZUZkKTtcbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cbiAgICBlbWl0KGxldmVsLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0ge1xuICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICBsZXZlbCxcbiAgICAgICAgICAgIGhvb2tUeXBlOiB0aGlzLmN1cnJlbnRIb29rVHlwZSxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICAuLi4odGhpcy5jdXJyZW50SW5wdXQgIT09IHVuZGVmaW5lZCA/IHsgaW5wdXQ6IHRoaXMuY3VycmVudElucHV0IH0gOiB7fSksXG4gICAgICAgICAgICAuLi4oY29udGV4dCAhPT0gdW5kZWZpbmVkID8geyBjb250ZXh0IH0gOiB7fSksXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMud3JpdGVUb0ZpbGUoZXZlbnQpO1xuICAgICAgICB0aGlzLmhhbmRsZXJzLmdldChsZXZlbCk/LmZvckVhY2goKGhhbmRsZXIpID0+IHtcbiAgICAgICAgICAgIGhhbmRsZXIoZXZlbnQpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgd3JpdGVUb0ZpbGUoZXZlbnQpIHtcbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZVBhdGggPT09IG51bGwpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXRoaXMuZmlsZUluaXRpYWxpemVkKSB7XG4gICAgICAgICAgICB0aGlzLmZpbGVJbml0aWFsaXplZCA9IHRydWU7XG4gICAgICAgICAgICBjb25zdCBsb2dEaXIgPSBkaXJuYW1lKHRoaXMubG9nRmlsZVBhdGgpO1xuICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKGxvZ0RpcikpIHtcbiAgICAgICAgICAgICAgICBta2RpclN5bmMobG9nRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gb3BlblN5bmModGhpcy5sb2dGaWxlUGF0aCwgXCJhXCIpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgd3JpdGVTeW5jKHRoaXMubG9nRmlsZUZkLCBgJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuYCk7XG4gICAgICAgIH1cbiAgICB9XG59XG5leHBvcnQgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcigpO1xuIiwgImV4cG9ydCBjb25zdCBFWElUX0NPREVTID0ge1xuICAgIFNVQ0NFU1M6IDAsXG4gICAgRVJST1I6IDEsXG4gICAgQkxPQ0s6IDIsXG59O1xuZXhwb3J0IGNsYXNzIEJsb2NrRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gICAgcmVhc29uO1xuICAgIGNvbnN0cnVjdG9yKHJlYXNvbikge1xuICAgICAgICBzdXBlcihyZWFzb24pO1xuICAgICAgICB0aGlzLm5hbWUgPSBcIkJsb2NrRXJyb3JcIjtcbiAgICAgICAgdGhpcy5yZWFzb24gPSByZWFzb247XG4gICAgfVxufVxuZnVuY3Rpb24gb21pdFVuZGVmaW5lZCh2YWx1ZSkge1xuICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModmFsdWUpLmZpbHRlcigoWywgZW50cnldKSA9PiBlbnRyeSAhPT0gdW5kZWZpbmVkKSk7XG59XG5mdW5jdGlvbiBidWlsZE91dHB1dCh0eXBlLCBzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiB7XG4gICAgICAgIF90eXBlOiB0eXBlLFxuICAgICAgICBzdGRvdXQ6IG9taXRVbmRlZmluZWQoc3Rkb3V0KSxcbiAgICAgICAgLi4uKHN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRlcnIgfSA6IHt9KSxcbiAgICB9O1xufVxuZXhwb3J0IGZ1bmN0aW9uIHJhd091dHB1dChzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlJhd1wiLCBzdGRvdXQsIHN0ZGVycik7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvbiAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy51cGRhdGVkSW5wdXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBoYXNTcGVjaWZpY1xuICAgICAgICA/IG9taXRVbmRlZmluZWQoe1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQcmVUb29sVXNlXCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvbjogb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb24sXG4gICAgICAgICAgICBwZXJtaXNzaW9uRGVjaXNpb25SZWFzb246IG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uLFxuICAgICAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgfSlcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlVG9vbFVzZVwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZUxlZ2FjeUJsb2NrT3V0cHV0KG9wdGlvbnMpIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVUb29sVXNlXCIsIHtcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fCBvcHRpb25zLnVwZGF0ZWRNQ1BUb29sT3V0cHV0ICE9PSB1bmRlZmluZWQ7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gaGFzU3BlY2lmaWNcbiAgICAgICAgPyBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUG9zdFRvb2xVc2VcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICAgICAgdXBkYXRlZE1DUFRvb2xPdXRwdXQ6IG9wdGlvbnMudXBkYXRlZE1DUFRvb2xPdXRwdXQsXG4gICAgICAgIH0pXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBvc3RUb29sVXNlXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uUmVxdWVzdE91dHB1dChvcHRpb25zKSB7XG4gICAgY29uc3QgZGVjaXNpb24gPSBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgYmVoYXZpb3I6IG9wdGlvbnMuYmVoYXZpb3IsXG4gICAgICAgIG1lc3NhZ2U6IG9wdGlvbnMubWVzc2FnZSxcbiAgICAgICAgaW50ZXJydXB0OiBvcHRpb25zLmludGVycnVwdCxcbiAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgdXBkYXRlZFBlcm1pc3Npb25zOiBvcHRpb25zLnVwZGF0ZWRQZXJtaXNzaW9ucyxcbiAgICB9KTtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSB7XG4gICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICAgICAgZGVjaXNpb24sXG4gICAgfTtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQZXJtaXNzaW9uUmVxdWVzdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiVXNlclByb21wdFN1Ym1pdFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiVXNlclByb21wdFN1Ym1pdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiU2Vzc2lvblN0YXJ0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTZXNzaW9uU3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlN1YmFnZW50U3RhcnRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3RvcE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTdG9wXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdG9wT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RvcFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlQ29tcGFjdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdENvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUG9zdENvbXBhY3RcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgIH0pO1xufVxuIiwgImltcG9ydCB7IEVWRU5UU19XSVRIX1RFWFRfT1VUUFVUIH0gZnJvbSBcIi4vY29uc3RhbnRzLmpzXCI7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tIFwiLi9sb2dnZXIuanNcIjtcbmltcG9ydCB7IEJsb2NrRXJyb3IsIEVYSVRfQ09ERVMsIHNlc3Npb25TdGFydE91dHB1dCwgc3ViYWdlbnRTdGFydE91dHB1dCwgdXNlclByb21wdFN1Ym1pdE91dHB1dCwgfSBmcm9tIFwiLi9vdXRwdXRzLmpzXCI7XG5hc3luYyBmdW5jdGlvbiByZWFkU3RkaW4oKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgY2h1bmtzID0gW107XG4gICAgICAgIHByb2Nlc3Muc3RkaW4uc2V0RW5jb2RpbmcoXCJ1dGYtOFwiKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImRhdGFcIiwgKGNodW5rKSA9PiBjaHVua3MucHVzaChjaHVuaykpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZW5kXCIsICgpID0+IHJlc29sdmUoY2h1bmtzLmpvaW4oXCJcIikpKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImVycm9yXCIsIHJlamVjdCk7XG4gICAgfSk7XG59XG5mdW5jdGlvbiBwYXJzZVN0ZGluSW5wdXQoc3RkaW5Db250ZW50KSB7XG4gICAgcmV0dXJuIEpTT04ucGFyc2Uoc3RkaW5Db250ZW50KTtcbn1cbmZ1bmN0aW9uIHdyaXRlU3Rkb3V0KG91dHB1dCkge1xuICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKEpTT04uc3RyaW5naWZ5KG91dHB1dC5zdGRvdXQpKTtcbn1cbmZ1bmN0aW9uIG5vcm1hbGl6ZVN0cmluZ091dHB1dChob29rRXZlbnROYW1lLCByZXN1bHQpIHtcbiAgICBpZiAoIUVWRU5UU19XSVRIX1RFWFRfT1VUUFVULmhhcyhob29rRXZlbnROYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7aG9va0V2ZW50TmFtZX0gaG9va3MgY2Fubm90IHJldHVybiBwbGFpbiB0ZXh0YCk7XG4gICAgfVxuICAgIGlmIChob29rRXZlbnROYW1lID09PSBcIlNlc3Npb25TdGFydFwiKSB7XG4gICAgICAgIHJldHVybiBzZXNzaW9uU3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICBpZiAoaG9va0V2ZW50TmFtZSA9PT0gXCJTdWJhZ2VudFN0YXJ0XCIpIHtcbiAgICAgICAgcmV0dXJuIHN1YmFnZW50U3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICByZXR1cm4gdXNlclByb21wdFN1Ym1pdE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gY29udmVydFRvSG9va091dHB1dChvdXRwdXQpIHtcbiAgICByZXR1cm4gb3V0cHV0LnN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQsIHN0ZGVycjogb3V0cHV0LnN0ZGVyciB9IDogeyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQgfTtcbn1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBleGVjdXRlKGhvb2tGbikge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHN0ZGluQ29udGVudCA9IGF3YWl0IHJlYWRTdGRpbigpO1xuICAgICAgICBjb25zdCBpbnB1dCA9IHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpO1xuICAgICAgICBsb2dnZXIuc2V0Q29udGV4dChob29rRm4uaG9va0V2ZW50TmFtZSwgaW5wdXQpO1xuICAgICAgICBjb25zdCBjb250ZXh0ID0geyBsb2dnZXIgfTtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaG9va0ZuKGlucHV0LCBjb250ZXh0KTtcbiAgICAgICAgbGV0IG91dHB1dCA9IHsgc3Rkb3V0OiB7fSB9O1xuICAgICAgICBpZiAodHlwZW9mIHJlc3VsdCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgb3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChub3JtYWxpemVTdHJpbmdPdXRwdXQoaG9va0ZuLmhvb2tFdmVudE5hbWUsIHJlc3VsdCkpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHJlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBvdXRwdXQgPSBjb252ZXJ0VG9Ib29rT3V0cHV0KHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgICAgd3JpdGVTdGRvdXQob3V0cHV0KTtcbiAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuU1VDQ0VTUyk7XG4gICAgfVxuICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBCbG9ja0Vycm9yKSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtlcnJvci5yZWFzb259XFxuYCk7XG4gICAgICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5CTE9DSyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke2Vycm9yLnN0YWNrID8/IGVycm9yLm1lc3NhZ2V9XFxuYCk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtTdHJpbmcoZXJyb3IpfVxcbmApO1xuICAgICAgICB9XG4gICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLkVSUk9SKTtcbiAgICB9XG4gICAgZmluYWxseSB7XG4gICAgICAgIGxvZ2dlci5jbGVhckNvbnRleHQoKTtcbiAgICAgICAgbG9nZ2VyLmNsb3NlKCk7XG4gICAgfVxufVxuIiwgIi8qKlxuICogSGFybmVzcy1hZ25vc3RpYyBnYXRlIGNvcmUgKFBoYXNlIDMuMSBcdTIwMTQgY29udHJhY3QgYW5kIHN0dWJzKS5cbiAqXG4gKiBUaGlzIG1vZHVsZSBkZWNsYXJlcyB0aGUgUHJlVG9vbFVzZSBcImdhdGVcIiB0aGF0IGJvdGggdGhlIENsYXVkZSAoYEJhc2hgKSBhbmRcbiAqIENvZGV4IChzaGVsbC9leGVjKSBhZGFwdGVycyB3aWxsIGRyaXZlOiB3aGVuIHRoZSBhZ2VudCBydW5zIGBnaXQgY29tbWl0YCBvclxuICogYGdpdCBwdXNoYCBhbmQgdGhlIGNoYW5nZXNldCBpdCBpcyBhYm91dCB0byBsYW5kIGNhcnJpZXMgcmVhbCBzcGFuIGRlYnQsIHRoZVxuICogY29tbWFuZCBpcyBoZWxkIHdpdGggYSBjaGVja2xpc3Q7IHBvc2l0aW9uYWwgZHJpZnQgdGhlIHRvdWNoIGhvb2sgaGFzIGJlZW5cbiAqIGhlYWxpbmcgYWxsIGFsb25nIG5ldmVyIGJsb2Nrcy4gTGlrZSB7QGxpbmsgZmlsZTovLy4vdG91Y2gtY29yZS50c30gaXQgaW1wb3J0c1xuICogbm90aGluZyBmcm9tIGVpdGhlciBob29rIFNESyBhbmQgaXMgdHlwZWQgc3RydWN0dXJhbGx5LCBwZXIgdGhlIGBjb21tb24vYFxuICogbGF5ZXIgY29udmVudGlvbjogYWRhcHRlcnMgdHJhbnNsYXRlIHRoZWlyIFNESy1zcGVjaWZpYyBob29rIGlucHV0IGludG8gYVxuICogY29tbWFuZCBzdHJpbmcgKyBjd2QsIGluamVjdCBleGVjdXRpb24vc3RhdGUgZGVwZW5kZW5jaWVzLCBhbmQgdHJhbnNsYXRlIHRoZVxuICogcmV0dXJuZWQge0BsaW5rIEdhdGVSZXN1bHR9IGludG8gdGhlaXIgb3duIGRlbnkvYWxsb3cgb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogZ2F0ZS1jb3JlIGlzIGEgc2libGluZyBvZiB0b3VjaC1jb3JlLCBub3QgYSBkZXBlbmRlbnQ6IHRoZSB0d28gY29yZXMgYXJlXG4gKiBpbmRlcGVuZGVudCBhbmQgdGhpcyBtb2R1bGUgaW1wb3J0cyBub3RoaW5nIGZyb20gYHRvdWNoLWNvcmUudHNgLlxuICpcbiAqIFJldXNlZCBmcm9tIHRoZSBzaGFyZWQga2VybmVsIChub3QgcmVkZWZpbmVkKTogYGlzRGVidCgpYCAodGhlIHNpbmdsZVxuICogc291cmNlIG9mIHRydXRoIGZvciB0aGUgc2VtYW50aWMtb25seSBkZWJ0IGludmFyaWFudCBcdTIwMTQgYE1PVkVEYCBhbmRcbiAqIGBSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgYXJlIG5ldmVyIGRlYnQpLCB0aGUgcG9yY2VsYWluIHN0YXR1cyB2b2NhYnVsYXJ5XG4gKiAoYFBvcmNlbGFpblN0YXR1c2AvYFBvcmNlbGFpblJvd2AvYFN0YWxlUG9yY2VsYWluUm93YCksIGFuZCBgZ2F0ZU1lbW9EaXIoKWBcbiAqICh0aGUgYDxnaXQtY29tbW9uLWRpcj4vZ2l0LXNwYW4vZ2F0ZS9gIHBhdGggdGhlIGRpc2stYmFja2VkXG4gKiB7QGxpbmsgR2F0ZU1lbW9TdGF0ZX0gd2lsbCBwZXJzaXN0IHVuZGVyKSBcdTIwMTQgYWxsIGZyb20gYWdlbnQtaG9va3MtY29tbW9uLnRzLlxuICpcbiAqIEV2ZXJ5IGZ1bmN0aW9uIHdob3NlIHJlc3VsdCBkZXBlbmRzIG9uIHJlYWwgbG9naWMgaXMgYSBgTm90IEltcGxlbWVudGVkYCBzdHViXG4gKiBpbiB0aGlzIHBoYXNlOyBQaGFzZSAzLjIgd3JpdGVzIHNraXBwZWQgY2hlY2tzIGFnYWluc3QgdGhlc2Ugc2lnbmF0dXJlcyBhbmRcbiAqIFBoYXNlIDMuMyBpbXBsZW1lbnRzIHRoZW0uXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tICdub2RlOmNyeXB0byc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQge1xuICBnYXRlTWVtb0RpcixcbiAgaHVtYW5TdGF0dXNMYWJlbCxcbiAgaXNEZWJ0LFxuICBpc0Vudmlyb25tZW50YWxTdGF0dXMsXG4gIGlzSW5zaWRlU3BhblJvb3QsXG4gIHR5cGUgUG9yY2VsYWluUm93LFxuICB0eXBlIFBvcmNlbGFpblN0YXR1cyxcbiAgcGFyc2VQb3JjZWxhaW4sXG4gIHBhcnNlU3RhbGVQb3JjZWxhaW4sXG4gIHJlc29sdmVSZXBvUm9vdCxcbiAgdHlwZSBTdGFsZVBvcmNlbGFpblJvdyxcbiAgdG9Qb3NpeFxufSBmcm9tICcuL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyBpc0dhdGVJZ25vcmVkLCBsb2FkR2F0ZUlnbm9yZSB9IGZyb20gJy4vZ2F0ZS1pZ25vcmUuanMnO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFNjYW4tZmFpbHVyZSBzaWduYWxcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJhaXNlZCBieSB0aGUgYHN0YWxlYCBleGVjdXRvciB3aGVuIGBnaXQgc3BhbiBzdGFsZWAgY291bGQgbm90ICpjb21wbGV0ZSogaXRzXG4gKiBzY29wZWQgc2NhbiBcdTIwMTQgYXMgb3Bwb3NlZCB0byBjb21wbGV0aW5nIGFuZCByZXBvcnRpbmcgZHJpZnQuIGBnaXQgc3BhbiBzdGFsZWBcbiAqIGV4aXRzIG5vbi16ZXJvIGluIHR3byB2ZXJ5IGRpZmZlcmVudCBzaXR1YXRpb25zOiBvbiBsZWdpdGltYXRlIGRyaWZ0IChyZWFsXG4gKiBwb3JjZWxhaW4gcm93cyBvbiBzdGRvdXQpIGFuZCBvbiBhIGhhcmQgc2NhbiBmYWlsdXJlIChlLmcuIGFuIHVucmVhZGFibGVcbiAqIGFuY2hvciBmaWxlIGFib3J0cyB0aGUgd2hvbGUgc2NvcGVkIHF1ZXJ5LCBsZWF2aW5nIHN0ZG91dCBlbXB0eSBhbmQgYW4gZXJyb3JcbiAqIG9uIHN0ZGVycikuIE9ubHkgdGhlIHNlY29uZCB0aHJvd3MgdGhpcywgc28ge0BsaW5rIGV2YWx1YXRlR2F0ZX0gY2FuIHRlbGwgYVxuICogc2NhbiB0aGF0ICpyYW4gY2xlYW4qIChlbXB0eSByb3dzKSBmcm9tIG9uZSB0aGF0ICpuZXZlciByYW4qIChlbXB0eSByb3dzXG4gKiBiZWNhdXNlIGl0IGFib3J0ZWQpIGFuZCByZWZ1c2UgdG8gcmVhZCB0aGUgbGF0dGVyIGFzIGEgY2xlYW4gcGFzcy4gYGRldGFpbGBcbiAqIGNhcnJpZXMgdGhlIENMSSdzIHN0ZGVyciBmb3IgdGhlIHN1cmZhY2VkIHJlYXNvbi5cbiAqL1xuZXhwb3J0IGNsYXNzIEdhdGVTY2FuRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIHJlYWRvbmx5IGRldGFpbDogc3RyaW5nO1xuICBjb25zdHJ1Y3RvcihkZXRhaWw6IHN0cmluZykge1xuICAgIHN1cGVyKGBnaXQgc3BhbiBzdGFsZSBjb3VsZCBub3QgY29tcGxldGUgaXRzIHNjYW46ICR7ZGV0YWlsfWApO1xuICAgIHRoaXMubmFtZSA9ICdHYXRlU2NhbkVycm9yJztcbiAgICB0aGlzLmRldGFpbCA9IGRldGFpbDtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENvbW1hbmQgcGFyc2luZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogVGhlIGtpbmQgb2YgZ2F0ZWQgZ2l0IGNvbW1hbmQgYSBzaGVsbCBjb21tYW5kIHN0cmluZyByZXNvbHZlcyB0by4gYCdub25lJ2BcbiAqIGlzIHRoZSBjb25zZXJ2YXRpdmUgZmFpbC1vcGVuIGFuc3dlcjogYW55IHNoYXBlIHtAbGluayBwYXJzZUdpdENvbW1hbmR9IGRvZXNcbiAqIG5vdCBjb25maWRlbnRseSByZWNvZ25pemUgYXMgYSBgZ2l0IGNvbW1pdGAvYGdpdCBwdXNoYC9gZ2l0IHN0YXR1c2AgbWFwcyB0b1xuICogYCdub25lJ2AgYW5kIHRoZSBnYXRlIGFsbG93cyB0aGUgY29tbWFuZCB0aHJvdWdoIHVudG91Y2hlZC4gYCdzdGF0dXMnYCBpc1xuICogbmV2ZXIgZGVuaWVkIFx1MjAxNCB7QGxpbmsgZXZhbHVhdGVHYXRlfSdzIGAnaW5mb3JtJ2AgbW9kZSBvbmx5IGV2ZXIgYWxsb3dzLFxuICogc3VyZmFjaW5nIGFueSBzcGFuIGRlYnQgYXMgYWR2aXNvcnkgY29udGV4dC5cbiAqL1xuZXhwb3J0IHR5cGUgR2l0Q29tbWFuZEtpbmQgPSAnY29tbWl0JyB8ICdwdXNoJyB8ICdzdGF0dXMnIHwgJ25vbmUnO1xuXG4vKipcbiAqIFRoZSByZXN1bHQgb2YgcGFyc2luZyBhIHNoZWxsIGNvbW1hbmQgc3RyaW5nIGZvciBhIGdhdGVkIGdpdCBpbnZvY2F0aW9uLlxuICpcbiAqIGBwYXRoc2AgY2FycmllcyBvbmx5IHdoYXQgaXMgcGFyc2VhYmxlIGZyb20gdGhlIGNvbW1hbmQgbGluZSBpdHNlbGYgXHUyMDE0IHRoZVxuICogZXhwbGljaXQgcGF0aHNwZWNzIGEgYGdpdCBjb21taXQgLS0gPHBhdGg+XHUyMDI2YCBmb3JtIG5hbWVzLiBJdCBpcyBkZWxpYmVyYXRlbHlcbiAqICpub3QqIHRoZSBjaGFuZ2VzZXQ6IHRoZSBmdWxsZXIgcmVzb2x1dGlvbiAoc3RhZ2VkIGZpbGVzLCB0aGUgYC1hYC9gLWFtYFxuICogZXhwYW5zaW9uIGFnYWluc3QgdHJhY2tlZC1tb2RpZmllZCBmaWxlcywgdGhlIG91dGdvaW5nIHB1c2ggcmFuZ2UpIGlzXG4gKiB7QGxpbmsgcmVzb2x2ZUNoYW5nZXNldH0ncyBqb2IsIGRyaXZlbiBmcm9tIHRoZSByZXBvIHN0YXRlLCBub3QgZnJvbSB0aGVcbiAqIGNvbW1hbmQgdGV4dC4gYHBhdGhzYCBpcyBvbWl0dGVkIHdoZW4gdGhlIGNvbW1hbmQgbmFtZXMgbm8gZXhwbGljaXRcbiAqIHBhdGhzcGVjLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFBhcnNlZEdpdENvbW1hbmQge1xuICBraW5kOiBHaXRDb21tYW5kS2luZDtcbiAgcGF0aHM/OiBzdHJpbmdbXTtcbn1cblxuLyoqXG4gKiBXb3JkLWJvdW5kYXJ5IHBhcnNlIG9mIGEgYGdpdCBjb21taXRgIC8gYGdpdCBwdXNoYCAvIGBnaXQgc3RhdHVzYCBpbnZvY2F0aW9uXG4gKiBlbWJlZGRlZCBpbiBhbiBhcmJpdHJhcnkgc2hlbGwgY29tbWFuZCBzdHJpbmcuXG4gKlxuICogTXVzdCByZWNvZ25pemUgdGhlIHJlYWwgc2hhcGVzIGNvbW1pdHMsIHB1c2hlcywgYW5kIHN0YXR1cyBjaGVja3MgYXJyaXZlIGluOlxuICogY2hhaW5lZCBjb21tYW5kcyAoYFx1MjAyNiAmJiBnaXQgY29tbWl0IFx1MjAyNmAsIGBcdTIwMjY7IGdpdCBwdXNoYCwgYFx1MjAyNiB8IFx1MjAyNmApLCBhbiBleHBsaWNpdFxuICogcmVwbyB2aWEgYGdpdCAtQyA8ZGlyPiBjb21taXQgXHUyMDI2YCwgdHJhaWxpbmcgcGF0aHNwZWNzIGFmdGVyIGAtLWAsIHRoZVxuICogYC1hYC9gLWFtYCBcImNvbW1pdCBhbGwgdHJhY2tlZC1tb2RpZmllZFwiIGZvcm1zLCBhbmQgaW52b2NhdGlvbiBmcm9tIGEgY3dkXG4gKiBiZWxvdyB0aGUgcmVwbyByb290LiBNYXRjaGluZyBpcyBvbiB3b3JkIGJvdW5kYXJpZXMsIG5ldmVyIHN1YnN0cmluZzogYSBwYXRoXG4gKiBvciBtZXNzYWdlIHRoYXQgbWVyZWx5IGNvbnRhaW5zIHRoZSB0ZXh0IGBnaXQgY29tbWl0YCBtdXN0IG5vdCB0cmlwIHRoZVxuICogZ2F0ZS5cbiAqXG4gKiBDb25zZXJ2YXRpdmUgYnkgY29udHJhY3Q6IHRoaXMgaXMgdGhlIGZhaWwtb3BlbiBwb2ludCBhdCB0aGUgcGFyc2UgbGF5ZXIsIG5vdFxuICogYSBwbGFjZSB0byBndWVzcy4gQW55IGNvbW1hbmQgd2hvc2Ugc2hhcGUgaXMgbm90IGNvbmZpZGVudGx5IGEgZ2F0ZWRcbiAqIGBnaXQgY29tbWl0YC9gZ2l0IHB1c2hgL2BnaXQgc3RhdHVzYCBcdTIwMTQgYW4gdW5mYW1pbGlhciBzdWJjb21tYW5kLCBhbiBhbGlhcywgYW5cbiAqIG9iZnVzY2F0ZWQgb3IgZHluYW1pY2FsbHktYnVpbHQgaW52b2NhdGlvbiBcdTIwMTQgcmV0dXJucyBgeyBraW5kOiAnbm9uZScgfWAgc28gdGhlXG4gKiBnYXRlIGFsbG93cyBpdCByYXRoZXIgdGhhbiBkZW55aW5nIG9uIGEgc2hha3kgcmVhZC4gKFNlZSBDQVJELm1kIFwiUmlza3MgYW5kXG4gKiByZXF1aXJlZCBzcGlrZXMgXHUyMTkyIENvbW1hbmQgcGFyc2luZ1wiIGFuZCBkZXNpZ24tZGVjaXNpb25zLm1kICMxLilcbiAqXG4gKiBAcGFyYW0gY29tbWFuZCBUaGUgcmF3IHNoZWxsIGNvbW1hbmQgc3RyaW5nIGZyb20gdGhlIGhvb2sncyB0b29sIGlucHV0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VHaXRDb21tYW5kKGNvbW1hbmQ6IHN0cmluZyk6IFBhcnNlZEdpdENvbW1hbmQge1xuICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc3BsaXRTZWdtZW50cyhjb21tYW5kKSkge1xuICAgIGNvbnN0IGludiA9IG1hdGNoR2l0SW52b2NhdGlvbih0b2tlbml6ZShzZWdtZW50KSk7XG4gICAgaWYgKCFpbnYpIGNvbnRpbnVlO1xuICAgIGlmIChpbnYuc3ViY29tbWFuZCA9PT0gJ2NvbW1pdCcpIHtcbiAgICAgIGNvbnN0IGRhc2hEYXNoID0gaW52LmFyZ3MuaW5kZXhPZignLS0nKTtcbiAgICAgIGNvbnN0IHBhdGhzID0gZGFzaERhc2ggPj0gMCA/IGludi5hcmdzLnNsaWNlKGRhc2hEYXNoICsgMSkuZmlsdGVyKChwKSA9PiBwLmxlbmd0aCA+IDApIDogW107XG4gICAgICByZXR1cm4gcGF0aHMubGVuZ3RoID4gMCA/IHsga2luZDogJ2NvbW1pdCcsIHBhdGhzIH0gOiB7IGtpbmQ6ICdjb21taXQnIH07XG4gICAgfVxuICAgIGlmIChpbnYuc3ViY29tbWFuZCA9PT0gJ3B1c2gnKSB7XG4gICAgICByZXR1cm4geyBraW5kOiAncHVzaCcgfTtcbiAgICB9XG4gICAgaWYgKGludi5zdWJjb21tYW5kID09PSAnc3RhdHVzJykge1xuICAgICAgcmV0dXJuIHsga2luZDogJ3N0YXR1cycgfTtcbiAgICB9XG4gICAgLy8gQSByZWNvZ25pemVkIGBnaXRgIGludm9jYXRpb24gdGhhdCBpcyBuZWl0aGVyIGNvbW1pdCwgcHVzaCwgbm9yIHN0YXR1c1xuICAgIC8vIChlLmcuIGBnaXQgYWRkIC4gJiYgZ2l0IGNvbW1pdCBcdTIwMjZgKToga2VlcCBzY2FubmluZyBsYXRlciBzZWdtZW50cy5cbiAgfVxuICByZXR1cm4geyBraW5kOiAnbm9uZScgfTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGEgYGdpdCBjb21taXRgIGluIHRoZSBjb21tYW5kIGlzIGFuIGAtYWAvYC1hbWAvYC0tYWxsYCBmb3JtIFx1MjAxNCB0aGVcbiAqIFwic3RhZ2UgYWxsIHRyYWNrZWQtbW9kaWZpZWQgZmlsZXNcIiB2YXJpYW50IHdob3NlIGNoYW5nZXNldCB7QGxpbmsgcmVzb2x2ZUNoYW5nZXNldH1cbiAqIG11c3Qgd2lkZW4gYmV5b25kIHRoZSBhbHJlYWR5LXN0YWdlZCBzZXQuXG4gKlxuICogVGhlIGBhbGxgIHNpZ25hbCBpcyBkZWxpYmVyYXRlbHkgKm5vdCogY2FycmllZCBvbiB7QGxpbmsgUGFyc2VkR2l0Q29tbWFuZH1cbiAqIChzZWUgdGhhdCB0eXBlJ3MgZG9jKTogdGhlIGFkYXB0ZXIgZGVyaXZlcyBpdCBoZXJlIGZyb20gdGhlIHNhbWUgY29tbWFuZCB0ZXh0XG4gKiBhbmQgdGhyZWFkcyBpdCBpbnRvIHtAbGluayByZXNvbHZlQ2hhbmdlc2V0fSBleHBsaWNpdGx5LiBDb25zZXJ2YXRpdmU6IG9ubHkgYVxuICogc2hvcnQtZmxhZyBncm91cCBjb250YWluaW5nIGBhYCAoYC1hYCwgYC1hbWAsIGAtbWFgKSBvciBhbiBleHBsaWNpdCBgLS1hbGxgLFxuICogc2Nhbm5lZCBiZWZvcmUgYW55IGAtLWAgcGF0aHNwZWMgc2VwYXJhdG9yLCBjb3VudHMuXG4gKlxuICogVmFsdWUtdGFraW5nIGNvbW1pdCBvcHRpb25zIChgLW1gLCBgLS1tZXNzYWdlYCwgYC1GYCwgYC1DYCwgXHUyMDI2KSBjb25zdW1lIHRoZWlyXG4gKiBmb2xsb3dpbmcgdG9rZW4sIHNvIGl0IGlzIG5ldmVyIHNjYW5uZWQgYXMgYSBmbGFnOiBhIG1lc3NhZ2Ugd29yZCBsaWtlXG4gKiBgLWFuYWx5c2lzYCBpbiBgZ2l0IGNvbW1pdCAtbSBcIi1hbmFseXNpc1wiYCBtdXN0IG5vdCBiZSBtaXNyZWFkIGFzIHRoZVxuICogYC0tYWxsYC1lcXVpdmFsZW50IHNob3J0LWZsYWcgY2x1c3RlciBhbmQgd2lkZW4gdGhlIGNoYW5nZXNldC5cbiAqL1xuY29uc3QgQ09NTUlUX1ZBTFVFX09QVElPTlMgPSBuZXcgU2V0KFtcbiAgJy1tJyxcbiAgJy0tbWVzc2FnZScsXG4gICctRicsXG4gICctLWZpbGUnLFxuICAnLUMnLFxuICAnLS1yZXVzZS1tZXNzYWdlJyxcbiAgJy1jJyxcbiAgJy0tcmVlZGl0LW1lc3NhZ2UnLFxuICAnLS1hdXRob3InLFxuICAnLS1kYXRlJyxcbiAgJy10JyxcbiAgJy0tdGVtcGxhdGUnLFxuICAnLS1maXh1cCcsXG4gICctLXNxdWFzaCcsXG4gICctLXRyYWlsZXInLFxuICAnLS1jbGVhbnVwJyxcbiAgJy0tZ3BnLXNpZ24nXG5dKTtcblxuZXhwb3J0IGZ1bmN0aW9uIGNvbW1pdFN0YWdlc0FsbChjb21tYW5kOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgZm9yIChjb25zdCBzZWdtZW50IG9mIHNwbGl0U2VnbWVudHMoY29tbWFuZCkpIHtcbiAgICBjb25zdCBpbnYgPSBtYXRjaEdpdEludm9jYXRpb24odG9rZW5pemUoc2VnbWVudCkpO1xuICAgIGlmICghaW52IHx8IGludi5zdWJjb21tYW5kICE9PSAnY29tbWl0JykgY29udGludWU7XG4gICAgY29uc3QgZGFzaERhc2ggPSBpbnYuYXJncy5pbmRleE9mKCctLScpO1xuICAgIGNvbnN0IGZsYWdBcmdzID0gZGFzaERhc2ggPj0gMCA/IGludi5hcmdzLnNsaWNlKDAsIGRhc2hEYXNoKSA6IGludi5hcmdzO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZmxhZ0FyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IGFyZyA9IGZsYWdBcmdzW2ldO1xuICAgICAgaWYgKGFyZyA9PT0gJy0tYWxsJykgcmV0dXJuIHRydWU7XG4gICAgICAvLyBBIHZhbHVlLXRha2luZyBvcHRpb24gY29uc3VtZXMgaXRzIGZvbGxvd2luZyB0b2tlbiBcdTIwMTQgc2tpcCB0aGF0IHRva2VuIHNvXG4gICAgICAvLyBhIG1lc3NhZ2UvYXV0aG9yL2RhdGUgYXJndW1lbnQgaXMgbmV2ZXIgc2Nhbm5lZCBhcyBhbiBgLWFgIGNsdXN0ZXIuXG4gICAgICBpZiAoQ09NTUlUX1ZBTFVFX09QVElPTlMuaGFzKGFyZykpIHtcbiAgICAgICAgaSsrO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmICghYXJnLnN0YXJ0c1dpdGgoJy0tJykgJiYgL14tW0EtWmEtel0qYVtBLVphLXpdKiQvLnRlc3QoYXJnKSkgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8vIFNoZWxsIGNvbnRyb2wgb3BlcmF0b3JzIHRoYXQgc2VwYXJhdGUgb25lIHNpbXBsZSBjb21tYW5kIGZyb20gdGhlIG5leHQuXG4vLyBTcGxpdHRpbmcgb24gdGhlc2UgKG91dHNpZGUgcXVvdGVzKSBpc29sYXRlcyBlYWNoIGNvbW1hbmQgc28gYSBgZ2l0IGNvbW1pdGAvXG4vLyBgZ2l0IHB1c2hgIGNoYWluZWQgYWZ0ZXIgYCYmYC9gO2AvYHxgIGlzIGZvdW5kLCB3aGlsZSB0ZXh0IGluc2lkZSBhIHF1b3RlZFxuLy8gYXJndW1lbnQgKGBlY2hvIFwiZ2l0IGNvbW1pdFwiYCkgc3RheXMgd2l0aGluIGl0cyBvd24gbm9uLWdpdCBzZWdtZW50LlxuY29uc3QgVFdPX0NIQVJfT1BFUkFUT1JTID0gbmV3IFNldChbJyYmJywgJ3x8J10pO1xuY29uc3QgT05FX0NIQVJfU0VQQVJBVE9SUyA9IG5ldyBTZXQoWyc7JywgJ3wnLCAnXFxuJywgJyYnLCAnKCcsICcpJ10pO1xuXG4vKiogU3BsaXQgYSBzaGVsbCBjb21tYW5kIGludG8gc2ltcGxlLWNvbW1hbmQgc2VnbWVudHMsIHJlc3BlY3RpbmcgcXVvdGVzLiAqL1xuZnVuY3Rpb24gc3BsaXRTZWdtZW50cyhjb21tYW5kOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHNlZ21lbnRzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgY3VycmVudCA9ICcnO1xuICBsZXQgcXVvdGU6ICdcIicgfCBcIidcIiB8IG51bGwgPSBudWxsO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGNvbW1hbmQubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjaCA9IGNvbW1hbmRbaV07XG4gICAgaWYgKHF1b3RlKSB7XG4gICAgICBjdXJyZW50ICs9IGNoO1xuICAgICAgaWYgKGNoID09PSBxdW90ZSkgcXVvdGUgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gJ1wiJyB8fCBjaCA9PT0gXCInXCIpIHtcbiAgICAgIHF1b3RlID0gY2g7XG4gICAgICBjdXJyZW50ICs9IGNoO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChUV09fQ0hBUl9PUEVSQVRPUlMuaGFzKGNvbW1hbmQuc2xpY2UoaSwgaSArIDIpKSkge1xuICAgICAgc2VnbWVudHMucHVzaChjdXJyZW50KTtcbiAgICAgIGN1cnJlbnQgPSAnJztcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoT05FX0NIQVJfU0VQQVJBVE9SUy5oYXMoY2gpKSB7XG4gICAgICBzZWdtZW50cy5wdXNoKGN1cnJlbnQpO1xuICAgICAgY3VycmVudCA9ICcnO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGN1cnJlbnQgKz0gY2g7XG4gIH1cbiAgc2VnbWVudHMucHVzaChjdXJyZW50KTtcbiAgcmV0dXJuIHNlZ21lbnRzO1xufVxuXG4vKipcbiAqIFRva2VuaXplIG9uZSBzZWdtZW50IGludG8gc2hlbGwgd29yZHMsIHJlc3BlY3Rpbmcgc2luZ2xlL2RvdWJsZSBxdW90ZXMgYW5kXG4gKiBzdHJpcHBpbmcgdGhlIHF1b3RlIGNoYXJhY3RlcnMuIERlbGliZXJhdGVseSBtaW5pbWFsIChubyBleHBhbnNpb24sIG5vXG4gKiBlc2NhcGUgaGFuZGxpbmcgYmV5b25kIHF1b3Rlcyk6IHRoZSBnb2FsIGlzIGNvbmZpZGVudCByZWNvZ25pdGlvbiBvZiBhXG4gKiBgZ2l0IGNvbW1pdGAvYHB1c2hgIHNoYXBlLCBub3QgYSBmdWxsIHNoZWxsIHBhcnNlci5cbiAqL1xuZnVuY3Rpb24gdG9rZW5pemUoc2VnbWVudDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCB0b2tlbnM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjdXJyZW50ID0gJyc7XG4gIGxldCBoYXMgPSBmYWxzZTtcbiAgbGV0IHF1b3RlOiAnXCInIHwgXCInXCIgfCBudWxsID0gbnVsbDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBzZWdtZW50Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgY2ggPSBzZWdtZW50W2ldO1xuICAgIGlmIChxdW90ZSkge1xuICAgICAgaWYgKGNoID09PSBxdW90ZSkgcXVvdGUgPSBudWxsO1xuICAgICAgZWxzZSBjdXJyZW50ICs9IGNoO1xuICAgICAgaGFzID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY2ggPT09ICdcIicgfHwgY2ggPT09IFwiJ1wiKSB7XG4gICAgICBxdW90ZSA9IGNoO1xuICAgICAgaGFzID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY2ggPT09ICcgJyB8fCBjaCA9PT0gJ1xcdCcpIHtcbiAgICAgIGlmIChoYXMpIHtcbiAgICAgICAgdG9rZW5zLnB1c2goY3VycmVudCk7XG4gICAgICAgIGN1cnJlbnQgPSAnJztcbiAgICAgICAgaGFzID0gZmFsc2U7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY3VycmVudCArPSBjaDtcbiAgICBoYXMgPSB0cnVlO1xuICB9XG4gIGlmIChoYXMpIHRva2Vucy5wdXNoKGN1cnJlbnQpO1xuICByZXR1cm4gdG9rZW5zO1xufVxuXG4vKiogR2l0IGdsb2JhbCBvcHRpb25zIHRoYXQgY29uc3VtZSBhIHNlcGFyYXRlIGZvbGxvd2luZyB2YWx1ZSB0b2tlbi4gKi9cbmNvbnN0IEdJVF9WQUxVRV9PUFRJT05TID0gbmV3IFNldChbXG4gICctQycsXG4gICctYycsXG4gICctLWdpdC1kaXInLFxuICAnLS13b3JrLXRyZWUnLFxuICAnLS1uYW1lc3BhY2UnLFxuICAnLS1zdXBlci1wcmVmaXgnLFxuICAnLS1leGVjLXBhdGgnLFxuICAnLS1hdHRyLXNvdXJjZScsXG4gICctLWNvbmZpZy1lbnYnXG5dKTtcblxuaW50ZXJmYWNlIEdpdEludm9jYXRpb24ge1xuICBzdWJjb21tYW5kOiBzdHJpbmc7XG4gIGFyZ3M6IHN0cmluZ1tdO1xufVxuXG4vKipcbiAqIElmIGEgc2VnbWVudCdzIHRva2VucyBhcmUgYSBgZ2l0IDxzdWJjb21tYW5kPiBcdTIwMjZgIGludm9jYXRpb24sIHJldHVybiB0aGVcbiAqIHN1YmNvbW1hbmQgYW5kIGl0cyByZW1haW5pbmcgYXJnczsgb3RoZXJ3aXNlIGBudWxsYC4gTGVhZGluZyBgVkFSPXZhbHVlYFxuICogZW52aXJvbm1lbnQgYXNzaWdubWVudHMgYW5kIGBnaXRgIGdsb2JhbCBvcHRpb25zIChpbmNsdWRpbmcgdGhlIHZhbHVlLXRha2luZ1xuICogb25lcykgYXJlIHNraXBwZWQgc28gdGhlIHN1YmNvbW1hbmQgaXMgY29ycmVjdGx5IGxvY2F0ZWQuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoR2l0SW52b2NhdGlvbih0b2tlbnM6IHN0cmluZ1tdKTogR2l0SW52b2NhdGlvbiB8IG51bGwge1xuICBsZXQgaSA9IDA7XG4gIHdoaWxlIChpIDwgdG9rZW5zLmxlbmd0aCAmJiAvXltBLVphLXpfXVtBLVphLXowLTlfXSo9Ly50ZXN0KHRva2Vuc1tpXSkpIGkrKztcbiAgaWYgKGkgPj0gdG9rZW5zLmxlbmd0aCB8fCB0b2tlbnNbaV0gIT09ICdnaXQnKSByZXR1cm4gbnVsbDtcbiAgaSsrO1xuICB3aGlsZSAoaSA8IHRva2Vucy5sZW5ndGgpIHtcbiAgICBjb25zdCB0ID0gdG9rZW5zW2ldO1xuICAgIGlmICh0ID09PSAnLS0nKSByZXR1cm4gbnVsbDsgLy8gYSBgLS1gIGJlZm9yZSBhbnkgc3ViY29tbWFuZCBpcyBub3QgYSBzaGFwZSB3ZSByZWNvZ25pemVcbiAgICBpZiAoIXQuc3RhcnRzV2l0aCgnLScpKSBicmVhaztcbiAgICBpICs9IEdJVF9WQUxVRV9PUFRJT05TLmhhcyh0KSA/IDIgOiAxO1xuICB9XG4gIGlmIChpID49IHRva2Vucy5sZW5ndGgpIHJldHVybiBudWxsO1xuICByZXR1cm4geyBzdWJjb21tYW5kOiB0b2tlbnNbaV0sIGFyZ3M6IHRva2Vucy5zbGljZShpICsgMSkgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBDaGFuZ2VzZXQgcmVzb2x1dGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogVGhlIGluamVjdGVkIGdpdCBzdXJmYWNlIHtAbGluayByZXNvbHZlQ2hhbmdlc2V0fSBuZWVkcyB0byB0dXJuIGEgcGFyc2VkXG4gKiBjb21tYW5kIGludG8gdGhlIGNvbmNyZXRlIGxpc3Qgb2YgcGF0aHMgdGhhdCB3b3VsZCBsYW5kLiBLZXB0IGFzIG5hcnJvdyBhc3luY1xuICogZnVuY3Rpb25zIChyYXRoZXIgdGhhbiBhIHJhdyBjb21tYW5kIHJ1bm5lcikgZm9sbG93aW5nIGB0b3VjaC1jb3JlLnRzYCdzXG4gKiBgVG91Y2hFeGVjdXRvcnNgIHBhdHRlcm4sIHNvIFBoYXNlIDMuMidzIHRlc3RzIGZha2UgdGhlIHJlcG8gc3RhdGUgd2l0aG91dCBhXG4gKiByZWFsIHN1YnByb2Nlc3MgYW5kIHRoZSBjb3JlIG5ldmVyIHNwYXducyBvbmUgaXRzZWxmLlxuICpcbiAqIEFsbCByZXR1cm5lZCBwYXRocyBhcmUgcmVwby1yZWxhdGl2ZSBQT1NJWCBwYXRocy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBHaXRFeGVjdXRvciB7XG4gIC8qKlxuICAgKiBQYXRocyBzdGFnZWQgZm9yIHRoZSBuZXh0IGNvbW1pdCBcdTIwMTQgYGdpdCBkaWZmIC0tY2FjaGVkIC0tbmFtZS1vbmx5YC4gVGhlc2VcbiAgICogYXJlIHdoYXQgYSBwbGFpbiBgZ2l0IGNvbW1pdGAgd291bGQgbGFuZC5cbiAgICovXG4gIHN0YWdlZFBhdGhzKGN3ZDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmdbXT47XG4gIC8qKlxuICAgKiBUcmFja2VkIGZpbGVzIHdpdGggdW5zdGFnZWQgd29ya2luZy10cmVlIG1vZGlmaWNhdGlvbnMgXHUyMDE0XG4gICAqIGBnaXQgZGlmZiAtLW5hbWUtb25seWAuIEZvbGRlZCBpbnRvIHRoZSBjaGFuZ2VzZXQgb25seSBmb3IgYC1hYC9gLWFtYFxuICAgKiBmb3Jtcywgd2hpY2ggc3RhZ2UgdHJhY2tlZC1tb2RpZmllZCBmaWxlcyBpbXBsaWNpdGx5IGF0IGNvbW1pdCB0aW1lLlxuICAgKi9cbiAgdHJhY2tlZE1vZGlmaWVkUGF0aHMoY3dkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZ1tdPjtcbiAgLyoqXG4gICAqIFBhdGhzIGluIHRoZSBvdXRnb2luZyBwdXNoIHJhbmdlIFx1MjAxNCB0aGUgZmlsZXMgY2hhbmdlZCBieSBgQHt1fS4uSEVBRGAsIHdpdGhcbiAgICogYSBtZXJnZS1iYXNlLWFnYWluc3QtdGhlLWRlZmF1bHQtcmVtb3RlLWJyYW5jaCBmYWxsYmFjayB3aGVuIG5vIHVwc3RyZWFtIGlzXG4gICAqIGNvbmZpZ3VyZWQuIFRoZXNlIGFyZSB3aGF0IGEgYGdpdCBwdXNoYCB3b3VsZCBwdWJsaXNoLlxuICAgKi9cbiAgb3V0Z29pbmdQYXRocyhjd2Q6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nW10+O1xuICAvKipcbiAgICogUGF0aHMgdW5kZXIgdGhlIGdpdmVuIGV4cGxpY2l0IHBhdGhzcGVjcyB3aG9zZSB3b3JraW5nLXRyZWUgY29udGVudCBkaWZmZXJzXG4gICAqIGZyb20gYEhFQURgIFx1MjAxNCBgZ2l0IGRpZmYgSEVBRCAtLW5hbWUtb25seSAtLSA8cGF0aHNwZWNzPmAuIFRoaXMgaXMgd2hhdCBhXG4gICAqIHBhdGhzcGVjLXNjb3BlZCBjb21taXQgKGBnaXQgY29tbWl0IC0tIDxwYXRoc3BlYz5cdTIwMjZgKSBhY3R1YWxseSBsYW5kczogdGhlXG4gICAqIGN1cnJlbnQgd29ya2luZy10cmVlIGNvbnRlbnQgYXQgdGhvc2UgcGF0aHNwZWNzLCByZWdhcmRsZXNzIG9mIHdoYXQgZWxzZSBpc1xuICAgKiBzdGFnZWQuIFVzZWQgdG8gc2NvcGUgdGhlIGNoYW5nZXNldCB3aGVuIHtAbGluayBQYXJzZWRHaXRDb21tYW5kLnBhdGhzfSBpc1xuICAgKiBwcmVzZW50LCBzbyB0aGUgZ2F0ZSBldmFsdWF0ZXMgZXhhY3RseSB0aGUgZmlsZXMgdGhpcyBjb21taXQgdGFrZXMgXHUyMDE0IG5ldmVyXG4gICAqIGFuIHVucmVsYXRlZCBzdGFnZWQgZmlsZSwgYW5kIG5ldmVyIG1pc3NpbmcgYSBtb2RpZmllZC1idXQtdW5zdGFnZWQgZmlsZVxuICAgKiBuYW1lZCBpbiB0aGUgcGF0aHNwZWMgKHdoaWNoIGBnaXQgZGlmZiAtLWNhY2hlZGAgd291bGQgbmV2ZXIgc3VyZmFjZSkuXG4gICAqL1xuICBwYXRoc3BlY1BhdGhzKHBhdGhzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZ1tdPjtcbn1cblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBjb25jcmV0ZSBsaXN0IG9mIHJlcG8tcmVsYXRpdmUgcGF0aHMgYSBnYXRlZCBjb21tYW5kIHdvdWxkIGxhbmQsXG4gKiBzbyB0aGUgZ2F0ZSBjYW4gc2NvcGUgaXRzIHN0YWxlbmVzcy9jb3ZlcmFnZSBjaGVjayB0byBleGFjdGx5IHRoYXQgY2hhbmdlc2V0LlxuICpcbiAqIC0gYGNvbW1pdGAgd2l0aCBleHBsaWNpdCBgcGF0aHNgIChhIGBnaXQgY29tbWl0IC0tIDxwYXRoc3BlYz5cdTIwMjZgIGZvcm0pOiBvbmx5XG4gKiAgIHRoZSB3b3JraW5nLXRyZWUgY29udGVudCB1bmRlciB0aG9zZSBwYXRoc3BlY3MgKGBwYXRoc3BlY1BhdGhzYCksIHNpbmNlIGFcbiAqICAgcGF0aHNwZWMtc2NvcGVkIGNvbW1pdCBsYW5kcyBleGFjdGx5IHRoYXQsIHJlZ2FyZGxlc3Mgb2YgdGhlIHJlc3Qgb2YgdGhlXG4gKiAgIHN0YWdlZCBzZXQuIGBhbGxgIGlzIGlnbm9yZWQgXHUyMDE0IGAtYWAgYW5kIGFuIGV4cGxpY2l0IHBhdGhzcGVjIGRvIG5vdCBjb21iaW5lLlxuICogLSBgY29tbWl0YCwgbm8gYHBhdGhzYDogdGhlIHN0YWdlZCBwYXRocywgcGx1cyBcdTIwMTQgd2hlbiBgYWxsYCBpcyB0cnVlICh0aGVcbiAqICAgY29tbWFuZCB3YXMgYW4gYC1hYC9gLWFtYCBmb3JtKSBcdTIwMTQgdGhlIHRyYWNrZWQtbW9kaWZpZWQgcGF0aHMgdGhvc2UgZm9ybXNcbiAqICAgc3RhZ2UgaW1wbGljaXRseS5cbiAqIC0gYHB1c2hgOiB0aGUgb3V0Z29pbmcgcmFuZ2UgYEB7dX0uLkhFQURgLCB3aXRoIGEgbWVyZ2UtYmFzZSBmYWxsYmFjayB3aGVuIG5vXG4gKiAgIHVwc3RyZWFtIGlzIGNvbmZpZ3VyZWQuIGBhbGxgL2BwYXRoc2AgYXJlIG5vdCBtZWFuaW5nZnVsIGZvciBhIHB1c2ggYW5kIGFyZVxuICogICBpZ25vcmVkLlxuICogLSBgc3RhdHVzYDogdGhlIHN0YWdlZCBwYXRocyBwbHVzIHRoZSB0cmFja2VkLW1vZGlmaWVkIHBhdGhzLCBkZWR1cGxpY2F0ZWQgXHUyMDE0XG4gKiAgIHRoZSBzYW1lIHdvcmtpbmctdHJlZSBwaWN0dXJlIGBnaXQgc3RhdHVzYCBpdHNlbGYgcHJpbnRzLCBwcmV2aWV3ZWQgZm9yXG4gKiAgIHNwYW4gZGVidC4gYGFsbGAvYHBhdGhzYCBhcmUgbm90IG1lYW5pbmdmdWwgZm9yIGEgc3RhdHVzIGNoZWNrIGFuZCBhcmVcbiAqICAgaWdub3JlZC5cbiAqXG4gKiBUaGUgYGFsbGAgZmxhZyBhbmQgYHBhdGhzYCBhcmUgdGhyZWFkZWQgaW4gZXhwbGljaXRseSAocmF0aGVyIHRoYW4gcmVhZCBiYWNrXG4gKiBvdXQgb2YgdGhlIGNvbW1hbmQpIGJlY2F1c2UgdGhlIGNhbGxlci9hZGFwdGVyIGRlcml2ZXMgdGhlbSBmcm9tIHRoZSBwYXJzZTpcbiAqIGBwYXRoc2AgaXMge0BsaW5rIFBhcnNlZEdpdENvbW1hbmQucGF0aHN9LCBhbmQgYGFsbGAgKHdoaWNoIHtAbGluayBQYXJzZWRHaXRDb21tYW5kfVxuICogaW50ZW50aW9uYWxseSBkb2VzIG5vdCBjYXJyeSkgY29tZXMgZnJvbSB7QGxpbmsgY29tbWl0U3RhZ2VzQWxsfS5cbiAqXG4gKiBAcGFyYW0ga2luZCBXaGV0aGVyIHRoZSBjaGFuZ2VzZXQgaXMgYSBjb21taXQncyBzdGFnZWQgc2V0LCBhIHB1c2gncyByYW5nZSwgb3IgYSBzdGF0dXMgcHJldmlldy5cbiAqIEBwYXJhbSBhbGwgV2hldGhlciB0aGUgY29tbWl0IHdhcyBhbiBgLWFgL2AtYW1gIGZvcm0gKGlnbm9yZWQgZm9yIGBwdXNoYC9gc3RhdHVzYCkuXG4gKiBAcGFyYW0gY3dkIFRoZSB3b3JraW5nIGRpcmVjdG9yeSB0aGUgZ2l0IGNvbW1hbmQgcmFuIGluLlxuICogQHBhcmFtIGdpdCBUaGUgaW5qZWN0ZWQgZ2l0IHN1cmZhY2UgYmFja2luZyB0aGUgcmVzb2x1dGlvbi5cbiAqIEBwYXJhbSBwYXRocyBFeHBsaWNpdCBwYXRoc3BlY3MgZnJvbSBgZ2l0IGNvbW1pdCAtLSA8cGF0aHNwZWM+XHUyMDI2YCwgaWYgYW55LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUNoYW5nZXNldChcbiAga2luZDogJ2NvbW1pdCcgfCAncHVzaCcgfCAnc3RhdHVzJyxcbiAgYWxsOiBib29sZWFuLFxuICBjd2Q6IHN0cmluZyxcbiAgZ2l0OiBHaXRFeGVjdXRvcixcbiAgcGF0aHM/OiBzdHJpbmdbXVxuKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICBpZiAoa2luZCA9PT0gJ3B1c2gnKSB7XG4gICAgcmV0dXJuIGdpdC5vdXRnb2luZ1BhdGhzKGN3ZCk7XG4gIH1cbiAgaWYgKGtpbmQgPT09ICdzdGF0dXMnKSB7XG4gICAgY29uc3QgW3N0YWdlZCwgdHJhY2tlZF0gPSBhd2FpdCBQcm9taXNlLmFsbChbZ2l0LnN0YWdlZFBhdGhzKGN3ZCksIGdpdC50cmFja2VkTW9kaWZpZWRQYXRocyhjd2QpXSk7XG4gICAgcmV0dXJuIG1lcmdlVW5pcXVlUGF0aHMoc3RhZ2VkLCB0cmFja2VkKTtcbiAgfVxuICAvLyBBIHBhdGhzcGVjLXNjb3BlZCBjb21taXQgbGFuZHMgb25seSB0aGUgd29ya2luZy10cmVlIGNvbnRlbnQgYXQgdGhvc2VcbiAgLy8gcGF0aHNwZWNzIFx1MjAxNCBzY29wZSB0aGUgY2hhbmdlc2V0IHRvIGV4YWN0bHkgdGhhdCwgbmV2ZXIgdGhlIGZ1bGwgc3RhZ2VkIHNldC5cbiAgaWYgKHBhdGhzICYmIHBhdGhzLmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4gZ2l0LnBhdGhzcGVjUGF0aHMocGF0aHMsIGN3ZCk7XG4gIH1cbiAgY29uc3Qgc3RhZ2VkID0gYXdhaXQgZ2l0LnN0YWdlZFBhdGhzKGN3ZCk7XG4gIGlmICghYWxsKSByZXR1cm4gc3RhZ2VkO1xuICBjb25zdCB0cmFja2VkID0gYXdhaXQgZ2l0LnRyYWNrZWRNb2RpZmllZFBhdGhzKGN3ZCk7XG4gIHJldHVybiBtZXJnZVVuaXF1ZVBhdGhzKHN0YWdlZCwgdHJhY2tlZCk7XG59XG5cbi8qKiBDb25jYXRlbmF0ZSBwYXRoIGxpc3RzIGluIG9yZGVyLCBkcm9wcGluZyBsYXRlciBkdXBsaWNhdGVzIG9mIGFuIGVhcmxpZXIgcGF0aC4gKi9cbmZ1bmN0aW9uIG1lcmdlVW5pcXVlUGF0aHMoLi4uZ3JvdXBzOiBzdHJpbmdbXVtdKTogc3RyaW5nW10ge1xuICBjb25zdCBzZWVuID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGNvbnN0IG1lcmdlZDogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBncm91cCBvZiBncm91cHMpIHtcbiAgICBmb3IgKGNvbnN0IHBhdGggb2YgZ3JvdXApIHtcbiAgICAgIGlmIChzZWVuLmhhcyhwYXRoKSkgY29udGludWU7XG4gICAgICBzZWVuLmFkZChwYXRoKTtcbiAgICAgIG1lcmdlZC5wdXNoKHBhdGgpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbWVyZ2VkO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEdhdGUgZXZhbHVhdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogVGhlIGluamVjdGVkIGV4ZWN1dGlvbiBzdXJmYWNlIGdhdGUgZXZhbHVhdGlvbiBuZWVkcyBcdTIwMTQgdGhlIGBmaXhgL2BzdGFsZWAvXG4gKiBgbGlzdGAgYXN5bmMgZnVuY3Rpb25zLCBtaXJyb3JpbmcgYHRvdWNoLWNvcmUudHNgJ3MgYFRvdWNoRXhlY3V0b3JzYC4gVGVzdHNcbiAqIGluamVjdCBmYWtlcyByZXR1cm5pbmcgc3RydWN0dXJlZCBkYXRhOyB0aGUgY29yZSBuZXZlciBzcGF3bnMgYSBzdWJwcm9jZXNzXG4gKiBpdHNlbGYuIEFsbCBwYXRocyBhcmUgcmVwby1yZWxhdGl2ZSBQT1NJWCBwYXRocy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBHYXRlRXhlY3V0b3JzIHtcbiAgLyoqXG4gICAqIFJ1biBhIHNjb3BlZCBgZ2l0IHNwYW4gc3RhbGUgPHBhdGhzPiAtLWZpeGAgXHUyMDE0IHRoZSBiZWx0LWFuZC1icmFjZXMgaGVhbCB0aGF0XG4gICAqIHJ1bnMgYmVmb3JlIGNsYXNzaWZpY2F0aW9uIChwZXIgQ0FSRC5tZCksIHJlLWFuY2hvcmluZyBhbnkgcG9zaXRpb25hbCBkcmlmdFxuICAgKiBpbiB0aGUgY2hhbmdlc2V0IHRoYXQgdGhlIHRvdWNoIGhvb2sgaGFzIG5vdCBhbHJlYWR5IGhlYWxlZC4gUmVwb3J0cyBub3RoaW5nO1xuICAgKiBpdHMgZWZmZWN0IGlzIG9uIHRoZSB3b3JraW5nIHRyZWUsIGFuZCB0aGUgc3Vic2VxdWVudCB7QGxpbmsgR2F0ZUV4ZWN1dG9ycy5zdGFsZX1cbiAgICogcmVhZCBvYnNlcnZlcyB0aGUgaGVhbGVkIHN0YXRlLlxuICAgKi9cbiAgZml4KHBhdGhzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+O1xuICAvKipcbiAgICogUnVuIGEgc2NvcGVkIGBnaXQgc3BhbiBzdGFsZSAtLWZvcm1hdCBwb3JjZWxhaW4gPHBhdGhzPmAgYW5kIHJldHVybiBpdHNcbiAgICogcGFyc2VkIHJvd3MgXHUyMDE0IG9uZSBwZXIgZHJpZnRlZCBhbmNob3IgYW1vbmcgdGhlIGNoYW5nZXNldCdzIHNwYW5zLCBlbXB0eSB3aGVuXG4gICAqIGNsZWFuLiBEZWJ0IGlzIGNsYXNzaWZpZWQgZnJvbSB0aGVzZSByb3dzIHZpYSBgaXNEZWJ0KClgOyBwb3NpdGlvbmFsXG4gICAqIChgTU9WRURgL2BSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGApIHJvd3MgYXJlIG5ldmVyIGRlYnQgYW5kIG5ldmVyIGRlbnkuXG4gICAqXG4gICAqIEFuIGVtcHR5IHJlc3VsdCBtdXN0IG1lYW4gdGhlIHNjYW4gKnJhbiBhbmQgZm91bmQgbm90aGluZyosIG5ldmVyIHRoYXQgdGhlXG4gICAqIHNjYW4gKmNvdWxkIG5vdCBydW4qLiBXaGVuIHRoZSBzY29wZWQgcXVlcnkgYWJvcnRzIGJlZm9yZSBjb21wbGV0aW5nIChlLmcuXG4gICAqIGFuIHVucmVhZGFibGUgYW5jaG9yIGZpbGUpLCB0aGUgaW1wbGVtZW50YXRpb24gdGhyb3dzIHtAbGluayBHYXRlU2NhbkVycm9yfVxuICAgKiByYXRoZXIgdGhhbiByZXR1cm5pbmcgYFtdYCwgc28ge0BsaW5rIGV2YWx1YXRlR2F0ZX0gZG9lcyBub3QgbWlzdGFrZSBhblxuICAgKiBhYm9ydGVkIHNjYW4gZm9yIGEgY2xlYW4gb25lIGFuZCBzaWxlbnRseSBhbGxvdyB1bnZlcmlmaWVkIGRlYnQgdGhyb3VnaC5cbiAgICovXG4gIHN0YWxlKHBhdGhzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpOiBQcm9taXNlPFN0YWxlUG9yY2VsYWluUm93W10+O1xuICAvKipcbiAgICogUnVuIGEgc2NvcGVkIGBnaXQgc3BhbiBsaXN0IC0tcG9yY2VsYWluIDxwYXRocz5gIGFuZCByZXR1cm4gdGhlIGNvdmVyaW5nXG4gICAqIGFuY2hvcnMuIFVzZWQgdG8gY29tcHV0ZSAqdW5jb3ZlcmVkIHdyaXRlcyo6IGEgY2hhbmdlZCBwYXRoIHdpdGggemVyb1xuICAgKiBjb3ZlcmluZyByb3dzIGhlcmUgKG1pbnVzIGAuc3Bhbi8qKmAsIGdpdGlnbm9yZWQgcGF0aHMsIGFuZFxuICAgKiBgLnNwYW4vLmdhdGVpZ25vcmVgLWV4Y2x1ZGVkIHBhdGhzIFx1MjAxNCBzZWUge0BsaW5rIGZpbGU6Ly8uL2dhdGUtaWdub3JlLnRzfSlcbiAgICogaXMgYW4gdW5jb3ZlcmVkIHdyaXRlLlxuICAgKi9cbiAgbGlzdChwYXRoczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKTogUHJvbWlzZTxQb3JjZWxhaW5Sb3dbXT47XG4gIC8qKlxuICAgKiBSdW4gYGdpdCBzcGFuIGxpc3QgPG5hbWVzLi4uPmAgKGh1bWFuIGZvcm1hdCkgYW5kIHJldHVybiBpdHMgcmF3IHN0ZG91dCBcdTIwMTRcbiAgICogb25lIGAjIyA8bmFtZT5gIGJsb2NrIHBlciBzcGFuIChhbmNob3IgYnVsbGV0cyArIGRlc2NyaXB0aW9uKSwgYmxvY2tzXG4gICAqIHNlcGFyYXRlZCBieSBgLS0tYC4gVGhlIGRlbnkvYWR2aXNvcnkgcmVuZGVyZXJzIGFubm90YXRlIHRoZXNlIGJsb2NrcyB3aXRoXG4gICAqIHBlci1hbmNob3IgZHJpZnQgbGFiZWxzIHNvIHRoZSBzdXJmYWNlZCBtZXNzYWdlIGNhcnJpZXMgdGhlIGZ1bGwgc3BhblxuICAgKiAoYWxsIGxvY2F0aW9ucyArIGRlc2NyaXB0aW9uKSwgbm90IGp1c3QgdGhlIGRyaWZ0ZWQgcm93cy4gUmV0dXJucyBgJydgIG9uXG4gICAqIGFueSBmYWlsdXJlOyB7QGxpbmsgYW5ub3RhdGVCbG9ja3N9IHRoZW4gc3ludGhlc2l6ZXMgbWluaW1hbCBibG9ja3MgZnJvbVxuICAgKiB0aGUgZmluZGluZ3MgdGhlbXNlbHZlcyBzbyBubyBmaW5kaW5nIGlzIGRyb3BwZWQuXG4gICAqL1xuICBsaXN0QmxvY2tzKG5hbWVzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz47XG59XG5cbi8qKlxuICogVGhlIGdhdGUncyBwZXItY2hhbmdlc2V0IG1lbW8gXHUyMDE0IFwiaGF2ZSBJIGFscmVhZHkgcHJlc2VudGVkIHRoaXMgZXhhY3QgZGVidFxuICogc3RhdGUgb25jZT9cIiBUaGUgcGVyc2lzdGVkIHVuaXQgaXMgYSBkaWdlc3Qgb2YgdGhlIHNvcnRlZCBzdGFsZW5lc3MgZmluZGluZ3NcbiAqIHBsdXMgdGhlIHNvcnRlZCB1bmNvdmVyZWQgcGF0aHMgKGRlc2lnbi1kZWNpc2lvbnMubWQgIzkncyBcImdhdGUgb25jZSBwZXJcbiAqIGRpc3RpbmN0IGRlYnQtc3RhdGVcIik7IHRoZSBkaXNrLWJhY2tlZCBpbXBsZW1lbnRhdGlvbiBzdG9yZXMgb25lIG1hcmtlciBwZXJcbiAqIGRpZ2VzdCB1bmRlciB7QGxpbmsgZ2F0ZU1lbW9EaXJ9IChgPGdpdC1jb21tb24tZGlyPi9naXQtc3Bhbi9nYXRlL2ApLCB3aGVyZVxuICogcHJlc2VuY2UgbWVhbnMgXCJhbHJlYWR5IHByZXNlbnRlZCBvbmNlLlwiIEluamVjdGVkIGFzIGEgc3RvcmUgYWJzdHJhY3Rpb25cbiAqIChsaWtlIHNwYW4tc3VyZmFjZS50cydzIGBNZW1vU3RvcmVgKSBzbyBQaGFzZSAzLjIgZmFrZXMgaXQgaW4gbWVtb3J5LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEdhdGVNZW1vU3RhdGUge1xuICAvKiogV2hldGhlciB0aGlzIGV4YWN0IGRlYnQtc3RhdGUgZGlnZXN0IGhhcyBhbHJlYWR5IGJlZW4gcHJlc2VudGVkIG9uY2UuICovXG4gIGhhcyhkaWdlc3Q6IHN0cmluZyk6IGJvb2xlYW47XG4gIC8qKlxuICAgKiBSZWNvcmQgdGhhdCB0aGlzIGRlYnQtc3RhdGUgZGlnZXN0IGhhcyBub3cgYmVlbiBwcmVzZW50ZWQsIHJldHVybmluZ1xuICAgKiB3aGV0aGVyIHRoZSByZWNvcmQgYWN0dWFsbHkgcGVyc2lzdGVkLiBgZmFsc2VgIG1lYW5zIHRoZSBtZW1vIGNvdWxkIG5vdCBiZVxuICAgKiB3cml0dGVuIChlLmcuIGFuIHVud3JpdGFibGUgbWVtbyBkaXJlY3RvcnkpIFx1MjAxNCB0aGUgZ2F0ZSB0cmVhdHMgdGhhdCBhcyBhXG4gICAqIGZhaWwtb3BlbiBzaWduYWwgcmF0aGVyIHRoYW4gZGVueWluZywgYmVjYXVzZSBhIG5vbi1wZXJzaXN0aW5nIG1lbW8gd291bGRcbiAgICogc2lsZW50bHkgdHVybiBcImRlbnkgb25jZSwgdGhlbiBhbGxvdyB0aGUgaWRlbnRpY2FsIHJldHJ5XCIgaW50byBcImRlbnkgZXZlcnlcbiAgICogdGltZVwiIHdpdGggbm8gZXNjYXBlLlxuICAgKi9cbiAgcmVjb3JkKGRpZ2VzdDogc3RyaW5nKTogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBUaGUgZ2F0ZSdzIGRlY2lzaW9uIGZvciBvbmUgY29tbWFuZCwgYXMgYSBkaXNjcmltaW5hdGVkIHVuaW9uIHRoZSBhZGFwdGVyXG4gKiB0cmFuc2xhdGVzIGludG8gYHBlcm1pc3Npb25EZWNpc2lvbjogJ2RlbnknYC9hbGxvdyAoQ2xhdWRlKSBvciBhIGJsb2NrL2FsbG93XG4gKiAoQ29kZXgpLiBgZGVjaXNpb25gIGlzIHRoZSBjb2Fyc2UgYWxsb3cvZGVueSB0aGUgaGFybmVzcyBhY3RzIG9uOyBga2luZGBcbiAqIHJlY29yZHMgKndoeSosIHNvIHRoZSBhZGFwdGVyIHJlbmRlcnMgdGhlIHJpZ2h0IG1lc3NhZ2UgYW5kIHNvIHRlc3RzIGFzc2VydFxuICogdGhlIGV4YWN0IGJyYW5jaC5cbiAqXG4gKiAtIGBhbGxvd2AgLyBgc2lsZW50YCBcdTIwMTQgbm90aGluZyB0byBjaGVjayAobm8gcGF0aHMpIG9yIHRoZSBjaGFuZ2VzZXQgaXMgY2xlYW47XG4gKiAgIGFsbG93IHdpdGggbm8gb3V0cHV0LiBJbnRlcm5hbCBlcnJvcnMgYW5kIHBhcnNlIGZhaWx1cmVzIGFsc28gcmVzb2x2ZSBoZXJlOlxuICogICB0aGUgZ2F0ZSBmYWlscyBvcGVuIGFuZCBtdXN0IG5ldmVyIGJyaWNrIGEgY29tbWl0LlxuICogLSBgYWxsb3dgIC8gYGFscmVhZHktcHJlc2VudGVkYCBcdTIwMTQgZGVidCBpcyBwcmVzZW50LCBidXQgdGhpcyBleGFjdCBkZWJ0IHN0YXRlXG4gKiAgIHdhcyBhbHJlYWR5IHByZXNlbnRlZCBvbmNlIChzZW1hbnRpYy1zdGFsZW5lc3Mgb3IgdW5jb3ZlcmVkLXdyaXRlc1xuICogICBjb25zaWRlci1vbmNlLCBvciBhbiB1bmNoYW5nZWQgc3RhdGUpLiBUaGUgY29tbWFuZCBwYXNzZXMuXG4gKiAtIGBhbGxvd2AgLyBgZW52aXJvbm1lbnRhbGAgXHUyMDE0IHRoZSBjaGFuZ2VzZXQncyBvbmx5IHN0YWxlbmVzcyByb3dzIGFyZVxuICogICB0ZXJtaW5hbC9lbnZpcm9ubWVudGFsIGNvbmRpdGlvbnMgKGBDT05GTElDVGAsIGBTVUJNT0RVTEVgLCBgTEZTXypgLFxuICogICBgUFJPTUlTT1JfTUlTU0lOR2AsIGBTUEFSU0VfRVhDTFVERURgLCBgRklMVEVSX0ZBSUxFRGAsIGBJT19FUlJPUmApIHRoZSBDTElcbiAqICAgY291bGQgbm90IHJlc29sdmUgYXQgYWxsIFx1MjAxNCBub3Qgc3BhbiBkcmlmdCBhIHVzZXIgY2FuIGZpeCBieSBlZGl0aW5nIGEgc3Bhbi5cbiAqICAgVGhlIGdhdGUgZmFpbHMgT1BFTiAoYWxsb3cpIGJ1dCBjYXJyaWVzIGBjb25kaXRpb25zYC9gcmVhc29uYCBzbyB0aGUgYWRhcHRlclxuICogICBzdXJmYWNlcyB0aGUgY29uZGl0aW9uIGluc3RlYWQgb2Ygc3dhbGxvd2luZyBpdC4gRGVueWluZyBoZXJlIHdvdWxkIHJlLWRlbnlcbiAqICAgZm9yZXZlciBvbiBhbiBpbmZyYSBmYWlsdXJlIHRoZSB1c2VyIGNhbm5vdCBjbGVhciBmcm9tIHRoZSBnYXRlLlxuICogLSBgYWxsb3dgIC8gYHNjYW4tZmFpbGVkYCBcdTIwMTQgYGdpdCBzcGFuIHN0YWxlYCBjb3VsZCBub3QgKmNvbXBsZXRlKiBpdHMgc2NvcGVkXG4gKiAgIHNjYW4gKGEge0BsaW5rIEdhdGVTY2FuRXJyb3J9LCBlLmcuIGFuIHVucmVhZGFibGUgYW5jaG9yIGZpbGUgYWJvcnRpbmcgdGhlXG4gKiAgIHdob2xlIHF1ZXJ5KS4gVGhpcyBpcyBkaXN0aW5jdCBmcm9tIGJvdGggYGVudmlyb25tZW50YWxgICh0aGUgc2NhbiBjb21wbGV0ZWRcbiAqICAgYW5kIGNhcnJpZWQgdGVybWluYWwgcm93cykgYW5kIGEgY2xlYW4gcGFzcyAodGhlIHNjYW4gY29tcGxldGVkIHdpdGggemVyb1xuICogICByb3dzKTogdGhlIHNjYW4gbmV2ZXIgcmFuIHRvIGNvbXBsZXRpb24sIHNvIGl0cyBlbXB0eSByZXN1bHQgaXMgbm90IGV2aWRlbmNlXG4gKiAgIG9mIFwibm8gZGVidC5cIiBUaGUgZ2F0ZSBmYWlscyBPUEVOIGhlcmUgdG9vIFx1MjAxNCBtYXRjaGluZyBgZW52aXJvbm1lbnRhbGAgXHUyMDE0XG4gKiAgIGJ1dCBrZWVwcyBpdHMgb3duIGBraW5kYCBhbmQgYSBgcmVhc29uYCBuYW1pbmcgdGhlIGZhaWx1cmUsIHNvIHRoZSBhZGFwdGVyXG4gKiAgIHN1cmZhY2VzIGEgd2FybmluZyB0aGF0IHNwYW4gZGVidCB3YXMgTk9UIHZlcmlmaWVkIGZvciB0aGlzIGNoYW5nZXNldFxuICogICBpbnN0ZWFkIG9mIHN0YXlpbmcgc2lsZW50LiBUaGVyZSBpcyBubyBkZWJ0LXN0YXRlIHRvIG1lbW9pemU6IGV2ZXJ5XG4gKiAgIGV2YWx1YXRpb24gb2YgYSBzdGlsbC1mYWlsaW5nIHNjYW4gd2FybnMgYWdhaW4uXG4gKiAtIGBkZW55YCAvIGBzZW1hbnRpYy1zdGFsZW5lc3NgIFx1MjAxNCB0aGUgY2hhbmdlc2V0IGNhcnJpZXMgc2VtYW50aWMgc3RhbGVuZXNzLFxuICogICBhbmQgdGhpcyBleGFjdCBmaW5kaW5ncyBkaWdlc3QgaGFzIG5vdCBiZWVuIHByZXNlbnRlZCBiZWZvcmUuIERlbnlcbiAqICAgKipvbmNlKiosIGxpc3RpbmcgYGZpbmRpbmdzYCBhcyBhIGNoZWNrbGlzdCBpbiBgcmVhc29uYDsgYW4gaWRlbnRpY2FsXG4gKiAgIHJldHJ5ICh1bmNoYW5nZWQgZmluZGluZ3MpIGZhbGxzIHRocm91Z2ggdG8gdGhlIGVudmlyb25tZW50YWwgYW5kXG4gKiAgIHVuY292ZXJlZCBjaGVja3MgYW5kIHJlc29sdmVzIHRvIGBhbHJlYWR5LXByZXNlbnRlZGAgd2hlbiBvdGhlcndpc2VcbiAqICAgY2xlYW4uIENoYW5nZWQgZmluZGluZ3MgKGEgbmV3IGRpZ2VzdCkgZGVueSBmcmVzaCAoY29uc2lkZXItb25jZSBwZXJcbiAqICAgZGlzdGluY3QgZGVidCBzdGF0ZSwgcGVyIGRlc2lnbi1kZWNpc2lvbnMubWQgIzEpLlxuICogLSBgZGVueWAgLyBgdW5jb3ZlcmVkLXdyaXRlc2AgXHUyMDE0IHRoZSBjaGFuZ2VzZXQgaGFzIGNoYW5nZWQgZmlsZXMgbm8gc3BhblxuICogICBjb3ZlcnMsIGFuZCB0aGlzIHN0YXRlIGhhcyBub3QgYmVlbiBwcmVzZW50ZWQgYmVmb3JlLiBEZW55ICoqb25jZSoqLCBsaXN0aW5nXG4gKiAgIGB1bmNvdmVyZWRgOyB0aGUgcmV0cnkgd2l0aCBhbiB1bmNoYW5nZWQgc3RhdGUgcmVzb2x2ZXMgdG8gYGFscmVhZHktcHJlc2VudGVkYFxuICogICBhbmQgcGFzc2VzIChjb25zaWRlci1vbmNlLCBwZXIgZGVzaWduLWRlY2lzaW9ucy5tZCAjMykuXG4gKiAtIGBhbGxvd2AgLyBgc2VtYW50aWMtc3RhbGVuZXNzLWluZm9gLCBgYWxsb3dgIC8gYHVuY292ZXJlZC13cml0ZXMtaW5mb2AgXHUyMDE0XG4gKiAgIGAnaW5mb3JtJ2AtbW9kZS1vbmx5IGNvdW50ZXJwYXJ0cyBvZiB0aGUgdHdvIGBkZW55YCBraW5kcyBhYm92ZTogc2FtZVxuICogICBgZmluZGluZ3NgL2B1bmNvdmVyZWRgL2ByZWFzb25gIHBheWxvYWQsIGJ1dCBuZXZlciBkZW5pZXMgYW5kIG5ldmVyXG4gKiAgIGNvbnN1bHRzIG9yIHdyaXRlcyBgbWVtb1N0YXRlYCAoYSBgZ2l0IHN0YXR1c2AgcHJldmlldyBpcyBub3QgYSBkZWJ0IHN0YXRlXG4gKiAgIHRvIGhvbGQgb3IgY29uc2lkZXItb25jZSBcdTIwMTQgaXQgcmUtcmVwb3J0cyB0aGUgc2FtZSBsaXZlIGRlYnQgb24gZXZlcnkgY2FsbCxcbiAqICAgZXhhY3RseSBsaWtlIGBnaXQgc3RhdHVzYCBpdHNlbGYgZG9lcyBmb3IgdGhlIHdvcmtpbmcgdHJlZSkuXG4gKi9cbmV4cG9ydCB0eXBlIEdhdGVSZXN1bHQgPVxuICB8IHsgZGVjaXNpb246ICdhbGxvdyc7IGtpbmQ6ICdzaWxlbnQnIH1cbiAgfCB7IGRlY2lzaW9uOiAnYWxsb3cnOyBraW5kOiAnYWxyZWFkeS1wcmVzZW50ZWQnIH1cbiAgfCB7IGRlY2lzaW9uOiAnYWxsb3cnOyBraW5kOiAnZW52aXJvbm1lbnRhbCc7IGNvbmRpdGlvbnM6IFN0YWxlUG9yY2VsYWluUm93W107IHJlYXNvbjogc3RyaW5nIH1cbiAgfCB7IGRlY2lzaW9uOiAnYWxsb3cnOyBraW5kOiAnc2Nhbi1mYWlsZWQnOyByZWFzb246IHN0cmluZyB9XG4gIHwgeyBkZWNpc2lvbjogJ2FsbG93Jzsga2luZDogJ3NlbWFudGljLXN0YWxlbmVzcy1pbmZvJzsgZmluZGluZ3M6IFN0YWxlUG9yY2VsYWluUm93W107IHJlYXNvbjogc3RyaW5nIH1cbiAgfCB7IGRlY2lzaW9uOiAnYWxsb3cnOyBraW5kOiAndW5jb3ZlcmVkLXdyaXRlcy1pbmZvJzsgdW5jb3ZlcmVkOiBzdHJpbmdbXTsgcmVhc29uOiBzdHJpbmcgfVxuICB8IHsgZGVjaXNpb246ICdkZW55Jzsga2luZDogJ3NlbWFudGljLXN0YWxlbmVzcyc7IGZpbmRpbmdzOiBTdGFsZVBvcmNlbGFpblJvd1tdOyByZWFzb246IHN0cmluZyB9XG4gIHwgeyBkZWNpc2lvbjogJ2RlbnknOyBraW5kOiAndW5jb3ZlcmVkLXdyaXRlcyc7IHVuY292ZXJlZDogc3RyaW5nW107IHJlYXNvbjogc3RyaW5nIH07XG5cbi8qKlxuICogV2hldGhlciB7QGxpbmsgZXZhbHVhdGVHYXRlfSBtYXkgaG9sZCB0aGUgY29tbWFuZCAoYCdlbmZvcmNlJ2AsIHRoZSBkZWZhdWx0IFx1MjAxNFxuICogdXNlZCBmb3IgYGNvbW1pdGAvYHB1c2hgKSBvciBtdXN0IG9ubHkgZXZlciBhZHZpc2UgKGAnaW5mb3JtJ2AgXHUyMDE0IHVzZWQgZm9yXG4gKiBgc3RhdHVzYCk6IGV2ZXJ5IGJyYW5jaCB0aGF0IHdvdWxkIG90aGVyd2lzZSBgZGVueWAgcmV0dXJucyBpdHMgYC1pbmZvYFxuICogYGFsbG93YCBjb3VudGVycGFydCBpbnN0ZWFkLCBhbmQgYG1lbW9TdGF0ZWAgaXMgbmV2ZXIgcmVhZCBvciB3cml0dGVuLCBzaW5jZVxuICogYW4gaW5mb3JtYXRpb25hbCBwcmV2aWV3IG11c3Qgbm90IHNwZW5kIChvciBiZSBibG9ja2VkIGJ5KSB0aGUgY29uc2lkZXItb25jZVxuICogY3JlZGl0IGEgcmVhbCBgY29tbWl0YC9gcHVzaGAgcmVsaWVzIG9uLlxuICovXG5leHBvcnQgdHlwZSBHYXRlTW9kZSA9ICdlbmZvcmNlJyB8ICdpbmZvcm0nO1xuXG4vKipcbiAqIEV2YWx1YXRlIHRoZSBnYXRlIGZvciBhIHJlc29sdmVkIGNoYW5nZXNldCBhbmQgZGVjaWRlIHdoZXRoZXIgdG8gaG9sZCB0aGVcbiAqIGNvbW1hbmQuXG4gKlxuICogUnVucyBgZXhlY3V0b3JzLmZpeGAgKHNjb3BlZCBiZWx0LWFuZC1icmFjZXMgYHN0YWxlIC0tZml4YCksIHRoZW4gcmVhZHNcbiAqIGBleGVjdXRvcnMuc3RhbGVgIGFuZCBjbGFzc2lmaWVzIGVhY2ggZGVidCByb3cgKGBpc0RlYnQoKWApIGludG8gKnNlbWFudGljKlxuICogZHJpZnQgYW5kICplbnZpcm9ubWVudGFsKiBjb25kaXRpb25zIChgaXNFbnZpcm9ubWVudGFsU3RhdHVzKClgKS5cbiAqXG4gKiBTZW1hbnRpYyBkcmlmdCAoYENIQU5HRURgL2BERUxFVEVEYCkgaXMgY2hlY2tlZCBhZ2FpbnN0IGBtZW1vU3RhdGVgIHZpYSBpdHNcbiAqIG93biBkaWdlc3QgKGBnYXRlU3RhdGVEaWdlc3Qoc2VtYW50aWMsIFtdKWApLCB0aGUgc2FtZSBkaXN0aW5jdC1kZWJ0LXN0YXRlXG4gKiBtZW1vIHRoZSB1bmNvdmVyZWQtd3JpdGVzIGNoZWNrIGFscmVhZHkgdXNlczogbm90IHlldCBwcmVzZW50ZWQgXHUyMTkyIHJlY29yZCBpdFxuICogYW5kIGBkZW55YC9gc2VtYW50aWMtc3RhbGVuZXNzYCAoYSBgbWVtb1N0YXRlLnJlY29yZGAgZmFpbHVyZSBmYWlscyBvcGVuIHRvXG4gKiBgYWxsb3dgL2BzaWxlbnRgLCBzaW5jZSBhIG5vbi1wZXJzaXN0aW5nIG1lbW8gd291bGQgcmUtZGVueSB0aGUgaWRlbnRpY2FsXG4gKiByZXRyeSBmb3JldmVyKTsgYWxyZWFkeSBwcmVzZW50ZWQgXHUyMTkyICoqZmFsbCB0aHJvdWdoKiogcmF0aGVyIHRoYW4gcmV0dXJuaW5nLFxuICogc28gYSByZXRyeSBzdGlsbCBzdXJmYWNlcyBlbnZpcm9ubWVudGFsIGFkdmlzb3JpZXMgYW5kIHN0aWxsIHJ1bnMgdGhlXG4gKiB1bmNvdmVyZWQgY2hlY2suIFdoZXRoZXIgdGhlIHNlbWFudGljIHN0YXRlIHdhcyBhbHJlYWR5IHByZXNlbnRlZCBpc1xuICogdHJhY2tlZCBzbyB0aGF0LCBpZiB0aGUgZXZhbHVhdGlvbiB0aGVuIGVuZHMgY2xlYW4sIGl0IHJlc29sdmVzIHRvXG4gKiBgYWxsb3dgL2BhbHJlYWR5LXByZXNlbnRlZGAgcmF0aGVyIHRoYW4gYSBiYXJlIGBhbGxvd2AvYHNpbGVudGAgXHUyMDE0IG1pcnJvcmluZ1xuICogdGhlIHVuY292ZXJlZCBicmFuY2gncyBvd24gbWVtby1oaXQgcmVzdWx0LiBBIGNoYW5nZXNldCBjYXJyeWluZyBib3RoXG4gKiB1bnByZXNlbnRlZCBzZW1hbnRpYyBzdGFsZW5lc3MgYW5kIHVucHJlc2VudGVkIHVuY292ZXJlZCB3cml0ZXMgdGhlcmVmb3JlXG4gKiBkZW5pZXMgdHdpY2UgKHN0YWxlbmVzcyBmaXJzdCwgdW5jb3ZlcmVkIG9uIHRoZSByZXRyeSkgYmVmb3JlIGEgdGhpcmRcbiAqIGF0dGVtcHQgcGFzc2VzOyBlZGl0aW5nIG9uZSBzdGFsZSBzcGFuIHdoaWxlIGFub3RoZXIgcmVtYWlucyBzdGFsZSBwcm9kdWNlc1xuICogYSBuZXcgZmluZGluZ3Mgc2V0LCBoZW5jZSBhIG5ldyBkaWdlc3QgYW5kIG9uZSBmcmVzaCBkZW55LiBEaWdlc3QgY29sbGlzaW9uXG4gKiBiZXR3ZWVuIHRoZSB0d28gY2F0ZWdvcmllcyBpcyBpbXBvc3NpYmxlOiB0aGUgcGF5bG9hZCBpc1xuICogYEpTT04uc3RyaW5naWZ5KHtmaW5kaW5ncywgdW5jb3ZlcmVkfSlgLCBhbmQgdGhlIHNlbWFudGljIGRpZ2VzdCBwb3B1bGF0ZXNcbiAqIGBmaW5kaW5nc2Agd2hpbGUgdGhlIHVuY292ZXJlZCBkaWdlc3QgcG9wdWxhdGVzIGB1bmNvdmVyZWRgLlxuICpcbiAqIEVudmlyb25tZW50YWwgY29uZGl0aW9ucyB0aGUgQ0xJIGNvdWxkIG5vdCByZXNvbHZlIGF0IGFsbFxuICogKGBDT05GTElDVGAvYFNVQk1PRFVMRWAvYExGU18qYC9gUFJPTUlTT1JfTUlTU0lOR2AvYFNQQVJTRV9FWENMVURFRGAvXG4gKiBgRklMVEVSX0ZBSUxFRGAvYElPX0VSUk9SYCkgXHUyMTkyIGBhbGxvd2AvYGVudmlyb25tZW50YWxgOiBmYWlsIE9QRU4sIHN1cmZhY2luZyB0aGVcbiAqIGNvbmRpdGlvbiByYXRoZXIgdGhhbiBkZW55aW5nIG9uIGFuIGluZnJhIGZhaWx1cmUgYSBzcGFuIGVkaXQgY2Fubm90IGZpeC5cbiAqIFVuY292ZXJlZCB3cml0ZXMgKGNoYW5nZWQgcGF0aHMgd2l0aCB6ZXJvIGNvdmVyYWdlIGZyb20gYGV4ZWN1dG9ycy5saXN0YCxcbiAqIG1pbnVzIGAuc3Bhbi8qKmAsIGFuZCBwYXRocyBtYXRjaGVkIGJ5IHRoZSByZXBvJ3MgYC5zcGFuLy5nYXRlaWdub3JlYCBcdTIwMTQgc2VlXG4gKiB7QGxpbmsgZmlsZTovLy4vZ2F0ZS1pZ25vcmUudHN9LCBsb2FkZWQgZGlyZWN0bHkgZnJvbSBkaXNrIHZpYVxuICogYHJlc29sdmVSZXBvUm9vdChjd2QpYCwgZmFpbC1vcGVuIHdoZW4gYWJzZW50L3VucmVhZGFibGUpIFx1MjE5MlxuICogYGRlbnlgL2B1bmNvdmVyZWQtd3JpdGVzYCB0aGUgZmlyc3QgdGltZSB0aGF0IHN0YXRlIGlzIHNlZW4sIHRoZW5cbiAqIGBhbGxvd2AvYGFscmVhZHktcHJlc2VudGVkYCBvbiByZXRyeS4gYE1PVkVEYCBhbmQgYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYFxuICogbmV2ZXIgY29udHJpYnV0ZSB0byBhbnkgYnJhbmNoIGFuZCBuZXZlciBkZW55LiBBbnkgaW50ZXJuYWwgZXJyb3IgcmVzb2x2ZXNcbiAqIHRvIGBhbGxvd2AvYHNpbGVudGAgXHUyMDE0IHRoZSBnYXRlIGZhaWxzIG9wZW4gYW5kIG5ldmVyIGJyaWNrcyBhIGNvbW1pdC5cbiAqXG4gKiBBIHtAbGluayBHYXRlU2NhbkVycm9yfSBmcm9tIGBleGVjdXRvcnMuc3RhbGVgIGlzIHRoZSBvbmUgY2FzZSBoYW5kbGVkXG4gKiBvdXRzaWRlIHRoYXQgZmxvdzogYSBzY2FuIHRoYXQgKmNvdWxkIG5vdCBjb21wbGV0ZSogKGUuZy4gYW4gdW5yZWFkYWJsZVxuICogYW5jaG9yIGZpbGUgYWJvcnRzIHRoZSBzY29wZWQgcXVlcnkpIHlpZWxkcyBhbiBlbXB0eSByZXN1bHQgdGhhdCBpcyBOT1RcbiAqIGV2aWRlbmNlIG9mIGEgY2xlYW4gY2hhbmdlc2V0LiBSZWFkaW5nIHRoYXQgYXMgYGFsbG93YC9gc2lsZW50YCB3b3VsZFxuICogc2lsZW50bHkgc3dhbGxvdyB0aGUgZmFjdCB0aGF0IHZlcmlmaWNhdGlvbiBuZXZlciBoYXBwZW5lZCwgc28gaXQgcmVzb2x2ZXNcbiAqIGluc3RlYWQgdG8gaXRzIG93biBgYWxsb3dgL2BzY2FuLWZhaWxlZGAgXHUyMDE0IGZhaWwgT1BFTiBsaWtlIGBlbnZpcm9ubWVudGFsYFxuICogKHRoZSBjb21tYW5kIGlzIG5vdCBoZWxkKSwgYnV0IHdpdGggYSBkaXN0aW5jdCBga2luZGAgYW5kIGByZWFzb25gIHNvIHRoZVxuICogYWRhcHRlciBzdXJmYWNlcyBhIHdhcm5pbmcgdGhhdCBzcGFuIGRlYnQgd2FzIE5PVCB2ZXJpZmllZCBmb3IgdGhpc1xuICogY2hhbmdlc2V0IHJhdGhlciB0aGFuIHN0YXlpbmcgc2lsZW50LiBUaGVyZSBpcyBubyBkZWJ0LXN0YXRlIHRvIG1lbW9pemVcbiAqIGhlcmU6IGV2ZXJ5IGV2YWx1YXRpb24gb2YgYSBzdGlsbC1mYWlsaW5nIHNjYW4gd2FybnMgYWdhaW4uXG4gKlxuICogSW4gYCdpbmZvcm0nYCBtb2RlIChgc3RhdHVzYCksIHRoZSBzYW1lIGNsYXNzaWZpY2F0aW9uIHJ1bnMgYnV0IG5laXRoZXJcbiAqIGBkZW55YCBicmFuY2ggZmlyZXMgYW5kIGBtZW1vU3RhdGVgIGlzIG5ldmVyIHJlYWQgb3Igd3JpdHRlbjogc2VtYW50aWNcbiAqIHN0YWxlbmVzcyByZXNvbHZlcyB0byBgYWxsb3dgL2BzZW1hbnRpYy1zdGFsZW5lc3MtaW5mb2AgYW5kIHVuY292ZXJlZFxuICogd3JpdGVzIHRvIGBhbGxvd2AvYHVuY292ZXJlZC13cml0ZXMtaW5mb2AsIGJvdGggY2FycnlpbmcgdGhlIHNhbWVcbiAqIGBmaW5kaW5nc2AvYHVuY292ZXJlZGAvYHJlYXNvbmAgcGF5bG9hZCB0aGUgYGRlbnlgIGtpbmRzIHdvdWxkIGhhdmUuIFRoZVxuICogZW52aXJvbm1lbnRhbC9zY2FuLWZhaWxlZC9zaWxlbnQgYnJhbmNoZXMgYXJlIHVuYWZmZWN0ZWQgYnkgbW9kZSBcdTIwMTQgdGhleVxuICogYWxyZWFkeSBhbHdheXMgYWxsb3cuXG4gKlxuICogQHBhcmFtIHBhdGhzIFRoZSByZXNvbHZlZCBjaGFuZ2VzZXQgZnJvbSB7QGxpbmsgcmVzb2x2ZUNoYW5nZXNldH0uIEVtcHR5IFx1MjE5MlxuICogICBgYWxsb3dgL2BzaWxlbnRgLlxuICogQHBhcmFtIGN3ZCBUaGUgd29ya2luZyBkaXJlY3RvcnkgdGhlIGdpdCBjb21tYW5kIHJhbiBpbi5cbiAqIEBwYXJhbSBleGVjdXRvcnMgVGhlIGluamVjdGVkIGBmaXhgL2BzdGFsZWAvYGxpc3RgIHN1cmZhY2UuXG4gKiBAcGFyYW0gbWVtb1N0YXRlIFRoZSBwZXItY2hhbmdlc2V0IGRlYnQtc3RhdGUgbWVtby4gVW51c2VkIGluIGAnaW5mb3JtJ2AgbW9kZS5cbiAqIEBwYXJhbSBtb2RlIGAnZW5mb3JjZSdgIChkZWZhdWx0KSBtYXkgZGVueTsgYCdpbmZvcm0nYCBvbmx5IGV2ZXIgYWR2aXNlcy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGV2YWx1YXRlR2F0ZShcbiAgcGF0aHM6IHN0cmluZ1tdLFxuICBjd2Q6IHN0cmluZyxcbiAgZXhlY3V0b3JzOiBHYXRlRXhlY3V0b3JzLFxuICBtZW1vU3RhdGU6IEdhdGVNZW1vU3RhdGUsXG4gIG1vZGU6IEdhdGVNb2RlID0gJ2VuZm9yY2UnXG4pOiBQcm9taXNlPEdhdGVSZXN1bHQ+IHtcbiAgaWYgKHBhdGhzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHsgZGVjaXNpb246ICdhbGxvdycsIGtpbmQ6ICdzaWxlbnQnIH07XG4gIHRyeSB7XG4gICAgLy8gQmVsdC1hbmQtYnJhY2VzIGhlYWwsIHRoZW4gY2xhc3NpZnkgYWdhaW5zdCB0aGUgaGVhbGVkIHN0YXRlLlxuICAgIGF3YWl0IGV4ZWN1dG9ycy5maXgocGF0aHMsIGN3ZCk7XG4gICAgY29uc3Qgc3RhbGVSb3dzID0gYXdhaXQgZXhlY3V0b3JzLnN0YWxlKHBhdGhzLCBjd2QpO1xuXG4gICAgLy8gU3BsaXQgZGVidCByb3dzIGludG8gc2VtYW50aWMgZHJpZnQgKGEgdXNlciBjYW4gZml4IGJ5IGVkaXRpbmcgYSBzcGFuKVxuICAgIC8vIGFuZCB0ZXJtaW5hbC9lbnZpcm9ubWVudGFsIGNvbmRpdGlvbnMgKHRoZSBDTEkgY291bGQgbm90IHJlc29sdmUgdGhlXG4gICAgLy8gYW5jaG9yIGF0IGFsbCBcdTIwMTQgc3BhcnNlIGNoZWNrb3V0LCB1bmZldGNoZWQgTEZTLCBwYXJ0aWFsLWNsb25lIG1pc3MsIEkvT1xuICAgIC8vIGVycm9yKS4gYGlzRGVidCgpYCBpcyB0aGUgc2luZ2xlIHNvdXJjZSBvZiB0cnV0aCBmb3Igd2hhdCBpcyBkZWJ0IGF0IGFsbDtcbiAgICAvLyBgaXNFbnZpcm9ubWVudGFsU3RhdHVzKClgIHNwbGl0cyB0aGUgZml4YWJsZSBmcm9tIHRoZSB1bnJlc29sdmFibGUuXG4gICAgLy8gYE1PVkVEYC9gUkVTT0xWRURfUEVORElOR19DT01NSVRgIGFyZSBuZXZlciBkZWJ0IGFuZCBuZXZlciBjb250cmlidXRlLlxuICAgIGNvbnN0IGRlYnRSb3dzID0gc3RhbGVSb3dzLmZpbHRlcigocm93KSA9PiBpc0RlYnQocm93LnN0YXR1cykpO1xuICAgIGNvbnN0IHNlbWFudGljID0gZGVidFJvd3MuZmlsdGVyKChyb3cpID0+ICFpc0Vudmlyb25tZW50YWxTdGF0dXMocm93LnN0YXR1cykpO1xuICAgIGNvbnN0IGVudmlyb25tZW50YWwgPSBkZWJ0Um93cy5maWx0ZXIoKHJvdykgPT4gaXNFbnZpcm9ubWVudGFsU3RhdHVzKHJvdy5zdGF0dXMpKTtcblxuICAgIGlmIChtb2RlID09PSAnaW5mb3JtJykge1xuICAgICAgLy8gQSBzdGF0dXMgcHJldmlldyBuZXZlciBkZW5pZXMgYW5kIG5ldmVyIHRvdWNoZXMgdGhlIGVuZm9yY2VcbiAgICAgIC8vIGNvbnNpZGVyLW9uY2UgZGVueSBjcmVkaXQgXHUyMDE0IGl0IHJlcG9ydHMgd2hhdGV2ZXIgZGVidCBpcyBsaXZlIHJpZ2h0XG4gICAgICAvLyBub3csIGV2ZXJ5IHRpbWUgaXQncyBhc2tlZC4gSXQgZG9lcywgaG93ZXZlciwgbWFyayB0aGUgZGVidCBzdGF0ZSBhc1xuICAgICAgLy8gXCJzZWVuXCIgKGEgc2VwYXJhdGUgYXhpcyBmcm9tIHRoZSBkZW55IGNyZWRpdCkgc28gYW4gZW5mb3JjZVxuICAgICAgLy8gZXZhbHVhdGlvbiBvZiB0aGUgc2FtZSB1bmNoYW5nZWQgc3RhdGUgbW9tZW50cyBsYXRlciBcdTIwMTQgZS5nLiBhIGBnaXRcbiAgICAgIC8vIGNvbW1pdGAgcmlnaHQgYWZ0ZXIgdGhlIGBnaXQgc3RhdHVzYCB0aGF0IGp1c3Qgc2hvd2VkIHRoaXMgXHUyMDE0IHJlbmRlcnNcbiAgICAgIC8vIGEgY29uZGVuc2VkIHJlbWluZGVyIGluc3RlYWQgb2YgcmVwZWF0aW5nIHRoZSBpZGVudGljYWwgY2hlY2tsaXN0LlxuICAgICAgaWYgKHNlbWFudGljLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3Qgc2VlbiA9IHdhc0FscmVhZHlTZWVuKG1lbW9TdGF0ZSwgZ2F0ZVN0YXRlRGlnZXN0KHNlbWFudGljLCBbXSkpO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGRlY2lzaW9uOiAnYWxsb3cnLFxuICAgICAgICAgIGtpbmQ6ICdzZW1hbnRpYy1zdGFsZW5lc3MtaW5mbycsXG4gICAgICAgICAgZmluZGluZ3M6IHNlbWFudGljLFxuICAgICAgICAgIHJlYXNvbjogcmVuZGVyU3RhbGVuZXNzUmVhc29uKHNlbWFudGljLCBhd2FpdCBmZXRjaFNwYW5CbG9ja3MoZXhlY3V0b3JzLCBzZW1hbnRpYywgY3dkKSwgJ2luZm9ybScsIHNlZW4pXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICBpZiAoZW52aXJvbm1lbnRhbC5sZW5ndGggPiAwKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgZGVjaXNpb246ICdhbGxvdycsXG4gICAgICAgICAga2luZDogJ2Vudmlyb25tZW50YWwnLFxuICAgICAgICAgIGNvbmRpdGlvbnM6IGVudmlyb25tZW50YWwsXG4gICAgICAgICAgcmVhc29uOiByZW5kZXJFbnZpcm9ubWVudGFsUmVhc29uKGVudmlyb25tZW50YWwsIGF3YWl0IGZldGNoU3BhbkJsb2NrcyhleGVjdXRvcnMsIGVudmlyb25tZW50YWwsIGN3ZCkpXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICBjb25zdCB7IHVuY292ZXJlZCwgY292ZXJpbmcgfSA9IGF3YWl0IGNvbXB1dGVVbmNvdmVyZWRQYXRocyhwYXRocywgY3dkLCBleGVjdXRvcnMpO1xuICAgICAgaWYgKHVuY292ZXJlZC5sZW5ndGggPT09IDApIHJldHVybiB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnc2lsZW50JyB9O1xuICAgICAgY29uc3Qgc2VlbiA9IHdhc0FscmVhZHlTZWVuKG1lbW9TdGF0ZSwgZ2F0ZVN0YXRlRGlnZXN0KFtdLCB1bmNvdmVyZWQpKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGRlY2lzaW9uOiAnYWxsb3cnLFxuICAgICAgICBraW5kOiAndW5jb3ZlcmVkLXdyaXRlcy1pbmZvJyxcbiAgICAgICAgdW5jb3ZlcmVkLFxuICAgICAgICByZWFzb246IHJlbmRlclVuY292ZXJlZFJlYXNvbih1bmNvdmVyZWQsIGNvdmVyaW5nLCAnaW5mb3JtJywgc2VlbilcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gU2VtYW50aWMgc3RhbGVuZXNzIGpvaW5zIHRoZSBzYW1lIGRpc3RpbmN0LWRlYnQtc3RhdGUgbWVtbyB0aGUgdW5jb3ZlcmVkXG4gICAgLy8gY2hlY2sgdXNlczogZGVueSBvbmNlIHBlciBmaW5kaW5ncyBkaWdlc3QsIHRoZW4gZmFsbCB0aHJvdWdoIChyYXRoZXIgdGhhblxuICAgIC8vIHJldHVybmluZykgb24gYW4gaWRlbnRpY2FsIHJldHJ5IHNvIHRoZSByZXN0IG9mIHRoZSBldmFsdWF0aW9uIHN0aWxsIHJ1bnMuXG4gICAgbGV0IHNlbWFudGljQWxyZWFkeVByZXNlbnRlZCA9IGZhbHNlO1xuICAgIGlmIChzZW1hbnRpYy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBzZW1hbnRpY0RpZ2VzdCA9IGdhdGVTdGF0ZURpZ2VzdChzZW1hbnRpYywgW10pO1xuICAgICAgaWYgKCFtZW1vU3RhdGUuaGFzKHNlbWFudGljRGlnZXN0KSkge1xuICAgICAgICAvLyBBIG5vbi1wZXJzaXN0aW5nIG1lbW8gd3JpdGUgd291bGQgdHVybiBcImRlbnkgb25jZSwgdGhlbiBhbGxvdyB0aGVcbiAgICAgICAgLy8gcmV0cnlcIiBpbnRvIFwiZGVueSBldmVyeSB0aW1lXCIgd2l0aCBubyBlc2NhcGUgXHUyMDE0IGZhaWwgb3BlbiBpbnN0ZWFkLlxuICAgICAgICBpZiAoIW1lbW9TdGF0ZS5yZWNvcmQoc2VtYW50aWNEaWdlc3QpKSByZXR1cm4geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ3NpbGVudCcgfTtcbiAgICAgICAgY29uc3Qgc2VlbiA9IHdhc0FscmVhZHlTZWVuKG1lbW9TdGF0ZSwgc2VtYW50aWNEaWdlc3QpO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGRlY2lzaW9uOiAnZGVueScsXG4gICAgICAgICAga2luZDogJ3NlbWFudGljLXN0YWxlbmVzcycsXG4gICAgICAgICAgZmluZGluZ3M6IHNlbWFudGljLFxuICAgICAgICAgIHJlYXNvbjogcmVuZGVyU3RhbGVuZXNzUmVhc29uKHNlbWFudGljLCBhd2FpdCBmZXRjaFNwYW5CbG9ja3MoZXhlY3V0b3JzLCBzZW1hbnRpYywgY3dkKSwgJ2VuZm9yY2UnLCBzZWVuKVxuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgc2VtYW50aWNBbHJlYWR5UHJlc2VudGVkID0gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBFbnZpcm9ubWVudGFsIGNvbmRpdGlvbnMgYXJlIG5vdCBhIHNwYW4gZWRpdCBhd2F5IGZyb20gcmVzb2x1dGlvbjogZmFpbFxuICAgIC8vIE9QRU4gKGFsbG93KSBcdTIwMTQgYnV0IGNhcnJ5IHRoZW0gc28gdGhlIGFkYXB0ZXIgc3VyZmFjZXMgdGhlIGNvbmRpdGlvbiByYXRoZXJcbiAgICAvLyB0aGFuIHN3YWxsb3dpbmcgaXQuIERlbnlpbmcgd291bGQgcmUtZGVueSBmb3JldmVyIG9uIGFuIGluZnJhIGZhaWx1cmUgdGhlXG4gICAgLy8gdXNlciBjYW5ub3QgY2xlYXIgZnJvbSB0aGUgZ2F0ZSwgY29udHJhZGljdGluZyB0aGUgZmFpbC1vcGVuIGNvbnRyYWN0IHRoZVxuICAgIC8vIHJlc3Qgb2YgdGhlIGdhdGUgYWxyZWFkeSBob25vcnMgZm9yIENMSS1hYnNlbnQvdGltZW91dC9wYXJzZSBmYWlsdXJlcy5cbiAgICBpZiAoZW52aXJvbm1lbnRhbC5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBkZWNpc2lvbjogJ2FsbG93JyxcbiAgICAgICAga2luZDogJ2Vudmlyb25tZW50YWwnLFxuICAgICAgICBjb25kaXRpb25zOiBlbnZpcm9ubWVudGFsLFxuICAgICAgICByZWFzb246IHJlbmRlckVudmlyb25tZW50YWxSZWFzb24oZW52aXJvbm1lbnRhbCwgYXdhaXQgZmV0Y2hTcGFuQmxvY2tzKGV4ZWN1dG9ycywgZW52aXJvbm1lbnRhbCwgY3dkKSlcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gVW5jb3ZlcmVkIHdyaXRlczogY2hhbmdlZCBwYXRocyB3aXRoIHplcm8gY292ZXJpbmcgc3BhbiwgbWludXMgYC5zcGFuLyoqYFxuICAgIC8vIChzcGFuIHJlcGFpcnMgcmlkZSB0aGUgc2FtZSBjb21taXQgYW5kIG11c3QgbmV2ZXIgc2VsZi10cmlnZ2VyIHRoZSBnYXRlKVxuICAgIC8vIGFuZCBwYXRocyB0aGUgcmVwbydzIHVzZXItb3duZWQgYC5zcGFuLy5nYXRlaWdub3JlYCBleGNsdWRlcy4gR2l0aWdub3JlZFxuICAgIC8vIHBhdGhzIG5ldmVyIHJlYWNoIGhlcmUgXHUyMDE0IGdpdCBkb2VzIG5vdCBzdGFnZS9wdWJsaXNoIHRoZW0uXG4gICAgY29uc3QgeyB1bmNvdmVyZWQsIGNvdmVyaW5nIH0gPSBhd2FpdCBjb21wdXRlVW5jb3ZlcmVkUGF0aHMocGF0aHMsIGN3ZCwgZXhlY3V0b3JzKTtcbiAgICBpZiAodW5jb3ZlcmVkLmxlbmd0aCA9PT0gMCkge1xuICAgICAgLy8gQSByZXRyeSB0aGF0IGZlbGwgdGhyb3VnaCBwYXN0IGFuIGFscmVhZHktcHJlc2VudGVkIHNlbWFudGljLXN0YWxlbmVzc1xuICAgICAgLy8gZGlnZXN0IGVuZHMgY2xlYW4gaGVyZTogc3VyZmFjZSBhbHJlYWR5LXByZXNlbnRlZCByYXRoZXIgdGhhbiBhIGJhcmVcbiAgICAgIC8vIHNpbGVudCBhbGxvdywgbWlycm9yaW5nIHRoZSB1bmNvdmVyZWQgYnJhbmNoJ3Mgb3duIG1lbW8taGl0IHJlc3VsdC5cbiAgICAgIHJldHVybiBzZW1hbnRpY0FscmVhZHlQcmVzZW50ZWRcbiAgICAgICAgPyB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnYWxyZWFkeS1wcmVzZW50ZWQnIH1cbiAgICAgICAgOiB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnc2lsZW50JyB9O1xuICAgIH1cblxuICAgIC8vIENvbnNpZGVyLW9uY2U6IGRlbnkgdGhlIGZpcnN0IHRpbWUgdGhpcyBleGFjdCBkZWJ0IHN0YXRlIGlzIHNlZW4sIHRoZW5cbiAgICAvLyBwYXNzIHRoZSByZXRyeSB3aXRoIGFuIHVuY2hhbmdlZCBzdGF0ZS4gKE5vIHNlbWFudGljIHJvd3Mgc3Vydml2ZSB0b1xuICAgIC8vIGhlcmUgdW5wcmVzZW50ZWQgXHUyMDE0IHRoZSBzZW1hbnRpYyBicmFuY2ggYWJvdmUgaGFzIGFscmVhZHkgcmV0dXJuZWQgZm9yXG4gICAgLy8gdGhhdCBjYXNlIFx1MjAxNCBzbyB0aGUgZGlnZXN0J3MgZmluZGluZ3MgY29tcG9uZW50IGlzIGVtcHR5IGFuZCB0aGUgc3RhdGVcbiAgICAvLyBpcyBrZXllZCBieSB0aGUgdW5jb3ZlcmVkIHNldC4pIGBjb3ZlcmluZ2AgXHUyMDE0IHdoaWNoIHNwYW5zIGZvciB0aGUgcmVzdCBvZlxuICAgIC8vIHRoaXMgY2hhbmdlc2V0IHRoZSBtZXNzYWdlIGdvZXMgb24gdG8gbmFtZSBcdTIwMTQgbmV2ZXIgZmVlZHMgdGhlIGRpZ2VzdDogaXRcbiAgICAvLyBuZXZlciBjaGFuZ2VzIHdoYXQncyBkZW5pZWQsIG9ubHkgd2hhdCdzIGV4cGxhaW5lZCwgc28gaXQgY2FuJ3Qgc3Bhd24gYVxuICAgIC8vIGZyZXNoIGRlbnkgb24gaXRzIG93bi5cbiAgICBjb25zdCBkaWdlc3QgPSBnYXRlU3RhdGVEaWdlc3QoW10sIHVuY292ZXJlZCk7XG4gICAgaWYgKG1lbW9TdGF0ZS5oYXMoZGlnZXN0KSkgcmV0dXJuIHsgZGVjaXNpb246ICdhbGxvdycsIGtpbmQ6ICdhbHJlYWR5LXByZXNlbnRlZCcgfTtcbiAgICAvLyBBIG5vbi1wZXJzaXN0aW5nIG1lbW8gd3JpdGUgd291bGQgdHVybiBcImRlbnkgb25jZSwgdGhlbiBhbGxvdyB0aGUgcmV0cnlcIlxuICAgIC8vIGludG8gXCJkZW55IGV2ZXJ5IHRpbWVcIiB3aXRoIG5vIGVzY2FwZSBcdTIwMTQgZmFpbCBvcGVuIHJhdGhlciB0aGFuIGRlbnkuXG4gICAgaWYgKCFtZW1vU3RhdGUucmVjb3JkKGRpZ2VzdCkpIHJldHVybiB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnc2lsZW50JyB9O1xuICAgIGNvbnN0IHNlZW4gPSB3YXNBbHJlYWR5U2VlbihtZW1vU3RhdGUsIGRpZ2VzdCk7XG4gICAgcmV0dXJuIHtcbiAgICAgIGRlY2lzaW9uOiAnZGVueScsXG4gICAgICBraW5kOiAndW5jb3ZlcmVkLXdyaXRlcycsXG4gICAgICB1bmNvdmVyZWQsXG4gICAgICByZWFzb246IHJlbmRlclVuY292ZXJlZFJlYXNvbih1bmNvdmVyZWQsIGNvdmVyaW5nLCAnZW5mb3JjZScsIHNlZW4pXG4gICAgfTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgLy8gQSBzY2FuIHRoYXQgY291bGQgbm90IENPTVBMRVRFIGlzIG5vdCBhIGNsZWFuIHJlc3VsdCwgYnV0IGl0IGlzIG5vdFxuICAgIC8vIGRlYnQgZWl0aGVyIFx1MjAxNCB0aGVyZSBpcyBub3RoaW5nIGhlcmUgZm9yIGEgdXNlciB0byByZXNvbHZlIGJ5IGVkaXRpbmcgYVxuICAgIC8vIHNwYW4uIEZhaWwgT1BFTiB3aXRoIGEgZGlzdGluZ3Vpc2hhYmxlIGBzY2FuLWZhaWxlZGAgd2FybmluZyBpbnN0ZWFkIG9mXG4gICAgLy8gc2lsZW50bHkgcmVhZGluZyB0aGUgYWJvcnRlZCBzY2FuJ3MgZW1wdHkgcmVzdWx0IGFzIGNsZWFuLlxuICAgIGlmIChlcnIgaW5zdGFuY2VvZiBHYXRlU2NhbkVycm9yKSB7XG4gICAgICByZXR1cm4geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ3NjYW4tZmFpbGVkJywgcmVhc29uOiByZW5kZXJTY2FuRmFpbGVkUmVhc29uKGVyci5kZXRhaWwpIH07XG4gICAgfVxuICAgIC8vIEZhaWwgb3BlbjogYW55IG90aGVyIGludGVybmFsL0NMSSBlcnJvciByZXNvbHZlcyB0byBhbGxvdy4gVGhlIGdhdGUgbXVzdFxuICAgIC8vIG5ldmVyIGJyaWNrIGEgY29tbWl0IG9uIGl0cyBvd24gZmFpbHVyZS5cbiAgICByZXR1cm4geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ3NpbGVudCcgfTtcbiAgfVxufVxuXG4vKipcbiAqIHtAbGluayBjb21wdXRlVW5jb3ZlcmVkUGF0aHN9J3MgcmVzdWx0OiB0aGUgdW5jb3ZlcmVkIGNvbXBsZW1lbnQgdGhlIGdhdGVcbiAqIGRlbmllcy9hZHZpc2VzIG9uLCBwbHVzIHRoZSBgY292ZXJpbmdgIHJvd3MgdGhlIHNhbWUgYGV4ZWN1dG9ycy5saXN0YCBjYWxsXG4gKiBhbHJlYWR5IHJlc29sdmVkIGZvciB0aGUgcmVzdCBvZiB0aGUgY2hhbmdlc2V0IFx1MjAxNCBldmVyeSBhbmNob3IsIGluIGFueSBzcGFuLFxuICogd2hvc2UgcGF0aCBpcyBvbmUgb2YgdGhlIHBhdGhzIHBhc3NlZCBpbi4gYGNvdmVyaW5nYCBpcyBuZXZlciBlbXB0eSBvbmx5XG4gKiB3aGVuIGB1bmNvdmVyZWRgIGlzOyB0aGUgdHdvIHBhcnRpdGlvbiB0aGUgY2hhbmdlc2V0IChtaW51cyBgLnNwYW4vKipgL1xuICogZ2F0ZWlnbm9yZWQgcGF0aHMsIHdoaWNoIGFwcGVhciBpbiBuZWl0aGVyKS4gS2VwdCB0b2dldGhlciBzbyBhIGNhbGxlclxuICogbmVlZGluZyBib3RoICh0aGUgdW5jb3ZlcmVkLXdyaXRlcyByZWFzb24sIHdoaWNoIG5vdyBhbHNvIG5hbWVzIHNwYW5zXG4gKiBhbHJlYWR5IGNvdmVyaW5nIHRoZSBjaGFuZ2VzZXQncyBvdGhlciBmaWxlcyBcdTIwMTQgc2VlXG4gKiB7QGxpbmsgcmVuZGVyVW5jb3ZlcmVkUmVhc29ufSkgbWFrZXMgb25lIGNhbGwgaW5zdGVhZCBvZiB0d28uXG4gKi9cbmludGVyZmFjZSBDaGFuZ2VzZXRDb3ZlcmFnZSB7XG4gIHVuY292ZXJlZDogc3RyaW5nW107XG4gIGNvdmVyaW5nOiBQb3JjZWxhaW5Sb3dbXTtcbn1cblxuLyoqXG4gKiBUaGUgY2hhbmdlZCBwYXRocyB3aXRoIHplcm8gY292ZXJpbmcgc3BhbiBcdTIwMTQgbWludXMgYC5zcGFuLyoqYCAoc3BhbiByZXBhaXJzXG4gKiByaWRlIHRoZSBzYW1lIGNvbW1pdCBhbmQgbXVzdCBuZXZlciBzZWxmLXRyaWdnZXIgdGhlIGdhdGUpIGFuZCBwYXRocyB0aGVcbiAqIHJlcG8ncyB1c2VyLW93bmVkIGAuc3Bhbi8uZ2F0ZWlnbm9yZWAgZXhjbHVkZXMgKGZhaWwtb3BlbiB3aGVuIGFic2VudC9cbiAqIHVucmVhZGFibGUpLiBTaGFyZWQgYnkgYGV2YWx1YXRlR2F0ZWAncyBgJ2VuZm9yY2UnYCBhbmQgYCdpbmZvcm0nYCBicmFuY2hlcyxcbiAqIHdoaWNoIGRpZmZlciBvbmx5IGluIHdoYXQgdGhleSBkbyB3aXRoIHRoZSByZXN1bHQgKGRlbnktb25jZSB2cy4gYW5cbiAqIGFsd2F5cy1mcmVzaCBhZHZpc29yeSkuXG4gKlxuICogQSBjaGFuZ2VzZXQgb2YgZmV3ZXIgdGhhbiB0d28gZmlsZXMgY2FuIG5ldmVyIGNhcnJ5IGFuIGltcGxpY2l0ICpjcm9zcy1maWxlKlxuICogZGVwZW5kZW5jeSBcdTIwMTQgZ2l0LXNwYW4gcmVjb3JkcyBjb3VwbGluZ3MgYmV0d2VlbiBmaWxlL2xpbmUgcmFuZ2VzIGFjcm9zc1xuICogZmlsZXMgXHUyMDE0IHNvIGEgc2luZ2xlLWZpbGUgKG9yIGVtcHR5KSBjaGFuZ2VzZXQgc2hvcnQtY2lyY3VpdHMgdG8gbm9cbiAqIHVuY292ZXJlZCBwYXRocyAoYW5kIG5vIGNvdmVyaW5nIHJvd3MpIHJhdGhlciB0aGFuIHByb21wdGluZyBmb3IgYSBjb3VwbGluZ1xuICogdGhhdCBjYW5ub3QgZXhpc3QuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGNvbXB1dGVVbmNvdmVyZWRQYXRocyhcbiAgcGF0aHM6IHN0cmluZ1tdLFxuICBjd2Q6IHN0cmluZyxcbiAgZXhlY3V0b3JzOiBHYXRlRXhlY3V0b3JzXG4pOiBQcm9taXNlPENoYW5nZXNldENvdmVyYWdlPiB7XG4gIGlmIChwYXRocy5sZW5ndGggPCAyKSByZXR1cm4geyB1bmNvdmVyZWQ6IFtdLCBjb3ZlcmluZzogW10gfTtcbiAgY29uc3QgY292ZXJpbmcgPSBhd2FpdCBleGVjdXRvcnMubGlzdChwYXRocywgY3dkKTtcbiAgY29uc3QgY292ZXJlZCA9IG5ldyBTZXQoY292ZXJpbmcubWFwKChyb3cpID0+IHJvdy5wYXRoKSk7XG4gIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gIGNvbnN0IGdhdGVJZ25vcmVSdWxlcyA9IHJlcG9Sb290ID8gbG9hZEdhdGVJZ25vcmUocmVwb1Jvb3QpIDogW107XG4gIGNvbnN0IHVuY292ZXJlZCA9IHBhdGhzLmZpbHRlcihcbiAgICAocGF0aCkgPT4gIWNvdmVyZWQuaGFzKHBhdGgpICYmICFpc0luc2lkZVNwYW5Sb290KHBhdGgpICYmICFpc0dhdGVJZ25vcmVkKGdhdGVJZ25vcmVSdWxlcywgcGF0aClcbiAgKTtcbiAgcmV0dXJuIHsgdW5jb3ZlcmVkLCBjb3ZlcmluZyB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERlYnQtc3RhdGUgZGlnZXN0IGFuZCByZWFzb24gcmVuZGVyaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBgcGF0aCNMc3RhcnQtTGVuZGAsIG9yIGEgYmFyZSBwYXRoIGZvciBhIHdob2xlLWZpbGUgYW5jaG9yLiBUeXBlZCBhZ2FpbnN0XG4gKiB0aGUgZmllbGRzIHNoYXJlZCBieSB7QGxpbmsgU3RhbGVQb3JjZWxhaW5Sb3d9IGFuZCB7QGxpbmsgUG9yY2VsYWluUm93fVxuICogKHJhdGhlciB0aGFuIGVpdGhlciBzcGVjaWZpY2FsbHkpIHNvIGJvdGggdGhlIHN0YWxlbmVzcy9lbnZpcm9ubWVudGFsXG4gKiByZW5kZXJlcnMgYW5kIHRoZSB1bmNvdmVyZWQtd3JpdGVzIHJlbGF0ZWQtc3BhbnMgc2VjdGlvbiAoe0BsaW5rXG4gKiBncm91cENvdmVyaW5nQnlOYW1lfSkgY2FuIGZvcm1hdCBhbiBhbmNob3IgdGhlIHNhbWUgd2F5LlxuICovXG5mdW5jdGlvbiBhbmNob3JUZXh0KHJvdzogeyBwYXRoOiBzdHJpbmc7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIH0pOiBzdHJpbmcge1xuICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIHJldHVybiByb3cucGF0aDtcbiAgcmV0dXJuIGAke3Jvdy5wYXRofSNMJHtyb3cuc3RhcnR9LUwke3Jvdy5lbmR9YDtcbn1cblxuLyoqXG4gKiBUaGUgZGlzdGluY3QtZGVidC1zdGF0ZSBkaWdlc3QgKGRlc2lnbi1kZWNpc2lvbnMubWQgIzkpOiBhIHN0YWJsZSBoYXNoIG9mIHRoZVxuICogc29ydGVkIHN0YWxlbmVzcyBmaW5kaW5ncyBwbHVzIHRoZSBzb3J0ZWQgdW5jb3ZlcmVkIHBhdGhzLiBQcmVzZW5jZSBpbiB0aGVcbiAqIG1lbW8gbWVhbnMgXCJ0aGlzIGV4YWN0IHN0YXRlIHdhcyBhbHJlYWR5IHByZXNlbnRlZCBvbmNlLlwiXG4gKi9cbmZ1bmN0aW9uIGdhdGVTdGF0ZURpZ2VzdChmaW5kaW5nczogU3RhbGVQb3JjZWxhaW5Sb3dbXSwgdW5jb3ZlcmVkOiBzdHJpbmdbXSk6IHN0cmluZyB7XG4gIGNvbnN0IGZpbmRpbmdLZXlzID0gZmluZGluZ3MubWFwKChyb3cpID0+IGAke3Jvdy5zdGF0dXN9XFx0JHtyb3cubmFtZX1cXHQke3Jvdy5wYXRofVxcdCR7cm93LnN0YXJ0fVxcdCR7cm93LmVuZH1gKS5zb3J0KCk7XG4gIGNvbnN0IHBheWxvYWQgPSBKU09OLnN0cmluZ2lmeSh7IGZpbmRpbmdzOiBmaW5kaW5nS2V5cywgdW5jb3ZlcmVkOiBbLi4udW5jb3ZlcmVkXS5zb3J0KCkgfSk7XG4gIHJldHVybiBjcmVhdGVIYXNoKCdzaGEyNTYnKS51cGRhdGUocGF5bG9hZCkuZGlnZXN0KCdoZXgnKTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIHRoaXMgZGVidC1zdGF0ZSBkaWdlc3QgaGFzIGFscmVhZHkgYmVlbiBleHBsYWluZWQgdG8gdGhlIGFnZW50IGluXG4gKiBmdWxsIFx1MjAxNCBvcnRob2dvbmFsIHRvIChhbmQgaW5kZXBlbmRlbnQgb2YpIHRoZSBlbmZvcmNlLW9ubHkgY29uc2lkZXItb25jZVxuICogZGVueSBjcmVkaXQgYGV2YWx1YXRlR2F0ZWAgcmVhZHMvd3JpdGVzIG9uIHRoZSBzYW1lIGBkaWdlc3RgIHZhbHVlLiBBIHNpbmdsZVxuICogYGdpdCBzdGF0dXNgL2BnaXQgYWRkYCBwcmV2aWV3IGFuZCB0aGUgYGdpdCBjb21taXRgL2BwdXNoYCB0aGF0IGZvbGxvd3MgaXRcbiAqIG1vbWVudHMgbGF0ZXIgcmVzb2x2ZSB0byB0aGUgc2FtZSBkaWdlc3QgYnV0IHJlYWNoIGBldmFsdWF0ZUdhdGVgIHRocm91Z2hcbiAqIGRpZmZlcmVudCBtb2RlcyAoYCdpbmZvcm0nYCBuZXZlciB0b3VjaGVzIHRoZSBkZW55IGNyZWRpdCk7IHdpdGhvdXQgYVxuICogc2VwYXJhdGUgXCJzZWVuXCIgYXhpcywgYm90aCB3b3VsZCByZW5kZXIgdGhlIGlkZW50aWNhbCBjaGVja2xpc3QgdmVyYmF0aW0gaW5cbiAqIHRoZSBzYW1lIHR1cm4gXHUyMDE0IHdoaWNoIGlzIGV4YWN0bHkgd2hhdCBhIGNhcHR1cmVkIHNlc3Npb24gc2hvd2VkOiBhIHN0YXR1c1xuICogcHJldmlldyBpbW1lZGlhdGVseSBmb2xsb3dlZCBieSBhIGNvbW1pdCBhdHRlbXB0IG9uIHRoZSBzYW1lIHR3byBmaWxlcyxcbiAqIHRoZSBzZWNvbmQgbWVzc2FnZSBkaWZmZXJpbmcgb25seSBieSB0aGUgYXBwZW5kZWQgcmV0cnkgc2VudGVuY2UuIE1hcmtpbmdcbiAqIFwic2VlblwiIGhlcmUgKGFuZCBjb25zdWx0aW5nIGl0IGJlZm9yZSByZW5kZXJpbmcpIGxldHMgYm90aCBgcmVuZGVyU3RhbGVuZXNzUmVhc29uYFxuICogYW5kIGByZW5kZXJVbmNvdmVyZWRSZWFzb25gIGZhbGwgYmFjayB0byBhIGNvbmRlbnNlZCByZW1pbmRlciBvbiB0aGUgc2Vjb25kXG4gKiBzaG93aW5nLCBpbiBlaXRoZXIgZGlyZWN0aW9uIChpbmZvcm0tdGhlbi1lbmZvcmNlIG9yIGVuZm9yY2UtdGhlbi1pbmZvcm0pLFxuICogd2l0aG91dCBjaGFuZ2luZyB3aGV0aGVyIGBlbmZvcmNlYCBkZW5pZXMgb3IgYWxsb3dzLlxuICovXG5mdW5jdGlvbiB3YXNBbHJlYWR5U2VlbihtZW1vU3RhdGU6IEdhdGVNZW1vU3RhdGUsIGRpZ2VzdDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGNvbnN0IHNlZW5LZXkgPSBgc2Vlbi0ke2RpZ2VzdH1gO1xuICBjb25zdCBhbHJlYWR5ID0gbWVtb1N0YXRlLmhhcyhzZWVuS2V5KTtcbiAgbWVtb1N0YXRlLnJlY29yZChzZWVuS2V5KTtcbiAgcmV0dXJuIGFscmVhZHk7XG59XG5cbi8qKlxuICogRmV0Y2ggdGhlIGh1bWFuLWZvcm1hdCBgIyMgPG5hbWU+YCBibG9ja3MgZm9yIHRoZSBzcGFucyBuYW1lZCBpbiBgcm93c2AsXG4gKiBmYWlsaW5nIHRvIGAnJ2AgKG5ldmVyIHRocm93aW5nKSBzbyBhIGxpc3QgZmFpbHVyZSBjYW4gbmV2ZXIgdHVybiBhIGRlbnlcbiAqIGludG8gYSBzaWxlbnQgYWxsb3cgdmlhIHtAbGluayBldmFsdWF0ZUdhdGV9J3Mgb3V0ZXIgY2F0Y2ggXHUyMDE0XG4gKiB7QGxpbmsgYW5ub3RhdGVCbG9ja3N9IHN5bnRoZXNpemVzIG1pbmltYWwgYmxvY2tzIGZyb20gdGhlIHJvd3MgaW5zdGVhZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZmV0Y2hTcGFuQmxvY2tzKGV4ZWN1dG9yczogR2F0ZUV4ZWN1dG9ycywgcm93czogU3RhbGVQb3JjZWxhaW5Sb3dbXSwgY3dkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBuYW1lcyA9IFsuLi5uZXcgU2V0KHJvd3MubWFwKChyb3cpID0+IHJvdy5uYW1lKSldLnNvcnQoKTtcbiAgdHJ5IHtcbiAgICByZXR1cm4gYXdhaXQgZXhlY3V0b3JzLmxpc3RCbG9ja3MobmFtZXMsIGN3ZCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnJztcbiAgfVxufVxuXG4vKipcbiAqIENvbGxhcHNlIHJvd3MgdGhhdCBuYW1lIHRoZSBzYW1lIGFuY2hvciBhZGRyZXNzIGludG8gb25lIGVudHJ5LCBjb21iaW5pbmdcbiAqIHRoZWlyIGRpc3RpbmN0IHN0YXR1c2VzIChzb3J0ZWQpIGFuZCBwcmVzZXJ2aW5nIGZpcnN0LXNlZW4gb3JkZXIuIFRoZSBDTEknc1xuICogYHN0YWxlIC0tZm9ybWF0IHBvcmNlbGFpbmAgZW1pdHMgb25lIHJvdyBwZXIgKmRyaWZ0aW5nIGxheWVyKiBmb3IgYSBzaW5nbGVcbiAqIGFuY2hvciAoZS5nLiBib3RoIHdvcmt0cmVlIGFuZCBpbmRleCBjaGFuZ2VkKSBcdTIwMTQgYSBkaXN0aW5jdGlvbiB0aGUgYHNyY2BcbiAqIGNvbHVtbiBjYXJyaWVzIGJ1dCB7QGxpbmsgcGFyc2VTdGFsZVBvcmNlbGFpbn0gZGVsaWJlcmF0ZWx5IGRyb3BzIFx1MjAxNCBzb1xuICogd2l0aG91dCB0aGlzIGNvbGxhcHNlIHRoZSBzYW1lIGFuY2hvciB3b3VsZCBvdGhlcndpc2UgcmVuZGVyIGFzIHR3byAob3JcbiAqIG1vcmUpIGlkZW50aWNhbCBidWxsZXRzIGluc3RlYWQgb2Ygb25lIGJ1bGxldCB3aXRoIGV2ZXJ5IHN0YXR1cyBpdCBlYXJuZWQuXG4gKi9cbmZ1bmN0aW9uIGRlZHVwZUJ5QW5jaG9yKHJvd3M6IFN0YWxlUG9yY2VsYWluUm93W10pOiB7IGFkZHI6IHN0cmluZzsgc3RhdHVzZXM6IFBvcmNlbGFpblN0YXR1c1tdIH1bXSB7XG4gIGNvbnN0IG9yZGVyOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBieUFkZHIgPSBuZXcgTWFwPHN0cmluZywgU2V0PFBvcmNlbGFpblN0YXR1cz4+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBjb25zdCBhZGRyID0gYW5jaG9yVGV4dChyb3cpO1xuICAgIGxldCBzdGF0dXNlcyA9IGJ5QWRkci5nZXQoYWRkcik7XG4gICAgaWYgKCFzdGF0dXNlcykge1xuICAgICAgc3RhdHVzZXMgPSBuZXcgU2V0KCk7XG4gICAgICBieUFkZHIuc2V0KGFkZHIsIHN0YXR1c2VzKTtcbiAgICAgIG9yZGVyLnB1c2goYWRkcik7XG4gICAgfVxuICAgIHN0YXR1c2VzLmFkZChyb3cuc3RhdHVzKTtcbiAgfVxuICByZXR1cm4gb3JkZXIubWFwKChhZGRyKSA9PiAoeyBhZGRyLCBzdGF0dXNlczogWy4uLihieUFkZHIuZ2V0KGFkZHIpID8/IFtdKV0uc29ydCgpIH0pKTtcbn1cblxuLyoqXG4gKiBBbm5vdGF0ZSBgZ2l0IHNwYW4gbGlzdGAgaHVtYW4gYmxvY2tzIHdpdGggcGVyLWFuY2hvciBkcmlmdCBsYWJlbHM6IGVhY2hcbiAqIGJ1bGxldCB3aG9zZSBhbmNob3IgbWF0Y2hlcyBhIGZpbmRpbmcgZ2FpbnMgYCBcdTIwMTQgPGxhYmVsPmAuIEJ1bGxldHMgYXJlIG9ubHlcbiAqIHRoZSBjb250aWd1b3VzIGAtIGAgcnVuIGRpcmVjdGx5IHVuZGVyIGEgYCMjIDxuYW1lPmAgaGVhZGVyLCBzbyBhXG4gKiBkZXNjcmlwdGlvbiBsaW5lIHRoYXQgaGFwcGVucyB0byBzdGFydCB3aXRoIGAtIGAgaXMgbmV2ZXIgYW5ub3RhdGVkLlxuICogRmluZGluZ3Mgd2hvc2UgYW5jaG9yIGhhcyBubyBtYXRjaGluZyBidWxsZXQgYXJlIGFwcGVuZGVkIHRvIHRoZWlyIHNwYW4nc1xuICogYnVsbGV0IHJ1bjsgc3BhbnMgYWJzZW50IGZyb20gYGJsb2Nrc1RleHRgIGVudGlyZWx5IChvciBhbiBlbXB0eS9mYWlsZWRcbiAqIGxpc3QgcmVhZCkgZ2V0IGEgc3ludGhlc2l6ZWQgbWluaW1hbCBibG9jayBcdTIwMTQgbm8gZmluZGluZyBpcyBldmVyIGRyb3BwZWQuXG4gKiBFdmVyeSBmaW5kaW5nIG1hdGNoaW5nIChvciBhcHBlbmRlZCBmb3IpIGEgZ2l2ZW4gYW5jaG9yIGFkZHJlc3MgaXNcbiAqIGNvbGxhcHNlZCB2aWEge0BsaW5rIGRlZHVwZUJ5QW5jaG9yfSBmaXJzdCwgc28gYSBzaW5nbGUgYW5jaG9yIG5ldmVyXG4gKiByZW5kZXJzIGFzIG1vcmUgdGhhbiBvbmUgYnVsbGV0IHJlZ2FyZGxlc3Mgb2YgaG93IG1hbnkgZHJpZnRpbmctbGF5ZXIgcm93c1xuICogdGhlIENMSSBlbWl0dGVkIGZvciBpdC5cbiAqL1xuZnVuY3Rpb24gYW5ub3RhdGVCbG9ja3MoYmxvY2tzVGV4dDogc3RyaW5nLCByb3dzOiBTdGFsZVBvcmNlbGFpblJvd1tdKTogc3RyaW5nIHtcbiAgY29uc3QgcmVtYWluaW5nID0gbmV3IE1hcDxzdHJpbmcsIFN0YWxlUG9yY2VsYWluUm93W10+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBjb25zdCBncm91cCA9IHJlbWFpbmluZy5nZXQocm93Lm5hbWUpO1xuICAgIGlmIChncm91cCkgZ3JvdXAucHVzaChyb3cpO1xuICAgIGVsc2UgcmVtYWluaW5nLnNldChyb3cubmFtZSwgW3Jvd10pO1xuICB9XG5cbiAgY29uc3Qgb3V0OiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgcGVuZGluZzogU3RhbGVQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBsZXQgaW5CdWxsZXRzID0gZmFsc2U7XG4gIGNvbnN0IGNsb3NlQnVsbGV0cyA9ICgpOiB2b2lkID0+IHtcbiAgICBmb3IgKGNvbnN0IHsgYWRkciwgc3RhdHVzZXMgfSBvZiBkZWR1cGVCeUFuY2hvcihwZW5kaW5nKSkge1xuICAgICAgb3V0LnB1c2goYC0gJHthZGRyfSBcdTIwMTQgJHtzdGF0dXNlcy5tYXAoaHVtYW5TdGF0dXNMYWJlbCkuam9pbignLCAnKX1gKTtcbiAgICB9XG4gICAgcGVuZGluZyA9IFtdO1xuICAgIGluQnVsbGV0cyA9IGZhbHNlO1xuICB9O1xuXG4gIGNvbnN0IHRyaW1tZWQgPSBibG9ja3NUZXh0LnRyaW0oKTtcbiAgaWYgKHRyaW1tZWQubGVuZ3RoID4gMCkge1xuICAgIGZvciAoY29uc3QgbGluZSBvZiB0cmltbWVkLnNwbGl0KCdcXG4nKSkge1xuICAgICAgY29uc3QgaGVhZGVyID0gL14jIyAoLispJC8uZXhlYyhsaW5lKTtcbiAgICAgIGlmIChoZWFkZXIpIHtcbiAgICAgICAgY2xvc2VCdWxsZXRzKCk7XG4gICAgICAgIG91dC5wdXNoKGxpbmUpO1xuICAgICAgICBwZW5kaW5nID0gcmVtYWluaW5nLmdldChoZWFkZXJbMV0pID8/IFtdO1xuICAgICAgICByZW1haW5pbmcuZGVsZXRlKGhlYWRlclsxXSk7XG4gICAgICAgIGluQnVsbGV0cyA9IHRydWU7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGluQnVsbGV0cyAmJiBsaW5lLnN0YXJ0c1dpdGgoJy0gJykpIHtcbiAgICAgICAgY29uc3QgYWRkciA9IGxpbmUuc2xpY2UoMik7XG4gICAgICAgIGNvbnN0IGV4YWN0ID0gcGVuZGluZy5maWx0ZXIoKHJvdykgPT4gYW5jaG9yVGV4dChyb3cpID09PSBhZGRyKTtcbiAgICAgICAgY29uc3QgbWF0Y2hlZCA9XG4gICAgICAgICAgZXhhY3QubGVuZ3RoID4gMCA/IGV4YWN0IDogcGVuZGluZy5maWx0ZXIoKHJvdykgPT4gYWRkciA9PT0gcm93LnBhdGggfHwgYWRkci5zdGFydHNXaXRoKGAke3Jvdy5wYXRofSNgKSk7XG4gICAgICAgIGlmIChtYXRjaGVkLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjb25zdCBtYXRjaGVkU2V0ID0gbmV3IFNldChtYXRjaGVkKTtcbiAgICAgICAgICBwZW5kaW5nID0gcGVuZGluZy5maWx0ZXIoKHJvdykgPT4gIW1hdGNoZWRTZXQuaGFzKHJvdykpO1xuICAgICAgICAgIGNvbnN0IHN0YXR1c2VzID0gWy4uLm5ldyBTZXQobWF0Y2hlZC5tYXAoKHJvdykgPT4gcm93LnN0YXR1cykpXS5zb3J0KCk7XG4gICAgICAgICAgb3V0LnB1c2goYCR7bGluZX0gXHUyMDE0ICR7c3RhdHVzZXMubWFwKGh1bWFuU3RhdHVzTGFiZWwpLmpvaW4oJywgJyl9YCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgb3V0LnB1c2gobGluZSk7XG4gICAgICAgIH1cbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoaW5CdWxsZXRzKSBjbG9zZUJ1bGxldHMoKTtcbiAgICAgIG91dC5wdXNoKGxpbmUpO1xuICAgIH1cbiAgICBjbG9zZUJ1bGxldHMoKTtcbiAgfVxuXG4gIGZvciAoY29uc3QgW25hbWUsIGdyb3VwXSBvZiByZW1haW5pbmcpIHtcbiAgICBpZiAob3V0Lmxlbmd0aCA+IDApIG91dC5wdXNoKCcnLCAnLS0tJywgJycpO1xuICAgIG91dC5wdXNoKGAjIyAke25hbWV9YCk7XG4gICAgZm9yIChjb25zdCB7IGFkZHIsIHN0YXR1c2VzIH0gb2YgZGVkdXBlQnlBbmNob3IoZ3JvdXApKSB7XG4gICAgICBvdXQucHVzaChgLSAke2FkZHJ9IFx1MjAxNCAke3N0YXR1c2VzLm1hcChodW1hblN0YXR1c0xhYmVsKS5qb2luKCcsICcpfWApO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBvdXQuam9pbignXFxuJyk7XG59XG5cbi8qKlxuICogVGhlIGZ1bGwtc3BhbiBjaGVja2xpc3QgYSBzZW1hbnRpYy1zdGFsZW5lc3MgYGRlbnlgIChvciwgaW4gYCdpbmZvcm0nYCBtb2RlLFxuICogYSBgc3RhdHVzYCBhZHZpc29yeSkgcmVuZGVycyBpbnRvIGByZWFzb25gLiBUaGUgY2xvc2luZyBzZW50ZW5jZSBkcm9wcyBcIlx1MjAxNFxuICogdGhlbiByZXRyeVwiIGluIGAnaW5mb3JtJ2AgbW9kZTogYSBgc3RhdHVzYCBjaGVjayBuZXZlciBoZWxkIGFueXRoaW5nLCBzb1xuICogdGhlcmUgaXMgbm90aGluZyB0byByZXRyeS5cbiAqL1xuZnVuY3Rpb24gcmVuZGVyU3RhbGVuZXNzUmVhc29uKFxuICBmaW5kaW5nczogU3RhbGVQb3JjZWxhaW5Sb3dbXSxcbiAgYmxvY2tzVGV4dDogc3RyaW5nLFxuICBtb2RlOiBHYXRlTW9kZSA9ICdlbmZvcmNlJyxcbiAgYWxyZWFkeVNlZW4gPSBmYWxzZVxuKTogc3RyaW5nIHtcbiAgY29uc3QgbmFtZXMgPSBbLi4ubmV3IFNldChmaW5kaW5ncy5tYXAoKHJvdykgPT4gcm93Lm5hbWUpKV07XG4gIGNvbnN0IHN1YmplY3QgPSBuYW1lcy5sZW5ndGggPT09IDEgPyAnYW4gaW1wbGljaXQgZGVwZW5kZW5jeScgOiAnaW1wbGljaXQgZGVwZW5kZW5jaWVzJztcbiAgY29uc3QgbmFtZSA9IG5hbWVzLmxlbmd0aCA9PT0gMSA/IG5hbWVzWzBdIDogJzxuYW1lPic7XG4gIGNvbnN0IGFjdGlvbiA9IGBcXGBnaXQgc3BhbiBhZGQgJHtuYW1lfSA8cGF0aCNMc3RhcnQtTGVuZD5cXGAgLyBcXGBnaXQgc3BhbiB3aHkgJHtuYW1lfSBcIi4uLlwiXFxgYDtcbiAgaWYgKGFscmVhZHlTZWVuKSB7XG4gICAgY29uc3QgcGF0aHMgPSBbLi4ubmV3IFNldChmaW5kaW5ncy5tYXAoKHJvdykgPT4gcm93LnBhdGgpKV07XG4gICAgY29uc3QgY2xvc2luZyA9XG4gICAgICBtb2RlID09PSAnZW5mb3JjZSdcbiAgICAgICAgPyBgQWxyZWFkeSBmbGFnZ2VkIGFib3ZlIFx1MjAxNCB1cGRhdGUgdGhlIGRyaWZ0ZWQgbG9jYXRpb25zIG9yIHRoZSBkZXNjcmlwdGlvbiwgdGhlbiByZXRyeS5gXG4gICAgICAgIDogYEFscmVhZHkgZmxhZ2dlZCBhYm92ZSBcdTIwMTQgdXBkYXRlIHRoZSBkcmlmdGVkIGxvY2F0aW9ucyBvciB0aGUgZGVzY3JpcHRpb24uYDtcbiAgICByZXR1cm4gW2BUaGlzIGNoYW5nZSBzdGlsbCBsZWF2ZXMgJHtzdWJqZWN0fSBvdXQgb2YgZGF0ZTpgLCAuLi5wYXRocy5tYXAoKHBhdGgpID0+IGAtICR7cGF0aH1gKSwgJycsIGNsb3NpbmddLmpvaW4oXG4gICAgICAnXFxuJ1xuICAgICk7XG4gIH1cbiAgY29uc3QgY2xvc2luZyA9XG4gICAgbW9kZSA9PT0gJ2VuZm9yY2UnXG4gICAgICA/IGBVcGRhdGUgdGhlIGRyaWZ0ZWQgbG9jYXRpb25zIG9yIHRoZSBkZXNjcmlwdGlvbiBcdTIwMTQgJHthY3Rpb259IFx1MjAxNCB0aGVuIHJldHJ5LiBJZiBhIGRlcGVuZGVuY3kgbm8gbG9uZ2VyIGhvbGRzLCB0ZWxsIHRoZSB1c2VyIGluc3RlYWQuYFxuICAgICAgOiBgVXBkYXRlIHRoZSBkcmlmdGVkIGxvY2F0aW9ucyBvciB0aGUgZGVzY3JpcHRpb24gXHUyMDE0ICR7YWN0aW9ufS4gSWYgYSBkZXBlbmRlbmN5IG5vIGxvbmdlciBob2xkcywgdGVsbCB0aGUgdXNlciBpbnN0ZWFkLmA7XG4gIHJldHVybiBbXG4gICAgYFRoaXMgY2hhbmdlIGxlYXZlcyAke3N1YmplY3R9IG91dCBvZiBkYXRlOmAsXG4gICAgJycsXG4gICAgYW5ub3RhdGVCbG9ja3MoYmxvY2tzVGV4dCwgZmluZGluZ3MpLFxuICAgICcnLFxuICAgICctLS0nLFxuICAgICcnLFxuICAgIGNsb3NpbmdcbiAgXS5qb2luKCdcXG4nKTtcbn1cblxuLyoqXG4gKiBXcmFwIGB0ZXh0YCBmb3IgZGVsaXZlcnkgYXMgYSBoYXJuZXNzJ3MgYGFkZGl0aW9uYWxDb250ZXh0YCwgc28gZXZlcnkgc3VjaFxuICogcGF5bG9hZCB0aGlzIGdhdGUgZW1pdHMgc2l0cyBpbnNpZGUgYSBgPGdpdC1zcGFuPi4uLjwvZ2l0LXNwYW4+YCBibG9jayBcdTIwMTRcbiAqIG1hdGNoaW5nIHRoZSB0b3VjaCBob29rJ3MgYmxvY2sgc3R5bGluZyBcdTIwMTQgbmV2ZXIgYmFyZSBwcm9zZS4gQSBuby1vcCB3aGVuXG4gKiBgdGV4dGAgYWxyZWFkeSBjYXJyaWVzIGEgYDxnaXQtc3Bhbj5gIHRhZyBzb21ld2hlcmUgKGUuZy5cbiAqIHtAbGluayByZW5kZXJVbmNvdmVyZWRSZWFzb259J3Mgb3V0cHV0IGFscmVhZHkgd3JhcHMgaXRzZWxmKSwgc28gYSBjYWxsZXJcbiAqIGNhbiBhcHBseSB0aGlzIHVuY29uZGl0aW9uYWxseSB3aXRob3V0IGV2ZXIgbmVzdGluZyBvbmUgYmxvY2sgaW5zaWRlXG4gKiBhbm90aGVyLlxuICovXG5leHBvcnQgZnVuY3Rpb24gd3JhcEdpdFNwYW5Db250ZXh0KHRleHQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICh0ZXh0LmluY2x1ZGVzKCc8Z2l0LXNwYW4+JykpIHJldHVybiB0ZXh0O1xuICByZXR1cm4gYDxnaXQtc3Bhbj5cXG4ke3RleHR9XFxuPC9naXQtc3Bhbj5gO1xufVxuXG4vKipcbiAqIFRoZSBhZHZpc29yeSBzdXJmYWNlZCB3aGVuIHRoZSBjaGFuZ2VzZXQncyBvbmx5IHN0YWxlbmVzcyBpcyBlbnZpcm9ubWVudGFsIFx1MjAxNFxuICogdGhlIGdhdGUgYWxsb3dzIGJ1dCBzYXlzIHdoeSwgc28gdGhlIHVucmVzb2x2YWJsZSBjb25kaXRpb24gaXMgbm90IHNpbGVudGx5XG4gKiBzd2FsbG93ZWQuXG4gKi9cbmZ1bmN0aW9uIHJlbmRlckVudmlyb25tZW50YWxSZWFzb24oY29uZGl0aW9uczogU3RhbGVQb3JjZWxhaW5Sb3dbXSwgYmxvY2tzVGV4dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIFtcbiAgICAnQ291bGQgbm90IGNoZWNrIHRoZXNlIGltcGxpY2l0IGRlcGVuZGVuY2llcyAodW5mZXRjaGVkIExGUywgc3BhcnNlIGNoZWNrb3V0LCBvciBzaW1pbGFyKSBcdTIwMTQgbm90IGJsb2NraW5nOicsXG4gICAgJycsXG4gICAgYW5ub3RhdGVCbG9ja3MoYmxvY2tzVGV4dCwgY29uZGl0aW9ucyksXG4gICAgJycsXG4gICAgJy0tLScsXG4gICAgJycsXG4gICAgJ0ZpeCB0aGUgY2hlY2tvdXQvZmV0Y2ggaXNzdWUgaWYgdGhlc2UgZGVwZW5kZW5jaWVzIG5lZWQgdmVyaWZ5aW5nLidcbiAgXS5qb2luKCdcXG4nKTtcbn1cblxuLyoqXG4gKiBUaGUgYWR2aXNvcnkgYW4gYGFsbG93YC9gc2Nhbi1mYWlsZWRgIHJlc3VsdCByZW5kZXJzIGludG8gYHJlYXNvbmA6IHRoZSBzY2FuXG4gKiBjb3VsZCBub3QgY29tcGxldGUsIHNvIHRoZSBjaGFuZ2VzZXQgd2FzIE5PVCB2ZXJpZmllZCBcdTIwMTQgYnV0IHRoZSBjb21tYW5kXG4gKiBwcm9jZWVkcyBhbnl3YXkgKGZhaWwtb3BlbiwgbWF0Y2hpbmcgYGVudmlyb25tZW50YWxgKS5cbiAqL1xuZnVuY3Rpb24gcmVuZGVyU2NhbkZhaWxlZFJlYXNvbihkZXRhaWw6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBbXG4gICAgJ1RoZSBpbXBsaWNpdC1kZXBlbmRlbmN5IGNoZWNrIGNvdWxkIG5vdCBydW4sIHNvIHRoaXMgY2hhbmdlIHdhcyBOT1QgdmVyaWZpZWQ6JyxcbiAgICBgICAke2RldGFpbH1gLFxuICAgICcnLFxuICAgICdUaGUgY29tbWFuZCBwcm9jZWVkcyBhbnl3YXkuIEZpeCB0aGUgc2NhbiBlcnJvciBpZiB2ZXJpZmljYXRpb24gbWF0dGVycyBmb3IgdGhpcyBjaGFuZ2UuJ1xuICBdLmpvaW4oJ1xcbicpO1xufVxuXG4vKipcbiAqIEdyb3VwIGBjb3ZlcmluZ2AgXHUyMDE0IHRoZSByb3dzIHtAbGluayBjb21wdXRlVW5jb3ZlcmVkUGF0aHN9IGFscmVhZHkgcmVzb2x2ZWRcbiAqIGZvciB0aGUgcmVzdCBvZiB0aGUgY2hhbmdlc2V0IFx1MjAxNCBieSBzcGFuIG5hbWUsIGVhY2ggYW5jaG9yIHJlbmRlcmVkIHZpYVxuICoge0BsaW5rIGFuY2hvclRleHR9LiBPbmx5IGFuY2hvcnMgd2hvc2UgYHBhdGhgIGlzIG9uZSBvZiB0aGUgcGF0aHNcbiAqIGBleGVjdXRvcnMubGlzdGAgd2FzIHNjb3BlZCB0byBhcHBlYXIgaGVyZTsgYSBzcGFuJ3MgKm90aGVyKiBhbmNob3JzIChpblxuICogZmlsZXMgb3V0c2lkZSB0aGlzIGNoYW5nZXNldCkgbmV2ZXIgZG8sIHNpbmNlIGBjb3ZlcmluZ2AgbmV2ZXIgY29udGFpbmVkXG4gKiB0aGVtIHRvIGJlZ2luIHdpdGguIERlZHVwZWQgKHR3byBjb3ZlcmVkIGZpbGVzIHVuZGVyIHRoZSBzYW1lIG5hbWUgY29sbGFwc2VcbiAqIHRvIG9uZSBlbnRyeSBlYWNoKSBhbmQgc29ydGVkIFx1MjAxNCBzcGFuIG5hbWVzLCB0aGVuIGFuY2hvcnMgd2l0aGluIGFcbiAqIG5hbWUgXHUyMDE0IHNvIHRoZSByZW5kZXJlZCBvcmRlciBpcyBzdGFibGUgYWNyb3NzIHJ1bnMgb3ZlciB0aGUgc2FtZSBzdGF0ZS5cbiAqL1xuZnVuY3Rpb24gZ3JvdXBDb3ZlcmluZ0J5TmFtZShjb3ZlcmluZzogUG9yY2VsYWluUm93W10pOiB7IG5hbWU6IHN0cmluZzsgYW5jaG9yczogc3RyaW5nW10gfVtdIHtcbiAgY29uc3QgYnlOYW1lID0gbmV3IE1hcDxzdHJpbmcsIFNldDxzdHJpbmc+PigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiBjb3ZlcmluZykge1xuICAgIGNvbnN0IGFuY2hvcnMgPSBieU5hbWUuZ2V0KHJvdy5uYW1lKSA/PyBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICBhbmNob3JzLmFkZChhbmNob3JUZXh0KHJvdykpO1xuICAgIGJ5TmFtZS5zZXQocm93Lm5hbWUsIGFuY2hvcnMpO1xuICB9XG4gIHJldHVybiBbLi4uYnlOYW1lLmtleXMoKV0uc29ydCgpLm1hcCgobmFtZSkgPT4gKHsgbmFtZSwgYW5jaG9yczogWy4uLihieU5hbWUuZ2V0KG5hbWUpID8/IFtdKV0uc29ydCgpIH0pKTtcbn1cblxuLyoqXG4gKiBUaGUgXCJvdGhlciBmaWxlcyBpbiB0aGlzIGNoYW5nZSBhbHJlYWR5IGJlbG9uZyB0byBzcGFuc1wiIHNlY3Rpb24gYXBwZW5kZWRcbiAqIHRvIHtAbGluayByZW5kZXJVbmNvdmVyZWRSZWFzb259J3Mgb3V0cHV0IFx1MjAxNCBlbXB0eSAocmVuZGVycyBub3RoaW5nKSB3aGVuXG4gKiBgY292ZXJpbmdgIGlzIGVtcHR5LCBpLmUuIG5vIG90aGVyIGZpbGUgaW4gdGhlIGNoYW5nZXNldCBoYXMgYW55IHNwYW5cbiAqIGNvdmVyYWdlLiBEZWxpYmVyYXRlbHkgdGlnaHRlciB0aGFuIHRoZSBzdGFsZW5lc3MvZW52aXJvbm1lbnRhbCBibG9ja3NcbiAqIGVsc2V3aGVyZSBpbiB0aGlzIGZpbGU6IG5vIGB3aHlgIHNlbnRlbmNlLCBubyBhbmNob3JzIG91dHNpZGUgdGhpc1xuICogY2hhbmdlc2V0LCBubyBgbGlzdEJsb2Nrc2Agcm91bmQtdHJpcCBcdTIwMTQganVzdCB0aGUgbmFtZSBhbmQgdGhlIGluLWNoYW5nZXNldFxuICogYW5jaG9yKHMpLCByZWFkIHN0cmFpZ2h0IGZyb20gZGF0YSBgY29tcHV0ZVVuY292ZXJlZFBhdGhzYCBhbHJlYWR5IGZldGNoZWQuXG4gKiBVbmNhcHBlZCBieSBkZXNpZ246IGV2ZXJ5IHF1YWxpZnlpbmcgc3Bhbi9hbmNob3IgaXMgbGlzdGVkLlxuICovXG5mdW5jdGlvbiByZW5kZXJSZWxhdGVkU3BhbnNTZWN0aW9uKGNvdmVyaW5nOiBQb3JjZWxhaW5Sb3dbXSk6IHN0cmluZ1tdIHtcbiAgaWYgKGNvdmVyaW5nLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICBjb25zdCBsaW5lcyA9IFtcbiAgICAnJyxcbiAgICAnLS0tJyxcbiAgICAnJyxcbiAgICAnT3RoZXIgZmlsZXMgaW4gdGhpcyBjaGFuZ2UgYWxyZWFkeSBiZWxvbmcgdG8gc3BhbnMgXHUyMDE0IGFuIHVuY292ZXJlZCBmaWxlIGFib3ZlIG1pZ2h0IGJlbG9uZyB3aXRoIG9uZSBvZiB0aGVzZSBpbnN0ZWFkIG9mIGEgbmV3IG9uZTonXG4gIF07XG4gIGZvciAoY29uc3QgeyBuYW1lLCBhbmNob3JzIH0gb2YgZ3JvdXBDb3ZlcmluZ0J5TmFtZShjb3ZlcmluZykpIHtcbiAgICBsaW5lcy5wdXNoKCcnLCBgIyMgJHtuYW1lfWAsIC4uLmFuY2hvcnMubWFwKChhbmNob3IpID0+IGAtICR7YW5jaG9yfWApKTtcbiAgfVxuICByZXR1cm4gbGluZXM7XG59XG5cbi8qKlxuICogVGhlIGxpc3QgYW4gdW5jb3ZlcmVkLXdyaXRlcyBgZGVueWAgKG9yLCBpbiBgJ2luZm9ybSdgIG1vZGUsIGEgYHN0YXR1c2BcbiAqIGFkdmlzb3J5KSByZW5kZXJzIGludG8gYHJlYXNvbmAsIHdyYXBwZWQgaW4gYSBgPGdpdC1zcGFuPmAgYmxvY2sgbWF0Y2hpbmcgdGhlXG4gKiB0b3VjaCBob29rJ3MgYmxvY2sgc3R5bGluZy4gVGhlIFwicmV0cnkgdGhlIGNvbW1hbmQgdG8gcHJvY2VlZCAob25lLXRpbWVcbiAqIGNoZWNrKVwiIHNlbnRlbmNlIGRyb3BzIGVudGlyZWx5IGluIGAnaW5mb3JtJ2AgbW9kZTogYSBgc3RhdHVzYCBjaGVjayBuZXZlclxuICogaGVsZCBhbnl0aGluZywgc28gdGhlcmUgaXMgbm90aGluZyB0byByZXRyeSBhbmQgbm8gY29uc2lkZXItb25jZSBzdGF0ZSB0b1xuICogY2xlYXIuIGBjb3ZlcmluZ2AgXHUyMDE0IHRoZSByZXN0IG9mIHRoZSBjaGFuZ2VzZXQncyBleGlzdGluZyBzcGFuIGNvdmVyYWdlLFxuICogZnJvbSB0aGUgc2FtZSB7QGxpbmsgY29tcHV0ZVVuY292ZXJlZFBhdGhzfSBjYWxsIFx1MjAxNCByZW5kZXJzIGFzIGEgcmVsYXRlZC1cbiAqIHNwYW5zIHNlY3Rpb24gKHZpYSB7QGxpbmsgcmVuZGVyUmVsYXRlZFNwYW5zU2VjdGlvbn0pIGluIGJvdGggdGhlIGZ1bGwgYW5kXG4gKiBgYWxyZWFkeVNlZW5gIGNvbmRlbnNlZCBmb3JtczogaXQncyBzdXBwbGVtZW50YXJ5IGNvbnRleHQgYWJvdXQgdGhlXG4gKiBjaGFuZ2VzZXQsIG5vdCBpdHNlbGYgcGFydCBvZiB3aGF0J3MgZmxhZ2dlZCBvciBjb25zaWRlci1vbmNlJ2QuXG4gKi9cbmZ1bmN0aW9uIHJlbmRlclVuY292ZXJlZFJlYXNvbihcbiAgdW5jb3ZlcmVkOiBzdHJpbmdbXSxcbiAgY292ZXJpbmc6IFBvcmNlbGFpblJvd1tdLFxuICBtb2RlOiBHYXRlTW9kZSA9ICdlbmZvcmNlJyxcbiAgYWxyZWFkeVNlZW4gPSBmYWxzZVxuKTogc3RyaW5nIHtcbiAgY29uc3QgbGluZXMgPSB1bmNvdmVyZWQubWFwKChwYXRoKSA9PiBgLSAke3BhdGh9YCk7XG4gIGlmIChhbHJlYWR5U2Vlbikge1xuICAgIGNvbnN0IGJvZHkgPSBbJzxnaXQtc3Bhbj4nLCAuLi5saW5lcywgJycsICdBbHJlYWR5IGZsYWdnZWQgZm9yIGdpdC1zcGFuIHJldmlldyBhYm92ZS4nXTtcbiAgICBib2R5LnB1c2goLi4ucmVuZGVyUmVsYXRlZFNwYW5zU2VjdGlvbihjb3ZlcmluZykpO1xuICAgIGlmIChtb2RlID09PSAnZW5mb3JjZScpIHtcbiAgICAgIGJvZHkucHVzaCgnJywgJ0lmIG5vbmUgZXhpc3QsIHJldHJ5IHRoZSBjb21tYW5kIHRvIHByb2NlZWQgKG9uZS10aW1lIGNoZWNrKS4nKTtcbiAgICB9XG4gICAgYm9keS5wdXNoKCc8L2dpdC1zcGFuPicpO1xuICAgIHJldHVybiBib2R5LmpvaW4oJ1xcbicpO1xuICB9XG4gIGNvbnN0IGJvZHkgPSBbXG4gICAgJzxnaXQtc3Bhbj4nLFxuICAgIC4uLmxpbmVzLFxuICAgICcnLFxuICAgIHVuY292ZXJlZC5sZW5ndGggPT09IDFcbiAgICAgID8gJ0RldGVybWluZSBpZiB0aGlzIGZpbGUgY2FycmllcyBpbXBsaWNpdCBkZXBlbmRlbmNpZXMsIHRoZW4gdXNlIGBnaXQgc3BhbmAgdG8gZG9jdW1lbnQgdGhlbTonXG4gICAgICA6ICdEZXRlcm1pbmUgaWYgdGhlc2UgZmlsZXMgY2FycnkgaW1wbGljaXQgZGVwZW5kZW5jaWVzLCB0aGVuIHVzZSBgZ2l0IHNwYW5gIHRvIGRvY3VtZW50IHRoZW06JyxcbiAgICAnJyxcbiAgICAnYGdpdCBzcGFuIGFkZCA8bmFtZT4gPHBhdGgjTHN0YXJ0LUxlbmQ+IFs8cGF0aCNMc3RhcnQtTGVuZD5dIC4uLmAnLFxuICAgICdgZ2l0IHNwYW4gd2h5IDxuYW1lPiBcIjx3aHk+XCJgJyxcbiAgICAnJyxcbiAgICAnVGhlIFwiPHdoeT5cIiBpcyBhIHNpbmdsZSBwcmVzZW50LXRlbnNlIHNlbnRlbmNlIG5hbWluZyB3aGF0IHRoZSByYW5nZXMgZm9ybSB0b2dldGhlciwgc3BlY2lmaWMgZW5vdWdoIHRvIHRlbGwgd2hldGhlciBhbiBlZGl0IGxhbmRzIGluc2lkZSBpdCwgd2l0aCBubyBydWxlcyBvciByZW1pbmRlcnMuJ1xuICBdO1xuICBib2R5LnB1c2goLi4ucmVuZGVyUmVsYXRlZFNwYW5zU2VjdGlvbihjb3ZlcmluZykpO1xuICBpZiAobW9kZSA9PT0gJ2VuZm9yY2UnKSB7XG4gICAgYm9keS5wdXNoKCcnLCAnSWYgbm9uZSBleGlzdCwgcmV0cnkgdGhlIGNvbW1hbmQgdG8gcHJvY2VlZCAob25lLXRpbWUgY2hlY2spLicpO1xuICB9XG4gIGJvZHkucHVzaCgnJywgJ0xvYWQgdGhlIGBnaXQtc3BhbjpnaXQtc3BhbmAgc2tpbGwgZm9yIGd1aWRhbmNlLicsICc8L2dpdC1zcGFuPicpO1xuICByZXR1cm4gYm9keS5qb2luKCdcXG4nKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBEZWZhdWx0IHN1YnByb2Nlc3MvZGlzay1iYWNrZWQgZGVwZW5kZW5jaWVzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vXG4vLyBUaGUgcHJvZHVjdGlvbiBzdXJmYWNlcyBib3RoIGFkYXB0ZXJzIGluamVjdCBieSBkZWZhdWx0LCBmb2xsb3dpbmdcbi8vIHRvdWNoLWNvcmUudHMncyBgY3JlYXRlRGVmYXVsdFRvdWNoRXhlY3V0b3JzYCBzdHlsZTogZWFjaCBjYXB0dXJlcyBzdGRvdXQgZXZlblxuLy8gb24gYSBub24temVybyBleGl0IHdoZXJlIHRoZSBDTEkgc3RpbGwgZW1pdHMgdXNlZnVsIG91dHB1dCwgYW5kIGV2ZXJ5IGZhaWx1cmVcbi8vIG1vZGUgKGFic2VudCBiaW5hcnksIHRpbWVvdXQsIG5vIHJlcG8pIHN1cmZhY2VzIGFzIGFuIGVtcHR5L2NsZWFuIHJlc3VsdCBzb1xuLy8gdGhlIGdhdGUncyBmYWlsLW9wZW4gY29udHJhY3QgaG9sZHMgd2l0aG91dCB0aGUgYWRhcHRlciBhZGRpbmcgaXRzIG93bi5cblxuY29uc3QgREVGQVVMVF9USU1FT1VUX01TID0gMTBfMDAwO1xuXG4vKiogUnVuIGEgZ2l0IGNvbW1hbmQgYXQgYGN3ZGAsIHJldHVybmluZyB0cmltbWVkIG5vbi1lbXB0eSBQT1NJWCBvdXRwdXQgbGluZXMgKGVtcHR5IG9uIGFueSBmYWlsdXJlKS4gKi9cbmZ1bmN0aW9uIGdpdExpbmVzKGFyZ3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZywgdGltZW91dE1zOiBudW1iZXIpOiBzdHJpbmdbXSB7XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBhcmdzLCB7XG4gICAgICBjd2QsXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICB9KTtcbiAgICByZXR1cm4gb3V0XG4gICAgICAuc3BsaXQoJ1xcbicpXG4gICAgICAubWFwKChsaW5lKSA9PiBsaW5lLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoKGxpbmUpID0+IGxpbmUubGVuZ3RoID4gMClcbiAgICAgIC5tYXAodG9Qb3NpeCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBbXTtcbiAgfVxufVxuXG4vKipcbiAqIExpa2Uge0BsaW5rIGdpdExpbmVzfSBidXQgZGlzdGluZ3Vpc2hlcyBhICpmYWlsZWQqIGludm9jYXRpb24gKGBudWxsYCBcdTIwMTQgZS5nLlxuICogYEB7dX1gIHdpdGggbm8gdXBzdHJlYW0gY29uZmlndXJlZCkgZnJvbSBhICpzdWNjZXNzZnVsIGJ1dCBlbXB0eSogcmVzdWx0XG4gKiAoYFtdYCksIHNvIHRoZSBvdXRnb2luZy1yYW5nZSByZXNvbHV0aW9uIGtub3dzIHdoZW4gdG8gdHJ5IHRoZSBtZXJnZS1iYXNlXG4gKiBmYWxsYmFjayByYXRoZXIgdGhhbiBtaXN0YWtpbmcgXCJubyB1cHN0cmVhbVwiIGZvciBcIm5vdGhpbmcgdG8gcHVzaFwiLlxuICovXG5mdW5jdGlvbiBnaXRMaW5lc09yTnVsbChhcmdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcsIHRpbWVvdXRNczogbnVtYmVyKTogc3RyaW5nW10gfCBudWxsIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIGFyZ3MsIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgIH0pO1xuICAgIHJldHVybiBvdXRcbiAgICAgIC5zcGxpdCgnXFxuJylcbiAgICAgIC5tYXAoKGxpbmUpID0+IGxpbmUudHJpbSgpKVxuICAgICAgLmZpbHRlcigobGluZSkgPT4gbGluZS5sZW5ndGggPiAwKVxuICAgICAgLm1hcCh0b1Bvc2l4KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqIFRoZSBwcm9kdWN0aW9uIHtAbGluayBHaXRFeGVjdXRvcn06IGBnaXQgZGlmZmAgcmVhZHMgc2NvcGVkIHRvIHRoZSBDV0QgcmVwby4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0R2l0RXhlY3V0b3IodGltZW91dE1zOiBudW1iZXIgPSBERUZBVUxUX1RJTUVPVVRfTVMpOiBHaXRFeGVjdXRvciB7XG4gIHJldHVybiB7XG4gICAgc3RhZ2VkUGF0aHM6IGFzeW5jIChjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290KSByZXR1cm4gW107XG4gICAgICByZXR1cm4gZ2l0TGluZXMoWyctQycsIHJlcG9Sb290LCAnZGlmZicsICctLWNhY2hlZCcsICctLW5hbWUtb25seSddLCByZXBvUm9vdCwgdGltZW91dE1zKTtcbiAgICB9LFxuICAgIHRyYWNrZWRNb2RpZmllZFBhdGhzOiBhc3luYyAoY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCkgcmV0dXJuIFtdO1xuICAgICAgcmV0dXJuIGdpdExpbmVzKFsnLUMnLCByZXBvUm9vdCwgJ2RpZmYnLCAnLS1uYW1lLW9ubHknXSwgcmVwb1Jvb3QsIHRpbWVvdXRNcyk7XG4gICAgfSxcbiAgICBvdXRnb2luZ1BhdGhzOiBhc3luYyAoY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCkgcmV0dXJuIFtdO1xuICAgICAgY29uc3QgdXBzdHJlYW0gPSBnaXRMaW5lc09yTnVsbChbJy1DJywgcmVwb1Jvb3QsICdkaWZmJywgJy0tbmFtZS1vbmx5JywgJ0B7dX0uLkhFQUQnXSwgcmVwb1Jvb3QsIHRpbWVvdXRNcyk7XG4gICAgICBpZiAodXBzdHJlYW0gIT09IG51bGwpIHJldHVybiB1cHN0cmVhbTtcbiAgICAgIC8vIE5vIHVwc3RyZWFtIGNvbmZpZ3VyZWQ6IGZhbGwgYmFjayB0byB0aGUgbWVyZ2UtYmFzZSB3aXRoIHRoZSBkZWZhdWx0XG4gICAgICAvLyByZW1vdGUgYnJhbmNoIChgb3JpZ2luL0hFQURgKS4gSWYgdGhhdCB0b28gaXMgdW5yZXNvbHZhYmxlLCBmYWlsIG9wZW4uXG4gICAgICBjb25zdCBiYXNlID0gZ2l0TGluZXMoWyctQycsIHJlcG9Sb290LCAnbWVyZ2UtYmFzZScsICdIRUFEJywgJ29yaWdpbi9IRUFEJ10sIHJlcG9Sb290LCB0aW1lb3V0TXMpWzBdO1xuICAgICAgaWYgKCFiYXNlKSByZXR1cm4gW107XG4gICAgICByZXR1cm4gZ2l0TGluZXMoWyctQycsIHJlcG9Sb290LCAnZGlmZicsICctLW5hbWUtb25seScsIGAke2Jhc2V9Li5IRUFEYF0sIHJlcG9Sb290LCB0aW1lb3V0TXMpO1xuICAgIH0sXG4gICAgcGF0aHNwZWNQYXRoczogYXN5bmMgKHBhdGhzLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290IHx8IHBhdGhzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICAgICAgLy8gV29ya2luZy10cmVlIGNvbnRlbnQgdnMgSEVBRCwgc2NvcGVkIHRvIHRoZSBwYXRoc3BlY3MgXHUyMDE0IHRoZSBmaWxlcyBhXG4gICAgICAvLyBgZ2l0IGNvbW1pdCAtLSA8cGF0aHNwZWM+YCB3b3VsZCBhY3R1YWxseSBjaGFuZ2UgKHN0YWdlZCBvciBub3QpLlxuICAgICAgcmV0dXJuIGdpdExpbmVzKFsnLUMnLCByZXBvUm9vdCwgJ2RpZmYnLCAnSEVBRCcsICctLW5hbWUtb25seScsICctLScsIC4uLnBhdGhzXSwgcmVwb1Jvb3QsIHRpbWVvdXRNcyk7XG4gICAgfVxuICB9O1xufVxuXG4vKiogVGhlIHByb2R1Y3Rpb24ge0BsaW5rIEdhdGVFeGVjdXRvcnN9OiBzY29wZWQgYGdpdCBzcGFuYCBmaXgvc3RhbGUvbGlzdCBhdCB0aGUgcmVwbyByb290LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHRHYXRlRXhlY3V0b3JzKHRpbWVvdXRNczogbnVtYmVyID0gREVGQVVMVF9USU1FT1VUX01TKTogR2F0ZUV4ZWN1dG9ycyB7XG4gIHJldHVybiB7XG4gICAgZml4OiBhc3luYyAocGF0aHMsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGlmICghcmVwb1Jvb3QgfHwgcGF0aHMubGVuZ3RoID09PSAwKSByZXR1cm47XG4gICAgICB0cnkge1xuICAgICAgICBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdzdGFsZScsIC4uLnBhdGhzLCAnLS1maXgnXSwge1xuICAgICAgICAgIGN3ZDogcmVwb1Jvb3QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIC8vIGBnaXQgc3BhbiBzdGFsZWAgZXhpdHMgMSBvbiBkcmlmdCBldmVuIGFmdGVyIGhlYWxpbmcsIGFuZCBub24temVybyBvblxuICAgICAgICAvLyBnZW51aW5lIGZhaWx1cmU7IGVpdGhlciB3YXkgdGhlIHN1YnNlcXVlbnQgYHN0YWxlYCByZWFkIGlzIHRoZSBzb3VyY2VcbiAgICAgICAgLy8gb2YgdHJ1dGgsIHNvIHRoZSBleGl0IGNvZGUgaXMgaWdub3JlZCBoZXJlLlxuICAgICAgICB2b2lkIGVycjtcbiAgICAgIH1cbiAgICB9LFxuICAgIHN0YWxlOiBhc3luYyAocGF0aHMsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGlmICghcmVwb1Jvb3QgfHwgcGF0aHMubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gICAgICBsZXQgb3V0OiBzdHJpbmc7XG4gICAgICB0cnkge1xuICAgICAgICBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdzdGFsZScsICctLWZvcm1hdCcsICdwb3JjZWxhaW4nLCAuLi5wYXRoc10sIHtcbiAgICAgICAgICBjd2Q6IHJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAvLyBgZ2l0IHNwYW4gc3RhbGVgIGV4aXRzIG5vbi16ZXJvIGluIHR3byB2ZXJ5IGRpZmZlcmVudCB3YXlzLCBhbmQgdGhleVxuICAgICAgICAvLyBtdXN0IG5vdCBiZSBjb25mbGF0ZWQ6XG4gICAgICAgIC8vICAtIExlZ2l0aW1hdGUgZHJpZnQ6IHJlYWwgcG9yY2VsYWluIHJvd3Mgb24gc3Rkb3V0IGRlc2NyaWJpbmcgdGhlXG4gICAgICAgIC8vICAgIGRyaWZ0LiBQYXJzZSB0aGVtICh0aGlzIGlzIHRoZSB3aG9sZSBwb2ludCBvZiB0aGUgcmVhZCkuXG4gICAgICAgIC8vICAtIEhhcmQgc2NhbiBmYWlsdXJlOiB0aGUgc2NvcGVkIHF1ZXJ5IGFib3J0ZWQgYmVmb3JlIGNvbXBsZXRpbmcgKGUuZy5cbiAgICAgICAgLy8gICAgYW4gdW5yZWFkYWJsZSBhbmNob3IgZmlsZSksIHdyaXRpbmcgYW4gZXJyb3IgdG8gc3RkZXJyIGFuZCBlbWl0dGluZ1xuICAgICAgICAvLyAgICBlbXB0eSBzdGRvdXQuIEFuIGVtcHR5IHJlc3VsdCBoZXJlIGlzIE5PVCBcImNsZWFuXCIgXHUyMDE0IHRoZSBzY2FuIG5ldmVyXG4gICAgICAgIC8vICAgIHJhbiB0byBjb21wbGV0aW9uIFx1MjAxNCBzbyBzaWduYWwgaXQgZGlzdGluY3RseSByYXRoZXIgdGhhbiBwYXJzaW5nIHRvXG4gICAgICAgIC8vICAgIGBbXWAsIHdoaWNoIHdvdWxkIHJlYWQgYXMgYSBjbGVhbiBwYXNzIGFuZCBzaWxlbnRseSBhbGxvdyB0aGUgY29tbWl0LlxuICAgICAgICBjb25zdCBzdGRvdXQgPSAoZXJyIGFzIHsgc3Rkb3V0Pzogc3RyaW5nIH0pLnN0ZG91dDtcbiAgICAgICAgY29uc3Qgc3RkZXJyID0gKGVyciBhcyB7IHN0ZGVycj86IHN0cmluZyB9KS5zdGRlcnI7XG4gICAgICAgIGNvbnN0IHN0ZG91dFRleHQgPSB0eXBlb2Ygc3Rkb3V0ID09PSAnc3RyaW5nJyA/IHN0ZG91dCA6ICcnO1xuICAgICAgICBjb25zdCBzdGRlcnJUZXh0ID0gdHlwZW9mIHN0ZGVyciA9PT0gJ3N0cmluZycgPyBzdGRlcnIgOiAnJztcbiAgICAgICAgaWYgKHN0ZG91dFRleHQudHJpbSgpLmxlbmd0aCA9PT0gMCAmJiBzdGRlcnJUZXh0LnRyaW0oKS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEdhdGVTY2FuRXJyb3Ioc3RkZXJyVGV4dC50cmltKCkpO1xuICAgICAgICB9XG4gICAgICAgIG91dCA9IHN0ZG91dFRleHQ7XG4gICAgICB9XG4gICAgICByZXR1cm4gcGFyc2VTdGFsZVBvcmNlbGFpbihvdXQpO1xuICAgIH0sXG4gICAgbGlzdDogYXN5bmMgKHBhdGhzLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290IHx8IHBhdGhzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnbGlzdCcsICctLXBvcmNlbGFpbicsIC4uLnBhdGhzXSwge1xuICAgICAgICAgIGN3ZDogcmVwb1Jvb3QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gcGFyc2VQb3JjZWxhaW4ob3V0KTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gW107XG4gICAgICB9XG4gICAgfSxcbiAgICBsaXN0QmxvY2tzOiBhc3luYyAobmFtZXMsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGlmICghcmVwb1Jvb3QgfHwgbmFtZXMubGVuZ3RoID09PSAwKSByZXR1cm4gJyc7XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnbGlzdCcsIC4uLm5hbWVzXSwge1xuICAgICAgICAgIGN3ZDogcmVwb1Jvb3QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIEEgZmFpbGVkIGh1bWFuLWZvcm1hdCByZWFkIG9ubHkgZGVncmFkZXMgdGhlIHJlbmRlcmVkIG1lc3NhZ2VcbiAgICAgICAgLy8gKGFubm90YXRlQmxvY2tzIHN5bnRoZXNpemVzIG1pbmltYWwgYmxvY2tzKTsgbmV2ZXIgYSBnYXRlIGVycm9yLlxuICAgICAgICByZXR1cm4gJyc7XG4gICAgICB9XG4gICAgfVxuICB9O1xufVxuXG4vKipcbiAqIFRoZSBwcm9kdWN0aW9uIGRpc2stYmFja2VkIHtAbGluayBHYXRlTWVtb1N0YXRlfTogb25lIG1hcmtlciBmaWxlIHBlciBkZWJ0LXN0YXRlXG4gKiBkaWdlc3QgdW5kZXIge0BsaW5rIGdhdGVNZW1vRGlyfSAoYDxnaXQtY29tbW9uLWRpcj4vZ2l0LXNwYW4vZ2F0ZS9gKSwgZm9sbG93aW5nXG4gKiBzcGFuLXN1cmZhY2UudHMncyBmaWxlLWJhY2tlZCBgTWVtb1N0b3JlYCBwYXR0ZXJuLiBUaGUgZGlnZXN0IGlzIGEgaGV4IHNoYTI1NixcbiAqIGEgc2FmZSBmaWxlbmFtZS4gQmVzdC1lZmZvcnQgYW5kIG5vbi10aHJvd2luZzogYSBtZW1vIHdob3NlIHJlcG8gY2Fubm90IGJlXG4gKiByZXNvbHZlZCBkZWdyYWRlcyB0byBhIG5vLW9wIHN0b3JlIChuZXZlciBwZXJzaXN0cyBcdTIxOTIgdW5jb3ZlcmVkIHdvdWxkIHJlLWRlbnksXG4gKiBidXQgYW4gdW5yZXNvbHZhYmxlIHJlcG8geWllbGRzIGFuIGVtcHR5IGNoYW5nZXNldCB1cHN0cmVhbSBhbnl3YXkpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGlza0dhdGVNZW1vU3RhdGUoY3dkOiBzdHJpbmcpOiBHYXRlTWVtb1N0YXRlIHtcbiAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgaWYgKCFyZXBvUm9vdCkge1xuICAgIC8vIE5vIHJlc29sdmFibGUgcmVwbyBcdTIxOTIgdGhlIG1lbW8gY2Fubm90IHBlcnNpc3QuIFJlcG9ydCBgZmFsc2VgIGZyb21cbiAgICAvLyBgcmVjb3JkYCBzbyB0aGUgZ2F0ZSBmYWlscyBvcGVuIHJhdGhlciB0aGFuIGRlbnlpbmcgd2l0aCBubyBlc2NhcGUuXG4gICAgcmV0dXJuIHsgaGFzOiAoKSA9PiBmYWxzZSwgcmVjb3JkOiAoKSA9PiBmYWxzZSB9O1xuICB9XG4gIGNvbnN0IGRpciA9IGdhdGVNZW1vRGlyKHJlcG9Sb290KTtcbiAgcmV0dXJuIHtcbiAgICBoYXM6IChkaWdlc3QpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBmcy5leGlzdHNTeW5jKG5vZGVQYXRoLmpvaW4oZGlyLCBkaWdlc3QpKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgfSxcbiAgICByZWNvcmQ6IChkaWdlc3QpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGZzLm1rZGlyU3luYyhkaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICBmcy53cml0ZUZpbGVTeW5jKG5vZGVQYXRoLmpvaW4oZGlyLCBkaWdlc3QpLCAnJyk7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIEEgZmFpbGVkIG1lbW8gd3JpdGUgbXVzdCBuZXZlciBicmljayB0aGUgY29tbWl0IGFuZCBtdXN0IG5ldmVyXG4gICAgICAgIC8vIHNpbGVudGx5IHJlLWRlbnkgZm9yZXZlcjogcmVwb3J0IHRoZSBmYWlsdXJlIHNvIHRoZSBnYXRlIGZhaWxzIG9wZW4uXG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG59XG4iLCAiLyoqXG4gKiBTaGFyZWQgaGVscGVycyB1c2VkIGJ5IG11bHRpcGxlIGFnZW50LWhvb2tzIGVudHJ5IHBvaW50cy5cbiAqXG4gKiBFeHRyYWN0ZWQgZnJvbSBwcmUtdG9vbC11c2UudHMgc28gdGhhdCB0aGUgdXBjb21pbmcgU3RvcCBob29rIChhbmQgYW55XG4gKiBmdXR1cmUgaG9va3MpIGNhbiBpbXBvcnQgcGF0aCB1dGlsaXRpZXMsIHJhbmdlIGhlbHBlcnMsIGFuZCB0aGVcbiAqIHNhbml0aXplU2Vzc2lvbklkL2Zvcm1hdEFuY2hvciBmdW5jdGlvbnMgd2l0aG91dCBkZXBlbmRpbmcgb24gdGhlXG4gKiBQcmVUb29sVXNlLXNwZWNpZmljIG1vZHVsZS5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBvcyBmcm9tICdub2RlOm9zJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUGF0aCBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGZ1bmN0aW9uIHRvUG9zaXgocDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHAucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xufVxuXG5mdW5jdGlvbiBpc0Fic29sdXRlUG9zaXgocDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBwLnN0YXJ0c1dpdGgoJy8nKSB8fCAvXltBLVphLXpdOlxcLy8udGVzdChwKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFic3BhdGhBZ2FpbnN0KGJhc2U6IHN0cmluZywgdGFyZ2V0OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0ID0gdG9Qb3NpeCh0YXJnZXQpO1xuICBpZiAoaXNBYnNvbHV0ZVBvc2l4KHQpKSByZXR1cm4gdDtcbiAgY29uc3QgYiA9IHRvUG9zaXgoYmFzZSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIHJldHVybiBgJHtifS8ke3R9YDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVSZXBvUm9vdChkaXI6IHN0cmluZyB8IHVuZGVmaW5lZCB8IG51bGwpOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKCFkaXIpIHJldHVybiBudWxsO1xuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIGRpciwgJ3Jldi1wYXJzZScsICctLXNob3ctdG9wbGV2ZWwnXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnXG4gICAgfSk7XG4gICAgY29uc3QgdHJpbW1lZCA9IG91dC50cmltKCk7XG4gICAgcmV0dXJuIHRyaW1tZWQubGVuZ3RoID4gMCA/IHRvUG9zaXgodHJpbW1lZCkgOiBudWxsO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKipcbiAqIFJlcG9ydCB3aGV0aGVyIGEgcmVwby1yZWxhdGl2ZSBwYXRoIGlzIGV4Y2x1ZGVkIGJ5IGdpdCdzIGlnbm9yZSBydWxlc1xuICogKC5naXRpZ25vcmUsIC5naXQvaW5mby9leGNsdWRlLCBjb3JlLmV4Y2x1ZGVzRmlsZSkuIFVzZWQgdG8ga2VlcCBpZ25vcmVkXG4gKiBmaWxlcyBcdTIwMTQgYnVpbGQgb3V0cHV0LCBjYWNoZXMsIGxvZ3MgXHUyMDE0IG91dCBvZiB0b3VjaCB0cmFja2luZyBlbnRpcmVseSwgc29cbiAqIHRoZSB0b3VjaCBob29rIG5ldmVyIHJlcG9ydHMgcmVhZHMsIHdyaXRlcywgb3IgdW5jb3ZlcmVkIHdyaXRlcyBvbiB0aGVtLlxuICpcbiAqIGBnaXQgY2hlY2staWdub3JlIC1xIDxwYXRoPmAgZXhpdHMgMCB3aGVuIHRoZSBwYXRoIGlzIGlnbm9yZWQsIDEgd2hlbiBpdCBpc1xuICogbm90LCBhbmQgMTI4IG9uIGVycm9yLiBleGVjRmlsZVN5bmMgdGhyb3dzIG9uIGFueSBub24temVybyBleGl0LCBzbyBhIGNsZWFuXG4gKiByZXR1cm4gbWVhbnMgXCJpZ25vcmVkXCIuIEEgc3RhdHVzLTEgdGhyb3cgaXMgdGhlIGV4cGVjdGVkIFwibm90IGlnbm9yZWRcIlxuICogc2lnbmFsOyBhbnkgb3RoZXIgZmFpbHVyZSBpcyBhbiB1bnJlbGlhYmxlIGFuc3dlciwgc28gd2UgcmVwb3J0IGBmYWxzZWBcbiAqIChkbyBub3QgZHJvcCB0aGUgdG91Y2gpIHJhdGhlciB0aGFuIHNpbGVudGx5IGhpZGluZyBhIHRyYWNrZWQgZmlsZS5cbiAqL1xuLyoqXG4gKiBUaGUgZGVmYXVsdCBzcGFuIHJvb3QgZGlyZWN0b3J5LCByZWxhdGl2ZSB0byB0aGUgcmVwbyByb290LCB1c2VkIHdoZW4gbm9cbiAqIGVudmlyb25tZW50IHZhcmlhYmxlIG9yIGdpdCBjb25maWcgb3ZlcnJpZGVzIHRoZSBsb2NhdGlvbi5cbiAqL1xuZXhwb3J0IGNvbnN0IFNQQU5fUk9PVCA9ICcuc3Bhbic7XG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgc3BhbiByb290IGRpcmVjdG9yeSBmb3IgYSBnaXZlbiByZXBvLCBtaXJyb3JpbmcgdGhlIFJ1c3QgQ0xJXG4gKiBwcmVjZWRlbmNlIChtaW51cyB0aGUgLS1zcGFuLWRpciBDTEkgZmxhZywgd2hpY2ggaXMgaW52aXNpYmxlIHRvIGZpbGUtd3JpdGVcbiAqIGhvb2tzKTpcbiAqICAgMS4gR0lUX1NQQU5fRElSIGVudmlyb25tZW50IHZhcmlhYmxlXG4gKiAgIDIuIGBnaXQgY29uZmlnIGdpdC1zcGFuLmRpcmAgaW4gdGhlIHJlcG9cbiAqICAgMy4gRGVmYXVsdDogXCIuc3BhblwiXG4gKlxuICogVGhlIHJldHVybmVkIHZhbHVlIGlzIGEgUE9TSVgtc3R5bGUgcGF0aCB3aXRoIG5vIHRyYWlsaW5nIHNsYXNoLlxuICogRmFpbC1zYWZlOiBhbnkgcmVzb2x1dGlvbiBlcnJvciBmYWxscyBiYWNrIHRvIFwiLnNwYW5cIiBzbyB0aGUgaG9vayBuZXZlclxuICogY3Jhc2hlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgZW52RGlyID0gcHJvY2Vzcy5lbnZbJ0dJVF9TUEFOX0RJUiddO1xuICBpZiAoZW52RGlyICYmIGVudkRpci50cmltKCkubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiB0b1Bvc2l4KGVudkRpci50cmltKCkpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICB9XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdjb25maWcnLCAnZ2l0LXNwYW4uZGlyJ10sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4J1xuICAgIH0pO1xuICAgIGNvbnN0IHRyaW1tZWQgPSB0b1Bvc2l4KG91dC50cmltKCkpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICAgIGlmICh0cmltbWVkLmxlbmd0aCA+IDApIHJldHVybiB0cmltbWVkO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB2b2lkIGVycjsgLy8gY29uZmlnIGtleSBhYnNlbnQgb3IgZ2l0IGVycm9yIFx1MjAxNCBmYWxsIHRocm91Z2ggdG8gZGVmYXVsdFxuICB9XG4gIHJldHVybiBTUEFOX1JPT1Q7XG59XG5cbi8qKlxuICogUmVwb3J0IHdoZXRoZXIgYSByZXBvLXJlbGF0aXZlIFBPU0lYIHBhdGggZmFsbHMgaW5zaWRlIHRoZSBnaXZlbiBzcGFuIHJvb3RcbiAqIGRpcmVjdG9yeS4gQSBwYXRoIGlzIGluc2lkZSB3aGVuIGl0IGVxdWFscyB0aGUgc3BhbiByb290IGV4YWN0bHkgb3IgaXNcbiAqIG5lc3RlZCBiZW5lYXRoIGl0IChpLmUuIHN0YXJ0cyB3aXRoIFwiPHNwYW5Sb290Pi9cIikuIFRoZSBcIi9cIiBib3VuZGFyeSBwcmV2ZW50c1xuICogZmFsc2UgcG9zaXRpdmVzIGZvciBzaWJsaW5ncyBsaWtlIFwiLnNwYW5zL3hcIiBvciBcIi5zcGFuLW5vdGVzL3hcIi5cbiAqXG4gKiBQYXNzIHRoZSByZXN1bHQgb2YgYHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdClgIGFzIGBzcGFuUm9vdGAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0luc2lkZVNwYW5Sb290KHJlcG9SZWxQYXRoOiBzdHJpbmcsIHNwYW5Sb290OiBzdHJpbmcgPSBTUEFOX1JPT1QpOiBib29sZWFuIHtcbiAgY29uc3Qgcm9vdCA9IHNwYW5Sb290LnJlcGxhY2UoL1xcLyskLywgJycpO1xuICByZXR1cm4gcmVwb1JlbFBhdGggPT09IHJvb3QgfHwgcmVwb1JlbFBhdGguc3RhcnRzV2l0aChgJHtyb290fS9gKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzR2l0SWdub3JlZChyZXBvUm9vdDogc3RyaW5nLCByZXBvUmVsUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdjaGVjay1pZ25vcmUnLCAnLXEnLCAnLS0nLCByZXBvUmVsUGF0aF0sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdpZ25vcmUnLCAnaWdub3JlJ11cbiAgICB9KTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdm9pZCBlcnI7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdDogc3RyaW5nLCBhYnNQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCByb290ID0gdG9Qb3NpeChyZXBvUm9vdCk7XG4gIGNvbnN0IGFicyA9IHRvUG9zaXgoYWJzUGF0aCk7XG4gIGNvbnN0IHByZWZpeCA9IHJvb3QuZW5kc1dpdGgoJy8nKSA/IHJvb3QgOiBgJHtyb290fS9gO1xuICByZXR1cm4gYWJzLnN0YXJ0c1dpdGgocHJlZml4KSA/IGFicy5zbGljZShwcmVmaXgubGVuZ3RoKSA6IGFicztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNhbm9uaWNhbGl6ZVBhdGgoYWJzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gdG9Qb3NpeChmcy5yZWFscGF0aFN5bmMubmF0aXZlKGFic1BhdGgpKTtcbiAgfSBjYXRjaCB7XG4gICAgLy8gRmlsZSBkb2Vzbid0IGV4aXN0IHlldCAoZS5nLiBXcml0ZSB0byBhIG5ldyBmaWxlKTogY2Fub25pY2FsaXplIHRoZVxuICAgIC8vIGRpcmVjdG9yeSBhbmQgcmVqb2luIHRoZSBiYXNlbmFtZSBzbyBzeW1saW5rcyBpbiB0aGUgcGFyZW50IGFyZSByZXNvbHZlZC5cbiAgICB0cnkge1xuICAgICAgY29uc3QgZGlyID0gdG9Qb3NpeChmcy5yZWFscGF0aFN5bmMubmF0aXZlKG5vZGVQYXRoLmRpcm5hbWUoYWJzUGF0aCkpKTtcbiAgICAgIHJldHVybiBgJHtkaXJ9LyR7bm9kZVBhdGguYmFzZW5hbWUoYWJzUGF0aCl9YDtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFBhcmVudCBkb2Vzbid0IGV4aXN0IGVpdGhlcjsgZmFsbCBiYWNrIHRvIHRoZSB1bi1jYW5vbmljYWxpemVkIHBhdGguXG4gICAgICByZXR1cm4gYWJzUGF0aDtcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRlcml2ZVBhdGgodG9vbElucHV0OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgY3dkOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3QgZnAgPSB0b29sSW5wdXQuZmlsZV9wYXRoO1xuICBpZiAodHlwZW9mIGZwICE9PSAnc3RyaW5nJyB8fCBmcC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBjb25zdCBhYnMgPSBhYnNwYXRoQWdhaW5zdChjd2QsIGZwKTtcbiAgcmV0dXJuIGNhbm9uaWNhbGl6ZVBhdGgoYWJzKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBMaW5lIHJhbmdlIHR5cGVzIGFuZCBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBMaW5lUmFuZ2Uge1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJhbmdlc0ludGVyc2VjdChhOiBMaW5lUmFuZ2UsIGI6IExpbmVSYW5nZSk6IGJvb2xlYW4ge1xuICByZXR1cm4gYS5zdGFydCA8PSBiLmVuZCAmJiBhLmVuZCA+PSBiLnN0YXJ0O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBvcmNlbGFpbiByb3cgcGFyc2luZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgUG9yY2VsYWluUm93IHtcbiAgbmFtZTogc3RyaW5nO1xuICBwYXRoOiBzdHJpbmc7XG4gIHN0YXJ0OiBudW1iZXI7XG4gIGVuZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VQb3JjZWxhaW4oc3Rkb3V0OiBzdHJpbmcpOiBQb3JjZWxhaW5Sb3dbXSB7XG4gIGNvbnN0IHJvd3M6IFBvcmNlbGFpblJvd1tdID0gW107XG4gIGZvciAoY29uc3QgbGluZSBvZiBzdGRvdXQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCkgY29udGludWU7XG4gICAgY29uc3QgcGFydHMgPSB0cmltbWVkLnNwbGl0KCdcXHQnKTtcbiAgICBpZiAocGFydHMubGVuZ3RoIDwgMykgY29udGludWU7XG4gICAgY29uc3QgW25hbWUsIHBhdGgsIHJhbmdlXSA9IHBhcnRzO1xuICAgIGNvbnN0IGRhc2hJZHggPSByYW5nZS5pbmRleE9mKCctJyk7XG4gICAgaWYgKGRhc2hJZHggPT09IC0xKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IHBhcnNlSW50KHJhbmdlLnNsaWNlKDAsIGRhc2hJZHgpLCAxMCk7XG4gICAgY29uc3QgZW5kID0gcGFyc2VJbnQocmFuZ2Uuc2xpY2UoZGFzaElkeCArIDEpLCAxMCk7XG4gICAgaWYgKE51bWJlci5pc05hTihzdGFydCkgfHwgTnVtYmVyLmlzTmFOKGVuZCkpIGNvbnRpbnVlO1xuICAgIHJvd3MucHVzaCh7IG5hbWUsIHBhdGgsIHN0YXJ0LCBlbmQgfSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8qKlxuICogVGhlIGZ1bGwgYGdpdCBzcGFuIHN0YWxlIC0tZm9ybWF0IHBvcmNlbGFpbmAgc3RhdHVzIHRva2VuIHZvY2FidWxhcnkgKHRoZVxuICogZ2l0LXNwYW4gQ0xJJ3MgcG9yY2VsYWluIGNvbnRyYWN0KTogYEZSRVNIYC9gTU9WRURgL2BSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGBcbiAqIGFyZSBwb3NpdGlvbmFsLW9yLWNsZWFuIGFuZCBuZXZlciBkZWJ0OyBldmVyeSBvdGhlciB0b2tlbiBpcyBzZW1hbnRpYyBkcmlmdFxuICogb3IgYSB0ZXJtaW5hbC9lcnJvciBjb25kaXRpb24gYW5kIGlzIGRlYnQuIFNlZSB7QGxpbmsgaXNEZWJ0fSBmb3IgdGhlXG4gKiBzaW5nbGUgc291cmNlIG9mIHRydXRoIG9uIHRoYXQgc3BsaXQuXG4gKi9cbmV4cG9ydCBjb25zdCBQT1JDRUxBSU5fU1RBVFVTRVMgPSBbXG4gICdGUkVTSCcsXG4gICdSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCcsXG4gICdNT1ZFRCcsXG4gICdDSEFOR0VEJyxcbiAgJ0RFTEVURUQnLFxuICAnQ09ORkxJQ1QnLFxuICAnU1VCTU9EVUxFJyxcbiAgJ0xGU19OT1RfRkVUQ0hFRCcsXG4gICdMRlNfTk9UX0lOU1RBTExFRCcsXG4gICdQUk9NSVNPUl9NSVNTSU5HJyxcbiAgJ1NQQVJTRV9FWENMVURFRCcsXG4gICdGSUxURVJfRkFJTEVEJyxcbiAgJ0lPX0VSUk9SJ1xuXSBhcyBjb25zdDtcblxuZXhwb3J0IHR5cGUgUG9yY2VsYWluU3RhdHVzID0gKHR5cGVvZiBQT1JDRUxBSU5fU1RBVFVTRVMpW251bWJlcl07XG5cbmNvbnN0IFBPUkNFTEFJTl9TVEFUVVNfU0VUOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChQT1JDRUxBSU5fU1RBVFVTRVMpO1xuXG5mdW5jdGlvbiBwYXJzZVBvcmNlbGFpblN0YXR1cyhyYXc6IHN0cmluZyk6IFBvcmNlbGFpblN0YXR1cyB8IG51bGwge1xuICByZXR1cm4gUE9SQ0VMQUlOX1NUQVRVU19TRVQuaGFzKHJhdykgPyAocmF3IGFzIFBvcmNlbGFpblN0YXR1cykgOiBudWxsO1xufVxuXG4vKiogQSBgcGFyc2VTdGFsZVBvcmNlbGFpbmAgcm93OiBhIHtAbGluayBQb3JjZWxhaW5Sb3d9IHBsdXMgaXRzIHN0YXR1cyB0b2tlbi4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3RhbGVQb3JjZWxhaW5Sb3cgZXh0ZW5kcyBQb3JjZWxhaW5Sb3cge1xuICBzdGF0dXM6IFBvcmNlbGFpblN0YXR1cztcbn1cblxuLyoqXG4gKiBUaGUgZGVidCBpbnZhcmlhbnQgKHN5c3RlbS13aWRlOyBjb25zdW1lZCBieSBib3RoIHRoZSBmdXR1cmUgdG91Y2gtY29yZSBhbmRcbiAqIGdhdGUtY29yZSk6IG9ubHkgc2VtYW50aWMgc3RhdHVzZXMgYXJlIGRlYnQuIGBDSEFOR0VEYCBhbmQgYERFTEVURURgIGFyZVxuICogc2VtYW50aWMgZHJpZnQ7IHRoZSByZW1haW5pbmcgbm9uLUZSRVNIL01PVkVEL1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUIHRva2Vuc1xuICogYXJlIHRlcm1pbmFsL2Vycm9yIGNvbmRpdGlvbnMgYW5kIGFyZSB0cmVhdGVkIGFzIGRlYnQgdG9vICh0aGV5IGJsb2NrIG9uXG4gKiB0aGVpciBvd24gbWVyaXRzIFx1MjAxNCB0aGUgQ0xJIGNvdWxkIG5vdCByZXNvbHZlIHRoZSBhbmNob3IgYXQgYWxsKS4gYEZSRVNIYCxcbiAqIGBNT1ZFRGAsIGFuZCBgUkVTT0xWRURfUEVORElOR19DT01NSVRgIGFyZSBuZXZlciBkZWJ0OiBwb3NpdGlvbmFsIGRyaWZ0IHRoZVxuICogQ0xJIGNhbiBoZWFsIChvciBhbHJlYWR5IGhhcykgaXMgaW52aXNpYmxlLCBhbmQgYSBwZW5kaW5nLWNvbW1pdCByZXNvbHV0aW9uXG4gKiBpcyBub3Qgb3V0c3RhbmRpbmcgZGVidC5cbiAqXG4gKiBOb3RlOiB0aGUgcG9yY2VsYWluIHZvY2FidWxhcnkgZG9lcyBub3QgY3VycmVudGx5IGRpc3Rpbmd1aXNoXG4gKiBjb250ZW50LWVxdWl2YWxlbnQgYENIQU5HRURgIChlLmcuIHdoaXRlc3BhY2Utb25seSBkcmlmdCBgLS1maXhgIGNhbiBoZWFsKVxuICogZnJvbSBnZW51aW5lbHkgc2VtYW50aWMgYENIQU5HRURgIFx1MjAxNCB0aGF0IGNsYXNzaWZpY2F0aW9uIGlzIG5vdCBwcmVzZW50IGluXG4gKiBgZ2l0IHNwYW4gc3RhbGUgLS1mb3JtYXQgcG9yY2VsYWluYCBvdXRwdXQgdG9kYXkuIFVudGlsIHRoZSBDTEkgZXhwb3NlcyBpdCxcbiAqIGV2ZXJ5IGBDSEFOR0VEYCByb3cgaXMgdHJlYXRlZCBhcyBkZWJ0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNEZWJ0KHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogYm9vbGVhbiB7XG4gIHN3aXRjaCAoc3RhdHVzKSB7XG4gICAgY2FzZSAnRlJFU0gnOlxuICAgIGNhc2UgJ01PVkVEJzpcbiAgICBjYXNlICdSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCc6XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiB0cnVlO1xuICB9XG59XG5cbi8qKlxuICogTG93ZXJjYXNlIGh1bWFuIGxhYmVsIGZvciBhIHBvcmNlbGFpbiBzdGF0dXMgdG9rZW4gKGBMRlNfTk9UX0ZFVENIRURgIFx1MjE5MlxuICogYGxmcyBub3QgZmV0Y2hlZGApLiBUaGUgc2luZ2xlIGxhYmVsIG1hcHBpbmcgZm9yIGV2ZXJ5IGh1bWFuLWZvcm1hdCBhbmNob3JcbiAqIHN1ZmZpeCBcdTIwMTQgYm90aCB0aGUgdG91Y2ggaG9vaydzIGJsb2NrIGFuZCB0aGUgZ2F0ZSdzIG1lc3NhZ2VzIHJlbmRlciB0aHJvdWdoXG4gKiB0aGlzLCBzbyBhIHN0YXR1cyBuZXZlciByZWFkcyBkaWZmZXJlbnRseSBiZXR3ZWVuIHRoZSB0d28uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBodW1hblN0YXR1c0xhYmVsKHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogc3RyaW5nIHtcbiAgcmV0dXJuIHN0YXR1cy50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL18vZywgJyAnKTtcbn1cblxuLyoqXG4gKiBUaGUgdGVybWluYWwvZW52aXJvbm1lbnRhbCBzdGF0dXNlczogdGhlIENMSSBjb3VsZCBub3QgcmVzb2x2ZSB0aGUgYW5jaG9yIGF0XG4gKiBhbGwsIHNvIHRoZSByb3cgaXMgbm90IHNwYW4gZHJpZnQgYSB1c2VyIGNhbiBmaXggYnkgZWRpdGluZyBhIHNwYW4uIFRoZXNlIGFyZVxuICogYENPTkZMSUNUYCAodW5yZXNvbHZlZCBtZXJnZSksIGBTVUJNT0RVTEVgIChhbmNob3IgaW5zaWRlIGEgc3VibW9kdWxlKSxcbiAqIGBMRlNfTk9UX0ZFVENIRURgL2BMRlNfTk9UX0lOU1RBTExFRGAgKEdpdCBMRlMgY29udGVudCB1bmF2YWlsYWJsZSksXG4gKiBgUFJPTUlTT1JfTUlTU0lOR2AgKHBhcnRpYWwtY2xvbmUgb2JqZWN0IG5vdCBmZXRjaGVkKSwgYFNQQVJTRV9FWENMVURFRGBcbiAqIChwYXRoIG91dHNpZGUgdGhlIHNwYXJzZS1jaGVja291dCBjb25lKSwgYEZJTFRFUl9GQUlMRURgIChhIGNsZWFuL3NtdWRnZVxuICogZmlsdGVyIGVycm9yZWQpLCBhbmQgYElPX0VSUk9SYCAodHJhbnNpZW50IHJlYWQgZmFpbHVyZSkuXG4gKlxuICogVGhlc2UgYXJlIGEgc3RyaWN0IHN1YnNldCBvZiB7QGxpbmsgaXNEZWJ0fTogZXZlcnkgZW52aXJvbm1lbnRhbCBzdGF0dXMgaXNcbiAqIGFsc28gZGVidCAoaXQgYmxvY2tzIG9uIGl0cyBvd24gbWVyaXRzIHdoZW4gc3VyZmFjZWQgaW4gYSBzdGF0dXMgcmVwb3J0KSwgYnV0XG4gKiB0aGUgZ2F0ZSBtdXN0IHRyZWF0IHRoZW0gZGlmZmVyZW50bHkgZnJvbSAqc2VtYW50aWMqIGRyaWZ0IChgQ0hBTkdFRGAsXG4gKiBgREVMRVRFRGApLiBTZW1hbnRpYyBkcmlmdCBpcyBmaXhhYmxlIGJ5IGVkaXRpbmcgYSBzcGFuLCBzbyB0aGUgZ2F0ZSBmYWlsc1xuICogY2xvc2VkIG9uIGl0OyBhbiBlbnZpcm9ubWVudGFsIGNvbmRpdGlvbiBpcyBub3Qgc29tZXRoaW5nIGEgc3BhbiBlZGl0IGNhblxuICogcmVzb2x2ZSwgc28gdGhlIGdhdGUgZmFpbHMgT1BFTiBvbiBpdCAoYWxsb3csIGJ1dCBzdXJmYWNlIHRoZSBjb25kaXRpb24pIFx1MjAxNFxuICogcmUtZGVueWluZyBmb3JldmVyIG9uIGFuIGluZnJhIGZhaWx1cmUgdGhlIHVzZXIgY2Fubm90IGNsZWFyIGZyb20gaGVyZSB3b3VsZFxuICogY29udHJhZGljdCB0aGUgZmFpbC1vcGVuIGNvbnRyYWN0IHRoZSByZXN0IG9mIHRoZSBnYXRlIGFscmVhZHkgaG9ub3JzIGZvclxuICogQ0xJLWFic2VudC90aW1lb3V0L3BhcnNlLWZhaWx1cmUgY29uZGl0aW9ucy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRW52aXJvbm1lbnRhbFN0YXR1cyhzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IGJvb2xlYW4ge1xuICBzd2l0Y2ggKHN0YXR1cykge1xuICAgIGNhc2UgJ0NPTkZMSUNUJzpcbiAgICBjYXNlICdTVUJNT0RVTEUnOlxuICAgIGNhc2UgJ0xGU19OT1RfRkVUQ0hFRCc6XG4gICAgY2FzZSAnTEZTX05PVF9JTlNUQUxMRUQnOlxuICAgIGNhc2UgJ1BST01JU09SX01JU1NJTkcnOlxuICAgIGNhc2UgJ1NQQVJTRV9FWENMVURFRCc6XG4gICAgY2FzZSAnRklMVEVSX0ZBSUxFRCc6XG4gICAgY2FzZSAnSU9fRVJST1InOlxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIGBnaXQgc3BhbiBzdGFsZSAtLWZvcm1hdCBwb3JjZWxhaW5gIGVtaXRzIGEgZGlmZmVyZW50IHNoYXBlIHRoYW5cbiAqIGBsaXN0IC0tcG9yY2VsYWluYDogYSBgIyBwb3JjZWxhaW4gdjJgIGhlYWRlciwgYCMgZnV6enkgTmAgY29tbWVudCBsaW5lcyxcbiAqIGFuZCBvbmUgYDxzdGF0dXM+XFx0PHNyYz5cXHQ8bmFtZT5cXHQ8cGF0aD5cXHQ8c3RhcnQ+XFx0PGVuZD5gIHJvdyBwZXIgZHJpZnRlZFxuICogYW5jaG9yICh3aG9sZS1maWxlIGFuY2hvcnMgY2FycnkgYCh3aG9sZSlgL2AtYCBpbiBwbGFjZSBvZiB0aGUgbGluZSBjb2x1bW5zKS5cbiAqIFJvd3Mgd2hvc2Ugc3RhdHVzIHRva2VuIGlzIG5vdCBpbiB7QGxpbmsgUE9SQ0VMQUlOX1NUQVRVU0VTfSBhcmUgc2tpcHBlZCBcdTIwMTRcbiAqIGFuIHVucmVjb2duaXplZCB0b2tlbiBmcm9tIGEgbmV3ZXIgQ0xJIGlzIHRyZWF0ZWQgdGhlIHNhbWUgYXMgYSBtYWxmb3JtZWRcbiAqIGxpbmUgcmF0aGVyIHRoYW4gZ3Vlc3NlZCBhdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlU3RhbGVQb3JjZWxhaW4oc3Rkb3V0OiBzdHJpbmcpOiBTdGFsZVBvcmNlbGFpblJvd1tdIHtcbiAgY29uc3Qgcm93czogU3RhbGVQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygc3Rkb3V0LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQgfHwgdHJpbW1lZC5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHBhcnRzID0gdHJpbW1lZC5zcGxpdCgnXFx0Jyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDYpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFtzdGF0dXNDb2wsICwgbmFtZSwgcGF0aCwgc3RhcnRDb2wsIGVuZENvbF0gPSBwYXJ0cztcbiAgICBjb25zdCBzdGF0dXMgPSBwYXJzZVBvcmNlbGFpblN0YXR1cyhzdGF0dXNDb2wpO1xuICAgIGlmICghc3RhdHVzKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IHN0YXJ0Q29sID09PSAnKHdob2xlKScgPyAwIDogcGFyc2VJbnQoc3RhcnRDb2wsIDEwKTtcbiAgICBjb25zdCBlbmQgPSBlbmRDb2wgPT09ICctJyA/IDAgOiBwYXJzZUludChlbmRDb2wsIDEwKTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0KSB8fCBOdW1iZXIuaXNOYU4oZW5kKSkgY29udGludWU7XG4gICAgcm93cy5wdXNoKHsgbmFtZSwgcGF0aCwgc3RhcnQsIGVuZCwgc3RhdHVzIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFNlc3Npb24gSUQgc2FuaXRpemF0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBJbmplY3RpdmUgdHJhbnNmb3JtOiBwZXJjZW50LWVuY29kZSBieXRlcyBvdXRzaWRlIFtBLVphLXowLTkuXy1dIGFzICVISFxuICogKHVwcGVyY2FzZSBoZXgpLiBVc2VkIHRvIHByb2R1Y2Ugc2FmZSBmaWxlbmFtZXMgZnJvbSBhcmJpdHJhcnkgc2Vzc2lvbiBpZHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZVNlc3Npb25JZChzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzZXNzaW9uSWQucmVwbGFjZSgvW15BLVphLXowLTkuXy1dL2csIChjaCkgPT4ge1xuICAgIHJldHVybiBgJSR7Y2guY2hhckNvZGVBdCgwKS50b1N0cmluZygxNikudG9VcHBlckNhc2UoKS5wYWRTdGFydCgyLCAnMCcpfWA7XG4gIH0pO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBlci1zZXNzaW9uIGJhc2UgZGlyZWN0b3J5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLy8gQmFzZSBkaXIgc2hhcmVkIGJ5IGFsbCBwZXItc2Vzc2lvbiBzdGF0ZTogY3VycmVudGx5IGp1c3QgdGhlIHRvdWNoLWhvb2tcbi8vIHNlc3Npb24gbWVtbyAoc3Bhbi1zdXJmYWNlLnRzJ3MgTWVtb1N0b3JlKS4gRWFjaCBzZXNzaW9uIGdldHMgb25lXG4vLyBzdWJkaXJlY3Rvcnkga2V5ZWQgYnkgaXRzIHNhbml0aXplZCBpZCwgc28gZXZlcnkgd3JpdGVyL3JlYWRlciBmb3IgYSBnaXZlblxuLy8gc2Vzc2lvbiBhZ3JlZXMgb24gaXRzIGxvY2F0aW9uLlxuZXhwb3J0IGNvbnN0IFNFU1NJT05fQkFTRV9ESVIgPSBub2RlUGF0aC5qb2luKG9zLmhvbWVkaXIoKSwgJy5jYWNoZScsICdnaXQtc3BhbicsICdzZXNzaW9uJyk7XG5cbi8qKiBUaGUgcGVyLXNlc3Npb24gc3RhdGUgZGlyZWN0b3J5IGZvciBhIGdpdmVuIHNlc3Npb24gaWQuICovXG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvbkRpcihzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKFNFU1NJT05fQkFTRV9ESVIsIHNhbml0aXplU2Vzc2lvbklkKHNlc3Npb25JZCkpO1xufVxuXG5jb25zdCBUSElSVFlfREFZU19NUyA9IDMwICogMjQgKiA2MCAqIDYwICogMTAwMDtcblxuLyoqXG4gKiBPcHBvcnR1bmlzdGljYWxseSBwcnVuZSBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcmllcyB1bmRlclxuICoge0BsaW5rIFNFU1NJT05fQkFTRV9ESVJ9IHdob3NlIG10aW1lIGlzIG9sZGVyIHRoYW4gYG1heEFnZU1zYCAoZGVmYXVsdCAzMFxuICogZGF5cykuIEEgZGlyZWN0b3J5J3MgbXRpbWUgYWR2YW5jZXMgd2hlbmV2ZXIgYW4gZW50cnkgaW5zaWRlIGl0IGlzXG4gKiBjcmVhdGVkL3JlbmFtZWQvcmVtb3ZlZCwgc28gYW4gYWN0aXZlIHNlc3Npb24gKG1lbW8gd3JpdGVzKSBzdGF5cyBmcmVzaDtcbiAqIG9ubHkgZ2VudWluZWx5IGFiYW5kb25lZCBzZXNzaW9ucyBhZ2Ugb3V0LlxuICpcbiAqIEJlc3QtZWZmb3J0IGFuZCBub24tdGhyb3dpbmc6IGNhbGxlZCBvcHBvcnR1bmlzdGljYWxseSBmcm9tIGhvb2sgcmVhZC93cml0ZVxuICogcGF0aHMsIG5vdCBhIHNlcGFyYXRlIGNyb24tbGlrZSBtZWNoYW5pc20sIHNvIGEgZmFpbHVyZSBoZXJlIG11c3QgbmV2ZXJcbiAqIGJsb2NrIHRoZSBjYWxsZXIncyBhY3R1YWwgd29yay5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBydW5lU3RhbGVTZXNzaW9ucyhub3c6IG51bWJlciA9IERhdGUubm93KCksIG1heEFnZU1zOiBudW1iZXIgPSBUSElSVFlfREFZU19NUyk6IHZvaWQge1xuICBsZXQgZW50cmllczogZnMuRGlyZW50W107XG4gIHRyeSB7XG4gICAgZW50cmllcyA9IGZzLnJlYWRkaXJTeW5jKFNFU1NJT05fQkFTRV9ESVIsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuOyAvLyBiYXNlIGRpciBhYnNlbnQgb3IgdW5yZWFkYWJsZSBcdTIwMTQgbm90aGluZyB0byBwcnVuZVxuICB9XG4gIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgIGlmICghZW50cnkuaXNEaXJlY3RvcnkoKSkgY29udGludWU7XG4gICAgY29uc3QgZGlyUGF0aCA9IG5vZGVQYXRoLmpvaW4oU0VTU0lPTl9CQVNFX0RJUiwgZW50cnkubmFtZSk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0YXQgPSBmcy5zdGF0U3luYyhkaXJQYXRoKTtcbiAgICAgIGlmIChub3cgLSBzdGF0Lm10aW1lTXMgPiBtYXhBZ2VNcykge1xuICAgICAgICBmcy5ybVN5bmMoZGlyUGF0aCwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICAgICAgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gVmFuaXNoZWQgYmV0d2VlbiByZWFkZGlyIGFuZCBzdGF0LCBvciByZW1vdmFsIGZhaWxlZCBcdTIwMTQgc2tpcCBpdC4gQVxuICAgICAgLy8gYmVzdC1lZmZvcnQgcHJ1bmUgbXVzdCBuZXZlciB0aHJvdyBpbnRvIHRoZSBjYWxsZXIncyBob3QgcGF0aC5cbiAgICB9XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBraW5kIGFuZCBhbmNob3IgZm9ybWF0dGluZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB0eXBlIFRvdWNoS2luZCA9ICdyZWFkJyB8ICd3cml0ZScgfCAnd2hvbGUtcmVhZCcgfCAnd2hvbGUtd3JpdGUnIHwgJ2NyZWF0ZSc7XG5cbi8qKlxuICogRm9ybWF0IGEgc3BhbiBhbmNob3Igc3RyaW5nLlxuICpcbiAqIC0gYHdob2xlLXJlYWRgLCBgd2hvbGUtd3JpdGVgLCBhbmQgYGNyZWF0ZWA6IHJldHVybnMganVzdCB0aGUgcGF0aFxuICogLSBgcmVhZGAgYW5kIGB3cml0ZWA6IHJldHVybnMgYHBhdGgjTDxzdGFydD4tTDxlbmQ+YCAocmVxdWlyZXMgcmFuZ2UpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRBbmNob3IocGF0aDogc3RyaW5nLCBraW5kOiBUb3VjaEtpbmQsIHJhbmdlPzogTGluZVJhbmdlKTogc3RyaW5nIHtcbiAgaWYgKChraW5kID09PSAncmVhZCcgfHwga2luZCA9PT0gJ3dyaXRlJykgJiYgcmFuZ2UpIHtcbiAgICByZXR1cm4gYCR7cGF0aH0jTCR7cmFuZ2Uuc3RhcnR9LUwke3JhbmdlLmVuZH1gO1xuICB9XG4gIHJldHVybiBwYXRoO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEFuY2hvciBzcGVjIHR5cGVcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIEFuY2hvclNwZWMge1xuICBwYXRoOiBzdHJpbmc7XG4gIGtpbmQ6IFRvdWNoS2luZDtcbiAgcmFuZ2U/OiBMaW5lUmFuZ2U7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUXVldWUgZGlyZWN0b3J5IGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJlc29sdmUgdGhlIGdpdCBjb21tb24gZGlyZWN0b3J5IGZvciB0aGUgZ2l2ZW4gcmVwbyByb290LlxuICogVGhpcyBpcyB0aGUgc2hhcmVkIGRpcmVjdG9yeSAobm90IHRoZSB3b3JrdHJlZS1zcGVjaWZpYyAuZ2l0KSwgc28gcXVldWVcbiAqIHJlY29yZHMgc3Vydml2ZSB3b3JrdHJlZSBkZWxldGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVHaXRDb21tb25EaXIocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAncmV2LXBhcnNlJywgJy0tZ2l0LWNvbW1vbi1kaXInXSwge1xuICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgIGVuY29kaW5nOiAndXRmOCdcbiAgfSk7XG4gIGNvbnN0IHRyaW1tZWQgPSB0b1Bvc2l4KG91dC50cmltKCkpO1xuICAvLyBnaXQgcmV0dXJucyBhIHJlbGF0aXZlIHBhdGggKGUuZy4gXCIuZ2l0XCIpIGZvciBzaW1wbGUgcmVwb3MuIFJlc29sdmUgaXRcbiAgLy8gYWdhaW5zdCByZXBvUm9vdCBzbyBjYWxsZXJzIG5ldmVyIGRlcGVuZCBvbiBwcm9jZXNzLmN3ZCgpLlxuICBpZiAoIW5vZGVQYXRoLmlzQWJzb2x1dGUodHJpbW1lZCkpIHtcbiAgICByZXR1cm4gdG9Qb3NpeChub2RlUGF0aC5yZXNvbHZlKHJlcG9Sb290LCB0cmltbWVkKSk7XG4gIH1cbiAgcmV0dXJuIHRyaW1tZWQ7XG59XG5cbi8qKlxuICogUm9vdCBvZiB0aGUgZ2l0LXNwYW4gcXVldWUgZGlyZWN0b3J5IHRyZWUsIHVuZGVyIHRoZSBnaXQgY29tbW9uIGRpci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHF1ZXVlUm9vdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocmVzb2x2ZUdpdENvbW1vbkRpcihyZXBvUm9vdCksICdnaXQtc3BhbicpO1xufVxuXG4vKipcbiAqIERpcmVjdG9yeSBmb3IgdGhlIGdhdGUncyBwZXItY2hhbmdlc2V0IHN0YXRlIG1lbW9zIChkaWdlc3Qgb2Ygc29ydGVkXG4gKiBmaW5kaW5ncyArIHVuY292ZXJlZCBwYXRocyksIHVuZGVyIHRoZSBnaXQgY29tbW9uIGRpciBzbyBpdCBpcyBzaGFyZWRcbiAqIGFjcm9zcyB3b3JrdHJlZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnYXRlTWVtb0RpcihyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocXVldWVSb290KHJlcG9Sb290KSwgJ2dhdGUnKTtcbn1cbiIsICIvKipcbiAqIFBhdGggZXhjbHVzaW9uIGxpc3QgZm9yIHRoZSBnYXRlJ3MgdW5jb3ZlcmVkLXdyaXRlcyBjaGVjay5cbiAqXG4gKiBgZXZhbHVhdGVHYXRlYCBpbiB7QGxpbmsgZmlsZTovLy4vZ2F0ZS1jb3JlLnRzfSBhbHJlYWR5IGV4Y2x1ZGVzIGAuc3Bhbi8qKmBcbiAqIHBhdGhzIGZyb20gaXRzIHVuY292ZXJlZC13cml0ZXMgY29tcHV0YXRpb24gdW5jb25kaXRpb25hbGx5IChzcGFuIHJlcGFpcnNcbiAqIHJpZGUgdGhlIHNhbWUgY29tbWl0IGFuZCBtdXN0IG5ldmVyIHNlbGYtdHJpZ2dlciB0aGUgZ2F0ZSkuIFRoaXMgbW9kdWxlXG4gKiBhZGRzIGEgc2Vjb25kLCB1c2VyLWRlY2xhcmVkIGV4Y2x1c2lvbiBzb3VyY2Ugb24gdG9wIG9mIHRoYXQ6IGEgcmVwbyBvd25lclxuICogY2FuIGxpc3QgYWRkaXRpb25hbCBwYXRocyB0aGUgdW5jb3ZlcmVkLXdyaXRlcyBjaGVjayBzaG91bGQgbmV2ZXIgZmxhZyBcdTIwMTRcbiAqIGdlbmVyYXRlZCBvdXRwdXQsIHZlbmRvcmVkIGNvZGUsIGFueXRoaW5nIHRoYXQgd2lsbCBuZXZlciBnZXQgYSBzcGFuLlxuICpcbiAqIENvbmZpZyBsaXZlcyBhdCBgPHJlcG9Sb290Pi8uc3Bhbi8uZ2F0ZWlnbm9yZWAuIFVubGlrZVxuICoge0BsaW5rIGZpbGU6Ly8uL3NwYW4taWdub3JlLnRzfSdzIGAuc3Bhbi8uaG9va2lnbm9yZWAgXHUyMDE0IHdoaWNoIHRoZSBgZ2l0LXNwYW5gXG4gKiBSdXN0IENMSSBhdXRvLWNyZWF0ZXMgd2l0aCBjYW5vbmljYWwgY29udGVudCBcdTIwMTQgYC5nYXRlaWdub3JlYCBpc1xuICogKip1c2VyLW93bmVkKio6IG5vdGhpbmcgY3JlYXRlcyBvciBwb3B1bGF0ZXMgaXQsIHNvIGl0cyBhYnNlbmNlIGlzIHRoZVxuICogbm9ybWFsLCB1bmNvbmZpZ3VyZWQgc3RhdGUsIG5vdCBhIGJyb2tlbiBvbmUuXG4gKlxuICogRWFjaCBub24tY29tbWVudCBsaW5lIGlzIGEgc2luZ2xlIGdpdGlnbm9yZS1zdHlsZSBwYXRoIHBhdHRlcm4gKG5vIHRyYWlsaW5nXG4gKiBwcmVmaXggbGlzdCBcdTIwMTQgYSBgLmdhdGVpZ25vcmVgIGxpbmUgZWl0aGVyIGV4Y2x1ZGVzIGEgcGF0aCBmcm9tIHRoZVxuICogdW5jb3ZlcmVkLXdyaXRlcyBjaGVjayBvciBpdCBkb2Vzbid0LCB1bmxpa2UgYC5ob29raWdub3JlYCdzIHBlci1zcGFuLXNsdWdcbiAqIHN1cHByZXNzaW9uKTpcbiAqXG4gKiAgIHBhY2thZ2VzL2FnZW50LWhvb2tzL2dlbmVyYXRlZC8qKlxuICpcbiAqIFBhdHRlcm4gZ3JhbW1hciBpcyBpZGVudGljYWwgdG8gYC5ob29raWdub3JlYCdzIChzZWUgdGhhdCBtb2R1bGUncyBkb2NcbiAqIGNvbW1lbnQgZm9yIHRoZSBmdWxsIGdyYW1tYXIpIGFuZCByZXVzZXMgaXRzIGNvbXBpbGVkIG1hdGNoZXIgdmlhXG4gKiB7QGxpbmsgY29tcGlsZVBhdHRlcm59IHJhdGhlciB0aGFuIHJlaW1wbGVtZW50aW5nIHBhdGggbWF0Y2hpbmc6XG4gKlxuICogLSBCbGFuayBsaW5lcyBhbmQgbGluZXMgYmVnaW5uaW5nIHdpdGggYCNgIGFyZSBza2lwcGVkLlxuICogLSBBIHRyYWlsaW5nIGAvYCByZXN0cmljdHMgdGhlIHBhdHRlcm4gdG8gZGlyZWN0b3JpZXMuXG4gKiAtIEEgcGF0dGVybiBjb250YWluaW5nIGEgc2xhc2ggaXMgYW5jaG9yZWQgdG8gdGhlIHJlcG8gcm9vdDsgYSBwYXR0ZXJuIHdpdGhcbiAqICAgbm8gc2xhc2ggbWF0Y2hlcyBhIHNpbmdsZSBwYXRoIGNvbXBvbmVudCBhdCBhbnkgZGVwdGguXG4gKiAtIGAqYCBhbmQgYD9gIG1hdGNoIHdpdGhpbiBvbmUgcGF0aCBzZWdtZW50OyBgKipgIG1hdGNoZXMgYWNyb3NzIHNlZ21lbnRzLlxuICogLSBOZWdhdGlvbiAoYCFgKSBpcyBub3Qgc3VwcG9ydGVkLlxuICpcbiAqIEZhaWwtb3BlbjogYSBtaXNzaW5nIG9yIHVucmVhZGFibGUgYC5nYXRlaWdub3JlYCwgb3IgYSBtYWxmb3JtZWQgbGluZSxcbiAqIHlpZWxkcyBubyBhZGRpdGlvbmFsIGV4Y2x1c2lvbiBcdTIwMTQgdGhlIHVuY292ZXJlZC13cml0ZXMgY2hlY2sgc2ltcGx5IGZhbGxzXG4gKiBiYWNrIHRvIHRoZSBgLnNwYW4vKipgLW9ubHkgZXhjbHVzaW9uIGl0IGFscmVhZHkgYXBwbGllcy5cbiAqL1xuXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBjb21waWxlUGF0dGVybiB9IGZyb20gJy4vc3Bhbi1pZ25vcmUuanMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEdhdGVJZ25vcmVSdWxlIHtcbiAgLyoqIFRoZSByYXcgZ2l0aWdub3JlLXN0eWxlIHBhdHRlcm4sIHJldGFpbmVkIGZvciBkaWFnbm9zdGljcy4gKi9cbiAgcGF0dGVybjogc3RyaW5nO1xuICAvKiogVHJ1ZSB3aGVuIGByZXBvUmVsUGF0aGAgKFBPU0lYLCByZXBvLXJlbGF0aXZlKSBpcyBleGNsdWRlZCBieSB0aGlzIHJ1bGUuICovXG4gIG1hdGNoZXM6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuO1xufVxuXG5jb25zdCBHQVRFX0lHTk9SRV9SRUwgPSBub2RlUGF0aC5qb2luKCcuc3BhbicsICcuZ2F0ZWlnbm9yZScpO1xuXG4vKiogUGFyc2UgYC5nYXRlaWdub3JlYCB0ZXh0IGludG8gcnVsZXMsIHNraXBwaW5nIGNvbW1lbnRzIGFuZCBibGFuayBsaW5lcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUdhdGVJZ25vcmUoY29udGVudDogc3RyaW5nKTogR2F0ZUlnbm9yZVJ1bGVbXSB7XG4gIGNvbnN0IHJ1bGVzOiBHYXRlSWdub3JlUnVsZVtdID0gW107XG4gIGZvciAoY29uc3QgcmF3TGluZSBvZiBjb250ZW50LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHBhdHRlcm4gPSByYXdMaW5lLnRyaW0oKTtcbiAgICBpZiAoIXBhdHRlcm4gfHwgcGF0dGVybi5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIHJ1bGVzLnB1c2goeyBwYXR0ZXJuLCBtYXRjaGVzOiBjb21waWxlUGF0dGVybihwYXR0ZXJuKSB9KTtcbiAgfVxuICByZXR1cm4gcnVsZXM7XG59XG5cbi8qKlxuICogTG9hZCB0aGUgZXhjbHVzaW9uIHJ1bGVzIGZvciBhIHJlcG8uIEZhaWwtb3BlbjogYW55IHJlYWQgZmFpbHVyZSB5aWVsZHMgYW5cbiAqIGVtcHR5IHJ1bGUgc2V0LCBzbyBhbiBhYnNlbnQvdW5yZWFkYWJsZSBgLmdhdGVpZ25vcmVgIGV4Y2x1ZGVzIG5vdGhpbmdcbiAqIGJleW9uZCB0aGUgZ2F0ZSdzIHVuY29uZGl0aW9uYWwgYC5zcGFuLyoqYCBleGNsdXNpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsb2FkR2F0ZUlnbm9yZShyZXBvUm9vdDogc3RyaW5nKTogR2F0ZUlnbm9yZVJ1bGVbXSB7XG4gIHRyeSB7XG4gICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhub2RlUGF0aC5qb2luKHJlcG9Sb290LCBHQVRFX0lHTk9SRV9SRUwpLCAndXRmOCcpO1xuICAgIHJldHVybiBwYXJzZUdhdGVJZ25vcmUoY29udGVudCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBbXTtcbiAgfVxufVxuXG4vKiogVHJ1ZSB3aGVuIHNvbWUgcnVsZSBpbiBgcnVsZXNgIG1hdGNoZXMgYHJlcG9SZWxQYXRoYC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0dhdGVJZ25vcmVkKHJ1bGVzOiBHYXRlSWdub3JlUnVsZVtdLCByZXBvUmVsUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBydWxlcy5zb21lKChydWxlKSA9PiBydWxlLm1hdGNoZXMocmVwb1JlbFBhdGgpKTtcbn1cblxuLyoqIFNpZ25hdHVyZSBmb3IgaW5qZWN0aW5nIGEgcnVsZSBsb2FkZXIgKHByb2R1Y3Rpb24gZGVmYXVsdDoge0BsaW5rIGxvYWRHYXRlSWdub3JlfSkuICovXG5leHBvcnQgdHlwZSBHYXRlSWdub3JlTG9hZGVyID0gKHJlcG9Sb290OiBzdHJpbmcpID0+IEdhdGVJZ25vcmVSdWxlW107XG4iLCAiLyoqXG4gKiBQYXRoLXNjb3BlZCBzcGFuIHN1cHByZXNzaW9uIGZvciB0aGUgYWdlbnQgaG9va3MuXG4gKlxuICogU29tZSBzcGFucyBhcmUgbm9pc2Ugd2hlbiBicm93c2luZyBjZXJ0YWluIHBhcnRzIG9mIHRoZSB0cmVlIFx1MjAxNCB3aWtpIG9yXG4gKiBtYXJrZXRpbmcgc3BhbnMgdGhhdCBhbmNob3IgcHJvc2UsIHN1cmZhY2VkIGlubGluZSB3aGlsZSByZWFkaW5nIHNvdXJjZSxcbiAqIGFkZCBsaXR0bGUuIFRoaXMgbW9kdWxlIGxldHMgYSByZXBvIGRlY2xhcmUsIHBlciBwYXRoLCB3aGljaCBzcGFuIHNsdWdcbiAqIHByZWZpeGVzIHRvIGhvbGQgYmFjay5cbiAqXG4gKiBDb25maWcgbGl2ZXMgYXQgYDxyZXBvUm9vdD4vLnNwYW4vLmhvb2tpZ25vcmVgLiBFYWNoIG5vbi1jb21tZW50IGxpbmUgaXMgYVxuICogZ2l0aWdub3JlLXN0eWxlIHBhdGggcGF0dGVybiwgYSBzaW5nbGUgcnVuIG9mIHdoaXRlc3BhY2UsIHRoZW4gYVxuICogY29tbWEtc2VwYXJhdGVkIGxpc3Qgb2Ygc3BhbiBzbHVnIHByZWZpeGVzIHRvIHN1cHByZXNzIGZvciBwYXRocyB0aGUgcGF0dGVyblxuICogbWF0Y2hlczpcbiAqXG4gKiAgIHBhY2thZ2VzL2FnZW50LWhvb2tzL3NyYyB3aWtpLG1hcmtldGluZ1xuICpcbiAqIEEgc3BhbiB3aG9zZSBzbHVnIGJlZ2lucyB3aXRoIGB3aWtpYCBvciBgbWFya2V0aW5nYCAodGhlIHNsdWcgZXF1YWxzIHRoZVxuICogcHJlZml4LCBvciBpcyBgPHByZWZpeD4vXHUyMDI2YCkgaXMgdGhlbiBuZXZlciBzdXJmYWNlZCBmb3IgYW4gYW5jaG9yIHdob3NlIHBhdGhcbiAqIHNpdHMgdW5kZXIgYHBhY2thZ2VzL2FnZW50LWhvb2tzL3NyY2AgXHUyMDE0IG5laXRoZXIgaW5saW5lIGJ5IHRoZSBQcmVUb29sVXNlIGhvb2tcbiAqIG5vciBpbiB0aGUgU3RvcCBob29rJ3Mgc3RhbGUgLyByZWxhdGVkIHNlY3Rpb25zLlxuICpcbiAqIFBhdHRlcm4gZ3JhbW1hciBpcyBhIGRlbGliZXJhdGUgc3Vic2V0IG9mIGdpdGlnbm9yZTpcbiAqXG4gKiAtIEJsYW5rIGxpbmVzIGFuZCBsaW5lcyBiZWdpbm5pbmcgd2l0aCBgI2AgYXJlIHNraXBwZWQuXG4gKiAtIEEgdHJhaWxpbmcgYC9gIHJlc3RyaWN0cyB0aGUgcGF0dGVybiB0byBkaXJlY3RvcmllcyAodGhlIGxlYWYgZmlsZSBpcyBub3RcbiAqICAgaXRzZWxmIHRlc3RlZCwgb25seSBpdHMgYW5jZXN0b3IgZGlyZWN0b3JpZXMpLlxuICogLSBBIHBhdHRlcm4gY29udGFpbmluZyBhIHNsYXNoIGlzIGFuY2hvcmVkIHRvIHRoZSByZXBvIHJvb3Q7IGEgcGF0dGVybiB3aXRoXG4gKiAgIG5vIHNsYXNoIG1hdGNoZXMgYSBzaW5nbGUgcGF0aCBjb21wb25lbnQgYXQgYW55IGRlcHRoLlxuICogLSBgKmAgYW5kIGA/YCBtYXRjaCB3aXRoaW4gb25lIHBhdGggc2VnbWVudDsgYCoqYCBtYXRjaGVzIGFjcm9zcyBzZWdtZW50cy5cbiAqIC0gTmVnYXRpb24gKGAhYCkgaXMgbm90IHN1cHBvcnRlZC5cbiAqXG4gKiBTdXBwcmVzc2lvbiBpcyBmYWlsLW9wZW46IGEgbWlzc2luZyBvciB1bnJlYWRhYmxlIGAuaG9va2lnbm9yZWAsIG9yIGFcbiAqIG1hbGZvcm1lZCBsaW5lLCB5aWVsZHMgbm8gcnVsZSByYXRoZXIgdGhhbiBoaWRpbmcgc3BhbnMgdGhlIGF1dGhvciBkaWQgbm90XG4gKiBhc2sgdG8gaGlkZS5cbiAqL1xuXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgSWdub3JlUnVsZSB7XG4gIC8qKiBUaGUgcmF3IGdpdGlnbm9yZS1zdHlsZSBwYXR0ZXJuLCByZXRhaW5lZCBmb3IgZGlhZ25vc3RpY3MuICovXG4gIHBhdHRlcm46IHN0cmluZztcbiAgLyoqIFNwYW4gc2x1ZyBwcmVmaXhlcyBzdXBwcmVzc2VkIGZvciBwYXRocyB0aGlzIHJ1bGUgbWF0Y2hlcy4gKi9cbiAgcHJlZml4ZXM6IHN0cmluZ1tdO1xuICAvKiogVHJ1ZSB3aGVuIGByZXBvUmVsUGF0aGAgKFBPU0lYLCByZXBvLXJlbGF0aXZlKSBpcyBnb3Zlcm5lZCBieSB0aGlzIHJ1bGUuICovXG4gIG1hdGNoZXM6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuO1xufVxuXG5jb25zdCBIT09LX0lHTk9SRV9SRUwgPSBub2RlUGF0aC5qb2luKCcuc3BhbicsICcuaG9va2lnbm9yZScpO1xuXG4vKipcbiAqIFRyYW5zbGF0ZSBvbmUgZ2l0aWdub3JlLXN0eWxlIGdsb2Igc2VnbWVudCBpbnRvIGFuIGFuY2hvcmVkIFJlZ0V4cC4gYCpgIGFuZFxuICogYD9gIHN0YXkgd2l0aGluIGEgcGF0aCBzZWdtZW50OyBgKipgIChvcHRpb25hbGx5IGZvbGxvd2VkIGJ5IGAvYCkgc3BhbnMgdGhlbS5cbiAqL1xuZnVuY3Rpb24gZ2xvYlRvUmVnRXhwKGdsb2I6IHN0cmluZyk6IFJlZ0V4cCB7XG4gIGxldCByZSA9ICcnO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGdsb2IubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjID0gZ2xvYltpXTtcbiAgICBpZiAoYyA9PT0gJyonKSB7XG4gICAgICBpZiAoZ2xvYltpICsgMV0gPT09ICcqJykge1xuICAgICAgICByZSArPSAnLionO1xuICAgICAgICBpKys7XG4gICAgICAgIC8vIEFic29yYiBhIGZvbGxvd2luZyBzbGFzaCBzbyBgKiovZm9vYCBkb2VzIG5vdCBkZW1hbmQgYSBsaXRlcmFsIGAvYC5cbiAgICAgICAgaWYgKGdsb2JbaSArIDFdID09PSAnLycpIGkrKztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlICs9ICdbXi9dKic7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChjID09PSAnPycpIHtcbiAgICAgIHJlICs9ICdbXi9dJztcbiAgICB9IGVsc2Uge1xuICAgICAgcmUgKz0gYy5yZXBsYWNlKC9bLiteJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG5ldyBSZWdFeHAoYF4ke3JlfSRgKTtcbn1cblxuLyoqIEFuY2VzdG9yIHBhdGggY2hhaW46IGBhL2IvYy50c2AgXHUyMTkyIGBbJ2EnLCAnYS9iJywgJ2EvYi9jLnRzJ11gLiAqL1xuZnVuY3Rpb24gYW5jZXN0b3JQYXRocyhwYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHBhcnRzID0gcGF0aC5zcGxpdCgnLycpO1xuICBjb25zdCBvdXQ6IHN0cmluZ1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICBvdXQucHVzaChwYXJ0cy5zbGljZSgwLCBpICsgMSkuam9pbignLycpKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIENvbXBpbGUgYSBzaW5nbGUgZ2l0aWdub3JlLXN0eWxlIHBhdHRlcm4gKHRoaXMgbW9kdWxlJ3MgZ3JhbW1hciBcdTIwMTQgc2VlIHRoZVxuICogbW9kdWxlIGRvYyBjb21tZW50KSBpbnRvIGEgcGF0aCBwcmVkaWNhdGUuIEEgcGF0dGVybiBtYXRjaGVzIGEgZmlsZSB3aGVuIGl0XG4gKiBtYXRjaGVzIHRoZSBmaWxlJ3MgcGF0aCBvciBhbnkgYW5jZXN0b3IgZGlyZWN0b3J5IG9mIGl0LCBzbyBhIGRpcmVjdG9yeVxuICogcGF0dGVybiBzdXBwcmVzc2VzIGV2ZXJ5dGhpbmcgYmVuZWF0aCBpdC5cbiAqXG4gKiBFeHBvcnRlZCBzbyBvdGhlciBwYXRoLXNjb3BlZCBpZ25vcmUtZmlsZSBjb252ZW50aW9ucyAoZS5nLiBgLmdhdGVpZ25vcmVgXG4gKiBpbiBgZ2F0ZS1pZ25vcmUudHNgKSBjYW4gcmV1c2UgdGhlIGV4YWN0IG1hdGNoaW5nIHNlbWFudGljcyByYXRoZXIgdGhhblxuICogcmVpbXBsZW1lbnRpbmcgdGhlbS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbXBpbGVQYXR0ZXJuKHBhdHRlcm46IHN0cmluZyk6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuIHtcbiAgbGV0IHBhdCA9IHBhdHRlcm47XG4gIGxldCBkaXJPbmx5ID0gZmFsc2U7XG4gIGlmIChwYXQuZW5kc1dpdGgoJy8nKSkge1xuICAgIGRpck9ubHkgPSB0cnVlO1xuICAgIHBhdCA9IHBhdC5zbGljZSgwLCAtMSk7XG4gIH1cbiAgbGV0IGFuY2hvcmVkID0gcGF0LmluY2x1ZGVzKCcvJyk7XG4gIGlmIChwYXQuc3RhcnRzV2l0aCgnLycpKSB7XG4gICAgYW5jaG9yZWQgPSB0cnVlO1xuICAgIHBhdCA9IHBhdC5zbGljZSgxKTtcbiAgfVxuICBjb25zdCByZSA9IGdsb2JUb1JlZ0V4cChwYXQpO1xuXG4gIHJldHVybiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4ge1xuICAgIGlmIChhbmNob3JlZCkge1xuICAgICAgY29uc3Qgc2VncyA9IGFuY2VzdG9yUGF0aHMocmVwb1JlbFBhdGgpO1xuICAgICAgLy8gRm9yIGEgZGlyLW9ubHkgcGF0dGVybiwgbmV2ZXIgdGVzdCB0aGUgbGVhZiBmaWxlIGl0c2VsZi5cbiAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBkaXJPbmx5ID8gc2Vncy5zbGljZSgwLCAtMSkgOiBzZWdzO1xuICAgICAgcmV0dXJuIGNhbmRpZGF0ZXMuc29tZSgocykgPT4gcmUudGVzdChzKSk7XG4gICAgfVxuICAgIC8vIFVuYW5jaG9yZWQ6IG1hdGNoIGFnYWluc3QgaW5kaXZpZHVhbCBwYXRoIGNvbXBvbmVudHMgYXQgYW55IGRlcHRoLlxuICAgIGNvbnN0IGNvbXBvbmVudHMgPSByZXBvUmVsUGF0aC5zcGxpdCgnLycpO1xuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBkaXJPbmx5ID8gY29tcG9uZW50cy5zbGljZSgwLCAtMSkgOiBjb21wb25lbnRzO1xuICAgIHJldHVybiBjYW5kaWRhdGVzLnNvbWUoKGMpID0+IHJlLnRlc3QoYykpO1xuICB9O1xufVxuXG4vKiogUGFyc2UgYC5ob29raWdub3JlYCB0ZXh0IGludG8gcnVsZXMsIHNraXBwaW5nIGNvbW1lbnRzIGFuZCBtYWxmb3JtZWQgbGluZXMuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VIb29rSWdub3JlKGNvbnRlbnQ6IHN0cmluZyk6IElnbm9yZVJ1bGVbXSB7XG4gIGNvbnN0IHJ1bGVzOiBJZ25vcmVSdWxlW10gPSBbXTtcbiAgZm9yIChjb25zdCByYXdMaW5lIG9mIGNvbnRlbnQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgbGluZSA9IHJhd0xpbmUudHJpbSgpO1xuICAgIGlmICghbGluZSB8fCBsaW5lLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgLy8gYDxwYXR0ZXJuPjx3aGl0ZXNwYWNlPjxwcmVmaXhlcz5gIFx1MjAxNCBwYXR0ZXJuIGlzIHRoZSBmaXJzdCB0b2tlbiwgcHJlZml4ZXNcbiAgICAvLyB0aGUgc2Vjb25kLiBBIGxpbmUgd2l0aG91dCBib3RoIGlzIG1hbGZvcm1lZCBhbmQgc2tpcHBlZC5cbiAgICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL14oXFxTKylcXHMrKFxcUyspJC8pO1xuICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFssIHBhdHRlcm4sIHByZWZpeGVzUmF3XSA9IG1hdGNoO1xuICAgIGNvbnN0IHByZWZpeGVzID0gcHJlZml4ZXNSYXdcbiAgICAgIC5zcGxpdCgnLCcpXG4gICAgICAubWFwKChwKSA9PiBwLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gICAgaWYgKHByZWZpeGVzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgcnVsZXMucHVzaCh7IHBhdHRlcm4sIHByZWZpeGVzLCBtYXRjaGVzOiBjb21waWxlUGF0dGVybihwYXR0ZXJuKSB9KTtcbiAgfVxuICByZXR1cm4gcnVsZXM7XG59XG5cbi8qKlxuICogTG9hZCB0aGUgc3VwcHJlc3Npb24gcnVsZXMgZm9yIGEgcmVwby4gRmFpbC1vcGVuOiBhbnkgcmVhZCBvciBwYXJzZSBmYWlsdXJlXG4gKiB5aWVsZHMgYW4gZW1wdHkgcnVsZSBzZXQsIHNvIHNwYW5zIHN1cmZhY2UgYXMgbm9ybWFsIHdoZW4gbm8gY29uZmlnIGV4aXN0cy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxvYWRIb29rSWdub3JlKHJlcG9Sb290OiBzdHJpbmcpOiBJZ25vcmVSdWxlW10ge1xuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMobm9kZVBhdGguam9pbihyZXBvUm9vdCwgSE9PS19JR05PUkVfUkVMKSwgJ3V0ZjgnKTtcbiAgICByZXR1cm4gcGFyc2VIb29rSWdub3JlKGNvbnRlbnQpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gW107XG4gIH1cbn1cblxuLyoqIEEgc2x1ZyBjYXJyaWVzIGEgcHJlZml4IHdoZW4gaXQgZXF1YWxzIHRoZSBwcmVmaXggb3IgaXMgYDxwcmVmaXg+L1x1MjAyNmAuICovXG5mdW5jdGlvbiBzbHVnSGFzUHJlZml4KHNsdWc6IHN0cmluZywgcHJlZml4OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHNsdWcgPT09IHByZWZpeCB8fCBzbHVnLnN0YXJ0c1dpdGgoYCR7cHJlZml4fS9gKTtcbn1cblxuLyoqXG4gKiBUcnVlIHdoZW4gYSBzcGFuIGBzbHVnYCBzaG91bGQgYmUgc3VwcHJlc3NlZCBmb3IgYW4gYW5jaG9yIGF0IGByZXBvUmVsUGF0aGA6XG4gKiBzb21lIHJ1bGUgbWF0Y2hlcyB0aGUgcGF0aCBhbmQgbGlzdHMgYSBwcmVmaXggdGhlIHNsdWcgY2Fycmllcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzU3BhblN1cHByZXNzZWQocnVsZXM6IElnbm9yZVJ1bGVbXSwgcmVwb1JlbFBhdGg6IHN0cmluZywgc2x1Zzogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3QgcnVsZSBvZiBydWxlcykge1xuICAgIGlmICghcnVsZS5tYXRjaGVzKHJlcG9SZWxQYXRoKSkgY29udGludWU7XG4gICAgaWYgKHJ1bGUucHJlZml4ZXMuc29tZSgocCkgPT4gc2x1Z0hhc1ByZWZpeChzbHVnLCBwKSkpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqIFNpZ25hdHVyZSBmb3IgaW5qZWN0aW5nIGEgcnVsZSBsb2FkZXIgKHByb2R1Y3Rpb24gZGVmYXVsdDoge0BsaW5rIGxvYWRIb29rSWdub3JlfSkuICovXG5leHBvcnQgdHlwZSBIb29rSWdub3JlTG9hZGVyID0gKHJlcG9Sb290OiBzdHJpbmcpID0+IElnbm9yZVJ1bGVbXTtcbiIsICIvKipcbiAqIENvZGV4IFByZVRvb2xVc2UgZ2F0ZSBob29rIFx1MjAxNCBob2xkIGBnaXQgY29tbWl0YC9gZ2l0IHB1c2hgIG9uIHJlYWwgc3BhbiBkZWJ0LFxuICogYW5kIGFkdmlzZSAobmV2ZXIgaG9sZCkgb24gYSBwbGFpbiBgZ2l0IHN0YXR1c2AuXG4gKlxuICogVGhlIENvZGV4IHR3aW4gb2YgW2NsYXVkZS9nYXRlLnRzXSguL3BhY2thZ2VzL2FnZW50LWhvb2tzL3NyYy9jbGF1ZGUvZ2F0ZS50cyk6XG4gKiBzYW1lIHNoYXJlZCBnYXRlLWNvcmUgcGlwZWxpbmUgKHtAbGluayBwYXJzZUdpdENvbW1hbmR9IFx1MjE5MiB7QGxpbmsgcmVzb2x2ZUNoYW5nZXNldH1cbiAqIFx1MjE5MiB7QGxpbmsgZXZhbHVhdGVHYXRlfSksIHRyYW5zbGF0ZWQgaW50byBDb2RleCdzIFByZVRvb2xVc2Ugb3V0cHV0IHNoYXBlLiBDb2RleFxuICogZGVsaXZlcnMgYSBzaGVsbCBjb21tYW5kIGFzIGFuIFNESy10eXBlZCBgdW5rbm93bmAgYHRvb2xfaW5wdXRgOyB0aGlzIGhhbmRsZXJcbiAqIG5hcnJvd3MgaXQgKHN0cmluZywgb3IgYSBgW1wiYmFzaFwiLFwiLWxjXCIsXCI8c2NyaXB0PlwiXWAvYXJndiBhcnJheSkgaW50byB0aGVcbiAqIGNvbW1hbmQgc3RyaW5nIHRoZSBjb3JlIHBhcnNlcy5cbiAqXG4gKiBcdTI1MDBcdTI1MDAgVW5jb25maXJtZWQgZGVueSAoc2VlIG5vdGVzL2NvZGV4LWRlbnktc3Bpa2UubWQpIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICogV2hldGhlciBDb2RleCdzIGBwZXJtaXNzaW9uRGVjaXNpb246ICdkZW55J2AgYWN0dWFsbHkgKmJsb2NrcyogdGhlIHNoZWxsIHRvb2xcbiAqIGxpdmUgd2FzIG5ldmVyIGNvbmZpcm1lZCBpbiB0aGlzIHJlcG86IHRoZSBQaGFzZSAwIHNwaWtlIGNvdWxkIG5vdCBnZXQgYVxuICogZnJvbS1zY3JhdGNoIHBsdWdpbiB0byBsb2FkLCBzbyB0aGUgZGVueSBwYXRoIHdhcyBuZXZlciBleGVyY2lzZWQgZW5kLXRvLWVuZC5cbiAqIFRoZSBvbmx5IHBvc2l0aXZlIGV2aWRlbmNlIGlzIGRvY3VtZW50YXJ5IFx1MjAxNCB0aGUgYEBnb29kZm9vdC9jb2RleC1ob29rc2AgUkVBRE1FXG4gKiAodGhlIGV4YWN0IHZlcnNpb24gdGhpcyByZXBvIGRlcGVuZHMgb24pIHNoaXBzIGEgd29ya2VkIGBwZXJtaXNzaW9uRGVjaXNpb246XG4gKiAnZGVueSdgIGV4YW1wbGUgbWF0Y2hlZCBvbiBgXCJCYXNoXCJgLiBUaGlzIGFkYXB0ZXIgdGhlcmVmb3JlIHNoaXBzIHRoZSBoYXJkLWRlbnlcbiAqIHBhdGggcGVyIHRoYXQgUkVBRE1FICh7QGxpbmsgQ09ERVhfR0FURV9IQVJEX0RFTll9ID0gYHRydWVgKSwgYnV0IGtlZXBzIHRoZVxuICogQ0FSRC5tZC1kb2N1bWVudGVkIGZhbGxiYWNrIFx1MjAxNCBhIGxvdWQgYGFkZGl0aW9uYWxDb250ZXh0YCB3YXJuaW5nIHRoYXQgYWxsb3dzXG4gKiB0aGUgY29tbWFuZCwgd2l0aCB0aGUgQ0kgcmVjaXBlIGFzIENvZGV4J3MgZW5mb3JjZW1lbnQgYmFja3N0b3AgXHUyMDE0IGFzIGEgY2xlYXJseVxuICogc2VwYXJhYmxlIGJyYW5jaCBiZWhpbmQgdGhhdCBvbmUgY29uc3RhbnQuIElmIGEgbGl2ZSBzZXNzaW9uIHNob3dzIGRlbnkgZG9lc1xuICogbm90IGZpcmUsIGZsaXAge0BsaW5rIENPREVYX0dBVEVfSEFSRF9ERU5ZfSB0byBgZmFsc2VgOyBub3RoaW5nIGVsc2UgY2hhbmdlcy5cbiAqXG4gKiBUaGUgc2hlbGwgdG9vbCdzIGV4YWN0IGB0b29sX25hbWVgIGlzIGxpa2V3aXNlIHVuY29uZmlybWVkICh0aGUgUkVBRE1FJ3NcbiAqIGV4YW1wbGUgdXNlcyBgXCJCYXNoXCJgOyBDb2RleCBDTEkgdHJhbnNjcmlwdHMgaW4gdGhlIHNwaWtlIGxhYmVsZWQgdGhlIGNhbGxcbiAqIGBleGVjYCkuIFRoZSByZWdpc3RyYXRpb24gbWF0Y2hlciBpcyBicm9hZGVuZWQgdG8gdGhlIHBsYXVzaWJsZSBuYW1lcyBzbyB0aGVcbiAqIGhvb2sgYWN0dWFsbHkgZmlyZXMsIGFuZCBldmVyeSBmaXJlIGxvZ3MgdGhlIG9ic2VydmVkIGB0b29sX25hbWVgIHNvIHRoZSBmaXJzdFxuICogbGl2ZSBydW4gcmV2ZWFscyB0aGUgbGl0ZXJhbCBzdHJpbmcgdG8gbmFycm93IHRoZSBtYXRjaGVyIHRvLlxuICpcbiAqIEZhaWwtb3BlbiBhdCBldmVyeSBsYXllcjogZ2F0ZS1jb3JlIHJlc29sdmVzIGludGVybmFsIGVycm9ycyB0byBhbGxvdywgYW5kIHRoaXNcbiAqIGFkYXB0ZXIgd3JhcHMgdGhlIHdob2xlIHBhdGggaW4gYSB0cnkvY2F0Y2ggdGhhdCBhbGxvd3MtYW5kLWxvZ3MgXHUyMDE0IHRoZSBnYXRlXG4gKiBtdXN0IG5ldmVyIGJyaWNrIGEgY29tbWl0LiBUaGUgdGltZW91dCBpcyBtaWxsaXNlY29uZHMgaGVyZSAodGhlIENvZGV4IENMSVxuICogZGl2aWRlcyB0byBzZWNvbmRzIGF0IGVtaXQpLlxuICovXG5cbmltcG9ydCB7IHR5cGUgSG9va0NvbnRleHQsIHR5cGUgUHJlVG9vbFVzZUlucHV0LCBwcmVUb29sVXNlSG9vaywgcHJlVG9vbFVzZU91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jb2RleC1ob29rcyc7XG5pbXBvcnQge1xuICBjb21taXRTdGFnZXNBbGwsXG4gIGNyZWF0ZURlZmF1bHRHYXRlRXhlY3V0b3JzLFxuICBjcmVhdGVEZWZhdWx0R2l0RXhlY3V0b3IsXG4gIGNyZWF0ZURpc2tHYXRlTWVtb1N0YXRlLFxuICBldmFsdWF0ZUdhdGUsXG4gIHR5cGUgR2F0ZUV4ZWN1dG9ycyxcbiAgdHlwZSBHYXRlTWVtb1N0YXRlLFxuICB0eXBlIEdpdEV4ZWN1dG9yLFxuICBwYXJzZUdpdENvbW1hbmQsXG4gIHJlc29sdmVDaGFuZ2VzZXQsXG4gIHdyYXBHaXRTcGFuQ29udGV4dFxufSBmcm9tICcuLi9jb21tb24vZ2F0ZS1jb3JlLmpzJztcblxuLyoqXG4gKiBXaGV0aGVyIENvZGV4J3MgYHBlcm1pc3Npb25EZWNpc2lvbjogJ2RlbnknYCBpcyB0cnVzdGVkIHRvIGJsb2NrIHRoZSBzaGVsbCB0b29sXG4gKiBsaXZlLiBTaGlwcyBgdHJ1ZWAgKGhhcmQgZGVueSkgcGVyIHRoZSBgQGdvb2Rmb290L2NvZGV4LWhvb2tzYCBSRUFETUUncyB3b3JrZWRcbiAqIGV4YW1wbGUuIEZsaXAgdG8gYGZhbHNlYCB0byBhY3RpdmF0ZSB0aGUgQ0FSRC5tZC1kb2N1bWVudGVkIGZhbGxiYWNrIGlmIGEgbGl2ZVxuICogc2Vzc2lvbiBzaG93cyBkZW55IGRvZXMgbm90IGZpcmUgXHUyMDE0IHNlZSBub3Rlcy9jb2RleC1kZW55LXNwaWtlLm1kIGFuZCB0aGlzXG4gKiBmaWxlJ3MgaGVhZGVyLiBUaGlzIGlzIHRoZSBzaW5nbGUgc3dpdGNoIHRoYXQgc2VwYXJhdGVzIHRoZSB0d28gY29kZSBwYXRocy5cbiAqL1xuY29uc3QgQ09ERVhfR0FURV9IQVJEX0RFTlkgPSB0cnVlO1xuXG4vKipcbiAqIE5hcnJvdyBDb2RleCdzIGB1bmtub3duYCBzaGVsbCBgdG9vbF9pbnB1dGAgaW50byB0aGUgY29tbWFuZCBzdHJpbmcgdGhlIGNvcmVcbiAqIHBhcnNlcy4gSGFuZGxlcyBhIGJhcmUgYGNvbW1hbmRgIHN0cmluZywgYSBzaGVsbC13cmFwcGVyIGFyZ3ZcbiAqIChgW1wiYmFzaFwiLFwiLWxjXCIsXCI8c2NyaXB0PlwiXWAgXHUyMTkyIHRoZSBzY3JpcHQgYWZ0ZXIgYC1jYC9gLWxjYCksIGFuZCBhIGRpcmVjdCBhcmd2XG4gKiAoYFtcImdpdFwiLFwiY29tbWl0XCIsXHUyMDI2XWAgXHUyMTkyIHNwYWNlLWpvaW5lZCkuIFJldHVybnMgYG51bGxgIHdoZW4gbm8gY29tbWFuZCB0ZXh0IGlzXG4gKiByZWNvdmVyYWJsZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RTaGVsbENvbW1hbmQodG9vbElucHV0OiB1bmtub3duKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICh0b29sSW5wdXQgPT09IG51bGwgfHwgdHlwZW9mIHRvb2xJbnB1dCAhPT0gJ29iamVjdCcgfHwgISgnY29tbWFuZCcgaW4gdG9vbElucHV0KSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGNvbW1hbmQgPSAodG9vbElucHV0IGFzIHsgY29tbWFuZDogdW5rbm93biB9KS5jb21tYW5kO1xuICBpZiAodHlwZW9mIGNvbW1hbmQgPT09ICdzdHJpbmcnKSByZXR1cm4gY29tbWFuZC5sZW5ndGggPiAwID8gY29tbWFuZCA6IG51bGw7XG4gIGlmIChBcnJheS5pc0FycmF5KGNvbW1hbmQpKSB7XG4gICAgY29uc3QgcGFydHMgPSBjb21tYW5kLmZpbHRlcigocCk6IHAgaXMgc3RyaW5nID0+IHR5cGVvZiBwID09PSAnc3RyaW5nJyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgZmxhZ0lkeCA9IHBhcnRzLmZpbmRJbmRleCgocCkgPT4gcCA9PT0gJy1jJyB8fCBwID09PSAnLWxjJyB8fCBwID09PSAnLWljJyk7XG4gICAgaWYgKGZsYWdJZHggPj0gMCAmJiBwYXJ0c1tmbGFnSWR4ICsgMV0gIT09IHVuZGVmaW5lZCkgcmV0dXJuIHBhcnRzW2ZsYWdJZHggKyAxXTtcbiAgICByZXR1cm4gcGFydHMuam9pbignICcpO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlSGFuZGxlcihcbiAgZ2l0OiBHaXRFeGVjdXRvciA9IGNyZWF0ZURlZmF1bHRHaXRFeGVjdXRvcigpLFxuICBleGVjdXRvcnM6IEdhdGVFeGVjdXRvcnMgPSBjcmVhdGVEZWZhdWx0R2F0ZUV4ZWN1dG9ycygpLFxuICBtZW1vRmFjdG9yeTogKGN3ZDogc3RyaW5nKSA9PiBHYXRlTWVtb1N0YXRlID0gY3JlYXRlRGlza0dhdGVNZW1vU3RhdGUsXG4gIC8vIFRoZSBoYXJkLWRlbnkgc3dpdGNoIGlzIGEgcGFyYW1ldGVyIChkZWZhdWx0aW5nIHRvIHRoZSBzaGlwcGVkIGNvbnN0YW50KSBzb1xuICAvLyB0aGUgZG9jdW1lbnRlZCBmYWxsYmFjayBicmFuY2ggaXMgZGlyZWN0bHkgZXhlcmNpc2FibGUgaW4gdGVzdHMgd2l0aG91dFxuICAvLyBtdXRhdGluZyBhIG1vZHVsZS1sZXZlbCBjb25zdC4gUHJvZHVjdGlvbiB3aXJpbmcgbmV2ZXIgcGFzc2VzIHRoaXMgXHUyMDE0IHRoZVxuICAvLyBkZWZhdWx0IGV4cG9ydCBiZWxvdyBjb25zdHJ1Y3RzIHRoZSBoYW5kbGVyIHdpdGggdGhlIGNvbnN0YW50J3MgdmFsdWUuXG4gIGhhcmREZW55OiBib29sZWFuID0gQ09ERVhfR0FURV9IQVJEX0RFTllcbikge1xuICByZXR1cm4gYXN5bmMgKGlucHV0OiBQcmVUb29sVXNlSW5wdXQsIGN0eDogSG9va0NvbnRleHQpID0+IHtcbiAgICB0cnkge1xuICAgICAgLy8gTG9nIHRoZSBvYnNlcnZlZCBzaGVsbCB0b29sX25hbWUgc28gdGhlIGZpcnN0IGxpdmUgcnVuIHJldmVhbHMgdGhlIGxpdGVyYWxcbiAgICAgIC8vIHN0cmluZyB0byBuYXJyb3cgdGhlIG1hdGNoZXIgdG8gKHRoZSBzcGlrZSBuZXZlciBjb25maXJtZWQgaXQgZW1waXJpY2FsbHkpLlxuICAgICAgY3R4LmxvZ2dlci5pbmZvKCdnaXQtc3BhbiBnYXRlIG9ic2VydmVkIHNoZWxsIHRvb2wnLCB7IHRvb2xfbmFtZTogaW5wdXQudG9vbF9uYW1lIH0pO1xuXG4gICAgICBjb25zdCBjb21tYW5kID0gZXh0cmFjdFNoZWxsQ29tbWFuZChpbnB1dC50b29sX2lucHV0KTtcbiAgICAgIGlmIChjb21tYW5kID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgICBjb25zdCBwYXJzZWQgPSBwYXJzZUdpdENvbW1hbmQoY29tbWFuZCk7XG4gICAgICBpZiAocGFyc2VkLmtpbmQgPT09ICdub25lJykgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgICAgY29uc3QgY3dkID0gaW5wdXQuY3dkID8/ICcnO1xuICAgICAgY29uc3QgYWxsID0gcGFyc2VkLmtpbmQgPT09ICdjb21taXQnID8gY29tbWl0U3RhZ2VzQWxsKGNvbW1hbmQpIDogZmFsc2U7XG4gICAgICBjb25zdCBjaGFuZ2VzZXQgPSBhd2FpdCByZXNvbHZlQ2hhbmdlc2V0KHBhcnNlZC5raW5kLCBhbGwsIGN3ZCwgZ2l0LCBwYXJzZWQucGF0aHMpO1xuXG4gICAgICBjb25zdCBtb2RlID0gcGFyc2VkLmtpbmQgPT09ICdzdGF0dXMnID8gJ2luZm9ybScgOiAnZW5mb3JjZSc7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBldmFsdWF0ZUdhdGUoY2hhbmdlc2V0LCBjd2QsIGV4ZWN1dG9ycywgbWVtb0ZhY3RvcnkoY3dkKSwgbW9kZSk7XG4gICAgICBpZiAocmVzdWx0LmRlY2lzaW9uICE9PSAnZGVueScpIHtcbiAgICAgICAgLy8gRW52aXJvbm1lbnRhbCBzdGFsZW5lc3MgYW5kIGEgZmFpbGVkIHN0YWxlbmVzcyBzY2FuIGJvdGggYWxsb3dcbiAgICAgICAgLy8gKGZhaWwtb3BlbikgYnV0IG11c3Qgbm90IGJlIHN3YWxsb3dlZDogbG9nIGFuZCBzdXJmYWNlIHRoZSByZWFzb24gYXNcbiAgICAgICAgLy8gYWRkaXRpb25hbCBjb250ZXh0LlxuICAgICAgICBpZiAocmVzdWx0LmtpbmQgPT09ICdlbnZpcm9ubWVudGFsJyB8fCByZXN1bHQua2luZCA9PT0gJ3NjYW4tZmFpbGVkJykge1xuICAgICAgICAgIGN0eC5sb2dnZXIud2FybignZ2l0LXNwYW4gZ2F0ZSBhbGxvd2VkIHdpdGggYW4gdW5yZXNvbHZlZCBjb25kaXRpb24nLCB7IHJlYXNvbjogcmVzdWx0LnJlYXNvbiB9KTtcbiAgICAgICAgICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7XG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogd3JhcEdpdFNwYW5Db250ZXh0KHJlc3VsdC5yZWFzb24pLFxuICAgICAgICAgICAgc3lzdGVtTWVzc2FnZTogcmVzdWx0LnJlYXNvblxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIC8vIGBzdGF0dXNgLW9ubHkgYWR2aXNvcnkga2luZHM6IHNwYW4gZGVidCBleGlzdHMsIGJ1dCBhIHN0YXR1cyBjaGVja1xuICAgICAgICAvLyBuZXZlciBob2xkcyB0aGUgY29tbWFuZCBcdTIwMTQgc3VyZmFjZSBpdCBhcyBpbmZvcm1hdGlvbiwgbm90IGEgd2FybmluZy5cbiAgICAgICAgaWYgKHJlc3VsdC5raW5kID09PSAnc2VtYW50aWMtc3RhbGVuZXNzLWluZm8nIHx8IHJlc3VsdC5raW5kID09PSAndW5jb3ZlcmVkLXdyaXRlcy1pbmZvJykge1xuICAgICAgICAgIHJldHVybiBwcmVUb29sVXNlT3V0cHV0KHtcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiB3cmFwR2l0U3BhbkNvbnRleHQocmVzdWx0LnJlYXNvbiksXG4gICAgICAgICAgICBzeXN0ZW1NZXNzYWdlOiByZXN1bHQucmVhc29uXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgaWYgKGhhcmREZW55KSB7XG4gICAgICAgIC8vIFByaW1hcnkgcGF0aCAocGVyIHRoZSBSRUFETUUpOiBhY3R1YWxseSBibG9jayB0aGUgY29tbWFuZC5cbiAgICAgICAgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoe1xuICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvbjogJ2RlbnknLFxuICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvblJlYXNvbjogcmVzdWx0LnJlYXNvbixcbiAgICAgICAgICBzeXN0ZW1NZXNzYWdlOiByZXN1bHQucmVhc29uXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgLy8gRmFsbGJhY2sgcGF0aCAoQ0FSRC5tZCBjb250aW5nZW5jeSk6IGNhbm5vdCBibG9jaywgc28gc3VyZmFjZSB0aGUgc2FtZVxuICAgICAgLy8gY2hlY2tsaXN0IGFzIGEgbG91ZCB3YXJuaW5nIGFuZCBhbGxvdyBcdTIwMTQgdGhlIENJIHJlY2lwZSBlbmZvcmNlcyBmb3IgQ29kZXguXG4gICAgICBjb25zdCB3YXJuaW5nID0gYENvdWxkIG5vdCBibG9jayB0aGlzIGNvbW1hbmQgXHUyMDE0IHRoZSBpc3N1ZSBiZWxvdyBzdGlsbCBuZWVkcyByZXNvbHZpbmc6XFxuJHtyZXN1bHQucmVhc29ufWA7XG4gICAgICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiB3cmFwR2l0U3BhbkNvbnRleHQod2FybmluZyksIHN5c3RlbU1lc3NhZ2U6IHdhcm5pbmcgfSk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjdHgubG9nZ2VyLndhcm4oJ2dpdC1zcGFuIGdhdGUgZmFpbGVkIG9wZW4gb24gYW4gdW5jYXVnaHQgZXJyb3InLCB7IGVyciB9KTtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBwcmVUb29sVXNlSG9vayh7IG1hdGNoZXI6ICdCYXNofHNoZWxsfGV4ZWN8bG9jYWxfc2hlbGwnLCB0aW1lb3V0OiAxMF8wMDAgfSwgY3JlYXRlSGFuZGxlcigpKTtcbiIsICJpbXBvcnQgaG9vayBmcm9tIFwiLi9nYXRlLnRzXCI7XG5pbXBvcnQgeyBleGVjdXRlIH0gZnJvbSBcIi4uLy4uLy4uLy4uL25vZGVfbW9kdWxlcy9AZ29vZGZvb3QvY29kZXgtaG9va3MvZGlzdC9ydW50aW1lLmpzXCI7XG5leGVjdXRlKGhvb2spO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQTRCTyxJQUFNLDBCQUEwQixvQkFBSSxJQUFJLENBQUMsZ0JBQWdCLG9CQUFvQixlQUFlLENBQUM7OztBQzVCcEcsU0FBUyxlQUFlLGVBQWUsUUFBUSxTQUFTO0FBQ3BELFFBQU0sT0FBTztBQUNiLE9BQUssZ0JBQWdCO0FBQ3JCLE9BQUssVUFBVSxPQUFPO0FBQ3RCLE9BQUssZ0JBQWdCLE9BQU87QUFDNUIsTUFBSSxhQUFhLFVBQVUsT0FBTyxPQUFPLFlBQVksVUFBVTtBQUMzRCxTQUFLLFVBQVUsT0FBTztBQUFBLEVBQzFCO0FBQ0EsU0FBTztBQUNYO0FBQ08sU0FBUyxlQUFlLFFBQVEsU0FBUztBQUM1QyxTQUFPLGVBQWUsY0FBYyxRQUFRLE9BQU87QUFDdkQ7OztBQ1pBLFNBQVMsV0FBVyxZQUFZLFdBQVcsVUFBVSxpQkFBaUI7QUFDdEUsU0FBUyxlQUFlO0FBQ3hCLElBQU0sc0JBQXNCO0FBQ3JCLElBQU0sU0FBTixNQUFhO0FBQUEsRUFDaEIsV0FBVyxvQkFBSSxJQUFJO0FBQUEsRUFDbkIsa0JBQWtCO0FBQUEsRUFD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QixPQUFPLE1BQU07QUFBQSxZQUNuRCxlQUFlLE9BQU87QUFBQSxVQUN4QixDQUFDO0FBQUEsUUFDSDtBQUNBLGVBQU87QUFBQSxNQUNUO0FBRUEsVUFBSSxVQUFVO0FBRVosZUFBTyxpQkFBaUI7QUFBQSxVQUN0QixvQkFBb0I7QUFBQSxVQUNwQiwwQkFBMEIsT0FBTztBQUFBLFVBQ2pDLGVBQWUsT0FBTztBQUFBLFFBQ3hCLENBQUM7QUFBQSxNQUNIO0FBR0EsWUFBTSxVQUFVO0FBQUEsRUFBMEUsT0FBTyxNQUFNO0FBQ3ZHLGFBQU8saUJBQWlCLEVBQUUsbUJBQW1CLG1CQUFtQixPQUFPLEdBQUcsZUFBZSxRQUFRLENBQUM7QUFBQSxJQUNwRyxTQUFTLEtBQUs7QUFDWixVQUFJLE9BQU8sS0FBSyxrREFBa0QsRUFBRSxJQUFJLENBQUM7QUFDekUsYUFBTztBQUFBLElBQ1Q7QUFBQSxFQUNGO0FBQ0Y7QUFFQSxJQUFPLGVBQVEsZUFBZSxFQUFFLFNBQVMsK0JBQStCLFNBQVMsSUFBTyxHQUFHLGNBQWMsQ0FBQzs7O0FDcEoxRyxRQUFRLFlBQUk7IiwKICAibmFtZXMiOiBbInJlc29sdmUiLCAiZXhlY0ZpbGVTeW5jIiwgImZzIiwgIm5vZGVQYXRoIiwgImZzIiwgIm5vZGVQYXRoIiwgImZzIiwgIm5vZGVQYXRoIiwgImNhbmRpZGF0ZXMiLCAic3RhZ2VkIiwgInRyYWNrZWQiLCAic2VlbiIsICJ1bmNvdmVyZWQiLCAiY292ZXJpbmciLCAiY2xvc2luZyIsICJib2R5IiwgImV4ZWNGaWxlU3luYyJdCn0K

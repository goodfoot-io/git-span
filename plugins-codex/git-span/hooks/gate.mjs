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
        const seen2 = wasAlreadySeen(memoState, gateStateDigest(semantic, []));
        return {
          decision: "allow",
          kind: "semantic-staleness-info",
          findings: semantic,
          reason: renderStalenessReason(semantic, await fetchSpanBlocks(executors, semantic, cwd), "inform", seen2)
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
      const seen = wasAlreadySeen(memoState, gateStateDigest([], uncovered2));
      return {
        decision: "allow",
        kind: "uncovered-writes-info",
        uncovered: uncovered2,
        reason: renderUncoveredReason(
          uncovered2,
          covering2,
          await fetchSpanBlocks(executors, covering2, cwd),
          "inform",
          seen
        )
      };
    }
    let semanticAlreadyPresented = false;
    if (semantic.length > 0) {
      const semanticDigest = gateStateDigest(semantic, []);
      if (memoState.has(semanticDigest)) {
        semanticAlreadyPresented = true;
      } else if (memoState.has(`seen-${semanticDigest}`)) {
        memoState.record(semanticDigest);
        semanticAlreadyPresented = true;
      } else {
        if (!memoState.record(semanticDigest)) return { decision: "allow", kind: "silent" };
        memoState.record(`seen-${semanticDigest}`);
        return {
          decision: "deny",
          kind: "semantic-staleness",
          findings: semantic,
          reason: renderStalenessReason(semantic, await fetchSpanBlocks(executors, semantic, cwd), "enforce")
        };
      }
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
    if (memoState.has(`seen-${digest}`)) {
      memoState.record(digest);
      return { decision: "allow", kind: "already-presented" };
    }
    if (!memoState.record(digest)) return { decision: "allow", kind: "silent" };
    memoState.record(`seen-${digest}`);
    return {
      decision: "deny",
      kind: "uncovered-writes",
      uncovered,
      reason: renderUncoveredReason(uncovered, covering, await fetchSpanBlocks(executors, covering, cwd), "enforce")
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
  if (names.length === 0) return "";
  try {
    return await executors.listBlocks(names, cwd);
  } catch {
    return "";
  }
}
function extractWhy(blocksText, name) {
  const trimmed = blocksText.trim();
  if (trimmed.length === 0) return "";
  for (const block of trimmed.split("\n\n---\n\n")) {
    const lines = block.split("\n");
    if (lines[0] !== `## ${name}`) continue;
    let i = 1;
    while (i < lines.length && (lines[i].startsWith("- ") || lines[i] === "*Span has no anchors*")) i++;
    if (lines[i] === "") i++;
    return lines.slice(i).join("\n").trim();
  }
  return "";
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
    const closing2 = `Already flagged above \u2014 update the drifted locations or the description.`;
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
var RELATED_SPANS_CAP = 8;
function dirParts(path) {
  const parts = path.split("/");
  parts.pop();
  return parts;
}
function pathProximity(a, b) {
  const x = dirParts(a);
  const y = dirParts(b);
  let shared = 0;
  while (shared < x.length && shared < y.length && x[shared] === y[shared]) shared++;
  const deepest = Math.max(x.length, y.length);
  if (deepest === 0) return 1;
  return shared / deepest;
}
function groupCoveringByName(covering, uncovered) {
  const byName = /* @__PURE__ */ new Map();
  for (const row of covering) {
    const group = byName.get(row.name) ?? { anchors: /* @__PURE__ */ new Set(), paths: /* @__PURE__ */ new Set() };
    group.anchors.add(anchorText(row));
    group.paths.add(row.path);
    byName.set(row.name, group);
  }
  return [...byName.entries()].map(([name, group]) => {
    let proximity = 0;
    for (const path of group.paths) {
      for (const target of uncovered) proximity = Math.max(proximity, pathProximity(path, target));
    }
    return { name, anchors: [...group.anchors].sort(), coOccurrence: group.paths.size, proximity };
  }).sort(
    (a, b) => b.coOccurrence - a.coOccurrence || b.proximity - a.proximity || // Codepoint order, matching the plain `.sort()` this key replaced —
    // `localeCompare` would make the tie-break locale-dependent, and the
    // whole point of this key is that it is not.
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  ).map(({ name, anchors }) => ({ name, anchors }));
}
function renderRelatedSpansSection(covering, uncovered, coveringBlocksText) {
  if (covering.length === 0) return [];
  const lines = [
    "",
    "---",
    "",
    "Other files in this change already belong to spans \u2014 an uncovered file above might belong with one of these instead of a new one:"
  ];
  const groups = groupCoveringByName(covering, uncovered);
  for (const { name, anchors } of groups.slice(0, RELATED_SPANS_CAP)) {
    lines.push("", `## ${name}`, ...anchors.map((anchor) => `- ${anchor}`));
    const why = extractWhy(coveringBlocksText, name);
    if (why.length > 0) lines.push("", why);
  }
  const hidden = groups.length - RELATED_SPANS_CAP;
  if (hidden > 0) {
    lines.push(
      "",
      hidden === 1 ? "1 more span covers files in this change and is not shown \u2014 `git span list <path>` shows a path's spans." : `${hidden} more spans cover files in this change and are not shown \u2014 \`git span list <path>\` shows a path's spans.`
    );
  }
  return lines;
}
function renderUncoveredReason(uncovered, covering, coveringBlocksText, mode = "enforce", alreadySeen = false) {
  const lines = uncovered.map((path) => `- ${path}`);
  if (alreadySeen) {
    const body2 = ["<git-span>", ...lines, "", "Already flagged for git-span review above."];
    body2.push(...renderRelatedSpansSection(covering, uncovered, coveringBlocksText));
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
  body.push(...renderRelatedSpansSection(covering, uncovered, coveringBlocksText));
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2NvbnN0YW50cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2dhdGUtY29yZS50cyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL2dhdGUtaWdub3JlLnRzIiwgInNyYy9jb21tb24vc3Bhbi1pZ25vcmUudHMiLCAic3JjL2NvZGV4L2dhdGUudHMiLCAic3JjL2NvZGV4L2dhdGUtZW50cnkudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImV4cG9ydCBjb25zdCBQQUNLQUdFX05BTUUgPSBcIkBnb29kZm9vdC9jb2RleC1ob29rc1wiO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfVElNRU9VVF9NUyA9IDYwMF8wMDA7XG5leHBvcnQgY29uc3QgREVGQVVMVF9TVEFUVVNfTUVTU0FHRSA9IHVuZGVmaW5lZDtcbmV4cG9ydCBjb25zdCBERUZBVUxUX0VTQlVJTERfTE9BREVSUyA9IHtcbiAgICBcIi5tZFwiOiBcInRleHRcIixcbn07XG5leHBvcnQgY29uc3QgSE9PS19GQUNUT1JZX1RPX0VWRU5UID0ge1xuICAgIHByZVRvb2xVc2VIb29rOiBcIlByZVRvb2xVc2VcIixcbiAgICBwb3N0VG9vbFVzZUhvb2s6IFwiUG9zdFRvb2xVc2VcIixcbiAgICBwZXJtaXNzaW9uUmVxdWVzdEhvb2s6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICB1c2VyUHJvbXB0U3VibWl0SG9vazogXCJVc2VyUHJvbXB0U3VibWl0XCIsXG4gICAgc2Vzc2lvblN0YXJ0SG9vazogXCJTZXNzaW9uU3RhcnRcIixcbiAgICBzdWJhZ2VudFN0YXJ0SG9vazogXCJTdWJhZ2VudFN0YXJ0XCIsXG4gICAgc3RvcEhvb2s6IFwiU3RvcFwiLFxuICAgIHN1YmFnZW50U3RvcEhvb2s6IFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgcHJlQ29tcGFjdEhvb2s6IFwiUHJlQ29tcGFjdFwiLFxuICAgIHBvc3RDb21wYWN0SG9vazogXCJQb3N0Q29tcGFjdFwiLFxufTtcbmV4cG9ydCBjb25zdCBFVkVOVFNfV0lUSF9NQVRDSEVSID0gbmV3IFNldChbXG4gICAgXCJQcmVUb29sVXNlXCIsXG4gICAgXCJQb3N0VG9vbFVzZVwiLFxuICAgIFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICBcIlNlc3Npb25TdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgXCJQcmVDb21wYWN0XCIsXG4gICAgXCJQb3N0Q29tcGFjdFwiLFxuXSk7XG5leHBvcnQgY29uc3QgRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQgPSBuZXcgU2V0KFtcIlNlc3Npb25TdGFydFwiLCBcIlVzZXJQcm9tcHRTdWJtaXRcIiwgXCJTdWJhZ2VudFN0YXJ0XCJdKTtcbiIsICJmdW5jdGlvbiBhdHRhY2hNZXRhZGF0YShob29rRXZlbnROYW1lLCBjb25maWcsIGhhbmRsZXIpIHtcbiAgICBjb25zdCBob29rID0gaGFuZGxlcjtcbiAgICBob29rLmhvb2tFdmVudE5hbWUgPSBob29rRXZlbnROYW1lO1xuICAgIGhvb2sudGltZW91dCA9IGNvbmZpZy50aW1lb3V0O1xuICAgIGhvb2suc3RhdHVzTWVzc2FnZSA9IGNvbmZpZy5zdGF0dXNNZXNzYWdlO1xuICAgIGlmIChcIm1hdGNoZXJcIiBpbiBjb25maWcgJiYgdHlwZW9mIGNvbmZpZy5tYXRjaGVyID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGhvb2subWF0Y2hlciA9IGNvbmZpZy5tYXRjaGVyO1xuICAgIH1cbiAgICByZXR1cm4gaG9vaztcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQcmVUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBvc3RUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcGVybWlzc2lvblJlcXVlc3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gdXNlclByb21wdFN1Ym1pdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiVXNlclByb21wdFN1Ym1pdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25TdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU2Vzc2lvblN0YXJ0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3ViYWdlbnRTdGFydFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN0b3BcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN1YmFnZW50U3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlByZUNvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUG9zdENvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbiIsICJpbXBvcnQgeyBjbG9zZVN5bmMsIGV4aXN0c1N5bmMsIG1rZGlyU3luYywgb3BlblN5bmMsIHdyaXRlU3luYyB9IGZyb20gXCJub2RlOmZzXCI7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuY29uc3QgREVGQVVMVF9MT0dfRU5WX1ZBUiA9IFwiQ09ERVhfSE9PS1NfTE9HX0ZJTEVcIjtcbmV4cG9ydCBjbGFzcyBMb2dnZXIge1xuICAgIGhhbmRsZXJzID0gbmV3IE1hcCgpO1xuICAgIGZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIGxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgbG9nRmlsZVBhdGggPSBudWxsO1xuICAgIGN1cnJlbnRIb29rVHlwZTtcbiAgICBjdXJyZW50SW5wdXQ7XG4gICAgY29uc3RydWN0b3IoY29uZmlnID0ge30pIHtcbiAgICAgICAgdGhpcy5sb2dGaWxlUGF0aCA9IGNvbmZpZy5sb2dGaWxlUGF0aCA/PyBwcm9jZXNzLmVudltjb25maWcubG9nRW52VmFyID8/IERFRkFVTFRfTE9HX0VOVl9WQVJdID8/IG51bGw7XG4gICAgfVxuICAgIHNldENvbnRleHQoaG9va1R5cGUsIGlucHV0KSB7XG4gICAgICAgIHRoaXMuY3VycmVudEhvb2tUeXBlID0gaG9va1R5cGU7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gaW5wdXQ7XG4gICAgfVxuICAgIGNsZWFyQ29udGV4dCgpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50SG9va1R5cGUgPSB1bmRlZmluZWQ7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBvbihsZXZlbCwgaGFuZGxlcikge1xuICAgICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKSA/PyBuZXcgU2V0KCk7XG4gICAgICAgIGV4aXN0aW5nLmFkZChoYW5kbGVyKTtcbiAgICAgICAgdGhpcy5oYW5kbGVycy5zZXQobGV2ZWwsIGV4aXN0aW5nKTtcbiAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgIGV4aXN0aW5nLmRlbGV0ZShoYW5kbGVyKTtcbiAgICAgICAgICAgIGlmIChleGlzdGluZy5zaXplID09PSAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5oYW5kbGVycy5kZWxldGUobGV2ZWwpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgIH1cbiAgICBkZWJ1ZyhtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImRlYnVnXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICBpbmZvKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiaW5mb1wiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgd2FybihtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcIndhcm5cIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGVycm9yKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZXJyb3JcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGxvZ0Vycm9yKGVycm9yLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImVycm9yXCIsIGAke21lc3NhZ2V9OiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLCBjb250ZXh0KTtcbiAgICB9XG4gICAgY2xvc2UoKSB7XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgY2xvc2VTeW5jKHRoaXMubG9nRmlsZUZkKTtcbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cbiAgICBlbWl0KGxldmVsLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0ge1xuICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICBsZXZlbCxcbiAgICAgICAgICAgIGhvb2tUeXBlOiB0aGlzLmN1cnJlbnRIb29rVHlwZSxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICAuLi4odGhpcy5jdXJyZW50SW5wdXQgIT09IHVuZGVmaW5lZCA/IHsgaW5wdXQ6IHRoaXMuY3VycmVudElucHV0IH0gOiB7fSksXG4gICAgICAgICAgICAuLi4oY29udGV4dCAhPT0gdW5kZWZpbmVkID8geyBjb250ZXh0IH0gOiB7fSksXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMud3JpdGVUb0ZpbGUoZXZlbnQpO1xuICAgICAgICB0aGlzLmhhbmRsZXJzLmdldChsZXZlbCk/LmZvckVhY2goKGhhbmRsZXIpID0+IHtcbiAgICAgICAgICAgIGhhbmRsZXIoZXZlbnQpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgd3JpdGVUb0ZpbGUoZXZlbnQpIHtcbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZVBhdGggPT09IG51bGwpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXRoaXMuZmlsZUluaXRpYWxpemVkKSB7XG4gICAgICAgICAgICB0aGlzLmZpbGVJbml0aWFsaXplZCA9IHRydWU7XG4gICAgICAgICAgICBjb25zdCBsb2dEaXIgPSBkaXJuYW1lKHRoaXMubG9nRmlsZVBhdGgpO1xuICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKGxvZ0RpcikpIHtcbiAgICAgICAgICAgICAgICBta2RpclN5bmMobG9nRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gb3BlblN5bmModGhpcy5sb2dGaWxlUGF0aCwgXCJhXCIpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgd3JpdGVTeW5jKHRoaXMubG9nRmlsZUZkLCBgJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuYCk7XG4gICAgICAgIH1cbiAgICB9XG59XG5leHBvcnQgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcigpO1xuIiwgImV4cG9ydCBjb25zdCBFWElUX0NPREVTID0ge1xuICAgIFNVQ0NFU1M6IDAsXG4gICAgRVJST1I6IDEsXG4gICAgQkxPQ0s6IDIsXG59O1xuZXhwb3J0IGNsYXNzIEJsb2NrRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gICAgcmVhc29uO1xuICAgIGNvbnN0cnVjdG9yKHJlYXNvbikge1xuICAgICAgICBzdXBlcihyZWFzb24pO1xuICAgICAgICB0aGlzLm5hbWUgPSBcIkJsb2NrRXJyb3JcIjtcbiAgICAgICAgdGhpcy5yZWFzb24gPSByZWFzb247XG4gICAgfVxufVxuZnVuY3Rpb24gb21pdFVuZGVmaW5lZCh2YWx1ZSkge1xuICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModmFsdWUpLmZpbHRlcigoWywgZW50cnldKSA9PiBlbnRyeSAhPT0gdW5kZWZpbmVkKSk7XG59XG5mdW5jdGlvbiBidWlsZE91dHB1dCh0eXBlLCBzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiB7XG4gICAgICAgIF90eXBlOiB0eXBlLFxuICAgICAgICBzdGRvdXQ6IG9taXRVbmRlZmluZWQoc3Rkb3V0KSxcbiAgICAgICAgLi4uKHN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRlcnIgfSA6IHt9KSxcbiAgICB9O1xufVxuZXhwb3J0IGZ1bmN0aW9uIHJhd091dHB1dChzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlJhd1wiLCBzdGRvdXQsIHN0ZGVycik7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvbiAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy51cGRhdGVkSW5wdXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBoYXNTcGVjaWZpY1xuICAgICAgICA/IG9taXRVbmRlZmluZWQoe1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQcmVUb29sVXNlXCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvbjogb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb24sXG4gICAgICAgICAgICBwZXJtaXNzaW9uRGVjaXNpb25SZWFzb246IG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uLFxuICAgICAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgfSlcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlVG9vbFVzZVwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZUxlZ2FjeUJsb2NrT3V0cHV0KG9wdGlvbnMpIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVUb29sVXNlXCIsIHtcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fCBvcHRpb25zLnVwZGF0ZWRNQ1BUb29sT3V0cHV0ICE9PSB1bmRlZmluZWQ7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gaGFzU3BlY2lmaWNcbiAgICAgICAgPyBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUG9zdFRvb2xVc2VcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICAgICAgdXBkYXRlZE1DUFRvb2xPdXRwdXQ6IG9wdGlvbnMudXBkYXRlZE1DUFRvb2xPdXRwdXQsXG4gICAgICAgIH0pXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBvc3RUb29sVXNlXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uUmVxdWVzdE91dHB1dChvcHRpb25zKSB7XG4gICAgY29uc3QgZGVjaXNpb24gPSBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgYmVoYXZpb3I6IG9wdGlvbnMuYmVoYXZpb3IsXG4gICAgICAgIG1lc3NhZ2U6IG9wdGlvbnMubWVzc2FnZSxcbiAgICAgICAgaW50ZXJydXB0OiBvcHRpb25zLmludGVycnVwdCxcbiAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgdXBkYXRlZFBlcm1pc3Npb25zOiBvcHRpb25zLnVwZGF0ZWRQZXJtaXNzaW9ucyxcbiAgICB9KTtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSB7XG4gICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICAgICAgZGVjaXNpb24sXG4gICAgfTtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQZXJtaXNzaW9uUmVxdWVzdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiVXNlclByb21wdFN1Ym1pdFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiVXNlclByb21wdFN1Ym1pdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiU2Vzc2lvblN0YXJ0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTZXNzaW9uU3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlN1YmFnZW50U3RhcnRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3RvcE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTdG9wXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdG9wT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RvcFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlQ29tcGFjdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdENvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUG9zdENvbXBhY3RcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgIH0pO1xufVxuIiwgImltcG9ydCB7IEVWRU5UU19XSVRIX1RFWFRfT1VUUFVUIH0gZnJvbSBcIi4vY29uc3RhbnRzLmpzXCI7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tIFwiLi9sb2dnZXIuanNcIjtcbmltcG9ydCB7IEJsb2NrRXJyb3IsIEVYSVRfQ09ERVMsIHNlc3Npb25TdGFydE91dHB1dCwgc3ViYWdlbnRTdGFydE91dHB1dCwgdXNlclByb21wdFN1Ym1pdE91dHB1dCwgfSBmcm9tIFwiLi9vdXRwdXRzLmpzXCI7XG5hc3luYyBmdW5jdGlvbiByZWFkU3RkaW4oKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgY2h1bmtzID0gW107XG4gICAgICAgIHByb2Nlc3Muc3RkaW4uc2V0RW5jb2RpbmcoXCJ1dGYtOFwiKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImRhdGFcIiwgKGNodW5rKSA9PiBjaHVua3MucHVzaChjaHVuaykpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZW5kXCIsICgpID0+IHJlc29sdmUoY2h1bmtzLmpvaW4oXCJcIikpKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImVycm9yXCIsIHJlamVjdCk7XG4gICAgfSk7XG59XG5mdW5jdGlvbiBwYXJzZVN0ZGluSW5wdXQoc3RkaW5Db250ZW50KSB7XG4gICAgcmV0dXJuIEpTT04ucGFyc2Uoc3RkaW5Db250ZW50KTtcbn1cbmZ1bmN0aW9uIHdyaXRlU3Rkb3V0KG91dHB1dCkge1xuICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKEpTT04uc3RyaW5naWZ5KG91dHB1dC5zdGRvdXQpKTtcbn1cbmZ1bmN0aW9uIG5vcm1hbGl6ZVN0cmluZ091dHB1dChob29rRXZlbnROYW1lLCByZXN1bHQpIHtcbiAgICBpZiAoIUVWRU5UU19XSVRIX1RFWFRfT1VUUFVULmhhcyhob29rRXZlbnROYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7aG9va0V2ZW50TmFtZX0gaG9va3MgY2Fubm90IHJldHVybiBwbGFpbiB0ZXh0YCk7XG4gICAgfVxuICAgIGlmIChob29rRXZlbnROYW1lID09PSBcIlNlc3Npb25TdGFydFwiKSB7XG4gICAgICAgIHJldHVybiBzZXNzaW9uU3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICBpZiAoaG9va0V2ZW50TmFtZSA9PT0gXCJTdWJhZ2VudFN0YXJ0XCIpIHtcbiAgICAgICAgcmV0dXJuIHN1YmFnZW50U3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICByZXR1cm4gdXNlclByb21wdFN1Ym1pdE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gY29udmVydFRvSG9va091dHB1dChvdXRwdXQpIHtcbiAgICByZXR1cm4gb3V0cHV0LnN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQsIHN0ZGVycjogb3V0cHV0LnN0ZGVyciB9IDogeyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQgfTtcbn1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBleGVjdXRlKGhvb2tGbikge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHN0ZGluQ29udGVudCA9IGF3YWl0IHJlYWRTdGRpbigpO1xuICAgICAgICBjb25zdCBpbnB1dCA9IHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpO1xuICAgICAgICBsb2dnZXIuc2V0Q29udGV4dChob29rRm4uaG9va0V2ZW50TmFtZSwgaW5wdXQpO1xuICAgICAgICBjb25zdCBjb250ZXh0ID0geyBsb2dnZXIgfTtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaG9va0ZuKGlucHV0LCBjb250ZXh0KTtcbiAgICAgICAgbGV0IG91dHB1dCA9IHsgc3Rkb3V0OiB7fSB9O1xuICAgICAgICBpZiAodHlwZW9mIHJlc3VsdCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgb3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChub3JtYWxpemVTdHJpbmdPdXRwdXQoaG9va0ZuLmhvb2tFdmVudE5hbWUsIHJlc3VsdCkpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHJlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBvdXRwdXQgPSBjb252ZXJ0VG9Ib29rT3V0cHV0KHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgICAgd3JpdGVTdGRvdXQob3V0cHV0KTtcbiAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuU1VDQ0VTUyk7XG4gICAgfVxuICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBCbG9ja0Vycm9yKSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtlcnJvci5yZWFzb259XFxuYCk7XG4gICAgICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5CTE9DSyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke2Vycm9yLnN0YWNrID8/IGVycm9yLm1lc3NhZ2V9XFxuYCk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtTdHJpbmcoZXJyb3IpfVxcbmApO1xuICAgICAgICB9XG4gICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLkVSUk9SKTtcbiAgICB9XG4gICAgZmluYWxseSB7XG4gICAgICAgIGxvZ2dlci5jbGVhckNvbnRleHQoKTtcbiAgICAgICAgbG9nZ2VyLmNsb3NlKCk7XG4gICAgfVxufVxuIiwgIi8qKlxuICogSGFybmVzcy1hZ25vc3RpYyBnYXRlIGNvcmUgKFBoYXNlIDMuMSBcdTIwMTQgY29udHJhY3QgYW5kIHN0dWJzKS5cbiAqXG4gKiBUaGlzIG1vZHVsZSBkZWNsYXJlcyB0aGUgUHJlVG9vbFVzZSBcImdhdGVcIiB0aGF0IGJvdGggdGhlIENsYXVkZSAoYEJhc2hgKSBhbmRcbiAqIENvZGV4IChzaGVsbC9leGVjKSBhZGFwdGVycyB3aWxsIGRyaXZlOiB3aGVuIHRoZSBhZ2VudCBydW5zIGBnaXQgY29tbWl0YCBvclxuICogYGdpdCBwdXNoYCBhbmQgdGhlIGNoYW5nZXNldCBpdCBpcyBhYm91dCB0byBsYW5kIGNhcnJpZXMgcmVhbCBzcGFuIGRlYnQsIHRoZVxuICogY29tbWFuZCBpcyBoZWxkIHdpdGggYSBjaGVja2xpc3Q7IHBvc2l0aW9uYWwgZHJpZnQgdGhlIHRvdWNoIGhvb2sgaGFzIGJlZW5cbiAqIGhlYWxpbmcgYWxsIGFsb25nIG5ldmVyIGJsb2Nrcy4gTGlrZSB7QGxpbmsgZmlsZTovLy4vdG91Y2gtY29yZS50c30gaXQgaW1wb3J0c1xuICogbm90aGluZyBmcm9tIGVpdGhlciBob29rIFNESyBhbmQgaXMgdHlwZWQgc3RydWN0dXJhbGx5LCBwZXIgdGhlIGBjb21tb24vYFxuICogbGF5ZXIgY29udmVudGlvbjogYWRhcHRlcnMgdHJhbnNsYXRlIHRoZWlyIFNESy1zcGVjaWZpYyBob29rIGlucHV0IGludG8gYVxuICogY29tbWFuZCBzdHJpbmcgKyBjd2QsIGluamVjdCBleGVjdXRpb24vc3RhdGUgZGVwZW5kZW5jaWVzLCBhbmQgdHJhbnNsYXRlIHRoZVxuICogcmV0dXJuZWQge0BsaW5rIEdhdGVSZXN1bHR9IGludG8gdGhlaXIgb3duIGRlbnkvYWxsb3cgb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogZ2F0ZS1jb3JlIGlzIGEgc2libGluZyBvZiB0b3VjaC1jb3JlLCBub3QgYSBkZXBlbmRlbnQ6IHRoZSB0d28gY29yZXMgYXJlXG4gKiBpbmRlcGVuZGVudCBhbmQgdGhpcyBtb2R1bGUgaW1wb3J0cyBub3RoaW5nIGZyb20gYHRvdWNoLWNvcmUudHNgLlxuICpcbiAqIFJldXNlZCBmcm9tIHRoZSBzaGFyZWQga2VybmVsIChub3QgcmVkZWZpbmVkKTogYGlzRGVidCgpYCAodGhlIHNpbmdsZVxuICogc291cmNlIG9mIHRydXRoIGZvciB0aGUgc2VtYW50aWMtb25seSBkZWJ0IGludmFyaWFudCBcdTIwMTQgYE1PVkVEYCBhbmRcbiAqIGBSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgYXJlIG5ldmVyIGRlYnQpLCB0aGUgcG9yY2VsYWluIHN0YXR1cyB2b2NhYnVsYXJ5XG4gKiAoYFBvcmNlbGFpblN0YXR1c2AvYFBvcmNlbGFpblJvd2AvYFN0YWxlUG9yY2VsYWluUm93YCksIGFuZCBgZ2F0ZU1lbW9EaXIoKWBcbiAqICh0aGUgYDxnaXQtY29tbW9uLWRpcj4vZ2l0LXNwYW4vZ2F0ZS9gIHBhdGggdGhlIGRpc2stYmFja2VkXG4gKiB7QGxpbmsgR2F0ZU1lbW9TdGF0ZX0gd2lsbCBwZXJzaXN0IHVuZGVyKSBcdTIwMTQgYWxsIGZyb20gYWdlbnQtaG9va3MtY29tbW9uLnRzLlxuICpcbiAqIEV2ZXJ5IGZ1bmN0aW9uIHdob3NlIHJlc3VsdCBkZXBlbmRzIG9uIHJlYWwgbG9naWMgaXMgYSBgTm90IEltcGxlbWVudGVkYCBzdHViXG4gKiBpbiB0aGlzIHBoYXNlOyBQaGFzZSAzLjIgd3JpdGVzIHNraXBwZWQgY2hlY2tzIGFnYWluc3QgdGhlc2Ugc2lnbmF0dXJlcyBhbmRcbiAqIFBoYXNlIDMuMyBpbXBsZW1lbnRzIHRoZW0uXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tICdub2RlOmNyeXB0byc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQge1xuICBnYXRlTWVtb0RpcixcbiAgaHVtYW5TdGF0dXNMYWJlbCxcbiAgaXNEZWJ0LFxuICBpc0Vudmlyb25tZW50YWxTdGF0dXMsXG4gIGlzSW5zaWRlU3BhblJvb3QsXG4gIHR5cGUgUG9yY2VsYWluUm93LFxuICB0eXBlIFBvcmNlbGFpblN0YXR1cyxcbiAgcGFyc2VQb3JjZWxhaW4sXG4gIHBhcnNlU3RhbGVQb3JjZWxhaW4sXG4gIHJlc29sdmVSZXBvUm9vdCxcbiAgdHlwZSBTdGFsZVBvcmNlbGFpblJvdyxcbiAgdG9Qb3NpeFxufSBmcm9tICcuL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyBpc0dhdGVJZ25vcmVkLCBsb2FkR2F0ZUlnbm9yZSB9IGZyb20gJy4vZ2F0ZS1pZ25vcmUuanMnO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFNjYW4tZmFpbHVyZSBzaWduYWxcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJhaXNlZCBieSB0aGUgYHN0YWxlYCBleGVjdXRvciB3aGVuIGBnaXQgc3BhbiBzdGFsZWAgY291bGQgbm90ICpjb21wbGV0ZSogaXRzXG4gKiBzY29wZWQgc2NhbiBcdTIwMTQgYXMgb3Bwb3NlZCB0byBjb21wbGV0aW5nIGFuZCByZXBvcnRpbmcgZHJpZnQuIGBnaXQgc3BhbiBzdGFsZWBcbiAqIGV4aXRzIG5vbi16ZXJvIGluIHR3byB2ZXJ5IGRpZmZlcmVudCBzaXR1YXRpb25zOiBvbiBsZWdpdGltYXRlIGRyaWZ0IChyZWFsXG4gKiBwb3JjZWxhaW4gcm93cyBvbiBzdGRvdXQpIGFuZCBvbiBhIGhhcmQgc2NhbiBmYWlsdXJlIChlLmcuIGFuIHVucmVhZGFibGVcbiAqIGFuY2hvciBmaWxlIGFib3J0cyB0aGUgd2hvbGUgc2NvcGVkIHF1ZXJ5LCBsZWF2aW5nIHN0ZG91dCBlbXB0eSBhbmQgYW4gZXJyb3JcbiAqIG9uIHN0ZGVycikuIE9ubHkgdGhlIHNlY29uZCB0aHJvd3MgdGhpcywgc28ge0BsaW5rIGV2YWx1YXRlR2F0ZX0gY2FuIHRlbGwgYVxuICogc2NhbiB0aGF0ICpyYW4gY2xlYW4qIChlbXB0eSByb3dzKSBmcm9tIG9uZSB0aGF0ICpuZXZlciByYW4qIChlbXB0eSByb3dzXG4gKiBiZWNhdXNlIGl0IGFib3J0ZWQpIGFuZCByZWZ1c2UgdG8gcmVhZCB0aGUgbGF0dGVyIGFzIGEgY2xlYW4gcGFzcy4gYGRldGFpbGBcbiAqIGNhcnJpZXMgdGhlIENMSSdzIHN0ZGVyciBmb3IgdGhlIHN1cmZhY2VkIHJlYXNvbi5cbiAqL1xuZXhwb3J0IGNsYXNzIEdhdGVTY2FuRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIHJlYWRvbmx5IGRldGFpbDogc3RyaW5nO1xuICBjb25zdHJ1Y3RvcihkZXRhaWw6IHN0cmluZykge1xuICAgIHN1cGVyKGBnaXQgc3BhbiBzdGFsZSBjb3VsZCBub3QgY29tcGxldGUgaXRzIHNjYW46ICR7ZGV0YWlsfWApO1xuICAgIHRoaXMubmFtZSA9ICdHYXRlU2NhbkVycm9yJztcbiAgICB0aGlzLmRldGFpbCA9IGRldGFpbDtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENvbW1hbmQgcGFyc2luZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogVGhlIGtpbmQgb2YgZ2F0ZWQgZ2l0IGNvbW1hbmQgYSBzaGVsbCBjb21tYW5kIHN0cmluZyByZXNvbHZlcyB0by4gYCdub25lJ2BcbiAqIGlzIHRoZSBjb25zZXJ2YXRpdmUgZmFpbC1vcGVuIGFuc3dlcjogYW55IHNoYXBlIHtAbGluayBwYXJzZUdpdENvbW1hbmR9IGRvZXNcbiAqIG5vdCBjb25maWRlbnRseSByZWNvZ25pemUgYXMgYSBgZ2l0IGNvbW1pdGAvYGdpdCBwdXNoYC9gZ2l0IHN0YXR1c2AgbWFwcyB0b1xuICogYCdub25lJ2AgYW5kIHRoZSBnYXRlIGFsbG93cyB0aGUgY29tbWFuZCB0aHJvdWdoIHVudG91Y2hlZC4gYCdzdGF0dXMnYCBpc1xuICogbmV2ZXIgZGVuaWVkIFx1MjAxNCB7QGxpbmsgZXZhbHVhdGVHYXRlfSdzIGAnaW5mb3JtJ2AgbW9kZSBvbmx5IGV2ZXIgYWxsb3dzLFxuICogc3VyZmFjaW5nIGFueSBzcGFuIGRlYnQgYXMgYWR2aXNvcnkgY29udGV4dC5cbiAqL1xuZXhwb3J0IHR5cGUgR2l0Q29tbWFuZEtpbmQgPSAnY29tbWl0JyB8ICdwdXNoJyB8ICdzdGF0dXMnIHwgJ25vbmUnO1xuXG4vKipcbiAqIFRoZSByZXN1bHQgb2YgcGFyc2luZyBhIHNoZWxsIGNvbW1hbmQgc3RyaW5nIGZvciBhIGdhdGVkIGdpdCBpbnZvY2F0aW9uLlxuICpcbiAqIGBwYXRoc2AgY2FycmllcyBvbmx5IHdoYXQgaXMgcGFyc2VhYmxlIGZyb20gdGhlIGNvbW1hbmQgbGluZSBpdHNlbGYgXHUyMDE0IHRoZVxuICogZXhwbGljaXQgcGF0aHNwZWNzIGEgYGdpdCBjb21taXQgLS0gPHBhdGg+XHUyMDI2YCBmb3JtIG5hbWVzLiBJdCBpcyBkZWxpYmVyYXRlbHlcbiAqICpub3QqIHRoZSBjaGFuZ2VzZXQ6IHRoZSBmdWxsZXIgcmVzb2x1dGlvbiAoc3RhZ2VkIGZpbGVzLCB0aGUgYC1hYC9gLWFtYFxuICogZXhwYW5zaW9uIGFnYWluc3QgdHJhY2tlZC1tb2RpZmllZCBmaWxlcywgdGhlIG91dGdvaW5nIHB1c2ggcmFuZ2UpIGlzXG4gKiB7QGxpbmsgcmVzb2x2ZUNoYW5nZXNldH0ncyBqb2IsIGRyaXZlbiBmcm9tIHRoZSByZXBvIHN0YXRlLCBub3QgZnJvbSB0aGVcbiAqIGNvbW1hbmQgdGV4dC4gYHBhdGhzYCBpcyBvbWl0dGVkIHdoZW4gdGhlIGNvbW1hbmQgbmFtZXMgbm8gZXhwbGljaXRcbiAqIHBhdGhzcGVjLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFBhcnNlZEdpdENvbW1hbmQge1xuICBraW5kOiBHaXRDb21tYW5kS2luZDtcbiAgcGF0aHM/OiBzdHJpbmdbXTtcbn1cblxuLyoqXG4gKiBXb3JkLWJvdW5kYXJ5IHBhcnNlIG9mIGEgYGdpdCBjb21taXRgIC8gYGdpdCBwdXNoYCAvIGBnaXQgc3RhdHVzYCBpbnZvY2F0aW9uXG4gKiBlbWJlZGRlZCBpbiBhbiBhcmJpdHJhcnkgc2hlbGwgY29tbWFuZCBzdHJpbmcuXG4gKlxuICogTXVzdCByZWNvZ25pemUgdGhlIHJlYWwgc2hhcGVzIGNvbW1pdHMsIHB1c2hlcywgYW5kIHN0YXR1cyBjaGVja3MgYXJyaXZlIGluOlxuICogY2hhaW5lZCBjb21tYW5kcyAoYFx1MjAyNiAmJiBnaXQgY29tbWl0IFx1MjAyNmAsIGBcdTIwMjY7IGdpdCBwdXNoYCwgYFx1MjAyNiB8IFx1MjAyNmApLCBhbiBleHBsaWNpdFxuICogcmVwbyB2aWEgYGdpdCAtQyA8ZGlyPiBjb21taXQgXHUyMDI2YCwgdHJhaWxpbmcgcGF0aHNwZWNzIGFmdGVyIGAtLWAsIHRoZVxuICogYC1hYC9gLWFtYCBcImNvbW1pdCBhbGwgdHJhY2tlZC1tb2RpZmllZFwiIGZvcm1zLCBhbmQgaW52b2NhdGlvbiBmcm9tIGEgY3dkXG4gKiBiZWxvdyB0aGUgcmVwbyByb290LiBNYXRjaGluZyBpcyBvbiB3b3JkIGJvdW5kYXJpZXMsIG5ldmVyIHN1YnN0cmluZzogYSBwYXRoXG4gKiBvciBtZXNzYWdlIHRoYXQgbWVyZWx5IGNvbnRhaW5zIHRoZSB0ZXh0IGBnaXQgY29tbWl0YCBtdXN0IG5vdCB0cmlwIHRoZVxuICogZ2F0ZS5cbiAqXG4gKiBDb25zZXJ2YXRpdmUgYnkgY29udHJhY3Q6IHRoaXMgaXMgdGhlIGZhaWwtb3BlbiBwb2ludCBhdCB0aGUgcGFyc2UgbGF5ZXIsIG5vdFxuICogYSBwbGFjZSB0byBndWVzcy4gQW55IGNvbW1hbmQgd2hvc2Ugc2hhcGUgaXMgbm90IGNvbmZpZGVudGx5IGEgZ2F0ZWRcbiAqIGBnaXQgY29tbWl0YC9gZ2l0IHB1c2hgL2BnaXQgc3RhdHVzYCBcdTIwMTQgYW4gdW5mYW1pbGlhciBzdWJjb21tYW5kLCBhbiBhbGlhcywgYW5cbiAqIG9iZnVzY2F0ZWQgb3IgZHluYW1pY2FsbHktYnVpbHQgaW52b2NhdGlvbiBcdTIwMTQgcmV0dXJucyBgeyBraW5kOiAnbm9uZScgfWAgc28gdGhlXG4gKiBnYXRlIGFsbG93cyBpdCByYXRoZXIgdGhhbiBkZW55aW5nIG9uIGEgc2hha3kgcmVhZC4gKFNlZSBDQVJELm1kIFwiUmlza3MgYW5kXG4gKiByZXF1aXJlZCBzcGlrZXMgXHUyMTkyIENvbW1hbmQgcGFyc2luZ1wiIGFuZCBkZXNpZ24tZGVjaXNpb25zLm1kICMxLilcbiAqXG4gKiBAcGFyYW0gY29tbWFuZCBUaGUgcmF3IHNoZWxsIGNvbW1hbmQgc3RyaW5nIGZyb20gdGhlIGhvb2sncyB0b29sIGlucHV0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VHaXRDb21tYW5kKGNvbW1hbmQ6IHN0cmluZyk6IFBhcnNlZEdpdENvbW1hbmQge1xuICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc3BsaXRTZWdtZW50cyhjb21tYW5kKSkge1xuICAgIGNvbnN0IGludiA9IG1hdGNoR2l0SW52b2NhdGlvbih0b2tlbml6ZShzZWdtZW50KSk7XG4gICAgaWYgKCFpbnYpIGNvbnRpbnVlO1xuICAgIGlmIChpbnYuc3ViY29tbWFuZCA9PT0gJ2NvbW1pdCcpIHtcbiAgICAgIGNvbnN0IGRhc2hEYXNoID0gaW52LmFyZ3MuaW5kZXhPZignLS0nKTtcbiAgICAgIGNvbnN0IHBhdGhzID0gZGFzaERhc2ggPj0gMCA/IGludi5hcmdzLnNsaWNlKGRhc2hEYXNoICsgMSkuZmlsdGVyKChwKSA9PiBwLmxlbmd0aCA+IDApIDogW107XG4gICAgICByZXR1cm4gcGF0aHMubGVuZ3RoID4gMCA/IHsga2luZDogJ2NvbW1pdCcsIHBhdGhzIH0gOiB7IGtpbmQ6ICdjb21taXQnIH07XG4gICAgfVxuICAgIGlmIChpbnYuc3ViY29tbWFuZCA9PT0gJ3B1c2gnKSB7XG4gICAgICByZXR1cm4geyBraW5kOiAncHVzaCcgfTtcbiAgICB9XG4gICAgaWYgKGludi5zdWJjb21tYW5kID09PSAnc3RhdHVzJykge1xuICAgICAgcmV0dXJuIHsga2luZDogJ3N0YXR1cycgfTtcbiAgICB9XG4gICAgLy8gQSByZWNvZ25pemVkIGBnaXRgIGludm9jYXRpb24gdGhhdCBpcyBuZWl0aGVyIGNvbW1pdCwgcHVzaCwgbm9yIHN0YXR1c1xuICAgIC8vIChlLmcuIGBnaXQgYWRkIC4gJiYgZ2l0IGNvbW1pdCBcdTIwMjZgKToga2VlcCBzY2FubmluZyBsYXRlciBzZWdtZW50cy5cbiAgfVxuICByZXR1cm4geyBraW5kOiAnbm9uZScgfTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGEgYGdpdCBjb21taXRgIGluIHRoZSBjb21tYW5kIGlzIGFuIGAtYWAvYC1hbWAvYC0tYWxsYCBmb3JtIFx1MjAxNCB0aGVcbiAqIFwic3RhZ2UgYWxsIHRyYWNrZWQtbW9kaWZpZWQgZmlsZXNcIiB2YXJpYW50IHdob3NlIGNoYW5nZXNldCB7QGxpbmsgcmVzb2x2ZUNoYW5nZXNldH1cbiAqIG11c3Qgd2lkZW4gYmV5b25kIHRoZSBhbHJlYWR5LXN0YWdlZCBzZXQuXG4gKlxuICogVGhlIGBhbGxgIHNpZ25hbCBpcyBkZWxpYmVyYXRlbHkgKm5vdCogY2FycmllZCBvbiB7QGxpbmsgUGFyc2VkR2l0Q29tbWFuZH1cbiAqIChzZWUgdGhhdCB0eXBlJ3MgZG9jKTogdGhlIGFkYXB0ZXIgZGVyaXZlcyBpdCBoZXJlIGZyb20gdGhlIHNhbWUgY29tbWFuZCB0ZXh0XG4gKiBhbmQgdGhyZWFkcyBpdCBpbnRvIHtAbGluayByZXNvbHZlQ2hhbmdlc2V0fSBleHBsaWNpdGx5LiBDb25zZXJ2YXRpdmU6IG9ubHkgYVxuICogc2hvcnQtZmxhZyBncm91cCBjb250YWluaW5nIGBhYCAoYC1hYCwgYC1hbWAsIGAtbWFgKSBvciBhbiBleHBsaWNpdCBgLS1hbGxgLFxuICogc2Nhbm5lZCBiZWZvcmUgYW55IGAtLWAgcGF0aHNwZWMgc2VwYXJhdG9yLCBjb3VudHMuXG4gKlxuICogVmFsdWUtdGFraW5nIGNvbW1pdCBvcHRpb25zIChgLW1gLCBgLS1tZXNzYWdlYCwgYC1GYCwgYC1DYCwgXHUyMDI2KSBjb25zdW1lIHRoZWlyXG4gKiBmb2xsb3dpbmcgdG9rZW4sIHNvIGl0IGlzIG5ldmVyIHNjYW5uZWQgYXMgYSBmbGFnOiBhIG1lc3NhZ2Ugd29yZCBsaWtlXG4gKiBgLWFuYWx5c2lzYCBpbiBgZ2l0IGNvbW1pdCAtbSBcIi1hbmFseXNpc1wiYCBtdXN0IG5vdCBiZSBtaXNyZWFkIGFzIHRoZVxuICogYC0tYWxsYC1lcXVpdmFsZW50IHNob3J0LWZsYWcgY2x1c3RlciBhbmQgd2lkZW4gdGhlIGNoYW5nZXNldC5cbiAqL1xuY29uc3QgQ09NTUlUX1ZBTFVFX09QVElPTlMgPSBuZXcgU2V0KFtcbiAgJy1tJyxcbiAgJy0tbWVzc2FnZScsXG4gICctRicsXG4gICctLWZpbGUnLFxuICAnLUMnLFxuICAnLS1yZXVzZS1tZXNzYWdlJyxcbiAgJy1jJyxcbiAgJy0tcmVlZGl0LW1lc3NhZ2UnLFxuICAnLS1hdXRob3InLFxuICAnLS1kYXRlJyxcbiAgJy10JyxcbiAgJy0tdGVtcGxhdGUnLFxuICAnLS1maXh1cCcsXG4gICctLXNxdWFzaCcsXG4gICctLXRyYWlsZXInLFxuICAnLS1jbGVhbnVwJyxcbiAgJy0tZ3BnLXNpZ24nXG5dKTtcblxuZXhwb3J0IGZ1bmN0aW9uIGNvbW1pdFN0YWdlc0FsbChjb21tYW5kOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgZm9yIChjb25zdCBzZWdtZW50IG9mIHNwbGl0U2VnbWVudHMoY29tbWFuZCkpIHtcbiAgICBjb25zdCBpbnYgPSBtYXRjaEdpdEludm9jYXRpb24odG9rZW5pemUoc2VnbWVudCkpO1xuICAgIGlmICghaW52IHx8IGludi5zdWJjb21tYW5kICE9PSAnY29tbWl0JykgY29udGludWU7XG4gICAgY29uc3QgZGFzaERhc2ggPSBpbnYuYXJncy5pbmRleE9mKCctLScpO1xuICAgIGNvbnN0IGZsYWdBcmdzID0gZGFzaERhc2ggPj0gMCA/IGludi5hcmdzLnNsaWNlKDAsIGRhc2hEYXNoKSA6IGludi5hcmdzO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZmxhZ0FyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IGFyZyA9IGZsYWdBcmdzW2ldO1xuICAgICAgaWYgKGFyZyA9PT0gJy0tYWxsJykgcmV0dXJuIHRydWU7XG4gICAgICAvLyBBIHZhbHVlLXRha2luZyBvcHRpb24gY29uc3VtZXMgaXRzIGZvbGxvd2luZyB0b2tlbiBcdTIwMTQgc2tpcCB0aGF0IHRva2VuIHNvXG4gICAgICAvLyBhIG1lc3NhZ2UvYXV0aG9yL2RhdGUgYXJndW1lbnQgaXMgbmV2ZXIgc2Nhbm5lZCBhcyBhbiBgLWFgIGNsdXN0ZXIuXG4gICAgICBpZiAoQ09NTUlUX1ZBTFVFX09QVElPTlMuaGFzKGFyZykpIHtcbiAgICAgICAgaSsrO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmICghYXJnLnN0YXJ0c1dpdGgoJy0tJykgJiYgL14tW0EtWmEtel0qYVtBLVphLXpdKiQvLnRlc3QoYXJnKSkgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8vIFNoZWxsIGNvbnRyb2wgb3BlcmF0b3JzIHRoYXQgc2VwYXJhdGUgb25lIHNpbXBsZSBjb21tYW5kIGZyb20gdGhlIG5leHQuXG4vLyBTcGxpdHRpbmcgb24gdGhlc2UgKG91dHNpZGUgcXVvdGVzKSBpc29sYXRlcyBlYWNoIGNvbW1hbmQgc28gYSBgZ2l0IGNvbW1pdGAvXG4vLyBgZ2l0IHB1c2hgIGNoYWluZWQgYWZ0ZXIgYCYmYC9gO2AvYHxgIGlzIGZvdW5kLCB3aGlsZSB0ZXh0IGluc2lkZSBhIHF1b3RlZFxuLy8gYXJndW1lbnQgKGBlY2hvIFwiZ2l0IGNvbW1pdFwiYCkgc3RheXMgd2l0aGluIGl0cyBvd24gbm9uLWdpdCBzZWdtZW50LlxuY29uc3QgVFdPX0NIQVJfT1BFUkFUT1JTID0gbmV3IFNldChbJyYmJywgJ3x8J10pO1xuY29uc3QgT05FX0NIQVJfU0VQQVJBVE9SUyA9IG5ldyBTZXQoWyc7JywgJ3wnLCAnXFxuJywgJyYnLCAnKCcsICcpJ10pO1xuXG4vKiogU3BsaXQgYSBzaGVsbCBjb21tYW5kIGludG8gc2ltcGxlLWNvbW1hbmQgc2VnbWVudHMsIHJlc3BlY3RpbmcgcXVvdGVzLiAqL1xuZnVuY3Rpb24gc3BsaXRTZWdtZW50cyhjb21tYW5kOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHNlZ21lbnRzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgY3VycmVudCA9ICcnO1xuICBsZXQgcXVvdGU6ICdcIicgfCBcIidcIiB8IG51bGwgPSBudWxsO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGNvbW1hbmQubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjaCA9IGNvbW1hbmRbaV07XG4gICAgaWYgKHF1b3RlKSB7XG4gICAgICBjdXJyZW50ICs9IGNoO1xuICAgICAgaWYgKGNoID09PSBxdW90ZSkgcXVvdGUgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gJ1wiJyB8fCBjaCA9PT0gXCInXCIpIHtcbiAgICAgIHF1b3RlID0gY2g7XG4gICAgICBjdXJyZW50ICs9IGNoO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChUV09fQ0hBUl9PUEVSQVRPUlMuaGFzKGNvbW1hbmQuc2xpY2UoaSwgaSArIDIpKSkge1xuICAgICAgc2VnbWVudHMucHVzaChjdXJyZW50KTtcbiAgICAgIGN1cnJlbnQgPSAnJztcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoT05FX0NIQVJfU0VQQVJBVE9SUy5oYXMoY2gpKSB7XG4gICAgICBzZWdtZW50cy5wdXNoKGN1cnJlbnQpO1xuICAgICAgY3VycmVudCA9ICcnO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGN1cnJlbnQgKz0gY2g7XG4gIH1cbiAgc2VnbWVudHMucHVzaChjdXJyZW50KTtcbiAgcmV0dXJuIHNlZ21lbnRzO1xufVxuXG4vKipcbiAqIFRva2VuaXplIG9uZSBzZWdtZW50IGludG8gc2hlbGwgd29yZHMsIHJlc3BlY3Rpbmcgc2luZ2xlL2RvdWJsZSBxdW90ZXMgYW5kXG4gKiBzdHJpcHBpbmcgdGhlIHF1b3RlIGNoYXJhY3RlcnMuIERlbGliZXJhdGVseSBtaW5pbWFsIChubyBleHBhbnNpb24sIG5vXG4gKiBlc2NhcGUgaGFuZGxpbmcgYmV5b25kIHF1b3Rlcyk6IHRoZSBnb2FsIGlzIGNvbmZpZGVudCByZWNvZ25pdGlvbiBvZiBhXG4gKiBgZ2l0IGNvbW1pdGAvYHB1c2hgIHNoYXBlLCBub3QgYSBmdWxsIHNoZWxsIHBhcnNlci5cbiAqL1xuZnVuY3Rpb24gdG9rZW5pemUoc2VnbWVudDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCB0b2tlbnM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjdXJyZW50ID0gJyc7XG4gIGxldCBoYXMgPSBmYWxzZTtcbiAgbGV0IHF1b3RlOiAnXCInIHwgXCInXCIgfCBudWxsID0gbnVsbDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBzZWdtZW50Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgY2ggPSBzZWdtZW50W2ldO1xuICAgIGlmIChxdW90ZSkge1xuICAgICAgaWYgKGNoID09PSBxdW90ZSkgcXVvdGUgPSBudWxsO1xuICAgICAgZWxzZSBjdXJyZW50ICs9IGNoO1xuICAgICAgaGFzID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY2ggPT09ICdcIicgfHwgY2ggPT09IFwiJ1wiKSB7XG4gICAgICBxdW90ZSA9IGNoO1xuICAgICAgaGFzID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY2ggPT09ICcgJyB8fCBjaCA9PT0gJ1xcdCcpIHtcbiAgICAgIGlmIChoYXMpIHtcbiAgICAgICAgdG9rZW5zLnB1c2goY3VycmVudCk7XG4gICAgICAgIGN1cnJlbnQgPSAnJztcbiAgICAgICAgaGFzID0gZmFsc2U7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY3VycmVudCArPSBjaDtcbiAgICBoYXMgPSB0cnVlO1xuICB9XG4gIGlmIChoYXMpIHRva2Vucy5wdXNoKGN1cnJlbnQpO1xuICByZXR1cm4gdG9rZW5zO1xufVxuXG4vKiogR2l0IGdsb2JhbCBvcHRpb25zIHRoYXQgY29uc3VtZSBhIHNlcGFyYXRlIGZvbGxvd2luZyB2YWx1ZSB0b2tlbi4gKi9cbmNvbnN0IEdJVF9WQUxVRV9PUFRJT05TID0gbmV3IFNldChbXG4gICctQycsXG4gICctYycsXG4gICctLWdpdC1kaXInLFxuICAnLS13b3JrLXRyZWUnLFxuICAnLS1uYW1lc3BhY2UnLFxuICAnLS1zdXBlci1wcmVmaXgnLFxuICAnLS1leGVjLXBhdGgnLFxuICAnLS1hdHRyLXNvdXJjZScsXG4gICctLWNvbmZpZy1lbnYnXG5dKTtcblxuaW50ZXJmYWNlIEdpdEludm9jYXRpb24ge1xuICBzdWJjb21tYW5kOiBzdHJpbmc7XG4gIGFyZ3M6IHN0cmluZ1tdO1xufVxuXG4vKipcbiAqIElmIGEgc2VnbWVudCdzIHRva2VucyBhcmUgYSBgZ2l0IDxzdWJjb21tYW5kPiBcdTIwMjZgIGludm9jYXRpb24sIHJldHVybiB0aGVcbiAqIHN1YmNvbW1hbmQgYW5kIGl0cyByZW1haW5pbmcgYXJnczsgb3RoZXJ3aXNlIGBudWxsYC4gTGVhZGluZyBgVkFSPXZhbHVlYFxuICogZW52aXJvbm1lbnQgYXNzaWdubWVudHMgYW5kIGBnaXRgIGdsb2JhbCBvcHRpb25zIChpbmNsdWRpbmcgdGhlIHZhbHVlLXRha2luZ1xuICogb25lcykgYXJlIHNraXBwZWQgc28gdGhlIHN1YmNvbW1hbmQgaXMgY29ycmVjdGx5IGxvY2F0ZWQuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoR2l0SW52b2NhdGlvbih0b2tlbnM6IHN0cmluZ1tdKTogR2l0SW52b2NhdGlvbiB8IG51bGwge1xuICBsZXQgaSA9IDA7XG4gIHdoaWxlIChpIDwgdG9rZW5zLmxlbmd0aCAmJiAvXltBLVphLXpfXVtBLVphLXowLTlfXSo9Ly50ZXN0KHRva2Vuc1tpXSkpIGkrKztcbiAgaWYgKGkgPj0gdG9rZW5zLmxlbmd0aCB8fCB0b2tlbnNbaV0gIT09ICdnaXQnKSByZXR1cm4gbnVsbDtcbiAgaSsrO1xuICB3aGlsZSAoaSA8IHRva2Vucy5sZW5ndGgpIHtcbiAgICBjb25zdCB0ID0gdG9rZW5zW2ldO1xuICAgIGlmICh0ID09PSAnLS0nKSByZXR1cm4gbnVsbDsgLy8gYSBgLS1gIGJlZm9yZSBhbnkgc3ViY29tbWFuZCBpcyBub3QgYSBzaGFwZSB3ZSByZWNvZ25pemVcbiAgICBpZiAoIXQuc3RhcnRzV2l0aCgnLScpKSBicmVhaztcbiAgICBpICs9IEdJVF9WQUxVRV9PUFRJT05TLmhhcyh0KSA/IDIgOiAxO1xuICB9XG4gIGlmIChpID49IHRva2Vucy5sZW5ndGgpIHJldHVybiBudWxsO1xuICByZXR1cm4geyBzdWJjb21tYW5kOiB0b2tlbnNbaV0sIGFyZ3M6IHRva2Vucy5zbGljZShpICsgMSkgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBDaGFuZ2VzZXQgcmVzb2x1dGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogVGhlIGluamVjdGVkIGdpdCBzdXJmYWNlIHtAbGluayByZXNvbHZlQ2hhbmdlc2V0fSBuZWVkcyB0byB0dXJuIGEgcGFyc2VkXG4gKiBjb21tYW5kIGludG8gdGhlIGNvbmNyZXRlIGxpc3Qgb2YgcGF0aHMgdGhhdCB3b3VsZCBsYW5kLiBLZXB0IGFzIG5hcnJvdyBhc3luY1xuICogZnVuY3Rpb25zIChyYXRoZXIgdGhhbiBhIHJhdyBjb21tYW5kIHJ1bm5lcikgZm9sbG93aW5nIGB0b3VjaC1jb3JlLnRzYCdzXG4gKiBgVG91Y2hFeGVjdXRvcnNgIHBhdHRlcm4sIHNvIFBoYXNlIDMuMidzIHRlc3RzIGZha2UgdGhlIHJlcG8gc3RhdGUgd2l0aG91dCBhXG4gKiByZWFsIHN1YnByb2Nlc3MgYW5kIHRoZSBjb3JlIG5ldmVyIHNwYXducyBvbmUgaXRzZWxmLlxuICpcbiAqIEFsbCByZXR1cm5lZCBwYXRocyBhcmUgcmVwby1yZWxhdGl2ZSBQT1NJWCBwYXRocy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBHaXRFeGVjdXRvciB7XG4gIC8qKlxuICAgKiBQYXRocyBzdGFnZWQgZm9yIHRoZSBuZXh0IGNvbW1pdCBcdTIwMTQgYGdpdCBkaWZmIC0tY2FjaGVkIC0tbmFtZS1vbmx5YC4gVGhlc2VcbiAgICogYXJlIHdoYXQgYSBwbGFpbiBgZ2l0IGNvbW1pdGAgd291bGQgbGFuZC5cbiAgICovXG4gIHN0YWdlZFBhdGhzKGN3ZDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmdbXT47XG4gIC8qKlxuICAgKiBUcmFja2VkIGZpbGVzIHdpdGggdW5zdGFnZWQgd29ya2luZy10cmVlIG1vZGlmaWNhdGlvbnMgXHUyMDE0XG4gICAqIGBnaXQgZGlmZiAtLW5hbWUtb25seWAuIEZvbGRlZCBpbnRvIHRoZSBjaGFuZ2VzZXQgb25seSBmb3IgYC1hYC9gLWFtYFxuICAgKiBmb3Jtcywgd2hpY2ggc3RhZ2UgdHJhY2tlZC1tb2RpZmllZCBmaWxlcyBpbXBsaWNpdGx5IGF0IGNvbW1pdCB0aW1lLlxuICAgKi9cbiAgdHJhY2tlZE1vZGlmaWVkUGF0aHMoY3dkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZ1tdPjtcbiAgLyoqXG4gICAqIFBhdGhzIGluIHRoZSBvdXRnb2luZyBwdXNoIHJhbmdlIFx1MjAxNCB0aGUgZmlsZXMgY2hhbmdlZCBieSBgQHt1fS4uSEVBRGAsIHdpdGhcbiAgICogYSBtZXJnZS1iYXNlLWFnYWluc3QtdGhlLWRlZmF1bHQtcmVtb3RlLWJyYW5jaCBmYWxsYmFjayB3aGVuIG5vIHVwc3RyZWFtIGlzXG4gICAqIGNvbmZpZ3VyZWQuIFRoZXNlIGFyZSB3aGF0IGEgYGdpdCBwdXNoYCB3b3VsZCBwdWJsaXNoLlxuICAgKi9cbiAgb3V0Z29pbmdQYXRocyhjd2Q6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nW10+O1xuICAvKipcbiAgICogUGF0aHMgdW5kZXIgdGhlIGdpdmVuIGV4cGxpY2l0IHBhdGhzcGVjcyB3aG9zZSB3b3JraW5nLXRyZWUgY29udGVudCBkaWZmZXJzXG4gICAqIGZyb20gYEhFQURgIFx1MjAxNCBgZ2l0IGRpZmYgSEVBRCAtLW5hbWUtb25seSAtLSA8cGF0aHNwZWNzPmAuIFRoaXMgaXMgd2hhdCBhXG4gICAqIHBhdGhzcGVjLXNjb3BlZCBjb21taXQgKGBnaXQgY29tbWl0IC0tIDxwYXRoc3BlYz5cdTIwMjZgKSBhY3R1YWxseSBsYW5kczogdGhlXG4gICAqIGN1cnJlbnQgd29ya2luZy10cmVlIGNvbnRlbnQgYXQgdGhvc2UgcGF0aHNwZWNzLCByZWdhcmRsZXNzIG9mIHdoYXQgZWxzZSBpc1xuICAgKiBzdGFnZWQuIFVzZWQgdG8gc2NvcGUgdGhlIGNoYW5nZXNldCB3aGVuIHtAbGluayBQYXJzZWRHaXRDb21tYW5kLnBhdGhzfSBpc1xuICAgKiBwcmVzZW50LCBzbyB0aGUgZ2F0ZSBldmFsdWF0ZXMgZXhhY3RseSB0aGUgZmlsZXMgdGhpcyBjb21taXQgdGFrZXMgXHUyMDE0IG5ldmVyXG4gICAqIGFuIHVucmVsYXRlZCBzdGFnZWQgZmlsZSwgYW5kIG5ldmVyIG1pc3NpbmcgYSBtb2RpZmllZC1idXQtdW5zdGFnZWQgZmlsZVxuICAgKiBuYW1lZCBpbiB0aGUgcGF0aHNwZWMgKHdoaWNoIGBnaXQgZGlmZiAtLWNhY2hlZGAgd291bGQgbmV2ZXIgc3VyZmFjZSkuXG4gICAqL1xuICBwYXRoc3BlY1BhdGhzKHBhdGhzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZ1tdPjtcbn1cblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBjb25jcmV0ZSBsaXN0IG9mIHJlcG8tcmVsYXRpdmUgcGF0aHMgYSBnYXRlZCBjb21tYW5kIHdvdWxkIGxhbmQsXG4gKiBzbyB0aGUgZ2F0ZSBjYW4gc2NvcGUgaXRzIHN0YWxlbmVzcy9jb3ZlcmFnZSBjaGVjayB0byBleGFjdGx5IHRoYXQgY2hhbmdlc2V0LlxuICpcbiAqIC0gYGNvbW1pdGAgd2l0aCBleHBsaWNpdCBgcGF0aHNgIChhIGBnaXQgY29tbWl0IC0tIDxwYXRoc3BlYz5cdTIwMjZgIGZvcm0pOiBvbmx5XG4gKiAgIHRoZSB3b3JraW5nLXRyZWUgY29udGVudCB1bmRlciB0aG9zZSBwYXRoc3BlY3MgKGBwYXRoc3BlY1BhdGhzYCksIHNpbmNlIGFcbiAqICAgcGF0aHNwZWMtc2NvcGVkIGNvbW1pdCBsYW5kcyBleGFjdGx5IHRoYXQsIHJlZ2FyZGxlc3Mgb2YgdGhlIHJlc3Qgb2YgdGhlXG4gKiAgIHN0YWdlZCBzZXQuIGBhbGxgIGlzIGlnbm9yZWQgXHUyMDE0IGAtYWAgYW5kIGFuIGV4cGxpY2l0IHBhdGhzcGVjIGRvIG5vdCBjb21iaW5lLlxuICogLSBgY29tbWl0YCwgbm8gYHBhdGhzYDogdGhlIHN0YWdlZCBwYXRocywgcGx1cyBcdTIwMTQgd2hlbiBgYWxsYCBpcyB0cnVlICh0aGVcbiAqICAgY29tbWFuZCB3YXMgYW4gYC1hYC9gLWFtYCBmb3JtKSBcdTIwMTQgdGhlIHRyYWNrZWQtbW9kaWZpZWQgcGF0aHMgdGhvc2UgZm9ybXNcbiAqICAgc3RhZ2UgaW1wbGljaXRseS5cbiAqIC0gYHB1c2hgOiB0aGUgb3V0Z29pbmcgcmFuZ2UgYEB7dX0uLkhFQURgLCB3aXRoIGEgbWVyZ2UtYmFzZSBmYWxsYmFjayB3aGVuIG5vXG4gKiAgIHVwc3RyZWFtIGlzIGNvbmZpZ3VyZWQuIGBhbGxgL2BwYXRoc2AgYXJlIG5vdCBtZWFuaW5nZnVsIGZvciBhIHB1c2ggYW5kIGFyZVxuICogICBpZ25vcmVkLlxuICogLSBgc3RhdHVzYDogdGhlIHN0YWdlZCBwYXRocyBwbHVzIHRoZSB0cmFja2VkLW1vZGlmaWVkIHBhdGhzLCBkZWR1cGxpY2F0ZWQgXHUyMDE0XG4gKiAgIHRoZSBzYW1lIHdvcmtpbmctdHJlZSBwaWN0dXJlIGBnaXQgc3RhdHVzYCBpdHNlbGYgcHJpbnRzLCBwcmV2aWV3ZWQgZm9yXG4gKiAgIHNwYW4gZGVidC4gYGFsbGAvYHBhdGhzYCBhcmUgbm90IG1lYW5pbmdmdWwgZm9yIGEgc3RhdHVzIGNoZWNrIGFuZCBhcmVcbiAqICAgaWdub3JlZC5cbiAqXG4gKiBUaGUgYGFsbGAgZmxhZyBhbmQgYHBhdGhzYCBhcmUgdGhyZWFkZWQgaW4gZXhwbGljaXRseSAocmF0aGVyIHRoYW4gcmVhZCBiYWNrXG4gKiBvdXQgb2YgdGhlIGNvbW1hbmQpIGJlY2F1c2UgdGhlIGNhbGxlci9hZGFwdGVyIGRlcml2ZXMgdGhlbSBmcm9tIHRoZSBwYXJzZTpcbiAqIGBwYXRoc2AgaXMge0BsaW5rIFBhcnNlZEdpdENvbW1hbmQucGF0aHN9LCBhbmQgYGFsbGAgKHdoaWNoIHtAbGluayBQYXJzZWRHaXRDb21tYW5kfVxuICogaW50ZW50aW9uYWxseSBkb2VzIG5vdCBjYXJyeSkgY29tZXMgZnJvbSB7QGxpbmsgY29tbWl0U3RhZ2VzQWxsfS5cbiAqXG4gKiBAcGFyYW0ga2luZCBXaGV0aGVyIHRoZSBjaGFuZ2VzZXQgaXMgYSBjb21taXQncyBzdGFnZWQgc2V0LCBhIHB1c2gncyByYW5nZSwgb3IgYSBzdGF0dXMgcHJldmlldy5cbiAqIEBwYXJhbSBhbGwgV2hldGhlciB0aGUgY29tbWl0IHdhcyBhbiBgLWFgL2AtYW1gIGZvcm0gKGlnbm9yZWQgZm9yIGBwdXNoYC9gc3RhdHVzYCkuXG4gKiBAcGFyYW0gY3dkIFRoZSB3b3JraW5nIGRpcmVjdG9yeSB0aGUgZ2l0IGNvbW1hbmQgcmFuIGluLlxuICogQHBhcmFtIGdpdCBUaGUgaW5qZWN0ZWQgZ2l0IHN1cmZhY2UgYmFja2luZyB0aGUgcmVzb2x1dGlvbi5cbiAqIEBwYXJhbSBwYXRocyBFeHBsaWNpdCBwYXRoc3BlY3MgZnJvbSBgZ2l0IGNvbW1pdCAtLSA8cGF0aHNwZWM+XHUyMDI2YCwgaWYgYW55LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUNoYW5nZXNldChcbiAga2luZDogJ2NvbW1pdCcgfCAncHVzaCcgfCAnc3RhdHVzJyxcbiAgYWxsOiBib29sZWFuLFxuICBjd2Q6IHN0cmluZyxcbiAgZ2l0OiBHaXRFeGVjdXRvcixcbiAgcGF0aHM/OiBzdHJpbmdbXVxuKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICBpZiAoa2luZCA9PT0gJ3B1c2gnKSB7XG4gICAgcmV0dXJuIGdpdC5vdXRnb2luZ1BhdGhzKGN3ZCk7XG4gIH1cbiAgaWYgKGtpbmQgPT09ICdzdGF0dXMnKSB7XG4gICAgY29uc3QgW3N0YWdlZCwgdHJhY2tlZF0gPSBhd2FpdCBQcm9taXNlLmFsbChbZ2l0LnN0YWdlZFBhdGhzKGN3ZCksIGdpdC50cmFja2VkTW9kaWZpZWRQYXRocyhjd2QpXSk7XG4gICAgcmV0dXJuIG1lcmdlVW5pcXVlUGF0aHMoc3RhZ2VkLCB0cmFja2VkKTtcbiAgfVxuICAvLyBBIHBhdGhzcGVjLXNjb3BlZCBjb21taXQgbGFuZHMgb25seSB0aGUgd29ya2luZy10cmVlIGNvbnRlbnQgYXQgdGhvc2VcbiAgLy8gcGF0aHNwZWNzIFx1MjAxNCBzY29wZSB0aGUgY2hhbmdlc2V0IHRvIGV4YWN0bHkgdGhhdCwgbmV2ZXIgdGhlIGZ1bGwgc3RhZ2VkIHNldC5cbiAgaWYgKHBhdGhzICYmIHBhdGhzLmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4gZ2l0LnBhdGhzcGVjUGF0aHMocGF0aHMsIGN3ZCk7XG4gIH1cbiAgY29uc3Qgc3RhZ2VkID0gYXdhaXQgZ2l0LnN0YWdlZFBhdGhzKGN3ZCk7XG4gIGlmICghYWxsKSByZXR1cm4gc3RhZ2VkO1xuICBjb25zdCB0cmFja2VkID0gYXdhaXQgZ2l0LnRyYWNrZWRNb2RpZmllZFBhdGhzKGN3ZCk7XG4gIHJldHVybiBtZXJnZVVuaXF1ZVBhdGhzKHN0YWdlZCwgdHJhY2tlZCk7XG59XG5cbi8qKiBDb25jYXRlbmF0ZSBwYXRoIGxpc3RzIGluIG9yZGVyLCBkcm9wcGluZyBsYXRlciBkdXBsaWNhdGVzIG9mIGFuIGVhcmxpZXIgcGF0aC4gKi9cbmZ1bmN0aW9uIG1lcmdlVW5pcXVlUGF0aHMoLi4uZ3JvdXBzOiBzdHJpbmdbXVtdKTogc3RyaW5nW10ge1xuICBjb25zdCBzZWVuID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGNvbnN0IG1lcmdlZDogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBncm91cCBvZiBncm91cHMpIHtcbiAgICBmb3IgKGNvbnN0IHBhdGggb2YgZ3JvdXApIHtcbiAgICAgIGlmIChzZWVuLmhhcyhwYXRoKSkgY29udGludWU7XG4gICAgICBzZWVuLmFkZChwYXRoKTtcbiAgICAgIG1lcmdlZC5wdXNoKHBhdGgpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbWVyZ2VkO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEdhdGUgZXZhbHVhdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogVGhlIGluamVjdGVkIGV4ZWN1dGlvbiBzdXJmYWNlIGdhdGUgZXZhbHVhdGlvbiBuZWVkcyBcdTIwMTQgdGhlIGBmaXhgL2BzdGFsZWAvXG4gKiBgbGlzdGAgYXN5bmMgZnVuY3Rpb25zLCBtaXJyb3JpbmcgYHRvdWNoLWNvcmUudHNgJ3MgYFRvdWNoRXhlY3V0b3JzYC4gVGVzdHNcbiAqIGluamVjdCBmYWtlcyByZXR1cm5pbmcgc3RydWN0dXJlZCBkYXRhOyB0aGUgY29yZSBuZXZlciBzcGF3bnMgYSBzdWJwcm9jZXNzXG4gKiBpdHNlbGYuIEFsbCBwYXRocyBhcmUgcmVwby1yZWxhdGl2ZSBQT1NJWCBwYXRocy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBHYXRlRXhlY3V0b3JzIHtcbiAgLyoqXG4gICAqIFJ1biBhIHNjb3BlZCBgZ2l0IHNwYW4gc3RhbGUgPHBhdGhzPiAtLWZpeGAgXHUyMDE0IHRoZSBiZWx0LWFuZC1icmFjZXMgaGVhbCB0aGF0XG4gICAqIHJ1bnMgYmVmb3JlIGNsYXNzaWZpY2F0aW9uIChwZXIgQ0FSRC5tZCksIHJlLWFuY2hvcmluZyBhbnkgcG9zaXRpb25hbCBkcmlmdFxuICAgKiBpbiB0aGUgY2hhbmdlc2V0IHRoYXQgdGhlIHRvdWNoIGhvb2sgaGFzIG5vdCBhbHJlYWR5IGhlYWxlZC4gUmVwb3J0cyBub3RoaW5nO1xuICAgKiBpdHMgZWZmZWN0IGlzIG9uIHRoZSB3b3JraW5nIHRyZWUsIGFuZCB0aGUgc3Vic2VxdWVudCB7QGxpbmsgR2F0ZUV4ZWN1dG9ycy5zdGFsZX1cbiAgICogcmVhZCBvYnNlcnZlcyB0aGUgaGVhbGVkIHN0YXRlLlxuICAgKi9cbiAgZml4KHBhdGhzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+O1xuICAvKipcbiAgICogUnVuIGEgc2NvcGVkIGBnaXQgc3BhbiBzdGFsZSAtLWZvcm1hdCBwb3JjZWxhaW4gPHBhdGhzPmAgYW5kIHJldHVybiBpdHNcbiAgICogcGFyc2VkIHJvd3MgXHUyMDE0IG9uZSBwZXIgZHJpZnRlZCBhbmNob3IgYW1vbmcgdGhlIGNoYW5nZXNldCdzIHNwYW5zLCBlbXB0eSB3aGVuXG4gICAqIGNsZWFuLiBEZWJ0IGlzIGNsYXNzaWZpZWQgZnJvbSB0aGVzZSByb3dzIHZpYSBgaXNEZWJ0KClgOyBwb3NpdGlvbmFsXG4gICAqIChgTU9WRURgL2BSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGApIHJvd3MgYXJlIG5ldmVyIGRlYnQgYW5kIG5ldmVyIGRlbnkuXG4gICAqXG4gICAqIEFuIGVtcHR5IHJlc3VsdCBtdXN0IG1lYW4gdGhlIHNjYW4gKnJhbiBhbmQgZm91bmQgbm90aGluZyosIG5ldmVyIHRoYXQgdGhlXG4gICAqIHNjYW4gKmNvdWxkIG5vdCBydW4qLiBXaGVuIHRoZSBzY29wZWQgcXVlcnkgYWJvcnRzIGJlZm9yZSBjb21wbGV0aW5nIChlLmcuXG4gICAqIGFuIHVucmVhZGFibGUgYW5jaG9yIGZpbGUpLCB0aGUgaW1wbGVtZW50YXRpb24gdGhyb3dzIHtAbGluayBHYXRlU2NhbkVycm9yfVxuICAgKiByYXRoZXIgdGhhbiByZXR1cm5pbmcgYFtdYCwgc28ge0BsaW5rIGV2YWx1YXRlR2F0ZX0gZG9lcyBub3QgbWlzdGFrZSBhblxuICAgKiBhYm9ydGVkIHNjYW4gZm9yIGEgY2xlYW4gb25lIGFuZCBzaWxlbnRseSBhbGxvdyB1bnZlcmlmaWVkIGRlYnQgdGhyb3VnaC5cbiAgICovXG4gIHN0YWxlKHBhdGhzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpOiBQcm9taXNlPFN0YWxlUG9yY2VsYWluUm93W10+O1xuICAvKipcbiAgICogUnVuIGEgc2NvcGVkIGBnaXQgc3BhbiBsaXN0IC0tcG9yY2VsYWluIDxwYXRocz5gIGFuZCByZXR1cm4gdGhlIGNvdmVyaW5nXG4gICAqIGFuY2hvcnMuIFVzZWQgdG8gY29tcHV0ZSAqdW5jb3ZlcmVkIHdyaXRlcyo6IGEgY2hhbmdlZCBwYXRoIHdpdGggemVyb1xuICAgKiBjb3ZlcmluZyByb3dzIGhlcmUgKG1pbnVzIGAuc3Bhbi8qKmAsIGdpdGlnbm9yZWQgcGF0aHMsIGFuZFxuICAgKiBgLnNwYW4vLmdhdGVpZ25vcmVgLWV4Y2x1ZGVkIHBhdGhzIFx1MjAxNCBzZWUge0BsaW5rIGZpbGU6Ly8uL2dhdGUtaWdub3JlLnRzfSlcbiAgICogaXMgYW4gdW5jb3ZlcmVkIHdyaXRlLlxuICAgKi9cbiAgbGlzdChwYXRoczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKTogUHJvbWlzZTxQb3JjZWxhaW5Sb3dbXT47XG4gIC8qKlxuICAgKiBSdW4gYGdpdCBzcGFuIGxpc3QgPG5hbWVzLi4uPmAgKGh1bWFuIGZvcm1hdCkgYW5kIHJldHVybiBpdHMgcmF3IHN0ZG91dCBcdTIwMTRcbiAgICogb25lIGAjIyA8bmFtZT5gIGJsb2NrIHBlciBzcGFuIChhbmNob3IgYnVsbGV0cyArIGRlc2NyaXB0aW9uKSwgYmxvY2tzXG4gICAqIHNlcGFyYXRlZCBieSBgLS0tYC4gVGhlIGRlbnkvYWR2aXNvcnkgcmVuZGVyZXJzIGFubm90YXRlIHRoZXNlIGJsb2NrcyB3aXRoXG4gICAqIHBlci1hbmNob3IgZHJpZnQgbGFiZWxzIHNvIHRoZSBzdXJmYWNlZCBtZXNzYWdlIGNhcnJpZXMgdGhlIGZ1bGwgc3BhblxuICAgKiAoYWxsIGxvY2F0aW9ucyArIGRlc2NyaXB0aW9uKSwgbm90IGp1c3QgdGhlIGRyaWZ0ZWQgcm93cy4gUmV0dXJucyBgJydgIG9uXG4gICAqIGFueSBmYWlsdXJlOyB7QGxpbmsgYW5ub3RhdGVCbG9ja3N9IHRoZW4gc3ludGhlc2l6ZXMgbWluaW1hbCBibG9ja3MgZnJvbVxuICAgKiB0aGUgZmluZGluZ3MgdGhlbXNlbHZlcyBzbyBubyBmaW5kaW5nIGlzIGRyb3BwZWQuXG4gICAqL1xuICBsaXN0QmxvY2tzKG5hbWVzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz47XG59XG5cbi8qKlxuICogVGhlIGdhdGUncyBwZXItY2hhbmdlc2V0IG1lbW8gXHUyMDE0IFwiaGF2ZSBJIGFscmVhZHkgcHJlc2VudGVkIHRoaXMgZXhhY3QgZGVidFxuICogc3RhdGUgb25jZT9cIiBUaGUgcGVyc2lzdGVkIHVuaXQgaXMgYSBkaWdlc3Qgb2YgdGhlIHNvcnRlZCBzdGFsZW5lc3MgZmluZGluZ3NcbiAqIHBsdXMgdGhlIHNvcnRlZCB1bmNvdmVyZWQgcGF0aHMgKGRlc2lnbi1kZWNpc2lvbnMubWQgIzkncyBcImdhdGUgb25jZSBwZXJcbiAqIGRpc3RpbmN0IGRlYnQtc3RhdGVcIik7IHRoZSBkaXNrLWJhY2tlZCBpbXBsZW1lbnRhdGlvbiBzdG9yZXMgb25lIG1hcmtlciBwZXJcbiAqIGRpZ2VzdCB1bmRlciB7QGxpbmsgZ2F0ZU1lbW9EaXJ9IChgPGdpdC1jb21tb24tZGlyPi9naXQtc3Bhbi9nYXRlL2ApLCB3aGVyZVxuICogcHJlc2VuY2UgbWVhbnMgXCJhbHJlYWR5IHByZXNlbnRlZCBvbmNlLlwiIEluamVjdGVkIGFzIGEgc3RvcmUgYWJzdHJhY3Rpb25cbiAqIChsaWtlIHNwYW4tc3VyZmFjZS50cydzIGBNZW1vU3RvcmVgKSBzbyBQaGFzZSAzLjIgZmFrZXMgaXQgaW4gbWVtb3J5LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEdhdGVNZW1vU3RhdGUge1xuICAvKiogV2hldGhlciB0aGlzIGV4YWN0IGRlYnQtc3RhdGUgZGlnZXN0IGhhcyBhbHJlYWR5IGJlZW4gcHJlc2VudGVkIG9uY2UuICovXG4gIGhhcyhkaWdlc3Q6IHN0cmluZyk6IGJvb2xlYW47XG4gIC8qKlxuICAgKiBSZWNvcmQgdGhhdCB0aGlzIGRlYnQtc3RhdGUgZGlnZXN0IGhhcyBub3cgYmVlbiBwcmVzZW50ZWQsIHJldHVybmluZ1xuICAgKiB3aGV0aGVyIHRoZSByZWNvcmQgYWN0dWFsbHkgcGVyc2lzdGVkLiBgZmFsc2VgIG1lYW5zIHRoZSBtZW1vIGNvdWxkIG5vdCBiZVxuICAgKiB3cml0dGVuIChlLmcuIGFuIHVud3JpdGFibGUgbWVtbyBkaXJlY3RvcnkpIFx1MjAxNCB0aGUgZ2F0ZSB0cmVhdHMgdGhhdCBhcyBhXG4gICAqIGZhaWwtb3BlbiBzaWduYWwgcmF0aGVyIHRoYW4gZGVueWluZywgYmVjYXVzZSBhIG5vbi1wZXJzaXN0aW5nIG1lbW8gd291bGRcbiAgICogc2lsZW50bHkgdHVybiBcImRlbnkgb25jZSwgdGhlbiBhbGxvdyB0aGUgaWRlbnRpY2FsIHJldHJ5XCIgaW50byBcImRlbnkgZXZlcnlcbiAgICogdGltZVwiIHdpdGggbm8gZXNjYXBlLlxuICAgKi9cbiAgcmVjb3JkKGRpZ2VzdDogc3RyaW5nKTogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBUaGUgZ2F0ZSdzIGRlY2lzaW9uIGZvciBvbmUgY29tbWFuZCwgYXMgYSBkaXNjcmltaW5hdGVkIHVuaW9uIHRoZSBhZGFwdGVyXG4gKiB0cmFuc2xhdGVzIGludG8gYHBlcm1pc3Npb25EZWNpc2lvbjogJ2RlbnknYC9hbGxvdyAoQ2xhdWRlKSBvciBhIGJsb2NrL2FsbG93XG4gKiAoQ29kZXgpLiBgZGVjaXNpb25gIGlzIHRoZSBjb2Fyc2UgYWxsb3cvZGVueSB0aGUgaGFybmVzcyBhY3RzIG9uOyBga2luZGBcbiAqIHJlY29yZHMgKndoeSosIHNvIHRoZSBhZGFwdGVyIHJlbmRlcnMgdGhlIHJpZ2h0IG1lc3NhZ2UgYW5kIHNvIHRlc3RzIGFzc2VydFxuICogdGhlIGV4YWN0IGJyYW5jaC5cbiAqXG4gKiAtIGBhbGxvd2AgLyBgc2lsZW50YCBcdTIwMTQgbm90aGluZyB0byBjaGVjayAobm8gcGF0aHMpIG9yIHRoZSBjaGFuZ2VzZXQgaXMgY2xlYW47XG4gKiAgIGFsbG93IHdpdGggbm8gb3V0cHV0LiBJbnRlcm5hbCBlcnJvcnMgYW5kIHBhcnNlIGZhaWx1cmVzIGFsc28gcmVzb2x2ZSBoZXJlOlxuICogICB0aGUgZ2F0ZSBmYWlscyBvcGVuIGFuZCBtdXN0IG5ldmVyIGJyaWNrIGEgY29tbWl0LlxuICogLSBgYWxsb3dgIC8gYGFscmVhZHktcHJlc2VudGVkYCBcdTIwMTQgZGVidCBpcyBwcmVzZW50LCBidXQgdGhpcyBleGFjdCBkZWJ0IHN0YXRlXG4gKiAgIHdhcyBhbHJlYWR5IHByZXNlbnRlZCBvbmNlIChzZW1hbnRpYy1zdGFsZW5lc3Mgb3IgdW5jb3ZlcmVkLXdyaXRlc1xuICogICBjb25zaWRlci1vbmNlLCBhbiB1bmNoYW5nZWQgcmV0cnksIG9yIGEgc3RhdGUgYWxyZWFkeSBzaG93biBpbiBmdWxsIGJ5IGFcbiAqICAgcHJpb3IgYCdpbmZvcm0nYCBwcmV2aWV3KS4gVGhlIGNvbW1hbmQgcGFzc2VzLlxuICogLSBgYWxsb3dgIC8gYGVudmlyb25tZW50YWxgIFx1MjAxNCB0aGUgY2hhbmdlc2V0J3Mgb25seSBzdGFsZW5lc3Mgcm93cyBhcmVcbiAqICAgdGVybWluYWwvZW52aXJvbm1lbnRhbCBjb25kaXRpb25zIChgQ09ORkxJQ1RgLCBgU1VCTU9EVUxFYCwgYExGU18qYCxcbiAqICAgYFBST01JU09SX01JU1NJTkdgLCBgU1BBUlNFX0VYQ0xVREVEYCwgYEZJTFRFUl9GQUlMRURgLCBgSU9fRVJST1JgKSB0aGUgQ0xJXG4gKiAgIGNvdWxkIG5vdCByZXNvbHZlIGF0IGFsbCBcdTIwMTQgbm90IHNwYW4gZHJpZnQgYSB1c2VyIGNhbiBmaXggYnkgZWRpdGluZyBhIHNwYW4uXG4gKiAgIFRoZSBnYXRlIGZhaWxzIE9QRU4gKGFsbG93KSBidXQgY2FycmllcyBgY29uZGl0aW9uc2AvYHJlYXNvbmAgc28gdGhlIGFkYXB0ZXJcbiAqICAgc3VyZmFjZXMgdGhlIGNvbmRpdGlvbiBpbnN0ZWFkIG9mIHN3YWxsb3dpbmcgaXQuIERlbnlpbmcgaGVyZSB3b3VsZCByZS1kZW55XG4gKiAgIGZvcmV2ZXIgb24gYW4gaW5mcmEgZmFpbHVyZSB0aGUgdXNlciBjYW5ub3QgY2xlYXIgZnJvbSB0aGUgZ2F0ZS5cbiAqIC0gYGFsbG93YCAvIGBzY2FuLWZhaWxlZGAgXHUyMDE0IGBnaXQgc3BhbiBzdGFsZWAgY291bGQgbm90ICpjb21wbGV0ZSogaXRzIHNjb3BlZFxuICogICBzY2FuIChhIHtAbGluayBHYXRlU2NhbkVycm9yfSwgZS5nLiBhbiB1bnJlYWRhYmxlIGFuY2hvciBmaWxlIGFib3J0aW5nIHRoZVxuICogICB3aG9sZSBxdWVyeSkuIFRoaXMgaXMgZGlzdGluY3QgZnJvbSBib3RoIGBlbnZpcm9ubWVudGFsYCAodGhlIHNjYW4gY29tcGxldGVkXG4gKiAgIGFuZCBjYXJyaWVkIHRlcm1pbmFsIHJvd3MpIGFuZCBhIGNsZWFuIHBhc3MgKHRoZSBzY2FuIGNvbXBsZXRlZCB3aXRoIHplcm9cbiAqICAgcm93cyk6IHRoZSBzY2FuIG5ldmVyIHJhbiB0byBjb21wbGV0aW9uLCBzbyBpdHMgZW1wdHkgcmVzdWx0IGlzIG5vdCBldmlkZW5jZVxuICogICBvZiBcIm5vIGRlYnQuXCIgVGhlIGdhdGUgZmFpbHMgT1BFTiBoZXJlIHRvbyBcdTIwMTQgbWF0Y2hpbmcgYGVudmlyb25tZW50YWxgIFx1MjAxNFxuICogICBidXQga2VlcHMgaXRzIG93biBga2luZGAgYW5kIGEgYHJlYXNvbmAgbmFtaW5nIHRoZSBmYWlsdXJlLCBzbyB0aGUgYWRhcHRlclxuICogICBzdXJmYWNlcyBhIHdhcm5pbmcgdGhhdCBzcGFuIGRlYnQgd2FzIE5PVCB2ZXJpZmllZCBmb3IgdGhpcyBjaGFuZ2VzZXRcbiAqICAgaW5zdGVhZCBvZiBzdGF5aW5nIHNpbGVudC4gVGhlcmUgaXMgbm8gZGVidC1zdGF0ZSB0byBtZW1vaXplOiBldmVyeVxuICogICBldmFsdWF0aW9uIG9mIGEgc3RpbGwtZmFpbGluZyBzY2FuIHdhcm5zIGFnYWluLlxuICogLSBgZGVueWAgLyBgc2VtYW50aWMtc3RhbGVuZXNzYCBcdTIwMTQgdGhlIGNoYW5nZXNldCBjYXJyaWVzIHNlbWFudGljIHN0YWxlbmVzcyxcbiAqICAgYW5kIHRoaXMgZXhhY3QgZmluZGluZ3MgZGlnZXN0IGhhcyBub3QgYmVlbiBwcmVzZW50ZWQgYmVmb3JlICphbmQqIHdhc1xuICogICBub3QgYWxyZWFkeSBzaG93biBpbiBmdWxsIGJ5IGEgcHJpb3IgYCdpbmZvcm0nYCBwcmV2aWV3LiBEZW55ICoqb25jZSoqLFxuICogICBsaXN0aW5nIGBmaW5kaW5nc2AgYXMgYSBjaGVja2xpc3QgaW4gYHJlYXNvbmA7IGFuIGlkZW50aWNhbCByZXRyeVxuICogICAodW5jaGFuZ2VkIGZpbmRpbmdzKSBmYWxscyB0aHJvdWdoIHRvIHRoZSBlbnZpcm9ubWVudGFsIGFuZCB1bmNvdmVyZWRcbiAqICAgY2hlY2tzIGFuZCByZXNvbHZlcyB0byBgYWxyZWFkeS1wcmVzZW50ZWRgIHdoZW4gb3RoZXJ3aXNlIGNsZWFuLiBDaGFuZ2VkXG4gKiAgIGZpbmRpbmdzIChhIG5ldyBkaWdlc3QpIGRlbnkgZnJlc2ggKGNvbnNpZGVyLW9uY2UgcGVyIGRpc3RpbmN0IGRlYnRcbiAqICAgc3RhdGUsIHBlciBkZXNpZ24tZGVjaXNpb25zLm1kICMxKS4gVGhlIGdhdGUgaXMgaW5mb3JtYXRpb25hbCwgbm90IGEgaGFyZFxuICogICBibG9jayBcdTIwMTQgYSBiYXJlIHJldHJ5IGFscmVhZHkgZ2V0cyBwYXN0IGEgZGVueSBcdTIwMTQgc28gYSBzdGF0ZSB0aGUgYWdlbnQgaGFzXG4gKiAgIGFscmVhZHkgc2VlbiB2aWEgYCdpbmZvcm0nYCByZXNvbHZlcyBzdHJhaWdodCB0byBgYWxyZWFkeS1wcmVzZW50ZWRgXG4gKiAgIGluc3RlYWQgb2YgZGVueWluZyBhIHNlY29uZCB0aW1lIGZvciBubyBnYWluLlxuICogLSBgZGVueWAgLyBgdW5jb3ZlcmVkLXdyaXRlc2AgXHUyMDE0IHRoZSBjaGFuZ2VzZXQgaGFzIGNoYW5nZWQgZmlsZXMgbm8gc3BhblxuICogICBjb3ZlcnMsIGFuZCB0aGlzIHN0YXRlIGhhcyBub3QgYmVlbiBwcmVzZW50ZWQgYmVmb3JlICphbmQqIHdhcyBub3RcbiAqICAgYWxyZWFkeSBzaG93biBpbiBmdWxsIGJ5IGEgcHJpb3IgYCdpbmZvcm0nYCBwcmV2aWV3LiBEZW55ICoqb25jZSoqLFxuICogICBsaXN0aW5nIGB1bmNvdmVyZWRgOyB0aGUgcmV0cnkgd2l0aCBhbiB1bmNoYW5nZWQgc3RhdGUgXHUyMDE0IG9yIGEgc3RhdGVcbiAqICAgYWxyZWFkeSBzaG93biB2aWEgYCdpbmZvcm0nYCBcdTIwMTQgcmVzb2x2ZXMgdG8gYGFscmVhZHktcHJlc2VudGVkYCBhbmRcbiAqICAgcGFzc2VzIChjb25zaWRlci1vbmNlLCBwZXIgZGVzaWduLWRlY2lzaW9ucy5tZCAjMykuXG4gKiAtIGBhbGxvd2AgLyBgc2VtYW50aWMtc3RhbGVuZXNzLWluZm9gLCBgYWxsb3dgIC8gYHVuY292ZXJlZC13cml0ZXMtaW5mb2AgXHUyMDE0XG4gKiAgIGAnaW5mb3JtJ2AtbW9kZS1vbmx5IGNvdW50ZXJwYXJ0cyBvZiB0aGUgdHdvIGBkZW55YCBraW5kcyBhYm92ZTogc2FtZVxuICogICBgZmluZGluZ3NgL2B1bmNvdmVyZWRgL2ByZWFzb25gIHBheWxvYWQsIGJ1dCBuZXZlciBkZW5pZXMgYW5kIG5ldmVyXG4gKiAgIGNvbnN1bHRzIG9yIHdyaXRlcyBgbWVtb1N0YXRlYCAoYSBgZ2l0IHN0YXR1c2AgcHJldmlldyBpcyBub3QgYSBkZWJ0IHN0YXRlXG4gKiAgIHRvIGhvbGQgb3IgY29uc2lkZXItb25jZSBcdTIwMTQgaXQgcmUtcmVwb3J0cyB0aGUgc2FtZSBsaXZlIGRlYnQgb24gZXZlcnkgY2FsbCxcbiAqICAgZXhhY3RseSBsaWtlIGBnaXQgc3RhdHVzYCBpdHNlbGYgZG9lcyBmb3IgdGhlIHdvcmtpbmcgdHJlZSkuXG4gKi9cbmV4cG9ydCB0eXBlIEdhdGVSZXN1bHQgPVxuICB8IHsgZGVjaXNpb246ICdhbGxvdyc7IGtpbmQ6ICdzaWxlbnQnIH1cbiAgfCB7IGRlY2lzaW9uOiAnYWxsb3cnOyBraW5kOiAnYWxyZWFkeS1wcmVzZW50ZWQnIH1cbiAgfCB7IGRlY2lzaW9uOiAnYWxsb3cnOyBraW5kOiAnZW52aXJvbm1lbnRhbCc7IGNvbmRpdGlvbnM6IFN0YWxlUG9yY2VsYWluUm93W107IHJlYXNvbjogc3RyaW5nIH1cbiAgfCB7IGRlY2lzaW9uOiAnYWxsb3cnOyBraW5kOiAnc2Nhbi1mYWlsZWQnOyByZWFzb246IHN0cmluZyB9XG4gIHwgeyBkZWNpc2lvbjogJ2FsbG93Jzsga2luZDogJ3NlbWFudGljLXN0YWxlbmVzcy1pbmZvJzsgZmluZGluZ3M6IFN0YWxlUG9yY2VsYWluUm93W107IHJlYXNvbjogc3RyaW5nIH1cbiAgfCB7IGRlY2lzaW9uOiAnYWxsb3cnOyBraW5kOiAndW5jb3ZlcmVkLXdyaXRlcy1pbmZvJzsgdW5jb3ZlcmVkOiBzdHJpbmdbXTsgcmVhc29uOiBzdHJpbmcgfVxuICB8IHsgZGVjaXNpb246ICdkZW55Jzsga2luZDogJ3NlbWFudGljLXN0YWxlbmVzcyc7IGZpbmRpbmdzOiBTdGFsZVBvcmNlbGFpblJvd1tdOyByZWFzb246IHN0cmluZyB9XG4gIHwgeyBkZWNpc2lvbjogJ2RlbnknOyBraW5kOiAndW5jb3ZlcmVkLXdyaXRlcyc7IHVuY292ZXJlZDogc3RyaW5nW107IHJlYXNvbjogc3RyaW5nIH07XG5cbi8qKlxuICogV2hldGhlciB7QGxpbmsgZXZhbHVhdGVHYXRlfSBtYXkgaG9sZCB0aGUgY29tbWFuZCAoYCdlbmZvcmNlJ2AsIHRoZSBkZWZhdWx0IFx1MjAxNFxuICogdXNlZCBmb3IgYGNvbW1pdGAvYHB1c2hgKSBvciBtdXN0IG9ubHkgZXZlciBhZHZpc2UgKGAnaW5mb3JtJ2AgXHUyMDE0IHVzZWQgZm9yXG4gKiBgc3RhdHVzYCk6IGV2ZXJ5IGJyYW5jaCB0aGF0IHdvdWxkIG90aGVyd2lzZSBgZGVueWAgcmV0dXJucyBpdHMgYC1pbmZvYFxuICogYGFsbG93YCBjb3VudGVycGFydCBpbnN0ZWFkLCBhbmQgYG1lbW9TdGF0ZWAgaXMgbmV2ZXIgcmVhZCBvciB3cml0dGVuLCBzaW5jZVxuICogYW4gaW5mb3JtYXRpb25hbCBwcmV2aWV3IG11c3Qgbm90IHNwZW5kIChvciBiZSBibG9ja2VkIGJ5KSB0aGUgY29uc2lkZXItb25jZVxuICogY3JlZGl0IGEgcmVhbCBgY29tbWl0YC9gcHVzaGAgcmVsaWVzIG9uLlxuICovXG5leHBvcnQgdHlwZSBHYXRlTW9kZSA9ICdlbmZvcmNlJyB8ICdpbmZvcm0nO1xuXG4vKipcbiAqIEV2YWx1YXRlIHRoZSBnYXRlIGZvciBhIHJlc29sdmVkIGNoYW5nZXNldCBhbmQgZGVjaWRlIHdoZXRoZXIgdG8gaG9sZCB0aGVcbiAqIGNvbW1hbmQuXG4gKlxuICogUnVucyBgZXhlY3V0b3JzLmZpeGAgKHNjb3BlZCBiZWx0LWFuZC1icmFjZXMgYHN0YWxlIC0tZml4YCksIHRoZW4gcmVhZHNcbiAqIGBleGVjdXRvcnMuc3RhbGVgIGFuZCBjbGFzc2lmaWVzIGVhY2ggZGVidCByb3cgKGBpc0RlYnQoKWApIGludG8gKnNlbWFudGljKlxuICogZHJpZnQgYW5kICplbnZpcm9ubWVudGFsKiBjb25kaXRpb25zIChgaXNFbnZpcm9ubWVudGFsU3RhdHVzKClgKS5cbiAqXG4gKiBTZW1hbnRpYyBkcmlmdCAoYENIQU5HRURgL2BERUxFVEVEYCkgaXMgY2hlY2tlZCBhZ2FpbnN0IGBtZW1vU3RhdGVgIHZpYSBpdHNcbiAqIG93biBkaWdlc3QgKGBnYXRlU3RhdGVEaWdlc3Qoc2VtYW50aWMsIFtdKWApLCB0aGUgc2FtZSBkaXN0aW5jdC1kZWJ0LXN0YXRlXG4gKiBtZW1vIHRoZSB1bmNvdmVyZWQtd3JpdGVzIGNoZWNrIGFscmVhZHkgdXNlczogbm90IHlldCBwcmVzZW50ZWQgXHUyMTkyIHJlY29yZCBpdFxuICogYW5kIGBkZW55YC9gc2VtYW50aWMtc3RhbGVuZXNzYCAoYSBgbWVtb1N0YXRlLnJlY29yZGAgZmFpbHVyZSBmYWlscyBvcGVuIHRvXG4gKiBgYWxsb3dgL2BzaWxlbnRgLCBzaW5jZSBhIG5vbi1wZXJzaXN0aW5nIG1lbW8gd291bGQgcmUtZGVueSB0aGUgaWRlbnRpY2FsXG4gKiByZXRyeSBmb3JldmVyKTsgYWxyZWFkeSBwcmVzZW50ZWQgXHUyMTkyICoqZmFsbCB0aHJvdWdoKiogcmF0aGVyIHRoYW4gcmV0dXJuaW5nLFxuICogc28gYSByZXRyeSBzdGlsbCBzdXJmYWNlcyBlbnZpcm9ubWVudGFsIGFkdmlzb3JpZXMgYW5kIHN0aWxsIHJ1bnMgdGhlXG4gKiB1bmNvdmVyZWQgY2hlY2suIFdoZXRoZXIgdGhlIHNlbWFudGljIHN0YXRlIHdhcyBhbHJlYWR5IHByZXNlbnRlZCBpc1xuICogdHJhY2tlZCBzbyB0aGF0LCBpZiB0aGUgZXZhbHVhdGlvbiB0aGVuIGVuZHMgY2xlYW4sIGl0IHJlc29sdmVzIHRvXG4gKiBgYWxsb3dgL2BhbHJlYWR5LXByZXNlbnRlZGAgcmF0aGVyIHRoYW4gYSBiYXJlIGBhbGxvd2AvYHNpbGVudGAgXHUyMDE0IG1pcnJvcmluZ1xuICogdGhlIHVuY292ZXJlZCBicmFuY2gncyBvd24gbWVtby1oaXQgcmVzdWx0LiBBIGNoYW5nZXNldCBjYXJyeWluZyBib3RoXG4gKiB1bnByZXNlbnRlZCBzZW1hbnRpYyBzdGFsZW5lc3MgYW5kIHVucHJlc2VudGVkIHVuY292ZXJlZCB3cml0ZXMgdGhlcmVmb3JlXG4gKiBkZW5pZXMgdHdpY2UgKHN0YWxlbmVzcyBmaXJzdCwgdW5jb3ZlcmVkIG9uIHRoZSByZXRyeSkgYmVmb3JlIGEgdGhpcmRcbiAqIGF0dGVtcHQgcGFzc2VzOyBlZGl0aW5nIG9uZSBzdGFsZSBzcGFuIHdoaWxlIGFub3RoZXIgcmVtYWlucyBzdGFsZSBwcm9kdWNlc1xuICogYSBuZXcgZmluZGluZ3Mgc2V0LCBoZW5jZSBhIG5ldyBkaWdlc3QgYW5kIG9uZSBmcmVzaCBkZW55LiBEaWdlc3QgY29sbGlzaW9uXG4gKiBiZXR3ZWVuIHRoZSB0d28gY2F0ZWdvcmllcyBpcyBpbXBvc3NpYmxlOiB0aGUgcGF5bG9hZCBpc1xuICogYEpTT04uc3RyaW5naWZ5KHtmaW5kaW5ncywgdW5jb3ZlcmVkfSlgLCBhbmQgdGhlIHNlbWFudGljIGRpZ2VzdCBwb3B1bGF0ZXNcbiAqIGBmaW5kaW5nc2Agd2hpbGUgdGhlIHVuY292ZXJlZCBkaWdlc3QgcG9wdWxhdGVzIGB1bmNvdmVyZWRgLlxuICpcbiAqIEVudmlyb25tZW50YWwgY29uZGl0aW9ucyB0aGUgQ0xJIGNvdWxkIG5vdCByZXNvbHZlIGF0IGFsbFxuICogKGBDT05GTElDVGAvYFNVQk1PRFVMRWAvYExGU18qYC9gUFJPTUlTT1JfTUlTU0lOR2AvYFNQQVJTRV9FWENMVURFRGAvXG4gKiBgRklMVEVSX0ZBSUxFRGAvYElPX0VSUk9SYCkgXHUyMTkyIGBhbGxvd2AvYGVudmlyb25tZW50YWxgOiBmYWlsIE9QRU4sIHN1cmZhY2luZyB0aGVcbiAqIGNvbmRpdGlvbiByYXRoZXIgdGhhbiBkZW55aW5nIG9uIGFuIGluZnJhIGZhaWx1cmUgYSBzcGFuIGVkaXQgY2Fubm90IGZpeC5cbiAqIFVuY292ZXJlZCB3cml0ZXMgKGNoYW5nZWQgcGF0aHMgd2l0aCB6ZXJvIGNvdmVyYWdlIGZyb20gYGV4ZWN1dG9ycy5saXN0YCxcbiAqIG1pbnVzIGAuc3Bhbi8qKmAsIGFuZCBwYXRocyBtYXRjaGVkIGJ5IHRoZSByZXBvJ3MgYC5zcGFuLy5nYXRlaWdub3JlYCBcdTIwMTQgc2VlXG4gKiB7QGxpbmsgZmlsZTovLy4vZ2F0ZS1pZ25vcmUudHN9LCBsb2FkZWQgZGlyZWN0bHkgZnJvbSBkaXNrIHZpYVxuICogYHJlc29sdmVSZXBvUm9vdChjd2QpYCwgZmFpbC1vcGVuIHdoZW4gYWJzZW50L3VucmVhZGFibGUpIFx1MjE5MlxuICogYGRlbnlgL2B1bmNvdmVyZWQtd3JpdGVzYCB0aGUgZmlyc3QgdGltZSB0aGF0IHN0YXRlIGlzIGJvdGggdW5wcmVzZW50ZWQgYW5kXG4gKiB1bnNlZW4sIHRoZW4gYGFsbG93YC9gYWxyZWFkeS1wcmVzZW50ZWRgIG9uIHJldHJ5IFx1MjAxNCBvciBpbW1lZGlhdGVseSwgaWYgYVxuICogcHJpb3IgYCdpbmZvcm0nYCBwcmV2aWV3IGFscmVhZHkgc2hvd2VkIHRoaXMgZXhhY3Qgc3RhdGUgaW4gZnVsbDogdGhlIGdhdGVcbiAqIGlzIGluZm9ybWF0aW9uYWwgKGEgYmFyZSByZXRyeSBhbHJlYWR5IGdldHMgcGFzdCBhIGRlbnkpLCBzbyB0aGVyZSBpc1xuICogbm90aGluZyB0byBnYWluIGZyb20gZGVueWluZyBhIHN0YXRlIHRoZSBhZ2VudCBoYXMgYWxyZWFkeSBiZWVuIHRvbGRcbiAqIGFib3V0LiBgTU9WRURgIGFuZCBgUkVTT0xWRURfUEVORElOR19DT01NSVRgIG5ldmVyIGNvbnRyaWJ1dGUgdG8gYW55IGJyYW5jaFxuICogYW5kIG5ldmVyIGRlbnkuIEFueSBpbnRlcm5hbCBlcnJvciByZXNvbHZlcyB0byBgYWxsb3dgL2BzaWxlbnRgIFx1MjAxNCB0aGUgZ2F0ZVxuICogZmFpbHMgb3BlbiBhbmQgbmV2ZXIgYnJpY2tzIGEgY29tbWl0LlxuICpcbiAqIEEge0BsaW5rIEdhdGVTY2FuRXJyb3J9IGZyb20gYGV4ZWN1dG9ycy5zdGFsZWAgaXMgdGhlIG9uZSBjYXNlIGhhbmRsZWRcbiAqIG91dHNpZGUgdGhhdCBmbG93OiBhIHNjYW4gdGhhdCAqY291bGQgbm90IGNvbXBsZXRlKiAoZS5nLiBhbiB1bnJlYWRhYmxlXG4gKiBhbmNob3IgZmlsZSBhYm9ydHMgdGhlIHNjb3BlZCBxdWVyeSkgeWllbGRzIGFuIGVtcHR5IHJlc3VsdCB0aGF0IGlzIE5PVFxuICogZXZpZGVuY2Ugb2YgYSBjbGVhbiBjaGFuZ2VzZXQuIFJlYWRpbmcgdGhhdCBhcyBgYWxsb3dgL2BzaWxlbnRgIHdvdWxkXG4gKiBzaWxlbnRseSBzd2FsbG93IHRoZSBmYWN0IHRoYXQgdmVyaWZpY2F0aW9uIG5ldmVyIGhhcHBlbmVkLCBzbyBpdCByZXNvbHZlc1xuICogaW5zdGVhZCB0byBpdHMgb3duIGBhbGxvd2AvYHNjYW4tZmFpbGVkYCBcdTIwMTQgZmFpbCBPUEVOIGxpa2UgYGVudmlyb25tZW50YWxgXG4gKiAodGhlIGNvbW1hbmQgaXMgbm90IGhlbGQpLCBidXQgd2l0aCBhIGRpc3RpbmN0IGBraW5kYCBhbmQgYHJlYXNvbmAgc28gdGhlXG4gKiBhZGFwdGVyIHN1cmZhY2VzIGEgd2FybmluZyB0aGF0IHNwYW4gZGVidCB3YXMgTk9UIHZlcmlmaWVkIGZvciB0aGlzXG4gKiBjaGFuZ2VzZXQgcmF0aGVyIHRoYW4gc3RheWluZyBzaWxlbnQuIFRoZXJlIGlzIG5vIGRlYnQtc3RhdGUgdG8gbWVtb2l6ZVxuICogaGVyZTogZXZlcnkgZXZhbHVhdGlvbiBvZiBhIHN0aWxsLWZhaWxpbmcgc2NhbiB3YXJucyBhZ2Fpbi5cbiAqXG4gKiBJbiBgJ2luZm9ybSdgIG1vZGUgKGBzdGF0dXNgKSwgdGhlIHNhbWUgY2xhc3NpZmljYXRpb24gcnVucyBidXQgbmVpdGhlclxuICogYGRlbnlgIGJyYW5jaCBmaXJlcyBhbmQgYG1lbW9TdGF0ZWAgaXMgbmV2ZXIgcmVhZCBvciB3cml0dGVuOiBzZW1hbnRpY1xuICogc3RhbGVuZXNzIHJlc29sdmVzIHRvIGBhbGxvd2AvYHNlbWFudGljLXN0YWxlbmVzcy1pbmZvYCBhbmQgdW5jb3ZlcmVkXG4gKiB3cml0ZXMgdG8gYGFsbG93YC9gdW5jb3ZlcmVkLXdyaXRlcy1pbmZvYCwgYm90aCBjYXJyeWluZyB0aGUgc2FtZVxuICogYGZpbmRpbmdzYC9gdW5jb3ZlcmVkYC9gcmVhc29uYCBwYXlsb2FkIHRoZSBgZGVueWAga2luZHMgd291bGQgaGF2ZS4gVGhlXG4gKiBlbnZpcm9ubWVudGFsL3NjYW4tZmFpbGVkL3NpbGVudCBicmFuY2hlcyBhcmUgdW5hZmZlY3RlZCBieSBtb2RlIFx1MjAxNCB0aGV5XG4gKiBhbHJlYWR5IGFsd2F5cyBhbGxvdy5cbiAqXG4gKiBAcGFyYW0gcGF0aHMgVGhlIHJlc29sdmVkIGNoYW5nZXNldCBmcm9tIHtAbGluayByZXNvbHZlQ2hhbmdlc2V0fS4gRW1wdHkgXHUyMTkyXG4gKiAgIGBhbGxvd2AvYHNpbGVudGAuXG4gKiBAcGFyYW0gY3dkIFRoZSB3b3JraW5nIGRpcmVjdG9yeSB0aGUgZ2l0IGNvbW1hbmQgcmFuIGluLlxuICogQHBhcmFtIGV4ZWN1dG9ycyBUaGUgaW5qZWN0ZWQgYGZpeGAvYHN0YWxlYC9gbGlzdGAgc3VyZmFjZS5cbiAqIEBwYXJhbSBtZW1vU3RhdGUgVGhlIHBlci1jaGFuZ2VzZXQgZGVidC1zdGF0ZSBtZW1vLiBVbnVzZWQgaW4gYCdpbmZvcm0nYCBtb2RlLlxuICogQHBhcmFtIG1vZGUgYCdlbmZvcmNlJ2AgKGRlZmF1bHQpIG1heSBkZW55OyBgJ2luZm9ybSdgIG9ubHkgZXZlciBhZHZpc2VzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZXZhbHVhdGVHYXRlKFxuICBwYXRoczogc3RyaW5nW10sXG4gIGN3ZDogc3RyaW5nLFxuICBleGVjdXRvcnM6IEdhdGVFeGVjdXRvcnMsXG4gIG1lbW9TdGF0ZTogR2F0ZU1lbW9TdGF0ZSxcbiAgbW9kZTogR2F0ZU1vZGUgPSAnZW5mb3JjZSdcbik6IFByb21pc2U8R2F0ZVJlc3VsdD4ge1xuICBpZiAocGF0aHMubGVuZ3RoID09PSAwKSByZXR1cm4geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ3NpbGVudCcgfTtcbiAgdHJ5IHtcbiAgICAvLyBCZWx0LWFuZC1icmFjZXMgaGVhbCwgdGhlbiBjbGFzc2lmeSBhZ2FpbnN0IHRoZSBoZWFsZWQgc3RhdGUuXG4gICAgYXdhaXQgZXhlY3V0b3JzLmZpeChwYXRocywgY3dkKTtcbiAgICBjb25zdCBzdGFsZVJvd3MgPSBhd2FpdCBleGVjdXRvcnMuc3RhbGUocGF0aHMsIGN3ZCk7XG5cbiAgICAvLyBTcGxpdCBkZWJ0IHJvd3MgaW50byBzZW1hbnRpYyBkcmlmdCAoYSB1c2VyIGNhbiBmaXggYnkgZWRpdGluZyBhIHNwYW4pXG4gICAgLy8gYW5kIHRlcm1pbmFsL2Vudmlyb25tZW50YWwgY29uZGl0aW9ucyAodGhlIENMSSBjb3VsZCBub3QgcmVzb2x2ZSB0aGVcbiAgICAvLyBhbmNob3IgYXQgYWxsIFx1MjAxNCBzcGFyc2UgY2hlY2tvdXQsIHVuZmV0Y2hlZCBMRlMsIHBhcnRpYWwtY2xvbmUgbWlzcywgSS9PXG4gICAgLy8gZXJyb3IpLiBgaXNEZWJ0KClgIGlzIHRoZSBzaW5nbGUgc291cmNlIG9mIHRydXRoIGZvciB3aGF0IGlzIGRlYnQgYXQgYWxsO1xuICAgIC8vIGBpc0Vudmlyb25tZW50YWxTdGF0dXMoKWAgc3BsaXRzIHRoZSBmaXhhYmxlIGZyb20gdGhlIHVucmVzb2x2YWJsZS5cbiAgICAvLyBgTU9WRURgL2BSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgYXJlIG5ldmVyIGRlYnQgYW5kIG5ldmVyIGNvbnRyaWJ1dGUuXG4gICAgY29uc3QgZGVidFJvd3MgPSBzdGFsZVJvd3MuZmlsdGVyKChyb3cpID0+IGlzRGVidChyb3cuc3RhdHVzKSk7XG4gICAgY29uc3Qgc2VtYW50aWMgPSBkZWJ0Um93cy5maWx0ZXIoKHJvdykgPT4gIWlzRW52aXJvbm1lbnRhbFN0YXR1cyhyb3cuc3RhdHVzKSk7XG4gICAgY29uc3QgZW52aXJvbm1lbnRhbCA9IGRlYnRSb3dzLmZpbHRlcigocm93KSA9PiBpc0Vudmlyb25tZW50YWxTdGF0dXMocm93LnN0YXR1cykpO1xuXG4gICAgaWYgKG1vZGUgPT09ICdpbmZvcm0nKSB7XG4gICAgICAvLyBBIHN0YXR1cyBwcmV2aWV3IG5ldmVyIGRlbmllcyBhbmQgbmV2ZXIgdG91Y2hlcyB0aGUgZW5mb3JjZVxuICAgICAgLy8gY29uc2lkZXItb25jZSBkZW55IGNyZWRpdCBcdTIwMTQgaXQgcmVwb3J0cyB3aGF0ZXZlciBkZWJ0IGlzIGxpdmUgcmlnaHRcbiAgICAgIC8vIG5vdywgZXZlcnkgdGltZSBpdCdzIGFza2VkLiBJdCBkb2VzLCBob3dldmVyLCBtYXJrIHRoZSBkZWJ0IHN0YXRlIGFzXG4gICAgICAvLyBcInNlZW5cIiAoYSBzZXBhcmF0ZSBheGlzIGZyb20gdGhlIGRlbnkgY3JlZGl0KSBzbyBhbiBlbmZvcmNlXG4gICAgICAvLyBldmFsdWF0aW9uIG9mIHRoZSBzYW1lIHVuY2hhbmdlZCBzdGF0ZSBtb21lbnRzIGxhdGVyIFx1MjAxNCBlLmcuIGEgYGdpdFxuICAgICAgLy8gY29tbWl0YCByaWdodCBhZnRlciB0aGUgYGdpdCBzdGF0dXNgIHRoYXQganVzdCBzaG93ZWQgdGhpcyBcdTIwMTQgcmVuZGVyc1xuICAgICAgLy8gYSBjb25kZW5zZWQgcmVtaW5kZXIgaW5zdGVhZCBvZiByZXBlYXRpbmcgdGhlIGlkZW50aWNhbCBjaGVja2xpc3QuXG4gICAgICBpZiAoc2VtYW50aWMubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBzZWVuID0gd2FzQWxyZWFkeVNlZW4obWVtb1N0YXRlLCBnYXRlU3RhdGVEaWdlc3Qoc2VtYW50aWMsIFtdKSk7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgZGVjaXNpb246ICdhbGxvdycsXG4gICAgICAgICAga2luZDogJ3NlbWFudGljLXN0YWxlbmVzcy1pbmZvJyxcbiAgICAgICAgICBmaW5kaW5nczogc2VtYW50aWMsXG4gICAgICAgICAgcmVhc29uOiByZW5kZXJTdGFsZW5lc3NSZWFzb24oc2VtYW50aWMsIGF3YWl0IGZldGNoU3BhbkJsb2NrcyhleGVjdXRvcnMsIHNlbWFudGljLCBjd2QpLCAnaW5mb3JtJywgc2VlbilcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGlmIChlbnZpcm9ubWVudGFsLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBkZWNpc2lvbjogJ2FsbG93JyxcbiAgICAgICAgICBraW5kOiAnZW52aXJvbm1lbnRhbCcsXG4gICAgICAgICAgY29uZGl0aW9uczogZW52aXJvbm1lbnRhbCxcbiAgICAgICAgICByZWFzb246IHJlbmRlckVudmlyb25tZW50YWxSZWFzb24oZW52aXJvbm1lbnRhbCwgYXdhaXQgZmV0Y2hTcGFuQmxvY2tzKGV4ZWN1dG9ycywgZW52aXJvbm1lbnRhbCwgY3dkKSlcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHsgdW5jb3ZlcmVkLCBjb3ZlcmluZyB9ID0gYXdhaXQgY29tcHV0ZVVuY292ZXJlZFBhdGhzKHBhdGhzLCBjd2QsIGV4ZWN1dG9ycyk7XG4gICAgICBpZiAodW5jb3ZlcmVkLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHsgZGVjaXNpb246ICdhbGxvdycsIGtpbmQ6ICdzaWxlbnQnIH07XG4gICAgICBjb25zdCBzZWVuID0gd2FzQWxyZWFkeVNlZW4obWVtb1N0YXRlLCBnYXRlU3RhdGVEaWdlc3QoW10sIHVuY292ZXJlZCkpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgZGVjaXNpb246ICdhbGxvdycsXG4gICAgICAgIGtpbmQ6ICd1bmNvdmVyZWQtd3JpdGVzLWluZm8nLFxuICAgICAgICB1bmNvdmVyZWQsXG4gICAgICAgIHJlYXNvbjogcmVuZGVyVW5jb3ZlcmVkUmVhc29uKFxuICAgICAgICAgIHVuY292ZXJlZCxcbiAgICAgICAgICBjb3ZlcmluZyxcbiAgICAgICAgICBhd2FpdCBmZXRjaFNwYW5CbG9ja3MoZXhlY3V0b3JzLCBjb3ZlcmluZywgY3dkKSxcbiAgICAgICAgICAnaW5mb3JtJyxcbiAgICAgICAgICBzZWVuXG4gICAgICAgIClcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gU2VtYW50aWMgc3RhbGVuZXNzIGpvaW5zIHRoZSBzYW1lIGRpc3RpbmN0LWRlYnQtc3RhdGUgbWVtbyB0aGUgdW5jb3ZlcmVkXG4gICAgLy8gY2hlY2sgdXNlczogZGVueSBvbmNlIHBlciBmaW5kaW5ncyBkaWdlc3QsIHRoZW4gZmFsbCB0aHJvdWdoIChyYXRoZXIgdGhhblxuICAgIC8vIHJldHVybmluZykgb24gYW4gaWRlbnRpY2FsIHJldHJ5IHNvIHRoZSByZXN0IG9mIHRoZSBldmFsdWF0aW9uIHN0aWxsIHJ1bnMuXG4gICAgbGV0IHNlbWFudGljQWxyZWFkeVByZXNlbnRlZCA9IGZhbHNlO1xuICAgIGlmIChzZW1hbnRpYy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBzZW1hbnRpY0RpZ2VzdCA9IGdhdGVTdGF0ZURpZ2VzdChzZW1hbnRpYywgW10pO1xuICAgICAgaWYgKG1lbW9TdGF0ZS5oYXMoc2VtYW50aWNEaWdlc3QpKSB7XG4gICAgICAgIHNlbWFudGljQWxyZWFkeVByZXNlbnRlZCA9IHRydWU7XG4gICAgICB9IGVsc2UgaWYgKG1lbW9TdGF0ZS5oYXMoYHNlZW4tJHtzZW1hbnRpY0RpZ2VzdH1gKSkge1xuICAgICAgICAvLyBBbHJlYWR5IGV4cGxhaW5lZCBpbiBmdWxsIGJ5IGEgcHJpb3IgYGluZm9ybWAgKHN0YXR1cykgcHJldmlldy4gVGhlXG4gICAgICAgIC8vIGdhdGUgaXMgaW5mb3JtYXRpb25hbCwgbm90IGEgaGFyZCBibG9jayBcdTIwMTQgaXQgY2FuIGFscmVhZHkgYmUgZ290dGVuXG4gICAgICAgIC8vIHBhc3QgYnkgc2ltcGx5IHJldHJ5aW5nIHRoZSBjb21tYW5kLCBzbyBkZW55aW5nIGEgc3RhdGUgdGhlIGFnZW50XG4gICAgICAgIC8vIGhhcyBhbHJlYWR5IGJlZW4gc2hvd24gYnV5cyBub3RoaW5nOyByZWNvcmQgdGhlIGRlbnkgY3JlZGl0IHRvbyBzb1xuICAgICAgICAvLyB0aGlzIGRpZ2VzdCByZWFkcyBhcyBwcmVzZW50ZWQgZnJvbSBoZXJlIG9uLCBhbmQgbGV0IGl0IHRocm91Z2guXG4gICAgICAgIG1lbW9TdGF0ZS5yZWNvcmQoc2VtYW50aWNEaWdlc3QpO1xuICAgICAgICBzZW1hbnRpY0FscmVhZHlQcmVzZW50ZWQgPSB0cnVlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQSBub24tcGVyc2lzdGluZyBtZW1vIHdyaXRlIHdvdWxkIHR1cm4gXCJkZW55IG9uY2UsIHRoZW4gYWxsb3cgdGhlXG4gICAgICAgIC8vIHJldHJ5XCIgaW50byBcImRlbnkgZXZlcnkgdGltZVwiIHdpdGggbm8gZXNjYXBlIFx1MjAxNCBmYWlsIG9wZW4gaW5zdGVhZC5cbiAgICAgICAgaWYgKCFtZW1vU3RhdGUucmVjb3JkKHNlbWFudGljRGlnZXN0KSkgcmV0dXJuIHsgZGVjaXNpb246ICdhbGxvdycsIGtpbmQ6ICdzaWxlbnQnIH07XG4gICAgICAgIG1lbW9TdGF0ZS5yZWNvcmQoYHNlZW4tJHtzZW1hbnRpY0RpZ2VzdH1gKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBkZWNpc2lvbjogJ2RlbnknLFxuICAgICAgICAgIGtpbmQ6ICdzZW1hbnRpYy1zdGFsZW5lc3MnLFxuICAgICAgICAgIGZpbmRpbmdzOiBzZW1hbnRpYyxcbiAgICAgICAgICByZWFzb246IHJlbmRlclN0YWxlbmVzc1JlYXNvbihzZW1hbnRpYywgYXdhaXQgZmV0Y2hTcGFuQmxvY2tzKGV4ZWN1dG9ycywgc2VtYW50aWMsIGN3ZCksICdlbmZvcmNlJylcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBFbnZpcm9ubWVudGFsIGNvbmRpdGlvbnMgYXJlIG5vdCBhIHNwYW4gZWRpdCBhd2F5IGZyb20gcmVzb2x1dGlvbjogZmFpbFxuICAgIC8vIE9QRU4gKGFsbG93KSBcdTIwMTQgYnV0IGNhcnJ5IHRoZW0gc28gdGhlIGFkYXB0ZXIgc3VyZmFjZXMgdGhlIGNvbmRpdGlvbiByYXRoZXJcbiAgICAvLyB0aGFuIHN3YWxsb3dpbmcgaXQuIERlbnlpbmcgd291bGQgcmUtZGVueSBmb3JldmVyIG9uIGFuIGluZnJhIGZhaWx1cmUgdGhlXG4gICAgLy8gdXNlciBjYW5ub3QgY2xlYXIgZnJvbSB0aGUgZ2F0ZSwgY29udHJhZGljdGluZyB0aGUgZmFpbC1vcGVuIGNvbnRyYWN0IHRoZVxuICAgIC8vIHJlc3Qgb2YgdGhlIGdhdGUgYWxyZWFkeSBob25vcnMgZm9yIENMSS1hYnNlbnQvdGltZW91dC9wYXJzZSBmYWlsdXJlcy5cbiAgICBpZiAoZW52aXJvbm1lbnRhbC5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBkZWNpc2lvbjogJ2FsbG93JyxcbiAgICAgICAga2luZDogJ2Vudmlyb25tZW50YWwnLFxuICAgICAgICBjb25kaXRpb25zOiBlbnZpcm9ubWVudGFsLFxuICAgICAgICByZWFzb246IHJlbmRlckVudmlyb25tZW50YWxSZWFzb24oZW52aXJvbm1lbnRhbCwgYXdhaXQgZmV0Y2hTcGFuQmxvY2tzKGV4ZWN1dG9ycywgZW52aXJvbm1lbnRhbCwgY3dkKSlcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gVW5jb3ZlcmVkIHdyaXRlczogY2hhbmdlZCBwYXRocyB3aXRoIHplcm8gY292ZXJpbmcgc3BhbiwgbWludXMgYC5zcGFuLyoqYFxuICAgIC8vIChzcGFuIHJlcGFpcnMgcmlkZSB0aGUgc2FtZSBjb21taXQgYW5kIG11c3QgbmV2ZXIgc2VsZi10cmlnZ2VyIHRoZSBnYXRlKVxuICAgIC8vIGFuZCBwYXRocyB0aGUgcmVwbydzIHVzZXItb3duZWQgYC5zcGFuLy5nYXRlaWdub3JlYCBleGNsdWRlcy4gR2l0aWdub3JlZFxuICAgIC8vIHBhdGhzIG5ldmVyIHJlYWNoIGhlcmUgXHUyMDE0IGdpdCBkb2VzIG5vdCBzdGFnZS9wdWJsaXNoIHRoZW0uXG4gICAgY29uc3QgeyB1bmNvdmVyZWQsIGNvdmVyaW5nIH0gPSBhd2FpdCBjb21wdXRlVW5jb3ZlcmVkUGF0aHMocGF0aHMsIGN3ZCwgZXhlY3V0b3JzKTtcbiAgICBpZiAodW5jb3ZlcmVkLmxlbmd0aCA9PT0gMCkge1xuICAgICAgLy8gQSByZXRyeSB0aGF0IGZlbGwgdGhyb3VnaCBwYXN0IGFuIGFscmVhZHktcHJlc2VudGVkIHNlbWFudGljLXN0YWxlbmVzc1xuICAgICAgLy8gZGlnZXN0IGVuZHMgY2xlYW4gaGVyZTogc3VyZmFjZSBhbHJlYWR5LXByZXNlbnRlZCByYXRoZXIgdGhhbiBhIGJhcmVcbiAgICAgIC8vIHNpbGVudCBhbGxvdywgbWlycm9yaW5nIHRoZSB1bmNvdmVyZWQgYnJhbmNoJ3Mgb3duIG1lbW8taGl0IHJlc3VsdC5cbiAgICAgIHJldHVybiBzZW1hbnRpY0FscmVhZHlQcmVzZW50ZWRcbiAgICAgICAgPyB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnYWxyZWFkeS1wcmVzZW50ZWQnIH1cbiAgICAgICAgOiB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnc2lsZW50JyB9O1xuICAgIH1cblxuICAgIC8vIENvbnNpZGVyLW9uY2U6IGRlbnkgdGhlIGZpcnN0IHRpbWUgdGhpcyBleGFjdCBkZWJ0IHN0YXRlIGlzIHNlZW4sIHRoZW5cbiAgICAvLyBwYXNzIHRoZSByZXRyeSB3aXRoIGFuIHVuY2hhbmdlZCBzdGF0ZS4gKE5vIHNlbWFudGljIHJvd3Mgc3Vydml2ZSB0b1xuICAgIC8vIGhlcmUgdW5wcmVzZW50ZWQgXHUyMDE0IHRoZSBzZW1hbnRpYyBicmFuY2ggYWJvdmUgaGFzIGFscmVhZHkgcmV0dXJuZWQgZm9yXG4gICAgLy8gdGhhdCBjYXNlIFx1MjAxNCBzbyB0aGUgZGlnZXN0J3MgZmluZGluZ3MgY29tcG9uZW50IGlzIGVtcHR5IGFuZCB0aGUgc3RhdGVcbiAgICAvLyBpcyBrZXllZCBieSB0aGUgdW5jb3ZlcmVkIHNldC4pIGBjb3ZlcmluZ2AgXHUyMDE0IHdoaWNoIHNwYW5zIGZvciB0aGUgcmVzdCBvZlxuICAgIC8vIHRoaXMgY2hhbmdlc2V0IHRoZSBtZXNzYWdlIGdvZXMgb24gdG8gbmFtZSBcdTIwMTQgbmV2ZXIgZmVlZHMgdGhlIGRpZ2VzdDogaXRcbiAgICAvLyBuZXZlciBjaGFuZ2VzIHdoYXQncyBkZW5pZWQsIG9ubHkgd2hhdCdzIGV4cGxhaW5lZCwgc28gaXQgY2FuJ3Qgc3Bhd24gYVxuICAgIC8vIGZyZXNoIGRlbnkgb24gaXRzIG93bi5cbiAgICBjb25zdCBkaWdlc3QgPSBnYXRlU3RhdGVEaWdlc3QoW10sIHVuY292ZXJlZCk7XG4gICAgaWYgKG1lbW9TdGF0ZS5oYXMoZGlnZXN0KSkgcmV0dXJuIHsgZGVjaXNpb246ICdhbGxvdycsIGtpbmQ6ICdhbHJlYWR5LXByZXNlbnRlZCcgfTtcbiAgICBpZiAobWVtb1N0YXRlLmhhcyhgc2Vlbi0ke2RpZ2VzdH1gKSkge1xuICAgICAgLy8gQWxyZWFkeSBleHBsYWluZWQgaW4gZnVsbCBieSBhIHByaW9yIGBpbmZvcm1gIChzdGF0dXMpIHByZXZpZXcgXHUyMDE0IHRoZVxuICAgICAgLy8gZ2F0ZSBpcyBpbmZvcm1hdGlvbmFsIGFuZCBhIHJldHJ5IGFsb25lIGFscmVhZHkgZ2V0cyBwYXN0IGl0LCBzb1xuICAgICAgLy8gZGVueWluZyBhIHN0YXRlIHRoZSBhZ2VudCBoYXMgYWxyZWFkeSBiZWVuIHNob3duIGJ1eXMgbm90aGluZy5cbiAgICAgIC8vIFJlY29yZCB0aGUgZGVueSBjcmVkaXQgc28gdGhpcyBkaWdlc3QgcmVhZHMgYXMgcHJlc2VudGVkIGZyb20gaGVyZVxuICAgICAgLy8gb24sIGFuZCBsZXQgaXQgdGhyb3VnaC5cbiAgICAgIG1lbW9TdGF0ZS5yZWNvcmQoZGlnZXN0KTtcbiAgICAgIHJldHVybiB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnYWxyZWFkeS1wcmVzZW50ZWQnIH07XG4gICAgfVxuICAgIC8vIEEgbm9uLXBlcnNpc3RpbmcgbWVtbyB3cml0ZSB3b3VsZCB0dXJuIFwiZGVueSBvbmNlLCB0aGVuIGFsbG93IHRoZSByZXRyeVwiXG4gICAgLy8gaW50byBcImRlbnkgZXZlcnkgdGltZVwiIHdpdGggbm8gZXNjYXBlIFx1MjAxNCBmYWlsIG9wZW4gcmF0aGVyIHRoYW4gZGVueS5cbiAgICBpZiAoIW1lbW9TdGF0ZS5yZWNvcmQoZGlnZXN0KSkgcmV0dXJuIHsgZGVjaXNpb246ICdhbGxvdycsIGtpbmQ6ICdzaWxlbnQnIH07XG4gICAgbWVtb1N0YXRlLnJlY29yZChgc2Vlbi0ke2RpZ2VzdH1gKTtcbiAgICByZXR1cm4ge1xuICAgICAgZGVjaXNpb246ICdkZW55JyxcbiAgICAgIGtpbmQ6ICd1bmNvdmVyZWQtd3JpdGVzJyxcbiAgICAgIHVuY292ZXJlZCxcbiAgICAgIHJlYXNvbjogcmVuZGVyVW5jb3ZlcmVkUmVhc29uKHVuY292ZXJlZCwgY292ZXJpbmcsIGF3YWl0IGZldGNoU3BhbkJsb2NrcyhleGVjdXRvcnMsIGNvdmVyaW5nLCBjd2QpLCAnZW5mb3JjZScpXG4gICAgfTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgLy8gQSBzY2FuIHRoYXQgY291bGQgbm90IENPTVBMRVRFIGlzIG5vdCBhIGNsZWFuIHJlc3VsdCwgYnV0IGl0IGlzIG5vdFxuICAgIC8vIGRlYnQgZWl0aGVyIFx1MjAxNCB0aGVyZSBpcyBub3RoaW5nIGhlcmUgZm9yIGEgdXNlciB0byByZXNvbHZlIGJ5IGVkaXRpbmcgYVxuICAgIC8vIHNwYW4uIEZhaWwgT1BFTiB3aXRoIGEgZGlzdGluZ3Vpc2hhYmxlIGBzY2FuLWZhaWxlZGAgd2FybmluZyBpbnN0ZWFkIG9mXG4gICAgLy8gc2lsZW50bHkgcmVhZGluZyB0aGUgYWJvcnRlZCBzY2FuJ3MgZW1wdHkgcmVzdWx0IGFzIGNsZWFuLlxuICAgIGlmIChlcnIgaW5zdGFuY2VvZiBHYXRlU2NhbkVycm9yKSB7XG4gICAgICByZXR1cm4geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ3NjYW4tZmFpbGVkJywgcmVhc29uOiByZW5kZXJTY2FuRmFpbGVkUmVhc29uKGVyci5kZXRhaWwpIH07XG4gICAgfVxuICAgIC8vIEZhaWwgb3BlbjogYW55IG90aGVyIGludGVybmFsL0NMSSBlcnJvciByZXNvbHZlcyB0byBhbGxvdy4gVGhlIGdhdGUgbXVzdFxuICAgIC8vIG5ldmVyIGJyaWNrIGEgY29tbWl0IG9uIGl0cyBvd24gZmFpbHVyZS5cbiAgICByZXR1cm4geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ3NpbGVudCcgfTtcbiAgfVxufVxuXG4vKipcbiAqIHtAbGluayBjb21wdXRlVW5jb3ZlcmVkUGF0aHN9J3MgcmVzdWx0OiB0aGUgdW5jb3ZlcmVkIGNvbXBsZW1lbnQgdGhlIGdhdGVcbiAqIGRlbmllcy9hZHZpc2VzIG9uLCBwbHVzIHRoZSBgY292ZXJpbmdgIHJvd3MgdGhlIHNhbWUgYGV4ZWN1dG9ycy5saXN0YCBjYWxsXG4gKiBhbHJlYWR5IHJlc29sdmVkIGZvciB0aGUgcmVzdCBvZiB0aGUgY2hhbmdlc2V0IFx1MjAxNCBldmVyeSBhbmNob3IsIGluIGFueSBzcGFuLFxuICogd2hvc2UgcGF0aCBpcyBvbmUgb2YgdGhlIHBhdGhzIHBhc3NlZCBpbi4gYGNvdmVyaW5nYCBpcyBuZXZlciBlbXB0eSBvbmx5XG4gKiB3aGVuIGB1bmNvdmVyZWRgIGlzOyB0aGUgdHdvIHBhcnRpdGlvbiB0aGUgY2hhbmdlc2V0IChtaW51cyBgLnNwYW4vKipgL1xuICogZ2F0ZWlnbm9yZWQgcGF0aHMsIHdoaWNoIGFwcGVhciBpbiBuZWl0aGVyKS4gS2VwdCB0b2dldGhlciBzbyBhIGNhbGxlclxuICogbmVlZGluZyBib3RoICh0aGUgdW5jb3ZlcmVkLXdyaXRlcyByZWFzb24sIHdoaWNoIG5vdyBhbHNvIG5hbWVzIHNwYW5zXG4gKiBhbHJlYWR5IGNvdmVyaW5nIHRoZSBjaGFuZ2VzZXQncyBvdGhlciBmaWxlcyBcdTIwMTQgc2VlXG4gKiB7QGxpbmsgcmVuZGVyVW5jb3ZlcmVkUmVhc29ufSkgbWFrZXMgb25lIGNhbGwgaW5zdGVhZCBvZiB0d28uXG4gKi9cbmludGVyZmFjZSBDaGFuZ2VzZXRDb3ZlcmFnZSB7XG4gIHVuY292ZXJlZDogc3RyaW5nW107XG4gIGNvdmVyaW5nOiBQb3JjZWxhaW5Sb3dbXTtcbn1cblxuLyoqXG4gKiBUaGUgY2hhbmdlZCBwYXRocyB3aXRoIHplcm8gY292ZXJpbmcgc3BhbiBcdTIwMTQgbWludXMgYC5zcGFuLyoqYCAoc3BhbiByZXBhaXJzXG4gKiByaWRlIHRoZSBzYW1lIGNvbW1pdCBhbmQgbXVzdCBuZXZlciBzZWxmLXRyaWdnZXIgdGhlIGdhdGUpIGFuZCBwYXRocyB0aGVcbiAqIHJlcG8ncyB1c2VyLW93bmVkIGAuc3Bhbi8uZ2F0ZWlnbm9yZWAgZXhjbHVkZXMgKGZhaWwtb3BlbiB3aGVuIGFic2VudC9cbiAqIHVucmVhZGFibGUpLiBTaGFyZWQgYnkgYGV2YWx1YXRlR2F0ZWAncyBgJ2VuZm9yY2UnYCBhbmQgYCdpbmZvcm0nYCBicmFuY2hlcyxcbiAqIHdoaWNoIGRpZmZlciBvbmx5IGluIHdoYXQgdGhleSBkbyB3aXRoIHRoZSByZXN1bHQgKGRlbnktb25jZSB2cy4gYW5cbiAqIGFsd2F5cy1mcmVzaCBhZHZpc29yeSkuXG4gKlxuICogQSBjaGFuZ2VzZXQgb2YgZmV3ZXIgdGhhbiB0d28gZmlsZXMgY2FuIG5ldmVyIGNhcnJ5IGFuIGltcGxpY2l0ICpjcm9zcy1maWxlKlxuICogZGVwZW5kZW5jeSBcdTIwMTQgZ2l0LXNwYW4gcmVjb3JkcyBjb3VwbGluZ3MgYmV0d2VlbiBmaWxlL2xpbmUgcmFuZ2VzIGFjcm9zc1xuICogZmlsZXMgXHUyMDE0IHNvIGEgc2luZ2xlLWZpbGUgKG9yIGVtcHR5KSBjaGFuZ2VzZXQgc2hvcnQtY2lyY3VpdHMgdG8gbm9cbiAqIHVuY292ZXJlZCBwYXRocyAoYW5kIG5vIGNvdmVyaW5nIHJvd3MpIHJhdGhlciB0aGFuIHByb21wdGluZyBmb3IgYSBjb3VwbGluZ1xuICogdGhhdCBjYW5ub3QgZXhpc3QuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGNvbXB1dGVVbmNvdmVyZWRQYXRocyhcbiAgcGF0aHM6IHN0cmluZ1tdLFxuICBjd2Q6IHN0cmluZyxcbiAgZXhlY3V0b3JzOiBHYXRlRXhlY3V0b3JzXG4pOiBQcm9taXNlPENoYW5nZXNldENvdmVyYWdlPiB7XG4gIGlmIChwYXRocy5sZW5ndGggPCAyKSByZXR1cm4geyB1bmNvdmVyZWQ6IFtdLCBjb3ZlcmluZzogW10gfTtcbiAgY29uc3QgY292ZXJpbmcgPSBhd2FpdCBleGVjdXRvcnMubGlzdChwYXRocywgY3dkKTtcbiAgY29uc3QgY292ZXJlZCA9IG5ldyBTZXQoY292ZXJpbmcubWFwKChyb3cpID0+IHJvdy5wYXRoKSk7XG4gIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gIGNvbnN0IGdhdGVJZ25vcmVSdWxlcyA9IHJlcG9Sb290ID8gbG9hZEdhdGVJZ25vcmUocmVwb1Jvb3QpIDogW107XG4gIGNvbnN0IHVuY292ZXJlZCA9IHBhdGhzLmZpbHRlcihcbiAgICAocGF0aCkgPT4gIWNvdmVyZWQuaGFzKHBhdGgpICYmICFpc0luc2lkZVNwYW5Sb290KHBhdGgpICYmICFpc0dhdGVJZ25vcmVkKGdhdGVJZ25vcmVSdWxlcywgcGF0aClcbiAgKTtcbiAgcmV0dXJuIHsgdW5jb3ZlcmVkLCBjb3ZlcmluZyB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERlYnQtc3RhdGUgZGlnZXN0IGFuZCByZWFzb24gcmVuZGVyaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBgcGF0aCNMc3RhcnQtTGVuZGAsIG9yIGEgYmFyZSBwYXRoIGZvciBhIHdob2xlLWZpbGUgYW5jaG9yLiBUeXBlZCBhZ2FpbnN0XG4gKiB0aGUgZmllbGRzIHNoYXJlZCBieSB7QGxpbmsgU3RhbGVQb3JjZWxhaW5Sb3d9IGFuZCB7QGxpbmsgUG9yY2VsYWluUm93fVxuICogKHJhdGhlciB0aGFuIGVpdGhlciBzcGVjaWZpY2FsbHkpIHNvIGJvdGggdGhlIHN0YWxlbmVzcy9lbnZpcm9ubWVudGFsXG4gKiByZW5kZXJlcnMgYW5kIHRoZSB1bmNvdmVyZWQtd3JpdGVzIHJlbGF0ZWQtc3BhbnMgc2VjdGlvbiAoe0BsaW5rXG4gKiBncm91cENvdmVyaW5nQnlOYW1lfSkgY2FuIGZvcm1hdCBhbiBhbmNob3IgdGhlIHNhbWUgd2F5LlxuICovXG5mdW5jdGlvbiBhbmNob3JUZXh0KHJvdzogeyBwYXRoOiBzdHJpbmc7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIH0pOiBzdHJpbmcge1xuICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIHJldHVybiByb3cucGF0aDtcbiAgcmV0dXJuIGAke3Jvdy5wYXRofSNMJHtyb3cuc3RhcnR9LUwke3Jvdy5lbmR9YDtcbn1cblxuLyoqXG4gKiBUaGUgZGlzdGluY3QtZGVidC1zdGF0ZSBkaWdlc3QgKGRlc2lnbi1kZWNpc2lvbnMubWQgIzkpOiBhIHN0YWJsZSBoYXNoIG9mIHRoZVxuICogc29ydGVkIHN0YWxlbmVzcyBmaW5kaW5ncyBwbHVzIHRoZSBzb3J0ZWQgdW5jb3ZlcmVkIHBhdGhzLiBQcmVzZW5jZSBpbiB0aGVcbiAqIG1lbW8gbWVhbnMgXCJ0aGlzIGV4YWN0IHN0YXRlIHdhcyBhbHJlYWR5IHByZXNlbnRlZCBvbmNlLlwiXG4gKi9cbmZ1bmN0aW9uIGdhdGVTdGF0ZURpZ2VzdChmaW5kaW5nczogU3RhbGVQb3JjZWxhaW5Sb3dbXSwgdW5jb3ZlcmVkOiBzdHJpbmdbXSk6IHN0cmluZyB7XG4gIGNvbnN0IGZpbmRpbmdLZXlzID0gZmluZGluZ3MubWFwKChyb3cpID0+IGAke3Jvdy5zdGF0dXN9XFx0JHtyb3cubmFtZX1cXHQke3Jvdy5wYXRofVxcdCR7cm93LnN0YXJ0fVxcdCR7cm93LmVuZH1gKS5zb3J0KCk7XG4gIGNvbnN0IHBheWxvYWQgPSBKU09OLnN0cmluZ2lmeSh7IGZpbmRpbmdzOiBmaW5kaW5nS2V5cywgdW5jb3ZlcmVkOiBbLi4udW5jb3ZlcmVkXS5zb3J0KCkgfSk7XG4gIHJldHVybiBjcmVhdGVIYXNoKCdzaGEyNTYnKS51cGRhdGUocGF5bG9hZCkuZGlnZXN0KCdoZXgnKTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIHRoaXMgZGVidC1zdGF0ZSBkaWdlc3QgaGFzIGFscmVhZHkgYmVlbiBleHBsYWluZWQgdG8gdGhlIGFnZW50IGluXG4gKiBmdWxsIFx1MjAxNCBvcnRob2dvbmFsIHRvIChhbmQgaW5kZXBlbmRlbnQgb2YpIHRoZSBlbmZvcmNlLW9ubHkgY29uc2lkZXItb25jZVxuICogZGVueSBjcmVkaXQgYGV2YWx1YXRlR2F0ZWAgcmVhZHMvd3JpdGVzIG9uIHRoZSBzYW1lIGBkaWdlc3RgIHZhbHVlIHVuZGVyIGl0c1xuICogb3duIGBzZWVuLWAtcHJlZml4ZWQga2V5LiBBIHNpbmdsZSBgZ2l0IHN0YXR1c2AvYGdpdCBhZGRgIHByZXZpZXcgYW5kIHRoZVxuICogYGdpdCBjb21taXRgL2BwdXNoYCB0aGF0IGZvbGxvd3MgaXQgbW9tZW50cyBsYXRlciByZXNvbHZlIHRvIHRoZSBzYW1lXG4gKiBkaWdlc3QgYnV0IHJlYWNoIGBldmFsdWF0ZUdhdGVgIHRocm91Z2ggZGlmZmVyZW50IG1vZGVzIChgJ2luZm9ybSdgIG5ldmVyXG4gKiB0b3VjaGVzIHRoZSBkZW55IGNyZWRpdCkuIFRoZSBnYXRlIGlzIGluZm9ybWF0aW9uYWwgXHUyMDE0IGEgYmFyZSByZXRyeSBhbHJlYWR5XG4gKiBnZXRzIHBhc3QgYSBkZW55IFx1MjAxNCBzbyBgZXZhbHVhdGVHYXRlYCBjb25zdWx0cyB0aGlzIFwic2VlblwiIGF4aXMgZGlyZWN0bHlcbiAqICh2aWEgYG1lbW9TdGF0ZS5oYXNgL2ByZWNvcmRgIG9uIHRoZSBgc2Vlbi1gIGtleSwgaW5saW5lLCBub3QgdGhyb3VnaCB0aGlzXG4gKiBoZWxwZXIpIGJlZm9yZSBhbiBlbmZvcmNlIGRlbnk6IGFscmVhZHkgc2VlbiBcdTIxOTIgcmVzb2x2ZSBzdHJhaWdodCB0b1xuICogYGFsbG93YC9gYWxyZWFkeS1wcmVzZW50ZWRgIGluc3RlYWQgb2YgZGVueWluZyBhIHN0YXRlIHRoZSBhZ2VudCBoYXNcbiAqIGFscmVhZHkgYmVlbiBzaG93bi4gYHdhc0FscmVhZHlTZWVuYCBpdHNlbGYgcmVtYWlucyBmb3IgYCdpbmZvcm0nYCBtb2RlLFxuICogd2hlcmUgYSByZXBlYXRlZCBwcmV2aWV3IG9mIHRoZSBzYW1lIHN0YXRlIHN0aWxsIHJlbmRlcnMgYSBjb25kZW5zZWRcbiAqIHJlbWluZGVyIHJhdGhlciB0aGFuIHRoZSBmdWxsIGNoZWNrbGlzdCB0d2ljZS5cbiAqL1xuZnVuY3Rpb24gd2FzQWxyZWFkeVNlZW4obWVtb1N0YXRlOiBHYXRlTWVtb1N0YXRlLCBkaWdlc3Q6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBjb25zdCBzZWVuS2V5ID0gYHNlZW4tJHtkaWdlc3R9YDtcbiAgY29uc3QgYWxyZWFkeSA9IG1lbW9TdGF0ZS5oYXMoc2VlbktleSk7XG4gIG1lbW9TdGF0ZS5yZWNvcmQoc2VlbktleSk7XG4gIHJldHVybiBhbHJlYWR5O1xufVxuXG4vKipcbiAqIEZldGNoIHRoZSBodW1hbi1mb3JtYXQgYCMjIDxuYW1lPmAgYmxvY2tzIGZvciB0aGUgc3BhbnMgbmFtZWQgaW4gYHJvd3NgLFxuICogZmFpbGluZyB0byBgJydgIChuZXZlciB0aHJvd2luZykgc28gYSBsaXN0IGZhaWx1cmUgY2FuIG5ldmVyIHR1cm4gYSBkZW55XG4gKiBpbnRvIGEgc2lsZW50IGFsbG93IHZpYSB7QGxpbmsgZXZhbHVhdGVHYXRlfSdzIG91dGVyIGNhdGNoIFx1MjAxNFxuICoge0BsaW5rIGFubm90YXRlQmxvY2tzfSBzeW50aGVzaXplcyBtaW5pbWFsIGJsb2NrcyBmcm9tIHRoZSByb3dzIGluc3RlYWQsIGFuZFxuICoge0BsaW5rIHJlbmRlclJlbGF0ZWRTcGFuc1NlY3Rpb259IHNpbXBseSBvbWl0cyBhIGB3aHlgIHNlbnRlbmNlIGl0IGNhbid0XG4gKiBmaW5kLiBUeXBlZCBhZ2FpbnN0IGB7IG5hbWU6IHN0cmluZyB9YCAocmF0aGVyIHRoYW4ge0BsaW5rIFN0YWxlUG9yY2VsYWluUm93fVxuICogc3BlY2lmaWNhbGx5KSBzbyBib3RoIHRoZSBzdGFsZW5lc3MvZW52aXJvbm1lbnRhbCByZW5kZXJlcnMgYW5kIHRoZVxuICogdW5jb3ZlcmVkLXdyaXRlcyByZWxhdGVkLXNwYW5zIHNlY3Rpb24gY2FuIHNoYXJlIHRoaXMgb25lIGZldGNoLlxuICovXG5hc3luYyBmdW5jdGlvbiBmZXRjaFNwYW5CbG9ja3MoZXhlY3V0b3JzOiBHYXRlRXhlY3V0b3JzLCByb3dzOiB7IG5hbWU6IHN0cmluZyB9W10sIGN3ZDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgbmFtZXMgPSBbLi4ubmV3IFNldChyb3dzLm1hcCgocm93KSA9PiByb3cubmFtZSkpXS5zb3J0KCk7XG4gIGlmIChuYW1lcy5sZW5ndGggPT09IDApIHJldHVybiAnJztcbiAgdHJ5IHtcbiAgICByZXR1cm4gYXdhaXQgZXhlY3V0b3JzLmxpc3RCbG9ja3MobmFtZXMsIGN3ZCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnJztcbiAgfVxufVxuXG4vKipcbiAqIFB1bGwgb25lIHNwYW4ncyBgd2h5YCBwYXJhZ3JhcGggb3V0IG9mIGBibG9ja3NUZXh0YCAodGhlIGBnaXQgc3BhbiBsaXN0XG4gKiA8bmFtZXMuLi4+YCBodW1hbiBmb3JtYXQge0BsaW5rIGZldGNoU3BhbkJsb2Nrc30gcmV0dXJucykgXHUyMDE0IGV2ZXJ5dGhpbmdcbiAqIGFmdGVyIGBuYW1lYCdzIGFuY2hvciBidWxsZXRzLCB1cCB0byB0aGUgbmV4dCBgLS0tYC1zZXBhcmF0ZWQgYmxvY2sgb3IgdGhlXG4gKiBlbmQgb2YgdGhlIHRleHQuIFJldHVybnMgYCcnYCB3aGVuIHRoZSBibG9jayBpc24ndCBmb3VuZCBvciB0aGUgc3BhblxuICogc2ltcGx5IGhhcyBubyBgd2h5YCByZWNvcmRlZCAodGhlIENMSSBvbWl0cyBpdCBlbnRpcmVseSByYXRoZXIgdGhhblxuICogcHJpbnRpbmcgYW4gZW1wdHkgbGluZSBcdTIwMTQgc2VlIGByZW5kZXJfbGlzdF9ibG9ja2AgaW4gYGNsaS9zaG93LnJzYCkuXG4gKi9cbmZ1bmN0aW9uIGV4dHJhY3RXaHkoYmxvY2tzVGV4dDogc3RyaW5nLCBuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gYmxvY2tzVGV4dC50cmltKCk7XG4gIGlmICh0cmltbWVkLmxlbmd0aCA9PT0gMCkgcmV0dXJuICcnO1xuICBmb3IgKGNvbnN0IGJsb2NrIG9mIHRyaW1tZWQuc3BsaXQoJ1xcblxcbi0tLVxcblxcbicpKSB7XG4gICAgY29uc3QgbGluZXMgPSBibG9jay5zcGxpdCgnXFxuJyk7XG4gICAgaWYgKGxpbmVzWzBdICE9PSBgIyMgJHtuYW1lfWApIGNvbnRpbnVlO1xuICAgIGxldCBpID0gMTtcbiAgICB3aGlsZSAoaSA8IGxpbmVzLmxlbmd0aCAmJiAobGluZXNbaV0uc3RhcnRzV2l0aCgnLSAnKSB8fCBsaW5lc1tpXSA9PT0gJypTcGFuIGhhcyBubyBhbmNob3JzKicpKSBpKys7XG4gICAgaWYgKGxpbmVzW2ldID09PSAnJykgaSsrO1xuICAgIHJldHVybiBsaW5lcy5zbGljZShpKS5qb2luKCdcXG4nKS50cmltKCk7XG4gIH1cbiAgcmV0dXJuICcnO1xufVxuXG4vKipcbiAqIENvbGxhcHNlIHJvd3MgdGhhdCBuYW1lIHRoZSBzYW1lIGFuY2hvciBhZGRyZXNzIGludG8gb25lIGVudHJ5LCBjb21iaW5pbmdcbiAqIHRoZWlyIGRpc3RpbmN0IHN0YXR1c2VzIChzb3J0ZWQpIGFuZCBwcmVzZXJ2aW5nIGZpcnN0LXNlZW4gb3JkZXIuIFRoZSBDTEknc1xuICogYHN0YWxlIC0tZm9ybWF0IHBvcmNlbGFpbmAgZW1pdHMgb25lIHJvdyBwZXIgKmRyaWZ0aW5nIGxheWVyKiBmb3IgYSBzaW5nbGVcbiAqIGFuY2hvciAoZS5nLiBib3RoIHdvcmt0cmVlIGFuZCBpbmRleCBjaGFuZ2VkKSBcdTIwMTQgYSBkaXN0aW5jdGlvbiB0aGUgYHNyY2BcbiAqIGNvbHVtbiBjYXJyaWVzIGJ1dCB7QGxpbmsgcGFyc2VTdGFsZVBvcmNlbGFpbn0gZGVsaWJlcmF0ZWx5IGRyb3BzIFx1MjAxNCBzb1xuICogd2l0aG91dCB0aGlzIGNvbGxhcHNlIHRoZSBzYW1lIGFuY2hvciB3b3VsZCBvdGhlcndpc2UgcmVuZGVyIGFzIHR3byAob3JcbiAqIG1vcmUpIGlkZW50aWNhbCBidWxsZXRzIGluc3RlYWQgb2Ygb25lIGJ1bGxldCB3aXRoIGV2ZXJ5IHN0YXR1cyBpdCBlYXJuZWQuXG4gKi9cbmZ1bmN0aW9uIGRlZHVwZUJ5QW5jaG9yKHJvd3M6IFN0YWxlUG9yY2VsYWluUm93W10pOiB7IGFkZHI6IHN0cmluZzsgc3RhdHVzZXM6IFBvcmNlbGFpblN0YXR1c1tdIH1bXSB7XG4gIGNvbnN0IG9yZGVyOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBieUFkZHIgPSBuZXcgTWFwPHN0cmluZywgU2V0PFBvcmNlbGFpblN0YXR1cz4+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBjb25zdCBhZGRyID0gYW5jaG9yVGV4dChyb3cpO1xuICAgIGxldCBzdGF0dXNlcyA9IGJ5QWRkci5nZXQoYWRkcik7XG4gICAgaWYgKCFzdGF0dXNlcykge1xuICAgICAgc3RhdHVzZXMgPSBuZXcgU2V0KCk7XG4gICAgICBieUFkZHIuc2V0KGFkZHIsIHN0YXR1c2VzKTtcbiAgICAgIG9yZGVyLnB1c2goYWRkcik7XG4gICAgfVxuICAgIHN0YXR1c2VzLmFkZChyb3cuc3RhdHVzKTtcbiAgfVxuICByZXR1cm4gb3JkZXIubWFwKChhZGRyKSA9PiAoeyBhZGRyLCBzdGF0dXNlczogWy4uLihieUFkZHIuZ2V0KGFkZHIpID8/IFtdKV0uc29ydCgpIH0pKTtcbn1cblxuLyoqXG4gKiBBbm5vdGF0ZSBgZ2l0IHNwYW4gbGlzdGAgaHVtYW4gYmxvY2tzIHdpdGggcGVyLWFuY2hvciBkcmlmdCBsYWJlbHM6IGVhY2hcbiAqIGJ1bGxldCB3aG9zZSBhbmNob3IgbWF0Y2hlcyBhIGZpbmRpbmcgZ2FpbnMgYCBcdTIwMTQgPGxhYmVsPmAuIEJ1bGxldHMgYXJlIG9ubHlcbiAqIHRoZSBjb250aWd1b3VzIGAtIGAgcnVuIGRpcmVjdGx5IHVuZGVyIGEgYCMjIDxuYW1lPmAgaGVhZGVyLCBzbyBhXG4gKiBkZXNjcmlwdGlvbiBsaW5lIHRoYXQgaGFwcGVucyB0byBzdGFydCB3aXRoIGAtIGAgaXMgbmV2ZXIgYW5ub3RhdGVkLlxuICogRmluZGluZ3Mgd2hvc2UgYW5jaG9yIGhhcyBubyBtYXRjaGluZyBidWxsZXQgYXJlIGFwcGVuZGVkIHRvIHRoZWlyIHNwYW4nc1xuICogYnVsbGV0IHJ1bjsgc3BhbnMgYWJzZW50IGZyb20gYGJsb2Nrc1RleHRgIGVudGlyZWx5IChvciBhbiBlbXB0eS9mYWlsZWRcbiAqIGxpc3QgcmVhZCkgZ2V0IGEgc3ludGhlc2l6ZWQgbWluaW1hbCBibG9jayBcdTIwMTQgbm8gZmluZGluZyBpcyBldmVyIGRyb3BwZWQuXG4gKiBFdmVyeSBmaW5kaW5nIG1hdGNoaW5nIChvciBhcHBlbmRlZCBmb3IpIGEgZ2l2ZW4gYW5jaG9yIGFkZHJlc3MgaXNcbiAqIGNvbGxhcHNlZCB2aWEge0BsaW5rIGRlZHVwZUJ5QW5jaG9yfSBmaXJzdCwgc28gYSBzaW5nbGUgYW5jaG9yIG5ldmVyXG4gKiByZW5kZXJzIGFzIG1vcmUgdGhhbiBvbmUgYnVsbGV0IHJlZ2FyZGxlc3Mgb2YgaG93IG1hbnkgZHJpZnRpbmctbGF5ZXIgcm93c1xuICogdGhlIENMSSBlbWl0dGVkIGZvciBpdC5cbiAqL1xuZnVuY3Rpb24gYW5ub3RhdGVCbG9ja3MoYmxvY2tzVGV4dDogc3RyaW5nLCByb3dzOiBTdGFsZVBvcmNlbGFpblJvd1tdKTogc3RyaW5nIHtcbiAgY29uc3QgcmVtYWluaW5nID0gbmV3IE1hcDxzdHJpbmcsIFN0YWxlUG9yY2VsYWluUm93W10+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBjb25zdCBncm91cCA9IHJlbWFpbmluZy5nZXQocm93Lm5hbWUpO1xuICAgIGlmIChncm91cCkgZ3JvdXAucHVzaChyb3cpO1xuICAgIGVsc2UgcmVtYWluaW5nLnNldChyb3cubmFtZSwgW3Jvd10pO1xuICB9XG5cbiAgY29uc3Qgb3V0OiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgcGVuZGluZzogU3RhbGVQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBsZXQgaW5CdWxsZXRzID0gZmFsc2U7XG4gIGNvbnN0IGNsb3NlQnVsbGV0cyA9ICgpOiB2b2lkID0+IHtcbiAgICBmb3IgKGNvbnN0IHsgYWRkciwgc3RhdHVzZXMgfSBvZiBkZWR1cGVCeUFuY2hvcihwZW5kaW5nKSkge1xuICAgICAgb3V0LnB1c2goYC0gJHthZGRyfSBcdTIwMTQgJHtzdGF0dXNlcy5tYXAoaHVtYW5TdGF0dXNMYWJlbCkuam9pbignLCAnKX1gKTtcbiAgICB9XG4gICAgcGVuZGluZyA9IFtdO1xuICAgIGluQnVsbGV0cyA9IGZhbHNlO1xuICB9O1xuXG4gIGNvbnN0IHRyaW1tZWQgPSBibG9ja3NUZXh0LnRyaW0oKTtcbiAgaWYgKHRyaW1tZWQubGVuZ3RoID4gMCkge1xuICAgIGZvciAoY29uc3QgbGluZSBvZiB0cmltbWVkLnNwbGl0KCdcXG4nKSkge1xuICAgICAgY29uc3QgaGVhZGVyID0gL14jIyAoLispJC8uZXhlYyhsaW5lKTtcbiAgICAgIGlmIChoZWFkZXIpIHtcbiAgICAgICAgY2xvc2VCdWxsZXRzKCk7XG4gICAgICAgIG91dC5wdXNoKGxpbmUpO1xuICAgICAgICBwZW5kaW5nID0gcmVtYWluaW5nLmdldChoZWFkZXJbMV0pID8/IFtdO1xuICAgICAgICByZW1haW5pbmcuZGVsZXRlKGhlYWRlclsxXSk7XG4gICAgICAgIGluQnVsbGV0cyA9IHRydWU7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGluQnVsbGV0cyAmJiBsaW5lLnN0YXJ0c1dpdGgoJy0gJykpIHtcbiAgICAgICAgY29uc3QgYWRkciA9IGxpbmUuc2xpY2UoMik7XG4gICAgICAgIGNvbnN0IGV4YWN0ID0gcGVuZGluZy5maWx0ZXIoKHJvdykgPT4gYW5jaG9yVGV4dChyb3cpID09PSBhZGRyKTtcbiAgICAgICAgY29uc3QgbWF0Y2hlZCA9XG4gICAgICAgICAgZXhhY3QubGVuZ3RoID4gMCA/IGV4YWN0IDogcGVuZGluZy5maWx0ZXIoKHJvdykgPT4gYWRkciA9PT0gcm93LnBhdGggfHwgYWRkci5zdGFydHNXaXRoKGAke3Jvdy5wYXRofSNgKSk7XG4gICAgICAgIGlmIChtYXRjaGVkLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjb25zdCBtYXRjaGVkU2V0ID0gbmV3IFNldChtYXRjaGVkKTtcbiAgICAgICAgICBwZW5kaW5nID0gcGVuZGluZy5maWx0ZXIoKHJvdykgPT4gIW1hdGNoZWRTZXQuaGFzKHJvdykpO1xuICAgICAgICAgIGNvbnN0IHN0YXR1c2VzID0gWy4uLm5ldyBTZXQobWF0Y2hlZC5tYXAoKHJvdykgPT4gcm93LnN0YXR1cykpXS5zb3J0KCk7XG4gICAgICAgICAgb3V0LnB1c2goYCR7bGluZX0gXHUyMDE0ICR7c3RhdHVzZXMubWFwKGh1bWFuU3RhdHVzTGFiZWwpLmpvaW4oJywgJyl9YCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgb3V0LnB1c2gobGluZSk7XG4gICAgICAgIH1cbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoaW5CdWxsZXRzKSBjbG9zZUJ1bGxldHMoKTtcbiAgICAgIG91dC5wdXNoKGxpbmUpO1xuICAgIH1cbiAgICBjbG9zZUJ1bGxldHMoKTtcbiAgfVxuXG4gIGZvciAoY29uc3QgW25hbWUsIGdyb3VwXSBvZiByZW1haW5pbmcpIHtcbiAgICBpZiAob3V0Lmxlbmd0aCA+IDApIG91dC5wdXNoKCcnLCAnLS0tJywgJycpO1xuICAgIG91dC5wdXNoKGAjIyAke25hbWV9YCk7XG4gICAgZm9yIChjb25zdCB7IGFkZHIsIHN0YXR1c2VzIH0gb2YgZGVkdXBlQnlBbmNob3IoZ3JvdXApKSB7XG4gICAgICBvdXQucHVzaChgLSAke2FkZHJ9IFx1MjAxNCAke3N0YXR1c2VzLm1hcChodW1hblN0YXR1c0xhYmVsKS5qb2luKCcsICcpfWApO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBvdXQuam9pbignXFxuJyk7XG59XG5cbi8qKlxuICogVGhlIGZ1bGwtc3BhbiBjaGVja2xpc3QgYSBzZW1hbnRpYy1zdGFsZW5lc3MgYGRlbnlgIChvciwgaW4gYCdpbmZvcm0nYCBtb2RlLFxuICogYSBgc3RhdHVzYCBhZHZpc29yeSkgcmVuZGVycyBpbnRvIGByZWFzb25gLiBUaGUgY2xvc2luZyBzZW50ZW5jZSBkcm9wcyBcIlx1MjAxNFxuICogdGhlbiByZXRyeVwiIGluIGAnaW5mb3JtJ2AgbW9kZTogYSBgc3RhdHVzYCBjaGVjayBuZXZlciBoZWxkIGFueXRoaW5nLCBzb1xuICogdGhlcmUgaXMgbm90aGluZyB0byByZXRyeS5cbiAqL1xuZnVuY3Rpb24gcmVuZGVyU3RhbGVuZXNzUmVhc29uKFxuICBmaW5kaW5nczogU3RhbGVQb3JjZWxhaW5Sb3dbXSxcbiAgYmxvY2tzVGV4dDogc3RyaW5nLFxuICBtb2RlOiBHYXRlTW9kZSA9ICdlbmZvcmNlJyxcbiAgYWxyZWFkeVNlZW4gPSBmYWxzZVxuKTogc3RyaW5nIHtcbiAgY29uc3QgbmFtZXMgPSBbLi4ubmV3IFNldChmaW5kaW5ncy5tYXAoKHJvdykgPT4gcm93Lm5hbWUpKV07XG4gIGNvbnN0IHN1YmplY3QgPSBuYW1lcy5sZW5ndGggPT09IDEgPyAnYW4gaW1wbGljaXQgZGVwZW5kZW5jeScgOiAnaW1wbGljaXQgZGVwZW5kZW5jaWVzJztcbiAgY29uc3QgbmFtZSA9IG5hbWVzLmxlbmd0aCA9PT0gMSA/IG5hbWVzWzBdIDogJzxuYW1lPic7XG4gIGNvbnN0IGFjdGlvbiA9IGBcXGBnaXQgc3BhbiBhZGQgJHtuYW1lfSA8cGF0aCNMc3RhcnQtTGVuZD5cXGAgLyBcXGBnaXQgc3BhbiB3aHkgJHtuYW1lfSBcIi4uLlwiXFxgYDtcbiAgaWYgKGFscmVhZHlTZWVuKSB7XG4gICAgY29uc3QgcGF0aHMgPSBbLi4ubmV3IFNldChmaW5kaW5ncy5tYXAoKHJvdykgPT4gcm93LnBhdGgpKV07XG4gICAgY29uc3QgY2xvc2luZyA9IGBBbHJlYWR5IGZsYWdnZWQgYWJvdmUgXHUyMDE0IHVwZGF0ZSB0aGUgZHJpZnRlZCBsb2NhdGlvbnMgb3IgdGhlIGRlc2NyaXB0aW9uLmA7XG4gICAgcmV0dXJuIFtgVGhpcyBjaGFuZ2Ugc3RpbGwgbGVhdmVzICR7c3ViamVjdH0gb3V0IG9mIGRhdGU6YCwgLi4ucGF0aHMubWFwKChwYXRoKSA9PiBgLSAke3BhdGh9YCksICcnLCBjbG9zaW5nXS5qb2luKFxuICAgICAgJ1xcbidcbiAgICApO1xuICB9XG4gIGNvbnN0IGNsb3NpbmcgPVxuICAgIG1vZGUgPT09ICdlbmZvcmNlJ1xuICAgICAgPyBgVXBkYXRlIHRoZSBkcmlmdGVkIGxvY2F0aW9ucyBvciB0aGUgZGVzY3JpcHRpb24gXHUyMDE0ICR7YWN0aW9ufSBcdTIwMTQgdGhlbiByZXRyeS4gSWYgYSBkZXBlbmRlbmN5IG5vIGxvbmdlciBob2xkcywgdGVsbCB0aGUgdXNlciBpbnN0ZWFkLmBcbiAgICAgIDogYFVwZGF0ZSB0aGUgZHJpZnRlZCBsb2NhdGlvbnMgb3IgdGhlIGRlc2NyaXB0aW9uIFx1MjAxNCAke2FjdGlvbn0uIElmIGEgZGVwZW5kZW5jeSBubyBsb25nZXIgaG9sZHMsIHRlbGwgdGhlIHVzZXIgaW5zdGVhZC5gO1xuICByZXR1cm4gW1xuICAgIGBUaGlzIGNoYW5nZSBsZWF2ZXMgJHtzdWJqZWN0fSBvdXQgb2YgZGF0ZTpgLFxuICAgICcnLFxuICAgIGFubm90YXRlQmxvY2tzKGJsb2Nrc1RleHQsIGZpbmRpbmdzKSxcbiAgICAnJyxcbiAgICAnLS0tJyxcbiAgICAnJyxcbiAgICBjbG9zaW5nXG4gIF0uam9pbignXFxuJyk7XG59XG5cbi8qKlxuICogV3JhcCBgdGV4dGAgZm9yIGRlbGl2ZXJ5IGFzIGEgaGFybmVzcydzIGBhZGRpdGlvbmFsQ29udGV4dGAsIHNvIGV2ZXJ5IHN1Y2hcbiAqIHBheWxvYWQgdGhpcyBnYXRlIGVtaXRzIHNpdHMgaW5zaWRlIGEgYDxnaXQtc3Bhbj4uLi48L2dpdC1zcGFuPmAgYmxvY2sgXHUyMDE0XG4gKiBtYXRjaGluZyB0aGUgdG91Y2ggaG9vaydzIGJsb2NrIHN0eWxpbmcgXHUyMDE0IG5ldmVyIGJhcmUgcHJvc2UuIEEgbm8tb3Agd2hlblxuICogYHRleHRgIGFscmVhZHkgY2FycmllcyBhIGA8Z2l0LXNwYW4+YCB0YWcgc29tZXdoZXJlIChlLmcuXG4gKiB7QGxpbmsgcmVuZGVyVW5jb3ZlcmVkUmVhc29ufSdzIG91dHB1dCBhbHJlYWR5IHdyYXBzIGl0c2VsZiksIHNvIGEgY2FsbGVyXG4gKiBjYW4gYXBwbHkgdGhpcyB1bmNvbmRpdGlvbmFsbHkgd2l0aG91dCBldmVyIG5lc3Rpbmcgb25lIGJsb2NrIGluc2lkZVxuICogYW5vdGhlci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHdyYXBHaXRTcGFuQ29udGV4dCh0ZXh0OiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAodGV4dC5pbmNsdWRlcygnPGdpdC1zcGFuPicpKSByZXR1cm4gdGV4dDtcbiAgcmV0dXJuIGA8Z2l0LXNwYW4+XFxuJHt0ZXh0fVxcbjwvZ2l0LXNwYW4+YDtcbn1cblxuLyoqXG4gKiBUaGUgYWR2aXNvcnkgc3VyZmFjZWQgd2hlbiB0aGUgY2hhbmdlc2V0J3Mgb25seSBzdGFsZW5lc3MgaXMgZW52aXJvbm1lbnRhbCBcdTIwMTRcbiAqIHRoZSBnYXRlIGFsbG93cyBidXQgc2F5cyB3aHksIHNvIHRoZSB1bnJlc29sdmFibGUgY29uZGl0aW9uIGlzIG5vdCBzaWxlbnRseVxuICogc3dhbGxvd2VkLlxuICovXG5mdW5jdGlvbiByZW5kZXJFbnZpcm9ubWVudGFsUmVhc29uKGNvbmRpdGlvbnM6IFN0YWxlUG9yY2VsYWluUm93W10sIGJsb2Nrc1RleHQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBbXG4gICAgJ0NvdWxkIG5vdCBjaGVjayB0aGVzZSBpbXBsaWNpdCBkZXBlbmRlbmNpZXMgKHVuZmV0Y2hlZCBMRlMsIHNwYXJzZSBjaGVja291dCwgb3Igc2ltaWxhcikgXHUyMDE0IG5vdCBibG9ja2luZzonLFxuICAgICcnLFxuICAgIGFubm90YXRlQmxvY2tzKGJsb2Nrc1RleHQsIGNvbmRpdGlvbnMpLFxuICAgICcnLFxuICAgICctLS0nLFxuICAgICcnLFxuICAgICdGaXggdGhlIGNoZWNrb3V0L2ZldGNoIGlzc3VlIGlmIHRoZXNlIGRlcGVuZGVuY2llcyBuZWVkIHZlcmlmeWluZy4nXG4gIF0uam9pbignXFxuJyk7XG59XG5cbi8qKlxuICogVGhlIGFkdmlzb3J5IGFuIGBhbGxvd2AvYHNjYW4tZmFpbGVkYCByZXN1bHQgcmVuZGVycyBpbnRvIGByZWFzb25gOiB0aGUgc2NhblxuICogY291bGQgbm90IGNvbXBsZXRlLCBzbyB0aGUgY2hhbmdlc2V0IHdhcyBOT1QgdmVyaWZpZWQgXHUyMDE0IGJ1dCB0aGUgY29tbWFuZFxuICogcHJvY2VlZHMgYW55d2F5IChmYWlsLW9wZW4sIG1hdGNoaW5nIGBlbnZpcm9ubWVudGFsYCkuXG4gKi9cbmZ1bmN0aW9uIHJlbmRlclNjYW5GYWlsZWRSZWFzb24oZGV0YWlsOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gW1xuICAgICdUaGUgaW1wbGljaXQtZGVwZW5kZW5jeSBjaGVjayBjb3VsZCBub3QgcnVuLCBzbyB0aGlzIGNoYW5nZSB3YXMgTk9UIHZlcmlmaWVkOicsXG4gICAgYCAgJHtkZXRhaWx9YCxcbiAgICAnJyxcbiAgICAnVGhlIGNvbW1hbmQgcHJvY2VlZHMgYW55d2F5LiBGaXggdGhlIHNjYW4gZXJyb3IgaWYgdmVyaWZpY2F0aW9uIG1hdHRlcnMgZm9yIHRoaXMgY2hhbmdlLidcbiAgXS5qb2luKCdcXG4nKTtcbn1cblxuLyoqXG4gKiBNb3N0IHNwYW5zIHRoZSByZWxhdGVkLXNwYW5zIHNlY3Rpb24gbGlzdHMgYmVmb3JlIGl0IHRydW5jYXRlcy4gQ2hvc2VuIGZyb21cbiAqIHRoZSB0YWlsIG9mIHRoaXMgcmVwb3NpdG9yeSdzIG1lYXN1cmVkIGRpc3RyaWJ1dGlvbiAobWVkaWFuIDIgcXVhbGlmeWluZ1xuICogc3BhbnMsIHA5MCA3LCBwOTkgMTUsIG1heCA0MSkgcmF0aGVyIHRoYW4gdG8gbWF4aW1pemUgYSBoaXQgcmF0ZTogaXQgZW5nYWdlc1xuICogb24gNSUgb2YgcmVhbCByZW5kZXJpbmcgb3Bwb3J0dW5pdGllcywgd2hlcmUgYSB0aWdodGVyIGNhcCB3b3VsZCBkcm9wIHRoZVxuICogc3BhbiB0aGUgcmVhZGVyIGFjdHVhbGx5IHdhbnRlZCBmYXIgdG9vIG9mdGVuIChOPTUgZHJvcHMgaXQgaW4gMjUlIG9mXG4gKiBub24tYnVsayBjYXNlcywgTj0zIGluIDQwJSkuXG4gKi9cbmNvbnN0IFJFTEFURURfU1BBTlNfQ0FQID0gODtcblxuLyoqIERpcmVjdG9yeSBjb21wb25lbnRzIG9mIGEgcmVwby1yZWxhdGl2ZSBwb3NpeCBwYXRoIChiYXNlbmFtZSBkcm9wcGVkKS4gKi9cbmZ1bmN0aW9uIGRpclBhcnRzKHBhdGg6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgcGFydHMgPSBwYXRoLnNwbGl0KCcvJyk7XG4gIHBhcnRzLnBvcCgpO1xuICByZXR1cm4gcGFydHM7XG59XG5cbi8qKlxuICogTm9ybWFsaXplZCBkaXJlY3RvcnkgcHJveGltaXR5IG9mIHR3byByZXBvLXJlbGF0aXZlIHBhdGhzLCBpbiBgWzAsMV1gOlxuICogc2hhcmVkIGxlYWRpbmcgZGlyZWN0b3J5IGNvbXBvbmVudHMgb3ZlciB0aGUgZGVlcGVyIHBhdGgncyBkaXJlY3RvcnkgZGVwdGguXG4gKiBgMWAgaXMgdGhlIHNhbWUgZGlyZWN0b3J5IChpbmNsdWRpbmcgdHdvIHJlcG8tcm9vdCBmaWxlcywgd2hpY2ggc2hhcmUgYVxuICogZGVwdGggb2YgemVybyBvdXQgb2YgemVybyk7IGAwYCBpcyBub3RoaW5nIGluIGNvbW1vbiBiZWxvdyB0aGUgcm9vdC5cbiAqL1xuZnVuY3Rpb24gcGF0aFByb3hpbWl0eShhOiBzdHJpbmcsIGI6IHN0cmluZyk6IG51bWJlciB7XG4gIGNvbnN0IHggPSBkaXJQYXJ0cyhhKTtcbiAgY29uc3QgeSA9IGRpclBhcnRzKGIpO1xuICBsZXQgc2hhcmVkID0gMDtcbiAgd2hpbGUgKHNoYXJlZCA8IHgubGVuZ3RoICYmIHNoYXJlZCA8IHkubGVuZ3RoICYmIHhbc2hhcmVkXSA9PT0geVtzaGFyZWRdKSBzaGFyZWQrKztcbiAgY29uc3QgZGVlcGVzdCA9IE1hdGgubWF4KHgubGVuZ3RoLCB5Lmxlbmd0aCk7XG4gIGlmIChkZWVwZXN0ID09PSAwKSByZXR1cm4gMTtcbiAgcmV0dXJuIHNoYXJlZCAvIGRlZXBlc3Q7XG59XG5cbi8qKlxuICogR3JvdXAgYGNvdmVyaW5nYCBcdTIwMTQgdGhlIHJvd3Mge0BsaW5rIGNvbXB1dGVVbmNvdmVyZWRQYXRoc30gYWxyZWFkeSByZXNvbHZlZFxuICogZm9yIHRoZSByZXN0IG9mIHRoZSBjaGFuZ2VzZXQgXHUyMDE0IGJ5IHNwYW4gbmFtZSwgZWFjaCBhbmNob3IgcmVuZGVyZWQgdmlhXG4gKiB7QGxpbmsgYW5jaG9yVGV4dH0uIE9ubHkgYW5jaG9ycyB3aG9zZSBgcGF0aGAgaXMgb25lIG9mIHRoZSBwYXRoc1xuICogYGV4ZWN1dG9ycy5saXN0YCB3YXMgc2NvcGVkIHRvIGFwcGVhciBoZXJlOyBhIHNwYW4ncyAqb3RoZXIqIGFuY2hvcnMgKGluXG4gKiBmaWxlcyBvdXRzaWRlIHRoaXMgY2hhbmdlc2V0KSBuZXZlciBkbywgc2luY2UgYGNvdmVyaW5nYCBuZXZlciBjb250YWluZWRcbiAqIHRoZW0gdG8gYmVnaW4gd2l0aC4gRGVkdXBlZDogdHdvIGNvdmVyZWQgZmlsZXMgdW5kZXIgdGhlIHNhbWUgbmFtZSBjb2xsYXBzZVxuICogdG8gb25lIGVudHJ5IGVhY2gsIGFuY2hvcnMgd2l0aGluIGEgbmFtZSBzdGF5aW5nIGFscGhhYmV0aWNhbC5cbiAqXG4gKiBHcm91cHMgYXJlIG9yZGVyZWQgYnkgcmVsZXZhbmNlIHRvIHRoZSAqdW5jb3ZlcmVkKiBwYXRocywgYmVzdCBmaXJzdCwgb25cbiAqIHRocmVlIGtleXM6XG4gKlxuICogMS4gKipDby1vY2N1cnJlbmNlLCBkZXNjZW5kaW5nKiogXHUyMDE0IGRpc3RpbmN0IGNoYW5nZXNldCBwYXRocyB0aGUgc3BhblxuICogICAgY292ZXJzLiBNZWFzdXJlZCBhZ2FpbnN0IHRoaXMgcmVwb3NpdG9yeSdzIGhpc3RvcnkgaXQgaXMgdGhlIG9ubHkgc2lnbmFsXG4gKiAgICB0aGF0IGNhcnJpZWQgYSByZWFsIHdpbiAoMjguOCUgdnMuIGFscGhhYmV0aWNhbCdzIDE1LjAlIHRvcC0xIG9uIGFcbiAqICAgIGxlYXZlLW9uZS1vdXQgZXZhbHVhdGlvbiksIHNvIHRoZSBzcGFuIGNvdmVyaW5nIHRoZSBtb3N0IG9mIHdoYXQganVzdFxuICogICAgY2hhbmdlZCBsZWFkcy5cbiAqIDIuICoqUGF0aCBwcm94aW1pdHksIGRlc2NlbmRpbmcqKiBcdTIwMTQgdGhlIGNsb3Nlc3QgYW55IG9mIHRoZSBzcGFuJ3NcbiAqICAgIGluLWNoYW5nZXNldCBhbmNob3JzIGdldHMgdG8gYW55IHVuY292ZXJlZCBwYXRoLCBwZXJcbiAqICAgIHtAbGluayBwYXRoUHJveGltaXR5fS4gQSBzbWFsbCBidXQgcmVhbCBjb250cmlidXRpb24sIGFuZCBmcmVlOiBubyBkYXRhXG4gKiAgICBiZXlvbmQgYGNvdmVyaW5nYCBhbmQgYHVuY292ZXJlZGAgaXMgY29uc3VsdGVkLlxuICogMy4gKipTcGFuIG5hbWUsIGFzY2VuZGluZyoqIFx1MjAxNCB0aGUgZm9ybWVyIHNvbGUgb3JkZXJpbmcsIGtlcHQgcHVyZWx5IGFzIHRoZVxuICogICAgZGV0ZXJtaW5pc20gdGllLWJyZWFrLCBzbyBpZGVudGljYWwgc3RhdGUgYWx3YXlzIHJlbmRlcnMgaWRlbnRpY2FsbHkgYW5kXG4gKiAgICBhIHJldHJ5IG5ldmVyIHJlc2h1ZmZsZXMgdGhlIGxpc3QgdW5kZXIgdGhlIHJlYWRlci5cbiAqXG4gKiBBbmNob3IgKmNvdW50cyBvdXRzaWRlIHRoZSBjaGFuZ2VzZXQqIFx1MjAxNCBzcGFuIFwiZm9jdXNcIiBhbmQgXCJjb25jZW50cmF0aW9uXCIgXHUyMDE0XG4gKiB3ZXJlIHByb3RvdHlwZWQgYW5kIHJlamVjdGVkOiBib3RoIG1lYXN1cmFibHkgZGVncmFkZWQgcmFua2luZywgd2hpY2ggaXNcbiAqIHdoeSB0aGlzIG5lZWRzIG5vIHBhcnNlIG9mIGBjb3ZlcmluZ0Jsb2Nrc1RleHRgIGFuZCBubyBleHRyYSBzdWJwcm9jZXNzLlxuICovXG5mdW5jdGlvbiBncm91cENvdmVyaW5nQnlOYW1lKGNvdmVyaW5nOiBQb3JjZWxhaW5Sb3dbXSwgdW5jb3ZlcmVkOiBzdHJpbmdbXSk6IHsgbmFtZTogc3RyaW5nOyBhbmNob3JzOiBzdHJpbmdbXSB9W10ge1xuICBjb25zdCBieU5hbWUgPSBuZXcgTWFwPHN0cmluZywgeyBhbmNob3JzOiBTZXQ8c3RyaW5nPjsgcGF0aHM6IFNldDxzdHJpbmc+IH0+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIGNvdmVyaW5nKSB7XG4gICAgY29uc3QgZ3JvdXAgPSBieU5hbWUuZ2V0KHJvdy5uYW1lKSA/PyB7IGFuY2hvcnM6IG5ldyBTZXQ8c3RyaW5nPigpLCBwYXRoczogbmV3IFNldDxzdHJpbmc+KCkgfTtcbiAgICBncm91cC5hbmNob3JzLmFkZChhbmNob3JUZXh0KHJvdykpO1xuICAgIGdyb3VwLnBhdGhzLmFkZChyb3cucGF0aCk7XG4gICAgYnlOYW1lLnNldChyb3cubmFtZSwgZ3JvdXApO1xuICB9XG4gIHJldHVybiBbLi4uYnlOYW1lLmVudHJpZXMoKV1cbiAgICAubWFwKChbbmFtZSwgZ3JvdXBdKSA9PiB7XG4gICAgICBsZXQgcHJveGltaXR5ID0gMDtcbiAgICAgIGZvciAoY29uc3QgcGF0aCBvZiBncm91cC5wYXRocykge1xuICAgICAgICBmb3IgKGNvbnN0IHRhcmdldCBvZiB1bmNvdmVyZWQpIHByb3hpbWl0eSA9IE1hdGgubWF4KHByb3hpbWl0eSwgcGF0aFByb3hpbWl0eShwYXRoLCB0YXJnZXQpKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB7IG5hbWUsIGFuY2hvcnM6IFsuLi5ncm91cC5hbmNob3JzXS5zb3J0KCksIGNvT2NjdXJyZW5jZTogZ3JvdXAucGF0aHMuc2l6ZSwgcHJveGltaXR5IH07XG4gICAgfSlcbiAgICAuc29ydChcbiAgICAgIChhLCBiKSA9PlxuICAgICAgICBiLmNvT2NjdXJyZW5jZSAtIGEuY29PY2N1cnJlbmNlIHx8XG4gICAgICAgIGIucHJveGltaXR5IC0gYS5wcm94aW1pdHkgfHxcbiAgICAgICAgLy8gQ29kZXBvaW50IG9yZGVyLCBtYXRjaGluZyB0aGUgcGxhaW4gYC5zb3J0KClgIHRoaXMga2V5IHJlcGxhY2VkIFx1MjAxNFxuICAgICAgICAvLyBgbG9jYWxlQ29tcGFyZWAgd291bGQgbWFrZSB0aGUgdGllLWJyZWFrIGxvY2FsZS1kZXBlbmRlbnQsIGFuZCB0aGVcbiAgICAgICAgLy8gd2hvbGUgcG9pbnQgb2YgdGhpcyBrZXkgaXMgdGhhdCBpdCBpcyBub3QuXG4gICAgICAgIChhLm5hbWUgPCBiLm5hbWUgPyAtMSA6IGEubmFtZSA+IGIubmFtZSA/IDEgOiAwKVxuICAgIClcbiAgICAubWFwKCh7IG5hbWUsIGFuY2hvcnMgfSkgPT4gKHsgbmFtZSwgYW5jaG9ycyB9KSk7XG59XG5cbi8qKlxuICogVGhlIFwib3RoZXIgZmlsZXMgaW4gdGhpcyBjaGFuZ2UgYWxyZWFkeSBiZWxvbmcgdG8gc3BhbnNcIiBzZWN0aW9uIGFwcGVuZGVkXG4gKiB0byB7QGxpbmsgcmVuZGVyVW5jb3ZlcmVkUmVhc29ufSdzIG91dHB1dCBcdTIwMTQgZW1wdHkgKHJlbmRlcnMgbm90aGluZykgd2hlblxuICogYGNvdmVyaW5nYCBpcyBlbXB0eSwgaS5lLiBubyBvdGhlciBmaWxlIGluIHRoZSBjaGFuZ2VzZXQgaGFzIGFueSBzcGFuXG4gKiBjb3ZlcmFnZS4gU3RpbGwgdGlnaHRlciB0aGFuIHRoZSBzdGFsZW5lc3MvZW52aXJvbm1lbnRhbCBibG9ja3MgZWxzZXdoZXJlXG4gKiBpbiB0aGlzIGZpbGUgXHUyMDE0IG5vIGFuY2hvcnMgb3V0c2lkZSB0aGlzIGNoYW5nZXNldCBcdTIwMTQgYnV0IGVhY2ggYCMjIDxuYW1lPmBcbiAqIGdyb3VwJ3MgYHdoeWAgc2VudGVuY2UgKHZpYSB7QGxpbmsgZXh0cmFjdFdoeX0gYWdhaW5zdCBgY292ZXJpbmdCbG9ja3NUZXh0YClcbiAqIGZvbGxvd3MgaXRzIGFuY2hvcnMsIHNhbWUgYXMgdGhvc2UgYmxvY2tzLCBzaW5jZSB0aGF0J3MgdGhlIHNlbnRlbmNlIHRoYXRcbiAqIGFjdHVhbGx5IHRlbGxzIHRoZSBhZ2VudCB3aGV0aGVyIGFuIHVuY292ZXJlZCBmaWxlIGJlbG9uZ3MgaGVyZS4gT21pdHRlZFxuICogZm9yIGEgc3BhbiB0aGF0IGhhcyBub25lIHJlY29yZGVkLCBvciB3aGVuIGBjb3ZlcmluZ0Jsb2Nrc1RleHRgIGNvdWxkbid0IGJlXG4gKiBmZXRjaGVkLlxuICpcbiAqIE9yZGVyZWQgYnkge0BsaW5rIGdyb3VwQ292ZXJpbmdCeU5hbWV9IFx1MjAxNCBtb3N0IG9mIHRoZSBjaGFuZ2VzZXQgY292ZXJlZFxuICogZmlyc3QsIG5vdCBhbHBoYWJldGljYWxseSBcdTIwMTQgYW5kIGNhcHBlZCBhdCB7QGxpbmsgUkVMQVRFRF9TUEFOU19DQVB9IHNwYW5zLFxuICogd2l0aCB0aGUgb3ZlcmZsb3cgZGlzY2xvc2VkIGJ5IG5hbWUtY291bnQgYW5kIHRoZSBjb21tYW5kIHRoYXQgc2hvd3MgdGhlXG4gKiByZXN0LiBUaGUgY2FwIGlzIG5vdCB0aGVyZSB0byBzaG9ydGVuIGEgdHlwaWNhbCB0d28tZW50cnkgbGlzdDsgaXQgaXMgdGhlcmVcbiAqIHRvIHN0b3AgdGhlIHRhaWwgKHRoaXMgcmVwb3NpdG9yeSdzIGhpc3RvcnkgcmVhY2hlcyA0MSBxdWFsaWZ5aW5nIHNwYW5zIGluXG4gKiBvbmUgY2hhbmdlc2V0KSwgd2hlcmUgdGhlIHNlY3Rpb24gc3RvcHMgYmVpbmcgYW4gYW5zd2VyIGFuZCBiZWNvbWVzIGEgd2FsbFxuICogb2YgdGV4dC4gQSB0cnVuY2F0ZWQgbGlzdCBtdXN0IG5ldmVyIHJlYWQgYXMgY29tcGxldGUsIGhlbmNlIHRoZSBjbG9zaW5nXG4gKiBkaXNjbG9zdXJlIGxpbmUgcmF0aGVyIHRoYW4gYSBzaWxlbnQgc2xpY2UuXG4gKi9cbmZ1bmN0aW9uIHJlbmRlclJlbGF0ZWRTcGFuc1NlY3Rpb24oXG4gIGNvdmVyaW5nOiBQb3JjZWxhaW5Sb3dbXSxcbiAgdW5jb3ZlcmVkOiBzdHJpbmdbXSxcbiAgY292ZXJpbmdCbG9ja3NUZXh0OiBzdHJpbmdcbik6IHN0cmluZ1tdIHtcbiAgaWYgKGNvdmVyaW5nLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICBjb25zdCBsaW5lcyA9IFtcbiAgICAnJyxcbiAgICAnLS0tJyxcbiAgICAnJyxcbiAgICAnT3RoZXIgZmlsZXMgaW4gdGhpcyBjaGFuZ2UgYWxyZWFkeSBiZWxvbmcgdG8gc3BhbnMgXHUyMDE0IGFuIHVuY292ZXJlZCBmaWxlIGFib3ZlIG1pZ2h0IGJlbG9uZyB3aXRoIG9uZSBvZiB0aGVzZSBpbnN0ZWFkIG9mIGEgbmV3IG9uZTonXG4gIF07XG4gIGNvbnN0IGdyb3VwcyA9IGdyb3VwQ292ZXJpbmdCeU5hbWUoY292ZXJpbmcsIHVuY292ZXJlZCk7XG4gIGZvciAoY29uc3QgeyBuYW1lLCBhbmNob3JzIH0gb2YgZ3JvdXBzLnNsaWNlKDAsIFJFTEFURURfU1BBTlNfQ0FQKSkge1xuICAgIGxpbmVzLnB1c2goJycsIGAjIyAke25hbWV9YCwgLi4uYW5jaG9ycy5tYXAoKGFuY2hvcikgPT4gYC0gJHthbmNob3J9YCkpO1xuICAgIGNvbnN0IHdoeSA9IGV4dHJhY3RXaHkoY292ZXJpbmdCbG9ja3NUZXh0LCBuYW1lKTtcbiAgICBpZiAod2h5Lmxlbmd0aCA+IDApIGxpbmVzLnB1c2goJycsIHdoeSk7XG4gIH1cbiAgY29uc3QgaGlkZGVuID0gZ3JvdXBzLmxlbmd0aCAtIFJFTEFURURfU1BBTlNfQ0FQO1xuICBpZiAoaGlkZGVuID4gMCkge1xuICAgIGxpbmVzLnB1c2goXG4gICAgICAnJyxcbiAgICAgIGhpZGRlbiA9PT0gMVxuICAgICAgICA/IFwiMSBtb3JlIHNwYW4gY292ZXJzIGZpbGVzIGluIHRoaXMgY2hhbmdlIGFuZCBpcyBub3Qgc2hvd24gXHUyMDE0IGBnaXQgc3BhbiBsaXN0IDxwYXRoPmAgc2hvd3MgYSBwYXRoJ3Mgc3BhbnMuXCJcbiAgICAgICAgOiBgJHtoaWRkZW59IG1vcmUgc3BhbnMgY292ZXIgZmlsZXMgaW4gdGhpcyBjaGFuZ2UgYW5kIGFyZSBub3Qgc2hvd24gXHUyMDE0IFxcYGdpdCBzcGFuIGxpc3QgPHBhdGg+XFxgIHNob3dzIGEgcGF0aCdzIHNwYW5zLmBcbiAgICApO1xuICB9XG4gIHJldHVybiBsaW5lcztcbn1cblxuLyoqXG4gKiBUaGUgbGlzdCBhbiB1bmNvdmVyZWQtd3JpdGVzIGBkZW55YCAob3IsIGluIGAnaW5mb3JtJ2AgbW9kZSwgYSBgc3RhdHVzYFxuICogYWR2aXNvcnkpIHJlbmRlcnMgaW50byBgcmVhc29uYCwgd3JhcHBlZCBpbiBhIGA8Z2l0LXNwYW4+YCBibG9jayBtYXRjaGluZyB0aGVcbiAqIHRvdWNoIGhvb2sncyBibG9jayBzdHlsaW5nLiBUaGUgXCJyZXRyeSB0aGUgY29tbWFuZCB0byBwcm9jZWVkIChvbmUtdGltZVxuICogY2hlY2spXCIgc2VudGVuY2UgZHJvcHMgZW50aXJlbHkgaW4gYCdpbmZvcm0nYCBtb2RlOiBhIGBzdGF0dXNgIGNoZWNrIG5ldmVyXG4gKiBoZWxkIGFueXRoaW5nLCBzbyB0aGVyZSBpcyBub3RoaW5nIHRvIHJldHJ5IGFuZCBubyBjb25zaWRlci1vbmNlIHN0YXRlIHRvXG4gKiBjbGVhci4gYGNvdmVyaW5nYCBcdTIwMTQgdGhlIHJlc3Qgb2YgdGhlIGNoYW5nZXNldCdzIGV4aXN0aW5nIHNwYW4gY292ZXJhZ2UsXG4gKiBmcm9tIHRoZSBzYW1lIHtAbGluayBjb21wdXRlVW5jb3ZlcmVkUGF0aHN9IGNhbGwgXHUyMDE0IHJlbmRlcnMgYXMgYSByZWxhdGVkLVxuICogc3BhbnMgc2VjdGlvbiAodmlhIHtAbGluayByZW5kZXJSZWxhdGVkU3BhbnNTZWN0aW9ufSkgaW4gYm90aCB0aGUgZnVsbCBhbmRcbiAqIGBhbHJlYWR5U2VlbmAgY29uZGVuc2VkIGZvcm1zOiBpdCdzIHN1cHBsZW1lbnRhcnkgY29udGV4dCBhYm91dCB0aGVcbiAqIGNoYW5nZXNldCwgbm90IGl0c2VsZiBwYXJ0IG9mIHdoYXQncyBmbGFnZ2VkIG9yIGNvbnNpZGVyLW9uY2UnZC4gQm90aCBmb3Jtc1xuICogcGFzcyB0aGUgc2FtZSBgdW5jb3ZlcmVkYC9gY292ZXJpbmdgIHBhaXIsIHNvIGJvdGggcmFuayBhbmQgY2FwIGlkZW50aWNhbGx5XG4gKiBcdTIwMTQgYSBjb25kZW5zZWQgcmV0cnkgcmVvcmRlcmluZyB0aGUgbWVzc2FnZSBpdCBjb25kZW5zZXMgd291bGQgYmUgaXRzIG93blxuICogZGVmZWN0LlxuICovXG5mdW5jdGlvbiByZW5kZXJVbmNvdmVyZWRSZWFzb24oXG4gIHVuY292ZXJlZDogc3RyaW5nW10sXG4gIGNvdmVyaW5nOiBQb3JjZWxhaW5Sb3dbXSxcbiAgY292ZXJpbmdCbG9ja3NUZXh0OiBzdHJpbmcsXG4gIG1vZGU6IEdhdGVNb2RlID0gJ2VuZm9yY2UnLFxuICBhbHJlYWR5U2VlbiA9IGZhbHNlXG4pOiBzdHJpbmcge1xuICBjb25zdCBsaW5lcyA9IHVuY292ZXJlZC5tYXAoKHBhdGgpID0+IGAtICR7cGF0aH1gKTtcbiAgaWYgKGFscmVhZHlTZWVuKSB7XG4gICAgY29uc3QgYm9keSA9IFsnPGdpdC1zcGFuPicsIC4uLmxpbmVzLCAnJywgJ0FscmVhZHkgZmxhZ2dlZCBmb3IgZ2l0LXNwYW4gcmV2aWV3IGFib3ZlLiddO1xuICAgIGJvZHkucHVzaCguLi5yZW5kZXJSZWxhdGVkU3BhbnNTZWN0aW9uKGNvdmVyaW5nLCB1bmNvdmVyZWQsIGNvdmVyaW5nQmxvY2tzVGV4dCkpO1xuICAgIGJvZHkucHVzaCgnPC9naXQtc3Bhbj4nKTtcbiAgICByZXR1cm4gYm9keS5qb2luKCdcXG4nKTtcbiAgfVxuICBjb25zdCBib2R5ID0gW1xuICAgICc8Z2l0LXNwYW4+JyxcbiAgICAuLi5saW5lcyxcbiAgICAnJyxcbiAgICB1bmNvdmVyZWQubGVuZ3RoID09PSAxXG4gICAgICA/ICdEZXRlcm1pbmUgaWYgdGhpcyBmaWxlIGNhcnJpZXMgaW1wbGljaXQgZGVwZW5kZW5jaWVzLCB0aGVuIHVzZSBgZ2l0IHNwYW5gIHRvIGRvY3VtZW50IHRoZW06J1xuICAgICAgOiAnRGV0ZXJtaW5lIGlmIHRoZXNlIGZpbGVzIGNhcnJ5IGltcGxpY2l0IGRlcGVuZGVuY2llcywgdGhlbiB1c2UgYGdpdCBzcGFuYCB0byBkb2N1bWVudCB0aGVtOicsXG4gICAgJycsXG4gICAgJ2BnaXQgc3BhbiBhZGQgPG5hbWU+IDxwYXRoI0xzdGFydC1MZW5kPiBbPHBhdGgjTHN0YXJ0LUxlbmQ+XSAuLi5gJyxcbiAgICAnYGdpdCBzcGFuIHdoeSA8bmFtZT4gXCI8d2h5PlwiYCcsXG4gICAgJycsXG4gICAgJ1RoZSBcIjx3aHk+XCIgaXMgYSBzaW5nbGUgcHJlc2VudC10ZW5zZSBzZW50ZW5jZSBuYW1pbmcgd2hhdCB0aGUgcmFuZ2VzIGZvcm0gdG9nZXRoZXIsIHNwZWNpZmljIGVub3VnaCB0byB0ZWxsIHdoZXRoZXIgYW4gZWRpdCBsYW5kcyBpbnNpZGUgaXQsIHdpdGggbm8gcnVsZXMgb3IgcmVtaW5kZXJzLidcbiAgXTtcbiAgYm9keS5wdXNoKC4uLnJlbmRlclJlbGF0ZWRTcGFuc1NlY3Rpb24oY292ZXJpbmcsIHVuY292ZXJlZCwgY292ZXJpbmdCbG9ja3NUZXh0KSk7XG4gIGlmIChtb2RlID09PSAnZW5mb3JjZScpIHtcbiAgICBib2R5LnB1c2goJycsICdJZiBub25lIGV4aXN0LCByZXRyeSB0aGUgY29tbWFuZCB0byBwcm9jZWVkIChvbmUtdGltZSBjaGVjaykuJyk7XG4gIH1cbiAgYm9keS5wdXNoKCcnLCAnTG9hZCB0aGUgYGdpdC1zcGFuOmdpdC1zcGFuYCBza2lsbCBmb3IgZ3VpZGFuY2UuJywgJzwvZ2l0LXNwYW4+Jyk7XG4gIHJldHVybiBib2R5LmpvaW4oJ1xcbicpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERlZmF1bHQgc3VicHJvY2Vzcy9kaXNrLWJhY2tlZCBkZXBlbmRlbmNpZXNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy9cbi8vIFRoZSBwcm9kdWN0aW9uIHN1cmZhY2VzIGJvdGggYWRhcHRlcnMgaW5qZWN0IGJ5IGRlZmF1bHQsIGZvbGxvd2luZ1xuLy8gdG91Y2gtY29yZS50cydzIGBjcmVhdGVEZWZhdWx0VG91Y2hFeGVjdXRvcnNgIHN0eWxlOiBlYWNoIGNhcHR1cmVzIHN0ZG91dCBldmVuXG4vLyBvbiBhIG5vbi16ZXJvIGV4aXQgd2hlcmUgdGhlIENMSSBzdGlsbCBlbWl0cyB1c2VmdWwgb3V0cHV0LCBhbmQgZXZlcnkgZmFpbHVyZVxuLy8gbW9kZSAoYWJzZW50IGJpbmFyeSwgdGltZW91dCwgbm8gcmVwbykgc3VyZmFjZXMgYXMgYW4gZW1wdHkvY2xlYW4gcmVzdWx0IHNvXG4vLyB0aGUgZ2F0ZSdzIGZhaWwtb3BlbiBjb250cmFjdCBob2xkcyB3aXRob3V0IHRoZSBhZGFwdGVyIGFkZGluZyBpdHMgb3duLlxuXG5jb25zdCBERUZBVUxUX1RJTUVPVVRfTVMgPSAxMF8wMDA7XG5cbi8qKiBSdW4gYSBnaXQgY29tbWFuZCBhdCBgY3dkYCwgcmV0dXJuaW5nIHRyaW1tZWQgbm9uLWVtcHR5IFBPU0lYIG91dHB1dCBsaW5lcyAoZW1wdHkgb24gYW55IGZhaWx1cmUpLiAqL1xuZnVuY3Rpb24gZ2l0TGluZXMoYXJnczogc3RyaW5nW10sIGN3ZDogc3RyaW5nLCB0aW1lb3V0TXM6IG51bWJlcik6IHN0cmluZ1tdIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIGFyZ3MsIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgIH0pO1xuICAgIHJldHVybiBvdXRcbiAgICAgIC5zcGxpdCgnXFxuJylcbiAgICAgIC5tYXAoKGxpbmUpID0+IGxpbmUudHJpbSgpKVxuICAgICAgLmZpbHRlcigobGluZSkgPT4gbGluZS5sZW5ndGggPiAwKVxuICAgICAgLm1hcCh0b1Bvc2l4KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG59XG5cbi8qKlxuICogTGlrZSB7QGxpbmsgZ2l0TGluZXN9IGJ1dCBkaXN0aW5ndWlzaGVzIGEgKmZhaWxlZCogaW52b2NhdGlvbiAoYG51bGxgIFx1MjAxNCBlLmcuXG4gKiBgQHt1fWAgd2l0aCBubyB1cHN0cmVhbSBjb25maWd1cmVkKSBmcm9tIGEgKnN1Y2Nlc3NmdWwgYnV0IGVtcHR5KiByZXN1bHRcbiAqIChgW11gKSwgc28gdGhlIG91dGdvaW5nLXJhbmdlIHJlc29sdXRpb24ga25vd3Mgd2hlbiB0byB0cnkgdGhlIG1lcmdlLWJhc2VcbiAqIGZhbGxiYWNrIHJhdGhlciB0aGFuIG1pc3Rha2luZyBcIm5vIHVwc3RyZWFtXCIgZm9yIFwibm90aGluZyB0byBwdXNoXCIuXG4gKi9cbmZ1bmN0aW9uIGdpdExpbmVzT3JOdWxsKGFyZ3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZywgdGltZW91dE1zOiBudW1iZXIpOiBzdHJpbmdbXSB8IG51bGwge1xuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgYXJncywge1xuICAgICAgY3dkLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgfSk7XG4gICAgcmV0dXJuIG91dFxuICAgICAgLnNwbGl0KCdcXG4nKVxuICAgICAgLm1hcCgobGluZSkgPT4gbGluZS50cmltKCkpXG4gICAgICAuZmlsdGVyKChsaW5lKSA9PiBsaW5lLmxlbmd0aCA+IDApXG4gICAgICAubWFwKHRvUG9zaXgpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKiogVGhlIHByb2R1Y3Rpb24ge0BsaW5rIEdpdEV4ZWN1dG9yfTogYGdpdCBkaWZmYCByZWFkcyBzY29wZWQgdG8gdGhlIENXRCByZXBvLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHRHaXRFeGVjdXRvcih0aW1lb3V0TXM6IG51bWJlciA9IERFRkFVTFRfVElNRU9VVF9NUyk6IEdpdEV4ZWN1dG9yIHtcbiAgcmV0dXJuIHtcbiAgICBzdGFnZWRQYXRoczogYXN5bmMgKGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGlmICghcmVwb1Jvb3QpIHJldHVybiBbXTtcbiAgICAgIHJldHVybiBnaXRMaW5lcyhbJy1DJywgcmVwb1Jvb3QsICdkaWZmJywgJy0tY2FjaGVkJywgJy0tbmFtZS1vbmx5J10sIHJlcG9Sb290LCB0aW1lb3V0TXMpO1xuICAgIH0sXG4gICAgdHJhY2tlZE1vZGlmaWVkUGF0aHM6IGFzeW5jIChjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290KSByZXR1cm4gW107XG4gICAgICByZXR1cm4gZ2l0TGluZXMoWyctQycsIHJlcG9Sb290LCAnZGlmZicsICctLW5hbWUtb25seSddLCByZXBvUm9vdCwgdGltZW91dE1zKTtcbiAgICB9LFxuICAgIG91dGdvaW5nUGF0aHM6IGFzeW5jIChjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290KSByZXR1cm4gW107XG4gICAgICBjb25zdCB1cHN0cmVhbSA9IGdpdExpbmVzT3JOdWxsKFsnLUMnLCByZXBvUm9vdCwgJ2RpZmYnLCAnLS1uYW1lLW9ubHknLCAnQHt1fS4uSEVBRCddLCByZXBvUm9vdCwgdGltZW91dE1zKTtcbiAgICAgIGlmICh1cHN0cmVhbSAhPT0gbnVsbCkgcmV0dXJuIHVwc3RyZWFtO1xuICAgICAgLy8gTm8gdXBzdHJlYW0gY29uZmlndXJlZDogZmFsbCBiYWNrIHRvIHRoZSBtZXJnZS1iYXNlIHdpdGggdGhlIGRlZmF1bHRcbiAgICAgIC8vIHJlbW90ZSBicmFuY2ggKGBvcmlnaW4vSEVBRGApLiBJZiB0aGF0IHRvbyBpcyB1bnJlc29sdmFibGUsIGZhaWwgb3Blbi5cbiAgICAgIGNvbnN0IGJhc2UgPSBnaXRMaW5lcyhbJy1DJywgcmVwb1Jvb3QsICdtZXJnZS1iYXNlJywgJ0hFQUQnLCAnb3JpZ2luL0hFQUQnXSwgcmVwb1Jvb3QsIHRpbWVvdXRNcylbMF07XG4gICAgICBpZiAoIWJhc2UpIHJldHVybiBbXTtcbiAgICAgIHJldHVybiBnaXRMaW5lcyhbJy1DJywgcmVwb1Jvb3QsICdkaWZmJywgJy0tbmFtZS1vbmx5JywgYCR7YmFzZX0uLkhFQURgXSwgcmVwb1Jvb3QsIHRpbWVvdXRNcyk7XG4gICAgfSxcbiAgICBwYXRoc3BlY1BhdGhzOiBhc3luYyAocGF0aHMsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGlmICghcmVwb1Jvb3QgfHwgcGF0aHMubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gICAgICAvLyBXb3JraW5nLXRyZWUgY29udGVudCB2cyBIRUFELCBzY29wZWQgdG8gdGhlIHBhdGhzcGVjcyBcdTIwMTQgdGhlIGZpbGVzIGFcbiAgICAgIC8vIGBnaXQgY29tbWl0IC0tIDxwYXRoc3BlYz5gIHdvdWxkIGFjdHVhbGx5IGNoYW5nZSAoc3RhZ2VkIG9yIG5vdCkuXG4gICAgICByZXR1cm4gZ2l0TGluZXMoWyctQycsIHJlcG9Sb290LCAnZGlmZicsICdIRUFEJywgJy0tbmFtZS1vbmx5JywgJy0tJywgLi4ucGF0aHNdLCByZXBvUm9vdCwgdGltZW91dE1zKTtcbiAgICB9XG4gIH07XG59XG5cbi8qKiBUaGUgcHJvZHVjdGlvbiB7QGxpbmsgR2F0ZUV4ZWN1dG9yc306IHNjb3BlZCBgZ2l0IHNwYW5gIGZpeC9zdGFsZS9saXN0IGF0IHRoZSByZXBvIHJvb3QuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdEdhdGVFeGVjdXRvcnModGltZW91dE1zOiBudW1iZXIgPSBERUZBVUxUX1RJTUVPVVRfTVMpOiBHYXRlRXhlY3V0b3JzIHtcbiAgcmV0dXJuIHtcbiAgICBmaXg6IGFzeW5jIChwYXRocywgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCB8fCBwYXRocy5sZW5ndGggPT09IDApIHJldHVybjtcbiAgICAgIHRyeSB7XG4gICAgICAgIGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ3N0YWxlJywgLi4ucGF0aHMsICctLWZpeCddLCB7XG4gICAgICAgICAgY3dkOiByZXBvUm9vdCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgLy8gYGdpdCBzcGFuIHN0YWxlYCBleGl0cyAxIG9uIGRyaWZ0IGV2ZW4gYWZ0ZXIgaGVhbGluZywgYW5kIG5vbi16ZXJvIG9uXG4gICAgICAgIC8vIGdlbnVpbmUgZmFpbHVyZTsgZWl0aGVyIHdheSB0aGUgc3Vic2VxdWVudCBgc3RhbGVgIHJlYWQgaXMgdGhlIHNvdXJjZVxuICAgICAgICAvLyBvZiB0cnV0aCwgc28gdGhlIGV4aXQgY29kZSBpcyBpZ25vcmVkIGhlcmUuXG4gICAgICAgIHZvaWQgZXJyO1xuICAgICAgfVxuICAgIH0sXG4gICAgc3RhbGU6IGFzeW5jIChwYXRocywgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCB8fCBwYXRocy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgICAgIGxldCBvdXQ6IHN0cmluZztcbiAgICAgIHRyeSB7XG4gICAgICAgIG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ3N0YWxlJywgJy0tZm9ybWF0JywgJ3BvcmNlbGFpbicsIC4uLnBhdGhzXSwge1xuICAgICAgICAgIGN3ZDogcmVwb1Jvb3QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIC8vIGBnaXQgc3BhbiBzdGFsZWAgZXhpdHMgbm9uLXplcm8gaW4gdHdvIHZlcnkgZGlmZmVyZW50IHdheXMsIGFuZCB0aGV5XG4gICAgICAgIC8vIG11c3Qgbm90IGJlIGNvbmZsYXRlZDpcbiAgICAgICAgLy8gIC0gTGVnaXRpbWF0ZSBkcmlmdDogcmVhbCBwb3JjZWxhaW4gcm93cyBvbiBzdGRvdXQgZGVzY3JpYmluZyB0aGVcbiAgICAgICAgLy8gICAgZHJpZnQuIFBhcnNlIHRoZW0gKHRoaXMgaXMgdGhlIHdob2xlIHBvaW50IG9mIHRoZSByZWFkKS5cbiAgICAgICAgLy8gIC0gSGFyZCBzY2FuIGZhaWx1cmU6IHRoZSBzY29wZWQgcXVlcnkgYWJvcnRlZCBiZWZvcmUgY29tcGxldGluZyAoZS5nLlxuICAgICAgICAvLyAgICBhbiB1bnJlYWRhYmxlIGFuY2hvciBmaWxlKSwgd3JpdGluZyBhbiBlcnJvciB0byBzdGRlcnIgYW5kIGVtaXR0aW5nXG4gICAgICAgIC8vICAgIGVtcHR5IHN0ZG91dC4gQW4gZW1wdHkgcmVzdWx0IGhlcmUgaXMgTk9UIFwiY2xlYW5cIiBcdTIwMTQgdGhlIHNjYW4gbmV2ZXJcbiAgICAgICAgLy8gICAgcmFuIHRvIGNvbXBsZXRpb24gXHUyMDE0IHNvIHNpZ25hbCBpdCBkaXN0aW5jdGx5IHJhdGhlciB0aGFuIHBhcnNpbmcgdG9cbiAgICAgICAgLy8gICAgYFtdYCwgd2hpY2ggd291bGQgcmVhZCBhcyBhIGNsZWFuIHBhc3MgYW5kIHNpbGVudGx5IGFsbG93IHRoZSBjb21taXQuXG4gICAgICAgIGNvbnN0IHN0ZG91dCA9IChlcnIgYXMgeyBzdGRvdXQ/OiBzdHJpbmcgfSkuc3Rkb3V0O1xuICAgICAgICBjb25zdCBzdGRlcnIgPSAoZXJyIGFzIHsgc3RkZXJyPzogc3RyaW5nIH0pLnN0ZGVycjtcbiAgICAgICAgY29uc3Qgc3Rkb3V0VGV4dCA9IHR5cGVvZiBzdGRvdXQgPT09ICdzdHJpbmcnID8gc3Rkb3V0IDogJyc7XG4gICAgICAgIGNvbnN0IHN0ZGVyclRleHQgPSB0eXBlb2Ygc3RkZXJyID09PSAnc3RyaW5nJyA/IHN0ZGVyciA6ICcnO1xuICAgICAgICBpZiAoc3Rkb3V0VGV4dC50cmltKCkubGVuZ3RoID09PSAwICYmIHN0ZGVyclRleHQudHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICB0aHJvdyBuZXcgR2F0ZVNjYW5FcnJvcihzdGRlcnJUZXh0LnRyaW0oKSk7XG4gICAgICAgIH1cbiAgICAgICAgb3V0ID0gc3Rkb3V0VGV4dDtcbiAgICAgIH1cbiAgICAgIHJldHVybiBwYXJzZVN0YWxlUG9yY2VsYWluKG91dCk7XG4gICAgfSxcbiAgICBsaXN0OiBhc3luYyAocGF0aHMsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGlmICghcmVwb1Jvb3QgfHwgcGF0aHMubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdsaXN0JywgJy0tcG9yY2VsYWluJywgLi4ucGF0aHNdLCB7XG4gICAgICAgICAgY3dkOiByZXBvUm9vdCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBwYXJzZVBvcmNlbGFpbihvdXQpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICAgIH1cbiAgICB9LFxuICAgIGxpc3RCbG9ja3M6IGFzeW5jIChuYW1lcywgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCB8fCBuYW1lcy5sZW5ndGggPT09IDApIHJldHVybiAnJztcbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdsaXN0JywgLi4ubmFtZXNdLCB7XG4gICAgICAgICAgY3dkOiByZXBvUm9vdCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gQSBmYWlsZWQgaHVtYW4tZm9ybWF0IHJlYWQgb25seSBkZWdyYWRlcyB0aGUgcmVuZGVyZWQgbWVzc2FnZVxuICAgICAgICAvLyAoYW5ub3RhdGVCbG9ja3Mgc3ludGhlc2l6ZXMgbWluaW1hbCBibG9ja3MpOyBuZXZlciBhIGdhdGUgZXJyb3IuXG4gICAgICAgIHJldHVybiAnJztcbiAgICAgIH1cbiAgICB9XG4gIH07XG59XG5cbi8qKlxuICogVGhlIHByb2R1Y3Rpb24gZGlzay1iYWNrZWQge0BsaW5rIEdhdGVNZW1vU3RhdGV9OiBvbmUgbWFya2VyIGZpbGUgcGVyIGRlYnQtc3RhdGVcbiAqIGRpZ2VzdCB1bmRlciB7QGxpbmsgZ2F0ZU1lbW9EaXJ9IChgPGdpdC1jb21tb24tZGlyPi9naXQtc3Bhbi9nYXRlL2ApLCBmb2xsb3dpbmdcbiAqIHNwYW4tc3VyZmFjZS50cydzIGZpbGUtYmFja2VkIGBNZW1vU3RvcmVgIHBhdHRlcm4uIFRoZSBkaWdlc3QgaXMgYSBoZXggc2hhMjU2LFxuICogYSBzYWZlIGZpbGVuYW1lLiBCZXN0LWVmZm9ydCBhbmQgbm9uLXRocm93aW5nOiBhIG1lbW8gd2hvc2UgcmVwbyBjYW5ub3QgYmVcbiAqIHJlc29sdmVkIGRlZ3JhZGVzIHRvIGEgbm8tb3Agc3RvcmUgKG5ldmVyIHBlcnNpc3RzIFx1MjE5MiB1bmNvdmVyZWQgd291bGQgcmUtZGVueSxcbiAqIGJ1dCBhbiB1bnJlc29sdmFibGUgcmVwbyB5aWVsZHMgYW4gZW1wdHkgY2hhbmdlc2V0IHVwc3RyZWFtIGFueXdheSkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEaXNrR2F0ZU1lbW9TdGF0ZShjd2Q6IHN0cmluZyk6IEdhdGVNZW1vU3RhdGUge1xuICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICBpZiAoIXJlcG9Sb290KSB7XG4gICAgLy8gTm8gcmVzb2x2YWJsZSByZXBvIFx1MjE5MiB0aGUgbWVtbyBjYW5ub3QgcGVyc2lzdC4gUmVwb3J0IGBmYWxzZWAgZnJvbVxuICAgIC8vIGByZWNvcmRgIHNvIHRoZSBnYXRlIGZhaWxzIG9wZW4gcmF0aGVyIHRoYW4gZGVueWluZyB3aXRoIG5vIGVzY2FwZS5cbiAgICByZXR1cm4geyBoYXM6ICgpID0+IGZhbHNlLCByZWNvcmQ6ICgpID0+IGZhbHNlIH07XG4gIH1cbiAgY29uc3QgZGlyID0gZ2F0ZU1lbW9EaXIocmVwb1Jvb3QpO1xuICByZXR1cm4ge1xuICAgIGhhczogKGRpZ2VzdCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGZzLmV4aXN0c1N5bmMobm9kZVBhdGguam9pbihkaXIsIGRpZ2VzdCkpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICB9LFxuICAgIHJlY29yZDogKGRpZ2VzdCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgZnMubWtkaXJTeW5jKGRpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgICAgIGZzLndyaXRlRmlsZVN5bmMobm9kZVBhdGguam9pbihkaXIsIGRpZ2VzdCksICcnKTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gQSBmYWlsZWQgbWVtbyB3cml0ZSBtdXN0IG5ldmVyIGJyaWNrIHRoZSBjb21taXQgYW5kIG11c3QgbmV2ZXJcbiAgICAgICAgLy8gc2lsZW50bHkgcmUtZGVueSBmb3JldmVyOiByZXBvcnQgdGhlIGZhaWx1cmUgc28gdGhlIGdhdGUgZmFpbHMgb3Blbi5cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgIH1cbiAgfTtcbn1cbiIsICIvKipcbiAqIFNoYXJlZCBoZWxwZXJzIHVzZWQgYnkgbXVsdGlwbGUgYWdlbnQtaG9va3MgZW50cnkgcG9pbnRzLlxuICpcbiAqIEV4dHJhY3RlZCBmcm9tIHByZS10b29sLXVzZS50cyBzbyB0aGF0IHRoZSB1cGNvbWluZyBTdG9wIGhvb2sgKGFuZCBhbnlcbiAqIGZ1dHVyZSBob29rcykgY2FuIGltcG9ydCBwYXRoIHV0aWxpdGllcywgcmFuZ2UgaGVscGVycywgYW5kIHRoZVxuICogc2FuaXRpemVTZXNzaW9uSWQvZm9ybWF0QW5jaG9yIGZ1bmN0aW9ucyB3aXRob3V0IGRlcGVuZGluZyBvbiB0aGVcbiAqIFByZVRvb2xVc2Utc3BlY2lmaWMgbW9kdWxlLlxuICovXG5cbmltcG9ydCB7IGV4ZWNGaWxlU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG9zIGZyb20gJ25vZGU6b3MnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQYXRoIGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgZnVuY3Rpb24gdG9Qb3NpeChwOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG59XG5cbmZ1bmN0aW9uIGlzQWJzb2x1dGVQb3NpeChwOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHAuc3RhcnRzV2l0aCgnLycpIHx8IC9eW0EtWmEtel06XFwvLy50ZXN0KHApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYWJzcGF0aEFnYWluc3QoYmFzZTogc3RyaW5nLCB0YXJnZXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHQgPSB0b1Bvc2l4KHRhcmdldCk7XG4gIGlmIChpc0Fic29sdXRlUG9zaXgodCkpIHJldHVybiB0O1xuICBjb25zdCBiID0gdG9Qb3NpeChiYXNlKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgcmV0dXJuIGAke2J9LyR7dH1gO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVJlcG9Sb290KGRpcjogc3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbCk6IHN0cmluZyB8IG51bGwge1xuICBpZiAoIWRpcikgcmV0dXJuIG51bGw7XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgZGlyLCAncmV2LXBhcnNlJywgJy0tc2hvdy10b3BsZXZlbCddLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIGVuY29kaW5nOiAndXRmOCdcbiAgICB9KTtcbiAgICBjb25zdCB0cmltbWVkID0gb3V0LnRyaW0oKTtcbiAgICByZXR1cm4gdHJpbW1lZC5sZW5ndGggPiAwID8gdG9Qb3NpeCh0cmltbWVkKSA6IG51bGw7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbi8qKlxuICogUmVwb3J0IHdoZXRoZXIgYSByZXBvLXJlbGF0aXZlIHBhdGggaXMgZXhjbHVkZWQgYnkgZ2l0J3MgaWdub3JlIHJ1bGVzXG4gKiAoLmdpdGlnbm9yZSwgLmdpdC9pbmZvL2V4Y2x1ZGUsIGNvcmUuZXhjbHVkZXNGaWxlKS4gVXNlZCB0byBrZWVwIGlnbm9yZWRcbiAqIGZpbGVzIFx1MjAxNCBidWlsZCBvdXRwdXQsIGNhY2hlcywgbG9ncyBcdTIwMTQgb3V0IG9mIHRvdWNoIHRyYWNraW5nIGVudGlyZWx5LCBzb1xuICogdGhlIHRvdWNoIGhvb2sgbmV2ZXIgcmVwb3J0cyByZWFkcywgd3JpdGVzLCBvciB1bmNvdmVyZWQgd3JpdGVzIG9uIHRoZW0uXG4gKlxuICogYGdpdCBjaGVjay1pZ25vcmUgLXEgPHBhdGg+YCBleGl0cyAwIHdoZW4gdGhlIHBhdGggaXMgaWdub3JlZCwgMSB3aGVuIGl0IGlzXG4gKiBub3QsIGFuZCAxMjggb24gZXJyb3IuIGV4ZWNGaWxlU3luYyB0aHJvd3Mgb24gYW55IG5vbi16ZXJvIGV4aXQsIHNvIGEgY2xlYW5cbiAqIHJldHVybiBtZWFucyBcImlnbm9yZWRcIi4gQSBzdGF0dXMtMSB0aHJvdyBpcyB0aGUgZXhwZWN0ZWQgXCJub3QgaWdub3JlZFwiXG4gKiBzaWduYWw7IGFueSBvdGhlciBmYWlsdXJlIGlzIGFuIHVucmVsaWFibGUgYW5zd2VyLCBzbyB3ZSByZXBvcnQgYGZhbHNlYFxuICogKGRvIG5vdCBkcm9wIHRoZSB0b3VjaCkgcmF0aGVyIHRoYW4gc2lsZW50bHkgaGlkaW5nIGEgdHJhY2tlZCBmaWxlLlxuICovXG4vKipcbiAqIFRoZSBkZWZhdWx0IHNwYW4gcm9vdCBkaXJlY3RvcnksIHJlbGF0aXZlIHRvIHRoZSByZXBvIHJvb3QsIHVzZWQgd2hlbiBub1xuICogZW52aXJvbm1lbnQgdmFyaWFibGUgb3IgZ2l0IGNvbmZpZyBvdmVycmlkZXMgdGhlIGxvY2F0aW9uLlxuICovXG5leHBvcnQgY29uc3QgU1BBTl9ST09UID0gJy5zcGFuJztcblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBzcGFuIHJvb3QgZGlyZWN0b3J5IGZvciBhIGdpdmVuIHJlcG8sIG1pcnJvcmluZyB0aGUgUnVzdCBDTElcbiAqIHByZWNlZGVuY2UgKG1pbnVzIHRoZSAtLXNwYW4tZGlyIENMSSBmbGFnLCB3aGljaCBpcyBpbnZpc2libGUgdG8gZmlsZS13cml0ZVxuICogaG9va3MpOlxuICogICAxLiBHSVRfU1BBTl9ESVIgZW52aXJvbm1lbnQgdmFyaWFibGVcbiAqICAgMi4gYGdpdCBjb25maWcgZ2l0LXNwYW4uZGlyYCBpbiB0aGUgcmVwb1xuICogICAzLiBEZWZhdWx0OiBcIi5zcGFuXCJcbiAqXG4gKiBUaGUgcmV0dXJuZWQgdmFsdWUgaXMgYSBQT1NJWC1zdHlsZSBwYXRoIHdpdGggbm8gdHJhaWxpbmcgc2xhc2guXG4gKiBGYWlsLXNhZmU6IGFueSByZXNvbHV0aW9uIGVycm9yIGZhbGxzIGJhY2sgdG8gXCIuc3BhblwiIHNvIHRoZSBob29rIG5ldmVyXG4gKiBjcmFzaGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBlbnZEaXIgPSBwcm9jZXNzLmVudlsnR0lUX1NQQU5fRElSJ107XG4gIGlmIChlbnZEaXIgJiYgZW52RGlyLnRyaW0oKS5sZW5ndGggPiAwKSB7XG4gICAgcmV0dXJuIHRvUG9zaXgoZW52RGlyLnRyaW0oKSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIH1cbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ2NvbmZpZycsICdnaXQtc3Bhbi5kaXInXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnXG4gICAgfSk7XG4gICAgY29uc3QgdHJpbW1lZCA9IHRvUG9zaXgob3V0LnRyaW0oKSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gICAgaWYgKHRyaW1tZWQubGVuZ3RoID4gMCkgcmV0dXJuIHRyaW1tZWQ7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHZvaWQgZXJyOyAvLyBjb25maWcga2V5IGFic2VudCBvciBnaXQgZXJyb3IgXHUyMDE0IGZhbGwgdGhyb3VnaCB0byBkZWZhdWx0XG4gIH1cbiAgcmV0dXJuIFNQQU5fUk9PVDtcbn1cblxuLyoqXG4gKiBSZXBvcnQgd2hldGhlciBhIHJlcG8tcmVsYXRpdmUgUE9TSVggcGF0aCBmYWxscyBpbnNpZGUgdGhlIGdpdmVuIHNwYW4gcm9vdFxuICogZGlyZWN0b3J5LiBBIHBhdGggaXMgaW5zaWRlIHdoZW4gaXQgZXF1YWxzIHRoZSBzcGFuIHJvb3QgZXhhY3RseSBvciBpc1xuICogbmVzdGVkIGJlbmVhdGggaXQgKGkuZS4gc3RhcnRzIHdpdGggXCI8c3BhblJvb3Q+L1wiKS4gVGhlIFwiL1wiIGJvdW5kYXJ5IHByZXZlbnRzXG4gKiBmYWxzZSBwb3NpdGl2ZXMgZm9yIHNpYmxpbmdzIGxpa2UgXCIuc3BhbnMveFwiIG9yIFwiLnNwYW4tbm90ZXMveFwiLlxuICpcbiAqIFBhc3MgdGhlIHJlc3VsdCBvZiBgcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290KWAgYXMgYHNwYW5Sb290YC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzSW5zaWRlU3BhblJvb3QocmVwb1JlbFBhdGg6IHN0cmluZywgc3BhblJvb3Q6IHN0cmluZyA9IFNQQU5fUk9PVCk6IGJvb2xlYW4ge1xuICBjb25zdCByb290ID0gc3BhblJvb3QucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIHJldHVybiByZXBvUmVsUGF0aCA9PT0gcm9vdCB8fCByZXBvUmVsUGF0aC5zdGFydHNXaXRoKGAke3Jvb3R9L2ApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNHaXRJZ25vcmVkKHJlcG9Sb290OiBzdHJpbmcsIHJlcG9SZWxQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ2NoZWNrLWlnbm9yZScsICctcScsICctLScsIHJlcG9SZWxQYXRoXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ2lnbm9yZScsICdpZ25vcmUnXVxuICAgIH0pO1xuICAgIHJldHVybiB0cnVlO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB2b2lkIGVycjtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290OiBzdHJpbmcsIGFic1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHJvb3QgPSB0b1Bvc2l4KHJlcG9Sb290KTtcbiAgY29uc3QgYWJzID0gdG9Qb3NpeChhYnNQYXRoKTtcbiAgY29uc3QgcHJlZml4ID0gcm9vdC5lbmRzV2l0aCgnLycpID8gcm9vdCA6IGAke3Jvb3R9L2A7XG4gIHJldHVybiBhYnMuc3RhcnRzV2l0aChwcmVmaXgpID8gYWJzLnNsaWNlKHByZWZpeC5sZW5ndGgpIDogYWJzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2Fub25pY2FsaXplUGF0aChhYnNQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICB0cnkge1xuICAgIHJldHVybiB0b1Bvc2l4KGZzLnJlYWxwYXRoU3luYy5uYXRpdmUoYWJzUGF0aCkpO1xuICB9IGNhdGNoIHtcbiAgICAvLyBGaWxlIGRvZXNuJ3QgZXhpc3QgeWV0IChlLmcuIFdyaXRlIHRvIGEgbmV3IGZpbGUpOiBjYW5vbmljYWxpemUgdGhlXG4gICAgLy8gZGlyZWN0b3J5IGFuZCByZWpvaW4gdGhlIGJhc2VuYW1lIHNvIHN5bWxpbmtzIGluIHRoZSBwYXJlbnQgYXJlIHJlc29sdmVkLlxuICAgIHRyeSB7XG4gICAgICBjb25zdCBkaXIgPSB0b1Bvc2l4KGZzLnJlYWxwYXRoU3luYy5uYXRpdmUobm9kZVBhdGguZGlybmFtZShhYnNQYXRoKSkpO1xuICAgICAgcmV0dXJuIGAke2Rpcn0vJHtub2RlUGF0aC5iYXNlbmFtZShhYnNQYXRoKX1gO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gUGFyZW50IGRvZXNuJ3QgZXhpc3QgZWl0aGVyOyBmYWxsIGJhY2sgdG8gdGhlIHVuLWNhbm9uaWNhbGl6ZWQgcGF0aC5cbiAgICAgIHJldHVybiBhYnNQYXRoO1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZGVyaXZlUGF0aCh0b29sSW5wdXQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBjd2Q6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCBmcCA9IHRvb2xJbnB1dC5maWxlX3BhdGg7XG4gIGlmICh0eXBlb2YgZnAgIT09ICdzdHJpbmcnIHx8IGZwLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGFicyA9IGFic3BhdGhBZ2FpbnN0KGN3ZCwgZnApO1xuICByZXR1cm4gY2Fub25pY2FsaXplUGF0aChhYnMpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIExpbmUgcmFuZ2UgdHlwZXMgYW5kIGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIExpbmVSYW5nZSB7XG4gIHN0YXJ0OiBudW1iZXI7XG4gIGVuZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmFuZ2VzSW50ZXJzZWN0KGE6IExpbmVSYW5nZSwgYjogTGluZVJhbmdlKTogYm9vbGVhbiB7XG4gIHJldHVybiBhLnN0YXJ0IDw9IGIuZW5kICYmIGEuZW5kID49IGIuc3RhcnQ7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUG9yY2VsYWluIHJvdyBwYXJzaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBQb3JjZWxhaW5Sb3cge1xuICBuYW1lOiBzdHJpbmc7XG4gIHBhdGg6IHN0cmluZztcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVBvcmNlbGFpbihzdGRvdXQ6IHN0cmluZyk6IFBvcmNlbGFpblJvd1tdIHtcbiAgY29uc3Qgcm93czogUG9yY2VsYWluUm93W10gPSBbXTtcbiAgZm9yIChjb25zdCBsaW5lIG9mIHN0ZG91dC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkKSBjb250aW51ZTtcbiAgICBjb25zdCBwYXJ0cyA9IHRyaW1tZWQuc3BsaXQoJ1xcdCcpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPCAzKSBjb250aW51ZTtcbiAgICBjb25zdCBbbmFtZSwgcGF0aCwgcmFuZ2VdID0gcGFydHM7XG4gICAgY29uc3QgZGFzaElkeCA9IHJhbmdlLmluZGV4T2YoJy0nKTtcbiAgICBpZiAoZGFzaElkeCA9PT0gLTEpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHN0YXJ0ID0gcGFyc2VJbnQocmFuZ2Uuc2xpY2UoMCwgZGFzaElkeCksIDEwKTtcbiAgICBjb25zdCBlbmQgPSBwYXJzZUludChyYW5nZS5zbGljZShkYXNoSWR4ICsgMSksIDEwKTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0KSB8fCBOdW1iZXIuaXNOYU4oZW5kKSkgY29udGludWU7XG4gICAgcm93cy5wdXNoKHsgbmFtZSwgcGF0aCwgc3RhcnQsIGVuZCB9KTtcbiAgfVxuICByZXR1cm4gcm93cztcbn1cblxuLyoqXG4gKiBUaGUgZnVsbCBgZ2l0IHNwYW4gc3RhbGUgLS1mb3JtYXQgcG9yY2VsYWluYCBzdGF0dXMgdG9rZW4gdm9jYWJ1bGFyeSAodGhlXG4gKiBnaXQtc3BhbiBDTEkncyBwb3JjZWxhaW4gY29udHJhY3QpOiBgRlJFU0hgL2BNT1ZFRGAvYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYFxuICogYXJlIHBvc2l0aW9uYWwtb3ItY2xlYW4gYW5kIG5ldmVyIGRlYnQ7IGV2ZXJ5IG90aGVyIHRva2VuIGlzIHNlbWFudGljIGRyaWZ0XG4gKiBvciBhIHRlcm1pbmFsL2Vycm9yIGNvbmRpdGlvbiBhbmQgaXMgZGVidC4gU2VlIHtAbGluayBpc0RlYnR9IGZvciB0aGVcbiAqIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGggb24gdGhhdCBzcGxpdC5cbiAqL1xuZXhwb3J0IGNvbnN0IFBPUkNFTEFJTl9TVEFUVVNFUyA9IFtcbiAgJ0ZSRVNIJyxcbiAgJ1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUJyxcbiAgJ01PVkVEJyxcbiAgJ0NIQU5HRUQnLFxuICAnREVMRVRFRCcsXG4gICdDT05GTElDVCcsXG4gICdTVUJNT0RVTEUnLFxuICAnTEZTX05PVF9GRVRDSEVEJyxcbiAgJ0xGU19OT1RfSU5TVEFMTEVEJyxcbiAgJ1BST01JU09SX01JU1NJTkcnLFxuICAnU1BBUlNFX0VYQ0xVREVEJyxcbiAgJ0ZJTFRFUl9GQUlMRUQnLFxuICAnSU9fRVJST1InXG5dIGFzIGNvbnN0O1xuXG5leHBvcnQgdHlwZSBQb3JjZWxhaW5TdGF0dXMgPSAodHlwZW9mIFBPUkNFTEFJTl9TVEFUVVNFUylbbnVtYmVyXTtcblxuY29uc3QgUE9SQ0VMQUlOX1NUQVRVU19TRVQ6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFBPUkNFTEFJTl9TVEFUVVNFUyk7XG5cbmZ1bmN0aW9uIHBhcnNlUG9yY2VsYWluU3RhdHVzKHJhdzogc3RyaW5nKTogUG9yY2VsYWluU3RhdHVzIHwgbnVsbCB7XG4gIHJldHVybiBQT1JDRUxBSU5fU1RBVFVTX1NFVC5oYXMocmF3KSA/IChyYXcgYXMgUG9yY2VsYWluU3RhdHVzKSA6IG51bGw7XG59XG5cbi8qKiBBIGBwYXJzZVN0YWxlUG9yY2VsYWluYCByb3c6IGEge0BsaW5rIFBvcmNlbGFpblJvd30gcGx1cyBpdHMgc3RhdHVzIHRva2VuLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTdGFsZVBvcmNlbGFpblJvdyBleHRlbmRzIFBvcmNlbGFpblJvdyB7XG4gIHN0YXR1czogUG9yY2VsYWluU3RhdHVzO1xufVxuXG4vKipcbiAqIFRoZSBkZWJ0IGludmFyaWFudCAoc3lzdGVtLXdpZGU7IGNvbnN1bWVkIGJ5IGJvdGggdGhlIGZ1dHVyZSB0b3VjaC1jb3JlIGFuZFxuICogZ2F0ZS1jb3JlKTogb25seSBzZW1hbnRpYyBzdGF0dXNlcyBhcmUgZGVidC4gYENIQU5HRURgIGFuZCBgREVMRVRFRGAgYXJlXG4gKiBzZW1hbnRpYyBkcmlmdDsgdGhlIHJlbWFpbmluZyBub24tRlJFU0gvTU9WRUQvUkVTT0xWRURfUEVORElOR19DT01NSVQgdG9rZW5zXG4gKiBhcmUgdGVybWluYWwvZXJyb3IgY29uZGl0aW9ucyBhbmQgYXJlIHRyZWF0ZWQgYXMgZGVidCB0b28gKHRoZXkgYmxvY2sgb25cbiAqIHRoZWlyIG93biBtZXJpdHMgXHUyMDE0IHRoZSBDTEkgY291bGQgbm90IHJlc29sdmUgdGhlIGFuY2hvciBhdCBhbGwpLiBgRlJFU0hgLFxuICogYE1PVkVEYCwgYW5kIGBSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgYXJlIG5ldmVyIGRlYnQ6IHBvc2l0aW9uYWwgZHJpZnQgdGhlXG4gKiBDTEkgY2FuIGhlYWwgKG9yIGFscmVhZHkgaGFzKSBpcyBpbnZpc2libGUsIGFuZCBhIHBlbmRpbmctY29tbWl0IHJlc29sdXRpb25cbiAqIGlzIG5vdCBvdXRzdGFuZGluZyBkZWJ0LlxuICpcbiAqIE5vdGU6IHRoZSBwb3JjZWxhaW4gdm9jYWJ1bGFyeSBkb2VzIG5vdCBjdXJyZW50bHkgZGlzdGluZ3Vpc2hcbiAqIGNvbnRlbnQtZXF1aXZhbGVudCBgQ0hBTkdFRGAgKGUuZy4gd2hpdGVzcGFjZS1vbmx5IGRyaWZ0IGAtLWZpeGAgY2FuIGhlYWwpXG4gKiBmcm9tIGdlbnVpbmVseSBzZW1hbnRpYyBgQ0hBTkdFRGAgXHUyMDE0IHRoYXQgY2xhc3NpZmljYXRpb24gaXMgbm90IHByZXNlbnQgaW5cbiAqIGBnaXQgc3BhbiBzdGFsZSAtLWZvcm1hdCBwb3JjZWxhaW5gIG91dHB1dCB0b2RheS4gVW50aWwgdGhlIENMSSBleHBvc2VzIGl0LFxuICogZXZlcnkgYENIQU5HRURgIHJvdyBpcyB0cmVhdGVkIGFzIGRlYnQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0RlYnQoc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBib29sZWFuIHtcbiAgc3dpdGNoIChzdGF0dXMpIHtcbiAgICBjYXNlICdGUkVTSCc6XG4gICAgY2FzZSAnTU9WRUQnOlxuICAgIGNhc2UgJ1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUJzpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIHRydWU7XG4gIH1cbn1cblxuLyoqXG4gKiBMb3dlcmNhc2UgaHVtYW4gbGFiZWwgZm9yIGEgcG9yY2VsYWluIHN0YXR1cyB0b2tlbiAoYExGU19OT1RfRkVUQ0hFRGAgXHUyMTkyXG4gKiBgbGZzIG5vdCBmZXRjaGVkYCkuIFRoZSBzaW5nbGUgbGFiZWwgbWFwcGluZyBmb3IgZXZlcnkgaHVtYW4tZm9ybWF0IGFuY2hvclxuICogc3VmZml4IFx1MjAxNCBib3RoIHRoZSB0b3VjaCBob29rJ3MgYmxvY2sgYW5kIHRoZSBnYXRlJ3MgbWVzc2FnZXMgcmVuZGVyIHRocm91Z2hcbiAqIHRoaXMsIHNvIGEgc3RhdHVzIG5ldmVyIHJlYWRzIGRpZmZlcmVudGx5IGJldHdlZW4gdGhlIHR3by5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGh1bWFuU3RhdHVzTGFiZWwoc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBzdHJpbmcge1xuICByZXR1cm4gc3RhdHVzLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvXy9nLCAnICcpO1xufVxuXG4vKipcbiAqIFRoZSB0ZXJtaW5hbC9lbnZpcm9ubWVudGFsIHN0YXR1c2VzOiB0aGUgQ0xJIGNvdWxkIG5vdCByZXNvbHZlIHRoZSBhbmNob3IgYXRcbiAqIGFsbCwgc28gdGhlIHJvdyBpcyBub3Qgc3BhbiBkcmlmdCBhIHVzZXIgY2FuIGZpeCBieSBlZGl0aW5nIGEgc3Bhbi4gVGhlc2UgYXJlXG4gKiBgQ09ORkxJQ1RgICh1bnJlc29sdmVkIG1lcmdlKSwgYFNVQk1PRFVMRWAgKGFuY2hvciBpbnNpZGUgYSBzdWJtb2R1bGUpLFxuICogYExGU19OT1RfRkVUQ0hFRGAvYExGU19OT1RfSU5TVEFMTEVEYCAoR2l0IExGUyBjb250ZW50IHVuYXZhaWxhYmxlKSxcbiAqIGBQUk9NSVNPUl9NSVNTSU5HYCAocGFydGlhbC1jbG9uZSBvYmplY3Qgbm90IGZldGNoZWQpLCBgU1BBUlNFX0VYQ0xVREVEYFxuICogKHBhdGggb3V0c2lkZSB0aGUgc3BhcnNlLWNoZWNrb3V0IGNvbmUpLCBgRklMVEVSX0ZBSUxFRGAgKGEgY2xlYW4vc211ZGdlXG4gKiBmaWx0ZXIgZXJyb3JlZCksIGFuZCBgSU9fRVJST1JgICh0cmFuc2llbnQgcmVhZCBmYWlsdXJlKS5cbiAqXG4gKiBUaGVzZSBhcmUgYSBzdHJpY3Qgc3Vic2V0IG9mIHtAbGluayBpc0RlYnR9OiBldmVyeSBlbnZpcm9ubWVudGFsIHN0YXR1cyBpc1xuICogYWxzbyBkZWJ0IChpdCBibG9ja3Mgb24gaXRzIG93biBtZXJpdHMgd2hlbiBzdXJmYWNlZCBpbiBhIHN0YXR1cyByZXBvcnQpLCBidXRcbiAqIHRoZSBnYXRlIG11c3QgdHJlYXQgdGhlbSBkaWZmZXJlbnRseSBmcm9tICpzZW1hbnRpYyogZHJpZnQgKGBDSEFOR0VEYCxcbiAqIGBERUxFVEVEYCkuIFNlbWFudGljIGRyaWZ0IGlzIGZpeGFibGUgYnkgZWRpdGluZyBhIHNwYW4sIHNvIHRoZSBnYXRlIGZhaWxzXG4gKiBjbG9zZWQgb24gaXQ7IGFuIGVudmlyb25tZW50YWwgY29uZGl0aW9uIGlzIG5vdCBzb21ldGhpbmcgYSBzcGFuIGVkaXQgY2FuXG4gKiByZXNvbHZlLCBzbyB0aGUgZ2F0ZSBmYWlscyBPUEVOIG9uIGl0IChhbGxvdywgYnV0IHN1cmZhY2UgdGhlIGNvbmRpdGlvbikgXHUyMDE0XG4gKiByZS1kZW55aW5nIGZvcmV2ZXIgb24gYW4gaW5mcmEgZmFpbHVyZSB0aGUgdXNlciBjYW5ub3QgY2xlYXIgZnJvbSBoZXJlIHdvdWxkXG4gKiBjb250cmFkaWN0IHRoZSBmYWlsLW9wZW4gY29udHJhY3QgdGhlIHJlc3Qgb2YgdGhlIGdhdGUgYWxyZWFkeSBob25vcnMgZm9yXG4gKiBDTEktYWJzZW50L3RpbWVvdXQvcGFyc2UtZmFpbHVyZSBjb25kaXRpb25zLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNFbnZpcm9ubWVudGFsU3RhdHVzKHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogYm9vbGVhbiB7XG4gIHN3aXRjaCAoc3RhdHVzKSB7XG4gICAgY2FzZSAnQ09ORkxJQ1QnOlxuICAgIGNhc2UgJ1NVQk1PRFVMRSc6XG4gICAgY2FzZSAnTEZTX05PVF9GRVRDSEVEJzpcbiAgICBjYXNlICdMRlNfTk9UX0lOU1RBTExFRCc6XG4gICAgY2FzZSAnUFJPTUlTT1JfTUlTU0lORyc6XG4gICAgY2FzZSAnU1BBUlNFX0VYQ0xVREVEJzpcbiAgICBjYXNlICdGSUxURVJfRkFJTEVEJzpcbiAgICBjYXNlICdJT19FUlJPUic6XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKlxuICogYGdpdCBzcGFuIHN0YWxlIC0tZm9ybWF0IHBvcmNlbGFpbmAgZW1pdHMgYSBkaWZmZXJlbnQgc2hhcGUgdGhhblxuICogYGxpc3QgLS1wb3JjZWxhaW5gOiBhIGAjIHBvcmNlbGFpbiB2MmAgaGVhZGVyLCBgIyBmdXp6eSBOYCBjb21tZW50IGxpbmVzLFxuICogYW5kIG9uZSBgPHN0YXR1cz5cXHQ8c3JjPlxcdDxuYW1lPlxcdDxwYXRoPlxcdDxzdGFydD5cXHQ8ZW5kPmAgcm93IHBlciBkcmlmdGVkXG4gKiBhbmNob3IgKHdob2xlLWZpbGUgYW5jaG9ycyBjYXJyeSBgKHdob2xlKWAvYC1gIGluIHBsYWNlIG9mIHRoZSBsaW5lIGNvbHVtbnMpLlxuICogUm93cyB3aG9zZSBzdGF0dXMgdG9rZW4gaXMgbm90IGluIHtAbGluayBQT1JDRUxBSU5fU1RBVFVTRVN9IGFyZSBza2lwcGVkIFx1MjAxNFxuICogYW4gdW5yZWNvZ25pemVkIHRva2VuIGZyb20gYSBuZXdlciBDTEkgaXMgdHJlYXRlZCB0aGUgc2FtZSBhcyBhIG1hbGZvcm1lZFxuICogbGluZSByYXRoZXIgdGhhbiBndWVzc2VkIGF0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VTdGFsZVBvcmNlbGFpbihzdGRvdXQ6IHN0cmluZyk6IFN0YWxlUG9yY2VsYWluUm93W10ge1xuICBjb25zdCByb3dzOiBTdGFsZVBvcmNlbGFpblJvd1tdID0gW107XG4gIGZvciAoY29uc3QgbGluZSBvZiBzdGRvdXQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCB8fCB0cmltbWVkLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgY29uc3QgcGFydHMgPSB0cmltbWVkLnNwbGl0KCdcXHQnKTtcbiAgICBpZiAocGFydHMubGVuZ3RoIDwgNikgY29udGludWU7XG4gICAgY29uc3QgW3N0YXR1c0NvbCwgLCBuYW1lLCBwYXRoLCBzdGFydENvbCwgZW5kQ29sXSA9IHBhcnRzO1xuICAgIGNvbnN0IHN0YXR1cyA9IHBhcnNlUG9yY2VsYWluU3RhdHVzKHN0YXR1c0NvbCk7XG4gICAgaWYgKCFzdGF0dXMpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHN0YXJ0ID0gc3RhcnRDb2wgPT09ICcod2hvbGUpJyA/IDAgOiBwYXJzZUludChzdGFydENvbCwgMTApO1xuICAgIGNvbnN0IGVuZCA9IGVuZENvbCA9PT0gJy0nID8gMCA6IHBhcnNlSW50KGVuZENvbCwgMTApO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpIHx8IE51bWJlci5pc05hTihlbmQpKSBjb250aW51ZTtcbiAgICByb3dzLnB1c2goeyBuYW1lLCBwYXRoLCBzdGFydCwgZW5kLCBzdGF0dXMgfSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2Vzc2lvbiBJRCBzYW5pdGl6YXRpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIEluamVjdGl2ZSB0cmFuc2Zvcm06IHBlcmNlbnQtZW5jb2RlIGJ5dGVzIG91dHNpZGUgW0EtWmEtejAtOS5fLV0gYXMgJUhIXG4gKiAodXBwZXJjYXNlIGhleCkuIFVzZWQgdG8gcHJvZHVjZSBzYWZlIGZpbGVuYW1lcyBmcm9tIGFyYml0cmFyeSBzZXNzaW9uIGlkcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplU2Vzc2lvbklkKHNlc3Npb25JZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHNlc3Npb25JZC5yZXBsYWNlKC9bXkEtWmEtejAtOS5fLV0vZywgKGNoKSA9PiB7XG4gICAgcmV0dXJuIGAlJHtjaC5jaGFyQ29kZUF0KDApLnRvU3RyaW5nKDE2KS50b1VwcGVyQ2FzZSgpLnBhZFN0YXJ0KDIsICcwJyl9YDtcbiAgfSk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUGVyLXNlc3Npb24gYmFzZSBkaXJlY3Rvcnlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vLyBCYXNlIGRpciBzaGFyZWQgYnkgYWxsIHBlci1zZXNzaW9uIHN0YXRlOiBjdXJyZW50bHkganVzdCB0aGUgdG91Y2gtaG9va1xuLy8gc2Vzc2lvbiBtZW1vIChzcGFuLXN1cmZhY2UudHMncyBNZW1vU3RvcmUpLiBFYWNoIHNlc3Npb24gZ2V0cyBvbmVcbi8vIHN1YmRpcmVjdG9yeSBrZXllZCBieSBpdHMgc2FuaXRpemVkIGlkLCBzbyBldmVyeSB3cml0ZXIvcmVhZGVyIGZvciBhIGdpdmVuXG4vLyBzZXNzaW9uIGFncmVlcyBvbiBpdHMgbG9jYXRpb24uXG5leHBvcnQgY29uc3QgU0VTU0lPTl9CQVNFX0RJUiA9IG5vZGVQYXRoLmpvaW4ob3MuaG9tZWRpcigpLCAnLmNhY2hlJywgJ2dpdC1zcGFuJywgJ3Nlc3Npb24nKTtcblxuLyoqIFRoZSBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcnkgZm9yIGEgZ2l2ZW4gc2Vzc2lvbiBpZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uRGlyKHNlc3Npb25JZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4oU0VTU0lPTl9CQVNFX0RJUiwgc2FuaXRpemVTZXNzaW9uSWQoc2Vzc2lvbklkKSk7XG59XG5cbmNvbnN0IFRISVJUWV9EQVlTX01TID0gMzAgKiAyNCAqIDYwICogNjAgKiAxMDAwO1xuXG4vKipcbiAqIE9wcG9ydHVuaXN0aWNhbGx5IHBydW5lIHBlci1zZXNzaW9uIHN0YXRlIGRpcmVjdG9yaWVzIHVuZGVyXG4gKiB7QGxpbmsgU0VTU0lPTl9CQVNFX0RJUn0gd2hvc2UgbXRpbWUgaXMgb2xkZXIgdGhhbiBgbWF4QWdlTXNgIChkZWZhdWx0IDMwXG4gKiBkYXlzKS4gQSBkaXJlY3RvcnkncyBtdGltZSBhZHZhbmNlcyB3aGVuZXZlciBhbiBlbnRyeSBpbnNpZGUgaXQgaXNcbiAqIGNyZWF0ZWQvcmVuYW1lZC9yZW1vdmVkLCBzbyBhbiBhY3RpdmUgc2Vzc2lvbiAobWVtbyB3cml0ZXMpIHN0YXlzIGZyZXNoO1xuICogb25seSBnZW51aW5lbHkgYWJhbmRvbmVkIHNlc3Npb25zIGFnZSBvdXQuXG4gKlxuICogQmVzdC1lZmZvcnQgYW5kIG5vbi10aHJvd2luZzogY2FsbGVkIG9wcG9ydHVuaXN0aWNhbGx5IGZyb20gaG9vayByZWFkL3dyaXRlXG4gKiBwYXRocywgbm90IGEgc2VwYXJhdGUgY3Jvbi1saWtlIG1lY2hhbmlzbSwgc28gYSBmYWlsdXJlIGhlcmUgbXVzdCBuZXZlclxuICogYmxvY2sgdGhlIGNhbGxlcidzIGFjdHVhbCB3b3JrLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcHJ1bmVTdGFsZVNlc3Npb25zKG5vdzogbnVtYmVyID0gRGF0ZS5ub3coKSwgbWF4QWdlTXM6IG51bWJlciA9IFRISVJUWV9EQVlTX01TKTogdm9pZCB7XG4gIGxldCBlbnRyaWVzOiBmcy5EaXJlbnRbXTtcbiAgdHJ5IHtcbiAgICBlbnRyaWVzID0gZnMucmVhZGRpclN5bmMoU0VTU0lPTl9CQVNFX0RJUiwgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm47IC8vIGJhc2UgZGlyIGFic2VudCBvciB1bnJlYWRhYmxlIFx1MjAxNCBub3RoaW5nIHRvIHBydW5lXG4gIH1cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSB7XG4gICAgaWYgKCFlbnRyeS5pc0RpcmVjdG9yeSgpKSBjb250aW51ZTtcbiAgICBjb25zdCBkaXJQYXRoID0gbm9kZVBhdGguam9pbihTRVNTSU9OX0JBU0VfRElSLCBlbnRyeS5uYW1lKTtcbiAgICB0cnkge1xuICAgICAgY29uc3Qgc3RhdCA9IGZzLnN0YXRTeW5jKGRpclBhdGgpO1xuICAgICAgaWYgKG5vdyAtIHN0YXQubXRpbWVNcyA+IG1heEFnZU1zKSB7XG4gICAgICAgIGZzLnJtU3luYyhkaXJQYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XG4gICAgICB9XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBWYW5pc2hlZCBiZXR3ZWVuIHJlYWRkaXIgYW5kIHN0YXQsIG9yIHJlbW92YWwgZmFpbGVkIFx1MjAxNCBza2lwIGl0LiBBXG4gICAgICAvLyBiZXN0LWVmZm9ydCBwcnVuZSBtdXN0IG5ldmVyIHRocm93IGludG8gdGhlIGNhbGxlcidzIGhvdCBwYXRoLlxuICAgIH1cbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIGtpbmQgYW5kIGFuY2hvciBmb3JtYXR0aW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IHR5cGUgVG91Y2hLaW5kID0gJ3JlYWQnIHwgJ3dyaXRlJyB8ICd3aG9sZS1yZWFkJyB8ICd3aG9sZS13cml0ZScgfCAnY3JlYXRlJztcblxuLyoqXG4gKiBGb3JtYXQgYSBzcGFuIGFuY2hvciBzdHJpbmcuXG4gKlxuICogLSBgd2hvbGUtcmVhZGAsIGB3aG9sZS13cml0ZWAsIGFuZCBgY3JlYXRlYDogcmV0dXJucyBqdXN0IHRoZSBwYXRoXG4gKiAtIGByZWFkYCBhbmQgYHdyaXRlYDogcmV0dXJucyBgcGF0aCNMPHN0YXJ0Pi1MPGVuZD5gIChyZXF1aXJlcyByYW5nZSlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEFuY2hvcihwYXRoOiBzdHJpbmcsIGtpbmQ6IFRvdWNoS2luZCwgcmFuZ2U/OiBMaW5lUmFuZ2UpOiBzdHJpbmcge1xuICBpZiAoKGtpbmQgPT09ICdyZWFkJyB8fCBraW5kID09PSAnd3JpdGUnKSAmJiByYW5nZSkge1xuICAgIHJldHVybiBgJHtwYXRofSNMJHtyYW5nZS5zdGFydH0tTCR7cmFuZ2UuZW5kfWA7XG4gIH1cbiAgcmV0dXJuIHBhdGg7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQW5jaG9yIHNwZWMgdHlwZVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgQW5jaG9yU3BlYyB7XG4gIHBhdGg6IHN0cmluZztcbiAga2luZDogVG91Y2hLaW5kO1xuICByYW5nZT86IExpbmVSYW5nZTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBRdWV1ZSBkaXJlY3RvcnkgaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgZ2l0IGNvbW1vbiBkaXJlY3RvcnkgZm9yIHRoZSBnaXZlbiByZXBvIHJvb3QuXG4gKiBUaGlzIGlzIHRoZSBzaGFyZWQgZGlyZWN0b3J5IChub3QgdGhlIHdvcmt0cmVlLXNwZWNpZmljIC5naXQpLCBzbyBxdWV1ZVxuICogcmVjb3JkcyBzdXJ2aXZlIHdvcmt0cmVlIGRlbGV0aW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUdpdENvbW1vbkRpcihyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdyZXYtcGFyc2UnLCAnLS1naXQtY29tbW9uLWRpciddLCB7XG4gICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgZW5jb2Rpbmc6ICd1dGY4J1xuICB9KTtcbiAgY29uc3QgdHJpbW1lZCA9IHRvUG9zaXgob3V0LnRyaW0oKSk7XG4gIC8vIGdpdCByZXR1cm5zIGEgcmVsYXRpdmUgcGF0aCAoZS5nLiBcIi5naXRcIikgZm9yIHNpbXBsZSByZXBvcy4gUmVzb2x2ZSBpdFxuICAvLyBhZ2FpbnN0IHJlcG9Sb290IHNvIGNhbGxlcnMgbmV2ZXIgZGVwZW5kIG9uIHByb2Nlc3MuY3dkKCkuXG4gIGlmICghbm9kZVBhdGguaXNBYnNvbHV0ZSh0cmltbWVkKSkge1xuICAgIHJldHVybiB0b1Bvc2l4KG5vZGVQYXRoLnJlc29sdmUocmVwb1Jvb3QsIHRyaW1tZWQpKTtcbiAgfVxuICByZXR1cm4gdHJpbW1lZDtcbn1cblxuLyoqXG4gKiBSb290IG9mIHRoZSBnaXQtc3BhbiBxdWV1ZSBkaXJlY3RvcnkgdHJlZSwgdW5kZXIgdGhlIGdpdCBjb21tb24gZGlyLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcXVldWVSb290KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihyZXNvbHZlR2l0Q29tbW9uRGlyKHJlcG9Sb290KSwgJ2dpdC1zcGFuJyk7XG59XG5cbi8qKlxuICogRGlyZWN0b3J5IGZvciB0aGUgZ2F0ZSdzIHBlci1jaGFuZ2VzZXQgc3RhdGUgbWVtb3MgKGRpZ2VzdCBvZiBzb3J0ZWRcbiAqIGZpbmRpbmdzICsgdW5jb3ZlcmVkIHBhdGhzKSwgdW5kZXIgdGhlIGdpdCBjb21tb24gZGlyIHNvIGl0IGlzIHNoYXJlZFxuICogYWNyb3NzIHdvcmt0cmVlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdhdGVNZW1vRGlyKHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihxdWV1ZVJvb3QocmVwb1Jvb3QpLCAnZ2F0ZScpO1xufVxuIiwgIi8qKlxuICogUGF0aCBleGNsdXNpb24gbGlzdCBmb3IgdGhlIGdhdGUncyB1bmNvdmVyZWQtd3JpdGVzIGNoZWNrLlxuICpcbiAqIGBldmFsdWF0ZUdhdGVgIGluIHtAbGluayBmaWxlOi8vLi9nYXRlLWNvcmUudHN9IGFscmVhZHkgZXhjbHVkZXMgYC5zcGFuLyoqYFxuICogcGF0aHMgZnJvbSBpdHMgdW5jb3ZlcmVkLXdyaXRlcyBjb21wdXRhdGlvbiB1bmNvbmRpdGlvbmFsbHkgKHNwYW4gcmVwYWlyc1xuICogcmlkZSB0aGUgc2FtZSBjb21taXQgYW5kIG11c3QgbmV2ZXIgc2VsZi10cmlnZ2VyIHRoZSBnYXRlKS4gVGhpcyBtb2R1bGVcbiAqIGFkZHMgYSBzZWNvbmQsIHVzZXItZGVjbGFyZWQgZXhjbHVzaW9uIHNvdXJjZSBvbiB0b3Agb2YgdGhhdDogYSByZXBvIG93bmVyXG4gKiBjYW4gbGlzdCBhZGRpdGlvbmFsIHBhdGhzIHRoZSB1bmNvdmVyZWQtd3JpdGVzIGNoZWNrIHNob3VsZCBuZXZlciBmbGFnIFx1MjAxNFxuICogZ2VuZXJhdGVkIG91dHB1dCwgdmVuZG9yZWQgY29kZSwgYW55dGhpbmcgdGhhdCB3aWxsIG5ldmVyIGdldCBhIHNwYW4uXG4gKlxuICogQ29uZmlnIGxpdmVzIGF0IGA8cmVwb1Jvb3Q+Ly5zcGFuLy5nYXRlaWdub3JlYC4gVW5saWtlXG4gKiB7QGxpbmsgZmlsZTovLy4vc3Bhbi1pZ25vcmUudHN9J3MgYC5zcGFuLy5ob29raWdub3JlYCBcdTIwMTQgd2hpY2ggdGhlIGBnaXQtc3BhbmBcbiAqIFJ1c3QgQ0xJIGF1dG8tY3JlYXRlcyB3aXRoIGNhbm9uaWNhbCBjb250ZW50IFx1MjAxNCBgLmdhdGVpZ25vcmVgIGlzXG4gKiAqKnVzZXItb3duZWQqKjogbm90aGluZyBjcmVhdGVzIG9yIHBvcHVsYXRlcyBpdCwgc28gaXRzIGFic2VuY2UgaXMgdGhlXG4gKiBub3JtYWwsIHVuY29uZmlndXJlZCBzdGF0ZSwgbm90IGEgYnJva2VuIG9uZS5cbiAqXG4gKiBFYWNoIG5vbi1jb21tZW50IGxpbmUgaXMgYSBzaW5nbGUgZ2l0aWdub3JlLXN0eWxlIHBhdGggcGF0dGVybiAobm8gdHJhaWxpbmdcbiAqIHByZWZpeCBsaXN0IFx1MjAxNCBhIGAuZ2F0ZWlnbm9yZWAgbGluZSBlaXRoZXIgZXhjbHVkZXMgYSBwYXRoIGZyb20gdGhlXG4gKiB1bmNvdmVyZWQtd3JpdGVzIGNoZWNrIG9yIGl0IGRvZXNuJ3QsIHVubGlrZSBgLmhvb2tpZ25vcmVgJ3MgcGVyLXNwYW4tc2x1Z1xuICogc3VwcHJlc3Npb24pOlxuICpcbiAqICAgcGFja2FnZXMvYWdlbnQtaG9va3MvZ2VuZXJhdGVkLyoqXG4gKlxuICogUGF0dGVybiBncmFtbWFyIGlzIGlkZW50aWNhbCB0byBgLmhvb2tpZ25vcmVgJ3MgKHNlZSB0aGF0IG1vZHVsZSdzIGRvY1xuICogY29tbWVudCBmb3IgdGhlIGZ1bGwgZ3JhbW1hcikgYW5kIHJldXNlcyBpdHMgY29tcGlsZWQgbWF0Y2hlciB2aWFcbiAqIHtAbGluayBjb21waWxlUGF0dGVybn0gcmF0aGVyIHRoYW4gcmVpbXBsZW1lbnRpbmcgcGF0aCBtYXRjaGluZzpcbiAqXG4gKiAtIEJsYW5rIGxpbmVzIGFuZCBsaW5lcyBiZWdpbm5pbmcgd2l0aCBgI2AgYXJlIHNraXBwZWQuXG4gKiAtIEEgdHJhaWxpbmcgYC9gIHJlc3RyaWN0cyB0aGUgcGF0dGVybiB0byBkaXJlY3Rvcmllcy5cbiAqIC0gQSBwYXR0ZXJuIGNvbnRhaW5pbmcgYSBzbGFzaCBpcyBhbmNob3JlZCB0byB0aGUgcmVwbyByb290OyBhIHBhdHRlcm4gd2l0aFxuICogICBubyBzbGFzaCBtYXRjaGVzIGEgc2luZ2xlIHBhdGggY29tcG9uZW50IGF0IGFueSBkZXB0aC5cbiAqIC0gYCpgIGFuZCBgP2AgbWF0Y2ggd2l0aGluIG9uZSBwYXRoIHNlZ21lbnQ7IGAqKmAgbWF0Y2hlcyBhY3Jvc3Mgc2VnbWVudHMuXG4gKiAtIE5lZ2F0aW9uIChgIWApIGlzIG5vdCBzdXBwb3J0ZWQuXG4gKlxuICogRmFpbC1vcGVuOiBhIG1pc3Npbmcgb3IgdW5yZWFkYWJsZSBgLmdhdGVpZ25vcmVgLCBvciBhIG1hbGZvcm1lZCBsaW5lLFxuICogeWllbGRzIG5vIGFkZGl0aW9uYWwgZXhjbHVzaW9uIFx1MjAxNCB0aGUgdW5jb3ZlcmVkLXdyaXRlcyBjaGVjayBzaW1wbHkgZmFsbHNcbiAqIGJhY2sgdG8gdGhlIGAuc3Bhbi8qKmAtb25seSBleGNsdXNpb24gaXQgYWxyZWFkeSBhcHBsaWVzLlxuICovXG5cbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGNvbXBpbGVQYXR0ZXJuIH0gZnJvbSAnLi9zcGFuLWlnbm9yZS5qcyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgR2F0ZUlnbm9yZVJ1bGUge1xuICAvKiogVGhlIHJhdyBnaXRpZ25vcmUtc3R5bGUgcGF0dGVybiwgcmV0YWluZWQgZm9yIGRpYWdub3N0aWNzLiAqL1xuICBwYXR0ZXJuOiBzdHJpbmc7XG4gIC8qKiBUcnVlIHdoZW4gYHJlcG9SZWxQYXRoYCAoUE9TSVgsIHJlcG8tcmVsYXRpdmUpIGlzIGV4Y2x1ZGVkIGJ5IHRoaXMgcnVsZS4gKi9cbiAgbWF0Y2hlczogKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IGJvb2xlYW47XG59XG5cbmNvbnN0IEdBVEVfSUdOT1JFX1JFTCA9IG5vZGVQYXRoLmpvaW4oJy5zcGFuJywgJy5nYXRlaWdub3JlJyk7XG5cbi8qKiBQYXJzZSBgLmdhdGVpZ25vcmVgIHRleHQgaW50byBydWxlcywgc2tpcHBpbmcgY29tbWVudHMgYW5kIGJsYW5rIGxpbmVzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlR2F0ZUlnbm9yZShjb250ZW50OiBzdHJpbmcpOiBHYXRlSWdub3JlUnVsZVtdIHtcbiAgY29uc3QgcnVsZXM6IEdhdGVJZ25vcmVSdWxlW10gPSBbXTtcbiAgZm9yIChjb25zdCByYXdMaW5lIG9mIGNvbnRlbnQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgcGF0dGVybiA9IHJhd0xpbmUudHJpbSgpO1xuICAgIGlmICghcGF0dGVybiB8fCBwYXR0ZXJuLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgcnVsZXMucHVzaCh7IHBhdHRlcm4sIG1hdGNoZXM6IGNvbXBpbGVQYXR0ZXJuKHBhdHRlcm4pIH0pO1xuICB9XG4gIHJldHVybiBydWxlcztcbn1cblxuLyoqXG4gKiBMb2FkIHRoZSBleGNsdXNpb24gcnVsZXMgZm9yIGEgcmVwby4gRmFpbC1vcGVuOiBhbnkgcmVhZCBmYWlsdXJlIHlpZWxkcyBhblxuICogZW1wdHkgcnVsZSBzZXQsIHNvIGFuIGFic2VudC91bnJlYWRhYmxlIGAuZ2F0ZWlnbm9yZWAgZXhjbHVkZXMgbm90aGluZ1xuICogYmV5b25kIHRoZSBnYXRlJ3MgdW5jb25kaXRpb25hbCBgLnNwYW4vKipgIGV4Y2x1c2lvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxvYWRHYXRlSWdub3JlKHJlcG9Sb290OiBzdHJpbmcpOiBHYXRlSWdub3JlUnVsZVtdIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKG5vZGVQYXRoLmpvaW4ocmVwb1Jvb3QsIEdBVEVfSUdOT1JFX1JFTCksICd1dGY4Jyk7XG4gICAgcmV0dXJuIHBhcnNlR2F0ZUlnbm9yZShjb250ZW50KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG59XG5cbi8qKiBUcnVlIHdoZW4gc29tZSBydWxlIGluIGBydWxlc2AgbWF0Y2hlcyBgcmVwb1JlbFBhdGhgLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzR2F0ZUlnbm9yZWQocnVsZXM6IEdhdGVJZ25vcmVSdWxlW10sIHJlcG9SZWxQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHJ1bGVzLnNvbWUoKHJ1bGUpID0+IHJ1bGUubWF0Y2hlcyhyZXBvUmVsUGF0aCkpO1xufVxuXG4vKiogU2lnbmF0dXJlIGZvciBpbmplY3RpbmcgYSBydWxlIGxvYWRlciAocHJvZHVjdGlvbiBkZWZhdWx0OiB7QGxpbmsgbG9hZEdhdGVJZ25vcmV9KS4gKi9cbmV4cG9ydCB0eXBlIEdhdGVJZ25vcmVMb2FkZXIgPSAocmVwb1Jvb3Q6IHN0cmluZykgPT4gR2F0ZUlnbm9yZVJ1bGVbXTtcbiIsICIvKipcbiAqIFBhdGgtc2NvcGVkIHNwYW4gc3VwcHJlc3Npb24gZm9yIHRoZSBhZ2VudCBob29rcy5cbiAqXG4gKiBTb21lIHNwYW5zIGFyZSBub2lzZSB3aGVuIGJyb3dzaW5nIGNlcnRhaW4gcGFydHMgb2YgdGhlIHRyZWUgXHUyMDE0IHdpa2kgb3JcbiAqIG1hcmtldGluZyBzcGFucyB0aGF0IGFuY2hvciBwcm9zZSwgc3VyZmFjZWQgaW5saW5lIHdoaWxlIHJlYWRpbmcgc291cmNlLFxuICogYWRkIGxpdHRsZS4gVGhpcyBtb2R1bGUgbGV0cyBhIHJlcG8gZGVjbGFyZSwgcGVyIHBhdGgsIHdoaWNoIHNwYW4gc2x1Z1xuICogcHJlZml4ZXMgdG8gaG9sZCBiYWNrLlxuICpcbiAqIENvbmZpZyBsaXZlcyBhdCBgPHJlcG9Sb290Pi8uc3Bhbi8uaG9va2lnbm9yZWAuIEVhY2ggbm9uLWNvbW1lbnQgbGluZSBpcyBhXG4gKiBnaXRpZ25vcmUtc3R5bGUgcGF0aCBwYXR0ZXJuLCBhIHNpbmdsZSBydW4gb2Ygd2hpdGVzcGFjZSwgdGhlbiBhXG4gKiBjb21tYS1zZXBhcmF0ZWQgbGlzdCBvZiBzcGFuIHNsdWcgcHJlZml4ZXMgdG8gc3VwcHJlc3MgZm9yIHBhdGhzIHRoZSBwYXR0ZXJuXG4gKiBtYXRjaGVzOlxuICpcbiAqICAgcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjIHdpa2ksbWFya2V0aW5nXG4gKlxuICogQSBzcGFuIHdob3NlIHNsdWcgYmVnaW5zIHdpdGggYHdpa2lgIG9yIGBtYXJrZXRpbmdgICh0aGUgc2x1ZyBlcXVhbHMgdGhlXG4gKiBwcmVmaXgsIG9yIGlzIGA8cHJlZml4Pi9cdTIwMjZgKSBpcyB0aGVuIG5ldmVyIHN1cmZhY2VkIGZvciBhbiBhbmNob3Igd2hvc2UgcGF0aFxuICogc2l0cyB1bmRlciBgcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjYCBcdTIwMTQgbmVpdGhlciBpbmxpbmUgYnkgdGhlIFByZVRvb2xVc2UgaG9va1xuICogbm9yIGluIHRoZSBTdG9wIGhvb2sncyBzdGFsZSAvIHJlbGF0ZWQgc2VjdGlvbnMuXG4gKlxuICogUGF0dGVybiBncmFtbWFyIGlzIGEgZGVsaWJlcmF0ZSBzdWJzZXQgb2YgZ2l0aWdub3JlOlxuICpcbiAqIC0gQmxhbmsgbGluZXMgYW5kIGxpbmVzIGJlZ2lubmluZyB3aXRoIGAjYCBhcmUgc2tpcHBlZC5cbiAqIC0gQSB0cmFpbGluZyBgL2AgcmVzdHJpY3RzIHRoZSBwYXR0ZXJuIHRvIGRpcmVjdG9yaWVzICh0aGUgbGVhZiBmaWxlIGlzIG5vdFxuICogICBpdHNlbGYgdGVzdGVkLCBvbmx5IGl0cyBhbmNlc3RvciBkaXJlY3RvcmllcykuXG4gKiAtIEEgcGF0dGVybiBjb250YWluaW5nIGEgc2xhc2ggaXMgYW5jaG9yZWQgdG8gdGhlIHJlcG8gcm9vdDsgYSBwYXR0ZXJuIHdpdGhcbiAqICAgbm8gc2xhc2ggbWF0Y2hlcyBhIHNpbmdsZSBwYXRoIGNvbXBvbmVudCBhdCBhbnkgZGVwdGguXG4gKiAtIGAqYCBhbmQgYD9gIG1hdGNoIHdpdGhpbiBvbmUgcGF0aCBzZWdtZW50OyBgKipgIG1hdGNoZXMgYWNyb3NzIHNlZ21lbnRzLlxuICogLSBOZWdhdGlvbiAoYCFgKSBpcyBub3Qgc3VwcG9ydGVkLlxuICpcbiAqIFN1cHByZXNzaW9uIGlzIGZhaWwtb3BlbjogYSBtaXNzaW5nIG9yIHVucmVhZGFibGUgYC5ob29raWdub3JlYCwgb3IgYVxuICogbWFsZm9ybWVkIGxpbmUsIHlpZWxkcyBubyBydWxlIHJhdGhlciB0aGFuIGhpZGluZyBzcGFucyB0aGUgYXV0aG9yIGRpZCBub3RcbiAqIGFzayB0byBoaWRlLlxuICovXG5cbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcblxuZXhwb3J0IGludGVyZmFjZSBJZ25vcmVSdWxlIHtcbiAgLyoqIFRoZSByYXcgZ2l0aWdub3JlLXN0eWxlIHBhdHRlcm4sIHJldGFpbmVkIGZvciBkaWFnbm9zdGljcy4gKi9cbiAgcGF0dGVybjogc3RyaW5nO1xuICAvKiogU3BhbiBzbHVnIHByZWZpeGVzIHN1cHByZXNzZWQgZm9yIHBhdGhzIHRoaXMgcnVsZSBtYXRjaGVzLiAqL1xuICBwcmVmaXhlczogc3RyaW5nW107XG4gIC8qKiBUcnVlIHdoZW4gYHJlcG9SZWxQYXRoYCAoUE9TSVgsIHJlcG8tcmVsYXRpdmUpIGlzIGdvdmVybmVkIGJ5IHRoaXMgcnVsZS4gKi9cbiAgbWF0Y2hlczogKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IGJvb2xlYW47XG59XG5cbmNvbnN0IEhPT0tfSUdOT1JFX1JFTCA9IG5vZGVQYXRoLmpvaW4oJy5zcGFuJywgJy5ob29raWdub3JlJyk7XG5cbi8qKlxuICogVHJhbnNsYXRlIG9uZSBnaXRpZ25vcmUtc3R5bGUgZ2xvYiBzZWdtZW50IGludG8gYW4gYW5jaG9yZWQgUmVnRXhwLiBgKmAgYW5kXG4gKiBgP2Agc3RheSB3aXRoaW4gYSBwYXRoIHNlZ21lbnQ7IGAqKmAgKG9wdGlvbmFsbHkgZm9sbG93ZWQgYnkgYC9gKSBzcGFucyB0aGVtLlxuICovXG5mdW5jdGlvbiBnbG9iVG9SZWdFeHAoZ2xvYjogc3RyaW5nKTogUmVnRXhwIHtcbiAgbGV0IHJlID0gJyc7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgZ2xvYi5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGMgPSBnbG9iW2ldO1xuICAgIGlmIChjID09PSAnKicpIHtcbiAgICAgIGlmIChnbG9iW2kgKyAxXSA9PT0gJyonKSB7XG4gICAgICAgIHJlICs9ICcuKic7XG4gICAgICAgIGkrKztcbiAgICAgICAgLy8gQWJzb3JiIGEgZm9sbG93aW5nIHNsYXNoIHNvIGAqKi9mb29gIGRvZXMgbm90IGRlbWFuZCBhIGxpdGVyYWwgYC9gLlxuICAgICAgICBpZiAoZ2xvYltpICsgMV0gPT09ICcvJykgaSsrO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmUgKz0gJ1teL10qJztcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGMgPT09ICc/Jykge1xuICAgICAgcmUgKz0gJ1teL10nO1xuICAgIH0gZWxzZSB7XG4gICAgICByZSArPSBjLnJlcGxhY2UoL1suK14ke30oKXxbXFxdXFxcXF0vZywgJ1xcXFwkJicpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbmV3IFJlZ0V4cChgXiR7cmV9JGApO1xufVxuXG4vKiogQW5jZXN0b3IgcGF0aCBjaGFpbjogYGEvYi9jLnRzYCBcdTIxOTIgYFsnYScsICdhL2InLCAnYS9iL2MudHMnXWAuICovXG5mdW5jdGlvbiBhbmNlc3RvclBhdGhzKHBhdGg6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgcGFydHMgPSBwYXRoLnNwbGl0KCcvJyk7XG4gIGNvbnN0IG91dDogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIG91dC5wdXNoKHBhcnRzLnNsaWNlKDAsIGkgKyAxKS5qb2luKCcvJykpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKlxuICogQ29tcGlsZSBhIHNpbmdsZSBnaXRpZ25vcmUtc3R5bGUgcGF0dGVybiAodGhpcyBtb2R1bGUncyBncmFtbWFyIFx1MjAxNCBzZWUgdGhlXG4gKiBtb2R1bGUgZG9jIGNvbW1lbnQpIGludG8gYSBwYXRoIHByZWRpY2F0ZS4gQSBwYXR0ZXJuIG1hdGNoZXMgYSBmaWxlIHdoZW4gaXRcbiAqIG1hdGNoZXMgdGhlIGZpbGUncyBwYXRoIG9yIGFueSBhbmNlc3RvciBkaXJlY3Rvcnkgb2YgaXQsIHNvIGEgZGlyZWN0b3J5XG4gKiBwYXR0ZXJuIHN1cHByZXNzZXMgZXZlcnl0aGluZyBiZW5lYXRoIGl0LlxuICpcbiAqIEV4cG9ydGVkIHNvIG90aGVyIHBhdGgtc2NvcGVkIGlnbm9yZS1maWxlIGNvbnZlbnRpb25zIChlLmcuIGAuZ2F0ZWlnbm9yZWBcbiAqIGluIGBnYXRlLWlnbm9yZS50c2ApIGNhbiByZXVzZSB0aGUgZXhhY3QgbWF0Y2hpbmcgc2VtYW50aWNzIHJhdGhlciB0aGFuXG4gKiByZWltcGxlbWVudGluZyB0aGVtLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29tcGlsZVBhdHRlcm4ocGF0dGVybjogc3RyaW5nKTogKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IGJvb2xlYW4ge1xuICBsZXQgcGF0ID0gcGF0dGVybjtcbiAgbGV0IGRpck9ubHkgPSBmYWxzZTtcbiAgaWYgKHBhdC5lbmRzV2l0aCgnLycpKSB7XG4gICAgZGlyT25seSA9IHRydWU7XG4gICAgcGF0ID0gcGF0LnNsaWNlKDAsIC0xKTtcbiAgfVxuICBsZXQgYW5jaG9yZWQgPSBwYXQuaW5jbHVkZXMoJy8nKTtcbiAgaWYgKHBhdC5zdGFydHNXaXRoKCcvJykpIHtcbiAgICBhbmNob3JlZCA9IHRydWU7XG4gICAgcGF0ID0gcGF0LnNsaWNlKDEpO1xuICB9XG4gIGNvbnN0IHJlID0gZ2xvYlRvUmVnRXhwKHBhdCk7XG5cbiAgcmV0dXJuIChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiB7XG4gICAgaWYgKGFuY2hvcmVkKSB7XG4gICAgICBjb25zdCBzZWdzID0gYW5jZXN0b3JQYXRocyhyZXBvUmVsUGF0aCk7XG4gICAgICAvLyBGb3IgYSBkaXItb25seSBwYXR0ZXJuLCBuZXZlciB0ZXN0IHRoZSBsZWFmIGZpbGUgaXRzZWxmLlxuICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IGRpck9ubHkgPyBzZWdzLnNsaWNlKDAsIC0xKSA6IHNlZ3M7XG4gICAgICByZXR1cm4gY2FuZGlkYXRlcy5zb21lKChzKSA9PiByZS50ZXN0KHMpKTtcbiAgICB9XG4gICAgLy8gVW5hbmNob3JlZDogbWF0Y2ggYWdhaW5zdCBpbmRpdmlkdWFsIHBhdGggY29tcG9uZW50cyBhdCBhbnkgZGVwdGguXG4gICAgY29uc3QgY29tcG9uZW50cyA9IHJlcG9SZWxQYXRoLnNwbGl0KCcvJyk7XG4gICAgY29uc3QgY2FuZGlkYXRlcyA9IGRpck9ubHkgPyBjb21wb25lbnRzLnNsaWNlKDAsIC0xKSA6IGNvbXBvbmVudHM7XG4gICAgcmV0dXJuIGNhbmRpZGF0ZXMuc29tZSgoYykgPT4gcmUudGVzdChjKSk7XG4gIH07XG59XG5cbi8qKiBQYXJzZSBgLmhvb2tpZ25vcmVgIHRleHQgaW50byBydWxlcywgc2tpcHBpbmcgY29tbWVudHMgYW5kIG1hbGZvcm1lZCBsaW5lcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUhvb2tJZ25vcmUoY29udGVudDogc3RyaW5nKTogSWdub3JlUnVsZVtdIHtcbiAgY29uc3QgcnVsZXM6IElnbm9yZVJ1bGVbXSA9IFtdO1xuICBmb3IgKGNvbnN0IHJhd0xpbmUgb2YgY29udGVudC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCBsaW5lID0gcmF3TGluZS50cmltKCk7XG4gICAgaWYgKCFsaW5lIHx8IGxpbmUuc3RhcnRzV2l0aCgnIycpKSBjb250aW51ZTtcbiAgICAvLyBgPHBhdHRlcm4+PHdoaXRlc3BhY2U+PHByZWZpeGVzPmAgXHUyMDE0IHBhdHRlcm4gaXMgdGhlIGZpcnN0IHRva2VuLCBwcmVmaXhlc1xuICAgIC8vIHRoZSBzZWNvbmQuIEEgbGluZSB3aXRob3V0IGJvdGggaXMgbWFsZm9ybWVkIGFuZCBza2lwcGVkLlxuICAgIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXihcXFMrKVxccysoXFxTKykkLyk7XG4gICAgaWYgKCFtYXRjaCkgY29udGludWU7XG4gICAgY29uc3QgWywgcGF0dGVybiwgcHJlZml4ZXNSYXddID0gbWF0Y2g7XG4gICAgY29uc3QgcHJlZml4ZXMgPSBwcmVmaXhlc1Jhd1xuICAgICAgLnNwbGl0KCcsJylcbiAgICAgIC5tYXAoKHApID0+IHAudHJpbSgpKVxuICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgICBpZiAocHJlZml4ZXMubGVuZ3RoID09PSAwKSBjb250aW51ZTtcbiAgICBydWxlcy5wdXNoKHsgcGF0dGVybiwgcHJlZml4ZXMsIG1hdGNoZXM6IGNvbXBpbGVQYXR0ZXJuKHBhdHRlcm4pIH0pO1xuICB9XG4gIHJldHVybiBydWxlcztcbn1cblxuLyoqXG4gKiBMb2FkIHRoZSBzdXBwcmVzc2lvbiBydWxlcyBmb3IgYSByZXBvLiBGYWlsLW9wZW46IGFueSByZWFkIG9yIHBhcnNlIGZhaWx1cmVcbiAqIHlpZWxkcyBhbiBlbXB0eSBydWxlIHNldCwgc28gc3BhbnMgc3VyZmFjZSBhcyBub3JtYWwgd2hlbiBubyBjb25maWcgZXhpc3RzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbG9hZEhvb2tJZ25vcmUocmVwb1Jvb3Q6IHN0cmluZyk6IElnbm9yZVJ1bGVbXSB7XG4gIHRyeSB7XG4gICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhub2RlUGF0aC5qb2luKHJlcG9Sb290LCBIT09LX0lHTk9SRV9SRUwpLCAndXRmOCcpO1xuICAgIHJldHVybiBwYXJzZUhvb2tJZ25vcmUoY29udGVudCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBbXTtcbiAgfVxufVxuXG4vKiogQSBzbHVnIGNhcnJpZXMgYSBwcmVmaXggd2hlbiBpdCBlcXVhbHMgdGhlIHByZWZpeCBvciBpcyBgPHByZWZpeD4vXHUyMDI2YC4gKi9cbmZ1bmN0aW9uIHNsdWdIYXNQcmVmaXgoc2x1Zzogc3RyaW5nLCBwcmVmaXg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gc2x1ZyA9PT0gcHJlZml4IHx8IHNsdWcuc3RhcnRzV2l0aChgJHtwcmVmaXh9L2ApO1xufVxuXG4vKipcbiAqIFRydWUgd2hlbiBhIHNwYW4gYHNsdWdgIHNob3VsZCBiZSBzdXBwcmVzc2VkIGZvciBhbiBhbmNob3IgYXQgYHJlcG9SZWxQYXRoYDpcbiAqIHNvbWUgcnVsZSBtYXRjaGVzIHRoZSBwYXRoIGFuZCBsaXN0cyBhIHByZWZpeCB0aGUgc2x1ZyBjYXJyaWVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNTcGFuU3VwcHJlc3NlZChydWxlczogSWdub3JlUnVsZVtdLCByZXBvUmVsUGF0aDogc3RyaW5nLCBzbHVnOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgZm9yIChjb25zdCBydWxlIG9mIHJ1bGVzKSB7XG4gICAgaWYgKCFydWxlLm1hdGNoZXMocmVwb1JlbFBhdGgpKSBjb250aW51ZTtcbiAgICBpZiAocnVsZS5wcmVmaXhlcy5zb21lKChwKSA9PiBzbHVnSGFzUHJlZml4KHNsdWcsIHApKSkgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKiogU2lnbmF0dXJlIGZvciBpbmplY3RpbmcgYSBydWxlIGxvYWRlciAocHJvZHVjdGlvbiBkZWZhdWx0OiB7QGxpbmsgbG9hZEhvb2tJZ25vcmV9KS4gKi9cbmV4cG9ydCB0eXBlIEhvb2tJZ25vcmVMb2FkZXIgPSAocmVwb1Jvb3Q6IHN0cmluZykgPT4gSWdub3JlUnVsZVtdO1xuIiwgIi8qKlxuICogQ29kZXggUHJlVG9vbFVzZSBnYXRlIGhvb2sgXHUyMDE0IGhvbGQgYGdpdCBjb21taXRgL2BnaXQgcHVzaGAgb24gcmVhbCBzcGFuIGRlYnQsXG4gKiBhbmQgYWR2aXNlIChuZXZlciBob2xkKSBvbiBhIHBsYWluIGBnaXQgc3RhdHVzYC5cbiAqXG4gKiBUaGUgQ29kZXggdHdpbiBvZiBbY2xhdWRlL2dhdGUudHNdKC4vcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjL2NsYXVkZS9nYXRlLnRzKTpcbiAqIHNhbWUgc2hhcmVkIGdhdGUtY29yZSBwaXBlbGluZSAoe0BsaW5rIHBhcnNlR2l0Q29tbWFuZH0gXHUyMTkyIHtAbGluayByZXNvbHZlQ2hhbmdlc2V0fVxuICogXHUyMTkyIHtAbGluayBldmFsdWF0ZUdhdGV9KSwgdHJhbnNsYXRlZCBpbnRvIENvZGV4J3MgUHJlVG9vbFVzZSBvdXRwdXQgc2hhcGUuIENvZGV4XG4gKiBkZWxpdmVycyBhIHNoZWxsIGNvbW1hbmQgYXMgYW4gU0RLLXR5cGVkIGB1bmtub3duYCBgdG9vbF9pbnB1dGA7IHRoaXMgaGFuZGxlclxuICogbmFycm93cyBpdCAoc3RyaW5nLCBvciBhIGBbXCJiYXNoXCIsXCItbGNcIixcIjxzY3JpcHQ+XCJdYC9hcmd2IGFycmF5KSBpbnRvIHRoZVxuICogY29tbWFuZCBzdHJpbmcgdGhlIGNvcmUgcGFyc2VzLlxuICpcbiAqIFx1MjUwMFx1MjUwMCBVbmNvbmZpcm1lZCBkZW55IChzZWUgbm90ZXMvY29kZXgtZGVueS1zcGlrZS5tZCkgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG4gKiBXaGV0aGVyIENvZGV4J3MgYHBlcm1pc3Npb25EZWNpc2lvbjogJ2RlbnknYCBhY3R1YWxseSAqYmxvY2tzKiB0aGUgc2hlbGwgdG9vbFxuICogbGl2ZSB3YXMgbmV2ZXIgY29uZmlybWVkIGluIHRoaXMgcmVwbzogdGhlIFBoYXNlIDAgc3Bpa2UgY291bGQgbm90IGdldCBhXG4gKiBmcm9tLXNjcmF0Y2ggcGx1Z2luIHRvIGxvYWQsIHNvIHRoZSBkZW55IHBhdGggd2FzIG5ldmVyIGV4ZXJjaXNlZCBlbmQtdG8tZW5kLlxuICogVGhlIG9ubHkgcG9zaXRpdmUgZXZpZGVuY2UgaXMgZG9jdW1lbnRhcnkgXHUyMDE0IHRoZSBgQGdvb2Rmb290L2NvZGV4LWhvb2tzYCBSRUFETUVcbiAqICh0aGUgZXhhY3QgdmVyc2lvbiB0aGlzIHJlcG8gZGVwZW5kcyBvbikgc2hpcHMgYSB3b3JrZWQgYHBlcm1pc3Npb25EZWNpc2lvbjpcbiAqICdkZW55J2AgZXhhbXBsZSBtYXRjaGVkIG9uIGBcIkJhc2hcImAuIFRoaXMgYWRhcHRlciB0aGVyZWZvcmUgc2hpcHMgdGhlIGhhcmQtZGVueVxuICogcGF0aCBwZXIgdGhhdCBSRUFETUUgKHtAbGluayBDT0RFWF9HQVRFX0hBUkRfREVOWX0gPSBgdHJ1ZWApLCBidXQga2VlcHMgdGhlXG4gKiBDQVJELm1kLWRvY3VtZW50ZWQgZmFsbGJhY2sgXHUyMDE0IGEgbG91ZCBgYWRkaXRpb25hbENvbnRleHRgIHdhcm5pbmcgdGhhdCBhbGxvd3NcbiAqIHRoZSBjb21tYW5kLCB3aXRoIHRoZSBDSSByZWNpcGUgYXMgQ29kZXgncyBlbmZvcmNlbWVudCBiYWNrc3RvcCBcdTIwMTQgYXMgYSBjbGVhcmx5XG4gKiBzZXBhcmFibGUgYnJhbmNoIGJlaGluZCB0aGF0IG9uZSBjb25zdGFudC4gSWYgYSBsaXZlIHNlc3Npb24gc2hvd3MgZGVueSBkb2VzXG4gKiBub3QgZmlyZSwgZmxpcCB7QGxpbmsgQ09ERVhfR0FURV9IQVJEX0RFTll9IHRvIGBmYWxzZWA7IG5vdGhpbmcgZWxzZSBjaGFuZ2VzLlxuICpcbiAqIFRoZSBzaGVsbCB0b29sJ3MgZXhhY3QgYHRvb2xfbmFtZWAgaXMgbGlrZXdpc2UgdW5jb25maXJtZWQgKHRoZSBSRUFETUUnc1xuICogZXhhbXBsZSB1c2VzIGBcIkJhc2hcImA7IENvZGV4IENMSSB0cmFuc2NyaXB0cyBpbiB0aGUgc3Bpa2UgbGFiZWxlZCB0aGUgY2FsbFxuICogYGV4ZWNgKS4gVGhlIHJlZ2lzdHJhdGlvbiBtYXRjaGVyIGlzIGJyb2FkZW5lZCB0byB0aGUgcGxhdXNpYmxlIG5hbWVzIHNvIHRoZVxuICogaG9vayBhY3R1YWxseSBmaXJlcywgYW5kIGV2ZXJ5IGZpcmUgbG9ncyB0aGUgb2JzZXJ2ZWQgYHRvb2xfbmFtZWAgc28gdGhlIGZpcnN0XG4gKiBsaXZlIHJ1biByZXZlYWxzIHRoZSBsaXRlcmFsIHN0cmluZyB0byBuYXJyb3cgdGhlIG1hdGNoZXIgdG8uXG4gKlxuICogRmFpbC1vcGVuIGF0IGV2ZXJ5IGxheWVyOiBnYXRlLWNvcmUgcmVzb2x2ZXMgaW50ZXJuYWwgZXJyb3JzIHRvIGFsbG93LCBhbmQgdGhpc1xuICogYWRhcHRlciB3cmFwcyB0aGUgd2hvbGUgcGF0aCBpbiBhIHRyeS9jYXRjaCB0aGF0IGFsbG93cy1hbmQtbG9ncyBcdTIwMTQgdGhlIGdhdGVcbiAqIG11c3QgbmV2ZXIgYnJpY2sgYSBjb21taXQuIFRoZSB0aW1lb3V0IGlzIG1pbGxpc2Vjb25kcyBoZXJlICh0aGUgQ29kZXggQ0xJXG4gKiBkaXZpZGVzIHRvIHNlY29uZHMgYXQgZW1pdCkuXG4gKi9cblxuaW1wb3J0IHsgdHlwZSBIb29rQ29udGV4dCwgdHlwZSBQcmVUb29sVXNlSW5wdXQsIHByZVRvb2xVc2VIb29rLCBwcmVUb29sVXNlT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NvZGV4LWhvb2tzJztcbmltcG9ydCB7XG4gIGNvbW1pdFN0YWdlc0FsbCxcbiAgY3JlYXRlRGVmYXVsdEdhdGVFeGVjdXRvcnMsXG4gIGNyZWF0ZURlZmF1bHRHaXRFeGVjdXRvcixcbiAgY3JlYXRlRGlza0dhdGVNZW1vU3RhdGUsXG4gIGV2YWx1YXRlR2F0ZSxcbiAgdHlwZSBHYXRlRXhlY3V0b3JzLFxuICB0eXBlIEdhdGVNZW1vU3RhdGUsXG4gIHR5cGUgR2l0RXhlY3V0b3IsXG4gIHBhcnNlR2l0Q29tbWFuZCxcbiAgcmVzb2x2ZUNoYW5nZXNldCxcbiAgd3JhcEdpdFNwYW5Db250ZXh0XG59IGZyb20gJy4uL2NvbW1vbi9nYXRlLWNvcmUuanMnO1xuXG4vKipcbiAqIFdoZXRoZXIgQ29kZXgncyBgcGVybWlzc2lvbkRlY2lzaW9uOiAnZGVueSdgIGlzIHRydXN0ZWQgdG8gYmxvY2sgdGhlIHNoZWxsIHRvb2xcbiAqIGxpdmUuIFNoaXBzIGB0cnVlYCAoaGFyZCBkZW55KSBwZXIgdGhlIGBAZ29vZGZvb3QvY29kZXgtaG9va3NgIFJFQURNRSdzIHdvcmtlZFxuICogZXhhbXBsZS4gRmxpcCB0byBgZmFsc2VgIHRvIGFjdGl2YXRlIHRoZSBDQVJELm1kLWRvY3VtZW50ZWQgZmFsbGJhY2sgaWYgYSBsaXZlXG4gKiBzZXNzaW9uIHNob3dzIGRlbnkgZG9lcyBub3QgZmlyZSBcdTIwMTQgc2VlIG5vdGVzL2NvZGV4LWRlbnktc3Bpa2UubWQgYW5kIHRoaXNcbiAqIGZpbGUncyBoZWFkZXIuIFRoaXMgaXMgdGhlIHNpbmdsZSBzd2l0Y2ggdGhhdCBzZXBhcmF0ZXMgdGhlIHR3byBjb2RlIHBhdGhzLlxuICovXG5jb25zdCBDT0RFWF9HQVRFX0hBUkRfREVOWSA9IHRydWU7XG5cbi8qKlxuICogTmFycm93IENvZGV4J3MgYHVua25vd25gIHNoZWxsIGB0b29sX2lucHV0YCBpbnRvIHRoZSBjb21tYW5kIHN0cmluZyB0aGUgY29yZVxuICogcGFyc2VzLiBIYW5kbGVzIGEgYmFyZSBgY29tbWFuZGAgc3RyaW5nLCBhIHNoZWxsLXdyYXBwZXIgYXJndlxuICogKGBbXCJiYXNoXCIsXCItbGNcIixcIjxzY3JpcHQ+XCJdYCBcdTIxOTIgdGhlIHNjcmlwdCBhZnRlciBgLWNgL2AtbGNgKSwgYW5kIGEgZGlyZWN0IGFyZ3ZcbiAqIChgW1wiZ2l0XCIsXCJjb21taXRcIixcdTIwMjZdYCBcdTIxOTIgc3BhY2Utam9pbmVkKS4gUmV0dXJucyBgbnVsbGAgd2hlbiBubyBjb21tYW5kIHRleHQgaXNcbiAqIHJlY292ZXJhYmxlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdFNoZWxsQ29tbWFuZCh0b29sSW5wdXQ6IHVua25vd24pOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKHRvb2xJbnB1dCA9PT0gbnVsbCB8fCB0eXBlb2YgdG9vbElucHV0ICE9PSAnb2JqZWN0JyB8fCAhKCdjb21tYW5kJyBpbiB0b29sSW5wdXQpKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgY29tbWFuZCA9ICh0b29sSW5wdXQgYXMgeyBjb21tYW5kOiB1bmtub3duIH0pLmNvbW1hbmQ7XG4gIGlmICh0eXBlb2YgY29tbWFuZCA9PT0gJ3N0cmluZycpIHJldHVybiBjb21tYW5kLmxlbmd0aCA+IDAgPyBjb21tYW5kIDogbnVsbDtcbiAgaWYgKEFycmF5LmlzQXJyYXkoY29tbWFuZCkpIHtcbiAgICBjb25zdCBwYXJ0cyA9IGNvbW1hbmQuZmlsdGVyKChwKTogcCBpcyBzdHJpbmcgPT4gdHlwZW9mIHAgPT09ICdzdHJpbmcnKTtcbiAgICBpZiAocGFydHMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBmbGFnSWR4ID0gcGFydHMuZmluZEluZGV4KChwKSA9PiBwID09PSAnLWMnIHx8IHAgPT09ICctbGMnIHx8IHAgPT09ICctaWMnKTtcbiAgICBpZiAoZmxhZ0lkeCA+PSAwICYmIHBhcnRzW2ZsYWdJZHggKyAxXSAhPT0gdW5kZWZpbmVkKSByZXR1cm4gcGFydHNbZmxhZ0lkeCArIDFdO1xuICAgIHJldHVybiBwYXJ0cy5qb2luKCcgJyk7XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVIYW5kbGVyKFxuICBnaXQ6IEdpdEV4ZWN1dG9yID0gY3JlYXRlRGVmYXVsdEdpdEV4ZWN1dG9yKCksXG4gIGV4ZWN1dG9yczogR2F0ZUV4ZWN1dG9ycyA9IGNyZWF0ZURlZmF1bHRHYXRlRXhlY3V0b3JzKCksXG4gIG1lbW9GYWN0b3J5OiAoY3dkOiBzdHJpbmcpID0+IEdhdGVNZW1vU3RhdGUgPSBjcmVhdGVEaXNrR2F0ZU1lbW9TdGF0ZSxcbiAgLy8gVGhlIGhhcmQtZGVueSBzd2l0Y2ggaXMgYSBwYXJhbWV0ZXIgKGRlZmF1bHRpbmcgdG8gdGhlIHNoaXBwZWQgY29uc3RhbnQpIHNvXG4gIC8vIHRoZSBkb2N1bWVudGVkIGZhbGxiYWNrIGJyYW5jaCBpcyBkaXJlY3RseSBleGVyY2lzYWJsZSBpbiB0ZXN0cyB3aXRob3V0XG4gIC8vIG11dGF0aW5nIGEgbW9kdWxlLWxldmVsIGNvbnN0LiBQcm9kdWN0aW9uIHdpcmluZyBuZXZlciBwYXNzZXMgdGhpcyBcdTIwMTQgdGhlXG4gIC8vIGRlZmF1bHQgZXhwb3J0IGJlbG93IGNvbnN0cnVjdHMgdGhlIGhhbmRsZXIgd2l0aCB0aGUgY29uc3RhbnQncyB2YWx1ZS5cbiAgaGFyZERlbnk6IGJvb2xlYW4gPSBDT0RFWF9HQVRFX0hBUkRfREVOWVxuKSB7XG4gIHJldHVybiBhc3luYyAoaW5wdXQ6IFByZVRvb2xVc2VJbnB1dCwgY3R4OiBIb29rQ29udGV4dCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICAvLyBMb2cgdGhlIG9ic2VydmVkIHNoZWxsIHRvb2xfbmFtZSBzbyB0aGUgZmlyc3QgbGl2ZSBydW4gcmV2ZWFscyB0aGUgbGl0ZXJhbFxuICAgICAgLy8gc3RyaW5nIHRvIG5hcnJvdyB0aGUgbWF0Y2hlciB0byAodGhlIHNwaWtlIG5ldmVyIGNvbmZpcm1lZCBpdCBlbXBpcmljYWxseSkuXG4gICAgICBjdHgubG9nZ2VyLmluZm8oJ2dpdC1zcGFuIGdhdGUgb2JzZXJ2ZWQgc2hlbGwgdG9vbCcsIHsgdG9vbF9uYW1lOiBpbnB1dC50b29sX25hbWUgfSk7XG5cbiAgICAgIGNvbnN0IGNvbW1hbmQgPSBleHRyYWN0U2hlbGxDb21tYW5kKGlucHV0LnRvb2xfaW5wdXQpO1xuICAgICAgaWYgKGNvbW1hbmQgPT09IG51bGwpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlR2l0Q29tbWFuZChjb21tYW5kKTtcbiAgICAgIGlmIChwYXJzZWQua2luZCA9PT0gJ25vbmUnKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgICBjb25zdCBjd2QgPSBpbnB1dC5jd2QgPz8gJyc7XG4gICAgICBjb25zdCBhbGwgPSBwYXJzZWQua2luZCA9PT0gJ2NvbW1pdCcgPyBjb21taXRTdGFnZXNBbGwoY29tbWFuZCkgOiBmYWxzZTtcbiAgICAgIGNvbnN0IGNoYW5nZXNldCA9IGF3YWl0IHJlc29sdmVDaGFuZ2VzZXQocGFyc2VkLmtpbmQsIGFsbCwgY3dkLCBnaXQsIHBhcnNlZC5wYXRocyk7XG5cbiAgICAgIGNvbnN0IG1vZGUgPSBwYXJzZWQua2luZCA9PT0gJ3N0YXR1cycgPyAnaW5mb3JtJyA6ICdlbmZvcmNlJztcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGV2YWx1YXRlR2F0ZShjaGFuZ2VzZXQsIGN3ZCwgZXhlY3V0b3JzLCBtZW1vRmFjdG9yeShjd2QpLCBtb2RlKTtcbiAgICAgIGlmIChyZXN1bHQuZGVjaXNpb24gIT09ICdkZW55Jykge1xuICAgICAgICAvLyBFbnZpcm9ubWVudGFsIHN0YWxlbmVzcyBhbmQgYSBmYWlsZWQgc3RhbGVuZXNzIHNjYW4gYm90aCBhbGxvd1xuICAgICAgICAvLyAoZmFpbC1vcGVuKSBidXQgbXVzdCBub3QgYmUgc3dhbGxvd2VkOiBsb2cgYW5kIHN1cmZhY2UgdGhlIHJlYXNvbiBhc1xuICAgICAgICAvLyBhZGRpdGlvbmFsIGNvbnRleHQuXG4gICAgICAgIGlmIChyZXN1bHQua2luZCA9PT0gJ2Vudmlyb25tZW50YWwnIHx8IHJlc3VsdC5raW5kID09PSAnc2Nhbi1mYWlsZWQnKSB7XG4gICAgICAgICAgY3R4LmxvZ2dlci53YXJuKCdnaXQtc3BhbiBnYXRlIGFsbG93ZWQgd2l0aCBhbiB1bnJlc29sdmVkIGNvbmRpdGlvbicsIHsgcmVhc29uOiByZXN1bHQucmVhc29uIH0pO1xuICAgICAgICAgIHJldHVybiBwcmVUb29sVXNlT3V0cHV0KHtcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiB3cmFwR2l0U3BhbkNvbnRleHQocmVzdWx0LnJlYXNvbiksXG4gICAgICAgICAgICBzeXN0ZW1NZXNzYWdlOiByZXN1bHQucmVhc29uXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gYHN0YXR1c2Atb25seSBhZHZpc29yeSBraW5kczogc3BhbiBkZWJ0IGV4aXN0cywgYnV0IGEgc3RhdHVzIGNoZWNrXG4gICAgICAgIC8vIG5ldmVyIGhvbGRzIHRoZSBjb21tYW5kIFx1MjAxNCBzdXJmYWNlIGl0IGFzIGluZm9ybWF0aW9uLCBub3QgYSB3YXJuaW5nLlxuICAgICAgICBpZiAocmVzdWx0LmtpbmQgPT09ICdzZW1hbnRpYy1zdGFsZW5lc3MtaW5mbycgfHwgcmVzdWx0LmtpbmQgPT09ICd1bmNvdmVyZWQtd3JpdGVzLWluZm8nKSB7XG4gICAgICAgICAgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoe1xuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IHdyYXBHaXRTcGFuQ29udGV4dChyZXN1bHQucmVhc29uKSxcbiAgICAgICAgICAgIHN5c3RlbU1lc3NhZ2U6IHJlc3VsdC5yZWFzb25cbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBpZiAoaGFyZERlbnkpIHtcbiAgICAgICAgLy8gUHJpbWFyeSBwYXRoIChwZXIgdGhlIFJFQURNRSk6IGFjdHVhbGx5IGJsb2NrIHRoZSBjb21tYW5kLlxuICAgICAgICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7XG4gICAgICAgICAgcGVybWlzc2lvbkRlY2lzaW9uOiAnZGVueScsXG4gICAgICAgICAgcGVybWlzc2lvbkRlY2lzaW9uUmVhc29uOiByZXN1bHQucmVhc29uLFxuICAgICAgICAgIHN5c3RlbU1lc3NhZ2U6IHJlc3VsdC5yZWFzb25cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICAvLyBGYWxsYmFjayBwYXRoIChDQVJELm1kIGNvbnRpbmdlbmN5KTogY2Fubm90IGJsb2NrLCBzbyBzdXJmYWNlIHRoZSBzYW1lXG4gICAgICAvLyBjaGVja2xpc3QgYXMgYSBsb3VkIHdhcm5pbmcgYW5kIGFsbG93IFx1MjAxNCB0aGUgQ0kgcmVjaXBlIGVuZm9yY2VzIGZvciBDb2RleC5cbiAgICAgIGNvbnN0IHdhcm5pbmcgPSBgQ291bGQgbm90IGJsb2NrIHRoaXMgY29tbWFuZCBcdTIwMTQgdGhlIGlzc3VlIGJlbG93IHN0aWxsIG5lZWRzIHJlc29sdmluZzpcXG4ke3Jlc3VsdC5yZWFzb259YDtcbiAgICAgIHJldHVybiBwcmVUb29sVXNlT3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IHdyYXBHaXRTcGFuQ29udGV4dCh3YXJuaW5nKSwgc3lzdGVtTWVzc2FnZTogd2FybmluZyB9KTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGN0eC5sb2dnZXIud2FybignZ2l0LXNwYW4gZ2F0ZSBmYWlsZWQgb3BlbiBvbiBhbiB1bmNhdWdodCBlcnJvcicsIHsgZXJyIH0pO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IHByZVRvb2xVc2VIb29rKHsgbWF0Y2hlcjogJ0Jhc2h8c2hlbGx8ZXhlY3xsb2NhbF9zaGVsbCcsIHRpbWVvdXQ6IDEwXzAwMCB9LCBjcmVhdGVIYW5kbGVyKCkpO1xuIiwgImltcG9ydCBob29rIGZyb20gXCIuL2dhdGUudHNcIjtcbmltcG9ydCB7IGV4ZWN1dGUgfSBmcm9tIFwiLi4vLi4vLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L3J1bnRpbWUuanNcIjtcbmV4ZWN1dGUoaG9vayk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBNEJPLElBQU0sMEJBQTBCLG9CQUFJLElBQUksQ0FBQyxnQkFBZ0Isb0JBQW9CLGVBQWUsQ0FBQzs7O0FDNUJwRyxTQUFTLGVBQWUsZUFBZSxRQUFRLFNBQVM7QUFDcEQsUUFBTSxPQUFPO0FBQ2IsT0FBSyxnQkFBZ0I7QUFDckIsT0FBSyxVQUFVLE9BQU87QUFDdEIsT0FBSyxnQkFBZ0IsT0FBTztBQUM1QixNQUFJLGFBQWEsVUFBVSxPQUFPLE9BQU8sWUFBWSxVQUFVO0FBQzNELFNBQUssVUFBVSxPQUFPO0FBQUEsRUFDMUI7QUFDQSxTQUFPO0FBQ1g7QUFDTyxTQUFTLGVBQWUsUUFBUSxTQUFTO0FBQzVDLFNBQU8sZUFBZSxjQUFjLFFBQVEsT0FBTztBQUN2RDs7O0FDWkEsU0FBUyxXQUFXLFlBQVksV0FBVyxVQUFVLGlCQUFpQjtBQUN0RSxTQUFTLGVBQWU7QUFDeEIsSUFBTSxzQkFBc0I7QUFDckIsSUFBTSxTQUFOLE1BQWE7QUFBQSxFQUNoQixXQUFXLG9CQUFJLElBQUk7QUFBQSxFQUNuQixrQkFBa0I7QUFBQSxFQUNsQixZQUFZO0FBQUEsRUFDWixjQUFjO0FBQUEsRUFDZDtBQUFBLEVBQ0E7QUFBQSxFQUNBLFlBQVksU0FBUyxDQUFDLEdBQUc7QUFDckIsU0FBSyxjQUFjLE9BQU8sZUFBZSxRQUFRLElBQUksT0FBTyxhQUFhLG1CQUFtQixLQUFLO0FBQUEsRUFDckc7QUFBQSxFQUNBLFdBQVcsVUFBVSxPQUFPO0FBQ3hCLFNBQUssa0JBQWtCO0FBQ3ZCLFNBQUssZUFBZTtBQUFBLEVBQ3hCO0FBQUEsRUFDQSxlQUFlO0FBQ1gsU0FBSyxrQkFBa0I7QUFDdkIs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UUFBTztBQUVuQyxZQUFNLE1BQU0sTUFBTSxPQUFPO0FBQ3pCLFlBQU0sTUFBTSxPQUFPLFNBQVMsV0FBVyxnQkFBZ0IsT0FBTyxJQUFJO0FBQ2xFLFlBQU0sWUFBWSxNQUFNLGlCQUFpQixPQUFPLE1BQU0sS0FBSyxLQUFLLEtBQUssT0FBTyxLQUFLO0FBRWpGLFlBQU0sT0FBTyxPQUFPLFNBQVMsV0FBVyxXQUFXO0FBQ25ELFlBQU0sU0FBUyxNQUFNLGFBQWEsV0FBVyxLQUFLLFdBQVcsWUFBWSxHQUFHLEdBQUcsSUFBSTtBQUNuRixVQUFJLE9BQU8sYUFBYSxRQUFRO0FBSTlCLFlBQUksT0FBTyxTQUFTLG1CQUFtQixPQUFPLFNBQVMsZUFBZTtBQUNwRSxjQUFJLE9BQU8sS0FBSyxzREFBc0QsRUFBRSxRQUFRLE9BQU8sT0FBTyxDQUFDO0FBQy9GLGlCQUFPLGlCQUFpQjtBQUFBLFlBQ3RCLG1CQUFtQixtQkFBbUIsT0FBTyxNQUFNO0FBQUEsWUFDbkQsZUFBZSxPQUFPO0FBQUEsVUFDeEIsQ0FBQztBQUFBLFFBQ0g7QUFHQSxZQUFJLE9BQU8sU0FBUyw2QkFBNkIsT0FBTyxTQUFTLHlCQUF5QjtBQUN4RixpQkFBTyxpQkFBaUI7QUFBQSxZQUN0QixtQkFBbUIsbUJBQW1CLE9BQU8sTUFBTTtBQUFBLFlBQ25ELGVBQWUsT0FBTztBQUFBLFVBQ3hCLENBQUM7QUFBQSxRQUNIO0FBQ0EsZUFBTztBQUFBLE1BQ1Q7QUFFQSxVQUFJLFVBQVU7QUFFWixlQUFPLGlCQUFpQjtBQUFBLFVBQ3RCLG9CQUFvQjtBQUFBLFVBQ3BCLDBCQUEwQixPQUFPO0FBQUEsVUFDakMsZUFBZSxPQUFPO0FBQUEsUUFDeEIsQ0FBQztBQUFBLE1BQ0g7QUFHQSxZQUFNLFVBQVU7QUFBQSxFQUEwRSxPQUFPLE1BQU07QUFDdkcsYUFBTyxpQkFBaUIsRUFBRSxtQkFBbUIsbUJBQW1CLE9BQU8sR0FBRyxlQUFlLFFBQVEsQ0FBQztBQUFBLElBQ3BHLFNBQVMsS0FBSztBQUNaLFVBQUksT0FBTyxLQUFLLGtEQUFrRCxFQUFFLElBQUksQ0FBQztBQUN6RSxhQUFPO0FBQUEsSUFDVDtBQUFBLEVBQ0Y7QUFDRjtBQUVBLElBQU8sZUFBUSxlQUFlLEVBQUUsU0FBUywrQkFBK0IsU0FBUyxJQUFPLEdBQUcsY0FBYyxDQUFDOzs7QUNwSjFHLFFBQVEsWUFBSTsiLAogICJuYW1lcyI6IFsicmVzb2x2ZSIsICJleGVjRmlsZVN5bmMiLCAiZnMiLCAibm9kZVBhdGgiLCAiZnMiLCAibm9kZVBhdGgiLCAiZnMiLCAibm9kZVBhdGgiLCAiY2FuZGlkYXRlcyIsICJzdGFnZWQiLCAidHJhY2tlZCIsICJzZWVuIiwgInVuY292ZXJlZCIsICJjb3ZlcmluZyIsICJjbG9zaW5nIiwgImJvZHkiLCAiZXhlY0ZpbGVTeW5jIl0KfQo=

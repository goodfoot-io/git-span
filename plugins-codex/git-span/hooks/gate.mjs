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
function commitStagesAll(command) {
  for (const segment of splitSegments(command)) {
    const inv = matchGitInvocation(tokenize(segment));
    if (!inv || inv.subcommand !== "commit") continue;
    const dashDash = inv.args.indexOf("--");
    const flagArgs = dashDash >= 0 ? inv.args.slice(0, dashDash) : inv.args;
    for (const arg of flagArgs) {
      if (arg === "--all") return true;
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
async function resolveChangeset(kind, all, cwd, git) {
  if (kind === "push") {
    return git.outgoingPaths(cwd);
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
    const findings = staleRows.filter((row) => isDebt(row.status));
    if (findings.length > 0) {
      return { decision: "deny", kind: "semantic-staleness", findings, reason: renderStalenessReason(findings) };
    }
    const covering = await executors.list(paths, cwd);
    const covered = new Set(covering.map((row) => row.path));
    const repoRoot = resolveRepoRoot(cwd);
    const gateIgnoreRules = repoRoot ? loadGateIgnore(repoRoot) : [];
    const uncovered = paths.filter(
      (path) => !covered.has(path) && !isInsideSpanRoot(path) && !isGateIgnored(gateIgnoreRules, path)
    );
    if (uncovered.length === 0) return { decision: "allow", kind: "silent" };
    const digest = gateStateDigest(findings, uncovered);
    if (memoState.has(digest)) return { decision: "allow", kind: "already-presented" };
    memoState.record(digest);
    return { decision: "deny", kind: "uncovered-writes", uncovered, reason: renderUncoveredReason(uncovered) };
  } catch {
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
        const captured = err.stdout;
        if (typeof captured === "string") out = captured;
        else return [];
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
    return { has: () => false, record: () => {
    } };
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
      } catch {
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
function createHandler(git = createDefaultGitExecutor(), executors = createDefaultGateExecutors(), memoFactory = createDiskGateMemoState, env = process.env) {
  return async (input, ctx) => {
    try {
      ctx.logger.info("git-span gate observed shell tool", { tool_name: input.tool_name });
      const command = extractShellCommand(input.tool_input);
      if (command === null) return preToolUseOutput({});
      const parsed = parseGitCommand(command);
      if (parsed.kind === "none") return preToolUseOutput({});
      if (isGateSkipped(env)) {
        return preToolUseOutput({ systemMessage: SKIP_NOTICE });
      }
      const cwd = input.cwd ?? "";
      const all = parsed.kind === "commit" ? commitStagesAll(command) : false;
      const changeset = await resolveChangeset(parsed.kind, all, cwd, git);
      const result = await evaluateGate(changeset, cwd, executors, memoFactory(cwd));
      if (result.decision !== "deny") return preToolUseOutput({});
      if (CODEX_GATE_HARD_DENY) {
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2NvbnN0YW50cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2dhdGUtY29yZS50cyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL2dhdGUtaWdub3JlLnRzIiwgInNyYy9jb21tb24vc3Bhbi1pZ25vcmUudHMiLCAic3JjL2NvZGV4L2dhdGUudHMiLCAic3JjL2NvZGV4L2dhdGUtZW50cnkudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImV4cG9ydCBjb25zdCBQQUNLQUdFX05BTUUgPSBcIkBnb29kZm9vdC9jb2RleC1ob29rc1wiO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfVElNRU9VVF9NUyA9IDYwMF8wMDA7XG5leHBvcnQgY29uc3QgREVGQVVMVF9TVEFUVVNfTUVTU0FHRSA9IHVuZGVmaW5lZDtcbmV4cG9ydCBjb25zdCBERUZBVUxUX0VTQlVJTERfTE9BREVSUyA9IHtcbiAgICBcIi5tZFwiOiBcInRleHRcIixcbn07XG5leHBvcnQgY29uc3QgSE9PS19GQUNUT1JZX1RPX0VWRU5UID0ge1xuICAgIHByZVRvb2xVc2VIb29rOiBcIlByZVRvb2xVc2VcIixcbiAgICBwb3N0VG9vbFVzZUhvb2s6IFwiUG9zdFRvb2xVc2VcIixcbiAgICBwZXJtaXNzaW9uUmVxdWVzdEhvb2s6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICB1c2VyUHJvbXB0U3VibWl0SG9vazogXCJVc2VyUHJvbXB0U3VibWl0XCIsXG4gICAgc2Vzc2lvblN0YXJ0SG9vazogXCJTZXNzaW9uU3RhcnRcIixcbiAgICBzdWJhZ2VudFN0YXJ0SG9vazogXCJTdWJhZ2VudFN0YXJ0XCIsXG4gICAgc3RvcEhvb2s6IFwiU3RvcFwiLFxuICAgIHN1YmFnZW50U3RvcEhvb2s6IFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgcHJlQ29tcGFjdEhvb2s6IFwiUHJlQ29tcGFjdFwiLFxuICAgIHBvc3RDb21wYWN0SG9vazogXCJQb3N0Q29tcGFjdFwiLFxufTtcbmV4cG9ydCBjb25zdCBFVkVOVFNfV0lUSF9NQVRDSEVSID0gbmV3IFNldChbXG4gICAgXCJQcmVUb29sVXNlXCIsXG4gICAgXCJQb3N0VG9vbFVzZVwiLFxuICAgIFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICBcIlNlc3Npb25TdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgXCJQcmVDb21wYWN0XCIsXG4gICAgXCJQb3N0Q29tcGFjdFwiLFxuXSk7XG5leHBvcnQgY29uc3QgRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQgPSBuZXcgU2V0KFtcIlNlc3Npb25TdGFydFwiLCBcIlVzZXJQcm9tcHRTdWJtaXRcIiwgXCJTdWJhZ2VudFN0YXJ0XCJdKTtcbiIsICJmdW5jdGlvbiBhdHRhY2hNZXRhZGF0YShob29rRXZlbnROYW1lLCBjb25maWcsIGhhbmRsZXIpIHtcbiAgICBjb25zdCBob29rID0gaGFuZGxlcjtcbiAgICBob29rLmhvb2tFdmVudE5hbWUgPSBob29rRXZlbnROYW1lO1xuICAgIGhvb2sudGltZW91dCA9IGNvbmZpZy50aW1lb3V0O1xuICAgIGhvb2suc3RhdHVzTWVzc2FnZSA9IGNvbmZpZy5zdGF0dXNNZXNzYWdlO1xuICAgIGlmIChcIm1hdGNoZXJcIiBpbiBjb25maWcgJiYgdHlwZW9mIGNvbmZpZy5tYXRjaGVyID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGhvb2subWF0Y2hlciA9IGNvbmZpZy5tYXRjaGVyO1xuICAgIH1cbiAgICByZXR1cm4gaG9vaztcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQcmVUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBvc3RUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcGVybWlzc2lvblJlcXVlc3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gdXNlclByb21wdFN1Ym1pdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiVXNlclByb21wdFN1Ym1pdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25TdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU2Vzc2lvblN0YXJ0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3ViYWdlbnRTdGFydFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN0b3BcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN1YmFnZW50U3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlByZUNvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUG9zdENvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbiIsICJpbXBvcnQgeyBjbG9zZVN5bmMsIGV4aXN0c1N5bmMsIG1rZGlyU3luYywgb3BlblN5bmMsIHdyaXRlU3luYyB9IGZyb20gXCJub2RlOmZzXCI7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuY29uc3QgREVGQVVMVF9MT0dfRU5WX1ZBUiA9IFwiQ09ERVhfSE9PS1NfTE9HX0ZJTEVcIjtcbmV4cG9ydCBjbGFzcyBMb2dnZXIge1xuICAgIGhhbmRsZXJzID0gbmV3IE1hcCgpO1xuICAgIGZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIGxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgbG9nRmlsZVBhdGggPSBudWxsO1xuICAgIGN1cnJlbnRIb29rVHlwZTtcbiAgICBjdXJyZW50SW5wdXQ7XG4gICAgY29uc3RydWN0b3IoY29uZmlnID0ge30pIHtcbiAgICAgICAgdGhpcy5sb2dGaWxlUGF0aCA9IGNvbmZpZy5sb2dGaWxlUGF0aCA/PyBwcm9jZXNzLmVudltjb25maWcubG9nRW52VmFyID8/IERFRkFVTFRfTE9HX0VOVl9WQVJdID8/IG51bGw7XG4gICAgfVxuICAgIHNldENvbnRleHQoaG9va1R5cGUsIGlucHV0KSB7XG4gICAgICAgIHRoaXMuY3VycmVudEhvb2tUeXBlID0gaG9va1R5cGU7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gaW5wdXQ7XG4gICAgfVxuICAgIGNsZWFyQ29udGV4dCgpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50SG9va1R5cGUgPSB1bmRlZmluZWQ7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBvbihsZXZlbCwgaGFuZGxlcikge1xuICAgICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKSA/PyBuZXcgU2V0KCk7XG4gICAgICAgIGV4aXN0aW5nLmFkZChoYW5kbGVyKTtcbiAgICAgICAgdGhpcy5oYW5kbGVycy5zZXQobGV2ZWwsIGV4aXN0aW5nKTtcbiAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgIGV4aXN0aW5nLmRlbGV0ZShoYW5kbGVyKTtcbiAgICAgICAgICAgIGlmIChleGlzdGluZy5zaXplID09PSAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5oYW5kbGVycy5kZWxldGUobGV2ZWwpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgIH1cbiAgICBkZWJ1ZyhtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImRlYnVnXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICBpbmZvKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiaW5mb1wiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgd2FybihtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcIndhcm5cIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGVycm9yKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZXJyb3JcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGxvZ0Vycm9yKGVycm9yLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImVycm9yXCIsIGAke21lc3NhZ2V9OiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLCBjb250ZXh0KTtcbiAgICB9XG4gICAgY2xvc2UoKSB7XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgY2xvc2VTeW5jKHRoaXMubG9nRmlsZUZkKTtcbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cbiAgICBlbWl0KGxldmVsLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0ge1xuICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICBsZXZlbCxcbiAgICAgICAgICAgIGhvb2tUeXBlOiB0aGlzLmN1cnJlbnRIb29rVHlwZSxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICAuLi4odGhpcy5jdXJyZW50SW5wdXQgIT09IHVuZGVmaW5lZCA/IHsgaW5wdXQ6IHRoaXMuY3VycmVudElucHV0IH0gOiB7fSksXG4gICAgICAgICAgICAuLi4oY29udGV4dCAhPT0gdW5kZWZpbmVkID8geyBjb250ZXh0IH0gOiB7fSksXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMud3JpdGVUb0ZpbGUoZXZlbnQpO1xuICAgICAgICB0aGlzLmhhbmRsZXJzLmdldChsZXZlbCk/LmZvckVhY2goKGhhbmRsZXIpID0+IHtcbiAgICAgICAgICAgIGhhbmRsZXIoZXZlbnQpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgd3JpdGVUb0ZpbGUoZXZlbnQpIHtcbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZVBhdGggPT09IG51bGwpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXRoaXMuZmlsZUluaXRpYWxpemVkKSB7XG4gICAgICAgICAgICB0aGlzLmZpbGVJbml0aWFsaXplZCA9IHRydWU7XG4gICAgICAgICAgICBjb25zdCBsb2dEaXIgPSBkaXJuYW1lKHRoaXMubG9nRmlsZVBhdGgpO1xuICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKGxvZ0RpcikpIHtcbiAgICAgICAgICAgICAgICBta2RpclN5bmMobG9nRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gb3BlblN5bmModGhpcy5sb2dGaWxlUGF0aCwgXCJhXCIpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgd3JpdGVTeW5jKHRoaXMubG9nRmlsZUZkLCBgJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuYCk7XG4gICAgICAgIH1cbiAgICB9XG59XG5leHBvcnQgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcigpO1xuIiwgImV4cG9ydCBjb25zdCBFWElUX0NPREVTID0ge1xuICAgIFNVQ0NFU1M6IDAsXG4gICAgRVJST1I6IDEsXG4gICAgQkxPQ0s6IDIsXG59O1xuZXhwb3J0IGNsYXNzIEJsb2NrRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gICAgcmVhc29uO1xuICAgIGNvbnN0cnVjdG9yKHJlYXNvbikge1xuICAgICAgICBzdXBlcihyZWFzb24pO1xuICAgICAgICB0aGlzLm5hbWUgPSBcIkJsb2NrRXJyb3JcIjtcbiAgICAgICAgdGhpcy5yZWFzb24gPSByZWFzb247XG4gICAgfVxufVxuZnVuY3Rpb24gb21pdFVuZGVmaW5lZCh2YWx1ZSkge1xuICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModmFsdWUpLmZpbHRlcigoWywgZW50cnldKSA9PiBlbnRyeSAhPT0gdW5kZWZpbmVkKSk7XG59XG5mdW5jdGlvbiBidWlsZE91dHB1dCh0eXBlLCBzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiB7XG4gICAgICAgIF90eXBlOiB0eXBlLFxuICAgICAgICBzdGRvdXQ6IG9taXRVbmRlZmluZWQoc3Rkb3V0KSxcbiAgICAgICAgLi4uKHN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRlcnIgfSA6IHt9KSxcbiAgICB9O1xufVxuZXhwb3J0IGZ1bmN0aW9uIHJhd091dHB1dChzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlJhd1wiLCBzdGRvdXQsIHN0ZGVycik7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvbiAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy51cGRhdGVkSW5wdXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBoYXNTcGVjaWZpY1xuICAgICAgICA/IG9taXRVbmRlZmluZWQoe1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQcmVUb29sVXNlXCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvbjogb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb24sXG4gICAgICAgICAgICBwZXJtaXNzaW9uRGVjaXNpb25SZWFzb246IG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uLFxuICAgICAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgfSlcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlVG9vbFVzZVwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZUxlZ2FjeUJsb2NrT3V0cHV0KG9wdGlvbnMpIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVUb29sVXNlXCIsIHtcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fCBvcHRpb25zLnVwZGF0ZWRNQ1BUb29sT3V0cHV0ICE9PSB1bmRlZmluZWQ7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gaGFzU3BlY2lmaWNcbiAgICAgICAgPyBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUG9zdFRvb2xVc2VcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICAgICAgdXBkYXRlZE1DUFRvb2xPdXRwdXQ6IG9wdGlvbnMudXBkYXRlZE1DUFRvb2xPdXRwdXQsXG4gICAgICAgIH0pXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBvc3RUb29sVXNlXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uUmVxdWVzdE91dHB1dChvcHRpb25zKSB7XG4gICAgY29uc3QgZGVjaXNpb24gPSBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgYmVoYXZpb3I6IG9wdGlvbnMuYmVoYXZpb3IsXG4gICAgICAgIG1lc3NhZ2U6IG9wdGlvbnMubWVzc2FnZSxcbiAgICAgICAgaW50ZXJydXB0OiBvcHRpb25zLmludGVycnVwdCxcbiAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgdXBkYXRlZFBlcm1pc3Npb25zOiBvcHRpb25zLnVwZGF0ZWRQZXJtaXNzaW9ucyxcbiAgICB9KTtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSB7XG4gICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICAgICAgZGVjaXNpb24sXG4gICAgfTtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQZXJtaXNzaW9uUmVxdWVzdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiVXNlclByb21wdFN1Ym1pdFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiVXNlclByb21wdFN1Ym1pdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiU2Vzc2lvblN0YXJ0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTZXNzaW9uU3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlN1YmFnZW50U3RhcnRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3RvcE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTdG9wXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdG9wT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RvcFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlQ29tcGFjdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdENvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUG9zdENvbXBhY3RcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgIH0pO1xufVxuIiwgImltcG9ydCB7IEVWRU5UU19XSVRIX1RFWFRfT1VUUFVUIH0gZnJvbSBcIi4vY29uc3RhbnRzLmpzXCI7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tIFwiLi9sb2dnZXIuanNcIjtcbmltcG9ydCB7IEJsb2NrRXJyb3IsIEVYSVRfQ09ERVMsIHNlc3Npb25TdGFydE91dHB1dCwgc3ViYWdlbnRTdGFydE91dHB1dCwgdXNlclByb21wdFN1Ym1pdE91dHB1dCwgfSBmcm9tIFwiLi9vdXRwdXRzLmpzXCI7XG5hc3luYyBmdW5jdGlvbiByZWFkU3RkaW4oKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgY2h1bmtzID0gW107XG4gICAgICAgIHByb2Nlc3Muc3RkaW4uc2V0RW5jb2RpbmcoXCJ1dGYtOFwiKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImRhdGFcIiwgKGNodW5rKSA9PiBjaHVua3MucHVzaChjaHVuaykpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZW5kXCIsICgpID0+IHJlc29sdmUoY2h1bmtzLmpvaW4oXCJcIikpKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImVycm9yXCIsIHJlamVjdCk7XG4gICAgfSk7XG59XG5mdW5jdGlvbiBwYXJzZVN0ZGluSW5wdXQoc3RkaW5Db250ZW50KSB7XG4gICAgcmV0dXJuIEpTT04ucGFyc2Uoc3RkaW5Db250ZW50KTtcbn1cbmZ1bmN0aW9uIHdyaXRlU3Rkb3V0KG91dHB1dCkge1xuICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKEpTT04uc3RyaW5naWZ5KG91dHB1dC5zdGRvdXQpKTtcbn1cbmZ1bmN0aW9uIG5vcm1hbGl6ZVN0cmluZ091dHB1dChob29rRXZlbnROYW1lLCByZXN1bHQpIHtcbiAgICBpZiAoIUVWRU5UU19XSVRIX1RFWFRfT1VUUFVULmhhcyhob29rRXZlbnROYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7aG9va0V2ZW50TmFtZX0gaG9va3MgY2Fubm90IHJldHVybiBwbGFpbiB0ZXh0YCk7XG4gICAgfVxuICAgIGlmIChob29rRXZlbnROYW1lID09PSBcIlNlc3Npb25TdGFydFwiKSB7XG4gICAgICAgIHJldHVybiBzZXNzaW9uU3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICBpZiAoaG9va0V2ZW50TmFtZSA9PT0gXCJTdWJhZ2VudFN0YXJ0XCIpIHtcbiAgICAgICAgcmV0dXJuIHN1YmFnZW50U3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICByZXR1cm4gdXNlclByb21wdFN1Ym1pdE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gY29udmVydFRvSG9va091dHB1dChvdXRwdXQpIHtcbiAgICByZXR1cm4gb3V0cHV0LnN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQsIHN0ZGVycjogb3V0cHV0LnN0ZGVyciB9IDogeyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQgfTtcbn1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBleGVjdXRlKGhvb2tGbikge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHN0ZGluQ29udGVudCA9IGF3YWl0IHJlYWRTdGRpbigpO1xuICAgICAgICBjb25zdCBpbnB1dCA9IHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpO1xuICAgICAgICBsb2dnZXIuc2V0Q29udGV4dChob29rRm4uaG9va0V2ZW50TmFtZSwgaW5wdXQpO1xuICAgICAgICBjb25zdCBjb250ZXh0ID0geyBsb2dnZXIgfTtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaG9va0ZuKGlucHV0LCBjb250ZXh0KTtcbiAgICAgICAgbGV0IG91dHB1dCA9IHsgc3Rkb3V0OiB7fSB9O1xuICAgICAgICBpZiAodHlwZW9mIHJlc3VsdCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgb3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChub3JtYWxpemVTdHJpbmdPdXRwdXQoaG9va0ZuLmhvb2tFdmVudE5hbWUsIHJlc3VsdCkpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHJlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBvdXRwdXQgPSBjb252ZXJ0VG9Ib29rT3V0cHV0KHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgICAgd3JpdGVTdGRvdXQob3V0cHV0KTtcbiAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuU1VDQ0VTUyk7XG4gICAgfVxuICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBCbG9ja0Vycm9yKSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtlcnJvci5yZWFzb259XFxuYCk7XG4gICAgICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5CTE9DSyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke2Vycm9yLnN0YWNrID8/IGVycm9yLm1lc3NhZ2V9XFxuYCk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtTdHJpbmcoZXJyb3IpfVxcbmApO1xuICAgICAgICB9XG4gICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLkVSUk9SKTtcbiAgICB9XG4gICAgZmluYWxseSB7XG4gICAgICAgIGxvZ2dlci5jbGVhckNvbnRleHQoKTtcbiAgICAgICAgbG9nZ2VyLmNsb3NlKCk7XG4gICAgfVxufVxuIiwgIi8qKlxuICogSGFybmVzcy1hZ25vc3RpYyBnYXRlIGNvcmUgKFBoYXNlIDMuMSBcdTIwMTQgY29udHJhY3QgYW5kIHN0dWJzKS5cbiAqXG4gKiBUaGlzIG1vZHVsZSBkZWNsYXJlcyB0aGUgUHJlVG9vbFVzZSBcImdhdGVcIiB0aGF0IGJvdGggdGhlIENsYXVkZSAoYEJhc2hgKSBhbmRcbiAqIENvZGV4IChzaGVsbC9leGVjKSBhZGFwdGVycyB3aWxsIGRyaXZlOiB3aGVuIHRoZSBhZ2VudCBydW5zIGBnaXQgY29tbWl0YCBvclxuICogYGdpdCBwdXNoYCBhbmQgdGhlIGNoYW5nZXNldCBpdCBpcyBhYm91dCB0byBsYW5kIGNhcnJpZXMgcmVhbCBzcGFuIGRlYnQsIHRoZVxuICogY29tbWFuZCBpcyBoZWxkIHdpdGggYSBjaGVja2xpc3Q7IHBvc2l0aW9uYWwgZHJpZnQgdGhlIHRvdWNoIGhvb2sgaGFzIGJlZW5cbiAqIGhlYWxpbmcgYWxsIGFsb25nIG5ldmVyIGJsb2Nrcy4gTGlrZSB7QGxpbmsgZmlsZTovLy4vdG91Y2gtY29yZS50c30gaXQgaW1wb3J0c1xuICogbm90aGluZyBmcm9tIGVpdGhlciBob29rIFNESyBhbmQgaXMgdHlwZWQgc3RydWN0dXJhbGx5LCBwZXIgdGhlIGBjb21tb24vYFxuICogbGF5ZXIgY29udmVudGlvbjogYWRhcHRlcnMgdHJhbnNsYXRlIHRoZWlyIFNESy1zcGVjaWZpYyBob29rIGlucHV0IGludG8gYVxuICogY29tbWFuZCBzdHJpbmcgKyBjd2QsIGluamVjdCBleGVjdXRpb24vc3RhdGUgZGVwZW5kZW5jaWVzLCBhbmQgdHJhbnNsYXRlIHRoZVxuICogcmV0dXJuZWQge0BsaW5rIEdhdGVSZXN1bHR9IGludG8gdGhlaXIgb3duIGRlbnkvYWxsb3cgb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogZ2F0ZS1jb3JlIGlzIGEgc2libGluZyBvZiB0b3VjaC1jb3JlLCBub3QgYSBkZXBlbmRlbnQ6IHRoZSB0d28gY29yZXMgYXJlXG4gKiBpbmRlcGVuZGVudCBhbmQgdGhpcyBtb2R1bGUgaW1wb3J0cyBub3RoaW5nIGZyb20gYHRvdWNoLWNvcmUudHNgLlxuICpcbiAqIFJldXNlZCBmcm9tIHRoZSBzaGFyZWQga2VybmVsIChub3QgcmVkZWZpbmVkKTogYGlzRGVidCgpYCAodGhlIHNpbmdsZVxuICogc291cmNlIG9mIHRydXRoIGZvciB0aGUgc2VtYW50aWMtb25seSBkZWJ0IGludmFyaWFudCBcdTIwMTQgYE1PVkVEYCBhbmRcbiAqIGBSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgYXJlIG5ldmVyIGRlYnQpLCB0aGUgcG9yY2VsYWluIHN0YXR1cyB2b2NhYnVsYXJ5XG4gKiAoYFBvcmNlbGFpblN0YXR1c2AvYFBvcmNlbGFpblJvd2AvYFN0YWxlUG9yY2VsYWluUm93YCksIGFuZCBgZ2F0ZU1lbW9EaXIoKWBcbiAqICh0aGUgYDxnaXQtY29tbW9uLWRpcj4vZ2l0LXNwYW4vZ2F0ZS9gIHBhdGggdGhlIGRpc2stYmFja2VkXG4gKiB7QGxpbmsgR2F0ZU1lbW9TdGF0ZX0gd2lsbCBwZXJzaXN0IHVuZGVyKSBcdTIwMTQgYWxsIGZyb20gYWdlbnQtaG9va3MtY29tbW9uLnRzLlxuICpcbiAqIEV2ZXJ5IGZ1bmN0aW9uIHdob3NlIHJlc3VsdCBkZXBlbmRzIG9uIHJlYWwgbG9naWMgaXMgYSBgTm90IEltcGxlbWVudGVkYCBzdHViXG4gKiBpbiB0aGlzIHBoYXNlOyBQaGFzZSAzLjIgd3JpdGVzIHNraXBwZWQgY2hlY2tzIGFnYWluc3QgdGhlc2Ugc2lnbmF0dXJlcyBhbmRcbiAqIFBoYXNlIDMuMyBpbXBsZW1lbnRzIHRoZW0uIFRoZSBvbmUgZXhjZXB0aW9uIGlzIHtAbGluayBpc0dhdGVTa2lwcGVkfSwgd2hpY2hcbiAqIGlzIHB1cmUgYW5kIGZ1bGx5IHNwZWNpZmllZCBieSBDQVJELm1kLCBzbyBpdCBpcyBpbXBsZW1lbnRlZCBoZXJlIChzZWUgaXRzXG4gKiBkb2MgY29tbWVudCBmb3IgdGhlIHJhdGlvbmFsZSkuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tICdub2RlOmNyeXB0byc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQge1xuICBnYXRlTWVtb0RpcixcbiAgaXNEZWJ0LFxuICBpc0luc2lkZVNwYW5Sb290LFxuICB0eXBlIFBvcmNlbGFpblJvdyxcbiAgcGFyc2VQb3JjZWxhaW4sXG4gIHBhcnNlU3RhbGVQb3JjZWxhaW4sXG4gIHJlc29sdmVSZXBvUm9vdCxcbiAgdHlwZSBTdGFsZVBvcmNlbGFpblJvdyxcbiAgdG9Qb3NpeFxufSBmcm9tICcuL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyBpc0dhdGVJZ25vcmVkLCBsb2FkR2F0ZUlnbm9yZSB9IGZyb20gJy4vZ2F0ZS1pZ25vcmUuanMnO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENvbW1hbmQgcGFyc2luZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogVGhlIGtpbmQgb2YgZ2F0ZWQgZ2l0IGNvbW1hbmQgYSBzaGVsbCBjb21tYW5kIHN0cmluZyByZXNvbHZlcyB0by4gYCdub25lJ2BcbiAqIGlzIHRoZSBjb25zZXJ2YXRpdmUgZmFpbC1vcGVuIGFuc3dlcjogYW55IHNoYXBlIHtAbGluayBwYXJzZUdpdENvbW1hbmR9IGRvZXNcbiAqIG5vdCBjb25maWRlbnRseSByZWNvZ25pemUgYXMgYSBgZ2l0IGNvbW1pdGAvYGdpdCBwdXNoYCBtYXBzIHRvIGAnbm9uZSdgIGFuZFxuICogdGhlIGdhdGUgYWxsb3dzIHRoZSBjb21tYW5kIHRocm91Z2ggdW50b3VjaGVkLlxuICovXG5leHBvcnQgdHlwZSBHaXRDb21tYW5kS2luZCA9ICdjb21taXQnIHwgJ3B1c2gnIHwgJ25vbmUnO1xuXG4vKipcbiAqIFRoZSByZXN1bHQgb2YgcGFyc2luZyBhIHNoZWxsIGNvbW1hbmQgc3RyaW5nIGZvciBhIGdhdGVkIGdpdCBpbnZvY2F0aW9uLlxuICpcbiAqIGBwYXRoc2AgY2FycmllcyBvbmx5IHdoYXQgaXMgcGFyc2VhYmxlIGZyb20gdGhlIGNvbW1hbmQgbGluZSBpdHNlbGYgXHUyMDE0IHRoZVxuICogZXhwbGljaXQgcGF0aHNwZWNzIGEgYGdpdCBjb21taXQgLS0gPHBhdGg+XHUyMDI2YCBmb3JtIG5hbWVzLiBJdCBpcyBkZWxpYmVyYXRlbHlcbiAqICpub3QqIHRoZSBjaGFuZ2VzZXQ6IHRoZSBmdWxsZXIgcmVzb2x1dGlvbiAoc3RhZ2VkIGZpbGVzLCB0aGUgYC1hYC9gLWFtYFxuICogZXhwYW5zaW9uIGFnYWluc3QgdHJhY2tlZC1tb2RpZmllZCBmaWxlcywgdGhlIG91dGdvaW5nIHB1c2ggcmFuZ2UpIGlzXG4gKiB7QGxpbmsgcmVzb2x2ZUNoYW5nZXNldH0ncyBqb2IsIGRyaXZlbiBmcm9tIHRoZSByZXBvIHN0YXRlLCBub3QgZnJvbSB0aGVcbiAqIGNvbW1hbmQgdGV4dC4gYHBhdGhzYCBpcyBvbWl0dGVkIHdoZW4gdGhlIGNvbW1hbmQgbmFtZXMgbm8gZXhwbGljaXRcbiAqIHBhdGhzcGVjLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFBhcnNlZEdpdENvbW1hbmQge1xuICBraW5kOiBHaXRDb21tYW5kS2luZDtcbiAgcGF0aHM/OiBzdHJpbmdbXTtcbn1cblxuLyoqXG4gKiBXb3JkLWJvdW5kYXJ5IHBhcnNlIG9mIGEgYGdpdCBjb21taXRgIC8gYGdpdCBwdXNoYCBpbnZvY2F0aW9uIGVtYmVkZGVkIGluIGFuXG4gKiBhcmJpdHJhcnkgc2hlbGwgY29tbWFuZCBzdHJpbmcuXG4gKlxuICogTXVzdCByZWNvZ25pemUgdGhlIHJlYWwgc2hhcGVzIGNvbW1pdHMgYW5kIHB1c2hlcyBhcnJpdmUgaW46IGNoYWluZWRcbiAqIGNvbW1hbmRzIChgXHUyMDI2ICYmIGdpdCBjb21taXQgXHUyMDI2YCwgYFx1MjAyNjsgZ2l0IHB1c2hgLCBgXHUyMDI2IHwgXHUyMDI2YCksIGFuIGV4cGxpY2l0IHJlcG8gdmlhXG4gKiBgZ2l0IC1DIDxkaXI+IGNvbW1pdCBcdTIwMjZgLCB0cmFpbGluZyBwYXRoc3BlY3MgYWZ0ZXIgYC0tYCwgdGhlIGAtYWAvYC1hbWBcbiAqIFwiY29tbWl0IGFsbCB0cmFja2VkLW1vZGlmaWVkXCIgZm9ybXMsIGFuZCBpbnZvY2F0aW9uIGZyb20gYSBjd2QgYmVsb3cgdGhlIHJlcG9cbiAqIHJvb3QuIE1hdGNoaW5nIGlzIG9uIHdvcmQgYm91bmRhcmllcywgbmV2ZXIgc3Vic3RyaW5nOiBhIHBhdGggb3IgbWVzc2FnZSB0aGF0XG4gKiBtZXJlbHkgY29udGFpbnMgdGhlIHRleHQgYGdpdCBjb21taXRgIG11c3Qgbm90IHRyaXAgdGhlIGdhdGUuXG4gKlxuICogQ29uc2VydmF0aXZlIGJ5IGNvbnRyYWN0OiB0aGlzIGlzIHRoZSBmYWlsLW9wZW4gcG9pbnQgYXQgdGhlIHBhcnNlIGxheWVyLCBub3RcbiAqIGEgcGxhY2UgdG8gZ3Vlc3MuIEFueSBjb21tYW5kIHdob3NlIHNoYXBlIGlzIG5vdCBjb25maWRlbnRseSBhIGdhdGVkXG4gKiBgZ2l0IGNvbW1pdGAvYGdpdCBwdXNoYCBcdTIwMTQgYW4gdW5mYW1pbGlhciBzdWJjb21tYW5kLCBhbiBhbGlhcywgYW4gb2JmdXNjYXRlZFxuICogb3IgZHluYW1pY2FsbHktYnVpbHQgaW52b2NhdGlvbiBcdTIwMTQgcmV0dXJucyBgeyBraW5kOiAnbm9uZScgfWAgc28gdGhlIGdhdGVcbiAqIGFsbG93cyBpdCByYXRoZXIgdGhhbiBkZW55aW5nIG9uIGEgc2hha3kgcmVhZC4gKFNlZSBDQVJELm1kIFwiUmlza3MgYW5kXG4gKiByZXF1aXJlZCBzcGlrZXMgXHUyMTkyIENvbW1hbmQgcGFyc2luZ1wiIGFuZCBkZXNpZ24tZGVjaXNpb25zLm1kICMxLilcbiAqXG4gKiBAcGFyYW0gY29tbWFuZCBUaGUgcmF3IHNoZWxsIGNvbW1hbmQgc3RyaW5nIGZyb20gdGhlIGhvb2sncyB0b29sIGlucHV0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VHaXRDb21tYW5kKGNvbW1hbmQ6IHN0cmluZyk6IFBhcnNlZEdpdENvbW1hbmQge1xuICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc3BsaXRTZWdtZW50cyhjb21tYW5kKSkge1xuICAgIGNvbnN0IGludiA9IG1hdGNoR2l0SW52b2NhdGlvbih0b2tlbml6ZShzZWdtZW50KSk7XG4gICAgaWYgKCFpbnYpIGNvbnRpbnVlO1xuICAgIGlmIChpbnYuc3ViY29tbWFuZCA9PT0gJ2NvbW1pdCcpIHtcbiAgICAgIGNvbnN0IGRhc2hEYXNoID0gaW52LmFyZ3MuaW5kZXhPZignLS0nKTtcbiAgICAgIGNvbnN0IHBhdGhzID0gZGFzaERhc2ggPj0gMCA/IGludi5hcmdzLnNsaWNlKGRhc2hEYXNoICsgMSkuZmlsdGVyKChwKSA9PiBwLmxlbmd0aCA+IDApIDogW107XG4gICAgICByZXR1cm4gcGF0aHMubGVuZ3RoID4gMCA/IHsga2luZDogJ2NvbW1pdCcsIHBhdGhzIH0gOiB7IGtpbmQ6ICdjb21taXQnIH07XG4gICAgfVxuICAgIGlmIChpbnYuc3ViY29tbWFuZCA9PT0gJ3B1c2gnKSB7XG4gICAgICByZXR1cm4geyBraW5kOiAncHVzaCcgfTtcbiAgICB9XG4gICAgLy8gQSByZWNvZ25pemVkIGBnaXRgIGludm9jYXRpb24gdGhhdCBpcyBuZWl0aGVyIGNvbW1pdCBub3IgcHVzaCAoZS5nLlxuICAgIC8vIGBnaXQgYWRkIC4gJiYgZ2l0IGNvbW1pdCBcdTIwMjZgKToga2VlcCBzY2FubmluZyBsYXRlciBzZWdtZW50cy5cbiAgfVxuICByZXR1cm4geyBraW5kOiAnbm9uZScgfTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGEgYGdpdCBjb21taXRgIGluIHRoZSBjb21tYW5kIGlzIGFuIGAtYWAvYC1hbWAvYC0tYWxsYCBmb3JtIFx1MjAxNCB0aGVcbiAqIFwic3RhZ2UgYWxsIHRyYWNrZWQtbW9kaWZpZWQgZmlsZXNcIiB2YXJpYW50IHdob3NlIGNoYW5nZXNldCB7QGxpbmsgcmVzb2x2ZUNoYW5nZXNldH1cbiAqIG11c3Qgd2lkZW4gYmV5b25kIHRoZSBhbHJlYWR5LXN0YWdlZCBzZXQuXG4gKlxuICogVGhlIGBhbGxgIHNpZ25hbCBpcyBkZWxpYmVyYXRlbHkgKm5vdCogY2FycmllZCBvbiB7QGxpbmsgUGFyc2VkR2l0Q29tbWFuZH1cbiAqIChzZWUgdGhhdCB0eXBlJ3MgZG9jKTogdGhlIGFkYXB0ZXIgZGVyaXZlcyBpdCBoZXJlIGZyb20gdGhlIHNhbWUgY29tbWFuZCB0ZXh0XG4gKiBhbmQgdGhyZWFkcyBpdCBpbnRvIHtAbGluayByZXNvbHZlQ2hhbmdlc2V0fSBleHBsaWNpdGx5LiBDb25zZXJ2YXRpdmU6IG9ubHkgYVxuICogc2hvcnQtZmxhZyBncm91cCBjb250YWluaW5nIGBhYCAoYC1hYCwgYC1hbWAsIGAtbWFgKSBvciBhbiBleHBsaWNpdCBgLS1hbGxgLFxuICogc2Nhbm5lZCBiZWZvcmUgYW55IGAtLWAgcGF0aHNwZWMgc2VwYXJhdG9yLCBjb3VudHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21taXRTdGFnZXNBbGwoY29tbWFuZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3Qgc2VnbWVudCBvZiBzcGxpdFNlZ21lbnRzKGNvbW1hbmQpKSB7XG4gICAgY29uc3QgaW52ID0gbWF0Y2hHaXRJbnZvY2F0aW9uKHRva2VuaXplKHNlZ21lbnQpKTtcbiAgICBpZiAoIWludiB8fCBpbnYuc3ViY29tbWFuZCAhPT0gJ2NvbW1pdCcpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGRhc2hEYXNoID0gaW52LmFyZ3MuaW5kZXhPZignLS0nKTtcbiAgICBjb25zdCBmbGFnQXJncyA9IGRhc2hEYXNoID49IDAgPyBpbnYuYXJncy5zbGljZSgwLCBkYXNoRGFzaCkgOiBpbnYuYXJncztcbiAgICBmb3IgKGNvbnN0IGFyZyBvZiBmbGFnQXJncykge1xuICAgICAgaWYgKGFyZyA9PT0gJy0tYWxsJykgcmV0dXJuIHRydWU7XG4gICAgICBpZiAoIWFyZy5zdGFydHNXaXRoKCctLScpICYmIC9eLVtBLVphLXpdKmFbQS1aYS16XSokLy50ZXN0KGFyZykpIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vLyBTaGVsbCBjb250cm9sIG9wZXJhdG9ycyB0aGF0IHNlcGFyYXRlIG9uZSBzaW1wbGUgY29tbWFuZCBmcm9tIHRoZSBuZXh0LlxuLy8gU3BsaXR0aW5nIG9uIHRoZXNlIChvdXRzaWRlIHF1b3RlcykgaXNvbGF0ZXMgZWFjaCBjb21tYW5kIHNvIGEgYGdpdCBjb21taXRgL1xuLy8gYGdpdCBwdXNoYCBjaGFpbmVkIGFmdGVyIGAmJmAvYDtgL2B8YCBpcyBmb3VuZCwgd2hpbGUgdGV4dCBpbnNpZGUgYSBxdW90ZWRcbi8vIGFyZ3VtZW50IChgZWNobyBcImdpdCBjb21taXRcImApIHN0YXlzIHdpdGhpbiBpdHMgb3duIG5vbi1naXQgc2VnbWVudC5cbmNvbnN0IFRXT19DSEFSX09QRVJBVE9SUyA9IG5ldyBTZXQoWycmJicsICd8fCddKTtcbmNvbnN0IE9ORV9DSEFSX1NFUEFSQVRPUlMgPSBuZXcgU2V0KFsnOycsICd8JywgJ1xcbicsICcmJywgJygnLCAnKSddKTtcblxuLyoqIFNwbGl0IGEgc2hlbGwgY29tbWFuZCBpbnRvIHNpbXBsZS1jb21tYW5kIHNlZ21lbnRzLCByZXNwZWN0aW5nIHF1b3Rlcy4gKi9cbmZ1bmN0aW9uIHNwbGl0U2VnbWVudHMoY29tbWFuZDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBzZWdtZW50czogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGN1cnJlbnQgPSAnJztcbiAgbGV0IHF1b3RlOiAnXCInIHwgXCInXCIgfCBudWxsID0gbnVsbDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb21tYW5kLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgY2ggPSBjb21tYW5kW2ldO1xuICAgIGlmIChxdW90ZSkge1xuICAgICAgY3VycmVudCArPSBjaDtcbiAgICAgIGlmIChjaCA9PT0gcXVvdGUpIHF1b3RlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY2ggPT09ICdcIicgfHwgY2ggPT09IFwiJ1wiKSB7XG4gICAgICBxdW90ZSA9IGNoO1xuICAgICAgY3VycmVudCArPSBjaDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoVFdPX0NIQVJfT1BFUkFUT1JTLmhhcyhjb21tYW5kLnNsaWNlKGksIGkgKyAyKSkpIHtcbiAgICAgIHNlZ21lbnRzLnB1c2goY3VycmVudCk7XG4gICAgICBjdXJyZW50ID0gJyc7XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKE9ORV9DSEFSX1NFUEFSQVRPUlMuaGFzKGNoKSkge1xuICAgICAgc2VnbWVudHMucHVzaChjdXJyZW50KTtcbiAgICAgIGN1cnJlbnQgPSAnJztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjdXJyZW50ICs9IGNoO1xuICB9XG4gIHNlZ21lbnRzLnB1c2goY3VycmVudCk7XG4gIHJldHVybiBzZWdtZW50cztcbn1cblxuLyoqXG4gKiBUb2tlbml6ZSBvbmUgc2VnbWVudCBpbnRvIHNoZWxsIHdvcmRzLCByZXNwZWN0aW5nIHNpbmdsZS9kb3VibGUgcXVvdGVzIGFuZFxuICogc3RyaXBwaW5nIHRoZSBxdW90ZSBjaGFyYWN0ZXJzLiBEZWxpYmVyYXRlbHkgbWluaW1hbCAobm8gZXhwYW5zaW9uLCBub1xuICogZXNjYXBlIGhhbmRsaW5nIGJleW9uZCBxdW90ZXMpOiB0aGUgZ29hbCBpcyBjb25maWRlbnQgcmVjb2duaXRpb24gb2YgYVxuICogYGdpdCBjb21taXRgL2BwdXNoYCBzaGFwZSwgbm90IGEgZnVsbCBzaGVsbCBwYXJzZXIuXG4gKi9cbmZ1bmN0aW9uIHRva2VuaXplKHNlZ21lbnQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgdG9rZW5zOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgY3VycmVudCA9ICcnO1xuICBsZXQgaGFzID0gZmFsc2U7XG4gIGxldCBxdW90ZTogJ1wiJyB8IFwiJ1wiIHwgbnVsbCA9IG51bGw7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2VnbWVudC5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGNoID0gc2VnbWVudFtpXTtcbiAgICBpZiAocXVvdGUpIHtcbiAgICAgIGlmIChjaCA9PT0gcXVvdGUpIHF1b3RlID0gbnVsbDtcbiAgICAgIGVsc2UgY3VycmVudCArPSBjaDtcbiAgICAgIGhhcyA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSAnXCInIHx8IGNoID09PSBcIidcIikge1xuICAgICAgcXVvdGUgPSBjaDtcbiAgICAgIGhhcyA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSAnICcgfHwgY2ggPT09ICdcXHQnKSB7XG4gICAgICBpZiAoaGFzKSB7XG4gICAgICAgIHRva2Vucy5wdXNoKGN1cnJlbnQpO1xuICAgICAgICBjdXJyZW50ID0gJyc7XG4gICAgICAgIGhhcyA9IGZhbHNlO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGN1cnJlbnQgKz0gY2g7XG4gICAgaGFzID0gdHJ1ZTtcbiAgfVxuICBpZiAoaGFzKSB0b2tlbnMucHVzaChjdXJyZW50KTtcbiAgcmV0dXJuIHRva2Vucztcbn1cblxuLyoqIEdpdCBnbG9iYWwgb3B0aW9ucyB0aGF0IGNvbnN1bWUgYSBzZXBhcmF0ZSBmb2xsb3dpbmcgdmFsdWUgdG9rZW4uICovXG5jb25zdCBHSVRfVkFMVUVfT1BUSU9OUyA9IG5ldyBTZXQoW1xuICAnLUMnLFxuICAnLWMnLFxuICAnLS1naXQtZGlyJyxcbiAgJy0td29yay10cmVlJyxcbiAgJy0tbmFtZXNwYWNlJyxcbiAgJy0tc3VwZXItcHJlZml4JyxcbiAgJy0tZXhlYy1wYXRoJyxcbiAgJy0tYXR0ci1zb3VyY2UnLFxuICAnLS1jb25maWctZW52J1xuXSk7XG5cbmludGVyZmFjZSBHaXRJbnZvY2F0aW9uIHtcbiAgc3ViY29tbWFuZDogc3RyaW5nO1xuICBhcmdzOiBzdHJpbmdbXTtcbn1cblxuLyoqXG4gKiBJZiBhIHNlZ21lbnQncyB0b2tlbnMgYXJlIGEgYGdpdCA8c3ViY29tbWFuZD4gXHUyMDI2YCBpbnZvY2F0aW9uLCByZXR1cm4gdGhlXG4gKiBzdWJjb21tYW5kIGFuZCBpdHMgcmVtYWluaW5nIGFyZ3M7IG90aGVyd2lzZSBgbnVsbGAuIExlYWRpbmcgYFZBUj12YWx1ZWBcbiAqIGVudmlyb25tZW50IGFzc2lnbm1lbnRzIGFuZCBgZ2l0YCBnbG9iYWwgb3B0aW9ucyAoaW5jbHVkaW5nIHRoZSB2YWx1ZS10YWtpbmdcbiAqIG9uZXMpIGFyZSBza2lwcGVkIHNvIHRoZSBzdWJjb21tYW5kIGlzIGNvcnJlY3RseSBsb2NhdGVkLlxuICovXG5mdW5jdGlvbiBtYXRjaEdpdEludm9jYXRpb24odG9rZW5zOiBzdHJpbmdbXSk6IEdpdEludm9jYXRpb24gfCBudWxsIHtcbiAgbGV0IGkgPSAwO1xuICB3aGlsZSAoaSA8IHRva2Vucy5sZW5ndGggJiYgL15bQS1aYS16X11bQS1aYS16MC05X10qPS8udGVzdCh0b2tlbnNbaV0pKSBpKys7XG4gIGlmIChpID49IHRva2Vucy5sZW5ndGggfHwgdG9rZW5zW2ldICE9PSAnZ2l0JykgcmV0dXJuIG51bGw7XG4gIGkrKztcbiAgd2hpbGUgKGkgPCB0b2tlbnMubGVuZ3RoKSB7XG4gICAgY29uc3QgdCA9IHRva2Vuc1tpXTtcbiAgICBpZiAodCA9PT0gJy0tJykgcmV0dXJuIG51bGw7IC8vIGEgYC0tYCBiZWZvcmUgYW55IHN1YmNvbW1hbmQgaXMgbm90IGEgc2hhcGUgd2UgcmVjb2duaXplXG4gICAgaWYgKCF0LnN0YXJ0c1dpdGgoJy0nKSkgYnJlYWs7XG4gICAgaSArPSBHSVRfVkFMVUVfT1BUSU9OUy5oYXModCkgPyAyIDogMTtcbiAgfVxuICBpZiAoaSA+PSB0b2tlbnMubGVuZ3RoKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHsgc3ViY29tbWFuZDogdG9rZW5zW2ldLCBhcmdzOiB0b2tlbnMuc2xpY2UoaSArIDEpIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQ2hhbmdlc2V0IHJlc29sdXRpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFRoZSBpbmplY3RlZCBnaXQgc3VyZmFjZSB7QGxpbmsgcmVzb2x2ZUNoYW5nZXNldH0gbmVlZHMgdG8gdHVybiBhIHBhcnNlZFxuICogY29tbWFuZCBpbnRvIHRoZSBjb25jcmV0ZSBsaXN0IG9mIHBhdGhzIHRoYXQgd291bGQgbGFuZC4gS2VwdCBhcyBuYXJyb3cgYXN5bmNcbiAqIGZ1bmN0aW9ucyAocmF0aGVyIHRoYW4gYSByYXcgY29tbWFuZCBydW5uZXIpIGZvbGxvd2luZyBgdG91Y2gtY29yZS50c2Anc1xuICogYFRvdWNoRXhlY3V0b3JzYCBwYXR0ZXJuLCBzbyBQaGFzZSAzLjIncyB0ZXN0cyBmYWtlIHRoZSByZXBvIHN0YXRlIHdpdGhvdXQgYVxuICogcmVhbCBzdWJwcm9jZXNzIGFuZCB0aGUgY29yZSBuZXZlciBzcGF3bnMgb25lIGl0c2VsZi5cbiAqXG4gKiBBbGwgcmV0dXJuZWQgcGF0aHMgYXJlIHJlcG8tcmVsYXRpdmUgUE9TSVggcGF0aHMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgR2l0RXhlY3V0b3Ige1xuICAvKipcbiAgICogUGF0aHMgc3RhZ2VkIGZvciB0aGUgbmV4dCBjb21taXQgXHUyMDE0IGBnaXQgZGlmZiAtLWNhY2hlZCAtLW5hbWUtb25seWAuIFRoZXNlXG4gICAqIGFyZSB3aGF0IGEgcGxhaW4gYGdpdCBjb21taXRgIHdvdWxkIGxhbmQuXG4gICAqL1xuICBzdGFnZWRQYXRocyhjd2Q6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nW10+O1xuICAvKipcbiAgICogVHJhY2tlZCBmaWxlcyB3aXRoIHVuc3RhZ2VkIHdvcmtpbmctdHJlZSBtb2RpZmljYXRpb25zIFx1MjAxNFxuICAgKiBgZ2l0IGRpZmYgLS1uYW1lLW9ubHlgLiBGb2xkZWQgaW50byB0aGUgY2hhbmdlc2V0IG9ubHkgZm9yIGAtYWAvYC1hbWBcbiAgICogZm9ybXMsIHdoaWNoIHN0YWdlIHRyYWNrZWQtbW9kaWZpZWQgZmlsZXMgaW1wbGljaXRseSBhdCBjb21taXQgdGltZS5cbiAgICovXG4gIHRyYWNrZWRNb2RpZmllZFBhdGhzKGN3ZDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmdbXT47XG4gIC8qKlxuICAgKiBQYXRocyBpbiB0aGUgb3V0Z29pbmcgcHVzaCByYW5nZSBcdTIwMTQgdGhlIGZpbGVzIGNoYW5nZWQgYnkgYEB7dX0uLkhFQURgLCB3aXRoXG4gICAqIGEgbWVyZ2UtYmFzZS1hZ2FpbnN0LXRoZS1kZWZhdWx0LXJlbW90ZS1icmFuY2ggZmFsbGJhY2sgd2hlbiBubyB1cHN0cmVhbSBpc1xuICAgKiBjb25maWd1cmVkLiBUaGVzZSBhcmUgd2hhdCBhIGBnaXQgcHVzaGAgd291bGQgcHVibGlzaC5cbiAgICovXG4gIG91dGdvaW5nUGF0aHMoY3dkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZ1tdPjtcbn1cblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBjb25jcmV0ZSBsaXN0IG9mIHJlcG8tcmVsYXRpdmUgcGF0aHMgYSBnYXRlZCBjb21tYW5kIHdvdWxkIGxhbmQsXG4gKiBzbyB0aGUgZ2F0ZSBjYW4gc2NvcGUgaXRzIHN0YWxlbmVzcy9jb3ZlcmFnZSBjaGVjayB0byBleGFjdGx5IHRoYXQgY2hhbmdlc2V0LlxuICpcbiAqIC0gYGNvbW1pdGA6IHRoZSBzdGFnZWQgcGF0aHMsIHBsdXMgXHUyMDE0IHdoZW4gYGFsbGAgaXMgdHJ1ZSAodGhlIGNvbW1hbmQgd2FzIGFuXG4gKiAgIGAtYWAvYC1hbWAgZm9ybSkgXHUyMDE0IHRoZSB0cmFja2VkLW1vZGlmaWVkIHBhdGhzIHRob3NlIGZvcm1zIHN0YWdlIGltcGxpY2l0bHkuXG4gKiAtIGBwdXNoYDogdGhlIG91dGdvaW5nIHJhbmdlIGBAe3V9Li5IRUFEYCwgd2l0aCBhIG1lcmdlLWJhc2UgZmFsbGJhY2sgd2hlbiBub1xuICogICB1cHN0cmVhbSBpcyBjb25maWd1cmVkLiBgYWxsYCBpcyBub3QgbWVhbmluZ2Z1bCBmb3IgYSBwdXNoIGFuZCBpcyBpZ25vcmVkLlxuICpcbiAqIFRoZSBgYWxsYCBmbGFnIGlzIHRocmVhZGVkIGluIGV4cGxpY2l0bHkgKHJhdGhlciB0aGFuIHJlYWQgYmFjayBvdXQgb2YgdGhlXG4gKiBjb21tYW5kKSBiZWNhdXNlIHtAbGluayBQYXJzZWRHaXRDb21tYW5kfSBpbnRlbnRpb25hbGx5IGRvZXMgbm90IGNhcnJ5IGl0IFx1MjAxNFxuICogdGhlIGNhbGxlci9hZGFwdGVyIGRlcml2ZXMgaXQgZnJvbSB0aGUgcGFyc2UgYW5kIHBhc3NlcyBpdCBoZXJlLlxuICpcbiAqIEBwYXJhbSBraW5kIFdoZXRoZXIgdGhlIGNoYW5nZXNldCBpcyBhIGNvbW1pdCdzIHN0YWdlZCBzZXQgb3IgYSBwdXNoJ3MgcmFuZ2UuXG4gKiBAcGFyYW0gYWxsIFdoZXRoZXIgdGhlIGNvbW1pdCB3YXMgYW4gYC1hYC9gLWFtYCBmb3JtIChpZ25vcmVkIGZvciBgcHVzaGApLlxuICogQHBhcmFtIGN3ZCBUaGUgd29ya2luZyBkaXJlY3RvcnkgdGhlIGdpdCBjb21tYW5kIHJhbiBpbi5cbiAqIEBwYXJhbSBnaXQgVGhlIGluamVjdGVkIGdpdCBzdXJmYWNlIGJhY2tpbmcgdGhlIHJlc29sdXRpb24uXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlQ2hhbmdlc2V0KFxuICBraW5kOiAnY29tbWl0JyB8ICdwdXNoJyxcbiAgYWxsOiBib29sZWFuLFxuICBjd2Q6IHN0cmluZyxcbiAgZ2l0OiBHaXRFeGVjdXRvclxuKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICBpZiAoa2luZCA9PT0gJ3B1c2gnKSB7XG4gICAgcmV0dXJuIGdpdC5vdXRnb2luZ1BhdGhzKGN3ZCk7XG4gIH1cbiAgY29uc3Qgc3RhZ2VkID0gYXdhaXQgZ2l0LnN0YWdlZFBhdGhzKGN3ZCk7XG4gIGlmICghYWxsKSByZXR1cm4gc3RhZ2VkO1xuICBjb25zdCB0cmFja2VkID0gYXdhaXQgZ2l0LnRyYWNrZWRNb2RpZmllZFBhdGhzKGN3ZCk7XG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgY29uc3QgbWVyZ2VkOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IHBhdGggb2YgWy4uLnN0YWdlZCwgLi4udHJhY2tlZF0pIHtcbiAgICBpZiAoc2Vlbi5oYXMocGF0aCkpIGNvbnRpbnVlO1xuICAgIHNlZW4uYWRkKHBhdGgpO1xuICAgIG1lcmdlZC5wdXNoKHBhdGgpO1xuICB9XG4gIHJldHVybiBtZXJnZWQ7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gR2F0ZSBldmFsdWF0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBUaGUgaW5qZWN0ZWQgZXhlY3V0aW9uIHN1cmZhY2UgZ2F0ZSBldmFsdWF0aW9uIG5lZWRzIFx1MjAxNCB0aGUgYGZpeGAvYHN0YWxlYC9cbiAqIGBsaXN0YCBhc3luYyBmdW5jdGlvbnMsIG1pcnJvcmluZyBgdG91Y2gtY29yZS50c2AncyBgVG91Y2hFeGVjdXRvcnNgLiBUZXN0c1xuICogaW5qZWN0IGZha2VzIHJldHVybmluZyBzdHJ1Y3R1cmVkIGRhdGE7IHRoZSBjb3JlIG5ldmVyIHNwYXducyBhIHN1YnByb2Nlc3NcbiAqIGl0c2VsZi4gQWxsIHBhdGhzIGFyZSByZXBvLXJlbGF0aXZlIFBPU0lYIHBhdGhzLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEdhdGVFeGVjdXRvcnMge1xuICAvKipcbiAgICogUnVuIGEgc2NvcGVkIGBnaXQgc3BhbiBzdGFsZSA8cGF0aHM+IC0tZml4YCBcdTIwMTQgdGhlIGJlbHQtYW5kLWJyYWNlcyBoZWFsIHRoYXRcbiAgICogcnVucyBiZWZvcmUgY2xhc3NpZmljYXRpb24gKHBlciBDQVJELm1kKSwgcmUtYW5jaG9yaW5nIGFueSBwb3NpdGlvbmFsIGRyaWZ0XG4gICAqIGluIHRoZSBjaGFuZ2VzZXQgdGhhdCB0aGUgdG91Y2ggaG9vayBoYXMgbm90IGFscmVhZHkgaGVhbGVkLiBSZXBvcnRzIG5vdGhpbmc7XG4gICAqIGl0cyBlZmZlY3QgaXMgb24gdGhlIHdvcmtpbmcgdHJlZSwgYW5kIHRoZSBzdWJzZXF1ZW50IHtAbGluayBHYXRlRXhlY3V0b3JzLnN0YWxlfVxuICAgKiByZWFkIG9ic2VydmVzIHRoZSBoZWFsZWQgc3RhdGUuXG4gICAqL1xuICBmaXgocGF0aHM6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZyk6IFByb21pc2U8dm9pZD47XG4gIC8qKlxuICAgKiBSdW4gYSBzY29wZWQgYGdpdCBzcGFuIHN0YWxlIC0tZm9ybWF0IHBvcmNlbGFpbiA8cGF0aHM+YCBhbmQgcmV0dXJuIGl0c1xuICAgKiBwYXJzZWQgcm93cyBcdTIwMTQgb25lIHBlciBkcmlmdGVkIGFuY2hvciBhbW9uZyB0aGUgY2hhbmdlc2V0J3Mgc3BhbnMsIGVtcHR5IHdoZW5cbiAgICogY2xlYW4uIERlYnQgaXMgY2xhc3NpZmllZCBmcm9tIHRoZXNlIHJvd3MgdmlhIGBpc0RlYnQoKWA7IHBvc2l0aW9uYWxcbiAgICogKGBNT1ZFRGAvYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCkgcm93cyBhcmUgbmV2ZXIgZGVidCBhbmQgbmV2ZXIgZGVueS5cbiAgICovXG4gIHN0YWxlKHBhdGhzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpOiBQcm9taXNlPFN0YWxlUG9yY2VsYWluUm93W10+O1xuICAvKipcbiAgICogUnVuIGEgc2NvcGVkIGBnaXQgc3BhbiBsaXN0IC0tcG9yY2VsYWluIDxwYXRocz5gIGFuZCByZXR1cm4gdGhlIGNvdmVyaW5nXG4gICAqIGFuY2hvcnMuIFVzZWQgdG8gY29tcHV0ZSAqdW5jb3ZlcmVkIHdyaXRlcyo6IGEgY2hhbmdlZCBwYXRoIHdpdGggemVyb1xuICAgKiBjb3ZlcmluZyByb3dzIGhlcmUgKG1pbnVzIGAuc3Bhbi8qKmAsIGdpdGlnbm9yZWQgcGF0aHMsIGFuZFxuICAgKiBgLnNwYW4vLmdhdGVpZ25vcmVgLWV4Y2x1ZGVkIHBhdGhzIFx1MjAxNCBzZWUge0BsaW5rIGZpbGU6Ly8uL2dhdGUtaWdub3JlLnRzfSlcbiAgICogaXMgYW4gdW5jb3ZlcmVkIHdyaXRlLlxuICAgKi9cbiAgbGlzdChwYXRoczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKTogUHJvbWlzZTxQb3JjZWxhaW5Sb3dbXT47XG59XG5cbi8qKlxuICogVGhlIGdhdGUncyBwZXItY2hhbmdlc2V0IG1lbW8gXHUyMDE0IFwiaGF2ZSBJIGFscmVhZHkgcHJlc2VudGVkIHRoaXMgZXhhY3QgZGVidFxuICogc3RhdGUgb25jZT9cIiBUaGUgcGVyc2lzdGVkIHVuaXQgaXMgYSBkaWdlc3Qgb2YgdGhlIHNvcnRlZCBzdGFsZW5lc3MgZmluZGluZ3NcbiAqIHBsdXMgdGhlIHNvcnRlZCB1bmNvdmVyZWQgcGF0aHMgKGRlc2lnbi1kZWNpc2lvbnMubWQgIzkncyBcImdhdGUgb25jZSBwZXJcbiAqIGRpc3RpbmN0IGRlYnQtc3RhdGVcIik7IHRoZSBkaXNrLWJhY2tlZCBpbXBsZW1lbnRhdGlvbiBzdG9yZXMgb25lIG1hcmtlciBwZXJcbiAqIGRpZ2VzdCB1bmRlciB7QGxpbmsgZ2F0ZU1lbW9EaXJ9IChgPGdpdC1jb21tb24tZGlyPi9naXQtc3Bhbi9nYXRlL2ApLCB3aGVyZVxuICogcHJlc2VuY2UgbWVhbnMgXCJhbHJlYWR5IHByZXNlbnRlZCBvbmNlLlwiIEluamVjdGVkIGFzIGEgc3RvcmUgYWJzdHJhY3Rpb25cbiAqIChsaWtlIHNwYW4tc3VyZmFjZS50cydzIGBNZW1vU3RvcmVgKSBzbyBQaGFzZSAzLjIgZmFrZXMgaXQgaW4gbWVtb3J5LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEdhdGVNZW1vU3RhdGUge1xuICAvKiogV2hldGhlciB0aGlzIGV4YWN0IGRlYnQtc3RhdGUgZGlnZXN0IGhhcyBhbHJlYWR5IGJlZW4gcHJlc2VudGVkIG9uY2UuICovXG4gIGhhcyhkaWdlc3Q6IHN0cmluZyk6IGJvb2xlYW47XG4gIC8qKiBSZWNvcmQgdGhhdCB0aGlzIGRlYnQtc3RhdGUgZGlnZXN0IGhhcyBub3cgYmVlbiBwcmVzZW50ZWQuICovXG4gIHJlY29yZChkaWdlc3Q6IHN0cmluZyk6IHZvaWQ7XG59XG5cbi8qKlxuICogVGhlIGdhdGUncyBkZWNpc2lvbiBmb3Igb25lIGNvbW1hbmQsIGFzIGEgZGlzY3JpbWluYXRlZCB1bmlvbiB0aGUgYWRhcHRlclxuICogdHJhbnNsYXRlcyBpbnRvIGBwZXJtaXNzaW9uRGVjaXNpb246ICdkZW55J2AvYWxsb3cgKENsYXVkZSkgb3IgYSBibG9jay9hbGxvd1xuICogKENvZGV4KS4gYGRlY2lzaW9uYCBpcyB0aGUgY29hcnNlIGFsbG93L2RlbnkgdGhlIGhhcm5lc3MgYWN0cyBvbjsgYGtpbmRgXG4gKiByZWNvcmRzICp3aHkqLCBzbyB0aGUgYWRhcHRlciByZW5kZXJzIHRoZSByaWdodCBtZXNzYWdlIGFuZCBzbyB0ZXN0cyBhc3NlcnRcbiAqIHRoZSBleGFjdCBicmFuY2guXG4gKlxuICogLSBgYWxsb3dgIC8gYHNpbGVudGAgXHUyMDE0IG5vdGhpbmcgdG8gY2hlY2sgKG5vIHBhdGhzKSBvciB0aGUgY2hhbmdlc2V0IGlzIGNsZWFuO1xuICogICBhbGxvdyB3aXRoIG5vIG91dHB1dC4gSW50ZXJuYWwgZXJyb3JzIGFuZCBwYXJzZSBmYWlsdXJlcyBhbHNvIHJlc29sdmUgaGVyZTpcbiAqICAgdGhlIGdhdGUgZmFpbHMgb3BlbiBhbmQgbXVzdCBuZXZlciBicmljayBhIGNvbW1pdC5cbiAqIC0gYGFsbG93YCAvIGBhbHJlYWR5LXByZXNlbnRlZGAgXHUyMDE0IGRlYnQgaXMgcHJlc2VudCwgYnV0IHRoaXMgZXhhY3QgZGVidCBzdGF0ZVxuICogICB3YXMgYWxyZWFkeSBwcmVzZW50ZWQgb25jZSAodW5jb3ZlcmVkLXdyaXRlcyBjb25zaWRlci1vbmNlLCBvciBhbiB1bmNoYW5nZWRcbiAqICAgc3RhdGUpLiBUaGUgY29tbWFuZCBwYXNzZXMuXG4gKiAtIGBkZW55YCAvIGBzZW1hbnRpYy1zdGFsZW5lc3NgIFx1MjAxNCB0aGUgY2hhbmdlc2V0IGNhcnJpZXMgc2VtYW50aWMgc3RhbGVuZXNzLlxuICogICBEZW55IHdpdGggYGZpbmRpbmdzYCByZW5kZXJlZCBhcyBhIGNoZWNrbGlzdCBpbiBgcmVhc29uYDsgcmUtZGVuaWVzIG9uIGV2ZXJ5XG4gKiAgIHJldHJ5IHVudGlsIHRoZSBmaW5kaW5ncyBjaGFuZ2UgKHN0YWxlbmVzcyBpcyBoYXJkLXVudGlsLXJlc29sdmVkKS5cbiAqIC0gYGRlbnlgIC8gYHVuY292ZXJlZC13cml0ZXNgIFx1MjAxNCB0aGUgY2hhbmdlc2V0IGhhcyBjaGFuZ2VkIGZpbGVzIG5vIHNwYW5cbiAqICAgY292ZXJzLCBhbmQgdGhpcyBzdGF0ZSBoYXMgbm90IGJlZW4gcHJlc2VudGVkIGJlZm9yZS4gRGVueSAqKm9uY2UqKiwgbGlzdGluZ1xuICogICBgdW5jb3ZlcmVkYDsgdGhlIHJldHJ5IHdpdGggYW4gdW5jaGFuZ2VkIHN0YXRlIHJlc29sdmVzIHRvIGBhbHJlYWR5LXByZXNlbnRlZGBcbiAqICAgYW5kIHBhc3NlcyAoY29uc2lkZXItb25jZSwgcGVyIGRlc2lnbi1kZWNpc2lvbnMubWQgIzMpLlxuICovXG5leHBvcnQgdHlwZSBHYXRlUmVzdWx0ID1cbiAgfCB7IGRlY2lzaW9uOiAnYWxsb3cnOyBraW5kOiAnc2lsZW50JyB9XG4gIHwgeyBkZWNpc2lvbjogJ2FsbG93Jzsga2luZDogJ2FscmVhZHktcHJlc2VudGVkJyB9XG4gIHwgeyBkZWNpc2lvbjogJ2RlbnknOyBraW5kOiAnc2VtYW50aWMtc3RhbGVuZXNzJzsgZmluZGluZ3M6IFN0YWxlUG9yY2VsYWluUm93W107IHJlYXNvbjogc3RyaW5nIH1cbiAgfCB7IGRlY2lzaW9uOiAnZGVueSc7IGtpbmQ6ICd1bmNvdmVyZWQtd3JpdGVzJzsgdW5jb3ZlcmVkOiBzdHJpbmdbXTsgcmVhc29uOiBzdHJpbmcgfTtcblxuLyoqXG4gKiBFdmFsdWF0ZSB0aGUgZ2F0ZSBmb3IgYSByZXNvbHZlZCBjaGFuZ2VzZXQgYW5kIGRlY2lkZSB3aGV0aGVyIHRvIGhvbGQgdGhlXG4gKiBjb21tYW5kLlxuICpcbiAqIFJ1bnMgYGV4ZWN1dG9ycy5maXhgIChzY29wZWQgYmVsdC1hbmQtYnJhY2VzIGBzdGFsZSAtLWZpeGApLCB0aGVuIHJlYWRzXG4gKiBgZXhlY3V0b3JzLnN0YWxlYCBhbmQgY2xhc3NpZmllcyBlYWNoIHJvdyB2aWEgYGlzRGVidCgpYC4gU2VtYW50aWMgc3RhbGVuZXNzXG4gKiBcdTIxOTIgYGRlbnlgL2BzZW1hbnRpYy1zdGFsZW5lc3NgLCByZS1ibG9ja2luZyB1bnRpbCB0aGUgZmluZGluZ3MgZGlnZXN0XG4gKiBjaGFuZ2VzLiBVbmNvdmVyZWQgd3JpdGVzIChjaGFuZ2VkIHBhdGhzIHdpdGggemVybyBjb3ZlcmFnZSBmcm9tXG4gKiBgZXhlY3V0b3JzLmxpc3RgLCBtaW51cyBgLnNwYW4vKipgLCBhbmQgcGF0aHMgbWF0Y2hlZCBieSB0aGUgcmVwbydzXG4gKiBgLnNwYW4vLmdhdGVpZ25vcmVgIFx1MjAxNCBzZWUge0BsaW5rIGZpbGU6Ly8uL2dhdGUtaWdub3JlLnRzfSwgbG9hZGVkIGRpcmVjdGx5XG4gKiBmcm9tIGRpc2sgdmlhIGByZXNvbHZlUmVwb1Jvb3QoY3dkKWAsIGZhaWwtb3BlbiB3aGVuIGFic2VudC91bnJlYWRhYmxlKSBcdTIxOTJcbiAqIGBkZW55YC9gdW5jb3ZlcmVkLXdyaXRlc2AgdGhlIGZpcnN0IHRpbWUgdGhhdCBzdGF0ZSBpcyBzZWVuLCB0aGVuXG4gKiBgYWxsb3dgL2BhbHJlYWR5LXByZXNlbnRlZGAgb24gcmV0cnkuIGBNT1ZFRGAgYW5kXG4gKiBgUkVTT0xWRURfUEVORElOR19DT01NSVRgIG5ldmVyIGNvbnRyaWJ1dGUgdG8gZWl0aGVyIGFuZCBuZXZlciBkZW55LiBUaGVcbiAqIGRpc3RpbmN0LWRlYnQtc3RhdGUgZGlnZXN0IChzb3J0ZWQgZmluZGluZ3MgKyBzb3J0ZWQgdW5jb3ZlcmVkIHBhdGhzKSBpc1xuICogY2hlY2tlZCBhbmQgcmVjb3JkZWQgdGhyb3VnaCBgbWVtb1N0YXRlYC4gQW55IGludGVybmFsIGVycm9yIHJlc29sdmVzIHRvXG4gKiBgYWxsb3dgL2BzaWxlbnRgIFx1MjAxNCB0aGUgZ2F0ZSBmYWlscyBvcGVuIGFuZCBuZXZlciBicmlja3MgYSBjb21taXQuXG4gKlxuICogVGhlIGBHSVRfU1BBTl9HQVRFPXNraXBgIGVzY2FwZSBoYXRjaCBpcyAqbm90KiBjaGVja2VkIGhlcmUgXHUyMDE0IGl0IGlzIGFcbiAqIHByZS1jaGVjayB0aGUgYWRhcHRlciBydW5zIHZpYSB7QGxpbmsgaXNHYXRlU2tpcHBlZH0gYmVmb3JlIGNhbGxpbmdcbiAqIGV2YWx1YXRlR2F0ZSwgc28gYSBieXBhc3MgaXMgbG9nZ2VkIGFzIGFuIGV4cGxpY2l0IGV4Y2VwdGlvbiBhdCB0aGUgYWRhcHRlclxuICogYm91bmRhcnkgcmF0aGVyIHRoYW4gZm9sZGVkIGludG8gdGhlIGRlY2lzaW9uIGhlcmUuXG4gKlxuICogQHBhcmFtIHBhdGhzIFRoZSByZXNvbHZlZCBjaGFuZ2VzZXQgZnJvbSB7QGxpbmsgcmVzb2x2ZUNoYW5nZXNldH0uIEVtcHR5IFx1MjE5MlxuICogICBgYWxsb3dgL2BzaWxlbnRgLlxuICogQHBhcmFtIGN3ZCBUaGUgd29ya2luZyBkaXJlY3RvcnkgdGhlIGdpdCBjb21tYW5kIHJhbiBpbi5cbiAqIEBwYXJhbSBleGVjdXRvcnMgVGhlIGluamVjdGVkIGBmaXhgL2BzdGFsZWAvYGxpc3RgIHN1cmZhY2UuXG4gKiBAcGFyYW0gbWVtb1N0YXRlIFRoZSBwZXItY2hhbmdlc2V0IGRlYnQtc3RhdGUgbWVtby5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGV2YWx1YXRlR2F0ZShcbiAgcGF0aHM6IHN0cmluZ1tdLFxuICBjd2Q6IHN0cmluZyxcbiAgZXhlY3V0b3JzOiBHYXRlRXhlY3V0b3JzLFxuICBtZW1vU3RhdGU6IEdhdGVNZW1vU3RhdGVcbik6IFByb21pc2U8R2F0ZVJlc3VsdD4ge1xuICBpZiAocGF0aHMubGVuZ3RoID09PSAwKSByZXR1cm4geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ3NpbGVudCcgfTtcbiAgdHJ5IHtcbiAgICAvLyBCZWx0LWFuZC1icmFjZXMgaGVhbCwgdGhlbiBjbGFzc2lmeSBhZ2FpbnN0IHRoZSBoZWFsZWQgc3RhdGUuXG4gICAgYXdhaXQgZXhlY3V0b3JzLmZpeChwYXRocywgY3dkKTtcbiAgICBjb25zdCBzdGFsZVJvd3MgPSBhd2FpdCBleGVjdXRvcnMuc3RhbGUocGF0aHMsIGN3ZCk7XG5cbiAgICAvLyBTZW1hbnRpYyBzdGFsZW5lc3MgaXMgaGFyZC11bnRpbC1yZXNvbHZlZDogZGVueSBldmVyeSB0aW1lIHVudGlsIHRoZVxuICAgIC8vIGZpbmRpbmdzIHRoZW1zZWx2ZXMgY2hhbmdlLiBgaXNEZWJ0KClgIGlzIHRoZSBzaW5nbGUgc291cmNlIG9mIHRydXRoIFx1MjAxNFxuICAgIC8vIGBNT1ZFRGAvYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCBhcmUgbmV2ZXIgZGVidCBhbmQgbmV2ZXIgY29udHJpYnV0ZS5cbiAgICBjb25zdCBmaW5kaW5ncyA9IHN0YWxlUm93cy5maWx0ZXIoKHJvdykgPT4gaXNEZWJ0KHJvdy5zdGF0dXMpKTtcbiAgICBpZiAoZmluZGluZ3MubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIHsgZGVjaXNpb246ICdkZW55Jywga2luZDogJ3NlbWFudGljLXN0YWxlbmVzcycsIGZpbmRpbmdzLCByZWFzb246IHJlbmRlclN0YWxlbmVzc1JlYXNvbihmaW5kaW5ncykgfTtcbiAgICB9XG5cbiAgICAvLyBVbmNvdmVyZWQgd3JpdGVzOiBjaGFuZ2VkIHBhdGhzIHdpdGggemVybyBjb3ZlcmluZyBzcGFuLCBtaW51cyBgLnNwYW4vKipgXG4gICAgLy8gKHNwYW4gcmVwYWlycyByaWRlIHRoZSBzYW1lIGNvbW1pdCBhbmQgbXVzdCBuZXZlciBzZWxmLXRyaWdnZXIgdGhlIGdhdGUpXG4gICAgLy8gYW5kIHBhdGhzIHRoZSByZXBvJ3MgdXNlci1vd25lZCBgLnNwYW4vLmdhdGVpZ25vcmVgIGV4Y2x1ZGVzLiBHaXRpZ25vcmVkXG4gICAgLy8gcGF0aHMgbmV2ZXIgcmVhY2ggaGVyZSBcdTIwMTQgZ2l0IGRvZXMgbm90IHN0YWdlL3B1Ymxpc2ggdGhlbS5cbiAgICBjb25zdCBjb3ZlcmluZyA9IGF3YWl0IGV4ZWN1dG9ycy5saXN0KHBhdGhzLCBjd2QpO1xuICAgIGNvbnN0IGNvdmVyZWQgPSBuZXcgU2V0KGNvdmVyaW5nLm1hcCgocm93KSA9PiByb3cucGF0aCkpO1xuICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgY29uc3QgZ2F0ZUlnbm9yZVJ1bGVzID0gcmVwb1Jvb3QgPyBsb2FkR2F0ZUlnbm9yZShyZXBvUm9vdCkgOiBbXTtcbiAgICBjb25zdCB1bmNvdmVyZWQgPSBwYXRocy5maWx0ZXIoXG4gICAgICAocGF0aCkgPT4gIWNvdmVyZWQuaGFzKHBhdGgpICYmICFpc0luc2lkZVNwYW5Sb290KHBhdGgpICYmICFpc0dhdGVJZ25vcmVkKGdhdGVJZ25vcmVSdWxlcywgcGF0aClcbiAgICApO1xuICAgIGlmICh1bmNvdmVyZWQubGVuZ3RoID09PSAwKSByZXR1cm4geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ3NpbGVudCcgfTtcblxuICAgIC8vIENvbnNpZGVyLW9uY2U6IGRlbnkgdGhlIGZpcnN0IHRpbWUgdGhpcyBleGFjdCBkZWJ0IHN0YXRlIGlzIHNlZW4sIHRoZW5cbiAgICAvLyBwYXNzIHRoZSByZXRyeSB3aXRoIGFuIHVuY2hhbmdlZCBzdGF0ZS5cbiAgICBjb25zdCBkaWdlc3QgPSBnYXRlU3RhdGVEaWdlc3QoZmluZGluZ3MsIHVuY292ZXJlZCk7XG4gICAgaWYgKG1lbW9TdGF0ZS5oYXMoZGlnZXN0KSkgcmV0dXJuIHsgZGVjaXNpb246ICdhbGxvdycsIGtpbmQ6ICdhbHJlYWR5LXByZXNlbnRlZCcgfTtcbiAgICBtZW1vU3RhdGUucmVjb3JkKGRpZ2VzdCk7XG4gICAgcmV0dXJuIHsgZGVjaXNpb246ICdkZW55Jywga2luZDogJ3VuY292ZXJlZC13cml0ZXMnLCB1bmNvdmVyZWQsIHJlYXNvbjogcmVuZGVyVW5jb3ZlcmVkUmVhc29uKHVuY292ZXJlZCkgfTtcbiAgfSBjYXRjaCB7XG4gICAgLy8gRmFpbCBvcGVuOiBhbnkgaW50ZXJuYWwvQ0xJIGVycm9yIHJlc29sdmVzIHRvIGFsbG93LiBUaGUgZ2F0ZSBtdXN0IG5ldmVyXG4gICAgLy8gYnJpY2sgYSBjb21taXQgb24gaXRzIG93biBmYWlsdXJlLlxuICAgIHJldHVybiB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnc2lsZW50JyB9O1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGVidC1zdGF0ZSBkaWdlc3QgYW5kIHJlYXNvbiByZW5kZXJpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogYHBhdGgjTHN0YXJ0LUxlbmRgLCBvciBhIGJhcmUgcGF0aCBmb3IgYSB3aG9sZS1maWxlIGFuY2hvci4gKi9cbmZ1bmN0aW9uIGFuY2hvclRleHQocm93OiBTdGFsZVBvcmNlbGFpblJvdyk6IHN0cmluZyB7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHJvdy5wYXRoO1xuICByZXR1cm4gYCR7cm93LnBhdGh9I0wke3Jvdy5zdGFydH0tTCR7cm93LmVuZH1gO1xufVxuXG4vKipcbiAqIFRoZSBkaXN0aW5jdC1kZWJ0LXN0YXRlIGRpZ2VzdCAoZGVzaWduLWRlY2lzaW9ucy5tZCAjOSk6IGEgc3RhYmxlIGhhc2ggb2YgdGhlXG4gKiBzb3J0ZWQgc3RhbGVuZXNzIGZpbmRpbmdzIHBsdXMgdGhlIHNvcnRlZCB1bmNvdmVyZWQgcGF0aHMuIFByZXNlbmNlIGluIHRoZVxuICogbWVtbyBtZWFucyBcInRoaXMgZXhhY3Qgc3RhdGUgd2FzIGFscmVhZHkgcHJlc2VudGVkIG9uY2UuXCJcbiAqL1xuZnVuY3Rpb24gZ2F0ZVN0YXRlRGlnZXN0KGZpbmRpbmdzOiBTdGFsZVBvcmNlbGFpblJvd1tdLCB1bmNvdmVyZWQ6IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgY29uc3QgZmluZGluZ0tleXMgPSBmaW5kaW5ncy5tYXAoKHJvdykgPT4gYCR7cm93LnN0YXR1c31cXHQke3Jvdy5uYW1lfVxcdCR7cm93LnBhdGh9XFx0JHtyb3cuc3RhcnR9XFx0JHtyb3cuZW5kfWApLnNvcnQoKTtcbiAgY29uc3QgcGF5bG9hZCA9IEpTT04uc3RyaW5naWZ5KHsgZmluZGluZ3M6IGZpbmRpbmdLZXlzLCB1bmNvdmVyZWQ6IFsuLi51bmNvdmVyZWRdLnNvcnQoKSB9KTtcbiAgcmV0dXJuIGNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZShwYXlsb2FkKS5kaWdlc3QoJ2hleCcpO1xufVxuXG4vKiogVGhlIGBHSVRfU1BBTl9HQVRFPXNraXBgIGVzY2FwZS1oYXRjaCBsaW5lIGFwcGVuZGVkIHRvIGV2ZXJ5IGRlbnkgcmVhc29uLiAqL1xuY29uc3QgRVNDQVBFX0hBVENIX0xJTkUgPVxuICAnVG8gcHJvY2VlZCBhbnl3YXkgKHJlcXVpcmVzIGV4cGxpY2l0IHVzZXIgYXBwcm92YWwpOiBwcmVmaXggdGhlIGNvbW1hbmQgd2l0aCBgR0lUX1NQQU5fR0FURT1za2lwYC4nO1xuXG4vKiogVGhlIGNoZWNrbGlzdCBhIHNlbWFudGljLXN0YWxlbmVzcyBkZW55IHJlbmRlcnMgaW50byBgcmVhc29uYC4gKi9cbmZ1bmN0aW9uIHJlbmRlclN0YWxlbmVzc1JlYXNvbihmaW5kaW5nczogU3RhbGVQb3JjZWxhaW5Sb3dbXSk6IHN0cmluZyB7XG4gIGNvbnN0IGxpbmVzID0gZmluZGluZ3MubWFwKChyb3cpID0+IGAgIC0gJHtyb3cubmFtZX0gKCR7cm93LnN0YXR1c30pOiAke2FuY2hvclRleHQocm93KX1gKTtcbiAgcmV0dXJuIFtcbiAgICAnVGhpcyBjaGFuZ2VzZXQgY2FycmllcyBzcGFuIGRlYnQgXHUyMDE0IHJlc29sdmUgaXQgYmVmb3JlIHRoaXMgbGFuZHM6JyxcbiAgICAuLi5saW5lcyxcbiAgICAnJyxcbiAgICBcIlVwZGF0ZSBlYWNoIHNwYW4ncyBhbmNob3JzL3doeSBpbiB0aGlzIHNhbWUgY2hhbmdlLCBvciB0ZWxsIHRoZSB1c2VyIHdoeSB0aGUgZGVzY3JpYmVkIGNvdXBsaW5nIG5vIGxvbmdlciBob2xkcywgdGhlbiByZXRyeS5cIixcbiAgICBFU0NBUEVfSEFUQ0hfTElORVxuICBdLmpvaW4oJ1xcbicpO1xufVxuXG4vKiogVGhlIG9uZS10aW1lIGxpc3QgYW4gdW5jb3ZlcmVkLXdyaXRlcyBkZW55IHJlbmRlcnMgaW50byBgcmVhc29uYC4gKi9cbmZ1bmN0aW9uIHJlbmRlclVuY292ZXJlZFJlYXNvbih1bmNvdmVyZWQ6IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgY29uc3QgbGluZXMgPSB1bmNvdmVyZWQubWFwKChwYXRoKSA9PiBgICAtICR7cGF0aH1gKTtcbiAgcmV0dXJuIFtcbiAgICAnVGhlc2UgY2hhbmdlZCBmaWxlcyBhcmUgY292ZXJlZCBieSBubyBzcGFuIFx1MjAxNCBjb25zaWRlciB3aGV0aGVyIHRoZXkgbmVlZCBvbmU6JyxcbiAgICAuLi5saW5lcyxcbiAgICAnJyxcbiAgICAnRGVjbGFyZSBhIGNvdXBsaW5nIHdpdGggYGdpdCBzcGFuIGFkZGAgaWYgb25lIGdlbnVpbmVseSBleGlzdHMsIG9yIGp1c3QgcmV0cnkgdGhlIGNvbW1hbmQgdG8gcHJvY2VlZCAodGhpcyBpcyBhIG9uZS10aW1lIGNoZWNrKS4nLFxuICAgIEVTQ0FQRV9IQVRDSF9MSU5FXG4gIF0uam9pbignXFxuJyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRXNjYXBlIGhhdGNoXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBXaGV0aGVyIHRoZSB0cmFuc2NyaXB0LXZpc2libGUgZXNjYXBlIGhhdGNoIGBHSVRfU1BBTl9HQVRFPXNraXBgIGlzIHNldCxcbiAqIGJ5cGFzc2luZyB0aGUgZ2F0ZSBmb3IgYSB1c2VyLWFwcHJvdmVkIGV4Y2VwdGlvbiAoQ0FSRC5tZCBhY2NlcHRhbmNlXG4gKiBjcml0ZXJpb24gNTsgdGhlIHNraWxsIGRvY3VtZW50cyB0aGF0IHNldHRpbmcgaXQgcmVxdWlyZXMgZXhwbGljaXQgdXNlclxuICogYXBwcm92YWwpLlxuICpcbiAqIEltcGxlbWVudGVkIChub3Qgc3R1YmJlZCkgaW4gdGhpcyBwaGFzZTogaXQgaXMgYSBzaW5nbGUsIHB1cmUgZW52LXZhciByZWFkXG4gKiB0aGF0IENBUkQubWQgZnVsbHkgc3BlY2lmaWVzLCBzbyB0aGUgc3R1Yi10aGVuLWltcGxlbWVudCBjZXJlbW9ueSB3b3VsZCBhZGRcbiAqIG5vdGhpbmcgXHUyMDE0IHRoZXJlIGlzIG5vIGxvZ2ljIHRvIGdldCB3cm9uZyBiZXlvbmQgdGhlIGV4YWN0LXN0cmluZyBtYXRjaCwgYW5kIGFcbiAqIHRyaXZpYWwgaW1wbGVtZW50YXRpb24gaXMgbW9yZSBob25lc3QgdGhhbiBhIHN0dWIgdGhhdCB0aHJvd3MuIEtlcHQgcHVyZSBvdmVyXG4gKiBgcHJvY2Vzcy5lbnZgIChlbnYgaW5qZWN0ZWQgYXMgYSBwYXJhbWV0ZXIpIHNvIFBoYXNlIDMuMiBjYW4gZXhlcmNpc2UgYm90aFxuICogYnJhbmNoZXMgd2l0aG91dCBtdXRhdGluZyBnbG9iYWwgc3RhdGUuXG4gKlxuICogQHBhcmFtIGVudiBUaGUgZW52aXJvbm1lbnQgdG8gcmVhZCwgZS5nLiBgcHJvY2Vzcy5lbnZgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNHYXRlU2tpcHBlZChlbnY6IE5vZGVKUy5Qcm9jZXNzRW52IHwgUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkPik6IGJvb2xlYW4ge1xuICByZXR1cm4gZW52WydHSVRfU1BBTl9HQVRFJ10gPT09ICdza2lwJztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBEZWZhdWx0IHN1YnByb2Nlc3MvZGlzay1iYWNrZWQgZGVwZW5kZW5jaWVzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vXG4vLyBUaGUgcHJvZHVjdGlvbiBzdXJmYWNlcyBib3RoIGFkYXB0ZXJzIGluamVjdCBieSBkZWZhdWx0LCBmb2xsb3dpbmdcbi8vIHRvdWNoLWNvcmUudHMncyBgY3JlYXRlRGVmYXVsdFRvdWNoRXhlY3V0b3JzYCBzdHlsZTogZWFjaCBjYXB0dXJlcyBzdGRvdXQgZXZlblxuLy8gb24gYSBub24temVybyBleGl0IHdoZXJlIHRoZSBDTEkgc3RpbGwgZW1pdHMgdXNlZnVsIG91dHB1dCwgYW5kIGV2ZXJ5IGZhaWx1cmVcbi8vIG1vZGUgKGFic2VudCBiaW5hcnksIHRpbWVvdXQsIG5vIHJlcG8pIHN1cmZhY2VzIGFzIGFuIGVtcHR5L2NsZWFuIHJlc3VsdCBzb1xuLy8gdGhlIGdhdGUncyBmYWlsLW9wZW4gY29udHJhY3QgaG9sZHMgd2l0aG91dCB0aGUgYWRhcHRlciBhZGRpbmcgaXRzIG93bi5cblxuY29uc3QgREVGQVVMVF9USU1FT1VUX01TID0gMTBfMDAwO1xuXG4vKiogUnVuIGEgZ2l0IGNvbW1hbmQgYXQgYGN3ZGAsIHJldHVybmluZyB0cmltbWVkIG5vbi1lbXB0eSBQT1NJWCBvdXRwdXQgbGluZXMgKGVtcHR5IG9uIGFueSBmYWlsdXJlKS4gKi9cbmZ1bmN0aW9uIGdpdExpbmVzKGFyZ3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZywgdGltZW91dE1zOiBudW1iZXIpOiBzdHJpbmdbXSB7XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBhcmdzLCB7XG4gICAgICBjd2QsXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICB9KTtcbiAgICByZXR1cm4gb3V0XG4gICAgICAuc3BsaXQoJ1xcbicpXG4gICAgICAubWFwKChsaW5lKSA9PiBsaW5lLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoKGxpbmUpID0+IGxpbmUubGVuZ3RoID4gMClcbiAgICAgIC5tYXAodG9Qb3NpeCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBbXTtcbiAgfVxufVxuXG4vKipcbiAqIExpa2Uge0BsaW5rIGdpdExpbmVzfSBidXQgZGlzdGluZ3Vpc2hlcyBhICpmYWlsZWQqIGludm9jYXRpb24gKGBudWxsYCBcdTIwMTQgZS5nLlxuICogYEB7dX1gIHdpdGggbm8gdXBzdHJlYW0gY29uZmlndXJlZCkgZnJvbSBhICpzdWNjZXNzZnVsIGJ1dCBlbXB0eSogcmVzdWx0XG4gKiAoYFtdYCksIHNvIHRoZSBvdXRnb2luZy1yYW5nZSByZXNvbHV0aW9uIGtub3dzIHdoZW4gdG8gdHJ5IHRoZSBtZXJnZS1iYXNlXG4gKiBmYWxsYmFjayByYXRoZXIgdGhhbiBtaXN0YWtpbmcgXCJubyB1cHN0cmVhbVwiIGZvciBcIm5vdGhpbmcgdG8gcHVzaFwiLlxuICovXG5mdW5jdGlvbiBnaXRMaW5lc09yTnVsbChhcmdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcsIHRpbWVvdXRNczogbnVtYmVyKTogc3RyaW5nW10gfCBudWxsIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIGFyZ3MsIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgIH0pO1xuICAgIHJldHVybiBvdXRcbiAgICAgIC5zcGxpdCgnXFxuJylcbiAgICAgIC5tYXAoKGxpbmUpID0+IGxpbmUudHJpbSgpKVxuICAgICAgLmZpbHRlcigobGluZSkgPT4gbGluZS5sZW5ndGggPiAwKVxuICAgICAgLm1hcCh0b1Bvc2l4KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqIFRoZSBwcm9kdWN0aW9uIHtAbGluayBHaXRFeGVjdXRvcn06IGBnaXQgZGlmZmAgcmVhZHMgc2NvcGVkIHRvIHRoZSBDV0QgcmVwby4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0R2l0RXhlY3V0b3IodGltZW91dE1zOiBudW1iZXIgPSBERUZBVUxUX1RJTUVPVVRfTVMpOiBHaXRFeGVjdXRvciB7XG4gIHJldHVybiB7XG4gICAgc3RhZ2VkUGF0aHM6IGFzeW5jIChjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290KSByZXR1cm4gW107XG4gICAgICByZXR1cm4gZ2l0TGluZXMoWyctQycsIHJlcG9Sb290LCAnZGlmZicsICctLWNhY2hlZCcsICctLW5hbWUtb25seSddLCByZXBvUm9vdCwgdGltZW91dE1zKTtcbiAgICB9LFxuICAgIHRyYWNrZWRNb2RpZmllZFBhdGhzOiBhc3luYyAoY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCkgcmV0dXJuIFtdO1xuICAgICAgcmV0dXJuIGdpdExpbmVzKFsnLUMnLCByZXBvUm9vdCwgJ2RpZmYnLCAnLS1uYW1lLW9ubHknXSwgcmVwb1Jvb3QsIHRpbWVvdXRNcyk7XG4gICAgfSxcbiAgICBvdXRnb2luZ1BhdGhzOiBhc3luYyAoY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCkgcmV0dXJuIFtdO1xuICAgICAgY29uc3QgdXBzdHJlYW0gPSBnaXRMaW5lc09yTnVsbChbJy1DJywgcmVwb1Jvb3QsICdkaWZmJywgJy0tbmFtZS1vbmx5JywgJ0B7dX0uLkhFQUQnXSwgcmVwb1Jvb3QsIHRpbWVvdXRNcyk7XG4gICAgICBpZiAodXBzdHJlYW0gIT09IG51bGwpIHJldHVybiB1cHN0cmVhbTtcbiAgICAgIC8vIE5vIHVwc3RyZWFtIGNvbmZpZ3VyZWQ6IGZhbGwgYmFjayB0byB0aGUgbWVyZ2UtYmFzZSB3aXRoIHRoZSBkZWZhdWx0XG4gICAgICAvLyByZW1vdGUgYnJhbmNoIChgb3JpZ2luL0hFQURgKS4gSWYgdGhhdCB0b28gaXMgdW5yZXNvbHZhYmxlLCBmYWlsIG9wZW4uXG4gICAgICBjb25zdCBiYXNlID0gZ2l0TGluZXMoWyctQycsIHJlcG9Sb290LCAnbWVyZ2UtYmFzZScsICdIRUFEJywgJ29yaWdpbi9IRUFEJ10sIHJlcG9Sb290LCB0aW1lb3V0TXMpWzBdO1xuICAgICAgaWYgKCFiYXNlKSByZXR1cm4gW107XG4gICAgICByZXR1cm4gZ2l0TGluZXMoWyctQycsIHJlcG9Sb290LCAnZGlmZicsICctLW5hbWUtb25seScsIGAke2Jhc2V9Li5IRUFEYF0sIHJlcG9Sb290LCB0aW1lb3V0TXMpO1xuICAgIH1cbiAgfTtcbn1cblxuLyoqIFRoZSBwcm9kdWN0aW9uIHtAbGluayBHYXRlRXhlY3V0b3JzfTogc2NvcGVkIGBnaXQgc3BhbmAgZml4L3N0YWxlL2xpc3QgYXQgdGhlIHJlcG8gcm9vdC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0R2F0ZUV4ZWN1dG9ycyh0aW1lb3V0TXM6IG51bWJlciA9IERFRkFVTFRfVElNRU9VVF9NUyk6IEdhdGVFeGVjdXRvcnMge1xuICByZXR1cm4ge1xuICAgIGZpeDogYXN5bmMgKHBhdGhzLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290IHx8IHBhdGhzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICAgICAgdHJ5IHtcbiAgICAgICAgZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnc3RhbGUnLCAuLi5wYXRocywgJy0tZml4J10sIHtcbiAgICAgICAgICBjd2Q6IHJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBgZ2l0IHNwYW4gc3RhbGVgIGV4aXRzIDEgb24gZHJpZnQgZXZlbiBhZnRlciBoZWFsaW5nLCBhbmQgbm9uLXplcm8gb25cbiAgICAgICAgLy8gZ2VudWluZSBmYWlsdXJlOyBlaXRoZXIgd2F5IHRoZSBzdWJzZXF1ZW50IGBzdGFsZWAgcmVhZCBpcyB0aGUgc291cmNlXG4gICAgICAgIC8vIG9mIHRydXRoLCBzbyB0aGUgZXhpdCBjb2RlIGlzIGlnbm9yZWQgaGVyZS5cbiAgICAgIH1cbiAgICB9LFxuICAgIHN0YWxlOiBhc3luYyAocGF0aHMsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGlmICghcmVwb1Jvb3QgfHwgcGF0aHMubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gICAgICBsZXQgb3V0OiBzdHJpbmc7XG4gICAgICB0cnkge1xuICAgICAgICBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdzdGFsZScsICctLWZvcm1hdCcsICdwb3JjZWxhaW4nLCAuLi5wYXRoc10sIHtcbiAgICAgICAgICBjd2Q6IHJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBjb25zdCBjYXB0dXJlZCA9IChlcnIgYXMgeyBzdGRvdXQ/OiBzdHJpbmcgfSkuc3Rkb3V0O1xuICAgICAgICBpZiAodHlwZW9mIGNhcHR1cmVkID09PSAnc3RyaW5nJykgb3V0ID0gY2FwdHVyZWQ7XG4gICAgICAgIGVsc2UgcmV0dXJuIFtdO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHBhcnNlU3RhbGVQb3JjZWxhaW4ob3V0KTtcbiAgICB9LFxuICAgIGxpc3Q6IGFzeW5jIChwYXRocywgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCB8fCBwYXRocy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2xpc3QnLCAnLS1wb3JjZWxhaW4nLCAuLi5wYXRoc10sIHtcbiAgICAgICAgICBjd2Q6IHJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHBhcnNlUG9yY2VsYWluKG91dCk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgfVxuICAgIH1cbiAgfTtcbn1cblxuLyoqXG4gKiBUaGUgcHJvZHVjdGlvbiBkaXNrLWJhY2tlZCB7QGxpbmsgR2F0ZU1lbW9TdGF0ZX06IG9uZSBtYXJrZXIgZmlsZSBwZXIgZGVidC1zdGF0ZVxuICogZGlnZXN0IHVuZGVyIHtAbGluayBnYXRlTWVtb0Rpcn0gKGA8Z2l0LWNvbW1vbi1kaXI+L2dpdC1zcGFuL2dhdGUvYCksIGZvbGxvd2luZ1xuICogc3Bhbi1zdXJmYWNlLnRzJ3MgZmlsZS1iYWNrZWQgYE1lbW9TdG9yZWAgcGF0dGVybi4gVGhlIGRpZ2VzdCBpcyBhIGhleCBzaGEyNTYsXG4gKiBhIHNhZmUgZmlsZW5hbWUuIEJlc3QtZWZmb3J0IGFuZCBub24tdGhyb3dpbmc6IGEgbWVtbyB3aG9zZSByZXBvIGNhbm5vdCBiZVxuICogcmVzb2x2ZWQgZGVncmFkZXMgdG8gYSBuby1vcCBzdG9yZSAobmV2ZXIgcGVyc2lzdHMgXHUyMTkyIHVuY292ZXJlZCB3b3VsZCByZS1kZW55LFxuICogYnV0IGFuIHVucmVzb2x2YWJsZSByZXBvIHlpZWxkcyBhbiBlbXB0eSBjaGFuZ2VzZXQgdXBzdHJlYW0gYW55d2F5KS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURpc2tHYXRlTWVtb1N0YXRlKGN3ZDogc3RyaW5nKTogR2F0ZU1lbW9TdGF0ZSB7XG4gIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gIGlmICghcmVwb1Jvb3QpIHtcbiAgICByZXR1cm4geyBoYXM6ICgpID0+IGZhbHNlLCByZWNvcmQ6ICgpID0+IHt9IH07XG4gIH1cbiAgY29uc3QgZGlyID0gZ2F0ZU1lbW9EaXIocmVwb1Jvb3QpO1xuICByZXR1cm4ge1xuICAgIGhhczogKGRpZ2VzdCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGZzLmV4aXN0c1N5bmMobm9kZVBhdGguam9pbihkaXIsIGRpZ2VzdCkpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICB9LFxuICAgIHJlY29yZDogKGRpZ2VzdCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgZnMubWtkaXJTeW5jKGRpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgICAgIGZzLndyaXRlRmlsZVN5bmMobm9kZVBhdGguam9pbihkaXIsIGRpZ2VzdCksICcnKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBCZXN0LWVmZm9ydDogYSBmYWlsZWQgbWVtbyB3cml0ZSBtdXN0IG5ldmVyIGJyaWNrIHRoZSBjb21taXQuXG4gICAgICB9XG4gICAgfVxuICB9O1xufVxuIiwgIi8qKlxuICogU2hhcmVkIGhlbHBlcnMgdXNlZCBieSBtdWx0aXBsZSBhZ2VudC1ob29rcyBlbnRyeSBwb2ludHMuXG4gKlxuICogRXh0cmFjdGVkIGZyb20gcHJlLXRvb2wtdXNlLnRzIHNvIHRoYXQgdGhlIHVwY29taW5nIFN0b3AgaG9vayAoYW5kIGFueVxuICogZnV0dXJlIGhvb2tzKSBjYW4gaW1wb3J0IHBhdGggdXRpbGl0aWVzLCByYW5nZSBoZWxwZXJzLCBhbmQgdGhlXG4gKiBzYW5pdGl6ZVNlc3Npb25JZC9mb3JtYXRBbmNob3IgZnVuY3Rpb25zIHdpdGhvdXQgZGVwZW5kaW5nIG9uIHRoZVxuICogUHJlVG9vbFVzZS1zcGVjaWZpYyBtb2R1bGUuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgb3MgZnJvbSAnbm9kZTpvcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBhdGggaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiB0b1Bvc2l4KHA6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBwLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbn1cblxuZnVuY3Rpb24gaXNBYnNvbHV0ZVBvc2l4KHA6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gcC5zdGFydHNXaXRoKCcvJykgfHwgL15bQS1aYS16XTpcXC8vLnRlc3QocCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhYnNwYXRoQWdhaW5zdChiYXNlOiBzdHJpbmcsIHRhcmdldDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdCA9IHRvUG9zaXgodGFyZ2V0KTtcbiAgaWYgKGlzQWJzb2x1dGVQb3NpeCh0KSkgcmV0dXJuIHQ7XG4gIGNvbnN0IGIgPSB0b1Bvc2l4KGJhc2UpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICByZXR1cm4gYCR7Yn0vJHt0fWA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUmVwb1Jvb3QoZGlyOiBzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICghZGlyKSByZXR1cm4gbnVsbDtcbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCBkaXIsICdyZXYtcGFyc2UnLCAnLS1zaG93LXRvcGxldmVsJ10sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4J1xuICAgIH0pO1xuICAgIGNvbnN0IHRyaW1tZWQgPSBvdXQudHJpbSgpO1xuICAgIHJldHVybiB0cmltbWVkLmxlbmd0aCA+IDAgPyB0b1Bvc2l4KHRyaW1tZWQpIDogbnVsbDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqXG4gKiBSZXBvcnQgd2hldGhlciBhIHJlcG8tcmVsYXRpdmUgcGF0aCBpcyBleGNsdWRlZCBieSBnaXQncyBpZ25vcmUgcnVsZXNcbiAqICguZ2l0aWdub3JlLCAuZ2l0L2luZm8vZXhjbHVkZSwgY29yZS5leGNsdWRlc0ZpbGUpLiBVc2VkIHRvIGtlZXAgaWdub3JlZFxuICogZmlsZXMgXHUyMDE0IGJ1aWxkIG91dHB1dCwgY2FjaGVzLCBsb2dzIFx1MjAxNCBvdXQgb2YgdG91Y2ggdHJhY2tpbmcgZW50aXJlbHksIHNvXG4gKiB0aGUgdG91Y2ggaG9vayBuZXZlciByZXBvcnRzIHJlYWRzLCB3cml0ZXMsIG9yIHVuY292ZXJlZCB3cml0ZXMgb24gdGhlbS5cbiAqXG4gKiBgZ2l0IGNoZWNrLWlnbm9yZSAtcSA8cGF0aD5gIGV4aXRzIDAgd2hlbiB0aGUgcGF0aCBpcyBpZ25vcmVkLCAxIHdoZW4gaXQgaXNcbiAqIG5vdCwgYW5kIDEyOCBvbiBlcnJvci4gZXhlY0ZpbGVTeW5jIHRocm93cyBvbiBhbnkgbm9uLXplcm8gZXhpdCwgc28gYSBjbGVhblxuICogcmV0dXJuIG1lYW5zIFwiaWdub3JlZFwiLiBBIHN0YXR1cy0xIHRocm93IGlzIHRoZSBleHBlY3RlZCBcIm5vdCBpZ25vcmVkXCJcbiAqIHNpZ25hbDsgYW55IG90aGVyIGZhaWx1cmUgaXMgYW4gdW5yZWxpYWJsZSBhbnN3ZXIsIHNvIHdlIHJlcG9ydCBgZmFsc2VgXG4gKiAoZG8gbm90IGRyb3AgdGhlIHRvdWNoKSByYXRoZXIgdGhhbiBzaWxlbnRseSBoaWRpbmcgYSB0cmFja2VkIGZpbGUuXG4gKi9cbi8qKlxuICogVGhlIGRlZmF1bHQgc3BhbiByb290IGRpcmVjdG9yeSwgcmVsYXRpdmUgdG8gdGhlIHJlcG8gcm9vdCwgdXNlZCB3aGVuIG5vXG4gKiBlbnZpcm9ubWVudCB2YXJpYWJsZSBvciBnaXQgY29uZmlnIG92ZXJyaWRlcyB0aGUgbG9jYXRpb24uXG4gKi9cbmV4cG9ydCBjb25zdCBTUEFOX1JPT1QgPSAnLnNwYW4nO1xuXG4vKipcbiAqIFJlc29sdmUgdGhlIHNwYW4gcm9vdCBkaXJlY3RvcnkgZm9yIGEgZ2l2ZW4gcmVwbywgbWlycm9yaW5nIHRoZSBSdXN0IENMSVxuICogcHJlY2VkZW5jZSAobWludXMgdGhlIC0tc3Bhbi1kaXIgQ0xJIGZsYWcsIHdoaWNoIGlzIGludmlzaWJsZSB0byBmaWxlLXdyaXRlXG4gKiBob29rcyk6XG4gKiAgIDEuIEdJVF9TUEFOX0RJUiBlbnZpcm9ubWVudCB2YXJpYWJsZVxuICogICAyLiBgZ2l0IGNvbmZpZyBnaXQtc3Bhbi5kaXJgIGluIHRoZSByZXBvXG4gKiAgIDMuIERlZmF1bHQ6IFwiLnNwYW5cIlxuICpcbiAqIFRoZSByZXR1cm5lZCB2YWx1ZSBpcyBhIFBPU0lYLXN0eWxlIHBhdGggd2l0aCBubyB0cmFpbGluZyBzbGFzaC5cbiAqIEZhaWwtc2FmZTogYW55IHJlc29sdXRpb24gZXJyb3IgZmFsbHMgYmFjayB0byBcIi5zcGFuXCIgc28gdGhlIGhvb2sgbmV2ZXJcbiAqIGNyYXNoZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGVudkRpciA9IHByb2Nlc3MuZW52WydHSVRfU1BBTl9ESVInXTtcbiAgaWYgKGVudkRpciAmJiBlbnZEaXIudHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4gdG9Qb3NpeChlbnZEaXIudHJpbSgpKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgfVxuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnY29uZmlnJywgJ2dpdC1zcGFuLmRpciddLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIGVuY29kaW5nOiAndXRmOCdcbiAgICB9KTtcbiAgICBjb25zdCB0cmltbWVkID0gdG9Qb3NpeChvdXQudHJpbSgpKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgICBpZiAodHJpbW1lZC5sZW5ndGggPiAwKSByZXR1cm4gdHJpbW1lZDtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdm9pZCBlcnI7IC8vIGNvbmZpZyBrZXkgYWJzZW50IG9yIGdpdCBlcnJvciBcdTIwMTQgZmFsbCB0aHJvdWdoIHRvIGRlZmF1bHRcbiAgfVxuICByZXR1cm4gU1BBTl9ST09UO1xufVxuXG4vKipcbiAqIFJlcG9ydCB3aGV0aGVyIGEgcmVwby1yZWxhdGl2ZSBQT1NJWCBwYXRoIGZhbGxzIGluc2lkZSB0aGUgZ2l2ZW4gc3BhbiByb290XG4gKiBkaXJlY3RvcnkuIEEgcGF0aCBpcyBpbnNpZGUgd2hlbiBpdCBlcXVhbHMgdGhlIHNwYW4gcm9vdCBleGFjdGx5IG9yIGlzXG4gKiBuZXN0ZWQgYmVuZWF0aCBpdCAoaS5lLiBzdGFydHMgd2l0aCBcIjxzcGFuUm9vdD4vXCIpLiBUaGUgXCIvXCIgYm91bmRhcnkgcHJldmVudHNcbiAqIGZhbHNlIHBvc2l0aXZlcyBmb3Igc2libGluZ3MgbGlrZSBcIi5zcGFucy94XCIgb3IgXCIuc3Bhbi1ub3Rlcy94XCIuXG4gKlxuICogUGFzcyB0aGUgcmVzdWx0IG9mIGByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3QpYCBhcyBgc3BhblJvb3RgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNJbnNpZGVTcGFuUm9vdChyZXBvUmVsUGF0aDogc3RyaW5nLCBzcGFuUm9vdDogc3RyaW5nID0gU1BBTl9ST09UKTogYm9vbGVhbiB7XG4gIGNvbnN0IHJvb3QgPSBzcGFuUm9vdC5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgcmV0dXJuIHJlcG9SZWxQYXRoID09PSByb290IHx8IHJlcG9SZWxQYXRoLnN0YXJ0c1dpdGgoYCR7cm9vdH0vYCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0dpdElnbm9yZWQocmVwb1Jvb3Q6IHN0cmluZywgcmVwb1JlbFBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnY2hlY2staWdub3JlJywgJy1xJywgJy0tJywgcmVwb1JlbFBhdGhdLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAnaWdub3JlJywgJ2lnbm9yZSddXG4gICAgfSk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHZvaWQgZXJyO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3Q6IHN0cmluZywgYWJzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgcm9vdCA9IHRvUG9zaXgocmVwb1Jvb3QpO1xuICBjb25zdCBhYnMgPSB0b1Bvc2l4KGFic1BhdGgpO1xuICBjb25zdCBwcmVmaXggPSByb290LmVuZHNXaXRoKCcvJykgPyByb290IDogYCR7cm9vdH0vYDtcbiAgcmV0dXJuIGFicy5zdGFydHNXaXRoKHByZWZpeCkgPyBhYnMuc2xpY2UocHJlZml4Lmxlbmd0aCkgOiBhYnM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5vbmljYWxpemVQYXRoKGFic1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHRvUG9zaXgoZnMucmVhbHBhdGhTeW5jLm5hdGl2ZShhYnNQYXRoKSk7XG4gIH0gY2F0Y2gge1xuICAgIC8vIEZpbGUgZG9lc24ndCBleGlzdCB5ZXQgKGUuZy4gV3JpdGUgdG8gYSBuZXcgZmlsZSk6IGNhbm9uaWNhbGl6ZSB0aGVcbiAgICAvLyBkaXJlY3RvcnkgYW5kIHJlam9pbiB0aGUgYmFzZW5hbWUgc28gc3ltbGlua3MgaW4gdGhlIHBhcmVudCBhcmUgcmVzb2x2ZWQuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGRpciA9IHRvUG9zaXgoZnMucmVhbHBhdGhTeW5jLm5hdGl2ZShub2RlUGF0aC5kaXJuYW1lKGFic1BhdGgpKSk7XG4gICAgICByZXR1cm4gYCR7ZGlyfS8ke25vZGVQYXRoLmJhc2VuYW1lKGFic1BhdGgpfWA7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBQYXJlbnQgZG9lc24ndCBleGlzdCBlaXRoZXI7IGZhbGwgYmFjayB0byB0aGUgdW4tY2Fub25pY2FsaXplZCBwYXRoLlxuICAgICAgcmV0dXJuIGFic1BhdGg7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkZXJpdmVQYXRoKHRvb2xJbnB1dDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGN3ZDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IGZwID0gdG9vbElucHV0LmZpbGVfcGF0aDtcbiAgaWYgKHR5cGVvZiBmcCAhPT0gJ3N0cmluZycgfHwgZnAubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgYWJzID0gYWJzcGF0aEFnYWluc3QoY3dkLCBmcCk7XG4gIHJldHVybiBjYW5vbmljYWxpemVQYXRoKGFicyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTGluZSByYW5nZSB0eXBlcyBhbmQgaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgTGluZVJhbmdlIHtcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByYW5nZXNJbnRlcnNlY3QoYTogTGluZVJhbmdlLCBiOiBMaW5lUmFuZ2UpOiBib29sZWFuIHtcbiAgcmV0dXJuIGEuc3RhcnQgPD0gYi5lbmQgJiYgYS5lbmQgPj0gYi5zdGFydDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQb3JjZWxhaW4gcm93IHBhcnNpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIFBvcmNlbGFpblJvdyB7XG4gIG5hbWU6IHN0cmluZztcbiAgcGF0aDogc3RyaW5nO1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlUG9yY2VsYWluKHN0ZG91dDogc3RyaW5nKTogUG9yY2VsYWluUm93W10ge1xuICBjb25zdCByb3dzOiBQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygc3Rkb3V0LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHBhcnRzID0gdHJpbW1lZC5zcGxpdCgnXFx0Jyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDMpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFtuYW1lLCBwYXRoLCByYW5nZV0gPSBwYXJ0cztcbiAgICBjb25zdCBkYXNoSWR4ID0gcmFuZ2UuaW5kZXhPZignLScpO1xuICAgIGlmIChkYXNoSWR4ID09PSAtMSkgY29udGludWU7XG4gICAgY29uc3Qgc3RhcnQgPSBwYXJzZUludChyYW5nZS5zbGljZSgwLCBkYXNoSWR4KSwgMTApO1xuICAgIGNvbnN0IGVuZCA9IHBhcnNlSW50KHJhbmdlLnNsaWNlKGRhc2hJZHggKyAxKSwgMTApO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpIHx8IE51bWJlci5pc05hTihlbmQpKSBjb250aW51ZTtcbiAgICByb3dzLnB1c2goeyBuYW1lLCBwYXRoLCBzdGFydCwgZW5kIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG4vKipcbiAqIFRoZSBmdWxsIGBnaXQgc3BhbiBzdGFsZSAtLWZvcm1hdCBwb3JjZWxhaW5gIHN0YXR1cyB0b2tlbiB2b2NhYnVsYXJ5ICh0aGVcbiAqIGdpdC1zcGFuIENMSSdzIHBvcmNlbGFpbiBjb250cmFjdCk6IGBGUkVTSGAvYE1PVkVEYC9gUkVTT0xWRURfUEVORElOR19DT01NSVRgXG4gKiBhcmUgcG9zaXRpb25hbC1vci1jbGVhbiBhbmQgbmV2ZXIgZGVidDsgZXZlcnkgb3RoZXIgdG9rZW4gaXMgc2VtYW50aWMgZHJpZnRcbiAqIG9yIGEgdGVybWluYWwvZXJyb3IgY29uZGl0aW9uIGFuZCBpcyBkZWJ0LiBTZWUge0BsaW5rIGlzRGVidH0gZm9yIHRoZVxuICogc2luZ2xlIHNvdXJjZSBvZiB0cnV0aCBvbiB0aGF0IHNwbGl0LlxuICovXG5leHBvcnQgY29uc3QgUE9SQ0VMQUlOX1NUQVRVU0VTID0gW1xuICAnRlJFU0gnLFxuICAnUkVTT0xWRURfUEVORElOR19DT01NSVQnLFxuICAnTU9WRUQnLFxuICAnQ0hBTkdFRCcsXG4gICdERUxFVEVEJyxcbiAgJ0NPTkZMSUNUJyxcbiAgJ1NVQk1PRFVMRScsXG4gICdMRlNfTk9UX0ZFVENIRUQnLFxuICAnTEZTX05PVF9JTlNUQUxMRUQnLFxuICAnUFJPTUlTT1JfTUlTU0lORycsXG4gICdTUEFSU0VfRVhDTFVERUQnLFxuICAnRklMVEVSX0ZBSUxFRCcsXG4gICdJT19FUlJPUidcbl0gYXMgY29uc3Q7XG5cbmV4cG9ydCB0eXBlIFBvcmNlbGFpblN0YXR1cyA9ICh0eXBlb2YgUE9SQ0VMQUlOX1NUQVRVU0VTKVtudW1iZXJdO1xuXG5jb25zdCBQT1JDRUxBSU5fU1RBVFVTX1NFVDogUmVhZG9ubHlTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoUE9SQ0VMQUlOX1NUQVRVU0VTKTtcblxuZnVuY3Rpb24gcGFyc2VQb3JjZWxhaW5TdGF0dXMocmF3OiBzdHJpbmcpOiBQb3JjZWxhaW5TdGF0dXMgfCBudWxsIHtcbiAgcmV0dXJuIFBPUkNFTEFJTl9TVEFUVVNfU0VULmhhcyhyYXcpID8gKHJhdyBhcyBQb3JjZWxhaW5TdGF0dXMpIDogbnVsbDtcbn1cblxuLyoqIEEgYHBhcnNlU3RhbGVQb3JjZWxhaW5gIHJvdzogYSB7QGxpbmsgUG9yY2VsYWluUm93fSBwbHVzIGl0cyBzdGF0dXMgdG9rZW4uICovXG5leHBvcnQgaW50ZXJmYWNlIFN0YWxlUG9yY2VsYWluUm93IGV4dGVuZHMgUG9yY2VsYWluUm93IHtcbiAgc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXM7XG59XG5cbi8qKlxuICogVGhlIGRlYnQgaW52YXJpYW50IChzeXN0ZW0td2lkZTsgY29uc3VtZWQgYnkgYm90aCB0aGUgZnV0dXJlIHRvdWNoLWNvcmUgYW5kXG4gKiBnYXRlLWNvcmUpOiBvbmx5IHNlbWFudGljIHN0YXR1c2VzIGFyZSBkZWJ0LiBgQ0hBTkdFRGAgYW5kIGBERUxFVEVEYCBhcmVcbiAqIHNlbWFudGljIGRyaWZ0OyB0aGUgcmVtYWluaW5nIG5vbi1GUkVTSC9NT1ZFRC9SRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCB0b2tlbnNcbiAqIGFyZSB0ZXJtaW5hbC9lcnJvciBjb25kaXRpb25zIGFuZCBhcmUgdHJlYXRlZCBhcyBkZWJ0IHRvbyAodGhleSBibG9jayBvblxuICogdGhlaXIgb3duIG1lcml0cyBcdTIwMTQgdGhlIENMSSBjb3VsZCBub3QgcmVzb2x2ZSB0aGUgYW5jaG9yIGF0IGFsbCkuIGBGUkVTSGAsXG4gKiBgTU9WRURgLCBhbmQgYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCBhcmUgbmV2ZXIgZGVidDogcG9zaXRpb25hbCBkcmlmdCB0aGVcbiAqIENMSSBjYW4gaGVhbCAob3IgYWxyZWFkeSBoYXMpIGlzIGludmlzaWJsZSwgYW5kIGEgcGVuZGluZy1jb21taXQgcmVzb2x1dGlvblxuICogaXMgbm90IG91dHN0YW5kaW5nIGRlYnQuXG4gKlxuICogTm90ZTogdGhlIHBvcmNlbGFpbiB2b2NhYnVsYXJ5IGRvZXMgbm90IGN1cnJlbnRseSBkaXN0aW5ndWlzaFxuICogY29udGVudC1lcXVpdmFsZW50IGBDSEFOR0VEYCAoZS5nLiB3aGl0ZXNwYWNlLW9ubHkgZHJpZnQgYC0tZml4YCBjYW4gaGVhbClcbiAqIGZyb20gZ2VudWluZWx5IHNlbWFudGljIGBDSEFOR0VEYCBcdTIwMTQgdGhhdCBjbGFzc2lmaWNhdGlvbiBpcyBub3QgcHJlc2VudCBpblxuICogYGdpdCBzcGFuIHN0YWxlIC0tZm9ybWF0IHBvcmNlbGFpbmAgb3V0cHV0IHRvZGF5LiBVbnRpbCB0aGUgQ0xJIGV4cG9zZXMgaXQsXG4gKiBldmVyeSBgQ0hBTkdFRGAgcm93IGlzIHRyZWF0ZWQgYXMgZGVidC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRGVidChzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IGJvb2xlYW4ge1xuICBzd2l0Y2ggKHN0YXR1cykge1xuICAgIGNhc2UgJ0ZSRVNIJzpcbiAgICBjYXNlICdNT1ZFRCc6XG4gICAgY2FzZSAnUkVTT0xWRURfUEVORElOR19DT01NSVQnOlxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgfVxufVxuXG4vKipcbiAqIGBnaXQgc3BhbiBzdGFsZSAtLWZvcm1hdCBwb3JjZWxhaW5gIGVtaXRzIGEgZGlmZmVyZW50IHNoYXBlIHRoYW5cbiAqIGBsaXN0IC0tcG9yY2VsYWluYDogYSBgIyBwb3JjZWxhaW4gdjJgIGhlYWRlciwgYCMgZnV6enkgTmAgY29tbWVudCBsaW5lcyxcbiAqIGFuZCBvbmUgYDxzdGF0dXM+XFx0PHNyYz5cXHQ8bmFtZT5cXHQ8cGF0aD5cXHQ8c3RhcnQ+XFx0PGVuZD5gIHJvdyBwZXIgZHJpZnRlZFxuICogYW5jaG9yICh3aG9sZS1maWxlIGFuY2hvcnMgY2FycnkgYCh3aG9sZSlgL2AtYCBpbiBwbGFjZSBvZiB0aGUgbGluZSBjb2x1bW5zKS5cbiAqIFJvd3Mgd2hvc2Ugc3RhdHVzIHRva2VuIGlzIG5vdCBpbiB7QGxpbmsgUE9SQ0VMQUlOX1NUQVRVU0VTfSBhcmUgc2tpcHBlZCBcdTIwMTRcbiAqIGFuIHVucmVjb2duaXplZCB0b2tlbiBmcm9tIGEgbmV3ZXIgQ0xJIGlzIHRyZWF0ZWQgdGhlIHNhbWUgYXMgYSBtYWxmb3JtZWRcbiAqIGxpbmUgcmF0aGVyIHRoYW4gZ3Vlc3NlZCBhdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlU3RhbGVQb3JjZWxhaW4oc3Rkb3V0OiBzdHJpbmcpOiBTdGFsZVBvcmNlbGFpblJvd1tdIHtcbiAgY29uc3Qgcm93czogU3RhbGVQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygc3Rkb3V0LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQgfHwgdHJpbW1lZC5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHBhcnRzID0gdHJpbW1lZC5zcGxpdCgnXFx0Jyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDYpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFtzdGF0dXNDb2wsICwgbmFtZSwgcGF0aCwgc3RhcnRDb2wsIGVuZENvbF0gPSBwYXJ0cztcbiAgICBjb25zdCBzdGF0dXMgPSBwYXJzZVBvcmNlbGFpblN0YXR1cyhzdGF0dXNDb2wpO1xuICAgIGlmICghc3RhdHVzKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IHN0YXJ0Q29sID09PSAnKHdob2xlKScgPyAwIDogcGFyc2VJbnQoc3RhcnRDb2wsIDEwKTtcbiAgICBjb25zdCBlbmQgPSBlbmRDb2wgPT09ICctJyA/IDAgOiBwYXJzZUludChlbmRDb2wsIDEwKTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0KSB8fCBOdW1iZXIuaXNOYU4oZW5kKSkgY29udGludWU7XG4gICAgcm93cy5wdXNoKHsgbmFtZSwgcGF0aCwgc3RhcnQsIGVuZCwgc3RhdHVzIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFNlc3Npb24gSUQgc2FuaXRpemF0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBJbmplY3RpdmUgdHJhbnNmb3JtOiBwZXJjZW50LWVuY29kZSBieXRlcyBvdXRzaWRlIFtBLVphLXowLTkuXy1dIGFzICVISFxuICogKHVwcGVyY2FzZSBoZXgpLiBVc2VkIHRvIHByb2R1Y2Ugc2FmZSBmaWxlbmFtZXMgZnJvbSBhcmJpdHJhcnkgc2Vzc2lvbiBpZHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZVNlc3Npb25JZChzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzZXNzaW9uSWQucmVwbGFjZSgvW15BLVphLXowLTkuXy1dL2csIChjaCkgPT4ge1xuICAgIHJldHVybiBgJSR7Y2guY2hhckNvZGVBdCgwKS50b1N0cmluZygxNikudG9VcHBlckNhc2UoKS5wYWRTdGFydCgyLCAnMCcpfWA7XG4gIH0pO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBlci1zZXNzaW9uIGJhc2UgZGlyZWN0b3J5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLy8gQmFzZSBkaXIgc2hhcmVkIGJ5IGFsbCBwZXItc2Vzc2lvbiBzdGF0ZTogY3VycmVudGx5IGp1c3QgdGhlIHRvdWNoLWhvb2tcbi8vIHNlc3Npb24gbWVtbyAoc3Bhbi1zdXJmYWNlLnRzJ3MgTWVtb1N0b3JlKS4gRWFjaCBzZXNzaW9uIGdldHMgb25lXG4vLyBzdWJkaXJlY3Rvcnkga2V5ZWQgYnkgaXRzIHNhbml0aXplZCBpZCwgc28gZXZlcnkgd3JpdGVyL3JlYWRlciBmb3IgYSBnaXZlblxuLy8gc2Vzc2lvbiBhZ3JlZXMgb24gaXRzIGxvY2F0aW9uLlxuZXhwb3J0IGNvbnN0IFNFU1NJT05fQkFTRV9ESVIgPSBub2RlUGF0aC5qb2luKG9zLmhvbWVkaXIoKSwgJy5jYWNoZScsICdnaXQtc3BhbicsICdzZXNzaW9uJyk7XG5cbi8qKiBUaGUgcGVyLXNlc3Npb24gc3RhdGUgZGlyZWN0b3J5IGZvciBhIGdpdmVuIHNlc3Npb24gaWQuICovXG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvbkRpcihzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKFNFU1NJT05fQkFTRV9ESVIsIHNhbml0aXplU2Vzc2lvbklkKHNlc3Npb25JZCkpO1xufVxuXG5jb25zdCBUSElSVFlfREFZU19NUyA9IDMwICogMjQgKiA2MCAqIDYwICogMTAwMDtcblxuLyoqXG4gKiBPcHBvcnR1bmlzdGljYWxseSBwcnVuZSBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcmllcyB1bmRlclxuICoge0BsaW5rIFNFU1NJT05fQkFTRV9ESVJ9IHdob3NlIG10aW1lIGlzIG9sZGVyIHRoYW4gYG1heEFnZU1zYCAoZGVmYXVsdCAzMFxuICogZGF5cykuIEEgZGlyZWN0b3J5J3MgbXRpbWUgYWR2YW5jZXMgd2hlbmV2ZXIgYW4gZW50cnkgaW5zaWRlIGl0IGlzXG4gKiBjcmVhdGVkL3JlbmFtZWQvcmVtb3ZlZCwgc28gYW4gYWN0aXZlIHNlc3Npb24gKG1lbW8gd3JpdGVzKSBzdGF5cyBmcmVzaDtcbiAqIG9ubHkgZ2VudWluZWx5IGFiYW5kb25lZCBzZXNzaW9ucyBhZ2Ugb3V0LlxuICpcbiAqIEJlc3QtZWZmb3J0IGFuZCBub24tdGhyb3dpbmc6IGNhbGxlZCBvcHBvcnR1bmlzdGljYWxseSBmcm9tIGhvb2sgcmVhZC93cml0ZVxuICogcGF0aHMsIG5vdCBhIHNlcGFyYXRlIGNyb24tbGlrZSBtZWNoYW5pc20sIHNvIGEgZmFpbHVyZSBoZXJlIG11c3QgbmV2ZXJcbiAqIGJsb2NrIHRoZSBjYWxsZXIncyBhY3R1YWwgd29yay5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBydW5lU3RhbGVTZXNzaW9ucyhub3c6IG51bWJlciA9IERhdGUubm93KCksIG1heEFnZU1zOiBudW1iZXIgPSBUSElSVFlfREFZU19NUyk6IHZvaWQge1xuICBsZXQgZW50cmllczogZnMuRGlyZW50W107XG4gIHRyeSB7XG4gICAgZW50cmllcyA9IGZzLnJlYWRkaXJTeW5jKFNFU1NJT05fQkFTRV9ESVIsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuOyAvLyBiYXNlIGRpciBhYnNlbnQgb3IgdW5yZWFkYWJsZSBcdTIwMTQgbm90aGluZyB0byBwcnVuZVxuICB9XG4gIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgIGlmICghZW50cnkuaXNEaXJlY3RvcnkoKSkgY29udGludWU7XG4gICAgY29uc3QgZGlyUGF0aCA9IG5vZGVQYXRoLmpvaW4oU0VTU0lPTl9CQVNFX0RJUiwgZW50cnkubmFtZSk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0YXQgPSBmcy5zdGF0U3luYyhkaXJQYXRoKTtcbiAgICAgIGlmIChub3cgLSBzdGF0Lm10aW1lTXMgPiBtYXhBZ2VNcykge1xuICAgICAgICBmcy5ybVN5bmMoZGlyUGF0aCwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICAgICAgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gVmFuaXNoZWQgYmV0d2VlbiByZWFkZGlyIGFuZCBzdGF0LCBvciByZW1vdmFsIGZhaWxlZCBcdTIwMTQgc2tpcCBpdC4gQVxuICAgICAgLy8gYmVzdC1lZmZvcnQgcHJ1bmUgbXVzdCBuZXZlciB0aHJvdyBpbnRvIHRoZSBjYWxsZXIncyBob3QgcGF0aC5cbiAgICB9XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBraW5kIGFuZCBhbmNob3IgZm9ybWF0dGluZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB0eXBlIFRvdWNoS2luZCA9ICdyZWFkJyB8ICd3cml0ZScgfCAnd2hvbGUtcmVhZCcgfCAnd2hvbGUtd3JpdGUnIHwgJ2NyZWF0ZSc7XG5cbi8qKlxuICogRm9ybWF0IGEgc3BhbiBhbmNob3Igc3RyaW5nLlxuICpcbiAqIC0gYHdob2xlLXJlYWRgLCBgd2hvbGUtd3JpdGVgLCBhbmQgYGNyZWF0ZWA6IHJldHVybnMganVzdCB0aGUgcGF0aFxuICogLSBgcmVhZGAgYW5kIGB3cml0ZWA6IHJldHVybnMgYHBhdGgjTDxzdGFydD4tTDxlbmQ+YCAocmVxdWlyZXMgcmFuZ2UpXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRBbmNob3IocGF0aDogc3RyaW5nLCBraW5kOiBUb3VjaEtpbmQsIHJhbmdlPzogTGluZVJhbmdlKTogc3RyaW5nIHtcbiAgaWYgKChraW5kID09PSAncmVhZCcgfHwga2luZCA9PT0gJ3dyaXRlJykgJiYgcmFuZ2UpIHtcbiAgICByZXR1cm4gYCR7cGF0aH0jTCR7cmFuZ2Uuc3RhcnR9LUwke3JhbmdlLmVuZH1gO1xuICB9XG4gIHJldHVybiBwYXRoO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEFuY2hvciBzcGVjIHR5cGVcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIEFuY2hvclNwZWMge1xuICBwYXRoOiBzdHJpbmc7XG4gIGtpbmQ6IFRvdWNoS2luZDtcbiAgcmFuZ2U/OiBMaW5lUmFuZ2U7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUXVldWUgZGlyZWN0b3J5IGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJlc29sdmUgdGhlIGdpdCBjb21tb24gZGlyZWN0b3J5IGZvciB0aGUgZ2l2ZW4gcmVwbyByb290LlxuICogVGhpcyBpcyB0aGUgc2hhcmVkIGRpcmVjdG9yeSAobm90IHRoZSB3b3JrdHJlZS1zcGVjaWZpYyAuZ2l0KSwgc28gcXVldWVcbiAqIHJlY29yZHMgc3Vydml2ZSB3b3JrdHJlZSBkZWxldGlvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVHaXRDb21tb25EaXIocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAncmV2LXBhcnNlJywgJy0tZ2l0LWNvbW1vbi1kaXInXSwge1xuICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgIGVuY29kaW5nOiAndXRmOCdcbiAgfSk7XG4gIGNvbnN0IHRyaW1tZWQgPSB0b1Bvc2l4KG91dC50cmltKCkpO1xuICAvLyBnaXQgcmV0dXJucyBhIHJlbGF0aXZlIHBhdGggKGUuZy4gXCIuZ2l0XCIpIGZvciBzaW1wbGUgcmVwb3MuIFJlc29sdmUgaXRcbiAgLy8gYWdhaW5zdCByZXBvUm9vdCBzbyBjYWxsZXJzIG5ldmVyIGRlcGVuZCBvbiBwcm9jZXNzLmN3ZCgpLlxuICBpZiAoIW5vZGVQYXRoLmlzQWJzb2x1dGUodHJpbW1lZCkpIHtcbiAgICByZXR1cm4gdG9Qb3NpeChub2RlUGF0aC5yZXNvbHZlKHJlcG9Sb290LCB0cmltbWVkKSk7XG4gIH1cbiAgcmV0dXJuIHRyaW1tZWQ7XG59XG5cbi8qKlxuICogUm9vdCBvZiB0aGUgZ2l0LXNwYW4gcXVldWUgZGlyZWN0b3J5IHRyZWUsIHVuZGVyIHRoZSBnaXQgY29tbW9uIGRpci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHF1ZXVlUm9vdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocmVzb2x2ZUdpdENvbW1vbkRpcihyZXBvUm9vdCksICdnaXQtc3BhbicpO1xufVxuXG4vKipcbiAqIERpcmVjdG9yeSBmb3IgdGhlIGdhdGUncyBwZXItY2hhbmdlc2V0IHN0YXRlIG1lbW9zIChkaWdlc3Qgb2Ygc29ydGVkXG4gKiBmaW5kaW5ncyArIHVuY292ZXJlZCBwYXRocyksIHVuZGVyIHRoZSBnaXQgY29tbW9uIGRpciBzbyBpdCBpcyBzaGFyZWRcbiAqIGFjcm9zcyB3b3JrdHJlZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnYXRlTWVtb0RpcihyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4ocXVldWVSb290KHJlcG9Sb290KSwgJ2dhdGUnKTtcbn1cbiIsICIvKipcbiAqIFBhdGggZXhjbHVzaW9uIGxpc3QgZm9yIHRoZSBnYXRlJ3MgdW5jb3ZlcmVkLXdyaXRlcyBjaGVjay5cbiAqXG4gKiBgZXZhbHVhdGVHYXRlYCBpbiB7QGxpbmsgZmlsZTovLy4vZ2F0ZS1jb3JlLnRzfSBhbHJlYWR5IGV4Y2x1ZGVzIGAuc3Bhbi8qKmBcbiAqIHBhdGhzIGZyb20gaXRzIHVuY292ZXJlZC13cml0ZXMgY29tcHV0YXRpb24gdW5jb25kaXRpb25hbGx5IChzcGFuIHJlcGFpcnNcbiAqIHJpZGUgdGhlIHNhbWUgY29tbWl0IGFuZCBtdXN0IG5ldmVyIHNlbGYtdHJpZ2dlciB0aGUgZ2F0ZSkuIFRoaXMgbW9kdWxlXG4gKiBhZGRzIGEgc2Vjb25kLCB1c2VyLWRlY2xhcmVkIGV4Y2x1c2lvbiBzb3VyY2Ugb24gdG9wIG9mIHRoYXQ6IGEgcmVwbyBvd25lclxuICogY2FuIGxpc3QgYWRkaXRpb25hbCBwYXRocyB0aGUgdW5jb3ZlcmVkLXdyaXRlcyBjaGVjayBzaG91bGQgbmV2ZXIgZmxhZyBcdTIwMTRcbiAqIGdlbmVyYXRlZCBvdXRwdXQsIHZlbmRvcmVkIGNvZGUsIGFueXRoaW5nIHRoYXQgd2lsbCBuZXZlciBnZXQgYSBzcGFuLlxuICpcbiAqIENvbmZpZyBsaXZlcyBhdCBgPHJlcG9Sb290Pi8uc3Bhbi8uZ2F0ZWlnbm9yZWAuIFVubGlrZVxuICoge0BsaW5rIGZpbGU6Ly8uL3NwYW4taWdub3JlLnRzfSdzIGAuc3Bhbi8uaG9va2lnbm9yZWAgXHUyMDE0IHdoaWNoIHRoZSBgZ2l0LXNwYW5gXG4gKiBSdXN0IENMSSBhdXRvLWNyZWF0ZXMgd2l0aCBjYW5vbmljYWwgY29udGVudCBcdTIwMTQgYC5nYXRlaWdub3JlYCBpc1xuICogKip1c2VyLW93bmVkKio6IG5vdGhpbmcgY3JlYXRlcyBvciBwb3B1bGF0ZXMgaXQsIHNvIGl0cyBhYnNlbmNlIGlzIHRoZVxuICogbm9ybWFsLCB1bmNvbmZpZ3VyZWQgc3RhdGUsIG5vdCBhIGJyb2tlbiBvbmUuXG4gKlxuICogRWFjaCBub24tY29tbWVudCBsaW5lIGlzIGEgc2luZ2xlIGdpdGlnbm9yZS1zdHlsZSBwYXRoIHBhdHRlcm4gKG5vIHRyYWlsaW5nXG4gKiBwcmVmaXggbGlzdCBcdTIwMTQgYSBgLmdhdGVpZ25vcmVgIGxpbmUgZWl0aGVyIGV4Y2x1ZGVzIGEgcGF0aCBmcm9tIHRoZVxuICogdW5jb3ZlcmVkLXdyaXRlcyBjaGVjayBvciBpdCBkb2Vzbid0LCB1bmxpa2UgYC5ob29raWdub3JlYCdzIHBlci1zcGFuLXNsdWdcbiAqIHN1cHByZXNzaW9uKTpcbiAqXG4gKiAgIHBhY2thZ2VzL2FnZW50LWhvb2tzL2dlbmVyYXRlZC8qKlxuICpcbiAqIFBhdHRlcm4gZ3JhbW1hciBpcyBpZGVudGljYWwgdG8gYC5ob29raWdub3JlYCdzIChzZWUgdGhhdCBtb2R1bGUncyBkb2NcbiAqIGNvbW1lbnQgZm9yIHRoZSBmdWxsIGdyYW1tYXIpIGFuZCByZXVzZXMgaXRzIGNvbXBpbGVkIG1hdGNoZXIgdmlhXG4gKiB7QGxpbmsgY29tcGlsZVBhdHRlcm59IHJhdGhlciB0aGFuIHJlaW1wbGVtZW50aW5nIHBhdGggbWF0Y2hpbmc6XG4gKlxuICogLSBCbGFuayBsaW5lcyBhbmQgbGluZXMgYmVnaW5uaW5nIHdpdGggYCNgIGFyZSBza2lwcGVkLlxuICogLSBBIHRyYWlsaW5nIGAvYCByZXN0cmljdHMgdGhlIHBhdHRlcm4gdG8gZGlyZWN0b3JpZXMuXG4gKiAtIEEgcGF0dGVybiBjb250YWluaW5nIGEgc2xhc2ggaXMgYW5jaG9yZWQgdG8gdGhlIHJlcG8gcm9vdDsgYSBwYXR0ZXJuIHdpdGhcbiAqICAgbm8gc2xhc2ggbWF0Y2hlcyBhIHNpbmdsZSBwYXRoIGNvbXBvbmVudCBhdCBhbnkgZGVwdGguXG4gKiAtIGAqYCBhbmQgYD9gIG1hdGNoIHdpdGhpbiBvbmUgcGF0aCBzZWdtZW50OyBgKipgIG1hdGNoZXMgYWNyb3NzIHNlZ21lbnRzLlxuICogLSBOZWdhdGlvbiAoYCFgKSBpcyBub3Qgc3VwcG9ydGVkLlxuICpcbiAqIEZhaWwtb3BlbjogYSBtaXNzaW5nIG9yIHVucmVhZGFibGUgYC5nYXRlaWdub3JlYCwgb3IgYSBtYWxmb3JtZWQgbGluZSxcbiAqIHlpZWxkcyBubyBhZGRpdGlvbmFsIGV4Y2x1c2lvbiBcdTIwMTQgdGhlIHVuY292ZXJlZC13cml0ZXMgY2hlY2sgc2ltcGx5IGZhbGxzXG4gKiBiYWNrIHRvIHRoZSBgLnNwYW4vKipgLW9ubHkgZXhjbHVzaW9uIGl0IGFscmVhZHkgYXBwbGllcy5cbiAqL1xuXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBjb21waWxlUGF0dGVybiB9IGZyb20gJy4vc3Bhbi1pZ25vcmUuanMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEdhdGVJZ25vcmVSdWxlIHtcbiAgLyoqIFRoZSByYXcgZ2l0aWdub3JlLXN0eWxlIHBhdHRlcm4sIHJldGFpbmVkIGZvciBkaWFnbm9zdGljcy4gKi9cbiAgcGF0dGVybjogc3RyaW5nO1xuICAvKiogVHJ1ZSB3aGVuIGByZXBvUmVsUGF0aGAgKFBPU0lYLCByZXBvLXJlbGF0aXZlKSBpcyBleGNsdWRlZCBieSB0aGlzIHJ1bGUuICovXG4gIG1hdGNoZXM6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuO1xufVxuXG5jb25zdCBHQVRFX0lHTk9SRV9SRUwgPSBub2RlUGF0aC5qb2luKCcuc3BhbicsICcuZ2F0ZWlnbm9yZScpO1xuXG4vKiogUGFyc2UgYC5nYXRlaWdub3JlYCB0ZXh0IGludG8gcnVsZXMsIHNraXBwaW5nIGNvbW1lbnRzIGFuZCBibGFuayBsaW5lcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUdhdGVJZ25vcmUoY29udGVudDogc3RyaW5nKTogR2F0ZUlnbm9yZVJ1bGVbXSB7XG4gIGNvbnN0IHJ1bGVzOiBHYXRlSWdub3JlUnVsZVtdID0gW107XG4gIGZvciAoY29uc3QgcmF3TGluZSBvZiBjb250ZW50LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHBhdHRlcm4gPSByYXdMaW5lLnRyaW0oKTtcbiAgICBpZiAoIXBhdHRlcm4gfHwgcGF0dGVybi5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIHJ1bGVzLnB1c2goeyBwYXR0ZXJuLCBtYXRjaGVzOiBjb21waWxlUGF0dGVybihwYXR0ZXJuKSB9KTtcbiAgfVxuICByZXR1cm4gcnVsZXM7XG59XG5cbi8qKlxuICogTG9hZCB0aGUgZXhjbHVzaW9uIHJ1bGVzIGZvciBhIHJlcG8uIEZhaWwtb3BlbjogYW55IHJlYWQgZmFpbHVyZSB5aWVsZHMgYW5cbiAqIGVtcHR5IHJ1bGUgc2V0LCBzbyBhbiBhYnNlbnQvdW5yZWFkYWJsZSBgLmdhdGVpZ25vcmVgIGV4Y2x1ZGVzIG5vdGhpbmdcbiAqIGJleW9uZCB0aGUgZ2F0ZSdzIHVuY29uZGl0aW9uYWwgYC5zcGFuLyoqYCBleGNsdXNpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsb2FkR2F0ZUlnbm9yZShyZXBvUm9vdDogc3RyaW5nKTogR2F0ZUlnbm9yZVJ1bGVbXSB7XG4gIHRyeSB7XG4gICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhub2RlUGF0aC5qb2luKHJlcG9Sb290LCBHQVRFX0lHTk9SRV9SRUwpLCAndXRmOCcpO1xuICAgIHJldHVybiBwYXJzZUdhdGVJZ25vcmUoY29udGVudCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBbXTtcbiAgfVxufVxuXG4vKiogVHJ1ZSB3aGVuIHNvbWUgcnVsZSBpbiBgcnVsZXNgIG1hdGNoZXMgYHJlcG9SZWxQYXRoYC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0dhdGVJZ25vcmVkKHJ1bGVzOiBHYXRlSWdub3JlUnVsZVtdLCByZXBvUmVsUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBydWxlcy5zb21lKChydWxlKSA9PiBydWxlLm1hdGNoZXMocmVwb1JlbFBhdGgpKTtcbn1cblxuLyoqIFNpZ25hdHVyZSBmb3IgaW5qZWN0aW5nIGEgcnVsZSBsb2FkZXIgKHByb2R1Y3Rpb24gZGVmYXVsdDoge0BsaW5rIGxvYWRHYXRlSWdub3JlfSkuICovXG5leHBvcnQgdHlwZSBHYXRlSWdub3JlTG9hZGVyID0gKHJlcG9Sb290OiBzdHJpbmcpID0+IEdhdGVJZ25vcmVSdWxlW107XG4iLCAiLyoqXG4gKiBQYXRoLXNjb3BlZCBzcGFuIHN1cHByZXNzaW9uIGZvciB0aGUgYWdlbnQgaG9va3MuXG4gKlxuICogU29tZSBzcGFucyBhcmUgbm9pc2Ugd2hlbiBicm93c2luZyBjZXJ0YWluIHBhcnRzIG9mIHRoZSB0cmVlIFx1MjAxNCB3aWtpIG9yXG4gKiBtYXJrZXRpbmcgc3BhbnMgdGhhdCBhbmNob3IgcHJvc2UsIHN1cmZhY2VkIGlubGluZSB3aGlsZSByZWFkaW5nIHNvdXJjZSxcbiAqIGFkZCBsaXR0bGUuIFRoaXMgbW9kdWxlIGxldHMgYSByZXBvIGRlY2xhcmUsIHBlciBwYXRoLCB3aGljaCBzcGFuIHNsdWdcbiAqIHByZWZpeGVzIHRvIGhvbGQgYmFjay5cbiAqXG4gKiBDb25maWcgbGl2ZXMgYXQgYDxyZXBvUm9vdD4vLnNwYW4vLmhvb2tpZ25vcmVgLiBFYWNoIG5vbi1jb21tZW50IGxpbmUgaXMgYVxuICogZ2l0aWdub3JlLXN0eWxlIHBhdGggcGF0dGVybiwgYSBzaW5nbGUgcnVuIG9mIHdoaXRlc3BhY2UsIHRoZW4gYVxuICogY29tbWEtc2VwYXJhdGVkIGxpc3Qgb2Ygc3BhbiBzbHVnIHByZWZpeGVzIHRvIHN1cHByZXNzIGZvciBwYXRocyB0aGUgcGF0dGVyblxuICogbWF0Y2hlczpcbiAqXG4gKiAgIHBhY2thZ2VzL2FnZW50LWhvb2tzL3NyYyB3aWtpLG1hcmtldGluZ1xuICpcbiAqIEEgc3BhbiB3aG9zZSBzbHVnIGJlZ2lucyB3aXRoIGB3aWtpYCBvciBgbWFya2V0aW5nYCAodGhlIHNsdWcgZXF1YWxzIHRoZVxuICogcHJlZml4LCBvciBpcyBgPHByZWZpeD4vXHUyMDI2YCkgaXMgdGhlbiBuZXZlciBzdXJmYWNlZCBmb3IgYW4gYW5jaG9yIHdob3NlIHBhdGhcbiAqIHNpdHMgdW5kZXIgYHBhY2thZ2VzL2FnZW50LWhvb2tzL3NyY2AgXHUyMDE0IG5laXRoZXIgaW5saW5lIGJ5IHRoZSBQcmVUb29sVXNlIGhvb2tcbiAqIG5vciBpbiB0aGUgU3RvcCBob29rJ3Mgc3RhbGUgLyByZWxhdGVkIHNlY3Rpb25zLlxuICpcbiAqIFBhdHRlcm4gZ3JhbW1hciBpcyBhIGRlbGliZXJhdGUgc3Vic2V0IG9mIGdpdGlnbm9yZTpcbiAqXG4gKiAtIEJsYW5rIGxpbmVzIGFuZCBsaW5lcyBiZWdpbm5pbmcgd2l0aCBgI2AgYXJlIHNraXBwZWQuXG4gKiAtIEEgdHJhaWxpbmcgYC9gIHJlc3RyaWN0cyB0aGUgcGF0dGVybiB0byBkaXJlY3RvcmllcyAodGhlIGxlYWYgZmlsZSBpcyBub3RcbiAqICAgaXRzZWxmIHRlc3RlZCwgb25seSBpdHMgYW5jZXN0b3IgZGlyZWN0b3JpZXMpLlxuICogLSBBIHBhdHRlcm4gY29udGFpbmluZyBhIHNsYXNoIGlzIGFuY2hvcmVkIHRvIHRoZSByZXBvIHJvb3Q7IGEgcGF0dGVybiB3aXRoXG4gKiAgIG5vIHNsYXNoIG1hdGNoZXMgYSBzaW5nbGUgcGF0aCBjb21wb25lbnQgYXQgYW55IGRlcHRoLlxuICogLSBgKmAgYW5kIGA/YCBtYXRjaCB3aXRoaW4gb25lIHBhdGggc2VnbWVudDsgYCoqYCBtYXRjaGVzIGFjcm9zcyBzZWdtZW50cy5cbiAqIC0gTmVnYXRpb24gKGAhYCkgaXMgbm90IHN1cHBvcnRlZC5cbiAqXG4gKiBTdXBwcmVzc2lvbiBpcyBmYWlsLW9wZW46IGEgbWlzc2luZyBvciB1bnJlYWRhYmxlIGAuaG9va2lnbm9yZWAsIG9yIGFcbiAqIG1hbGZvcm1lZCBsaW5lLCB5aWVsZHMgbm8gcnVsZSByYXRoZXIgdGhhbiBoaWRpbmcgc3BhbnMgdGhlIGF1dGhvciBkaWQgbm90XG4gKiBhc2sgdG8gaGlkZS5cbiAqL1xuXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgSWdub3JlUnVsZSB7XG4gIC8qKiBUaGUgcmF3IGdpdGlnbm9yZS1zdHlsZSBwYXR0ZXJuLCByZXRhaW5lZCBmb3IgZGlhZ25vc3RpY3MuICovXG4gIHBhdHRlcm46IHN0cmluZztcbiAgLyoqIFNwYW4gc2x1ZyBwcmVmaXhlcyBzdXBwcmVzc2VkIGZvciBwYXRocyB0aGlzIHJ1bGUgbWF0Y2hlcy4gKi9cbiAgcHJlZml4ZXM6IHN0cmluZ1tdO1xuICAvKiogVHJ1ZSB3aGVuIGByZXBvUmVsUGF0aGAgKFBPU0lYLCByZXBvLXJlbGF0aXZlKSBpcyBnb3Zlcm5lZCBieSB0aGlzIHJ1bGUuICovXG4gIG1hdGNoZXM6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuO1xufVxuXG5jb25zdCBIT09LX0lHTk9SRV9SRUwgPSBub2RlUGF0aC5qb2luKCcuc3BhbicsICcuaG9va2lnbm9yZScpO1xuXG4vKipcbiAqIFRyYW5zbGF0ZSBvbmUgZ2l0aWdub3JlLXN0eWxlIGdsb2Igc2VnbWVudCBpbnRvIGFuIGFuY2hvcmVkIFJlZ0V4cC4gYCpgIGFuZFxuICogYD9gIHN0YXkgd2l0aGluIGEgcGF0aCBzZWdtZW50OyBgKipgIChvcHRpb25hbGx5IGZvbGxvd2VkIGJ5IGAvYCkgc3BhbnMgdGhlbS5cbiAqL1xuZnVuY3Rpb24gZ2xvYlRvUmVnRXhwKGdsb2I6IHN0cmluZyk6IFJlZ0V4cCB7XG4gIGxldCByZSA9ICcnO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGdsb2IubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjID0gZ2xvYltpXTtcbiAgICBpZiAoYyA9PT0gJyonKSB7XG4gICAgICBpZiAoZ2xvYltpICsgMV0gPT09ICcqJykge1xuICAgICAgICByZSArPSAnLionO1xuICAgICAgICBpKys7XG4gICAgICAgIC8vIEFic29yYiBhIGZvbGxvd2luZyBzbGFzaCBzbyBgKiovZm9vYCBkb2VzIG5vdCBkZW1hbmQgYSBsaXRlcmFsIGAvYC5cbiAgICAgICAgaWYgKGdsb2JbaSArIDFdID09PSAnLycpIGkrKztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlICs9ICdbXi9dKic7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChjID09PSAnPycpIHtcbiAgICAgIHJlICs9ICdbXi9dJztcbiAgICB9IGVsc2Uge1xuICAgICAgcmUgKz0gYy5yZXBsYWNlKC9bLiteJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG5ldyBSZWdFeHAoYF4ke3JlfSRgKTtcbn1cblxuLyoqIEFuY2VzdG9yIHBhdGggY2hhaW46IGBhL2IvYy50c2AgXHUyMTkyIGBbJ2EnLCAnYS9iJywgJ2EvYi9jLnRzJ11gLiAqL1xuZnVuY3Rpb24gYW5jZXN0b3JQYXRocyhwYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHBhcnRzID0gcGF0aC5zcGxpdCgnLycpO1xuICBjb25zdCBvdXQ6IHN0cmluZ1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICBvdXQucHVzaChwYXJ0cy5zbGljZSgwLCBpICsgMSkuam9pbignLycpKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIENvbXBpbGUgYSBzaW5nbGUgZ2l0aWdub3JlLXN0eWxlIHBhdHRlcm4gKHRoaXMgbW9kdWxlJ3MgZ3JhbW1hciBcdTIwMTQgc2VlIHRoZVxuICogbW9kdWxlIGRvYyBjb21tZW50KSBpbnRvIGEgcGF0aCBwcmVkaWNhdGUuIEEgcGF0dGVybiBtYXRjaGVzIGEgZmlsZSB3aGVuIGl0XG4gKiBtYXRjaGVzIHRoZSBmaWxlJ3MgcGF0aCBvciBhbnkgYW5jZXN0b3IgZGlyZWN0b3J5IG9mIGl0LCBzbyBhIGRpcmVjdG9yeVxuICogcGF0dGVybiBzdXBwcmVzc2VzIGV2ZXJ5dGhpbmcgYmVuZWF0aCBpdC5cbiAqXG4gKiBFeHBvcnRlZCBzbyBvdGhlciBwYXRoLXNjb3BlZCBpZ25vcmUtZmlsZSBjb252ZW50aW9ucyAoZS5nLiBgLmdhdGVpZ25vcmVgXG4gKiBpbiBgZ2F0ZS1pZ25vcmUudHNgKSBjYW4gcmV1c2UgdGhlIGV4YWN0IG1hdGNoaW5nIHNlbWFudGljcyByYXRoZXIgdGhhblxuICogcmVpbXBsZW1lbnRpbmcgdGhlbS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbXBpbGVQYXR0ZXJuKHBhdHRlcm46IHN0cmluZyk6IChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiBib29sZWFuIHtcbiAgbGV0IHBhdCA9IHBhdHRlcm47XG4gIGxldCBkaXJPbmx5ID0gZmFsc2U7XG4gIGlmIChwYXQuZW5kc1dpdGgoJy8nKSkge1xuICAgIGRpck9ubHkgPSB0cnVlO1xuICAgIHBhdCA9IHBhdC5zbGljZSgwLCAtMSk7XG4gIH1cbiAgbGV0IGFuY2hvcmVkID0gcGF0LmluY2x1ZGVzKCcvJyk7XG4gIGlmIChwYXQuc3RhcnRzV2l0aCgnLycpKSB7XG4gICAgYW5jaG9yZWQgPSB0cnVlO1xuICAgIHBhdCA9IHBhdC5zbGljZSgxKTtcbiAgfVxuICBjb25zdCByZSA9IGdsb2JUb1JlZ0V4cChwYXQpO1xuXG4gIHJldHVybiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4ge1xuICAgIGlmIChhbmNob3JlZCkge1xuICAgICAgY29uc3Qgc2VncyA9IGFuY2VzdG9yUGF0aHMocmVwb1JlbFBhdGgpO1xuICAgICAgLy8gRm9yIGEgZGlyLW9ubHkgcGF0dGVybiwgbmV2ZXIgdGVzdCB0aGUgbGVhZiBmaWxlIGl0c2VsZi5cbiAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBkaXJPbmx5ID8gc2Vncy5zbGljZSgwLCAtMSkgOiBzZWdzO1xuICAgICAgcmV0dXJuIGNhbmRpZGF0ZXMuc29tZSgocykgPT4gcmUudGVzdChzKSk7XG4gICAgfVxuICAgIC8vIFVuYW5jaG9yZWQ6IG1hdGNoIGFnYWluc3QgaW5kaXZpZHVhbCBwYXRoIGNvbXBvbmVudHMgYXQgYW55IGRlcHRoLlxuICAgIGNvbnN0IGNvbXBvbmVudHMgPSByZXBvUmVsUGF0aC5zcGxpdCgnLycpO1xuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBkaXJPbmx5ID8gY29tcG9uZW50cy5zbGljZSgwLCAtMSkgOiBjb21wb25lbnRzO1xuICAgIHJldHVybiBjYW5kaWRhdGVzLnNvbWUoKGMpID0+IHJlLnRlc3QoYykpO1xuICB9O1xufVxuXG4vKiogUGFyc2UgYC5ob29raWdub3JlYCB0ZXh0IGludG8gcnVsZXMsIHNraXBwaW5nIGNvbW1lbnRzIGFuZCBtYWxmb3JtZWQgbGluZXMuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VIb29rSWdub3JlKGNvbnRlbnQ6IHN0cmluZyk6IElnbm9yZVJ1bGVbXSB7XG4gIGNvbnN0IHJ1bGVzOiBJZ25vcmVSdWxlW10gPSBbXTtcbiAgZm9yIChjb25zdCByYXdMaW5lIG9mIGNvbnRlbnQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgbGluZSA9IHJhd0xpbmUudHJpbSgpO1xuICAgIGlmICghbGluZSB8fCBsaW5lLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgLy8gYDxwYXR0ZXJuPjx3aGl0ZXNwYWNlPjxwcmVmaXhlcz5gIFx1MjAxNCBwYXR0ZXJuIGlzIHRoZSBmaXJzdCB0b2tlbiwgcHJlZml4ZXNcbiAgICAvLyB0aGUgc2Vjb25kLiBBIGxpbmUgd2l0aG91dCBib3RoIGlzIG1hbGZvcm1lZCBhbmQgc2tpcHBlZC5cbiAgICBjb25zdCBtYXRjaCA9IGxpbmUubWF0Y2goL14oXFxTKylcXHMrKFxcUyspJC8pO1xuICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFssIHBhdHRlcm4sIHByZWZpeGVzUmF3XSA9IG1hdGNoO1xuICAgIGNvbnN0IHByZWZpeGVzID0gcHJlZml4ZXNSYXdcbiAgICAgIC5zcGxpdCgnLCcpXG4gICAgICAubWFwKChwKSA9PiBwLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gICAgaWYgKHByZWZpeGVzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgcnVsZXMucHVzaCh7IHBhdHRlcm4sIHByZWZpeGVzLCBtYXRjaGVzOiBjb21waWxlUGF0dGVybihwYXR0ZXJuKSB9KTtcbiAgfVxuICByZXR1cm4gcnVsZXM7XG59XG5cbi8qKlxuICogTG9hZCB0aGUgc3VwcHJlc3Npb24gcnVsZXMgZm9yIGEgcmVwby4gRmFpbC1vcGVuOiBhbnkgcmVhZCBvciBwYXJzZSBmYWlsdXJlXG4gKiB5aWVsZHMgYW4gZW1wdHkgcnVsZSBzZXQsIHNvIHNwYW5zIHN1cmZhY2UgYXMgbm9ybWFsIHdoZW4gbm8gY29uZmlnIGV4aXN0cy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxvYWRIb29rSWdub3JlKHJlcG9Sb290OiBzdHJpbmcpOiBJZ25vcmVSdWxlW10ge1xuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMobm9kZVBhdGguam9pbihyZXBvUm9vdCwgSE9PS19JR05PUkVfUkVMKSwgJ3V0ZjgnKTtcbiAgICByZXR1cm4gcGFyc2VIb29rSWdub3JlKGNvbnRlbnQpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gW107XG4gIH1cbn1cblxuLyoqIEEgc2x1ZyBjYXJyaWVzIGEgcHJlZml4IHdoZW4gaXQgZXF1YWxzIHRoZSBwcmVmaXggb3IgaXMgYDxwcmVmaXg+L1x1MjAyNmAuICovXG5mdW5jdGlvbiBzbHVnSGFzUHJlZml4KHNsdWc6IHN0cmluZywgcHJlZml4OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHNsdWcgPT09IHByZWZpeCB8fCBzbHVnLnN0YXJ0c1dpdGgoYCR7cHJlZml4fS9gKTtcbn1cblxuLyoqXG4gKiBUcnVlIHdoZW4gYSBzcGFuIGBzbHVnYCBzaG91bGQgYmUgc3VwcHJlc3NlZCBmb3IgYW4gYW5jaG9yIGF0IGByZXBvUmVsUGF0aGA6XG4gKiBzb21lIHJ1bGUgbWF0Y2hlcyB0aGUgcGF0aCBhbmQgbGlzdHMgYSBwcmVmaXggdGhlIHNsdWcgY2Fycmllcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzU3BhblN1cHByZXNzZWQocnVsZXM6IElnbm9yZVJ1bGVbXSwgcmVwb1JlbFBhdGg6IHN0cmluZywgc2x1Zzogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3QgcnVsZSBvZiBydWxlcykge1xuICAgIGlmICghcnVsZS5tYXRjaGVzKHJlcG9SZWxQYXRoKSkgY29udGludWU7XG4gICAgaWYgKHJ1bGUucHJlZml4ZXMuc29tZSgocCkgPT4gc2x1Z0hhc1ByZWZpeChzbHVnLCBwKSkpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqIFNpZ25hdHVyZSBmb3IgaW5qZWN0aW5nIGEgcnVsZSBsb2FkZXIgKHByb2R1Y3Rpb24gZGVmYXVsdDoge0BsaW5rIGxvYWRIb29rSWdub3JlfSkuICovXG5leHBvcnQgdHlwZSBIb29rSWdub3JlTG9hZGVyID0gKHJlcG9Sb290OiBzdHJpbmcpID0+IElnbm9yZVJ1bGVbXTtcbiIsICIvKipcbiAqIENvZGV4IFByZVRvb2xVc2UgZ2F0ZSBob29rIFx1MjAxNCBob2xkIGBnaXQgY29tbWl0YC9gZ2l0IHB1c2hgIG9uIHJlYWwgc3BhbiBkZWJ0LlxuICpcbiAqIFRoZSBDb2RleCB0d2luIG9mIFtjbGF1ZGUvZ2F0ZS50c10oLi9wYWNrYWdlcy9hZ2VudC1ob29rcy9zcmMvY2xhdWRlL2dhdGUudHMpOlxuICogc2FtZSBzaGFyZWQgZ2F0ZS1jb3JlIHBpcGVsaW5lICh7QGxpbmsgcGFyc2VHaXRDb21tYW5kfSBcdTIxOTIge0BsaW5rIHJlc29sdmVDaGFuZ2VzZXR9XG4gKiBcdTIxOTIge0BsaW5rIGV2YWx1YXRlR2F0ZX0pLCB0cmFuc2xhdGVkIGludG8gQ29kZXgncyBQcmVUb29sVXNlIG91dHB1dCBzaGFwZS4gQ29kZXhcbiAqIGRlbGl2ZXJzIGEgc2hlbGwgY29tbWFuZCBhcyBhbiBTREstdHlwZWQgYHVua25vd25gIGB0b29sX2lucHV0YDsgdGhpcyBoYW5kbGVyXG4gKiBuYXJyb3dzIGl0IChzdHJpbmcsIG9yIGEgYFtcImJhc2hcIixcIi1sY1wiLFwiPHNjcmlwdD5cIl1gL2FyZ3YgYXJyYXkpIGludG8gdGhlXG4gKiBjb21tYW5kIHN0cmluZyB0aGUgY29yZSBwYXJzZXMuXG4gKlxuICogXHUyNTAwXHUyNTAwIFVuY29uZmlybWVkIGRlbnkgKHNlZSBub3Rlcy9jb2RleC1kZW55LXNwaWtlLm1kKSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcbiAqIFdoZXRoZXIgQ29kZXgncyBgcGVybWlzc2lvbkRlY2lzaW9uOiAnZGVueSdgIGFjdHVhbGx5ICpibG9ja3MqIHRoZSBzaGVsbCB0b29sXG4gKiBsaXZlIHdhcyBuZXZlciBjb25maXJtZWQgaW4gdGhpcyByZXBvOiB0aGUgUGhhc2UgMCBzcGlrZSBjb3VsZCBub3QgZ2V0IGFcbiAqIGZyb20tc2NyYXRjaCBwbHVnaW4gdG8gbG9hZCwgc28gdGhlIGRlbnkgcGF0aCB3YXMgbmV2ZXIgZXhlcmNpc2VkIGVuZC10by1lbmQuXG4gKiBUaGUgb25seSBwb3NpdGl2ZSBldmlkZW5jZSBpcyBkb2N1bWVudGFyeSBcdTIwMTQgdGhlIGBAZ29vZGZvb3QvY29kZXgtaG9va3NgIFJFQURNRVxuICogKHRoZSBleGFjdCB2ZXJzaW9uIHRoaXMgcmVwbyBkZXBlbmRzIG9uKSBzaGlwcyBhIHdvcmtlZCBgcGVybWlzc2lvbkRlY2lzaW9uOlxuICogJ2RlbnknYCBleGFtcGxlIG1hdGNoZWQgb24gYFwiQmFzaFwiYC4gVGhpcyBhZGFwdGVyIHRoZXJlZm9yZSBzaGlwcyB0aGUgaGFyZC1kZW55XG4gKiBwYXRoIHBlciB0aGF0IFJFQURNRSAoe0BsaW5rIENPREVYX0dBVEVfSEFSRF9ERU5ZfSA9IGB0cnVlYCksIGJ1dCBrZWVwcyB0aGVcbiAqIENBUkQubWQtZG9jdW1lbnRlZCBmYWxsYmFjayBcdTIwMTQgYSBsb3VkIGBhZGRpdGlvbmFsQ29udGV4dGAgd2FybmluZyB0aGF0IGFsbG93c1xuICogdGhlIGNvbW1hbmQsIHdpdGggdGhlIENJIHJlY2lwZSBhcyBDb2RleCdzIGVuZm9yY2VtZW50IGJhY2tzdG9wIFx1MjAxNCBhcyBhIGNsZWFybHlcbiAqIHNlcGFyYWJsZSBicmFuY2ggYmVoaW5kIHRoYXQgb25lIGNvbnN0YW50LiBJZiBhIGxpdmUgc2Vzc2lvbiBzaG93cyBkZW55IGRvZXNcbiAqIG5vdCBmaXJlLCBmbGlwIHtAbGluayBDT0RFWF9HQVRFX0hBUkRfREVOWX0gdG8gYGZhbHNlYDsgbm90aGluZyBlbHNlIGNoYW5nZXMuXG4gKlxuICogVGhlIHNoZWxsIHRvb2wncyBleGFjdCBgdG9vbF9uYW1lYCBpcyBsaWtld2lzZSB1bmNvbmZpcm1lZCAodGhlIFJFQURNRSdzXG4gKiBleGFtcGxlIHVzZXMgYFwiQmFzaFwiYDsgQ29kZXggQ0xJIHRyYW5zY3JpcHRzIGluIHRoZSBzcGlrZSBsYWJlbGVkIHRoZSBjYWxsXG4gKiBgZXhlY2ApLiBUaGUgcmVnaXN0cmF0aW9uIG1hdGNoZXIgaXMgYnJvYWRlbmVkIHRvIHRoZSBwbGF1c2libGUgbmFtZXMgc28gdGhlXG4gKiBob29rIGFjdHVhbGx5IGZpcmVzLCBhbmQgZXZlcnkgZmlyZSBsb2dzIHRoZSBvYnNlcnZlZCBgdG9vbF9uYW1lYCBzbyB0aGUgZmlyc3RcbiAqIGxpdmUgcnVuIHJldmVhbHMgdGhlIGxpdGVyYWwgc3RyaW5nIHRvIG5hcnJvdyB0aGUgbWF0Y2hlciB0by5cbiAqXG4gKiBGYWlsLW9wZW4gYXQgZXZlcnkgbGF5ZXI6IGdhdGUtY29yZSByZXNvbHZlcyBpbnRlcm5hbCBlcnJvcnMgdG8gYWxsb3csIGFuZCB0aGlzXG4gKiBhZGFwdGVyIHdyYXBzIHRoZSB3aG9sZSBwYXRoIGluIGEgdHJ5L2NhdGNoIHRoYXQgYWxsb3dzLWFuZC1sb2dzIFx1MjAxNCB0aGUgZ2F0ZVxuICogbXVzdCBuZXZlciBicmljayBhIGNvbW1pdC4gVGhlIHRpbWVvdXQgaXMgbWlsbGlzZWNvbmRzIGhlcmUgKHRoZSBDb2RleCBDTElcbiAqIGRpdmlkZXMgdG8gc2Vjb25kcyBhdCBlbWl0KS5cbiAqL1xuXG5pbXBvcnQgeyB0eXBlIEhvb2tDb250ZXh0LCB0eXBlIFByZVRvb2xVc2VJbnB1dCwgcHJlVG9vbFVzZUhvb2ssIHByZVRvb2xVc2VPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY29kZXgtaG9va3MnO1xuaW1wb3J0IHtcbiAgY29tbWl0U3RhZ2VzQWxsLFxuICBjcmVhdGVEZWZhdWx0R2F0ZUV4ZWN1dG9ycyxcbiAgY3JlYXRlRGVmYXVsdEdpdEV4ZWN1dG9yLFxuICBjcmVhdGVEaXNrR2F0ZU1lbW9TdGF0ZSxcbiAgZXZhbHVhdGVHYXRlLFxuICB0eXBlIEdhdGVFeGVjdXRvcnMsXG4gIHR5cGUgR2F0ZU1lbW9TdGF0ZSxcbiAgdHlwZSBHaXRFeGVjdXRvcixcbiAgaXNHYXRlU2tpcHBlZCxcbiAgcGFyc2VHaXRDb21tYW5kLFxuICByZXNvbHZlQ2hhbmdlc2V0XG59IGZyb20gJy4uL2NvbW1vbi9nYXRlLWNvcmUuanMnO1xuXG4vKipcbiAqIFdoZXRoZXIgQ29kZXgncyBgcGVybWlzc2lvbkRlY2lzaW9uOiAnZGVueSdgIGlzIHRydXN0ZWQgdG8gYmxvY2sgdGhlIHNoZWxsIHRvb2xcbiAqIGxpdmUuIFNoaXBzIGB0cnVlYCAoaGFyZCBkZW55KSBwZXIgdGhlIGBAZ29vZGZvb3QvY29kZXgtaG9va3NgIFJFQURNRSdzIHdvcmtlZFxuICogZXhhbXBsZS4gRmxpcCB0byBgZmFsc2VgIHRvIGFjdGl2YXRlIHRoZSBDQVJELm1kLWRvY3VtZW50ZWQgZmFsbGJhY2sgaWYgYSBsaXZlXG4gKiBzZXNzaW9uIHNob3dzIGRlbnkgZG9lcyBub3QgZmlyZSBcdTIwMTQgc2VlIG5vdGVzL2NvZGV4LWRlbnktc3Bpa2UubWQgYW5kIHRoaXNcbiAqIGZpbGUncyBoZWFkZXIuIFRoaXMgaXMgdGhlIHNpbmdsZSBzd2l0Y2ggdGhhdCBzZXBhcmF0ZXMgdGhlIHR3byBjb2RlIHBhdGhzLlxuICovXG5jb25zdCBDT0RFWF9HQVRFX0hBUkRfREVOWSA9IHRydWU7XG5cbi8qKiBUaGUgYHN5c3RlbU1lc3NhZ2VgIHNob3duIHdoZW4gYSBnYXRlZCBjb21tYW5kIHJ1bnMgdW5kZXIgYEdJVF9TUEFOX0dBVEU9c2tpcGAuICovXG5jb25zdCBTS0lQX05PVElDRSA9ICdnaXQtc3BhbiBnYXRlIGJ5cGFzc2VkIChHSVRfU1BBTl9HQVRFPXNraXApIFx1MjAxNCBzcGFuIGRlYnQgaXMgbm90IGJlaW5nIGNoZWNrZWQgZm9yIHRoaXMgY29tbWFuZC4nO1xuXG4vKipcbiAqIE5hcnJvdyBDb2RleCdzIGB1bmtub3duYCBzaGVsbCBgdG9vbF9pbnB1dGAgaW50byB0aGUgY29tbWFuZCBzdHJpbmcgdGhlIGNvcmVcbiAqIHBhcnNlcy4gSGFuZGxlcyBhIGJhcmUgYGNvbW1hbmRgIHN0cmluZywgYSBzaGVsbC13cmFwcGVyIGFyZ3ZcbiAqIChgW1wiYmFzaFwiLFwiLWxjXCIsXCI8c2NyaXB0PlwiXWAgXHUyMTkyIHRoZSBzY3JpcHQgYWZ0ZXIgYC1jYC9gLWxjYCksIGFuZCBhIGRpcmVjdCBhcmd2XG4gKiAoYFtcImdpdFwiLFwiY29tbWl0XCIsXHUyMDI2XWAgXHUyMTkyIHNwYWNlLWpvaW5lZCkuIFJldHVybnMgYG51bGxgIHdoZW4gbm8gY29tbWFuZCB0ZXh0IGlzXG4gKiByZWNvdmVyYWJsZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RTaGVsbENvbW1hbmQodG9vbElucHV0OiB1bmtub3duKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICh0b29sSW5wdXQgPT09IG51bGwgfHwgdHlwZW9mIHRvb2xJbnB1dCAhPT0gJ29iamVjdCcgfHwgISgnY29tbWFuZCcgaW4gdG9vbElucHV0KSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGNvbW1hbmQgPSAodG9vbElucHV0IGFzIHsgY29tbWFuZDogdW5rbm93biB9KS5jb21tYW5kO1xuICBpZiAodHlwZW9mIGNvbW1hbmQgPT09ICdzdHJpbmcnKSByZXR1cm4gY29tbWFuZC5sZW5ndGggPiAwID8gY29tbWFuZCA6IG51bGw7XG4gIGlmIChBcnJheS5pc0FycmF5KGNvbW1hbmQpKSB7XG4gICAgY29uc3QgcGFydHMgPSBjb21tYW5kLmZpbHRlcigocCk6IHAgaXMgc3RyaW5nID0+IHR5cGVvZiBwID09PSAnc3RyaW5nJyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgZmxhZ0lkeCA9IHBhcnRzLmZpbmRJbmRleCgocCkgPT4gcCA9PT0gJy1jJyB8fCBwID09PSAnLWxjJyB8fCBwID09PSAnLWljJyk7XG4gICAgaWYgKGZsYWdJZHggPj0gMCAmJiBwYXJ0c1tmbGFnSWR4ICsgMV0gIT09IHVuZGVmaW5lZCkgcmV0dXJuIHBhcnRzW2ZsYWdJZHggKyAxXTtcbiAgICByZXR1cm4gcGFydHMuam9pbignICcpO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlSGFuZGxlcihcbiAgZ2l0OiBHaXRFeGVjdXRvciA9IGNyZWF0ZURlZmF1bHRHaXRFeGVjdXRvcigpLFxuICBleGVjdXRvcnM6IEdhdGVFeGVjdXRvcnMgPSBjcmVhdGVEZWZhdWx0R2F0ZUV4ZWN1dG9ycygpLFxuICBtZW1vRmFjdG9yeTogKGN3ZDogc3RyaW5nKSA9PiBHYXRlTWVtb1N0YXRlID0gY3JlYXRlRGlza0dhdGVNZW1vU3RhdGUsXG4gIGVudjogTm9kZUpTLlByb2Nlc3NFbnYgPSBwcm9jZXNzLmVudlxuKSB7XG4gIHJldHVybiBhc3luYyAoaW5wdXQ6IFByZVRvb2xVc2VJbnB1dCwgY3R4OiBIb29rQ29udGV4dCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICAvLyBMb2cgdGhlIG9ic2VydmVkIHNoZWxsIHRvb2xfbmFtZSBzbyB0aGUgZmlyc3QgbGl2ZSBydW4gcmV2ZWFscyB0aGUgbGl0ZXJhbFxuICAgICAgLy8gc3RyaW5nIHRvIG5hcnJvdyB0aGUgbWF0Y2hlciB0byAodGhlIHNwaWtlIG5ldmVyIGNvbmZpcm1lZCBpdCBlbXBpcmljYWxseSkuXG4gICAgICBjdHgubG9nZ2VyLmluZm8oJ2dpdC1zcGFuIGdhdGUgb2JzZXJ2ZWQgc2hlbGwgdG9vbCcsIHsgdG9vbF9uYW1lOiBpbnB1dC50b29sX25hbWUgfSk7XG5cbiAgICAgIGNvbnN0IGNvbW1hbmQgPSBleHRyYWN0U2hlbGxDb21tYW5kKGlucHV0LnRvb2xfaW5wdXQpO1xuICAgICAgaWYgKGNvbW1hbmQgPT09IG51bGwpIHJldHVybiBwcmVUb29sVXNlT3V0cHV0KHt9KTtcblxuICAgICAgY29uc3QgcGFyc2VkID0gcGFyc2VHaXRDb21tYW5kKGNvbW1hbmQpO1xuICAgICAgaWYgKHBhcnNlZC5raW5kID09PSAnbm9uZScpIHJldHVybiBwcmVUb29sVXNlT3V0cHV0KHt9KTtcblxuICAgICAgaWYgKGlzR2F0ZVNraXBwZWQoZW52KSkge1xuICAgICAgICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7IHN5c3RlbU1lc3NhZ2U6IFNLSVBfTk9USUNFIH0pO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBjd2QgPSBpbnB1dC5jd2QgPz8gJyc7XG4gICAgICBjb25zdCBhbGwgPSBwYXJzZWQua2luZCA9PT0gJ2NvbW1pdCcgPyBjb21taXRTdGFnZXNBbGwoY29tbWFuZCkgOiBmYWxzZTtcbiAgICAgIGNvbnN0IGNoYW5nZXNldCA9IGF3YWl0IHJlc29sdmVDaGFuZ2VzZXQocGFyc2VkLmtpbmQsIGFsbCwgY3dkLCBnaXQpO1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBldmFsdWF0ZUdhdGUoY2hhbmdlc2V0LCBjd2QsIGV4ZWN1dG9ycywgbWVtb0ZhY3RvcnkoY3dkKSk7XG4gICAgICBpZiAocmVzdWx0LmRlY2lzaW9uICE9PSAnZGVueScpIHJldHVybiBwcmVUb29sVXNlT3V0cHV0KHt9KTtcblxuICAgICAgaWYgKENPREVYX0dBVEVfSEFSRF9ERU5ZKSB7XG4gICAgICAgIC8vIFByaW1hcnkgcGF0aCAocGVyIHRoZSBSRUFETUUpOiBhY3R1YWxseSBibG9jayB0aGUgY29tbWFuZC5cbiAgICAgICAgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoe1xuICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvbjogJ2RlbnknLFxuICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvblJlYXNvbjogcmVzdWx0LnJlYXNvbixcbiAgICAgICAgICBzeXN0ZW1NZXNzYWdlOiByZXN1bHQucmVhc29uXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgLy8gRmFsbGJhY2sgcGF0aCAoQ0FSRC5tZCBjb250aW5nZW5jeSk6IGNhbm5vdCBibG9jaywgc28gc3VyZmFjZSB0aGUgc2FtZVxuICAgICAgLy8gY2hlY2tsaXN0IGFzIGEgbG91ZCB3YXJuaW5nIGFuZCBhbGxvdyBcdTIwMTQgdGhlIENJIHJlY2lwZSBlbmZvcmNlcyBmb3IgQ29kZXguXG4gICAgICBjb25zdCB3YXJuaW5nID0gYGdpdC1zcGFuIGdhdGUgY291bGQgbm90IGJsb2NrIHRoaXMgY29tbWFuZDsgc3BhbiBkZWJ0IHJlbWFpbnM6XFxuJHtyZXN1bHQucmVhc29ufWA7XG4gICAgICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiB3YXJuaW5nLCBzeXN0ZW1NZXNzYWdlOiB3YXJuaW5nIH0pO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY3R4LmxvZ2dlci53YXJuKCdnaXQtc3BhbiBnYXRlIGZhaWxlZCBvcGVuIG9uIGFuIHVuY2F1Z2h0IGVycm9yJywgeyBlcnIgfSk7XG4gICAgICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7fSk7XG4gICAgfVxuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBwcmVUb29sVXNlSG9vayh7IG1hdGNoZXI6ICdCYXNofHNoZWxsfGV4ZWN8bG9jYWxfc2hlbGwnLCB0aW1lb3V0OiAxMF8wMDAgfSwgY3JlYXRlSGFuZGxlcigpKTtcbiIsICJpbXBvcnQgaG9vayBmcm9tIFwiLi9nYXRlLnRzXCI7XG5pbXBvcnQgeyBleGVjdXRlIH0gZnJvbSBcIi4uLy4uLy4uLy4uL25vZGVfbW9kdWxlcy9AZ29vZGZvb3QvY29kZXgtaG9va3MvZGlzdC9ydW50aW1lLmpzXCI7XG5leGVjdXRlKGhvb2spO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQTRCTyxJQUFNLDBCQUEwQixvQkFBSSxJQUFJLENBQUMsZ0JBQWdCLG9CQUFvQixlQUFlLENBQUM7OztBQzVCcEcsU0FBUyxlQUFlLGVBQWUsUUFBUSxTQUFTO0FBQ3BELFFBQU0sT0FBTztBQUNiLE9BQUssZ0JBQWdCO0FBQ3JCLE9BQUssVUFBVSxPQUFPO0FBQ3RCLE9BQUssZ0JBQWdCLE9BQU87QUFDNUIsTUFBSSxhQUFhLFVBQVUsT0FBTyxPQUFPLFlBQVksVUFBVTtBQUMzRCxTQUFLLFVBQVUsT0FBTztBQUFBLEVBQzFCO0FBQ0EsU0FBTztBQUNYO0FBQ08sU0FBUyxlQUFlLFFBQVEsU0FBUztBQUM1QyxTQUFPLGVBQWUsY0FBYyxRQUFRLE9BQU87QUFDdkQ7OztBQ1pBLFNBQVMsV0FBVyxZQUFZLFdBQVcsVUFBVSxpQkFBaUI7QUFDdEUsU0FBUyxlQUFlO0FBQ3hCLElBQU0sc0JBQXNCO0FBQ3JCLElBQU0sU0FBTixNQUFhO0FBQUEsRUFDaEIsV0FBVyxvQkFBSSxJQUFJO0FBQUEsRUFDbkIsa0JBQWtCO0FBQUEsRUFDbEIsWUFBWTtBQUFBLEVBQ1os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WSxNQUFNLGlCQUFpQixPQUFPLE1BQU0sS0FBSyxLQUFLLEdBQUc7QUFFbkUsWUFBTSxTQUFTLE1BQU0sYUFBYSxXQUFXLEtBQUssV0FBVyxZQUFZLEdBQUcsQ0FBQztBQUM3RSxVQUFJLE9BQU8sYUFBYSxPQUFRLFFBQU8saUJBQWlCLENBQUMsQ0FBQztBQUUxRCxVQUFJLHNCQUFzQjtBQUV4QixlQUFPLGlCQUFpQjtBQUFBLFVBQ3RCLG9CQUFvQjtBQUFBLFVBQ3BCLDBCQUEwQixPQUFPO0FBQUEsVUFDakMsZUFBZSxPQUFPO0FBQUEsUUFDeEIsQ0FBQztBQUFBLE1BQ0g7QUFHQSxZQUFNLFVBQVU7QUFBQSxFQUFtRSxPQUFPLE1BQU07QUFDaEcsYUFBTyxpQkFBaUIsRUFBRSxtQkFBbUIsU0FBUyxlQUFlLFFBQVEsQ0FBQztBQUFBLElBQ2hGLFNBQVMsS0FBSztBQUNaLFVBQUksT0FBTyxLQUFLLGtEQUFrRCxFQUFFLElBQUksQ0FBQztBQUN6RSxhQUFPLGlCQUFpQixDQUFDLENBQUM7QUFBQSxJQUM1QjtBQUFBLEVBQ0Y7QUFDRjtBQUVBLElBQU8sZUFBUSxlQUFlLEVBQUUsU0FBUywrQkFBK0IsU0FBUyxJQUFPLEdBQUcsY0FBYyxDQUFDOzs7QUNqSTFHLFFBQVEsWUFBSTsiLAogICJuYW1lcyI6IFsicmVzb2x2ZSIsICJleGVjRmlsZVN5bmMiLCAiZnMiLCAibm9kZVBhdGgiLCAiZnMiLCAibm9kZVBhdGgiLCAiZnMiLCAibm9kZVBhdGgiLCAiY2FuZGlkYXRlcyIsICJleGVjRmlsZVN5bmMiXQp9Cg==

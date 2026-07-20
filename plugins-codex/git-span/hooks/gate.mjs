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
import * as fs2 from "node:fs";
import * as nodePath2 from "node:path";

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
    const uncovered = paths.filter((path) => !covered.has(path) && !isInsideSpanRoot(path));
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
        return fs2.existsSync(nodePath2.join(dir, digest));
      } catch {
        return false;
      }
    },
    record: (digest) => {
      try {
        fs2.mkdirSync(dir, { recursive: true });
        fs2.writeFileSync(nodePath2.join(dir, digest), "");
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2NvbnN0YW50cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2dhdGUtY29yZS50cyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29kZXgvZ2F0ZS50cyIsICJzcmMvY29kZXgvZ2F0ZS1lbnRyeS50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiZXhwb3J0IGNvbnN0IFBBQ0tBR0VfTkFNRSA9IFwiQGdvb2Rmb290L2NvZGV4LWhvb2tzXCI7XG5leHBvcnQgY29uc3QgREVGQVVMVF9USU1FT1VUX01TID0gNjAwXzAwMDtcbmV4cG9ydCBjb25zdCBERUZBVUxUX1NUQVRVU19NRVNTQUdFID0gdW5kZWZpbmVkO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfRVNCVUlMRF9MT0FERVJTID0ge1xuICAgIFwiLm1kXCI6IFwidGV4dFwiLFxufTtcbmV4cG9ydCBjb25zdCBIT09LX0ZBQ1RPUllfVE9fRVZFTlQgPSB7XG4gICAgcHJlVG9vbFVzZUhvb2s6IFwiUHJlVG9vbFVzZVwiLFxuICAgIHBvc3RUb29sVXNlSG9vazogXCJQb3N0VG9vbFVzZVwiLFxuICAgIHBlcm1pc3Npb25SZXF1ZXN0SG9vazogXCJQZXJtaXNzaW9uUmVxdWVzdFwiLFxuICAgIHVzZXJQcm9tcHRTdWJtaXRIb29rOiBcIlVzZXJQcm9tcHRTdWJtaXRcIixcbiAgICBzZXNzaW9uU3RhcnRIb29rOiBcIlNlc3Npb25TdGFydFwiLFxuICAgIHN1YmFnZW50U3RhcnRIb29rOiBcIlN1YmFnZW50U3RhcnRcIixcbiAgICBzdG9wSG9vazogXCJTdG9wXCIsXG4gICAgc3ViYWdlbnRTdG9wSG9vazogXCJTdWJhZ2VudFN0b3BcIixcbiAgICBwcmVDb21wYWN0SG9vazogXCJQcmVDb21wYWN0XCIsXG4gICAgcG9zdENvbXBhY3RIb29rOiBcIlBvc3RDb21wYWN0XCIsXG59O1xuZXhwb3J0IGNvbnN0IEVWRU5UU19XSVRIX01BVENIRVIgPSBuZXcgU2V0KFtcbiAgICBcIlByZVRvb2xVc2VcIixcbiAgICBcIlBvc3RUb29sVXNlXCIsXG4gICAgXCJQZXJtaXNzaW9uUmVxdWVzdFwiLFxuICAgIFwiU2Vzc2lvblN0YXJ0XCIsXG4gICAgXCJTdWJhZ2VudFN0YXJ0XCIsXG4gICAgXCJTdWJhZ2VudFN0b3BcIixcbiAgICBcIlByZUNvbXBhY3RcIixcbiAgICBcIlBvc3RDb21wYWN0XCIsXG5dKTtcbmV4cG9ydCBjb25zdCBFVkVOVFNfV0lUSF9URVhUX09VVFBVVCA9IG5ldyBTZXQoW1wiU2Vzc2lvblN0YXJ0XCIsIFwiVXNlclByb21wdFN1Ym1pdFwiLCBcIlN1YmFnZW50U3RhcnRcIl0pO1xuIiwgImZ1bmN0aW9uIGF0dGFjaE1ldGFkYXRhKGhvb2tFdmVudE5hbWUsIGNvbmZpZywgaGFuZGxlcikge1xuICAgIGNvbnN0IGhvb2sgPSBoYW5kbGVyO1xuICAgIGhvb2suaG9va0V2ZW50TmFtZSA9IGhvb2tFdmVudE5hbWU7XG4gICAgaG9vay50aW1lb3V0ID0gY29uZmlnLnRpbWVvdXQ7XG4gICAgaG9vay5zdGF0dXNNZXNzYWdlID0gY29uZmlnLnN0YXR1c01lc3NhZ2U7XG4gICAgaWYgKFwibWF0Y2hlclwiIGluIGNvbmZpZyAmJiB0eXBlb2YgY29uZmlnLm1hdGNoZXIgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgaG9vay5tYXRjaGVyID0gY29uZmlnLm1hdGNoZXI7XG4gICAgfVxuICAgIHJldHVybiBob29rO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZVRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlByZVRvb2xVc2VcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbFVzZUhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUG9zdFRvb2xVc2VcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uUmVxdWVzdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUGVybWlzc2lvblJlcXVlc3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiB1c2VyUHJvbXB0U3VibWl0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJVc2VyUHJvbXB0U3VibWl0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJTZXNzaW9uU3RhcnRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0YXJ0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJTdWJhZ2VudFN0YXJ0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc3RvcEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN1YmFnZW50U3RvcEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3ViYWdlbnRTdG9wXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlQ29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUHJlQ29tcGFjdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBvc3RDb21wYWN0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQb3N0Q29tcGFjdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuIiwgImltcG9ydCB7IGNsb3NlU3luYywgZXhpc3RzU3luYywgbWtkaXJTeW5jLCBvcGVuU3luYywgd3JpdGVTeW5jIH0gZnJvbSBcIm5vZGU6ZnNcIjtcbmltcG9ydCB7IGRpcm5hbWUgfSBmcm9tIFwibm9kZTpwYXRoXCI7XG5jb25zdCBERUZBVUxUX0xPR19FTlZfVkFSID0gXCJDT0RFWF9IT09LU19MT0dfRklMRVwiO1xuZXhwb3J0IGNsYXNzIExvZ2dlciB7XG4gICAgaGFuZGxlcnMgPSBuZXcgTWFwKCk7XG4gICAgZmlsZUluaXRpYWxpemVkID0gZmFsc2U7XG4gICAgbG9nRmlsZUZkID0gbnVsbDtcbiAgICBsb2dGaWxlUGF0aCA9IG51bGw7XG4gICAgY3VycmVudEhvb2tUeXBlO1xuICAgIGN1cnJlbnRJbnB1dDtcbiAgICBjb25zdHJ1Y3Rvcihjb25maWcgPSB7fSkge1xuICAgICAgICB0aGlzLmxvZ0ZpbGVQYXRoID0gY29uZmlnLmxvZ0ZpbGVQYXRoID8/IHByb2Nlc3MuZW52W2NvbmZpZy5sb2dFbnZWYXIgPz8gREVGQVVMVF9MT0dfRU5WX1ZBUl0gPz8gbnVsbDtcbiAgICB9XG4gICAgc2V0Q29udGV4dChob29rVHlwZSwgaW5wdXQpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50SG9va1R5cGUgPSBob29rVHlwZTtcbiAgICAgICAgdGhpcy5jdXJyZW50SW5wdXQgPSBpbnB1dDtcbiAgICB9XG4gICAgY2xlYXJDb250ZXh0KCkge1xuICAgICAgICB0aGlzLmN1cnJlbnRIb29rVHlwZSA9IHVuZGVmaW5lZDtcbiAgICAgICAgdGhpcy5jdXJyZW50SW5wdXQgPSB1bmRlZmluZWQ7XG4gICAgfVxuICAgIG9uKGxldmVsLCBoYW5kbGVyKSB7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5oYW5kbGVycy5nZXQobGV2ZWwpID8/IG5ldyBTZXQoKTtcbiAgICAgICAgZXhpc3RpbmcuYWRkKGhhbmRsZXIpO1xuICAgICAgICB0aGlzLmhhbmRsZXJzLnNldChsZXZlbCwgZXhpc3RpbmcpO1xuICAgICAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgICAgICAgZXhpc3RpbmcuZGVsZXRlKGhhbmRsZXIpO1xuICAgICAgICAgICAgaWYgKGV4aXN0aW5nLnNpemUgPT09IDApIHtcbiAgICAgICAgICAgICAgICB0aGlzLmhhbmRsZXJzLmRlbGV0ZShsZXZlbCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgfVxuICAgIGRlYnVnKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZGVidWdcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGluZm8obWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJpbmZvXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICB3YXJuKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwid2FyblwiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgZXJyb3IobWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJlcnJvclwiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgbG9nRXJyb3IoZXJyb3IsIG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZXJyb3JcIiwgYCR7bWVzc2FnZX06ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsIGNvbnRleHQpO1xuICAgIH1cbiAgICBjbG9zZSgpIHtcbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZUZkICE9PSBudWxsKSB7XG4gICAgICAgICAgICBjbG9zZVN5bmModGhpcy5sb2dGaWxlRmQpO1xuICAgICAgICAgICAgdGhpcy5sb2dGaWxlRmQgPSBudWxsO1xuICAgICAgICB9XG4gICAgfVxuICAgIGVtaXQobGV2ZWwsIG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgY29uc3QgZXZlbnQgPSB7XG4gICAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICAgIGxldmVsLFxuICAgICAgICAgICAgaG9va1R5cGU6IHRoaXMuY3VycmVudEhvb2tUeXBlLFxuICAgICAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgICAgIC4uLih0aGlzLmN1cnJlbnRJbnB1dCAhPT0gdW5kZWZpbmVkID8geyBpbnB1dDogdGhpcy5jdXJyZW50SW5wdXQgfSA6IHt9KSxcbiAgICAgICAgICAgIC4uLihjb250ZXh0ICE9PSB1bmRlZmluZWQgPyB7IGNvbnRleHQgfSA6IHt9KSxcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy53cml0ZVRvRmlsZShldmVudCk7XG4gICAgICAgIHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKT8uZm9yRWFjaCgoaGFuZGxlcikgPT4ge1xuICAgICAgICAgICAgaGFuZGxlcihldmVudCk7XG4gICAgICAgIH0pO1xuICAgIH1cbiAgICB3cml0ZVRvRmlsZShldmVudCkge1xuICAgICAgICBpZiAodGhpcy5sb2dGaWxlUGF0aCA9PT0gbnVsbCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICghdGhpcy5maWxlSW5pdGlhbGl6ZWQpIHtcbiAgICAgICAgICAgIHRoaXMuZmlsZUluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICAgICAgICAgIGNvbnN0IGxvZ0RpciA9IGRpcm5hbWUodGhpcy5sb2dGaWxlUGF0aCk7XG4gICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmMobG9nRGlyKSkge1xuICAgICAgICAgICAgICAgIG1rZGlyU3luYyhsb2dEaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5sb2dGaWxlRmQgPSBvcGVuU3luYyh0aGlzLmxvZ0ZpbGVQYXRoLCBcImFcIik7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZUZkICE9PSBudWxsKSB7XG4gICAgICAgICAgICB3cml0ZVN5bmModGhpcy5sb2dGaWxlRmQsIGAke0pTT04uc3RyaW5naWZ5KGV2ZW50KX1cXG5gKTtcbiAgICAgICAgfVxuICAgIH1cbn1cbmV4cG9ydCBjb25zdCBsb2dnZXIgPSBuZXcgTG9nZ2VyKCk7XG4iLCAiZXhwb3J0IGNvbnN0IEVYSVRfQ09ERVMgPSB7XG4gICAgU1VDQ0VTUzogMCxcbiAgICBFUlJPUjogMSxcbiAgICBCTE9DSzogMixcbn07XG5leHBvcnQgY2xhc3MgQmxvY2tFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgICByZWFzb247XG4gICAgY29uc3RydWN0b3IocmVhc29uKSB7XG4gICAgICAgIHN1cGVyKHJlYXNvbik7XG4gICAgICAgIHRoaXMubmFtZSA9IFwiQmxvY2tFcnJvclwiO1xuICAgICAgICB0aGlzLnJlYXNvbiA9IHJlYXNvbjtcbiAgICB9XG59XG5mdW5jdGlvbiBvbWl0VW5kZWZpbmVkKHZhbHVlKSB7XG4gICAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhPYmplY3QuZW50cmllcyh2YWx1ZSkuZmlsdGVyKChbLCBlbnRyeV0pID0+IGVudHJ5ICE9PSB1bmRlZmluZWQpKTtcbn1cbmZ1bmN0aW9uIGJ1aWxkT3V0cHV0KHR5cGUsIHN0ZG91dCwgc3RkZXJyKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgX3R5cGU6IHR5cGUsXG4gICAgICAgIHN0ZG91dDogb21pdFVuZGVmaW5lZChzdGRvdXQpLFxuICAgICAgICAuLi4oc3RkZXJyICE9PSB1bmRlZmluZWQgPyB7IHN0ZGVyciB9IDoge30pLFxuICAgIH07XG59XG5leHBvcnQgZnVuY3Rpb24gcmF3T3V0cHV0KHN0ZG91dCwgc3RkZXJyKSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUmF3XCIsIHN0ZG91dCwgc3RkZXJyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhhc1NwZWNpZmljID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb25SZWFzb24gIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnVwZGF0ZWRJbnB1dCAhPT0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IGhhc1NwZWNpZmljXG4gICAgICAgID8gb21pdFVuZGVmaW5lZCh7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlByZVRvb2xVc2VcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICAgICAgcGVybWlzc2lvbkRlY2lzaW9uOiBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvbixcbiAgICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvblJlYXNvbjogb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb25SZWFzb24sXG4gICAgICAgICAgICB1cGRhdGVkSW5wdXQ6IG9wdGlvbnMudXBkYXRlZElucHV0LFxuICAgICAgICB9KVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVUb29sVXNlXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlTGVnYWN5QmxvY2tPdXRwdXQob3B0aW9ucykge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlByZVRvb2xVc2VcIiwge1xuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBvc3RUb29sVXNlT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhhc1NwZWNpZmljID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkIHx8IG9wdGlvbnMudXBkYXRlZE1DUFRvb2xPdXRwdXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBoYXNTcGVjaWZpY1xuICAgICAgICA/IG9taXRVbmRlZmluZWQoe1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQb3N0VG9vbFVzZVwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgICAgICB1cGRhdGVkTUNQVG9vbE91dHB1dDogb3B0aW9ucy51cGRhdGVkTUNQVG9vbE91dHB1dCxcbiAgICAgICAgfSlcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUG9zdFRvb2xVc2VcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBlcm1pc3Npb25SZXF1ZXN0T3V0cHV0KG9wdGlvbnMpIHtcbiAgICBjb25zdCBkZWNpc2lvbiA9IG9taXRVbmRlZmluZWQoe1xuICAgICAgICBiZWhhdmlvcjogb3B0aW9ucy5iZWhhdmlvcixcbiAgICAgICAgbWVzc2FnZTogb3B0aW9ucy5tZXNzYWdlLFxuICAgICAgICBpbnRlcnJ1cHQ6IG9wdGlvbnMuaW50ZXJydXB0LFxuICAgICAgICB1cGRhdGVkSW5wdXQ6IG9wdGlvbnMudXBkYXRlZElucHV0LFxuICAgICAgICB1cGRhdGVkUGVybWlzc2lvbnM6IG9wdGlvbnMudXBkYXRlZFBlcm1pc3Npb25zLFxuICAgIH0pO1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IHtcbiAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQZXJtaXNzaW9uUmVxdWVzdFwiLFxuICAgICAgICBkZWNpc2lvbixcbiAgICB9O1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0LFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHVzZXJQcm9tcHRTdWJtaXRPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8ge1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJVc2VyUHJvbXB0U3VibWl0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJVc2VyUHJvbXB0U3VibWl0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uU3RhcnRPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8ge1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJTZXNzaW9uU3RhcnRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlNlc3Npb25TdGFydFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0YXJ0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiU3ViYWdlbnRTdGFydFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiU3ViYWdlbnRTdGFydFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdG9wT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN0b3BcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0b3BPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiU3ViYWdlbnRTdG9wXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlQ29tcGFjdE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVDb21wYWN0XCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQb3N0Q29tcGFjdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgfSk7XG59XG4iLCAiaW1wb3J0IHsgRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQgfSBmcm9tIFwiLi9jb25zdGFudHMuanNcIjtcbmltcG9ydCB7IGxvZ2dlciB9IGZyb20gXCIuL2xvZ2dlci5qc1wiO1xuaW1wb3J0IHsgQmxvY2tFcnJvciwgRVhJVF9DT0RFUywgc2Vzc2lvblN0YXJ0T3V0cHV0LCBzdWJhZ2VudFN0YXJ0T3V0cHV0LCB1c2VyUHJvbXB0U3VibWl0T3V0cHV0LCB9IGZyb20gXCIuL291dHB1dHMuanNcIjtcbmFzeW5jIGZ1bmN0aW9uIHJlYWRTdGRpbigpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBjb25zdCBjaHVua3MgPSBbXTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5zZXRFbmNvZGluZyhcInV0Zi04XCIpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZGF0YVwiLCAoY2h1bmspID0+IGNodW5rcy5wdXNoKGNodW5rKSk7XG4gICAgICAgIHByb2Nlc3Muc3RkaW4ub24oXCJlbmRcIiwgKCkgPT4gcmVzb2x2ZShjaHVua3Muam9pbihcIlwiKSkpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZXJyb3JcIiwgcmVqZWN0KTtcbiAgICB9KTtcbn1cbmZ1bmN0aW9uIHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpIHtcbiAgICByZXR1cm4gSlNPTi5wYXJzZShzdGRpbkNvbnRlbnQpO1xufVxuZnVuY3Rpb24gd3JpdGVTdGRvdXQob3V0cHV0KSB7XG4gICAgcHJvY2Vzcy5zdGRvdXQud3JpdGUoSlNPTi5zdHJpbmdpZnkob3V0cHV0LnN0ZG91dCkpO1xufVxuZnVuY3Rpb24gbm9ybWFsaXplU3RyaW5nT3V0cHV0KGhvb2tFdmVudE5hbWUsIHJlc3VsdCkge1xuICAgIGlmICghRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQuaGFzKGhvb2tFdmVudE5hbWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtob29rRXZlbnROYW1lfSBob29rcyBjYW5ub3QgcmV0dXJuIHBsYWluIHRleHRgKTtcbiAgICB9XG4gICAgaWYgKGhvb2tFdmVudE5hbWUgPT09IFwiU2Vzc2lvblN0YXJ0XCIpIHtcbiAgICAgICAgcmV0dXJuIHNlc3Npb25TdGFydE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG4gICAgfVxuICAgIGlmIChob29rRXZlbnROYW1lID09PSBcIlN1YmFnZW50U3RhcnRcIikge1xuICAgICAgICByZXR1cm4gc3ViYWdlbnRTdGFydE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG4gICAgfVxuICAgIHJldHVybiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IHJlc3VsdCB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBjb252ZXJ0VG9Ib29rT3V0cHV0KG91dHB1dCkge1xuICAgIHJldHVybiBvdXRwdXQuc3RkZXJyICE9PSB1bmRlZmluZWQgPyB7IHN0ZG91dDogb3V0cHV0LnN0ZG91dCwgc3RkZXJyOiBvdXRwdXQuc3RkZXJyIH0gOiB7IHN0ZG91dDogb3V0cHV0LnN0ZG91dCB9O1xufVxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGV4ZWN1dGUoaG9va0ZuKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgc3RkaW5Db250ZW50ID0gYXdhaXQgcmVhZFN0ZGluKCk7XG4gICAgICAgIGNvbnN0IGlucHV0ID0gcGFyc2VTdGRpbklucHV0KHN0ZGluQ29udGVudCk7XG4gICAgICAgIGxvZ2dlci5zZXRDb250ZXh0KGhvb2tGbi5ob29rRXZlbnROYW1lLCBpbnB1dCk7XG4gICAgICAgIGNvbnN0IGNvbnRleHQgPSB7IGxvZ2dlciB9O1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBob29rRm4oaW5wdXQsIGNvbnRleHQpO1xuICAgICAgICBsZXQgb3V0cHV0ID0geyBzdGRvdXQ6IHt9IH07XG4gICAgICAgIGlmICh0eXBlb2YgcmVzdWx0ID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgICBvdXRwdXQgPSBjb252ZXJ0VG9Ib29rT3V0cHV0KG5vcm1hbGl6ZVN0cmluZ091dHB1dChob29rRm4uaG9va0V2ZW50TmFtZSwgcmVzdWx0KSk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAocmVzdWx0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIG91dHB1dCA9IGNvbnZlcnRUb0hvb2tPdXRwdXQocmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgICB3cml0ZVN0ZG91dChvdXRwdXQpO1xuICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5TVUNDRVNTKTtcbiAgICB9XG4gICAgY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEJsb2NrRXJyb3IpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke2Vycm9yLnJlYXNvbn1cXG5gKTtcbiAgICAgICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLkJMT0NLKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYCR7ZXJyb3Iuc3RhY2sgPz8gZXJyb3IubWVzc2FnZX1cXG5gKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke1N0cmluZyhlcnJvcil9XFxuYCk7XG4gICAgICAgIH1cbiAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuRVJST1IpO1xuICAgIH1cbiAgICBmaW5hbGx5IHtcbiAgICAgICAgbG9nZ2VyLmNsZWFyQ29udGV4dCgpO1xuICAgICAgICBsb2dnZXIuY2xvc2UoKTtcbiAgICB9XG59XG4iLCAiLyoqXG4gKiBIYXJuZXNzLWFnbm9zdGljIGdhdGUgY29yZSAoUGhhc2UgMy4xIFx1MjAxNCBjb250cmFjdCBhbmQgc3R1YnMpLlxuICpcbiAqIFRoaXMgbW9kdWxlIGRlY2xhcmVzIHRoZSBQcmVUb29sVXNlIFwiZ2F0ZVwiIHRoYXQgYm90aCB0aGUgQ2xhdWRlIChgQmFzaGApIGFuZFxuICogQ29kZXggKHNoZWxsL2V4ZWMpIGFkYXB0ZXJzIHdpbGwgZHJpdmU6IHdoZW4gdGhlIGFnZW50IHJ1bnMgYGdpdCBjb21taXRgIG9yXG4gKiBgZ2l0IHB1c2hgIGFuZCB0aGUgY2hhbmdlc2V0IGl0IGlzIGFib3V0IHRvIGxhbmQgY2FycmllcyByZWFsIHNwYW4gZGVidCwgdGhlXG4gKiBjb21tYW5kIGlzIGhlbGQgd2l0aCBhIGNoZWNrbGlzdDsgcG9zaXRpb25hbCBkcmlmdCB0aGUgdG91Y2ggaG9vayBoYXMgYmVlblxuICogaGVhbGluZyBhbGwgYWxvbmcgbmV2ZXIgYmxvY2tzLiBMaWtlIHtAbGluayBmaWxlOi8vLi90b3VjaC1jb3JlLnRzfSBpdCBpbXBvcnRzXG4gKiBub3RoaW5nIGZyb20gZWl0aGVyIGhvb2sgU0RLIGFuZCBpcyB0eXBlZCBzdHJ1Y3R1cmFsbHksIHBlciB0aGUgYGNvbW1vbi9gXG4gKiBsYXllciBjb252ZW50aW9uOiBhZGFwdGVycyB0cmFuc2xhdGUgdGhlaXIgU0RLLXNwZWNpZmljIGhvb2sgaW5wdXQgaW50byBhXG4gKiBjb21tYW5kIHN0cmluZyArIGN3ZCwgaW5qZWN0IGV4ZWN1dGlvbi9zdGF0ZSBkZXBlbmRlbmNpZXMsIGFuZCB0cmFuc2xhdGUgdGhlXG4gKiByZXR1cm5lZCB7QGxpbmsgR2F0ZVJlc3VsdH0gaW50byB0aGVpciBvd24gZGVueS9hbGxvdyBvdXRwdXQgYnVpbGRlci5cbiAqXG4gKiBnYXRlLWNvcmUgaXMgYSBzaWJsaW5nIG9mIHRvdWNoLWNvcmUsIG5vdCBhIGRlcGVuZGVudDogdGhlIHR3byBjb3JlcyBhcmVcbiAqIGluZGVwZW5kZW50IGFuZCB0aGlzIG1vZHVsZSBpbXBvcnRzIG5vdGhpbmcgZnJvbSBgdG91Y2gtY29yZS50c2AuXG4gKlxuICogUmV1c2VkIGZyb20gdGhlIHNoYXJlZCBrZXJuZWwgKG5vdCByZWRlZmluZWQpOiBgaXNEZWJ0KClgICh0aGUgc2luZ2xlXG4gKiBzb3VyY2Ugb2YgdHJ1dGggZm9yIHRoZSBzZW1hbnRpYy1vbmx5IGRlYnQgaW52YXJpYW50IFx1MjAxNCBgTU9WRURgIGFuZFxuICogYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCBhcmUgbmV2ZXIgZGVidCksIHRoZSBwb3JjZWxhaW4gc3RhdHVzIHZvY2FidWxhcnlcbiAqIChgUG9yY2VsYWluU3RhdHVzYC9gUG9yY2VsYWluUm93YC9gU3RhbGVQb3JjZWxhaW5Sb3dgKSwgYW5kIGBnYXRlTWVtb0RpcigpYFxuICogKHRoZSBgPGdpdC1jb21tb24tZGlyPi9naXQtc3Bhbi9nYXRlL2AgcGF0aCB0aGUgZGlzay1iYWNrZWRcbiAqIHtAbGluayBHYXRlTWVtb1N0YXRlfSB3aWxsIHBlcnNpc3QgdW5kZXIpIFx1MjAxNCBhbGwgZnJvbSBhZ2VudC1ob29rcy1jb21tb24udHMuXG4gKlxuICogRXZlcnkgZnVuY3Rpb24gd2hvc2UgcmVzdWx0IGRlcGVuZHMgb24gcmVhbCBsb2dpYyBpcyBhIGBOb3QgSW1wbGVtZW50ZWRgIHN0dWJcbiAqIGluIHRoaXMgcGhhc2U7IFBoYXNlIDMuMiB3cml0ZXMgc2tpcHBlZCBjaGVja3MgYWdhaW5zdCB0aGVzZSBzaWduYXR1cmVzIGFuZFxuICogUGhhc2UgMy4zIGltcGxlbWVudHMgdGhlbS4gVGhlIG9uZSBleGNlcHRpb24gaXMge0BsaW5rIGlzR2F0ZVNraXBwZWR9LCB3aGljaFxuICogaXMgcHVyZSBhbmQgZnVsbHkgc3BlY2lmaWVkIGJ5IENBUkQubWQsIHNvIGl0IGlzIGltcGxlbWVudGVkIGhlcmUgKHNlZSBpdHNcbiAqIGRvYyBjb21tZW50IGZvciB0aGUgcmF0aW9uYWxlKS5cbiAqL1xuXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHsgY3JlYXRlSGFzaCB9IGZyb20gJ25vZGU6Y3J5cHRvJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7XG4gIGdhdGVNZW1vRGlyLFxuICBpc0RlYnQsXG4gIGlzSW5zaWRlU3BhblJvb3QsXG4gIHR5cGUgUG9yY2VsYWluUm93LFxuICBwYXJzZVBvcmNlbGFpbixcbiAgcGFyc2VTdGFsZVBvcmNlbGFpbixcbiAgcmVzb2x2ZVJlcG9Sb290LFxuICB0eXBlIFN0YWxlUG9yY2VsYWluUm93LFxuICB0b1Bvc2l4XG59IGZyb20gJy4vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBDb21tYW5kIHBhcnNpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFRoZSBraW5kIG9mIGdhdGVkIGdpdCBjb21tYW5kIGEgc2hlbGwgY29tbWFuZCBzdHJpbmcgcmVzb2x2ZXMgdG8uIGAnbm9uZSdgXG4gKiBpcyB0aGUgY29uc2VydmF0aXZlIGZhaWwtb3BlbiBhbnN3ZXI6IGFueSBzaGFwZSB7QGxpbmsgcGFyc2VHaXRDb21tYW5kfSBkb2VzXG4gKiBub3QgY29uZmlkZW50bHkgcmVjb2duaXplIGFzIGEgYGdpdCBjb21taXRgL2BnaXQgcHVzaGAgbWFwcyB0byBgJ25vbmUnYCBhbmRcbiAqIHRoZSBnYXRlIGFsbG93cyB0aGUgY29tbWFuZCB0aHJvdWdoIHVudG91Y2hlZC5cbiAqL1xuZXhwb3J0IHR5cGUgR2l0Q29tbWFuZEtpbmQgPSAnY29tbWl0JyB8ICdwdXNoJyB8ICdub25lJztcblxuLyoqXG4gKiBUaGUgcmVzdWx0IG9mIHBhcnNpbmcgYSBzaGVsbCBjb21tYW5kIHN0cmluZyBmb3IgYSBnYXRlZCBnaXQgaW52b2NhdGlvbi5cbiAqXG4gKiBgcGF0aHNgIGNhcnJpZXMgb25seSB3aGF0IGlzIHBhcnNlYWJsZSBmcm9tIHRoZSBjb21tYW5kIGxpbmUgaXRzZWxmIFx1MjAxNCB0aGVcbiAqIGV4cGxpY2l0IHBhdGhzcGVjcyBhIGBnaXQgY29tbWl0IC0tIDxwYXRoPlx1MjAyNmAgZm9ybSBuYW1lcy4gSXQgaXMgZGVsaWJlcmF0ZWx5XG4gKiAqbm90KiB0aGUgY2hhbmdlc2V0OiB0aGUgZnVsbGVyIHJlc29sdXRpb24gKHN0YWdlZCBmaWxlcywgdGhlIGAtYWAvYC1hbWBcbiAqIGV4cGFuc2lvbiBhZ2FpbnN0IHRyYWNrZWQtbW9kaWZpZWQgZmlsZXMsIHRoZSBvdXRnb2luZyBwdXNoIHJhbmdlKSBpc1xuICoge0BsaW5rIHJlc29sdmVDaGFuZ2VzZXR9J3Mgam9iLCBkcml2ZW4gZnJvbSB0aGUgcmVwbyBzdGF0ZSwgbm90IGZyb20gdGhlXG4gKiBjb21tYW5kIHRleHQuIGBwYXRoc2AgaXMgb21pdHRlZCB3aGVuIHRoZSBjb21tYW5kIG5hbWVzIG5vIGV4cGxpY2l0XG4gKiBwYXRoc3BlYy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBQYXJzZWRHaXRDb21tYW5kIHtcbiAga2luZDogR2l0Q29tbWFuZEtpbmQ7XG4gIHBhdGhzPzogc3RyaW5nW107XG59XG5cbi8qKlxuICogV29yZC1ib3VuZGFyeSBwYXJzZSBvZiBhIGBnaXQgY29tbWl0YCAvIGBnaXQgcHVzaGAgaW52b2NhdGlvbiBlbWJlZGRlZCBpbiBhblxuICogYXJiaXRyYXJ5IHNoZWxsIGNvbW1hbmQgc3RyaW5nLlxuICpcbiAqIE11c3QgcmVjb2duaXplIHRoZSByZWFsIHNoYXBlcyBjb21taXRzIGFuZCBwdXNoZXMgYXJyaXZlIGluOiBjaGFpbmVkXG4gKiBjb21tYW5kcyAoYFx1MjAyNiAmJiBnaXQgY29tbWl0IFx1MjAyNmAsIGBcdTIwMjY7IGdpdCBwdXNoYCwgYFx1MjAyNiB8IFx1MjAyNmApLCBhbiBleHBsaWNpdCByZXBvIHZpYVxuICogYGdpdCAtQyA8ZGlyPiBjb21taXQgXHUyMDI2YCwgdHJhaWxpbmcgcGF0aHNwZWNzIGFmdGVyIGAtLWAsIHRoZSBgLWFgL2AtYW1gXG4gKiBcImNvbW1pdCBhbGwgdHJhY2tlZC1tb2RpZmllZFwiIGZvcm1zLCBhbmQgaW52b2NhdGlvbiBmcm9tIGEgY3dkIGJlbG93IHRoZSByZXBvXG4gKiByb290LiBNYXRjaGluZyBpcyBvbiB3b3JkIGJvdW5kYXJpZXMsIG5ldmVyIHN1YnN0cmluZzogYSBwYXRoIG9yIG1lc3NhZ2UgdGhhdFxuICogbWVyZWx5IGNvbnRhaW5zIHRoZSB0ZXh0IGBnaXQgY29tbWl0YCBtdXN0IG5vdCB0cmlwIHRoZSBnYXRlLlxuICpcbiAqIENvbnNlcnZhdGl2ZSBieSBjb250cmFjdDogdGhpcyBpcyB0aGUgZmFpbC1vcGVuIHBvaW50IGF0IHRoZSBwYXJzZSBsYXllciwgbm90XG4gKiBhIHBsYWNlIHRvIGd1ZXNzLiBBbnkgY29tbWFuZCB3aG9zZSBzaGFwZSBpcyBub3QgY29uZmlkZW50bHkgYSBnYXRlZFxuICogYGdpdCBjb21taXRgL2BnaXQgcHVzaGAgXHUyMDE0IGFuIHVuZmFtaWxpYXIgc3ViY29tbWFuZCwgYW4gYWxpYXMsIGFuIG9iZnVzY2F0ZWRcbiAqIG9yIGR5bmFtaWNhbGx5LWJ1aWx0IGludm9jYXRpb24gXHUyMDE0IHJldHVybnMgYHsga2luZDogJ25vbmUnIH1gIHNvIHRoZSBnYXRlXG4gKiBhbGxvd3MgaXQgcmF0aGVyIHRoYW4gZGVueWluZyBvbiBhIHNoYWt5IHJlYWQuIChTZWUgQ0FSRC5tZCBcIlJpc2tzIGFuZFxuICogcmVxdWlyZWQgc3Bpa2VzIFx1MjE5MiBDb21tYW5kIHBhcnNpbmdcIiBhbmQgZGVzaWduLWRlY2lzaW9ucy5tZCAjMS4pXG4gKlxuICogQHBhcmFtIGNvbW1hbmQgVGhlIHJhdyBzaGVsbCBjb21tYW5kIHN0cmluZyBmcm9tIHRoZSBob29rJ3MgdG9vbCBpbnB1dC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlR2l0Q29tbWFuZChjb21tYW5kOiBzdHJpbmcpOiBQYXJzZWRHaXRDb21tYW5kIHtcbiAgZm9yIChjb25zdCBzZWdtZW50IG9mIHNwbGl0U2VnbWVudHMoY29tbWFuZCkpIHtcbiAgICBjb25zdCBpbnYgPSBtYXRjaEdpdEludm9jYXRpb24odG9rZW5pemUoc2VnbWVudCkpO1xuICAgIGlmICghaW52KSBjb250aW51ZTtcbiAgICBpZiAoaW52LnN1YmNvbW1hbmQgPT09ICdjb21taXQnKSB7XG4gICAgICBjb25zdCBkYXNoRGFzaCA9IGludi5hcmdzLmluZGV4T2YoJy0tJyk7XG4gICAgICBjb25zdCBwYXRocyA9IGRhc2hEYXNoID49IDAgPyBpbnYuYXJncy5zbGljZShkYXNoRGFzaCArIDEpLmZpbHRlcigocCkgPT4gcC5sZW5ndGggPiAwKSA6IFtdO1xuICAgICAgcmV0dXJuIHBhdGhzLmxlbmd0aCA+IDAgPyB7IGtpbmQ6ICdjb21taXQnLCBwYXRocyB9IDogeyBraW5kOiAnY29tbWl0JyB9O1xuICAgIH1cbiAgICBpZiAoaW52LnN1YmNvbW1hbmQgPT09ICdwdXNoJykge1xuICAgICAgcmV0dXJuIHsga2luZDogJ3B1c2gnIH07XG4gICAgfVxuICAgIC8vIEEgcmVjb2duaXplZCBgZ2l0YCBpbnZvY2F0aW9uIHRoYXQgaXMgbmVpdGhlciBjb21taXQgbm9yIHB1c2ggKGUuZy5cbiAgICAvLyBgZ2l0IGFkZCAuICYmIGdpdCBjb21taXQgXHUyMDI2YCk6IGtlZXAgc2Nhbm5pbmcgbGF0ZXIgc2VnbWVudHMuXG4gIH1cbiAgcmV0dXJuIHsga2luZDogJ25vbmUnIH07XG59XG5cbi8qKlxuICogV2hldGhlciBhIGBnaXQgY29tbWl0YCBpbiB0aGUgY29tbWFuZCBpcyBhbiBgLWFgL2AtYW1gL2AtLWFsbGAgZm9ybSBcdTIwMTQgdGhlXG4gKiBcInN0YWdlIGFsbCB0cmFja2VkLW1vZGlmaWVkIGZpbGVzXCIgdmFyaWFudCB3aG9zZSBjaGFuZ2VzZXQge0BsaW5rIHJlc29sdmVDaGFuZ2VzZXR9XG4gKiBtdXN0IHdpZGVuIGJleW9uZCB0aGUgYWxyZWFkeS1zdGFnZWQgc2V0LlxuICpcbiAqIFRoZSBgYWxsYCBzaWduYWwgaXMgZGVsaWJlcmF0ZWx5ICpub3QqIGNhcnJpZWQgb24ge0BsaW5rIFBhcnNlZEdpdENvbW1hbmR9XG4gKiAoc2VlIHRoYXQgdHlwZSdzIGRvYyk6IHRoZSBhZGFwdGVyIGRlcml2ZXMgaXQgaGVyZSBmcm9tIHRoZSBzYW1lIGNvbW1hbmQgdGV4dFxuICogYW5kIHRocmVhZHMgaXQgaW50byB7QGxpbmsgcmVzb2x2ZUNoYW5nZXNldH0gZXhwbGljaXRseS4gQ29uc2VydmF0aXZlOiBvbmx5IGFcbiAqIHNob3J0LWZsYWcgZ3JvdXAgY29udGFpbmluZyBgYWAgKGAtYWAsIGAtYW1gLCBgLW1hYCkgb3IgYW4gZXhwbGljaXQgYC0tYWxsYCxcbiAqIHNjYW5uZWQgYmVmb3JlIGFueSBgLS1gIHBhdGhzcGVjIHNlcGFyYXRvciwgY291bnRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29tbWl0U3RhZ2VzQWxsKGNvbW1hbmQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc3BsaXRTZWdtZW50cyhjb21tYW5kKSkge1xuICAgIGNvbnN0IGludiA9IG1hdGNoR2l0SW52b2NhdGlvbih0b2tlbml6ZShzZWdtZW50KSk7XG4gICAgaWYgKCFpbnYgfHwgaW52LnN1YmNvbW1hbmQgIT09ICdjb21taXQnKSBjb250aW51ZTtcbiAgICBjb25zdCBkYXNoRGFzaCA9IGludi5hcmdzLmluZGV4T2YoJy0tJyk7XG4gICAgY29uc3QgZmxhZ0FyZ3MgPSBkYXNoRGFzaCA+PSAwID8gaW52LmFyZ3Muc2xpY2UoMCwgZGFzaERhc2gpIDogaW52LmFyZ3M7XG4gICAgZm9yIChjb25zdCBhcmcgb2YgZmxhZ0FyZ3MpIHtcbiAgICAgIGlmIChhcmcgPT09ICctLWFsbCcpIHJldHVybiB0cnVlO1xuICAgICAgaWYgKCFhcmcuc3RhcnRzV2l0aCgnLS0nKSAmJiAvXi1bQS1aYS16XSphW0EtWmEtel0qJC8udGVzdChhcmcpKSByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLy8gU2hlbGwgY29udHJvbCBvcGVyYXRvcnMgdGhhdCBzZXBhcmF0ZSBvbmUgc2ltcGxlIGNvbW1hbmQgZnJvbSB0aGUgbmV4dC5cbi8vIFNwbGl0dGluZyBvbiB0aGVzZSAob3V0c2lkZSBxdW90ZXMpIGlzb2xhdGVzIGVhY2ggY29tbWFuZCBzbyBhIGBnaXQgY29tbWl0YC9cbi8vIGBnaXQgcHVzaGAgY2hhaW5lZCBhZnRlciBgJiZgL2A7YC9gfGAgaXMgZm91bmQsIHdoaWxlIHRleHQgaW5zaWRlIGEgcXVvdGVkXG4vLyBhcmd1bWVudCAoYGVjaG8gXCJnaXQgY29tbWl0XCJgKSBzdGF5cyB3aXRoaW4gaXRzIG93biBub24tZ2l0IHNlZ21lbnQuXG5jb25zdCBUV09fQ0hBUl9PUEVSQVRPUlMgPSBuZXcgU2V0KFsnJiYnLCAnfHwnXSk7XG5jb25zdCBPTkVfQ0hBUl9TRVBBUkFUT1JTID0gbmV3IFNldChbJzsnLCAnfCcsICdcXG4nLCAnJicsICcoJywgJyknXSk7XG5cbi8qKiBTcGxpdCBhIHNoZWxsIGNvbW1hbmQgaW50byBzaW1wbGUtY29tbWFuZCBzZWdtZW50cywgcmVzcGVjdGluZyBxdW90ZXMuICovXG5mdW5jdGlvbiBzcGxpdFNlZ21lbnRzKGNvbW1hbmQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgc2VnbWVudHM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjdXJyZW50ID0gJyc7XG4gIGxldCBxdW90ZTogJ1wiJyB8IFwiJ1wiIHwgbnVsbCA9IG51bGw7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgY29tbWFuZC5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGNoID0gY29tbWFuZFtpXTtcbiAgICBpZiAocXVvdGUpIHtcbiAgICAgIGN1cnJlbnQgKz0gY2g7XG4gICAgICBpZiAoY2ggPT09IHF1b3RlKSBxdW90ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSAnXCInIHx8IGNoID09PSBcIidcIikge1xuICAgICAgcXVvdGUgPSBjaDtcbiAgICAgIGN1cnJlbnQgKz0gY2g7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKFRXT19DSEFSX09QRVJBVE9SUy5oYXMoY29tbWFuZC5zbGljZShpLCBpICsgMikpKSB7XG4gICAgICBzZWdtZW50cy5wdXNoKGN1cnJlbnQpO1xuICAgICAgY3VycmVudCA9ICcnO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChPTkVfQ0hBUl9TRVBBUkFUT1JTLmhhcyhjaCkpIHtcbiAgICAgIHNlZ21lbnRzLnB1c2goY3VycmVudCk7XG4gICAgICBjdXJyZW50ID0gJyc7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY3VycmVudCArPSBjaDtcbiAgfVxuICBzZWdtZW50cy5wdXNoKGN1cnJlbnQpO1xuICByZXR1cm4gc2VnbWVudHM7XG59XG5cbi8qKlxuICogVG9rZW5pemUgb25lIHNlZ21lbnQgaW50byBzaGVsbCB3b3JkcywgcmVzcGVjdGluZyBzaW5nbGUvZG91YmxlIHF1b3RlcyBhbmRcbiAqIHN0cmlwcGluZyB0aGUgcXVvdGUgY2hhcmFjdGVycy4gRGVsaWJlcmF0ZWx5IG1pbmltYWwgKG5vIGV4cGFuc2lvbiwgbm9cbiAqIGVzY2FwZSBoYW5kbGluZyBiZXlvbmQgcXVvdGVzKTogdGhlIGdvYWwgaXMgY29uZmlkZW50IHJlY29nbml0aW9uIG9mIGFcbiAqIGBnaXQgY29tbWl0YC9gcHVzaGAgc2hhcGUsIG5vdCBhIGZ1bGwgc2hlbGwgcGFyc2VyLlxuICovXG5mdW5jdGlvbiB0b2tlbml6ZShzZWdtZW50OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHRva2Vuczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGN1cnJlbnQgPSAnJztcbiAgbGV0IGhhcyA9IGZhbHNlO1xuICBsZXQgcXVvdGU6ICdcIicgfCBcIidcIiB8IG51bGwgPSBudWxsO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHNlZ21lbnQubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjaCA9IHNlZ21lbnRbaV07XG4gICAgaWYgKHF1b3RlKSB7XG4gICAgICBpZiAoY2ggPT09IHF1b3RlKSBxdW90ZSA9IG51bGw7XG4gICAgICBlbHNlIGN1cnJlbnQgKz0gY2g7XG4gICAgICBoYXMgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gJ1wiJyB8fCBjaCA9PT0gXCInXCIpIHtcbiAgICAgIHF1b3RlID0gY2g7XG4gICAgICBoYXMgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gJyAnIHx8IGNoID09PSAnXFx0Jykge1xuICAgICAgaWYgKGhhcykge1xuICAgICAgICB0b2tlbnMucHVzaChjdXJyZW50KTtcbiAgICAgICAgY3VycmVudCA9ICcnO1xuICAgICAgICBoYXMgPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjdXJyZW50ICs9IGNoO1xuICAgIGhhcyA9IHRydWU7XG4gIH1cbiAgaWYgKGhhcykgdG9rZW5zLnB1c2goY3VycmVudCk7XG4gIHJldHVybiB0b2tlbnM7XG59XG5cbi8qKiBHaXQgZ2xvYmFsIG9wdGlvbnMgdGhhdCBjb25zdW1lIGEgc2VwYXJhdGUgZm9sbG93aW5nIHZhbHVlIHRva2VuLiAqL1xuY29uc3QgR0lUX1ZBTFVFX09QVElPTlMgPSBuZXcgU2V0KFtcbiAgJy1DJyxcbiAgJy1jJyxcbiAgJy0tZ2l0LWRpcicsXG4gICctLXdvcmstdHJlZScsXG4gICctLW5hbWVzcGFjZScsXG4gICctLXN1cGVyLXByZWZpeCcsXG4gICctLWV4ZWMtcGF0aCcsXG4gICctLWF0dHItc291cmNlJyxcbiAgJy0tY29uZmlnLWVudidcbl0pO1xuXG5pbnRlcmZhY2UgR2l0SW52b2NhdGlvbiB7XG4gIHN1YmNvbW1hbmQ6IHN0cmluZztcbiAgYXJnczogc3RyaW5nW107XG59XG5cbi8qKlxuICogSWYgYSBzZWdtZW50J3MgdG9rZW5zIGFyZSBhIGBnaXQgPHN1YmNvbW1hbmQ+IFx1MjAyNmAgaW52b2NhdGlvbiwgcmV0dXJuIHRoZVxuICogc3ViY29tbWFuZCBhbmQgaXRzIHJlbWFpbmluZyBhcmdzOyBvdGhlcndpc2UgYG51bGxgLiBMZWFkaW5nIGBWQVI9dmFsdWVgXG4gKiBlbnZpcm9ubWVudCBhc3NpZ25tZW50cyBhbmQgYGdpdGAgZ2xvYmFsIG9wdGlvbnMgKGluY2x1ZGluZyB0aGUgdmFsdWUtdGFraW5nXG4gKiBvbmVzKSBhcmUgc2tpcHBlZCBzbyB0aGUgc3ViY29tbWFuZCBpcyBjb3JyZWN0bHkgbG9jYXRlZC5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hHaXRJbnZvY2F0aW9uKHRva2Vuczogc3RyaW5nW10pOiBHaXRJbnZvY2F0aW9uIHwgbnVsbCB7XG4gIGxldCBpID0gMDtcbiAgd2hpbGUgKGkgPCB0b2tlbnMubGVuZ3RoICYmIC9eW0EtWmEtel9dW0EtWmEtejAtOV9dKj0vLnRlc3QodG9rZW5zW2ldKSkgaSsrO1xuICBpZiAoaSA+PSB0b2tlbnMubGVuZ3RoIHx8IHRva2Vuc1tpXSAhPT0gJ2dpdCcpIHJldHVybiBudWxsO1xuICBpKys7XG4gIHdoaWxlIChpIDwgdG9rZW5zLmxlbmd0aCkge1xuICAgIGNvbnN0IHQgPSB0b2tlbnNbaV07XG4gICAgaWYgKHQgPT09ICctLScpIHJldHVybiBudWxsOyAvLyBhIGAtLWAgYmVmb3JlIGFueSBzdWJjb21tYW5kIGlzIG5vdCBhIHNoYXBlIHdlIHJlY29nbml6ZVxuICAgIGlmICghdC5zdGFydHNXaXRoKCctJykpIGJyZWFrO1xuICAgIGkgKz0gR0lUX1ZBTFVFX09QVElPTlMuaGFzKHQpID8gMiA6IDE7XG4gIH1cbiAgaWYgKGkgPj0gdG9rZW5zLmxlbmd0aCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IHN1YmNvbW1hbmQ6IHRva2Vuc1tpXSwgYXJnczogdG9rZW5zLnNsaWNlKGkgKyAxKSB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENoYW5nZXNldCByZXNvbHV0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBUaGUgaW5qZWN0ZWQgZ2l0IHN1cmZhY2Uge0BsaW5rIHJlc29sdmVDaGFuZ2VzZXR9IG5lZWRzIHRvIHR1cm4gYSBwYXJzZWRcbiAqIGNvbW1hbmQgaW50byB0aGUgY29uY3JldGUgbGlzdCBvZiBwYXRocyB0aGF0IHdvdWxkIGxhbmQuIEtlcHQgYXMgbmFycm93IGFzeW5jXG4gKiBmdW5jdGlvbnMgKHJhdGhlciB0aGFuIGEgcmF3IGNvbW1hbmQgcnVubmVyKSBmb2xsb3dpbmcgYHRvdWNoLWNvcmUudHNgJ3NcbiAqIGBUb3VjaEV4ZWN1dG9yc2AgcGF0dGVybiwgc28gUGhhc2UgMy4yJ3MgdGVzdHMgZmFrZSB0aGUgcmVwbyBzdGF0ZSB3aXRob3V0IGFcbiAqIHJlYWwgc3VicHJvY2VzcyBhbmQgdGhlIGNvcmUgbmV2ZXIgc3Bhd25zIG9uZSBpdHNlbGYuXG4gKlxuICogQWxsIHJldHVybmVkIHBhdGhzIGFyZSByZXBvLXJlbGF0aXZlIFBPU0lYIHBhdGhzLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEdpdEV4ZWN1dG9yIHtcbiAgLyoqXG4gICAqIFBhdGhzIHN0YWdlZCBmb3IgdGhlIG5leHQgY29tbWl0IFx1MjAxNCBgZ2l0IGRpZmYgLS1jYWNoZWQgLS1uYW1lLW9ubHlgLiBUaGVzZVxuICAgKiBhcmUgd2hhdCBhIHBsYWluIGBnaXQgY29tbWl0YCB3b3VsZCBsYW5kLlxuICAgKi9cbiAgc3RhZ2VkUGF0aHMoY3dkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZ1tdPjtcbiAgLyoqXG4gICAqIFRyYWNrZWQgZmlsZXMgd2l0aCB1bnN0YWdlZCB3b3JraW5nLXRyZWUgbW9kaWZpY2F0aW9ucyBcdTIwMTRcbiAgICogYGdpdCBkaWZmIC0tbmFtZS1vbmx5YC4gRm9sZGVkIGludG8gdGhlIGNoYW5nZXNldCBvbmx5IGZvciBgLWFgL2AtYW1gXG4gICAqIGZvcm1zLCB3aGljaCBzdGFnZSB0cmFja2VkLW1vZGlmaWVkIGZpbGVzIGltcGxpY2l0bHkgYXQgY29tbWl0IHRpbWUuXG4gICAqL1xuICB0cmFja2VkTW9kaWZpZWRQYXRocyhjd2Q6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nW10+O1xuICAvKipcbiAgICogUGF0aHMgaW4gdGhlIG91dGdvaW5nIHB1c2ggcmFuZ2UgXHUyMDE0IHRoZSBmaWxlcyBjaGFuZ2VkIGJ5IGBAe3V9Li5IRUFEYCwgd2l0aFxuICAgKiBhIG1lcmdlLWJhc2UtYWdhaW5zdC10aGUtZGVmYXVsdC1yZW1vdGUtYnJhbmNoIGZhbGxiYWNrIHdoZW4gbm8gdXBzdHJlYW0gaXNcbiAgICogY29uZmlndXJlZC4gVGhlc2UgYXJlIHdoYXQgYSBgZ2l0IHB1c2hgIHdvdWxkIHB1Ymxpc2guXG4gICAqL1xuICBvdXRnb2luZ1BhdGhzKGN3ZDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmdbXT47XG59XG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgY29uY3JldGUgbGlzdCBvZiByZXBvLXJlbGF0aXZlIHBhdGhzIGEgZ2F0ZWQgY29tbWFuZCB3b3VsZCBsYW5kLFxuICogc28gdGhlIGdhdGUgY2FuIHNjb3BlIGl0cyBzdGFsZW5lc3MvY292ZXJhZ2UgY2hlY2sgdG8gZXhhY3RseSB0aGF0IGNoYW5nZXNldC5cbiAqXG4gKiAtIGBjb21taXRgOiB0aGUgc3RhZ2VkIHBhdGhzLCBwbHVzIFx1MjAxNCB3aGVuIGBhbGxgIGlzIHRydWUgKHRoZSBjb21tYW5kIHdhcyBhblxuICogICBgLWFgL2AtYW1gIGZvcm0pIFx1MjAxNCB0aGUgdHJhY2tlZC1tb2RpZmllZCBwYXRocyB0aG9zZSBmb3JtcyBzdGFnZSBpbXBsaWNpdGx5LlxuICogLSBgcHVzaGA6IHRoZSBvdXRnb2luZyByYW5nZSBgQHt1fS4uSEVBRGAsIHdpdGggYSBtZXJnZS1iYXNlIGZhbGxiYWNrIHdoZW4gbm9cbiAqICAgdXBzdHJlYW0gaXMgY29uZmlndXJlZC4gYGFsbGAgaXMgbm90IG1lYW5pbmdmdWwgZm9yIGEgcHVzaCBhbmQgaXMgaWdub3JlZC5cbiAqXG4gKiBUaGUgYGFsbGAgZmxhZyBpcyB0aHJlYWRlZCBpbiBleHBsaWNpdGx5IChyYXRoZXIgdGhhbiByZWFkIGJhY2sgb3V0IG9mIHRoZVxuICogY29tbWFuZCkgYmVjYXVzZSB7QGxpbmsgUGFyc2VkR2l0Q29tbWFuZH0gaW50ZW50aW9uYWxseSBkb2VzIG5vdCBjYXJyeSBpdCBcdTIwMTRcbiAqIHRoZSBjYWxsZXIvYWRhcHRlciBkZXJpdmVzIGl0IGZyb20gdGhlIHBhcnNlIGFuZCBwYXNzZXMgaXQgaGVyZS5cbiAqXG4gKiBAcGFyYW0ga2luZCBXaGV0aGVyIHRoZSBjaGFuZ2VzZXQgaXMgYSBjb21taXQncyBzdGFnZWQgc2V0IG9yIGEgcHVzaCdzIHJhbmdlLlxuICogQHBhcmFtIGFsbCBXaGV0aGVyIHRoZSBjb21taXQgd2FzIGFuIGAtYWAvYC1hbWAgZm9ybSAoaWdub3JlZCBmb3IgYHB1c2hgKS5cbiAqIEBwYXJhbSBjd2QgVGhlIHdvcmtpbmcgZGlyZWN0b3J5IHRoZSBnaXQgY29tbWFuZCByYW4gaW4uXG4gKiBAcGFyYW0gZ2l0IFRoZSBpbmplY3RlZCBnaXQgc3VyZmFjZSBiYWNraW5nIHRoZSByZXNvbHV0aW9uLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUNoYW5nZXNldChcbiAga2luZDogJ2NvbW1pdCcgfCAncHVzaCcsXG4gIGFsbDogYm9vbGVhbixcbiAgY3dkOiBzdHJpbmcsXG4gIGdpdDogR2l0RXhlY3V0b3Jcbik6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgaWYgKGtpbmQgPT09ICdwdXNoJykge1xuICAgIHJldHVybiBnaXQub3V0Z29pbmdQYXRocyhjd2QpO1xuICB9XG4gIGNvbnN0IHN0YWdlZCA9IGF3YWl0IGdpdC5zdGFnZWRQYXRocyhjd2QpO1xuICBpZiAoIWFsbCkgcmV0dXJuIHN0YWdlZDtcbiAgY29uc3QgdHJhY2tlZCA9IGF3YWl0IGdpdC50cmFja2VkTW9kaWZpZWRQYXRocyhjd2QpO1xuICBjb25zdCBzZWVuID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGNvbnN0IG1lcmdlZDogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBwYXRoIG9mIFsuLi5zdGFnZWQsIC4uLnRyYWNrZWRdKSB7XG4gICAgaWYgKHNlZW4uaGFzKHBhdGgpKSBjb250aW51ZTtcbiAgICBzZWVuLmFkZChwYXRoKTtcbiAgICBtZXJnZWQucHVzaChwYXRoKTtcbiAgfVxuICByZXR1cm4gbWVyZ2VkO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEdhdGUgZXZhbHVhdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogVGhlIGluamVjdGVkIGV4ZWN1dGlvbiBzdXJmYWNlIGdhdGUgZXZhbHVhdGlvbiBuZWVkcyBcdTIwMTQgdGhlIGBmaXhgL2BzdGFsZWAvXG4gKiBgbGlzdGAgYXN5bmMgZnVuY3Rpb25zLCBtaXJyb3JpbmcgYHRvdWNoLWNvcmUudHNgJ3MgYFRvdWNoRXhlY3V0b3JzYC4gVGVzdHNcbiAqIGluamVjdCBmYWtlcyByZXR1cm5pbmcgc3RydWN0dXJlZCBkYXRhOyB0aGUgY29yZSBuZXZlciBzcGF3bnMgYSBzdWJwcm9jZXNzXG4gKiBpdHNlbGYuIEFsbCBwYXRocyBhcmUgcmVwby1yZWxhdGl2ZSBQT1NJWCBwYXRocy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBHYXRlRXhlY3V0b3JzIHtcbiAgLyoqXG4gICAqIFJ1biBhIHNjb3BlZCBgZ2l0IHNwYW4gc3RhbGUgPHBhdGhzPiAtLWZpeGAgXHUyMDE0IHRoZSBiZWx0LWFuZC1icmFjZXMgaGVhbCB0aGF0XG4gICAqIHJ1bnMgYmVmb3JlIGNsYXNzaWZpY2F0aW9uIChwZXIgQ0FSRC5tZCksIHJlLWFuY2hvcmluZyBhbnkgcG9zaXRpb25hbCBkcmlmdFxuICAgKiBpbiB0aGUgY2hhbmdlc2V0IHRoYXQgdGhlIHRvdWNoIGhvb2sgaGFzIG5vdCBhbHJlYWR5IGhlYWxlZC4gUmVwb3J0cyBub3RoaW5nO1xuICAgKiBpdHMgZWZmZWN0IGlzIG9uIHRoZSB3b3JraW5nIHRyZWUsIGFuZCB0aGUgc3Vic2VxdWVudCB7QGxpbmsgR2F0ZUV4ZWN1dG9ycy5zdGFsZX1cbiAgICogcmVhZCBvYnNlcnZlcyB0aGUgaGVhbGVkIHN0YXRlLlxuICAgKi9cbiAgZml4KHBhdGhzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+O1xuICAvKipcbiAgICogUnVuIGEgc2NvcGVkIGBnaXQgc3BhbiBzdGFsZSAtLWZvcm1hdCBwb3JjZWxhaW4gPHBhdGhzPmAgYW5kIHJldHVybiBpdHNcbiAgICogcGFyc2VkIHJvd3MgXHUyMDE0IG9uZSBwZXIgZHJpZnRlZCBhbmNob3IgYW1vbmcgdGhlIGNoYW5nZXNldCdzIHNwYW5zLCBlbXB0eSB3aGVuXG4gICAqIGNsZWFuLiBEZWJ0IGlzIGNsYXNzaWZpZWQgZnJvbSB0aGVzZSByb3dzIHZpYSBgaXNEZWJ0KClgOyBwb3NpdGlvbmFsXG4gICAqIChgTU9WRURgL2BSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGApIHJvd3MgYXJlIG5ldmVyIGRlYnQgYW5kIG5ldmVyIGRlbnkuXG4gICAqL1xuICBzdGFsZShwYXRoczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKTogUHJvbWlzZTxTdGFsZVBvcmNlbGFpblJvd1tdPjtcbiAgLyoqXG4gICAqIFJ1biBhIHNjb3BlZCBgZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbiA8cGF0aHM+YCBhbmQgcmV0dXJuIHRoZSBjb3ZlcmluZ1xuICAgKiBhbmNob3JzLiBVc2VkIHRvIGNvbXB1dGUgKnVuY292ZXJlZCB3cml0ZXMqOiBhIGNoYW5nZWQgcGF0aCB3aXRoIHplcm9cbiAgICogY292ZXJpbmcgcm93cyBoZXJlIChtaW51cyBgLnNwYW4vKipgLCBnaXRpZ25vcmVkIHBhdGhzLCBhbmRcbiAgICogYC5zcGFuLy5nYXRlaWdub3JlYC1leGNsdWRlZCBwYXRocykgaXMgYW4gdW5jb3ZlcmVkIHdyaXRlLlxuICAgKi9cbiAgbGlzdChwYXRoczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKTogUHJvbWlzZTxQb3JjZWxhaW5Sb3dbXT47XG59XG5cbi8qKlxuICogVGhlIGdhdGUncyBwZXItY2hhbmdlc2V0IG1lbW8gXHUyMDE0IFwiaGF2ZSBJIGFscmVhZHkgcHJlc2VudGVkIHRoaXMgZXhhY3QgZGVidFxuICogc3RhdGUgb25jZT9cIiBUaGUgcGVyc2lzdGVkIHVuaXQgaXMgYSBkaWdlc3Qgb2YgdGhlIHNvcnRlZCBzdGFsZW5lc3MgZmluZGluZ3NcbiAqIHBsdXMgdGhlIHNvcnRlZCB1bmNvdmVyZWQgcGF0aHMgKGRlc2lnbi1kZWNpc2lvbnMubWQgIzkncyBcImdhdGUgb25jZSBwZXJcbiAqIGRpc3RpbmN0IGRlYnQtc3RhdGVcIik7IHRoZSBkaXNrLWJhY2tlZCBpbXBsZW1lbnRhdGlvbiBzdG9yZXMgb25lIG1hcmtlciBwZXJcbiAqIGRpZ2VzdCB1bmRlciB7QGxpbmsgZ2F0ZU1lbW9EaXJ9IChgPGdpdC1jb21tb24tZGlyPi9naXQtc3Bhbi9nYXRlL2ApLCB3aGVyZVxuICogcHJlc2VuY2UgbWVhbnMgXCJhbHJlYWR5IHByZXNlbnRlZCBvbmNlLlwiIEluamVjdGVkIGFzIGEgc3RvcmUgYWJzdHJhY3Rpb25cbiAqIChsaWtlIHNwYW4tc3VyZmFjZS50cydzIGBNZW1vU3RvcmVgKSBzbyBQaGFzZSAzLjIgZmFrZXMgaXQgaW4gbWVtb3J5LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEdhdGVNZW1vU3RhdGUge1xuICAvKiogV2hldGhlciB0aGlzIGV4YWN0IGRlYnQtc3RhdGUgZGlnZXN0IGhhcyBhbHJlYWR5IGJlZW4gcHJlc2VudGVkIG9uY2UuICovXG4gIGhhcyhkaWdlc3Q6IHN0cmluZyk6IGJvb2xlYW47XG4gIC8qKiBSZWNvcmQgdGhhdCB0aGlzIGRlYnQtc3RhdGUgZGlnZXN0IGhhcyBub3cgYmVlbiBwcmVzZW50ZWQuICovXG4gIHJlY29yZChkaWdlc3Q6IHN0cmluZyk6IHZvaWQ7XG59XG5cbi8qKlxuICogVGhlIGdhdGUncyBkZWNpc2lvbiBmb3Igb25lIGNvbW1hbmQsIGFzIGEgZGlzY3JpbWluYXRlZCB1bmlvbiB0aGUgYWRhcHRlclxuICogdHJhbnNsYXRlcyBpbnRvIGBwZXJtaXNzaW9uRGVjaXNpb246ICdkZW55J2AvYWxsb3cgKENsYXVkZSkgb3IgYSBibG9jay9hbGxvd1xuICogKENvZGV4KS4gYGRlY2lzaW9uYCBpcyB0aGUgY29hcnNlIGFsbG93L2RlbnkgdGhlIGhhcm5lc3MgYWN0cyBvbjsgYGtpbmRgXG4gKiByZWNvcmRzICp3aHkqLCBzbyB0aGUgYWRhcHRlciByZW5kZXJzIHRoZSByaWdodCBtZXNzYWdlIGFuZCBzbyB0ZXN0cyBhc3NlcnRcbiAqIHRoZSBleGFjdCBicmFuY2guXG4gKlxuICogLSBgYWxsb3dgIC8gYHNpbGVudGAgXHUyMDE0IG5vdGhpbmcgdG8gY2hlY2sgKG5vIHBhdGhzKSBvciB0aGUgY2hhbmdlc2V0IGlzIGNsZWFuO1xuICogICBhbGxvdyB3aXRoIG5vIG91dHB1dC4gSW50ZXJuYWwgZXJyb3JzIGFuZCBwYXJzZSBmYWlsdXJlcyBhbHNvIHJlc29sdmUgaGVyZTpcbiAqICAgdGhlIGdhdGUgZmFpbHMgb3BlbiBhbmQgbXVzdCBuZXZlciBicmljayBhIGNvbW1pdC5cbiAqIC0gYGFsbG93YCAvIGBhbHJlYWR5LXByZXNlbnRlZGAgXHUyMDE0IGRlYnQgaXMgcHJlc2VudCwgYnV0IHRoaXMgZXhhY3QgZGVidCBzdGF0ZVxuICogICB3YXMgYWxyZWFkeSBwcmVzZW50ZWQgb25jZSAodW5jb3ZlcmVkLXdyaXRlcyBjb25zaWRlci1vbmNlLCBvciBhbiB1bmNoYW5nZWRcbiAqICAgc3RhdGUpLiBUaGUgY29tbWFuZCBwYXNzZXMuXG4gKiAtIGBkZW55YCAvIGBzZW1hbnRpYy1zdGFsZW5lc3NgIFx1MjAxNCB0aGUgY2hhbmdlc2V0IGNhcnJpZXMgc2VtYW50aWMgc3RhbGVuZXNzLlxuICogICBEZW55IHdpdGggYGZpbmRpbmdzYCByZW5kZXJlZCBhcyBhIGNoZWNrbGlzdCBpbiBgcmVhc29uYDsgcmUtZGVuaWVzIG9uIGV2ZXJ5XG4gKiAgIHJldHJ5IHVudGlsIHRoZSBmaW5kaW5ncyBjaGFuZ2UgKHN0YWxlbmVzcyBpcyBoYXJkLXVudGlsLXJlc29sdmVkKS5cbiAqIC0gYGRlbnlgIC8gYHVuY292ZXJlZC13cml0ZXNgIFx1MjAxNCB0aGUgY2hhbmdlc2V0IGhhcyBjaGFuZ2VkIGZpbGVzIG5vIHNwYW5cbiAqICAgY292ZXJzLCBhbmQgdGhpcyBzdGF0ZSBoYXMgbm90IGJlZW4gcHJlc2VudGVkIGJlZm9yZS4gRGVueSAqKm9uY2UqKiwgbGlzdGluZ1xuICogICBgdW5jb3ZlcmVkYDsgdGhlIHJldHJ5IHdpdGggYW4gdW5jaGFuZ2VkIHN0YXRlIHJlc29sdmVzIHRvIGBhbHJlYWR5LXByZXNlbnRlZGBcbiAqICAgYW5kIHBhc3NlcyAoY29uc2lkZXItb25jZSwgcGVyIGRlc2lnbi1kZWNpc2lvbnMubWQgIzMpLlxuICovXG5leHBvcnQgdHlwZSBHYXRlUmVzdWx0ID1cbiAgfCB7IGRlY2lzaW9uOiAnYWxsb3cnOyBraW5kOiAnc2lsZW50JyB9XG4gIHwgeyBkZWNpc2lvbjogJ2FsbG93Jzsga2luZDogJ2FscmVhZHktcHJlc2VudGVkJyB9XG4gIHwgeyBkZWNpc2lvbjogJ2RlbnknOyBraW5kOiAnc2VtYW50aWMtc3RhbGVuZXNzJzsgZmluZGluZ3M6IFN0YWxlUG9yY2VsYWluUm93W107IHJlYXNvbjogc3RyaW5nIH1cbiAgfCB7IGRlY2lzaW9uOiAnZGVueSc7IGtpbmQ6ICd1bmNvdmVyZWQtd3JpdGVzJzsgdW5jb3ZlcmVkOiBzdHJpbmdbXTsgcmVhc29uOiBzdHJpbmcgfTtcblxuLyoqXG4gKiBFdmFsdWF0ZSB0aGUgZ2F0ZSBmb3IgYSByZXNvbHZlZCBjaGFuZ2VzZXQgYW5kIGRlY2lkZSB3aGV0aGVyIHRvIGhvbGQgdGhlXG4gKiBjb21tYW5kLlxuICpcbiAqIFRoZSBldmVudHVhbCBpbXBsZW1lbnRhdGlvbjogcnVuIGBleGVjdXRvcnMuZml4YCAoc2NvcGVkIGJlbHQtYW5kLWJyYWNlc1xuICogYHN0YWxlIC0tZml4YCksIHRoZW4gcmVhZCBgZXhlY3V0b3JzLnN0YWxlYCBhbmQgY2xhc3NpZnkgZWFjaCByb3cgdmlhXG4gKiBgaXNEZWJ0KClgLiBTZW1hbnRpYyBzdGFsZW5lc3MgXHUyMTkyIGBkZW55YC9gc2VtYW50aWMtc3RhbGVuZXNzYCwgcmUtYmxvY2tpbmdcbiAqIHVudGlsIHRoZSBmaW5kaW5ncyBkaWdlc3QgY2hhbmdlcy4gVW5jb3ZlcmVkIHdyaXRlcyAoY2hhbmdlZCBwYXRocyB3aXRoIHplcm9cbiAqIGNvdmVyYWdlIGZyb20gYGV4ZWN1dG9ycy5saXN0YCwgbWludXMgYC5zcGFuLyoqYCwgZ2l0aWdub3JlZCwgYW5kXG4gKiBgLmdhdGVpZ25vcmVgLWV4Y2x1ZGVkIHBhdGhzKSBcdTIxOTIgYGRlbnlgL2B1bmNvdmVyZWQtd3JpdGVzYCB0aGUgZmlyc3QgdGltZSB0aGF0XG4gKiBzdGF0ZSBpcyBzZWVuLCB0aGVuIGBhbGxvd2AvYGFscmVhZHktcHJlc2VudGVkYCBvbiByZXRyeS4gYE1PVkVEYCBhbmRcbiAqIGBSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgbmV2ZXIgY29udHJpYnV0ZSB0byBlaXRoZXIgYW5kIG5ldmVyIGRlbnkuIFRoZVxuICogZGlzdGluY3QtZGVidC1zdGF0ZSBkaWdlc3QgKHNvcnRlZCBmaW5kaW5ncyArIHNvcnRlZCB1bmNvdmVyZWQgcGF0aHMpIGlzXG4gKiBjaGVja2VkIGFuZCByZWNvcmRlZCB0aHJvdWdoIGBtZW1vU3RhdGVgLiBBbnkgaW50ZXJuYWwgZXJyb3IgcmVzb2x2ZXMgdG9cbiAqIGBhbGxvd2AvYHNpbGVudGAgXHUyMDE0IHRoZSBnYXRlIGZhaWxzIG9wZW4gYW5kIG5ldmVyIGJyaWNrcyBhIGNvbW1pdC5cbiAqXG4gKiBUaGUgYEdJVF9TUEFOX0dBVEU9c2tpcGAgZXNjYXBlIGhhdGNoIGlzICpub3QqIGNoZWNrZWQgaGVyZSBcdTIwMTQgaXQgaXMgYVxuICogcHJlLWNoZWNrIHRoZSBhZGFwdGVyIHJ1bnMgdmlhIHtAbGluayBpc0dhdGVTa2lwcGVkfSBiZWZvcmUgY2FsbGluZ1xuICogZXZhbHVhdGVHYXRlLCBzbyBhIGJ5cGFzcyBpcyBsb2dnZWQgYXMgYW4gZXhwbGljaXQgZXhjZXB0aW9uIGF0IHRoZSBhZGFwdGVyXG4gKiBib3VuZGFyeSByYXRoZXIgdGhhbiBmb2xkZWQgaW50byB0aGUgZGVjaXNpb24gaGVyZS5cbiAqXG4gKiBAcGFyYW0gcGF0aHMgVGhlIHJlc29sdmVkIGNoYW5nZXNldCBmcm9tIHtAbGluayByZXNvbHZlQ2hhbmdlc2V0fS4gRW1wdHkgXHUyMTkyXG4gKiAgIGBhbGxvd2AvYHNpbGVudGAuXG4gKiBAcGFyYW0gY3dkIFRoZSB3b3JraW5nIGRpcmVjdG9yeSB0aGUgZ2l0IGNvbW1hbmQgcmFuIGluLlxuICogQHBhcmFtIGV4ZWN1dG9ycyBUaGUgaW5qZWN0ZWQgYGZpeGAvYHN0YWxlYC9gbGlzdGAgc3VyZmFjZS5cbiAqIEBwYXJhbSBtZW1vU3RhdGUgVGhlIHBlci1jaGFuZ2VzZXQgZGVidC1zdGF0ZSBtZW1vLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZXZhbHVhdGVHYXRlKFxuICBwYXRoczogc3RyaW5nW10sXG4gIGN3ZDogc3RyaW5nLFxuICBleGVjdXRvcnM6IEdhdGVFeGVjdXRvcnMsXG4gIG1lbW9TdGF0ZTogR2F0ZU1lbW9TdGF0ZVxuKTogUHJvbWlzZTxHYXRlUmVzdWx0PiB7XG4gIGlmIChwYXRocy5sZW5ndGggPT09IDApIHJldHVybiB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnc2lsZW50JyB9O1xuICB0cnkge1xuICAgIC8vIEJlbHQtYW5kLWJyYWNlcyBoZWFsLCB0aGVuIGNsYXNzaWZ5IGFnYWluc3QgdGhlIGhlYWxlZCBzdGF0ZS5cbiAgICBhd2FpdCBleGVjdXRvcnMuZml4KHBhdGhzLCBjd2QpO1xuICAgIGNvbnN0IHN0YWxlUm93cyA9IGF3YWl0IGV4ZWN1dG9ycy5zdGFsZShwYXRocywgY3dkKTtcblxuICAgIC8vIFNlbWFudGljIHN0YWxlbmVzcyBpcyBoYXJkLXVudGlsLXJlc29sdmVkOiBkZW55IGV2ZXJ5IHRpbWUgdW50aWwgdGhlXG4gICAgLy8gZmluZGluZ3MgdGhlbXNlbHZlcyBjaGFuZ2UuIGBpc0RlYnQoKWAgaXMgdGhlIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGggXHUyMDE0XG4gICAgLy8gYE1PVkVEYC9gUkVTT0xWRURfUEVORElOR19DT01NSVRgIGFyZSBuZXZlciBkZWJ0IGFuZCBuZXZlciBjb250cmlidXRlLlxuICAgIGNvbnN0IGZpbmRpbmdzID0gc3RhbGVSb3dzLmZpbHRlcigocm93KSA9PiBpc0RlYnQocm93LnN0YXR1cykpO1xuICAgIGlmIChmaW5kaW5ncy5sZW5ndGggPiAwKSB7XG4gICAgICByZXR1cm4geyBkZWNpc2lvbjogJ2RlbnknLCBraW5kOiAnc2VtYW50aWMtc3RhbGVuZXNzJywgZmluZGluZ3MsIHJlYXNvbjogcmVuZGVyU3RhbGVuZXNzUmVhc29uKGZpbmRpbmdzKSB9O1xuICAgIH1cblxuICAgIC8vIFVuY292ZXJlZCB3cml0ZXM6IGNoYW5nZWQgcGF0aHMgd2l0aCB6ZXJvIGNvdmVyaW5nIHNwYW4sIG1pbnVzIGAuc3Bhbi8qKmBcbiAgICAvLyAoc3BhbiByZXBhaXJzIHJpZGUgdGhlIHNhbWUgY29tbWl0IGFuZCBtdXN0IG5ldmVyIHNlbGYtdHJpZ2dlciB0aGUgZ2F0ZSkuXG4gICAgLy8gR2l0aWdub3JlZCBwYXRocyBuZXZlciByZWFjaCBoZXJlIFx1MjAxNCBnaXQgZG9lcyBub3Qgc3RhZ2UvcHVibGlzaCB0aGVtLlxuICAgIGNvbnN0IGNvdmVyaW5nID0gYXdhaXQgZXhlY3V0b3JzLmxpc3QocGF0aHMsIGN3ZCk7XG4gICAgY29uc3QgY292ZXJlZCA9IG5ldyBTZXQoY292ZXJpbmcubWFwKChyb3cpID0+IHJvdy5wYXRoKSk7XG4gICAgY29uc3QgdW5jb3ZlcmVkID0gcGF0aHMuZmlsdGVyKChwYXRoKSA9PiAhY292ZXJlZC5oYXMocGF0aCkgJiYgIWlzSW5zaWRlU3BhblJvb3QocGF0aCkpO1xuICAgIGlmICh1bmNvdmVyZWQubGVuZ3RoID09PSAwKSByZXR1cm4geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ3NpbGVudCcgfTtcblxuICAgIC8vIENvbnNpZGVyLW9uY2U6IGRlbnkgdGhlIGZpcnN0IHRpbWUgdGhpcyBleGFjdCBkZWJ0IHN0YXRlIGlzIHNlZW4sIHRoZW5cbiAgICAvLyBwYXNzIHRoZSByZXRyeSB3aXRoIGFuIHVuY2hhbmdlZCBzdGF0ZS5cbiAgICBjb25zdCBkaWdlc3QgPSBnYXRlU3RhdGVEaWdlc3QoZmluZGluZ3MsIHVuY292ZXJlZCk7XG4gICAgaWYgKG1lbW9TdGF0ZS5oYXMoZGlnZXN0KSkgcmV0dXJuIHsgZGVjaXNpb246ICdhbGxvdycsIGtpbmQ6ICdhbHJlYWR5LXByZXNlbnRlZCcgfTtcbiAgICBtZW1vU3RhdGUucmVjb3JkKGRpZ2VzdCk7XG4gICAgcmV0dXJuIHsgZGVjaXNpb246ICdkZW55Jywga2luZDogJ3VuY292ZXJlZC13cml0ZXMnLCB1bmNvdmVyZWQsIHJlYXNvbjogcmVuZGVyVW5jb3ZlcmVkUmVhc29uKHVuY292ZXJlZCkgfTtcbiAgfSBjYXRjaCB7XG4gICAgLy8gRmFpbCBvcGVuOiBhbnkgaW50ZXJuYWwvQ0xJIGVycm9yIHJlc29sdmVzIHRvIGFsbG93LiBUaGUgZ2F0ZSBtdXN0IG5ldmVyXG4gICAgLy8gYnJpY2sgYSBjb21taXQgb24gaXRzIG93biBmYWlsdXJlLlxuICAgIHJldHVybiB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnc2lsZW50JyB9O1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGVidC1zdGF0ZSBkaWdlc3QgYW5kIHJlYXNvbiByZW5kZXJpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogYHBhdGgjTHN0YXJ0LUxlbmRgLCBvciBhIGJhcmUgcGF0aCBmb3IgYSB3aG9sZS1maWxlIGFuY2hvci4gKi9cbmZ1bmN0aW9uIGFuY2hvclRleHQocm93OiBTdGFsZVBvcmNlbGFpblJvdyk6IHN0cmluZyB7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHJvdy5wYXRoO1xuICByZXR1cm4gYCR7cm93LnBhdGh9I0wke3Jvdy5zdGFydH0tTCR7cm93LmVuZH1gO1xufVxuXG4vKipcbiAqIFRoZSBkaXN0aW5jdC1kZWJ0LXN0YXRlIGRpZ2VzdCAoZGVzaWduLWRlY2lzaW9ucy5tZCAjOSk6IGEgc3RhYmxlIGhhc2ggb2YgdGhlXG4gKiBzb3J0ZWQgc3RhbGVuZXNzIGZpbmRpbmdzIHBsdXMgdGhlIHNvcnRlZCB1bmNvdmVyZWQgcGF0aHMuIFByZXNlbmNlIGluIHRoZVxuICogbWVtbyBtZWFucyBcInRoaXMgZXhhY3Qgc3RhdGUgd2FzIGFscmVhZHkgcHJlc2VudGVkIG9uY2UuXCJcbiAqL1xuZnVuY3Rpb24gZ2F0ZVN0YXRlRGlnZXN0KGZpbmRpbmdzOiBTdGFsZVBvcmNlbGFpblJvd1tdLCB1bmNvdmVyZWQ6IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgY29uc3QgZmluZGluZ0tleXMgPSBmaW5kaW5ncy5tYXAoKHJvdykgPT4gYCR7cm93LnN0YXR1c31cXHQke3Jvdy5uYW1lfVxcdCR7cm93LnBhdGh9XFx0JHtyb3cuc3RhcnR9XFx0JHtyb3cuZW5kfWApLnNvcnQoKTtcbiAgY29uc3QgcGF5bG9hZCA9IEpTT04uc3RyaW5naWZ5KHsgZmluZGluZ3M6IGZpbmRpbmdLZXlzLCB1bmNvdmVyZWQ6IFsuLi51bmNvdmVyZWRdLnNvcnQoKSB9KTtcbiAgcmV0dXJuIGNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZShwYXlsb2FkKS5kaWdlc3QoJ2hleCcpO1xufVxuXG4vKiogVGhlIGBHSVRfU1BBTl9HQVRFPXNraXBgIGVzY2FwZS1oYXRjaCBsaW5lIGFwcGVuZGVkIHRvIGV2ZXJ5IGRlbnkgcmVhc29uLiAqL1xuY29uc3QgRVNDQVBFX0hBVENIX0xJTkUgPVxuICAnVG8gcHJvY2VlZCBhbnl3YXkgKHJlcXVpcmVzIGV4cGxpY2l0IHVzZXIgYXBwcm92YWwpOiBwcmVmaXggdGhlIGNvbW1hbmQgd2l0aCBgR0lUX1NQQU5fR0FURT1za2lwYC4nO1xuXG4vKiogVGhlIGNoZWNrbGlzdCBhIHNlbWFudGljLXN0YWxlbmVzcyBkZW55IHJlbmRlcnMgaW50byBgcmVhc29uYC4gKi9cbmZ1bmN0aW9uIHJlbmRlclN0YWxlbmVzc1JlYXNvbihmaW5kaW5nczogU3RhbGVQb3JjZWxhaW5Sb3dbXSk6IHN0cmluZyB7XG4gIGNvbnN0IGxpbmVzID0gZmluZGluZ3MubWFwKChyb3cpID0+IGAgIC0gJHtyb3cubmFtZX0gKCR7cm93LnN0YXR1c30pOiAke2FuY2hvclRleHQocm93KX1gKTtcbiAgcmV0dXJuIFtcbiAgICAnVGhpcyBjaGFuZ2VzZXQgY2FycmllcyBzcGFuIGRlYnQgXHUyMDE0IHJlc29sdmUgaXQgYmVmb3JlIHRoaXMgbGFuZHM6JyxcbiAgICAuLi5saW5lcyxcbiAgICAnJyxcbiAgICBcIlVwZGF0ZSBlYWNoIHNwYW4ncyBhbmNob3JzL3doeSBpbiB0aGlzIHNhbWUgY2hhbmdlLCBvciB0ZWxsIHRoZSB1c2VyIHdoeSB0aGUgZGVzY3JpYmVkIGNvdXBsaW5nIG5vIGxvbmdlciBob2xkcywgdGhlbiByZXRyeS5cIixcbiAgICBFU0NBUEVfSEFUQ0hfTElORVxuICBdLmpvaW4oJ1xcbicpO1xufVxuXG4vKiogVGhlIG9uZS10aW1lIGxpc3QgYW4gdW5jb3ZlcmVkLXdyaXRlcyBkZW55IHJlbmRlcnMgaW50byBgcmVhc29uYC4gKi9cbmZ1bmN0aW9uIHJlbmRlclVuY292ZXJlZFJlYXNvbih1bmNvdmVyZWQ6IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgY29uc3QgbGluZXMgPSB1bmNvdmVyZWQubWFwKChwYXRoKSA9PiBgICAtICR7cGF0aH1gKTtcbiAgcmV0dXJuIFtcbiAgICAnVGhlc2UgY2hhbmdlZCBmaWxlcyBhcmUgY292ZXJlZCBieSBubyBzcGFuIFx1MjAxNCBjb25zaWRlciB3aGV0aGVyIHRoZXkgbmVlZCBvbmU6JyxcbiAgICAuLi5saW5lcyxcbiAgICAnJyxcbiAgICAnRGVjbGFyZSBhIGNvdXBsaW5nIHdpdGggYGdpdCBzcGFuIGFkZGAgaWYgb25lIGdlbnVpbmVseSBleGlzdHMsIG9yIGp1c3QgcmV0cnkgdGhlIGNvbW1hbmQgdG8gcHJvY2VlZCAodGhpcyBpcyBhIG9uZS10aW1lIGNoZWNrKS4nLFxuICAgIEVTQ0FQRV9IQVRDSF9MSU5FXG4gIF0uam9pbignXFxuJyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRXNjYXBlIGhhdGNoXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBXaGV0aGVyIHRoZSB0cmFuc2NyaXB0LXZpc2libGUgZXNjYXBlIGhhdGNoIGBHSVRfU1BBTl9HQVRFPXNraXBgIGlzIHNldCxcbiAqIGJ5cGFzc2luZyB0aGUgZ2F0ZSBmb3IgYSB1c2VyLWFwcHJvdmVkIGV4Y2VwdGlvbiAoQ0FSRC5tZCBhY2NlcHRhbmNlXG4gKiBjcml0ZXJpb24gNTsgdGhlIHNraWxsIGRvY3VtZW50cyB0aGF0IHNldHRpbmcgaXQgcmVxdWlyZXMgZXhwbGljaXQgdXNlclxuICogYXBwcm92YWwpLlxuICpcbiAqIEltcGxlbWVudGVkIChub3Qgc3R1YmJlZCkgaW4gdGhpcyBwaGFzZTogaXQgaXMgYSBzaW5nbGUsIHB1cmUgZW52LXZhciByZWFkXG4gKiB0aGF0IENBUkQubWQgZnVsbHkgc3BlY2lmaWVzLCBzbyB0aGUgc3R1Yi10aGVuLWltcGxlbWVudCBjZXJlbW9ueSB3b3VsZCBhZGRcbiAqIG5vdGhpbmcgXHUyMDE0IHRoZXJlIGlzIG5vIGxvZ2ljIHRvIGdldCB3cm9uZyBiZXlvbmQgdGhlIGV4YWN0LXN0cmluZyBtYXRjaCwgYW5kIGFcbiAqIHRyaXZpYWwgaW1wbGVtZW50YXRpb24gaXMgbW9yZSBob25lc3QgdGhhbiBhIHN0dWIgdGhhdCB0aHJvd3MuIEtlcHQgcHVyZSBvdmVyXG4gKiBgcHJvY2Vzcy5lbnZgIChlbnYgaW5qZWN0ZWQgYXMgYSBwYXJhbWV0ZXIpIHNvIFBoYXNlIDMuMiBjYW4gZXhlcmNpc2UgYm90aFxuICogYnJhbmNoZXMgd2l0aG91dCBtdXRhdGluZyBnbG9iYWwgc3RhdGUuXG4gKlxuICogQHBhcmFtIGVudiBUaGUgZW52aXJvbm1lbnQgdG8gcmVhZCwgZS5nLiBgcHJvY2Vzcy5lbnZgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNHYXRlU2tpcHBlZChlbnY6IE5vZGVKUy5Qcm9jZXNzRW52IHwgUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkPik6IGJvb2xlYW4ge1xuICByZXR1cm4gZW52WydHSVRfU1BBTl9HQVRFJ10gPT09ICdza2lwJztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBEZWZhdWx0IHN1YnByb2Nlc3MvZGlzay1iYWNrZWQgZGVwZW5kZW5jaWVzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vXG4vLyBUaGUgcHJvZHVjdGlvbiBzdXJmYWNlcyBib3RoIGFkYXB0ZXJzIGluamVjdCBieSBkZWZhdWx0LCBmb2xsb3dpbmdcbi8vIHRvdWNoLWNvcmUudHMncyBgY3JlYXRlRGVmYXVsdFRvdWNoRXhlY3V0b3JzYCBzdHlsZTogZWFjaCBjYXB0dXJlcyBzdGRvdXQgZXZlblxuLy8gb24gYSBub24temVybyBleGl0IHdoZXJlIHRoZSBDTEkgc3RpbGwgZW1pdHMgdXNlZnVsIG91dHB1dCwgYW5kIGV2ZXJ5IGZhaWx1cmVcbi8vIG1vZGUgKGFic2VudCBiaW5hcnksIHRpbWVvdXQsIG5vIHJlcG8pIHN1cmZhY2VzIGFzIGFuIGVtcHR5L2NsZWFuIHJlc3VsdCBzb1xuLy8gdGhlIGdhdGUncyBmYWlsLW9wZW4gY29udHJhY3QgaG9sZHMgd2l0aG91dCB0aGUgYWRhcHRlciBhZGRpbmcgaXRzIG93bi5cblxuY29uc3QgREVGQVVMVF9USU1FT1VUX01TID0gMTBfMDAwO1xuXG4vKiogUnVuIGEgZ2l0IGNvbW1hbmQgYXQgYGN3ZGAsIHJldHVybmluZyB0cmltbWVkIG5vbi1lbXB0eSBQT1NJWCBvdXRwdXQgbGluZXMgKGVtcHR5IG9uIGFueSBmYWlsdXJlKS4gKi9cbmZ1bmN0aW9uIGdpdExpbmVzKGFyZ3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZywgdGltZW91dE1zOiBudW1iZXIpOiBzdHJpbmdbXSB7XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBhcmdzLCB7XG4gICAgICBjd2QsXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICB9KTtcbiAgICByZXR1cm4gb3V0XG4gICAgICAuc3BsaXQoJ1xcbicpXG4gICAgICAubWFwKChsaW5lKSA9PiBsaW5lLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoKGxpbmUpID0+IGxpbmUubGVuZ3RoID4gMClcbiAgICAgIC5tYXAodG9Qb3NpeCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBbXTtcbiAgfVxufVxuXG4vKipcbiAqIExpa2Uge0BsaW5rIGdpdExpbmVzfSBidXQgZGlzdGluZ3Vpc2hlcyBhICpmYWlsZWQqIGludm9jYXRpb24gKGBudWxsYCBcdTIwMTQgZS5nLlxuICogYEB7dX1gIHdpdGggbm8gdXBzdHJlYW0gY29uZmlndXJlZCkgZnJvbSBhICpzdWNjZXNzZnVsIGJ1dCBlbXB0eSogcmVzdWx0XG4gKiAoYFtdYCksIHNvIHRoZSBvdXRnb2luZy1yYW5nZSByZXNvbHV0aW9uIGtub3dzIHdoZW4gdG8gdHJ5IHRoZSBtZXJnZS1iYXNlXG4gKiBmYWxsYmFjayByYXRoZXIgdGhhbiBtaXN0YWtpbmcgXCJubyB1cHN0cmVhbVwiIGZvciBcIm5vdGhpbmcgdG8gcHVzaFwiLlxuICovXG5mdW5jdGlvbiBnaXRMaW5lc09yTnVsbChhcmdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcsIHRpbWVvdXRNczogbnVtYmVyKTogc3RyaW5nW10gfCBudWxsIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIGFyZ3MsIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgIH0pO1xuICAgIHJldHVybiBvdXRcbiAgICAgIC5zcGxpdCgnXFxuJylcbiAgICAgIC5tYXAoKGxpbmUpID0+IGxpbmUudHJpbSgpKVxuICAgICAgLmZpbHRlcigobGluZSkgPT4gbGluZS5sZW5ndGggPiAwKVxuICAgICAgLm1hcCh0b1Bvc2l4KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqIFRoZSBwcm9kdWN0aW9uIHtAbGluayBHaXRFeGVjdXRvcn06IGBnaXQgZGlmZmAgcmVhZHMgc2NvcGVkIHRvIHRoZSBDV0QgcmVwby4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0R2l0RXhlY3V0b3IodGltZW91dE1zOiBudW1iZXIgPSBERUZBVUxUX1RJTUVPVVRfTVMpOiBHaXRFeGVjdXRvciB7XG4gIHJldHVybiB7XG4gICAgc3RhZ2VkUGF0aHM6IGFzeW5jIChjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290KSByZXR1cm4gW107XG4gICAgICByZXR1cm4gZ2l0TGluZXMoWyctQycsIHJlcG9Sb290LCAnZGlmZicsICctLWNhY2hlZCcsICctLW5hbWUtb25seSddLCByZXBvUm9vdCwgdGltZW91dE1zKTtcbiAgICB9LFxuICAgIHRyYWNrZWRNb2RpZmllZFBhdGhzOiBhc3luYyAoY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCkgcmV0dXJuIFtdO1xuICAgICAgcmV0dXJuIGdpdExpbmVzKFsnLUMnLCByZXBvUm9vdCwgJ2RpZmYnLCAnLS1uYW1lLW9ubHknXSwgcmVwb1Jvb3QsIHRpbWVvdXRNcyk7XG4gICAgfSxcbiAgICBvdXRnb2luZ1BhdGhzOiBhc3luYyAoY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCkgcmV0dXJuIFtdO1xuICAgICAgY29uc3QgdXBzdHJlYW0gPSBnaXRMaW5lc09yTnVsbChbJy1DJywgcmVwb1Jvb3QsICdkaWZmJywgJy0tbmFtZS1vbmx5JywgJ0B7dX0uLkhFQUQnXSwgcmVwb1Jvb3QsIHRpbWVvdXRNcyk7XG4gICAgICBpZiAodXBzdHJlYW0gIT09IG51bGwpIHJldHVybiB1cHN0cmVhbTtcbiAgICAgIC8vIE5vIHVwc3RyZWFtIGNvbmZpZ3VyZWQ6IGZhbGwgYmFjayB0byB0aGUgbWVyZ2UtYmFzZSB3aXRoIHRoZSBkZWZhdWx0XG4gICAgICAvLyByZW1vdGUgYnJhbmNoIChgb3JpZ2luL0hFQURgKS4gSWYgdGhhdCB0b28gaXMgdW5yZXNvbHZhYmxlLCBmYWlsIG9wZW4uXG4gICAgICBjb25zdCBiYXNlID0gZ2l0TGluZXMoWyctQycsIHJlcG9Sb290LCAnbWVyZ2UtYmFzZScsICdIRUFEJywgJ29yaWdpbi9IRUFEJ10sIHJlcG9Sb290LCB0aW1lb3V0TXMpWzBdO1xuICAgICAgaWYgKCFiYXNlKSByZXR1cm4gW107XG4gICAgICByZXR1cm4gZ2l0TGluZXMoWyctQycsIHJlcG9Sb290LCAnZGlmZicsICctLW5hbWUtb25seScsIGAke2Jhc2V9Li5IRUFEYF0sIHJlcG9Sb290LCB0aW1lb3V0TXMpO1xuICAgIH1cbiAgfTtcbn1cblxuLyoqIFRoZSBwcm9kdWN0aW9uIHtAbGluayBHYXRlRXhlY3V0b3JzfTogc2NvcGVkIGBnaXQgc3BhbmAgZml4L3N0YWxlL2xpc3QgYXQgdGhlIHJlcG8gcm9vdC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0R2F0ZUV4ZWN1dG9ycyh0aW1lb3V0TXM6IG51bWJlciA9IERFRkFVTFRfVElNRU9VVF9NUyk6IEdhdGVFeGVjdXRvcnMge1xuICByZXR1cm4ge1xuICAgIGZpeDogYXN5bmMgKHBhdGhzLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290IHx8IHBhdGhzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICAgICAgdHJ5IHtcbiAgICAgICAgZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnc3RhbGUnLCAuLi5wYXRocywgJy0tZml4J10sIHtcbiAgICAgICAgICBjd2Q6IHJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBgZ2l0IHNwYW4gc3RhbGVgIGV4aXRzIDEgb24gZHJpZnQgZXZlbiBhZnRlciBoZWFsaW5nLCBhbmQgbm9uLXplcm8gb25cbiAgICAgICAgLy8gZ2VudWluZSBmYWlsdXJlOyBlaXRoZXIgd2F5IHRoZSBzdWJzZXF1ZW50IGBzdGFsZWAgcmVhZCBpcyB0aGUgc291cmNlXG4gICAgICAgIC8vIG9mIHRydXRoLCBzbyB0aGUgZXhpdCBjb2RlIGlzIGlnbm9yZWQgaGVyZS5cbiAgICAgIH1cbiAgICB9LFxuICAgIHN0YWxlOiBhc3luYyAocGF0aHMsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGlmICghcmVwb1Jvb3QgfHwgcGF0aHMubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gICAgICBsZXQgb3V0OiBzdHJpbmc7XG4gICAgICB0cnkge1xuICAgICAgICBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdzdGFsZScsICctLWZvcm1hdCcsICdwb3JjZWxhaW4nLCAuLi5wYXRoc10sIHtcbiAgICAgICAgICBjd2Q6IHJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBjb25zdCBjYXB0dXJlZCA9IChlcnIgYXMgeyBzdGRvdXQ/OiBzdHJpbmcgfSkuc3Rkb3V0O1xuICAgICAgICBpZiAodHlwZW9mIGNhcHR1cmVkID09PSAnc3RyaW5nJykgb3V0ID0gY2FwdHVyZWQ7XG4gICAgICAgIGVsc2UgcmV0dXJuIFtdO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHBhcnNlU3RhbGVQb3JjZWxhaW4ob3V0KTtcbiAgICB9LFxuICAgIGxpc3Q6IGFzeW5jIChwYXRocywgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCB8fCBwYXRocy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2xpc3QnLCAnLS1wb3JjZWxhaW4nLCAuLi5wYXRoc10sIHtcbiAgICAgICAgICBjd2Q6IHJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHBhcnNlUG9yY2VsYWluKG91dCk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgfVxuICAgIH1cbiAgfTtcbn1cblxuLyoqXG4gKiBUaGUgcHJvZHVjdGlvbiBkaXNrLWJhY2tlZCB7QGxpbmsgR2F0ZU1lbW9TdGF0ZX06IG9uZSBtYXJrZXIgZmlsZSBwZXIgZGVidC1zdGF0ZVxuICogZGlnZXN0IHVuZGVyIHtAbGluayBnYXRlTWVtb0Rpcn0gKGA8Z2l0LWNvbW1vbi1kaXI+L2dpdC1zcGFuL2dhdGUvYCksIGZvbGxvd2luZ1xuICogc3Bhbi1zdXJmYWNlLnRzJ3MgZmlsZS1iYWNrZWQgYE1lbW9TdG9yZWAgcGF0dGVybi4gVGhlIGRpZ2VzdCBpcyBhIGhleCBzaGEyNTYsXG4gKiBhIHNhZmUgZmlsZW5hbWUuIEJlc3QtZWZmb3J0IGFuZCBub24tdGhyb3dpbmc6IGEgbWVtbyB3aG9zZSByZXBvIGNhbm5vdCBiZVxuICogcmVzb2x2ZWQgZGVncmFkZXMgdG8gYSBuby1vcCBzdG9yZSAobmV2ZXIgcGVyc2lzdHMgXHUyMTkyIHVuY292ZXJlZCB3b3VsZCByZS1kZW55LFxuICogYnV0IGFuIHVucmVzb2x2YWJsZSByZXBvIHlpZWxkcyBhbiBlbXB0eSBjaGFuZ2VzZXQgdXBzdHJlYW0gYW55d2F5KS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURpc2tHYXRlTWVtb1N0YXRlKGN3ZDogc3RyaW5nKTogR2F0ZU1lbW9TdGF0ZSB7XG4gIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gIGlmICghcmVwb1Jvb3QpIHtcbiAgICByZXR1cm4geyBoYXM6ICgpID0+IGZhbHNlLCByZWNvcmQ6ICgpID0+IHt9IH07XG4gIH1cbiAgY29uc3QgZGlyID0gZ2F0ZU1lbW9EaXIocmVwb1Jvb3QpO1xuICByZXR1cm4ge1xuICAgIGhhczogKGRpZ2VzdCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGZzLmV4aXN0c1N5bmMobm9kZVBhdGguam9pbihkaXIsIGRpZ2VzdCkpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICB9LFxuICAgIHJlY29yZDogKGRpZ2VzdCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgZnMubWtkaXJTeW5jKGRpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgICAgIGZzLndyaXRlRmlsZVN5bmMobm9kZVBhdGguam9pbihkaXIsIGRpZ2VzdCksICcnKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBCZXN0LWVmZm9ydDogYSBmYWlsZWQgbWVtbyB3cml0ZSBtdXN0IG5ldmVyIGJyaWNrIHRoZSBjb21taXQuXG4gICAgICB9XG4gICAgfVxuICB9O1xufVxuIiwgIi8qKlxuICogU2hhcmVkIGhlbHBlcnMgdXNlZCBieSBtdWx0aXBsZSBhZ2VudC1ob29rcyBlbnRyeSBwb2ludHMuXG4gKlxuICogRXh0cmFjdGVkIGZyb20gcHJlLXRvb2wtdXNlLnRzIHNvIHRoYXQgdGhlIHVwY29taW5nIFN0b3AgaG9vayAoYW5kIGFueVxuICogZnV0dXJlIGhvb2tzKSBjYW4gaW1wb3J0IHBhdGggdXRpbGl0aWVzLCByYW5nZSBoZWxwZXJzLCBhbmQgdGhlXG4gKiBzYW5pdGl6ZVNlc3Npb25JZC9mb3JtYXRBbmNob3IgZnVuY3Rpb25zIHdpdGhvdXQgZGVwZW5kaW5nIG9uIHRoZVxuICogUHJlVG9vbFVzZS1zcGVjaWZpYyBtb2R1bGUuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgb3MgZnJvbSAnbm9kZTpvcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBhdGggaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiB0b1Bvc2l4KHA6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBwLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbn1cblxuZnVuY3Rpb24gaXNBYnNvbHV0ZVBvc2l4KHA6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gcC5zdGFydHNXaXRoKCcvJykgfHwgL15bQS1aYS16XTpcXC8vLnRlc3QocCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhYnNwYXRoQWdhaW5zdChiYXNlOiBzdHJpbmcsIHRhcmdldDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdCA9IHRvUG9zaXgodGFyZ2V0KTtcbiAgaWYgKGlzQWJzb2x1dGVQb3NpeCh0KSkgcmV0dXJuIHQ7XG4gIGNvbnN0IGIgPSB0b1Bvc2l4KGJhc2UpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICByZXR1cm4gYCR7Yn0vJHt0fWA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUmVwb1Jvb3QoZGlyOiBzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICghZGlyKSByZXR1cm4gbnVsbDtcbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCBkaXIsICdyZXYtcGFyc2UnLCAnLS1zaG93LXRvcGxldmVsJ10sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4J1xuICAgIH0pO1xuICAgIGNvbnN0IHRyaW1tZWQgPSBvdXQudHJpbSgpO1xuICAgIHJldHVybiB0cmltbWVkLmxlbmd0aCA+IDAgPyB0b1Bvc2l4KHRyaW1tZWQpIDogbnVsbDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqXG4gKiBSZXBvcnQgd2hldGhlciBhIHJlcG8tcmVsYXRpdmUgcGF0aCBpcyBleGNsdWRlZCBieSBnaXQncyBpZ25vcmUgcnVsZXNcbiAqICguZ2l0aWdub3JlLCAuZ2l0L2luZm8vZXhjbHVkZSwgY29yZS5leGNsdWRlc0ZpbGUpLiBVc2VkIHRvIGtlZXAgaWdub3JlZFxuICogZmlsZXMgXHUyMDE0IGJ1aWxkIG91dHB1dCwgY2FjaGVzLCBsb2dzIFx1MjAxNCBvdXQgb2YgdGhlIHRvdWNoIGpvdXJuYWwgZW50aXJlbHksIHNvXG4gKiB0aGUgU3RvcCBob29rIG5ldmVyIHJlcG9ydHMgcmVhZHMsIHdyaXRlcywgb3IgdW5jb3ZlcmVkIHdyaXRlcyBvbiB0aGVtLlxuICpcbiAqIGBnaXQgY2hlY2staWdub3JlIC1xIDxwYXRoPmAgZXhpdHMgMCB3aGVuIHRoZSBwYXRoIGlzIGlnbm9yZWQsIDEgd2hlbiBpdCBpc1xuICogbm90LCBhbmQgMTI4IG9uIGVycm9yLiBleGVjRmlsZVN5bmMgdGhyb3dzIG9uIGFueSBub24temVybyBleGl0LCBzbyBhIGNsZWFuXG4gKiByZXR1cm4gbWVhbnMgXCJpZ25vcmVkXCIuIEEgc3RhdHVzLTEgdGhyb3cgaXMgdGhlIGV4cGVjdGVkIFwibm90IGlnbm9yZWRcIlxuICogc2lnbmFsOyBhbnkgb3RoZXIgZmFpbHVyZSBpcyBhbiB1bnJlbGlhYmxlIGFuc3dlciwgc28gd2UgcmVwb3J0IGBmYWxzZWBcbiAqIChkbyBub3QgZHJvcCB0aGUgdG91Y2gpIHJhdGhlciB0aGFuIHNpbGVudGx5IGhpZGluZyBhIHRyYWNrZWQgZmlsZS5cbiAqL1xuLyoqXG4gKiBUaGUgZGVmYXVsdCBzcGFuIHJvb3QgZGlyZWN0b3J5LCByZWxhdGl2ZSB0byB0aGUgcmVwbyByb290LCB1c2VkIHdoZW4gbm9cbiAqIGVudmlyb25tZW50IHZhcmlhYmxlIG9yIGdpdCBjb25maWcgb3ZlcnJpZGVzIHRoZSBsb2NhdGlvbi5cbiAqL1xuZXhwb3J0IGNvbnN0IFNQQU5fUk9PVCA9ICcuc3Bhbic7XG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgc3BhbiByb290IGRpcmVjdG9yeSBmb3IgYSBnaXZlbiByZXBvLCBtaXJyb3JpbmcgdGhlIFJ1c3QgQ0xJXG4gKiBwcmVjZWRlbmNlIChtaW51cyB0aGUgLS1zcGFuLWRpciBDTEkgZmxhZywgd2hpY2ggaXMgaW52aXNpYmxlIHRvIGZpbGUtd3JpdGVcbiAqIGhvb2tzKTpcbiAqICAgMS4gR0lUX1NQQU5fRElSIGVudmlyb25tZW50IHZhcmlhYmxlXG4gKiAgIDIuIGBnaXQgY29uZmlnIGdpdC1zcGFuLmRpcmAgaW4gdGhlIHJlcG9cbiAqICAgMy4gRGVmYXVsdDogXCIuc3BhblwiXG4gKlxuICogVGhlIHJldHVybmVkIHZhbHVlIGlzIGEgUE9TSVgtc3R5bGUgcGF0aCB3aXRoIG5vIHRyYWlsaW5nIHNsYXNoLlxuICogRmFpbC1zYWZlOiBhbnkgcmVzb2x1dGlvbiBlcnJvciBmYWxscyBiYWNrIHRvIFwiLnNwYW5cIiBzbyB0aGUgaG9vayBuZXZlclxuICogY3Jhc2hlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgZW52RGlyID0gcHJvY2Vzcy5lbnZbJ0dJVF9TUEFOX0RJUiddO1xuICBpZiAoZW52RGlyICYmIGVudkRpci50cmltKCkubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiB0b1Bvc2l4KGVudkRpci50cmltKCkpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICB9XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdjb25maWcnLCAnZ2l0LXNwYW4uZGlyJ10sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4J1xuICAgIH0pO1xuICAgIGNvbnN0IHRyaW1tZWQgPSB0b1Bvc2l4KG91dC50cmltKCkpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICAgIGlmICh0cmltbWVkLmxlbmd0aCA+IDApIHJldHVybiB0cmltbWVkO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB2b2lkIGVycjsgLy8gY29uZmlnIGtleSBhYnNlbnQgb3IgZ2l0IGVycm9yIFx1MjAxNCBmYWxsIHRocm91Z2ggdG8gZGVmYXVsdFxuICB9XG4gIHJldHVybiBTUEFOX1JPT1Q7XG59XG5cbi8qKlxuICogUmVwb3J0IHdoZXRoZXIgYSByZXBvLXJlbGF0aXZlIFBPU0lYIHBhdGggZmFsbHMgaW5zaWRlIHRoZSBnaXZlbiBzcGFuIHJvb3RcbiAqIGRpcmVjdG9yeS4gQSBwYXRoIGlzIGluc2lkZSB3aGVuIGl0IGVxdWFscyB0aGUgc3BhbiByb290IGV4YWN0bHkgb3IgaXNcbiAqIG5lc3RlZCBiZW5lYXRoIGl0IChpLmUuIHN0YXJ0cyB3aXRoIFwiPHNwYW5Sb290Pi9cIikuIFRoZSBcIi9cIiBib3VuZGFyeSBwcmV2ZW50c1xuICogZmFsc2UgcG9zaXRpdmVzIGZvciBzaWJsaW5ncyBsaWtlIFwiLnNwYW5zL3hcIiBvciBcIi5zcGFuLW5vdGVzL3hcIi5cbiAqXG4gKiBQYXNzIHRoZSByZXN1bHQgb2YgYHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdClgIGFzIGBzcGFuUm9vdGAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0luc2lkZVNwYW5Sb290KHJlcG9SZWxQYXRoOiBzdHJpbmcsIHNwYW5Sb290OiBzdHJpbmcgPSBTUEFOX1JPT1QpOiBib29sZWFuIHtcbiAgY29uc3Qgcm9vdCA9IHNwYW5Sb290LnJlcGxhY2UoL1xcLyskLywgJycpO1xuICByZXR1cm4gcmVwb1JlbFBhdGggPT09IHJvb3QgfHwgcmVwb1JlbFBhdGguc3RhcnRzV2l0aChgJHtyb290fS9gKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzR2l0SWdub3JlZChyZXBvUm9vdDogc3RyaW5nLCByZXBvUmVsUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdjaGVjay1pZ25vcmUnLCAnLXEnLCAnLS0nLCByZXBvUmVsUGF0aF0sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdpZ25vcmUnLCAnaWdub3JlJ11cbiAgICB9KTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdm9pZCBlcnI7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdDogc3RyaW5nLCBhYnNQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCByb290ID0gdG9Qb3NpeChyZXBvUm9vdCk7XG4gIGNvbnN0IGFicyA9IHRvUG9zaXgoYWJzUGF0aCk7XG4gIGNvbnN0IHByZWZpeCA9IHJvb3QuZW5kc1dpdGgoJy8nKSA/IHJvb3QgOiBgJHtyb290fS9gO1xuICByZXR1cm4gYWJzLnN0YXJ0c1dpdGgocHJlZml4KSA/IGFicy5zbGljZShwcmVmaXgubGVuZ3RoKSA6IGFicztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNhbm9uaWNhbGl6ZVBhdGgoYWJzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gdG9Qb3NpeChmcy5yZWFscGF0aFN5bmMubmF0aXZlKGFic1BhdGgpKTtcbiAgfSBjYXRjaCB7XG4gICAgLy8gRmlsZSBkb2Vzbid0IGV4aXN0IHlldCAoZS5nLiBXcml0ZSB0byBhIG5ldyBmaWxlKTogY2Fub25pY2FsaXplIHRoZVxuICAgIC8vIGRpcmVjdG9yeSBhbmQgcmVqb2luIHRoZSBiYXNlbmFtZSBzbyBzeW1saW5rcyBpbiB0aGUgcGFyZW50IGFyZSByZXNvbHZlZC5cbiAgICB0cnkge1xuICAgICAgY29uc3QgZGlyID0gdG9Qb3NpeChmcy5yZWFscGF0aFN5bmMubmF0aXZlKG5vZGVQYXRoLmRpcm5hbWUoYWJzUGF0aCkpKTtcbiAgICAgIHJldHVybiBgJHtkaXJ9LyR7bm9kZVBhdGguYmFzZW5hbWUoYWJzUGF0aCl9YDtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFBhcmVudCBkb2Vzbid0IGV4aXN0IGVpdGhlcjsgZmFsbCBiYWNrIHRvIHRoZSB1bi1jYW5vbmljYWxpemVkIHBhdGguXG4gICAgICByZXR1cm4gYWJzUGF0aDtcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGRlcml2ZVBhdGgodG9vbElucHV0OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwgY3dkOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3QgZnAgPSB0b29sSW5wdXQuZmlsZV9wYXRoO1xuICBpZiAodHlwZW9mIGZwICE9PSAnc3RyaW5nJyB8fCBmcC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBjb25zdCBhYnMgPSBhYnNwYXRoQWdhaW5zdChjd2QsIGZwKTtcbiAgcmV0dXJuIGNhbm9uaWNhbGl6ZVBhdGgoYWJzKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBMaW5lIHJhbmdlIHR5cGVzIGFuZCBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBMaW5lUmFuZ2Uge1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJhbmdlc0ludGVyc2VjdChhOiBMaW5lUmFuZ2UsIGI6IExpbmVSYW5nZSk6IGJvb2xlYW4ge1xuICByZXR1cm4gYS5zdGFydCA8PSBiLmVuZCAmJiBhLmVuZCA+PSBiLnN0YXJ0O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBvcmNlbGFpbiByb3cgcGFyc2luZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgUG9yY2VsYWluUm93IHtcbiAgbmFtZTogc3RyaW5nO1xuICBwYXRoOiBzdHJpbmc7XG4gIHN0YXJ0OiBudW1iZXI7XG4gIGVuZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VQb3JjZWxhaW4oc3Rkb3V0OiBzdHJpbmcpOiBQb3JjZWxhaW5Sb3dbXSB7XG4gIGNvbnN0IHJvd3M6IFBvcmNlbGFpblJvd1tdID0gW107XG4gIGZvciAoY29uc3QgbGluZSBvZiBzdGRvdXQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCkgY29udGludWU7XG4gICAgY29uc3QgcGFydHMgPSB0cmltbWVkLnNwbGl0KCdcXHQnKTtcbiAgICBpZiAocGFydHMubGVuZ3RoIDwgMykgY29udGludWU7XG4gICAgY29uc3QgW25hbWUsIHBhdGgsIHJhbmdlXSA9IHBhcnRzO1xuICAgIGNvbnN0IGRhc2hJZHggPSByYW5nZS5pbmRleE9mKCctJyk7XG4gICAgaWYgKGRhc2hJZHggPT09IC0xKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IHBhcnNlSW50KHJhbmdlLnNsaWNlKDAsIGRhc2hJZHgpLCAxMCk7XG4gICAgY29uc3QgZW5kID0gcGFyc2VJbnQocmFuZ2Uuc2xpY2UoZGFzaElkeCArIDEpLCAxMCk7XG4gICAgaWYgKE51bWJlci5pc05hTihzdGFydCkgfHwgTnVtYmVyLmlzTmFOKGVuZCkpIGNvbnRpbnVlO1xuICAgIHJvd3MucHVzaCh7IG5hbWUsIHBhdGgsIHN0YXJ0LCBlbmQgfSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8qKlxuICogVGhlIGZ1bGwgYGdpdCBzcGFuIHN0YWxlIC0tZm9ybWF0IHBvcmNlbGFpbmAgc3RhdHVzIHRva2VuIHZvY2FidWxhcnkgKHRoZVxuICogZ2l0LXNwYW4gQ0xJJ3MgcG9yY2VsYWluIGNvbnRyYWN0KTogYEZSRVNIYC9gTU9WRURgL2BSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGBcbiAqIGFyZSBwb3NpdGlvbmFsLW9yLWNsZWFuIGFuZCBuZXZlciBkZWJ0OyBldmVyeSBvdGhlciB0b2tlbiBpcyBzZW1hbnRpYyBkcmlmdFxuICogb3IgYSB0ZXJtaW5hbC9lcnJvciBjb25kaXRpb24gYW5kIGlzIGRlYnQuIFNlZSB7QGxpbmsgaXNEZWJ0fSBmb3IgdGhlXG4gKiBzaW5nbGUgc291cmNlIG9mIHRydXRoIG9uIHRoYXQgc3BsaXQuXG4gKi9cbmV4cG9ydCBjb25zdCBQT1JDRUxBSU5fU1RBVFVTRVMgPSBbXG4gICdGUkVTSCcsXG4gICdSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCcsXG4gICdNT1ZFRCcsXG4gICdDSEFOR0VEJyxcbiAgJ0RFTEVURUQnLFxuICAnQ09ORkxJQ1QnLFxuICAnU1VCTU9EVUxFJyxcbiAgJ0xGU19OT1RfRkVUQ0hFRCcsXG4gICdMRlNfTk9UX0lOU1RBTExFRCcsXG4gICdQUk9NSVNPUl9NSVNTSU5HJyxcbiAgJ1NQQVJTRV9FWENMVURFRCcsXG4gICdGSUxURVJfRkFJTEVEJyxcbiAgJ0lPX0VSUk9SJ1xuXSBhcyBjb25zdDtcblxuZXhwb3J0IHR5cGUgUG9yY2VsYWluU3RhdHVzID0gKHR5cGVvZiBQT1JDRUxBSU5fU1RBVFVTRVMpW251bWJlcl07XG5cbmNvbnN0IFBPUkNFTEFJTl9TVEFUVVNfU0VUOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChQT1JDRUxBSU5fU1RBVFVTRVMpO1xuXG5mdW5jdGlvbiBwYXJzZVBvcmNlbGFpblN0YXR1cyhyYXc6IHN0cmluZyk6IFBvcmNlbGFpblN0YXR1cyB8IG51bGwge1xuICByZXR1cm4gUE9SQ0VMQUlOX1NUQVRVU19TRVQuaGFzKHJhdykgPyAocmF3IGFzIFBvcmNlbGFpblN0YXR1cykgOiBudWxsO1xufVxuXG4vKiogQSBgcGFyc2VTdGFsZVBvcmNlbGFpbmAgcm93OiBhIHtAbGluayBQb3JjZWxhaW5Sb3d9IHBsdXMgaXRzIHN0YXR1cyB0b2tlbi4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3RhbGVQb3JjZWxhaW5Sb3cgZXh0ZW5kcyBQb3JjZWxhaW5Sb3cge1xuICBzdGF0dXM6IFBvcmNlbGFpblN0YXR1cztcbn1cblxuLyoqXG4gKiBUaGUgZGVidCBpbnZhcmlhbnQgKHN5c3RlbS13aWRlOyBjb25zdW1lZCBieSBib3RoIHRoZSBmdXR1cmUgdG91Y2gtY29yZSBhbmRcbiAqIGdhdGUtY29yZSk6IG9ubHkgc2VtYW50aWMgc3RhdHVzZXMgYXJlIGRlYnQuIGBDSEFOR0VEYCBhbmQgYERFTEVURURgIGFyZVxuICogc2VtYW50aWMgZHJpZnQ7IHRoZSByZW1haW5pbmcgbm9uLUZSRVNIL01PVkVEL1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUIHRva2Vuc1xuICogYXJlIHRlcm1pbmFsL2Vycm9yIGNvbmRpdGlvbnMgYW5kIGFyZSB0cmVhdGVkIGFzIGRlYnQgdG9vICh0aGV5IGJsb2NrIG9uXG4gKiB0aGVpciBvd24gbWVyaXRzIFx1MjAxNCB0aGUgQ0xJIGNvdWxkIG5vdCByZXNvbHZlIHRoZSBhbmNob3IgYXQgYWxsKS4gYEZSRVNIYCxcbiAqIGBNT1ZFRGAsIGFuZCBgUkVTT0xWRURfUEVORElOR19DT01NSVRgIGFyZSBuZXZlciBkZWJ0OiBwb3NpdGlvbmFsIGRyaWZ0IHRoZVxuICogQ0xJIGNhbiBoZWFsIChvciBhbHJlYWR5IGhhcykgaXMgaW52aXNpYmxlLCBhbmQgYSBwZW5kaW5nLWNvbW1pdCByZXNvbHV0aW9uXG4gKiBpcyBub3Qgb3V0c3RhbmRpbmcgZGVidC5cbiAqXG4gKiBOb3RlOiB0aGUgcG9yY2VsYWluIHZvY2FidWxhcnkgZG9lcyBub3QgY3VycmVudGx5IGRpc3Rpbmd1aXNoXG4gKiBjb250ZW50LWVxdWl2YWxlbnQgYENIQU5HRURgIChlLmcuIHdoaXRlc3BhY2Utb25seSBkcmlmdCBgLS1maXhgIGNhbiBoZWFsKVxuICogZnJvbSBnZW51aW5lbHkgc2VtYW50aWMgYENIQU5HRURgIFx1MjAxNCB0aGF0IGNsYXNzaWZpY2F0aW9uIGlzIG5vdCBwcmVzZW50IGluXG4gKiBgZ2l0IHNwYW4gc3RhbGUgLS1mb3JtYXQgcG9yY2VsYWluYCBvdXRwdXQgdG9kYXkuIFVudGlsIHRoZSBDTEkgZXhwb3NlcyBpdCxcbiAqIGV2ZXJ5IGBDSEFOR0VEYCByb3cgaXMgdHJlYXRlZCBhcyBkZWJ0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNEZWJ0KHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogYm9vbGVhbiB7XG4gIHN3aXRjaCAoc3RhdHVzKSB7XG4gICAgY2FzZSAnRlJFU0gnOlxuICAgIGNhc2UgJ01PVkVEJzpcbiAgICBjYXNlICdSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCc6XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiB0cnVlO1xuICB9XG59XG5cbi8qKlxuICogYGdpdCBzcGFuIHN0YWxlIC0tZm9ybWF0IHBvcmNlbGFpbmAgZW1pdHMgYSBkaWZmZXJlbnQgc2hhcGUgdGhhblxuICogYGxpc3QgLS1wb3JjZWxhaW5gOiBhIGAjIHBvcmNlbGFpbiB2MmAgaGVhZGVyLCBgIyBmdXp6eSBOYCBjb21tZW50IGxpbmVzLFxuICogYW5kIG9uZSBgPHN0YXR1cz5cXHQ8c3JjPlxcdDxuYW1lPlxcdDxwYXRoPlxcdDxzdGFydD5cXHQ8ZW5kPmAgcm93IHBlciBkcmlmdGVkXG4gKiBhbmNob3IgKHdob2xlLWZpbGUgYW5jaG9ycyBjYXJyeSBgKHdob2xlKWAvYC1gIGluIHBsYWNlIG9mIHRoZSBsaW5lIGNvbHVtbnMpLlxuICogUm93cyB3aG9zZSBzdGF0dXMgdG9rZW4gaXMgbm90IGluIHtAbGluayBQT1JDRUxBSU5fU1RBVFVTRVN9IGFyZSBza2lwcGVkIFx1MjAxNFxuICogYW4gdW5yZWNvZ25pemVkIHRva2VuIGZyb20gYSBuZXdlciBDTEkgaXMgdHJlYXRlZCB0aGUgc2FtZSBhcyBhIG1hbGZvcm1lZFxuICogbGluZSByYXRoZXIgdGhhbiBndWVzc2VkIGF0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VTdGFsZVBvcmNlbGFpbihzdGRvdXQ6IHN0cmluZyk6IFN0YWxlUG9yY2VsYWluUm93W10ge1xuICBjb25zdCByb3dzOiBTdGFsZVBvcmNlbGFpblJvd1tdID0gW107XG4gIGZvciAoY29uc3QgbGluZSBvZiBzdGRvdXQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCB8fCB0cmltbWVkLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgY29uc3QgcGFydHMgPSB0cmltbWVkLnNwbGl0KCdcXHQnKTtcbiAgICBpZiAocGFydHMubGVuZ3RoIDwgNikgY29udGludWU7XG4gICAgY29uc3QgW3N0YXR1c0NvbCwgLCBuYW1lLCBwYXRoLCBzdGFydENvbCwgZW5kQ29sXSA9IHBhcnRzO1xuICAgIGNvbnN0IHN0YXR1cyA9IHBhcnNlUG9yY2VsYWluU3RhdHVzKHN0YXR1c0NvbCk7XG4gICAgaWYgKCFzdGF0dXMpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHN0YXJ0ID0gc3RhcnRDb2wgPT09ICcod2hvbGUpJyA/IDAgOiBwYXJzZUludChzdGFydENvbCwgMTApO1xuICAgIGNvbnN0IGVuZCA9IGVuZENvbCA9PT0gJy0nID8gMCA6IHBhcnNlSW50KGVuZENvbCwgMTApO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpIHx8IE51bWJlci5pc05hTihlbmQpKSBjb250aW51ZTtcbiAgICByb3dzLnB1c2goeyBuYW1lLCBwYXRoLCBzdGFydCwgZW5kLCBzdGF0dXMgfSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2Vzc2lvbiBJRCBzYW5pdGl6YXRpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIEluamVjdGl2ZSB0cmFuc2Zvcm06IHBlcmNlbnQtZW5jb2RlIGJ5dGVzIG91dHNpZGUgW0EtWmEtejAtOS5fLV0gYXMgJUhIXG4gKiAodXBwZXJjYXNlIGhleCkuIFVzZWQgdG8gcHJvZHVjZSBzYWZlIGZpbGVuYW1lcyBmcm9tIGFyYml0cmFyeSBzZXNzaW9uIGlkcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplU2Vzc2lvbklkKHNlc3Npb25JZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHNlc3Npb25JZC5yZXBsYWNlKC9bXkEtWmEtejAtOS5fLV0vZywgKGNoKSA9PiB7XG4gICAgcmV0dXJuIGAlJHtjaC5jaGFyQ29kZUF0KDApLnRvU3RyaW5nKDE2KS50b1VwcGVyQ2FzZSgpLnBhZFN0YXJ0KDIsICcwJyl9YDtcbiAgfSk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUGVyLXNlc3Npb24gYmFzZSBkaXJlY3Rvcnlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vLyBCYXNlIGRpciBzaGFyZWQgYnkgYWxsIHBlci1zZXNzaW9uIHN0YXRlOiBjdXJyZW50bHkganVzdCB0aGUgdG91Y2gtaG9va1xuLy8gc2Vzc2lvbiBtZW1vIChzcGFuLXN1cmZhY2UudHMncyBNZW1vU3RvcmUpLiBFYWNoIHNlc3Npb24gZ2V0cyBvbmVcbi8vIHN1YmRpcmVjdG9yeSBrZXllZCBieSBpdHMgc2FuaXRpemVkIGlkLCBzbyBldmVyeSB3cml0ZXIvcmVhZGVyIGZvciBhIGdpdmVuXG4vLyBzZXNzaW9uIGFncmVlcyBvbiBpdHMgbG9jYXRpb24uXG5leHBvcnQgY29uc3QgU0VTU0lPTl9CQVNFX0RJUiA9IG5vZGVQYXRoLmpvaW4ob3MuaG9tZWRpcigpLCAnLmNhY2hlJywgJ2dpdC1zcGFuJywgJ3Nlc3Npb24nKTtcblxuLyoqIFRoZSBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcnkgZm9yIGEgZ2l2ZW4gc2Vzc2lvbiBpZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uRGlyKHNlc3Npb25JZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4oU0VTU0lPTl9CQVNFX0RJUiwgc2FuaXRpemVTZXNzaW9uSWQoc2Vzc2lvbklkKSk7XG59XG5cbmNvbnN0IFRISVJUWV9EQVlTX01TID0gMzAgKiAyNCAqIDYwICogNjAgKiAxMDAwO1xuXG4vKipcbiAqIE9wcG9ydHVuaXN0aWNhbGx5IHBydW5lIHBlci1zZXNzaW9uIHN0YXRlIGRpcmVjdG9yaWVzIHVuZGVyXG4gKiB7QGxpbmsgU0VTU0lPTl9CQVNFX0RJUn0gd2hvc2UgbXRpbWUgaXMgb2xkZXIgdGhhbiBgbWF4QWdlTXNgIChkZWZhdWx0IDMwXG4gKiBkYXlzKS4gQSBkaXJlY3RvcnkncyBtdGltZSBhZHZhbmNlcyB3aGVuZXZlciBhbiBlbnRyeSBpbnNpZGUgaXQgaXNcbiAqIGNyZWF0ZWQvcmVuYW1lZC9yZW1vdmVkLCBzbyBhbiBhY3RpdmUgc2Vzc2lvbiAobWVtbyB3cml0ZXMpIHN0YXlzIGZyZXNoO1xuICogb25seSBnZW51aW5lbHkgYWJhbmRvbmVkIHNlc3Npb25zIGFnZSBvdXQuXG4gKlxuICogQmVzdC1lZmZvcnQgYW5kIG5vbi10aHJvd2luZzogY2FsbGVkIG9wcG9ydHVuaXN0aWNhbGx5IGZyb20gaG9vayByZWFkL3dyaXRlXG4gKiBwYXRocywgbm90IGEgc2VwYXJhdGUgY3Jvbi1saWtlIG1lY2hhbmlzbSwgc28gYSBmYWlsdXJlIGhlcmUgbXVzdCBuZXZlclxuICogYmxvY2sgdGhlIGNhbGxlcidzIGFjdHVhbCB3b3JrLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcHJ1bmVTdGFsZVNlc3Npb25zKG5vdzogbnVtYmVyID0gRGF0ZS5ub3coKSwgbWF4QWdlTXM6IG51bWJlciA9IFRISVJUWV9EQVlTX01TKTogdm9pZCB7XG4gIGxldCBlbnRyaWVzOiBmcy5EaXJlbnRbXTtcbiAgdHJ5IHtcbiAgICBlbnRyaWVzID0gZnMucmVhZGRpclN5bmMoU0VTU0lPTl9CQVNFX0RJUiwgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm47IC8vIGJhc2UgZGlyIGFic2VudCBvciB1bnJlYWRhYmxlIFx1MjAxNCBub3RoaW5nIHRvIHBydW5lXG4gIH1cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSB7XG4gICAgaWYgKCFlbnRyeS5pc0RpcmVjdG9yeSgpKSBjb250aW51ZTtcbiAgICBjb25zdCBkaXJQYXRoID0gbm9kZVBhdGguam9pbihTRVNTSU9OX0JBU0VfRElSLCBlbnRyeS5uYW1lKTtcbiAgICB0cnkge1xuICAgICAgY29uc3Qgc3RhdCA9IGZzLnN0YXRTeW5jKGRpclBhdGgpO1xuICAgICAgaWYgKG5vdyAtIHN0YXQubXRpbWVNcyA+IG1heEFnZU1zKSB7XG4gICAgICAgIGZzLnJtU3luYyhkaXJQYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XG4gICAgICB9XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBWYW5pc2hlZCBiZXR3ZWVuIHJlYWRkaXIgYW5kIHN0YXQsIG9yIHJlbW92YWwgZmFpbGVkIFx1MjAxNCBza2lwIGl0LiBBXG4gICAgICAvLyBiZXN0LWVmZm9ydCBwcnVuZSBtdXN0IG5ldmVyIHRocm93IGludG8gdGhlIGNhbGxlcidzIGhvdCBwYXRoLlxuICAgIH1cbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIGtpbmQgYW5kIGFuY2hvciBmb3JtYXR0aW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IHR5cGUgVG91Y2hLaW5kID0gJ3JlYWQnIHwgJ3dyaXRlJyB8ICd3aG9sZS1yZWFkJyB8ICd3aG9sZS13cml0ZScgfCAnY3JlYXRlJztcblxuLyoqXG4gKiBGb3JtYXQgYSBzcGFuIGFuY2hvciBzdHJpbmcuXG4gKlxuICogLSBgd2hvbGUtcmVhZGAsIGB3aG9sZS13cml0ZWAsIGFuZCBgY3JlYXRlYDogcmV0dXJucyBqdXN0IHRoZSBwYXRoXG4gKiAtIGByZWFkYCBhbmQgYHdyaXRlYDogcmV0dXJucyBgcGF0aCNMPHN0YXJ0Pi1MPGVuZD5gIChyZXF1aXJlcyByYW5nZSlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEFuY2hvcihwYXRoOiBzdHJpbmcsIGtpbmQ6IFRvdWNoS2luZCwgcmFuZ2U/OiBMaW5lUmFuZ2UpOiBzdHJpbmcge1xuICBpZiAoKGtpbmQgPT09ICdyZWFkJyB8fCBraW5kID09PSAnd3JpdGUnKSAmJiByYW5nZSkge1xuICAgIHJldHVybiBgJHtwYXRofSNMJHtyYW5nZS5zdGFydH0tTCR7cmFuZ2UuZW5kfWA7XG4gIH1cbiAgcmV0dXJuIHBhdGg7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQW5jaG9yIHNwZWMgdHlwZVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgQW5jaG9yU3BlYyB7XG4gIHBhdGg6IHN0cmluZztcbiAga2luZDogVG91Y2hLaW5kO1xuICByYW5nZT86IExpbmVSYW5nZTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBRdWV1ZSBkaXJlY3RvcnkgaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgZ2l0IGNvbW1vbiBkaXJlY3RvcnkgZm9yIHRoZSBnaXZlbiByZXBvIHJvb3QuXG4gKiBUaGlzIGlzIHRoZSBzaGFyZWQgZGlyZWN0b3J5IChub3QgdGhlIHdvcmt0cmVlLXNwZWNpZmljIC5naXQpLCBzbyBxdWV1ZVxuICogcmVjb3JkcyBzdXJ2aXZlIHdvcmt0cmVlIGRlbGV0aW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUdpdENvbW1vbkRpcihyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdyZXYtcGFyc2UnLCAnLS1naXQtY29tbW9uLWRpciddLCB7XG4gICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgZW5jb2Rpbmc6ICd1dGY4J1xuICB9KTtcbiAgY29uc3QgdHJpbW1lZCA9IHRvUG9zaXgob3V0LnRyaW0oKSk7XG4gIC8vIGdpdCByZXR1cm5zIGEgcmVsYXRpdmUgcGF0aCAoZS5nLiBcIi5naXRcIikgZm9yIHNpbXBsZSByZXBvcy4gUmVzb2x2ZSBpdFxuICAvLyBhZ2FpbnN0IHJlcG9Sb290IHNvIGNhbGxlcnMgbmV2ZXIgZGVwZW5kIG9uIHByb2Nlc3MuY3dkKCkuXG4gIGlmICghbm9kZVBhdGguaXNBYnNvbHV0ZSh0cmltbWVkKSkge1xuICAgIHJldHVybiB0b1Bvc2l4KG5vZGVQYXRoLnJlc29sdmUocmVwb1Jvb3QsIHRyaW1tZWQpKTtcbiAgfVxuICByZXR1cm4gdHJpbW1lZDtcbn1cblxuLyoqXG4gKiBSb290IG9mIHRoZSBnaXQtc3BhbiBxdWV1ZSBkaXJlY3RvcnkgdHJlZSwgdW5kZXIgdGhlIGdpdCBjb21tb24gZGlyLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcXVldWVSb290KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihyZXNvbHZlR2l0Q29tbW9uRGlyKHJlcG9Sb290KSwgJ2dpdC1zcGFuJyk7XG59XG5cbi8qKlxuICogRGlyZWN0b3J5IGZvciB0aGUgZ2F0ZSdzIHBlci1jaGFuZ2VzZXQgc3RhdGUgbWVtb3MgKGRpZ2VzdCBvZiBzb3J0ZWRcbiAqIGZpbmRpbmdzICsgdW5jb3ZlcmVkIHBhdGhzKSwgdW5kZXIgdGhlIGdpdCBjb21tb24gZGlyIHNvIGl0IGlzIHNoYXJlZFxuICogYWNyb3NzIHdvcmt0cmVlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdhdGVNZW1vRGlyKHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihxdWV1ZVJvb3QocmVwb1Jvb3QpLCAnZ2F0ZScpO1xufVxuIiwgIi8qKlxuICogQ29kZXggUHJlVG9vbFVzZSBnYXRlIGhvb2sgXHUyMDE0IGhvbGQgYGdpdCBjb21taXRgL2BnaXQgcHVzaGAgb24gcmVhbCBzcGFuIGRlYnQuXG4gKlxuICogVGhlIENvZGV4IHR3aW4gb2YgW2NsYXVkZS9nYXRlLnRzXSguL3BhY2thZ2VzL2FnZW50LWhvb2tzL3NyYy9jbGF1ZGUvZ2F0ZS50cyk6XG4gKiBzYW1lIHNoYXJlZCBnYXRlLWNvcmUgcGlwZWxpbmUgKHtAbGluayBwYXJzZUdpdENvbW1hbmR9IFx1MjE5MiB7QGxpbmsgcmVzb2x2ZUNoYW5nZXNldH1cbiAqIFx1MjE5MiB7QGxpbmsgZXZhbHVhdGVHYXRlfSksIHRyYW5zbGF0ZWQgaW50byBDb2RleCdzIFByZVRvb2xVc2Ugb3V0cHV0IHNoYXBlLiBDb2RleFxuICogZGVsaXZlcnMgYSBzaGVsbCBjb21tYW5kIGFzIGFuIFNESy10eXBlZCBgdW5rbm93bmAgYHRvb2xfaW5wdXRgOyB0aGlzIGhhbmRsZXJcbiAqIG5hcnJvd3MgaXQgKHN0cmluZywgb3IgYSBgW1wiYmFzaFwiLFwiLWxjXCIsXCI8c2NyaXB0PlwiXWAvYXJndiBhcnJheSkgaW50byB0aGVcbiAqIGNvbW1hbmQgc3RyaW5nIHRoZSBjb3JlIHBhcnNlcy5cbiAqXG4gKiBcdTI1MDBcdTI1MDAgVW5jb25maXJtZWQgZGVueSAoc2VlIG5vdGVzL2NvZGV4LWRlbnktc3Bpa2UubWQpIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICogV2hldGhlciBDb2RleCdzIGBwZXJtaXNzaW9uRGVjaXNpb246ICdkZW55J2AgYWN0dWFsbHkgKmJsb2NrcyogdGhlIHNoZWxsIHRvb2xcbiAqIGxpdmUgd2FzIG5ldmVyIGNvbmZpcm1lZCBpbiB0aGlzIHJlcG86IHRoZSBQaGFzZSAwIHNwaWtlIGNvdWxkIG5vdCBnZXQgYVxuICogZnJvbS1zY3JhdGNoIHBsdWdpbiB0byBsb2FkLCBzbyB0aGUgZGVueSBwYXRoIHdhcyBuZXZlciBleGVyY2lzZWQgZW5kLXRvLWVuZC5cbiAqIFRoZSBvbmx5IHBvc2l0aXZlIGV2aWRlbmNlIGlzIGRvY3VtZW50YXJ5IFx1MjAxNCB0aGUgYEBnb29kZm9vdC9jb2RleC1ob29rc2AgUkVBRE1FXG4gKiAodGhlIGV4YWN0IHZlcnNpb24gdGhpcyByZXBvIGRlcGVuZHMgb24pIHNoaXBzIGEgd29ya2VkIGBwZXJtaXNzaW9uRGVjaXNpb246XG4gKiAnZGVueSdgIGV4YW1wbGUgbWF0Y2hlZCBvbiBgXCJCYXNoXCJgLiBUaGlzIGFkYXB0ZXIgdGhlcmVmb3JlIHNoaXBzIHRoZSBoYXJkLWRlbnlcbiAqIHBhdGggcGVyIHRoYXQgUkVBRE1FICh7QGxpbmsgQ09ERVhfR0FURV9IQVJEX0RFTll9ID0gYHRydWVgKSwgYnV0IGtlZXBzIHRoZVxuICogQ0FSRC5tZC1kb2N1bWVudGVkIGZhbGxiYWNrIFx1MjAxNCBhIGxvdWQgYGFkZGl0aW9uYWxDb250ZXh0YCB3YXJuaW5nIHRoYXQgYWxsb3dzXG4gKiB0aGUgY29tbWFuZCwgd2l0aCB0aGUgQ0kgcmVjaXBlIGFzIENvZGV4J3MgZW5mb3JjZW1lbnQgYmFja3N0b3AgXHUyMDE0IGFzIGEgY2xlYXJseVxuICogc2VwYXJhYmxlIGJyYW5jaCBiZWhpbmQgdGhhdCBvbmUgY29uc3RhbnQuIElmIGEgbGl2ZSBzZXNzaW9uIHNob3dzIGRlbnkgZG9lc1xuICogbm90IGZpcmUsIGZsaXAge0BsaW5rIENPREVYX0dBVEVfSEFSRF9ERU5ZfSB0byBgZmFsc2VgOyBub3RoaW5nIGVsc2UgY2hhbmdlcy5cbiAqXG4gKiBUaGUgc2hlbGwgdG9vbCdzIGV4YWN0IGB0b29sX25hbWVgIGlzIGxpa2V3aXNlIHVuY29uZmlybWVkICh0aGUgUkVBRE1FJ3NcbiAqIGV4YW1wbGUgdXNlcyBgXCJCYXNoXCJgOyBDb2RleCBDTEkgdHJhbnNjcmlwdHMgaW4gdGhlIHNwaWtlIGxhYmVsZWQgdGhlIGNhbGxcbiAqIGBleGVjYCkuIFRoZSByZWdpc3RyYXRpb24gbWF0Y2hlciBpcyBicm9hZGVuZWQgdG8gdGhlIHBsYXVzaWJsZSBuYW1lcyBzbyB0aGVcbiAqIGhvb2sgYWN0dWFsbHkgZmlyZXMsIGFuZCBldmVyeSBmaXJlIGxvZ3MgdGhlIG9ic2VydmVkIGB0b29sX25hbWVgIHNvIHRoZSBmaXJzdFxuICogbGl2ZSBydW4gcmV2ZWFscyB0aGUgbGl0ZXJhbCBzdHJpbmcgdG8gbmFycm93IHRoZSBtYXRjaGVyIHRvLlxuICpcbiAqIEZhaWwtb3BlbiBhdCBldmVyeSBsYXllcjogZ2F0ZS1jb3JlIHJlc29sdmVzIGludGVybmFsIGVycm9ycyB0byBhbGxvdywgYW5kIHRoaXNcbiAqIGFkYXB0ZXIgd3JhcHMgdGhlIHdob2xlIHBhdGggaW4gYSB0cnkvY2F0Y2ggdGhhdCBhbGxvd3MtYW5kLWxvZ3MgXHUyMDE0IHRoZSBnYXRlXG4gKiBtdXN0IG5ldmVyIGJyaWNrIGEgY29tbWl0LiBUaGUgdGltZW91dCBpcyBtaWxsaXNlY29uZHMgaGVyZSAodGhlIENvZGV4IENMSVxuICogZGl2aWRlcyB0byBzZWNvbmRzIGF0IGVtaXQpLlxuICovXG5cbmltcG9ydCB7IHR5cGUgSG9va0NvbnRleHQsIHR5cGUgUHJlVG9vbFVzZUlucHV0LCBwcmVUb29sVXNlSG9vaywgcHJlVG9vbFVzZU91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jb2RleC1ob29rcyc7XG5pbXBvcnQge1xuICBjb21taXRTdGFnZXNBbGwsXG4gIGNyZWF0ZURlZmF1bHRHYXRlRXhlY3V0b3JzLFxuICBjcmVhdGVEZWZhdWx0R2l0RXhlY3V0b3IsXG4gIGNyZWF0ZURpc2tHYXRlTWVtb1N0YXRlLFxuICBldmFsdWF0ZUdhdGUsXG4gIHR5cGUgR2F0ZUV4ZWN1dG9ycyxcbiAgdHlwZSBHYXRlTWVtb1N0YXRlLFxuICB0eXBlIEdpdEV4ZWN1dG9yLFxuICBpc0dhdGVTa2lwcGVkLFxuICBwYXJzZUdpdENvbW1hbmQsXG4gIHJlc29sdmVDaGFuZ2VzZXRcbn0gZnJvbSAnLi4vY29tbW9uL2dhdGUtY29yZS5qcyc7XG5cbi8qKlxuICogV2hldGhlciBDb2RleCdzIGBwZXJtaXNzaW9uRGVjaXNpb246ICdkZW55J2AgaXMgdHJ1c3RlZCB0byBibG9jayB0aGUgc2hlbGwgdG9vbFxuICogbGl2ZS4gU2hpcHMgYHRydWVgIChoYXJkIGRlbnkpIHBlciB0aGUgYEBnb29kZm9vdC9jb2RleC1ob29rc2AgUkVBRE1FJ3Mgd29ya2VkXG4gKiBleGFtcGxlLiBGbGlwIHRvIGBmYWxzZWAgdG8gYWN0aXZhdGUgdGhlIENBUkQubWQtZG9jdW1lbnRlZCBmYWxsYmFjayBpZiBhIGxpdmVcbiAqIHNlc3Npb24gc2hvd3MgZGVueSBkb2VzIG5vdCBmaXJlIFx1MjAxNCBzZWUgbm90ZXMvY29kZXgtZGVueS1zcGlrZS5tZCBhbmQgdGhpc1xuICogZmlsZSdzIGhlYWRlci4gVGhpcyBpcyB0aGUgc2luZ2xlIHN3aXRjaCB0aGF0IHNlcGFyYXRlcyB0aGUgdHdvIGNvZGUgcGF0aHMuXG4gKi9cbmNvbnN0IENPREVYX0dBVEVfSEFSRF9ERU5ZID0gdHJ1ZTtcblxuLyoqIFRoZSBgc3lzdGVtTWVzc2FnZWAgc2hvd24gd2hlbiBhIGdhdGVkIGNvbW1hbmQgcnVucyB1bmRlciBgR0lUX1NQQU5fR0FURT1za2lwYC4gKi9cbmNvbnN0IFNLSVBfTk9USUNFID0gJ2dpdC1zcGFuIGdhdGUgYnlwYXNzZWQgKEdJVF9TUEFOX0dBVEU9c2tpcCkgXHUyMDE0IHNwYW4gZGVidCBpcyBub3QgYmVpbmcgY2hlY2tlZCBmb3IgdGhpcyBjb21tYW5kLic7XG5cbi8qKlxuICogTmFycm93IENvZGV4J3MgYHVua25vd25gIHNoZWxsIGB0b29sX2lucHV0YCBpbnRvIHRoZSBjb21tYW5kIHN0cmluZyB0aGUgY29yZVxuICogcGFyc2VzLiBIYW5kbGVzIGEgYmFyZSBgY29tbWFuZGAgc3RyaW5nLCBhIHNoZWxsLXdyYXBwZXIgYXJndlxuICogKGBbXCJiYXNoXCIsXCItbGNcIixcIjxzY3JpcHQ+XCJdYCBcdTIxOTIgdGhlIHNjcmlwdCBhZnRlciBgLWNgL2AtbGNgKSwgYW5kIGEgZGlyZWN0IGFyZ3ZcbiAqIChgW1wiZ2l0XCIsXCJjb21taXRcIixcdTIwMjZdYCBcdTIxOTIgc3BhY2Utam9pbmVkKS4gUmV0dXJucyBgbnVsbGAgd2hlbiBubyBjb21tYW5kIHRleHQgaXNcbiAqIHJlY292ZXJhYmxlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdFNoZWxsQ29tbWFuZCh0b29sSW5wdXQ6IHVua25vd24pOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKHRvb2xJbnB1dCA9PT0gbnVsbCB8fCB0eXBlb2YgdG9vbElucHV0ICE9PSAnb2JqZWN0JyB8fCAhKCdjb21tYW5kJyBpbiB0b29sSW5wdXQpKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgY29tbWFuZCA9ICh0b29sSW5wdXQgYXMgeyBjb21tYW5kOiB1bmtub3duIH0pLmNvbW1hbmQ7XG4gIGlmICh0eXBlb2YgY29tbWFuZCA9PT0gJ3N0cmluZycpIHJldHVybiBjb21tYW5kLmxlbmd0aCA+IDAgPyBjb21tYW5kIDogbnVsbDtcbiAgaWYgKEFycmF5LmlzQXJyYXkoY29tbWFuZCkpIHtcbiAgICBjb25zdCBwYXJ0cyA9IGNvbW1hbmQuZmlsdGVyKChwKTogcCBpcyBzdHJpbmcgPT4gdHlwZW9mIHAgPT09ICdzdHJpbmcnKTtcbiAgICBpZiAocGFydHMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBmbGFnSWR4ID0gcGFydHMuZmluZEluZGV4KChwKSA9PiBwID09PSAnLWMnIHx8IHAgPT09ICctbGMnIHx8IHAgPT09ICctaWMnKTtcbiAgICBpZiAoZmxhZ0lkeCA+PSAwICYmIHBhcnRzW2ZsYWdJZHggKyAxXSAhPT0gdW5kZWZpbmVkKSByZXR1cm4gcGFydHNbZmxhZ0lkeCArIDFdO1xuICAgIHJldHVybiBwYXJ0cy5qb2luKCcgJyk7XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVIYW5kbGVyKFxuICBnaXQ6IEdpdEV4ZWN1dG9yID0gY3JlYXRlRGVmYXVsdEdpdEV4ZWN1dG9yKCksXG4gIGV4ZWN1dG9yczogR2F0ZUV4ZWN1dG9ycyA9IGNyZWF0ZURlZmF1bHRHYXRlRXhlY3V0b3JzKCksXG4gIG1lbW9GYWN0b3J5OiAoY3dkOiBzdHJpbmcpID0+IEdhdGVNZW1vU3RhdGUgPSBjcmVhdGVEaXNrR2F0ZU1lbW9TdGF0ZSxcbiAgZW52OiBOb2RlSlMuUHJvY2Vzc0VudiA9IHByb2Nlc3MuZW52XG4pIHtcbiAgcmV0dXJuIGFzeW5jIChpbnB1dDogUHJlVG9vbFVzZUlucHV0LCBjdHg6IEhvb2tDb250ZXh0KSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIExvZyB0aGUgb2JzZXJ2ZWQgc2hlbGwgdG9vbF9uYW1lIHNvIHRoZSBmaXJzdCBsaXZlIHJ1biByZXZlYWxzIHRoZSBsaXRlcmFsXG4gICAgICAvLyBzdHJpbmcgdG8gbmFycm93IHRoZSBtYXRjaGVyIHRvICh0aGUgc3Bpa2UgbmV2ZXIgY29uZmlybWVkIGl0IGVtcGlyaWNhbGx5KS5cbiAgICAgIGN0eC5sb2dnZXIuaW5mbygnZ2l0LXNwYW4gZ2F0ZSBvYnNlcnZlZCBzaGVsbCB0b29sJywgeyB0b29sX25hbWU6IGlucHV0LnRvb2xfbmFtZSB9KTtcblxuICAgICAgY29uc3QgY29tbWFuZCA9IGV4dHJhY3RTaGVsbENvbW1hbmQoaW5wdXQudG9vbF9pbnB1dCk7XG4gICAgICBpZiAoY29tbWFuZCA9PT0gbnVsbCkgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoe30pO1xuXG4gICAgICBjb25zdCBwYXJzZWQgPSBwYXJzZUdpdENvbW1hbmQoY29tbWFuZCk7XG4gICAgICBpZiAocGFyc2VkLmtpbmQgPT09ICdub25lJykgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoe30pO1xuXG4gICAgICBpZiAoaXNHYXRlU2tpcHBlZChlbnYpKSB7XG4gICAgICAgIHJldHVybiBwcmVUb29sVXNlT3V0cHV0KHsgc3lzdGVtTWVzc2FnZTogU0tJUF9OT1RJQ0UgfSk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGN3ZCA9IGlucHV0LmN3ZCA/PyAnJztcbiAgICAgIGNvbnN0IGFsbCA9IHBhcnNlZC5raW5kID09PSAnY29tbWl0JyA/IGNvbW1pdFN0YWdlc0FsbChjb21tYW5kKSA6IGZhbHNlO1xuICAgICAgY29uc3QgY2hhbmdlc2V0ID0gYXdhaXQgcmVzb2x2ZUNoYW5nZXNldChwYXJzZWQua2luZCwgYWxsLCBjd2QsIGdpdCk7XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGV2YWx1YXRlR2F0ZShjaGFuZ2VzZXQsIGN3ZCwgZXhlY3V0b3JzLCBtZW1vRmFjdG9yeShjd2QpKTtcbiAgICAgIGlmIChyZXN1bHQuZGVjaXNpb24gIT09ICdkZW55JykgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoe30pO1xuXG4gICAgICBpZiAoQ09ERVhfR0FURV9IQVJEX0RFTlkpIHtcbiAgICAgICAgLy8gUHJpbWFyeSBwYXRoIChwZXIgdGhlIFJFQURNRSk6IGFjdHVhbGx5IGJsb2NrIHRoZSBjb21tYW5kLlxuICAgICAgICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7XG4gICAgICAgICAgcGVybWlzc2lvbkRlY2lzaW9uOiAnZGVueScsXG4gICAgICAgICAgcGVybWlzc2lvbkRlY2lzaW9uUmVhc29uOiByZXN1bHQucmVhc29uLFxuICAgICAgICAgIHN5c3RlbU1lc3NhZ2U6IHJlc3VsdC5yZWFzb25cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICAvLyBGYWxsYmFjayBwYXRoIChDQVJELm1kIGNvbnRpbmdlbmN5KTogY2Fubm90IGJsb2NrLCBzbyBzdXJmYWNlIHRoZSBzYW1lXG4gICAgICAvLyBjaGVja2xpc3QgYXMgYSBsb3VkIHdhcm5pbmcgYW5kIGFsbG93IFx1MjAxNCB0aGUgQ0kgcmVjaXBlIGVuZm9yY2VzIGZvciBDb2RleC5cbiAgICAgIGNvbnN0IHdhcm5pbmcgPSBgZ2l0LXNwYW4gZ2F0ZSBjb3VsZCBub3QgYmxvY2sgdGhpcyBjb21tYW5kOyBzcGFuIGRlYnQgcmVtYWluczpcXG4ke3Jlc3VsdC5yZWFzb259YDtcbiAgICAgIHJldHVybiBwcmVUb29sVXNlT3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IHdhcm5pbmcsIHN5c3RlbU1lc3NhZ2U6IHdhcm5pbmcgfSk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjdHgubG9nZ2VyLndhcm4oJ2dpdC1zcGFuIGdhdGUgZmFpbGVkIG9wZW4gb24gYW4gdW5jYXVnaHQgZXJyb3InLCB7IGVyciB9KTtcbiAgICAgIHJldHVybiBwcmVUb29sVXNlT3V0cHV0KHt9KTtcbiAgICB9XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IHByZVRvb2xVc2VIb29rKHsgbWF0Y2hlcjogJ0Jhc2h8c2hlbGx8ZXhlY3xsb2NhbF9zaGVsbCcsIHRpbWVvdXQ6IDEwXzAwMCB9LCBjcmVhdGVIYW5kbGVyKCkpO1xuIiwgImltcG9ydCBob29rIGZyb20gXCIuL2dhdGUudHNcIjtcbmltcG9ydCB7IGV4ZWN1dGUgfSBmcm9tIFwiLi4vLi4vLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L3J1bnRpbWUuanNcIjtcbmV4ZWN1dGUoaG9vayk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBNEJPLElBQU0sMEJBQTBCLG9CQUFJLElBQUksQ0FBQyxnQkFBZ0Isb0JBQW9CLGVBQWUsQ0FBQzs7O0FDNUJwRyxTQUFTLGVBQWUsZUFBZSxRQUFRLFNBQVM7QUFDcEQsUUFBTSxPQUFPO0FBQ2IsT0FBSyxnQkFBZ0I7QUFDckIsT0FBSyxVQUFVLE9BQU87QUFDdEIsT0FBSyxnQkFBZ0IsT0FBTztBQUM1QixNQUFJLGFBQWEsVUFBVSxPQUFPLE9BQU8sWUFBWSxVQUFVO0FBQzNELFNBQUssVUFBVSxPQUFPO0FBQUEsRUFDMUI7QUFDQSxTQUFPO0FBQ1g7QUFDTyxTQUFTLGVBQWUsUUFBUSxTQUFTO0FBQzVDLFNBQU8sZUFBZSxjQUFjLFFBQVEsT0FBTztBQUN2RDs7O0FDWkEsU0FBUyxXQUFXLFlBQVksV0FBVyxVQUFVLGlCQUFpQjtBQUN0RSxTQUFTLGVBQWU7QUFDeEIsSUFBTSxzQkFBc0I7QUFDckIsSUFBTSxTQUFOLE1BQWE7QUFBQSxFQUNoQixXQUFXLG9CQUFJLElBQUk7QUFBQSxFQUNuQixrQkFBa0I7QUFBQSxFQUNsQixZQUFZO0FBQUEsRUFDWixjQUFjO0FBQUEsRUFDZDtBQUFBLEVBQ0E7QUFBQSxFQUNBLFlBQVksU0FBUyxDQUFDLEdBQUc7QUFDckIsU0FBSyxjQUFjLE9BQU8sZUFB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RXhCLGVBQU8saUJBQWlCO0FBQUEsVUFDdEIsb0JBQW9CO0FBQUEsVUFDcEIsMEJBQTBCLE9BQU87QUFBQSxVQUNqQyxlQUFlLE9BQU87QUFBQSxRQUN4QixDQUFDO0FBQUEsTUFDSDtBQUdBLFlBQU0sVUFBVTtBQUFBLEVBQW1FLE9BQU8sTUFBTTtBQUNoRyxhQUFPLGlCQUFpQixFQUFFLG1CQUFtQixTQUFTLGVBQWUsUUFBUSxDQUFDO0FBQUEsSUFDaEYsU0FBUyxLQUFLO0FBQ1osVUFBSSxPQUFPLEtBQUssa0RBQWtELEVBQUUsSUFBSSxDQUFDO0FBQ3pFLGFBQU8saUJBQWlCLENBQUMsQ0FBQztBQUFBLElBQzVCO0FBQUEsRUFDRjtBQUNGO0FBRUEsSUFBTyxlQUFRLGVBQWUsRUFBRSxTQUFTLCtCQUErQixTQUFTLElBQU8sR0FBRyxjQUFjLENBQUM7OztBQ2pJMUcsUUFBUSxZQUFJOyIsCiAgIm5hbWVzIjogWyJyZXNvbHZlIiwgImV4ZWNGaWxlU3luYyIsICJmcyIsICJub2RlUGF0aCIsICJleGVjRmlsZVN5bmMiXQp9Cg==

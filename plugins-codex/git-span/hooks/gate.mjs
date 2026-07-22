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
function renderStalenessReason(findings, blocksText) {
  const names = [...new Set(findings.map((row) => row.name))];
  const subject = names.length === 1 ? "an implicit dependency" : "implicit dependencies";
  const name = names.length === 1 ? names[0] : "<name>";
  return [
    `This change leaves ${subject} out of date:`,
    "",
    annotateBlocks(blocksText, findings),
    "",
    "---",
    "",
    `Update the drifted locations or the description \u2014 \`git span add ${name} <path#Lstart-Lend>\` / \`git span why ${name} -m "..."\` \u2014 then retry. If a dependency no longer holds, tell the user instead.`
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
function renderUncoveredReason(uncovered) {
  const lines = uncovered.map((path) => `  - ${path}`);
  return [
    "Decide whether these changed files carry an implicit dependency \u2014 code kept consistent with other locations that nothing links to it:",
    ...lines,
    "",
    'If one exists: `git span add <name> <path#Lstart-Lend>` then `git span why <name> -m "one sentence: the subsystem, what it does across locations"`. Otherwise retry the command to proceed (one-time check).'
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
      const warning = `Could not block this command \u2014 the issue below still needs resolving:
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2NvbnN0YW50cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NvZGV4LWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2dhdGUtY29yZS50cyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL2dhdGUtaWdub3JlLnRzIiwgInNyYy9jb21tb24vc3Bhbi1pZ25vcmUudHMiLCAic3JjL2NvZGV4L2dhdGUudHMiLCAic3JjL2NvZGV4L2dhdGUtZW50cnkudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImV4cG9ydCBjb25zdCBQQUNLQUdFX05BTUUgPSBcIkBnb29kZm9vdC9jb2RleC1ob29rc1wiO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfVElNRU9VVF9NUyA9IDYwMF8wMDA7XG5leHBvcnQgY29uc3QgREVGQVVMVF9TVEFUVVNfTUVTU0FHRSA9IHVuZGVmaW5lZDtcbmV4cG9ydCBjb25zdCBERUZBVUxUX0VTQlVJTERfTE9BREVSUyA9IHtcbiAgICBcIi5tZFwiOiBcInRleHRcIixcbn07XG5leHBvcnQgY29uc3QgSE9PS19GQUNUT1JZX1RPX0VWRU5UID0ge1xuICAgIHByZVRvb2xVc2VIb29rOiBcIlByZVRvb2xVc2VcIixcbiAgICBwb3N0VG9vbFVzZUhvb2s6IFwiUG9zdFRvb2xVc2VcIixcbiAgICBwZXJtaXNzaW9uUmVxdWVzdEhvb2s6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICB1c2VyUHJvbXB0U3VibWl0SG9vazogXCJVc2VyUHJvbXB0U3VibWl0XCIsXG4gICAgc2Vzc2lvblN0YXJ0SG9vazogXCJTZXNzaW9uU3RhcnRcIixcbiAgICBzdWJhZ2VudFN0YXJ0SG9vazogXCJTdWJhZ2VudFN0YXJ0XCIsXG4gICAgc3RvcEhvb2s6IFwiU3RvcFwiLFxuICAgIHN1YmFnZW50U3RvcEhvb2s6IFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgcHJlQ29tcGFjdEhvb2s6IFwiUHJlQ29tcGFjdFwiLFxuICAgIHBvc3RDb21wYWN0SG9vazogXCJQb3N0Q29tcGFjdFwiLFxufTtcbmV4cG9ydCBjb25zdCBFVkVOVFNfV0lUSF9NQVRDSEVSID0gbmV3IFNldChbXG4gICAgXCJQcmVUb29sVXNlXCIsXG4gICAgXCJQb3N0VG9vbFVzZVwiLFxuICAgIFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICBcIlNlc3Npb25TdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdGFydFwiLFxuICAgIFwiU3ViYWdlbnRTdG9wXCIsXG4gICAgXCJQcmVDb21wYWN0XCIsXG4gICAgXCJQb3N0Q29tcGFjdFwiLFxuXSk7XG5leHBvcnQgY29uc3QgRVZFTlRTX1dJVEhfVEVYVF9PVVRQVVQgPSBuZXcgU2V0KFtcIlNlc3Npb25TdGFydFwiLCBcIlVzZXJQcm9tcHRTdWJtaXRcIiwgXCJTdWJhZ2VudFN0YXJ0XCJdKTtcbiIsICJmdW5jdGlvbiBhdHRhY2hNZXRhZGF0YShob29rRXZlbnROYW1lLCBjb25maWcsIGhhbmRsZXIpIHtcbiAgICBjb25zdCBob29rID0gaGFuZGxlcjtcbiAgICBob29rLmhvb2tFdmVudE5hbWUgPSBob29rRXZlbnROYW1lO1xuICAgIGhvb2sudGltZW91dCA9IGNvbmZpZy50aW1lb3V0O1xuICAgIGhvb2suc3RhdHVzTWVzc2FnZSA9IGNvbmZpZy5zdGF0dXNNZXNzYWdlO1xuICAgIGlmIChcIm1hdGNoZXJcIiBpbiBjb25maWcgJiYgdHlwZW9mIGNvbmZpZy5tYXRjaGVyID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGhvb2subWF0Y2hlciA9IGNvbmZpZy5tYXRjaGVyO1xuICAgIH1cbiAgICByZXR1cm4gaG9vaztcbn1cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gYXR0YWNoTWV0YWRhdGEoXCJQcmVUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBvc3RUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gcGVybWlzc2lvblJlcXVlc3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gdXNlclByb21wdFN1Ym1pdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiVXNlclByb21wdFN1Ym1pdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25TdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU2Vzc2lvblN0YXJ0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiU3ViYWdlbnRTdGFydFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN0b3BcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0b3BIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlN1YmFnZW50U3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBhdHRhY2hNZXRhZGF0YShcIlByZUNvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGF0dGFjaE1ldGFkYXRhKFwiUG9zdENvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbiIsICJpbXBvcnQgeyBjbG9zZVN5bmMsIGV4aXN0c1N5bmMsIG1rZGlyU3luYywgb3BlblN5bmMsIHdyaXRlU3luYyB9IGZyb20gXCJub2RlOmZzXCI7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuY29uc3QgREVGQVVMVF9MT0dfRU5WX1ZBUiA9IFwiQ09ERVhfSE9PS1NfTE9HX0ZJTEVcIjtcbmV4cG9ydCBjbGFzcyBMb2dnZXIge1xuICAgIGhhbmRsZXJzID0gbmV3IE1hcCgpO1xuICAgIGZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIGxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgbG9nRmlsZVBhdGggPSBudWxsO1xuICAgIGN1cnJlbnRIb29rVHlwZTtcbiAgICBjdXJyZW50SW5wdXQ7XG4gICAgY29uc3RydWN0b3IoY29uZmlnID0ge30pIHtcbiAgICAgICAgdGhpcy5sb2dGaWxlUGF0aCA9IGNvbmZpZy5sb2dGaWxlUGF0aCA/PyBwcm9jZXNzLmVudltjb25maWcubG9nRW52VmFyID8/IERFRkFVTFRfTE9HX0VOVl9WQVJdID8/IG51bGw7XG4gICAgfVxuICAgIHNldENvbnRleHQoaG9va1R5cGUsIGlucHV0KSB7XG4gICAgICAgIHRoaXMuY3VycmVudEhvb2tUeXBlID0gaG9va1R5cGU7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gaW5wdXQ7XG4gICAgfVxuICAgIGNsZWFyQ29udGV4dCgpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50SG9va1R5cGUgPSB1bmRlZmluZWQ7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBvbihsZXZlbCwgaGFuZGxlcikge1xuICAgICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKSA/PyBuZXcgU2V0KCk7XG4gICAgICAgIGV4aXN0aW5nLmFkZChoYW5kbGVyKTtcbiAgICAgICAgdGhpcy5oYW5kbGVycy5zZXQobGV2ZWwsIGV4aXN0aW5nKTtcbiAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgIGV4aXN0aW5nLmRlbGV0ZShoYW5kbGVyKTtcbiAgICAgICAgICAgIGlmIChleGlzdGluZy5zaXplID09PSAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5oYW5kbGVycy5kZWxldGUobGV2ZWwpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgIH1cbiAgICBkZWJ1ZyhtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImRlYnVnXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICBpbmZvKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiaW5mb1wiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgd2FybihtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcIndhcm5cIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGVycm9yKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZXJyb3JcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIGxvZ0Vycm9yKGVycm9yLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImVycm9yXCIsIGAke21lc3NhZ2V9OiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLCBjb250ZXh0KTtcbiAgICB9XG4gICAgY2xvc2UoKSB7XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgY2xvc2VTeW5jKHRoaXMubG9nRmlsZUZkKTtcbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cbiAgICBlbWl0KGxldmVsLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0ge1xuICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICBsZXZlbCxcbiAgICAgICAgICAgIGhvb2tUeXBlOiB0aGlzLmN1cnJlbnRIb29rVHlwZSxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICAuLi4odGhpcy5jdXJyZW50SW5wdXQgIT09IHVuZGVmaW5lZCA/IHsgaW5wdXQ6IHRoaXMuY3VycmVudElucHV0IH0gOiB7fSksXG4gICAgICAgICAgICAuLi4oY29udGV4dCAhPT0gdW5kZWZpbmVkID8geyBjb250ZXh0IH0gOiB7fSksXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMud3JpdGVUb0ZpbGUoZXZlbnQpO1xuICAgICAgICB0aGlzLmhhbmRsZXJzLmdldChsZXZlbCk/LmZvckVhY2goKGhhbmRsZXIpID0+IHtcbiAgICAgICAgICAgIGhhbmRsZXIoZXZlbnQpO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgd3JpdGVUb0ZpbGUoZXZlbnQpIHtcbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZVBhdGggPT09IG51bGwpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXRoaXMuZmlsZUluaXRpYWxpemVkKSB7XG4gICAgICAgICAgICB0aGlzLmZpbGVJbml0aWFsaXplZCA9IHRydWU7XG4gICAgICAgICAgICBjb25zdCBsb2dEaXIgPSBkaXJuYW1lKHRoaXMubG9nRmlsZVBhdGgpO1xuICAgICAgICAgICAgaWYgKCFleGlzdHNTeW5jKGxvZ0RpcikpIHtcbiAgICAgICAgICAgICAgICBta2RpclN5bmMobG9nRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gb3BlblN5bmModGhpcy5sb2dGaWxlUGF0aCwgXCJhXCIpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgd3JpdGVTeW5jKHRoaXMubG9nRmlsZUZkLCBgJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuYCk7XG4gICAgICAgIH1cbiAgICB9XG59XG5leHBvcnQgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcigpO1xuIiwgImV4cG9ydCBjb25zdCBFWElUX0NPREVTID0ge1xuICAgIFNVQ0NFU1M6IDAsXG4gICAgRVJST1I6IDEsXG4gICAgQkxPQ0s6IDIsXG59O1xuZXhwb3J0IGNsYXNzIEJsb2NrRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gICAgcmVhc29uO1xuICAgIGNvbnN0cnVjdG9yKHJlYXNvbikge1xuICAgICAgICBzdXBlcihyZWFzb24pO1xuICAgICAgICB0aGlzLm5hbWUgPSBcIkJsb2NrRXJyb3JcIjtcbiAgICAgICAgdGhpcy5yZWFzb24gPSByZWFzb247XG4gICAgfVxufVxuZnVuY3Rpb24gb21pdFVuZGVmaW5lZCh2YWx1ZSkge1xuICAgIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModmFsdWUpLmZpbHRlcigoWywgZW50cnldKSA9PiBlbnRyeSAhPT0gdW5kZWZpbmVkKSk7XG59XG5mdW5jdGlvbiBidWlsZE91dHB1dCh0eXBlLCBzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiB7XG4gICAgICAgIF90eXBlOiB0eXBlLFxuICAgICAgICBzdGRvdXQ6IG9taXRVbmRlZmluZWQoc3Rkb3V0KSxcbiAgICAgICAgLi4uKHN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRlcnIgfSA6IHt9KSxcbiAgICB9O1xufVxuZXhwb3J0IGZ1bmN0aW9uIHJhd091dHB1dChzdGRvdXQsIHN0ZGVycikge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlJhd1wiLCBzdGRvdXQsIHN0ZGVycik7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBvcHRpb25zLnBlcm1pc3Npb25EZWNpc2lvbiAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uICE9PSB1bmRlZmluZWQgfHxcbiAgICAgICAgb3B0aW9ucy51cGRhdGVkSW5wdXQgIT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBoYXNTcGVjaWZpY1xuICAgICAgICA/IG9taXRVbmRlZmluZWQoe1xuICAgICAgICAgICAgaG9va0V2ZW50TmFtZTogXCJQcmVUb29sVXNlXCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgICAgIHBlcm1pc3Npb25EZWNpc2lvbjogb3B0aW9ucy5wZXJtaXNzaW9uRGVjaXNpb24sXG4gICAgICAgICAgICBwZXJtaXNzaW9uRGVjaXNpb25SZWFzb246IG9wdGlvbnMucGVybWlzc2lvbkRlY2lzaW9uUmVhc29uLFxuICAgICAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgfSlcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlVG9vbFVzZVwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcHJlVG9vbFVzZUxlZ2FjeUJsb2NrT3V0cHV0KG9wdGlvbnMpIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQcmVUb29sVXNlXCIsIHtcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBkZWNpc2lvbjogb3B0aW9ucy5kZWNpc2lvbixcbiAgICAgICAgcmVhc29uOiBvcHRpb25zLnJlYXNvbixcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbFVzZU91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBoYXNTcGVjaWZpYyA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZCB8fCBvcHRpb25zLnVwZGF0ZWRNQ1BUb29sT3V0cHV0ICE9PSB1bmRlZmluZWQ7XG4gICAgY29uc3QgaG9va1NwZWNpZmljT3V0cHV0ID0gaGFzU3BlY2lmaWNcbiAgICAgICAgPyBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUG9zdFRvb2xVc2VcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICAgICAgdXBkYXRlZE1DUFRvb2xPdXRwdXQ6IG9wdGlvbnMudXBkYXRlZE1DUFRvb2xPdXRwdXQsXG4gICAgICAgIH0pXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlBvc3RUb29sVXNlXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uUmVxdWVzdE91dHB1dChvcHRpb25zKSB7XG4gICAgY29uc3QgZGVjaXNpb24gPSBvbWl0VW5kZWZpbmVkKHtcbiAgICAgICAgYmVoYXZpb3I6IG9wdGlvbnMuYmVoYXZpb3IsXG4gICAgICAgIG1lc3NhZ2U6IG9wdGlvbnMubWVzc2FnZSxcbiAgICAgICAgaW50ZXJydXB0OiBvcHRpb25zLmludGVycnVwdCxcbiAgICAgICAgdXBkYXRlZElucHV0OiBvcHRpb25zLnVwZGF0ZWRJbnB1dCxcbiAgICAgICAgdXBkYXRlZFBlcm1pc3Npb25zOiBvcHRpb25zLnVwZGF0ZWRQZXJtaXNzaW9ucyxcbiAgICB9KTtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSB7XG4gICAgICAgIGhvb2tFdmVudE5hbWU6IFwiUGVybWlzc2lvblJlcXVlc3RcIixcbiAgICAgICAgZGVjaXNpb24sXG4gICAgfTtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJQZXJtaXNzaW9uUmVxdWVzdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dCxcbiAgICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiVXNlclByb21wdFN1Ym1pdFwiLFxuICAgICAgICAgICAgYWRkaXRpb25hbENvbnRleHQ6IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQsXG4gICAgICAgIH1cbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiVXNlclByb21wdFN1Ym1pdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0T3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IGhvb2tTcGVjaWZpY091dHB1dCA9IG9wdGlvbnMuYWRkaXRpb25hbENvbnRleHQgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGhvb2tFdmVudE5hbWU6IFwiU2Vzc2lvblN0YXJ0XCIsXG4gICAgICAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogb3B0aW9ucy5hZGRpdGlvbmFsQ29udGV4dCxcbiAgICAgICAgfVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTZXNzaW9uU3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCBob29rU3BlY2lmaWNPdXRwdXQgPSBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0ICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBob29rRXZlbnROYW1lOiBcIlN1YmFnZW50U3RhcnRcIixcbiAgICAgICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBvcHRpb25zLmFkZGl0aW9uYWxDb250ZXh0LFxuICAgICAgICB9XG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RhcnRcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3RvcE91dHB1dChvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gYnVpbGRPdXRwdXQoXCJTdG9wXCIsIHtcbiAgICAgICAgY29udGludWU6IG9wdGlvbnMuY29udGludWUsXG4gICAgICAgIHN0b3BSZWFzb246IG9wdGlvbnMuc3RvcFJlYXNvbixcbiAgICAgICAgc3VwcHJlc3NPdXRwdXQ6IG9wdGlvbnMuc3VwcHJlc3NPdXRwdXQsXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IG9wdGlvbnMuc3lzdGVtTWVzc2FnZSxcbiAgICAgICAgZGVjaXNpb246IG9wdGlvbnMuZGVjaXNpb24sXG4gICAgICAgIHJlYXNvbjogb3B0aW9ucy5yZWFzb24sXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdG9wT3V0cHV0KG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBidWlsZE91dHB1dChcIlN1YmFnZW50U3RvcFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgICAgIGRlY2lzaW9uOiBvcHRpb25zLmRlY2lzaW9uLFxuICAgICAgICByZWFzb246IG9wdGlvbnMucmVhc29uLFxuICAgIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHByZUNvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUHJlQ29tcGFjdFwiLCB7XG4gICAgICAgIGNvbnRpbnVlOiBvcHRpb25zLmNvbnRpbnVlLFxuICAgICAgICBzdG9wUmVhc29uOiBvcHRpb25zLnN0b3BSZWFzb24sXG4gICAgICAgIHN1cHByZXNzT3V0cHV0OiBvcHRpb25zLnN1cHByZXNzT3V0cHV0LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBvcHRpb25zLnN5c3RlbU1lc3NhZ2UsXG4gICAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gcG9zdENvbXBhY3RPdXRwdXQob3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIGJ1aWxkT3V0cHV0KFwiUG9zdENvbXBhY3RcIiwge1xuICAgICAgICBjb250aW51ZTogb3B0aW9ucy5jb250aW51ZSxcbiAgICAgICAgc3RvcFJlYXNvbjogb3B0aW9ucy5zdG9wUmVhc29uLFxuICAgICAgICBzdXBwcmVzc091dHB1dDogb3B0aW9ucy5zdXBwcmVzc091dHB1dCxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogb3B0aW9ucy5zeXN0ZW1NZXNzYWdlLFxuICAgIH0pO1xufVxuIiwgImltcG9ydCB7IEVWRU5UU19XSVRIX1RFWFRfT1VUUFVUIH0gZnJvbSBcIi4vY29uc3RhbnRzLmpzXCI7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tIFwiLi9sb2dnZXIuanNcIjtcbmltcG9ydCB7IEJsb2NrRXJyb3IsIEVYSVRfQ09ERVMsIHNlc3Npb25TdGFydE91dHB1dCwgc3ViYWdlbnRTdGFydE91dHB1dCwgdXNlclByb21wdFN1Ym1pdE91dHB1dCwgfSBmcm9tIFwiLi9vdXRwdXRzLmpzXCI7XG5hc3luYyBmdW5jdGlvbiByZWFkU3RkaW4oKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgY2h1bmtzID0gW107XG4gICAgICAgIHByb2Nlc3Muc3RkaW4uc2V0RW5jb2RpbmcoXCJ1dGYtOFwiKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImRhdGFcIiwgKGNodW5rKSA9PiBjaHVua3MucHVzaChjaHVuaykpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZW5kXCIsICgpID0+IHJlc29sdmUoY2h1bmtzLmpvaW4oXCJcIikpKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImVycm9yXCIsIHJlamVjdCk7XG4gICAgfSk7XG59XG5mdW5jdGlvbiBwYXJzZVN0ZGluSW5wdXQoc3RkaW5Db250ZW50KSB7XG4gICAgcmV0dXJuIEpTT04ucGFyc2Uoc3RkaW5Db250ZW50KTtcbn1cbmZ1bmN0aW9uIHdyaXRlU3Rkb3V0KG91dHB1dCkge1xuICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKEpTT04uc3RyaW5naWZ5KG91dHB1dC5zdGRvdXQpKTtcbn1cbmZ1bmN0aW9uIG5vcm1hbGl6ZVN0cmluZ091dHB1dChob29rRXZlbnROYW1lLCByZXN1bHQpIHtcbiAgICBpZiAoIUVWRU5UU19XSVRIX1RFWFRfT1VUUFVULmhhcyhob29rRXZlbnROYW1lKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7aG9va0V2ZW50TmFtZX0gaG9va3MgY2Fubm90IHJldHVybiBwbGFpbiB0ZXh0YCk7XG4gICAgfVxuICAgIGlmIChob29rRXZlbnROYW1lID09PSBcIlNlc3Npb25TdGFydFwiKSB7XG4gICAgICAgIHJldHVybiBzZXNzaW9uU3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICBpZiAoaG9va0V2ZW50TmFtZSA9PT0gXCJTdWJhZ2VudFN0YXJ0XCIpIHtcbiAgICAgICAgcmV0dXJuIHN1YmFnZW50U3RhcnRPdXRwdXQoeyBhZGRpdGlvbmFsQ29udGV4dDogcmVzdWx0IH0pO1xuICAgIH1cbiAgICByZXR1cm4gdXNlclByb21wdFN1Ym1pdE91dHB1dCh7IGFkZGl0aW9uYWxDb250ZXh0OiByZXN1bHQgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gY29udmVydFRvSG9va091dHB1dChvdXRwdXQpIHtcbiAgICByZXR1cm4gb3V0cHV0LnN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQsIHN0ZGVycjogb3V0cHV0LnN0ZGVyciB9IDogeyBzdGRvdXQ6IG91dHB1dC5zdGRvdXQgfTtcbn1cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBleGVjdXRlKGhvb2tGbikge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHN0ZGluQ29udGVudCA9IGF3YWl0IHJlYWRTdGRpbigpO1xuICAgICAgICBjb25zdCBpbnB1dCA9IHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpO1xuICAgICAgICBsb2dnZXIuc2V0Q29udGV4dChob29rRm4uaG9va0V2ZW50TmFtZSwgaW5wdXQpO1xuICAgICAgICBjb25zdCBjb250ZXh0ID0geyBsb2dnZXIgfTtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaG9va0ZuKGlucHV0LCBjb250ZXh0KTtcbiAgICAgICAgbGV0IG91dHB1dCA9IHsgc3Rkb3V0OiB7fSB9O1xuICAgICAgICBpZiAodHlwZW9mIHJlc3VsdCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgb3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChub3JtYWxpemVTdHJpbmdPdXRwdXQoaG9va0ZuLmhvb2tFdmVudE5hbWUsIHJlc3VsdCkpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHJlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBvdXRwdXQgPSBjb252ZXJ0VG9Ib29rT3V0cHV0KHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgICAgd3JpdGVTdGRvdXQob3V0cHV0KTtcbiAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuU1VDQ0VTUyk7XG4gICAgfVxuICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBCbG9ja0Vycm9yKSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtlcnJvci5yZWFzb259XFxuYCk7XG4gICAgICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5CTE9DSyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke2Vycm9yLnN0YWNrID8/IGVycm9yLm1lc3NhZ2V9XFxuYCk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtTdHJpbmcoZXJyb3IpfVxcbmApO1xuICAgICAgICB9XG4gICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLkVSUk9SKTtcbiAgICB9XG4gICAgZmluYWxseSB7XG4gICAgICAgIGxvZ2dlci5jbGVhckNvbnRleHQoKTtcbiAgICAgICAgbG9nZ2VyLmNsb3NlKCk7XG4gICAgfVxufVxuIiwgIi8qKlxuICogSGFybmVzcy1hZ25vc3RpYyBnYXRlIGNvcmUgKFBoYXNlIDMuMSBcdTIwMTQgY29udHJhY3QgYW5kIHN0dWJzKS5cbiAqXG4gKiBUaGlzIG1vZHVsZSBkZWNsYXJlcyB0aGUgUHJlVG9vbFVzZSBcImdhdGVcIiB0aGF0IGJvdGggdGhlIENsYXVkZSAoYEJhc2hgKSBhbmRcbiAqIENvZGV4IChzaGVsbC9leGVjKSBhZGFwdGVycyB3aWxsIGRyaXZlOiB3aGVuIHRoZSBhZ2VudCBydW5zIGBnaXQgY29tbWl0YCBvclxuICogYGdpdCBwdXNoYCBhbmQgdGhlIGNoYW5nZXNldCBpdCBpcyBhYm91dCB0byBsYW5kIGNhcnJpZXMgcmVhbCBzcGFuIGRlYnQsIHRoZVxuICogY29tbWFuZCBpcyBoZWxkIHdpdGggYSBjaGVja2xpc3Q7IHBvc2l0aW9uYWwgZHJpZnQgdGhlIHRvdWNoIGhvb2sgaGFzIGJlZW5cbiAqIGhlYWxpbmcgYWxsIGFsb25nIG5ldmVyIGJsb2Nrcy4gTGlrZSB7QGxpbmsgZmlsZTovLy4vdG91Y2gtY29yZS50c30gaXQgaW1wb3J0c1xuICogbm90aGluZyBmcm9tIGVpdGhlciBob29rIFNESyBhbmQgaXMgdHlwZWQgc3RydWN0dXJhbGx5LCBwZXIgdGhlIGBjb21tb24vYFxuICogbGF5ZXIgY29udmVudGlvbjogYWRhcHRlcnMgdHJhbnNsYXRlIHRoZWlyIFNESy1zcGVjaWZpYyBob29rIGlucHV0IGludG8gYVxuICogY29tbWFuZCBzdHJpbmcgKyBjd2QsIGluamVjdCBleGVjdXRpb24vc3RhdGUgZGVwZW5kZW5jaWVzLCBhbmQgdHJhbnNsYXRlIHRoZVxuICogcmV0dXJuZWQge0BsaW5rIEdhdGVSZXN1bHR9IGludG8gdGhlaXIgb3duIGRlbnkvYWxsb3cgb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogZ2F0ZS1jb3JlIGlzIGEgc2libGluZyBvZiB0b3VjaC1jb3JlLCBub3QgYSBkZXBlbmRlbnQ6IHRoZSB0d28gY29yZXMgYXJlXG4gKiBpbmRlcGVuZGVudCBhbmQgdGhpcyBtb2R1bGUgaW1wb3J0cyBub3RoaW5nIGZyb20gYHRvdWNoLWNvcmUudHNgLlxuICpcbiAqIFJldXNlZCBmcm9tIHRoZSBzaGFyZWQga2VybmVsIChub3QgcmVkZWZpbmVkKTogYGlzRGVidCgpYCAodGhlIHNpbmdsZVxuICogc291cmNlIG9mIHRydXRoIGZvciB0aGUgc2VtYW50aWMtb25seSBkZWJ0IGludmFyaWFudCBcdTIwMTQgYE1PVkVEYCBhbmRcbiAqIGBSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgYXJlIG5ldmVyIGRlYnQpLCB0aGUgcG9yY2VsYWluIHN0YXR1cyB2b2NhYnVsYXJ5XG4gKiAoYFBvcmNlbGFpblN0YXR1c2AvYFBvcmNlbGFpblJvd2AvYFN0YWxlUG9yY2VsYWluUm93YCksIGFuZCBgZ2F0ZU1lbW9EaXIoKWBcbiAqICh0aGUgYDxnaXQtY29tbW9uLWRpcj4vZ2l0LXNwYW4vZ2F0ZS9gIHBhdGggdGhlIGRpc2stYmFja2VkXG4gKiB7QGxpbmsgR2F0ZU1lbW9TdGF0ZX0gd2lsbCBwZXJzaXN0IHVuZGVyKSBcdTIwMTQgYWxsIGZyb20gYWdlbnQtaG9va3MtY29tbW9uLnRzLlxuICpcbiAqIEV2ZXJ5IGZ1bmN0aW9uIHdob3NlIHJlc3VsdCBkZXBlbmRzIG9uIHJlYWwgbG9naWMgaXMgYSBgTm90IEltcGxlbWVudGVkYCBzdHViXG4gKiBpbiB0aGlzIHBoYXNlOyBQaGFzZSAzLjIgd3JpdGVzIHNraXBwZWQgY2hlY2tzIGFnYWluc3QgdGhlc2Ugc2lnbmF0dXJlcyBhbmRcbiAqIFBoYXNlIDMuMyBpbXBsZW1lbnRzIHRoZW0uXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tICdub2RlOmNyeXB0byc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQge1xuICBnYXRlTWVtb0RpcixcbiAgaHVtYW5TdGF0dXNMYWJlbCxcbiAgaXNEZWJ0LFxuICBpc0Vudmlyb25tZW50YWxTdGF0dXMsXG4gIGlzSW5zaWRlU3BhblJvb3QsXG4gIHR5cGUgUG9yY2VsYWluUm93LFxuICBwYXJzZVBvcmNlbGFpbixcbiAgcGFyc2VTdGFsZVBvcmNlbGFpbixcbiAgcmVzb2x2ZVJlcG9Sb290LFxuICB0eXBlIFN0YWxlUG9yY2VsYWluUm93LFxuICB0b1Bvc2l4XG59IGZyb20gJy4vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcbmltcG9ydCB7IGlzR2F0ZUlnbm9yZWQsIGxvYWRHYXRlSWdub3JlIH0gZnJvbSAnLi9nYXRlLWlnbm9yZS5qcyc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2Nhbi1mYWlsdXJlIHNpZ25hbFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmFpc2VkIGJ5IHRoZSBgc3RhbGVgIGV4ZWN1dG9yIHdoZW4gYGdpdCBzcGFuIHN0YWxlYCBjb3VsZCBub3QgKmNvbXBsZXRlKiBpdHNcbiAqIHNjb3BlZCBzY2FuIFx1MjAxNCBhcyBvcHBvc2VkIHRvIGNvbXBsZXRpbmcgYW5kIHJlcG9ydGluZyBkcmlmdC4gYGdpdCBzcGFuIHN0YWxlYFxuICogZXhpdHMgbm9uLXplcm8gaW4gdHdvIHZlcnkgZGlmZmVyZW50IHNpdHVhdGlvbnM6IG9uIGxlZ2l0aW1hdGUgZHJpZnQgKHJlYWxcbiAqIHBvcmNlbGFpbiByb3dzIG9uIHN0ZG91dCkgYW5kIG9uIGEgaGFyZCBzY2FuIGZhaWx1cmUgKGUuZy4gYW4gdW5yZWFkYWJsZVxuICogYW5jaG9yIGZpbGUgYWJvcnRzIHRoZSB3aG9sZSBzY29wZWQgcXVlcnksIGxlYXZpbmcgc3Rkb3V0IGVtcHR5IGFuZCBhbiBlcnJvclxuICogb24gc3RkZXJyKS4gT25seSB0aGUgc2Vjb25kIHRocm93cyB0aGlzLCBzbyB7QGxpbmsgZXZhbHVhdGVHYXRlfSBjYW4gdGVsbCBhXG4gKiBzY2FuIHRoYXQgKnJhbiBjbGVhbiogKGVtcHR5IHJvd3MpIGZyb20gb25lIHRoYXQgKm5ldmVyIHJhbiogKGVtcHR5IHJvd3NcbiAqIGJlY2F1c2UgaXQgYWJvcnRlZCkgYW5kIHJlZnVzZSB0byByZWFkIHRoZSBsYXR0ZXIgYXMgYSBjbGVhbiBwYXNzLiBgZGV0YWlsYFxuICogY2FycmllcyB0aGUgQ0xJJ3Mgc3RkZXJyIGZvciB0aGUgc3VyZmFjZWQgcmVhc29uLlxuICovXG5leHBvcnQgY2xhc3MgR2F0ZVNjYW5FcnJvciBleHRlbmRzIEVycm9yIHtcbiAgcmVhZG9ubHkgZGV0YWlsOiBzdHJpbmc7XG4gIGNvbnN0cnVjdG9yKGRldGFpbDogc3RyaW5nKSB7XG4gICAgc3VwZXIoYGdpdCBzcGFuIHN0YWxlIGNvdWxkIG5vdCBjb21wbGV0ZSBpdHMgc2NhbjogJHtkZXRhaWx9YCk7XG4gICAgdGhpcy5uYW1lID0gJ0dhdGVTY2FuRXJyb3InO1xuICAgIHRoaXMuZGV0YWlsID0gZGV0YWlsO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQ29tbWFuZCBwYXJzaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBUaGUga2luZCBvZiBnYXRlZCBnaXQgY29tbWFuZCBhIHNoZWxsIGNvbW1hbmQgc3RyaW5nIHJlc29sdmVzIHRvLiBgJ25vbmUnYFxuICogaXMgdGhlIGNvbnNlcnZhdGl2ZSBmYWlsLW9wZW4gYW5zd2VyOiBhbnkgc2hhcGUge0BsaW5rIHBhcnNlR2l0Q29tbWFuZH0gZG9lc1xuICogbm90IGNvbmZpZGVudGx5IHJlY29nbml6ZSBhcyBhIGBnaXQgY29tbWl0YC9gZ2l0IHB1c2hgIG1hcHMgdG8gYCdub25lJ2AgYW5kXG4gKiB0aGUgZ2F0ZSBhbGxvd3MgdGhlIGNvbW1hbmQgdGhyb3VnaCB1bnRvdWNoZWQuXG4gKi9cbmV4cG9ydCB0eXBlIEdpdENvbW1hbmRLaW5kID0gJ2NvbW1pdCcgfCAncHVzaCcgfCAnbm9uZSc7XG5cbi8qKlxuICogVGhlIHJlc3VsdCBvZiBwYXJzaW5nIGEgc2hlbGwgY29tbWFuZCBzdHJpbmcgZm9yIGEgZ2F0ZWQgZ2l0IGludm9jYXRpb24uXG4gKlxuICogYHBhdGhzYCBjYXJyaWVzIG9ubHkgd2hhdCBpcyBwYXJzZWFibGUgZnJvbSB0aGUgY29tbWFuZCBsaW5lIGl0c2VsZiBcdTIwMTQgdGhlXG4gKiBleHBsaWNpdCBwYXRoc3BlY3MgYSBgZ2l0IGNvbW1pdCAtLSA8cGF0aD5cdTIwMjZgIGZvcm0gbmFtZXMuIEl0IGlzIGRlbGliZXJhdGVseVxuICogKm5vdCogdGhlIGNoYW5nZXNldDogdGhlIGZ1bGxlciByZXNvbHV0aW9uIChzdGFnZWQgZmlsZXMsIHRoZSBgLWFgL2AtYW1gXG4gKiBleHBhbnNpb24gYWdhaW5zdCB0cmFja2VkLW1vZGlmaWVkIGZpbGVzLCB0aGUgb3V0Z29pbmcgcHVzaCByYW5nZSkgaXNcbiAqIHtAbGluayByZXNvbHZlQ2hhbmdlc2V0fSdzIGpvYiwgZHJpdmVuIGZyb20gdGhlIHJlcG8gc3RhdGUsIG5vdCBmcm9tIHRoZVxuICogY29tbWFuZCB0ZXh0LiBgcGF0aHNgIGlzIG9taXR0ZWQgd2hlbiB0aGUgY29tbWFuZCBuYW1lcyBubyBleHBsaWNpdFxuICogcGF0aHNwZWMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGFyc2VkR2l0Q29tbWFuZCB7XG4gIGtpbmQ6IEdpdENvbW1hbmRLaW5kO1xuICBwYXRocz86IHN0cmluZ1tdO1xufVxuXG4vKipcbiAqIFdvcmQtYm91bmRhcnkgcGFyc2Ugb2YgYSBgZ2l0IGNvbW1pdGAgLyBgZ2l0IHB1c2hgIGludm9jYXRpb24gZW1iZWRkZWQgaW4gYW5cbiAqIGFyYml0cmFyeSBzaGVsbCBjb21tYW5kIHN0cmluZy5cbiAqXG4gKiBNdXN0IHJlY29nbml6ZSB0aGUgcmVhbCBzaGFwZXMgY29tbWl0cyBhbmQgcHVzaGVzIGFycml2ZSBpbjogY2hhaW5lZFxuICogY29tbWFuZHMgKGBcdTIwMjYgJiYgZ2l0IGNvbW1pdCBcdTIwMjZgLCBgXHUyMDI2OyBnaXQgcHVzaGAsIGBcdTIwMjYgfCBcdTIwMjZgKSwgYW4gZXhwbGljaXQgcmVwbyB2aWFcbiAqIGBnaXQgLUMgPGRpcj4gY29tbWl0IFx1MjAyNmAsIHRyYWlsaW5nIHBhdGhzcGVjcyBhZnRlciBgLS1gLCB0aGUgYC1hYC9gLWFtYFxuICogXCJjb21taXQgYWxsIHRyYWNrZWQtbW9kaWZpZWRcIiBmb3JtcywgYW5kIGludm9jYXRpb24gZnJvbSBhIGN3ZCBiZWxvdyB0aGUgcmVwb1xuICogcm9vdC4gTWF0Y2hpbmcgaXMgb24gd29yZCBib3VuZGFyaWVzLCBuZXZlciBzdWJzdHJpbmc6IGEgcGF0aCBvciBtZXNzYWdlIHRoYXRcbiAqIG1lcmVseSBjb250YWlucyB0aGUgdGV4dCBgZ2l0IGNvbW1pdGAgbXVzdCBub3QgdHJpcCB0aGUgZ2F0ZS5cbiAqXG4gKiBDb25zZXJ2YXRpdmUgYnkgY29udHJhY3Q6IHRoaXMgaXMgdGhlIGZhaWwtb3BlbiBwb2ludCBhdCB0aGUgcGFyc2UgbGF5ZXIsIG5vdFxuICogYSBwbGFjZSB0byBndWVzcy4gQW55IGNvbW1hbmQgd2hvc2Ugc2hhcGUgaXMgbm90IGNvbmZpZGVudGx5IGEgZ2F0ZWRcbiAqIGBnaXQgY29tbWl0YC9gZ2l0IHB1c2hgIFx1MjAxNCBhbiB1bmZhbWlsaWFyIHN1YmNvbW1hbmQsIGFuIGFsaWFzLCBhbiBvYmZ1c2NhdGVkXG4gKiBvciBkeW5hbWljYWxseS1idWlsdCBpbnZvY2F0aW9uIFx1MjAxNCByZXR1cm5zIGB7IGtpbmQ6ICdub25lJyB9YCBzbyB0aGUgZ2F0ZVxuICogYWxsb3dzIGl0IHJhdGhlciB0aGFuIGRlbnlpbmcgb24gYSBzaGFreSByZWFkLiAoU2VlIENBUkQubWQgXCJSaXNrcyBhbmRcbiAqIHJlcXVpcmVkIHNwaWtlcyBcdTIxOTIgQ29tbWFuZCBwYXJzaW5nXCIgYW5kIGRlc2lnbi1kZWNpc2lvbnMubWQgIzEuKVxuICpcbiAqIEBwYXJhbSBjb21tYW5kIFRoZSByYXcgc2hlbGwgY29tbWFuZCBzdHJpbmcgZnJvbSB0aGUgaG9vaydzIHRvb2wgaW5wdXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUdpdENvbW1hbmQoY29tbWFuZDogc3RyaW5nKTogUGFyc2VkR2l0Q29tbWFuZCB7XG4gIGZvciAoY29uc3Qgc2VnbWVudCBvZiBzcGxpdFNlZ21lbnRzKGNvbW1hbmQpKSB7XG4gICAgY29uc3QgaW52ID0gbWF0Y2hHaXRJbnZvY2F0aW9uKHRva2VuaXplKHNlZ21lbnQpKTtcbiAgICBpZiAoIWludikgY29udGludWU7XG4gICAgaWYgKGludi5zdWJjb21tYW5kID09PSAnY29tbWl0Jykge1xuICAgICAgY29uc3QgZGFzaERhc2ggPSBpbnYuYXJncy5pbmRleE9mKCctLScpO1xuICAgICAgY29uc3QgcGF0aHMgPSBkYXNoRGFzaCA+PSAwID8gaW52LmFyZ3Muc2xpY2UoZGFzaERhc2ggKyAxKS5maWx0ZXIoKHApID0+IHAubGVuZ3RoID4gMCkgOiBbXTtcbiAgICAgIHJldHVybiBwYXRocy5sZW5ndGggPiAwID8geyBraW5kOiAnY29tbWl0JywgcGF0aHMgfSA6IHsga2luZDogJ2NvbW1pdCcgfTtcbiAgICB9XG4gICAgaWYgKGludi5zdWJjb21tYW5kID09PSAncHVzaCcpIHtcbiAgICAgIHJldHVybiB7IGtpbmQ6ICdwdXNoJyB9O1xuICAgIH1cbiAgICAvLyBBIHJlY29nbml6ZWQgYGdpdGAgaW52b2NhdGlvbiB0aGF0IGlzIG5laXRoZXIgY29tbWl0IG5vciBwdXNoIChlLmcuXG4gICAgLy8gYGdpdCBhZGQgLiAmJiBnaXQgY29tbWl0IFx1MjAyNmApOiBrZWVwIHNjYW5uaW5nIGxhdGVyIHNlZ21lbnRzLlxuICB9XG4gIHJldHVybiB7IGtpbmQ6ICdub25lJyB9O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYSBgZ2l0IGNvbW1pdGAgaW4gdGhlIGNvbW1hbmQgaXMgYW4gYC1hYC9gLWFtYC9gLS1hbGxgIGZvcm0gXHUyMDE0IHRoZVxuICogXCJzdGFnZSBhbGwgdHJhY2tlZC1tb2RpZmllZCBmaWxlc1wiIHZhcmlhbnQgd2hvc2UgY2hhbmdlc2V0IHtAbGluayByZXNvbHZlQ2hhbmdlc2V0fVxuICogbXVzdCB3aWRlbiBiZXlvbmQgdGhlIGFscmVhZHktc3RhZ2VkIHNldC5cbiAqXG4gKiBUaGUgYGFsbGAgc2lnbmFsIGlzIGRlbGliZXJhdGVseSAqbm90KiBjYXJyaWVkIG9uIHtAbGluayBQYXJzZWRHaXRDb21tYW5kfVxuICogKHNlZSB0aGF0IHR5cGUncyBkb2MpOiB0aGUgYWRhcHRlciBkZXJpdmVzIGl0IGhlcmUgZnJvbSB0aGUgc2FtZSBjb21tYW5kIHRleHRcbiAqIGFuZCB0aHJlYWRzIGl0IGludG8ge0BsaW5rIHJlc29sdmVDaGFuZ2VzZXR9IGV4cGxpY2l0bHkuIENvbnNlcnZhdGl2ZTogb25seSBhXG4gKiBzaG9ydC1mbGFnIGdyb3VwIGNvbnRhaW5pbmcgYGFgIChgLWFgLCBgLWFtYCwgYC1tYWApIG9yIGFuIGV4cGxpY2l0IGAtLWFsbGAsXG4gKiBzY2FubmVkIGJlZm9yZSBhbnkgYC0tYCBwYXRoc3BlYyBzZXBhcmF0b3IsIGNvdW50cy5cbiAqXG4gKiBWYWx1ZS10YWtpbmcgY29tbWl0IG9wdGlvbnMgKGAtbWAsIGAtLW1lc3NhZ2VgLCBgLUZgLCBgLUNgLCBcdTIwMjYpIGNvbnN1bWUgdGhlaXJcbiAqIGZvbGxvd2luZyB0b2tlbiwgc28gaXQgaXMgbmV2ZXIgc2Nhbm5lZCBhcyBhIGZsYWc6IGEgbWVzc2FnZSB3b3JkIGxpa2VcbiAqIGAtYW5hbHlzaXNgIGluIGBnaXQgY29tbWl0IC1tIFwiLWFuYWx5c2lzXCJgIG11c3Qgbm90IGJlIG1pc3JlYWQgYXMgdGhlXG4gKiBgLS1hbGxgLWVxdWl2YWxlbnQgc2hvcnQtZmxhZyBjbHVzdGVyIGFuZCB3aWRlbiB0aGUgY2hhbmdlc2V0LlxuICovXG5jb25zdCBDT01NSVRfVkFMVUVfT1BUSU9OUyA9IG5ldyBTZXQoW1xuICAnLW0nLFxuICAnLS1tZXNzYWdlJyxcbiAgJy1GJyxcbiAgJy0tZmlsZScsXG4gICctQycsXG4gICctLXJldXNlLW1lc3NhZ2UnLFxuICAnLWMnLFxuICAnLS1yZWVkaXQtbWVzc2FnZScsXG4gICctLWF1dGhvcicsXG4gICctLWRhdGUnLFxuICAnLXQnLFxuICAnLS10ZW1wbGF0ZScsXG4gICctLWZpeHVwJyxcbiAgJy0tc3F1YXNoJyxcbiAgJy0tdHJhaWxlcicsXG4gICctLWNsZWFudXAnLFxuICAnLS1ncGctc2lnbidcbl0pO1xuXG5leHBvcnQgZnVuY3Rpb24gY29tbWl0U3RhZ2VzQWxsKGNvbW1hbmQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc3BsaXRTZWdtZW50cyhjb21tYW5kKSkge1xuICAgIGNvbnN0IGludiA9IG1hdGNoR2l0SW52b2NhdGlvbih0b2tlbml6ZShzZWdtZW50KSk7XG4gICAgaWYgKCFpbnYgfHwgaW52LnN1YmNvbW1hbmQgIT09ICdjb21taXQnKSBjb250aW51ZTtcbiAgICBjb25zdCBkYXNoRGFzaCA9IGludi5hcmdzLmluZGV4T2YoJy0tJyk7XG4gICAgY29uc3QgZmxhZ0FyZ3MgPSBkYXNoRGFzaCA+PSAwID8gaW52LmFyZ3Muc2xpY2UoMCwgZGFzaERhc2gpIDogaW52LmFyZ3M7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBmbGFnQXJncy5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3QgYXJnID0gZmxhZ0FyZ3NbaV07XG4gICAgICBpZiAoYXJnID09PSAnLS1hbGwnKSByZXR1cm4gdHJ1ZTtcbiAgICAgIC8vIEEgdmFsdWUtdGFraW5nIG9wdGlvbiBjb25zdW1lcyBpdHMgZm9sbG93aW5nIHRva2VuIFx1MjAxNCBza2lwIHRoYXQgdG9rZW4gc29cbiAgICAgIC8vIGEgbWVzc2FnZS9hdXRob3IvZGF0ZSBhcmd1bWVudCBpcyBuZXZlciBzY2FubmVkIGFzIGFuIGAtYWAgY2x1c3Rlci5cbiAgICAgIGlmIChDT01NSVRfVkFMVUVfT1BUSU9OUy5oYXMoYXJnKSkge1xuICAgICAgICBpKys7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKCFhcmcuc3RhcnRzV2l0aCgnLS0nKSAmJiAvXi1bQS1aYS16XSphW0EtWmEtel0qJC8udGVzdChhcmcpKSByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLy8gU2hlbGwgY29udHJvbCBvcGVyYXRvcnMgdGhhdCBzZXBhcmF0ZSBvbmUgc2ltcGxlIGNvbW1hbmQgZnJvbSB0aGUgbmV4dC5cbi8vIFNwbGl0dGluZyBvbiB0aGVzZSAob3V0c2lkZSBxdW90ZXMpIGlzb2xhdGVzIGVhY2ggY29tbWFuZCBzbyBhIGBnaXQgY29tbWl0YC9cbi8vIGBnaXQgcHVzaGAgY2hhaW5lZCBhZnRlciBgJiZgL2A7YC9gfGAgaXMgZm91bmQsIHdoaWxlIHRleHQgaW5zaWRlIGEgcXVvdGVkXG4vLyBhcmd1bWVudCAoYGVjaG8gXCJnaXQgY29tbWl0XCJgKSBzdGF5cyB3aXRoaW4gaXRzIG93biBub24tZ2l0IHNlZ21lbnQuXG5jb25zdCBUV09fQ0hBUl9PUEVSQVRPUlMgPSBuZXcgU2V0KFsnJiYnLCAnfHwnXSk7XG5jb25zdCBPTkVfQ0hBUl9TRVBBUkFUT1JTID0gbmV3IFNldChbJzsnLCAnfCcsICdcXG4nLCAnJicsICcoJywgJyknXSk7XG5cbi8qKiBTcGxpdCBhIHNoZWxsIGNvbW1hbmQgaW50byBzaW1wbGUtY29tbWFuZCBzZWdtZW50cywgcmVzcGVjdGluZyBxdW90ZXMuICovXG5mdW5jdGlvbiBzcGxpdFNlZ21lbnRzKGNvbW1hbmQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgc2VnbWVudHM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjdXJyZW50ID0gJyc7XG4gIGxldCBxdW90ZTogJ1wiJyB8IFwiJ1wiIHwgbnVsbCA9IG51bGw7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgY29tbWFuZC5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGNoID0gY29tbWFuZFtpXTtcbiAgICBpZiAocXVvdGUpIHtcbiAgICAgIGN1cnJlbnQgKz0gY2g7XG4gICAgICBpZiAoY2ggPT09IHF1b3RlKSBxdW90ZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSAnXCInIHx8IGNoID09PSBcIidcIikge1xuICAgICAgcXVvdGUgPSBjaDtcbiAgICAgIGN1cnJlbnQgKz0gY2g7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKFRXT19DSEFSX09QRVJBVE9SUy5oYXMoY29tbWFuZC5zbGljZShpLCBpICsgMikpKSB7XG4gICAgICBzZWdtZW50cy5wdXNoKGN1cnJlbnQpO1xuICAgICAgY3VycmVudCA9ICcnO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChPTkVfQ0hBUl9TRVBBUkFUT1JTLmhhcyhjaCkpIHtcbiAgICAgIHNlZ21lbnRzLnB1c2goY3VycmVudCk7XG4gICAgICBjdXJyZW50ID0gJyc7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY3VycmVudCArPSBjaDtcbiAgfVxuICBzZWdtZW50cy5wdXNoKGN1cnJlbnQpO1xuICByZXR1cm4gc2VnbWVudHM7XG59XG5cbi8qKlxuICogVG9rZW5pemUgb25lIHNlZ21lbnQgaW50byBzaGVsbCB3b3JkcywgcmVzcGVjdGluZyBzaW5nbGUvZG91YmxlIHF1b3RlcyBhbmRcbiAqIHN0cmlwcGluZyB0aGUgcXVvdGUgY2hhcmFjdGVycy4gRGVsaWJlcmF0ZWx5IG1pbmltYWwgKG5vIGV4cGFuc2lvbiwgbm9cbiAqIGVzY2FwZSBoYW5kbGluZyBiZXlvbmQgcXVvdGVzKTogdGhlIGdvYWwgaXMgY29uZmlkZW50IHJlY29nbml0aW9uIG9mIGFcbiAqIGBnaXQgY29tbWl0YC9gcHVzaGAgc2hhcGUsIG5vdCBhIGZ1bGwgc2hlbGwgcGFyc2VyLlxuICovXG5mdW5jdGlvbiB0b2tlbml6ZShzZWdtZW50OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHRva2Vuczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGN1cnJlbnQgPSAnJztcbiAgbGV0IGhhcyA9IGZhbHNlO1xuICBsZXQgcXVvdGU6ICdcIicgfCBcIidcIiB8IG51bGwgPSBudWxsO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHNlZ21lbnQubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjaCA9IHNlZ21lbnRbaV07XG4gICAgaWYgKHF1b3RlKSB7XG4gICAgICBpZiAoY2ggPT09IHF1b3RlKSBxdW90ZSA9IG51bGw7XG4gICAgICBlbHNlIGN1cnJlbnQgKz0gY2g7XG4gICAgICBoYXMgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gJ1wiJyB8fCBjaCA9PT0gXCInXCIpIHtcbiAgICAgIHF1b3RlID0gY2g7XG4gICAgICBoYXMgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gJyAnIHx8IGNoID09PSAnXFx0Jykge1xuICAgICAgaWYgKGhhcykge1xuICAgICAgICB0b2tlbnMucHVzaChjdXJyZW50KTtcbiAgICAgICAgY3VycmVudCA9ICcnO1xuICAgICAgICBoYXMgPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjdXJyZW50ICs9IGNoO1xuICAgIGhhcyA9IHRydWU7XG4gIH1cbiAgaWYgKGhhcykgdG9rZW5zLnB1c2goY3VycmVudCk7XG4gIHJldHVybiB0b2tlbnM7XG59XG5cbi8qKiBHaXQgZ2xvYmFsIG9wdGlvbnMgdGhhdCBjb25zdW1lIGEgc2VwYXJhdGUgZm9sbG93aW5nIHZhbHVlIHRva2VuLiAqL1xuY29uc3QgR0lUX1ZBTFVFX09QVElPTlMgPSBuZXcgU2V0KFtcbiAgJy1DJyxcbiAgJy1jJyxcbiAgJy0tZ2l0LWRpcicsXG4gICctLXdvcmstdHJlZScsXG4gICctLW5hbWVzcGFjZScsXG4gICctLXN1cGVyLXByZWZpeCcsXG4gICctLWV4ZWMtcGF0aCcsXG4gICctLWF0dHItc291cmNlJyxcbiAgJy0tY29uZmlnLWVudidcbl0pO1xuXG5pbnRlcmZhY2UgR2l0SW52b2NhdGlvbiB7XG4gIHN1YmNvbW1hbmQ6IHN0cmluZztcbiAgYXJnczogc3RyaW5nW107XG59XG5cbi8qKlxuICogSWYgYSBzZWdtZW50J3MgdG9rZW5zIGFyZSBhIGBnaXQgPHN1YmNvbW1hbmQ+IFx1MjAyNmAgaW52b2NhdGlvbiwgcmV0dXJuIHRoZVxuICogc3ViY29tbWFuZCBhbmQgaXRzIHJlbWFpbmluZyBhcmdzOyBvdGhlcndpc2UgYG51bGxgLiBMZWFkaW5nIGBWQVI9dmFsdWVgXG4gKiBlbnZpcm9ubWVudCBhc3NpZ25tZW50cyBhbmQgYGdpdGAgZ2xvYmFsIG9wdGlvbnMgKGluY2x1ZGluZyB0aGUgdmFsdWUtdGFraW5nXG4gKiBvbmVzKSBhcmUgc2tpcHBlZCBzbyB0aGUgc3ViY29tbWFuZCBpcyBjb3JyZWN0bHkgbG9jYXRlZC5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hHaXRJbnZvY2F0aW9uKHRva2Vuczogc3RyaW5nW10pOiBHaXRJbnZvY2F0aW9uIHwgbnVsbCB7XG4gIGxldCBpID0gMDtcbiAgd2hpbGUgKGkgPCB0b2tlbnMubGVuZ3RoICYmIC9eW0EtWmEtel9dW0EtWmEtejAtOV9dKj0vLnRlc3QodG9rZW5zW2ldKSkgaSsrO1xuICBpZiAoaSA+PSB0b2tlbnMubGVuZ3RoIHx8IHRva2Vuc1tpXSAhPT0gJ2dpdCcpIHJldHVybiBudWxsO1xuICBpKys7XG4gIHdoaWxlIChpIDwgdG9rZW5zLmxlbmd0aCkge1xuICAgIGNvbnN0IHQgPSB0b2tlbnNbaV07XG4gICAgaWYgKHQgPT09ICctLScpIHJldHVybiBudWxsOyAvLyBhIGAtLWAgYmVmb3JlIGFueSBzdWJjb21tYW5kIGlzIG5vdCBhIHNoYXBlIHdlIHJlY29nbml6ZVxuICAgIGlmICghdC5zdGFydHNXaXRoKCctJykpIGJyZWFrO1xuICAgIGkgKz0gR0lUX1ZBTFVFX09QVElPTlMuaGFzKHQpID8gMiA6IDE7XG4gIH1cbiAgaWYgKGkgPj0gdG9rZW5zLmxlbmd0aCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IHN1YmNvbW1hbmQ6IHRva2Vuc1tpXSwgYXJnczogdG9rZW5zLnNsaWNlKGkgKyAxKSB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENoYW5nZXNldCByZXNvbHV0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBUaGUgaW5qZWN0ZWQgZ2l0IHN1cmZhY2Uge0BsaW5rIHJlc29sdmVDaGFuZ2VzZXR9IG5lZWRzIHRvIHR1cm4gYSBwYXJzZWRcbiAqIGNvbW1hbmQgaW50byB0aGUgY29uY3JldGUgbGlzdCBvZiBwYXRocyB0aGF0IHdvdWxkIGxhbmQuIEtlcHQgYXMgbmFycm93IGFzeW5jXG4gKiBmdW5jdGlvbnMgKHJhdGhlciB0aGFuIGEgcmF3IGNvbW1hbmQgcnVubmVyKSBmb2xsb3dpbmcgYHRvdWNoLWNvcmUudHNgJ3NcbiAqIGBUb3VjaEV4ZWN1dG9yc2AgcGF0dGVybiwgc28gUGhhc2UgMy4yJ3MgdGVzdHMgZmFrZSB0aGUgcmVwbyBzdGF0ZSB3aXRob3V0IGFcbiAqIHJlYWwgc3VicHJvY2VzcyBhbmQgdGhlIGNvcmUgbmV2ZXIgc3Bhd25zIG9uZSBpdHNlbGYuXG4gKlxuICogQWxsIHJldHVybmVkIHBhdGhzIGFyZSByZXBvLXJlbGF0aXZlIFBPU0lYIHBhdGhzLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEdpdEV4ZWN1dG9yIHtcbiAgLyoqXG4gICAqIFBhdGhzIHN0YWdlZCBmb3IgdGhlIG5leHQgY29tbWl0IFx1MjAxNCBgZ2l0IGRpZmYgLS1jYWNoZWQgLS1uYW1lLW9ubHlgLiBUaGVzZVxuICAgKiBhcmUgd2hhdCBhIHBsYWluIGBnaXQgY29tbWl0YCB3b3VsZCBsYW5kLlxuICAgKi9cbiAgc3RhZ2VkUGF0aHMoY3dkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZ1tdPjtcbiAgLyoqXG4gICAqIFRyYWNrZWQgZmlsZXMgd2l0aCB1bnN0YWdlZCB3b3JraW5nLXRyZWUgbW9kaWZpY2F0aW9ucyBcdTIwMTRcbiAgICogYGdpdCBkaWZmIC0tbmFtZS1vbmx5YC4gRm9sZGVkIGludG8gdGhlIGNoYW5nZXNldCBvbmx5IGZvciBgLWFgL2AtYW1gXG4gICAqIGZvcm1zLCB3aGljaCBzdGFnZSB0cmFja2VkLW1vZGlmaWVkIGZpbGVzIGltcGxpY2l0bHkgYXQgY29tbWl0IHRpbWUuXG4gICAqL1xuICB0cmFja2VkTW9kaWZpZWRQYXRocyhjd2Q6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nW10+O1xuICAvKipcbiAgICogUGF0aHMgaW4gdGhlIG91dGdvaW5nIHB1c2ggcmFuZ2UgXHUyMDE0IHRoZSBmaWxlcyBjaGFuZ2VkIGJ5IGBAe3V9Li5IRUFEYCwgd2l0aFxuICAgKiBhIG1lcmdlLWJhc2UtYWdhaW5zdC10aGUtZGVmYXVsdC1yZW1vdGUtYnJhbmNoIGZhbGxiYWNrIHdoZW4gbm8gdXBzdHJlYW0gaXNcbiAgICogY29uZmlndXJlZC4gVGhlc2UgYXJlIHdoYXQgYSBgZ2l0IHB1c2hgIHdvdWxkIHB1Ymxpc2guXG4gICAqL1xuICBvdXRnb2luZ1BhdGhzKGN3ZDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmdbXT47XG4gIC8qKlxuICAgKiBQYXRocyB1bmRlciB0aGUgZ2l2ZW4gZXhwbGljaXQgcGF0aHNwZWNzIHdob3NlIHdvcmtpbmctdHJlZSBjb250ZW50IGRpZmZlcnNcbiAgICogZnJvbSBgSEVBRGAgXHUyMDE0IGBnaXQgZGlmZiBIRUFEIC0tbmFtZS1vbmx5IC0tIDxwYXRoc3BlY3M+YC4gVGhpcyBpcyB3aGF0IGFcbiAgICogcGF0aHNwZWMtc2NvcGVkIGNvbW1pdCAoYGdpdCBjb21taXQgLS0gPHBhdGhzcGVjPlx1MjAyNmApIGFjdHVhbGx5IGxhbmRzOiB0aGVcbiAgICogY3VycmVudCB3b3JraW5nLXRyZWUgY29udGVudCBhdCB0aG9zZSBwYXRoc3BlY3MsIHJlZ2FyZGxlc3Mgb2Ygd2hhdCBlbHNlIGlzXG4gICAqIHN0YWdlZC4gVXNlZCB0byBzY29wZSB0aGUgY2hhbmdlc2V0IHdoZW4ge0BsaW5rIFBhcnNlZEdpdENvbW1hbmQucGF0aHN9IGlzXG4gICAqIHByZXNlbnQsIHNvIHRoZSBnYXRlIGV2YWx1YXRlcyBleGFjdGx5IHRoZSBmaWxlcyB0aGlzIGNvbW1pdCB0YWtlcyBcdTIwMTQgbmV2ZXJcbiAgICogYW4gdW5yZWxhdGVkIHN0YWdlZCBmaWxlLCBhbmQgbmV2ZXIgbWlzc2luZyBhIG1vZGlmaWVkLWJ1dC11bnN0YWdlZCBmaWxlXG4gICAqIG5hbWVkIGluIHRoZSBwYXRoc3BlYyAod2hpY2ggYGdpdCBkaWZmIC0tY2FjaGVkYCB3b3VsZCBuZXZlciBzdXJmYWNlKS5cbiAgICovXG4gIHBhdGhzcGVjUGF0aHMocGF0aHM6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nW10+O1xufVxuXG4vKipcbiAqIFJlc29sdmUgdGhlIGNvbmNyZXRlIGxpc3Qgb2YgcmVwby1yZWxhdGl2ZSBwYXRocyBhIGdhdGVkIGNvbW1hbmQgd291bGQgbGFuZCxcbiAqIHNvIHRoZSBnYXRlIGNhbiBzY29wZSBpdHMgc3RhbGVuZXNzL2NvdmVyYWdlIGNoZWNrIHRvIGV4YWN0bHkgdGhhdCBjaGFuZ2VzZXQuXG4gKlxuICogLSBgY29tbWl0YCB3aXRoIGV4cGxpY2l0IGBwYXRoc2AgKGEgYGdpdCBjb21taXQgLS0gPHBhdGhzcGVjPlx1MjAyNmAgZm9ybSk6IG9ubHlcbiAqICAgdGhlIHdvcmtpbmctdHJlZSBjb250ZW50IHVuZGVyIHRob3NlIHBhdGhzcGVjcyAoYHBhdGhzcGVjUGF0aHNgKSwgc2luY2UgYVxuICogICBwYXRoc3BlYy1zY29wZWQgY29tbWl0IGxhbmRzIGV4YWN0bHkgdGhhdCwgcmVnYXJkbGVzcyBvZiB0aGUgcmVzdCBvZiB0aGVcbiAqICAgc3RhZ2VkIHNldC4gYGFsbGAgaXMgaWdub3JlZCBcdTIwMTQgYC1hYCBhbmQgYW4gZXhwbGljaXQgcGF0aHNwZWMgZG8gbm90IGNvbWJpbmUuXG4gKiAtIGBjb21taXRgLCBubyBgcGF0aHNgOiB0aGUgc3RhZ2VkIHBhdGhzLCBwbHVzIFx1MjAxNCB3aGVuIGBhbGxgIGlzIHRydWUgKHRoZVxuICogICBjb21tYW5kIHdhcyBhbiBgLWFgL2AtYW1gIGZvcm0pIFx1MjAxNCB0aGUgdHJhY2tlZC1tb2RpZmllZCBwYXRocyB0aG9zZSBmb3Jtc1xuICogICBzdGFnZSBpbXBsaWNpdGx5LlxuICogLSBgcHVzaGA6IHRoZSBvdXRnb2luZyByYW5nZSBgQHt1fS4uSEVBRGAsIHdpdGggYSBtZXJnZS1iYXNlIGZhbGxiYWNrIHdoZW4gbm9cbiAqICAgdXBzdHJlYW0gaXMgY29uZmlndXJlZC4gYGFsbGAvYHBhdGhzYCBhcmUgbm90IG1lYW5pbmdmdWwgZm9yIGEgcHVzaCBhbmQgYXJlXG4gKiAgIGlnbm9yZWQuXG4gKlxuICogVGhlIGBhbGxgIGZsYWcgYW5kIGBwYXRoc2AgYXJlIHRocmVhZGVkIGluIGV4cGxpY2l0bHkgKHJhdGhlciB0aGFuIHJlYWQgYmFja1xuICogb3V0IG9mIHRoZSBjb21tYW5kKSBiZWNhdXNlIHRoZSBjYWxsZXIvYWRhcHRlciBkZXJpdmVzIHRoZW0gZnJvbSB0aGUgcGFyc2U6XG4gKiBgcGF0aHNgIGlzIHtAbGluayBQYXJzZWRHaXRDb21tYW5kLnBhdGhzfSwgYW5kIGBhbGxgICh3aGljaCB7QGxpbmsgUGFyc2VkR2l0Q29tbWFuZH1cbiAqIGludGVudGlvbmFsbHkgZG9lcyBub3QgY2FycnkpIGNvbWVzIGZyb20ge0BsaW5rIGNvbW1pdFN0YWdlc0FsbH0uXG4gKlxuICogQHBhcmFtIGtpbmQgV2hldGhlciB0aGUgY2hhbmdlc2V0IGlzIGEgY29tbWl0J3Mgc3RhZ2VkIHNldCBvciBhIHB1c2gncyByYW5nZS5cbiAqIEBwYXJhbSBhbGwgV2hldGhlciB0aGUgY29tbWl0IHdhcyBhbiBgLWFgL2AtYW1gIGZvcm0gKGlnbm9yZWQgZm9yIGBwdXNoYCkuXG4gKiBAcGFyYW0gY3dkIFRoZSB3b3JraW5nIGRpcmVjdG9yeSB0aGUgZ2l0IGNvbW1hbmQgcmFuIGluLlxuICogQHBhcmFtIGdpdCBUaGUgaW5qZWN0ZWQgZ2l0IHN1cmZhY2UgYmFja2luZyB0aGUgcmVzb2x1dGlvbi5cbiAqIEBwYXJhbSBwYXRocyBFeHBsaWNpdCBwYXRoc3BlY3MgZnJvbSBgZ2l0IGNvbW1pdCAtLSA8cGF0aHNwZWM+XHUyMDI2YCwgaWYgYW55LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUNoYW5nZXNldChcbiAga2luZDogJ2NvbW1pdCcgfCAncHVzaCcsXG4gIGFsbDogYm9vbGVhbixcbiAgY3dkOiBzdHJpbmcsXG4gIGdpdDogR2l0RXhlY3V0b3IsXG4gIHBhdGhzPzogc3RyaW5nW11cbik6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgaWYgKGtpbmQgPT09ICdwdXNoJykge1xuICAgIHJldHVybiBnaXQub3V0Z29pbmdQYXRocyhjd2QpO1xuICB9XG4gIC8vIEEgcGF0aHNwZWMtc2NvcGVkIGNvbW1pdCBsYW5kcyBvbmx5IHRoZSB3b3JraW5nLXRyZWUgY29udGVudCBhdCB0aG9zZVxuICAvLyBwYXRoc3BlY3MgXHUyMDE0IHNjb3BlIHRoZSBjaGFuZ2VzZXQgdG8gZXhhY3RseSB0aGF0LCBuZXZlciB0aGUgZnVsbCBzdGFnZWQgc2V0LlxuICBpZiAocGF0aHMgJiYgcGF0aHMubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiBnaXQucGF0aHNwZWNQYXRocyhwYXRocywgY3dkKTtcbiAgfVxuICBjb25zdCBzdGFnZWQgPSBhd2FpdCBnaXQuc3RhZ2VkUGF0aHMoY3dkKTtcbiAgaWYgKCFhbGwpIHJldHVybiBzdGFnZWQ7XG4gIGNvbnN0IHRyYWNrZWQgPSBhd2FpdCBnaXQudHJhY2tlZE1vZGlmaWVkUGF0aHMoY3dkKTtcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBjb25zdCBtZXJnZWQ6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgcGF0aCBvZiBbLi4uc3RhZ2VkLCAuLi50cmFja2VkXSkge1xuICAgIGlmIChzZWVuLmhhcyhwYXRoKSkgY29udGludWU7XG4gICAgc2Vlbi5hZGQocGF0aCk7XG4gICAgbWVyZ2VkLnB1c2gocGF0aCk7XG4gIH1cbiAgcmV0dXJuIG1lcmdlZDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBHYXRlIGV2YWx1YXRpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFRoZSBpbmplY3RlZCBleGVjdXRpb24gc3VyZmFjZSBnYXRlIGV2YWx1YXRpb24gbmVlZHMgXHUyMDE0IHRoZSBgZml4YC9gc3RhbGVgL1xuICogYGxpc3RgIGFzeW5jIGZ1bmN0aW9ucywgbWlycm9yaW5nIGB0b3VjaC1jb3JlLnRzYCdzIGBUb3VjaEV4ZWN1dG9yc2AuIFRlc3RzXG4gKiBpbmplY3QgZmFrZXMgcmV0dXJuaW5nIHN0cnVjdHVyZWQgZGF0YTsgdGhlIGNvcmUgbmV2ZXIgc3Bhd25zIGEgc3VicHJvY2Vzc1xuICogaXRzZWxmLiBBbGwgcGF0aHMgYXJlIHJlcG8tcmVsYXRpdmUgUE9TSVggcGF0aHMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgR2F0ZUV4ZWN1dG9ycyB7XG4gIC8qKlxuICAgKiBSdW4gYSBzY29wZWQgYGdpdCBzcGFuIHN0YWxlIDxwYXRocz4gLS1maXhgIFx1MjAxNCB0aGUgYmVsdC1hbmQtYnJhY2VzIGhlYWwgdGhhdFxuICAgKiBydW5zIGJlZm9yZSBjbGFzc2lmaWNhdGlvbiAocGVyIENBUkQubWQpLCByZS1hbmNob3JpbmcgYW55IHBvc2l0aW9uYWwgZHJpZnRcbiAgICogaW4gdGhlIGNoYW5nZXNldCB0aGF0IHRoZSB0b3VjaCBob29rIGhhcyBub3QgYWxyZWFkeSBoZWFsZWQuIFJlcG9ydHMgbm90aGluZztcbiAgICogaXRzIGVmZmVjdCBpcyBvbiB0aGUgd29ya2luZyB0cmVlLCBhbmQgdGhlIHN1YnNlcXVlbnQge0BsaW5rIEdhdGVFeGVjdXRvcnMuc3RhbGV9XG4gICAqIHJlYWQgb2JzZXJ2ZXMgdGhlIGhlYWxlZCBzdGF0ZS5cbiAgICovXG4gIGZpeChwYXRoczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPjtcbiAgLyoqXG4gICAqIFJ1biBhIHNjb3BlZCBgZ2l0IHNwYW4gc3RhbGUgLS1mb3JtYXQgcG9yY2VsYWluIDxwYXRocz5gIGFuZCByZXR1cm4gaXRzXG4gICAqIHBhcnNlZCByb3dzIFx1MjAxNCBvbmUgcGVyIGRyaWZ0ZWQgYW5jaG9yIGFtb25nIHRoZSBjaGFuZ2VzZXQncyBzcGFucywgZW1wdHkgd2hlblxuICAgKiBjbGVhbi4gRGVidCBpcyBjbGFzc2lmaWVkIGZyb20gdGhlc2Ugcm93cyB2aWEgYGlzRGVidCgpYDsgcG9zaXRpb25hbFxuICAgKiAoYE1PVkVEYC9gUkVTT0xWRURfUEVORElOR19DT01NSVRgKSByb3dzIGFyZSBuZXZlciBkZWJ0IGFuZCBuZXZlciBkZW55LlxuICAgKlxuICAgKiBBbiBlbXB0eSByZXN1bHQgbXVzdCBtZWFuIHRoZSBzY2FuICpyYW4gYW5kIGZvdW5kIG5vdGhpbmcqLCBuZXZlciB0aGF0IHRoZVxuICAgKiBzY2FuICpjb3VsZCBub3QgcnVuKi4gV2hlbiB0aGUgc2NvcGVkIHF1ZXJ5IGFib3J0cyBiZWZvcmUgY29tcGxldGluZyAoZS5nLlxuICAgKiBhbiB1bnJlYWRhYmxlIGFuY2hvciBmaWxlKSwgdGhlIGltcGxlbWVudGF0aW9uIHRocm93cyB7QGxpbmsgR2F0ZVNjYW5FcnJvcn1cbiAgICogcmF0aGVyIHRoYW4gcmV0dXJuaW5nIGBbXWAsIHNvIHtAbGluayBldmFsdWF0ZUdhdGV9IGRvZXMgbm90IG1pc3Rha2UgYW5cbiAgICogYWJvcnRlZCBzY2FuIGZvciBhIGNsZWFuIG9uZSBhbmQgc2lsZW50bHkgYWxsb3cgdW52ZXJpZmllZCBkZWJ0IHRocm91Z2guXG4gICAqL1xuICBzdGFsZShwYXRoczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKTogUHJvbWlzZTxTdGFsZVBvcmNlbGFpblJvd1tdPjtcbiAgLyoqXG4gICAqIFJ1biBhIHNjb3BlZCBgZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbiA8cGF0aHM+YCBhbmQgcmV0dXJuIHRoZSBjb3ZlcmluZ1xuICAgKiBhbmNob3JzLiBVc2VkIHRvIGNvbXB1dGUgKnVuY292ZXJlZCB3cml0ZXMqOiBhIGNoYW5nZWQgcGF0aCB3aXRoIHplcm9cbiAgICogY292ZXJpbmcgcm93cyBoZXJlIChtaW51cyBgLnNwYW4vKipgLCBnaXRpZ25vcmVkIHBhdGhzLCBhbmRcbiAgICogYC5zcGFuLy5nYXRlaWdub3JlYC1leGNsdWRlZCBwYXRocyBcdTIwMTQgc2VlIHtAbGluayBmaWxlOi8vLi9nYXRlLWlnbm9yZS50c30pXG4gICAqIGlzIGFuIHVuY292ZXJlZCB3cml0ZS5cbiAgICovXG4gIGxpc3QocGF0aHM6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZyk6IFByb21pc2U8UG9yY2VsYWluUm93W10+O1xuICAvKipcbiAgICogUnVuIGBnaXQgc3BhbiBsaXN0IDxuYW1lcy4uLj5gIChodW1hbiBmb3JtYXQpIGFuZCByZXR1cm4gaXRzIHJhdyBzdGRvdXQgXHUyMDE0XG4gICAqIG9uZSBgIyMgPG5hbWU+YCBibG9jayBwZXIgc3BhbiAoYW5jaG9yIGJ1bGxldHMgKyBkZXNjcmlwdGlvbiksIGJsb2Nrc1xuICAgKiBzZXBhcmF0ZWQgYnkgYC0tLWAuIFRoZSBkZW55L2Fkdmlzb3J5IHJlbmRlcmVycyBhbm5vdGF0ZSB0aGVzZSBibG9ja3Mgd2l0aFxuICAgKiBwZXItYW5jaG9yIGRyaWZ0IGxhYmVscyBzbyB0aGUgc3VyZmFjZWQgbWVzc2FnZSBjYXJyaWVzIHRoZSBmdWxsIHNwYW5cbiAgICogKGFsbCBsb2NhdGlvbnMgKyBkZXNjcmlwdGlvbiksIG5vdCBqdXN0IHRoZSBkcmlmdGVkIHJvd3MuIFJldHVybnMgYCcnYCBvblxuICAgKiBhbnkgZmFpbHVyZTsge0BsaW5rIGFubm90YXRlQmxvY2tzfSB0aGVuIHN5bnRoZXNpemVzIG1pbmltYWwgYmxvY2tzIGZyb21cbiAgICogdGhlIGZpbmRpbmdzIHRoZW1zZWx2ZXMgc28gbm8gZmluZGluZyBpcyBkcm9wcGVkLlxuICAgKi9cbiAgbGlzdEJsb2NrcyhuYW1lczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+O1xufVxuXG4vKipcbiAqIFRoZSBnYXRlJ3MgcGVyLWNoYW5nZXNldCBtZW1vIFx1MjAxNCBcImhhdmUgSSBhbHJlYWR5IHByZXNlbnRlZCB0aGlzIGV4YWN0IGRlYnRcbiAqIHN0YXRlIG9uY2U/XCIgVGhlIHBlcnNpc3RlZCB1bml0IGlzIGEgZGlnZXN0IG9mIHRoZSBzb3J0ZWQgc3RhbGVuZXNzIGZpbmRpbmdzXG4gKiBwbHVzIHRoZSBzb3J0ZWQgdW5jb3ZlcmVkIHBhdGhzIChkZXNpZ24tZGVjaXNpb25zLm1kICM5J3MgXCJnYXRlIG9uY2UgcGVyXG4gKiBkaXN0aW5jdCBkZWJ0LXN0YXRlXCIpOyB0aGUgZGlzay1iYWNrZWQgaW1wbGVtZW50YXRpb24gc3RvcmVzIG9uZSBtYXJrZXIgcGVyXG4gKiBkaWdlc3QgdW5kZXIge0BsaW5rIGdhdGVNZW1vRGlyfSAoYDxnaXQtY29tbW9uLWRpcj4vZ2l0LXNwYW4vZ2F0ZS9gKSwgd2hlcmVcbiAqIHByZXNlbmNlIG1lYW5zIFwiYWxyZWFkeSBwcmVzZW50ZWQgb25jZS5cIiBJbmplY3RlZCBhcyBhIHN0b3JlIGFic3RyYWN0aW9uXG4gKiAobGlrZSBzcGFuLXN1cmZhY2UudHMncyBgTWVtb1N0b3JlYCkgc28gUGhhc2UgMy4yIGZha2VzIGl0IGluIG1lbW9yeS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBHYXRlTWVtb1N0YXRlIHtcbiAgLyoqIFdoZXRoZXIgdGhpcyBleGFjdCBkZWJ0LXN0YXRlIGRpZ2VzdCBoYXMgYWxyZWFkeSBiZWVuIHByZXNlbnRlZCBvbmNlLiAqL1xuICBoYXMoZGlnZXN0OiBzdHJpbmcpOiBib29sZWFuO1xuICAvKipcbiAgICogUmVjb3JkIHRoYXQgdGhpcyBkZWJ0LXN0YXRlIGRpZ2VzdCBoYXMgbm93IGJlZW4gcHJlc2VudGVkLCByZXR1cm5pbmdcbiAgICogd2hldGhlciB0aGUgcmVjb3JkIGFjdHVhbGx5IHBlcnNpc3RlZC4gYGZhbHNlYCBtZWFucyB0aGUgbWVtbyBjb3VsZCBub3QgYmVcbiAgICogd3JpdHRlbiAoZS5nLiBhbiB1bndyaXRhYmxlIG1lbW8gZGlyZWN0b3J5KSBcdTIwMTQgdGhlIGdhdGUgdHJlYXRzIHRoYXQgYXMgYVxuICAgKiBmYWlsLW9wZW4gc2lnbmFsIHJhdGhlciB0aGFuIGRlbnlpbmcsIGJlY2F1c2UgYSBub24tcGVyc2lzdGluZyBtZW1vIHdvdWxkXG4gICAqIHNpbGVudGx5IHR1cm4gXCJkZW55IG9uY2UsIHRoZW4gYWxsb3cgdGhlIGlkZW50aWNhbCByZXRyeVwiIGludG8gXCJkZW55IGV2ZXJ5XG4gICAqIHRpbWVcIiB3aXRoIG5vIGVzY2FwZS5cbiAgICovXG4gIHJlY29yZChkaWdlc3Q6IHN0cmluZyk6IGJvb2xlYW47XG59XG5cbi8qKlxuICogVGhlIGdhdGUncyBkZWNpc2lvbiBmb3Igb25lIGNvbW1hbmQsIGFzIGEgZGlzY3JpbWluYXRlZCB1bmlvbiB0aGUgYWRhcHRlclxuICogdHJhbnNsYXRlcyBpbnRvIGBwZXJtaXNzaW9uRGVjaXNpb246ICdkZW55J2AvYWxsb3cgKENsYXVkZSkgb3IgYSBibG9jay9hbGxvd1xuICogKENvZGV4KS4gYGRlY2lzaW9uYCBpcyB0aGUgY29hcnNlIGFsbG93L2RlbnkgdGhlIGhhcm5lc3MgYWN0cyBvbjsgYGtpbmRgXG4gKiByZWNvcmRzICp3aHkqLCBzbyB0aGUgYWRhcHRlciByZW5kZXJzIHRoZSByaWdodCBtZXNzYWdlIGFuZCBzbyB0ZXN0cyBhc3NlcnRcbiAqIHRoZSBleGFjdCBicmFuY2guXG4gKlxuICogLSBgYWxsb3dgIC8gYHNpbGVudGAgXHUyMDE0IG5vdGhpbmcgdG8gY2hlY2sgKG5vIHBhdGhzKSBvciB0aGUgY2hhbmdlc2V0IGlzIGNsZWFuO1xuICogICBhbGxvdyB3aXRoIG5vIG91dHB1dC4gSW50ZXJuYWwgZXJyb3JzIGFuZCBwYXJzZSBmYWlsdXJlcyBhbHNvIHJlc29sdmUgaGVyZTpcbiAqICAgdGhlIGdhdGUgZmFpbHMgb3BlbiBhbmQgbXVzdCBuZXZlciBicmljayBhIGNvbW1pdC5cbiAqIC0gYGFsbG93YCAvIGBhbHJlYWR5LXByZXNlbnRlZGAgXHUyMDE0IGRlYnQgaXMgcHJlc2VudCwgYnV0IHRoaXMgZXhhY3QgZGVidCBzdGF0ZVxuICogICB3YXMgYWxyZWFkeSBwcmVzZW50ZWQgb25jZSAoc2VtYW50aWMtc3RhbGVuZXNzIG9yIHVuY292ZXJlZC13cml0ZXNcbiAqICAgY29uc2lkZXItb25jZSwgb3IgYW4gdW5jaGFuZ2VkIHN0YXRlKS4gVGhlIGNvbW1hbmQgcGFzc2VzLlxuICogLSBgYWxsb3dgIC8gYGVudmlyb25tZW50YWxgIFx1MjAxNCB0aGUgY2hhbmdlc2V0J3Mgb25seSBzdGFsZW5lc3Mgcm93cyBhcmVcbiAqICAgdGVybWluYWwvZW52aXJvbm1lbnRhbCBjb25kaXRpb25zIChgQ09ORkxJQ1RgLCBgU1VCTU9EVUxFYCwgYExGU18qYCxcbiAqICAgYFBST01JU09SX01JU1NJTkdgLCBgU1BBUlNFX0VYQ0xVREVEYCwgYEZJTFRFUl9GQUlMRURgLCBgSU9fRVJST1JgKSB0aGUgQ0xJXG4gKiAgIGNvdWxkIG5vdCByZXNvbHZlIGF0IGFsbCBcdTIwMTQgbm90IHNwYW4gZHJpZnQgYSB1c2VyIGNhbiBmaXggYnkgZWRpdGluZyBhIHNwYW4uXG4gKiAgIFRoZSBnYXRlIGZhaWxzIE9QRU4gKGFsbG93KSBidXQgY2FycmllcyBgY29uZGl0aW9uc2AvYHJlYXNvbmAgc28gdGhlIGFkYXB0ZXJcbiAqICAgc3VyZmFjZXMgdGhlIGNvbmRpdGlvbiBpbnN0ZWFkIG9mIHN3YWxsb3dpbmcgaXQuIERlbnlpbmcgaGVyZSB3b3VsZCByZS1kZW55XG4gKiAgIGZvcmV2ZXIgb24gYW4gaW5mcmEgZmFpbHVyZSB0aGUgdXNlciBjYW5ub3QgY2xlYXIgZnJvbSB0aGUgZ2F0ZS5cbiAqIC0gYGFsbG93YCAvIGBzY2FuLWZhaWxlZGAgXHUyMDE0IGBnaXQgc3BhbiBzdGFsZWAgY291bGQgbm90ICpjb21wbGV0ZSogaXRzIHNjb3BlZFxuICogICBzY2FuIChhIHtAbGluayBHYXRlU2NhbkVycm9yfSwgZS5nLiBhbiB1bnJlYWRhYmxlIGFuY2hvciBmaWxlIGFib3J0aW5nIHRoZVxuICogICB3aG9sZSBxdWVyeSkuIFRoaXMgaXMgZGlzdGluY3QgZnJvbSBib3RoIGBlbnZpcm9ubWVudGFsYCAodGhlIHNjYW4gY29tcGxldGVkXG4gKiAgIGFuZCBjYXJyaWVkIHRlcm1pbmFsIHJvd3MpIGFuZCBhIGNsZWFuIHBhc3MgKHRoZSBzY2FuIGNvbXBsZXRlZCB3aXRoIHplcm9cbiAqICAgcm93cyk6IHRoZSBzY2FuIG5ldmVyIHJhbiB0byBjb21wbGV0aW9uLCBzbyBpdHMgZW1wdHkgcmVzdWx0IGlzIG5vdCBldmlkZW5jZVxuICogICBvZiBcIm5vIGRlYnQuXCIgVGhlIGdhdGUgZmFpbHMgT1BFTiBoZXJlIHRvbyBcdTIwMTQgbWF0Y2hpbmcgYGVudmlyb25tZW50YWxgIFx1MjAxNFxuICogICBidXQga2VlcHMgaXRzIG93biBga2luZGAgYW5kIGEgYHJlYXNvbmAgbmFtaW5nIHRoZSBmYWlsdXJlLCBzbyB0aGUgYWRhcHRlclxuICogICBzdXJmYWNlcyBhIHdhcm5pbmcgdGhhdCBzcGFuIGRlYnQgd2FzIE5PVCB2ZXJpZmllZCBmb3IgdGhpcyBjaGFuZ2VzZXRcbiAqICAgaW5zdGVhZCBvZiBzdGF5aW5nIHNpbGVudC4gVGhlcmUgaXMgbm8gZGVidC1zdGF0ZSB0byBtZW1vaXplOiBldmVyeVxuICogICBldmFsdWF0aW9uIG9mIGEgc3RpbGwtZmFpbGluZyBzY2FuIHdhcm5zIGFnYWluLlxuICogLSBgZGVueWAgLyBgc2VtYW50aWMtc3RhbGVuZXNzYCBcdTIwMTQgdGhlIGNoYW5nZXNldCBjYXJyaWVzIHNlbWFudGljIHN0YWxlbmVzcyxcbiAqICAgYW5kIHRoaXMgZXhhY3QgZmluZGluZ3MgZGlnZXN0IGhhcyBub3QgYmVlbiBwcmVzZW50ZWQgYmVmb3JlLiBEZW55XG4gKiAgICoqb25jZSoqLCBsaXN0aW5nIGBmaW5kaW5nc2AgYXMgYSBjaGVja2xpc3QgaW4gYHJlYXNvbmA7IGFuIGlkZW50aWNhbFxuICogICByZXRyeSAodW5jaGFuZ2VkIGZpbmRpbmdzKSBmYWxscyB0aHJvdWdoIHRvIHRoZSBlbnZpcm9ubWVudGFsIGFuZFxuICogICB1bmNvdmVyZWQgY2hlY2tzIGFuZCByZXNvbHZlcyB0byBgYWxyZWFkeS1wcmVzZW50ZWRgIHdoZW4gb3RoZXJ3aXNlXG4gKiAgIGNsZWFuLiBDaGFuZ2VkIGZpbmRpbmdzIChhIG5ldyBkaWdlc3QpIGRlbnkgZnJlc2ggKGNvbnNpZGVyLW9uY2UgcGVyXG4gKiAgIGRpc3RpbmN0IGRlYnQgc3RhdGUsIHBlciBkZXNpZ24tZGVjaXNpb25zLm1kICMxKS5cbiAqIC0gYGRlbnlgIC8gYHVuY292ZXJlZC13cml0ZXNgIFx1MjAxNCB0aGUgY2hhbmdlc2V0IGhhcyBjaGFuZ2VkIGZpbGVzIG5vIHNwYW5cbiAqICAgY292ZXJzLCBhbmQgdGhpcyBzdGF0ZSBoYXMgbm90IGJlZW4gcHJlc2VudGVkIGJlZm9yZS4gRGVueSAqKm9uY2UqKiwgbGlzdGluZ1xuICogICBgdW5jb3ZlcmVkYDsgdGhlIHJldHJ5IHdpdGggYW4gdW5jaGFuZ2VkIHN0YXRlIHJlc29sdmVzIHRvIGBhbHJlYWR5LXByZXNlbnRlZGBcbiAqICAgYW5kIHBhc3NlcyAoY29uc2lkZXItb25jZSwgcGVyIGRlc2lnbi1kZWNpc2lvbnMubWQgIzMpLlxuICovXG5leHBvcnQgdHlwZSBHYXRlUmVzdWx0ID1cbiAgfCB7IGRlY2lzaW9uOiAnYWxsb3cnOyBraW5kOiAnc2lsZW50JyB9XG4gIHwgeyBkZWNpc2lvbjogJ2FsbG93Jzsga2luZDogJ2FscmVhZHktcHJlc2VudGVkJyB9XG4gIHwgeyBkZWNpc2lvbjogJ2FsbG93Jzsga2luZDogJ2Vudmlyb25tZW50YWwnOyBjb25kaXRpb25zOiBTdGFsZVBvcmNlbGFpblJvd1tdOyByZWFzb246IHN0cmluZyB9XG4gIHwgeyBkZWNpc2lvbjogJ2FsbG93Jzsga2luZDogJ3NjYW4tZmFpbGVkJzsgcmVhc29uOiBzdHJpbmcgfVxuICB8IHsgZGVjaXNpb246ICdkZW55Jzsga2luZDogJ3NlbWFudGljLXN0YWxlbmVzcyc7IGZpbmRpbmdzOiBTdGFsZVBvcmNlbGFpblJvd1tdOyByZWFzb246IHN0cmluZyB9XG4gIHwgeyBkZWNpc2lvbjogJ2RlbnknOyBraW5kOiAndW5jb3ZlcmVkLXdyaXRlcyc7IHVuY292ZXJlZDogc3RyaW5nW107IHJlYXNvbjogc3RyaW5nIH07XG5cbi8qKlxuICogRXZhbHVhdGUgdGhlIGdhdGUgZm9yIGEgcmVzb2x2ZWQgY2hhbmdlc2V0IGFuZCBkZWNpZGUgd2hldGhlciB0byBob2xkIHRoZVxuICogY29tbWFuZC5cbiAqXG4gKiBSdW5zIGBleGVjdXRvcnMuZml4YCAoc2NvcGVkIGJlbHQtYW5kLWJyYWNlcyBgc3RhbGUgLS1maXhgKSwgdGhlbiByZWFkc1xuICogYGV4ZWN1dG9ycy5zdGFsZWAgYW5kIGNsYXNzaWZpZXMgZWFjaCBkZWJ0IHJvdyAoYGlzRGVidCgpYCkgaW50byAqc2VtYW50aWMqXG4gKiBkcmlmdCBhbmQgKmVudmlyb25tZW50YWwqIGNvbmRpdGlvbnMgKGBpc0Vudmlyb25tZW50YWxTdGF0dXMoKWApLlxuICpcbiAqIFNlbWFudGljIGRyaWZ0IChgQ0hBTkdFRGAvYERFTEVURURgKSBpcyBjaGVja2VkIGFnYWluc3QgYG1lbW9TdGF0ZWAgdmlhIGl0c1xuICogb3duIGRpZ2VzdCAoYGdhdGVTdGF0ZURpZ2VzdChzZW1hbnRpYywgW10pYCksIHRoZSBzYW1lIGRpc3RpbmN0LWRlYnQtc3RhdGVcbiAqIG1lbW8gdGhlIHVuY292ZXJlZC13cml0ZXMgY2hlY2sgYWxyZWFkeSB1c2VzOiBub3QgeWV0IHByZXNlbnRlZCBcdTIxOTIgcmVjb3JkIGl0XG4gKiBhbmQgYGRlbnlgL2BzZW1hbnRpYy1zdGFsZW5lc3NgIChhIGBtZW1vU3RhdGUucmVjb3JkYCBmYWlsdXJlIGZhaWxzIG9wZW4gdG9cbiAqIGBhbGxvd2AvYHNpbGVudGAsIHNpbmNlIGEgbm9uLXBlcnNpc3RpbmcgbWVtbyB3b3VsZCByZS1kZW55IHRoZSBpZGVudGljYWxcbiAqIHJldHJ5IGZvcmV2ZXIpOyBhbHJlYWR5IHByZXNlbnRlZCBcdTIxOTIgKipmYWxsIHRocm91Z2gqKiByYXRoZXIgdGhhbiByZXR1cm5pbmcsXG4gKiBzbyBhIHJldHJ5IHN0aWxsIHN1cmZhY2VzIGVudmlyb25tZW50YWwgYWR2aXNvcmllcyBhbmQgc3RpbGwgcnVucyB0aGVcbiAqIHVuY292ZXJlZCBjaGVjay4gV2hldGhlciB0aGUgc2VtYW50aWMgc3RhdGUgd2FzIGFscmVhZHkgcHJlc2VudGVkIGlzXG4gKiB0cmFja2VkIHNvIHRoYXQsIGlmIHRoZSBldmFsdWF0aW9uIHRoZW4gZW5kcyBjbGVhbiwgaXQgcmVzb2x2ZXMgdG9cbiAqIGBhbGxvd2AvYGFscmVhZHktcHJlc2VudGVkYCByYXRoZXIgdGhhbiBhIGJhcmUgYGFsbG93YC9gc2lsZW50YCBcdTIwMTQgbWlycm9yaW5nXG4gKiB0aGUgdW5jb3ZlcmVkIGJyYW5jaCdzIG93biBtZW1vLWhpdCByZXN1bHQuIEEgY2hhbmdlc2V0IGNhcnJ5aW5nIGJvdGhcbiAqIHVucHJlc2VudGVkIHNlbWFudGljIHN0YWxlbmVzcyBhbmQgdW5wcmVzZW50ZWQgdW5jb3ZlcmVkIHdyaXRlcyB0aGVyZWZvcmVcbiAqIGRlbmllcyB0d2ljZSAoc3RhbGVuZXNzIGZpcnN0LCB1bmNvdmVyZWQgb24gdGhlIHJldHJ5KSBiZWZvcmUgYSB0aGlyZFxuICogYXR0ZW1wdCBwYXNzZXM7IGVkaXRpbmcgb25lIHN0YWxlIHNwYW4gd2hpbGUgYW5vdGhlciByZW1haW5zIHN0YWxlIHByb2R1Y2VzXG4gKiBhIG5ldyBmaW5kaW5ncyBzZXQsIGhlbmNlIGEgbmV3IGRpZ2VzdCBhbmQgb25lIGZyZXNoIGRlbnkuIERpZ2VzdCBjb2xsaXNpb25cbiAqIGJldHdlZW4gdGhlIHR3byBjYXRlZ29yaWVzIGlzIGltcG9zc2libGU6IHRoZSBwYXlsb2FkIGlzXG4gKiBgSlNPTi5zdHJpbmdpZnkoe2ZpbmRpbmdzLCB1bmNvdmVyZWR9KWAsIGFuZCB0aGUgc2VtYW50aWMgZGlnZXN0IHBvcHVsYXRlc1xuICogYGZpbmRpbmdzYCB3aGlsZSB0aGUgdW5jb3ZlcmVkIGRpZ2VzdCBwb3B1bGF0ZXMgYHVuY292ZXJlZGAuXG4gKlxuICogRW52aXJvbm1lbnRhbCBjb25kaXRpb25zIHRoZSBDTEkgY291bGQgbm90IHJlc29sdmUgYXQgYWxsXG4gKiAoYENPTkZMSUNUYC9gU1VCTU9EVUxFYC9gTEZTXypgL2BQUk9NSVNPUl9NSVNTSU5HYC9gU1BBUlNFX0VYQ0xVREVEYC9cbiAqIGBGSUxURVJfRkFJTEVEYC9gSU9fRVJST1JgKSBcdTIxOTIgYGFsbG93YC9gZW52aXJvbm1lbnRhbGA6IGZhaWwgT1BFTiwgc3VyZmFjaW5nIHRoZVxuICogY29uZGl0aW9uIHJhdGhlciB0aGFuIGRlbnlpbmcgb24gYW4gaW5mcmEgZmFpbHVyZSBhIHNwYW4gZWRpdCBjYW5ub3QgZml4LlxuICogVW5jb3ZlcmVkIHdyaXRlcyAoY2hhbmdlZCBwYXRocyB3aXRoIHplcm8gY292ZXJhZ2UgZnJvbSBgZXhlY3V0b3JzLmxpc3RgLFxuICogbWludXMgYC5zcGFuLyoqYCwgYW5kIHBhdGhzIG1hdGNoZWQgYnkgdGhlIHJlcG8ncyBgLnNwYW4vLmdhdGVpZ25vcmVgIFx1MjAxNCBzZWVcbiAqIHtAbGluayBmaWxlOi8vLi9nYXRlLWlnbm9yZS50c30sIGxvYWRlZCBkaXJlY3RseSBmcm9tIGRpc2sgdmlhXG4gKiBgcmVzb2x2ZVJlcG9Sb290KGN3ZClgLCBmYWlsLW9wZW4gd2hlbiBhYnNlbnQvdW5yZWFkYWJsZSkgXHUyMTkyXG4gKiBgZGVueWAvYHVuY292ZXJlZC13cml0ZXNgIHRoZSBmaXJzdCB0aW1lIHRoYXQgc3RhdGUgaXMgc2VlbiwgdGhlblxuICogYGFsbG93YC9gYWxyZWFkeS1wcmVzZW50ZWRgIG9uIHJldHJ5LiBgTU9WRURgIGFuZCBgUkVTT0xWRURfUEVORElOR19DT01NSVRgXG4gKiBuZXZlciBjb250cmlidXRlIHRvIGFueSBicmFuY2ggYW5kIG5ldmVyIGRlbnkuIEFueSBpbnRlcm5hbCBlcnJvciByZXNvbHZlc1xuICogdG8gYGFsbG93YC9gc2lsZW50YCBcdTIwMTQgdGhlIGdhdGUgZmFpbHMgb3BlbiBhbmQgbmV2ZXIgYnJpY2tzIGEgY29tbWl0LlxuICpcbiAqIEEge0BsaW5rIEdhdGVTY2FuRXJyb3J9IGZyb20gYGV4ZWN1dG9ycy5zdGFsZWAgaXMgdGhlIG9uZSBjYXNlIGhhbmRsZWRcbiAqIG91dHNpZGUgdGhhdCBmbG93OiBhIHNjYW4gdGhhdCAqY291bGQgbm90IGNvbXBsZXRlKiAoZS5nLiBhbiB1bnJlYWRhYmxlXG4gKiBhbmNob3IgZmlsZSBhYm9ydHMgdGhlIHNjb3BlZCBxdWVyeSkgeWllbGRzIGFuIGVtcHR5IHJlc3VsdCB0aGF0IGlzIE5PVFxuICogZXZpZGVuY2Ugb2YgYSBjbGVhbiBjaGFuZ2VzZXQuIFJlYWRpbmcgdGhhdCBhcyBgYWxsb3dgL2BzaWxlbnRgIHdvdWxkXG4gKiBzaWxlbnRseSBzd2FsbG93IHRoZSBmYWN0IHRoYXQgdmVyaWZpY2F0aW9uIG5ldmVyIGhhcHBlbmVkLCBzbyBpdCByZXNvbHZlc1xuICogaW5zdGVhZCB0byBpdHMgb3duIGBhbGxvd2AvYHNjYW4tZmFpbGVkYCBcdTIwMTQgZmFpbCBPUEVOIGxpa2UgYGVudmlyb25tZW50YWxgXG4gKiAodGhlIGNvbW1hbmQgaXMgbm90IGhlbGQpLCBidXQgd2l0aCBhIGRpc3RpbmN0IGBraW5kYCBhbmQgYHJlYXNvbmAgc28gdGhlXG4gKiBhZGFwdGVyIHN1cmZhY2VzIGEgd2FybmluZyB0aGF0IHNwYW4gZGVidCB3YXMgTk9UIHZlcmlmaWVkIGZvciB0aGlzXG4gKiBjaGFuZ2VzZXQgcmF0aGVyIHRoYW4gc3RheWluZyBzaWxlbnQuIFRoZXJlIGlzIG5vIGRlYnQtc3RhdGUgdG8gbWVtb2l6ZVxuICogaGVyZTogZXZlcnkgZXZhbHVhdGlvbiBvZiBhIHN0aWxsLWZhaWxpbmcgc2NhbiB3YXJucyBhZ2Fpbi5cbiAqXG4gKiBAcGFyYW0gcGF0aHMgVGhlIHJlc29sdmVkIGNoYW5nZXNldCBmcm9tIHtAbGluayByZXNvbHZlQ2hhbmdlc2V0fS4gRW1wdHkgXHUyMTkyXG4gKiAgIGBhbGxvd2AvYHNpbGVudGAuXG4gKiBAcGFyYW0gY3dkIFRoZSB3b3JraW5nIGRpcmVjdG9yeSB0aGUgZ2l0IGNvbW1hbmQgcmFuIGluLlxuICogQHBhcmFtIGV4ZWN1dG9ycyBUaGUgaW5qZWN0ZWQgYGZpeGAvYHN0YWxlYC9gbGlzdGAgc3VyZmFjZS5cbiAqIEBwYXJhbSBtZW1vU3RhdGUgVGhlIHBlci1jaGFuZ2VzZXQgZGVidC1zdGF0ZSBtZW1vLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZXZhbHVhdGVHYXRlKFxuICBwYXRoczogc3RyaW5nW10sXG4gIGN3ZDogc3RyaW5nLFxuICBleGVjdXRvcnM6IEdhdGVFeGVjdXRvcnMsXG4gIG1lbW9TdGF0ZTogR2F0ZU1lbW9TdGF0ZVxuKTogUHJvbWlzZTxHYXRlUmVzdWx0PiB7XG4gIGlmIChwYXRocy5sZW5ndGggPT09IDApIHJldHVybiB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnc2lsZW50JyB9O1xuICB0cnkge1xuICAgIC8vIEJlbHQtYW5kLWJyYWNlcyBoZWFsLCB0aGVuIGNsYXNzaWZ5IGFnYWluc3QgdGhlIGhlYWxlZCBzdGF0ZS5cbiAgICBhd2FpdCBleGVjdXRvcnMuZml4KHBhdGhzLCBjd2QpO1xuICAgIGNvbnN0IHN0YWxlUm93cyA9IGF3YWl0IGV4ZWN1dG9ycy5zdGFsZShwYXRocywgY3dkKTtcblxuICAgIC8vIFNwbGl0IGRlYnQgcm93cyBpbnRvIHNlbWFudGljIGRyaWZ0IChhIHVzZXIgY2FuIGZpeCBieSBlZGl0aW5nIGEgc3BhbilcbiAgICAvLyBhbmQgdGVybWluYWwvZW52aXJvbm1lbnRhbCBjb25kaXRpb25zICh0aGUgQ0xJIGNvdWxkIG5vdCByZXNvbHZlIHRoZVxuICAgIC8vIGFuY2hvciBhdCBhbGwgXHUyMDE0IHNwYXJzZSBjaGVja291dCwgdW5mZXRjaGVkIExGUywgcGFydGlhbC1jbG9uZSBtaXNzLCBJL09cbiAgICAvLyBlcnJvcikuIGBpc0RlYnQoKWAgaXMgdGhlIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGggZm9yIHdoYXQgaXMgZGVidCBhdCBhbGw7XG4gICAgLy8gYGlzRW52aXJvbm1lbnRhbFN0YXR1cygpYCBzcGxpdHMgdGhlIGZpeGFibGUgZnJvbSB0aGUgdW5yZXNvbHZhYmxlLlxuICAgIC8vIGBNT1ZFRGAvYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCBhcmUgbmV2ZXIgZGVidCBhbmQgbmV2ZXIgY29udHJpYnV0ZS5cbiAgICBjb25zdCBkZWJ0Um93cyA9IHN0YWxlUm93cy5maWx0ZXIoKHJvdykgPT4gaXNEZWJ0KHJvdy5zdGF0dXMpKTtcbiAgICBjb25zdCBzZW1hbnRpYyA9IGRlYnRSb3dzLmZpbHRlcigocm93KSA9PiAhaXNFbnZpcm9ubWVudGFsU3RhdHVzKHJvdy5zdGF0dXMpKTtcbiAgICBjb25zdCBlbnZpcm9ubWVudGFsID0gZGVidFJvd3MuZmlsdGVyKChyb3cpID0+IGlzRW52aXJvbm1lbnRhbFN0YXR1cyhyb3cuc3RhdHVzKSk7XG5cbiAgICAvLyBTZW1hbnRpYyBzdGFsZW5lc3Mgam9pbnMgdGhlIHNhbWUgZGlzdGluY3QtZGVidC1zdGF0ZSBtZW1vIHRoZSB1bmNvdmVyZWRcbiAgICAvLyBjaGVjayB1c2VzOiBkZW55IG9uY2UgcGVyIGZpbmRpbmdzIGRpZ2VzdCwgdGhlbiBmYWxsIHRocm91Z2ggKHJhdGhlciB0aGFuXG4gICAgLy8gcmV0dXJuaW5nKSBvbiBhbiBpZGVudGljYWwgcmV0cnkgc28gdGhlIHJlc3Qgb2YgdGhlIGV2YWx1YXRpb24gc3RpbGwgcnVucy5cbiAgICBsZXQgc2VtYW50aWNBbHJlYWR5UHJlc2VudGVkID0gZmFsc2U7XG4gICAgaWYgKHNlbWFudGljLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IHNlbWFudGljRGlnZXN0ID0gZ2F0ZVN0YXRlRGlnZXN0KHNlbWFudGljLCBbXSk7XG4gICAgICBpZiAoIW1lbW9TdGF0ZS5oYXMoc2VtYW50aWNEaWdlc3QpKSB7XG4gICAgICAgIC8vIEEgbm9uLXBlcnNpc3RpbmcgbWVtbyB3cml0ZSB3b3VsZCB0dXJuIFwiZGVueSBvbmNlLCB0aGVuIGFsbG93IHRoZVxuICAgICAgICAvLyByZXRyeVwiIGludG8gXCJkZW55IGV2ZXJ5IHRpbWVcIiB3aXRoIG5vIGVzY2FwZSBcdTIwMTQgZmFpbCBvcGVuIGluc3RlYWQuXG4gICAgICAgIGlmICghbWVtb1N0YXRlLnJlY29yZChzZW1hbnRpY0RpZ2VzdCkpIHJldHVybiB7IGRlY2lzaW9uOiAnYWxsb3cnLCBraW5kOiAnc2lsZW50JyB9O1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGRlY2lzaW9uOiAnZGVueScsXG4gICAgICAgICAga2luZDogJ3NlbWFudGljLXN0YWxlbmVzcycsXG4gICAgICAgICAgZmluZGluZ3M6IHNlbWFudGljLFxuICAgICAgICAgIHJlYXNvbjogcmVuZGVyU3RhbGVuZXNzUmVhc29uKHNlbWFudGljLCBhd2FpdCBmZXRjaFNwYW5CbG9ja3MoZXhlY3V0b3JzLCBzZW1hbnRpYywgY3dkKSlcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIHNlbWFudGljQWxyZWFkeVByZXNlbnRlZCA9IHRydWU7XG4gICAgfVxuXG4gICAgLy8gRW52aXJvbm1lbnRhbCBjb25kaXRpb25zIGFyZSBub3QgYSBzcGFuIGVkaXQgYXdheSBmcm9tIHJlc29sdXRpb246IGZhaWxcbiAgICAvLyBPUEVOIChhbGxvdykgXHUyMDE0IGJ1dCBjYXJyeSB0aGVtIHNvIHRoZSBhZGFwdGVyIHN1cmZhY2VzIHRoZSBjb25kaXRpb24gcmF0aGVyXG4gICAgLy8gdGhhbiBzd2FsbG93aW5nIGl0LiBEZW55aW5nIHdvdWxkIHJlLWRlbnkgZm9yZXZlciBvbiBhbiBpbmZyYSBmYWlsdXJlIHRoZVxuICAgIC8vIHVzZXIgY2Fubm90IGNsZWFyIGZyb20gdGhlIGdhdGUsIGNvbnRyYWRpY3RpbmcgdGhlIGZhaWwtb3BlbiBjb250cmFjdCB0aGVcbiAgICAvLyByZXN0IG9mIHRoZSBnYXRlIGFscmVhZHkgaG9ub3JzIGZvciBDTEktYWJzZW50L3RpbWVvdXQvcGFyc2UgZmFpbHVyZXMuXG4gICAgaWYgKGVudmlyb25tZW50YWwubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgZGVjaXNpb246ICdhbGxvdycsXG4gICAgICAgIGtpbmQ6ICdlbnZpcm9ubWVudGFsJyxcbiAgICAgICAgY29uZGl0aW9uczogZW52aXJvbm1lbnRhbCxcbiAgICAgICAgcmVhc29uOiByZW5kZXJFbnZpcm9ubWVudGFsUmVhc29uKGVudmlyb25tZW50YWwsIGF3YWl0IGZldGNoU3BhbkJsb2NrcyhleGVjdXRvcnMsIGVudmlyb25tZW50YWwsIGN3ZCkpXG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIFVuY292ZXJlZCB3cml0ZXM6IGNoYW5nZWQgcGF0aHMgd2l0aCB6ZXJvIGNvdmVyaW5nIHNwYW4sIG1pbnVzIGAuc3Bhbi8qKmBcbiAgICAvLyAoc3BhbiByZXBhaXJzIHJpZGUgdGhlIHNhbWUgY29tbWl0IGFuZCBtdXN0IG5ldmVyIHNlbGYtdHJpZ2dlciB0aGUgZ2F0ZSlcbiAgICAvLyBhbmQgcGF0aHMgdGhlIHJlcG8ncyB1c2VyLW93bmVkIGAuc3Bhbi8uZ2F0ZWlnbm9yZWAgZXhjbHVkZXMuIEdpdGlnbm9yZWRcbiAgICAvLyBwYXRocyBuZXZlciByZWFjaCBoZXJlIFx1MjAxNCBnaXQgZG9lcyBub3Qgc3RhZ2UvcHVibGlzaCB0aGVtLlxuICAgIGNvbnN0IGNvdmVyaW5nID0gYXdhaXQgZXhlY3V0b3JzLmxpc3QocGF0aHMsIGN3ZCk7XG4gICAgY29uc3QgY292ZXJlZCA9IG5ldyBTZXQoY292ZXJpbmcubWFwKChyb3cpID0+IHJvdy5wYXRoKSk7XG4gICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICBjb25zdCBnYXRlSWdub3JlUnVsZXMgPSByZXBvUm9vdCA/IGxvYWRHYXRlSWdub3JlKHJlcG9Sb290KSA6IFtdO1xuICAgIGNvbnN0IHVuY292ZXJlZCA9IHBhdGhzLmZpbHRlcihcbiAgICAgIChwYXRoKSA9PiAhY292ZXJlZC5oYXMocGF0aCkgJiYgIWlzSW5zaWRlU3BhblJvb3QocGF0aCkgJiYgIWlzR2F0ZUlnbm9yZWQoZ2F0ZUlnbm9yZVJ1bGVzLCBwYXRoKVxuICAgICk7XG4gICAgaWYgKHVuY292ZXJlZC5sZW5ndGggPT09IDApIHtcbiAgICAgIC8vIEEgcmV0cnkgdGhhdCBmZWxsIHRocm91Z2ggcGFzdCBhbiBhbHJlYWR5LXByZXNlbnRlZCBzZW1hbnRpYy1zdGFsZW5lc3NcbiAgICAgIC8vIGRpZ2VzdCBlbmRzIGNsZWFuIGhlcmU6IHN1cmZhY2UgYWxyZWFkeS1wcmVzZW50ZWQgcmF0aGVyIHRoYW4gYSBiYXJlXG4gICAgICAvLyBzaWxlbnQgYWxsb3csIG1pcnJvcmluZyB0aGUgdW5jb3ZlcmVkIGJyYW5jaCdzIG93biBtZW1vLWhpdCByZXN1bHQuXG4gICAgICByZXR1cm4gc2VtYW50aWNBbHJlYWR5UHJlc2VudGVkXG4gICAgICAgID8geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ2FscmVhZHktcHJlc2VudGVkJyB9XG4gICAgICAgIDogeyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ3NpbGVudCcgfTtcbiAgICB9XG5cbiAgICAvLyBDb25zaWRlci1vbmNlOiBkZW55IHRoZSBmaXJzdCB0aW1lIHRoaXMgZXhhY3QgZGVidCBzdGF0ZSBpcyBzZWVuLCB0aGVuXG4gICAgLy8gcGFzcyB0aGUgcmV0cnkgd2l0aCBhbiB1bmNoYW5nZWQgc3RhdGUuIChObyBzZW1hbnRpYyByb3dzIHN1cnZpdmUgdG9cbiAgICAvLyBoZXJlIHVucHJlc2VudGVkIFx1MjAxNCB0aGUgc2VtYW50aWMgYnJhbmNoIGFib3ZlIGhhcyBhbHJlYWR5IHJldHVybmVkIGZvclxuICAgIC8vIHRoYXQgY2FzZSBcdTIwMTQgc28gdGhlIGRpZ2VzdCdzIGZpbmRpbmdzIGNvbXBvbmVudCBpcyBlbXB0eSBhbmQgdGhlIHN0YXRlXG4gICAgLy8gaXMga2V5ZWQgYnkgdGhlIHVuY292ZXJlZCBzZXQuKVxuICAgIGNvbnN0IGRpZ2VzdCA9IGdhdGVTdGF0ZURpZ2VzdChbXSwgdW5jb3ZlcmVkKTtcbiAgICBpZiAobWVtb1N0YXRlLmhhcyhkaWdlc3QpKSByZXR1cm4geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ2FscmVhZHktcHJlc2VudGVkJyB9O1xuICAgIC8vIEEgbm9uLXBlcnNpc3RpbmcgbWVtbyB3cml0ZSB3b3VsZCB0dXJuIFwiZGVueSBvbmNlLCB0aGVuIGFsbG93IHRoZSByZXRyeVwiXG4gICAgLy8gaW50byBcImRlbnkgZXZlcnkgdGltZVwiIHdpdGggbm8gZXNjYXBlIFx1MjAxNCBmYWlsIG9wZW4gcmF0aGVyIHRoYW4gZGVueS5cbiAgICBpZiAoIW1lbW9TdGF0ZS5yZWNvcmQoZGlnZXN0KSkgcmV0dXJuIHsgZGVjaXNpb246ICdhbGxvdycsIGtpbmQ6ICdzaWxlbnQnIH07XG4gICAgcmV0dXJuIHsgZGVjaXNpb246ICdkZW55Jywga2luZDogJ3VuY292ZXJlZC13cml0ZXMnLCB1bmNvdmVyZWQsIHJlYXNvbjogcmVuZGVyVW5jb3ZlcmVkUmVhc29uKHVuY292ZXJlZCkgfTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgLy8gQSBzY2FuIHRoYXQgY291bGQgbm90IENPTVBMRVRFIGlzIG5vdCBhIGNsZWFuIHJlc3VsdCwgYnV0IGl0IGlzIG5vdFxuICAgIC8vIGRlYnQgZWl0aGVyIFx1MjAxNCB0aGVyZSBpcyBub3RoaW5nIGhlcmUgZm9yIGEgdXNlciB0byByZXNvbHZlIGJ5IGVkaXRpbmcgYVxuICAgIC8vIHNwYW4uIEZhaWwgT1BFTiB3aXRoIGEgZGlzdGluZ3Vpc2hhYmxlIGBzY2FuLWZhaWxlZGAgd2FybmluZyBpbnN0ZWFkIG9mXG4gICAgLy8gc2lsZW50bHkgcmVhZGluZyB0aGUgYWJvcnRlZCBzY2FuJ3MgZW1wdHkgcmVzdWx0IGFzIGNsZWFuLlxuICAgIGlmIChlcnIgaW5zdGFuY2VvZiBHYXRlU2NhbkVycm9yKSB7XG4gICAgICByZXR1cm4geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ3NjYW4tZmFpbGVkJywgcmVhc29uOiByZW5kZXJTY2FuRmFpbGVkUmVhc29uKGVyci5kZXRhaWwpIH07XG4gICAgfVxuICAgIC8vIEZhaWwgb3BlbjogYW55IG90aGVyIGludGVybmFsL0NMSSBlcnJvciByZXNvbHZlcyB0byBhbGxvdy4gVGhlIGdhdGUgbXVzdFxuICAgIC8vIG5ldmVyIGJyaWNrIGEgY29tbWl0IG9uIGl0cyBvd24gZmFpbHVyZS5cbiAgICByZXR1cm4geyBkZWNpc2lvbjogJ2FsbG93Jywga2luZDogJ3NpbGVudCcgfTtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERlYnQtc3RhdGUgZGlnZXN0IGFuZCByZWFzb24gcmVuZGVyaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIGBwYXRoI0xzdGFydC1MZW5kYCwgb3IgYSBiYXJlIHBhdGggZm9yIGEgd2hvbGUtZmlsZSBhbmNob3IuICovXG5mdW5jdGlvbiBhbmNob3JUZXh0KHJvdzogU3RhbGVQb3JjZWxhaW5Sb3cpOiBzdHJpbmcge1xuICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIHJldHVybiByb3cucGF0aDtcbiAgcmV0dXJuIGAke3Jvdy5wYXRofSNMJHtyb3cuc3RhcnR9LUwke3Jvdy5lbmR9YDtcbn1cblxuLyoqXG4gKiBUaGUgZGlzdGluY3QtZGVidC1zdGF0ZSBkaWdlc3QgKGRlc2lnbi1kZWNpc2lvbnMubWQgIzkpOiBhIHN0YWJsZSBoYXNoIG9mIHRoZVxuICogc29ydGVkIHN0YWxlbmVzcyBmaW5kaW5ncyBwbHVzIHRoZSBzb3J0ZWQgdW5jb3ZlcmVkIHBhdGhzLiBQcmVzZW5jZSBpbiB0aGVcbiAqIG1lbW8gbWVhbnMgXCJ0aGlzIGV4YWN0IHN0YXRlIHdhcyBhbHJlYWR5IHByZXNlbnRlZCBvbmNlLlwiXG4gKi9cbmZ1bmN0aW9uIGdhdGVTdGF0ZURpZ2VzdChmaW5kaW5nczogU3RhbGVQb3JjZWxhaW5Sb3dbXSwgdW5jb3ZlcmVkOiBzdHJpbmdbXSk6IHN0cmluZyB7XG4gIGNvbnN0IGZpbmRpbmdLZXlzID0gZmluZGluZ3MubWFwKChyb3cpID0+IGAke3Jvdy5zdGF0dXN9XFx0JHtyb3cubmFtZX1cXHQke3Jvdy5wYXRofVxcdCR7cm93LnN0YXJ0fVxcdCR7cm93LmVuZH1gKS5zb3J0KCk7XG4gIGNvbnN0IHBheWxvYWQgPSBKU09OLnN0cmluZ2lmeSh7IGZpbmRpbmdzOiBmaW5kaW5nS2V5cywgdW5jb3ZlcmVkOiBbLi4udW5jb3ZlcmVkXS5zb3J0KCkgfSk7XG4gIHJldHVybiBjcmVhdGVIYXNoKCdzaGEyNTYnKS51cGRhdGUocGF5bG9hZCkuZGlnZXN0KCdoZXgnKTtcbn1cblxuLyoqXG4gKiBGZXRjaCB0aGUgaHVtYW4tZm9ybWF0IGAjIyA8bmFtZT5gIGJsb2NrcyBmb3IgdGhlIHNwYW5zIG5hbWVkIGluIGByb3dzYCxcbiAqIGZhaWxpbmcgdG8gYCcnYCAobmV2ZXIgdGhyb3dpbmcpIHNvIGEgbGlzdCBmYWlsdXJlIGNhbiBuZXZlciB0dXJuIGEgZGVueVxuICogaW50byBhIHNpbGVudCBhbGxvdyB2aWEge0BsaW5rIGV2YWx1YXRlR2F0ZX0ncyBvdXRlciBjYXRjaCBcdTIwMTRcbiAqIHtAbGluayBhbm5vdGF0ZUJsb2Nrc30gc3ludGhlc2l6ZXMgbWluaW1hbCBibG9ja3MgZnJvbSB0aGUgcm93cyBpbnN0ZWFkLlxuICovXG5hc3luYyBmdW5jdGlvbiBmZXRjaFNwYW5CbG9ja3MoZXhlY3V0b3JzOiBHYXRlRXhlY3V0b3JzLCByb3dzOiBTdGFsZVBvcmNlbGFpblJvd1tdLCBjd2Q6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IG5hbWVzID0gWy4uLm5ldyBTZXQocm93cy5tYXAoKHJvdykgPT4gcm93Lm5hbWUpKV0uc29ydCgpO1xuICB0cnkge1xuICAgIHJldHVybiBhd2FpdCBleGVjdXRvcnMubGlzdEJsb2NrcyhuYW1lcywgY3dkKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuICcnO1xuICB9XG59XG5cbi8qKlxuICogQW5ub3RhdGUgYGdpdCBzcGFuIGxpc3RgIGh1bWFuIGJsb2NrcyB3aXRoIHBlci1hbmNob3IgZHJpZnQgbGFiZWxzOiBlYWNoXG4gKiBidWxsZXQgd2hvc2UgYW5jaG9yIG1hdGNoZXMgYSBmaW5kaW5nIGdhaW5zIGAgXHUyMDE0IDxsYWJlbD5gLiBCdWxsZXRzIGFyZSBvbmx5XG4gKiB0aGUgY29udGlndW91cyBgLSBgIHJ1biBkaXJlY3RseSB1bmRlciBhIGAjIyA8bmFtZT5gIGhlYWRlciwgc28gYVxuICogZGVzY3JpcHRpb24gbGluZSB0aGF0IGhhcHBlbnMgdG8gc3RhcnQgd2l0aCBgLSBgIGlzIG5ldmVyIGFubm90YXRlZC5cbiAqIEZpbmRpbmdzIHdob3NlIGFuY2hvciBoYXMgbm8gbWF0Y2hpbmcgYnVsbGV0IGFyZSBhcHBlbmRlZCB0byB0aGVpciBzcGFuJ3NcbiAqIGJ1bGxldCBydW47IHNwYW5zIGFic2VudCBmcm9tIGBibG9ja3NUZXh0YCBlbnRpcmVseSAob3IgYW4gZW1wdHkvZmFpbGVkXG4gKiBsaXN0IHJlYWQpIGdldCBhIHN5bnRoZXNpemVkIG1pbmltYWwgYmxvY2sgXHUyMDE0IG5vIGZpbmRpbmcgaXMgZXZlciBkcm9wcGVkLlxuICovXG5mdW5jdGlvbiBhbm5vdGF0ZUJsb2NrcyhibG9ja3NUZXh0OiBzdHJpbmcsIHJvd3M6IFN0YWxlUG9yY2VsYWluUm93W10pOiBzdHJpbmcge1xuICBjb25zdCByZW1haW5pbmcgPSBuZXcgTWFwPHN0cmluZywgU3RhbGVQb3JjZWxhaW5Sb3dbXT4oKTtcbiAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgIGNvbnN0IGdyb3VwID0gcmVtYWluaW5nLmdldChyb3cubmFtZSk7XG4gICAgaWYgKGdyb3VwKSBncm91cC5wdXNoKHJvdyk7XG4gICAgZWxzZSByZW1haW5pbmcuc2V0KHJvdy5uYW1lLCBbcm93XSk7XG4gIH1cblxuICBjb25zdCBvdXQ6IHN0cmluZ1tdID0gW107XG4gIGxldCBwZW5kaW5nOiBTdGFsZVBvcmNlbGFpblJvd1tdID0gW107XG4gIGxldCBpbkJ1bGxldHMgPSBmYWxzZTtcbiAgY29uc3QgY2xvc2VCdWxsZXRzID0gKCk6IHZvaWQgPT4ge1xuICAgIGZvciAoY29uc3Qgcm93IG9mIHBlbmRpbmcpIG91dC5wdXNoKGAtICR7YW5jaG9yVGV4dChyb3cpfSBcdTIwMTQgJHtodW1hblN0YXR1c0xhYmVsKHJvdy5zdGF0dXMpfWApO1xuICAgIHBlbmRpbmcgPSBbXTtcbiAgICBpbkJ1bGxldHMgPSBmYWxzZTtcbiAgfTtcblxuICBjb25zdCB0cmltbWVkID0gYmxvY2tzVGV4dC50cmltKCk7XG4gIGlmICh0cmltbWVkLmxlbmd0aCA+IDApIHtcbiAgICBmb3IgKGNvbnN0IGxpbmUgb2YgdHJpbW1lZC5zcGxpdCgnXFxuJykpIHtcbiAgICAgIGNvbnN0IGhlYWRlciA9IC9eIyMgKC4rKSQvLmV4ZWMobGluZSk7XG4gICAgICBpZiAoaGVhZGVyKSB7XG4gICAgICAgIGNsb3NlQnVsbGV0cygpO1xuICAgICAgICBvdXQucHVzaChsaW5lKTtcbiAgICAgICAgcGVuZGluZyA9IHJlbWFpbmluZy5nZXQoaGVhZGVyWzFdKSA/PyBbXTtcbiAgICAgICAgcmVtYWluaW5nLmRlbGV0ZShoZWFkZXJbMV0pO1xuICAgICAgICBpbkJ1bGxldHMgPSB0cnVlO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChpbkJ1bGxldHMgJiYgbGluZS5zdGFydHNXaXRoKCctICcpKSB7XG4gICAgICAgIGNvbnN0IGFkZHIgPSBsaW5lLnNsaWNlKDIpO1xuICAgICAgICBsZXQgaWR4ID0gcGVuZGluZy5maW5kSW5kZXgoKHJvdykgPT4gYW5jaG9yVGV4dChyb3cpID09PSBhZGRyKTtcbiAgICAgICAgaWYgKGlkeCA9PT0gLTEpIGlkeCA9IHBlbmRpbmcuZmluZEluZGV4KChyb3cpID0+IGFkZHIgPT09IHJvdy5wYXRoIHx8IGFkZHIuc3RhcnRzV2l0aChgJHtyb3cucGF0aH0jYCkpO1xuICAgICAgICBpZiAoaWR4ID49IDApIHtcbiAgICAgICAgICBjb25zdCBbcm93XSA9IHBlbmRpbmcuc3BsaWNlKGlkeCwgMSk7XG4gICAgICAgICAgb3V0LnB1c2goYCR7bGluZX0gXHUyMDE0ICR7aHVtYW5TdGF0dXNMYWJlbChyb3cuc3RhdHVzKX1gKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBvdXQucHVzaChsaW5lKTtcbiAgICAgICAgfVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChpbkJ1bGxldHMpIGNsb3NlQnVsbGV0cygpO1xuICAgICAgb3V0LnB1c2gobGluZSk7XG4gICAgfVxuICAgIGNsb3NlQnVsbGV0cygpO1xuICB9XG5cbiAgZm9yIChjb25zdCBbbmFtZSwgZ3JvdXBdIG9mIHJlbWFpbmluZykge1xuICAgIGlmIChvdXQubGVuZ3RoID4gMCkgb3V0LnB1c2goJycsICctLS0nLCAnJyk7XG4gICAgb3V0LnB1c2goYCMjICR7bmFtZX1gKTtcbiAgICBmb3IgKGNvbnN0IHJvdyBvZiBncm91cCkgb3V0LnB1c2goYC0gJHthbmNob3JUZXh0KHJvdyl9IFx1MjAxNCAke2h1bWFuU3RhdHVzTGFiZWwocm93LnN0YXR1cyl9YCk7XG4gIH1cblxuICByZXR1cm4gb3V0LmpvaW4oJ1xcbicpO1xufVxuXG4vKiogVGhlIGZ1bGwtc3BhbiBjaGVja2xpc3QgYSBzZW1hbnRpYy1zdGFsZW5lc3MgZGVueSByZW5kZXJzIGludG8gYHJlYXNvbmAuICovXG5mdW5jdGlvbiByZW5kZXJTdGFsZW5lc3NSZWFzb24oZmluZGluZ3M6IFN0YWxlUG9yY2VsYWluUm93W10sIGJsb2Nrc1RleHQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG5hbWVzID0gWy4uLm5ldyBTZXQoZmluZGluZ3MubWFwKChyb3cpID0+IHJvdy5uYW1lKSldO1xuICBjb25zdCBzdWJqZWN0ID0gbmFtZXMubGVuZ3RoID09PSAxID8gJ2FuIGltcGxpY2l0IGRlcGVuZGVuY3knIDogJ2ltcGxpY2l0IGRlcGVuZGVuY2llcyc7XG4gIGNvbnN0IG5hbWUgPSBuYW1lcy5sZW5ndGggPT09IDEgPyBuYW1lc1swXSA6ICc8bmFtZT4nO1xuICByZXR1cm4gW1xuICAgIGBUaGlzIGNoYW5nZSBsZWF2ZXMgJHtzdWJqZWN0fSBvdXQgb2YgZGF0ZTpgLFxuICAgICcnLFxuICAgIGFubm90YXRlQmxvY2tzKGJsb2Nrc1RleHQsIGZpbmRpbmdzKSxcbiAgICAnJyxcbiAgICAnLS0tJyxcbiAgICAnJyxcbiAgICBgVXBkYXRlIHRoZSBkcmlmdGVkIGxvY2F0aW9ucyBvciB0aGUgZGVzY3JpcHRpb24gXHUyMDE0IFxcYGdpdCBzcGFuIGFkZCAke25hbWV9IDxwYXRoI0xzdGFydC1MZW5kPlxcYCAvIFxcYGdpdCBzcGFuIHdoeSAke25hbWV9IC1tIFwiLi4uXCJcXGAgXHUyMDE0IHRoZW4gcmV0cnkuIElmIGEgZGVwZW5kZW5jeSBubyBsb25nZXIgaG9sZHMsIHRlbGwgdGhlIHVzZXIgaW5zdGVhZC5gXG4gIF0uam9pbignXFxuJyk7XG59XG5cbi8qKlxuICogVGhlIGFkdmlzb3J5IHN1cmZhY2VkIHdoZW4gdGhlIGNoYW5nZXNldCdzIG9ubHkgc3RhbGVuZXNzIGlzIGVudmlyb25tZW50YWwgXHUyMDE0XG4gKiB0aGUgZ2F0ZSBhbGxvd3MgYnV0IHNheXMgd2h5LCBzbyB0aGUgdW5yZXNvbHZhYmxlIGNvbmRpdGlvbiBpcyBub3Qgc2lsZW50bHlcbiAqIHN3YWxsb3dlZC5cbiAqL1xuZnVuY3Rpb24gcmVuZGVyRW52aXJvbm1lbnRhbFJlYXNvbihjb25kaXRpb25zOiBTdGFsZVBvcmNlbGFpblJvd1tdLCBibG9ja3NUZXh0OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gW1xuICAgICdDb3VsZCBub3QgY2hlY2sgdGhlc2UgaW1wbGljaXQgZGVwZW5kZW5jaWVzICh1bmZldGNoZWQgTEZTLCBzcGFyc2UgY2hlY2tvdXQsIG9yIHNpbWlsYXIpIFx1MjAxNCBub3QgYmxvY2tpbmc6JyxcbiAgICAnJyxcbiAgICBhbm5vdGF0ZUJsb2NrcyhibG9ja3NUZXh0LCBjb25kaXRpb25zKSxcbiAgICAnJyxcbiAgICAnLS0tJyxcbiAgICAnJyxcbiAgICAnRml4IHRoZSBjaGVja291dC9mZXRjaCBpc3N1ZSBpZiB0aGVzZSBkZXBlbmRlbmNpZXMgbmVlZCB2ZXJpZnlpbmcuJ1xuICBdLmpvaW4oJ1xcbicpO1xufVxuXG4vKipcbiAqIFRoZSBhZHZpc29yeSBhbiBgYWxsb3dgL2BzY2FuLWZhaWxlZGAgcmVzdWx0IHJlbmRlcnMgaW50byBgcmVhc29uYDogdGhlIHNjYW5cbiAqIGNvdWxkIG5vdCBjb21wbGV0ZSwgc28gdGhlIGNoYW5nZXNldCB3YXMgTk9UIHZlcmlmaWVkIFx1MjAxNCBidXQgdGhlIGNvbW1hbmRcbiAqIHByb2NlZWRzIGFueXdheSAoZmFpbC1vcGVuLCBtYXRjaGluZyBgZW52aXJvbm1lbnRhbGApLlxuICovXG5mdW5jdGlvbiByZW5kZXJTY2FuRmFpbGVkUmVhc29uKGRldGFpbDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIFtcbiAgICAnVGhlIGltcGxpY2l0LWRlcGVuZGVuY3kgY2hlY2sgY291bGQgbm90IHJ1biwgc28gdGhpcyBjaGFuZ2Ugd2FzIE5PVCB2ZXJpZmllZDonLFxuICAgIGAgICR7ZGV0YWlsfWAsXG4gICAgJycsXG4gICAgJ1RoZSBjb21tYW5kIHByb2NlZWRzIGFueXdheS4gRml4IHRoZSBzY2FuIGVycm9yIGlmIHZlcmlmaWNhdGlvbiBtYXR0ZXJzIGZvciB0aGlzIGNoYW5nZS4nXG4gIF0uam9pbignXFxuJyk7XG59XG5cbi8qKiBUaGUgb25lLXRpbWUgbGlzdCBhbiB1bmNvdmVyZWQtd3JpdGVzIGRlbnkgcmVuZGVycyBpbnRvIGByZWFzb25gLiAqL1xuZnVuY3Rpb24gcmVuZGVyVW5jb3ZlcmVkUmVhc29uKHVuY292ZXJlZDogc3RyaW5nW10pOiBzdHJpbmcge1xuICBjb25zdCBsaW5lcyA9IHVuY292ZXJlZC5tYXAoKHBhdGgpID0+IGAgIC0gJHtwYXRofWApO1xuICByZXR1cm4gW1xuICAgICdEZWNpZGUgd2hldGhlciB0aGVzZSBjaGFuZ2VkIGZpbGVzIGNhcnJ5IGFuIGltcGxpY2l0IGRlcGVuZGVuY3kgXHUyMDE0IGNvZGUga2VwdCBjb25zaXN0ZW50IHdpdGggb3RoZXIgbG9jYXRpb25zIHRoYXQgbm90aGluZyBsaW5rcyB0byBpdDonLFxuICAgIC4uLmxpbmVzLFxuICAgICcnLFxuICAgICdJZiBvbmUgZXhpc3RzOiBgZ2l0IHNwYW4gYWRkIDxuYW1lPiA8cGF0aCNMc3RhcnQtTGVuZD5gIHRoZW4gYGdpdCBzcGFuIHdoeSA8bmFtZT4gLW0gXCJvbmUgc2VudGVuY2U6IHRoZSBzdWJzeXN0ZW0sIHdoYXQgaXQgZG9lcyBhY3Jvc3MgbG9jYXRpb25zXCJgLiBPdGhlcndpc2UgcmV0cnkgdGhlIGNvbW1hbmQgdG8gcHJvY2VlZCAob25lLXRpbWUgY2hlY2spLidcbiAgXS5qb2luKCdcXG4nKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBEZWZhdWx0IHN1YnByb2Nlc3MvZGlzay1iYWNrZWQgZGVwZW5kZW5jaWVzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vXG4vLyBUaGUgcHJvZHVjdGlvbiBzdXJmYWNlcyBib3RoIGFkYXB0ZXJzIGluamVjdCBieSBkZWZhdWx0LCBmb2xsb3dpbmdcbi8vIHRvdWNoLWNvcmUudHMncyBgY3JlYXRlRGVmYXVsdFRvdWNoRXhlY3V0b3JzYCBzdHlsZTogZWFjaCBjYXB0dXJlcyBzdGRvdXQgZXZlblxuLy8gb24gYSBub24temVybyBleGl0IHdoZXJlIHRoZSBDTEkgc3RpbGwgZW1pdHMgdXNlZnVsIG91dHB1dCwgYW5kIGV2ZXJ5IGZhaWx1cmVcbi8vIG1vZGUgKGFic2VudCBiaW5hcnksIHRpbWVvdXQsIG5vIHJlcG8pIHN1cmZhY2VzIGFzIGFuIGVtcHR5L2NsZWFuIHJlc3VsdCBzb1xuLy8gdGhlIGdhdGUncyBmYWlsLW9wZW4gY29udHJhY3QgaG9sZHMgd2l0aG91dCB0aGUgYWRhcHRlciBhZGRpbmcgaXRzIG93bi5cblxuY29uc3QgREVGQVVMVF9USU1FT1VUX01TID0gMTBfMDAwO1xuXG4vKiogUnVuIGEgZ2l0IGNvbW1hbmQgYXQgYGN3ZGAsIHJldHVybmluZyB0cmltbWVkIG5vbi1lbXB0eSBQT1NJWCBvdXRwdXQgbGluZXMgKGVtcHR5IG9uIGFueSBmYWlsdXJlKS4gKi9cbmZ1bmN0aW9uIGdpdExpbmVzKGFyZ3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZywgdGltZW91dE1zOiBudW1iZXIpOiBzdHJpbmdbXSB7XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBhcmdzLCB7XG4gICAgICBjd2QsXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICB9KTtcbiAgICByZXR1cm4gb3V0XG4gICAgICAuc3BsaXQoJ1xcbicpXG4gICAgICAubWFwKChsaW5lKSA9PiBsaW5lLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoKGxpbmUpID0+IGxpbmUubGVuZ3RoID4gMClcbiAgICAgIC5tYXAodG9Qb3NpeCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBbXTtcbiAgfVxufVxuXG4vKipcbiAqIExpa2Uge0BsaW5rIGdpdExpbmVzfSBidXQgZGlzdGluZ3Vpc2hlcyBhICpmYWlsZWQqIGludm9jYXRpb24gKGBudWxsYCBcdTIwMTQgZS5nLlxuICogYEB7dX1gIHdpdGggbm8gdXBzdHJlYW0gY29uZmlndXJlZCkgZnJvbSBhICpzdWNjZXNzZnVsIGJ1dCBlbXB0eSogcmVzdWx0XG4gKiAoYFtdYCksIHNvIHRoZSBvdXRnb2luZy1yYW5nZSByZXNvbHV0aW9uIGtub3dzIHdoZW4gdG8gdHJ5IHRoZSBtZXJnZS1iYXNlXG4gKiBmYWxsYmFjayByYXRoZXIgdGhhbiBtaXN0YWtpbmcgXCJubyB1cHN0cmVhbVwiIGZvciBcIm5vdGhpbmcgdG8gcHVzaFwiLlxuICovXG5mdW5jdGlvbiBnaXRMaW5lc09yTnVsbChhcmdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcsIHRpbWVvdXRNczogbnVtYmVyKTogc3RyaW5nW10gfCBudWxsIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIGFyZ3MsIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgIH0pO1xuICAgIHJldHVybiBvdXRcbiAgICAgIC5zcGxpdCgnXFxuJylcbiAgICAgIC5tYXAoKGxpbmUpID0+IGxpbmUudHJpbSgpKVxuICAgICAgLmZpbHRlcigobGluZSkgPT4gbGluZS5sZW5ndGggPiAwKVxuICAgICAgLm1hcCh0b1Bvc2l4KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqIFRoZSBwcm9kdWN0aW9uIHtAbGluayBHaXRFeGVjdXRvcn06IGBnaXQgZGlmZmAgcmVhZHMgc2NvcGVkIHRvIHRoZSBDV0QgcmVwby4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0R2l0RXhlY3V0b3IodGltZW91dE1zOiBudW1iZXIgPSBERUZBVUxUX1RJTUVPVVRfTVMpOiBHaXRFeGVjdXRvciB7XG4gIHJldHVybiB7XG4gICAgc3RhZ2VkUGF0aHM6IGFzeW5jIChjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290KSByZXR1cm4gW107XG4gICAgICByZXR1cm4gZ2l0TGluZXMoWyctQycsIHJlcG9Sb290LCAnZGlmZicsICctLWNhY2hlZCcsICctLW5hbWUtb25seSddLCByZXBvUm9vdCwgdGltZW91dE1zKTtcbiAgICB9LFxuICAgIHRyYWNrZWRNb2RpZmllZFBhdGhzOiBhc3luYyAoY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCkgcmV0dXJuIFtdO1xuICAgICAgcmV0dXJuIGdpdExpbmVzKFsnLUMnLCByZXBvUm9vdCwgJ2RpZmYnLCAnLS1uYW1lLW9ubHknXSwgcmVwb1Jvb3QsIHRpbWVvdXRNcyk7XG4gICAgfSxcbiAgICBvdXRnb2luZ1BhdGhzOiBhc3luYyAoY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCkgcmV0dXJuIFtdO1xuICAgICAgY29uc3QgdXBzdHJlYW0gPSBnaXRMaW5lc09yTnVsbChbJy1DJywgcmVwb1Jvb3QsICdkaWZmJywgJy0tbmFtZS1vbmx5JywgJ0B7dX0uLkhFQUQnXSwgcmVwb1Jvb3QsIHRpbWVvdXRNcyk7XG4gICAgICBpZiAodXBzdHJlYW0gIT09IG51bGwpIHJldHVybiB1cHN0cmVhbTtcbiAgICAgIC8vIE5vIHVwc3RyZWFtIGNvbmZpZ3VyZWQ6IGZhbGwgYmFjayB0byB0aGUgbWVyZ2UtYmFzZSB3aXRoIHRoZSBkZWZhdWx0XG4gICAgICAvLyByZW1vdGUgYnJhbmNoIChgb3JpZ2luL0hFQURgKS4gSWYgdGhhdCB0b28gaXMgdW5yZXNvbHZhYmxlLCBmYWlsIG9wZW4uXG4gICAgICBjb25zdCBiYXNlID0gZ2l0TGluZXMoWyctQycsIHJlcG9Sb290LCAnbWVyZ2UtYmFzZScsICdIRUFEJywgJ29yaWdpbi9IRUFEJ10sIHJlcG9Sb290LCB0aW1lb3V0TXMpWzBdO1xuICAgICAgaWYgKCFiYXNlKSByZXR1cm4gW107XG4gICAgICByZXR1cm4gZ2l0TGluZXMoWyctQycsIHJlcG9Sb290LCAnZGlmZicsICctLW5hbWUtb25seScsIGAke2Jhc2V9Li5IRUFEYF0sIHJlcG9Sb290LCB0aW1lb3V0TXMpO1xuICAgIH0sXG4gICAgcGF0aHNwZWNQYXRoczogYXN5bmMgKHBhdGhzLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBpZiAoIXJlcG9Sb290IHx8IHBhdGhzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICAgICAgLy8gV29ya2luZy10cmVlIGNvbnRlbnQgdnMgSEVBRCwgc2NvcGVkIHRvIHRoZSBwYXRoc3BlY3MgXHUyMDE0IHRoZSBmaWxlcyBhXG4gICAgICAvLyBgZ2l0IGNvbW1pdCAtLSA8cGF0aHNwZWM+YCB3b3VsZCBhY3R1YWxseSBjaGFuZ2UgKHN0YWdlZCBvciBub3QpLlxuICAgICAgcmV0dXJuIGdpdExpbmVzKFsnLUMnLCByZXBvUm9vdCwgJ2RpZmYnLCAnSEVBRCcsICctLW5hbWUtb25seScsICctLScsIC4uLnBhdGhzXSwgcmVwb1Jvb3QsIHRpbWVvdXRNcyk7XG4gICAgfVxuICB9O1xufVxuXG4vKiogVGhlIHByb2R1Y3Rpb24ge0BsaW5rIEdhdGVFeGVjdXRvcnN9OiBzY29wZWQgYGdpdCBzcGFuYCBmaXgvc3RhbGUvbGlzdCBhdCB0aGUgcmVwbyByb290LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHRHYXRlRXhlY3V0b3JzKHRpbWVvdXRNczogbnVtYmVyID0gREVGQVVMVF9USU1FT1VUX01TKTogR2F0ZUV4ZWN1dG9ycyB7XG4gIHJldHVybiB7XG4gICAgZml4OiBhc3luYyAocGF0aHMsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGlmICghcmVwb1Jvb3QgfHwgcGF0aHMubGVuZ3RoID09PSAwKSByZXR1cm47XG4gICAgICB0cnkge1xuICAgICAgICBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdzdGFsZScsIC4uLnBhdGhzLCAnLS1maXgnXSwge1xuICAgICAgICAgIGN3ZDogcmVwb1Jvb3QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIGBnaXQgc3BhbiBzdGFsZWAgZXhpdHMgMSBvbiBkcmlmdCBldmVuIGFmdGVyIGhlYWxpbmcsIGFuZCBub24temVybyBvblxuICAgICAgICAvLyBnZW51aW5lIGZhaWx1cmU7IGVpdGhlciB3YXkgdGhlIHN1YnNlcXVlbnQgYHN0YWxlYCByZWFkIGlzIHRoZSBzb3VyY2VcbiAgICAgICAgLy8gb2YgdHJ1dGgsIHNvIHRoZSBleGl0IGNvZGUgaXMgaWdub3JlZCBoZXJlLlxuICAgICAgfVxuICAgIH0sXG4gICAgc3RhbGU6IGFzeW5jIChwYXRocywgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCB8fCBwYXRocy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgICAgIGxldCBvdXQ6IHN0cmluZztcbiAgICAgIHRyeSB7XG4gICAgICAgIG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ3N0YWxlJywgJy0tZm9ybWF0JywgJ3BvcmNlbGFpbicsIC4uLnBhdGhzXSwge1xuICAgICAgICAgIGN3ZDogcmVwb1Jvb3QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIC8vIGBnaXQgc3BhbiBzdGFsZWAgZXhpdHMgbm9uLXplcm8gaW4gdHdvIHZlcnkgZGlmZmVyZW50IHdheXMsIGFuZCB0aGV5XG4gICAgICAgIC8vIG11c3Qgbm90IGJlIGNvbmZsYXRlZDpcbiAgICAgICAgLy8gIC0gTGVnaXRpbWF0ZSBkcmlmdDogcmVhbCBwb3JjZWxhaW4gcm93cyBvbiBzdGRvdXQgZGVzY3JpYmluZyB0aGVcbiAgICAgICAgLy8gICAgZHJpZnQuIFBhcnNlIHRoZW0gKHRoaXMgaXMgdGhlIHdob2xlIHBvaW50IG9mIHRoZSByZWFkKS5cbiAgICAgICAgLy8gIC0gSGFyZCBzY2FuIGZhaWx1cmU6IHRoZSBzY29wZWQgcXVlcnkgYWJvcnRlZCBiZWZvcmUgY29tcGxldGluZyAoZS5nLlxuICAgICAgICAvLyAgICBhbiB1bnJlYWRhYmxlIGFuY2hvciBmaWxlKSwgd3JpdGluZyBhbiBlcnJvciB0byBzdGRlcnIgYW5kIGVtaXR0aW5nXG4gICAgICAgIC8vICAgIGVtcHR5IHN0ZG91dC4gQW4gZW1wdHkgcmVzdWx0IGhlcmUgaXMgTk9UIFwiY2xlYW5cIiBcdTIwMTQgdGhlIHNjYW4gbmV2ZXJcbiAgICAgICAgLy8gICAgcmFuIHRvIGNvbXBsZXRpb24gXHUyMDE0IHNvIHNpZ25hbCBpdCBkaXN0aW5jdGx5IHJhdGhlciB0aGFuIHBhcnNpbmcgdG9cbiAgICAgICAgLy8gICAgYFtdYCwgd2hpY2ggd291bGQgcmVhZCBhcyBhIGNsZWFuIHBhc3MgYW5kIHNpbGVudGx5IGFsbG93IHRoZSBjb21taXQuXG4gICAgICAgIGNvbnN0IHN0ZG91dCA9IChlcnIgYXMgeyBzdGRvdXQ/OiBzdHJpbmcgfSkuc3Rkb3V0O1xuICAgICAgICBjb25zdCBzdGRlcnIgPSAoZXJyIGFzIHsgc3RkZXJyPzogc3RyaW5nIH0pLnN0ZGVycjtcbiAgICAgICAgY29uc3Qgc3Rkb3V0VGV4dCA9IHR5cGVvZiBzdGRvdXQgPT09ICdzdHJpbmcnID8gc3Rkb3V0IDogJyc7XG4gICAgICAgIGNvbnN0IHN0ZGVyclRleHQgPSB0eXBlb2Ygc3RkZXJyID09PSAnc3RyaW5nJyA/IHN0ZGVyciA6ICcnO1xuICAgICAgICBpZiAoc3Rkb3V0VGV4dC50cmltKCkubGVuZ3RoID09PSAwICYmIHN0ZGVyclRleHQudHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICB0aHJvdyBuZXcgR2F0ZVNjYW5FcnJvcihzdGRlcnJUZXh0LnRyaW0oKSk7XG4gICAgICAgIH1cbiAgICAgICAgb3V0ID0gc3Rkb3V0VGV4dDtcbiAgICAgIH1cbiAgICAgIHJldHVybiBwYXJzZVN0YWxlUG9yY2VsYWluKG91dCk7XG4gICAgfSxcbiAgICBsaXN0OiBhc3luYyAocGF0aHMsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGlmICghcmVwb1Jvb3QgfHwgcGF0aHMubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdsaXN0JywgJy0tcG9yY2VsYWluJywgLi4ucGF0aHNdLCB7XG4gICAgICAgICAgY3dkOiByZXBvUm9vdCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBwYXJzZVBvcmNlbGFpbihvdXQpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICAgIH1cbiAgICB9LFxuICAgIGxpc3RCbG9ja3M6IGFzeW5jIChuYW1lcywgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgaWYgKCFyZXBvUm9vdCB8fCBuYW1lcy5sZW5ndGggPT09IDApIHJldHVybiAnJztcbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdsaXN0JywgLi4ubmFtZXNdLCB7XG4gICAgICAgICAgY3dkOiByZXBvUm9vdCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gQSBmYWlsZWQgaHVtYW4tZm9ybWF0IHJlYWQgb25seSBkZWdyYWRlcyB0aGUgcmVuZGVyZWQgbWVzc2FnZVxuICAgICAgICAvLyAoYW5ub3RhdGVCbG9ja3Mgc3ludGhlc2l6ZXMgbWluaW1hbCBibG9ja3MpOyBuZXZlciBhIGdhdGUgZXJyb3IuXG4gICAgICAgIHJldHVybiAnJztcbiAgICAgIH1cbiAgICB9XG4gIH07XG59XG5cbi8qKlxuICogVGhlIHByb2R1Y3Rpb24gZGlzay1iYWNrZWQge0BsaW5rIEdhdGVNZW1vU3RhdGV9OiBvbmUgbWFya2VyIGZpbGUgcGVyIGRlYnQtc3RhdGVcbiAqIGRpZ2VzdCB1bmRlciB7QGxpbmsgZ2F0ZU1lbW9EaXJ9IChgPGdpdC1jb21tb24tZGlyPi9naXQtc3Bhbi9nYXRlL2ApLCBmb2xsb3dpbmdcbiAqIHNwYW4tc3VyZmFjZS50cydzIGZpbGUtYmFja2VkIGBNZW1vU3RvcmVgIHBhdHRlcm4uIFRoZSBkaWdlc3QgaXMgYSBoZXggc2hhMjU2LFxuICogYSBzYWZlIGZpbGVuYW1lLiBCZXN0LWVmZm9ydCBhbmQgbm9uLXRocm93aW5nOiBhIG1lbW8gd2hvc2UgcmVwbyBjYW5ub3QgYmVcbiAqIHJlc29sdmVkIGRlZ3JhZGVzIHRvIGEgbm8tb3Agc3RvcmUgKG5ldmVyIHBlcnNpc3RzIFx1MjE5MiB1bmNvdmVyZWQgd291bGQgcmUtZGVueSxcbiAqIGJ1dCBhbiB1bnJlc29sdmFibGUgcmVwbyB5aWVsZHMgYW4gZW1wdHkgY2hhbmdlc2V0IHVwc3RyZWFtIGFueXdheSkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEaXNrR2F0ZU1lbW9TdGF0ZShjd2Q6IHN0cmluZyk6IEdhdGVNZW1vU3RhdGUge1xuICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICBpZiAoIXJlcG9Sb290KSB7XG4gICAgLy8gTm8gcmVzb2x2YWJsZSByZXBvIFx1MjE5MiB0aGUgbWVtbyBjYW5ub3QgcGVyc2lzdC4gUmVwb3J0IGBmYWxzZWAgZnJvbVxuICAgIC8vIGByZWNvcmRgIHNvIHRoZSBnYXRlIGZhaWxzIG9wZW4gcmF0aGVyIHRoYW4gZGVueWluZyB3aXRoIG5vIGVzY2FwZS5cbiAgICByZXR1cm4geyBoYXM6ICgpID0+IGZhbHNlLCByZWNvcmQ6ICgpID0+IGZhbHNlIH07XG4gIH1cbiAgY29uc3QgZGlyID0gZ2F0ZU1lbW9EaXIocmVwb1Jvb3QpO1xuICByZXR1cm4ge1xuICAgIGhhczogKGRpZ2VzdCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIGZzLmV4aXN0c1N5bmMobm9kZVBhdGguam9pbihkaXIsIGRpZ2VzdCkpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICB9LFxuICAgIHJlY29yZDogKGRpZ2VzdCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgZnMubWtkaXJTeW5jKGRpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgICAgIGZzLndyaXRlRmlsZVN5bmMobm9kZVBhdGguam9pbihkaXIsIGRpZ2VzdCksICcnKTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gQSBmYWlsZWQgbWVtbyB3cml0ZSBtdXN0IG5ldmVyIGJyaWNrIHRoZSBjb21taXQgYW5kIG11c3QgbmV2ZXJcbiAgICAgICAgLy8gc2lsZW50bHkgcmUtZGVueSBmb3JldmVyOiByZXBvcnQgdGhlIGZhaWx1cmUgc28gdGhlIGdhdGUgZmFpbHMgb3Blbi5cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgIH1cbiAgfTtcbn1cbiIsICIvKipcbiAqIFNoYXJlZCBoZWxwZXJzIHVzZWQgYnkgbXVsdGlwbGUgYWdlbnQtaG9va3MgZW50cnkgcG9pbnRzLlxuICpcbiAqIEV4dHJhY3RlZCBmcm9tIHByZS10b29sLXVzZS50cyBzbyB0aGF0IHRoZSB1cGNvbWluZyBTdG9wIGhvb2sgKGFuZCBhbnlcbiAqIGZ1dHVyZSBob29rcykgY2FuIGltcG9ydCBwYXRoIHV0aWxpdGllcywgcmFuZ2UgaGVscGVycywgYW5kIHRoZVxuICogc2FuaXRpemVTZXNzaW9uSWQvZm9ybWF0QW5jaG9yIGZ1bmN0aW9ucyB3aXRob3V0IGRlcGVuZGluZyBvbiB0aGVcbiAqIFByZVRvb2xVc2Utc3BlY2lmaWMgbW9kdWxlLlxuICovXG5cbmltcG9ydCB7IGV4ZWNGaWxlU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG9zIGZyb20gJ25vZGU6b3MnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQYXRoIGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgZnVuY3Rpb24gdG9Qb3NpeChwOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG59XG5cbmZ1bmN0aW9uIGlzQWJzb2x1dGVQb3NpeChwOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHAuc3RhcnRzV2l0aCgnLycpIHx8IC9eW0EtWmEtel06XFwvLy50ZXN0KHApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYWJzcGF0aEFnYWluc3QoYmFzZTogc3RyaW5nLCB0YXJnZXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHQgPSB0b1Bvc2l4KHRhcmdldCk7XG4gIGlmIChpc0Fic29sdXRlUG9zaXgodCkpIHJldHVybiB0O1xuICBjb25zdCBiID0gdG9Qb3NpeChiYXNlKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgcmV0dXJuIGAke2J9LyR7dH1gO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVJlcG9Sb290KGRpcjogc3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbCk6IHN0cmluZyB8IG51bGwge1xuICBpZiAoIWRpcikgcmV0dXJuIG51bGw7XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgZGlyLCAncmV2LXBhcnNlJywgJy0tc2hvdy10b3BsZXZlbCddLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIGVuY29kaW5nOiAndXRmOCdcbiAgICB9KTtcbiAgICBjb25zdCB0cmltbWVkID0gb3V0LnRyaW0oKTtcbiAgICByZXR1cm4gdHJpbW1lZC5sZW5ndGggPiAwID8gdG9Qb3NpeCh0cmltbWVkKSA6IG51bGw7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbi8qKlxuICogUmVwb3J0IHdoZXRoZXIgYSByZXBvLXJlbGF0aXZlIHBhdGggaXMgZXhjbHVkZWQgYnkgZ2l0J3MgaWdub3JlIHJ1bGVzXG4gKiAoLmdpdGlnbm9yZSwgLmdpdC9pbmZvL2V4Y2x1ZGUsIGNvcmUuZXhjbHVkZXNGaWxlKS4gVXNlZCB0byBrZWVwIGlnbm9yZWRcbiAqIGZpbGVzIFx1MjAxNCBidWlsZCBvdXRwdXQsIGNhY2hlcywgbG9ncyBcdTIwMTQgb3V0IG9mIHRvdWNoIHRyYWNraW5nIGVudGlyZWx5LCBzb1xuICogdGhlIHRvdWNoIGhvb2sgbmV2ZXIgcmVwb3J0cyByZWFkcywgd3JpdGVzLCBvciB1bmNvdmVyZWQgd3JpdGVzIG9uIHRoZW0uXG4gKlxuICogYGdpdCBjaGVjay1pZ25vcmUgLXEgPHBhdGg+YCBleGl0cyAwIHdoZW4gdGhlIHBhdGggaXMgaWdub3JlZCwgMSB3aGVuIGl0IGlzXG4gKiBub3QsIGFuZCAxMjggb24gZXJyb3IuIGV4ZWNGaWxlU3luYyB0aHJvd3Mgb24gYW55IG5vbi16ZXJvIGV4aXQsIHNvIGEgY2xlYW5cbiAqIHJldHVybiBtZWFucyBcImlnbm9yZWRcIi4gQSBzdGF0dXMtMSB0aHJvdyBpcyB0aGUgZXhwZWN0ZWQgXCJub3QgaWdub3JlZFwiXG4gKiBzaWduYWw7IGFueSBvdGhlciBmYWlsdXJlIGlzIGFuIHVucmVsaWFibGUgYW5zd2VyLCBzbyB3ZSByZXBvcnQgYGZhbHNlYFxuICogKGRvIG5vdCBkcm9wIHRoZSB0b3VjaCkgcmF0aGVyIHRoYW4gc2lsZW50bHkgaGlkaW5nIGEgdHJhY2tlZCBmaWxlLlxuICovXG4vKipcbiAqIFRoZSBkZWZhdWx0IHNwYW4gcm9vdCBkaXJlY3RvcnksIHJlbGF0aXZlIHRvIHRoZSByZXBvIHJvb3QsIHVzZWQgd2hlbiBub1xuICogZW52aXJvbm1lbnQgdmFyaWFibGUgb3IgZ2l0IGNvbmZpZyBvdmVycmlkZXMgdGhlIGxvY2F0aW9uLlxuICovXG5leHBvcnQgY29uc3QgU1BBTl9ST09UID0gJy5zcGFuJztcblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBzcGFuIHJvb3QgZGlyZWN0b3J5IGZvciBhIGdpdmVuIHJlcG8sIG1pcnJvcmluZyB0aGUgUnVzdCBDTElcbiAqIHByZWNlZGVuY2UgKG1pbnVzIHRoZSAtLXNwYW4tZGlyIENMSSBmbGFnLCB3aGljaCBpcyBpbnZpc2libGUgdG8gZmlsZS13cml0ZVxuICogaG9va3MpOlxuICogICAxLiBHSVRfU1BBTl9ESVIgZW52aXJvbm1lbnQgdmFyaWFibGVcbiAqICAgMi4gYGdpdCBjb25maWcgZ2l0LXNwYW4uZGlyYCBpbiB0aGUgcmVwb1xuICogICAzLiBEZWZhdWx0OiBcIi5zcGFuXCJcbiAqXG4gKiBUaGUgcmV0dXJuZWQgdmFsdWUgaXMgYSBQT1NJWC1zdHlsZSBwYXRoIHdpdGggbm8gdHJhaWxpbmcgc2xhc2guXG4gKiBGYWlsLXNhZmU6IGFueSByZXNvbHV0aW9uIGVycm9yIGZhbGxzIGJhY2sgdG8gXCIuc3BhblwiIHNvIHRoZSBob29rIG5ldmVyXG4gKiBjcmFzaGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBlbnZEaXIgPSBwcm9jZXNzLmVudlsnR0lUX1NQQU5fRElSJ107XG4gIGlmIChlbnZEaXIgJiYgZW52RGlyLnRyaW0oKS5sZW5ndGggPiAwKSB7XG4gICAgcmV0dXJuIHRvUG9zaXgoZW52RGlyLnRyaW0oKSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIH1cbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ2NvbmZpZycsICdnaXQtc3Bhbi5kaXInXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnXG4gICAgfSk7XG4gICAgY29uc3QgdHJpbW1lZCA9IHRvUG9zaXgob3V0LnRyaW0oKSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gICAgaWYgKHRyaW1tZWQubGVuZ3RoID4gMCkgcmV0dXJuIHRyaW1tZWQ7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHZvaWQgZXJyOyAvLyBjb25maWcga2V5IGFic2VudCBvciBnaXQgZXJyb3IgXHUyMDE0IGZhbGwgdGhyb3VnaCB0byBkZWZhdWx0XG4gIH1cbiAgcmV0dXJuIFNQQU5fUk9PVDtcbn1cblxuLyoqXG4gKiBSZXBvcnQgd2hldGhlciBhIHJlcG8tcmVsYXRpdmUgUE9TSVggcGF0aCBmYWxscyBpbnNpZGUgdGhlIGdpdmVuIHNwYW4gcm9vdFxuICogZGlyZWN0b3J5LiBBIHBhdGggaXMgaW5zaWRlIHdoZW4gaXQgZXF1YWxzIHRoZSBzcGFuIHJvb3QgZXhhY3RseSBvciBpc1xuICogbmVzdGVkIGJlbmVhdGggaXQgKGkuZS4gc3RhcnRzIHdpdGggXCI8c3BhblJvb3Q+L1wiKS4gVGhlIFwiL1wiIGJvdW5kYXJ5IHByZXZlbnRzXG4gKiBmYWxzZSBwb3NpdGl2ZXMgZm9yIHNpYmxpbmdzIGxpa2UgXCIuc3BhbnMveFwiIG9yIFwiLnNwYW4tbm90ZXMveFwiLlxuICpcbiAqIFBhc3MgdGhlIHJlc3VsdCBvZiBgcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290KWAgYXMgYHNwYW5Sb290YC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzSW5zaWRlU3BhblJvb3QocmVwb1JlbFBhdGg6IHN0cmluZywgc3BhblJvb3Q6IHN0cmluZyA9IFNQQU5fUk9PVCk6IGJvb2xlYW4ge1xuICBjb25zdCByb290ID0gc3BhblJvb3QucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIHJldHVybiByZXBvUmVsUGF0aCA9PT0gcm9vdCB8fCByZXBvUmVsUGF0aC5zdGFydHNXaXRoKGAke3Jvb3R9L2ApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNHaXRJZ25vcmVkKHJlcG9Sb290OiBzdHJpbmcsIHJlcG9SZWxQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ2NoZWNrLWlnbm9yZScsICctcScsICctLScsIHJlcG9SZWxQYXRoXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ2lnbm9yZScsICdpZ25vcmUnXVxuICAgIH0pO1xuICAgIHJldHVybiB0cnVlO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB2b2lkIGVycjtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290OiBzdHJpbmcsIGFic1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHJvb3QgPSB0b1Bvc2l4KHJlcG9Sb290KTtcbiAgY29uc3QgYWJzID0gdG9Qb3NpeChhYnNQYXRoKTtcbiAgY29uc3QgcHJlZml4ID0gcm9vdC5lbmRzV2l0aCgnLycpID8gcm9vdCA6IGAke3Jvb3R9L2A7XG4gIHJldHVybiBhYnMuc3RhcnRzV2l0aChwcmVmaXgpID8gYWJzLnNsaWNlKHByZWZpeC5sZW5ndGgpIDogYWJzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2Fub25pY2FsaXplUGF0aChhYnNQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICB0cnkge1xuICAgIHJldHVybiB0b1Bvc2l4KGZzLnJlYWxwYXRoU3luYy5uYXRpdmUoYWJzUGF0aCkpO1xuICB9IGNhdGNoIHtcbiAgICAvLyBGaWxlIGRvZXNuJ3QgZXhpc3QgeWV0IChlLmcuIFdyaXRlIHRvIGEgbmV3IGZpbGUpOiBjYW5vbmljYWxpemUgdGhlXG4gICAgLy8gZGlyZWN0b3J5IGFuZCByZWpvaW4gdGhlIGJhc2VuYW1lIHNvIHN5bWxpbmtzIGluIHRoZSBwYXJlbnQgYXJlIHJlc29sdmVkLlxuICAgIHRyeSB7XG4gICAgICBjb25zdCBkaXIgPSB0b1Bvc2l4KGZzLnJlYWxwYXRoU3luYy5uYXRpdmUobm9kZVBhdGguZGlybmFtZShhYnNQYXRoKSkpO1xuICAgICAgcmV0dXJuIGAke2Rpcn0vJHtub2RlUGF0aC5iYXNlbmFtZShhYnNQYXRoKX1gO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gUGFyZW50IGRvZXNuJ3QgZXhpc3QgZWl0aGVyOyBmYWxsIGJhY2sgdG8gdGhlIHVuLWNhbm9uaWNhbGl6ZWQgcGF0aC5cbiAgICAgIHJldHVybiBhYnNQYXRoO1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZGVyaXZlUGF0aCh0b29sSW5wdXQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBjd2Q6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCBmcCA9IHRvb2xJbnB1dC5maWxlX3BhdGg7XG4gIGlmICh0eXBlb2YgZnAgIT09ICdzdHJpbmcnIHx8IGZwLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGFicyA9IGFic3BhdGhBZ2FpbnN0KGN3ZCwgZnApO1xuICByZXR1cm4gY2Fub25pY2FsaXplUGF0aChhYnMpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIExpbmUgcmFuZ2UgdHlwZXMgYW5kIGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIExpbmVSYW5nZSB7XG4gIHN0YXJ0OiBudW1iZXI7XG4gIGVuZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmFuZ2VzSW50ZXJzZWN0KGE6IExpbmVSYW5nZSwgYjogTGluZVJhbmdlKTogYm9vbGVhbiB7XG4gIHJldHVybiBhLnN0YXJ0IDw9IGIuZW5kICYmIGEuZW5kID49IGIuc3RhcnQ7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUG9yY2VsYWluIHJvdyBwYXJzaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBQb3JjZWxhaW5Sb3cge1xuICBuYW1lOiBzdHJpbmc7XG4gIHBhdGg6IHN0cmluZztcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVBvcmNlbGFpbihzdGRvdXQ6IHN0cmluZyk6IFBvcmNlbGFpblJvd1tdIHtcbiAgY29uc3Qgcm93czogUG9yY2VsYWluUm93W10gPSBbXTtcbiAgZm9yIChjb25zdCBsaW5lIG9mIHN0ZG91dC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkKSBjb250aW51ZTtcbiAgICBjb25zdCBwYXJ0cyA9IHRyaW1tZWQuc3BsaXQoJ1xcdCcpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPCAzKSBjb250aW51ZTtcbiAgICBjb25zdCBbbmFtZSwgcGF0aCwgcmFuZ2VdID0gcGFydHM7XG4gICAgY29uc3QgZGFzaElkeCA9IHJhbmdlLmluZGV4T2YoJy0nKTtcbiAgICBpZiAoZGFzaElkeCA9PT0gLTEpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHN0YXJ0ID0gcGFyc2VJbnQocmFuZ2Uuc2xpY2UoMCwgZGFzaElkeCksIDEwKTtcbiAgICBjb25zdCBlbmQgPSBwYXJzZUludChyYW5nZS5zbGljZShkYXNoSWR4ICsgMSksIDEwKTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0KSB8fCBOdW1iZXIuaXNOYU4oZW5kKSkgY29udGludWU7XG4gICAgcm93cy5wdXNoKHsgbmFtZSwgcGF0aCwgc3RhcnQsIGVuZCB9KTtcbiAgfVxuICByZXR1cm4gcm93cztcbn1cblxuLyoqXG4gKiBUaGUgZnVsbCBgZ2l0IHNwYW4gc3RhbGUgLS1mb3JtYXQgcG9yY2VsYWluYCBzdGF0dXMgdG9rZW4gdm9jYWJ1bGFyeSAodGhlXG4gKiBnaXQtc3BhbiBDTEkncyBwb3JjZWxhaW4gY29udHJhY3QpOiBgRlJFU0hgL2BNT1ZFRGAvYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYFxuICogYXJlIHBvc2l0aW9uYWwtb3ItY2xlYW4gYW5kIG5ldmVyIGRlYnQ7IGV2ZXJ5IG90aGVyIHRva2VuIGlzIHNlbWFudGljIGRyaWZ0XG4gKiBvciBhIHRlcm1pbmFsL2Vycm9yIGNvbmRpdGlvbiBhbmQgaXMgZGVidC4gU2VlIHtAbGluayBpc0RlYnR9IGZvciB0aGVcbiAqIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGggb24gdGhhdCBzcGxpdC5cbiAqL1xuZXhwb3J0IGNvbnN0IFBPUkNFTEFJTl9TVEFUVVNFUyA9IFtcbiAgJ0ZSRVNIJyxcbiAgJ1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUJyxcbiAgJ01PVkVEJyxcbiAgJ0NIQU5HRUQnLFxuICAnREVMRVRFRCcsXG4gICdDT05GTElDVCcsXG4gICdTVUJNT0RVTEUnLFxuICAnTEZTX05PVF9GRVRDSEVEJyxcbiAgJ0xGU19OT1RfSU5TVEFMTEVEJyxcbiAgJ1BST01JU09SX01JU1NJTkcnLFxuICAnU1BBUlNFX0VYQ0xVREVEJyxcbiAgJ0ZJTFRFUl9GQUlMRUQnLFxuICAnSU9fRVJST1InXG5dIGFzIGNvbnN0O1xuXG5leHBvcnQgdHlwZSBQb3JjZWxhaW5TdGF0dXMgPSAodHlwZW9mIFBPUkNFTEFJTl9TVEFUVVNFUylbbnVtYmVyXTtcblxuY29uc3QgUE9SQ0VMQUlOX1NUQVRVU19TRVQ6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFBPUkNFTEFJTl9TVEFUVVNFUyk7XG5cbmZ1bmN0aW9uIHBhcnNlUG9yY2VsYWluU3RhdHVzKHJhdzogc3RyaW5nKTogUG9yY2VsYWluU3RhdHVzIHwgbnVsbCB7XG4gIHJldHVybiBQT1JDRUxBSU5fU1RBVFVTX1NFVC5oYXMocmF3KSA/IChyYXcgYXMgUG9yY2VsYWluU3RhdHVzKSA6IG51bGw7XG59XG5cbi8qKiBBIGBwYXJzZVN0YWxlUG9yY2VsYWluYCByb3c6IGEge0BsaW5rIFBvcmNlbGFpblJvd30gcGx1cyBpdHMgc3RhdHVzIHRva2VuLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTdGFsZVBvcmNlbGFpblJvdyBleHRlbmRzIFBvcmNlbGFpblJvdyB7XG4gIHN0YXR1czogUG9yY2VsYWluU3RhdHVzO1xufVxuXG4vKipcbiAqIFRoZSBkZWJ0IGludmFyaWFudCAoc3lzdGVtLXdpZGU7IGNvbnN1bWVkIGJ5IGJvdGggdGhlIGZ1dHVyZSB0b3VjaC1jb3JlIGFuZFxuICogZ2F0ZS1jb3JlKTogb25seSBzZW1hbnRpYyBzdGF0dXNlcyBhcmUgZGVidC4gYENIQU5HRURgIGFuZCBgREVMRVRFRGAgYXJlXG4gKiBzZW1hbnRpYyBkcmlmdDsgdGhlIHJlbWFpbmluZyBub24tRlJFU0gvTU9WRUQvUkVTT0xWRURfUEVORElOR19DT01NSVQgdG9rZW5zXG4gKiBhcmUgdGVybWluYWwvZXJyb3IgY29uZGl0aW9ucyBhbmQgYXJlIHRyZWF0ZWQgYXMgZGVidCB0b28gKHRoZXkgYmxvY2sgb25cbiAqIHRoZWlyIG93biBtZXJpdHMgXHUyMDE0IHRoZSBDTEkgY291bGQgbm90IHJlc29sdmUgdGhlIGFuY2hvciBhdCBhbGwpLiBgRlJFU0hgLFxuICogYE1PVkVEYCwgYW5kIGBSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgYXJlIG5ldmVyIGRlYnQ6IHBvc2l0aW9uYWwgZHJpZnQgdGhlXG4gKiBDTEkgY2FuIGhlYWwgKG9yIGFscmVhZHkgaGFzKSBpcyBpbnZpc2libGUsIGFuZCBhIHBlbmRpbmctY29tbWl0IHJlc29sdXRpb25cbiAqIGlzIG5vdCBvdXRzdGFuZGluZyBkZWJ0LlxuICpcbiAqIE5vdGU6IHRoZSBwb3JjZWxhaW4gdm9jYWJ1bGFyeSBkb2VzIG5vdCBjdXJyZW50bHkgZGlzdGluZ3Vpc2hcbiAqIGNvbnRlbnQtZXF1aXZhbGVudCBgQ0hBTkdFRGAgKGUuZy4gd2hpdGVzcGFjZS1vbmx5IGRyaWZ0IGAtLWZpeGAgY2FuIGhlYWwpXG4gKiBmcm9tIGdlbnVpbmVseSBzZW1hbnRpYyBgQ0hBTkdFRGAgXHUyMDE0IHRoYXQgY2xhc3NpZmljYXRpb24gaXMgbm90IHByZXNlbnQgaW5cbiAqIGBnaXQgc3BhbiBzdGFsZSAtLWZvcm1hdCBwb3JjZWxhaW5gIG91dHB1dCB0b2RheS4gVW50aWwgdGhlIENMSSBleHBvc2VzIGl0LFxuICogZXZlcnkgYENIQU5HRURgIHJvdyBpcyB0cmVhdGVkIGFzIGRlYnQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0RlYnQoc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBib29sZWFuIHtcbiAgc3dpdGNoIChzdGF0dXMpIHtcbiAgICBjYXNlICdGUkVTSCc6XG4gICAgY2FzZSAnTU9WRUQnOlxuICAgIGNhc2UgJ1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUJzpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIHRydWU7XG4gIH1cbn1cblxuLyoqXG4gKiBMb3dlcmNhc2UgaHVtYW4gbGFiZWwgZm9yIGEgcG9yY2VsYWluIHN0YXR1cyB0b2tlbiAoYExGU19OT1RfRkVUQ0hFRGAgXHUyMTkyXG4gKiBgbGZzIG5vdCBmZXRjaGVkYCkuIFRoZSBzaW5nbGUgbGFiZWwgbWFwcGluZyBmb3IgZXZlcnkgaHVtYW4tZm9ybWF0IGFuY2hvclxuICogc3VmZml4IFx1MjAxNCBib3RoIHRoZSB0b3VjaCBob29rJ3MgYmxvY2sgYW5kIHRoZSBnYXRlJ3MgbWVzc2FnZXMgcmVuZGVyIHRocm91Z2hcbiAqIHRoaXMsIHNvIGEgc3RhdHVzIG5ldmVyIHJlYWRzIGRpZmZlcmVudGx5IGJldHdlZW4gdGhlIHR3by5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGh1bWFuU3RhdHVzTGFiZWwoc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBzdHJpbmcge1xuICByZXR1cm4gc3RhdHVzLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvXy9nLCAnICcpO1xufVxuXG4vKipcbiAqIFRoZSB0ZXJtaW5hbC9lbnZpcm9ubWVudGFsIHN0YXR1c2VzOiB0aGUgQ0xJIGNvdWxkIG5vdCByZXNvbHZlIHRoZSBhbmNob3IgYXRcbiAqIGFsbCwgc28gdGhlIHJvdyBpcyBub3Qgc3BhbiBkcmlmdCBhIHVzZXIgY2FuIGZpeCBieSBlZGl0aW5nIGEgc3Bhbi4gVGhlc2UgYXJlXG4gKiBgQ09ORkxJQ1RgICh1bnJlc29sdmVkIG1lcmdlKSwgYFNVQk1PRFVMRWAgKGFuY2hvciBpbnNpZGUgYSBzdWJtb2R1bGUpLFxuICogYExGU19OT1RfRkVUQ0hFRGAvYExGU19OT1RfSU5TVEFMTEVEYCAoR2l0IExGUyBjb250ZW50IHVuYXZhaWxhYmxlKSxcbiAqIGBQUk9NSVNPUl9NSVNTSU5HYCAocGFydGlhbC1jbG9uZSBvYmplY3Qgbm90IGZldGNoZWQpLCBgU1BBUlNFX0VYQ0xVREVEYFxuICogKHBhdGggb3V0c2lkZSB0aGUgc3BhcnNlLWNoZWNrb3V0IGNvbmUpLCBgRklMVEVSX0ZBSUxFRGAgKGEgY2xlYW4vc211ZGdlXG4gKiBmaWx0ZXIgZXJyb3JlZCksIGFuZCBgSU9fRVJST1JgICh0cmFuc2llbnQgcmVhZCBmYWlsdXJlKS5cbiAqXG4gKiBUaGVzZSBhcmUgYSBzdHJpY3Qgc3Vic2V0IG9mIHtAbGluayBpc0RlYnR9OiBldmVyeSBlbnZpcm9ubWVudGFsIHN0YXR1cyBpc1xuICogYWxzbyBkZWJ0IChpdCBibG9ja3Mgb24gaXRzIG93biBtZXJpdHMgd2hlbiBzdXJmYWNlZCBpbiBhIHN0YXR1cyByZXBvcnQpLCBidXRcbiAqIHRoZSBnYXRlIG11c3QgdHJlYXQgdGhlbSBkaWZmZXJlbnRseSBmcm9tICpzZW1hbnRpYyogZHJpZnQgKGBDSEFOR0VEYCxcbiAqIGBERUxFVEVEYCkuIFNlbWFudGljIGRyaWZ0IGlzIGZpeGFibGUgYnkgZWRpdGluZyBhIHNwYW4sIHNvIHRoZSBnYXRlIGZhaWxzXG4gKiBjbG9zZWQgb24gaXQ7IGFuIGVudmlyb25tZW50YWwgY29uZGl0aW9uIGlzIG5vdCBzb21ldGhpbmcgYSBzcGFuIGVkaXQgY2FuXG4gKiByZXNvbHZlLCBzbyB0aGUgZ2F0ZSBmYWlscyBPUEVOIG9uIGl0IChhbGxvdywgYnV0IHN1cmZhY2UgdGhlIGNvbmRpdGlvbikgXHUyMDE0XG4gKiByZS1kZW55aW5nIGZvcmV2ZXIgb24gYW4gaW5mcmEgZmFpbHVyZSB0aGUgdXNlciBjYW5ub3QgY2xlYXIgZnJvbSBoZXJlIHdvdWxkXG4gKiBjb250cmFkaWN0IHRoZSBmYWlsLW9wZW4gY29udHJhY3QgdGhlIHJlc3Qgb2YgdGhlIGdhdGUgYWxyZWFkeSBob25vcnMgZm9yXG4gKiBDTEktYWJzZW50L3RpbWVvdXQvcGFyc2UtZmFpbHVyZSBjb25kaXRpb25zLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNFbnZpcm9ubWVudGFsU3RhdHVzKHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogYm9vbGVhbiB7XG4gIHN3aXRjaCAoc3RhdHVzKSB7XG4gICAgY2FzZSAnQ09ORkxJQ1QnOlxuICAgIGNhc2UgJ1NVQk1PRFVMRSc6XG4gICAgY2FzZSAnTEZTX05PVF9GRVRDSEVEJzpcbiAgICBjYXNlICdMRlNfTk9UX0lOU1RBTExFRCc6XG4gICAgY2FzZSAnUFJPTUlTT1JfTUlTU0lORyc6XG4gICAgY2FzZSAnU1BBUlNFX0VYQ0xVREVEJzpcbiAgICBjYXNlICdGSUxURVJfRkFJTEVEJzpcbiAgICBjYXNlICdJT19FUlJPUic6XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKlxuICogYGdpdCBzcGFuIHN0YWxlIC0tZm9ybWF0IHBvcmNlbGFpbmAgZW1pdHMgYSBkaWZmZXJlbnQgc2hhcGUgdGhhblxuICogYGxpc3QgLS1wb3JjZWxhaW5gOiBhIGAjIHBvcmNlbGFpbiB2MmAgaGVhZGVyLCBgIyBmdXp6eSBOYCBjb21tZW50IGxpbmVzLFxuICogYW5kIG9uZSBgPHN0YXR1cz5cXHQ8c3JjPlxcdDxuYW1lPlxcdDxwYXRoPlxcdDxzdGFydD5cXHQ8ZW5kPmAgcm93IHBlciBkcmlmdGVkXG4gKiBhbmNob3IgKHdob2xlLWZpbGUgYW5jaG9ycyBjYXJyeSBgKHdob2xlKWAvYC1gIGluIHBsYWNlIG9mIHRoZSBsaW5lIGNvbHVtbnMpLlxuICogUm93cyB3aG9zZSBzdGF0dXMgdG9rZW4gaXMgbm90IGluIHtAbGluayBQT1JDRUxBSU5fU1RBVFVTRVN9IGFyZSBza2lwcGVkIFx1MjAxNFxuICogYW4gdW5yZWNvZ25pemVkIHRva2VuIGZyb20gYSBuZXdlciBDTEkgaXMgdHJlYXRlZCB0aGUgc2FtZSBhcyBhIG1hbGZvcm1lZFxuICogbGluZSByYXRoZXIgdGhhbiBndWVzc2VkIGF0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VTdGFsZVBvcmNlbGFpbihzdGRvdXQ6IHN0cmluZyk6IFN0YWxlUG9yY2VsYWluUm93W10ge1xuICBjb25zdCByb3dzOiBTdGFsZVBvcmNlbGFpblJvd1tdID0gW107XG4gIGZvciAoY29uc3QgbGluZSBvZiBzdGRvdXQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCB8fCB0cmltbWVkLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgY29uc3QgcGFydHMgPSB0cmltbWVkLnNwbGl0KCdcXHQnKTtcbiAgICBpZiAocGFydHMubGVuZ3RoIDwgNikgY29udGludWU7XG4gICAgY29uc3QgW3N0YXR1c0NvbCwgLCBuYW1lLCBwYXRoLCBzdGFydENvbCwgZW5kQ29sXSA9IHBhcnRzO1xuICAgIGNvbnN0IHN0YXR1cyA9IHBhcnNlUG9yY2VsYWluU3RhdHVzKHN0YXR1c0NvbCk7XG4gICAgaWYgKCFzdGF0dXMpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHN0YXJ0ID0gc3RhcnRDb2wgPT09ICcod2hvbGUpJyA/IDAgOiBwYXJzZUludChzdGFydENvbCwgMTApO1xuICAgIGNvbnN0IGVuZCA9IGVuZENvbCA9PT0gJy0nID8gMCA6IHBhcnNlSW50KGVuZENvbCwgMTApO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpIHx8IE51bWJlci5pc05hTihlbmQpKSBjb250aW51ZTtcbiAgICByb3dzLnB1c2goeyBuYW1lLCBwYXRoLCBzdGFydCwgZW5kLCBzdGF0dXMgfSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2Vzc2lvbiBJRCBzYW5pdGl6YXRpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIEluamVjdGl2ZSB0cmFuc2Zvcm06IHBlcmNlbnQtZW5jb2RlIGJ5dGVzIG91dHNpZGUgW0EtWmEtejAtOS5fLV0gYXMgJUhIXG4gKiAodXBwZXJjYXNlIGhleCkuIFVzZWQgdG8gcHJvZHVjZSBzYWZlIGZpbGVuYW1lcyBmcm9tIGFyYml0cmFyeSBzZXNzaW9uIGlkcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplU2Vzc2lvbklkKHNlc3Npb25JZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHNlc3Npb25JZC5yZXBsYWNlKC9bXkEtWmEtejAtOS5fLV0vZywgKGNoKSA9PiB7XG4gICAgcmV0dXJuIGAlJHtjaC5jaGFyQ29kZUF0KDApLnRvU3RyaW5nKDE2KS50b1VwcGVyQ2FzZSgpLnBhZFN0YXJ0KDIsICcwJyl9YDtcbiAgfSk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUGVyLXNlc3Npb24gYmFzZSBkaXJlY3Rvcnlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vLyBCYXNlIGRpciBzaGFyZWQgYnkgYWxsIHBlci1zZXNzaW9uIHN0YXRlOiBjdXJyZW50bHkganVzdCB0aGUgdG91Y2gtaG9va1xuLy8gc2Vzc2lvbiBtZW1vIChzcGFuLXN1cmZhY2UudHMncyBNZW1vU3RvcmUpLiBFYWNoIHNlc3Npb24gZ2V0cyBvbmVcbi8vIHN1YmRpcmVjdG9yeSBrZXllZCBieSBpdHMgc2FuaXRpemVkIGlkLCBzbyBldmVyeSB3cml0ZXIvcmVhZGVyIGZvciBhIGdpdmVuXG4vLyBzZXNzaW9uIGFncmVlcyBvbiBpdHMgbG9jYXRpb24uXG5leHBvcnQgY29uc3QgU0VTU0lPTl9CQVNFX0RJUiA9IG5vZGVQYXRoLmpvaW4ob3MuaG9tZWRpcigpLCAnLmNhY2hlJywgJ2dpdC1zcGFuJywgJ3Nlc3Npb24nKTtcblxuLyoqIFRoZSBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcnkgZm9yIGEgZ2l2ZW4gc2Vzc2lvbiBpZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uRGlyKHNlc3Npb25JZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4oU0VTU0lPTl9CQVNFX0RJUiwgc2FuaXRpemVTZXNzaW9uSWQoc2Vzc2lvbklkKSk7XG59XG5cbmNvbnN0IFRISVJUWV9EQVlTX01TID0gMzAgKiAyNCAqIDYwICogNjAgKiAxMDAwO1xuXG4vKipcbiAqIE9wcG9ydHVuaXN0aWNhbGx5IHBydW5lIHBlci1zZXNzaW9uIHN0YXRlIGRpcmVjdG9yaWVzIHVuZGVyXG4gKiB7QGxpbmsgU0VTU0lPTl9CQVNFX0RJUn0gd2hvc2UgbXRpbWUgaXMgb2xkZXIgdGhhbiBgbWF4QWdlTXNgIChkZWZhdWx0IDMwXG4gKiBkYXlzKS4gQSBkaXJlY3RvcnkncyBtdGltZSBhZHZhbmNlcyB3aGVuZXZlciBhbiBlbnRyeSBpbnNpZGUgaXQgaXNcbiAqIGNyZWF0ZWQvcmVuYW1lZC9yZW1vdmVkLCBzbyBhbiBhY3RpdmUgc2Vzc2lvbiAobWVtbyB3cml0ZXMpIHN0YXlzIGZyZXNoO1xuICogb25seSBnZW51aW5lbHkgYWJhbmRvbmVkIHNlc3Npb25zIGFnZSBvdXQuXG4gKlxuICogQmVzdC1lZmZvcnQgYW5kIG5vbi10aHJvd2luZzogY2FsbGVkIG9wcG9ydHVuaXN0aWNhbGx5IGZyb20gaG9vayByZWFkL3dyaXRlXG4gKiBwYXRocywgbm90IGEgc2VwYXJhdGUgY3Jvbi1saWtlIG1lY2hhbmlzbSwgc28gYSBmYWlsdXJlIGhlcmUgbXVzdCBuZXZlclxuICogYmxvY2sgdGhlIGNhbGxlcidzIGFjdHVhbCB3b3JrLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcHJ1bmVTdGFsZVNlc3Npb25zKG5vdzogbnVtYmVyID0gRGF0ZS5ub3coKSwgbWF4QWdlTXM6IG51bWJlciA9IFRISVJUWV9EQVlTX01TKTogdm9pZCB7XG4gIGxldCBlbnRyaWVzOiBmcy5EaXJlbnRbXTtcbiAgdHJ5IHtcbiAgICBlbnRyaWVzID0gZnMucmVhZGRpclN5bmMoU0VTU0lPTl9CQVNFX0RJUiwgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm47IC8vIGJhc2UgZGlyIGFic2VudCBvciB1bnJlYWRhYmxlIFx1MjAxNCBub3RoaW5nIHRvIHBydW5lXG4gIH1cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSB7XG4gICAgaWYgKCFlbnRyeS5pc0RpcmVjdG9yeSgpKSBjb250aW51ZTtcbiAgICBjb25zdCBkaXJQYXRoID0gbm9kZVBhdGguam9pbihTRVNTSU9OX0JBU0VfRElSLCBlbnRyeS5uYW1lKTtcbiAgICB0cnkge1xuICAgICAgY29uc3Qgc3RhdCA9IGZzLnN0YXRTeW5jKGRpclBhdGgpO1xuICAgICAgaWYgKG5vdyAtIHN0YXQubXRpbWVNcyA+IG1heEFnZU1zKSB7XG4gICAgICAgIGZzLnJtU3luYyhkaXJQYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XG4gICAgICB9XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBWYW5pc2hlZCBiZXR3ZWVuIHJlYWRkaXIgYW5kIHN0YXQsIG9yIHJlbW92YWwgZmFpbGVkIFx1MjAxNCBza2lwIGl0LiBBXG4gICAgICAvLyBiZXN0LWVmZm9ydCBwcnVuZSBtdXN0IG5ldmVyIHRocm93IGludG8gdGhlIGNhbGxlcidzIGhvdCBwYXRoLlxuICAgIH1cbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIGtpbmQgYW5kIGFuY2hvciBmb3JtYXR0aW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IHR5cGUgVG91Y2hLaW5kID0gJ3JlYWQnIHwgJ3dyaXRlJyB8ICd3aG9sZS1yZWFkJyB8ICd3aG9sZS13cml0ZScgfCAnY3JlYXRlJztcblxuLyoqXG4gKiBGb3JtYXQgYSBzcGFuIGFuY2hvciBzdHJpbmcuXG4gKlxuICogLSBgd2hvbGUtcmVhZGAsIGB3aG9sZS13cml0ZWAsIGFuZCBgY3JlYXRlYDogcmV0dXJucyBqdXN0IHRoZSBwYXRoXG4gKiAtIGByZWFkYCBhbmQgYHdyaXRlYDogcmV0dXJucyBgcGF0aCNMPHN0YXJ0Pi1MPGVuZD5gIChyZXF1aXJlcyByYW5nZSlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEFuY2hvcihwYXRoOiBzdHJpbmcsIGtpbmQ6IFRvdWNoS2luZCwgcmFuZ2U/OiBMaW5lUmFuZ2UpOiBzdHJpbmcge1xuICBpZiAoKGtpbmQgPT09ICdyZWFkJyB8fCBraW5kID09PSAnd3JpdGUnKSAmJiByYW5nZSkge1xuICAgIHJldHVybiBgJHtwYXRofSNMJHtyYW5nZS5zdGFydH0tTCR7cmFuZ2UuZW5kfWA7XG4gIH1cbiAgcmV0dXJuIHBhdGg7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQW5jaG9yIHNwZWMgdHlwZVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgQW5jaG9yU3BlYyB7XG4gIHBhdGg6IHN0cmluZztcbiAga2luZDogVG91Y2hLaW5kO1xuICByYW5nZT86IExpbmVSYW5nZTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBRdWV1ZSBkaXJlY3RvcnkgaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgZ2l0IGNvbW1vbiBkaXJlY3RvcnkgZm9yIHRoZSBnaXZlbiByZXBvIHJvb3QuXG4gKiBUaGlzIGlzIHRoZSBzaGFyZWQgZGlyZWN0b3J5IChub3QgdGhlIHdvcmt0cmVlLXNwZWNpZmljIC5naXQpLCBzbyBxdWV1ZVxuICogcmVjb3JkcyBzdXJ2aXZlIHdvcmt0cmVlIGRlbGV0aW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUdpdENvbW1vbkRpcihyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdyZXYtcGFyc2UnLCAnLS1naXQtY29tbW9uLWRpciddLCB7XG4gICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgZW5jb2Rpbmc6ICd1dGY4J1xuICB9KTtcbiAgY29uc3QgdHJpbW1lZCA9IHRvUG9zaXgob3V0LnRyaW0oKSk7XG4gIC8vIGdpdCByZXR1cm5zIGEgcmVsYXRpdmUgcGF0aCAoZS5nLiBcIi5naXRcIikgZm9yIHNpbXBsZSByZXBvcy4gUmVzb2x2ZSBpdFxuICAvLyBhZ2FpbnN0IHJlcG9Sb290IHNvIGNhbGxlcnMgbmV2ZXIgZGVwZW5kIG9uIHByb2Nlc3MuY3dkKCkuXG4gIGlmICghbm9kZVBhdGguaXNBYnNvbHV0ZSh0cmltbWVkKSkge1xuICAgIHJldHVybiB0b1Bvc2l4KG5vZGVQYXRoLnJlc29sdmUocmVwb1Jvb3QsIHRyaW1tZWQpKTtcbiAgfVxuICByZXR1cm4gdHJpbW1lZDtcbn1cblxuLyoqXG4gKiBSb290IG9mIHRoZSBnaXQtc3BhbiBxdWV1ZSBkaXJlY3RvcnkgdHJlZSwgdW5kZXIgdGhlIGdpdCBjb21tb24gZGlyLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcXVldWVSb290KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihyZXNvbHZlR2l0Q29tbW9uRGlyKHJlcG9Sb290KSwgJ2dpdC1zcGFuJyk7XG59XG5cbi8qKlxuICogRGlyZWN0b3J5IGZvciB0aGUgZ2F0ZSdzIHBlci1jaGFuZ2VzZXQgc3RhdGUgbWVtb3MgKGRpZ2VzdCBvZiBzb3J0ZWRcbiAqIGZpbmRpbmdzICsgdW5jb3ZlcmVkIHBhdGhzKSwgdW5kZXIgdGhlIGdpdCBjb21tb24gZGlyIHNvIGl0IGlzIHNoYXJlZFxuICogYWNyb3NzIHdvcmt0cmVlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdhdGVNZW1vRGlyKHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihxdWV1ZVJvb3QocmVwb1Jvb3QpLCAnZ2F0ZScpO1xufVxuIiwgIi8qKlxuICogUGF0aCBleGNsdXNpb24gbGlzdCBmb3IgdGhlIGdhdGUncyB1bmNvdmVyZWQtd3JpdGVzIGNoZWNrLlxuICpcbiAqIGBldmFsdWF0ZUdhdGVgIGluIHtAbGluayBmaWxlOi8vLi9nYXRlLWNvcmUudHN9IGFscmVhZHkgZXhjbHVkZXMgYC5zcGFuLyoqYFxuICogcGF0aHMgZnJvbSBpdHMgdW5jb3ZlcmVkLXdyaXRlcyBjb21wdXRhdGlvbiB1bmNvbmRpdGlvbmFsbHkgKHNwYW4gcmVwYWlyc1xuICogcmlkZSB0aGUgc2FtZSBjb21taXQgYW5kIG11c3QgbmV2ZXIgc2VsZi10cmlnZ2VyIHRoZSBnYXRlKS4gVGhpcyBtb2R1bGVcbiAqIGFkZHMgYSBzZWNvbmQsIHVzZXItZGVjbGFyZWQgZXhjbHVzaW9uIHNvdXJjZSBvbiB0b3Agb2YgdGhhdDogYSByZXBvIG93bmVyXG4gKiBjYW4gbGlzdCBhZGRpdGlvbmFsIHBhdGhzIHRoZSB1bmNvdmVyZWQtd3JpdGVzIGNoZWNrIHNob3VsZCBuZXZlciBmbGFnIFx1MjAxNFxuICogZ2VuZXJhdGVkIG91dHB1dCwgdmVuZG9yZWQgY29kZSwgYW55dGhpbmcgdGhhdCB3aWxsIG5ldmVyIGdldCBhIHNwYW4uXG4gKlxuICogQ29uZmlnIGxpdmVzIGF0IGA8cmVwb1Jvb3Q+Ly5zcGFuLy5nYXRlaWdub3JlYC4gVW5saWtlXG4gKiB7QGxpbmsgZmlsZTovLy4vc3Bhbi1pZ25vcmUudHN9J3MgYC5zcGFuLy5ob29raWdub3JlYCBcdTIwMTQgd2hpY2ggdGhlIGBnaXQtc3BhbmBcbiAqIFJ1c3QgQ0xJIGF1dG8tY3JlYXRlcyB3aXRoIGNhbm9uaWNhbCBjb250ZW50IFx1MjAxNCBgLmdhdGVpZ25vcmVgIGlzXG4gKiAqKnVzZXItb3duZWQqKjogbm90aGluZyBjcmVhdGVzIG9yIHBvcHVsYXRlcyBpdCwgc28gaXRzIGFic2VuY2UgaXMgdGhlXG4gKiBub3JtYWwsIHVuY29uZmlndXJlZCBzdGF0ZSwgbm90IGEgYnJva2VuIG9uZS5cbiAqXG4gKiBFYWNoIG5vbi1jb21tZW50IGxpbmUgaXMgYSBzaW5nbGUgZ2l0aWdub3JlLXN0eWxlIHBhdGggcGF0dGVybiAobm8gdHJhaWxpbmdcbiAqIHByZWZpeCBsaXN0IFx1MjAxNCBhIGAuZ2F0ZWlnbm9yZWAgbGluZSBlaXRoZXIgZXhjbHVkZXMgYSBwYXRoIGZyb20gdGhlXG4gKiB1bmNvdmVyZWQtd3JpdGVzIGNoZWNrIG9yIGl0IGRvZXNuJ3QsIHVubGlrZSBgLmhvb2tpZ25vcmVgJ3MgcGVyLXNwYW4tc2x1Z1xuICogc3VwcHJlc3Npb24pOlxuICpcbiAqICAgcGFja2FnZXMvYWdlbnQtaG9va3MvZ2VuZXJhdGVkLyoqXG4gKlxuICogUGF0dGVybiBncmFtbWFyIGlzIGlkZW50aWNhbCB0byBgLmhvb2tpZ25vcmVgJ3MgKHNlZSB0aGF0IG1vZHVsZSdzIGRvY1xuICogY29tbWVudCBmb3IgdGhlIGZ1bGwgZ3JhbW1hcikgYW5kIHJldXNlcyBpdHMgY29tcGlsZWQgbWF0Y2hlciB2aWFcbiAqIHtAbGluayBjb21waWxlUGF0dGVybn0gcmF0aGVyIHRoYW4gcmVpbXBsZW1lbnRpbmcgcGF0aCBtYXRjaGluZzpcbiAqXG4gKiAtIEJsYW5rIGxpbmVzIGFuZCBsaW5lcyBiZWdpbm5pbmcgd2l0aCBgI2AgYXJlIHNraXBwZWQuXG4gKiAtIEEgdHJhaWxpbmcgYC9gIHJlc3RyaWN0cyB0aGUgcGF0dGVybiB0byBkaXJlY3Rvcmllcy5cbiAqIC0gQSBwYXR0ZXJuIGNvbnRhaW5pbmcgYSBzbGFzaCBpcyBhbmNob3JlZCB0byB0aGUgcmVwbyByb290OyBhIHBhdHRlcm4gd2l0aFxuICogICBubyBzbGFzaCBtYXRjaGVzIGEgc2luZ2xlIHBhdGggY29tcG9uZW50IGF0IGFueSBkZXB0aC5cbiAqIC0gYCpgIGFuZCBgP2AgbWF0Y2ggd2l0aGluIG9uZSBwYXRoIHNlZ21lbnQ7IGAqKmAgbWF0Y2hlcyBhY3Jvc3Mgc2VnbWVudHMuXG4gKiAtIE5lZ2F0aW9uIChgIWApIGlzIG5vdCBzdXBwb3J0ZWQuXG4gKlxuICogRmFpbC1vcGVuOiBhIG1pc3Npbmcgb3IgdW5yZWFkYWJsZSBgLmdhdGVpZ25vcmVgLCBvciBhIG1hbGZvcm1lZCBsaW5lLFxuICogeWllbGRzIG5vIGFkZGl0aW9uYWwgZXhjbHVzaW9uIFx1MjAxNCB0aGUgdW5jb3ZlcmVkLXdyaXRlcyBjaGVjayBzaW1wbHkgZmFsbHNcbiAqIGJhY2sgdG8gdGhlIGAuc3Bhbi8qKmAtb25seSBleGNsdXNpb24gaXQgYWxyZWFkeSBhcHBsaWVzLlxuICovXG5cbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGNvbXBpbGVQYXR0ZXJuIH0gZnJvbSAnLi9zcGFuLWlnbm9yZS5qcyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgR2F0ZUlnbm9yZVJ1bGUge1xuICAvKiogVGhlIHJhdyBnaXRpZ25vcmUtc3R5bGUgcGF0dGVybiwgcmV0YWluZWQgZm9yIGRpYWdub3N0aWNzLiAqL1xuICBwYXR0ZXJuOiBzdHJpbmc7XG4gIC8qKiBUcnVlIHdoZW4gYHJlcG9SZWxQYXRoYCAoUE9TSVgsIHJlcG8tcmVsYXRpdmUpIGlzIGV4Y2x1ZGVkIGJ5IHRoaXMgcnVsZS4gKi9cbiAgbWF0Y2hlczogKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IGJvb2xlYW47XG59XG5cbmNvbnN0IEdBVEVfSUdOT1JFX1JFTCA9IG5vZGVQYXRoLmpvaW4oJy5zcGFuJywgJy5nYXRlaWdub3JlJyk7XG5cbi8qKiBQYXJzZSBgLmdhdGVpZ25vcmVgIHRleHQgaW50byBydWxlcywgc2tpcHBpbmcgY29tbWVudHMgYW5kIGJsYW5rIGxpbmVzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlR2F0ZUlnbm9yZShjb250ZW50OiBzdHJpbmcpOiBHYXRlSWdub3JlUnVsZVtdIHtcbiAgY29uc3QgcnVsZXM6IEdhdGVJZ25vcmVSdWxlW10gPSBbXTtcbiAgZm9yIChjb25zdCByYXdMaW5lIG9mIGNvbnRlbnQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgcGF0dGVybiA9IHJhd0xpbmUudHJpbSgpO1xuICAgIGlmICghcGF0dGVybiB8fCBwYXR0ZXJuLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgcnVsZXMucHVzaCh7IHBhdHRlcm4sIG1hdGNoZXM6IGNvbXBpbGVQYXR0ZXJuKHBhdHRlcm4pIH0pO1xuICB9XG4gIHJldHVybiBydWxlcztcbn1cblxuLyoqXG4gKiBMb2FkIHRoZSBleGNsdXNpb24gcnVsZXMgZm9yIGEgcmVwby4gRmFpbC1vcGVuOiBhbnkgcmVhZCBmYWlsdXJlIHlpZWxkcyBhblxuICogZW1wdHkgcnVsZSBzZXQsIHNvIGFuIGFic2VudC91bnJlYWRhYmxlIGAuZ2F0ZWlnbm9yZWAgZXhjbHVkZXMgbm90aGluZ1xuICogYmV5b25kIHRoZSBnYXRlJ3MgdW5jb25kaXRpb25hbCBgLnNwYW4vKipgIGV4Y2x1c2lvbi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxvYWRHYXRlSWdub3JlKHJlcG9Sb290OiBzdHJpbmcpOiBHYXRlSWdub3JlUnVsZVtdIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKG5vZGVQYXRoLmpvaW4ocmVwb1Jvb3QsIEdBVEVfSUdOT1JFX1JFTCksICd1dGY4Jyk7XG4gICAgcmV0dXJuIHBhcnNlR2F0ZUlnbm9yZShjb250ZW50KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG59XG5cbi8qKiBUcnVlIHdoZW4gc29tZSBydWxlIGluIGBydWxlc2AgbWF0Y2hlcyBgcmVwb1JlbFBhdGhgLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzR2F0ZUlnbm9yZWQocnVsZXM6IEdhdGVJZ25vcmVSdWxlW10sIHJlcG9SZWxQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHJ1bGVzLnNvbWUoKHJ1bGUpID0+IHJ1bGUubWF0Y2hlcyhyZXBvUmVsUGF0aCkpO1xufVxuXG4vKiogU2lnbmF0dXJlIGZvciBpbmplY3RpbmcgYSBydWxlIGxvYWRlciAocHJvZHVjdGlvbiBkZWZhdWx0OiB7QGxpbmsgbG9hZEdhdGVJZ25vcmV9KS4gKi9cbmV4cG9ydCB0eXBlIEdhdGVJZ25vcmVMb2FkZXIgPSAocmVwb1Jvb3Q6IHN0cmluZykgPT4gR2F0ZUlnbm9yZVJ1bGVbXTtcbiIsICIvKipcbiAqIFBhdGgtc2NvcGVkIHNwYW4gc3VwcHJlc3Npb24gZm9yIHRoZSBhZ2VudCBob29rcy5cbiAqXG4gKiBTb21lIHNwYW5zIGFyZSBub2lzZSB3aGVuIGJyb3dzaW5nIGNlcnRhaW4gcGFydHMgb2YgdGhlIHRyZWUgXHUyMDE0IHdpa2kgb3JcbiAqIG1hcmtldGluZyBzcGFucyB0aGF0IGFuY2hvciBwcm9zZSwgc3VyZmFjZWQgaW5saW5lIHdoaWxlIHJlYWRpbmcgc291cmNlLFxuICogYWRkIGxpdHRsZS4gVGhpcyBtb2R1bGUgbGV0cyBhIHJlcG8gZGVjbGFyZSwgcGVyIHBhdGgsIHdoaWNoIHNwYW4gc2x1Z1xuICogcHJlZml4ZXMgdG8gaG9sZCBiYWNrLlxuICpcbiAqIENvbmZpZyBsaXZlcyBhdCBgPHJlcG9Sb290Pi8uc3Bhbi8uaG9va2lnbm9yZWAuIEVhY2ggbm9uLWNvbW1lbnQgbGluZSBpcyBhXG4gKiBnaXRpZ25vcmUtc3R5bGUgcGF0aCBwYXR0ZXJuLCBhIHNpbmdsZSBydW4gb2Ygd2hpdGVzcGFjZSwgdGhlbiBhXG4gKiBjb21tYS1zZXBhcmF0ZWQgbGlzdCBvZiBzcGFuIHNsdWcgcHJlZml4ZXMgdG8gc3VwcHJlc3MgZm9yIHBhdGhzIHRoZSBwYXR0ZXJuXG4gKiBtYXRjaGVzOlxuICpcbiAqICAgcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjIHdpa2ksbWFya2V0aW5nXG4gKlxuICogQSBzcGFuIHdob3NlIHNsdWcgYmVnaW5zIHdpdGggYHdpa2lgIG9yIGBtYXJrZXRpbmdgICh0aGUgc2x1ZyBlcXVhbHMgdGhlXG4gKiBwcmVmaXgsIG9yIGlzIGA8cHJlZml4Pi9cdTIwMjZgKSBpcyB0aGVuIG5ldmVyIHN1cmZhY2VkIGZvciBhbiBhbmNob3Igd2hvc2UgcGF0aFxuICogc2l0cyB1bmRlciBgcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjYCBcdTIwMTQgbmVpdGhlciBpbmxpbmUgYnkgdGhlIFByZVRvb2xVc2UgaG9va1xuICogbm9yIGluIHRoZSBTdG9wIGhvb2sncyBzdGFsZSAvIHJlbGF0ZWQgc2VjdGlvbnMuXG4gKlxuICogUGF0dGVybiBncmFtbWFyIGlzIGEgZGVsaWJlcmF0ZSBzdWJzZXQgb2YgZ2l0aWdub3JlOlxuICpcbiAqIC0gQmxhbmsgbGluZXMgYW5kIGxpbmVzIGJlZ2lubmluZyB3aXRoIGAjYCBhcmUgc2tpcHBlZC5cbiAqIC0gQSB0cmFpbGluZyBgL2AgcmVzdHJpY3RzIHRoZSBwYXR0ZXJuIHRvIGRpcmVjdG9yaWVzICh0aGUgbGVhZiBmaWxlIGlzIG5vdFxuICogICBpdHNlbGYgdGVzdGVkLCBvbmx5IGl0cyBhbmNlc3RvciBkaXJlY3RvcmllcykuXG4gKiAtIEEgcGF0dGVybiBjb250YWluaW5nIGEgc2xhc2ggaXMgYW5jaG9yZWQgdG8gdGhlIHJlcG8gcm9vdDsgYSBwYXR0ZXJuIHdpdGhcbiAqICAgbm8gc2xhc2ggbWF0Y2hlcyBhIHNpbmdsZSBwYXRoIGNvbXBvbmVudCBhdCBhbnkgZGVwdGguXG4gKiAtIGAqYCBhbmQgYD9gIG1hdGNoIHdpdGhpbiBvbmUgcGF0aCBzZWdtZW50OyBgKipgIG1hdGNoZXMgYWNyb3NzIHNlZ21lbnRzLlxuICogLSBOZWdhdGlvbiAoYCFgKSBpcyBub3Qgc3VwcG9ydGVkLlxuICpcbiAqIFN1cHByZXNzaW9uIGlzIGZhaWwtb3BlbjogYSBtaXNzaW5nIG9yIHVucmVhZGFibGUgYC5ob29raWdub3JlYCwgb3IgYVxuICogbWFsZm9ybWVkIGxpbmUsIHlpZWxkcyBubyBydWxlIHJhdGhlciB0aGFuIGhpZGluZyBzcGFucyB0aGUgYXV0aG9yIGRpZCBub3RcbiAqIGFzayB0byBoaWRlLlxuICovXG5cbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcblxuZXhwb3J0IGludGVyZmFjZSBJZ25vcmVSdWxlIHtcbiAgLyoqIFRoZSByYXcgZ2l0aWdub3JlLXN0eWxlIHBhdHRlcm4sIHJldGFpbmVkIGZvciBkaWFnbm9zdGljcy4gKi9cbiAgcGF0dGVybjogc3RyaW5nO1xuICAvKiogU3BhbiBzbHVnIHByZWZpeGVzIHN1cHByZXNzZWQgZm9yIHBhdGhzIHRoaXMgcnVsZSBtYXRjaGVzLiAqL1xuICBwcmVmaXhlczogc3RyaW5nW107XG4gIC8qKiBUcnVlIHdoZW4gYHJlcG9SZWxQYXRoYCAoUE9TSVgsIHJlcG8tcmVsYXRpdmUpIGlzIGdvdmVybmVkIGJ5IHRoaXMgcnVsZS4gKi9cbiAgbWF0Y2hlczogKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IGJvb2xlYW47XG59XG5cbmNvbnN0IEhPT0tfSUdOT1JFX1JFTCA9IG5vZGVQYXRoLmpvaW4oJy5zcGFuJywgJy5ob29raWdub3JlJyk7XG5cbi8qKlxuICogVHJhbnNsYXRlIG9uZSBnaXRpZ25vcmUtc3R5bGUgZ2xvYiBzZWdtZW50IGludG8gYW4gYW5jaG9yZWQgUmVnRXhwLiBgKmAgYW5kXG4gKiBgP2Agc3RheSB3aXRoaW4gYSBwYXRoIHNlZ21lbnQ7IGAqKmAgKG9wdGlvbmFsbHkgZm9sbG93ZWQgYnkgYC9gKSBzcGFucyB0aGVtLlxuICovXG5mdW5jdGlvbiBnbG9iVG9SZWdFeHAoZ2xvYjogc3RyaW5nKTogUmVnRXhwIHtcbiAgbGV0IHJlID0gJyc7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgZ2xvYi5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGMgPSBnbG9iW2ldO1xuICAgIGlmIChjID09PSAnKicpIHtcbiAgICAgIGlmIChnbG9iW2kgKyAxXSA9PT0gJyonKSB7XG4gICAgICAgIHJlICs9ICcuKic7XG4gICAgICAgIGkrKztcbiAgICAgICAgLy8gQWJzb3JiIGEgZm9sbG93aW5nIHNsYXNoIHNvIGAqKi9mb29gIGRvZXMgbm90IGRlbWFuZCBhIGxpdGVyYWwgYC9gLlxuICAgICAgICBpZiAoZ2xvYltpICsgMV0gPT09ICcvJykgaSsrO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmUgKz0gJ1teL10qJztcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGMgPT09ICc/Jykge1xuICAgICAgcmUgKz0gJ1teL10nO1xuICAgIH0gZWxzZSB7XG4gICAgICByZSArPSBjLnJlcGxhY2UoL1suK14ke30oKXxbXFxdXFxcXF0vZywgJ1xcXFwkJicpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbmV3IFJlZ0V4cChgXiR7cmV9JGApO1xufVxuXG4vKiogQW5jZXN0b3IgcGF0aCBjaGFpbjogYGEvYi9jLnRzYCBcdTIxOTIgYFsnYScsICdhL2InLCAnYS9iL2MudHMnXWAuICovXG5mdW5jdGlvbiBhbmNlc3RvclBhdGhzKHBhdGg6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgcGFydHMgPSBwYXRoLnNwbGl0KCcvJyk7XG4gIGNvbnN0IG91dDogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIG91dC5wdXNoKHBhcnRzLnNsaWNlKDAsIGkgKyAxKS5qb2luKCcvJykpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKlxuICogQ29tcGlsZSBhIHNpbmdsZSBnaXRpZ25vcmUtc3R5bGUgcGF0dGVybiAodGhpcyBtb2R1bGUncyBncmFtbWFyIFx1MjAxNCBzZWUgdGhlXG4gKiBtb2R1bGUgZG9jIGNvbW1lbnQpIGludG8gYSBwYXRoIHByZWRpY2F0ZS4gQSBwYXR0ZXJuIG1hdGNoZXMgYSBmaWxlIHdoZW4gaXRcbiAqIG1hdGNoZXMgdGhlIGZpbGUncyBwYXRoIG9yIGFueSBhbmNlc3RvciBkaXJlY3Rvcnkgb2YgaXQsIHNvIGEgZGlyZWN0b3J5XG4gKiBwYXR0ZXJuIHN1cHByZXNzZXMgZXZlcnl0aGluZyBiZW5lYXRoIGl0LlxuICpcbiAqIEV4cG9ydGVkIHNvIG90aGVyIHBhdGgtc2NvcGVkIGlnbm9yZS1maWxlIGNvbnZlbnRpb25zIChlLmcuIGAuZ2F0ZWlnbm9yZWBcbiAqIGluIGBnYXRlLWlnbm9yZS50c2ApIGNhbiByZXVzZSB0aGUgZXhhY3QgbWF0Y2hpbmcgc2VtYW50aWNzIHJhdGhlciB0aGFuXG4gKiByZWltcGxlbWVudGluZyB0aGVtLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29tcGlsZVBhdHRlcm4ocGF0dGVybjogc3RyaW5nKTogKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IGJvb2xlYW4ge1xuICBsZXQgcGF0ID0gcGF0dGVybjtcbiAgbGV0IGRpck9ubHkgPSBmYWxzZTtcbiAgaWYgKHBhdC5lbmRzV2l0aCgnLycpKSB7XG4gICAgZGlyT25seSA9IHRydWU7XG4gICAgcGF0ID0gcGF0LnNsaWNlKDAsIC0xKTtcbiAgfVxuICBsZXQgYW5jaG9yZWQgPSBwYXQuaW5jbHVkZXMoJy8nKTtcbiAgaWYgKHBhdC5zdGFydHNXaXRoKCcvJykpIHtcbiAgICBhbmNob3JlZCA9IHRydWU7XG4gICAgcGF0ID0gcGF0LnNsaWNlKDEpO1xuICB9XG4gIGNvbnN0IHJlID0gZ2xvYlRvUmVnRXhwKHBhdCk7XG5cbiAgcmV0dXJuIChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiB7XG4gICAgaWYgKGFuY2hvcmVkKSB7XG4gICAgICBjb25zdCBzZWdzID0gYW5jZXN0b3JQYXRocyhyZXBvUmVsUGF0aCk7XG4gICAgICAvLyBGb3IgYSBkaXItb25seSBwYXR0ZXJuLCBuZXZlciB0ZXN0IHRoZSBsZWFmIGZpbGUgaXRzZWxmLlxuICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IGRpck9ubHkgPyBzZWdzLnNsaWNlKDAsIC0xKSA6IHNlZ3M7XG4gICAgICByZXR1cm4gY2FuZGlkYXRlcy5zb21lKChzKSA9PiByZS50ZXN0KHMpKTtcbiAgICB9XG4gICAgLy8gVW5hbmNob3JlZDogbWF0Y2ggYWdhaW5zdCBpbmRpdmlkdWFsIHBhdGggY29tcG9uZW50cyBhdCBhbnkgZGVwdGguXG4gICAgY29uc3QgY29tcG9uZW50cyA9IHJlcG9SZWxQYXRoLnNwbGl0KCcvJyk7XG4gICAgY29uc3QgY2FuZGlkYXRlcyA9IGRpck9ubHkgPyBjb21wb25lbnRzLnNsaWNlKDAsIC0xKSA6IGNvbXBvbmVudHM7XG4gICAgcmV0dXJuIGNhbmRpZGF0ZXMuc29tZSgoYykgPT4gcmUudGVzdChjKSk7XG4gIH07XG59XG5cbi8qKiBQYXJzZSBgLmhvb2tpZ25vcmVgIHRleHQgaW50byBydWxlcywgc2tpcHBpbmcgY29tbWVudHMgYW5kIG1hbGZvcm1lZCBsaW5lcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUhvb2tJZ25vcmUoY29udGVudDogc3RyaW5nKTogSWdub3JlUnVsZVtdIHtcbiAgY29uc3QgcnVsZXM6IElnbm9yZVJ1bGVbXSA9IFtdO1xuICBmb3IgKGNvbnN0IHJhd0xpbmUgb2YgY29udGVudC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCBsaW5lID0gcmF3TGluZS50cmltKCk7XG4gICAgaWYgKCFsaW5lIHx8IGxpbmUuc3RhcnRzV2l0aCgnIycpKSBjb250aW51ZTtcbiAgICAvLyBgPHBhdHRlcm4+PHdoaXRlc3BhY2U+PHByZWZpeGVzPmAgXHUyMDE0IHBhdHRlcm4gaXMgdGhlIGZpcnN0IHRva2VuLCBwcmVmaXhlc1xuICAgIC8vIHRoZSBzZWNvbmQuIEEgbGluZSB3aXRob3V0IGJvdGggaXMgbWFsZm9ybWVkIGFuZCBza2lwcGVkLlxuICAgIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXihcXFMrKVxccysoXFxTKykkLyk7XG4gICAgaWYgKCFtYXRjaCkgY29udGludWU7XG4gICAgY29uc3QgWywgcGF0dGVybiwgcHJlZml4ZXNSYXddID0gbWF0Y2g7XG4gICAgY29uc3QgcHJlZml4ZXMgPSBwcmVmaXhlc1Jhd1xuICAgICAgLnNwbGl0KCcsJylcbiAgICAgIC5tYXAoKHApID0+IHAudHJpbSgpKVxuICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgICBpZiAocHJlZml4ZXMubGVuZ3RoID09PSAwKSBjb250aW51ZTtcbiAgICBydWxlcy5wdXNoKHsgcGF0dGVybiwgcHJlZml4ZXMsIG1hdGNoZXM6IGNvbXBpbGVQYXR0ZXJuKHBhdHRlcm4pIH0pO1xuICB9XG4gIHJldHVybiBydWxlcztcbn1cblxuLyoqXG4gKiBMb2FkIHRoZSBzdXBwcmVzc2lvbiBydWxlcyBmb3IgYSByZXBvLiBGYWlsLW9wZW46IGFueSByZWFkIG9yIHBhcnNlIGZhaWx1cmVcbiAqIHlpZWxkcyBhbiBlbXB0eSBydWxlIHNldCwgc28gc3BhbnMgc3VyZmFjZSBhcyBub3JtYWwgd2hlbiBubyBjb25maWcgZXhpc3RzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbG9hZEhvb2tJZ25vcmUocmVwb1Jvb3Q6IHN0cmluZyk6IElnbm9yZVJ1bGVbXSB7XG4gIHRyeSB7XG4gICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhub2RlUGF0aC5qb2luKHJlcG9Sb290LCBIT09LX0lHTk9SRV9SRUwpLCAndXRmOCcpO1xuICAgIHJldHVybiBwYXJzZUhvb2tJZ25vcmUoY29udGVudCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBbXTtcbiAgfVxufVxuXG4vKiogQSBzbHVnIGNhcnJpZXMgYSBwcmVmaXggd2hlbiBpdCBlcXVhbHMgdGhlIHByZWZpeCBvciBpcyBgPHByZWZpeD4vXHUyMDI2YC4gKi9cbmZ1bmN0aW9uIHNsdWdIYXNQcmVmaXgoc2x1Zzogc3RyaW5nLCBwcmVmaXg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gc2x1ZyA9PT0gcHJlZml4IHx8IHNsdWcuc3RhcnRzV2l0aChgJHtwcmVmaXh9L2ApO1xufVxuXG4vKipcbiAqIFRydWUgd2hlbiBhIHNwYW4gYHNsdWdgIHNob3VsZCBiZSBzdXBwcmVzc2VkIGZvciBhbiBhbmNob3IgYXQgYHJlcG9SZWxQYXRoYDpcbiAqIHNvbWUgcnVsZSBtYXRjaGVzIHRoZSBwYXRoIGFuZCBsaXN0cyBhIHByZWZpeCB0aGUgc2x1ZyBjYXJyaWVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNTcGFuU3VwcHJlc3NlZChydWxlczogSWdub3JlUnVsZVtdLCByZXBvUmVsUGF0aDogc3RyaW5nLCBzbHVnOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgZm9yIChjb25zdCBydWxlIG9mIHJ1bGVzKSB7XG4gICAgaWYgKCFydWxlLm1hdGNoZXMocmVwb1JlbFBhdGgpKSBjb250aW51ZTtcbiAgICBpZiAocnVsZS5wcmVmaXhlcy5zb21lKChwKSA9PiBzbHVnSGFzUHJlZml4KHNsdWcsIHApKSkgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKiogU2lnbmF0dXJlIGZvciBpbmplY3RpbmcgYSBydWxlIGxvYWRlciAocHJvZHVjdGlvbiBkZWZhdWx0OiB7QGxpbmsgbG9hZEhvb2tJZ25vcmV9KS4gKi9cbmV4cG9ydCB0eXBlIEhvb2tJZ25vcmVMb2FkZXIgPSAocmVwb1Jvb3Q6IHN0cmluZykgPT4gSWdub3JlUnVsZVtdO1xuIiwgIi8qKlxuICogQ29kZXggUHJlVG9vbFVzZSBnYXRlIGhvb2sgXHUyMDE0IGhvbGQgYGdpdCBjb21taXRgL2BnaXQgcHVzaGAgb24gcmVhbCBzcGFuIGRlYnQuXG4gKlxuICogVGhlIENvZGV4IHR3aW4gb2YgW2NsYXVkZS9nYXRlLnRzXSguL3BhY2thZ2VzL2FnZW50LWhvb2tzL3NyYy9jbGF1ZGUvZ2F0ZS50cyk6XG4gKiBzYW1lIHNoYXJlZCBnYXRlLWNvcmUgcGlwZWxpbmUgKHtAbGluayBwYXJzZUdpdENvbW1hbmR9IFx1MjE5MiB7QGxpbmsgcmVzb2x2ZUNoYW5nZXNldH1cbiAqIFx1MjE5MiB7QGxpbmsgZXZhbHVhdGVHYXRlfSksIHRyYW5zbGF0ZWQgaW50byBDb2RleCdzIFByZVRvb2xVc2Ugb3V0cHV0IHNoYXBlLiBDb2RleFxuICogZGVsaXZlcnMgYSBzaGVsbCBjb21tYW5kIGFzIGFuIFNESy10eXBlZCBgdW5rbm93bmAgYHRvb2xfaW5wdXRgOyB0aGlzIGhhbmRsZXJcbiAqIG5hcnJvd3MgaXQgKHN0cmluZywgb3IgYSBgW1wiYmFzaFwiLFwiLWxjXCIsXCI8c2NyaXB0PlwiXWAvYXJndiBhcnJheSkgaW50byB0aGVcbiAqIGNvbW1hbmQgc3RyaW5nIHRoZSBjb3JlIHBhcnNlcy5cbiAqXG4gKiBcdTI1MDBcdTI1MDAgVW5jb25maXJtZWQgZGVueSAoc2VlIG5vdGVzL2NvZGV4LWRlbnktc3Bpa2UubWQpIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICogV2hldGhlciBDb2RleCdzIGBwZXJtaXNzaW9uRGVjaXNpb246ICdkZW55J2AgYWN0dWFsbHkgKmJsb2NrcyogdGhlIHNoZWxsIHRvb2xcbiAqIGxpdmUgd2FzIG5ldmVyIGNvbmZpcm1lZCBpbiB0aGlzIHJlcG86IHRoZSBQaGFzZSAwIHNwaWtlIGNvdWxkIG5vdCBnZXQgYVxuICogZnJvbS1zY3JhdGNoIHBsdWdpbiB0byBsb2FkLCBzbyB0aGUgZGVueSBwYXRoIHdhcyBuZXZlciBleGVyY2lzZWQgZW5kLXRvLWVuZC5cbiAqIFRoZSBvbmx5IHBvc2l0aXZlIGV2aWRlbmNlIGlzIGRvY3VtZW50YXJ5IFx1MjAxNCB0aGUgYEBnb29kZm9vdC9jb2RleC1ob29rc2AgUkVBRE1FXG4gKiAodGhlIGV4YWN0IHZlcnNpb24gdGhpcyByZXBvIGRlcGVuZHMgb24pIHNoaXBzIGEgd29ya2VkIGBwZXJtaXNzaW9uRGVjaXNpb246XG4gKiAnZGVueSdgIGV4YW1wbGUgbWF0Y2hlZCBvbiBgXCJCYXNoXCJgLiBUaGlzIGFkYXB0ZXIgdGhlcmVmb3JlIHNoaXBzIHRoZSBoYXJkLWRlbnlcbiAqIHBhdGggcGVyIHRoYXQgUkVBRE1FICh7QGxpbmsgQ09ERVhfR0FURV9IQVJEX0RFTll9ID0gYHRydWVgKSwgYnV0IGtlZXBzIHRoZVxuICogQ0FSRC5tZC1kb2N1bWVudGVkIGZhbGxiYWNrIFx1MjAxNCBhIGxvdWQgYGFkZGl0aW9uYWxDb250ZXh0YCB3YXJuaW5nIHRoYXQgYWxsb3dzXG4gKiB0aGUgY29tbWFuZCwgd2l0aCB0aGUgQ0kgcmVjaXBlIGFzIENvZGV4J3MgZW5mb3JjZW1lbnQgYmFja3N0b3AgXHUyMDE0IGFzIGEgY2xlYXJseVxuICogc2VwYXJhYmxlIGJyYW5jaCBiZWhpbmQgdGhhdCBvbmUgY29uc3RhbnQuIElmIGEgbGl2ZSBzZXNzaW9uIHNob3dzIGRlbnkgZG9lc1xuICogbm90IGZpcmUsIGZsaXAge0BsaW5rIENPREVYX0dBVEVfSEFSRF9ERU5ZfSB0byBgZmFsc2VgOyBub3RoaW5nIGVsc2UgY2hhbmdlcy5cbiAqXG4gKiBUaGUgc2hlbGwgdG9vbCdzIGV4YWN0IGB0b29sX25hbWVgIGlzIGxpa2V3aXNlIHVuY29uZmlybWVkICh0aGUgUkVBRE1FJ3NcbiAqIGV4YW1wbGUgdXNlcyBgXCJCYXNoXCJgOyBDb2RleCBDTEkgdHJhbnNjcmlwdHMgaW4gdGhlIHNwaWtlIGxhYmVsZWQgdGhlIGNhbGxcbiAqIGBleGVjYCkuIFRoZSByZWdpc3RyYXRpb24gbWF0Y2hlciBpcyBicm9hZGVuZWQgdG8gdGhlIHBsYXVzaWJsZSBuYW1lcyBzbyB0aGVcbiAqIGhvb2sgYWN0dWFsbHkgZmlyZXMsIGFuZCBldmVyeSBmaXJlIGxvZ3MgdGhlIG9ic2VydmVkIGB0b29sX25hbWVgIHNvIHRoZSBmaXJzdFxuICogbGl2ZSBydW4gcmV2ZWFscyB0aGUgbGl0ZXJhbCBzdHJpbmcgdG8gbmFycm93IHRoZSBtYXRjaGVyIHRvLlxuICpcbiAqIEZhaWwtb3BlbiBhdCBldmVyeSBsYXllcjogZ2F0ZS1jb3JlIHJlc29sdmVzIGludGVybmFsIGVycm9ycyB0byBhbGxvdywgYW5kIHRoaXNcbiAqIGFkYXB0ZXIgd3JhcHMgdGhlIHdob2xlIHBhdGggaW4gYSB0cnkvY2F0Y2ggdGhhdCBhbGxvd3MtYW5kLWxvZ3MgXHUyMDE0IHRoZSBnYXRlXG4gKiBtdXN0IG5ldmVyIGJyaWNrIGEgY29tbWl0LiBUaGUgdGltZW91dCBpcyBtaWxsaXNlY29uZHMgaGVyZSAodGhlIENvZGV4IENMSVxuICogZGl2aWRlcyB0byBzZWNvbmRzIGF0IGVtaXQpLlxuICovXG5cbmltcG9ydCB7IHR5cGUgSG9va0NvbnRleHQsIHR5cGUgUHJlVG9vbFVzZUlucHV0LCBwcmVUb29sVXNlSG9vaywgcHJlVG9vbFVzZU91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jb2RleC1ob29rcyc7XG5pbXBvcnQge1xuICBjb21taXRTdGFnZXNBbGwsXG4gIGNyZWF0ZURlZmF1bHRHYXRlRXhlY3V0b3JzLFxuICBjcmVhdGVEZWZhdWx0R2l0RXhlY3V0b3IsXG4gIGNyZWF0ZURpc2tHYXRlTWVtb1N0YXRlLFxuICBldmFsdWF0ZUdhdGUsXG4gIHR5cGUgR2F0ZUV4ZWN1dG9ycyxcbiAgdHlwZSBHYXRlTWVtb1N0YXRlLFxuICB0eXBlIEdpdEV4ZWN1dG9yLFxuICBwYXJzZUdpdENvbW1hbmQsXG4gIHJlc29sdmVDaGFuZ2VzZXRcbn0gZnJvbSAnLi4vY29tbW9uL2dhdGUtY29yZS5qcyc7XG5cbi8qKlxuICogV2hldGhlciBDb2RleCdzIGBwZXJtaXNzaW9uRGVjaXNpb246ICdkZW55J2AgaXMgdHJ1c3RlZCB0byBibG9jayB0aGUgc2hlbGwgdG9vbFxuICogbGl2ZS4gU2hpcHMgYHRydWVgIChoYXJkIGRlbnkpIHBlciB0aGUgYEBnb29kZm9vdC9jb2RleC1ob29rc2AgUkVBRE1FJ3Mgd29ya2VkXG4gKiBleGFtcGxlLiBGbGlwIHRvIGBmYWxzZWAgdG8gYWN0aXZhdGUgdGhlIENBUkQubWQtZG9jdW1lbnRlZCBmYWxsYmFjayBpZiBhIGxpdmVcbiAqIHNlc3Npb24gc2hvd3MgZGVueSBkb2VzIG5vdCBmaXJlIFx1MjAxNCBzZWUgbm90ZXMvY29kZXgtZGVueS1zcGlrZS5tZCBhbmQgdGhpc1xuICogZmlsZSdzIGhlYWRlci4gVGhpcyBpcyB0aGUgc2luZ2xlIHN3aXRjaCB0aGF0IHNlcGFyYXRlcyB0aGUgdHdvIGNvZGUgcGF0aHMuXG4gKi9cbmNvbnN0IENPREVYX0dBVEVfSEFSRF9ERU5ZID0gdHJ1ZTtcblxuLyoqXG4gKiBOYXJyb3cgQ29kZXgncyBgdW5rbm93bmAgc2hlbGwgYHRvb2xfaW5wdXRgIGludG8gdGhlIGNvbW1hbmQgc3RyaW5nIHRoZSBjb3JlXG4gKiBwYXJzZXMuIEhhbmRsZXMgYSBiYXJlIGBjb21tYW5kYCBzdHJpbmcsIGEgc2hlbGwtd3JhcHBlciBhcmd2XG4gKiAoYFtcImJhc2hcIixcIi1sY1wiLFwiPHNjcmlwdD5cIl1gIFx1MjE5MiB0aGUgc2NyaXB0IGFmdGVyIGAtY2AvYC1sY2ApLCBhbmQgYSBkaXJlY3QgYXJndlxuICogKGBbXCJnaXRcIixcImNvbW1pdFwiLFx1MjAyNl1gIFx1MjE5MiBzcGFjZS1qb2luZWQpLiBSZXR1cm5zIGBudWxsYCB3aGVuIG5vIGNvbW1hbmQgdGV4dCBpc1xuICogcmVjb3ZlcmFibGUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0U2hlbGxDb21tYW5kKHRvb2xJbnB1dDogdW5rbm93bik6IHN0cmluZyB8IG51bGwge1xuICBpZiAodG9vbElucHV0ID09PSBudWxsIHx8IHR5cGVvZiB0b29sSW5wdXQgIT09ICdvYmplY3QnIHx8ICEoJ2NvbW1hbmQnIGluIHRvb2xJbnB1dCkpIHJldHVybiBudWxsO1xuICBjb25zdCBjb21tYW5kID0gKHRvb2xJbnB1dCBhcyB7IGNvbW1hbmQ6IHVua25vd24gfSkuY29tbWFuZDtcbiAgaWYgKHR5cGVvZiBjb21tYW5kID09PSAnc3RyaW5nJykgcmV0dXJuIGNvbW1hbmQubGVuZ3RoID4gMCA/IGNvbW1hbmQgOiBudWxsO1xuICBpZiAoQXJyYXkuaXNBcnJheShjb21tYW5kKSkge1xuICAgIGNvbnN0IHBhcnRzID0gY29tbWFuZC5maWx0ZXIoKHApOiBwIGlzIHN0cmluZyA9PiB0eXBlb2YgcCA9PT0gJ3N0cmluZycpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGZsYWdJZHggPSBwYXJ0cy5maW5kSW5kZXgoKHApID0+IHAgPT09ICctYycgfHwgcCA9PT0gJy1sYycgfHwgcCA9PT0gJy1pYycpO1xuICAgIGlmIChmbGFnSWR4ID49IDAgJiYgcGFydHNbZmxhZ0lkeCArIDFdICE9PSB1bmRlZmluZWQpIHJldHVybiBwYXJ0c1tmbGFnSWR4ICsgMV07XG4gICAgcmV0dXJuIHBhcnRzLmpvaW4oJyAnKTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUhhbmRsZXIoXG4gIGdpdDogR2l0RXhlY3V0b3IgPSBjcmVhdGVEZWZhdWx0R2l0RXhlY3V0b3IoKSxcbiAgZXhlY3V0b3JzOiBHYXRlRXhlY3V0b3JzID0gY3JlYXRlRGVmYXVsdEdhdGVFeGVjdXRvcnMoKSxcbiAgbWVtb0ZhY3Rvcnk6IChjd2Q6IHN0cmluZykgPT4gR2F0ZU1lbW9TdGF0ZSA9IGNyZWF0ZURpc2tHYXRlTWVtb1N0YXRlLFxuICAvLyBUaGUgaGFyZC1kZW55IHN3aXRjaCBpcyBhIHBhcmFtZXRlciAoZGVmYXVsdGluZyB0byB0aGUgc2hpcHBlZCBjb25zdGFudCkgc29cbiAgLy8gdGhlIGRvY3VtZW50ZWQgZmFsbGJhY2sgYnJhbmNoIGlzIGRpcmVjdGx5IGV4ZXJjaXNhYmxlIGluIHRlc3RzIHdpdGhvdXRcbiAgLy8gbXV0YXRpbmcgYSBtb2R1bGUtbGV2ZWwgY29uc3QuIFByb2R1Y3Rpb24gd2lyaW5nIG5ldmVyIHBhc3NlcyB0aGlzIFx1MjAxNCB0aGVcbiAgLy8gZGVmYXVsdCBleHBvcnQgYmVsb3cgY29uc3RydWN0cyB0aGUgaGFuZGxlciB3aXRoIHRoZSBjb25zdGFudCdzIHZhbHVlLlxuICBoYXJkRGVueTogYm9vbGVhbiA9IENPREVYX0dBVEVfSEFSRF9ERU5ZXG4pIHtcbiAgcmV0dXJuIGFzeW5jIChpbnB1dDogUHJlVG9vbFVzZUlucHV0LCBjdHg6IEhvb2tDb250ZXh0KSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIExvZyB0aGUgb2JzZXJ2ZWQgc2hlbGwgdG9vbF9uYW1lIHNvIHRoZSBmaXJzdCBsaXZlIHJ1biByZXZlYWxzIHRoZSBsaXRlcmFsXG4gICAgICAvLyBzdHJpbmcgdG8gbmFycm93IHRoZSBtYXRjaGVyIHRvICh0aGUgc3Bpa2UgbmV2ZXIgY29uZmlybWVkIGl0IGVtcGlyaWNhbGx5KS5cbiAgICAgIGN0eC5sb2dnZXIuaW5mbygnZ2l0LXNwYW4gZ2F0ZSBvYnNlcnZlZCBzaGVsbCB0b29sJywgeyB0b29sX25hbWU6IGlucHV0LnRvb2xfbmFtZSB9KTtcblxuICAgICAgY29uc3QgY29tbWFuZCA9IGV4dHJhY3RTaGVsbENvbW1hbmQoaW5wdXQudG9vbF9pbnB1dCk7XG4gICAgICBpZiAoY29tbWFuZCA9PT0gbnVsbCkgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoe30pO1xuXG4gICAgICBjb25zdCBwYXJzZWQgPSBwYXJzZUdpdENvbW1hbmQoY29tbWFuZCk7XG4gICAgICBpZiAocGFyc2VkLmtpbmQgPT09ICdub25lJykgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoe30pO1xuXG4gICAgICBjb25zdCBjd2QgPSBpbnB1dC5jd2QgPz8gJyc7XG4gICAgICBjb25zdCBhbGwgPSBwYXJzZWQua2luZCA9PT0gJ2NvbW1pdCcgPyBjb21taXRTdGFnZXNBbGwoY29tbWFuZCkgOiBmYWxzZTtcbiAgICAgIGNvbnN0IGNoYW5nZXNldCA9IGF3YWl0IHJlc29sdmVDaGFuZ2VzZXQocGFyc2VkLmtpbmQsIGFsbCwgY3dkLCBnaXQsIHBhcnNlZC5wYXRocyk7XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGV2YWx1YXRlR2F0ZShjaGFuZ2VzZXQsIGN3ZCwgZXhlY3V0b3JzLCBtZW1vRmFjdG9yeShjd2QpKTtcbiAgICAgIGlmIChyZXN1bHQuZGVjaXNpb24gIT09ICdkZW55Jykge1xuICAgICAgICAvLyBFbnZpcm9ubWVudGFsIHN0YWxlbmVzcyBhbmQgYSBmYWlsZWQgc3RhbGVuZXNzIHNjYW4gYm90aCBhbGxvd1xuICAgICAgICAvLyAoZmFpbC1vcGVuKSBidXQgbXVzdCBub3QgYmUgc3dhbGxvd2VkOiBsb2cgYW5kIHN1cmZhY2UgdGhlIHJlYXNvbiBhc1xuICAgICAgICAvLyBhZGRpdGlvbmFsIGNvbnRleHQuXG4gICAgICAgIGlmIChyZXN1bHQua2luZCA9PT0gJ2Vudmlyb25tZW50YWwnIHx8IHJlc3VsdC5raW5kID09PSAnc2Nhbi1mYWlsZWQnKSB7XG4gICAgICAgICAgY3R4LmxvZ2dlci53YXJuKCdnaXQtc3BhbiBnYXRlIGFsbG93ZWQgd2l0aCBhbiB1bnJlc29sdmVkIGNvbmRpdGlvbicsIHsgcmVhc29uOiByZXN1bHQucmVhc29uIH0pO1xuICAgICAgICAgIHJldHVybiBwcmVUb29sVXNlT3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IHJlc3VsdC5yZWFzb24sIHN5c3RlbU1lc3NhZ2U6IHJlc3VsdC5yZWFzb24gfSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoe30pO1xuICAgICAgfVxuXG4gICAgICBpZiAoaGFyZERlbnkpIHtcbiAgICAgICAgLy8gUHJpbWFyeSBwYXRoIChwZXIgdGhlIFJFQURNRSk6IGFjdHVhbGx5IGJsb2NrIHRoZSBjb21tYW5kLlxuICAgICAgICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7XG4gICAgICAgICAgcGVybWlzc2lvbkRlY2lzaW9uOiAnZGVueScsXG4gICAgICAgICAgcGVybWlzc2lvbkRlY2lzaW9uUmVhc29uOiByZXN1bHQucmVhc29uLFxuICAgICAgICAgIHN5c3RlbU1lc3NhZ2U6IHJlc3VsdC5yZWFzb25cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICAvLyBGYWxsYmFjayBwYXRoIChDQVJELm1kIGNvbnRpbmdlbmN5KTogY2Fubm90IGJsb2NrLCBzbyBzdXJmYWNlIHRoZSBzYW1lXG4gICAgICAvLyBjaGVja2xpc3QgYXMgYSBsb3VkIHdhcm5pbmcgYW5kIGFsbG93IFx1MjAxNCB0aGUgQ0kgcmVjaXBlIGVuZm9yY2VzIGZvciBDb2RleC5cbiAgICAgIGNvbnN0IHdhcm5pbmcgPSBgQ291bGQgbm90IGJsb2NrIHRoaXMgY29tbWFuZCBcdTIwMTQgdGhlIGlzc3VlIGJlbG93IHN0aWxsIG5lZWRzIHJlc29sdmluZzpcXG4ke3Jlc3VsdC5yZWFzb259YDtcbiAgICAgIHJldHVybiBwcmVUb29sVXNlT3V0cHV0KHsgYWRkaXRpb25hbENvbnRleHQ6IHdhcm5pbmcsIHN5c3RlbU1lc3NhZ2U6IHdhcm5pbmcgfSk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjdHgubG9nZ2VyLndhcm4oJ2dpdC1zcGFuIGdhdGUgZmFpbGVkIG9wZW4gb24gYW4gdW5jYXVnaHQgZXJyb3InLCB7IGVyciB9KTtcbiAgICAgIHJldHVybiBwcmVUb29sVXNlT3V0cHV0KHt9KTtcbiAgICB9XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IHByZVRvb2xVc2VIb29rKHsgbWF0Y2hlcjogJ0Jhc2h8c2hlbGx8ZXhlY3xsb2NhbF9zaGVsbCcsIHRpbWVvdXQ6IDEwXzAwMCB9LCBjcmVhdGVIYW5kbGVyKCkpO1xuIiwgImltcG9ydCBob29rIGZyb20gXCIuL2dhdGUudHNcIjtcbmltcG9ydCB7IGV4ZWN1dGUgfSBmcm9tIFwiLi4vLi4vLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jb2RleC1ob29rcy9kaXN0L3J1bnRpbWUuanNcIjtcbmV4ZWN1dGUoaG9vayk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBNEJPLElBQU0sMEJBQTBCLG9CQUFJLElBQUksQ0FBQyxnQkFBZ0Isb0JBQW9CLGVBQWUsQ0FBQzs7O0FDNUJwRyxTQUFTLGVBQWUsZUFBZSxRQUFRLFNBQVM7QUFDcEQsUUFBTSxPQUFPO0FBQ2IsT0FBSyxnQkFBZ0I7QUFDckIsT0FBSyxVQUFVLE9BQU87QUFDdEIsT0FBSyxnQkFBZ0IsT0FBTztBQUM1QixNQUFJLGFBQWEsVUFBVSxPQUFPLE9BQU8sWUFBWSxVQUFVO0FBQzNELFNBQUssVUFBVSxPQUFPO0FBQUEsRUFDMUI7QUFDQSxTQUFPO0FBQ1g7QUFDTyxTQUFTLGVBQWUsUUFBUSxTQUFTO0FBQzVDLFNBQU8sZUFBZSxjQUFjLFFBQVEsT0FBTztBQUN2RDs7O0FDWkEsU0FBUyxXQUFXLFlBQVksV0FBVyxVQUFVLGlCQUFpQjtBQUN0RSxTQUFTLGVBQWU7QUFDeEIsSUFBTSxzQkFBc0I7QUFDckIsSUFBTSxTQUFOLE1BQWE7QUFBQSxFQUNoQixXQUFXLG9CQUFJLElBQUk7QUFBQSxFQUNuQixrQkFBa0I7QUFBQSxFQUNsQixZQUFZ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LEdBQUc7QUFBQSxFQUN2QjtBQUNBLFNBQU87QUFDVDtBQUVPLFNBQVMsY0FDZCxNQUFtQix5QkFBeUIsR0FDNUMsWUFBMkIsMkJBQTJCLEdBQ3RELGNBQThDLHlCQUs5QyxXQUFvQixzQkFDcEI7QUFDQSxTQUFPLE9BQU8sT0FBd0IsUUFBcUI7QUFDekQsUUFBSTtBQUdGLFVBQUksT0FBTyxLQUFLLHFDQUFxQyxFQUFFLFdBQVcsTUFBTSxVQUFVLENBQUM7QUFFbkYsWUFBTSxVQUFVLG9CQUFvQixNQUFNLFVBQVU7QUFDcEQsVUFBSSxZQUFZLEtBQU0sUUFBTyxpQkFBaUIsQ0FBQyxDQUFDO0FBRWhELFlBQU0sU0FBUyxnQkFBZ0IsT0FBTztBQUN0QyxVQUFJLE9BQU8sU0FBUyxPQUFRLFFBQU8saUJBQWlCLENBQUMsQ0FBQztBQUV0RCxZQUFNLE1BQU0sTUFBTSxPQUFPO0FBQ3pCLFlBQU0sTUFBTSxPQUFPLFNBQVMsV0FBVyxnQkFBZ0IsT0FBTyxJQUFJO0FBQ2xFLFlBQU0sWUFBWSxNQUFNLGlCQUFpQixPQUFPLE1BQU0sS0FBSyxLQUFLLEtBQUssT0FBTyxLQUFLO0FBRWpGLFlBQU0sU0FBUyxNQUFNLGFBQWEsV0FBVyxLQUFLLFdBQVcsWUFBWSxHQUFHLENBQUM7QUFDN0UsVUFBSSxPQUFPLGFBQWEsUUFBUTtBQUk5QixZQUFJLE9BQU8sU0FBUyxtQkFBbUIsT0FBTyxTQUFTLGVBQWU7QUFDcEUsY0FBSSxPQUFPLEtBQUssc0RBQXNELEVBQUUsUUFBUSxPQUFPLE9BQU8sQ0FBQztBQUMvRixpQkFBTyxpQkFBaUIsRUFBRSxtQkFBbUIsT0FBTyxRQUFRLGVBQWUsT0FBTyxPQUFPLENBQUM7QUFBQSxRQUM1RjtBQUNBLGVBQU8saUJBQWlCLENBQUMsQ0FBQztBQUFBLE1BQzVCO0FBRUEsVUFBSSxVQUFVO0FBRVosZUFBTyxpQkFBaUI7QUFBQSxVQUN0QixvQkFBb0I7QUFBQSxVQUNwQiwwQkFBMEIsT0FBTztBQUFBLFVBQ2pDLGVBQWUsT0FBTztBQUFBLFFBQ3hCLENBQUM7QUFBQSxNQUNIO0FBR0EsWUFBTSxVQUFVO0FBQUEsRUFBMEUsT0FBTyxNQUFNO0FBQ3ZHLGFBQU8saUJBQWlCLEVBQUUsbUJBQW1CLFNBQVMsZUFBZSxRQUFRLENBQUM7QUFBQSxJQUNoRixTQUFTLEtBQUs7QUFDWixVQUFJLE9BQU8sS0FBSyxrREFBa0QsRUFBRSxJQUFJLENBQUM7QUFDekUsYUFBTyxpQkFBaUIsQ0FBQyxDQUFDO0FBQUEsSUFDNUI7QUFBQSxFQUNGO0FBQ0Y7QUFFQSxJQUFPLGVBQVEsZUFBZSxFQUFFLFNBQVMsK0JBQStCLFNBQVMsSUFBTyxHQUFHLGNBQWMsQ0FBQzs7O0FDdEkxRyxRQUFRLFlBQUk7IiwKICAibmFtZXMiOiBbInJlc29sdmUiLCAiZXhlY0ZpbGVTeW5jIiwgImZzIiwgIm5vZGVQYXRoIiwgImZzIiwgIm5vZGVQYXRoIiwgImZzIiwgIm5vZGVQYXRoIiwgImNhbmRpZGF0ZXMiLCAiZXhlY0ZpbGVTeW5jIl0KfQo=

#!/usr/bin/env -S node --enable-source-maps
import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __pathDirname } from "node:path";
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);

// ../../node_modules/@goodfoot/claude-code-hooks/dist/env.js
import * as fs from "node:fs";
var CLAUDE_ENV_VARS = {
  /**
   * Absolute path to the project root directory where Claude Code was started.
   * Available in all hooks.
   */
  PROJECT_DIR: "CLAUDE_PROJECT_DIR",
  /**
   * Path to a file where SessionStart hooks can persist environment variables.
   * Variables written to this file will be available in all subsequent bash commands.
   * Only available in SessionStart hooks.
   */
  ENV_FILE: "CLAUDE_ENV_FILE",
  /**
   * Set to "true" when running in a remote (web) environment.
   * Not set or empty when running in local CLI environment.
   */
  REMOTE: "CLAUDE_CODE_REMOTE"
};
function getEnvFilePath() {
  return process.env[CLAUDE_ENV_VARS.ENV_FILE];
}
function persistEnvVar(name, value) {
  const envFile = getEnvFilePath();
  if (envFile === void 0) {
    throw new Error("persistEnvVar can only be used in SessionStart hooks. CLAUDE_ENV_FILE environment variable is not set.");
  }
  const escapedValue = escapeShellValue(value);
  const exportStatement = `export ${name}=${escapedValue}
`;
  fs.appendFileSync(envFile, exportStatement, "utf-8");
}
function persistEnvVars(vars) {
  for (const [name, value] of Object.entries(vars)) {
    persistEnvVar(name, value);
  }
}
function escapeShellValue(value) {
  const escaped = value.replace(/'/g, "'\\''");
  return `'${escaped}'`;
}

// ../../node_modules/@goodfoot/claude-code-hooks/dist/hooks.js
function createHookFunction(hookEventName, config, handler) {
  const hookFn = async (input, context) => {
    return await handler(input, context);
  };
  hookFn.hookEventName = hookEventName;
  hookFn.matcher = config.matcher;
  hookFn.timeout = config.timeout;
  return hookFn;
}
function postToolUseHook(config, handler) {
  return createHookFunction("PostToolUse", config, handler);
}

// ../../node_modules/@goodfoot/claude-code-hooks/dist/logger.js
import { closeSync, existsSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";
var LOG_LEVELS = ["debug", "info", "warn", "error"];
var Logger = class {
  /**
   * Registered event handlers by log level.
   */
  handlers = /* @__PURE__ */ new Map();
  /**
   * File descriptor for log file output.
   * Lazily initialized on first write.
   */
  logFileFd = null;
  /**
   * Path to the log file, if configured.
   */
  logFilePath = null;
  /**
   * Whether file initialization has been attempted.
   */
  fileInitialized = false;
  /**
   * Current hook context for enriching log events.
   */
  currentHookType;
  /**
   * Current hook input for enriching log events.
   */
  currentInput;
  /**
   * Creates a new Logger instance.
   *
   * Typically you should use the exported `logger` singleton rather than
   * creating new instances.
   * @param config - Optional configuration
   * @example
   * ```typescript
   * // Use singleton (recommended)
   * import { logger } from '@goodfoot/claude-code-hooks';
   *
   * // Or create custom instance
   * const customLogger = new Logger({ logFilePath: '/var/log/hooks.log' });
   * ```
   */
  constructor(config = {}) {
    for (const level of LOG_LEVELS) {
      this.handlers.set(level, /* @__PURE__ */ new Set());
    }
    this.logFilePath = config.logFilePath ?? (config.logEnvVar ? process.env[config.logEnvVar] : void 0) ?? null;
  }
  /**
   * Logs a debug message.
   *
   * Use for detailed debugging information that is typically only useful
   * during development or troubleshooting.
   * @param message - The debug message
   * @param context - Optional additional context
   * @example
   * ```typescript
   * logger.debug('Processing tool input', { toolName: 'Bash', inputSize: 256 });
   * ```
   */
  debug(message, context) {
    this.emit("debug", message, context);
  }
  /**
   * Logs an info message.
   *
   * Use for general operational events like hook invocations, successful
   * completions, or state changes.
   * @param message - The info message
   * @param context - Optional additional context
   * @example
   * ```typescript
   * logger.info('Session started', { source: 'startup', sessionId: 'abc123' });
   * ```
   */
  info(message, context) {
    this.emit("info", message, context);
  }
  /**
   * Logs a warning message.
   *
   * Use for conditions that may indicate issues but don't prevent
   * operation, such as deprecated patterns or performance concerns.
   * @param message - The warning message
   * @param context - Optional additional context
   * @example
   * ```typescript
   * logger.warn('Deprecated hook pattern detected', { pattern: 'legacyMatcher' });
   * ```
   */
  warn(message, context) {
    this.emit("warn", message, context);
  }
  /**
   * Logs an error message.
   *
   * Use for error conditions that require attention but were handled
   * gracefully. For exceptions, prefer {@link logError}.
   * @param message - The error message
   * @param context - Optional additional context
   * @example
   * ```typescript
   * logger.error('Failed to validate tool input', { toolName: 'Bash', reason: 'empty command' });
   * ```
   */
  error(message, context) {
    this.emit("error", message, context);
  }
  /**
   * Logs a structured error with full error details.
   *
   * Use this method when logging caught exceptions to capture the full
   * error context including name, message, stack trace, and cause chain.
   * @param error - The error to log
   * @param message - Human-readable description of what failed
   * @param context - Optional additional context
   * @example
   * ```typescript
   * try {
   *   await dangerousOperation();
   * } catch (err) {
   *   logger.logError(err, 'Failed to execute dangerous operation', {
   *     operation: 'delete',
   *     target: '/important/file.txt'
   *   });
   * }
   * ```
   */
  logError(error, message, context) {
    const errorInfo = this.extractErrorInfo(error);
    const event = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      level: "error",
      hookType: this.currentHookType,
      message,
      input: this.currentInput,
      error: errorInfo,
      context
    };
    this.deliverEvent(event);
  }
  /**
   * Subscribes a handler to log events at the specified level.
   *
   * The handler will be called for every log event at the specified level.
   * Returns an unsubscribe function that should be called when the handler
   * is no longer needed.
   * @param level - The log level to subscribe to
   * @param handler - The handler function to call for each event
   * @returns A function to unsubscribe the handler
   * @example
   * ```typescript
   * // Subscribe to error events
   * const unsubscribe = logger.on('error', (event) => {
   *   console.error(`[${event.hookType}] ${event.message}`);
   *   if (event.error) {
   *     console.error(event.error.stack);
   *   }
   * });
   *
   * // Later, clean up
   * unsubscribe();
   * ```
   * @example
   * ```typescript
   * // Forward to external logging library
   * import pino from 'pino';
   * const pinoLogger = pino();
   *
   * logger.on('info', (event) => pinoLogger.info(event, event.message));
   * logger.on('warn', (event) => pinoLogger.warn(event, event.message));
   * logger.on('error', (event) => pinoLogger.error(event, event.message));
   * ```
   */
  on(level, handler) {
    const levelHandlers = this.handlers.get(level);
    if (levelHandlers) {
      levelHandlers.add(handler);
    }
    return () => {
      levelHandlers?.delete(handler);
    };
  }
  /**
   * Sets the current hook context for enriching log events.
   *
   * This is called internally by the runtime before invoking hook handlers.
   * You typically don't need to call this directly.
   * @param hookType - The type of hook being executed
   * @param input - The hook input data
   * @internal
   */
  setContext(hookType, input) {
    this.currentHookType = hookType;
    this.currentInput = input;
  }
  /**
   * Clears the current hook context.
   *
   * Called internally by the runtime after hook execution completes.
   * @internal
   */
  clearContext() {
    this.currentHookType = void 0;
    this.currentInput = void 0;
  }
  /**
   * Configures the log file path at runtime.
   *
   * Call this to enable or change file logging. Setting to `null` disables
   * file logging (but doesn't close existing file handle immediately).
   * @param filePath - Path to the log file, or null to disable
   * @example
   * ```typescript
   * // Enable file logging at runtime
   * logger.setLogFile('/var/log/claude-hooks.log');
   *
   * // Disable file logging
   * logger.setLogFile(null);
   * ```
   */
  setLogFile(filePath) {
    if (this.logFileFd !== null) {
      try {
        closeSync(this.logFileFd);
      } catch (closeError) {
        process.stderr.write(`[claude-code-hooks] Failed to close log file: ${String(closeError)}
`);
      }
      this.logFileFd = null;
    }
    this.logFilePath = filePath;
    this.fileInitialized = false;
  }
  /**
   * Closes all resources held by the logger.
   *
   * Call this during graceful shutdown to ensure all log data is flushed.
   * @example
   * ```typescript
   * process.on('exit', () => {
   *   logger.close();
   * });
   * ```
   */
  close() {
    if (this.logFileFd !== null) {
      try {
        closeSync(this.logFileFd);
      } catch (closeError) {
        process.stderr.write(`[claude-code-hooks] Failed to close log file: ${String(closeError)}
`);
      }
      this.logFileFd = null;
    }
    this.fileInitialized = false;
  }
  /**
   * Checks if there are any active handlers or destinations.
   *
   * Returns true if any handlers are registered or file logging is enabled.
   * @returns Whether the logger has any active output destinations
   */
  hasDestinations() {
    for (const handlers of this.handlers.values()) {
      if (handlers.size > 0)
        return true;
    }
    return this.logFilePath !== null;
  }
  // ============================================================================
  // Private Methods
  // ============================================================================
  /**
   * Emits a log event.
   * @param level - The severity level of the event
   * @param message - The log message
   * @param context - Optional additional context data
   */
  emit(level, message, context) {
    const event = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      hookType: this.currentHookType,
      message,
      input: this.currentInput,
      context
    };
    this.deliverEvent(event);
  }
  /**
   * Delivers an event to all registered destinations.
   * @param event - The log event to deliver
   */
  deliverEvent(event) {
    const levelHandlers = this.handlers.get(event.level);
    if (levelHandlers) {
      for (const handler of levelHandlers) {
        try {
          handler(event);
        } catch (handlerError) {
          process.stderr.write(`[claude-code-hooks] Log handler error: ${String(handlerError)}
`);
        }
      }
    }
    this.writeToFile(event);
  }
  /**
   * Writes an event to the log file.
   * @param event - The log event to write
   */
  writeToFile(event) {
    if (!this.logFilePath)
      return;
    if (!this.fileInitialized) {
      this.initializeFile();
    }
    if (this.logFileFd === null)
      return;
    try {
      const line = `${JSON.stringify(event)}
`;
      writeSync(this.logFileFd, line);
    } catch (writeError) {
      this.logFileFd = null;
      this.fileInitialized = false;
      process.stderr.write(`[claude-code-hooks] Log file write failed: ${String(writeError)}
`);
    }
  }
  /**
   * Initializes the log file for writing.
   */
  initializeFile() {
    this.fileInitialized = true;
    if (!this.logFilePath)
      return;
    try {
      const dir = dirname(this.logFilePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      this.logFileFd = openSync(this.logFilePath, "a");
    } catch {
      this.logFileFd = null;
    }
  }
  /**
   * Extracts structured error information from an unknown error.
   * @param error - The error to extract information from
   * @returns Structured error information
   */
  extractErrorInfo(error) {
    if (error instanceof Error) {
      const info = {
        name: error.name,
        message: error.message,
        stack: error.stack
      };
      if (error.cause !== void 0) {
        info.cause = this.extractErrorInfo(error.cause);
      }
      return info;
    }
    return {
      name: "UnknownError",
      message: String(error)
    };
  }
};
var logger = new Logger({
  logEnvVar: process.env.CLAUDE_CODE_HOOKS_LOG_ENV_VAR ?? "CLAUDE_CODE_HOOKS_LOG_FILE"
});

// ../../node_modules/@goodfoot/claude-code-hooks/dist/outputs.js
var EXIT_CODES = {
  /** Handler completed successfully. Claude Code parses stdout as JSON. */
  SUCCESS: 0,
  /** Non-blocking error occurred (e.g., invalid input). stderr shown to user only. */
  ERROR: 1,
  /** Handler threw exception OR blocking action requested. stderr shown to Claude. */
  BLOCK: 2
};
function createHookSpecificOutputBuilder(hookType) {
  return (options = {}) => {
    const { hookSpecificOutput, ...rest } = options;
    const stdout = hookSpecificOutput !== void 0 ? { ...rest, hookSpecificOutput: { hookEventName: hookType, ...hookSpecificOutput } } : rest;
    return { _type: hookType, stdout };
  };
}
var postToolUseOutput = /* @__PURE__ */ createHookSpecificOutputBuilder("PostToolUse");

// ../../node_modules/@goodfoot/claude-code-hooks/dist/runtime.js
async function readStdin() {
  return new Promise((resolve2, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      chunks.push(chunk);
    });
    process.stdin.on("end", () => {
      resolve2(chunks.join(""));
    });
    process.stdin.on("error", (error) => {
      reject(error);
    });
  });
}
function parseStdinInput(stdinContent) {
  const rawInput = JSON.parse(stdinContent);
  return rawInput;
}
function writeStdout(output) {
  process.stdout.write(JSON.stringify(output));
}
function createMalformedInputOutput(error) {
  logger.error(`Invalid JSON input: ${error instanceof Error ? error.message : String(error)}`);
  return { stdout: {} };
}
function handleHandlerError(error) {
  if (error instanceof Error) {
    process.stderr.write(`${error.stack ?? error.message}
`);
  } else {
    process.stderr.write(`${String(error)}
`);
  }
  logger.error(`Hook handler error: ${error instanceof Error ? error.message : String(error)}`);
  logger.clearContext();
  logger.close();
  process.exit(EXIT_CODES.BLOCK);
}
function convertToHookOutput(specificOutput) {
  const { stdout, stderr, rawStdout } = specificOutput;
  const result = { stdout };
  if (stderr !== void 0) {
    result.stderr = stderr;
  }
  if (rawStdout !== void 0) {
    result.rawStdout = rawStdout;
  }
  return result;
}
async function execute(hookFn) {
  let output;
  try {
    let stdinContent;
    try {
      stdinContent = await readStdin();
    } catch (error) {
      logger.logError(error, "Failed to read stdin");
      output = createMalformedInputOutput(error);
      return;
    }
    let input;
    try {
      input = parseStdinInput(stdinContent);
    } catch (error) {
      logger.logError(error, "Failed to parse stdin JSON");
      output = createMalformedInputOutput(error);
      return;
    }
    const hookEventName = hookFn.hookEventName;
    logger.setContext(hookEventName, input);
    const context = hookEventName === "SessionStart" ? { logger, persistEnvVar, persistEnvVars } : { logger };
    try {
      const specificOutput = await hookFn(input, context);
      if (specificOutput !== null) {
        output = convertToHookOutput(specificOutput);
      }
    } catch (error) {
      handleHandlerError(error);
    }
  } finally {
    if (output !== void 0) {
      if (output.rawStdout !== void 0) {
        process.stdout.write(output.rawStdout);
      } else {
        writeStdout(output.stdout);
      }
    }
    logger.clearContext();
    logger.close();
    if (output?.stderr !== void 0) {
      process.stderr.write(output.stderr);
      process.exit(EXIT_CODES.BLOCK);
    }
    process.exit(EXIT_CODES.SUCCESS);
  }
}

// src/common/agent-hooks-common.ts
import { execFileSync } from "node:child_process";
import * as fs2 from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
function toPosix(p) {
  return p.replace(/\\/g, "/");
}
function isAbsolutePosix(p) {
  return p.startsWith("/") || /^[A-Za-z]:\//.test(p);
}
function abspathAgainst(base, target) {
  const t = toPosix(target);
  if (isAbsolutePosix(t)) return t;
  const b = toPosix(base).replace(/\/+$/, "");
  return `${b}/${t}`;
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
function resolveSpanRoot(repoRoot) {
  const envDir = process.env["GIT_SPAN_DIR"];
  if (envDir && envDir.trim().length > 0) {
    return toPosix(envDir.trim()).replace(/\/+$/, "");
  }
  try {
    const out = execFileSync("git", ["-C", repoRoot, "config", "git-span.dir"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8"
    });
    const trimmed = toPosix(out.trim()).replace(/\/+$/, "");
    if (trimmed.length > 0) return trimmed;
  } catch (err) {
  }
  return SPAN_ROOT;
}
function isInsideSpanRoot(repoRelPath, spanRoot = SPAN_ROOT) {
  const root = spanRoot.replace(/\/+$/, "");
  return repoRelPath === root || repoRelPath.startsWith(`${root}/`);
}
function isGitIgnored(repoRoot, repoRelPath) {
  try {
    execFileSync("git", ["-C", repoRoot, "check-ignore", "-q", "--", repoRelPath], {
      stdio: ["ignore", "ignore", "ignore"]
    });
    return true;
  } catch (err) {
    return false;
  }
}
function relativeToRepo(repoRoot, absPath) {
  const root = toPosix(repoRoot);
  const abs = toPosix(absPath);
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return abs.startsWith(prefix) ? abs.slice(prefix.length) : abs;
}
function canonicalizePath(absPath) {
  try {
    return toPosix(fs2.realpathSync.native(absPath));
  } catch {
    try {
      const dir = toPosix(fs2.realpathSync.native(nodePath.dirname(absPath)));
      return `${dir}/${nodePath.basename(absPath)}`;
    } catch {
      return absPath;
    }
  }
}
function derivePath(toolInput, cwd) {
  const fp = toolInput.file_path;
  if (typeof fp !== "string" || fp.length === 0) return null;
  const abs = abspathAgainst(cwd, fp);
  return canonicalizePath(abs);
}
function rangesIntersect(a, b) {
  return a.start <= b.end && a.end >= b.start;
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
function parseDriftPorcelain(stdout) {
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
function sanitizeSessionId(sessionId) {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, (ch) => {
    return `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
  });
}
var SESSION_BASE_DIR = nodePath.join(os.homedir(), ".cache", "git-span", "session");
function sessionDir(sessionId) {
  return nodePath.join(SESSION_BASE_DIR, sanitizeSessionId(sessionId));
}
var THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1e3;
function pruneStaleSessions(now = Date.now(), maxAgeMs = THIRTY_DAYS_MS) {
  let entries;
  try {
    entries = fs2.readdirSync(SESSION_BASE_DIR, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = nodePath.join(SESSION_BASE_DIR, entry.name);
    try {
      const stat = fs2.statSync(dirPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs2.rmSync(dirPath, { recursive: true, force: true });
      }
    } catch {
    }
  }
}

// src/common/span-surface.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import * as fs4 from "node:fs";
import * as nodePath3 from "node:path";

// src/common/span-ignore.ts
import * as fs3 from "node:fs";
import * as nodePath2 from "node:path";
var HOOK_IGNORE_REL = nodePath2.join(".span", ".hookignore");

// src/common/span-surface.ts
function memoFilePath(sessionId) {
  return nodePath3.join(sessionDir(sessionId), "touch-memo.json");
}
function createDiskMemoStore(logger2) {
  return {
    getSurfaced(sessionId) {
      pruneStaleSessions();
      try {
        const raw = fs4.readFileSync(memoFilePath(sessionId), "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.surfaced)) {
          return new Set(parsed.surfaced);
        }
      } catch (err) {
        logger2.warn("memo read failed (treating as empty)", { err });
      }
      return /* @__PURE__ */ new Set();
    },
    addSurfaced(sessionId, names) {
      pruneStaleSessions();
      const existing = this.getSurfaced(sessionId);
      for (const n of names) existing.add(n);
      const memoDir = sessionDir(sessionId);
      const memoPath = memoFilePath(sessionId);
      const tmpPath = `${memoPath}.tmp`;
      try {
        fs4.mkdirSync(memoDir, { recursive: true });
        fs4.writeFileSync(tmpPath, JSON.stringify({ surfaced: [...existing] }), "utf8");
        fs4.renameSync(tmpPath, memoPath);
      } catch (err) {
        logger2.warn("memo write failed", { err });
      }
    }
  };
}
function resolveTouchScope(cwd, absPath) {
  const cwdRepoRoot = cwd ? resolveRepoRoot(cwd) : null;
  if (!cwdRepoRoot) return null;
  const absDir = toPosix(nodePath3.dirname(absPath));
  const fileRepoRoot = resolveRepoRoot(absDir);
  if (fileRepoRoot !== cwdRepoRoot) return null;
  const repoRoot = cwdRepoRoot;
  const repoRelPath = relativeToRepo(repoRoot, absPath);
  if (isGitIgnored(repoRoot, repoRelPath)) return null;
  const spanRoot = resolveSpanRoot(repoRoot);
  if (isInsideSpanRoot(repoRelPath, spanRoot)) return null;
  return { repoRoot, repoRelPath };
}

// src/common/touch-core.ts
import { execFileSync as execFileSync3 } from "node:child_process";
import * as fs5 from "node:fs";
import { basename as basename2, join as join4 } from "node:path";

// src/common/anchor-tree.ts
function collapseByPath(rows) {
  const order = [];
  const byPath = /* @__PURE__ */ new Map();
  for (const row of rows) {
    let anchor = byPath.get(row.path);
    if (!anchor) {
      anchor = { path: row.path, ranges: [] };
      byPath.set(row.path, anchor);
      order.push(row.path);
    }
    anchor.ranges.push({ range: row.range, suffix: row.suffix });
  }
  return order.map((path) => byPath.get(path));
}
function splitSegments(path) {
  if (path.length === 0) return null;
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0)) return null;
  return segments;
}
function findOrCreateDir(parent, name) {
  for (const child of parent.children) {
    if (child.kind === "dir" && child.name === name) return child;
  }
  const node = { kind: "dir", name, children: [] };
  parent.children.push(node);
  return node;
}
function insertAnchor(root, segments, anchor) {
  let cur = root;
  for (let i = 0; i < segments.length - 1; i++) {
    cur = findOrCreateDir(cur, segments[i]);
  }
  cur.children.push({ kind: "leaf", name: segments[segments.length - 1], anchor });
}
function buildForest(anchors) {
  const root = { kind: "dir", name: "", children: [] };
  for (const anchor of anchors) {
    const segments = splitSegments(anchor.path);
    if (segments === null) {
      root.children.push({ kind: "leaf", name: anchor.path, anchor });
      continue;
    }
    insertAnchor(root, segments, anchor);
  }
  return root.children;
}
function foldChain(node) {
  let name = node.name;
  let cur = node;
  while (cur.kind === "dir" && cur.children.length === 1) {
    const child = cur.children[0];
    name = `${name}/${child.name}`;
    cur = child;
  }
  return { name, node: cur };
}
function rangeRank(range) {
  switch (range.kind) {
    case "whole-file":
      return 0;
    case "range":
      return 1;
    case "truncated":
      return 2;
  }
}
function compareRangeEntries(a, b) {
  const rank = rangeRank(a.range) - rangeRank(b.range);
  if (rank !== 0) return rank;
  if (a.range.kind === "range" && b.range.kind === "range") {
    return a.range.start - b.range.start || a.range.end - b.range.end;
  }
  return 0;
}
function labelFor(range, sole) {
  switch (range.kind) {
    case "range":
      return `#L${range.start}-L${range.end}`;
    case "whole-file":
      return sole ? null : "(whole file)";
    case "truncated":
      return "(truncated in source \u2014 anchor incomplete)";
  }
}
var cachedSegmenter;
function graphemeSegmenter() {
  if (cachedSegmenter === void 0) {
    try {
      cachedSegmenter = { value: new Intl.Segmenter("en", { granularity: "grapheme" }) };
    } catch {
      cachedSegmenter = { value: null };
    }
  }
  return cachedSegmenter.value;
}
var WIDE_RANGES = [
  [4352, 4447],
  [9001, 9002],
  [9728, 10175],
  [11904, 12350],
  [12353, 13311],
  [13312, 19903],
  [19968, 40959],
  [40960, 42191],
  [43360, 43391],
  [44032, 55203],
  [63744, 64255],
  [65040, 65049],
  [65072, 65135],
  [65280, 65376],
  [65504, 65510],
  [94208, 101119],
  [127462, 127487],
  [127744, 128591],
  [128640, 128767],
  [129280, 129535],
  [129648, 129791],
  [131072, 196605],
  [196608, 262141]
];
function isWideCodePoint(cp) {
  for (const [lo, hi] of WIDE_RANGES) {
    if (cp < lo) return false;
    if (cp <= hi) return true;
  }
  return false;
}
function displayWidth(name) {
  const segmenter = graphemeSegmenter();
  let width = 0;
  if (segmenter === null) {
    for (const codePoint of name) {
      width += isWideCodePoint(codePoint.codePointAt(0) ?? 0) ? 2 : 1;
    }
    return width;
  }
  for (const { segment } of segmenter.segment(name)) {
    width += isWideCodePoint(segment.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return width;
}
var MAX_ALIGN_COLUMN = 48;
function computeGroupTarget(items) {
  let max = 0;
  for (const item of items) {
    if (item.node.kind === "leaf" && printsRangeColumn(item.node.anchor)) {
      max = Math.max(max, displayWidth(item.name));
    }
  }
  return max > MAX_ALIGN_COLUMN ? 0 : max;
}
function printsRangeColumn(anchor) {
  const { ranges } = anchor;
  if (ranges.length === 0) return false;
  return ranges.some((entry) => labelFor(entry.range, ranges.length === 1) !== null);
}
function computePad(nameWidth, target) {
  if (nameWidth >= target) return " ";
  return " ".repeat(target - nameWidth + 1);
}
function renderLeafLines(name, anchor, ownPrefix, childPrefix, groupTarget) {
  const { ranges } = anchor;
  if (ranges.length === 0) return [`${ownPrefix}${name}`];
  const sorted = [...ranges].sort(compareRangeEntries);
  const sole = sorted.length === 1;
  const nameWidth = displayWidth(name);
  const pad = computePad(nameWidth, groupTarget);
  const blank = " ".repeat(nameWidth + pad.length);
  return sorted.map((entry, i) => {
    const label = labelFor(entry.range, sole);
    if (label === null) return `${ownPrefix}${name}${entry.suffix}`;
    const base = i === 0 ? `${ownPrefix}${name}${pad}` : `${childPrefix}${blank}`;
    return `${base}${label}${entry.suffix}`;
  });
}
function renderNodes(nodes, prefix) {
  const lines = [];
  const items = nodes.map(foldChain);
  const groupTarget = computeGroupTarget(items);
  items.forEach((item, i) => {
    const isLast = i === items.length - 1;
    const ownPrefix = `${prefix}${isLast ? "\u2514\u2500 " : "\u251C\u2500 "}`;
    const childPrefix = `${prefix}${isLast ? "   " : "\u2502  "}`;
    if (item.node.kind === "leaf") {
      lines.push(...renderLeafLines(item.name, item.node.anchor, ownPrefix, childPrefix, groupTarget));
    } else {
      lines.push(`${ownPrefix}${item.name}/`);
      lines.push(...renderNodes(item.node.children, childPrefix));
    }
  });
  return lines;
}
function renderAnchorTree(anchors) {
  const forest = buildForest(anchors);
  return renderNodes(forest, "");
}

// src/common/touch-core.ts
function toNeedleLines(written) {
  if (written.length === 0) return [];
  const trimmed = written.endsWith("\n") ? written.slice(0, -1) : written;
  if (trimmed.length === 0) return [];
  return trimmed.split("\n");
}
function recoverRange(written, onDiskContent) {
  const needle = toNeedleLines(written);
  if (needle.length === 0) return "whole-file";
  const haystack = onDiskContent.split("\n");
  const last = haystack.length - needle.length;
  const starts = [];
  for (let i = 0; i <= last; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      starts.push(i);
      if (starts.length > 1) break;
    }
  }
  if (starts.length === 1) {
    return { start: starts[0] + 1, end: starts[0] + needle.length };
  }
  return "whole-file";
}
function createRealityProbeCache(paths) {
  return { paths: [...new Set(paths)], realPaths: null };
}
function fileExists(absPath) {
  try {
    fs5.statSync(absPath);
    return true;
  } catch {
    return false;
  }
}
function isFileOnDisk(absPath) {
  try {
    return fs5.statSync(absPath).isFile();
  } catch {
    return false;
  }
}
function contentMatches(post, filePath) {
  try {
    if ("exact" in post) return fs5.readFileSync(filePath, "utf8") === post.exact;
    if ("suffix" in post) {
      const content = fs5.readFileSync(filePath, "utf8");
      return content.endsWith(post.suffix) || content.endsWith(`${post.suffix}
`);
    }
    if ("empty" in post) return fs5.statSync(filePath).size === 0;
    return fs5.statSync(filePath).size === post.size;
  } catch {
    return false;
  }
}
function realPaths(cache, cwd) {
  if (cache.realPaths !== null) return cache.realPaths;
  const real = /* @__PURE__ */ new Set();
  if (cache.paths.length > 0) {
    const repoRoot = resolveRepoRoot(cwd);
    if (repoRoot !== null) {
      const rels = cache.paths.map((p) => relativeToRepo(repoRoot, p));
      const capture = (args) => {
        try {
          return execFileSync3("git", args, {
            cwd: repoRoot,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: DEFAULT_TIMEOUT_MS
          });
        } catch (err) {
          const stdout = err.stdout;
          return typeof stdout === "string" ? stdout : null;
        }
      };
      const lsFiles = capture(["ls-files", "--error-unmatch", "--", ...rels]);
      if (lsFiles !== null) {
        for (const line of lsFiles.split("\n")) {
          const rel = line.trim();
          if (rel.length > 0) real.add(join4(repoRoot, rel));
        }
      }
      const spanList = capture(["span", "list", "--porcelain", ...rels]);
      if (spanList !== null) {
        for (const row of parsePorcelain(spanList)) real.add(join4(repoRoot, row.path));
      }
    }
  }
  cache.realPaths = real;
  return real;
}
function evaluateWriteGate(input, probeCache) {
  if (input.targetState === "absent") {
    if (fileExists(input.filePath)) return "decisiveFail";
    return realPaths(probeCache, input.cwd).has(input.filePath) ? "decisivePass" : "inconclusive";
  }
  if (!isFileOnDisk(input.filePath)) return "decisiveFail";
  const content = input.postState?.content;
  if (content !== void 0) {
    return contentMatches(content, input.filePath) ? "decisivePass" : "decisiveFail";
  }
  if (input.sourcePath !== void 0) {
    if (fileExists(input.sourcePath)) {
      let src;
      let dst;
      try {
        src = fs5.readFileSync(input.sourcePath, "utf8");
        dst = fs5.readFileSync(input.filePath, "utf8");
      } catch {
        return "decisiveFail";
      }
      return src === dst ? "decisivePass" : "decisiveFail";
    }
    return realPaths(probeCache, input.cwd).has(input.sourcePath) ? "pending" : "decisiveFail";
  }
  if (input.renameSourcePath !== void 0) {
    return realPaths(probeCache, input.cwd).has(input.renameSourcePath) ? "decisivePass" : "decisiveFail";
  }
  return "inconclusive";
}
function driftKey(name, status) {
  return `${name}	${status}`;
}
function anchorText(row) {
  if (row.start === 0 && row.end === 0) return row.path;
  return `${row.path}#L${row.start}-L${row.end}`;
}
function cleanHeader(fileName) {
  return `${fileName} has implicit dependencies:`;
}
function cleanFooter(fileName) {
  return `If you change ${fileName} check the other files to confirm they still work together.`;
}
function driftHeader(driftedCount, kind) {
  if (kind === "write") {
    return driftedCount === 1 ? "This edit put an implicit dependency out of date:" : "This edit put implicit dependencies out of date:";
  }
  return driftedCount === 1 ? "This file has an implicit dependency out of date:" : "This file has implicit dependencies out of date:";
}
function driftFooter(driftedNames) {
  if (driftedNames.length === 1) {
    const name = driftedNames[0];
    return `Restore agreement before committing. Follow confirmed authority. Preserve anchor shape; if an address changed, remove its old anchor before adding the new one. Update or retire the why only if its meaning changed. Require \`git span drift ${name}\` to report zero, then check the other anchors. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete coupling.`;
  }
  return "For each out-of-date span: restore agreement before committing. Follow confirmed authority. Preserve anchor shape; if an address changed, remove its old anchor before adding the new one. Update or retire the why only if its meaning changed. Require `git span drift <name>` to report zero, then check the other anchors. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete coupling.";
}
function rangeLabel(row) {
  if (row.start === 0 && row.end === 0) return { kind: "whole-file" };
  return { kind: "range", start: row.start, end: row.end };
}
function anchorBullets(anchors, debtRows) {
  const rows = anchors.map((anchor) => {
    const soleOnPath = anchors.filter((a) => a.path === anchor.path).length === 1;
    const statuses = /* @__PURE__ */ new Set();
    for (const row of debtRows) {
      if (row.path !== anchor.path) continue;
      if (soleOnPath || row.start === anchor.start && row.end === anchor.end) {
        statuses.add(row.status);
      }
    }
    const sorted = [...statuses].sort();
    const suffix = sorted.length > 0 ? ` \u2014 ${sorted.map(humanStatusLabel).join(", ")}` : "";
    return { path: anchor.path, range: rangeLabel(anchor), suffix };
  });
  try {
    return renderAnchorTree(collapseByPath(rows));
  } catch {
    return anchors.map((anchor, i) => `- ${anchorText(anchor)}${rows[i].suffix}`);
  }
}
function renderSpanSection(name, anchors, debtRows, why) {
  const lines = [`## ${name}`, ...anchorBullets(anchors, debtRows)];
  if (why) lines.push("", why);
  return lines.join("\n");
}
function buildBlock(sections, header, footer) {
  const body = `${header}

${sections.join("\n\n---\n\n")}

---

${footer}`;
  return `
<git-span>
${body}
</git-span>
`;
}
function intersects(row, range) {
  if (range === "whole-file") return true;
  if (row.start === 0 && row.end === 0) return true;
  return rangesIntersect(range, { start: row.start, end: row.end });
}
function recoverRangeFromDisk(written, filePath) {
  if (written.length === 0) return "whole-file";
  let content;
  try {
    content = fs5.readFileSync(filePath, "utf8");
  } catch {
    return "whole-file";
  }
  return recoverRange(written, content);
}
var DEFAULT_READ_LIMIT = 2e3;
function recoverReadRange(offset, limit, filePath) {
  if (offset === void 0 && limit === void 0) return "whole-file";
  const start = offset ?? 1;
  let lineCount;
  try {
    const content = fs5.readFileSync(filePath, "utf8");
    lineCount = content.length === 0 ? 0 : content.split("\n").length;
  } catch {
    return "whole-file";
  }
  const end = Math.min(start + (limit ?? DEFAULT_READ_LIMIT) - 1, Math.max(lineCount, start));
  return { start, end };
}
function onTouchedFile(row, filePath) {
  return filePath === row.path || filePath.endsWith(`/${row.path}`);
}
async function computeSurface(input, executors, memo, range) {
  const covering = await executors.list(input.filePath, input.cwd);
  if (covering.length === 0) return null;
  const anchorsByName = /* @__PURE__ */ new Map();
  for (const row of covering) {
    const rows = anchorsByName.get(row.name) ?? [];
    rows.push(row);
    anchorsByName.set(row.name, rows);
  }
  const touchedNames = [...anchorsByName.keys()].filter(
    (name) => (anchorsByName.get(name) ?? []).some((row) => onTouchedFile(row, input.filePath) && intersects(row, range))
  );
  if (touchedNames.length === 0) return null;
  const driftRows = await executors.drift([input.filePath], input.cwd);
  const driftByName = /* @__PURE__ */ new Map();
  for (const row of driftRows) {
    const rows = driftByName.get(row.name) ?? [];
    rows.push(row);
    driftByName.set(row.name, rows);
  }
  const surfaced = memo.getSurfaced(input.sessionId);
  const toRecord = [];
  const sections = [];
  const driftedNames = [];
  for (const name of touchedNames) {
    const spanDrift = driftByName.get(name) ?? [];
    const debtRows = spanDrift.filter((row) => isDebt(row.status));
    if (spanDrift.length > 0 && debtRows.length === 0) continue;
    const debtStatuses = [...new Set(debtRows.map((row) => row.status))].sort();
    const unsurfacedDebt = debtStatuses.filter((status) => !surfaced.has(driftKey(name, status)));
    const isNewName = !surfaced.has(name);
    if (!isNewName && unsurfacedDebt.length === 0) continue;
    const why = await executors.why(name, input.cwd);
    sections.push(renderSpanSection(name, anchorsByName.get(name) ?? [], debtRows, why));
    if (debtStatuses.length > 0) driftedNames.push(name);
    if (isNewName) toRecord.push(name);
    for (const status of unsurfacedDebt) toRecord.push(driftKey(name, status));
  }
  if (sections.length === 0) return null;
  memo.addSurfaced(input.sessionId, toRecord);
  const fileName = basename2(input.filePath);
  const header = driftedNames.length > 0 ? driftHeader(driftedNames.length, input.kind) : cleanHeader(fileName);
  const footer = driftedNames.length > 0 ? driftFooter(driftedNames) : cleanFooter(fileName);
  return buildBlock(sections, header, footer);
}
async function runTouchHook(input, executors, memo, probeCache) {
  let treeModified = false;
  try {
    let range = "whole-file";
    if (input.kind === "write") {
      const probe = probeCache ?? createRealityProbeCache(input.targetState === "absent" ? [input.filePath] : []);
      const outcome = evaluateWriteGate(input, probe);
      if (outcome === "decisiveFail" || outcome === "inconclusive" && input.targetState === "absent") {
        return { additionalContext: null, treeModified: false };
      }
      const fix = await executors.fix(input.filePath, input.cwd);
      treeModified = fix.modified;
      range = input.range ?? recoverRangeFromDisk(input.written, input.filePath);
    } else {
      range = recoverReadRange(input.offset, input.limit, input.filePath);
    }
    const additionalContext = await computeSurface(input, executors, memo, range);
    return { additionalContext, treeModified };
  } catch {
    return { additionalContext: null, treeModified };
  }
}
var DEFAULT_TIMEOUT_MS = 1e4;
function repoRelArg(filePath, cwd) {
  const repoRoot = resolveRepoRoot(cwd);
  if (!repoRoot) return null;
  return { repoRoot, relPath: relativeToRepo(repoRoot, filePath) };
}
function spanStatusSnapshot(repoRoot) {
  const spanRoot = resolveSpanRoot(repoRoot);
  try {
    return execFileSync3("git", ["-C", repoRoot, "status", "--porcelain", "--", spanRoot], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: DEFAULT_TIMEOUT_MS
    });
  } catch {
    return "";
  }
}
function createDefaultTouchExecutors(timeoutMs = DEFAULT_TIMEOUT_MS) {
  return {
    fix: async (filePath, cwd) => {
      const resolved = repoRelArg(filePath, cwd);
      if (!resolved) return { modified: false };
      const before = spanStatusSnapshot(resolved.repoRoot);
      try {
        execFileSync3("git", ["span", "drift", resolved.relPath, "--fix"], {
          cwd: resolved.repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs
        });
      } catch (err) {
      }
      const after = spanStatusSnapshot(resolved.repoRoot);
      return { modified: before !== after };
    },
    list: async (filePath, cwd) => {
      const resolved = repoRelArg(filePath, cwd);
      if (!resolved) return [];
      try {
        const out = execFileSync3("git", ["span", "list", "--porcelain", resolved.relPath], {
          cwd: resolved.repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs
        });
        return parsePorcelain(out);
      } catch {
        return [];
      }
    },
    drift: async (args, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      const runCwd = repoRoot ?? cwd;
      const scoped = repoRoot ? args.map((a) => relativeToRepo(repoRoot, a)) : args;
      let out;
      try {
        out = execFileSync3("git", ["span", "drift", "--format", "porcelain", ...scoped], {
          cwd: runCwd,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs
        });
      } catch (err) {
        const captured = err.stdout;
        if (typeof captured === "string") {
          out = captured;
        } else {
          return [];
        }
      }
      return parseDriftPorcelain(out);
    },
    why: async (name, cwd) => {
      const repoRoot = resolveRepoRoot(cwd);
      try {
        const out = execFileSync3("git", ["span", "why", name], {
          cwd: repoRoot ?? cwd,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs
        });
        const text = out.trimEnd();
        if (text.length === 0 || text === `\`${name}\` has no why recorded.`) return null;
        return text;
      } catch {
        return null;
      }
    }
  };
}

// src/common/bash-touch.ts
function bashSpanToTouch(span, sessionId, cwd) {
  if (!resolveTouchScope(cwd, span.absolutePath)) return null;
  switch (span.operation) {
    case "read":
      return {
        kind: "read",
        sessionId,
        cwd,
        filePath: span.absolutePath,
        offset: span.lineStart,
        limit: span.lineStart !== void 0 && span.lineEnd !== void 0 ? span.lineEnd - span.lineStart + 1 : void 0
      };
    case "create-overwrite":
    case "rename-copy":
      return {
        kind: "write",
        sessionId,
        cwd,
        filePath: span.absolutePath,
        written: "",
        targetState: "exists",
        postState: span.written !== void 0 ? { content: { exact: span.written } } : void 0
      };
    case "truncate":
      return {
        kind: "write",
        sessionId,
        cwd,
        filePath: span.absolutePath,
        written: "",
        targetState: "exists",
        postState: span.size === 0 ? { content: { empty: true } } : span.size !== void 0 ? { content: { size: span.size } } : void 0
      };
    case "append":
      return {
        kind: "write",
        sessionId,
        cwd,
        filePath: span.absolutePath,
        written: span.written ?? "",
        targetState: "exists",
        postState: span.written !== void 0 ? { content: { suffix: span.written } } : void 0
      };
    case "modify":
      return {
        kind: "write",
        sessionId,
        cwd,
        filePath: span.absolutePath,
        written: "",
        targetState: "exists",
        range: span.lineStart !== void 0 ? { start: span.lineStart, end: span.lineEnd ?? span.lineStart } : void 0
      };
    case "delete":
      return {
        kind: "write",
        sessionId,
        cwd,
        filePath: span.absolutePath,
        written: "",
        targetState: "absent",
        postState: { realDelete: true }
      };
  }
}
function bashResponseInterrupted(toolResponse) {
  if (toolResponse !== null && typeof toolResponse === "object") {
    return Boolean(toolResponse.interrupted);
  }
  return false;
}
function evalSpanGate(match, touch, probeCache) {
  if (touch === null) return "inconclusive";
  if (touch.kind === "read") {
    if ((match.idiom === "cp-write" || match.idiom === "install-write") && match.span.operation === "read") {
      return fileExists(match.span.absolutePath) ? "inconclusive" : "decisiveFail";
    }
    return "inconclusive";
  }
  return evaluateWriteGate(touch, probeCache);
}
function joinOfCommand(matches) {
  for (const m of matches) {
    if (m.span.join !== void 0) return m.span.join;
  }
  return void 0;
}
async function runBashTouches(matches, sessionId, cwd, toolResponse, executors, memo, warn = console.warn) {
  if (bashResponseInterrupted(toolResponse)) return [];
  const resolved = matches.filter((m) => m.status === "resolved");
  if (resolved.length === 0) return [];
  const probePaths = [];
  for (const m of resolved) {
    if (m.span.operation === "delete") probePaths.push(m.span.absolutePath);
    else if ((m.idiom === "cp-write" || m.idiom === "install-write") && m.span.operation === "read") {
      probePaths.push(m.span.absolutePath);
    }
  }
  const probeCache = createRealityProbeCache(probePaths);
  const groups = /* @__PURE__ */ new Map();
  const commandOrder = [];
  for (const m of resolved) {
    const idx = m.span.simpleCommandIndex;
    const list = groups.get(idx);
    if (list !== void 0) {
      list.push(m);
    } else {
      groups.set(idx, [m]);
      commandOrder.push(idx);
    }
  }
  commandOrder.sort((a, b) => a - b);
  const evals = /* @__PURE__ */ new Map();
  for (const idx of commandOrder) {
    const spans = groups.get(idx);
    const readPaths = spans.filter((m) => (m.idiom === "cp-write" || m.idiom === "install-write") && m.span.operation === "read").map((m) => m.span.absolutePath);
    const deletePaths = spans.filter((m) => m.span.operation === "delete").map((m) => m.span.absolutePath);
    let readCursor = 0;
    let deleteCursor = 0;
    const list = [];
    for (const m of spans) {
      const touch = bashSpanToTouch(m.span, sessionId, cwd);
      const entry = {
        match: m,
        touch,
        outcome: "inconclusive",
        explained: false,
        commandIndex: idx,
        path: m.span.absolutePath,
        sourceKey: null
      };
      if (touch !== null && touch.kind === "write") {
        if (m.span.operation === "create-overwrite" && (m.idiom === "cp-write" || m.idiom === "install-write")) {
          const source = readPaths[readCursor];
          if (source !== void 0) {
            readCursor += 1;
            if (m.idiom === "cp-write") {
              touch.sourcePath = source;
              entry.sourceKey = source;
            }
          }
        } else if (m.span.operation === "rename-copy") {
          const source = deletePaths[deleteCursor];
          if (source !== void 0) {
            deleteCursor += 1;
            touch.renameSourcePath = source;
          }
        }
      }
      entry.outcome = evalSpanGate(m, touch, probeCache);
      list.push(entry);
    }
    evals.set(idx, list);
  }
  const passByPath = /* @__PURE__ */ new Map();
  for (const idx of commandOrder) {
    for (const e of evals.get(idx)) {
      if (e.outcome === "decisivePass") {
        const prev = passByPath.get(e.path);
        if (prev === void 0 || idx > prev) passByPath.set(e.path, idx);
      }
    }
  }
  for (const idx of commandOrder) {
    for (const e of evals.get(idx)) {
      if (e.outcome === "pending") {
        const passIdx = e.sourceKey !== null ? passByPath.get(e.sourceKey) : void 0;
        e.outcome = passIdx !== void 0 && passIdx > e.commandIndex ? "decisivePass" : "decisiveFail";
      } else if (e.outcome === "decisiveFail") {
        const passIdx = passByPath.get(e.path);
        if (passIdx !== void 0 && passIdx > e.commandIndex) e.explained = true;
      }
    }
  }
  const computed = /* @__PURE__ */ new Map();
  for (const idx of commandOrder) {
    let failed = false;
    let passed = false;
    for (const e of evals.get(idx)) {
      if (e.outcome === "decisiveFail" && !e.explained) failed = true;
      if (e.outcome === "decisivePass") passed = true;
    }
    computed.set(idx, failed ? "failed" : passed ? "succeeded" : "unknown");
  }
  const effective = /* @__PURE__ */ new Map();
  const skipped = /* @__PURE__ */ new Set();
  let prevIndex = null;
  for (const idx of commandOrder) {
    const join5 = joinOfCommand(groups.get(idx));
    const prevVerdict = prevIndex !== null ? effective.get(prevIndex) : void 0;
    if (prevVerdict !== void 0 && join5 !== void 0) {
      if (join5 === "&&" && prevVerdict === "failed" || join5 === "||" && prevVerdict === "succeeded") {
        effective.set(idx, join5 === "&&" ? "failed" : "succeeded");
        skipped.add(idx);
        prevIndex = idx;
        continue;
      }
    }
    effective.set(idx, computed.get(idx));
    prevIndex = idx;
  }
  const blocks = [];
  for (const idx of commandOrder) {
    if (skipped.has(idx)) continue;
    let touches = 0;
    for (const e of evals.get(idx)) {
      if (e.touch === null || e.explained) continue;
      if (e.outcome === "decisiveFail") continue;
      if (e.outcome === "inconclusive" && e.touch.kind === "write" && e.touch.targetState === "absent") continue;
      if (touches >= 32) {
        warn(`Bash touch cap (32) reached for simple command ${idx}; dropping the remaining touches`);
        break;
      }
      touches += 1;
      const output = await runTouchHook(e.touch, executors, memo, probeCache);
      if (output.additionalContext) blocks.push(output.additionalContext);
    }
  }
  return blocks;
}

// src/common/parse-command.ts
import { readFileSync as readFileSync5, statSync as statSync4 } from "node:fs";
import { basename as basename3, join as joinPath, resolve as resolvePath } from "node:path";

// src/common/command-resolve.ts
import { execFileSync as execFileSync4 } from "node:child_process";
import { readFileSync as readFileSync4, statSync as statSync3 } from "node:fs";
function countFileLines(absolutePath) {
  try {
    if (!statSync3(absolutePath).isFile()) return null;
    const content = readFileSync4(absolutePath, "utf8");
    if (content.length === 0) return 0;
    const withoutTrailingNewline = content.endsWith("\n") ? content.slice(0, -1) : content;
    return withoutTrailingNewline.split("\n").length;
  } catch {
    return null;
  }
}
function countGitBlobLines(cwd, rev, path) {
  try {
    const out = execFileSync4("git", ["show", `${rev}:${path}`], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    if (out.length === 0) return 0;
    const withoutTrailingNewline = out.endsWith("\n") ? out.slice(0, -1) : out;
    return withoutTrailingNewline.split("\n").length;
  } catch {
    return null;
  }
}

// src/common/shell-split.ts
function splitTopLevel(cmd) {
  const parts = [];
  let buf = "";
  let i = 0;
  const n = cmd.length;
  let depth = 0;
  let inSquote = false;
  let inDquote = false;
  let pendingOp = "start";
  const flush = (nextOp) => {
    const s = buf.trim();
    if (s) parts.push({ text: s, precededBy: pendingOp });
    buf = "";
    pendingOp = nextOp;
  };
  const isPendingPipe = () => pendingOp === "|";
  while (i < n) {
    const c = cmd[i];
    if (inSquote) {
      buf += c;
      if (c === "'") inSquote = false;
      i += 1;
      continue;
    }
    if (inDquote) {
      buf += c;
      if (c === "\\" && i + 1 < n) {
        buf += cmd[i + 1];
        i += 2;
        continue;
      }
      if (c === '"') inDquote = false;
      i += 1;
      continue;
    }
    if (c === "'") {
      inSquote = true;
      buf += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inDquote = true;
      buf += c;
      i += 1;
      continue;
    }
    if (c === "\\" && i + 1 < n) {
      buf += c + cmd[i + 1];
      i += 2;
      continue;
    }
    if (c === "(") {
      depth += 1;
      buf += c;
      i += 1;
      continue;
    }
    if (c === ")") {
      depth = Math.max(0, depth - 1);
      buf += c;
      i += 1;
      continue;
    }
    if (depth === 0) {
      if (cmd.slice(i, i + 2) === "&&") {
        flush("&&");
        i += 2;
        continue;
      }
      if (cmd.slice(i, i + 2) === "||") {
        flush("||");
        i += 2;
        continue;
      }
      if (cmd.slice(i, i + 2) === "|&") {
        flush("|");
        i += 2;
        continue;
      }
      if (c === ";") {
        flush("other");
        i += 1;
        continue;
      }
      if (c === "|") {
        flush("|");
        i += 1;
        continue;
      }
      if (c === "\n") {
        if (isPendingPipe()) {
          i += 1;
          continue;
        }
        flush("other");
        i += 1;
        continue;
      }
      if (c === "&") {
        const trimmed = buf.trimEnd();
        let dupRedirect = false;
        if (trimmed.endsWith(">")) {
          const before = trimmed.length >= 2 ? trimmed[trimmed.length - 2] : "";
          dupRedirect = trimmed.length === 1 || /\s|\d/.test(before);
        }
        if (cmd[i + 1] === ">" || dupRedirect) {
          buf += c;
          i += 1;
          continue;
        }
        flush("other");
        i += 1;
        continue;
      }
    }
    buf += c;
    i += 1;
  }
  flush("other");
  return parts;
}
var LEADING_ASSIGNMENT = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/;
function stripLeadingAssignments(simpleCmd) {
  return simpleCmd.replace(LEADING_ASSIGNMENT, "");
}
function tokenize(s) {
  const tokens = [];
  let buf = "";
  let quoted = false;
  let i = 0;
  const n = s.length;
  const flushWord = () => {
    if (buf.length === 0) return;
    tokens.push({ text: buf, quoted, isRedirect: false });
    buf = "";
    quoted = false;
  };
  const appendQuotedContent = (out, start) => {
    const quote = s[start];
    let j = start + 1;
    while (j < n) {
      const c = s[j];
      if (quote === "'") {
        if (c === "'") return { out, next: j + 1 };
        out += c;
        j += 1;
        continue;
      }
      if (c === "\\" && j + 1 < n && '"\\$`'.includes(s[j + 1])) {
        out += s[j + 1];
        j += 2;
        continue;
      }
      if (c === '"') return { out, next: j + 1 };
      out += c;
      j += 1;
    }
    return null;
  };
  const appendAttachedTarget = (out, start) => {
    let j = start;
    while (j < n) {
      const c = s[j];
      if (/\s/.test(c) || c === "<" || c === ">") return { out, next: j };
      if (c === "'" || c === '"') {
        const section = appendQuotedContent("", j);
        if (section === null) return null;
        out += s.slice(j, section.next);
        j = section.next;
        continue;
      }
      if (c === "\\" && j + 1 < n) {
        out += c + s[j + 1];
        j += 2;
        continue;
      }
      out += c;
      j += 1;
    }
    return { out, next: j };
  };
  const emitRedirect = (operator, attachedStart) => {
    const attached = appendAttachedTarget("", attachedStart);
    if (attached === null) return false;
    tokens.push({ text: buf + operator + attached.out, quoted: false, isRedirect: true });
    buf = "";
    quoted = false;
    i = attached.next;
    return true;
  };
  while (i < n) {
    const c = s[i];
    if (/\s/.test(c)) {
      flushWord();
      i += 1;
      continue;
    }
    if (c === "'" || c === '"') {
      quoted = true;
      const section = appendQuotedContent(buf, i);
      if (section === null) return null;
      buf = section.out;
      i = section.next;
      continue;
    }
    if (c === "\\" && i + 1 < n) {
      quoted = true;
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (c === "<" || c === ">") {
      if (buf !== "" && !/^\d+$/.test(buf)) flushWord();
      let operator;
      if (c === "<") {
        if (s.slice(i, i + 3) === "<<<") operator = "<<<";
        else if (s.slice(i, i + 3) === "<<-") operator = "<<-";
        else if (s.slice(i, i + 2) === "<<") operator = "<<";
        else operator = "<";
      } else {
        operator = s.slice(i, i + 2) === ">>" ? ">>" : ">";
      }
      if (!emitRedirect(operator, i + operator.length)) return null;
      continue;
    }
    if (c === "&") {
      if (s[i + 1] === ">") {
        flushWord();
        const operator = s.slice(i, i + 3) === "&>>" ? "&>>" : "&>";
        if (!emitRedirect(operator, i + operator.length)) return null;
        continue;
      }
      buf += c;
      i += 1;
      continue;
    }
    buf += c;
    i += 1;
  }
  flushWord();
  return tokens;
}

// src/common/unified-diff.ts
var HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
function stripPathComponents(p, n) {
  let s = p;
  for (let i = 0; i < n; i++) {
    const slash = s.indexOf("/");
    if (slash === -1) return s;
    s = s.slice(slash + 1);
  }
  return s;
}
function stripLevelFor(raw, strip) {
  return strip === "auto" ? raw.startsWith("a/") || raw.startsWith("b/") ? 1 : 0 : strip;
}
function parseUnifiedDiffRange(patchText, strip) {
  const results = [];
  let sawBlock = false;
  let current = null;
  let pendingKind = null;
  let renameFrom = null;
  let renameTo = null;
  let binary = false;
  const stripped = (raw) => {
    if (raw === "/dev/null") return raw;
    return stripPathComponents(raw, stripLevelFor(raw, strip));
  };
  const finish = () => {
    if (current !== null) {
      if (current.kind === "new") results.push({ path: current.path, operation: "create-overwrite" });
      else if (current.kind === "deleted") results.push({ path: current.path, operation: "delete" });
      else if (binary) results.push({ path: current.path, operation: "modify" });
      else if (current.hunks.length === 0) {
      } else if (current.countChanging) results.push({ path: current.path, operation: "modify" });
      else {
        const start = Math.min(...current.hunks.map((h) => h.start));
        const end = Math.max(...current.hunks.map((h) => h.end));
        results.push({ path: current.path, operation: "modify", lineStart: start, lineEnd: end });
      }
      current = null;
    }
    if (renameFrom !== null) results.push({ path: renameFrom, operation: "delete" });
    if (renameTo !== null) results.push({ path: renameTo, operation: "rename-copy" });
    renameFrom = null;
    renameTo = null;
    binary = false;
  };
  for (const line of patchText.split("\n")) {
    if (line.startsWith("--- ")) {
      sawBlock = true;
      if (current !== null) finish();
      current = {
        path: stripped(line.slice(4)),
        kind: pendingKind ?? "modify",
        hunks: [],
        countChanging: false
      };
      pendingKind = null;
      continue;
    }
    if (line.startsWith("+++ ")) {
      sawBlock = true;
      const path = stripped(line.slice(4));
      if (current === null) current = { path, kind: pendingKind ?? "modify", hunks: [], countChanging: false };
      else if (path === "/dev/null") current.kind = "deleted";
      else current.path = path;
      pendingKind = null;
      continue;
    }
    if (line.startsWith("new file mode")) {
      pendingKind = "new";
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      pendingKind = "deleted";
      continue;
    }
    if (line.startsWith("rename from ")) {
      sawBlock = true;
      if (current !== null) finish();
      renameFrom = stripped(line.slice("rename from ".length));
      continue;
    }
    if (line.startsWith("rename to ")) {
      sawBlock = true;
      renameTo = stripped(line.slice("rename to ".length));
      continue;
    }
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      sawBlock = true;
      binary = true;
      continue;
    }
    const hunk = line.match(HUNK_HEADER);
    if (hunk) {
      sawBlock = true;
      const preStart = Number.parseInt(hunk[1], 10);
      const preCount = hunk[2] === void 0 ? 1 : Number.parseInt(hunk[2], 10);
      const postCount = hunk[4] === void 0 ? 1 : Number.parseInt(hunk[4], 10);
      if (current === null) return null;
      if (preCount !== postCount) current.countChanging = true;
      if (preCount > 0) current.hunks.push({ start: preStart, end: preStart + preCount - 1 });
    }
  }
  finish();
  return sawBlock ? results : null;
}

// src/common/parse-command.ts
function resolveSpec(spec, totalLines) {
  switch (spec.kind) {
    case "literal":
      return { lineStart: spec.start, lineEnd: spec.end };
    case "upperBoundFromStart": {
      const total = totalLines();
      return { lineStart: 1, lineEnd: total !== null ? Math.min(spec.end, total) : spec.end };
    }
    case "toEof": {
      const total = totalLines();
      if (total === null || total === 0) return null;
      return { lineStart: spec.start, lineEnd: Math.max(spec.start, total) };
    }
    case "lastNLines": {
      const total = totalLines();
      if (total === null || total === 0) return null;
      return { lineStart: Math.max(1, total - spec.count + 1), lineEnd: total };
    }
    case "appendLines": {
      const total = totalLines() ?? 0;
      return { lineStart: total + 1, lineEnd: total + spec.count };
    }
  }
}
function hasShellExpansion(s) {
  return /[$`]/.test(s);
}
function looksUnresolvable(s) {
  return hasShellExpansion(s) || /[*?]/.test(s);
}
var SED_RANGE = /^(\d+)(?:,(\d+|\$))?p$/;
function sedScriptSegments(script) {
  return script.split(";");
}
function matchSed(argv) {
  if (argv[0] !== "sed") return [];
  const rest = argv.slice(1);
  if (!rest.includes("-n")) return [];
  let scriptIdx = -1;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "-n") continue;
    if (sedScriptSegments(rest[i]).some((seg) => SED_RANGE.test(seg))) {
      scriptIdx = i;
      break;
    }
  }
  if (scriptIdx === -1) return [];
  const fileCandidates = rest.filter((a, i) => i !== scriptIdx && a !== "-n" && !a.startsWith("-"));
  if (fileCandidates.length !== 1) return [];
  const fileArg = fileCandidates[0];
  const results = [];
  for (const segment of sedScriptSegments(rest[scriptIdx])) {
    const match = segment.match(SED_RANGE);
    if (!match) continue;
    const start = Number.parseInt(match[1], 10);
    const endToken = match[2];
    const spec = endToken === void 0 ? { kind: "literal", start, end: start } : endToken === "$" ? { kind: "toEof", start } : { kind: "literal", start, end: Number.parseInt(endToken, 10) };
    results.push({ kind: "candidate", idiom: "sed-n-range", fileArg, spec, resolverKind: "fs" });
  }
  return results;
}
function parseHeadTailFlags(rest) {
  const files = [];
  let count = null;
  let fromStart = false;
  let disqualified = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "-f" || a === "-F" || a === "--follow" || a.startsWith("--follow=")) {
      disqualified = true;
      continue;
    }
    if (a === "-z" || a === "--zero-terminated") {
      disqualified = true;
      continue;
    }
    if (a === "-c" || a === "--bytes") {
      disqualified = true;
      i += 1;
      continue;
    }
    if (/^(-c|--bytes=)/.test(a)) {
      disqualified = true;
      continue;
    }
    if (a === "-q" || a === "-v" || a === "--quiet" || a === "--silent" || a === "--verbose") continue;
    if (a === "-n") {
      const v = rest[i + 1];
      if (v !== void 0 && /^\+?\d+$/.test(v)) {
        fromStart = v.startsWith("+");
        count = Number.parseInt(v.replace("+", ""), 10);
        i += 1;
      }
      continue;
    }
    if (a.startsWith("--lines=")) {
      const v = a.slice("--lines=".length);
      if (/^\+?\d+$/.test(v)) {
        fromStart = v.startsWith("+");
        count = Number.parseInt(v.replace("+", ""), 10);
      }
      continue;
    }
    if (/^-n\+?\d+$/.test(a)) {
      const v = a.slice(2);
      fromStart = v.startsWith("+");
      count = Number.parseInt(v.replace("+", ""), 10);
      continue;
    }
    if (/^\+\d+$/.test(a)) {
      fromStart = true;
      count = Number.parseInt(a.slice(1), 10);
      continue;
    }
    if (/^-\d+$/.test(a)) {
      count = Number.parseInt(a.slice(1), 10);
      continue;
    }
    if (a === "-") {
      files.push(a);
      continue;
    }
    if (a.startsWith("-")) continue;
    files.push(a);
  }
  return { count, fromStart, disqualified, files };
}
function matchHead(argv) {
  if (argv[0] !== "head") return [];
  const { count, disqualified, files } = parseHeadTailFlags(argv.slice(1));
  if (disqualified) return [];
  const realFiles = files.filter((f) => f !== "-");
  if (realFiles.length === 0) return [];
  const n = count ?? 10;
  return realFiles.map((fileArg) => ({
    kind: "candidate",
    idiom: "head-file",
    fileArg,
    spec: { kind: "upperBoundFromStart", end: n },
    resolverKind: "fs"
  }));
}
function matchTail(argv) {
  if (argv[0] !== "tail") return [];
  const { count, fromStart, disqualified, files } = parseHeadTailFlags(argv.slice(1));
  if (disqualified) return [];
  const realFiles = files.filter((f) => f !== "-");
  if (realFiles.length === 0) return [];
  const n = count ?? 10;
  const spec = fromStart ? { kind: "toEof", start: n } : { kind: "lastNLines", count: n };
  return realFiles.map((fileArg) => ({
    kind: "candidate",
    idiom: "tail-file",
    fileArg,
    spec,
    resolverKind: "fs"
  }));
}
function findGitSubcommand(rest) {
  let cDir = null;
  let cDirUnresolvable = false;
  let i = 0;
  while (i < rest.length) {
    const a = rest[i];
    if (a === "-C") {
      const v = rest[i + 1];
      if (v === void 0) return null;
      if (hasShellExpansion(v)) cDirUnresolvable = true;
      else cDir = v;
      i += 2;
      continue;
    }
    if (a === "-c") {
      i += 2;
      continue;
    }
    if (a.startsWith("-")) {
      i += 1;
      continue;
    }
    return { subIdx: i, subcommand: a, cDir, cDirUnresolvable };
  }
  return null;
}
var REV_PATH = /^([^\s:]+):(.+)$/;
function matchGitShow(argv) {
  if (argv[0] !== "git") return [];
  const sub = findGitSubcommand(argv.slice(1));
  if (!sub || sub.subcommand !== "show") return [];
  const after = argv.slice(1).slice(sub.subIdx + 1).filter((a) => !a.startsWith("-"));
  const revPathArg = after.find((a) => REV_PATH.test(a));
  if (!revPathArg) return [];
  const m = revPathArg.match(REV_PATH);
  if (!m) return [];
  const [, rev, path] = m;
  if (sub.cDirUnresolvable || hasShellExpansion(rev)) {
    return [
      {
        kind: "unresolved",
        idiom: "git-show-rev-path",
        fileArg: path,
        reason: "git -C target or revision contains an unresolved shell variable"
      }
    ];
  }
  return [
    {
      kind: "candidate",
      idiom: "git-show-rev-path",
      fileArg: path,
      spec: { kind: "toEof", start: 1 },
      resolverKind: { kind: "git", rev },
      dirOverride: sub.cDir ?? void 0
    }
  ];
}
function matchGitLogL(argv) {
  if (argv[0] !== "git") return [];
  const sub = findGitSubcommand(argv.slice(1));
  if (!sub || sub.subcommand !== "log") return [];
  const after = argv.slice(1).slice(sub.subIdx + 1);
  for (let i = 0; i < after.length; i++) {
    const a = after[i];
    let spec = null;
    if (a === "-L") spec = after[i + 1] ?? null;
    else if (a.startsWith("-L")) spec = a.slice(2);
    if (!spec) continue;
    const m = spec.match(/^(\d+),(\d+):(.+)$/);
    if (!m) continue;
    const [, s, e, path] = m;
    if (sub.cDirUnresolvable) {
      return [
        {
          kind: "unresolved",
          idiom: "git-log-L",
          fileArg: path,
          reason: "git -C target contains an unresolved shell variable"
        }
      ];
    }
    return [
      {
        kind: "candidate",
        idiom: "git-log-L",
        fileArg: path,
        spec: { kind: "literal", start: Number.parseInt(s, 10), end: Number.parseInt(e, 10) },
        resolverKind: "fs",
        dirOverride: sub.cDir ?? void 0
      }
    ];
  }
  return [];
}
var BARE_DELIM = /^[A-Za-z_][A-Za-z0-9_]*$/;
function findHeredocOpener(raw, from) {
  const n = raw.length;
  let inSquote = false;
  let inDquote = false;
  let depth = 0;
  let cmdStart = from;
  let pendingPipe = false;
  let i = from;
  const readDelimWord = (start) => {
    let d = "";
    let sawQuote = false;
    let k = start;
    while (k < n && !/\s/.test(raw[k]) && raw[k] !== "<" && raw[k] !== ">") {
      const c = raw[k];
      if (c === "'" || c === '"') {
        const quote = c;
        let m = k + 1;
        while (m < n && raw[m] !== quote) {
          d += raw[m];
          m += 1;
        }
        if (m >= n) return null;
        sawQuote = true;
        k = m + 1;
        continue;
      }
      if (c === "\\" && k + 1 < n) {
        d += raw[k + 1];
        k += 2;
        continue;
      }
      d += c;
      k += 1;
    }
    return { delim: d, sawQuote, next: k };
  };
  while (i < n) {
    const c = raw[i];
    if (inSquote) {
      if (c === "'") inSquote = false;
      i += 1;
      continue;
    }
    if (inDquote) {
      if (c === "\\" && i + 1 < n) {
        i += 2;
        continue;
      }
      if (c === '"') inDquote = false;
      i += 1;
      continue;
    }
    if (c === "'") {
      inSquote = true;
      i += 1;
      continue;
    }
    if (c === '"') {
      inDquote = true;
      i += 1;
      continue;
    }
    if (c === "\\" && i + 1 < n) {
      i += 2;
      continue;
    }
    if (c === "(") {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === ")") {
      depth = Math.max(0, depth - 1);
      i += 1;
      continue;
    }
    if (depth > 0) {
      i += 1;
      continue;
    }
    if (raw.startsWith("&&", i) || raw.startsWith("||", i)) {
      cmdStart = i + 2;
      pendingPipe = false;
      i += 2;
      continue;
    }
    if (raw.startsWith("|&", i)) {
      cmdStart = i + 1;
      pendingPipe = true;
      i += 2;
      continue;
    }
    if (c === ";") {
      cmdStart = i + 1;
      pendingPipe = false;
      i += 1;
      continue;
    }
    if (c === "|") {
      cmdStart = i + 1;
      pendingPipe = true;
      i += 1;
      continue;
    }
    if (c === "\n") {
      if (!pendingPipe) cmdStart = i + 1;
      i += 1;
      continue;
    }
    if (c === "&") {
      const trimmed = raw.slice(cmdStart, i).trimEnd();
      const dupRedirect = trimmed.endsWith(">") && (trimmed.length === 1 || /\s|\d/.test(trimmed[trimmed.length - 2] ?? ""));
      if (raw[i + 1] === ">" || dupRedirect) {
        i += 1;
        continue;
      }
      cmdStart = i + 1;
      pendingPipe = false;
      i += 1;
      continue;
    }
    if (c === "<" && raw[i + 1] === "<") {
      if (raw[i + 2] === "<") {
        i += 3;
        continue;
      }
      let j = i - 1;
      while (j >= from && /\d/.test(raw[j])) j -= 1;
      const ioNumber = j < i - 1 && (j < from || /\s|[;|&(]/.test(raw[j]));
      if (ioNumber) {
        i += 2;
        continue;
      }
      const tabStrip = raw[i + 2] === "-";
      const opLen = tabStrip ? 3 : 2;
      const lineEnd = raw.indexOf("\n", i);
      const openerLineEnd = lineEnd === -1 ? n : lineEnd;
      const attached = readDelimWord(i + opLen);
      let delim = attached === null ? "" : attached.delim;
      let sawQuote = attached === null ? false : attached.sawQuote;
      if (delim === "" && attached !== null) {
        let k = attached.next;
        while (k < openerLineEnd && /\s/.test(raw[k])) k += 1;
        const word = readDelimWord(k);
        if (word === null) delim = "";
        else {
          delim = word.delim;
          sawQuote = word.sawQuote;
        }
      }
      if (delim === "" || !sawQuote && !BARE_DELIM.test(delim)) {
        i += opLen;
        continue;
      }
      return { cmdStart, openerLineEnd, delim, tabStrip };
    }
    i += 1;
  }
  return null;
}
function heredocCloser(raw, open) {
  const n = raw.length;
  const bodyStart = open.openerLineEnd < n ? open.openerLineEnd + 1 : n;
  let linePos = bodyStart;
  while (linePos < n) {
    const nl = raw.indexOf("\n", linePos);
    const lineEnd = nl === -1 ? n : nl;
    const candidate = open.tabStrip ? raw.slice(linePos, lineEnd).replace(/^\t+/, "") : raw.slice(linePos, lineEnd);
    if (candidate === open.delim || candidate.startsWith(open.delim) && /^[ \t]*$/.test(candidate.slice(open.delim.length))) {
      return { lineStart: linePos, lineEnd };
    }
    if (nl === -1) return null;
    linePos = nl + 1;
  }
  return null;
}
function extractHeredocWrites(raw) {
  const writes = [];
  let masked = "";
  let cursor = 0;
  for (; ; ) {
    const open = findHeredocOpener(raw, cursor);
    if (open === null) break;
    const close = heredocCloser(raw, open);
    if (close === null) {
      cursor = open.openerLineEnd < raw.length ? open.openerLineEnd + 1 : raw.length;
      continue;
    }
    const bodyStart = open.openerLineEnd < raw.length ? open.openerLineEnd + 1 : raw.length;
    let body = raw.slice(bodyStart, close.lineStart).replace(/\n$/, "");
    if (open.tabStrip) body = body.replace(/^\t+/gm, "");
    masked += raw.slice(cursor, open.cmdStart);
    masked += `__heredoc_${writes.length}__`;
    writes.push({ opener: raw.slice(open.cmdStart, open.openerLineEnd), body });
    cursor = close.lineEnd;
  }
  masked += raw.slice(cursor);
  return { writes, masked };
}
var REDIRECT_TOKEN = /^(\d*)(<<<|<<-|&>>|<<|>>|&>|>&|<|>)(.*)$/;
function classifyRedirectToken(text) {
  const m = text.match(REDIRECT_TOKEN);
  if (m === null) return null;
  const [, fdText, op, target] = m;
  return {
    fd: fdText === "" ? null : Number.parseInt(fdText, 10),
    op,
    target: target === "" ? null : target
  };
}
function isContentRedirect(r) {
  if (r.op === ">" || r.op === ">>") {
    if (r.fd !== null && r.fd !== 1) return false;
    if (r.target?.startsWith("&")) return false;
    return true;
  }
  return r.op === "&>" || r.op === "&>>";
}
function analyzeTokens(tokens) {
  const argv = [];
  const redirects = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.isRedirect) {
      argv.push(token.text);
      continue;
    }
    const info = classifyRedirectToken(token.text);
    if (info === null) {
      argv.push(token.text);
      continue;
    }
    if (info.target === null) {
      const next = tokens[i + 1];
      if (next !== void 0 && !next.isRedirect) {
        redirects.push({ ...info, target: next.text });
        i += 1;
        continue;
      }
    }
    redirects.push(info);
  }
  return { argv, redirects };
}
function literalContent(argv) {
  const host = argv[0];
  if (host !== "echo" && host !== "printf") return void 0;
  const args = argv.slice(1);
  if (args.length === 0) return void 0;
  for (const a of args) {
    if (a.startsWith("-") || hasShellExpansion(a) || /[*?]/.test(a)) return void 0;
  }
  if (host === "printf") {
    if (args.length !== 1) return void 0;
    const fmt = args[0];
    if (fmt.includes("%") || fmt.includes("\\")) return void 0;
    return fmt;
  }
  return `${args.join(" ")}
`;
}
function resolveTarget(results, idiom, target, currentDir) {
  if (looksUnresolvable(target)) {
    results.push({
      status: "unresolved",
      idiom,
      fileArg: target,
      reason: "path contains an unexpanded shell variable or glob"
    });
    return null;
  }
  return resolvePath(currentDir, target);
}
function teeOperandParts(argv) {
  let append = false;
  let afterDashDash = false;
  const operands = [];
  for (const a of argv.slice(1)) {
    if (afterDashDash) {
      operands.push(a);
      continue;
    }
    if (a === "--") {
      afterDashDash = true;
      continue;
    }
    if (a === "-a" || a === "--append") {
      append = true;
      continue;
    }
    if (a.startsWith("-")) return null;
    operands.push(a);
  }
  return { append, operands };
}
function matchTeeOperands(argv, pipeEchoContent, currentDir, simpleCommandIndex, join5, results) {
  const parts = teeOperandParts(argv);
  if (parts === null) return;
  for (const operand of parts.operands) {
    const absolutePath = resolveTarget(results, "redirect-write", operand, currentDir);
    if (absolutePath === null) continue;
    results.push({
      status: "resolved",
      idiom: "redirect-write",
      span: !parts.append ? {
        operation: "create-overwrite",
        absolutePath,
        simpleCommandIndex,
        join: join5,
        ...pipeEchoContent !== null ? { written: pipeEchoContent } : {}
      } : {
        operation: "append",
        absolutePath,
        simpleCommandIndex,
        join: join5,
        ...pipeEchoContent !== null ? { written: pipeEchoContent } : {}
      }
    });
  }
}
function matchRedirectFamily(argv, redirects, pipeEchoContent, currentDir, simpleCommandIndex, join5, results) {
  const contentRedirects = redirects.filter(isContentRedirect);
  const host = argv[0];
  if (contentRedirects.length === 0) {
    if (host === "tee") matchTeeOperands(argv, pipeEchoContent, currentDir, simpleCommandIndex, join5, results);
    return;
  }
  if (host === void 0 || host === ":") {
    for (const r of contentRedirects) {
      if (r.op === ">>" || r.op === "&>>" || r.target === null) continue;
      const absolutePath = resolveTarget(results, "truncate-write", r.target, currentDir);
      if (absolutePath === null) continue;
      results.push({
        status: "resolved",
        idiom: "truncate-write",
        span: { operation: "truncate", absolutePath, simpleCommandIndex, join: join5 }
      });
    }
    return;
  }
  if (host !== "echo" && host !== "printf" && host !== "tee") return;
  const singlePlainAppend = contentRedirects.length === 1 && contentRedirects[0].op === ">>";
  const singlePlainOverwrite = contentRedirects.length === 1 && contentRedirects[0].op === ">";
  const threadedAppend = singlePlainAppend && host !== "tee" ? literalContent(argv) : void 0;
  const threadedOverwrite = singlePlainOverwrite && host !== "tee" ? literalContent(argv) : void 0;
  for (const r of contentRedirects) {
    if (r.target === null) continue;
    const absolutePath = resolveTarget(results, "redirect-write", r.target, currentDir);
    if (absolutePath === null) continue;
    if (r.op === ">>" || r.op === "&>>") {
      results.push({
        status: "resolved",
        idiom: "redirect-write",
        span: {
          operation: "append",
          absolutePath,
          simpleCommandIndex,
          join: join5,
          ...threadedAppend !== void 0 ? { written: threadedAppend } : {}
        }
      });
    } else {
      results.push({
        status: "resolved",
        idiom: "redirect-write",
        span: {
          operation: "create-overwrite",
          absolutePath,
          simpleCommandIndex,
          join: join5,
          ...threadedOverwrite !== void 0 ? { written: threadedOverwrite } : {}
        }
      });
    }
  }
  if (host === "tee") matchTeeOperands(argv, pipeEchoContent, currentDir, simpleCommandIndex, join5, results);
}
var FOREIGN_WRAPPERS = /* @__PURE__ */ new Set(["sudo", "xargs", "nohup", "time", "nice", "doas"]);
function stripTransparentWrapper(argv) {
  return argv[0] === "command" || argv[0] === "env" ? argv.slice(1) : argv;
}
function pushUnresolved(results, idiom, fileArg, reason) {
  results.push({ status: "unresolved", idiom, fileArg, reason });
}
function isExistingDirectory(absolutePath) {
  try {
    return statSync4(absolutePath).isDirectory();
  } catch {
    return false;
  }
}
var CP_SPEC = {
  idiom: "cp-write",
  noValue: /* @__PURE__ */ new Set(["-r", "-R", "-p", "-f", "-v", "-n", "-i", "-u", "-a", "-d", "-L", "-P"]),
  valueTaking: /* @__PURE__ */ new Set(["-t", "--target-directory"]),
  excluded: /* @__PURE__ */ new Set(["-b", "--backup"]),
  sourceOperation: "read",
  destOperation: "create-overwrite"
};
var INSTALL_SPEC = {
  idiom: "install-write",
  noValue: /* @__PURE__ */ new Set(["-D", "-s", "-v"]),
  valueTaking: /* @__PURE__ */ new Set(["-t", "--target-directory", "-m", "-o", "-g"]),
  excluded: /* @__PURE__ */ new Set(["-d"]),
  sourceOperation: "read",
  destOperation: "create-overwrite"
};
var MV_SPEC = {
  idiom: "mv-write",
  noValue: /* @__PURE__ */ new Set(["-f", "-i", "-n", "-v", "-u"]),
  valueTaking: /* @__PURE__ */ new Set(["-t", "--target-directory"]),
  excluded: /* @__PURE__ */ new Set(),
  sourceOperation: "delete",
  destOperation: "rename-copy"
};
var GIT_MV_SPEC = {
  idiom: "mv-write",
  noValue: /* @__PURE__ */ new Set(["-f", "-k", "-v"]),
  valueTaking: /* @__PURE__ */ new Set(),
  // `git mv -n`/`--dry-run` is a trial run that moves nothing (the same
  // read-only class as `patch --dry-run`, plan §5.7) — fail closed.
  excluded: /* @__PURE__ */ new Set(["-n", "--dry-run"]),
  sourceOperation: "delete",
  destOperation: "rename-copy"
};
function copyMoveParts(args, spec) {
  const operands = [];
  let targetDir = null;
  let i = 0;
  let afterDashDash = false;
  while (i < args.length) {
    const a = args[i];
    if (afterDashDash) {
      operands.push(a);
      i += 1;
      continue;
    }
    if (a === "--") {
      afterDashDash = true;
      i += 1;
      continue;
    }
    if (a === "-t" || a === "--target-directory") {
      const v = args[i + 1];
      if (v === void 0) return null;
      targetDir = v;
      i += 2;
      continue;
    }
    if (a.startsWith("--target-directory=")) {
      targetDir = a.slice("--target-directory=".length);
      i += 1;
      continue;
    }
    if (spec.excluded.has(a)) return null;
    if (spec.valueTaking.has(a)) {
      if (args[i + 1] === void 0) return null;
      i += 2;
      continue;
    }
    if (spec.noValue.has(a)) {
      i += 1;
      continue;
    }
    if (a.startsWith("-")) {
      i += 1;
      continue;
    }
    operands.push(a);
    i += 1;
  }
  return { operands, targetDir };
}
function emitSourceSpan(results, spec, absolutePath, simpleCommandIndex, join5) {
  if (spec.sourceOperation === "delete") {
    results.push({
      status: "resolved",
      idiom: spec.idiom,
      span: { operation: "delete", absolutePath, simpleCommandIndex, join: join5 }
    });
    return;
  }
  const range = resolveSpec({ kind: "toEof", start: 1 }, () => countFileLines(absolutePath));
  results.push({
    status: "resolved",
    idiom: spec.idiom,
    span: range === null ? { operation: "read", absolutePath, simpleCommandIndex, join: join5 } : {
      operation: "read",
      lineStart: range.lineStart,
      lineEnd: range.lineEnd,
      absolutePath,
      simpleCommandIndex,
      join: join5
    }
  });
}
function matchCopyMoveFamily(argv, dirForResolution, simpleCommandIndex, join5, results) {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  let spec = null;
  let args = [];
  let dir = dirForResolution;
  if (command === "cp" || command === "install" || command === "mv") {
    spec = command === "cp" ? CP_SPEC : command === "install" ? INSTALL_SPEC : MV_SPEC;
    args = rest.slice(1);
  } else if (command === "git") {
    const sub = findGitSubcommand(rest.slice(1));
    if (sub !== null && sub.subcommand === "mv") {
      if (sub.cDirUnresolvable) {
        pushUnresolved(results, "mv-write", "mv", "git -C target contains an unresolved shell variable");
        return;
      }
      spec = GIT_MV_SPEC;
      args = rest.slice(1).slice(sub.subIdx + 1);
      dir = sub.cDir ?? dirForResolution;
    }
  } else if (FOREIGN_WRAPPERS.has(command)) {
    const wrapped = rest[1];
    const wrappedSpec = wrapped === "cp" ? CP_SPEC : wrapped === "install" ? INSTALL_SPEC : wrapped === "mv" ? MV_SPEC : null;
    if (wrappedSpec !== null) {
      pushUnresolved(results, wrappedSpec.idiom, wrapped, `the ${command} wrapper obscures the ${wrapped} argv`);
    }
    return;
  }
  if (spec === null) return;
  const parts = copyMoveParts(args, spec);
  if (parts === null || parts.operands.length === 0) return;
  const sourcePaths = [];
  for (const source of parts.operands.slice(0, parts.targetDir === null ? -1 : void 0)) {
    if (source.endsWith("/")) return;
    const absolutePath = resolveTarget(results, spec.idiom, source, dir);
    if (absolutePath === null) return;
    if (isExistingDirectory(absolutePath)) return;
    sourcePaths.push(absolutePath);
  }
  if (sourcePaths.length === 0) return;
  let destPaths;
  if (parts.targetDir !== null) {
    if (looksUnresolvable(parts.targetDir)) {
      pushUnresolved(results, spec.idiom, parts.targetDir, "path contains an unexpanded shell variable or glob");
      return;
    }
    if (!parts.targetDir.endsWith("/") && !isExistingDirectory(resolvePath(dir, parts.targetDir))) {
      pushUnresolved(results, spec.idiom, parts.targetDir, "the -t target is not an existing directory");
      return;
    }
    const targetAbs = resolvePath(dir, parts.targetDir);
    destPaths = sourcePaths.map((p) => joinPath(targetAbs, basename3(p)));
  } else {
    const dest = parts.operands[parts.operands.length - 1];
    if (looksUnresolvable(dest)) {
      pushUnresolved(results, spec.idiom, dest, "path contains an unexpanded shell variable or glob");
      return;
    }
    const destAbs = resolvePath(dir, dest);
    const destIsDir = dest.endsWith("/") || isExistingDirectory(destAbs);
    if (sourcePaths.length > 1 && !destIsDir) {
      pushUnresolved(results, spec.idiom, dest, "a multi-source copy/move needs a directory destination");
      return;
    }
    destPaths = destIsDir ? sourcePaths.map((p) => joinPath(destAbs, basename3(p))) : [destAbs];
  }
  for (let k = 0; k < sourcePaths.length; k++) {
    emitSourceSpan(results, spec, sourcePaths[k], simpleCommandIndex, join5);
  }
  for (let k = 0; k < sourcePaths.length; k++) {
    results.push({
      status: "resolved",
      idiom: spec.idiom,
      span: { operation: spec.destOperation, absolutePath: destPaths[k], simpleCommandIndex, join: join5 }
    });
  }
}
var RM_NO_VALUE = /* @__PURE__ */ new Set(["-f", "-i", "-v"]);
var RM_EXCLUDED = /* @__PURE__ */ new Set(["-r", "-R", "--recursive", "-d"]);
var GIT_RM_EXCLUDED = /* @__PURE__ */ new Set(["-r", "-R", "--recursive", "-d", "-n", "--dry-run"]);
function matchRmOperands(args, excluded, excludeCached, dir, simpleCommandIndex, join5, results) {
  let afterDashDash = false;
  const operands = [];
  for (const a of args) {
    if (afterDashDash) {
      operands.push(a);
      continue;
    }
    if (a === "--") {
      afterDashDash = true;
      continue;
    }
    if (excluded.has(a) || excludeCached && a === "--cached") return;
    if (RM_NO_VALUE.has(a)) continue;
    if (a.startsWith("-")) continue;
    operands.push(a);
  }
  for (const operand of operands) {
    if (looksUnresolvable(operand)) {
      pushUnresolved(results, "rm-write", operand, "path contains an unexpanded shell variable or glob");
      continue;
    }
    if (operand.endsWith("/") || isExistingDirectory(resolvePath(dir, operand))) continue;
    results.push({
      status: "resolved",
      idiom: "rm-write",
      span: { operation: "delete", absolutePath: resolvePath(dir, operand), simpleCommandIndex, join: join5 }
    });
  }
}
function evaluateStaticSize(value) {
  if (value === void 0) return void 0;
  const m = value.match(/^(\d+)([KMG])?$/);
  if (m === null) return void 0;
  const base = Number.parseInt(m[1], 10);
  const mult = m[2] === "K" ? 1024 : m[2] === "M" ? 1024 ** 2 : m[2] === "G" ? 1024 ** 3 : 1;
  return base * mult;
}
function matchTruncateOperands(args, dir, simpleCommandIndex, join5, results) {
  let sawSizeFlag = false;
  let afterDashDash = false;
  let staticSize;
  const operands = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (afterDashDash) {
      operands.push({ path: a, size: staticSize });
      continue;
    }
    if (a === "--") {
      afterDashDash = true;
      continue;
    }
    if (a === "-s") {
      sawSizeFlag = true;
      staticSize = evaluateStaticSize(args[i + 1]);
      i += 1;
      continue;
    }
    if (a === "-r") {
      sawSizeFlag = true;
      staticSize = void 0;
      i += 1;
      continue;
    }
    if (a === "-c") continue;
    if (a.startsWith("-")) continue;
    operands.push({ path: a, size: staticSize });
  }
  if (!sawSizeFlag) return;
  for (const operand of operands) {
    if (looksUnresolvable(operand.path)) {
      pushUnresolved(results, "truncate-command", operand.path, "path contains an unexpanded shell variable or glob");
      continue;
    }
    if (operand.path.endsWith("/") || isExistingDirectory(resolvePath(dir, operand.path))) continue;
    results.push({
      status: "resolved",
      idiom: "truncate-command",
      span: {
        operation: "truncate",
        absolutePath: resolvePath(dir, operand.path),
        simpleCommandIndex,
        join: join5,
        ...operand.size !== void 0 ? { size: operand.size } : {}
      }
    });
  }
}
function matchRmTruncate(argv, dirForResolution, simpleCommandIndex, join5, results) {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  if (command === "rm") {
    matchRmOperands(rest.slice(1), RM_EXCLUDED, false, dirForResolution, simpleCommandIndex, join5, results);
    return;
  }
  if (command === "truncate") {
    matchTruncateOperands(rest.slice(1), dirForResolution, simpleCommandIndex, join5, results);
    return;
  }
  if (command === "git") {
    const sub = findGitSubcommand(rest.slice(1));
    if (sub !== null && sub.subcommand === "rm") {
      if (sub.cDirUnresolvable) {
        pushUnresolved(results, "rm-write", "rm", "git -C target contains an unresolved shell variable");
        return;
      }
      matchRmOperands(
        rest.slice(1).slice(sub.subIdx + 1),
        GIT_RM_EXCLUDED,
        true,
        sub.cDir ?? dirForResolution,
        simpleCommandIndex,
        join5,
        results
      );
    }
    return;
  }
  if (FOREIGN_WRAPPERS.has(command)) {
    const wrapped = rest[1];
    if (wrapped === "rm" || wrapped === "truncate") {
      pushUnresolved(
        results,
        wrapped === "rm" ? "rm-write" : "truncate-command",
        wrapped,
        `the ${command} wrapper obscures the ${wrapped} argv`
      );
    }
  }
}
function classifyHeredocOpener(opener, body, currentDir, simpleCommandIndex, join5, results) {
  const tokens = tokenize(stripLeadingAssignments(opener).trim());
  if (tokens === null) return;
  const { argv, redirects } = analyzeTokens(tokens);
  const host = argv[0];
  const contentRedirects = redirects.filter(isContentRedirect);
  const singlePlainAppend = contentRedirects.length === 1 && contentRedirects[0].op === ">>";
  const singlePlainOverwrite = contentRedirects.length === 1 && contentRedirects[0].op === ">";
  const emitContentRedirects = () => {
    for (const r of contentRedirects) {
      if (r.target === null) continue;
      const absolutePath = resolveTarget(results, "heredoc-write", r.target, currentDir);
      if (absolutePath === null) continue;
      if (r.op === ">>" || r.op === "&>>") {
        if (body.length === 0) continue;
        results.push({
          status: "resolved",
          idiom: "heredoc-write",
          span: {
            operation: "append",
            absolutePath,
            simpleCommandIndex,
            join: join5,
            ...singlePlainAppend && r.op === ">>" ? { written: body } : {}
          }
        });
      } else {
        results.push({
          status: "resolved",
          idiom: "heredoc-write",
          span: body.length === 0 ? { operation: "truncate", absolutePath, simpleCommandIndex, join: join5 } : {
            operation: "create-overwrite",
            absolutePath,
            simpleCommandIndex,
            join: join5,
            // The exact gate compares full file bytes, so the trailing
            // `\n` the extraction stripped comes back on the overwrite.
            ...singlePlainOverwrite ? { written: `${body}
` } : {}
          }
        });
      }
    }
  };
  if (host === "cat") {
    emitContentRedirects();
    return;
  }
  if (host === "tee") {
    const parts = teeOperandParts(argv);
    if (parts !== null) {
      for (const operand of parts.operands) {
        const absolutePath = resolveTarget(results, "heredoc-write", operand, currentDir);
        if (absolutePath === null) continue;
        if (parts.append) {
          if (body.length === 0) continue;
          results.push({
            status: "resolved",
            idiom: "heredoc-write",
            span: {
              operation: "append",
              absolutePath,
              simpleCommandIndex,
              join: join5,
              ...contentRedirects.length === 0 ? { written: body } : {}
            }
          });
        } else {
          results.push({
            status: "resolved",
            idiom: "heredoc-write",
            span: body.length === 0 ? { operation: "truncate", absolutePath, simpleCommandIndex, join: join5 } : {
              operation: "create-overwrite",
              absolutePath,
              simpleCommandIndex,
              join: join5,
              // Same restored-`\n` exact body as the redirect branch; a
              // tee operand with a content redirect present keeps the
              // redirect's threading only (mirror of the append branch).
              ...contentRedirects.length === 0 ? { written: `${body}
` } : {}
            }
          });
        }
      }
    }
    emitContentRedirects();
    return;
  }
  if (host === "patch" || host === "git") {
    classifyPatchHeredoc(argv, body, currentDir, simpleCommandIndex, join5, results);
    return;
  }
}
var NUMERIC_SUBSTITUTION = /^(\d+)(?:,(\d+))?[sy]/;
var UNRESTRICTED_SUBSTITUTION = /^[sy]/;
function matchSedInplace(argv, dirForResolution, simpleCommandIndex, join5, results) {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  if (command === "sed") {
    matchSedInplaceArgs(rest.slice(1), dirForResolution, simpleCommandIndex, join5, results);
    return;
  }
  if (FOREIGN_WRAPPERS.has(command)) {
    const wrapped = rest[1];
    if (wrapped === "sed") {
      pushUnresolved(results, "sed-inplace", wrapped, `the ${command} wrapper obscures the ${wrapped} argv`);
    }
  }
}
function matchSedInplaceArgs(args, dir, simpleCommandIndex, join5, results) {
  let suffix = null;
  let sawInplace = false;
  let i = 0;
  const eScripts = [];
  const positionals = [];
  const files = [];
  let afterDashDash = false;
  while (i < args.length) {
    const a = args[i];
    if (afterDashDash) {
      positionals.push(a);
      i += 1;
      continue;
    }
    if (a === "--") {
      afterDashDash = true;
      i += 1;
      continue;
    }
    if (a === "-n") {
      i += 1;
      continue;
    }
    if (a === "-e") {
      const v = args[i + 1];
      if (v === void 0) {
        pushUnresolved(results, "sed-inplace", a, "the -e flag is left valueless");
        return;
      }
      eScripts.push(v);
      i += 2;
      continue;
    }
    if (a === "-i") {
      sawInplace = true;
      const w = args[i + 1];
      if (w === void 0) {
        i += 1;
        continue;
      }
      if (w.startsWith("-")) {
        i += 1;
        continue;
      }
      const restAfter = args.slice(i + 2);
      if (restAfter.length >= 2) {
        suffix = w;
        i += 2;
        continue;
      }
      if (restAfter.length === 0) {
        files.push(w);
        i += 2;
        continue;
      }
      positionals.push(w, restAfter[0]);
      i += 3;
      continue;
    }
    if (a.startsWith("-i") && a.length > 2) {
      sawInplace = true;
      suffix = a.slice(2);
      i += 1;
      continue;
    }
    if (a.startsWith("-")) {
      i += 1;
      continue;
    }
    positionals.push(a);
    i += 1;
  }
  if (!sawInplace) return;
  const scriptArg = eScripts.length === 0 ? positionals[0] ?? null : null;
  if (scriptArg !== null) files.push(...positionals.slice(1));
  else files.push(...positionals);
  const segments = [];
  if (scriptArg !== null) segments.push(...scriptArg.split(";"));
  for (const s of eScripts) segments.push(...s.split(";"));
  if (segments.length === 0) {
    pushUnresolved(results, "sed-inplace", files[0] ?? "sed", "no script (absent or empty script argument)");
    return;
  }
  let allNumeric = true;
  let allSubstitution = true;
  let minStart = Infinity;
  let maxEnd = 0;
  for (const segment of segments) {
    const m = segment.match(NUMERIC_SUBSTITUTION);
    if (m === null) {
      allNumeric = false;
      if (!UNRESTRICTED_SUBSTITUTION.test(segment)) allSubstitution = false;
      continue;
    }
    const s = Number.parseInt(m[1], 10);
    const e = m[2] === void 0 ? s : Number.parseInt(m[2], 10);
    minStart = Math.min(minStart, s);
    maxEnd = Math.max(maxEnd, e);
  }
  for (const f of files) {
    if (looksUnresolvable(f)) {
      pushUnresolved(results, "sed-inplace", f, "path contains an unexpanded shell variable or glob");
      continue;
    }
    const absolutePath = resolvePath(dir, f);
    if (allNumeric || allSubstitution) {
      const total = countFileLines(absolutePath);
      if (total === null) {
        pushUnresolved(
          results,
          "sed-inplace",
          absolutePath,
          "could not determine end-of-file line count (file unreadable, empty, or missing)"
        );
        continue;
      }
      const start = allNumeric ? minStart : 1;
      const end = allNumeric ? Math.min(maxEnd, total) : total;
      if (start > end) continue;
      results.push({
        status: "resolved",
        idiom: "sed-inplace",
        span: { operation: "modify", lineStart: start, lineEnd: end, absolutePath, simpleCommandIndex, join: join5 }
      });
    } else {
      results.push({
        status: "resolved",
        idiom: "sed-inplace",
        span: { operation: "modify", absolutePath, simpleCommandIndex, join: join5 }
      });
    }
    if (suffix !== null && suffix !== "") {
      results.push({
        status: "resolved",
        idiom: "sed-inplace",
        span: { operation: "create-overwrite", absolutePath: `${absolutePath}${suffix}`, simpleCommandIndex, join: join5 }
      });
    }
  }
}
function patchApplyParts(args, isGitApply) {
  let strip = isGitApply ? 1 : "auto";
  let readOnly = false;
  let cachedOnly = false;
  let directory = false;
  const operands = [];
  let afterDashDash = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (afterDashDash) {
      operands.push(a);
      continue;
    }
    if (a === "--") {
      afterDashDash = true;
      continue;
    }
    if (isGitApply) {
      if (a === "--check" || a === "--stat" || a === "--numstat" || a === "--summary") {
        readOnly = true;
        continue;
      }
      if (a === "--cached") {
        cachedOnly = true;
        continue;
      }
      if (a === "--index" || a === "-R" || a === "--reverse" || a === "--unsafe-paths" || a === "--reject") continue;
      if (a === "--directory") {
        directory = true;
        continue;
      }
      if (a.startsWith("--directory=")) {
        directory = true;
        continue;
      }
      if (a === "-p") {
        const v = args[i + 1];
        if (v !== void 0 && /^\d+$/.test(v)) {
          strip = Number.parseInt(v, 10);
          i += 1;
        }
        continue;
      }
      if (/^-p\d+$/.test(a)) {
        strip = Number.parseInt(a.slice(2), 10);
        continue;
      }
      if (a.startsWith("-")) continue;
      operands.push(a);
      continue;
    }
    if (a === "--dry-run") {
      readOnly = true;
      continue;
    }
    if (a === "-N" || a === "--forward") continue;
    if (a === "-p") {
      const v = args[i + 1];
      if (v !== void 0 && /^\d+$/.test(v)) {
        strip = Number.parseInt(v, 10);
        i += 1;
      }
      continue;
    }
    if (/^-p\d+$/.test(a)) {
      strip = Number.parseInt(a.slice(2), 10);
      continue;
    }
    if (a.startsWith("-")) continue;
    operands.push(a);
  }
  return { strip, readOnly, cachedOnly, directory, operands };
}
function readPatchFile(absolutePath) {
  try {
    return readFileSync5(absolutePath, "utf8");
  } catch {
    return null;
  }
}
function emitPatchTargets(args, isGitApply, host, targetDir, shellDir, redirects, simpleCommandIndex, join5, results) {
  const parts = patchApplyParts(args, isGitApply);
  if (parts.readOnly || parts.cachedOnly) return;
  if (parts.directory) {
    pushUnresolved(results, "patch-write", "--directory", "--directory rewrites patch paths");
    return;
  }
  let patchText = null;
  let source = null;
  if (isGitApply) {
    const operand = parts.operands.find((o) => o !== "-");
    if (operand !== void 0) {
      if (looksUnresolvable(operand)) {
        pushUnresolved(results, "patch-write", operand, "path contains an unexpanded shell variable or glob");
        return;
      }
      source = resolvePath(targetDir, operand);
      patchText = readPatchFile(source);
      if (patchText === null) {
        pushUnresolved(results, "patch-write", source, "patch file unreadable or missing");
        return;
      }
    }
  }
  if (patchText === null) {
    const stdin = redirects.find((r) => r.op === "<");
    if (stdin !== void 0 && stdin.target !== null) {
      if (looksUnresolvable(stdin.target)) {
        pushUnresolved(results, "patch-write", stdin.target, "path contains an unexpanded shell variable or glob");
        return;
      }
      source = resolvePath(shellDir, stdin.target);
      patchText = readPatchFile(source);
      if (patchText === null) {
        pushUnresolved(results, "patch-write", source, "patch text unreadable or missing");
        return;
      }
    }
  }
  if (patchText === null) {
    pushUnresolved(results, "patch-write", host, "no statically known patch text source (stdin is dynamic)");
    return;
  }
  const targets = parseUnifiedDiffRange(patchText, parts.strip);
  if (targets === null) {
    pushUnresolved(results, "patch-write", source ?? host, "malformed or empty patch text");
    return;
  }
  for (const t of targets) {
    const absolutePath = resolveTarget(results, "patch-write", t.path, targetDir);
    if (absolutePath === null) continue;
    results.push({
      status: "resolved",
      idiom: "patch-write",
      span: {
        operation: t.operation,
        absolutePath,
        simpleCommandIndex,
        join: join5,
        ...t.lineStart !== void 0 ? { lineStart: t.lineStart, lineEnd: t.lineEnd } : {}
      }
    });
  }
}
function matchPatchApply(argv, redirects, dirForResolution, simpleCommandIndex, join5, results) {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  if (command === "patch") {
    emitPatchTargets(
      rest.slice(1),
      false,
      "patch",
      dirForResolution,
      dirForResolution,
      redirects,
      simpleCommandIndex,
      join5,
      results
    );
    return;
  }
  if (command === "git") {
    const sub = findGitSubcommand(rest.slice(1));
    if (sub === null || sub.subcommand !== "apply") return;
    if (sub.cDirUnresolvable) {
      pushUnresolved(results, "patch-write", "apply", "git -C target contains an unresolved shell variable");
      return;
    }
    emitPatchTargets(
      rest.slice(1).slice(sub.subIdx + 1),
      true,
      "apply",
      sub.cDir ?? dirForResolution,
      dirForResolution,
      redirects,
      simpleCommandIndex,
      join5,
      results
    );
    return;
  }
  if (FOREIGN_WRAPPERS.has(command)) {
    const wrapped = rest[1];
    if (wrapped === "patch" || wrapped === "apply") {
      pushUnresolved(results, "patch-write", wrapped, `the ${command} wrapper obscures the ${wrapped} argv`);
    }
  }
}
function classifyPatchHeredoc(argv, body, currentDir, simpleCommandIndex, join5, results) {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  let isGitApply = false;
  let args;
  let dir = currentDir;
  if (command === "patch") {
    args = rest.slice(1);
  } else if (command === "git") {
    const sub = findGitSubcommand(rest.slice(1));
    if (sub === null || sub.subcommand !== "apply") return;
    if (sub.cDirUnresolvable) {
      pushUnresolved(results, "patch-write", "apply", "git -C target contains an unresolved shell variable");
      return;
    }
    isGitApply = true;
    args = rest.slice(1).slice(sub.subIdx + 1);
    dir = sub.cDir ?? currentDir;
  } else {
    return;
  }
  const parts = patchApplyParts(args, isGitApply);
  if (parts.readOnly || parts.cachedOnly) return;
  if (parts.directory) {
    pushUnresolved(results, "patch-write", "--directory", "--directory rewrites patch paths");
    return;
  }
  const targets = parseUnifiedDiffRange(body, parts.strip);
  if (targets === null) {
    pushUnresolved(results, "patch-write", "heredoc", "malformed or empty patch text");
    return;
  }
  for (const t of targets) {
    const absolutePath = resolveTarget(results, "patch-write", t.path, dir);
    if (absolutePath === null) continue;
    results.push({
      status: "resolved",
      idiom: "patch-write",
      span: {
        operation: t.operation,
        absolutePath,
        simpleCommandIndex,
        join: join5,
        ...t.lineStart !== void 0 ? { lineStart: t.lineStart, lineEnd: t.lineEnd } : {}
      }
    });
  }
}
var FORMATTER_TABLE = [
  {
    command: "prettier",
    writeForms: [["--write"], ["-w"]],
    readOnlyForms: [["--check"], ["--list-different"], ["--debug-check"]]
  },
  { command: "eslint", writeForms: [["--fix"]], readOnlyForms: [["--fix-dry-run"]] },
  {
    command: "biome",
    writeForms: [
      ["check", "--write"],
      ["check", "--fix"],
      ["format", "--write"]
    ],
    readOnlyForms: []
  },
  { command: "gofmt", writeForms: [["-w"]], readOnlyForms: [["-l"]] },
  { command: "goimports", writeForms: [["-w"]], readOnlyForms: [] },
  { command: "clang-format", writeForms: [["-i"]], readOnlyForms: [["--dry-run"]] },
  { command: "shfmt", writeForms: [["-w"]], readOnlyForms: [["-d"]] },
  { command: "yapf", writeForms: [["-i"]], readOnlyForms: [["--diff"]] },
  { command: "autopep8", writeForms: [["-i"]], readOnlyForms: [["-d"], ["--diff"]] },
  { command: "black", writeForms: [[]], readOnlyForms: [["--check"], ["--diff"]] },
  { command: "isort", writeForms: [[]], readOnlyForms: [["--check-only"], ["--diff"]] },
  {
    command: "ruff",
    writeForms: [["format"], ["check", "--fix"]],
    readOnlyForms: [
      ["check", "--no-fix"],
      ["format", "--check"]
    ]
  },
  { command: "deno", writeForms: [["fmt"]], readOnlyForms: [["fmt", "--check"]] },
  { command: "dprint", writeForms: [["fmt"]], readOnlyForms: [["check"]] },
  { command: "rustfmt", writeForms: [[]], readOnlyForms: [["--check"], ["--emit", "stdout"]] },
  {
    command: "terraform",
    writeForms: [["fmt"]],
    readOnlyForms: [
      ["fmt", "-check"],
      ["fmt", "-diff"]
    ]
  }
];
var RUNNER_NO_ARG_FLAGS = /* @__PURE__ */ new Set(["-y", "--yes", "--no-install"]);
function stripPackageRunner(argv) {
  const runner = argv[0];
  let rest = argv.slice(1);
  if (runner === "npx" || runner === "yarn" || runner === "bunx") {
  } else if (runner === "pnpm") {
    if (rest[0] !== "exec" && rest[0] !== "dlx") return "not-runner";
    rest = rest.slice(1);
  } else if (runner === "npm") {
    if (rest[0] !== "exec") return "not-runner";
    rest = rest.slice(1);
  } else {
    return "not-runner";
  }
  while (RUNNER_NO_ARG_FLAGS.has(rest[0])) rest = rest.slice(1);
  if (runner === "npm" && rest[0] === "--") rest = rest.slice(1);
  if (rest.length === 0) return "not-runner";
  const wrapped = rest[0];
  if (wrapped.startsWith("-") || wrapped.startsWith(".") || /\s/.test(wrapped)) return { kind: "obscured" };
  return { kind: "stripped", stripped: rest };
}
function matchFormatter(argv, dirForResolution, simpleCommandIndex, join5, results) {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  let words = rest;
  const strip = stripPackageRunner(rest);
  if (strip === "not-runner") {
  } else if (strip.kind === "obscured") {
    pushUnresolved(results, "formatter-write", rest[0], `the ${rest[0]} wrapper obscures the wrapped argv`);
    return;
  } else {
    words = strip.stripped;
  }
  if (FOREIGN_WRAPPERS.has(words[0])) {
    const wrapped = words[1];
    if (wrapped !== void 0 && FORMATTER_TABLE.some((r) => r.command === wrapped)) {
      pushUnresolved(results, "formatter-write", wrapped, `the ${words[0]} wrapper obscures the ${wrapped} argv`);
    }
    return;
  }
  const row = FORMATTER_TABLE.find((r) => r.command === words[0]);
  if (row === void 0) return;
  const args = words.slice(1);
  const formPresent = (form) => {
    const first = form[0];
    if (first !== void 0 && !first.startsWith("-") && args[0] !== first) return false;
    return form.every((token) => args.includes(token));
  };
  if (row.readOnlyForms.some(formPresent)) return;
  if (!row.writeForms.some(formPresent)) return;
  const subcommandWords = /* @__PURE__ */ new Set();
  for (const form of row.writeForms) {
    for (const token of form) {
      if (!token.startsWith("-")) subcommandWords.add(token);
    }
  }
  const afterSubcommand = subcommandWords.has(args[0]) ? args.slice(1) : args;
  let afterDashDash = false;
  const operands = [];
  for (const a of afterSubcommand) {
    if (afterDashDash) {
      operands.push(a);
      continue;
    }
    if (a === "--") {
      afterDashDash = true;
      continue;
    }
    if (a.startsWith("-")) continue;
    operands.push(a);
  }
  if (operands.length === 0) return;
  for (const operand of operands) {
    if (looksUnresolvable(operand)) {
      pushUnresolved(results, "formatter-write", operand, "path contains an unexpanded shell variable or glob");
      return;
    }
    if (operand.endsWith("/") || isExistingDirectory(resolvePath(dirForResolution, operand))) return;
  }
  for (const operand of operands) {
    results.push({
      status: "resolved",
      idiom: "formatter-write",
      span: { operation: "modify", absolutePath: resolvePath(dirForResolution, operand), simpleCommandIndex, join: join5 }
    });
  }
}
var RESTORE_NO_VALUE = /* @__PURE__ */ new Set(["-q", "-f", "-u"]);
function emitRestoreCheckoutPathspec(results, idiom, operand, dir, simpleCommandIndex, join5) {
  if (looksUnresolvable(operand)) {
    pushUnresolved(results, idiom, operand, "path contains an unexpanded shell variable or glob");
    return;
  }
  const absolutePath = resolvePath(dir, operand);
  if (operand === "." || operand === ".." || operand.endsWith("/") || isExistingDirectory(absolutePath)) {
    pushUnresolved(
      results,
      idiom,
      operand,
      "directory-shaped pathspec rewrites arbitrary files beneath it \u2014 not attributable to a file write"
    );
    return;
  }
  results.push({
    status: "resolved",
    idiom,
    span: { operation: "create-overwrite", absolutePath, simpleCommandIndex, join: join5 }
  });
}
function matchRestoreOperands(args, dir, simpleCommandIndex, join5, results) {
  let staged = false;
  let worktree = false;
  let afterDashDash = false;
  const operands = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (afterDashDash) {
      operands.push(a);
      continue;
    }
    if (a === "--") {
      afterDashDash = true;
      continue;
    }
    if (a === "-p" || a === "--patch") {
      pushUnresolved(
        results,
        "git-restore-write",
        a,
        "interactive patch mode applies user-chosen hunks \u2014 no static span"
      );
      return;
    }
    if (a === "-s" || a === "--source") {
      i += 1;
      continue;
    }
    if (a.startsWith("--source=")) continue;
    if (a === "-m" || a === "--merge") return;
    if (a === "--staged") {
      staged = true;
      continue;
    }
    if (a === "-W" || a === "--worktree") {
      worktree = true;
      continue;
    }
    if (RESTORE_NO_VALUE.has(a)) continue;
    if (a.startsWith("-")) continue;
    operands.push(a);
  }
  if (staged && !worktree) return;
  for (const operand of operands) {
    emitRestoreCheckoutPathspec(results, "git-restore-write", operand, dir, simpleCommandIndex, join5);
  }
}
function matchCheckoutOperands(args, dir, simpleCommandIndex, join5, results) {
  let afterDashDash = false;
  const operands = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (afterDashDash) {
      operands.push(a);
      continue;
    }
    if (a === "--") {
      afterDashDash = true;
      continue;
    }
    if (a === "-p" || a === "--patch") {
      pushUnresolved(
        results,
        "git-checkout-write",
        a,
        "interactive patch mode applies user-chosen hunks \u2014 no static span"
      );
      return;
    }
    if (a === "-b" || a === "-B" || a === "--orphan") {
      i += 1;
      continue;
    }
    if (a === "-f" || a === "-q" || a === "-m" || a === "-t") continue;
    if (a.startsWith("-")) continue;
  }
  for (const operand of operands) {
    emitRestoreCheckoutPathspec(results, "git-checkout-write", operand, dir, simpleCommandIndex, join5);
  }
}
function matchGitRestoreCheckout(argv, dirForResolution, simpleCommandIndex, join5, results) {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  if (command === "git") {
    const sub = findGitSubcommand(rest.slice(1));
    if (sub === null || sub.subcommand !== "restore" && sub.subcommand !== "checkout") return;
    if (sub.cDirUnresolvable) {
      pushUnresolved(
        results,
        sub.subcommand === "restore" ? "git-restore-write" : "git-checkout-write",
        sub.subcommand,
        "git -C target contains an unresolved shell variable"
      );
      return;
    }
    const dir = sub.cDir ?? dirForResolution;
    const args = rest.slice(1).slice(sub.subIdx + 1);
    if (sub.subcommand === "restore") matchRestoreOperands(args, dir, simpleCommandIndex, join5, results);
    else matchCheckoutOperands(args, dir, simpleCommandIndex, join5, results);
    return;
  }
  if (FOREIGN_WRAPPERS.has(command)) {
    const wrapped = rest[1];
    if (wrapped === "restore" || wrapped === "checkout") {
      pushUnresolved(
        results,
        wrapped === "restore" ? "git-restore-write" : "git-checkout-write",
        wrapped,
        `the ${command} wrapper obscures the ${wrapped} argv`
      );
    }
  }
}
var LINE_SELECTORS = [matchSed, matchHead, matchTail];
function parseCommandDetailed(command, cwd = process.cwd()) {
  const { writes: heredocWrites, masked } = extractHeredocWrites(command);
  const simpleCommands = splitTopLevel(masked);
  const results = [];
  const fsLineCache = /* @__PURE__ */ new Map();
  const gitLineCache = /* @__PURE__ */ new Map();
  const cachedFsTotalLines = (absPath) => () => {
    if (!fsLineCache.has(absPath)) fsLineCache.set(absPath, countFileLines(absPath));
    return fsLineCache.get(absPath) ?? null;
  };
  const cachedGitTotalLines = (gitCwd, rev, path) => () => {
    const key = `${gitCwd}\0${rev}\0${path}`;
    if (!gitLineCache.has(key)) gitLineCache.set(key, countGitBlobLines(gitCwd, rev, path));
    return gitLineCache.get(key) ?? null;
  };
  let currentDir = cwd;
  let lastPlainFileSource = null;
  let pipeEchoContent = null;
  const joinOf = (simple) => simple.precededBy === "&&" || simple.precededBy === "||" ? simple.precededBy : void 0;
  const emitCandidate = (c, dirForResolution, simpleCommandIndex, join5) => {
    if (looksUnresolvable(c.fileArg)) {
      results.push({
        status: "unresolved",
        idiom: c.idiom,
        fileArg: c.fileArg,
        reason: "path contains an unexpanded shell variable or glob"
      });
      return;
    }
    const absolutePath = resolvePath(dirForResolution, c.fileArg);
    const totalLines = c.resolverKind === "fs" ? cachedFsTotalLines(absolutePath) : cachedGitTotalLines(c.dirOverride ?? dirForResolution, c.resolverKind.rev, c.fileArg);
    const range = resolveSpec(c.spec, totalLines);
    if (range === null) {
      results.push({
        status: "unresolved",
        idiom: c.idiom,
        fileArg: absolutePath,
        reason: "could not determine end-of-file line count (file unreadable, empty, or git rev/path not found)"
      });
      return;
    }
    results.push({
      status: "resolved",
      idiom: c.idiom,
      span: {
        operation: "read",
        lineStart: range.lineStart,
        lineEnd: range.lineEnd,
        absolutePath,
        simpleCommandIndex,
        join: join5
      }
    });
  };
  const matchReads = (simple, argv, i) => {
    let isPlainSource = false;
    let plainFileArg = null;
    if (argv[0] === "cat" && argv.length === 2 && !argv[1].startsWith("-")) {
      isPlainSource = true;
      plainFileArg = argv[1];
      lastPlainFileSource = hasShellExpansion(argv[1]) ? null : resolvePath(currentDir, argv[1]);
    } else if (argv[0] === "nl" && argv.length >= 2 && !argv[argv.length - 1].startsWith("-")) {
      isPlainSource = true;
      const f = argv[argv.length - 1];
      plainFileArg = f;
      lastPlainFileSource = hasShellExpansion(f) ? null : resolvePath(currentDir, f);
    }
    if (plainFileArg !== null) {
      const next = simpleCommands[i + 1];
      if (next === void 0 || next.precededBy !== "|") {
        emitCandidate(
          {
            kind: "candidate",
            idiom: argv[0] === "cat" ? "cat-file" : "nl-file",
            fileArg: plainFileArg,
            spec: { kind: "toEof", start: 1 },
            resolverKind: "fs"
          },
          currentDir,
          i,
          joinOf(simple)
        );
      }
    }
    let matched = false;
    for (const matcher of [...LINE_SELECTORS, matchGitShow, matchGitLogL]) {
      for (const outcome of matcher(argv)) {
        matched = true;
        if (outcome.kind === "unresolved") {
          results.push({
            status: "unresolved",
            idiom: outcome.idiom,
            fileArg: outcome.fileArg,
            reason: outcome.reason
          });
        } else {
          emitCandidate(outcome, outcome.dirOverride ?? currentDir, i, joinOf(simple));
          if (outcome.idiom === "git-show-rev-path" && !looksUnresolvable(outcome.fileArg)) {
            isPlainSource = true;
            lastPlainFileSource = resolvePath(outcome.dirOverride ?? currentDir, outcome.fileArg);
          }
        }
      }
    }
    if (!matched && simple.precededBy === "|" && lastPlainFileSource) {
      const withFile = [...argv, lastPlainFileSource];
      for (const matcher of LINE_SELECTORS) {
        for (const outcome of matcher(withFile)) {
          if (outcome.kind === "candidate") emitCandidate(outcome, currentDir, i, joinOf(simple));
          else
            results.push({
              status: "unresolved",
              idiom: outcome.idiom,
              fileArg: outcome.fileArg,
              reason: outcome.reason
            });
        }
      }
    }
    if (!isPlainSource) lastPlainFileSource = null;
  };
  for (let i = 0; i < simpleCommands.length; i++) {
    const simple = simpleCommands[i];
    if (simple.precededBy !== "|") pipeEchoContent = null;
    const heredocRef = simple.text.match(/^__heredoc_(\d+)__$/);
    if (heredocRef) {
      const w = heredocWrites[Number.parseInt(heredocRef[1], 10)];
      const tokens2 = tokenize(stripLeadingAssignments(w.opener).trim());
      if (tokens2 === null) {
        lastPlainFileSource = null;
        continue;
      }
      const openerArgv = analyzeTokens(tokens2).argv;
      matchReads(simple, openerArgv, i);
      classifyHeredocOpener(w.opener, w.body, currentDir, i, joinOf(simple), results);
      pipeEchoContent = literalContent(openerArgv) ?? null;
      continue;
    }
    const tokens = tokenize(stripLeadingAssignments(simple.text).trim());
    if (tokens === null) {
      lastPlainFileSource = null;
      continue;
    }
    const { argv, redirects } = analyzeTokens(tokens);
    if (argv.length === 0) {
      matchRedirectFamily(argv, redirects, pipeEchoContent, currentDir, i, joinOf(simple), results);
      lastPlainFileSource = null;
      continue;
    }
    if (argv[0] === "cd") {
      lastPlainFileSource = null;
      const target = argv[1];
      if (target !== void 0 && target !== "-" && !hasShellExpansion(target)) {
        currentDir = resolvePath(currentDir, target);
      }
      continue;
    }
    matchReads(simple, argv, i);
    matchRedirectFamily(argv, redirects, pipeEchoContent, currentDir, i, joinOf(simple), results);
    matchCopyMoveFamily(argv, currentDir, i, joinOf(simple), results);
    matchRmTruncate(argv, currentDir, i, joinOf(simple), results);
    matchSedInplace(argv, currentDir, i, joinOf(simple), results);
    matchPatchApply(argv, redirects, currentDir, i, joinOf(simple), results);
    matchFormatter(argv, currentDir, i, joinOf(simple), results);
    matchGitRestoreCheckout(argv, currentDir, i, joinOf(simple), results);
    pipeEchoContent = literalContent(argv) ?? null;
  }
  return results;
}

// src/claude/post-tool-use.ts
function positiveIntField(toolInput, field) {
  const raw = toolInput[field];
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : void 0;
}
function toTouchInput(toolName, toolInput, sessionId, cwd, filePath) {
  if (toolName === "Read") {
    const offset = positiveIntField(toolInput, "offset");
    const limit = positiveIntField(toolInput, "limit");
    return { kind: "read", sessionId, cwd, filePath, offset, limit };
  }
  if (toolName === "Edit" || toolName === "Write") {
    const raw = toolName === "Edit" ? toolInput.new_string : toolInput.content;
    const written = typeof raw === "string" ? raw : "";
    return { kind: "write", sessionId, cwd, filePath, written, targetState: "exists" };
  }
  return null;
}
function createHandler(executors = createDefaultTouchExecutors(), memoFactory = createDiskMemoStore) {
  return async (input, ctx) => {
    const memo = memoFactory(ctx.logger);
    const sessionId = input.session_id;
    const cwd = input.cwd ?? "";
    const toolName = input.tool_name;
    const toolInput = input.tool_input ?? {};
    if (toolName === "Bash") {
      const command = typeof toolInput.command === "string" ? toolInput.command : null;
      if (!command) return null;
      if (bashResponseInterrupted(input.tool_response)) return null;
      const matches = parseCommandDetailed(command, cwd);
      const blocks = await runBashTouches(
        matches,
        sessionId,
        cwd,
        input.tool_response,
        executors,
        memo,
        (message) => ctx.logger.warn(message)
      );
      if (blocks.length === 0) return null;
      const combined = blocks.join("");
      return postToolUseOutput({
        hookSpecificOutput: { additionalContext: combined },
        systemMessage: combined
      });
    }
    const absPath = derivePath(toolInput, cwd);
    if (!absPath) return null;
    const scope = resolveTouchScope(cwd, absPath);
    if (!scope) return null;
    const touch = toTouchInput(toolName, toolInput, sessionId, cwd, absPath);
    if (!touch) return null;
    const output = await runTouchHook(touch, executors, memo);
    if (!output.additionalContext) return null;
    return postToolUseOutput({
      hookSpecificOutput: { additionalContext: output.additionalContext },
      systemMessage: output.additionalContext
    });
  };
}
var post_tool_use_default = postToolUseHook({ matcher: "Read|Edit|Write|Bash", timeout: 1e4 }, createHandler());

// src/claude/post-tool-use-entry.ts
execute(post_tool_use_default);
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcy9kaXN0L2Vudi5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL3NwYW4tc3VyZmFjZS50cyIsICJzcmMvY29tbW9uL3NwYW4taWdub3JlLnRzIiwgInNyYy9jb21tb24vdG91Y2gtY29yZS50cyIsICJzcmMvY29tbW9uL2FuY2hvci10cmVlLnRzIiwgInNyYy9jb21tb24vYmFzaC10b3VjaC50cyIsICJzcmMvY29tbW9uL3BhcnNlLWNvbW1hbmQudHMiLCAic3JjL2NvbW1vbi9jb21tYW5kLXJlc29sdmUudHMiLCAic3JjL2NvbW1vbi9zaGVsbC1zcGxpdC50cyIsICJzcmMvY29tbW9uL3VuaWZpZWQtZGlmZi50cyIsICJzcmMvY2xhdWRlL3Bvc3QtdG9vbC11c2UudHMiLCAic3JjL2NsYXVkZS9wb3N0LXRvb2wtdXNlLWVudHJ5LnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvKipcbiAqIEVudmlyb25tZW50IHZhcmlhYmxlIHV0aWxpdGllcyBmb3IgQ2xhdWRlIENvZGUgaG9va3MuXG4gKlxuICogUHJvdmlkZXMgdHlwZWQgYWNjZXNzIHRvIENsYXVkZSBDb2RlJ3MgZW52aXJvbm1lbnQgdmFyaWFibGVzIGFuZCB1dGlsaXRpZXNcbiAqIGZvciBwZXJzaXN0aW5nIGVudmlyb25tZW50IHZhcmlhYmxlcyBpbiBTZXNzaW9uU3RhcnQgaG9va3MuXG4gKlxuICogIyMgRW52aXJvbm1lbnQgVmFyaWFibGVzXG4gKlxuICogQ2xhdWRlIENvZGUgc2V0cyB0aGVzZSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgd2hlbiBydW5uaW5nIGhvb2tzOlxuICpcbiAqIHwgVmFyaWFibGUgfCBEZXNjcmlwdGlvbiB8IEF2YWlsYWJsZSBJbiB8XG4gKiB8LS0tLS0tLS0tLXwtLS0tLS0tLS0tLS0tfC0tLS0tLS0tLS0tLS0tfFxuICogfCBgQ0xBVURFX1BST0pFQ1RfRElSYCB8IEFic29sdXRlIHBhdGggdG8gcHJvamVjdCByb290IHwgQWxsIGhvb2tzIHxcbiAqIHwgYENMQVVERV9FTlZfRklMRWAgfCBQYXRoIHRvIGZpbGUgZm9yIHBlcnNpc3RpbmcgZW52IHZhcnMgfCBTZXNzaW9uU3RhcnQgb25seSB8XG4gKiB8IGBDTEFVREVfQ09ERV9SRU1PVEVgIHwgYFwidHJ1ZVwiYCBpZiBydW5uaW5nIHJlbW90ZWx5IHwgQWxsIGhvb2tzIHxcbiAqIEBtb2R1bGVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBnZXRQcm9qZWN0RGlyLCBwZXJzaXN0RW52VmFyLCBpc1JlbW90ZUVudmlyb25tZW50IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBHZXQgcHJvamVjdCBkaXJlY3RvcnlcbiAqIGNvbnN0IHByb2plY3REaXIgPSBnZXRQcm9qZWN0RGlyKCk7XG4gKlxuICogLy8gQ2hlY2sgaWYgcnVubmluZyByZW1vdGVseVxuICogaWYgKGlzUmVtb3RlRW52aXJvbm1lbnQoKSkge1xuICogICAvLyBIYW5kbGUgcmVtb3RlLXNwZWNpZmljIGxvZ2ljXG4gKiB9XG4gKlxuICogLy8gSW4gU2Vzc2lvblN0YXJ0IGhvb2s6IHBlcnNpc3QgZW52aXJvbm1lbnQgdmFyaWFibGVzXG4gKiBwZXJzaXN0RW52VmFyKCdOT0RFX0VOVicsICdwcm9kdWN0aW9uJyk7XG4gKiBwZXJzaXN0RW52VmFyKCdBUElfS0VZJywgJ3NlY3JldC1rZXknKTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI2hvb2stZXhlY3V0aW9uLWRldGFpbHNcbiAqL1xuaW1wb3J0ICogYXMgZnMgZnJvbSBcIm5vZGU6ZnNcIjtcbi8qKlxuICogQ2xhdWRlIENvZGUgZW52aXJvbm1lbnQgdmFyaWFibGUgbmFtZXMuXG4gKlxuICogVGhlc2UgYXJlIHRoZSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgdGhhdCBDbGF1ZGUgQ29kZSBzZXRzIHdoZW4gcnVubmluZyBob29rcy5cbiAqL1xuZXhwb3J0IGNvbnN0IENMQVVERV9FTlZfVkFSUyA9IHtcbiAgICAvKipcbiAgICAgKiBBYnNvbHV0ZSBwYXRoIHRvIHRoZSBwcm9qZWN0IHJvb3QgZGlyZWN0b3J5IHdoZXJlIENsYXVkZSBDb2RlIHdhcyBzdGFydGVkLlxuICAgICAqIEF2YWlsYWJsZSBpbiBhbGwgaG9va3MuXG4gICAgICovXG4gICAgUFJPSkVDVF9ESVI6IFwiQ0xBVURFX1BST0pFQ1RfRElSXCIsXG4gICAgLyoqXG4gICAgICogUGF0aCB0byBhIGZpbGUgd2hlcmUgU2Vzc2lvblN0YXJ0IGhvb2tzIGNhbiBwZXJzaXN0IGVudmlyb25tZW50IHZhcmlhYmxlcy5cbiAgICAgKiBWYXJpYWJsZXMgd3JpdHRlbiB0byB0aGlzIGZpbGUgd2lsbCBiZSBhdmFpbGFibGUgaW4gYWxsIHN1YnNlcXVlbnQgYmFzaCBjb21tYW5kcy5cbiAgICAgKiBPbmx5IGF2YWlsYWJsZSBpbiBTZXNzaW9uU3RhcnQgaG9va3MuXG4gICAgICovXG4gICAgRU5WX0ZJTEU6IFwiQ0xBVURFX0VOVl9GSUxFXCIsXG4gICAgLyoqXG4gICAgICogU2V0IHRvIFwidHJ1ZVwiIHdoZW4gcnVubmluZyBpbiBhIHJlbW90ZSAod2ViKSBlbnZpcm9ubWVudC5cbiAgICAgKiBOb3Qgc2V0IG9yIGVtcHR5IHdoZW4gcnVubmluZyBpbiBsb2NhbCBDTEkgZW52aXJvbm1lbnQuXG4gICAgICovXG4gICAgUkVNT1RFOiBcIkNMQVVERV9DT0RFX1JFTU9URVwiLFxufTtcbi8qKlxuICogR2V0cyB0aGUgQ2xhdWRlIENvZGUgcHJvamVjdCBkaXJlY3RvcnkuXG4gKlxuICogVGhpcyBpcyB0aGUgYWJzb2x1dGUgcGF0aCB0byB0aGUgcHJvamVjdCByb290IHdoZXJlIENsYXVkZSBDb2RlIHdhcyBzdGFydGVkLlxuICogVGhlIHZhbHVlIGNvbWVzIGZyb20gdGhlIGBDTEFVREVfUFJPSkVDVF9ESVJgIGVudmlyb25tZW50IHZhcmlhYmxlLlxuICogQHJldHVybnMgVGhlIHByb2plY3QgZGlyZWN0b3J5IHBhdGgsIG9yIHVuZGVmaW5lZCBpZiBub3Qgc2V0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogY29uc3QgcHJvamVjdERpciA9IGdldFByb2plY3REaXIoKTtcbiAqIGlmIChwcm9qZWN0RGlyKSB7XG4gKiAgIGNvbnN0IGNvbmZpZ1BhdGggPSBgJHtwcm9qZWN0RGlyfS8uY2xhdWRlL2NvbmZpZy5qc29uYDtcbiAqIH1cbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0UHJvamVjdERpcigpIHtcbiAgICByZXR1cm4gcHJvY2Vzcy5lbnZbQ0xBVURFX0VOVl9WQVJTLlBST0pFQ1RfRElSXTtcbn1cbi8qKlxuICogR2V0cyB0aGUgQ2xhdWRlIENvZGUgZW52IGZpbGUgcGF0aCBmb3IgcGVyc2lzdGluZyBlbnZpcm9ubWVudCB2YXJpYWJsZXMuXG4gKlxuICogVGhpcyBpcyBvbmx5IGF2YWlsYWJsZSBpbiBTZXNzaW9uU3RhcnQgaG9va3MuIFRoZSBwYXRoIHBvaW50cyB0byBhIGZpbGVcbiAqIHdoZXJlIHlvdSBjYW4gd3JpdGUgc2hlbGwgZXhwb3J0IHN0YXRlbWVudHMgdG8gcGVyc2lzdCBlbnZpcm9ubWVudCB2YXJpYWJsZXNcbiAqIGZvciBhbGwgc3Vic2VxdWVudCBiYXNoIGNvbW1hbmRzIGluIHRoZSBzZXNzaW9uLlxuICogQHJldHVybnMgVGhlIGVudiBmaWxlIHBhdGgsIG9yIHVuZGVmaW5lZCBpZiBub3Qgc2V0IChub3QgYSBTZXNzaW9uU3RhcnQgaG9vaylcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCBlbnZGaWxlID0gZ2V0RW52RmlsZVBhdGgoKTtcbiAqIGlmIChlbnZGaWxlKSB7XG4gKiAgIC8vIFdlJ3JlIGluIGEgU2Vzc2lvblN0YXJ0IGhvb2sgYW5kIGNhbiBwZXJzaXN0IGVudiB2YXJzXG4gKiAgIHBlcnNpc3RFbnZWYXIoJ01ZX1ZBUicsICdteS12YWx1ZScpO1xuICogfVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRFbnZGaWxlUGF0aCgpIHtcbiAgICByZXR1cm4gcHJvY2Vzcy5lbnZbQ0xBVURFX0VOVl9WQVJTLkVOVl9GSUxFXTtcbn1cbi8qKlxuICogQ2hlY2tzIGlmIHRoZSBob29rIGlzIHJ1bm5pbmcgaW4gYSByZW1vdGUgKHdlYikgZW52aXJvbm1lbnQuXG4gKlxuICogUmVtb3RlIGVudmlyb25tZW50cyBtYXkgaGF2ZSBkaWZmZXJlbnQgY2FwYWJpbGl0aWVzIG9yIHJlc3RyaWN0aW9uc1xuICogY29tcGFyZWQgdG8gbG9jYWwgQ0xJIGVudmlyb25tZW50cy5cbiAqIEByZXR1cm5zIHRydWUgaWYgcnVubmluZyByZW1vdGVseSwgZmFsc2UgaWYgcnVubmluZyBsb2NhbGx5XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaWYgKGlzUmVtb3RlRW52aXJvbm1lbnQoKSkge1xuICogICAvLyBVc2Ugd2ViLWNvbXBhdGlibGUgYXBwcm9hY2hlc1xuICogfSBlbHNlIHtcbiAqICAgLy8gQ2FuIHVzZSBsb2NhbCBDTEkgZmVhdHVyZXNcbiAqIH1cbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNSZW1vdGVFbnZpcm9ubWVudCgpIHtcbiAgICByZXR1cm4gcHJvY2Vzcy5lbnZbQ0xBVURFX0VOVl9WQVJTLlJFTU9URV0gPT09IFwidHJ1ZVwiO1xufVxuLyoqXG4gKiBQZXJzaXN0cyBhbiBlbnZpcm9ubWVudCB2YXJpYWJsZSBmb3IgdXNlIGluIHN1YnNlcXVlbnQgYmFzaCBjb21tYW5kcy5cbiAqXG4gKiBUaGlzIGZ1bmN0aW9uIHdyaXRlcyBhIHNoZWxsIGV4cG9ydCBzdGF0ZW1lbnQgdG8gdGhlIGBDTEFVREVfRU5WX0ZJTEVgLFxuICogd2hpY2ggQ2xhdWRlIENvZGUgc291cmNlcyBiZWZvcmUgcnVubmluZyBiYXNoIGNvbW1hbmRzLiBUaGlzIGFsbG93c1xuICogU2Vzc2lvblN0YXJ0IGhvb2tzIHRvIGNvbmZpZ3VyZSB0aGUgZW52aXJvbm1lbnQgZm9yIHRoZSBlbnRpcmUgc2Vzc2lvbi5cbiAqXG4gKiAqKkltcG9ydGFudCoqOiBUaGlzIGZ1bmN0aW9uIG9ubHkgd29ya3MgaW4gU2Vzc2lvblN0YXJ0IGhvb2tzIHdoZXJlXG4gKiBgQ0xBVURFX0VOVl9GSUxFYCBpcyBzZXQuIEluIG90aGVyIGhvb2tzLCBpdCB3aWxsIHRocm93IGFuIGVycm9yLlxuICogQHBhcmFtIG5hbWUgLSBUaGUgZW52aXJvbm1lbnQgdmFyaWFibGUgbmFtZVxuICogQHBhcmFtIHZhbHVlIC0gVGhlIGVudmlyb25tZW50IHZhcmlhYmxlIHZhbHVlICh3aWxsIGJlIHNoZWxsLWVzY2FwZWQpXG4gKiBAdGhyb3dzIEVycm9yIGlmIENMQVVERV9FTlZfRklMRSBpcyBub3Qgc2V0IChub3QgaW4gYSBTZXNzaW9uU3RhcnQgaG9vaylcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBzZXNzaW9uU3RhcnRIb29rLCBzZXNzaW9uU3RhcnRPdXRwdXQsIHBlcnNpc3RFbnZWYXIgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIGV4cG9ydCBkZWZhdWx0IHNlc3Npb25TdGFydEhvb2soe30sIGFzeW5jIChpbnB1dCkgPT4ge1xuICogICAvLyBQZXJzaXN0IGVudmlyb25tZW50IHZhcmlhYmxlcyBmb3IgdGhlIHNlc3Npb25cbiAqICAgcGVyc2lzdEVudlZhcignTk9ERV9FTlYnLCAncHJvZHVjdGlvbicpO1xuICogICBwZXJzaXN0RW52VmFyKCdBUElfS0VZJywgcHJvY2Vzcy5lbnYuTVlfQVBJX0tFWSA/PyAnZGVmYXVsdCcpO1xuICogICBwZXJzaXN0RW52VmFyKCdQQVRIJywgYCR7cHJvY2Vzcy5lbnYuUEFUSH06Li9ub2RlX21vZHVsZXMvLmJpbmApO1xuICpcbiAqICAgcmV0dXJuIHNlc3Npb25TdGFydE91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3BlcnNpc3RpbmctZW52aXJvbm1lbnQtdmFyaWFibGVzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwZXJzaXN0RW52VmFyKG5hbWUsIHZhbHVlKSB7XG4gICAgY29uc3QgZW52RmlsZSA9IGdldEVudkZpbGVQYXRoKCk7XG4gICAgaWYgKGVudkZpbGUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJwZXJzaXN0RW52VmFyIGNhbiBvbmx5IGJlIHVzZWQgaW4gU2Vzc2lvblN0YXJ0IGhvb2tzLiBcIiArIFwiQ0xBVURFX0VOVl9GSUxFIGVudmlyb25tZW50IHZhcmlhYmxlIGlzIG5vdCBzZXQuXCIpO1xuICAgIH1cbiAgICAvLyBTaGVsbC1lc2NhcGUgdGhlIHZhbHVlIHRvIGhhbmRsZSBzcGVjaWFsIGNoYXJhY3RlcnNcbiAgICBjb25zdCBlc2NhcGVkVmFsdWUgPSBlc2NhcGVTaGVsbFZhbHVlKHZhbHVlKTtcbiAgICAvLyBXcml0ZSB0aGUgZXhwb3J0IHN0YXRlbWVudFxuICAgIGNvbnN0IGV4cG9ydFN0YXRlbWVudCA9IGBleHBvcnQgJHtuYW1lfT0ke2VzY2FwZWRWYWx1ZX1cXG5gO1xuICAgIGZzLmFwcGVuZEZpbGVTeW5jKGVudkZpbGUsIGV4cG9ydFN0YXRlbWVudCwgXCJ1dGYtOFwiKTtcbn1cbi8qKlxuICogUGVyc2lzdHMgbXVsdGlwbGUgZW52aXJvbm1lbnQgdmFyaWFibGVzIGF0IG9uY2UuXG4gKlxuICogVGhpcyBpcyBhIGNvbnZlbmllbmNlIHdyYXBwZXIgYXJvdW5kIGBwZXJzaXN0RW52VmFyYCBmb3Igc2V0dGluZ1xuICogbXVsdGlwbGUgdmFyaWFibGVzIGluIGEgc2luZ2xlIGNhbGwuXG4gKiBAcGFyYW0gdmFycyAtIE9iamVjdCBtYXBwaW5nIHZhcmlhYmxlIG5hbWVzIHRvIHZhbHVlc1xuICogQHRocm93cyBFcnJvciBpZiBDTEFVREVfRU5WX0ZJTEUgaXMgbm90IHNldCAobm90IGluIGEgU2Vzc2lvblN0YXJ0IGhvb2spXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogcGVyc2lzdEVudlZhcnMoe1xuICogICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxuICogICBBUElfS0VZOiAnc2VjcmV0JyxcbiAqICAgREVCVUc6ICdmYWxzZSdcbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwZXJzaXN0RW52VmFycyh2YXJzKSB7XG4gICAgZm9yIChjb25zdCBbbmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHZhcnMpKSB7XG4gICAgICAgIHBlcnNpc3RFbnZWYXIobmFtZSwgdmFsdWUpO1xuICAgIH1cbn1cbi8qKlxuICogRXNjYXBlcyBhIHZhbHVlIGZvciBzYWZlIHVzZSBpbiBhIHNoZWxsIGV4cG9ydCBzdGF0ZW1lbnQuXG4gKlxuICogVXNlcyBzaW5nbGUgcXVvdGVzIGFuZCBlc2NhcGVzIGFueSBlbWJlZGRlZCBzaW5nbGUgcXVvdGVzLlxuICogVGhpcyBwcmV2ZW50cyBzaGVsbCBpbmplY3Rpb24gYW5kIGhhbmRsZXMgc3BlY2lhbCBjaGFyYWN0ZXJzLlxuICogQHBhcmFtIHZhbHVlIC0gVGhlIHZhbHVlIHRvIGVzY2FwZVxuICogQHJldHVybnMgVGhlIHNoZWxsLWVzY2FwZWQgdmFsdWUgKHdpdGggcXVvdGVzKVxuICogQGludGVybmFsXG4gKi9cbmZ1bmN0aW9uIGVzY2FwZVNoZWxsVmFsdWUodmFsdWUpIHtcbiAgICAvLyBVc2Ugc2luZ2xlIHF1b3RlcyBhbmQgZXNjYXBlIGFueSBlbWJlZGRlZCBzaW5nbGUgcXVvdGVzXG4gICAgLy8gJ3ZhbHVlJyAtPiAndmFsJ1xcJyd1ZScgZm9yIHZhbHVlcyBjb250YWluaW5nIHNpbmdsZSBxdW90ZXNcbiAgICBjb25zdCBlc2NhcGVkID0gdmFsdWUucmVwbGFjZSgvJy9nLCBcIidcXFxcJydcIik7XG4gICAgcmV0dXJuIGAnJHtlc2NhcGVkfSdgO1xufVxuIiwgIi8qKlxuICogSG9vayBmYWN0b3J5IGZ1bmN0aW9ucyBmb3IgQ2xhdWRlIENvZGUgaG9va3MuXG4gKlxuICogUHJvdmlkZXMgdHlwZWQgZmFjdG9yeSBmdW5jdGlvbnMgZm9yIGFsbCAxMiBob29rIHR5cGVzIHRoYXQgaGFuZGxlOlxuICogLSBJbnB1dCB0eXBlIG5hcnJvd2luZyBiYXNlZCBvbiBob29rIGV2ZW50IHR5cGVcbiAqIC0gT3V0cHV0IHR5cGUgZW5mb3JjZW1lbnQgdmlhIHJldHVybiB0eXBlc1xuICogLSBFcnJvciB3cmFwcGluZyB3aXRoIGF1dG9tYXRpYyBsb2dnaW5nXG4gKiAtIExvZ2dlciBjb250ZXh0IGluamVjdGlvblxuICpcbiAqIEVhY2ggZmFjdG9yeSBhY2NlcHRzIGEgSG9va0NvbmZpZyB3aXRoIG9wdGlvbmFsIG1hdGNoZXIgYW5kIHRpbWVvdXQgc2V0dGluZ3MsXG4gKiBhbmQgcmV0dXJucyBhIGZ1bmN0aW9uIHRoYXQgdGhlIHJ1bnRpbWUgaW52b2tlcyB3aGVuIHRoZSBob29rIGZpbGUgZXhlY3V0ZXMuXG4gKiBAbW9kdWxlXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgcHJlVG9vbFVzZUhvb2ssIHByZVRvb2xVc2VPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIGV4cG9ydCBkZWZhdWx0IHByZVRvb2xVc2VIb29rKHsgbWF0Y2hlcjogJ0Jhc2gnIH0sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnUHJvY2Vzc2luZyBCYXNoIGNvbW1hbmQnKTtcbiAqICAgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoeyBhbGxvdzogdHJ1ZSB9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3NcbiAqL1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gR2VuZXJpYyBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBob29rIGZhY3RvcnkgZnVuY3Rpb24gZm9yIGEgc3BlY2lmaWMgaG9vayB0eXBlLlxuICpcbiAqIFRoaXMgaXMgdGhlIGludGVybmFsIGltcGxlbWVudGF0aW9uIHVzZWQgYnkgYWxsIHR5cGVkIGZhY3Rvcmllcy5cbiAqIEl0IHdyYXBzIHRoZSBoYW5kbGVyIHdpdGggZXJyb3IgY2F0Y2hpbmcgYW5kIGxvZ2dpbmcuXG4gKiBAcGFyYW0gaG9va0V2ZW50TmFtZSAtIFRoZSBob29rIGV2ZW50IG5hbWVcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb25cbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gd3JhcFxuICogQHJldHVybnMgQSB3cmFwcGVkIGhvb2sgZnVuY3Rpb25cbiAqIEBpbnRlcm5hbFxuICovXG5mdW5jdGlvbiBjcmVhdGVIb29rRnVuY3Rpb24oaG9va0V2ZW50TmFtZSwgY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgY29uc3QgaG9va0ZuID0gYXN5bmMgKGlucHV0LCBjb250ZXh0KSA9PiB7XG4gICAgICAgIC8vIERlbGVnYXRlIGVycm9yIGhhbmRsaW5nIHRvIHRoZSBydW50aW1lIC0ganVzdCBleGVjdXRlIHRoZSBoYW5kbGVyXG4gICAgICAgIC8vIFRoZSBydW50aW1lIHdpbGwgY2F0Y2ggZXJyb3JzLCBsb2cgdGhlbSwgYW5kIHJldHVybiBhcHByb3ByaWF0ZSBvdXRwdXRcbiAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZXIoaW5wdXQsIGNvbnRleHQpO1xuICAgIH07XG4gICAgLy8gQXR0YWNoIG1ldGFkYXRhIGZvciBydW50aW1lIGluc3BlY3Rpb25cbiAgICBob29rRm4uaG9va0V2ZW50TmFtZSA9IGhvb2tFdmVudE5hbWU7XG4gICAgaG9va0ZuLm1hdGNoZXIgPSBjb25maWcubWF0Y2hlcjtcbiAgICBob29rRm4udGltZW91dCA9IGNvbmZpZy50aW1lb3V0O1xuICAgIHJldHVybiBob29rRm47XG59XG4vKiogQGluaGVyaXRkb2MgKi9cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiUHJlVG9vbFVzZVwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLyoqIEBpbmhlcml0ZG9jICovXG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJQb3N0VG9vbFVzZVwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLyoqIEBpbmhlcml0ZG9jICovXG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VGYWlsdXJlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiUG9zdFRvb2xVc2VGYWlsdXJlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBQb3N0VG9vbEJhdGNoIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgUG9zdFRvb2xCYXRjaCBob29rIGhhbmRsZXIuXG4gKlxuICogUG9zdFRvb2xCYXRjaCBob29rcyBmaXJlIGV4YWN0bHkgb25jZSBhZnRlciBldmVyeSB0b29sIGNhbGwgaW4gYSBiYXRjaCBoYXNcbiAqIHJlc29sdmVkLCBiZWZvcmUgdGhlIG5leHQgbW9kZWwgcmVxdWVzdC4gVW5saWtlIFBvc3RUb29sVXNlIFx1MjAxNCB3aGljaCBmaXJlcyBwZXJcbiAqIHRvb2wgYW5kIG1heSBydW4gY29uY3VycmVudGx5IGZvciBwYXJhbGxlbCB0b29sIGNhbGxzIFx1MjAxNCBQb3N0VG9vbEJhdGNoIHJlY2VpdmVzXG4gKiB0aGUgZnVsbCBiYXRjaCB2aWEgYGlucHV0LnRvb2xfY2FsbHNgLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEluc3BlY3Qgb3Igc3VtbWFyaXplIGFsbCB0b29sIGNhbGxzIGluIGEgc2luZ2xlIHR1cm4gdG9nZXRoZXJcbiAqIC0gSW5qZWN0IGFkZGl0aW9uYWwgY29udGV4dCBvbmNlIHBlciBiYXRjaCBpbnN0ZWFkIG9mIG9uY2UgcGVyIHRvb2xcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb25jZSBwZXIgYmF0Y2hcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0IChtYXRjaGVyIGlzIGlnbm9yZWQpXG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBwb3N0VG9vbEJhdGNoSG9vaywgcG9zdFRvb2xCYXRjaE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgcG9zdFRvb2xCYXRjaEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnVG9vbCBiYXRjaCBjb21wbGV0ZWQnLCB7IGNvdW50OiBpbnB1dC50b29sX2NhbGxzLmxlbmd0aCB9KTtcbiAqXG4gKiAgIHJldHVybiBwb3N0VG9vbEJhdGNoT3V0cHV0KHtcbiAqICAgICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBgUmV2aWV3ZWQgJHtpbnB1dC50b29sX2NhbGxzLmxlbmd0aH0gdG9vbCBjYWxsc2BcbiAqICAgICB9XG4gKiAgIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNwb3N0dG9vbGJhdGNoXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbEJhdGNoSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiUG9zdFRvb2xCYXRjaFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gTm90aWZpY2F0aW9uIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgTm90aWZpY2F0aW9uIGhvb2sgaGFuZGxlci5cbiAqXG4gKiBOb3RpZmljYXRpb24gaG9va3MgZmlyZSB3aGVuIENsYXVkZSBDb2RlIHNlbmRzIGEgbm90aWZpY2F0aW9uLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEZvcndhcmQgbm90aWZpY2F0aW9ucyB0byBleHRlcm5hbCBzeXN0ZW1zXG4gKiAtIExvZyBpbXBvcnRhbnQgZXZlbnRzXG4gKiAtIFRyaWdnZXIgY3VzdG9tIGFsZXJ0aW5nXG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgbm90aWZpY2F0aW9uX3R5cGVgXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgbWF0Y2hlciBhbmQgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgbm90aWZpY2F0aW9uSG9vaywgbm90aWZpY2F0aW9uT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBGb3J3YXJkIG5vdGlmaWNhdGlvbnMgdG8gU2xhY2tcbiAqIGV4cG9ydCBkZWZhdWx0IG5vdGlmaWNhdGlvbkhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnTm90aWZpY2F0aW9uIHJlY2VpdmVkJywge1xuICogICAgIHR5cGU6IGlucHV0Lm5vdGlmaWNhdGlvbl90eXBlLFxuICogICAgIHRpdGxlOiBpbnB1dC50aXRsZVxuICogICB9KTtcbiAqXG4gKiAgIGF3YWl0IHNlbmRTbGFja01lc3NhZ2UoaW5wdXQudGl0bGUgPz8gJ05vdGlmaWNhdGlvbicsIGlucHV0Lm1lc3NhZ2UpO1xuICpcbiAqICAgcmV0dXJuIG5vdGlmaWNhdGlvbk91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI25vdGlmaWNhdGlvblxuICovXG5leHBvcnQgZnVuY3Rpb24gbm90aWZpY2F0aW9uSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiTm90aWZpY2F0aW9uXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBVc2VyUHJvbXB0U3VibWl0IEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgVXNlclByb21wdFN1Ym1pdCBob29rIGhhbmRsZXIuXG4gKlxuICogVXNlclByb21wdFN1Ym1pdCBob29rcyBmaXJlIHdoZW4gYSB1c2VyIHN1Ym1pdHMgYSBwcm9tcHQsIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gQWRkIGFkZGl0aW9uYWwgY29udGV4dCBvciBpbnN0cnVjdGlvbnNcbiAqIC0gTG9nIHVzZXIgaW50ZXJhY3Rpb25zXG4gKiAtIFZhbGlkYXRlIG9yIHRyYW5zZm9ybSBwcm9tcHRzXG4gKlxuICogKipNYXRjaGVyKio6IE5vIG1hdGNoZXIgc3VwcG9ydCAtIGZpcmVzIG9uIGFsbCBwcm9tcHQgc3VibWlzc2lvbnNcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0IChtYXRjaGVyIGlzIGlnbm9yZWQpXG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyB1c2VyUHJvbXB0U3VibWl0SG9vaywgdXNlclByb21wdFN1Ym1pdE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gQWRkIHByb2plY3QgY29udGV4dCB0byBldmVyeSBwcm9tcHRcbiAqIGV4cG9ydCBkZWZhdWx0IHVzZXJQcm9tcHRTdWJtaXRIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmRlYnVnKCdVc2VyIHByb21wdCBzdWJtaXR0ZWQnLCB7IHByb21wdExlbmd0aDogaW5wdXQucHJvbXB0Lmxlbmd0aCB9KTtcbiAqXG4gKiAgIGNvbnN0IHByb2plY3RDb250ZXh0ID0gYXdhaXQgZ2V0UHJvamVjdENvbnRleHQoKTtcbiAqXG4gKiAgIHJldHVybiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KHtcbiAqICAgICBhZGRpdGlvbmFsQ29udGV4dDogcHJvamVjdENvbnRleHRcbiAqICAgfSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3VzZXJwcm9tcHRzdWJtaXRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVzZXJQcm9tcHRTdWJtaXRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJVc2VyUHJvbXB0U3VibWl0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBVc2VyUHJvbXB0RXhwYW5zaW9uIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgVXNlclByb21wdEV4cGFuc2lvbiBob29rIGhhbmRsZXIuXG4gKlxuICogVXNlclByb21wdEV4cGFuc2lvbiBob29rcyBmaXJlIHdoZW4gYSB1c2VyIHByb21wdCBpcyBleHBhbmRlZCBmcm9tIGEgc2xhc2hcbiAqIGNvbW1hbmQgb3IgTUNQIHByb21wdCwgYWxsb3dpbmcgeW91IHRvOlxuICogLSBBZGQgY29udGV4dCBiYXNlZCBvbiB0aGUgY29tbWFuZCBiZWluZyBpbnZva2VkXG4gKiAtIExvZyBzbGFzaCBjb21tYW5kIGFuZCBNQ1AgcHJvbXB0IHVzYWdlXG4gKiAtIE9ic2VydmUgcHJvbXB0IGV4cGFuc2lvbiBldmVudHNcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHByb21wdCBleHBhbnNpb25zXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dCAobWF0Y2hlciBpcyBpZ25vcmVkKVxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgdXNlclByb21wdEV4cGFuc2lvbkhvb2ssIHVzZXJQcm9tcHRFeHBhbnNpb25PdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIC8vIEFkZCBjb250ZXh0IHdoZW4gYSBzbGFzaCBjb21tYW5kIGlzIGludm9rZWRcbiAqIGV4cG9ydCBkZWZhdWx0IHVzZXJQcm9tcHRFeHBhbnNpb25Ib29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmRlYnVnKCdQcm9tcHQgZXhwYW5kZWQnLCB7IHR5cGU6IGlucHV0LmV4cGFuc2lvbl90eXBlLCBjb21tYW5kOiBpbnB1dC5jb21tYW5kX25hbWUgfSk7XG4gKlxuICogICByZXR1cm4gdXNlclByb21wdEV4cGFuc2lvbk91dHB1dCh7XG4gKiAgICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogYENvbW1hbmQ6ICR7aW5wdXQuY29tbWFuZF9uYW1lfWBcbiAqICAgICB9XG4gKiAgIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyN1c2VycHJvbXB0ZXhwYW5zaW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB1c2VyUHJvbXB0RXhwYW5zaW9uSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiVXNlclByb21wdEV4cGFuc2lvblwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU2Vzc2lvblN0YXJ0IEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgU2Vzc2lvblN0YXJ0IGhvb2sgaGFuZGxlci5cbiAqXG4gKiBTZXNzaW9uU3RhcnQgaG9va3MgZmlyZSB3aGVuIGEgQ2xhdWRlIENvZGUgc2Vzc2lvbiBzdGFydHMgb3IgcmVzdGFydHMsXG4gKiBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEluaXRpYWxpemUgc2Vzc2lvbiBzdGF0ZVxuICogLSBJbmplY3QgY29udGV4dCBvciBpbnN0cnVjdGlvbnNcbiAqIC0gUGVyc2lzdCBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZm9yIHN1YnNlcXVlbnQgYmFzaCBjb21tYW5kc1xuICogLSBTZXQgdXAgbG9nZ2luZyBvciBtb25pdG9yaW5nXG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgc291cmNlYCAoJ3N0YXJ0dXAnLCAncmVzdW1lJywgJ2NsZWFyJywgJ2NvbXBhY3QnKVxuICpcbiAqICoqQ29udGV4dCoqOiBTZXNzaW9uU3RhcnQgaG9va3MgcmVjZWl2ZSBhbiBleHRlbmRlZCBjb250ZXh0IHdpdGggYHBlcnNpc3RFbnZWYXJgXG4gKiBhbmQgYHBlcnNpc3RFbnZWYXJzYCBmdW5jdGlvbnMgZm9yIHNldHRpbmcgZW52aXJvbm1lbnQgdmFyaWFibGVzLlxuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIG1hdGNoZXIgYW5kIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHNlc3Npb25TdGFydEhvb2ssIHNlc3Npb25TdGFydE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gUGVyc2lzdCBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZm9yIHRoZSBzZXNzaW9uXG4gKiBleHBvcnQgZGVmYXVsdCBzZXNzaW9uU3RhcnRIb29rKHsgbWF0Y2hlcjogJ3N0YXJ0dXAnIH0sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIsIHBlcnNpc3RFbnZWYXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnTmV3IHNlc3Npb24gc3RhcnRlZCcsIHtcbiAqICAgICBzZXNzaW9uSWQ6IGlucHV0LnNlc3Npb25faWQsXG4gKiAgICAgY3dkOiBpbnB1dC5jd2RcbiAqICAgfSk7XG4gKlxuICogICAvLyBTZXQgZW52aXJvbm1lbnQgdmFyaWFibGVzIGZvciBhbGwgc3Vic2VxdWVudCBiYXNoIGNvbW1hbmRzXG4gKiAgIHBlcnNpc3RFbnZWYXIoJ05PREVfRU5WJywgJ2RldmVsb3BtZW50Jyk7XG4gKiAgIHBlcnNpc3RFbnZWYXIoJ0RFQlVHJywgJ3RydWUnKTtcbiAqXG4gKiAgIHJldHVybiBzZXNzaW9uU3RhcnRPdXRwdXQoe30pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBTZXQgbXVsdGlwbGUgZW52aXJvbm1lbnQgdmFyaWFibGVzIGF0IG9uY2VcbiAqIGV4cG9ydCBkZWZhdWx0IHNlc3Npb25TdGFydEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBwZXJzaXN0RW52VmFycyB9KSA9PiB7XG4gKiAgIHBlcnNpc3RFbnZWYXJzKHtcbiAqICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxuICogICAgIEFQSV9LRVk6ICdzZWNyZXQnLFxuICogICAgIERFQlVHOiAnZmFsc2UnXG4gKiAgIH0pO1xuICpcbiAqICAgcmV0dXJuIHNlc3Npb25TdGFydE91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3Nlc3Npb25zdGFydFxuICovXG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiU2Vzc2lvblN0YXJ0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTZXNzaW9uRW5kIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgU2Vzc2lvbkVuZCBob29rIGhhbmRsZXIuXG4gKlxuICogU2Vzc2lvbkVuZCBob29rcyBmaXJlIHdoZW4gYSBDbGF1ZGUgQ29kZSBzZXNzaW9uIGVuZHMsIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gQ2xlYW4gdXAgc2Vzc2lvbiByZXNvdXJjZXNcbiAqIC0gTG9nIHNlc3Npb24gbWV0cmljc1xuICogLSBQZXJzaXN0IHNlc3Npb24gc3RhdGVcbiAqXG4gKiAqKk1hdGNoZXIqKjogTWF0Y2hlcyBhZ2FpbnN0IGByZWFzb25gICh0aGUgZXhpdCByZWFzb24gc3RyaW5nKVxuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIG1hdGNoZXIgYW5kIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHNlc3Npb25FbmRIb29rLCBzZXNzaW9uRW5kT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBMb2cgc2Vzc2lvbiBlbmQgYW5kIGNsZWFuIHVwXG4gKiBleHBvcnQgZGVmYXVsdCBzZXNzaW9uRW5kSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdTZXNzaW9uIGVuZGVkJywge1xuICogICAgIHNlc3Npb25JZDogaW5wdXQuc2Vzc2lvbl9pZCxcbiAqICAgICByZWFzb246IGlucHV0LnJlYXNvblxuICogICB9KTtcbiAqXG4gKiAgIGF3YWl0IGNsZWFudXBTZXNzaW9uUmVzb3VyY2VzKGlucHV0LnNlc3Npb25faWQpO1xuICpcbiAqICAgcmV0dXJuIHNlc3Npb25FbmRPdXRwdXQoe30pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNzZXNzaW9uZW5kXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uRW5kSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiU2Vzc2lvbkVuZFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU3RvcCBIb29rIEZhY3Rvcnlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhIFN0b3AgaG9vayBoYW5kbGVyLlxuICpcbiAqIFN0b3AgaG9va3MgZmlyZSB3aGVuIENsYXVkZSBDb2RlIGlzIGFib3V0IHRvIHN0b3AsIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gQmxvY2sgdGhlIHN0b3AgYW5kIHJlcXVpcmUgYWRkaXRpb25hbCBhY3Rpb25cbiAqIC0gQ29uZmlybSB0aGUgdXNlciB3YW50cyB0byBzdG9wXG4gKiAtIENsZWFuIHVwIHJlc291cmNlcyBiZWZvcmUgc3RvcHBpbmdcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHN0b3AgZXZlbnRzXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dCAobWF0Y2hlciBpcyBpZ25vcmVkKVxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgc3RvcEhvb2ssIHN0b3BPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIC8vIEJsb2NrIHN0b3AgaWYgdGhlcmUgYXJlIHBlbmRpbmcgY2hhbmdlc1xuICogZXhwb3J0IGRlZmF1bHQgc3RvcEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBjb25zdCBwZW5kaW5nQ2hhbmdlcyA9IGF3YWl0IGNoZWNrUGVuZGluZ0NoYW5nZXMoKTtcbiAqXG4gKiAgIGlmIChwZW5kaW5nQ2hhbmdlcy5sZW5ndGggPiAwKSB7XG4gKiAgICAgbG9nZ2VyLndhcm4oJ0Jsb2NraW5nIHN0b3AgZHVlIHRvIHBlbmRpbmcgY2hhbmdlcycsIHtcbiAqICAgICAgIGNvdW50OiBwZW5kaW5nQ2hhbmdlcy5sZW5ndGhcbiAqICAgICB9KTtcbiAqXG4gKiAgICAgcmV0dXJuIHN0b3BPdXRwdXQoe1xuICogICAgICAgZGVjaXNpb246ICdibG9jaycsXG4gKiAgICAgICByZWFzb246IGBUaGVyZSBhcmUgJHtwZW5kaW5nQ2hhbmdlcy5sZW5ndGh9IHVuY29tbWl0dGVkIGNoYW5nZXNgLFxuICogICAgICAgc3lzdGVtTWVzc2FnZTogJ1BsZWFzZSBjb21taXQgb3IgZGlzY2FyZCBjaGFuZ2VzIGJlZm9yZSBzdG9wcGluZydcbiAqICAgICB9KTtcbiAqICAgfVxuICpcbiAqICAgbG9nZ2VyLmluZm8oJ0FwcHJvdmluZyBzdG9wJyk7XG4gKiAgIHJldHVybiBzdG9wT3V0cHV0KHsgZGVjaXNpb246ICdhcHByb3ZlJyB9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3Mjc3RvcFxuICovXG5leHBvcnQgZnVuY3Rpb24gc3RvcEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlN0b3BcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFN0b3BGYWlsdXJlIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgU3RvcEZhaWx1cmUgaG9vayBoYW5kbGVyLlxuICpcbiAqIFN0b3BGYWlsdXJlIGhvb2tzIGZpcmUgd2hlbiBDbGF1ZGUgQ29kZSBlbmNvdW50ZXJzIGFuIGVycm9yIHdoaWxlIHN0b3BwaW5nXG4gKiAoZS5nLiwgQVBJIGVycm9ycywgYXV0aGVudGljYXRpb24gZmFpbHVyZXMsIHJhdGUgbGltaXRzKSwgYWxsb3dpbmcgeW91IHRvOlxuICogLSBMb2cgc3RvcCBmYWlsdXJlIGV2ZW50cyBhbmQgZXJyb3IgZGV0YWlsc1xuICogLSBBbGVydCBvbiB1bmV4cGVjdGVkIHNlc3Npb24gdGVybWluYXRpb24gZXJyb3JzXG4gKiAtIE9ic2VydmUgd2hhdCBlcnJvciBjYXVzZWQgdGhlIGZhaWx1cmVcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHN0b3AgZmFpbHVyZSBldmVudHNcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0IChtYXRjaGVyIGlzIGlnbm9yZWQpXG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBzdG9wRmFpbHVyZUhvb2ssIHN0b3BGYWlsdXJlT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiBleHBvcnQgZGVmYXVsdCBzdG9wRmFpbHVyZUhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuZXJyb3IoJ1Nlc3Npb24gc3RvcHBlZCBkdWUgdG8gZXJyb3InLCB7XG4gKiAgICAgZXJyb3I6IGlucHV0LmVycm9yLFxuICogICAgIGRldGFpbHM6IGlucHV0LmVycm9yX2RldGFpbHNcbiAqICAgfSk7XG4gKiAgIHJldHVybiBzdG9wRmFpbHVyZU91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3N0b3BmYWlsdXJlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdG9wRmFpbHVyZUhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlN0b3BGYWlsdXJlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTdWJhZ2VudFN0YXJ0IEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgU3ViYWdlbnRTdGFydCBob29rIGhhbmRsZXIuXG4gKlxuICogU3ViYWdlbnRTdGFydCBob29rcyBmaXJlIHdoZW4gYSBzdWJhZ2VudCAoQWdlbnQgdG9vbCkgc3RhcnRzLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEluamVjdCBjb250ZXh0IGZvciB0aGUgc3ViYWdlbnRcbiAqIC0gTG9nIHN1YmFnZW50IGludm9jYXRpb25zXG4gKiAtIENvbmZpZ3VyZSBzdWJhZ2VudCBiZWhhdmlvclxuICpcbiAqICoqTWF0Y2hlcioqOiBNYXRjaGVzIGFnYWluc3QgYGFnZW50X3R5cGVgIChlLmcuLCAnZXhwbG9yZScsICdjb2RlYmFzZS1hbmFseXNpcycpXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgbWF0Y2hlciBhbmQgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgc3ViYWdlbnRTdGFydEhvb2ssIHN1YmFnZW50U3RhcnRPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIC8vIEFkZCBjb250ZXh0IGZvciBleHBsb3JlIHN1YmFnZW50c1xuICogZXhwb3J0IGRlZmF1bHQgc3ViYWdlbnRTdGFydEhvb2soeyBtYXRjaGVyOiAnZXhwbG9yZScgfSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdFeHBsb3JlIHN1YmFnZW50IHN0YXJ0aW5nJywge1xuICogICAgIGFnZW50SWQ6IGlucHV0LmFnZW50X2lkLFxuICogICAgIGFnZW50VHlwZTogaW5wdXQuYWdlbnRfdHlwZVxuICogICB9KTtcbiAqXG4gKiAgIHJldHVybiBzdWJhZ2VudFN0YXJ0T3V0cHV0KHtcbiAqICAgICBhZGRpdGlvbmFsQ29udGV4dDogJ0ZvY3VzIG9uIGZpbmRpbmcgcGF0dGVybnMgYW5kIGNvbnZlbnRpb25zJ1xuICogICB9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3Mjc3ViYWdlbnRzdGFydFxuICovXG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlN1YmFnZW50U3RhcnRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFN1YmFnZW50U3RvcCBIb29rIEZhY3Rvcnlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhIFN1YmFnZW50U3RvcCBob29rIGhhbmRsZXIuXG4gKlxuICogU3ViYWdlbnRTdG9wIGhvb2tzIGZpcmUgd2hlbiBhIHN1YmFnZW50IGNvbXBsZXRlcyBvciBzdG9wcywgYWxsb3dpbmcgeW91IHRvOlxuICogLSBCbG9jayB0aGUgc3ViYWdlbnQgZnJvbSBzdG9wcGluZ1xuICogLSBQcm9jZXNzIHN1YmFnZW50IHJlc3VsdHNcbiAqIC0gQ2xlYW4gdXAgc3ViYWdlbnQgcmVzb3VyY2VzXG4gKiAtIExvZyBzdWJhZ2VudCBjb21wbGV0aW9uXG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgYWdlbnRfdHlwZWAgKGUuZy4sICdleHBsb3JlJywgJ2NvZGViYXNlLWFuYWx5c2lzJylcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCBtYXRjaGVyIGFuZCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBzdWJhZ2VudFN0b3BIb29rLCBzdWJhZ2VudFN0b3BPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIC8vIEJsb2NrIGV4cGxvcmUgc3ViYWdlbnRzIGlmIHRhc2sgaW5jb21wbGV0ZVxuICogZXhwb3J0IGRlZmF1bHQgc3ViYWdlbnRTdG9wSG9vayh7IG1hdGNoZXI6ICdleHBsb3JlJyB9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ1N1YmFnZW50IHN0b3BwaW5nJywge1xuICogICAgIGFnZW50SWQ6IGlucHV0LmFnZW50X2lkLFxuICogICAgIGFnZW50VHlwZTogaW5wdXQuYWdlbnRfdHlwZVxuICogICB9KTtcbiAqXG4gKiAgIC8vIEJsb2NrIGlmIHRyYW5zY3JpcHQgc2hvd3MgaW5jb21wbGV0ZSB3b3JrXG4gKiAgIHJldHVybiBzdWJhZ2VudFN0b3BPdXRwdXQoe1xuICogICAgIGRlY2lzaW9uOiAnYmxvY2snLFxuICogICAgIHJlYXNvbjogJ1BsZWFzZSB2ZXJpZnkgZXhwbG9yYXRpb24gaXMgY29tcGxldGUnXG4gKiAgIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNzdWJhZ2VudHN0b3BcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN1YmFnZW50U3RvcEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlN1YmFnZW50U3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUHJlQ29tcGFjdCBIb29rIEZhY3Rvcnlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhIFByZUNvbXBhY3QgaG9vayBoYW5kbGVyLlxuICpcbiAqIFByZUNvbXBhY3QgaG9va3MgZmlyZSBiZWZvcmUgY29udGV4dCBjb21wYWN0aW9uIG9jY3VycywgYWxsb3dpbmcgeW91IHRvOlxuICogLSBQcmVzZXJ2ZSBpbXBvcnRhbnQgaW5mb3JtYXRpb24gYmVmb3JlIGNvbXBhY3Rpb25cbiAqIC0gTG9nIGNvbXBhY3Rpb24gZXZlbnRzXG4gKiAtIE1vZGlmeSBjdXN0b20gaW5zdHJ1Y3Rpb25zIGZvciB0aGUgY29tcGFjdGVkIGNvbnRleHRcbiAqXG4gKiAqKk1hdGNoZXIqKjogTWF0Y2hlcyBhZ2FpbnN0IGB0cmlnZ2VyYCAoJ21hbnVhbCcsICdhdXRvJylcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCBtYXRjaGVyIGFuZCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBwcmVDb21wYWN0SG9vaywgcHJlQ29tcGFjdE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gTG9nIGNvbXBhY3Rpb24gZXZlbnRzIGFuZCBwcmVzZXJ2ZSBjb250ZXh0XG4gKiBleHBvcnQgZGVmYXVsdCBwcmVDb21wYWN0SG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdDb250ZXh0IGNvbXBhY3Rpb24gdHJpZ2dlcmVkJywge1xuICogICAgIHRyaWdnZXI6IGlucHV0LnRyaWdnZXIsXG4gKiAgICAgaGFzQ3VzdG9tSW5zdHJ1Y3Rpb25zOiBpbnB1dC5jdXN0b21faW5zdHJ1Y3Rpb25zICE9PSBudWxsXG4gKiAgIH0pO1xuICpcbiAqICAgcmV0dXJuIHByZUNvbXBhY3RPdXRwdXQoe1xuICogICAgIHN5c3RlbU1lc3NhZ2U6ICdSZW1lbWJlcjogc3RyaWN0IG1vZGUgaXMgZW5hYmxlZCdcbiAqICAgfSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIE9ubHkgaGFuZGxlIG1hbnVhbCBjb21wYWN0aW9uXG4gKiBleHBvcnQgZGVmYXVsdCBwcmVDb21wYWN0SG9vayh7IG1hdGNoZXI6ICdtYW51YWwnIH0sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnTWFudWFsIGNvbXBhY3Rpb24gcmVxdWVzdGVkJyk7XG4gKiAgIHJldHVybiBwcmVDb21wYWN0T3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjcHJlY29tcGFjdFxuICovXG5leHBvcnQgZnVuY3Rpb24gcHJlQ29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlByZUNvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFBvc3RDb21wYWN0IEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgUG9zdENvbXBhY3QgaG9vayBoYW5kbGVyLlxuICpcbiAqIFBvc3RDb21wYWN0IGhvb2tzIGZpcmUgYWZ0ZXIgY29udGV4dCBjb21wYWN0aW9uIGNvbXBsZXRlcywgYWxsb3dpbmcgeW91IHRvOlxuICogLSBPYnNlcnZlIHRoZSBjb21wYWN0aW9uIHN1bW1hcnkgYW5kIGRldGFpbHNcbiAqIC0gTG9nIGNvbXBhY3Rpb24gZXZlbnRzXG4gKiAtIFJlYWN0IHRvIHRoZSBuZXcgY29tcGFjdGVkIHN0YXRlXG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgdHJpZ2dlcmAgKCdtYW51YWwnLCAnYXV0bycpXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgbWF0Y2hlciBhbmQgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgcG9zdENvbXBhY3RIb29rLCBwb3N0Q29tcGFjdE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgcG9zdENvbXBhY3RIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ0NvbnRleHQgY29tcGFjdGlvbiBjb21wbGV0ZWQnLCB7XG4gKiAgICAgdHJpZ2dlcjogaW5wdXQudHJpZ2dlcixcbiAqICAgICBzdW1tYXJ5OiBpbnB1dC5jb21wYWN0X3N1bW1hcnlcbiAqICAgfSk7XG4gKiAgIHJldHVybiBwb3N0Q29tcGFjdE91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3Bvc3Rjb21wYWN0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlBvc3RDb21wYWN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vKiogQGluaGVyaXRkb2MgKi9cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uUmVxdWVzdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBQZXJtaXNzaW9uRGVuaWVkIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgUGVybWlzc2lvbkRlbmllZCBob29rIGhhbmRsZXIuXG4gKlxuICogUGVybWlzc2lvbkRlbmllZCBob29rcyBmaXJlIHdoZW4gYSBwZXJtaXNzaW9uIHJlcXVlc3QgaXMgZGVuaWVkIChlaXRoZXIgYnkgdGhlXG4gKiB1c2VyIG9yIGJ5IGEgUGVybWlzc2lvblJlcXVlc3QgaG9vayksIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gTG9nIHBlcm1pc3Npb24gZGVuaWFscyBmb3IgYXVkaXRpbmdcbiAqIC0gUmVhY3QgdG8gZGVuaWVkIHRvb2wgZXhlY3V0aW9uc1xuICogLSBPcHRpb25hbGx5IHJlcXVlc3QgYSByZXRyeSB2aWEgdGhlIG91dHB1dFxuICpcbiAqICoqTWF0Y2hlcioqOiBNYXRjaGVzIGFnYWluc3QgYHRvb2xfbmFtZWBcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCBtYXRjaGVyIGFuZCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBwZXJtaXNzaW9uRGVuaWVkSG9vaywgcGVybWlzc2lvbkRlbmllZE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gTG9nIGFsbCBwZXJtaXNzaW9uIGRlbmlhbHNcbiAqIGV4cG9ydCBkZWZhdWx0IHBlcm1pc3Npb25EZW5pZWRIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLndhcm4oJ1Blcm1pc3Npb24gZGVuaWVkJywge1xuICogICAgIHRvb2xOYW1lOiBpbnB1dC50b29sX25hbWUsXG4gKiAgICAgcmVhc29uOiBpbnB1dC5yZWFzb25cbiAqICAgfSk7XG4gKiAgIHJldHVybiBwZXJtaXNzaW9uRGVuaWVkT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjcGVybWlzc2lvbmRlbmllZFxuICovXG5leHBvcnQgZnVuY3Rpb24gcGVybWlzc2lvbkRlbmllZEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlBlcm1pc3Npb25EZW5pZWRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNldHVwIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgU2V0dXAgaG9vayBoYW5kbGVyLlxuICpcbiAqIFNldHVwIGhvb2tzIGZpcmUgZHVyaW5nIGluaXRpYWxpemF0aW9uIG9yIG1haW50ZW5hbmNlLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIENvbmZpZ3VyZSBpbml0aWFsIHNlc3Npb24gc3RhdGVcbiAqIC0gUGVyZm9ybSBzZXR1cCB0YXNrcyBiZWZvcmUgdGhlIHNlc3Npb24gc3RhcnRzXG4gKiAtIEFkZCBjb250ZXh0IGZvciBtYWludGVuYW5jZSBvcGVyYXRpb25zXG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgdHJpZ2dlcmAgKCdpbml0JyBvciAnbWFpbnRlbmFuY2UnKVxuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIG1hdGNoZXIgYW5kIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHNldHVwSG9vaywgc2V0dXBPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIC8vIEhhbmRsZSBhbGwgc2V0dXAgZXZlbnRzXG4gKiBleHBvcnQgZGVmYXVsdCBzZXR1cEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnU2V0dXAgdHJpZ2dlcmVkJywgeyB0cmlnZ2VyOiBpbnB1dC50cmlnZ2VyIH0pO1xuICogICByZXR1cm4gc2V0dXBPdXRwdXQoe30pO1xuICogfSk7XG4gKlxuICogLy8gT25seSBoYW5kbGUgaW5pdGlhbGl6YXRpb25cbiAqIGV4cG9ydCBkZWZhdWx0IHNldHVwSG9vayh7IG1hdGNoZXI6ICdpbml0JyB9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ0luaXRpYWxpemluZyBzZXNzaW9uJyk7XG4gKiAgIHJldHVybiBzZXR1cE91dHB1dCh7XG4gKiAgICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogJ1Nlc3Npb24gaW5pdGlhbGl6ZWQgd2l0aCBjdXN0b20gY29uZmlndXJhdGlvbidcbiAqICAgICB9XG4gKiAgIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNzZXR1cFxuICovXG5leHBvcnQgZnVuY3Rpb24gc2V0dXBIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJTZXR1cFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVGVhbW1hdGVJZGxlIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgVGVhbW1hdGVJZGxlIGhvb2sgaGFuZGxlci5cbiAqXG4gKiBUZWFtbWF0ZUlkbGUgaG9va3MgZmlyZSB3aGVuIGEgdGVhbW1hdGUgaW4gYSB0ZWFtIGlzIGFib3V0IHRvIGdvIGlkbGUsXG4gKiBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEFzc2lnbiB3b3JrIHRvIGlkbGUgdGVhbW1hdGVzXG4gKiAtIExvZyB0ZWFtIGFjdGl2aXR5XG4gKiAtIENvb3JkaW5hdGUgbXVsdGktYWdlbnQgd29ya2Zsb3dzXG4gKlxuICogKipNYXRjaGVyKio6IE5vIG1hdGNoZXIgc3VwcG9ydCAtIGZpcmVzIG9uIGFsbCB0ZWFtbWF0ZSBpZGxlIGV2ZW50c1xuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIHRpbWVvdXQgKG1hdGNoZXIgaXMgaWdub3JlZClcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHRlYW1tYXRlSWRsZUhvb2ssIHRlYW1tYXRlSWRsZU91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gTG9nIHdoZW4gdGVhbW1hdGVzIGdvIGlkbGVcbiAqIGV4cG9ydCBkZWZhdWx0IHRlYW1tYXRlSWRsZUhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnVGVhbW1hdGUgZ29pbmcgaWRsZScsIHtcbiAqICAgICB0ZWFtbWF0ZU5hbWU6IGlucHV0LnRlYW1tYXRlX25hbWUsXG4gKiAgICAgdGVhbU5hbWU6IGlucHV0LnRlYW1fbmFtZVxuICogICB9KTtcbiAqXG4gKiAgIHJldHVybiB0ZWFtbWF0ZUlkbGVPdXRwdXQoe30pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyN0ZWFtbWF0ZWlkbGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRlYW1tYXRlSWRsZUhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlRlYW1tYXRlSWRsZVwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVGFza0NyZWF0ZWQgSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBUYXNrQ3JlYXRlZCBob29rIGhhbmRsZXIuXG4gKlxuICogVGFza0NyZWF0ZWQgaG9va3MgZmlyZSB3aGVuIGEgbmV3IHRhc2sgaXMgY3JlYXRlZCBhbmQgYXNzaWduZWQgdG8gYSB0ZWFtbWF0ZSxcbiAqIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gT2JzZXJ2ZSB0YXNrIGNyZWF0aW9uIGV2ZW50c1xuICogLSBMb2cgdGFzayBhc3NpZ25tZW50cyBmb3IgYXVkaXRpbmdcbiAqIC0gUmVhY3QgdG8gbmV3IHdvcmsgYmVpbmcgYXNzaWduZWRcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHRhc2sgY3JlYXRpb24gZXZlbnRzXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dCAobWF0Y2hlciBpcyBpZ25vcmVkKVxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgdGFza0NyZWF0ZWRIb29rLCB0YXNrQ3JlYXRlZE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gTG9nIHRhc2sgY3JlYXRpb25cbiAqIGV4cG9ydCBkZWZhdWx0IHRhc2tDcmVhdGVkSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdUYXNrIGNyZWF0ZWQnLCB7XG4gKiAgICAgdGFza0lkOiBpbnB1dC50YXNrX2lkLFxuICogICAgIHRhc2tTdWJqZWN0OiBpbnB1dC50YXNrX3N1YmplY3RcbiAqICAgfSk7XG4gKlxuICogICByZXR1cm4gdGFza0NyZWF0ZWRPdXRwdXQoe30pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyN0YXNrY3JlYXRlZFxuICovXG5leHBvcnQgZnVuY3Rpb24gdGFza0NyZWF0ZWRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJUYXNrQ3JlYXRlZFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVGFza0NvbXBsZXRlZCBIb29rIEZhY3Rvcnlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhIFRhc2tDb21wbGV0ZWQgaG9vayBoYW5kbGVyLlxuICpcbiAqIFRhc2tDb21wbGV0ZWQgaG9va3MgZmlyZSB3aGVuIGEgdGFzayBpcyBiZWluZyBtYXJrZWQgYXMgY29tcGxldGVkLFxuICogYWxsb3dpbmcgeW91IHRvOlxuICogLSBWZXJpZnkgdGFzayBjb21wbGV0aW9uXG4gKiAtIExvZyB0YXNrIG1ldHJpY3NcbiAqIC0gVHJpZ2dlciBmb2xsb3ctdXAgYWN0aW9uc1xuICpcbiAqICoqTWF0Y2hlcioqOiBObyBtYXRjaGVyIHN1cHBvcnQgLSBmaXJlcyBvbiBhbGwgdGFzayBjb21wbGV0aW9uIGV2ZW50c1xuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIHRpbWVvdXQgKG1hdGNoZXIgaXMgaWdub3JlZClcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHRhc2tDb21wbGV0ZWRIb29rLCB0YXNrQ29tcGxldGVkT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBMb2cgdGFzayBjb21wbGV0aW9uXG4gKiBleHBvcnQgZGVmYXVsdCB0YXNrQ29tcGxldGVkSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdUYXNrIGNvbXBsZXRlZCcsIHtcbiAqICAgICB0YXNrSWQ6IGlucHV0LnRhc2tfaWQsXG4gKiAgICAgdGFza1N1YmplY3Q6IGlucHV0LnRhc2tfc3ViamVjdFxuICogICB9KTtcbiAqXG4gKiAgIHJldHVybiB0YXNrQ29tcGxldGVkT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjdGFza2NvbXBsZXRlZFxuICovXG5leHBvcnQgZnVuY3Rpb24gdGFza0NvbXBsZXRlZEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlRhc2tDb21wbGV0ZWRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEVsaWNpdGF0aW9uIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGFuIEVsaWNpdGF0aW9uIGhvb2sgaGFuZGxlci5cbiAqXG4gKiBFbGljaXRhdGlvbiBob29rcyBmaXJlIHdoZW4gYW4gTUNQIHNlcnZlciByZXF1ZXN0cyB1c2VyIGlucHV0LCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEFjY2VwdCwgZGVjbGluZSwgb3IgY2FuY2VsIGVsaWNpdGF0aW9uIHJlcXVlc3RzIHByb2dyYW1tYXRpY2FsbHlcbiAqIC0gUHJvdmlkZSBzdHJ1Y3R1cmVkIGZvcm0gaW5wdXQgb3IgVVJMLWJhc2VkIGF1dGggcmVzcG9uc2VzXG4gKiAtIExvZyBvciBhdWRpdCBlbGljaXRhdGlvbiByZXF1ZXN0c1xuICpcbiAqICoqTWF0Y2hlcioqOiBObyBtYXRjaGVyIHN1cHBvcnQgLSBmaXJlcyBvbiBhbGwgZWxpY2l0YXRpb24gZXZlbnRzXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgZWxpY2l0YXRpb25Ib29rLCBlbGljaXRhdGlvbk91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgZWxpY2l0YXRpb25Ib29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ0VsaWNpdGF0aW9uIHJlcXVlc3QnLCB7IHNlcnZlcjogaW5wdXQubWNwX3NlcnZlcl9uYW1lIH0pO1xuICogICByZXR1cm4gZWxpY2l0YXRpb25PdXRwdXQoe1xuICogICAgIGhvb2tTcGVjaWZpY091dHB1dDogeyBhY3Rpb246ICdhY2NlcHQnLCBjb250ZW50OiB7IGFwcHJvdmVkOiB0cnVlIH0gfVxuICogICB9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjZWxpY2l0YXRpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVsaWNpdGF0aW9uSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiRWxpY2l0YXRpb25cIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEVsaWNpdGF0aW9uUmVzdWx0IEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGFuIEVsaWNpdGF0aW9uUmVzdWx0IGhvb2sgaGFuZGxlci5cbiAqXG4gKiBFbGljaXRhdGlvblJlc3VsdCBob29rcyBmaXJlIHdpdGggdGhlIHJlc3VsdCBvZiBhbiBNQ1AgZWxpY2l0YXRpb24gcmVxdWVzdCxcbiAqIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gT2JzZXJ2ZSBlbGljaXRhdGlvbiBvdXRjb21lc1xuICogLSBNb2RpZnkgdGhlIHJlc3VsdCBiZWZvcmUgaXQgaXMgcmV0dXJuZWQgdG8gdGhlIE1DUCBzZXJ2ZXJcbiAqIC0gTG9nIGVsaWNpdGF0aW9uIGNvbXBsZXRpb25zXG4gKlxuICogKipNYXRjaGVyKio6IE5vIG1hdGNoZXIgc3VwcG9ydCAtIGZpcmVzIG9uIGFsbCBlbGljaXRhdGlvbiByZXN1bHQgZXZlbnRzXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgZWxpY2l0YXRpb25SZXN1bHRIb29rLCBlbGljaXRhdGlvblJlc3VsdE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgZWxpY2l0YXRpb25SZXN1bHRIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ0VsaWNpdGF0aW9uIHJlc3VsdCcsIHsgYWN0aW9uOiBpbnB1dC5hY3Rpb24gfSk7XG4gKiAgIHJldHVybiBlbGljaXRhdGlvblJlc3VsdE91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI2VsaWNpdGF0aW9ucmVzdWx0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbGljaXRhdGlvblJlc3VsdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIkVsaWNpdGF0aW9uUmVzdWx0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBDb25maWdDaGFuZ2UgSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBDb25maWdDaGFuZ2UgaG9vayBoYW5kbGVyLlxuICpcbiAqIENvbmZpZ0NoYW5nZSBob29rcyBmaXJlIHdoZW4gQ2xhdWRlIENvZGUgY29uZmlndXJhdGlvbiBjaGFuZ2VzLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIFJlYWN0IHRvIHNldHRpbmdzIGZpbGUgY2hhbmdlc1xuICogLSBMb2cgb3IgYXVkaXQgY29uZmlndXJhdGlvbiBjaGFuZ2VzXG4gKiAtIEFwcGx5IGN1c3RvbSBsb2dpYyB3aGVuIHNldHRpbmdzIGFyZSB1cGRhdGVkXG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgc291cmNlYCAoJ3VzZXJfc2V0dGluZ3MnLCAncHJvamVjdF9zZXR0aW5ncycsIGV0Yy4pXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgbWF0Y2hlciBhbmQgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgY29uZmlnQ2hhbmdlSG9vaywgY29uZmlnQ2hhbmdlT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiBleHBvcnQgZGVmYXVsdCBjb25maWdDaGFuZ2VIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ0NvbmZpZyBjaGFuZ2VkJywgeyBzb3VyY2U6IGlucHV0LnNvdXJjZSwgZmlsZTogaW5wdXQuZmlsZV9wYXRoIH0pO1xuICogICByZXR1cm4gY29uZmlnQ2hhbmdlT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjY29uZmlnY2hhbmdlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb25maWdDaGFuZ2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJDb25maWdDaGFuZ2VcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEluc3RydWN0aW9uc0xvYWRlZCBIb29rIEZhY3Rvcnlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhbiBJbnN0cnVjdGlvbnNMb2FkZWQgaG9vayBoYW5kbGVyLlxuICpcbiAqIEluc3RydWN0aW9uc0xvYWRlZCBob29rcyBmaXJlIHdoZW4gYSBDTEFVREUubWQgb3Igc2ltaWxhciBpbnN0cnVjdGlvbnMgZmlsZVxuICogaXMgbG9hZGVkLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIFJlYWN0IHRvIGluc3RydWN0aW9ucyBiZWluZyBhcHBsaWVkXG4gKiAtIExvZyB3aGljaCBpbnN0cnVjdGlvbiBmaWxlcyBhcmUgYWN0aXZlXG4gKiAtIE9ic2VydmUgdGhlIGluc3RydWN0aW9uIGxvYWRpbmcgaGllcmFyY2h5XG4gKlxuICogKipNYXRjaGVyKio6IE5vIG1hdGNoZXIgc3VwcG9ydCAtIGZpcmVzIG9uIGFsbCBpbnN0cnVjdGlvbiBsb2FkIGV2ZW50c1xuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IGluc3RydWN0aW9uc0xvYWRlZEhvb2ssIGluc3RydWN0aW9uc0xvYWRlZE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgaW5zdHJ1Y3Rpb25zTG9hZGVkSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdJbnN0cnVjdGlvbnMgbG9hZGVkJywgeyBmaWxlOiBpbnB1dC5maWxlX3BhdGgsIHR5cGU6IGlucHV0Lm1lbW9yeV90eXBlIH0pO1xuICogICByZXR1cm4gaW5zdHJ1Y3Rpb25zTG9hZGVkT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjaW5zdHJ1Y3Rpb25zbG9hZGVkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpbnN0cnVjdGlvbnNMb2FkZWRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJJbnN0cnVjdGlvbnNMb2FkZWRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFdvcmt0cmVlQ3JlYXRlIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgV29ya3RyZWVDcmVhdGUgaG9vayBoYW5kbGVyLlxuICpcbiAqIFdvcmt0cmVlQ3JlYXRlIGhvb2tzIGZpcmUgd2hlbiBhIGdpdCB3b3JrdHJlZSBpcyBjcmVhdGVkLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIFNldCB1cCB3b3JrdHJlZS1zcGVjaWZpYyBjb25maWd1cmF0aW9uXG4gKiAtIExvZyB3b3JrdHJlZSBjcmVhdGlvbiBldmVudHNcbiAqIC0gSW5pdGlhbGl6ZSB3b3JrdHJlZSByZXNvdXJjZXNcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHdvcmt0cmVlIGNyZWF0aW9uIGV2ZW50c1xuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHdvcmt0cmVlQ3JlYXRlSG9vaywgd29ya3RyZWVDcmVhdGVPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIGV4cG9ydCBkZWZhdWx0IHdvcmt0cmVlQ3JlYXRlSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGNvbnN0IHdvcmt0cmVlUGF0aCA9IGAke2lucHV0LmN3ZH0vLndvcmt0cmVlcy8ke2lucHV0Lm5hbWV9YDtcbiAqICAgbG9nZ2VyLmluZm8oJ1dvcmt0cmVlIGNyZWF0ZWQnLCB7IG5hbWU6IGlucHV0Lm5hbWUsIHdvcmt0cmVlUGF0aCB9KTtcbiAqICAgLy8gV29ya3RyZWVDcmVhdGUgaXMgYSBjb21tYW5kIGhvb2s6IHRoZSBwYXRoIGlzIHdyaXR0ZW4gdG8gc3Rkb3V0IGFzIHBsYWluIHRleHQuXG4gKiAgIHJldHVybiB3b3JrdHJlZUNyZWF0ZU91dHB1dCh7IHdvcmt0cmVlUGF0aCB9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3Mjd29ya3RyZWVjcmVhdGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHdvcmt0cmVlQ3JlYXRlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiV29ya3RyZWVDcmVhdGVcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFdvcmt0cmVlUmVtb3ZlIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgV29ya3RyZWVSZW1vdmUgaG9vayBoYW5kbGVyLlxuICpcbiAqIFdvcmt0cmVlUmVtb3ZlIGhvb2tzIGZpcmUgd2hlbiBhIGdpdCB3b3JrdHJlZSBpcyByZW1vdmVkLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIENsZWFuIHVwIHdvcmt0cmVlLXNwZWNpZmljIHJlc291cmNlc1xuICogLSBMb2cgd29ya3RyZWUgcmVtb3ZhbCBldmVudHNcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHdvcmt0cmVlIHJlbW92YWwgZXZlbnRzXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgd29ya3RyZWVSZW1vdmVIb29rLCB3b3JrdHJlZVJlbW92ZU91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgd29ya3RyZWVSZW1vdmVIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ1dvcmt0cmVlIHJlbW92ZWQnLCB7IHBhdGg6IGlucHV0Lndvcmt0cmVlX3BhdGggfSk7XG4gKiAgIHJldHVybiB3b3JrdHJlZVJlbW92ZU91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3dvcmt0cmVlcmVtb3ZlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB3b3JrdHJlZVJlbW92ZUhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIldvcmt0cmVlUmVtb3ZlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBDd2RDaGFuZ2VkIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgQ3dkQ2hhbmdlZCBob29rIGhhbmRsZXIuXG4gKlxuICogQ3dkQ2hhbmdlZCBob29rcyBmaXJlIHdoZW4gQ2xhdWRlIENvZGUncyBjdXJyZW50IHdvcmtpbmcgZGlyZWN0b3J5IGNoYW5nZXMsXG4gKiBhbGxvd2luZyB5b3UgdG86XG4gKiAtIFJlYWN0IHRvIGRpcmVjdG9yeSBjaGFuZ2VzIHdpdGhpbiBhIHNlc3Npb25cbiAqIC0gVXBkYXRlIGZpbGUgd2F0Y2hlcnMgb3IgZW52aXJvbm1lbnQgc3RhdGVcbiAqIC0gUmV0dXJuIGB3YXRjaFBhdGhzYCB2aWEgYGhvb2tTcGVjaWZpY091dHB1dGAgdG8gcmVnaXN0ZXIgcGF0aHMgZm9yIEZpbGVDaGFuZ2VkIGV2ZW50c1xuICpcbiAqICoqTWF0Y2hlcioqOiBObyBtYXRjaGVyIHN1cHBvcnQgLSBmaXJlcyBvbiBhbGwgY3dkIGNoYW5nZSBldmVudHNcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBjd2RDaGFuZ2VkSG9vaywgY3dkQ2hhbmdlZE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgY3dkQ2hhbmdlZEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnV29ya2luZyBkaXJlY3RvcnkgY2hhbmdlZCcsIHsgZnJvbTogaW5wdXQub2xkX2N3ZCwgdG86IGlucHV0Lm5ld19jd2QgfSk7XG4gKiAgIHJldHVybiBjd2RDaGFuZ2VkT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjY3dkY2hhbmdlZFxuICovXG5leHBvcnQgZnVuY3Rpb24gY3dkQ2hhbmdlZEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIkN3ZENoYW5nZWRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEZpbGVDaGFuZ2VkIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgRmlsZUNoYW5nZWQgaG9vayBoYW5kbGVyLlxuICpcbiAqIEZpbGVDaGFuZ2VkIGhvb2tzIGZpcmUgd2hlbiBhIHdhdGNoZWQgZmlsZSBjaGFuZ2VzIG9uIGRpc2ssIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gUmVhY3QgdG8gZmlsZSBzeXN0ZW0gY2hhbmdlcyBkdXJpbmcgYSBzZXNzaW9uXG4gKiAtIEludmFsaWRhdGUgY2FjaGVzIG9yIHJlbG9hZCBjb25maWd1cmF0aW9uXG4gKiAtIFJldHVybiBgd2F0Y2hQYXRoc2AgdmlhIGBob29rU3BlY2lmaWNPdXRwdXRgIHRvIHVwZGF0ZSB0aGUgc2V0IG9mIHdhdGNoZWQgcGF0aHNcbiAqXG4gKiBUaGUgaW5wdXQgYGV2ZW50YCBmaWVsZCBpbmRpY2F0ZXMgdGhlIHR5cGUgb2YgY2hhbmdlOlxuICogLSBgJ2NoYW5nZSdgIC0gRmlsZSBjb250ZW50cyBjaGFuZ2VkXG4gKiAtIGAnYWRkJ2AgLSBGaWxlIHdhcyBjcmVhdGVkXG4gKiAtIGAndW5saW5rJ2AgLSBGaWxlIHdhcyBkZWxldGVkXG4gKlxuICogKipNYXRjaGVyKio6IE5vIG1hdGNoZXIgc3VwcG9ydCAtIGZpcmVzIG9uIGFsbCBmaWxlIGNoYW5nZSBldmVudHNcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBmaWxlQ2hhbmdlZEhvb2ssIGZpbGVDaGFuZ2VkT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiBleHBvcnQgZGVmYXVsdCBmaWxlQ2hhbmdlZEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnRmlsZSBjaGFuZ2VkJywgeyBwYXRoOiBpbnB1dC5maWxlX3BhdGgsIGV2ZW50OiBpbnB1dC5ldmVudCB9KTtcbiAqICAgcmV0dXJuIGZpbGVDaGFuZ2VkT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjZmlsZWNoYW5nZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZpbGVDaGFuZ2VkSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiRmlsZUNoYW5nZWRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIE1lc3NhZ2VEaXNwbGF5IEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgTWVzc2FnZURpc3BsYXkgaG9vayBoYW5kbGVyLlxuICpcbiAqIE1lc3NhZ2VEaXNwbGF5IGhvb2tzIGZpcmUgd2l0aCBlYWNoIGJhdGNoIG9mIG5ld2x5IGNvbXBsZXRlZCBsaW5lcyB3aGlsZSBhblxuICogYXNzaXN0YW50IG1lc3NhZ2Ugc3RyZWFtcy4gRGlzcGxheS1vbmx5OiB0aGUgc3RvcmVkIG1lc3NhZ2UgYW5kIHdoYXQgdGhlIG1vZGVsXG4gKiBzZWVzIGFyZSB1bnRvdWNoZWQuIEFsbG93cyB5b3UgdG86XG4gKiAtIFJlcGxhY2UgdGhlIGRlbHRhIHNob3duIG9uIHNjcmVlbiB3aXRoIGN1c3RvbSBjb250ZW50IHZpYSBgZGlzcGxheUNvbnRlbnRgXG4gKiAtIE9ic2VydmUgYW5kIGxvZyBtZXNzYWdlIHN0cmVhbWluZyBldmVudHNcbiAqXG4gKiBUaGUgaW5wdXQgY2FycmllcyBgdHVybl9pZGAsIGBtZXNzYWdlX2lkYCwgYGluZGV4YCwgYGZpbmFsYCwgYW5kIGBkZWx0YWAgZmllbGRzLlxuICogVGhlIGBmaW5hbGAgZmxhZyBpbmRpY2F0ZXMgdGhlIGxhc3QgZmx1c2ggb2YgYSBtZXNzYWdlIFx1MjAxNCBpdHMgYGRlbHRhYCBpcyBlbXB0eVxuICogd2hlbiB0aGUgbWVzc2FnZSBlbmRzIG9uIGEgbmV3bGluZTsgdHJlYXQgYGZpbmFsYCBhcyB0aGUgZW5kLW9mLW1lc3NhZ2Ugc2lnbmFsLlxuICpcbiAqICoqTWF0Y2hlcioqOiBObyBtYXRjaGVyIHN1cHBvcnQgLSBmaXJlcyBvbiBhbGwgbWVzc2FnZSBkaXNwbGF5IGV2ZW50c1xuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IG1lc3NhZ2VEaXNwbGF5SG9vaywgbWVzc2FnZURpc3BsYXlPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIGV4cG9ydCBkZWZhdWx0IG1lc3NhZ2VEaXNwbGF5SG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGlmIChpbnB1dC5maW5hbCkge1xuICogICAgIGxvZ2dlci5pbmZvKCdNZXNzYWdlIGNvbXBsZXRlJywgeyBtZXNzYWdlSWQ6IGlucHV0Lm1lc3NhZ2VfaWQgfSk7XG4gKiAgIH1cbiAqICAgcmV0dXJuIG1lc3NhZ2VEaXNwbGF5T3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjbWVzc2FnZWRpc3BsYXlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lc3NhZ2VEaXNwbGF5SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiTWVzc2FnZURpc3BsYXlcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbiIsICIvKipcbiAqIExvZ2dlciBzeXN0ZW0gZm9yIENsYXVkZSBDb2RlIGhvb2tzLlxuICpcbiAqIFByb3ZpZGVzIHN0cnVjdHVyZWQgbG9nZ2luZyB3aXRoIGV2ZW50IHN1YnNjcmlwdGlvbiBhbmQgb3B0aW9uYWwgZmlsZSBvdXRwdXQuXG4gKiBUaGUgbG9nZ2VyIGlzICoqc2lsZW50IGJ5IGRlZmF1bHQqKiB0byBhdm9pZCBpbnRlcmZlcmluZyB3aXRoIGhvb2sgcHJvdG9jb2xcbiAqIChzdGRvdXQgaXMgcmVzZXJ2ZWQgZm9yIEpTT04gcmVzcG9uc2VzLCBzdGRlcnIgbWF5IGNvbmZsaWN0IHdpdGggQ2xhdWRlIENvZGUpLlxuICogQG1vZHVsZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IGxvZ2dlciB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gU3Vic2NyaWJlIHRvIGxvZyBldmVudHNcbiAqIGNvbnN0IHVuc3Vic2NyaWJlID0gbG9nZ2VyLm9uKCdlcnJvcicsIChldmVudCkgPT4ge1xuICogICBjb25zb2xlLmVycm9yKGBFcnJvciBpbiAke2V2ZW50Lmhvb2tUeXBlfTogJHtldmVudC5tZXNzYWdlfWApO1xuICogfSk7XG4gKlxuICogLy8gTGF0ZXIsIGNsZWFuIHVwXG4gKiB1bnN1YnNjcmliZSgpO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3NcbiAqL1xuaW1wb3J0IHsgY2xvc2VTeW5jLCBleGlzdHNTeW5jLCBta2RpclN5bmMsIG9wZW5TeW5jLCB3cml0ZVN5bmMgfSBmcm9tIFwibm9kZTpmc1wiO1xuaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gXCJub2RlOnBhdGhcIjtcbi8qKlxuICogQWxsIGxvZyBsZXZlbHMgaW4gb3JkZXIgb2Ygc2V2ZXJpdHkgKGxvd2VzdCB0byBoaWdoZXN0KS5cbiAqL1xuZXhwb3J0IGNvbnN0IExPR19MRVZFTFMgPSBbXCJkZWJ1Z1wiLCBcImluZm9cIiwgXCJ3YXJuXCIsIFwiZXJyb3JcIl07XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBMb2dnZXIgQ2xhc3Ncbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogTG9nZ2VyIGZvciBDbGF1ZGUgQ29kZSBob29rcyB3aXRoIGV2ZW50IHN1YnNjcmlwdGlvbiBhbmQgZmlsZSBvdXRwdXQuXG4gKlxuICogIyMgS2V5IEJlaGF2aW9yc1xuICpcbiAqIHwgQ29uZmlndXJhdGlvbiB8IEJlaGF2aW9yIHxcbiAqIHwtLS0tLS0tLS0tLS0tLXwtLS0tLS0tLS0tfFxuICogfCBObyBjb25maWcgKGRlZmF1bHQpIHwgKipTaWxlbnQqKiAtIG5vIG91dHB1dCBhbnl3aGVyZSB8XG4gKiB8IGBDTEFVREVfQ09ERV9IT09LU19MT0dfRklMRWAgZW52IHZhciB8IEFwcGVuZCBKU09OIGxpbmVzIHRvIGZpbGUgfFxuICogfCBgLm9uKGxldmVsLCBoYW5kbGVyKWAgcmVnaXN0ZXJlZCB8IEV2ZW50cyBkZWxpdmVyZWQgdG8gaGFuZGxlcnMgb25seSB8XG4gKiB8IE11bHRpcGxlIGRlc3RpbmF0aW9ucyB8IEFsbCBkZXN0aW5hdGlvbnMgcmVjZWl2ZSBldmVudHMgfFxuICpcbiAqICMjIEltcG9ydGFudCBOb3Rlc1xuICpcbiAqIC0gKipOZXZlciBvdXRwdXRzIHRvIHN0ZG91dCoqIChyZXNlcnZlZCBmb3IgSlNPTiBob29rIHJlc3BvbnNlKVxuICogLSAqKk5ldmVyIG91dHB1dHMgdG8gc3RkZXJyKiogKG1heSBpbnRlcmZlcmUgd2l0aCBDbGF1ZGUgQ29kZSBlcnJvciBoYW5kbGluZylcbiAqIC0gRmlsZSBvdXRwdXQgdXNlcyBKU09OIExpbmVzIGZvcm1hdCBmb3IgZWFzeSBwYXJzaW5nXG4gKiAtIGAub24obGV2ZWwsIGhhbmRsZXIpYCByZXR1cm5zIGFuIHVuc3Vic2NyaWJlIGZ1bmN0aW9uXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBTdWJzY3JpYmUgdG8gZXZlbnRzIGF0IHNwZWNpZmljIGxldmVsXG4gKiBsb2dnZXIub24oJ3dhcm4nLCAoZXZlbnQpID0+IHtcbiAqICAgc2VuZEFsZXJ0KGV2ZW50Lm1lc3NhZ2UpO1xuICogfSk7XG4gKlxuICogLy8gTG9nIHdpdGhpbiBhIGhvb2sgaGFuZGxlclxuICogZXhwb3J0IGRlZmF1bHQgcHJlVG9vbFVzZUhvb2soeyBtYXRjaGVyOiAnQmFzaCcgfSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci53YXJuKCdBYm91dCB0byB2YWxpZGF0ZSBCYXNoIGNvbW1hbmQnKTtcbiAqICAgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoeyBhbGxvdzogdHJ1ZSB9KTtcbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjbGFzcyBMb2dnZXIge1xuICAgIC8qKlxuICAgICAqIFJlZ2lzdGVyZWQgZXZlbnQgaGFuZGxlcnMgYnkgbG9nIGxldmVsLlxuICAgICAqL1xuICAgIGhhbmRsZXJzID0gbmV3IE1hcCgpO1xuICAgIC8qKlxuICAgICAqIEZpbGUgZGVzY3JpcHRvciBmb3IgbG9nIGZpbGUgb3V0cHV0LlxuICAgICAqIExhemlseSBpbml0aWFsaXplZCBvbiBmaXJzdCB3cml0ZS5cbiAgICAgKi9cbiAgICBsb2dGaWxlRmQgPSBudWxsO1xuICAgIC8qKlxuICAgICAqIFBhdGggdG8gdGhlIGxvZyBmaWxlLCBpZiBjb25maWd1cmVkLlxuICAgICAqL1xuICAgIGxvZ0ZpbGVQYXRoID0gbnVsbDtcbiAgICAvKipcbiAgICAgKiBXaGV0aGVyIGZpbGUgaW5pdGlhbGl6YXRpb24gaGFzIGJlZW4gYXR0ZW1wdGVkLlxuICAgICAqL1xuICAgIGZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIC8qKlxuICAgICAqIEN1cnJlbnQgaG9vayBjb250ZXh0IGZvciBlbnJpY2hpbmcgbG9nIGV2ZW50cy5cbiAgICAgKi9cbiAgICBjdXJyZW50SG9va1R5cGU7XG4gICAgLyoqXG4gICAgICogQ3VycmVudCBob29rIGlucHV0IGZvciBlbnJpY2hpbmcgbG9nIGV2ZW50cy5cbiAgICAgKi9cbiAgICBjdXJyZW50SW5wdXQ7XG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhIG5ldyBMb2dnZXIgaW5zdGFuY2UuXG4gICAgICpcbiAgICAgKiBUeXBpY2FsbHkgeW91IHNob3VsZCB1c2UgdGhlIGV4cG9ydGVkIGBsb2dnZXJgIHNpbmdsZXRvbiByYXRoZXIgdGhhblxuICAgICAqIGNyZWF0aW5nIG5ldyBpbnN0YW5jZXMuXG4gICAgICogQHBhcmFtIGNvbmZpZyAtIE9wdGlvbmFsIGNvbmZpZ3VyYXRpb25cbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGBgYHR5cGVzY3JpcHRcbiAgICAgKiAvLyBVc2Ugc2luZ2xldG9uIChyZWNvbW1lbmRlZClcbiAgICAgKiBpbXBvcnQgeyBsb2dnZXIgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICAgICAqXG4gICAgICogLy8gT3IgY3JlYXRlIGN1c3RvbSBpbnN0YW5jZVxuICAgICAqIGNvbnN0IGN1c3RvbUxvZ2dlciA9IG5ldyBMb2dnZXIoeyBsb2dGaWxlUGF0aDogJy92YXIvbG9nL2hvb2tzLmxvZycgfSk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgY29uc3RydWN0b3IoY29uZmlnID0ge30pIHtcbiAgICAgICAgLy8gSW5pdGlhbGl6ZSBoYW5kbGVycyBtYXAgZm9yIGVhY2ggbGV2ZWxcbiAgICAgICAgZm9yIChjb25zdCBsZXZlbCBvZiBMT0dfTEVWRUxTKSB7XG4gICAgICAgICAgICB0aGlzLmhhbmRsZXJzLnNldChsZXZlbCwgbmV3IFNldCgpKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBTZXQgbG9nIGZpbGUgcGF0aCBmcm9tIGV4cGxpY2l0IGNvbmZpZywgb3IgYnkgcmVhZGluZyB0aGUgY29uZmlndXJlZCBlbnYgdmFyXG4gICAgICAgIHRoaXMubG9nRmlsZVBhdGggPSBjb25maWcubG9nRmlsZVBhdGggPz8gKGNvbmZpZy5sb2dFbnZWYXIgPyBwcm9jZXNzLmVudltjb25maWcubG9nRW52VmFyXSA6IHVuZGVmaW5lZCkgPz8gbnVsbDtcbiAgICB9XG4gICAgLyoqXG4gICAgICogTG9ncyBhIGRlYnVnIG1lc3NhZ2UuXG4gICAgICpcbiAgICAgKiBVc2UgZm9yIGRldGFpbGVkIGRlYnVnZ2luZyBpbmZvcm1hdGlvbiB0aGF0IGlzIHR5cGljYWxseSBvbmx5IHVzZWZ1bFxuICAgICAqIGR1cmluZyBkZXZlbG9wbWVudCBvciB0cm91Ymxlc2hvb3RpbmcuXG4gICAgICogQHBhcmFtIG1lc3NhZ2UgLSBUaGUgZGVidWcgbWVzc2FnZVxuICAgICAqIEBwYXJhbSBjb250ZXh0IC0gT3B0aW9uYWwgYWRkaXRpb25hbCBjb250ZXh0XG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0eXBlc2NyaXB0XG4gICAgICogbG9nZ2VyLmRlYnVnKCdQcm9jZXNzaW5nIHRvb2wgaW5wdXQnLCB7IHRvb2xOYW1lOiAnQmFzaCcsIGlucHV0U2l6ZTogMjU2IH0pO1xuICAgICAqIGBgYFxuICAgICAqL1xuICAgIGRlYnVnKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZGVidWdcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIExvZ3MgYW4gaW5mbyBtZXNzYWdlLlxuICAgICAqXG4gICAgICogVXNlIGZvciBnZW5lcmFsIG9wZXJhdGlvbmFsIGV2ZW50cyBsaWtlIGhvb2sgaW52b2NhdGlvbnMsIHN1Y2Nlc3NmdWxcbiAgICAgKiBjb21wbGV0aW9ucywgb3Igc3RhdGUgY2hhbmdlcy5cbiAgICAgKiBAcGFyYW0gbWVzc2FnZSAtIFRoZSBpbmZvIG1lc3NhZ2VcbiAgICAgKiBAcGFyYW0gY29udGV4dCAtIE9wdGlvbmFsIGFkZGl0aW9uYWwgY29udGV4dFxuICAgICAqIEBleGFtcGxlXG4gICAgICogYGBgdHlwZXNjcmlwdFxuICAgICAqIGxvZ2dlci5pbmZvKCdTZXNzaW9uIHN0YXJ0ZWQnLCB7IHNvdXJjZTogJ3N0YXJ0dXAnLCBzZXNzaW9uSWQ6ICdhYmMxMjMnIH0pO1xuICAgICAqIGBgYFxuICAgICAqL1xuICAgIGluZm8obWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJpbmZvXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBMb2dzIGEgd2FybmluZyBtZXNzYWdlLlxuICAgICAqXG4gICAgICogVXNlIGZvciBjb25kaXRpb25zIHRoYXQgbWF5IGluZGljYXRlIGlzc3VlcyBidXQgZG9uJ3QgcHJldmVudFxuICAgICAqIG9wZXJhdGlvbiwgc3VjaCBhcyBkZXByZWNhdGVkIHBhdHRlcm5zIG9yIHBlcmZvcm1hbmNlIGNvbmNlcm5zLlxuICAgICAqIEBwYXJhbSBtZXNzYWdlIC0gVGhlIHdhcm5pbmcgbWVzc2FnZVxuICAgICAqIEBwYXJhbSBjb250ZXh0IC0gT3B0aW9uYWwgYWRkaXRpb25hbCBjb250ZXh0XG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0eXBlc2NyaXB0XG4gICAgICogbG9nZ2VyLndhcm4oJ0RlcHJlY2F0ZWQgaG9vayBwYXR0ZXJuIGRldGVjdGVkJywgeyBwYXR0ZXJuOiAnbGVnYWN5TWF0Y2hlcicgfSk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgd2FybihtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcIndhcm5cIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIExvZ3MgYW4gZXJyb3IgbWVzc2FnZS5cbiAgICAgKlxuICAgICAqIFVzZSBmb3IgZXJyb3IgY29uZGl0aW9ucyB0aGF0IHJlcXVpcmUgYXR0ZW50aW9uIGJ1dCB3ZXJlIGhhbmRsZWRcbiAgICAgKiBncmFjZWZ1bGx5LiBGb3IgZXhjZXB0aW9ucywgcHJlZmVyIHtAbGluayBsb2dFcnJvcn0uXG4gICAgICogQHBhcmFtIG1lc3NhZ2UgLSBUaGUgZXJyb3IgbWVzc2FnZVxuICAgICAqIEBwYXJhbSBjb250ZXh0IC0gT3B0aW9uYWwgYWRkaXRpb25hbCBjb250ZXh0XG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0eXBlc2NyaXB0XG4gICAgICogbG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gdmFsaWRhdGUgdG9vbCBpbnB1dCcsIHsgdG9vbE5hbWU6ICdCYXNoJywgcmVhc29uOiAnZW1wdHkgY29tbWFuZCcgfSk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgZXJyb3IobWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJlcnJvclwiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogTG9ncyBhIHN0cnVjdHVyZWQgZXJyb3Igd2l0aCBmdWxsIGVycm9yIGRldGFpbHMuXG4gICAgICpcbiAgICAgKiBVc2UgdGhpcyBtZXRob2Qgd2hlbiBsb2dnaW5nIGNhdWdodCBleGNlcHRpb25zIHRvIGNhcHR1cmUgdGhlIGZ1bGxcbiAgICAgKiBlcnJvciBjb250ZXh0IGluY2x1ZGluZyBuYW1lLCBtZXNzYWdlLCBzdGFjayB0cmFjZSwgYW5kIGNhdXNlIGNoYWluLlxuICAgICAqIEBwYXJhbSBlcnJvciAtIFRoZSBlcnJvciB0byBsb2dcbiAgICAgKiBAcGFyYW0gbWVzc2FnZSAtIEh1bWFuLXJlYWRhYmxlIGRlc2NyaXB0aW9uIG9mIHdoYXQgZmFpbGVkXG4gICAgICogQHBhcmFtIGNvbnRleHQgLSBPcHRpb25hbCBhZGRpdGlvbmFsIGNvbnRleHRcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGBgYHR5cGVzY3JpcHRcbiAgICAgKiB0cnkge1xuICAgICAqICAgYXdhaXQgZGFuZ2Vyb3VzT3BlcmF0aW9uKCk7XG4gICAgICogfSBjYXRjaCAoZXJyKSB7XG4gICAgICogICBsb2dnZXIubG9nRXJyb3IoZXJyLCAnRmFpbGVkIHRvIGV4ZWN1dGUgZGFuZ2Vyb3VzIG9wZXJhdGlvbicsIHtcbiAgICAgKiAgICAgb3BlcmF0aW9uOiAnZGVsZXRlJyxcbiAgICAgKiAgICAgdGFyZ2V0OiAnL2ltcG9ydGFudC9maWxlLnR4dCdcbiAgICAgKiAgIH0pO1xuICAgICAqIH1cbiAgICAgKiBgYGBcbiAgICAgKi9cbiAgICBsb2dFcnJvcihlcnJvciwgbWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICBjb25zdCBlcnJvckluZm8gPSB0aGlzLmV4dHJhY3RFcnJvckluZm8oZXJyb3IpO1xuICAgICAgICBjb25zdCBldmVudCA9IHtcbiAgICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgbGV2ZWw6IFwiZXJyb3JcIixcbiAgICAgICAgICAgIGhvb2tUeXBlOiB0aGlzLmN1cnJlbnRIb29rVHlwZSxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICBpbnB1dDogdGhpcy5jdXJyZW50SW5wdXQsXG4gICAgICAgICAgICBlcnJvcjogZXJyb3JJbmZvLFxuICAgICAgICAgICAgY29udGV4dCxcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5kZWxpdmVyRXZlbnQoZXZlbnQpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBTdWJzY3JpYmVzIGEgaGFuZGxlciB0byBsb2cgZXZlbnRzIGF0IHRoZSBzcGVjaWZpZWQgbGV2ZWwuXG4gICAgICpcbiAgICAgKiBUaGUgaGFuZGxlciB3aWxsIGJlIGNhbGxlZCBmb3IgZXZlcnkgbG9nIGV2ZW50IGF0IHRoZSBzcGVjaWZpZWQgbGV2ZWwuXG4gICAgICogUmV0dXJucyBhbiB1bnN1YnNjcmliZSBmdW5jdGlvbiB0aGF0IHNob3VsZCBiZSBjYWxsZWQgd2hlbiB0aGUgaGFuZGxlclxuICAgICAqIGlzIG5vIGxvbmdlciBuZWVkZWQuXG4gICAgICogQHBhcmFtIGxldmVsIC0gVGhlIGxvZyBsZXZlbCB0byBzdWJzY3JpYmUgdG9cbiAgICAgKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGNhbGwgZm9yIGVhY2ggZXZlbnRcbiAgICAgKiBAcmV0dXJucyBBIGZ1bmN0aW9uIHRvIHVuc3Vic2NyaWJlIHRoZSBoYW5kbGVyXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0eXBlc2NyaXB0XG4gICAgICogLy8gU3Vic2NyaWJlIHRvIGVycm9yIGV2ZW50c1xuICAgICAqIGNvbnN0IHVuc3Vic2NyaWJlID0gbG9nZ2VyLm9uKCdlcnJvcicsIChldmVudCkgPT4ge1xuICAgICAqICAgY29uc29sZS5lcnJvcihgWyR7ZXZlbnQuaG9va1R5cGV9XSAke2V2ZW50Lm1lc3NhZ2V9YCk7XG4gICAgICogICBpZiAoZXZlbnQuZXJyb3IpIHtcbiAgICAgKiAgICAgY29uc29sZS5lcnJvcihldmVudC5lcnJvci5zdGFjayk7XG4gICAgICogICB9XG4gICAgICogfSk7XG4gICAgICpcbiAgICAgKiAvLyBMYXRlciwgY2xlYW4gdXBcbiAgICAgKiB1bnN1YnNjcmliZSgpO1xuICAgICAqIGBgYFxuICAgICAqIEBleGFtcGxlXG4gICAgICogYGBgdHlwZXNjcmlwdFxuICAgICAqIC8vIEZvcndhcmQgdG8gZXh0ZXJuYWwgbG9nZ2luZyBsaWJyYXJ5XG4gICAgICogaW1wb3J0IHBpbm8gZnJvbSAncGlubyc7XG4gICAgICogY29uc3QgcGlub0xvZ2dlciA9IHBpbm8oKTtcbiAgICAgKlxuICAgICAqIGxvZ2dlci5vbignaW5mbycsIChldmVudCkgPT4gcGlub0xvZ2dlci5pbmZvKGV2ZW50LCBldmVudC5tZXNzYWdlKSk7XG4gICAgICogbG9nZ2VyLm9uKCd3YXJuJywgKGV2ZW50KSA9PiBwaW5vTG9nZ2VyLndhcm4oZXZlbnQsIGV2ZW50Lm1lc3NhZ2UpKTtcbiAgICAgKiBsb2dnZXIub24oJ2Vycm9yJywgKGV2ZW50KSA9PiBwaW5vTG9nZ2VyLmVycm9yKGV2ZW50LCBldmVudC5tZXNzYWdlKSk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgb24obGV2ZWwsIGhhbmRsZXIpIHtcbiAgICAgICAgY29uc3QgbGV2ZWxIYW5kbGVycyA9IHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKTtcbiAgICAgICAgaWYgKGxldmVsSGFuZGxlcnMpIHtcbiAgICAgICAgICAgIGxldmVsSGFuZGxlcnMuYWRkKGhhbmRsZXIpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgICAgICBsZXZlbEhhbmRsZXJzPy5kZWxldGUoaGFuZGxlcik7XG4gICAgICAgIH07XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFNldHMgdGhlIGN1cnJlbnQgaG9vayBjb250ZXh0IGZvciBlbnJpY2hpbmcgbG9nIGV2ZW50cy5cbiAgICAgKlxuICAgICAqIFRoaXMgaXMgY2FsbGVkIGludGVybmFsbHkgYnkgdGhlIHJ1bnRpbWUgYmVmb3JlIGludm9raW5nIGhvb2sgaGFuZGxlcnMuXG4gICAgICogWW91IHR5cGljYWxseSBkb24ndCBuZWVkIHRvIGNhbGwgdGhpcyBkaXJlY3RseS5cbiAgICAgKiBAcGFyYW0gaG9va1R5cGUgLSBUaGUgdHlwZSBvZiBob29rIGJlaW5nIGV4ZWN1dGVkXG4gICAgICogQHBhcmFtIGlucHV0IC0gVGhlIGhvb2sgaW5wdXQgZGF0YVxuICAgICAqIEBpbnRlcm5hbFxuICAgICAqL1xuICAgIHNldENvbnRleHQoaG9va1R5cGUsIGlucHV0KSB7XG4gICAgICAgIHRoaXMuY3VycmVudEhvb2tUeXBlID0gaG9va1R5cGU7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gaW5wdXQ7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENsZWFycyB0aGUgY3VycmVudCBob29rIGNvbnRleHQuXG4gICAgICpcbiAgICAgKiBDYWxsZWQgaW50ZXJuYWxseSBieSB0aGUgcnVudGltZSBhZnRlciBob29rIGV4ZWN1dGlvbiBjb21wbGV0ZXMuXG4gICAgICogQGludGVybmFsXG4gICAgICovXG4gICAgY2xlYXJDb250ZXh0KCkge1xuICAgICAgICB0aGlzLmN1cnJlbnRIb29rVHlwZSA9IHVuZGVmaW5lZDtcbiAgICAgICAgdGhpcy5jdXJyZW50SW5wdXQgPSB1bmRlZmluZWQ7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENvbmZpZ3VyZXMgdGhlIGxvZyBmaWxlIHBhdGggYXQgcnVudGltZS5cbiAgICAgKlxuICAgICAqIENhbGwgdGhpcyB0byBlbmFibGUgb3IgY2hhbmdlIGZpbGUgbG9nZ2luZy4gU2V0dGluZyB0byBgbnVsbGAgZGlzYWJsZXNcbiAgICAgKiBmaWxlIGxvZ2dpbmcgKGJ1dCBkb2Vzbid0IGNsb3NlIGV4aXN0aW5nIGZpbGUgaGFuZGxlIGltbWVkaWF0ZWx5KS5cbiAgICAgKiBAcGFyYW0gZmlsZVBhdGggLSBQYXRoIHRvIHRoZSBsb2cgZmlsZSwgb3IgbnVsbCB0byBkaXNhYmxlXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0eXBlc2NyaXB0XG4gICAgICogLy8gRW5hYmxlIGZpbGUgbG9nZ2luZyBhdCBydW50aW1lXG4gICAgICogbG9nZ2VyLnNldExvZ0ZpbGUoJy92YXIvbG9nL2NsYXVkZS1ob29rcy5sb2cnKTtcbiAgICAgKlxuICAgICAqIC8vIERpc2FibGUgZmlsZSBsb2dnaW5nXG4gICAgICogbG9nZ2VyLnNldExvZ0ZpbGUobnVsbCk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgc2V0TG9nRmlsZShmaWxlUGF0aCkge1xuICAgICAgICAvLyBDbG9zZSBleGlzdGluZyBmaWxlIGlmIG9wZW5cbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZUZkICE9PSBudWxsKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNsb3NlU3luYyh0aGlzLmxvZ0ZpbGVGZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXRjaCAoY2xvc2VFcnJvcikge1xuICAgICAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGBbY2xhdWRlLWNvZGUtaG9va3NdIEZhaWxlZCB0byBjbG9zZSBsb2cgZmlsZTogJHtTdHJpbmcoY2xvc2VFcnJvcil9XFxuYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLmxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5sb2dGaWxlUGF0aCA9IGZpbGVQYXRoO1xuICAgICAgICB0aGlzLmZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBDbG9zZXMgYWxsIHJlc291cmNlcyBoZWxkIGJ5IHRoZSBsb2dnZXIuXG4gICAgICpcbiAgICAgKiBDYWxsIHRoaXMgZHVyaW5nIGdyYWNlZnVsIHNodXRkb3duIHRvIGVuc3VyZSBhbGwgbG9nIGRhdGEgaXMgZmx1c2hlZC5cbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGBgYHR5cGVzY3JpcHRcbiAgICAgKiBwcm9jZXNzLm9uKCdleGl0JywgKCkgPT4ge1xuICAgICAqICAgbG9nZ2VyLmNsb3NlKCk7XG4gICAgICogfSk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgY2xvc2UoKSB7XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjbG9zZVN5bmModGhpcy5sb2dGaWxlRmQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2F0Y2ggKGNsb3NlRXJyb3IpIHtcbiAgICAgICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgW2NsYXVkZS1jb2RlLWhvb2tzXSBGYWlsZWQgdG8gY2xvc2UgbG9nIGZpbGU6ICR7U3RyaW5nKGNsb3NlRXJyb3IpfVxcbmApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5sb2dGaWxlRmQgPSBudWxsO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuZmlsZUluaXRpYWxpemVkID0gZmFsc2U7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENoZWNrcyBpZiB0aGVyZSBhcmUgYW55IGFjdGl2ZSBoYW5kbGVycyBvciBkZXN0aW5hdGlvbnMuXG4gICAgICpcbiAgICAgKiBSZXR1cm5zIHRydWUgaWYgYW55IGhhbmRsZXJzIGFyZSByZWdpc3RlcmVkIG9yIGZpbGUgbG9nZ2luZyBpcyBlbmFibGVkLlxuICAgICAqIEByZXR1cm5zIFdoZXRoZXIgdGhlIGxvZ2dlciBoYXMgYW55IGFjdGl2ZSBvdXRwdXQgZGVzdGluYXRpb25zXG4gICAgICovXG4gICAgaGFzRGVzdGluYXRpb25zKCkge1xuICAgICAgICBmb3IgKGNvbnN0IGhhbmRsZXJzIG9mIHRoaXMuaGFuZGxlcnMudmFsdWVzKCkpIHtcbiAgICAgICAgICAgIGlmIChoYW5kbGVycy5zaXplID4gMClcbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5sb2dGaWxlUGF0aCAhPT0gbnVsbDtcbiAgICB9XG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFByaXZhdGUgTWV0aG9kc1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvKipcbiAgICAgKiBFbWl0cyBhIGxvZyBldmVudC5cbiAgICAgKiBAcGFyYW0gbGV2ZWwgLSBUaGUgc2V2ZXJpdHkgbGV2ZWwgb2YgdGhlIGV2ZW50XG4gICAgICogQHBhcmFtIG1lc3NhZ2UgLSBUaGUgbG9nIG1lc3NhZ2VcbiAgICAgKiBAcGFyYW0gY29udGV4dCAtIE9wdGlvbmFsIGFkZGl0aW9uYWwgY29udGV4dCBkYXRhXG4gICAgICovXG4gICAgZW1pdChsZXZlbCwgbWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICBjb25zdCBldmVudCA9IHtcbiAgICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgbGV2ZWwsXG4gICAgICAgICAgICBob29rVHlwZTogdGhpcy5jdXJyZW50SG9va1R5cGUsXG4gICAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgICAgaW5wdXQ6IHRoaXMuY3VycmVudElucHV0LFxuICAgICAgICAgICAgY29udGV4dCxcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5kZWxpdmVyRXZlbnQoZXZlbnQpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBEZWxpdmVycyBhbiBldmVudCB0byBhbGwgcmVnaXN0ZXJlZCBkZXN0aW5hdGlvbnMuXG4gICAgICogQHBhcmFtIGV2ZW50IC0gVGhlIGxvZyBldmVudCB0byBkZWxpdmVyXG4gICAgICovXG4gICAgZGVsaXZlckV2ZW50KGV2ZW50KSB7XG4gICAgICAgIC8vIERlbGl2ZXIgdG8gZXZlbnQgaGFuZGxlcnNcbiAgICAgICAgY29uc3QgbGV2ZWxIYW5kbGVycyA9IHRoaXMuaGFuZGxlcnMuZ2V0KGV2ZW50LmxldmVsKTtcbiAgICAgICAgaWYgKGxldmVsSGFuZGxlcnMpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgaGFuZGxlciBvZiBsZXZlbEhhbmRsZXJzKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgaGFuZGxlcihldmVudCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNhdGNoIChoYW5kbGVyRXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYFtjbGF1ZGUtY29kZS1ob29rc10gTG9nIGhhbmRsZXIgZXJyb3I6ICR7U3RyaW5nKGhhbmRsZXJFcnJvcil9XFxuYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIC8vIFdyaXRlIHRvIGZpbGUgaWYgY29uZmlndXJlZFxuICAgICAgICB0aGlzLndyaXRlVG9GaWxlKGV2ZW50KTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogV3JpdGVzIGFuIGV2ZW50IHRvIHRoZSBsb2cgZmlsZS5cbiAgICAgKiBAcGFyYW0gZXZlbnQgLSBUaGUgbG9nIGV2ZW50IHRvIHdyaXRlXG4gICAgICovXG4gICAgd3JpdGVUb0ZpbGUoZXZlbnQpIHtcbiAgICAgICAgaWYgKCF0aGlzLmxvZ0ZpbGVQYXRoKVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAvLyBMYXp5IGluaXRpYWxpemF0aW9uIG9mIGZpbGUgaGFuZGxlXG4gICAgICAgIGlmICghdGhpcy5maWxlSW5pdGlhbGl6ZWQpIHtcbiAgICAgICAgICAgIHRoaXMuaW5pdGlhbGl6ZUZpbGUoKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5sb2dGaWxlRmQgPT09IG51bGwpXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBsaW5lID0gYCR7SlNPTi5zdHJpbmdpZnkoZXZlbnQpfVxcbmA7XG4gICAgICAgICAgICB3cml0ZVN5bmModGhpcy5sb2dGaWxlRmQsIGxpbmUpO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoICh3cml0ZUVycm9yKSB7XG4gICAgICAgICAgICAvLyBEaXNhYmxlIGZpbGUgbG9nZ2luZyBhZnRlciBhIHdyaXRlIGZhaWx1cmUgdG8gYXZvaWQgcmVwZWF0ZWQgZXJyb3JzXG4gICAgICAgICAgICB0aGlzLmxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgICAgICAgICB0aGlzLmZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgICAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYFtjbGF1ZGUtY29kZS1ob29rc10gTG9nIGZpbGUgd3JpdGUgZmFpbGVkOiAke1N0cmluZyh3cml0ZUVycm9yKX1cXG5gKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBJbml0aWFsaXplcyB0aGUgbG9nIGZpbGUgZm9yIHdyaXRpbmcuXG4gICAgICovXG4gICAgaW5pdGlhbGl6ZUZpbGUoKSB7XG4gICAgICAgIHRoaXMuZmlsZUluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICAgICAgaWYgKCF0aGlzLmxvZ0ZpbGVQYXRoKVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgLy8gRW5zdXJlIGRpcmVjdG9yeSBleGlzdHNcbiAgICAgICAgICAgIGNvbnN0IGRpciA9IGRpcm5hbWUodGhpcy5sb2dGaWxlUGF0aCk7XG4gICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmMoZGlyKSkge1xuICAgICAgICAgICAgICAgIG1rZGlyU3luYyhkaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gT3BlbiBmaWxlIGZvciBhcHBlbmRpbmdcbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gb3BlblN5bmModGhpcy5sb2dGaWxlUGF0aCwgXCJhXCIpO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoIHtcbiAgICAgICAgICAgIC8vIFNpbGVudGx5IGlnbm9yZSBmaWxlIGluaXRpYWxpemF0aW9uIGVycm9yc1xuICAgICAgICAgICAgdGhpcy5sb2dGaWxlRmQgPSBudWxsO1xuICAgICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEV4dHJhY3RzIHN0cnVjdHVyZWQgZXJyb3IgaW5mb3JtYXRpb24gZnJvbSBhbiB1bmtub3duIGVycm9yLlxuICAgICAqIEBwYXJhbSBlcnJvciAtIFRoZSBlcnJvciB0byBleHRyYWN0IGluZm9ybWF0aW9uIGZyb21cbiAgICAgKiBAcmV0dXJucyBTdHJ1Y3R1cmVkIGVycm9yIGluZm9ybWF0aW9uXG4gICAgICovXG4gICAgZXh0cmFjdEVycm9ySW5mbyhlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICAgICAgY29uc3QgaW5mbyA9IHtcbiAgICAgICAgICAgICAgICBuYW1lOiBlcnJvci5uYW1lLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UsXG4gICAgICAgICAgICAgICAgc3RhY2s6IGVycm9yLnN0YWNrLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIC8vIEV4dHJhY3QgY2F1c2UgY2hhaW4gaWYgcHJlc2VudFxuICAgICAgICAgICAgaWYgKGVycm9yLmNhdXNlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICBpbmZvLmNhdXNlID0gdGhpcy5leHRyYWN0RXJyb3JJbmZvKGVycm9yLmNhdXNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBpbmZvO1xuICAgICAgICB9XG4gICAgICAgIC8vIEhhbmRsZSBub24tRXJyb3IgdmFsdWVzXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBuYW1lOiBcIlVua25vd25FcnJvclwiLFxuICAgICAgICAgICAgbWVzc2FnZTogU3RyaW5nKGVycm9yKSxcbiAgICAgICAgfTtcbiAgICB9XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTaW5nbGV0b24gRXhwb3J0XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIEdsb2JhbCBsb2dnZXIgaW5zdGFuY2UgZm9yIENsYXVkZSBDb2RlIGhvb2tzLlxuICpcbiAqIFVzZSB0aGlzIHNpbmdsZXRvbiBmb3IgYWxsIGxvZ2dpbmcgd2l0aGluIGhvb2tzLiBUaGUgbG9nZ2VyIGlzIGNvbmZpZ3VyZWRcbiAqIHZpYSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgYW5kIHN1cHBvcnRzIGV2ZW50IHN1YnNjcmlwdGlvbiBmb3IgY3VzdG9tXG4gKiBkZXN0aW5hdGlvbnMuXG4gKlxuICogIyMgQ29uZmlndXJhdGlvblxuICpcbiAqIHwgRW52aXJvbm1lbnQgVmFyaWFibGUgfCBEZXNjcmlwdGlvbiB8XG4gKiB8LS0tLS0tLS0tLS0tLS0tLS0tLS0tfC0tLS0tLS0tLS0tLS18XG4gKiB8IGBDTEFVREVfQ09ERV9IT09LU19MT0dfRklMRWAgfCBQYXRoIHRvIGxvZyBmaWxlIChKU09OIExpbmVzIGZvcm1hdCkgfFxuICpcbiAqICMjIFVzYWdlIGluIEhvb2tzXG4gKlxuICogVGhlIGxvZ2dlciBpcyBwYXNzZWQgdG8gaG9vayBoYW5kbGVycyB2aWEgY29udGV4dCBmb3IgY29udmVuaWVuY2U6XG4gKlxuICogYGBgdHlwZXNjcmlwdFxuICogZXhwb3J0IGRlZmF1bHQgcHJlVG9vbFVzZUhvb2soeyBtYXRjaGVyOiAnQmFzaCcgfSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci53YXJuKCdWYWxpZGF0aW5nIEJhc2ggY29tbWFuZCcpO1xuICogICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7IGFsbG93OiB0cnVlIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqXG4gKiAjIyBFeHRlcm5hbCBJbnRlZ3JhdGlvblxuICpcbiAqIFN1YnNjcmliZSB0byBldmVudHMgdG8gZm9yd2FyZCBsb2dzIHRvIGV4dGVybmFsIHN5c3RlbXM6XG4gKlxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqIGltcG9ydCBwaW5vIGZyb20gJ3Bpbm8nO1xuICpcbiAqIGNvbnN0IHBpbm9Mb2dnZXIgPSBwaW5vKHsgbGV2ZWw6ICdkZWJ1ZycgfSk7XG4gKlxuICogbG9nZ2VyLm9uKCdkZWJ1ZycsIChldmVudCkgPT4gcGlub0xvZ2dlci5kZWJ1ZyhldmVudCwgZXZlbnQubWVzc2FnZSkpO1xuICogbG9nZ2VyLm9uKCdpbmZvJywgKGV2ZW50KSA9PiBwaW5vTG9nZ2VyLmluZm8oZXZlbnQsIGV2ZW50Lm1lc3NhZ2UpKTtcbiAqIGxvZ2dlci5vbignd2FybicsIChldmVudCkgPT4gcGlub0xvZ2dlci53YXJuKGV2ZW50LCBldmVudC5tZXNzYWdlKSk7XG4gKiBsb2dnZXIub24oJ2Vycm9yJywgKGV2ZW50KSA9PiBwaW5vTG9nZ2VyLmVycm9yKGV2ZW50LCBldmVudC5tZXNzYWdlKSk7XG4gKiBgYGBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBEaXJlY3QgdXNhZ2VcbiAqIGltcG9ydCB7IGxvZ2dlciB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogbG9nZ2VyLmluZm8oJ1N0YXJ0aW5nIG9wZXJhdGlvbicpO1xuICogbG9nZ2VyLndhcm4oJ1Jlc291cmNlIGxpbWl0IGFwcHJvYWNoaW5nJywgeyB1c2FnZTogMC45IH0pO1xuICpcbiAqIHRyeSB7XG4gKiAgIGF3YWl0IHJpc2t5T3BlcmF0aW9uKCk7XG4gKiB9IGNhdGNoIChlcnIpIHtcbiAqICAgbG9nZ2VyLmxvZ0Vycm9yKGVyciwgJ1Jpc2t5IG9wZXJhdGlvbiBmYWlsZWQnKTtcbiAqIH1cbiAqIGBgYFxuICovXG4vLyBDTEFVREVfQ09ERV9IT09LU19MT0dfRU5WX1ZBUiBpcyBzZXQgdW5jb25kaXRpb25hbGx5IGJ5IHRoZSAtLWxvZy1lbnYtdmFyIGJhbm5lclxuLy8gYmVmb3JlIHRoaXMgbW9kdWxlIGluaXRpYWxpc2VzLiBJZiBhYnNlbnQsIGZhbGwgYmFjayB0byB0aGUgZGVmYXVsdCBlbnYgdmFyIG5hbWUuXG5leHBvcnQgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcih7XG4gICAgbG9nRW52VmFyOiBwcm9jZXNzLmVudi5DTEFVREVfQ09ERV9IT09LU19MT0dfRU5WX1ZBUiA/PyBcIkNMQVVERV9DT0RFX0hPT0tTX0xPR19GSUxFXCIsXG59KTtcbiIsICIvKipcbiAqIE91dHB1dCB0eXBlcyBhbmQgYnVpbGRlcnMgZm9yIENsYXVkZSBDb2RlIGhvb2tzLlxuICpcbiAqIFByb3ZpZGVzIHR5cGUtc2FmZSBvdXRwdXQgYnVpbGRlciBmdW5jdGlvbnMgZm9yIGFsbCAxMiBob29rIHR5cGVzLiBFYWNoIGJ1aWxkZXJcbiAqIGFjY2VwdHMgb3B0aW9ucyB0aGF0IG1hdGNoIHRoZSB3aXJlIGZvcm1hdCBleHBlY3RlZCBieSBDbGF1ZGUgQ29kZSwgd2l0aCB0eXBlc1xuICogZGVyaXZlZCBmcm9tIHRoZSBDbGF1ZGUgQWdlbnQgU0RLJ3MgYFN5bmNIb29rSlNPTk91dHB1dGAgdHlwZS5cbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rc1xuICogQG1vZHVsZVxuICovXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFeGl0IENvZGUgQ29uc3RhbnRzXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIEV4aXQgY29kZXMgdXNlZCBieSBDbGF1ZGUgQ29kZSBob29rcy5cbiAqXG4gKiB8IEV4aXQgQ29kZSB8IE5hbWUgfCBXaGVuIFVzZWQgfCBDbGF1ZGUgQ29kZSBCZWhhdmlvciB8XG4gKiB8LS0tLS0tLS0tLS18LS0tLS0tfC0tLS0tLS0tLS0tfC0tLS0tLS0tLS0tLS0tLS0tLS0tLXxcbiAqIHwgMCB8IFN1Y2Nlc3MgfCBIYW5kbGVyIHJldHVybnMgbm9ybWFsbHkgfCBDb250aW51ZSwgcGFyc2Ugc3Rkb3V0IGFzIEpTT04gfFxuICogfCAxIHwgRXJyb3IgfCBJbnZhbGlkIGlucHV0LCBub24tYmxvY2tpbmcgZXJyb3IgfCBOb24tYmxvY2tpbmcsIHN0ZGVyciB0byB1c2VyIG9ubHkgfFxuICogfCAyIHwgQmxvY2sgfCBIYW5kbGVyIHRocm93cyBPUiBgc3RvcFJlYXNvbmAgc2V0IHwgQmxvY2tpbmcsIHN0ZGVyciBzaG93biB0byBDbGF1ZGUgfFxuICovXG5leHBvcnQgY29uc3QgRVhJVF9DT0RFUyA9IHtcbiAgICAvKiogSGFuZGxlciBjb21wbGV0ZWQgc3VjY2Vzc2Z1bGx5LiBDbGF1ZGUgQ29kZSBwYXJzZXMgc3Rkb3V0IGFzIEpTT04uICovXG4gICAgU1VDQ0VTUzogMCxcbiAgICAvKiogTm9uLWJsb2NraW5nIGVycm9yIG9jY3VycmVkIChlLmcuLCBpbnZhbGlkIGlucHV0KS4gc3RkZXJyIHNob3duIHRvIHVzZXIgb25seS4gKi9cbiAgICBFUlJPUjogMSxcbiAgICAvKiogSGFuZGxlciB0aHJldyBleGNlcHRpb24gT1IgYmxvY2tpbmcgYWN0aW9uIHJlcXVlc3RlZC4gc3RkZXJyIHNob3duIHRvIENsYXVkZS4gKi9cbiAgICBCTE9DSzogMixcbn07XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBPdXRwdXQgQnVpbGRlciBGYWN0b3JpZXNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogRmFjdG9yeSBmb3IgaG9va3MgdGhhdCBoYXZlIGhvb2tTcGVjaWZpY091dHB1dCB3aXRoIGEgaG9va0V2ZW50TmFtZSBkaXNjcmltaW5hdG9yLlxuICogQHBhcmFtIGhvb2tUeXBlIC0gVGhlIGhvb2sgdHlwZSBuYW1lIHVzZWQgYXMgdGhlIF90eXBlIGRpc2NyaW1pbmF0b3JcbiAqIEByZXR1cm5zIEEgYnVpbGRlciBmdW5jdGlvbiB0aGF0IGNyZWF0ZXMgdGhlIG91dHB1dCBvYmplY3RcbiAqIEBpbnRlcm5hbFxuICovXG5mdW5jdGlvbiBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKGhvb2tUeXBlKSB7XG4gICAgcmV0dXJuIChvcHRpb25zID0ge30pID0+IHtcbiAgICAgICAgY29uc3QgeyBob29rU3BlY2lmaWNPdXRwdXQsIC4uLnJlc3QgfSA9IG9wdGlvbnM7XG4gICAgICAgIGNvbnN0IHN0ZG91dCA9IGhvb2tTcGVjaWZpY091dHB1dCAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgICA/IHsgLi4ucmVzdCwgaG9va1NwZWNpZmljT3V0cHV0OiB7IGhvb2tFdmVudE5hbWU6IGhvb2tUeXBlLCAuLi5ob29rU3BlY2lmaWNPdXRwdXQgfSB9XG4gICAgICAgICAgICA6IHJlc3Q7XG4gICAgICAgIHJldHVybiB7IF90eXBlOiBob29rVHlwZSwgc3Rkb3V0IH07XG4gICAgfTtcbn1cbi8qKlxuICogRmFjdG9yeSBmb3IgaG9va3MgdGhhdCBvbmx5IHVzZSBDb21tb25PcHRpb25zIChzaW1wbGUgcGFzc3Rocm91Z2gpLlxuICogQHBhcmFtIGhvb2tUeXBlIC0gVGhlIGhvb2sgdHlwZSBuYW1lIHVzZWQgYXMgdGhlIF90eXBlIGRpc2NyaW1pbmF0b3JcbiAqIEByZXR1cm5zIEEgYnVpbGRlciBmdW5jdGlvbiB0aGF0IGNyZWF0ZXMgdGhlIG91dHB1dCBvYmplY3RcbiAqIEBpbnRlcm5hbFxuICovXG5mdW5jdGlvbiBjcmVhdGVTaW1wbGVPdXRwdXRCdWlsZGVyKGhvb2tUeXBlKSB7XG4gICAgcmV0dXJuIChvcHRpb25zID0ge30pID0+ICh7XG4gICAgICAgIF90eXBlOiBob29rVHlwZSxcbiAgICAgICAgc3Rkb3V0OiBvcHRpb25zLFxuICAgIH0pO1xufVxuLyoqXG4gKiBGYWN0b3J5IGZvciB3b3JrdHJlZSBob29rcyAoV29ya3RyZWVDcmVhdGUsIFdvcmt0cmVlUmVtb3ZlKS5cbiAqXG4gKiBUaGVzZSBhcmUgY29tbWFuZCBob29rcyB3aG9zZSB3aXJlIHByb3RvY29sIGlzIGEgKipiYXJlIHBhdGggb24gc3Rkb3V0KiosIG5vdCBKU09OOlxuICogQ2xhdWRlIENvZGUgcmVhZHMgdGhlIGhvb2sncyBzdGRvdXQgdmVyYmF0aW0gYW5kIGBjaGRpcmBzIGludG8gaXQuIFRoZSBidWlsZGVyIGNhcnJpZXNcbiAqIHRoZSBwYXRoIGluIGByYXdTdGRvdXRgIHNvIHRoZSBydW50aW1lIGVtaXRzIGl0IGFzIHBsYWluIHRleHQgaW5zdGVhZCBvZlxuICogYEpTT04uc3RyaW5naWZ5KHN0ZG91dClgLlxuICogQHBhcmFtIGhvb2tUeXBlIC0gVGhlIGhvb2sgdHlwZSBuYW1lIHVzZWQgYXMgdGhlIF90eXBlIGRpc2NyaW1pbmF0b3JcbiAqIEByZXR1cm5zIEEgYnVpbGRlciBmdW5jdGlvbiB0aGF0IGNyZWF0ZXMgdGhlIG91dHB1dCBvYmplY3RcbiAqIEBpbnRlcm5hbFxuICovXG5mdW5jdGlvbiBjcmVhdGVXb3JrdHJlZU91dHB1dEJ1aWxkZXIoaG9va1R5cGUpIHtcbiAgICByZXR1cm4gKG9wdGlvbnMpID0+IHtcbiAgICAgICAgY29uc3QgeyB3b3JrdHJlZVBhdGgsIC4uLnJlc3QgfSA9IG9wdGlvbnM7XG4gICAgICAgIHJldHVybiB7IF90eXBlOiBob29rVHlwZSwgc3Rkb3V0OiByZXN0LCByYXdTdGRvdXQ6IHdvcmt0cmVlUGF0aCB9O1xuICAgIH07XG59XG4vKipcbiAqIEZhY3RvcnkgZm9yIGhvb2tzIHRoYXQgdXNlIGRlY2lzaW9uLWJhc2VkIG9wdGlvbnMgKFN0b3AsIFN1YmFnZW50U3RvcCkuXG4gKiBAcGFyYW0gaG9va1R5cGUgLSBUaGUgaG9vayB0eXBlIG5hbWUgdXNlZCBhcyB0aGUgX3R5cGUgZGlzY3JpbWluYXRvclxuICogQHJldHVybnMgQSBidWlsZGVyIGZ1bmN0aW9uIHRoYXQgY3JlYXRlcyB0aGUgb3V0cHV0IG9iamVjdFxuICogQGludGVybmFsXG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZURlY2lzaW9uT3V0cHV0QnVpbGRlcihob29rVHlwZSkge1xuICAgIHJldHVybiAob3B0aW9ucyA9IHt9KSA9PiAoe1xuICAgICAgICBfdHlwZTogaG9va1R5cGUsXG4gICAgICAgIHN0ZG91dDogb3B0aW9ucyxcbiAgICB9KTtcbn1cbi8qKlxuICogRmFjdG9yeSBmb3IgZXhpdC1jb2RlLWJhc2VkIGhvb2tzIChUZWFtbWF0ZUlkbGUsIFRhc2tDb21wbGV0ZWQpLlxuICpcbiAqIFRoZXNlIGhvb2tzIGRvbid0IHVzZSBKU09OIGRlY2lzaW9uIGNvbnRyb2wgKG5vIENvbW1vbk9wdGlvbnMpLlxuICogVGhlIG9ubHkgb3B0aW9uIGlzIGBzdGRlcnJgIFx1MjAxNCB3aGVuIHByZXNlbnQsIGl0IHRyaWdnZXJzIGV4aXQgY29kZSAyIChCTE9DSykuXG4gKiBTdGRvdXQgYWx3YXlzIHJlY2VpdmVzIGB7fWAgKGVtcHR5IEpTT04gb2JqZWN0KS5cbiAqIEBwYXJhbSBob29rVHlwZSAtIFRoZSBob29rIHR5cGUgbmFtZSB1c2VkIGFzIHRoZSBfdHlwZSBkaXNjcmltaW5hdG9yXG4gKiBAcmV0dXJucyBBIGJ1aWxkZXIgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIHRoZSBvdXRwdXQgb2JqZWN0XG4gKiBAaW50ZXJuYWxcbiAqL1xuZnVuY3Rpb24gY3JlYXRlRXhpdENvZGVPdXRwdXRCdWlsZGVyKGhvb2tUeXBlKSB7XG4gICAgcmV0dXJuICh7IHN0ZGVyciB9ID0ge30pID0+ICh7XG4gICAgICAgIF90eXBlOiBob29rVHlwZSxcbiAgICAgICAgc3Rkb3V0OiB7fSxcbiAgICAgICAgLi4uKHN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRlcnIgfSA6IHt9KSxcbiAgICB9KTtcbn1cbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFByZVRvb2xVc2UgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFByZVRvb2xVc2VPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEFsbG93IHRvb2wgZXhlY3V0aW9uXG4gKiBwcmVUb29sVXNlT3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7IHBlcm1pc3Npb25EZWNpc2lvbjogJ2FsbG93JyB9XG4gKiB9KTtcbiAqXG4gKiAvLyBEZW55IHdpdGggcmVhc29uXG4gKiBwcmVUb29sVXNlT3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgcGVybWlzc2lvbkRlY2lzaW9uOiAnZGVueScsXG4gKiAgICAgcGVybWlzc2lvbkRlY2lzaW9uUmVhc29uOiAnRGFuZ2Vyb3VzIGNvbW1hbmQgZGV0ZWN0ZWQnXG4gKiAgIH1cbiAqIH0pO1xuICpcbiAqIC8vIEFsbG93IHdpdGggbW9kaWZpZWQgaW5wdXRcbiAqIHByZVRvb2xVc2VPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICBwZXJtaXNzaW9uRGVjaXNpb246ICdhbGxvdycsXG4gKiAgICAgdXBkYXRlZElucHV0OiB7IGNvbW1hbmQ6ICdscyAtbGEnIH1cbiAqICAgfVxuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHByZVRvb2xVc2VPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIlByZVRvb2xVc2VcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBQb3N0VG9vbFVzZSBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgUG9zdFRvb2xVc2VPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEFkZCBjb250ZXh0IGFmdGVyIGEgZmlsZSByZWFkXG4gKiBwb3N0VG9vbFVzZU91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDoge1xuICogICAgIGFkZGl0aW9uYWxDb250ZXh0OiAnRmlsZSBjb250YWlucyBzZW5zaXRpdmUgZGF0YSdcbiAqICAgfVxuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHBvc3RUb29sVXNlT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJQb3N0VG9vbFVzZVwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFBvc3RUb29sVXNlRmFpbHVyZSBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgUG9zdFRvb2xVc2VGYWlsdXJlT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBwb3N0VG9vbFVzZUZhaWx1cmVPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICBhZGRpdGlvbmFsQ29udGV4dDogJ1RyeSB1c2luZyBhIGRpZmZlcmVudCBhcHByb2FjaCdcbiAqICAgfVxuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHBvc3RUb29sVXNlRmFpbHVyZU91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiUG9zdFRvb2xVc2VGYWlsdXJlXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgUG9zdFRvb2xCYXRjaCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgUG9zdFRvb2xCYXRjaE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogcG9zdFRvb2xCYXRjaE91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDoge1xuICogICAgIGFkZGl0aW9uYWxDb250ZXh0OiAnQWxsIGVkaXRzIGluIHRoZSBiYXRjaCB3ZXJlIGFwcGxpZWQgc3VjY2Vzc2Z1bGx5J1xuICogICB9XG4gKiB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgcG9zdFRvb2xCYXRjaE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiUG9zdFRvb2xCYXRjaFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFVzZXJQcm9tcHRFeHBhbnNpb24gaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFVzZXJQcm9tcHRFeHBhbnNpb25PdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIHVzZXJQcm9tcHRFeHBhbnNpb25PdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICBhZGRpdGlvbmFsQ29udGV4dDogJ1NsYXNoIGNvbW1hbmQgZXhwYW5kZWQgd2l0aCBhZGRpdGlvbmFsIGNvbnRleHQnXG4gKiAgIH1cbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCB1c2VyUHJvbXB0RXhwYW5zaW9uT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJVc2VyUHJvbXB0RXhwYW5zaW9uXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgVXNlclByb21wdFN1Ym1pdCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgVXNlclByb21wdFN1Ym1pdE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogdXNlclByb21wdFN1Ym1pdE91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDoge1xuICogICAgIGFkZGl0aW9uYWxDb250ZXh0OiAnVGhpcyBwcm9qZWN0IHVzZXMgVHlwZVNjcmlwdCBzdHJpY3QgbW9kZSdcbiAqICAgfVxuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHVzZXJQcm9tcHRTdWJtaXRPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIlVzZXJQcm9tcHRTdWJtaXRcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBTZXNzaW9uU3RhcnQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFNlc3Npb25TdGFydE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogc2Vzc2lvblN0YXJ0T3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgYWRkaXRpb25hbENvbnRleHQ6IEpTT04uc3RyaW5naWZ5KHsgcHJvamVjdDogJ215LXByb2plY3QnIH0pXG4gKiAgIH1cbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBzZXNzaW9uU3RhcnRPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIlNlc3Npb25TdGFydFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFNlc3Npb25FbmQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFNlc3Npb25FbmRPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIHNlc3Npb25FbmRPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBzZXNzaW9uRW5kT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZVNpbXBsZU91dHB1dEJ1aWxkZXIoXCJTZXNzaW9uRW5kXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgU3RvcCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgU3RvcE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQWxsb3cgdGhlIHN0b3BcbiAqIHN0b3BPdXRwdXQoeyBkZWNpc2lvbjogJ2FwcHJvdmUnIH0pO1xuICpcbiAqIC8vIEJsb2NrIHdpdGggcmVhc29uXG4gKiBzdG9wT3V0cHV0KHtcbiAqICAgZGVjaXNpb246ICdibG9jaycsXG4gKiAgIHJlYXNvbjogJ1RoZXJlIGFyZSB1bmNvbW1pdHRlZCBjaGFuZ2VzJ1xuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHN0b3BPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlRGVjaXNpb25PdXRwdXRCdWlsZGVyKFwiU3RvcFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFN0b3BGYWlsdXJlIGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBTdG9wRmFpbHVyZU91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogc3RvcEZhaWx1cmVPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBzdG9wRmFpbHVyZU91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVTaW1wbGVPdXRwdXRCdWlsZGVyKFwiU3RvcEZhaWx1cmVcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBTdWJhZ2VudFN0YXJ0IGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBTdWJhZ2VudFN0YXJ0T3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBzdWJhZ2VudFN0YXJ0T3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgYWRkaXRpb25hbENvbnRleHQ6ICdGb2N1cyBvbiBmaW5kaW5nIHBhdHRlcm5zJ1xuICogICB9XG4gKiB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3Qgc3ViYWdlbnRTdGFydE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiU3ViYWdlbnRTdGFydFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFN1YmFnZW50U3RvcCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgU3ViYWdlbnRTdG9wT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBCbG9jayB3aXRoIHJlYXNvblxuICogc3ViYWdlbnRTdG9wT3V0cHV0KHtcbiAqICAgZGVjaXNpb246ICdibG9jaycsXG4gKiAgIHJlYXNvbjogJ1Rhc2sgbm90IGNvbXBsZXRlJ1xuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHN1YmFnZW50U3RvcE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVEZWNpc2lvbk91dHB1dEJ1aWxkZXIoXCJTdWJhZ2VudFN0b3BcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBOb3RpZmljYXRpb24gaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIE5vdGlmaWNhdGlvbk91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQWRkIGNvbnRleHQgYWJvdXQgdGhlIG5vdGlmaWNhdGlvblxuICogbm90aWZpY2F0aW9uT3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgYWRkaXRpb25hbENvbnRleHQ6ICdOb3RpZmljYXRpb24gZm9yd2FyZGVkIHRvIFNsYWNrICNhbGVydHMgY2hhbm5lbCdcbiAqICAgfVxuICogfSk7XG4gKlxuICogLy8gU3VwcHJlc3MgdGhlIG5vdGlmaWNhdGlvblxuICogbm90aWZpY2F0aW9uT3V0cHV0KHsgc3VwcHJlc3NPdXRwdXQ6IHRydWUgfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IG5vdGlmaWNhdGlvbk91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiTm90aWZpY2F0aW9uXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgUHJlQ29tcGFjdCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgUHJlQ29tcGFjdE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogcHJlQ29tcGFjdE91dHB1dCh7XG4gKiAgIHN5c3RlbU1lc3NhZ2U6ICdSZW1lbWJlcjogc3RyaWN0IG1vZGUgaXMgZW5hYmxlZCdcbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBwcmVDb21wYWN0T3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZVNpbXBsZU91dHB1dEJ1aWxkZXIoXCJQcmVDb21wYWN0XCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgUG9zdENvbXBhY3QgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFBvc3RDb21wYWN0T3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBwb3N0Q29tcGFjdE91dHB1dCh7fSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHBvc3RDb21wYWN0T3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZVNpbXBsZU91dHB1dEJ1aWxkZXIoXCJQb3N0Q29tcGFjdFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFBlcm1pc3Npb25SZXF1ZXN0IGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBQZXJtaXNzaW9uUmVxdWVzdE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQXV0by1hcHByb3ZlXG4gKiBwZXJtaXNzaW9uUmVxdWVzdE91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDoge1xuICogICAgIGRlY2lzaW9uOiB7IGJlaGF2aW9yOiAnYWxsb3cnIH1cbiAqICAgfVxuICogfSk7XG4gKlxuICogLy8gQXV0by1hcHByb3ZlIHdpdGggbW9kaWZpZWQgaW5wdXRcbiAqIHBlcm1pc3Npb25SZXF1ZXN0T3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgZGVjaXNpb246IHtcbiAqICAgICAgIGJlaGF2aW9yOiAnYWxsb3cnLFxuICogICAgICAgdXBkYXRlZElucHV0OiB7IGZpbGVfcGF0aDogJy9zYWZlL3BhdGgnIH1cbiAqICAgICB9XG4gKiAgIH1cbiAqIH0pO1xuICpcbiAqIC8vIEF1dG8tZGVueVxuICogcGVybWlzc2lvblJlcXVlc3RPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICBkZWNpc2lvbjoge1xuICogICAgICAgYmVoYXZpb3I6ICdkZW55JyxcbiAqICAgICAgIG1lc3NhZ2U6ICdOb3QgYWxsb3dlZCcsXG4gKiAgICAgICBpbnRlcnJ1cHQ6IHRydWVcbiAqICAgICB9XG4gKiAgIH1cbiAqIH0pO1xuICpcbiAqIC8vIEZhbGwgdGhyb3VnaCB0byBub3JtYWwgcHJvbXB0XG4gKiBwZXJtaXNzaW9uUmVxdWVzdE91dHB1dCh7fSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHBlcm1pc3Npb25SZXF1ZXN0T3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJQZXJtaXNzaW9uUmVxdWVzdFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFBlcm1pc3Npb25EZW5pZWQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFBlcm1pc3Npb25EZW5pZWRPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIExvZyBhbmQgYWxsb3cgcmV0cnlcbiAqIHBlcm1pc3Npb25EZW5pZWRPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHsgcmV0cnk6IHRydWUgfVxuICogfSk7XG4gKlxuICogLy8gTG9nIHdpdGhvdXQgcmV0cnlcbiAqIHBlcm1pc3Npb25EZW5pZWRPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBwZXJtaXNzaW9uRGVuaWVkT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJQZXJtaXNzaW9uRGVuaWVkXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgU2V0dXAgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFNldHVwT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBBZGQgY29udGV4dCBkdXJpbmcgc2V0dXBcbiAqIHNldHVwT3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgYWRkaXRpb25hbENvbnRleHQ6ICdQcm9qZWN0IGluaXRpYWxpemVkIHdpdGggY3VzdG9tIHNldHRpbmdzJ1xuICogICB9XG4gKiB9KTtcbiAqXG4gKiAvLyBTaW1wbGUgcGFzc3Rocm91Z2hcbiAqIHNldHVwT3V0cHV0KHt9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3Qgc2V0dXBPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIlNldHVwXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgVGVhbW1hdGVJZGxlIGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBUZWFtbWF0ZUlkbGVPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEFsbG93IHRlYW1tYXRlIHRvIGdvIGlkbGVcbiAqIHRlYW1tYXRlSWRsZU91dHB1dCh7fSk7XG4gKlxuICogLy8gQmxvY2sgd2l0aCBmZWVkYmFja1xuICogdGVhbW1hdGVJZGxlT3V0cHV0KHsgc3RkZXJyOiAnQ29udGludWUgd29ya2luZzogdW5maW5pc2hlZCB0YXNrcyByZW1haW4uJyB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgdGVhbW1hdGVJZGxlT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUV4aXRDb2RlT3V0cHV0QnVpbGRlcihcIlRlYW1tYXRlSWRsZVwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFRhc2tDcmVhdGVkIGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBUYXNrQ3JlYXRlZE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQWxsb3cgdGFzayBjcmVhdGlvblxuICogdGFza0NyZWF0ZWRPdXRwdXQoe30pO1xuICpcbiAqIC8vIEJsb2NrIHdpdGggZmVlZGJhY2tcbiAqIHRhc2tDcmVhdGVkT3V0cHV0KHsgc3RkZXJyOiAnQ2Fubm90IGNyZWF0ZSB0YXNrOiBtaXNzaW5nIHJlcXVpcmVkIGZpZWxkcy4nIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCB0YXNrQ3JlYXRlZE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVFeGl0Q29kZU91dHB1dEJ1aWxkZXIoXCJUYXNrQ3JlYXRlZFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFRhc2tDb21wbGV0ZWQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFRhc2tDb21wbGV0ZWRPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEFsbG93IHRhc2sgY29tcGxldGlvblxuICogdGFza0NvbXBsZXRlZE91dHB1dCh7fSk7XG4gKlxuICogLy8gQmxvY2sgd2l0aCBmZWVkYmFja1xuICogdGFza0NvbXBsZXRlZE91dHB1dCh7IHN0ZGVycjogJ0Nhbm5vdCBjb21wbGV0ZTogdGVzdHMgYXJlIGZhaWxpbmcuJyB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgdGFza0NvbXBsZXRlZE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVFeGl0Q29kZU91dHB1dEJ1aWxkZXIoXCJUYXNrQ29tcGxldGVkXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgRWxpY2l0YXRpb24gaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBbiBFbGljaXRhdGlvbk91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQWNjZXB0IHRoZSBlbGljaXRhdGlvblxuICogZWxpY2l0YXRpb25PdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHsgYWN0aW9uOiAnYWNjZXB0JywgY29udGVudDogeyB1c2VybmFtZTogJ2FsaWNlJyB9IH1cbiAqIH0pO1xuICpcbiAqIC8vIERlY2xpbmUgdGhlIGVsaWNpdGF0aW9uXG4gKiBlbGljaXRhdGlvbk91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDogeyBhY3Rpb246ICdkZWNsaW5lJyB9XG4gKiB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgZWxpY2l0YXRpb25PdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIkVsaWNpdGF0aW9uXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgRWxpY2l0YXRpb25SZXN1bHQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBbiBFbGljaXRhdGlvblJlc3VsdE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogZWxpY2l0YXRpb25SZXN1bHRPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBlbGljaXRhdGlvblJlc3VsdE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiRWxpY2l0YXRpb25SZXN1bHRcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBDb25maWdDaGFuZ2UgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIENvbmZpZ0NoYW5nZU91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogY29uZmlnQ2hhbmdlT3V0cHV0KHt9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgY29uZmlnQ2hhbmdlT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZVNpbXBsZU91dHB1dEJ1aWxkZXIoXCJDb25maWdDaGFuZ2VcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBJbnN0cnVjdGlvbnNMb2FkZWQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBbiBJbnN0cnVjdGlvbnNMb2FkZWRPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGluc3RydWN0aW9uc0xvYWRlZE91dHB1dCh7fSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IGluc3RydWN0aW9uc0xvYWRlZE91dHB1dCA9IFxuLyogQF9fUFVSRV9fICovIGNyZWF0ZVNpbXBsZU91dHB1dEJ1aWxkZXIoXCJJbnN0cnVjdGlvbnNMb2FkZWRcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBXb3JrdHJlZUNyZWF0ZSBob29rcy5cbiAqXG4gKiBUaGUgcnVudGltZSB3cml0ZXMgYHdvcmt0cmVlUGF0aGAgdG8gc3Rkb3V0IGFzIHBsYWluIHRleHQgKG5vdCBKU09OKSBzbyBDbGF1ZGUgQ29kZVxuICogY2FuIGBjaGRpcmAgaW50byB0aGUgY3JlYXRlZCB3b3JrdHJlZS5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgV29ya3RyZWVDcmVhdGVPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIHdvcmt0cmVlQ3JlYXRlT3V0cHV0KHsgd29ya3RyZWVQYXRoOiAnL2Ficy9wYXRoL3RvL3dvcmt0cmVlJyB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3Qgd29ya3RyZWVDcmVhdGVPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlV29ya3RyZWVPdXRwdXRCdWlsZGVyKFwiV29ya3RyZWVDcmVhdGVcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBXb3JrdHJlZVJlbW92ZSBob29rcy5cbiAqXG4gKiBXaGVuIGB3b3JrdHJlZVBhdGhgIGlzIHN1cHBsaWVkLCB0aGUgcnVudGltZSB3cml0ZXMgaXQgdG8gc3Rkb3V0IGFzIHBsYWluIHRleHQgKG5vdFxuICogSlNPTiksIG1hdGNoaW5nIHRoZSB3b3JrdHJlZSBjb21tYW5kLWhvb2sgcHJvdG9jb2wuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFdvcmt0cmVlUmVtb3ZlT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBQbGFpbi10ZXh0IHBhdGggcHJvdG9jb2xcbiAqIHdvcmt0cmVlUmVtb3ZlT3V0cHV0KHsgd29ya3RyZWVQYXRoOiAnL2Ficy9wYXRoL3RvL3dvcmt0cmVlJyB9KTtcbiAqXG4gKiAvLyBObyBwYXRoIHBheWxvYWRcbiAqIHdvcmt0cmVlUmVtb3ZlT3V0cHV0KHt9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3Qgd29ya3RyZWVSZW1vdmVPdXRwdXQgPSAob3B0aW9ucyA9IHt9KSA9PiB7XG4gICAgY29uc3QgeyB3b3JrdHJlZVBhdGgsIC4uLnJlc3QgfSA9IG9wdGlvbnM7XG4gICAgcmV0dXJuIHdvcmt0cmVlUGF0aCAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8geyBfdHlwZTogXCJXb3JrdHJlZVJlbW92ZVwiLCBzdGRvdXQ6IHJlc3QsIHJhd1N0ZG91dDogd29ya3RyZWVQYXRoIH1cbiAgICAgICAgOiB7IF90eXBlOiBcIldvcmt0cmVlUmVtb3ZlXCIsIHN0ZG91dDogcmVzdCB9O1xufTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIEN3ZENoYW5nZWQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIEN3ZENoYW5nZWRPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIFJldHVybiBhZGRpdGlvbmFsIHBhdGhzIHRvIHdhdGNoIGFmdGVyIHRoZSBjd2QgY2hhbmdlXG4gKiBjd2RDaGFuZ2VkT3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgd2F0Y2hQYXRoczogWycvbmV3L3BhdGgvdG8vd2F0Y2gnXVxuICogICB9XG4gKiB9KTtcbiAqXG4gKiAvLyBTaW1wbGUgcGFzc3Rocm91Z2hcbiAqIGN3ZENoYW5nZWRPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBjd2RDaGFuZ2VkT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJDd2RDaGFuZ2VkXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgRmlsZUNoYW5nZWQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIEZpbGVDaGFuZ2VkT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBVcGRhdGUgdGhlIHNldCBvZiB3YXRjaGVkIHBhdGhzXG4gKiBmaWxlQ2hhbmdlZE91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDoge1xuICogICAgIHdhdGNoUGF0aHM6IFsnL3BhdGgvdG8vd2F0Y2gnLCAnL2Fub3RoZXIvcGF0aCddXG4gKiAgIH1cbiAqIH0pO1xuICpcbiAqIC8vIFNpbXBsZSBwYXNzdGhyb3VnaFxuICogZmlsZUNoYW5nZWRPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBmaWxlQ2hhbmdlZE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiRmlsZUNoYW5nZWRcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBNZXNzYWdlRGlzcGxheSBob29rcy5cbiAqXG4gKiBNZXNzYWdlRGlzcGxheSBpcyBkaXNwbGF5LW9ubHk6IHRoZSBgZGlzcGxheUNvbnRlbnRgIGZpZWxkIHJlcGxhY2VzIHRoZSBkZWx0YSBvblxuICogc2NyZWVuIHdpdGhvdXQgY2hhbmdpbmcgdGhlIHN0b3JlZCBtZXNzYWdlIG9yIHdoYXQgdGhlIG1vZGVsIHNlZXMuIE9taXRcbiAqIGBkaXNwbGF5Q29udGVudGAgKG9yIHNldCBpdCB0byB0aGUgb3JpZ2luYWwgZGVsdGEpIHRvIGxlYXZlIHRoZSBkaXNwbGF5IHVuY2hhbmdlZC5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgTWVzc2FnZURpc3BsYXlPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIFJlcGxhY2UgdGhlIGRlbHRhIHNob3duIG9uIHNjcmVlblxuICogbWVzc2FnZURpc3BsYXlPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHsgZGlzcGxheUNvbnRlbnQ6IFwiW3JlZGFjdGVkXVwiIH1cbiAqIH0pO1xuICpcbiAqIC8vIFBhc3N0aHJvdWdoIChubyBkaXNwbGF5IG1vZGlmaWNhdGlvbilcbiAqIG1lc3NhZ2VEaXNwbGF5T3V0cHV0KHt9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgbWVzc2FnZURpc3BsYXlPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIk1lc3NhZ2VEaXNwbGF5XCIpO1xuIiwgIi8qKlxuICogUnVudGltZSBtb2R1bGUgZm9yIENsYXVkZSBDb2RlIGhvb2tzLlxuICpcbiAqIEhhbmRsZXMgc3RkaW4vc3Rkb3V0L2V4aXQgY29kZSBzZW1hbnRpY3MgZm9yIGNvbXBpbGVkIGhvb2sgZXhlY3V0aW9uLlxuICogVGhpcyBtb2R1bGUgaXMgdGhlIGNvcmUgb3JjaGVzdHJhdG9yIHRoYXQ6XG4gKiAtIFJlYWRzIEpTT04gZnJvbSBzdGRpbiAod2lyZSBmb3JtYXQgd2l0aCBzbmFrZV9jYXNlIHByb3BlcnRpZXMpXG4gKiAtIEludm9rZXMgdGhlIGhvb2sgaGFuZGxlclxuICogLSBXcml0ZXMgb3V0cHV0IHRvIHN0ZG91dFxuICogLSBNYW5hZ2VzIGV4aXQgY29kZXNcbiAqIEBtb2R1bGVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBJbiBhIGNvbXBpbGVkIGhvb2sgZmlsZVxuICogaW1wb3J0IHsgZXhlY3V0ZSB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcy9ydW50aW1lJztcbiAqIGltcG9ydCBteUhvb2sgZnJvbSAnLi9teS1ob29rLmpzJztcbiAqXG4gKiBleGVjdXRlKG15SG9vayk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rc1xuICovXG5pbXBvcnQgeyBwZXJzaXN0RW52VmFyLCBwZXJzaXN0RW52VmFycyB9IGZyb20gXCIuL2Vudi5qc1wiO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSBcIi4vbG9nZ2VyLmpzXCI7XG5pbXBvcnQgeyBFWElUX0NPREVTIH0gZnJvbSBcIi4vb3V0cHV0cy5qc1wiO1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU3RkaW4vU3Rkb3V0IEhhbmRsaW5nXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIFJlYWRzIGFsbCBkYXRhIGZyb20gc3RkaW4uXG4gKiBAcmV0dXJucyBQcm9taXNlIHJlc29sdmluZyB0byB0aGUgY29tcGxldGUgc3RkaW4gY29udGVudFxuICovXG5hc3luYyBmdW5jdGlvbiByZWFkU3RkaW4oKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgY2h1bmtzID0gW107XG4gICAgICAgIC8vIFNldCBlbmNvZGluZyBmaXJzdCB0byBlbnN1cmUgZGF0YSBldmVudHMgcmVjZWl2ZSBzdHJpbmdzXG4gICAgICAgIHByb2Nlc3Muc3RkaW4uc2V0RW5jb2RpbmcoXCJ1dGYtOFwiKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImRhdGFcIiwgKGNodW5rKSA9PiB7XG4gICAgICAgICAgICBjaHVua3MucHVzaChjaHVuayk7XG4gICAgICAgIH0pO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZW5kXCIsICgpID0+IHtcbiAgICAgICAgICAgIHJlc29sdmUoY2h1bmtzLmpvaW4oXCJcIikpO1xuICAgICAgICB9KTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgICAgICAgcmVqZWN0KGVycm9yKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG59XG4vKipcbiAqIFBhcnNlcyBzdGRpbiBKU09OIGlucHV0LlxuICogQHBhcmFtIHN0ZGluQ29udGVudCAtIFJhdyBzdGRpbiBjb250ZW50XG4gKiBAcmV0dXJucyBQYXJzZWQgaW5wdXQgKHdpcmUgZm9ybWF0IHdpdGggc25ha2VfY2FzZSBwcm9wZXJ0aWVzKVxuICogQHRocm93cyBFcnJvciBpZiBKU09OIGlzIG1hbGZvcm1lZFxuICovXG5mdW5jdGlvbiBwYXJzZVN0ZGluSW5wdXQoc3RkaW5Db250ZW50KSB7XG4gICAgLy8gUGFyc2UgSlNPTiAtIGlucHV0IHVzZXMgd2lyZSBmb3JtYXQgKHNuYWtlX2Nhc2UpIGRpcmVjdGx5XG4gICAgY29uc3QgcmF3SW5wdXQgPSBKU09OLnBhcnNlKHN0ZGluQ29udGVudCk7XG4gICAgcmV0dXJuIHJhd0lucHV0O1xufVxuLyoqXG4gKiBXcml0ZXMgaG9vayBvdXRwdXQgdG8gc3Rkb3V0LlxuICpcbiAqIE91dHB1dCB1c2VzIGNhbWVsQ2FzZSBrZXlzIHBlciBDbGF1ZGUgQ29kZSBob29rIHNwZWNpZmljYXRpb24uXG4gKiBAcGFyYW0gb3V0cHV0IC0gVGhlIGhvb2sgb3V0cHV0IHRvIHdyaXRlXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjaG9vay1vdXRwdXQtc3RydWN0dXJlXG4gKi9cbmZ1bmN0aW9uIHdyaXRlU3Rkb3V0KG91dHB1dCkge1xuICAgIC8vIE91dHB1dCB1c2VzIGNhbWVsQ2FzZSAtIG5vIHRyYW5zZm9ybWF0aW9uIG5lZWRlZFxuICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKEpTT04uc3RyaW5naWZ5KG91dHB1dCkpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRXJyb3IgSGFuZGxpbmdcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhbiBlcnJvciBvdXRwdXQgZm9yIG1hbGZvcm1lZCBzdGRpbiBKU09OLlxuICogQHBhcmFtIGVycm9yIC0gVGhlIHBhcnNlIGVycm9yXG4gKiBAcmV0dXJucyBIb29rT3V0cHV0IHdpdGggZW1wdHkgc3Rkb3V0XG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZU1hbGZvcm1lZElucHV0T3V0cHV0KGVycm9yKSB7XG4gICAgbG9nZ2VyLmVycm9yKGBJbnZhbGlkIEpTT04gaW5wdXQ6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApO1xuICAgIHJldHVybiB7IHN0ZG91dDoge30gfTtcbn1cbi8qKlxuICogV3JpdGVzIGhhbmRsZXIgZXJyb3Igc3RhY2t0cmFjZSB0byBzdGRlcnIgYW5kIGV4aXRzIHdpdGggY29kZSAyLlxuICpcbiAqIFdoZW4gYSBob29rIGhhbmRsZXIgdGhyb3dzIGFuIGV4Y2VwdGlvbjpcbiAqIC0gU3RhY2t0cmFjZSAod2l0aCBzb3VyY2VtYXBzIGlmIGF2YWlsYWJsZSkgaXMgb3V0cHV0IHRvIHN0ZGVyclxuICogLSBQcm9jZXNzIGV4aXRzIHdpdGggY29kZSAyIChCTE9DSylcbiAqIC0gTm8gSlNPTiBpcyBvdXRwdXQgdG8gc3Rkb3V0XG4gKiBAcGFyYW0gZXJyb3IgLSBUaGUgZXJyb3IgdGhyb3duIGJ5IHRoZSBoYW5kbGVyXG4gKi9cbmZ1bmN0aW9uIGhhbmRsZUhhbmRsZXJFcnJvcihlcnJvcikge1xuICAgIC8vIFdyaXRlIHN0YWNrIHRyYWNlIHRvIHN0ZGVyciAoc291cmNlbWFwcyBhcmUgYXBwbGllZCBhdXRvbWF0aWNhbGx5IGJ5IE5vZGUuanMpXG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYCR7ZXJyb3Iuc3RhY2sgPz8gZXJyb3IubWVzc2FnZX1cXG5gKTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke1N0cmluZyhlcnJvcil9XFxuYCk7XG4gICAgfVxuICAgIC8vIExvZyB0byBmaWxlIGlmIGNvbmZpZ3VyZWRcbiAgICBsb2dnZXIuZXJyb3IoYEhvb2sgaGFuZGxlciBlcnJvcjogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gICAgLy8gQ2xlYXIgbG9nZ2VyIGNvbnRleHQgYW5kIGNsb3NlXG4gICAgbG9nZ2VyLmNsZWFyQ29udGV4dCgpO1xuICAgIGxvZ2dlci5jbG9zZSgpO1xuICAgIC8vIEV4aXQgd2l0aCBjb2RlIDIgKEJMT0NLKSAtIG5vIEpTT04gb3V0cHV0XG4gICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuQkxPQ0spO1xufVxuLyoqXG4gKiBDb252ZXJ0cyBhIFNwZWNpZmljSG9va091dHB1dCB0byBIb29rT3V0cHV0IGZvciB3aXJlIGZvcm1hdC5cbiAqXG4gKiBTcGVjaWZpY0hvb2tPdXRwdXQgdHlwZXMgaGF2ZTogeyBfdHlwZSwgc3Rkb3V0LCBzdGRlcnI/IH1cbiAqIEhvb2tPdXRwdXQgaGFzOiB7IHN0ZG91dCwgc3RkZXJyPyB9XG4gKlxuICogU2luY2Ugb3V0cHV0IGJ1aWxkZXJzIG5vdyBwcm9kdWNlIHdpcmUtZm9ybWF0IGRpcmVjdGx5LCB0aGlzIGZ1bmN0aW9uXG4gKiBzaW1wbHkgc3RyaXBzIHRoZSBgX3R5cGVgIGRpc2NyaW1pbmF0b3IgZmllbGQuXG4gKiBAcGFyYW0gc3BlY2lmaWNPdXRwdXQgLSBUaGUgc3BlY2lmaWMgb3V0cHV0IGZyb20gYSBob29rIGhhbmRsZXJcbiAqIEByZXR1cm5zIEhvb2tPdXRwdXQgcmVhZHkgZm9yIHNlcmlhbGl6YXRpb25cbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNob29rLW91dHB1dC1zdHJ1Y3R1cmVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCBzcGVjaWZpY091dHB1dCA9IHByZVRvb2xVc2VPdXRwdXQoeyBob29rU3BlY2lmaWNPdXRwdXQ6IHsgcGVybWlzc2lvbkRlY2lzaW9uOiAnYWxsb3cnIH0gfSk7XG4gKiBjb25zdCBob29rT3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChzcGVjaWZpY091dHB1dCk7XG4gKiAvLyBob29rT3V0cHV0OiB7IHN0ZG91dDogeyBob29rU3BlY2lmaWNPdXRwdXQ6IHsgLi4uIH0gfSB9XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbnZlcnRUb0hvb2tPdXRwdXQoc3BlY2lmaWNPdXRwdXQpIHtcbiAgICBjb25zdCB7IHN0ZG91dCwgc3RkZXJyLCByYXdTdGRvdXQgfSA9IHNwZWNpZmljT3V0cHV0O1xuICAgIGNvbnN0IHJlc3VsdCA9IHsgc3Rkb3V0IH07XG4gICAgaWYgKHN0ZGVyciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJlc3VsdC5zdGRlcnIgPSBzdGRlcnI7XG4gICAgfVxuICAgIGlmIChyYXdTdGRvdXQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXN1bHQucmF3U3Rkb3V0ID0gcmF3U3Rkb3V0O1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRXhlY3V0ZSBGdW5jdGlvblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBFeGVjdXRlcyBhIGhvb2sgaGFuZGxlciB3aXRoIGZ1bGwgcnVudGltZSBvcmNoZXN0cmF0aW9uLlxuICpcbiAqIFRoaXMgaXMgdGhlIG1haW4gZW50cnkgcG9pbnQgdGhhdCBjb21waWxlZCBob29rcyB1c2UuIFdoZW4gYSBjb21waWxlZCBob29rXG4gKiBydW5zIGFzIGEgQ0xJOlxuICpcbiAqIDEuIFJlYWRzIGFsbCBzdGRpblxuICogMi4gUGFyc2VzIEpTT04gKHdpcmUgZm9ybWF0IHdpdGggc25ha2VfY2FzZSBwcm9wZXJ0aWVzKVxuICogMy4gU2V0cyB1cCBsb2dnZXIgY29udGV4dCAoaG9va1R5cGUsIGlucHV0KVxuICogNC4gQ2FsbHMgaGFuZGxlciB3aXRoIGlucHV0IGFuZCBjb250ZXh0IChsb2dnZXIpXG4gKiA1LiBIYW5kbGVzIGFueSBlcnJvcnMsIGxvZ3MgdGhlbVxuICogNi4gV3JpdGVzIEpTT04gdG8gc3Rkb3V0XG4gKiA3LiBDbG9zZXMgbG9nZ2VyXG4gKiA4LiBFeGl0cyB3aXRoIGFwcHJvcHJpYXRlIGNvZGVcbiAqIEBwYXJhbSBob29rRm4gLSBUaGUgaG9vayBmdW5jdGlvbiB0byBleGVjdXRlIChmcm9tIGhvb2sgZmFjdG9yeSlcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBJbiBjb21waWxlZCBob29rIGZpbGVcbiAqIGltcG9ydCB7IGV4ZWN1dGUgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MvcnVudGltZSc7XG4gKiBpbXBvcnQgeyBwcmVUb29sVXNlSG9vaywgcHJlVG9vbFVzZU91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogY29uc3QgbXlIb29rID0gcHJlVG9vbFVzZUhvb2soeyBtYXRjaGVyOiAnQmFzaCcgfSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdQcm9jZXNzaW5nIEJhc2ggY29tbWFuZCcpO1xuICogICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7IGFsbG93OiB0cnVlIH0pO1xuICogfSk7XG4gKlxuICogZXhlY3V0ZShteUhvb2spO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3NcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGV4ZWN1dGUoaG9va0ZuKSB7XG4gICAgbGV0IG91dHB1dDtcbiAgICB0cnkge1xuICAgICAgICAvLyBSZWFkIGFuZCBwYXJzZSBzdGRpblxuICAgICAgICBsZXQgc3RkaW5Db250ZW50O1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgc3RkaW5Db250ZW50ID0gYXdhaXQgcmVhZFN0ZGluKCk7XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBsb2dnZXIubG9nRXJyb3IoZXJyb3IsIFwiRmFpbGVkIHRvIHJlYWQgc3RkaW5cIik7XG4gICAgICAgICAgICBvdXRwdXQgPSBjcmVhdGVNYWxmb3JtZWRJbnB1dE91dHB1dChlcnJvcik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgLy8gUGFyc2UgYW5kIHRyYW5zZm9ybSBpbnB1dFxuICAgICAgICBsZXQgaW5wdXQ7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBpbnB1dCA9IHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgbG9nZ2VyLmxvZ0Vycm9yKGVycm9yLCBcIkZhaWxlZCB0byBwYXJzZSBzdGRpbiBKU09OXCIpO1xuICAgICAgICAgICAgb3V0cHV0ID0gY3JlYXRlTWFsZm9ybWVkSW5wdXRPdXRwdXQoZXJyb3IpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIC8vIFNldCBsb2dnZXIgY29udGV4dFxuICAgICAgICBjb25zdCBob29rRXZlbnROYW1lID0gaG9va0ZuLmhvb2tFdmVudE5hbWU7XG4gICAgICAgIGxvZ2dlci5zZXRDb250ZXh0KGhvb2tFdmVudE5hbWUsIGlucHV0KTtcbiAgICAgICAgLy8gQnVpbGQgY29udGV4dCAtIFNlc3Npb25TdGFydCBob29rcyBnZXQgZXh0ZW5kZWQgY29udGV4dCB3aXRoIHBlcnNpc3RFbnZWYXJcbiAgICAgICAgY29uc3QgY29udGV4dCA9IGhvb2tFdmVudE5hbWUgPT09IFwiU2Vzc2lvblN0YXJ0XCIgPyB7IGxvZ2dlciwgcGVyc2lzdEVudlZhciwgcGVyc2lzdEVudlZhcnMgfSA6IHsgbG9nZ2VyIH07XG4gICAgICAgIC8vIEV4ZWN1dGUgaGFuZGxlclxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3Qgc3BlY2lmaWNPdXRwdXQgPSBhd2FpdCBob29rRm4oaW5wdXQsIGNvbnRleHQpO1xuICAgICAgICAgICAgaWYgKHNwZWNpZmljT3V0cHV0ICE9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgb3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChzcGVjaWZpY091dHB1dCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAvLyBIYW5kbGVyIHRocmV3IC0gb3V0cHV0IHN0YWNrdHJhY2UgdG8gc3RkZXJyIGFuZCBleGl0IHdpdGggY29kZSAyXG4gICAgICAgICAgICAvLyBUaGlzIGNhbGwgbmV2ZXIgcmV0dXJucyAocHJvY2Vzcy5leGl0KVxuICAgICAgICAgICAgaGFuZGxlSGFuZGxlckVycm9yKGVycm9yKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBmaW5hbGx5IHtcbiAgICAgICAgLy8gV3JpdGUgb3V0cHV0IGlmIHdlIGhhdmUgaXQuIENvbW1hbmQgaG9va3Mgd2l0aCBhIHBsYWluLXRleHQgcHJvdG9jb2wgKGUuZy5cbiAgICAgICAgLy8gV29ya3RyZWVDcmVhdGUsIHdoZXJlIENsYXVkZSBDb2RlIHJlYWRzIHN0ZG91dCBhcyB0aGUgd29ya3RyZWUgcGF0aCBhbmQgY2hkaXJzXG4gICAgICAgIC8vIGludG8gaXQpIGNhcnJ5IHRoZWlyIHBheWxvYWQgaW4gYHJhd1N0ZG91dGAgYW5kIGJ5cGFzcyBKU09OIHNlcmlhbGl6YXRpb24uXG4gICAgICAgIGlmIChvdXRwdXQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgaWYgKG91dHB1dC5yYXdTdGRvdXQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKG91dHB1dC5yYXdTdGRvdXQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgd3JpdGVTdGRvdXQob3V0cHV0LnN0ZG91dCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgLy8gQ2xlYW4gdXAgbG9nZ2VyIChzaW5nbGUgY2xlYW51cCBwYXRoKVxuICAgICAgICBsb2dnZXIuY2xlYXJDb250ZXh0KCk7XG4gICAgICAgIGxvZ2dlci5jbG9zZSgpO1xuICAgICAgICAvLyBFeGl0LWNvZGUgQkxPQ0s6IHVubGlrZSBoYW5kbGVyIHRocm93IChubyBzdGRvdXQpLCB0aGlzIHBhdGggc3RpbGwgd3JpdGVzXG4gICAgICAgIC8vIHN0cnVjdHVyZWQgSlNPTiB0byBzdGRvdXQgKGFzIGVtcHR5IHt9KSBhbG9uZ3NpZGUgdGhlIHN0ZGVyciBtZXNzYWdlLlxuICAgICAgICAvLyBUaGUgY2FsbGVyIGNvbnRyb2xzIHN0ZGVyciBmb3JtYXR0aW5nIChubyBhcHBlbmRlZCBuZXdsaW5lKS5cbiAgICAgICAgaWYgKG91dHB1dD8uc3RkZXJyICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKG91dHB1dC5zdGRlcnIpO1xuICAgICAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuQkxPQ0spO1xuICAgICAgICB9XG4gICAgICAgIC8vIEV4aXQgd2l0aCBzdWNjZXNzIChoYW5kbGVyIGVycm9ycyBleGl0IHZpYSBoYW5kbGVIYW5kbGVyRXJyb3Igd2l0aCBjb2RlIDIpXG4gICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLlNVQ0NFU1MpO1xuICAgIH1cbn1cbiIsICIvKipcbiAqIFNoYXJlZCBoZWxwZXJzIHVzZWQgYnkgbXVsdGlwbGUgYWdlbnQtaG9va3MgZW50cnkgcG9pbnRzLlxuICpcbiAqIEV4dHJhY3RlZCBmcm9tIHByZS10b29sLXVzZS50cyBzbyB0aGF0IHRoZSB1cGNvbWluZyBTdG9wIGhvb2sgKGFuZCBhbnlcbiAqIGZ1dHVyZSBob29rcykgY2FuIGltcG9ydCBwYXRoIHV0aWxpdGllcywgcmFuZ2UgaGVscGVycywgYW5kIHRoZVxuICogc2FuaXRpemVTZXNzaW9uSWQvZm9ybWF0QW5jaG9yIGZ1bmN0aW9ucyB3aXRob3V0IGRlcGVuZGluZyBvbiB0aGVcbiAqIFByZVRvb2xVc2Utc3BlY2lmaWMgbW9kdWxlLlxuICovXG5cbmltcG9ydCB7IGV4ZWNGaWxlU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG9zIGZyb20gJ25vZGU6b3MnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQYXRoIGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgZnVuY3Rpb24gdG9Qb3NpeChwOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG59XG5cbmZ1bmN0aW9uIGlzQWJzb2x1dGVQb3NpeChwOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHAuc3RhcnRzV2l0aCgnLycpIHx8IC9eW0EtWmEtel06XFwvLy50ZXN0KHApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYWJzcGF0aEFnYWluc3QoYmFzZTogc3RyaW5nLCB0YXJnZXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHQgPSB0b1Bvc2l4KHRhcmdldCk7XG4gIGlmIChpc0Fic29sdXRlUG9zaXgodCkpIHJldHVybiB0O1xuICBjb25zdCBiID0gdG9Qb3NpeChiYXNlKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgcmV0dXJuIGAke2J9LyR7dH1gO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVJlcG9Sb290KGRpcjogc3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbCk6IHN0cmluZyB8IG51bGwge1xuICBpZiAoIWRpcikgcmV0dXJuIG51bGw7XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgZGlyLCAncmV2LXBhcnNlJywgJy0tc2hvdy10b3BsZXZlbCddLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIGVuY29kaW5nOiAndXRmOCdcbiAgICB9KTtcbiAgICBjb25zdCB0cmltbWVkID0gb3V0LnRyaW0oKTtcbiAgICByZXR1cm4gdHJpbW1lZC5sZW5ndGggPiAwID8gdG9Qb3NpeCh0cmltbWVkKSA6IG51bGw7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbi8qKlxuICogUmVwb3J0IHdoZXRoZXIgYSByZXBvLXJlbGF0aXZlIHBhdGggaXMgZXhjbHVkZWQgYnkgZ2l0J3MgaWdub3JlIHJ1bGVzXG4gKiAoLmdpdGlnbm9yZSwgLmdpdC9pbmZvL2V4Y2x1ZGUsIGNvcmUuZXhjbHVkZXNGaWxlKS4gVXNlZCB0byBrZWVwIGlnbm9yZWRcbiAqIGZpbGVzIFx1MjAxNCBidWlsZCBvdXRwdXQsIGNhY2hlcywgbG9ncyBcdTIwMTQgb3V0IG9mIHRvdWNoIHRyYWNraW5nIGVudGlyZWx5LCBzb1xuICogdGhlIHRvdWNoIGhvb2sgbmV2ZXIgcmVwb3J0cyByZWFkcywgd3JpdGVzLCBvciB1bmNvdmVyZWQgd3JpdGVzIG9uIHRoZW0uXG4gKlxuICogYGdpdCBjaGVjay1pZ25vcmUgLXEgPHBhdGg+YCBleGl0cyAwIHdoZW4gdGhlIHBhdGggaXMgaWdub3JlZCwgMSB3aGVuIGl0IGlzXG4gKiBub3QsIGFuZCAxMjggb24gZXJyb3IuIGV4ZWNGaWxlU3luYyB0aHJvd3Mgb24gYW55IG5vbi16ZXJvIGV4aXQsIHNvIGEgY2xlYW5cbiAqIHJldHVybiBtZWFucyBcImlnbm9yZWRcIi4gQSBzdGF0dXMtMSB0aHJvdyBpcyB0aGUgZXhwZWN0ZWQgXCJub3QgaWdub3JlZFwiXG4gKiBzaWduYWw7IGFueSBvdGhlciBmYWlsdXJlIGlzIGFuIHVucmVsaWFibGUgYW5zd2VyLCBzbyB3ZSByZXBvcnQgYGZhbHNlYFxuICogKGRvIG5vdCBkcm9wIHRoZSB0b3VjaCkgcmF0aGVyIHRoYW4gc2lsZW50bHkgaGlkaW5nIGEgdHJhY2tlZCBmaWxlLlxuICovXG4vKipcbiAqIFRoZSBkZWZhdWx0IHNwYW4gcm9vdCBkaXJlY3RvcnksIHJlbGF0aXZlIHRvIHRoZSByZXBvIHJvb3QsIHVzZWQgd2hlbiBub1xuICogZW52aXJvbm1lbnQgdmFyaWFibGUgb3IgZ2l0IGNvbmZpZyBvdmVycmlkZXMgdGhlIGxvY2F0aW9uLlxuICovXG5leHBvcnQgY29uc3QgU1BBTl9ST09UID0gJy5zcGFuJztcblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBzcGFuIHJvb3QgZGlyZWN0b3J5IGZvciBhIGdpdmVuIHJlcG8sIG1pcnJvcmluZyB0aGUgUnVzdCBDTElcbiAqIHByZWNlZGVuY2UgKG1pbnVzIHRoZSAtLXNwYW4tZGlyIENMSSBmbGFnLCB3aGljaCBpcyBpbnZpc2libGUgdG8gZmlsZS13cml0ZVxuICogaG9va3MpOlxuICogICAxLiBHSVRfU1BBTl9ESVIgZW52aXJvbm1lbnQgdmFyaWFibGVcbiAqICAgMi4gYGdpdCBjb25maWcgZ2l0LXNwYW4uZGlyYCBpbiB0aGUgcmVwb1xuICogICAzLiBEZWZhdWx0OiBcIi5zcGFuXCJcbiAqXG4gKiBUaGUgcmV0dXJuZWQgdmFsdWUgaXMgYSBQT1NJWC1zdHlsZSBwYXRoIHdpdGggbm8gdHJhaWxpbmcgc2xhc2guXG4gKiBGYWlsLXNhZmU6IGFueSByZXNvbHV0aW9uIGVycm9yIGZhbGxzIGJhY2sgdG8gXCIuc3BhblwiIHNvIHRoZSBob29rIG5ldmVyXG4gKiBjcmFzaGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBlbnZEaXIgPSBwcm9jZXNzLmVudlsnR0lUX1NQQU5fRElSJ107XG4gIGlmIChlbnZEaXIgJiYgZW52RGlyLnRyaW0oKS5sZW5ndGggPiAwKSB7XG4gICAgcmV0dXJuIHRvUG9zaXgoZW52RGlyLnRyaW0oKSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIH1cbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ2NvbmZpZycsICdnaXQtc3Bhbi5kaXInXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnXG4gICAgfSk7XG4gICAgY29uc3QgdHJpbW1lZCA9IHRvUG9zaXgob3V0LnRyaW0oKSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gICAgaWYgKHRyaW1tZWQubGVuZ3RoID4gMCkgcmV0dXJuIHRyaW1tZWQ7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHZvaWQgZXJyOyAvLyBjb25maWcga2V5IGFic2VudCBvciBnaXQgZXJyb3IgXHUyMDE0IGZhbGwgdGhyb3VnaCB0byBkZWZhdWx0XG4gIH1cbiAgcmV0dXJuIFNQQU5fUk9PVDtcbn1cblxuLyoqXG4gKiBSZXBvcnQgd2hldGhlciBhIHJlcG8tcmVsYXRpdmUgUE9TSVggcGF0aCBmYWxscyBpbnNpZGUgdGhlIGdpdmVuIHNwYW4gcm9vdFxuICogZGlyZWN0b3J5LiBBIHBhdGggaXMgaW5zaWRlIHdoZW4gaXQgZXF1YWxzIHRoZSBzcGFuIHJvb3QgZXhhY3RseSBvciBpc1xuICogbmVzdGVkIGJlbmVhdGggaXQgKGkuZS4gc3RhcnRzIHdpdGggXCI8c3BhblJvb3Q+L1wiKS4gVGhlIFwiL1wiIGJvdW5kYXJ5IHByZXZlbnRzXG4gKiBmYWxzZSBwb3NpdGl2ZXMgZm9yIHNpYmxpbmdzIGxpa2UgXCIuc3BhbnMveFwiIG9yIFwiLnNwYW4tbm90ZXMveFwiLlxuICpcbiAqIFBhc3MgdGhlIHJlc3VsdCBvZiBgcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290KWAgYXMgYHNwYW5Sb290YC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzSW5zaWRlU3BhblJvb3QocmVwb1JlbFBhdGg6IHN0cmluZywgc3BhblJvb3Q6IHN0cmluZyA9IFNQQU5fUk9PVCk6IGJvb2xlYW4ge1xuICBjb25zdCByb290ID0gc3BhblJvb3QucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIHJldHVybiByZXBvUmVsUGF0aCA9PT0gcm9vdCB8fCByZXBvUmVsUGF0aC5zdGFydHNXaXRoKGAke3Jvb3R9L2ApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNHaXRJZ25vcmVkKHJlcG9Sb290OiBzdHJpbmcsIHJlcG9SZWxQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ2NoZWNrLWlnbm9yZScsICctcScsICctLScsIHJlcG9SZWxQYXRoXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ2lnbm9yZScsICdpZ25vcmUnXVxuICAgIH0pO1xuICAgIHJldHVybiB0cnVlO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB2b2lkIGVycjtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290OiBzdHJpbmcsIGFic1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHJvb3QgPSB0b1Bvc2l4KHJlcG9Sb290KTtcbiAgY29uc3QgYWJzID0gdG9Qb3NpeChhYnNQYXRoKTtcbiAgY29uc3QgcHJlZml4ID0gcm9vdC5lbmRzV2l0aCgnLycpID8gcm9vdCA6IGAke3Jvb3R9L2A7XG4gIHJldHVybiBhYnMuc3RhcnRzV2l0aChwcmVmaXgpID8gYWJzLnNsaWNlKHByZWZpeC5sZW5ndGgpIDogYWJzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2Fub25pY2FsaXplUGF0aChhYnNQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICB0cnkge1xuICAgIHJldHVybiB0b1Bvc2l4KGZzLnJlYWxwYXRoU3luYy5uYXRpdmUoYWJzUGF0aCkpO1xuICB9IGNhdGNoIHtcbiAgICAvLyBGaWxlIGRvZXNuJ3QgZXhpc3QgeWV0IChlLmcuIFdyaXRlIHRvIGEgbmV3IGZpbGUpOiBjYW5vbmljYWxpemUgdGhlXG4gICAgLy8gZGlyZWN0b3J5IGFuZCByZWpvaW4gdGhlIGJhc2VuYW1lIHNvIHN5bWxpbmtzIGluIHRoZSBwYXJlbnQgYXJlIHJlc29sdmVkLlxuICAgIHRyeSB7XG4gICAgICBjb25zdCBkaXIgPSB0b1Bvc2l4KGZzLnJlYWxwYXRoU3luYy5uYXRpdmUobm9kZVBhdGguZGlybmFtZShhYnNQYXRoKSkpO1xuICAgICAgcmV0dXJuIGAke2Rpcn0vJHtub2RlUGF0aC5iYXNlbmFtZShhYnNQYXRoKX1gO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gUGFyZW50IGRvZXNuJ3QgZXhpc3QgZWl0aGVyOyBmYWxsIGJhY2sgdG8gdGhlIHVuLWNhbm9uaWNhbGl6ZWQgcGF0aC5cbiAgICAgIHJldHVybiBhYnNQYXRoO1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZGVyaXZlUGF0aCh0b29sSW5wdXQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBjd2Q6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCBmcCA9IHRvb2xJbnB1dC5maWxlX3BhdGg7XG4gIGlmICh0eXBlb2YgZnAgIT09ICdzdHJpbmcnIHx8IGZwLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGFicyA9IGFic3BhdGhBZ2FpbnN0KGN3ZCwgZnApO1xuICByZXR1cm4gY2Fub25pY2FsaXplUGF0aChhYnMpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIExpbmUgcmFuZ2UgdHlwZXMgYW5kIGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIExpbmVSYW5nZSB7XG4gIHN0YXJ0OiBudW1iZXI7XG4gIGVuZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmFuZ2VzSW50ZXJzZWN0KGE6IExpbmVSYW5nZSwgYjogTGluZVJhbmdlKTogYm9vbGVhbiB7XG4gIHJldHVybiBhLnN0YXJ0IDw9IGIuZW5kICYmIGEuZW5kID49IGIuc3RhcnQ7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUG9yY2VsYWluIHJvdyBwYXJzaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBQb3JjZWxhaW5Sb3cge1xuICBuYW1lOiBzdHJpbmc7XG4gIHBhdGg6IHN0cmluZztcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVBvcmNlbGFpbihzdGRvdXQ6IHN0cmluZyk6IFBvcmNlbGFpblJvd1tdIHtcbiAgY29uc3Qgcm93czogUG9yY2VsYWluUm93W10gPSBbXTtcbiAgZm9yIChjb25zdCBsaW5lIG9mIHN0ZG91dC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkKSBjb250aW51ZTtcbiAgICBjb25zdCBwYXJ0cyA9IHRyaW1tZWQuc3BsaXQoJ1xcdCcpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPCAzKSBjb250aW51ZTtcbiAgICBjb25zdCBbbmFtZSwgcGF0aCwgcmFuZ2VdID0gcGFydHM7XG4gICAgY29uc3QgZGFzaElkeCA9IHJhbmdlLmluZGV4T2YoJy0nKTtcbiAgICBpZiAoZGFzaElkeCA9PT0gLTEpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHN0YXJ0ID0gcGFyc2VJbnQocmFuZ2Uuc2xpY2UoMCwgZGFzaElkeCksIDEwKTtcbiAgICBjb25zdCBlbmQgPSBwYXJzZUludChyYW5nZS5zbGljZShkYXNoSWR4ICsgMSksIDEwKTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0KSB8fCBOdW1iZXIuaXNOYU4oZW5kKSkgY29udGludWU7XG4gICAgcm93cy5wdXNoKHsgbmFtZSwgcGF0aCwgc3RhcnQsIGVuZCB9KTtcbiAgfVxuICByZXR1cm4gcm93cztcbn1cblxuLyoqXG4gKiBUaGUgZnVsbCBgZ2l0IHNwYW4gZHJpZnQgLS1mb3JtYXQgcG9yY2VsYWluYCBzdGF0dXMgdG9rZW4gdm9jYWJ1bGFyeSAodGhlXG4gKiBnaXQtc3BhbiBDTEkncyBwb3JjZWxhaW4gY29udHJhY3QpOiBgRlJFU0hgL2BNT1ZFRGAvYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYFxuICogYXJlIHBvc2l0aW9uYWwtb3ItY2xlYW4gYW5kIG5ldmVyIGRlYnQ7IGV2ZXJ5IG90aGVyIHRva2VuIGlzIHNlbWFudGljIGRyaWZ0XG4gKiBvciBhIHRlcm1pbmFsL2Vycm9yIGNvbmRpdGlvbiBhbmQgaXMgZGVidC4gU2VlIHtAbGluayBpc0RlYnR9IGZvciB0aGVcbiAqIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGggb24gdGhhdCBzcGxpdC5cbiAqL1xuZXhwb3J0IGNvbnN0IFBPUkNFTEFJTl9TVEFUVVNFUyA9IFtcbiAgJ0ZSRVNIJyxcbiAgJ1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUJyxcbiAgJ01PVkVEJyxcbiAgJ0NIQU5HRUQnLFxuICAnREVMRVRFRCcsXG4gICdDT05GTElDVCcsXG4gICdTVUJNT0RVTEUnLFxuICAnTEZTX05PVF9GRVRDSEVEJyxcbiAgJ0xGU19OT1RfSU5TVEFMTEVEJyxcbiAgJ1BST01JU09SX01JU1NJTkcnLFxuICAnU1BBUlNFX0VYQ0xVREVEJyxcbiAgJ0ZJTFRFUl9GQUlMRUQnLFxuICAnSU9fRVJST1InXG5dIGFzIGNvbnN0O1xuXG5leHBvcnQgdHlwZSBQb3JjZWxhaW5TdGF0dXMgPSAodHlwZW9mIFBPUkNFTEFJTl9TVEFUVVNFUylbbnVtYmVyXTtcblxuY29uc3QgUE9SQ0VMQUlOX1NUQVRVU19TRVQ6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFBPUkNFTEFJTl9TVEFUVVNFUyk7XG5cbmZ1bmN0aW9uIHBhcnNlUG9yY2VsYWluU3RhdHVzKHJhdzogc3RyaW5nKTogUG9yY2VsYWluU3RhdHVzIHwgbnVsbCB7XG4gIHJldHVybiBQT1JDRUxBSU5fU1RBVFVTX1NFVC5oYXMocmF3KSA/IChyYXcgYXMgUG9yY2VsYWluU3RhdHVzKSA6IG51bGw7XG59XG5cbi8qKiBBIGBwYXJzZURyaWZ0UG9yY2VsYWluYCByb3c6IGEge0BsaW5rIFBvcmNlbGFpblJvd30gcGx1cyBpdHMgc3RhdHVzIHRva2VuLiAqL1xuZXhwb3J0IGludGVyZmFjZSBEcmlmdFBvcmNlbGFpblJvdyBleHRlbmRzIFBvcmNlbGFpblJvdyB7XG4gIHN0YXR1czogUG9yY2VsYWluU3RhdHVzO1xufVxuXG4vKipcbiAqIFRoZSBkZWJ0IGludmFyaWFudCAoc3lzdGVtLXdpZGU7IGNvbnN1bWVkIGJ5IGJvdGggdGhlIGZ1dHVyZSB0b3VjaC1jb3JlIGFuZFxuICogYWR2aXNvci1jb3JlKTogb25seSBzZW1hbnRpYyBzdGF0dXNlcyBhcmUgZGVidC4gYENIQU5HRURgIGFuZCBgREVMRVRFRGAgYXJlXG4gKiBzZW1hbnRpYyBkcmlmdDsgdGhlIHJlbWFpbmluZyBub24tRlJFU0gvTU9WRUQvUkVTT0xWRURfUEVORElOR19DT01NSVQgdG9rZW5zXG4gKiBhcmUgdGVybWluYWwvZXJyb3IgY29uZGl0aW9ucyBhbmQgYXJlIHRyZWF0ZWQgYXMgZGVidCB0b28gKHRoZXkgYmxvY2sgb25cbiAqIHRoZWlyIG93biBtZXJpdHMgXHUyMDE0IHRoZSBDTEkgY291bGQgbm90IHJlc29sdmUgdGhlIGFuY2hvciBhdCBhbGwpLiBgRlJFU0hgLFxuICogYE1PVkVEYCwgYW5kIGBSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgYXJlIG5ldmVyIGRlYnQ6IHBvc2l0aW9uYWwgZHJpZnQgdGhlXG4gKiBDTEkgY2FuIGhlYWwgKG9yIGFscmVhZHkgaGFzKSBpcyBpbnZpc2libGUsIGFuZCBhIHBlbmRpbmctY29tbWl0IHJlc29sdXRpb25cbiAqIGlzIG5vdCBvdXRzdGFuZGluZyBkZWJ0LlxuICpcbiAqIE5vdGU6IHRoZSBwb3JjZWxhaW4gdm9jYWJ1bGFyeSBkb2VzIG5vdCBjdXJyZW50bHkgZGlzdGluZ3Vpc2hcbiAqIGNvbnRlbnQtZXF1aXZhbGVudCBgQ0hBTkdFRGAgKGUuZy4gd2hpdGVzcGFjZS1vbmx5IGRyaWZ0IGAtLWZpeGAgY2FuIGhlYWwpXG4gKiBmcm9tIGdlbnVpbmVseSBzZW1hbnRpYyBgQ0hBTkdFRGAgXHUyMDE0IHRoYXQgY2xhc3NpZmljYXRpb24gaXMgbm90IHByZXNlbnQgaW5cbiAqIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW5gIG91dHB1dCB0b2RheS4gVW50aWwgdGhlIENMSSBleHBvc2VzIGl0LFxuICogZXZlcnkgYENIQU5HRURgIHJvdyBpcyB0cmVhdGVkIGFzIGRlYnQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0RlYnQoc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBib29sZWFuIHtcbiAgc3dpdGNoIChzdGF0dXMpIHtcbiAgICBjYXNlICdGUkVTSCc6XG4gICAgY2FzZSAnTU9WRUQnOlxuICAgIGNhc2UgJ1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUJzpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIHRydWU7XG4gIH1cbn1cblxuLyoqXG4gKiBMb3dlcmNhc2UgaHVtYW4gbGFiZWwgZm9yIGEgcG9yY2VsYWluIHN0YXR1cyB0b2tlbiAoYExGU19OT1RfRkVUQ0hFRGAgXHUyMTkyXG4gKiBgbGZzIG5vdCBmZXRjaGVkYCkuIFRoZSBzaW5nbGUgbGFiZWwgbWFwcGluZyBmb3IgZXZlcnkgaHVtYW4tZm9ybWF0IGFuY2hvclxuICogc3VmZml4IFx1MjAxNCBib3RoIHRoZSB0b3VjaCBob29rJ3MgYmxvY2sgYW5kIHRoZSBhZHZpc29yJ3MgbWVzc2FnZXMgcmVuZGVyIHRocm91Z2hcbiAqIHRoaXMsIHNvIGEgc3RhdHVzIG5ldmVyIHJlYWRzIGRpZmZlcmVudGx5IGJldHdlZW4gdGhlIHR3by5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGh1bWFuU3RhdHVzTGFiZWwoc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBzdHJpbmcge1xuICByZXR1cm4gc3RhdHVzLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvXy9nLCAnICcpO1xufVxuXG4vKipcbiAqIFRoZSB0ZXJtaW5hbC9lbnZpcm9ubWVudGFsIHN0YXR1c2VzOiB0aGUgQ0xJIGNvdWxkIG5vdCByZXNvbHZlIHRoZSBhbmNob3IgYXRcbiAqIGFsbCwgc28gdGhlIHJvdyBpcyBub3Qgc3BhbiBkcmlmdCBhIHVzZXIgY2FuIGZpeCBieSBlZGl0aW5nIGEgc3Bhbi4gVGhlc2UgYXJlXG4gKiBgQ09ORkxJQ1RgICh1bnJlc29sdmVkIG1lcmdlKSwgYFNVQk1PRFVMRWAgKGFuY2hvciBpbnNpZGUgYSBzdWJtb2R1bGUpLFxuICogYExGU19OT1RfRkVUQ0hFRGAvYExGU19OT1RfSU5TVEFMTEVEYCAoR2l0IExGUyBjb250ZW50IHVuYXZhaWxhYmxlKSxcbiAqIGBQUk9NSVNPUl9NSVNTSU5HYCAocGFydGlhbC1jbG9uZSBvYmplY3Qgbm90IGZldGNoZWQpLCBgU1BBUlNFX0VYQ0xVREVEYFxuICogKHBhdGggb3V0c2lkZSB0aGUgc3BhcnNlLWNoZWNrb3V0IGNvbmUpLCBgRklMVEVSX0ZBSUxFRGAgKGEgY2xlYW4vc211ZGdlXG4gKiBmaWx0ZXIgZXJyb3JlZCksIGFuZCBgSU9fRVJST1JgICh0cmFuc2llbnQgcmVhZCBmYWlsdXJlKS5cbiAqXG4gKiBUaGVzZSBhcmUgYSBzdHJpY3Qgc3Vic2V0IG9mIHtAbGluayBpc0RlYnR9OiBldmVyeSBlbnZpcm9ubWVudGFsIHN0YXR1cyBpc1xuICogYWxzbyBkZWJ0IChpdCBibG9ja3Mgb24gaXRzIG93biBtZXJpdHMgd2hlbiBzdXJmYWNlZCBpbiBhIHN0YXR1cyByZXBvcnQpLCBidXRcbiAqIHRoZSBhZHZpc29yIG11c3QgdHJlYXQgdGhlbSBkaWZmZXJlbnRseSBmcm9tICpzZW1hbnRpYyogZHJpZnQgKGBDSEFOR0VEYCxcbiAqIGBERUxFVEVEYCkuIFNlbWFudGljIGRyaWZ0IGlzIGZpeGFibGUgYnkgZWRpdGluZyBhIHNwYW4sIHNvIHRoZSBhZHZpc29yIGZhaWxzXG4gKiBjbG9zZWQgb24gaXQ7IGFuIGVudmlyb25tZW50YWwgY29uZGl0aW9uIGlzIG5vdCBzb21ldGhpbmcgYSBzcGFuIGVkaXQgY2FuXG4gKiByZXNvbHZlLCBzbyB0aGUgYWR2aXNvciBmYWlscyBPUEVOIG9uIGl0IChhbGxvdywgYnV0IHN1cmZhY2UgdGhlIGNvbmRpdGlvbikgXHUyMDE0XG4gKiByZS1kZW55aW5nIGZvcmV2ZXIgb24gYW4gaW5mcmEgZmFpbHVyZSB0aGUgdXNlciBjYW5ub3QgY2xlYXIgZnJvbSBoZXJlIHdvdWxkXG4gKiBjb250cmFkaWN0IHRoZSBmYWlsLW9wZW4gY29udHJhY3QgdGhlIHJlc3Qgb2YgdGhlIGFkdmlzb3IgYWxyZWFkeSBob25vcnMgZm9yXG4gKiBDTEktYWJzZW50L3RpbWVvdXQvcGFyc2UtZmFpbHVyZSBjb25kaXRpb25zLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNFbnZpcm9ubWVudGFsU3RhdHVzKHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogYm9vbGVhbiB7XG4gIHN3aXRjaCAoc3RhdHVzKSB7XG4gICAgY2FzZSAnQ09ORkxJQ1QnOlxuICAgIGNhc2UgJ1NVQk1PRFVMRSc6XG4gICAgY2FzZSAnTEZTX05PVF9GRVRDSEVEJzpcbiAgICBjYXNlICdMRlNfTk9UX0lOU1RBTExFRCc6XG4gICAgY2FzZSAnUFJPTUlTT1JfTUlTU0lORyc6XG4gICAgY2FzZSAnU1BBUlNFX0VYQ0xVREVEJzpcbiAgICBjYXNlICdGSUxURVJfRkFJTEVEJzpcbiAgICBjYXNlICdJT19FUlJPUic6XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKlxuICogYGdpdCBzcGFuIGRyaWZ0IC0tZm9ybWF0IHBvcmNlbGFpbmAgZW1pdHMgYSBkaWZmZXJlbnQgc2hhcGUgdGhhblxuICogYGxpc3QgLS1wb3JjZWxhaW5gOiBhIGAjIHBvcmNlbGFpbiB2MmAgaGVhZGVyLCBgIyBmdXp6eSBOYCBjb21tZW50IGxpbmVzLFxuICogYW5kIG9uZSBgPHN0YXR1cz5cXHQ8c3JjPlxcdDxuYW1lPlxcdDxwYXRoPlxcdDxzdGFydD5cXHQ8ZW5kPmAgcm93IHBlciBkcmlmdGVkXG4gKiBhbmNob3IgKHdob2xlLWZpbGUgYW5jaG9ycyBjYXJyeSBgKHdob2xlKWAvYC1gIGluIHBsYWNlIG9mIHRoZSBsaW5lIGNvbHVtbnMpLlxuICogUm93cyB3aG9zZSBzdGF0dXMgdG9rZW4gaXMgbm90IGluIHtAbGluayBQT1JDRUxBSU5fU1RBVFVTRVN9IGFyZSBza2lwcGVkIFx1MjAxNFxuICogYW4gdW5yZWNvZ25pemVkIHRva2VuIGZyb20gYSBuZXdlciBDTEkgaXMgdHJlYXRlZCB0aGUgc2FtZSBhcyBhIG1hbGZvcm1lZFxuICogbGluZSByYXRoZXIgdGhhbiBndWVzc2VkIGF0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VEcmlmdFBvcmNlbGFpbihzdGRvdXQ6IHN0cmluZyk6IERyaWZ0UG9yY2VsYWluUm93W10ge1xuICBjb25zdCByb3dzOiBEcmlmdFBvcmNlbGFpblJvd1tdID0gW107XG4gIGZvciAoY29uc3QgbGluZSBvZiBzdGRvdXQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCB8fCB0cmltbWVkLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgY29uc3QgcGFydHMgPSB0cmltbWVkLnNwbGl0KCdcXHQnKTtcbiAgICBpZiAocGFydHMubGVuZ3RoIDwgNikgY29udGludWU7XG4gICAgY29uc3QgW3N0YXR1c0NvbCwgLCBuYW1lLCBwYXRoLCBzdGFydENvbCwgZW5kQ29sXSA9IHBhcnRzO1xuICAgIGNvbnN0IHN0YXR1cyA9IHBhcnNlUG9yY2VsYWluU3RhdHVzKHN0YXR1c0NvbCk7XG4gICAgaWYgKCFzdGF0dXMpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHN0YXJ0ID0gc3RhcnRDb2wgPT09ICcod2hvbGUpJyA/IDAgOiBwYXJzZUludChzdGFydENvbCwgMTApO1xuICAgIGNvbnN0IGVuZCA9IGVuZENvbCA9PT0gJy0nID8gMCA6IHBhcnNlSW50KGVuZENvbCwgMTApO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpIHx8IE51bWJlci5pc05hTihlbmQpKSBjb250aW51ZTtcbiAgICByb3dzLnB1c2goeyBuYW1lLCBwYXRoLCBzdGFydCwgZW5kLCBzdGF0dXMgfSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2Vzc2lvbiBJRCBzYW5pdGl6YXRpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIEluamVjdGl2ZSB0cmFuc2Zvcm06IHBlcmNlbnQtZW5jb2RlIGJ5dGVzIG91dHNpZGUgW0EtWmEtejAtOS5fLV0gYXMgJUhIXG4gKiAodXBwZXJjYXNlIGhleCkuIFVzZWQgdG8gcHJvZHVjZSBzYWZlIGZpbGVuYW1lcyBmcm9tIGFyYml0cmFyeSBzZXNzaW9uIGlkcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplU2Vzc2lvbklkKHNlc3Npb25JZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHNlc3Npb25JZC5yZXBsYWNlKC9bXkEtWmEtejAtOS5fLV0vZywgKGNoKSA9PiB7XG4gICAgcmV0dXJuIGAlJHtjaC5jaGFyQ29kZUF0KDApLnRvU3RyaW5nKDE2KS50b1VwcGVyQ2FzZSgpLnBhZFN0YXJ0KDIsICcwJyl9YDtcbiAgfSk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUGVyLXNlc3Npb24gYmFzZSBkaXJlY3Rvcnlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vLyBCYXNlIGRpciBzaGFyZWQgYnkgYWxsIHBlci1zZXNzaW9uIHN0YXRlOiBjdXJyZW50bHkganVzdCB0aGUgdG91Y2gtaG9va1xuLy8gc2Vzc2lvbiBtZW1vIChzcGFuLXN1cmZhY2UudHMncyBNZW1vU3RvcmUpLiBFYWNoIHNlc3Npb24gZ2V0cyBvbmVcbi8vIHN1YmRpcmVjdG9yeSBrZXllZCBieSBpdHMgc2FuaXRpemVkIGlkLCBzbyBldmVyeSB3cml0ZXIvcmVhZGVyIGZvciBhIGdpdmVuXG4vLyBzZXNzaW9uIGFncmVlcyBvbiBpdHMgbG9jYXRpb24uXG5leHBvcnQgY29uc3QgU0VTU0lPTl9CQVNFX0RJUiA9IG5vZGVQYXRoLmpvaW4ob3MuaG9tZWRpcigpLCAnLmNhY2hlJywgJ2dpdC1zcGFuJywgJ3Nlc3Npb24nKTtcblxuLyoqIFRoZSBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcnkgZm9yIGEgZ2l2ZW4gc2Vzc2lvbiBpZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uRGlyKHNlc3Npb25JZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4oU0VTU0lPTl9CQVNFX0RJUiwgc2FuaXRpemVTZXNzaW9uSWQoc2Vzc2lvbklkKSk7XG59XG5cbmNvbnN0IFRISVJUWV9EQVlTX01TID0gMzAgKiAyNCAqIDYwICogNjAgKiAxMDAwO1xuXG4vKipcbiAqIE9wcG9ydHVuaXN0aWNhbGx5IHBydW5lIHBlci1zZXNzaW9uIHN0YXRlIGRpcmVjdG9yaWVzIHVuZGVyXG4gKiB7QGxpbmsgU0VTU0lPTl9CQVNFX0RJUn0gd2hvc2UgbXRpbWUgaXMgb2xkZXIgdGhhbiBgbWF4QWdlTXNgIChkZWZhdWx0IDMwXG4gKiBkYXlzKS4gQSBkaXJlY3RvcnkncyBtdGltZSBhZHZhbmNlcyB3aGVuZXZlciBhbiBlbnRyeSBpbnNpZGUgaXQgaXNcbiAqIGNyZWF0ZWQvcmVuYW1lZC9yZW1vdmVkLCBzbyBhbiBhY3RpdmUgc2Vzc2lvbiAobWVtbyB3cml0ZXMpIHN0YXlzIGZyZXNoO1xuICogb25seSBnZW51aW5lbHkgYWJhbmRvbmVkIHNlc3Npb25zIGFnZSBvdXQuXG4gKlxuICogQmVzdC1lZmZvcnQgYW5kIG5vbi10aHJvd2luZzogY2FsbGVkIG9wcG9ydHVuaXN0aWNhbGx5IGZyb20gaG9vayByZWFkL3dyaXRlXG4gKiBwYXRocywgbm90IGEgc2VwYXJhdGUgY3Jvbi1saWtlIG1lY2hhbmlzbSwgc28gYSBmYWlsdXJlIGhlcmUgbXVzdCBuZXZlclxuICogYmxvY2sgdGhlIGNhbGxlcidzIGFjdHVhbCB3b3JrLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcHJ1bmVTdGFsZVNlc3Npb25zKG5vdzogbnVtYmVyID0gRGF0ZS5ub3coKSwgbWF4QWdlTXM6IG51bWJlciA9IFRISVJUWV9EQVlTX01TKTogdm9pZCB7XG4gIGxldCBlbnRyaWVzOiBmcy5EaXJlbnRbXTtcbiAgdHJ5IHtcbiAgICBlbnRyaWVzID0gZnMucmVhZGRpclN5bmMoU0VTU0lPTl9CQVNFX0RJUiwgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm47IC8vIGJhc2UgZGlyIGFic2VudCBvciB1bnJlYWRhYmxlIFx1MjAxNCBub3RoaW5nIHRvIHBydW5lXG4gIH1cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSB7XG4gICAgaWYgKCFlbnRyeS5pc0RpcmVjdG9yeSgpKSBjb250aW51ZTtcbiAgICBjb25zdCBkaXJQYXRoID0gbm9kZVBhdGguam9pbihTRVNTSU9OX0JBU0VfRElSLCBlbnRyeS5uYW1lKTtcbiAgICB0cnkge1xuICAgICAgY29uc3Qgc3RhdCA9IGZzLnN0YXRTeW5jKGRpclBhdGgpO1xuICAgICAgaWYgKG5vdyAtIHN0YXQubXRpbWVNcyA+IG1heEFnZU1zKSB7XG4gICAgICAgIGZzLnJtU3luYyhkaXJQYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XG4gICAgICB9XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBWYW5pc2hlZCBiZXR3ZWVuIHJlYWRkaXIgYW5kIHN0YXQsIG9yIHJlbW92YWwgZmFpbGVkIFx1MjAxNCBza2lwIGl0LiBBXG4gICAgICAvLyBiZXN0LWVmZm9ydCBwcnVuZSBtdXN0IG5ldmVyIHRocm93IGludG8gdGhlIGNhbGxlcidzIGhvdCBwYXRoLlxuICAgIH1cbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIGtpbmQgYW5kIGFuY2hvciBmb3JtYXR0aW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IHR5cGUgVG91Y2hLaW5kID0gJ3JlYWQnIHwgJ3dyaXRlJyB8ICd3aG9sZS1yZWFkJyB8ICd3aG9sZS13cml0ZScgfCAnY3JlYXRlJztcblxuLyoqXG4gKiBGb3JtYXQgYSBzcGFuIGFuY2hvciBzdHJpbmcuXG4gKlxuICogLSBgd2hvbGUtcmVhZGAsIGB3aG9sZS13cml0ZWAsIGFuZCBgY3JlYXRlYDogcmV0dXJucyBqdXN0IHRoZSBwYXRoXG4gKiAtIGByZWFkYCBhbmQgYHdyaXRlYDogcmV0dXJucyBgcGF0aCNMPHN0YXJ0Pi1MPGVuZD5gIChyZXF1aXJlcyByYW5nZSlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEFuY2hvcihwYXRoOiBzdHJpbmcsIGtpbmQ6IFRvdWNoS2luZCwgcmFuZ2U/OiBMaW5lUmFuZ2UpOiBzdHJpbmcge1xuICBpZiAoKGtpbmQgPT09ICdyZWFkJyB8fCBraW5kID09PSAnd3JpdGUnKSAmJiByYW5nZSkge1xuICAgIHJldHVybiBgJHtwYXRofSNMJHtyYW5nZS5zdGFydH0tTCR7cmFuZ2UuZW5kfWA7XG4gIH1cbiAgcmV0dXJuIHBhdGg7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQW5jaG9yIHNwZWMgdHlwZVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgQW5jaG9yU3BlYyB7XG4gIHBhdGg6IHN0cmluZztcbiAga2luZDogVG91Y2hLaW5kO1xuICByYW5nZT86IExpbmVSYW5nZTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBRdWV1ZSBkaXJlY3RvcnkgaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgZ2l0IGNvbW1vbiBkaXJlY3RvcnkgZm9yIHRoZSBnaXZlbiByZXBvIHJvb3QuXG4gKiBUaGlzIGlzIHRoZSBzaGFyZWQgZGlyZWN0b3J5IChub3QgdGhlIHdvcmt0cmVlLXNwZWNpZmljIC5naXQpLCBzbyBxdWV1ZVxuICogcmVjb3JkcyBzdXJ2aXZlIHdvcmt0cmVlIGRlbGV0aW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUdpdENvbW1vbkRpcihyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdyZXYtcGFyc2UnLCAnLS1naXQtY29tbW9uLWRpciddLCB7XG4gICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgZW5jb2Rpbmc6ICd1dGY4J1xuICB9KTtcbiAgY29uc3QgdHJpbW1lZCA9IHRvUG9zaXgob3V0LnRyaW0oKSk7XG4gIC8vIGdpdCByZXR1cm5zIGEgcmVsYXRpdmUgcGF0aCAoZS5nLiBcIi5naXRcIikgZm9yIHNpbXBsZSByZXBvcy4gUmVzb2x2ZSBpdFxuICAvLyBhZ2FpbnN0IHJlcG9Sb290IHNvIGNhbGxlcnMgbmV2ZXIgZGVwZW5kIG9uIHByb2Nlc3MuY3dkKCkuXG4gIGlmICghbm9kZVBhdGguaXNBYnNvbHV0ZSh0cmltbWVkKSkge1xuICAgIHJldHVybiB0b1Bvc2l4KG5vZGVQYXRoLnJlc29sdmUocmVwb1Jvb3QsIHRyaW1tZWQpKTtcbiAgfVxuICByZXR1cm4gdHJpbW1lZDtcbn1cblxuLyoqXG4gKiBSb290IG9mIHRoZSBnaXQtc3BhbiBxdWV1ZSBkaXJlY3RvcnkgdHJlZSwgdW5kZXIgdGhlIGdpdCBjb21tb24gZGlyLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcXVldWVSb290KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihyZXNvbHZlR2l0Q29tbW9uRGlyKHJlcG9Sb290KSwgJ2dpdC1zcGFuJyk7XG59XG5cbi8qKlxuICogRGlyZWN0b3J5IGZvciB0aGUgYWR2aXNvcidzIHBlci1jaGFuZ2VzZXQgc3RhdGUgbWVtb3MgKGRpZ2VzdCBvZiBzb3J0ZWRcbiAqIGZpbmRpbmdzICsgdW5jb3ZlcmVkIHBhdGhzKSwgdW5kZXIgdGhlIGdpdCBjb21tb24gZGlyIHNvIGl0IGlzIHNoYXJlZFxuICogYWNyb3NzIHdvcmt0cmVlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFkdmlzb3JNZW1vRGlyKHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihxdWV1ZVJvb3QocmVwb1Jvb3QpLCAnYWR2aXNvcicpO1xufVxuIiwgIi8qKlxuICogSGFybmVzcy1hZ25vc3RpYyBzcGFuLXN1cmZhY2luZyBjb3JlLlxuICpcbiAqIEdpdmVuIGFuIGFscmVhZHktcmVzb2x2ZWQgcmVwby1yZWxhdGl2ZSBwYXRoIGFuZCBhIGxpbmUgcmFuZ2UsIHRoaXMgbW9kdWxlXG4gKiBydW5zIHRoZSBzaGFyZWQgYGdpdCBzcGFuIGxpc3QgLS1wb3JjZWxhaW5gIC8gYC5ob29raWdub3JlYCAvIHNlc3Npb24tbWVtbyAvXG4gKiBgZ2l0IHNwYW4gZHJpZnRgIHBpcGVsaW5lIGFuZCBhc3NlbWJsZXMgdGhlIGh1bWFuLXJlYWRhYmxlIGA8Z2l0LXNwYW4+XHUyMDI2PC9naXQtc3Bhbj5gXG4gKiBibG9jayB0aGF0IGJvdGggYWRhcHRlcnMgc3VyZmFjZSBpbmxpbmUgYmVmb3JlIGFuIGVkaXQuIEl0IGltcG9ydHMgbm90aGluZ1xuICogZnJvbSBlaXRoZXIgaG9vayBTREs6IHRoZSBDbGF1ZGUgUHJlVG9vbFVzZSBob29rIGZlZWRzIGl0IGEgcmFuZ2UgZGVyaXZlZCBmcm9tXG4gKiBgZmlsZV9wYXRoYC9gb2Zmc2V0YC9gb2xkX3N0cmluZ2A7IHRoZSBDb2RleCBQcmVUb29sVXNlIGhvb2sgZmVlZHMgaXQgdGhlXG4gKiByYW5nZXMgcmVjb3ZlcmVkIGZyb20gYW4gYGFwcGx5X3BhdGNoYCBlbnZlbG9wZS4gRWFjaCBhZGFwdGVyIHdyYXBzIHRoZVxuICogcmV0dXJuZWQgYmxvY2sgc3RyaW5nIGluIGl0cyBvd24gU0RLIG91dHB1dCBidWlsZGVyLlxuICpcbiAqIFRoZSBleGVjdXRvci9kcmlmdC9tZW1vIGRlcGVuZGVuY2llcyBhcmUgaW5qZWN0ZWQgc28gdGhlIHBpcGVsaW5lIGlzIHRlc3RhYmxlXG4gKiB3aXRoIGZha2VzIGV4YWN0bHkgbGlrZSB0aGUgcG9yY2VsYWluIHBhcnNlcnMgaW4gdGhlIHNoYXJlZCBrZXJuZWwuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7XG4gIGlzR2l0SWdub3JlZCxcbiAgaXNJbnNpZGVTcGFuUm9vdCxcbiAgdHlwZSBMaW5lUmFuZ2UsXG4gIHR5cGUgUG9yY2VsYWluUm93LFxuICBwYXJzZURyaWZ0UG9yY2VsYWluLFxuICBwYXJzZVBvcmNlbGFpbixcbiAgcHJ1bmVTdGFsZVNlc3Npb25zLFxuICByYW5nZXNJbnRlcnNlY3QsXG4gIHJlbGF0aXZlVG9SZXBvLFxuICByZXNvbHZlUmVwb1Jvb3QsXG4gIHJlc29sdmVTcGFuUm9vdCxcbiAgc2Vzc2lvbkRpcixcbiAgdG9Qb3NpeFxufSBmcm9tICcuL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyB0eXBlIEhvb2tJZ25vcmVMb2FkZXIsIGlzU3BhblN1cHByZXNzZWQgfSBmcm9tICcuL3NwYW4taWdub3JlLmpzJztcblxuLyoqXG4gKiBNaW5pbWFsIGxvZ2dlciBzdXJmYWNlIHRoZSBgY29tbW9uL2AgbGF5ZXIgbG9ncyB0aHJvdWdoOyBib3RoIFNESyBsb2dnZXJzXG4gKiBzYXRpc2Z5IGl0LiBgd2FybmAgaXMgcmVxdWlyZWQgXHUyMDE0IGV2ZXJ5IGV4aXN0aW5nIGNhbGwgc2l0ZSByZXBvcnRzIGEgZmFpbHVyZS5cbiAqIGBpbmZvYCBpcyBvcHRpb25hbCBzbyBhIGZha2UgY2Fycnlpbmcgb25seSBgd2FybmAgc3RpbGwgc2F0aXNmaWVzIHRoZVxuICogaW50ZXJmYWNlOiBpdCBleGlzdHMgZm9yIHRoZSBkaWFnbm9zdGljIGJyZWFkY3J1bWJzIGEgKnN1Y2Nlc3NmdWwqIHJ1biBsZWF2ZXNcbiAqIGJlaGluZCAoYWR2aXNvci1jb3JlJ3MgY2h1cm4tc3VwcHJlc3Npb24gY291bnQpLCB3aGljaCBhcmUgbm90IHdhcm5pbmdzIGFuZFxuICogbXVzdCBub3QgcmVhZCBhcyBmYWlsdXJlcyBpbiB0aGUgaG9vayBsb2cuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29yZUxvZ2dlciB7XG4gIHdhcm4obWVzc2FnZTogc3RyaW5nLCBjb250ZXh0PzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB2b2lkO1xuICBpbmZvPyhtZXNzYWdlOiBzdHJpbmcsIGNvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQ7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU3BhbiBleGVjdXRvciBhYnN0cmFjdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogRXhlY3V0ZXMgYGdpdCBzcGFuIGxpc3RgIHdpdGggZ2l2ZW4gYXJncyBpbiBhIGdpdmVuIGN3ZC5cbiAqIFJldHVybnMgc3Rkb3V0IHN0cmluZy4gVGhyb3dzIG9uIG5vbi16ZXJvIGV4aXQuXG4gKi9cbmV4cG9ydCB0eXBlIFNwYW5FeGVjdXRvciA9IChhcmdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpID0+IHN0cmluZztcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHRTcGFuRXhlY3V0b3IodGltZW91dE1zID0gMTBfMDAwKTogU3BhbkV4ZWN1dG9yIHtcbiAgcmV0dXJuIChhcmdzLCBjd2QpID0+IHtcbiAgICByZXR1cm4gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnbGlzdCcsIC4uLmFyZ3NdLCB7XG4gICAgICBjd2QsXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgfSk7XG4gIH07XG59XG5cbi8qKlxuICogUnVucyBgZ2l0IHNwYW4gZHJpZnQgLS1mb3JtYXQgcG9yY2VsYWluIDxzbHVncz5gIGFuZCByZXR1cm5zIGl0cyBwb3JjZWxhaW4gc3Rkb3V0IFx1MjAxNFxuICogb25lIHJvdyBwZXIgKmRyaWZ0ZWQqIGFuY2hvciBhbW9uZyB0aGUgZ2l2ZW4gc3BhbnMsIGVtcHR5IHdoZW4gYWxsIGFyZSBjbGVhbi5cbiAqIGBnaXQgc3BhbiBkcmlmdGAgZXhpdHMgMCBpbiBwb3JjZWxhaW4gbW9kZSB3aGV0aGVyIG9yIG5vdCBkcmlmdCBleGlzdHMsIGJ1dCB3ZVxuICogc3RpbGwgY2FwdHVyZSBzdGRvdXQgZnJvbSBhIHRocm93biBlcnJvciBzbyBhIGRyaWZ0IHNpZ25hbCBpcyBuZXZlciBsb3N0IHRvIGFcbiAqIG5vbi16ZXJvIGV4aXQuIFRocm93cyBvbmx5IHdoZW4gbm8gc3Rkb3V0IGlzIGF2YWlsYWJsZSAoZ2VudWluZSBmYWlsdXJlKS5cbiAqL1xuZXhwb3J0IHR5cGUgRHJpZnRFeGVjdXRvciA9IChzbHVnczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKSA9PiBzdHJpbmc7XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0RHJpZnRFeGVjdXRvcih0aW1lb3V0TXMgPSAxMF8wMDApOiBEcmlmdEV4ZWN1dG9yIHtcbiAgcmV0dXJuIChzbHVncywgY3dkKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdkcmlmdCcsICctLWZvcm1hdCcsICdwb3JjZWxhaW4nLCAuLi5zbHVnc10sIHtcbiAgICAgICAgY3dkLFxuICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zdCBvdXQgPSAoZXJyIGFzIHsgc3Rkb3V0Pzogc3RyaW5nIH0pLnN0ZG91dDtcbiAgICAgIGlmICh0eXBlb2Ygb3V0ID09PSAnc3RyaW5nJykgcmV0dXJuIG91dDtcbiAgICAgIHRocm93IGVycjtcbiAgICB9XG4gIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2Vzc2lvbiBtZW1vIGFic3RyYWN0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBNZW1vU3RvcmUge1xuICBnZXRTdXJmYWNlZChzZXNzaW9uSWQ6IHN0cmluZyk6IFNldDxzdHJpbmc+O1xuICBhZGRTdXJmYWNlZChzZXNzaW9uSWQ6IHN0cmluZywgbmFtZXM6IHN0cmluZ1tdKTogdm9pZDtcbn1cblxuLy8gTGl2ZXMgdW5kZXIgdGhlIHNoYXJlZCBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcnkgKGFnZW50LWhvb2tzLWNvbW1vbi50cydzXG4vLyBzZXNzaW9uRGlyKSBcdTIwMTQgcmVsb2NhdGVkIGZyb20gb3MudG1wZGlyKCkvYWdlbnQtaG9va3MtZ2l0LXNwYW4vIHNvXG4vLyBwZXItc2Vzc2lvbiBzdGF0ZSBoYXMgb25lIGhvbWUgYW5kIGlzIGNvdmVyZWQgYnkgcHJ1bmVTdGFsZVNlc3Npb25zJ3Ncbi8vIG9wcG9ydHVuaXN0aWMgPjMwLWRheSBwcnVuaW5nLlxuZnVuY3Rpb24gbWVtb0ZpbGVQYXRoKHNlc3Npb25JZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4oc2Vzc2lvbkRpcihzZXNzaW9uSWQpLCAndG91Y2gtbWVtby5qc29uJyk7XG59XG5cbmV4cG9ydCB0eXBlIE1lbW9Mb2dnZXIgPSBDb3JlTG9nZ2VyO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGlza01lbW9TdG9yZShsb2dnZXI6IE1lbW9Mb2dnZXIpOiBNZW1vU3RvcmUge1xuICByZXR1cm4ge1xuICAgIGdldFN1cmZhY2VkKHNlc3Npb25JZCkge1xuICAgICAgcHJ1bmVTdGFsZVNlc3Npb25zKCk7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByYXcgPSBmcy5yZWFkRmlsZVN5bmMobWVtb0ZpbGVQYXRoKHNlc3Npb25JZCksICd1dGY4Jyk7XG4gICAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UocmF3KSBhcyB7IHN1cmZhY2VkPzogdW5rbm93biB9O1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShwYXJzZWQuc3VyZmFjZWQpKSB7XG4gICAgICAgICAgcmV0dXJuIG5ldyBTZXQocGFyc2VkLnN1cmZhY2VkIGFzIHN0cmluZ1tdKTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKCdtZW1vIHJlYWQgZmFpbGVkICh0cmVhdGluZyBhcyBlbXB0eSknLCB7IGVyciB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBuZXcgU2V0KCk7XG4gICAgfSxcbiAgICBhZGRTdXJmYWNlZChzZXNzaW9uSWQsIG5hbWVzKSB7XG4gICAgICBwcnVuZVN0YWxlU2Vzc2lvbnMoKTtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5nZXRTdXJmYWNlZChzZXNzaW9uSWQpO1xuICAgICAgZm9yIChjb25zdCBuIG9mIG5hbWVzKSBleGlzdGluZy5hZGQobik7XG4gICAgICBjb25zdCBtZW1vRGlyID0gc2Vzc2lvbkRpcihzZXNzaW9uSWQpO1xuICAgICAgY29uc3QgbWVtb1BhdGggPSBtZW1vRmlsZVBhdGgoc2Vzc2lvbklkKTtcbiAgICAgIGNvbnN0IHRtcFBhdGggPSBgJHttZW1vUGF0aH0udG1wYDtcbiAgICAgIHRyeSB7XG4gICAgICAgIGZzLm1rZGlyU3luYyhtZW1vRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgZnMud3JpdGVGaWxlU3luYyh0bXBQYXRoLCBKU09OLnN0cmluZ2lmeSh7IHN1cmZhY2VkOiBbLi4uZXhpc3RpbmddIH0pLCAndXRmOCcpO1xuICAgICAgICBmcy5yZW5hbWVTeW5jKHRtcFBhdGgsIG1lbW9QYXRoKTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBsb2dnZXIud2FybignbWVtbyB3cml0ZSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG59XG5cbi8qKiBGYWN0b3J5IGZ1bmN0aW9uIHRoYXQgY3JlYXRlcyBhIE1lbW9TdG9yZSBnaXZlbiBhIGxvZ2dlci4gKi9cbmV4cG9ydCB0eXBlIE1lbW9GYWN0b3J5ID0gKGxvZ2dlcjogTWVtb0xvZ2dlcikgPT4gTWVtb1N0b3JlO1xuXG4vKiogRGVmYXVsdCBkaXNrLWJhY2tlZCBtZW1vIGZhY3RvcnkgdXNlZCBpbiBwcm9kdWN0aW9uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRpc2tNZW1vRmFjdG9yeShsb2dnZXI6IE1lbW9Mb2dnZXIpOiBNZW1vU3RvcmUge1xuICByZXR1cm4gY3JlYXRlRGlza01lbW9TdG9yZShsb2dnZXIpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIHNjb3BlIHJlc29sdXRpb24gKHJlcG8tc2NvcGluZyArIGdpdGlnbm9yZSArIHNwYW4tcm9vdCBndWFyZHMpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBUb3VjaFNjb3BlIHtcbiAgcmVwb1Jvb3Q6IHN0cmluZztcbiAgcmVwb1JlbFBhdGg6IHN0cmluZztcbn1cblxuLyoqXG4gKiBCb3VuZCBhIHRvdWNoZWQgZmlsZSB0byB0aGUgQ1dEIHJlcG8uIFJlc29sdmUgdGhlIHJlcG8gcm9vdCBvZiB0aGUgY3VycmVudFxuICogd29ya2luZyBkaXJlY3RvcnkgYW5kIHJlcXVpcmUgdGhlIHRvdWNoZWQgZmlsZSB0byByZXNvbHZlIHRvIHRoZSBTQU1FIHJlcG9cbiAqIHJvb3Q7IGRyb3AgZmlsZXMgaW4gYSBkaWZmZXJlbnQgcmVwb3NpdG9yeS93b3JrdHJlZSwgZ2l0aWdub3JlZCBmaWxlcywgYW5kXG4gKiBmaWxlcyB1bmRlciB0aGUgc3BhbiByb290LiBSZXR1cm5zIHRoZSByZXNvbHZlZCBgeyByZXBvUm9vdCwgcmVwb1JlbFBhdGggfWBcbiAqIG9yIG51bGwgd2hlbiB0aGUgdG91Y2ggaXMgb3V0IG9mIHNjb3BlLlxuICpcbiAqIENvbXBhcmluZyByZXNvbHZlZCBgZ2l0IC0tc2hvdy10b3BsZXZlbGAgdG9wbGV2ZWxzIChub3QgcGF0aCBwcmVmaXhlcylcbiAqIGRpc3Rpbmd1aXNoZXMgc2VwYXJhdGUgcmVwb3MgYW5kIHdvcmt0cmVlcyBhbmQgaXMgcm9idXN0IHRvIHN5bWxpbmtzLiBGYWlsXG4gKiBjbG9zZWQ6IGlmIHRoZSBDV0QgcmVwbyBjYW4ndCBiZSByZXNvbHZlZCwgdGhlIHRvdWNoIGlzIGRyb3BwZWQgcmF0aGVyIHRoYW5cbiAqIGZhbGxpbmcgYmFjayB0byB0aGUgZmlsZSdzIG93biByZXBvLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVRvdWNoU2NvcGUoY3dkOiBzdHJpbmcsIGFic1BhdGg6IHN0cmluZyk6IFRvdWNoU2NvcGUgfCBudWxsIHtcbiAgY29uc3QgY3dkUmVwb1Jvb3QgPSBjd2QgPyByZXNvbHZlUmVwb1Jvb3QoY3dkKSA6IG51bGw7XG4gIGlmICghY3dkUmVwb1Jvb3QpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGFic0RpciA9IHRvUG9zaXgobm9kZVBhdGguZGlybmFtZShhYnNQYXRoKSk7XG4gIGNvbnN0IGZpbGVSZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChhYnNEaXIpO1xuICBpZiAoZmlsZVJlcG9Sb290ICE9PSBjd2RSZXBvUm9vdCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgcmVwb1Jvb3QgPSBjd2RSZXBvUm9vdDtcbiAgY29uc3QgcmVwb1JlbFBhdGggPSByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgYWJzUGF0aCk7XG5cbiAgLy8gU2tpcCBnaXRpZ25vcmVkIGZpbGVzIGVudGlyZWx5LiBCdWlsZCBvdXRwdXQsIGNhY2hlcywgYW5kIGxvZ3MgYXJlIG5vdFxuICAvLyBzcGFuLXJlbGV2YW50OiB0aGV5IG11c3QgbmV2ZXIgc3VyZmFjZSBzcGFuIG92ZXJsYXBzLlxuICBpZiAoaXNHaXRJZ25vcmVkKHJlcG9Sb290LCByZXBvUmVsUGF0aCkpIHJldHVybiBudWxsO1xuXG4gIC8vIFNraXAgc3BhbiBkb2N1bWVudHMgZW50aXJlbHkuIEZpbGVzIHVuZGVyIHRoZSByZXNvbHZlZCBzcGFuIHJvb3QgYXJlIG1hbmFnZWRcbiAgLy8gYnkgZ2l0IHNwYW4gaXRzZWxmIGFuZCBhcmUgbm90IGFwcGxpY2F0aW9uIHNvdXJjZXMgdGhhdCBuZWVkIHNwYW4gY292ZXJhZ2UuXG4gIGNvbnN0IHNwYW5Sb290ID0gcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290KTtcbiAgaWYgKGlzSW5zaWRlU3BhblJvb3QocmVwb1JlbFBhdGgsIHNwYW5Sb290KSkgcmV0dXJuIG51bGw7XG5cbiAgcmV0dXJuIHsgcmVwb1Jvb3QsIHJlcG9SZWxQYXRoIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU3VyZmFjZSByb3V0aW5lXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEluamVjdGVkIGRlcGVuZGVuY2llcyBmb3Ige0BsaW5rIHN1cmZhY2VPdmVybGFwcGluZ1NwYW5zfS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3VyZmFjZURlcHMge1xuICBleGVjdXRvcjogU3BhbkV4ZWN1dG9yO1xuICBkcmlmdEV4ZWN1dG9yOiBEcmlmdEV4ZWN1dG9yO1xuICBtZW1vOiBNZW1vU3RvcmU7XG4gIGxvYWRSdWxlczogSG9va0lnbm9yZUxvYWRlcjtcbiAgbG9nZ2VyOiBDb3JlTG9nZ2VyO1xufVxuXG4vKipcbiAqIEdpdmVuIGEgcmVwby1yZWxhdGl2ZSBwYXRoIGFuZCB0aGUgbGluZSByYW5nZSBiZWluZyB0b3VjaGVkIHdpdGhpbiBhblxuICogYWxyZWFkeS1yZXNvbHZlZCByZXBvLCBwcm9kdWNlIHRoZSBgPGdpdC1zcGFuPlx1MjAyNjwvZ2l0LXNwYW4+YCBibG9jayBmb3IgdGhlXG4gKiBzcGFucyBvdmVybGFwcGluZyB0aGF0IHJhbmdlLCBvciBudWxsIHdoZW4gdGhlcmUgaXMgbm90aGluZyB0byBzdXJmYWNlLlxuICpcbiAqIFRoZSBwaXBlbGluZTogYGdpdCBzcGFuIGxpc3QgPHBhdGg+IC0tcG9yY2VsYWluYCBcdTIxOTIga2VlcCBsaW5lLXJhbmdlZCBhbmNob3JzIG9uXG4gKiB0aGUgc2FtZSBmaWxlIHRoYXQgaW50ZXJzZWN0IHRoZSByYW5nZSBhbmQgYXJlIG5vdCBgLmhvb2tpZ25vcmVgLXN1cHByZXNzZWQgXHUyMTkyXG4gKiBkcm9wIHNsdWdzIGFscmVhZHkgc3VyZmFjZWQgdGhpcyBzZXNzaW9uIChtZW1vKSBcdTIxOTIgcmVuZGVyIGBnaXQgc3BhbiBsaXN0XG4gKiA8bmFtZXNcdTIwMjY+YCBcdTIxOTIgYXBwZW5kIGEgYGdpdCBzcGFuIGhpc3RvcnkgPG5hbWU+YCBwb2ludGVyIGZvciBhbnkgYWxyZWFkeS1kcmlmdGVkXG4gKiBzcGFuLiBPbiBzdWNjZXNzIHRoZSBzdXJmYWNlZCBuYW1lcyBhcmUgcmVjb3JkZWQgaW4gdGhlIG1lbW8uIEV4ZWN1dG9yIGFuZFxuICogZHJpZnQtcHJvYmUgZmFpbHVyZXMgYXJlIGxvZ2dlZCBhbmQgZGVncmFkZSB0byBudWxsIC8gdGhlIHBsYWluIGJsb2NrOyB0aGV5XG4gKiBuZXZlciB0aHJvdy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN1cmZhY2VPdmVybGFwcGluZ1NwYW5zKFxuICBkZXBzOiBTdXJmYWNlRGVwcyxcbiAgcmVwb1Jvb3Q6IHN0cmluZyxcbiAgcmVwb1JlbFBhdGg6IHN0cmluZyxcbiAgcmFuZ2U6IExpbmVSYW5nZSxcbiAgc2Vzc2lvbklkOiBzdHJpbmdcbik6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCB7IGV4ZWN1dG9yLCBkcmlmdEV4ZWN1dG9yLCBtZW1vLCBsb2FkUnVsZXMsIGxvZ2dlciB9ID0gZGVwcztcblxuICAvLyBGaWx0ZXIgcGFzczogZ2l0IHNwYW4gbGlzdCA8cGF0aD4gLS1wb3JjZWxhaW5cbiAgbGV0IHBvcmNlbGFpblN0ZG91dDogc3RyaW5nO1xuICB0cnkge1xuICAgIHBvcmNlbGFpblN0ZG91dCA9IGV4ZWN1dG9yKFsnLS1wb3JjZWxhaW4nLCByZXBvUmVsUGF0aF0sIHJlcG9Sb290KTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nZ2VyLndhcm4oJ2dpdCBzcGFuIGxpc3QgLS1wb3JjZWxhaW4gZmFpbGVkJywgeyBlcnIgfSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICAvLyBQYXRoLXNjb3BlZCBzdXBwcmVzc2lvbjogYSByZXBvJ3MgLnNwYW4vLmhvb2tpZ25vcmUgY2FuIGhvbGQgYmFjayBzcGFuIHNsdWdcbiAgLy8gcHJlZml4ZXMgZm9yIGFuY2hvcnMgdW5kZXIgZ2l2ZW4gcGF0aHMuIEEgc3VwcHJlc3NlZCBzcGFuIGlzIG5ldmVyIHN1cmZhY2VkLlxuICBjb25zdCBpZ25vcmVSdWxlcyA9IGxvYWRSdWxlcyhyZXBvUm9vdCk7XG5cbiAgY29uc3Qgcm93czogUG9yY2VsYWluUm93W10gPSBwYXJzZVBvcmNlbGFpbihwb3JjZWxhaW5TdGRvdXQpO1xuICBjb25zdCBjYW5kaWRhdGVOYW1lcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgaWYgKHJvdy5wYXRoICE9PSByZXBvUmVsUGF0aCkgY29udGludWU7XG4gICAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSBjb250aW51ZTsgLy8gd2hvbGUtZmlsZSBhbmNob3JcbiAgICBpZiAoIXJhbmdlc0ludGVyc2VjdChyYW5nZSwgeyBzdGFydDogcm93LnN0YXJ0LCBlbmQ6IHJvdy5lbmQgfSkpIGNvbnRpbnVlO1xuICAgIGlmIChpc1NwYW5TdXBwcmVzc2VkKGlnbm9yZVJ1bGVzLCByb3cucGF0aCwgcm93Lm5hbWUpKSBjb250aW51ZTtcbiAgICBjYW5kaWRhdGVOYW1lcy5hZGQocm93Lm5hbWUpO1xuICB9XG5cbiAgaWYgKGNhbmRpZGF0ZU5hbWVzLnNpemUgPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIFN1YnRyYWN0IGFscmVhZHktc3VyZmFjZWQgbmFtZXNcbiAgY29uc3Qgc3VyZmFjZWQgPSBtZW1vLmdldFN1cmZhY2VkKHNlc3Npb25JZCk7XG4gIGNvbnN0IHRvU3VyZmFjZSA9IFsuLi5jYW5kaWRhdGVOYW1lc10uZmlsdGVyKChuKSA9PiAhc3VyZmFjZWQuaGFzKG4pKS5zb3J0KCk7XG4gIGlmICh0b1N1cmZhY2UubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAvLyBSZW5kZXIgcGFzczogZ2l0IHNwYW4gbGlzdCA8bmFtZTE+IDxuYW1lMj4gLi4uXG4gIGxldCByZW5kZXJTdGRvdXQ6IHN0cmluZztcbiAgdHJ5IHtcbiAgICByZW5kZXJTdGRvdXQgPSBleGVjdXRvcih0b1N1cmZhY2UsIHJlcG9Sb290KTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nZ2VyLndhcm4oJ2dpdCBzcGFuIGxpc3QgKHJlbmRlcikgZmFpbGVkJywgeyBlcnIgfSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICAvLyBPZiB0aGUgc3BhbnMgYmVpbmcgc3VyZmFjZWQsIGZsYWcgYW55IGFscmVhZHkgZHJpZnRlZCBcdTIwMTQgdGhlIHRvdWNoZWQgbGluZXMgaGF2ZVxuICAvLyBkcmlmdGVkIGZyb20gdGhlaXIgYW5jaG9yZWQgc3RhdGUgXHUyMDE0IHdpdGggYSBgZ2l0IHNwYW4gaGlzdG9yeSA8bmFtZT5gIHBvaW50ZXIuXG4gIC8vIERldGVjdGlvbiBpcyBhcy1vZi1ub3cgKHN1cmZhY2luZyBydW5zIGJlZm9yZSB0aGUgZWRpdCBhcHBsaWVzKSwgc28gdGhpc1xuICAvLyBjYXRjaGVzIHByZS1leGlzdGluZyBkcmlmdDsgZHJpZnQgdGhpcyBzZXNzaW9uIGNhdXNlcyBpcyB0aGUgU3RvcCBob29rJ3Mgam9iLlxuICAvLyBGYWlsdXJlIHRvIGNvbXB1dGUgZHJpZnQgaXMgbm9uLWZhdGFsOiBmYWxsIGJhY2sgdG8gdGhlIHBsYWluIGJsb2NrLlxuICBsZXQgZHJpZnRIaW50ID0gJyc7XG4gIHRyeSB7XG4gICAgY29uc3QgZHJpZnROYW1lcyA9IG5ldyBTZXQocGFyc2VEcmlmdFBvcmNlbGFpbihkcmlmdEV4ZWN1dG9yKHRvU3VyZmFjZSwgcmVwb1Jvb3QpKS5tYXAoKHIpID0+IHIubmFtZSkpO1xuICAgIGNvbnN0IGRyaWZ0U3VyZmFjZWQgPSB0b1N1cmZhY2UuZmlsdGVyKChuKSA9PiBkcmlmdE5hbWVzLmhhcyhuKSk7XG4gICAgaWYgKGRyaWZ0U3VyZmFjZWQubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgbGluZXMgPSBkcmlmdFN1cmZhY2VkLm1hcCgobikgPT4gYCAgZ2l0IHNwYW4gaGlzdG9yeSAke259YCkuam9pbignXFxuJyk7XG4gICAgICBkcmlmdEhpbnQgPSBgXFxuRHJpZnQgXHUyMDE0IHRoZSBsaW5lcyB5b3UncmUgdG91Y2hpbmcgaGF2ZSBkcmlmdGVkIGZyb20gdGhlc2Ugc3BhbnMnIGFuY2hvcmVkIHN0YXRlLiBSZXZpZXcgaG93IGVhY2ggc3Vic3lzdGVtIGV2b2x2ZWQgYmVmb3JlIGNoYW5naW5nIGl0OlxcbiR7bGluZXN9YDtcbiAgICB9XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZ2dlci53YXJuKCdnaXQgc3BhbiBkcmlmdCAoaGlzdG9yeSBoaW50KSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgfVxuXG4gIGNvbnN0IHdyYXBwZWQgPSBgXFxuPGdpdC1zcGFuPlxcbiR7cmVuZGVyU3Rkb3V0fSR7ZHJpZnRIaW50fVxcbjwvZ2l0LXNwYW4+XFxuYDtcblxuICAvLyBVcGRhdGUgbWVtb1xuICBtZW1vLmFkZFN1cmZhY2VkKHNlc3Npb25JZCwgdG9TdXJmYWNlKTtcblxuICByZXR1cm4gd3JhcHBlZDtcbn1cbiIsICIvKipcbiAqIFBhdGgtc2NvcGVkIHNwYW4gc3VwcHJlc3Npb24gZm9yIHRoZSBhZ2VudCBob29rcy5cbiAqXG4gKiBTb21lIHNwYW5zIGFyZSBub2lzZSB3aGVuIGJyb3dzaW5nIGNlcnRhaW4gcGFydHMgb2YgdGhlIHRyZWUgXHUyMDE0IHdpa2kgb3JcbiAqIG1hcmtldGluZyBzcGFucyB0aGF0IGFuY2hvciBwcm9zZSwgc3VyZmFjZWQgaW5saW5lIHdoaWxlIHJlYWRpbmcgc291cmNlLFxuICogYWRkIGxpdHRsZS4gVGhpcyBtb2R1bGUgbGV0cyBhIHJlcG8gZGVjbGFyZSwgcGVyIHBhdGgsIHdoaWNoIHNwYW4gc2x1Z1xuICogcHJlZml4ZXMgdG8gaG9sZCBiYWNrLlxuICpcbiAqIENvbmZpZyBsaXZlcyBhdCBgPHJlcG9Sb290Pi8uc3Bhbi8uaG9va2lnbm9yZWAuIEVhY2ggbm9uLWNvbW1lbnQgbGluZSBpcyBhXG4gKiBnaXRpZ25vcmUtc3R5bGUgcGF0aCBwYXR0ZXJuLCBhIHNpbmdsZSBydW4gb2Ygd2hpdGVzcGFjZSwgdGhlbiBhXG4gKiBjb21tYS1zZXBhcmF0ZWQgbGlzdCBvZiBzcGFuIHNsdWcgcHJlZml4ZXMgdG8gc3VwcHJlc3MgZm9yIHBhdGhzIHRoZSBwYXR0ZXJuXG4gKiBtYXRjaGVzOlxuICpcbiAqICAgcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjIHdpa2ksbWFya2V0aW5nXG4gKlxuICogQSBzcGFuIHdob3NlIHNsdWcgYmVnaW5zIHdpdGggYHdpa2lgIG9yIGBtYXJrZXRpbmdgICh0aGUgc2x1ZyBlcXVhbHMgdGhlXG4gKiBwcmVmaXgsIG9yIGlzIGA8cHJlZml4Pi9cdTIwMjZgKSBpcyB0aGVuIG5ldmVyIHN1cmZhY2VkIGZvciBhbiBhbmNob3Igd2hvc2UgcGF0aFxuICogc2l0cyB1bmRlciBgcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjYCBcdTIwMTQgaXQgaXMgbmV2ZXIgc3VyZmFjZWQgaW4gdGhlIGlubGluZVxuICogYDxnaXQtc3Bhbj5gIGJsb2NrIHRoZSBgUG9zdFRvb2xVc2VgIHRvdWNoIGhvb2sgZW1pdHMuIEl0IGhhcyBubyBlZmZlY3Qgb25cbiAqIHRoZSBgUHJlVG9vbFVzZWAgYWR2aXNvciwgd2hvc2Ugb3duIHVuY292ZXJlZC13cml0ZXMgc3VwcHJlc3Npb24gbGl2ZXMgaW5cbiAqIGAuc3Bhbi8uYWR2aXNvcmlnbm9yZWAgKHNlZSBgYWR2aXNvci1pZ25vcmUudHNgKS5cbiAqXG4gKiBQYXR0ZXJuIGdyYW1tYXIgaXMgYSBkZWxpYmVyYXRlIHN1YnNldCBvZiBnaXRpZ25vcmU6XG4gKlxuICogLSBCbGFuayBsaW5lcyBhbmQgbGluZXMgYmVnaW5uaW5nIHdpdGggYCNgIGFyZSBza2lwcGVkLlxuICogLSBBIHRyYWlsaW5nIGAvYCByZXN0cmljdHMgdGhlIHBhdHRlcm4gdG8gZGlyZWN0b3JpZXMgKHRoZSBsZWFmIGZpbGUgaXMgbm90XG4gKiAgIGl0c2VsZiB0ZXN0ZWQsIG9ubHkgaXRzIGFuY2VzdG9yIGRpcmVjdG9yaWVzKS5cbiAqIC0gQSBwYXR0ZXJuIGNvbnRhaW5pbmcgYSBzbGFzaCBpcyBhbmNob3JlZCB0byB0aGUgcmVwbyByb290OyBhIHBhdHRlcm4gd2l0aFxuICogICBubyBzbGFzaCBtYXRjaGVzIGEgc2luZ2xlIHBhdGggY29tcG9uZW50IGF0IGFueSBkZXB0aC5cbiAqIC0gYCpgIGFuZCBgP2AgbWF0Y2ggd2l0aGluIG9uZSBwYXRoIHNlZ21lbnQ7IGAqKmAgbWF0Y2hlcyBhY3Jvc3Mgc2VnbWVudHMuXG4gKiAtIE5lZ2F0aW9uIChgIWApIGlzIG5vdCBzdXBwb3J0ZWQuXG4gKlxuICogU3VwcHJlc3Npb24gaXMgZmFpbC1vcGVuOiBhIG1pc3Npbmcgb3IgdW5yZWFkYWJsZSBgLmhvb2tpZ25vcmVgLCBvciBhXG4gKiBtYWxmb3JtZWQgbGluZSwgeWllbGRzIG5vIHJ1bGUgcmF0aGVyIHRoYW4gaGlkaW5nIHNwYW5zIHRoZSBhdXRob3IgZGlkIG5vdFxuICogYXNrIHRvIGhpZGUuXG4gKi9cblxuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuXG5leHBvcnQgaW50ZXJmYWNlIElnbm9yZVJ1bGUge1xuICAvKiogVGhlIHJhdyBnaXRpZ25vcmUtc3R5bGUgcGF0dGVybiwgcmV0YWluZWQgZm9yIGRpYWdub3N0aWNzLiAqL1xuICBwYXR0ZXJuOiBzdHJpbmc7XG4gIC8qKiBTcGFuIHNsdWcgcHJlZml4ZXMgc3VwcHJlc3NlZCBmb3IgcGF0aHMgdGhpcyBydWxlIG1hdGNoZXMuICovXG4gIHByZWZpeGVzOiBzdHJpbmdbXTtcbiAgLyoqIFRydWUgd2hlbiBgcmVwb1JlbFBhdGhgIChQT1NJWCwgcmVwby1yZWxhdGl2ZSkgaXMgZ292ZXJuZWQgYnkgdGhpcyBydWxlLiAqL1xuICBtYXRjaGVzOiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4gYm9vbGVhbjtcbn1cblxuY29uc3QgSE9PS19JR05PUkVfUkVMID0gbm9kZVBhdGguam9pbignLnNwYW4nLCAnLmhvb2tpZ25vcmUnKTtcblxuLyoqXG4gKiBUcmFuc2xhdGUgb25lIGdpdGlnbm9yZS1zdHlsZSBnbG9iIHNlZ21lbnQgaW50byBhbiBhbmNob3JlZCBSZWdFeHAuIGAqYCBhbmRcbiAqIGA/YCBzdGF5IHdpdGhpbiBhIHBhdGggc2VnbWVudDsgYCoqYCAob3B0aW9uYWxseSBmb2xsb3dlZCBieSBgL2ApIHNwYW5zIHRoZW0uXG4gKi9cbmZ1bmN0aW9uIGdsb2JUb1JlZ0V4cChnbG9iOiBzdHJpbmcpOiBSZWdFeHAge1xuICBsZXQgcmUgPSAnJztcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBnbG9iLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYyA9IGdsb2JbaV07XG4gICAgaWYgKGMgPT09ICcqJykge1xuICAgICAgaWYgKGdsb2JbaSArIDFdID09PSAnKicpIHtcbiAgICAgICAgcmUgKz0gJy4qJztcbiAgICAgICAgaSsrO1xuICAgICAgICAvLyBBYnNvcmIgYSBmb2xsb3dpbmcgc2xhc2ggc28gYCoqL2Zvb2AgZG9lcyBub3QgZGVtYW5kIGEgbGl0ZXJhbCBgL2AuXG4gICAgICAgIGlmIChnbG9iW2kgKyAxXSA9PT0gJy8nKSBpKys7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZSArPSAnW14vXSonO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoYyA9PT0gJz8nKSB7XG4gICAgICByZSArPSAnW14vXSc7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlICs9IGMucmVwbGFjZSgvWy4rXiR7fSgpfFtcXF1cXFxcXS9nLCAnXFxcXCQmJyk7XG4gICAgfVxuICB9XG4gIHJldHVybiBuZXcgUmVnRXhwKGBeJHtyZX0kYCk7XG59XG5cbi8qKiBBbmNlc3RvciBwYXRoIGNoYWluOiBgYS9iL2MudHNgIFx1MjE5MiBgWydhJywgJ2EvYicsICdhL2IvYy50cyddYC4gKi9cbmZ1bmN0aW9uIGFuY2VzdG9yUGF0aHMocGF0aDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBwYXJ0cyA9IHBhdGguc3BsaXQoJy8nKTtcbiAgY29uc3Qgb3V0OiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgb3V0LnB1c2gocGFydHMuc2xpY2UoMCwgaSArIDEpLmpvaW4oJy8nKSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBDb21waWxlIGEgc2luZ2xlIGdpdGlnbm9yZS1zdHlsZSBwYXR0ZXJuICh0aGlzIG1vZHVsZSdzIGdyYW1tYXIgXHUyMDE0IHNlZSB0aGVcbiAqIG1vZHVsZSBkb2MgY29tbWVudCkgaW50byBhIHBhdGggcHJlZGljYXRlLiBBIHBhdHRlcm4gbWF0Y2hlcyBhIGZpbGUgd2hlbiBpdFxuICogbWF0Y2hlcyB0aGUgZmlsZSdzIHBhdGggb3IgYW55IGFuY2VzdG9yIGRpcmVjdG9yeSBvZiBpdCwgc28gYSBkaXJlY3RvcnlcbiAqIHBhdHRlcm4gc3VwcHJlc3NlcyBldmVyeXRoaW5nIGJlbmVhdGggaXQuXG4gKlxuICogRXhwb3J0ZWQgc28gb3RoZXIgcGF0aC1zY29wZWQgaWdub3JlLWZpbGUgY29udmVudGlvbnMgKGUuZy4gYC5hZHZpc29yaWdub3JlYFxuICogaW4gYGFkdmlzb3ItaWdub3JlLnRzYCkgY2FuIHJldXNlIHRoZSBleGFjdCBtYXRjaGluZyBzZW1hbnRpY3MgcmF0aGVyIHRoYW5cbiAqIHJlaW1wbGVtZW50aW5nIHRoZW0uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21waWxlUGF0dGVybihwYXR0ZXJuOiBzdHJpbmcpOiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4gYm9vbGVhbiB7XG4gIGxldCBwYXQgPSBwYXR0ZXJuO1xuICBsZXQgZGlyT25seSA9IGZhbHNlO1xuICBpZiAocGF0LmVuZHNXaXRoKCcvJykpIHtcbiAgICBkaXJPbmx5ID0gdHJ1ZTtcbiAgICBwYXQgPSBwYXQuc2xpY2UoMCwgLTEpO1xuICB9XG4gIGxldCBhbmNob3JlZCA9IHBhdC5pbmNsdWRlcygnLycpO1xuICBpZiAocGF0LnN0YXJ0c1dpdGgoJy8nKSkge1xuICAgIGFuY2hvcmVkID0gdHJ1ZTtcbiAgICBwYXQgPSBwYXQuc2xpY2UoMSk7XG4gIH1cbiAgY29uc3QgcmUgPSBnbG9iVG9SZWdFeHAocGF0KTtcblxuICByZXR1cm4gKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IHtcbiAgICBpZiAoYW5jaG9yZWQpIHtcbiAgICAgIGNvbnN0IHNlZ3MgPSBhbmNlc3RvclBhdGhzKHJlcG9SZWxQYXRoKTtcbiAgICAgIC8vIEZvciBhIGRpci1vbmx5IHBhdHRlcm4sIG5ldmVyIHRlc3QgdGhlIGxlYWYgZmlsZSBpdHNlbGYuXG4gICAgICBjb25zdCBjYW5kaWRhdGVzID0gZGlyT25seSA/IHNlZ3Muc2xpY2UoMCwgLTEpIDogc2VncztcbiAgICAgIHJldHVybiBjYW5kaWRhdGVzLnNvbWUoKHMpID0+IHJlLnRlc3QocykpO1xuICAgIH1cbiAgICAvLyBVbmFuY2hvcmVkOiBtYXRjaCBhZ2FpbnN0IGluZGl2aWR1YWwgcGF0aCBjb21wb25lbnRzIGF0IGFueSBkZXB0aC5cbiAgICBjb25zdCBjb21wb25lbnRzID0gcmVwb1JlbFBhdGguc3BsaXQoJy8nKTtcbiAgICBjb25zdCBjYW5kaWRhdGVzID0gZGlyT25seSA/IGNvbXBvbmVudHMuc2xpY2UoMCwgLTEpIDogY29tcG9uZW50cztcbiAgICByZXR1cm4gY2FuZGlkYXRlcy5zb21lKChjKSA9PiByZS50ZXN0KGMpKTtcbiAgfTtcbn1cblxuLyoqIFBhcnNlIGAuaG9va2lnbm9yZWAgdGV4dCBpbnRvIHJ1bGVzLCBza2lwcGluZyBjb21tZW50cyBhbmQgbWFsZm9ybWVkIGxpbmVzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlSG9va0lnbm9yZShjb250ZW50OiBzdHJpbmcpOiBJZ25vcmVSdWxlW10ge1xuICBjb25zdCBydWxlczogSWdub3JlUnVsZVtdID0gW107XG4gIGZvciAoY29uc3QgcmF3TGluZSBvZiBjb250ZW50LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IGxpbmUgPSByYXdMaW5lLnRyaW0oKTtcbiAgICBpZiAoIWxpbmUgfHwgbGluZS5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIC8vIGA8cGF0dGVybj48d2hpdGVzcGFjZT48cHJlZml4ZXM+YCBcdTIwMTQgcGF0dGVybiBpcyB0aGUgZmlyc3QgdG9rZW4sIHByZWZpeGVzXG4gICAgLy8gdGhlIHNlY29uZC4gQSBsaW5lIHdpdGhvdXQgYm90aCBpcyBtYWxmb3JtZWQgYW5kIHNraXBwZWQuXG4gICAgY29uc3QgbWF0Y2ggPSBsaW5lLm1hdGNoKC9eKFxcUyspXFxzKyhcXFMrKSQvKTtcbiAgICBpZiAoIW1hdGNoKSBjb250aW51ZTtcbiAgICBjb25zdCBbLCBwYXR0ZXJuLCBwcmVmaXhlc1Jhd10gPSBtYXRjaDtcbiAgICBjb25zdCBwcmVmaXhlcyA9IHByZWZpeGVzUmF3XG4gICAgICAuc3BsaXQoJywnKVxuICAgICAgLm1hcCgocCkgPT4gcC50cmltKCkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgIGlmIChwcmVmaXhlcy5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgIHJ1bGVzLnB1c2goeyBwYXR0ZXJuLCBwcmVmaXhlcywgbWF0Y2hlczogY29tcGlsZVBhdHRlcm4ocGF0dGVybikgfSk7XG4gIH1cbiAgcmV0dXJuIHJ1bGVzO1xufVxuXG4vKipcbiAqIExvYWQgdGhlIHN1cHByZXNzaW9uIHJ1bGVzIGZvciBhIHJlcG8uIEZhaWwtb3BlbjogYW55IHJlYWQgb3IgcGFyc2UgZmFpbHVyZVxuICogeWllbGRzIGFuIGVtcHR5IHJ1bGUgc2V0LCBzbyBzcGFucyBzdXJmYWNlIGFzIG5vcm1hbCB3aGVuIG5vIGNvbmZpZyBleGlzdHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsb2FkSG9va0lnbm9yZShyZXBvUm9vdDogc3RyaW5nKTogSWdub3JlUnVsZVtdIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKG5vZGVQYXRoLmpvaW4ocmVwb1Jvb3QsIEhPT0tfSUdOT1JFX1JFTCksICd1dGY4Jyk7XG4gICAgcmV0dXJuIHBhcnNlSG9va0lnbm9yZShjb250ZW50KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG59XG5cbi8qKiBBIHNsdWcgY2FycmllcyBhIHByZWZpeCB3aGVuIGl0IGVxdWFscyB0aGUgcHJlZml4IG9yIGlzIGA8cHJlZml4Pi9cdTIwMjZgLiAqL1xuZnVuY3Rpb24gc2x1Z0hhc1ByZWZpeChzbHVnOiBzdHJpbmcsIHByZWZpeDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBzbHVnID09PSBwcmVmaXggfHwgc2x1Zy5zdGFydHNXaXRoKGAke3ByZWZpeH0vYCk7XG59XG5cbi8qKlxuICogVHJ1ZSB3aGVuIGEgc3BhbiBgc2x1Z2Agc2hvdWxkIGJlIHN1cHByZXNzZWQgZm9yIGFuIGFuY2hvciBhdCBgcmVwb1JlbFBhdGhgOlxuICogc29tZSBydWxlIG1hdGNoZXMgdGhlIHBhdGggYW5kIGxpc3RzIGEgcHJlZml4IHRoZSBzbHVnIGNhcnJpZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1NwYW5TdXBwcmVzc2VkKHJ1bGVzOiBJZ25vcmVSdWxlW10sIHJlcG9SZWxQYXRoOiBzdHJpbmcsIHNsdWc6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IHJ1bGUgb2YgcnVsZXMpIHtcbiAgICBpZiAoIXJ1bGUubWF0Y2hlcyhyZXBvUmVsUGF0aCkpIGNvbnRpbnVlO1xuICAgIGlmIChydWxlLnByZWZpeGVzLnNvbWUoKHApID0+IHNsdWdIYXNQcmVmaXgoc2x1ZywgcCkpKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBTaWduYXR1cmUgZm9yIGluamVjdGluZyBhIHJ1bGUgbG9hZGVyIChwcm9kdWN0aW9uIGRlZmF1bHQ6IHtAbGluayBsb2FkSG9va0lnbm9yZX0pLiAqL1xuZXhwb3J0IHR5cGUgSG9va0lnbm9yZUxvYWRlciA9IChyZXBvUm9vdDogc3RyaW5nKSA9PiBJZ25vcmVSdWxlW107XG4iLCAiLyoqXG4gKiBIYXJuZXNzLWFnbm9zdGljIHRvdWNoLWhvb2sgY29yZS5cbiAqXG4gKiBUaGlzIG1vZHVsZSBpbXBsZW1lbnRzIHRoZSBQb3N0VG9vbFVzZSBcInRvdWNoIHNpZ25hbFwiIHRoYXQgYm90aCB0aGUgQ2xhdWRlXG4gKiAoYFJlYWR8RWRpdHxXcml0ZWApIGFuZCBDb2RleCAoYGFwcGx5X3BhdGNoYCkgYWRhcHRlcnMgZHJpdmUuIEl0IGltcG9ydHNcbiAqIG5vdGhpbmcgZnJvbSBlaXRoZXIgaG9vayBTREsgYW5kIGlzIHR5cGVkIHN0cnVjdHVyYWxseSwgcGVyIHRoZSBgY29tbW9uL2BcbiAqIGxheWVyIGNvbnZlbnRpb246IGFkYXB0ZXJzIHRyYW5zbGF0ZSB0aGVpciBTREstc3BlY2lmaWMgaG9vayBpbnB1dCBpbnRvIGFcbiAqIHtAbGluayBUb3VjaElucHV0fSwgaW5qZWN0IGV4ZWN1dGlvbi9zdGF0ZSBkZXBlbmRlbmNpZXMsIGFuZCB3cmFwIHRoZSByZXR1cm5lZFxuICoge0BsaW5rIFRvdWNoT3V0cHV0fSBpbiB0aGVpciBvd24gb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogUmV1c2VkIGZyb20gdGhlIHNoYXJlZCBrZXJuZWwgKG5vdCByZWRlZmluZWQpOiBgaXNEZWJ0KClgICtcbiAqIGBQb3JjZWxhaW5TdGF0dXNgL2BEcmlmdFBvcmNlbGFpblJvd2AvYFBvcmNlbGFpblJvd2AvYHBhcnNlUG9yY2VsYWluYC9cbiAqIGBwYXJzZURyaWZ0UG9yY2VsYWluYCAoYWdlbnQtaG9va3MtY29tbW9uLnRzKSwgYHJhbmdlc0ludGVyc2VjdGAgYW5kIHRoZVxuICogcmVwby9zcGFuLXJvb3QgcGF0aCB1dGlsaXRpZXMgKGFnZW50LWhvb2tzLWNvbW1vbi50cyksIGFuZCB0aGUgYE1lbW9TdG9yZWBcbiAqIGNhZGVuY2Ugc3RvcmUgKHNwYW4tc3VyZmFjZS50cykuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0IHsgYmFzZW5hbWUsIGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHtcbiAgdHlwZSBEcmlmdFBvcmNlbGFpblJvdyxcbiAgaHVtYW5TdGF0dXNMYWJlbCxcbiAgaXNEZWJ0LFxuICB0eXBlIExpbmVSYW5nZSxcbiAgdHlwZSBQb3JjZWxhaW5Sb3csXG4gIHR5cGUgUG9yY2VsYWluU3RhdHVzLFxuICBwYXJzZURyaWZ0UG9yY2VsYWluLFxuICBwYXJzZVBvcmNlbGFpbixcbiAgcmFuZ2VzSW50ZXJzZWN0LFxuICByZWxhdGl2ZVRvUmVwbyxcbiAgcmVzb2x2ZVJlcG9Sb290LFxuICByZXNvbHZlU3BhblJvb3Rcbn0gZnJvbSAnLi9hZ2VudC1ob29rcy1jb21tb24uanMnO1xuaW1wb3J0IHsgY29sbGFwc2VCeVBhdGgsIHR5cGUgUmFuZ2VMYWJlbCwgcmVuZGVyQW5jaG9yVHJlZSB9IGZyb20gJy4vYW5jaG9yLXRyZWUuanMnO1xuaW1wb3J0IHR5cGUgeyBNZW1vU3RvcmUgfSBmcm9tICcuL3NwYW4tc3VyZmFjZS5qcyc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUG9zdC1lZGl0IHJhbmdlIHJlY292ZXJ5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBTcGxpdCB3cml0dGVuIGNvbnRlbnQgaW50byB0aGUgbGluZXMgdG8gbG9jYXRlIG9uIGRpc2suIEEgc2luZ2xlIHRyYWlsaW5nXG4gKiBuZXdsaW5lIGlzIGRyb3BwZWQgc28gYFwiYVxcbmJcXG5cImAgYW5kIGBcImFcXG5iXCJgIGxvY2F0ZSBpZGVudGljYWxseTsgYW4gZW1wdHlcbiAqIChvciBuZXdsaW5lLW9ubHkpIHdyaXRlIGhhcyBubyBsb2NhdGFibGUgYmxvY2suXG4gKi9cbmZ1bmN0aW9uIHRvTmVlZGxlTGluZXMod3JpdHRlbjogc3RyaW5nKTogc3RyaW5nW10ge1xuICBpZiAod3JpdHRlbi5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgY29uc3QgdHJpbW1lZCA9IHdyaXR0ZW4uZW5kc1dpdGgoJ1xcbicpID8gd3JpdHRlbi5zbGljZSgwLCAtMSkgOiB3cml0dGVuO1xuICBpZiAodHJpbW1lZC5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgcmV0dXJuIHRyaW1tZWQuc3BsaXQoJ1xcbicpO1xufVxuXG4vKipcbiAqIFJlY292ZXIgdGhlIGxpbmUgcmFuZ2UgdGhhdCB3cml0dGVuIGNvbnRlbnQgbm93IG9jY3VwaWVzIGluIHRoZSBvbi1kaXNrIGZpbGUsXG4gKiBmb3IgYW5jaG9yaW5nIHRoZSB0b3VjaGVkIHJlZ2lvbiBhZnRlciBhbiBlZGl0IGhhcyBhbHJlYWR5IGFwcGxpZWQuXG4gKlxuICogVGhpcyBnZW5lcmFsaXplcyB0aGUgcHJlLWVkaXQgYGxvY2F0ZUNodW5rKClgIHRlY2huaXF1ZSBpblxuICogW2FwcGx5LXBhdGNoLnRzXSguL3BhY2thZ2VzL2FnZW50LWhvb2tzL3NyYy9jb2RleC9hcHBseS1wYXRjaC50cyNMMjUzLUwyODYpXG4gKiAocHJldmlvdXNseSBDb2RleC1vbmx5KSBpbnRvIGEgc2hhcmVkIHBvc3QtZWRpdCBwcmltaXRpdmUgYm90aCBoYXJuZXNzZXMgdXNlOlxuICogc3BsaXQgYHdyaXR0ZW5gIGFuZCBgb25EaXNrQ29udGVudGAgaW50byBsaW5lcyBhbmQgbG9jYXRlIHRoZSB3cml0dGVuIGJsb2NrIGFzXG4gKiBhIGNvbnRpZ3VvdXMgcnVuIGluc2lkZSB0aGUgb24tZGlzayBsaW5lcy5cbiAqXG4gKiAtIEEgc2luZ2xlIGNvbnRpZ3VvdXMgbWF0Y2ggeWllbGRzIGl0cyAxLWJhc2VkIGluY2x1c2l2ZSB7QGxpbmsgTGluZVJhbmdlfS5cbiAqIC0gV2hlbiB0aGUgYmxvY2sgaXMgYWJzZW50LCBvciBhcHBlYXJzIG1vcmUgdGhhbiBvbmNlIChjb250ZXh0IHRvIGRpc2FtYmlndWF0ZVxuICogICBpcyBub3QgYXZhaWxhYmxlIHBvc3QtZWRpdCksIHJlY292ZXJ5IGlzIGFtYmlndW91cyBhbmQgdGhlIHJlc3VsdCBkZWdyYWRlc1xuICogICB0byBgJ3dob2xlLWZpbGUnYCAodGhlIHNhbWUgZmFsbGJhY2sgYGxvY2F0ZUNodW5rKClgIHNpZ25hbHMgd2l0aCBgbnVsbGApLlxuICpcbiAqIE5ldmVyIHRocm93czogYW4gdW5sb2NhdGFibGUgd3JpdGUgaXMgYSBgJ3dob2xlLWZpbGUnYCBhbnN3ZXIsIG5vdCBhbiBlcnJvci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY292ZXJSYW5nZSh3cml0dGVuOiBzdHJpbmcsIG9uRGlza0NvbnRlbnQ6IHN0cmluZyk6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyB7XG4gIGNvbnN0IG5lZWRsZSA9IHRvTmVlZGxlTGluZXMod3JpdHRlbik7XG4gIGlmIChuZWVkbGUubGVuZ3RoID09PSAwKSByZXR1cm4gJ3dob2xlLWZpbGUnO1xuXG4gIGNvbnN0IGhheXN0YWNrID0gb25EaXNrQ29udGVudC5zcGxpdCgnXFxuJyk7XG4gIGNvbnN0IGxhc3QgPSBoYXlzdGFjay5sZW5ndGggLSBuZWVkbGUubGVuZ3RoO1xuICBjb25zdCBzdGFydHM6IG51bWJlcltdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDw9IGxhc3Q7IGkrKykge1xuICAgIGxldCBvayA9IHRydWU7XG4gICAgZm9yIChsZXQgaiA9IDA7IGogPCBuZWVkbGUubGVuZ3RoOyBqKyspIHtcbiAgICAgIGlmIChoYXlzdGFja1tpICsgal0gIT09IG5lZWRsZVtqXSkge1xuICAgICAgICBvayA9IGZhbHNlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKG9rKSB7XG4gICAgICBzdGFydHMucHVzaChpKTtcbiAgICAgIGlmIChzdGFydHMubGVuZ3RoID4gMSkgYnJlYWs7IC8vIGR1cGxpY2F0ZWQgXHUyMTkyIGFtYmlndW91cywgc3RvcCBlYXJseVxuICAgIH1cbiAgfVxuXG4gIGlmIChzdGFydHMubGVuZ3RoID09PSAxKSB7XG4gICAgcmV0dXJuIHsgc3RhcnQ6IHN0YXJ0c1swXSArIDEsIGVuZDogc3RhcnRzWzBdICsgbmVlZGxlLmxlbmd0aCB9O1xuICB9XG4gIHJldHVybiAnd2hvbGUtZmlsZSc7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggaW5wdXRcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFdoaWNoIGhhcm5lc3MgZXZlbnQgZmlyZWQsIGFzIHRoZSB0b3VjaCBjb3JlIHNlZXMgaXQuIFRoZSBjb3JlIGJyYW5jaGVzIG9uXG4gKiB0aGlzOiBgd3JpdGVgIGhlYWxzIHBvc2l0aW9uYWwgZHJpZnQgaW4gdGhlIHdvcmtpbmcgdHJlZSBhbmQgbWF5IHN1cmZhY2UgYVxuICogbWVyZ2VkIGJsb2NrOyBgcmVhZGAgbmV2ZXIgbXV0YXRlcyB0aGUgdHJlZSBhbmQgZmlsdGVycyBwb3NpdGlvbmFsIHN0YXR1c2VzXG4gKiBvdXQgb2Ygd2hhdCBpdCBzdXJmYWNlcy5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hFdmVudEtpbmQgPSAncmVhZCcgfCAnd3JpdGUnO1xuXG4vKiogRmllbGRzIHNoYXJlZCBieSBldmVyeSB0b3VjaCwgcmVnYXJkbGVzcyBvZiBraW5kLiAqL1xuaW50ZXJmYWNlIFRvdWNoSW5wdXRCYXNlIHtcbiAgLyoqIEhhcm5lc3Mgc2Vzc2lvbiBpZCBcdTIwMTQga2V5cyB0aGUgcGVyLXNlc3Npb24gY2FkZW5jZSB7QGxpbmsgTWVtb1N0b3JlfS4gKi9cbiAgc2Vzc2lvbklkOiBzdHJpbmc7XG4gIC8qKlxuICAgKiBXb3JraW5nIGRpcmVjdG9yeSB0aGUgdG9vbCByYW4gaW4sIHVzZWQgdG8gYm91bmQgdGhlIHRvdWNoIHRvIHRoZSBDV0QgcmVwb1xuICAgKiB2aWEgYHJlc29sdmVUb3VjaFNjb3BlKClgIGJlZm9yZSBhbnkgc3BhbiBpbnZvY2F0aW9uLlxuICAgKi9cbiAgY3dkOiBzdHJpbmc7XG4gIC8qKiBBYnNvbHV0ZSwgY2Fub25pY2FsaXplZCBwYXRoIG9mIHRoZSB0b3VjaGVkIGZpbGUuICovXG4gIGZpbGVQYXRoOiBzdHJpbmc7XG59XG5cbi8qKiBBIHJlYWQgdG91Y2ggKENsYXVkZSBgUmVhZGAsIG9yIGEgcmVhZC1zaGFwZWQgQ29kZXggZXZlbnQpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaFJlYWRJbnB1dCBleHRlbmRzIFRvdWNoSW5wdXRCYXNlIHtcbiAga2luZDogJ3JlYWQnO1xuICAvKipcbiAgICogMS1iYXNlZCBzdGFydGluZyBsaW5lIG9mIHRoZSByZWFkLCBmcm9tIHRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wncyBgb2Zmc2V0YFxuICAgKiBpbnB1dC4gYHVuZGVmaW5lZGAgd2hlbiB0aGUgcmVhZCBoYWQgbm8gYG9mZnNldGAgKHJlYWRzIGZyb20gbGluZSAxKS5cbiAgICovXG4gIG9mZnNldD86IG51bWJlcjtcbiAgLyoqXG4gICAqIExpbmUgY291bnQgb2YgdGhlIHJlYWQsIGZyb20gdGhlIENsYXVkZSBgUmVhZGAgdG9vbCdzIGBsaW1pdGAgaW5wdXQuXG4gICAqIGB1bmRlZmluZWRgIHdoZW4gdGhlIHJlYWQgaGFkIG5vIGBsaW1pdGAgXHUyMDE0IHNlZSB7QGxpbmsgREVGQVVMVF9SRUFEX0xJTUlUfVxuICAgKiBmb3IgaG93IHRoZSByYW5nZSBpcyBjb21wdXRlZCBpbiB0aGF0IGNhc2UuXG4gICAqL1xuICBsaW1pdD86IG51bWJlcjtcbn1cblxuLyoqIEEgd3JpdGUgdG91Y2ggKENsYXVkZSBgRWRpdGAvYFdyaXRlYCwgQ29kZXggYGFwcGx5X3BhdGNoYCwgb3IgYSB0cmFuc2xhdGVkIEJhc2ggd3JpdGUgc3BhbikuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoV3JpdGVJbnB1dCBleHRlbmRzIFRvdWNoSW5wdXRCYXNlIHtcbiAga2luZDogJ3dyaXRlJztcbiAgLyoqXG4gICAqIFRoZSBjb250ZW50IGp1c3Qgd3JpdHRlbiB0byBgZmlsZVBhdGhgLCBmZWQgdG8ge0BsaW5rIHJlY292ZXJSYW5nZX0gdG9cbiAgICogcmUtYW5jaG9yIHRoZSB0b3VjaGVkIHJlZ2lvbiBhZ2FpbnN0IHRoZSBoZWFsZWQgb24tZGlzayBmaWxlLiBGb3IgYVxuICAgKiB3aG9sZS1maWxlIGNyZWF0ZSB0aGlzIGlzIHRoZSBlbnRpcmUgZmlsZSBib2R5OyBhbiBlbXB0eSBzdHJpbmcgbWVhbnNcbiAgICogXCJubyBsb2NhdGFibGUgYmxvY2tcIiBhbmQgdGhlIHRvdWNoIGlzIHNjb3BlZCBmaWxlLXdpZGUuXG4gICAqL1xuICB3cml0dGVuOiBzdHJpbmc7XG4gIC8qKlxuICAgKiBFeGFjdCBwb3N0LWVkaXQgcmFuZ2Ugd2hlbiBzdGF0aWNhbGx5IGtub3duIChzZWQgLWkgbnVtZXJpYyBhZGRyZXNzZXMsXG4gICAqIHBhdGNoIGh1bmsgdW5pb25zKTsgYnlwYXNzZXMge0BsaW5rIHJlY292ZXJSYW5nZUZyb21EaXNrfSAocGxhbiBcdTAwQTczXG4gICAqIHN0ZXAgMykuXG4gICAqL1xuICByYW5nZT86IExpbmVSYW5nZTtcbiAgLyoqXG4gICAqIFRoZSBmaWxlJ3MgZXhwZWN0ZWQgcG9zdC1jb21tYW5kIHN0YXRlOyB0aGUgd3JpdGUgcGF0aCBnYXRlcyBvbiBpdCBiZWZvcmVcbiAgICogaW52b2tpbmcgYW55IGV4ZWN1dG9yIChwbGFuIFx1MDBBNzMgc3RlcCAxKS4gQWJzZW50IG1lYW5zIGAnZXhpc3RzJ2AgXHUyMDE0IHRoZVxuICAgKiBFZGl0L1dyaXRlIGFuZCBhcHBseV9wYXRjaCBwYXRocycgZGVmYXVsdC5cbiAgICovXG4gIHRhcmdldFN0YXRlPzogJ2V4aXN0cycgfCAnYWJzZW50JztcbiAgLyoqXG4gICAqIFN0YXRpY2FsbHkga25vd2FibGUgZXhwZWN0ZWQgcG9zdC1jb250ZW50LCB2ZXJpZmllZCBiZWZvcmUgYW55IGV4ZWN1dG9yXG4gICAqIGNhbGwgKHBsYW4gXHUwMEE3MyBzdGVwIDFiKS4gYGNvbnRlbnRgIGNvbXBhcmVzIHRoZSBvbi1kaXNrIHN0YXRlIGFmdGVyIHRoZVxuICAgKiBjb21tYW5kIHJhbjsgYHJlYWxEZWxldGVgIGlzIGRlbGV0ZS1vbmx5IFx1MjAxNCB0aGUgcGF0aCBtdXN0IGFsc28gYmVcbiAgICogaW5kZXgtdHJhY2tlZCBvciBzcGFubmVkIChwcm9iZXMgY2FjaGVkIHBlciBjb21tYW5kKS5cbiAgICovXG4gIHBvc3RTdGF0ZT86IHtcbiAgICAvKiogYGV4YWN0YDogZmlsZSBieXRlcyBlcXVhbDsgYHN1ZmZpeGA6IGZpbGUgY29udGVudCBlbmRzIHdpdGggaXQ7IGBlbXB0eWA6IHplcm8gYnl0ZXM7IGBzaXplYDogYnl0ZSBjb3VudC4gKi9cbiAgICBjb250ZW50PzogVG91Y2hQb3N0Q29udGVudDtcbiAgICAvKiogZGVsZXRlLW9ubHk6IHRoZSBwYXRoIG11c3QgYWxzbyBiZSBpbmRleC10cmFja2VkIG9yIHNwYW5uZWQgKHByb2JlcyBjYWNoZWQgcGVyIGNvbW1hbmQpLiAqL1xuICAgIHJlYWxEZWxldGU/OiBib29sZWFuO1xuICB9O1xuICAvKipcbiAgICogY3AvaW5zdGFsbCBkZXN0aW5hdGlvbi12cy1zb3VyY2UgdmVyaWZpY2F0aW9uIChwbGFuIFx1MDBBNzMgc3RlcCAxYik6IGFcbiAgICogc3RpbGwtcHJlc2VudCBzb3VyY2UgbXVzdCBieXRlLWVxdWFsIHRoZSBkZXN0aW5hdGlvbjsgYW4gYWJzZW50IHNvdXJjZVxuICAgKiBhcHBsaWVzIHRoZSBhYnNlbnQtc291cmNlIHJ1bGUgKHJlYWwgKyBhYnNlbmNlIGV4cGxhaW5lZCBieSBhIGxhdGVyXG4gICAqIHNhbWUtcGF0aCBkZWNpc2l2ZVBhc3MgXHUyMDE0IHRoZSBkcml2ZXIncyBwYXNzLUEgaG9sZCkuIFNldCBieSB0aGVcbiAgICogYHJ1bkJhc2hUb3VjaGVzYCBkcml2ZXIgb24gcGFpcmVkIGNwIGNyZWF0ZS1vdmVyd3JpdGUgdG91Y2hlczsgbmV2ZXIgc2V0XG4gICAqIGJ5IGFkYXB0ZXJzLiBgaW5zdGFsbCAtc2AvYC0tc3RyaXBgIGlzIGRlbGliZXJhdGVseSBuZXZlciBwYWlyZWQgXHUyMDE0XG4gICAqIHN0cmlwcGVkIG91dHB1dCBuZXZlciBlcXVhbHMgdGhlIHNvdXJjZSwgc28gaW5zdGFsbCBkZXN0cyBnYXRlXG4gICAqIGV4aXN0ZW5jZS1vbmx5LlxuICAgKi9cbiAgc291cmNlUGF0aD86IHN0cmluZztcbiAgLyoqXG4gICAqIG12L2dpdCBtdi9wYXRjaCByZW5hbWUgc291cmNlIHZlcmlmaWNhdGlvbiAocGxhbiBcdTAwQTczIHN0ZXAgMWMpOiB0aGVcbiAgICogZGVzdGluYXRpb24gZmlyZXMgb25seSB3aGVuIGl0cyBzb3VyY2UgcGFzc2VkIHRoZSBkZWxldGUtcmVhbGl0eSBwcm9iZSBcdTIwMTRcbiAgICogYSBwaGFudG9tIHNvdXJjZSBtZWFucyB0aGUgbW92ZSBmYWlsZWQgYW5kIGEgcHJlLWV4aXN0aW5nIGRlc3RpbmF0aW9uIHdhc1xuICAgKiBuZXZlciB0b3VjaGVkLiBObyBjb250ZW50IGNvbXBhcmlzb24gKHBhdGNoIHJlbmFtZXMgbWF5IGNoYW5nZSBjb250ZW50KS5cbiAgICogU2V0IGJ5IHRoZSBgcnVuQmFzaFRvdWNoZXNgIGRyaXZlciBvbiBwYWlyZWQgcmVuYW1lLWNvcHkgdG91Y2hlcy5cbiAgICovXG4gIHJlbmFtZVNvdXJjZVBhdGg/OiBzdHJpbmc7XG59XG5cbi8qKiBUaGUgaGFybmVzcy1hZ25vc3RpYyB0b3VjaCB0aGUgY29yZSBjb25zdW1lcy4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoSW5wdXQgPSBUb3VjaFJlYWRJbnB1dCB8IFRvdWNoV3JpdGVJbnB1dDtcblxuLyoqXG4gKiBBIHN0YXRpY2FsbHkga25vd2FibGUgZXhwZWN0ZWQgcG9zdC1jb250ZW50IChwbGFuIFx1MDBBNzMgc3RlcCAxYik6IGBleGFjdGAgXHUyMDE0XG4gKiBmaWxlIGJ5dGVzIGVxdWFsOyBgc3VmZml4YCBcdTIwMTQgZmlsZSBjb250ZW50IGVuZHMgd2l0aCBpdDsgYGVtcHR5YCBcdTIwMTQgemVyb1xuICogYnl0ZXM7IGBzaXplYCBcdTIwMTQgYnl0ZSBjb3VudC5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hQb3N0Q29udGVudCA9IHsgZXhhY3Q6IHN0cmluZyB9IHwgeyBzdWZmaXg6IHN0cmluZyB9IHwgeyBlbXB0eTogdHJ1ZSB9IHwgeyBzaXplOiBudW1iZXIgfTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQb3N0LXN0YXRlIHdyaXRlIGdhdGUgKHBsYW4gXHUwMEE3MyBzdGVwIDEpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBUaGUgb3V0Y29tZSBvZiB7QGxpbmsgZXZhbHVhdGVXcml0ZUdhdGV9OiBhIGRlY2lzaXZlIHBhc3MvZmFpbCBjYXJyaWVzXG4gKiB2ZXJkaWN0IHdlaWdodCAoY29udGVudCB2ZXJpZmllZCwgb3IgYWJzZW5jZSArIGRlbGV0ZS1yZWFsaXR5IHZlcmlmaWVkKTtcbiAqIGAnaW5jb25jbHVzaXZlJ2AgaXMgZXZlcnl0aGluZyBlbHNlIFx1MjAxNCB0aGUgZXhpc3RlbmNlLWdhdGVkIGZhbWlsaWVzIChzZWQgLWksXG4gKiBwYXRjaC9naXQgYXBwbHksIGZvcm1hdHRlcnMsIHJlc3RvcmUvY2hlY2tvdXQpIHdob3NlIGV4aXN0ZW5jZSBwYXNzIHByb3Zlc1xuICogbm90aGluZywgYW5kIHByb2JlLWluYXBwbGljYWJsZSBjYXNlcyAocGhhbnRvbSBvciB1bnRyYWNrZWQtdW5zcGFubmVkXG4gKiBkZWxldGVzLCBkaXJlY3RvcnkgdGFyZ2V0cykuIGAncGVuZGluZydgIGlzIHRoZSBkcml2ZXIncyBhYnNlbnQtc291cmNlIGhvbGRcbiAqIChwbGFuIFx1MDBBNzMgc3RlcCAyKTogYW4gYWJzZW50IGNwIHNvdXJjZSB0aGF0IHBhc3NlZCB0aGUgcmVhbGl0eSBwcm9iZSBjYW5ub3RcbiAqIGRlY2lkZSBpdHMgZGVzdGluYXRpb24gdW50aWwgdGhlIHBhc3MtQSBleHBsYW5hdGlvbiBtYXAgaXMgY29tcGxldGUuXG4gKi9cbmV4cG9ydCB0eXBlIFdyaXRlR2F0ZU91dGNvbWUgPSAnZGVjaXNpdmVQYXNzJyB8ICdkZWNpc2l2ZUZhaWwnIHwgJ2luY29uY2x1c2l2ZScgfCAncGVuZGluZyc7XG5cbi8qKlxuICogUGVyLWNvbW1hbmQgZGVsZXRlLXJlYWxpdHkgcHJvYmUgY2FjaGUgKHBsYW4gXHUwMEE3MyBzdGVwIDFjKTogb25lIGBnaXRcbiAqIGxzLWZpbGVzIC0tZXJyb3ItdW5tYXRjaGAgYW5kIG9uZSBgZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbmAgYmF0Y2ggcGVyXG4gKiBjb21tYW5kLCBuZXZlciBvbmUgcGVyIHBhdGgsIG1lbWJlcnNoaXAgZnJvbSBwcmludGVkIHJvd3MuIFRoZVxuICogYHJ1bkJhc2hUb3VjaGVzYCBkcml2ZXIgc2VlZHMgaXQgd2l0aCBldmVyeSBhYnNlbnQgdGFyZ2V0IGFuZCBjcC9pbnN0YWxsXG4gKiBzb3VyY2Ugb2YgdGhlIGNvbXBvdW5kIGFuZCBzaGFyZXMgaXQgaW50byBwYXNzIEIgc28gc3Vydml2aW5nIGRlbGV0ZXNcbiAqIHJlLWdhdGUgd2l0aG91dCByZS1wcm9iaW5nLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFJlYWxpdHlQcm9iZUNhY2hlIHtcbiAgLyoqIERpc3RpbmN0IGFic29sdXRlIHBhdGhzIHRvIHByb2JlLCBpbiBmaXJzdC1zZWVuIG9yZGVyLiAqL1xuICBwYXRoczogc3RyaW5nW107XG4gIC8qKiBMYXp5OiBhYnNvbHV0ZSBwYXRocyBjb25maXJtZWQgaW5kZXgtdHJhY2tlZCBvciBzcGFubmVkLCBjb21wdXRlZCBvbmNlLiAqL1xuICByZWFsUGF0aHM6IFNldDxzdHJpbmc+IHwgbnVsbDtcbn1cblxuLyoqIENyZWF0ZSBhIHBlci1jb21tYW5kIHByb2JlIGNhY2hlIGZvciB0aGUgZ2l2ZW4gYWJzb2x1dGUgcGF0aHMuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlUmVhbGl0eVByb2JlQ2FjaGUocGF0aHM6IEl0ZXJhYmxlPHN0cmluZz4pOiBSZWFsaXR5UHJvYmVDYWNoZSB7XG4gIHJldHVybiB7IHBhdGhzOiBbLi4ubmV3IFNldChwYXRocyldLCByZWFsUGF0aHM6IG51bGwgfTtcbn1cblxuLyoqIFdoZXRoZXIgdGhlIHBhdGggZXhpc3RzIG9uIGRpc2sgKGFueSBub2RlIGtpbmQpOyBgZmFsc2VgIG9uIGFueSBzdGF0IGZhaWx1cmUuICovXG5leHBvcnQgZnVuY3Rpb24gZmlsZUV4aXN0cyhhYnNQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICBmcy5zdGF0U3luYyhhYnNQYXRoKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKiBXaGV0aGVyIHRoZSBwYXRoIGlzIGEgcmVndWxhciBmaWxlIFx1MjAxNCBhIGRpcmVjdG9yeSB0YXJnZXQgZmFpbHMgdGhlIGAnZXhpc3RzJ2AgZ2F0ZS4gKi9cbmZ1bmN0aW9uIGlzRmlsZU9uRGlzayhhYnNQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZnMuc3RhdFN5bmMoYWJzUGF0aCkuaXNGaWxlKCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIFZlcmlmeSBhIHN0YXRpY2FsbHkga25vd2FibGUgcG9zdC1jb250ZW50IGV4cGVjdGF0aW9uIGFnYWluc3QgdGhlIG9uLWRpc2tcbiAqIGZpbGUgKHBsYW4gXHUwMEE3MyBzdGVwIDFiKS4gQW55IHJlYWQgZmFpbHVyZSBpcyBhIG1pc21hdGNoLCBuZXZlciBhbiBlcnJvci5cbiAqL1xuZnVuY3Rpb24gY29udGVudE1hdGNoZXMocG9zdDogVG91Y2hQb3N0Q29udGVudCwgZmlsZVBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIGlmICgnZXhhY3QnIGluIHBvc3QpIHJldHVybiBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgsICd1dGY4JykgPT09IHBvc3QuZXhhY3Q7XG4gICAgaWYgKCdzdWZmaXgnIGluIHBvc3QpIHtcbiAgICAgIC8vIFRoZSBzaGVsbCBhcHBlbmRzIHRoZSBib2R5IHBsdXMgaXRzIHRlcm1pbmF0aW5nIG5ld2xpbmU7IHRoZSBoZXJlZG9jXG4gICAgICAvLyBncmFtbWFyIHN0cmlwcyBleGFjdGx5IHRoYXQgb25lIGBcXG5gIGZyb20gYHNwYW4ud3JpdHRlbmBcbiAgICAgIC8vIChwYXJzZS1jb21tYW5kLnRzIGhlcmVkb2MgYm9keSBleHRyYWN0aW9uKSwgc28gYSBmaWxlIGVuZGluZ1xuICAgICAgLy8gYHdyaXR0ZW5cXG5gIGlzIHRoZSBzYW1lIGFwcGVuZGVkIHRleHQgYXMgYHdyaXR0ZW5gIFx1MjAxNCBhY2NlcHQgYm90aC5cbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgsICd1dGY4Jyk7XG4gICAgICByZXR1cm4gY29udGVudC5lbmRzV2l0aChwb3N0LnN1ZmZpeCkgfHwgY29udGVudC5lbmRzV2l0aChgJHtwb3N0LnN1ZmZpeH1cXG5gKTtcbiAgICB9XG4gICAgaWYgKCdlbXB0eScgaW4gcG9zdCkgcmV0dXJuIGZzLnN0YXRTeW5jKGZpbGVQYXRoKS5zaXplID09PSAwO1xuICAgIHJldHVybiBmcy5zdGF0U3luYyhmaWxlUGF0aCkuc2l6ZSA9PT0gcG9zdC5zaXplO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgZGVsZXRlLXJlYWxpdHkgcHJvYmUgKHBsYW4gXHUwMEE3MyBzdGVwIDFjKTogbGF6aWx5IHJ1biB0aGUgdHdvIHBlci1jb21tYW5kXG4gKiBiYXRjaGVzIGFuZCBjYWNoZSB0aGUgY29uZmlybWVkLXJlYWwgcGF0aCBzZXQuIE1lbWJlcnNoaXAgY29tZXMgZnJvbSB0aGVcbiAqIHByaW50ZWQgcm93cywgbm90IHRoZSBleGl0IGNvZGUgXHUyMDE0IGBnaXQgbHMtZmlsZXMgLS1lcnJvci11bm1hdGNoYCBwcmludHNcbiAqIGV2ZXJ5IHRyYWNrZWQgcGF0aCBldmVuIHdoZW4gaXQgZXhpdHMgbm9uemVybyAoYW55IG1pc3NpbmcgcGF0aCksIGFuZFxuICogYGdpdCBzcGFuIGxpc3QgLS1wb3JjZWxhaW5gIHByaW50cyBub3RoaW5nIGZvciBwaGFudG9tIG9yIGtub3duLWJ1dC1cbiAqIHVuc3Bhbm5lZCBwYXRocyAoZXhpdCAwIHdpdGggXCJObyBzcGFucyBtYXRjaCB0aGUgZmlsdGVyc1wiKS4gQSBwbGFpbi1gcm1gJ2RcbiAqIHRyYWNrZWQgZmlsZSBrZWVwcyBpdHMgaW5kZXggZW50cnkgKGxzLWZpbGVzIGV4aXQgMCBcdTIwMTQgdGhlIHByb2JlIGZpcmVzKTtcbiAqIGBnaXQgcm1gIHJlbW92ZXMgaXQgKGxzLWZpbGVzIDEyOCkgc28gb25seSBzcGFubmVkIGZpbGVzIHN0YXkgcmVhbC4gQVxuICogcGhhbnRvbSBvciB1bnRyYWNrZWQtdW5zcGFubmVkIHBhdGggZmFpbHMgYm90aCBwcm9iZXMgXHUyMDE0IHRoZSBkZWxldGUgZGVncmFkZXNcbiAqIHRvIGAnaW5jb25jbHVzaXZlJ2AgYW5kIG5ldmVyIGZpcmVzLiBGYWlsLXNhZmU6IGFuIHVucmVzb2x2YWJsZSByZXBvIG9yIGFcbiAqIHByb2JlIGZhaWx1cmUgeWllbGRzIGFuIGVtcHR5IHNldCwgbmV2ZXIgYW4gZXJyb3IuXG4gKi9cbmZ1bmN0aW9uIHJlYWxQYXRocyhjYWNoZTogUmVhbGl0eVByb2JlQ2FjaGUsIGN3ZDogc3RyaW5nKTogU2V0PHN0cmluZz4ge1xuICBpZiAoY2FjaGUucmVhbFBhdGhzICE9PSBudWxsKSByZXR1cm4gY2FjaGUucmVhbFBhdGhzO1xuICBjb25zdCByZWFsID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGlmIChjYWNoZS5wYXRocy5sZW5ndGggPiAwKSB7XG4gICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICBpZiAocmVwb1Jvb3QgIT09IG51bGwpIHtcbiAgICAgIGNvbnN0IHJlbHMgPSBjYWNoZS5wYXRocy5tYXAoKHApID0+IHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290LCBwKSk7XG4gICAgICBjb25zdCBjYXB0dXJlID0gKGFyZ3M6IHN0cmluZ1tdKTogc3RyaW5nIHwgbnVsbCA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgYXJncywge1xuICAgICAgICAgICAgY3dkOiByZXBvUm9vdCxcbiAgICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgICB0aW1lb3V0OiBERUZBVUxUX1RJTUVPVVRfTVNcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgY29uc3Qgc3Rkb3V0ID0gKGVyciBhcyB7IHN0ZG91dD86IHN0cmluZyB9KS5zdGRvdXQ7XG4gICAgICAgICAgcmV0dXJuIHR5cGVvZiBzdGRvdXQgPT09ICdzdHJpbmcnID8gc3Rkb3V0IDogbnVsbDtcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICAgIGNvbnN0IGxzRmlsZXMgPSBjYXB0dXJlKFsnbHMtZmlsZXMnLCAnLS1lcnJvci11bm1hdGNoJywgJy0tJywgLi4ucmVsc10pO1xuICAgICAgaWYgKGxzRmlsZXMgIT09IG51bGwpIHtcbiAgICAgICAgZm9yIChjb25zdCBsaW5lIG9mIGxzRmlsZXMuc3BsaXQoJ1xcbicpKSB7XG4gICAgICAgICAgY29uc3QgcmVsID0gbGluZS50cmltKCk7XG4gICAgICAgICAgaWYgKHJlbC5sZW5ndGggPiAwKSByZWFsLmFkZChqb2luKHJlcG9Sb290LCByZWwpKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgY29uc3Qgc3Bhbkxpc3QgPSBjYXB0dXJlKFsnc3BhbicsICdsaXN0JywgJy0tcG9yY2VsYWluJywgLi4ucmVsc10pO1xuICAgICAgaWYgKHNwYW5MaXN0ICE9PSBudWxsKSB7XG4gICAgICAgIGZvciAoY29uc3Qgcm93IG9mIHBhcnNlUG9yY2VsYWluKHNwYW5MaXN0KSkgcmVhbC5hZGQoam9pbihyZXBvUm9vdCwgcm93LnBhdGgpKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgY2FjaGUucmVhbFBhdGhzID0gcmVhbDtcbiAgcmV0dXJuIHJlYWw7XG59XG5cbi8qKlxuICogVGhlIGxheWVyZWQgcG9zdC1zdGF0ZSBnYXRlIChwbGFuIFx1MDBBNzMgc3RlcCAxKSwgZXZhbHVhdGVkIGJlZm9yZSBhbnkgZXhlY3V0b3JcbiAqIGNhbGwsIHNpZGUtZWZmZWN0LWZyZWUgKG5vIG1lbW8gd3JpdGVzLCBubyBleGVjdXRvciBjYWxsczsgdGhlIHByb2JlIGlzXG4gKiByZWFkLW9ubHkgYW5kIHBlci1jb21tYW5kIGNhY2hlZCk6XG4gKlxuICogMS4gYHRhcmdldFN0YXRlOiAnYWJzZW50J2AgXHUyMTkyIHRoZSBwYXRoIG11c3QgYmUgYWJzZW50OyB3aGVuIGl0IGlzLCB0aGVcbiAqICAgIGRlbGV0ZS1yZWFsaXR5IHByb2JlIGRlY2lkZXM6IGluZGV4LXRyYWNrZWQgb3Igc3Bhbm5lZCBcdTIxOTIgYGRlY2lzaXZlUGFzc2BcbiAqICAgIChkYW5nbGluZyBhbmNob3JzIHN1cmZhY2UpLCBwaGFudG9tIFx1MjE5MiBgJ2luY29uY2x1c2l2ZSdgIChub3RoaW5nIHRvXG4gKiAgICBzdXJmYWNlIFx1MjAxNCB0aGUgbWlzcyBpcyBoYXJtbGVzcywgYW5kIHRoZSBkZWxldGUgbmV2ZXIgZmlyZXMpLlxuICogMi4gYHRhcmdldFN0YXRlOiAnZXhpc3RzJ2AgXHUyMTkyIHRoZSB0YXJnZXQgbXVzdCBiZSBhIHJlZ3VsYXIgZmlsZSAoYSBkaXJlY3RvcnlcbiAqICAgIG9yIG1pc3NpbmcgdGFyZ2V0IGZhaWxzKS5cbiAqIDMuIENvbnRlbnQgdmVyaWZpY2F0aW9uIHdoZXJlIHRoZSBleHBlY3RlZCBwb3N0LWNvbnRlbnQgaXMgc3RhdGljYWxseVxuICogICAga25vd2FibGUgKGBleGFjdGAvYHN1ZmZpeGAvYGVtcHR5YC9gc2l6ZWApOiBhIG1pc21hdGNoIG1lYW5zIHRoZSB3cml0ZSdzXG4gKiAgICBlZmZlY3QgaXMgYWJzZW50IFx1MjAxNCBubyB0b3VjaC5cbiAqIDQuIGNwIGRlc3RpbmF0aW9uLXZzLXNvdXJjZTogYSBzdGlsbC1wcmVzZW50IHNvdXJjZSBtdXN0IGJ5dGUtZXF1YWwgdGhlXG4gKiAgICBkZXN0aW5hdGlvbjsgYW4gYWJzZW50IHNvdXJjZSBhcHBsaWVzIHRoZSBhYnNlbnQtc291cmNlIHJ1bGUgKHBhc3NlZCB0aGVcbiAqICAgIHJlYWxpdHkgcHJvYmUgQU5EIGl0cyBhYnNlbmNlIGV4cGxhaW5lZCBieSBhIGxhdGVyIHNhbWUtcGF0aFxuICogICAgYGRlY2lzaXZlUGFzc2AgXHUyMDE0IHRoZSBkcml2ZXIgcmVzb2x2ZXMgdGhlIGAncGVuZGluZydgIGhvbGQpLlxuICogNS4gcmVuYW1lLWNvcHk6IHRoZSBkZXN0aW5hdGlvbiBmaXJlcyBvbmx5IHdoZW4gaXRzIHNvdXJjZSBwYXNzZWQgdGhlXG4gKiAgICBkZWxldGUtcmVhbGl0eSBwcm9iZSAoYSBwaGFudG9tIHNvdXJjZSBtZWFucyB0aGUgbW92ZSBmYWlsZWQpLlxuICpcbiAqIEV2ZXJ5dGhpbmcgZWxzZSBcdTIwMTQgdGhlIGV4aXN0ZW5jZS1nYXRlZCBmYW1pbGllcyB3aG9zZSBleGlzdGVuY2UgcGFzcyBwcm92ZXNcbiAqIG5vdGhpbmcgXHUyMDE0IGlzIGAnaW5jb25jbHVzaXZlJ2AuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBldmFsdWF0ZVdyaXRlR2F0ZShpbnB1dDogVG91Y2hXcml0ZUlucHV0LCBwcm9iZUNhY2hlOiBSZWFsaXR5UHJvYmVDYWNoZSk6IFdyaXRlR2F0ZU91dGNvbWUge1xuICBpZiAoaW5wdXQudGFyZ2V0U3RhdGUgPT09ICdhYnNlbnQnKSB7XG4gICAgaWYgKGZpbGVFeGlzdHMoaW5wdXQuZmlsZVBhdGgpKSByZXR1cm4gJ2RlY2lzaXZlRmFpbCc7XG4gICAgcmV0dXJuIHJlYWxQYXRocyhwcm9iZUNhY2hlLCBpbnB1dC5jd2QpLmhhcyhpbnB1dC5maWxlUGF0aCkgPyAnZGVjaXNpdmVQYXNzJyA6ICdpbmNvbmNsdXNpdmUnO1xuICB9XG5cbiAgaWYgKCFpc0ZpbGVPbkRpc2soaW5wdXQuZmlsZVBhdGgpKSByZXR1cm4gJ2RlY2lzaXZlRmFpbCc7XG5cbiAgY29uc3QgY29udGVudCA9IGlucHV0LnBvc3RTdGF0ZT8uY29udGVudDtcbiAgaWYgKGNvbnRlbnQgIT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiBjb250ZW50TWF0Y2hlcyhjb250ZW50LCBpbnB1dC5maWxlUGF0aCkgPyAnZGVjaXNpdmVQYXNzJyA6ICdkZWNpc2l2ZUZhaWwnO1xuICB9XG5cbiAgaWYgKGlucHV0LnNvdXJjZVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgIGlmIChmaWxlRXhpc3RzKGlucHV0LnNvdXJjZVBhdGgpKSB7XG4gICAgICBsZXQgc3JjOiBzdHJpbmc7XG4gICAgICBsZXQgZHN0OiBzdHJpbmc7XG4gICAgICB0cnkge1xuICAgICAgICBzcmMgPSBmcy5yZWFkRmlsZVN5bmMoaW5wdXQuc291cmNlUGF0aCwgJ3V0ZjgnKTtcbiAgICAgICAgZHN0ID0gZnMucmVhZEZpbGVTeW5jKGlucHV0LmZpbGVQYXRoLCAndXRmOCcpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiAnZGVjaXNpdmVGYWlsJztcbiAgICAgIH1cbiAgICAgIHJldHVybiBzcmMgPT09IGRzdCA/ICdkZWNpc2l2ZVBhc3MnIDogJ2RlY2lzaXZlRmFpbCc7XG4gICAgfVxuICAgIC8vIEFic2VudCBzb3VyY2UgXHUyMDE0IHRoZSBhYnNlbnQtc291cmNlIHJ1bGUgKHBsYW4gXHUwMEE3MyBzdGVwIDFiKTogdGhlIGRlc3RcbiAgICAvLyBmaXJlcyBvbmx5IHdoZW4gdGhlIHNvdXJjZSBwYXNzZWQgdGhlIHJlYWxpdHkgcHJvYmUgKGl0IHdhcyBhIHJlYWxcbiAgICAvLyBmaWxlKSBBTkQgaXRzIGFic2VuY2UgaXMgZXhwbGFpbmVkIGJ5IGEgbGF0ZXIgc2FtZS1wYXRoIGRlY2lzaXZlUGFzcy5cbiAgICByZXR1cm4gcmVhbFBhdGhzKHByb2JlQ2FjaGUsIGlucHV0LmN3ZCkuaGFzKGlucHV0LnNvdXJjZVBhdGgpID8gJ3BlbmRpbmcnIDogJ2RlY2lzaXZlRmFpbCc7XG4gIH1cblxuICBpZiAoaW5wdXQucmVuYW1lU291cmNlUGF0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgLy8gTm8gY29udGVudCBjb21wYXJpc29uIFx1MjAxNCBwYXRjaCByZW5hbWVzIG1heSBjaGFuZ2UgY29udGVudDsgYSBwaGFudG9tXG4gICAgLy8gc291cmNlIG1lYW5zIHRoZSBtb3ZlIGZhaWxlZCBhbmQgYSBwcmUtZXhpc3RpbmcgZGVzdGluYXRpb24gd2FzIG5ldmVyXG4gICAgLy8gdG91Y2hlZCAocGxhbiBcdTAwQTczIHN0ZXAgMWMpLlxuICAgIHJldHVybiByZWFsUGF0aHMocHJvYmVDYWNoZSwgaW5wdXQuY3dkKS5oYXMoaW5wdXQucmVuYW1lU291cmNlUGF0aCkgPyAnZGVjaXNpdmVQYXNzJyA6ICdkZWNpc2l2ZUZhaWwnO1xuICB9XG5cbiAgcmV0dXJuICdpbmNvbmNsdXNpdmUnO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEluamVjdGVkIGV4ZWN1dG9yc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBTdHJ1Y3R1cmVkIHJlc3VsdCBvZiBhIHNjb3BlZCBgZ2l0IHNwYW4gZHJpZnQgPGZpbGU+IC0tZml4YC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hGaXhSZXN1bHQge1xuICAvKipcbiAgICogV2hldGhlciBgLS1maXhgIHJlLWFuY2hvcmVkIGF0IGxlYXN0IG9uZSBzcGFuIGluIHRoZSB3b3JraW5nIHRyZWUuIERyaXZlc1xuICAgKiB7QGxpbmsgVG91Y2hPdXRwdXQudHJlZU1vZGlmaWVkfSBzbyBhIGNhbGxlci90ZXN0IGNhbiBhc3NlcnQgdGhlIGhlYWxpbmdcbiAgICogaGFwcGVuZWQgd2l0aG91dCBkaWZmaW5nIHRoZSB0cmVlIGl0c2VsZi5cbiAgICovXG4gIG1vZGlmaWVkOiBib29sZWFuO1xufVxuXG4vKipcbiAqIFJ1biBgZ2l0IHNwYW4gZHJpZnQgPGZpbGU+IC0tZml4YCBzY29wZWQgdG8gdGhlIHRvdWNoZWQgZmlsZSAod3JpdGUgcGF0aFxuICogb25seSksIHJlcG9ydGluZyB3aGV0aGVyIHRoZSB3b3JraW5nIHRyZWUgd2FzIGhlYWxlZC4gQXN5bmMgc28gdGhlIGV2ZW50dWFsXG4gKiBpbXBsZW1lbnRhdGlvbiBhbmQgaXRzIHRlc3RzIGNhbiBpbmplY3QgYSBmYWtlIHdpdGhvdXQgYSByZWFsIHN1YnByb2Nlc3MuXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoRml4RXhlY3V0b3IgPSAoZmlsZVBhdGg6IHN0cmluZywgY3dkOiBzdHJpbmcpID0+IFByb21pc2U8VG91Y2hGaXhSZXN1bHQ+O1xuXG4vKipcbiAqIFJ1biBgZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbiA8ZmlsZT5gIGFuZCByZXR1cm4gaXRzIHBhcnNlZCByb3dzIFx1MjAxNCBvbmUgcGVyXG4gKiBhbmNob3IgY292ZXJpbmcgdGhlIGZpbGUuIFN0cnVjdHVyZWQgKG5vdCByYXcgc3Rkb3V0KSBzbyB0aGUgbWVyZ2VkLWJsb2NrXG4gKiBjb21wdXRhdGlvbiBhbmQgaXRzIHRlc3RzIHNoYXJlIHRoZSBzYW1lIHNoYXBlLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaExpc3RFeGVjdXRvciA9IChmaWxlUGF0aDogc3RyaW5nLCBjd2Q6IHN0cmluZykgPT4gUHJvbWlzZTxQb3JjZWxhaW5Sb3dbXT47XG5cbi8qKlxuICogUnVuIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW4gPGFyZ3M+YCAoc2NvcGVkIHRvIHRoZSB0b3VjaGVkIGZpbGUgb3JcbiAqIGl0cyBzcGFucykgYW5kIHJldHVybiBpdHMgcGFyc2VkIHJvd3MgXHUyMDE0IG9uZSBwZXIgZHJpZnRlZCBhbmNob3IsIGVtcHR5IHdoZW5cbiAqIGNsZWFuLiBTdGF0dXMgY2xhc3NpZmljYXRpb24gaXMgdmlhIGBpc0RlYnQoKWA7IHBvc2l0aW9uYWwgKGBNT1ZFRGAsXG4gKiBgUkVTT0xWRURfUEVORElOR19DT01NSVRgKSByb3dzIGFyZSBuZXZlciBkZWJ0LlxuICovXG5leHBvcnQgdHlwZSBUb3VjaERyaWZ0RXhlY3V0b3IgPSAoYXJnczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKSA9PiBQcm9taXNlPERyaWZ0UG9yY2VsYWluUm93W10+O1xuXG4vKipcbiAqIFJ1biBiYXJlIGBnaXQgc3BhbiB3aHkgPG5hbWU+YCBhbmQgcmV0dXJuIHRoZSBzcGFuJ3MgcmVjb3JkZWQgd2h5IHNlbnRlbmNlLFxuICogb3IgYG51bGxgIHdoZW4gbm9uZSBpcyByZWNvcmRlZCBvciB0aGUgcmVhZCBmYWlscy4gRmVlZHMgdGhlIGh1bWFuLWZvcm1hdFxuICogc3BhbiByZW5kZXI7IGludm9rZWQgb25seSBmb3Igc3BhbnMgYWN0dWFsbHkgYmVpbmcgc3VyZmFjZWQgdGhpcyB0b3VjaC5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hXaHlFeGVjdXRvciA9IChuYW1lOiBzdHJpbmcsIGN3ZDogc3RyaW5nKSA9PiBQcm9taXNlPHN0cmluZyB8IG51bGw+O1xuXG4vKipcbiAqIFRoZSBpbmplY3RlZCBleGVjdXRpb24gc3VyZmFjZS4gS2VwdCBhcyBmb3VyIG5hcnJvdyBhc3luYyBmdW5jdGlvbnMgKHJhdGhlclxuICogdGhhbiBhIHJhdyBjb21tYW5kIHJ1bm5lcikgc28gdGVzdHMgaW5qZWN0IGZha2VzIHJldHVybmluZyBzdHJ1Y3R1cmVkIGRhdGFcbiAqIGFuZCB0aGUgY29yZSBuZXZlciBzcGF3bnMgYSBzdWJwcm9jZXNzIGl0c2VsZi4gVGhlIGByZWFkYCBwYXRoIG5ldmVyIGludm9rZXNcbiAqIGBmaXhgLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoRXhlY3V0b3JzIHtcbiAgZml4OiBUb3VjaEZpeEV4ZWN1dG9yO1xuICBsaXN0OiBUb3VjaExpc3RFeGVjdXRvcjtcbiAgZHJpZnQ6IFRvdWNoRHJpZnRFeGVjdXRvcjtcbiAgd2h5OiBUb3VjaFdoeUV4ZWN1dG9yO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIG91dHB1dFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBXaGF0IHRoZSBjb3JlIGhhbmRzIGJhY2sgZm9yIHRoZSBhZGFwdGVyIHRvIHRyYW5zbGF0ZSBpbnRvIFNESyBvdXRwdXQuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoT3V0cHV0IHtcbiAgLyoqXG4gICAqIFRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrIChoZWFkZXIsIG9uZSBodW1hbi1mb3JtYXQgc2VjdGlvbiBwZXJcbiAgICogc3VyZmFjZWQgc3BhbiwgZm9vdGVyKSB0byBpbmplY3QgdmlhIHRoZSBoYXJuZXNzJ3MgYGFkZGl0aW9uYWxDb250ZXh0YCxcbiAgICogb3IgYG51bGxgIHdoZW4gdGhlcmUgaXMgbm90aGluZyB3b3J0aCBzdXJmYWNpbmcgdGhpcyB0b3VjaC5cbiAgICovXG4gIGFkZGl0aW9uYWxDb250ZXh0OiBzdHJpbmcgfCBudWxsO1xuICAvKipcbiAgICogV2hldGhlciB0aGUgd29ya2luZyB0cmVlIHdhcyBtb2RpZmllZCBieSBhIHNjb3BlZCBgLS1maXhgIG9uIHRoZSB3cml0ZSBwYXRoLlxuICAgKiBBbHdheXMgYGZhbHNlYCBvbiB0aGUgcmVhZCBwYXRoIChyZWFkcyBuZXZlciBtdXRhdGUgdGhlIHRyZWUpLlxuICAgKi9cbiAgdHJlZU1vZGlmaWVkOiBib29sZWFuO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE1lcmdlZC1ibG9jayBhc3NlbWJseVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBUaGUgbWVtbyBrZXkgdW5kZXIgd2hpY2ggYSBzcGFuJ3MgcmVuZGVyIGZvciBhIGdpdmVuIGRyaWZ0IHN0YXR1cyBpcyBkZWR1cGVkLiAqL1xuZnVuY3Rpb24gZHJpZnRLZXkobmFtZTogc3RyaW5nLCBzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IHN0cmluZyB7XG4gIC8vIFNwYW4gbmFtZXMgY29tZSBmcm9tIHRhYi1kZWxpbWl0ZWQgcG9yY2VsYWluLCBzbyB0aGV5IG5ldmVyIGNvbnRhaW4gYSB0YWI7XG4gIC8vIGEgdGFiLWpvaW5lZCBrZXkgY2FuIG5ldmVyIGNvbGxpZGUgd2l0aCBhIGJhcmUgc3BhbiBuYW1lICh0aGUgc3VyZmFjaW5nIGtleSkuXG4gIHJldHVybiBgJHtuYW1lfVxcdCR7c3RhdHVzfWA7XG59XG5cbi8qKiBUaGUgYHBhdGgjTHN0YXJ0LUxlbmRgIChvciBiYXJlLXBhdGgsIHdob2xlLWZpbGUpIGFuY2hvciB0ZXh0IGZvciBhIHJvdy4gKi9cbmZ1bmN0aW9uIGFuY2hvclRleHQocm93OiBQb3JjZWxhaW5Sb3cpOiBzdHJpbmcge1xuICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIHJldHVybiByb3cucGF0aDtcbiAgcmV0dXJuIGAke3Jvdy5wYXRofSNMJHtyb3cuc3RhcnR9LUwke3Jvdy5lbmR9YDtcbn1cblxuZnVuY3Rpb24gY2xlYW5IZWFkZXIoZmlsZU5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgJHtmaWxlTmFtZX0gaGFzIGltcGxpY2l0IGRlcGVuZGVuY2llczpgO1xufVxuXG5mdW5jdGlvbiBjbGVhbkZvb3RlcihmaWxlTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGBJZiB5b3UgY2hhbmdlICR7ZmlsZU5hbWV9IGNoZWNrIHRoZSBvdGhlciBmaWxlcyB0byBjb25maXJtIHRoZXkgc3RpbGwgd29yayB0b2dldGhlci5gO1xufVxuXG4vKipcbiAqIFRoZSB3cml0ZSBwYXRoIG5hbWVzIHRoZSBlZGl0IGFzIHRoZSBjYXVzZTsgdGhlIHJlYWQgcGF0aCBvbmx5IHN1cmZhY2VzXG4gKiBwcmUtZXhpc3RpbmcgZHJpZnQgaXQgZGlkbid0IGNyZWF0ZSwgc28gaXQgbmFtZXMgdGhlIGRlcGVuZGVuY3kgaW5zdGVhZC5cbiAqL1xuZnVuY3Rpb24gZHJpZnRIZWFkZXIoZHJpZnRlZENvdW50OiBudW1iZXIsIGtpbmQ6IFRvdWNoSW5wdXRbJ2tpbmQnXSk6IHN0cmluZyB7XG4gIGlmIChraW5kID09PSAnd3JpdGUnKSB7XG4gICAgcmV0dXJuIGRyaWZ0ZWRDb3VudCA9PT0gMVxuICAgICAgPyAnVGhpcyBlZGl0IHB1dCBhbiBpbXBsaWNpdCBkZXBlbmRlbmN5IG91dCBvZiBkYXRlOidcbiAgICAgIDogJ1RoaXMgZWRpdCBwdXQgaW1wbGljaXQgZGVwZW5kZW5jaWVzIG91dCBvZiBkYXRlOic7XG4gIH1cbiAgcmV0dXJuIGRyaWZ0ZWRDb3VudCA9PT0gMVxuICAgID8gJ1RoaXMgZmlsZSBoYXMgYW4gaW1wbGljaXQgZGVwZW5kZW5jeSBvdXQgb2YgZGF0ZTonXG4gICAgOiAnVGhpcyBmaWxlIGhhcyBpbXBsaWNpdCBkZXBlbmRlbmNpZXMgb3V0IG9mIGRhdGU6Jztcbn1cblxuZnVuY3Rpb24gZHJpZnRGb290ZXIoZHJpZnRlZE5hbWVzOiBzdHJpbmdbXSk6IHN0cmluZyB7XG4gIGlmIChkcmlmdGVkTmFtZXMubGVuZ3RoID09PSAxKSB7XG4gICAgY29uc3QgbmFtZSA9IGRyaWZ0ZWROYW1lc1swXTtcbiAgICByZXR1cm4gYFJlc3RvcmUgYWdyZWVtZW50IGJlZm9yZSBjb21taXR0aW5nLiBGb2xsb3cgY29uZmlybWVkIGF1dGhvcml0eS4gUHJlc2VydmUgYW5jaG9yIHNoYXBlOyBpZiBhbiBhZGRyZXNzIGNoYW5nZWQsIHJlbW92ZSBpdHMgb2xkIGFuY2hvciBiZWZvcmUgYWRkaW5nIHRoZSBuZXcgb25lLiBVcGRhdGUgb3IgcmV0aXJlIHRoZSB3aHkgb25seSBpZiBpdHMgbWVhbmluZyBjaGFuZ2VkLiBSZXF1aXJlIFxcYGdpdCBzcGFuIGRyaWZ0ICR7bmFtZX1cXGAgdG8gcmVwb3J0IHplcm8sIHRoZW4gY2hlY2sgdGhlIG90aGVyIGFuY2hvcnMuIENvbmZvcm0gYSBzaWRlIG9ubHkgd2hlbiBjb25maXJtZWQgYXV0aG9yaXR5IG9yIGEgc2F0aXNmaWVkIGdhdGUgZGVjaWRlcyBpdDsgcmVwb3J0IGFtYmlndWl0eSBvciBhbiBvYnNvbGV0ZSBjb3VwbGluZy5gO1xuICB9XG4gIHJldHVybiAnRm9yIGVhY2ggb3V0LW9mLWRhdGUgc3BhbjogcmVzdG9yZSBhZ3JlZW1lbnQgYmVmb3JlIGNvbW1pdHRpbmcuIEZvbGxvdyBjb25maXJtZWQgYXV0aG9yaXR5LiBQcmVzZXJ2ZSBhbmNob3Igc2hhcGU7IGlmIGFuIGFkZHJlc3MgY2hhbmdlZCwgcmVtb3ZlIGl0cyBvbGQgYW5jaG9yIGJlZm9yZSBhZGRpbmcgdGhlIG5ldyBvbmUuIFVwZGF0ZSBvciByZXRpcmUgdGhlIHdoeSBvbmx5IGlmIGl0cyBtZWFuaW5nIGNoYW5nZWQuIFJlcXVpcmUgYGdpdCBzcGFuIGRyaWZ0IDxuYW1lPmAgdG8gcmVwb3J0IHplcm8sIHRoZW4gY2hlY2sgdGhlIG90aGVyIGFuY2hvcnMuIENvbmZvcm0gYSBzaWRlIG9ubHkgd2hlbiBjb25maXJtZWQgYXV0aG9yaXR5IG9yIGEgc2F0aXNmaWVkIGdhdGUgZGVjaWRlcyBpdDsgcmVwb3J0IGFtYmlndWl0eSBvciBhbiBvYnNvbGV0ZSBjb3VwbGluZy4nO1xufVxuXG4vKiogVGhlIHtAbGluayBSYW5nZUxhYmVsfSBmb3IgYSBwb3JjZWxhaW4gcm93IFx1MjAxNCBgMC0wYCBpcyB0aGUgd2hvbGUtZmlsZSBhbmNob3IuICovXG5mdW5jdGlvbiByYW5nZUxhYmVsKHJvdzogUG9yY2VsYWluUm93KTogUmFuZ2VMYWJlbCB7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHsga2luZDogJ3dob2xlLWZpbGUnIH07XG4gIHJldHVybiB7IGtpbmQ6ICdyYW5nZScsIHN0YXJ0OiByb3cuc3RhcnQsIGVuZDogcm93LmVuZCB9O1xufVxuXG4vKipcbiAqIEEgc3BhbidzIGZ1bGwgYW5jaG9yIGxpc3QsIHJlbmRlcmVkIGFzIGEgc2hhcmVkLXByZWZpeCB0cmVlIGJ5XG4gKiB7QGxpbmsgcmVuZGVyQW5jaG9yVHJlZX0sIHdpdGggZWFjaCBhbmNob3IgdGhhdCBjYXJyaWVzIGdlbnVpbmUgZHJpZnRcbiAqIHN1ZmZpeGVkIGJ5IGl0cyBsb3dlcmNhc2Ugc3RhdHVzIHRva2VuKHMpIChgIFx1MjAxNCBjaGFuZ2VkYCkuXG4gKlxuICogQSBkcmlmdCByb3cgbWF0Y2hlcyBhbiBhbmNob3IgYnkgZXhhY3QgcGF0aCtyYW5nZSwgb3IgYnkgcGF0aCBhbG9uZSB3aGVuIHRoZVxuICogc3BhbiBoYXMgYSBzaW5nbGUgYW5jaG9yIG9uIHRoYXQgcGF0aCAocmFuZ2VzIGNhbiBkaXNhZ3JlZSBhZnRlciBhIGhlYWwpLlxuICogYHNvbGVPblBhdGhgIGlzIGRlbGliZXJhdGVseSBjb21wdXRlZCBvdmVyIHRoZSAqKmZ1bGwgZmxhdCBhbmNob3IgbGlzdCoqLFxuICogYmVmb3JlIGFueSBncm91cGluZyBcdTIwMTQgdGhlIHRyZWUgbGF5b3V0IG11c3QgbmV2ZXIgYmUgYWJsZSB0byBjaGFuZ2UgKndoaWNoKlxuICogYW5jaG9ycyBnZXQgbGFiZWxlZCwgb25seSB3aGVyZSB0aGV5IHNpdCBvbiB0aGUgcGFnZS5cbiAqL1xuZnVuY3Rpb24gYW5jaG9yQnVsbGV0cyhhbmNob3JzOiBQb3JjZWxhaW5Sb3dbXSwgZGVidFJvd3M6IERyaWZ0UG9yY2VsYWluUm93W10pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHJvd3MgPSBhbmNob3JzLm1hcCgoYW5jaG9yKSA9PiB7XG4gICAgY29uc3Qgc29sZU9uUGF0aCA9IGFuY2hvcnMuZmlsdGVyKChhKSA9PiBhLnBhdGggPT09IGFuY2hvci5wYXRoKS5sZW5ndGggPT09IDE7XG4gICAgY29uc3Qgc3RhdHVzZXMgPSBuZXcgU2V0PFBvcmNlbGFpblN0YXR1cz4oKTtcbiAgICBmb3IgKGNvbnN0IHJvdyBvZiBkZWJ0Um93cykge1xuICAgICAgaWYgKHJvdy5wYXRoICE9PSBhbmNob3IucGF0aCkgY29udGludWU7XG4gICAgICBpZiAoc29sZU9uUGF0aCB8fCAocm93LnN0YXJ0ID09PSBhbmNob3Iuc3RhcnQgJiYgcm93LmVuZCA9PT0gYW5jaG9yLmVuZCkpIHtcbiAgICAgICAgc3RhdHVzZXMuYWRkKHJvdy5zdGF0dXMpO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBzb3J0ZWQgPSBbLi4uc3RhdHVzZXNdLnNvcnQoKTtcbiAgICBjb25zdCBzdWZmaXggPSBzb3J0ZWQubGVuZ3RoID4gMCA/IGAgXHUyMDE0ICR7c29ydGVkLm1hcChodW1hblN0YXR1c0xhYmVsKS5qb2luKCcsICcpfWAgOiAnJztcbiAgICByZXR1cm4geyBwYXRoOiBhbmNob3IucGF0aCwgcmFuZ2U6IHJhbmdlTGFiZWwoYW5jaG9yKSwgc3VmZml4IH07XG4gIH0pO1xuICB0cnkge1xuICAgIHJldHVybiByZW5kZXJBbmNob3JUcmVlKGNvbGxhcHNlQnlQYXRoKHJvd3MpKTtcbiAgfSBjYXRjaCB7XG4gICAgLy8gRkFJTC1DTE9TRUQsIG5vdCBhIGA8Z3JlZW5maWVsZD5gLWZvcmJpZGRlbiBmYWxsYmFjayBcdTIwMTQgZG8gbm90IHJlbW92ZSBpdFxuICAgIC8vIG9uIHRoZSB0aGVvcnkgdGhhdCBhIGRlZ3JhZGVkIGZhbGxiYWNrIGlzIGl0c2VsZiBmb3JiaWRkZW4uIEFuIHVuY2F1Z2h0XG4gICAgLy8gdGhyb3cgaGVyZSBkb2VzIG5vdCBkZWdyYWRlIHRvIGEgZmxhdCBsaXN0OiBpdCBlc2NhcGVzIHRvXG4gICAgLy8gYHJ1blRvdWNoSG9va2AncyBjYXRjaCwgd2hpY2ggcmVzb2x2ZXMgdGhlIHdob2xlIGhvb2sgdG9cbiAgICAvLyBgYWRkaXRpb25hbENvbnRleHQ6IG51bGxgLCBzbyB0aGUgYWdlbnQgaXMgbmV2ZXIgdG9sZCBhYm91dCB0aGUgZHJpZnQgYXRcbiAgICAvLyBhbGwuIENhdGNoaW5nIGxvY2FsbHkgbmFycm93cyB3aGF0IGEgcmVuZGVyaW5nIGRlZmVjdCBjYW4gY29zdCBmcm9tIFwidGhlXG4gICAgLy8gcmVtaW5kZXIgZGlzYXBwZWFyc1wiIHRvIFwidGhlIHJlbWluZGVyIGxvb2tzIGxpa2UgaXQgZGlkIGJlZm9yZSB0aGUgdHJlZVwiLlxuICAgIC8vIFdoZXRoZXIgdG8gc3VyZmFjZSBhbmQgd2hhdCBzaGFwZSB0byBzdXJmYWNlIGluIGFyZSBkaWZmZXJlbnQgdGhpbmdzLCBhbmRcbiAgICAvLyB0aGlzIGNhdGNoIG9ubHkgZXZlciB0b3VjaGVzIHRoZSBsYXR0ZXIuXG4gICAgLy8gYHJvd3NgIGlzIGluZGV4LWFsaWduZWQgd2l0aCBgYW5jaG9yc2AsIHNvIHRoaXMgcmVwcm9kdWNlcyB0b2RheSdzIGZsYXRcbiAgICAvLyBidWxsZXQgcnVuIGJ5dGUgZm9yIGJ5dGUsIHN1ZmZpeGVzIGluY2x1ZGVkLlxuICAgIHJldHVybiBhbmNob3JzLm1hcCgoYW5jaG9yLCBpKSA9PiBgLSAke2FuY2hvclRleHQoYW5jaG9yKX0ke3Jvd3NbaV0uc3VmZml4fWApO1xuICB9XG59XG5cbi8qKlxuICogT25lIGh1bWFuLWZvcm1hdCBzcGFuIHNlY3Rpb246IGAjIyA8bmFtZT5gLCB0aGUgZnVsbCBhbmNob3IgbGlzdCAoZHJpZnRlZFxuICogYW5jaG9ycyBzdGF0dXMtc3VmZml4ZWQpLCBhbmQgdGhlIHdoeSBzZW50ZW5jZSB3aGVuIG9uZSBpcyByZWNvcmRlZC5cbiAqXG4gKiBUaGUgbmFtZSBoZWFkZXIgYW5kIHRoZSB3aHkgc2VudGVuY2UgYXJlIHRoZSBzYW1lIHNoYXBlIGBnaXQgc3BhbiBsaXN0YFxuICogcmVuZGVyczsgdGhlIGFuY2hvciBsaXN0IGRlbGliZXJhdGVseSBpcyBub3QgXHUyMDE0IGl0IHJlbmRlcnMgYXMgYSBzaGFyZWQtcHJlZml4XG4gKiB0cmVlICh7QGxpbmsgYW5jaG9yQnVsbGV0c30pIHdoZXJlIHRoZSBDTEkgcHJpbnRzIGEgZmxhdCBgLSBwYXRoI0xyYW5nZWBcbiAqIGJ1bGxldCBydW4uIFRoZSBDTEkncyBvd24gdGV4dCBmb3JtYXQgaXMgdW50b3VjaGVkOyBvbmx5IHRoaXMgaG9vaydzXG4gKiByZS1wcmVzZW50YXRpb24gb2YgaXQgZ3JvdXBzLlxuICovXG5mdW5jdGlvbiByZW5kZXJTcGFuU2VjdGlvbihcbiAgbmFtZTogc3RyaW5nLFxuICBhbmNob3JzOiBQb3JjZWxhaW5Sb3dbXSxcbiAgZGVidFJvd3M6IERyaWZ0UG9yY2VsYWluUm93W10sXG4gIHdoeTogc3RyaW5nIHwgbnVsbFxuKTogc3RyaW5nIHtcbiAgY29uc3QgbGluZXMgPSBbYCMjICR7bmFtZX1gLCAuLi5hbmNob3JCdWxsZXRzKGFuY2hvcnMsIGRlYnRSb3dzKV07XG4gIGlmICh3aHkpIGxpbmVzLnB1c2goJycsIHdoeSk7XG4gIHJldHVybiBsaW5lcy5qb2luKCdcXG4nKTtcbn1cblxuLyoqXG4gKiBBc3NlbWJsZSB0aGUgbWVyZ2VkIGA8Z2l0LXNwYW4+YCBibG9jazogaGVhZGVyLCBvbmUgc2VjdGlvbiBwZXIgc3VyZmFjZWRcbiAqIHNwYW4gKHNlcGFyYXRlZCBieSBgLS0tYCksIGFuZCBhIHNpbmdsZSBmb290ZXIgYWZ0ZXIgYSBmaW5hbCBgLS0tYC5cbiAqL1xuZnVuY3Rpb24gYnVpbGRCbG9jayhzZWN0aW9uczogc3RyaW5nW10sIGhlYWRlcjogc3RyaW5nLCBmb290ZXI6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGJvZHkgPSBgJHtoZWFkZXJ9XFxuXFxuJHtzZWN0aW9ucy5qb2luKCdcXG5cXG4tLS1cXG5cXG4nKX1cXG5cXG4tLS1cXG5cXG4ke2Zvb3Rlcn1gO1xuICByZXR1cm4gYFxcbjxnaXQtc3Bhbj5cXG4ke2JvZHl9XFxuPC9naXQtc3Bhbj5cXG5gO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIGhvb2sgZW50cnkgcG9pbnRcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogV2hldGhlciBhIGNvdmVyaW5nIHJvdyBpcyBpbiBzY29wZSBmb3IgdGhlIHJlY292ZXJlZCByYW5nZS4gKi9cbmZ1bmN0aW9uIGludGVyc2VjdHMocm93OiBQb3JjZWxhaW5Sb3csIHJhbmdlOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScpOiBib29sZWFuIHtcbiAgaWYgKHJhbmdlID09PSAnd2hvbGUtZmlsZScpIHJldHVybiB0cnVlO1xuICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIHJldHVybiB0cnVlOyAvLyB3aG9sZS1maWxlIGFuY2hvclxuICByZXR1cm4gcmFuZ2VzSW50ZXJzZWN0KHJhbmdlLCB7IHN0YXJ0OiByb3cuc3RhcnQsIGVuZDogcm93LmVuZCB9KTtcbn1cblxuLyoqXG4gKiBSZWNvdmVyIHRoZSB0b3VjaGVkIHJhbmdlIGZyb20gdGhlIG9uLWRpc2sgZmlsZSBmb3IgYSB3cml0ZS4gQW4gZW1wdHkgd3JpdGUgb3JcbiAqIGFuIHVucmVhZGFibGUgZmlsZSAoZS5nLiBhIGRlbGV0ZSwgb3IgdGhlIGZpbGUgd2FzIG5ldmVyIHdyaXR0ZW4pIGRlZ3JhZGVzIHRvXG4gKiBgJ3dob2xlLWZpbGUnYCwgc2NvcGluZyB0aGUgdG91Y2ggdG8gZXZlcnkgY292ZXJpbmcgc3BhbiBcdTIwMTQgdGhlIGZhaWwtb3BlblxuICogYmVoYXZpb3IsIG5vdCBhbiBlcnJvci5cbiAqL1xuZnVuY3Rpb24gcmVjb3ZlclJhbmdlRnJvbURpc2sod3JpdHRlbjogc3RyaW5nLCBmaWxlUGF0aDogc3RyaW5nKTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnIHtcbiAgaWYgKHdyaXR0ZW4ubGVuZ3RoID09PSAwKSByZXR1cm4gJ3dob2xlLWZpbGUnO1xuICBsZXQgY29udGVudDogc3RyaW5nO1xuICB0cnkge1xuICAgIGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgsICd1dGY4Jyk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIH1cbiAgcmV0dXJuIHJlY292ZXJSYW5nZSh3cml0dGVuLCBjb250ZW50KTtcbn1cblxuLyoqXG4gKiBUaGUgQ2xhdWRlIGBSZWFkYCB0b29sJ3MgZG9jdW1lbnRlZCBkZWZhdWx0IGxpbmUgY291bnQgd2hlbiBgb2Zmc2V0YCBpc1xuICogZ2l2ZW4gd2l0aG91dCBgbGltaXRgIChcIkJ5IGRlZmF1bHQsIGl0IHJlYWRzIHVwIHRvIDIwMDAgbGluZXNcIikuIE5hbWVkIHNvXG4gKiB0aGUgYXNzdW1wdGlvbiBpcyB2aXNpYmxlIGFuZCBlYXN5IHRvIHVwZGF0ZSBpZiB0aGF0IGRlZmF1bHQgZXZlciBjaGFuZ2VzLlxuICovXG5leHBvcnQgY29uc3QgREVGQVVMVF9SRUFEX0xJTUlUID0gMjAwMDtcblxuLyoqXG4gKiBDb21wdXRlIHRoZSB0b3VjaGVkIHJhbmdlIGZvciBhIHJlYWQgZnJvbSB0aGUgQ2xhdWRlIGBSZWFkYCB0b29sJ3NcbiAqIGBvZmZzZXRgL2BsaW1pdGAgaW5wdXRzLiBOZWl0aGVyIHByZXNlbnQgbWVhbnMgYSBnZW51aW5lIHdob2xlLWZpbGUgcmVhZCBcdTIwMTRcbiAqIGV2ZXJ5IGNvdmVyaW5nIHNwYW4gc3RheXMgaW4gc2NvcGUsIG1hdGNoaW5nIHRvZGF5J3MgYmVoYXZpb3IuIE90aGVyd2lzZVxuICogdGhlIHJhbmdlIHN0YXJ0cyBhdCBgb2Zmc2V0YCAoZGVmYXVsdCBsaW5lIDEpIGFuZCBydW5zIGZvciBgbGltaXRgIGxpbmVzXG4gKiAoZGVmYXVsdCB7QGxpbmsgREVGQVVMVF9SRUFEX0xJTUlUfSksIGNsYW1wZWQgdG8gdGhlIGZpbGUncyBhY3R1YWwgbGluZVxuICogY291bnQgc28gYSBzaG9ydCBmaWxlIHdpdGggYSBsYXJnZSBgb2Zmc2V0YC9gbGltaXRgIGRvZXNuJ3Qgb3ZlcnNob290LlxuICogQ2xhbXBpbmcgcmVxdWlyZXMgcmVhZGluZyB0aGUgZmlsZTsgYW4gdW5yZWFkYWJsZSBmaWxlIGRlZ3JhZGVzIHRvXG4gKiBgJ3dob2xlLWZpbGUnYCBcdTIwMTQgdGhlIHNhbWUgZmFpbC1vcGVuIGJlaGF2aW9yIHRoZSB3cml0ZSBwYXRoIHVzZXMuXG4gKi9cbmZ1bmN0aW9uIHJlY292ZXJSZWFkUmFuZ2UoXG4gIG9mZnNldDogbnVtYmVyIHwgdW5kZWZpbmVkLFxuICBsaW1pdDogbnVtYmVyIHwgdW5kZWZpbmVkLFxuICBmaWxlUGF0aDogc3RyaW5nXG4pOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScge1xuICBpZiAob2Zmc2V0ID09PSB1bmRlZmluZWQgJiYgbGltaXQgPT09IHVuZGVmaW5lZCkgcmV0dXJuICd3aG9sZS1maWxlJztcbiAgY29uc3Qgc3RhcnQgPSBvZmZzZXQgPz8gMTtcbiAgbGV0IGxpbmVDb3VudDogbnVtYmVyO1xuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgsICd1dGY4Jyk7XG4gICAgbGluZUNvdW50ID0gY29udGVudC5sZW5ndGggPT09IDAgPyAwIDogY29udGVudC5zcGxpdCgnXFxuJykubGVuZ3RoO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gJ3dob2xlLWZpbGUnO1xuICB9XG4gIGNvbnN0IGVuZCA9IE1hdGgubWluKHN0YXJ0ICsgKGxpbWl0ID8/IERFRkFVTFRfUkVBRF9MSU1JVCkgLSAxLCBNYXRoLm1heChsaW5lQ291bnQsIHN0YXJ0KSk7XG4gIHJldHVybiB7IHN0YXJ0LCBlbmQgfTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGEgY292ZXJpbmcgcm93IGlzIGFuIGFuY2hvciBpbiB0aGUgdG91Y2hlZCBmaWxlIGl0c2VsZi4gYGxpc3RcbiAqIC0tcG9yY2VsYWluIDxmaWxlPmAgcmV0dXJucyBldmVyeSBhbmNob3Igb2YgZWFjaCBtYXRjaGluZyBzcGFuIFx1MjAxNCBjcm9zcy1maWxlXG4gKiBhbmNob3JzIGluY2x1ZGVkIFx1MjAxNCBidXQgb25seSBhbmNob3JzIGluIHRoZSB0b3VjaGVkIGZpbGUgcGFydGljaXBhdGUgaW4gdGhlXG4gKiByYW5nZS1pbnRlcnNlY3Rpb24gc2NvcGUgdGVzdC4gUm93IHBhdGhzIGFyZSByZXBvLXJlbGF0aXZlOyB0aGUgdG91Y2hlZCBwYXRoXG4gKiBpcyBhYnNvbHV0ZSwgc28gbWF0Y2ggb24gYW4gZXhhY3Qgb3IgYC9gLXNlcGFyYXRlZCBzdWZmaXguXG4gKi9cbmZ1bmN0aW9uIG9uVG91Y2hlZEZpbGUocm93OiBQb3JjZWxhaW5Sb3csIGZpbGVQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIGZpbGVQYXRoID09PSByb3cucGF0aCB8fCBmaWxlUGF0aC5lbmRzV2l0aChgLyR7cm93LnBhdGh9YCk7XG59XG5cbi8qKlxuICogQ29tcHV0ZSB0aGUgbWVyZ2VkIGA8Z2l0LXNwYW4+YCBibG9jayBmb3IgdGhlIHRvdWNoLCBvciBgbnVsbGAgd2hlbiB0aGVyZSBpc1xuICogbm90aGluZyB3b3J0aCBzdXJmYWNpbmcuIFNoYXJlZCBieSBib3RoIHBhdGhzOyB0aGUgd3JpdGUgcGF0aCBwYXNzZXMgYVxuICogcmVjb3ZlcmVkIHJhbmdlIGZvciBwcmVjaXNpb24sIHRoZSByZWFkIHBhdGggc2NvcGVzIGZpbGUtd2lkZS5cbiAqXG4gKiBBIHNwYW4gcmVuZGVycyBhcyBhIGZ1bGwgaHVtYW4tZm9ybWF0IHNlY3Rpb24gKG5hbWUsIGFsbCBhbmNob3JzIHdpdGhcbiAqIGRyaWZ0ZWQgb25lcyBzdGF0dXMtc3VmZml4ZWQsIHdoeSkgd2hlbiBpdHMgbmFtZSBoYXMgbm90IGJlZW4gc3VyZmFjZWQgdGhpc1xuICogc2Vzc2lvbiwgb3Igd2hlbiBpdCBjYXJyaWVzIGEgZHJpZnQgc3RhdHVzIG5vdCB5ZXQgc3VyZmFjZWQgZm9yIGl0IFx1MjAxNCBzbyBhXG4gKiBzcGFuIGZpcnN0IHNlZW4gaGVhbHRoeSByZS1yZW5kZXJzIGluIGZ1bGwgd2hlbiBkcmlmdCBsYXRlciBhcHBlYXJzLiBBIHNwYW5cbiAqIHdob3NlIG9ubHkgZHJpZnQgaXMgcG9zaXRpb25hbCAoYE1PVkVEYC9gUkVTT0xWRURfUEVORElOR19DT01NSVRgIFx1MjAxNCBuZXZlclxuICogYGlzRGVidGApIGlzIGZpbHRlcmVkIG91dCBlbnRpcmVseTogcG9zaXRpb25hbCBkcmlmdCBuZXZlciBzdXJmYWNlcy5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gY29tcHV0ZVN1cmZhY2UoXG4gIGlucHV0OiBUb3VjaElucHV0LFxuICBleGVjdXRvcnM6IFRvdWNoRXhlY3V0b3JzLFxuICBtZW1vOiBNZW1vU3RvcmUsXG4gIHJhbmdlOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZSdcbik6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICBjb25zdCBjb3ZlcmluZyA9IGF3YWl0IGV4ZWN1dG9ycy5saXN0KGlucHV0LmZpbGVQYXRoLCBpbnB1dC5jd2QpO1xuICBpZiAoY292ZXJpbmcubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAvLyBHcm91cCBldmVyeSBhbmNob3IgYnkgc3BhbjsgYSBzcGFuIGlzIGluIHNjb3BlIHdoZW4gb25lIG9mIGl0cyBhbmNob3JzIG9uXG4gIC8vIHRoZSB0b3VjaGVkIGZpbGUgaW50ZXJzZWN0cyB0aGUgcmVjb3ZlcmVkIHJhbmdlLlxuICBjb25zdCBhbmNob3JzQnlOYW1lID0gbmV3IE1hcDxzdHJpbmcsIFBvcmNlbGFpblJvd1tdPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiBjb3ZlcmluZykge1xuICAgIGNvbnN0IHJvd3MgPSBhbmNob3JzQnlOYW1lLmdldChyb3cubmFtZSkgPz8gW107XG4gICAgcm93cy5wdXNoKHJvdyk7XG4gICAgYW5jaG9yc0J5TmFtZS5zZXQocm93Lm5hbWUsIHJvd3MpO1xuICB9XG4gIGNvbnN0IHRvdWNoZWROYW1lcyA9IFsuLi5hbmNob3JzQnlOYW1lLmtleXMoKV0uZmlsdGVyKChuYW1lKSA9PlxuICAgIChhbmNob3JzQnlOYW1lLmdldChuYW1lKSA/PyBbXSkuc29tZSgocm93KSA9PiBvblRvdWNoZWRGaWxlKHJvdywgaW5wdXQuZmlsZVBhdGgpICYmIGludGVyc2VjdHMocm93LCByYW5nZSkpXG4gICk7XG4gIGlmICh0b3VjaGVkTmFtZXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBkcmlmdFJvd3MgPSBhd2FpdCBleGVjdXRvcnMuZHJpZnQoW2lucHV0LmZpbGVQYXRoXSwgaW5wdXQuY3dkKTtcbiAgY29uc3QgZHJpZnRCeU5hbWUgPSBuZXcgTWFwPHN0cmluZywgRHJpZnRQb3JjZWxhaW5Sb3dbXT4oKTtcbiAgZm9yIChjb25zdCByb3cgb2YgZHJpZnRSb3dzKSB7XG4gICAgY29uc3Qgcm93cyA9IGRyaWZ0QnlOYW1lLmdldChyb3cubmFtZSkgPz8gW107XG4gICAgcm93cy5wdXNoKHJvdyk7XG4gICAgZHJpZnRCeU5hbWUuc2V0KHJvdy5uYW1lLCByb3dzKTtcbiAgfVxuXG4gIGNvbnN0IHN1cmZhY2VkID0gbWVtby5nZXRTdXJmYWNlZChpbnB1dC5zZXNzaW9uSWQpO1xuICBjb25zdCB0b1JlY29yZDogc3RyaW5nW10gPSBbXTtcbiAgY29uc3Qgc2VjdGlvbnM6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGRyaWZ0ZWROYW1lczogc3RyaW5nW10gPSBbXTtcblxuICBmb3IgKGNvbnN0IG5hbWUgb2YgdG91Y2hlZE5hbWVzKSB7XG4gICAgY29uc3Qgc3BhbkRyaWZ0ID0gZHJpZnRCeU5hbWUuZ2V0KG5hbWUpID8/IFtdO1xuICAgIGNvbnN0IGRlYnRSb3dzID0gc3BhbkRyaWZ0LmZpbHRlcigocm93KSA9PiBpc0RlYnQocm93LnN0YXR1cykpO1xuICAgIGlmIChzcGFuRHJpZnQubGVuZ3RoID4gMCAmJiBkZWJ0Um93cy5sZW5ndGggPT09IDApIGNvbnRpbnVlOyAvLyBwb3NpdGlvbmFsLW9ubHkgZHJpZnQgbmV2ZXIgc3VyZmFjZXNcblxuICAgIGNvbnN0IGRlYnRTdGF0dXNlcyA9IFsuLi5uZXcgU2V0KGRlYnRSb3dzLm1hcCgocm93KSA9PiByb3cuc3RhdHVzKSldLnNvcnQoKTtcbiAgICBjb25zdCB1bnN1cmZhY2VkRGVidCA9IGRlYnRTdGF0dXNlcy5maWx0ZXIoKHN0YXR1cykgPT4gIXN1cmZhY2VkLmhhcyhkcmlmdEtleShuYW1lLCBzdGF0dXMpKSk7XG4gICAgY29uc3QgaXNOZXdOYW1lID0gIXN1cmZhY2VkLmhhcyhuYW1lKTtcbiAgICBpZiAoIWlzTmV3TmFtZSAmJiB1bnN1cmZhY2VkRGVidC5sZW5ndGggPT09IDApIGNvbnRpbnVlOyAvLyBmdWxseSBzdXJmYWNlZCBhbHJlYWR5XG5cbiAgICBjb25zdCB3aHkgPSBhd2FpdCBleGVjdXRvcnMud2h5KG5hbWUsIGlucHV0LmN3ZCk7XG4gICAgc2VjdGlvbnMucHVzaChyZW5kZXJTcGFuU2VjdGlvbihuYW1lLCBhbmNob3JzQnlOYW1lLmdldChuYW1lKSA/PyBbXSwgZGVidFJvd3MsIHdoeSkpO1xuICAgIGlmIChkZWJ0U3RhdHVzZXMubGVuZ3RoID4gMCkgZHJpZnRlZE5hbWVzLnB1c2gobmFtZSk7XG5cbiAgICBpZiAoaXNOZXdOYW1lKSB0b1JlY29yZC5wdXNoKG5hbWUpO1xuICAgIGZvciAoY29uc3Qgc3RhdHVzIG9mIHVuc3VyZmFjZWREZWJ0KSB0b1JlY29yZC5wdXNoKGRyaWZ0S2V5KG5hbWUsIHN0YXR1cykpO1xuICB9XG5cbiAgaWYgKHNlY3Rpb25zLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIG1lbW8uYWRkU3VyZmFjZWQoaW5wdXQuc2Vzc2lvbklkLCB0b1JlY29yZCk7XG4gIGNvbnN0IGZpbGVOYW1lID0gYmFzZW5hbWUoaW5wdXQuZmlsZVBhdGgpO1xuICBjb25zdCBoZWFkZXIgPSBkcmlmdGVkTmFtZXMubGVuZ3RoID4gMCA/IGRyaWZ0SGVhZGVyKGRyaWZ0ZWROYW1lcy5sZW5ndGgsIGlucHV0LmtpbmQpIDogY2xlYW5IZWFkZXIoZmlsZU5hbWUpO1xuICBjb25zdCBmb290ZXIgPSBkcmlmdGVkTmFtZXMubGVuZ3RoID4gMCA/IGRyaWZ0Rm9vdGVyKGRyaWZ0ZWROYW1lcykgOiBjbGVhbkZvb3RlcihmaWxlTmFtZSk7XG4gIHJldHVybiBidWlsZEJsb2NrKHNlY3Rpb25zLCBoZWFkZXIsIGZvb3Rlcik7XG59XG5cbi8qKlxuICogUnVuIHRoZSB0b3VjaCBob29rIGZvciBhIHNpbmdsZSB0b29sIGNhbGwsIGJyYW5jaGluZyBvbiB7QGxpbmsgVG91Y2hJbnB1dC5raW5kfS5cbiAqXG4gKiAtICoqV3JpdGUgcGF0aCoqOiB7QGxpbmsgZXZhbHVhdGVXcml0ZUdhdGV9IChwbGFuIFx1MDBBNzMgc3RlcCAxKSBydW5zIGZpcnN0IFx1MjAxNFxuICogICBhbnkgZGVjaXNpdmUgZmFpbCwgb3IgYW4gaW5jb25jbHVzaXZlIHBoYW50b20gZGVsZXRlLCBibG9ja3MgdGhlIHRvdWNoXG4gKiAgIHdpdGggbm8gZXhlY3V0b3IgY2FsbCBcdTIwMTQgdGhlbiBgZXhlY3V0b3JzLmZpeGAgKGBnaXQgc3BhbiBkcmlmdCA8ZmlsZT5cbiAqICAgLS1maXhgKSBzY29wZWQgdG8gdGhlIHRvdWNoZWQgZmlsZSBoZWFscyBwb3NpdGlvbmFsIGRyaWZ0IGluIHRoZSB3b3JraW5nXG4gKiAgIHRyZWUsIGFuZCB0aGUgbWVyZ2VkIGA8Z2l0LXNwYW4+YCBibG9jayBpcyBjb21wdXRlZCBhZ2FpbnN0IHRoZSBoZWFsZWRcbiAqICAgYW5jaG9ycywgcmVuZGVyaW5nIGVhY2ggc3VyZmFjZWQgc3BhbiBhcyBhIGZ1bGwgaHVtYW4tZm9ybWF0IHNlY3Rpb24gd2l0aFxuICogICBhbnkgcmVtYWluaW5nIHNlbWFudGljIGRyaWZ0IHN0YXR1cy1zdWZmaXhlZCBvbiBpdHMgYW5jaG9ycy4gQ2FkZW5jZSBpc1xuICogICBkZWR1cGVkIHRocm91Z2ggYG1lbW9gIHBlciBzcGFuIG5hbWUgYW5kIHBlciAoc3Bhbiwgc3RhdHVzKS5cbiAqIC0gKipSZWFkIHBhdGgqKjogbmV2ZXIgaW52b2tlcyBgZml4YCBhbmQgbmV2ZXIgbXV0YXRlcyB0aGUgdHJlZTsgc3VyZmFjZXMgdGhlXG4gKiAgIHNwYW5zIG92ZXJsYXBwaW5nIHRoZSByZWFkJ3MgYG9mZnNldGAvYGxpbWl0YCB3aW5kb3cgKHNlZVxuICogICB7QGxpbmsgcmVjb3ZlclJlYWRSYW5nZX07IGEgcmVhZCB3aXRoIG5laXRoZXIgaXMgd2hvbGUtZmlsZSwgbWF0Y2hpbmdcbiAqICAgdG9kYXkncyBiZWhhdmlvcikgd2l0aCBwb3NpdGlvbmFsIHN0YXR1c2VzIGZpbHRlcmVkIG91dCB2aWEgYGlzRGVidCgpYC5cbiAqXG4gKiBUaGUgb3B0aW9uYWwgYHByb2JlQ2FjaGVgIHNoYXJlcyB0aGUgZHJpdmVyJ3MgcGVyLWNvbW1hbmQgZGVsZXRlLXJlYWxpdHlcbiAqIHByb2JlIGludG8gcGFzcyBCIChwbGFuIFx1MDBBNzMgc3RlcCAyKSBzbyBzdXJ2aXZpbmcgZGVsZXRlcyByZS1nYXRlIHdpdGhvdXRcbiAqIHJlLXByb2Jpbmc7IGRpcmVjdCBjYWxsZXJzIGdldCBhIHBlci1jYWxsIGNhY2hlIHNlZWRlZCB3aXRoIHRoZSB0b3VjaGVkXG4gKiBwYXRoIHdoZW4gdGhlIHRhcmdldCBpcyBgJ2Fic2VudCdgLlxuICpcbiAqIEZhaWxzIG9wZW46IGFueSBleGVjdXRvciByZWplY3Rpb24gb3IgaW50ZXJuYWwgZXJyb3IgeWllbGRzXG4gKiBgYWRkaXRpb25hbENvbnRleHQ6IG51bGxgIChubyBzaWduYWwsIGVkaXRpbmcgbmV2ZXIgYmxvY2tlZCkgcmF0aGVyIHRoYW5cbiAqIHRocm93aW5nLiBgdHJlZU1vZGlmaWVkYCByZWZsZWN0cyBhIHN1Y2Nlc3NmdWwgYC0tZml4YCBldmVuIHdoZW4gdGhlXG4gKiBzdWJzZXF1ZW50IHN1cmZhY2UgY29tcHV0YXRpb24gZmFpbHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5Ub3VjaEhvb2soXG4gIGlucHV0OiBUb3VjaElucHV0LFxuICBleGVjdXRvcnM6IFRvdWNoRXhlY3V0b3JzLFxuICBtZW1vOiBNZW1vU3RvcmUsXG4gIHByb2JlQ2FjaGU/OiBSZWFsaXR5UHJvYmVDYWNoZVxuKTogUHJvbWlzZTxUb3VjaE91dHB1dD4ge1xuICBsZXQgdHJlZU1vZGlmaWVkID0gZmFsc2U7XG4gIHRyeSB7XG4gICAgbGV0IHJhbmdlOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScgPSAnd2hvbGUtZmlsZSc7XG4gICAgaWYgKGlucHV0LmtpbmQgPT09ICd3cml0ZScpIHtcbiAgICAgIGNvbnN0IHByb2JlID0gcHJvYmVDYWNoZSA/PyBjcmVhdGVSZWFsaXR5UHJvYmVDYWNoZShpbnB1dC50YXJnZXRTdGF0ZSA9PT0gJ2Fic2VudCcgPyBbaW5wdXQuZmlsZVBhdGhdIDogW10pO1xuICAgICAgY29uc3Qgb3V0Y29tZSA9IGV2YWx1YXRlV3JpdGVHYXRlKGlucHV0LCBwcm9iZSk7XG4gICAgICBpZiAob3V0Y29tZSA9PT0gJ2RlY2lzaXZlRmFpbCcgfHwgKG91dGNvbWUgPT09ICdpbmNvbmNsdXNpdmUnICYmIGlucHV0LnRhcmdldFN0YXRlID09PSAnYWJzZW50JykpIHtcbiAgICAgICAgcmV0dXJuIHsgYWRkaXRpb25hbENvbnRleHQ6IG51bGwsIHRyZWVNb2RpZmllZDogZmFsc2UgfTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGZpeCA9IGF3YWl0IGV4ZWN1dG9ycy5maXgoaW5wdXQuZmlsZVBhdGgsIGlucHV0LmN3ZCk7XG4gICAgICB0cmVlTW9kaWZpZWQgPSBmaXgubW9kaWZpZWQ7XG4gICAgICByYW5nZSA9IGlucHV0LnJhbmdlID8/IHJlY292ZXJSYW5nZUZyb21EaXNrKGlucHV0LndyaXR0ZW4sIGlucHV0LmZpbGVQYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmFuZ2UgPSByZWNvdmVyUmVhZFJhbmdlKGlucHV0Lm9mZnNldCwgaW5wdXQubGltaXQsIGlucHV0LmZpbGVQYXRoKTtcbiAgICB9XG4gICAgY29uc3QgYWRkaXRpb25hbENvbnRleHQgPSBhd2FpdCBjb21wdXRlU3VyZmFjZShpbnB1dCwgZXhlY3V0b3JzLCBtZW1vLCByYW5nZSk7XG4gICAgcmV0dXJuIHsgYWRkaXRpb25hbENvbnRleHQsIHRyZWVNb2RpZmllZCB9O1xuICB9IGNhdGNoIHtcbiAgICAvLyBGYWlsIG9wZW46IG5ldmVyIGxldCBhIHRvdWNoLWNvcmUgZXJyb3IgcHJvcGFnYXRlIHVwIGFuZCBibG9jayB0aGUgdG9vbFxuICAgIC8vIGNhbGwuIFRoZSB0cmVlIG1heSBhbHJlYWR5IGhhdmUgYmVlbiBoZWFsZWQgKHRyZWVNb2RpZmllZCBwcmVzZXJ2ZWQpLlxuICAgIHJldHVybiB7IGFkZGl0aW9uYWxDb250ZXh0OiBudWxsLCB0cmVlTW9kaWZpZWQgfTtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERlZmF1bHQgc3VicHJvY2Vzcy1iYWNrZWQgZXhlY3V0b3JzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgREVGQVVMVF9USU1FT1VUX01TID0gMTBfMDAwO1xuXG4vKiogUmVzb2x2ZSB0aGUgdG91Y2hlZCBmaWxlIHRvIGEgcGF0aCByZWxhdGl2ZSB0byBpdHMgcmVwbyByb290LCBmb3IgYGdpdCBzcGFuYC4gKi9cbmZ1bmN0aW9uIHJlcG9SZWxBcmcoZmlsZVBhdGg6IHN0cmluZywgY3dkOiBzdHJpbmcpOiB7IHJlcG9Sb290OiBzdHJpbmc7IHJlbFBhdGg6IHN0cmluZyB9IHwgbnVsbCB7XG4gIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gIGlmICghcmVwb1Jvb3QpIHJldHVybiBudWxsO1xuICByZXR1cm4geyByZXBvUm9vdCwgcmVsUGF0aDogcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3QsIGZpbGVQYXRoKSB9O1xufVxuXG4vKipcbiAqIEEgc25hcHNob3Qgb2YgdGhlIHNwYW4gcm9vdCdzIHdvcmtpbmctdHJlZSBzdGF0dXMsIHVzZWQgdG8gZGV0ZWN0IHdoZXRoZXIgYVxuICogYC0tZml4YCByZS1hbmNob3JlZCBhbnl0aGluZy4gQ29tcGFyZWQgYmVmb3JlL2FmdGVyOyBhbiB1bnJlc29sdmFibGUgcmVwbyBvclxuICogYSBmYWlsZWQgc3RhdHVzIHlpZWxkcyBhIHN0YWJsZSBlbXB0eSBzdHJpbmcgKFx1MjE5MiBgbW9kaWZpZWQ6IGZhbHNlYCkuXG4gKi9cbmZ1bmN0aW9uIHNwYW5TdGF0dXNTbmFwc2hvdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgc3BhblJvb3QgPSByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3QpO1xuICB0cnkge1xuICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ3N0YXR1cycsICctLXBvcmNlbGFpbicsICctLScsIHNwYW5Sb290XSwge1xuICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgdGltZW91dDogREVGQVVMVF9USU1FT1VUX01TXG4gICAgfSk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnJztcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBwcm9kdWN0aW9uIGV4ZWN1dGlvbiBzdXJmYWNlOiB0aHJlZSBzdWJwcm9jZXNzLWJhY2tlZCBleGVjdXRvcnMgZm9sbG93aW5nXG4gKiBzcGFuLXN1cmZhY2UudHMncyBgY3JlYXRlRGVmYXVsdCpFeGVjdXRvcmAgc3R5bGUuIEVhY2ggY2FwdHVyZXMgc3Rkb3V0IGV2ZW4gb25cbiAqIGEgbm9uLXplcm8gZXhpdCB3aGVyZSB0aGUgQ0xJIHN0aWxsIGVtaXRzIHVzZWZ1bCBvdXRwdXQsIGFuZCBldmVyeSBmYWlsdXJlXG4gKiBtb2RlIChhYnNlbnQgYmluYXJ5LCB0aW1lb3V0LCBwYXJzZSBmYWlsdXJlKSBzdXJmYWNlcyBhcyBhbiBlbXB0eS9jbGVhbiByZXN1bHRcbiAqIHNvIHtAbGluayBydW5Ub3VjaEhvb2t9J3MgZmFpbC1vcGVuIGNvbnRyYWN0IGhvbGRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdFRvdWNoRXhlY3V0b3JzKHRpbWVvdXRNczogbnVtYmVyID0gREVGQVVMVF9USU1FT1VUX01TKTogVG91Y2hFeGVjdXRvcnMge1xuICByZXR1cm4ge1xuICAgIGZpeDogYXN5bmMgKGZpbGVQYXRoLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlc29sdmVkID0gcmVwb1JlbEFyZyhmaWxlUGF0aCwgY3dkKTtcbiAgICAgIGlmICghcmVzb2x2ZWQpIHJldHVybiB7IG1vZGlmaWVkOiBmYWxzZSB9O1xuICAgICAgY29uc3QgYmVmb3JlID0gc3BhblN0YXR1c1NuYXBzaG90KHJlc29sdmVkLnJlcG9Sb290KTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2RyaWZ0JywgcmVzb2x2ZWQucmVsUGF0aCwgJy0tZml4J10sIHtcbiAgICAgICAgICBjd2Q6IHJlc29sdmVkLnJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICB2b2lkIGVycjsgLy8gYGdpdCBzcGFuIGRyaWZ0YCBleGl0cyAxIG9uIGRyaWZ0IGV2ZW4gd2hlbiBgLS1maXhgIGhlYWxlZCBzb21ldGhpbmcsIGFuZFxuICAgICAgICAvLyBub24temVybyBvbiBnZW51aW5lIGZhaWx1cmU7IHRoZSBzbmFwc2hvdCBkaWZmIGlzIHRoZSBzb3VyY2Ugb2ZcbiAgICAgICAgLy8gdHJ1dGggZm9yIHdoZXRoZXIgdGhlIHRyZWUgY2hhbmdlZCwgc28gdGhlIGV4aXQgY29kZSBpcyBpZ25vcmVkIGhlcmUuXG4gICAgICB9XG4gICAgICBjb25zdCBhZnRlciA9IHNwYW5TdGF0dXNTbmFwc2hvdChyZXNvbHZlZC5yZXBvUm9vdCk7XG4gICAgICByZXR1cm4geyBtb2RpZmllZDogYmVmb3JlICE9PSBhZnRlciB9O1xuICAgIH0sXG5cbiAgICBsaXN0OiBhc3luYyAoZmlsZVBhdGgsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVzb2x2ZWQgPSByZXBvUmVsQXJnKGZpbGVQYXRoLCBjd2QpO1xuICAgICAgaWYgKCFyZXNvbHZlZCkgcmV0dXJuIFtdO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnbGlzdCcsICctLXBvcmNlbGFpbicsIHJlc29sdmVkLnJlbFBhdGhdLCB7XG4gICAgICAgICAgY3dkOiByZXNvbHZlZC5yZXBvUm9vdCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBwYXJzZVBvcmNlbGFpbihvdXQpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgZHJpZnQ6IGFzeW5jIChhcmdzLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBjb25zdCBydW5Dd2QgPSByZXBvUm9vdCA/PyBjd2Q7XG4gICAgICAvLyBUaGUgY29yZSBwYXNzZXMgYW4gYWJzb2x1dGUgZmlsZSBwYXRoOyBzY29wZSBgZ2l0IHNwYW4gZHJpZnRgIHRvIGl0XG4gICAgICAvLyByZWxhdGl2ZSB0byB0aGUgcmVwbyByb290IHNvIHRoZSBwYXRoIGluZGV4IHJlc29sdmVzIGl0LlxuICAgICAgY29uc3Qgc2NvcGVkID0gcmVwb1Jvb3QgPyBhcmdzLm1hcCgoYSkgPT4gcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3QsIGEpKSA6IGFyZ3M7XG4gICAgICBsZXQgb3V0OiBzdHJpbmc7XG4gICAgICB0cnkge1xuICAgICAgICBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdkcmlmdCcsICctLWZvcm1hdCcsICdwb3JjZWxhaW4nLCAuLi5zY29wZWRdLCB7XG4gICAgICAgICAgY3dkOiBydW5Dd2QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGNvbnN0IGNhcHR1cmVkID0gKGVyciBhcyB7IHN0ZG91dD86IHN0cmluZyB9KS5zdGRvdXQ7XG4gICAgICAgIGlmICh0eXBlb2YgY2FwdHVyZWQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgb3V0ID0gY2FwdHVyZWQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gcGFyc2VEcmlmdFBvcmNlbGFpbihvdXQpO1xuICAgIH0sXG5cbiAgICB3aHk6IGFzeW5jIChuYW1lLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICd3aHknLCBuYW1lXSwge1xuICAgICAgICAgIGN3ZDogcmVwb1Jvb3QgPz8gY3dkLFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgdGV4dCA9IG91dC50cmltRW5kKCk7XG4gICAgICAgIC8vIEJhcmUgYGdpdCBzcGFuIHdoeWAgcHJpbnRzIHRoaXMgZXhhY3Qgc2VudGluZWwgKGV4aXQgMCkgd2hlbiB0aGVcbiAgICAgICAgLy8gc3BhbiBoYXMgbm8gd2h5IHJlY29yZGVkIFx1MjAxNCB0cmVhdCBpdCBhcyBcIm5vIHdoeVwiLCBub3QgYXMgY29udGVudC5cbiAgICAgICAgaWYgKHRleHQubGVuZ3RoID09PSAwIHx8IHRleHQgPT09IGBcXGAke25hbWV9XFxgIGhhcyBubyB3aHkgcmVjb3JkZWQuYCkgcmV0dXJuIG51bGw7XG4gICAgICAgIHJldHVybiB0ZXh0O1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgIH1cbiAgfTtcbn1cbiIsICIvKipcbiAqIFNoYXJlZCBib3gtZHJhd2luZyB0cmVlIHJlbmRlcmVyIGZvciBhIHNwYW4ncyBhbmNob3IgbGlzdCwgdXNlZCBieSBldmVyeVxuICogY2FsbCBzaXRlIHRoYXQgdG9kYXkgcHJpbnRzIGEgZmxhdCBgLSBwYXRoI0xzdGFydC1MZW5kYCBidWxsZXQgcnVuXG4gKiAoYHRvdWNoLWNvcmUudHNgJ3MgYGFuY2hvckJ1bGxldHNgLCBhbmQgYGFkdmlzb3ItY29yZS50c2Anc1xuICogYGFubm90YXRlQmxvY2tzYC9gZ3JvdXBDb3ZlcmluZ0J5TmFtZWApLiBBbmNob3JzIHRoYXQgc2hhcmUgYSBkaXJlY3RvcnlcbiAqIHByZWZpeCBjb2xsYXBzZSBpbnRvIG9uZSB0cmVlIGluc3RlYWQgb2YgYmVpbmcgcmVjb25zdHJ1Y3RlZCBieSBleWUgZnJvbSBhXG4gKiBmbGF0IGxpc3QgXHUyMDE0IHRoZSBtb3RpdmF0aW5nIGNhc2UgaXMgcGFyaXR5IGFuY2hvcnMgdW5kZXIgcGFyYWxsZWxcbiAqIGBwdWJsaWMvY2xhdWRlLy4uLmAvYHB1YmxpYy9jb2RleC8uLi5gIHRyZWVzLlxuICpcbiAqIFRoaXMgbW9kdWxlIGlzIGEgcHVyZSBwcmVzZW50YXRpb24gdHJhbnNmb3JtOiBpdCBuZXZlciBjb21wdXRlcyBkcmlmdFxuICogc3RhdHVzIG9yIGRlY2lkZXMgd2hpY2ggYW5jaG9ycyBhcmUgc3VyZmFjZWQuIENhbGxlcnMgcHJlY29tcHV0ZSBlYWNoIHJvdydzXG4gKiBgc3VmZml4YCAoZS5nLiBgIFx1MjAxNCBjaGFuZ2VkYCkgZXhhY3RseSBhcyB0aGV5IGRvIHRvZGF5LCBhbmQgb25seSB0aGUgKnNoYXBlKlxuICogb2YgdGhlIHByaW50ZWQgbGlzdCBjaGFuZ2VzLlxuICovXG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUHVibGljIHR5cGVzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBIb3cgYSBzaW5nbGUgYW5jaG9yJ3MgbGluZSByYW5nZSBpcyBrbm93bi4gYHJhbmdlYCBhbmQgYHdob2xlLWZpbGVgIGFyZSB0aGVcbiAqIHR3byBzaGFwZXMgZXZlcnkgYW5jaG9yIHRha2VzIHRvZGF5OyBgdHJ1bmNhdGVkYCBpcyBhIGRlZmVuc2l2ZSB0aGlyZCBzaGFwZVxuICogcmVhY2hhYmxlIG9ubHkgZnJvbSByZS1wYXJzaW5nIHRoZSBDTEkncyBmbGF0IGh1bWFuLWZvcm1hdCB0ZXh0IChhIGAjTGBcbiAqIGZyYWdtZW50IHRoYXQgZG9lc24ndCBjbGVhbmx5IG1hdGNoIGAjTHN0YXJ0LUxlbmRgKS5cbiAqXG4gKiBWZXJpZmllZCBpbnZhcmlhbnQ6IHRoZSBzdHJ1Y3R1cmVkLWRhdGEgY2FsbCBzaXRlcyBjYW4gbmV2ZXIgcHJvZHVjZVxuICogYHRydW5jYXRlZGAuIGBwYXJzZVBvcmNlbGFpbmAgKGFnZW50LWhvb2tzLWNvbW1vbi50cykgYGNvbnRpbnVlYHMgcGFzdCBhbnlcbiAqIHJvdyBtaXNzaW5nIGEgdmFsaWQgcmFuZ2UsIHNvIGFuIGluY29tcGxldGUgYFBvcmNlbGFpblJvd2AgY2FuIG5ldmVyIGJlXG4gKiBjb25zdHJ1Y3RlZDsgdGhlIFJ1c3QgQ0xJJ3Mgb3duIHBvcmNlbGFpbiB3cml0ZXIgYWx3YXlzIGVtaXRzIGEgcmFuZ2VcbiAqIGNvbHVtbiAoYDAtMGAgZm9yIHdob2xlLWZpbGUpLiBgdHJ1bmNhdGVkYCBpcyByZWFjaGFibGUgb25seSBmcm9tXG4gKiBgYW5ub3RhdGVCbG9ja3NgJyBmbGF0LXRleHQgcGFyc2luZyBvZiBgYmxvY2tzVGV4dGAgaW4gYSBsYXRlciBwaGFzZS5cbiAqL1xuZXhwb3J0IHR5cGUgUmFuZ2VMYWJlbCA9IHsga2luZDogJ3JhbmdlJzsgc3RhcnQ6IG51bWJlcjsgZW5kOiBudW1iZXIgfSB8IHsga2luZDogJ3dob2xlLWZpbGUnIH0gfCB7IGtpbmQ6ICd0cnVuY2F0ZWQnIH07XG5cbi8qKiBPbmUgc3RhY2tlZCByYW5nZSB1bmRlciBhIGBUcmVlQW5jaG9yYCwgd2l0aCBpdHMgcHJlY29tcHV0ZWQgZHJpZnQgc3VmZml4LiAqL1xuZXhwb3J0IGludGVyZmFjZSBSYW5nZUVudHJ5IHtcbiAgcmFuZ2U6IFJhbmdlTGFiZWw7XG4gIC8qKiBQcmVjb21wdXRlZCBgIFx1MjAxNCBjaGFuZ2VkYCAoZXRjLiksIG9yIGAnJ2Agd2hlbiB0aGUgYW5jaG9yIGNhcnJpZXMgbm8gZHJpZnQuICovXG4gIHN1ZmZpeDogc3RyaW5nO1xufVxuXG4vKiogT25lIGRpc3RpbmN0IHBhdGgncyBjb2xsYXBzZWQgYW5jaG9yIGVudHJ5LCByZWFkeSBmb3IgdHJlZSBsYXlvdXQuICovXG5leHBvcnQgaW50ZXJmYWNlIFRyZWVBbmNob3Ige1xuICAvKiogUmVwby1yZWxhdGl2ZSwgcG9zaXgtc2VwYXJhdGVkIHBhdGguICovXG4gIHBhdGg6IHN0cmluZztcbiAgLyoqXG4gICAqIFN0YWNrZWQgcmFuZ2VzIG9uIHRoaXMgcGF0aC4gRW1wdHkgbWVhbnMgXCJwYXRoIG9ubHksIG5vIHJhbmdlIGNvbHVtbiBhdFxuICAgKiBhbGxcIiBcdTIwMTQgYSBiYXJlLXBhdGggbGVhZiwgZGlzdGluY3QgZnJvbSBhIHNpbmdsZSBgd2hvbGUtZmlsZWAgZW50cnkgKHdoaWNoXG4gICAqIHJlbmRlcnMgdGhlIHBhdGggdG9vLCBidXQgaXMgYW4gZXhwbGljaXQgcmFuZ2Uta2luZCBjbGFzc2lmaWNhdGlvbikuXG4gICAqL1xuICByYW5nZXM6IFJhbmdlRW50cnlbXTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBjb2xsYXBzZUJ5UGF0aFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogQ29sbGFwc2Ugcm93cyB0aGF0IG5hbWUgdGhlIHNhbWUgcGF0aCBpbnRvIG9uZSBgVHJlZUFuY2hvcmAgd2l0aCBzdGFja2VkXG4gKiByYW5nZXMsIHByZXNlcnZpbmcgZmlyc3Qtc2VlbiBvcmRlci4gYHJlbmRlckFuY2hvclRyZWVgJ3MgY29udHJhY3QgcmVxdWlyZXNcbiAqIGF0IG1vc3Qgb25lIGBUcmVlQW5jaG9yYCBwZXIgZGlzdGluY3QgcGF0aCBcdTIwMTQgdGhpcyBpcyB0aGUgbWFuZGF0b3J5XG4gKiBwcmUtcHJvY2Vzc2luZyBzdGVwIGV2ZXJ5IGNhbGxlciBydW5zIGZpcnN0IHRvIGd1YXJhbnRlZSB0aGF0LlxuICpcbiAqIE1pcnJvcnMgdGhlIG9yZGVyLWFycmF5LXBsdXMtTWFwIGlkaW9tIGFscmVhZHkgdXNlZCBieVxuICogYGRlZHVwZUJ5QW5jaG9yKClgIChhZHZpc29yLWNvcmUudHMpIGZvciB0aGUgc2FtZSByZWFzb246IHRoZSBDTEkgY2FuIGVtaXRcbiAqIG11bHRpcGxlIHJvd3MgZm9yIG9uZSBsb2dpY2FsIHBhdGgsIGFuZCB0aGUgKnBvc2l0aW9uKiBvZiBhIGxhdGVyXG4gKiBzYW1lLXBhdGggcm93IGlzIHN1YnN1bWVkIGludG8gdGhhdCBwYXRoJ3MgZmlyc3Qgb2NjdXJyZW5jZSwgbm90IGFwcGVuZGVkXG4gKiBhdCBpdHMgb3duIGxhdGVyIHBvc2l0aW9uLiBDb25jcmV0ZWx5OiBgYS50cyNMMS1MNWAsIGBiLnRzI0wxLUw1YCxcbiAqIGBhLnRzI0w5LUwxMmAgY29sbGFwc2VzIHRvIGBbYS50cyAodHdvIHN0YWNrZWQgcmFuZ2VzKSwgYi50cyAob25lIHJhbmdlKV1gXG4gKiBcdTIwMTQgYGEudHNgIHNpdHMgYXQgcG9zaXRpb24gMCwgaXRzIGZpcnN0IG9jY3VycmVuY2UsIG5vdCBpdHMgbGFzdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbGxhcHNlQnlQYXRoKHJvd3M6IHsgcGF0aDogc3RyaW5nOyByYW5nZTogUmFuZ2VMYWJlbDsgc3VmZml4OiBzdHJpbmcgfVtdKTogVHJlZUFuY2hvcltdIHtcbiAgY29uc3Qgb3JkZXI6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGJ5UGF0aCA9IG5ldyBNYXA8c3RyaW5nLCBUcmVlQW5jaG9yPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgbGV0IGFuY2hvciA9IGJ5UGF0aC5nZXQocm93LnBhdGgpO1xuICAgIGlmICghYW5jaG9yKSB7XG4gICAgICBhbmNob3IgPSB7IHBhdGg6IHJvdy5wYXRoLCByYW5nZXM6IFtdIH07XG4gICAgICBieVBhdGguc2V0KHJvdy5wYXRoLCBhbmNob3IpO1xuICAgICAgb3JkZXIucHVzaChyb3cucGF0aCk7XG4gICAgfVxuICAgIGFuY2hvci5yYW5nZXMucHVzaCh7IHJhbmdlOiByb3cucmFuZ2UsIHN1ZmZpeDogcm93LnN1ZmZpeCB9KTtcbiAgfVxuICByZXR1cm4gb3JkZXIubWFwKChwYXRoKSA9PiBieVBhdGguZ2V0KHBhdGgpIGFzIFRyZWVBbmNob3IpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRyZWUgY29uc3RydWN0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuaW50ZXJmYWNlIExlYWZOb2RlIHtcbiAga2luZDogJ2xlYWYnO1xuICBuYW1lOiBzdHJpbmc7XG4gIGFuY2hvcjogVHJlZUFuY2hvcjtcbn1cblxuaW50ZXJmYWNlIERpck5vZGUge1xuICBraW5kOiAnZGlyJztcbiAgbmFtZTogc3RyaW5nO1xuICBjaGlsZHJlbjogUGF0aFRyZWVOb2RlW107XG59XG5cbnR5cGUgUGF0aFRyZWVOb2RlID0gTGVhZk5vZGUgfCBEaXJOb2RlO1xuXG4vKipcbiAqIFNwbGl0IGEgcGF0aCBpbnRvIGAvYC1zZXBhcmF0ZWQgc2VnbWVudHMsIG9yIGBudWxsYCB3aGVuIGRvaW5nIHNvIHdvdWxkXG4gKiBmZWVkIGFuIGVtcHR5LXN0cmluZyBzZWdtZW50IGludG8gdGhlIHRyaWUgKGEgbGVhZGluZyBgL2AsIGEgdHJhaWxpbmcgYC9gLFxuICogYSBkb3VibGVkIGAvL2AsIG9yIHRoZSBlbXB0eSBzdHJpbmcpLiBgbnVsbGAgc2lnbmFscyB0aGUgY2FsbGVyIHRvIHJlbmRlclxuICogdGhhdCBhbmNob3IncyBmdWxsIHBhdGggc3RyaW5nIGFzIGEgc2luZ2xlLCB1bnNwbGl0LCBhdG9taWMgdG9wLWxldmVsIGxlYWZcbiAqIGluc3RlYWQgb2YgYXR0ZW1wdGluZyB0byBuZXN0IGl0IFx1MjAxNCBhIGtub3duLWVudW1lcmFibGUgY2xhc3Mgb2YgbWFsZm9ybWVkXG4gKiBwYXRocyBnZXRzIGEgcmVhbCBydWxlIGhlcmUgcmF0aGVyIHRoYW4gdGhlIHNwbGl0IHJ1bm5pbmcgYW55d2F5IGFuZFxuICogZmFicmljYXRpbmcgYW4gZW1wdHktbmFtZWQgZGlyZWN0b3J5IG5vZGUuIEEgYmFyZSBmaWxlbmFtZSB3aXRoIG5vIGAvYCBhdFxuICogYWxsIHByb2R1Y2VzIGV4YWN0bHkgb25lIG5vbi1lbXB0eSBzZWdtZW50IGFuZCBpcyBoYW5kbGVkIGJ5IHRoZSBvcmRpbmFyeVxuICogcGF0aCBiZWxvdyAoaXQgYmVjb21lcyBhIHRvcC1sZXZlbCBsZWFmIHdpdGggbm8gZGlyZWN0b3J5IHRvIG5lc3QgdW5kZXIgXHUyMDE0XG4gKiBhbHJlYWR5IGF0b21pYywgbm8gc3BlY2lhbCBjYXNlIG5lZWRlZCkuXG4gKi9cbmZ1bmN0aW9uIHNwbGl0U2VnbWVudHMocGF0aDogc3RyaW5nKTogc3RyaW5nW10gfCBudWxsIHtcbiAgaWYgKHBhdGgubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgY29uc3Qgc2VnbWVudHMgPSBwYXRoLnNwbGl0KCcvJyk7XG4gIGlmIChzZWdtZW50cy5zb21lKChzZWdtZW50KSA9PiBzZWdtZW50Lmxlbmd0aCA9PT0gMCkpIHJldHVybiBudWxsO1xuICByZXR1cm4gc2VnbWVudHM7XG59XG5cbmZ1bmN0aW9uIGZpbmRPckNyZWF0ZURpcihwYXJlbnQ6IERpck5vZGUsIG5hbWU6IHN0cmluZyk6IERpck5vZGUge1xuICBmb3IgKGNvbnN0IGNoaWxkIG9mIHBhcmVudC5jaGlsZHJlbikge1xuICAgIGlmIChjaGlsZC5raW5kID09PSAnZGlyJyAmJiBjaGlsZC5uYW1lID09PSBuYW1lKSByZXR1cm4gY2hpbGQ7XG4gIH1cbiAgY29uc3Qgbm9kZTogRGlyTm9kZSA9IHsga2luZDogJ2RpcicsIG5hbWUsIGNoaWxkcmVuOiBbXSB9O1xuICBwYXJlbnQuY2hpbGRyZW4ucHVzaChub2RlKTtcbiAgcmV0dXJuIG5vZGU7XG59XG5cbi8qKiBJbnNlcnQgb25lIGFuY2hvciBpbnRvIHRoZSB0cmllLCBjcmVhdGluZy9yZXVzaW5nIGRpcmVjdG9yeSBub2RlcyBpbiBhcnJpdmFsIG9yZGVyLiAqL1xuZnVuY3Rpb24gaW5zZXJ0QW5jaG9yKHJvb3Q6IERpck5vZGUsIHNlZ21lbnRzOiBzdHJpbmdbXSwgYW5jaG9yOiBUcmVlQW5jaG9yKTogdm9pZCB7XG4gIGxldCBjdXIgPSByb290O1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHNlZ21lbnRzLmxlbmd0aCAtIDE7IGkrKykge1xuICAgIGN1ciA9IGZpbmRPckNyZWF0ZURpcihjdXIsIHNlZ21lbnRzW2ldKTtcbiAgfVxuICBjdXIuY2hpbGRyZW4ucHVzaCh7IGtpbmQ6ICdsZWFmJywgbmFtZTogc2VnbWVudHNbc2VnbWVudHMubGVuZ3RoIC0gMV0sIGFuY2hvciB9KTtcbn1cblxuLyoqXG4gKiBCdWlsZCB0aGUgdG9wLWxldmVsIGZvcmVzdCBmcm9tIGEgYFRyZWVBbmNob3JbXWAgYWxyZWFkeSBjb2xsYXBzZWQgYnlcbiAqIGBjb2xsYXBzZUJ5UGF0aGAuIFNpYmxpbmcgb3JkZXIgaXMgbmV2ZXIgcmUtc29ydGVkIFx1MjAxNCBhIHBhdGggZWl0aGVyIG9wZW5zIGFcbiAqIG5ldyBub2RlIGF0IGl0cyBhcnJpdmFsIHBvc2l0aW9uIG9yIGlzIG5lc3RlZCB1bmRlciBhIGRpcmVjdG9yeSBub2RlXG4gKiBjcmVhdGVkL3JldXNlZCBhdCB0aGF0IGRpcmVjdG9yeSdzIG93biBmaXJzdC1vY2N1cnJlbmNlIHBvc2l0aW9uLlxuICovXG5mdW5jdGlvbiBidWlsZEZvcmVzdChhbmNob3JzOiBUcmVlQW5jaG9yW10pOiBQYXRoVHJlZU5vZGVbXSB7XG4gIGNvbnN0IHJvb3Q6IERpck5vZGUgPSB7IGtpbmQ6ICdkaXInLCBuYW1lOiAnJywgY2hpbGRyZW46IFtdIH07XG4gIGZvciAoY29uc3QgYW5jaG9yIG9mIGFuY2hvcnMpIHtcbiAgICBjb25zdCBzZWdtZW50cyA9IHNwbGl0U2VnbWVudHMoYW5jaG9yLnBhdGgpO1xuICAgIGlmIChzZWdtZW50cyA9PT0gbnVsbCkge1xuICAgICAgcm9vdC5jaGlsZHJlbi5wdXNoKHsga2luZDogJ2xlYWYnLCBuYW1lOiBhbmNob3IucGF0aCwgYW5jaG9yIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGluc2VydEFuY2hvcihyb290LCBzZWdtZW50cywgYW5jaG9yKTtcbiAgfVxuICByZXR1cm4gcm9vdC5jaGlsZHJlbjtcbn1cblxuLyoqIEEgbm9kZSBwYWlyZWQgd2l0aCB0aGUgKHBvc3NpYmx5IGZvbGRlZCkgbmFtZSBpdCBkaXNwbGF5cyBvbiBpdHMgb3duIGxpbmUuICovXG5pbnRlcmZhY2UgRGlzcGxheUl0ZW0ge1xuICBuYW1lOiBzdHJpbmc7XG4gIG5vZGU6IFBhdGhUcmVlTm9kZTtcbn1cblxuLyoqXG4gKiBGb2xkIGEgY2hhaW4gb2Ygc2luZ2xlLWNoaWxkIG5vZGVzIGludG8gb25lIGNvbWJpbmVkIG5hbWVcbiAqIChgcHVibGljL2NsYXVkZS9ydW50aW1lL3NraWxscy9jYXJkYCwgYGRpcnR5L21vZC5yc2AsXG4gKiBgLmRldmNvbnRhaW5lci9Eb2NrZXJmaWxlYCkuIEZvbGRpbmcgY29udGludWVzIHdoaWxlIHRoZSBjdXJyZW50IG5vZGUgaXMgYVxuICogZGlyZWN0b3J5IHdpdGggKipleGFjdGx5IG9uZSBjaGlsZCoqLCByZWdhcmRsZXNzIG9mIHdoZXRoZXIgdGhhdCBjaGlsZCBpcyBhXG4gKiBkaXJlY3Rvcnkgb3IgYSBsZWFmOiBhIG5vZGUgd2l0aCBvbmUgY2hpbGQgY29udmV5cyBubyBncm91cGluZyBieVxuICogZGVmaW5pdGlvbiwgc28gZm9sZGluZyBpdCBsb3NlcyBubyBzdHJ1Y3R1cmUgd2hpbGUgcmVtb3ZpbmcgYSBsaW5lIHdob3NlXG4gKiBvbmx5IGNvbnRlbnQgaXMgYSBjb25uZWN0b3IuIFN0b3BzIGF0IHRoZSBmaXJzdCBkaXJlY3Rvcnkgd2l0aCAyKyBjaGlsZHJlblxuICogKGV4cGFuZCBmcm9tIHRoZXJlKSBvciBhdCBhIGxlYWYgKHdoaWNoIHRoZW4gcmVuZGVycyB3aXRoIHRoZSBmb2xkZWQgbmFtZSkuXG4gKlxuICogRm9sZGluZyBsb25lICpsZWF2ZXMqIFx1MjAxNCBub3QganVzdCBsb25lIGRpcmVjdG9yaWVzIFx1MjAxNCBpcyB3aGF0IGtlZXBzIHRoZSB0cmVlXG4gKiBubyB0YWxsZXIgdGhhbiB0aGUgZmxhdCBidWxsZXQgbGlzdCBpdCByZXBsYWNlcywgYW5kIHdoYXQgbWFrZXMgYSBzaW5nbGVcbiAqIGFuY2hvciByZW5kZXIgYXMgdGhlIG9uZS1saW5lIHRyZWUgdGhlIHBsYW4gcHJvbWlzZXMgZXZlbiB3aGVuIGl0cyBwYXRoIGhhc1xuICogZGlyZWN0b3JpZXMgaW4gaXQuIEl0IGFsc28ga2VlcHMgdGhlIGRpc2NyaW1pbmF0aW5nIHNlZ21lbnQgb24gdGhlIHNhbWVcbiAqIGxpbmUgYXMgaXRzIHJhbmdlIChgZGlydHkvbW9kLnJzICNMMzkyLUwzOTlgKSBmb3IgYG1vZC5yc2AvYGluZGV4LnRzYFxuICogbGF5b3V0cywgd2hlcmUgdGhlIGZpbGVuYW1lIGFsb25lIGlkZW50aWZpZXMgbm90aGluZy5cbiAqL1xuZnVuY3Rpb24gZm9sZENoYWluKG5vZGU6IFBhdGhUcmVlTm9kZSk6IERpc3BsYXlJdGVtIHtcbiAgbGV0IG5hbWUgPSBub2RlLm5hbWU7XG4gIGxldCBjdXIgPSBub2RlO1xuICB3aGlsZSAoY3VyLmtpbmQgPT09ICdkaXInICYmIGN1ci5jaGlsZHJlbi5sZW5ndGggPT09IDEpIHtcbiAgICBjb25zdCBjaGlsZCA9IGN1ci5jaGlsZHJlblswXTtcbiAgICBuYW1lID0gYCR7bmFtZX0vJHtjaGlsZC5uYW1lfWA7XG4gICAgY3VyID0gY2hpbGQ7XG4gIH1cbiAgcmV0dXJuIHsgbmFtZSwgbm9kZTogY3VyIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUmVuZGVyaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSYW5rIG9mIGEgc3RhY2tlZCBlbnRyeSdzIHJhbmdlIGtpbmQ6IGB3aG9sZS1maWxlYCBmaXJzdCwgdGhlbiBudW1lcmljXG4gKiBgcmFuZ2VgcywgdGhlbiBgdHJ1bmNhdGVkYC4gQSB3aG9sZS1maWxlIGFuY2hvciBpcyB0aGUgQ0xJJ3MgYDAtMGAgcm93IFx1MjAxNCBpdFxuICogY292ZXJzIHRoZSBlbnRpcmUgZmlsZSwgc28gaXQgc29ydHMgYWhlYWQgb2YgZXZlcnkgbGluZSByYW5nZSBvbiB0aGF0IGZpbGVcbiAqIHRoZSBzYW1lIHdheSBsaW5lIDAgd291bGQuIGB0cnVuY2F0ZWRgIGNhcnJpZXMgbm8gcG9zaXRpb24gYXQgYWxsIGFuZCBzb3J0c1xuICogbGFzdC5cbiAqL1xuZnVuY3Rpb24gcmFuZ2VSYW5rKHJhbmdlOiBSYW5nZUxhYmVsKTogbnVtYmVyIHtcbiAgc3dpdGNoIChyYW5nZS5raW5kKSB7XG4gICAgY2FzZSAnd2hvbGUtZmlsZSc6XG4gICAgICByZXR1cm4gMDtcbiAgICBjYXNlICdyYW5nZSc6XG4gICAgICByZXR1cm4gMTtcbiAgICBjYXNlICd0cnVuY2F0ZWQnOlxuICAgICAgcmV0dXJuIDI7XG4gIH1cbn1cblxuLyoqXG4gKiBTdGFja2VkLXJhbmdlIG9yZGVyIGlzIGJ5IGtpbmQgcmFuayB0aGVuIG51bWVyaWMgKGBzdGFydGAgdGhlbiBgZW5kYCksXG4gKiBvdmVycmlkaW5nIGFycml2YWwgb3IgY29kZXBvaW50IG9yZGVyIFx1MjAxNCB0aGUgb25seSBzb3J0aW5nIHRoaXMgbW9kdWxlIGRvZXMsXG4gKiBhbmQgc2NvcGVkIHN0cmljdGx5IHRvIHJhbmdlcyBzdGFja2VkIG9uIG9uZSBwYXRoIChuZXZlciB0byBzaWJsaW5nIHBhdGhzXG4gKiBvciBkaXJlY3Rvcnkgb3JkZXIpLiBFcXVhbC1yYW5rZWQgZW50cmllcyAodHdvIGB0cnVuY2F0ZWRgcywgb3IgdHdvXG4gKiBpZGVudGljYWwgcmFuZ2VzKSBrZWVwIHRoZWlyIG93biByZWxhdGl2ZSBhcnJpdmFsIG9yZGVyLCBzaW5jZSB0aGUgc29ydCBpc1xuICogc3RhYmxlLlxuICovXG5mdW5jdGlvbiBjb21wYXJlUmFuZ2VFbnRyaWVzKGE6IFJhbmdlRW50cnksIGI6IFJhbmdlRW50cnkpOiBudW1iZXIge1xuICBjb25zdCByYW5rID0gcmFuZ2VSYW5rKGEucmFuZ2UpIC0gcmFuZ2VSYW5rKGIucmFuZ2UpO1xuICBpZiAocmFuayAhPT0gMCkgcmV0dXJuIHJhbms7XG4gIGlmIChhLnJhbmdlLmtpbmQgPT09ICdyYW5nZScgJiYgYi5yYW5nZS5raW5kID09PSAncmFuZ2UnKSB7XG4gICAgcmV0dXJuIGEucmFuZ2Uuc3RhcnQgLSBiLnJhbmdlLnN0YXJ0IHx8IGEucmFuZ2UuZW5kIC0gYi5yYW5nZS5lbmQ7XG4gIH1cbiAgcmV0dXJuIDA7XG59XG5cbi8qKlxuICogVGhlIHJhbmdlIGNvbHVtbidzIHRleHQsIG9yIGBudWxsYCB3aGVuIHRoZSBlbnRyeSBwcmludHMgYXMgYSBiYXJlIHBhdGhcbiAqIHdpdGggbm8gcmFuZ2UgY29sdW1uIGF0IGFsbC5cbiAqXG4gKiBBIGB3aG9sZS1maWxlYCBlbnRyeSBpcyB0aGUgb25lIGtpbmQgd2hvc2UgcmVuZGVyaW5nIGRlcGVuZHMgb24gY29udGV4dC5cbiAqIEFsb25lIG9uIGl0cyBwYXRoIGl0IHN0YXlzIGEgYmFyZSBwYXRoIHdpdGggemVybyBtYXJrZXIgXHUyMDE0IHRoYXQgaXMgd2hhdCB0aGVcbiAqIENMSSdzIG93biBmbGF0IGxpc3QgcHJpbnRzIGZvciBhIHdob2xlLWZpbGUgYW5jaG9yLCBhbmQgYWRkaW5nIGEgbWFya2VyXG4gKiB0aGVyZSB3b3VsZCBhbm5vdGF0ZSB0aGUgb3ZlcndoZWxtaW5nbHkgY29tbW9uIGNhc2UgZm9yIHRoZSBiZW5lZml0IG9mIHRoZVxuICogcmFyZSBvbmUuICpTdGFja2VkKiBiZWhpbmQgb3RoZXIgcmFuZ2VzIG9uIHRoZSBzYW1lIHBhdGggaXQgbXVzdCBjYXJyeSBhblxuICogZXhwbGljaXQgbWFya2VyOiB3aXRob3V0IG9uZSBpdCByZW5kZXJzIGFzIGEgY29udGludWF0aW9uIGxpbmUgaG9sZGluZ1xuICogbm90aGluZyBidXQgaW5kZW50YXRpb24gYW5kIGl0cyBkcmlmdCBzdWZmaXgsIHdoaWNoIGVyYXNlcyB0aGUgYW5jaG9yXG4gKiBvdXRyaWdodCB3aGVuIHRoZSBzdWZmaXggaXMgZW1wdHkgYW5kIFx1MjAxNCB3b3JzZSBcdTIwMTQgaGFuZ3MgaXRzIGAgXHUyMDE0IGNoYW5nZWRgXG4gKiB1bmRlciBhIG5laWdoYm91cmluZyByYW5nZSwgZXhhY3RseSB0aGUgdmlzdWFsIGdyYW1tYXIgdGhhdCBtZWFucyBcImFub3RoZXJcbiAqIHJhbmdlIG9uIHRoaXMgc2FtZSBmaWxlXCIuIFRoZSByZWFkZXIgd291bGQgdGhlbiByZWNvbmNpbGUgdGhlIHJhbmdlIHRoYXRcbiAqIGRpZCBub3QgZHJpZnQuIE9mIHRoZSB0aHJlZSBmaXhlcyBhdmFpbGFibGUgKHByaW50IHRoZSBwYXRoIG9uXG4gKiBjb250aW51YXRpb24gbGluZXMsIHNvcnQgd2hvbGUtZmlsZSB0byBwb3NpdGlvbiAwLCBvciBzcGxpdCBpdCBpbnRvIGl0cyBvd25cbiAqIGxlYWYpLCBhbiBleHBsaWNpdCBtYXJrZXIgaXMgdGhlIG9ubHkgb25lIHRoYXQgbWFrZXMgdGhlIGVudHJ5IGlkZW50aWZpYWJsZVxuICogaW4gKmV2ZXJ5KiBwb3NpdGlvbiByYXRoZXIgdGhhbiBvbmx5IGluIHRoZSBwb3NpdGlvbiB0aGUgc29ydCBoYXBwZW5zIHRvXG4gKiBwdXQgaXQgaW47IHNvcnRpbmcgaXQgZmlyc3QgKHNlZSB7QGxpbmsgcmFuZ2VSYW5rfSkgaXMga2VwdCBhcyB3ZWxsIGJlY2F1c2VcbiAqIFwid2hvbGUgZmlsZSwgdGhlbiBpdHMgcmFuZ2VzIGluIGxpbmUgb3JkZXJcIiBpcyB0aGUgb3JkZXIgYSByZWFkZXIgZXhwZWN0cyxcbiAqIG5vdCBiZWNhdXNlIGlkZW50aWZpYWJpbGl0eSBkZXBlbmRzIG9uIGl0LlxuICovXG5mdW5jdGlvbiBsYWJlbEZvcihyYW5nZTogUmFuZ2VMYWJlbCwgc29sZTogYm9vbGVhbik6IHN0cmluZyB8IG51bGwge1xuICBzd2l0Y2ggKHJhbmdlLmtpbmQpIHtcbiAgICBjYXNlICdyYW5nZSc6XG4gICAgICByZXR1cm4gYCNMJHtyYW5nZS5zdGFydH0tTCR7cmFuZ2UuZW5kfWA7XG4gICAgY2FzZSAnd2hvbGUtZmlsZSc6XG4gICAgICByZXR1cm4gc29sZSA/IG51bGwgOiAnKHdob2xlIGZpbGUpJztcbiAgICBjYXNlICd0cnVuY2F0ZWQnOlxuICAgICAgcmV0dXJuICcodHJ1bmNhdGVkIGluIHNvdXJjZSBcdTIwMTQgYW5jaG9yIGluY29tcGxldGUpJztcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENvbHVtbiBtYXRoXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBUaGUgZ3JhcGhlbWUgc2VnbWVudGVyLCBjb25zdHJ1Y3RlZCBvbiBmaXJzdCB1c2UgYW5kIHRoZW4gY2FjaGVkIFx1MjAxNCBpbmNsdWRpbmdcbiAqIGEgY2FjaGVkIGBudWxsYCB3aGVuIGl0IGNhbm5vdCBiZSBjb25zdHJ1Y3RlZCBhdCBhbGwuXG4gKlxuICogTGF6eSBvbiBwdXJwb3NlLiBgSW50bGAgaXMgbm90IHBhcnQgb2YgdGhlIEphdmFTY3JpcHQgbGFuZ3VhZ2UgY29yZTogYSBOb2RlXG4gKiBidWlsdCBgLS13aXRoLWludGw9bm9uZWAgaGFzIG5vIGBJbnRsYCBnbG9iYWwgd2hhdHNvZXZlciwgYW5kIGBob29rcy5qc29uYFxuICogaW52b2tlcyBhIGJhcmUgYG5vZGVgIG9mZiB0aGUgdXNlcidzIGBQQVRIYCwgc28gYGVuZ2luZXMubm9kZWAgY29uc3RyYWluc1xuICogbm90aGluZyBoZXJlLiBDb25zdHJ1Y3RpbmcgdGhpcyBhdCBtb2R1bGUgc2NvcGUgcHV0IGEgYFJlZmVyZW5jZUVycm9yYCBpblxuICogdGhlIGJ1bmRsZXMnIHRvcC1sZXZlbCBzdGF0ZW1lbnRzLCB3aGVyZSBpdCB0aHJvd3MgYXQgKmltcG9ydCogXHUyMDE0IGJlZm9yZSBhbnlcbiAqIG9mIHRoZSBmYWlsLWNsb3NlZCBgdHJ5L2NhdGNoYCBibG9ja3MgaW4gYHJlbmRlckFuY2hvclJ1bmAsIGByZW5kZXJQYXRoUnVuYFxuICogYW5kIGBhbmNob3JCdWxsZXRzYCBleGlzdCB0byBjYXRjaCBpdC4gVGhlIGhvb2sgcHJvY2VzcyB0aGVuIGRpZWQgd2l0aCBleGl0XG4gKiAxLCB3aGljaCBDbGF1ZGUgQ29kZSB0cmVhdHMgYXMgYSBub24tYmxvY2tpbmcgaG9vayBlcnJvcjogdGhlIGNvbW1pdCBnYXRlXG4gKiBzaWxlbnRseSBhbGxvd2VkIHRoZSBjb21taXQgYW5kIHRoZSBkcmlmdCByZW1pbmRlciBzaWxlbnRseSB2YW5pc2hlZC5cbiAqIEJ1aWxkaW5nIGl0IGluc2lkZSB0aGUgcmVuZGVyIHBhdGggcHV0cyBhbnkgZmFpbHVyZSBiYWNrIGluc2lkZSB0aG9zZVxuICogY2F0Y2hlcy5cbiAqXG4gKiBGQUlMLUNMT1NFRCwgbm90IGEgYDxncmVlbmZpZWxkPmAtZm9yYmlkZGVuIGZhbGxiYWNrIFx1MjAxNCB0aGUgc2FtZSBjYXRlZ29yeSBhc1xuICogdGhlIGxvY2FsIGB0cnkvY2F0Y2hgIGJsb2NrcyBhdCB0aGlzIG1vZHVsZSdzIGNhbGwgc2l0ZXMsIGFuZCBsb2FkLWJlYXJpbmdcbiAqIGZvciB0aGUgc2FtZSByZWFzb24uIE5vdGhpbmcgaW4gdGhlIGNvbHVtbi1hbGlnbm1lbnQgcGF0aCBtYXkgYmUgYWJsZSB0b1xuICogY29zdCB0aGUgY29tbWl0IGdhdGUgb3IgdGhlIGRyaWZ0IHJlbWluZGVyOiBpZiBkaXNwbGF5IHdpZHRoIGNhbm5vdCBiZVxuICogbWVhc3VyZWQsIHRoZSBsaXN0IHN0aWxsIHByaW50cyBhbmQgdGhlIGdhdGUgc3RpbGwgaG9sZHM7IG9ubHkgYWxpZ25tZW50IGlzXG4gKiBsb3N0LlxuICovXG5sZXQgY2FjaGVkU2VnbWVudGVyOiB7IHZhbHVlOiBJbnRsLlNlZ21lbnRlciB8IG51bGwgfSB8IHVuZGVmaW5lZDtcblxuZnVuY3Rpb24gZ3JhcGhlbWVTZWdtZW50ZXIoKTogSW50bC5TZWdtZW50ZXIgfCBudWxsIHtcbiAgaWYgKGNhY2hlZFNlZ21lbnRlciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNhY2hlZFNlZ21lbnRlciA9IHsgdmFsdWU6IG5ldyBJbnRsLlNlZ21lbnRlcignZW4nLCB7IGdyYW51bGFyaXR5OiAnZ3JhcGhlbWUnIH0pIH07XG4gICAgfSBjYXRjaCB7XG4gICAgICBjYWNoZWRTZWdtZW50ZXIgPSB7IHZhbHVlOiBudWxsIH07XG4gICAgfVxuICB9XG4gIHJldHVybiBjYWNoZWRTZWdtZW50ZXIudmFsdWU7XG59XG5cbi8qKlxuICogQ29kZSBwb2ludCByYW5nZXMgcmVuZGVyZWQgdHdvIGNvbHVtbnMgd2lkZTogdGhlIEVhc3QgQXNpYW4gV2lkZSAoVykgYW5kXG4gKiBGdWxsd2lkdGggKEYpIGJsb2NrcyBvZiBVQVggIzExLCBwbHVzIHRoZSBlbW9qaSBibG9ja3MgdGhhdCB0ZXJtaW5hbHMgYW5kXG4gKiBwcm9wb3J0aW9uYWwgYWdlbnQtZmFjaW5nIHJlbmRlcmVycyBib3RoIGdpdmUgZG91YmxlIHdpZHRoLiBFdmVyeXRoaW5nIGVsc2VcbiAqIGNvdW50cyBhcyBvbmUgY29sdW1uLlxuICpcbiAqIFNvcnRlZCBhc2NlbmRpbmcgYW5kIG5vbi1vdmVybGFwcGluZyBcdTIwMTQge0BsaW5rIGlzV2lkZUNvZGVQb2ludH0gc2hvcnQtY2lyY3VpdHNcbiAqIG9uIHRoZSBmaXJzdCByYW5nZSBzdGFydGluZyBwYXN0IHRoZSBjb2RlIHBvaW50LlxuICovXG5jb25zdCBXSURFX1JBTkdFUzogcmVhZG9ubHkgKHJlYWRvbmx5IFtudW1iZXIsIG51bWJlcl0pW10gPSBbXG4gIFsweDExMDAsIDB4MTE1Zl0sXG4gIFsweDIzMjksIDB4MjMyYV0sXG4gIFsweDI2MDAsIDB4MjdiZl0sXG4gIFsweDJlODAsIDB4MzAzZV0sXG4gIFsweDMwNDEsIDB4MzNmZl0sXG4gIFsweDM0MDAsIDB4NGRiZl0sXG4gIFsweDRlMDAsIDB4OWZmZl0sXG4gIFsweGEwMDAsIDB4YTRjZl0sXG4gIFsweGE5NjAsIDB4YTk3Zl0sXG4gIFsweGFjMDAsIDB4ZDdhM10sXG4gIFsweGY5MDAsIDB4ZmFmZl0sXG4gIFsweGZlMTAsIDB4ZmUxOV0sXG4gIFsweGZlMzAsIDB4ZmU2Zl0sXG4gIFsweGZmMDAsIDB4ZmY2MF0sXG4gIFsweGZmZTAsIDB4ZmZlNl0sXG4gIFsweDE3MDAwLCAweDE4YWZmXSxcbiAgWzB4MWYxZTYsIDB4MWYxZmZdLFxuICBbMHgxZjMwMCwgMHgxZjY0Zl0sXG4gIFsweDFmNjgwLCAweDFmNmZmXSxcbiAgWzB4MWY5MDAsIDB4MWY5ZmZdLFxuICBbMHgxZmE3MCwgMHgxZmFmZl0sXG4gIFsweDIwMDAwLCAweDJmZmZkXSxcbiAgWzB4MzAwMDAsIDB4M2ZmZmRdXG5dO1xuXG5mdW5jdGlvbiBpc1dpZGVDb2RlUG9pbnQoY3A6IG51bWJlcik6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IFtsbywgaGldIG9mIFdJREVfUkFOR0VTKSB7XG4gICAgaWYgKGNwIDwgbG8pIHJldHVybiBmYWxzZTtcbiAgICBpZiAoY3AgPD0gaGkpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBEaXNwbGF5IHdpZHRoIG9mIGEgbmFtZSBpbiB0ZXJtaW5hbCBjb2x1bW5zIFx1MjAxNCB0aGUgdW5pdCB0aGUgcmFuZ2UgY29sdW1uIGlzXG4gKiBhY3R1YWxseSBhbGlnbmVkIGluLiBNZWFzdXJlZCBvdmVyIGdyYXBoZW1lIGNsdXN0ZXJzIChzbyBhIGRlY29tcG9zZWQgYFx1MDBFOWBcbiAqIG9yIGEgY29tYmluaW5nLW1hcmsgc2VxdWVuY2UgY291bnRzIG9uY2UsIG5vdCBvbmNlIHBlciBjb2RlIHBvaW50KSwgd2l0aFxuICogZWFjaCBjbHVzdGVyIGNvbnRyaWJ1dGluZyB0d28gY29sdW1ucyB3aGVuIGl0cyBiYXNlIGNvZGUgcG9pbnQgaXMgRWFzdFxuICogQXNpYW4gV2lkZS9GdWxsd2lkdGggb3IgZW1vamkgYW5kIG9uZSBvdGhlcndpc2UuXG4gKlxuICogTmVpdGhlciBVVEYtMTYgYC5sZW5ndGhgIG5vciBgQXJyYXkuZnJvbShuYW1lKS5sZW5ndGhgIGlzIHRoaXMgdW5pdDogdGhlXG4gKiBmaXJzdCBvdmVyLWNvdW50cyBhIHN1cnJvZ2F0ZSBwYWlyLCB0aGUgc2Vjb25kIHVuZGVyLWNvdW50cyBhIENKSyBpZGVvZ3JhcGhcbiAqIGFuZCBvdmVyLWNvdW50cyBhIGRlY29tcG9zZWQgYWNjZW50LlxuICpcbiAqIFdoZW4ge0BsaW5rIGdyYXBoZW1lU2VnbWVudGVyfSBpcyB1bmF2YWlsYWJsZSAoYSBOb2RlIGJ1aWx0XG4gKiBgLS13aXRoLWludGw9bm9uZWAgaGFzIG5vIGBJbnRsYCBnbG9iYWwgYXQgYWxsKSwgdGhpcyBkZWdyYWRlcyB0byB0aGUgY3J1ZGVyXG4gKiBwZXItY29kZS1wb2ludCBtZWFzdXJlIHJhdGhlciB0aGFuIHRocm93aW5nLiBUaGF0IG1lYXN1cmUgb3Zlci1jb3VudHMgYVxuICogZGVjb21wb3NlZCBhY2NlbnQgYW5kIGEgcmVnaW9uYWwtaW5kaWNhdG9yIGZsYWcgcGFpciwgc28gYWxpZ25tZW50IGNhbiBiZSBhXG4gKiBjb2x1bW4gb3IgdHdvIG9mZiBcdTIwMTQgd2hpY2ggaXMgdGhlIGVudGlyZSBjb3N0LCBhbmQgaXMgdGhlIGNvcnJlY3QgcHJpY2UgdG9cbiAqIHBheTogdGhlIGFuY2hvciBsaXN0IHN0aWxsIHByaW50cyBhbmQgdGhlIGNvbW1pdCBnYXRlIHN0aWxsIGhvbGRzLlxuICovXG5mdW5jdGlvbiBkaXNwbGF5V2lkdGgobmFtZTogc3RyaW5nKTogbnVtYmVyIHtcbiAgY29uc3Qgc2VnbWVudGVyID0gZ3JhcGhlbWVTZWdtZW50ZXIoKTtcbiAgbGV0IHdpZHRoID0gMDtcbiAgaWYgKHNlZ21lbnRlciA9PT0gbnVsbCkge1xuICAgIGZvciAoY29uc3QgY29kZVBvaW50IG9mIG5hbWUpIHtcbiAgICAgIHdpZHRoICs9IGlzV2lkZUNvZGVQb2ludChjb2RlUG9pbnQuY29kZVBvaW50QXQoMCkgPz8gMCkgPyAyIDogMTtcbiAgICB9XG4gICAgcmV0dXJuIHdpZHRoO1xuICB9XG4gIGZvciAoY29uc3QgeyBzZWdtZW50IH0gb2Ygc2VnbWVudGVyLnNlZ21lbnQobmFtZSkpIHtcbiAgICB3aWR0aCArPSBpc1dpZGVDb2RlUG9pbnQoc2VnbWVudC5jb2RlUG9pbnRBdCgwKSA/PyAwKSA/IDIgOiAxO1xuICB9XG4gIHJldHVybiB3aWR0aDtcbn1cblxuLyoqXG4gKiBBbGlnbm1lbnQgY2VpbGluZy4gQSBzaWJsaW5nIGdyb3VwIHdob3NlIHdpZGVzdCByYW5nZS1iZWFyaW5nIG5hbWUgZXhjZWVkc1xuICogdGhpcyB3aWR0aCBkb2VzIG5vdCBhbGlnbiBhdCBhbGwgXHUyMDE0IGV2ZXJ5IG5hbWUgaW4gaXQgdGFrZXMgYSBzaW5nbGUgc3BhY2VcbiAqIGJlZm9yZSBpdHMgcmFuZ2UuIFRoZSBhbHRlcm5hdGl2ZSAocGFkIHRoZSBzaG9ydCBuYW1lcyB0byB0aGUgY2VpbGluZyB3aGlsZVxuICogdGhlIGxvbmcgb25lIHNpdHMgYXQgaXRzIG93biBuYXR1cmFsIGNvbHVtbikgcGF5cyBtb3N0IG9mIHRoZSB3aWR0aCBmb3JcbiAqIGFsaWdubWVudCB0aGF0IGFsaWducyB3aXRoIG5vdGhpbmcsIHdoaWNoIGlzIHN0cmljdGx5IHdvcnNlIHRoYW4gbm90XG4gKiBhbGlnbmluZy4gTmFtZXMgdGhlbXNlbHZlcyBhcmUgbmV2ZXIgdHJ1bmNhdGVkIG9yIGVsaWRlZCBhdCBhbnkgd2lkdGguXG4gKi9cbmNvbnN0IE1BWF9BTElHTl9DT0xVTU4gPSA0ODtcblxuLyoqXG4gKiBUaGUgY29sdW1uIGV2ZXJ5IHJhbmdlLWJlYXJpbmcgbmFtZSBpbiB0aGlzIHNpYmxpbmcgZ3JvdXAgcGFkcyB0bywgb3IgYDBgXG4gKiB3aGVuIHRoZSBncm91cCBmb3Jnb2VzIGFsaWdubWVudCAobm8gcmFuZ2UtYmVhcmluZyBuYW1lcywgb3IgYSBuYW1lIHBhc3RcbiAqIHtAbGluayBNQVhfQUxJR05fQ09MVU1OfSkuIEFsaWdubWVudCBzY29wZSBpcyB0aGUgZ3JvdXAncyBkaXJlY3QgY2hpbGRyZW5cbiAqIG9ubHksIG5ldmVyIHRoZSB3aG9sZSB0cmVlIFx1MjAxNCB3aG9sZS10cmVlIGFsaWdubWVudCB3b3VsZCBsZXQgb25lIGRlZXBseVxuICogbmVzdGVkIGxvbmcgbmFtZSBwYWQgZXZlcnkgdW5yZWxhdGVkIGJyYW5jaC5cbiAqL1xuZnVuY3Rpb24gY29tcHV0ZUdyb3VwVGFyZ2V0KGl0ZW1zOiBEaXNwbGF5SXRlbVtdKTogbnVtYmVyIHtcbiAgbGV0IG1heCA9IDA7XG4gIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcykge1xuICAgIGlmIChpdGVtLm5vZGUua2luZCA9PT0gJ2xlYWYnICYmIHByaW50c1JhbmdlQ29sdW1uKGl0ZW0ubm9kZS5hbmNob3IpKSB7XG4gICAgICBtYXggPSBNYXRoLm1heChtYXgsIGRpc3BsYXlXaWR0aChpdGVtLm5hbWUpKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG1heCA+IE1BWF9BTElHTl9DT0xVTU4gPyAwIDogbWF4O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhpcyBhbmNob3IgcHJpbnRzIGEgcmFuZ2UgY29sdW1uIGF0IGFsbCBcdTIwMTQgdGhlIGV4YWN0IGNvbmRpdGlvblxuICoge0BsaW5rIGxhYmVsRm9yfSBlbmNvZGVzLCBob2lzdGVkIHNvIHtAbGluayBjb21wdXRlR3JvdXBUYXJnZXR9IG1lYXN1cmVzIHRoZVxuICogc2FtZSBzZXQgb2YgbmFtZXMgaXQgcGFkcy4gQW4gYW5jaG9yIHdpdGggbm8gcmFuZ2VzLCBvciBhICpzb2xlKiB3aG9sZS1maWxlXG4gKiBlbnRyeSAod2hpY2ggcmVuZGVycyBhcyBhIGJhcmUgcGF0aCB3aXRoIHplcm8gbWFya2VyKSwgY29udHJpYnV0ZXMgbm8gcmFuZ2VcbiAqIGNvbHVtbiBhbmQgc28gbXVzdCBub3QgY29udHJpYnV0ZSB0byB0aGUgZ3JvdXAgbWF4IGVpdGhlcjogb3RoZXJ3aXNlIGFcbiAqIHdob2xlLWZpbGUgYW5jaG9yIG9uIGEgcGF0aCBwYXN0IHtAbGluayBNQVhfQUxJR05fQ09MVU1OfSBzaWxlbnRseSBzdXBwcmVzc2VzXG4gKiBhbGlnbm1lbnQgZm9yIGl0cyByYW5nZS1iZWFyaW5nIHNpYmxpbmdzIHdoaWxlIGl0c2VsZiBwcmludGluZyBub3RoaW5nIHRvXG4gKiBhbGlnbi5cbiAqL1xuZnVuY3Rpb24gcHJpbnRzUmFuZ2VDb2x1bW4oYW5jaG9yOiBUcmVlQW5jaG9yKTogYm9vbGVhbiB7XG4gIGNvbnN0IHsgcmFuZ2VzIH0gPSBhbmNob3I7XG4gIGlmIChyYW5nZXMubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiByYW5nZXMuc29tZSgoZW50cnkpID0+IGxhYmVsRm9yKGVudHJ5LnJhbmdlLCByYW5nZXMubGVuZ3RoID09PSAxKSAhPT0gbnVsbCk7XG59XG5cbi8qKiBUaGUgc3BhY2luZyBiZXR3ZWVuIGEgbmFtZSBvZiBgbmFtZVdpZHRoYCBjb2x1bW5zIGFuZCBpdHMgcmFuZ2UgY29sdW1uLiAqL1xuZnVuY3Rpb24gY29tcHV0ZVBhZChuYW1lV2lkdGg6IG51bWJlciwgdGFyZ2V0OiBudW1iZXIpOiBzdHJpbmcge1xuICBpZiAobmFtZVdpZHRoID49IHRhcmdldCkgcmV0dXJuICcgJztcbiAgcmV0dXJuICcgJy5yZXBlYXQodGFyZ2V0IC0gbmFtZVdpZHRoICsgMSk7XG59XG5cbi8qKlxuICogUmVuZGVyIG9uZSBsZWFmJ3MgbGluZShzKS4gQW4gZW1wdHkgYHJhbmdlc2AgYXJyYXkgaXMgYSBiYXJlLXBhdGggbGVhZiB3aXRoXG4gKiBubyByYW5nZSBjb2x1bW4gYXQgYWxsIChkaXN0aW5jdCBmcm9tIGEgYHdob2xlLWZpbGVgIGVudHJ5LCB3aGljaCBpcyBhblxuICogZXhwbGljaXQgY2xhc3NpZmljYXRpb24gdGhhdCBhbHNvIHByaW50cyB3aXRoIHplcm8gbWFya2VyIHdoZW4gaXQgc3RhbmRzXG4gKiBhbG9uZSwgYnV0IHRocm91Z2ggdGhlIHJhbmdlcyBwaXBlbGluZSkuIE11bHRpcGxlIHN0YWNrZWQgcmFuZ2VzIHByaW50XG4gKiB1bmRlciBhIGNvbnRpbnVhdGlvbiBwcmVmaXggaW5zdGVhZCBvZiByZXBlYXRpbmcgdGhlIG5hbWU7IGVhY2ggY2FycmllcyBpdHNcbiAqIG93biBzdWZmaXggaW5kZXBlbmRlbnRseSwgYW5kIGVhY2ggY2FycmllcyBhIGxhYmVsIGlkZW50aWZ5aW5nIHdoaWNoIGFuY2hvclxuICogdGhlIHN1ZmZpeCBiZWxvbmdzIHRvLlxuICovXG5mdW5jdGlvbiByZW5kZXJMZWFmTGluZXMoXG4gIG5hbWU6IHN0cmluZyxcbiAgYW5jaG9yOiBUcmVlQW5jaG9yLFxuICBvd25QcmVmaXg6IHN0cmluZyxcbiAgY2hpbGRQcmVmaXg6IHN0cmluZyxcbiAgZ3JvdXBUYXJnZXQ6IG51bWJlclxuKTogc3RyaW5nW10ge1xuICBjb25zdCB7IHJhbmdlcyB9ID0gYW5jaG9yO1xuICBpZiAocmFuZ2VzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtgJHtvd25QcmVmaXh9JHtuYW1lfWBdO1xuXG4gIGNvbnN0IHNvcnRlZCA9IFsuLi5yYW5nZXNdLnNvcnQoY29tcGFyZVJhbmdlRW50cmllcyk7XG4gIGNvbnN0IHNvbGUgPSBzb3J0ZWQubGVuZ3RoID09PSAxO1xuICBjb25zdCBuYW1lV2lkdGggPSBkaXNwbGF5V2lkdGgobmFtZSk7XG4gIGNvbnN0IHBhZCA9IGNvbXB1dGVQYWQobmFtZVdpZHRoLCBncm91cFRhcmdldCk7XG4gIGNvbnN0IGJsYW5rID0gJyAnLnJlcGVhdChuYW1lV2lkdGggKyBwYWQubGVuZ3RoKTtcblxuICByZXR1cm4gc29ydGVkLm1hcCgoZW50cnksIGkpID0+IHtcbiAgICBjb25zdCBsYWJlbCA9IGxhYmVsRm9yKGVudHJ5LnJhbmdlLCBzb2xlKTtcbiAgICBpZiAobGFiZWwgPT09IG51bGwpIHJldHVybiBgJHtvd25QcmVmaXh9JHtuYW1lfSR7ZW50cnkuc3VmZml4fWA7XG4gICAgY29uc3QgYmFzZSA9IGkgPT09IDAgPyBgJHtvd25QcmVmaXh9JHtuYW1lfSR7cGFkfWAgOiBgJHtjaGlsZFByZWZpeH0ke2JsYW5rfWA7XG4gICAgcmV0dXJuIGAke2Jhc2V9JHtsYWJlbH0ke2VudHJ5LnN1ZmZpeH1gO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyTm9kZXMobm9kZXM6IFBhdGhUcmVlTm9kZVtdLCBwcmVmaXg6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgbGluZXM6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGl0ZW1zID0gbm9kZXMubWFwKGZvbGRDaGFpbik7XG4gIGNvbnN0IGdyb3VwVGFyZ2V0ID0gY29tcHV0ZUdyb3VwVGFyZ2V0KGl0ZW1zKTtcbiAgaXRlbXMuZm9yRWFjaCgoaXRlbSwgaSkgPT4ge1xuICAgIGNvbnN0IGlzTGFzdCA9IGkgPT09IGl0ZW1zLmxlbmd0aCAtIDE7XG4gICAgY29uc3Qgb3duUHJlZml4ID0gYCR7cHJlZml4fSR7aXNMYXN0ID8gJ1x1MjUxNFx1MjUwMCAnIDogJ1x1MjUxQ1x1MjUwMCAnfWA7XG4gICAgY29uc3QgY2hpbGRQcmVmaXggPSBgJHtwcmVmaXh9JHtpc0xhc3QgPyAnICAgJyA6ICdcdTI1MDIgICd9YDtcbiAgICBpZiAoaXRlbS5ub2RlLmtpbmQgPT09ICdsZWFmJykge1xuICAgICAgbGluZXMucHVzaCguLi5yZW5kZXJMZWFmTGluZXMoaXRlbS5uYW1lLCBpdGVtLm5vZGUuYW5jaG9yLCBvd25QcmVmaXgsIGNoaWxkUHJlZml4LCBncm91cFRhcmdldCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICBsaW5lcy5wdXNoKGAke293blByZWZpeH0ke2l0ZW0ubmFtZX0vYCk7XG4gICAgICBsaW5lcy5wdXNoKC4uLnJlbmRlck5vZGVzKGl0ZW0ubm9kZS5jaGlsZHJlbiwgY2hpbGRQcmVmaXgpKTtcbiAgICB9XG4gIH0pO1xuICByZXR1cm4gbGluZXM7XG59XG5cbi8qKlxuICogUmVuZGVyIGEgY29sbGFwc2VkIGFuY2hvciBsaXN0IGFzIGEgYm94LWRyYXdpbmcgdHJlZSwgZ3JvdXBlZCBieSBzaGFyZWRcbiAqIHBhdGggcHJlZml4LiBFdmVyeSBhbmNob3IgbGlzdCByZW5kZXJzIGFzIGEgdHJlZSB1bmNvbmRpdGlvbmFsbHkgXHUyMDE0IGEgc2luZ2xlXG4gKiBhbmNob3IgYmVjb21lcyBhIG9uZS1saW5lIHRyZWUgd2hhdGV2ZXIgaXRzIGRlcHRoIChzZWUge0BsaW5rIGZvbGRDaGFpbn0pO1xuICogdGhlcmUgaXMgbm8gZmxhdC1idWxsZXQgcGF0aCBvciBzaXplIGZsb29yIGluIHRoaXMgbW9kdWxlLlxuICpcbiAqIEhlaWdodCBpcyBib3VuZGVkIGJ5IHtAbGluayBmb2xkQ2hhaW59OiBhIGRpcmVjdG9yeSBsaW5lIG9ubHkgZXZlciBhcHBlYXJzXG4gKiB3aGVyZSBpdCBnZW51aW5lbHkgZ3JvdXBzIHR3byBvciBtb3JlIHNpYmxpbmdzLCBzbyB0aGUgdHJlZSBhZGRzIGF0IG1vc3RcbiAqIG9uZSBsaW5lIHBlciByZWFsIGdyb3VwaW5nIGFuZCBuZXZlciBvbmUgcGVyIHBhdGggc2VnbWVudC5cbiAqXG4gKiBUb3RhbCBmb3IgYW55IHdlbGwtZm9ybWVkIGBUcmVlQW5jaG9yW11gOiBkZWdlbmVyYXRlIHBhdGhzIChydWxlIGVuZm9yY2VkXG4gKiBpbiB7QGxpbmsgc3BsaXRTZWdtZW50c30pIGFyZSBub3JtYWxpemVkIHRvIGF0b21pYyBsZWF2ZXMgcmF0aGVyIHRoYW5cbiAqIHRocm93biBvbiwgc28gdGhpcyBmdW5jdGlvbiBuZXZlciBuZWVkcyBhbiBpbnRlcm5hbCB0cnkvY2F0Y2guIENhbGxlcnMgYWRkXG4gKiB0aGVpciBvd24gY2F0Y2ggYXJvdW5kIHRoaXMgY2FsbCBpbiBhIGxhdGVyIHBoYXNlIChmYWlsLW9wZW4gZGlzY2lwbGluZVxuICogbGl2ZXMgYXQgdGhlIGNhbGwgc2l0ZSwgbm90IGhlcmUpLlxuICpcbiAqIGByZW5kZXJBbmNob3JUcmVlYCdzIGNvbnRyYWN0IHJlcXVpcmVzIGF0IG1vc3Qgb25lIGBUcmVlQW5jaG9yYCBwZXJcbiAqIGRpc3RpbmN0IGBwYXRoYCBcdTIwMTQgcGFzcyBhbmNob3JzIHRocm91Z2gge0BsaW5rIGNvbGxhcHNlQnlQYXRofSBmaXJzdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlckFuY2hvclRyZWUoYW5jaG9yczogVHJlZUFuY2hvcltdKTogc3RyaW5nW10ge1xuICBjb25zdCBmb3Jlc3QgPSBidWlsZEZvcmVzdChhbmNob3JzKTtcbiAgcmV0dXJuIHJlbmRlck5vZGVzKGZvcmVzdCwgJycpO1xufVxuIiwgIi8qKlxuICogU2hhcmVkIEJhc2ggc3BhbiBcdTIxOTIgdG91Y2ggdHJhbnNsYXRpb24gYW5kIHRoZSBqb2luLWdhdGluZyBkcml2ZXIgKHBsYW4gXHUwMEE3MixcbiAqIFx1MDBBNzMgc3RlcCAyKS4gQm90aCBhZGFwdGVycyBjb25zdW1lIHRoaXMgbW9kdWxlIG9uY2UgdGhlaXIgZHVwbGljYXRlIEJhc2hcbiAqIHNwYW4gbG9vcHMgY29sbGFwc2U6IGl0IG93bnMgdGhlIHBlci1jb21tYW5kIHZlcmRpY3QgdGhyZWFkIFx1MjAxNCBwYXNzIEFcbiAqIGBldmFsdWF0ZVdyaXRlR2F0ZWAgc3dlZXAsIHRoZSBleHBsYW5hdGlvbiBtYXAsIHRoZSBqb2luIGZpbHRlciwgYW5kIHBhc3MgQlxuICogcGVyLXN1cnZpdmluZy1zcGFuIGBydW5Ub3VjaEhvb2tgIFx1MjAxNCBwbHVzIHRoZSB3aG9sZS1jb21tYW5kIGBpbnRlcnJ1cHRlZGBcbiAqIGdhdGUgKHBsYW4gXHUwMEE3NCkuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBSZXNvbHZlZFNwYW4sIFNwYW5NYXRjaCB9IGZyb20gJy4vcGFyc2UtY29tbWFuZC5qcyc7XG5pbXBvcnQgeyB0eXBlIE1lbW9TdG9yZSwgcmVzb2x2ZVRvdWNoU2NvcGUgfSBmcm9tICcuL3NwYW4tc3VyZmFjZS5qcyc7XG5pbXBvcnQge1xuICBjcmVhdGVSZWFsaXR5UHJvYmVDYWNoZSxcbiAgZXZhbHVhdGVXcml0ZUdhdGUsXG4gIGZpbGVFeGlzdHMsXG4gIHR5cGUgUmVhbGl0eVByb2JlQ2FjaGUsXG4gIHJ1blRvdWNoSG9vayxcbiAgdHlwZSBUb3VjaEV4ZWN1dG9ycyxcbiAgdHlwZSBUb3VjaElucHV0LFxuICB0eXBlIFdyaXRlR2F0ZU91dGNvbWVcbn0gZnJvbSAnLi90b3VjaC1jb3JlLmpzJztcblxuLyoqXG4gKiBUcmFuc2xhdGUgb25lIHJlc29sdmVkIHNwYW4gaW50byBhIGZ1bGx5LXR5cGVkIHtAbGluayBUb3VjaElucHV0fSBwZXIgdGhlXG4gKiBwbGFuIFx1MDBBNzIgdGFibGUsIG9yIGBudWxsYCB3aGVuIHRoZSBwYXRoIGZhaWxzIGByZXNvbHZlVG91Y2hTY29wZWAgXHUyMDE0IGNyb3NzLVxuICogcmVwbywgZ2l0aWdub3JlZCwgYW5kIHNwYW4tZG9jdW1lbnQgcGF0aHMgZmFpbCBjbG9zZWQuXG4gKlxuICogVGhlIHBvc3Qtc3RhdGUgZ2F0ZSBmaWVsZHMgdGhlIHNwYW4gY2FuIGRldGVybWluZSAoYHRhcmdldFN0YXRlYCwgYW5kXG4gKiBgcG9zdFN0YXRlYCBmb3IgYXBwZW5kcyBhbmQgZGVsZXRlcykgYXJlIHNldCBoZXJlOyBhIGxpdGVyYWwgb3ZlcndyaXRlIGJvZHlcbiAqIChgc3Bhbi53cml0dGVuYCBcdTIwMTQgdGhlIGZsYWctbGVzcyBgZWNob2AvYHByaW50ZmAgYD5gIGNhc2UpIHJpZGVzIGFzIHRoZVxuICogYGV4YWN0YCBwb3N0LWNvbnRlbnQgZXhwZWN0YXRpb24gc28gdGhlIGdhdGUgdmVyaWZpZXMgdGhlIHdyaXRlJ3MgZWZmZWN0XG4gKiB3aGlsZSB0aGUgdG91Y2ggaXRzZWxmIHN0YXlzIHdob2xlLWZpbGUgKHBsYW4gXHUwMEE3MyBzdGVwIDFiKS4gVHJ1bmNhdGVzIG1hcFxuICogdGhlIHNwYW4ncyBzdGF0aWNhbGx5IGV2YWx1YXRlZCBhYnNvbHV0ZSBgLXMgTmAgdG8gdGhlIGBzaXplYCBwb3N0LWNvbnRlbnRcbiAqIChgLXMgMGAgXHUyMTkyIGBlbXB0eWApOyBhIHRydW5jYXRlIHdpdGhvdXQgYSBzaXplIGdhdGVzIGV4aXN0ZW5jZS1vbmx5LiBUaGVcbiAqIGRyaXZlciBwYWlycyBjcC9pbnN0YWxsIGFuZCBtdiBzb3VyY2VzIG9udG8gdGhlIGRlc3RpbmF0aW9uIHRvdWNoZXNcbiAqIGFmdGVyd2FyZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJhc2hTcGFuVG9Ub3VjaChzcGFuOiBSZXNvbHZlZFNwYW4sIHNlc3Npb25JZDogc3RyaW5nLCBjd2Q6IHN0cmluZyk6IFRvdWNoSW5wdXQgfCBudWxsIHtcbiAgaWYgKCFyZXNvbHZlVG91Y2hTY29wZShjd2QsIHNwYW4uYWJzb2x1dGVQYXRoKSkgcmV0dXJuIG51bGw7XG4gIHN3aXRjaCAoc3Bhbi5vcGVyYXRpb24pIHtcbiAgICBjYXNlICdyZWFkJzpcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGtpbmQ6ICdyZWFkJyxcbiAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICBjd2QsXG4gICAgICAgIGZpbGVQYXRoOiBzcGFuLmFic29sdXRlUGF0aCxcbiAgICAgICAgb2Zmc2V0OiBzcGFuLmxpbmVTdGFydCxcbiAgICAgICAgbGltaXQ6XG4gICAgICAgICAgc3Bhbi5saW5lU3RhcnQgIT09IHVuZGVmaW5lZCAmJiBzcGFuLmxpbmVFbmQgIT09IHVuZGVmaW5lZCA/IHNwYW4ubGluZUVuZCAtIHNwYW4ubGluZVN0YXJ0ICsgMSA6IHVuZGVmaW5lZFxuICAgICAgfTtcbiAgICBjYXNlICdjcmVhdGUtb3ZlcndyaXRlJzpcbiAgICBjYXNlICdyZW5hbWUtY29weSc6XG4gICAgICAvLyBXaG9sZS1maWxlIHdyaXRlczogYHdyaXR0ZW46ICcnYCBzY29wZXMgdGhlIHRvdWNoIHRvIGV2ZXJ5IGNvdmVyaW5nXG4gICAgICAvLyBzcGFuIFx1MjAxNCB0cnVuY2F0aW5nIHdyaXRlcyBkZXN0cm95IGFuY2hvcnMgYmV5b25kIHRoZSBuZXcgRU9GICh0aGVcbiAgICAgIC8vIG1haW4tMjAwIEYyIGxlc3NvbikuIEEgbGl0ZXJhbCBib2R5IHJpZGVzIGFzIHRoZSBleGFjdCBwb3N0LWNvbnRlbnRcbiAgICAgIC8vIGV4cGVjdGF0aW9uIHNvIHRoZSBnYXRlIHZlcmlmaWVzIHRoZSB3cml0ZSdzIGVmZmVjdC5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGtpbmQ6ICd3cml0ZScsXG4gICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgY3dkLFxuICAgICAgICBmaWxlUGF0aDogc3Bhbi5hYnNvbHV0ZVBhdGgsXG4gICAgICAgIHdyaXR0ZW46ICcnLFxuICAgICAgICB0YXJnZXRTdGF0ZTogJ2V4aXN0cycsXG4gICAgICAgIHBvc3RTdGF0ZTogc3Bhbi53cml0dGVuICE9PSB1bmRlZmluZWQgPyB7IGNvbnRlbnQ6IHsgZXhhY3Q6IHNwYW4ud3JpdHRlbiB9IH0gOiB1bmRlZmluZWRcbiAgICAgIH07XG4gICAgY2FzZSAndHJ1bmNhdGUnOlxuICAgICAgLy8gU2FtZSB3aG9sZS1maWxlIHNjb3BlOyB0aGUgc2l6ZSBnYXRlIChwbGFuIFx1MDBBNzIsIFx1MDBBNzMgc3RlcCAxYikgdmVyaWZpZXNcbiAgICAgIC8vIHRoZSBwb3N0LWNvbW1hbmQgYnl0ZSBjb3VudCB3aGVuIHRoZSBzcGFuIGNhcnJpZXMgYSBzdGF0aWNhbGx5XG4gICAgICAvLyBldmFsdWF0ZWQgYWJzb2x1dGUgYC1zIE5gIChgLXMgMGAgXHUyMTkyIGVtcHR5KTsgd2l0aG91dCBvbmUgdGhlIGdhdGUgaXNcbiAgICAgIC8vIGV4aXN0ZW5jZS1vbmx5LlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogJ3dyaXRlJyxcbiAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICBjd2QsXG4gICAgICAgIGZpbGVQYXRoOiBzcGFuLmFic29sdXRlUGF0aCxcbiAgICAgICAgd3JpdHRlbjogJycsXG4gICAgICAgIHRhcmdldFN0YXRlOiAnZXhpc3RzJyxcbiAgICAgICAgcG9zdFN0YXRlOlxuICAgICAgICAgIHNwYW4uc2l6ZSA9PT0gMFxuICAgICAgICAgICAgPyB7IGNvbnRlbnQ6IHsgZW1wdHk6IHRydWUgfSB9XG4gICAgICAgICAgICA6IHNwYW4uc2l6ZSAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgICAgID8geyBjb250ZW50OiB7IHNpemU6IHNwYW4uc2l6ZSB9IH1cbiAgICAgICAgICAgICAgOiB1bmRlZmluZWRcbiAgICAgIH07XG4gICAgY2FzZSAnYXBwZW5kJzpcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGtpbmQ6ICd3cml0ZScsXG4gICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgY3dkLFxuICAgICAgICBmaWxlUGF0aDogc3Bhbi5hYnNvbHV0ZVBhdGgsXG4gICAgICAgIHdyaXR0ZW46IHNwYW4ud3JpdHRlbiA/PyAnJyxcbiAgICAgICAgdGFyZ2V0U3RhdGU6ICdleGlzdHMnLFxuICAgICAgICBwb3N0U3RhdGU6IHNwYW4ud3JpdHRlbiAhPT0gdW5kZWZpbmVkID8geyBjb250ZW50OiB7IHN1ZmZpeDogc3Bhbi53cml0dGVuIH0gfSA6IHVuZGVmaW5lZFxuICAgICAgfTtcbiAgICBjYXNlICdtb2RpZnknOlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogJ3dyaXRlJyxcbiAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICBjd2QsXG4gICAgICAgIGZpbGVQYXRoOiBzcGFuLmFic29sdXRlUGF0aCxcbiAgICAgICAgd3JpdHRlbjogJycsXG4gICAgICAgIHRhcmdldFN0YXRlOiAnZXhpc3RzJyxcbiAgICAgICAgcmFuZ2U6IHNwYW4ubGluZVN0YXJ0ICE9PSB1bmRlZmluZWQgPyB7IHN0YXJ0OiBzcGFuLmxpbmVTdGFydCwgZW5kOiBzcGFuLmxpbmVFbmQgPz8gc3Bhbi5saW5lU3RhcnQgfSA6IHVuZGVmaW5lZFxuICAgICAgfTtcbiAgICBjYXNlICdkZWxldGUnOlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogJ3dyaXRlJyxcbiAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICBjd2QsXG4gICAgICAgIGZpbGVQYXRoOiBzcGFuLmFic29sdXRlUGF0aCxcbiAgICAgICAgd3JpdHRlbjogJycsXG4gICAgICAgIHRhcmdldFN0YXRlOiAnYWJzZW50JyxcbiAgICAgICAgcG9zdFN0YXRlOiB7IHJlYWxEZWxldGU6IHRydWUgfVxuICAgICAgfTtcbiAgfVxufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhlIEJhc2ggYHRvb2xfcmVzcG9uc2VgIHNpZ25hbHMgdGhhdCB0aGUgY29tbWFuZCB3YXMgaW50ZXJydXB0ZWRcbiAqIChwbGFuIFx1MDBBNzQpLiBUaGUgU0RLIHR5cGVzIHRoZSByZXNwb25zZSBgdW5rbm93bmAgb24gYm90aCBhZGFwdGVycywgc28gdGhpc1xuICogaXMgYSBkZWZlbnNpdmUgcnVudGltZSBzaGFwZS1wcm9iZTogYW4gb2JqZWN0IGNhcnJ5aW5nIGEgdHJ1dGh5XG4gKiBgaW50ZXJydXB0ZWRgIGZpZWxkIGNsYXNzaWZpZXMgYXMgaW50ZXJydXB0ZWQ7IGFueSBvdGhlciBzaGFwZSAoc3RyaW5nLFxuICogbnVsbCwgb2JqZWN0IHdpdGhvdXQgdGhlIGZpZWxkKSBwcm9jZWVkcyBmYWlsLW9wZW4sIG1hdGNoaW5nIHRvZGF5J3NcbiAqIGJlaGF2aW9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYmFzaFJlc3BvbnNlSW50ZXJydXB0ZWQodG9vbFJlc3BvbnNlOiB1bmtub3duKTogYm9vbGVhbiB7XG4gIGlmICh0b29sUmVzcG9uc2UgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xSZXNwb25zZSA9PT0gJ29iamVjdCcpIHtcbiAgICByZXR1cm4gQm9vbGVhbigodG9vbFJlc3BvbnNlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KS5pbnRlcnJ1cHRlZCk7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRoZSBwZXItY29tbWFuZCB2ZXJkaWN0IGRyaXZlciAocGxhbiBcdTAwQTczIHN0ZXAgMilcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50eXBlIFJlc29sdmVkTWF0Y2ggPSBFeHRyYWN0PFNwYW5NYXRjaCwgeyBzdGF0dXM6ICdyZXNvbHZlZCcgfT47XG5cbnR5cGUgVmVyZGljdCA9ICdmYWlsZWQnIHwgJ3N1Y2NlZWRlZCcgfCAndW5rbm93bic7XG5cbi8qKiBPbmUgcGFzcy1BIGV2YWx1YXRpb246IHRoZSBzcGFuLCBpdHMgdG91Y2gsIGFuZCB0aGUgKHBvc3QtcmVzb2x1dGlvbikgZ2F0ZSBvdXRjb21lLiAqL1xuaW50ZXJmYWNlIFNwYW5FdmFsIHtcbiAgbWF0Y2g6IFJlc29sdmVkTWF0Y2g7XG4gIC8qKiBUaGUgdHJhbnNsYXRlZCB0b3VjaCwgb3IgYG51bGxgIHdoZW4gdGhlIHNwYW4gZmFpbGVkIGByZXNvbHZlVG91Y2hTY29wZWAuICovXG4gIHRvdWNoOiBUb3VjaElucHV0IHwgbnVsbDtcbiAgLyoqIFRoZSBwYXNzLUEgZ2F0ZSBvdXRjb21lLCBwb3N0LXJlc29sdXRpb24gZm9yIGAncGVuZGluZydgIGFuZCBleHBsYWluZWQgZmFpbHMuICovXG4gIG91dGNvbWU6IFdyaXRlR2F0ZU91dGNvbWU7XG4gIC8qKiBBIGRlY2lzaXZlRmFpbCBkb3duZ3JhZGVkIGJ5IGEgbGF0ZXIgc2FtZS1wYXRoIGRlY2lzaXZlUGFzcyAocGxhbiBcdTAwQTczIHN0ZXAgMikuICovXG4gIGV4cGxhaW5lZDogYm9vbGVhbjtcbiAgY29tbWFuZEluZGV4OiBudW1iZXI7XG4gIC8qKiBUaGUgc3BhbidzIG93biBwYXRoIFx1MjAxNCB0aGUgZXhwbGFuYXRpb24ga2V5IGZvciBkZWNpc2l2ZSBmYWlscy4gKi9cbiAgcGF0aDogc3RyaW5nO1xuICAvKiogY3AgZGVzdGluYXRpb25zOiB0aGUgcGFpcmVkIHNvdXJjZSBwYXRoIFx1MjAxNCB0aGUgZXhwbGFuYXRpb24ga2V5IGZvciBwZW5kaW5ncy4gKi9cbiAgc291cmNlS2V5OiBzdHJpbmcgfCBudWxsO1xufVxuXG4vKipcbiAqIEV2YWx1YXRlIG9uZSBzcGFuJ3MgZ2F0ZS4gUmVhZHMgaGF2ZSBubyBnYXRlIFx1MjE5MiBgJ2luY29uY2x1c2l2ZSdgLCB3aXRoIG9uZVxuICogZXhjZXB0aW9uOiBjcC9pbnN0YWxsIHNvdXJjZSByZWFkcyBnYXRlIG9uIHRoZSBzb3VyY2UgZXhpc3RpbmcgcG9zdC1jb21tYW5kXG4gKiAocGxhbiBcdTAwQTcyKSBcdTIwMTQgYSBmYWlsZWQgY29weSBuZXZlciByZWFkIGFueXRoaW5nLiBUaGUgcmVhZCB2ZXJkaWN0IGZsaXBzIG9ubHlcbiAqIHRoZSBjb21tYW5kJ3Mgam9pbiB2ZXJkaWN0LCBuZXZlciB0aGUgc2FtZSBjb21tYW5kJ3MgZGVzdCB3cml0ZS5cbiAqL1xuZnVuY3Rpb24gZXZhbFNwYW5HYXRlKG1hdGNoOiBSZXNvbHZlZE1hdGNoLCB0b3VjaDogVG91Y2hJbnB1dCB8IG51bGwsIHByb2JlQ2FjaGU6IFJlYWxpdHlQcm9iZUNhY2hlKTogV3JpdGVHYXRlT3V0Y29tZSB7XG4gIGlmICh0b3VjaCA9PT0gbnVsbCkgcmV0dXJuICdpbmNvbmNsdXNpdmUnO1xuICBpZiAodG91Y2gua2luZCA9PT0gJ3JlYWQnKSB7XG4gICAgaWYgKChtYXRjaC5pZGlvbSA9PT0gJ2NwLXdyaXRlJyB8fCBtYXRjaC5pZGlvbSA9PT0gJ2luc3RhbGwtd3JpdGUnKSAmJiBtYXRjaC5zcGFuLm9wZXJhdGlvbiA9PT0gJ3JlYWQnKSB7XG4gICAgICByZXR1cm4gZmlsZUV4aXN0cyhtYXRjaC5zcGFuLmFic29sdXRlUGF0aCkgPyAnaW5jb25jbHVzaXZlJyA6ICdkZWNpc2l2ZUZhaWwnO1xuICAgIH1cbiAgICByZXR1cm4gJ2luY29uY2x1c2l2ZSc7XG4gIH1cbiAgcmV0dXJuIGV2YWx1YXRlV3JpdGVHYXRlKHRvdWNoLCBwcm9iZUNhY2hlKTtcbn1cblxuLyoqIFRoZSBvcGVyYXRvciBwcmVjZWRpbmcgYSBjb21tYW5kLCBmcm9tIGl0cyBmaXJzdCBzcGFuIChhbGwgc3BhbnMgb2Ygb25lIGNvbW1hbmQgc2hhcmUgaXQpLiAqL1xuZnVuY3Rpb24gam9pbk9mQ29tbWFuZChtYXRjaGVzOiBSZXNvbHZlZE1hdGNoW10pOiAnJiYnIHwgJ3x8JyB8IHVuZGVmaW5lZCB7XG4gIGZvciAoY29uc3QgbSBvZiBtYXRjaGVzKSB7XG4gICAgaWYgKG0uc3Bhbi5qb2luICE9PSB1bmRlZmluZWQpIHJldHVybiBtLnNwYW4uam9pbjtcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIFNoYXJlZCBCYXNoIGRyaXZlciAocGxhbiBcdTAwQTczIHN0ZXAgMik6IG93bnMgdGhlIHBlci1jb21tYW5kIHZlcmRpY3QgdGhyZWFkIFx1MjAxNFxuICogcGFzcyBBIGBldmFsdWF0ZVdyaXRlR2F0ZWAgc3dlZXAgKGV2ZXJ5IHNwYW4sIGJlZm9yZSBhbnkgam9pbiBkZWNpc2lvbiksXG4gKiB0aGUgZXhwbGFuYXRpb24gbWFwLCBwZXItY29tbWFuZCB2ZXJkaWN0cywgdGhlIGpvaW4gZmlsdGVyIHdpdGggY2hhaW5lZFxuICogc2tpcHMsIGFuZCBwYXNzIEIgcGVyLXN1cnZpdmluZy1zcGFuIGBydW5Ub3VjaEhvb2tgIFx1MjAxNCBwbHVzIHRoZSB3aG9sZS1jb21tYW5kXG4gKiBgaW50ZXJydXB0ZWRgIGdhdGUgKHBsYW4gXHUwMEE3NCkuIFJldHVybnMgdGhlIG5vbi1udWxsIGBhZGRpdGlvbmFsQ29udGV4dGBcbiAqIGJsb2NrcyBmb3IgdGhlIGFkYXB0ZXIgdG8gam9pbjsgdGhlIHNlc3Npb24gbWVtbyBkZWR1cHMgcmVwZWF0ZWQgdGFyZ2V0cy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1bkJhc2hUb3VjaGVzKFxuICBtYXRjaGVzOiBTcGFuTWF0Y2hbXSxcbiAgc2Vzc2lvbklkOiBzdHJpbmcsXG4gIGN3ZDogc3RyaW5nLFxuICB0b29sUmVzcG9uc2U6IHVua25vd24sXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMsXG4gIG1lbW86IE1lbW9TdG9yZSxcbiAgd2FybjogKG1lc3NhZ2U6IHN0cmluZykgPT4gdm9pZCA9IGNvbnNvbGUud2FyblxuKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICAvLyBBIGNvbW1hbmQgdGhhdCBkaWQgbm90IGNvbXBsZXRlIHByb2R1Y2VzIG5vIHRvdWNoZXMsIHdoYXRldmVyIGl0cyBzcGFucy5cbiAgaWYgKGJhc2hSZXNwb25zZUludGVycnVwdGVkKHRvb2xSZXNwb25zZSkpIHJldHVybiBbXTtcbiAgY29uc3QgcmVzb2x2ZWQgPSBtYXRjaGVzLmZpbHRlcigobSk6IG0gaXMgUmVzb2x2ZWRNYXRjaCA9PiBtLnN0YXR1cyA9PT0gJ3Jlc29sdmVkJyk7XG4gIGlmIChyZXNvbHZlZC5sZW5ndGggPT09IDApIHJldHVybiBbXTtcblxuICAvLyBTZWVkIHRoZSBwZXItY29tbWFuZCBwcm9iZSBjYWNoZSAocGxhbiBcdTAwQTczIHN0ZXAgMWMpIHdpdGggZXZlcnkgYWJzZW50XG4gIC8vIHRhcmdldCBhbmQgY3AvaW5zdGFsbCBzb3VyY2Ugb2YgdGhlIGNvbXBvdW5kOyB0aGUgZmlyc3QgZ2F0ZSB0aGF0IG5lZWRzXG4gIC8vIGl0IHJ1bnMgb25lIGxzLWZpbGVzICsgb25lIHNwYW4tbGlzdCBiYXRjaCBmb3IgYWxsIG9mIHRoZW0uXG4gIGNvbnN0IHByb2JlUGF0aHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgbSBvZiByZXNvbHZlZCkge1xuICAgIGlmIChtLnNwYW4ub3BlcmF0aW9uID09PSAnZGVsZXRlJykgcHJvYmVQYXRocy5wdXNoKG0uc3Bhbi5hYnNvbHV0ZVBhdGgpO1xuICAgIGVsc2UgaWYgKChtLmlkaW9tID09PSAnY3Atd3JpdGUnIHx8IG0uaWRpb20gPT09ICdpbnN0YWxsLXdyaXRlJykgJiYgbS5zcGFuLm9wZXJhdGlvbiA9PT0gJ3JlYWQnKSB7XG4gICAgICBwcm9iZVBhdGhzLnB1c2gobS5zcGFuLmFic29sdXRlUGF0aCk7XG4gICAgfVxuICB9XG4gIGNvbnN0IHByb2JlQ2FjaGUgPSBjcmVhdGVSZWFsaXR5UHJvYmVDYWNoZShwcm9iZVBhdGhzKTtcblxuICAvLyBHcm91cCBieSBzaW1wbGUgY29tbWFuZCBpbiB3YWxrZXIgb3JkZXIuXG4gIGNvbnN0IGdyb3VwcyA9IG5ldyBNYXA8bnVtYmVyLCBSZXNvbHZlZE1hdGNoW10+KCk7XG4gIGNvbnN0IGNvbW1hbmRPcmRlcjogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChjb25zdCBtIG9mIHJlc29sdmVkKSB7XG4gICAgY29uc3QgaWR4ID0gbS5zcGFuLnNpbXBsZUNvbW1hbmRJbmRleDtcbiAgICBjb25zdCBsaXN0ID0gZ3JvdXBzLmdldChpZHgpO1xuICAgIGlmIChsaXN0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGxpc3QucHVzaChtKTtcbiAgICB9IGVsc2Uge1xuICAgICAgZ3JvdXBzLnNldChpZHgsIFttXSk7XG4gICAgICBjb21tYW5kT3JkZXIucHVzaChpZHgpO1xuICAgIH1cbiAgfVxuICBjb21tYW5kT3JkZXIuc29ydCgoYSwgYikgPT4gYSAtIGIpO1xuXG4gIC8vIFBhc3MgQTogdHJhbnNsYXRlIGV2ZXJ5IHNwYW4gb25jZSBhbmQgZXZhbHVhdGUgaXRzIGdhdGUsIHBhaXJpbmdcbiAgLy8gY3AvaW5zdGFsbCBzb3VyY2VzIHdpdGggZGVzdGluYXRpb25zIGFuZCBtdiBkZWxldGVzIHdpdGggcmVuYW1lLWNvcGllcyBieVxuICAvLyBkZWNsYXJhdGlvbiBvcmRlciAodGhlIHBhcnNlciBlbWl0cyBzb3VyY2VzIGJlZm9yZSBkZXN0aW5hdGlvbnMpLlxuICBjb25zdCBldmFscyA9IG5ldyBNYXA8bnVtYmVyLCBTcGFuRXZhbFtdPigpO1xuICBmb3IgKGNvbnN0IGlkeCBvZiBjb21tYW5kT3JkZXIpIHtcbiAgICBjb25zdCBzcGFucyA9IGdyb3Vwcy5nZXQoaWR4KSE7XG4gICAgY29uc3QgcmVhZFBhdGhzID0gc3BhbnNcbiAgICAgIC5maWx0ZXIoKG0pID0+IChtLmlkaW9tID09PSAnY3Atd3JpdGUnIHx8IG0uaWRpb20gPT09ICdpbnN0YWxsLXdyaXRlJykgJiYgbS5zcGFuLm9wZXJhdGlvbiA9PT0gJ3JlYWQnKVxuICAgICAgLm1hcCgobSkgPT4gbS5zcGFuLmFic29sdXRlUGF0aCk7XG4gICAgY29uc3QgZGVsZXRlUGF0aHMgPSBzcGFucy5maWx0ZXIoKG0pID0+IG0uc3Bhbi5vcGVyYXRpb24gPT09ICdkZWxldGUnKS5tYXAoKG0pID0+IG0uc3Bhbi5hYnNvbHV0ZVBhdGgpO1xuICAgIGxldCByZWFkQ3Vyc29yID0gMDtcbiAgICBsZXQgZGVsZXRlQ3Vyc29yID0gMDtcbiAgICBjb25zdCBsaXN0OiBTcGFuRXZhbFtdID0gW107XG4gICAgZm9yIChjb25zdCBtIG9mIHNwYW5zKSB7XG4gICAgICBjb25zdCB0b3VjaCA9IGJhc2hTcGFuVG9Ub3VjaChtLnNwYW4sIHNlc3Npb25JZCwgY3dkKTtcbiAgICAgIGNvbnN0IGVudHJ5OiBTcGFuRXZhbCA9IHtcbiAgICAgICAgbWF0Y2g6IG0sXG4gICAgICAgIHRvdWNoLFxuICAgICAgICBvdXRjb21lOiAnaW5jb25jbHVzaXZlJyxcbiAgICAgICAgZXhwbGFpbmVkOiBmYWxzZSxcbiAgICAgICAgY29tbWFuZEluZGV4OiBpZHgsXG4gICAgICAgIHBhdGg6IG0uc3Bhbi5hYnNvbHV0ZVBhdGgsXG4gICAgICAgIHNvdXJjZUtleTogbnVsbFxuICAgICAgfTtcbiAgICAgIGlmICh0b3VjaCAhPT0gbnVsbCAmJiB0b3VjaC5raW5kID09PSAnd3JpdGUnKSB7XG4gICAgICAgIGlmIChtLnNwYW4ub3BlcmF0aW9uID09PSAnY3JlYXRlLW92ZXJ3cml0ZScgJiYgKG0uaWRpb20gPT09ICdjcC13cml0ZScgfHwgbS5pZGlvbSA9PT0gJ2luc3RhbGwtd3JpdGUnKSkge1xuICAgICAgICAgIGNvbnN0IHNvdXJjZSA9IHJlYWRQYXRoc1tyZWFkQ3Vyc29yXTtcbiAgICAgICAgICBpZiAoc291cmNlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHJlYWRDdXJzb3IgKz0gMTtcbiAgICAgICAgICAgIC8vIGBpbnN0YWxsIC1zYC9gLS1zdHJpcGAgaXMgZGVsaWJlcmF0ZWx5IG5ldmVyIHBhaXJlZDogc3RyaXBwZWRcbiAgICAgICAgICAgIC8vIG91dHB1dCBuZXZlciBlcXVhbHMgdGhlIHNvdXJjZSwgc28gaW5zdGFsbCBkZXN0cyBnYXRlXG4gICAgICAgICAgICAvLyBleGlzdGVuY2Utb25seSAocGxhbiBcdTAwQTczIHN0ZXAgMWIpLlxuICAgICAgICAgICAgaWYgKG0uaWRpb20gPT09ICdjcC13cml0ZScpIHtcbiAgICAgICAgICAgICAgdG91Y2guc291cmNlUGF0aCA9IHNvdXJjZTtcbiAgICAgICAgICAgICAgZW50cnkuc291cmNlS2V5ID0gc291cmNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChtLnNwYW4ub3BlcmF0aW9uID09PSAncmVuYW1lLWNvcHknKSB7XG4gICAgICAgICAgY29uc3Qgc291cmNlID0gZGVsZXRlUGF0aHNbZGVsZXRlQ3Vyc29yXTtcbiAgICAgICAgICBpZiAoc291cmNlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGRlbGV0ZUN1cnNvciArPSAxO1xuICAgICAgICAgICAgdG91Y2gucmVuYW1lU291cmNlUGF0aCA9IHNvdXJjZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGVudHJ5Lm91dGNvbWUgPSBldmFsU3BhbkdhdGUobSwgdG91Y2gsIHByb2JlQ2FjaGUpO1xuICAgICAgbGlzdC5wdXNoKGVudHJ5KTtcbiAgICB9XG4gICAgZXZhbHMuc2V0KGlkeCwgbGlzdCk7XG4gIH1cblxuICAvLyBUaGUgZXhwbGFuYXRpb24gbWFwIChwbGFuIFx1MDBBNzMgc3RlcCAyKTogdGhlIGhpZ2hlc3Qgc2ltcGxlQ29tbWFuZEluZGV4IHdpdGhcbiAgLy8gYSBkZWNpc2l2ZVBhc3Mgb24gZWFjaCBwYXRoLlxuICBjb25zdCBwYXNzQnlQYXRoID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcbiAgZm9yIChjb25zdCBpZHggb2YgY29tbWFuZE9yZGVyKSB7XG4gICAgZm9yIChjb25zdCBlIG9mIGV2YWxzLmdldChpZHgpISkge1xuICAgICAgaWYgKGUub3V0Y29tZSA9PT0gJ2RlY2lzaXZlUGFzcycpIHtcbiAgICAgICAgY29uc3QgcHJldiA9IHBhc3NCeVBhdGguZ2V0KGUucGF0aCk7XG4gICAgICAgIGlmIChwcmV2ID09PSB1bmRlZmluZWQgfHwgaWR4ID4gcHJldikgcGFzc0J5UGF0aC5zZXQoZS5wYXRoLCBpZHgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIFJlc29sdmUgdGhlIGFic2VudC1zb3VyY2UgaG9sZHMgYWdhaW5zdCB0aGUgbm93LWNvbXBsZXRlIG1hcCwgYW5kXG4gIC8vIGRvd25ncmFkZSBleHBsYWluZWQgZmFpbHM6IGEgZGVjaXNpdmVGYWlsIG9uIGEgcGF0aCBhIGxhdGVyIGNvbW1hbmRcbiAgLy8gZGVtb25zdHJhYmx5IHJld3JvdGUgb3IgZGVsZXRlZCBpcyB0aGUgb3ZlcndyaXRlLCBub3QgdGhlIGVhcmxpZXIgY29tbWFuZFxuICAvLyBmYWlsaW5nIChwbGFuIFx1MDBBNzMgc3RlcCAyKS5cbiAgZm9yIChjb25zdCBpZHggb2YgY29tbWFuZE9yZGVyKSB7XG4gICAgZm9yIChjb25zdCBlIG9mIGV2YWxzLmdldChpZHgpISkge1xuICAgICAgaWYgKGUub3V0Y29tZSA9PT0gJ3BlbmRpbmcnKSB7XG4gICAgICAgIGNvbnN0IHBhc3NJZHggPSBlLnNvdXJjZUtleSAhPT0gbnVsbCA/IHBhc3NCeVBhdGguZ2V0KGUuc291cmNlS2V5KSA6IHVuZGVmaW5lZDtcbiAgICAgICAgZS5vdXRjb21lID0gcGFzc0lkeCAhPT0gdW5kZWZpbmVkICYmIHBhc3NJZHggPiBlLmNvbW1hbmRJbmRleCA/ICdkZWNpc2l2ZVBhc3MnIDogJ2RlY2lzaXZlRmFpbCc7XG4gICAgICB9IGVsc2UgaWYgKGUub3V0Y29tZSA9PT0gJ2RlY2lzaXZlRmFpbCcpIHtcbiAgICAgICAgY29uc3QgcGFzc0lkeCA9IHBhc3NCeVBhdGguZ2V0KGUucGF0aCk7XG4gICAgICAgIGlmIChwYXNzSWR4ICE9PSB1bmRlZmluZWQgJiYgcGFzc0lkeCA+IGUuY29tbWFuZEluZGV4KSBlLmV4cGxhaW5lZCA9IHRydWU7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gUGVyLWNvbW1hbmQgdmVyZGljdHM6ICdmYWlsZWQnIG9uIGFueSB1bmV4cGxhaW5lZCBkZWNpc2l2ZUZhaWwsIGVsc2VcbiAgLy8gJ3N1Y2NlZWRlZCcgb24gYXQgbGVhc3Qgb25lIGRlY2lzaXZlIG91dGNvbWUsIGVsc2UgJ3Vua25vd24nLlxuICBjb25zdCBjb21wdXRlZCA9IG5ldyBNYXA8bnVtYmVyLCBWZXJkaWN0PigpO1xuICBmb3IgKGNvbnN0IGlkeCBvZiBjb21tYW5kT3JkZXIpIHtcbiAgICBsZXQgZmFpbGVkID0gZmFsc2U7XG4gICAgbGV0IHBhc3NlZCA9IGZhbHNlO1xuICAgIGZvciAoY29uc3QgZSBvZiBldmFscy5nZXQoaWR4KSEpIHtcbiAgICAgIGlmIChlLm91dGNvbWUgPT09ICdkZWNpc2l2ZUZhaWwnICYmICFlLmV4cGxhaW5lZCkgZmFpbGVkID0gdHJ1ZTtcbiAgICAgIGlmIChlLm91dGNvbWUgPT09ICdkZWNpc2l2ZVBhc3MnKSBwYXNzZWQgPSB0cnVlO1xuICAgIH1cbiAgICBjb21wdXRlZC5zZXQoaWR4LCBmYWlsZWQgPyAnZmFpbGVkJyA6IHBhc3NlZCA/ICdzdWNjZWVkZWQnIDogJ3Vua25vd24nKTtcbiAgfVxuXG4gIC8vIFRoZSBqb2luIGZpbHRlciAocGxhbiBcdTAwQTczIHN0ZXAgMik6IGEgc2tpcHBlZCBjb21tYW5kJ3MgY2hhaW5lZCB2ZXJkaWN0IGlzXG4gIC8vIHRoZSBndWFyZCB0aGF0IHNraXBwZWQgaXQgXHUyMDE0ICdmYWlsZWQnIGFmdGVyIGFuICYmLXNraXAsICdzdWNjZWVkZWQnIGFmdGVyXG4gIC8vIGFuIHx8LXNraXAgXHUyMDE0IG1hdGNoaW5nIHRoZSBzaGVsbCBzaG9ydC1jaXJjdWl0IChhIHx8IGIgfHwgYyBzdG9wcyBhZnRlclxuICAvLyB0aGUgZmlyc3Qgc3VjY2VzcykuICd1bmtub3duJyBmYWlscyBvcGVuLlxuICBjb25zdCBlZmZlY3RpdmUgPSBuZXcgTWFwPG51bWJlciwgVmVyZGljdD4oKTtcbiAgY29uc3Qgc2tpcHBlZCA9IG5ldyBTZXQ8bnVtYmVyPigpO1xuICBsZXQgcHJldkluZGV4OiBudW1iZXIgfCBudWxsID0gbnVsbDtcbiAgZm9yIChjb25zdCBpZHggb2YgY29tbWFuZE9yZGVyKSB7XG4gICAgY29uc3Qgam9pbiA9IGpvaW5PZkNvbW1hbmQoZ3JvdXBzLmdldChpZHgpISk7XG4gICAgY29uc3QgcHJldlZlcmRpY3QgPSBwcmV2SW5kZXggIT09IG51bGwgPyBlZmZlY3RpdmUuZ2V0KHByZXZJbmRleCkgOiB1bmRlZmluZWQ7XG4gICAgaWYgKHByZXZWZXJkaWN0ICE9PSB1bmRlZmluZWQgJiYgam9pbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAoKGpvaW4gPT09ICcmJicgJiYgcHJldlZlcmRpY3QgPT09ICdmYWlsZWQnKSB8fCAoam9pbiA9PT0gJ3x8JyAmJiBwcmV2VmVyZGljdCA9PT0gJ3N1Y2NlZWRlZCcpKSB7XG4gICAgICAgIGVmZmVjdGl2ZS5zZXQoaWR4LCBqb2luID09PSAnJiYnID8gJ2ZhaWxlZCcgOiAnc3VjY2VlZGVkJyk7XG4gICAgICAgIHNraXBwZWQuYWRkKGlkeCk7XG4gICAgICAgIHByZXZJbmRleCA9IGlkeDtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuICAgIGVmZmVjdGl2ZS5zZXQoaWR4LCBjb21wdXRlZC5nZXQoaWR4KSEpO1xuICAgIHByZXZJbmRleCA9IGlkeDtcbiAgfVxuXG4gIC8vIFBhc3MgQjogcnVuIHRoZSB0b3VjaCBob29rIGZvciBzdXJ2aXZpbmcgc3BhbnMgb25seSBcdTIwMTQgZGVjaXNpdmVQYXNzLCBvclxuICAvLyBpbmNvbmNsdXNpdmUgd2l0aCBhbiAnZXhpc3RzJyB0YXJnZXQgKHRoZSBhZHZpc29yeSByZXNpZHVhbCBjbGFzczpcbiAgLy8gZXhpc3RlbmNlLWdhdGVkIGZhbWlsaWVzIGZpcmUgYW5kIGhlYWwvc3VyZmFjZTsgcGhhbnRvbSBkZWxldGVzIG5ldmVyXG4gIC8vIGZpcmUpLiBFeHBsYWluZWQgZmFpbHMgYW5kIGRlY2lzaXZlIGZhaWxzIG5ldmVyIHJlYWNoIGFuIGV4ZWN1dG9yLlxuICBjb25zdCBibG9ja3M6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgaWR4IG9mIGNvbW1hbmRPcmRlcikge1xuICAgIGlmIChza2lwcGVkLmhhcyhpZHgpKSBjb250aW51ZTtcbiAgICBsZXQgdG91Y2hlcyA9IDA7XG4gICAgZm9yIChjb25zdCBlIG9mIGV2YWxzLmdldChpZHgpISkge1xuICAgICAgaWYgKGUudG91Y2ggPT09IG51bGwgfHwgZS5leHBsYWluZWQpIGNvbnRpbnVlO1xuICAgICAgaWYgKGUub3V0Y29tZSA9PT0gJ2RlY2lzaXZlRmFpbCcpIGNvbnRpbnVlO1xuICAgICAgaWYgKGUub3V0Y29tZSA9PT0gJ2luY29uY2x1c2l2ZScgJiYgZS50b3VjaC5raW5kID09PSAnd3JpdGUnICYmIGUudG91Y2gudGFyZ2V0U3RhdGUgPT09ICdhYnNlbnQnKSBjb250aW51ZTtcbiAgICAgIGlmICh0b3VjaGVzID49IDMyKSB7XG4gICAgICAgIC8vIEhhcmQgcGVyLWNvbW1hbmQgdm9sdW1lIGNhcCAocGxhbiBcdTAwQTczIHN0ZXAgMik6IGRyb3AgdGhlIHN1cnBsdXMgd2l0aFxuICAgICAgICAvLyBhIHdhcm5pbmcgcmF0aGVyIHRoYW4gYmxvdyB0aGUgaG9vayB0aW1lb3V0IG9uIGEgNTAtY29weSBjaGFpbi5cbiAgICAgICAgd2FybihgQmFzaCB0b3VjaCBjYXAgKDMyKSByZWFjaGVkIGZvciBzaW1wbGUgY29tbWFuZCAke2lkeH07IGRyb3BwaW5nIHRoZSByZW1haW5pbmcgdG91Y2hlc2ApO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIHRvdWNoZXMgKz0gMTtcbiAgICAgIGNvbnN0IG91dHB1dCA9IGF3YWl0IHJ1blRvdWNoSG9vayhlLnRvdWNoLCBleGVjdXRvcnMsIG1lbW8sIHByb2JlQ2FjaGUpO1xuICAgICAgaWYgKG91dHB1dC5hZGRpdGlvbmFsQ29udGV4dCkgYmxvY2tzLnB1c2gob3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGJsb2Nrcztcbn1cbiIsICIvKipcbiAqIFN0YXRpYyBjbGFzc2lmaWNhdGlvbiBvZiBhIEJhc2ggdG9vbCBgY29tbWFuZGAgc3RyaW5nIGludG8gdGhlIGZpbGVcbiAqIHBhdGgocykgKyBsaW5lIHJhbmdlKHMpIGl0IHJlYWRzIG9yIHdyaXRlcywgd2hlcmUgdGhhdCdzIHN0YXRpY2FsbHlcbiAqIGRldGVybWluYWJsZS4gQnVpbHQgZnJvbSBhbiBlbXBpcmljYWwgcGFzcyBvdmVyIH4zMWsgcmVhbCBDbGF1ZGUgQ29kZVxuICogQmFzaCBpbnZvY2F0aW9ucyAoc2VlIGFuYWx5emUtdHJhbnNjcmlwdHMubXRzKSBcdTIwMTQgdGhlIGlkaW9tcyBiZWxvdyBhcmVcbiAqIGV4YWN0bHkgdGhlIG9uZXMgdGhhdCB0dXJuZWQgb3V0IHRvIGJlIGNvbW1vbiBBTkQgcmVsaWFibGUgdGhlcmUuXG4gKlxuICogRGVsaWJlcmF0ZWx5IE5PVCBjb3ZlcmVkIChzZWUgdGhlIHJlc2VhcmNoIHJlcG9ydCk6IGF3ayBOUi10cmlja3MgKHJhcmUsXG4gKiB1bmNvbnN0cmFpbmVkIHN5bnRheCksIGdyZXAgLW4vLUEvLUIvLUMgKHRoZSB3aW5kb3cgaXMgYW5jaG9yZWQgdG8gbWF0Y2hcbiAqIHBvc2l0aW9uLCB3aGljaCBpcyBkYXRhLWRlcGVuZGVudCwgbm90IGluIHRoZSBjb21tYW5kIHRleHQpLCBhbmQgZW1iZWRkZWRcbiAqIHB5dGhvbjMvbm9kZSBoZXJlZG9jIHNjcmlwdHMgKGEgZGlmZmVyZW50IGxhbmd1YWdlJ3MgQVNULCBub3QgYSBzaGVsbFxuICogY29uY2VybikuXG4gKlxuICogVGhlIGNhcmQncyB3cml0ZS10b3VjaCBmYW1pbGllcyBcdTIwMTQgcmVkaXJlY3Rpb25zIGFuZCBoZXJlZG9jcyAoXHUwMEE3NS4xXHUyMDEzXHUwMEE3NS4yKSxcbiAqIGNwIGFuZCBpbnN0YWxsIChcdTAwQTc1LjMpLCBtdiBhbmQgZ2l0IG12IChcdTAwQTc1LjQpLCBybSBhbmQgdHJ1bmNhdGUgKFx1MDBBNzUuNSksXG4gKiBzZWQgLWkgKFx1MDBBNzUuNiksIHBhdGNoIGFuZCBnaXQgYXBwbHkgKFx1MDBBNzUuNyksIGZvcm1hdHRlciB3cml0ZSBmbGFncyAoXHUwMEE3NS44KSxcbiAqIGFuZCBnaXQgcmVzdG9yZS9jaGVja291dCBwYXRoc3BlY3MgKFx1MDBBNzUuOSkgXHUyMDE0IGFyZSB0aGUgZ3JhbW1hcnMgYmVsb3cuIEVhY2hcbiAqIGZhbWlseSBmYWlscyBjbG9zZWQgb24gd2hhdCBpdCBjYW5ub3Qgc3RhdGljYWxseSBhdHRyaWJ1dGU6XG4gKiBzaGVsbC1leHBhbmRlZCBvciBkeW5hbWljIGNvbnRlbnQsIHJlY3Vyc2l2ZSByZW1vdmFsIChgcm0gLXJgKSxcbiAqIGhlcmUtc3RyaW5ncyAoYDw8PGApLCBkaXJlY3Rvcnktc2hhcGVkIHRhcmdldHMsIHdyYXBwZXItd3JhcHBlZCBjb21tYW5kc1xuICogd2hvc2UgYXJndiBjYW5ub3QgYmUgcmVjb3ZlcmVkLCBhbmQgdW5tYXRjaGVkIHBhdGhzcGVjcyBlbWl0IG5vIHNwYW4gYXRcbiAqIGFsbCBvciBhbiBleHBsaWNpdCB1bnJlc29sdmVkIGVudHJ5IFx1MjAxNCBuZXZlciBhIGd1ZXNzZWQgd3JpdGUuXG4gKi9cbmltcG9ydCB7IHJlYWRGaWxlU3luYywgc3RhdFN5bmMgfSBmcm9tICdub2RlOmZzJztcbmltcG9ydCB7IGJhc2VuYW1lLCBqb2luIGFzIGpvaW5QYXRoLCByZXNvbHZlIGFzIHJlc29sdmVQYXRoIH0gZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGNvdW50RmlsZUxpbmVzLCBjb3VudEdpdEJsb2JMaW5lcyB9IGZyb20gJy4vY29tbWFuZC1yZXNvbHZlLmpzJztcbmltcG9ydCB7IHR5cGUgU2ltcGxlQ29tbWFuZCwgc3BsaXRUb3BMZXZlbCwgc3RyaXBMZWFkaW5nQXNzaWdubWVudHMsIHR5cGUgVG9rZW4sIHRva2VuaXplIH0gZnJvbSAnLi9zaGVsbC1zcGxpdC5qcyc7XG5pbXBvcnQgeyB0eXBlIFBhdGhTdHJpcCwgcGFyc2VVbmlmaWVkRGlmZlJhbmdlIH0gZnJvbSAnLi91bmlmaWVkLWRpZmYuanMnO1xuXG4vKipcbiAqIFRoZSBleHBsaWNpdCBvcGVyYXRpb24ga2luZCBvZiBhIHJlc29sdmVkIHNwYW4uIFRoZSBhZGFwdGVycyB0cmFuc2xhdGUgZnJvbVxuICogdGhpcywgbmV2ZXIgZnJvbSBgaWRpb20gPT09ICdoZXJlZG9jLXdyaXRlJ2Atc3R5bGUgY2hlY2tzIChwbGFuIFx1MDBBNzEpLlxuICovXG5leHBvcnQgdHlwZSBPcGVyYXRpb24gPVxuICB8ICdyZWFkJyAvLyByZWFkIGlkaW9tczsgY3AvaW5zdGFsbCBzb3VyY2Ugb3BlcmFuZHNcbiAgfCAnY3JlYXRlLW92ZXJ3cml0ZScgLy8gdHJ1bmNhdGluZyBjb250ZW50IHdyaXRlczogPiByZWRpcmVjdHMsIHRlZSwgaGVyZWRvYyA+LCBjcC9tdiBkZXN0LCByZXN0b3JlL2NoZWNrb3V0LCBwYXRjaCBhZGRcbiAgfCAnYXBwZW5kJyAvLyA+PiByZWRpcmVjdHMsIHRlZSAtYSwgaGVyZWRvYyA+PlxuICB8ICdtb2RpZnknIC8vIGluLXBsYWNlIGVkaXRzIHdpdGggdW5rbm93biBjb250ZW50OiBzZWQgLWksIHBhdGNoIGh1bmtzLCBmb3JtYXR0ZXIgd3JpdGUgZmxhZ3NcbiAgfCAncmVuYW1lLWNvcHknIC8vIG12L2dpdCBtdi9wYXRjaC1yZW5hbWUgZGVzdGluYXRpb24gKHdob2xlLWZpbGUgd3JpdGUsIHNhbWUgdG91Y2ggYXMgY3JlYXRlLW92ZXJ3cml0ZSlcbiAgfCAndHJ1bmNhdGUnIC8vIDogPiBmLCBiYXJlID4gZiwgdHJ1bmNhdGVcbiAgfCAnZGVsZXRlJzsgLy8gcm0sIG12L2dpdCBtdiBzb3VyY2UsIHBhdGNoIGRlbGV0ZVxuXG5leHBvcnQgaW50ZXJmYWNlIFJlc29sdmVkU3BhbiB7XG4gIG9wZXJhdGlvbjogT3BlcmF0aW9uO1xuICBhYnNvbHV0ZVBhdGg6IHN0cmluZztcbiAgLyoqXG4gICAqIEV4YWN0IHJhbmdlOiBldmVyeSByZWFkOyBtb2RpZnkgb3BlcmF0aW9ucyB3aXRoIGEgc3RhdGljYWxseSBrbm93biByYW5nZVxuICAgKiAoc2VkIC1pIG51bWVyaWMgYWRkcmVzc2VzLCBwYXRjaCBodW5rIHVuaW9ucykuIEFic2VudCBmb3Igd3JpdGVzIFx1MjE5MlxuICAgKiB3aG9sZS1maWxlIHNjb3BlLlxuICAgKi9cbiAgbGluZVN0YXJ0PzogbnVtYmVyO1xuICBsaW5lRW5kPzogbnVtYmVyO1xuICAvKipcbiAgICogU3RhdGljYWxseSBrbm93biB3cml0dGVuIGNvbnRlbnQgXHUyMDE0IGFwcGVuZCBib2RpZXMgYW5kIGxpdGVyYWwgb3ZlcndyaXRlXG4gICAqIGJvZGllcyAoaGVyZWRvYy9lY2hvL3ByaW50Zi90ZWUgbGl0ZXJhbHMsIHBsYW4gXHUwMEE3MyBzdGVwIDFiKS4gT24gYXBwZW5kcyBpdFxuICAgKiBpcyB0aGUgc3VmZml4IGdhdGUncyBib2R5OyBvbiBgY3JlYXRlLW92ZXJ3cml0ZWAgaXQgaXMgdGhlIGV4YWN0IGdhdGUnc1xuICAgKiBwb3N0LWNvbnRlbnQgXHUyMDE0IHRoZSB0b3VjaCBpdHNlbGYgc3RheXMgd2hvbGUtZmlsZSAoYHdyaXR0ZW46ICcnYCkgZWl0aGVyXG4gICAqIHdheS5cbiAgICovXG4gIHdyaXR0ZW4/OiBzdHJpbmc7XG4gIC8qKlxuICAgKiBUaGUgc3RhdGljYWxseSBldmFsdWF0ZWQgYWJzb2x1dGUgYHRydW5jYXRlIC1zIE5gIHNpemUgKHBsYW4gXHUwMEE3NS41KTogdGhlXG4gICAqIFx1MDBBNzMgYHNpemVgIGdhdGUncyBwb3N0LWNvbW1hbmQgYnl0ZSBjb3VudCAoYC1zIDBgIFx1MjE5MiB0aGUgZW1wdHkgZ2F0ZSkuXG4gICAqIEFic2VudCBmb3IgcmVsYXRpdmUgc2l6ZXMgKGAtcyArTmAvYC1zIC1OYCksIGAtciByZWZgLCBhbmQgZXZlcnkgb3RoZXJcbiAgICogb3BlcmF0aW9uIFx1MjAxNCB0aG9zZSBnYXRlIGV4aXN0ZW5jZS1vbmx5LlxuICAgKi9cbiAgc2l6ZT86IG51bWJlcjtcbiAgLyoqXG4gICAqIE9yZGluYWwgb2YgdGhlIHNwYW4ncyBzaW1wbGUgY29tbWFuZCB3aXRoaW4gdGhlIGNvbXBvdW5kLCBpbiB3YWxrZXJcbiAgICogb3JkZXI7IGdyb3VwcyB0aGUgc3BhbnMgb2Ygb25lIGNvbW1hbmQgZm9yIGpvaW4gZ2F0aW5nIChwbGFuIFx1MDBBNzMgc3RlcCAyKS5cbiAgICovXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyO1xuICAvKipcbiAgICogVGhlIG9wZXJhdG9yIHByZWNlZGluZyB0aGUgc3BhbidzIHNpbXBsZSBjb21tYW5kOyBvbmx5IGAnJiYnYC9gJ3x8J2AgZ2F0ZS5cbiAgICogQWJzZW50IGZvciBgc3RhcnRgL2A7YC9uZXdsaW5lL2AmYC9gfGAgYm91bmRhcmllcy5cbiAgICovXG4gIGpvaW4/OiAnJiYnIHwgJ3x8JztcbiAgbm90ZT86IHN0cmluZztcbn1cblxuZXhwb3J0IHR5cGUgSWRpb20gPVxuICB8ICdzZWQtbi1yYW5nZSdcbiAgfCAnaGVhZC1maWxlJ1xuICB8ICd0YWlsLWZpbGUnXG4gIHwgJ2NhdC1maWxlJ1xuICB8ICdubC1maWxlJ1xuICB8ICdnaXQtc2hvdy1yZXYtcGF0aCdcbiAgfCAnZ2l0LWxvZy1MJ1xuICB8ICdoZXJlZG9jLXdyaXRlJ1xuICAvLyBUaGUgd3JpdGUtdG91Y2ggZmFtaWxpZXMgKHBsYW4gXHUwMEE3NSkuIElkaW9tIHN0YXlzIG1hdGNoIG1ldGFkYXRhIGZvciB0ZXN0c1xuICAvLyBhbmQgdW5yZXNvbHZlZCByZWFzb25zOyBhZGFwdGVyIGJlaGF2aW9yIGtleXMgb24gYG9wZXJhdGlvbmAsIG5ldmVyIGlkaW9tLlxuICB8ICdyZWRpcmVjdC13cml0ZScgLy8gXHUwMEE3NS4xOiBlY2hvL3ByaW50Zi90ZWUgY29udGVudCByZWRpcmVjdHNcbiAgfCAndHJ1bmNhdGUtd3JpdGUnIC8vIFx1MDBBNzUuMTogYmFyZSBgPiBmYCAvIGA6ID4gZmAgdHJ1bmNhdGlvbnNcbiAgfCAnY3Atd3JpdGUnIC8vIFx1MDBBNzUuM1xuICB8ICdpbnN0YWxsLXdyaXRlJyAvLyBcdTAwQTc1LjNcbiAgfCAnbXYtd3JpdGUnIC8vIFx1MDBBNzUuNDogbXYgYW5kIGdpdCBtdlxuICB8ICdybS13cml0ZScgLy8gXHUwMEE3NS41OiBybSBhbmQgZ2l0IHJtXG4gIHwgJ3RydW5jYXRlLWNvbW1hbmQnIC8vIFx1MDBBNzUuNTogdGhlIHRydW5jYXRlIGNvbW1hbmRcbiAgfCAnc2VkLWlucGxhY2UnIC8vIFx1MDBBNzUuNjogc2VkIC1pXG4gIHwgJ3BhdGNoLXdyaXRlJyAvLyBcdTAwQTc1Ljc6IHBhdGNoIGFuZCBnaXQgYXBwbHlcbiAgfCAnZm9ybWF0dGVyLXdyaXRlJyAvLyBcdTAwQTc1LjhcbiAgfCAnZ2l0LXJlc3RvcmUtd3JpdGUnIC8vIFx1MDBBNzUuOTogZ2l0IHJlc3RvcmUgcGF0aHNwZWNzXG4gIHwgJ2dpdC1jaGVja291dC13cml0ZSc7IC8vIFx1MDBBNzUuOTogZ2l0IGNoZWNrb3V0IC0tIHBhdGhzcGVjc1xuXG5leHBvcnQgdHlwZSBTcGFuTWF0Y2ggPVxuICB8IHsgc3RhdHVzOiAncmVzb2x2ZWQnOyBpZGlvbTogSWRpb207IHNwYW46IFJlc29sdmVkU3Bhbjsgbm90ZT86IHN0cmluZyB9XG4gIHwgeyBzdGF0dXM6ICd1bnJlc29sdmVkJzsgaWRpb206IElkaW9tOyBmaWxlQXJnOiBzdHJpbmc7IHJlYXNvbjogc3RyaW5nIH07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTGluZS1yYW5nZSBzcGVjczogd2hhdCBhIG1hdGNoZWQgaWRpb20gc2F5cyBhYm91dCB0aGUgcmFuZ2UsIGJlZm9yZSB3ZSBrbm93XG4vLyB3aGV0aGVyIHJlc29sdmluZyBpdCBuZWVkcyB0byBjb25zdWx0IGEgcmVhbCBmaWxlL2dpdCBibG9iLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnR5cGUgTGluZVJhbmdlU3BlYyA9XG4gIHwgeyBraW5kOiAnbGl0ZXJhbCc7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6ICd1cHBlckJvdW5kRnJvbVN0YXJ0JzsgZW5kOiBudW1iZXIgfVxuICB8IHsga2luZDogJ3RvRW9mJzsgc3RhcnQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAnbGFzdE5MaW5lcyc7IGNvdW50OiBudW1iZXIgfVxuICB8IHsga2luZDogJ2FwcGVuZExpbmVzJzsgY291bnQ6IG51bWJlciB9O1xuXG5mdW5jdGlvbiByZXNvbHZlU3BlYyhcbiAgc3BlYzogTGluZVJhbmdlU3BlYyxcbiAgdG90YWxMaW5lczogKCkgPT4gbnVtYmVyIHwgbnVsbFxuKTogeyBsaW5lU3RhcnQ6IG51bWJlcjsgbGluZUVuZDogbnVtYmVyIH0gfCBudWxsIHtcbiAgc3dpdGNoIChzcGVjLmtpbmQpIHtcbiAgICBjYXNlICdsaXRlcmFsJzpcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogc3BlYy5zdGFydCwgbGluZUVuZDogc3BlYy5lbmQgfTtcbiAgICBjYXNlICd1cHBlckJvdW5kRnJvbVN0YXJ0Jzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCk7XG4gICAgICByZXR1cm4geyBsaW5lU3RhcnQ6IDEsIGxpbmVFbmQ6IHRvdGFsICE9PSBudWxsID8gTWF0aC5taW4oc3BlYy5lbmQsIHRvdGFsKSA6IHNwZWMuZW5kIH07XG4gICAgfVxuICAgIGNhc2UgJ3RvRW9mJzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCk7XG4gICAgICBpZiAodG90YWwgPT09IG51bGwgfHwgdG90YWwgPT09IDApIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiBzcGVjLnN0YXJ0LCBsaW5lRW5kOiBNYXRoLm1heChzcGVjLnN0YXJ0LCB0b3RhbCkgfTtcbiAgICB9XG4gICAgY2FzZSAnbGFzdE5MaW5lcyc6IHtcbiAgICAgIGNvbnN0IHRvdGFsID0gdG90YWxMaW5lcygpO1xuICAgICAgaWYgKHRvdGFsID09PSBudWxsIHx8IHRvdGFsID09PSAwKSByZXR1cm4gbnVsbDtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogTWF0aC5tYXgoMSwgdG90YWwgLSBzcGVjLmNvdW50ICsgMSksIGxpbmVFbmQ6IHRvdGFsIH07XG4gICAgfVxuICAgIGNhc2UgJ2FwcGVuZExpbmVzJzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCkgPz8gMDtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogdG90YWwgKyAxLCBsaW5lRW5kOiB0b3RhbCArIHNwZWMuY291bnQgfTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gaGFzU2hlbGxFeHBhbnNpb24oczogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiAvWyRgXS8udGVzdChzKTtcbn1cblxuZnVuY3Rpb24gbG9va3NVbnJlc29sdmFibGUoczogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBoYXNTaGVsbEV4cGFuc2lvbihzKSB8fCAvWyo/XS8udGVzdChzKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBJZGlvbSBtYXRjaGVyczogcHVyZSBmdW5jdGlvbnMgb3ZlciBvbmUgc2ltcGxlIGNvbW1hbmQncyBhcmd2LlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmludGVyZmFjZSBSYXdDYW5kaWRhdGUge1xuICBraW5kOiAnY2FuZGlkYXRlJztcbiAgaWRpb206IElkaW9tO1xuICBmaWxlQXJnOiBzdHJpbmc7XG4gIHNwZWM6IExpbmVSYW5nZVNwZWM7XG4gIHJlc29sdmVyS2luZDogJ2ZzJyB8IHsga2luZDogJ2dpdCc7IHJldjogc3RyaW5nIH07XG4gIGRpck92ZXJyaWRlPzogc3RyaW5nO1xufVxuaW50ZXJmYWNlIFJhd1VucmVzb2x2ZWQge1xuICBraW5kOiAndW5yZXNvbHZlZCc7XG4gIGlkaW9tOiBJZGlvbTtcbiAgZmlsZUFyZzogc3RyaW5nO1xuICByZWFzb246IHN0cmluZztcbn1cbnR5cGUgTWF0Y2hSZXN1bHQgPSBSYXdDYW5kaWRhdGUgfCBSYXdVbnJlc29sdmVkO1xuXG5jb25zdCBTRURfUkFOR0UgPSAvXihcXGQrKSg/OiwoXFxkK3xcXCQpKT9wJC87XG5cbi8qKiBTcGxpdCBhIGBzZWRgIHNjcmlwdCBhcmd1bWVudCBpbnRvIGl0cyBgO2Atc2VwYXJhdGVkIHNlZ21lbnRzLiAqL1xuZnVuY3Rpb24gc2VkU2NyaXB0U2VnbWVudHMoc2NyaXB0OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiBzY3JpcHQuc3BsaXQoJzsnKTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hTZWQoYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdzZWQnKSByZXR1cm4gW107XG4gIGNvbnN0IHJlc3QgPSBhcmd2LnNsaWNlKDEpO1xuICBpZiAoIXJlc3QuaW5jbHVkZXMoJy1uJykpIHJldHVybiBbXTtcbiAgbGV0IHNjcmlwdElkeCA9IC0xO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHJlc3QubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAocmVzdFtpXSA9PT0gJy1uJykgY29udGludWU7XG4gICAgaWYgKHNlZFNjcmlwdFNlZ21lbnRzKHJlc3RbaV0pLnNvbWUoKHNlZykgPT4gU0VEX1JBTkdFLnRlc3Qoc2VnKSkpIHtcbiAgICAgIHNjcmlwdElkeCA9IGk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgaWYgKHNjcmlwdElkeCA9PT0gLTEpIHJldHVybiBbXTtcbiAgY29uc3QgZmlsZUNhbmRpZGF0ZXMgPSByZXN0LmZpbHRlcigoYSwgaSkgPT4gaSAhPT0gc2NyaXB0SWR4ICYmIGEgIT09ICctbicgJiYgIWEuc3RhcnRzV2l0aCgnLScpKTtcbiAgaWYgKGZpbGVDYW5kaWRhdGVzLmxlbmd0aCAhPT0gMSkgcmV0dXJuIFtdO1xuICBjb25zdCBmaWxlQXJnID0gZmlsZUNhbmRpZGF0ZXNbMF07XG4gIGNvbnN0IHJlc3VsdHM6IE1hdGNoUmVzdWx0W10gPSBbXTtcbiAgZm9yIChjb25zdCBzZWdtZW50IG9mIHNlZFNjcmlwdFNlZ21lbnRzKHJlc3Rbc2NyaXB0SWR4XSkpIHtcbiAgICBjb25zdCBtYXRjaCA9IHNlZ21lbnQubWF0Y2goU0VEX1JBTkdFKTtcbiAgICBpZiAoIW1hdGNoKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IE51bWJlci5wYXJzZUludChtYXRjaFsxXSwgMTApO1xuICAgIGNvbnN0IGVuZFRva2VuID0gbWF0Y2hbMl07XG4gICAgY29uc3Qgc3BlYzogTGluZVJhbmdlU3BlYyA9XG4gICAgICBlbmRUb2tlbiA9PT0gdW5kZWZpbmVkXG4gICAgICAgID8geyBraW5kOiAnbGl0ZXJhbCcsIHN0YXJ0LCBlbmQ6IHN0YXJ0IH1cbiAgICAgICAgOiBlbmRUb2tlbiA9PT0gJyQnXG4gICAgICAgICAgPyB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0IH1cbiAgICAgICAgICA6IHsga2luZDogJ2xpdGVyYWwnLCBzdGFydCwgZW5kOiBOdW1iZXIucGFyc2VJbnQoZW5kVG9rZW4sIDEwKSB9O1xuICAgIHJlc3VsdHMucHVzaCh7IGtpbmQ6ICdjYW5kaWRhdGUnLCBpZGlvbTogJ3NlZC1uLXJhbmdlJywgZmlsZUFyZywgc3BlYywgcmVzb2x2ZXJLaW5kOiAnZnMnIH0pO1xuICB9XG4gIHJldHVybiByZXN1bHRzO1xufVxuXG5mdW5jdGlvbiBwYXJzZUhlYWRUYWlsRmxhZ3MocmVzdDogc3RyaW5nW10pOiB7XG4gIGNvdW50OiBudW1iZXIgfCBudWxsO1xuICBmcm9tU3RhcnQ6IGJvb2xlYW47XG4gIGRpc3F1YWxpZmllZDogYm9vbGVhbjtcbiAgZmlsZXM6IHN0cmluZ1tdO1xufSB7XG4gIGNvbnN0IGZpbGVzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgY291bnQ6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICBsZXQgZnJvbVN0YXJ0ID0gZmFsc2U7XG4gIGxldCBkaXNxdWFsaWZpZWQgPSBmYWxzZTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCByZXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IHJlc3RbaV07XG4gICAgaWYgKGEgPT09ICctZicgfHwgYSA9PT0gJy1GJyB8fCBhID09PSAnLS1mb2xsb3cnIHx8IGEuc3RhcnRzV2l0aCgnLS1mb2xsb3c9JykpIHtcbiAgICAgIGRpc3F1YWxpZmllZCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICcteicgfHwgYSA9PT0gJy0temVyby10ZXJtaW5hdGVkJykge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1jJyB8fCBhID09PSAnLS1ieXRlcycpIHtcbiAgICAgIGRpc3F1YWxpZmllZCA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eKC1jfC0tYnl0ZXM9KS8udGVzdChhKSkge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1xJyB8fCBhID09PSAnLXYnIHx8IGEgPT09ICctLXF1aWV0JyB8fCBhID09PSAnLS1zaWxlbnQnIHx8IGEgPT09ICctLXZlcmJvc2UnKSBjb250aW51ZTtcbiAgICBpZiAoYSA9PT0gJy1uJykge1xuICAgICAgY29uc3QgdiA9IHJlc3RbaSArIDFdO1xuICAgICAgaWYgKHYgIT09IHVuZGVmaW5lZCAmJiAvXlxcKz9cXGQrJC8udGVzdCh2KSkge1xuICAgICAgICBmcm9tU3RhcnQgPSB2LnN0YXJ0c1dpdGgoJysnKTtcbiAgICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQodi5yZXBsYWNlKCcrJywgJycpLCAxMCk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctLWxpbmVzPScpKSB7XG4gICAgICBjb25zdCB2ID0gYS5zbGljZSgnLS1saW5lcz0nLmxlbmd0aCk7XG4gICAgICBpZiAoL15cXCs/XFxkKyQvLnRlc3QodikpIHtcbiAgICAgICAgZnJvbVN0YXJ0ID0gdi5zdGFydHNXaXRoKCcrJyk7XG4gICAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KHYucmVwbGFjZSgnKycsICcnKSwgMTApO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgvXi1uXFwrP1xcZCskLy50ZXN0KGEpKSB7XG4gICAgICBjb25zdCB2ID0gYS5zbGljZSgyKTtcbiAgICAgIGZyb21TdGFydCA9IHYuc3RhcnRzV2l0aCgnKycpO1xuICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQodi5yZXBsYWNlKCcrJywgJycpLCAxMCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eXFwrXFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgIGZyb21TdGFydCA9IHRydWU7XG4gICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludChhLnNsaWNlKDEpLCAxMCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eLVxcZCskLy50ZXN0KGEpKSB7XG4gICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludChhLnNsaWNlKDEpLCAxMCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctJykge1xuICAgICAgZmlsZXMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlO1xuICAgIGZpbGVzLnB1c2goYSk7XG4gIH1cbiAgcmV0dXJuIHsgY291bnQsIGZyb21TdGFydCwgZGlzcXVhbGlmaWVkLCBmaWxlcyB9O1xufVxuXG5mdW5jdGlvbiBtYXRjaEhlYWQoYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdoZWFkJykgcmV0dXJuIFtdO1xuICBjb25zdCB7IGNvdW50LCBkaXNxdWFsaWZpZWQsIGZpbGVzIH0gPSBwYXJzZUhlYWRUYWlsRmxhZ3MoYXJndi5zbGljZSgxKSk7XG4gIGlmIChkaXNxdWFsaWZpZWQpIHJldHVybiBbXTtcbiAgY29uc3QgcmVhbEZpbGVzID0gZmlsZXMuZmlsdGVyKChmKSA9PiBmICE9PSAnLScpO1xuICBpZiAocmVhbEZpbGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICBjb25zdCBuID0gY291bnQgPz8gMTA7XG4gIHJldHVybiByZWFsRmlsZXMubWFwKChmaWxlQXJnKSA9PiAoe1xuICAgIGtpbmQ6ICdjYW5kaWRhdGUnIGFzIGNvbnN0LFxuICAgIGlkaW9tOiAnaGVhZC1maWxlJyBhcyBjb25zdCxcbiAgICBmaWxlQXJnLFxuICAgIHNwZWM6IHsga2luZDogJ3VwcGVyQm91bmRGcm9tU3RhcnQnLCBlbmQ6IG4gfSBhcyBMaW5lUmFuZ2VTcGVjLFxuICAgIHJlc29sdmVyS2luZDogJ2ZzJyBhcyBjb25zdFxuICB9KSk7XG59XG5cbmZ1bmN0aW9uIG1hdGNoVGFpbChhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ3RhaWwnKSByZXR1cm4gW107XG4gIGNvbnN0IHsgY291bnQsIGZyb21TdGFydCwgZGlzcXVhbGlmaWVkLCBmaWxlcyB9ID0gcGFyc2VIZWFkVGFpbEZsYWdzKGFyZ3Yuc2xpY2UoMSkpO1xuICBpZiAoZGlzcXVhbGlmaWVkKSByZXR1cm4gW107XG4gIGNvbnN0IHJlYWxGaWxlcyA9IGZpbGVzLmZpbHRlcigoZikgPT4gZiAhPT0gJy0nKTtcbiAgaWYgKHJlYWxGaWxlcy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgY29uc3QgbiA9IGNvdW50ID8/IDEwO1xuICBjb25zdCBzcGVjOiBMaW5lUmFuZ2VTcGVjID0gZnJvbVN0YXJ0ID8geyBraW5kOiAndG9Fb2YnLCBzdGFydDogbiB9IDogeyBraW5kOiAnbGFzdE5MaW5lcycsIGNvdW50OiBuIH07XG4gIHJldHVybiByZWFsRmlsZXMubWFwKChmaWxlQXJnKSA9PiAoe1xuICAgIGtpbmQ6ICdjYW5kaWRhdGUnIGFzIGNvbnN0LFxuICAgIGlkaW9tOiAndGFpbC1maWxlJyBhcyBjb25zdCxcbiAgICBmaWxlQXJnLFxuICAgIHNwZWMsXG4gICAgcmVzb2x2ZXJLaW5kOiAnZnMnIGFzIGNvbnN0XG4gIH0pKTtcbn1cblxuZnVuY3Rpb24gZmluZEdpdFN1YmNvbW1hbmQoXG4gIHJlc3Q6IHN0cmluZ1tdXG4pOiB7IHN1YklkeDogbnVtYmVyOyBzdWJjb21tYW5kOiBzdHJpbmc7IGNEaXI6IHN0cmluZyB8IG51bGw7IGNEaXJVbnJlc29sdmFibGU6IGJvb2xlYW4gfSB8IG51bGwge1xuICBsZXQgY0Rpcjogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCBjRGlyVW5yZXNvbHZhYmxlID0gZmFsc2U7XG4gIGxldCBpID0gMDtcbiAgd2hpbGUgKGkgPCByZXN0Lmxlbmd0aCkge1xuICAgIGNvbnN0IGEgPSByZXN0W2ldO1xuICAgIGlmIChhID09PSAnLUMnKSB7XG4gICAgICBjb25zdCB2ID0gcmVzdFtpICsgMV07XG4gICAgICBpZiAodiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgICAgIGlmIChoYXNTaGVsbEV4cGFuc2lvbih2KSkgY0RpclVucmVzb2x2YWJsZSA9IHRydWU7XG4gICAgICBlbHNlIGNEaXIgPSB2O1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWMnKSB7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgcmV0dXJuIHsgc3ViSWR4OiBpLCBzdWJjb21tYW5kOiBhLCBjRGlyLCBjRGlyVW5yZXNvbHZhYmxlIH07XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbmNvbnN0IFJFVl9QQVRIID0gL14oW15cXHM6XSspOiguKykkLztcblxuZnVuY3Rpb24gbWF0Y2hHaXRTaG93KGFyZ3Y6IHN0cmluZ1tdKTogTWF0Y2hSZXN1bHRbXSB7XG4gIGlmIChhcmd2WzBdICE9PSAnZ2l0JykgcmV0dXJuIFtdO1xuICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChhcmd2LnNsaWNlKDEpKTtcbiAgaWYgKCFzdWIgfHwgc3ViLnN1YmNvbW1hbmQgIT09ICdzaG93JykgcmV0dXJuIFtdO1xuICBjb25zdCBhZnRlciA9IGFyZ3ZcbiAgICAuc2xpY2UoMSlcbiAgICAuc2xpY2Uoc3ViLnN1YklkeCArIDEpXG4gICAgLmZpbHRlcigoYSkgPT4gIWEuc3RhcnRzV2l0aCgnLScpKTtcbiAgY29uc3QgcmV2UGF0aEFyZyA9IGFmdGVyLmZpbmQoKGEpID0+IFJFVl9QQVRILnRlc3QoYSkpO1xuICBpZiAoIXJldlBhdGhBcmcpIHJldHVybiBbXTtcbiAgY29uc3QgbSA9IHJldlBhdGhBcmcubWF0Y2goUkVWX1BBVEgpO1xuICBpZiAoIW0pIHJldHVybiBbXTtcbiAgY29uc3QgWywgcmV2LCBwYXRoXSA9IG07XG4gIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSB8fCBoYXNTaGVsbEV4cGFuc2lvbihyZXYpKSB7XG4gICAgcmV0dXJuIFtcbiAgICAgIHtcbiAgICAgICAga2luZDogJ3VucmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogJ2dpdC1zaG93LXJldi1wYXRoJyxcbiAgICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgICAgcmVhc29uOiAnZ2l0IC1DIHRhcmdldCBvciByZXZpc2lvbiBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJ1xuICAgICAgfVxuICAgIF07XG4gIH1cbiAgcmV0dXJuIFtcbiAgICB7XG4gICAgICBraW5kOiAnY2FuZGlkYXRlJyxcbiAgICAgIGlkaW9tOiAnZ2l0LXNob3ctcmV2LXBhdGgnLFxuICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgIHNwZWM6IHsga2luZDogJ3RvRW9mJywgc3RhcnQ6IDEgfSxcbiAgICAgIHJlc29sdmVyS2luZDogeyBraW5kOiAnZ2l0JywgcmV2IH0sXG4gICAgICBkaXJPdmVycmlkZTogc3ViLmNEaXIgPz8gdW5kZWZpbmVkXG4gICAgfVxuICBdO1xufVxuXG5mdW5jdGlvbiBtYXRjaEdpdExvZ0woYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdnaXQnKSByZXR1cm4gW107XG4gIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKGFyZ3Yuc2xpY2UoMSkpO1xuICBpZiAoIXN1YiB8fCBzdWIuc3ViY29tbWFuZCAhPT0gJ2xvZycpIHJldHVybiBbXTtcbiAgY29uc3QgYWZ0ZXIgPSBhcmd2LnNsaWNlKDEpLnNsaWNlKHN1Yi5zdWJJZHggKyAxKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBhZnRlci5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhZnRlcltpXTtcbiAgICBsZXQgc3BlYzogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgaWYgKGEgPT09ICctTCcpIHNwZWMgPSBhZnRlcltpICsgMV0gPz8gbnVsbDtcbiAgICBlbHNlIGlmIChhLnN0YXJ0c1dpdGgoJy1MJykpIHNwZWMgPSBhLnNsaWNlKDIpO1xuICAgIGlmICghc3BlYykgY29udGludWU7XG4gICAgY29uc3QgbSA9IHNwZWMubWF0Y2goL14oXFxkKyksKFxcZCspOiguKykkLyk7XG4gICAgaWYgKCFtKSBjb250aW51ZTtcbiAgICBjb25zdCBbLCBzLCBlLCBwYXRoXSA9IG07XG4gICAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlKSB7XG4gICAgICByZXR1cm4gW1xuICAgICAgICB7XG4gICAgICAgICAga2luZDogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnZ2l0LWxvZy1MJyxcbiAgICAgICAgICBmaWxlQXJnOiBwYXRoLFxuICAgICAgICAgIHJlYXNvbjogJ2dpdCAtQyB0YXJnZXQgY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZSdcbiAgICAgICAgfVxuICAgICAgXTtcbiAgICB9XG4gICAgcmV0dXJuIFtcbiAgICAgIHtcbiAgICAgICAga2luZDogJ2NhbmRpZGF0ZScsXG4gICAgICAgIGlkaW9tOiAnZ2l0LWxvZy1MJyxcbiAgICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgICAgc3BlYzogeyBraW5kOiAnbGl0ZXJhbCcsIHN0YXJ0OiBOdW1iZXIucGFyc2VJbnQocywgMTApLCBlbmQ6IE51bWJlci5wYXJzZUludChlLCAxMCkgfSxcbiAgICAgICAgcmVzb2x2ZXJLaW5kOiAnZnMnLFxuICAgICAgICBkaXJPdmVycmlkZTogc3ViLmNEaXIgPz8gdW5kZWZpbmVkXG4gICAgICB9XG4gICAgXTtcbiAgfVxuICByZXR1cm4gW107XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSGVyZWRvYyB3cml0ZXMgKHBsYW4gXHUwMEE3NS4yKTogaGFuZGxlZCBhcyBhIGRlZGljYXRlZCByYXctdGV4dCBwYXNzIGJlY2F1c2UgdGhlXG4vLyBib2R5IGNhbiBpdHNlbGYgY29udGFpbiAmJi87L3wvbmV3bGluZXMgdGhhdCB3b3VsZCBvdGhlcndpc2UgY29uZnVzZVxuLy8gc3BsaXRUb3BMZXZlbC4gVGhlIG9wZW5lciBzY2FubmVyIGlzIHF1b3RlLWF3YXJlIGFuZCB2YWxpZGF0ZXMgdGhlIGNsb3Npbmdcbi8vIGRlbGltaXRlcjsgbWF0Y2hlZCBoZXJlZG9jcyBhcmUgbWFza2VkIG91dCBvZiB0aGUgc3RyaW5nIChyZXBsYWNlZCB3aXRoIGFuXG4vLyBpbmRleGVkIHBsYWNlaG9sZGVyIHNpbXBsZS1jb21tYW5kKSBiZWZvcmUgdGhlIHJlc3Qgb2YgdGhlIHBpcGVsaW5lIHJ1bnMsXG4vLyBhbmQgcmUtYXNzb2NpYXRlZCBieSBpbmRleCBkdXJpbmcgdGhlIG1haW4gd2FsayBzbyB0aGUgd3JpdGUgaXMgcmVzb2x2ZWRcbi8vIGFnYWluc3QgdGhlIGNvcnJlY3QgYGNkYC10cmFja2VkIGRpcmVjdG9yeS5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogVGhlIGhlcmVkb2MncyBjb250ZW50LWNhcnJ5aW5nIGZhY3RzLCByZS1hc3NvY2lhdGVkIGJ5IGluZGV4IGR1cmluZyB0aGUgd2Fsay4gKi9cbmludGVyZmFjZSBIZXJlZG9jV3JpdGUge1xuICAvKiogVGhlIG9wZW5lciBsaW5lIHZlcmJhdGltIChlLmcuIGBjYXQgPiBmIDw8J0VPRidgKSwgcmUtdG9rZW5pemVkIGR1cmluZyB0aGUgd2Fsay4gKi9cbiAgb3BlbmVyOiBzdHJpbmc7XG4gIC8qKiBUaGUgaGVyZWRvYyBib2R5OyBgPDwtYCBib2RpZXMgaGF2ZSBsZWFkaW5nIHRhYnMgc3RyaXBwZWQgcGVyIGxpbmUuICovXG4gIGJvZHk6IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIEhlcmVkb2NPcGVuZXIge1xuICAvKiogV2hlcmUgdGhlIGhlcmVkb2MncyBzaW1wbGUgY29tbWFuZCBzdGFydHMgaW4gdGhlIHJhdyBzdHJpbmcuICovXG4gIGNtZFN0YXJ0OiBudW1iZXI7XG4gIC8qKiBUaGUgbmV3bGluZSBlbmRpbmcgdGhlIG9wZW5lciBsaW5lLCBvciByYXcubGVuZ3RoIHdoZW4gaXQncyB0aGUgbGFzdCBsaW5lLiAqL1xuICBvcGVuZXJMaW5lRW5kOiBudW1iZXI7XG4gIC8qKiBUaGUgY2xvc2luZyBkZWxpbWl0ZXIgKHF1b3RlcyBzdHJpcHBlZCkuICovXG4gIGRlbGltOiBzdHJpbmc7XG4gIC8qKiBgPDwtYDogc3RyaXAgbGVhZGluZyB0YWJzIGZyb20gdGhlIGJvZHkgYW5kIHRoZSBjbG9zZXIgbGluZS4gKi9cbiAgdGFiU3RyaXA6IGJvb2xlYW47XG59XG5cbmNvbnN0IEJBUkVfREVMSU0gPSAvXltBLVphLXpfXVtBLVphLXowLTlfXSokLztcblxuLyoqXG4gKiBGaW5kIHRoZSBuZXh0IGhlcmVkb2Mgb3BlbmVyIChgPDxgL2A8PC1gKSBhdCB0b3AgbGV2ZWwsIHNjYW5uaW5nIGZyb21cbiAqIGBmcm9tYC4gTWlycm9ycyBzcGxpdFRvcExldmVsJ3Mgc2VwYXJhdG9yIGhhbmRsaW5nIHNvIGBjbWRTdGFydGAgbWFya3MgdGhlXG4gKiBvcGVuZXIncyBvd24gc2ltcGxlIGNvbW1hbmQ6IHRvcC1sZXZlbCBgJiZgL2B8fGAvYDtgL25ld2xpbmUvYCZgIHN0YXJ0IGEgbmV3XG4gKiBjb21tYW5kIChhIG5ld2xpbmUgYWZ0ZXIgYSBwaXBlIGlzIGEgbGluZSBjb250aW51YXRpb24pLCBgPmAtcmVkaXJlY3RzLCBkdXBcbiAqIHJlZGlyZWN0cyAoYDI+JjFgKSBhbmQgcGFyZW4gbmVzdGluZyBzdGF5IGluc2lkZSB0aGUgY29tbWFuZCwgYW5kXG4gKiBoZXJlLXN0cmluZ3MgKGA8PDxgKSBhcmUgb3V0IG9mIHNjb3BlLiBBbiBJT19OVU1CRVIgZmQgZGlyZWN0bHkgYmVmb3JlIHRoZVxuICogb3BlcmF0b3IgKGAyPDxFT0ZgKSByZWRpcmVjdHMgdGhhdCBmZCwgbm90IHN0ZGluIFx1MjAxNCBub3QgYSBoZXJlZG9jLiBSZXR1cm5zXG4gKiBudWxsIHdoZW4gbm8gb3BlbmVyIGlzIGZvdW5kLlxuICovXG5mdW5jdGlvbiBmaW5kSGVyZWRvY09wZW5lcihyYXc6IHN0cmluZywgZnJvbTogbnVtYmVyKTogSGVyZWRvY09wZW5lciB8IG51bGwge1xuICBjb25zdCBuID0gcmF3Lmxlbmd0aDtcbiAgbGV0IGluU3F1b3RlID0gZmFsc2U7XG4gIGxldCBpbkRxdW90ZSA9IGZhbHNlO1xuICBsZXQgZGVwdGggPSAwO1xuICBsZXQgY21kU3RhcnQgPSBmcm9tO1xuICBsZXQgcGVuZGluZ1BpcGUgPSBmYWxzZTtcbiAgbGV0IGkgPSBmcm9tO1xuXG4gIC8qKiBSZWFkIG9uZSBkZWxpbWl0ZXIgd29yZCBzdGFydGluZyBhdCBgc3RhcnRgICh0aGUgYXR0YWNoZWQgdGFpbCBvZiBgPDxFT0ZgL2A8PCdFT0YnYCwgb3IgYSBzdGFuZGFsb25lIG5leHQgd29yZCkuIFF1b3RlcyBjb250cmlidXRlIHRoZWlyIGNvbnRlbnQ7IGEgYmFja3NsYXNoIGVzY2FwZXMgdGhlIG5leHQgY2hhci4gUmV0dXJucyBudWxsIG9uIGFuIHVuYmFsYW5jZWQgcXVvdGUgKGZhaWwgY2xvc2VkKS4gKi9cbiAgY29uc3QgcmVhZERlbGltV29yZCA9IChzdGFydDogbnVtYmVyKTogeyBkZWxpbTogc3RyaW5nOyBzYXdRdW90ZTogYm9vbGVhbjsgbmV4dDogbnVtYmVyIH0gfCBudWxsID0+IHtcbiAgICBsZXQgZCA9ICcnO1xuICAgIGxldCBzYXdRdW90ZSA9IGZhbHNlO1xuICAgIGxldCBrID0gc3RhcnQ7XG4gICAgd2hpbGUgKGsgPCBuICYmICEvXFxzLy50ZXN0KHJhd1trXSkgJiYgcmF3W2tdICE9PSAnPCcgJiYgcmF3W2tdICE9PSAnPicpIHtcbiAgICAgIGNvbnN0IGMgPSByYXdba107XG4gICAgICBpZiAoYyA9PT0gXCInXCIgfHwgYyA9PT0gJ1wiJykge1xuICAgICAgICBjb25zdCBxdW90ZSA9IGM7XG4gICAgICAgIGxldCBtID0gayArIDE7XG4gICAgICAgIHdoaWxlIChtIDwgbiAmJiByYXdbbV0gIT09IHF1b3RlKSB7XG4gICAgICAgICAgZCArPSByYXdbbV07XG4gICAgICAgICAgbSArPSAxO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtID49IG4pIHJldHVybiBudWxsO1xuICAgICAgICBzYXdRdW90ZSA9IHRydWU7XG4gICAgICAgIGsgPSBtICsgMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGsgKyAxIDwgbikge1xuICAgICAgICBkICs9IHJhd1trICsgMV07XG4gICAgICAgIGsgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBkICs9IGM7XG4gICAgICBrICs9IDE7XG4gICAgfVxuICAgIHJldHVybiB7IGRlbGltOiBkLCBzYXdRdW90ZSwgbmV4dDogayB9O1xuICB9O1xuXG4gIHdoaWxlIChpIDwgbikge1xuICAgIGNvbnN0IGMgPSByYXdbaV07XG4gICAgaWYgKGluU3F1b3RlKSB7XG4gICAgICBpZiAoYyA9PT0gXCInXCIpIGluU3F1b3RlID0gZmFsc2U7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGluRHF1b3RlKSB7XG4gICAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikge1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcIicpIGluRHF1b3RlID0gZmFsc2U7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09IFwiJ1wiKSB7XG4gICAgICBpblNxdW90ZSA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcIicpIHtcbiAgICAgIGluRHF1b3RlID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikge1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnKCcpIHtcbiAgICAgIGRlcHRoICs9IDE7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcpJykge1xuICAgICAgZGVwdGggPSBNYXRoLm1heCgwLCBkZXB0aCAtIDEpO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChkZXB0aCA+IDApIHtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAocmF3LnN0YXJ0c1dpdGgoJyYmJywgaSkgfHwgcmF3LnN0YXJ0c1dpdGgoJ3x8JywgaSkpIHtcbiAgICAgIGNtZFN0YXJ0ID0gaSArIDI7XG4gICAgICBwZW5kaW5nUGlwZSA9IGZhbHNlO1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChyYXcuc3RhcnRzV2l0aCgnfCYnLCBpKSkge1xuICAgICAgY21kU3RhcnQgPSBpICsgMTtcbiAgICAgIHBlbmRpbmdQaXBlID0gdHJ1ZTtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJzsnKSB7XG4gICAgICBjbWRTdGFydCA9IGkgKyAxO1xuICAgICAgcGVuZGluZ1BpcGUgPSBmYWxzZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ3wnKSB7XG4gICAgICBjbWRTdGFydCA9IGkgKyAxO1xuICAgICAgcGVuZGluZ1BpcGUgPSB0cnVlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXFxuJykge1xuICAgICAgLy8gQSBuZXdsaW5lIGFmdGVyIGEgcGlwZSBpcyBhIGxpbmUgY29udGludWF0aW9uIChtaXJyb3JpbmdcbiAgICAgIC8vIHNwbGl0VG9wTGV2ZWwpOyBhbnl0aGluZyBlbHNlIHN0YXJ0cyBhIG5ldyBzaW1wbGUgY29tbWFuZC5cbiAgICAgIGlmICghcGVuZGluZ1BpcGUpIGNtZFN0YXJ0ID0gaSArIDE7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcmJykge1xuICAgICAgLy8gYCY+YC9gJj4+YCBhbmQgZHVwIHJlZGlyZWN0cyAoYDI+JjFgKSBhcmUgcmVkaXJlY3Qgb3BlcmF0b3JzLCBub3RcbiAgICAgIC8vIGNvbW1hbmQgc2VwYXJhdG9ycyAobWlycm9yaW5nIHNwbGl0VG9wTGV2ZWwpLlxuICAgICAgY29uc3QgdHJpbW1lZCA9IHJhdy5zbGljZShjbWRTdGFydCwgaSkudHJpbUVuZCgpO1xuICAgICAgY29uc3QgZHVwUmVkaXJlY3QgPVxuICAgICAgICB0cmltbWVkLmVuZHNXaXRoKCc+JykgJiYgKHRyaW1tZWQubGVuZ3RoID09PSAxIHx8IC9cXHN8XFxkLy50ZXN0KHRyaW1tZWRbdHJpbW1lZC5sZW5ndGggLSAyXSA/PyAnJykpO1xuICAgICAgaWYgKHJhd1tpICsgMV0gPT09ICc+JyB8fCBkdXBSZWRpcmVjdCkge1xuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY21kU3RhcnQgPSBpICsgMTtcbiAgICAgIHBlbmRpbmdQaXBlID0gZmFsc2U7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICc8JyAmJiByYXdbaSArIDFdID09PSAnPCcpIHtcbiAgICAgIC8vIGA8PDxgIGlzIGEgaGVyZS1zdHJpbmcgKG91dCBvZiBzY29wZSk7IGA8PC1gIHN0cmlwcyBsZWFkaW5nIHRhYnMuXG4gICAgICBpZiAocmF3W2kgKyAyXSA9PT0gJzwnKSB7XG4gICAgICAgIGkgKz0gMztcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBsZXQgaiA9IGkgLSAxO1xuICAgICAgd2hpbGUgKGogPj0gZnJvbSAmJiAvXFxkLy50ZXN0KHJhd1tqXSkpIGogLT0gMTtcbiAgICAgIGNvbnN0IGlvTnVtYmVyID0gaiA8IGkgLSAxICYmIChqIDwgZnJvbSB8fCAvXFxzfFs7fCYoXS8udGVzdChyYXdbal0pKTtcbiAgICAgIGlmIChpb051bWJlcikge1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgdGFiU3RyaXAgPSByYXdbaSArIDJdID09PSAnLSc7XG4gICAgICBjb25zdCBvcExlbiA9IHRhYlN0cmlwID8gMyA6IDI7XG4gICAgICBjb25zdCBsaW5lRW5kID0gcmF3LmluZGV4T2YoJ1xcbicsIGkpO1xuICAgICAgY29uc3Qgb3BlbmVyTGluZUVuZCA9IGxpbmVFbmQgPT09IC0xID8gbiA6IGxpbmVFbmQ7XG4gICAgICBjb25zdCBhdHRhY2hlZCA9IHJlYWREZWxpbVdvcmQoaSArIG9wTGVuKTtcbiAgICAgIGxldCBkZWxpbSA9IGF0dGFjaGVkID09PSBudWxsID8gJycgOiBhdHRhY2hlZC5kZWxpbTtcbiAgICAgIGxldCBzYXdRdW90ZSA9IGF0dGFjaGVkID09PSBudWxsID8gZmFsc2UgOiBhdHRhY2hlZC5zYXdRdW90ZTtcbiAgICAgIGlmIChkZWxpbSA9PT0gJycgJiYgYXR0YWNoZWQgIT09IG51bGwpIHtcbiAgICAgICAgLy8gU3RhbmRhbG9uZSBvcGVyYXRvcjogdGhlIGRlbGltaXRlciBpcyB0aGUgbmV4dCB3b3JkLlxuICAgICAgICBsZXQgayA9IGF0dGFjaGVkLm5leHQ7XG4gICAgICAgIHdoaWxlIChrIDwgb3BlbmVyTGluZUVuZCAmJiAvXFxzLy50ZXN0KHJhd1trXSkpIGsgKz0gMTtcbiAgICAgICAgY29uc3Qgd29yZCA9IHJlYWREZWxpbVdvcmQoayk7XG4gICAgICAgIGlmICh3b3JkID09PSBudWxsKSBkZWxpbSA9ICcnO1xuICAgICAgICBlbHNlIHtcbiAgICAgICAgICBkZWxpbSA9IHdvcmQuZGVsaW07XG4gICAgICAgICAgc2F3UXVvdGUgPSB3b3JkLnNhd1F1b3RlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoZGVsaW0gPT09ICcnIHx8ICghc2F3UXVvdGUgJiYgIUJBUkVfREVMSU0udGVzdChkZWxpbSkpKSB7XG4gICAgICAgIC8vIE5vIGRlbGltaXRlciwgb3IgYSBiYXJlIGZvcm0gb3V0c2lkZSB0aGUgaWRlbnRpZmllciBzaGFwZSBcdTIwMTQgZmFpbFxuICAgICAgICAvLyBjbG9zZWQgYW5kIGtlZXAgc2Nhbm5pbmcgcGFzdCB0aGUgb3BlcmF0b3IuXG4gICAgICAgIGkgKz0gb3BMZW47XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHsgY21kU3RhcnQsIG9wZW5lckxpbmVFbmQsIGRlbGltLCB0YWJTdHJpcCB9O1xuICAgIH1cbiAgICBpICs9IDE7XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKlxuICogVGhlIGJvZHkgb2YgYW4gb3BlbmVyIHJ1bnMgZnJvbSBhZnRlciB0aGUgb3BlbmVyIGxpbmUncyBuZXdsaW5lIHRvIHRoZSBsaW5lXG4gKiB0aGF0IGlzIGV4YWN0bHkgdGhlIGRlbGltaXRlciAoYDw8YCksIG9yIGl0cyBsZWFkaW5nLXRhYi1zdHJpcHBlZCBmb3JtXG4gKiAoYDw8LWApLCB0cmFpbGluZyB3aGl0ZXNwYWNlIGFsbG93ZWQuIFJldHVybnMgdGhlIGNsb3NlcidzIGxpbmUgYm91bmRzLCBvclxuICogbnVsbCB3aGVuIG5vIGNsb3NlciBleGlzdHMgKGZhaWwgY2xvc2VkKS5cbiAqL1xuZnVuY3Rpb24gaGVyZWRvY0Nsb3NlcihyYXc6IHN0cmluZywgb3BlbjogSGVyZWRvY09wZW5lcik6IHsgbGluZVN0YXJ0OiBudW1iZXI7IGxpbmVFbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gIGNvbnN0IG4gPSByYXcubGVuZ3RoO1xuICBjb25zdCBib2R5U3RhcnQgPSBvcGVuLm9wZW5lckxpbmVFbmQgPCBuID8gb3Blbi5vcGVuZXJMaW5lRW5kICsgMSA6IG47XG4gIGxldCBsaW5lUG9zID0gYm9keVN0YXJ0O1xuICB3aGlsZSAobGluZVBvcyA8IG4pIHtcbiAgICBjb25zdCBubCA9IHJhdy5pbmRleE9mKCdcXG4nLCBsaW5lUG9zKTtcbiAgICBjb25zdCBsaW5lRW5kID0gbmwgPT09IC0xID8gbiA6IG5sO1xuICAgIGNvbnN0IGNhbmRpZGF0ZSA9IG9wZW4udGFiU3RyaXAgPyByYXcuc2xpY2UobGluZVBvcywgbGluZUVuZCkucmVwbGFjZSgvXlxcdCsvLCAnJykgOiByYXcuc2xpY2UobGluZVBvcywgbGluZUVuZCk7XG4gICAgaWYgKFxuICAgICAgY2FuZGlkYXRlID09PSBvcGVuLmRlbGltIHx8XG4gICAgICAoY2FuZGlkYXRlLnN0YXJ0c1dpdGgob3Blbi5kZWxpbSkgJiYgL15bIFxcdF0qJC8udGVzdChjYW5kaWRhdGUuc2xpY2Uob3Blbi5kZWxpbS5sZW5ndGgpKSlcbiAgICApIHtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogbGluZVBvcywgbGluZUVuZCB9O1xuICAgIH1cbiAgICBpZiAobmwgPT09IC0xKSByZXR1cm4gbnVsbDtcbiAgICBsaW5lUG9zID0gbmwgKyAxO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIE1hc2sgZXZlcnkgaGVyZWRvYyBvdXQgb2YgdGhlIHJhdyBjb21tYW5kIHN0cmluZywgcmV0dXJuaW5nIHRoZSBib2RpZXMgYW5kXG4gKiBvcGVuZXJzIGZvciByZS1hc3NvY2lhdGlvbiBieSBpbmRleC4gVGhlIG1hc2sgY292ZXJzXG4gKiBgW2NtZFN0YXJ0LCBjbG9zZXJMaW5lRW5kKWAgXHUyMDE0IHRoZSBvcGVuZXIgbGluZSB0aHJvdWdoIHRoZSBjbG9zZXIgbGluZSwgdGhlXG4gKiBjbG9zZXIncyBuZXdsaW5lIGV4Y2x1ZGVkIFx1MjAxNCBzbyBhIGNvbW1hbmQgam9pbmVkIGJlZm9yZSB0aGUgb3BlbmVyXG4gKiAoYGNtZDEgJiYgY2F0IDw8RU9GYCkga2VlcHMgaXRzIHN0cnVjdHVyZSwgYW5kIHRoZSBwbGFjZWhvbGRlciBzdGFuZHMgYWxvbmVcbiAqIGFzIGl0cyBvd24gc2ltcGxlIGNvbW1hbmQuIEEgaGVyZWRvYyB3aXRob3V0IGEgY2xvc2VyIGZhaWxzIGNsb3NlZDogaXRzXG4gKiBvcGVuZXIgbGluZSBzdGF5cyB1bm1hc2tlZCBhbmQgc2Nhbm5pbmcgcmVzdW1lcyBhZnRlciBpdC5cbiAqL1xuZnVuY3Rpb24gZXh0cmFjdEhlcmVkb2NXcml0ZXMocmF3OiBzdHJpbmcpOiB7IHdyaXRlczogSGVyZWRvY1dyaXRlW107IG1hc2tlZDogc3RyaW5nIH0ge1xuICBjb25zdCB3cml0ZXM6IEhlcmVkb2NXcml0ZVtdID0gW107XG4gIGxldCBtYXNrZWQgPSAnJztcbiAgbGV0IGN1cnNvciA9IDA7XG4gIGZvciAoOzspIHtcbiAgICBjb25zdCBvcGVuID0gZmluZEhlcmVkb2NPcGVuZXIocmF3LCBjdXJzb3IpO1xuICAgIGlmIChvcGVuID09PSBudWxsKSBicmVhaztcbiAgICBjb25zdCBjbG9zZSA9IGhlcmVkb2NDbG9zZXIocmF3LCBvcGVuKTtcbiAgICBpZiAoY2xvc2UgPT09IG51bGwpIHtcbiAgICAgIGN1cnNvciA9IG9wZW4ub3BlbmVyTGluZUVuZCA8IHJhdy5sZW5ndGggPyBvcGVuLm9wZW5lckxpbmVFbmQgKyAxIDogcmF3Lmxlbmd0aDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBib2R5U3RhcnQgPSBvcGVuLm9wZW5lckxpbmVFbmQgPCByYXcubGVuZ3RoID8gb3Blbi5vcGVuZXJMaW5lRW5kICsgMSA6IHJhdy5sZW5ndGg7XG4gICAgbGV0IGJvZHkgPSByYXcuc2xpY2UoYm9keVN0YXJ0LCBjbG9zZS5saW5lU3RhcnQpLnJlcGxhY2UoL1xcbiQvLCAnJyk7XG4gICAgaWYgKG9wZW4udGFiU3RyaXApIGJvZHkgPSBib2R5LnJlcGxhY2UoL15cXHQrL2dtLCAnJyk7XG4gICAgbWFza2VkICs9IHJhdy5zbGljZShjdXJzb3IsIG9wZW4uY21kU3RhcnQpO1xuICAgIG1hc2tlZCArPSBgX19oZXJlZG9jXyR7d3JpdGVzLmxlbmd0aH1fX2A7XG4gICAgd3JpdGVzLnB1c2goeyBvcGVuZXI6IHJhdy5zbGljZShvcGVuLmNtZFN0YXJ0LCBvcGVuLm9wZW5lckxpbmVFbmQpLCBib2R5IH0pO1xuICAgIGN1cnNvciA9IGNsb3NlLmxpbmVFbmQ7XG4gIH1cbiAgbWFza2VkICs9IHJhdy5zbGljZShjdXJzb3IpO1xuICByZXR1cm4geyB3cml0ZXMsIG1hc2tlZCB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFJlZGlyZWN0LXRva2VuIGFuYWx5c2lzIGFuZCB0aGUgd3JpdGUtdG91Y2ggZ3JhbW1hcnMgKHBsYW4gXHUwMEE3NS4xLCBcdTAwQTc1LjIpLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmludGVyZmFjZSBSZWRpcmVjdEluZm8ge1xuICAvKiogSU9fTlVNQkVSIGZkIChgMT5gL2AyPmApLCBvciBudWxsIHdoZW4gaW1wbGljaXQuICovXG4gIGZkOiBudW1iZXIgfCBudWxsO1xuICAvKiogVGhlIG9wZXJhdG9yLiAqL1xuICBvcDogJz4nIHwgJz4+JyB8ICcmPicgfCAnJj4+JyB8ICc+JicgfCAnPCcgfCAnPDwnIHwgJzw8LScgfCAnPDw8JztcbiAgLyoqIEF0dGFjaGVkIHRhcmdldCB0ZXh0LCBvciBudWxsIGZvciBhIHN0YW5kYWxvbmUgb3BlcmF0b3IgKHRhcmdldCA9IG5leHQgdG9rZW4pLiAqL1xuICB0YXJnZXQ6IHN0cmluZyB8IG51bGw7XG59XG5cbmNvbnN0IFJFRElSRUNUX1RPS0VOID0gL14oXFxkKikoPDw8fDw8LXwmPj58PDx8Pj58Jj58PiZ8PHw+KSguKikkLztcblxuZnVuY3Rpb24gY2xhc3NpZnlSZWRpcmVjdFRva2VuKHRleHQ6IHN0cmluZyk6IFJlZGlyZWN0SW5mbyB8IG51bGwge1xuICBjb25zdCBtID0gdGV4dC5tYXRjaChSRURJUkVDVF9UT0tFTik7XG4gIGlmIChtID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgWywgZmRUZXh0LCBvcCwgdGFyZ2V0XSA9IG07XG4gIHJldHVybiB7XG4gICAgZmQ6IGZkVGV4dCA9PT0gJycgPyBudWxsIDogTnVtYmVyLnBhcnNlSW50KGZkVGV4dCwgMTApLFxuICAgIG9wOiBvcCBhcyBSZWRpcmVjdEluZm9bJ29wJ10sXG4gICAgdGFyZ2V0OiB0YXJnZXQgPT09ICcnID8gbnVsbCA6IHRhcmdldFxuICB9O1xufVxuXG4vKipcbiAqIEEgY29udGVudC1wcm9kdWNpbmcgcmVkaXJlY3QgKHBsYW4gXHUwMEE3NS4xKTogZmQtMSBgPmAvYD4+YCAoZXhwbGljaXQgYDE+YC9gMT4+YFxuICogaW5jbHVkZWQpIGFuZCBgJj5gL2AmPj5gLiBGRC1udW1iZXJlZCAoYDI+YCksIGR1cCAoYDI+JjFgLCBgPiZmYCksXG4gKiBgJmAtbGVhZGluZy10YXJnZXQgZHVwIChgPiZgKSBhbmQgc3RkaW4gKGA8YCkgZm9ybXMgbmV2ZXIgcHJvZHVjZSBjb250ZW50LlxuICovXG5mdW5jdGlvbiBpc0NvbnRlbnRSZWRpcmVjdChyOiBSZWRpcmVjdEluZm8pOiBib29sZWFuIHtcbiAgaWYgKHIub3AgPT09ICc+JyB8fCByLm9wID09PSAnPj4nKSB7XG4gICAgaWYgKHIuZmQgIT09IG51bGwgJiYgci5mZCAhPT0gMSkgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChyLnRhcmdldD8uc3RhcnRzV2l0aCgnJicpKSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIHIub3AgPT09ICcmPicgfHwgci5vcCA9PT0gJyY+Pic7XG59XG5cbi8qKiBUaGUgYXJndiBzdHJlYW0gYW5kIHJlZGlyZWN0IGxpc3Qgb2YgYSBzaW1wbGUgY29tbWFuZCAocGxhbiBcdTAwQTc1LjEwKTogd29yZHMgbWludXMgcmVkaXJlY3QgdG9rZW5zIGFuZCB0aGVpciB0YXJnZXRzLiAqL1xuZnVuY3Rpb24gYW5hbHl6ZVRva2Vucyh0b2tlbnM6IFRva2VuW10pOiB7IGFyZ3Y6IHN0cmluZ1tdOyByZWRpcmVjdHM6IFJlZGlyZWN0SW5mb1tdIH0ge1xuICBjb25zdCBhcmd2OiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCByZWRpcmVjdHM6IFJlZGlyZWN0SW5mb1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgdG9rZW5zLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgdG9rZW4gPSB0b2tlbnNbaV07XG4gICAgaWYgKCF0b2tlbi5pc1JlZGlyZWN0KSB7XG4gICAgICBhcmd2LnB1c2godG9rZW4udGV4dCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgaW5mbyA9IGNsYXNzaWZ5UmVkaXJlY3RUb2tlbih0b2tlbi50ZXh0KTtcbiAgICBpZiAoaW5mbyA9PT0gbnVsbCkge1xuICAgICAgYXJndi5wdXNoKHRva2VuLnRleHQpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpbmZvLnRhcmdldCA9PT0gbnVsbCkge1xuICAgICAgLy8gQSBzdGFuZGFsb25lIG9wZXJhdG9yIGNvbnN1bWVzIHRoZSBuZXh0IHRva2VuIGFzIGl0cyB0YXJnZXQgKG9yXG4gICAgICAvLyBoZXJlZG9jIGRlbGltaXRlciAvIGhlcmUtc3RyaW5nIGNvbnRlbnQpIFx1MjAxNCBhdHRhY2hlZCB0byB0aGUgcmVkaXJlY3RcbiAgICAgIC8vIHNvIHRoZSB3cml0ZSBncmFtbWFycyBzZWUgaXQsIGFuZCBleGNsdWRlZCBmcm9tIGFyZ3YuXG4gICAgICBjb25zdCBuZXh0ID0gdG9rZW5zW2kgKyAxXTtcbiAgICAgIGlmIChuZXh0ICE9PSB1bmRlZmluZWQgJiYgIW5leHQuaXNSZWRpcmVjdCkge1xuICAgICAgICByZWRpcmVjdHMucHVzaCh7IC4uLmluZm8sIHRhcmdldDogbmV4dC50ZXh0IH0pO1xuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH1cbiAgICByZWRpcmVjdHMucHVzaChpbmZvKTtcbiAgfVxuICByZXR1cm4geyBhcmd2LCByZWRpcmVjdHMgfTtcbn1cblxuLyoqXG4gKiBMaXRlcmFsIGBlY2hvYC9gcHJpbnRmYCBjb250ZW50IChwbGFuIFx1MDBBNzUuMSkgZm9yIGJvZHkgdGhyZWFkaW5nOiBub1xuICogZmxhZ3MsIG5vIHNoZWxsIGV4cGFuc2lvbiwgbm8gZ2xvYnM7IGBwcmludGZgIG9ubHkgd2hlbiB0aGUgZm9ybWF0IGhhcyBub1xuICogYCVgL2JhY2tzbGFzaCBkaXJlY3RpdmVzICh0aGVuIHRoZSBmb3JtYXQgaXRzZWxmIGlzIHRoZSBsaXRlcmFsIGNvbnRlbnQpLlxuICogVGhyZWFkZWQgb24gYXBwZW5kcyBhcyB0aGUgc3VmZml4IGdhdGUncyBib2R5IGFuZCBvbiBzaW5nbGUgcGxhaW4gYD5gXG4gKiBvdmVyd3JpdGVzIChhbmQgdGVlIG9wZXJhbmRzIHdpdGggYSBvbmUtaG9wIGxpdGVyYWwgcGlwZSBzb3VyY2UpIGFzIHRoZVxuICogZXhhY3QgZ2F0ZSdzIHBvc3QtY29udGVudC5cbiAqL1xuZnVuY3Rpb24gbGl0ZXJhbENvbnRlbnQoYXJndjogc3RyaW5nW10pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICBjb25zdCBob3N0ID0gYXJndlswXTtcbiAgaWYgKGhvc3QgIT09ICdlY2hvJyAmJiBob3N0ICE9PSAncHJpbnRmJykgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3QgYXJncyA9IGFyZ3Yuc2xpY2UoMSk7XG4gIGlmIChhcmdzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgZm9yIChjb25zdCBhIG9mIGFyZ3MpIHtcbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykgfHwgaGFzU2hlbGxFeHBhbnNpb24oYSkgfHwgL1sqP10vLnRlc3QoYSkpIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgaWYgKGhvc3QgPT09ICdwcmludGYnKSB7XG4gICAgaWYgKGFyZ3MubGVuZ3RoICE9PSAxKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGZtdCA9IGFyZ3NbMF07XG4gICAgaWYgKGZtdC5pbmNsdWRlcygnJScpIHx8IGZtdC5pbmNsdWRlcygnXFxcXCcpKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIHJldHVybiBmbXQ7XG4gIH1cbiAgcmV0dXJuIGAke2FyZ3Muam9pbignICcpfVxcbmA7XG59XG5cbi8qKlxuICogUmVzb2x2ZSBhIHJlZGlyZWN0IHRhcmdldCBhZ2FpbnN0IHRoZSBjdXJyZW50IGRpcmVjdG9yeSwgZW1pdHRpbmcgdGhlXG4gKiB1bnJlc29sdmVkIHZlcmRpY3QgKHRoZSByZWFkIGlkaW9tcycgcmVhc29uKSB3aGVuIHRoZSBwYXRoIGNhcnJpZXMgYW5cbiAqIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYi4gUmV0dXJucyB0aGUgYWJzb2x1dGUgcGF0aCwgb3IgbnVsbC5cbiAqL1xuZnVuY3Rpb24gcmVzb2x2ZVRhcmdldChyZXN1bHRzOiBTcGFuTWF0Y2hbXSwgaWRpb206IElkaW9tLCB0YXJnZXQ6IHN0cmluZywgY3VycmVudERpcjogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmIChsb29rc1VucmVzb2x2YWJsZSh0YXJnZXQpKSB7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgaWRpb20sXG4gICAgICBmaWxlQXJnOiB0YXJnZXQsXG4gICAgICByZWFzb246ICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYidcbiAgICB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICByZXR1cm4gcmVzb2x2ZVBhdGgoY3VycmVudERpciwgdGFyZ2V0KTtcbn1cblxuLyoqIFRoZSBgdGVlYCBvcGVyYW5kIGdyYW1tYXI6IGFwcGVuZCBtb2RlIGFuZCBvcGVyYW5kIGxpc3Q7IHVua25vd24gb3B0aW9ucyByZXR1cm4gbnVsbCAoZmFpbCBjbG9zZWQpLiAqL1xuZnVuY3Rpb24gdGVlT3BlcmFuZFBhcnRzKGFyZ3Y6IHN0cmluZ1tdKTogeyBhcHBlbmQ6IGJvb2xlYW47IG9wZXJhbmRzOiBzdHJpbmdbXSB9IHwgbnVsbCB7XG4gIGxldCBhcHBlbmQgPSBmYWxzZTtcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcbiAgY29uc3Qgb3BlcmFuZHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgYSBvZiBhcmd2LnNsaWNlKDEpKSB7XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWEnIHx8IGEgPT09ICctLWFwcGVuZCcpIHtcbiAgICAgIGFwcGVuZCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSByZXR1cm4gbnVsbDtcbiAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICB9XG4gIHJldHVybiB7IGFwcGVuZCwgb3BlcmFuZHMgfTtcbn1cblxuLyoqXG4gKiBUaGUgYHRlZWAgb3BlcmFuZCB3cml0ZXMgKHBsYW4gXHUwMEE3NS4xKTogZWFjaCBvcGVyYW5kIGlzIGEgd2hvbGUtZmlsZVxuICogY3JlYXRlLW92ZXJ3cml0ZSAodHJ1bmNhdGluZyksIG9yIGEgd2hvbGUtZmlsZSBhcHBlbmQgdW5kZXIgYC1hYC9gLS1hcHBlbmRgLlxuICogQSBvbmUtaG9wIGxpdGVyYWwgZWNoby9wcmludGYgcGlwZSBzb3VyY2UgKGBlY2hvIHggfCB0ZWUgZmAsIGBwcmludGYgeSB8XG4gKiB0ZWUgLWEgZmAsIHBsYW4gXHUwMEE3NS4yKSB0aHJlYWRzIGFzIHRoZSB3cml0dGVuIGJvZHkgXHUyMDE0IHRoZSBleGFjdCBnYXRlJ3NcbiAqIHBvc3QtY29udGVudCBvbiB0aGUgdHJ1bmNhdGluZyB3cml0ZSwgdGhlIHN1ZmZpeCBnYXRlJ3MgYm9keSBvbiB0aGUgYXBwZW5kO1xuICogd2l0aG91dCBhIGtub3duIHNvdXJjZSBuZWl0aGVyIG9wIGNhcnJpZXMgd3JpdHRlbiBjb250ZW50LlxuICovXG5mdW5jdGlvbiBtYXRjaFRlZU9wZXJhbmRzKFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgcGlwZUVjaG9Db250ZW50OiBzdHJpbmcgfCBudWxsLFxuICBjdXJyZW50RGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCBwYXJ0cyA9IHRlZU9wZXJhbmRQYXJ0cyhhcmd2KTtcbiAgaWYgKHBhcnRzID09PSBudWxsKSByZXR1cm47XG4gIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBwYXJ0cy5vcGVyYW5kcykge1xuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgJ3JlZGlyZWN0LXdyaXRlJywgb3BlcmFuZCwgY3VycmVudERpcik7XG4gICAgaWYgKGFic29sdXRlUGF0aCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiAncmVkaXJlY3Qtd3JpdGUnLFxuICAgICAgc3BhbjogIXBhcnRzLmFwcGVuZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIG9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnLFxuICAgICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICAgICAgam9pbixcbiAgICAgICAgICAgIC4uLihwaXBlRWNob0NvbnRlbnQgIT09IG51bGwgPyB7IHdyaXR0ZW46IHBpcGVFY2hvQ29udGVudCB9IDoge30pXG4gICAgICAgICAgfVxuICAgICAgICA6IHtcbiAgICAgICAgICAgIG9wZXJhdGlvbjogJ2FwcGVuZCcsXG4gICAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgICBqb2luLFxuICAgICAgICAgICAgLi4uKHBpcGVFY2hvQ29udGVudCAhPT0gbnVsbCA/IHsgd3JpdHRlbjogcGlwZUVjaG9Db250ZW50IH0gOiB7fSlcbiAgICAgICAgICB9XG4gICAgfSk7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgcmVkaXJlY3QgZmFtaWx5IGdyYW1tYXIgKHBsYW4gXHUwMEE3NS4xKSwgcnVuIGZvciBldmVyeSBzaW1wbGUgY29tbWFuZCBhZnRlclxuICogdGhlIHJlYWQgbWF0Y2hlcnM6IGNvbnRlbnQtcHJvZHVjaW5nIHJlZGlyZWN0cyBvbiBgZWNob2AvYHByaW50ZmAvYHRlZWBcbiAqIHdyaXRlIHdob2xlLWZpbGU7IGEgYmFyZSBgPiBmYCAvIGA6ID4gZmAgdHJ1bmNhdGVzICh0aGUgbWFpbiB3YWxrIGhhbmRzXG4gKiBhcmd2LWVtcHR5IGNvbW1hbmRzIGRpcmVjdGx5IGhlcmUpOyBgPj5gLW9ubHkgdHJ1bmNhdGlvbiBmb3JtcyBhcHBlbmRcbiAqIG5vdGhpbmcgYW5kIHRvdWNoIG5vdGhpbmcuIEFueSBvdGhlciBob3N0IHdpdGggYSBjb250ZW50IHJlZGlyZWN0IChgbHMgPiBmYCxcbiAqIGBweXRob24zIHgucHkgPiBvdXRgLCBgY2F0IGYgPiBnYCkgZ2V0cyBubyB3cml0ZSB0b3VjaCBcdTIwMTQgdGhlIHJlZGlyZWN0IGlzXG4gKiByZWFsLCBidXQgaXRzIGNvbnRlbnQgaXMgZHluYW1pYyBhbmQgb3V0IG9mIHNjb3BlLlxuICpcbiAqIEJvZHkgdGhyZWFkaW5nOiBleGFjdGx5IG9uZSBwbGFpbiBgPj5gIChvciBgMT4+YCkgY29udGVudCByZWRpcmVjdCBvbiBhXG4gKiBmdWxseSBsaXRlcmFsIGBlY2hvYC9gcHJpbnRmYCB0aHJlYWRzIHRoZSB3cml0dGVuIGJvZHkgKHRoZSBzdWZmaXggZ2F0ZSksXG4gKiBhbmQgZXhhY3RseSBvbmUgcGxhaW4gYD5gIChvciBgMT5gKSBjb250ZW50IHJlZGlyZWN0IG9uIHRoZSBzYW1lIGxpdGVyYWxzXG4gKiB0aHJlYWRzIGl0IGFzIHRoZSBleGFjdCBnYXRlJ3MgcG9zdC1jb250ZW50IChwbGFuIFx1MDBBNzMgc3RlcCAxYiBcdTIwMTQgdGhlXG4gKiBjb250ZW50IGxheWVyIGlzIHdoYXQgc3VwcHJlc3NlcyBgZWNobyBoaSA+IHJlYWQtb25seS1maWxlYCwgd2hlcmUgdGhlXG4gKiBmaWxlIHN0YXlzIHByZXNlbnQgYnV0IHVuY2hhbmdlZCkuIGAmPmAvYCY+PmAsIG11bHRpLXJlZGlyZWN0IGNvbW1hbmRzLFxuICogYW5kIGB0ZWVgJ3Mgb3duIHJlZGlyZWN0cyBuZXZlciB0aHJlYWQuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoUmVkaXJlY3RGYW1pbHkoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICByZWRpcmVjdHM6IFJlZGlyZWN0SW5mb1tdLFxuICBwaXBlRWNob0NvbnRlbnQ6IHN0cmluZyB8IG51bGwsXG4gIGN1cnJlbnREaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IGNvbnRlbnRSZWRpcmVjdHMgPSByZWRpcmVjdHMuZmlsdGVyKGlzQ29udGVudFJlZGlyZWN0KTtcbiAgY29uc3QgaG9zdCA9IGFyZ3ZbMF07XG4gIGlmIChjb250ZW50UmVkaXJlY3RzLmxlbmd0aCA9PT0gMCkge1xuICAgIGlmIChob3N0ID09PSAndGVlJykgbWF0Y2hUZWVPcGVyYW5kcyhhcmd2LCBwaXBlRWNob0NvbnRlbnQsIGN1cnJlbnREaXIsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiwgcmVzdWx0cyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChob3N0ID09PSB1bmRlZmluZWQgfHwgaG9zdCA9PT0gJzonKSB7XG4gICAgLy8gQmFyZSBgPiBmYCBhbmQgYDogPiBmYCB0cnVuY2F0ZTsgYD4+YC9gJj4+YCBhcHBlbmQgbm90aGluZyBcdTIxOTIgbm8gdG91Y2guXG4gICAgZm9yIChjb25zdCByIG9mIGNvbnRlbnRSZWRpcmVjdHMpIHtcbiAgICAgIGlmIChyLm9wID09PSAnPj4nIHx8IHIub3AgPT09ICcmPj4nIHx8IHIudGFyZ2V0ID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgJ3RydW5jYXRlLXdyaXRlJywgci50YXJnZXQsIGN1cnJlbnREaXIpO1xuICAgICAgaWYgKGFic29sdXRlUGF0aCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiAndHJ1bmNhdGUtd3JpdGUnLFxuICAgICAgICBzcGFuOiB7IG9wZXJhdGlvbjogJ3RydW5jYXRlJywgYWJzb2x1dGVQYXRoLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuICBpZiAoaG9zdCAhPT0gJ2VjaG8nICYmIGhvc3QgIT09ICdwcmludGYnICYmIGhvc3QgIT09ICd0ZWUnKSByZXR1cm47XG4gIGNvbnN0IHNpbmdsZVBsYWluQXBwZW5kID0gY29udGVudFJlZGlyZWN0cy5sZW5ndGggPT09IDEgJiYgY29udGVudFJlZGlyZWN0c1swXS5vcCA9PT0gJz4+JztcbiAgY29uc3Qgc2luZ2xlUGxhaW5PdmVyd3JpdGUgPSBjb250ZW50UmVkaXJlY3RzLmxlbmd0aCA9PT0gMSAmJiBjb250ZW50UmVkaXJlY3RzWzBdLm9wID09PSAnPic7XG4gIGNvbnN0IHRocmVhZGVkQXBwZW5kID0gc2luZ2xlUGxhaW5BcHBlbmQgJiYgaG9zdCAhPT0gJ3RlZScgPyBsaXRlcmFsQ29udGVudChhcmd2KSA6IHVuZGVmaW5lZDtcbiAgY29uc3QgdGhyZWFkZWRPdmVyd3JpdGUgPSBzaW5nbGVQbGFpbk92ZXJ3cml0ZSAmJiBob3N0ICE9PSAndGVlJyA/IGxpdGVyYWxDb250ZW50KGFyZ3YpIDogdW5kZWZpbmVkO1xuICBmb3IgKGNvbnN0IHIgb2YgY29udGVudFJlZGlyZWN0cykge1xuICAgIGlmIChyLnRhcmdldCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVRhcmdldChyZXN1bHRzLCAncmVkaXJlY3Qtd3JpdGUnLCByLnRhcmdldCwgY3VycmVudERpcik7XG4gICAgaWYgKGFic29sdXRlUGF0aCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgaWYgKHIub3AgPT09ICc+PicgfHwgci5vcCA9PT0gJyY+PicpIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgaWRpb206ICdyZWRpcmVjdC13cml0ZScsXG4gICAgICAgIHNwYW46IHtcbiAgICAgICAgICBvcGVyYXRpb246ICdhcHBlbmQnLFxuICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgam9pbixcbiAgICAgICAgICAuLi4odGhyZWFkZWRBcHBlbmQgIT09IHVuZGVmaW5lZCA/IHsgd3JpdHRlbjogdGhyZWFkZWRBcHBlbmQgfSA6IHt9KVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogJ3JlZGlyZWN0LXdyaXRlJyxcbiAgICAgICAgc3Bhbjoge1xuICAgICAgICAgIG9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnLFxuICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgam9pbixcbiAgICAgICAgICAuLi4odGhyZWFkZWRPdmVyd3JpdGUgIT09IHVuZGVmaW5lZCA/IHsgd3JpdHRlbjogdGhyZWFkZWRPdmVyd3JpdGUgfSA6IHt9KVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH1cbiAgaWYgKGhvc3QgPT09ICd0ZWUnKSBtYXRjaFRlZU9wZXJhbmRzKGFyZ3YsIHBpcGVFY2hvQ29udGVudCwgY3VycmVudERpciwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luLCByZXN1bHRzKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUaGUgZmlsZS1tdXRhdGlvbiBmYW1pbHkgZ3JhbW1hcnMgKHBsYW4gXHUwMEE3NS4zXHUyMDEzXHUwMEE3NS43KTogY3AvaW5zdGFsbC9tdi9naXQgbXYsXG4vLyBybS9naXQgcm0vdHJ1bmNhdGUsIHNlZCAtaSBpbi1wbGFjZSBlZGl0cywgYW5kIHBhdGNoL2dpdCBhcHBseS4gVGhleSBzaGFyZVxuLy8gdGhlIFx1MDBBNzUgZmFpbC1jbG9zZWQgcnVsZXM6IGxlYWRpbmcgZW52IGFzc2lnbm1lbnRzIChzdHJpcHBlZCBieSB0aGUgd2Fsaylcbi8vIGFuZCBvbmUgYGNvbW1hbmRgL2BlbnZgIHdyYXBwZXIgYXJlIHNraXBwZWQgKG1lY2hhbmljYWxseSBjZXJ0YWluKTsgYW55XG4vLyBvdGhlciB3cmFwcGVyIGlzIHVucmVzb2x2ZWQ7IGEgbGVhZGluZy1gLWAgdG9rZW4gdGhhdCBpcyBub3QgYSBrbm93biBvcHRpb25cbi8vIGlzIHRyZWF0ZWQgYXMgYW4gb3B0aW9uOyBgLS1gIG1ha2VzIHRoZSByZXN0IG9wZXJhbmRzOyBnbG9iYmVkIG9yIHZhcmlhYmxlXG4vLyBwYXRocyBhcmUgdW5yZXNvbHZlZDsgZGlyZWN0b3J5LXNoYXBlZCBzb3VyY2Ugb3BlcmFuZHMgZmFpbCBjbG9zZWQuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFdyYXBwZXIgd29yZHMgdGhhdCBvYnNjdXJlIHRoZSB3cmFwcGVkIGNvbW1hbmQncyBhcmd2IChwbGFuIFx1MDBBNzUpOiBhIGZhbWlseSBjb21tYW5kIGJlaGluZCBvbmUgaXMgdW5yZXNvbHZlZCwgbmV2ZXIgZ3Vlc3NlZC4gKi9cbmNvbnN0IEZPUkVJR05fV1JBUFBFUlMgPSBuZXcgU2V0KFsnc3VkbycsICd4YXJncycsICdub2h1cCcsICd0aW1lJywgJ25pY2UnLCAnZG9hcyddKTtcblxuLyoqIFN0cmlwIGF0IG1vc3Qgb25lIGBjb21tYW5kYC9gZW52YCB3cmFwcGVyIFx1MjAxNCBtZWNoYW5pY2FsbHkgdHJhbnNwYXJlbnQgKHBsYW4gXHUwMEE3NSkuICovXG5mdW5jdGlvbiBzdHJpcFRyYW5zcGFyZW50V3JhcHBlcihhcmd2OiBzdHJpbmdbXSk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIGFyZ3ZbMF0gPT09ICdjb21tYW5kJyB8fCBhcmd2WzBdID09PSAnZW52JyA/IGFyZ3Yuc2xpY2UoMSkgOiBhcmd2O1xufVxuXG5mdW5jdGlvbiBwdXNoVW5yZXNvbHZlZChyZXN1bHRzOiBTcGFuTWF0Y2hbXSwgaWRpb206IElkaW9tLCBmaWxlQXJnOiBzdHJpbmcsIHJlYXNvbjogc3RyaW5nKTogdm9pZCB7XG4gIHJlc3VsdHMucHVzaCh7IHN0YXR1czogJ3VucmVzb2x2ZWQnLCBpZGlvbSwgZmlsZUFyZywgcmVhc29uIH0pO1xufVxuXG4vKiogV2hldGhlciB0aGUgcGF0aCBpcyBhbiBleGlzdGluZyBkaXJlY3RvcnkgKHRoZSBkZXN0LWRpciBkZWNpc2lvbiwgcGxhbiBcdTAwQTc1LjMvXHUwMEE3NS40OyBmcyBzdGF0IGxpa2UgdGhlIHJlYWQgaWRpb21zJyBsaW5lIGNvdW50cykuICovXG5mdW5jdGlvbiBpc0V4aXN0aW5nRGlyZWN0b3J5KGFic29sdXRlUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHN0YXRTeW5jKGFic29sdXRlUGF0aCkuaXNEaXJlY3RvcnkoKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKlxuICogVGhlIHNoYXJlZCBjcC9pbnN0YWxsL212IG9wZXJhbmQgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjMvXHUwMEE3NS40KTogcGVyLWZhbWlseSBvcHRpb25cbiAqIHNldHMgYW5kIHRvdWNoIG9wZXJhdGlvbnMgYmVoaW5kIG9uZSBwYXJzZXIuXG4gKi9cbmludGVyZmFjZSBDb3B5TW92ZVNwZWMge1xuICBpZGlvbTogJ2NwLXdyaXRlJyB8ICdpbnN0YWxsLXdyaXRlJyB8ICdtdi13cml0ZSc7XG4gIC8qKiBLbm93biBuby12YWx1ZSBmbGFncyAoY29uc3VtZWQsIG5ldmVyIG9wZXJhbmRzKS4gKi9cbiAgbm9WYWx1ZTogUmVhZG9ubHlTZXQ8c3RyaW5nPjtcbiAgLyoqIEtub3duIHZhbHVlLXRha2luZyBmbGFncyAodGhlIG5leHQgd29yZCBpcyB0aGUgdmFsdWUgXHUyMDE0IGAtdCBESVJgLCBvciBhbiBpbnN0YWxsIG1vZGUvb3duZXIvZ3JvdXApLiAqL1xuICB2YWx1ZVRha2luZzogUmVhZG9ubHlTZXQ8c3RyaW5nPjtcbiAgLyoqIEZsYWdzIHRoYXQgZmFpbCB0aGUgd2hvbGUgY29tbWFuZCBjbG9zZWQgKGBjcCAtYmAvYC0tYmFja3VwYCwgYGluc3RhbGwgLWRgLCBnaXQgbXYgZHJ5LXJ1biBgLW5gL2AtLWRyeS1ydW5gKS4gKi9cbiAgZXhjbHVkZWQ6IFJlYWRvbmx5U2V0PHN0cmluZz47XG4gIC8qKiBUaGUgcGVyLXNvdXJjZSB0b3VjaDogY3AvaW5zdGFsbCByZWFkIHRoZWlyIHNvdXJjZXM7IG12IGRlbGV0ZXMgdGhlbS4gKi9cbiAgc291cmNlT3BlcmF0aW9uOiAncmVhZCcgfCAnZGVsZXRlJztcbiAgLyoqIFRoZSBwZXItZGVzdCB0b3VjaDogY3AvaW5zdGFsbCBvdmVyd3JpdGU7IG12IHJlbmFtZS1jb3BpZXMuICovXG4gIGRlc3RPcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJyB8ICdyZW5hbWUtY29weSc7XG59XG5cbmNvbnN0IENQX1NQRUM6IENvcHlNb3ZlU3BlYyA9IHtcbiAgaWRpb206ICdjcC13cml0ZScsXG4gIG5vVmFsdWU6IG5ldyBTZXQoWyctcicsICctUicsICctcCcsICctZicsICctdicsICctbicsICctaScsICctdScsICctYScsICctZCcsICctTCcsICctUCddKSxcbiAgdmFsdWVUYWtpbmc6IG5ldyBTZXQoWyctdCcsICctLXRhcmdldC1kaXJlY3RvcnknXSksXG4gIGV4Y2x1ZGVkOiBuZXcgU2V0KFsnLWInLCAnLS1iYWNrdXAnXSksXG4gIHNvdXJjZU9wZXJhdGlvbjogJ3JlYWQnLFxuICBkZXN0T3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZSdcbn07XG5cbmNvbnN0IElOU1RBTExfU1BFQzogQ29weU1vdmVTcGVjID0ge1xuICBpZGlvbTogJ2luc3RhbGwtd3JpdGUnLFxuICBub1ZhbHVlOiBuZXcgU2V0KFsnLUQnLCAnLXMnLCAnLXYnXSksXG4gIHZhbHVlVGFraW5nOiBuZXcgU2V0KFsnLXQnLCAnLS10YXJnZXQtZGlyZWN0b3J5JywgJy1tJywgJy1vJywgJy1nJ10pLFxuICBleGNsdWRlZDogbmV3IFNldChbJy1kJ10pLFxuICBzb3VyY2VPcGVyYXRpb246ICdyZWFkJyxcbiAgZGVzdE9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnXG59O1xuXG5jb25zdCBNVl9TUEVDOiBDb3B5TW92ZVNwZWMgPSB7XG4gIGlkaW9tOiAnbXYtd3JpdGUnLFxuICBub1ZhbHVlOiBuZXcgU2V0KFsnLWYnLCAnLWknLCAnLW4nLCAnLXYnLCAnLXUnXSksXG4gIHZhbHVlVGFraW5nOiBuZXcgU2V0KFsnLXQnLCAnLS10YXJnZXQtZGlyZWN0b3J5J10pLFxuICBleGNsdWRlZDogbmV3IFNldCgpLFxuICBzb3VyY2VPcGVyYXRpb246ICdkZWxldGUnLFxuICBkZXN0T3BlcmF0aW9uOiAncmVuYW1lLWNvcHknXG59O1xuXG5jb25zdCBHSVRfTVZfU1BFQzogQ29weU1vdmVTcGVjID0ge1xuICBpZGlvbTogJ212LXdyaXRlJyxcbiAgbm9WYWx1ZTogbmV3IFNldChbJy1mJywgJy1rJywgJy12J10pLFxuICB2YWx1ZVRha2luZzogbmV3IFNldCgpLFxuICAvLyBgZ2l0IG12IC1uYC9gLS1kcnktcnVuYCBpcyBhIHRyaWFsIHJ1biB0aGF0IG1vdmVzIG5vdGhpbmcgKHRoZSBzYW1lXG4gIC8vIHJlYWQtb25seSBjbGFzcyBhcyBgcGF0Y2ggLS1kcnktcnVuYCwgcGxhbiBcdTAwQTc1LjcpIFx1MjAxNCBmYWlsIGNsb3NlZC5cbiAgZXhjbHVkZWQ6IG5ldyBTZXQoWyctbicsICctLWRyeS1ydW4nXSksXG4gIHNvdXJjZU9wZXJhdGlvbjogJ2RlbGV0ZScsXG4gIGRlc3RPcGVyYXRpb246ICdyZW5hbWUtY29weSdcbn07XG5cbmludGVyZmFjZSBDb3B5TW92ZVBhcnRzIHtcbiAgLyoqIE9wZXJhbmRzIGluIG9yZGVyIChzb3VyY2VzOyBpbiB0aGUgbm9uLWAtdGAgZm9ybSB0aGUgbGFzdCBpcyB0aGUgZGVzdCkuICovXG4gIG9wZXJhbmRzOiBzdHJpbmdbXTtcbiAgLyoqIFRoZSBgLXRgL2AtLXRhcmdldC1kaXJlY3RvcnlgIHZhbHVlLCBvciBudWxsLiAqL1xuICB0YXJnZXREaXI6IHN0cmluZyB8IG51bGw7XG59XG5cbi8qKlxuICogUGFyc2UgdGhlIG9wZXJhbmRzIG9mIGEgY3AvaW5zdGFsbC9tdiBjb21tYW5kOiBrbm93biBvcHRpb25zIGFyZSBjb25zdW1lZCxcbiAqIGAtLWAgbWFrZXMgdGhlIHJlc3Qgb3BlcmFuZHMsIGFuZCBgLXRgL2AtLXRhcmdldC1kaXJlY3RvcnlbPURJUl1gIGlzXG4gKiB2YWx1ZS10YWtpbmcgXHUyMDE0IHRoZSBuZXh0IHdvcmQgaXMgdGhlIHRhcmdldCBkaXJlY3RvcnksIG5ldmVyIGEgc291cmNlLiBBXG4gKiBsZWFkaW5nLWAtYCB0b2tlbiB0aGF0IGlzIG5vdCBhIGtub3duIG9wdGlvbiBpcyB0cmVhdGVkIGFzIGFuIG9wdGlvbiAobm9cbiAqIHRvdWNoKS4gUmV0dXJucyBudWxsIHdoZW4gYSBmYWlsLWNsb3NlZCBvcHRpb24gaXMgcHJlc2VudCBvciBhIHZhbHVlLXRha2luZ1xuICogZmxhZyBpcyBsZWZ0IHZhbHVlbGVzcy5cbiAqL1xuZnVuY3Rpb24gY29weU1vdmVQYXJ0cyhhcmdzOiBzdHJpbmdbXSwgc3BlYzogQ29weU1vdmVTcGVjKTogQ29weU1vdmVQYXJ0cyB8IG51bGwge1xuICBjb25zdCBvcGVyYW5kczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IHRhcmdldERpcjogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCBpID0gMDtcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcbiAgd2hpbGUgKGkgPCBhcmdzLmxlbmd0aCkge1xuICAgIGNvbnN0IGEgPSBhcmdzW2ldO1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy10JyB8fCBhID09PSAnLS10YXJnZXQtZGlyZWN0b3J5Jykge1xuICAgICAgY29uc3QgdiA9IGFyZ3NbaSArIDFdO1xuICAgICAgaWYgKHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGw7XG4gICAgICB0YXJnZXREaXIgPSB2O1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0tdGFyZ2V0LWRpcmVjdG9yeT0nKSkge1xuICAgICAgdGFyZ2V0RGlyID0gYS5zbGljZSgnLS10YXJnZXQtZGlyZWN0b3J5PScubGVuZ3RoKTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoc3BlYy5leGNsdWRlZC5oYXMoYSkpIHJldHVybiBudWxsO1xuICAgIGlmIChzcGVjLnZhbHVlVGFraW5nLmhhcyhhKSkge1xuICAgICAgaWYgKGFyZ3NbaSArIDFdID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChzcGVjLm5vVmFsdWUuaGFzKGEpKSB7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICBpICs9IDE7XG4gIH1cbiAgcmV0dXJuIHsgb3BlcmFuZHMsIHRhcmdldERpciB9O1xufVxuXG4vKipcbiAqIFRoZSBwZXItc291cmNlIHRvdWNoIG9mIGEgY3AvaW5zdGFsbC9tdiBjb21tYW5kLiBjcC9pbnN0YWxsIHNvdXJjZXMgYXJlXG4gKiB3aG9sZS1maWxlIHJlYWRzIHJlc29sdmVkIGFnYWluc3QgZnMgbGlrZSB0aGUgcmVhZCBpZGlvbXM7IGEgc291cmNlIHdob3NlXG4gKiBsaW5lIGNvdW50IGNhbm5vdCBiZSByZWFkIGF0IHBhcnNlIHRpbWUgKG1pc3Npbmcgb3IgdW5yZWFkYWJsZSBcdTIwMTQgdGhlIHBhcnNlXG4gKiBydW5zIHBvc3QtY29tbWFuZCwgc28gYSBzb3VyY2UgdGhlIGNvbXBvdW5kJ3Mgb3duIGVhcmxpZXIgYHJtYCBkZWxldGVkIGlzXG4gKiBleGFjdGx5IHRoaXMpIHN0aWxsIHJlc29sdmVzIGFzIGEgcmFuZ2UtbGVzcyB3aG9sZS1maWxlIHJlYWQ6IHRoZSBkcml2ZXJcbiAqIHBhaXJzIHRoZSBkZXN0aW5hdGlvbiBhZ2FpbnN0IGl0LCBzbyB0aGUgYWJzZW50LXNvdXJjZSBydWxlIChwbGFuIFx1MDBBNzMgc3RlcFxuICogMWIpIGFuZCB0aGUgcmVhZCdzIHBvc3QtY29tbWFuZCBleGlzdGVuY2UgZ2F0ZSBhcHBseSBcdTIwMTQgYW4gdW5leHBsYWluZWRcbiAqIGFic2VuY2UgZmFpbHMgdGhlIGNvcHkgZGVjaXNpdmVseSBhbmQgYSBwaGFudG9tIHNvdXJjZSBuZXZlciBmaXJlcyB0aGVcbiAqIGRlc3QuIFRoZSBtdiBzb3VyY2UgaXMgYSBkZWxldGUuXG4gKi9cbmZ1bmN0aW9uIGVtaXRTb3VyY2VTcGFuKFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXSxcbiAgc3BlYzogQ29weU1vdmVTcGVjLFxuICBhYnNvbHV0ZVBhdGg6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddXG4pOiB2b2lkIHtcbiAgaWYgKHNwZWMuc291cmNlT3BlcmF0aW9uID09PSAnZGVsZXRlJykge1xuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogc3BlYy5pZGlvbSxcbiAgICAgIHNwYW46IHsgb3BlcmF0aW9uOiAnZGVsZXRlJywgYWJzb2x1dGVQYXRoLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgIH0pO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCByYW5nZSA9IHJlc29sdmVTcGVjKHsga2luZDogJ3RvRW9mJywgc3RhcnQ6IDEgfSwgKCkgPT4gY291bnRGaWxlTGluZXMoYWJzb2x1dGVQYXRoKSk7XG4gIHJlc3VsdHMucHVzaCh7XG4gICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgIGlkaW9tOiBzcGVjLmlkaW9tLFxuICAgIHNwYW46XG4gICAgICByYW5nZSA9PT0gbnVsbFxuICAgICAgICA/IHsgb3BlcmF0aW9uOiAncmVhZCcsIGFic29sdXRlUGF0aCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICAgICAgOiB7XG4gICAgICAgICAgICBvcGVyYXRpb246ICdyZWFkJyxcbiAgICAgICAgICAgIGxpbmVTdGFydDogcmFuZ2UubGluZVN0YXJ0LFxuICAgICAgICAgICAgbGluZUVuZDogcmFuZ2UubGluZUVuZCxcbiAgICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICAgIGpvaW5cbiAgICAgICAgICB9XG4gIH0pO1xufVxuXG4vKipcbiAqIFRoZSBjcC9pbnN0YWxsL212IGZhbWlseSAocGxhbiBcdTAwQTc1LjMvXHUwMEE3NS40KTogb3BlcmFuZHMgcmVzb2x2ZSB0byBzb3VyY2UvZGVzdFxuICogcGFpcnMgXHUyMDE0IGVhY2ggc291cmNlIGlzIGEgcmVhZCAoY3AvaW5zdGFsbCkgb3IgZGVsZXRlIChtdiksIGVhY2ggZGVzdCBhXG4gKiBjcmVhdGUtb3ZlcndyaXRlIChjcC9pbnN0YWxsKSBvciByZW5hbWUtY29weSAobXYpLCBzb3VyY2VzIGJlZm9yZSBkZXN0cyBpblxuICogZGVjbGFyYXRpb24gb3JkZXIuIEEgZGVzdCB0aGF0IGVuZHMgaW4gYC9gIG9yIHN0YXRzIGFzIGFuIGV4aXN0aW5nIGRpcmVjdG9yeVxuICogbWFwcyB0byBgZGlyL2Jhc2VuYW1lKHNvdXJjZSlgIHBlciBzb3VyY2U7IGAtdCBESVJgL2AtLXRhcmdldC1kaXJlY3Rvcnk9RElSYFxuICogbWFwcyB0aGUgc2FtZSB3YXkgYW5kIGlzIHVucmVzb2x2ZWQgd2hlbiBpdHMgdmFsdWUgaXMgbm90IGRpcmVjdG9yeS1zaGFwZWQuXG4gKiBNdWx0aS1zb3VyY2UgY29tbWFuZHMgbmVlZCBhIGRpcmVjdG9yeSBkZXN0OyBhIGRpcmVjdG9yeS1zaGFwZWQgb3JcbiAqIGdsb2JiZWQvdmFyaWFibGUgc291cmNlLCBhIGdsb2JiZWQvdmFyaWFibGUgZGVzdCwgb3IgYSBmYWlsLWNsb3NlZCBvcHRpb25cbiAqIChgY3AgLWJgLCBgaW5zdGFsbCAtZGAsIGdpdCBtdiBgLW5gKSBlbWl0cyBubyB0b3VjaGVzLlxuICovXG5mdW5jdGlvbiBtYXRjaENvcHlNb3ZlRmFtaWx5KFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgZGlyRm9yUmVzb2x1dGlvbjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcmVzdCA9IHN0cmlwVHJhbnNwYXJlbnRXcmFwcGVyKGFyZ3YpO1xuICBpZiAocmVzdC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgY29uc3QgY29tbWFuZCA9IHJlc3RbMF07XG4gIGxldCBzcGVjOiBDb3B5TW92ZVNwZWMgfCBudWxsID0gbnVsbDtcbiAgbGV0IGFyZ3M6IHN0cmluZ1tdID0gW107XG4gIGxldCBkaXIgPSBkaXJGb3JSZXNvbHV0aW9uO1xuICBpZiAoY29tbWFuZCA9PT0gJ2NwJyB8fCBjb21tYW5kID09PSAnaW5zdGFsbCcgfHwgY29tbWFuZCA9PT0gJ212Jykge1xuICAgIHNwZWMgPSBjb21tYW5kID09PSAnY3AnID8gQ1BfU1BFQyA6IGNvbW1hbmQgPT09ICdpbnN0YWxsJyA/IElOU1RBTExfU1BFQyA6IE1WX1NQRUM7XG4gICAgYXJncyA9IHJlc3Quc2xpY2UoMSk7XG4gIH0gZWxzZSBpZiAoY29tbWFuZCA9PT0gJ2dpdCcpIHtcbiAgICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChyZXN0LnNsaWNlKDEpKTtcbiAgICBpZiAoc3ViICE9PSBudWxsICYmIHN1Yi5zdWJjb21tYW5kID09PSAnbXYnKSB7XG4gICAgICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUpIHtcbiAgICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ212LXdyaXRlJywgJ212JywgJ2dpdCAtQyB0YXJnZXQgY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZScpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBzcGVjID0gR0lUX01WX1NQRUM7XG4gICAgICBhcmdzID0gcmVzdC5zbGljZSgxKS5zbGljZShzdWIuc3ViSWR4ICsgMSk7XG4gICAgICBkaXIgPSBzdWIuY0RpciA/PyBkaXJGb3JSZXNvbHV0aW9uO1xuICAgIH1cbiAgfSBlbHNlIGlmIChGT1JFSUdOX1dSQVBQRVJTLmhhcyhjb21tYW5kKSkge1xuICAgIC8vIEEgd3JhcHBlciBvYnNjdXJlcyB0aGUgd3JhcHBlZCBhcmd2IFx1MjAxNCBmYWlsIGNsb3NlZCByYXRoZXIgdGhhbiBtaXMtcGFyc2UuXG4gICAgY29uc3Qgd3JhcHBlZCA9IHJlc3RbMV07XG4gICAgY29uc3Qgd3JhcHBlZFNwZWMgPVxuICAgICAgd3JhcHBlZCA9PT0gJ2NwJyA/IENQX1NQRUMgOiB3cmFwcGVkID09PSAnaW5zdGFsbCcgPyBJTlNUQUxMX1NQRUMgOiB3cmFwcGVkID09PSAnbXYnID8gTVZfU1BFQyA6IG51bGw7XG4gICAgaWYgKHdyYXBwZWRTcGVjICE9PSBudWxsKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCB3cmFwcGVkU3BlYy5pZGlvbSwgd3JhcHBlZCwgYHRoZSAke2NvbW1hbmR9IHdyYXBwZXIgb2JzY3VyZXMgdGhlICR7d3JhcHBlZH0gYXJndmApO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKHNwZWMgPT09IG51bGwpIHJldHVybjtcblxuICBjb25zdCBwYXJ0cyA9IGNvcHlNb3ZlUGFydHMoYXJncywgc3BlYyk7XG4gIGlmIChwYXJ0cyA9PT0gbnVsbCB8fCBwYXJ0cy5vcGVyYW5kcy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAvLyBSZXNvbHZlIGV2ZXJ5IHNvdXJjZSBiZWZvcmUgZW1pdHRpbmcgYW55dGhpbmc6IGEgZGlyZWN0b3J5LXNoYXBlZCxcbiAgLy8gZ2xvYmJlZCwgb3IgdmFyaWFibGUgc291cmNlIGZhaWxzIHRoZSB3aG9sZSBjb21tYW5kIGNsb3NlZCAodGhlIGRlc3RcbiAgLy8gbWFwcGluZyBpcyBwZXItc291cmNlLCBzbyBhbiB1bmtub3dhYmxlIHNvdXJjZSBtYWtlcyB0aGUgZGVzdHMgdW5rbm93YWJsZSkuXG4gIGNvbnN0IHNvdXJjZVBhdGhzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IHNvdXJjZSBvZiBwYXJ0cy5vcGVyYW5kcy5zbGljZSgwLCBwYXJ0cy50YXJnZXREaXIgPT09IG51bGwgPyAtMSA6IHVuZGVmaW5lZCkpIHtcbiAgICBpZiAoc291cmNlLmVuZHNXaXRoKCcvJykpIHJldHVybjtcbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlVGFyZ2V0KHJlc3VsdHMsIHNwZWMuaWRpb20sIHNvdXJjZSwgZGlyKTtcbiAgICBpZiAoYWJzb2x1dGVQYXRoID09PSBudWxsKSByZXR1cm47XG4gICAgaWYgKGlzRXhpc3RpbmdEaXJlY3RvcnkoYWJzb2x1dGVQYXRoKSkgcmV0dXJuO1xuICAgIHNvdXJjZVBhdGhzLnB1c2goYWJzb2x1dGVQYXRoKTtcbiAgfVxuICBpZiAoc291cmNlUGF0aHMubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgbGV0IGRlc3RQYXRoczogc3RyaW5nW107XG4gIGlmIChwYXJ0cy50YXJnZXREaXIgIT09IG51bGwpIHtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUocGFydHMudGFyZ2V0RGlyKSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgc3BlYy5pZGlvbSwgcGFydHMudGFyZ2V0RGlyLCAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKCFwYXJ0cy50YXJnZXREaXIuZW5kc1dpdGgoJy8nKSAmJiAhaXNFeGlzdGluZ0RpcmVjdG9yeShyZXNvbHZlUGF0aChkaXIsIHBhcnRzLnRhcmdldERpcikpKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCBzcGVjLmlkaW9tLCBwYXJ0cy50YXJnZXREaXIsICd0aGUgLXQgdGFyZ2V0IGlzIG5vdCBhbiBleGlzdGluZyBkaXJlY3RvcnknKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgdGFyZ2V0QWJzID0gcmVzb2x2ZVBhdGgoZGlyLCBwYXJ0cy50YXJnZXREaXIpO1xuICAgIGRlc3RQYXRocyA9IHNvdXJjZVBhdGhzLm1hcCgocCkgPT4gam9pblBhdGgodGFyZ2V0QWJzLCBiYXNlbmFtZShwKSkpO1xuICB9IGVsc2Uge1xuICAgIGNvbnN0IGRlc3QgPSBwYXJ0cy5vcGVyYW5kc1twYXJ0cy5vcGVyYW5kcy5sZW5ndGggLSAxXTtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUoZGVzdCkpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsIHNwZWMuaWRpb20sIGRlc3QsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBkZXN0QWJzID0gcmVzb2x2ZVBhdGgoZGlyLCBkZXN0KTtcbiAgICBjb25zdCBkZXN0SXNEaXIgPSBkZXN0LmVuZHNXaXRoKCcvJykgfHwgaXNFeGlzdGluZ0RpcmVjdG9yeShkZXN0QWJzKTtcbiAgICBpZiAoc291cmNlUGF0aHMubGVuZ3RoID4gMSAmJiAhZGVzdElzRGlyKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCBzcGVjLmlkaW9tLCBkZXN0LCAnYSBtdWx0aS1zb3VyY2UgY29weS9tb3ZlIG5lZWRzIGEgZGlyZWN0b3J5IGRlc3RpbmF0aW9uJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGRlc3RQYXRocyA9IGRlc3RJc0RpciA/IHNvdXJjZVBhdGhzLm1hcCgocCkgPT4gam9pblBhdGgoZGVzdEFicywgYmFzZW5hbWUocCkpKSA6IFtkZXN0QWJzXTtcbiAgfVxuXG4gIGZvciAobGV0IGsgPSAwOyBrIDwgc291cmNlUGF0aHMubGVuZ3RoOyBrKyspIHtcbiAgICBlbWl0U291cmNlU3BhbihyZXN1bHRzLCBzcGVjLCBzb3VyY2VQYXRoc1trXSwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luKTtcbiAgfVxuICBmb3IgKGxldCBrID0gMDsgayA8IHNvdXJjZVBhdGhzLmxlbmd0aDsgaysrKSB7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiBzcGVjLmlkaW9tLFxuICAgICAgc3BhbjogeyBvcGVyYXRpb246IHNwZWMuZGVzdE9wZXJhdGlvbiwgYWJzb2x1dGVQYXRoOiBkZXN0UGF0aHNba10sIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgfSk7XG4gIH1cbn1cblxuY29uc3QgUk1fTk9fVkFMVUUgPSBuZXcgU2V0KFsnLWYnLCAnLWknLCAnLXYnXSk7XG4vKiogYHJtYC9gZ2l0IHJtYCBmbGFncyB3aG9zZSBzZW1hbnRpY3MgYXJlIG91dCBvZiBzY29wZTogcmVjdXJzaXZlIHJlbW92YWwgYW5kIHJtZGlyLiAqL1xuY29uc3QgUk1fRVhDTFVERUQgPSBuZXcgU2V0KFsnLXInLCAnLVInLCAnLS1yZWN1cnNpdmUnLCAnLWQnXSk7XG4vKiogYGdpdCBybWAgYWRkcyB0aGUgZHJ5LXJ1biBmb3JtIHRvIHRoZSBleGNsdXNpb25zLiAqL1xuY29uc3QgR0lUX1JNX0VYQ0xVREVEID0gbmV3IFNldChbJy1yJywgJy1SJywgJy0tcmVjdXJzaXZlJywgJy1kJywgJy1uJywgJy0tZHJ5LXJ1biddKTtcblxuLyoqXG4gKiBUaGUgc2hhcmVkIHJtL2dpdCBybSBvcGVyYW5kIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS41KTogYSByZWN1cnNpdmUvcm1kaXIgZmxhZyAob3JcbiAqIGAtLWNhY2hlZGAgZm9yIGdpdCBybSBcdTIwMTQgdGhlIHdvcmt0cmVlIGZpbGUgc3Vydml2ZXMpIGV4Y2x1ZGVzIHRoZSB3aG9sZVxuICogY29tbWFuZDsgZWFjaCByZW1haW5pbmcgZmlsZS1zaGFwZWQgb3BlcmFuZCBpcyBhIGRlbGV0ZSwgYW5kIGFcbiAqIGRpcmVjdG9yeS1zaGFwZWQgb3BlcmFuZCBmYWlscyBjbG9zZWQuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoUm1PcGVyYW5kcyhcbiAgYXJnczogc3RyaW5nW10sXG4gIGV4Y2x1ZGVkOiBSZWFkb25seVNldDxzdHJpbmc+LFxuICBleGNsdWRlQ2FjaGVkOiBib29sZWFuLFxuICBkaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG4gIGNvbnN0IG9wZXJhbmRzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGEgb2YgYXJncykge1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoZXhjbHVkZWQuaGFzKGEpIHx8IChleGNsdWRlQ2FjaGVkICYmIGEgPT09ICctLWNhY2hlZCcpKSByZXR1cm47XG4gICAgaWYgKFJNX05PX1ZBTFVFLmhhcyhhKSkgY29udGludWU7XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTsgLy8gdW5rbm93biBvcHRpb24gXHUyMTkyIHRyZWF0ZWQgYXMgYW4gb3B0aW9uXG4gICAgb3BlcmFuZHMucHVzaChhKTtcbiAgfVxuICBmb3IgKGNvbnN0IG9wZXJhbmQgb2Ygb3BlcmFuZHMpIHtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUob3BlcmFuZCkpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdybS13cml0ZScsIG9wZXJhbmQsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChvcGVyYW5kLmVuZHNXaXRoKCcvJykgfHwgaXNFeGlzdGluZ0RpcmVjdG9yeShyZXNvbHZlUGF0aChkaXIsIG9wZXJhbmQpKSkgY29udGludWU7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiAncm0td3JpdGUnLFxuICAgICAgc3BhbjogeyBvcGVyYXRpb246ICdkZWxldGUnLCBhYnNvbHV0ZVBhdGg6IHJlc29sdmVQYXRoKGRpciwgb3BlcmFuZCksIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgfSk7XG4gIH1cbn1cblxuLyoqXG4gKiBTdGF0aWNhbGx5IGV2YWx1YXRlIGFuIGFic29sdXRlIGB0cnVuY2F0ZSAtc2Agc2l6ZSAocGxhbiBcdTAwQTc1LjUpOiBhIHBsYWluXG4gKiBpbnRlZ2VyIHdpdGggYW4gb3B0aW9uYWwgSy9NL0cgc3VmZml4LiBSZWxhdGl2ZSBzaXplcyAoYC1zICtOYC9gLXMgLU5gKSxcbiAqIGAtciByZWZgIHZhbHVlcywgYW5kIHNoZWxsLWV4cGFuZGVkIHZhbHVlcyBkZXBlbmQgb24gcnVudGltZSBzdGF0ZSBcdTIxOTJcbiAqIHVuZGVmaW5lZCAodGhvc2Ugc3BhbnMgZ2F0ZSBleGlzdGVuY2Utb25seSkuXG4gKi9cbmZ1bmN0aW9uIGV2YWx1YXRlU3RhdGljU2l6ZSh2YWx1ZTogc3RyaW5nIHwgdW5kZWZpbmVkKTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gIGNvbnN0IG0gPSB2YWx1ZS5tYXRjaCgvXihcXGQrKShbS01HXSk/JC8pO1xuICBpZiAobSA9PT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3QgYmFzZSA9IE51bWJlci5wYXJzZUludChtWzFdLCAxMCk7XG4gIGNvbnN0IG11bHQgPSBtWzJdID09PSAnSycgPyAxMDI0IDogbVsyXSA9PT0gJ00nID8gMTAyNCAqKiAyIDogbVsyXSA9PT0gJ0cnID8gMTAyNCAqKiAzIDogMTtcbiAgcmV0dXJuIGJhc2UgKiBtdWx0O1xufVxuXG4vKipcbiAqIFRoZSB0cnVuY2F0ZSBncmFtbWFyIChwbGFuIFx1MDBBNzUuNSk6IGAtcyBTSVpFYC9gLXIgcmVmYCBhcmUgdmFsdWUtdGFraW5nIFx1MjAxNCB0aGVcbiAqIHNpemUgdmFsdWUgbWF5IGl0c2VsZiBsZWFkIHdpdGggYC1gIChgdHJ1bmNhdGUgLXMgLTEwIGZgKSBcdTIwMTQgYW5kIGAtY2AgaXNcbiAqIGNvbXBhdGlibGUuIFdpdGhvdXQgYC1zYC9gLXJgIHRoZSBjb21tYW5kIGNoYW5nZXMgbm90aGluZyBcdTIxOTIgbm8gdG91Y2guIEVhY2hcbiAqIGZpbGUtc2hhcGVkIG9wZXJhbmQgaXMgYSB0cnVuY2F0ZTsgYW4gYWJzb2x1dGUgYC1zIE5gIGNhcnJpZXMgdGhlIHN0YXRpY2FsbHlcbiAqIGV2YWx1YXRlZCBzaXplIG9uIHRoZSBzcGFuICh0aGUgXHUwMEE3MyBgc2l6ZWAgZ2F0ZSdzIHBvc3QtY29tbWFuZCBieXRlIGNvdW50LFxuICogYC1zIDBgIFx1MjE5MiBlbXB0eSksIHJlbGF0aXZlIHNpemVzIGFuZCBgLXIgcmVmYCBzdGF5IGV4aXN0ZW5jZS1vbmx5LlxuICovXG5mdW5jdGlvbiBtYXRjaFRydW5jYXRlT3BlcmFuZHMoXG4gIGFyZ3M6IHN0cmluZ1tdLFxuICBkaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGxldCBzYXdTaXplRmxhZyA9IGZhbHNlO1xuICBsZXQgYWZ0ZXJEYXNoRGFzaCA9IGZhbHNlO1xuICBsZXQgc3RhdGljU2l6ZTogbnVtYmVyIHwgdW5kZWZpbmVkO1xuICBjb25zdCBvcGVyYW5kczogQXJyYXk8eyBwYXRoOiBzdHJpbmc7IHNpemU6IG51bWJlciB8IHVuZGVmaW5lZCB9PiA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJnc1tpXTtcbiAgICBpZiAoYWZ0ZXJEYXNoRGFzaCkge1xuICAgICAgb3BlcmFuZHMucHVzaCh7IHBhdGg6IGEsIHNpemU6IHN0YXRpY1NpemUgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLXMnKSB7XG4gICAgICBzYXdTaXplRmxhZyA9IHRydWU7XG4gICAgICBzdGF0aWNTaXplID0gZXZhbHVhdGVTdGF0aWNTaXplKGFyZ3NbaSArIDFdKTtcbiAgICAgIGkgKz0gMTsgLy8gY29uc3VtZSB0aGUgc2l6ZSB2YWx1ZSwgZXZlbiB3aGVuIGl0IGxlYWRzIHdpdGggYC1gXG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctcicpIHtcbiAgICAgIHNhd1NpemVGbGFnID0gdHJ1ZTtcbiAgICAgIHN0YXRpY1NpemUgPSB1bmRlZmluZWQ7IC8vIHRoZSBsYXN0IHNpemUgb3B0aW9uIHdpbnM7IGEgcmVmIGhhcyBubyBzdGF0aWMgdmFsdWVcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1jJykgY29udGludWU7XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTsgLy8gdW5rbm93biBvcHRpb24gXHUyMTkyIHRyZWF0ZWQgYXMgYW4gb3B0aW9uXG4gICAgb3BlcmFuZHMucHVzaCh7IHBhdGg6IGEsIHNpemU6IHN0YXRpY1NpemUgfSk7XG4gIH1cbiAgaWYgKCFzYXdTaXplRmxhZykgcmV0dXJuO1xuICBmb3IgKGNvbnN0IG9wZXJhbmQgb2Ygb3BlcmFuZHMpIHtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUob3BlcmFuZC5wYXRoKSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3RydW5jYXRlLWNvbW1hbmQnLCBvcGVyYW5kLnBhdGgsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChvcGVyYW5kLnBhdGguZW5kc1dpdGgoJy8nKSB8fCBpc0V4aXN0aW5nRGlyZWN0b3J5KHJlc29sdmVQYXRoKGRpciwgb3BlcmFuZC5wYXRoKSkpIGNvbnRpbnVlO1xuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogJ3RydW5jYXRlLWNvbW1hbmQnLFxuICAgICAgc3Bhbjoge1xuICAgICAgICBvcGVyYXRpb246ICd0cnVuY2F0ZScsXG4gICAgICAgIGFic29sdXRlUGF0aDogcmVzb2x2ZVBhdGgoZGlyLCBvcGVyYW5kLnBhdGgpLFxuICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgIGpvaW4sXG4gICAgICAgIC4uLihvcGVyYW5kLnNpemUgIT09IHVuZGVmaW5lZCA/IHsgc2l6ZTogb3BlcmFuZC5zaXplIH0gOiB7fSlcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBybS9naXQgcm0vdHJ1bmNhdGUgZmFtaWx5IChwbGFuIFx1MDBBNzUuNSk6IGBybWAvYGdpdCBybWAgb3BlcmFuZHMgYXJlXG4gKiBkZWxldGVzLCBgdHJ1bmNhdGVgIG9wZXJhbmRzIGFyZSB0cnVuY2F0aW9ucyAob25seSB3aGVuIGAtc2AvYC1yYCBpc1xuICogcHJlc2VudCkuIGBnaXQgcm0gLS1jYWNoZWRgIHRvdWNoZXMgbm90aGluZy5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hSbVRydW5jYXRlKFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgZGlyRm9yUmVzb2x1dGlvbjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcmVzdCA9IHN0cmlwVHJhbnNwYXJlbnRXcmFwcGVyKGFyZ3YpO1xuICBpZiAocmVzdC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgY29uc3QgY29tbWFuZCA9IHJlc3RbMF07XG4gIGlmIChjb21tYW5kID09PSAncm0nKSB7XG4gICAgbWF0Y2hSbU9wZXJhbmRzKHJlc3Quc2xpY2UoMSksIFJNX0VYQ0xVREVELCBmYWxzZSwgZGlyRm9yUmVzb2x1dGlvbiwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luLCByZXN1bHRzKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGNvbW1hbmQgPT09ICd0cnVuY2F0ZScpIHtcbiAgICBtYXRjaFRydW5jYXRlT3BlcmFuZHMocmVzdC5zbGljZSgxKSwgZGlyRm9yUmVzb2x1dGlvbiwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luLCByZXN1bHRzKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGNvbW1hbmQgPT09ICdnaXQnKSB7XG4gICAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQocmVzdC5zbGljZSgxKSk7XG4gICAgaWYgKHN1YiAhPT0gbnVsbCAmJiBzdWIuc3ViY29tbWFuZCA9PT0gJ3JtJykge1xuICAgICAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlKSB7XG4gICAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdybS13cml0ZScsICdybScsICdnaXQgLUMgdGFyZ2V0IGNvbnRhaW5zIGFuIHVucmVzb2x2ZWQgc2hlbGwgdmFyaWFibGUnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgbWF0Y2hSbU9wZXJhbmRzKFxuICAgICAgICByZXN0LnNsaWNlKDEpLnNsaWNlKHN1Yi5zdWJJZHggKyAxKSxcbiAgICAgICAgR0lUX1JNX0VYQ0xVREVELFxuICAgICAgICB0cnVlLFxuICAgICAgICBzdWIuY0RpciA/PyBkaXJGb3JSZXNvbHV0aW9uLFxuICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgIGpvaW4sXG4gICAgICAgIHJlc3VsdHNcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuICBpZiAoRk9SRUlHTl9XUkFQUEVSUy5oYXMoY29tbWFuZCkpIHtcbiAgICBjb25zdCB3cmFwcGVkID0gcmVzdFsxXTtcbiAgICBpZiAod3JhcHBlZCA9PT0gJ3JtJyB8fCB3cmFwcGVkID09PSAndHJ1bmNhdGUnKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChcbiAgICAgICAgcmVzdWx0cyxcbiAgICAgICAgd3JhcHBlZCA9PT0gJ3JtJyA/ICdybS13cml0ZScgOiAndHJ1bmNhdGUtY29tbWFuZCcsXG4gICAgICAgIHdyYXBwZWQsXG4gICAgICAgIGB0aGUgJHtjb21tYW5kfSB3cmFwcGVyIG9ic2N1cmVzIHRoZSAke3dyYXBwZWR9IGFyZ3ZgXG4gICAgICApO1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFRoZSBoZXJlZG9jIHdyaXRlIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS4yKSBmb3IgdGhlIGhvc3QgZmFtaWxpZXMgd2hvc2UgYm9kaWVzIGFyZVxuICogY29udGVudDogYGNhdGAgKGJvZHkgXHUyMTkyIHRoZSBjb250ZW50IHJlZGlyZWN0cyksIGB0ZWVgIChib2R5IFx1MjE5MiB0aGUgb3BlcmFuZHMpLFxuICogYW5kIGBwYXRjaGAvYGdpdCBhcHBseWAgKGJvZHkgXHUyMTkyIHBhdGNoIHRleHQsIFx1MDBBNzUuNykuIEFueSBvdGhlciBob3N0J3MgaGVyZWRvY1xuICogYm9keSBpcyBub3QgYXR0cmlidXRhYmxlIGNvbnRlbnQgXHUyMDE0IHN0ZGluLW9ubHkgYW5kIG5vbi1mYW1pbHkgY29tbWFuZHNcbiAqIChgcHl0aG9uMyAtIDw8RU9GID4gb3V0YCwgYGxzID4gb3V0IDw8RU9GYCkgZ2V0IG5vIHdyaXRlIHRvdWNoLCBhbmRcbiAqIHJlYWQtZmFtaWx5IGNvbW1hbmRzIChgc2VkIC1uICcxLDJwJyA8PEVPRmApIGZhbGwgdGhyb3VnaCB0byB0aGUgcmVhZFxuICogbWF0Y2hlcnMuIEVtcHR5IGA+PmAtYm9kaWVzIGFwcGVuZCBub3RoaW5nIGFuZCB0b3VjaCBub3RoaW5nOyBlbXB0eSBgPmAtYm9kaWVzXG4gKiB0cnVuY2F0ZSAod2hvbGUtZmlsZSwgdGhlIEYyIHJ1bGUpLlxuICpcbiAqIEJvZHkgdGhyZWFkaW5nOiBgPj5gIGFwcGVuZHMgYW5kIGA+YCBvdmVyd3JpdGVzIHRocmVhZCB0aGUgYm9keSB3aGVuIHRoZVxuICogY29udGVudCByZWRpcmVjdCBpcyBzaW5nbGUgYW5kIHBsYWluIFx1MjAxNCB0aGUgZXhhY3QgZ2F0ZSdzIHBvc3QtY29udGVudCBvbiB0aGVcbiAqIG92ZXJ3cml0ZSAodGhlIHRyYWlsaW5nIGBcXG5gIHRoZSBleHRyYWN0aW9uIHN0cmlwcyBpcyByZXN0b3JlZCwgc2luY2UgdGhlXG4gKiBnYXRlIGNvbXBhcmVzIGZ1bGwgZmlsZSBieXRlcyksIHRoZSBzdWZmaXggZ2F0ZSdzIGJvZHkgb24gdGhlIGFwcGVuZCAocGxhblxuICogXHUwMEE3MyBzdGVwIDFiIGxpc3RzIFwidGVlL2hlcmVkb2Mgd2l0aCBhIGxpdGVyYWwgYm9keVwiIGluIHRoZSBleGFjdCBjbGFzcykuXG4gKi9cbmZ1bmN0aW9uIGNsYXNzaWZ5SGVyZWRvY09wZW5lcihcbiAgb3BlbmVyOiBzdHJpbmcsXG4gIGJvZHk6IHN0cmluZyxcbiAgY3VycmVudERpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgdG9rZW5zID0gdG9rZW5pemUoc3RyaXBMZWFkaW5nQXNzaWdubWVudHMob3BlbmVyKS50cmltKCkpO1xuICBpZiAodG9rZW5zID09PSBudWxsKSByZXR1cm47XG4gIGNvbnN0IHsgYXJndiwgcmVkaXJlY3RzIH0gPSBhbmFseXplVG9rZW5zKHRva2Vucyk7XG4gIGNvbnN0IGhvc3QgPSBhcmd2WzBdO1xuICBjb25zdCBjb250ZW50UmVkaXJlY3RzID0gcmVkaXJlY3RzLmZpbHRlcihpc0NvbnRlbnRSZWRpcmVjdCk7XG4gIGNvbnN0IHNpbmdsZVBsYWluQXBwZW5kID0gY29udGVudFJlZGlyZWN0cy5sZW5ndGggPT09IDEgJiYgY29udGVudFJlZGlyZWN0c1swXS5vcCA9PT0gJz4+JztcbiAgY29uc3Qgc2luZ2xlUGxhaW5PdmVyd3JpdGUgPSBjb250ZW50UmVkaXJlY3RzLmxlbmd0aCA9PT0gMSAmJiBjb250ZW50UmVkaXJlY3RzWzBdLm9wID09PSAnPic7XG5cbiAgY29uc3QgZW1pdENvbnRlbnRSZWRpcmVjdHMgPSAoKTogdm9pZCA9PiB7XG4gICAgZm9yIChjb25zdCByIG9mIGNvbnRlbnRSZWRpcmVjdHMpIHtcbiAgICAgIGlmIChyLnRhcmdldCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlVGFyZ2V0KHJlc3VsdHMsICdoZXJlZG9jLXdyaXRlJywgci50YXJnZXQsIGN1cnJlbnREaXIpO1xuICAgICAgaWYgKGFic29sdXRlUGF0aCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgICBpZiAoci5vcCA9PT0gJz4+JyB8fCByLm9wID09PSAnJj4+Jykge1xuICAgICAgICBpZiAoYm9keS5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgICBpZGlvbTogJ2hlcmVkb2Mtd3JpdGUnLFxuICAgICAgICAgIHNwYW46IHtcbiAgICAgICAgICAgIG9wZXJhdGlvbjogJ2FwcGVuZCcsXG4gICAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgICBqb2luLFxuICAgICAgICAgICAgLi4uKHNpbmdsZVBsYWluQXBwZW5kICYmIHIub3AgPT09ICc+PicgPyB7IHdyaXR0ZW46IGJvZHkgfSA6IHt9KVxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgICBpZGlvbTogJ2hlcmVkb2Mtd3JpdGUnLFxuICAgICAgICAgIHNwYW46XG4gICAgICAgICAgICBib2R5Lmxlbmd0aCA9PT0gMFxuICAgICAgICAgICAgICA/IHsgb3BlcmF0aW9uOiAndHJ1bmNhdGUnLCBhYnNvbHV0ZVBhdGgsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgICAgICAgICAgIDoge1xuICAgICAgICAgICAgICAgICAgb3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZScsXG4gICAgICAgICAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgICAgICAgICBqb2luLFxuICAgICAgICAgICAgICAgICAgLy8gVGhlIGV4YWN0IGdhdGUgY29tcGFyZXMgZnVsbCBmaWxlIGJ5dGVzLCBzbyB0aGUgdHJhaWxpbmdcbiAgICAgICAgICAgICAgICAgIC8vIGBcXG5gIHRoZSBleHRyYWN0aW9uIHN0cmlwcGVkIGNvbWVzIGJhY2sgb24gdGhlIG92ZXJ3cml0ZS5cbiAgICAgICAgICAgICAgICAgIC4uLihzaW5nbGVQbGFpbk92ZXJ3cml0ZSA/IHsgd3JpdHRlbjogYCR7Ym9keX1cXG5gIH0gOiB7fSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfTtcblxuICBpZiAoaG9zdCA9PT0gJ2NhdCcpIHtcbiAgICBlbWl0Q29udGVudFJlZGlyZWN0cygpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoaG9zdCA9PT0gJ3RlZScpIHtcbiAgICBjb25zdCBwYXJ0cyA9IHRlZU9wZXJhbmRQYXJ0cyhhcmd2KTtcbiAgICBpZiAocGFydHMgIT09IG51bGwpIHtcbiAgICAgIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBwYXJ0cy5vcGVyYW5kcykge1xuICAgICAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlVGFyZ2V0KHJlc3VsdHMsICdoZXJlZG9jLXdyaXRlJywgb3BlcmFuZCwgY3VycmVudERpcik7XG4gICAgICAgIGlmIChhYnNvbHV0ZVBhdGggPT09IG51bGwpIGNvbnRpbnVlO1xuICAgICAgICBpZiAocGFydHMuYXBwZW5kKSB7XG4gICAgICAgICAgaWYgKGJvZHkubGVuZ3RoID09PSAwKSBjb250aW51ZTtcbiAgICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICAgICAgaWRpb206ICdoZXJlZG9jLXdyaXRlJyxcbiAgICAgICAgICAgIHNwYW46IHtcbiAgICAgICAgICAgICAgb3BlcmF0aW9uOiAnYXBwZW5kJyxcbiAgICAgICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgICAgIC4uLihjb250ZW50UmVkaXJlY3RzLmxlbmd0aCA9PT0gMCA/IHsgd3JpdHRlbjogYm9keSB9IDoge30pXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgICBzcGFuOlxuICAgICAgICAgICAgICBib2R5Lmxlbmd0aCA9PT0gMFxuICAgICAgICAgICAgICAgID8geyBvcGVyYXRpb246ICd0cnVuY2F0ZScsIGFic29sdXRlUGF0aCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICAgICAgICAgICAgICA6IHtcbiAgICAgICAgICAgICAgICAgICAgb3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZScsXG4gICAgICAgICAgICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICAgICAgICAgICAgICBqb2luLFxuICAgICAgICAgICAgICAgICAgICAvLyBTYW1lIHJlc3RvcmVkLWBcXG5gIGV4YWN0IGJvZHkgYXMgdGhlIHJlZGlyZWN0IGJyYW5jaDsgYVxuICAgICAgICAgICAgICAgICAgICAvLyB0ZWUgb3BlcmFuZCB3aXRoIGEgY29udGVudCByZWRpcmVjdCBwcmVzZW50IGtlZXBzIHRoZVxuICAgICAgICAgICAgICAgICAgICAvLyByZWRpcmVjdCdzIHRocmVhZGluZyBvbmx5IChtaXJyb3Igb2YgdGhlIGFwcGVuZCBicmFuY2gpLlxuICAgICAgICAgICAgICAgICAgICAuLi4oY29udGVudFJlZGlyZWN0cy5sZW5ndGggPT09IDAgPyB7IHdyaXR0ZW46IGAke2JvZHl9XFxuYCB9IDoge30pXG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgZW1pdENvbnRlbnRSZWRpcmVjdHMoKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGhvc3QgPT09ICdwYXRjaCcgfHwgaG9zdCA9PT0gJ2dpdCcpIHtcbiAgICBjbGFzc2lmeVBhdGNoSGVyZWRvYyhhcmd2LCBib2R5LCBjdXJyZW50RGlyLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBOb24tZmFtaWx5IGhvc3Q6IHRoZSBib2R5IGlzIG5vdCBhdHRyaWJ1dGFibGUgY29udGVudCBcdTIwMTQgbm8gd3JpdGUgdG91Y2guXG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVGhlIHNlZCAtaSBncmFtbWFyIChwbGFuIFx1MDBBNzUuNiksIHRoZSBmaXJzdCBjb25zdW1lciBvZiBleGFjdCByYW5nZXM6IGFcbi8vIHN1YnN0aXR1dGlvbi1vbmx5IHNjcmlwdCB3aXRoIG51bWVyaWMgYWRkcmVzc2VzIG1vZGlmaWVzIHRoZSBhZGRyZXNzZWRcbi8vIGxpbmVzOyBhbnl0aGluZyBsZXNzIHN0YXRpY2FsbHkgY2VydGFpbiBpcyBhIHdob2xlLWZpbGUgbW9kaWZ5LiBUaGVcbi8vIHN1ZmZpeC9zY3JpcHQgZGlzYW1iaWd1YXRpb24gYW5kIHRoZSBzZWdtZW50IGNsYXNzaWZpY2F0aW9uIGJlbG93IGFyZSB0aGVcbi8vIHdob2xlIG9mIGl0IFx1MjAxNCBldmVyeXRoaW5nIGVsc2UgZm9sbG93cyB0aGUgc2hhcmVkIFx1MDBBNzUgZmFpbC1jbG9zZWQgcnVsZXMuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEEgbnVtZXJpYy1hZGRyZXNzZWQgc3Vic3RpdHV0aW9uIHNlZ21lbnQgKGBOYCwgYE4sTWApIFx1MjAxNCB0aGUgb25seSBmb3JtIHdpdGggYW4gZXhhY3QgcmFuZ2UuICovXG5jb25zdCBOVU1FUklDX1NVQlNUSVRVVElPTiA9IC9eKFxcZCspKD86LChcXGQrKSk/W3N5XS87XG5cbi8qKiBBbiB1bmFkZHJlc3NlZCBzdWJzdGl0dXRpb24gc2VnbWVudCBcdTIwMTQgbGluZS1jb3VudC1wcmVzZXJ2aW5nLCB3aG9sZSBmaWxlIGFkZHJlc3NlZC4gKi9cbmNvbnN0IFVOUkVTVFJJQ1RFRF9TVUJTVElUVVRJT04gPSAvXltzeV0vO1xuXG5mdW5jdGlvbiBtYXRjaFNlZElucGxhY2UoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBkaXJGb3JSZXNvbHV0aW9uOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCByZXN0ID0gc3RyaXBUcmFuc3BhcmVudFdyYXBwZXIoYXJndik7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICBjb25zdCBjb21tYW5kID0gcmVzdFswXTtcbiAgaWYgKGNvbW1hbmQgPT09ICdzZWQnKSB7XG4gICAgbWF0Y2hTZWRJbnBsYWNlQXJncyhyZXN0LnNsaWNlKDEpLCBkaXJGb3JSZXNvbHV0aW9uLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoRk9SRUlHTl9XUkFQUEVSUy5oYXMoY29tbWFuZCkpIHtcbiAgICBjb25zdCB3cmFwcGVkID0gcmVzdFsxXTtcbiAgICBpZiAod3JhcHBlZCA9PT0gJ3NlZCcpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdzZWQtaW5wbGFjZScsIHdyYXBwZWQsIGB0aGUgJHtjb21tYW5kfSB3cmFwcGVyIG9ic2N1cmVzIHRoZSAke3dyYXBwZWR9IGFyZ3ZgKTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgc2VkIC1pIG9wZXJhbmQgZ3JhbW1hcjogYC1pYCBiYXJlLCBgLWlTVUZGSVhgIGF0dGFjaGVkLCBvciBhIHNlcGFyYXRlXG4gKiBzdWZmaXggd29yZCByZXNvbHZlZCBieSB0aGUgc3RhbmRhcmQgZGlzYW1iaWd1YXRpb24gXHUyMDE0IHRoZSB3b3JkIGFmdGVyIGAtaWBcbiAqIGlzIHRoZSBzdWZmaXggb25seSB3aGVuIGl0IGRvZXMgbm90IHN0YXJ0IHdpdGggYC1gIGFuZCBhIHNjcmlwdCBwbHVzIGF0XG4gKiBsZWFzdCBvbmUgZmlsZSBvcGVyYW5kIHN0aWxsIGZvbGxvdyBpdCAodGhlIEJTRCBzZXBhcmF0ZS1zdWZmaXggcmVhZGluZztcbiAqIEdOVSdzIGF0dGFjaGVkLW9ubHkgcmVhZGluZyBvdGhlcndpc2UpLiBBbiBhdHRhY2hlZCBvciBkaXNhbWJpZ3VhdGVkIHN1ZmZpeFxuICogaXMgYSBiYWNrdXA6IGEgbm9uLWVtcHR5IHN1ZmZpeCBlbWl0cyBhbiBhZGRpdGlvbmFsIGNyZWF0ZS1vdmVyd3JpdGUgdG91Y2hcbiAqIG9uIGA8ZmlsZT48U1VGRklYPmA7IGFuIGVtcHR5IHN1ZmZpeCAod2hpY2ggdGhlIHF1b3RlLWF3YXJlIHRva2VuaXplciBkcm9wc1xuICogZW50aXJlbHkgXHUyMDE0IGBzZWQgLWkgJycgZmAgYW5kIGBzZWQgLWkgZmAgdG9rZW5pemUgYWxpa2UpIGNyZWF0ZXMgbm8gYmFja3VwLlxuICpcbiAqIFRoZSBzY3JpcHQgaXMgdGhlIHNjcmlwdCBhcmd1bWVudCBwbHVzIGV2ZXJ5IGAtZWAgYXJndW1lbnQsIHNwbGl0IG9uIGA7YC5cbiAqIFNlZ21lbnRzIHRoYXQgYXJlIGFsbCBudW1lcmljLWFkZHJlc3NlZCBzdWJzdGl0dXRpb25zIHlpZWxkIHRoZSBleGFjdCByYW5nZVxuICogW21pbiBzdGFydCwgbWluKG1heCBlbmQsIEVPRildIChwZXIgZmlsZSwgRU9GIGZyb20gdGhlIHBvc3QtZWRpdCBjb3VudCk7XG4gKiBzZWdtZW50cyB0aGF0IGFyZSBhbGwgc3Vic3RpdHV0aW9ucyBcdTIwMTQgYW55IG51bWVyaWMvdW5hZGRyZXNzZWQgbWl4IFx1MjAxNCBhcmVcbiAqIHN0aWxsIGxpbmUtY291bnQtcHJlc2VydmluZywgc28gdGhlIHdob2xlIGZpbGUgaXMgYWRkcmVzc2VkIChbMSwgRU9GXSk7XG4gKiBhbnkgY291bnQtY2hhbmdpbmcsIHBhdHRlcm4tYWRkcmVzc2VkLCBzdGVwLCBvciBgJGAtYWRkcmVzc2VkIHNlZ21lbnQgaXMgYVxuICogd2hvbGUtZmlsZSBtb2RpZnkgd2l0aCBubyByYW5nZS4gQW4gYWJzZW50IHNjcmlwdCAobm8gc2NyaXB0IGFyZ3VtZW50LCBub1xuICogYC1lYCkgaXMgdW5yZXNvbHZlZC5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hTZWRJbnBsYWNlQXJncyhcbiAgYXJnczogc3RyaW5nW10sXG4gIGRpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgbGV0IHN1ZmZpeDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCBzYXdJbnBsYWNlID0gZmFsc2U7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgZVNjcmlwdHM6IHN0cmluZ1tdID0gW107XG4gIC8vIFRoZSBzY3JpcHQvZmlsZSBzcGxpdCBvZiB0aGUgcG9zaXRpb25hbHMgaXMgZGVyaXZlZCBhZnRlciB0aGUgc2NhbjogdGhlXG4gIC8vIGZpcnN0IHBvc2l0aW9uYWwgaXMgdGhlIHNjcmlwdCBhcmd1bWVudCBvbmx5IHdoZW4gbm8gYC1lYCBzY3JpcHQgZXhpc3RzIFx1MjAxNFxuICAvLyB3aXRoIGAtZWAgcHJlc2VudCBldmVyeSBwb3NpdGlvbmFsIGlzIGEgZmlsZSAoR05VIHNlZCByZWFkcyB0aGUgc2NyaXB0XG4gIC8vIGZyb20gYC1lYCB0aGVuLCBub3QgZnJvbSB0aGUgZmlyc3QgcG9zaXRpb25hbCkuXG4gIGNvbnN0IHBvc2l0aW9uYWxzOiBzdHJpbmdbXSA9IFtdO1xuICAvLyBGaWxlcyBwdXNoZWQgb3V0c2lkZSB0aGUgcG9zaXRpb25hbCBwYXRoOiBgc2VkIC1pIGZgIChzY3JpcHQgYWJzZW50KS5cbiAgY29uc3QgZmlsZXM6IHN0cmluZ1tdID0gW107XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG5cbiAgd2hpbGUgKGkgPCBhcmdzLmxlbmd0aCkge1xuICAgIGNvbnN0IGEgPSBhcmdzW2ldO1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBwb3NpdGlvbmFscy5wdXNoKGEpO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1uJykge1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWUnKSB7XG4gICAgICBjb25zdCB2ID0gYXJnc1tpICsgMV07XG4gICAgICBpZiAodiA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdzZWQtaW5wbGFjZScsIGEsICd0aGUgLWUgZmxhZyBpcyBsZWZ0IHZhbHVlbGVzcycpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBlU2NyaXB0cy5wdXNoKHYpO1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWknKSB7XG4gICAgICBzYXdJbnBsYWNlID0gdHJ1ZTtcbiAgICAgIGNvbnN0IHcgPSBhcmdzW2kgKyAxXTtcbiAgICAgIGlmICh3ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgLy8gYHNlZCAtaWAgd2l0aCBub3RoaW5nIGFmdGVyOiBubyBzdWZmaXgsIG5vIHNjcmlwdCBcdTIwMTQgdGhlIGFic2VudC1zY3JpcHRcbiAgICAgICAgLy8gY2hlY2sgYmVsb3cgcmVzb2x2ZXMgdGhpcyB1bnJlc29sdmVkLlxuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKHcuc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICAgIC8vIFRoZSB3b3JkIGFmdGVyIC1pIGlzIGFuIG9wdGlvbiwgbmV2ZXIgYSBzdWZmaXguXG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCByZXN0QWZ0ZXIgPSBhcmdzLnNsaWNlKGkgKyAyKTtcbiAgICAgIGlmIChyZXN0QWZ0ZXIubGVuZ3RoID49IDIpIHtcbiAgICAgICAgLy8gVGhlIEJTRCBzZXBhcmF0ZS1zdWZmaXggcmVhZGluZzogdyBpcyB0aGUgc3VmZml4LCBhbmQgYSBzY3JpcHQgcGx1c1xuICAgICAgICAvLyBhdCBsZWFzdCBvbmUgZmlsZSBvcGVyYW5kIHN0aWxsIGZvbGxvdy5cbiAgICAgICAgc3VmZml4ID0gdztcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChyZXN0QWZ0ZXIubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIC8vIGBzZWQgLWkgZmA6IHcgaXMgdGhlIGxhc3QgdG9rZW4gXHUyMDE0IG5vIHNjcmlwdCBjYW4gZm9sbG93LCBzbyB3IGlzIHRoZVxuICAgICAgICAvLyBmaWxlIG9wZXJhbmQgd2l0aCB0aGUgc2NyaXB0IGFic2VudCAoR05VIGluc3RlYWQgcmVhZHMgdyBhcyBhIHNjcmlwdFxuICAgICAgICAvLyBhbmQgZXJyb3JzOyBlaXRoZXIgd2F5IHRoZSBlZGl0IGRvZXMgbm90IGhhcHBlbikuXG4gICAgICAgIGZpbGVzLnB1c2godyk7XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICAvLyBPbmUgdG9rZW4gYWZ0ZXIgdzogdyBpcyB0aGUgc2NyaXB0IGFyZ3VtZW50IChvciBhIGZpbGUsIHdoZW4gYC1lYFxuICAgICAgLy8gc2NyaXB0cyBhcmUgcHJlc2VudCkgYW5kIHRoZSB0b2tlbiBpcyBhIGZpbGUgXHUyMDE0IGNvbnN1bWUgYm90aCwgc29cbiAgICAgIC8vIG5laXRoZXIgZmFsbHMgdGhyb3VnaCB0byB0aGUgcG9zaXRpb25hbCBwYXRoIGFnYWluLlxuICAgICAgcG9zaXRpb25hbHMucHVzaCh3LCByZXN0QWZ0ZXJbMF0pO1xuICAgICAgaSArPSAzO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy1pJykgJiYgYS5sZW5ndGggPiAyKSB7XG4gICAgICBzYXdJbnBsYWNlID0gdHJ1ZTtcbiAgICAgIHN1ZmZpeCA9IGEuc2xpY2UoMik7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICAvLyBVbmtub3duIG9wdGlvbiBcdTIwMTQgbmV2ZXIgYSBzY3JpcHQgb3IgZmlsZS5cbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBwb3NpdGlvbmFscy5wdXNoKGEpO1xuICAgIGkgKz0gMTtcbiAgfVxuXG4gIGlmICghc2F3SW5wbGFjZSkgcmV0dXJuOyAvLyBub3QgYW4gaW4tcGxhY2UgZWRpdCBhdCBhbGxcbiAgY29uc3Qgc2NyaXB0QXJnID0gZVNjcmlwdHMubGVuZ3RoID09PSAwID8gKHBvc2l0aW9uYWxzWzBdID8/IG51bGwpIDogbnVsbDtcbiAgaWYgKHNjcmlwdEFyZyAhPT0gbnVsbCkgZmlsZXMucHVzaCguLi5wb3NpdGlvbmFscy5zbGljZSgxKSk7XG4gIGVsc2UgZmlsZXMucHVzaCguLi5wb3NpdGlvbmFscyk7XG4gIGNvbnN0IHNlZ21lbnRzOiBzdHJpbmdbXSA9IFtdO1xuICBpZiAoc2NyaXB0QXJnICE9PSBudWxsKSBzZWdtZW50cy5wdXNoKC4uLnNjcmlwdEFyZy5zcGxpdCgnOycpKTtcbiAgZm9yIChjb25zdCBzIG9mIGVTY3JpcHRzKSBzZWdtZW50cy5wdXNoKC4uLnMuc3BsaXQoJzsnKSk7XG4gIGlmIChzZWdtZW50cy5sZW5ndGggPT09IDApIHtcbiAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAnc2VkLWlucGxhY2UnLCBmaWxlc1swXSA/PyAnc2VkJywgJ25vIHNjcmlwdCAoYWJzZW50IG9yIGVtcHR5IHNjcmlwdCBhcmd1bWVudCknKTtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBTZWdtZW50IGNsYXNzaWZpY2F0aW9uOiBleGFjdCB3aGVuIGV2ZXJ5IHNlZ21lbnQgaXMgYSBudW1lcmljLWFkZHJlc3NlZFxuICAvLyBzdWJzdGl0dXRpb247IGV4cGxpY2l0IHdob2xlLWZpbGUgWzEsIEVPRl0gd2hlbiBldmVyeSBzZWdtZW50IGlzIHN0aWxsIGFcbiAgLy8gc3Vic3RpdHV0aW9uIChhbnkgdW5hZGRyZXNzZWQvbnVtZXJpYyBtaXgpOyBubyByYW5nZSBvdGhlcndpc2UuXG4gIGxldCBhbGxOdW1lcmljID0gdHJ1ZTtcbiAgbGV0IGFsbFN1YnN0aXR1dGlvbiA9IHRydWU7XG4gIGxldCBtaW5TdGFydCA9IEluZmluaXR5O1xuICBsZXQgbWF4RW5kID0gMDtcbiAgZm9yIChjb25zdCBzZWdtZW50IG9mIHNlZ21lbnRzKSB7XG4gICAgY29uc3QgbSA9IHNlZ21lbnQubWF0Y2goTlVNRVJJQ19TVUJTVElUVVRJT04pO1xuICAgIGlmIChtID09PSBudWxsKSB7XG4gICAgICBhbGxOdW1lcmljID0gZmFsc2U7XG4gICAgICBpZiAoIVVOUkVTVFJJQ1RFRF9TVUJTVElUVVRJT04udGVzdChzZWdtZW50KSkgYWxsU3Vic3RpdHV0aW9uID0gZmFsc2U7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgcyA9IE51bWJlci5wYXJzZUludChtWzFdLCAxMCk7XG4gICAgY29uc3QgZSA9IG1bMl0gPT09IHVuZGVmaW5lZCA/IHMgOiBOdW1iZXIucGFyc2VJbnQobVsyXSwgMTApO1xuICAgIG1pblN0YXJ0ID0gTWF0aC5taW4obWluU3RhcnQsIHMpO1xuICAgIG1heEVuZCA9IE1hdGgubWF4KG1heEVuZCwgZSk7XG4gIH1cblxuICBmb3IgKGNvbnN0IGYgb2YgZmlsZXMpIHtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUoZikpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdzZWQtaW5wbGFjZScsIGYsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVQYXRoKGRpciwgZik7XG4gICAgaWYgKGFsbE51bWVyaWMgfHwgYWxsU3Vic3RpdHV0aW9uKSB7XG4gICAgICBjb25zdCB0b3RhbCA9IGNvdW50RmlsZUxpbmVzKGFic29sdXRlUGF0aCk7XG4gICAgICBpZiAodG90YWwgPT09IG51bGwpIHtcbiAgICAgICAgcHVzaFVucmVzb2x2ZWQoXG4gICAgICAgICAgcmVzdWx0cyxcbiAgICAgICAgICAnc2VkLWlucGxhY2UnLFxuICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICAnY291bGQgbm90IGRldGVybWluZSBlbmQtb2YtZmlsZSBsaW5lIGNvdW50IChmaWxlIHVucmVhZGFibGUsIGVtcHR5LCBvciBtaXNzaW5nKSdcbiAgICAgICAgKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBzdGFydCA9IGFsbE51bWVyaWMgPyBtaW5TdGFydCA6IDE7XG4gICAgICBjb25zdCBlbmQgPSBhbGxOdW1lcmljID8gTWF0aC5taW4obWF4RW5kLCB0b3RhbCkgOiB0b3RhbDtcbiAgICAgIGlmIChzdGFydCA+IGVuZCkgY29udGludWU7IC8vIHRoZSBhZGRyZXNzZWQgcmFuZ2UgbGllcyBiZXlvbmQgRU9GIFx1MjAxNCBub3RoaW5nIGlzIG1vZGlmaWVkXG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiAnc2VkLWlucGxhY2UnLFxuICAgICAgICBzcGFuOiB7IG9wZXJhdGlvbjogJ21vZGlmeScsIGxpbmVTdGFydDogc3RhcnQsIGxpbmVFbmQ6IGVuZCwgYWJzb2x1dGVQYXRoLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgaWRpb206ICdzZWQtaW5wbGFjZScsXG4gICAgICAgIHNwYW46IHsgb3BlcmF0aW9uOiAnbW9kaWZ5JywgYWJzb2x1dGVQYXRoLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgICAgfSk7XG4gICAgfVxuICAgIGlmIChzdWZmaXggIT09IG51bGwgJiYgc3VmZml4ICE9PSAnJykge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogJ3NlZC1pbnBsYWNlJyxcbiAgICAgICAgc3BhbjogeyBvcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJywgYWJzb2x1dGVQYXRoOiBgJHthYnNvbHV0ZVBhdGh9JHtzdWZmaXh9YCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRoZSBwYXRjaCAvIGdpdCBhcHBseSBncmFtbWFyIChwbGFuIFx1MDBBNzUuNykuIFBhdGNoIHRleHQgc291cmNlcywgaW4gb3JkZXIgb2Zcbi8vIHJlY29nbml0aW9uOiBhIGxpdGVyYWwgcGF0Y2gtZmlsZSBvcGVyYW5kIChgZ2l0IGFwcGx5IDxmaWxlPmAgXHUyMDE0IGEgYHBhdGNoYFxuLy8gb3BlcmFuZCBpcyBhIHRhcmdldCBmaWxlLCBub3QgYSBzb3VyY2UsIGFuZCBpcyBpZ25vcmVkKSwgdGhlIHN0ZGluIGA8YFxuLy8gc291cmNlIChgcGF0Y2ggLXBOIDwgZmlsZWAsIGBnaXQgYXBwbHkgLSA8IGZpbGVgKSwgb3IgYSBoZXJlZG9jIGJvZHlcbi8vIChjbGFzc2lmeVBhdGNoSGVyZWRvYywgXHUwMEE3NS4yKS4gUmVhZC1vbmx5IG1vZGVzIChgLS1jaGVja2AvYC0tc3RhdGAvXG4vLyBgLS1udW1zdGF0YC9gLS1zdW1tYXJ5YCwgYHBhdGNoIC0tZHJ5LXJ1bmApIGFuZCBpbmRleC1vbmx5IGAtLWNhY2hlZGAgdG91Y2hcbi8vIG5vdGhpbmc7IGAtLWRpcmVjdG9yeWAgZmFpbHMgY2xvc2VkIChpdCByZXdyaXRlcyBwYXRjaCBwYXRocykuIEEgY29tbWFuZFxuLy8gd2l0aCBubyBzdGF0aWNhbGx5IGtub3duIHNvdXJjZSAocGlwZWQgb3IgdGVybWluYWwgc3RkaW4sIGEgdmFyaWFibGUgcGF0Y2hcbi8vIHBhdGgpIGlzIHVucmVzb2x2ZWQuIFRhcmdldHMgYW5kIHJhbmdlcyBjb21lIGZyb20gdGhlIG5ld1xuLy8gcmFuZ2UtcHJlc2VydmluZyB1bmlmaWVkLWRpZmYgcGFyc2VyICh1bmlmaWVkLWRpZmYudHMpLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBUaGUgc2hhcmVkIGBwYXRjaGAvYGdpdCBhcHBseWAgb3B0aW9uIHN1cmZhY2UgKHBsYW4gXHUwMEE3NS43KTogc3RyaXAgbGV2ZWwsIHJlYWQtb25seSBhbmQgaW5kZXgtb25seSBtb2RlcywgYC0tZGlyZWN0b3J5YCwgYW5kIG9wZXJhbmRzLiAqL1xuaW50ZXJmYWNlIFBhdGNoQXBwbHlQYXJ0cyB7XG4gIHN0cmlwOiBQYXRoU3RyaXA7XG4gIHJlYWRPbmx5OiBib29sZWFuO1xuICBjYWNoZWRPbmx5OiBib29sZWFuO1xuICBkaXJlY3Rvcnk6IGJvb2xlYW47XG4gIG9wZXJhbmRzOiBzdHJpbmdbXTtcbn1cblxuZnVuY3Rpb24gcGF0Y2hBcHBseVBhcnRzKGFyZ3M6IHN0cmluZ1tdLCBpc0dpdEFwcGx5OiBib29sZWFuKTogUGF0Y2hBcHBseVBhcnRzIHtcbiAgbGV0IHN0cmlwOiBQYXRoU3RyaXAgPSBpc0dpdEFwcGx5ID8gMSA6ICdhdXRvJztcbiAgbGV0IHJlYWRPbmx5ID0gZmFsc2U7XG4gIGxldCBjYWNoZWRPbmx5ID0gZmFsc2U7XG4gIGxldCBkaXJlY3RvcnkgPSBmYWxzZTtcbiAgY29uc3Qgb3BlcmFuZHM6IHN0cmluZ1tdID0gW107XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYXJncy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmdzW2ldO1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaXNHaXRBcHBseSkge1xuICAgICAgaWYgKGEgPT09ICctLWNoZWNrJyB8fCBhID09PSAnLS1zdGF0JyB8fCBhID09PSAnLS1udW1zdGF0JyB8fCBhID09PSAnLS1zdW1tYXJ5Jykge1xuICAgICAgICByZWFkT25seSA9IHRydWU7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGEgPT09ICctLWNhY2hlZCcpIHtcbiAgICAgICAgY2FjaGVkT25seSA9IHRydWU7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGEgPT09ICctLWluZGV4JyB8fCBhID09PSAnLVInIHx8IGEgPT09ICctLXJldmVyc2UnIHx8IGEgPT09ICctLXVuc2FmZS1wYXRocycgfHwgYSA9PT0gJy0tcmVqZWN0JykgY29udGludWU7XG4gICAgICBpZiAoYSA9PT0gJy0tZGlyZWN0b3J5Jykge1xuICAgICAgICBkaXJlY3RvcnkgPSB0cnVlO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0tZGlyZWN0b3J5PScpKSB7XG4gICAgICAgIGRpcmVjdG9yeSA9IHRydWU7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGEgPT09ICctcCcpIHtcbiAgICAgICAgY29uc3QgdiA9IGFyZ3NbaSArIDFdO1xuICAgICAgICBpZiAodiAhPT0gdW5kZWZpbmVkICYmIC9eXFxkKyQvLnRlc3QodikpIHtcbiAgICAgICAgICBzdHJpcCA9IE51bWJlci5wYXJzZUludCh2LCAxMCk7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICB9XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKC9eLXBcXGQrJC8udGVzdChhKSkge1xuICAgICAgICBzdHJpcCA9IE51bWJlci5wYXJzZUludChhLnNsaWNlKDIpLCAxMCk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTtcbiAgICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gcGF0Y2hcbiAgICBpZiAoYSA9PT0gJy0tZHJ5LXJ1bicpIHtcbiAgICAgIHJlYWRPbmx5ID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1OJyB8fCBhID09PSAnLS1mb3J3YXJkJykgY29udGludWU7XG4gICAgaWYgKGEgPT09ICctcCcpIHtcbiAgICAgIGNvbnN0IHYgPSBhcmdzW2kgKyAxXTtcbiAgICAgIGlmICh2ICE9PSB1bmRlZmluZWQgJiYgL15cXGQrJC8udGVzdCh2KSkge1xuICAgICAgICBzdHJpcCA9IE51bWJlci5wYXJzZUludCh2LCAxMCk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoL14tcFxcZCskLy50ZXN0KGEpKSB7XG4gICAgICBzdHJpcCA9IE51bWJlci5wYXJzZUludChhLnNsaWNlKDIpLCAxMCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTtcbiAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICB9XG4gIHJldHVybiB7IHN0cmlwLCByZWFkT25seSwgY2FjaGVkT25seSwgZGlyZWN0b3J5LCBvcGVyYW5kcyB9O1xufVxuXG4vKiogVGhlIHBhdGNoIHRleHQgYXQgYGFic29sdXRlUGF0aGAsIG9yIG51bGwgd2hlbiBpdCBjYW4ndCBiZSByZWFkLiAqL1xuZnVuY3Rpb24gcmVhZFBhdGNoRmlsZShhYnNvbHV0ZVBhdGg6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICB0cnkge1xuICAgIHJldHVybiByZWFkRmlsZVN5bmMoYWJzb2x1dGVQYXRoLCAndXRmOCcpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKipcbiAqIEVtaXQgdGhlIHdyaXRlIHRvdWNoZXMgZm9yIGEgYHBhdGNoYC9gZ2l0IGFwcGx5YCBjb21tYW5kIHdpdGggYSBzdGF0aWNhbGx5XG4gKiBrbm93biBwYXRjaC10ZXh0IHNvdXJjZS4gYHRhcmdldERpcmAgaXMgd2hlcmUgdGhlIHBhdGNoJ3MgdGFyZ2V0IHBhdGhzXG4gKiByZXNvbHZlICh0aGUgZ2l0IGAtQ2AgZGlyZWN0b3J5IGZvciBgZ2l0IGFwcGx5YCwgdGhlIGN1cnJlbnQgZGlyZWN0b3J5XG4gKiBvdGhlcndpc2UpOyBgc2hlbGxEaXJgIGlzIHdoZXJlIHRoZSBzaGVsbCdzIHN0ZGluIGA8YCByZWRpcmVjdCB0YXJnZXRcbiAqIHJlc29sdmVzIFx1MjAxNCBhIHJlZGlyZWN0IGlzIHNoZWxsLXNpZGUsIHNvIGBnaXQgLUNgIG5ldmVyIGFmZmVjdHMgaXQuXG4gKi9cbmZ1bmN0aW9uIGVtaXRQYXRjaFRhcmdldHMoXG4gIGFyZ3M6IHN0cmluZ1tdLFxuICBpc0dpdEFwcGx5OiBib29sZWFuLFxuICBob3N0OiBzdHJpbmcsXG4gIHRhcmdldERpcjogc3RyaW5nLFxuICBzaGVsbERpcjogc3RyaW5nLFxuICByZWRpcmVjdHM6IFJlZGlyZWN0SW5mb1tdLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcGFydHMgPSBwYXRjaEFwcGx5UGFydHMoYXJncywgaXNHaXRBcHBseSk7XG4gIGlmIChwYXJ0cy5yZWFkT25seSB8fCBwYXJ0cy5jYWNoZWRPbmx5KSByZXR1cm47IC8vIHJlYWQtb25seSAvIGluZGV4LW9ubHkgXHUyMDE0IG5vIHRvdWNoZXNcbiAgaWYgKHBhcnRzLmRpcmVjdG9yeSkge1xuICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsICctLWRpcmVjdG9yeScsICctLWRpcmVjdG9yeSByZXdyaXRlcyBwYXRjaCBwYXRocycpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGxldCBwYXRjaFRleHQ6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBsZXQgc291cmNlOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgLy8gMS4gQSBsaXRlcmFsIHBhdGNoLWZpbGUgb3BlcmFuZCAoZ2l0IGFwcGx5IG9ubHk7IGEgcGF0Y2ggb3BlcmFuZCBpcyBhXG4gIC8vICAgIHRhcmdldCBmaWxlLCBub3QgYSBzb3VyY2UgXHUyMDE0IGlnbm9yZWQpLlxuICBpZiAoaXNHaXRBcHBseSkge1xuICAgIGNvbnN0IG9wZXJhbmQgPSBwYXJ0cy5vcGVyYW5kcy5maW5kKChvKSA9PiBvICE9PSAnLScpO1xuICAgIGlmIChvcGVyYW5kICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShvcGVyYW5kKSkge1xuICAgICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCBvcGVyYW5kLCAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgc291cmNlID0gcmVzb2x2ZVBhdGgodGFyZ2V0RGlyLCBvcGVyYW5kKTtcbiAgICAgIHBhdGNoVGV4dCA9IHJlYWRQYXRjaEZpbGUoc291cmNlKTtcbiAgICAgIGlmIChwYXRjaFRleHQgPT09IG51bGwpIHtcbiAgICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgc291cmNlLCAncGF0Y2ggZmlsZSB1bnJlYWRhYmxlIG9yIG1pc3NpbmcnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICAvLyAyLiBUaGUgc3RkaW4gYDxgIHNvdXJjZSAocGF0Y2ggYW5kIGdpdCBhcHBseSkuXG4gIGlmIChwYXRjaFRleHQgPT09IG51bGwpIHtcbiAgICBjb25zdCBzdGRpbiA9IHJlZGlyZWN0cy5maW5kKChyKSA9PiByLm9wID09PSAnPCcpO1xuICAgIGlmIChzdGRpbiAhPT0gdW5kZWZpbmVkICYmIHN0ZGluLnRhcmdldCAhPT0gbnVsbCkge1xuICAgICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKHN0ZGluLnRhcmdldCkpIHtcbiAgICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgc3RkaW4udGFyZ2V0LCAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgc291cmNlID0gcmVzb2x2ZVBhdGgoc2hlbGxEaXIsIHN0ZGluLnRhcmdldCk7XG4gICAgICBwYXRjaFRleHQgPSByZWFkUGF0Y2hGaWxlKHNvdXJjZSk7XG4gICAgICBpZiAocGF0Y2hUZXh0ID09PSBudWxsKSB7XG4gICAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsIHNvdXJjZSwgJ3BhdGNoIHRleHQgdW5yZWFkYWJsZSBvciBtaXNzaW5nJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgLy8gMy4gTm8gc3RhdGljYWxseSBrbm93biBzb3VyY2U6IHN0ZGluIGlzIGR5bmFtaWMgKHRlcm1pbmFsLCBwaXBlLCB2YXJpYWJsZSkuXG4gIGlmIChwYXRjaFRleHQgPT09IG51bGwpIHtcbiAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCBob3N0LCAnbm8gc3RhdGljYWxseSBrbm93biBwYXRjaCB0ZXh0IHNvdXJjZSAoc3RkaW4gaXMgZHluYW1pYyknKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCB0YXJnZXRzID0gcGFyc2VVbmlmaWVkRGlmZlJhbmdlKHBhdGNoVGV4dCwgcGFydHMuc3RyaXApO1xuICBpZiAodGFyZ2V0cyA9PT0gbnVsbCkge1xuICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsIHNvdXJjZSA/PyBob3N0LCAnbWFsZm9ybWVkIG9yIGVtcHR5IHBhdGNoIHRleHQnKTtcbiAgICByZXR1cm47XG4gIH1cbiAgZm9yIChjb25zdCB0IG9mIHRhcmdldHMpIHtcbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlVGFyZ2V0KHJlc3VsdHMsICdwYXRjaC13cml0ZScsIHQucGF0aCwgdGFyZ2V0RGlyKTtcbiAgICBpZiAoYWJzb2x1dGVQYXRoID09PSBudWxsKSBjb250aW51ZTtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206ICdwYXRjaC13cml0ZScsXG4gICAgICBzcGFuOiB7XG4gICAgICAgIG9wZXJhdGlvbjogdC5vcGVyYXRpb24sXG4gICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICBqb2luLFxuICAgICAgICAuLi4odC5saW5lU3RhcnQgIT09IHVuZGVmaW5lZCA/IHsgbGluZVN0YXJ0OiB0LmxpbmVTdGFydCwgbGluZUVuZDogdC5saW5lRW5kIH0gOiB7fSlcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBwYXRjaC9naXQgYXBwbHkgZ3JhbW1hciBpbiB0aGUgbWFpbiB3YWxrOiBgcGF0Y2hgIHJlYWRzIHBhdGNoIHRleHQgZnJvbVxuICogc3RkaW4gb3IgYSBgPGAgcmVkaXJlY3Q7IGBnaXQgYXBwbHlgIGFkZGl0aW9uYWxseSBhY2NlcHRzIGEgcGF0Y2gtZmlsZVxuICogb3BlcmFuZCBhbmQgcmVzb2x2ZXMgdGFyZ2V0cyBhZ2FpbnN0IGl0cyBgLUNgIGRpcmVjdG9yeS4gQSB3cmFwcGVkXG4gKiBgcGF0Y2hgL2BhcHBseWAgaXMgdW5yZXNvbHZlZCBcdTIwMTQgdGhlIHdyYXBwZXIgb2JzY3VyZXMgdGhlIGFyZ3YuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoUGF0Y2hBcHBseShcbiAgYXJndjogc3RyaW5nW10sXG4gIHJlZGlyZWN0czogUmVkaXJlY3RJbmZvW10sXG4gIGRpckZvclJlc29sdXRpb246IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHJlc3QgPSBzdHJpcFRyYW5zcGFyZW50V3JhcHBlcihhcmd2KTtcbiAgaWYgKHJlc3QubGVuZ3RoID09PSAwKSByZXR1cm47XG4gIGNvbnN0IGNvbW1hbmQgPSByZXN0WzBdO1xuICBpZiAoY29tbWFuZCA9PT0gJ3BhdGNoJykge1xuICAgIGVtaXRQYXRjaFRhcmdldHMoXG4gICAgICByZXN0LnNsaWNlKDEpLFxuICAgICAgZmFsc2UsXG4gICAgICAncGF0Y2gnLFxuICAgICAgZGlyRm9yUmVzb2x1dGlvbixcbiAgICAgIGRpckZvclJlc29sdXRpb24sXG4gICAgICByZWRpcmVjdHMsXG4gICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICBqb2luLFxuICAgICAgcmVzdWx0c1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChjb21tYW5kID09PSAnZ2l0Jykge1xuICAgIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKHJlc3Quc2xpY2UoMSkpO1xuICAgIGlmIChzdWIgPT09IG51bGwgfHwgc3ViLnN1YmNvbW1hbmQgIT09ICdhcHBseScpIHJldHVybjtcbiAgICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsICdhcHBseScsICdnaXQgLUMgdGFyZ2V0IGNvbnRhaW5zIGFuIHVucmVzb2x2ZWQgc2hlbGwgdmFyaWFibGUnKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZW1pdFBhdGNoVGFyZ2V0cyhcbiAgICAgIHJlc3Quc2xpY2UoMSkuc2xpY2Uoc3ViLnN1YklkeCArIDEpLFxuICAgICAgdHJ1ZSxcbiAgICAgICdhcHBseScsXG4gICAgICBzdWIuY0RpciA/PyBkaXJGb3JSZXNvbHV0aW9uLFxuICAgICAgZGlyRm9yUmVzb2x1dGlvbixcbiAgICAgIHJlZGlyZWN0cyxcbiAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgIGpvaW4sXG4gICAgICByZXN1bHRzXG4gICAgKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKEZPUkVJR05fV1JBUFBFUlMuaGFzKGNvbW1hbmQpKSB7XG4gICAgY29uc3Qgd3JhcHBlZCA9IHJlc3RbMV07XG4gICAgaWYgKHdyYXBwZWQgPT09ICdwYXRjaCcgfHwgd3JhcHBlZCA9PT0gJ2FwcGx5Jykge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgd3JhcHBlZCwgYHRoZSAke2NvbW1hbmR9IHdyYXBwZXIgb2JzY3VyZXMgdGhlICR7d3JhcHBlZH0gYXJndmApO1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFRoZSBoZXJlZG9jIHBhdGNoLXRleHQgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjcpOiBhIGBwYXRjaGAvYGdpdCBhcHBseWAgaGVyZWRvY1xuICogYm9keSBpcyBwYXRjaCB0ZXh0LiBUaGUgb3BlbmVyJ3Mgb3duIG9wdGlvbnMgc3RpbGwgYXBwbHkgXHUyMDE0IGAtLWRyeS1ydW5gL1xuICogYC0tY2hlY2tgL2AtLXN0YXRgL2AtLW51bXN0YXRgL2AtLXN1bW1hcnlgL2AtLWNhY2hlZGAgbWFrZSB0aGUgYm9keVxuICogcmVhZC1vbmx5IChubyB0b3VjaGVzKSwgYC0tZGlyZWN0b3J5YCBmYWlscyBjbG9zZWQsIGFuZCBgLXBOYCBzZXRzIHRoZVxuICogaGVhZGVyIHN0cmlwIGxldmVsLlxuICovXG5mdW5jdGlvbiBjbGFzc2lmeVBhdGNoSGVyZWRvYyhcbiAgYXJndjogc3RyaW5nW10sXG4gIGJvZHk6IHN0cmluZyxcbiAgY3VycmVudERpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcmVzdCA9IHN0cmlwVHJhbnNwYXJlbnRXcmFwcGVyKGFyZ3YpO1xuICBpZiAocmVzdC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgY29uc3QgY29tbWFuZCA9IHJlc3RbMF07XG4gIGxldCBpc0dpdEFwcGx5ID0gZmFsc2U7XG4gIGxldCBhcmdzOiBzdHJpbmdbXTtcbiAgbGV0IGRpciA9IGN1cnJlbnREaXI7XG4gIGlmIChjb21tYW5kID09PSAncGF0Y2gnKSB7XG4gICAgYXJncyA9IHJlc3Quc2xpY2UoMSk7XG4gIH0gZWxzZSBpZiAoY29tbWFuZCA9PT0gJ2dpdCcpIHtcbiAgICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChyZXN0LnNsaWNlKDEpKTtcbiAgICBpZiAoc3ViID09PSBudWxsIHx8IHN1Yi5zdWJjb21tYW5kICE9PSAnYXBwbHknKSByZXR1cm47XG4gICAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCAnYXBwbHknLCAnZ2l0IC1DIHRhcmdldCBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlzR2l0QXBwbHkgPSB0cnVlO1xuICAgIGFyZ3MgPSByZXN0LnNsaWNlKDEpLnNsaWNlKHN1Yi5zdWJJZHggKyAxKTtcbiAgICBkaXIgPSBzdWIuY0RpciA/PyBjdXJyZW50RGlyO1xuICB9IGVsc2Uge1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBwYXJ0cyA9IHBhdGNoQXBwbHlQYXJ0cyhhcmdzLCBpc0dpdEFwcGx5KTtcbiAgaWYgKHBhcnRzLnJlYWRPbmx5IHx8IHBhcnRzLmNhY2hlZE9ubHkpIHJldHVybjtcbiAgaWYgKHBhcnRzLmRpcmVjdG9yeSkge1xuICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsICctLWRpcmVjdG9yeScsICctLWRpcmVjdG9yeSByZXdyaXRlcyBwYXRjaCBwYXRocycpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB0YXJnZXRzID0gcGFyc2VVbmlmaWVkRGlmZlJhbmdlKGJvZHksIHBhcnRzLnN0cmlwKTtcbiAgaWYgKHRhcmdldHMgPT09IG51bGwpIHtcbiAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCAnaGVyZWRvYycsICdtYWxmb3JtZWQgb3IgZW1wdHkgcGF0Y2ggdGV4dCcpO1xuICAgIHJldHVybjtcbiAgfVxuICBmb3IgKGNvbnN0IHQgb2YgdGFyZ2V0cykge1xuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgdC5wYXRoLCBkaXIpO1xuICAgIGlmIChhYnNvbHV0ZVBhdGggPT09IG51bGwpIGNvbnRpbnVlO1xuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogJ3BhdGNoLXdyaXRlJyxcbiAgICAgIHNwYW46IHtcbiAgICAgICAgb3BlcmF0aW9uOiB0Lm9wZXJhdGlvbixcbiAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgIGpvaW4sXG4gICAgICAgIC4uLih0LmxpbmVTdGFydCAhPT0gdW5kZWZpbmVkID8geyBsaW5lU3RhcnQ6IHQubGluZVN0YXJ0LCBsaW5lRW5kOiB0LmxpbmVFbmQgfSA6IHt9KVxuICAgICAgfVxuICAgIH0pO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVGhlIGZvcm1hdHRlciAvIGZpeGVyIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS44KTogYSB0YWJsZS1kcml2ZW4gZmFtaWx5IG92ZXIgdGhlXG4vLyBjb3JwdXMtZGVyaXZlZCAxNi10b29sIHNldC4gRmxhZyBtYXRjaGluZyBpcyBleGFjdC10b2tlbiBvbiBmdWxsIGFyZ3Ygd29yZHMgXHUyMDE0XG4vLyBuZXZlciBwcmVmaXggb3Igc3Vic3RyaW5nIFx1MjAxNCBhbmQgdGhlIHJlYWQtb25seSBsaXN0IGlzIGNvbnN1bHRlZCBmaXJzdCwgc29cbi8vIGAtLWZpeC1kcnktcnVuYCBjYW4gbmV2ZXIgY29sbGlkZSB3aXRoIGAtLWZpeGAgYW5kIGBibGFjayAtLWNoZWNrYCBuZXZlclxuLy8gaGVhbHMuIFRvb2xzIHdob3NlIHdyaXRlIGZvcm0gaXMgYSBiYXJlIGludm9jYXRpb24gKGJsYWNrLCBpc29ydCwgcnVzdGZtdClcbi8vIGNhcnJ5IHRoZSBlbXB0eSBmb3JtIGFuZCBmaXJlIG9uIHRoZSB3cml0ZSBmb3JtIGl0c2VsZi4gTGVhZGluZyB0cmFuc3BhcmVudFxuLy8gcGFja2FnZS1ydW5uZXIgd3JhcHBlcnMgKG5weCwgeWFybiwgcG5wbSBleGVjL2RseCwgYnVueCwgbnBtIGV4ZWMpIHN0cmlwXG4vLyB1bmRlciBhIHBpbm5lZCBvcHRpb24gZ3JhbW1hcjsgYSB3cmFwcGVyIHRoYXQgY291bGQgcmV3cml0ZSBhcmd2IGZhaWxzXG4vLyBjbG9zZWQgYXMgdW5yZXNvbHZlZC5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogT25lIFx1MDBBNzUuOCB0YWJsZSByb3c6IHRoZSB0b29sIGNvbW1hbmQgYW5kIGl0cyB3cml0ZS9yZWFkLW9ubHkgdG9rZW4gZm9ybXMuICovXG5leHBvcnQgaW50ZXJmYWNlIEZvcm1hdHRlclRvb2xSb3cge1xuICBjb21tYW5kOiBzdHJpbmc7XG4gIC8qKiBUb2tlbiBzZXF1ZW5jZXMgd2hvc2UgZXhhY3QtdG9rZW4gcHJlc2VuY2UgbWFya3MgdGhlIGludm9jYXRpb24gYSB3cml0ZS4gKi9cbiAgd3JpdGVGb3Jtczogc3RyaW5nW11bXTtcbiAgLyoqIFRva2VuIHNlcXVlbmNlcyBjb25zdWx0ZWQgZmlyc3QgXHUyMDE0IHByZXNlbmNlIHN1cHByZXNzZXMgdGhlIHdyaXRlICh0aGUgcmVhZC1vbmx5IG1vZGUgd2lucykuICovXG4gIHJlYWRPbmx5Rm9ybXM6IHN0cmluZ1tdW107XG59XG5cbi8qKlxuICogVGhlIFx1MDBBNzUuOCB0YWJsZSwgZXhwb3J0ZWQgc28gdGhlIGNvcnB1cy1jb3ZlcmFnZSBmaXh0dXJlIGNhbiBhc3NlcnQgdHdvLXNpZGVkXG4gKiB0b29sLXNldCBlcXVhbGl0eSBhbmQgcGVyLXRvb2wgcmVhZC1vbmx5IHN1cHByZXNzaW9uIChwbGFuIFx1MDBBNzUuOCwgUGhhc2UgM1xuICogc3RlcCA4KS5cbiAqL1xuZXhwb3J0IGNvbnN0IEZPUk1BVFRFUl9UQUJMRTogcmVhZG9ubHkgRm9ybWF0dGVyVG9vbFJvd1tdID0gW1xuICB7XG4gICAgY29tbWFuZDogJ3ByZXR0aWVyJyxcbiAgICB3cml0ZUZvcm1zOiBbWyctLXdyaXRlJ10sIFsnLXcnXV0sXG4gICAgcmVhZE9ubHlGb3JtczogW1snLS1jaGVjayddLCBbJy0tbGlzdC1kaWZmZXJlbnQnXSwgWyctLWRlYnVnLWNoZWNrJ11dXG4gIH0sXG4gIHsgY29tbWFuZDogJ2VzbGludCcsIHdyaXRlRm9ybXM6IFtbJy0tZml4J11dLCByZWFkT25seUZvcm1zOiBbWyctLWZpeC1kcnktcnVuJ11dIH0sXG4gIHtcbiAgICBjb21tYW5kOiAnYmlvbWUnLFxuICAgIHdyaXRlRm9ybXM6IFtcbiAgICAgIFsnY2hlY2snLCAnLS13cml0ZSddLFxuICAgICAgWydjaGVjaycsICctLWZpeCddLFxuICAgICAgWydmb3JtYXQnLCAnLS13cml0ZSddXG4gICAgXSxcbiAgICByZWFkT25seUZvcm1zOiBbXVxuICB9LFxuICB7IGNvbW1hbmQ6ICdnb2ZtdCcsIHdyaXRlRm9ybXM6IFtbJy13J11dLCByZWFkT25seUZvcm1zOiBbWyctbCddXSB9LFxuICB7IGNvbW1hbmQ6ICdnb2ltcG9ydHMnLCB3cml0ZUZvcm1zOiBbWyctdyddXSwgcmVhZE9ubHlGb3JtczogW10gfSxcbiAgeyBjb21tYW5kOiAnY2xhbmctZm9ybWF0Jywgd3JpdGVGb3JtczogW1snLWknXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy0tZHJ5LXJ1biddXSB9LFxuICB7IGNvbW1hbmQ6ICdzaGZtdCcsIHdyaXRlRm9ybXM6IFtbJy13J11dLCByZWFkT25seUZvcm1zOiBbWyctZCddXSB9LFxuICB7IGNvbW1hbmQ6ICd5YXBmJywgd3JpdGVGb3JtczogW1snLWknXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy0tZGlmZiddXSB9LFxuICB7IGNvbW1hbmQ6ICdhdXRvcGVwOCcsIHdyaXRlRm9ybXM6IFtbJy1pJ11dLCByZWFkT25seUZvcm1zOiBbWyctZCddLCBbJy0tZGlmZiddXSB9LFxuICB7IGNvbW1hbmQ6ICdibGFjaycsIHdyaXRlRm9ybXM6IFtbXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy0tY2hlY2snXSwgWyctLWRpZmYnXV0gfSxcbiAgeyBjb21tYW5kOiAnaXNvcnQnLCB3cml0ZUZvcm1zOiBbW11dLCByZWFkT25seUZvcm1zOiBbWyctLWNoZWNrLW9ubHknXSwgWyctLWRpZmYnXV0gfSxcbiAge1xuICAgIGNvbW1hbmQ6ICdydWZmJyxcbiAgICB3cml0ZUZvcm1zOiBbWydmb3JtYXQnXSwgWydjaGVjaycsICctLWZpeCddXSxcbiAgICByZWFkT25seUZvcm1zOiBbXG4gICAgICBbJ2NoZWNrJywgJy0tbm8tZml4J10sXG4gICAgICBbJ2Zvcm1hdCcsICctLWNoZWNrJ11cbiAgICBdXG4gIH0sXG4gIHsgY29tbWFuZDogJ2Rlbm8nLCB3cml0ZUZvcm1zOiBbWydmbXQnXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJ2ZtdCcsICctLWNoZWNrJ11dIH0sXG4gIHsgY29tbWFuZDogJ2RwcmludCcsIHdyaXRlRm9ybXM6IFtbJ2ZtdCddXSwgcmVhZE9ubHlGb3JtczogW1snY2hlY2snXV0gfSxcbiAgeyBjb21tYW5kOiAncnVzdGZtdCcsIHdyaXRlRm9ybXM6IFtbXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy0tY2hlY2snXSwgWyctLWVtaXQnLCAnc3Rkb3V0J11dIH0sXG4gIHtcbiAgICBjb21tYW5kOiAndGVycmFmb3JtJyxcbiAgICB3cml0ZUZvcm1zOiBbWydmbXQnXV0sXG4gICAgcmVhZE9ubHlGb3JtczogW1xuICAgICAgWydmbXQnLCAnLWNoZWNrJ10sXG4gICAgICBbJ2ZtdCcsICctZGlmZiddXG4gICAgXVxuICB9XG5dO1xuXG4vKiogVGhlIHBpbm5lZCBwYWNrYWdlLXJ1bm5lciBuby1hcmcgZmxhZ3MgKHBsYW4gXHUwMEE3NS44KTogZmxhZ3MgdGhhdCBjYW5ub3QgbW92ZSBvciByZXdyaXRlIGFyZ3YuICovXG5jb25zdCBSVU5ORVJfTk9fQVJHX0ZMQUdTID0gbmV3IFNldChbJy15JywgJy0teWVzJywgJy0tbm8taW5zdGFsbCddKTtcblxuLyoqIFRoZSBvdXRjb21lIG9mIHN0cmlwcGluZyBvbmUgbGVhZGluZyBwYWNrYWdlLXJ1bm5lciB3cmFwcGVyLiAqL1xudHlwZSBSdW5uZXJTdHJpcCA9IHsga2luZDogJ3N0cmlwcGVkJzsgc3RyaXBwZWQ6IHN0cmluZ1tdIH0gfCB7IGtpbmQ6ICdvYnNjdXJlZCcgfTtcblxuLyoqXG4gKiBTdHJpcCBvbmUgbGVhZGluZyB0cmFuc3BhcmVudCBwYWNrYWdlLXJ1bm5lciB3cmFwcGVyIChwbGFuIFx1MDBBNzUuOCk6IGBucHhgLFxuICogYHlhcm5gLCBgcG5wbSBleGVjYC9gcG5wbSBkbHhgLCBgYnVueGAsIGFuZCBgbnBtIGV4ZWNgIGZvbGxvd2VkIGRpcmVjdGx5IGJ5XG4gKiB0aGUgd3JhcHBlZCBjb21tYW5kIHdvcmQsIHdpdGggb25seSB0aGUgcGlubmVkIG5vLWFyZyBmbGFncyAoYC15YC9gLS15ZXNgLFxuICogYC0tbm8taW5zdGFsbGApIGFuZCBgbnBtIGV4ZWNgJ3MgYC0tYCB0ZXJtaW5hdG9yIGJldHdlZW4uIEEgc3RyaW5nLWZvcm1cbiAqIGFyZ3VtZW50IChgbnB4IFwicHJldHRpZXIgLS13cml0ZSBmXCJgKSwgYW4gYXJndi1hbHRlcmluZyBydW5uZXIgZmxhZ1xuICogKGAtLXBhY2thZ2U9WGAgb3IgYSBmbGFnIGNvbnN1bWluZyB0aGUgbmV4dCB3b3JkKSwgb3IgYSB3cmFwcGVyIHdvcmQgdGhhdCBpc1xuICogaXRzZWxmIGEgc2NyaXB0IChgLmAtcHJlZml4ZWQpIG9ic2N1cmVzIHRoZSB3cmFwcGVkIGFyZ3YgXHUyMDE0IHRoZSB3cmFwcGVyIGlzXG4gKiB0cmFuc3BhcmVudCBvbmx5IHdoZW4gdGhlIHBpbm5lZCBncmFtbWFyIHByb3ZlcyBpdCBzby4gUmV0dXJucyAnbm90LXJ1bm5lcidcbiAqIHdoZW4gdGhlIHdvcmQgaXMgbm90IGEgcnVubmVyIGF0IGFsbCAoYSBkaWZmZXJlbnQgbnBtL3BucG0gc3ViY29tbWFuZCwgb3IgYVxuICogYmFyZSBydW5uZXIgd2l0aCBubyBjb21tYW5kIHdvcmQpIFx1MjAxNCB0aGUgdGFibGUgbWF0Y2hlcyBpdCBkaXJlY3RseSwgd2hpY2hcbiAqIGZhaWxzIGNsb3NlZCBmb3Igbm9uLWZvcm1hdHRlciBydW5uZXJzLlxuICovXG5mdW5jdGlvbiBzdHJpcFBhY2thZ2VSdW5uZXIoYXJndjogc3RyaW5nW10pOiBSdW5uZXJTdHJpcCB8ICdub3QtcnVubmVyJyB7XG4gIGNvbnN0IHJ1bm5lciA9IGFyZ3ZbMF07XG4gIGxldCByZXN0ID0gYXJndi5zbGljZSgxKTtcbiAgaWYgKHJ1bm5lciA9PT0gJ25weCcgfHwgcnVubmVyID09PSAneWFybicgfHwgcnVubmVyID09PSAnYnVueCcpIHtcbiAgICAvLyBUaGVzZSBydW5uZXJzIHRha2UgdGhlIGNvbW1hbmQgd29yZCBkaXJlY3RseS5cbiAgfSBlbHNlIGlmIChydW5uZXIgPT09ICdwbnBtJykge1xuICAgIGlmIChyZXN0WzBdICE9PSAnZXhlYycgJiYgcmVzdFswXSAhPT0gJ2RseCcpIHJldHVybiAnbm90LXJ1bm5lcic7XG4gICAgcmVzdCA9IHJlc3Quc2xpY2UoMSk7XG4gIH0gZWxzZSBpZiAocnVubmVyID09PSAnbnBtJykge1xuICAgIGlmIChyZXN0WzBdICE9PSAnZXhlYycpIHJldHVybiAnbm90LXJ1bm5lcic7XG4gICAgcmVzdCA9IHJlc3Quc2xpY2UoMSk7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuICdub3QtcnVubmVyJztcbiAgfVxuICB3aGlsZSAoUlVOTkVSX05PX0FSR19GTEFHUy5oYXMocmVzdFswXSkpIHJlc3QgPSByZXN0LnNsaWNlKDEpO1xuICBpZiAocnVubmVyID09PSAnbnBtJyAmJiByZXN0WzBdID09PSAnLS0nKSByZXN0ID0gcmVzdC5zbGljZSgxKTtcbiAgaWYgKHJlc3QubGVuZ3RoID09PSAwKSByZXR1cm4gJ25vdC1ydW5uZXInOyAvLyBhIGJhcmUgcnVubmVyIGF0dHJpYnV0ZXMgbm90aGluZ1xuICBjb25zdCB3cmFwcGVkID0gcmVzdFswXTtcbiAgaWYgKHdyYXBwZWQuc3RhcnRzV2l0aCgnLScpIHx8IHdyYXBwZWQuc3RhcnRzV2l0aCgnLicpIHx8IC9cXHMvLnRlc3Qod3JhcHBlZCkpIHJldHVybiB7IGtpbmQ6ICdvYnNjdXJlZCcgfTtcbiAgcmV0dXJuIHsga2luZDogJ3N0cmlwcGVkJywgc3RyaXBwZWQ6IHJlc3QgfTtcbn1cblxuLyoqXG4gKiBUaGUgZm9ybWF0dGVyL2ZpeGVyIGZhbWlseSAocGxhbiBcdTAwQTc1LjgpLiBUaGUgcmVhZC1vbmx5IGZvcm1zIGFyZSBjb25zdWx0ZWRcbiAqIGZpcnN0IGFuZCB3aW4gb3ZlciBhbnkgd3JpdGUgZm9ybTsgYSB3cml0ZSBmb3JtIHdpdGggbm8gcmVhZC1vbmx5IGZvcm0gYW5kXG4gKiBldmVyeSBvcGVyYW5kIGFuIGV4cGxpY2l0IGZpbGUgZW1pdHMgYSB3aG9sZS1maWxlIGBtb2RpZnlgIHBlciBvcGVyYW5kO1xuICogZGlyZWN0b3J5L2dsb2Ivbm8tb3BlcmFuZCBpbnZvY2F0aW9ucyB0b3VjaCBub3RoaW5nOyB1bmtub3duIGV4ZWN1dGFibGVzXG4gKiBmYWlsIGNsb3NlZC4gQSBmb3JtJ3MgbGVhZGluZyBzdWJjb21tYW5kIHdvcmQgKGBjaGVja2AvYGZvcm1hdGAvYGZtdGApIGlzXG4gKiBwb3NpdGlvbmFsIFx1MjAxNCBpdCBtdXN0IGxlYWQgdGhlIHRvb2wncyBhcmdzLCBzbyBgZGVubyB0YXNrIGZtdGAgaXMgYSBzY3JpcHRcbiAqIHJ1bm5lciwgbm90IGEgZm9ybWF0dGVyLlxuICovXG5mdW5jdGlvbiBtYXRjaEZvcm1hdHRlcihcbiAgYXJndjogc3RyaW5nW10sXG4gIGRpckZvclJlc29sdXRpb246IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHJlc3QgPSBzdHJpcFRyYW5zcGFyZW50V3JhcHBlcihhcmd2KTtcbiAgaWYgKHJlc3QubGVuZ3RoID09PSAwKSByZXR1cm47XG4gIGxldCB3b3JkcyA9IHJlc3Q7XG4gIGNvbnN0IHN0cmlwID0gc3RyaXBQYWNrYWdlUnVubmVyKHJlc3QpO1xuICBpZiAoc3RyaXAgPT09ICdub3QtcnVubmVyJykge1xuICAgIC8vIHJlc3RbMF0gaXMgbm90IGEgcGFja2FnZSBydW5uZXIgXHUyMDE0IHRoZSB0YWJsZSBtYXRjaGVzIGl0IGRpcmVjdGx5LlxuICB9IGVsc2UgaWYgKHN0cmlwLmtpbmQgPT09ICdvYnNjdXJlZCcpIHtcbiAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAnZm9ybWF0dGVyLXdyaXRlJywgcmVzdFswXSwgYHRoZSAke3Jlc3RbMF19IHdyYXBwZXIgb2JzY3VyZXMgdGhlIHdyYXBwZWQgYXJndmApO1xuICAgIHJldHVybjtcbiAgfSBlbHNlIHtcbiAgICB3b3JkcyA9IHN0cmlwLnN0cmlwcGVkO1xuICB9XG4gIGlmIChGT1JFSUdOX1dSQVBQRVJTLmhhcyh3b3Jkc1swXSkpIHtcbiAgICBjb25zdCB3cmFwcGVkID0gd29yZHNbMV07XG4gICAgaWYgKHdyYXBwZWQgIT09IHVuZGVmaW5lZCAmJiBGT1JNQVRURVJfVEFCTEUuc29tZSgocikgPT4gci5jb21tYW5kID09PSB3cmFwcGVkKSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ2Zvcm1hdHRlci13cml0ZScsIHdyYXBwZWQsIGB0aGUgJHt3b3Jkc1swXX0gd3JhcHBlciBvYnNjdXJlcyB0aGUgJHt3cmFwcGVkfSBhcmd2YCk7XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCByb3cgPSBGT1JNQVRURVJfVEFCTEUuZmluZCgocikgPT4gci5jb21tYW5kID09PSB3b3Jkc1swXSk7XG4gIGlmIChyb3cgPT09IHVuZGVmaW5lZCkgcmV0dXJuOyAvLyB1bmtub3duIGV4ZWN1dGFibGUgXHUyMDE0IGZhaWwgY2xvc2VkLCBubyB0b3VjaFxuICBjb25zdCBhcmdzID0gd29yZHMuc2xpY2UoMSk7XG4gIGNvbnN0IGZvcm1QcmVzZW50ID0gKGZvcm06IHN0cmluZ1tdKTogYm9vbGVhbiA9PiB7XG4gICAgY29uc3QgZmlyc3QgPSBmb3JtWzBdO1xuICAgIGlmIChmaXJzdCAhPT0gdW5kZWZpbmVkICYmICFmaXJzdC5zdGFydHNXaXRoKCctJykgJiYgYXJnc1swXSAhPT0gZmlyc3QpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gZm9ybS5ldmVyeSgodG9rZW4pID0+IGFyZ3MuaW5jbHVkZXModG9rZW4pKTtcbiAgfTtcbiAgLy8gVGhlIHJlYWQtb25seSBsaXN0IGlzIGNvbnN1bHRlZCBmaXJzdCBhbmQgd2lucyBvdmVyIGFueSB3cml0ZSBmb3JtOlxuICAvLyBgZXNsaW50IC0tZml4IC0tZml4LWRyeS1ydW4gZmAgd3JpdGVzIG5vdGhpbmcsIGBibGFjayAtLWNoZWNrIGZgIG5ldmVyIGhlYWxzLlxuICBpZiAocm93LnJlYWRPbmx5Rm9ybXMuc29tZShmb3JtUHJlc2VudCkpIHJldHVybjtcbiAgaWYgKCFyb3cud3JpdGVGb3Jtcy5zb21lKGZvcm1QcmVzZW50KSkgcmV0dXJuOyAvLyBiYXJlIGludm9jYXRpb25zIG9mIGZsYWctcmVxdWlyZWQgdG9vbHMgYXJlIHJlYWQtb25seSAoc3Rkb3V0L2xpbnQpXG4gIC8vIENvbnN1bWUgdGhlIHRvb2wncyBzdWJjb21tYW5kIHdvcmQgYmVmb3JlIGNvbGxlY3Rpbmcgb3BlcmFuZHMuXG4gIGNvbnN0IHN1YmNvbW1hbmRXb3JkcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBmb3IgKGNvbnN0IGZvcm0gb2Ygcm93LndyaXRlRm9ybXMpIHtcbiAgICBmb3IgKGNvbnN0IHRva2VuIG9mIGZvcm0pIHtcbiAgICAgIGlmICghdG9rZW4uc3RhcnRzV2l0aCgnLScpKSBzdWJjb21tYW5kV29yZHMuYWRkKHRva2VuKTtcbiAgICB9XG4gIH1cbiAgY29uc3QgYWZ0ZXJTdWJjb21tYW5kID0gc3ViY29tbWFuZFdvcmRzLmhhcyhhcmdzWzBdKSA/IGFyZ3Muc2xpY2UoMSkgOiBhcmdzO1xuICBsZXQgYWZ0ZXJEYXNoRGFzaCA9IGZhbHNlO1xuICBjb25zdCBvcGVyYW5kczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBhIG9mIGFmdGVyU3ViY29tbWFuZCkge1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlOyAvLyB1bmtub3duIG9wdGlvbiBcdTIxOTIgdHJlYXRlZCBhcyBhbiBvcHRpb24gKHNoYXJlZCBcdTAwQTc1KVxuICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gIH1cbiAgaWYgKG9wZXJhbmRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuOyAvLyBuby1vcGVyYW5kIGludm9jYXRpb25zIHRvdWNoIG5vdGhpbmdcbiAgLy8gRXZlcnkgb3BlcmFuZCBtdXN0IGJlIGFuIGV4cGxpY2l0IGZpbGUgXHUyMDE0IGEgZ2xvYiwgdmFyaWFibGUsIGRpcmVjdG9yeSwgb3JcbiAgLy8gdHJhaWxpbmctc2xhc2ggb3BlcmFuZCBmYWlscyB0aGUgd2hvbGUgY29tbWFuZCBjbG9zZWQuXG4gIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBvcGVyYW5kcykge1xuICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShvcGVyYW5kKSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ2Zvcm1hdHRlci13cml0ZScsIG9wZXJhbmQsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAob3BlcmFuZC5lbmRzV2l0aCgnLycpIHx8IGlzRXhpc3RpbmdEaXJlY3RvcnkocmVzb2x2ZVBhdGgoZGlyRm9yUmVzb2x1dGlvbiwgb3BlcmFuZCkpKSByZXR1cm47XG4gIH1cbiAgZm9yIChjb25zdCBvcGVyYW5kIG9mIG9wZXJhbmRzKSB7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiAnZm9ybWF0dGVyLXdyaXRlJyxcbiAgICAgIHNwYW46IHsgb3BlcmF0aW9uOiAnbW9kaWZ5JywgYWJzb2x1dGVQYXRoOiByZXNvbHZlUGF0aChkaXJGb3JSZXNvbHV0aW9uLCBvcGVyYW5kKSwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICB9KTtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRoZSBnaXQgcmVzdG9yZSAvIGdpdCBjaGVja291dCBncmFtbWFyIChwbGFuIFx1MDBBNzUuOSksIHRoZSBsYXN0IHB1cmUtcGFyc2VyXG4vLyBmYW1pbHkuIFJlc3RvcmUgaGFzIG5vIHJldmlzaW9uIG9wZXJhbmQgZm9ybSBcdTIwMTQgaXRzIHBvc2l0aW9uYWwgYXJncyBhcmVcbi8vIGFsd2F5cyBwYXRoc3BlY3M7IGNoZWNrb3V0IHNraXBzIGEgcHJlLWAtLWAgcmV2aXNpb24vcmVmIG9wZXJhbmQgYW5kIHRha2VzXG4vLyBwYXRoc3BlY3Mgb25seSBhZnRlciBgLS1gLiBFdmVyeSBleHBsaWNpdC1maWxlIHBhdGhzcGVjIGlzIGEgd2hvbGUtZmlsZVxuLy8gY3JlYXRlLW92ZXJ3cml0ZSB0b3VjaDsgYSBkaXJlY3Rvcnktc2hhcGVkIHBhdGhzcGVjIChgLmAvYC4uYCwgdHJhaWxpbmcgYC9gLFxuLy8gb3IgYSBwYXRoIHRoYXQgc3RhdHMgYXMgYSBkaXJlY3RvcnkpLCBgLS1zdGFnZWRgLW9ubHkgcmVzdG9yZSwgYW5kXG4vLyBgLXBgL2AtLXBhdGNoYCBpbnRlcmFjdGl2ZSBodW5rIHNlbGVjdGlvbiBhbGwgZmFpbCBjbG9zZWQuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIGdpdCByZXN0b3JlIG5vLXZhbHVlIGZsYWdzIChwbGFuIFx1MDBBNzUuOSk7IGAtc2AvYC0tc291cmNlYCwgYC0tc3RhZ2VkYCwgYC1XYC9gLS13b3JrdHJlZWAsIGAtbWAvYC0tbWVyZ2VgLCBhbmQgYC1wYC9gLS1wYXRjaGAgYXJlIGhhbmRsZWQgZXhwbGljaXRseS4gKi9cbmNvbnN0IFJFU1RPUkVfTk9fVkFMVUUgPSBuZXcgU2V0KFsnLXEnLCAnLWYnLCAnLXUnXSk7XG5cbi8qKlxuICogVGhlIHNoYXJlZCByZXN0b3JlL2NoZWNrb3V0IHBhdGhzcGVjIGVtaXNzaW9uIChwbGFuIFx1MDBBNzUuOSk6IGFuIGV4cGxpY2l0LWZpbGVcbiAqIHBhdGhzcGVjIChubyBnbG9icywgbm8gYC5gL2AuLmAsIG5vIGRpcmVjdG9yeSwgbm8gdHJhaWxpbmcgYC9gKSBpcyBhXG4gKiBjcmVhdGUtb3ZlcndyaXRlIHdob2xlLWZpbGUgdG91Y2g7IGEgZGlyZWN0b3J5LXNoYXBlZCBwYXRoc3BlYyBpc1xuICogdW5yZXNvbHZlZCBcdTIwMTQgYSBkaXJlY3RvcnkgcmVzdG9yZS9jaGVja291dCByZXdyaXRlcyBhcmJpdHJhcnkgZmlsZXMgYmVuZWF0aFxuICogaXQgYW5kIGNhbm5vdCBiZSBhdHRyaWJ1dGVkIHRvIGEgZmlsZSB3cml0ZS5cbiAqL1xuZnVuY3Rpb24gZW1pdFJlc3RvcmVDaGVja291dFBhdGhzcGVjKFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXSxcbiAgaWRpb206ICdnaXQtcmVzdG9yZS13cml0ZScgfCAnZ2l0LWNoZWNrb3V0LXdyaXRlJyxcbiAgb3BlcmFuZDogc3RyaW5nLFxuICBkaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddXG4pOiB2b2lkIHtcbiAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKG9wZXJhbmQpKSB7XG4gICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgaWRpb20sIG9wZXJhbmQsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlUGF0aChkaXIsIG9wZXJhbmQpO1xuICBpZiAob3BlcmFuZCA9PT0gJy4nIHx8IG9wZXJhbmQgPT09ICcuLicgfHwgb3BlcmFuZC5lbmRzV2l0aCgnLycpIHx8IGlzRXhpc3RpbmdEaXJlY3RvcnkoYWJzb2x1dGVQYXRoKSkge1xuICAgIHB1c2hVbnJlc29sdmVkKFxuICAgICAgcmVzdWx0cyxcbiAgICAgIGlkaW9tLFxuICAgICAgb3BlcmFuZCxcbiAgICAgICdkaXJlY3Rvcnktc2hhcGVkIHBhdGhzcGVjIHJld3JpdGVzIGFyYml0cmFyeSBmaWxlcyBiZW5lYXRoIGl0IFx1MjAxNCBub3QgYXR0cmlidXRhYmxlIHRvIGEgZmlsZSB3cml0ZSdcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuICByZXN1bHRzLnB1c2goe1xuICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICBpZGlvbSxcbiAgICBzcGFuOiB7IG9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnLCBhYnNvbHV0ZVBhdGgsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gIH0pO1xufVxuXG4vKipcbiAqIFRoZSBnaXQgcmVzdG9yZSBvcGVyYW5kIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS45KTogYC1zYC9gLS1zb3VyY2U9PHRyZWU+YCBpc1xuICogdmFsdWUtdGFraW5nIFx1MjAxNCB0aGUgdHJlZSBvcGVyYW5kIG5ldmVyIHJlc29sdmVzIGFzIGEgcGF0aHNwZWM7IGAtcGAvYC0tcGF0Y2hgXG4gKiBpbnRlcmFjdGl2ZSBodW5rIHNlbGVjdGlvbiBpcyB1bnJlc29sdmVkOyBgLW1gL2AtLW1lcmdlYCAodGhlIG1lcmdlXG4gKiBtYWNoaW5lcnksIGNvbmRpdGlvbmFsIG9uIHRoZSBpbmRleCBiZWluZyB1bm1lcmdlZCkgYW5kIGAtLXN0YWdlZGAgd2l0aG91dFxuICogYC0td29ya3RyZWVgIChpbmRleC1vbmx5IFx1MjAxNCB0aGUgd29ya2luZyBmaWxlIHN1cnZpdmVzKSB0b3VjaCBub3RoaW5nLlxuICovXG5mdW5jdGlvbiBtYXRjaFJlc3RvcmVPcGVyYW5kcyhcbiAgYXJnczogc3RyaW5nW10sXG4gIGRpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgbGV0IHN0YWdlZCA9IGZhbHNlO1xuICBsZXQgd29ya3RyZWUgPSBmYWxzZTtcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcbiAgY29uc3Qgb3BlcmFuZHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYXJncy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmdzW2ldO1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1wJyB8fCBhID09PSAnLS1wYXRjaCcpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKFxuICAgICAgICByZXN1bHRzLFxuICAgICAgICAnZ2l0LXJlc3RvcmUtd3JpdGUnLFxuICAgICAgICBhLFxuICAgICAgICAnaW50ZXJhY3RpdmUgcGF0Y2ggbW9kZSBhcHBsaWVzIHVzZXItY2hvc2VuIGh1bmtzIFx1MjAxNCBubyBzdGF0aWMgc3BhbidcbiAgICAgICk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmIChhID09PSAnLXMnIHx8IGEgPT09ICctLXNvdXJjZScpIHtcbiAgICAgIGkgKz0gMTsgLy8gdGhlIHRyZWUgb3BlcmFuZCBpcyBuZXZlciBhIHBhdGhzcGVjXG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLS1zb3VyY2U9JykpIGNvbnRpbnVlO1xuICAgIGlmIChhID09PSAnLW0nIHx8IGEgPT09ICctLW1lcmdlJykgcmV0dXJuO1xuICAgIGlmIChhID09PSAnLS1zdGFnZWQnKSB7XG4gICAgICBzdGFnZWQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLVcnIHx8IGEgPT09ICctLXdvcmt0cmVlJykge1xuICAgICAgd29ya3RyZWUgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChSRVNUT1JFX05PX1ZBTFVFLmhhcyhhKSkgY29udGludWU7XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTsgLy8gdW5rbm93biBvcHRpb24gXHUyMTkyIHRyZWF0ZWQgYXMgYW4gb3B0aW9uIChmYWlsIGNsb3NlZClcbiAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICB9XG4gIGlmIChzdGFnZWQgJiYgIXdvcmt0cmVlKSByZXR1cm47IC8vIGluZGV4LW9ubHkgcmVzdG9yZSBkb2VzIG5vdCB0b3VjaCB0aGUgd29ya2luZyBmaWxlXG4gIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBvcGVyYW5kcykge1xuICAgIGVtaXRSZXN0b3JlQ2hlY2tvdXRQYXRoc3BlYyhyZXN1bHRzLCAnZ2l0LXJlc3RvcmUtd3JpdGUnLCBvcGVyYW5kLCBkaXIsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbik7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgZ2l0IGNoZWNrb3V0IG9wZXJhbmQgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjkpOiBgLWJgL2AtQmAvYC0tb3JwaGFuIDxicmFuY2g+YFxuICogYXJlIHZhbHVlLXRha2luZyBcdTIwMTQgdGhlIGJyYW5jaCBuYW1lIG5ldmVyIHJlc29sdmVzIGFzIGEgcGF0aHNwZWM7IGAtcGAvXG4gKiBgLS1wYXRjaGAgaW50ZXJhY3RpdmUgaHVuayBzZWxlY3Rpb24gaXMgdW5yZXNvbHZlZDsgYSBwcmUtYC0tYCBwb3NpdGlvbmFsIGlzXG4gKiBhIHJldmlzaW9uL3JlZiBvcGVyYW5kIGFuZCBpcyBza2lwcGVkLiBQYXRoc3BlY3Mgb25seSBhZnRlciBgLS1gLlxuICovXG5mdW5jdGlvbiBtYXRjaENoZWNrb3V0T3BlcmFuZHMoXG4gIGFyZ3M6IHN0cmluZ1tdLFxuICBkaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG4gIGNvbnN0IG9wZXJhbmRzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJnc1tpXTtcbiAgICBpZiAoYWZ0ZXJEYXNoRGFzaCkge1xuICAgICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctcCcgfHwgYSA9PT0gJy0tcGF0Y2gnKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChcbiAgICAgICAgcmVzdWx0cyxcbiAgICAgICAgJ2dpdC1jaGVja291dC13cml0ZScsXG4gICAgICAgIGEsXG4gICAgICAgICdpbnRlcmFjdGl2ZSBwYXRjaCBtb2RlIGFwcGxpZXMgdXNlci1jaG9zZW4gaHVua3MgXHUyMDE0IG5vIHN0YXRpYyBzcGFuJ1xuICAgICAgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctYicgfHwgYSA9PT0gJy1CJyB8fCBhID09PSAnLS1vcnBoYW4nKSB7XG4gICAgICBpICs9IDE7IC8vIHRoZSBicmFuY2ggbmFtZSBpcyBuZXZlciBhIHBhdGhzcGVjXG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctZicgfHwgYSA9PT0gJy1xJyB8fCBhID09PSAnLW0nIHx8IGEgPT09ICctdCcpIGNvbnRpbnVlO1xuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7IC8vIHVua25vd24gb3B0aW9uIFx1MjE5MiB0cmVhdGVkIGFzIGFuIG9wdGlvbiAoZmFpbCBjbG9zZWQpXG4gICAgLy8gQSBwcmUtYC0tYCBwb3NpdGlvbmFsIGlzIGEgcmV2aXNpb24vcmVmIG9wZXJhbmQgXHUyMDE0IG5ldmVyIGEgcGF0aHNwZWMuXG4gIH1cbiAgZm9yIChjb25zdCBvcGVyYW5kIG9mIG9wZXJhbmRzKSB7XG4gICAgZW1pdFJlc3RvcmVDaGVja291dFBhdGhzcGVjKHJlc3VsdHMsICdnaXQtY2hlY2tvdXQtd3JpdGUnLCBvcGVyYW5kLCBkaXIsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbik7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgZ2l0IHJlc3RvcmUgLyBnaXQgY2hlY2tvdXQgZmFtaWx5IChwbGFuIFx1MDBBNzUuOSk6IHZpYSBgZmluZEdpdFN1YmNvbW1hbmRgXG4gKiAoaGFuZGxlcyBgZ2l0IC1DYC9gLWNgKSwgdGhlIHR3byBzdWJjb21tYW5kcyByZXNvbHZlIHRoZWlyIHBhdGhzcGVjcyB0b1xuICogd2hvbGUtZmlsZSBjcmVhdGUtb3ZlcndyaXRlIHRvdWNoZXM7IGEgd3JhcHBlZCBzdWJjb21tYW5kIGZhaWxzIGNsb3NlZC5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hHaXRSZXN0b3JlQ2hlY2tvdXQoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBkaXJGb3JSZXNvbHV0aW9uOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCByZXN0ID0gc3RyaXBUcmFuc3BhcmVudFdyYXBwZXIoYXJndik7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICBjb25zdCBjb21tYW5kID0gcmVzdFswXTtcbiAgaWYgKGNvbW1hbmQgPT09ICdnaXQnKSB7XG4gICAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQocmVzdC5zbGljZSgxKSk7XG4gICAgaWYgKHN1YiA9PT0gbnVsbCB8fCAoc3ViLnN1YmNvbW1hbmQgIT09ICdyZXN0b3JlJyAmJiBzdWIuc3ViY29tbWFuZCAhPT0gJ2NoZWNrb3V0JykpIHJldHVybjtcbiAgICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKFxuICAgICAgICByZXN1bHRzLFxuICAgICAgICBzdWIuc3ViY29tbWFuZCA9PT0gJ3Jlc3RvcmUnID8gJ2dpdC1yZXN0b3JlLXdyaXRlJyA6ICdnaXQtY2hlY2tvdXQtd3JpdGUnLFxuICAgICAgICBzdWIuc3ViY29tbWFuZCxcbiAgICAgICAgJ2dpdCAtQyB0YXJnZXQgY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZSdcbiAgICAgICk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGRpciA9IHN1Yi5jRGlyID8/IGRpckZvclJlc29sdXRpb247XG4gICAgY29uc3QgYXJncyA9IHJlc3Quc2xpY2UoMSkuc2xpY2Uoc3ViLnN1YklkeCArIDEpO1xuICAgIGlmIChzdWIuc3ViY29tbWFuZCA9PT0gJ3Jlc3RvcmUnKSBtYXRjaFJlc3RvcmVPcGVyYW5kcyhhcmdzLCBkaXIsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiwgcmVzdWx0cyk7XG4gICAgZWxzZSBtYXRjaENoZWNrb3V0T3BlcmFuZHMoYXJncywgZGlyLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoRk9SRUlHTl9XUkFQUEVSUy5oYXMoY29tbWFuZCkpIHtcbiAgICBjb25zdCB3cmFwcGVkID0gcmVzdFsxXTtcbiAgICBpZiAod3JhcHBlZCA9PT0gJ3Jlc3RvcmUnIHx8IHdyYXBwZWQgPT09ICdjaGVja291dCcpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKFxuICAgICAgICByZXN1bHRzLFxuICAgICAgICB3cmFwcGVkID09PSAncmVzdG9yZScgPyAnZ2l0LXJlc3RvcmUtd3JpdGUnIDogJ2dpdC1jaGVja291dC13cml0ZScsXG4gICAgICAgIHdyYXBwZWQsXG4gICAgICAgIGB0aGUgJHtjb21tYW5kfSB3cmFwcGVyIG9ic2N1cmVzIHRoZSAke3dyYXBwZWR9IGFyZ3ZgXG4gICAgICApO1xuICAgIH1cbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE9yY2hlc3RyYXRvclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IExJTkVfU0VMRUNUT1JTID0gW21hdGNoU2VkLCBtYXRjaEhlYWQsIG1hdGNoVGFpbF07XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNvbW1hbmREZXRhaWxlZChjb21tYW5kOiBzdHJpbmcsIGN3ZDogc3RyaW5nID0gcHJvY2Vzcy5jd2QoKSk6IFNwYW5NYXRjaFtdIHtcbiAgY29uc3QgeyB3cml0ZXM6IGhlcmVkb2NXcml0ZXMsIG1hc2tlZCB9ID0gZXh0cmFjdEhlcmVkb2NXcml0ZXMoY29tbWFuZCk7XG4gIGNvbnN0IHNpbXBsZUNvbW1hbmRzID0gc3BsaXRUb3BMZXZlbChtYXNrZWQpO1xuXG4gIGNvbnN0IHJlc3VsdHM6IFNwYW5NYXRjaFtdID0gW107XG4gIGNvbnN0IGZzTGluZUNhY2hlID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlciB8IG51bGw+KCk7XG4gIGNvbnN0IGdpdExpbmVDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXIgfCBudWxsPigpO1xuXG4gIGNvbnN0IGNhY2hlZEZzVG90YWxMaW5lcyA9IChhYnNQYXRoOiBzdHJpbmcpID0+ICgpID0+IHtcbiAgICBpZiAoIWZzTGluZUNhY2hlLmhhcyhhYnNQYXRoKSkgZnNMaW5lQ2FjaGUuc2V0KGFic1BhdGgsIGNvdW50RmlsZUxpbmVzKGFic1BhdGgpKTtcbiAgICByZXR1cm4gZnNMaW5lQ2FjaGUuZ2V0KGFic1BhdGgpID8/IG51bGw7XG4gIH07XG4gIGNvbnN0IGNhY2hlZEdpdFRvdGFsTGluZXMgPSAoZ2l0Q3dkOiBzdHJpbmcsIHJldjogc3RyaW5nLCBwYXRoOiBzdHJpbmcpID0+ICgpID0+IHtcbiAgICBjb25zdCBrZXkgPSBgJHtnaXRDd2R9XHUwMDAwJHtyZXZ9XHUwMDAwJHtwYXRofWA7XG4gICAgaWYgKCFnaXRMaW5lQ2FjaGUuaGFzKGtleSkpIGdpdExpbmVDYWNoZS5zZXQoa2V5LCBjb3VudEdpdEJsb2JMaW5lcyhnaXRDd2QsIHJldiwgcGF0aCkpO1xuICAgIHJldHVybiBnaXRMaW5lQ2FjaGUuZ2V0KGtleSkgPz8gbnVsbDtcbiAgfTtcblxuICBsZXQgY3VycmVudERpciA9IGN3ZDtcbiAgbGV0IGxhc3RQbGFpbkZpbGVTb3VyY2U6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAvLyBUaGUgb25lLWhvcCBsaXRlcmFsIGVjaG8vcHJpbnRmIHBpcGUgc291cmNlIChwbGFuIFx1MDBBNzUuMik6IHNldCBhdCB0aGUgZW5kIG9mXG4gIC8vIGVhY2ggc2ltcGxlIGNvbW1hbmQsIGNsZWFyZWQgYXQgYW55IG5vbi1waXBlIGJvdW5kYXJ5LCB0aHJlYWRlZCBieSB0ZWUgLWFcbiAgLy8gYXBwZW5kcyBpbiB0aGUgbmV4dCBwaXBlIHN0YWdlIChgZWNobyB4IHwgdGVlIC1hIGZgKS5cbiAgbGV0IHBpcGVFY2hvQ29udGVudDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG5cbiAgLyoqIFRoZSBgam9pbmAgc3RhbXAgZm9yIGEgc2ltcGxlIGNvbW1hbmQ6IG9ubHkgdGhlIGNvbmRpdGlvbmFsIG9wZXJhdG9ycyBnYXRlIChwbGFuIFx1MDBBNzMgc3RlcCAyKS4gKi9cbiAgY29uc3Qgam9pbk9mID0gKHNpbXBsZTogU2ltcGxlQ29tbWFuZCk6IFJlc29sdmVkU3Bhblsnam9pbiddID0+XG4gICAgc2ltcGxlLnByZWNlZGVkQnkgPT09ICcmJicgfHwgc2ltcGxlLnByZWNlZGVkQnkgPT09ICd8fCcgPyBzaW1wbGUucHJlY2VkZWRCeSA6IHVuZGVmaW5lZDtcblxuICBjb25zdCBlbWl0Q2FuZGlkYXRlID0gKFxuICAgIGM6IFJhd0NhbmRpZGF0ZSxcbiAgICBkaXJGb3JSZXNvbHV0aW9uOiBzdHJpbmcsXG4gICAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gICAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ11cbiAgKSA9PiB7XG4gICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKGMuZmlsZUFyZykpIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogYy5pZGlvbSxcbiAgICAgICAgZmlsZUFyZzogYy5maWxlQXJnLFxuICAgICAgICByZWFzb246ICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYidcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlUGF0aChkaXJGb3JSZXNvbHV0aW9uLCBjLmZpbGVBcmcpO1xuICAgIGNvbnN0IHRvdGFsTGluZXMgPVxuICAgICAgYy5yZXNvbHZlcktpbmQgPT09ICdmcydcbiAgICAgICAgPyBjYWNoZWRGc1RvdGFsTGluZXMoYWJzb2x1dGVQYXRoKVxuICAgICAgICA6IGNhY2hlZEdpdFRvdGFsTGluZXMoYy5kaXJPdmVycmlkZSA/PyBkaXJGb3JSZXNvbHV0aW9uLCBjLnJlc29sdmVyS2luZC5yZXYsIGMuZmlsZUFyZyk7XG4gICAgY29uc3QgcmFuZ2UgPSByZXNvbHZlU3BlYyhjLnNwZWMsIHRvdGFsTGluZXMpO1xuICAgIGlmIChyYW5nZSA9PT0gbnVsbCkge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiBjLmlkaW9tLFxuICAgICAgICBmaWxlQXJnOiBhYnNvbHV0ZVBhdGgsXG4gICAgICAgIHJlYXNvbjogJ2NvdWxkIG5vdCBkZXRlcm1pbmUgZW5kLW9mLWZpbGUgbGluZSBjb3VudCAoZmlsZSB1bnJlYWRhYmxlLCBlbXB0eSwgb3IgZ2l0IHJldi9wYXRoIG5vdCBmb3VuZCknXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiBjLmlkaW9tLFxuICAgICAgc3Bhbjoge1xuICAgICAgICBvcGVyYXRpb246ICdyZWFkJyxcbiAgICAgICAgbGluZVN0YXJ0OiByYW5nZS5saW5lU3RhcnQsXG4gICAgICAgIGxpbmVFbmQ6IHJhbmdlLmxpbmVFbmQsXG4gICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICBqb2luXG4gICAgICB9XG4gICAgfSk7XG4gIH07XG5cbiAgLyoqXG4gICAqIFRoZSByZWFkIGlkaW9tcyBmb3Igb25lIHNpbXBsZSBjb21tYW5kICh0aGUgZXhpc3RpbmcgY29ycHVzIGdyYW1tYXIpOlxuICAgKiBwbGFpbiBgY2F0YC9gbmxgIHNvdXJjZXMsIHRoZSBsaW5lIHNlbGVjdG9ycywgYW5kIHRoZSBnaXQgbWF0Y2hlcnMsIHdpdGhcbiAgICogb25lLWhvcCBwaXBlLXNvdXJjZSBwcm9wYWdhdGlvbiBmb3IgZG93bnN0cmVhbSBgaGVhZGAvYHRhaWxgL2BzZWQgLW5gLlxuICAgKi9cbiAgY29uc3QgbWF0Y2hSZWFkcyA9IChzaW1wbGU6IFNpbXBsZUNvbW1hbmQsIGFyZ3Y6IHN0cmluZ1tdLCBpOiBudW1iZXIpOiB2b2lkID0+IHtcbiAgICBsZXQgaXNQbGFpblNvdXJjZSA9IGZhbHNlO1xuICAgIGxldCBwbGFpbkZpbGVBcmc6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAgIGlmIChhcmd2WzBdID09PSAnY2F0JyAmJiBhcmd2Lmxlbmd0aCA9PT0gMiAmJiAhYXJndlsxXS5zdGFydHNXaXRoKCctJykpIHtcbiAgICAgIGlzUGxhaW5Tb3VyY2UgPSB0cnVlO1xuICAgICAgcGxhaW5GaWxlQXJnID0gYXJndlsxXTtcbiAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBoYXNTaGVsbEV4cGFuc2lvbihhcmd2WzFdKSA/IG51bGwgOiByZXNvbHZlUGF0aChjdXJyZW50RGlyLCBhcmd2WzFdKTtcbiAgICB9IGVsc2UgaWYgKGFyZ3ZbMF0gPT09ICdubCcgJiYgYXJndi5sZW5ndGggPj0gMiAmJiAhYXJndlthcmd2Lmxlbmd0aCAtIDFdLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgaXNQbGFpblNvdXJjZSA9IHRydWU7XG4gICAgICBjb25zdCBmID0gYXJndlthcmd2Lmxlbmd0aCAtIDFdO1xuICAgICAgcGxhaW5GaWxlQXJnID0gZjtcbiAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBoYXNTaGVsbEV4cGFuc2lvbihmKSA/IG51bGwgOiByZXNvbHZlUGF0aChjdXJyZW50RGlyLCBmKTtcbiAgICB9XG5cbiAgICAvLyBBIGJhcmUgYGNhdCBmaWxlYC9gbmwgZmlsZWAgdGhhdCBpcyBub3QgZmVlZGluZyBhIGRvd25zdHJlYW0gcGlwZSBzdGFnZVxuICAgIC8vIHJlYWRzIHRoZSB3aG9sZSBmaWxlOiBlbWl0IHRoZSBzYW1lIHdob2xlLWZpbGUgc3BhbiBgZ2l0IHNob3cgcmV2OnBhdGhgXG4gICAgLy8gcHJvZHVjZXMuIFdoZW4gYSBwaXBlIGZvbGxvd3MsIHRoZSBkb3duc3RyZWFtIGxpbmUtc2VsZWN0b3IgYWxyZWFkeVxuICAgIC8vIGVtaXRzIHRoZSBwcmVjaXNlIHJhbmdlLCBzbyB0aGUgc291cmNlIHN0YXlzIHNvdXJjZS1vbmx5LlxuICAgIGlmIChwbGFpbkZpbGVBcmcgIT09IG51bGwpIHtcbiAgICAgIGNvbnN0IG5leHQgPSBzaW1wbGVDb21tYW5kc1tpICsgMV07XG4gICAgICBpZiAobmV4dCA9PT0gdW5kZWZpbmVkIHx8IG5leHQucHJlY2VkZWRCeSAhPT0gJ3wnKSB7XG4gICAgICAgIGVtaXRDYW5kaWRhdGUoXG4gICAgICAgICAge1xuICAgICAgICAgICAga2luZDogJ2NhbmRpZGF0ZScsXG4gICAgICAgICAgICBpZGlvbTogYXJndlswXSA9PT0gJ2NhdCcgPyAnY2F0LWZpbGUnIDogJ25sLWZpbGUnLFxuICAgICAgICAgICAgZmlsZUFyZzogcGxhaW5GaWxlQXJnLFxuICAgICAgICAgICAgc3BlYzogeyBraW5kOiAndG9Fb2YnLCBzdGFydDogMSB9LFxuICAgICAgICAgICAgcmVzb2x2ZXJLaW5kOiAnZnMnXG4gICAgICAgICAgfSxcbiAgICAgICAgICBjdXJyZW50RGlyLFxuICAgICAgICAgIGksXG4gICAgICAgICAgam9pbk9mKHNpbXBsZSlcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBsZXQgbWF0Y2hlZCA9IGZhbHNlO1xuICAgIGZvciAoY29uc3QgbWF0Y2hlciBvZiBbLi4uTElORV9TRUxFQ1RPUlMsIG1hdGNoR2l0U2hvdywgbWF0Y2hHaXRMb2dMXSkge1xuICAgICAgZm9yIChjb25zdCBvdXRjb21lIG9mIG1hdGNoZXIoYXJndikpIHtcbiAgICAgICAgbWF0Y2hlZCA9IHRydWU7XG4gICAgICAgIGlmIChvdXRjb21lLmtpbmQgPT09ICd1bnJlc29sdmVkJykge1xuICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgICAgIGlkaW9tOiBvdXRjb21lLmlkaW9tLFxuICAgICAgICAgICAgZmlsZUFyZzogb3V0Y29tZS5maWxlQXJnLFxuICAgICAgICAgICAgcmVhc29uOiBvdXRjb21lLnJlYXNvblxuICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGVtaXRDYW5kaWRhdGUob3V0Y29tZSwgb3V0Y29tZS5kaXJPdmVycmlkZSA/PyBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSk7XG4gICAgICAgICAgLy8gYGdpdCBzaG93IHJldjpwYXRoYCBwcmludHMgdGhlIGJsb2IgdmVyYmF0aW0sIHNvICh1bmxpa2UgYGdpdCBsb2cgLUxgLFxuICAgICAgICAgIC8vIHdoaWNoIHByaW50cyBkaWZmLWZvcm1hdHRlZCBoaXN0b3J5KSBpdCdzIGEgdmFsaWQgb25lLWhvcCBwaXBlIHNvdXJjZVxuICAgICAgICAgIC8vIGZvciBhIGRvd25zdHJlYW0gbGluZS1zZWxlY3Rvciwgc2FtZSBhcyBgY2F0YC9gbmxgLlxuICAgICAgICAgIGlmIChvdXRjb21lLmlkaW9tID09PSAnZ2l0LXNob3ctcmV2LXBhdGgnICYmICFsb29rc1VucmVzb2x2YWJsZShvdXRjb21lLmZpbGVBcmcpKSB7XG4gICAgICAgICAgICBpc1BsYWluU291cmNlID0gdHJ1ZTtcbiAgICAgICAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSByZXNvbHZlUGF0aChvdXRjb21lLmRpck92ZXJyaWRlID8/IGN1cnJlbnREaXIsIG91dGNvbWUuZmlsZUFyZyk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFtYXRjaGVkICYmIHNpbXBsZS5wcmVjZWRlZEJ5ID09PSAnfCcgJiYgbGFzdFBsYWluRmlsZVNvdXJjZSkge1xuICAgICAgY29uc3Qgd2l0aEZpbGUgPSBbLi4uYXJndiwgbGFzdFBsYWluRmlsZVNvdXJjZV07XG4gICAgICBmb3IgKGNvbnN0IG1hdGNoZXIgb2YgTElORV9TRUxFQ1RPUlMpIHtcbiAgICAgICAgZm9yIChjb25zdCBvdXRjb21lIG9mIG1hdGNoZXIod2l0aEZpbGUpKSB7XG4gICAgICAgICAgaWYgKG91dGNvbWUua2luZCA9PT0gJ2NhbmRpZGF0ZScpIGVtaXRDYW5kaWRhdGUob3V0Y29tZSwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSkpO1xuICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgICAgICBpZGlvbTogb3V0Y29tZS5pZGlvbSxcbiAgICAgICAgICAgICAgZmlsZUFyZzogb3V0Y29tZS5maWxlQXJnLFxuICAgICAgICAgICAgICByZWFzb246IG91dGNvbWUucmVhc29uXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghaXNQbGFpblNvdXJjZSkgbGFzdFBsYWluRmlsZVNvdXJjZSA9IG51bGw7XG4gIH07XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBzaW1wbGVDb21tYW5kcy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IHNpbXBsZSA9IHNpbXBsZUNvbW1hbmRzW2ldO1xuXG4gICAgLy8gQSBwaXBlIHN0YWdlIG1heSBpbmhlcml0IHRoZSBwcmV2aW91cyBzdGFnZSdzIGxpdGVyYWwgZWNobyBjb250ZW50OyBhbnlcbiAgICAvLyBvdGhlciBib3VuZGFyeSBjbGVhcnMgaXQuXG4gICAgaWYgKHNpbXBsZS5wcmVjZWRlZEJ5ICE9PSAnfCcpIHBpcGVFY2hvQ29udGVudCA9IG51bGw7XG5cbiAgICBjb25zdCBoZXJlZG9jUmVmID0gc2ltcGxlLnRleHQubWF0Y2goL15fX2hlcmVkb2NfKFxcZCspX18kLyk7XG4gICAgaWYgKGhlcmVkb2NSZWYpIHtcbiAgICAgIGNvbnN0IHcgPSBoZXJlZG9jV3JpdGVzW051bWJlci5wYXJzZUludChoZXJlZG9jUmVmWzFdLCAxMCldO1xuICAgICAgY29uc3QgdG9rZW5zID0gdG9rZW5pemUoc3RyaXBMZWFkaW5nQXNzaWdubWVudHMody5vcGVuZXIpLnRyaW0oKSk7XG4gICAgICBpZiAodG9rZW5zID09PSBudWxsKSB7XG4gICAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBudWxsO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IG9wZW5lckFyZ3YgPSBhbmFseXplVG9rZW5zKHRva2VucykuYXJndjtcbiAgICAgIG1hdGNoUmVhZHMoc2ltcGxlLCBvcGVuZXJBcmd2LCBpKTtcbiAgICAgIGNsYXNzaWZ5SGVyZWRvY09wZW5lcih3Lm9wZW5lciwgdy5ib2R5LCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgICBwaXBlRWNob0NvbnRlbnQgPSBsaXRlcmFsQ29udGVudChvcGVuZXJBcmd2KSA/PyBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgdG9rZW5zID0gdG9rZW5pemUoc3RyaXBMZWFkaW5nQXNzaWdubWVudHMoc2ltcGxlLnRleHQpLnRyaW0oKSk7XG4gICAgaWYgKHRva2VucyA9PT0gbnVsbCkge1xuICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgeyBhcmd2LCByZWRpcmVjdHMgfSA9IGFuYWx5emVUb2tlbnModG9rZW5zKTtcbiAgICBpZiAoYXJndi5sZW5ndGggPT09IDApIHtcbiAgICAgIC8vIEJhcmUgYD4gZmAgLyBgOiA+IGZgOiBubyBhcmd2LCBidXQgdGhlIHRydW5jYXRpb24gZ3JhbW1hciBzdGlsbCBmaXJlcy5cbiAgICAgIG1hdGNoUmVkaXJlY3RGYW1pbHkoYXJndiwgcmVkaXJlY3RzLCBwaXBlRWNob0NvbnRlbnQsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKGFyZ3ZbMF0gPT09ICdjZCcpIHtcbiAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBudWxsO1xuICAgICAgY29uc3QgdGFyZ2V0ID0gYXJndlsxXTtcbiAgICAgIGlmICh0YXJnZXQgIT09IHVuZGVmaW5lZCAmJiB0YXJnZXQgIT09ICctJyAmJiAhaGFzU2hlbGxFeHBhbnNpb24odGFyZ2V0KSkge1xuICAgICAgICBjdXJyZW50RGlyID0gcmVzb2x2ZVBhdGgoY3VycmVudERpciwgdGFyZ2V0KTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIG1hdGNoUmVhZHMoc2ltcGxlLCBhcmd2LCBpKTtcbiAgICBtYXRjaFJlZGlyZWN0RmFtaWx5KGFyZ3YsIHJlZGlyZWN0cywgcGlwZUVjaG9Db250ZW50LCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgbWF0Y2hDb3B5TW92ZUZhbWlseShhcmd2LCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgbWF0Y2hSbVRydW5jYXRlKGFyZ3YsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICBtYXRjaFNlZElucGxhY2UoYXJndiwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgIG1hdGNoUGF0Y2hBcHBseShhcmd2LCByZWRpcmVjdHMsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICBtYXRjaEZvcm1hdHRlcihhcmd2LCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgbWF0Y2hHaXRSZXN0b3JlQ2hlY2tvdXQoYXJndiwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgIHBpcGVFY2hvQ29udGVudCA9IGxpdGVyYWxDb250ZW50KGFyZ3YpID8/IG51bGw7XG4gIH1cblxuICByZXR1cm4gcmVzdWx0cztcbn1cblxuLyoqIFBhcnNlcyBhIEJhc2ggYGNvbW1hbmRgIHN0cmluZyBpbnRvIHRoZSBmaWxlK2xpbmUtcmFuZ2Ugc3BhbnMgaXQgc3RhdGljYWxseSwgcmVsaWFibHkgcmVhZHMgb3Igd3JpdGVzLiBgY3dkYCBkZWZhdWx0cyB0byBgcHJvY2Vzcy5jd2QoKWAgXHUyMDE0IHBhc3MgdGhlIGhvb2sncyBvd24gYGN3ZGAgZmllbGQgZm9yIGNvcnJlY3QgcmVzb2x1dGlvbiBvZiByZWxhdGl2ZSBwYXRocyBhbmQgYGNkYC9gZ2l0IC1DYCB0YXJnZXRzLCBhbmQgb2YgYGdpdCBzaG93YC9gZ2l0IGxvZyAtTGAgcmV2aXNpb25zLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQ29tbWFuZChjb21tYW5kOiBzdHJpbmcsIGN3ZDogc3RyaW5nID0gcHJvY2Vzcy5jd2QoKSk6IFJlc29sdmVkU3BhbltdIHtcbiAgY29uc3QgZGV0YWlsZWQgPSBwYXJzZUNvbW1hbmREZXRhaWxlZChjb21tYW5kLCBjd2QpO1xuICBjb25zdCBzcGFuczogUmVzb2x2ZWRTcGFuW10gPSBbXTtcbiAgZm9yIChjb25zdCBtIG9mIGRldGFpbGVkKSB7XG4gICAgaWYgKG0uc3RhdHVzID09PSAncmVzb2x2ZWQnKSBzcGFucy5wdXNoKG0uc3Bhbik7XG4gIH1cbiAgcmV0dXJuIHNwYW5zO1xufVxuIiwgIi8qKlxuICogVGhlIG9ubHkgaW1wdXJlIGJpdHM6IGNvdW50aW5nIGxpbmVzIG9mIGEgd29ya2luZy10cmVlIGZpbGUsIGFuZCBvZiBhIGZpbGVcbiAqIGFzIGl0IGV4aXN0ZWQgYXQgYSBnaXZlbiBnaXQgcmV2aXNpb24uIEJvdGggcmV0dXJuIG51bGwgb24gYW55IGZhaWx1cmVcbiAqIChtaXNzaW5nIGZpbGUsIGJhZCByZXYsIG5vdCBhIGdpdCByZXBvLCBldGMuKSBpbnN0ZWFkIG9mIHRocm93aW5nIFx1MjAxNCBhXG4gKiBjb21tYW5kIHRoYXQgc3RhdGljYWxseSBtYXRjaGVkIGFuIGlkaW9tIGJ1dCBwb2ludHMgYXQgc29tZXRoaW5nIHRoaXNcbiAqIG1hY2hpbmUgY2FuJ3QgY3VycmVudGx5IHJlc29sdmUgaXMgYSBub3JtYWwsIGV4cGVjdGVkIG91dGNvbWUsIG5vdCBhIGJ1Zy5cbiAqL1xuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IHJlYWRGaWxlU3luYywgc3RhdFN5bmMgfSBmcm9tICdub2RlOmZzJztcblxuLyoqIE51bWJlciBvZiBsaW5lcyBpbiBhIHdvcmtpbmctdHJlZSBmaWxlLCBvciBudWxsIGlmIGl0IGNhbid0IGJlIHJlYWQuIFRyYWlsaW5nIG5ld2xpbmUgZG9lcyBub3QgY291bnQgYXMgYW4gZXh0cmEgZW1wdHkgbGluZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb3VudEZpbGVMaW5lcyhhYnNvbHV0ZVBhdGg6IHN0cmluZyk6IG51bWJlciB8IG51bGwge1xuICB0cnkge1xuICAgIGlmICghc3RhdFN5bmMoYWJzb2x1dGVQYXRoKS5pc0ZpbGUoKSkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgY29udGVudCA9IHJlYWRGaWxlU3luYyhhYnNvbHV0ZVBhdGgsICd1dGY4Jyk7XG4gICAgaWYgKGNvbnRlbnQubGVuZ3RoID09PSAwKSByZXR1cm4gMDtcbiAgICBjb25zdCB3aXRob3V0VHJhaWxpbmdOZXdsaW5lID0gY29udGVudC5lbmRzV2l0aCgnXFxuJykgPyBjb250ZW50LnNsaWNlKDAsIC0xKSA6IGNvbnRlbnQ7XG4gICAgcmV0dXJuIHdpdGhvdXRUcmFpbGluZ05ld2xpbmUuc3BsaXQoJ1xcbicpLmxlbmd0aDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqIE51bWJlciBvZiBsaW5lcyBpbiBgcGF0aGAgYXMgaXQgZXhpc3RzIGF0IGByZXZgLCBydW4gZnJvbSBgY3dkYCwgb3IgbnVsbCBpZiB0aGUgcmV2L3BhdGgvcmVwbyBkb2Vzbid0IHJlc29sdmUuICovXG5leHBvcnQgZnVuY3Rpb24gY291bnRHaXRCbG9iTGluZXMoY3dkOiBzdHJpbmcsIHJldjogc3RyaW5nLCBwYXRoOiBzdHJpbmcpOiBudW1iZXIgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc2hvdycsIGAke3Jldn06JHtwYXRofWBdLCB7XG4gICAgICBjd2QsXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ11cbiAgICB9KTtcbiAgICBpZiAob3V0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuIDA7XG4gICAgY29uc3Qgd2l0aG91dFRyYWlsaW5nTmV3bGluZSA9IG91dC5lbmRzV2l0aCgnXFxuJykgPyBvdXQuc2xpY2UoMCwgLTEpIDogb3V0O1xuICAgIHJldHVybiB3aXRob3V0VHJhaWxpbmdOZXdsaW5lLnNwbGl0KCdcXG4nKS5sZW5ndGg7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG4iLCAiLyoqXG4gKiBIZXVyaXN0aWMsIGRlcGVuZGVuY3ktZnJlZSBzaGVsbCBzcGxpdHRpbmcuIE5vdCBhIGZ1bGwgc2hlbGwgcGFyc2VyIFx1MjAxNCBnb29kXG4gKiBlbm91Z2ggdG8gbG9jYXRlIHNpbXBsZSBjb21tYW5kcyAoYW5kIHRoZWlyIGFyZ3YpIGluc2lkZSBhIGxhcmdlclxuICogJiYvfHwvOy98LWpvaW5lZCBCYXNoIHN0cmluZyB3aXRob3V0IHB1bGxpbmcgaW4gYSByZWFsIGJhc2ggQVNUIHBhcnNlci5cbiAqIFZhbGlkYXRlZCBkdXJpbmcgcmVzZWFyY2ggYWdhaW5zdCBiYXNobGV4IG9uIHRoZSByZWFsIHRyYW5zY3JpcHQgY29ycHVzO1xuICogdGhpcyBwb3J0cyB0aGUgc2FtZSBhbGdvcml0aG0uXG4gKlxuICogVGhlIHdvcmQtbGV2ZWwgdG9rZW5pemVyIChbdG9rZW5pemVdKSBpcyBxdW90ZS0gYW5kIHJlZGlyZWN0LWF3YXJlIChwbGFuXG4gKiBcdTAwQTc1LjEwKTogcmVkaXJlY3Qgb3BlcmF0b3JzIGFyZSBzcGxpdCBhcyBkaXN0aW5jdCB0b2tlbnMgd2l0aCBhdHRhY2hlZC10YXJnZXRcbiAqIGZvcm1zIHByZXNlcnZlZCAoYD5mYCksIHF1b3RlZCB0b2tlbnMgYXJlIHdvcmRzIGFuZCBuZXZlciBvcGVyYXRvcnMsIGFuZFxuICogW2FyZ3ZPZl0gZGVyaXZlcyBvcGVyYW5kcyBmcm9tIHRoZSB0b2tlbiBzdHJlYW0gbWludXMgcmVkaXJlY3QgdG9rZW5zIGFuZFxuICogdGhlaXIgdGFyZ2V0cy5cbiAqL1xuXG4vKiogT25lIGBzaW1wbGUgY29tbWFuZGAgZm91bmQgaW4gYSBsYXJnZXIgc2NyaXB0LCBwbHVzIHdoaWNoIG9wZXJhdG9yIHByZWNlZGVkIGl0LiAqL1xuZXhwb3J0IGludGVyZmFjZSBTaW1wbGVDb21tYW5kIHtcbiAgdGV4dDogc3RyaW5nO1xuICAvKipcbiAgICogVGhlIG9wZXJhdG9yIGltbWVkaWF0ZWx5IGJlZm9yZSB0aGlzIGNvbW1hbmQ6ICd8JyBmb3IgYSBwaXBlbGluZSBzdGFnZSxcbiAgICogJyYmJy8nfHwnIGZvciB0aGUgY29uZGl0aW9uYWwgb3BlcmF0b3JzICh0aGUgb25seSBvbmVzIHRoYXQgZ2F0ZSwgcGxhblxuICAgKiBcdTAwQTczIHN0ZXAgMiksICdvdGhlcicgZm9yICc7Jy9uZXdsaW5lLycmJywgb3IgJ3N0YXJ0JyBmb3IgdGhlIGZpcnN0IGNvbW1hbmQuXG4gICAqL1xuICBwcmVjZWRlZEJ5OiAnc3RhcnQnIHwgJ3wnIHwgJyYmJyB8ICd8fCcgfCAnb3RoZXInO1xufVxuXG4vKiogU3BsaXQgYSBjb21tYW5kIHN0cmluZyBpbnRvIHNpbXBsZS1jb21tYW5kIHN1YnN0cmluZ3MgYXQgdG9wLWxldmVsICYmLCB8fCwgOywgfCwgfCYsIGFuZCBuZXdsaW5lIGJvdW5kYXJpZXMuIFF1b3RlcyBhbmQgJCgpL2BgLygpIG5lc3RpbmcgYXJlIHJlc3BlY3RlZCAobm90IHNwbGl0IGluc2lkZSkuICovXG5leHBvcnQgZnVuY3Rpb24gc3BsaXRUb3BMZXZlbChjbWQ6IHN0cmluZyk6IFNpbXBsZUNvbW1hbmRbXSB7XG4gIGNvbnN0IHBhcnRzOiBTaW1wbGVDb21tYW5kW10gPSBbXTtcbiAgbGV0IGJ1ZiA9ICcnO1xuICBsZXQgaSA9IDA7XG4gIGNvbnN0IG4gPSBjbWQubGVuZ3RoO1xuICBsZXQgZGVwdGggPSAwO1xuICBsZXQgaW5TcXVvdGUgPSBmYWxzZTtcbiAgbGV0IGluRHF1b3RlID0gZmFsc2U7XG4gIGxldCBwZW5kaW5nT3A6IFNpbXBsZUNvbW1hbmRbJ3ByZWNlZGVkQnknXSA9ICdzdGFydCc7XG5cbiAgY29uc3QgZmx1c2ggPSAobmV4dE9wOiBTaW1wbGVDb21tYW5kWydwcmVjZWRlZEJ5J10pID0+IHtcbiAgICBjb25zdCBzID0gYnVmLnRyaW0oKTtcbiAgICBpZiAocykgcGFydHMucHVzaCh7IHRleHQ6IHMsIHByZWNlZGVkQnk6IHBlbmRpbmdPcCB9KTtcbiAgICBidWYgPSAnJztcbiAgICBwZW5kaW5nT3AgPSBuZXh0T3A7XG4gIH07XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIG9wZXJhdG9yIGN1cnJlbnRseSBwZW5kaW5nIGlzIGEgcGlwZSAoYHxgL2B8JmApLiBBIGhlbHBlclxuICAgKiByYXRoZXIgdGhhbiBhbiBpbmxpbmUgY29tcGFyaXNvbjogVHlwZVNjcmlwdCdzIGNvbnRyb2wtZmxvdyBuYXJyb3dpbmdcbiAgICogY2Fubm90IHNlZSB0aGUgYXNzaWdubWVudHMgYGZsdXNoYCBtYWtlcyB0byBgcGVuZGluZ09wYCBmcm9tIGluc2lkZSBpdHNcbiAgICogY2xvc3VyZSwgYW5kIHdvdWxkIG90aGVyd2lzZSBuYXJyb3cgdGhlIGRpcmVjdCBjb21wYXJpc29uIHRvIHRoZVxuICAgKiBpbml0aWFsaXplciBgJ3N0YXJ0J2AuXG4gICAqL1xuICBjb25zdCBpc1BlbmRpbmdQaXBlID0gKCk6IGJvb2xlYW4gPT4gcGVuZGluZ09wID09PSAnfCc7XG5cbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgY29uc3QgYyA9IGNtZFtpXTtcbiAgICBpZiAoaW5TcXVvdGUpIHtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaWYgKGMgPT09IFwiJ1wiKSBpblNxdW90ZSA9IGZhbHNlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpbkRxdW90ZSkge1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikge1xuICAgICAgICBidWYgKz0gY21kW2kgKyAxXTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXCInKSBpbkRxdW90ZSA9IGZhbHNlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSBcIidcIikge1xuICAgICAgaW5TcXVvdGUgPSB0cnVlO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcIicpIHtcbiAgICAgIGluRHF1b3RlID0gdHJ1ZTtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICBidWYgKz0gYyArIGNtZFtpICsgMV07XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcoJykge1xuICAgICAgZGVwdGggKz0gMTtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnKScpIHtcbiAgICAgIGRlcHRoID0gTWF0aC5tYXgoMCwgZGVwdGggLSAxKTtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChkZXB0aCA9PT0gMCkge1xuICAgICAgaWYgKGNtZC5zbGljZShpLCBpICsgMikgPT09ICcmJicpIHtcbiAgICAgICAgZmx1c2goJyYmJyk7XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoY21kLnNsaWNlKGksIGkgKyAyKSA9PT0gJ3x8Jykge1xuICAgICAgICBmbHVzaCgnfHwnKTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjbWQuc2xpY2UoaSwgaSArIDIpID09PSAnfCYnKSB7XG4gICAgICAgIGZsdXNoKCd8Jyk7XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJzsnKSB7XG4gICAgICAgIGZsdXNoKCdvdGhlcicpO1xuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICd8Jykge1xuICAgICAgICBmbHVzaCgnfCcpO1xuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcXG4nKSB7XG4gICAgICAgIC8vIEEgbmV3bGluZSBpbW1lZGlhdGVseSBhZnRlciBhIHBpcGUgb3BlcmF0b3IgaXMgYSBsaW5lIGNvbnRpbnVhdGlvblxuICAgICAgICAvLyAoYGNhdCBhLnR4dCB8XFxuc2VkIC4uLmAga2VlcHMgdGhlIHBpcGVsaW5lKSwgbm90IGEgc3RhdGVtZW50XG4gICAgICAgIC8vIHNlcGFyYXRvcjogc2tpcHBpbmcgaXQgcHJlc2VydmVzIGBwcmVjZWRlZEJ5OiAnfCdgIGZvciB0aGUgbmV4dFxuICAgICAgICAvLyBzdGFnZSBpbnN0ZWFkIG9mIGRlZ3JhZGluZyBpdCB0byAnb3RoZXInLlxuICAgICAgICBpZiAoaXNQZW5kaW5nUGlwZSgpKSB7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGZsdXNoKCdvdGhlcicpO1xuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICcmJykge1xuICAgICAgICAvLyBgJj5gL2AmPj5gIChzdGRvdXQrc3RkZXJyIHJlZGlyZWN0KSBhbmQgYD4mYCAoZmQtZHVwIHJlZGlyZWN0LCBhcyBpblxuICAgICAgICAvLyBgMj4mMWApIGFyZSByZWRpcmVjdCBvcGVyYXRvcnMsIG5vdCBjb21tYW5kIHNlcGFyYXRvcnMgXHUyMDE0IGtlZXAgdGhlbVxuICAgICAgICAvLyBpbiB0aGUgY3VycmVudCBzaW1wbGUgY29tbWFuZCBzbyB0aGUgdG9rZW5pemVyIGNhbiBsZXggdGhlbSBhcyBvbmVcbiAgICAgICAgLy8gdG9rZW4uIEEgYD5gIGNvdW50cyBhcyBhIGR1cC1yZWRpcmVjdCBwcmVmaXggb25seSBhdCBhIHRva2VuXG4gICAgICAgIC8vIGJvdW5kYXJ5IChzdGFydCwgb3IgYWZ0ZXIgd2hpdGVzcGFjZS9kaWdpdHMpIFx1MjAxNCBgYT5iJmNgIHN0aWxsXG4gICAgICAgIC8vIGJhY2tncm91bmRzIHRoZSBgYT5iYCByZWRpcmVjdC5cbiAgICAgICAgY29uc3QgdHJpbW1lZCA9IGJ1Zi50cmltRW5kKCk7XG4gICAgICAgIGxldCBkdXBSZWRpcmVjdCA9IGZhbHNlO1xuICAgICAgICBpZiAodHJpbW1lZC5lbmRzV2l0aCgnPicpKSB7XG4gICAgICAgICAgY29uc3QgYmVmb3JlID0gdHJpbW1lZC5sZW5ndGggPj0gMiA/IHRyaW1tZWRbdHJpbW1lZC5sZW5ndGggLSAyXSA6ICcnO1xuICAgICAgICAgIGR1cFJlZGlyZWN0ID0gdHJpbW1lZC5sZW5ndGggPT09IDEgfHwgL1xcc3xcXGQvLnRlc3QoYmVmb3JlKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY21kW2kgKyAxXSA9PT0gJz4nIHx8IGR1cFJlZGlyZWN0KSB7XG4gICAgICAgICAgYnVmICs9IGM7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGZsdXNoKCdvdGhlcicpO1xuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH1cbiAgICBidWYgKz0gYztcbiAgICBpICs9IDE7XG4gIH1cbiAgZmx1c2goJ290aGVyJyk7XG4gIHJldHVybiBwYXJ0cztcbn1cblxuY29uc3QgTEVBRElOR19BU1NJR05NRU5UID0gL14oPzpbQS1aYS16X11bQS1aYS16MC05X10qPVxcUypcXHMrKSsvO1xuXG4vKiogU3RyaXAgbGVhZGluZyBGT089YmFyIFZBUj1iYXogZW52LXByZWZpeCBhc3NpZ25tZW50cyBmcm9tIGEgc2ltcGxlIGNvbW1hbmQuICovXG5leHBvcnQgZnVuY3Rpb24gc3RyaXBMZWFkaW5nQXNzaWdubWVudHMoc2ltcGxlQ21kOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gc2ltcGxlQ21kLnJlcGxhY2UoTEVBRElOR19BU1NJR05NRU5ULCAnJyk7XG59XG5cbi8qKiBPbmUgcXVvdGUtYXdhcmUgbGV4aWNhbCB0b2tlbiBmcm9tIGEgc2ltcGxlIGNvbW1hbmQncyB0ZXh0IChwbGFuIFx1MDBBNzUuMTApLiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb2tlbiB7XG4gIC8qKlxuICAgKiBUaGUgdG9rZW4gdGV4dC4gV29yZCB0b2tlbnMgaGF2ZSBxdW90ZXMgc3RyaXBwZWQgYW5kIGVzY2FwZXMgcmVzb2x2ZWQ7XG4gICAqIHJlZGlyZWN0IHRva2VucyBrZWVwIHRoZSBvcGVyYXRvciB3aXRoIGFueSBhdHRhY2hlZCB0YXJnZXQgKGA+ZmAsXG4gICAqIGA+PmZgKSwgc2hlbGwtbGV4ZXIgc3R5bGUuXG4gICAqL1xuICB0ZXh0OiBzdHJpbmc7XG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSB0b2tlbiB3YXMgcXVvdGVkIG9yIGVzY2FwZWQgYW55d2hlcmUgaW4gdGhlIHNvdXJjZS4gQSBxdW90ZWRcbiAgICogdG9rZW4gaXMgYSB3b3JkLCBuZXZlciBhbiBvcGVyYXRvciAoYGVjaG8gJz4nYCBpcyBub3QgYSByZWRpcmVjdCkuXG4gICAqL1xuICBxdW90ZWQ6IGJvb2xlYW47XG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSB0b2tlbiBpcyBhIHJlZGlyZWN0IG9wZXJhdG9yIChgPmAsIGA+PmAsIGAxPmAsIGAyPmAsIGAmPmAsXG4gICAqIGAmPj5gLCBgPiZgLCBgPGAsIGA8PGAsIGA8PC1gLCBgPDw8YCksIHdpdGggYW55IGF0dGFjaGVkIHRhcmdldCBwcmVzZXJ2ZWRcbiAgICogaW4gYHRleHRgLlxuICAgKi9cbiAgaXNSZWRpcmVjdDogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBRdW90ZS1hd2FyZSB0b2tlbml6ZXIgdGhhdCBzcGxpdHMgcmVkaXJlY3Qgb3BlcmF0b3JzIGFzIGRpc3RpbmN0IHRva2VucyB3aXRoXG4gKiBhdHRhY2hlZC10YXJnZXQgZm9ybXMgcHJlc2VydmVkIChwbGFuIFx1MDBBNzUuMTApLiBXb3JkIHRva2VucyBjYXJyeSB0aGVcbiAqIGBxdW90ZWRgIGZsYWcgc28gY29uc3VtZXJzIGNhbiB0ZWxsIGEgcmVhbCBgPDxgIG9wZXJhdG9yIGZyb20gYSBxdW90ZWRcbiAqIGBcIjw8XCJgIGxpdGVyYWwuIFJldHVybnMgbnVsbCBvbiB1bmJhbGFuY2VkIHF1b3Rlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRva2VuaXplKHM6IHN0cmluZyk6IFRva2VuW10gfCBudWxsIHtcbiAgY29uc3QgdG9rZW5zOiBUb2tlbltdID0gW107XG4gIGxldCBidWYgPSAnJztcbiAgbGV0IHF1b3RlZCA9IGZhbHNlO1xuICBsZXQgaSA9IDA7XG4gIGNvbnN0IG4gPSBzLmxlbmd0aDtcblxuICBjb25zdCBmbHVzaFdvcmQgPSAoKTogdm9pZCA9PiB7XG4gICAgaWYgKGJ1Zi5sZW5ndGggPT09IDApIHJldHVybjtcbiAgICB0b2tlbnMucHVzaCh7IHRleHQ6IGJ1ZiwgcXVvdGVkLCBpc1JlZGlyZWN0OiBmYWxzZSB9KTtcbiAgICBidWYgPSAnJztcbiAgICBxdW90ZWQgPSBmYWxzZTtcbiAgfTtcblxuICAvKipcbiAgICogQXBwZW5kIHRoZSB1bnF1b3RlZCBjb250ZW50IG9mIHRoZSBxdW90ZWQgc2VjdGlvbiBvcGVuaW5nIGF0IGBzdGFydGBcbiAgICogKHRoZSBxdW90ZSBjaGFyKSB0byBgb3V0YCwgbWlycm9yaW5nIHNobGV4J3MgZXNjYXBlIHJ1bGVzIGZvciBkb3VibGVcbiAgICogcXVvdGVzLiBSZXR1cm5zIHRoZSBpbmRleCBhZnRlciB0aGUgY2xvc2luZyBxdW90ZSwgb3IgbnVsbCB3aGVuXG4gICAqIHVuYmFsYW5jZWQuXG4gICAqL1xuICBjb25zdCBhcHBlbmRRdW90ZWRDb250ZW50ID0gKG91dDogc3RyaW5nLCBzdGFydDogbnVtYmVyKTogeyBvdXQ6IHN0cmluZzsgbmV4dDogbnVtYmVyIH0gfCBudWxsID0+IHtcbiAgICBjb25zdCBxdW90ZSA9IHNbc3RhcnRdO1xuICAgIGxldCBqID0gc3RhcnQgKyAxO1xuICAgIHdoaWxlIChqIDwgbikge1xuICAgICAgY29uc3QgYyA9IHNbal07XG4gICAgICBpZiAocXVvdGUgPT09IFwiJ1wiKSB7XG4gICAgICAgIGlmIChjID09PSBcIidcIikgcmV0dXJuIHsgb3V0LCBuZXh0OiBqICsgMSB9O1xuICAgICAgICBvdXQgKz0gYztcbiAgICAgICAgaiArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXFxcXCcgJiYgaiArIDEgPCBuICYmICdcIlxcXFwkYCcuaW5jbHVkZXMoc1tqICsgMV0pKSB7XG4gICAgICAgIG91dCArPSBzW2ogKyAxXTtcbiAgICAgICAgaiArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXCInKSByZXR1cm4geyBvdXQsIG5leHQ6IGogKyAxIH07XG4gICAgICBvdXQgKz0gYztcbiAgICAgIGogKz0gMTtcbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH07XG5cbiAgLyoqXG4gICAqIEFwcGVuZCB0aGUgcmF3IGF0dGFjaGVkLXRhcmdldCB0ZXh0IHN0YXJ0aW5nIGF0IGBzdGFydGAgdG8gYG91dGAgXHUyMDE0XG4gICAqIHZlcmJhdGltLCBxdW90ZWQgc2VjdGlvbnMgc3Bhbm5pbmcgc3BhY2VzIGluY2x1ZGVkIFx1MjAxNCBzdG9wcGluZyBhdFxuICAgKiB3aGl0ZXNwYWNlIG9yIGFub3RoZXIgcmVkaXJlY3Qgb3BlcmF0b3IuIFJldHVybnMgdGhlIG5leHQgaW5kZXgsIG9yIG51bGxcbiAgICogb24gdW5iYWxhbmNlZCBxdW90ZXMuXG4gICAqL1xuICBjb25zdCBhcHBlbmRBdHRhY2hlZFRhcmdldCA9IChvdXQ6IHN0cmluZywgc3RhcnQ6IG51bWJlcik6IHsgb3V0OiBzdHJpbmc7IG5leHQ6IG51bWJlciB9IHwgbnVsbCA9PiB7XG4gICAgbGV0IGogPSBzdGFydDtcbiAgICB3aGlsZSAoaiA8IG4pIHtcbiAgICAgIGNvbnN0IGMgPSBzW2pdO1xuICAgICAgaWYgKC9cXHMvLnRlc3QoYykgfHwgYyA9PT0gJzwnIHx8IGMgPT09ICc+JykgcmV0dXJuIHsgb3V0LCBuZXh0OiBqIH07XG4gICAgICBpZiAoYyA9PT0gXCInXCIgfHwgYyA9PT0gJ1wiJykge1xuICAgICAgICBjb25zdCBzZWN0aW9uID0gYXBwZW5kUXVvdGVkQ29udGVudCgnJywgaik7XG4gICAgICAgIGlmIChzZWN0aW9uID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgICAgICAgb3V0ICs9IHMuc2xpY2Uoaiwgc2VjdGlvbi5uZXh0KTtcbiAgICAgICAgaiA9IHNlY3Rpb24ubmV4dDtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGogKyAxIDwgbikge1xuICAgICAgICBvdXQgKz0gYyArIHNbaiArIDFdO1xuICAgICAgICBqICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgb3V0ICs9IGM7XG4gICAgICBqICs9IDE7XG4gICAgfVxuICAgIHJldHVybiB7IG91dCwgbmV4dDogaiB9O1xuICB9O1xuXG4gIC8qKiBFbWl0IGEgcmVkaXJlY3QgdG9rZW4gd2hvc2UgdGV4dCBwcmVmaXhlcyB0aGUgb3BlcmF0b3Igd2l0aCB0aGUgY3VycmVudCBkaWdpdCBidWZmZXIgKGFuIElPX05VTUJFUiBsaWtlIGAyPmApLiAqL1xuICBjb25zdCBlbWl0UmVkaXJlY3QgPSAob3BlcmF0b3I6IHN0cmluZywgYXR0YWNoZWRTdGFydDogbnVtYmVyKTogYm9vbGVhbiA9PiB7XG4gICAgY29uc3QgYXR0YWNoZWQgPSBhcHBlbmRBdHRhY2hlZFRhcmdldCgnJywgYXR0YWNoZWRTdGFydCk7XG4gICAgaWYgKGF0dGFjaGVkID09PSBudWxsKSByZXR1cm4gZmFsc2U7XG4gICAgdG9rZW5zLnB1c2goeyB0ZXh0OiBidWYgKyBvcGVyYXRvciArIGF0dGFjaGVkLm91dCwgcXVvdGVkOiBmYWxzZSwgaXNSZWRpcmVjdDogdHJ1ZSB9KTtcbiAgICBidWYgPSAnJztcbiAgICBxdW90ZWQgPSBmYWxzZTtcbiAgICBpID0gYXR0YWNoZWQubmV4dDtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfTtcblxuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBjb25zdCBjID0gc1tpXTtcbiAgICBpZiAoL1xccy8udGVzdChjKSkge1xuICAgICAgZmx1c2hXb3JkKCk7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09IFwiJ1wiIHx8IGMgPT09ICdcIicpIHtcbiAgICAgIHF1b3RlZCA9IHRydWU7XG4gICAgICBjb25zdCBzZWN0aW9uID0gYXBwZW5kUXVvdGVkQ29udGVudChidWYsIGkpO1xuICAgICAgaWYgKHNlY3Rpb24gPT09IG51bGwpIHJldHVybiBudWxsO1xuICAgICAgYnVmID0gc2VjdGlvbi5vdXQ7XG4gICAgICBpID0gc2VjdGlvbi5uZXh0O1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICBxdW90ZWQgPSB0cnVlO1xuICAgICAgYnVmICs9IHNbaSArIDFdO1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnPCcgfHwgYyA9PT0gJz4nKSB7XG4gICAgICAvLyBBIGA8YC9gPmAgaXMgYSByZWRpcmVjdCBvcGVyYXRvciBhdCBhIHdvcmQgYm91bmRhcnksIG9yIGFmdGVyIGFuXG4gICAgICAvLyBJT19OVU1CRVIgZGlnaXQgcnVuIChgMT5gLCBgMj5gKTsgbWlkLXdvcmQgaXQgZW5kcyB0aGUgY3VycmVudCB3b3JkXG4gICAgICAvLyBmaXJzdCAoYGVjaG8gYT5iYCBcdTIxOTIgd29yZHMgYGVjaG9gLCBgYWA7IHJlZGlyZWN0IGA+YmApLlxuICAgICAgaWYgKGJ1ZiAhPT0gJycgJiYgIS9eXFxkKyQvLnRlc3QoYnVmKSkgZmx1c2hXb3JkKCk7XG4gICAgICBsZXQgb3BlcmF0b3I6IHN0cmluZztcbiAgICAgIGlmIChjID09PSAnPCcpIHtcbiAgICAgICAgaWYgKHMuc2xpY2UoaSwgaSArIDMpID09PSAnPDw8Jykgb3BlcmF0b3IgPSAnPDw8JztcbiAgICAgICAgZWxzZSBpZiAocy5zbGljZShpLCBpICsgMykgPT09ICc8PC0nKSBvcGVyYXRvciA9ICc8PC0nO1xuICAgICAgICBlbHNlIGlmIChzLnNsaWNlKGksIGkgKyAyKSA9PT0gJzw8Jykgb3BlcmF0b3IgPSAnPDwnO1xuICAgICAgICBlbHNlIG9wZXJhdG9yID0gJzwnO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgb3BlcmF0b3IgPSBzLnNsaWNlKGksIGkgKyAyKSA9PT0gJz4+JyA/ICc+PicgOiAnPic7XG4gICAgICB9XG4gICAgICBpZiAoIWVtaXRSZWRpcmVjdChvcGVyYXRvciwgaSArIG9wZXJhdG9yLmxlbmd0aCkpIHJldHVybiBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnJicpIHtcbiAgICAgIC8vIGAmPmAvYCY+PmAgXHUyMDE0IHRoZSBzdGRvdXQrc3RkZXJyIHJlZGlyZWN0IChrZXB0IHRvZ2V0aGVyIGJ5XG4gICAgICAvLyBzcGxpdFRvcExldmVsKS4gQSBiYXJlIGAmYCBoZXJlIGlzIGFuIG9yZGluYXJ5IHdvcmQgY2hhciAoYCYxYCBpblxuICAgICAgLy8gYDI+JjFgLCB3aGljaCB0aGUgYXR0YWNoZWQtdGFyZ2V0IHNjYW4gYWJvdmUgY29uc3VtZWQgYW55d2F5KS5cbiAgICAgIGlmIChzW2kgKyAxXSA9PT0gJz4nKSB7XG4gICAgICAgIGZsdXNoV29yZCgpO1xuICAgICAgICBjb25zdCBvcGVyYXRvciA9IHMuc2xpY2UoaSwgaSArIDMpID09PSAnJj4+JyA/ICcmPj4nIDogJyY+JztcbiAgICAgICAgaWYgKCFlbWl0UmVkaXJlY3Qob3BlcmF0b3IsIGkgKyBvcGVyYXRvci5sZW5ndGgpKSByZXR1cm4gbnVsbDtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBidWYgKz0gYztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBidWYgKz0gYztcbiAgICBpICs9IDE7XG4gIH1cbiAgZmx1c2hXb3JkKCk7XG4gIHJldHVybiB0b2tlbnM7XG59XG5cbi8qKlxuICogVGhlIGF0dGFjaGVkIHRhcmdldCBvZiBhIHJlZGlyZWN0IHRva2VuLCBvciBudWxsIHdoZW4gdGhlIG9wZXJhdG9yIGlzXG4gKiBzdGFuZGFsb25lIChgPmAgdnMgYD5mYDsgYDI+YCB2cyBgMj4mMWApLiBTcGxpdHMgYW4gb3B0aW9uYWwgSU9fTlVNQkVSXG4gKiBkaWdpdCBydW4gb2ZmIHRoZSBmcm9udCwgdGhlbiB0aGUgb3BlcmF0b3IsIGxlYXZpbmcgdGhlIHRhcmdldC5cbiAqL1xuZnVuY3Rpb24gcmVkaXJlY3RBdHRhY2hlZFRhcmdldCh0ZXh0OiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3QgbWF0Y2ggPSB0ZXh0Lm1hdGNoKC9eKFxcZCopKDw8PHw8PC18Jj4+fDw8fD4+fCY+fD4mfDx8PikoLiopJC8pO1xuICBpZiAobWF0Y2ggPT09IG51bGwpIHJldHVybiBudWxsO1xuICBjb25zdCBbLCAsICwgcmVzdF0gPSBtYXRjaDtcbiAgcmV0dXJuIHJlc3QubGVuZ3RoID4gMCA/IHJlc3QgOiBudWxsO1xufVxuXG4vKiogQmVzdC1lZmZvcnQgYXJndiBmb3IgYSBzaW1wbGUgY29tbWFuZDogbGVhZGluZyBhc3NpZ25tZW50cyBzdHJpcHBlZCwgcXVvdGUtYXdhcmUgdG9rZW5zIG1pbnVzIHJlZGlyZWN0IG9wZXJhdG9ycyBhbmQgdGhlaXIgdGFyZ2V0cy4gUmV0dXJucyBudWxsIGlmIHRoZSBjb21tYW5kIGRvZXNuJ3QgdG9rZW5pemUgY2xlYW5seSAodW5iYWxhbmNlZCBxdW90ZXMpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFyZ3ZPZihzaW1wbGVDbWQ6IHN0cmluZyk6IHN0cmluZ1tdIHwgbnVsbCB7XG4gIGNvbnN0IHRva2VucyA9IHRva2VuaXplKHN0cmlwTGVhZGluZ0Fzc2lnbm1lbnRzKHNpbXBsZUNtZCkudHJpbSgpKTtcbiAgaWYgKHRva2VucyA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGFyZ3Y6IHN0cmluZ1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgdG9rZW5zLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgdG9rZW4gPSB0b2tlbnNbaV07XG4gICAgaWYgKCF0b2tlbi5pc1JlZGlyZWN0KSB7XG4gICAgICBhcmd2LnB1c2godG9rZW4udGV4dCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gQSBzdGFuZGFsb25lIHJlZGlyZWN0IG9wZXJhdG9yIGNvbnN1bWVzIHRoZSBuZXh0IHRva2VuIGFzIGl0cyB0YXJnZXQ7XG4gICAgLy8gYW4gYXR0YWNoZWQgZm9ybSAoYD5mYCwgYD4+ZmApIGlzIHNlbGYtY29udGFpbmVkLlxuICAgIGlmIChyZWRpcmVjdEF0dGFjaGVkVGFyZ2V0KHRva2VuLnRleHQpID09PSBudWxsKSBpICs9IDE7XG4gIH1cbiAgcmV0dXJuIGFyZ3Y7XG59XG4iLCAiLyoqXG4gKiBUaGUgcmFuZ2UtcHJlc2VydmluZyB1bmlmaWVkLWRpZmYgcGFyc2VyIChwbGFuIFx1MDBBNzUuNyksIHNpYmxpbmcgdG9cbiAqIG1lY2hhbmljYWwtY2hhbmdlLnRzJ3MgcmFuZ2UtbGVzcyBgcGFyc2VVbmlmaWVkRGlmZmAuIFRoZSBwYXRjaC9naXQgYXBwbHlcbiAqIGdyYW1tYXIgbmVlZHMgdGhlIGBAQCAtYSxiICtjLGQgQEBgIGh1bmsgbnVtYmVycyB0aGF0IHBhcnNlVW5pZmllZERpZmZcbiAqIGRpc2NhcmRzLCBzbyB0aGlzIHBhcnNlcyB0aGUgc2FtZSBoZWFkZXIgZGlhbGVjdCBmcm9tIHNjcmF0Y2guXG4gKlxuICogQSBodW5rIHdob3NlIHByZS9wb3N0IGxpbmUgY291bnRzIG1hdGNoIHByZXNlcnZlcyBsaW5lIGNvb3JkaW5hdGVzLCBzbyBhXG4gKiBmaWxlIHdob3NlIGh1bmtzIGFyZSBhbGwgY291bnQtcHJlc2VydmluZyBnZXRzIGFuIGV4YWN0IHJhbmdlIFx1MjAxNCB0aGUgdW5pb24gb2ZcbiAqIGV2ZXJ5IGh1bmsncyByZWdpb24uIEFueSBjb3VudC1jaGFuZ2luZyBodW5rIChwdXJlIGFkZCwgcHVyZSBkZWxldGUsIHVuZXF1YWxcbiAqIGNvdW50cykgZGVncmFkZXMgdGhlIGZpbGUgdG8gYSB3aG9sZS1maWxlIG1vZGlmeTogcG9zaXRpb25zIGJlbG93IGl0IHNoaWZ0LFxuICogYW5kIGEgZGVsZXRlZCBsaW5lIG9jY3VwaWVzIG5vIHBvc3QtZWRpdCByYW5nZSBhdCBhbGwuXG4gKlxuICogUGVyLWZpbGUgY2xhc3NpZmljYXRpb25zOiBgbmV3IGZpbGUgbW9kZWAgXHUyMTkyIGNyZWF0ZS1vdmVyd3JpdGU7IGBkZWxldGVkIGZpbGVcbiAqIG1vZGVgIFx1MjE5MiBkZWxldGU7IGByZW5hbWUgZnJvbWAvYHJlbmFtZSB0b2AgXHUyMTkyIHNvdXJjZSBkZWxldGUgKyBkZXN0XG4gKiByZW5hbWUtY29weTsgYmluYXJ5IGRpZmZzIFx1MjE5MiB3aG9sZS1maWxlIG1vZGlmeTsgYSBgKysrIC9kZXYvbnVsbGAgdGFyZ2V0ICh0aGVcbiAqIHNoYXBlIGBkaWZmIC11YC1mb3JtYXQgZGVsZXRpb25zIHRha2UpIFx1MjE5MiBkZWxldGUuXG4gKlxuICogR2l0LXN0eWxlIGBhL1x1MjAyNmAvYGIvXHUyMDI2YCBwcmVmaXhlcyBhcmUgc3RyaXBwZWQgcGVyIHRoZSBjYWxsZXIncyBgLXBOYCBzdHJpcFxuICogbGV2ZWw6IGEgbnVtYmVyIHN0cmlwcyB0aGF0IG1hbnkgbGVhZGluZyBwYXRoIGNvbXBvbmVudHMsIGFuZCBgJ2F1dG8nYFxuICogKHBhdGNoJ3MgZGVmYXVsdCkgc3RyaXBzIG9uZSB3aGVuIHRoZSBwYXRoIGlzIGEvLSBvciBiLy1wcmVmaXhlZCBhbmQgbm9uZVxuICogb3RoZXJ3aXNlLiBgL2Rldi9udWxsYCBpcyBjaGVja2VkIGJlZm9yZSBzdHJpcHBpbmcgXHUyMDE0IHRoZSBoZWFkZXIgbWFya2VyXG4gKiB3b3VsZCBvdGhlcndpc2UgbG9zZSBpdHMgYGRldi9gIGNvbXBvbmVudC5cbiAqXG4gKiBNYWxmb3JtZWQgb3IgZW1wdHkgcGF0Y2ggdGV4dCByZXR1cm5zIG51bGwgKGZhaWwgY2xvc2VkIFx1MjAxNCB0aGUgY2FsbGVyIGVtaXRzXG4gKiB1bnJlc29sdmVkIHJhdGhlciB0aGFuIGd1ZXNzaW5nIGF0IHRhcmdldHMpLlxuICovXG5cbi8qKiBUaGUgYC1wTmAgaGVhZGVyIHN0cmlwIGxldmVsOiBhIGNvbXBvbmVudCBjb3VudCwgb3IgcGF0Y2gncyBgJ2F1dG8nYCBkZWZhdWx0LiAqL1xuZXhwb3J0IHR5cGUgUGF0aFN0cmlwID0gbnVtYmVyIHwgJ2F1dG8nO1xuXG4vKiogT25lIGZpbGUgYSBwYXRjaCB0b3VjaGVzOiB0aGUgdGFyZ2V0IHBhdGgsIHRoZSB0b3VjaCBraW5kLCBhbmQgdGhlIGV4YWN0IHJhbmdlIHdoZW4gdGhlIGh1bmtzIHByZXNlcnZlIGxpbmUgY291bnRzLiAqL1xuZXhwb3J0IGludGVyZmFjZSBVbmlmaWVkRGlmZlRhcmdldCB7XG4gIHBhdGg6IHN0cmluZztcbiAgb3BlcmF0aW9uOiAnbW9kaWZ5JyB8ICdjcmVhdGUtb3ZlcndyaXRlJyB8ICdkZWxldGUnIHwgJ3JlbmFtZS1jb3B5JztcbiAgbGluZVN0YXJ0PzogbnVtYmVyO1xuICBsaW5lRW5kPzogbnVtYmVyO1xufVxuXG5jb25zdCBIVU5LX0hFQURFUiA9IC9eQEAgLShcXGQrKSg/OiwoXFxkKykpPyBcXCsoXFxkKykoPzosKFxcZCspKT8gQEAvO1xuXG4vKiogU3RyaXAgdGhlIGZpcnN0IGBuYCBsZWFkaW5nIHBhdGggY29tcG9uZW50cyAoYC1wTmApLCBzdG9wcGluZyBhdCBhIGNvbXBvbmVudC1sZXNzIHBhdGguICovXG5mdW5jdGlvbiBzdHJpcFBhdGhDb21wb25lbnRzKHA6IHN0cmluZywgbjogbnVtYmVyKTogc3RyaW5nIHtcbiAgbGV0IHMgPSBwO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IG47IGkrKykge1xuICAgIGNvbnN0IHNsYXNoID0gcy5pbmRleE9mKCcvJyk7XG4gICAgaWYgKHNsYXNoID09PSAtMSkgcmV0dXJuIHM7XG4gICAgcyA9IHMuc2xpY2Uoc2xhc2ggKyAxKTtcbiAgfVxuICByZXR1cm4gcztcbn1cblxuLyoqXG4gKiBUaGUgbGV2ZWwgdG8gc3RyaXAgZnJvbSBgcmF3YCB1bmRlciBgc3RyaXBgOiBhIG51bWJlciBwYXNzZXMgdGhyb3VnaDsgYCdhdXRvJ2BcbiAqIHJlc29sdmVzIHRvIHAxIHdoZW4gdGhlIHBhdGggaXMgYGEvYC9gYi9gLXByZWZpeGVkIGFuZCBwMCBvdGhlcndpc2UgXHUyMDE0IHBhdGNoJ3NcbiAqIGRlZmF1bHQgZm9yIGRpZmZzIHdob3NlIHByZWZpeGVzIGFyZSBgZGlmZiAtdWAtc3R5bGUgcmF0aGVyIHRoYW4gZ2l0J3MuXG4gKi9cbmZ1bmN0aW9uIHN0cmlwTGV2ZWxGb3IocmF3OiBzdHJpbmcsIHN0cmlwOiBQYXRoU3RyaXApOiBudW1iZXIge1xuICByZXR1cm4gc3RyaXAgPT09ICdhdXRvJyA/IChyYXcuc3RhcnRzV2l0aCgnYS8nKSB8fCByYXcuc3RhcnRzV2l0aCgnYi8nKSA/IDEgOiAwKSA6IHN0cmlwO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VVbmlmaWVkRGlmZlJhbmdlKHBhdGNoVGV4dDogc3RyaW5nLCBzdHJpcDogUGF0aFN0cmlwKTogVW5pZmllZERpZmZUYXJnZXRbXSB8IG51bGwge1xuICBjb25zdCByZXN1bHRzOiBVbmlmaWVkRGlmZlRhcmdldFtdID0gW107XG4gIGxldCBzYXdCbG9jayA9IGZhbHNlO1xuICBsZXQgY3VycmVudDoge1xuICAgIHBhdGg6IHN0cmluZztcbiAgICBraW5kOiAnbW9kaWZ5JyB8ICduZXcnIHwgJ2RlbGV0ZWQnO1xuICAgIGh1bmtzOiBBcnJheTx7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIH0+O1xuICAgIGNvdW50Q2hhbmdpbmc6IGJvb2xlYW47XG4gIH0gfCBudWxsID0gbnVsbDtcbiAgbGV0IHBlbmRpbmdLaW5kOiAnbmV3JyB8ICdkZWxldGVkJyB8IG51bGwgPSBudWxsO1xuICBsZXQgcmVuYW1lRnJvbTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCByZW5hbWVUbzogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCBiaW5hcnkgPSBmYWxzZTtcblxuICAvKiogVGhlIGhlYWRlciBwYXRoIHdpdGggdGhlIGAtcE5gIGxldmVsIGFwcGxpZWQgXHUyMDE0IGAvZGV2L251bGxgIGtlcHQgdmVyYmF0aW0gKHRoZSBtYXJrZXIgaXMgbmV2ZXIgYSByZWFsIHBhdGgpLiAqL1xuICBjb25zdCBzdHJpcHBlZCA9IChyYXc6IHN0cmluZyk6IHN0cmluZyA9PiB7XG4gICAgaWYgKHJhdyA9PT0gJy9kZXYvbnVsbCcpIHJldHVybiByYXc7XG4gICAgcmV0dXJuIHN0cmlwUGF0aENvbXBvbmVudHMocmF3LCBzdHJpcExldmVsRm9yKHJhdywgc3RyaXApKTtcbiAgfTtcblxuICBjb25zdCBmaW5pc2ggPSAoKTogdm9pZCA9PiB7XG4gICAgaWYgKGN1cnJlbnQgIT09IG51bGwpIHtcbiAgICAgIGlmIChjdXJyZW50LmtpbmQgPT09ICduZXcnKSByZXN1bHRzLnB1c2goeyBwYXRoOiBjdXJyZW50LnBhdGgsIG9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnIH0pO1xuICAgICAgZWxzZSBpZiAoY3VycmVudC5raW5kID09PSAnZGVsZXRlZCcpIHJlc3VsdHMucHVzaCh7IHBhdGg6IGN1cnJlbnQucGF0aCwgb3BlcmF0aW9uOiAnZGVsZXRlJyB9KTtcbiAgICAgIGVsc2UgaWYgKGJpbmFyeSkgcmVzdWx0cy5wdXNoKHsgcGF0aDogY3VycmVudC5wYXRoLCBvcGVyYXRpb246ICdtb2RpZnknIH0pO1xuICAgICAgZWxzZSBpZiAoY3VycmVudC5odW5rcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgLy8gQSBoZWFkZXItb25seSBibG9jayB3aXRoIG5vIGh1bmtzOiBub3RoaW5nIHN0YXRpY2FsbHkga25vd24uXG4gICAgICB9IGVsc2UgaWYgKGN1cnJlbnQuY291bnRDaGFuZ2luZykgcmVzdWx0cy5wdXNoKHsgcGF0aDogY3VycmVudC5wYXRoLCBvcGVyYXRpb246ICdtb2RpZnknIH0pO1xuICAgICAgZWxzZSB7XG4gICAgICAgIGNvbnN0IHN0YXJ0ID0gTWF0aC5taW4oLi4uY3VycmVudC5odW5rcy5tYXAoKGgpID0+IGguc3RhcnQpKTtcbiAgICAgICAgY29uc3QgZW5kID0gTWF0aC5tYXgoLi4uY3VycmVudC5odW5rcy5tYXAoKGgpID0+IGguZW5kKSk7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7IHBhdGg6IGN1cnJlbnQucGF0aCwgb3BlcmF0aW9uOiAnbW9kaWZ5JywgbGluZVN0YXJ0OiBzdGFydCwgbGluZUVuZDogZW5kIH0pO1xuICAgICAgfVxuICAgICAgY3VycmVudCA9IG51bGw7XG4gICAgfVxuICAgIGlmIChyZW5hbWVGcm9tICE9PSBudWxsKSByZXN1bHRzLnB1c2goeyBwYXRoOiByZW5hbWVGcm9tLCBvcGVyYXRpb246ICdkZWxldGUnIH0pO1xuICAgIGlmIChyZW5hbWVUbyAhPT0gbnVsbCkgcmVzdWx0cy5wdXNoKHsgcGF0aDogcmVuYW1lVG8sIG9wZXJhdGlvbjogJ3JlbmFtZS1jb3B5JyB9KTtcbiAgICByZW5hbWVGcm9tID0gbnVsbDtcbiAgICByZW5hbWVUbyA9IG51bGw7XG4gICAgYmluYXJ5ID0gZmFsc2U7XG4gIH07XG5cbiAgZm9yIChjb25zdCBsaW5lIG9mIHBhdGNoVGV4dC5zcGxpdCgnXFxuJykpIHtcbiAgICBpZiAobGluZS5zdGFydHNXaXRoKCctLS0gJykpIHtcbiAgICAgIHNhd0Jsb2NrID0gdHJ1ZTtcbiAgICAgIGlmIChjdXJyZW50ICE9PSBudWxsKSBmaW5pc2goKTtcbiAgICAgIGN1cnJlbnQgPSB7XG4gICAgICAgIHBhdGg6IHN0cmlwcGVkKGxpbmUuc2xpY2UoNCkpLFxuICAgICAgICBraW5kOiBwZW5kaW5nS2luZCA/PyAnbW9kaWZ5JyxcbiAgICAgICAgaHVua3M6IFtdLFxuICAgICAgICBjb3VudENoYW5naW5nOiBmYWxzZVxuICAgICAgfTtcbiAgICAgIHBlbmRpbmdLaW5kID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZS5zdGFydHNXaXRoKCcrKysgJykpIHtcbiAgICAgIHNhd0Jsb2NrID0gdHJ1ZTtcbiAgICAgIGNvbnN0IHBhdGggPSBzdHJpcHBlZChsaW5lLnNsaWNlKDQpKTtcbiAgICAgIGlmIChjdXJyZW50ID09PSBudWxsKSBjdXJyZW50ID0geyBwYXRoLCBraW5kOiBwZW5kaW5nS2luZCA/PyAnbW9kaWZ5JywgaHVua3M6IFtdLCBjb3VudENoYW5naW5nOiBmYWxzZSB9O1xuICAgICAgZWxzZSBpZiAocGF0aCA9PT0gJy9kZXYvbnVsbCcpIGN1cnJlbnQua2luZCA9ICdkZWxldGVkJztcbiAgICAgIGVsc2UgY3VycmVudC5wYXRoID0gcGF0aDtcbiAgICAgIHBlbmRpbmdLaW5kID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZS5zdGFydHNXaXRoKCduZXcgZmlsZSBtb2RlJykpIHtcbiAgICAgIHBlbmRpbmdLaW5kID0gJ25ldyc7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGxpbmUuc3RhcnRzV2l0aCgnZGVsZXRlZCBmaWxlIG1vZGUnKSkge1xuICAgICAgcGVuZGluZ0tpbmQgPSAnZGVsZXRlZCc7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGxpbmUuc3RhcnRzV2l0aCgncmVuYW1lIGZyb20gJykpIHtcbiAgICAgIHNhd0Jsb2NrID0gdHJ1ZTtcbiAgICAgIGlmIChjdXJyZW50ICE9PSBudWxsKSBmaW5pc2goKTtcbiAgICAgIHJlbmFtZUZyb20gPSBzdHJpcHBlZChsaW5lLnNsaWNlKCdyZW5hbWUgZnJvbSAnLmxlbmd0aCkpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChsaW5lLnN0YXJ0c1dpdGgoJ3JlbmFtZSB0byAnKSkge1xuICAgICAgc2F3QmxvY2sgPSB0cnVlO1xuICAgICAgcmVuYW1lVG8gPSBzdHJpcHBlZChsaW5lLnNsaWNlKCdyZW5hbWUgdG8gJy5sZW5ndGgpKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZS5zdGFydHNXaXRoKCdCaW5hcnkgZmlsZXMgJykgfHwgbGluZS5zdGFydHNXaXRoKCdHSVQgYmluYXJ5IHBhdGNoJykpIHtcbiAgICAgIHNhd0Jsb2NrID0gdHJ1ZTtcbiAgICAgIGJpbmFyeSA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgaHVuayA9IGxpbmUubWF0Y2goSFVOS19IRUFERVIpO1xuICAgIGlmIChodW5rKSB7XG4gICAgICBzYXdCbG9jayA9IHRydWU7XG4gICAgICBjb25zdCBwcmVTdGFydCA9IE51bWJlci5wYXJzZUludChodW5rWzFdLCAxMCk7XG4gICAgICBjb25zdCBwcmVDb3VudCA9IGh1bmtbMl0gPT09IHVuZGVmaW5lZCA/IDEgOiBOdW1iZXIucGFyc2VJbnQoaHVua1syXSwgMTApO1xuICAgICAgY29uc3QgcG9zdENvdW50ID0gaHVua1s0XSA9PT0gdW5kZWZpbmVkID8gMSA6IE51bWJlci5wYXJzZUludChodW5rWzRdLCAxMCk7XG4gICAgICBpZiAoY3VycmVudCA9PT0gbnVsbCkgcmV0dXJuIG51bGw7IC8vIGEgaHVuayB3aXRob3V0IGEgZmlsZSBoZWFkZXIgXHUyMTkyIG1hbGZvcm1lZFxuICAgICAgaWYgKHByZUNvdW50ICE9PSBwb3N0Q291bnQpIGN1cnJlbnQuY291bnRDaGFuZ2luZyA9IHRydWU7XG4gICAgICBpZiAocHJlQ291bnQgPiAwKSBjdXJyZW50Lmh1bmtzLnB1c2goeyBzdGFydDogcHJlU3RhcnQsIGVuZDogcHJlU3RhcnQgKyBwcmVDb3VudCAtIDEgfSk7XG4gICAgfVxuICB9XG4gIGZpbmlzaCgpO1xuICByZXR1cm4gc2F3QmxvY2sgPyByZXN1bHRzIDogbnVsbDtcbn1cbiIsICIvKipcbiAqIENsYXVkZSBQb3N0VG9vbFVzZSB0b3VjaCBob29rIFx1MjAxNCB0aGluIFNESy1ib3VuZCBlbnRyeSBwb2ludC5cbiAqXG4gKiBGaXJlcyBhZnRlciBhIHN1Y2Nlc3NmdWwgYFJlYWRgL2BFZGl0YC9gV3JpdGVgLCBvciBhIGBCYXNoYCBjYWxsIHdob3NlXG4gKiBgY29tbWFuZGAgc3RhdGljYWxseSByZXNvbHZlcyB0byByZWNvZ25pemFibGUgZmlsZStsaW5lLXJhbmdlIGlkaW9tcy4gVGhlXG4gKiBDbGF1ZGUtc3BlY2lmaWMgam9iIGlzIHRyYW5zbGF0aW5nIHRoZSBzdHJ1Y3R1cmVkIGB0b29sX2lucHV0YFxuICogKGBmaWxlX3BhdGhgLCBgbmV3X3N0cmluZ2AvYGNvbnRlbnRgLCBgb2Zmc2V0YC9gbGltaXRgKSBhbmQgYHRvb2xfbmFtZWAgaW50b1xuICogYSBoYXJuZXNzLWFnbm9zdGljIHtAbGluayBUb3VjaElucHV0fSwgdGhlbiBoYW5kaW5nIG9mZiB0byB0aGUgc2hhcmVkXG4gKiB7QGxpbmsgcnVuVG91Y2hIb29rfSBjb3JlOiBvbiBhIHdyaXRlIGl0IGhlYWxzXG4gKiBwb3NpdGlvbmFsIHNwYW4gZHJpZnQgaW4gdGhlIHdvcmtpbmcgdHJlZSAoYGdpdCBzcGFuIGRyaWZ0IDxmaWxlPiAtLWZpeGApIGFuZFxuICogZm9sZHMgYW55IHNlbWFudGljIHJlc2lkdWUgaW50byBvbmUgYDxnaXQtc3Bhbj5gIGJsb2NrOyBvbiBhIHJlYWQgaXQgc3VyZmFjZXNcbiAqIHNwYW5zIG92ZXJsYXBwaW5nIHRoZSByZWFkJ3MgYG9mZnNldGAvYGxpbWl0YCB3aW5kb3cgKHdob2xlLWZpbGUgd2hlbiBuZWl0aGVyXG4gKiBpcyBnaXZlbikgd2l0aCBwb3NpdGlvbmFsIHN0YXR1c2VzIGZpbHRlcmVkIG91dCwgYW5kIG5ldmVyIG11dGF0ZXMgdGhlIHRyZWUuXG4gKlxuICogVGhlIGJsb2NrIHJlYWNoZXMgdGhlIG1vZGVsIGxvb3AgdmlhIGBob29rU3BlY2lmaWNPdXRwdXQuYWRkaXRpb25hbENvbnRleHRgIGFuZFxuICogdGhlIHVzZXItZmFjaW5nIFVJIHZpYSBgc3lzdGVtTWVzc2FnZWAuIEZhaWwtb3BlbiBpcyBsb2FkLWJlYXJpbmc6IGFuIGFic2VudFxuICogQ0xJL2Auc3Bhbi9gLCB0aW1lb3V0LCBvciBub24temVybyBleGl0IHlpZWxkcyBubyBzaWduYWwgYW5kIG5ldmVyIGJsb2NrcyB0aGVcbiAqIHRvb2wgY2FsbC4gVGhlIHRpbWVvdXQgaXMgbWlsbGlzZWNvbmRzIGhlcmUgKHRoZSBDbGF1ZGUgQ0xJIGVtaXRzIG1zIGludG9cbiAqIGBob29rcy5qc29uYCk7IENvZGV4J3MgZXF1aXZhbGVudCBzb3VyY2UgdmFsdWUgaXMgZGl2aWRlZCB0byBzZWNvbmRzIGF0IGVtaXQuXG4gKi9cblxuaW1wb3J0IHtcbiAgdHlwZSBIb29rQ29udGV4dCxcbiAgdHlwZSBQb3N0VG9vbFVzZUlucHV0LFxuICBwb3N0VG9vbFVzZUhvb2ssXG4gIHBvc3RUb29sVXNlT3V0cHV0XG59IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG5pbXBvcnQgeyBkZXJpdmVQYXRoIH0gZnJvbSAnLi4vY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyBiYXNoUmVzcG9uc2VJbnRlcnJ1cHRlZCwgcnVuQmFzaFRvdWNoZXMgfSBmcm9tICcuLi9jb21tb24vYmFzaC10b3VjaC5qcyc7XG5pbXBvcnQgeyBwYXJzZUNvbW1hbmREZXRhaWxlZCB9IGZyb20gJy4uL2NvbW1vbi9wYXJzZS1jb21tYW5kLmpzJztcbmltcG9ydCB7IGNyZWF0ZURpc2tNZW1vU3RvcmUsIHR5cGUgTWVtb0ZhY3RvcnksIHJlc29sdmVUb3VjaFNjb3BlIH0gZnJvbSAnLi4vY29tbW9uL3NwYW4tc3VyZmFjZS5qcyc7XG5pbXBvcnQge1xuICBjcmVhdGVEZWZhdWx0VG91Y2hFeGVjdXRvcnMsXG4gIHJ1blRvdWNoSG9vayxcbiAgdHlwZSBUb3VjaEV4ZWN1dG9ycyxcbiAgdHlwZSBUb3VjaElucHV0XG59IGZyb20gJy4uL2NvbW1vbi90b3VjaC1jb3JlLmpzJztcblxudHlwZSBUb29sSW5wdXQgPSBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcblxuLyoqIFJlYWQgYSBgVG9vbElucHV0YCBmaWVsZCBhcyBhIHBvc2l0aXZlIGludGVnZXIsIG9yIGB1bmRlZmluZWRgIHdoZW4gYWJzZW50L2ludmFsaWQuICovXG5mdW5jdGlvbiBwb3NpdGl2ZUludEZpZWxkKHRvb2xJbnB1dDogVG9vbElucHV0LCBmaWVsZDogc3RyaW5nKTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgcmF3ID0gdG9vbElucHV0W2ZpZWxkXTtcbiAgcmV0dXJuIHR5cGVvZiByYXcgPT09ICdudW1iZXInICYmIE51bWJlci5pc0ludGVnZXIocmF3KSAmJiByYXcgPiAwID8gcmF3IDogdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIFRyYW5zbGF0ZSBhIENsYXVkZSB0b29sIGNhbGwgaW50byBhIHtAbGluayBUb3VjaElucHV0fS4gYFJlYWRgIGlzIGEgcmVhZCB0b3VjaFxuICogY2FycnlpbmcgaXRzIGBvZmZzZXRgL2BsaW1pdGAgKHdoZW4gcHJlc2VudCkgZm9yIHJhbmdlLXByZWNpc2Ugc2NvcGluZztcbiAqIGBFZGl0YC9gV3JpdGVgIGFyZSB3cml0ZSB0b3VjaGVzIHdob3NlIGB3cml0dGVuYCBibG9jayBpcyB0aGUgbmV3IGNvbnRlbnQgdGhlXG4gKiB0b29sIGp1c3QgYXBwbGllZCAoYG5ld19zdHJpbmdgIGZvciBFZGl0LCBgY29udGVudGAgZm9yIFdyaXRlKS4gQW4gdW5rbm93biB0b29sXG4gKiBvciBhIG5vbi1zdHJpbmcgY29udGVudCBmaWVsZCB5aWVsZHMgYG51bGxgIChub3RoaW5nIHRvIGRvKS5cbiAqL1xuZnVuY3Rpb24gdG9Ub3VjaElucHV0KFxuICB0b29sTmFtZTogc3RyaW5nLFxuICB0b29sSW5wdXQ6IFRvb2xJbnB1dCxcbiAgc2Vzc2lvbklkOiBzdHJpbmcsXG4gIGN3ZDogc3RyaW5nLFxuICBmaWxlUGF0aDogc3RyaW5nXG4pOiBUb3VjaElucHV0IHwgbnVsbCB7XG4gIGlmICh0b29sTmFtZSA9PT0gJ1JlYWQnKSB7XG4gICAgY29uc3Qgb2Zmc2V0ID0gcG9zaXRpdmVJbnRGaWVsZCh0b29sSW5wdXQsICdvZmZzZXQnKTtcbiAgICBjb25zdCBsaW1pdCA9IHBvc2l0aXZlSW50RmllbGQodG9vbElucHV0LCAnbGltaXQnKTtcbiAgICByZXR1cm4geyBraW5kOiAncmVhZCcsIHNlc3Npb25JZCwgY3dkLCBmaWxlUGF0aCwgb2Zmc2V0LCBsaW1pdCB9O1xuICB9XG4gIGlmICh0b29sTmFtZSA9PT0gJ0VkaXQnIHx8IHRvb2xOYW1lID09PSAnV3JpdGUnKSB7XG4gICAgY29uc3QgcmF3ID0gdG9vbE5hbWUgPT09ICdFZGl0JyA/IHRvb2xJbnB1dC5uZXdfc3RyaW5nIDogdG9vbElucHV0LmNvbnRlbnQ7XG4gICAgY29uc3Qgd3JpdHRlbiA9IHR5cGVvZiByYXcgPT09ICdzdHJpbmcnID8gcmF3IDogJyc7XG4gICAgLy8gVGhlIEVkaXQvV3JpdGUgcGF0aCBwYXNzZXMgJ2V4aXN0cycgXHUyMDE0IHRoZSB0b29sIHJhbiwgc28gdGhlIGZpbGUgaXNcbiAgICAvLyBwcmVzZW50OyB0aGUgd3JpdGUgZ2F0ZSAocGxhbiBcdTAwQTczIHN0ZXAgMSkgdmVyaWZpZXMgaXQgYmVmb3JlIGFueVxuICAgIC8vIGV4ZWN1dG9yIGNhbGwuXG4gICAgcmV0dXJuIHsga2luZDogJ3dyaXRlJywgc2Vzc2lvbklkLCBjd2QsIGZpbGVQYXRoLCB3cml0dGVuLCB0YXJnZXRTdGF0ZTogJ2V4aXN0cycgfTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUhhbmRsZXIoXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMgPSBjcmVhdGVEZWZhdWx0VG91Y2hFeGVjdXRvcnMoKSxcbiAgbWVtb0ZhY3Rvcnk6IE1lbW9GYWN0b3J5ID0gY3JlYXRlRGlza01lbW9TdG9yZVxuKSB7XG4gIHJldHVybiBhc3luYyAoaW5wdXQ6IFBvc3RUb29sVXNlSW5wdXQsIGN0eDogSG9va0NvbnRleHQpID0+IHtcbiAgICBjb25zdCBtZW1vID0gbWVtb0ZhY3RvcnkoY3R4LmxvZ2dlcik7XG4gICAgY29uc3Qgc2Vzc2lvbklkID0gaW5wdXQuc2Vzc2lvbl9pZDtcbiAgICBjb25zdCBjd2QgPSBpbnB1dC5jd2QgPz8gJyc7XG4gICAgY29uc3QgdG9vbE5hbWUgPSBpbnB1dC50b29sX25hbWU7XG4gICAgY29uc3QgdG9vbElucHV0ID0gKGlucHV0LnRvb2xfaW5wdXQgPz8ge30pIGFzIFRvb2xJbnB1dDtcblxuICAgIC8vIEJhc2ggaGFzIG5vIGBmaWxlX3BhdGhgIGZpZWxkLCBzbyBpdCBnZXRzIGl0cyBvd24gYnJhbmNoOiBydW4gdGhlIHN0YXRpY1xuICAgIC8vIGNvbW1hbmQgcGFyc2VyIGFuZCBoYW5kIHRoZSBtYXRjaGVzIHRvIHRoZSBzaGFyZWQgYHJ1bkJhc2hUb3VjaGVzYFxuICAgIC8vIGRyaXZlciAocGxhbiBcdTAwQTczIHN0ZXAgMiksIHdoaWNoIG93bnMgdGhlIHBlci1jb21tYW5kIHZlcmRpY3QgdGhyZWFkIFx1MjAxNFxuICAgIC8vIHBvc3Qtc3RhdGUgZ2F0ZXMsIGpvaW4gZmlsdGVyaW5nLCBhbmQgdGhlIGludGVycnVwdGVkIGdhdGUgKHBsYW4gXHUwMEE3NCkgXHUyMDE0XG4gICAgLy8gYW5kIHJldHVybnMgdGhlIG1lcmdlZCBibG9ja3MgZm9yIHRoZSBhZGFwdGVycycgb3V0cHV0IGJ1aWxkZXJzLiBBXG4gICAgLy8gY29tbWFuZCB3aXRoIG5vIHJlY29nbml6YWJsZSBpZGlvbSB5aWVsZHMgbm8gYmxvY2tzIGFuZCByZXR1cm5zIGBudWxsYCBcdTIwMTRcbiAgICAvLyBmYWlsLW9wZW4sIHNhbWUgYXMgdGhlIHRvb2wgcGF0aCBiZWxvdy5cbiAgICBpZiAodG9vbE5hbWUgPT09ICdCYXNoJykge1xuICAgICAgY29uc3QgY29tbWFuZCA9IHR5cGVvZiB0b29sSW5wdXQuY29tbWFuZCA9PT0gJ3N0cmluZycgPyB0b29sSW5wdXQuY29tbWFuZCA6IG51bGw7XG4gICAgICBpZiAoIWNvbW1hbmQpIHJldHVybiBudWxsO1xuICAgICAgLy8gQW4gaW50ZXJydXB0ZWQgY29tbWFuZCBwcm9kdWNlcyBubyB0b3VjaGVzLCB3aGF0ZXZlciBpdHMgc3BhbnM7IHRoZVxuICAgICAgLy8gZHJpdmVyIHJlLWNoZWNrcyBkZWZlbnNpdmVseS5cbiAgICAgIGlmIChiYXNoUmVzcG9uc2VJbnRlcnJ1cHRlZChpbnB1dC50b29sX3Jlc3BvbnNlKSkgcmV0dXJuIG51bGw7XG4gICAgICBjb25zdCBtYXRjaGVzID0gcGFyc2VDb21tYW5kRGV0YWlsZWQoY29tbWFuZCwgY3dkKTtcbiAgICAgIGNvbnN0IGJsb2NrcyA9IGF3YWl0IHJ1bkJhc2hUb3VjaGVzKG1hdGNoZXMsIHNlc3Npb25JZCwgY3dkLCBpbnB1dC50b29sX3Jlc3BvbnNlLCBleGVjdXRvcnMsIG1lbW8sIChtZXNzYWdlKSA9PlxuICAgICAgICBjdHgubG9nZ2VyLndhcm4obWVzc2FnZSlcbiAgICAgICk7XG4gICAgICBpZiAoYmxvY2tzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gICAgICBjb25zdCBjb21iaW5lZCA9IGJsb2Nrcy5qb2luKCcnKTtcbiAgICAgIHJldHVybiBwb3N0VG9vbFVzZU91dHB1dCh7XG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dDogeyBhZGRpdGlvbmFsQ29udGV4dDogY29tYmluZWQgfSxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogY29tYmluZWRcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGFic1BhdGggPSBkZXJpdmVQYXRoKHRvb2xJbnB1dCwgY3dkKTtcbiAgICBpZiAoIWFic1BhdGgpIHJldHVybiBudWxsO1xuXG4gICAgLy8gQm91bmQgdGhlIHRvdWNoIHRvIHRoZSBDV0QgcmVwbyAoZHJvcHMgY3Jvc3MtcmVwbywgZ2l0aWdub3JlZCwgYW5kIHNwYW5cbiAgICAvLyBkb2N1bWVudHMpLiBGYWlsIGNsb3NlZCBvbiBhbiB1bnJlc29sdmFibGUgQ1dEIHJlcG8uXG4gICAgY29uc3Qgc2NvcGUgPSByZXNvbHZlVG91Y2hTY29wZShjd2QsIGFic1BhdGgpO1xuICAgIGlmICghc2NvcGUpIHJldHVybiBudWxsO1xuXG4gICAgY29uc3QgdG91Y2ggPSB0b1RvdWNoSW5wdXQodG9vbE5hbWUsIHRvb2xJbnB1dCwgc2Vzc2lvbklkLCBjd2QsIGFic1BhdGgpO1xuICAgIGlmICghdG91Y2gpIHJldHVybiBudWxsO1xuXG4gICAgY29uc3Qgb3V0cHV0ID0gYXdhaXQgcnVuVG91Y2hIb29rKHRvdWNoLCBleGVjdXRvcnMsIG1lbW8pO1xuICAgIGlmICghb3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KSByZXR1cm4gbnVsbDtcblxuICAgIHJldHVybiBwb3N0VG9vbFVzZU91dHB1dCh7XG4gICAgICBob29rU3BlY2lmaWNPdXRwdXQ6IHsgYWRkaXRpb25hbENvbnRleHQ6IG91dHB1dC5hZGRpdGlvbmFsQ29udGV4dCB9LFxuICAgICAgc3lzdGVtTWVzc2FnZTogb3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0XG4gICAgfSk7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IHBvc3RUb29sVXNlSG9vayh7IG1hdGNoZXI6ICdSZWFkfEVkaXR8V3JpdGV8QmFzaCcsIHRpbWVvdXQ6IDEwXzAwMCB9LCBjcmVhdGVIYW5kbGVyKCkpO1xuIiwgImltcG9ydCBob29rIGZyb20gJy4vcG9zdC10b29sLXVzZS50cyc7XG5pbXBvcnQgeyBleGVjdXRlIH0gZnJvbSAnLi4vLi4vLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcy9kaXN0L3J1bnRpbWUuanMnO1xuXG5leGVjdXRlKGhvb2spO1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7QUFrQ0EsWUFBWSxRQUFRO0FBTWIsSUFBTSxrQkFBa0I7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBSzNCLGFBQWE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFNYixVQUFVO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQUtWLFFBQVE7QUFDWjtBQWtDTyxTQUFTLGlCQUFpQjtBQUM3QixTQUFPLFFBQVEsSUFBSSxnQkFBZ0IsUUFBUTtBQUMvQztBQThDTyxTQUFTLGNBQWMsTUFBTSxPQUFPO0FBQ3ZDLFFBQU0sVUFBVSxlQUFlO0FBQy9CLE1BQUksWUFBWSxRQUFXO0FBQ3ZCLFVBQU0sSUFBSSxNQUFNLHdHQUE2RztBQUFBLEVBQ2pJO0FBRUEsUUFBTSxlQUFlLGlCQUFpQixLQUFLO0FBRTNDLFFBQU0sa0JBQWtCLFVBQVUsSUFBSSxJQUFJLFlBQVk7QUFBQTtBQUN0RCxFQUFHLGtCQUFlLFNBQVMsaUJBQWlCLE9BQU87QUFDdkQ7QUFpQk8sU0FBUyxlQUFlLE1BQU07QUFDakMsYUFBVyxDQUFDLE1BQU0sS0FBSyxLQUFLLE9BQU8sUUFBUSxJQUFJLEdBQUc7QUFDOUMsa0JBQWMsTUFBTSxLQUFLO0FBQUEsRUFDN0I7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VSxPQUFPLFVBQVUsWUFBWSxXQUFXLFVBQVUsVUFBVTtBQUM1RSxVQUFJLENBQUMsUUFBUyxRQUFPO0FBR3JCLFVBQUksd0JBQXdCLE1BQU0sYUFBYSxFQUFHLFFBQU87QUFDekQsWUFBTSxVQUFVLHFCQUFxQixTQUFTLEdBQUc7QUFDakQsWUFBTSxTQUFTLE1BQU07QUFBQSxRQUFlO0FBQUEsUUFBUztBQUFBLFFBQVc7QUFBQSxRQUFLLE1BQU07QUFBQSxRQUFlO0FBQUEsUUFBVztBQUFBLFFBQU0sQ0FBQyxZQUNsRyxJQUFJLE9BQU8sS0FBSyxPQUFPO0FBQUEsTUFDekI7QUFDQSxVQUFJLE9BQU8sV0FBVyxFQUFHLFFBQU87QUFDaEMsWUFBTSxXQUFXLE9BQU8sS0FBSyxFQUFFO0FBQy9CLGFBQU8sa0JBQWtCO0FBQUEsUUFDdkIsb0JBQW9CLEVBQUUsbUJBQW1CLFNBQVM7QUFBQSxRQUNsRCxlQUFlO0FBQUEsTUFDakIsQ0FBQztBQUFBLElBQ0g7QUFFQSxVQUFNLFVBQVUsV0FBVyxXQUFXLEdBQUc7QUFDekMsUUFBSSxDQUFDLFFBQVMsUUFBTztBQUlyQixVQUFNLFFBQVEsa0JBQWtCLEtBQUssT0FBTztBQUM1QyxRQUFJLENBQUMsTUFBTyxRQUFPO0FBRW5CLFVBQU0sUUFBUSxhQUFhLFVBQVUsV0FBVyxXQUFXLEtBQUssT0FBTztBQUN2RSxRQUFJLENBQUMsTUFBTyxRQUFPO0FBRW5CLFVBQU0sU0FBUyxNQUFNLGFBQWEsT0FBTyxXQUFXLElBQUk7QUFDeEQsUUFBSSxDQUFDLE9BQU8sa0JBQW1CLFFBQU87QUFFdEMsV0FBTyxrQkFBa0I7QUFBQSxNQUN2QixvQkFBb0IsRUFBRSxtQkFBbUIsT0FBTyxrQkFBa0I7QUFBQSxNQUNsRSxlQUFlLE9BQU87QUFBQSxJQUN4QixDQUFDO0FBQUEsRUFDSDtBQUNGO0FBRUEsSUFBTyx3QkFBUSxnQkFBZ0IsRUFBRSxTQUFTLHdCQUF3QixTQUFTLElBQU8sR0FBRyxjQUFjLENBQUM7OztBQ2xJcEcsUUFBUSxxQkFBSTsiLAogICJuYW1lcyI6IFsicmVzb2x2ZSIsICJmcyIsICJleGVjRmlsZVN5bmMiLCAiZnMiLCAibm9kZVBhdGgiLCAiZnMiLCAibm9kZVBhdGgiLCAibG9nZ2VyIiwgImV4ZWNGaWxlU3luYyIsICJmcyIsICJiYXNlbmFtZSIsICJqb2luIiwgImV4ZWNGaWxlU3luYyIsICJqb2luIiwgImJhc2VuYW1lIiwgImpvaW4iLCAicmVhZEZpbGVTeW5jIiwgInN0YXRTeW5jIiwgImJhc2VuYW1lIiwgImV4ZWNGaWxlU3luYyIsICJyZWFkRmlsZVN5bmMiLCAic3RhdFN5bmMiLCAiam9pbiIsICJzdGF0U3luYyIsICJiYXNlbmFtZSIsICJyZWFkRmlsZVN5bmMiLCAidG9rZW5zIl0KfQo=

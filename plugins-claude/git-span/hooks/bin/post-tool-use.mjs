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
function createRealityProbeCache(paths, changedCandidates = []) {
  return {
    paths: [...new Set(paths)],
    realPaths: null,
    changedCandidates: [...new Set(changedCandidates)],
    changedPaths: null
  };
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
function changedOnDisk(cache, cwd) {
  if (cache.changedPaths !== null) return cache.changedPaths;
  const changed = /* @__PURE__ */ new Set();
  if (cache.changedCandidates.length > 0) {
    const repoRoot = resolveRepoRoot(cwd);
    if (repoRoot !== null) {
      const rels = cache.changedCandidates.map((p) => relativeToRepo(repoRoot, p));
      try {
        const out = execFileSync3("git", ["status", "--porcelain", "-z", "--untracked-files=no", "--", ...rels], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: DEFAULT_TIMEOUT_MS
        });
        for (const entry of out.split("\0")) {
          if (entry.length < 4) continue;
          const worktreeStatus = entry.charAt(1);
          if (worktreeStatus === " " || worktreeStatus === "?") continue;
          changed.add(join4(repoRoot, entry.slice(3)));
        }
      } catch (err) {
      }
    }
  }
  cache.changedPaths = changed;
  return changed;
}
function workingTreeChanged(probeCache, cwd, absPath) {
  return changedOnDisk(probeCache, cwd).has(absPath);
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
function bashResponseExitCode(toolResponse) {
  if (toolResponse !== null && typeof toolResponse === "object") {
    const code = toolResponse.exit_code;
    if (typeof code === "number" && Number.isInteger(code)) return code;
  }
  return void 0;
}
var FILE_PRODUCING_OPS = /* @__PURE__ */ new Set(["create-overwrite", "rename-copy", "truncate", "append"]);
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
function joinOfCommand(idx, groups, guardByIndex) {
  const spans = groups.get(idx);
  if (spans !== void 0) {
    for (const m of spans) {
      if (m.span.join !== void 0) return m.span.join;
    }
    return void 0;
  }
  return guardByIndex.get(idx)?.join;
}
async function runBashTouches(matches, sessionId, cwd, toolResponse, executors, memo, warn = console.warn) {
  if (bashResponseInterrupted(toolResponse)) return [];
  const exitCode = bashResponseExitCode(toolResponse);
  const resolved = matches.filter((m) => m.status === "resolved");
  const guards = matches.filter((m) => m.status === "builtin-guard");
  if (resolved.length === 0) return [];
  const probePaths = [];
  const fileProducingByPath = /* @__PURE__ */ new Map();
  for (const m of resolved) {
    if (m.span.operation === "delete") probePaths.push(m.span.absolutePath);
    else if ((m.idiom === "cp-write" || m.idiom === "install-write") && m.span.operation === "read") {
      probePaths.push(m.span.absolutePath);
    } else if (FILE_PRODUCING_OPS.has(m.span.operation)) {
      const list = fileProducingByPath.get(m.span.absolutePath);
      if (list !== void 0) list.push(m.span.simpleCommandIndex);
      else fileProducingByPath.set(m.span.absolutePath, [m.span.simpleCommandIndex]);
    }
  }
  const recreateProbePaths = [];
  for (const m of resolved) {
    if (m.span.operation !== "delete") continue;
    const later = (fileProducingByPath.get(m.span.absolutePath) ?? []).some((i) => i > m.span.simpleCommandIndex);
    if (later) recreateProbePaths.push(m.span.absolutePath);
  }
  const probeCache = createRealityProbeCache(probePaths, recreateProbePaths);
  const groups = /* @__PURE__ */ new Map();
  const guardByIndex = /* @__PURE__ */ new Map();
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
  for (const g of guards) {
    if (groups.has(g.simpleCommandIndex) || guardByIndex.has(g.simpleCommandIndex)) continue;
    guardByIndex.set(g.simpleCommandIndex, g);
    commandOrder.push(g.simpleCommandIndex);
  }
  commandOrder.sort((a, b) => a - b);
  const evals = /* @__PURE__ */ new Map();
  for (const idx of commandOrder) {
    const spans = groups.get(idx);
    if (spans === void 0) continue;
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
    const list = evals.get(idx);
    if (list === void 0) continue;
    for (const e of list) {
      if (e.outcome === "decisivePass") {
        const prev = passByPath.get(e.path);
        if (prev === void 0 || idx > prev) passByPath.set(e.path, idx);
      }
    }
  }
  for (const idx of commandOrder) {
    const list = evals.get(idx);
    if (list === void 0) continue;
    for (const e of list) {
      if (e.outcome === "pending") {
        const passIdx = e.sourceKey !== null ? passByPath.get(e.sourceKey) : void 0;
        e.outcome = passIdx !== void 0 && passIdx > e.commandIndex ? "decisivePass" : "decisiveFail";
      } else if (e.outcome === "decisiveFail") {
        const passIdx = passByPath.get(e.path);
        if (passIdx !== void 0 && passIdx > e.commandIndex) e.explained = true;
      }
    }
  }
  const recreateByPath = /* @__PURE__ */ new Map();
  for (const idx of commandOrder) {
    const list = evals.get(idx);
    if (list === void 0) continue;
    for (const e of list) {
      if (e.outcome === "decisiveFail") continue;
      if (e.touch === null || e.touch.kind !== "write" || e.touch.targetState !== "exists") continue;
      if (!FILE_PRODUCING_OPS.has(e.match.span.operation)) continue;
      const prev = recreateByPath.get(e.path);
      if (prev === void 0 || idx > prev) recreateByPath.set(e.path, idx);
    }
  }
  if (recreateByPath.size > 0) {
    for (const idx of commandOrder) {
      const list = evals.get(idx);
      if (list === void 0) continue;
      for (const e of list) {
        if (e.outcome !== "decisiveFail" || e.explained) continue;
        if (e.touch === null || e.touch.kind !== "write" || e.touch.targetState !== "absent") continue;
        const recreateIdx = recreateByPath.get(e.path);
        if (recreateIdx !== void 0 && recreateIdx > e.commandIndex && workingTreeChanged(probeCache, cwd, e.path)) {
          e.explained = true;
        }
      }
    }
  }
  const computed = /* @__PURE__ */ new Map();
  for (const idx of commandOrder) {
    const list = evals.get(idx);
    if (list === void 0) {
      const guard = guardByIndex.get(idx);
      computed.set(idx, guard !== void 0 ? guard.exitStatus === 0 ? "succeeded" : "failed" : "unknown");
      continue;
    }
    let failed = false;
    let passed = false;
    for (const e of list) {
      if (e.outcome === "decisiveFail" && !e.explained) failed = true;
      if (e.outcome === "decisivePass") passed = true;
    }
    computed.set(idx, failed ? "failed" : passed ? "succeeded" : "unknown");
  }
  const effective = /* @__PURE__ */ new Map();
  const skipped = /* @__PURE__ */ new Set();
  let prevIndex = null;
  for (const idx of commandOrder) {
    const join5 = joinOfCommand(idx, groups, guardByIndex);
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
    const list = evals.get(idx);
    if (list === void 0) continue;
    let touches = 0;
    for (const e of list) {
      if (e.touch === null || e.explained) continue;
      if (e.outcome === "decisiveFail") continue;
      if (e.outcome === "inconclusive" && e.touch.kind === "write" && e.touch.targetState === "absent") continue;
      if (e.outcome === "inconclusive" && e.touch.kind === "write" && exitCode !== void 0 && exitCode !== 0)
        continue;
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
function headerPathText(raw) {
  const tab = raw.indexOf("	");
  return tab === -1 ? raw : raw.slice(0, tab);
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
    const text = headerPathText(raw);
    if (text === "/dev/null") return text;
    return stripPathComponents(text, stripLevelFor(text, strip));
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
  for (const rawLine of patchText.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
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
      else if (current.path === "/dev/null") {
        current.path = path;
        current.kind = "new";
      }
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
        sawQuote = true;
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
      return { cmdStart, openerLineEnd, delim, tabStrip, quotedDelim: sawQuote };
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
    writes.push({ opener: raw.slice(open.cmdStart, open.openerLineEnd), body, quotedDelim: open.quotedDelim });
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
  if (host === void 0 || host === ":" || host === "exec") {
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
var ASSIGNMENT_TOKEN = /^[A-Za-z_][A-Za-z0-9_]*=/;
function stripTransparentWrapper(argv) {
  const unwrapped = argv[0] === "command" || argv[0] === "env" ? argv.slice(1) : argv;
  let i = 0;
  while (i < unwrapped.length && ASSIGNMENT_TOKEN.test(unwrapped[i])) i += 1;
  return i > 0 ? unwrapped.slice(i) : unwrapped;
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
  noValue: /* @__PURE__ */ new Set(["-r", "-R", "-p", "-f", "-v", "-i", "-u", "-a", "-d", "-L", "-P"]),
  noClobber: /* @__PURE__ */ new Set(["-n", "--no-clobber"]),
  valueTaking: /* @__PURE__ */ new Set(["-t", "--target-directory"]),
  excluded: /* @__PURE__ */ new Set(["-b", "--backup"]),
  sourceOperation: "read",
  destOperation: "create-overwrite"
};
var INSTALL_SPEC = {
  idiom: "install-write",
  noValue: /* @__PURE__ */ new Set(["-D", "-s", "-v"]),
  noClobber: /* @__PURE__ */ new Set(),
  valueTaking: /* @__PURE__ */ new Set(["-t", "--target-directory", "-m", "-o", "-g"]),
  excluded: /* @__PURE__ */ new Set(["-d"]),
  sourceOperation: "read",
  destOperation: "create-overwrite"
};
var MV_SPEC = {
  idiom: "mv-write",
  // `mv -n` stays in noValue, not noClobber: an mv skip leaves the source in
  // place, and the delete's own absence gate then fails the touch — the
  // no-clobber blind spot is cp's byte-compare, not mv's.
  noValue: /* @__PURE__ */ new Set(["-f", "-i", "-n", "-v", "-u"]),
  noClobber: /* @__PURE__ */ new Set(),
  valueTaking: /* @__PURE__ */ new Set(["-t", "--target-directory"]),
  excluded: /* @__PURE__ */ new Set(),
  sourceOperation: "delete",
  destOperation: "rename-copy"
};
var GIT_MV_SPEC = {
  idiom: "mv-write",
  noValue: /* @__PURE__ */ new Set(["-f", "-k", "-v"]),
  noClobber: /* @__PURE__ */ new Set(),
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
    if (spec.noValue.has(a) || spec.noClobber.has(a)) {
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
function heredocBodyIsLiteral(body) {
  if (body.includes("$") || body.includes("`")) return false;
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "\\") continue;
    const next = body[i + 1];
    if (next === void 0 || next === "$" || next === "`" || next === "\\" || next === "\n") return false;
    i += 1;
  }
  return true;
}
function classifyHeredocOpener(opener, body, quotedDelim, currentDir, simpleCommandIndex, join5, results) {
  const bodyLiteral = quotedDelim || heredocBodyIsLiteral(body);
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
            ...singlePlainAppend && r.op === ">>" && bodyLiteral ? { written: body } : {}
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
            ...singlePlainOverwrite && bodyLiteral ? { written: `${body}
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
              ...contentRedirects.length === 0 && bodyLiteral ? { written: body } : {}
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
              ...contentRedirects.length === 0 && bodyLiteral ? { written: `${body}
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
var SED_SCRIPT_SHAPE = /^(?:[A-Za-z]|\d|\/|\\|\$|~)/;
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
      if (restAfter.length >= 2 && !SED_SCRIPT_SHAPE.test(w)) {
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
var BUILTIN_GUARD_STATUS = /* @__PURE__ */ new Map([
  ["false", 1],
  ["true", 0],
  [":", 0]
]);
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
      classifyHeredocOpener(w.opener, w.body, w.quotedDelim, currentDir, i, joinOf(simple), results);
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
    const before = results.length;
    matchReads(simple, argv, i);
    matchRedirectFamily(argv, redirects, pipeEchoContent, currentDir, i, joinOf(simple), results);
    matchCopyMoveFamily(argv, currentDir, i, joinOf(simple), results);
    matchRmTruncate(argv, currentDir, i, joinOf(simple), results);
    matchSedInplace(argv, currentDir, i, joinOf(simple), results);
    matchPatchApply(argv, redirects, currentDir, i, joinOf(simple), results);
    matchFormatter(argv, currentDir, i, joinOf(simple), results);
    matchGitRestoreCheckout(argv, currentDir, i, joinOf(simple), results);
    if (results.length === before) {
      const status = BUILTIN_GUARD_STATUS.get(argv[0]);
      if (status !== void 0) {
        results.push({
          status: "builtin-guard",
          simpleCommandIndex: i,
          join: joinOf(simple),
          exitStatus: status
        });
      }
    }
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcy9kaXN0L2Vudi5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL3NwYW4tc3VyZmFjZS50cyIsICJzcmMvY29tbW9uL3NwYW4taWdub3JlLnRzIiwgInNyYy9jb21tb24vdG91Y2gtY29yZS50cyIsICJzcmMvY29tbW9uL2FuY2hvci10cmVlLnRzIiwgInNyYy9jb21tb24vYmFzaC10b3VjaC50cyIsICJzcmMvY29tbW9uL3BhcnNlLWNvbW1hbmQudHMiLCAic3JjL2NvbW1vbi9jb21tYW5kLXJlc29sdmUudHMiLCAic3JjL2NvbW1vbi9zaGVsbC1zcGxpdC50cyIsICJzcmMvY29tbW9uL3VuaWZpZWQtZGlmZi50cyIsICJzcmMvY2xhdWRlL3Bvc3QtdG9vbC11c2UudHMiLCAic3JjL2NsYXVkZS9wb3N0LXRvb2wtdXNlLWVudHJ5LnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvKipcbiAqIEVudmlyb25tZW50IHZhcmlhYmxlIHV0aWxpdGllcyBmb3IgQ2xhdWRlIENvZGUgaG9va3MuXG4gKlxuICogUHJvdmlkZXMgdHlwZWQgYWNjZXNzIHRvIENsYXVkZSBDb2RlJ3MgZW52aXJvbm1lbnQgdmFyaWFibGVzIGFuZCB1dGlsaXRpZXNcbiAqIGZvciBwZXJzaXN0aW5nIGVudmlyb25tZW50IHZhcmlhYmxlcyBpbiBTZXNzaW9uU3RhcnQgaG9va3MuXG4gKlxuICogIyMgRW52aXJvbm1lbnQgVmFyaWFibGVzXG4gKlxuICogQ2xhdWRlIENvZGUgc2V0cyB0aGVzZSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgd2hlbiBydW5uaW5nIGhvb2tzOlxuICpcbiAqIHwgVmFyaWFibGUgfCBEZXNjcmlwdGlvbiB8IEF2YWlsYWJsZSBJbiB8XG4gKiB8LS0tLS0tLS0tLXwtLS0tLS0tLS0tLS0tfC0tLS0tLS0tLS0tLS0tfFxuICogfCBgQ0xBVURFX1BST0pFQ1RfRElSYCB8IEFic29sdXRlIHBhdGggdG8gcHJvamVjdCByb290IHwgQWxsIGhvb2tzIHxcbiAqIHwgYENMQVVERV9FTlZfRklMRWAgfCBQYXRoIHRvIGZpbGUgZm9yIHBlcnNpc3RpbmcgZW52IHZhcnMgfCBTZXNzaW9uU3RhcnQgb25seSB8XG4gKiB8IGBDTEFVREVfQ09ERV9SRU1PVEVgIHwgYFwidHJ1ZVwiYCBpZiBydW5uaW5nIHJlbW90ZWx5IHwgQWxsIGhvb2tzIHxcbiAqIEBtb2R1bGVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBnZXRQcm9qZWN0RGlyLCBwZXJzaXN0RW52VmFyLCBpc1JlbW90ZUVudmlyb25tZW50IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBHZXQgcHJvamVjdCBkaXJlY3RvcnlcbiAqIGNvbnN0IHByb2plY3REaXIgPSBnZXRQcm9qZWN0RGlyKCk7XG4gKlxuICogLy8gQ2hlY2sgaWYgcnVubmluZyByZW1vdGVseVxuICogaWYgKGlzUmVtb3RlRW52aXJvbm1lbnQoKSkge1xuICogICAvLyBIYW5kbGUgcmVtb3RlLXNwZWNpZmljIGxvZ2ljXG4gKiB9XG4gKlxuICogLy8gSW4gU2Vzc2lvblN0YXJ0IGhvb2s6IHBlcnNpc3QgZW52aXJvbm1lbnQgdmFyaWFibGVzXG4gKiBwZXJzaXN0RW52VmFyKCdOT0RFX0VOVicsICdwcm9kdWN0aW9uJyk7XG4gKiBwZXJzaXN0RW52VmFyKCdBUElfS0VZJywgJ3NlY3JldC1rZXknKTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI2hvb2stZXhlY3V0aW9uLWRldGFpbHNcbiAqL1xuaW1wb3J0ICogYXMgZnMgZnJvbSBcIm5vZGU6ZnNcIjtcbi8qKlxuICogQ2xhdWRlIENvZGUgZW52aXJvbm1lbnQgdmFyaWFibGUgbmFtZXMuXG4gKlxuICogVGhlc2UgYXJlIHRoZSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgdGhhdCBDbGF1ZGUgQ29kZSBzZXRzIHdoZW4gcnVubmluZyBob29rcy5cbiAqL1xuZXhwb3J0IGNvbnN0IENMQVVERV9FTlZfVkFSUyA9IHtcbiAgICAvKipcbiAgICAgKiBBYnNvbHV0ZSBwYXRoIHRvIHRoZSBwcm9qZWN0IHJvb3QgZGlyZWN0b3J5IHdoZXJlIENsYXVkZSBDb2RlIHdhcyBzdGFydGVkLlxuICAgICAqIEF2YWlsYWJsZSBpbiBhbGwgaG9va3MuXG4gICAgICovXG4gICAgUFJPSkVDVF9ESVI6IFwiQ0xBVURFX1BST0pFQ1RfRElSXCIsXG4gICAgLyoqXG4gICAgICogUGF0aCB0byBhIGZpbGUgd2hlcmUgU2Vzc2lvblN0YXJ0IGhvb2tzIGNhbiBwZXJzaXN0IGVudmlyb25tZW50IHZhcmlhYmxlcy5cbiAgICAgKiBWYXJpYWJsZXMgd3JpdHRlbiB0byB0aGlzIGZpbGUgd2lsbCBiZSBhdmFpbGFibGUgaW4gYWxsIHN1YnNlcXVlbnQgYmFzaCBjb21tYW5kcy5cbiAgICAgKiBPbmx5IGF2YWlsYWJsZSBpbiBTZXNzaW9uU3RhcnQgaG9va3MuXG4gICAgICovXG4gICAgRU5WX0ZJTEU6IFwiQ0xBVURFX0VOVl9GSUxFXCIsXG4gICAgLyoqXG4gICAgICogU2V0IHRvIFwidHJ1ZVwiIHdoZW4gcnVubmluZyBpbiBhIHJlbW90ZSAod2ViKSBlbnZpcm9ubWVudC5cbiAgICAgKiBOb3Qgc2V0IG9yIGVtcHR5IHdoZW4gcnVubmluZyBpbiBsb2NhbCBDTEkgZW52aXJvbm1lbnQuXG4gICAgICovXG4gICAgUkVNT1RFOiBcIkNMQVVERV9DT0RFX1JFTU9URVwiLFxufTtcbi8qKlxuICogR2V0cyB0aGUgQ2xhdWRlIENvZGUgcHJvamVjdCBkaXJlY3RvcnkuXG4gKlxuICogVGhpcyBpcyB0aGUgYWJzb2x1dGUgcGF0aCB0byB0aGUgcHJvamVjdCByb290IHdoZXJlIENsYXVkZSBDb2RlIHdhcyBzdGFydGVkLlxuICogVGhlIHZhbHVlIGNvbWVzIGZyb20gdGhlIGBDTEFVREVfUFJPSkVDVF9ESVJgIGVudmlyb25tZW50IHZhcmlhYmxlLlxuICogQHJldHVybnMgVGhlIHByb2plY3QgZGlyZWN0b3J5IHBhdGgsIG9yIHVuZGVmaW5lZCBpZiBub3Qgc2V0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogY29uc3QgcHJvamVjdERpciA9IGdldFByb2plY3REaXIoKTtcbiAqIGlmIChwcm9qZWN0RGlyKSB7XG4gKiAgIGNvbnN0IGNvbmZpZ1BhdGggPSBgJHtwcm9qZWN0RGlyfS8uY2xhdWRlL2NvbmZpZy5qc29uYDtcbiAqIH1cbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0UHJvamVjdERpcigpIHtcbiAgICByZXR1cm4gcHJvY2Vzcy5lbnZbQ0xBVURFX0VOVl9WQVJTLlBST0pFQ1RfRElSXTtcbn1cbi8qKlxuICogR2V0cyB0aGUgQ2xhdWRlIENvZGUgZW52IGZpbGUgcGF0aCBmb3IgcGVyc2lzdGluZyBlbnZpcm9ubWVudCB2YXJpYWJsZXMuXG4gKlxuICogVGhpcyBpcyBvbmx5IGF2YWlsYWJsZSBpbiBTZXNzaW9uU3RhcnQgaG9va3MuIFRoZSBwYXRoIHBvaW50cyB0byBhIGZpbGVcbiAqIHdoZXJlIHlvdSBjYW4gd3JpdGUgc2hlbGwgZXhwb3J0IHN0YXRlbWVudHMgdG8gcGVyc2lzdCBlbnZpcm9ubWVudCB2YXJpYWJsZXNcbiAqIGZvciBhbGwgc3Vic2VxdWVudCBiYXNoIGNvbW1hbmRzIGluIHRoZSBzZXNzaW9uLlxuICogQHJldHVybnMgVGhlIGVudiBmaWxlIHBhdGgsIG9yIHVuZGVmaW5lZCBpZiBub3Qgc2V0IChub3QgYSBTZXNzaW9uU3RhcnQgaG9vaylcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCBlbnZGaWxlID0gZ2V0RW52RmlsZVBhdGgoKTtcbiAqIGlmIChlbnZGaWxlKSB7XG4gKiAgIC8vIFdlJ3JlIGluIGEgU2Vzc2lvblN0YXJ0IGhvb2sgYW5kIGNhbiBwZXJzaXN0IGVudiB2YXJzXG4gKiAgIHBlcnNpc3RFbnZWYXIoJ01ZX1ZBUicsICdteS12YWx1ZScpO1xuICogfVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRFbnZGaWxlUGF0aCgpIHtcbiAgICByZXR1cm4gcHJvY2Vzcy5lbnZbQ0xBVURFX0VOVl9WQVJTLkVOVl9GSUxFXTtcbn1cbi8qKlxuICogQ2hlY2tzIGlmIHRoZSBob29rIGlzIHJ1bm5pbmcgaW4gYSByZW1vdGUgKHdlYikgZW52aXJvbm1lbnQuXG4gKlxuICogUmVtb3RlIGVudmlyb25tZW50cyBtYXkgaGF2ZSBkaWZmZXJlbnQgY2FwYWJpbGl0aWVzIG9yIHJlc3RyaWN0aW9uc1xuICogY29tcGFyZWQgdG8gbG9jYWwgQ0xJIGVudmlyb25tZW50cy5cbiAqIEByZXR1cm5zIHRydWUgaWYgcnVubmluZyByZW1vdGVseSwgZmFsc2UgaWYgcnVubmluZyBsb2NhbGx5XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaWYgKGlzUmVtb3RlRW52aXJvbm1lbnQoKSkge1xuICogICAvLyBVc2Ugd2ViLWNvbXBhdGlibGUgYXBwcm9hY2hlc1xuICogfSBlbHNlIHtcbiAqICAgLy8gQ2FuIHVzZSBsb2NhbCBDTEkgZmVhdHVyZXNcbiAqIH1cbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNSZW1vdGVFbnZpcm9ubWVudCgpIHtcbiAgICByZXR1cm4gcHJvY2Vzcy5lbnZbQ0xBVURFX0VOVl9WQVJTLlJFTU9URV0gPT09IFwidHJ1ZVwiO1xufVxuLyoqXG4gKiBQZXJzaXN0cyBhbiBlbnZpcm9ubWVudCB2YXJpYWJsZSBmb3IgdXNlIGluIHN1YnNlcXVlbnQgYmFzaCBjb21tYW5kcy5cbiAqXG4gKiBUaGlzIGZ1bmN0aW9uIHdyaXRlcyBhIHNoZWxsIGV4cG9ydCBzdGF0ZW1lbnQgdG8gdGhlIGBDTEFVREVfRU5WX0ZJTEVgLFxuICogd2hpY2ggQ2xhdWRlIENvZGUgc291cmNlcyBiZWZvcmUgcnVubmluZyBiYXNoIGNvbW1hbmRzLiBUaGlzIGFsbG93c1xuICogU2Vzc2lvblN0YXJ0IGhvb2tzIHRvIGNvbmZpZ3VyZSB0aGUgZW52aXJvbm1lbnQgZm9yIHRoZSBlbnRpcmUgc2Vzc2lvbi5cbiAqXG4gKiAqKkltcG9ydGFudCoqOiBUaGlzIGZ1bmN0aW9uIG9ubHkgd29ya3MgaW4gU2Vzc2lvblN0YXJ0IGhvb2tzIHdoZXJlXG4gKiBgQ0xBVURFX0VOVl9GSUxFYCBpcyBzZXQuIEluIG90aGVyIGhvb2tzLCBpdCB3aWxsIHRocm93IGFuIGVycm9yLlxuICogQHBhcmFtIG5hbWUgLSBUaGUgZW52aXJvbm1lbnQgdmFyaWFibGUgbmFtZVxuICogQHBhcmFtIHZhbHVlIC0gVGhlIGVudmlyb25tZW50IHZhcmlhYmxlIHZhbHVlICh3aWxsIGJlIHNoZWxsLWVzY2FwZWQpXG4gKiBAdGhyb3dzIEVycm9yIGlmIENMQVVERV9FTlZfRklMRSBpcyBub3Qgc2V0IChub3QgaW4gYSBTZXNzaW9uU3RhcnQgaG9vaylcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBzZXNzaW9uU3RhcnRIb29rLCBzZXNzaW9uU3RhcnRPdXRwdXQsIHBlcnNpc3RFbnZWYXIgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIGV4cG9ydCBkZWZhdWx0IHNlc3Npb25TdGFydEhvb2soe30sIGFzeW5jIChpbnB1dCkgPT4ge1xuICogICAvLyBQZXJzaXN0IGVudmlyb25tZW50IHZhcmlhYmxlcyBmb3IgdGhlIHNlc3Npb25cbiAqICAgcGVyc2lzdEVudlZhcignTk9ERV9FTlYnLCAncHJvZHVjdGlvbicpO1xuICogICBwZXJzaXN0RW52VmFyKCdBUElfS0VZJywgcHJvY2Vzcy5lbnYuTVlfQVBJX0tFWSA/PyAnZGVmYXVsdCcpO1xuICogICBwZXJzaXN0RW52VmFyKCdQQVRIJywgYCR7cHJvY2Vzcy5lbnYuUEFUSH06Li9ub2RlX21vZHVsZXMvLmJpbmApO1xuICpcbiAqICAgcmV0dXJuIHNlc3Npb25TdGFydE91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3BlcnNpc3RpbmctZW52aXJvbm1lbnQtdmFyaWFibGVzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwZXJzaXN0RW52VmFyKG5hbWUsIHZhbHVlKSB7XG4gICAgY29uc3QgZW52RmlsZSA9IGdldEVudkZpbGVQYXRoKCk7XG4gICAgaWYgKGVudkZpbGUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJwZXJzaXN0RW52VmFyIGNhbiBvbmx5IGJlIHVzZWQgaW4gU2Vzc2lvblN0YXJ0IGhvb2tzLiBcIiArIFwiQ0xBVURFX0VOVl9GSUxFIGVudmlyb25tZW50IHZhcmlhYmxlIGlzIG5vdCBzZXQuXCIpO1xuICAgIH1cbiAgICAvLyBTaGVsbC1lc2NhcGUgdGhlIHZhbHVlIHRvIGhhbmRsZSBzcGVjaWFsIGNoYXJhY3RlcnNcbiAgICBjb25zdCBlc2NhcGVkVmFsdWUgPSBlc2NhcGVTaGVsbFZhbHVlKHZhbHVlKTtcbiAgICAvLyBXcml0ZSB0aGUgZXhwb3J0IHN0YXRlbWVudFxuICAgIGNvbnN0IGV4cG9ydFN0YXRlbWVudCA9IGBleHBvcnQgJHtuYW1lfT0ke2VzY2FwZWRWYWx1ZX1cXG5gO1xuICAgIGZzLmFwcGVuZEZpbGVTeW5jKGVudkZpbGUsIGV4cG9ydFN0YXRlbWVudCwgXCJ1dGYtOFwiKTtcbn1cbi8qKlxuICogUGVyc2lzdHMgbXVsdGlwbGUgZW52aXJvbm1lbnQgdmFyaWFibGVzIGF0IG9uY2UuXG4gKlxuICogVGhpcyBpcyBhIGNvbnZlbmllbmNlIHdyYXBwZXIgYXJvdW5kIGBwZXJzaXN0RW52VmFyYCBmb3Igc2V0dGluZ1xuICogbXVsdGlwbGUgdmFyaWFibGVzIGluIGEgc2luZ2xlIGNhbGwuXG4gKiBAcGFyYW0gdmFycyAtIE9iamVjdCBtYXBwaW5nIHZhcmlhYmxlIG5hbWVzIHRvIHZhbHVlc1xuICogQHRocm93cyBFcnJvciBpZiBDTEFVREVfRU5WX0ZJTEUgaXMgbm90IHNldCAobm90IGluIGEgU2Vzc2lvblN0YXJ0IGhvb2spXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogcGVyc2lzdEVudlZhcnMoe1xuICogICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxuICogICBBUElfS0VZOiAnc2VjcmV0JyxcbiAqICAgREVCVUc6ICdmYWxzZSdcbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwZXJzaXN0RW52VmFycyh2YXJzKSB7XG4gICAgZm9yIChjb25zdCBbbmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHZhcnMpKSB7XG4gICAgICAgIHBlcnNpc3RFbnZWYXIobmFtZSwgdmFsdWUpO1xuICAgIH1cbn1cbi8qKlxuICogRXNjYXBlcyBhIHZhbHVlIGZvciBzYWZlIHVzZSBpbiBhIHNoZWxsIGV4cG9ydCBzdGF0ZW1lbnQuXG4gKlxuICogVXNlcyBzaW5nbGUgcXVvdGVzIGFuZCBlc2NhcGVzIGFueSBlbWJlZGRlZCBzaW5nbGUgcXVvdGVzLlxuICogVGhpcyBwcmV2ZW50cyBzaGVsbCBpbmplY3Rpb24gYW5kIGhhbmRsZXMgc3BlY2lhbCBjaGFyYWN0ZXJzLlxuICogQHBhcmFtIHZhbHVlIC0gVGhlIHZhbHVlIHRvIGVzY2FwZVxuICogQHJldHVybnMgVGhlIHNoZWxsLWVzY2FwZWQgdmFsdWUgKHdpdGggcXVvdGVzKVxuICogQGludGVybmFsXG4gKi9cbmZ1bmN0aW9uIGVzY2FwZVNoZWxsVmFsdWUodmFsdWUpIHtcbiAgICAvLyBVc2Ugc2luZ2xlIHF1b3RlcyBhbmQgZXNjYXBlIGFueSBlbWJlZGRlZCBzaW5nbGUgcXVvdGVzXG4gICAgLy8gJ3ZhbHVlJyAtPiAndmFsJ1xcJyd1ZScgZm9yIHZhbHVlcyBjb250YWluaW5nIHNpbmdsZSBxdW90ZXNcbiAgICBjb25zdCBlc2NhcGVkID0gdmFsdWUucmVwbGFjZSgvJy9nLCBcIidcXFxcJydcIik7XG4gICAgcmV0dXJuIGAnJHtlc2NhcGVkfSdgO1xufVxuIiwgIi8qKlxuICogSG9vayBmYWN0b3J5IGZ1bmN0aW9ucyBmb3IgQ2xhdWRlIENvZGUgaG9va3MuXG4gKlxuICogUHJvdmlkZXMgdHlwZWQgZmFjdG9yeSBmdW5jdGlvbnMgZm9yIGFsbCAxMiBob29rIHR5cGVzIHRoYXQgaGFuZGxlOlxuICogLSBJbnB1dCB0eXBlIG5hcnJvd2luZyBiYXNlZCBvbiBob29rIGV2ZW50IHR5cGVcbiAqIC0gT3V0cHV0IHR5cGUgZW5mb3JjZW1lbnQgdmlhIHJldHVybiB0eXBlc1xuICogLSBFcnJvciB3cmFwcGluZyB3aXRoIGF1dG9tYXRpYyBsb2dnaW5nXG4gKiAtIExvZ2dlciBjb250ZXh0IGluamVjdGlvblxuICpcbiAqIEVhY2ggZmFjdG9yeSBhY2NlcHRzIGEgSG9va0NvbmZpZyB3aXRoIG9wdGlvbmFsIG1hdGNoZXIgYW5kIHRpbWVvdXQgc2V0dGluZ3MsXG4gKiBhbmQgcmV0dXJucyBhIGZ1bmN0aW9uIHRoYXQgdGhlIHJ1bnRpbWUgaW52b2tlcyB3aGVuIHRoZSBob29rIGZpbGUgZXhlY3V0ZXMuXG4gKiBAbW9kdWxlXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgcHJlVG9vbFVzZUhvb2ssIHByZVRvb2xVc2VPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIGV4cG9ydCBkZWZhdWx0IHByZVRvb2xVc2VIb29rKHsgbWF0Y2hlcjogJ0Jhc2gnIH0sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnUHJvY2Vzc2luZyBCYXNoIGNvbW1hbmQnKTtcbiAqICAgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoeyBhbGxvdzogdHJ1ZSB9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3NcbiAqL1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gR2VuZXJpYyBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBob29rIGZhY3RvcnkgZnVuY3Rpb24gZm9yIGEgc3BlY2lmaWMgaG9vayB0eXBlLlxuICpcbiAqIFRoaXMgaXMgdGhlIGludGVybmFsIGltcGxlbWVudGF0aW9uIHVzZWQgYnkgYWxsIHR5cGVkIGZhY3Rvcmllcy5cbiAqIEl0IHdyYXBzIHRoZSBoYW5kbGVyIHdpdGggZXJyb3IgY2F0Y2hpbmcgYW5kIGxvZ2dpbmcuXG4gKiBAcGFyYW0gaG9va0V2ZW50TmFtZSAtIFRoZSBob29rIGV2ZW50IG5hbWVcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb25cbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gd3JhcFxuICogQHJldHVybnMgQSB3cmFwcGVkIGhvb2sgZnVuY3Rpb25cbiAqIEBpbnRlcm5hbFxuICovXG5mdW5jdGlvbiBjcmVhdGVIb29rRnVuY3Rpb24oaG9va0V2ZW50TmFtZSwgY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgY29uc3QgaG9va0ZuID0gYXN5bmMgKGlucHV0LCBjb250ZXh0KSA9PiB7XG4gICAgICAgIC8vIERlbGVnYXRlIGVycm9yIGhhbmRsaW5nIHRvIHRoZSBydW50aW1lIC0ganVzdCBleGVjdXRlIHRoZSBoYW5kbGVyXG4gICAgICAgIC8vIFRoZSBydW50aW1lIHdpbGwgY2F0Y2ggZXJyb3JzLCBsb2cgdGhlbSwgYW5kIHJldHVybiBhcHByb3ByaWF0ZSBvdXRwdXRcbiAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZXIoaW5wdXQsIGNvbnRleHQpO1xuICAgIH07XG4gICAgLy8gQXR0YWNoIG1ldGFkYXRhIGZvciBydW50aW1lIGluc3BlY3Rpb25cbiAgICBob29rRm4uaG9va0V2ZW50TmFtZSA9IGhvb2tFdmVudE5hbWU7XG4gICAgaG9va0ZuLm1hdGNoZXIgPSBjb25maWcubWF0Y2hlcjtcbiAgICBob29rRm4udGltZW91dCA9IGNvbmZpZy50aW1lb3V0O1xuICAgIHJldHVybiBob29rRm47XG59XG4vKiogQGluaGVyaXRkb2MgKi9cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiUHJlVG9vbFVzZVwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLyoqIEBpbmhlcml0ZG9jICovXG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJQb3N0VG9vbFVzZVwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLyoqIEBpbmhlcml0ZG9jICovXG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VGYWlsdXJlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiUG9zdFRvb2xVc2VGYWlsdXJlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBQb3N0VG9vbEJhdGNoIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgUG9zdFRvb2xCYXRjaCBob29rIGhhbmRsZXIuXG4gKlxuICogUG9zdFRvb2xCYXRjaCBob29rcyBmaXJlIGV4YWN0bHkgb25jZSBhZnRlciBldmVyeSB0b29sIGNhbGwgaW4gYSBiYXRjaCBoYXNcbiAqIHJlc29sdmVkLCBiZWZvcmUgdGhlIG5leHQgbW9kZWwgcmVxdWVzdC4gVW5saWtlIFBvc3RUb29sVXNlIFx1MjAxNCB3aGljaCBmaXJlcyBwZXJcbiAqIHRvb2wgYW5kIG1heSBydW4gY29uY3VycmVudGx5IGZvciBwYXJhbGxlbCB0b29sIGNhbGxzIFx1MjAxNCBQb3N0VG9vbEJhdGNoIHJlY2VpdmVzXG4gKiB0aGUgZnVsbCBiYXRjaCB2aWEgYGlucHV0LnRvb2xfY2FsbHNgLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEluc3BlY3Qgb3Igc3VtbWFyaXplIGFsbCB0b29sIGNhbGxzIGluIGEgc2luZ2xlIHR1cm4gdG9nZXRoZXJcbiAqIC0gSW5qZWN0IGFkZGl0aW9uYWwgY29udGV4dCBvbmNlIHBlciBiYXRjaCBpbnN0ZWFkIG9mIG9uY2UgcGVyIHRvb2xcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb25jZSBwZXIgYmF0Y2hcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0IChtYXRjaGVyIGlzIGlnbm9yZWQpXG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBwb3N0VG9vbEJhdGNoSG9vaywgcG9zdFRvb2xCYXRjaE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgcG9zdFRvb2xCYXRjaEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnVG9vbCBiYXRjaCBjb21wbGV0ZWQnLCB7IGNvdW50OiBpbnB1dC50b29sX2NhbGxzLmxlbmd0aCB9KTtcbiAqXG4gKiAgIHJldHVybiBwb3N0VG9vbEJhdGNoT3V0cHV0KHtcbiAqICAgICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBgUmV2aWV3ZWQgJHtpbnB1dC50b29sX2NhbGxzLmxlbmd0aH0gdG9vbCBjYWxsc2BcbiAqICAgICB9XG4gKiAgIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNwb3N0dG9vbGJhdGNoXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbEJhdGNoSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiUG9zdFRvb2xCYXRjaFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gTm90aWZpY2F0aW9uIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgTm90aWZpY2F0aW9uIGhvb2sgaGFuZGxlci5cbiAqXG4gKiBOb3RpZmljYXRpb24gaG9va3MgZmlyZSB3aGVuIENsYXVkZSBDb2RlIHNlbmRzIGEgbm90aWZpY2F0aW9uLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEZvcndhcmQgbm90aWZpY2F0aW9ucyB0byBleHRlcm5hbCBzeXN0ZW1zXG4gKiAtIExvZyBpbXBvcnRhbnQgZXZlbnRzXG4gKiAtIFRyaWdnZXIgY3VzdG9tIGFsZXJ0aW5nXG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgbm90aWZpY2F0aW9uX3R5cGVgXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgbWF0Y2hlciBhbmQgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgbm90aWZpY2F0aW9uSG9vaywgbm90aWZpY2F0aW9uT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBGb3J3YXJkIG5vdGlmaWNhdGlvbnMgdG8gU2xhY2tcbiAqIGV4cG9ydCBkZWZhdWx0IG5vdGlmaWNhdGlvbkhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnTm90aWZpY2F0aW9uIHJlY2VpdmVkJywge1xuICogICAgIHR5cGU6IGlucHV0Lm5vdGlmaWNhdGlvbl90eXBlLFxuICogICAgIHRpdGxlOiBpbnB1dC50aXRsZVxuICogICB9KTtcbiAqXG4gKiAgIGF3YWl0IHNlbmRTbGFja01lc3NhZ2UoaW5wdXQudGl0bGUgPz8gJ05vdGlmaWNhdGlvbicsIGlucHV0Lm1lc3NhZ2UpO1xuICpcbiAqICAgcmV0dXJuIG5vdGlmaWNhdGlvbk91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI25vdGlmaWNhdGlvblxuICovXG5leHBvcnQgZnVuY3Rpb24gbm90aWZpY2F0aW9uSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiTm90aWZpY2F0aW9uXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBVc2VyUHJvbXB0U3VibWl0IEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgVXNlclByb21wdFN1Ym1pdCBob29rIGhhbmRsZXIuXG4gKlxuICogVXNlclByb21wdFN1Ym1pdCBob29rcyBmaXJlIHdoZW4gYSB1c2VyIHN1Ym1pdHMgYSBwcm9tcHQsIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gQWRkIGFkZGl0aW9uYWwgY29udGV4dCBvciBpbnN0cnVjdGlvbnNcbiAqIC0gTG9nIHVzZXIgaW50ZXJhY3Rpb25zXG4gKiAtIFZhbGlkYXRlIG9yIHRyYW5zZm9ybSBwcm9tcHRzXG4gKlxuICogKipNYXRjaGVyKio6IE5vIG1hdGNoZXIgc3VwcG9ydCAtIGZpcmVzIG9uIGFsbCBwcm9tcHQgc3VibWlzc2lvbnNcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0IChtYXRjaGVyIGlzIGlnbm9yZWQpXG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyB1c2VyUHJvbXB0U3VibWl0SG9vaywgdXNlclByb21wdFN1Ym1pdE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gQWRkIHByb2plY3QgY29udGV4dCB0byBldmVyeSBwcm9tcHRcbiAqIGV4cG9ydCBkZWZhdWx0IHVzZXJQcm9tcHRTdWJtaXRIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmRlYnVnKCdVc2VyIHByb21wdCBzdWJtaXR0ZWQnLCB7IHByb21wdExlbmd0aDogaW5wdXQucHJvbXB0Lmxlbmd0aCB9KTtcbiAqXG4gKiAgIGNvbnN0IHByb2plY3RDb250ZXh0ID0gYXdhaXQgZ2V0UHJvamVjdENvbnRleHQoKTtcbiAqXG4gKiAgIHJldHVybiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KHtcbiAqICAgICBhZGRpdGlvbmFsQ29udGV4dDogcHJvamVjdENvbnRleHRcbiAqICAgfSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3VzZXJwcm9tcHRzdWJtaXRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVzZXJQcm9tcHRTdWJtaXRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJVc2VyUHJvbXB0U3VibWl0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBVc2VyUHJvbXB0RXhwYW5zaW9uIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgVXNlclByb21wdEV4cGFuc2lvbiBob29rIGhhbmRsZXIuXG4gKlxuICogVXNlclByb21wdEV4cGFuc2lvbiBob29rcyBmaXJlIHdoZW4gYSB1c2VyIHByb21wdCBpcyBleHBhbmRlZCBmcm9tIGEgc2xhc2hcbiAqIGNvbW1hbmQgb3IgTUNQIHByb21wdCwgYWxsb3dpbmcgeW91IHRvOlxuICogLSBBZGQgY29udGV4dCBiYXNlZCBvbiB0aGUgY29tbWFuZCBiZWluZyBpbnZva2VkXG4gKiAtIExvZyBzbGFzaCBjb21tYW5kIGFuZCBNQ1AgcHJvbXB0IHVzYWdlXG4gKiAtIE9ic2VydmUgcHJvbXB0IGV4cGFuc2lvbiBldmVudHNcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHByb21wdCBleHBhbnNpb25zXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dCAobWF0Y2hlciBpcyBpZ25vcmVkKVxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgdXNlclByb21wdEV4cGFuc2lvbkhvb2ssIHVzZXJQcm9tcHRFeHBhbnNpb25PdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIC8vIEFkZCBjb250ZXh0IHdoZW4gYSBzbGFzaCBjb21tYW5kIGlzIGludm9rZWRcbiAqIGV4cG9ydCBkZWZhdWx0IHVzZXJQcm9tcHRFeHBhbnNpb25Ib29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmRlYnVnKCdQcm9tcHQgZXhwYW5kZWQnLCB7IHR5cGU6IGlucHV0LmV4cGFuc2lvbl90eXBlLCBjb21tYW5kOiBpbnB1dC5jb21tYW5kX25hbWUgfSk7XG4gKlxuICogICByZXR1cm4gdXNlclByb21wdEV4cGFuc2lvbk91dHB1dCh7XG4gKiAgICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogYENvbW1hbmQ6ICR7aW5wdXQuY29tbWFuZF9uYW1lfWBcbiAqICAgICB9XG4gKiAgIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyN1c2VycHJvbXB0ZXhwYW5zaW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB1c2VyUHJvbXB0RXhwYW5zaW9uSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiVXNlclByb21wdEV4cGFuc2lvblwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU2Vzc2lvblN0YXJ0IEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgU2Vzc2lvblN0YXJ0IGhvb2sgaGFuZGxlci5cbiAqXG4gKiBTZXNzaW9uU3RhcnQgaG9va3MgZmlyZSB3aGVuIGEgQ2xhdWRlIENvZGUgc2Vzc2lvbiBzdGFydHMgb3IgcmVzdGFydHMsXG4gKiBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEluaXRpYWxpemUgc2Vzc2lvbiBzdGF0ZVxuICogLSBJbmplY3QgY29udGV4dCBvciBpbnN0cnVjdGlvbnNcbiAqIC0gUGVyc2lzdCBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZm9yIHN1YnNlcXVlbnQgYmFzaCBjb21tYW5kc1xuICogLSBTZXQgdXAgbG9nZ2luZyBvciBtb25pdG9yaW5nXG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgc291cmNlYCAoJ3N0YXJ0dXAnLCAncmVzdW1lJywgJ2NsZWFyJywgJ2NvbXBhY3QnKVxuICpcbiAqICoqQ29udGV4dCoqOiBTZXNzaW9uU3RhcnQgaG9va3MgcmVjZWl2ZSBhbiBleHRlbmRlZCBjb250ZXh0IHdpdGggYHBlcnNpc3RFbnZWYXJgXG4gKiBhbmQgYHBlcnNpc3RFbnZWYXJzYCBmdW5jdGlvbnMgZm9yIHNldHRpbmcgZW52aXJvbm1lbnQgdmFyaWFibGVzLlxuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIG1hdGNoZXIgYW5kIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHNlc3Npb25TdGFydEhvb2ssIHNlc3Npb25TdGFydE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gUGVyc2lzdCBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZm9yIHRoZSBzZXNzaW9uXG4gKiBleHBvcnQgZGVmYXVsdCBzZXNzaW9uU3RhcnRIb29rKHsgbWF0Y2hlcjogJ3N0YXJ0dXAnIH0sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIsIHBlcnNpc3RFbnZWYXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnTmV3IHNlc3Npb24gc3RhcnRlZCcsIHtcbiAqICAgICBzZXNzaW9uSWQ6IGlucHV0LnNlc3Npb25faWQsXG4gKiAgICAgY3dkOiBpbnB1dC5jd2RcbiAqICAgfSk7XG4gKlxuICogICAvLyBTZXQgZW52aXJvbm1lbnQgdmFyaWFibGVzIGZvciBhbGwgc3Vic2VxdWVudCBiYXNoIGNvbW1hbmRzXG4gKiAgIHBlcnNpc3RFbnZWYXIoJ05PREVfRU5WJywgJ2RldmVsb3BtZW50Jyk7XG4gKiAgIHBlcnNpc3RFbnZWYXIoJ0RFQlVHJywgJ3RydWUnKTtcbiAqXG4gKiAgIHJldHVybiBzZXNzaW9uU3RhcnRPdXRwdXQoe30pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBTZXQgbXVsdGlwbGUgZW52aXJvbm1lbnQgdmFyaWFibGVzIGF0IG9uY2VcbiAqIGV4cG9ydCBkZWZhdWx0IHNlc3Npb25TdGFydEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBwZXJzaXN0RW52VmFycyB9KSA9PiB7XG4gKiAgIHBlcnNpc3RFbnZWYXJzKHtcbiAqICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxuICogICAgIEFQSV9LRVk6ICdzZWNyZXQnLFxuICogICAgIERFQlVHOiAnZmFsc2UnXG4gKiAgIH0pO1xuICpcbiAqICAgcmV0dXJuIHNlc3Npb25TdGFydE91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3Nlc3Npb25zdGFydFxuICovXG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiU2Vzc2lvblN0YXJ0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTZXNzaW9uRW5kIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgU2Vzc2lvbkVuZCBob29rIGhhbmRsZXIuXG4gKlxuICogU2Vzc2lvbkVuZCBob29rcyBmaXJlIHdoZW4gYSBDbGF1ZGUgQ29kZSBzZXNzaW9uIGVuZHMsIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gQ2xlYW4gdXAgc2Vzc2lvbiByZXNvdXJjZXNcbiAqIC0gTG9nIHNlc3Npb24gbWV0cmljc1xuICogLSBQZXJzaXN0IHNlc3Npb24gc3RhdGVcbiAqXG4gKiAqKk1hdGNoZXIqKjogTWF0Y2hlcyBhZ2FpbnN0IGByZWFzb25gICh0aGUgZXhpdCByZWFzb24gc3RyaW5nKVxuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIG1hdGNoZXIgYW5kIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHNlc3Npb25FbmRIb29rLCBzZXNzaW9uRW5kT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBMb2cgc2Vzc2lvbiBlbmQgYW5kIGNsZWFuIHVwXG4gKiBleHBvcnQgZGVmYXVsdCBzZXNzaW9uRW5kSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdTZXNzaW9uIGVuZGVkJywge1xuICogICAgIHNlc3Npb25JZDogaW5wdXQuc2Vzc2lvbl9pZCxcbiAqICAgICByZWFzb246IGlucHV0LnJlYXNvblxuICogICB9KTtcbiAqXG4gKiAgIGF3YWl0IGNsZWFudXBTZXNzaW9uUmVzb3VyY2VzKGlucHV0LnNlc3Npb25faWQpO1xuICpcbiAqICAgcmV0dXJuIHNlc3Npb25FbmRPdXRwdXQoe30pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNzZXNzaW9uZW5kXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uRW5kSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiU2Vzc2lvbkVuZFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU3RvcCBIb29rIEZhY3Rvcnlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhIFN0b3AgaG9vayBoYW5kbGVyLlxuICpcbiAqIFN0b3AgaG9va3MgZmlyZSB3aGVuIENsYXVkZSBDb2RlIGlzIGFib3V0IHRvIHN0b3AsIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gQmxvY2sgdGhlIHN0b3AgYW5kIHJlcXVpcmUgYWRkaXRpb25hbCBhY3Rpb25cbiAqIC0gQ29uZmlybSB0aGUgdXNlciB3YW50cyB0byBzdG9wXG4gKiAtIENsZWFuIHVwIHJlc291cmNlcyBiZWZvcmUgc3RvcHBpbmdcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHN0b3AgZXZlbnRzXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dCAobWF0Y2hlciBpcyBpZ25vcmVkKVxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgc3RvcEhvb2ssIHN0b3BPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIC8vIEJsb2NrIHN0b3AgaWYgdGhlcmUgYXJlIHBlbmRpbmcgY2hhbmdlc1xuICogZXhwb3J0IGRlZmF1bHQgc3RvcEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBjb25zdCBwZW5kaW5nQ2hhbmdlcyA9IGF3YWl0IGNoZWNrUGVuZGluZ0NoYW5nZXMoKTtcbiAqXG4gKiAgIGlmIChwZW5kaW5nQ2hhbmdlcy5sZW5ndGggPiAwKSB7XG4gKiAgICAgbG9nZ2VyLndhcm4oJ0Jsb2NraW5nIHN0b3AgZHVlIHRvIHBlbmRpbmcgY2hhbmdlcycsIHtcbiAqICAgICAgIGNvdW50OiBwZW5kaW5nQ2hhbmdlcy5sZW5ndGhcbiAqICAgICB9KTtcbiAqXG4gKiAgICAgcmV0dXJuIHN0b3BPdXRwdXQoe1xuICogICAgICAgZGVjaXNpb246ICdibG9jaycsXG4gKiAgICAgICByZWFzb246IGBUaGVyZSBhcmUgJHtwZW5kaW5nQ2hhbmdlcy5sZW5ndGh9IHVuY29tbWl0dGVkIGNoYW5nZXNgLFxuICogICAgICAgc3lzdGVtTWVzc2FnZTogJ1BsZWFzZSBjb21taXQgb3IgZGlzY2FyZCBjaGFuZ2VzIGJlZm9yZSBzdG9wcGluZydcbiAqICAgICB9KTtcbiAqICAgfVxuICpcbiAqICAgbG9nZ2VyLmluZm8oJ0FwcHJvdmluZyBzdG9wJyk7XG4gKiAgIHJldHVybiBzdG9wT3V0cHV0KHsgZGVjaXNpb246ICdhcHByb3ZlJyB9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3Mjc3RvcFxuICovXG5leHBvcnQgZnVuY3Rpb24gc3RvcEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlN0b3BcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFN0b3BGYWlsdXJlIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgU3RvcEZhaWx1cmUgaG9vayBoYW5kbGVyLlxuICpcbiAqIFN0b3BGYWlsdXJlIGhvb2tzIGZpcmUgd2hlbiBDbGF1ZGUgQ29kZSBlbmNvdW50ZXJzIGFuIGVycm9yIHdoaWxlIHN0b3BwaW5nXG4gKiAoZS5nLiwgQVBJIGVycm9ycywgYXV0aGVudGljYXRpb24gZmFpbHVyZXMsIHJhdGUgbGltaXRzKSwgYWxsb3dpbmcgeW91IHRvOlxuICogLSBMb2cgc3RvcCBmYWlsdXJlIGV2ZW50cyBhbmQgZXJyb3IgZGV0YWlsc1xuICogLSBBbGVydCBvbiB1bmV4cGVjdGVkIHNlc3Npb24gdGVybWluYXRpb24gZXJyb3JzXG4gKiAtIE9ic2VydmUgd2hhdCBlcnJvciBjYXVzZWQgdGhlIGZhaWx1cmVcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHN0b3AgZmFpbHVyZSBldmVudHNcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0IChtYXRjaGVyIGlzIGlnbm9yZWQpXG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBzdG9wRmFpbHVyZUhvb2ssIHN0b3BGYWlsdXJlT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiBleHBvcnQgZGVmYXVsdCBzdG9wRmFpbHVyZUhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuZXJyb3IoJ1Nlc3Npb24gc3RvcHBlZCBkdWUgdG8gZXJyb3InLCB7XG4gKiAgICAgZXJyb3I6IGlucHV0LmVycm9yLFxuICogICAgIGRldGFpbHM6IGlucHV0LmVycm9yX2RldGFpbHNcbiAqICAgfSk7XG4gKiAgIHJldHVybiBzdG9wRmFpbHVyZU91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3N0b3BmYWlsdXJlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdG9wRmFpbHVyZUhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlN0b3BGYWlsdXJlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTdWJhZ2VudFN0YXJ0IEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgU3ViYWdlbnRTdGFydCBob29rIGhhbmRsZXIuXG4gKlxuICogU3ViYWdlbnRTdGFydCBob29rcyBmaXJlIHdoZW4gYSBzdWJhZ2VudCAoQWdlbnQgdG9vbCkgc3RhcnRzLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEluamVjdCBjb250ZXh0IGZvciB0aGUgc3ViYWdlbnRcbiAqIC0gTG9nIHN1YmFnZW50IGludm9jYXRpb25zXG4gKiAtIENvbmZpZ3VyZSBzdWJhZ2VudCBiZWhhdmlvclxuICpcbiAqICoqTWF0Y2hlcioqOiBNYXRjaGVzIGFnYWluc3QgYGFnZW50X3R5cGVgIChlLmcuLCAnZXhwbG9yZScsICdjb2RlYmFzZS1hbmFseXNpcycpXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgbWF0Y2hlciBhbmQgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgc3ViYWdlbnRTdGFydEhvb2ssIHN1YmFnZW50U3RhcnRPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIC8vIEFkZCBjb250ZXh0IGZvciBleHBsb3JlIHN1YmFnZW50c1xuICogZXhwb3J0IGRlZmF1bHQgc3ViYWdlbnRTdGFydEhvb2soeyBtYXRjaGVyOiAnZXhwbG9yZScgfSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdFeHBsb3JlIHN1YmFnZW50IHN0YXJ0aW5nJywge1xuICogICAgIGFnZW50SWQ6IGlucHV0LmFnZW50X2lkLFxuICogICAgIGFnZW50VHlwZTogaW5wdXQuYWdlbnRfdHlwZVxuICogICB9KTtcbiAqXG4gKiAgIHJldHVybiBzdWJhZ2VudFN0YXJ0T3V0cHV0KHtcbiAqICAgICBhZGRpdGlvbmFsQ29udGV4dDogJ0ZvY3VzIG9uIGZpbmRpbmcgcGF0dGVybnMgYW5kIGNvbnZlbnRpb25zJ1xuICogICB9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3Mjc3ViYWdlbnRzdGFydFxuICovXG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlN1YmFnZW50U3RhcnRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFN1YmFnZW50U3RvcCBIb29rIEZhY3Rvcnlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhIFN1YmFnZW50U3RvcCBob29rIGhhbmRsZXIuXG4gKlxuICogU3ViYWdlbnRTdG9wIGhvb2tzIGZpcmUgd2hlbiBhIHN1YmFnZW50IGNvbXBsZXRlcyBvciBzdG9wcywgYWxsb3dpbmcgeW91IHRvOlxuICogLSBCbG9jayB0aGUgc3ViYWdlbnQgZnJvbSBzdG9wcGluZ1xuICogLSBQcm9jZXNzIHN1YmFnZW50IHJlc3VsdHNcbiAqIC0gQ2xlYW4gdXAgc3ViYWdlbnQgcmVzb3VyY2VzXG4gKiAtIExvZyBzdWJhZ2VudCBjb21wbGV0aW9uXG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgYWdlbnRfdHlwZWAgKGUuZy4sICdleHBsb3JlJywgJ2NvZGViYXNlLWFuYWx5c2lzJylcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCBtYXRjaGVyIGFuZCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBzdWJhZ2VudFN0b3BIb29rLCBzdWJhZ2VudFN0b3BPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIC8vIEJsb2NrIGV4cGxvcmUgc3ViYWdlbnRzIGlmIHRhc2sgaW5jb21wbGV0ZVxuICogZXhwb3J0IGRlZmF1bHQgc3ViYWdlbnRTdG9wSG9vayh7IG1hdGNoZXI6ICdleHBsb3JlJyB9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ1N1YmFnZW50IHN0b3BwaW5nJywge1xuICogICAgIGFnZW50SWQ6IGlucHV0LmFnZW50X2lkLFxuICogICAgIGFnZW50VHlwZTogaW5wdXQuYWdlbnRfdHlwZVxuICogICB9KTtcbiAqXG4gKiAgIC8vIEJsb2NrIGlmIHRyYW5zY3JpcHQgc2hvd3MgaW5jb21wbGV0ZSB3b3JrXG4gKiAgIHJldHVybiBzdWJhZ2VudFN0b3BPdXRwdXQoe1xuICogICAgIGRlY2lzaW9uOiAnYmxvY2snLFxuICogICAgIHJlYXNvbjogJ1BsZWFzZSB2ZXJpZnkgZXhwbG9yYXRpb24gaXMgY29tcGxldGUnXG4gKiAgIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNzdWJhZ2VudHN0b3BcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN1YmFnZW50U3RvcEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlN1YmFnZW50U3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUHJlQ29tcGFjdCBIb29rIEZhY3Rvcnlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhIFByZUNvbXBhY3QgaG9vayBoYW5kbGVyLlxuICpcbiAqIFByZUNvbXBhY3QgaG9va3MgZmlyZSBiZWZvcmUgY29udGV4dCBjb21wYWN0aW9uIG9jY3VycywgYWxsb3dpbmcgeW91IHRvOlxuICogLSBQcmVzZXJ2ZSBpbXBvcnRhbnQgaW5mb3JtYXRpb24gYmVmb3JlIGNvbXBhY3Rpb25cbiAqIC0gTG9nIGNvbXBhY3Rpb24gZXZlbnRzXG4gKiAtIE1vZGlmeSBjdXN0b20gaW5zdHJ1Y3Rpb25zIGZvciB0aGUgY29tcGFjdGVkIGNvbnRleHRcbiAqXG4gKiAqKk1hdGNoZXIqKjogTWF0Y2hlcyBhZ2FpbnN0IGB0cmlnZ2VyYCAoJ21hbnVhbCcsICdhdXRvJylcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCBtYXRjaGVyIGFuZCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBwcmVDb21wYWN0SG9vaywgcHJlQ29tcGFjdE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gTG9nIGNvbXBhY3Rpb24gZXZlbnRzIGFuZCBwcmVzZXJ2ZSBjb250ZXh0XG4gKiBleHBvcnQgZGVmYXVsdCBwcmVDb21wYWN0SG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdDb250ZXh0IGNvbXBhY3Rpb24gdHJpZ2dlcmVkJywge1xuICogICAgIHRyaWdnZXI6IGlucHV0LnRyaWdnZXIsXG4gKiAgICAgaGFzQ3VzdG9tSW5zdHJ1Y3Rpb25zOiBpbnB1dC5jdXN0b21faW5zdHJ1Y3Rpb25zICE9PSBudWxsXG4gKiAgIH0pO1xuICpcbiAqICAgcmV0dXJuIHByZUNvbXBhY3RPdXRwdXQoe1xuICogICAgIHN5c3RlbU1lc3NhZ2U6ICdSZW1lbWJlcjogc3RyaWN0IG1vZGUgaXMgZW5hYmxlZCdcbiAqICAgfSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIE9ubHkgaGFuZGxlIG1hbnVhbCBjb21wYWN0aW9uXG4gKiBleHBvcnQgZGVmYXVsdCBwcmVDb21wYWN0SG9vayh7IG1hdGNoZXI6ICdtYW51YWwnIH0sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnTWFudWFsIGNvbXBhY3Rpb24gcmVxdWVzdGVkJyk7XG4gKiAgIHJldHVybiBwcmVDb21wYWN0T3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjcHJlY29tcGFjdFxuICovXG5leHBvcnQgZnVuY3Rpb24gcHJlQ29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlByZUNvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFBvc3RDb21wYWN0IEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgUG9zdENvbXBhY3QgaG9vayBoYW5kbGVyLlxuICpcbiAqIFBvc3RDb21wYWN0IGhvb2tzIGZpcmUgYWZ0ZXIgY29udGV4dCBjb21wYWN0aW9uIGNvbXBsZXRlcywgYWxsb3dpbmcgeW91IHRvOlxuICogLSBPYnNlcnZlIHRoZSBjb21wYWN0aW9uIHN1bW1hcnkgYW5kIGRldGFpbHNcbiAqIC0gTG9nIGNvbXBhY3Rpb24gZXZlbnRzXG4gKiAtIFJlYWN0IHRvIHRoZSBuZXcgY29tcGFjdGVkIHN0YXRlXG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgdHJpZ2dlcmAgKCdtYW51YWwnLCAnYXV0bycpXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgbWF0Y2hlciBhbmQgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgcG9zdENvbXBhY3RIb29rLCBwb3N0Q29tcGFjdE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgcG9zdENvbXBhY3RIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ0NvbnRleHQgY29tcGFjdGlvbiBjb21wbGV0ZWQnLCB7XG4gKiAgICAgdHJpZ2dlcjogaW5wdXQudHJpZ2dlcixcbiAqICAgICBzdW1tYXJ5OiBpbnB1dC5jb21wYWN0X3N1bW1hcnlcbiAqICAgfSk7XG4gKiAgIHJldHVybiBwb3N0Q29tcGFjdE91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3Bvc3Rjb21wYWN0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlBvc3RDb21wYWN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vKiogQGluaGVyaXRkb2MgKi9cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uUmVxdWVzdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBQZXJtaXNzaW9uRGVuaWVkIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgUGVybWlzc2lvbkRlbmllZCBob29rIGhhbmRsZXIuXG4gKlxuICogUGVybWlzc2lvbkRlbmllZCBob29rcyBmaXJlIHdoZW4gYSBwZXJtaXNzaW9uIHJlcXVlc3QgaXMgZGVuaWVkIChlaXRoZXIgYnkgdGhlXG4gKiB1c2VyIG9yIGJ5IGEgUGVybWlzc2lvblJlcXVlc3QgaG9vayksIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gTG9nIHBlcm1pc3Npb24gZGVuaWFscyBmb3IgYXVkaXRpbmdcbiAqIC0gUmVhY3QgdG8gZGVuaWVkIHRvb2wgZXhlY3V0aW9uc1xuICogLSBPcHRpb25hbGx5IHJlcXVlc3QgYSByZXRyeSB2aWEgdGhlIG91dHB1dFxuICpcbiAqICoqTWF0Y2hlcioqOiBNYXRjaGVzIGFnYWluc3QgYHRvb2xfbmFtZWBcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCBtYXRjaGVyIGFuZCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBwZXJtaXNzaW9uRGVuaWVkSG9vaywgcGVybWlzc2lvbkRlbmllZE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gTG9nIGFsbCBwZXJtaXNzaW9uIGRlbmlhbHNcbiAqIGV4cG9ydCBkZWZhdWx0IHBlcm1pc3Npb25EZW5pZWRIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLndhcm4oJ1Blcm1pc3Npb24gZGVuaWVkJywge1xuICogICAgIHRvb2xOYW1lOiBpbnB1dC50b29sX25hbWUsXG4gKiAgICAgcmVhc29uOiBpbnB1dC5yZWFzb25cbiAqICAgfSk7XG4gKiAgIHJldHVybiBwZXJtaXNzaW9uRGVuaWVkT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjcGVybWlzc2lvbmRlbmllZFxuICovXG5leHBvcnQgZnVuY3Rpb24gcGVybWlzc2lvbkRlbmllZEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlBlcm1pc3Npb25EZW5pZWRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNldHVwIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgU2V0dXAgaG9vayBoYW5kbGVyLlxuICpcbiAqIFNldHVwIGhvb2tzIGZpcmUgZHVyaW5nIGluaXRpYWxpemF0aW9uIG9yIG1haW50ZW5hbmNlLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIENvbmZpZ3VyZSBpbml0aWFsIHNlc3Npb24gc3RhdGVcbiAqIC0gUGVyZm9ybSBzZXR1cCB0YXNrcyBiZWZvcmUgdGhlIHNlc3Npb24gc3RhcnRzXG4gKiAtIEFkZCBjb250ZXh0IGZvciBtYWludGVuYW5jZSBvcGVyYXRpb25zXG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgdHJpZ2dlcmAgKCdpbml0JyBvciAnbWFpbnRlbmFuY2UnKVxuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIG1hdGNoZXIgYW5kIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHNldHVwSG9vaywgc2V0dXBPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIC8vIEhhbmRsZSBhbGwgc2V0dXAgZXZlbnRzXG4gKiBleHBvcnQgZGVmYXVsdCBzZXR1cEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnU2V0dXAgdHJpZ2dlcmVkJywgeyB0cmlnZ2VyOiBpbnB1dC50cmlnZ2VyIH0pO1xuICogICByZXR1cm4gc2V0dXBPdXRwdXQoe30pO1xuICogfSk7XG4gKlxuICogLy8gT25seSBoYW5kbGUgaW5pdGlhbGl6YXRpb25cbiAqIGV4cG9ydCBkZWZhdWx0IHNldHVwSG9vayh7IG1hdGNoZXI6ICdpbml0JyB9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ0luaXRpYWxpemluZyBzZXNzaW9uJyk7XG4gKiAgIHJldHVybiBzZXR1cE91dHB1dCh7XG4gKiAgICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogJ1Nlc3Npb24gaW5pdGlhbGl6ZWQgd2l0aCBjdXN0b20gY29uZmlndXJhdGlvbidcbiAqICAgICB9XG4gKiAgIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNzZXR1cFxuICovXG5leHBvcnQgZnVuY3Rpb24gc2V0dXBIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJTZXR1cFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVGVhbW1hdGVJZGxlIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgVGVhbW1hdGVJZGxlIGhvb2sgaGFuZGxlci5cbiAqXG4gKiBUZWFtbWF0ZUlkbGUgaG9va3MgZmlyZSB3aGVuIGEgdGVhbW1hdGUgaW4gYSB0ZWFtIGlzIGFib3V0IHRvIGdvIGlkbGUsXG4gKiBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEFzc2lnbiB3b3JrIHRvIGlkbGUgdGVhbW1hdGVzXG4gKiAtIExvZyB0ZWFtIGFjdGl2aXR5XG4gKiAtIENvb3JkaW5hdGUgbXVsdGktYWdlbnQgd29ya2Zsb3dzXG4gKlxuICogKipNYXRjaGVyKio6IE5vIG1hdGNoZXIgc3VwcG9ydCAtIGZpcmVzIG9uIGFsbCB0ZWFtbWF0ZSBpZGxlIGV2ZW50c1xuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIHRpbWVvdXQgKG1hdGNoZXIgaXMgaWdub3JlZClcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHRlYW1tYXRlSWRsZUhvb2ssIHRlYW1tYXRlSWRsZU91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gTG9nIHdoZW4gdGVhbW1hdGVzIGdvIGlkbGVcbiAqIGV4cG9ydCBkZWZhdWx0IHRlYW1tYXRlSWRsZUhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnVGVhbW1hdGUgZ29pbmcgaWRsZScsIHtcbiAqICAgICB0ZWFtbWF0ZU5hbWU6IGlucHV0LnRlYW1tYXRlX25hbWUsXG4gKiAgICAgdGVhbU5hbWU6IGlucHV0LnRlYW1fbmFtZVxuICogICB9KTtcbiAqXG4gKiAgIHJldHVybiB0ZWFtbWF0ZUlkbGVPdXRwdXQoe30pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyN0ZWFtbWF0ZWlkbGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRlYW1tYXRlSWRsZUhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlRlYW1tYXRlSWRsZVwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVGFza0NyZWF0ZWQgSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBUYXNrQ3JlYXRlZCBob29rIGhhbmRsZXIuXG4gKlxuICogVGFza0NyZWF0ZWQgaG9va3MgZmlyZSB3aGVuIGEgbmV3IHRhc2sgaXMgY3JlYXRlZCBhbmQgYXNzaWduZWQgdG8gYSB0ZWFtbWF0ZSxcbiAqIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gT2JzZXJ2ZSB0YXNrIGNyZWF0aW9uIGV2ZW50c1xuICogLSBMb2cgdGFzayBhc3NpZ25tZW50cyBmb3IgYXVkaXRpbmdcbiAqIC0gUmVhY3QgdG8gbmV3IHdvcmsgYmVpbmcgYXNzaWduZWRcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHRhc2sgY3JlYXRpb24gZXZlbnRzXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dCAobWF0Y2hlciBpcyBpZ25vcmVkKVxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgdGFza0NyZWF0ZWRIb29rLCB0YXNrQ3JlYXRlZE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gTG9nIHRhc2sgY3JlYXRpb25cbiAqIGV4cG9ydCBkZWZhdWx0IHRhc2tDcmVhdGVkSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdUYXNrIGNyZWF0ZWQnLCB7XG4gKiAgICAgdGFza0lkOiBpbnB1dC50YXNrX2lkLFxuICogICAgIHRhc2tTdWJqZWN0OiBpbnB1dC50YXNrX3N1YmplY3RcbiAqICAgfSk7XG4gKlxuICogICByZXR1cm4gdGFza0NyZWF0ZWRPdXRwdXQoe30pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyN0YXNrY3JlYXRlZFxuICovXG5leHBvcnQgZnVuY3Rpb24gdGFza0NyZWF0ZWRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJUYXNrQ3JlYXRlZFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVGFza0NvbXBsZXRlZCBIb29rIEZhY3Rvcnlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhIFRhc2tDb21wbGV0ZWQgaG9vayBoYW5kbGVyLlxuICpcbiAqIFRhc2tDb21wbGV0ZWQgaG9va3MgZmlyZSB3aGVuIGEgdGFzayBpcyBiZWluZyBtYXJrZWQgYXMgY29tcGxldGVkLFxuICogYWxsb3dpbmcgeW91IHRvOlxuICogLSBWZXJpZnkgdGFzayBjb21wbGV0aW9uXG4gKiAtIExvZyB0YXNrIG1ldHJpY3NcbiAqIC0gVHJpZ2dlciBmb2xsb3ctdXAgYWN0aW9uc1xuICpcbiAqICoqTWF0Y2hlcioqOiBObyBtYXRjaGVyIHN1cHBvcnQgLSBmaXJlcyBvbiBhbGwgdGFzayBjb21wbGV0aW9uIGV2ZW50c1xuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIHRpbWVvdXQgKG1hdGNoZXIgaXMgaWdub3JlZClcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHRhc2tDb21wbGV0ZWRIb29rLCB0YXNrQ29tcGxldGVkT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBMb2cgdGFzayBjb21wbGV0aW9uXG4gKiBleHBvcnQgZGVmYXVsdCB0YXNrQ29tcGxldGVkSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdUYXNrIGNvbXBsZXRlZCcsIHtcbiAqICAgICB0YXNrSWQ6IGlucHV0LnRhc2tfaWQsXG4gKiAgICAgdGFza1N1YmplY3Q6IGlucHV0LnRhc2tfc3ViamVjdFxuICogICB9KTtcbiAqXG4gKiAgIHJldHVybiB0YXNrQ29tcGxldGVkT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjdGFza2NvbXBsZXRlZFxuICovXG5leHBvcnQgZnVuY3Rpb24gdGFza0NvbXBsZXRlZEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlRhc2tDb21wbGV0ZWRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEVsaWNpdGF0aW9uIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGFuIEVsaWNpdGF0aW9uIGhvb2sgaGFuZGxlci5cbiAqXG4gKiBFbGljaXRhdGlvbiBob29rcyBmaXJlIHdoZW4gYW4gTUNQIHNlcnZlciByZXF1ZXN0cyB1c2VyIGlucHV0LCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEFjY2VwdCwgZGVjbGluZSwgb3IgY2FuY2VsIGVsaWNpdGF0aW9uIHJlcXVlc3RzIHByb2dyYW1tYXRpY2FsbHlcbiAqIC0gUHJvdmlkZSBzdHJ1Y3R1cmVkIGZvcm0gaW5wdXQgb3IgVVJMLWJhc2VkIGF1dGggcmVzcG9uc2VzXG4gKiAtIExvZyBvciBhdWRpdCBlbGljaXRhdGlvbiByZXF1ZXN0c1xuICpcbiAqICoqTWF0Y2hlcioqOiBObyBtYXRjaGVyIHN1cHBvcnQgLSBmaXJlcyBvbiBhbGwgZWxpY2l0YXRpb24gZXZlbnRzXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgZWxpY2l0YXRpb25Ib29rLCBlbGljaXRhdGlvbk91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgZWxpY2l0YXRpb25Ib29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ0VsaWNpdGF0aW9uIHJlcXVlc3QnLCB7IHNlcnZlcjogaW5wdXQubWNwX3NlcnZlcl9uYW1lIH0pO1xuICogICByZXR1cm4gZWxpY2l0YXRpb25PdXRwdXQoe1xuICogICAgIGhvb2tTcGVjaWZpY091dHB1dDogeyBhY3Rpb246ICdhY2NlcHQnLCBjb250ZW50OiB7IGFwcHJvdmVkOiB0cnVlIH0gfVxuICogICB9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjZWxpY2l0YXRpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVsaWNpdGF0aW9uSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiRWxpY2l0YXRpb25cIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEVsaWNpdGF0aW9uUmVzdWx0IEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGFuIEVsaWNpdGF0aW9uUmVzdWx0IGhvb2sgaGFuZGxlci5cbiAqXG4gKiBFbGljaXRhdGlvblJlc3VsdCBob29rcyBmaXJlIHdpdGggdGhlIHJlc3VsdCBvZiBhbiBNQ1AgZWxpY2l0YXRpb24gcmVxdWVzdCxcbiAqIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gT2JzZXJ2ZSBlbGljaXRhdGlvbiBvdXRjb21lc1xuICogLSBNb2RpZnkgdGhlIHJlc3VsdCBiZWZvcmUgaXQgaXMgcmV0dXJuZWQgdG8gdGhlIE1DUCBzZXJ2ZXJcbiAqIC0gTG9nIGVsaWNpdGF0aW9uIGNvbXBsZXRpb25zXG4gKlxuICogKipNYXRjaGVyKio6IE5vIG1hdGNoZXIgc3VwcG9ydCAtIGZpcmVzIG9uIGFsbCBlbGljaXRhdGlvbiByZXN1bHQgZXZlbnRzXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgZWxpY2l0YXRpb25SZXN1bHRIb29rLCBlbGljaXRhdGlvblJlc3VsdE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgZWxpY2l0YXRpb25SZXN1bHRIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ0VsaWNpdGF0aW9uIHJlc3VsdCcsIHsgYWN0aW9uOiBpbnB1dC5hY3Rpb24gfSk7XG4gKiAgIHJldHVybiBlbGljaXRhdGlvblJlc3VsdE91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI2VsaWNpdGF0aW9ucmVzdWx0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbGljaXRhdGlvblJlc3VsdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIkVsaWNpdGF0aW9uUmVzdWx0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBDb25maWdDaGFuZ2UgSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBDb25maWdDaGFuZ2UgaG9vayBoYW5kbGVyLlxuICpcbiAqIENvbmZpZ0NoYW5nZSBob29rcyBmaXJlIHdoZW4gQ2xhdWRlIENvZGUgY29uZmlndXJhdGlvbiBjaGFuZ2VzLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIFJlYWN0IHRvIHNldHRpbmdzIGZpbGUgY2hhbmdlc1xuICogLSBMb2cgb3IgYXVkaXQgY29uZmlndXJhdGlvbiBjaGFuZ2VzXG4gKiAtIEFwcGx5IGN1c3RvbSBsb2dpYyB3aGVuIHNldHRpbmdzIGFyZSB1cGRhdGVkXG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgc291cmNlYCAoJ3VzZXJfc2V0dGluZ3MnLCAncHJvamVjdF9zZXR0aW5ncycsIGV0Yy4pXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgbWF0Y2hlciBhbmQgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgY29uZmlnQ2hhbmdlSG9vaywgY29uZmlnQ2hhbmdlT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiBleHBvcnQgZGVmYXVsdCBjb25maWdDaGFuZ2VIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ0NvbmZpZyBjaGFuZ2VkJywgeyBzb3VyY2U6IGlucHV0LnNvdXJjZSwgZmlsZTogaW5wdXQuZmlsZV9wYXRoIH0pO1xuICogICByZXR1cm4gY29uZmlnQ2hhbmdlT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjY29uZmlnY2hhbmdlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb25maWdDaGFuZ2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJDb25maWdDaGFuZ2VcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEluc3RydWN0aW9uc0xvYWRlZCBIb29rIEZhY3Rvcnlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhbiBJbnN0cnVjdGlvbnNMb2FkZWQgaG9vayBoYW5kbGVyLlxuICpcbiAqIEluc3RydWN0aW9uc0xvYWRlZCBob29rcyBmaXJlIHdoZW4gYSBDTEFVREUubWQgb3Igc2ltaWxhciBpbnN0cnVjdGlvbnMgZmlsZVxuICogaXMgbG9hZGVkLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIFJlYWN0IHRvIGluc3RydWN0aW9ucyBiZWluZyBhcHBsaWVkXG4gKiAtIExvZyB3aGljaCBpbnN0cnVjdGlvbiBmaWxlcyBhcmUgYWN0aXZlXG4gKiAtIE9ic2VydmUgdGhlIGluc3RydWN0aW9uIGxvYWRpbmcgaGllcmFyY2h5XG4gKlxuICogKipNYXRjaGVyKio6IE5vIG1hdGNoZXIgc3VwcG9ydCAtIGZpcmVzIG9uIGFsbCBpbnN0cnVjdGlvbiBsb2FkIGV2ZW50c1xuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IGluc3RydWN0aW9uc0xvYWRlZEhvb2ssIGluc3RydWN0aW9uc0xvYWRlZE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgaW5zdHJ1Y3Rpb25zTG9hZGVkSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdJbnN0cnVjdGlvbnMgbG9hZGVkJywgeyBmaWxlOiBpbnB1dC5maWxlX3BhdGgsIHR5cGU6IGlucHV0Lm1lbW9yeV90eXBlIH0pO1xuICogICByZXR1cm4gaW5zdHJ1Y3Rpb25zTG9hZGVkT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjaW5zdHJ1Y3Rpb25zbG9hZGVkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpbnN0cnVjdGlvbnNMb2FkZWRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJJbnN0cnVjdGlvbnNMb2FkZWRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFdvcmt0cmVlQ3JlYXRlIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgV29ya3RyZWVDcmVhdGUgaG9vayBoYW5kbGVyLlxuICpcbiAqIFdvcmt0cmVlQ3JlYXRlIGhvb2tzIGZpcmUgd2hlbiBhIGdpdCB3b3JrdHJlZSBpcyBjcmVhdGVkLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIFNldCB1cCB3b3JrdHJlZS1zcGVjaWZpYyBjb25maWd1cmF0aW9uXG4gKiAtIExvZyB3b3JrdHJlZSBjcmVhdGlvbiBldmVudHNcbiAqIC0gSW5pdGlhbGl6ZSB3b3JrdHJlZSByZXNvdXJjZXNcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHdvcmt0cmVlIGNyZWF0aW9uIGV2ZW50c1xuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHdvcmt0cmVlQ3JlYXRlSG9vaywgd29ya3RyZWVDcmVhdGVPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIGV4cG9ydCBkZWZhdWx0IHdvcmt0cmVlQ3JlYXRlSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGNvbnN0IHdvcmt0cmVlUGF0aCA9IGAke2lucHV0LmN3ZH0vLndvcmt0cmVlcy8ke2lucHV0Lm5hbWV9YDtcbiAqICAgbG9nZ2VyLmluZm8oJ1dvcmt0cmVlIGNyZWF0ZWQnLCB7IG5hbWU6IGlucHV0Lm5hbWUsIHdvcmt0cmVlUGF0aCB9KTtcbiAqICAgLy8gV29ya3RyZWVDcmVhdGUgaXMgYSBjb21tYW5kIGhvb2s6IHRoZSBwYXRoIGlzIHdyaXR0ZW4gdG8gc3Rkb3V0IGFzIHBsYWluIHRleHQuXG4gKiAgIHJldHVybiB3b3JrdHJlZUNyZWF0ZU91dHB1dCh7IHdvcmt0cmVlUGF0aCB9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3Mjd29ya3RyZWVjcmVhdGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHdvcmt0cmVlQ3JlYXRlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiV29ya3RyZWVDcmVhdGVcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFdvcmt0cmVlUmVtb3ZlIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgV29ya3RyZWVSZW1vdmUgaG9vayBoYW5kbGVyLlxuICpcbiAqIFdvcmt0cmVlUmVtb3ZlIGhvb2tzIGZpcmUgd2hlbiBhIGdpdCB3b3JrdHJlZSBpcyByZW1vdmVkLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIENsZWFuIHVwIHdvcmt0cmVlLXNwZWNpZmljIHJlc291cmNlc1xuICogLSBMb2cgd29ya3RyZWUgcmVtb3ZhbCBldmVudHNcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHdvcmt0cmVlIHJlbW92YWwgZXZlbnRzXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgd29ya3RyZWVSZW1vdmVIb29rLCB3b3JrdHJlZVJlbW92ZU91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgd29ya3RyZWVSZW1vdmVIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ1dvcmt0cmVlIHJlbW92ZWQnLCB7IHBhdGg6IGlucHV0Lndvcmt0cmVlX3BhdGggfSk7XG4gKiAgIHJldHVybiB3b3JrdHJlZVJlbW92ZU91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3dvcmt0cmVlcmVtb3ZlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB3b3JrdHJlZVJlbW92ZUhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIldvcmt0cmVlUmVtb3ZlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBDd2RDaGFuZ2VkIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgQ3dkQ2hhbmdlZCBob29rIGhhbmRsZXIuXG4gKlxuICogQ3dkQ2hhbmdlZCBob29rcyBmaXJlIHdoZW4gQ2xhdWRlIENvZGUncyBjdXJyZW50IHdvcmtpbmcgZGlyZWN0b3J5IGNoYW5nZXMsXG4gKiBhbGxvd2luZyB5b3UgdG86XG4gKiAtIFJlYWN0IHRvIGRpcmVjdG9yeSBjaGFuZ2VzIHdpdGhpbiBhIHNlc3Npb25cbiAqIC0gVXBkYXRlIGZpbGUgd2F0Y2hlcnMgb3IgZW52aXJvbm1lbnQgc3RhdGVcbiAqIC0gUmV0dXJuIGB3YXRjaFBhdGhzYCB2aWEgYGhvb2tTcGVjaWZpY091dHB1dGAgdG8gcmVnaXN0ZXIgcGF0aHMgZm9yIEZpbGVDaGFuZ2VkIGV2ZW50c1xuICpcbiAqICoqTWF0Y2hlcioqOiBObyBtYXRjaGVyIHN1cHBvcnQgLSBmaXJlcyBvbiBhbGwgY3dkIGNoYW5nZSBldmVudHNcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBjd2RDaGFuZ2VkSG9vaywgY3dkQ2hhbmdlZE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgY3dkQ2hhbmdlZEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnV29ya2luZyBkaXJlY3RvcnkgY2hhbmdlZCcsIHsgZnJvbTogaW5wdXQub2xkX2N3ZCwgdG86IGlucHV0Lm5ld19jd2QgfSk7XG4gKiAgIHJldHVybiBjd2RDaGFuZ2VkT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjY3dkY2hhbmdlZFxuICovXG5leHBvcnQgZnVuY3Rpb24gY3dkQ2hhbmdlZEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIkN3ZENoYW5nZWRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEZpbGVDaGFuZ2VkIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgRmlsZUNoYW5nZWQgaG9vayBoYW5kbGVyLlxuICpcbiAqIEZpbGVDaGFuZ2VkIGhvb2tzIGZpcmUgd2hlbiBhIHdhdGNoZWQgZmlsZSBjaGFuZ2VzIG9uIGRpc2ssIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gUmVhY3QgdG8gZmlsZSBzeXN0ZW0gY2hhbmdlcyBkdXJpbmcgYSBzZXNzaW9uXG4gKiAtIEludmFsaWRhdGUgY2FjaGVzIG9yIHJlbG9hZCBjb25maWd1cmF0aW9uXG4gKiAtIFJldHVybiBgd2F0Y2hQYXRoc2AgdmlhIGBob29rU3BlY2lmaWNPdXRwdXRgIHRvIHVwZGF0ZSB0aGUgc2V0IG9mIHdhdGNoZWQgcGF0aHNcbiAqXG4gKiBUaGUgaW5wdXQgYGV2ZW50YCBmaWVsZCBpbmRpY2F0ZXMgdGhlIHR5cGUgb2YgY2hhbmdlOlxuICogLSBgJ2NoYW5nZSdgIC0gRmlsZSBjb250ZW50cyBjaGFuZ2VkXG4gKiAtIGAnYWRkJ2AgLSBGaWxlIHdhcyBjcmVhdGVkXG4gKiAtIGAndW5saW5rJ2AgLSBGaWxlIHdhcyBkZWxldGVkXG4gKlxuICogKipNYXRjaGVyKio6IE5vIG1hdGNoZXIgc3VwcG9ydCAtIGZpcmVzIG9uIGFsbCBmaWxlIGNoYW5nZSBldmVudHNcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBmaWxlQ2hhbmdlZEhvb2ssIGZpbGVDaGFuZ2VkT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiBleHBvcnQgZGVmYXVsdCBmaWxlQ2hhbmdlZEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnRmlsZSBjaGFuZ2VkJywgeyBwYXRoOiBpbnB1dC5maWxlX3BhdGgsIGV2ZW50OiBpbnB1dC5ldmVudCB9KTtcbiAqICAgcmV0dXJuIGZpbGVDaGFuZ2VkT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjZmlsZWNoYW5nZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZpbGVDaGFuZ2VkSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiRmlsZUNoYW5nZWRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIE1lc3NhZ2VEaXNwbGF5IEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgTWVzc2FnZURpc3BsYXkgaG9vayBoYW5kbGVyLlxuICpcbiAqIE1lc3NhZ2VEaXNwbGF5IGhvb2tzIGZpcmUgd2l0aCBlYWNoIGJhdGNoIG9mIG5ld2x5IGNvbXBsZXRlZCBsaW5lcyB3aGlsZSBhblxuICogYXNzaXN0YW50IG1lc3NhZ2Ugc3RyZWFtcy4gRGlzcGxheS1vbmx5OiB0aGUgc3RvcmVkIG1lc3NhZ2UgYW5kIHdoYXQgdGhlIG1vZGVsXG4gKiBzZWVzIGFyZSB1bnRvdWNoZWQuIEFsbG93cyB5b3UgdG86XG4gKiAtIFJlcGxhY2UgdGhlIGRlbHRhIHNob3duIG9uIHNjcmVlbiB3aXRoIGN1c3RvbSBjb250ZW50IHZpYSBgZGlzcGxheUNvbnRlbnRgXG4gKiAtIE9ic2VydmUgYW5kIGxvZyBtZXNzYWdlIHN0cmVhbWluZyBldmVudHNcbiAqXG4gKiBUaGUgaW5wdXQgY2FycmllcyBgdHVybl9pZGAsIGBtZXNzYWdlX2lkYCwgYGluZGV4YCwgYGZpbmFsYCwgYW5kIGBkZWx0YWAgZmllbGRzLlxuICogVGhlIGBmaW5hbGAgZmxhZyBpbmRpY2F0ZXMgdGhlIGxhc3QgZmx1c2ggb2YgYSBtZXNzYWdlIFx1MjAxNCBpdHMgYGRlbHRhYCBpcyBlbXB0eVxuICogd2hlbiB0aGUgbWVzc2FnZSBlbmRzIG9uIGEgbmV3bGluZTsgdHJlYXQgYGZpbmFsYCBhcyB0aGUgZW5kLW9mLW1lc3NhZ2Ugc2lnbmFsLlxuICpcbiAqICoqTWF0Y2hlcioqOiBObyBtYXRjaGVyIHN1cHBvcnQgLSBmaXJlcyBvbiBhbGwgbWVzc2FnZSBkaXNwbGF5IGV2ZW50c1xuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IG1lc3NhZ2VEaXNwbGF5SG9vaywgbWVzc2FnZURpc3BsYXlPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIGV4cG9ydCBkZWZhdWx0IG1lc3NhZ2VEaXNwbGF5SG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGlmIChpbnB1dC5maW5hbCkge1xuICogICAgIGxvZ2dlci5pbmZvKCdNZXNzYWdlIGNvbXBsZXRlJywgeyBtZXNzYWdlSWQ6IGlucHV0Lm1lc3NhZ2VfaWQgfSk7XG4gKiAgIH1cbiAqICAgcmV0dXJuIG1lc3NhZ2VEaXNwbGF5T3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjbWVzc2FnZWRpc3BsYXlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lc3NhZ2VEaXNwbGF5SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiTWVzc2FnZURpc3BsYXlcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbiIsICIvKipcbiAqIExvZ2dlciBzeXN0ZW0gZm9yIENsYXVkZSBDb2RlIGhvb2tzLlxuICpcbiAqIFByb3ZpZGVzIHN0cnVjdHVyZWQgbG9nZ2luZyB3aXRoIGV2ZW50IHN1YnNjcmlwdGlvbiBhbmQgb3B0aW9uYWwgZmlsZSBvdXRwdXQuXG4gKiBUaGUgbG9nZ2VyIGlzICoqc2lsZW50IGJ5IGRlZmF1bHQqKiB0byBhdm9pZCBpbnRlcmZlcmluZyB3aXRoIGhvb2sgcHJvdG9jb2xcbiAqIChzdGRvdXQgaXMgcmVzZXJ2ZWQgZm9yIEpTT04gcmVzcG9uc2VzLCBzdGRlcnIgbWF5IGNvbmZsaWN0IHdpdGggQ2xhdWRlIENvZGUpLlxuICogQG1vZHVsZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IGxvZ2dlciB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gU3Vic2NyaWJlIHRvIGxvZyBldmVudHNcbiAqIGNvbnN0IHVuc3Vic2NyaWJlID0gbG9nZ2VyLm9uKCdlcnJvcicsIChldmVudCkgPT4ge1xuICogICBjb25zb2xlLmVycm9yKGBFcnJvciBpbiAke2V2ZW50Lmhvb2tUeXBlfTogJHtldmVudC5tZXNzYWdlfWApO1xuICogfSk7XG4gKlxuICogLy8gTGF0ZXIsIGNsZWFuIHVwXG4gKiB1bnN1YnNjcmliZSgpO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3NcbiAqL1xuaW1wb3J0IHsgY2xvc2VTeW5jLCBleGlzdHNTeW5jLCBta2RpclN5bmMsIG9wZW5TeW5jLCB3cml0ZVN5bmMgfSBmcm9tIFwibm9kZTpmc1wiO1xuaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gXCJub2RlOnBhdGhcIjtcbi8qKlxuICogQWxsIGxvZyBsZXZlbHMgaW4gb3JkZXIgb2Ygc2V2ZXJpdHkgKGxvd2VzdCB0byBoaWdoZXN0KS5cbiAqL1xuZXhwb3J0IGNvbnN0IExPR19MRVZFTFMgPSBbXCJkZWJ1Z1wiLCBcImluZm9cIiwgXCJ3YXJuXCIsIFwiZXJyb3JcIl07XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBMb2dnZXIgQ2xhc3Ncbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogTG9nZ2VyIGZvciBDbGF1ZGUgQ29kZSBob29rcyB3aXRoIGV2ZW50IHN1YnNjcmlwdGlvbiBhbmQgZmlsZSBvdXRwdXQuXG4gKlxuICogIyMgS2V5IEJlaGF2aW9yc1xuICpcbiAqIHwgQ29uZmlndXJhdGlvbiB8IEJlaGF2aW9yIHxcbiAqIHwtLS0tLS0tLS0tLS0tLXwtLS0tLS0tLS0tfFxuICogfCBObyBjb25maWcgKGRlZmF1bHQpIHwgKipTaWxlbnQqKiAtIG5vIG91dHB1dCBhbnl3aGVyZSB8XG4gKiB8IGBDTEFVREVfQ09ERV9IT09LU19MT0dfRklMRWAgZW52IHZhciB8IEFwcGVuZCBKU09OIGxpbmVzIHRvIGZpbGUgfFxuICogfCBgLm9uKGxldmVsLCBoYW5kbGVyKWAgcmVnaXN0ZXJlZCB8IEV2ZW50cyBkZWxpdmVyZWQgdG8gaGFuZGxlcnMgb25seSB8XG4gKiB8IE11bHRpcGxlIGRlc3RpbmF0aW9ucyB8IEFsbCBkZXN0aW5hdGlvbnMgcmVjZWl2ZSBldmVudHMgfFxuICpcbiAqICMjIEltcG9ydGFudCBOb3Rlc1xuICpcbiAqIC0gKipOZXZlciBvdXRwdXRzIHRvIHN0ZG91dCoqIChyZXNlcnZlZCBmb3IgSlNPTiBob29rIHJlc3BvbnNlKVxuICogLSAqKk5ldmVyIG91dHB1dHMgdG8gc3RkZXJyKiogKG1heSBpbnRlcmZlcmUgd2l0aCBDbGF1ZGUgQ29kZSBlcnJvciBoYW5kbGluZylcbiAqIC0gRmlsZSBvdXRwdXQgdXNlcyBKU09OIExpbmVzIGZvcm1hdCBmb3IgZWFzeSBwYXJzaW5nXG4gKiAtIGAub24obGV2ZWwsIGhhbmRsZXIpYCByZXR1cm5zIGFuIHVuc3Vic2NyaWJlIGZ1bmN0aW9uXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBTdWJzY3JpYmUgdG8gZXZlbnRzIGF0IHNwZWNpZmljIGxldmVsXG4gKiBsb2dnZXIub24oJ3dhcm4nLCAoZXZlbnQpID0+IHtcbiAqICAgc2VuZEFsZXJ0KGV2ZW50Lm1lc3NhZ2UpO1xuICogfSk7XG4gKlxuICogLy8gTG9nIHdpdGhpbiBhIGhvb2sgaGFuZGxlclxuICogZXhwb3J0IGRlZmF1bHQgcHJlVG9vbFVzZUhvb2soeyBtYXRjaGVyOiAnQmFzaCcgfSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci53YXJuKCdBYm91dCB0byB2YWxpZGF0ZSBCYXNoIGNvbW1hbmQnKTtcbiAqICAgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoeyBhbGxvdzogdHJ1ZSB9KTtcbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjbGFzcyBMb2dnZXIge1xuICAgIC8qKlxuICAgICAqIFJlZ2lzdGVyZWQgZXZlbnQgaGFuZGxlcnMgYnkgbG9nIGxldmVsLlxuICAgICAqL1xuICAgIGhhbmRsZXJzID0gbmV3IE1hcCgpO1xuICAgIC8qKlxuICAgICAqIEZpbGUgZGVzY3JpcHRvciBmb3IgbG9nIGZpbGUgb3V0cHV0LlxuICAgICAqIExhemlseSBpbml0aWFsaXplZCBvbiBmaXJzdCB3cml0ZS5cbiAgICAgKi9cbiAgICBsb2dGaWxlRmQgPSBudWxsO1xuICAgIC8qKlxuICAgICAqIFBhdGggdG8gdGhlIGxvZyBmaWxlLCBpZiBjb25maWd1cmVkLlxuICAgICAqL1xuICAgIGxvZ0ZpbGVQYXRoID0gbnVsbDtcbiAgICAvKipcbiAgICAgKiBXaGV0aGVyIGZpbGUgaW5pdGlhbGl6YXRpb24gaGFzIGJlZW4gYXR0ZW1wdGVkLlxuICAgICAqL1xuICAgIGZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIC8qKlxuICAgICAqIEN1cnJlbnQgaG9vayBjb250ZXh0IGZvciBlbnJpY2hpbmcgbG9nIGV2ZW50cy5cbiAgICAgKi9cbiAgICBjdXJyZW50SG9va1R5cGU7XG4gICAgLyoqXG4gICAgICogQ3VycmVudCBob29rIGlucHV0IGZvciBlbnJpY2hpbmcgbG9nIGV2ZW50cy5cbiAgICAgKi9cbiAgICBjdXJyZW50SW5wdXQ7XG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhIG5ldyBMb2dnZXIgaW5zdGFuY2UuXG4gICAgICpcbiAgICAgKiBUeXBpY2FsbHkgeW91IHNob3VsZCB1c2UgdGhlIGV4cG9ydGVkIGBsb2dnZXJgIHNpbmdsZXRvbiByYXRoZXIgdGhhblxuICAgICAqIGNyZWF0aW5nIG5ldyBpbnN0YW5jZXMuXG4gICAgICogQHBhcmFtIGNvbmZpZyAtIE9wdGlvbmFsIGNvbmZpZ3VyYXRpb25cbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGBgYHR5cGVzY3JpcHRcbiAgICAgKiAvLyBVc2Ugc2luZ2xldG9uIChyZWNvbW1lbmRlZClcbiAgICAgKiBpbXBvcnQgeyBsb2dnZXIgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICAgICAqXG4gICAgICogLy8gT3IgY3JlYXRlIGN1c3RvbSBpbnN0YW5jZVxuICAgICAqIGNvbnN0IGN1c3RvbUxvZ2dlciA9IG5ldyBMb2dnZXIoeyBsb2dGaWxlUGF0aDogJy92YXIvbG9nL2hvb2tzLmxvZycgfSk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgY29uc3RydWN0b3IoY29uZmlnID0ge30pIHtcbiAgICAgICAgLy8gSW5pdGlhbGl6ZSBoYW5kbGVycyBtYXAgZm9yIGVhY2ggbGV2ZWxcbiAgICAgICAgZm9yIChjb25zdCBsZXZlbCBvZiBMT0dfTEVWRUxTKSB7XG4gICAgICAgICAgICB0aGlzLmhhbmRsZXJzLnNldChsZXZlbCwgbmV3IFNldCgpKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBTZXQgbG9nIGZpbGUgcGF0aCBmcm9tIGV4cGxpY2l0IGNvbmZpZywgb3IgYnkgcmVhZGluZyB0aGUgY29uZmlndXJlZCBlbnYgdmFyXG4gICAgICAgIHRoaXMubG9nRmlsZVBhdGggPSBjb25maWcubG9nRmlsZVBhdGggPz8gKGNvbmZpZy5sb2dFbnZWYXIgPyBwcm9jZXNzLmVudltjb25maWcubG9nRW52VmFyXSA6IHVuZGVmaW5lZCkgPz8gbnVsbDtcbiAgICB9XG4gICAgLyoqXG4gICAgICogTG9ncyBhIGRlYnVnIG1lc3NhZ2UuXG4gICAgICpcbiAgICAgKiBVc2UgZm9yIGRldGFpbGVkIGRlYnVnZ2luZyBpbmZvcm1hdGlvbiB0aGF0IGlzIHR5cGljYWxseSBvbmx5IHVzZWZ1bFxuICAgICAqIGR1cmluZyBkZXZlbG9wbWVudCBvciB0cm91Ymxlc2hvb3RpbmcuXG4gICAgICogQHBhcmFtIG1lc3NhZ2UgLSBUaGUgZGVidWcgbWVzc2FnZVxuICAgICAqIEBwYXJhbSBjb250ZXh0IC0gT3B0aW9uYWwgYWRkaXRpb25hbCBjb250ZXh0XG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0eXBlc2NyaXB0XG4gICAgICogbG9nZ2VyLmRlYnVnKCdQcm9jZXNzaW5nIHRvb2wgaW5wdXQnLCB7IHRvb2xOYW1lOiAnQmFzaCcsIGlucHV0U2l6ZTogMjU2IH0pO1xuICAgICAqIGBgYFxuICAgICAqL1xuICAgIGRlYnVnKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZGVidWdcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIExvZ3MgYW4gaW5mbyBtZXNzYWdlLlxuICAgICAqXG4gICAgICogVXNlIGZvciBnZW5lcmFsIG9wZXJhdGlvbmFsIGV2ZW50cyBsaWtlIGhvb2sgaW52b2NhdGlvbnMsIHN1Y2Nlc3NmdWxcbiAgICAgKiBjb21wbGV0aW9ucywgb3Igc3RhdGUgY2hhbmdlcy5cbiAgICAgKiBAcGFyYW0gbWVzc2FnZSAtIFRoZSBpbmZvIG1lc3NhZ2VcbiAgICAgKiBAcGFyYW0gY29udGV4dCAtIE9wdGlvbmFsIGFkZGl0aW9uYWwgY29udGV4dFxuICAgICAqIEBleGFtcGxlXG4gICAgICogYGBgdHlwZXNjcmlwdFxuICAgICAqIGxvZ2dlci5pbmZvKCdTZXNzaW9uIHN0YXJ0ZWQnLCB7IHNvdXJjZTogJ3N0YXJ0dXAnLCBzZXNzaW9uSWQ6ICdhYmMxMjMnIH0pO1xuICAgICAqIGBgYFxuICAgICAqL1xuICAgIGluZm8obWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJpbmZvXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBMb2dzIGEgd2FybmluZyBtZXNzYWdlLlxuICAgICAqXG4gICAgICogVXNlIGZvciBjb25kaXRpb25zIHRoYXQgbWF5IGluZGljYXRlIGlzc3VlcyBidXQgZG9uJ3QgcHJldmVudFxuICAgICAqIG9wZXJhdGlvbiwgc3VjaCBhcyBkZXByZWNhdGVkIHBhdHRlcm5zIG9yIHBlcmZvcm1hbmNlIGNvbmNlcm5zLlxuICAgICAqIEBwYXJhbSBtZXNzYWdlIC0gVGhlIHdhcm5pbmcgbWVzc2FnZVxuICAgICAqIEBwYXJhbSBjb250ZXh0IC0gT3B0aW9uYWwgYWRkaXRpb25hbCBjb250ZXh0XG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0eXBlc2NyaXB0XG4gICAgICogbG9nZ2VyLndhcm4oJ0RlcHJlY2F0ZWQgaG9vayBwYXR0ZXJuIGRldGVjdGVkJywgeyBwYXR0ZXJuOiAnbGVnYWN5TWF0Y2hlcicgfSk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgd2FybihtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcIndhcm5cIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIExvZ3MgYW4gZXJyb3IgbWVzc2FnZS5cbiAgICAgKlxuICAgICAqIFVzZSBmb3IgZXJyb3IgY29uZGl0aW9ucyB0aGF0IHJlcXVpcmUgYXR0ZW50aW9uIGJ1dCB3ZXJlIGhhbmRsZWRcbiAgICAgKiBncmFjZWZ1bGx5LiBGb3IgZXhjZXB0aW9ucywgcHJlZmVyIHtAbGluayBsb2dFcnJvcn0uXG4gICAgICogQHBhcmFtIG1lc3NhZ2UgLSBUaGUgZXJyb3IgbWVzc2FnZVxuICAgICAqIEBwYXJhbSBjb250ZXh0IC0gT3B0aW9uYWwgYWRkaXRpb25hbCBjb250ZXh0XG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0eXBlc2NyaXB0XG4gICAgICogbG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gdmFsaWRhdGUgdG9vbCBpbnB1dCcsIHsgdG9vbE5hbWU6ICdCYXNoJywgcmVhc29uOiAnZW1wdHkgY29tbWFuZCcgfSk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgZXJyb3IobWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJlcnJvclwiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogTG9ncyBhIHN0cnVjdHVyZWQgZXJyb3Igd2l0aCBmdWxsIGVycm9yIGRldGFpbHMuXG4gICAgICpcbiAgICAgKiBVc2UgdGhpcyBtZXRob2Qgd2hlbiBsb2dnaW5nIGNhdWdodCBleGNlcHRpb25zIHRvIGNhcHR1cmUgdGhlIGZ1bGxcbiAgICAgKiBlcnJvciBjb250ZXh0IGluY2x1ZGluZyBuYW1lLCBtZXNzYWdlLCBzdGFjayB0cmFjZSwgYW5kIGNhdXNlIGNoYWluLlxuICAgICAqIEBwYXJhbSBlcnJvciAtIFRoZSBlcnJvciB0byBsb2dcbiAgICAgKiBAcGFyYW0gbWVzc2FnZSAtIEh1bWFuLXJlYWRhYmxlIGRlc2NyaXB0aW9uIG9mIHdoYXQgZmFpbGVkXG4gICAgICogQHBhcmFtIGNvbnRleHQgLSBPcHRpb25hbCBhZGRpdGlvbmFsIGNvbnRleHRcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGBgYHR5cGVzY3JpcHRcbiAgICAgKiB0cnkge1xuICAgICAqICAgYXdhaXQgZGFuZ2Vyb3VzT3BlcmF0aW9uKCk7XG4gICAgICogfSBjYXRjaCAoZXJyKSB7XG4gICAgICogICBsb2dnZXIubG9nRXJyb3IoZXJyLCAnRmFpbGVkIHRvIGV4ZWN1dGUgZGFuZ2Vyb3VzIG9wZXJhdGlvbicsIHtcbiAgICAgKiAgICAgb3BlcmF0aW9uOiAnZGVsZXRlJyxcbiAgICAgKiAgICAgdGFyZ2V0OiAnL2ltcG9ydGFudC9maWxlLnR4dCdcbiAgICAgKiAgIH0pO1xuICAgICAqIH1cbiAgICAgKiBgYGBcbiAgICAgKi9cbiAgICBsb2dFcnJvcihlcnJvciwgbWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICBjb25zdCBlcnJvckluZm8gPSB0aGlzLmV4dHJhY3RFcnJvckluZm8oZXJyb3IpO1xuICAgICAgICBjb25zdCBldmVudCA9IHtcbiAgICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgbGV2ZWw6IFwiZXJyb3JcIixcbiAgICAgICAgICAgIGhvb2tUeXBlOiB0aGlzLmN1cnJlbnRIb29rVHlwZSxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICBpbnB1dDogdGhpcy5jdXJyZW50SW5wdXQsXG4gICAgICAgICAgICBlcnJvcjogZXJyb3JJbmZvLFxuICAgICAgICAgICAgY29udGV4dCxcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5kZWxpdmVyRXZlbnQoZXZlbnQpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBTdWJzY3JpYmVzIGEgaGFuZGxlciB0byBsb2cgZXZlbnRzIGF0IHRoZSBzcGVjaWZpZWQgbGV2ZWwuXG4gICAgICpcbiAgICAgKiBUaGUgaGFuZGxlciB3aWxsIGJlIGNhbGxlZCBmb3IgZXZlcnkgbG9nIGV2ZW50IGF0IHRoZSBzcGVjaWZpZWQgbGV2ZWwuXG4gICAgICogUmV0dXJucyBhbiB1bnN1YnNjcmliZSBmdW5jdGlvbiB0aGF0IHNob3VsZCBiZSBjYWxsZWQgd2hlbiB0aGUgaGFuZGxlclxuICAgICAqIGlzIG5vIGxvbmdlciBuZWVkZWQuXG4gICAgICogQHBhcmFtIGxldmVsIC0gVGhlIGxvZyBsZXZlbCB0byBzdWJzY3JpYmUgdG9cbiAgICAgKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGNhbGwgZm9yIGVhY2ggZXZlbnRcbiAgICAgKiBAcmV0dXJucyBBIGZ1bmN0aW9uIHRvIHVuc3Vic2NyaWJlIHRoZSBoYW5kbGVyXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0eXBlc2NyaXB0XG4gICAgICogLy8gU3Vic2NyaWJlIHRvIGVycm9yIGV2ZW50c1xuICAgICAqIGNvbnN0IHVuc3Vic2NyaWJlID0gbG9nZ2VyLm9uKCdlcnJvcicsIChldmVudCkgPT4ge1xuICAgICAqICAgY29uc29sZS5lcnJvcihgWyR7ZXZlbnQuaG9va1R5cGV9XSAke2V2ZW50Lm1lc3NhZ2V9YCk7XG4gICAgICogICBpZiAoZXZlbnQuZXJyb3IpIHtcbiAgICAgKiAgICAgY29uc29sZS5lcnJvcihldmVudC5lcnJvci5zdGFjayk7XG4gICAgICogICB9XG4gICAgICogfSk7XG4gICAgICpcbiAgICAgKiAvLyBMYXRlciwgY2xlYW4gdXBcbiAgICAgKiB1bnN1YnNjcmliZSgpO1xuICAgICAqIGBgYFxuICAgICAqIEBleGFtcGxlXG4gICAgICogYGBgdHlwZXNjcmlwdFxuICAgICAqIC8vIEZvcndhcmQgdG8gZXh0ZXJuYWwgbG9nZ2luZyBsaWJyYXJ5XG4gICAgICogaW1wb3J0IHBpbm8gZnJvbSAncGlubyc7XG4gICAgICogY29uc3QgcGlub0xvZ2dlciA9IHBpbm8oKTtcbiAgICAgKlxuICAgICAqIGxvZ2dlci5vbignaW5mbycsIChldmVudCkgPT4gcGlub0xvZ2dlci5pbmZvKGV2ZW50LCBldmVudC5tZXNzYWdlKSk7XG4gICAgICogbG9nZ2VyLm9uKCd3YXJuJywgKGV2ZW50KSA9PiBwaW5vTG9nZ2VyLndhcm4oZXZlbnQsIGV2ZW50Lm1lc3NhZ2UpKTtcbiAgICAgKiBsb2dnZXIub24oJ2Vycm9yJywgKGV2ZW50KSA9PiBwaW5vTG9nZ2VyLmVycm9yKGV2ZW50LCBldmVudC5tZXNzYWdlKSk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgb24obGV2ZWwsIGhhbmRsZXIpIHtcbiAgICAgICAgY29uc3QgbGV2ZWxIYW5kbGVycyA9IHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKTtcbiAgICAgICAgaWYgKGxldmVsSGFuZGxlcnMpIHtcbiAgICAgICAgICAgIGxldmVsSGFuZGxlcnMuYWRkKGhhbmRsZXIpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgICAgICBsZXZlbEhhbmRsZXJzPy5kZWxldGUoaGFuZGxlcik7XG4gICAgICAgIH07XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFNldHMgdGhlIGN1cnJlbnQgaG9vayBjb250ZXh0IGZvciBlbnJpY2hpbmcgbG9nIGV2ZW50cy5cbiAgICAgKlxuICAgICAqIFRoaXMgaXMgY2FsbGVkIGludGVybmFsbHkgYnkgdGhlIHJ1bnRpbWUgYmVmb3JlIGludm9raW5nIGhvb2sgaGFuZGxlcnMuXG4gICAgICogWW91IHR5cGljYWxseSBkb24ndCBuZWVkIHRvIGNhbGwgdGhpcyBkaXJlY3RseS5cbiAgICAgKiBAcGFyYW0gaG9va1R5cGUgLSBUaGUgdHlwZSBvZiBob29rIGJlaW5nIGV4ZWN1dGVkXG4gICAgICogQHBhcmFtIGlucHV0IC0gVGhlIGhvb2sgaW5wdXQgZGF0YVxuICAgICAqIEBpbnRlcm5hbFxuICAgICAqL1xuICAgIHNldENvbnRleHQoaG9va1R5cGUsIGlucHV0KSB7XG4gICAgICAgIHRoaXMuY3VycmVudEhvb2tUeXBlID0gaG9va1R5cGU7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gaW5wdXQ7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENsZWFycyB0aGUgY3VycmVudCBob29rIGNvbnRleHQuXG4gICAgICpcbiAgICAgKiBDYWxsZWQgaW50ZXJuYWxseSBieSB0aGUgcnVudGltZSBhZnRlciBob29rIGV4ZWN1dGlvbiBjb21wbGV0ZXMuXG4gICAgICogQGludGVybmFsXG4gICAgICovXG4gICAgY2xlYXJDb250ZXh0KCkge1xuICAgICAgICB0aGlzLmN1cnJlbnRIb29rVHlwZSA9IHVuZGVmaW5lZDtcbiAgICAgICAgdGhpcy5jdXJyZW50SW5wdXQgPSB1bmRlZmluZWQ7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENvbmZpZ3VyZXMgdGhlIGxvZyBmaWxlIHBhdGggYXQgcnVudGltZS5cbiAgICAgKlxuICAgICAqIENhbGwgdGhpcyB0byBlbmFibGUgb3IgY2hhbmdlIGZpbGUgbG9nZ2luZy4gU2V0dGluZyB0byBgbnVsbGAgZGlzYWJsZXNcbiAgICAgKiBmaWxlIGxvZ2dpbmcgKGJ1dCBkb2Vzbid0IGNsb3NlIGV4aXN0aW5nIGZpbGUgaGFuZGxlIGltbWVkaWF0ZWx5KS5cbiAgICAgKiBAcGFyYW0gZmlsZVBhdGggLSBQYXRoIHRvIHRoZSBsb2cgZmlsZSwgb3IgbnVsbCB0byBkaXNhYmxlXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0eXBlc2NyaXB0XG4gICAgICogLy8gRW5hYmxlIGZpbGUgbG9nZ2luZyBhdCBydW50aW1lXG4gICAgICogbG9nZ2VyLnNldExvZ0ZpbGUoJy92YXIvbG9nL2NsYXVkZS1ob29rcy5sb2cnKTtcbiAgICAgKlxuICAgICAqIC8vIERpc2FibGUgZmlsZSBsb2dnaW5nXG4gICAgICogbG9nZ2VyLnNldExvZ0ZpbGUobnVsbCk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgc2V0TG9nRmlsZShmaWxlUGF0aCkge1xuICAgICAgICAvLyBDbG9zZSBleGlzdGluZyBmaWxlIGlmIG9wZW5cbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZUZkICE9PSBudWxsKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNsb3NlU3luYyh0aGlzLmxvZ0ZpbGVGZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXRjaCAoY2xvc2VFcnJvcikge1xuICAgICAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGBbY2xhdWRlLWNvZGUtaG9va3NdIEZhaWxlZCB0byBjbG9zZSBsb2cgZmlsZTogJHtTdHJpbmcoY2xvc2VFcnJvcil9XFxuYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLmxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5sb2dGaWxlUGF0aCA9IGZpbGVQYXRoO1xuICAgICAgICB0aGlzLmZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBDbG9zZXMgYWxsIHJlc291cmNlcyBoZWxkIGJ5IHRoZSBsb2dnZXIuXG4gICAgICpcbiAgICAgKiBDYWxsIHRoaXMgZHVyaW5nIGdyYWNlZnVsIHNodXRkb3duIHRvIGVuc3VyZSBhbGwgbG9nIGRhdGEgaXMgZmx1c2hlZC5cbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGBgYHR5cGVzY3JpcHRcbiAgICAgKiBwcm9jZXNzLm9uKCdleGl0JywgKCkgPT4ge1xuICAgICAqICAgbG9nZ2VyLmNsb3NlKCk7XG4gICAgICogfSk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgY2xvc2UoKSB7XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjbG9zZVN5bmModGhpcy5sb2dGaWxlRmQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2F0Y2ggKGNsb3NlRXJyb3IpIHtcbiAgICAgICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgW2NsYXVkZS1jb2RlLWhvb2tzXSBGYWlsZWQgdG8gY2xvc2UgbG9nIGZpbGU6ICR7U3RyaW5nKGNsb3NlRXJyb3IpfVxcbmApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5sb2dGaWxlRmQgPSBudWxsO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuZmlsZUluaXRpYWxpemVkID0gZmFsc2U7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENoZWNrcyBpZiB0aGVyZSBhcmUgYW55IGFjdGl2ZSBoYW5kbGVycyBvciBkZXN0aW5hdGlvbnMuXG4gICAgICpcbiAgICAgKiBSZXR1cm5zIHRydWUgaWYgYW55IGhhbmRsZXJzIGFyZSByZWdpc3RlcmVkIG9yIGZpbGUgbG9nZ2luZyBpcyBlbmFibGVkLlxuICAgICAqIEByZXR1cm5zIFdoZXRoZXIgdGhlIGxvZ2dlciBoYXMgYW55IGFjdGl2ZSBvdXRwdXQgZGVzdGluYXRpb25zXG4gICAgICovXG4gICAgaGFzRGVzdGluYXRpb25zKCkge1xuICAgICAgICBmb3IgKGNvbnN0IGhhbmRsZXJzIG9mIHRoaXMuaGFuZGxlcnMudmFsdWVzKCkpIHtcbiAgICAgICAgICAgIGlmIChoYW5kbGVycy5zaXplID4gMClcbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5sb2dGaWxlUGF0aCAhPT0gbnVsbDtcbiAgICB9XG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFByaXZhdGUgTWV0aG9kc1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvKipcbiAgICAgKiBFbWl0cyBhIGxvZyBldmVudC5cbiAgICAgKiBAcGFyYW0gbGV2ZWwgLSBUaGUgc2V2ZXJpdHkgbGV2ZWwgb2YgdGhlIGV2ZW50XG4gICAgICogQHBhcmFtIG1lc3NhZ2UgLSBUaGUgbG9nIG1lc3NhZ2VcbiAgICAgKiBAcGFyYW0gY29udGV4dCAtIE9wdGlvbmFsIGFkZGl0aW9uYWwgY29udGV4dCBkYXRhXG4gICAgICovXG4gICAgZW1pdChsZXZlbCwgbWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICBjb25zdCBldmVudCA9IHtcbiAgICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgbGV2ZWwsXG4gICAgICAgICAgICBob29rVHlwZTogdGhpcy5jdXJyZW50SG9va1R5cGUsXG4gICAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgICAgaW5wdXQ6IHRoaXMuY3VycmVudElucHV0LFxuICAgICAgICAgICAgY29udGV4dCxcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5kZWxpdmVyRXZlbnQoZXZlbnQpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBEZWxpdmVycyBhbiBldmVudCB0byBhbGwgcmVnaXN0ZXJlZCBkZXN0aW5hdGlvbnMuXG4gICAgICogQHBhcmFtIGV2ZW50IC0gVGhlIGxvZyBldmVudCB0byBkZWxpdmVyXG4gICAgICovXG4gICAgZGVsaXZlckV2ZW50KGV2ZW50KSB7XG4gICAgICAgIC8vIERlbGl2ZXIgdG8gZXZlbnQgaGFuZGxlcnNcbiAgICAgICAgY29uc3QgbGV2ZWxIYW5kbGVycyA9IHRoaXMuaGFuZGxlcnMuZ2V0KGV2ZW50LmxldmVsKTtcbiAgICAgICAgaWYgKGxldmVsSGFuZGxlcnMpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgaGFuZGxlciBvZiBsZXZlbEhhbmRsZXJzKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgaGFuZGxlcihldmVudCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNhdGNoIChoYW5kbGVyRXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYFtjbGF1ZGUtY29kZS1ob29rc10gTG9nIGhhbmRsZXIgZXJyb3I6ICR7U3RyaW5nKGhhbmRsZXJFcnJvcil9XFxuYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIC8vIFdyaXRlIHRvIGZpbGUgaWYgY29uZmlndXJlZFxuICAgICAgICB0aGlzLndyaXRlVG9GaWxlKGV2ZW50KTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogV3JpdGVzIGFuIGV2ZW50IHRvIHRoZSBsb2cgZmlsZS5cbiAgICAgKiBAcGFyYW0gZXZlbnQgLSBUaGUgbG9nIGV2ZW50IHRvIHdyaXRlXG4gICAgICovXG4gICAgd3JpdGVUb0ZpbGUoZXZlbnQpIHtcbiAgICAgICAgaWYgKCF0aGlzLmxvZ0ZpbGVQYXRoKVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAvLyBMYXp5IGluaXRpYWxpemF0aW9uIG9mIGZpbGUgaGFuZGxlXG4gICAgICAgIGlmICghdGhpcy5maWxlSW5pdGlhbGl6ZWQpIHtcbiAgICAgICAgICAgIHRoaXMuaW5pdGlhbGl6ZUZpbGUoKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5sb2dGaWxlRmQgPT09IG51bGwpXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBsaW5lID0gYCR7SlNPTi5zdHJpbmdpZnkoZXZlbnQpfVxcbmA7XG4gICAgICAgICAgICB3cml0ZVN5bmModGhpcy5sb2dGaWxlRmQsIGxpbmUpO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoICh3cml0ZUVycm9yKSB7XG4gICAgICAgICAgICAvLyBEaXNhYmxlIGZpbGUgbG9nZ2luZyBhZnRlciBhIHdyaXRlIGZhaWx1cmUgdG8gYXZvaWQgcmVwZWF0ZWQgZXJyb3JzXG4gICAgICAgICAgICB0aGlzLmxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgICAgICAgICB0aGlzLmZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgICAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYFtjbGF1ZGUtY29kZS1ob29rc10gTG9nIGZpbGUgd3JpdGUgZmFpbGVkOiAke1N0cmluZyh3cml0ZUVycm9yKX1cXG5gKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBJbml0aWFsaXplcyB0aGUgbG9nIGZpbGUgZm9yIHdyaXRpbmcuXG4gICAgICovXG4gICAgaW5pdGlhbGl6ZUZpbGUoKSB7XG4gICAgICAgIHRoaXMuZmlsZUluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICAgICAgaWYgKCF0aGlzLmxvZ0ZpbGVQYXRoKVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgLy8gRW5zdXJlIGRpcmVjdG9yeSBleGlzdHNcbiAgICAgICAgICAgIGNvbnN0IGRpciA9IGRpcm5hbWUodGhpcy5sb2dGaWxlUGF0aCk7XG4gICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmMoZGlyKSkge1xuICAgICAgICAgICAgICAgIG1rZGlyU3luYyhkaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gT3BlbiBmaWxlIGZvciBhcHBlbmRpbmdcbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gb3BlblN5bmModGhpcy5sb2dGaWxlUGF0aCwgXCJhXCIpO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoIHtcbiAgICAgICAgICAgIC8vIFNpbGVudGx5IGlnbm9yZSBmaWxlIGluaXRpYWxpemF0aW9uIGVycm9yc1xuICAgICAgICAgICAgdGhpcy5sb2dGaWxlRmQgPSBudWxsO1xuICAgICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEV4dHJhY3RzIHN0cnVjdHVyZWQgZXJyb3IgaW5mb3JtYXRpb24gZnJvbSBhbiB1bmtub3duIGVycm9yLlxuICAgICAqIEBwYXJhbSBlcnJvciAtIFRoZSBlcnJvciB0byBleHRyYWN0IGluZm9ybWF0aW9uIGZyb21cbiAgICAgKiBAcmV0dXJucyBTdHJ1Y3R1cmVkIGVycm9yIGluZm9ybWF0aW9uXG4gICAgICovXG4gICAgZXh0cmFjdEVycm9ySW5mbyhlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICAgICAgY29uc3QgaW5mbyA9IHtcbiAgICAgICAgICAgICAgICBuYW1lOiBlcnJvci5uYW1lLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UsXG4gICAgICAgICAgICAgICAgc3RhY2s6IGVycm9yLnN0YWNrLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIC8vIEV4dHJhY3QgY2F1c2UgY2hhaW4gaWYgcHJlc2VudFxuICAgICAgICAgICAgaWYgKGVycm9yLmNhdXNlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICBpbmZvLmNhdXNlID0gdGhpcy5leHRyYWN0RXJyb3JJbmZvKGVycm9yLmNhdXNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBpbmZvO1xuICAgICAgICB9XG4gICAgICAgIC8vIEhhbmRsZSBub24tRXJyb3IgdmFsdWVzXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBuYW1lOiBcIlVua25vd25FcnJvclwiLFxuICAgICAgICAgICAgbWVzc2FnZTogU3RyaW5nKGVycm9yKSxcbiAgICAgICAgfTtcbiAgICB9XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTaW5nbGV0b24gRXhwb3J0XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIEdsb2JhbCBsb2dnZXIgaW5zdGFuY2UgZm9yIENsYXVkZSBDb2RlIGhvb2tzLlxuICpcbiAqIFVzZSB0aGlzIHNpbmdsZXRvbiBmb3IgYWxsIGxvZ2dpbmcgd2l0aGluIGhvb2tzLiBUaGUgbG9nZ2VyIGlzIGNvbmZpZ3VyZWRcbiAqIHZpYSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgYW5kIHN1cHBvcnRzIGV2ZW50IHN1YnNjcmlwdGlvbiBmb3IgY3VzdG9tXG4gKiBkZXN0aW5hdGlvbnMuXG4gKlxuICogIyMgQ29uZmlndXJhdGlvblxuICpcbiAqIHwgRW52aXJvbm1lbnQgVmFyaWFibGUgfCBEZXNjcmlwdGlvbiB8XG4gKiB8LS0tLS0tLS0tLS0tLS0tLS0tLS0tfC0tLS0tLS0tLS0tLS18XG4gKiB8IGBDTEFVREVfQ09ERV9IT09LU19MT0dfRklMRWAgfCBQYXRoIHRvIGxvZyBmaWxlIChKU09OIExpbmVzIGZvcm1hdCkgfFxuICpcbiAqICMjIFVzYWdlIGluIEhvb2tzXG4gKlxuICogVGhlIGxvZ2dlciBpcyBwYXNzZWQgdG8gaG9vayBoYW5kbGVycyB2aWEgY29udGV4dCBmb3IgY29udmVuaWVuY2U6XG4gKlxuICogYGBgdHlwZXNjcmlwdFxuICogZXhwb3J0IGRlZmF1bHQgcHJlVG9vbFVzZUhvb2soeyBtYXRjaGVyOiAnQmFzaCcgfSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci53YXJuKCdWYWxpZGF0aW5nIEJhc2ggY29tbWFuZCcpO1xuICogICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7IGFsbG93OiB0cnVlIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqXG4gKiAjIyBFeHRlcm5hbCBJbnRlZ3JhdGlvblxuICpcbiAqIFN1YnNjcmliZSB0byBldmVudHMgdG8gZm9yd2FyZCBsb2dzIHRvIGV4dGVybmFsIHN5c3RlbXM6XG4gKlxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqIGltcG9ydCBwaW5vIGZyb20gJ3Bpbm8nO1xuICpcbiAqIGNvbnN0IHBpbm9Mb2dnZXIgPSBwaW5vKHsgbGV2ZWw6ICdkZWJ1ZycgfSk7XG4gKlxuICogbG9nZ2VyLm9uKCdkZWJ1ZycsIChldmVudCkgPT4gcGlub0xvZ2dlci5kZWJ1ZyhldmVudCwgZXZlbnQubWVzc2FnZSkpO1xuICogbG9nZ2VyLm9uKCdpbmZvJywgKGV2ZW50KSA9PiBwaW5vTG9nZ2VyLmluZm8oZXZlbnQsIGV2ZW50Lm1lc3NhZ2UpKTtcbiAqIGxvZ2dlci5vbignd2FybicsIChldmVudCkgPT4gcGlub0xvZ2dlci53YXJuKGV2ZW50LCBldmVudC5tZXNzYWdlKSk7XG4gKiBsb2dnZXIub24oJ2Vycm9yJywgKGV2ZW50KSA9PiBwaW5vTG9nZ2VyLmVycm9yKGV2ZW50LCBldmVudC5tZXNzYWdlKSk7XG4gKiBgYGBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBEaXJlY3QgdXNhZ2VcbiAqIGltcG9ydCB7IGxvZ2dlciB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogbG9nZ2VyLmluZm8oJ1N0YXJ0aW5nIG9wZXJhdGlvbicpO1xuICogbG9nZ2VyLndhcm4oJ1Jlc291cmNlIGxpbWl0IGFwcHJvYWNoaW5nJywgeyB1c2FnZTogMC45IH0pO1xuICpcbiAqIHRyeSB7XG4gKiAgIGF3YWl0IHJpc2t5T3BlcmF0aW9uKCk7XG4gKiB9IGNhdGNoIChlcnIpIHtcbiAqICAgbG9nZ2VyLmxvZ0Vycm9yKGVyciwgJ1Jpc2t5IG9wZXJhdGlvbiBmYWlsZWQnKTtcbiAqIH1cbiAqIGBgYFxuICovXG4vLyBDTEFVREVfQ09ERV9IT09LU19MT0dfRU5WX1ZBUiBpcyBzZXQgdW5jb25kaXRpb25hbGx5IGJ5IHRoZSAtLWxvZy1lbnYtdmFyIGJhbm5lclxuLy8gYmVmb3JlIHRoaXMgbW9kdWxlIGluaXRpYWxpc2VzLiBJZiBhYnNlbnQsIGZhbGwgYmFjayB0byB0aGUgZGVmYXVsdCBlbnYgdmFyIG5hbWUuXG5leHBvcnQgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcih7XG4gICAgbG9nRW52VmFyOiBwcm9jZXNzLmVudi5DTEFVREVfQ09ERV9IT09LU19MT0dfRU5WX1ZBUiA/PyBcIkNMQVVERV9DT0RFX0hPT0tTX0xPR19GSUxFXCIsXG59KTtcbiIsICIvKipcbiAqIE91dHB1dCB0eXBlcyBhbmQgYnVpbGRlcnMgZm9yIENsYXVkZSBDb2RlIGhvb2tzLlxuICpcbiAqIFByb3ZpZGVzIHR5cGUtc2FmZSBvdXRwdXQgYnVpbGRlciBmdW5jdGlvbnMgZm9yIGFsbCAxMiBob29rIHR5cGVzLiBFYWNoIGJ1aWxkZXJcbiAqIGFjY2VwdHMgb3B0aW9ucyB0aGF0IG1hdGNoIHRoZSB3aXJlIGZvcm1hdCBleHBlY3RlZCBieSBDbGF1ZGUgQ29kZSwgd2l0aCB0eXBlc1xuICogZGVyaXZlZCBmcm9tIHRoZSBDbGF1ZGUgQWdlbnQgU0RLJ3MgYFN5bmNIb29rSlNPTk91dHB1dGAgdHlwZS5cbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rc1xuICogQG1vZHVsZVxuICovXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFeGl0IENvZGUgQ29uc3RhbnRzXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIEV4aXQgY29kZXMgdXNlZCBieSBDbGF1ZGUgQ29kZSBob29rcy5cbiAqXG4gKiB8IEV4aXQgQ29kZSB8IE5hbWUgfCBXaGVuIFVzZWQgfCBDbGF1ZGUgQ29kZSBCZWhhdmlvciB8XG4gKiB8LS0tLS0tLS0tLS18LS0tLS0tfC0tLS0tLS0tLS0tfC0tLS0tLS0tLS0tLS0tLS0tLS0tLXxcbiAqIHwgMCB8IFN1Y2Nlc3MgfCBIYW5kbGVyIHJldHVybnMgbm9ybWFsbHkgfCBDb250aW51ZSwgcGFyc2Ugc3Rkb3V0IGFzIEpTT04gfFxuICogfCAxIHwgRXJyb3IgfCBJbnZhbGlkIGlucHV0LCBub24tYmxvY2tpbmcgZXJyb3IgfCBOb24tYmxvY2tpbmcsIHN0ZGVyciB0byB1c2VyIG9ubHkgfFxuICogfCAyIHwgQmxvY2sgfCBIYW5kbGVyIHRocm93cyBPUiBgc3RvcFJlYXNvbmAgc2V0IHwgQmxvY2tpbmcsIHN0ZGVyciBzaG93biB0byBDbGF1ZGUgfFxuICovXG5leHBvcnQgY29uc3QgRVhJVF9DT0RFUyA9IHtcbiAgICAvKiogSGFuZGxlciBjb21wbGV0ZWQgc3VjY2Vzc2Z1bGx5LiBDbGF1ZGUgQ29kZSBwYXJzZXMgc3Rkb3V0IGFzIEpTT04uICovXG4gICAgU1VDQ0VTUzogMCxcbiAgICAvKiogTm9uLWJsb2NraW5nIGVycm9yIG9jY3VycmVkIChlLmcuLCBpbnZhbGlkIGlucHV0KS4gc3RkZXJyIHNob3duIHRvIHVzZXIgb25seS4gKi9cbiAgICBFUlJPUjogMSxcbiAgICAvKiogSGFuZGxlciB0aHJldyBleGNlcHRpb24gT1IgYmxvY2tpbmcgYWN0aW9uIHJlcXVlc3RlZC4gc3RkZXJyIHNob3duIHRvIENsYXVkZS4gKi9cbiAgICBCTE9DSzogMixcbn07XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBPdXRwdXQgQnVpbGRlciBGYWN0b3JpZXNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogRmFjdG9yeSBmb3IgaG9va3MgdGhhdCBoYXZlIGhvb2tTcGVjaWZpY091dHB1dCB3aXRoIGEgaG9va0V2ZW50TmFtZSBkaXNjcmltaW5hdG9yLlxuICogQHBhcmFtIGhvb2tUeXBlIC0gVGhlIGhvb2sgdHlwZSBuYW1lIHVzZWQgYXMgdGhlIF90eXBlIGRpc2NyaW1pbmF0b3JcbiAqIEByZXR1cm5zIEEgYnVpbGRlciBmdW5jdGlvbiB0aGF0IGNyZWF0ZXMgdGhlIG91dHB1dCBvYmplY3RcbiAqIEBpbnRlcm5hbFxuICovXG5mdW5jdGlvbiBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKGhvb2tUeXBlKSB7XG4gICAgcmV0dXJuIChvcHRpb25zID0ge30pID0+IHtcbiAgICAgICAgY29uc3QgeyBob29rU3BlY2lmaWNPdXRwdXQsIC4uLnJlc3QgfSA9IG9wdGlvbnM7XG4gICAgICAgIGNvbnN0IHN0ZG91dCA9IGhvb2tTcGVjaWZpY091dHB1dCAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgICA/IHsgLi4ucmVzdCwgaG9va1NwZWNpZmljT3V0cHV0OiB7IGhvb2tFdmVudE5hbWU6IGhvb2tUeXBlLCAuLi5ob29rU3BlY2lmaWNPdXRwdXQgfSB9XG4gICAgICAgICAgICA6IHJlc3Q7XG4gICAgICAgIHJldHVybiB7IF90eXBlOiBob29rVHlwZSwgc3Rkb3V0IH07XG4gICAgfTtcbn1cbi8qKlxuICogRmFjdG9yeSBmb3IgaG9va3MgdGhhdCBvbmx5IHVzZSBDb21tb25PcHRpb25zIChzaW1wbGUgcGFzc3Rocm91Z2gpLlxuICogQHBhcmFtIGhvb2tUeXBlIC0gVGhlIGhvb2sgdHlwZSBuYW1lIHVzZWQgYXMgdGhlIF90eXBlIGRpc2NyaW1pbmF0b3JcbiAqIEByZXR1cm5zIEEgYnVpbGRlciBmdW5jdGlvbiB0aGF0IGNyZWF0ZXMgdGhlIG91dHB1dCBvYmplY3RcbiAqIEBpbnRlcm5hbFxuICovXG5mdW5jdGlvbiBjcmVhdGVTaW1wbGVPdXRwdXRCdWlsZGVyKGhvb2tUeXBlKSB7XG4gICAgcmV0dXJuIChvcHRpb25zID0ge30pID0+ICh7XG4gICAgICAgIF90eXBlOiBob29rVHlwZSxcbiAgICAgICAgc3Rkb3V0OiBvcHRpb25zLFxuICAgIH0pO1xufVxuLyoqXG4gKiBGYWN0b3J5IGZvciB3b3JrdHJlZSBob29rcyAoV29ya3RyZWVDcmVhdGUsIFdvcmt0cmVlUmVtb3ZlKS5cbiAqXG4gKiBUaGVzZSBhcmUgY29tbWFuZCBob29rcyB3aG9zZSB3aXJlIHByb3RvY29sIGlzIGEgKipiYXJlIHBhdGggb24gc3Rkb3V0KiosIG5vdCBKU09OOlxuICogQ2xhdWRlIENvZGUgcmVhZHMgdGhlIGhvb2sncyBzdGRvdXQgdmVyYmF0aW0gYW5kIGBjaGRpcmBzIGludG8gaXQuIFRoZSBidWlsZGVyIGNhcnJpZXNcbiAqIHRoZSBwYXRoIGluIGByYXdTdGRvdXRgIHNvIHRoZSBydW50aW1lIGVtaXRzIGl0IGFzIHBsYWluIHRleHQgaW5zdGVhZCBvZlxuICogYEpTT04uc3RyaW5naWZ5KHN0ZG91dClgLlxuICogQHBhcmFtIGhvb2tUeXBlIC0gVGhlIGhvb2sgdHlwZSBuYW1lIHVzZWQgYXMgdGhlIF90eXBlIGRpc2NyaW1pbmF0b3JcbiAqIEByZXR1cm5zIEEgYnVpbGRlciBmdW5jdGlvbiB0aGF0IGNyZWF0ZXMgdGhlIG91dHB1dCBvYmplY3RcbiAqIEBpbnRlcm5hbFxuICovXG5mdW5jdGlvbiBjcmVhdGVXb3JrdHJlZU91dHB1dEJ1aWxkZXIoaG9va1R5cGUpIHtcbiAgICByZXR1cm4gKG9wdGlvbnMpID0+IHtcbiAgICAgICAgY29uc3QgeyB3b3JrdHJlZVBhdGgsIC4uLnJlc3QgfSA9IG9wdGlvbnM7XG4gICAgICAgIHJldHVybiB7IF90eXBlOiBob29rVHlwZSwgc3Rkb3V0OiByZXN0LCByYXdTdGRvdXQ6IHdvcmt0cmVlUGF0aCB9O1xuICAgIH07XG59XG4vKipcbiAqIEZhY3RvcnkgZm9yIGhvb2tzIHRoYXQgdXNlIGRlY2lzaW9uLWJhc2VkIG9wdGlvbnMgKFN0b3AsIFN1YmFnZW50U3RvcCkuXG4gKiBAcGFyYW0gaG9va1R5cGUgLSBUaGUgaG9vayB0eXBlIG5hbWUgdXNlZCBhcyB0aGUgX3R5cGUgZGlzY3JpbWluYXRvclxuICogQHJldHVybnMgQSBidWlsZGVyIGZ1bmN0aW9uIHRoYXQgY3JlYXRlcyB0aGUgb3V0cHV0IG9iamVjdFxuICogQGludGVybmFsXG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZURlY2lzaW9uT3V0cHV0QnVpbGRlcihob29rVHlwZSkge1xuICAgIHJldHVybiAob3B0aW9ucyA9IHt9KSA9PiAoe1xuICAgICAgICBfdHlwZTogaG9va1R5cGUsXG4gICAgICAgIHN0ZG91dDogb3B0aW9ucyxcbiAgICB9KTtcbn1cbi8qKlxuICogRmFjdG9yeSBmb3IgZXhpdC1jb2RlLWJhc2VkIGhvb2tzIChUZWFtbWF0ZUlkbGUsIFRhc2tDb21wbGV0ZWQpLlxuICpcbiAqIFRoZXNlIGhvb2tzIGRvbid0IHVzZSBKU09OIGRlY2lzaW9uIGNvbnRyb2wgKG5vIENvbW1vbk9wdGlvbnMpLlxuICogVGhlIG9ubHkgb3B0aW9uIGlzIGBzdGRlcnJgIFx1MjAxNCB3aGVuIHByZXNlbnQsIGl0IHRyaWdnZXJzIGV4aXQgY29kZSAyIChCTE9DSykuXG4gKiBTdGRvdXQgYWx3YXlzIHJlY2VpdmVzIGB7fWAgKGVtcHR5IEpTT04gb2JqZWN0KS5cbiAqIEBwYXJhbSBob29rVHlwZSAtIFRoZSBob29rIHR5cGUgbmFtZSB1c2VkIGFzIHRoZSBfdHlwZSBkaXNjcmltaW5hdG9yXG4gKiBAcmV0dXJucyBBIGJ1aWxkZXIgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIHRoZSBvdXRwdXQgb2JqZWN0XG4gKiBAaW50ZXJuYWxcbiAqL1xuZnVuY3Rpb24gY3JlYXRlRXhpdENvZGVPdXRwdXRCdWlsZGVyKGhvb2tUeXBlKSB7XG4gICAgcmV0dXJuICh7IHN0ZGVyciB9ID0ge30pID0+ICh7XG4gICAgICAgIF90eXBlOiBob29rVHlwZSxcbiAgICAgICAgc3Rkb3V0OiB7fSxcbiAgICAgICAgLi4uKHN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRlcnIgfSA6IHt9KSxcbiAgICB9KTtcbn1cbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFByZVRvb2xVc2UgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFByZVRvb2xVc2VPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEFsbG93IHRvb2wgZXhlY3V0aW9uXG4gKiBwcmVUb29sVXNlT3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7IHBlcm1pc3Npb25EZWNpc2lvbjogJ2FsbG93JyB9XG4gKiB9KTtcbiAqXG4gKiAvLyBEZW55IHdpdGggcmVhc29uXG4gKiBwcmVUb29sVXNlT3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgcGVybWlzc2lvbkRlY2lzaW9uOiAnZGVueScsXG4gKiAgICAgcGVybWlzc2lvbkRlY2lzaW9uUmVhc29uOiAnRGFuZ2Vyb3VzIGNvbW1hbmQgZGV0ZWN0ZWQnXG4gKiAgIH1cbiAqIH0pO1xuICpcbiAqIC8vIEFsbG93IHdpdGggbW9kaWZpZWQgaW5wdXRcbiAqIHByZVRvb2xVc2VPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICBwZXJtaXNzaW9uRGVjaXNpb246ICdhbGxvdycsXG4gKiAgICAgdXBkYXRlZElucHV0OiB7IGNvbW1hbmQ6ICdscyAtbGEnIH1cbiAqICAgfVxuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHByZVRvb2xVc2VPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIlByZVRvb2xVc2VcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBQb3N0VG9vbFVzZSBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgUG9zdFRvb2xVc2VPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEFkZCBjb250ZXh0IGFmdGVyIGEgZmlsZSByZWFkXG4gKiBwb3N0VG9vbFVzZU91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDoge1xuICogICAgIGFkZGl0aW9uYWxDb250ZXh0OiAnRmlsZSBjb250YWlucyBzZW5zaXRpdmUgZGF0YSdcbiAqICAgfVxuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHBvc3RUb29sVXNlT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJQb3N0VG9vbFVzZVwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFBvc3RUb29sVXNlRmFpbHVyZSBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgUG9zdFRvb2xVc2VGYWlsdXJlT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBwb3N0VG9vbFVzZUZhaWx1cmVPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICBhZGRpdGlvbmFsQ29udGV4dDogJ1RyeSB1c2luZyBhIGRpZmZlcmVudCBhcHByb2FjaCdcbiAqICAgfVxuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHBvc3RUb29sVXNlRmFpbHVyZU91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiUG9zdFRvb2xVc2VGYWlsdXJlXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgUG9zdFRvb2xCYXRjaCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgUG9zdFRvb2xCYXRjaE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogcG9zdFRvb2xCYXRjaE91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDoge1xuICogICAgIGFkZGl0aW9uYWxDb250ZXh0OiAnQWxsIGVkaXRzIGluIHRoZSBiYXRjaCB3ZXJlIGFwcGxpZWQgc3VjY2Vzc2Z1bGx5J1xuICogICB9XG4gKiB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgcG9zdFRvb2xCYXRjaE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiUG9zdFRvb2xCYXRjaFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFVzZXJQcm9tcHRFeHBhbnNpb24gaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFVzZXJQcm9tcHRFeHBhbnNpb25PdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIHVzZXJQcm9tcHRFeHBhbnNpb25PdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICBhZGRpdGlvbmFsQ29udGV4dDogJ1NsYXNoIGNvbW1hbmQgZXhwYW5kZWQgd2l0aCBhZGRpdGlvbmFsIGNvbnRleHQnXG4gKiAgIH1cbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCB1c2VyUHJvbXB0RXhwYW5zaW9uT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJVc2VyUHJvbXB0RXhwYW5zaW9uXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgVXNlclByb21wdFN1Ym1pdCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgVXNlclByb21wdFN1Ym1pdE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogdXNlclByb21wdFN1Ym1pdE91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDoge1xuICogICAgIGFkZGl0aW9uYWxDb250ZXh0OiAnVGhpcyBwcm9qZWN0IHVzZXMgVHlwZVNjcmlwdCBzdHJpY3QgbW9kZSdcbiAqICAgfVxuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHVzZXJQcm9tcHRTdWJtaXRPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIlVzZXJQcm9tcHRTdWJtaXRcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBTZXNzaW9uU3RhcnQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFNlc3Npb25TdGFydE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogc2Vzc2lvblN0YXJ0T3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgYWRkaXRpb25hbENvbnRleHQ6IEpTT04uc3RyaW5naWZ5KHsgcHJvamVjdDogJ215LXByb2plY3QnIH0pXG4gKiAgIH1cbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBzZXNzaW9uU3RhcnRPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIlNlc3Npb25TdGFydFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFNlc3Npb25FbmQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFNlc3Npb25FbmRPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIHNlc3Npb25FbmRPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBzZXNzaW9uRW5kT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZVNpbXBsZU91dHB1dEJ1aWxkZXIoXCJTZXNzaW9uRW5kXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgU3RvcCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgU3RvcE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQWxsb3cgdGhlIHN0b3BcbiAqIHN0b3BPdXRwdXQoeyBkZWNpc2lvbjogJ2FwcHJvdmUnIH0pO1xuICpcbiAqIC8vIEJsb2NrIHdpdGggcmVhc29uXG4gKiBzdG9wT3V0cHV0KHtcbiAqICAgZGVjaXNpb246ICdibG9jaycsXG4gKiAgIHJlYXNvbjogJ1RoZXJlIGFyZSB1bmNvbW1pdHRlZCBjaGFuZ2VzJ1xuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHN0b3BPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlRGVjaXNpb25PdXRwdXRCdWlsZGVyKFwiU3RvcFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFN0b3BGYWlsdXJlIGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBTdG9wRmFpbHVyZU91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogc3RvcEZhaWx1cmVPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBzdG9wRmFpbHVyZU91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVTaW1wbGVPdXRwdXRCdWlsZGVyKFwiU3RvcEZhaWx1cmVcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBTdWJhZ2VudFN0YXJ0IGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBTdWJhZ2VudFN0YXJ0T3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBzdWJhZ2VudFN0YXJ0T3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgYWRkaXRpb25hbENvbnRleHQ6ICdGb2N1cyBvbiBmaW5kaW5nIHBhdHRlcm5zJ1xuICogICB9XG4gKiB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3Qgc3ViYWdlbnRTdGFydE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiU3ViYWdlbnRTdGFydFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFN1YmFnZW50U3RvcCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgU3ViYWdlbnRTdG9wT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBCbG9jayB3aXRoIHJlYXNvblxuICogc3ViYWdlbnRTdG9wT3V0cHV0KHtcbiAqICAgZGVjaXNpb246ICdibG9jaycsXG4gKiAgIHJlYXNvbjogJ1Rhc2sgbm90IGNvbXBsZXRlJ1xuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHN1YmFnZW50U3RvcE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVEZWNpc2lvbk91dHB1dEJ1aWxkZXIoXCJTdWJhZ2VudFN0b3BcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBOb3RpZmljYXRpb24gaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIE5vdGlmaWNhdGlvbk91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQWRkIGNvbnRleHQgYWJvdXQgdGhlIG5vdGlmaWNhdGlvblxuICogbm90aWZpY2F0aW9uT3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgYWRkaXRpb25hbENvbnRleHQ6ICdOb3RpZmljYXRpb24gZm9yd2FyZGVkIHRvIFNsYWNrICNhbGVydHMgY2hhbm5lbCdcbiAqICAgfVxuICogfSk7XG4gKlxuICogLy8gU3VwcHJlc3MgdGhlIG5vdGlmaWNhdGlvblxuICogbm90aWZpY2F0aW9uT3V0cHV0KHsgc3VwcHJlc3NPdXRwdXQ6IHRydWUgfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IG5vdGlmaWNhdGlvbk91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiTm90aWZpY2F0aW9uXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgUHJlQ29tcGFjdCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgUHJlQ29tcGFjdE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogcHJlQ29tcGFjdE91dHB1dCh7XG4gKiAgIHN5c3RlbU1lc3NhZ2U6ICdSZW1lbWJlcjogc3RyaWN0IG1vZGUgaXMgZW5hYmxlZCdcbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBwcmVDb21wYWN0T3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZVNpbXBsZU91dHB1dEJ1aWxkZXIoXCJQcmVDb21wYWN0XCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgUG9zdENvbXBhY3QgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFBvc3RDb21wYWN0T3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBwb3N0Q29tcGFjdE91dHB1dCh7fSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHBvc3RDb21wYWN0T3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZVNpbXBsZU91dHB1dEJ1aWxkZXIoXCJQb3N0Q29tcGFjdFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFBlcm1pc3Npb25SZXF1ZXN0IGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBQZXJtaXNzaW9uUmVxdWVzdE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQXV0by1hcHByb3ZlXG4gKiBwZXJtaXNzaW9uUmVxdWVzdE91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDoge1xuICogICAgIGRlY2lzaW9uOiB7IGJlaGF2aW9yOiAnYWxsb3cnIH1cbiAqICAgfVxuICogfSk7XG4gKlxuICogLy8gQXV0by1hcHByb3ZlIHdpdGggbW9kaWZpZWQgaW5wdXRcbiAqIHBlcm1pc3Npb25SZXF1ZXN0T3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgZGVjaXNpb246IHtcbiAqICAgICAgIGJlaGF2aW9yOiAnYWxsb3cnLFxuICogICAgICAgdXBkYXRlZElucHV0OiB7IGZpbGVfcGF0aDogJy9zYWZlL3BhdGgnIH1cbiAqICAgICB9XG4gKiAgIH1cbiAqIH0pO1xuICpcbiAqIC8vIEF1dG8tZGVueVxuICogcGVybWlzc2lvblJlcXVlc3RPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICBkZWNpc2lvbjoge1xuICogICAgICAgYmVoYXZpb3I6ICdkZW55JyxcbiAqICAgICAgIG1lc3NhZ2U6ICdOb3QgYWxsb3dlZCcsXG4gKiAgICAgICBpbnRlcnJ1cHQ6IHRydWVcbiAqICAgICB9XG4gKiAgIH1cbiAqIH0pO1xuICpcbiAqIC8vIEZhbGwgdGhyb3VnaCB0byBub3JtYWwgcHJvbXB0XG4gKiBwZXJtaXNzaW9uUmVxdWVzdE91dHB1dCh7fSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHBlcm1pc3Npb25SZXF1ZXN0T3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJQZXJtaXNzaW9uUmVxdWVzdFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFBlcm1pc3Npb25EZW5pZWQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFBlcm1pc3Npb25EZW5pZWRPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIExvZyBhbmQgYWxsb3cgcmV0cnlcbiAqIHBlcm1pc3Npb25EZW5pZWRPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHsgcmV0cnk6IHRydWUgfVxuICogfSk7XG4gKlxuICogLy8gTG9nIHdpdGhvdXQgcmV0cnlcbiAqIHBlcm1pc3Npb25EZW5pZWRPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBwZXJtaXNzaW9uRGVuaWVkT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJQZXJtaXNzaW9uRGVuaWVkXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgU2V0dXAgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFNldHVwT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBBZGQgY29udGV4dCBkdXJpbmcgc2V0dXBcbiAqIHNldHVwT3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgYWRkaXRpb25hbENvbnRleHQ6ICdQcm9qZWN0IGluaXRpYWxpemVkIHdpdGggY3VzdG9tIHNldHRpbmdzJ1xuICogICB9XG4gKiB9KTtcbiAqXG4gKiAvLyBTaW1wbGUgcGFzc3Rocm91Z2hcbiAqIHNldHVwT3V0cHV0KHt9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3Qgc2V0dXBPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIlNldHVwXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgVGVhbW1hdGVJZGxlIGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBUZWFtbWF0ZUlkbGVPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEFsbG93IHRlYW1tYXRlIHRvIGdvIGlkbGVcbiAqIHRlYW1tYXRlSWRsZU91dHB1dCh7fSk7XG4gKlxuICogLy8gQmxvY2sgd2l0aCBmZWVkYmFja1xuICogdGVhbW1hdGVJZGxlT3V0cHV0KHsgc3RkZXJyOiAnQ29udGludWUgd29ya2luZzogdW5maW5pc2hlZCB0YXNrcyByZW1haW4uJyB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgdGVhbW1hdGVJZGxlT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUV4aXRDb2RlT3V0cHV0QnVpbGRlcihcIlRlYW1tYXRlSWRsZVwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFRhc2tDcmVhdGVkIGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBUYXNrQ3JlYXRlZE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQWxsb3cgdGFzayBjcmVhdGlvblxuICogdGFza0NyZWF0ZWRPdXRwdXQoe30pO1xuICpcbiAqIC8vIEJsb2NrIHdpdGggZmVlZGJhY2tcbiAqIHRhc2tDcmVhdGVkT3V0cHV0KHsgc3RkZXJyOiAnQ2Fubm90IGNyZWF0ZSB0YXNrOiBtaXNzaW5nIHJlcXVpcmVkIGZpZWxkcy4nIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCB0YXNrQ3JlYXRlZE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVFeGl0Q29kZU91dHB1dEJ1aWxkZXIoXCJUYXNrQ3JlYXRlZFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFRhc2tDb21wbGV0ZWQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFRhc2tDb21wbGV0ZWRPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEFsbG93IHRhc2sgY29tcGxldGlvblxuICogdGFza0NvbXBsZXRlZE91dHB1dCh7fSk7XG4gKlxuICogLy8gQmxvY2sgd2l0aCBmZWVkYmFja1xuICogdGFza0NvbXBsZXRlZE91dHB1dCh7IHN0ZGVycjogJ0Nhbm5vdCBjb21wbGV0ZTogdGVzdHMgYXJlIGZhaWxpbmcuJyB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgdGFza0NvbXBsZXRlZE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVFeGl0Q29kZU91dHB1dEJ1aWxkZXIoXCJUYXNrQ29tcGxldGVkXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgRWxpY2l0YXRpb24gaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBbiBFbGljaXRhdGlvbk91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQWNjZXB0IHRoZSBlbGljaXRhdGlvblxuICogZWxpY2l0YXRpb25PdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHsgYWN0aW9uOiAnYWNjZXB0JywgY29udGVudDogeyB1c2VybmFtZTogJ2FsaWNlJyB9IH1cbiAqIH0pO1xuICpcbiAqIC8vIERlY2xpbmUgdGhlIGVsaWNpdGF0aW9uXG4gKiBlbGljaXRhdGlvbk91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDogeyBhY3Rpb246ICdkZWNsaW5lJyB9XG4gKiB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgZWxpY2l0YXRpb25PdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIkVsaWNpdGF0aW9uXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgRWxpY2l0YXRpb25SZXN1bHQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBbiBFbGljaXRhdGlvblJlc3VsdE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogZWxpY2l0YXRpb25SZXN1bHRPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBlbGljaXRhdGlvblJlc3VsdE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiRWxpY2l0YXRpb25SZXN1bHRcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBDb25maWdDaGFuZ2UgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIENvbmZpZ0NoYW5nZU91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogY29uZmlnQ2hhbmdlT3V0cHV0KHt9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgY29uZmlnQ2hhbmdlT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZVNpbXBsZU91dHB1dEJ1aWxkZXIoXCJDb25maWdDaGFuZ2VcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBJbnN0cnVjdGlvbnNMb2FkZWQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBbiBJbnN0cnVjdGlvbnNMb2FkZWRPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGluc3RydWN0aW9uc0xvYWRlZE91dHB1dCh7fSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IGluc3RydWN0aW9uc0xvYWRlZE91dHB1dCA9IFxuLyogQF9fUFVSRV9fICovIGNyZWF0ZVNpbXBsZU91dHB1dEJ1aWxkZXIoXCJJbnN0cnVjdGlvbnNMb2FkZWRcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBXb3JrdHJlZUNyZWF0ZSBob29rcy5cbiAqXG4gKiBUaGUgcnVudGltZSB3cml0ZXMgYHdvcmt0cmVlUGF0aGAgdG8gc3Rkb3V0IGFzIHBsYWluIHRleHQgKG5vdCBKU09OKSBzbyBDbGF1ZGUgQ29kZVxuICogY2FuIGBjaGRpcmAgaW50byB0aGUgY3JlYXRlZCB3b3JrdHJlZS5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgV29ya3RyZWVDcmVhdGVPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIHdvcmt0cmVlQ3JlYXRlT3V0cHV0KHsgd29ya3RyZWVQYXRoOiAnL2Ficy9wYXRoL3RvL3dvcmt0cmVlJyB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3Qgd29ya3RyZWVDcmVhdGVPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlV29ya3RyZWVPdXRwdXRCdWlsZGVyKFwiV29ya3RyZWVDcmVhdGVcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBXb3JrdHJlZVJlbW92ZSBob29rcy5cbiAqXG4gKiBXaGVuIGB3b3JrdHJlZVBhdGhgIGlzIHN1cHBsaWVkLCB0aGUgcnVudGltZSB3cml0ZXMgaXQgdG8gc3Rkb3V0IGFzIHBsYWluIHRleHQgKG5vdFxuICogSlNPTiksIG1hdGNoaW5nIHRoZSB3b3JrdHJlZSBjb21tYW5kLWhvb2sgcHJvdG9jb2wuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFdvcmt0cmVlUmVtb3ZlT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBQbGFpbi10ZXh0IHBhdGggcHJvdG9jb2xcbiAqIHdvcmt0cmVlUmVtb3ZlT3V0cHV0KHsgd29ya3RyZWVQYXRoOiAnL2Ficy9wYXRoL3RvL3dvcmt0cmVlJyB9KTtcbiAqXG4gKiAvLyBObyBwYXRoIHBheWxvYWRcbiAqIHdvcmt0cmVlUmVtb3ZlT3V0cHV0KHt9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3Qgd29ya3RyZWVSZW1vdmVPdXRwdXQgPSAob3B0aW9ucyA9IHt9KSA9PiB7XG4gICAgY29uc3QgeyB3b3JrdHJlZVBhdGgsIC4uLnJlc3QgfSA9IG9wdGlvbnM7XG4gICAgcmV0dXJuIHdvcmt0cmVlUGF0aCAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8geyBfdHlwZTogXCJXb3JrdHJlZVJlbW92ZVwiLCBzdGRvdXQ6IHJlc3QsIHJhd1N0ZG91dDogd29ya3RyZWVQYXRoIH1cbiAgICAgICAgOiB7IF90eXBlOiBcIldvcmt0cmVlUmVtb3ZlXCIsIHN0ZG91dDogcmVzdCB9O1xufTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIEN3ZENoYW5nZWQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIEN3ZENoYW5nZWRPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIFJldHVybiBhZGRpdGlvbmFsIHBhdGhzIHRvIHdhdGNoIGFmdGVyIHRoZSBjd2QgY2hhbmdlXG4gKiBjd2RDaGFuZ2VkT3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgd2F0Y2hQYXRoczogWycvbmV3L3BhdGgvdG8vd2F0Y2gnXVxuICogICB9XG4gKiB9KTtcbiAqXG4gKiAvLyBTaW1wbGUgcGFzc3Rocm91Z2hcbiAqIGN3ZENoYW5nZWRPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBjd2RDaGFuZ2VkT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJDd2RDaGFuZ2VkXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgRmlsZUNoYW5nZWQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIEZpbGVDaGFuZ2VkT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBVcGRhdGUgdGhlIHNldCBvZiB3YXRjaGVkIHBhdGhzXG4gKiBmaWxlQ2hhbmdlZE91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDoge1xuICogICAgIHdhdGNoUGF0aHM6IFsnL3BhdGgvdG8vd2F0Y2gnLCAnL2Fub3RoZXIvcGF0aCddXG4gKiAgIH1cbiAqIH0pO1xuICpcbiAqIC8vIFNpbXBsZSBwYXNzdGhyb3VnaFxuICogZmlsZUNoYW5nZWRPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBmaWxlQ2hhbmdlZE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiRmlsZUNoYW5nZWRcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBNZXNzYWdlRGlzcGxheSBob29rcy5cbiAqXG4gKiBNZXNzYWdlRGlzcGxheSBpcyBkaXNwbGF5LW9ubHk6IHRoZSBgZGlzcGxheUNvbnRlbnRgIGZpZWxkIHJlcGxhY2VzIHRoZSBkZWx0YSBvblxuICogc2NyZWVuIHdpdGhvdXQgY2hhbmdpbmcgdGhlIHN0b3JlZCBtZXNzYWdlIG9yIHdoYXQgdGhlIG1vZGVsIHNlZXMuIE9taXRcbiAqIGBkaXNwbGF5Q29udGVudGAgKG9yIHNldCBpdCB0byB0aGUgb3JpZ2luYWwgZGVsdGEpIHRvIGxlYXZlIHRoZSBkaXNwbGF5IHVuY2hhbmdlZC5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgTWVzc2FnZURpc3BsYXlPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIFJlcGxhY2UgdGhlIGRlbHRhIHNob3duIG9uIHNjcmVlblxuICogbWVzc2FnZURpc3BsYXlPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHsgZGlzcGxheUNvbnRlbnQ6IFwiW3JlZGFjdGVkXVwiIH1cbiAqIH0pO1xuICpcbiAqIC8vIFBhc3N0aHJvdWdoIChubyBkaXNwbGF5IG1vZGlmaWNhdGlvbilcbiAqIG1lc3NhZ2VEaXNwbGF5T3V0cHV0KHt9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgbWVzc2FnZURpc3BsYXlPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIk1lc3NhZ2VEaXNwbGF5XCIpO1xuIiwgIi8qKlxuICogUnVudGltZSBtb2R1bGUgZm9yIENsYXVkZSBDb2RlIGhvb2tzLlxuICpcbiAqIEhhbmRsZXMgc3RkaW4vc3Rkb3V0L2V4aXQgY29kZSBzZW1hbnRpY3MgZm9yIGNvbXBpbGVkIGhvb2sgZXhlY3V0aW9uLlxuICogVGhpcyBtb2R1bGUgaXMgdGhlIGNvcmUgb3JjaGVzdHJhdG9yIHRoYXQ6XG4gKiAtIFJlYWRzIEpTT04gZnJvbSBzdGRpbiAod2lyZSBmb3JtYXQgd2l0aCBzbmFrZV9jYXNlIHByb3BlcnRpZXMpXG4gKiAtIEludm9rZXMgdGhlIGhvb2sgaGFuZGxlclxuICogLSBXcml0ZXMgb3V0cHV0IHRvIHN0ZG91dFxuICogLSBNYW5hZ2VzIGV4aXQgY29kZXNcbiAqIEBtb2R1bGVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBJbiBhIGNvbXBpbGVkIGhvb2sgZmlsZVxuICogaW1wb3J0IHsgZXhlY3V0ZSB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcy9ydW50aW1lJztcbiAqIGltcG9ydCBteUhvb2sgZnJvbSAnLi9teS1ob29rLmpzJztcbiAqXG4gKiBleGVjdXRlKG15SG9vayk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rc1xuICovXG5pbXBvcnQgeyBwZXJzaXN0RW52VmFyLCBwZXJzaXN0RW52VmFycyB9IGZyb20gXCIuL2Vudi5qc1wiO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSBcIi4vbG9nZ2VyLmpzXCI7XG5pbXBvcnQgeyBFWElUX0NPREVTIH0gZnJvbSBcIi4vb3V0cHV0cy5qc1wiO1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU3RkaW4vU3Rkb3V0IEhhbmRsaW5nXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIFJlYWRzIGFsbCBkYXRhIGZyb20gc3RkaW4uXG4gKiBAcmV0dXJucyBQcm9taXNlIHJlc29sdmluZyB0byB0aGUgY29tcGxldGUgc3RkaW4gY29udGVudFxuICovXG5hc3luYyBmdW5jdGlvbiByZWFkU3RkaW4oKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgY2h1bmtzID0gW107XG4gICAgICAgIC8vIFNldCBlbmNvZGluZyBmaXJzdCB0byBlbnN1cmUgZGF0YSBldmVudHMgcmVjZWl2ZSBzdHJpbmdzXG4gICAgICAgIHByb2Nlc3Muc3RkaW4uc2V0RW5jb2RpbmcoXCJ1dGYtOFwiKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImRhdGFcIiwgKGNodW5rKSA9PiB7XG4gICAgICAgICAgICBjaHVua3MucHVzaChjaHVuayk7XG4gICAgICAgIH0pO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZW5kXCIsICgpID0+IHtcbiAgICAgICAgICAgIHJlc29sdmUoY2h1bmtzLmpvaW4oXCJcIikpO1xuICAgICAgICB9KTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgICAgICAgcmVqZWN0KGVycm9yKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG59XG4vKipcbiAqIFBhcnNlcyBzdGRpbiBKU09OIGlucHV0LlxuICogQHBhcmFtIHN0ZGluQ29udGVudCAtIFJhdyBzdGRpbiBjb250ZW50XG4gKiBAcmV0dXJucyBQYXJzZWQgaW5wdXQgKHdpcmUgZm9ybWF0IHdpdGggc25ha2VfY2FzZSBwcm9wZXJ0aWVzKVxuICogQHRocm93cyBFcnJvciBpZiBKU09OIGlzIG1hbGZvcm1lZFxuICovXG5mdW5jdGlvbiBwYXJzZVN0ZGluSW5wdXQoc3RkaW5Db250ZW50KSB7XG4gICAgLy8gUGFyc2UgSlNPTiAtIGlucHV0IHVzZXMgd2lyZSBmb3JtYXQgKHNuYWtlX2Nhc2UpIGRpcmVjdGx5XG4gICAgY29uc3QgcmF3SW5wdXQgPSBKU09OLnBhcnNlKHN0ZGluQ29udGVudCk7XG4gICAgcmV0dXJuIHJhd0lucHV0O1xufVxuLyoqXG4gKiBXcml0ZXMgaG9vayBvdXRwdXQgdG8gc3Rkb3V0LlxuICpcbiAqIE91dHB1dCB1c2VzIGNhbWVsQ2FzZSBrZXlzIHBlciBDbGF1ZGUgQ29kZSBob29rIHNwZWNpZmljYXRpb24uXG4gKiBAcGFyYW0gb3V0cHV0IC0gVGhlIGhvb2sgb3V0cHV0IHRvIHdyaXRlXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjaG9vay1vdXRwdXQtc3RydWN0dXJlXG4gKi9cbmZ1bmN0aW9uIHdyaXRlU3Rkb3V0KG91dHB1dCkge1xuICAgIC8vIE91dHB1dCB1c2VzIGNhbWVsQ2FzZSAtIG5vIHRyYW5zZm9ybWF0aW9uIG5lZWRlZFxuICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKEpTT04uc3RyaW5naWZ5KG91dHB1dCkpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRXJyb3IgSGFuZGxpbmdcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhbiBlcnJvciBvdXRwdXQgZm9yIG1hbGZvcm1lZCBzdGRpbiBKU09OLlxuICogQHBhcmFtIGVycm9yIC0gVGhlIHBhcnNlIGVycm9yXG4gKiBAcmV0dXJucyBIb29rT3V0cHV0IHdpdGggZW1wdHkgc3Rkb3V0XG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZU1hbGZvcm1lZElucHV0T3V0cHV0KGVycm9yKSB7XG4gICAgbG9nZ2VyLmVycm9yKGBJbnZhbGlkIEpTT04gaW5wdXQ6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApO1xuICAgIHJldHVybiB7IHN0ZG91dDoge30gfTtcbn1cbi8qKlxuICogV3JpdGVzIGhhbmRsZXIgZXJyb3Igc3RhY2t0cmFjZSB0byBzdGRlcnIgYW5kIGV4aXRzIHdpdGggY29kZSAyLlxuICpcbiAqIFdoZW4gYSBob29rIGhhbmRsZXIgdGhyb3dzIGFuIGV4Y2VwdGlvbjpcbiAqIC0gU3RhY2t0cmFjZSAod2l0aCBzb3VyY2VtYXBzIGlmIGF2YWlsYWJsZSkgaXMgb3V0cHV0IHRvIHN0ZGVyclxuICogLSBQcm9jZXNzIGV4aXRzIHdpdGggY29kZSAyIChCTE9DSylcbiAqIC0gTm8gSlNPTiBpcyBvdXRwdXQgdG8gc3Rkb3V0XG4gKiBAcGFyYW0gZXJyb3IgLSBUaGUgZXJyb3IgdGhyb3duIGJ5IHRoZSBoYW5kbGVyXG4gKi9cbmZ1bmN0aW9uIGhhbmRsZUhhbmRsZXJFcnJvcihlcnJvcikge1xuICAgIC8vIFdyaXRlIHN0YWNrIHRyYWNlIHRvIHN0ZGVyciAoc291cmNlbWFwcyBhcmUgYXBwbGllZCBhdXRvbWF0aWNhbGx5IGJ5IE5vZGUuanMpXG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYCR7ZXJyb3Iuc3RhY2sgPz8gZXJyb3IubWVzc2FnZX1cXG5gKTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke1N0cmluZyhlcnJvcil9XFxuYCk7XG4gICAgfVxuICAgIC8vIExvZyB0byBmaWxlIGlmIGNvbmZpZ3VyZWRcbiAgICBsb2dnZXIuZXJyb3IoYEhvb2sgaGFuZGxlciBlcnJvcjogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gICAgLy8gQ2xlYXIgbG9nZ2VyIGNvbnRleHQgYW5kIGNsb3NlXG4gICAgbG9nZ2VyLmNsZWFyQ29udGV4dCgpO1xuICAgIGxvZ2dlci5jbG9zZSgpO1xuICAgIC8vIEV4aXQgd2l0aCBjb2RlIDIgKEJMT0NLKSAtIG5vIEpTT04gb3V0cHV0XG4gICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuQkxPQ0spO1xufVxuLyoqXG4gKiBDb252ZXJ0cyBhIFNwZWNpZmljSG9va091dHB1dCB0byBIb29rT3V0cHV0IGZvciB3aXJlIGZvcm1hdC5cbiAqXG4gKiBTcGVjaWZpY0hvb2tPdXRwdXQgdHlwZXMgaGF2ZTogeyBfdHlwZSwgc3Rkb3V0LCBzdGRlcnI/IH1cbiAqIEhvb2tPdXRwdXQgaGFzOiB7IHN0ZG91dCwgc3RkZXJyPyB9XG4gKlxuICogU2luY2Ugb3V0cHV0IGJ1aWxkZXJzIG5vdyBwcm9kdWNlIHdpcmUtZm9ybWF0IGRpcmVjdGx5LCB0aGlzIGZ1bmN0aW9uXG4gKiBzaW1wbHkgc3RyaXBzIHRoZSBgX3R5cGVgIGRpc2NyaW1pbmF0b3IgZmllbGQuXG4gKiBAcGFyYW0gc3BlY2lmaWNPdXRwdXQgLSBUaGUgc3BlY2lmaWMgb3V0cHV0IGZyb20gYSBob29rIGhhbmRsZXJcbiAqIEByZXR1cm5zIEhvb2tPdXRwdXQgcmVhZHkgZm9yIHNlcmlhbGl6YXRpb25cbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNob29rLW91dHB1dC1zdHJ1Y3R1cmVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCBzcGVjaWZpY091dHB1dCA9IHByZVRvb2xVc2VPdXRwdXQoeyBob29rU3BlY2lmaWNPdXRwdXQ6IHsgcGVybWlzc2lvbkRlY2lzaW9uOiAnYWxsb3cnIH0gfSk7XG4gKiBjb25zdCBob29rT3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChzcGVjaWZpY091dHB1dCk7XG4gKiAvLyBob29rT3V0cHV0OiB7IHN0ZG91dDogeyBob29rU3BlY2lmaWNPdXRwdXQ6IHsgLi4uIH0gfSB9XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbnZlcnRUb0hvb2tPdXRwdXQoc3BlY2lmaWNPdXRwdXQpIHtcbiAgICBjb25zdCB7IHN0ZG91dCwgc3RkZXJyLCByYXdTdGRvdXQgfSA9IHNwZWNpZmljT3V0cHV0O1xuICAgIGNvbnN0IHJlc3VsdCA9IHsgc3Rkb3V0IH07XG4gICAgaWYgKHN0ZGVyciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJlc3VsdC5zdGRlcnIgPSBzdGRlcnI7XG4gICAgfVxuICAgIGlmIChyYXdTdGRvdXQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXN1bHQucmF3U3Rkb3V0ID0gcmF3U3Rkb3V0O1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRXhlY3V0ZSBGdW5jdGlvblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBFeGVjdXRlcyBhIGhvb2sgaGFuZGxlciB3aXRoIGZ1bGwgcnVudGltZSBvcmNoZXN0cmF0aW9uLlxuICpcbiAqIFRoaXMgaXMgdGhlIG1haW4gZW50cnkgcG9pbnQgdGhhdCBjb21waWxlZCBob29rcyB1c2UuIFdoZW4gYSBjb21waWxlZCBob29rXG4gKiBydW5zIGFzIGEgQ0xJOlxuICpcbiAqIDEuIFJlYWRzIGFsbCBzdGRpblxuICogMi4gUGFyc2VzIEpTT04gKHdpcmUgZm9ybWF0IHdpdGggc25ha2VfY2FzZSBwcm9wZXJ0aWVzKVxuICogMy4gU2V0cyB1cCBsb2dnZXIgY29udGV4dCAoaG9va1R5cGUsIGlucHV0KVxuICogNC4gQ2FsbHMgaGFuZGxlciB3aXRoIGlucHV0IGFuZCBjb250ZXh0IChsb2dnZXIpXG4gKiA1LiBIYW5kbGVzIGFueSBlcnJvcnMsIGxvZ3MgdGhlbVxuICogNi4gV3JpdGVzIEpTT04gdG8gc3Rkb3V0XG4gKiA3LiBDbG9zZXMgbG9nZ2VyXG4gKiA4LiBFeGl0cyB3aXRoIGFwcHJvcHJpYXRlIGNvZGVcbiAqIEBwYXJhbSBob29rRm4gLSBUaGUgaG9vayBmdW5jdGlvbiB0byBleGVjdXRlIChmcm9tIGhvb2sgZmFjdG9yeSlcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBJbiBjb21waWxlZCBob29rIGZpbGVcbiAqIGltcG9ydCB7IGV4ZWN1dGUgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MvcnVudGltZSc7XG4gKiBpbXBvcnQgeyBwcmVUb29sVXNlSG9vaywgcHJlVG9vbFVzZU91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogY29uc3QgbXlIb29rID0gcHJlVG9vbFVzZUhvb2soeyBtYXRjaGVyOiAnQmFzaCcgfSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdQcm9jZXNzaW5nIEJhc2ggY29tbWFuZCcpO1xuICogICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7IGFsbG93OiB0cnVlIH0pO1xuICogfSk7XG4gKlxuICogZXhlY3V0ZShteUhvb2spO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3NcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGV4ZWN1dGUoaG9va0ZuKSB7XG4gICAgbGV0IG91dHB1dDtcbiAgICB0cnkge1xuICAgICAgICAvLyBSZWFkIGFuZCBwYXJzZSBzdGRpblxuICAgICAgICBsZXQgc3RkaW5Db250ZW50O1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgc3RkaW5Db250ZW50ID0gYXdhaXQgcmVhZFN0ZGluKCk7XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBsb2dnZXIubG9nRXJyb3IoZXJyb3IsIFwiRmFpbGVkIHRvIHJlYWQgc3RkaW5cIik7XG4gICAgICAgICAgICBvdXRwdXQgPSBjcmVhdGVNYWxmb3JtZWRJbnB1dE91dHB1dChlcnJvcik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgLy8gUGFyc2UgYW5kIHRyYW5zZm9ybSBpbnB1dFxuICAgICAgICBsZXQgaW5wdXQ7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBpbnB1dCA9IHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgbG9nZ2VyLmxvZ0Vycm9yKGVycm9yLCBcIkZhaWxlZCB0byBwYXJzZSBzdGRpbiBKU09OXCIpO1xuICAgICAgICAgICAgb3V0cHV0ID0gY3JlYXRlTWFsZm9ybWVkSW5wdXRPdXRwdXQoZXJyb3IpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIC8vIFNldCBsb2dnZXIgY29udGV4dFxuICAgICAgICBjb25zdCBob29rRXZlbnROYW1lID0gaG9va0ZuLmhvb2tFdmVudE5hbWU7XG4gICAgICAgIGxvZ2dlci5zZXRDb250ZXh0KGhvb2tFdmVudE5hbWUsIGlucHV0KTtcbiAgICAgICAgLy8gQnVpbGQgY29udGV4dCAtIFNlc3Npb25TdGFydCBob29rcyBnZXQgZXh0ZW5kZWQgY29udGV4dCB3aXRoIHBlcnNpc3RFbnZWYXJcbiAgICAgICAgY29uc3QgY29udGV4dCA9IGhvb2tFdmVudE5hbWUgPT09IFwiU2Vzc2lvblN0YXJ0XCIgPyB7IGxvZ2dlciwgcGVyc2lzdEVudlZhciwgcGVyc2lzdEVudlZhcnMgfSA6IHsgbG9nZ2VyIH07XG4gICAgICAgIC8vIEV4ZWN1dGUgaGFuZGxlclxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3Qgc3BlY2lmaWNPdXRwdXQgPSBhd2FpdCBob29rRm4oaW5wdXQsIGNvbnRleHQpO1xuICAgICAgICAgICAgaWYgKHNwZWNpZmljT3V0cHV0ICE9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgb3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChzcGVjaWZpY091dHB1dCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAvLyBIYW5kbGVyIHRocmV3IC0gb3V0cHV0IHN0YWNrdHJhY2UgdG8gc3RkZXJyIGFuZCBleGl0IHdpdGggY29kZSAyXG4gICAgICAgICAgICAvLyBUaGlzIGNhbGwgbmV2ZXIgcmV0dXJucyAocHJvY2Vzcy5leGl0KVxuICAgICAgICAgICAgaGFuZGxlSGFuZGxlckVycm9yKGVycm9yKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBmaW5hbGx5IHtcbiAgICAgICAgLy8gV3JpdGUgb3V0cHV0IGlmIHdlIGhhdmUgaXQuIENvbW1hbmQgaG9va3Mgd2l0aCBhIHBsYWluLXRleHQgcHJvdG9jb2wgKGUuZy5cbiAgICAgICAgLy8gV29ya3RyZWVDcmVhdGUsIHdoZXJlIENsYXVkZSBDb2RlIHJlYWRzIHN0ZG91dCBhcyB0aGUgd29ya3RyZWUgcGF0aCBhbmQgY2hkaXJzXG4gICAgICAgIC8vIGludG8gaXQpIGNhcnJ5IHRoZWlyIHBheWxvYWQgaW4gYHJhd1N0ZG91dGAgYW5kIGJ5cGFzcyBKU09OIHNlcmlhbGl6YXRpb24uXG4gICAgICAgIGlmIChvdXRwdXQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgaWYgKG91dHB1dC5yYXdTdGRvdXQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKG91dHB1dC5yYXdTdGRvdXQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgd3JpdGVTdGRvdXQob3V0cHV0LnN0ZG91dCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgLy8gQ2xlYW4gdXAgbG9nZ2VyIChzaW5nbGUgY2xlYW51cCBwYXRoKVxuICAgICAgICBsb2dnZXIuY2xlYXJDb250ZXh0KCk7XG4gICAgICAgIGxvZ2dlci5jbG9zZSgpO1xuICAgICAgICAvLyBFeGl0LWNvZGUgQkxPQ0s6IHVubGlrZSBoYW5kbGVyIHRocm93IChubyBzdGRvdXQpLCB0aGlzIHBhdGggc3RpbGwgd3JpdGVzXG4gICAgICAgIC8vIHN0cnVjdHVyZWQgSlNPTiB0byBzdGRvdXQgKGFzIGVtcHR5IHt9KSBhbG9uZ3NpZGUgdGhlIHN0ZGVyciBtZXNzYWdlLlxuICAgICAgICAvLyBUaGUgY2FsbGVyIGNvbnRyb2xzIHN0ZGVyciBmb3JtYXR0aW5nIChubyBhcHBlbmRlZCBuZXdsaW5lKS5cbiAgICAgICAgaWYgKG91dHB1dD8uc3RkZXJyICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKG91dHB1dC5zdGRlcnIpO1xuICAgICAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuQkxPQ0spO1xuICAgICAgICB9XG4gICAgICAgIC8vIEV4aXQgd2l0aCBzdWNjZXNzIChoYW5kbGVyIGVycm9ycyBleGl0IHZpYSBoYW5kbGVIYW5kbGVyRXJyb3Igd2l0aCBjb2RlIDIpXG4gICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLlNVQ0NFU1MpO1xuICAgIH1cbn1cbiIsICIvKipcbiAqIFNoYXJlZCBoZWxwZXJzIHVzZWQgYnkgbXVsdGlwbGUgYWdlbnQtaG9va3MgZW50cnkgcG9pbnRzLlxuICpcbiAqIEV4dHJhY3RlZCBmcm9tIHByZS10b29sLXVzZS50cyBzbyB0aGF0IHRoZSB1cGNvbWluZyBTdG9wIGhvb2sgKGFuZCBhbnlcbiAqIGZ1dHVyZSBob29rcykgY2FuIGltcG9ydCBwYXRoIHV0aWxpdGllcywgcmFuZ2UgaGVscGVycywgYW5kIHRoZVxuICogc2FuaXRpemVTZXNzaW9uSWQvZm9ybWF0QW5jaG9yIGZ1bmN0aW9ucyB3aXRob3V0IGRlcGVuZGluZyBvbiB0aGVcbiAqIFByZVRvb2xVc2Utc3BlY2lmaWMgbW9kdWxlLlxuICovXG5cbmltcG9ydCB7IGV4ZWNGaWxlU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG9zIGZyb20gJ25vZGU6b3MnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQYXRoIGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgZnVuY3Rpb24gdG9Qb3NpeChwOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG59XG5cbmZ1bmN0aW9uIGlzQWJzb2x1dGVQb3NpeChwOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHAuc3RhcnRzV2l0aCgnLycpIHx8IC9eW0EtWmEtel06XFwvLy50ZXN0KHApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYWJzcGF0aEFnYWluc3QoYmFzZTogc3RyaW5nLCB0YXJnZXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHQgPSB0b1Bvc2l4KHRhcmdldCk7XG4gIGlmIChpc0Fic29sdXRlUG9zaXgodCkpIHJldHVybiB0O1xuICBjb25zdCBiID0gdG9Qb3NpeChiYXNlKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgcmV0dXJuIGAke2J9LyR7dH1gO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVJlcG9Sb290KGRpcjogc3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbCk6IHN0cmluZyB8IG51bGwge1xuICBpZiAoIWRpcikgcmV0dXJuIG51bGw7XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgZGlyLCAncmV2LXBhcnNlJywgJy0tc2hvdy10b3BsZXZlbCddLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIGVuY29kaW5nOiAndXRmOCdcbiAgICB9KTtcbiAgICBjb25zdCB0cmltbWVkID0gb3V0LnRyaW0oKTtcbiAgICByZXR1cm4gdHJpbW1lZC5sZW5ndGggPiAwID8gdG9Qb3NpeCh0cmltbWVkKSA6IG51bGw7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbi8qKlxuICogUmVwb3J0IHdoZXRoZXIgYSByZXBvLXJlbGF0aXZlIHBhdGggaXMgZXhjbHVkZWQgYnkgZ2l0J3MgaWdub3JlIHJ1bGVzXG4gKiAoLmdpdGlnbm9yZSwgLmdpdC9pbmZvL2V4Y2x1ZGUsIGNvcmUuZXhjbHVkZXNGaWxlKS4gVXNlZCB0byBrZWVwIGlnbm9yZWRcbiAqIGZpbGVzIFx1MjAxNCBidWlsZCBvdXRwdXQsIGNhY2hlcywgbG9ncyBcdTIwMTQgb3V0IG9mIHRvdWNoIHRyYWNraW5nIGVudGlyZWx5LCBzb1xuICogdGhlIHRvdWNoIGhvb2sgbmV2ZXIgcmVwb3J0cyByZWFkcywgd3JpdGVzLCBvciB1bmNvdmVyZWQgd3JpdGVzIG9uIHRoZW0uXG4gKlxuICogYGdpdCBjaGVjay1pZ25vcmUgLXEgPHBhdGg+YCBleGl0cyAwIHdoZW4gdGhlIHBhdGggaXMgaWdub3JlZCwgMSB3aGVuIGl0IGlzXG4gKiBub3QsIGFuZCAxMjggb24gZXJyb3IuIGV4ZWNGaWxlU3luYyB0aHJvd3Mgb24gYW55IG5vbi16ZXJvIGV4aXQsIHNvIGEgY2xlYW5cbiAqIHJldHVybiBtZWFucyBcImlnbm9yZWRcIi4gQSBzdGF0dXMtMSB0aHJvdyBpcyB0aGUgZXhwZWN0ZWQgXCJub3QgaWdub3JlZFwiXG4gKiBzaWduYWw7IGFueSBvdGhlciBmYWlsdXJlIGlzIGFuIHVucmVsaWFibGUgYW5zd2VyLCBzbyB3ZSByZXBvcnQgYGZhbHNlYFxuICogKGRvIG5vdCBkcm9wIHRoZSB0b3VjaCkgcmF0aGVyIHRoYW4gc2lsZW50bHkgaGlkaW5nIGEgdHJhY2tlZCBmaWxlLlxuICovXG4vKipcbiAqIFRoZSBkZWZhdWx0IHNwYW4gcm9vdCBkaXJlY3RvcnksIHJlbGF0aXZlIHRvIHRoZSByZXBvIHJvb3QsIHVzZWQgd2hlbiBub1xuICogZW52aXJvbm1lbnQgdmFyaWFibGUgb3IgZ2l0IGNvbmZpZyBvdmVycmlkZXMgdGhlIGxvY2F0aW9uLlxuICovXG5leHBvcnQgY29uc3QgU1BBTl9ST09UID0gJy5zcGFuJztcblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBzcGFuIHJvb3QgZGlyZWN0b3J5IGZvciBhIGdpdmVuIHJlcG8sIG1pcnJvcmluZyB0aGUgUnVzdCBDTElcbiAqIHByZWNlZGVuY2UgKG1pbnVzIHRoZSAtLXNwYW4tZGlyIENMSSBmbGFnLCB3aGljaCBpcyBpbnZpc2libGUgdG8gZmlsZS13cml0ZVxuICogaG9va3MpOlxuICogICAxLiBHSVRfU1BBTl9ESVIgZW52aXJvbm1lbnQgdmFyaWFibGVcbiAqICAgMi4gYGdpdCBjb25maWcgZ2l0LXNwYW4uZGlyYCBpbiB0aGUgcmVwb1xuICogICAzLiBEZWZhdWx0OiBcIi5zcGFuXCJcbiAqXG4gKiBUaGUgcmV0dXJuZWQgdmFsdWUgaXMgYSBQT1NJWC1zdHlsZSBwYXRoIHdpdGggbm8gdHJhaWxpbmcgc2xhc2guXG4gKiBGYWlsLXNhZmU6IGFueSByZXNvbHV0aW9uIGVycm9yIGZhbGxzIGJhY2sgdG8gXCIuc3BhblwiIHNvIHRoZSBob29rIG5ldmVyXG4gKiBjcmFzaGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBlbnZEaXIgPSBwcm9jZXNzLmVudlsnR0lUX1NQQU5fRElSJ107XG4gIGlmIChlbnZEaXIgJiYgZW52RGlyLnRyaW0oKS5sZW5ndGggPiAwKSB7XG4gICAgcmV0dXJuIHRvUG9zaXgoZW52RGlyLnRyaW0oKSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIH1cbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ2NvbmZpZycsICdnaXQtc3Bhbi5kaXInXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnXG4gICAgfSk7XG4gICAgY29uc3QgdHJpbW1lZCA9IHRvUG9zaXgob3V0LnRyaW0oKSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gICAgaWYgKHRyaW1tZWQubGVuZ3RoID4gMCkgcmV0dXJuIHRyaW1tZWQ7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHZvaWQgZXJyOyAvLyBjb25maWcga2V5IGFic2VudCBvciBnaXQgZXJyb3IgXHUyMDE0IGZhbGwgdGhyb3VnaCB0byBkZWZhdWx0XG4gIH1cbiAgcmV0dXJuIFNQQU5fUk9PVDtcbn1cblxuLyoqXG4gKiBSZXBvcnQgd2hldGhlciBhIHJlcG8tcmVsYXRpdmUgUE9TSVggcGF0aCBmYWxscyBpbnNpZGUgdGhlIGdpdmVuIHNwYW4gcm9vdFxuICogZGlyZWN0b3J5LiBBIHBhdGggaXMgaW5zaWRlIHdoZW4gaXQgZXF1YWxzIHRoZSBzcGFuIHJvb3QgZXhhY3RseSBvciBpc1xuICogbmVzdGVkIGJlbmVhdGggaXQgKGkuZS4gc3RhcnRzIHdpdGggXCI8c3BhblJvb3Q+L1wiKS4gVGhlIFwiL1wiIGJvdW5kYXJ5IHByZXZlbnRzXG4gKiBmYWxzZSBwb3NpdGl2ZXMgZm9yIHNpYmxpbmdzIGxpa2UgXCIuc3BhbnMveFwiIG9yIFwiLnNwYW4tbm90ZXMveFwiLlxuICpcbiAqIFBhc3MgdGhlIHJlc3VsdCBvZiBgcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290KWAgYXMgYHNwYW5Sb290YC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzSW5zaWRlU3BhblJvb3QocmVwb1JlbFBhdGg6IHN0cmluZywgc3BhblJvb3Q6IHN0cmluZyA9IFNQQU5fUk9PVCk6IGJvb2xlYW4ge1xuICBjb25zdCByb290ID0gc3BhblJvb3QucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIHJldHVybiByZXBvUmVsUGF0aCA9PT0gcm9vdCB8fCByZXBvUmVsUGF0aC5zdGFydHNXaXRoKGAke3Jvb3R9L2ApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNHaXRJZ25vcmVkKHJlcG9Sb290OiBzdHJpbmcsIHJlcG9SZWxQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ2NoZWNrLWlnbm9yZScsICctcScsICctLScsIHJlcG9SZWxQYXRoXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ2lnbm9yZScsICdpZ25vcmUnXVxuICAgIH0pO1xuICAgIHJldHVybiB0cnVlO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB2b2lkIGVycjtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290OiBzdHJpbmcsIGFic1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHJvb3QgPSB0b1Bvc2l4KHJlcG9Sb290KTtcbiAgY29uc3QgYWJzID0gdG9Qb3NpeChhYnNQYXRoKTtcbiAgY29uc3QgcHJlZml4ID0gcm9vdC5lbmRzV2l0aCgnLycpID8gcm9vdCA6IGAke3Jvb3R9L2A7XG4gIHJldHVybiBhYnMuc3RhcnRzV2l0aChwcmVmaXgpID8gYWJzLnNsaWNlKHByZWZpeC5sZW5ndGgpIDogYWJzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2Fub25pY2FsaXplUGF0aChhYnNQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICB0cnkge1xuICAgIHJldHVybiB0b1Bvc2l4KGZzLnJlYWxwYXRoU3luYy5uYXRpdmUoYWJzUGF0aCkpO1xuICB9IGNhdGNoIHtcbiAgICAvLyBGaWxlIGRvZXNuJ3QgZXhpc3QgeWV0IChlLmcuIFdyaXRlIHRvIGEgbmV3IGZpbGUpOiBjYW5vbmljYWxpemUgdGhlXG4gICAgLy8gZGlyZWN0b3J5IGFuZCByZWpvaW4gdGhlIGJhc2VuYW1lIHNvIHN5bWxpbmtzIGluIHRoZSBwYXJlbnQgYXJlIHJlc29sdmVkLlxuICAgIHRyeSB7XG4gICAgICBjb25zdCBkaXIgPSB0b1Bvc2l4KGZzLnJlYWxwYXRoU3luYy5uYXRpdmUobm9kZVBhdGguZGlybmFtZShhYnNQYXRoKSkpO1xuICAgICAgcmV0dXJuIGAke2Rpcn0vJHtub2RlUGF0aC5iYXNlbmFtZShhYnNQYXRoKX1gO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gUGFyZW50IGRvZXNuJ3QgZXhpc3QgZWl0aGVyOyBmYWxsIGJhY2sgdG8gdGhlIHVuLWNhbm9uaWNhbGl6ZWQgcGF0aC5cbiAgICAgIHJldHVybiBhYnNQYXRoO1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZGVyaXZlUGF0aCh0b29sSW5wdXQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBjd2Q6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCBmcCA9IHRvb2xJbnB1dC5maWxlX3BhdGg7XG4gIGlmICh0eXBlb2YgZnAgIT09ICdzdHJpbmcnIHx8IGZwLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGFicyA9IGFic3BhdGhBZ2FpbnN0KGN3ZCwgZnApO1xuICByZXR1cm4gY2Fub25pY2FsaXplUGF0aChhYnMpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIExpbmUgcmFuZ2UgdHlwZXMgYW5kIGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIExpbmVSYW5nZSB7XG4gIHN0YXJ0OiBudW1iZXI7XG4gIGVuZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmFuZ2VzSW50ZXJzZWN0KGE6IExpbmVSYW5nZSwgYjogTGluZVJhbmdlKTogYm9vbGVhbiB7XG4gIHJldHVybiBhLnN0YXJ0IDw9IGIuZW5kICYmIGEuZW5kID49IGIuc3RhcnQ7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUG9yY2VsYWluIHJvdyBwYXJzaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBQb3JjZWxhaW5Sb3cge1xuICBuYW1lOiBzdHJpbmc7XG4gIHBhdGg6IHN0cmluZztcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVBvcmNlbGFpbihzdGRvdXQ6IHN0cmluZyk6IFBvcmNlbGFpblJvd1tdIHtcbiAgY29uc3Qgcm93czogUG9yY2VsYWluUm93W10gPSBbXTtcbiAgZm9yIChjb25zdCBsaW5lIG9mIHN0ZG91dC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkKSBjb250aW51ZTtcbiAgICBjb25zdCBwYXJ0cyA9IHRyaW1tZWQuc3BsaXQoJ1xcdCcpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPCAzKSBjb250aW51ZTtcbiAgICBjb25zdCBbbmFtZSwgcGF0aCwgcmFuZ2VdID0gcGFydHM7XG4gICAgY29uc3QgZGFzaElkeCA9IHJhbmdlLmluZGV4T2YoJy0nKTtcbiAgICBpZiAoZGFzaElkeCA9PT0gLTEpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHN0YXJ0ID0gcGFyc2VJbnQocmFuZ2Uuc2xpY2UoMCwgZGFzaElkeCksIDEwKTtcbiAgICBjb25zdCBlbmQgPSBwYXJzZUludChyYW5nZS5zbGljZShkYXNoSWR4ICsgMSksIDEwKTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0KSB8fCBOdW1iZXIuaXNOYU4oZW5kKSkgY29udGludWU7XG4gICAgcm93cy5wdXNoKHsgbmFtZSwgcGF0aCwgc3RhcnQsIGVuZCB9KTtcbiAgfVxuICByZXR1cm4gcm93cztcbn1cblxuLyoqXG4gKiBUaGUgZnVsbCBgZ2l0IHNwYW4gZHJpZnQgLS1mb3JtYXQgcG9yY2VsYWluYCBzdGF0dXMgdG9rZW4gdm9jYWJ1bGFyeSAodGhlXG4gKiBnaXQtc3BhbiBDTEkncyBwb3JjZWxhaW4gY29udHJhY3QpOiBgRlJFU0hgL2BNT1ZFRGAvYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYFxuICogYXJlIHBvc2l0aW9uYWwtb3ItY2xlYW4gYW5kIG5ldmVyIGRlYnQ7IGV2ZXJ5IG90aGVyIHRva2VuIGlzIHNlbWFudGljIGRyaWZ0XG4gKiBvciBhIHRlcm1pbmFsL2Vycm9yIGNvbmRpdGlvbiBhbmQgaXMgZGVidC4gU2VlIHtAbGluayBpc0RlYnR9IGZvciB0aGVcbiAqIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGggb24gdGhhdCBzcGxpdC5cbiAqL1xuZXhwb3J0IGNvbnN0IFBPUkNFTEFJTl9TVEFUVVNFUyA9IFtcbiAgJ0ZSRVNIJyxcbiAgJ1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUJyxcbiAgJ01PVkVEJyxcbiAgJ0NIQU5HRUQnLFxuICAnREVMRVRFRCcsXG4gICdDT05GTElDVCcsXG4gICdTVUJNT0RVTEUnLFxuICAnTEZTX05PVF9GRVRDSEVEJyxcbiAgJ0xGU19OT1RfSU5TVEFMTEVEJyxcbiAgJ1BST01JU09SX01JU1NJTkcnLFxuICAnU1BBUlNFX0VYQ0xVREVEJyxcbiAgJ0ZJTFRFUl9GQUlMRUQnLFxuICAnSU9fRVJST1InXG5dIGFzIGNvbnN0O1xuXG5leHBvcnQgdHlwZSBQb3JjZWxhaW5TdGF0dXMgPSAodHlwZW9mIFBPUkNFTEFJTl9TVEFUVVNFUylbbnVtYmVyXTtcblxuY29uc3QgUE9SQ0VMQUlOX1NUQVRVU19TRVQ6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFBPUkNFTEFJTl9TVEFUVVNFUyk7XG5cbmZ1bmN0aW9uIHBhcnNlUG9yY2VsYWluU3RhdHVzKHJhdzogc3RyaW5nKTogUG9yY2VsYWluU3RhdHVzIHwgbnVsbCB7XG4gIHJldHVybiBQT1JDRUxBSU5fU1RBVFVTX1NFVC5oYXMocmF3KSA/IChyYXcgYXMgUG9yY2VsYWluU3RhdHVzKSA6IG51bGw7XG59XG5cbi8qKiBBIGBwYXJzZURyaWZ0UG9yY2VsYWluYCByb3c6IGEge0BsaW5rIFBvcmNlbGFpblJvd30gcGx1cyBpdHMgc3RhdHVzIHRva2VuLiAqL1xuZXhwb3J0IGludGVyZmFjZSBEcmlmdFBvcmNlbGFpblJvdyBleHRlbmRzIFBvcmNlbGFpblJvdyB7XG4gIHN0YXR1czogUG9yY2VsYWluU3RhdHVzO1xufVxuXG4vKipcbiAqIFRoZSBkZWJ0IGludmFyaWFudCAoc3lzdGVtLXdpZGU7IGNvbnN1bWVkIGJ5IGJvdGggdGhlIGZ1dHVyZSB0b3VjaC1jb3JlIGFuZFxuICogYWR2aXNvci1jb3JlKTogb25seSBzZW1hbnRpYyBzdGF0dXNlcyBhcmUgZGVidC4gYENIQU5HRURgIGFuZCBgREVMRVRFRGAgYXJlXG4gKiBzZW1hbnRpYyBkcmlmdDsgdGhlIHJlbWFpbmluZyBub24tRlJFU0gvTU9WRUQvUkVTT0xWRURfUEVORElOR19DT01NSVQgdG9rZW5zXG4gKiBhcmUgdGVybWluYWwvZXJyb3IgY29uZGl0aW9ucyBhbmQgYXJlIHRyZWF0ZWQgYXMgZGVidCB0b28gKHRoZXkgYmxvY2sgb25cbiAqIHRoZWlyIG93biBtZXJpdHMgXHUyMDE0IHRoZSBDTEkgY291bGQgbm90IHJlc29sdmUgdGhlIGFuY2hvciBhdCBhbGwpLiBgRlJFU0hgLFxuICogYE1PVkVEYCwgYW5kIGBSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgYXJlIG5ldmVyIGRlYnQ6IHBvc2l0aW9uYWwgZHJpZnQgdGhlXG4gKiBDTEkgY2FuIGhlYWwgKG9yIGFscmVhZHkgaGFzKSBpcyBpbnZpc2libGUsIGFuZCBhIHBlbmRpbmctY29tbWl0IHJlc29sdXRpb25cbiAqIGlzIG5vdCBvdXRzdGFuZGluZyBkZWJ0LlxuICpcbiAqIE5vdGU6IHRoZSBwb3JjZWxhaW4gdm9jYWJ1bGFyeSBkb2VzIG5vdCBjdXJyZW50bHkgZGlzdGluZ3Vpc2hcbiAqIGNvbnRlbnQtZXF1aXZhbGVudCBgQ0hBTkdFRGAgKGUuZy4gd2hpdGVzcGFjZS1vbmx5IGRyaWZ0IGAtLWZpeGAgY2FuIGhlYWwpXG4gKiBmcm9tIGdlbnVpbmVseSBzZW1hbnRpYyBgQ0hBTkdFRGAgXHUyMDE0IHRoYXQgY2xhc3NpZmljYXRpb24gaXMgbm90IHByZXNlbnQgaW5cbiAqIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW5gIG91dHB1dCB0b2RheS4gVW50aWwgdGhlIENMSSBleHBvc2VzIGl0LFxuICogZXZlcnkgYENIQU5HRURgIHJvdyBpcyB0cmVhdGVkIGFzIGRlYnQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0RlYnQoc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBib29sZWFuIHtcbiAgc3dpdGNoIChzdGF0dXMpIHtcbiAgICBjYXNlICdGUkVTSCc6XG4gICAgY2FzZSAnTU9WRUQnOlxuICAgIGNhc2UgJ1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUJzpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIHRydWU7XG4gIH1cbn1cblxuLyoqXG4gKiBMb3dlcmNhc2UgaHVtYW4gbGFiZWwgZm9yIGEgcG9yY2VsYWluIHN0YXR1cyB0b2tlbiAoYExGU19OT1RfRkVUQ0hFRGAgXHUyMTkyXG4gKiBgbGZzIG5vdCBmZXRjaGVkYCkuIFRoZSBzaW5nbGUgbGFiZWwgbWFwcGluZyBmb3IgZXZlcnkgaHVtYW4tZm9ybWF0IGFuY2hvclxuICogc3VmZml4IFx1MjAxNCBib3RoIHRoZSB0b3VjaCBob29rJ3MgYmxvY2sgYW5kIHRoZSBhZHZpc29yJ3MgbWVzc2FnZXMgcmVuZGVyIHRocm91Z2hcbiAqIHRoaXMsIHNvIGEgc3RhdHVzIG5ldmVyIHJlYWRzIGRpZmZlcmVudGx5IGJldHdlZW4gdGhlIHR3by5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGh1bWFuU3RhdHVzTGFiZWwoc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBzdHJpbmcge1xuICByZXR1cm4gc3RhdHVzLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvXy9nLCAnICcpO1xufVxuXG4vKipcbiAqIFRoZSB0ZXJtaW5hbC9lbnZpcm9ubWVudGFsIHN0YXR1c2VzOiB0aGUgQ0xJIGNvdWxkIG5vdCByZXNvbHZlIHRoZSBhbmNob3IgYXRcbiAqIGFsbCwgc28gdGhlIHJvdyBpcyBub3Qgc3BhbiBkcmlmdCBhIHVzZXIgY2FuIGZpeCBieSBlZGl0aW5nIGEgc3Bhbi4gVGhlc2UgYXJlXG4gKiBgQ09ORkxJQ1RgICh1bnJlc29sdmVkIG1lcmdlKSwgYFNVQk1PRFVMRWAgKGFuY2hvciBpbnNpZGUgYSBzdWJtb2R1bGUpLFxuICogYExGU19OT1RfRkVUQ0hFRGAvYExGU19OT1RfSU5TVEFMTEVEYCAoR2l0IExGUyBjb250ZW50IHVuYXZhaWxhYmxlKSxcbiAqIGBQUk9NSVNPUl9NSVNTSU5HYCAocGFydGlhbC1jbG9uZSBvYmplY3Qgbm90IGZldGNoZWQpLCBgU1BBUlNFX0VYQ0xVREVEYFxuICogKHBhdGggb3V0c2lkZSB0aGUgc3BhcnNlLWNoZWNrb3V0IGNvbmUpLCBgRklMVEVSX0ZBSUxFRGAgKGEgY2xlYW4vc211ZGdlXG4gKiBmaWx0ZXIgZXJyb3JlZCksIGFuZCBgSU9fRVJST1JgICh0cmFuc2llbnQgcmVhZCBmYWlsdXJlKS5cbiAqXG4gKiBUaGVzZSBhcmUgYSBzdHJpY3Qgc3Vic2V0IG9mIHtAbGluayBpc0RlYnR9OiBldmVyeSBlbnZpcm9ubWVudGFsIHN0YXR1cyBpc1xuICogYWxzbyBkZWJ0IChpdCBibG9ja3Mgb24gaXRzIG93biBtZXJpdHMgd2hlbiBzdXJmYWNlZCBpbiBhIHN0YXR1cyByZXBvcnQpLCBidXRcbiAqIHRoZSBhZHZpc29yIG11c3QgdHJlYXQgdGhlbSBkaWZmZXJlbnRseSBmcm9tICpzZW1hbnRpYyogZHJpZnQgKGBDSEFOR0VEYCxcbiAqIGBERUxFVEVEYCkuIFNlbWFudGljIGRyaWZ0IGlzIGZpeGFibGUgYnkgZWRpdGluZyBhIHNwYW4sIHNvIHRoZSBhZHZpc29yIGZhaWxzXG4gKiBjbG9zZWQgb24gaXQ7IGFuIGVudmlyb25tZW50YWwgY29uZGl0aW9uIGlzIG5vdCBzb21ldGhpbmcgYSBzcGFuIGVkaXQgY2FuXG4gKiByZXNvbHZlLCBzbyB0aGUgYWR2aXNvciBmYWlscyBPUEVOIG9uIGl0IChhbGxvdywgYnV0IHN1cmZhY2UgdGhlIGNvbmRpdGlvbikgXHUyMDE0XG4gKiByZS1kZW55aW5nIGZvcmV2ZXIgb24gYW4gaW5mcmEgZmFpbHVyZSB0aGUgdXNlciBjYW5ub3QgY2xlYXIgZnJvbSBoZXJlIHdvdWxkXG4gKiBjb250cmFkaWN0IHRoZSBmYWlsLW9wZW4gY29udHJhY3QgdGhlIHJlc3Qgb2YgdGhlIGFkdmlzb3IgYWxyZWFkeSBob25vcnMgZm9yXG4gKiBDTEktYWJzZW50L3RpbWVvdXQvcGFyc2UtZmFpbHVyZSBjb25kaXRpb25zLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNFbnZpcm9ubWVudGFsU3RhdHVzKHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogYm9vbGVhbiB7XG4gIHN3aXRjaCAoc3RhdHVzKSB7XG4gICAgY2FzZSAnQ09ORkxJQ1QnOlxuICAgIGNhc2UgJ1NVQk1PRFVMRSc6XG4gICAgY2FzZSAnTEZTX05PVF9GRVRDSEVEJzpcbiAgICBjYXNlICdMRlNfTk9UX0lOU1RBTExFRCc6XG4gICAgY2FzZSAnUFJPTUlTT1JfTUlTU0lORyc6XG4gICAgY2FzZSAnU1BBUlNFX0VYQ0xVREVEJzpcbiAgICBjYXNlICdGSUxURVJfRkFJTEVEJzpcbiAgICBjYXNlICdJT19FUlJPUic6XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKlxuICogYGdpdCBzcGFuIGRyaWZ0IC0tZm9ybWF0IHBvcmNlbGFpbmAgZW1pdHMgYSBkaWZmZXJlbnQgc2hhcGUgdGhhblxuICogYGxpc3QgLS1wb3JjZWxhaW5gOiBhIGAjIHBvcmNlbGFpbiB2MmAgaGVhZGVyLCBgIyBmdXp6eSBOYCBjb21tZW50IGxpbmVzLFxuICogYW5kIG9uZSBgPHN0YXR1cz5cXHQ8c3JjPlxcdDxuYW1lPlxcdDxwYXRoPlxcdDxzdGFydD5cXHQ8ZW5kPmAgcm93IHBlciBkcmlmdGVkXG4gKiBhbmNob3IgKHdob2xlLWZpbGUgYW5jaG9ycyBjYXJyeSBgKHdob2xlKWAvYC1gIGluIHBsYWNlIG9mIHRoZSBsaW5lIGNvbHVtbnMpLlxuICogUm93cyB3aG9zZSBzdGF0dXMgdG9rZW4gaXMgbm90IGluIHtAbGluayBQT1JDRUxBSU5fU1RBVFVTRVN9IGFyZSBza2lwcGVkIFx1MjAxNFxuICogYW4gdW5yZWNvZ25pemVkIHRva2VuIGZyb20gYSBuZXdlciBDTEkgaXMgdHJlYXRlZCB0aGUgc2FtZSBhcyBhIG1hbGZvcm1lZFxuICogbGluZSByYXRoZXIgdGhhbiBndWVzc2VkIGF0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VEcmlmdFBvcmNlbGFpbihzdGRvdXQ6IHN0cmluZyk6IERyaWZ0UG9yY2VsYWluUm93W10ge1xuICBjb25zdCByb3dzOiBEcmlmdFBvcmNlbGFpblJvd1tdID0gW107XG4gIGZvciAoY29uc3QgbGluZSBvZiBzdGRvdXQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCB8fCB0cmltbWVkLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgY29uc3QgcGFydHMgPSB0cmltbWVkLnNwbGl0KCdcXHQnKTtcbiAgICBpZiAocGFydHMubGVuZ3RoIDwgNikgY29udGludWU7XG4gICAgY29uc3QgW3N0YXR1c0NvbCwgLCBuYW1lLCBwYXRoLCBzdGFydENvbCwgZW5kQ29sXSA9IHBhcnRzO1xuICAgIGNvbnN0IHN0YXR1cyA9IHBhcnNlUG9yY2VsYWluU3RhdHVzKHN0YXR1c0NvbCk7XG4gICAgaWYgKCFzdGF0dXMpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHN0YXJ0ID0gc3RhcnRDb2wgPT09ICcod2hvbGUpJyA/IDAgOiBwYXJzZUludChzdGFydENvbCwgMTApO1xuICAgIGNvbnN0IGVuZCA9IGVuZENvbCA9PT0gJy0nID8gMCA6IHBhcnNlSW50KGVuZENvbCwgMTApO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpIHx8IE51bWJlci5pc05hTihlbmQpKSBjb250aW51ZTtcbiAgICByb3dzLnB1c2goeyBuYW1lLCBwYXRoLCBzdGFydCwgZW5kLCBzdGF0dXMgfSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2Vzc2lvbiBJRCBzYW5pdGl6YXRpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIEluamVjdGl2ZSB0cmFuc2Zvcm06IHBlcmNlbnQtZW5jb2RlIGJ5dGVzIG91dHNpZGUgW0EtWmEtejAtOS5fLV0gYXMgJUhIXG4gKiAodXBwZXJjYXNlIGhleCkuIFVzZWQgdG8gcHJvZHVjZSBzYWZlIGZpbGVuYW1lcyBmcm9tIGFyYml0cmFyeSBzZXNzaW9uIGlkcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplU2Vzc2lvbklkKHNlc3Npb25JZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHNlc3Npb25JZC5yZXBsYWNlKC9bXkEtWmEtejAtOS5fLV0vZywgKGNoKSA9PiB7XG4gICAgcmV0dXJuIGAlJHtjaC5jaGFyQ29kZUF0KDApLnRvU3RyaW5nKDE2KS50b1VwcGVyQ2FzZSgpLnBhZFN0YXJ0KDIsICcwJyl9YDtcbiAgfSk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUGVyLXNlc3Npb24gYmFzZSBkaXJlY3Rvcnlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vLyBCYXNlIGRpciBzaGFyZWQgYnkgYWxsIHBlci1zZXNzaW9uIHN0YXRlOiBjdXJyZW50bHkganVzdCB0aGUgdG91Y2gtaG9va1xuLy8gc2Vzc2lvbiBtZW1vIChzcGFuLXN1cmZhY2UudHMncyBNZW1vU3RvcmUpLiBFYWNoIHNlc3Npb24gZ2V0cyBvbmVcbi8vIHN1YmRpcmVjdG9yeSBrZXllZCBieSBpdHMgc2FuaXRpemVkIGlkLCBzbyBldmVyeSB3cml0ZXIvcmVhZGVyIGZvciBhIGdpdmVuXG4vLyBzZXNzaW9uIGFncmVlcyBvbiBpdHMgbG9jYXRpb24uXG5leHBvcnQgY29uc3QgU0VTU0lPTl9CQVNFX0RJUiA9IG5vZGVQYXRoLmpvaW4ob3MuaG9tZWRpcigpLCAnLmNhY2hlJywgJ2dpdC1zcGFuJywgJ3Nlc3Npb24nKTtcblxuLyoqIFRoZSBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcnkgZm9yIGEgZ2l2ZW4gc2Vzc2lvbiBpZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uRGlyKHNlc3Npb25JZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4oU0VTU0lPTl9CQVNFX0RJUiwgc2FuaXRpemVTZXNzaW9uSWQoc2Vzc2lvbklkKSk7XG59XG5cbmNvbnN0IFRISVJUWV9EQVlTX01TID0gMzAgKiAyNCAqIDYwICogNjAgKiAxMDAwO1xuXG4vKipcbiAqIE9wcG9ydHVuaXN0aWNhbGx5IHBydW5lIHBlci1zZXNzaW9uIHN0YXRlIGRpcmVjdG9yaWVzIHVuZGVyXG4gKiB7QGxpbmsgU0VTU0lPTl9CQVNFX0RJUn0gd2hvc2UgbXRpbWUgaXMgb2xkZXIgdGhhbiBgbWF4QWdlTXNgIChkZWZhdWx0IDMwXG4gKiBkYXlzKS4gQSBkaXJlY3RvcnkncyBtdGltZSBhZHZhbmNlcyB3aGVuZXZlciBhbiBlbnRyeSBpbnNpZGUgaXQgaXNcbiAqIGNyZWF0ZWQvcmVuYW1lZC9yZW1vdmVkLCBzbyBhbiBhY3RpdmUgc2Vzc2lvbiAobWVtbyB3cml0ZXMpIHN0YXlzIGZyZXNoO1xuICogb25seSBnZW51aW5lbHkgYWJhbmRvbmVkIHNlc3Npb25zIGFnZSBvdXQuXG4gKlxuICogQmVzdC1lZmZvcnQgYW5kIG5vbi10aHJvd2luZzogY2FsbGVkIG9wcG9ydHVuaXN0aWNhbGx5IGZyb20gaG9vayByZWFkL3dyaXRlXG4gKiBwYXRocywgbm90IGEgc2VwYXJhdGUgY3Jvbi1saWtlIG1lY2hhbmlzbSwgc28gYSBmYWlsdXJlIGhlcmUgbXVzdCBuZXZlclxuICogYmxvY2sgdGhlIGNhbGxlcidzIGFjdHVhbCB3b3JrLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcHJ1bmVTdGFsZVNlc3Npb25zKG5vdzogbnVtYmVyID0gRGF0ZS5ub3coKSwgbWF4QWdlTXM6IG51bWJlciA9IFRISVJUWV9EQVlTX01TKTogdm9pZCB7XG4gIGxldCBlbnRyaWVzOiBmcy5EaXJlbnRbXTtcbiAgdHJ5IHtcbiAgICBlbnRyaWVzID0gZnMucmVhZGRpclN5bmMoU0VTU0lPTl9CQVNFX0RJUiwgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm47IC8vIGJhc2UgZGlyIGFic2VudCBvciB1bnJlYWRhYmxlIFx1MjAxNCBub3RoaW5nIHRvIHBydW5lXG4gIH1cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSB7XG4gICAgaWYgKCFlbnRyeS5pc0RpcmVjdG9yeSgpKSBjb250aW51ZTtcbiAgICBjb25zdCBkaXJQYXRoID0gbm9kZVBhdGguam9pbihTRVNTSU9OX0JBU0VfRElSLCBlbnRyeS5uYW1lKTtcbiAgICB0cnkge1xuICAgICAgY29uc3Qgc3RhdCA9IGZzLnN0YXRTeW5jKGRpclBhdGgpO1xuICAgICAgaWYgKG5vdyAtIHN0YXQubXRpbWVNcyA+IG1heEFnZU1zKSB7XG4gICAgICAgIGZzLnJtU3luYyhkaXJQYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XG4gICAgICB9XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBWYW5pc2hlZCBiZXR3ZWVuIHJlYWRkaXIgYW5kIHN0YXQsIG9yIHJlbW92YWwgZmFpbGVkIFx1MjAxNCBza2lwIGl0LiBBXG4gICAgICAvLyBiZXN0LWVmZm9ydCBwcnVuZSBtdXN0IG5ldmVyIHRocm93IGludG8gdGhlIGNhbGxlcidzIGhvdCBwYXRoLlxuICAgIH1cbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIGtpbmQgYW5kIGFuY2hvciBmb3JtYXR0aW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IHR5cGUgVG91Y2hLaW5kID0gJ3JlYWQnIHwgJ3dyaXRlJyB8ICd3aG9sZS1yZWFkJyB8ICd3aG9sZS13cml0ZScgfCAnY3JlYXRlJztcblxuLyoqXG4gKiBGb3JtYXQgYSBzcGFuIGFuY2hvciBzdHJpbmcuXG4gKlxuICogLSBgd2hvbGUtcmVhZGAsIGB3aG9sZS13cml0ZWAsIGFuZCBgY3JlYXRlYDogcmV0dXJucyBqdXN0IHRoZSBwYXRoXG4gKiAtIGByZWFkYCBhbmQgYHdyaXRlYDogcmV0dXJucyBgcGF0aCNMPHN0YXJ0Pi1MPGVuZD5gIChyZXF1aXJlcyByYW5nZSlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEFuY2hvcihwYXRoOiBzdHJpbmcsIGtpbmQ6IFRvdWNoS2luZCwgcmFuZ2U/OiBMaW5lUmFuZ2UpOiBzdHJpbmcge1xuICBpZiAoKGtpbmQgPT09ICdyZWFkJyB8fCBraW5kID09PSAnd3JpdGUnKSAmJiByYW5nZSkge1xuICAgIHJldHVybiBgJHtwYXRofSNMJHtyYW5nZS5zdGFydH0tTCR7cmFuZ2UuZW5kfWA7XG4gIH1cbiAgcmV0dXJuIHBhdGg7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQW5jaG9yIHNwZWMgdHlwZVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgQW5jaG9yU3BlYyB7XG4gIHBhdGg6IHN0cmluZztcbiAga2luZDogVG91Y2hLaW5kO1xuICByYW5nZT86IExpbmVSYW5nZTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBRdWV1ZSBkaXJlY3RvcnkgaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgZ2l0IGNvbW1vbiBkaXJlY3RvcnkgZm9yIHRoZSBnaXZlbiByZXBvIHJvb3QuXG4gKiBUaGlzIGlzIHRoZSBzaGFyZWQgZGlyZWN0b3J5IChub3QgdGhlIHdvcmt0cmVlLXNwZWNpZmljIC5naXQpLCBzbyBxdWV1ZVxuICogcmVjb3JkcyBzdXJ2aXZlIHdvcmt0cmVlIGRlbGV0aW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUdpdENvbW1vbkRpcihyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdyZXYtcGFyc2UnLCAnLS1naXQtY29tbW9uLWRpciddLCB7XG4gICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgZW5jb2Rpbmc6ICd1dGY4J1xuICB9KTtcbiAgY29uc3QgdHJpbW1lZCA9IHRvUG9zaXgob3V0LnRyaW0oKSk7XG4gIC8vIGdpdCByZXR1cm5zIGEgcmVsYXRpdmUgcGF0aCAoZS5nLiBcIi5naXRcIikgZm9yIHNpbXBsZSByZXBvcy4gUmVzb2x2ZSBpdFxuICAvLyBhZ2FpbnN0IHJlcG9Sb290IHNvIGNhbGxlcnMgbmV2ZXIgZGVwZW5kIG9uIHByb2Nlc3MuY3dkKCkuXG4gIGlmICghbm9kZVBhdGguaXNBYnNvbHV0ZSh0cmltbWVkKSkge1xuICAgIHJldHVybiB0b1Bvc2l4KG5vZGVQYXRoLnJlc29sdmUocmVwb1Jvb3QsIHRyaW1tZWQpKTtcbiAgfVxuICByZXR1cm4gdHJpbW1lZDtcbn1cblxuLyoqXG4gKiBSb290IG9mIHRoZSBnaXQtc3BhbiBxdWV1ZSBkaXJlY3RvcnkgdHJlZSwgdW5kZXIgdGhlIGdpdCBjb21tb24gZGlyLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcXVldWVSb290KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihyZXNvbHZlR2l0Q29tbW9uRGlyKHJlcG9Sb290KSwgJ2dpdC1zcGFuJyk7XG59XG5cbi8qKlxuICogRGlyZWN0b3J5IGZvciB0aGUgYWR2aXNvcidzIHBlci1jaGFuZ2VzZXQgc3RhdGUgbWVtb3MgKGRpZ2VzdCBvZiBzb3J0ZWRcbiAqIGZpbmRpbmdzICsgdW5jb3ZlcmVkIHBhdGhzKSwgdW5kZXIgdGhlIGdpdCBjb21tb24gZGlyIHNvIGl0IGlzIHNoYXJlZFxuICogYWNyb3NzIHdvcmt0cmVlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFkdmlzb3JNZW1vRGlyKHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihxdWV1ZVJvb3QocmVwb1Jvb3QpLCAnYWR2aXNvcicpO1xufVxuIiwgIi8qKlxuICogSGFybmVzcy1hZ25vc3RpYyBzcGFuLXN1cmZhY2luZyBjb3JlLlxuICpcbiAqIEdpdmVuIGFuIGFscmVhZHktcmVzb2x2ZWQgcmVwby1yZWxhdGl2ZSBwYXRoIGFuZCBhIGxpbmUgcmFuZ2UsIHRoaXMgbW9kdWxlXG4gKiBydW5zIHRoZSBzaGFyZWQgYGdpdCBzcGFuIGxpc3QgLS1wb3JjZWxhaW5gIC8gYC5ob29raWdub3JlYCAvIHNlc3Npb24tbWVtbyAvXG4gKiBgZ2l0IHNwYW4gZHJpZnRgIHBpcGVsaW5lIGFuZCBhc3NlbWJsZXMgdGhlIGh1bWFuLXJlYWRhYmxlIGA8Z2l0LXNwYW4+XHUyMDI2PC9naXQtc3Bhbj5gXG4gKiBibG9jayB0aGF0IGJvdGggYWRhcHRlcnMgc3VyZmFjZSBpbmxpbmUgYmVmb3JlIGFuIGVkaXQuIEl0IGltcG9ydHMgbm90aGluZ1xuICogZnJvbSBlaXRoZXIgaG9vayBTREs6IHRoZSBDbGF1ZGUgUHJlVG9vbFVzZSBob29rIGZlZWRzIGl0IGEgcmFuZ2UgZGVyaXZlZCBmcm9tXG4gKiBgZmlsZV9wYXRoYC9gb2Zmc2V0YC9gb2xkX3N0cmluZ2A7IHRoZSBDb2RleCBQcmVUb29sVXNlIGhvb2sgZmVlZHMgaXQgdGhlXG4gKiByYW5nZXMgcmVjb3ZlcmVkIGZyb20gYW4gYGFwcGx5X3BhdGNoYCBlbnZlbG9wZS4gRWFjaCBhZGFwdGVyIHdyYXBzIHRoZVxuICogcmV0dXJuZWQgYmxvY2sgc3RyaW5nIGluIGl0cyBvd24gU0RLIG91dHB1dCBidWlsZGVyLlxuICpcbiAqIFRoZSBleGVjdXRvci9kcmlmdC9tZW1vIGRlcGVuZGVuY2llcyBhcmUgaW5qZWN0ZWQgc28gdGhlIHBpcGVsaW5lIGlzIHRlc3RhYmxlXG4gKiB3aXRoIGZha2VzIGV4YWN0bHkgbGlrZSB0aGUgcG9yY2VsYWluIHBhcnNlcnMgaW4gdGhlIHNoYXJlZCBrZXJuZWwuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7XG4gIGlzR2l0SWdub3JlZCxcbiAgaXNJbnNpZGVTcGFuUm9vdCxcbiAgdHlwZSBMaW5lUmFuZ2UsXG4gIHR5cGUgUG9yY2VsYWluUm93LFxuICBwYXJzZURyaWZ0UG9yY2VsYWluLFxuICBwYXJzZVBvcmNlbGFpbixcbiAgcHJ1bmVTdGFsZVNlc3Npb25zLFxuICByYW5nZXNJbnRlcnNlY3QsXG4gIHJlbGF0aXZlVG9SZXBvLFxuICByZXNvbHZlUmVwb1Jvb3QsXG4gIHJlc29sdmVTcGFuUm9vdCxcbiAgc2Vzc2lvbkRpcixcbiAgdG9Qb3NpeFxufSBmcm9tICcuL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyB0eXBlIEhvb2tJZ25vcmVMb2FkZXIsIGlzU3BhblN1cHByZXNzZWQgfSBmcm9tICcuL3NwYW4taWdub3JlLmpzJztcblxuLyoqXG4gKiBNaW5pbWFsIGxvZ2dlciBzdXJmYWNlIHRoZSBgY29tbW9uL2AgbGF5ZXIgbG9ncyB0aHJvdWdoOyBib3RoIFNESyBsb2dnZXJzXG4gKiBzYXRpc2Z5IGl0LiBgd2FybmAgaXMgcmVxdWlyZWQgXHUyMDE0IGV2ZXJ5IGV4aXN0aW5nIGNhbGwgc2l0ZSByZXBvcnRzIGEgZmFpbHVyZS5cbiAqIGBpbmZvYCBpcyBvcHRpb25hbCBzbyBhIGZha2UgY2Fycnlpbmcgb25seSBgd2FybmAgc3RpbGwgc2F0aXNmaWVzIHRoZVxuICogaW50ZXJmYWNlOiBpdCBleGlzdHMgZm9yIHRoZSBkaWFnbm9zdGljIGJyZWFkY3J1bWJzIGEgKnN1Y2Nlc3NmdWwqIHJ1biBsZWF2ZXNcbiAqIGJlaGluZCAoYWR2aXNvci1jb3JlJ3MgY2h1cm4tc3VwcHJlc3Npb24gY291bnQpLCB3aGljaCBhcmUgbm90IHdhcm5pbmdzIGFuZFxuICogbXVzdCBub3QgcmVhZCBhcyBmYWlsdXJlcyBpbiB0aGUgaG9vayBsb2cuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29yZUxvZ2dlciB7XG4gIHdhcm4obWVzc2FnZTogc3RyaW5nLCBjb250ZXh0PzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB2b2lkO1xuICBpbmZvPyhtZXNzYWdlOiBzdHJpbmcsIGNvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQ7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU3BhbiBleGVjdXRvciBhYnN0cmFjdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogRXhlY3V0ZXMgYGdpdCBzcGFuIGxpc3RgIHdpdGggZ2l2ZW4gYXJncyBpbiBhIGdpdmVuIGN3ZC5cbiAqIFJldHVybnMgc3Rkb3V0IHN0cmluZy4gVGhyb3dzIG9uIG5vbi16ZXJvIGV4aXQuXG4gKi9cbmV4cG9ydCB0eXBlIFNwYW5FeGVjdXRvciA9IChhcmdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpID0+IHN0cmluZztcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHRTcGFuRXhlY3V0b3IodGltZW91dE1zID0gMTBfMDAwKTogU3BhbkV4ZWN1dG9yIHtcbiAgcmV0dXJuIChhcmdzLCBjd2QpID0+IHtcbiAgICByZXR1cm4gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnbGlzdCcsIC4uLmFyZ3NdLCB7XG4gICAgICBjd2QsXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgfSk7XG4gIH07XG59XG5cbi8qKlxuICogUnVucyBgZ2l0IHNwYW4gZHJpZnQgLS1mb3JtYXQgcG9yY2VsYWluIDxzbHVncz5gIGFuZCByZXR1cm5zIGl0cyBwb3JjZWxhaW4gc3Rkb3V0IFx1MjAxNFxuICogb25lIHJvdyBwZXIgKmRyaWZ0ZWQqIGFuY2hvciBhbW9uZyB0aGUgZ2l2ZW4gc3BhbnMsIGVtcHR5IHdoZW4gYWxsIGFyZSBjbGVhbi5cbiAqIGBnaXQgc3BhbiBkcmlmdGAgZXhpdHMgMCBpbiBwb3JjZWxhaW4gbW9kZSB3aGV0aGVyIG9yIG5vdCBkcmlmdCBleGlzdHMsIGJ1dCB3ZVxuICogc3RpbGwgY2FwdHVyZSBzdGRvdXQgZnJvbSBhIHRocm93biBlcnJvciBzbyBhIGRyaWZ0IHNpZ25hbCBpcyBuZXZlciBsb3N0IHRvIGFcbiAqIG5vbi16ZXJvIGV4aXQuIFRocm93cyBvbmx5IHdoZW4gbm8gc3Rkb3V0IGlzIGF2YWlsYWJsZSAoZ2VudWluZSBmYWlsdXJlKS5cbiAqL1xuZXhwb3J0IHR5cGUgRHJpZnRFeGVjdXRvciA9IChzbHVnczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKSA9PiBzdHJpbmc7XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0RHJpZnRFeGVjdXRvcih0aW1lb3V0TXMgPSAxMF8wMDApOiBEcmlmdEV4ZWN1dG9yIHtcbiAgcmV0dXJuIChzbHVncywgY3dkKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdkcmlmdCcsICctLWZvcm1hdCcsICdwb3JjZWxhaW4nLCAuLi5zbHVnc10sIHtcbiAgICAgICAgY3dkLFxuICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zdCBvdXQgPSAoZXJyIGFzIHsgc3Rkb3V0Pzogc3RyaW5nIH0pLnN0ZG91dDtcbiAgICAgIGlmICh0eXBlb2Ygb3V0ID09PSAnc3RyaW5nJykgcmV0dXJuIG91dDtcbiAgICAgIHRocm93IGVycjtcbiAgICB9XG4gIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2Vzc2lvbiBtZW1vIGFic3RyYWN0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBNZW1vU3RvcmUge1xuICBnZXRTdXJmYWNlZChzZXNzaW9uSWQ6IHN0cmluZyk6IFNldDxzdHJpbmc+O1xuICBhZGRTdXJmYWNlZChzZXNzaW9uSWQ6IHN0cmluZywgbmFtZXM6IHN0cmluZ1tdKTogdm9pZDtcbn1cblxuLy8gTGl2ZXMgdW5kZXIgdGhlIHNoYXJlZCBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcnkgKGFnZW50LWhvb2tzLWNvbW1vbi50cydzXG4vLyBzZXNzaW9uRGlyKSBcdTIwMTQgcmVsb2NhdGVkIGZyb20gb3MudG1wZGlyKCkvYWdlbnQtaG9va3MtZ2l0LXNwYW4vIHNvXG4vLyBwZXItc2Vzc2lvbiBzdGF0ZSBoYXMgb25lIGhvbWUgYW5kIGlzIGNvdmVyZWQgYnkgcHJ1bmVTdGFsZVNlc3Npb25zJ3Ncbi8vIG9wcG9ydHVuaXN0aWMgPjMwLWRheSBwcnVuaW5nLlxuZnVuY3Rpb24gbWVtb0ZpbGVQYXRoKHNlc3Npb25JZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4oc2Vzc2lvbkRpcihzZXNzaW9uSWQpLCAndG91Y2gtbWVtby5qc29uJyk7XG59XG5cbmV4cG9ydCB0eXBlIE1lbW9Mb2dnZXIgPSBDb3JlTG9nZ2VyO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGlza01lbW9TdG9yZShsb2dnZXI6IE1lbW9Mb2dnZXIpOiBNZW1vU3RvcmUge1xuICByZXR1cm4ge1xuICAgIGdldFN1cmZhY2VkKHNlc3Npb25JZCkge1xuICAgICAgcHJ1bmVTdGFsZVNlc3Npb25zKCk7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByYXcgPSBmcy5yZWFkRmlsZVN5bmMobWVtb0ZpbGVQYXRoKHNlc3Npb25JZCksICd1dGY4Jyk7XG4gICAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UocmF3KSBhcyB7IHN1cmZhY2VkPzogdW5rbm93biB9O1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShwYXJzZWQuc3VyZmFjZWQpKSB7XG4gICAgICAgICAgcmV0dXJuIG5ldyBTZXQocGFyc2VkLnN1cmZhY2VkIGFzIHN0cmluZ1tdKTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKCdtZW1vIHJlYWQgZmFpbGVkICh0cmVhdGluZyBhcyBlbXB0eSknLCB7IGVyciB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBuZXcgU2V0KCk7XG4gICAgfSxcbiAgICBhZGRTdXJmYWNlZChzZXNzaW9uSWQsIG5hbWVzKSB7XG4gICAgICBwcnVuZVN0YWxlU2Vzc2lvbnMoKTtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5nZXRTdXJmYWNlZChzZXNzaW9uSWQpO1xuICAgICAgZm9yIChjb25zdCBuIG9mIG5hbWVzKSBleGlzdGluZy5hZGQobik7XG4gICAgICBjb25zdCBtZW1vRGlyID0gc2Vzc2lvbkRpcihzZXNzaW9uSWQpO1xuICAgICAgY29uc3QgbWVtb1BhdGggPSBtZW1vRmlsZVBhdGgoc2Vzc2lvbklkKTtcbiAgICAgIGNvbnN0IHRtcFBhdGggPSBgJHttZW1vUGF0aH0udG1wYDtcbiAgICAgIHRyeSB7XG4gICAgICAgIGZzLm1rZGlyU3luYyhtZW1vRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgZnMud3JpdGVGaWxlU3luYyh0bXBQYXRoLCBKU09OLnN0cmluZ2lmeSh7IHN1cmZhY2VkOiBbLi4uZXhpc3RpbmddIH0pLCAndXRmOCcpO1xuICAgICAgICBmcy5yZW5hbWVTeW5jKHRtcFBhdGgsIG1lbW9QYXRoKTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBsb2dnZXIud2FybignbWVtbyB3cml0ZSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG59XG5cbi8qKiBGYWN0b3J5IGZ1bmN0aW9uIHRoYXQgY3JlYXRlcyBhIE1lbW9TdG9yZSBnaXZlbiBhIGxvZ2dlci4gKi9cbmV4cG9ydCB0eXBlIE1lbW9GYWN0b3J5ID0gKGxvZ2dlcjogTWVtb0xvZ2dlcikgPT4gTWVtb1N0b3JlO1xuXG4vKiogRGVmYXVsdCBkaXNrLWJhY2tlZCBtZW1vIGZhY3RvcnkgdXNlZCBpbiBwcm9kdWN0aW9uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRpc2tNZW1vRmFjdG9yeShsb2dnZXI6IE1lbW9Mb2dnZXIpOiBNZW1vU3RvcmUge1xuICByZXR1cm4gY3JlYXRlRGlza01lbW9TdG9yZShsb2dnZXIpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIHNjb3BlIHJlc29sdXRpb24gKHJlcG8tc2NvcGluZyArIGdpdGlnbm9yZSArIHNwYW4tcm9vdCBndWFyZHMpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBUb3VjaFNjb3BlIHtcbiAgcmVwb1Jvb3Q6IHN0cmluZztcbiAgcmVwb1JlbFBhdGg6IHN0cmluZztcbn1cblxuLyoqXG4gKiBCb3VuZCBhIHRvdWNoZWQgZmlsZSB0byB0aGUgQ1dEIHJlcG8uIFJlc29sdmUgdGhlIHJlcG8gcm9vdCBvZiB0aGUgY3VycmVudFxuICogd29ya2luZyBkaXJlY3RvcnkgYW5kIHJlcXVpcmUgdGhlIHRvdWNoZWQgZmlsZSB0byByZXNvbHZlIHRvIHRoZSBTQU1FIHJlcG9cbiAqIHJvb3Q7IGRyb3AgZmlsZXMgaW4gYSBkaWZmZXJlbnQgcmVwb3NpdG9yeS93b3JrdHJlZSwgZ2l0aWdub3JlZCBmaWxlcywgYW5kXG4gKiBmaWxlcyB1bmRlciB0aGUgc3BhbiByb290LiBSZXR1cm5zIHRoZSByZXNvbHZlZCBgeyByZXBvUm9vdCwgcmVwb1JlbFBhdGggfWBcbiAqIG9yIG51bGwgd2hlbiB0aGUgdG91Y2ggaXMgb3V0IG9mIHNjb3BlLlxuICpcbiAqIENvbXBhcmluZyByZXNvbHZlZCBgZ2l0IC0tc2hvdy10b3BsZXZlbGAgdG9wbGV2ZWxzIChub3QgcGF0aCBwcmVmaXhlcylcbiAqIGRpc3Rpbmd1aXNoZXMgc2VwYXJhdGUgcmVwb3MgYW5kIHdvcmt0cmVlcyBhbmQgaXMgcm9idXN0IHRvIHN5bWxpbmtzLiBGYWlsXG4gKiBjbG9zZWQ6IGlmIHRoZSBDV0QgcmVwbyBjYW4ndCBiZSByZXNvbHZlZCwgdGhlIHRvdWNoIGlzIGRyb3BwZWQgcmF0aGVyIHRoYW5cbiAqIGZhbGxpbmcgYmFjayB0byB0aGUgZmlsZSdzIG93biByZXBvLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVRvdWNoU2NvcGUoY3dkOiBzdHJpbmcsIGFic1BhdGg6IHN0cmluZyk6IFRvdWNoU2NvcGUgfCBudWxsIHtcbiAgY29uc3QgY3dkUmVwb1Jvb3QgPSBjd2QgPyByZXNvbHZlUmVwb1Jvb3QoY3dkKSA6IG51bGw7XG4gIGlmICghY3dkUmVwb1Jvb3QpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGFic0RpciA9IHRvUG9zaXgobm9kZVBhdGguZGlybmFtZShhYnNQYXRoKSk7XG4gIGNvbnN0IGZpbGVSZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChhYnNEaXIpO1xuICBpZiAoZmlsZVJlcG9Sb290ICE9PSBjd2RSZXBvUm9vdCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgcmVwb1Jvb3QgPSBjd2RSZXBvUm9vdDtcbiAgY29uc3QgcmVwb1JlbFBhdGggPSByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgYWJzUGF0aCk7XG5cbiAgLy8gU2tpcCBnaXRpZ25vcmVkIGZpbGVzIGVudGlyZWx5LiBCdWlsZCBvdXRwdXQsIGNhY2hlcywgYW5kIGxvZ3MgYXJlIG5vdFxuICAvLyBzcGFuLXJlbGV2YW50OiB0aGV5IG11c3QgbmV2ZXIgc3VyZmFjZSBzcGFuIG92ZXJsYXBzLlxuICBpZiAoaXNHaXRJZ25vcmVkKHJlcG9Sb290LCByZXBvUmVsUGF0aCkpIHJldHVybiBudWxsO1xuXG4gIC8vIFNraXAgc3BhbiBkb2N1bWVudHMgZW50aXJlbHkuIEZpbGVzIHVuZGVyIHRoZSByZXNvbHZlZCBzcGFuIHJvb3QgYXJlIG1hbmFnZWRcbiAgLy8gYnkgZ2l0IHNwYW4gaXRzZWxmIGFuZCBhcmUgbm90IGFwcGxpY2F0aW9uIHNvdXJjZXMgdGhhdCBuZWVkIHNwYW4gY292ZXJhZ2UuXG4gIGNvbnN0IHNwYW5Sb290ID0gcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290KTtcbiAgaWYgKGlzSW5zaWRlU3BhblJvb3QocmVwb1JlbFBhdGgsIHNwYW5Sb290KSkgcmV0dXJuIG51bGw7XG5cbiAgcmV0dXJuIHsgcmVwb1Jvb3QsIHJlcG9SZWxQYXRoIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU3VyZmFjZSByb3V0aW5lXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEluamVjdGVkIGRlcGVuZGVuY2llcyBmb3Ige0BsaW5rIHN1cmZhY2VPdmVybGFwcGluZ1NwYW5zfS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3VyZmFjZURlcHMge1xuICBleGVjdXRvcjogU3BhbkV4ZWN1dG9yO1xuICBkcmlmdEV4ZWN1dG9yOiBEcmlmdEV4ZWN1dG9yO1xuICBtZW1vOiBNZW1vU3RvcmU7XG4gIGxvYWRSdWxlczogSG9va0lnbm9yZUxvYWRlcjtcbiAgbG9nZ2VyOiBDb3JlTG9nZ2VyO1xufVxuXG4vKipcbiAqIEdpdmVuIGEgcmVwby1yZWxhdGl2ZSBwYXRoIGFuZCB0aGUgbGluZSByYW5nZSBiZWluZyB0b3VjaGVkIHdpdGhpbiBhblxuICogYWxyZWFkeS1yZXNvbHZlZCByZXBvLCBwcm9kdWNlIHRoZSBgPGdpdC1zcGFuPlx1MjAyNjwvZ2l0LXNwYW4+YCBibG9jayBmb3IgdGhlXG4gKiBzcGFucyBvdmVybGFwcGluZyB0aGF0IHJhbmdlLCBvciBudWxsIHdoZW4gdGhlcmUgaXMgbm90aGluZyB0byBzdXJmYWNlLlxuICpcbiAqIFRoZSBwaXBlbGluZTogYGdpdCBzcGFuIGxpc3QgPHBhdGg+IC0tcG9yY2VsYWluYCBcdTIxOTIga2VlcCBsaW5lLXJhbmdlZCBhbmNob3JzIG9uXG4gKiB0aGUgc2FtZSBmaWxlIHRoYXQgaW50ZXJzZWN0IHRoZSByYW5nZSBhbmQgYXJlIG5vdCBgLmhvb2tpZ25vcmVgLXN1cHByZXNzZWQgXHUyMTkyXG4gKiBkcm9wIHNsdWdzIGFscmVhZHkgc3VyZmFjZWQgdGhpcyBzZXNzaW9uIChtZW1vKSBcdTIxOTIgcmVuZGVyIGBnaXQgc3BhbiBsaXN0XG4gKiA8bmFtZXNcdTIwMjY+YCBcdTIxOTIgYXBwZW5kIGEgYGdpdCBzcGFuIGhpc3RvcnkgPG5hbWU+YCBwb2ludGVyIGZvciBhbnkgYWxyZWFkeS1kcmlmdGVkXG4gKiBzcGFuLiBPbiBzdWNjZXNzIHRoZSBzdXJmYWNlZCBuYW1lcyBhcmUgcmVjb3JkZWQgaW4gdGhlIG1lbW8uIEV4ZWN1dG9yIGFuZFxuICogZHJpZnQtcHJvYmUgZmFpbHVyZXMgYXJlIGxvZ2dlZCBhbmQgZGVncmFkZSB0byBudWxsIC8gdGhlIHBsYWluIGJsb2NrOyB0aGV5XG4gKiBuZXZlciB0aHJvdy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN1cmZhY2VPdmVybGFwcGluZ1NwYW5zKFxuICBkZXBzOiBTdXJmYWNlRGVwcyxcbiAgcmVwb1Jvb3Q6IHN0cmluZyxcbiAgcmVwb1JlbFBhdGg6IHN0cmluZyxcbiAgcmFuZ2U6IExpbmVSYW5nZSxcbiAgc2Vzc2lvbklkOiBzdHJpbmdcbik6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCB7IGV4ZWN1dG9yLCBkcmlmdEV4ZWN1dG9yLCBtZW1vLCBsb2FkUnVsZXMsIGxvZ2dlciB9ID0gZGVwcztcblxuICAvLyBGaWx0ZXIgcGFzczogZ2l0IHNwYW4gbGlzdCA8cGF0aD4gLS1wb3JjZWxhaW5cbiAgbGV0IHBvcmNlbGFpblN0ZG91dDogc3RyaW5nO1xuICB0cnkge1xuICAgIHBvcmNlbGFpblN0ZG91dCA9IGV4ZWN1dG9yKFsnLS1wb3JjZWxhaW4nLCByZXBvUmVsUGF0aF0sIHJlcG9Sb290KTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nZ2VyLndhcm4oJ2dpdCBzcGFuIGxpc3QgLS1wb3JjZWxhaW4gZmFpbGVkJywgeyBlcnIgfSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICAvLyBQYXRoLXNjb3BlZCBzdXBwcmVzc2lvbjogYSByZXBvJ3MgLnNwYW4vLmhvb2tpZ25vcmUgY2FuIGhvbGQgYmFjayBzcGFuIHNsdWdcbiAgLy8gcHJlZml4ZXMgZm9yIGFuY2hvcnMgdW5kZXIgZ2l2ZW4gcGF0aHMuIEEgc3VwcHJlc3NlZCBzcGFuIGlzIG5ldmVyIHN1cmZhY2VkLlxuICBjb25zdCBpZ25vcmVSdWxlcyA9IGxvYWRSdWxlcyhyZXBvUm9vdCk7XG5cbiAgY29uc3Qgcm93czogUG9yY2VsYWluUm93W10gPSBwYXJzZVBvcmNlbGFpbihwb3JjZWxhaW5TdGRvdXQpO1xuICBjb25zdCBjYW5kaWRhdGVOYW1lcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgaWYgKHJvdy5wYXRoICE9PSByZXBvUmVsUGF0aCkgY29udGludWU7XG4gICAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSBjb250aW51ZTsgLy8gd2hvbGUtZmlsZSBhbmNob3JcbiAgICBpZiAoIXJhbmdlc0ludGVyc2VjdChyYW5nZSwgeyBzdGFydDogcm93LnN0YXJ0LCBlbmQ6IHJvdy5lbmQgfSkpIGNvbnRpbnVlO1xuICAgIGlmIChpc1NwYW5TdXBwcmVzc2VkKGlnbm9yZVJ1bGVzLCByb3cucGF0aCwgcm93Lm5hbWUpKSBjb250aW51ZTtcbiAgICBjYW5kaWRhdGVOYW1lcy5hZGQocm93Lm5hbWUpO1xuICB9XG5cbiAgaWYgKGNhbmRpZGF0ZU5hbWVzLnNpemUgPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIFN1YnRyYWN0IGFscmVhZHktc3VyZmFjZWQgbmFtZXNcbiAgY29uc3Qgc3VyZmFjZWQgPSBtZW1vLmdldFN1cmZhY2VkKHNlc3Npb25JZCk7XG4gIGNvbnN0IHRvU3VyZmFjZSA9IFsuLi5jYW5kaWRhdGVOYW1lc10uZmlsdGVyKChuKSA9PiAhc3VyZmFjZWQuaGFzKG4pKS5zb3J0KCk7XG4gIGlmICh0b1N1cmZhY2UubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAvLyBSZW5kZXIgcGFzczogZ2l0IHNwYW4gbGlzdCA8bmFtZTE+IDxuYW1lMj4gLi4uXG4gIGxldCByZW5kZXJTdGRvdXQ6IHN0cmluZztcbiAgdHJ5IHtcbiAgICByZW5kZXJTdGRvdXQgPSBleGVjdXRvcih0b1N1cmZhY2UsIHJlcG9Sb290KTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nZ2VyLndhcm4oJ2dpdCBzcGFuIGxpc3QgKHJlbmRlcikgZmFpbGVkJywgeyBlcnIgfSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICAvLyBPZiB0aGUgc3BhbnMgYmVpbmcgc3VyZmFjZWQsIGZsYWcgYW55IGFscmVhZHkgZHJpZnRlZCBcdTIwMTQgdGhlIHRvdWNoZWQgbGluZXMgaGF2ZVxuICAvLyBkcmlmdGVkIGZyb20gdGhlaXIgYW5jaG9yZWQgc3RhdGUgXHUyMDE0IHdpdGggYSBgZ2l0IHNwYW4gaGlzdG9yeSA8bmFtZT5gIHBvaW50ZXIuXG4gIC8vIERldGVjdGlvbiBpcyBhcy1vZi1ub3cgKHN1cmZhY2luZyBydW5zIGJlZm9yZSB0aGUgZWRpdCBhcHBsaWVzKSwgc28gdGhpc1xuICAvLyBjYXRjaGVzIHByZS1leGlzdGluZyBkcmlmdDsgZHJpZnQgdGhpcyBzZXNzaW9uIGNhdXNlcyBpcyB0aGUgU3RvcCBob29rJ3Mgam9iLlxuICAvLyBGYWlsdXJlIHRvIGNvbXB1dGUgZHJpZnQgaXMgbm9uLWZhdGFsOiBmYWxsIGJhY2sgdG8gdGhlIHBsYWluIGJsb2NrLlxuICBsZXQgZHJpZnRIaW50ID0gJyc7XG4gIHRyeSB7XG4gICAgY29uc3QgZHJpZnROYW1lcyA9IG5ldyBTZXQocGFyc2VEcmlmdFBvcmNlbGFpbihkcmlmdEV4ZWN1dG9yKHRvU3VyZmFjZSwgcmVwb1Jvb3QpKS5tYXAoKHIpID0+IHIubmFtZSkpO1xuICAgIGNvbnN0IGRyaWZ0U3VyZmFjZWQgPSB0b1N1cmZhY2UuZmlsdGVyKChuKSA9PiBkcmlmdE5hbWVzLmhhcyhuKSk7XG4gICAgaWYgKGRyaWZ0U3VyZmFjZWQubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgbGluZXMgPSBkcmlmdFN1cmZhY2VkLm1hcCgobikgPT4gYCAgZ2l0IHNwYW4gaGlzdG9yeSAke259YCkuam9pbignXFxuJyk7XG4gICAgICBkcmlmdEhpbnQgPSBgXFxuRHJpZnQgXHUyMDE0IHRoZSBsaW5lcyB5b3UncmUgdG91Y2hpbmcgaGF2ZSBkcmlmdGVkIGZyb20gdGhlc2Ugc3BhbnMnIGFuY2hvcmVkIHN0YXRlLiBSZXZpZXcgaG93IGVhY2ggc3Vic3lzdGVtIGV2b2x2ZWQgYmVmb3JlIGNoYW5naW5nIGl0OlxcbiR7bGluZXN9YDtcbiAgICB9XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZ2dlci53YXJuKCdnaXQgc3BhbiBkcmlmdCAoaGlzdG9yeSBoaW50KSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgfVxuXG4gIGNvbnN0IHdyYXBwZWQgPSBgXFxuPGdpdC1zcGFuPlxcbiR7cmVuZGVyU3Rkb3V0fSR7ZHJpZnRIaW50fVxcbjwvZ2l0LXNwYW4+XFxuYDtcblxuICAvLyBVcGRhdGUgbWVtb1xuICBtZW1vLmFkZFN1cmZhY2VkKHNlc3Npb25JZCwgdG9TdXJmYWNlKTtcblxuICByZXR1cm4gd3JhcHBlZDtcbn1cbiIsICIvKipcbiAqIFBhdGgtc2NvcGVkIHNwYW4gc3VwcHJlc3Npb24gZm9yIHRoZSBhZ2VudCBob29rcy5cbiAqXG4gKiBTb21lIHNwYW5zIGFyZSBub2lzZSB3aGVuIGJyb3dzaW5nIGNlcnRhaW4gcGFydHMgb2YgdGhlIHRyZWUgXHUyMDE0IHdpa2kgb3JcbiAqIG1hcmtldGluZyBzcGFucyB0aGF0IGFuY2hvciBwcm9zZSwgc3VyZmFjZWQgaW5saW5lIHdoaWxlIHJlYWRpbmcgc291cmNlLFxuICogYWRkIGxpdHRsZS4gVGhpcyBtb2R1bGUgbGV0cyBhIHJlcG8gZGVjbGFyZSwgcGVyIHBhdGgsIHdoaWNoIHNwYW4gc2x1Z1xuICogcHJlZml4ZXMgdG8gaG9sZCBiYWNrLlxuICpcbiAqIENvbmZpZyBsaXZlcyBhdCBgPHJlcG9Sb290Pi8uc3Bhbi8uaG9va2lnbm9yZWAuIEVhY2ggbm9uLWNvbW1lbnQgbGluZSBpcyBhXG4gKiBnaXRpZ25vcmUtc3R5bGUgcGF0aCBwYXR0ZXJuLCBhIHNpbmdsZSBydW4gb2Ygd2hpdGVzcGFjZSwgdGhlbiBhXG4gKiBjb21tYS1zZXBhcmF0ZWQgbGlzdCBvZiBzcGFuIHNsdWcgcHJlZml4ZXMgdG8gc3VwcHJlc3MgZm9yIHBhdGhzIHRoZSBwYXR0ZXJuXG4gKiBtYXRjaGVzOlxuICpcbiAqICAgcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjIHdpa2ksbWFya2V0aW5nXG4gKlxuICogQSBzcGFuIHdob3NlIHNsdWcgYmVnaW5zIHdpdGggYHdpa2lgIG9yIGBtYXJrZXRpbmdgICh0aGUgc2x1ZyBlcXVhbHMgdGhlXG4gKiBwcmVmaXgsIG9yIGlzIGA8cHJlZml4Pi9cdTIwMjZgKSBpcyB0aGVuIG5ldmVyIHN1cmZhY2VkIGZvciBhbiBhbmNob3Igd2hvc2UgcGF0aFxuICogc2l0cyB1bmRlciBgcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjYCBcdTIwMTQgaXQgaXMgbmV2ZXIgc3VyZmFjZWQgaW4gdGhlIGlubGluZVxuICogYDxnaXQtc3Bhbj5gIGJsb2NrIHRoZSBgUG9zdFRvb2xVc2VgIHRvdWNoIGhvb2sgZW1pdHMuIEl0IGhhcyBubyBlZmZlY3Qgb25cbiAqIHRoZSBgUHJlVG9vbFVzZWAgYWR2aXNvciwgd2hvc2Ugb3duIHVuY292ZXJlZC13cml0ZXMgc3VwcHJlc3Npb24gbGl2ZXMgaW5cbiAqIGAuc3Bhbi8uYWR2aXNvcmlnbm9yZWAgKHNlZSBgYWR2aXNvci1pZ25vcmUudHNgKS5cbiAqXG4gKiBQYXR0ZXJuIGdyYW1tYXIgaXMgYSBkZWxpYmVyYXRlIHN1YnNldCBvZiBnaXRpZ25vcmU6XG4gKlxuICogLSBCbGFuayBsaW5lcyBhbmQgbGluZXMgYmVnaW5uaW5nIHdpdGggYCNgIGFyZSBza2lwcGVkLlxuICogLSBBIHRyYWlsaW5nIGAvYCByZXN0cmljdHMgdGhlIHBhdHRlcm4gdG8gZGlyZWN0b3JpZXMgKHRoZSBsZWFmIGZpbGUgaXMgbm90XG4gKiAgIGl0c2VsZiB0ZXN0ZWQsIG9ubHkgaXRzIGFuY2VzdG9yIGRpcmVjdG9yaWVzKS5cbiAqIC0gQSBwYXR0ZXJuIGNvbnRhaW5pbmcgYSBzbGFzaCBpcyBhbmNob3JlZCB0byB0aGUgcmVwbyByb290OyBhIHBhdHRlcm4gd2l0aFxuICogICBubyBzbGFzaCBtYXRjaGVzIGEgc2luZ2xlIHBhdGggY29tcG9uZW50IGF0IGFueSBkZXB0aC5cbiAqIC0gYCpgIGFuZCBgP2AgbWF0Y2ggd2l0aGluIG9uZSBwYXRoIHNlZ21lbnQ7IGAqKmAgbWF0Y2hlcyBhY3Jvc3Mgc2VnbWVudHMuXG4gKiAtIE5lZ2F0aW9uIChgIWApIGlzIG5vdCBzdXBwb3J0ZWQuXG4gKlxuICogU3VwcHJlc3Npb24gaXMgZmFpbC1vcGVuOiBhIG1pc3Npbmcgb3IgdW5yZWFkYWJsZSBgLmhvb2tpZ25vcmVgLCBvciBhXG4gKiBtYWxmb3JtZWQgbGluZSwgeWllbGRzIG5vIHJ1bGUgcmF0aGVyIHRoYW4gaGlkaW5nIHNwYW5zIHRoZSBhdXRob3IgZGlkIG5vdFxuICogYXNrIHRvIGhpZGUuXG4gKi9cblxuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuXG5leHBvcnQgaW50ZXJmYWNlIElnbm9yZVJ1bGUge1xuICAvKiogVGhlIHJhdyBnaXRpZ25vcmUtc3R5bGUgcGF0dGVybiwgcmV0YWluZWQgZm9yIGRpYWdub3N0aWNzLiAqL1xuICBwYXR0ZXJuOiBzdHJpbmc7XG4gIC8qKiBTcGFuIHNsdWcgcHJlZml4ZXMgc3VwcHJlc3NlZCBmb3IgcGF0aHMgdGhpcyBydWxlIG1hdGNoZXMuICovXG4gIHByZWZpeGVzOiBzdHJpbmdbXTtcbiAgLyoqIFRydWUgd2hlbiBgcmVwb1JlbFBhdGhgIChQT1NJWCwgcmVwby1yZWxhdGl2ZSkgaXMgZ292ZXJuZWQgYnkgdGhpcyBydWxlLiAqL1xuICBtYXRjaGVzOiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4gYm9vbGVhbjtcbn1cblxuY29uc3QgSE9PS19JR05PUkVfUkVMID0gbm9kZVBhdGguam9pbignLnNwYW4nLCAnLmhvb2tpZ25vcmUnKTtcblxuLyoqXG4gKiBUcmFuc2xhdGUgb25lIGdpdGlnbm9yZS1zdHlsZSBnbG9iIHNlZ21lbnQgaW50byBhbiBhbmNob3JlZCBSZWdFeHAuIGAqYCBhbmRcbiAqIGA/YCBzdGF5IHdpdGhpbiBhIHBhdGggc2VnbWVudDsgYCoqYCAob3B0aW9uYWxseSBmb2xsb3dlZCBieSBgL2ApIHNwYW5zIHRoZW0uXG4gKi9cbmZ1bmN0aW9uIGdsb2JUb1JlZ0V4cChnbG9iOiBzdHJpbmcpOiBSZWdFeHAge1xuICBsZXQgcmUgPSAnJztcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBnbG9iLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYyA9IGdsb2JbaV07XG4gICAgaWYgKGMgPT09ICcqJykge1xuICAgICAgaWYgKGdsb2JbaSArIDFdID09PSAnKicpIHtcbiAgICAgICAgcmUgKz0gJy4qJztcbiAgICAgICAgaSsrO1xuICAgICAgICAvLyBBYnNvcmIgYSBmb2xsb3dpbmcgc2xhc2ggc28gYCoqL2Zvb2AgZG9lcyBub3QgZGVtYW5kIGEgbGl0ZXJhbCBgL2AuXG4gICAgICAgIGlmIChnbG9iW2kgKyAxXSA9PT0gJy8nKSBpKys7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZSArPSAnW14vXSonO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoYyA9PT0gJz8nKSB7XG4gICAgICByZSArPSAnW14vXSc7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlICs9IGMucmVwbGFjZSgvWy4rXiR7fSgpfFtcXF1cXFxcXS9nLCAnXFxcXCQmJyk7XG4gICAgfVxuICB9XG4gIHJldHVybiBuZXcgUmVnRXhwKGBeJHtyZX0kYCk7XG59XG5cbi8qKiBBbmNlc3RvciBwYXRoIGNoYWluOiBgYS9iL2MudHNgIFx1MjE5MiBgWydhJywgJ2EvYicsICdhL2IvYy50cyddYC4gKi9cbmZ1bmN0aW9uIGFuY2VzdG9yUGF0aHMocGF0aDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBwYXJ0cyA9IHBhdGguc3BsaXQoJy8nKTtcbiAgY29uc3Qgb3V0OiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgb3V0LnB1c2gocGFydHMuc2xpY2UoMCwgaSArIDEpLmpvaW4oJy8nKSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBDb21waWxlIGEgc2luZ2xlIGdpdGlnbm9yZS1zdHlsZSBwYXR0ZXJuICh0aGlzIG1vZHVsZSdzIGdyYW1tYXIgXHUyMDE0IHNlZSB0aGVcbiAqIG1vZHVsZSBkb2MgY29tbWVudCkgaW50byBhIHBhdGggcHJlZGljYXRlLiBBIHBhdHRlcm4gbWF0Y2hlcyBhIGZpbGUgd2hlbiBpdFxuICogbWF0Y2hlcyB0aGUgZmlsZSdzIHBhdGggb3IgYW55IGFuY2VzdG9yIGRpcmVjdG9yeSBvZiBpdCwgc28gYSBkaXJlY3RvcnlcbiAqIHBhdHRlcm4gc3VwcHJlc3NlcyBldmVyeXRoaW5nIGJlbmVhdGggaXQuXG4gKlxuICogRXhwb3J0ZWQgc28gb3RoZXIgcGF0aC1zY29wZWQgaWdub3JlLWZpbGUgY29udmVudGlvbnMgKGUuZy4gYC5hZHZpc29yaWdub3JlYFxuICogaW4gYGFkdmlzb3ItaWdub3JlLnRzYCkgY2FuIHJldXNlIHRoZSBleGFjdCBtYXRjaGluZyBzZW1hbnRpY3MgcmF0aGVyIHRoYW5cbiAqIHJlaW1wbGVtZW50aW5nIHRoZW0uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21waWxlUGF0dGVybihwYXR0ZXJuOiBzdHJpbmcpOiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4gYm9vbGVhbiB7XG4gIGxldCBwYXQgPSBwYXR0ZXJuO1xuICBsZXQgZGlyT25seSA9IGZhbHNlO1xuICBpZiAocGF0LmVuZHNXaXRoKCcvJykpIHtcbiAgICBkaXJPbmx5ID0gdHJ1ZTtcbiAgICBwYXQgPSBwYXQuc2xpY2UoMCwgLTEpO1xuICB9XG4gIGxldCBhbmNob3JlZCA9IHBhdC5pbmNsdWRlcygnLycpO1xuICBpZiAocGF0LnN0YXJ0c1dpdGgoJy8nKSkge1xuICAgIGFuY2hvcmVkID0gdHJ1ZTtcbiAgICBwYXQgPSBwYXQuc2xpY2UoMSk7XG4gIH1cbiAgY29uc3QgcmUgPSBnbG9iVG9SZWdFeHAocGF0KTtcblxuICByZXR1cm4gKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IHtcbiAgICBpZiAoYW5jaG9yZWQpIHtcbiAgICAgIGNvbnN0IHNlZ3MgPSBhbmNlc3RvclBhdGhzKHJlcG9SZWxQYXRoKTtcbiAgICAgIC8vIEZvciBhIGRpci1vbmx5IHBhdHRlcm4sIG5ldmVyIHRlc3QgdGhlIGxlYWYgZmlsZSBpdHNlbGYuXG4gICAgICBjb25zdCBjYW5kaWRhdGVzID0gZGlyT25seSA/IHNlZ3Muc2xpY2UoMCwgLTEpIDogc2VncztcbiAgICAgIHJldHVybiBjYW5kaWRhdGVzLnNvbWUoKHMpID0+IHJlLnRlc3QocykpO1xuICAgIH1cbiAgICAvLyBVbmFuY2hvcmVkOiBtYXRjaCBhZ2FpbnN0IGluZGl2aWR1YWwgcGF0aCBjb21wb25lbnRzIGF0IGFueSBkZXB0aC5cbiAgICBjb25zdCBjb21wb25lbnRzID0gcmVwb1JlbFBhdGguc3BsaXQoJy8nKTtcbiAgICBjb25zdCBjYW5kaWRhdGVzID0gZGlyT25seSA/IGNvbXBvbmVudHMuc2xpY2UoMCwgLTEpIDogY29tcG9uZW50cztcbiAgICByZXR1cm4gY2FuZGlkYXRlcy5zb21lKChjKSA9PiByZS50ZXN0KGMpKTtcbiAgfTtcbn1cblxuLyoqIFBhcnNlIGAuaG9va2lnbm9yZWAgdGV4dCBpbnRvIHJ1bGVzLCBza2lwcGluZyBjb21tZW50cyBhbmQgbWFsZm9ybWVkIGxpbmVzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlSG9va0lnbm9yZShjb250ZW50OiBzdHJpbmcpOiBJZ25vcmVSdWxlW10ge1xuICBjb25zdCBydWxlczogSWdub3JlUnVsZVtdID0gW107XG4gIGZvciAoY29uc3QgcmF3TGluZSBvZiBjb250ZW50LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IGxpbmUgPSByYXdMaW5lLnRyaW0oKTtcbiAgICBpZiAoIWxpbmUgfHwgbGluZS5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIC8vIGA8cGF0dGVybj48d2hpdGVzcGFjZT48cHJlZml4ZXM+YCBcdTIwMTQgcGF0dGVybiBpcyB0aGUgZmlyc3QgdG9rZW4sIHByZWZpeGVzXG4gICAgLy8gdGhlIHNlY29uZC4gQSBsaW5lIHdpdGhvdXQgYm90aCBpcyBtYWxmb3JtZWQgYW5kIHNraXBwZWQuXG4gICAgY29uc3QgbWF0Y2ggPSBsaW5lLm1hdGNoKC9eKFxcUyspXFxzKyhcXFMrKSQvKTtcbiAgICBpZiAoIW1hdGNoKSBjb250aW51ZTtcbiAgICBjb25zdCBbLCBwYXR0ZXJuLCBwcmVmaXhlc1Jhd10gPSBtYXRjaDtcbiAgICBjb25zdCBwcmVmaXhlcyA9IHByZWZpeGVzUmF3XG4gICAgICAuc3BsaXQoJywnKVxuICAgICAgLm1hcCgocCkgPT4gcC50cmltKCkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgIGlmIChwcmVmaXhlcy5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgIHJ1bGVzLnB1c2goeyBwYXR0ZXJuLCBwcmVmaXhlcywgbWF0Y2hlczogY29tcGlsZVBhdHRlcm4ocGF0dGVybikgfSk7XG4gIH1cbiAgcmV0dXJuIHJ1bGVzO1xufVxuXG4vKipcbiAqIExvYWQgdGhlIHN1cHByZXNzaW9uIHJ1bGVzIGZvciBhIHJlcG8uIEZhaWwtb3BlbjogYW55IHJlYWQgb3IgcGFyc2UgZmFpbHVyZVxuICogeWllbGRzIGFuIGVtcHR5IHJ1bGUgc2V0LCBzbyBzcGFucyBzdXJmYWNlIGFzIG5vcm1hbCB3aGVuIG5vIGNvbmZpZyBleGlzdHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsb2FkSG9va0lnbm9yZShyZXBvUm9vdDogc3RyaW5nKTogSWdub3JlUnVsZVtdIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKG5vZGVQYXRoLmpvaW4ocmVwb1Jvb3QsIEhPT0tfSUdOT1JFX1JFTCksICd1dGY4Jyk7XG4gICAgcmV0dXJuIHBhcnNlSG9va0lnbm9yZShjb250ZW50KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG59XG5cbi8qKiBBIHNsdWcgY2FycmllcyBhIHByZWZpeCB3aGVuIGl0IGVxdWFscyB0aGUgcHJlZml4IG9yIGlzIGA8cHJlZml4Pi9cdTIwMjZgLiAqL1xuZnVuY3Rpb24gc2x1Z0hhc1ByZWZpeChzbHVnOiBzdHJpbmcsIHByZWZpeDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBzbHVnID09PSBwcmVmaXggfHwgc2x1Zy5zdGFydHNXaXRoKGAke3ByZWZpeH0vYCk7XG59XG5cbi8qKlxuICogVHJ1ZSB3aGVuIGEgc3BhbiBgc2x1Z2Agc2hvdWxkIGJlIHN1cHByZXNzZWQgZm9yIGFuIGFuY2hvciBhdCBgcmVwb1JlbFBhdGhgOlxuICogc29tZSBydWxlIG1hdGNoZXMgdGhlIHBhdGggYW5kIGxpc3RzIGEgcHJlZml4IHRoZSBzbHVnIGNhcnJpZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1NwYW5TdXBwcmVzc2VkKHJ1bGVzOiBJZ25vcmVSdWxlW10sIHJlcG9SZWxQYXRoOiBzdHJpbmcsIHNsdWc6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IHJ1bGUgb2YgcnVsZXMpIHtcbiAgICBpZiAoIXJ1bGUubWF0Y2hlcyhyZXBvUmVsUGF0aCkpIGNvbnRpbnVlO1xuICAgIGlmIChydWxlLnByZWZpeGVzLnNvbWUoKHApID0+IHNsdWdIYXNQcmVmaXgoc2x1ZywgcCkpKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBTaWduYXR1cmUgZm9yIGluamVjdGluZyBhIHJ1bGUgbG9hZGVyIChwcm9kdWN0aW9uIGRlZmF1bHQ6IHtAbGluayBsb2FkSG9va0lnbm9yZX0pLiAqL1xuZXhwb3J0IHR5cGUgSG9va0lnbm9yZUxvYWRlciA9IChyZXBvUm9vdDogc3RyaW5nKSA9PiBJZ25vcmVSdWxlW107XG4iLCAiLyoqXG4gKiBIYXJuZXNzLWFnbm9zdGljIHRvdWNoLWhvb2sgY29yZS5cbiAqXG4gKiBUaGlzIG1vZHVsZSBpbXBsZW1lbnRzIHRoZSBQb3N0VG9vbFVzZSBcInRvdWNoIHNpZ25hbFwiIHRoYXQgYm90aCB0aGUgQ2xhdWRlXG4gKiAoYFJlYWR8RWRpdHxXcml0ZWApIGFuZCBDb2RleCAoYGFwcGx5X3BhdGNoYCkgYWRhcHRlcnMgZHJpdmUuIEl0IGltcG9ydHNcbiAqIG5vdGhpbmcgZnJvbSBlaXRoZXIgaG9vayBTREsgYW5kIGlzIHR5cGVkIHN0cnVjdHVyYWxseSwgcGVyIHRoZSBgY29tbW9uL2BcbiAqIGxheWVyIGNvbnZlbnRpb246IGFkYXB0ZXJzIHRyYW5zbGF0ZSB0aGVpciBTREstc3BlY2lmaWMgaG9vayBpbnB1dCBpbnRvIGFcbiAqIHtAbGluayBUb3VjaElucHV0fSwgaW5qZWN0IGV4ZWN1dGlvbi9zdGF0ZSBkZXBlbmRlbmNpZXMsIGFuZCB3cmFwIHRoZSByZXR1cm5lZFxuICoge0BsaW5rIFRvdWNoT3V0cHV0fSBpbiB0aGVpciBvd24gb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogUmV1c2VkIGZyb20gdGhlIHNoYXJlZCBrZXJuZWwgKG5vdCByZWRlZmluZWQpOiBgaXNEZWJ0KClgICtcbiAqIGBQb3JjZWxhaW5TdGF0dXNgL2BEcmlmdFBvcmNlbGFpblJvd2AvYFBvcmNlbGFpblJvd2AvYHBhcnNlUG9yY2VsYWluYC9cbiAqIGBwYXJzZURyaWZ0UG9yY2VsYWluYCAoYWdlbnQtaG9va3MtY29tbW9uLnRzKSwgYHJhbmdlc0ludGVyc2VjdGAgYW5kIHRoZVxuICogcmVwby9zcGFuLXJvb3QgcGF0aCB1dGlsaXRpZXMgKGFnZW50LWhvb2tzLWNvbW1vbi50cyksIGFuZCB0aGUgYE1lbW9TdG9yZWBcbiAqIGNhZGVuY2Ugc3RvcmUgKHNwYW4tc3VyZmFjZS50cykuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0IHsgYmFzZW5hbWUsIGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHtcbiAgdHlwZSBEcmlmdFBvcmNlbGFpblJvdyxcbiAgaHVtYW5TdGF0dXNMYWJlbCxcbiAgaXNEZWJ0LFxuICB0eXBlIExpbmVSYW5nZSxcbiAgdHlwZSBQb3JjZWxhaW5Sb3csXG4gIHR5cGUgUG9yY2VsYWluU3RhdHVzLFxuICBwYXJzZURyaWZ0UG9yY2VsYWluLFxuICBwYXJzZVBvcmNlbGFpbixcbiAgcmFuZ2VzSW50ZXJzZWN0LFxuICByZWxhdGl2ZVRvUmVwbyxcbiAgcmVzb2x2ZVJlcG9Sb290LFxuICByZXNvbHZlU3BhblJvb3Rcbn0gZnJvbSAnLi9hZ2VudC1ob29rcy1jb21tb24uanMnO1xuaW1wb3J0IHsgY29sbGFwc2VCeVBhdGgsIHR5cGUgUmFuZ2VMYWJlbCwgcmVuZGVyQW5jaG9yVHJlZSB9IGZyb20gJy4vYW5jaG9yLXRyZWUuanMnO1xuaW1wb3J0IHR5cGUgeyBNZW1vU3RvcmUgfSBmcm9tICcuL3NwYW4tc3VyZmFjZS5qcyc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUG9zdC1lZGl0IHJhbmdlIHJlY292ZXJ5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBTcGxpdCB3cml0dGVuIGNvbnRlbnQgaW50byB0aGUgbGluZXMgdG8gbG9jYXRlIG9uIGRpc2suIEEgc2luZ2xlIHRyYWlsaW5nXG4gKiBuZXdsaW5lIGlzIGRyb3BwZWQgc28gYFwiYVxcbmJcXG5cImAgYW5kIGBcImFcXG5iXCJgIGxvY2F0ZSBpZGVudGljYWxseTsgYW4gZW1wdHlcbiAqIChvciBuZXdsaW5lLW9ubHkpIHdyaXRlIGhhcyBubyBsb2NhdGFibGUgYmxvY2suXG4gKi9cbmZ1bmN0aW9uIHRvTmVlZGxlTGluZXMod3JpdHRlbjogc3RyaW5nKTogc3RyaW5nW10ge1xuICBpZiAod3JpdHRlbi5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgY29uc3QgdHJpbW1lZCA9IHdyaXR0ZW4uZW5kc1dpdGgoJ1xcbicpID8gd3JpdHRlbi5zbGljZSgwLCAtMSkgOiB3cml0dGVuO1xuICBpZiAodHJpbW1lZC5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgcmV0dXJuIHRyaW1tZWQuc3BsaXQoJ1xcbicpO1xufVxuXG4vKipcbiAqIFJlY292ZXIgdGhlIGxpbmUgcmFuZ2UgdGhhdCB3cml0dGVuIGNvbnRlbnQgbm93IG9jY3VwaWVzIGluIHRoZSBvbi1kaXNrIGZpbGUsXG4gKiBmb3IgYW5jaG9yaW5nIHRoZSB0b3VjaGVkIHJlZ2lvbiBhZnRlciBhbiBlZGl0IGhhcyBhbHJlYWR5IGFwcGxpZWQuXG4gKlxuICogVGhpcyBnZW5lcmFsaXplcyB0aGUgcHJlLWVkaXQgYGxvY2F0ZUNodW5rKClgIHRlY2huaXF1ZSBpblxuICogW2FwcGx5LXBhdGNoLnRzXSguL3BhY2thZ2VzL2FnZW50LWhvb2tzL3NyYy9jb2RleC9hcHBseS1wYXRjaC50cyNMMjUzLUwyODYpXG4gKiAocHJldmlvdXNseSBDb2RleC1vbmx5KSBpbnRvIGEgc2hhcmVkIHBvc3QtZWRpdCBwcmltaXRpdmUgYm90aCBoYXJuZXNzZXMgdXNlOlxuICogc3BsaXQgYHdyaXR0ZW5gIGFuZCBgb25EaXNrQ29udGVudGAgaW50byBsaW5lcyBhbmQgbG9jYXRlIHRoZSB3cml0dGVuIGJsb2NrIGFzXG4gKiBhIGNvbnRpZ3VvdXMgcnVuIGluc2lkZSB0aGUgb24tZGlzayBsaW5lcy5cbiAqXG4gKiAtIEEgc2luZ2xlIGNvbnRpZ3VvdXMgbWF0Y2ggeWllbGRzIGl0cyAxLWJhc2VkIGluY2x1c2l2ZSB7QGxpbmsgTGluZVJhbmdlfS5cbiAqIC0gV2hlbiB0aGUgYmxvY2sgaXMgYWJzZW50LCBvciBhcHBlYXJzIG1vcmUgdGhhbiBvbmNlIChjb250ZXh0IHRvIGRpc2FtYmlndWF0ZVxuICogICBpcyBub3QgYXZhaWxhYmxlIHBvc3QtZWRpdCksIHJlY292ZXJ5IGlzIGFtYmlndW91cyBhbmQgdGhlIHJlc3VsdCBkZWdyYWRlc1xuICogICB0byBgJ3dob2xlLWZpbGUnYCAodGhlIHNhbWUgZmFsbGJhY2sgYGxvY2F0ZUNodW5rKClgIHNpZ25hbHMgd2l0aCBgbnVsbGApLlxuICpcbiAqIE5ldmVyIHRocm93czogYW4gdW5sb2NhdGFibGUgd3JpdGUgaXMgYSBgJ3dob2xlLWZpbGUnYCBhbnN3ZXIsIG5vdCBhbiBlcnJvci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY292ZXJSYW5nZSh3cml0dGVuOiBzdHJpbmcsIG9uRGlza0NvbnRlbnQ6IHN0cmluZyk6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyB7XG4gIGNvbnN0IG5lZWRsZSA9IHRvTmVlZGxlTGluZXMod3JpdHRlbik7XG4gIGlmIChuZWVkbGUubGVuZ3RoID09PSAwKSByZXR1cm4gJ3dob2xlLWZpbGUnO1xuXG4gIGNvbnN0IGhheXN0YWNrID0gb25EaXNrQ29udGVudC5zcGxpdCgnXFxuJyk7XG4gIGNvbnN0IGxhc3QgPSBoYXlzdGFjay5sZW5ndGggLSBuZWVkbGUubGVuZ3RoO1xuICBjb25zdCBzdGFydHM6IG51bWJlcltdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDw9IGxhc3Q7IGkrKykge1xuICAgIGxldCBvayA9IHRydWU7XG4gICAgZm9yIChsZXQgaiA9IDA7IGogPCBuZWVkbGUubGVuZ3RoOyBqKyspIHtcbiAgICAgIGlmIChoYXlzdGFja1tpICsgal0gIT09IG5lZWRsZVtqXSkge1xuICAgICAgICBvayA9IGZhbHNlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKG9rKSB7XG4gICAgICBzdGFydHMucHVzaChpKTtcbiAgICAgIGlmIChzdGFydHMubGVuZ3RoID4gMSkgYnJlYWs7IC8vIGR1cGxpY2F0ZWQgXHUyMTkyIGFtYmlndW91cywgc3RvcCBlYXJseVxuICAgIH1cbiAgfVxuXG4gIGlmIChzdGFydHMubGVuZ3RoID09PSAxKSB7XG4gICAgcmV0dXJuIHsgc3RhcnQ6IHN0YXJ0c1swXSArIDEsIGVuZDogc3RhcnRzWzBdICsgbmVlZGxlLmxlbmd0aCB9O1xuICB9XG4gIHJldHVybiAnd2hvbGUtZmlsZSc7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggaW5wdXRcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFdoaWNoIGhhcm5lc3MgZXZlbnQgZmlyZWQsIGFzIHRoZSB0b3VjaCBjb3JlIHNlZXMgaXQuIFRoZSBjb3JlIGJyYW5jaGVzIG9uXG4gKiB0aGlzOiBgd3JpdGVgIGhlYWxzIHBvc2l0aW9uYWwgZHJpZnQgaW4gdGhlIHdvcmtpbmcgdHJlZSBhbmQgbWF5IHN1cmZhY2UgYVxuICogbWVyZ2VkIGJsb2NrOyBgcmVhZGAgbmV2ZXIgbXV0YXRlcyB0aGUgdHJlZSBhbmQgZmlsdGVycyBwb3NpdGlvbmFsIHN0YXR1c2VzXG4gKiBvdXQgb2Ygd2hhdCBpdCBzdXJmYWNlcy5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hFdmVudEtpbmQgPSAncmVhZCcgfCAnd3JpdGUnO1xuXG4vKiogRmllbGRzIHNoYXJlZCBieSBldmVyeSB0b3VjaCwgcmVnYXJkbGVzcyBvZiBraW5kLiAqL1xuaW50ZXJmYWNlIFRvdWNoSW5wdXRCYXNlIHtcbiAgLyoqIEhhcm5lc3Mgc2Vzc2lvbiBpZCBcdTIwMTQga2V5cyB0aGUgcGVyLXNlc3Npb24gY2FkZW5jZSB7QGxpbmsgTWVtb1N0b3JlfS4gKi9cbiAgc2Vzc2lvbklkOiBzdHJpbmc7XG4gIC8qKlxuICAgKiBXb3JraW5nIGRpcmVjdG9yeSB0aGUgdG9vbCByYW4gaW4sIHVzZWQgdG8gYm91bmQgdGhlIHRvdWNoIHRvIHRoZSBDV0QgcmVwb1xuICAgKiB2aWEgYHJlc29sdmVUb3VjaFNjb3BlKClgIGJlZm9yZSBhbnkgc3BhbiBpbnZvY2F0aW9uLlxuICAgKi9cbiAgY3dkOiBzdHJpbmc7XG4gIC8qKiBBYnNvbHV0ZSwgY2Fub25pY2FsaXplZCBwYXRoIG9mIHRoZSB0b3VjaGVkIGZpbGUuICovXG4gIGZpbGVQYXRoOiBzdHJpbmc7XG59XG5cbi8qKiBBIHJlYWQgdG91Y2ggKENsYXVkZSBgUmVhZGAsIG9yIGEgcmVhZC1zaGFwZWQgQ29kZXggZXZlbnQpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaFJlYWRJbnB1dCBleHRlbmRzIFRvdWNoSW5wdXRCYXNlIHtcbiAga2luZDogJ3JlYWQnO1xuICAvKipcbiAgICogMS1iYXNlZCBzdGFydGluZyBsaW5lIG9mIHRoZSByZWFkLCBmcm9tIHRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wncyBgb2Zmc2V0YFxuICAgKiBpbnB1dC4gYHVuZGVmaW5lZGAgd2hlbiB0aGUgcmVhZCBoYWQgbm8gYG9mZnNldGAgKHJlYWRzIGZyb20gbGluZSAxKS5cbiAgICovXG4gIG9mZnNldD86IG51bWJlcjtcbiAgLyoqXG4gICAqIExpbmUgY291bnQgb2YgdGhlIHJlYWQsIGZyb20gdGhlIENsYXVkZSBgUmVhZGAgdG9vbCdzIGBsaW1pdGAgaW5wdXQuXG4gICAqIGB1bmRlZmluZWRgIHdoZW4gdGhlIHJlYWQgaGFkIG5vIGBsaW1pdGAgXHUyMDE0IHNlZSB7QGxpbmsgREVGQVVMVF9SRUFEX0xJTUlUfVxuICAgKiBmb3IgaG93IHRoZSByYW5nZSBpcyBjb21wdXRlZCBpbiB0aGF0IGNhc2UuXG4gICAqL1xuICBsaW1pdD86IG51bWJlcjtcbn1cblxuLyoqIEEgd3JpdGUgdG91Y2ggKENsYXVkZSBgRWRpdGAvYFdyaXRlYCwgQ29kZXggYGFwcGx5X3BhdGNoYCwgb3IgYSB0cmFuc2xhdGVkIEJhc2ggd3JpdGUgc3BhbikuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoV3JpdGVJbnB1dCBleHRlbmRzIFRvdWNoSW5wdXRCYXNlIHtcbiAga2luZDogJ3dyaXRlJztcbiAgLyoqXG4gICAqIFRoZSBjb250ZW50IGp1c3Qgd3JpdHRlbiB0byBgZmlsZVBhdGhgLCBmZWQgdG8ge0BsaW5rIHJlY292ZXJSYW5nZX0gdG9cbiAgICogcmUtYW5jaG9yIHRoZSB0b3VjaGVkIHJlZ2lvbiBhZ2FpbnN0IHRoZSBoZWFsZWQgb24tZGlzayBmaWxlLiBGb3IgYVxuICAgKiB3aG9sZS1maWxlIGNyZWF0ZSB0aGlzIGlzIHRoZSBlbnRpcmUgZmlsZSBib2R5OyBhbiBlbXB0eSBzdHJpbmcgbWVhbnNcbiAgICogXCJubyBsb2NhdGFibGUgYmxvY2tcIiBhbmQgdGhlIHRvdWNoIGlzIHNjb3BlZCBmaWxlLXdpZGUuXG4gICAqL1xuICB3cml0dGVuOiBzdHJpbmc7XG4gIC8qKlxuICAgKiBFeGFjdCBwb3N0LWVkaXQgcmFuZ2Ugd2hlbiBzdGF0aWNhbGx5IGtub3duIChzZWQgLWkgbnVtZXJpYyBhZGRyZXNzZXMsXG4gICAqIHBhdGNoIGh1bmsgdW5pb25zKTsgYnlwYXNzZXMge0BsaW5rIHJlY292ZXJSYW5nZUZyb21EaXNrfSAocGxhbiBcdTAwQTczXG4gICAqIHN0ZXAgMykuXG4gICAqL1xuICByYW5nZT86IExpbmVSYW5nZTtcbiAgLyoqXG4gICAqIFRoZSBmaWxlJ3MgZXhwZWN0ZWQgcG9zdC1jb21tYW5kIHN0YXRlOyB0aGUgd3JpdGUgcGF0aCBnYXRlcyBvbiBpdCBiZWZvcmVcbiAgICogaW52b2tpbmcgYW55IGV4ZWN1dG9yIChwbGFuIFx1MDBBNzMgc3RlcCAxKS4gQWJzZW50IG1lYW5zIGAnZXhpc3RzJ2AgXHUyMDE0IHRoZVxuICAgKiBFZGl0L1dyaXRlIGFuZCBhcHBseV9wYXRjaCBwYXRocycgZGVmYXVsdC5cbiAgICovXG4gIHRhcmdldFN0YXRlPzogJ2V4aXN0cycgfCAnYWJzZW50JztcbiAgLyoqXG4gICAqIFN0YXRpY2FsbHkga25vd2FibGUgZXhwZWN0ZWQgcG9zdC1jb250ZW50LCB2ZXJpZmllZCBiZWZvcmUgYW55IGV4ZWN1dG9yXG4gICAqIGNhbGwgKHBsYW4gXHUwMEE3MyBzdGVwIDFiKS4gYGNvbnRlbnRgIGNvbXBhcmVzIHRoZSBvbi1kaXNrIHN0YXRlIGFmdGVyIHRoZVxuICAgKiBjb21tYW5kIHJhbjsgYHJlYWxEZWxldGVgIGlzIGRlbGV0ZS1vbmx5IFx1MjAxNCB0aGUgcGF0aCBtdXN0IGFsc28gYmVcbiAgICogaW5kZXgtdHJhY2tlZCBvciBzcGFubmVkIChwcm9iZXMgY2FjaGVkIHBlciBjb21tYW5kKS5cbiAgICovXG4gIHBvc3RTdGF0ZT86IHtcbiAgICAvKiogYGV4YWN0YDogZmlsZSBieXRlcyBlcXVhbDsgYHN1ZmZpeGA6IGZpbGUgY29udGVudCBlbmRzIHdpdGggaXQ7IGBlbXB0eWA6IHplcm8gYnl0ZXM7IGBzaXplYDogYnl0ZSBjb3VudC4gKi9cbiAgICBjb250ZW50PzogVG91Y2hQb3N0Q29udGVudDtcbiAgICAvKiogZGVsZXRlLW9ubHk6IHRoZSBwYXRoIG11c3QgYWxzbyBiZSBpbmRleC10cmFja2VkIG9yIHNwYW5uZWQgKHByb2JlcyBjYWNoZWQgcGVyIGNvbW1hbmQpLiAqL1xuICAgIHJlYWxEZWxldGU/OiBib29sZWFuO1xuICB9O1xuICAvKipcbiAgICogY3AvaW5zdGFsbCBkZXN0aW5hdGlvbi12cy1zb3VyY2UgdmVyaWZpY2F0aW9uIChwbGFuIFx1MDBBNzMgc3RlcCAxYik6IGFcbiAgICogc3RpbGwtcHJlc2VudCBzb3VyY2UgbXVzdCBieXRlLWVxdWFsIHRoZSBkZXN0aW5hdGlvbjsgYW4gYWJzZW50IHNvdXJjZVxuICAgKiBhcHBsaWVzIHRoZSBhYnNlbnQtc291cmNlIHJ1bGUgKHJlYWwgKyBhYnNlbmNlIGV4cGxhaW5lZCBieSBhIGxhdGVyXG4gICAqIHNhbWUtcGF0aCBkZWNpc2l2ZVBhc3MgXHUyMDE0IHRoZSBkcml2ZXIncyBwYXNzLUEgaG9sZCkuIFNldCBieSB0aGVcbiAgICogYHJ1bkJhc2hUb3VjaGVzYCBkcml2ZXIgb24gcGFpcmVkIGNwIGNyZWF0ZS1vdmVyd3JpdGUgdG91Y2hlczsgbmV2ZXIgc2V0XG4gICAqIGJ5IGFkYXB0ZXJzLiBgaW5zdGFsbCAtc2AvYC0tc3RyaXBgIGlzIGRlbGliZXJhdGVseSBuZXZlciBwYWlyZWQgXHUyMDE0XG4gICAqIHN0cmlwcGVkIG91dHB1dCBuZXZlciBlcXVhbHMgdGhlIHNvdXJjZSwgc28gaW5zdGFsbCBkZXN0cyBnYXRlXG4gICAqIGV4aXN0ZW5jZS1vbmx5LlxuICAgKi9cbiAgc291cmNlUGF0aD86IHN0cmluZztcbiAgLyoqXG4gICAqIG12L2dpdCBtdi9wYXRjaCByZW5hbWUgc291cmNlIHZlcmlmaWNhdGlvbiAocGxhbiBcdTAwQTczIHN0ZXAgMWMpOiB0aGVcbiAgICogZGVzdGluYXRpb24gZmlyZXMgb25seSB3aGVuIGl0cyBzb3VyY2UgcGFzc2VkIHRoZSBkZWxldGUtcmVhbGl0eSBwcm9iZSBcdTIwMTRcbiAgICogYSBwaGFudG9tIHNvdXJjZSBtZWFucyB0aGUgbW92ZSBmYWlsZWQgYW5kIGEgcHJlLWV4aXN0aW5nIGRlc3RpbmF0aW9uIHdhc1xuICAgKiBuZXZlciB0b3VjaGVkLiBObyBjb250ZW50IGNvbXBhcmlzb24gKHBhdGNoIHJlbmFtZXMgbWF5IGNoYW5nZSBjb250ZW50KS5cbiAgICogU2V0IGJ5IHRoZSBgcnVuQmFzaFRvdWNoZXNgIGRyaXZlciBvbiBwYWlyZWQgcmVuYW1lLWNvcHkgdG91Y2hlcy5cbiAgICovXG4gIHJlbmFtZVNvdXJjZVBhdGg/OiBzdHJpbmc7XG59XG5cbi8qKiBUaGUgaGFybmVzcy1hZ25vc3RpYyB0b3VjaCB0aGUgY29yZSBjb25zdW1lcy4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoSW5wdXQgPSBUb3VjaFJlYWRJbnB1dCB8IFRvdWNoV3JpdGVJbnB1dDtcblxuLyoqXG4gKiBBIHN0YXRpY2FsbHkga25vd2FibGUgZXhwZWN0ZWQgcG9zdC1jb250ZW50IChwbGFuIFx1MDBBNzMgc3RlcCAxYik6IGBleGFjdGAgXHUyMDE0XG4gKiBmaWxlIGJ5dGVzIGVxdWFsOyBgc3VmZml4YCBcdTIwMTQgZmlsZSBjb250ZW50IGVuZHMgd2l0aCBpdDsgYGVtcHR5YCBcdTIwMTQgemVyb1xuICogYnl0ZXM7IGBzaXplYCBcdTIwMTQgYnl0ZSBjb3VudC5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hQb3N0Q29udGVudCA9IHsgZXhhY3Q6IHN0cmluZyB9IHwgeyBzdWZmaXg6IHN0cmluZyB9IHwgeyBlbXB0eTogdHJ1ZSB9IHwgeyBzaXplOiBudW1iZXIgfTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQb3N0LXN0YXRlIHdyaXRlIGdhdGUgKHBsYW4gXHUwMEE3MyBzdGVwIDEpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBUaGUgb3V0Y29tZSBvZiB7QGxpbmsgZXZhbHVhdGVXcml0ZUdhdGV9OiBhIGRlY2lzaXZlIHBhc3MvZmFpbCBjYXJyaWVzXG4gKiB2ZXJkaWN0IHdlaWdodCAoY29udGVudCB2ZXJpZmllZCwgb3IgYWJzZW5jZSArIGRlbGV0ZS1yZWFsaXR5IHZlcmlmaWVkKTtcbiAqIGAnaW5jb25jbHVzaXZlJ2AgaXMgZXZlcnl0aGluZyBlbHNlIFx1MjAxNCB0aGUgZXhpc3RlbmNlLWdhdGVkIGZhbWlsaWVzIChzZWQgLWksXG4gKiBwYXRjaC9naXQgYXBwbHksIGZvcm1hdHRlcnMsIHJlc3RvcmUvY2hlY2tvdXQpIHdob3NlIGV4aXN0ZW5jZSBwYXNzIHByb3Zlc1xuICogbm90aGluZywgYW5kIHByb2JlLWluYXBwbGljYWJsZSBjYXNlcyAocGhhbnRvbSBvciB1bnRyYWNrZWQtdW5zcGFubmVkXG4gKiBkZWxldGVzLCBkaXJlY3RvcnkgdGFyZ2V0cykuIGAncGVuZGluZydgIGlzIHRoZSBkcml2ZXIncyBhYnNlbnQtc291cmNlIGhvbGRcbiAqIChwbGFuIFx1MDBBNzMgc3RlcCAyKTogYW4gYWJzZW50IGNwIHNvdXJjZSB0aGF0IHBhc3NlZCB0aGUgcmVhbGl0eSBwcm9iZSBjYW5ub3RcbiAqIGRlY2lkZSBpdHMgZGVzdGluYXRpb24gdW50aWwgdGhlIHBhc3MtQSBleHBsYW5hdGlvbiBtYXAgaXMgY29tcGxldGUuXG4gKi9cbmV4cG9ydCB0eXBlIFdyaXRlR2F0ZU91dGNvbWUgPSAnZGVjaXNpdmVQYXNzJyB8ICdkZWNpc2l2ZUZhaWwnIHwgJ2luY29uY2x1c2l2ZScgfCAncGVuZGluZyc7XG5cbi8qKlxuICogUGVyLWNvbW1hbmQgcmVhbGl0eSBwcm9iZSBjYWNoZSAocGxhbiBcdTAwQTczIHN0ZXAgMWMsIHJvdW5kLTMpOiB0d28gbGF6eSxcbiAqIGJhdGNoZWQgcHJvYmVzIFx1MjAxNCBvbmUgYGdpdCBscy1maWxlcyAtLWVycm9yLXVubWF0Y2hgICsgYGdpdCBzcGFuIGxpc3RcbiAqIC0tcG9yY2VsYWluYCBwYWlyIGZvciB0aGUgZGVsZXRlLXJlYWxpdHkgbWVtYmVyc2hpcCwgYW5kIG9uZSBgZ2l0IHN0YXR1c1xuICogLS1wb3JjZWxhaW5gIGJhdGNoIGZvciB0aGUgd29ya2luZy10cmVlLXZzLWluZGV4IG1hcmsgXHUyMDE0IG5ldmVyIG9uZVxuICogc3VicHJvY2VzcyBwZXIgcGF0aCwgbWVtYmVyc2hpcCBmcm9tIHByaW50ZWQgcm93cy4gVGhlIGBydW5CYXNoVG91Y2hlc2BcbiAqIGRyaXZlciBzZWVkcyB0aGUgZGVsZXRlLXJlYWxpdHkgaGFsZiB3aXRoIGV2ZXJ5IGFic2VudCB0YXJnZXQgYW5kXG4gKiBjcC9pbnN0YWxsIHNvdXJjZSBvZiB0aGUgY29tcG91bmQgYW5kIHRoZSBzdGF0dXMgaGFsZiB3aXRoIHRoZVxuICogbGF0ZXItcmVjcmVhdGUgZXhwbGFuYXRpb24ncyBjYW5kaWRhdGUgcGF0aHMsIGFuZCBzaGFyZXMgdGhlIGNhY2hlIGludG9cbiAqIHBhc3MgQiBzbyBzdXJ2aXZpbmcgZGVsZXRlcyByZS1nYXRlIHdpdGhvdXQgcmUtcHJvYmluZy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBSZWFsaXR5UHJvYmVDYWNoZSB7XG4gIC8qKiBEaXN0aW5jdCBhYnNvbHV0ZSBwYXRocyB0byBwcm9iZSwgaW4gZmlyc3Qtc2VlbiBvcmRlci4gKi9cbiAgcGF0aHM6IHN0cmluZ1tdO1xuICAvKiogTGF6eTogYWJzb2x1dGUgcGF0aHMgY29uZmlybWVkIGluZGV4LXRyYWNrZWQgb3Igc3Bhbm5lZCwgY29tcHV0ZWQgb25jZS4gKi9cbiAgcmVhbFBhdGhzOiBTZXQ8c3RyaW5nPiB8IG51bGw7XG4gIC8qKlxuICAgKiBUaGUgbGF0ZXItcmVjcmVhdGUgZXhwbGFuYXRpb24ncyBwcm9iZSBzY29wZSAocGxhbiBcdTAwQTczIHN0ZXAgMik6IGRpc3RpbmN0XG4gICAqIGRlbGV0ZSBwYXRocyBhIGxhdGVyIGNvbW1hbmQgb2YgdGhlIGNvbXBvdW5kIGNhbiByZS1jcmVhdGUgd2l0aCBhXG4gICAqIGZpbGUtcHJvZHVjaW5nIHdyaXRlLCBpbiBmaXJzdC1zZWVuIG9yZGVyLlxuICAgKi9cbiAgY2hhbmdlZENhbmRpZGF0ZXM6IHN0cmluZ1tdO1xuICAvKiogTGF6eTogY2FuZGlkYXRlcyB3aG9zZSB0cmFja2VkIHdvcmtpbmctdHJlZSBjb250ZW50IGRpZmZlcnMgZnJvbSB0aGUgaW5kZXgsIGNvbXB1dGVkIG9uY2UuICovXG4gIGNoYW5nZWRQYXRoczogU2V0PHN0cmluZz4gfCBudWxsO1xufVxuXG4vKiogQ3JlYXRlIGEgcGVyLWNvbW1hbmQgcHJvYmUgY2FjaGUgZm9yIHRoZSBnaXZlbiBhYnNvbHV0ZSBwYXRocy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVSZWFsaXR5UHJvYmVDYWNoZShcbiAgcGF0aHM6IEl0ZXJhYmxlPHN0cmluZz4sXG4gIGNoYW5nZWRDYW5kaWRhdGVzOiBJdGVyYWJsZTxzdHJpbmc+ID0gW11cbik6IFJlYWxpdHlQcm9iZUNhY2hlIHtcbiAgcmV0dXJuIHtcbiAgICBwYXRoczogWy4uLm5ldyBTZXQocGF0aHMpXSxcbiAgICByZWFsUGF0aHM6IG51bGwsXG4gICAgY2hhbmdlZENhbmRpZGF0ZXM6IFsuLi5uZXcgU2V0KGNoYW5nZWRDYW5kaWRhdGVzKV0sXG4gICAgY2hhbmdlZFBhdGhzOiBudWxsXG4gIH07XG59XG5cbi8qKiBXaGV0aGVyIHRoZSBwYXRoIGV4aXN0cyBvbiBkaXNrIChhbnkgbm9kZSBraW5kKTsgYGZhbHNlYCBvbiBhbnkgc3RhdCBmYWlsdXJlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZpbGVFeGlzdHMoYWJzUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgZnMuc3RhdFN5bmMoYWJzUGF0aCk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKiogV2hldGhlciB0aGUgcGF0aCBpcyBhIHJlZ3VsYXIgZmlsZSBcdTIwMTQgYSBkaXJlY3RvcnkgdGFyZ2V0IGZhaWxzIHRoZSBgJ2V4aXN0cydgIGdhdGUuICovXG5mdW5jdGlvbiBpc0ZpbGVPbkRpc2soYWJzUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGZzLnN0YXRTeW5jKGFic1BhdGgpLmlzRmlsZSgpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBWZXJpZnkgYSBzdGF0aWNhbGx5IGtub3dhYmxlIHBvc3QtY29udGVudCBleHBlY3RhdGlvbiBhZ2FpbnN0IHRoZSBvbi1kaXNrXG4gKiBmaWxlIChwbGFuIFx1MDBBNzMgc3RlcCAxYikuIEFueSByZWFkIGZhaWx1cmUgaXMgYSBtaXNtYXRjaCwgbmV2ZXIgYW4gZXJyb3IuXG4gKi9cbmZ1bmN0aW9uIGNvbnRlbnRNYXRjaGVzKHBvc3Q6IFRvdWNoUG9zdENvbnRlbnQsIGZpbGVQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICBpZiAoJ2V4YWN0JyBpbiBwb3N0KSByZXR1cm4gZnMucmVhZEZpbGVTeW5jKGZpbGVQYXRoLCAndXRmOCcpID09PSBwb3N0LmV4YWN0O1xuICAgIGlmICgnc3VmZml4JyBpbiBwb3N0KSB7XG4gICAgICAvLyBUaGUgc2hlbGwgYXBwZW5kcyB0aGUgYm9keSBwbHVzIGl0cyB0ZXJtaW5hdGluZyBuZXdsaW5lOyB0aGUgaGVyZWRvY1xuICAgICAgLy8gZ3JhbW1hciBzdHJpcHMgZXhhY3RseSB0aGF0IG9uZSBgXFxuYCBmcm9tIGBzcGFuLndyaXR0ZW5gXG4gICAgICAvLyAocGFyc2UtY29tbWFuZC50cyBoZXJlZG9jIGJvZHkgZXh0cmFjdGlvbiksIHNvIGEgZmlsZSBlbmRpbmdcbiAgICAgIC8vIGB3cml0dGVuXFxuYCBpcyB0aGUgc2FtZSBhcHBlbmRlZCB0ZXh0IGFzIGB3cml0dGVuYCBcdTIwMTQgYWNjZXB0IGJvdGguXG4gICAgICBjb25zdCBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKGZpbGVQYXRoLCAndXRmOCcpO1xuICAgICAgcmV0dXJuIGNvbnRlbnQuZW5kc1dpdGgocG9zdC5zdWZmaXgpIHx8IGNvbnRlbnQuZW5kc1dpdGgoYCR7cG9zdC5zdWZmaXh9XFxuYCk7XG4gICAgfVxuICAgIGlmICgnZW1wdHknIGluIHBvc3QpIHJldHVybiBmcy5zdGF0U3luYyhmaWxlUGF0aCkuc2l6ZSA9PT0gMDtcbiAgICByZXR1cm4gZnMuc3RhdFN5bmMoZmlsZVBhdGgpLnNpemUgPT09IHBvc3Quc2l6ZTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKlxuICogVGhlIGRlbGV0ZS1yZWFsaXR5IHByb2JlIChwbGFuIFx1MDBBNzMgc3RlcCAxYyk6IGxhemlseSBydW4gdGhlIHR3byBwZXItY29tbWFuZFxuICogYmF0Y2hlcyBhbmQgY2FjaGUgdGhlIGNvbmZpcm1lZC1yZWFsIHBhdGggc2V0LiBNZW1iZXJzaGlwIGNvbWVzIGZyb20gdGhlXG4gKiBwcmludGVkIHJvd3MsIG5vdCB0aGUgZXhpdCBjb2RlIFx1MjAxNCBgZ2l0IGxzLWZpbGVzIC0tZXJyb3ItdW5tYXRjaGAgcHJpbnRzXG4gKiBldmVyeSB0cmFja2VkIHBhdGggZXZlbiB3aGVuIGl0IGV4aXRzIG5vbnplcm8gKGFueSBtaXNzaW5nIHBhdGgpLCBhbmRcbiAqIGBnaXQgc3BhbiBsaXN0IC0tcG9yY2VsYWluYCBwcmludHMgbm90aGluZyBmb3IgcGhhbnRvbSBvciBrbm93bi1idXQtXG4gKiB1bnNwYW5uZWQgcGF0aHMgKGV4aXQgMCB3aXRoIFwiTm8gc3BhbnMgbWF0Y2ggdGhlIGZpbHRlcnNcIikuIEEgcGxhaW4tYHJtYCdkXG4gKiB0cmFja2VkIGZpbGUga2VlcHMgaXRzIGluZGV4IGVudHJ5IChscy1maWxlcyBleGl0IDAgXHUyMDE0IHRoZSBwcm9iZSBmaXJlcyk7XG4gKiBgZ2l0IHJtYCByZW1vdmVzIGl0IChscy1maWxlcyAxMjgpIHNvIG9ubHkgc3Bhbm5lZCBmaWxlcyBzdGF5IHJlYWwuIEFcbiAqIHBoYW50b20gb3IgdW50cmFja2VkLXVuc3Bhbm5lZCBwYXRoIGZhaWxzIGJvdGggcHJvYmVzIFx1MjAxNCB0aGUgZGVsZXRlIGRlZ3JhZGVzXG4gKiB0byBgJ2luY29uY2x1c2l2ZSdgIGFuZCBuZXZlciBmaXJlcy4gRmFpbC1zYWZlOiBhbiB1bnJlc29sdmFibGUgcmVwbyBvciBhXG4gKiBwcm9iZSBmYWlsdXJlIHlpZWxkcyBhbiBlbXB0eSBzZXQsIG5ldmVyIGFuIGVycm9yLlxuICovXG5mdW5jdGlvbiByZWFsUGF0aHMoY2FjaGU6IFJlYWxpdHlQcm9iZUNhY2hlLCBjd2Q6IHN0cmluZyk6IFNldDxzdHJpbmc+IHtcbiAgaWYgKGNhY2hlLnJlYWxQYXRocyAhPT0gbnVsbCkgcmV0dXJuIGNhY2hlLnJlYWxQYXRocztcbiAgY29uc3QgcmVhbCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBpZiAoY2FjaGUucGF0aHMubGVuZ3RoID4gMCkge1xuICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgaWYgKHJlcG9Sb290ICE9PSBudWxsKSB7XG4gICAgICBjb25zdCByZWxzID0gY2FjaGUucGF0aHMubWFwKChwKSA9PiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgcCkpO1xuICAgICAgY29uc3QgY2FwdHVyZSA9IChhcmdzOiBzdHJpbmdbXSk6IHN0cmluZyB8IG51bGwgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIGFyZ3MsIHtcbiAgICAgICAgICAgIGN3ZDogcmVwb1Jvb3QsXG4gICAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgICAgdGltZW91dDogREVGQVVMVF9USU1FT1VUX01TXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgIGNvbnN0IHN0ZG91dCA9IChlcnIgYXMgeyBzdGRvdXQ/OiBzdHJpbmcgfSkuc3Rkb3V0O1xuICAgICAgICAgIHJldHVybiB0eXBlb2Ygc3Rkb3V0ID09PSAnc3RyaW5nJyA/IHN0ZG91dCA6IG51bGw7XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgICBjb25zdCBsc0ZpbGVzID0gY2FwdHVyZShbJ2xzLWZpbGVzJywgJy0tZXJyb3ItdW5tYXRjaCcsICctLScsIC4uLnJlbHNdKTtcbiAgICAgIGlmIChsc0ZpbGVzICE9PSBudWxsKSB7XG4gICAgICAgIGZvciAoY29uc3QgbGluZSBvZiBsc0ZpbGVzLnNwbGl0KCdcXG4nKSkge1xuICAgICAgICAgIGNvbnN0IHJlbCA9IGxpbmUudHJpbSgpO1xuICAgICAgICAgIGlmIChyZWwubGVuZ3RoID4gMCkgcmVhbC5hZGQoam9pbihyZXBvUm9vdCwgcmVsKSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGNvbnN0IHNwYW5MaXN0ID0gY2FwdHVyZShbJ3NwYW4nLCAnbGlzdCcsICctLXBvcmNlbGFpbicsIC4uLnJlbHNdKTtcbiAgICAgIGlmIChzcGFuTGlzdCAhPT0gbnVsbCkge1xuICAgICAgICBmb3IgKGNvbnN0IHJvdyBvZiBwYXJzZVBvcmNlbGFpbihzcGFuTGlzdCkpIHJlYWwuYWRkKGpvaW4ocmVwb1Jvb3QsIHJvdy5wYXRoKSk7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIGNhY2hlLnJlYWxQYXRocyA9IHJlYWw7XG4gIHJldHVybiByZWFsO1xufVxuXG4vKipcbiAqIFRoZSB3b3JraW5nLXRyZWUtdnMtaW5kZXggcHJvYmUgKHBsYW4gXHUwMEE3MyBzdGVwIDIsIHJvdW5kLTMpOiBsYXppbHkgcnVuIG9uZVxuICogYGdpdCBzdGF0dXMgLS1wb3JjZWxhaW4gLXpgIGJhdGNoIG92ZXIgdGhlIHNlZWRlZCBjYW5kaWRhdGVzIGFuZCBjYWNoZSB0aGVcbiAqIHNldCB3aG9zZSB0cmFja2VkIHdvcmtpbmctdHJlZSBjb250ZW50IGRpZmZlcnMgZnJvbSB0aGUgaW5kZXggXHUyMDE0IHRoZVxuICogcmUtY3JlYXRlJ3MgbWFyay4gVGhlIGRyaXZlciBjb25zdWx0cyBpdCBiZWZvcmUgZXhwbGFpbmluZyBhIGRlbGV0ZSdzXG4gKiBkZWNpc2l2ZUZhaWwgKFwiZmlsZSBwcmVzZW50LCBzbyB0aGUgZGVsZXRlIGRpZG4ndCBoYXBwZW5cIikgYnkgYSBsYXRlclxuICogc2FtZS1wYXRoIHdyaXRlOiBhbiBlbmQtc3RhdGUtcHJlc2VudCBmaWxlIHRoYXQgc3RpbGwgbWF0Y2hlcyB0aGUgaW5kZXggaXNcbiAqIGEgZmFpbGVkIHJtICh0aGUgYCYmYCBjaGFpbiBzaG9ydC1jaXJjdWl0ZWQgYmVmb3JlIHRoZSB3cml0ZSByYW4pLCBub3QgYVxuICogcmUtY3JlYXRlLiBUaGUgWSAod29ya3RyZWUpIHN0YXR1cyBjb2x1bW4gZGVjaWRlcyBcdTIwMTQgYSByb3cgd2hvc2UgaW5kZXhcbiAqIGNvbHVtbiBhbG9uZSBkaWZmZXJzIChgQSBgIGZvciBhbiBhZGRlZC1idXQtdW5jb21taXR0ZWQgZmlsZSB3aG9zZVxuICogd29ya2luZyB0cmVlIG1hdGNoZXMgdGhlIGluZGV4KSBpcyBubyByZS1jcmVhdGUsIG9ubHkgYSBub24tc3BhY2UgWSBjb2x1bW5cbiAqIChgIE1gLCBgTU1gLCBgQU1gKSBwcm92ZXMgdGhlIHdvcmtpbmctdHJlZSBjb250ZW50IGRpZmZlcnMgZnJvbSB0aGUgaW5kZXguXG4gKiBgLS11bnRyYWNrZWQtZmlsZXM9bm9gIHN1cHByZXNzZXMgdGhlIGA/PyBgIHJvd3MgXHUyMDE0IGFuIHVudHJhY2tlZCBwYXRoXG4gKiBjYXJyaWVzIG5vIGluZGV4IGJhc2VsaW5lLCBzbyBpdCBjYW4gbmV2ZXIgY291bnQgYXMgcmUtY3JlYXRlZCAoZmFpbFxuICogY2xvc2VkKS4gYC16YCBwcmludHMgcmF3LCBOVUwtc2VwYXJhdGVkIGBYWSA8cGF0aD5gIGVudHJpZXMgc28gc3BhY2UtIGFuZFxuICogcXVvdGUtYmVhcmluZyBwYXRocyBwYXJzZSB1bmFtYmlndW91c2x5LiBGYWlsLXNhZmU6IGFuIHVucmVzb2x2YWJsZSByZXBvIG9yXG4gKiBhIHByb2JlIGZhaWx1cmUgeWllbGRzIGFuIGVtcHR5IHNldCwgbmV2ZXIgYW4gZXJyb3IuXG4gKi9cbmZ1bmN0aW9uIGNoYW5nZWRPbkRpc2soY2FjaGU6IFJlYWxpdHlQcm9iZUNhY2hlLCBjd2Q6IHN0cmluZyk6IFNldDxzdHJpbmc+IHtcbiAgaWYgKGNhY2hlLmNoYW5nZWRQYXRocyAhPT0gbnVsbCkgcmV0dXJuIGNhY2hlLmNoYW5nZWRQYXRocztcbiAgY29uc3QgY2hhbmdlZCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBpZiAoY2FjaGUuY2hhbmdlZENhbmRpZGF0ZXMubGVuZ3RoID4gMCkge1xuICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgaWYgKHJlcG9Sb290ICE9PSBudWxsKSB7XG4gICAgICBjb25zdCByZWxzID0gY2FjaGUuY2hhbmdlZENhbmRpZGF0ZXMubWFwKChwKSA9PiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgcCkpO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3N0YXR1cycsICctLXBvcmNlbGFpbicsICcteicsICctLXVudHJhY2tlZC1maWxlcz1ubycsICctLScsIC4uLnJlbHNdLCB7XG4gICAgICAgICAgY3dkOiByZXBvUm9vdCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiBERUZBVUxUX1RJTUVPVVRfTVNcbiAgICAgICAgfSk7XG4gICAgICAgIGZvciAoY29uc3QgZW50cnkgb2Ygb3V0LnNwbGl0KCdcXDAnKSkge1xuICAgICAgICAgIGlmIChlbnRyeS5sZW5ndGggPCA0KSBjb250aW51ZTsgLy8gc2tpcCB0aGUgdHJhaWxpbmcgZW1wdHkgZW50cnkgYW5kIHJlbmFtZS1wYWlyIHBhdGggcm93c1xuICAgICAgICAgIGNvbnN0IHdvcmt0cmVlU3RhdHVzID0gZW50cnkuY2hhckF0KDEpO1xuICAgICAgICAgIGlmICh3b3JrdHJlZVN0YXR1cyA9PT0gJyAnIHx8IHdvcmt0cmVlU3RhdHVzID09PSAnPycpIGNvbnRpbnVlOyAvLyBpbmRleC1vbmx5IG9yIHVudHJhY2tlZCBcdTIxOTIgbm8gbWFya1xuICAgICAgICAgIGNoYW5nZWQuYWRkKGpvaW4ocmVwb1Jvb3QsIGVudHJ5LnNsaWNlKDMpKSk7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICB2b2lkIGVycjsgLy8gcHJvYmUgZmFpbHVyZSBcdTIxOTIgZW1wdHkgc2V0IChmYWlsLXNhZmUsIG5ldmVyIGFuIGVycm9yKVxuICAgICAgfVxuICAgIH1cbiAgfVxuICBjYWNoZS5jaGFuZ2VkUGF0aHMgPSBjaGFuZ2VkO1xuICByZXR1cm4gY2hhbmdlZDtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIHRoZSBwYXRoJ3MgdHJhY2tlZCB3b3JraW5nLXRyZWUgY29udGVudCBkaWZmZXJzIGZyb20gdGhlIGluZGV4IFx1MjAxNFxuICogdGhlIGxhdGVyLXJlY3JlYXRlIGV4cGxhbmF0aW9uJ3MgbWFyay4gYGZhbHNlYCBvbiBhbnkgcHJvYmUgZmFpbHVyZSBvciBmb3JcbiAqIGFueSBwYXRoIG91dHNpZGUgdGhlIHNlZWRlZCBjYW5kaWRhdGVzIChmYWlsIGNsb3NlZCkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB3b3JraW5nVHJlZUNoYW5nZWQocHJvYmVDYWNoZTogUmVhbGl0eVByb2JlQ2FjaGUsIGN3ZDogc3RyaW5nLCBhYnNQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIGNoYW5nZWRPbkRpc2socHJvYmVDYWNoZSwgY3dkKS5oYXMoYWJzUGF0aCk7XG59XG5cbi8qKlxuICogVGhlIGxheWVyZWQgcG9zdC1zdGF0ZSBnYXRlIChwbGFuIFx1MDBBNzMgc3RlcCAxKSwgZXZhbHVhdGVkIGJlZm9yZSBhbnkgZXhlY3V0b3JcbiAqIGNhbGwsIHNpZGUtZWZmZWN0LWZyZWUgKG5vIG1lbW8gd3JpdGVzLCBubyBleGVjdXRvciBjYWxsczsgdGhlIHByb2JlIGlzXG4gKiByZWFkLW9ubHkgYW5kIHBlci1jb21tYW5kIGNhY2hlZCk6XG4gKlxuICogMS4gYHRhcmdldFN0YXRlOiAnYWJzZW50J2AgXHUyMTkyIHRoZSBwYXRoIG11c3QgYmUgYWJzZW50OyB3aGVuIGl0IGlzLCB0aGVcbiAqICAgIGRlbGV0ZS1yZWFsaXR5IHByb2JlIGRlY2lkZXM6IGluZGV4LXRyYWNrZWQgb3Igc3Bhbm5lZCBcdTIxOTIgYGRlY2lzaXZlUGFzc2BcbiAqICAgIChkYW5nbGluZyBhbmNob3JzIHN1cmZhY2UpLCBwaGFudG9tIFx1MjE5MiBgJ2luY29uY2x1c2l2ZSdgIChub3RoaW5nIHRvXG4gKiAgICBzdXJmYWNlIFx1MjAxNCB0aGUgbWlzcyBpcyBoYXJtbGVzcywgYW5kIHRoZSBkZWxldGUgbmV2ZXIgZmlyZXMpLlxuICogMi4gYHRhcmdldFN0YXRlOiAnZXhpc3RzJ2AgXHUyMTkyIHRoZSB0YXJnZXQgbXVzdCBiZSBhIHJlZ3VsYXIgZmlsZSAoYSBkaXJlY3RvcnlcbiAqICAgIG9yIG1pc3NpbmcgdGFyZ2V0IGZhaWxzKS5cbiAqIDMuIENvbnRlbnQgdmVyaWZpY2F0aW9uIHdoZXJlIHRoZSBleHBlY3RlZCBwb3N0LWNvbnRlbnQgaXMgc3RhdGljYWxseVxuICogICAga25vd2FibGUgKGBleGFjdGAvYHN1ZmZpeGAvYGVtcHR5YC9gc2l6ZWApOiBhIG1pc21hdGNoIG1lYW5zIHRoZSB3cml0ZSdzXG4gKiAgICBlZmZlY3QgaXMgYWJzZW50IFx1MjAxNCBubyB0b3VjaC5cbiAqIDQuIGNwIGRlc3RpbmF0aW9uLXZzLXNvdXJjZTogYSBzdGlsbC1wcmVzZW50IHNvdXJjZSBtdXN0IGJ5dGUtZXF1YWwgdGhlXG4gKiAgICBkZXN0aW5hdGlvbjsgYW4gYWJzZW50IHNvdXJjZSBhcHBsaWVzIHRoZSBhYnNlbnQtc291cmNlIHJ1bGUgKHBhc3NlZCB0aGVcbiAqICAgIHJlYWxpdHkgcHJvYmUgQU5EIGl0cyBhYnNlbmNlIGV4cGxhaW5lZCBieSBhIGxhdGVyIHNhbWUtcGF0aFxuICogICAgYGRlY2lzaXZlUGFzc2AgXHUyMDE0IHRoZSBkcml2ZXIgcmVzb2x2ZXMgdGhlIGAncGVuZGluZydgIGhvbGQpLlxuICogNS4gcmVuYW1lLWNvcHk6IHRoZSBkZXN0aW5hdGlvbiBmaXJlcyBvbmx5IHdoZW4gaXRzIHNvdXJjZSBwYXNzZWQgdGhlXG4gKiAgICBkZWxldGUtcmVhbGl0eSBwcm9iZSAoYSBwaGFudG9tIHNvdXJjZSBtZWFucyB0aGUgbW92ZSBmYWlsZWQpLlxuICpcbiAqIEV2ZXJ5dGhpbmcgZWxzZSBcdTIwMTQgdGhlIGV4aXN0ZW5jZS1nYXRlZCBmYW1pbGllcyB3aG9zZSBleGlzdGVuY2UgcGFzcyBwcm92ZXNcbiAqIG5vdGhpbmcgXHUyMDE0IGlzIGAnaW5jb25jbHVzaXZlJ2AuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBldmFsdWF0ZVdyaXRlR2F0ZShpbnB1dDogVG91Y2hXcml0ZUlucHV0LCBwcm9iZUNhY2hlOiBSZWFsaXR5UHJvYmVDYWNoZSk6IFdyaXRlR2F0ZU91dGNvbWUge1xuICBpZiAoaW5wdXQudGFyZ2V0U3RhdGUgPT09ICdhYnNlbnQnKSB7XG4gICAgaWYgKGZpbGVFeGlzdHMoaW5wdXQuZmlsZVBhdGgpKSByZXR1cm4gJ2RlY2lzaXZlRmFpbCc7XG4gICAgcmV0dXJuIHJlYWxQYXRocyhwcm9iZUNhY2hlLCBpbnB1dC5jd2QpLmhhcyhpbnB1dC5maWxlUGF0aCkgPyAnZGVjaXNpdmVQYXNzJyA6ICdpbmNvbmNsdXNpdmUnO1xuICB9XG5cbiAgaWYgKCFpc0ZpbGVPbkRpc2soaW5wdXQuZmlsZVBhdGgpKSByZXR1cm4gJ2RlY2lzaXZlRmFpbCc7XG5cbiAgY29uc3QgY29udGVudCA9IGlucHV0LnBvc3RTdGF0ZT8uY29udGVudDtcbiAgaWYgKGNvbnRlbnQgIT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiBjb250ZW50TWF0Y2hlcyhjb250ZW50LCBpbnB1dC5maWxlUGF0aCkgPyAnZGVjaXNpdmVQYXNzJyA6ICdkZWNpc2l2ZUZhaWwnO1xuICB9XG5cbiAgaWYgKGlucHV0LnNvdXJjZVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgIGlmIChmaWxlRXhpc3RzKGlucHV0LnNvdXJjZVBhdGgpKSB7XG4gICAgICBsZXQgc3JjOiBzdHJpbmc7XG4gICAgICBsZXQgZHN0OiBzdHJpbmc7XG4gICAgICB0cnkge1xuICAgICAgICBzcmMgPSBmcy5yZWFkRmlsZVN5bmMoaW5wdXQuc291cmNlUGF0aCwgJ3V0ZjgnKTtcbiAgICAgICAgZHN0ID0gZnMucmVhZEZpbGVTeW5jKGlucHV0LmZpbGVQYXRoLCAndXRmOCcpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiAnZGVjaXNpdmVGYWlsJztcbiAgICAgIH1cbiAgICAgIHJldHVybiBzcmMgPT09IGRzdCA/ICdkZWNpc2l2ZVBhc3MnIDogJ2RlY2lzaXZlRmFpbCc7XG4gICAgfVxuICAgIC8vIEFic2VudCBzb3VyY2UgXHUyMDE0IHRoZSBhYnNlbnQtc291cmNlIHJ1bGUgKHBsYW4gXHUwMEE3MyBzdGVwIDFiKTogdGhlIGRlc3RcbiAgICAvLyBmaXJlcyBvbmx5IHdoZW4gdGhlIHNvdXJjZSBwYXNzZWQgdGhlIHJlYWxpdHkgcHJvYmUgKGl0IHdhcyBhIHJlYWxcbiAgICAvLyBmaWxlKSBBTkQgaXRzIGFic2VuY2UgaXMgZXhwbGFpbmVkIGJ5IGEgbGF0ZXIgc2FtZS1wYXRoIGRlY2lzaXZlUGFzcy5cbiAgICByZXR1cm4gcmVhbFBhdGhzKHByb2JlQ2FjaGUsIGlucHV0LmN3ZCkuaGFzKGlucHV0LnNvdXJjZVBhdGgpID8gJ3BlbmRpbmcnIDogJ2RlY2lzaXZlRmFpbCc7XG4gIH1cblxuICBpZiAoaW5wdXQucmVuYW1lU291cmNlUGF0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgLy8gTm8gY29udGVudCBjb21wYXJpc29uIFx1MjAxNCBwYXRjaCByZW5hbWVzIG1heSBjaGFuZ2UgY29udGVudDsgYSBwaGFudG9tXG4gICAgLy8gc291cmNlIG1lYW5zIHRoZSBtb3ZlIGZhaWxlZCBhbmQgYSBwcmUtZXhpc3RpbmcgZGVzdGluYXRpb24gd2FzIG5ldmVyXG4gICAgLy8gdG91Y2hlZCAocGxhbiBcdTAwQTczIHN0ZXAgMWMpLlxuICAgIHJldHVybiByZWFsUGF0aHMocHJvYmVDYWNoZSwgaW5wdXQuY3dkKS5oYXMoaW5wdXQucmVuYW1lU291cmNlUGF0aCkgPyAnZGVjaXNpdmVQYXNzJyA6ICdkZWNpc2l2ZUZhaWwnO1xuICB9XG5cbiAgcmV0dXJuICdpbmNvbmNsdXNpdmUnO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEluamVjdGVkIGV4ZWN1dG9yc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBTdHJ1Y3R1cmVkIHJlc3VsdCBvZiBhIHNjb3BlZCBgZ2l0IHNwYW4gZHJpZnQgPGZpbGU+IC0tZml4YC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hGaXhSZXN1bHQge1xuICAvKipcbiAgICogV2hldGhlciBgLS1maXhgIHJlLWFuY2hvcmVkIGF0IGxlYXN0IG9uZSBzcGFuIGluIHRoZSB3b3JraW5nIHRyZWUuIERyaXZlc1xuICAgKiB7QGxpbmsgVG91Y2hPdXRwdXQudHJlZU1vZGlmaWVkfSBzbyBhIGNhbGxlci90ZXN0IGNhbiBhc3NlcnQgdGhlIGhlYWxpbmdcbiAgICogaGFwcGVuZWQgd2l0aG91dCBkaWZmaW5nIHRoZSB0cmVlIGl0c2VsZi5cbiAgICovXG4gIG1vZGlmaWVkOiBib29sZWFuO1xufVxuXG4vKipcbiAqIFJ1biBgZ2l0IHNwYW4gZHJpZnQgPGZpbGU+IC0tZml4YCBzY29wZWQgdG8gdGhlIHRvdWNoZWQgZmlsZSAod3JpdGUgcGF0aFxuICogb25seSksIHJlcG9ydGluZyB3aGV0aGVyIHRoZSB3b3JraW5nIHRyZWUgd2FzIGhlYWxlZC4gQXN5bmMgc28gdGhlIGV2ZW50dWFsXG4gKiBpbXBsZW1lbnRhdGlvbiBhbmQgaXRzIHRlc3RzIGNhbiBpbmplY3QgYSBmYWtlIHdpdGhvdXQgYSByZWFsIHN1YnByb2Nlc3MuXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoRml4RXhlY3V0b3IgPSAoZmlsZVBhdGg6IHN0cmluZywgY3dkOiBzdHJpbmcpID0+IFByb21pc2U8VG91Y2hGaXhSZXN1bHQ+O1xuXG4vKipcbiAqIFJ1biBgZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbiA8ZmlsZT5gIGFuZCByZXR1cm4gaXRzIHBhcnNlZCByb3dzIFx1MjAxNCBvbmUgcGVyXG4gKiBhbmNob3IgY292ZXJpbmcgdGhlIGZpbGUuIFN0cnVjdHVyZWQgKG5vdCByYXcgc3Rkb3V0KSBzbyB0aGUgbWVyZ2VkLWJsb2NrXG4gKiBjb21wdXRhdGlvbiBhbmQgaXRzIHRlc3RzIHNoYXJlIHRoZSBzYW1lIHNoYXBlLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaExpc3RFeGVjdXRvciA9IChmaWxlUGF0aDogc3RyaW5nLCBjd2Q6IHN0cmluZykgPT4gUHJvbWlzZTxQb3JjZWxhaW5Sb3dbXT47XG5cbi8qKlxuICogUnVuIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW4gPGFyZ3M+YCAoc2NvcGVkIHRvIHRoZSB0b3VjaGVkIGZpbGUgb3JcbiAqIGl0cyBzcGFucykgYW5kIHJldHVybiBpdHMgcGFyc2VkIHJvd3MgXHUyMDE0IG9uZSBwZXIgZHJpZnRlZCBhbmNob3IsIGVtcHR5IHdoZW5cbiAqIGNsZWFuLiBTdGF0dXMgY2xhc3NpZmljYXRpb24gaXMgdmlhIGBpc0RlYnQoKWA7IHBvc2l0aW9uYWwgKGBNT1ZFRGAsXG4gKiBgUkVTT0xWRURfUEVORElOR19DT01NSVRgKSByb3dzIGFyZSBuZXZlciBkZWJ0LlxuICovXG5leHBvcnQgdHlwZSBUb3VjaERyaWZ0RXhlY3V0b3IgPSAoYXJnczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKSA9PiBQcm9taXNlPERyaWZ0UG9yY2VsYWluUm93W10+O1xuXG4vKipcbiAqIFJ1biBiYXJlIGBnaXQgc3BhbiB3aHkgPG5hbWU+YCBhbmQgcmV0dXJuIHRoZSBzcGFuJ3MgcmVjb3JkZWQgd2h5IHNlbnRlbmNlLFxuICogb3IgYG51bGxgIHdoZW4gbm9uZSBpcyByZWNvcmRlZCBvciB0aGUgcmVhZCBmYWlscy4gRmVlZHMgdGhlIGh1bWFuLWZvcm1hdFxuICogc3BhbiByZW5kZXI7IGludm9rZWQgb25seSBmb3Igc3BhbnMgYWN0dWFsbHkgYmVpbmcgc3VyZmFjZWQgdGhpcyB0b3VjaC5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hXaHlFeGVjdXRvciA9IChuYW1lOiBzdHJpbmcsIGN3ZDogc3RyaW5nKSA9PiBQcm9taXNlPHN0cmluZyB8IG51bGw+O1xuXG4vKipcbiAqIFRoZSBpbmplY3RlZCBleGVjdXRpb24gc3VyZmFjZS4gS2VwdCBhcyBmb3VyIG5hcnJvdyBhc3luYyBmdW5jdGlvbnMgKHJhdGhlclxuICogdGhhbiBhIHJhdyBjb21tYW5kIHJ1bm5lcikgc28gdGVzdHMgaW5qZWN0IGZha2VzIHJldHVybmluZyBzdHJ1Y3R1cmVkIGRhdGFcbiAqIGFuZCB0aGUgY29yZSBuZXZlciBzcGF3bnMgYSBzdWJwcm9jZXNzIGl0c2VsZi4gVGhlIGByZWFkYCBwYXRoIG5ldmVyIGludm9rZXNcbiAqIGBmaXhgLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoRXhlY3V0b3JzIHtcbiAgZml4OiBUb3VjaEZpeEV4ZWN1dG9yO1xuICBsaXN0OiBUb3VjaExpc3RFeGVjdXRvcjtcbiAgZHJpZnQ6IFRvdWNoRHJpZnRFeGVjdXRvcjtcbiAgd2h5OiBUb3VjaFdoeUV4ZWN1dG9yO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIG91dHB1dFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBXaGF0IHRoZSBjb3JlIGhhbmRzIGJhY2sgZm9yIHRoZSBhZGFwdGVyIHRvIHRyYW5zbGF0ZSBpbnRvIFNESyBvdXRwdXQuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoT3V0cHV0IHtcbiAgLyoqXG4gICAqIFRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrIChoZWFkZXIsIG9uZSBodW1hbi1mb3JtYXQgc2VjdGlvbiBwZXJcbiAgICogc3VyZmFjZWQgc3BhbiwgZm9vdGVyKSB0byBpbmplY3QgdmlhIHRoZSBoYXJuZXNzJ3MgYGFkZGl0aW9uYWxDb250ZXh0YCxcbiAgICogb3IgYG51bGxgIHdoZW4gdGhlcmUgaXMgbm90aGluZyB3b3J0aCBzdXJmYWNpbmcgdGhpcyB0b3VjaC5cbiAgICovXG4gIGFkZGl0aW9uYWxDb250ZXh0OiBzdHJpbmcgfCBudWxsO1xuICAvKipcbiAgICogV2hldGhlciB0aGUgd29ya2luZyB0cmVlIHdhcyBtb2RpZmllZCBieSBhIHNjb3BlZCBgLS1maXhgIG9uIHRoZSB3cml0ZSBwYXRoLlxuICAgKiBBbHdheXMgYGZhbHNlYCBvbiB0aGUgcmVhZCBwYXRoIChyZWFkcyBuZXZlciBtdXRhdGUgdGhlIHRyZWUpLlxuICAgKi9cbiAgdHJlZU1vZGlmaWVkOiBib29sZWFuO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE1lcmdlZC1ibG9jayBhc3NlbWJseVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBUaGUgbWVtbyBrZXkgdW5kZXIgd2hpY2ggYSBzcGFuJ3MgcmVuZGVyIGZvciBhIGdpdmVuIGRyaWZ0IHN0YXR1cyBpcyBkZWR1cGVkLiAqL1xuZnVuY3Rpb24gZHJpZnRLZXkobmFtZTogc3RyaW5nLCBzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IHN0cmluZyB7XG4gIC8vIFNwYW4gbmFtZXMgY29tZSBmcm9tIHRhYi1kZWxpbWl0ZWQgcG9yY2VsYWluLCBzbyB0aGV5IG5ldmVyIGNvbnRhaW4gYSB0YWI7XG4gIC8vIGEgdGFiLWpvaW5lZCBrZXkgY2FuIG5ldmVyIGNvbGxpZGUgd2l0aCBhIGJhcmUgc3BhbiBuYW1lICh0aGUgc3VyZmFjaW5nIGtleSkuXG4gIHJldHVybiBgJHtuYW1lfVxcdCR7c3RhdHVzfWA7XG59XG5cbi8qKiBUaGUgYHBhdGgjTHN0YXJ0LUxlbmRgIChvciBiYXJlLXBhdGgsIHdob2xlLWZpbGUpIGFuY2hvciB0ZXh0IGZvciBhIHJvdy4gKi9cbmZ1bmN0aW9uIGFuY2hvclRleHQocm93OiBQb3JjZWxhaW5Sb3cpOiBzdHJpbmcge1xuICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIHJldHVybiByb3cucGF0aDtcbiAgcmV0dXJuIGAke3Jvdy5wYXRofSNMJHtyb3cuc3RhcnR9LUwke3Jvdy5lbmR9YDtcbn1cblxuZnVuY3Rpb24gY2xlYW5IZWFkZXIoZmlsZU5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgJHtmaWxlTmFtZX0gaGFzIGltcGxpY2l0IGRlcGVuZGVuY2llczpgO1xufVxuXG5mdW5jdGlvbiBjbGVhbkZvb3RlcihmaWxlTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGBJZiB5b3UgY2hhbmdlICR7ZmlsZU5hbWV9IGNoZWNrIHRoZSBvdGhlciBmaWxlcyB0byBjb25maXJtIHRoZXkgc3RpbGwgd29yayB0b2dldGhlci5gO1xufVxuXG4vKipcbiAqIFRoZSB3cml0ZSBwYXRoIG5hbWVzIHRoZSBlZGl0IGFzIHRoZSBjYXVzZTsgdGhlIHJlYWQgcGF0aCBvbmx5IHN1cmZhY2VzXG4gKiBwcmUtZXhpc3RpbmcgZHJpZnQgaXQgZGlkbid0IGNyZWF0ZSwgc28gaXQgbmFtZXMgdGhlIGRlcGVuZGVuY3kgaW5zdGVhZC5cbiAqL1xuZnVuY3Rpb24gZHJpZnRIZWFkZXIoZHJpZnRlZENvdW50OiBudW1iZXIsIGtpbmQ6IFRvdWNoSW5wdXRbJ2tpbmQnXSk6IHN0cmluZyB7XG4gIGlmIChraW5kID09PSAnd3JpdGUnKSB7XG4gICAgcmV0dXJuIGRyaWZ0ZWRDb3VudCA9PT0gMVxuICAgICAgPyAnVGhpcyBlZGl0IHB1dCBhbiBpbXBsaWNpdCBkZXBlbmRlbmN5IG91dCBvZiBkYXRlOidcbiAgICAgIDogJ1RoaXMgZWRpdCBwdXQgaW1wbGljaXQgZGVwZW5kZW5jaWVzIG91dCBvZiBkYXRlOic7XG4gIH1cbiAgcmV0dXJuIGRyaWZ0ZWRDb3VudCA9PT0gMVxuICAgID8gJ1RoaXMgZmlsZSBoYXMgYW4gaW1wbGljaXQgZGVwZW5kZW5jeSBvdXQgb2YgZGF0ZTonXG4gICAgOiAnVGhpcyBmaWxlIGhhcyBpbXBsaWNpdCBkZXBlbmRlbmNpZXMgb3V0IG9mIGRhdGU6Jztcbn1cblxuZnVuY3Rpb24gZHJpZnRGb290ZXIoZHJpZnRlZE5hbWVzOiBzdHJpbmdbXSk6IHN0cmluZyB7XG4gIGlmIChkcmlmdGVkTmFtZXMubGVuZ3RoID09PSAxKSB7XG4gICAgY29uc3QgbmFtZSA9IGRyaWZ0ZWROYW1lc1swXTtcbiAgICByZXR1cm4gYFJlc3RvcmUgYWdyZWVtZW50IGJlZm9yZSBjb21taXR0aW5nLiBGb2xsb3cgY29uZmlybWVkIGF1dGhvcml0eS4gUHJlc2VydmUgYW5jaG9yIHNoYXBlOyBpZiBhbiBhZGRyZXNzIGNoYW5nZWQsIHJlbW92ZSBpdHMgb2xkIGFuY2hvciBiZWZvcmUgYWRkaW5nIHRoZSBuZXcgb25lLiBVcGRhdGUgb3IgcmV0aXJlIHRoZSB3aHkgb25seSBpZiBpdHMgbWVhbmluZyBjaGFuZ2VkLiBSZXF1aXJlIFxcYGdpdCBzcGFuIGRyaWZ0ICR7bmFtZX1cXGAgdG8gcmVwb3J0IHplcm8sIHRoZW4gY2hlY2sgdGhlIG90aGVyIGFuY2hvcnMuIENvbmZvcm0gYSBzaWRlIG9ubHkgd2hlbiBjb25maXJtZWQgYXV0aG9yaXR5IG9yIGEgc2F0aXNmaWVkIGdhdGUgZGVjaWRlcyBpdDsgcmVwb3J0IGFtYmlndWl0eSBvciBhbiBvYnNvbGV0ZSBjb3VwbGluZy5gO1xuICB9XG4gIHJldHVybiAnRm9yIGVhY2ggb3V0LW9mLWRhdGUgc3BhbjogcmVzdG9yZSBhZ3JlZW1lbnQgYmVmb3JlIGNvbW1pdHRpbmcuIEZvbGxvdyBjb25maXJtZWQgYXV0aG9yaXR5LiBQcmVzZXJ2ZSBhbmNob3Igc2hhcGU7IGlmIGFuIGFkZHJlc3MgY2hhbmdlZCwgcmVtb3ZlIGl0cyBvbGQgYW5jaG9yIGJlZm9yZSBhZGRpbmcgdGhlIG5ldyBvbmUuIFVwZGF0ZSBvciByZXRpcmUgdGhlIHdoeSBvbmx5IGlmIGl0cyBtZWFuaW5nIGNoYW5nZWQuIFJlcXVpcmUgYGdpdCBzcGFuIGRyaWZ0IDxuYW1lPmAgdG8gcmVwb3J0IHplcm8sIHRoZW4gY2hlY2sgdGhlIG90aGVyIGFuY2hvcnMuIENvbmZvcm0gYSBzaWRlIG9ubHkgd2hlbiBjb25maXJtZWQgYXV0aG9yaXR5IG9yIGEgc2F0aXNmaWVkIGdhdGUgZGVjaWRlcyBpdDsgcmVwb3J0IGFtYmlndWl0eSBvciBhbiBvYnNvbGV0ZSBjb3VwbGluZy4nO1xufVxuXG4vKiogVGhlIHtAbGluayBSYW5nZUxhYmVsfSBmb3IgYSBwb3JjZWxhaW4gcm93IFx1MjAxNCBgMC0wYCBpcyB0aGUgd2hvbGUtZmlsZSBhbmNob3IuICovXG5mdW5jdGlvbiByYW5nZUxhYmVsKHJvdzogUG9yY2VsYWluUm93KTogUmFuZ2VMYWJlbCB7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHsga2luZDogJ3dob2xlLWZpbGUnIH07XG4gIHJldHVybiB7IGtpbmQ6ICdyYW5nZScsIHN0YXJ0OiByb3cuc3RhcnQsIGVuZDogcm93LmVuZCB9O1xufVxuXG4vKipcbiAqIEEgc3BhbidzIGZ1bGwgYW5jaG9yIGxpc3QsIHJlbmRlcmVkIGFzIGEgc2hhcmVkLXByZWZpeCB0cmVlIGJ5XG4gKiB7QGxpbmsgcmVuZGVyQW5jaG9yVHJlZX0sIHdpdGggZWFjaCBhbmNob3IgdGhhdCBjYXJyaWVzIGdlbnVpbmUgZHJpZnRcbiAqIHN1ZmZpeGVkIGJ5IGl0cyBsb3dlcmNhc2Ugc3RhdHVzIHRva2VuKHMpIChgIFx1MjAxNCBjaGFuZ2VkYCkuXG4gKlxuICogQSBkcmlmdCByb3cgbWF0Y2hlcyBhbiBhbmNob3IgYnkgZXhhY3QgcGF0aCtyYW5nZSwgb3IgYnkgcGF0aCBhbG9uZSB3aGVuIHRoZVxuICogc3BhbiBoYXMgYSBzaW5nbGUgYW5jaG9yIG9uIHRoYXQgcGF0aCAocmFuZ2VzIGNhbiBkaXNhZ3JlZSBhZnRlciBhIGhlYWwpLlxuICogYHNvbGVPblBhdGhgIGlzIGRlbGliZXJhdGVseSBjb21wdXRlZCBvdmVyIHRoZSAqKmZ1bGwgZmxhdCBhbmNob3IgbGlzdCoqLFxuICogYmVmb3JlIGFueSBncm91cGluZyBcdTIwMTQgdGhlIHRyZWUgbGF5b3V0IG11c3QgbmV2ZXIgYmUgYWJsZSB0byBjaGFuZ2UgKndoaWNoKlxuICogYW5jaG9ycyBnZXQgbGFiZWxlZCwgb25seSB3aGVyZSB0aGV5IHNpdCBvbiB0aGUgcGFnZS5cbiAqL1xuZnVuY3Rpb24gYW5jaG9yQnVsbGV0cyhhbmNob3JzOiBQb3JjZWxhaW5Sb3dbXSwgZGVidFJvd3M6IERyaWZ0UG9yY2VsYWluUm93W10pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHJvd3MgPSBhbmNob3JzLm1hcCgoYW5jaG9yKSA9PiB7XG4gICAgY29uc3Qgc29sZU9uUGF0aCA9IGFuY2hvcnMuZmlsdGVyKChhKSA9PiBhLnBhdGggPT09IGFuY2hvci5wYXRoKS5sZW5ndGggPT09IDE7XG4gICAgY29uc3Qgc3RhdHVzZXMgPSBuZXcgU2V0PFBvcmNlbGFpblN0YXR1cz4oKTtcbiAgICBmb3IgKGNvbnN0IHJvdyBvZiBkZWJ0Um93cykge1xuICAgICAgaWYgKHJvdy5wYXRoICE9PSBhbmNob3IucGF0aCkgY29udGludWU7XG4gICAgICBpZiAoc29sZU9uUGF0aCB8fCAocm93LnN0YXJ0ID09PSBhbmNob3Iuc3RhcnQgJiYgcm93LmVuZCA9PT0gYW5jaG9yLmVuZCkpIHtcbiAgICAgICAgc3RhdHVzZXMuYWRkKHJvdy5zdGF0dXMpO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBzb3J0ZWQgPSBbLi4uc3RhdHVzZXNdLnNvcnQoKTtcbiAgICBjb25zdCBzdWZmaXggPSBzb3J0ZWQubGVuZ3RoID4gMCA/IGAgXHUyMDE0ICR7c29ydGVkLm1hcChodW1hblN0YXR1c0xhYmVsKS5qb2luKCcsICcpfWAgOiAnJztcbiAgICByZXR1cm4geyBwYXRoOiBhbmNob3IucGF0aCwgcmFuZ2U6IHJhbmdlTGFiZWwoYW5jaG9yKSwgc3VmZml4IH07XG4gIH0pO1xuICB0cnkge1xuICAgIHJldHVybiByZW5kZXJBbmNob3JUcmVlKGNvbGxhcHNlQnlQYXRoKHJvd3MpKTtcbiAgfSBjYXRjaCB7XG4gICAgLy8gRkFJTC1DTE9TRUQsIG5vdCBhIGA8Z3JlZW5maWVsZD5gLWZvcmJpZGRlbiBmYWxsYmFjayBcdTIwMTQgZG8gbm90IHJlbW92ZSBpdFxuICAgIC8vIG9uIHRoZSB0aGVvcnkgdGhhdCBhIGRlZ3JhZGVkIGZhbGxiYWNrIGlzIGl0c2VsZiBmb3JiaWRkZW4uIEFuIHVuY2F1Z2h0XG4gICAgLy8gdGhyb3cgaGVyZSBkb2VzIG5vdCBkZWdyYWRlIHRvIGEgZmxhdCBsaXN0OiBpdCBlc2NhcGVzIHRvXG4gICAgLy8gYHJ1blRvdWNoSG9va2AncyBjYXRjaCwgd2hpY2ggcmVzb2x2ZXMgdGhlIHdob2xlIGhvb2sgdG9cbiAgICAvLyBgYWRkaXRpb25hbENvbnRleHQ6IG51bGxgLCBzbyB0aGUgYWdlbnQgaXMgbmV2ZXIgdG9sZCBhYm91dCB0aGUgZHJpZnQgYXRcbiAgICAvLyBhbGwuIENhdGNoaW5nIGxvY2FsbHkgbmFycm93cyB3aGF0IGEgcmVuZGVyaW5nIGRlZmVjdCBjYW4gY29zdCBmcm9tIFwidGhlXG4gICAgLy8gcmVtaW5kZXIgZGlzYXBwZWFyc1wiIHRvIFwidGhlIHJlbWluZGVyIGxvb2tzIGxpa2UgaXQgZGlkIGJlZm9yZSB0aGUgdHJlZVwiLlxuICAgIC8vIFdoZXRoZXIgdG8gc3VyZmFjZSBhbmQgd2hhdCBzaGFwZSB0byBzdXJmYWNlIGluIGFyZSBkaWZmZXJlbnQgdGhpbmdzLCBhbmRcbiAgICAvLyB0aGlzIGNhdGNoIG9ubHkgZXZlciB0b3VjaGVzIHRoZSBsYXR0ZXIuXG4gICAgLy8gYHJvd3NgIGlzIGluZGV4LWFsaWduZWQgd2l0aCBgYW5jaG9yc2AsIHNvIHRoaXMgcmVwcm9kdWNlcyB0b2RheSdzIGZsYXRcbiAgICAvLyBidWxsZXQgcnVuIGJ5dGUgZm9yIGJ5dGUsIHN1ZmZpeGVzIGluY2x1ZGVkLlxuICAgIHJldHVybiBhbmNob3JzLm1hcCgoYW5jaG9yLCBpKSA9PiBgLSAke2FuY2hvclRleHQoYW5jaG9yKX0ke3Jvd3NbaV0uc3VmZml4fWApO1xuICB9XG59XG5cbi8qKlxuICogT25lIGh1bWFuLWZvcm1hdCBzcGFuIHNlY3Rpb246IGAjIyA8bmFtZT5gLCB0aGUgZnVsbCBhbmNob3IgbGlzdCAoZHJpZnRlZFxuICogYW5jaG9ycyBzdGF0dXMtc3VmZml4ZWQpLCBhbmQgdGhlIHdoeSBzZW50ZW5jZSB3aGVuIG9uZSBpcyByZWNvcmRlZC5cbiAqXG4gKiBUaGUgbmFtZSBoZWFkZXIgYW5kIHRoZSB3aHkgc2VudGVuY2UgYXJlIHRoZSBzYW1lIHNoYXBlIGBnaXQgc3BhbiBsaXN0YFxuICogcmVuZGVyczsgdGhlIGFuY2hvciBsaXN0IGRlbGliZXJhdGVseSBpcyBub3QgXHUyMDE0IGl0IHJlbmRlcnMgYXMgYSBzaGFyZWQtcHJlZml4XG4gKiB0cmVlICh7QGxpbmsgYW5jaG9yQnVsbGV0c30pIHdoZXJlIHRoZSBDTEkgcHJpbnRzIGEgZmxhdCBgLSBwYXRoI0xyYW5nZWBcbiAqIGJ1bGxldCBydW4uIFRoZSBDTEkncyBvd24gdGV4dCBmb3JtYXQgaXMgdW50b3VjaGVkOyBvbmx5IHRoaXMgaG9vaydzXG4gKiByZS1wcmVzZW50YXRpb24gb2YgaXQgZ3JvdXBzLlxuICovXG5mdW5jdGlvbiByZW5kZXJTcGFuU2VjdGlvbihcbiAgbmFtZTogc3RyaW5nLFxuICBhbmNob3JzOiBQb3JjZWxhaW5Sb3dbXSxcbiAgZGVidFJvd3M6IERyaWZ0UG9yY2VsYWluUm93W10sXG4gIHdoeTogc3RyaW5nIHwgbnVsbFxuKTogc3RyaW5nIHtcbiAgY29uc3QgbGluZXMgPSBbYCMjICR7bmFtZX1gLCAuLi5hbmNob3JCdWxsZXRzKGFuY2hvcnMsIGRlYnRSb3dzKV07XG4gIGlmICh3aHkpIGxpbmVzLnB1c2goJycsIHdoeSk7XG4gIHJldHVybiBsaW5lcy5qb2luKCdcXG4nKTtcbn1cblxuLyoqXG4gKiBBc3NlbWJsZSB0aGUgbWVyZ2VkIGA8Z2l0LXNwYW4+YCBibG9jazogaGVhZGVyLCBvbmUgc2VjdGlvbiBwZXIgc3VyZmFjZWRcbiAqIHNwYW4gKHNlcGFyYXRlZCBieSBgLS0tYCksIGFuZCBhIHNpbmdsZSBmb290ZXIgYWZ0ZXIgYSBmaW5hbCBgLS0tYC5cbiAqL1xuZnVuY3Rpb24gYnVpbGRCbG9jayhzZWN0aW9uczogc3RyaW5nW10sIGhlYWRlcjogc3RyaW5nLCBmb290ZXI6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGJvZHkgPSBgJHtoZWFkZXJ9XFxuXFxuJHtzZWN0aW9ucy5qb2luKCdcXG5cXG4tLS1cXG5cXG4nKX1cXG5cXG4tLS1cXG5cXG4ke2Zvb3Rlcn1gO1xuICByZXR1cm4gYFxcbjxnaXQtc3Bhbj5cXG4ke2JvZHl9XFxuPC9naXQtc3Bhbj5cXG5gO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIGhvb2sgZW50cnkgcG9pbnRcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogV2hldGhlciBhIGNvdmVyaW5nIHJvdyBpcyBpbiBzY29wZSBmb3IgdGhlIHJlY292ZXJlZCByYW5nZS4gKi9cbmZ1bmN0aW9uIGludGVyc2VjdHMocm93OiBQb3JjZWxhaW5Sb3csIHJhbmdlOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScpOiBib29sZWFuIHtcbiAgaWYgKHJhbmdlID09PSAnd2hvbGUtZmlsZScpIHJldHVybiB0cnVlO1xuICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIHJldHVybiB0cnVlOyAvLyB3aG9sZS1maWxlIGFuY2hvclxuICByZXR1cm4gcmFuZ2VzSW50ZXJzZWN0KHJhbmdlLCB7IHN0YXJ0OiByb3cuc3RhcnQsIGVuZDogcm93LmVuZCB9KTtcbn1cblxuLyoqXG4gKiBSZWNvdmVyIHRoZSB0b3VjaGVkIHJhbmdlIGZyb20gdGhlIG9uLWRpc2sgZmlsZSBmb3IgYSB3cml0ZS4gQW4gZW1wdHkgd3JpdGUgb3JcbiAqIGFuIHVucmVhZGFibGUgZmlsZSAoZS5nLiBhIGRlbGV0ZSwgb3IgdGhlIGZpbGUgd2FzIG5ldmVyIHdyaXR0ZW4pIGRlZ3JhZGVzIHRvXG4gKiBgJ3dob2xlLWZpbGUnYCwgc2NvcGluZyB0aGUgdG91Y2ggdG8gZXZlcnkgY292ZXJpbmcgc3BhbiBcdTIwMTQgdGhlIGZhaWwtb3BlblxuICogYmVoYXZpb3IsIG5vdCBhbiBlcnJvci5cbiAqL1xuZnVuY3Rpb24gcmVjb3ZlclJhbmdlRnJvbURpc2sod3JpdHRlbjogc3RyaW5nLCBmaWxlUGF0aDogc3RyaW5nKTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnIHtcbiAgaWYgKHdyaXR0ZW4ubGVuZ3RoID09PSAwKSByZXR1cm4gJ3dob2xlLWZpbGUnO1xuICBsZXQgY29udGVudDogc3RyaW5nO1xuICB0cnkge1xuICAgIGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgsICd1dGY4Jyk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIH1cbiAgcmV0dXJuIHJlY292ZXJSYW5nZSh3cml0dGVuLCBjb250ZW50KTtcbn1cblxuLyoqXG4gKiBUaGUgQ2xhdWRlIGBSZWFkYCB0b29sJ3MgZG9jdW1lbnRlZCBkZWZhdWx0IGxpbmUgY291bnQgd2hlbiBgb2Zmc2V0YCBpc1xuICogZ2l2ZW4gd2l0aG91dCBgbGltaXRgIChcIkJ5IGRlZmF1bHQsIGl0IHJlYWRzIHVwIHRvIDIwMDAgbGluZXNcIikuIE5hbWVkIHNvXG4gKiB0aGUgYXNzdW1wdGlvbiBpcyB2aXNpYmxlIGFuZCBlYXN5IHRvIHVwZGF0ZSBpZiB0aGF0IGRlZmF1bHQgZXZlciBjaGFuZ2VzLlxuICovXG5leHBvcnQgY29uc3QgREVGQVVMVF9SRUFEX0xJTUlUID0gMjAwMDtcblxuLyoqXG4gKiBDb21wdXRlIHRoZSB0b3VjaGVkIHJhbmdlIGZvciBhIHJlYWQgZnJvbSB0aGUgQ2xhdWRlIGBSZWFkYCB0b29sJ3NcbiAqIGBvZmZzZXRgL2BsaW1pdGAgaW5wdXRzLiBOZWl0aGVyIHByZXNlbnQgbWVhbnMgYSBnZW51aW5lIHdob2xlLWZpbGUgcmVhZCBcdTIwMTRcbiAqIGV2ZXJ5IGNvdmVyaW5nIHNwYW4gc3RheXMgaW4gc2NvcGUsIG1hdGNoaW5nIHRvZGF5J3MgYmVoYXZpb3IuIE90aGVyd2lzZVxuICogdGhlIHJhbmdlIHN0YXJ0cyBhdCBgb2Zmc2V0YCAoZGVmYXVsdCBsaW5lIDEpIGFuZCBydW5zIGZvciBgbGltaXRgIGxpbmVzXG4gKiAoZGVmYXVsdCB7QGxpbmsgREVGQVVMVF9SRUFEX0xJTUlUfSksIGNsYW1wZWQgdG8gdGhlIGZpbGUncyBhY3R1YWwgbGluZVxuICogY291bnQgc28gYSBzaG9ydCBmaWxlIHdpdGggYSBsYXJnZSBgb2Zmc2V0YC9gbGltaXRgIGRvZXNuJ3Qgb3ZlcnNob290LlxuICogQ2xhbXBpbmcgcmVxdWlyZXMgcmVhZGluZyB0aGUgZmlsZTsgYW4gdW5yZWFkYWJsZSBmaWxlIGRlZ3JhZGVzIHRvXG4gKiBgJ3dob2xlLWZpbGUnYCBcdTIwMTQgdGhlIHNhbWUgZmFpbC1vcGVuIGJlaGF2aW9yIHRoZSB3cml0ZSBwYXRoIHVzZXMuXG4gKi9cbmZ1bmN0aW9uIHJlY292ZXJSZWFkUmFuZ2UoXG4gIG9mZnNldDogbnVtYmVyIHwgdW5kZWZpbmVkLFxuICBsaW1pdDogbnVtYmVyIHwgdW5kZWZpbmVkLFxuICBmaWxlUGF0aDogc3RyaW5nXG4pOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScge1xuICBpZiAob2Zmc2V0ID09PSB1bmRlZmluZWQgJiYgbGltaXQgPT09IHVuZGVmaW5lZCkgcmV0dXJuICd3aG9sZS1maWxlJztcbiAgY29uc3Qgc3RhcnQgPSBvZmZzZXQgPz8gMTtcbiAgbGV0IGxpbmVDb3VudDogbnVtYmVyO1xuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgsICd1dGY4Jyk7XG4gICAgbGluZUNvdW50ID0gY29udGVudC5sZW5ndGggPT09IDAgPyAwIDogY29udGVudC5zcGxpdCgnXFxuJykubGVuZ3RoO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gJ3dob2xlLWZpbGUnO1xuICB9XG4gIGNvbnN0IGVuZCA9IE1hdGgubWluKHN0YXJ0ICsgKGxpbWl0ID8/IERFRkFVTFRfUkVBRF9MSU1JVCkgLSAxLCBNYXRoLm1heChsaW5lQ291bnQsIHN0YXJ0KSk7XG4gIHJldHVybiB7IHN0YXJ0LCBlbmQgfTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGEgY292ZXJpbmcgcm93IGlzIGFuIGFuY2hvciBpbiB0aGUgdG91Y2hlZCBmaWxlIGl0c2VsZi4gYGxpc3RcbiAqIC0tcG9yY2VsYWluIDxmaWxlPmAgcmV0dXJucyBldmVyeSBhbmNob3Igb2YgZWFjaCBtYXRjaGluZyBzcGFuIFx1MjAxNCBjcm9zcy1maWxlXG4gKiBhbmNob3JzIGluY2x1ZGVkIFx1MjAxNCBidXQgb25seSBhbmNob3JzIGluIHRoZSB0b3VjaGVkIGZpbGUgcGFydGljaXBhdGUgaW4gdGhlXG4gKiByYW5nZS1pbnRlcnNlY3Rpb24gc2NvcGUgdGVzdC4gUm93IHBhdGhzIGFyZSByZXBvLXJlbGF0aXZlOyB0aGUgdG91Y2hlZCBwYXRoXG4gKiBpcyBhYnNvbHV0ZSwgc28gbWF0Y2ggb24gYW4gZXhhY3Qgb3IgYC9gLXNlcGFyYXRlZCBzdWZmaXguXG4gKi9cbmZ1bmN0aW9uIG9uVG91Y2hlZEZpbGUocm93OiBQb3JjZWxhaW5Sb3csIGZpbGVQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIGZpbGVQYXRoID09PSByb3cucGF0aCB8fCBmaWxlUGF0aC5lbmRzV2l0aChgLyR7cm93LnBhdGh9YCk7XG59XG5cbi8qKlxuICogQ29tcHV0ZSB0aGUgbWVyZ2VkIGA8Z2l0LXNwYW4+YCBibG9jayBmb3IgdGhlIHRvdWNoLCBvciBgbnVsbGAgd2hlbiB0aGVyZSBpc1xuICogbm90aGluZyB3b3J0aCBzdXJmYWNpbmcuIFNoYXJlZCBieSBib3RoIHBhdGhzOyB0aGUgd3JpdGUgcGF0aCBwYXNzZXMgYVxuICogcmVjb3ZlcmVkIHJhbmdlIGZvciBwcmVjaXNpb24sIHRoZSByZWFkIHBhdGggc2NvcGVzIGZpbGUtd2lkZS5cbiAqXG4gKiBBIHNwYW4gcmVuZGVycyBhcyBhIGZ1bGwgaHVtYW4tZm9ybWF0IHNlY3Rpb24gKG5hbWUsIGFsbCBhbmNob3JzIHdpdGhcbiAqIGRyaWZ0ZWQgb25lcyBzdGF0dXMtc3VmZml4ZWQsIHdoeSkgd2hlbiBpdHMgbmFtZSBoYXMgbm90IGJlZW4gc3VyZmFjZWQgdGhpc1xuICogc2Vzc2lvbiwgb3Igd2hlbiBpdCBjYXJyaWVzIGEgZHJpZnQgc3RhdHVzIG5vdCB5ZXQgc3VyZmFjZWQgZm9yIGl0IFx1MjAxNCBzbyBhXG4gKiBzcGFuIGZpcnN0IHNlZW4gaGVhbHRoeSByZS1yZW5kZXJzIGluIGZ1bGwgd2hlbiBkcmlmdCBsYXRlciBhcHBlYXJzLiBBIHNwYW5cbiAqIHdob3NlIG9ubHkgZHJpZnQgaXMgcG9zaXRpb25hbCAoYE1PVkVEYC9gUkVTT0xWRURfUEVORElOR19DT01NSVRgIFx1MjAxNCBuZXZlclxuICogYGlzRGVidGApIGlzIGZpbHRlcmVkIG91dCBlbnRpcmVseTogcG9zaXRpb25hbCBkcmlmdCBuZXZlciBzdXJmYWNlcy5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gY29tcHV0ZVN1cmZhY2UoXG4gIGlucHV0OiBUb3VjaElucHV0LFxuICBleGVjdXRvcnM6IFRvdWNoRXhlY3V0b3JzLFxuICBtZW1vOiBNZW1vU3RvcmUsXG4gIHJhbmdlOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZSdcbik6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICBjb25zdCBjb3ZlcmluZyA9IGF3YWl0IGV4ZWN1dG9ycy5saXN0KGlucHV0LmZpbGVQYXRoLCBpbnB1dC5jd2QpO1xuICBpZiAoY292ZXJpbmcubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAvLyBHcm91cCBldmVyeSBhbmNob3IgYnkgc3BhbjsgYSBzcGFuIGlzIGluIHNjb3BlIHdoZW4gb25lIG9mIGl0cyBhbmNob3JzIG9uXG4gIC8vIHRoZSB0b3VjaGVkIGZpbGUgaW50ZXJzZWN0cyB0aGUgcmVjb3ZlcmVkIHJhbmdlLlxuICBjb25zdCBhbmNob3JzQnlOYW1lID0gbmV3IE1hcDxzdHJpbmcsIFBvcmNlbGFpblJvd1tdPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiBjb3ZlcmluZykge1xuICAgIGNvbnN0IHJvd3MgPSBhbmNob3JzQnlOYW1lLmdldChyb3cubmFtZSkgPz8gW107XG4gICAgcm93cy5wdXNoKHJvdyk7XG4gICAgYW5jaG9yc0J5TmFtZS5zZXQocm93Lm5hbWUsIHJvd3MpO1xuICB9XG4gIGNvbnN0IHRvdWNoZWROYW1lcyA9IFsuLi5hbmNob3JzQnlOYW1lLmtleXMoKV0uZmlsdGVyKChuYW1lKSA9PlxuICAgIChhbmNob3JzQnlOYW1lLmdldChuYW1lKSA/PyBbXSkuc29tZSgocm93KSA9PiBvblRvdWNoZWRGaWxlKHJvdywgaW5wdXQuZmlsZVBhdGgpICYmIGludGVyc2VjdHMocm93LCByYW5nZSkpXG4gICk7XG4gIGlmICh0b3VjaGVkTmFtZXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBkcmlmdFJvd3MgPSBhd2FpdCBleGVjdXRvcnMuZHJpZnQoW2lucHV0LmZpbGVQYXRoXSwgaW5wdXQuY3dkKTtcbiAgY29uc3QgZHJpZnRCeU5hbWUgPSBuZXcgTWFwPHN0cmluZywgRHJpZnRQb3JjZWxhaW5Sb3dbXT4oKTtcbiAgZm9yIChjb25zdCByb3cgb2YgZHJpZnRSb3dzKSB7XG4gICAgY29uc3Qgcm93cyA9IGRyaWZ0QnlOYW1lLmdldChyb3cubmFtZSkgPz8gW107XG4gICAgcm93cy5wdXNoKHJvdyk7XG4gICAgZHJpZnRCeU5hbWUuc2V0KHJvdy5uYW1lLCByb3dzKTtcbiAgfVxuXG4gIGNvbnN0IHN1cmZhY2VkID0gbWVtby5nZXRTdXJmYWNlZChpbnB1dC5zZXNzaW9uSWQpO1xuICBjb25zdCB0b1JlY29yZDogc3RyaW5nW10gPSBbXTtcbiAgY29uc3Qgc2VjdGlvbnM6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGRyaWZ0ZWROYW1lczogc3RyaW5nW10gPSBbXTtcblxuICBmb3IgKGNvbnN0IG5hbWUgb2YgdG91Y2hlZE5hbWVzKSB7XG4gICAgY29uc3Qgc3BhbkRyaWZ0ID0gZHJpZnRCeU5hbWUuZ2V0KG5hbWUpID8/IFtdO1xuICAgIGNvbnN0IGRlYnRSb3dzID0gc3BhbkRyaWZ0LmZpbHRlcigocm93KSA9PiBpc0RlYnQocm93LnN0YXR1cykpO1xuICAgIGlmIChzcGFuRHJpZnQubGVuZ3RoID4gMCAmJiBkZWJ0Um93cy5sZW5ndGggPT09IDApIGNvbnRpbnVlOyAvLyBwb3NpdGlvbmFsLW9ubHkgZHJpZnQgbmV2ZXIgc3VyZmFjZXNcblxuICAgIGNvbnN0IGRlYnRTdGF0dXNlcyA9IFsuLi5uZXcgU2V0KGRlYnRSb3dzLm1hcCgocm93KSA9PiByb3cuc3RhdHVzKSldLnNvcnQoKTtcbiAgICBjb25zdCB1bnN1cmZhY2VkRGVidCA9IGRlYnRTdGF0dXNlcy5maWx0ZXIoKHN0YXR1cykgPT4gIXN1cmZhY2VkLmhhcyhkcmlmdEtleShuYW1lLCBzdGF0dXMpKSk7XG4gICAgY29uc3QgaXNOZXdOYW1lID0gIXN1cmZhY2VkLmhhcyhuYW1lKTtcbiAgICBpZiAoIWlzTmV3TmFtZSAmJiB1bnN1cmZhY2VkRGVidC5sZW5ndGggPT09IDApIGNvbnRpbnVlOyAvLyBmdWxseSBzdXJmYWNlZCBhbHJlYWR5XG5cbiAgICBjb25zdCB3aHkgPSBhd2FpdCBleGVjdXRvcnMud2h5KG5hbWUsIGlucHV0LmN3ZCk7XG4gICAgc2VjdGlvbnMucHVzaChyZW5kZXJTcGFuU2VjdGlvbihuYW1lLCBhbmNob3JzQnlOYW1lLmdldChuYW1lKSA/PyBbXSwgZGVidFJvd3MsIHdoeSkpO1xuICAgIGlmIChkZWJ0U3RhdHVzZXMubGVuZ3RoID4gMCkgZHJpZnRlZE5hbWVzLnB1c2gobmFtZSk7XG5cbiAgICBpZiAoaXNOZXdOYW1lKSB0b1JlY29yZC5wdXNoKG5hbWUpO1xuICAgIGZvciAoY29uc3Qgc3RhdHVzIG9mIHVuc3VyZmFjZWREZWJ0KSB0b1JlY29yZC5wdXNoKGRyaWZ0S2V5KG5hbWUsIHN0YXR1cykpO1xuICB9XG5cbiAgaWYgKHNlY3Rpb25zLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIG1lbW8uYWRkU3VyZmFjZWQoaW5wdXQuc2Vzc2lvbklkLCB0b1JlY29yZCk7XG4gIGNvbnN0IGZpbGVOYW1lID0gYmFzZW5hbWUoaW5wdXQuZmlsZVBhdGgpO1xuICBjb25zdCBoZWFkZXIgPSBkcmlmdGVkTmFtZXMubGVuZ3RoID4gMCA/IGRyaWZ0SGVhZGVyKGRyaWZ0ZWROYW1lcy5sZW5ndGgsIGlucHV0LmtpbmQpIDogY2xlYW5IZWFkZXIoZmlsZU5hbWUpO1xuICBjb25zdCBmb290ZXIgPSBkcmlmdGVkTmFtZXMubGVuZ3RoID4gMCA/IGRyaWZ0Rm9vdGVyKGRyaWZ0ZWROYW1lcykgOiBjbGVhbkZvb3RlcihmaWxlTmFtZSk7XG4gIHJldHVybiBidWlsZEJsb2NrKHNlY3Rpb25zLCBoZWFkZXIsIGZvb3Rlcik7XG59XG5cbi8qKlxuICogUnVuIHRoZSB0b3VjaCBob29rIGZvciBhIHNpbmdsZSB0b29sIGNhbGwsIGJyYW5jaGluZyBvbiB7QGxpbmsgVG91Y2hJbnB1dC5raW5kfS5cbiAqXG4gKiAtICoqV3JpdGUgcGF0aCoqOiB7QGxpbmsgZXZhbHVhdGVXcml0ZUdhdGV9IChwbGFuIFx1MDBBNzMgc3RlcCAxKSBydW5zIGZpcnN0IFx1MjAxNFxuICogICBhbnkgZGVjaXNpdmUgZmFpbCwgb3IgYW4gaW5jb25jbHVzaXZlIHBoYW50b20gZGVsZXRlLCBibG9ja3MgdGhlIHRvdWNoXG4gKiAgIHdpdGggbm8gZXhlY3V0b3IgY2FsbCBcdTIwMTQgdGhlbiBgZXhlY3V0b3JzLmZpeGAgKGBnaXQgc3BhbiBkcmlmdCA8ZmlsZT5cbiAqICAgLS1maXhgKSBzY29wZWQgdG8gdGhlIHRvdWNoZWQgZmlsZSBoZWFscyBwb3NpdGlvbmFsIGRyaWZ0IGluIHRoZSB3b3JraW5nXG4gKiAgIHRyZWUsIGFuZCB0aGUgbWVyZ2VkIGA8Z2l0LXNwYW4+YCBibG9jayBpcyBjb21wdXRlZCBhZ2FpbnN0IHRoZSBoZWFsZWRcbiAqICAgYW5jaG9ycywgcmVuZGVyaW5nIGVhY2ggc3VyZmFjZWQgc3BhbiBhcyBhIGZ1bGwgaHVtYW4tZm9ybWF0IHNlY3Rpb24gd2l0aFxuICogICBhbnkgcmVtYWluaW5nIHNlbWFudGljIGRyaWZ0IHN0YXR1cy1zdWZmaXhlZCBvbiBpdHMgYW5jaG9ycy4gQ2FkZW5jZSBpc1xuICogICBkZWR1cGVkIHRocm91Z2ggYG1lbW9gIHBlciBzcGFuIG5hbWUgYW5kIHBlciAoc3Bhbiwgc3RhdHVzKS5cbiAqIC0gKipSZWFkIHBhdGgqKjogbmV2ZXIgaW52b2tlcyBgZml4YCBhbmQgbmV2ZXIgbXV0YXRlcyB0aGUgdHJlZTsgc3VyZmFjZXMgdGhlXG4gKiAgIHNwYW5zIG92ZXJsYXBwaW5nIHRoZSByZWFkJ3MgYG9mZnNldGAvYGxpbWl0YCB3aW5kb3cgKHNlZVxuICogICB7QGxpbmsgcmVjb3ZlclJlYWRSYW5nZX07IGEgcmVhZCB3aXRoIG5laXRoZXIgaXMgd2hvbGUtZmlsZSwgbWF0Y2hpbmdcbiAqICAgdG9kYXkncyBiZWhhdmlvcikgd2l0aCBwb3NpdGlvbmFsIHN0YXR1c2VzIGZpbHRlcmVkIG91dCB2aWEgYGlzRGVidCgpYC5cbiAqXG4gKiBUaGUgb3B0aW9uYWwgYHByb2JlQ2FjaGVgIHNoYXJlcyB0aGUgZHJpdmVyJ3MgcGVyLWNvbW1hbmQgZGVsZXRlLXJlYWxpdHlcbiAqIHByb2JlIGludG8gcGFzcyBCIChwbGFuIFx1MDBBNzMgc3RlcCAyKSBzbyBzdXJ2aXZpbmcgZGVsZXRlcyByZS1nYXRlIHdpdGhvdXRcbiAqIHJlLXByb2Jpbmc7IGRpcmVjdCBjYWxsZXJzIGdldCBhIHBlci1jYWxsIGNhY2hlIHNlZWRlZCB3aXRoIHRoZSB0b3VjaGVkXG4gKiBwYXRoIHdoZW4gdGhlIHRhcmdldCBpcyBgJ2Fic2VudCdgLlxuICpcbiAqIEZhaWxzIG9wZW46IGFueSBleGVjdXRvciByZWplY3Rpb24gb3IgaW50ZXJuYWwgZXJyb3IgeWllbGRzXG4gKiBgYWRkaXRpb25hbENvbnRleHQ6IG51bGxgIChubyBzaWduYWwsIGVkaXRpbmcgbmV2ZXIgYmxvY2tlZCkgcmF0aGVyIHRoYW5cbiAqIHRocm93aW5nLiBgdHJlZU1vZGlmaWVkYCByZWZsZWN0cyBhIHN1Y2Nlc3NmdWwgYC0tZml4YCBldmVuIHdoZW4gdGhlXG4gKiBzdWJzZXF1ZW50IHN1cmZhY2UgY29tcHV0YXRpb24gZmFpbHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5Ub3VjaEhvb2soXG4gIGlucHV0OiBUb3VjaElucHV0LFxuICBleGVjdXRvcnM6IFRvdWNoRXhlY3V0b3JzLFxuICBtZW1vOiBNZW1vU3RvcmUsXG4gIHByb2JlQ2FjaGU/OiBSZWFsaXR5UHJvYmVDYWNoZVxuKTogUHJvbWlzZTxUb3VjaE91dHB1dD4ge1xuICBsZXQgdHJlZU1vZGlmaWVkID0gZmFsc2U7XG4gIHRyeSB7XG4gICAgbGV0IHJhbmdlOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScgPSAnd2hvbGUtZmlsZSc7XG4gICAgaWYgKGlucHV0LmtpbmQgPT09ICd3cml0ZScpIHtcbiAgICAgIGNvbnN0IHByb2JlID0gcHJvYmVDYWNoZSA/PyBjcmVhdGVSZWFsaXR5UHJvYmVDYWNoZShpbnB1dC50YXJnZXRTdGF0ZSA9PT0gJ2Fic2VudCcgPyBbaW5wdXQuZmlsZVBhdGhdIDogW10pO1xuICAgICAgY29uc3Qgb3V0Y29tZSA9IGV2YWx1YXRlV3JpdGVHYXRlKGlucHV0LCBwcm9iZSk7XG4gICAgICBpZiAob3V0Y29tZSA9PT0gJ2RlY2lzaXZlRmFpbCcgfHwgKG91dGNvbWUgPT09ICdpbmNvbmNsdXNpdmUnICYmIGlucHV0LnRhcmdldFN0YXRlID09PSAnYWJzZW50JykpIHtcbiAgICAgICAgcmV0dXJuIHsgYWRkaXRpb25hbENvbnRleHQ6IG51bGwsIHRyZWVNb2RpZmllZDogZmFsc2UgfTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGZpeCA9IGF3YWl0IGV4ZWN1dG9ycy5maXgoaW5wdXQuZmlsZVBhdGgsIGlucHV0LmN3ZCk7XG4gICAgICB0cmVlTW9kaWZpZWQgPSBmaXgubW9kaWZpZWQ7XG4gICAgICByYW5nZSA9IGlucHV0LnJhbmdlID8/IHJlY292ZXJSYW5nZUZyb21EaXNrKGlucHV0LndyaXR0ZW4sIGlucHV0LmZpbGVQYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmFuZ2UgPSByZWNvdmVyUmVhZFJhbmdlKGlucHV0Lm9mZnNldCwgaW5wdXQubGltaXQsIGlucHV0LmZpbGVQYXRoKTtcbiAgICB9XG4gICAgY29uc3QgYWRkaXRpb25hbENvbnRleHQgPSBhd2FpdCBjb21wdXRlU3VyZmFjZShpbnB1dCwgZXhlY3V0b3JzLCBtZW1vLCByYW5nZSk7XG4gICAgcmV0dXJuIHsgYWRkaXRpb25hbENvbnRleHQsIHRyZWVNb2RpZmllZCB9O1xuICB9IGNhdGNoIHtcbiAgICAvLyBGYWlsIG9wZW46IG5ldmVyIGxldCBhIHRvdWNoLWNvcmUgZXJyb3IgcHJvcGFnYXRlIHVwIGFuZCBibG9jayB0aGUgdG9vbFxuICAgIC8vIGNhbGwuIFRoZSB0cmVlIG1heSBhbHJlYWR5IGhhdmUgYmVlbiBoZWFsZWQgKHRyZWVNb2RpZmllZCBwcmVzZXJ2ZWQpLlxuICAgIHJldHVybiB7IGFkZGl0aW9uYWxDb250ZXh0OiBudWxsLCB0cmVlTW9kaWZpZWQgfTtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERlZmF1bHQgc3VicHJvY2Vzcy1iYWNrZWQgZXhlY3V0b3JzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgREVGQVVMVF9USU1FT1VUX01TID0gMTBfMDAwO1xuXG4vKiogUmVzb2x2ZSB0aGUgdG91Y2hlZCBmaWxlIHRvIGEgcGF0aCByZWxhdGl2ZSB0byBpdHMgcmVwbyByb290LCBmb3IgYGdpdCBzcGFuYC4gKi9cbmZ1bmN0aW9uIHJlcG9SZWxBcmcoZmlsZVBhdGg6IHN0cmluZywgY3dkOiBzdHJpbmcpOiB7IHJlcG9Sb290OiBzdHJpbmc7IHJlbFBhdGg6IHN0cmluZyB9IHwgbnVsbCB7XG4gIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gIGlmICghcmVwb1Jvb3QpIHJldHVybiBudWxsO1xuICByZXR1cm4geyByZXBvUm9vdCwgcmVsUGF0aDogcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3QsIGZpbGVQYXRoKSB9O1xufVxuXG4vKipcbiAqIEEgc25hcHNob3Qgb2YgdGhlIHNwYW4gcm9vdCdzIHdvcmtpbmctdHJlZSBzdGF0dXMsIHVzZWQgdG8gZGV0ZWN0IHdoZXRoZXIgYVxuICogYC0tZml4YCByZS1hbmNob3JlZCBhbnl0aGluZy4gQ29tcGFyZWQgYmVmb3JlL2FmdGVyOyBhbiB1bnJlc29sdmFibGUgcmVwbyBvclxuICogYSBmYWlsZWQgc3RhdHVzIHlpZWxkcyBhIHN0YWJsZSBlbXB0eSBzdHJpbmcgKFx1MjE5MiBgbW9kaWZpZWQ6IGZhbHNlYCkuXG4gKi9cbmZ1bmN0aW9uIHNwYW5TdGF0dXNTbmFwc2hvdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgc3BhblJvb3QgPSByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3QpO1xuICB0cnkge1xuICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ3N0YXR1cycsICctLXBvcmNlbGFpbicsICctLScsIHNwYW5Sb290XSwge1xuICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgdGltZW91dDogREVGQVVMVF9USU1FT1VUX01TXG4gICAgfSk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnJztcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBwcm9kdWN0aW9uIGV4ZWN1dGlvbiBzdXJmYWNlOiB0aHJlZSBzdWJwcm9jZXNzLWJhY2tlZCBleGVjdXRvcnMgZm9sbG93aW5nXG4gKiBzcGFuLXN1cmZhY2UudHMncyBgY3JlYXRlRGVmYXVsdCpFeGVjdXRvcmAgc3R5bGUuIEVhY2ggY2FwdHVyZXMgc3Rkb3V0IGV2ZW4gb25cbiAqIGEgbm9uLXplcm8gZXhpdCB3aGVyZSB0aGUgQ0xJIHN0aWxsIGVtaXRzIHVzZWZ1bCBvdXRwdXQsIGFuZCBldmVyeSBmYWlsdXJlXG4gKiBtb2RlIChhYnNlbnQgYmluYXJ5LCB0aW1lb3V0LCBwYXJzZSBmYWlsdXJlKSBzdXJmYWNlcyBhcyBhbiBlbXB0eS9jbGVhbiByZXN1bHRcbiAqIHNvIHtAbGluayBydW5Ub3VjaEhvb2t9J3MgZmFpbC1vcGVuIGNvbnRyYWN0IGhvbGRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdFRvdWNoRXhlY3V0b3JzKHRpbWVvdXRNczogbnVtYmVyID0gREVGQVVMVF9USU1FT1VUX01TKTogVG91Y2hFeGVjdXRvcnMge1xuICByZXR1cm4ge1xuICAgIGZpeDogYXN5bmMgKGZpbGVQYXRoLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlc29sdmVkID0gcmVwb1JlbEFyZyhmaWxlUGF0aCwgY3dkKTtcbiAgICAgIGlmICghcmVzb2x2ZWQpIHJldHVybiB7IG1vZGlmaWVkOiBmYWxzZSB9O1xuICAgICAgY29uc3QgYmVmb3JlID0gc3BhblN0YXR1c1NuYXBzaG90KHJlc29sdmVkLnJlcG9Sb290KTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2RyaWZ0JywgcmVzb2x2ZWQucmVsUGF0aCwgJy0tZml4J10sIHtcbiAgICAgICAgICBjd2Q6IHJlc29sdmVkLnJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICB2b2lkIGVycjsgLy8gYGdpdCBzcGFuIGRyaWZ0YCBleGl0cyAxIG9uIGRyaWZ0IGV2ZW4gd2hlbiBgLS1maXhgIGhlYWxlZCBzb21ldGhpbmcsIGFuZFxuICAgICAgICAvLyBub24temVybyBvbiBnZW51aW5lIGZhaWx1cmU7IHRoZSBzbmFwc2hvdCBkaWZmIGlzIHRoZSBzb3VyY2Ugb2ZcbiAgICAgICAgLy8gdHJ1dGggZm9yIHdoZXRoZXIgdGhlIHRyZWUgY2hhbmdlZCwgc28gdGhlIGV4aXQgY29kZSBpcyBpZ25vcmVkIGhlcmUuXG4gICAgICB9XG4gICAgICBjb25zdCBhZnRlciA9IHNwYW5TdGF0dXNTbmFwc2hvdChyZXNvbHZlZC5yZXBvUm9vdCk7XG4gICAgICByZXR1cm4geyBtb2RpZmllZDogYmVmb3JlICE9PSBhZnRlciB9O1xuICAgIH0sXG5cbiAgICBsaXN0OiBhc3luYyAoZmlsZVBhdGgsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVzb2x2ZWQgPSByZXBvUmVsQXJnKGZpbGVQYXRoLCBjd2QpO1xuICAgICAgaWYgKCFyZXNvbHZlZCkgcmV0dXJuIFtdO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnbGlzdCcsICctLXBvcmNlbGFpbicsIHJlc29sdmVkLnJlbFBhdGhdLCB7XG4gICAgICAgICAgY3dkOiByZXNvbHZlZC5yZXBvUm9vdCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBwYXJzZVBvcmNlbGFpbihvdXQpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgZHJpZnQ6IGFzeW5jIChhcmdzLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBjb25zdCBydW5Dd2QgPSByZXBvUm9vdCA/PyBjd2Q7XG4gICAgICAvLyBUaGUgY29yZSBwYXNzZXMgYW4gYWJzb2x1dGUgZmlsZSBwYXRoOyBzY29wZSBgZ2l0IHNwYW4gZHJpZnRgIHRvIGl0XG4gICAgICAvLyByZWxhdGl2ZSB0byB0aGUgcmVwbyByb290IHNvIHRoZSBwYXRoIGluZGV4IHJlc29sdmVzIGl0LlxuICAgICAgY29uc3Qgc2NvcGVkID0gcmVwb1Jvb3QgPyBhcmdzLm1hcCgoYSkgPT4gcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3QsIGEpKSA6IGFyZ3M7XG4gICAgICBsZXQgb3V0OiBzdHJpbmc7XG4gICAgICB0cnkge1xuICAgICAgICBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdkcmlmdCcsICctLWZvcm1hdCcsICdwb3JjZWxhaW4nLCAuLi5zY29wZWRdLCB7XG4gICAgICAgICAgY3dkOiBydW5Dd2QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGNvbnN0IGNhcHR1cmVkID0gKGVyciBhcyB7IHN0ZG91dD86IHN0cmluZyB9KS5zdGRvdXQ7XG4gICAgICAgIGlmICh0eXBlb2YgY2FwdHVyZWQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgb3V0ID0gY2FwdHVyZWQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gcGFyc2VEcmlmdFBvcmNlbGFpbihvdXQpO1xuICAgIH0sXG5cbiAgICB3aHk6IGFzeW5jIChuYW1lLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICd3aHknLCBuYW1lXSwge1xuICAgICAgICAgIGN3ZDogcmVwb1Jvb3QgPz8gY3dkLFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgdGV4dCA9IG91dC50cmltRW5kKCk7XG4gICAgICAgIC8vIEJhcmUgYGdpdCBzcGFuIHdoeWAgcHJpbnRzIHRoaXMgZXhhY3Qgc2VudGluZWwgKGV4aXQgMCkgd2hlbiB0aGVcbiAgICAgICAgLy8gc3BhbiBoYXMgbm8gd2h5IHJlY29yZGVkIFx1MjAxNCB0cmVhdCBpdCBhcyBcIm5vIHdoeVwiLCBub3QgYXMgY29udGVudC5cbiAgICAgICAgaWYgKHRleHQubGVuZ3RoID09PSAwIHx8IHRleHQgPT09IGBcXGAke25hbWV9XFxgIGhhcyBubyB3aHkgcmVjb3JkZWQuYCkgcmV0dXJuIG51bGw7XG4gICAgICAgIHJldHVybiB0ZXh0O1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgIH1cbiAgfTtcbn1cbiIsICIvKipcbiAqIFNoYXJlZCBib3gtZHJhd2luZyB0cmVlIHJlbmRlcmVyIGZvciBhIHNwYW4ncyBhbmNob3IgbGlzdCwgdXNlZCBieSBldmVyeVxuICogY2FsbCBzaXRlIHRoYXQgdG9kYXkgcHJpbnRzIGEgZmxhdCBgLSBwYXRoI0xzdGFydC1MZW5kYCBidWxsZXQgcnVuXG4gKiAoYHRvdWNoLWNvcmUudHNgJ3MgYGFuY2hvckJ1bGxldHNgLCBhbmQgYGFkdmlzb3ItY29yZS50c2Anc1xuICogYGFubm90YXRlQmxvY2tzYC9gZ3JvdXBDb3ZlcmluZ0J5TmFtZWApLiBBbmNob3JzIHRoYXQgc2hhcmUgYSBkaXJlY3RvcnlcbiAqIHByZWZpeCBjb2xsYXBzZSBpbnRvIG9uZSB0cmVlIGluc3RlYWQgb2YgYmVpbmcgcmVjb25zdHJ1Y3RlZCBieSBleWUgZnJvbSBhXG4gKiBmbGF0IGxpc3QgXHUyMDE0IHRoZSBtb3RpdmF0aW5nIGNhc2UgaXMgcGFyaXR5IGFuY2hvcnMgdW5kZXIgcGFyYWxsZWxcbiAqIGBwdWJsaWMvY2xhdWRlLy4uLmAvYHB1YmxpYy9jb2RleC8uLi5gIHRyZWVzLlxuICpcbiAqIFRoaXMgbW9kdWxlIGlzIGEgcHVyZSBwcmVzZW50YXRpb24gdHJhbnNmb3JtOiBpdCBuZXZlciBjb21wdXRlcyBkcmlmdFxuICogc3RhdHVzIG9yIGRlY2lkZXMgd2hpY2ggYW5jaG9ycyBhcmUgc3VyZmFjZWQuIENhbGxlcnMgcHJlY29tcHV0ZSBlYWNoIHJvdydzXG4gKiBgc3VmZml4YCAoZS5nLiBgIFx1MjAxNCBjaGFuZ2VkYCkgZXhhY3RseSBhcyB0aGV5IGRvIHRvZGF5LCBhbmQgb25seSB0aGUgKnNoYXBlKlxuICogb2YgdGhlIHByaW50ZWQgbGlzdCBjaGFuZ2VzLlxuICovXG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUHVibGljIHR5cGVzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBIb3cgYSBzaW5nbGUgYW5jaG9yJ3MgbGluZSByYW5nZSBpcyBrbm93bi4gYHJhbmdlYCBhbmQgYHdob2xlLWZpbGVgIGFyZSB0aGVcbiAqIHR3byBzaGFwZXMgZXZlcnkgYW5jaG9yIHRha2VzIHRvZGF5OyBgdHJ1bmNhdGVkYCBpcyBhIGRlZmVuc2l2ZSB0aGlyZCBzaGFwZVxuICogcmVhY2hhYmxlIG9ubHkgZnJvbSByZS1wYXJzaW5nIHRoZSBDTEkncyBmbGF0IGh1bWFuLWZvcm1hdCB0ZXh0IChhIGAjTGBcbiAqIGZyYWdtZW50IHRoYXQgZG9lc24ndCBjbGVhbmx5IG1hdGNoIGAjTHN0YXJ0LUxlbmRgKS5cbiAqXG4gKiBWZXJpZmllZCBpbnZhcmlhbnQ6IHRoZSBzdHJ1Y3R1cmVkLWRhdGEgY2FsbCBzaXRlcyBjYW4gbmV2ZXIgcHJvZHVjZVxuICogYHRydW5jYXRlZGAuIGBwYXJzZVBvcmNlbGFpbmAgKGFnZW50LWhvb2tzLWNvbW1vbi50cykgYGNvbnRpbnVlYHMgcGFzdCBhbnlcbiAqIHJvdyBtaXNzaW5nIGEgdmFsaWQgcmFuZ2UsIHNvIGFuIGluY29tcGxldGUgYFBvcmNlbGFpblJvd2AgY2FuIG5ldmVyIGJlXG4gKiBjb25zdHJ1Y3RlZDsgdGhlIFJ1c3QgQ0xJJ3Mgb3duIHBvcmNlbGFpbiB3cml0ZXIgYWx3YXlzIGVtaXRzIGEgcmFuZ2VcbiAqIGNvbHVtbiAoYDAtMGAgZm9yIHdob2xlLWZpbGUpLiBgdHJ1bmNhdGVkYCBpcyByZWFjaGFibGUgb25seSBmcm9tXG4gKiBgYW5ub3RhdGVCbG9ja3NgJyBmbGF0LXRleHQgcGFyc2luZyBvZiBgYmxvY2tzVGV4dGAgaW4gYSBsYXRlciBwaGFzZS5cbiAqL1xuZXhwb3J0IHR5cGUgUmFuZ2VMYWJlbCA9IHsga2luZDogJ3JhbmdlJzsgc3RhcnQ6IG51bWJlcjsgZW5kOiBudW1iZXIgfSB8IHsga2luZDogJ3dob2xlLWZpbGUnIH0gfCB7IGtpbmQ6ICd0cnVuY2F0ZWQnIH07XG5cbi8qKiBPbmUgc3RhY2tlZCByYW5nZSB1bmRlciBhIGBUcmVlQW5jaG9yYCwgd2l0aCBpdHMgcHJlY29tcHV0ZWQgZHJpZnQgc3VmZml4LiAqL1xuZXhwb3J0IGludGVyZmFjZSBSYW5nZUVudHJ5IHtcbiAgcmFuZ2U6IFJhbmdlTGFiZWw7XG4gIC8qKiBQcmVjb21wdXRlZCBgIFx1MjAxNCBjaGFuZ2VkYCAoZXRjLiksIG9yIGAnJ2Agd2hlbiB0aGUgYW5jaG9yIGNhcnJpZXMgbm8gZHJpZnQuICovXG4gIHN1ZmZpeDogc3RyaW5nO1xufVxuXG4vKiogT25lIGRpc3RpbmN0IHBhdGgncyBjb2xsYXBzZWQgYW5jaG9yIGVudHJ5LCByZWFkeSBmb3IgdHJlZSBsYXlvdXQuICovXG5leHBvcnQgaW50ZXJmYWNlIFRyZWVBbmNob3Ige1xuICAvKiogUmVwby1yZWxhdGl2ZSwgcG9zaXgtc2VwYXJhdGVkIHBhdGguICovXG4gIHBhdGg6IHN0cmluZztcbiAgLyoqXG4gICAqIFN0YWNrZWQgcmFuZ2VzIG9uIHRoaXMgcGF0aC4gRW1wdHkgbWVhbnMgXCJwYXRoIG9ubHksIG5vIHJhbmdlIGNvbHVtbiBhdFxuICAgKiBhbGxcIiBcdTIwMTQgYSBiYXJlLXBhdGggbGVhZiwgZGlzdGluY3QgZnJvbSBhIHNpbmdsZSBgd2hvbGUtZmlsZWAgZW50cnkgKHdoaWNoXG4gICAqIHJlbmRlcnMgdGhlIHBhdGggdG9vLCBidXQgaXMgYW4gZXhwbGljaXQgcmFuZ2Uta2luZCBjbGFzc2lmaWNhdGlvbikuXG4gICAqL1xuICByYW5nZXM6IFJhbmdlRW50cnlbXTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBjb2xsYXBzZUJ5UGF0aFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogQ29sbGFwc2Ugcm93cyB0aGF0IG5hbWUgdGhlIHNhbWUgcGF0aCBpbnRvIG9uZSBgVHJlZUFuY2hvcmAgd2l0aCBzdGFja2VkXG4gKiByYW5nZXMsIHByZXNlcnZpbmcgZmlyc3Qtc2VlbiBvcmRlci4gYHJlbmRlckFuY2hvclRyZWVgJ3MgY29udHJhY3QgcmVxdWlyZXNcbiAqIGF0IG1vc3Qgb25lIGBUcmVlQW5jaG9yYCBwZXIgZGlzdGluY3QgcGF0aCBcdTIwMTQgdGhpcyBpcyB0aGUgbWFuZGF0b3J5XG4gKiBwcmUtcHJvY2Vzc2luZyBzdGVwIGV2ZXJ5IGNhbGxlciBydW5zIGZpcnN0IHRvIGd1YXJhbnRlZSB0aGF0LlxuICpcbiAqIE1pcnJvcnMgdGhlIG9yZGVyLWFycmF5LXBsdXMtTWFwIGlkaW9tIGFscmVhZHkgdXNlZCBieVxuICogYGRlZHVwZUJ5QW5jaG9yKClgIChhZHZpc29yLWNvcmUudHMpIGZvciB0aGUgc2FtZSByZWFzb246IHRoZSBDTEkgY2FuIGVtaXRcbiAqIG11bHRpcGxlIHJvd3MgZm9yIG9uZSBsb2dpY2FsIHBhdGgsIGFuZCB0aGUgKnBvc2l0aW9uKiBvZiBhIGxhdGVyXG4gKiBzYW1lLXBhdGggcm93IGlzIHN1YnN1bWVkIGludG8gdGhhdCBwYXRoJ3MgZmlyc3Qgb2NjdXJyZW5jZSwgbm90IGFwcGVuZGVkXG4gKiBhdCBpdHMgb3duIGxhdGVyIHBvc2l0aW9uLiBDb25jcmV0ZWx5OiBgYS50cyNMMS1MNWAsIGBiLnRzI0wxLUw1YCxcbiAqIGBhLnRzI0w5LUwxMmAgY29sbGFwc2VzIHRvIGBbYS50cyAodHdvIHN0YWNrZWQgcmFuZ2VzKSwgYi50cyAob25lIHJhbmdlKV1gXG4gKiBcdTIwMTQgYGEudHNgIHNpdHMgYXQgcG9zaXRpb24gMCwgaXRzIGZpcnN0IG9jY3VycmVuY2UsIG5vdCBpdHMgbGFzdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbGxhcHNlQnlQYXRoKHJvd3M6IHsgcGF0aDogc3RyaW5nOyByYW5nZTogUmFuZ2VMYWJlbDsgc3VmZml4OiBzdHJpbmcgfVtdKTogVHJlZUFuY2hvcltdIHtcbiAgY29uc3Qgb3JkZXI6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGJ5UGF0aCA9IG5ldyBNYXA8c3RyaW5nLCBUcmVlQW5jaG9yPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgbGV0IGFuY2hvciA9IGJ5UGF0aC5nZXQocm93LnBhdGgpO1xuICAgIGlmICghYW5jaG9yKSB7XG4gICAgICBhbmNob3IgPSB7IHBhdGg6IHJvdy5wYXRoLCByYW5nZXM6IFtdIH07XG4gICAgICBieVBhdGguc2V0KHJvdy5wYXRoLCBhbmNob3IpO1xuICAgICAgb3JkZXIucHVzaChyb3cucGF0aCk7XG4gICAgfVxuICAgIGFuY2hvci5yYW5nZXMucHVzaCh7IHJhbmdlOiByb3cucmFuZ2UsIHN1ZmZpeDogcm93LnN1ZmZpeCB9KTtcbiAgfVxuICByZXR1cm4gb3JkZXIubWFwKChwYXRoKSA9PiBieVBhdGguZ2V0KHBhdGgpIGFzIFRyZWVBbmNob3IpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRyZWUgY29uc3RydWN0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuaW50ZXJmYWNlIExlYWZOb2RlIHtcbiAga2luZDogJ2xlYWYnO1xuICBuYW1lOiBzdHJpbmc7XG4gIGFuY2hvcjogVHJlZUFuY2hvcjtcbn1cblxuaW50ZXJmYWNlIERpck5vZGUge1xuICBraW5kOiAnZGlyJztcbiAgbmFtZTogc3RyaW5nO1xuICBjaGlsZHJlbjogUGF0aFRyZWVOb2RlW107XG59XG5cbnR5cGUgUGF0aFRyZWVOb2RlID0gTGVhZk5vZGUgfCBEaXJOb2RlO1xuXG4vKipcbiAqIFNwbGl0IGEgcGF0aCBpbnRvIGAvYC1zZXBhcmF0ZWQgc2VnbWVudHMsIG9yIGBudWxsYCB3aGVuIGRvaW5nIHNvIHdvdWxkXG4gKiBmZWVkIGFuIGVtcHR5LXN0cmluZyBzZWdtZW50IGludG8gdGhlIHRyaWUgKGEgbGVhZGluZyBgL2AsIGEgdHJhaWxpbmcgYC9gLFxuICogYSBkb3VibGVkIGAvL2AsIG9yIHRoZSBlbXB0eSBzdHJpbmcpLiBgbnVsbGAgc2lnbmFscyB0aGUgY2FsbGVyIHRvIHJlbmRlclxuICogdGhhdCBhbmNob3IncyBmdWxsIHBhdGggc3RyaW5nIGFzIGEgc2luZ2xlLCB1bnNwbGl0LCBhdG9taWMgdG9wLWxldmVsIGxlYWZcbiAqIGluc3RlYWQgb2YgYXR0ZW1wdGluZyB0byBuZXN0IGl0IFx1MjAxNCBhIGtub3duLWVudW1lcmFibGUgY2xhc3Mgb2YgbWFsZm9ybWVkXG4gKiBwYXRocyBnZXRzIGEgcmVhbCBydWxlIGhlcmUgcmF0aGVyIHRoYW4gdGhlIHNwbGl0IHJ1bm5pbmcgYW55d2F5IGFuZFxuICogZmFicmljYXRpbmcgYW4gZW1wdHktbmFtZWQgZGlyZWN0b3J5IG5vZGUuIEEgYmFyZSBmaWxlbmFtZSB3aXRoIG5vIGAvYCBhdFxuICogYWxsIHByb2R1Y2VzIGV4YWN0bHkgb25lIG5vbi1lbXB0eSBzZWdtZW50IGFuZCBpcyBoYW5kbGVkIGJ5IHRoZSBvcmRpbmFyeVxuICogcGF0aCBiZWxvdyAoaXQgYmVjb21lcyBhIHRvcC1sZXZlbCBsZWFmIHdpdGggbm8gZGlyZWN0b3J5IHRvIG5lc3QgdW5kZXIgXHUyMDE0XG4gKiBhbHJlYWR5IGF0b21pYywgbm8gc3BlY2lhbCBjYXNlIG5lZWRlZCkuXG4gKi9cbmZ1bmN0aW9uIHNwbGl0U2VnbWVudHMocGF0aDogc3RyaW5nKTogc3RyaW5nW10gfCBudWxsIHtcbiAgaWYgKHBhdGgubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgY29uc3Qgc2VnbWVudHMgPSBwYXRoLnNwbGl0KCcvJyk7XG4gIGlmIChzZWdtZW50cy5zb21lKChzZWdtZW50KSA9PiBzZWdtZW50Lmxlbmd0aCA9PT0gMCkpIHJldHVybiBudWxsO1xuICByZXR1cm4gc2VnbWVudHM7XG59XG5cbmZ1bmN0aW9uIGZpbmRPckNyZWF0ZURpcihwYXJlbnQ6IERpck5vZGUsIG5hbWU6IHN0cmluZyk6IERpck5vZGUge1xuICBmb3IgKGNvbnN0IGNoaWxkIG9mIHBhcmVudC5jaGlsZHJlbikge1xuICAgIGlmIChjaGlsZC5raW5kID09PSAnZGlyJyAmJiBjaGlsZC5uYW1lID09PSBuYW1lKSByZXR1cm4gY2hpbGQ7XG4gIH1cbiAgY29uc3Qgbm9kZTogRGlyTm9kZSA9IHsga2luZDogJ2RpcicsIG5hbWUsIGNoaWxkcmVuOiBbXSB9O1xuICBwYXJlbnQuY2hpbGRyZW4ucHVzaChub2RlKTtcbiAgcmV0dXJuIG5vZGU7XG59XG5cbi8qKiBJbnNlcnQgb25lIGFuY2hvciBpbnRvIHRoZSB0cmllLCBjcmVhdGluZy9yZXVzaW5nIGRpcmVjdG9yeSBub2RlcyBpbiBhcnJpdmFsIG9yZGVyLiAqL1xuZnVuY3Rpb24gaW5zZXJ0QW5jaG9yKHJvb3Q6IERpck5vZGUsIHNlZ21lbnRzOiBzdHJpbmdbXSwgYW5jaG9yOiBUcmVlQW5jaG9yKTogdm9pZCB7XG4gIGxldCBjdXIgPSByb290O1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHNlZ21lbnRzLmxlbmd0aCAtIDE7IGkrKykge1xuICAgIGN1ciA9IGZpbmRPckNyZWF0ZURpcihjdXIsIHNlZ21lbnRzW2ldKTtcbiAgfVxuICBjdXIuY2hpbGRyZW4ucHVzaCh7IGtpbmQ6ICdsZWFmJywgbmFtZTogc2VnbWVudHNbc2VnbWVudHMubGVuZ3RoIC0gMV0sIGFuY2hvciB9KTtcbn1cblxuLyoqXG4gKiBCdWlsZCB0aGUgdG9wLWxldmVsIGZvcmVzdCBmcm9tIGEgYFRyZWVBbmNob3JbXWAgYWxyZWFkeSBjb2xsYXBzZWQgYnlcbiAqIGBjb2xsYXBzZUJ5UGF0aGAuIFNpYmxpbmcgb3JkZXIgaXMgbmV2ZXIgcmUtc29ydGVkIFx1MjAxNCBhIHBhdGggZWl0aGVyIG9wZW5zIGFcbiAqIG5ldyBub2RlIGF0IGl0cyBhcnJpdmFsIHBvc2l0aW9uIG9yIGlzIG5lc3RlZCB1bmRlciBhIGRpcmVjdG9yeSBub2RlXG4gKiBjcmVhdGVkL3JldXNlZCBhdCB0aGF0IGRpcmVjdG9yeSdzIG93biBmaXJzdC1vY2N1cnJlbmNlIHBvc2l0aW9uLlxuICovXG5mdW5jdGlvbiBidWlsZEZvcmVzdChhbmNob3JzOiBUcmVlQW5jaG9yW10pOiBQYXRoVHJlZU5vZGVbXSB7XG4gIGNvbnN0IHJvb3Q6IERpck5vZGUgPSB7IGtpbmQ6ICdkaXInLCBuYW1lOiAnJywgY2hpbGRyZW46IFtdIH07XG4gIGZvciAoY29uc3QgYW5jaG9yIG9mIGFuY2hvcnMpIHtcbiAgICBjb25zdCBzZWdtZW50cyA9IHNwbGl0U2VnbWVudHMoYW5jaG9yLnBhdGgpO1xuICAgIGlmIChzZWdtZW50cyA9PT0gbnVsbCkge1xuICAgICAgcm9vdC5jaGlsZHJlbi5wdXNoKHsga2luZDogJ2xlYWYnLCBuYW1lOiBhbmNob3IucGF0aCwgYW5jaG9yIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGluc2VydEFuY2hvcihyb290LCBzZWdtZW50cywgYW5jaG9yKTtcbiAgfVxuICByZXR1cm4gcm9vdC5jaGlsZHJlbjtcbn1cblxuLyoqIEEgbm9kZSBwYWlyZWQgd2l0aCB0aGUgKHBvc3NpYmx5IGZvbGRlZCkgbmFtZSBpdCBkaXNwbGF5cyBvbiBpdHMgb3duIGxpbmUuICovXG5pbnRlcmZhY2UgRGlzcGxheUl0ZW0ge1xuICBuYW1lOiBzdHJpbmc7XG4gIG5vZGU6IFBhdGhUcmVlTm9kZTtcbn1cblxuLyoqXG4gKiBGb2xkIGEgY2hhaW4gb2Ygc2luZ2xlLWNoaWxkIG5vZGVzIGludG8gb25lIGNvbWJpbmVkIG5hbWVcbiAqIChgcHVibGljL2NsYXVkZS9ydW50aW1lL3NraWxscy9jYXJkYCwgYGRpcnR5L21vZC5yc2AsXG4gKiBgLmRldmNvbnRhaW5lci9Eb2NrZXJmaWxlYCkuIEZvbGRpbmcgY29udGludWVzIHdoaWxlIHRoZSBjdXJyZW50IG5vZGUgaXMgYVxuICogZGlyZWN0b3J5IHdpdGggKipleGFjdGx5IG9uZSBjaGlsZCoqLCByZWdhcmRsZXNzIG9mIHdoZXRoZXIgdGhhdCBjaGlsZCBpcyBhXG4gKiBkaXJlY3Rvcnkgb3IgYSBsZWFmOiBhIG5vZGUgd2l0aCBvbmUgY2hpbGQgY29udmV5cyBubyBncm91cGluZyBieVxuICogZGVmaW5pdGlvbiwgc28gZm9sZGluZyBpdCBsb3NlcyBubyBzdHJ1Y3R1cmUgd2hpbGUgcmVtb3ZpbmcgYSBsaW5lIHdob3NlXG4gKiBvbmx5IGNvbnRlbnQgaXMgYSBjb25uZWN0b3IuIFN0b3BzIGF0IHRoZSBmaXJzdCBkaXJlY3Rvcnkgd2l0aCAyKyBjaGlsZHJlblxuICogKGV4cGFuZCBmcm9tIHRoZXJlKSBvciBhdCBhIGxlYWYgKHdoaWNoIHRoZW4gcmVuZGVycyB3aXRoIHRoZSBmb2xkZWQgbmFtZSkuXG4gKlxuICogRm9sZGluZyBsb25lICpsZWF2ZXMqIFx1MjAxNCBub3QganVzdCBsb25lIGRpcmVjdG9yaWVzIFx1MjAxNCBpcyB3aGF0IGtlZXBzIHRoZSB0cmVlXG4gKiBubyB0YWxsZXIgdGhhbiB0aGUgZmxhdCBidWxsZXQgbGlzdCBpdCByZXBsYWNlcywgYW5kIHdoYXQgbWFrZXMgYSBzaW5nbGVcbiAqIGFuY2hvciByZW5kZXIgYXMgdGhlIG9uZS1saW5lIHRyZWUgdGhlIHBsYW4gcHJvbWlzZXMgZXZlbiB3aGVuIGl0cyBwYXRoIGhhc1xuICogZGlyZWN0b3JpZXMgaW4gaXQuIEl0IGFsc28ga2VlcHMgdGhlIGRpc2NyaW1pbmF0aW5nIHNlZ21lbnQgb24gdGhlIHNhbWVcbiAqIGxpbmUgYXMgaXRzIHJhbmdlIChgZGlydHkvbW9kLnJzICNMMzkyLUwzOTlgKSBmb3IgYG1vZC5yc2AvYGluZGV4LnRzYFxuICogbGF5b3V0cywgd2hlcmUgdGhlIGZpbGVuYW1lIGFsb25lIGlkZW50aWZpZXMgbm90aGluZy5cbiAqL1xuZnVuY3Rpb24gZm9sZENoYWluKG5vZGU6IFBhdGhUcmVlTm9kZSk6IERpc3BsYXlJdGVtIHtcbiAgbGV0IG5hbWUgPSBub2RlLm5hbWU7XG4gIGxldCBjdXIgPSBub2RlO1xuICB3aGlsZSAoY3VyLmtpbmQgPT09ICdkaXInICYmIGN1ci5jaGlsZHJlbi5sZW5ndGggPT09IDEpIHtcbiAgICBjb25zdCBjaGlsZCA9IGN1ci5jaGlsZHJlblswXTtcbiAgICBuYW1lID0gYCR7bmFtZX0vJHtjaGlsZC5uYW1lfWA7XG4gICAgY3VyID0gY2hpbGQ7XG4gIH1cbiAgcmV0dXJuIHsgbmFtZSwgbm9kZTogY3VyIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUmVuZGVyaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSYW5rIG9mIGEgc3RhY2tlZCBlbnRyeSdzIHJhbmdlIGtpbmQ6IGB3aG9sZS1maWxlYCBmaXJzdCwgdGhlbiBudW1lcmljXG4gKiBgcmFuZ2VgcywgdGhlbiBgdHJ1bmNhdGVkYC4gQSB3aG9sZS1maWxlIGFuY2hvciBpcyB0aGUgQ0xJJ3MgYDAtMGAgcm93IFx1MjAxNCBpdFxuICogY292ZXJzIHRoZSBlbnRpcmUgZmlsZSwgc28gaXQgc29ydHMgYWhlYWQgb2YgZXZlcnkgbGluZSByYW5nZSBvbiB0aGF0IGZpbGVcbiAqIHRoZSBzYW1lIHdheSBsaW5lIDAgd291bGQuIGB0cnVuY2F0ZWRgIGNhcnJpZXMgbm8gcG9zaXRpb24gYXQgYWxsIGFuZCBzb3J0c1xuICogbGFzdC5cbiAqL1xuZnVuY3Rpb24gcmFuZ2VSYW5rKHJhbmdlOiBSYW5nZUxhYmVsKTogbnVtYmVyIHtcbiAgc3dpdGNoIChyYW5nZS5raW5kKSB7XG4gICAgY2FzZSAnd2hvbGUtZmlsZSc6XG4gICAgICByZXR1cm4gMDtcbiAgICBjYXNlICdyYW5nZSc6XG4gICAgICByZXR1cm4gMTtcbiAgICBjYXNlICd0cnVuY2F0ZWQnOlxuICAgICAgcmV0dXJuIDI7XG4gIH1cbn1cblxuLyoqXG4gKiBTdGFja2VkLXJhbmdlIG9yZGVyIGlzIGJ5IGtpbmQgcmFuayB0aGVuIG51bWVyaWMgKGBzdGFydGAgdGhlbiBgZW5kYCksXG4gKiBvdmVycmlkaW5nIGFycml2YWwgb3IgY29kZXBvaW50IG9yZGVyIFx1MjAxNCB0aGUgb25seSBzb3J0aW5nIHRoaXMgbW9kdWxlIGRvZXMsXG4gKiBhbmQgc2NvcGVkIHN0cmljdGx5IHRvIHJhbmdlcyBzdGFja2VkIG9uIG9uZSBwYXRoIChuZXZlciB0byBzaWJsaW5nIHBhdGhzXG4gKiBvciBkaXJlY3Rvcnkgb3JkZXIpLiBFcXVhbC1yYW5rZWQgZW50cmllcyAodHdvIGB0cnVuY2F0ZWRgcywgb3IgdHdvXG4gKiBpZGVudGljYWwgcmFuZ2VzKSBrZWVwIHRoZWlyIG93biByZWxhdGl2ZSBhcnJpdmFsIG9yZGVyLCBzaW5jZSB0aGUgc29ydCBpc1xuICogc3RhYmxlLlxuICovXG5mdW5jdGlvbiBjb21wYXJlUmFuZ2VFbnRyaWVzKGE6IFJhbmdlRW50cnksIGI6IFJhbmdlRW50cnkpOiBudW1iZXIge1xuICBjb25zdCByYW5rID0gcmFuZ2VSYW5rKGEucmFuZ2UpIC0gcmFuZ2VSYW5rKGIucmFuZ2UpO1xuICBpZiAocmFuayAhPT0gMCkgcmV0dXJuIHJhbms7XG4gIGlmIChhLnJhbmdlLmtpbmQgPT09ICdyYW5nZScgJiYgYi5yYW5nZS5raW5kID09PSAncmFuZ2UnKSB7XG4gICAgcmV0dXJuIGEucmFuZ2Uuc3RhcnQgLSBiLnJhbmdlLnN0YXJ0IHx8IGEucmFuZ2UuZW5kIC0gYi5yYW5nZS5lbmQ7XG4gIH1cbiAgcmV0dXJuIDA7XG59XG5cbi8qKlxuICogVGhlIHJhbmdlIGNvbHVtbidzIHRleHQsIG9yIGBudWxsYCB3aGVuIHRoZSBlbnRyeSBwcmludHMgYXMgYSBiYXJlIHBhdGhcbiAqIHdpdGggbm8gcmFuZ2UgY29sdW1uIGF0IGFsbC5cbiAqXG4gKiBBIGB3aG9sZS1maWxlYCBlbnRyeSBpcyB0aGUgb25lIGtpbmQgd2hvc2UgcmVuZGVyaW5nIGRlcGVuZHMgb24gY29udGV4dC5cbiAqIEFsb25lIG9uIGl0cyBwYXRoIGl0IHN0YXlzIGEgYmFyZSBwYXRoIHdpdGggemVybyBtYXJrZXIgXHUyMDE0IHRoYXQgaXMgd2hhdCB0aGVcbiAqIENMSSdzIG93biBmbGF0IGxpc3QgcHJpbnRzIGZvciBhIHdob2xlLWZpbGUgYW5jaG9yLCBhbmQgYWRkaW5nIGEgbWFya2VyXG4gKiB0aGVyZSB3b3VsZCBhbm5vdGF0ZSB0aGUgb3ZlcndoZWxtaW5nbHkgY29tbW9uIGNhc2UgZm9yIHRoZSBiZW5lZml0IG9mIHRoZVxuICogcmFyZSBvbmUuICpTdGFja2VkKiBiZWhpbmQgb3RoZXIgcmFuZ2VzIG9uIHRoZSBzYW1lIHBhdGggaXQgbXVzdCBjYXJyeSBhblxuICogZXhwbGljaXQgbWFya2VyOiB3aXRob3V0IG9uZSBpdCByZW5kZXJzIGFzIGEgY29udGludWF0aW9uIGxpbmUgaG9sZGluZ1xuICogbm90aGluZyBidXQgaW5kZW50YXRpb24gYW5kIGl0cyBkcmlmdCBzdWZmaXgsIHdoaWNoIGVyYXNlcyB0aGUgYW5jaG9yXG4gKiBvdXRyaWdodCB3aGVuIHRoZSBzdWZmaXggaXMgZW1wdHkgYW5kIFx1MjAxNCB3b3JzZSBcdTIwMTQgaGFuZ3MgaXRzIGAgXHUyMDE0IGNoYW5nZWRgXG4gKiB1bmRlciBhIG5laWdoYm91cmluZyByYW5nZSwgZXhhY3RseSB0aGUgdmlzdWFsIGdyYW1tYXIgdGhhdCBtZWFucyBcImFub3RoZXJcbiAqIHJhbmdlIG9uIHRoaXMgc2FtZSBmaWxlXCIuIFRoZSByZWFkZXIgd291bGQgdGhlbiByZWNvbmNpbGUgdGhlIHJhbmdlIHRoYXRcbiAqIGRpZCBub3QgZHJpZnQuIE9mIHRoZSB0aHJlZSBmaXhlcyBhdmFpbGFibGUgKHByaW50IHRoZSBwYXRoIG9uXG4gKiBjb250aW51YXRpb24gbGluZXMsIHNvcnQgd2hvbGUtZmlsZSB0byBwb3NpdGlvbiAwLCBvciBzcGxpdCBpdCBpbnRvIGl0cyBvd25cbiAqIGxlYWYpLCBhbiBleHBsaWNpdCBtYXJrZXIgaXMgdGhlIG9ubHkgb25lIHRoYXQgbWFrZXMgdGhlIGVudHJ5IGlkZW50aWZpYWJsZVxuICogaW4gKmV2ZXJ5KiBwb3NpdGlvbiByYXRoZXIgdGhhbiBvbmx5IGluIHRoZSBwb3NpdGlvbiB0aGUgc29ydCBoYXBwZW5zIHRvXG4gKiBwdXQgaXQgaW47IHNvcnRpbmcgaXQgZmlyc3QgKHNlZSB7QGxpbmsgcmFuZ2VSYW5rfSkgaXMga2VwdCBhcyB3ZWxsIGJlY2F1c2VcbiAqIFwid2hvbGUgZmlsZSwgdGhlbiBpdHMgcmFuZ2VzIGluIGxpbmUgb3JkZXJcIiBpcyB0aGUgb3JkZXIgYSByZWFkZXIgZXhwZWN0cyxcbiAqIG5vdCBiZWNhdXNlIGlkZW50aWZpYWJpbGl0eSBkZXBlbmRzIG9uIGl0LlxuICovXG5mdW5jdGlvbiBsYWJlbEZvcihyYW5nZTogUmFuZ2VMYWJlbCwgc29sZTogYm9vbGVhbik6IHN0cmluZyB8IG51bGwge1xuICBzd2l0Y2ggKHJhbmdlLmtpbmQpIHtcbiAgICBjYXNlICdyYW5nZSc6XG4gICAgICByZXR1cm4gYCNMJHtyYW5nZS5zdGFydH0tTCR7cmFuZ2UuZW5kfWA7XG4gICAgY2FzZSAnd2hvbGUtZmlsZSc6XG4gICAgICByZXR1cm4gc29sZSA/IG51bGwgOiAnKHdob2xlIGZpbGUpJztcbiAgICBjYXNlICd0cnVuY2F0ZWQnOlxuICAgICAgcmV0dXJuICcodHJ1bmNhdGVkIGluIHNvdXJjZSBcdTIwMTQgYW5jaG9yIGluY29tcGxldGUpJztcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENvbHVtbiBtYXRoXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBUaGUgZ3JhcGhlbWUgc2VnbWVudGVyLCBjb25zdHJ1Y3RlZCBvbiBmaXJzdCB1c2UgYW5kIHRoZW4gY2FjaGVkIFx1MjAxNCBpbmNsdWRpbmdcbiAqIGEgY2FjaGVkIGBudWxsYCB3aGVuIGl0IGNhbm5vdCBiZSBjb25zdHJ1Y3RlZCBhdCBhbGwuXG4gKlxuICogTGF6eSBvbiBwdXJwb3NlLiBgSW50bGAgaXMgbm90IHBhcnQgb2YgdGhlIEphdmFTY3JpcHQgbGFuZ3VhZ2UgY29yZTogYSBOb2RlXG4gKiBidWlsdCBgLS13aXRoLWludGw9bm9uZWAgaGFzIG5vIGBJbnRsYCBnbG9iYWwgd2hhdHNvZXZlciwgYW5kIGBob29rcy5qc29uYFxuICogaW52b2tlcyBhIGJhcmUgYG5vZGVgIG9mZiB0aGUgdXNlcidzIGBQQVRIYCwgc28gYGVuZ2luZXMubm9kZWAgY29uc3RyYWluc1xuICogbm90aGluZyBoZXJlLiBDb25zdHJ1Y3RpbmcgdGhpcyBhdCBtb2R1bGUgc2NvcGUgcHV0IGEgYFJlZmVyZW5jZUVycm9yYCBpblxuICogdGhlIGJ1bmRsZXMnIHRvcC1sZXZlbCBzdGF0ZW1lbnRzLCB3aGVyZSBpdCB0aHJvd3MgYXQgKmltcG9ydCogXHUyMDE0IGJlZm9yZSBhbnlcbiAqIG9mIHRoZSBmYWlsLWNsb3NlZCBgdHJ5L2NhdGNoYCBibG9ja3MgaW4gYHJlbmRlckFuY2hvclJ1bmAsIGByZW5kZXJQYXRoUnVuYFxuICogYW5kIGBhbmNob3JCdWxsZXRzYCBleGlzdCB0byBjYXRjaCBpdC4gVGhlIGhvb2sgcHJvY2VzcyB0aGVuIGRpZWQgd2l0aCBleGl0XG4gKiAxLCB3aGljaCBDbGF1ZGUgQ29kZSB0cmVhdHMgYXMgYSBub24tYmxvY2tpbmcgaG9vayBlcnJvcjogdGhlIGNvbW1pdCBnYXRlXG4gKiBzaWxlbnRseSBhbGxvd2VkIHRoZSBjb21taXQgYW5kIHRoZSBkcmlmdCByZW1pbmRlciBzaWxlbnRseSB2YW5pc2hlZC5cbiAqIEJ1aWxkaW5nIGl0IGluc2lkZSB0aGUgcmVuZGVyIHBhdGggcHV0cyBhbnkgZmFpbHVyZSBiYWNrIGluc2lkZSB0aG9zZVxuICogY2F0Y2hlcy5cbiAqXG4gKiBGQUlMLUNMT1NFRCwgbm90IGEgYDxncmVlbmZpZWxkPmAtZm9yYmlkZGVuIGZhbGxiYWNrIFx1MjAxNCB0aGUgc2FtZSBjYXRlZ29yeSBhc1xuICogdGhlIGxvY2FsIGB0cnkvY2F0Y2hgIGJsb2NrcyBhdCB0aGlzIG1vZHVsZSdzIGNhbGwgc2l0ZXMsIGFuZCBsb2FkLWJlYXJpbmdcbiAqIGZvciB0aGUgc2FtZSByZWFzb24uIE5vdGhpbmcgaW4gdGhlIGNvbHVtbi1hbGlnbm1lbnQgcGF0aCBtYXkgYmUgYWJsZSB0b1xuICogY29zdCB0aGUgY29tbWl0IGdhdGUgb3IgdGhlIGRyaWZ0IHJlbWluZGVyOiBpZiBkaXNwbGF5IHdpZHRoIGNhbm5vdCBiZVxuICogbWVhc3VyZWQsIHRoZSBsaXN0IHN0aWxsIHByaW50cyBhbmQgdGhlIGdhdGUgc3RpbGwgaG9sZHM7IG9ubHkgYWxpZ25tZW50IGlzXG4gKiBsb3N0LlxuICovXG5sZXQgY2FjaGVkU2VnbWVudGVyOiB7IHZhbHVlOiBJbnRsLlNlZ21lbnRlciB8IG51bGwgfSB8IHVuZGVmaW5lZDtcblxuZnVuY3Rpb24gZ3JhcGhlbWVTZWdtZW50ZXIoKTogSW50bC5TZWdtZW50ZXIgfCBudWxsIHtcbiAgaWYgKGNhY2hlZFNlZ21lbnRlciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNhY2hlZFNlZ21lbnRlciA9IHsgdmFsdWU6IG5ldyBJbnRsLlNlZ21lbnRlcignZW4nLCB7IGdyYW51bGFyaXR5OiAnZ3JhcGhlbWUnIH0pIH07XG4gICAgfSBjYXRjaCB7XG4gICAgICBjYWNoZWRTZWdtZW50ZXIgPSB7IHZhbHVlOiBudWxsIH07XG4gICAgfVxuICB9XG4gIHJldHVybiBjYWNoZWRTZWdtZW50ZXIudmFsdWU7XG59XG5cbi8qKlxuICogQ29kZSBwb2ludCByYW5nZXMgcmVuZGVyZWQgdHdvIGNvbHVtbnMgd2lkZTogdGhlIEVhc3QgQXNpYW4gV2lkZSAoVykgYW5kXG4gKiBGdWxsd2lkdGggKEYpIGJsb2NrcyBvZiBVQVggIzExLCBwbHVzIHRoZSBlbW9qaSBibG9ja3MgdGhhdCB0ZXJtaW5hbHMgYW5kXG4gKiBwcm9wb3J0aW9uYWwgYWdlbnQtZmFjaW5nIHJlbmRlcmVycyBib3RoIGdpdmUgZG91YmxlIHdpZHRoLiBFdmVyeXRoaW5nIGVsc2VcbiAqIGNvdW50cyBhcyBvbmUgY29sdW1uLlxuICpcbiAqIFNvcnRlZCBhc2NlbmRpbmcgYW5kIG5vbi1vdmVybGFwcGluZyBcdTIwMTQge0BsaW5rIGlzV2lkZUNvZGVQb2ludH0gc2hvcnQtY2lyY3VpdHNcbiAqIG9uIHRoZSBmaXJzdCByYW5nZSBzdGFydGluZyBwYXN0IHRoZSBjb2RlIHBvaW50LlxuICovXG5jb25zdCBXSURFX1JBTkdFUzogcmVhZG9ubHkgKHJlYWRvbmx5IFtudW1iZXIsIG51bWJlcl0pW10gPSBbXG4gIFsweDExMDAsIDB4MTE1Zl0sXG4gIFsweDIzMjksIDB4MjMyYV0sXG4gIFsweDI2MDAsIDB4MjdiZl0sXG4gIFsweDJlODAsIDB4MzAzZV0sXG4gIFsweDMwNDEsIDB4MzNmZl0sXG4gIFsweDM0MDAsIDB4NGRiZl0sXG4gIFsweDRlMDAsIDB4OWZmZl0sXG4gIFsweGEwMDAsIDB4YTRjZl0sXG4gIFsweGE5NjAsIDB4YTk3Zl0sXG4gIFsweGFjMDAsIDB4ZDdhM10sXG4gIFsweGY5MDAsIDB4ZmFmZl0sXG4gIFsweGZlMTAsIDB4ZmUxOV0sXG4gIFsweGZlMzAsIDB4ZmU2Zl0sXG4gIFsweGZmMDAsIDB4ZmY2MF0sXG4gIFsweGZmZTAsIDB4ZmZlNl0sXG4gIFsweDE3MDAwLCAweDE4YWZmXSxcbiAgWzB4MWYxZTYsIDB4MWYxZmZdLFxuICBbMHgxZjMwMCwgMHgxZjY0Zl0sXG4gIFsweDFmNjgwLCAweDFmNmZmXSxcbiAgWzB4MWY5MDAsIDB4MWY5ZmZdLFxuICBbMHgxZmE3MCwgMHgxZmFmZl0sXG4gIFsweDIwMDAwLCAweDJmZmZkXSxcbiAgWzB4MzAwMDAsIDB4M2ZmZmRdXG5dO1xuXG5mdW5jdGlvbiBpc1dpZGVDb2RlUG9pbnQoY3A6IG51bWJlcik6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IFtsbywgaGldIG9mIFdJREVfUkFOR0VTKSB7XG4gICAgaWYgKGNwIDwgbG8pIHJldHVybiBmYWxzZTtcbiAgICBpZiAoY3AgPD0gaGkpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBEaXNwbGF5IHdpZHRoIG9mIGEgbmFtZSBpbiB0ZXJtaW5hbCBjb2x1bW5zIFx1MjAxNCB0aGUgdW5pdCB0aGUgcmFuZ2UgY29sdW1uIGlzXG4gKiBhY3R1YWxseSBhbGlnbmVkIGluLiBNZWFzdXJlZCBvdmVyIGdyYXBoZW1lIGNsdXN0ZXJzIChzbyBhIGRlY29tcG9zZWQgYFx1MDBFOWBcbiAqIG9yIGEgY29tYmluaW5nLW1hcmsgc2VxdWVuY2UgY291bnRzIG9uY2UsIG5vdCBvbmNlIHBlciBjb2RlIHBvaW50KSwgd2l0aFxuICogZWFjaCBjbHVzdGVyIGNvbnRyaWJ1dGluZyB0d28gY29sdW1ucyB3aGVuIGl0cyBiYXNlIGNvZGUgcG9pbnQgaXMgRWFzdFxuICogQXNpYW4gV2lkZS9GdWxsd2lkdGggb3IgZW1vamkgYW5kIG9uZSBvdGhlcndpc2UuXG4gKlxuICogTmVpdGhlciBVVEYtMTYgYC5sZW5ndGhgIG5vciBgQXJyYXkuZnJvbShuYW1lKS5sZW5ndGhgIGlzIHRoaXMgdW5pdDogdGhlXG4gKiBmaXJzdCBvdmVyLWNvdW50cyBhIHN1cnJvZ2F0ZSBwYWlyLCB0aGUgc2Vjb25kIHVuZGVyLWNvdW50cyBhIENKSyBpZGVvZ3JhcGhcbiAqIGFuZCBvdmVyLWNvdW50cyBhIGRlY29tcG9zZWQgYWNjZW50LlxuICpcbiAqIFdoZW4ge0BsaW5rIGdyYXBoZW1lU2VnbWVudGVyfSBpcyB1bmF2YWlsYWJsZSAoYSBOb2RlIGJ1aWx0XG4gKiBgLS13aXRoLWludGw9bm9uZWAgaGFzIG5vIGBJbnRsYCBnbG9iYWwgYXQgYWxsKSwgdGhpcyBkZWdyYWRlcyB0byB0aGUgY3J1ZGVyXG4gKiBwZXItY29kZS1wb2ludCBtZWFzdXJlIHJhdGhlciB0aGFuIHRocm93aW5nLiBUaGF0IG1lYXN1cmUgb3Zlci1jb3VudHMgYVxuICogZGVjb21wb3NlZCBhY2NlbnQgYW5kIGEgcmVnaW9uYWwtaW5kaWNhdG9yIGZsYWcgcGFpciwgc28gYWxpZ25tZW50IGNhbiBiZSBhXG4gKiBjb2x1bW4gb3IgdHdvIG9mZiBcdTIwMTQgd2hpY2ggaXMgdGhlIGVudGlyZSBjb3N0LCBhbmQgaXMgdGhlIGNvcnJlY3QgcHJpY2UgdG9cbiAqIHBheTogdGhlIGFuY2hvciBsaXN0IHN0aWxsIHByaW50cyBhbmQgdGhlIGNvbW1pdCBnYXRlIHN0aWxsIGhvbGRzLlxuICovXG5mdW5jdGlvbiBkaXNwbGF5V2lkdGgobmFtZTogc3RyaW5nKTogbnVtYmVyIHtcbiAgY29uc3Qgc2VnbWVudGVyID0gZ3JhcGhlbWVTZWdtZW50ZXIoKTtcbiAgbGV0IHdpZHRoID0gMDtcbiAgaWYgKHNlZ21lbnRlciA9PT0gbnVsbCkge1xuICAgIGZvciAoY29uc3QgY29kZVBvaW50IG9mIG5hbWUpIHtcbiAgICAgIHdpZHRoICs9IGlzV2lkZUNvZGVQb2ludChjb2RlUG9pbnQuY29kZVBvaW50QXQoMCkgPz8gMCkgPyAyIDogMTtcbiAgICB9XG4gICAgcmV0dXJuIHdpZHRoO1xuICB9XG4gIGZvciAoY29uc3QgeyBzZWdtZW50IH0gb2Ygc2VnbWVudGVyLnNlZ21lbnQobmFtZSkpIHtcbiAgICB3aWR0aCArPSBpc1dpZGVDb2RlUG9pbnQoc2VnbWVudC5jb2RlUG9pbnRBdCgwKSA/PyAwKSA/IDIgOiAxO1xuICB9XG4gIHJldHVybiB3aWR0aDtcbn1cblxuLyoqXG4gKiBBbGlnbm1lbnQgY2VpbGluZy4gQSBzaWJsaW5nIGdyb3VwIHdob3NlIHdpZGVzdCByYW5nZS1iZWFyaW5nIG5hbWUgZXhjZWVkc1xuICogdGhpcyB3aWR0aCBkb2VzIG5vdCBhbGlnbiBhdCBhbGwgXHUyMDE0IGV2ZXJ5IG5hbWUgaW4gaXQgdGFrZXMgYSBzaW5nbGUgc3BhY2VcbiAqIGJlZm9yZSBpdHMgcmFuZ2UuIFRoZSBhbHRlcm5hdGl2ZSAocGFkIHRoZSBzaG9ydCBuYW1lcyB0byB0aGUgY2VpbGluZyB3aGlsZVxuICogdGhlIGxvbmcgb25lIHNpdHMgYXQgaXRzIG93biBuYXR1cmFsIGNvbHVtbikgcGF5cyBtb3N0IG9mIHRoZSB3aWR0aCBmb3JcbiAqIGFsaWdubWVudCB0aGF0IGFsaWducyB3aXRoIG5vdGhpbmcsIHdoaWNoIGlzIHN0cmljdGx5IHdvcnNlIHRoYW4gbm90XG4gKiBhbGlnbmluZy4gTmFtZXMgdGhlbXNlbHZlcyBhcmUgbmV2ZXIgdHJ1bmNhdGVkIG9yIGVsaWRlZCBhdCBhbnkgd2lkdGguXG4gKi9cbmNvbnN0IE1BWF9BTElHTl9DT0xVTU4gPSA0ODtcblxuLyoqXG4gKiBUaGUgY29sdW1uIGV2ZXJ5IHJhbmdlLWJlYXJpbmcgbmFtZSBpbiB0aGlzIHNpYmxpbmcgZ3JvdXAgcGFkcyB0bywgb3IgYDBgXG4gKiB3aGVuIHRoZSBncm91cCBmb3Jnb2VzIGFsaWdubWVudCAobm8gcmFuZ2UtYmVhcmluZyBuYW1lcywgb3IgYSBuYW1lIHBhc3RcbiAqIHtAbGluayBNQVhfQUxJR05fQ09MVU1OfSkuIEFsaWdubWVudCBzY29wZSBpcyB0aGUgZ3JvdXAncyBkaXJlY3QgY2hpbGRyZW5cbiAqIG9ubHksIG5ldmVyIHRoZSB3aG9sZSB0cmVlIFx1MjAxNCB3aG9sZS10cmVlIGFsaWdubWVudCB3b3VsZCBsZXQgb25lIGRlZXBseVxuICogbmVzdGVkIGxvbmcgbmFtZSBwYWQgZXZlcnkgdW5yZWxhdGVkIGJyYW5jaC5cbiAqL1xuZnVuY3Rpb24gY29tcHV0ZUdyb3VwVGFyZ2V0KGl0ZW1zOiBEaXNwbGF5SXRlbVtdKTogbnVtYmVyIHtcbiAgbGV0IG1heCA9IDA7XG4gIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcykge1xuICAgIGlmIChpdGVtLm5vZGUua2luZCA9PT0gJ2xlYWYnICYmIHByaW50c1JhbmdlQ29sdW1uKGl0ZW0ubm9kZS5hbmNob3IpKSB7XG4gICAgICBtYXggPSBNYXRoLm1heChtYXgsIGRpc3BsYXlXaWR0aChpdGVtLm5hbWUpKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG1heCA+IE1BWF9BTElHTl9DT0xVTU4gPyAwIDogbWF4O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhpcyBhbmNob3IgcHJpbnRzIGEgcmFuZ2UgY29sdW1uIGF0IGFsbCBcdTIwMTQgdGhlIGV4YWN0IGNvbmRpdGlvblxuICoge0BsaW5rIGxhYmVsRm9yfSBlbmNvZGVzLCBob2lzdGVkIHNvIHtAbGluayBjb21wdXRlR3JvdXBUYXJnZXR9IG1lYXN1cmVzIHRoZVxuICogc2FtZSBzZXQgb2YgbmFtZXMgaXQgcGFkcy4gQW4gYW5jaG9yIHdpdGggbm8gcmFuZ2VzLCBvciBhICpzb2xlKiB3aG9sZS1maWxlXG4gKiBlbnRyeSAod2hpY2ggcmVuZGVycyBhcyBhIGJhcmUgcGF0aCB3aXRoIHplcm8gbWFya2VyKSwgY29udHJpYnV0ZXMgbm8gcmFuZ2VcbiAqIGNvbHVtbiBhbmQgc28gbXVzdCBub3QgY29udHJpYnV0ZSB0byB0aGUgZ3JvdXAgbWF4IGVpdGhlcjogb3RoZXJ3aXNlIGFcbiAqIHdob2xlLWZpbGUgYW5jaG9yIG9uIGEgcGF0aCBwYXN0IHtAbGluayBNQVhfQUxJR05fQ09MVU1OfSBzaWxlbnRseSBzdXBwcmVzc2VzXG4gKiBhbGlnbm1lbnQgZm9yIGl0cyByYW5nZS1iZWFyaW5nIHNpYmxpbmdzIHdoaWxlIGl0c2VsZiBwcmludGluZyBub3RoaW5nIHRvXG4gKiBhbGlnbi5cbiAqL1xuZnVuY3Rpb24gcHJpbnRzUmFuZ2VDb2x1bW4oYW5jaG9yOiBUcmVlQW5jaG9yKTogYm9vbGVhbiB7XG4gIGNvbnN0IHsgcmFuZ2VzIH0gPSBhbmNob3I7XG4gIGlmIChyYW5nZXMubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiByYW5nZXMuc29tZSgoZW50cnkpID0+IGxhYmVsRm9yKGVudHJ5LnJhbmdlLCByYW5nZXMubGVuZ3RoID09PSAxKSAhPT0gbnVsbCk7XG59XG5cbi8qKiBUaGUgc3BhY2luZyBiZXR3ZWVuIGEgbmFtZSBvZiBgbmFtZVdpZHRoYCBjb2x1bW5zIGFuZCBpdHMgcmFuZ2UgY29sdW1uLiAqL1xuZnVuY3Rpb24gY29tcHV0ZVBhZChuYW1lV2lkdGg6IG51bWJlciwgdGFyZ2V0OiBudW1iZXIpOiBzdHJpbmcge1xuICBpZiAobmFtZVdpZHRoID49IHRhcmdldCkgcmV0dXJuICcgJztcbiAgcmV0dXJuICcgJy5yZXBlYXQodGFyZ2V0IC0gbmFtZVdpZHRoICsgMSk7XG59XG5cbi8qKlxuICogUmVuZGVyIG9uZSBsZWFmJ3MgbGluZShzKS4gQW4gZW1wdHkgYHJhbmdlc2AgYXJyYXkgaXMgYSBiYXJlLXBhdGggbGVhZiB3aXRoXG4gKiBubyByYW5nZSBjb2x1bW4gYXQgYWxsIChkaXN0aW5jdCBmcm9tIGEgYHdob2xlLWZpbGVgIGVudHJ5LCB3aGljaCBpcyBhblxuICogZXhwbGljaXQgY2xhc3NpZmljYXRpb24gdGhhdCBhbHNvIHByaW50cyB3aXRoIHplcm8gbWFya2VyIHdoZW4gaXQgc3RhbmRzXG4gKiBhbG9uZSwgYnV0IHRocm91Z2ggdGhlIHJhbmdlcyBwaXBlbGluZSkuIE11bHRpcGxlIHN0YWNrZWQgcmFuZ2VzIHByaW50XG4gKiB1bmRlciBhIGNvbnRpbnVhdGlvbiBwcmVmaXggaW5zdGVhZCBvZiByZXBlYXRpbmcgdGhlIG5hbWU7IGVhY2ggY2FycmllcyBpdHNcbiAqIG93biBzdWZmaXggaW5kZXBlbmRlbnRseSwgYW5kIGVhY2ggY2FycmllcyBhIGxhYmVsIGlkZW50aWZ5aW5nIHdoaWNoIGFuY2hvclxuICogdGhlIHN1ZmZpeCBiZWxvbmdzIHRvLlxuICovXG5mdW5jdGlvbiByZW5kZXJMZWFmTGluZXMoXG4gIG5hbWU6IHN0cmluZyxcbiAgYW5jaG9yOiBUcmVlQW5jaG9yLFxuICBvd25QcmVmaXg6IHN0cmluZyxcbiAgY2hpbGRQcmVmaXg6IHN0cmluZyxcbiAgZ3JvdXBUYXJnZXQ6IG51bWJlclxuKTogc3RyaW5nW10ge1xuICBjb25zdCB7IHJhbmdlcyB9ID0gYW5jaG9yO1xuICBpZiAocmFuZ2VzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtgJHtvd25QcmVmaXh9JHtuYW1lfWBdO1xuXG4gIGNvbnN0IHNvcnRlZCA9IFsuLi5yYW5nZXNdLnNvcnQoY29tcGFyZVJhbmdlRW50cmllcyk7XG4gIGNvbnN0IHNvbGUgPSBzb3J0ZWQubGVuZ3RoID09PSAxO1xuICBjb25zdCBuYW1lV2lkdGggPSBkaXNwbGF5V2lkdGgobmFtZSk7XG4gIGNvbnN0IHBhZCA9IGNvbXB1dGVQYWQobmFtZVdpZHRoLCBncm91cFRhcmdldCk7XG4gIGNvbnN0IGJsYW5rID0gJyAnLnJlcGVhdChuYW1lV2lkdGggKyBwYWQubGVuZ3RoKTtcblxuICByZXR1cm4gc29ydGVkLm1hcCgoZW50cnksIGkpID0+IHtcbiAgICBjb25zdCBsYWJlbCA9IGxhYmVsRm9yKGVudHJ5LnJhbmdlLCBzb2xlKTtcbiAgICBpZiAobGFiZWwgPT09IG51bGwpIHJldHVybiBgJHtvd25QcmVmaXh9JHtuYW1lfSR7ZW50cnkuc3VmZml4fWA7XG4gICAgY29uc3QgYmFzZSA9IGkgPT09IDAgPyBgJHtvd25QcmVmaXh9JHtuYW1lfSR7cGFkfWAgOiBgJHtjaGlsZFByZWZpeH0ke2JsYW5rfWA7XG4gICAgcmV0dXJuIGAke2Jhc2V9JHtsYWJlbH0ke2VudHJ5LnN1ZmZpeH1gO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyTm9kZXMobm9kZXM6IFBhdGhUcmVlTm9kZVtdLCBwcmVmaXg6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgbGluZXM6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGl0ZW1zID0gbm9kZXMubWFwKGZvbGRDaGFpbik7XG4gIGNvbnN0IGdyb3VwVGFyZ2V0ID0gY29tcHV0ZUdyb3VwVGFyZ2V0KGl0ZW1zKTtcbiAgaXRlbXMuZm9yRWFjaCgoaXRlbSwgaSkgPT4ge1xuICAgIGNvbnN0IGlzTGFzdCA9IGkgPT09IGl0ZW1zLmxlbmd0aCAtIDE7XG4gICAgY29uc3Qgb3duUHJlZml4ID0gYCR7cHJlZml4fSR7aXNMYXN0ID8gJ1x1MjUxNFx1MjUwMCAnIDogJ1x1MjUxQ1x1MjUwMCAnfWA7XG4gICAgY29uc3QgY2hpbGRQcmVmaXggPSBgJHtwcmVmaXh9JHtpc0xhc3QgPyAnICAgJyA6ICdcdTI1MDIgICd9YDtcbiAgICBpZiAoaXRlbS5ub2RlLmtpbmQgPT09ICdsZWFmJykge1xuICAgICAgbGluZXMucHVzaCguLi5yZW5kZXJMZWFmTGluZXMoaXRlbS5uYW1lLCBpdGVtLm5vZGUuYW5jaG9yLCBvd25QcmVmaXgsIGNoaWxkUHJlZml4LCBncm91cFRhcmdldCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICBsaW5lcy5wdXNoKGAke293blByZWZpeH0ke2l0ZW0ubmFtZX0vYCk7XG4gICAgICBsaW5lcy5wdXNoKC4uLnJlbmRlck5vZGVzKGl0ZW0ubm9kZS5jaGlsZHJlbiwgY2hpbGRQcmVmaXgpKTtcbiAgICB9XG4gIH0pO1xuICByZXR1cm4gbGluZXM7XG59XG5cbi8qKlxuICogUmVuZGVyIGEgY29sbGFwc2VkIGFuY2hvciBsaXN0IGFzIGEgYm94LWRyYXdpbmcgdHJlZSwgZ3JvdXBlZCBieSBzaGFyZWRcbiAqIHBhdGggcHJlZml4LiBFdmVyeSBhbmNob3IgbGlzdCByZW5kZXJzIGFzIGEgdHJlZSB1bmNvbmRpdGlvbmFsbHkgXHUyMDE0IGEgc2luZ2xlXG4gKiBhbmNob3IgYmVjb21lcyBhIG9uZS1saW5lIHRyZWUgd2hhdGV2ZXIgaXRzIGRlcHRoIChzZWUge0BsaW5rIGZvbGRDaGFpbn0pO1xuICogdGhlcmUgaXMgbm8gZmxhdC1idWxsZXQgcGF0aCBvciBzaXplIGZsb29yIGluIHRoaXMgbW9kdWxlLlxuICpcbiAqIEhlaWdodCBpcyBib3VuZGVkIGJ5IHtAbGluayBmb2xkQ2hhaW59OiBhIGRpcmVjdG9yeSBsaW5lIG9ubHkgZXZlciBhcHBlYXJzXG4gKiB3aGVyZSBpdCBnZW51aW5lbHkgZ3JvdXBzIHR3byBvciBtb3JlIHNpYmxpbmdzLCBzbyB0aGUgdHJlZSBhZGRzIGF0IG1vc3RcbiAqIG9uZSBsaW5lIHBlciByZWFsIGdyb3VwaW5nIGFuZCBuZXZlciBvbmUgcGVyIHBhdGggc2VnbWVudC5cbiAqXG4gKiBUb3RhbCBmb3IgYW55IHdlbGwtZm9ybWVkIGBUcmVlQW5jaG9yW11gOiBkZWdlbmVyYXRlIHBhdGhzIChydWxlIGVuZm9yY2VkXG4gKiBpbiB7QGxpbmsgc3BsaXRTZWdtZW50c30pIGFyZSBub3JtYWxpemVkIHRvIGF0b21pYyBsZWF2ZXMgcmF0aGVyIHRoYW5cbiAqIHRocm93biBvbiwgc28gdGhpcyBmdW5jdGlvbiBuZXZlciBuZWVkcyBhbiBpbnRlcm5hbCB0cnkvY2F0Y2guIENhbGxlcnMgYWRkXG4gKiB0aGVpciBvd24gY2F0Y2ggYXJvdW5kIHRoaXMgY2FsbCBpbiBhIGxhdGVyIHBoYXNlIChmYWlsLW9wZW4gZGlzY2lwbGluZVxuICogbGl2ZXMgYXQgdGhlIGNhbGwgc2l0ZSwgbm90IGhlcmUpLlxuICpcbiAqIGByZW5kZXJBbmNob3JUcmVlYCdzIGNvbnRyYWN0IHJlcXVpcmVzIGF0IG1vc3Qgb25lIGBUcmVlQW5jaG9yYCBwZXJcbiAqIGRpc3RpbmN0IGBwYXRoYCBcdTIwMTQgcGFzcyBhbmNob3JzIHRocm91Z2gge0BsaW5rIGNvbGxhcHNlQnlQYXRofSBmaXJzdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlckFuY2hvclRyZWUoYW5jaG9yczogVHJlZUFuY2hvcltdKTogc3RyaW5nW10ge1xuICBjb25zdCBmb3Jlc3QgPSBidWlsZEZvcmVzdChhbmNob3JzKTtcbiAgcmV0dXJuIHJlbmRlck5vZGVzKGZvcmVzdCwgJycpO1xufVxuIiwgIi8qKlxuICogU2hhcmVkIEJhc2ggc3BhbiBcdTIxOTIgdG91Y2ggdHJhbnNsYXRpb24gYW5kIHRoZSBqb2luLWdhdGluZyBkcml2ZXIgKHBsYW4gXHUwMEE3MixcbiAqIFx1MDBBNzMgc3RlcCAyKS4gQm90aCBhZGFwdGVycyBjb25zdW1lIHRoaXMgbW9kdWxlIG9uY2UgdGhlaXIgZHVwbGljYXRlIEJhc2hcbiAqIHNwYW4gbG9vcHMgY29sbGFwc2U6IGl0IG93bnMgdGhlIHBlci1jb21tYW5kIHZlcmRpY3QgdGhyZWFkIFx1MjAxNCBwYXNzIEFcbiAqIGBldmFsdWF0ZVdyaXRlR2F0ZWAgc3dlZXAsIHRoZSBleHBsYW5hdGlvbiBtYXAsIHRoZSBqb2luIGZpbHRlciwgYW5kIHBhc3MgQlxuICogcGVyLXN1cnZpdmluZy1zcGFuIGBydW5Ub3VjaEhvb2tgIFx1MjAxNCBwbHVzIHRoZSB3aG9sZS1jb21tYW5kIGBpbnRlcnJ1cHRlZGBcbiAqIGdhdGUgKHBsYW4gXHUwMEE3NCkuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBSZXNvbHZlZFNwYW4sIFNwYW5NYXRjaCB9IGZyb20gJy4vcGFyc2UtY29tbWFuZC5qcyc7XG5pbXBvcnQgeyB0eXBlIE1lbW9TdG9yZSwgcmVzb2x2ZVRvdWNoU2NvcGUgfSBmcm9tICcuL3NwYW4tc3VyZmFjZS5qcyc7XG5pbXBvcnQge1xuICBjcmVhdGVSZWFsaXR5UHJvYmVDYWNoZSxcbiAgZXZhbHVhdGVXcml0ZUdhdGUsXG4gIGZpbGVFeGlzdHMsXG4gIHR5cGUgUmVhbGl0eVByb2JlQ2FjaGUsXG4gIHJ1blRvdWNoSG9vayxcbiAgdHlwZSBUb3VjaEV4ZWN1dG9ycyxcbiAgdHlwZSBUb3VjaElucHV0LFxuICB0eXBlIFdyaXRlR2F0ZU91dGNvbWUsXG4gIHdvcmtpbmdUcmVlQ2hhbmdlZFxufSBmcm9tICcuL3RvdWNoLWNvcmUuanMnO1xuXG4vKipcbiAqIFRyYW5zbGF0ZSBvbmUgcmVzb2x2ZWQgc3BhbiBpbnRvIGEgZnVsbHktdHlwZWQge0BsaW5rIFRvdWNoSW5wdXR9IHBlciB0aGVcbiAqIHBsYW4gXHUwMEE3MiB0YWJsZSwgb3IgYG51bGxgIHdoZW4gdGhlIHBhdGggZmFpbHMgYHJlc29sdmVUb3VjaFNjb3BlYCBcdTIwMTQgY3Jvc3MtXG4gKiByZXBvLCBnaXRpZ25vcmVkLCBhbmQgc3Bhbi1kb2N1bWVudCBwYXRocyBmYWlsIGNsb3NlZC5cbiAqXG4gKiBUaGUgcG9zdC1zdGF0ZSBnYXRlIGZpZWxkcyB0aGUgc3BhbiBjYW4gZGV0ZXJtaW5lIChgdGFyZ2V0U3RhdGVgLCBhbmRcbiAqIGBwb3N0U3RhdGVgIGZvciBhcHBlbmRzIGFuZCBkZWxldGVzKSBhcmUgc2V0IGhlcmU7IGEgbGl0ZXJhbCBvdmVyd3JpdGUgYm9keVxuICogKGBzcGFuLndyaXR0ZW5gIFx1MjAxNCB0aGUgZmxhZy1sZXNzIGBlY2hvYC9gcHJpbnRmYCBgPmAgY2FzZSkgcmlkZXMgYXMgdGhlXG4gKiBgZXhhY3RgIHBvc3QtY29udGVudCBleHBlY3RhdGlvbiBzbyB0aGUgZ2F0ZSB2ZXJpZmllcyB0aGUgd3JpdGUncyBlZmZlY3RcbiAqIHdoaWxlIHRoZSB0b3VjaCBpdHNlbGYgc3RheXMgd2hvbGUtZmlsZSAocGxhbiBcdTAwQTczIHN0ZXAgMWIpLiBUcnVuY2F0ZXMgbWFwXG4gKiB0aGUgc3BhbidzIHN0YXRpY2FsbHkgZXZhbHVhdGVkIGFic29sdXRlIGAtcyBOYCB0byB0aGUgYHNpemVgIHBvc3QtY29udGVudFxuICogKGAtcyAwYCBcdTIxOTIgYGVtcHR5YCk7IGEgdHJ1bmNhdGUgd2l0aG91dCBhIHNpemUgZ2F0ZXMgZXhpc3RlbmNlLW9ubHkuIFRoZVxuICogZHJpdmVyIHBhaXJzIGNwL2luc3RhbGwgYW5kIG12IHNvdXJjZXMgb250byB0aGUgZGVzdGluYXRpb24gdG91Y2hlc1xuICogYWZ0ZXJ3YXJkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYmFzaFNwYW5Ub1RvdWNoKHNwYW46IFJlc29sdmVkU3Bhbiwgc2Vzc2lvbklkOiBzdHJpbmcsIGN3ZDogc3RyaW5nKTogVG91Y2hJbnB1dCB8IG51bGwge1xuICBpZiAoIXJlc29sdmVUb3VjaFNjb3BlKGN3ZCwgc3Bhbi5hYnNvbHV0ZVBhdGgpKSByZXR1cm4gbnVsbDtcbiAgc3dpdGNoIChzcGFuLm9wZXJhdGlvbikge1xuICAgIGNhc2UgJ3JlYWQnOlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogJ3JlYWQnLFxuICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgIGN3ZCxcbiAgICAgICAgZmlsZVBhdGg6IHNwYW4uYWJzb2x1dGVQYXRoLFxuICAgICAgICBvZmZzZXQ6IHNwYW4ubGluZVN0YXJ0LFxuICAgICAgICBsaW1pdDpcbiAgICAgICAgICBzcGFuLmxpbmVTdGFydCAhPT0gdW5kZWZpbmVkICYmIHNwYW4ubGluZUVuZCAhPT0gdW5kZWZpbmVkID8gc3Bhbi5saW5lRW5kIC0gc3Bhbi5saW5lU3RhcnQgKyAxIDogdW5kZWZpbmVkXG4gICAgICB9O1xuICAgIGNhc2UgJ2NyZWF0ZS1vdmVyd3JpdGUnOlxuICAgIGNhc2UgJ3JlbmFtZS1jb3B5JzpcbiAgICAgIC8vIFdob2xlLWZpbGUgd3JpdGVzOiBgd3JpdHRlbjogJydgIHNjb3BlcyB0aGUgdG91Y2ggdG8gZXZlcnkgY292ZXJpbmdcbiAgICAgIC8vIHNwYW4gXHUyMDE0IHRydW5jYXRpbmcgd3JpdGVzIGRlc3Ryb3kgYW5jaG9ycyBiZXlvbmQgdGhlIG5ldyBFT0YgKHRoZVxuICAgICAgLy8gbWFpbi0yMDAgRjIgbGVzc29uKS4gQSBsaXRlcmFsIGJvZHkgcmlkZXMgYXMgdGhlIGV4YWN0IHBvc3QtY29udGVudFxuICAgICAgLy8gZXhwZWN0YXRpb24gc28gdGhlIGdhdGUgdmVyaWZpZXMgdGhlIHdyaXRlJ3MgZWZmZWN0LlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogJ3dyaXRlJyxcbiAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICBjd2QsXG4gICAgICAgIGZpbGVQYXRoOiBzcGFuLmFic29sdXRlUGF0aCxcbiAgICAgICAgd3JpdHRlbjogJycsXG4gICAgICAgIHRhcmdldFN0YXRlOiAnZXhpc3RzJyxcbiAgICAgICAgcG9zdFN0YXRlOiBzcGFuLndyaXR0ZW4gIT09IHVuZGVmaW5lZCA/IHsgY29udGVudDogeyBleGFjdDogc3Bhbi53cml0dGVuIH0gfSA6IHVuZGVmaW5lZFxuICAgICAgfTtcbiAgICBjYXNlICd0cnVuY2F0ZSc6XG4gICAgICAvLyBTYW1lIHdob2xlLWZpbGUgc2NvcGU7IHRoZSBzaXplIGdhdGUgKHBsYW4gXHUwMEE3MiwgXHUwMEE3MyBzdGVwIDFiKSB2ZXJpZmllc1xuICAgICAgLy8gdGhlIHBvc3QtY29tbWFuZCBieXRlIGNvdW50IHdoZW4gdGhlIHNwYW4gY2FycmllcyBhIHN0YXRpY2FsbHlcbiAgICAgIC8vIGV2YWx1YXRlZCBhYnNvbHV0ZSBgLXMgTmAgKGAtcyAwYCBcdTIxOTIgZW1wdHkpOyB3aXRob3V0IG9uZSB0aGUgZ2F0ZSBpc1xuICAgICAgLy8gZXhpc3RlbmNlLW9ubHkuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiAnd3JpdGUnLFxuICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgIGN3ZCxcbiAgICAgICAgZmlsZVBhdGg6IHNwYW4uYWJzb2x1dGVQYXRoLFxuICAgICAgICB3cml0dGVuOiAnJyxcbiAgICAgICAgdGFyZ2V0U3RhdGU6ICdleGlzdHMnLFxuICAgICAgICBwb3N0U3RhdGU6XG4gICAgICAgICAgc3Bhbi5zaXplID09PSAwXG4gICAgICAgICAgICA/IHsgY29udGVudDogeyBlbXB0eTogdHJ1ZSB9IH1cbiAgICAgICAgICAgIDogc3Bhbi5zaXplICE9PSB1bmRlZmluZWRcbiAgICAgICAgICAgICAgPyB7IGNvbnRlbnQ6IHsgc2l6ZTogc3Bhbi5zaXplIH0gfVxuICAgICAgICAgICAgICA6IHVuZGVmaW5lZFxuICAgICAgfTtcbiAgICBjYXNlICdhcHBlbmQnOlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogJ3dyaXRlJyxcbiAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICBjd2QsXG4gICAgICAgIGZpbGVQYXRoOiBzcGFuLmFic29sdXRlUGF0aCxcbiAgICAgICAgd3JpdHRlbjogc3Bhbi53cml0dGVuID8/ICcnLFxuICAgICAgICB0YXJnZXRTdGF0ZTogJ2V4aXN0cycsXG4gICAgICAgIHBvc3RTdGF0ZTogc3Bhbi53cml0dGVuICE9PSB1bmRlZmluZWQgPyB7IGNvbnRlbnQ6IHsgc3VmZml4OiBzcGFuLndyaXR0ZW4gfSB9IDogdW5kZWZpbmVkXG4gICAgICB9O1xuICAgIGNhc2UgJ21vZGlmeSc6XG4gICAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiAnd3JpdGUnLFxuICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgIGN3ZCxcbiAgICAgICAgZmlsZVBhdGg6IHNwYW4uYWJzb2x1dGVQYXRoLFxuICAgICAgICB3cml0dGVuOiAnJyxcbiAgICAgICAgdGFyZ2V0U3RhdGU6ICdleGlzdHMnLFxuICAgICAgICByYW5nZTogc3Bhbi5saW5lU3RhcnQgIT09IHVuZGVmaW5lZCA/IHsgc3RhcnQ6IHNwYW4ubGluZVN0YXJ0LCBlbmQ6IHNwYW4ubGluZUVuZCA/PyBzcGFuLmxpbmVTdGFydCB9IDogdW5kZWZpbmVkXG4gICAgICB9O1xuICAgIGNhc2UgJ2RlbGV0ZSc6XG4gICAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiAnd3JpdGUnLFxuICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgIGN3ZCxcbiAgICAgICAgZmlsZVBhdGg6IHNwYW4uYWJzb2x1dGVQYXRoLFxuICAgICAgICB3cml0dGVuOiAnJyxcbiAgICAgICAgdGFyZ2V0U3RhdGU6ICdhYnNlbnQnLFxuICAgICAgICBwb3N0U3RhdGU6IHsgcmVhbERlbGV0ZTogdHJ1ZSB9XG4gICAgICB9O1xuICB9XG59XG5cbi8qKlxuICogV2hldGhlciB0aGUgQmFzaCBgdG9vbF9yZXNwb25zZWAgc2lnbmFscyB0aGF0IHRoZSBjb21tYW5kIHdhcyBpbnRlcnJ1cHRlZFxuICogKHBsYW4gXHUwMEE3NCkuIFRoZSBTREsgdHlwZXMgdGhlIHJlc3BvbnNlIGB1bmtub3duYCBvbiBib3RoIGFkYXB0ZXJzLCBzbyB0aGlzXG4gKiBpcyBhIGRlZmVuc2l2ZSBydW50aW1lIHNoYXBlLXByb2JlOiBhbiBvYmplY3QgY2FycnlpbmcgYSB0cnV0aHlcbiAqIGBpbnRlcnJ1cHRlZGAgZmllbGQgY2xhc3NpZmllcyBhcyBpbnRlcnJ1cHRlZDsgYW55IG90aGVyIHNoYXBlIChzdHJpbmcsXG4gKiBudWxsLCBvYmplY3Qgd2l0aG91dCB0aGUgZmllbGQpIHByb2NlZWRzIGZhaWwtb3BlbiwgbWF0Y2hpbmcgdG9kYXknc1xuICogYmVoYXZpb3IuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBiYXNoUmVzcG9uc2VJbnRlcnJ1cHRlZCh0b29sUmVzcG9uc2U6IHVua25vd24pOiBib29sZWFuIHtcbiAgaWYgKHRvb2xSZXNwb25zZSAhPT0gbnVsbCAmJiB0eXBlb2YgdG9vbFJlc3BvbnNlID09PSAnb2JqZWN0Jykge1xuICAgIHJldHVybiBCb29sZWFuKCh0b29sUmVzcG9uc2UgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLmludGVycnVwdGVkKTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICogVGhlIEJhc2ggYHRvb2xfcmVzcG9uc2VgJ3MgcHJvY2VzcyBleGl0IGNvZGUsIHdoZW4gdGhlIGhhcm5lc3Mgc3VwcGxpZXNcbiAqIG9uZS4gVGhlIFNESyB0eXBlcyB0aGUgcmVzcG9uc2UgYHVua25vd25gIG9uIGJvdGggYWRhcHRlcnMgYW5kIENsYXVkZSdzXG4gKiBCYXNoIGVudmVsb3BlcyBkbyBub3QgY3VycmVudGx5IGNhcnJ5IGFuIGBleGl0X2NvZGVgIGZpZWxkLCBzbyB0aGlzIGlzIGFcbiAqIGRlZmVuc2l2ZSBzaGFwZS1wcm9iZSB3aXRoIHRoZSBwbGFuIFx1MDBBNzQgZmFpbC1vcGVuIHBvc3R1cmU6IHByZXNlbnQgXHUyMTkyIHRoZVxuICogaW50ZWdlciBjb2RlLCBhYnNlbnQgb3IgYW55IG90aGVyIHNoYXBlIFx1MjE5MiB1bmRlZmluZWQsIGFuZCB0aGUgY2FsbGVyXG4gKiBwcm9jZWVkcyBleGFjdGx5IGFzIHRvZGF5LiAoVGhlIGhvb2sgc3VicHJvY2VzcydzIG93biBleGl0IHN0YXR1cyBcdTIwMTQgdGhlXG4gKiBTREsncyBgU0RLSG9va1Jlc3BvbnNlTWVzc2FnZS5leGl0X2NvZGVgIFx1MjAxNCBpcyBhIGRpZmZlcmVudCBjaGFubmVsIGFuZCBpc1xuICogbmV2ZXIgcmVhZCBoZXJlLilcbiAqXG4gKiBHcmFudWxhcml0eSBlZGdlIChkb2N1bWVudGVkIHJlc2lkdWUpOiB0aGUgY29kZSBpcyB0aGUgd2hvbGUgY29tcG91bmRcbiAqIGNvbW1hbmQncywgbm90IG9uZSBzaW1wbGUgY29tbWFuZCdzIFx1MjAxNCBhIG1hc2tlZCBmYWlsdXJlIChgZ2l0IGFwcGx5XG4gKiBwLmRpZmYgfHwgZWNobyBva2AgZXhpdGluZyAwKSBzdXBwcmVzc2VzIG5vdGhpbmcsIGFuZCBhIHRyYWlsaW5nIGZhaWx1cmVcbiAqIChgc2VkIC1pIHMvYS9iLyBmOyBmYWxzZWAgZXhpdGluZyAxKSBzdXBwcmVzc2VzIHRoZSBlYXJsaWVyIHJlYWwgd3JpdGUuXG4gKiBBbmQgdGhlIFwiZmFpbGVkLCBzbyB0aGUgd3JpdGUgZGlkIG5vdCBoYXBwZW5cIiBwcmVtaXNlIGJlaGluZCB0aGVcbiAqIHN1cHByZXNzaW9uIGhvbGRzIGZvciBhdG9taWMgZmFpbHVyZXMgKGBnaXQgYXBwbHlgIHdpdGhvdXQgYC0tcmVqZWN0YCxcbiAqIHByZXR0aWVyIG9uIGEgc3ludGF4IGVycm9yKSBidXQgb3Zlci1zdXBwcmVzc2VzIHRoZSBub24tYXRvbWljIHdyaXRlcnNcbiAqIHRoYXQgbW9kaWZ5IGJlZm9yZSBmYWlsaW5nIFx1MjAxNCBHTlUgYHBhdGNoYCBhcHBseWluZyBlYXJsaWVyIGh1bmtzLCBgZ2l0XG4gKiBhcHBseSAtLXJlamVjdGAgd3JpdGluZyB0aGUgYXBwbGljYWJsZSBodW5rcyBwbHVzIGAucmVqYCBmaWxlcywgYW5kXG4gKiBmb3JtYXR0ZXJzIChgZXNsaW50IC0tZml4YCwgYHJ1Ym9jb3AgLWFgKSB3cml0aW5nIHRoZWlyIGZpeGVzIGJlZm9yZVxuICogZXhpdGluZyBub256ZXJvIG9uIHJlbWFpbmluZyB2aW9sYXRpb25zLiBUaGF0IHdyb3RlLWJ1dC1ub256ZXJvIGNvcm5lciBpc1xuICogYWNjZXB0ZWQgYW5kIHBpbm5lZCBieSB0aGUgZ2F0ZSdzIHRlc3RzIHJhdGhlciB0aGFuIGNhcnZlZCBvdXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBiYXNoUmVzcG9uc2VFeGl0Q29kZSh0b29sUmVzcG9uc2U6IHVua25vd24pOiBudW1iZXIgfCB1bmRlZmluZWQge1xuICBpZiAodG9vbFJlc3BvbnNlICE9PSBudWxsICYmIHR5cGVvZiB0b29sUmVzcG9uc2UgPT09ICdvYmplY3QnKSB7XG4gICAgY29uc3QgY29kZSA9ICh0b29sUmVzcG9uc2UgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLmV4aXRfY29kZTtcbiAgICBpZiAodHlwZW9mIGNvZGUgPT09ICdudW1iZXInICYmIE51bWJlci5pc0ludGVnZXIoY29kZSkpIHJldHVybiBjb2RlO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVGhlIHBlci1jb21tYW5kIHZlcmRpY3QgZHJpdmVyIChwbGFuIFx1MDBBNzMgc3RlcCAyKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnR5cGUgUmVzb2x2ZWRNYXRjaCA9IEV4dHJhY3Q8U3Bhbk1hdGNoLCB7IHN0YXR1czogJ3Jlc29sdmVkJyB9PjtcbnR5cGUgR3VhcmRNYXRjaCA9IEV4dHJhY3Q8U3Bhbk1hdGNoLCB7IHN0YXR1czogJ2J1aWx0aW4tZ3VhcmQnIH0+O1xuXG50eXBlIFZlcmRpY3QgPSAnZmFpbGVkJyB8ICdzdWNjZWVkZWQnIHwgJ3Vua25vd24nO1xuXG4vKipcbiAqIEZpbGUtcHJvZHVjaW5nIHdyaXRlIG9wZXJhdGlvbnMgXHUyMDE0IHRoZSBvbmx5IHNwYW5zIHRoYXQgY2FuIGV4cGxhaW4gYVxuICogZGVsZXRlJ3MgZGVjaXNpdmVGYWlsIGJ5IHJlLWNyZWF0aW5nIGl0cyBwYXRoIGxhdGVyIGluIHRoZSBjb21wb3VuZCAocGxhblxuICogXHUwMEE3MyBzdGVwIDIsIHJvdW5kLTMpLiBgbW9kaWZ5YCAoc2VkIC1pIGFuZCBmcmllbmRzKSBkZWxpYmVyYXRlbHkgY2Fubm90OlxuICogaXQgbmV2ZXIgY3JlYXRlcyBhIG1pc3NpbmcgZmlsZSwgc28gYW4gZW5kLXN0YXRlLXByZXNlbnQgcGF0aCBhZnRlciBhXG4gKiBmYWlsZWQgYHJtYCBpcyBuZXZlciBpdHMgZG9pbmcuXG4gKi9cbmNvbnN0IEZJTEVfUFJPRFVDSU5HX09QUzogUmVhZG9ubHlTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoWydjcmVhdGUtb3ZlcndyaXRlJywgJ3JlbmFtZS1jb3B5JywgJ3RydW5jYXRlJywgJ2FwcGVuZCddKTtcblxuLyoqIE9uZSBwYXNzLUEgZXZhbHVhdGlvbjogdGhlIHNwYW4sIGl0cyB0b3VjaCwgYW5kIHRoZSAocG9zdC1yZXNvbHV0aW9uKSBnYXRlIG91dGNvbWUuICovXG5pbnRlcmZhY2UgU3BhbkV2YWwge1xuICBtYXRjaDogUmVzb2x2ZWRNYXRjaDtcbiAgLyoqIFRoZSB0cmFuc2xhdGVkIHRvdWNoLCBvciBgbnVsbGAgd2hlbiB0aGUgc3BhbiBmYWlsZWQgYHJlc29sdmVUb3VjaFNjb3BlYC4gKi9cbiAgdG91Y2g6IFRvdWNoSW5wdXQgfCBudWxsO1xuICAvKiogVGhlIHBhc3MtQSBnYXRlIG91dGNvbWUsIHBvc3QtcmVzb2x1dGlvbiBmb3IgYCdwZW5kaW5nJ2AgYW5kIGV4cGxhaW5lZCBmYWlscy4gKi9cbiAgb3V0Y29tZTogV3JpdGVHYXRlT3V0Y29tZTtcbiAgLyoqIEEgZGVjaXNpdmVGYWlsIGRvd25ncmFkZWQgYnkgYSBsYXRlciBzYW1lLXBhdGggZGVjaXNpdmVQYXNzIChwbGFuIFx1MDBBNzMgc3RlcCAyKS4gKi9cbiAgZXhwbGFpbmVkOiBib29sZWFuO1xuICBjb21tYW5kSW5kZXg6IG51bWJlcjtcbiAgLyoqIFRoZSBzcGFuJ3Mgb3duIHBhdGggXHUyMDE0IHRoZSBleHBsYW5hdGlvbiBrZXkgZm9yIGRlY2lzaXZlIGZhaWxzLiAqL1xuICBwYXRoOiBzdHJpbmc7XG4gIC8qKiBjcCBkZXN0aW5hdGlvbnM6IHRoZSBwYWlyZWQgc291cmNlIHBhdGggXHUyMDE0IHRoZSBleHBsYW5hdGlvbiBrZXkgZm9yIHBlbmRpbmdzLiAqL1xuICBzb3VyY2VLZXk6IHN0cmluZyB8IG51bGw7XG59XG5cbi8qKlxuICogRXZhbHVhdGUgb25lIHNwYW4ncyBnYXRlLiBSZWFkcyBoYXZlIG5vIGdhdGUgXHUyMTkyIGAnaW5jb25jbHVzaXZlJ2AsIHdpdGggb25lXG4gKiBleGNlcHRpb246IGNwL2luc3RhbGwgc291cmNlIHJlYWRzIGdhdGUgb24gdGhlIHNvdXJjZSBleGlzdGluZyBwb3N0LWNvbW1hbmRcbiAqIChwbGFuIFx1MDBBNzIpIFx1MjAxNCBhIGZhaWxlZCBjb3B5IG5ldmVyIHJlYWQgYW55dGhpbmcuIFRoZSByZWFkIHZlcmRpY3QgZmxpcHMgb25seVxuICogdGhlIGNvbW1hbmQncyBqb2luIHZlcmRpY3QsIG5ldmVyIHRoZSBzYW1lIGNvbW1hbmQncyBkZXN0IHdyaXRlLlxuICovXG5mdW5jdGlvbiBldmFsU3BhbkdhdGUobWF0Y2g6IFJlc29sdmVkTWF0Y2gsIHRvdWNoOiBUb3VjaElucHV0IHwgbnVsbCwgcHJvYmVDYWNoZTogUmVhbGl0eVByb2JlQ2FjaGUpOiBXcml0ZUdhdGVPdXRjb21lIHtcbiAgaWYgKHRvdWNoID09PSBudWxsKSByZXR1cm4gJ2luY29uY2x1c2l2ZSc7XG4gIGlmICh0b3VjaC5raW5kID09PSAncmVhZCcpIHtcbiAgICBpZiAoKG1hdGNoLmlkaW9tID09PSAnY3Atd3JpdGUnIHx8IG1hdGNoLmlkaW9tID09PSAnaW5zdGFsbC13cml0ZScpICYmIG1hdGNoLnNwYW4ub3BlcmF0aW9uID09PSAncmVhZCcpIHtcbiAgICAgIHJldHVybiBmaWxlRXhpc3RzKG1hdGNoLnNwYW4uYWJzb2x1dGVQYXRoKSA/ICdpbmNvbmNsdXNpdmUnIDogJ2RlY2lzaXZlRmFpbCc7XG4gICAgfVxuICAgIHJldHVybiAnaW5jb25jbHVzaXZlJztcbiAgfVxuICByZXR1cm4gZXZhbHVhdGVXcml0ZUdhdGUodG91Y2gsIHByb2JlQ2FjaGUpO1xufVxuXG4vKiogVGhlIG9wZXJhdG9yIHByZWNlZGluZyBhIGNvbW1hbmQsIGZyb20gaXRzIGZpcnN0IHNwYW4gKGFsbCBzcGFucyBvZiBvbmUgY29tbWFuZCBzaGFyZSBpdCkgXHUyMDE0IG9yIGZyb20gaXRzIGd1YXJkIG1hdGNoIHdoZW4gdGhlIGNvbW1hbmQgaGFzIG5vIHNwYW5zLiAqL1xuZnVuY3Rpb24gam9pbk9mQ29tbWFuZChcbiAgaWR4OiBudW1iZXIsXG4gIGdyb3VwczogTWFwPG51bWJlciwgUmVzb2x2ZWRNYXRjaFtdPixcbiAgZ3VhcmRCeUluZGV4OiBNYXA8bnVtYmVyLCBHdWFyZE1hdGNoPlxuKTogJyYmJyB8ICd8fCcgfCB1bmRlZmluZWQge1xuICBjb25zdCBzcGFucyA9IGdyb3Vwcy5nZXQoaWR4KTtcbiAgaWYgKHNwYW5zICE9PSB1bmRlZmluZWQpIHtcbiAgICBmb3IgKGNvbnN0IG0gb2Ygc3BhbnMpIHtcbiAgICAgIGlmIChtLnNwYW4uam9pbiAhPT0gdW5kZWZpbmVkKSByZXR1cm4gbS5zcGFuLmpvaW47XG4gICAgfVxuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgcmV0dXJuIGd1YXJkQnlJbmRleC5nZXQoaWR4KT8uam9pbjtcbn1cblxuLyoqXG4gKiBTaGFyZWQgQmFzaCBkcml2ZXIgKHBsYW4gXHUwMEE3MyBzdGVwIDIpOiBvd25zIHRoZSBwZXItY29tbWFuZCB2ZXJkaWN0IHRocmVhZCBcdTIwMTRcbiAqIHBhc3MgQSBgZXZhbHVhdGVXcml0ZUdhdGVgIHN3ZWVwIChldmVyeSBzcGFuLCBiZWZvcmUgYW55IGpvaW4gZGVjaXNpb24pLFxuICogdGhlIGV4cGxhbmF0aW9uIG1hcCwgcGVyLWNvbW1hbmQgdmVyZGljdHMsIHRoZSBqb2luIGZpbHRlciB3aXRoIGNoYWluZWRcbiAqIHNraXBzLCBhbmQgcGFzcyBCIHBlci1zdXJ2aXZpbmctc3BhbiBgcnVuVG91Y2hIb29rYCBcdTIwMTQgcGx1cyB0aGUgd2hvbGUtY29tbWFuZFxuICogYGludGVycnVwdGVkYCBhbmQgZXhpdC1jb2RlIGdhdGVzIChwbGFuIFx1MDBBNzQpIGFuZCB0aGUgc3Bhbi1sZXNzLWd1YXJkXG4gKiBjb21tYW5kcyAoYGZhbHNlYC9gdHJ1ZWAvYDpgIGpvaW4gdmVyZGljdHMgd2l0aCBubyBzcGFucyBvZiB0aGVpciBvd24pLlxuICogUmV0dXJucyB0aGUgbm9uLW51bGwgYGFkZGl0aW9uYWxDb250ZXh0YCBibG9ja3MgZm9yIHRoZSBhZGFwdGVyIHRvIGpvaW47XG4gKiB0aGUgc2Vzc2lvbiBtZW1vIGRlZHVwcyByZXBlYXRlZCB0YXJnZXRzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuQmFzaFRvdWNoZXMoXG4gIG1hdGNoZXM6IFNwYW5NYXRjaFtdLFxuICBzZXNzaW9uSWQ6IHN0cmluZyxcbiAgY3dkOiBzdHJpbmcsXG4gIHRvb2xSZXNwb25zZTogdW5rbm93bixcbiAgZXhlY3V0b3JzOiBUb3VjaEV4ZWN1dG9ycyxcbiAgbWVtbzogTWVtb1N0b3JlLFxuICB3YXJuOiAobWVzc2FnZTogc3RyaW5nKSA9PiB2b2lkID0gY29uc29sZS53YXJuXG4pOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIC8vIEEgY29tbWFuZCB0aGF0IGRpZCBub3QgY29tcGxldGUgcHJvZHVjZXMgbm8gdG91Y2hlcywgd2hhdGV2ZXIgaXRzIHNwYW5zLlxuICBpZiAoYmFzaFJlc3BvbnNlSW50ZXJydXB0ZWQodG9vbFJlc3BvbnNlKSkgcmV0dXJuIFtdO1xuICBjb25zdCBleGl0Q29kZSA9IGJhc2hSZXNwb25zZUV4aXRDb2RlKHRvb2xSZXNwb25zZSk7XG4gIGNvbnN0IHJlc29sdmVkID0gbWF0Y2hlcy5maWx0ZXIoKG0pOiBtIGlzIFJlc29sdmVkTWF0Y2ggPT4gbS5zdGF0dXMgPT09ICdyZXNvbHZlZCcpO1xuICBjb25zdCBndWFyZHMgPSBtYXRjaGVzLmZpbHRlcigobSk6IG0gaXMgR3VhcmRNYXRjaCA9PiBtLnN0YXR1cyA9PT0gJ2J1aWx0aW4tZ3VhcmQnKTtcbiAgaWYgKHJlc29sdmVkLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuXG4gIC8vIFNlZWQgdGhlIHBlci1jb21tYW5kIHByb2JlIGNhY2hlIChwbGFuIFx1MDBBNzMgc3RlcCAxYykgd2l0aCBldmVyeSBhYnNlbnRcbiAgLy8gdGFyZ2V0IGFuZCBjcC9pbnN0YWxsIHNvdXJjZSBvZiB0aGUgY29tcG91bmQ7IHRoZSBmaXJzdCBnYXRlIHRoYXQgbmVlZHNcbiAgLy8gaXQgcnVucyBvbmUgbHMtZmlsZXMgKyBvbmUgc3Bhbi1saXN0IGJhdGNoIGZvciBhbGwgb2YgdGhlbS4gVGhlXG4gIC8vIGxhdGVyLXJlY3JlYXRlIGV4cGxhbmF0aW9uJ3MgcHJvYmUgc2NvcGUgKHJvdW5kLTMpIHJpZGVzIGFsb25nc2lkZTogdGhlXG4gIC8vIGRlbGV0ZSBwYXRocyBhIGxhdGVyIGNvbW1hbmQgY2FuIHJlLWNyZWF0ZSB3aXRoIGEgZmlsZS1wcm9kdWNpbmcgd3JpdGUgXHUyMDE0XG4gIC8vIHRoZWlyIHdvcmtpbmctdHJlZS12cy1pbmRleCBzdGF0dXMgaXMgdGhlIHJlLWNyZWF0ZSdzIG1hcmssIHJlYWQgb25jZSBpblxuICAvLyBvbmUgYGdpdCBzdGF0dXNgIGJhdGNoLlxuICBjb25zdCBwcm9iZVBhdGhzOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBmaWxlUHJvZHVjaW5nQnlQYXRoID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcltdPigpO1xuICBmb3IgKGNvbnN0IG0gb2YgcmVzb2x2ZWQpIHtcbiAgICBpZiAobS5zcGFuLm9wZXJhdGlvbiA9PT0gJ2RlbGV0ZScpIHByb2JlUGF0aHMucHVzaChtLnNwYW4uYWJzb2x1dGVQYXRoKTtcbiAgICBlbHNlIGlmICgobS5pZGlvbSA9PT0gJ2NwLXdyaXRlJyB8fCBtLmlkaW9tID09PSAnaW5zdGFsbC13cml0ZScpICYmIG0uc3Bhbi5vcGVyYXRpb24gPT09ICdyZWFkJykge1xuICAgICAgcHJvYmVQYXRocy5wdXNoKG0uc3Bhbi5hYnNvbHV0ZVBhdGgpO1xuICAgIH0gZWxzZSBpZiAoRklMRV9QUk9EVUNJTkdfT1BTLmhhcyhtLnNwYW4ub3BlcmF0aW9uKSkge1xuICAgICAgY29uc3QgbGlzdCA9IGZpbGVQcm9kdWNpbmdCeVBhdGguZ2V0KG0uc3Bhbi5hYnNvbHV0ZVBhdGgpO1xuICAgICAgaWYgKGxpc3QgIT09IHVuZGVmaW5lZCkgbGlzdC5wdXNoKG0uc3Bhbi5zaW1wbGVDb21tYW5kSW5kZXgpO1xuICAgICAgZWxzZSBmaWxlUHJvZHVjaW5nQnlQYXRoLnNldChtLnNwYW4uYWJzb2x1dGVQYXRoLCBbbS5zcGFuLnNpbXBsZUNvbW1hbmRJbmRleF0pO1xuICAgIH1cbiAgfVxuICBjb25zdCByZWNyZWF0ZVByb2JlUGF0aHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgbSBvZiByZXNvbHZlZCkge1xuICAgIGlmIChtLnNwYW4ub3BlcmF0aW9uICE9PSAnZGVsZXRlJykgY29udGludWU7XG4gICAgY29uc3QgbGF0ZXIgPSAoZmlsZVByb2R1Y2luZ0J5UGF0aC5nZXQobS5zcGFuLmFic29sdXRlUGF0aCkgPz8gW10pLnNvbWUoKGkpID0+IGkgPiBtLnNwYW4uc2ltcGxlQ29tbWFuZEluZGV4KTtcbiAgICBpZiAobGF0ZXIpIHJlY3JlYXRlUHJvYmVQYXRocy5wdXNoKG0uc3Bhbi5hYnNvbHV0ZVBhdGgpO1xuICB9XG4gIGNvbnN0IHByb2JlQ2FjaGUgPSBjcmVhdGVSZWFsaXR5UHJvYmVDYWNoZShwcm9iZVBhdGhzLCByZWNyZWF0ZVByb2JlUGF0aHMpO1xuXG4gIC8vIEdyb3VwIGJ5IHNpbXBsZSBjb21tYW5kIGluIHdhbGtlciBvcmRlci4gU3Bhbi1sZXNzIGd1YXJkIGNvbW1hbmRzXG4gIC8vIChgZmFsc2VgL2B0cnVlYC9gOmApIGpvaW4gdGhlIG9yZGVyIHdpdGggbm8gZ3JvdXA6IHRoZWlyIGRldGVybWluaXN0aWNcbiAgLy8gZXhpdCBzdGF0dXMgZHJpdmVzIHRoZSBqb2luIGZpbHRlciwgYW5kIHRoZXkgbmV2ZXIgdG91Y2ggYW55dGhpbmcuXG4gIGNvbnN0IGdyb3VwcyA9IG5ldyBNYXA8bnVtYmVyLCBSZXNvbHZlZE1hdGNoW10+KCk7XG4gIGNvbnN0IGd1YXJkQnlJbmRleCA9IG5ldyBNYXA8bnVtYmVyLCBHdWFyZE1hdGNoPigpO1xuICBjb25zdCBjb21tYW5kT3JkZXI6IG51bWJlcltdID0gW107XG4gIGZvciAoY29uc3QgbSBvZiByZXNvbHZlZCkge1xuICAgIGNvbnN0IGlkeCA9IG0uc3Bhbi5zaW1wbGVDb21tYW5kSW5kZXg7XG4gICAgY29uc3QgbGlzdCA9IGdyb3Vwcy5nZXQoaWR4KTtcbiAgICBpZiAobGlzdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBsaXN0LnB1c2gobSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGdyb3Vwcy5zZXQoaWR4LCBbbV0pO1xuICAgICAgY29tbWFuZE9yZGVyLnB1c2goaWR4KTtcbiAgICB9XG4gIH1cbiAgZm9yIChjb25zdCBnIG9mIGd1YXJkcykge1xuICAgIGlmIChncm91cHMuaGFzKGcuc2ltcGxlQ29tbWFuZEluZGV4KSB8fCBndWFyZEJ5SW5kZXguaGFzKGcuc2ltcGxlQ29tbWFuZEluZGV4KSkgY29udGludWU7XG4gICAgZ3VhcmRCeUluZGV4LnNldChnLnNpbXBsZUNvbW1hbmRJbmRleCwgZyk7XG4gICAgY29tbWFuZE9yZGVyLnB1c2goZy5zaW1wbGVDb21tYW5kSW5kZXgpO1xuICB9XG4gIGNvbW1hbmRPcmRlci5zb3J0KChhLCBiKSA9PiBhIC0gYik7XG5cbiAgLy8gUGFzcyBBOiB0cmFuc2xhdGUgZXZlcnkgc3BhbiBvbmNlIGFuZCBldmFsdWF0ZSBpdHMgZ2F0ZSwgcGFpcmluZ1xuICAvLyBjcC9pbnN0YWxsIHNvdXJjZXMgd2l0aCBkZXN0aW5hdGlvbnMgYW5kIG12IGRlbGV0ZXMgd2l0aCByZW5hbWUtY29waWVzIGJ5XG4gIC8vIGRlY2xhcmF0aW9uIG9yZGVyICh0aGUgcGFyc2VyIGVtaXRzIHNvdXJjZXMgYmVmb3JlIGRlc3RpbmF0aW9ucykuXG4gIGNvbnN0IGV2YWxzID0gbmV3IE1hcDxudW1iZXIsIFNwYW5FdmFsW10+KCk7XG4gIGZvciAoY29uc3QgaWR4IG9mIGNvbW1hbmRPcmRlcikge1xuICAgIGNvbnN0IHNwYW5zID0gZ3JvdXBzLmdldChpZHgpO1xuICAgIGlmIChzcGFucyA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTsgLy8gZ3VhcmQtb25seSBjb21tYW5kIFx1MjAxNCBub3RoaW5nIHRvIGV2YWx1YXRlXG4gICAgY29uc3QgcmVhZFBhdGhzID0gc3BhbnNcbiAgICAgIC5maWx0ZXIoKG0pID0+IChtLmlkaW9tID09PSAnY3Atd3JpdGUnIHx8IG0uaWRpb20gPT09ICdpbnN0YWxsLXdyaXRlJykgJiYgbS5zcGFuLm9wZXJhdGlvbiA9PT0gJ3JlYWQnKVxuICAgICAgLm1hcCgobSkgPT4gbS5zcGFuLmFic29sdXRlUGF0aCk7XG4gICAgY29uc3QgZGVsZXRlUGF0aHMgPSBzcGFucy5maWx0ZXIoKG0pID0+IG0uc3Bhbi5vcGVyYXRpb24gPT09ICdkZWxldGUnKS5tYXAoKG0pID0+IG0uc3Bhbi5hYnNvbHV0ZVBhdGgpO1xuICAgIGxldCByZWFkQ3Vyc29yID0gMDtcbiAgICBsZXQgZGVsZXRlQ3Vyc29yID0gMDtcbiAgICBjb25zdCBsaXN0OiBTcGFuRXZhbFtdID0gW107XG4gICAgZm9yIChjb25zdCBtIG9mIHNwYW5zKSB7XG4gICAgICBjb25zdCB0b3VjaCA9IGJhc2hTcGFuVG9Ub3VjaChtLnNwYW4sIHNlc3Npb25JZCwgY3dkKTtcbiAgICAgIGNvbnN0IGVudHJ5OiBTcGFuRXZhbCA9IHtcbiAgICAgICAgbWF0Y2g6IG0sXG4gICAgICAgIHRvdWNoLFxuICAgICAgICBvdXRjb21lOiAnaW5jb25jbHVzaXZlJyxcbiAgICAgICAgZXhwbGFpbmVkOiBmYWxzZSxcbiAgICAgICAgY29tbWFuZEluZGV4OiBpZHgsXG4gICAgICAgIHBhdGg6IG0uc3Bhbi5hYnNvbHV0ZVBhdGgsXG4gICAgICAgIHNvdXJjZUtleTogbnVsbFxuICAgICAgfTtcbiAgICAgIGlmICh0b3VjaCAhPT0gbnVsbCAmJiB0b3VjaC5raW5kID09PSAnd3JpdGUnKSB7XG4gICAgICAgIGlmIChtLnNwYW4ub3BlcmF0aW9uID09PSAnY3JlYXRlLW92ZXJ3cml0ZScgJiYgKG0uaWRpb20gPT09ICdjcC13cml0ZScgfHwgbS5pZGlvbSA9PT0gJ2luc3RhbGwtd3JpdGUnKSkge1xuICAgICAgICAgIGNvbnN0IHNvdXJjZSA9IHJlYWRQYXRoc1tyZWFkQ3Vyc29yXTtcbiAgICAgICAgICBpZiAoc291cmNlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHJlYWRDdXJzb3IgKz0gMTtcbiAgICAgICAgICAgIC8vIGBpbnN0YWxsIC1zYC9gLS1zdHJpcGAgaXMgZGVsaWJlcmF0ZWx5IG5ldmVyIHBhaXJlZDogc3RyaXBwZWRcbiAgICAgICAgICAgIC8vIG91dHB1dCBuZXZlciBlcXVhbHMgdGhlIHNvdXJjZSwgc28gaW5zdGFsbCBkZXN0cyBnYXRlXG4gICAgICAgICAgICAvLyBleGlzdGVuY2Utb25seSAocGxhbiBcdTAwQTczIHN0ZXAgMWIpLlxuICAgICAgICAgICAgaWYgKG0uaWRpb20gPT09ICdjcC13cml0ZScpIHtcbiAgICAgICAgICAgICAgdG91Y2guc291cmNlUGF0aCA9IHNvdXJjZTtcbiAgICAgICAgICAgICAgZW50cnkuc291cmNlS2V5ID0gc291cmNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChtLnNwYW4ub3BlcmF0aW9uID09PSAncmVuYW1lLWNvcHknKSB7XG4gICAgICAgICAgY29uc3Qgc291cmNlID0gZGVsZXRlUGF0aHNbZGVsZXRlQ3Vyc29yXTtcbiAgICAgICAgICBpZiAoc291cmNlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGRlbGV0ZUN1cnNvciArPSAxO1xuICAgICAgICAgICAgdG91Y2gucmVuYW1lU291cmNlUGF0aCA9IHNvdXJjZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGVudHJ5Lm91dGNvbWUgPSBldmFsU3BhbkdhdGUobSwgdG91Y2gsIHByb2JlQ2FjaGUpO1xuICAgICAgbGlzdC5wdXNoKGVudHJ5KTtcbiAgICB9XG4gICAgZXZhbHMuc2V0KGlkeCwgbGlzdCk7XG4gIH1cblxuICAvLyBUaGUgZXhwbGFuYXRpb24gbWFwIChwbGFuIFx1MDBBNzMgc3RlcCAyKTogdGhlIGhpZ2hlc3Qgc2ltcGxlQ29tbWFuZEluZGV4IHdpdGhcbiAgLy8gYSBkZWNpc2l2ZVBhc3Mgb24gZWFjaCBwYXRoLlxuICBjb25zdCBwYXNzQnlQYXRoID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcbiAgZm9yIChjb25zdCBpZHggb2YgY29tbWFuZE9yZGVyKSB7XG4gICAgY29uc3QgbGlzdCA9IGV2YWxzLmdldChpZHgpO1xuICAgIGlmIChsaXN0ID09PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xuICAgIGZvciAoY29uc3QgZSBvZiBsaXN0KSB7XG4gICAgICBpZiAoZS5vdXRjb21lID09PSAnZGVjaXNpdmVQYXNzJykge1xuICAgICAgICBjb25zdCBwcmV2ID0gcGFzc0J5UGF0aC5nZXQoZS5wYXRoKTtcbiAgICAgICAgaWYgKHByZXYgPT09IHVuZGVmaW5lZCB8fCBpZHggPiBwcmV2KSBwYXNzQnlQYXRoLnNldChlLnBhdGgsIGlkeCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gUmVzb2x2ZSB0aGUgYWJzZW50LXNvdXJjZSBob2xkcyBhZ2FpbnN0IHRoZSBub3ctY29tcGxldGUgbWFwLCBhbmRcbiAgLy8gZG93bmdyYWRlIGV4cGxhaW5lZCBmYWlsczogYSBkZWNpc2l2ZUZhaWwgb24gYSBwYXRoIGEgbGF0ZXIgY29tbWFuZFxuICAvLyBkZW1vbnN0cmFibHkgcmV3cm90ZSBvciBkZWxldGVkIGlzIHRoZSBvdmVyd3JpdGUsIG5vdCB0aGUgZWFybGllciBjb21tYW5kXG4gIC8vIGZhaWxpbmcgKHBsYW4gXHUwMEE3MyBzdGVwIDIpLlxuICBmb3IgKGNvbnN0IGlkeCBvZiBjb21tYW5kT3JkZXIpIHtcbiAgICBjb25zdCBsaXN0ID0gZXZhbHMuZ2V0KGlkeCk7XG4gICAgaWYgKGxpc3QgPT09IHVuZGVmaW5lZCkgY29udGludWU7XG4gICAgZm9yIChjb25zdCBlIG9mIGxpc3QpIHtcbiAgICAgIGlmIChlLm91dGNvbWUgPT09ICdwZW5kaW5nJykge1xuICAgICAgICBjb25zdCBwYXNzSWR4ID0gZS5zb3VyY2VLZXkgIT09IG51bGwgPyBwYXNzQnlQYXRoLmdldChlLnNvdXJjZUtleSkgOiB1bmRlZmluZWQ7XG4gICAgICAgIGUub3V0Y29tZSA9IHBhc3NJZHggIT09IHVuZGVmaW5lZCAmJiBwYXNzSWR4ID4gZS5jb21tYW5kSW5kZXggPyAnZGVjaXNpdmVQYXNzJyA6ICdkZWNpc2l2ZUZhaWwnO1xuICAgICAgfSBlbHNlIGlmIChlLm91dGNvbWUgPT09ICdkZWNpc2l2ZUZhaWwnKSB7XG4gICAgICAgIGNvbnN0IHBhc3NJZHggPSBwYXNzQnlQYXRoLmdldChlLnBhdGgpO1xuICAgICAgICBpZiAocGFzc0lkeCAhPT0gdW5kZWZpbmVkICYmIHBhc3NJZHggPiBlLmNvbW1hbmRJbmRleCkgZS5leHBsYWluZWQgPSB0cnVlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIFRoZSBsYXRlci1yZWNyZWF0ZSBleHBsYW5hdGlvbiAocm91bmQtMyk6IGEgZGVsZXRlJ3MgZGVjaXNpdmVGYWlsIFx1MjAxNFxuICAvLyBcImZpbGUgcHJlc2VudCwgc28gdGhlIGRlbGV0ZSBkaWRuJ3QgaGFwcGVuXCIgXHUyMDE0IGlzIGFsc28gZXhwbGFpbmVkIHdoZW4gYVxuICAvLyBMQVRFUiBjb21tYW5kIHdyaXRlcyB0aGUgc2FtZSBwYXRoIHdpdGggYSBmaWxlLXByb2R1Y2luZyBvcGVyYXRpb24gd2hvc2VcbiAgLy8gb3duIGdhdGUgZGlkIG5vdCBmYWlsIChhIGRlY2lzaXZlRmFpbCB0aGVyZSBwcm92ZXMgdGhlIHdyaXRlIGRpZG4ndFxuICAvLyBoYXBwZW4pIEFORCB0aGUgd29ya2luZyB0cmVlIGFjdHVhbGx5IGRpZmZlcnMgZnJvbSB0aGUgaW5kZXggXHUyMDE0IHRoZVxuICAvLyByZS1jcmVhdGUncyBtYXJrLCByZWFkIGZyb20gdGhlIHBlci1jb21tYW5kIHByb2JlLiBBIGZpbGUgdGhhdCBzdGlsbFxuICAvLyBtYXRjaGVzIHRoZSBpbmRleCBtZWFucyB0aGUgY2hhaW4gc2hvcnQtY2lyY3VpdGVkIGJlZm9yZSB0aGUgd3JpdGUgKHRoZVxuICAvLyBybSBmYWlsZWQgYW5kIGAmJmAgZHJvcHBlZCB0aGUgcmVzdCksIHNvIHRoZSBmYWlsIHN0YW5kcyBhbmQgdGhlIGpvaW5cbiAgLy8gZmlsdGVyIHN0aWxsIHN1cHByZXNzZXMgdGhlIGpvaW5lZCBjb21tYW5kLiBUaGlzIGlzIHRoZSBleGlzdGVuY2UtZ2F0ZWRcbiAgLy8gc2libGluZyBvZiB0aGUgZGVjaXNpdmVQYXNzIGV4cGxhbmF0aW9uIGFib3ZlOiBgcm0gZiAmJiBwYXRjaCAtcDAgPFxuICAvLyBuZXcuZGlmZmAgZW5kcyB3aXRoIGYgcHJlc2VudCBiZWNhdXNlIHRoZSBwYXRjaCByZS1jcmVhdGVkIGl0LCBub3RcbiAgLy8gYmVjYXVzZSB0aGUgcm0gZmFpbGVkLCBhbmQgdGhlIHBhdGNoJ3MgZ2F0ZSBpcyBpbmNvbmNsdXNpdmUgXHUyMDE0IG9ubHkgdGhpc1xuICAvLyBydWxlIGNhbiBzZWUgdGhlIHJlLWNyZWF0ZS4gQ29udGVudC12ZXJpZmllZCByZS1jcmVhdGVzIChlY2hvL2NwL1xuICAvLyB0cnVuY2F0ZSB3aXRoIGEgYm9keSkgbmV2ZXIgbmVlZCBpdCBcdTIwMTQgdGhlaXIgZGVjaXNpdmVQYXNzIGV4cGxhaW5zIHZpYVxuICAvLyB0aGUgbWFwIGFib3ZlLiBSZXNpZHVhbDogYSBwcmUtZXhpc3RpbmcgdW5jb21taXR0ZWQgY2hhbmdlIG9uIHRoZVxuICAvLyBkZWxldGVkIHBhdGggbWFza3MgdGhlIGRpc2NyaW1pbmF0b3IgKHRoZSBmaWxlIGRpZmZlcmVkIGZyb20gdGhlIGluZGV4XG4gIC8vIGJlZm9yZSB0aGUgY29tcG91bmQgZXZlciByYW4pLCBzbyBhbiBybSB0aGF0IGZhaWxlZCBvbiBhIGRpcnR5IHBhdGggbGV0c1xuICAvLyB0aGUgam9pbmVkIHdyaXRlIGZpcmUgYWR2aXNvcnkgXHUyMDE0IHNhbWUgYm91bmRlZCBoYXJtIGFzIHRoZSBwbGFuJ3NcbiAgLy8gZG9jdW1lbnRlZCBcImNvaW5jaWRlbnRhbGx5IHBhc3Nlc1wiIGpvaW4gY29ybmVyLCBhbmQgYSBoYXJuZXNzLXN1cHBsaWVkXG4gIC8vIG5vbi16ZXJvIGV4aXQgY29kZSBzdGlsbCBzdXBwcmVzc2VzIHRoZSBhZHZpc29yeSBjbGFzcyBpbiBwYXNzIEIuXG4gIGNvbnN0IHJlY3JlYXRlQnlQYXRoID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcbiAgZm9yIChjb25zdCBpZHggb2YgY29tbWFuZE9yZGVyKSB7XG4gICAgY29uc3QgbGlzdCA9IGV2YWxzLmdldChpZHgpO1xuICAgIGlmIChsaXN0ID09PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xuICAgIGZvciAoY29uc3QgZSBvZiBsaXN0KSB7XG4gICAgICBpZiAoZS5vdXRjb21lID09PSAnZGVjaXNpdmVGYWlsJykgY29udGludWU7XG4gICAgICBpZiAoZS50b3VjaCA9PT0gbnVsbCB8fCBlLnRvdWNoLmtpbmQgIT09ICd3cml0ZScgfHwgZS50b3VjaC50YXJnZXRTdGF0ZSAhPT0gJ2V4aXN0cycpIGNvbnRpbnVlO1xuICAgICAgaWYgKCFGSUxFX1BST0RVQ0lOR19PUFMuaGFzKGUubWF0Y2guc3Bhbi5vcGVyYXRpb24pKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IHByZXYgPSByZWNyZWF0ZUJ5UGF0aC5nZXQoZS5wYXRoKTtcbiAgICAgIGlmIChwcmV2ID09PSB1bmRlZmluZWQgfHwgaWR4ID4gcHJldikgcmVjcmVhdGVCeVBhdGguc2V0KGUucGF0aCwgaWR4KTtcbiAgICB9XG4gIH1cbiAgaWYgKHJlY3JlYXRlQnlQYXRoLnNpemUgPiAwKSB7XG4gICAgZm9yIChjb25zdCBpZHggb2YgY29tbWFuZE9yZGVyKSB7XG4gICAgICBjb25zdCBsaXN0ID0gZXZhbHMuZ2V0KGlkeCk7XG4gICAgICBpZiAobGlzdCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICAgIGZvciAoY29uc3QgZSBvZiBsaXN0KSB7XG4gICAgICAgIGlmIChlLm91dGNvbWUgIT09ICdkZWNpc2l2ZUZhaWwnIHx8IGUuZXhwbGFpbmVkKSBjb250aW51ZTtcbiAgICAgICAgaWYgKGUudG91Y2ggPT09IG51bGwgfHwgZS50b3VjaC5raW5kICE9PSAnd3JpdGUnIHx8IGUudG91Y2gudGFyZ2V0U3RhdGUgIT09ICdhYnNlbnQnKSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgcmVjcmVhdGVJZHggPSByZWNyZWF0ZUJ5UGF0aC5nZXQoZS5wYXRoKTtcbiAgICAgICAgaWYgKHJlY3JlYXRlSWR4ICE9PSB1bmRlZmluZWQgJiYgcmVjcmVhdGVJZHggPiBlLmNvbW1hbmRJbmRleCAmJiB3b3JraW5nVHJlZUNoYW5nZWQocHJvYmVDYWNoZSwgY3dkLCBlLnBhdGgpKSB7XG4gICAgICAgICAgZS5leHBsYWluZWQgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gUGVyLWNvbW1hbmQgdmVyZGljdHM6ICdmYWlsZWQnIG9uIGFueSB1bmV4cGxhaW5lZCBkZWNpc2l2ZUZhaWwsIGVsc2VcbiAgLy8gJ3N1Y2NlZWRlZCcgb24gYXQgbGVhc3Qgb25lIGRlY2lzaXZlIG91dGNvbWUsIGVsc2UgJ3Vua25vd24nLiBBXG4gIC8vIGd1YXJkLW9ubHkgY29tbWFuZCdzIGRldGVybWluaXN0aWMgZXhpdCBzdGF0dXMgSVMgaXRzIHZlcmRpY3QgKHBsYW4gXHUwMEE3M1xuICAvLyBzdGVwIDIncyBzcGFuLWxlc3MtZ3VhcmQgcnVsZSkuXG4gIGNvbnN0IGNvbXB1dGVkID0gbmV3IE1hcDxudW1iZXIsIFZlcmRpY3Q+KCk7XG4gIGZvciAoY29uc3QgaWR4IG9mIGNvbW1hbmRPcmRlcikge1xuICAgIGNvbnN0IGxpc3QgPSBldmFscy5nZXQoaWR4KTtcbiAgICBpZiAobGlzdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zdCBndWFyZCA9IGd1YXJkQnlJbmRleC5nZXQoaWR4KTtcbiAgICAgIGNvbXB1dGVkLnNldChpZHgsIGd1YXJkICE9PSB1bmRlZmluZWQgPyAoZ3VhcmQuZXhpdFN0YXR1cyA9PT0gMCA/ICdzdWNjZWVkZWQnIDogJ2ZhaWxlZCcpIDogJ3Vua25vd24nKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBsZXQgZmFpbGVkID0gZmFsc2U7XG4gICAgbGV0IHBhc3NlZCA9IGZhbHNlO1xuICAgIGZvciAoY29uc3QgZSBvZiBsaXN0KSB7XG4gICAgICBpZiAoZS5vdXRjb21lID09PSAnZGVjaXNpdmVGYWlsJyAmJiAhZS5leHBsYWluZWQpIGZhaWxlZCA9IHRydWU7XG4gICAgICBpZiAoZS5vdXRjb21lID09PSAnZGVjaXNpdmVQYXNzJykgcGFzc2VkID0gdHJ1ZTtcbiAgICB9XG4gICAgY29tcHV0ZWQuc2V0KGlkeCwgZmFpbGVkID8gJ2ZhaWxlZCcgOiBwYXNzZWQgPyAnc3VjY2VlZGVkJyA6ICd1bmtub3duJyk7XG4gIH1cblxuICAvLyBUaGUgam9pbiBmaWx0ZXIgKHBsYW4gXHUwMEE3MyBzdGVwIDIpOiBhIHNraXBwZWQgY29tbWFuZCdzIGNoYWluZWQgdmVyZGljdCBpc1xuICAvLyB0aGUgZ3VhcmQgdGhhdCBza2lwcGVkIGl0IFx1MjAxNCAnZmFpbGVkJyBhZnRlciBhbiAmJi1za2lwLCAnc3VjY2VlZGVkJyBhZnRlclxuICAvLyBhbiB8fC1za2lwIFx1MjAxNCBtYXRjaGluZyB0aGUgc2hlbGwgc2hvcnQtY2lyY3VpdCAoYSB8fCBiIHx8IGMgc3RvcHMgYWZ0ZXJcbiAgLy8gdGhlIGZpcnN0IHN1Y2Nlc3MpLiAndW5rbm93bicgZmFpbHMgb3Blbi5cbiAgY29uc3QgZWZmZWN0aXZlID0gbmV3IE1hcDxudW1iZXIsIFZlcmRpY3Q+KCk7XG4gIGNvbnN0IHNraXBwZWQgPSBuZXcgU2V0PG51bWJlcj4oKTtcbiAgbGV0IHByZXZJbmRleDogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG4gIGZvciAoY29uc3QgaWR4IG9mIGNvbW1hbmRPcmRlcikge1xuICAgIGNvbnN0IGpvaW4gPSBqb2luT2ZDb21tYW5kKGlkeCwgZ3JvdXBzLCBndWFyZEJ5SW5kZXgpO1xuICAgIGNvbnN0IHByZXZWZXJkaWN0ID0gcHJldkluZGV4ICE9PSBudWxsID8gZWZmZWN0aXZlLmdldChwcmV2SW5kZXgpIDogdW5kZWZpbmVkO1xuICAgIGlmIChwcmV2VmVyZGljdCAhPT0gdW5kZWZpbmVkICYmIGpvaW4gIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKChqb2luID09PSAnJiYnICYmIHByZXZWZXJkaWN0ID09PSAnZmFpbGVkJykgfHwgKGpvaW4gPT09ICd8fCcgJiYgcHJldlZlcmRpY3QgPT09ICdzdWNjZWVkZWQnKSkge1xuICAgICAgICBlZmZlY3RpdmUuc2V0KGlkeCwgam9pbiA9PT0gJyYmJyA/ICdmYWlsZWQnIDogJ3N1Y2NlZWRlZCcpO1xuICAgICAgICBza2lwcGVkLmFkZChpZHgpO1xuICAgICAgICBwcmV2SW5kZXggPSBpZHg7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH1cbiAgICBlZmZlY3RpdmUuc2V0KGlkeCwgY29tcHV0ZWQuZ2V0KGlkeCkhKTtcbiAgICBwcmV2SW5kZXggPSBpZHg7XG4gIH1cblxuICAvLyBQYXNzIEI6IHJ1biB0aGUgdG91Y2ggaG9vayBmb3Igc3Vydml2aW5nIHNwYW5zIG9ubHkgXHUyMDE0IGRlY2lzaXZlUGFzcywgb3JcbiAgLy8gaW5jb25jbHVzaXZlIHdpdGggYW4gJ2V4aXN0cycgdGFyZ2V0ICh0aGUgYWR2aXNvcnkgcmVzaWR1YWwgY2xhc3M6XG4gIC8vIGV4aXN0ZW5jZS1nYXRlZCBmYW1pbGllcyBmaXJlIGFuZCBoZWFsL3N1cmZhY2U7IHBoYW50b20gZGVsZXRlcyBuZXZlclxuICAvLyBmaXJlKS4gQSBoYXJuZXNzLXN1cHBsaWVkIG5vbi16ZXJvIGV4aXQgY29kZSBzdXBwcmVzc2VzIHRoZSBhZHZpc29yeVxuICAvLyBjbGFzcyB0b28sIGJvdW5kZWQgYnkgdHdvIGRvY3VtZW50ZWQtcmVzaWR1ZSBmYWNlcyAoc2VlXG4gIC8vIGJhc2hSZXNwb25zZUV4aXRDb2RlKTogdGhlIGNvZGUgaXMgdGhlIGNvbXBvdW5kJ3MsIHNvIGEgbWFza2VkIGZhaWx1cmVcbiAgLy8gKGBnaXQgYXBwbHkgcC5kaWZmIHx8IGVjaG8gb2tgIGV4aXRpbmcgMCkgc3VwcHJlc3NlcyBub3RoaW5nIGFuZCBhXG4gIC8vIHRyYWlsaW5nIGZhaWx1cmUgKGBzZWQgLWkgcy9hL2IvIGY7IGZhbHNlYCkgc3VwcHJlc3NlcyBhbiBlYXJsaWVyIHJlYWxcbiAgLy8gd3JpdGUgXHUyMDE0IGFuZCBhIG5vbnplcm8gY29kZSBkb2VzIG5vdCBwcm92ZSB0aGUgd3JpdGUgZGlkIG5vdCBoYXBwZW4gZm9yXG4gIC8vIHRoZSBub24tYXRvbWljIHdyaXRlcnMgdGhhdCBtb2RpZnkgYmVmb3JlIGZhaWxpbmcgKHBhdGNoIGFwcGx5aW5nXG4gIC8vIGVhcmxpZXIgaHVua3MsIGBnaXQgYXBwbHkgLS1yZWplY3RgLCBmb3JtYXR0ZXJzIHdyaXRpbmcgZml4ZXMgdGhlblxuICAvLyBleGl0aW5nIG5vbnplcm8pLiBBIHplcm8gb3IgYWJzZW50IGNvZGUgcHJvY2VlZHMsIGFuZCBjb250ZW50LXZlcmlmaWVkXG4gIC8vIGRlY2lzaXZlIHBhc3NlcyBmaXJlIHJlZ2FyZGxlc3MgKGZhaWwtb3BlbiwgcGxhbiBcdTAwQTc0KS4gR3VhcmQtb25seVxuICAvLyBjb21tYW5kcyBoYXZlIG5vIHRvdWNoZXMuIEV4cGxhaW5lZCBmYWlscyBhbmQgZGVjaXNpdmUgZmFpbHMgbmV2ZXJcbiAgLy8gcmVhY2ggYW4gZXhlY3V0b3IuXG4gIGNvbnN0IGJsb2Nrczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBpZHggb2YgY29tbWFuZE9yZGVyKSB7XG4gICAgaWYgKHNraXBwZWQuaGFzKGlkeCkpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGxpc3QgPSBldmFscy5nZXQoaWR4KTtcbiAgICBpZiAobGlzdCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICBsZXQgdG91Y2hlcyA9IDA7XG4gICAgZm9yIChjb25zdCBlIG9mIGxpc3QpIHtcbiAgICAgIGlmIChlLnRvdWNoID09PSBudWxsIHx8IGUuZXhwbGFpbmVkKSBjb250aW51ZTtcbiAgICAgIGlmIChlLm91dGNvbWUgPT09ICdkZWNpc2l2ZUZhaWwnKSBjb250aW51ZTtcbiAgICAgIGlmIChlLm91dGNvbWUgPT09ICdpbmNvbmNsdXNpdmUnICYmIGUudG91Y2gua2luZCA9PT0gJ3dyaXRlJyAmJiBlLnRvdWNoLnRhcmdldFN0YXRlID09PSAnYWJzZW50JykgY29udGludWU7XG4gICAgICBpZiAoZS5vdXRjb21lID09PSAnaW5jb25jbHVzaXZlJyAmJiBlLnRvdWNoLmtpbmQgPT09ICd3cml0ZScgJiYgZXhpdENvZGUgIT09IHVuZGVmaW5lZCAmJiBleGl0Q29kZSAhPT0gMClcbiAgICAgICAgY29udGludWU7XG4gICAgICBpZiAodG91Y2hlcyA+PSAzMikge1xuICAgICAgICAvLyBIYXJkIHBlci1jb21tYW5kIHZvbHVtZSBjYXAgKHBsYW4gXHUwMEE3MyBzdGVwIDIpOiBkcm9wIHRoZSBzdXJwbHVzIHdpdGhcbiAgICAgICAgLy8gYSB3YXJuaW5nIHJhdGhlciB0aGFuIGJsb3cgdGhlIGhvb2sgdGltZW91dCBvbiBhIDUwLWNvcHkgY2hhaW4uXG4gICAgICAgIHdhcm4oYEJhc2ggdG91Y2ggY2FwICgzMikgcmVhY2hlZCBmb3Igc2ltcGxlIGNvbW1hbmQgJHtpZHh9OyBkcm9wcGluZyB0aGUgcmVtYWluaW5nIHRvdWNoZXNgKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICB0b3VjaGVzICs9IDE7XG4gICAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCBydW5Ub3VjaEhvb2soZS50b3VjaCwgZXhlY3V0b3JzLCBtZW1vLCBwcm9iZUNhY2hlKTtcbiAgICAgIGlmIChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpIGJsb2Nrcy5wdXNoKG91dHB1dC5hZGRpdGlvbmFsQ29udGV4dCk7XG4gICAgfVxuICB9XG4gIHJldHVybiBibG9ja3M7XG59XG4iLCAiLyoqXG4gKiBTdGF0aWMgY2xhc3NpZmljYXRpb24gb2YgYSBCYXNoIHRvb2wgYGNvbW1hbmRgIHN0cmluZyBpbnRvIHRoZSBmaWxlXG4gKiBwYXRoKHMpICsgbGluZSByYW5nZShzKSBpdCByZWFkcyBvciB3cml0ZXMsIHdoZXJlIHRoYXQncyBzdGF0aWNhbGx5XG4gKiBkZXRlcm1pbmFibGUuIEJ1aWx0IGZyb20gYW4gZW1waXJpY2FsIHBhc3Mgb3ZlciB+MzFrIHJlYWwgQ2xhdWRlIENvZGVcbiAqIEJhc2ggaW52b2NhdGlvbnMgKHNlZSBhbmFseXplLXRyYW5zY3JpcHRzLm10cykgXHUyMDE0IHRoZSBpZGlvbXMgYmVsb3cgYXJlXG4gKiBleGFjdGx5IHRoZSBvbmVzIHRoYXQgdHVybmVkIG91dCB0byBiZSBjb21tb24gQU5EIHJlbGlhYmxlIHRoZXJlLlxuICpcbiAqIERlbGliZXJhdGVseSBOT1QgY292ZXJlZCAoc2VlIHRoZSByZXNlYXJjaCByZXBvcnQpOiBhd2sgTlItdHJpY2tzIChyYXJlLFxuICogdW5jb25zdHJhaW5lZCBzeW50YXgpLCBncmVwIC1uLy1BLy1CLy1DICh0aGUgd2luZG93IGlzIGFuY2hvcmVkIHRvIG1hdGNoXG4gKiBwb3NpdGlvbiwgd2hpY2ggaXMgZGF0YS1kZXBlbmRlbnQsIG5vdCBpbiB0aGUgY29tbWFuZCB0ZXh0KSwgZW1iZWRkZWRcbiAqIHB5dGhvbjMvbm9kZSBoZXJlZG9jIHNjcmlwdHMgKGEgZGlmZmVyZW50IGxhbmd1YWdlJ3MgQVNULCBub3QgYSBzaGVsbFxuICogY29uY2VybiksIGFuZCBgZmluZCA8ZGlyPiAtbmFtZS8tcGF0aCAuLi4gLWRlbGV0ZWAgKHRoZSBkZWxldGVkIHBhdGhzIGFyZVxuICogdGhlIGRpcmVjdG9yeSdzIGNvbnRlbnRzIGFzIHRoZSBmaW5kZXIgd2Fsa3MgaXQgXHUyMDE0IGRhdGEtZGVwZW5kZW50LCBub3RcbiAqIHN0YXRpY2FsbHkgZW51bWVyYWJsZTsgdGhlIHJlY3Vyc2l2ZS1yZW1vdmFsIGZhaWwtY2xvc2VkIHJ1bGUgYXBwbGllcykuXG4gKlxuICogVGhlIGNhcmQncyB3cml0ZS10b3VjaCBmYW1pbGllcyBcdTIwMTQgcmVkaXJlY3Rpb25zIGFuZCBoZXJlZG9jcyAoXHUwMEE3NS4xXHUyMDEzXHUwMEE3NS4yKSxcbiAqIGNwIGFuZCBpbnN0YWxsIChcdTAwQTc1LjMpLCBtdiBhbmQgZ2l0IG12IChcdTAwQTc1LjQpLCBybSBhbmQgdHJ1bmNhdGUgKFx1MDBBNzUuNSksXG4gKiBzZWQgLWkgKFx1MDBBNzUuNiksIHBhdGNoIGFuZCBnaXQgYXBwbHkgKFx1MDBBNzUuNyksIGZvcm1hdHRlciB3cml0ZSBmbGFncyAoXHUwMEE3NS44KSxcbiAqIGFuZCBnaXQgcmVzdG9yZS9jaGVja291dCBwYXRoc3BlY3MgKFx1MDBBNzUuOSkgXHUyMDE0IGFyZSB0aGUgZ3JhbW1hcnMgYmVsb3cuIEVhY2hcbiAqIGZhbWlseSBmYWlscyBjbG9zZWQgb24gd2hhdCBpdCBjYW5ub3Qgc3RhdGljYWxseSBhdHRyaWJ1dGU6XG4gKiBzaGVsbC1leHBhbmRlZCBvciBkeW5hbWljIGNvbnRlbnQsIHJlY3Vyc2l2ZSByZW1vdmFsIChgcm0gLXJgKSxcbiAqIGhlcmUtc3RyaW5ncyAoYDw8PGApLCBkaXJlY3Rvcnktc2hhcGVkIHRhcmdldHMsIHdyYXBwZXItd3JhcHBlZCBjb21tYW5kc1xuICogd2hvc2UgYXJndiBjYW5ub3QgYmUgcmVjb3ZlcmVkLCBhbmQgdW5tYXRjaGVkIHBhdGhzcGVjcyBlbWl0IG5vIHNwYW4gYXRcbiAqIGFsbCBvciBhbiBleHBsaWNpdCB1bnJlc29sdmVkIGVudHJ5IFx1MjAxNCBuZXZlciBhIGd1ZXNzZWQgd3JpdGUuXG4gKi9cbmltcG9ydCB7IHJlYWRGaWxlU3luYywgc3RhdFN5bmMgfSBmcm9tICdub2RlOmZzJztcbmltcG9ydCB7IGJhc2VuYW1lLCBqb2luIGFzIGpvaW5QYXRoLCByZXNvbHZlIGFzIHJlc29sdmVQYXRoIH0gZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IGNvdW50RmlsZUxpbmVzLCBjb3VudEdpdEJsb2JMaW5lcyB9IGZyb20gJy4vY29tbWFuZC1yZXNvbHZlLmpzJztcbmltcG9ydCB7IHR5cGUgU2ltcGxlQ29tbWFuZCwgc3BsaXRUb3BMZXZlbCwgc3RyaXBMZWFkaW5nQXNzaWdubWVudHMsIHR5cGUgVG9rZW4sIHRva2VuaXplIH0gZnJvbSAnLi9zaGVsbC1zcGxpdC5qcyc7XG5pbXBvcnQgeyB0eXBlIFBhdGhTdHJpcCwgcGFyc2VVbmlmaWVkRGlmZlJhbmdlIH0gZnJvbSAnLi91bmlmaWVkLWRpZmYuanMnO1xuXG4vKipcbiAqIFRoZSBleHBsaWNpdCBvcGVyYXRpb24ga2luZCBvZiBhIHJlc29sdmVkIHNwYW4uIFRoZSBhZGFwdGVycyB0cmFuc2xhdGUgZnJvbVxuICogdGhpcywgbmV2ZXIgZnJvbSBgaWRpb20gPT09ICdoZXJlZG9jLXdyaXRlJ2Atc3R5bGUgY2hlY2tzIChwbGFuIFx1MDBBNzEpLlxuICovXG5leHBvcnQgdHlwZSBPcGVyYXRpb24gPVxuICB8ICdyZWFkJyAvLyByZWFkIGlkaW9tczsgY3AvaW5zdGFsbCBzb3VyY2Ugb3BlcmFuZHNcbiAgfCAnY3JlYXRlLW92ZXJ3cml0ZScgLy8gdHJ1bmNhdGluZyBjb250ZW50IHdyaXRlczogPiByZWRpcmVjdHMsIHRlZSwgaGVyZWRvYyA+LCBjcC9tdiBkZXN0LCByZXN0b3JlL2NoZWNrb3V0LCBwYXRjaCBhZGRcbiAgfCAnYXBwZW5kJyAvLyA+PiByZWRpcmVjdHMsIHRlZSAtYSwgaGVyZWRvYyA+PlxuICB8ICdtb2RpZnknIC8vIGluLXBsYWNlIGVkaXRzIHdpdGggdW5rbm93biBjb250ZW50OiBzZWQgLWksIHBhdGNoIGh1bmtzLCBmb3JtYXR0ZXIgd3JpdGUgZmxhZ3NcbiAgfCAncmVuYW1lLWNvcHknIC8vIG12L2dpdCBtdi9wYXRjaC1yZW5hbWUgZGVzdGluYXRpb24gKHdob2xlLWZpbGUgd3JpdGUsIHNhbWUgdG91Y2ggYXMgY3JlYXRlLW92ZXJ3cml0ZSlcbiAgfCAndHJ1bmNhdGUnIC8vIDogPiBmLCBiYXJlID4gZiwgdHJ1bmNhdGVcbiAgfCAnZGVsZXRlJzsgLy8gcm0sIG12L2dpdCBtdiBzb3VyY2UsIHBhdGNoIGRlbGV0ZVxuXG5leHBvcnQgaW50ZXJmYWNlIFJlc29sdmVkU3BhbiB7XG4gIG9wZXJhdGlvbjogT3BlcmF0aW9uO1xuICBhYnNvbHV0ZVBhdGg6IHN0cmluZztcbiAgLyoqXG4gICAqIEV4YWN0IHJhbmdlOiBldmVyeSByZWFkOyBtb2RpZnkgb3BlcmF0aW9ucyB3aXRoIGEgc3RhdGljYWxseSBrbm93biByYW5nZVxuICAgKiAoc2VkIC1pIG51bWVyaWMgYWRkcmVzc2VzLCBwYXRjaCBodW5rIHVuaW9ucykuIEFic2VudCBmb3Igd3JpdGVzIFx1MjE5MlxuICAgKiB3aG9sZS1maWxlIHNjb3BlLlxuICAgKi9cbiAgbGluZVN0YXJ0PzogbnVtYmVyO1xuICBsaW5lRW5kPzogbnVtYmVyO1xuICAvKipcbiAgICogU3RhdGljYWxseSBrbm93biB3cml0dGVuIGNvbnRlbnQgXHUyMDE0IGFwcGVuZCBib2RpZXMgYW5kIGxpdGVyYWwgb3ZlcndyaXRlXG4gICAqIGJvZGllcyAoaGVyZWRvYy9lY2hvL3ByaW50Zi90ZWUgbGl0ZXJhbHMsIHBsYW4gXHUwMEE3MyBzdGVwIDFiKS4gT24gYXBwZW5kcyBpdFxuICAgKiBpcyB0aGUgc3VmZml4IGdhdGUncyBib2R5OyBvbiBgY3JlYXRlLW92ZXJ3cml0ZWAgaXQgaXMgdGhlIGV4YWN0IGdhdGUnc1xuICAgKiBwb3N0LWNvbnRlbnQgXHUyMDE0IHRoZSB0b3VjaCBpdHNlbGYgc3RheXMgd2hvbGUtZmlsZSAoYHdyaXR0ZW46ICcnYCkgZWl0aGVyXG4gICAqIHdheS5cbiAgICovXG4gIHdyaXR0ZW4/OiBzdHJpbmc7XG4gIC8qKlxuICAgKiBUaGUgc3RhdGljYWxseSBldmFsdWF0ZWQgYWJzb2x1dGUgYHRydW5jYXRlIC1zIE5gIHNpemUgKHBsYW4gXHUwMEE3NS41KTogdGhlXG4gICAqIFx1MDBBNzMgYHNpemVgIGdhdGUncyBwb3N0LWNvbW1hbmQgYnl0ZSBjb3VudCAoYC1zIDBgIFx1MjE5MiB0aGUgZW1wdHkgZ2F0ZSkuXG4gICAqIEFic2VudCBmb3IgcmVsYXRpdmUgc2l6ZXMgKGAtcyArTmAvYC1zIC1OYCksIGAtciByZWZgLCBhbmQgZXZlcnkgb3RoZXJcbiAgICogb3BlcmF0aW9uIFx1MjAxNCB0aG9zZSBnYXRlIGV4aXN0ZW5jZS1vbmx5LlxuICAgKi9cbiAgc2l6ZT86IG51bWJlcjtcbiAgLyoqXG4gICAqIE9yZGluYWwgb2YgdGhlIHNwYW4ncyBzaW1wbGUgY29tbWFuZCB3aXRoaW4gdGhlIGNvbXBvdW5kLCBpbiB3YWxrZXJcbiAgICogb3JkZXI7IGdyb3VwcyB0aGUgc3BhbnMgb2Ygb25lIGNvbW1hbmQgZm9yIGpvaW4gZ2F0aW5nIChwbGFuIFx1MDBBNzMgc3RlcCAyKS5cbiAgICovXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyO1xuICAvKipcbiAgICogVGhlIG9wZXJhdG9yIHByZWNlZGluZyB0aGUgc3BhbidzIHNpbXBsZSBjb21tYW5kOyBvbmx5IGAnJiYnYC9gJ3x8J2AgZ2F0ZS5cbiAgICogQWJzZW50IGZvciBgc3RhcnRgL2A7YC9uZXdsaW5lL2AmYC9gfGAgYm91bmRhcmllcy5cbiAgICovXG4gIGpvaW4/OiAnJiYnIHwgJ3x8JztcbiAgbm90ZT86IHN0cmluZztcbn1cblxuZXhwb3J0IHR5cGUgSWRpb20gPVxuICB8ICdzZWQtbi1yYW5nZSdcbiAgfCAnaGVhZC1maWxlJ1xuICB8ICd0YWlsLWZpbGUnXG4gIHwgJ2NhdC1maWxlJ1xuICB8ICdubC1maWxlJ1xuICB8ICdnaXQtc2hvdy1yZXYtcGF0aCdcbiAgfCAnZ2l0LWxvZy1MJ1xuICB8ICdoZXJlZG9jLXdyaXRlJ1xuICAvLyBUaGUgd3JpdGUtdG91Y2ggZmFtaWxpZXMgKHBsYW4gXHUwMEE3NSkuIElkaW9tIHN0YXlzIG1hdGNoIG1ldGFkYXRhIGZvciB0ZXN0c1xuICAvLyBhbmQgdW5yZXNvbHZlZCByZWFzb25zOyBhZGFwdGVyIGJlaGF2aW9yIGtleXMgb24gYG9wZXJhdGlvbmAsIG5ldmVyIGlkaW9tLlxuICB8ICdyZWRpcmVjdC13cml0ZScgLy8gXHUwMEE3NS4xOiBlY2hvL3ByaW50Zi90ZWUgY29udGVudCByZWRpcmVjdHNcbiAgfCAndHJ1bmNhdGUtd3JpdGUnIC8vIFx1MDBBNzUuMTogYmFyZSBgPiBmYCAvIGA6ID4gZmAgdHJ1bmNhdGlvbnNcbiAgfCAnY3Atd3JpdGUnIC8vIFx1MDBBNzUuM1xuICB8ICdpbnN0YWxsLXdyaXRlJyAvLyBcdTAwQTc1LjNcbiAgfCAnbXYtd3JpdGUnIC8vIFx1MDBBNzUuNDogbXYgYW5kIGdpdCBtdlxuICB8ICdybS13cml0ZScgLy8gXHUwMEE3NS41OiBybSBhbmQgZ2l0IHJtXG4gIHwgJ3RydW5jYXRlLWNvbW1hbmQnIC8vIFx1MDBBNzUuNTogdGhlIHRydW5jYXRlIGNvbW1hbmRcbiAgfCAnc2VkLWlucGxhY2UnIC8vIFx1MDBBNzUuNjogc2VkIC1pXG4gIHwgJ3BhdGNoLXdyaXRlJyAvLyBcdTAwQTc1Ljc6IHBhdGNoIGFuZCBnaXQgYXBwbHlcbiAgfCAnZm9ybWF0dGVyLXdyaXRlJyAvLyBcdTAwQTc1LjhcbiAgfCAnZ2l0LXJlc3RvcmUtd3JpdGUnIC8vIFx1MDBBNzUuOTogZ2l0IHJlc3RvcmUgcGF0aHNwZWNzXG4gIHwgJ2dpdC1jaGVja291dC13cml0ZSc7IC8vIFx1MDBBNzUuOTogZ2l0IGNoZWNrb3V0IC0tIHBhdGhzcGVjc1xuXG5leHBvcnQgdHlwZSBTcGFuTWF0Y2ggPVxuICB8IHsgc3RhdHVzOiAncmVzb2x2ZWQnOyBpZGlvbTogSWRpb207IHNwYW46IFJlc29sdmVkU3Bhbjsgbm90ZT86IHN0cmluZyB9XG4gIHwgeyBzdGF0dXM6ICd1bnJlc29sdmVkJzsgaWRpb206IElkaW9tOyBmaWxlQXJnOiBzdHJpbmc7IHJlYXNvbjogc3RyaW5nIH1cbiAgfCB7XG4gICAgICAvKipcbiAgICAgICAqIEEgc3Bhbi1sZXNzIGNvbW1hbmQgd2l0aCBhIGRldGVybWluaXN0aWMgZXhpdCBzdGF0dXMgXHUyMDE0IGBmYWxzZWAgKDEpLFxuICAgICAgICogYHRydWVgICgwKSwgYDpgICgwKS4gTm8gc3BhbiBhbmQgbm8gdG91Y2gsIGJ1dCB0aGUgam9pbiBkcml2ZXIgbmVlZHNcbiAgICAgICAqIHRoZSB2ZXJkaWN0OiBgZmFsc2UgJiYgZWNobyB4ID4gZmAgc2tpcHMgdGhlIGVjaG8sIGB0cnVlIHx8IGVjaG8geCA+XG4gICAgICAgKiBmYCBza2lwcyBpdCB0b28sIGFuZCB3aXRob3V0IHRoZSBndWFyZCBib3RoIHdvdWxkIGZpcmUgYW4gZXhhY3QtZ2F0ZVxuICAgICAgICogdG91Y2ggZm9yIGEgd3JpdGUgdGhhdCBuZXZlciByYW4gKHBsYW4gXHUwMEE3MyBzdGVwIDIncyBzcGFuLWxlc3MtZ3VhcmRcbiAgICAgICAqIHJ1bGUpLiBGaWx0ZXJlZCBvdXQgb2YgYHBhcnNlQ29tbWFuZGAncyBzcGFuIGxpc3Qgd2l0aCB0aGVcbiAgICAgICAqIHVucmVzb2x2ZWRzLlxuICAgICAgICovXG4gICAgICBzdGF0dXM6ICdidWlsdGluLWd1YXJkJztcbiAgICAgIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyO1xuICAgICAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ107XG4gICAgICBleGl0U3RhdHVzOiAwIHwgMTtcbiAgICB9O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIExpbmUtcmFuZ2Ugc3BlY3M6IHdoYXQgYSBtYXRjaGVkIGlkaW9tIHNheXMgYWJvdXQgdGhlIHJhbmdlLCBiZWZvcmUgd2Uga25vd1xuLy8gd2hldGhlciByZXNvbHZpbmcgaXQgbmVlZHMgdG8gY29uc3VsdCBhIHJlYWwgZmlsZS9naXQgYmxvYi5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50eXBlIExpbmVSYW5nZVNwZWMgPVxuICB8IHsga2luZDogJ2xpdGVyYWwnOyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAndXBwZXJCb3VuZEZyb21TdGFydCc7IGVuZDogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6ICd0b0VvZic7IHN0YXJ0OiBudW1iZXIgfVxuICB8IHsga2luZDogJ2xhc3ROTGluZXMnOyBjb3VudDogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6ICdhcHBlbmRMaW5lcyc7IGNvdW50OiBudW1iZXIgfTtcblxuZnVuY3Rpb24gcmVzb2x2ZVNwZWMoXG4gIHNwZWM6IExpbmVSYW5nZVNwZWMsXG4gIHRvdGFsTGluZXM6ICgpID0+IG51bWJlciB8IG51bGxcbik6IHsgbGluZVN0YXJ0OiBudW1iZXI7IGxpbmVFbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gIHN3aXRjaCAoc3BlYy5raW5kKSB7XG4gICAgY2FzZSAnbGl0ZXJhbCc6XG4gICAgICByZXR1cm4geyBsaW5lU3RhcnQ6IHNwZWMuc3RhcnQsIGxpbmVFbmQ6IHNwZWMuZW5kIH07XG4gICAgY2FzZSAndXBwZXJCb3VuZEZyb21TdGFydCc6IHtcbiAgICAgIGNvbnN0IHRvdGFsID0gdG90YWxMaW5lcygpO1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiAxLCBsaW5lRW5kOiB0b3RhbCAhPT0gbnVsbCA/IE1hdGgubWluKHNwZWMuZW5kLCB0b3RhbCkgOiBzcGVjLmVuZCB9O1xuICAgIH1cbiAgICBjYXNlICd0b0VvZic6IHtcbiAgICAgIGNvbnN0IHRvdGFsID0gdG90YWxMaW5lcygpO1xuICAgICAgaWYgKHRvdGFsID09PSBudWxsIHx8IHRvdGFsID09PSAwKSByZXR1cm4gbnVsbDtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogc3BlYy5zdGFydCwgbGluZUVuZDogTWF0aC5tYXgoc3BlYy5zdGFydCwgdG90YWwpIH07XG4gICAgfVxuICAgIGNhc2UgJ2xhc3ROTGluZXMnOiB7XG4gICAgICBjb25zdCB0b3RhbCA9IHRvdGFsTGluZXMoKTtcbiAgICAgIGlmICh0b3RhbCA9PT0gbnVsbCB8fCB0b3RhbCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gICAgICByZXR1cm4geyBsaW5lU3RhcnQ6IE1hdGgubWF4KDEsIHRvdGFsIC0gc3BlYy5jb3VudCArIDEpLCBsaW5lRW5kOiB0b3RhbCB9O1xuICAgIH1cbiAgICBjYXNlICdhcHBlbmRMaW5lcyc6IHtcbiAgICAgIGNvbnN0IHRvdGFsID0gdG90YWxMaW5lcygpID8/IDA7XG4gICAgICByZXR1cm4geyBsaW5lU3RhcnQ6IHRvdGFsICsgMSwgbGluZUVuZDogdG90YWwgKyBzcGVjLmNvdW50IH07XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGhhc1NoZWxsRXhwYW5zaW9uKHM6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gL1skYF0vLnRlc3Qocyk7XG59XG5cbmZ1bmN0aW9uIGxvb2tzVW5yZXNvbHZhYmxlKHM6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gaGFzU2hlbGxFeHBhbnNpb24ocykgfHwgL1sqP10vLnRlc3Qocyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSWRpb20gbWF0Y2hlcnM6IHB1cmUgZnVuY3Rpb25zIG92ZXIgb25lIHNpbXBsZSBjb21tYW5kJ3MgYXJndi5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5pbnRlcmZhY2UgUmF3Q2FuZGlkYXRlIHtcbiAga2luZDogJ2NhbmRpZGF0ZSc7XG4gIGlkaW9tOiBJZGlvbTtcbiAgZmlsZUFyZzogc3RyaW5nO1xuICBzcGVjOiBMaW5lUmFuZ2VTcGVjO1xuICByZXNvbHZlcktpbmQ6ICdmcycgfCB7IGtpbmQ6ICdnaXQnOyByZXY6IHN0cmluZyB9O1xuICBkaXJPdmVycmlkZT86IHN0cmluZztcbn1cbmludGVyZmFjZSBSYXdVbnJlc29sdmVkIHtcbiAga2luZDogJ3VucmVzb2x2ZWQnO1xuICBpZGlvbTogSWRpb207XG4gIGZpbGVBcmc6IHN0cmluZztcbiAgcmVhc29uOiBzdHJpbmc7XG59XG50eXBlIE1hdGNoUmVzdWx0ID0gUmF3Q2FuZGlkYXRlIHwgUmF3VW5yZXNvbHZlZDtcblxuY29uc3QgU0VEX1JBTkdFID0gL14oXFxkKykoPzosKFxcZCt8XFwkKSk/cCQvO1xuXG4vKiogU3BsaXQgYSBgc2VkYCBzY3JpcHQgYXJndW1lbnQgaW50byBpdHMgYDtgLXNlcGFyYXRlZCBzZWdtZW50cy4gKi9cbmZ1bmN0aW9uIHNlZFNjcmlwdFNlZ21lbnRzKHNjcmlwdDogc3RyaW5nKTogc3RyaW5nW10ge1xuICByZXR1cm4gc2NyaXB0LnNwbGl0KCc7Jyk7XG59XG5cbmZ1bmN0aW9uIG1hdGNoU2VkKGFyZ3Y6IHN0cmluZ1tdKTogTWF0Y2hSZXN1bHRbXSB7XG4gIGlmIChhcmd2WzBdICE9PSAnc2VkJykgcmV0dXJuIFtdO1xuICBjb25zdCByZXN0ID0gYXJndi5zbGljZSgxKTtcbiAgaWYgKCFyZXN0LmluY2x1ZGVzKCctbicpKSByZXR1cm4gW107XG4gIGxldCBzY3JpcHRJZHggPSAtMTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCByZXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKHJlc3RbaV0gPT09ICctbicpIGNvbnRpbnVlO1xuICAgIGlmIChzZWRTY3JpcHRTZWdtZW50cyhyZXN0W2ldKS5zb21lKChzZWcpID0+IFNFRF9SQU5HRS50ZXN0KHNlZykpKSB7XG4gICAgICBzY3JpcHRJZHggPSBpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG4gIGlmIChzY3JpcHRJZHggPT09IC0xKSByZXR1cm4gW107XG4gIGNvbnN0IGZpbGVDYW5kaWRhdGVzID0gcmVzdC5maWx0ZXIoKGEsIGkpID0+IGkgIT09IHNjcmlwdElkeCAmJiBhICE9PSAnLW4nICYmICFhLnN0YXJ0c1dpdGgoJy0nKSk7XG4gIGlmIChmaWxlQ2FuZGlkYXRlcy5sZW5ndGggIT09IDEpIHJldHVybiBbXTtcbiAgY29uc3QgZmlsZUFyZyA9IGZpbGVDYW5kaWRhdGVzWzBdO1xuICBjb25zdCByZXN1bHRzOiBNYXRjaFJlc3VsdFtdID0gW107XG4gIGZvciAoY29uc3Qgc2VnbWVudCBvZiBzZWRTY3JpcHRTZWdtZW50cyhyZXN0W3NjcmlwdElkeF0pKSB7XG4gICAgY29uc3QgbWF0Y2ggPSBzZWdtZW50Lm1hdGNoKFNFRF9SQU5HRSk7XG4gICAgaWYgKCFtYXRjaCkgY29udGludWU7XG4gICAgY29uc3Qgc3RhcnQgPSBOdW1iZXIucGFyc2VJbnQobWF0Y2hbMV0sIDEwKTtcbiAgICBjb25zdCBlbmRUb2tlbiA9IG1hdGNoWzJdO1xuICAgIGNvbnN0IHNwZWM6IExpbmVSYW5nZVNwZWMgPVxuICAgICAgZW5kVG9rZW4gPT09IHVuZGVmaW5lZFxuICAgICAgICA/IHsga2luZDogJ2xpdGVyYWwnLCBzdGFydCwgZW5kOiBzdGFydCB9XG4gICAgICAgIDogZW5kVG9rZW4gPT09ICckJ1xuICAgICAgICAgID8geyBraW5kOiAndG9Fb2YnLCBzdGFydCB9XG4gICAgICAgICAgOiB7IGtpbmQ6ICdsaXRlcmFsJywgc3RhcnQsIGVuZDogTnVtYmVyLnBhcnNlSW50KGVuZFRva2VuLCAxMCkgfTtcbiAgICByZXN1bHRzLnB1c2goeyBraW5kOiAnY2FuZGlkYXRlJywgaWRpb206ICdzZWQtbi1yYW5nZScsIGZpbGVBcmcsIHNwZWMsIHJlc29sdmVyS2luZDogJ2ZzJyB9KTtcbiAgfVxuICByZXR1cm4gcmVzdWx0cztcbn1cblxuZnVuY3Rpb24gcGFyc2VIZWFkVGFpbEZsYWdzKHJlc3Q6IHN0cmluZ1tdKToge1xuICBjb3VudDogbnVtYmVyIHwgbnVsbDtcbiAgZnJvbVN0YXJ0OiBib29sZWFuO1xuICBkaXNxdWFsaWZpZWQ6IGJvb2xlYW47XG4gIGZpbGVzOiBzdHJpbmdbXTtcbn0ge1xuICBjb25zdCBmaWxlczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGNvdW50OiBudW1iZXIgfCBudWxsID0gbnVsbDtcbiAgbGV0IGZyb21TdGFydCA9IGZhbHNlO1xuICBsZXQgZGlzcXVhbGlmaWVkID0gZmFsc2U7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcmVzdC5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSByZXN0W2ldO1xuICAgIGlmIChhID09PSAnLWYnIHx8IGEgPT09ICctRicgfHwgYSA9PT0gJy0tZm9sbG93JyB8fCBhLnN0YXJ0c1dpdGgoJy0tZm9sbG93PScpKSB7XG4gICAgICBkaXNxdWFsaWZpZWQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLXonIHx8IGEgPT09ICctLXplcm8tdGVybWluYXRlZCcpIHtcbiAgICAgIGRpc3F1YWxpZmllZCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctYycgfHwgYSA9PT0gJy0tYnl0ZXMnKSB7XG4gICAgICBkaXNxdWFsaWZpZWQgPSB0cnVlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgvXigtY3wtLWJ5dGVzPSkvLnRlc3QoYSkpIHtcbiAgICAgIGRpc3F1YWxpZmllZCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctcScgfHwgYSA9PT0gJy12JyB8fCBhID09PSAnLS1xdWlldCcgfHwgYSA9PT0gJy0tc2lsZW50JyB8fCBhID09PSAnLS12ZXJib3NlJykgY29udGludWU7XG4gICAgaWYgKGEgPT09ICctbicpIHtcbiAgICAgIGNvbnN0IHYgPSByZXN0W2kgKyAxXTtcbiAgICAgIGlmICh2ICE9PSB1bmRlZmluZWQgJiYgL15cXCs/XFxkKyQvLnRlc3QodikpIHtcbiAgICAgICAgZnJvbVN0YXJ0ID0gdi5zdGFydHNXaXRoKCcrJyk7XG4gICAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KHYucmVwbGFjZSgnKycsICcnKSwgMTApO1xuICAgICAgICBpICs9IDE7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLS1saW5lcz0nKSkge1xuICAgICAgY29uc3QgdiA9IGEuc2xpY2UoJy0tbGluZXM9Jy5sZW5ndGgpO1xuICAgICAgaWYgKC9eXFwrP1xcZCskLy50ZXN0KHYpKSB7XG4gICAgICAgIGZyb21TdGFydCA9IHYuc3RhcnRzV2l0aCgnKycpO1xuICAgICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludCh2LnJlcGxhY2UoJysnLCAnJyksIDEwKTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoL14tblxcKz9cXGQrJC8udGVzdChhKSkge1xuICAgICAgY29uc3QgdiA9IGEuc2xpY2UoMik7XG4gICAgICBmcm9tU3RhcnQgPSB2LnN0YXJ0c1dpdGgoJysnKTtcbiAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KHYucmVwbGFjZSgnKycsICcnKSwgMTApO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgvXlxcK1xcZCskLy50ZXN0KGEpKSB7XG4gICAgICBmcm9tU3RhcnQgPSB0cnVlO1xuICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQoYS5zbGljZSgxKSwgMTApO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgvXi1cXGQrJC8udGVzdChhKSkge1xuICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQoYS5zbGljZSgxKSwgMTApO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLScpIHtcbiAgICAgIGZpbGVzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTtcbiAgICBmaWxlcy5wdXNoKGEpO1xuICB9XG4gIHJldHVybiB7IGNvdW50LCBmcm9tU3RhcnQsIGRpc3F1YWxpZmllZCwgZmlsZXMgfTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hIZWFkKGFyZ3Y6IHN0cmluZ1tdKTogTWF0Y2hSZXN1bHRbXSB7XG4gIGlmIChhcmd2WzBdICE9PSAnaGVhZCcpIHJldHVybiBbXTtcbiAgY29uc3QgeyBjb3VudCwgZGlzcXVhbGlmaWVkLCBmaWxlcyB9ID0gcGFyc2VIZWFkVGFpbEZsYWdzKGFyZ3Yuc2xpY2UoMSkpO1xuICBpZiAoZGlzcXVhbGlmaWVkKSByZXR1cm4gW107XG4gIGNvbnN0IHJlYWxGaWxlcyA9IGZpbGVzLmZpbHRlcigoZikgPT4gZiAhPT0gJy0nKTtcbiAgaWYgKHJlYWxGaWxlcy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgY29uc3QgbiA9IGNvdW50ID8/IDEwO1xuICByZXR1cm4gcmVhbEZpbGVzLm1hcCgoZmlsZUFyZykgPT4gKHtcbiAgICBraW5kOiAnY2FuZGlkYXRlJyBhcyBjb25zdCxcbiAgICBpZGlvbTogJ2hlYWQtZmlsZScgYXMgY29uc3QsXG4gICAgZmlsZUFyZyxcbiAgICBzcGVjOiB7IGtpbmQ6ICd1cHBlckJvdW5kRnJvbVN0YXJ0JywgZW5kOiBuIH0gYXMgTGluZVJhbmdlU3BlYyxcbiAgICByZXNvbHZlcktpbmQ6ICdmcycgYXMgY29uc3RcbiAgfSkpO1xufVxuXG5mdW5jdGlvbiBtYXRjaFRhaWwoYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICd0YWlsJykgcmV0dXJuIFtdO1xuICBjb25zdCB7IGNvdW50LCBmcm9tU3RhcnQsIGRpc3F1YWxpZmllZCwgZmlsZXMgfSA9IHBhcnNlSGVhZFRhaWxGbGFncyhhcmd2LnNsaWNlKDEpKTtcbiAgaWYgKGRpc3F1YWxpZmllZCkgcmV0dXJuIFtdO1xuICBjb25zdCByZWFsRmlsZXMgPSBmaWxlcy5maWx0ZXIoKGYpID0+IGYgIT09ICctJyk7XG4gIGlmIChyZWFsRmlsZXMubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gIGNvbnN0IG4gPSBjb3VudCA/PyAxMDtcbiAgY29uc3Qgc3BlYzogTGluZVJhbmdlU3BlYyA9IGZyb21TdGFydCA/IHsga2luZDogJ3RvRW9mJywgc3RhcnQ6IG4gfSA6IHsga2luZDogJ2xhc3ROTGluZXMnLCBjb3VudDogbiB9O1xuICByZXR1cm4gcmVhbEZpbGVzLm1hcCgoZmlsZUFyZykgPT4gKHtcbiAgICBraW5kOiAnY2FuZGlkYXRlJyBhcyBjb25zdCxcbiAgICBpZGlvbTogJ3RhaWwtZmlsZScgYXMgY29uc3QsXG4gICAgZmlsZUFyZyxcbiAgICBzcGVjLFxuICAgIHJlc29sdmVyS2luZDogJ2ZzJyBhcyBjb25zdFxuICB9KSk7XG59XG5cbmZ1bmN0aW9uIGZpbmRHaXRTdWJjb21tYW5kKFxuICByZXN0OiBzdHJpbmdbXVxuKTogeyBzdWJJZHg6IG51bWJlcjsgc3ViY29tbWFuZDogc3RyaW5nOyBjRGlyOiBzdHJpbmcgfCBudWxsOyBjRGlyVW5yZXNvbHZhYmxlOiBib29sZWFuIH0gfCBudWxsIHtcbiAgbGV0IGNEaXI6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBsZXQgY0RpclVucmVzb2x2YWJsZSA9IGZhbHNlO1xuICBsZXQgaSA9IDA7XG4gIHdoaWxlIChpIDwgcmVzdC5sZW5ndGgpIHtcbiAgICBjb25zdCBhID0gcmVzdFtpXTtcbiAgICBpZiAoYSA9PT0gJy1DJykge1xuICAgICAgY29uc3QgdiA9IHJlc3RbaSArIDFdO1xuICAgICAgaWYgKHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGw7XG4gICAgICBpZiAoaGFzU2hlbGxFeHBhbnNpb24odikpIGNEaXJVbnJlc29sdmFibGUgPSB0cnVlO1xuICAgICAgZWxzZSBjRGlyID0gdjtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1jJykge1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIHJldHVybiB7IHN1YklkeDogaSwgc3ViY29tbWFuZDogYSwgY0RpciwgY0RpclVucmVzb2x2YWJsZSB9O1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG5jb25zdCBSRVZfUEFUSCA9IC9eKFteXFxzOl0rKTooLispJC87XG5cbmZ1bmN0aW9uIG1hdGNoR2l0U2hvdyhhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ2dpdCcpIHJldHVybiBbXTtcbiAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQoYXJndi5zbGljZSgxKSk7XG4gIGlmICghc3ViIHx8IHN1Yi5zdWJjb21tYW5kICE9PSAnc2hvdycpIHJldHVybiBbXTtcbiAgY29uc3QgYWZ0ZXIgPSBhcmd2XG4gICAgLnNsaWNlKDEpXG4gICAgLnNsaWNlKHN1Yi5zdWJJZHggKyAxKVxuICAgIC5maWx0ZXIoKGEpID0+ICFhLnN0YXJ0c1dpdGgoJy0nKSk7XG4gIGNvbnN0IHJldlBhdGhBcmcgPSBhZnRlci5maW5kKChhKSA9PiBSRVZfUEFUSC50ZXN0KGEpKTtcbiAgaWYgKCFyZXZQYXRoQXJnKSByZXR1cm4gW107XG4gIGNvbnN0IG0gPSByZXZQYXRoQXJnLm1hdGNoKFJFVl9QQVRIKTtcbiAgaWYgKCFtKSByZXR1cm4gW107XG4gIGNvbnN0IFssIHJldiwgcGF0aF0gPSBtO1xuICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUgfHwgaGFzU2hlbGxFeHBhbnNpb24ocmV2KSkge1xuICAgIHJldHVybiBbXG4gICAgICB7XG4gICAgICAgIGtpbmQ6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgaWRpb206ICdnaXQtc2hvdy1yZXYtcGF0aCcsXG4gICAgICAgIGZpbGVBcmc6IHBhdGgsXG4gICAgICAgIHJlYXNvbjogJ2dpdCAtQyB0YXJnZXQgb3IgcmV2aXNpb24gY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZSdcbiAgICAgIH1cbiAgICBdO1xuICB9XG4gIHJldHVybiBbXG4gICAge1xuICAgICAga2luZDogJ2NhbmRpZGF0ZScsXG4gICAgICBpZGlvbTogJ2dpdC1zaG93LXJldi1wYXRoJyxcbiAgICAgIGZpbGVBcmc6IHBhdGgsXG4gICAgICBzcGVjOiB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0OiAxIH0sXG4gICAgICByZXNvbHZlcktpbmQ6IHsga2luZDogJ2dpdCcsIHJldiB9LFxuICAgICAgZGlyT3ZlcnJpZGU6IHN1Yi5jRGlyID8/IHVuZGVmaW5lZFxuICAgIH1cbiAgXTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hHaXRMb2dMKGFyZ3Y6IHN0cmluZ1tdKTogTWF0Y2hSZXN1bHRbXSB7XG4gIGlmIChhcmd2WzBdICE9PSAnZ2l0JykgcmV0dXJuIFtdO1xuICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChhcmd2LnNsaWNlKDEpKTtcbiAgaWYgKCFzdWIgfHwgc3ViLnN1YmNvbW1hbmQgIT09ICdsb2cnKSByZXR1cm4gW107XG4gIGNvbnN0IGFmdGVyID0gYXJndi5zbGljZSgxKS5zbGljZShzdWIuc3ViSWR4ICsgMSk7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYWZ0ZXIubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYWZ0ZXJbaV07XG4gICAgbGV0IHNwZWM6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAgIGlmIChhID09PSAnLUwnKSBzcGVjID0gYWZ0ZXJbaSArIDFdID8/IG51bGw7XG4gICAgZWxzZSBpZiAoYS5zdGFydHNXaXRoKCctTCcpKSBzcGVjID0gYS5zbGljZSgyKTtcbiAgICBpZiAoIXNwZWMpIGNvbnRpbnVlO1xuICAgIGNvbnN0IG0gPSBzcGVjLm1hdGNoKC9eKFxcZCspLChcXGQrKTooLispJC8pO1xuICAgIGlmICghbSkgY29udGludWU7XG4gICAgY29uc3QgWywgcywgZSwgcGF0aF0gPSBtO1xuICAgIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSkge1xuICAgICAgcmV0dXJuIFtcbiAgICAgICAge1xuICAgICAgICAgIGtpbmQ6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgICBpZGlvbTogJ2dpdC1sb2ctTCcsXG4gICAgICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgICAgICByZWFzb246ICdnaXQgLUMgdGFyZ2V0IGNvbnRhaW5zIGFuIHVucmVzb2x2ZWQgc2hlbGwgdmFyaWFibGUnXG4gICAgICAgIH1cbiAgICAgIF07XG4gICAgfVxuICAgIHJldHVybiBbXG4gICAgICB7XG4gICAgICAgIGtpbmQ6ICdjYW5kaWRhdGUnLFxuICAgICAgICBpZGlvbTogJ2dpdC1sb2ctTCcsXG4gICAgICAgIGZpbGVBcmc6IHBhdGgsXG4gICAgICAgIHNwZWM6IHsga2luZDogJ2xpdGVyYWwnLCBzdGFydDogTnVtYmVyLnBhcnNlSW50KHMsIDEwKSwgZW5kOiBOdW1iZXIucGFyc2VJbnQoZSwgMTApIH0sXG4gICAgICAgIHJlc29sdmVyS2luZDogJ2ZzJyxcbiAgICAgICAgZGlyT3ZlcnJpZGU6IHN1Yi5jRGlyID8/IHVuZGVmaW5lZFxuICAgICAgfVxuICAgIF07XG4gIH1cbiAgcmV0dXJuIFtdO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEhlcmVkb2Mgd3JpdGVzIChwbGFuIFx1MDBBNzUuMik6IGhhbmRsZWQgYXMgYSBkZWRpY2F0ZWQgcmF3LXRleHQgcGFzcyBiZWNhdXNlIHRoZVxuLy8gYm9keSBjYW4gaXRzZWxmIGNvbnRhaW4gJiYvOy98L25ld2xpbmVzIHRoYXQgd291bGQgb3RoZXJ3aXNlIGNvbmZ1c2Vcbi8vIHNwbGl0VG9wTGV2ZWwuIFRoZSBvcGVuZXIgc2Nhbm5lciBpcyBxdW90ZS1hd2FyZSBhbmQgdmFsaWRhdGVzIHRoZSBjbG9zaW5nXG4vLyBkZWxpbWl0ZXI7IG1hdGNoZWQgaGVyZWRvY3MgYXJlIG1hc2tlZCBvdXQgb2YgdGhlIHN0cmluZyAocmVwbGFjZWQgd2l0aCBhblxuLy8gaW5kZXhlZCBwbGFjZWhvbGRlciBzaW1wbGUtY29tbWFuZCkgYmVmb3JlIHRoZSByZXN0IG9mIHRoZSBwaXBlbGluZSBydW5zLFxuLy8gYW5kIHJlLWFzc29jaWF0ZWQgYnkgaW5kZXggZHVyaW5nIHRoZSBtYWluIHdhbGsgc28gdGhlIHdyaXRlIGlzIHJlc29sdmVkXG4vLyBhZ2FpbnN0IHRoZSBjb3JyZWN0IGBjZGAtdHJhY2tlZCBkaXJlY3RvcnkuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFRoZSBoZXJlZG9jJ3MgY29udGVudC1jYXJyeWluZyBmYWN0cywgcmUtYXNzb2NpYXRlZCBieSBpbmRleCBkdXJpbmcgdGhlIHdhbGsuICovXG5pbnRlcmZhY2UgSGVyZWRvY1dyaXRlIHtcbiAgLyoqIFRoZSBvcGVuZXIgbGluZSB2ZXJiYXRpbSAoZS5nLiBgY2F0ID4gZiA8PCdFT0YnYCksIHJlLXRva2VuaXplZCBkdXJpbmcgdGhlIHdhbGsuICovXG4gIG9wZW5lcjogc3RyaW5nO1xuICAvKiogVGhlIGhlcmVkb2MgYm9keTsgYDw8LWAgYm9kaWVzIGhhdmUgbGVhZGluZyB0YWJzIHN0cmlwcGVkIHBlciBsaW5lLiAqL1xuICBib2R5OiBzdHJpbmc7XG4gIC8qKiBXaGV0aGVyIHRoZSBkZWxpbWl0ZXIgd2FzIHF1b3RlZC9lc2NhcGVkIChgPDwnRU9GJ2AsIGA8PFwiRU9GXCJgLCBgPDxcXEVPRmApOiB0aGUgYm9keSB0aGVuIHVuZGVyZ29lcyBubyBzaGVsbCBleHBhbnNpb24uICovXG4gIHF1b3RlZERlbGltOiBib29sZWFuO1xufVxuXG5pbnRlcmZhY2UgSGVyZWRvY09wZW5lciB7XG4gIC8qKiBXaGVyZSB0aGUgaGVyZWRvYydzIHNpbXBsZSBjb21tYW5kIHN0YXJ0cyBpbiB0aGUgcmF3IHN0cmluZy4gKi9cbiAgY21kU3RhcnQ6IG51bWJlcjtcbiAgLyoqIFRoZSBuZXdsaW5lIGVuZGluZyB0aGUgb3BlbmVyIGxpbmUsIG9yIHJhdy5sZW5ndGggd2hlbiBpdCdzIHRoZSBsYXN0IGxpbmUuICovXG4gIG9wZW5lckxpbmVFbmQ6IG51bWJlcjtcbiAgLyoqIFRoZSBjbG9zaW5nIGRlbGltaXRlciAocXVvdGVzIHN0cmlwcGVkKS4gKi9cbiAgZGVsaW06IHN0cmluZztcbiAgLyoqIGA8PC1gOiBzdHJpcCBsZWFkaW5nIHRhYnMgZnJvbSB0aGUgYm9keSBhbmQgdGhlIGNsb3NlciBsaW5lLiAqL1xuICB0YWJTdHJpcDogYm9vbGVhbjtcbiAgLyoqIFdoZXRoZXIgdGhlIGRlbGltaXRlciB3YXMgcXVvdGVkL2VzY2FwZWQgXHUyMDE0IHRoZSBzaGVsbCBza2lwcyBib2R5IGV4cGFuc2lvbiB0aGVuLiAqL1xuICBxdW90ZWREZWxpbTogYm9vbGVhbjtcbn1cblxuY29uc3QgQkFSRV9ERUxJTSA9IC9eW0EtWmEtel9dW0EtWmEtejAtOV9dKiQvO1xuXG4vKipcbiAqIEZpbmQgdGhlIG5leHQgaGVyZWRvYyBvcGVuZXIgKGA8PGAvYDw8LWApIGF0IHRvcCBsZXZlbCwgc2Nhbm5pbmcgZnJvbVxuICogYGZyb21gLiBNaXJyb3JzIHNwbGl0VG9wTGV2ZWwncyBzZXBhcmF0b3IgaGFuZGxpbmcgc28gYGNtZFN0YXJ0YCBtYXJrcyB0aGVcbiAqIG9wZW5lcidzIG93biBzaW1wbGUgY29tbWFuZDogdG9wLWxldmVsIGAmJmAvYHx8YC9gO2AvbmV3bGluZS9gJmAgc3RhcnQgYSBuZXdcbiAqIGNvbW1hbmQgKGEgbmV3bGluZSBhZnRlciBhIHBpcGUgaXMgYSBsaW5lIGNvbnRpbnVhdGlvbiksIGA+YC1yZWRpcmVjdHMsIGR1cFxuICogcmVkaXJlY3RzIChgMj4mMWApIGFuZCBwYXJlbiBuZXN0aW5nIHN0YXkgaW5zaWRlIHRoZSBjb21tYW5kLCBhbmRcbiAqIGhlcmUtc3RyaW5ncyAoYDw8PGApIGFyZSBvdXQgb2Ygc2NvcGUuIEFuIElPX05VTUJFUiBmZCBkaXJlY3RseSBiZWZvcmUgdGhlXG4gKiBvcGVyYXRvciAoYDI8PEVPRmApIHJlZGlyZWN0cyB0aGF0IGZkLCBub3Qgc3RkaW4gXHUyMDE0IG5vdCBhIGhlcmVkb2MuIFJldHVybnNcbiAqIG51bGwgd2hlbiBubyBvcGVuZXIgaXMgZm91bmQuXG4gKi9cbmZ1bmN0aW9uIGZpbmRIZXJlZG9jT3BlbmVyKHJhdzogc3RyaW5nLCBmcm9tOiBudW1iZXIpOiBIZXJlZG9jT3BlbmVyIHwgbnVsbCB7XG4gIGNvbnN0IG4gPSByYXcubGVuZ3RoO1xuICBsZXQgaW5TcXVvdGUgPSBmYWxzZTtcbiAgbGV0IGluRHF1b3RlID0gZmFsc2U7XG4gIGxldCBkZXB0aCA9IDA7XG4gIGxldCBjbWRTdGFydCA9IGZyb207XG4gIGxldCBwZW5kaW5nUGlwZSA9IGZhbHNlO1xuICBsZXQgaSA9IGZyb207XG5cbiAgLyoqIFJlYWQgb25lIGRlbGltaXRlciB3b3JkIHN0YXJ0aW5nIGF0IGBzdGFydGAgKHRoZSBhdHRhY2hlZCB0YWlsIG9mIGA8PEVPRmAvYDw8J0VPRidgLCBvciBhIHN0YW5kYWxvbmUgbmV4dCB3b3JkKS4gUXVvdGVzIGNvbnRyaWJ1dGUgdGhlaXIgY29udGVudDsgYSBiYWNrc2xhc2ggZXNjYXBlcyB0aGUgbmV4dCBjaGFyLiBSZXR1cm5zIG51bGwgb24gYW4gdW5iYWxhbmNlZCBxdW90ZSAoZmFpbCBjbG9zZWQpLiAqL1xuICBjb25zdCByZWFkRGVsaW1Xb3JkID0gKHN0YXJ0OiBudW1iZXIpOiB7IGRlbGltOiBzdHJpbmc7IHNhd1F1b3RlOiBib29sZWFuOyBuZXh0OiBudW1iZXIgfSB8IG51bGwgPT4ge1xuICAgIGxldCBkID0gJyc7XG4gICAgbGV0IHNhd1F1b3RlID0gZmFsc2U7XG4gICAgbGV0IGsgPSBzdGFydDtcbiAgICB3aGlsZSAoayA8IG4gJiYgIS9cXHMvLnRlc3QocmF3W2tdKSAmJiByYXdba10gIT09ICc8JyAmJiByYXdba10gIT09ICc+Jykge1xuICAgICAgY29uc3QgYyA9IHJhd1trXTtcbiAgICAgIGlmIChjID09PSBcIidcIiB8fCBjID09PSAnXCInKSB7XG4gICAgICAgIGNvbnN0IHF1b3RlID0gYztcbiAgICAgICAgbGV0IG0gPSBrICsgMTtcbiAgICAgICAgd2hpbGUgKG0gPCBuICYmIHJhd1ttXSAhPT0gcXVvdGUpIHtcbiAgICAgICAgICBkICs9IHJhd1ttXTtcbiAgICAgICAgICBtICs9IDE7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG0gPj0gbikgcmV0dXJuIG51bGw7XG4gICAgICAgIHNhd1F1b3RlID0gdHJ1ZTtcbiAgICAgICAgayA9IG0gKyAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXFxcXCcgJiYgayArIDEgPCBuKSB7XG4gICAgICAgIC8vIEEgYmFja3NsYXNoLWVzY2FwZWQgZGVsaW1pdGVyIGNoYXIgcXVvdGVzIHRoZSBkZWxpbWl0ZXIgXHUyMDE0IHRoZSBib2R5XG4gICAgICAgIC8vIGlzIGxpdGVyYWwgKGA8PFxcRU9GYCksIHNhbWUgYXMgcXVvdGVzLlxuICAgICAgICBkICs9IHJhd1trICsgMV07XG4gICAgICAgIHNhd1F1b3RlID0gdHJ1ZTtcbiAgICAgICAgayArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGQgKz0gYztcbiAgICAgIGsgKz0gMTtcbiAgICB9XG4gICAgcmV0dXJuIHsgZGVsaW06IGQsIHNhd1F1b3RlLCBuZXh0OiBrIH07XG4gIH07XG5cbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgY29uc3QgYyA9IHJhd1tpXTtcbiAgICBpZiAoaW5TcXVvdGUpIHtcbiAgICAgIGlmIChjID09PSBcIidcIikgaW5TcXVvdGUgPSBmYWxzZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaW5EcXVvdGUpIHtcbiAgICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1wiJykgaW5EcXVvdGUgPSBmYWxzZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gXCInXCIpIHtcbiAgICAgIGluU3F1b3RlID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1wiJykge1xuICAgICAgaW5EcXVvdGUgPSB0cnVlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcoJykge1xuICAgICAgZGVwdGggKz0gMTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJyknKSB7XG4gICAgICBkZXB0aCA9IE1hdGgubWF4KDAsIGRlcHRoIC0gMSk7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGRlcHRoID4gMCkge1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChyYXcuc3RhcnRzV2l0aCgnJiYnLCBpKSB8fCByYXcuc3RhcnRzV2l0aCgnfHwnLCBpKSkge1xuICAgICAgY21kU3RhcnQgPSBpICsgMjtcbiAgICAgIHBlbmRpbmdQaXBlID0gZmFsc2U7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKHJhdy5zdGFydHNXaXRoKCd8JicsIGkpKSB7XG4gICAgICBjbWRTdGFydCA9IGkgKyAxO1xuICAgICAgcGVuZGluZ1BpcGUgPSB0cnVlO1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnOycpIHtcbiAgICAgIGNtZFN0YXJ0ID0gaSArIDE7XG4gICAgICBwZW5kaW5nUGlwZSA9IGZhbHNlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnfCcpIHtcbiAgICAgIGNtZFN0YXJ0ID0gaSArIDE7XG4gICAgICBwZW5kaW5nUGlwZSA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcXG4nKSB7XG4gICAgICAvLyBBIG5ld2xpbmUgYWZ0ZXIgYSBwaXBlIGlzIGEgbGluZSBjb250aW51YXRpb24gKG1pcnJvcmluZ1xuICAgICAgLy8gc3BsaXRUb3BMZXZlbCk7IGFueXRoaW5nIGVsc2Ugc3RhcnRzIGEgbmV3IHNpbXBsZSBjb21tYW5kLlxuICAgICAgaWYgKCFwZW5kaW5nUGlwZSkgY21kU3RhcnQgPSBpICsgMTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJyYnKSB7XG4gICAgICAvLyBgJj5gL2AmPj5gIGFuZCBkdXAgcmVkaXJlY3RzIChgMj4mMWApIGFyZSByZWRpcmVjdCBvcGVyYXRvcnMsIG5vdFxuICAgICAgLy8gY29tbWFuZCBzZXBhcmF0b3JzIChtaXJyb3Jpbmcgc3BsaXRUb3BMZXZlbCkuXG4gICAgICBjb25zdCB0cmltbWVkID0gcmF3LnNsaWNlKGNtZFN0YXJ0LCBpKS50cmltRW5kKCk7XG4gICAgICBjb25zdCBkdXBSZWRpcmVjdCA9XG4gICAgICAgIHRyaW1tZWQuZW5kc1dpdGgoJz4nKSAmJiAodHJpbW1lZC5sZW5ndGggPT09IDEgfHwgL1xcc3xcXGQvLnRlc3QodHJpbW1lZFt0cmltbWVkLmxlbmd0aCAtIDJdID8/ICcnKSk7XG4gICAgICBpZiAocmF3W2kgKyAxXSA9PT0gJz4nIHx8IGR1cFJlZGlyZWN0KSB7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjbWRTdGFydCA9IGkgKyAxO1xuICAgICAgcGVuZGluZ1BpcGUgPSBmYWxzZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJzwnICYmIHJhd1tpICsgMV0gPT09ICc8Jykge1xuICAgICAgLy8gYDw8PGAgaXMgYSBoZXJlLXN0cmluZyAob3V0IG9mIHNjb3BlKTsgYDw8LWAgc3RyaXBzIGxlYWRpbmcgdGFicy5cbiAgICAgIGlmIChyYXdbaSArIDJdID09PSAnPCcpIHtcbiAgICAgICAgaSArPSAzO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGxldCBqID0gaSAtIDE7XG4gICAgICB3aGlsZSAoaiA+PSBmcm9tICYmIC9cXGQvLnRlc3QocmF3W2pdKSkgaiAtPSAxO1xuICAgICAgY29uc3QgaW9OdW1iZXIgPSBqIDwgaSAtIDEgJiYgKGogPCBmcm9tIHx8IC9cXHN8Wzt8JihdLy50ZXN0KHJhd1tqXSkpO1xuICAgICAgaWYgKGlvTnVtYmVyKSB7XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCB0YWJTdHJpcCA9IHJhd1tpICsgMl0gPT09ICctJztcbiAgICAgIGNvbnN0IG9wTGVuID0gdGFiU3RyaXAgPyAzIDogMjtcbiAgICAgIGNvbnN0IGxpbmVFbmQgPSByYXcuaW5kZXhPZignXFxuJywgaSk7XG4gICAgICBjb25zdCBvcGVuZXJMaW5lRW5kID0gbGluZUVuZCA9PT0gLTEgPyBuIDogbGluZUVuZDtcbiAgICAgIGNvbnN0IGF0dGFjaGVkID0gcmVhZERlbGltV29yZChpICsgb3BMZW4pO1xuICAgICAgbGV0IGRlbGltID0gYXR0YWNoZWQgPT09IG51bGwgPyAnJyA6IGF0dGFjaGVkLmRlbGltO1xuICAgICAgbGV0IHNhd1F1b3RlID0gYXR0YWNoZWQgPT09IG51bGwgPyBmYWxzZSA6IGF0dGFjaGVkLnNhd1F1b3RlO1xuICAgICAgaWYgKGRlbGltID09PSAnJyAmJiBhdHRhY2hlZCAhPT0gbnVsbCkge1xuICAgICAgICAvLyBTdGFuZGFsb25lIG9wZXJhdG9yOiB0aGUgZGVsaW1pdGVyIGlzIHRoZSBuZXh0IHdvcmQuXG4gICAgICAgIGxldCBrID0gYXR0YWNoZWQubmV4dDtcbiAgICAgICAgd2hpbGUgKGsgPCBvcGVuZXJMaW5lRW5kICYmIC9cXHMvLnRlc3QocmF3W2tdKSkgayArPSAxO1xuICAgICAgICBjb25zdCB3b3JkID0gcmVhZERlbGltV29yZChrKTtcbiAgICAgICAgaWYgKHdvcmQgPT09IG51bGwpIGRlbGltID0gJyc7XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgIGRlbGltID0gd29yZC5kZWxpbTtcbiAgICAgICAgICBzYXdRdW90ZSA9IHdvcmQuc2F3UXVvdGU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChkZWxpbSA9PT0gJycgfHwgKCFzYXdRdW90ZSAmJiAhQkFSRV9ERUxJTS50ZXN0KGRlbGltKSkpIHtcbiAgICAgICAgLy8gTm8gZGVsaW1pdGVyLCBvciBhIGJhcmUgZm9ybSBvdXRzaWRlIHRoZSBpZGVudGlmaWVyIHNoYXBlIFx1MjAxNCBmYWlsXG4gICAgICAgIC8vIGNsb3NlZCBhbmQga2VlcCBzY2FubmluZyBwYXN0IHRoZSBvcGVyYXRvci5cbiAgICAgICAgaSArPSBvcExlbjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICByZXR1cm4geyBjbWRTdGFydCwgb3BlbmVyTGluZUVuZCwgZGVsaW0sIHRhYlN0cmlwLCBxdW90ZWREZWxpbTogc2F3UXVvdGUgfTtcbiAgICB9XG4gICAgaSArPSAxO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIFRoZSBib2R5IG9mIGFuIG9wZW5lciBydW5zIGZyb20gYWZ0ZXIgdGhlIG9wZW5lciBsaW5lJ3MgbmV3bGluZSB0byB0aGUgbGluZVxuICogdGhhdCBpcyBleGFjdGx5IHRoZSBkZWxpbWl0ZXIgKGA8PGApLCBvciBpdHMgbGVhZGluZy10YWItc3RyaXBwZWQgZm9ybVxuICogKGA8PC1gKSwgdHJhaWxpbmcgd2hpdGVzcGFjZSBhbGxvd2VkLiBSZXR1cm5zIHRoZSBjbG9zZXIncyBsaW5lIGJvdW5kcywgb3JcbiAqIG51bGwgd2hlbiBubyBjbG9zZXIgZXhpc3RzIChmYWlsIGNsb3NlZCkuXG4gKi9cbmZ1bmN0aW9uIGhlcmVkb2NDbG9zZXIocmF3OiBzdHJpbmcsIG9wZW46IEhlcmVkb2NPcGVuZXIpOiB7IGxpbmVTdGFydDogbnVtYmVyOyBsaW5lRW5kOiBudW1iZXIgfSB8IG51bGwge1xuICBjb25zdCBuID0gcmF3Lmxlbmd0aDtcbiAgY29uc3QgYm9keVN0YXJ0ID0gb3Blbi5vcGVuZXJMaW5lRW5kIDwgbiA/IG9wZW4ub3BlbmVyTGluZUVuZCArIDEgOiBuO1xuICBsZXQgbGluZVBvcyA9IGJvZHlTdGFydDtcbiAgd2hpbGUgKGxpbmVQb3MgPCBuKSB7XG4gICAgY29uc3QgbmwgPSByYXcuaW5kZXhPZignXFxuJywgbGluZVBvcyk7XG4gICAgY29uc3QgbGluZUVuZCA9IG5sID09PSAtMSA/IG4gOiBubDtcbiAgICBjb25zdCBjYW5kaWRhdGUgPSBvcGVuLnRhYlN0cmlwID8gcmF3LnNsaWNlKGxpbmVQb3MsIGxpbmVFbmQpLnJlcGxhY2UoL15cXHQrLywgJycpIDogcmF3LnNsaWNlKGxpbmVQb3MsIGxpbmVFbmQpO1xuICAgIGlmIChcbiAgICAgIGNhbmRpZGF0ZSA9PT0gb3Blbi5kZWxpbSB8fFxuICAgICAgKGNhbmRpZGF0ZS5zdGFydHNXaXRoKG9wZW4uZGVsaW0pICYmIC9eWyBcXHRdKiQvLnRlc3QoY2FuZGlkYXRlLnNsaWNlKG9wZW4uZGVsaW0ubGVuZ3RoKSkpXG4gICAgKSB7XG4gICAgICByZXR1cm4geyBsaW5lU3RhcnQ6IGxpbmVQb3MsIGxpbmVFbmQgfTtcbiAgICB9XG4gICAgaWYgKG5sID09PSAtMSkgcmV0dXJuIG51bGw7XG4gICAgbGluZVBvcyA9IG5sICsgMTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBNYXNrIGV2ZXJ5IGhlcmVkb2Mgb3V0IG9mIHRoZSByYXcgY29tbWFuZCBzdHJpbmcsIHJldHVybmluZyB0aGUgYm9kaWVzIGFuZFxuICogb3BlbmVycyBmb3IgcmUtYXNzb2NpYXRpb24gYnkgaW5kZXguIFRoZSBtYXNrIGNvdmVyc1xuICogYFtjbWRTdGFydCwgY2xvc2VyTGluZUVuZClgIFx1MjAxNCB0aGUgb3BlbmVyIGxpbmUgdGhyb3VnaCB0aGUgY2xvc2VyIGxpbmUsIHRoZVxuICogY2xvc2VyJ3MgbmV3bGluZSBleGNsdWRlZCBcdTIwMTQgc28gYSBjb21tYW5kIGpvaW5lZCBiZWZvcmUgdGhlIG9wZW5lclxuICogKGBjbWQxICYmIGNhdCA8PEVPRmApIGtlZXBzIGl0cyBzdHJ1Y3R1cmUsIGFuZCB0aGUgcGxhY2Vob2xkZXIgc3RhbmRzIGFsb25lXG4gKiBhcyBpdHMgb3duIHNpbXBsZSBjb21tYW5kLiBBIGhlcmVkb2Mgd2l0aG91dCBhIGNsb3NlciBmYWlscyBjbG9zZWQ6IGl0c1xuICogb3BlbmVyIGxpbmUgc3RheXMgdW5tYXNrZWQgYW5kIHNjYW5uaW5nIHJlc3VtZXMgYWZ0ZXIgaXQuXG4gKi9cbmZ1bmN0aW9uIGV4dHJhY3RIZXJlZG9jV3JpdGVzKHJhdzogc3RyaW5nKTogeyB3cml0ZXM6IEhlcmVkb2NXcml0ZVtdOyBtYXNrZWQ6IHN0cmluZyB9IHtcbiAgY29uc3Qgd3JpdGVzOiBIZXJlZG9jV3JpdGVbXSA9IFtdO1xuICBsZXQgbWFza2VkID0gJyc7XG4gIGxldCBjdXJzb3IgPSAwO1xuICBmb3IgKDs7KSB7XG4gICAgY29uc3Qgb3BlbiA9IGZpbmRIZXJlZG9jT3BlbmVyKHJhdywgY3Vyc29yKTtcbiAgICBpZiAob3BlbiA9PT0gbnVsbCkgYnJlYWs7XG4gICAgY29uc3QgY2xvc2UgPSBoZXJlZG9jQ2xvc2VyKHJhdywgb3Blbik7XG4gICAgaWYgKGNsb3NlID09PSBudWxsKSB7XG4gICAgICBjdXJzb3IgPSBvcGVuLm9wZW5lckxpbmVFbmQgPCByYXcubGVuZ3RoID8gb3Blbi5vcGVuZXJMaW5lRW5kICsgMSA6IHJhdy5sZW5ndGg7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgYm9keVN0YXJ0ID0gb3Blbi5vcGVuZXJMaW5lRW5kIDwgcmF3Lmxlbmd0aCA/IG9wZW4ub3BlbmVyTGluZUVuZCArIDEgOiByYXcubGVuZ3RoO1xuICAgIGxldCBib2R5ID0gcmF3LnNsaWNlKGJvZHlTdGFydCwgY2xvc2UubGluZVN0YXJ0KS5yZXBsYWNlKC9cXG4kLywgJycpO1xuICAgIGlmIChvcGVuLnRhYlN0cmlwKSBib2R5ID0gYm9keS5yZXBsYWNlKC9eXFx0Ky9nbSwgJycpO1xuICAgIG1hc2tlZCArPSByYXcuc2xpY2UoY3Vyc29yLCBvcGVuLmNtZFN0YXJ0KTtcbiAgICBtYXNrZWQgKz0gYF9faGVyZWRvY18ke3dyaXRlcy5sZW5ndGh9X19gO1xuICAgIHdyaXRlcy5wdXNoKHsgb3BlbmVyOiByYXcuc2xpY2Uob3Blbi5jbWRTdGFydCwgb3Blbi5vcGVuZXJMaW5lRW5kKSwgYm9keSwgcXVvdGVkRGVsaW06IG9wZW4ucXVvdGVkRGVsaW0gfSk7XG4gICAgY3Vyc29yID0gY2xvc2UubGluZUVuZDtcbiAgfVxuICBtYXNrZWQgKz0gcmF3LnNsaWNlKGN1cnNvcik7XG4gIHJldHVybiB7IHdyaXRlcywgbWFza2VkIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUmVkaXJlY3QtdG9rZW4gYW5hbHlzaXMgYW5kIHRoZSB3cml0ZS10b3VjaCBncmFtbWFycyAocGxhbiBcdTAwQTc1LjEsIFx1MDBBNzUuMikuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuaW50ZXJmYWNlIFJlZGlyZWN0SW5mbyB7XG4gIC8qKiBJT19OVU1CRVIgZmQgKGAxPmAvYDI+YCksIG9yIG51bGwgd2hlbiBpbXBsaWNpdC4gKi9cbiAgZmQ6IG51bWJlciB8IG51bGw7XG4gIC8qKiBUaGUgb3BlcmF0b3IuICovXG4gIG9wOiAnPicgfCAnPj4nIHwgJyY+JyB8ICcmPj4nIHwgJz4mJyB8ICc8JyB8ICc8PCcgfCAnPDwtJyB8ICc8PDwnO1xuICAvKiogQXR0YWNoZWQgdGFyZ2V0IHRleHQsIG9yIG51bGwgZm9yIGEgc3RhbmRhbG9uZSBvcGVyYXRvciAodGFyZ2V0ID0gbmV4dCB0b2tlbikuICovXG4gIHRhcmdldDogc3RyaW5nIHwgbnVsbDtcbn1cblxuY29uc3QgUkVESVJFQ1RfVE9LRU4gPSAvXihcXGQqKSg8PDx8PDwtfCY+Pnw8PHw+PnwmPnw+Jnw8fD4pKC4qKSQvO1xuXG5mdW5jdGlvbiBjbGFzc2lmeVJlZGlyZWN0VG9rZW4odGV4dDogc3RyaW5nKTogUmVkaXJlY3RJbmZvIHwgbnVsbCB7XG4gIGNvbnN0IG0gPSB0ZXh0Lm1hdGNoKFJFRElSRUNUX1RPS0VOKTtcbiAgaWYgKG0gPT09IG51bGwpIHJldHVybiBudWxsO1xuICBjb25zdCBbLCBmZFRleHQsIG9wLCB0YXJnZXRdID0gbTtcbiAgcmV0dXJuIHtcbiAgICBmZDogZmRUZXh0ID09PSAnJyA/IG51bGwgOiBOdW1iZXIucGFyc2VJbnQoZmRUZXh0LCAxMCksXG4gICAgb3A6IG9wIGFzIFJlZGlyZWN0SW5mb1snb3AnXSxcbiAgICB0YXJnZXQ6IHRhcmdldCA9PT0gJycgPyBudWxsIDogdGFyZ2V0XG4gIH07XG59XG5cbi8qKlxuICogQSBjb250ZW50LXByb2R1Y2luZyByZWRpcmVjdCAocGxhbiBcdTAwQTc1LjEpOiBmZC0xIGA+YC9gPj5gIChleHBsaWNpdCBgMT5gL2AxPj5gXG4gKiBpbmNsdWRlZCkgYW5kIGAmPmAvYCY+PmAuIEZELW51bWJlcmVkIChgMj5gKSwgZHVwIChgMj4mMWAsIGA+JmZgKSxcbiAqIGAmYC1sZWFkaW5nLXRhcmdldCBkdXAgKGA+JmApIGFuZCBzdGRpbiAoYDxgKSBmb3JtcyBuZXZlciBwcm9kdWNlIGNvbnRlbnQuXG4gKi9cbmZ1bmN0aW9uIGlzQ29udGVudFJlZGlyZWN0KHI6IFJlZGlyZWN0SW5mbyk6IGJvb2xlYW4ge1xuICBpZiAoci5vcCA9PT0gJz4nIHx8IHIub3AgPT09ICc+PicpIHtcbiAgICBpZiAoci5mZCAhPT0gbnVsbCAmJiByLmZkICE9PSAxKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKHIudGFyZ2V0Py5zdGFydHNXaXRoKCcmJykpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gci5vcCA9PT0gJyY+JyB8fCByLm9wID09PSAnJj4+Jztcbn1cblxuLyoqIFRoZSBhcmd2IHN0cmVhbSBhbmQgcmVkaXJlY3QgbGlzdCBvZiBhIHNpbXBsZSBjb21tYW5kIChwbGFuIFx1MDBBNzUuMTApOiB3b3JkcyBtaW51cyByZWRpcmVjdCB0b2tlbnMgYW5kIHRoZWlyIHRhcmdldHMuICovXG5mdW5jdGlvbiBhbmFseXplVG9rZW5zKHRva2VuczogVG9rZW5bXSk6IHsgYXJndjogc3RyaW5nW107IHJlZGlyZWN0czogUmVkaXJlY3RJbmZvW10gfSB7XG4gIGNvbnN0IGFyZ3Y6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IHJlZGlyZWN0czogUmVkaXJlY3RJbmZvW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCB0b2tlbnMubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCB0b2tlbiA9IHRva2Vuc1tpXTtcbiAgICBpZiAoIXRva2VuLmlzUmVkaXJlY3QpIHtcbiAgICAgIGFyZ3YucHVzaCh0b2tlbi50ZXh0KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBpbmZvID0gY2xhc3NpZnlSZWRpcmVjdFRva2VuKHRva2VuLnRleHQpO1xuICAgIGlmIChpbmZvID09PSBudWxsKSB7XG4gICAgICBhcmd2LnB1c2godG9rZW4udGV4dCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGluZm8udGFyZ2V0ID09PSBudWxsKSB7XG4gICAgICAvLyBBIHN0YW5kYWxvbmUgb3BlcmF0b3IgY29uc3VtZXMgdGhlIG5leHQgdG9rZW4gYXMgaXRzIHRhcmdldCAob3JcbiAgICAgIC8vIGhlcmVkb2MgZGVsaW1pdGVyIC8gaGVyZS1zdHJpbmcgY29udGVudCkgXHUyMDE0IGF0dGFjaGVkIHRvIHRoZSByZWRpcmVjdFxuICAgICAgLy8gc28gdGhlIHdyaXRlIGdyYW1tYXJzIHNlZSBpdCwgYW5kIGV4Y2x1ZGVkIGZyb20gYXJndi5cbiAgICAgIGNvbnN0IG5leHQgPSB0b2tlbnNbaSArIDFdO1xuICAgICAgaWYgKG5leHQgIT09IHVuZGVmaW5lZCAmJiAhbmV4dC5pc1JlZGlyZWN0KSB7XG4gICAgICAgIHJlZGlyZWN0cy5wdXNoKHsgLi4uaW5mbywgdGFyZ2V0OiBuZXh0LnRleHQgfSk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuICAgIHJlZGlyZWN0cy5wdXNoKGluZm8pO1xuICB9XG4gIHJldHVybiB7IGFyZ3YsIHJlZGlyZWN0cyB9O1xufVxuXG4vKipcbiAqIExpdGVyYWwgYGVjaG9gL2BwcmludGZgIGNvbnRlbnQgKHBsYW4gXHUwMEE3NS4xKSBmb3IgYm9keSB0aHJlYWRpbmc6IG5vXG4gKiBmbGFncywgbm8gc2hlbGwgZXhwYW5zaW9uLCBubyBnbG9iczsgYHByaW50ZmAgb25seSB3aGVuIHRoZSBmb3JtYXQgaGFzIG5vXG4gKiBgJWAvYmFja3NsYXNoIGRpcmVjdGl2ZXMgKHRoZW4gdGhlIGZvcm1hdCBpdHNlbGYgaXMgdGhlIGxpdGVyYWwgY29udGVudCkuXG4gKiBUaHJlYWRlZCBvbiBhcHBlbmRzIGFzIHRoZSBzdWZmaXggZ2F0ZSdzIGJvZHkgYW5kIG9uIHNpbmdsZSBwbGFpbiBgPmBcbiAqIG92ZXJ3cml0ZXMgKGFuZCB0ZWUgb3BlcmFuZHMgd2l0aCBhIG9uZS1ob3AgbGl0ZXJhbCBwaXBlIHNvdXJjZSkgYXMgdGhlXG4gKiBleGFjdCBnYXRlJ3MgcG9zdC1jb250ZW50LlxuICovXG5mdW5jdGlvbiBsaXRlcmFsQ29udGVudChhcmd2OiBzdHJpbmdbXSk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IGhvc3QgPSBhcmd2WzBdO1xuICBpZiAoaG9zdCAhPT0gJ2VjaG8nICYmIGhvc3QgIT09ICdwcmludGYnKSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCBhcmdzID0gYXJndi5zbGljZSgxKTtcbiAgaWYgKGFyZ3MubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xuICBmb3IgKGNvbnN0IGEgb2YgYXJncykge1xuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSB8fCBoYXNTaGVsbEV4cGFuc2lvbihhKSB8fCAvWyo/XS8udGVzdChhKSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBpZiAoaG9zdCA9PT0gJ3ByaW50ZicpIHtcbiAgICBpZiAoYXJncy5sZW5ndGggIT09IDEpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgY29uc3QgZm10ID0gYXJnc1swXTtcbiAgICBpZiAoZm10LmluY2x1ZGVzKCclJykgfHwgZm10LmluY2x1ZGVzKCdcXFxcJykpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgcmV0dXJuIGZtdDtcbiAgfVxuICByZXR1cm4gYCR7YXJncy5qb2luKCcgJyl9XFxuYDtcbn1cblxuLyoqXG4gKiBSZXNvbHZlIGEgcmVkaXJlY3QgdGFyZ2V0IGFnYWluc3QgdGhlIGN1cnJlbnQgZGlyZWN0b3J5LCBlbWl0dGluZyB0aGVcbiAqIHVucmVzb2x2ZWQgdmVyZGljdCAodGhlIHJlYWQgaWRpb21zJyByZWFzb24pIHdoZW4gdGhlIHBhdGggY2FycmllcyBhblxuICogdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iLiBSZXR1cm5zIHRoZSBhYnNvbHV0ZSBwYXRoLCBvciBudWxsLlxuICovXG5mdW5jdGlvbiByZXNvbHZlVGFyZ2V0KHJlc3VsdHM6IFNwYW5NYXRjaFtdLCBpZGlvbTogSWRpb20sIHRhcmdldDogc3RyaW5nLCBjdXJyZW50RGlyOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKHRhcmdldCkpIHtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICBpZGlvbSxcbiAgICAgIGZpbGVBcmc6IHRhcmdldCxcbiAgICAgIHJlYXNvbjogJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJ1xuICAgIH0pO1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIHJldHVybiByZXNvbHZlUGF0aChjdXJyZW50RGlyLCB0YXJnZXQpO1xufVxuXG4vKiogVGhlIGB0ZWVgIG9wZXJhbmQgZ3JhbW1hcjogYXBwZW5kIG1vZGUgYW5kIG9wZXJhbmQgbGlzdDsgdW5rbm93biBvcHRpb25zIHJldHVybiBudWxsIChmYWlsIGNsb3NlZCkuICovXG5mdW5jdGlvbiB0ZWVPcGVyYW5kUGFydHMoYXJndjogc3RyaW5nW10pOiB7IGFwcGVuZDogYm9vbGVhbjsgb3BlcmFuZHM6IHN0cmluZ1tdIH0gfCBudWxsIHtcbiAgbGV0IGFwcGVuZCA9IGZhbHNlO1xuICBsZXQgYWZ0ZXJEYXNoRGFzaCA9IGZhbHNlO1xuICBjb25zdCBvcGVyYW5kczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBhIG9mIGFyZ3Yuc2xpY2UoMSkpIHtcbiAgICBpZiAoYWZ0ZXJEYXNoRGFzaCkge1xuICAgICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctYScgfHwgYSA9PT0gJy0tYXBwZW5kJykge1xuICAgICAgYXBwZW5kID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIHJldHVybiBudWxsO1xuICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gIH1cbiAgcmV0dXJuIHsgYXBwZW5kLCBvcGVyYW5kcyB9O1xufVxuXG4vKipcbiAqIFRoZSBgdGVlYCBvcGVyYW5kIHdyaXRlcyAocGxhbiBcdTAwQTc1LjEpOiBlYWNoIG9wZXJhbmQgaXMgYSB3aG9sZS1maWxlXG4gKiBjcmVhdGUtb3ZlcndyaXRlICh0cnVuY2F0aW5nKSwgb3IgYSB3aG9sZS1maWxlIGFwcGVuZCB1bmRlciBgLWFgL2AtLWFwcGVuZGAuXG4gKiBBIG9uZS1ob3AgbGl0ZXJhbCBlY2hvL3ByaW50ZiBwaXBlIHNvdXJjZSAoYGVjaG8geCB8IHRlZSBmYCwgYHByaW50ZiB5IHxcbiAqIHRlZSAtYSBmYCwgcGxhbiBcdTAwQTc1LjIpIHRocmVhZHMgYXMgdGhlIHdyaXR0ZW4gYm9keSBcdTIwMTQgdGhlIGV4YWN0IGdhdGUnc1xuICogcG9zdC1jb250ZW50IG9uIHRoZSB0cnVuY2F0aW5nIHdyaXRlLCB0aGUgc3VmZml4IGdhdGUncyBib2R5IG9uIHRoZSBhcHBlbmQ7XG4gKiB3aXRob3V0IGEga25vd24gc291cmNlIG5laXRoZXIgb3AgY2FycmllcyB3cml0dGVuIGNvbnRlbnQuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoVGVlT3BlcmFuZHMoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBwaXBlRWNob0NvbnRlbnQ6IHN0cmluZyB8IG51bGwsXG4gIGN1cnJlbnREaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHBhcnRzID0gdGVlT3BlcmFuZFBhcnRzKGFyZ3YpO1xuICBpZiAocGFydHMgPT09IG51bGwpIHJldHVybjtcbiAgZm9yIChjb25zdCBvcGVyYW5kIG9mIHBhcnRzLm9wZXJhbmRzKSB7XG4gICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVRhcmdldChyZXN1bHRzLCAncmVkaXJlY3Qtd3JpdGUnLCBvcGVyYW5kLCBjdXJyZW50RGlyKTtcbiAgICBpZiAoYWJzb2x1dGVQYXRoID09PSBudWxsKSBjb250aW51ZTtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206ICdyZWRpcmVjdC13cml0ZScsXG4gICAgICBzcGFuOiAhcGFydHMuYXBwZW5kXG4gICAgICAgID8ge1xuICAgICAgICAgICAgb3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZScsXG4gICAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgICBqb2luLFxuICAgICAgICAgICAgLi4uKHBpcGVFY2hvQ29udGVudCAhPT0gbnVsbCA/IHsgd3JpdHRlbjogcGlwZUVjaG9Db250ZW50IH0gOiB7fSlcbiAgICAgICAgICB9XG4gICAgICAgIDoge1xuICAgICAgICAgICAgb3BlcmF0aW9uOiAnYXBwZW5kJyxcbiAgICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgICAuLi4ocGlwZUVjaG9Db250ZW50ICE9PSBudWxsID8geyB3cml0dGVuOiBwaXBlRWNob0NvbnRlbnQgfSA6IHt9KVxuICAgICAgICAgIH1cbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSByZWRpcmVjdCBmYW1pbHkgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjEpLCBydW4gZm9yIGV2ZXJ5IHNpbXBsZSBjb21tYW5kIGFmdGVyXG4gKiB0aGUgcmVhZCBtYXRjaGVyczogY29udGVudC1wcm9kdWNpbmcgcmVkaXJlY3RzIG9uIGBlY2hvYC9gcHJpbnRmYC9gdGVlYFxuICogd3JpdGUgd2hvbGUtZmlsZTsgYSBiYXJlIGA+IGZgIC8gYDogPiBmYCB0cnVuY2F0ZXMgKHRoZSBtYWluIHdhbGsgaGFuZHNcbiAqIGFyZ3YtZW1wdHkgY29tbWFuZHMgZGlyZWN0bHkgaGVyZSk7IGA+PmAtb25seSB0cnVuY2F0aW9uIGZvcm1zIGFwcGVuZFxuICogbm90aGluZyBhbmQgdG91Y2ggbm90aGluZy4gQW55IG90aGVyIGhvc3Qgd2l0aCBhIGNvbnRlbnQgcmVkaXJlY3QgKGBscyA+IGZgLFxuICogYHB5dGhvbjMgeC5weSA+IG91dGAsIGBjYXQgZiA+IGdgKSBnZXRzIG5vIHdyaXRlIHRvdWNoIFx1MjAxNCB0aGUgcmVkaXJlY3QgaXNcbiAqIHJlYWwsIGJ1dCBpdHMgY29udGVudCBpcyBkeW5hbWljIGFuZCBvdXQgb2Ygc2NvcGUuXG4gKlxuICogQm9keSB0aHJlYWRpbmc6IGV4YWN0bHkgb25lIHBsYWluIGA+PmAgKG9yIGAxPj5gKSBjb250ZW50IHJlZGlyZWN0IG9uIGFcbiAqIGZ1bGx5IGxpdGVyYWwgYGVjaG9gL2BwcmludGZgIHRocmVhZHMgdGhlIHdyaXR0ZW4gYm9keSAodGhlIHN1ZmZpeCBnYXRlKSxcbiAqIGFuZCBleGFjdGx5IG9uZSBwbGFpbiBgPmAgKG9yIGAxPmApIGNvbnRlbnQgcmVkaXJlY3Qgb24gdGhlIHNhbWUgbGl0ZXJhbHNcbiAqIHRocmVhZHMgaXQgYXMgdGhlIGV4YWN0IGdhdGUncyBwb3N0LWNvbnRlbnQgKHBsYW4gXHUwMEE3MyBzdGVwIDFiIFx1MjAxNCB0aGVcbiAqIGNvbnRlbnQgbGF5ZXIgaXMgd2hhdCBzdXBwcmVzc2VzIGBlY2hvIGhpID4gcmVhZC1vbmx5LWZpbGVgLCB3aGVyZSB0aGVcbiAqIGZpbGUgc3RheXMgcHJlc2VudCBidXQgdW5jaGFuZ2VkKS4gYCY+YC9gJj4+YCwgbXVsdGktcmVkaXJlY3QgY29tbWFuZHMsXG4gKiBhbmQgYHRlZWAncyBvd24gcmVkaXJlY3RzIG5ldmVyIHRocmVhZC5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hSZWRpcmVjdEZhbWlseShcbiAgYXJndjogc3RyaW5nW10sXG4gIHJlZGlyZWN0czogUmVkaXJlY3RJbmZvW10sXG4gIHBpcGVFY2hvQ29udGVudDogc3RyaW5nIHwgbnVsbCxcbiAgY3VycmVudERpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgY29udGVudFJlZGlyZWN0cyA9IHJlZGlyZWN0cy5maWx0ZXIoaXNDb250ZW50UmVkaXJlY3QpO1xuICBjb25zdCBob3N0ID0gYXJndlswXTtcbiAgaWYgKGNvbnRlbnRSZWRpcmVjdHMubGVuZ3RoID09PSAwKSB7XG4gICAgaWYgKGhvc3QgPT09ICd0ZWUnKSBtYXRjaFRlZU9wZXJhbmRzKGFyZ3YsIHBpcGVFY2hvQ29udGVudCwgY3VycmVudERpciwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luLCByZXN1bHRzKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGhvc3QgPT09IHVuZGVmaW5lZCB8fCBob3N0ID09PSAnOicgfHwgaG9zdCA9PT0gJ2V4ZWMnKSB7XG4gICAgLy8gQmFyZSBgPiBmYCwgYDogPiBmYCBhbmQgYGV4ZWMgPiBmYCB0cnVuY2F0ZSAoZXhlYyBhcHBsaWVzIHRoZSByZWRpcmVjdFxuICAgIC8vIHRvIHRoZSBzaGVsbCdzIG93biBmZCAxIGltbWVkaWF0ZWx5IFx1MjAxNCB0aGUgZmQtMSB0YXJnZXQgaXMgc3RhdGljLCBzbyB0aGVcbiAgICAvLyB0cnVuY2F0aW9uIGhhcHBlbnMgZXZlbiB0aG91Z2ggdGhlIGNvbW1hbmQgbmV2ZXIgd3JpdGVzKTtcbiAgICAvLyBgPj5gL2AmPj5gIGFwcGVuZCBub3RoaW5nIFx1MjE5MiBubyB0b3VjaC5cbiAgICBmb3IgKGNvbnN0IHIgb2YgY29udGVudFJlZGlyZWN0cykge1xuICAgICAgaWYgKHIub3AgPT09ICc+PicgfHwgci5vcCA9PT0gJyY+PicgfHwgci50YXJnZXQgPT09IG51bGwpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVRhcmdldChyZXN1bHRzLCAndHJ1bmNhdGUtd3JpdGUnLCByLnRhcmdldCwgY3VycmVudERpcik7XG4gICAgICBpZiAoYWJzb2x1dGVQYXRoID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgaWRpb206ICd0cnVuY2F0ZS13cml0ZScsXG4gICAgICAgIHNwYW46IHsgb3BlcmF0aW9uOiAndHJ1bmNhdGUnLCBhYnNvbHV0ZVBhdGgsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChob3N0ICE9PSAnZWNobycgJiYgaG9zdCAhPT0gJ3ByaW50ZicgJiYgaG9zdCAhPT0gJ3RlZScpIHJldHVybjtcbiAgY29uc3Qgc2luZ2xlUGxhaW5BcHBlbmQgPSBjb250ZW50UmVkaXJlY3RzLmxlbmd0aCA9PT0gMSAmJiBjb250ZW50UmVkaXJlY3RzWzBdLm9wID09PSAnPj4nO1xuICBjb25zdCBzaW5nbGVQbGFpbk92ZXJ3cml0ZSA9IGNvbnRlbnRSZWRpcmVjdHMubGVuZ3RoID09PSAxICYmIGNvbnRlbnRSZWRpcmVjdHNbMF0ub3AgPT09ICc+JztcbiAgY29uc3QgdGhyZWFkZWRBcHBlbmQgPSBzaW5nbGVQbGFpbkFwcGVuZCAmJiBob3N0ICE9PSAndGVlJyA/IGxpdGVyYWxDb250ZW50KGFyZ3YpIDogdW5kZWZpbmVkO1xuICBjb25zdCB0aHJlYWRlZE92ZXJ3cml0ZSA9IHNpbmdsZVBsYWluT3ZlcndyaXRlICYmIGhvc3QgIT09ICd0ZWUnID8gbGl0ZXJhbENvbnRlbnQoYXJndikgOiB1bmRlZmluZWQ7XG4gIGZvciAoY29uc3QgciBvZiBjb250ZW50UmVkaXJlY3RzKSB7XG4gICAgaWYgKHIudGFyZ2V0ID09PSBudWxsKSBjb250aW51ZTtcbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlVGFyZ2V0KHJlc3VsdHMsICdyZWRpcmVjdC13cml0ZScsIHIudGFyZ2V0LCBjdXJyZW50RGlyKTtcbiAgICBpZiAoYWJzb2x1dGVQYXRoID09PSBudWxsKSBjb250aW51ZTtcbiAgICBpZiAoci5vcCA9PT0gJz4+JyB8fCByLm9wID09PSAnJj4+Jykge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogJ3JlZGlyZWN0LXdyaXRlJyxcbiAgICAgICAgc3Bhbjoge1xuICAgICAgICAgIG9wZXJhdGlvbjogJ2FwcGVuZCcsXG4gICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICBqb2luLFxuICAgICAgICAgIC4uLih0aHJlYWRlZEFwcGVuZCAhPT0gdW5kZWZpbmVkID8geyB3cml0dGVuOiB0aHJlYWRlZEFwcGVuZCB9IDoge30pXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiAncmVkaXJlY3Qtd3JpdGUnLFxuICAgICAgICBzcGFuOiB7XG4gICAgICAgICAgb3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZScsXG4gICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICBqb2luLFxuICAgICAgICAgIC4uLih0aHJlYWRlZE92ZXJ3cml0ZSAhPT0gdW5kZWZpbmVkID8geyB3cml0dGVuOiB0aHJlYWRlZE92ZXJ3cml0ZSB9IDoge30pXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuICBpZiAoaG9zdCA9PT0gJ3RlZScpIG1hdGNoVGVlT3BlcmFuZHMoYXJndiwgcGlwZUVjaG9Db250ZW50LCBjdXJyZW50RGlyLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRoZSBmaWxlLW11dGF0aW9uIGZhbWlseSBncmFtbWFycyAocGxhbiBcdTAwQTc1LjNcdTIwMTNcdTAwQTc1LjcpOiBjcC9pbnN0YWxsL212L2dpdCBtdixcbi8vIHJtL2dpdCBybS90cnVuY2F0ZSwgc2VkIC1pIGluLXBsYWNlIGVkaXRzLCBhbmQgcGF0Y2gvZ2l0IGFwcGx5LiBUaGV5IHNoYXJlXG4vLyB0aGUgXHUwMEE3NSBmYWlsLWNsb3NlZCBydWxlczogbGVhZGluZyBlbnYgYXNzaWdubWVudHMgKHN0cmlwcGVkIGJ5IHRoZSB3YWxrKVxuLy8gYW5kIG9uZSBgY29tbWFuZGAvYGVudmAgd3JhcHBlciBhcmUgc2tpcHBlZCAobWVjaGFuaWNhbGx5IGNlcnRhaW4pOyBhbnlcbi8vIG90aGVyIHdyYXBwZXIgaXMgdW5yZXNvbHZlZDsgYSBsZWFkaW5nLWAtYCB0b2tlbiB0aGF0IGlzIG5vdCBhIGtub3duIG9wdGlvblxuLy8gaXMgdHJlYXRlZCBhcyBhbiBvcHRpb247IGAtLWAgbWFrZXMgdGhlIHJlc3Qgb3BlcmFuZHM7IGdsb2JiZWQgb3IgdmFyaWFibGVcbi8vIHBhdGhzIGFyZSB1bnJlc29sdmVkOyBkaXJlY3Rvcnktc2hhcGVkIHNvdXJjZSBvcGVyYW5kcyBmYWlsIGNsb3NlZC5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogV3JhcHBlciB3b3JkcyB0aGF0IG9ic2N1cmUgdGhlIHdyYXBwZWQgY29tbWFuZCdzIGFyZ3YgKHBsYW4gXHUwMEE3NSk6IGEgZmFtaWx5IGNvbW1hbmQgYmVoaW5kIG9uZSBpcyB1bnJlc29sdmVkLCBuZXZlciBndWVzc2VkLiAqL1xuY29uc3QgRk9SRUlHTl9XUkFQUEVSUyA9IG5ldyBTZXQoWydzdWRvJywgJ3hhcmdzJywgJ25vaHVwJywgJ3RpbWUnLCAnbmljZScsICdkb2FzJ10pO1xuXG4vKiogQSBsZWFkaW5nIGBOQU1FPXZhbHVlYCBhc3NpZ25tZW50IHRva2VuIChgZW52IEZPTz1iYXIgY3AgYSBiYCBrZWVwcyBvbmUgYWZ0ZXIgdGhlIHdyYXBwZXIgd29yZCkuICovXG5jb25zdCBBU1NJR05NRU5UX1RPS0VOID0gL15bQS1aYS16X11bQS1aYS16MC05X10qPS87XG5cbi8qKlxuICogU3RyaXAgYXQgbW9zdCBvbmUgYGNvbW1hbmRgL2BlbnZgIHdyYXBwZXIgXHUyMDE0IG1lY2hhbmljYWxseSB0cmFuc3BhcmVudCAocGxhblxuICogXHUwMEE3NSkgXHUyMDE0IGFuZCBhbnkgbGVhZGluZyBhc3NpZ25tZW50cyBhZnRlciBpdDogYGVudiBGT089YmFyIGNwIGEgYmAgc2V0cyBGT09cbiAqIHRoZW4gcnVucyBjcCwgZXhhY3RseSB0aGUgdHJhbnNwYXJlbnQtcHJlZml4IGNsYXNzIHRoZSB3YWxrIHN0cmlwcyBiZWZvcmVcbiAqIHRva2VuaXppbmcgKGBGT089YmFyIGVudiBjcCBhIGJgIGFycml2ZXMgaGVyZSB3aXRoIHRoZSBhc3NpZ25tZW50cyBhbHJlYWR5XG4gKiBnb25lKS5cbiAqL1xuZnVuY3Rpb24gc3RyaXBUcmFuc3BhcmVudFdyYXBwZXIoYXJndjogc3RyaW5nW10pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHVud3JhcHBlZCA9IGFyZ3ZbMF0gPT09ICdjb21tYW5kJyB8fCBhcmd2WzBdID09PSAnZW52JyA/IGFyZ3Yuc2xpY2UoMSkgOiBhcmd2O1xuICBsZXQgaSA9IDA7XG4gIHdoaWxlIChpIDwgdW53cmFwcGVkLmxlbmd0aCAmJiBBU1NJR05NRU5UX1RPS0VOLnRlc3QodW53cmFwcGVkW2ldKSkgaSArPSAxO1xuICByZXR1cm4gaSA+IDAgPyB1bndyYXBwZWQuc2xpY2UoaSkgOiB1bndyYXBwZWQ7XG59XG5cbmZ1bmN0aW9uIHB1c2hVbnJlc29sdmVkKHJlc3VsdHM6IFNwYW5NYXRjaFtdLCBpZGlvbTogSWRpb20sIGZpbGVBcmc6IHN0cmluZywgcmVhc29uOiBzdHJpbmcpOiB2b2lkIHtcbiAgcmVzdWx0cy5wdXNoKHsgc3RhdHVzOiAndW5yZXNvbHZlZCcsIGlkaW9tLCBmaWxlQXJnLCByZWFzb24gfSk7XG59XG5cbi8qKiBXaGV0aGVyIHRoZSBwYXRoIGlzIGFuIGV4aXN0aW5nIGRpcmVjdG9yeSAodGhlIGRlc3QtZGlyIGRlY2lzaW9uLCBwbGFuIFx1MDBBNzUuMy9cdTAwQTc1LjQ7IGZzIHN0YXQgbGlrZSB0aGUgcmVhZCBpZGlvbXMnIGxpbmUgY291bnRzKS4gKi9cbmZ1bmN0aW9uIGlzRXhpc3RpbmdEaXJlY3RvcnkoYWJzb2x1dGVQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gc3RhdFN5bmMoYWJzb2x1dGVQYXRoKS5pc0RpcmVjdG9yeSgpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgc2hhcmVkIGNwL2luc3RhbGwvbXYgb3BlcmFuZCBncmFtbWFyIChwbGFuIFx1MDBBNzUuMy9cdTAwQTc1LjQpOiBwZXItZmFtaWx5IG9wdGlvblxuICogc2V0cyBhbmQgdG91Y2ggb3BlcmF0aW9ucyBiZWhpbmQgb25lIHBhcnNlci5cbiAqL1xuaW50ZXJmYWNlIENvcHlNb3ZlU3BlYyB7XG4gIGlkaW9tOiAnY3Atd3JpdGUnIHwgJ2luc3RhbGwtd3JpdGUnIHwgJ212LXdyaXRlJztcbiAgLyoqIEtub3duIG5vLXZhbHVlIGZsYWdzIChjb25zdW1lZCwgbmV2ZXIgb3BlcmFuZHMpLiAqL1xuICBub1ZhbHVlOiBSZWFkb25seVNldDxzdHJpbmc+O1xuICAvKipcbiAgICogTm8tY2xvYmJlciBmbGFncyAoYGNwIC1uYC9gLS1uby1jbG9iYmVyYCk6IGNvbnN1bWVkIGxpa2Ugbm8tdmFsdWUgZmxhZ3MsXG4gICAqIGJ1dCB0aGUgd3JpdGUgc3RpbGwgcGFyc2VzIFx1MjAxNCB0aGUgc2tpcCBpcyBpbnZpc2libGUgdG8gdGhlIHBvc3QtY29tbWFuZFxuICAgKiBieXRlLWNvbXBhcmUgZ2F0ZSwgd2hpY2ggY2Fubm90IGRpc3Rpbmd1aXNoIGEgcmVhbCBjb3B5IGZyb20gYSBwcmUtZXhpc3RpbmdcbiAgICogZXF1YWwgZGVzdCAodGhlIGRvY3VtZW50ZWQgbm8tb3AgcmVzaWR1ZSwgcGlubmVkIGluXG4gICAqIGJhc2gtd3JpdGUtaW50ZWdyYXRpb24udGVzdC50cykuXG4gICAqL1xuICBub0Nsb2JiZXI6IFJlYWRvbmx5U2V0PHN0cmluZz47XG4gIC8qKiBLbm93biB2YWx1ZS10YWtpbmcgZmxhZ3MgKHRoZSBuZXh0IHdvcmQgaXMgdGhlIHZhbHVlIFx1MjAxNCBgLXQgRElSYCwgb3IgYW4gaW5zdGFsbCBtb2RlL293bmVyL2dyb3VwKS4gKi9cbiAgdmFsdWVUYWtpbmc6IFJlYWRvbmx5U2V0PHN0cmluZz47XG4gIC8qKiBGbGFncyB0aGF0IGZhaWwgdGhlIHdob2xlIGNvbW1hbmQgY2xvc2VkIChgY3AgLWJgL2AtLWJhY2t1cGAsIGBpbnN0YWxsIC1kYCwgZ2l0IG12IGRyeS1ydW4gYC1uYC9gLS1kcnktcnVuYCkuICovXG4gIGV4Y2x1ZGVkOiBSZWFkb25seVNldDxzdHJpbmc+O1xuICAvKiogVGhlIHBlci1zb3VyY2UgdG91Y2g6IGNwL2luc3RhbGwgcmVhZCB0aGVpciBzb3VyY2VzOyBtdiBkZWxldGVzIHRoZW0uICovXG4gIHNvdXJjZU9wZXJhdGlvbjogJ3JlYWQnIHwgJ2RlbGV0ZSc7XG4gIC8qKiBUaGUgcGVyLWRlc3QgdG91Y2g6IGNwL2luc3RhbGwgb3ZlcndyaXRlOyBtdiByZW5hbWUtY29waWVzLiAqL1xuICBkZXN0T3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZScgfCAncmVuYW1lLWNvcHknO1xufVxuXG5jb25zdCBDUF9TUEVDOiBDb3B5TW92ZVNwZWMgPSB7XG4gIGlkaW9tOiAnY3Atd3JpdGUnLFxuICBub1ZhbHVlOiBuZXcgU2V0KFsnLXInLCAnLVInLCAnLXAnLCAnLWYnLCAnLXYnLCAnLWknLCAnLXUnLCAnLWEnLCAnLWQnLCAnLUwnLCAnLVAnXSksXG4gIG5vQ2xvYmJlcjogbmV3IFNldChbJy1uJywgJy0tbm8tY2xvYmJlciddKSxcbiAgdmFsdWVUYWtpbmc6IG5ldyBTZXQoWyctdCcsICctLXRhcmdldC1kaXJlY3RvcnknXSksXG4gIGV4Y2x1ZGVkOiBuZXcgU2V0KFsnLWInLCAnLS1iYWNrdXAnXSksXG4gIHNvdXJjZU9wZXJhdGlvbjogJ3JlYWQnLFxuICBkZXN0T3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZSdcbn07XG5cbmNvbnN0IElOU1RBTExfU1BFQzogQ29weU1vdmVTcGVjID0ge1xuICBpZGlvbTogJ2luc3RhbGwtd3JpdGUnLFxuICBub1ZhbHVlOiBuZXcgU2V0KFsnLUQnLCAnLXMnLCAnLXYnXSksXG4gIG5vQ2xvYmJlcjogbmV3IFNldCgpLFxuICB2YWx1ZVRha2luZzogbmV3IFNldChbJy10JywgJy0tdGFyZ2V0LWRpcmVjdG9yeScsICctbScsICctbycsICctZyddKSxcbiAgZXhjbHVkZWQ6IG5ldyBTZXQoWyctZCddKSxcbiAgc291cmNlT3BlcmF0aW9uOiAncmVhZCcsXG4gIGRlc3RPcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJ1xufTtcblxuY29uc3QgTVZfU1BFQzogQ29weU1vdmVTcGVjID0ge1xuICBpZGlvbTogJ212LXdyaXRlJyxcbiAgLy8gYG12IC1uYCBzdGF5cyBpbiBub1ZhbHVlLCBub3Qgbm9DbG9iYmVyOiBhbiBtdiBza2lwIGxlYXZlcyB0aGUgc291cmNlIGluXG4gIC8vIHBsYWNlLCBhbmQgdGhlIGRlbGV0ZSdzIG93biBhYnNlbmNlIGdhdGUgdGhlbiBmYWlscyB0aGUgdG91Y2ggXHUyMDE0IHRoZVxuICAvLyBuby1jbG9iYmVyIGJsaW5kIHNwb3QgaXMgY3AncyBieXRlLWNvbXBhcmUsIG5vdCBtdidzLlxuICBub1ZhbHVlOiBuZXcgU2V0KFsnLWYnLCAnLWknLCAnLW4nLCAnLXYnLCAnLXUnXSksXG4gIG5vQ2xvYmJlcjogbmV3IFNldCgpLFxuICB2YWx1ZVRha2luZzogbmV3IFNldChbJy10JywgJy0tdGFyZ2V0LWRpcmVjdG9yeSddKSxcbiAgZXhjbHVkZWQ6IG5ldyBTZXQoKSxcbiAgc291cmNlT3BlcmF0aW9uOiAnZGVsZXRlJyxcbiAgZGVzdE9wZXJhdGlvbjogJ3JlbmFtZS1jb3B5J1xufTtcblxuY29uc3QgR0lUX01WX1NQRUM6IENvcHlNb3ZlU3BlYyA9IHtcbiAgaWRpb206ICdtdi13cml0ZScsXG4gIG5vVmFsdWU6IG5ldyBTZXQoWyctZicsICctaycsICctdiddKSxcbiAgbm9DbG9iYmVyOiBuZXcgU2V0KCksXG4gIHZhbHVlVGFraW5nOiBuZXcgU2V0KCksXG4gIC8vIGBnaXQgbXYgLW5gL2AtLWRyeS1ydW5gIGlzIGEgdHJpYWwgcnVuIHRoYXQgbW92ZXMgbm90aGluZyAodGhlIHNhbWVcbiAgLy8gcmVhZC1vbmx5IGNsYXNzIGFzIGBwYXRjaCAtLWRyeS1ydW5gLCBwbGFuIFx1MDBBNzUuNykgXHUyMDE0IGZhaWwgY2xvc2VkLlxuICBleGNsdWRlZDogbmV3IFNldChbJy1uJywgJy0tZHJ5LXJ1biddKSxcbiAgc291cmNlT3BlcmF0aW9uOiAnZGVsZXRlJyxcbiAgZGVzdE9wZXJhdGlvbjogJ3JlbmFtZS1jb3B5J1xufTtcblxuaW50ZXJmYWNlIENvcHlNb3ZlUGFydHMge1xuICAvKiogT3BlcmFuZHMgaW4gb3JkZXIgKHNvdXJjZXM7IGluIHRoZSBub24tYC10YCBmb3JtIHRoZSBsYXN0IGlzIHRoZSBkZXN0KS4gKi9cbiAgb3BlcmFuZHM6IHN0cmluZ1tdO1xuICAvKiogVGhlIGAtdGAvYC0tdGFyZ2V0LWRpcmVjdG9yeWAgdmFsdWUsIG9yIG51bGwuICovXG4gIHRhcmdldERpcjogc3RyaW5nIHwgbnVsbDtcbn1cblxuLyoqXG4gKiBQYXJzZSB0aGUgb3BlcmFuZHMgb2YgYSBjcC9pbnN0YWxsL212IGNvbW1hbmQ6IGtub3duIG9wdGlvbnMgYXJlIGNvbnN1bWVkLFxuICogYC0tYCBtYWtlcyB0aGUgcmVzdCBvcGVyYW5kcywgYW5kIGAtdGAvYC0tdGFyZ2V0LWRpcmVjdG9yeVs9RElSXWAgaXNcbiAqIHZhbHVlLXRha2luZyBcdTIwMTQgdGhlIG5leHQgd29yZCBpcyB0aGUgdGFyZ2V0IGRpcmVjdG9yeSwgbmV2ZXIgYSBzb3VyY2UuIEFcbiAqIGxlYWRpbmctYC1gIHRva2VuIHRoYXQgaXMgbm90IGEga25vd24gb3B0aW9uIGlzIHRyZWF0ZWQgYXMgYW4gb3B0aW9uIChub1xuICogdG91Y2gpLiBSZXR1cm5zIG51bGwgd2hlbiBhIGZhaWwtY2xvc2VkIG9wdGlvbiBpcyBwcmVzZW50IG9yIGEgdmFsdWUtdGFraW5nXG4gKiBmbGFnIGlzIGxlZnQgdmFsdWVsZXNzLlxuICovXG5mdW5jdGlvbiBjb3B5TW92ZVBhcnRzKGFyZ3M6IHN0cmluZ1tdLCBzcGVjOiBDb3B5TW92ZVNwZWMpOiBDb3B5TW92ZVBhcnRzIHwgbnVsbCB7XG4gIGNvbnN0IG9wZXJhbmRzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgdGFyZ2V0RGlyOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgbGV0IGkgPSAwO1xuICBsZXQgYWZ0ZXJEYXNoRGFzaCA9IGZhbHNlO1xuICB3aGlsZSAoaSA8IGFyZ3MubGVuZ3RoKSB7XG4gICAgY29uc3QgYSA9IGFyZ3NbaV07XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLXQnIHx8IGEgPT09ICctLXRhcmdldC1kaXJlY3RvcnknKSB7XG4gICAgICBjb25zdCB2ID0gYXJnc1tpICsgMV07XG4gICAgICBpZiAodiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgICAgIHRhcmdldERpciA9IHY7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLS10YXJnZXQtZGlyZWN0b3J5PScpKSB7XG4gICAgICB0YXJnZXREaXIgPSBhLnNsaWNlKCctLXRhcmdldC1kaXJlY3Rvcnk9Jy5sZW5ndGgpO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChzcGVjLmV4Y2x1ZGVkLmhhcyhhKSkgcmV0dXJuIG51bGw7XG4gICAgaWYgKHNwZWMudmFsdWVUYWtpbmcuaGFzKGEpKSB7XG4gICAgICBpZiAoYXJnc1tpICsgMV0gPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGw7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKHNwZWMubm9WYWx1ZS5oYXMoYSkgfHwgc3BlYy5ub0Nsb2JiZXIuaGFzKGEpKSB7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICBpICs9IDE7XG4gIH1cbiAgcmV0dXJuIHsgb3BlcmFuZHMsIHRhcmdldERpciB9O1xufVxuXG4vKipcbiAqIFRoZSBwZXItc291cmNlIHRvdWNoIG9mIGEgY3AvaW5zdGFsbC9tdiBjb21tYW5kLiBjcC9pbnN0YWxsIHNvdXJjZXMgYXJlXG4gKiB3aG9sZS1maWxlIHJlYWRzIHJlc29sdmVkIGFnYWluc3QgZnMgbGlrZSB0aGUgcmVhZCBpZGlvbXM7IGEgc291cmNlIHdob3NlXG4gKiBsaW5lIGNvdW50IGNhbm5vdCBiZSByZWFkIGF0IHBhcnNlIHRpbWUgKG1pc3Npbmcgb3IgdW5yZWFkYWJsZSBcdTIwMTQgdGhlIHBhcnNlXG4gKiBydW5zIHBvc3QtY29tbWFuZCwgc28gYSBzb3VyY2UgdGhlIGNvbXBvdW5kJ3Mgb3duIGVhcmxpZXIgYHJtYCBkZWxldGVkIGlzXG4gKiBleGFjdGx5IHRoaXMpIHN0aWxsIHJlc29sdmVzIGFzIGEgcmFuZ2UtbGVzcyB3aG9sZS1maWxlIHJlYWQ6IHRoZSBkcml2ZXJcbiAqIHBhaXJzIHRoZSBkZXN0aW5hdGlvbiBhZ2FpbnN0IGl0LCBzbyB0aGUgYWJzZW50LXNvdXJjZSBydWxlIChwbGFuIFx1MDBBNzMgc3RlcFxuICogMWIpIGFuZCB0aGUgcmVhZCdzIHBvc3QtY29tbWFuZCBleGlzdGVuY2UgZ2F0ZSBhcHBseSBcdTIwMTQgYW4gdW5leHBsYWluZWRcbiAqIGFic2VuY2UgZmFpbHMgdGhlIGNvcHkgZGVjaXNpdmVseSBhbmQgYSBwaGFudG9tIHNvdXJjZSBuZXZlciBmaXJlcyB0aGVcbiAqIGRlc3QuIFRoZSBtdiBzb3VyY2UgaXMgYSBkZWxldGUuXG4gKi9cbmZ1bmN0aW9uIGVtaXRTb3VyY2VTcGFuKFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXSxcbiAgc3BlYzogQ29weU1vdmVTcGVjLFxuICBhYnNvbHV0ZVBhdGg6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddXG4pOiB2b2lkIHtcbiAgaWYgKHNwZWMuc291cmNlT3BlcmF0aW9uID09PSAnZGVsZXRlJykge1xuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogc3BlYy5pZGlvbSxcbiAgICAgIHNwYW46IHsgb3BlcmF0aW9uOiAnZGVsZXRlJywgYWJzb2x1dGVQYXRoLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgIH0pO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCByYW5nZSA9IHJlc29sdmVTcGVjKHsga2luZDogJ3RvRW9mJywgc3RhcnQ6IDEgfSwgKCkgPT4gY291bnRGaWxlTGluZXMoYWJzb2x1dGVQYXRoKSk7XG4gIHJlc3VsdHMucHVzaCh7XG4gICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgIGlkaW9tOiBzcGVjLmlkaW9tLFxuICAgIHNwYW46XG4gICAgICByYW5nZSA9PT0gbnVsbFxuICAgICAgICA/IHsgb3BlcmF0aW9uOiAncmVhZCcsIGFic29sdXRlUGF0aCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICAgICAgOiB7XG4gICAgICAgICAgICBvcGVyYXRpb246ICdyZWFkJyxcbiAgICAgICAgICAgIGxpbmVTdGFydDogcmFuZ2UubGluZVN0YXJ0LFxuICAgICAgICAgICAgbGluZUVuZDogcmFuZ2UubGluZUVuZCxcbiAgICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICAgIGpvaW5cbiAgICAgICAgICB9XG4gIH0pO1xufVxuXG4vKipcbiAqIFRoZSBjcC9pbnN0YWxsL212IGZhbWlseSAocGxhbiBcdTAwQTc1LjMvXHUwMEE3NS40KTogb3BlcmFuZHMgcmVzb2x2ZSB0byBzb3VyY2UvZGVzdFxuICogcGFpcnMgXHUyMDE0IGVhY2ggc291cmNlIGlzIGEgcmVhZCAoY3AvaW5zdGFsbCkgb3IgZGVsZXRlIChtdiksIGVhY2ggZGVzdCBhXG4gKiBjcmVhdGUtb3ZlcndyaXRlIChjcC9pbnN0YWxsKSBvciByZW5hbWUtY29weSAobXYpLCBzb3VyY2VzIGJlZm9yZSBkZXN0cyBpblxuICogZGVjbGFyYXRpb24gb3JkZXIuIEEgZGVzdCB0aGF0IGVuZHMgaW4gYC9gIG9yIHN0YXRzIGFzIGFuIGV4aXN0aW5nIGRpcmVjdG9yeVxuICogbWFwcyB0byBgZGlyL2Jhc2VuYW1lKHNvdXJjZSlgIHBlciBzb3VyY2U7IGAtdCBESVJgL2AtLXRhcmdldC1kaXJlY3Rvcnk9RElSYFxuICogbWFwcyB0aGUgc2FtZSB3YXkgYW5kIGlzIHVucmVzb2x2ZWQgd2hlbiBpdHMgdmFsdWUgaXMgbm90IGRpcmVjdG9yeS1zaGFwZWQuXG4gKiBNdWx0aS1zb3VyY2UgY29tbWFuZHMgbmVlZCBhIGRpcmVjdG9yeSBkZXN0OyBhIGRpcmVjdG9yeS1zaGFwZWQgb3JcbiAqIGdsb2JiZWQvdmFyaWFibGUgc291cmNlLCBhIGdsb2JiZWQvdmFyaWFibGUgZGVzdCwgb3IgYSBmYWlsLWNsb3NlZCBvcHRpb25cbiAqIChgY3AgLWJgLCBgaW5zdGFsbCAtZGAsIGdpdCBtdiBgLW5gKSBlbWl0cyBubyB0b3VjaGVzLlxuICovXG5mdW5jdGlvbiBtYXRjaENvcHlNb3ZlRmFtaWx5KFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgZGlyRm9yUmVzb2x1dGlvbjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcmVzdCA9IHN0cmlwVHJhbnNwYXJlbnRXcmFwcGVyKGFyZ3YpO1xuICBpZiAocmVzdC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgY29uc3QgY29tbWFuZCA9IHJlc3RbMF07XG4gIGxldCBzcGVjOiBDb3B5TW92ZVNwZWMgfCBudWxsID0gbnVsbDtcbiAgbGV0IGFyZ3M6IHN0cmluZ1tdID0gW107XG4gIGxldCBkaXIgPSBkaXJGb3JSZXNvbHV0aW9uO1xuICBpZiAoY29tbWFuZCA9PT0gJ2NwJyB8fCBjb21tYW5kID09PSAnaW5zdGFsbCcgfHwgY29tbWFuZCA9PT0gJ212Jykge1xuICAgIHNwZWMgPSBjb21tYW5kID09PSAnY3AnID8gQ1BfU1BFQyA6IGNvbW1hbmQgPT09ICdpbnN0YWxsJyA/IElOU1RBTExfU1BFQyA6IE1WX1NQRUM7XG4gICAgYXJncyA9IHJlc3Quc2xpY2UoMSk7XG4gIH0gZWxzZSBpZiAoY29tbWFuZCA9PT0gJ2dpdCcpIHtcbiAgICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChyZXN0LnNsaWNlKDEpKTtcbiAgICBpZiAoc3ViICE9PSBudWxsICYmIHN1Yi5zdWJjb21tYW5kID09PSAnbXYnKSB7XG4gICAgICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUpIHtcbiAgICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ212LXdyaXRlJywgJ212JywgJ2dpdCAtQyB0YXJnZXQgY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZScpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBzcGVjID0gR0lUX01WX1NQRUM7XG4gICAgICBhcmdzID0gcmVzdC5zbGljZSgxKS5zbGljZShzdWIuc3ViSWR4ICsgMSk7XG4gICAgICBkaXIgPSBzdWIuY0RpciA/PyBkaXJGb3JSZXNvbHV0aW9uO1xuICAgIH1cbiAgfSBlbHNlIGlmIChGT1JFSUdOX1dSQVBQRVJTLmhhcyhjb21tYW5kKSkge1xuICAgIC8vIEEgd3JhcHBlciBvYnNjdXJlcyB0aGUgd3JhcHBlZCBhcmd2IFx1MjAxNCBmYWlsIGNsb3NlZCByYXRoZXIgdGhhbiBtaXMtcGFyc2UuXG4gICAgY29uc3Qgd3JhcHBlZCA9IHJlc3RbMV07XG4gICAgY29uc3Qgd3JhcHBlZFNwZWMgPVxuICAgICAgd3JhcHBlZCA9PT0gJ2NwJyA/IENQX1NQRUMgOiB3cmFwcGVkID09PSAnaW5zdGFsbCcgPyBJTlNUQUxMX1NQRUMgOiB3cmFwcGVkID09PSAnbXYnID8gTVZfU1BFQyA6IG51bGw7XG4gICAgaWYgKHdyYXBwZWRTcGVjICE9PSBudWxsKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCB3cmFwcGVkU3BlYy5pZGlvbSwgd3JhcHBlZCwgYHRoZSAke2NvbW1hbmR9IHdyYXBwZXIgb2JzY3VyZXMgdGhlICR7d3JhcHBlZH0gYXJndmApO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKHNwZWMgPT09IG51bGwpIHJldHVybjtcblxuICBjb25zdCBwYXJ0cyA9IGNvcHlNb3ZlUGFydHMoYXJncywgc3BlYyk7XG4gIGlmIChwYXJ0cyA9PT0gbnVsbCB8fCBwYXJ0cy5vcGVyYW5kcy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAvLyBSZXNvbHZlIGV2ZXJ5IHNvdXJjZSBiZWZvcmUgZW1pdHRpbmcgYW55dGhpbmc6IGEgZGlyZWN0b3J5LXNoYXBlZCxcbiAgLy8gZ2xvYmJlZCwgb3IgdmFyaWFibGUgc291cmNlIGZhaWxzIHRoZSB3aG9sZSBjb21tYW5kIGNsb3NlZCAodGhlIGRlc3RcbiAgLy8gbWFwcGluZyBpcyBwZXItc291cmNlLCBzbyBhbiB1bmtub3dhYmxlIHNvdXJjZSBtYWtlcyB0aGUgZGVzdHMgdW5rbm93YWJsZSkuXG4gIGNvbnN0IHNvdXJjZVBhdGhzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IHNvdXJjZSBvZiBwYXJ0cy5vcGVyYW5kcy5zbGljZSgwLCBwYXJ0cy50YXJnZXREaXIgPT09IG51bGwgPyAtMSA6IHVuZGVmaW5lZCkpIHtcbiAgICBpZiAoc291cmNlLmVuZHNXaXRoKCcvJykpIHJldHVybjtcbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlVGFyZ2V0KHJlc3VsdHMsIHNwZWMuaWRpb20sIHNvdXJjZSwgZGlyKTtcbiAgICBpZiAoYWJzb2x1dGVQYXRoID09PSBudWxsKSByZXR1cm47XG4gICAgaWYgKGlzRXhpc3RpbmdEaXJlY3RvcnkoYWJzb2x1dGVQYXRoKSkgcmV0dXJuO1xuICAgIHNvdXJjZVBhdGhzLnB1c2goYWJzb2x1dGVQYXRoKTtcbiAgfVxuICBpZiAoc291cmNlUGF0aHMubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgbGV0IGRlc3RQYXRoczogc3RyaW5nW107XG4gIGlmIChwYXJ0cy50YXJnZXREaXIgIT09IG51bGwpIHtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUocGFydHMudGFyZ2V0RGlyKSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgc3BlYy5pZGlvbSwgcGFydHMudGFyZ2V0RGlyLCAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKCFwYXJ0cy50YXJnZXREaXIuZW5kc1dpdGgoJy8nKSAmJiAhaXNFeGlzdGluZ0RpcmVjdG9yeShyZXNvbHZlUGF0aChkaXIsIHBhcnRzLnRhcmdldERpcikpKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCBzcGVjLmlkaW9tLCBwYXJ0cy50YXJnZXREaXIsICd0aGUgLXQgdGFyZ2V0IGlzIG5vdCBhbiBleGlzdGluZyBkaXJlY3RvcnknKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgdGFyZ2V0QWJzID0gcmVzb2x2ZVBhdGgoZGlyLCBwYXJ0cy50YXJnZXREaXIpO1xuICAgIGRlc3RQYXRocyA9IHNvdXJjZVBhdGhzLm1hcCgocCkgPT4gam9pblBhdGgodGFyZ2V0QWJzLCBiYXNlbmFtZShwKSkpO1xuICB9IGVsc2Uge1xuICAgIGNvbnN0IGRlc3QgPSBwYXJ0cy5vcGVyYW5kc1twYXJ0cy5vcGVyYW5kcy5sZW5ndGggLSAxXTtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUoZGVzdCkpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsIHNwZWMuaWRpb20sIGRlc3QsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBkZXN0QWJzID0gcmVzb2x2ZVBhdGgoZGlyLCBkZXN0KTtcbiAgICBjb25zdCBkZXN0SXNEaXIgPSBkZXN0LmVuZHNXaXRoKCcvJykgfHwgaXNFeGlzdGluZ0RpcmVjdG9yeShkZXN0QWJzKTtcbiAgICBpZiAoc291cmNlUGF0aHMubGVuZ3RoID4gMSAmJiAhZGVzdElzRGlyKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCBzcGVjLmlkaW9tLCBkZXN0LCAnYSBtdWx0aS1zb3VyY2UgY29weS9tb3ZlIG5lZWRzIGEgZGlyZWN0b3J5IGRlc3RpbmF0aW9uJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGRlc3RQYXRocyA9IGRlc3RJc0RpciA/IHNvdXJjZVBhdGhzLm1hcCgocCkgPT4gam9pblBhdGgoZGVzdEFicywgYmFzZW5hbWUocCkpKSA6IFtkZXN0QWJzXTtcbiAgfVxuXG4gIGZvciAobGV0IGsgPSAwOyBrIDwgc291cmNlUGF0aHMubGVuZ3RoOyBrKyspIHtcbiAgICBlbWl0U291cmNlU3BhbihyZXN1bHRzLCBzcGVjLCBzb3VyY2VQYXRoc1trXSwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luKTtcbiAgfVxuICBmb3IgKGxldCBrID0gMDsgayA8IHNvdXJjZVBhdGhzLmxlbmd0aDsgaysrKSB7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiBzcGVjLmlkaW9tLFxuICAgICAgc3BhbjogeyBvcGVyYXRpb246IHNwZWMuZGVzdE9wZXJhdGlvbiwgYWJzb2x1dGVQYXRoOiBkZXN0UGF0aHNba10sIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgfSk7XG4gIH1cbn1cblxuY29uc3QgUk1fTk9fVkFMVUUgPSBuZXcgU2V0KFsnLWYnLCAnLWknLCAnLXYnXSk7XG4vKiogYHJtYC9gZ2l0IHJtYCBmbGFncyB3aG9zZSBzZW1hbnRpY3MgYXJlIG91dCBvZiBzY29wZTogcmVjdXJzaXZlIHJlbW92YWwgYW5kIHJtZGlyLiAqL1xuY29uc3QgUk1fRVhDTFVERUQgPSBuZXcgU2V0KFsnLXInLCAnLVInLCAnLS1yZWN1cnNpdmUnLCAnLWQnXSk7XG4vKiogYGdpdCBybWAgYWRkcyB0aGUgZHJ5LXJ1biBmb3JtIHRvIHRoZSBleGNsdXNpb25zLiAqL1xuY29uc3QgR0lUX1JNX0VYQ0xVREVEID0gbmV3IFNldChbJy1yJywgJy1SJywgJy0tcmVjdXJzaXZlJywgJy1kJywgJy1uJywgJy0tZHJ5LXJ1biddKTtcblxuLyoqXG4gKiBUaGUgc2hhcmVkIHJtL2dpdCBybSBvcGVyYW5kIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS41KTogYSByZWN1cnNpdmUvcm1kaXIgZmxhZyAob3JcbiAqIGAtLWNhY2hlZGAgZm9yIGdpdCBybSBcdTIwMTQgdGhlIHdvcmt0cmVlIGZpbGUgc3Vydml2ZXMpIGV4Y2x1ZGVzIHRoZSB3aG9sZVxuICogY29tbWFuZDsgZWFjaCByZW1haW5pbmcgZmlsZS1zaGFwZWQgb3BlcmFuZCBpcyBhIGRlbGV0ZSwgYW5kIGFcbiAqIGRpcmVjdG9yeS1zaGFwZWQgb3BlcmFuZCBmYWlscyBjbG9zZWQuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoUm1PcGVyYW5kcyhcbiAgYXJnczogc3RyaW5nW10sXG4gIGV4Y2x1ZGVkOiBSZWFkb25seVNldDxzdHJpbmc+LFxuICBleGNsdWRlQ2FjaGVkOiBib29sZWFuLFxuICBkaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG4gIGNvbnN0IG9wZXJhbmRzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGEgb2YgYXJncykge1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoZXhjbHVkZWQuaGFzKGEpIHx8IChleGNsdWRlQ2FjaGVkICYmIGEgPT09ICctLWNhY2hlZCcpKSByZXR1cm47XG4gICAgaWYgKFJNX05PX1ZBTFVFLmhhcyhhKSkgY29udGludWU7XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTsgLy8gdW5rbm93biBvcHRpb24gXHUyMTkyIHRyZWF0ZWQgYXMgYW4gb3B0aW9uXG4gICAgb3BlcmFuZHMucHVzaChhKTtcbiAgfVxuICBmb3IgKGNvbnN0IG9wZXJhbmQgb2Ygb3BlcmFuZHMpIHtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUob3BlcmFuZCkpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdybS13cml0ZScsIG9wZXJhbmQsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChvcGVyYW5kLmVuZHNXaXRoKCcvJykgfHwgaXNFeGlzdGluZ0RpcmVjdG9yeShyZXNvbHZlUGF0aChkaXIsIG9wZXJhbmQpKSkgY29udGludWU7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiAncm0td3JpdGUnLFxuICAgICAgc3BhbjogeyBvcGVyYXRpb246ICdkZWxldGUnLCBhYnNvbHV0ZVBhdGg6IHJlc29sdmVQYXRoKGRpciwgb3BlcmFuZCksIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgfSk7XG4gIH1cbn1cblxuLyoqXG4gKiBTdGF0aWNhbGx5IGV2YWx1YXRlIGFuIGFic29sdXRlIGB0cnVuY2F0ZSAtc2Agc2l6ZSAocGxhbiBcdTAwQTc1LjUpOiBhIHBsYWluXG4gKiBpbnRlZ2VyIHdpdGggYW4gb3B0aW9uYWwgSy9NL0cgc3VmZml4LiBSZWxhdGl2ZSBzaXplcyAoYC1zICtOYC9gLXMgLU5gKSxcbiAqIGAtciByZWZgIHZhbHVlcywgYW5kIHNoZWxsLWV4cGFuZGVkIHZhbHVlcyBkZXBlbmQgb24gcnVudGltZSBzdGF0ZSBcdTIxOTJcbiAqIHVuZGVmaW5lZCAodGhvc2Ugc3BhbnMgZ2F0ZSBleGlzdGVuY2Utb25seSkuXG4gKi9cbmZ1bmN0aW9uIGV2YWx1YXRlU3RhdGljU2l6ZSh2YWx1ZTogc3RyaW5nIHwgdW5kZWZpbmVkKTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gIGNvbnN0IG0gPSB2YWx1ZS5tYXRjaCgvXihcXGQrKShbS01HXSk/JC8pO1xuICBpZiAobSA9PT0gbnVsbCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3QgYmFzZSA9IE51bWJlci5wYXJzZUludChtWzFdLCAxMCk7XG4gIGNvbnN0IG11bHQgPSBtWzJdID09PSAnSycgPyAxMDI0IDogbVsyXSA9PT0gJ00nID8gMTAyNCAqKiAyIDogbVsyXSA9PT0gJ0cnID8gMTAyNCAqKiAzIDogMTtcbiAgcmV0dXJuIGJhc2UgKiBtdWx0O1xufVxuXG4vKipcbiAqIFRoZSB0cnVuY2F0ZSBncmFtbWFyIChwbGFuIFx1MDBBNzUuNSk6IGAtcyBTSVpFYC9gLXIgcmVmYCBhcmUgdmFsdWUtdGFraW5nIFx1MjAxNCB0aGVcbiAqIHNpemUgdmFsdWUgbWF5IGl0c2VsZiBsZWFkIHdpdGggYC1gIChgdHJ1bmNhdGUgLXMgLTEwIGZgKSBcdTIwMTQgYW5kIGAtY2AgaXNcbiAqIGNvbXBhdGlibGUuIFdpdGhvdXQgYC1zYC9gLXJgIHRoZSBjb21tYW5kIGNoYW5nZXMgbm90aGluZyBcdTIxOTIgbm8gdG91Y2guIEVhY2hcbiAqIGZpbGUtc2hhcGVkIG9wZXJhbmQgaXMgYSB0cnVuY2F0ZTsgYW4gYWJzb2x1dGUgYC1zIE5gIGNhcnJpZXMgdGhlIHN0YXRpY2FsbHlcbiAqIGV2YWx1YXRlZCBzaXplIG9uIHRoZSBzcGFuICh0aGUgXHUwMEE3MyBgc2l6ZWAgZ2F0ZSdzIHBvc3QtY29tbWFuZCBieXRlIGNvdW50LFxuICogYC1zIDBgIFx1MjE5MiBlbXB0eSksIHJlbGF0aXZlIHNpemVzIGFuZCBgLXIgcmVmYCBzdGF5IGV4aXN0ZW5jZS1vbmx5LlxuICovXG5mdW5jdGlvbiBtYXRjaFRydW5jYXRlT3BlcmFuZHMoXG4gIGFyZ3M6IHN0cmluZ1tdLFxuICBkaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGxldCBzYXdTaXplRmxhZyA9IGZhbHNlO1xuICBsZXQgYWZ0ZXJEYXNoRGFzaCA9IGZhbHNlO1xuICBsZXQgc3RhdGljU2l6ZTogbnVtYmVyIHwgdW5kZWZpbmVkO1xuICBjb25zdCBvcGVyYW5kczogQXJyYXk8eyBwYXRoOiBzdHJpbmc7IHNpemU6IG51bWJlciB8IHVuZGVmaW5lZCB9PiA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJnc1tpXTtcbiAgICBpZiAoYWZ0ZXJEYXNoRGFzaCkge1xuICAgICAgb3BlcmFuZHMucHVzaCh7IHBhdGg6IGEsIHNpemU6IHN0YXRpY1NpemUgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLXMnKSB7XG4gICAgICBzYXdTaXplRmxhZyA9IHRydWU7XG4gICAgICBzdGF0aWNTaXplID0gZXZhbHVhdGVTdGF0aWNTaXplKGFyZ3NbaSArIDFdKTtcbiAgICAgIGkgKz0gMTsgLy8gY29uc3VtZSB0aGUgc2l6ZSB2YWx1ZSwgZXZlbiB3aGVuIGl0IGxlYWRzIHdpdGggYC1gXG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctcicpIHtcbiAgICAgIHNhd1NpemVGbGFnID0gdHJ1ZTtcbiAgICAgIHN0YXRpY1NpemUgPSB1bmRlZmluZWQ7IC8vIHRoZSBsYXN0IHNpemUgb3B0aW9uIHdpbnM7IGEgcmVmIGhhcyBubyBzdGF0aWMgdmFsdWVcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1jJykgY29udGludWU7XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTsgLy8gdW5rbm93biBvcHRpb24gXHUyMTkyIHRyZWF0ZWQgYXMgYW4gb3B0aW9uXG4gICAgb3BlcmFuZHMucHVzaCh7IHBhdGg6IGEsIHNpemU6IHN0YXRpY1NpemUgfSk7XG4gIH1cbiAgaWYgKCFzYXdTaXplRmxhZykgcmV0dXJuO1xuICBmb3IgKGNvbnN0IG9wZXJhbmQgb2Ygb3BlcmFuZHMpIHtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUob3BlcmFuZC5wYXRoKSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3RydW5jYXRlLWNvbW1hbmQnLCBvcGVyYW5kLnBhdGgsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChvcGVyYW5kLnBhdGguZW5kc1dpdGgoJy8nKSB8fCBpc0V4aXN0aW5nRGlyZWN0b3J5KHJlc29sdmVQYXRoKGRpciwgb3BlcmFuZC5wYXRoKSkpIGNvbnRpbnVlO1xuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogJ3RydW5jYXRlLWNvbW1hbmQnLFxuICAgICAgc3Bhbjoge1xuICAgICAgICBvcGVyYXRpb246ICd0cnVuY2F0ZScsXG4gICAgICAgIGFic29sdXRlUGF0aDogcmVzb2x2ZVBhdGgoZGlyLCBvcGVyYW5kLnBhdGgpLFxuICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgIGpvaW4sXG4gICAgICAgIC4uLihvcGVyYW5kLnNpemUgIT09IHVuZGVmaW5lZCA/IHsgc2l6ZTogb3BlcmFuZC5zaXplIH0gOiB7fSlcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBybS9naXQgcm0vdHJ1bmNhdGUgZmFtaWx5IChwbGFuIFx1MDBBNzUuNSk6IGBybWAvYGdpdCBybWAgb3BlcmFuZHMgYXJlXG4gKiBkZWxldGVzLCBgdHJ1bmNhdGVgIG9wZXJhbmRzIGFyZSB0cnVuY2F0aW9ucyAob25seSB3aGVuIGAtc2AvYC1yYCBpc1xuICogcHJlc2VudCkuIGBnaXQgcm0gLS1jYWNoZWRgIHRvdWNoZXMgbm90aGluZy5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hSbVRydW5jYXRlKFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgZGlyRm9yUmVzb2x1dGlvbjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcmVzdCA9IHN0cmlwVHJhbnNwYXJlbnRXcmFwcGVyKGFyZ3YpO1xuICBpZiAocmVzdC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgY29uc3QgY29tbWFuZCA9IHJlc3RbMF07XG4gIGlmIChjb21tYW5kID09PSAncm0nKSB7XG4gICAgbWF0Y2hSbU9wZXJhbmRzKHJlc3Quc2xpY2UoMSksIFJNX0VYQ0xVREVELCBmYWxzZSwgZGlyRm9yUmVzb2x1dGlvbiwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luLCByZXN1bHRzKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGNvbW1hbmQgPT09ICd0cnVuY2F0ZScpIHtcbiAgICBtYXRjaFRydW5jYXRlT3BlcmFuZHMocmVzdC5zbGljZSgxKSwgZGlyRm9yUmVzb2x1dGlvbiwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luLCByZXN1bHRzKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGNvbW1hbmQgPT09ICdnaXQnKSB7XG4gICAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQocmVzdC5zbGljZSgxKSk7XG4gICAgaWYgKHN1YiAhPT0gbnVsbCAmJiBzdWIuc3ViY29tbWFuZCA9PT0gJ3JtJykge1xuICAgICAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlKSB7XG4gICAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdybS13cml0ZScsICdybScsICdnaXQgLUMgdGFyZ2V0IGNvbnRhaW5zIGFuIHVucmVzb2x2ZWQgc2hlbGwgdmFyaWFibGUnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgbWF0Y2hSbU9wZXJhbmRzKFxuICAgICAgICByZXN0LnNsaWNlKDEpLnNsaWNlKHN1Yi5zdWJJZHggKyAxKSxcbiAgICAgICAgR0lUX1JNX0VYQ0xVREVELFxuICAgICAgICB0cnVlLFxuICAgICAgICBzdWIuY0RpciA/PyBkaXJGb3JSZXNvbHV0aW9uLFxuICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgIGpvaW4sXG4gICAgICAgIHJlc3VsdHNcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuICBpZiAoRk9SRUlHTl9XUkFQUEVSUy5oYXMoY29tbWFuZCkpIHtcbiAgICBjb25zdCB3cmFwcGVkID0gcmVzdFsxXTtcbiAgICBpZiAod3JhcHBlZCA9PT0gJ3JtJyB8fCB3cmFwcGVkID09PSAndHJ1bmNhdGUnKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChcbiAgICAgICAgcmVzdWx0cyxcbiAgICAgICAgd3JhcHBlZCA9PT0gJ3JtJyA/ICdybS13cml0ZScgOiAndHJ1bmNhdGUtY29tbWFuZCcsXG4gICAgICAgIHdyYXBwZWQsXG4gICAgICAgIGB0aGUgJHtjb21tYW5kfSB3cmFwcGVyIG9ic2N1cmVzIHRoZSAke3dyYXBwZWR9IGFyZ3ZgXG4gICAgICApO1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhlIGJvZHkgb2YgYW4gdW5xdW90ZWQgaGVyZWRvYyBpcyBzaGVsbC1saXRlcmFsLiBUaGUgc2hlbGwgZXhwYW5kc1xuICogYCRgIGFuZCBiYWNrdGljayBzdWJzdGl0dXRpb25zIGFuZCBwcm9jZXNzZXMgYmFja3NsYXNoIGVzY2FwZXMgKGBcXCRgLCBgYCBcXGAgYGAsXG4gKiBgXFxcXGAsIGJhY2tzbGFzaC1uZXdsaW5lKSBpbiBhbiB1bnF1b3RlZCBib2R5IGJlZm9yZSB0aGUgaG9zdCByZWFkcyBpdDsgYVxuICogYmFyZSBiYWNrc2xhc2ggYmVmb3JlIGFueSBvdGhlciBjaGFyIHN1cnZpdmVzIGxpdGVyYWxseS4gQSBxdW90ZWQgZGVsaW1pdGVyXG4gKiBtYWtlcyB0aGUgYm9keSBsaXRlcmFsIHJlZ2FyZGxlc3MgXHUyMDE0IGNoZWNrZWQgYnkgdGhlIGNhbGxlci5cbiAqL1xuZnVuY3Rpb24gaGVyZWRvY0JvZHlJc0xpdGVyYWwoYm9keTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGlmIChib2R5LmluY2x1ZGVzKCckJykgfHwgYm9keS5pbmNsdWRlcygnYCcpKSByZXR1cm4gZmFsc2U7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYm9keS5sZW5ndGg7IGkrKykge1xuICAgIGlmIChib2R5W2ldICE9PSAnXFxcXCcpIGNvbnRpbnVlO1xuICAgIGNvbnN0IG5leHQgPSBib2R5W2kgKyAxXTtcbiAgICBpZiAobmV4dCA9PT0gdW5kZWZpbmVkIHx8IG5leHQgPT09ICckJyB8fCBuZXh0ID09PSAnYCcgfHwgbmV4dCA9PT0gJ1xcXFwnIHx8IG5leHQgPT09ICdcXG4nKSByZXR1cm4gZmFsc2U7XG4gICAgaSArPSAxO1xuICB9XG4gIHJldHVybiB0cnVlO1xufVxuXG4vKipcbiAqIFRoZSBoZXJlZG9jIHdyaXRlIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS4yKSBmb3IgdGhlIGhvc3QgZmFtaWxpZXMgd2hvc2UgYm9kaWVzIGFyZVxuICogY29udGVudDogYGNhdGAgKGJvZHkgXHUyMTkyIHRoZSBjb250ZW50IHJlZGlyZWN0cyksIGB0ZWVgIChib2R5IFx1MjE5MiB0aGUgb3BlcmFuZHMpLFxuICogYW5kIGBwYXRjaGAvYGdpdCBhcHBseWAgKGJvZHkgXHUyMTkyIHBhdGNoIHRleHQsIFx1MDBBNzUuNykuIEFueSBvdGhlciBob3N0J3MgaGVyZWRvY1xuICogYm9keSBpcyBub3QgYXR0cmlidXRhYmxlIGNvbnRlbnQgXHUyMDE0IHN0ZGluLW9ubHkgYW5kIG5vbi1mYW1pbHkgY29tbWFuZHNcbiAqIChgcHl0aG9uMyAtIDw8RU9GID4gb3V0YCwgYGxzID4gb3V0IDw8RU9GYCkgZ2V0IG5vIHdyaXRlIHRvdWNoLCBhbmRcbiAqIHJlYWQtZmFtaWx5IGNvbW1hbmRzIChgc2VkIC1uICcxLDJwJyA8PEVPRmApIGZhbGwgdGhyb3VnaCB0byB0aGUgcmVhZFxuICogbWF0Y2hlcnMuIEVtcHR5IGA+PmAtYm9kaWVzIGFwcGVuZCBub3RoaW5nIGFuZCB0b3VjaCBub3RoaW5nOyBlbXB0eSBgPmAtYm9kaWVzXG4gKiB0cnVuY2F0ZSAod2hvbGUtZmlsZSwgdGhlIEYyIHJ1bGUpLlxuICpcbiAqIEJvZHkgdGhyZWFkaW5nOiBgPj5gIGFwcGVuZHMgYW5kIGA+YCBvdmVyd3JpdGVzIHRocmVhZCB0aGUgYm9keSB3aGVuIHRoZVxuICogY29udGVudCByZWRpcmVjdCBpcyBzaW5nbGUgYW5kIHBsYWluIFx1MjAxNCB0aGUgZXhhY3QgZ2F0ZSdzIHBvc3QtY29udGVudCBvbiB0aGVcbiAqIG92ZXJ3cml0ZSAodGhlIHRyYWlsaW5nIGBcXG5gIHRoZSBleHRyYWN0aW9uIHN0cmlwcyBpcyByZXN0b3JlZCwgc2luY2UgdGhlXG4gKiBnYXRlIGNvbXBhcmVzIGZ1bGwgZmlsZSBieXRlcyksIHRoZSBzdWZmaXggZ2F0ZSdzIGJvZHkgb24gdGhlIGFwcGVuZCAocGxhblxuICogXHUwMEE3MyBzdGVwIDFiIGxpc3RzIFwidGVlL2hlcmVkb2Mgd2l0aCBhIGxpdGVyYWwgYm9keVwiIGluIHRoZSBleGFjdCBjbGFzcykuXG4gKiBBbiB1bnF1b3RlZCBkZWxpbWl0ZXIgbGV0cyB0aGUgc2hlbGwgZXhwYW5kIHRoZSBib2R5IGJlZm9yZSB0aGUgaG9zdCByZWFkc1xuICogaXQsIHNvIG9ubHkgYSBsaXRlcmFsIGJvZHkgKG5vIGAkYCwgYmFja3RpY2ssIG9yIHNoZWxsLXByb2Nlc3NlZCBiYWNrc2xhc2gpXG4gKiB0aHJlYWRzIFx1MjAxNCBhbiBleHBhbmRhYmxlIG9uZSBkZWdyYWRlcyB0byB0aGUgZXhpc3RlbmNlLWdhdGVkIGFkdmlzb3J5IGNsYXNzXG4gKiByYXRoZXIgdGhhbiByaXNrIGEgZGVjaXNpdmUtZmFpbCBvbiBjb250ZW50IHRoYXQgbmV2ZXIgcmVhY2hlZCB0aGUgZmlsZS5cbiAqL1xuZnVuY3Rpb24gY2xhc3NpZnlIZXJlZG9jT3BlbmVyKFxuICBvcGVuZXI6IHN0cmluZyxcbiAgYm9keTogc3RyaW5nLFxuICBxdW90ZWREZWxpbTogYm9vbGVhbixcbiAgY3VycmVudERpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgYm9keUxpdGVyYWwgPSBxdW90ZWREZWxpbSB8fCBoZXJlZG9jQm9keUlzTGl0ZXJhbChib2R5KTtcbiAgY29uc3QgdG9rZW5zID0gdG9rZW5pemUoc3RyaXBMZWFkaW5nQXNzaWdubWVudHMob3BlbmVyKS50cmltKCkpO1xuICBpZiAodG9rZW5zID09PSBudWxsKSByZXR1cm47XG4gIGNvbnN0IHsgYXJndiwgcmVkaXJlY3RzIH0gPSBhbmFseXplVG9rZW5zKHRva2Vucyk7XG4gIGNvbnN0IGhvc3QgPSBhcmd2WzBdO1xuICBjb25zdCBjb250ZW50UmVkaXJlY3RzID0gcmVkaXJlY3RzLmZpbHRlcihpc0NvbnRlbnRSZWRpcmVjdCk7XG4gIGNvbnN0IHNpbmdsZVBsYWluQXBwZW5kID0gY29udGVudFJlZGlyZWN0cy5sZW5ndGggPT09IDEgJiYgY29udGVudFJlZGlyZWN0c1swXS5vcCA9PT0gJz4+JztcbiAgY29uc3Qgc2luZ2xlUGxhaW5PdmVyd3JpdGUgPSBjb250ZW50UmVkaXJlY3RzLmxlbmd0aCA9PT0gMSAmJiBjb250ZW50UmVkaXJlY3RzWzBdLm9wID09PSAnPic7XG5cbiAgY29uc3QgZW1pdENvbnRlbnRSZWRpcmVjdHMgPSAoKTogdm9pZCA9PiB7XG4gICAgZm9yIChjb25zdCByIG9mIGNvbnRlbnRSZWRpcmVjdHMpIHtcbiAgICAgIGlmIChyLnRhcmdldCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlVGFyZ2V0KHJlc3VsdHMsICdoZXJlZG9jLXdyaXRlJywgci50YXJnZXQsIGN1cnJlbnREaXIpO1xuICAgICAgaWYgKGFic29sdXRlUGF0aCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgICBpZiAoci5vcCA9PT0gJz4+JyB8fCByLm9wID09PSAnJj4+Jykge1xuICAgICAgICBpZiAoYm9keS5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgICBpZGlvbTogJ2hlcmVkb2Mtd3JpdGUnLFxuICAgICAgICAgIHNwYW46IHtcbiAgICAgICAgICAgIG9wZXJhdGlvbjogJ2FwcGVuZCcsXG4gICAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgICBqb2luLFxuICAgICAgICAgICAgLi4uKHNpbmdsZVBsYWluQXBwZW5kICYmIHIub3AgPT09ICc+PicgJiYgYm9keUxpdGVyYWwgPyB7IHdyaXR0ZW46IGJvZHkgfSA6IHt9KVxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgICBpZGlvbTogJ2hlcmVkb2Mtd3JpdGUnLFxuICAgICAgICAgIHNwYW46XG4gICAgICAgICAgICBib2R5Lmxlbmd0aCA9PT0gMFxuICAgICAgICAgICAgICA/IHsgb3BlcmF0aW9uOiAndHJ1bmNhdGUnLCBhYnNvbHV0ZVBhdGgsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgICAgICAgICAgIDoge1xuICAgICAgICAgICAgICAgICAgb3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZScsXG4gICAgICAgICAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgICAgICAgICBqb2luLFxuICAgICAgICAgICAgICAgICAgLy8gVGhlIGV4YWN0IGdhdGUgY29tcGFyZXMgZnVsbCBmaWxlIGJ5dGVzLCBzbyB0aGUgdHJhaWxpbmdcbiAgICAgICAgICAgICAgICAgIC8vIGBcXG5gIHRoZSBleHRyYWN0aW9uIHN0cmlwcGVkIGNvbWVzIGJhY2sgb24gdGhlIG92ZXJ3cml0ZS5cbiAgICAgICAgICAgICAgICAgIC4uLihzaW5nbGVQbGFpbk92ZXJ3cml0ZSAmJiBib2R5TGl0ZXJhbCA/IHsgd3JpdHRlbjogYCR7Ym9keX1cXG5gIH0gOiB7fSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfTtcblxuICBpZiAoaG9zdCA9PT0gJ2NhdCcpIHtcbiAgICBlbWl0Q29udGVudFJlZGlyZWN0cygpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoaG9zdCA9PT0gJ3RlZScpIHtcbiAgICBjb25zdCBwYXJ0cyA9IHRlZU9wZXJhbmRQYXJ0cyhhcmd2KTtcbiAgICBpZiAocGFydHMgIT09IG51bGwpIHtcbiAgICAgIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBwYXJ0cy5vcGVyYW5kcykge1xuICAgICAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlVGFyZ2V0KHJlc3VsdHMsICdoZXJlZG9jLXdyaXRlJywgb3BlcmFuZCwgY3VycmVudERpcik7XG4gICAgICAgIGlmIChhYnNvbHV0ZVBhdGggPT09IG51bGwpIGNvbnRpbnVlO1xuICAgICAgICBpZiAocGFydHMuYXBwZW5kKSB7XG4gICAgICAgICAgaWYgKGJvZHkubGVuZ3RoID09PSAwKSBjb250aW51ZTtcbiAgICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICAgICAgaWRpb206ICdoZXJlZG9jLXdyaXRlJyxcbiAgICAgICAgICAgIHNwYW46IHtcbiAgICAgICAgICAgICAgb3BlcmF0aW9uOiAnYXBwZW5kJyxcbiAgICAgICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgICAgIC4uLihjb250ZW50UmVkaXJlY3RzLmxlbmd0aCA9PT0gMCAmJiBib2R5TGl0ZXJhbCA/IHsgd3JpdHRlbjogYm9keSB9IDoge30pXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgICBzcGFuOlxuICAgICAgICAgICAgICBib2R5Lmxlbmd0aCA9PT0gMFxuICAgICAgICAgICAgICAgID8geyBvcGVyYXRpb246ICd0cnVuY2F0ZScsIGFic29sdXRlUGF0aCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICAgICAgICAgICAgICA6IHtcbiAgICAgICAgICAgICAgICAgICAgb3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZScsXG4gICAgICAgICAgICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICAgICAgICAgICAgICBqb2luLFxuICAgICAgICAgICAgICAgICAgICAvLyBTYW1lIHJlc3RvcmVkLWBcXG5gIGV4YWN0IGJvZHkgYXMgdGhlIHJlZGlyZWN0IGJyYW5jaDsgYVxuICAgICAgICAgICAgICAgICAgICAvLyB0ZWUgb3BlcmFuZCB3aXRoIGEgY29udGVudCByZWRpcmVjdCBwcmVzZW50IGtlZXBzIHRoZVxuICAgICAgICAgICAgICAgICAgICAvLyByZWRpcmVjdCdzIHRocmVhZGluZyBvbmx5IChtaXJyb3Igb2YgdGhlIGFwcGVuZCBicmFuY2gpLlxuICAgICAgICAgICAgICAgICAgICAuLi4oY29udGVudFJlZGlyZWN0cy5sZW5ndGggPT09IDAgJiYgYm9keUxpdGVyYWwgPyB7IHdyaXR0ZW46IGAke2JvZHl9XFxuYCB9IDoge30pXG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgZW1pdENvbnRlbnRSZWRpcmVjdHMoKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGhvc3QgPT09ICdwYXRjaCcgfHwgaG9zdCA9PT0gJ2dpdCcpIHtcbiAgICBjbGFzc2lmeVBhdGNoSGVyZWRvYyhhcmd2LCBib2R5LCBjdXJyZW50RGlyLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyBOb24tZmFtaWx5IGhvc3Q6IHRoZSBib2R5IGlzIG5vdCBhdHRyaWJ1dGFibGUgY29udGVudCBcdTIwMTQgbm8gd3JpdGUgdG91Y2guXG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVGhlIHNlZCAtaSBncmFtbWFyIChwbGFuIFx1MDBBNzUuNiksIHRoZSBmaXJzdCBjb25zdW1lciBvZiBleGFjdCByYW5nZXM6IGFcbi8vIHN1YnN0aXR1dGlvbi1vbmx5IHNjcmlwdCB3aXRoIG51bWVyaWMgYWRkcmVzc2VzIG1vZGlmaWVzIHRoZSBhZGRyZXNzZWRcbi8vIGxpbmVzOyBhbnl0aGluZyBsZXNzIHN0YXRpY2FsbHkgY2VydGFpbiBpcyBhIHdob2xlLWZpbGUgbW9kaWZ5LiBUaGVcbi8vIHN1ZmZpeC9zY3JpcHQgZGlzYW1iaWd1YXRpb24gYW5kIHRoZSBzZWdtZW50IGNsYXNzaWZpY2F0aW9uIGJlbG93IGFyZSB0aGVcbi8vIHdob2xlIG9mIGl0IFx1MjAxNCBldmVyeXRoaW5nIGVsc2UgZm9sbG93cyB0aGUgc2hhcmVkIFx1MDBBNzUgZmFpbC1jbG9zZWQgcnVsZXMuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEEgbnVtZXJpYy1hZGRyZXNzZWQgc3Vic3RpdHV0aW9uIHNlZ21lbnQgKGBOYCwgYE4sTWApIFx1MjAxNCB0aGUgb25seSBmb3JtIHdpdGggYW4gZXhhY3QgcmFuZ2UuICovXG5jb25zdCBOVU1FUklDX1NVQlNUSVRVVElPTiA9IC9eKFxcZCspKD86LChcXGQrKSk/W3N5XS87XG5cbi8qKiBBbiB1bmFkZHJlc3NlZCBzdWJzdGl0dXRpb24gc2VnbWVudCBcdTIwMTQgbGluZS1jb3VudC1wcmVzZXJ2aW5nLCB3aG9sZSBmaWxlIGFkZHJlc3NlZC4gKi9cbmNvbnN0IFVOUkVTVFJJQ1RFRF9TVUJTVElUVVRJT04gPSAvXltzeV0vO1xuXG5mdW5jdGlvbiBtYXRjaFNlZElucGxhY2UoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBkaXJGb3JSZXNvbHV0aW9uOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCByZXN0ID0gc3RyaXBUcmFuc3BhcmVudFdyYXBwZXIoYXJndik7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICBjb25zdCBjb21tYW5kID0gcmVzdFswXTtcbiAgaWYgKGNvbW1hbmQgPT09ICdzZWQnKSB7XG4gICAgbWF0Y2hTZWRJbnBsYWNlQXJncyhyZXN0LnNsaWNlKDEpLCBkaXJGb3JSZXNvbHV0aW9uLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoRk9SRUlHTl9XUkFQUEVSUy5oYXMoY29tbWFuZCkpIHtcbiAgICBjb25zdCB3cmFwcGVkID0gcmVzdFsxXTtcbiAgICBpZiAod3JhcHBlZCA9PT0gJ3NlZCcpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdzZWQtaW5wbGFjZScsIHdyYXBwZWQsIGB0aGUgJHtjb21tYW5kfSB3cmFwcGVyIG9ic2N1cmVzIHRoZSAke3dyYXBwZWR9IGFyZ3ZgKTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgc2VkIC1pIG9wZXJhbmQgZ3JhbW1hcjogYC1pYCBiYXJlLCBgLWlTVUZGSVhgIGF0dGFjaGVkLCBvciBhIHNlcGFyYXRlXG4gKiBzdWZmaXggd29yZCByZXNvbHZlZCBieSB0aGUgc3RhbmRhcmQgZGlzYW1iaWd1YXRpb24gXHUyMDE0IHRoZSB3b3JkIGFmdGVyIGAtaWBcbiAqIGlzIHRoZSBzdWZmaXggb25seSB3aGVuIGl0IGRvZXMgbm90IHN0YXJ0IHdpdGggYC1gLCBpcyBub3Qgc2NyaXB0LXNoYXBlZFxuICogKGEgc2VkIGNvbW1hbmQgbGV0dGVyIG9yIGFuIGFkZHJlc3Mgc3RhcnQgXHUyMDE0IGBzL2EvYi9gLCBgMmRgLCBgL3gvZGApLCBhbmQgYVxuICogc2NyaXB0IHBsdXMgYXQgbGVhc3Qgb25lIGZpbGUgb3BlcmFuZCBzdGlsbCBmb2xsb3cgaXQgKHRoZSBCU0RcbiAqIHNlcGFyYXRlLXN1ZmZpeCByZWFkaW5nOyBHTlUncyBhdHRhY2hlZC1vbmx5IHJlYWRpbmcgb3RoZXJ3aXNlKS4gQVxuICogc2NyaXB0LXNoYXBlZCB3b3JkIGlzIHRoZSBzY3JpcHQgdW5kZXIgR05VJ3MgcmVhZGluZzogYHNlZCAtaSBzL2EvYi8gZiBnYFxuICogd291bGQgb3RoZXJ3aXNlIHN0ZWFsIHRoZSBmaXJzdCBmaWxlIG9wZXJhbmQgYXMgYSBzdWZmaXggYW5kIHNpbGVudGx5IG1pc3NcbiAqIGl0cyB3cml0ZSAodGhlIG11bHRpLWZpbGUtc2VkIG1pc3BhcnNlKS4gQW4gYXR0YWNoZWQgb3IgZGlzYW1iaWd1YXRlZFxuICogc3VmZml4IGlzIGEgYmFja3VwOiBhIG5vbi1lbXB0eSBzdWZmaXggZW1pdHMgYW4gYWRkaXRpb25hbCBjcmVhdGUtb3ZlcndyaXRlXG4gKiB0b3VjaCBvbiBgPGZpbGU+PFNVRkZJWD5gOyBhbiBlbXB0eSBzdWZmaXggKHdoaWNoIHRoZSBxdW90ZS1hd2FyZSB0b2tlbml6ZXJcbiAqIGRyb3BzIGVudGlyZWx5IFx1MjAxNCBgc2VkIC1pICcnIGZgIGFuZCBgc2VkIC1pIGZgIHRva2VuaXplIGFsaWtlKSBjcmVhdGVzIG5vXG4gKiBiYWNrdXAuXG4gKlxuICogVGhlIHNjcmlwdCBpcyB0aGUgc2NyaXB0IGFyZ3VtZW50IHBsdXMgZXZlcnkgYC1lYCBhcmd1bWVudCwgc3BsaXQgb24gYDtgLlxuICogU2VnbWVudHMgdGhhdCBhcmUgYWxsIG51bWVyaWMtYWRkcmVzc2VkIHN1YnN0aXR1dGlvbnMgeWllbGQgdGhlIGV4YWN0IHJhbmdlXG4gKiBbbWluIHN0YXJ0LCBtaW4obWF4IGVuZCwgRU9GKV0gKHBlciBmaWxlLCBFT0YgZnJvbSB0aGUgcG9zdC1lZGl0IGNvdW50KTtcbiAqIHNlZ21lbnRzIHRoYXQgYXJlIGFsbCBzdWJzdGl0dXRpb25zIFx1MjAxNCBhbnkgbnVtZXJpYy91bmFkZHJlc3NlZCBtaXggXHUyMDE0IGFyZVxuICogc3RpbGwgbGluZS1jb3VudC1wcmVzZXJ2aW5nLCBzbyB0aGUgd2hvbGUgZmlsZSBpcyBhZGRyZXNzZWQgKFsxLCBFT0ZdKTtcbiAqIGFueSBjb3VudC1jaGFuZ2luZywgcGF0dGVybi1hZGRyZXNzZWQsIHN0ZXAsIG9yIGAkYC1hZGRyZXNzZWQgc2VnbWVudCBpcyBhXG4gKiB3aG9sZS1maWxlIG1vZGlmeSB3aXRoIG5vIHJhbmdlLiBBbiBhYnNlbnQgc2NyaXB0IChubyBzY3JpcHQgYXJndW1lbnQsIG5vXG4gKiBgLWVgKSBpcyB1bnJlc29sdmVkLlxuICovXG4vKipcbiAqIEEgd29yZCB0aGF0IGNhbiBvbmx5IGJlIGEgc2VkIHNjcmlwdCwgbmV2ZXIgYSBCU0Qgc2VwYXJhdGUgc3VmZml4OiBhIHNlZFxuICogY29tbWFuZCBsZXR0ZXIgKGBzYC9geWAvYGRgL1x1MjAyNiksIG9yIGFuIGFkZHJlc3Mgc3RhcnQgKGRpZ2l0LCBgL2AsIGBcXGAsIGAkYCxcbiAqIGB+YCkuIFRoZSBtdWx0aS1maWxlIGZvcm0gYHNlZCAtaSBzL2EvYi8gZiBnYCBwdXRzIHRoZSBzY3JpcHQgaW1tZWRpYXRlbHlcbiAqIGFmdGVyIGJhcmUgYC1pYCAoR05VJ3MgcmVhZGluZzsgdGhlIEJTRCByZWFkaW5nIG5lZWRzIGEgc2VwYXJhdGUgc3VmZml4XG4gKiB3b3JkIGZpcnN0LCBhbmQgYSBsZXR0ZXItbGVhZGluZyBvciBhZGRyZXNzLWxlYWRpbmcgd29yZCBpcyBub3Qgb25lKS5cbiAqL1xuY29uc3QgU0VEX1NDUklQVF9TSEFQRSA9IC9eKD86W0EtWmEtel18XFxkfFxcL3xcXFxcfFxcJHx+KS87XG5cbmZ1bmN0aW9uIG1hdGNoU2VkSW5wbGFjZUFyZ3MoXG4gIGFyZ3M6IHN0cmluZ1tdLFxuICBkaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGxldCBzdWZmaXg6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBsZXQgc2F3SW5wbGFjZSA9IGZhbHNlO1xuICBsZXQgaSA9IDA7XG4gIGNvbnN0IGVTY3JpcHRzOiBzdHJpbmdbXSA9IFtdO1xuICAvLyBUaGUgc2NyaXB0L2ZpbGUgc3BsaXQgb2YgdGhlIHBvc2l0aW9uYWxzIGlzIGRlcml2ZWQgYWZ0ZXIgdGhlIHNjYW46IHRoZVxuICAvLyBmaXJzdCBwb3NpdGlvbmFsIGlzIHRoZSBzY3JpcHQgYXJndW1lbnQgb25seSB3aGVuIG5vIGAtZWAgc2NyaXB0IGV4aXN0cyBcdTIwMTRcbiAgLy8gd2l0aCBgLWVgIHByZXNlbnQgZXZlcnkgcG9zaXRpb25hbCBpcyBhIGZpbGUgKEdOVSBzZWQgcmVhZHMgdGhlIHNjcmlwdFxuICAvLyBmcm9tIGAtZWAgdGhlbiwgbm90IGZyb20gdGhlIGZpcnN0IHBvc2l0aW9uYWwpLlxuICBjb25zdCBwb3NpdGlvbmFsczogc3RyaW5nW10gPSBbXTtcbiAgLy8gRmlsZXMgcHVzaGVkIG91dHNpZGUgdGhlIHBvc2l0aW9uYWwgcGF0aDogYHNlZCAtaSBmYCAoc2NyaXB0IGFic2VudCkuXG4gIGNvbnN0IGZpbGVzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgYWZ0ZXJEYXNoRGFzaCA9IGZhbHNlO1xuXG4gIHdoaWxlIChpIDwgYXJncy5sZW5ndGgpIHtcbiAgICBjb25zdCBhID0gYXJnc1tpXTtcbiAgICBpZiAoYWZ0ZXJEYXNoRGFzaCkge1xuICAgICAgcG9zaXRpb25hbHMucHVzaChhKTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctbicpIHtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1lJykge1xuICAgICAgY29uc3QgdiA9IGFyZ3NbaSArIDFdO1xuICAgICAgaWYgKHYgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAnc2VkLWlucGxhY2UnLCBhLCAndGhlIC1lIGZsYWcgaXMgbGVmdCB2YWx1ZWxlc3MnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgZVNjcmlwdHMucHVzaCh2KTtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1pJykge1xuICAgICAgc2F3SW5wbGFjZSA9IHRydWU7XG4gICAgICBjb25zdCB3ID0gYXJnc1tpICsgMV07XG4gICAgICBpZiAodyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIC8vIGBzZWQgLWlgIHdpdGggbm90aGluZyBhZnRlcjogbm8gc3VmZml4LCBubyBzY3JpcHQgXHUyMDE0IHRoZSBhYnNlbnQtc2NyaXB0XG4gICAgICAgIC8vIGNoZWNrIGJlbG93IHJlc29sdmVzIHRoaXMgdW5yZXNvbHZlZC5cbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmICh3LnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgICAvLyBUaGUgd29yZCBhZnRlciAtaSBpcyBhbiBvcHRpb24sIG5ldmVyIGEgc3VmZml4LlxuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgcmVzdEFmdGVyID0gYXJncy5zbGljZShpICsgMik7XG4gICAgICBpZiAocmVzdEFmdGVyLmxlbmd0aCA+PSAyICYmICFTRURfU0NSSVBUX1NIQVBFLnRlc3QodykpIHtcbiAgICAgICAgLy8gVGhlIEJTRCBzZXBhcmF0ZS1zdWZmaXggcmVhZGluZzogdyBpcyB0aGUgc3VmZml4LCBhbmQgYSBzY3JpcHQgcGx1c1xuICAgICAgICAvLyBhdCBsZWFzdCBvbmUgZmlsZSBvcGVyYW5kIHN0aWxsIGZvbGxvdyBcdTIwMTQgb25seSBmb3IgYSBzdWZmaXgtc2hhcGVkXG4gICAgICAgIC8vIHdvcmQgKGAuYmFrYCwgYCcnYCkuIEEgc2NyaXB0LXNoYXBlZCB3b3JkIGlzIHRoZSBzY3JpcHQgdW5kZXIgR05VJ3NcbiAgICAgICAgLy8gcmVhZGluZywgc28gYHNlZCAtaSBzL2EvYi8gZiBnYCB0cmVhdHMgYHMvYS9iL2AgYXMgdGhlIHNjcmlwdCBhbmRcbiAgICAgICAgLy8gYm90aCBmIGFuZCBnIGFzIGZpbGVzLlxuICAgICAgICBzdWZmaXggPSB3O1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKHJlc3RBZnRlci5sZW5ndGggPT09IDApIHtcbiAgICAgICAgLy8gYHNlZCAtaSBmYDogdyBpcyB0aGUgbGFzdCB0b2tlbiBcdTIwMTQgbm8gc2NyaXB0IGNhbiBmb2xsb3csIHNvIHcgaXMgdGhlXG4gICAgICAgIC8vIGZpbGUgb3BlcmFuZCB3aXRoIHRoZSBzY3JpcHQgYWJzZW50IChHTlUgaW5zdGVhZCByZWFkcyB3IGFzIGEgc2NyaXB0XG4gICAgICAgIC8vIGFuZCBlcnJvcnM7IGVpdGhlciB3YXkgdGhlIGVkaXQgZG9lcyBub3QgaGFwcGVuKS5cbiAgICAgICAgZmlsZXMucHVzaCh3KTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIC8vIE9uZSB0b2tlbiBhZnRlciB3OiB3IGlzIHRoZSBzY3JpcHQgYXJndW1lbnQgKG9yIGEgZmlsZSwgd2hlbiBgLWVgXG4gICAgICAvLyBzY3JpcHRzIGFyZSBwcmVzZW50KSBhbmQgdGhlIHRva2VuIGlzIGEgZmlsZSBcdTIwMTQgY29uc3VtZSBib3RoLCBzb1xuICAgICAgLy8gbmVpdGhlciBmYWxscyB0aHJvdWdoIHRvIHRoZSBwb3NpdGlvbmFsIHBhdGggYWdhaW4uXG4gICAgICBwb3NpdGlvbmFscy5wdXNoKHcsIHJlc3RBZnRlclswXSk7XG4gICAgICBpICs9IDM7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLWknKSAmJiBhLmxlbmd0aCA+IDIpIHtcbiAgICAgIHNhd0lucGxhY2UgPSB0cnVlO1xuICAgICAgc3VmZml4ID0gYS5zbGljZSgyKTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIHtcbiAgICAgIC8vIFVua25vd24gb3B0aW9uIFx1MjAxNCBuZXZlciBhIHNjcmlwdCBvciBmaWxlLlxuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIHBvc2l0aW9uYWxzLnB1c2goYSk7XG4gICAgaSArPSAxO1xuICB9XG5cbiAgaWYgKCFzYXdJbnBsYWNlKSByZXR1cm47IC8vIG5vdCBhbiBpbi1wbGFjZSBlZGl0IGF0IGFsbFxuICBjb25zdCBzY3JpcHRBcmcgPSBlU2NyaXB0cy5sZW5ndGggPT09IDAgPyAocG9zaXRpb25hbHNbMF0gPz8gbnVsbCkgOiBudWxsO1xuICBpZiAoc2NyaXB0QXJnICE9PSBudWxsKSBmaWxlcy5wdXNoKC4uLnBvc2l0aW9uYWxzLnNsaWNlKDEpKTtcbiAgZWxzZSBmaWxlcy5wdXNoKC4uLnBvc2l0aW9uYWxzKTtcbiAgY29uc3Qgc2VnbWVudHM6IHN0cmluZ1tdID0gW107XG4gIGlmIChzY3JpcHRBcmcgIT09IG51bGwpIHNlZ21lbnRzLnB1c2goLi4uc2NyaXB0QXJnLnNwbGl0KCc7JykpO1xuICBmb3IgKGNvbnN0IHMgb2YgZVNjcmlwdHMpIHNlZ21lbnRzLnB1c2goLi4ucy5zcGxpdCgnOycpKTtcbiAgaWYgKHNlZ21lbnRzLmxlbmd0aCA9PT0gMCkge1xuICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdzZWQtaW5wbGFjZScsIGZpbGVzWzBdID8/ICdzZWQnLCAnbm8gc2NyaXB0IChhYnNlbnQgb3IgZW1wdHkgc2NyaXB0IGFyZ3VtZW50KScpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIFNlZ21lbnQgY2xhc3NpZmljYXRpb246IGV4YWN0IHdoZW4gZXZlcnkgc2VnbWVudCBpcyBhIG51bWVyaWMtYWRkcmVzc2VkXG4gIC8vIHN1YnN0aXR1dGlvbjsgZXhwbGljaXQgd2hvbGUtZmlsZSBbMSwgRU9GXSB3aGVuIGV2ZXJ5IHNlZ21lbnQgaXMgc3RpbGwgYVxuICAvLyBzdWJzdGl0dXRpb24gKGFueSB1bmFkZHJlc3NlZC9udW1lcmljIG1peCk7IG5vIHJhbmdlIG90aGVyd2lzZS5cbiAgbGV0IGFsbE51bWVyaWMgPSB0cnVlO1xuICBsZXQgYWxsU3Vic3RpdHV0aW9uID0gdHJ1ZTtcbiAgbGV0IG1pblN0YXJ0ID0gSW5maW5pdHk7XG4gIGxldCBtYXhFbmQgPSAwO1xuICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc2VnbWVudHMpIHtcbiAgICBjb25zdCBtID0gc2VnbWVudC5tYXRjaChOVU1FUklDX1NVQlNUSVRVVElPTik7XG4gICAgaWYgKG0gPT09IG51bGwpIHtcbiAgICAgIGFsbE51bWVyaWMgPSBmYWxzZTtcbiAgICAgIGlmICghVU5SRVNUUklDVEVEX1NVQlNUSVRVVElPTi50ZXN0KHNlZ21lbnQpKSBhbGxTdWJzdGl0dXRpb24gPSBmYWxzZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBzID0gTnVtYmVyLnBhcnNlSW50KG1bMV0sIDEwKTtcbiAgICBjb25zdCBlID0gbVsyXSA9PT0gdW5kZWZpbmVkID8gcyA6IE51bWJlci5wYXJzZUludChtWzJdLCAxMCk7XG4gICAgbWluU3RhcnQgPSBNYXRoLm1pbihtaW5TdGFydCwgcyk7XG4gICAgbWF4RW5kID0gTWF0aC5tYXgobWF4RW5kLCBlKTtcbiAgfVxuXG4gIGZvciAoY29uc3QgZiBvZiBmaWxlcykge1xuICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShmKSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3NlZC1pbnBsYWNlJywgZiwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVBhdGgoZGlyLCBmKTtcbiAgICBpZiAoYWxsTnVtZXJpYyB8fCBhbGxTdWJzdGl0dXRpb24pIHtcbiAgICAgIGNvbnN0IHRvdGFsID0gY291bnRGaWxlTGluZXMoYWJzb2x1dGVQYXRoKTtcbiAgICAgIGlmICh0b3RhbCA9PT0gbnVsbCkge1xuICAgICAgICBwdXNoVW5yZXNvbHZlZChcbiAgICAgICAgICByZXN1bHRzLFxuICAgICAgICAgICdzZWQtaW5wbGFjZScsXG4gICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICdjb3VsZCBub3QgZGV0ZXJtaW5lIGVuZC1vZi1maWxlIGxpbmUgY291bnQgKGZpbGUgdW5yZWFkYWJsZSwgZW1wdHksIG9yIG1pc3NpbmcpJ1xuICAgICAgICApO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHN0YXJ0ID0gYWxsTnVtZXJpYyA/IG1pblN0YXJ0IDogMTtcbiAgICAgIGNvbnN0IGVuZCA9IGFsbE51bWVyaWMgPyBNYXRoLm1pbihtYXhFbmQsIHRvdGFsKSA6IHRvdGFsO1xuICAgICAgaWYgKHN0YXJ0ID4gZW5kKSBjb250aW51ZTsgLy8gdGhlIGFkZHJlc3NlZCByYW5nZSBsaWVzIGJleW9uZCBFT0YgXHUyMDE0IG5vdGhpbmcgaXMgbW9kaWZpZWRcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgaWRpb206ICdzZWQtaW5wbGFjZScsXG4gICAgICAgIHNwYW46IHsgb3BlcmF0aW9uOiAnbW9kaWZ5JywgbGluZVN0YXJ0OiBzdGFydCwgbGluZUVuZDogZW5kLCBhYnNvbHV0ZVBhdGgsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogJ3NlZC1pbnBsYWNlJyxcbiAgICAgICAgc3BhbjogeyBvcGVyYXRpb246ICdtb2RpZnknLCBhYnNvbHV0ZVBhdGgsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgICB9KTtcbiAgICB9XG4gICAgaWYgKHN1ZmZpeCAhPT0gbnVsbCAmJiBzdWZmaXggIT09ICcnKSB7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiAnc2VkLWlucGxhY2UnLFxuICAgICAgICBzcGFuOiB7IG9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnLCBhYnNvbHV0ZVBhdGg6IGAke2Fic29sdXRlUGF0aH0ke3N1ZmZpeH1gLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgICAgfSk7XG4gICAgfVxuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVGhlIHBhdGNoIC8gZ2l0IGFwcGx5IGdyYW1tYXIgKHBsYW4gXHUwMEE3NS43KS4gUGF0Y2ggdGV4dCBzb3VyY2VzLCBpbiBvcmRlciBvZlxuLy8gcmVjb2duaXRpb246IGEgbGl0ZXJhbCBwYXRjaC1maWxlIG9wZXJhbmQgKGBnaXQgYXBwbHkgPGZpbGU+YCBcdTIwMTQgYSBgcGF0Y2hgXG4vLyBvcGVyYW5kIGlzIGEgdGFyZ2V0IGZpbGUsIG5vdCBhIHNvdXJjZSwgYW5kIGlzIGlnbm9yZWQpLCB0aGUgc3RkaW4gYDxgXG4vLyBzb3VyY2UgKGBwYXRjaCAtcE4gPCBmaWxlYCwgYGdpdCBhcHBseSAtIDwgZmlsZWApLCBvciBhIGhlcmVkb2MgYm9keVxuLy8gKGNsYXNzaWZ5UGF0Y2hIZXJlZG9jLCBcdTAwQTc1LjIpLiBSZWFkLW9ubHkgbW9kZXMgKGAtLWNoZWNrYC9gLS1zdGF0YC9cbi8vIGAtLW51bXN0YXRgL2AtLXN1bW1hcnlgLCBgcGF0Y2ggLS1kcnktcnVuYCkgYW5kIGluZGV4LW9ubHkgYC0tY2FjaGVkYCB0b3VjaFxuLy8gbm90aGluZzsgYC0tZGlyZWN0b3J5YCBmYWlscyBjbG9zZWQgKGl0IHJld3JpdGVzIHBhdGNoIHBhdGhzKS4gQSBjb21tYW5kXG4vLyB3aXRoIG5vIHN0YXRpY2FsbHkga25vd24gc291cmNlIChwaXBlZCBvciB0ZXJtaW5hbCBzdGRpbiwgYSB2YXJpYWJsZSBwYXRjaFxuLy8gcGF0aCkgaXMgdW5yZXNvbHZlZC4gVGFyZ2V0cyBhbmQgcmFuZ2VzIGNvbWUgZnJvbSB0aGUgbmV3XG4vLyByYW5nZS1wcmVzZXJ2aW5nIHVuaWZpZWQtZGlmZiBwYXJzZXIgKHVuaWZpZWQtZGlmZi50cykuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFRoZSBzaGFyZWQgYHBhdGNoYC9gZ2l0IGFwcGx5YCBvcHRpb24gc3VyZmFjZSAocGxhbiBcdTAwQTc1LjcpOiBzdHJpcCBsZXZlbCwgcmVhZC1vbmx5IGFuZCBpbmRleC1vbmx5IG1vZGVzLCBgLS1kaXJlY3RvcnlgLCBhbmQgb3BlcmFuZHMuICovXG5pbnRlcmZhY2UgUGF0Y2hBcHBseVBhcnRzIHtcbiAgc3RyaXA6IFBhdGhTdHJpcDtcbiAgcmVhZE9ubHk6IGJvb2xlYW47XG4gIGNhY2hlZE9ubHk6IGJvb2xlYW47XG4gIGRpcmVjdG9yeTogYm9vbGVhbjtcbiAgb3BlcmFuZHM6IHN0cmluZ1tdO1xufVxuXG5mdW5jdGlvbiBwYXRjaEFwcGx5UGFydHMoYXJnczogc3RyaW5nW10sIGlzR2l0QXBwbHk6IGJvb2xlYW4pOiBQYXRjaEFwcGx5UGFydHMge1xuICBsZXQgc3RyaXA6IFBhdGhTdHJpcCA9IGlzR2l0QXBwbHkgPyAxIDogJ2F1dG8nO1xuICBsZXQgcmVhZE9ubHkgPSBmYWxzZTtcbiAgbGV0IGNhY2hlZE9ubHkgPSBmYWxzZTtcbiAgbGV0IGRpcmVjdG9yeSA9IGZhbHNlO1xuICBjb25zdCBvcGVyYW5kczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBhcmdzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFyZ3NbaV07XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpc0dpdEFwcGx5KSB7XG4gICAgICBpZiAoYSA9PT0gJy0tY2hlY2snIHx8IGEgPT09ICctLXN0YXQnIHx8IGEgPT09ICctLW51bXN0YXQnIHx8IGEgPT09ICctLXN1bW1hcnknKSB7XG4gICAgICAgIHJlYWRPbmx5ID0gdHJ1ZTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYSA9PT0gJy0tY2FjaGVkJykge1xuICAgICAgICBjYWNoZWRPbmx5ID0gdHJ1ZTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYSA9PT0gJy0taW5kZXgnIHx8IGEgPT09ICctUicgfHwgYSA9PT0gJy0tcmV2ZXJzZScgfHwgYSA9PT0gJy0tdW5zYWZlLXBhdGhzJyB8fCBhID09PSAnLS1yZWplY3QnKSBjb250aW51ZTtcbiAgICAgIGlmIChhID09PSAnLS1kaXJlY3RvcnknKSB7XG4gICAgICAgIGRpcmVjdG9yeSA9IHRydWU7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGEuc3RhcnRzV2l0aCgnLS1kaXJlY3Rvcnk9JykpIHtcbiAgICAgICAgZGlyZWN0b3J5ID0gdHJ1ZTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYSA9PT0gJy1wJykge1xuICAgICAgICBjb25zdCB2ID0gYXJnc1tpICsgMV07XG4gICAgICAgIGlmICh2ICE9PSB1bmRlZmluZWQgJiYgL15cXGQrJC8udGVzdCh2KSkge1xuICAgICAgICAgIHN0cmlwID0gTnVtYmVyLnBhcnNlSW50KHYsIDEwKTtcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgIH1cbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoL14tcFxcZCskLy50ZXN0KGEpKSB7XG4gICAgICAgIHN0cmlwID0gTnVtYmVyLnBhcnNlSW50KGEuc2xpY2UoMiksIDEwKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlO1xuICAgICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBwYXRjaFxuICAgIGlmIChhID09PSAnLS1kcnktcnVuJykge1xuICAgICAgcmVhZE9ubHkgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLU4nIHx8IGEgPT09ICctLWZvcndhcmQnKSBjb250aW51ZTtcbiAgICBpZiAoYSA9PT0gJy1wJykge1xuICAgICAgY29uc3QgdiA9IGFyZ3NbaSArIDFdO1xuICAgICAgaWYgKHYgIT09IHVuZGVmaW5lZCAmJiAvXlxcZCskLy50ZXN0KHYpKSB7XG4gICAgICAgIHN0cmlwID0gTnVtYmVyLnBhcnNlSW50KHYsIDEwKTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgvXi1wXFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgIHN0cmlwID0gTnVtYmVyLnBhcnNlSW50KGEuc2xpY2UoMiksIDEwKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlO1xuICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gIH1cbiAgcmV0dXJuIHsgc3RyaXAsIHJlYWRPbmx5LCBjYWNoZWRPbmx5LCBkaXJlY3RvcnksIG9wZXJhbmRzIH07XG59XG5cbi8qKiBUaGUgcGF0Y2ggdGV4dCBhdCBgYWJzb2x1dGVQYXRoYCwgb3IgbnVsbCB3aGVuIGl0IGNhbid0IGJlIHJlYWQuICovXG5mdW5jdGlvbiByZWFkUGF0Y2hGaWxlKGFic29sdXRlUGF0aDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHJlYWRGaWxlU3luYyhhYnNvbHV0ZVBhdGgsICd1dGY4Jyk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbi8qKlxuICogRW1pdCB0aGUgd3JpdGUgdG91Y2hlcyBmb3IgYSBgcGF0Y2hgL2BnaXQgYXBwbHlgIGNvbW1hbmQgd2l0aCBhIHN0YXRpY2FsbHlcbiAqIGtub3duIHBhdGNoLXRleHQgc291cmNlLiBgdGFyZ2V0RGlyYCBpcyB3aGVyZSB0aGUgcGF0Y2gncyB0YXJnZXQgcGF0aHNcbiAqIHJlc29sdmUgKHRoZSBnaXQgYC1DYCBkaXJlY3RvcnkgZm9yIGBnaXQgYXBwbHlgLCB0aGUgY3VycmVudCBkaXJlY3RvcnlcbiAqIG90aGVyd2lzZSk7IGBzaGVsbERpcmAgaXMgd2hlcmUgdGhlIHNoZWxsJ3Mgc3RkaW4gYDxgIHJlZGlyZWN0IHRhcmdldFxuICogcmVzb2x2ZXMgXHUyMDE0IGEgcmVkaXJlY3QgaXMgc2hlbGwtc2lkZSwgc28gYGdpdCAtQ2AgbmV2ZXIgYWZmZWN0cyBpdC5cbiAqL1xuZnVuY3Rpb24gZW1pdFBhdGNoVGFyZ2V0cyhcbiAgYXJnczogc3RyaW5nW10sXG4gIGlzR2l0QXBwbHk6IGJvb2xlYW4sXG4gIGhvc3Q6IHN0cmluZyxcbiAgdGFyZ2V0RGlyOiBzdHJpbmcsXG4gIHNoZWxsRGlyOiBzdHJpbmcsXG4gIHJlZGlyZWN0czogUmVkaXJlY3RJbmZvW10sXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCBwYXJ0cyA9IHBhdGNoQXBwbHlQYXJ0cyhhcmdzLCBpc0dpdEFwcGx5KTtcbiAgaWYgKHBhcnRzLnJlYWRPbmx5IHx8IHBhcnRzLmNhY2hlZE9ubHkpIHJldHVybjsgLy8gcmVhZC1vbmx5IC8gaW5kZXgtb25seSBcdTIwMTQgbm8gdG91Y2hlc1xuICBpZiAocGFydHMuZGlyZWN0b3J5KSB7XG4gICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgJy0tZGlyZWN0b3J5JywgJy0tZGlyZWN0b3J5IHJld3JpdGVzIHBhdGNoIHBhdGhzJyk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgbGV0IHBhdGNoVGV4dDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCBzb3VyY2U6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAvLyAxLiBBIGxpdGVyYWwgcGF0Y2gtZmlsZSBvcGVyYW5kIChnaXQgYXBwbHkgb25seTsgYSBwYXRjaCBvcGVyYW5kIGlzIGFcbiAgLy8gICAgdGFyZ2V0IGZpbGUsIG5vdCBhIHNvdXJjZSBcdTIwMTQgaWdub3JlZCkuXG4gIGlmIChpc0dpdEFwcGx5KSB7XG4gICAgY29uc3Qgb3BlcmFuZCA9IHBhcnRzLm9wZXJhbmRzLmZpbmQoKG8pID0+IG8gIT09ICctJyk7XG4gICAgaWYgKG9wZXJhbmQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKG9wZXJhbmQpKSB7XG4gICAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsIG9wZXJhbmQsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBzb3VyY2UgPSByZXNvbHZlUGF0aCh0YXJnZXREaXIsIG9wZXJhbmQpO1xuICAgICAgcGF0Y2hUZXh0ID0gcmVhZFBhdGNoRmlsZShzb3VyY2UpO1xuICAgICAgaWYgKHBhdGNoVGV4dCA9PT0gbnVsbCkge1xuICAgICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCBzb3VyY2UsICdwYXRjaCBmaWxlIHVucmVhZGFibGUgb3IgbWlzc2luZycpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuICB9XG4gIC8vIDIuIFRoZSBzdGRpbiBgPGAgc291cmNlIChwYXRjaCBhbmQgZ2l0IGFwcGx5KS5cbiAgaWYgKHBhdGNoVGV4dCA9PT0gbnVsbCkge1xuICAgIGNvbnN0IHN0ZGluID0gcmVkaXJlY3RzLmZpbmQoKHIpID0+IHIub3AgPT09ICc8Jyk7XG4gICAgaWYgKHN0ZGluICE9PSB1bmRlZmluZWQgJiYgc3RkaW4udGFyZ2V0ICE9PSBudWxsKSB7XG4gICAgICBpZiAobG9va3NVbnJlc29sdmFibGUoc3RkaW4udGFyZ2V0KSkge1xuICAgICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCBzdGRpbi50YXJnZXQsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBzb3VyY2UgPSByZXNvbHZlUGF0aChzaGVsbERpciwgc3RkaW4udGFyZ2V0KTtcbiAgICAgIHBhdGNoVGV4dCA9IHJlYWRQYXRjaEZpbGUoc291cmNlKTtcbiAgICAgIGlmIChwYXRjaFRleHQgPT09IG51bGwpIHtcbiAgICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgc291cmNlLCAncGF0Y2ggdGV4dCB1bnJlYWRhYmxlIG9yIG1pc3NpbmcnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICAvLyAzLiBObyBzdGF0aWNhbGx5IGtub3duIHNvdXJjZTogc3RkaW4gaXMgZHluYW1pYyAodGVybWluYWwsIHBpcGUsIHZhcmlhYmxlKS5cbiAgaWYgKHBhdGNoVGV4dCA9PT0gbnVsbCkge1xuICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsIGhvc3QsICdubyBzdGF0aWNhbGx5IGtub3duIHBhdGNoIHRleHQgc291cmNlIChzdGRpbiBpcyBkeW5hbWljKScpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IHRhcmdldHMgPSBwYXJzZVVuaWZpZWREaWZmUmFuZ2UocGF0Y2hUZXh0LCBwYXJ0cy5zdHJpcCk7XG4gIGlmICh0YXJnZXRzID09PSBudWxsKSB7XG4gICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgc291cmNlID8/IGhvc3QsICdtYWxmb3JtZWQgb3IgZW1wdHkgcGF0Y2ggdGV4dCcpO1xuICAgIHJldHVybjtcbiAgfVxuICBmb3IgKGNvbnN0IHQgb2YgdGFyZ2V0cykge1xuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgdC5wYXRoLCB0YXJnZXREaXIpO1xuICAgIGlmIChhYnNvbHV0ZVBhdGggPT09IG51bGwpIGNvbnRpbnVlO1xuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogJ3BhdGNoLXdyaXRlJyxcbiAgICAgIHNwYW46IHtcbiAgICAgICAgb3BlcmF0aW9uOiB0Lm9wZXJhdGlvbixcbiAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgIGpvaW4sXG4gICAgICAgIC4uLih0LmxpbmVTdGFydCAhPT0gdW5kZWZpbmVkID8geyBsaW5lU3RhcnQ6IHQubGluZVN0YXJ0LCBsaW5lRW5kOiB0LmxpbmVFbmQgfSA6IHt9KVxuICAgICAgfVxuICAgIH0pO1xuICB9XG59XG5cbi8qKlxuICogVGhlIHBhdGNoL2dpdCBhcHBseSBncmFtbWFyIGluIHRoZSBtYWluIHdhbGs6IGBwYXRjaGAgcmVhZHMgcGF0Y2ggdGV4dCBmcm9tXG4gKiBzdGRpbiBvciBhIGA8YCByZWRpcmVjdDsgYGdpdCBhcHBseWAgYWRkaXRpb25hbGx5IGFjY2VwdHMgYSBwYXRjaC1maWxlXG4gKiBvcGVyYW5kIGFuZCByZXNvbHZlcyB0YXJnZXRzIGFnYWluc3QgaXRzIGAtQ2AgZGlyZWN0b3J5LiBBIHdyYXBwZWRcbiAqIGBwYXRjaGAvYGFwcGx5YCBpcyB1bnJlc29sdmVkIFx1MjAxNCB0aGUgd3JhcHBlciBvYnNjdXJlcyB0aGUgYXJndi5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hQYXRjaEFwcGx5KFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgcmVkaXJlY3RzOiBSZWRpcmVjdEluZm9bXSxcbiAgZGlyRm9yUmVzb2x1dGlvbjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcmVzdCA9IHN0cmlwVHJhbnNwYXJlbnRXcmFwcGVyKGFyZ3YpO1xuICBpZiAocmVzdC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgY29uc3QgY29tbWFuZCA9IHJlc3RbMF07XG4gIGlmIChjb21tYW5kID09PSAncGF0Y2gnKSB7XG4gICAgZW1pdFBhdGNoVGFyZ2V0cyhcbiAgICAgIHJlc3Quc2xpY2UoMSksXG4gICAgICBmYWxzZSxcbiAgICAgICdwYXRjaCcsXG4gICAgICBkaXJGb3JSZXNvbHV0aW9uLFxuICAgICAgZGlyRm9yUmVzb2x1dGlvbixcbiAgICAgIHJlZGlyZWN0cyxcbiAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgIGpvaW4sXG4gICAgICByZXN1bHRzXG4gICAgKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGNvbW1hbmQgPT09ICdnaXQnKSB7XG4gICAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQocmVzdC5zbGljZSgxKSk7XG4gICAgaWYgKHN1YiA9PT0gbnVsbCB8fCBzdWIuc3ViY29tbWFuZCAhPT0gJ2FwcGx5JykgcmV0dXJuO1xuICAgIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgJ2FwcGx5JywgJ2dpdCAtQyB0YXJnZXQgY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZScpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBlbWl0UGF0Y2hUYXJnZXRzKFxuICAgICAgcmVzdC5zbGljZSgxKS5zbGljZShzdWIuc3ViSWR4ICsgMSksXG4gICAgICB0cnVlLFxuICAgICAgJ2FwcGx5JyxcbiAgICAgIHN1Yi5jRGlyID8/IGRpckZvclJlc29sdXRpb24sXG4gICAgICBkaXJGb3JSZXNvbHV0aW9uLFxuICAgICAgcmVkaXJlY3RzLFxuICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgam9pbixcbiAgICAgIHJlc3VsdHNcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoRk9SRUlHTl9XUkFQUEVSUy5oYXMoY29tbWFuZCkpIHtcbiAgICBjb25zdCB3cmFwcGVkID0gcmVzdFsxXTtcbiAgICBpZiAod3JhcHBlZCA9PT0gJ3BhdGNoJyB8fCB3cmFwcGVkID09PSAnYXBwbHknKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCB3cmFwcGVkLCBgdGhlICR7Y29tbWFuZH0gd3JhcHBlciBvYnNjdXJlcyB0aGUgJHt3cmFwcGVkfSBhcmd2YCk7XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogVGhlIGhlcmVkb2MgcGF0Y2gtdGV4dCBncmFtbWFyIChwbGFuIFx1MDBBNzUuNyk6IGEgYHBhdGNoYC9gZ2l0IGFwcGx5YCBoZXJlZG9jXG4gKiBib2R5IGlzIHBhdGNoIHRleHQuIFRoZSBvcGVuZXIncyBvd24gb3B0aW9ucyBzdGlsbCBhcHBseSBcdTIwMTQgYC0tZHJ5LXJ1bmAvXG4gKiBgLS1jaGVja2AvYC0tc3RhdGAvYC0tbnVtc3RhdGAvYC0tc3VtbWFyeWAvYC0tY2FjaGVkYCBtYWtlIHRoZSBib2R5XG4gKiByZWFkLW9ubHkgKG5vIHRvdWNoZXMpLCBgLS1kaXJlY3RvcnlgIGZhaWxzIGNsb3NlZCwgYW5kIGAtcE5gIHNldHMgdGhlXG4gKiBoZWFkZXIgc3RyaXAgbGV2ZWwuXG4gKi9cbmZ1bmN0aW9uIGNsYXNzaWZ5UGF0Y2hIZXJlZG9jKFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgYm9keTogc3RyaW5nLFxuICBjdXJyZW50RGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCByZXN0ID0gc3RyaXBUcmFuc3BhcmVudFdyYXBwZXIoYXJndik7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICBjb25zdCBjb21tYW5kID0gcmVzdFswXTtcbiAgbGV0IGlzR2l0QXBwbHkgPSBmYWxzZTtcbiAgbGV0IGFyZ3M6IHN0cmluZ1tdO1xuICBsZXQgZGlyID0gY3VycmVudERpcjtcbiAgaWYgKGNvbW1hbmQgPT09ICdwYXRjaCcpIHtcbiAgICBhcmdzID0gcmVzdC5zbGljZSgxKTtcbiAgfSBlbHNlIGlmIChjb21tYW5kID09PSAnZ2l0Jykge1xuICAgIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKHJlc3Quc2xpY2UoMSkpO1xuICAgIGlmIChzdWIgPT09IG51bGwgfHwgc3ViLnN1YmNvbW1hbmQgIT09ICdhcHBseScpIHJldHVybjtcbiAgICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsICdhcHBseScsICdnaXQgLUMgdGFyZ2V0IGNvbnRhaW5zIGFuIHVucmVzb2x2ZWQgc2hlbGwgdmFyaWFibGUnKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaXNHaXRBcHBseSA9IHRydWU7XG4gICAgYXJncyA9IHJlc3Quc2xpY2UoMSkuc2xpY2Uoc3ViLnN1YklkeCArIDEpO1xuICAgIGRpciA9IHN1Yi5jRGlyID8/IGN1cnJlbnREaXI7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHBhcnRzID0gcGF0Y2hBcHBseVBhcnRzKGFyZ3MsIGlzR2l0QXBwbHkpO1xuICBpZiAocGFydHMucmVhZE9ubHkgfHwgcGFydHMuY2FjaGVkT25seSkgcmV0dXJuO1xuICBpZiAocGFydHMuZGlyZWN0b3J5KSB7XG4gICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgJy0tZGlyZWN0b3J5JywgJy0tZGlyZWN0b3J5IHJld3JpdGVzIHBhdGNoIHBhdGhzJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHRhcmdldHMgPSBwYXJzZVVuaWZpZWREaWZmUmFuZ2UoYm9keSwgcGFydHMuc3RyaXApO1xuICBpZiAodGFyZ2V0cyA9PT0gbnVsbCkge1xuICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsICdoZXJlZG9jJywgJ21hbGZvcm1lZCBvciBlbXB0eSBwYXRjaCB0ZXh0Jyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGZvciAoY29uc3QgdCBvZiB0YXJnZXRzKSB7XG4gICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVRhcmdldChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCB0LnBhdGgsIGRpcik7XG4gICAgaWYgKGFic29sdXRlUGF0aCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiAncGF0Y2gtd3JpdGUnLFxuICAgICAgc3Bhbjoge1xuICAgICAgICBvcGVyYXRpb246IHQub3BlcmF0aW9uLFxuICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgam9pbixcbiAgICAgICAgLi4uKHQubGluZVN0YXJ0ICE9PSB1bmRlZmluZWQgPyB7IGxpbmVTdGFydDogdC5saW5lU3RhcnQsIGxpbmVFbmQ6IHQubGluZUVuZCB9IDoge30pXG4gICAgICB9XG4gICAgfSk7XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUaGUgZm9ybWF0dGVyIC8gZml4ZXIgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjgpOiBhIHRhYmxlLWRyaXZlbiBmYW1pbHkgb3ZlciB0aGVcbi8vIGNvcnB1cy1kZXJpdmVkIDE2LXRvb2wgc2V0LiBGbGFnIG1hdGNoaW5nIGlzIGV4YWN0LXRva2VuIG9uIGZ1bGwgYXJndiB3b3JkcyBcdTIwMTRcbi8vIG5ldmVyIHByZWZpeCBvciBzdWJzdHJpbmcgXHUyMDE0IGFuZCB0aGUgcmVhZC1vbmx5IGxpc3QgaXMgY29uc3VsdGVkIGZpcnN0LCBzb1xuLy8gYC0tZml4LWRyeS1ydW5gIGNhbiBuZXZlciBjb2xsaWRlIHdpdGggYC0tZml4YCBhbmQgYGJsYWNrIC0tY2hlY2tgIG5ldmVyXG4vLyBoZWFscy4gVG9vbHMgd2hvc2Ugd3JpdGUgZm9ybSBpcyBhIGJhcmUgaW52b2NhdGlvbiAoYmxhY2ssIGlzb3J0LCBydXN0Zm10KVxuLy8gY2FycnkgdGhlIGVtcHR5IGZvcm0gYW5kIGZpcmUgb24gdGhlIHdyaXRlIGZvcm0gaXRzZWxmLiBMZWFkaW5nIHRyYW5zcGFyZW50XG4vLyBwYWNrYWdlLXJ1bm5lciB3cmFwcGVycyAobnB4LCB5YXJuLCBwbnBtIGV4ZWMvZGx4LCBidW54LCBucG0gZXhlYykgc3RyaXBcbi8vIHVuZGVyIGEgcGlubmVkIG9wdGlvbiBncmFtbWFyOyBhIHdyYXBwZXIgdGhhdCBjb3VsZCByZXdyaXRlIGFyZ3YgZmFpbHNcbi8vIGNsb3NlZCBhcyB1bnJlc29sdmVkLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBPbmUgXHUwMEE3NS44IHRhYmxlIHJvdzogdGhlIHRvb2wgY29tbWFuZCBhbmQgaXRzIHdyaXRlL3JlYWQtb25seSB0b2tlbiBmb3Jtcy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRm9ybWF0dGVyVG9vbFJvdyB7XG4gIGNvbW1hbmQ6IHN0cmluZztcbiAgLyoqIFRva2VuIHNlcXVlbmNlcyB3aG9zZSBleGFjdC10b2tlbiBwcmVzZW5jZSBtYXJrcyB0aGUgaW52b2NhdGlvbiBhIHdyaXRlLiAqL1xuICB3cml0ZUZvcm1zOiBzdHJpbmdbXVtdO1xuICAvKiogVG9rZW4gc2VxdWVuY2VzIGNvbnN1bHRlZCBmaXJzdCBcdTIwMTQgcHJlc2VuY2Ugc3VwcHJlc3NlcyB0aGUgd3JpdGUgKHRoZSByZWFkLW9ubHkgbW9kZSB3aW5zKS4gKi9cbiAgcmVhZE9ubHlGb3Jtczogc3RyaW5nW11bXTtcbn1cblxuLyoqXG4gKiBUaGUgXHUwMEE3NS44IHRhYmxlLCBleHBvcnRlZCBzbyB0aGUgY29ycHVzLWNvdmVyYWdlIGZpeHR1cmUgY2FuIGFzc2VydCB0d28tc2lkZWRcbiAqIHRvb2wtc2V0IGVxdWFsaXR5IGFuZCBwZXItdG9vbCByZWFkLW9ubHkgc3VwcHJlc3Npb24gKHBsYW4gXHUwMEE3NS44LCBQaGFzZSAzXG4gKiBzdGVwIDgpLlxuICovXG5leHBvcnQgY29uc3QgRk9STUFUVEVSX1RBQkxFOiByZWFkb25seSBGb3JtYXR0ZXJUb29sUm93W10gPSBbXG4gIHtcbiAgICBjb21tYW5kOiAncHJldHRpZXInLFxuICAgIHdyaXRlRm9ybXM6IFtbJy0td3JpdGUnXSwgWyctdyddXSxcbiAgICByZWFkT25seUZvcm1zOiBbWyctLWNoZWNrJ10sIFsnLS1saXN0LWRpZmZlcmVudCddLCBbJy0tZGVidWctY2hlY2snXV1cbiAgfSxcbiAgeyBjb21tYW5kOiAnZXNsaW50Jywgd3JpdGVGb3JtczogW1snLS1maXgnXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy0tZml4LWRyeS1ydW4nXV0gfSxcbiAge1xuICAgIGNvbW1hbmQ6ICdiaW9tZScsXG4gICAgd3JpdGVGb3JtczogW1xuICAgICAgWydjaGVjaycsICctLXdyaXRlJ10sXG4gICAgICBbJ2NoZWNrJywgJy0tZml4J10sXG4gICAgICBbJ2Zvcm1hdCcsICctLXdyaXRlJ11cbiAgICBdLFxuICAgIHJlYWRPbmx5Rm9ybXM6IFtdXG4gIH0sXG4gIHsgY29tbWFuZDogJ2dvZm10Jywgd3JpdGVGb3JtczogW1snLXcnXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy1sJ11dIH0sXG4gIHsgY29tbWFuZDogJ2dvaW1wb3J0cycsIHdyaXRlRm9ybXM6IFtbJy13J11dLCByZWFkT25seUZvcm1zOiBbXSB9LFxuICB7IGNvbW1hbmQ6ICdjbGFuZy1mb3JtYXQnLCB3cml0ZUZvcm1zOiBbWyctaSddXSwgcmVhZE9ubHlGb3JtczogW1snLS1kcnktcnVuJ11dIH0sXG4gIHsgY29tbWFuZDogJ3NoZm10Jywgd3JpdGVGb3JtczogW1snLXcnXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy1kJ11dIH0sXG4gIHsgY29tbWFuZDogJ3lhcGYnLCB3cml0ZUZvcm1zOiBbWyctaSddXSwgcmVhZE9ubHlGb3JtczogW1snLS1kaWZmJ11dIH0sXG4gIHsgY29tbWFuZDogJ2F1dG9wZXA4Jywgd3JpdGVGb3JtczogW1snLWknXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy1kJ10sIFsnLS1kaWZmJ11dIH0sXG4gIHsgY29tbWFuZDogJ2JsYWNrJywgd3JpdGVGb3JtczogW1tdXSwgcmVhZE9ubHlGb3JtczogW1snLS1jaGVjayddLCBbJy0tZGlmZiddXSB9LFxuICB7IGNvbW1hbmQ6ICdpc29ydCcsIHdyaXRlRm9ybXM6IFtbXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy0tY2hlY2stb25seSddLCBbJy0tZGlmZiddXSB9LFxuICB7XG4gICAgY29tbWFuZDogJ3J1ZmYnLFxuICAgIHdyaXRlRm9ybXM6IFtbJ2Zvcm1hdCddLCBbJ2NoZWNrJywgJy0tZml4J11dLFxuICAgIHJlYWRPbmx5Rm9ybXM6IFtcbiAgICAgIFsnY2hlY2snLCAnLS1uby1maXgnXSxcbiAgICAgIFsnZm9ybWF0JywgJy0tY2hlY2snXVxuICAgIF1cbiAgfSxcbiAgeyBjb21tYW5kOiAnZGVubycsIHdyaXRlRm9ybXM6IFtbJ2ZtdCddXSwgcmVhZE9ubHlGb3JtczogW1snZm10JywgJy0tY2hlY2snXV0gfSxcbiAgeyBjb21tYW5kOiAnZHByaW50Jywgd3JpdGVGb3JtczogW1snZm10J11dLCByZWFkT25seUZvcm1zOiBbWydjaGVjayddXSB9LFxuICB7IGNvbW1hbmQ6ICdydXN0Zm10Jywgd3JpdGVGb3JtczogW1tdXSwgcmVhZE9ubHlGb3JtczogW1snLS1jaGVjayddLCBbJy0tZW1pdCcsICdzdGRvdXQnXV0gfSxcbiAge1xuICAgIGNvbW1hbmQ6ICd0ZXJyYWZvcm0nLFxuICAgIHdyaXRlRm9ybXM6IFtbJ2ZtdCddXSxcbiAgICByZWFkT25seUZvcm1zOiBbXG4gICAgICBbJ2ZtdCcsICctY2hlY2snXSxcbiAgICAgIFsnZm10JywgJy1kaWZmJ11cbiAgICBdXG4gIH1cbl07XG5cbi8qKiBUaGUgcGlubmVkIHBhY2thZ2UtcnVubmVyIG5vLWFyZyBmbGFncyAocGxhbiBcdTAwQTc1LjgpOiBmbGFncyB0aGF0IGNhbm5vdCBtb3ZlIG9yIHJld3JpdGUgYXJndi4gKi9cbmNvbnN0IFJVTk5FUl9OT19BUkdfRkxBR1MgPSBuZXcgU2V0KFsnLXknLCAnLS15ZXMnLCAnLS1uby1pbnN0YWxsJ10pO1xuXG4vKiogVGhlIG91dGNvbWUgb2Ygc3RyaXBwaW5nIG9uZSBsZWFkaW5nIHBhY2thZ2UtcnVubmVyIHdyYXBwZXIuICovXG50eXBlIFJ1bm5lclN0cmlwID0geyBraW5kOiAnc3RyaXBwZWQnOyBzdHJpcHBlZDogc3RyaW5nW10gfSB8IHsga2luZDogJ29ic2N1cmVkJyB9O1xuXG4vKipcbiAqIFN0cmlwIG9uZSBsZWFkaW5nIHRyYW5zcGFyZW50IHBhY2thZ2UtcnVubmVyIHdyYXBwZXIgKHBsYW4gXHUwMEE3NS44KTogYG5weGAsXG4gKiBgeWFybmAsIGBwbnBtIGV4ZWNgL2BwbnBtIGRseGAsIGBidW54YCwgYW5kIGBucG0gZXhlY2AgZm9sbG93ZWQgZGlyZWN0bHkgYnlcbiAqIHRoZSB3cmFwcGVkIGNvbW1hbmQgd29yZCwgd2l0aCBvbmx5IHRoZSBwaW5uZWQgbm8tYXJnIGZsYWdzIChgLXlgL2AtLXllc2AsXG4gKiBgLS1uby1pbnN0YWxsYCkgYW5kIGBucG0gZXhlY2AncyBgLS1gIHRlcm1pbmF0b3IgYmV0d2Vlbi4gQSBzdHJpbmctZm9ybVxuICogYXJndW1lbnQgKGBucHggXCJwcmV0dGllciAtLXdyaXRlIGZcImApLCBhbiBhcmd2LWFsdGVyaW5nIHJ1bm5lciBmbGFnXG4gKiAoYC0tcGFja2FnZT1YYCBvciBhIGZsYWcgY29uc3VtaW5nIHRoZSBuZXh0IHdvcmQpLCBvciBhIHdyYXBwZXIgd29yZCB0aGF0IGlzXG4gKiBpdHNlbGYgYSBzY3JpcHQgKGAuYC1wcmVmaXhlZCkgb2JzY3VyZXMgdGhlIHdyYXBwZWQgYXJndiBcdTIwMTQgdGhlIHdyYXBwZXIgaXNcbiAqIHRyYW5zcGFyZW50IG9ubHkgd2hlbiB0aGUgcGlubmVkIGdyYW1tYXIgcHJvdmVzIGl0IHNvLiBSZXR1cm5zICdub3QtcnVubmVyJ1xuICogd2hlbiB0aGUgd29yZCBpcyBub3QgYSBydW5uZXIgYXQgYWxsIChhIGRpZmZlcmVudCBucG0vcG5wbSBzdWJjb21tYW5kLCBvciBhXG4gKiBiYXJlIHJ1bm5lciB3aXRoIG5vIGNvbW1hbmQgd29yZCkgXHUyMDE0IHRoZSB0YWJsZSBtYXRjaGVzIGl0IGRpcmVjdGx5LCB3aGljaFxuICogZmFpbHMgY2xvc2VkIGZvciBub24tZm9ybWF0dGVyIHJ1bm5lcnMuXG4gKi9cbmZ1bmN0aW9uIHN0cmlwUGFja2FnZVJ1bm5lcihhcmd2OiBzdHJpbmdbXSk6IFJ1bm5lclN0cmlwIHwgJ25vdC1ydW5uZXInIHtcbiAgY29uc3QgcnVubmVyID0gYXJndlswXTtcbiAgbGV0IHJlc3QgPSBhcmd2LnNsaWNlKDEpO1xuICBpZiAocnVubmVyID09PSAnbnB4JyB8fCBydW5uZXIgPT09ICd5YXJuJyB8fCBydW5uZXIgPT09ICdidW54Jykge1xuICAgIC8vIFRoZXNlIHJ1bm5lcnMgdGFrZSB0aGUgY29tbWFuZCB3b3JkIGRpcmVjdGx5LlxuICB9IGVsc2UgaWYgKHJ1bm5lciA9PT0gJ3BucG0nKSB7XG4gICAgaWYgKHJlc3RbMF0gIT09ICdleGVjJyAmJiByZXN0WzBdICE9PSAnZGx4JykgcmV0dXJuICdub3QtcnVubmVyJztcbiAgICByZXN0ID0gcmVzdC5zbGljZSgxKTtcbiAgfSBlbHNlIGlmIChydW5uZXIgPT09ICducG0nKSB7XG4gICAgaWYgKHJlc3RbMF0gIT09ICdleGVjJykgcmV0dXJuICdub3QtcnVubmVyJztcbiAgICByZXN0ID0gcmVzdC5zbGljZSgxKTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gJ25vdC1ydW5uZXInO1xuICB9XG4gIHdoaWxlIChSVU5ORVJfTk9fQVJHX0ZMQUdTLmhhcyhyZXN0WzBdKSkgcmVzdCA9IHJlc3Quc2xpY2UoMSk7XG4gIGlmIChydW5uZXIgPT09ICducG0nICYmIHJlc3RbMF0gPT09ICctLScpIHJlc3QgPSByZXN0LnNsaWNlKDEpO1xuICBpZiAocmVzdC5sZW5ndGggPT09IDApIHJldHVybiAnbm90LXJ1bm5lcic7IC8vIGEgYmFyZSBydW5uZXIgYXR0cmlidXRlcyBub3RoaW5nXG4gIGNvbnN0IHdyYXBwZWQgPSByZXN0WzBdO1xuICBpZiAod3JhcHBlZC5zdGFydHNXaXRoKCctJykgfHwgd3JhcHBlZC5zdGFydHNXaXRoKCcuJykgfHwgL1xccy8udGVzdCh3cmFwcGVkKSkgcmV0dXJuIHsga2luZDogJ29ic2N1cmVkJyB9O1xuICByZXR1cm4geyBraW5kOiAnc3RyaXBwZWQnLCBzdHJpcHBlZDogcmVzdCB9O1xufVxuXG4vKipcbiAqIFRoZSBmb3JtYXR0ZXIvZml4ZXIgZmFtaWx5IChwbGFuIFx1MDBBNzUuOCkuIFRoZSByZWFkLW9ubHkgZm9ybXMgYXJlIGNvbnN1bHRlZFxuICogZmlyc3QgYW5kIHdpbiBvdmVyIGFueSB3cml0ZSBmb3JtOyBhIHdyaXRlIGZvcm0gd2l0aCBubyByZWFkLW9ubHkgZm9ybSBhbmRcbiAqIGV2ZXJ5IG9wZXJhbmQgYW4gZXhwbGljaXQgZmlsZSBlbWl0cyBhIHdob2xlLWZpbGUgYG1vZGlmeWAgcGVyIG9wZXJhbmQ7XG4gKiBkaXJlY3RvcnkvZ2xvYi9uby1vcGVyYW5kIGludm9jYXRpb25zIHRvdWNoIG5vdGhpbmc7IHVua25vd24gZXhlY3V0YWJsZXNcbiAqIGZhaWwgY2xvc2VkLiBBIGZvcm0ncyBsZWFkaW5nIHN1YmNvbW1hbmQgd29yZCAoYGNoZWNrYC9gZm9ybWF0YC9gZm10YCkgaXNcbiAqIHBvc2l0aW9uYWwgXHUyMDE0IGl0IG11c3QgbGVhZCB0aGUgdG9vbCdzIGFyZ3MsIHNvIGBkZW5vIHRhc2sgZm10YCBpcyBhIHNjcmlwdFxuICogcnVubmVyLCBub3QgYSBmb3JtYXR0ZXIuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoRm9ybWF0dGVyKFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgZGlyRm9yUmVzb2x1dGlvbjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcmVzdCA9IHN0cmlwVHJhbnNwYXJlbnRXcmFwcGVyKGFyZ3YpO1xuICBpZiAocmVzdC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgbGV0IHdvcmRzID0gcmVzdDtcbiAgY29uc3Qgc3RyaXAgPSBzdHJpcFBhY2thZ2VSdW5uZXIocmVzdCk7XG4gIGlmIChzdHJpcCA9PT0gJ25vdC1ydW5uZXInKSB7XG4gICAgLy8gcmVzdFswXSBpcyBub3QgYSBwYWNrYWdlIHJ1bm5lciBcdTIwMTQgdGhlIHRhYmxlIG1hdGNoZXMgaXQgZGlyZWN0bHkuXG4gIH0gZWxzZSBpZiAoc3RyaXAua2luZCA9PT0gJ29ic2N1cmVkJykge1xuICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdmb3JtYXR0ZXItd3JpdGUnLCByZXN0WzBdLCBgdGhlICR7cmVzdFswXX0gd3JhcHBlciBvYnNjdXJlcyB0aGUgd3JhcHBlZCBhcmd2YCk7XG4gICAgcmV0dXJuO1xuICB9IGVsc2Uge1xuICAgIHdvcmRzID0gc3RyaXAuc3RyaXBwZWQ7XG4gIH1cbiAgaWYgKEZPUkVJR05fV1JBUFBFUlMuaGFzKHdvcmRzWzBdKSkge1xuICAgIGNvbnN0IHdyYXBwZWQgPSB3b3Jkc1sxXTtcbiAgICBpZiAod3JhcHBlZCAhPT0gdW5kZWZpbmVkICYmIEZPUk1BVFRFUl9UQUJMRS5zb21lKChyKSA9PiByLmNvbW1hbmQgPT09IHdyYXBwZWQpKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAnZm9ybWF0dGVyLXdyaXRlJywgd3JhcHBlZCwgYHRoZSAke3dvcmRzWzBdfSB3cmFwcGVyIG9ic2N1cmVzIHRoZSAke3dyYXBwZWR9IGFyZ3ZgKTtcbiAgICB9XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHJvdyA9IEZPUk1BVFRFUl9UQUJMRS5maW5kKChyKSA9PiByLmNvbW1hbmQgPT09IHdvcmRzWzBdKTtcbiAgaWYgKHJvdyA9PT0gdW5kZWZpbmVkKSByZXR1cm47IC8vIHVua25vd24gZXhlY3V0YWJsZSBcdTIwMTQgZmFpbCBjbG9zZWQsIG5vIHRvdWNoXG4gIGNvbnN0IGFyZ3MgPSB3b3Jkcy5zbGljZSgxKTtcbiAgY29uc3QgZm9ybVByZXNlbnQgPSAoZm9ybTogc3RyaW5nW10pOiBib29sZWFuID0+IHtcbiAgICBjb25zdCBmaXJzdCA9IGZvcm1bMF07XG4gICAgaWYgKGZpcnN0ICE9PSB1bmRlZmluZWQgJiYgIWZpcnN0LnN0YXJ0c1dpdGgoJy0nKSAmJiBhcmdzWzBdICE9PSBmaXJzdCkgcmV0dXJuIGZhbHNlO1xuICAgIHJldHVybiBmb3JtLmV2ZXJ5KCh0b2tlbikgPT4gYXJncy5pbmNsdWRlcyh0b2tlbikpO1xuICB9O1xuICAvLyBUaGUgcmVhZC1vbmx5IGxpc3QgaXMgY29uc3VsdGVkIGZpcnN0IGFuZCB3aW5zIG92ZXIgYW55IHdyaXRlIGZvcm06XG4gIC8vIGBlc2xpbnQgLS1maXggLS1maXgtZHJ5LXJ1biBmYCB3cml0ZXMgbm90aGluZywgYGJsYWNrIC0tY2hlY2sgZmAgbmV2ZXIgaGVhbHMuXG4gIGlmIChyb3cucmVhZE9ubHlGb3Jtcy5zb21lKGZvcm1QcmVzZW50KSkgcmV0dXJuO1xuICBpZiAoIXJvdy53cml0ZUZvcm1zLnNvbWUoZm9ybVByZXNlbnQpKSByZXR1cm47IC8vIGJhcmUgaW52b2NhdGlvbnMgb2YgZmxhZy1yZXF1aXJlZCB0b29scyBhcmUgcmVhZC1vbmx5IChzdGRvdXQvbGludClcbiAgLy8gQ29uc3VtZSB0aGUgdG9vbCdzIHN1YmNvbW1hbmQgd29yZCBiZWZvcmUgY29sbGVjdGluZyBvcGVyYW5kcy5cbiAgY29uc3Qgc3ViY29tbWFuZFdvcmRzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGZvciAoY29uc3QgZm9ybSBvZiByb3cud3JpdGVGb3Jtcykge1xuICAgIGZvciAoY29uc3QgdG9rZW4gb2YgZm9ybSkge1xuICAgICAgaWYgKCF0b2tlbi5zdGFydHNXaXRoKCctJykpIHN1YmNvbW1hbmRXb3Jkcy5hZGQodG9rZW4pO1xuICAgIH1cbiAgfVxuICBjb25zdCBhZnRlclN1YmNvbW1hbmQgPSBzdWJjb21tYW5kV29yZHMuaGFzKGFyZ3NbMF0pID8gYXJncy5zbGljZSgxKSA6IGFyZ3M7XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG4gIGNvbnN0IG9wZXJhbmRzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGEgb2YgYWZ0ZXJTdWJjb21tYW5kKSB7XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7IC8vIHVua25vd24gb3B0aW9uIFx1MjE5MiB0cmVhdGVkIGFzIGFuIG9wdGlvbiAoc2hhcmVkIFx1MDBBNzUpXG4gICAgb3BlcmFuZHMucHVzaChhKTtcbiAgfVxuICBpZiAob3BlcmFuZHMubGVuZ3RoID09PSAwKSByZXR1cm47IC8vIG5vLW9wZXJhbmQgaW52b2NhdGlvbnMgdG91Y2ggbm90aGluZ1xuICAvLyBFdmVyeSBvcGVyYW5kIG11c3QgYmUgYW4gZXhwbGljaXQgZmlsZSBcdTIwMTQgYSBnbG9iLCB2YXJpYWJsZSwgZGlyZWN0b3J5LCBvclxuICAvLyB0cmFpbGluZy1zbGFzaCBvcGVyYW5kIGZhaWxzIHRoZSB3aG9sZSBjb21tYW5kIGNsb3NlZC5cbiAgZm9yIChjb25zdCBvcGVyYW5kIG9mIG9wZXJhbmRzKSB7XG4gICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKG9wZXJhbmQpKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAnZm9ybWF0dGVyLXdyaXRlJywgb3BlcmFuZCwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmIChvcGVyYW5kLmVuZHNXaXRoKCcvJykgfHwgaXNFeGlzdGluZ0RpcmVjdG9yeShyZXNvbHZlUGF0aChkaXJGb3JSZXNvbHV0aW9uLCBvcGVyYW5kKSkpIHJldHVybjtcbiAgfVxuICBmb3IgKGNvbnN0IG9wZXJhbmQgb2Ygb3BlcmFuZHMpIHtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206ICdmb3JtYXR0ZXItd3JpdGUnLFxuICAgICAgc3BhbjogeyBvcGVyYXRpb246ICdtb2RpZnknLCBhYnNvbHV0ZVBhdGg6IHJlc29sdmVQYXRoKGRpckZvclJlc29sdXRpb24sIG9wZXJhbmQpLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgIH0pO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVGhlIGdpdCByZXN0b3JlIC8gZ2l0IGNoZWNrb3V0IGdyYW1tYXIgKHBsYW4gXHUwMEE3NS45KSwgdGhlIGxhc3QgcHVyZS1wYXJzZXJcbi8vIGZhbWlseS4gUmVzdG9yZSBoYXMgbm8gcmV2aXNpb24gb3BlcmFuZCBmb3JtIFx1MjAxNCBpdHMgcG9zaXRpb25hbCBhcmdzIGFyZVxuLy8gYWx3YXlzIHBhdGhzcGVjczsgY2hlY2tvdXQgc2tpcHMgYSBwcmUtYC0tYCByZXZpc2lvbi9yZWYgb3BlcmFuZCBhbmQgdGFrZXNcbi8vIHBhdGhzcGVjcyBvbmx5IGFmdGVyIGAtLWAuIEV2ZXJ5IGV4cGxpY2l0LWZpbGUgcGF0aHNwZWMgaXMgYSB3aG9sZS1maWxlXG4vLyBjcmVhdGUtb3ZlcndyaXRlIHRvdWNoOyBhIGRpcmVjdG9yeS1zaGFwZWQgcGF0aHNwZWMgKGAuYC9gLi5gLCB0cmFpbGluZyBgL2AsXG4vLyBvciBhIHBhdGggdGhhdCBzdGF0cyBhcyBhIGRpcmVjdG9yeSksIGAtLXN0YWdlZGAtb25seSByZXN0b3JlLCBhbmRcbi8vIGAtcGAvYC0tcGF0Y2hgIGludGVyYWN0aXZlIGh1bmsgc2VsZWN0aW9uIGFsbCBmYWlsIGNsb3NlZC5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogZ2l0IHJlc3RvcmUgbm8tdmFsdWUgZmxhZ3MgKHBsYW4gXHUwMEE3NS45KTsgYC1zYC9gLS1zb3VyY2VgLCBgLS1zdGFnZWRgLCBgLVdgL2AtLXdvcmt0cmVlYCwgYC1tYC9gLS1tZXJnZWAsIGFuZCBgLXBgL2AtLXBhdGNoYCBhcmUgaGFuZGxlZCBleHBsaWNpdGx5LiAqL1xuY29uc3QgUkVTVE9SRV9OT19WQUxVRSA9IG5ldyBTZXQoWyctcScsICctZicsICctdSddKTtcblxuLyoqXG4gKiBUaGUgc2hhcmVkIHJlc3RvcmUvY2hlY2tvdXQgcGF0aHNwZWMgZW1pc3Npb24gKHBsYW4gXHUwMEE3NS45KTogYW4gZXhwbGljaXQtZmlsZVxuICogcGF0aHNwZWMgKG5vIGdsb2JzLCBubyBgLmAvYC4uYCwgbm8gZGlyZWN0b3J5LCBubyB0cmFpbGluZyBgL2ApIGlzIGFcbiAqIGNyZWF0ZS1vdmVyd3JpdGUgd2hvbGUtZmlsZSB0b3VjaDsgYSBkaXJlY3Rvcnktc2hhcGVkIHBhdGhzcGVjIGlzXG4gKiB1bnJlc29sdmVkIFx1MjAxNCBhIGRpcmVjdG9yeSByZXN0b3JlL2NoZWNrb3V0IHJld3JpdGVzIGFyYml0cmFyeSBmaWxlcyBiZW5lYXRoXG4gKiBpdCBhbmQgY2Fubm90IGJlIGF0dHJpYnV0ZWQgdG8gYSBmaWxlIHdyaXRlLlxuICovXG5mdW5jdGlvbiBlbWl0UmVzdG9yZUNoZWNrb3V0UGF0aHNwZWMoXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdLFxuICBpZGlvbTogJ2dpdC1yZXN0b3JlLXdyaXRlJyB8ICdnaXQtY2hlY2tvdXQtd3JpdGUnLFxuICBvcGVyYW5kOiBzdHJpbmcsXG4gIGRpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ11cbik6IHZvaWQge1xuICBpZiAobG9va3NVbnJlc29sdmFibGUob3BlcmFuZCkpIHtcbiAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCBpZGlvbSwgb3BlcmFuZCwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVQYXRoKGRpciwgb3BlcmFuZCk7XG4gIGlmIChvcGVyYW5kID09PSAnLicgfHwgb3BlcmFuZCA9PT0gJy4uJyB8fCBvcGVyYW5kLmVuZHNXaXRoKCcvJykgfHwgaXNFeGlzdGluZ0RpcmVjdG9yeShhYnNvbHV0ZVBhdGgpKSB7XG4gICAgcHVzaFVucmVzb2x2ZWQoXG4gICAgICByZXN1bHRzLFxuICAgICAgaWRpb20sXG4gICAgICBvcGVyYW5kLFxuICAgICAgJ2RpcmVjdG9yeS1zaGFwZWQgcGF0aHNwZWMgcmV3cml0ZXMgYXJiaXRyYXJ5IGZpbGVzIGJlbmVhdGggaXQgXHUyMDE0IG5vdCBhdHRyaWJ1dGFibGUgdG8gYSBmaWxlIHdyaXRlJ1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIHJlc3VsdHMucHVzaCh7XG4gICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgIGlkaW9tLFxuICAgIHNwYW46IHsgb3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZScsIGFic29sdXRlUGF0aCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgfSk7XG59XG5cbi8qKlxuICogVGhlIGdpdCByZXN0b3JlIG9wZXJhbmQgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjkpOiBgLXNgL2AtLXNvdXJjZT08dHJlZT5gIGlzXG4gKiB2YWx1ZS10YWtpbmcgXHUyMDE0IHRoZSB0cmVlIG9wZXJhbmQgbmV2ZXIgcmVzb2x2ZXMgYXMgYSBwYXRoc3BlYzsgYC1wYC9gLS1wYXRjaGBcbiAqIGludGVyYWN0aXZlIGh1bmsgc2VsZWN0aW9uIGlzIHVucmVzb2x2ZWQ7IGAtbWAvYC0tbWVyZ2VgICh0aGUgbWVyZ2VcbiAqIG1hY2hpbmVyeSwgY29uZGl0aW9uYWwgb24gdGhlIGluZGV4IGJlaW5nIHVubWVyZ2VkKSBhbmQgYC0tc3RhZ2VkYCB3aXRob3V0XG4gKiBgLS13b3JrdHJlZWAgKGluZGV4LW9ubHkgXHUyMDE0IHRoZSB3b3JraW5nIGZpbGUgc3Vydml2ZXMpIHRvdWNoIG5vdGhpbmcuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoUmVzdG9yZU9wZXJhbmRzKFxuICBhcmdzOiBzdHJpbmdbXSxcbiAgZGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBsZXQgc3RhZ2VkID0gZmFsc2U7XG4gIGxldCB3b3JrdHJlZSA9IGZhbHNlO1xuICBsZXQgYWZ0ZXJEYXNoRGFzaCA9IGZhbHNlO1xuICBjb25zdCBvcGVyYW5kczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBhcmdzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFyZ3NbaV07XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLXAnIHx8IGEgPT09ICctLXBhdGNoJykge1xuICAgICAgcHVzaFVucmVzb2x2ZWQoXG4gICAgICAgIHJlc3VsdHMsXG4gICAgICAgICdnaXQtcmVzdG9yZS13cml0ZScsXG4gICAgICAgIGEsXG4gICAgICAgICdpbnRlcmFjdGl2ZSBwYXRjaCBtb2RlIGFwcGxpZXMgdXNlci1jaG9zZW4gaHVua3MgXHUyMDE0IG5vIHN0YXRpYyBzcGFuJ1xuICAgICAgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctcycgfHwgYSA9PT0gJy0tc291cmNlJykge1xuICAgICAgaSArPSAxOyAvLyB0aGUgdHJlZSBvcGVyYW5kIGlzIG5ldmVyIGEgcGF0aHNwZWNcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctLXNvdXJjZT0nKSkgY29udGludWU7XG4gICAgaWYgKGEgPT09ICctbScgfHwgYSA9PT0gJy0tbWVyZ2UnKSByZXR1cm47XG4gICAgaWYgKGEgPT09ICctLXN0YWdlZCcpIHtcbiAgICAgIHN0YWdlZCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctVycgfHwgYSA9PT0gJy0td29ya3RyZWUnKSB7XG4gICAgICB3b3JrdHJlZSA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKFJFU1RPUkVfTk9fVkFMVUUuaGFzKGEpKSBjb250aW51ZTtcbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlOyAvLyB1bmtub3duIG9wdGlvbiBcdTIxOTIgdHJlYXRlZCBhcyBhbiBvcHRpb24gKGZhaWwgY2xvc2VkKVxuICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gIH1cbiAgaWYgKHN0YWdlZCAmJiAhd29ya3RyZWUpIHJldHVybjsgLy8gaW5kZXgtb25seSByZXN0b3JlIGRvZXMgbm90IHRvdWNoIHRoZSB3b3JraW5nIGZpbGVcbiAgZm9yIChjb25zdCBvcGVyYW5kIG9mIG9wZXJhbmRzKSB7XG4gICAgZW1pdFJlc3RvcmVDaGVja291dFBhdGhzcGVjKHJlc3VsdHMsICdnaXQtcmVzdG9yZS13cml0ZScsIG9wZXJhbmQsIGRpciwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luKTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBnaXQgY2hlY2tvdXQgb3BlcmFuZCBncmFtbWFyIChwbGFuIFx1MDBBNzUuOSk6IGAtYmAvYC1CYC9gLS1vcnBoYW4gPGJyYW5jaD5gXG4gKiBhcmUgdmFsdWUtdGFraW5nIFx1MjAxNCB0aGUgYnJhbmNoIG5hbWUgbmV2ZXIgcmVzb2x2ZXMgYXMgYSBwYXRoc3BlYzsgYC1wYC9cbiAqIGAtLXBhdGNoYCBpbnRlcmFjdGl2ZSBodW5rIHNlbGVjdGlvbiBpcyB1bnJlc29sdmVkOyBhIHByZS1gLS1gIHBvc2l0aW9uYWwgaXNcbiAqIGEgcmV2aXNpb24vcmVmIG9wZXJhbmQgYW5kIGlzIHNraXBwZWQuIFBhdGhzcGVjcyBvbmx5IGFmdGVyIGAtLWAuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoQ2hlY2tvdXRPcGVyYW5kcyhcbiAgYXJnczogc3RyaW5nW10sXG4gIGRpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcbiAgY29uc3Qgb3BlcmFuZHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYXJncy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmdzW2ldO1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1wJyB8fCBhID09PSAnLS1wYXRjaCcpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKFxuICAgICAgICByZXN1bHRzLFxuICAgICAgICAnZ2l0LWNoZWNrb3V0LXdyaXRlJyxcbiAgICAgICAgYSxcbiAgICAgICAgJ2ludGVyYWN0aXZlIHBhdGNoIG1vZGUgYXBwbGllcyB1c2VyLWNob3NlbiBodW5rcyBcdTIwMTQgbm8gc3RhdGljIHNwYW4nXG4gICAgICApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1iJyB8fCBhID09PSAnLUInIHx8IGEgPT09ICctLW9ycGhhbicpIHtcbiAgICAgIGkgKz0gMTsgLy8gdGhlIGJyYW5jaCBuYW1lIGlzIG5ldmVyIGEgcGF0aHNwZWNcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1mJyB8fCBhID09PSAnLXEnIHx8IGEgPT09ICctbScgfHwgYSA9PT0gJy10JykgY29udGludWU7XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTsgLy8gdW5rbm93biBvcHRpb24gXHUyMTkyIHRyZWF0ZWQgYXMgYW4gb3B0aW9uIChmYWlsIGNsb3NlZClcbiAgICAvLyBBIHByZS1gLS1gIHBvc2l0aW9uYWwgaXMgYSByZXZpc2lvbi9yZWYgb3BlcmFuZCBcdTIwMTQgbmV2ZXIgYSBwYXRoc3BlYy5cbiAgfVxuICBmb3IgKGNvbnN0IG9wZXJhbmQgb2Ygb3BlcmFuZHMpIHtcbiAgICBlbWl0UmVzdG9yZUNoZWNrb3V0UGF0aHNwZWMocmVzdWx0cywgJ2dpdC1jaGVja291dC13cml0ZScsIG9wZXJhbmQsIGRpciwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luKTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBnaXQgcmVzdG9yZSAvIGdpdCBjaGVja291dCBmYW1pbHkgKHBsYW4gXHUwMEE3NS45KTogdmlhIGBmaW5kR2l0U3ViY29tbWFuZGBcbiAqIChoYW5kbGVzIGBnaXQgLUNgL2AtY2ApLCB0aGUgdHdvIHN1YmNvbW1hbmRzIHJlc29sdmUgdGhlaXIgcGF0aHNwZWNzIHRvXG4gKiB3aG9sZS1maWxlIGNyZWF0ZS1vdmVyd3JpdGUgdG91Y2hlczsgYSB3cmFwcGVkIHN1YmNvbW1hbmQgZmFpbHMgY2xvc2VkLlxuICovXG5mdW5jdGlvbiBtYXRjaEdpdFJlc3RvcmVDaGVja291dChcbiAgYXJndjogc3RyaW5nW10sXG4gIGRpckZvclJlc29sdXRpb246IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHJlc3QgPSBzdHJpcFRyYW5zcGFyZW50V3JhcHBlcihhcmd2KTtcbiAgaWYgKHJlc3QubGVuZ3RoID09PSAwKSByZXR1cm47XG4gIGNvbnN0IGNvbW1hbmQgPSByZXN0WzBdO1xuICBpZiAoY29tbWFuZCA9PT0gJ2dpdCcpIHtcbiAgICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChyZXN0LnNsaWNlKDEpKTtcbiAgICBpZiAoc3ViID09PSBudWxsIHx8IChzdWIuc3ViY29tbWFuZCAhPT0gJ3Jlc3RvcmUnICYmIHN1Yi5zdWJjb21tYW5kICE9PSAnY2hlY2tvdXQnKSkgcmV0dXJuO1xuICAgIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQoXG4gICAgICAgIHJlc3VsdHMsXG4gICAgICAgIHN1Yi5zdWJjb21tYW5kID09PSAncmVzdG9yZScgPyAnZ2l0LXJlc3RvcmUtd3JpdGUnIDogJ2dpdC1jaGVja291dC13cml0ZScsXG4gICAgICAgIHN1Yi5zdWJjb21tYW5kLFxuICAgICAgICAnZ2l0IC1DIHRhcmdldCBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJ1xuICAgICAgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgZGlyID0gc3ViLmNEaXIgPz8gZGlyRm9yUmVzb2x1dGlvbjtcbiAgICBjb25zdCBhcmdzID0gcmVzdC5zbGljZSgxKS5zbGljZShzdWIuc3ViSWR4ICsgMSk7XG4gICAgaWYgKHN1Yi5zdWJjb21tYW5kID09PSAncmVzdG9yZScpIG1hdGNoUmVzdG9yZU9wZXJhbmRzKGFyZ3MsIGRpciwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luLCByZXN1bHRzKTtcbiAgICBlbHNlIG1hdGNoQ2hlY2tvdXRPcGVyYW5kcyhhcmdzLCBkaXIsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiwgcmVzdWx0cyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChGT1JFSUdOX1dSQVBQRVJTLmhhcyhjb21tYW5kKSkge1xuICAgIGNvbnN0IHdyYXBwZWQgPSByZXN0WzFdO1xuICAgIGlmICh3cmFwcGVkID09PSAncmVzdG9yZScgfHwgd3JhcHBlZCA9PT0gJ2NoZWNrb3V0Jykge1xuICAgICAgcHVzaFVucmVzb2x2ZWQoXG4gICAgICAgIHJlc3VsdHMsXG4gICAgICAgIHdyYXBwZWQgPT09ICdyZXN0b3JlJyA/ICdnaXQtcmVzdG9yZS13cml0ZScgOiAnZ2l0LWNoZWNrb3V0LXdyaXRlJyxcbiAgICAgICAgd3JhcHBlZCxcbiAgICAgICAgYHRoZSAke2NvbW1hbmR9IHdyYXBwZXIgb2JzY3VyZXMgdGhlICR7d3JhcHBlZH0gYXJndmBcbiAgICAgICk7XG4gICAgfVxuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gT3JjaGVzdHJhdG9yXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgTElORV9TRUxFQ1RPUlMgPSBbbWF0Y2hTZWQsIG1hdGNoSGVhZCwgbWF0Y2hUYWlsXTtcblxuLyoqXG4gKiBTcGFuLWxlc3MgY29tbWFuZHMgd2hvc2UgZXhpdCBzdGF0dXMgaXMgZGV0ZXJtaW5pc3RpYyBcdTIwMTQgdXNhYmxlIGFzIGd1YXJkcyBpblxuICogYCYmYC9gfHxgIGpvaW5zIChwbGFuIFx1MDBBNzMgc3RlcCAyJ3Mgc3Bhbi1sZXNzLWd1YXJkIHJ1bGUpOiBgZmFsc2VgIGFsd2F5c1xuICogZXhpdHMgMSwgYHRydWVgIGFuZCBgOmAgYWx3YXlzIDAsIHNvIGEgZm9sbG93aW5nIGpvaW5lZCBjb21tYW5kJ3Mgc2tpcCBpc1xuICoga25vd2FibGUgZXZlbiB0aG91Z2ggbmVpdGhlciBwcm9kdWNlcyBhIHNwYW4uXG4gKi9cbmNvbnN0IEJVSUxUSU5fR1VBUkRfU1RBVFVTID0gbmV3IE1hcDxzdHJpbmcsIDAgfCAxPihbXG4gIFsnZmFsc2UnLCAxXSxcbiAgWyd0cnVlJywgMF0sXG4gIFsnOicsIDBdXG5dKTtcblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQ29tbWFuZERldGFpbGVkKGNvbW1hbmQ6IHN0cmluZywgY3dkOiBzdHJpbmcgPSBwcm9jZXNzLmN3ZCgpKTogU3Bhbk1hdGNoW10ge1xuICBjb25zdCB7IHdyaXRlczogaGVyZWRvY1dyaXRlcywgbWFza2VkIH0gPSBleHRyYWN0SGVyZWRvY1dyaXRlcyhjb21tYW5kKTtcbiAgY29uc3Qgc2ltcGxlQ29tbWFuZHMgPSBzcGxpdFRvcExldmVsKG1hc2tlZCk7XG5cbiAgY29uc3QgcmVzdWx0czogU3Bhbk1hdGNoW10gPSBbXTtcbiAgY29uc3QgZnNMaW5lQ2FjaGUgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyIHwgbnVsbD4oKTtcbiAgY29uc3QgZ2l0TGluZUNhY2hlID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlciB8IG51bGw+KCk7XG5cbiAgY29uc3QgY2FjaGVkRnNUb3RhbExpbmVzID0gKGFic1BhdGg6IHN0cmluZykgPT4gKCkgPT4ge1xuICAgIGlmICghZnNMaW5lQ2FjaGUuaGFzKGFic1BhdGgpKSBmc0xpbmVDYWNoZS5zZXQoYWJzUGF0aCwgY291bnRGaWxlTGluZXMoYWJzUGF0aCkpO1xuICAgIHJldHVybiBmc0xpbmVDYWNoZS5nZXQoYWJzUGF0aCkgPz8gbnVsbDtcbiAgfTtcbiAgY29uc3QgY2FjaGVkR2l0VG90YWxMaW5lcyA9IChnaXRDd2Q6IHN0cmluZywgcmV2OiBzdHJpbmcsIHBhdGg6IHN0cmluZykgPT4gKCkgPT4ge1xuICAgIGNvbnN0IGtleSA9IGAke2dpdEN3ZH1cdTAwMDAke3Jldn1cdTAwMDAke3BhdGh9YDtcbiAgICBpZiAoIWdpdExpbmVDYWNoZS5oYXMoa2V5KSkgZ2l0TGluZUNhY2hlLnNldChrZXksIGNvdW50R2l0QmxvYkxpbmVzKGdpdEN3ZCwgcmV2LCBwYXRoKSk7XG4gICAgcmV0dXJuIGdpdExpbmVDYWNoZS5nZXQoa2V5KSA/PyBudWxsO1xuICB9O1xuXG4gIGxldCBjdXJyZW50RGlyID0gY3dkO1xuICBsZXQgbGFzdFBsYWluRmlsZVNvdXJjZTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIC8vIFRoZSBvbmUtaG9wIGxpdGVyYWwgZWNoby9wcmludGYgcGlwZSBzb3VyY2UgKHBsYW4gXHUwMEE3NS4yKTogc2V0IGF0IHRoZSBlbmQgb2ZcbiAgLy8gZWFjaCBzaW1wbGUgY29tbWFuZCwgY2xlYXJlZCBhdCBhbnkgbm9uLXBpcGUgYm91bmRhcnksIHRocmVhZGVkIGJ5IHRlZSAtYVxuICAvLyBhcHBlbmRzIGluIHRoZSBuZXh0IHBpcGUgc3RhZ2UgKGBlY2hvIHggfCB0ZWUgLWEgZmApLlxuICBsZXQgcGlwZUVjaG9Db250ZW50OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcblxuICAvKiogVGhlIGBqb2luYCBzdGFtcCBmb3IgYSBzaW1wbGUgY29tbWFuZDogb25seSB0aGUgY29uZGl0aW9uYWwgb3BlcmF0b3JzIGdhdGUgKHBsYW4gXHUwMEE3MyBzdGVwIDIpLiAqL1xuICBjb25zdCBqb2luT2YgPSAoc2ltcGxlOiBTaW1wbGVDb21tYW5kKTogUmVzb2x2ZWRTcGFuWydqb2luJ10gPT5cbiAgICBzaW1wbGUucHJlY2VkZWRCeSA9PT0gJyYmJyB8fCBzaW1wbGUucHJlY2VkZWRCeSA9PT0gJ3x8JyA/IHNpbXBsZS5wcmVjZWRlZEJ5IDogdW5kZWZpbmVkO1xuXG4gIGNvbnN0IGVtaXRDYW5kaWRhdGUgPSAoXG4gICAgYzogUmF3Q2FuZGlkYXRlLFxuICAgIGRpckZvclJlc29sdXRpb246IHN0cmluZyxcbiAgICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXVxuICApID0+IHtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUoYy5maWxlQXJnKSkge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiBjLmlkaW9tLFxuICAgICAgICBmaWxlQXJnOiBjLmZpbGVBcmcsXG4gICAgICAgIHJlYXNvbjogJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJ1xuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVQYXRoKGRpckZvclJlc29sdXRpb24sIGMuZmlsZUFyZyk7XG4gICAgY29uc3QgdG90YWxMaW5lcyA9XG4gICAgICBjLnJlc29sdmVyS2luZCA9PT0gJ2ZzJ1xuICAgICAgICA/IGNhY2hlZEZzVG90YWxMaW5lcyhhYnNvbHV0ZVBhdGgpXG4gICAgICAgIDogY2FjaGVkR2l0VG90YWxMaW5lcyhjLmRpck92ZXJyaWRlID8/IGRpckZvclJlc29sdXRpb24sIGMucmVzb2x2ZXJLaW5kLnJldiwgYy5maWxlQXJnKTtcbiAgICBjb25zdCByYW5nZSA9IHJlc29sdmVTcGVjKGMuc3BlYywgdG90YWxMaW5lcyk7XG4gICAgaWYgKHJhbmdlID09PSBudWxsKSB7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgaWRpb206IGMuaWRpb20sXG4gICAgICAgIGZpbGVBcmc6IGFic29sdXRlUGF0aCxcbiAgICAgICAgcmVhc29uOiAnY291bGQgbm90IGRldGVybWluZSBlbmQtb2YtZmlsZSBsaW5lIGNvdW50IChmaWxlIHVucmVhZGFibGUsIGVtcHR5LCBvciBnaXQgcmV2L3BhdGggbm90IGZvdW5kKSdcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206IGMuaWRpb20sXG4gICAgICBzcGFuOiB7XG4gICAgICAgIG9wZXJhdGlvbjogJ3JlYWQnLFxuICAgICAgICBsaW5lU3RhcnQ6IHJhbmdlLmxpbmVTdGFydCxcbiAgICAgICAgbGluZUVuZDogcmFuZ2UubGluZUVuZCxcbiAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgIGpvaW5cbiAgICAgIH1cbiAgICB9KTtcbiAgfTtcblxuICAvKipcbiAgICogVGhlIHJlYWQgaWRpb21zIGZvciBvbmUgc2ltcGxlIGNvbW1hbmQgKHRoZSBleGlzdGluZyBjb3JwdXMgZ3JhbW1hcik6XG4gICAqIHBsYWluIGBjYXRgL2BubGAgc291cmNlcywgdGhlIGxpbmUgc2VsZWN0b3JzLCBhbmQgdGhlIGdpdCBtYXRjaGVycywgd2l0aFxuICAgKiBvbmUtaG9wIHBpcGUtc291cmNlIHByb3BhZ2F0aW9uIGZvciBkb3duc3RyZWFtIGBoZWFkYC9gdGFpbGAvYHNlZCAtbmAuXG4gICAqL1xuICBjb25zdCBtYXRjaFJlYWRzID0gKHNpbXBsZTogU2ltcGxlQ29tbWFuZCwgYXJndjogc3RyaW5nW10sIGk6IG51bWJlcik6IHZvaWQgPT4ge1xuICAgIGxldCBpc1BsYWluU291cmNlID0gZmFsc2U7XG4gICAgbGV0IHBsYWluRmlsZUFyZzogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgaWYgKGFyZ3ZbMF0gPT09ICdjYXQnICYmIGFyZ3YubGVuZ3RoID09PSAyICYmICFhcmd2WzFdLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgaXNQbGFpblNvdXJjZSA9IHRydWU7XG4gICAgICBwbGFpbkZpbGVBcmcgPSBhcmd2WzFdO1xuICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IGhhc1NoZWxsRXhwYW5zaW9uKGFyZ3ZbMV0pID8gbnVsbCA6IHJlc29sdmVQYXRoKGN1cnJlbnREaXIsIGFyZ3ZbMV0pO1xuICAgIH0gZWxzZSBpZiAoYXJndlswXSA9PT0gJ25sJyAmJiBhcmd2Lmxlbmd0aCA+PSAyICYmICFhcmd2W2FyZ3YubGVuZ3RoIC0gMV0uc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICBpc1BsYWluU291cmNlID0gdHJ1ZTtcbiAgICAgIGNvbnN0IGYgPSBhcmd2W2FyZ3YubGVuZ3RoIC0gMV07XG4gICAgICBwbGFpbkZpbGVBcmcgPSBmO1xuICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IGhhc1NoZWxsRXhwYW5zaW9uKGYpID8gbnVsbCA6IHJlc29sdmVQYXRoKGN1cnJlbnREaXIsIGYpO1xuICAgIH1cblxuICAgIC8vIEEgYmFyZSBgY2F0IGZpbGVgL2BubCBmaWxlYCB0aGF0IGlzIG5vdCBmZWVkaW5nIGEgZG93bnN0cmVhbSBwaXBlIHN0YWdlXG4gICAgLy8gcmVhZHMgdGhlIHdob2xlIGZpbGU6IGVtaXQgdGhlIHNhbWUgd2hvbGUtZmlsZSBzcGFuIGBnaXQgc2hvdyByZXY6cGF0aGBcbiAgICAvLyBwcm9kdWNlcy4gV2hlbiBhIHBpcGUgZm9sbG93cywgdGhlIGRvd25zdHJlYW0gbGluZS1zZWxlY3RvciBhbHJlYWR5XG4gICAgLy8gZW1pdHMgdGhlIHByZWNpc2UgcmFuZ2UsIHNvIHRoZSBzb3VyY2Ugc3RheXMgc291cmNlLW9ubHkuXG4gICAgaWYgKHBsYWluRmlsZUFyZyAhPT0gbnVsbCkge1xuICAgICAgY29uc3QgbmV4dCA9IHNpbXBsZUNvbW1hbmRzW2kgKyAxXTtcbiAgICAgIGlmIChuZXh0ID09PSB1bmRlZmluZWQgfHwgbmV4dC5wcmVjZWRlZEJ5ICE9PSAnfCcpIHtcbiAgICAgICAgZW1pdENhbmRpZGF0ZShcbiAgICAgICAgICB7XG4gICAgICAgICAgICBraW5kOiAnY2FuZGlkYXRlJyxcbiAgICAgICAgICAgIGlkaW9tOiBhcmd2WzBdID09PSAnY2F0JyA/ICdjYXQtZmlsZScgOiAnbmwtZmlsZScsXG4gICAgICAgICAgICBmaWxlQXJnOiBwbGFpbkZpbGVBcmcsXG4gICAgICAgICAgICBzcGVjOiB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0OiAxIH0sXG4gICAgICAgICAgICByZXNvbHZlcktpbmQ6ICdmcydcbiAgICAgICAgICB9LFxuICAgICAgICAgIGN1cnJlbnREaXIsXG4gICAgICAgICAgaSxcbiAgICAgICAgICBqb2luT2Yoc2ltcGxlKVxuICAgICAgICApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGxldCBtYXRjaGVkID0gZmFsc2U7XG4gICAgZm9yIChjb25zdCBtYXRjaGVyIG9mIFsuLi5MSU5FX1NFTEVDVE9SUywgbWF0Y2hHaXRTaG93LCBtYXRjaEdpdExvZ0xdKSB7XG4gICAgICBmb3IgKGNvbnN0IG91dGNvbWUgb2YgbWF0Y2hlcihhcmd2KSkge1xuICAgICAgICBtYXRjaGVkID0gdHJ1ZTtcbiAgICAgICAgaWYgKG91dGNvbWUua2luZCA9PT0gJ3VucmVzb2x2ZWQnKSB7XG4gICAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgICAgaWRpb206IG91dGNvbWUuaWRpb20sXG4gICAgICAgICAgICBmaWxlQXJnOiBvdXRjb21lLmZpbGVBcmcsXG4gICAgICAgICAgICByZWFzb246IG91dGNvbWUucmVhc29uXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZW1pdENhbmRpZGF0ZShvdXRjb21lLCBvdXRjb21lLmRpck92ZXJyaWRlID8/IGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpKTtcbiAgICAgICAgICAvLyBgZ2l0IHNob3cgcmV2OnBhdGhgIHByaW50cyB0aGUgYmxvYiB2ZXJiYXRpbSwgc28gKHVubGlrZSBgZ2l0IGxvZyAtTGAsXG4gICAgICAgICAgLy8gd2hpY2ggcHJpbnRzIGRpZmYtZm9ybWF0dGVkIGhpc3RvcnkpIGl0J3MgYSB2YWxpZCBvbmUtaG9wIHBpcGUgc291cmNlXG4gICAgICAgICAgLy8gZm9yIGEgZG93bnN0cmVhbSBsaW5lLXNlbGVjdG9yLCBzYW1lIGFzIGBjYXRgL2BubGAuXG4gICAgICAgICAgaWYgKG91dGNvbWUuaWRpb20gPT09ICdnaXQtc2hvdy1yZXYtcGF0aCcgJiYgIWxvb2tzVW5yZXNvbHZhYmxlKG91dGNvbWUuZmlsZUFyZykpIHtcbiAgICAgICAgICAgIGlzUGxhaW5Tb3VyY2UgPSB0cnVlO1xuICAgICAgICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IHJlc29sdmVQYXRoKG91dGNvbWUuZGlyT3ZlcnJpZGUgPz8gY3VycmVudERpciwgb3V0Y29tZS5maWxlQXJnKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIW1hdGNoZWQgJiYgc2ltcGxlLnByZWNlZGVkQnkgPT09ICd8JyAmJiBsYXN0UGxhaW5GaWxlU291cmNlKSB7XG4gICAgICBjb25zdCB3aXRoRmlsZSA9IFsuLi5hcmd2LCBsYXN0UGxhaW5GaWxlU291cmNlXTtcbiAgICAgIGZvciAoY29uc3QgbWF0Y2hlciBvZiBMSU5FX1NFTEVDVE9SUykge1xuICAgICAgICBmb3IgKGNvbnN0IG91dGNvbWUgb2YgbWF0Y2hlcih3aXRoRmlsZSkpIHtcbiAgICAgICAgICBpZiAob3V0Y29tZS5raW5kID09PSAnY2FuZGlkYXRlJykgZW1pdENhbmRpZGF0ZShvdXRjb21lLCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSk7XG4gICAgICAgICAgZWxzZVxuICAgICAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgICAgIGlkaW9tOiBvdXRjb21lLmlkaW9tLFxuICAgICAgICAgICAgICBmaWxlQXJnOiBvdXRjb21lLmZpbGVBcmcsXG4gICAgICAgICAgICAgIHJlYXNvbjogb3V0Y29tZS5yZWFzb25cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFpc1BsYWluU291cmNlKSBsYXN0UGxhaW5GaWxlU291cmNlID0gbnVsbDtcbiAgfTtcblxuICBmb3IgKGxldCBpID0gMDsgaSA8IHNpbXBsZUNvbW1hbmRzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3Qgc2ltcGxlID0gc2ltcGxlQ29tbWFuZHNbaV07XG5cbiAgICAvLyBBIHBpcGUgc3RhZ2UgbWF5IGluaGVyaXQgdGhlIHByZXZpb3VzIHN0YWdlJ3MgbGl0ZXJhbCBlY2hvIGNvbnRlbnQ7IGFueVxuICAgIC8vIG90aGVyIGJvdW5kYXJ5IGNsZWFycyBpdC5cbiAgICBpZiAoc2ltcGxlLnByZWNlZGVkQnkgIT09ICd8JykgcGlwZUVjaG9Db250ZW50ID0gbnVsbDtcblxuICAgIGNvbnN0IGhlcmVkb2NSZWYgPSBzaW1wbGUudGV4dC5tYXRjaCgvXl9faGVyZWRvY18oXFxkKylfXyQvKTtcbiAgICBpZiAoaGVyZWRvY1JlZikge1xuICAgICAgY29uc3QgdyA9IGhlcmVkb2NXcml0ZXNbTnVtYmVyLnBhcnNlSW50KGhlcmVkb2NSZWZbMV0sIDEwKV07XG4gICAgICBjb25zdCB0b2tlbnMgPSB0b2tlbml6ZShzdHJpcExlYWRpbmdBc3NpZ25tZW50cyh3Lm9wZW5lcikudHJpbSgpKTtcbiAgICAgIGlmICh0b2tlbnMgPT09IG51bGwpIHtcbiAgICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IG51bGw7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3Qgb3BlbmVyQXJndiA9IGFuYWx5emVUb2tlbnModG9rZW5zKS5hcmd2O1xuICAgICAgbWF0Y2hSZWFkcyhzaW1wbGUsIG9wZW5lckFyZ3YsIGkpO1xuICAgICAgY2xhc3NpZnlIZXJlZG9jT3BlbmVyKHcub3BlbmVyLCB3LmJvZHksIHcucXVvdGVkRGVsaW0sIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICAgIHBpcGVFY2hvQ29udGVudCA9IGxpdGVyYWxDb250ZW50KG9wZW5lckFyZ3YpID8/IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCB0b2tlbnMgPSB0b2tlbml6ZShzdHJpcExlYWRpbmdBc3NpZ25tZW50cyhzaW1wbGUudGV4dCkudHJpbSgpKTtcbiAgICBpZiAodG9rZW5zID09PSBudWxsKSB7XG4gICAgICBsYXN0UGxhaW5GaWxlU291cmNlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCB7IGFyZ3YsIHJlZGlyZWN0cyB9ID0gYW5hbHl6ZVRva2Vucyh0b2tlbnMpO1xuICAgIGlmIChhcmd2Lmxlbmd0aCA9PT0gMCkge1xuICAgICAgLy8gQmFyZSBgPiBmYCAvIGA6ID4gZmA6IG5vIGFyZ3YsIGJ1dCB0aGUgdHJ1bmNhdGlvbiBncmFtbWFyIHN0aWxsIGZpcmVzLlxuICAgICAgbWF0Y2hSZWRpcmVjdEZhbWlseShhcmd2LCByZWRpcmVjdHMsIHBpcGVFY2hvQ29udGVudCwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoYXJndlswXSA9PT0gJ2NkJykge1xuICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IG51bGw7XG4gICAgICBjb25zdCB0YXJnZXQgPSBhcmd2WzFdO1xuICAgICAgaWYgKHRhcmdldCAhPT0gdW5kZWZpbmVkICYmIHRhcmdldCAhPT0gJy0nICYmICFoYXNTaGVsbEV4cGFuc2lvbih0YXJnZXQpKSB7XG4gICAgICAgIGN1cnJlbnREaXIgPSByZXNvbHZlUGF0aChjdXJyZW50RGlyLCB0YXJnZXQpO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgYmVmb3JlID0gcmVzdWx0cy5sZW5ndGg7XG4gICAgbWF0Y2hSZWFkcyhzaW1wbGUsIGFyZ3YsIGkpO1xuICAgIG1hdGNoUmVkaXJlY3RGYW1pbHkoYXJndiwgcmVkaXJlY3RzLCBwaXBlRWNob0NvbnRlbnQsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICBtYXRjaENvcHlNb3ZlRmFtaWx5KGFyZ3YsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICBtYXRjaFJtVHJ1bmNhdGUoYXJndiwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgIG1hdGNoU2VkSW5wbGFjZShhcmd2LCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgbWF0Y2hQYXRjaEFwcGx5KGFyZ3YsIHJlZGlyZWN0cywgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgIG1hdGNoRm9ybWF0dGVyKGFyZ3YsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICBtYXRjaEdpdFJlc3RvcmVDaGVja291dChhcmd2LCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgaWYgKHJlc3VsdHMubGVuZ3RoID09PSBiZWZvcmUpIHtcbiAgICAgIC8vIE5vIHNwYW4gZm9yIHRoaXMgY29tbWFuZDogYSBkZXRlcm1pbmlzdGljIGJ1aWx0aW4gaXMgc3RpbGwgYSB1c2FibGVcbiAgICAgIC8vIGpvaW4gZ3VhcmQgKGBmYWxzZSAmJiBlY2hvIHggPiBmYCBtdXN0IHNraXAgdGhlIGVjaG8pLiBBbnkgb3RoZXJcbiAgICAgIC8vIGNvbW1hbmQgc3RheXMgc3Bhbi1sZXNzIGFuZCB1bmtub3dhYmxlIFx1MjAxNCB0aGUgZHJpdmVyIGZhaWxzIG9wZW4uXG4gICAgICBjb25zdCBzdGF0dXMgPSBCVUlMVElOX0dVQVJEX1NUQVRVUy5nZXQoYXJndlswXSk7XG4gICAgICBpZiAoc3RhdHVzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBzdGF0dXM6ICdidWlsdGluLWd1YXJkJyxcbiAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXg6IGksXG4gICAgICAgICAgam9pbjogam9pbk9mKHNpbXBsZSksXG4gICAgICAgICAgZXhpdFN0YXR1czogc3RhdHVzXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgICBwaXBlRWNob0NvbnRlbnQgPSBsaXRlcmFsQ29udGVudChhcmd2KSA/PyBudWxsO1xuICB9XG5cbiAgcmV0dXJuIHJlc3VsdHM7XG59XG5cbi8qKiBQYXJzZXMgYSBCYXNoIGBjb21tYW5kYCBzdHJpbmcgaW50byB0aGUgZmlsZStsaW5lLXJhbmdlIHNwYW5zIGl0IHN0YXRpY2FsbHksIHJlbGlhYmx5IHJlYWRzIG9yIHdyaXRlcy4gYGN3ZGAgZGVmYXVsdHMgdG8gYHByb2Nlc3MuY3dkKClgIFx1MjAxNCBwYXNzIHRoZSBob29rJ3Mgb3duIGBjd2RgIGZpZWxkIGZvciBjb3JyZWN0IHJlc29sdXRpb24gb2YgcmVsYXRpdmUgcGF0aHMgYW5kIGBjZGAvYGdpdCAtQ2AgdGFyZ2V0cywgYW5kIG9mIGBnaXQgc2hvd2AvYGdpdCBsb2cgLUxgIHJldmlzaW9ucy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNvbW1hbmQoY29tbWFuZDogc3RyaW5nLCBjd2Q6IHN0cmluZyA9IHByb2Nlc3MuY3dkKCkpOiBSZXNvbHZlZFNwYW5bXSB7XG4gIGNvbnN0IGRldGFpbGVkID0gcGFyc2VDb21tYW5kRGV0YWlsZWQoY29tbWFuZCwgY3dkKTtcbiAgY29uc3Qgc3BhbnM6IFJlc29sdmVkU3BhbltdID0gW107XG4gIGZvciAoY29uc3QgbSBvZiBkZXRhaWxlZCkge1xuICAgIGlmIChtLnN0YXR1cyA9PT0gJ3Jlc29sdmVkJykgc3BhbnMucHVzaChtLnNwYW4pO1xuICB9XG4gIHJldHVybiBzcGFucztcbn1cbiIsICIvKipcbiAqIFRoZSBvbmx5IGltcHVyZSBiaXRzOiBjb3VudGluZyBsaW5lcyBvZiBhIHdvcmtpbmctdHJlZSBmaWxlLCBhbmQgb2YgYSBmaWxlXG4gKiBhcyBpdCBleGlzdGVkIGF0IGEgZ2l2ZW4gZ2l0IHJldmlzaW9uLiBCb3RoIHJldHVybiBudWxsIG9uIGFueSBmYWlsdXJlXG4gKiAobWlzc2luZyBmaWxlLCBiYWQgcmV2LCBub3QgYSBnaXQgcmVwbywgZXRjLikgaW5zdGVhZCBvZiB0aHJvd2luZyBcdTIwMTQgYVxuICogY29tbWFuZCB0aGF0IHN0YXRpY2FsbHkgbWF0Y2hlZCBhbiBpZGlvbSBidXQgcG9pbnRzIGF0IHNvbWV0aGluZyB0aGlzXG4gKiBtYWNoaW5lIGNhbid0IGN1cnJlbnRseSByZXNvbHZlIGlzIGEgbm9ybWFsLCBleHBlY3RlZCBvdXRjb21lLCBub3QgYSBidWcuXG4gKi9cbmltcG9ydCB7IGV4ZWNGaWxlU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgeyByZWFkRmlsZVN5bmMsIHN0YXRTeW5jIH0gZnJvbSAnbm9kZTpmcyc7XG5cbi8qKiBOdW1iZXIgb2YgbGluZXMgaW4gYSB3b3JraW5nLXRyZWUgZmlsZSwgb3IgbnVsbCBpZiBpdCBjYW4ndCBiZSByZWFkLiBUcmFpbGluZyBuZXdsaW5lIGRvZXMgbm90IGNvdW50IGFzIGFuIGV4dHJhIGVtcHR5IGxpbmUuICovXG5leHBvcnQgZnVuY3Rpb24gY291bnRGaWxlTGluZXMoYWJzb2x1dGVQYXRoOiBzdHJpbmcpOiBudW1iZXIgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICBpZiAoIXN0YXRTeW5jKGFic29sdXRlUGF0aCkuaXNGaWxlKCkpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGNvbnRlbnQgPSByZWFkRmlsZVN5bmMoYWJzb2x1dGVQYXRoLCAndXRmOCcpO1xuICAgIGlmIChjb250ZW50Lmxlbmd0aCA9PT0gMCkgcmV0dXJuIDA7XG4gICAgY29uc3Qgd2l0aG91dFRyYWlsaW5nTmV3bGluZSA9IGNvbnRlbnQuZW5kc1dpdGgoJ1xcbicpID8gY29udGVudC5zbGljZSgwLCAtMSkgOiBjb250ZW50O1xuICAgIHJldHVybiB3aXRob3V0VHJhaWxpbmdOZXdsaW5lLnNwbGl0KCdcXG4nKS5sZW5ndGg7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbi8qKiBOdW1iZXIgb2YgbGluZXMgaW4gYHBhdGhgIGFzIGl0IGV4aXN0cyBhdCBgcmV2YCwgcnVuIGZyb20gYGN3ZGAsIG9yIG51bGwgaWYgdGhlIHJldi9wYXRoL3JlcG8gZG9lc24ndCByZXNvbHZlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvdW50R2l0QmxvYkxpbmVzKGN3ZDogc3RyaW5nLCByZXY6IHN0cmluZywgcGF0aDogc3RyaW5nKTogbnVtYmVyIHwgbnVsbCB7XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3Nob3cnLCBgJHtyZXZ9OiR7cGF0aH1gXSwge1xuICAgICAgY3dkLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddXG4gICAgfSk7XG4gICAgaWYgKG91dC5sZW5ndGggPT09IDApIHJldHVybiAwO1xuICAgIGNvbnN0IHdpdGhvdXRUcmFpbGluZ05ld2xpbmUgPSBvdXQuZW5kc1dpdGgoJ1xcbicpID8gb3V0LnNsaWNlKDAsIC0xKSA6IG91dDtcbiAgICByZXR1cm4gd2l0aG91dFRyYWlsaW5nTmV3bGluZS5zcGxpdCgnXFxuJykubGVuZ3RoO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuIiwgIi8qKlxuICogSGV1cmlzdGljLCBkZXBlbmRlbmN5LWZyZWUgc2hlbGwgc3BsaXR0aW5nLiBOb3QgYSBmdWxsIHNoZWxsIHBhcnNlciBcdTIwMTQgZ29vZFxuICogZW5vdWdoIHRvIGxvY2F0ZSBzaW1wbGUgY29tbWFuZHMgKGFuZCB0aGVpciBhcmd2KSBpbnNpZGUgYSBsYXJnZXJcbiAqICYmL3x8LzsvfC1qb2luZWQgQmFzaCBzdHJpbmcgd2l0aG91dCBwdWxsaW5nIGluIGEgcmVhbCBiYXNoIEFTVCBwYXJzZXIuXG4gKiBWYWxpZGF0ZWQgZHVyaW5nIHJlc2VhcmNoIGFnYWluc3QgYmFzaGxleCBvbiB0aGUgcmVhbCB0cmFuc2NyaXB0IGNvcnB1cztcbiAqIHRoaXMgcG9ydHMgdGhlIHNhbWUgYWxnb3JpdGhtLlxuICpcbiAqIFRoZSB3b3JkLWxldmVsIHRva2VuaXplciAoW3Rva2VuaXplXSkgaXMgcXVvdGUtIGFuZCByZWRpcmVjdC1hd2FyZSAocGxhblxuICogXHUwMEE3NS4xMCk6IHJlZGlyZWN0IG9wZXJhdG9ycyBhcmUgc3BsaXQgYXMgZGlzdGluY3QgdG9rZW5zIHdpdGggYXR0YWNoZWQtdGFyZ2V0XG4gKiBmb3JtcyBwcmVzZXJ2ZWQgKGA+ZmApLCBxdW90ZWQgdG9rZW5zIGFyZSB3b3JkcyBhbmQgbmV2ZXIgb3BlcmF0b3JzLCBhbmRcbiAqIFthcmd2T2ZdIGRlcml2ZXMgb3BlcmFuZHMgZnJvbSB0aGUgdG9rZW4gc3RyZWFtIG1pbnVzIHJlZGlyZWN0IHRva2VucyBhbmRcbiAqIHRoZWlyIHRhcmdldHMuXG4gKi9cblxuLyoqIE9uZSBgc2ltcGxlIGNvbW1hbmRgIGZvdW5kIGluIGEgbGFyZ2VyIHNjcmlwdCwgcGx1cyB3aGljaCBvcGVyYXRvciBwcmVjZWRlZCBpdC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU2ltcGxlQ29tbWFuZCB7XG4gIHRleHQ6IHN0cmluZztcbiAgLyoqXG4gICAqIFRoZSBvcGVyYXRvciBpbW1lZGlhdGVseSBiZWZvcmUgdGhpcyBjb21tYW5kOiAnfCcgZm9yIGEgcGlwZWxpbmUgc3RhZ2UsXG4gICAqICcmJicvJ3x8JyBmb3IgdGhlIGNvbmRpdGlvbmFsIG9wZXJhdG9ycyAodGhlIG9ubHkgb25lcyB0aGF0IGdhdGUsIHBsYW5cbiAgICogXHUwMEE3MyBzdGVwIDIpLCAnb3RoZXInIGZvciAnOycvbmV3bGluZS8nJicsIG9yICdzdGFydCcgZm9yIHRoZSBmaXJzdCBjb21tYW5kLlxuICAgKi9cbiAgcHJlY2VkZWRCeTogJ3N0YXJ0JyB8ICd8JyB8ICcmJicgfCAnfHwnIHwgJ290aGVyJztcbn1cblxuLyoqIFNwbGl0IGEgY29tbWFuZCBzdHJpbmcgaW50byBzaW1wbGUtY29tbWFuZCBzdWJzdHJpbmdzIGF0IHRvcC1sZXZlbCAmJiwgfHwsIDssIHwsIHwmLCBhbmQgbmV3bGluZSBib3VuZGFyaWVzLiBRdW90ZXMgYW5kICQoKS9gYC8oKSBuZXN0aW5nIGFyZSByZXNwZWN0ZWQgKG5vdCBzcGxpdCBpbnNpZGUpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNwbGl0VG9wTGV2ZWwoY21kOiBzdHJpbmcpOiBTaW1wbGVDb21tYW5kW10ge1xuICBjb25zdCBwYXJ0czogU2ltcGxlQ29tbWFuZFtdID0gW107XG4gIGxldCBidWYgPSAnJztcbiAgbGV0IGkgPSAwO1xuICBjb25zdCBuID0gY21kLmxlbmd0aDtcbiAgbGV0IGRlcHRoID0gMDtcbiAgbGV0IGluU3F1b3RlID0gZmFsc2U7XG4gIGxldCBpbkRxdW90ZSA9IGZhbHNlO1xuICBsZXQgcGVuZGluZ09wOiBTaW1wbGVDb21tYW5kWydwcmVjZWRlZEJ5J10gPSAnc3RhcnQnO1xuXG4gIGNvbnN0IGZsdXNoID0gKG5leHRPcDogU2ltcGxlQ29tbWFuZFsncHJlY2VkZWRCeSddKSA9PiB7XG4gICAgY29uc3QgcyA9IGJ1Zi50cmltKCk7XG4gICAgaWYgKHMpIHBhcnRzLnB1c2goeyB0ZXh0OiBzLCBwcmVjZWRlZEJ5OiBwZW5kaW5nT3AgfSk7XG4gICAgYnVmID0gJyc7XG4gICAgcGVuZGluZ09wID0gbmV4dE9wO1xuICB9O1xuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSBvcGVyYXRvciBjdXJyZW50bHkgcGVuZGluZyBpcyBhIHBpcGUgKGB8YC9gfCZgKS4gQSBoZWxwZXJcbiAgICogcmF0aGVyIHRoYW4gYW4gaW5saW5lIGNvbXBhcmlzb246IFR5cGVTY3JpcHQncyBjb250cm9sLWZsb3cgbmFycm93aW5nXG4gICAqIGNhbm5vdCBzZWUgdGhlIGFzc2lnbm1lbnRzIGBmbHVzaGAgbWFrZXMgdG8gYHBlbmRpbmdPcGAgZnJvbSBpbnNpZGUgaXRzXG4gICAqIGNsb3N1cmUsIGFuZCB3b3VsZCBvdGhlcndpc2UgbmFycm93IHRoZSBkaXJlY3QgY29tcGFyaXNvbiB0byB0aGVcbiAgICogaW5pdGlhbGl6ZXIgYCdzdGFydCdgLlxuICAgKi9cbiAgY29uc3QgaXNQZW5kaW5nUGlwZSA9ICgpOiBib29sZWFuID0+IHBlbmRpbmdPcCA9PT0gJ3wnO1xuXG4gIHdoaWxlIChpIDwgbikge1xuICAgIGNvbnN0IGMgPSBjbWRbaV07XG4gICAgaWYgKGluU3F1b3RlKSB7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGlmIChjID09PSBcIidcIikgaW5TcXVvdGUgPSBmYWxzZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaW5EcXVvdGUpIHtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIHtcbiAgICAgICAgYnVmICs9IGNtZFtpICsgMV07XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1wiJykgaW5EcXVvdGUgPSBmYWxzZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gXCInXCIpIHtcbiAgICAgIGluU3F1b3RlID0gdHJ1ZTtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXCInKSB7XG4gICAgICBpbkRxdW90ZSA9IHRydWU7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikge1xuICAgICAgYnVmICs9IGMgKyBjbWRbaSArIDFdO1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnKCcpIHtcbiAgICAgIGRlcHRoICs9IDE7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJyknKSB7XG4gICAgICBkZXB0aCA9IE1hdGgubWF4KDAsIGRlcHRoIC0gMSk7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoZGVwdGggPT09IDApIHtcbiAgICAgIGlmIChjbWQuc2xpY2UoaSwgaSArIDIpID09PSAnJiYnKSB7XG4gICAgICAgIGZsdXNoKCcmJicpO1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGNtZC5zbGljZShpLCBpICsgMikgPT09ICd8fCcpIHtcbiAgICAgICAgZmx1c2goJ3x8Jyk7XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoY21kLnNsaWNlKGksIGkgKyAyKSA9PT0gJ3wmJykge1xuICAgICAgICBmbHVzaCgnfCcpO1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICc7Jykge1xuICAgICAgICBmbHVzaCgnb3RoZXInKTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnfCcpIHtcbiAgICAgICAgZmx1c2goJ3wnKTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXFxuJykge1xuICAgICAgICAvLyBBIG5ld2xpbmUgaW1tZWRpYXRlbHkgYWZ0ZXIgYSBwaXBlIG9wZXJhdG9yIGlzIGEgbGluZSBjb250aW51YXRpb25cbiAgICAgICAgLy8gKGBjYXQgYS50eHQgfFxcbnNlZCAuLi5gIGtlZXBzIHRoZSBwaXBlbGluZSksIG5vdCBhIHN0YXRlbWVudFxuICAgICAgICAvLyBzZXBhcmF0b3I6IHNraXBwaW5nIGl0IHByZXNlcnZlcyBgcHJlY2VkZWRCeTogJ3wnYCBmb3IgdGhlIG5leHRcbiAgICAgICAgLy8gc3RhZ2UgaW5zdGVhZCBvZiBkZWdyYWRpbmcgaXQgdG8gJ290aGVyJy5cbiAgICAgICAgaWYgKGlzUGVuZGluZ1BpcGUoKSkge1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBmbHVzaCgnb3RoZXInKTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnJicpIHtcbiAgICAgICAgLy8gYCY+YC9gJj4+YCAoc3Rkb3V0K3N0ZGVyciByZWRpcmVjdCkgYW5kIGA+JmAgKGZkLWR1cCByZWRpcmVjdCwgYXMgaW5cbiAgICAgICAgLy8gYDI+JjFgKSBhcmUgcmVkaXJlY3Qgb3BlcmF0b3JzLCBub3QgY29tbWFuZCBzZXBhcmF0b3JzIFx1MjAxNCBrZWVwIHRoZW1cbiAgICAgICAgLy8gaW4gdGhlIGN1cnJlbnQgc2ltcGxlIGNvbW1hbmQgc28gdGhlIHRva2VuaXplciBjYW4gbGV4IHRoZW0gYXMgb25lXG4gICAgICAgIC8vIHRva2VuLiBBIGA+YCBjb3VudHMgYXMgYSBkdXAtcmVkaXJlY3QgcHJlZml4IG9ubHkgYXQgYSB0b2tlblxuICAgICAgICAvLyBib3VuZGFyeSAoc3RhcnQsIG9yIGFmdGVyIHdoaXRlc3BhY2UvZGlnaXRzKSBcdTIwMTQgYGE+YiZjYCBzdGlsbFxuICAgICAgICAvLyBiYWNrZ3JvdW5kcyB0aGUgYGE+YmAgcmVkaXJlY3QuXG4gICAgICAgIGNvbnN0IHRyaW1tZWQgPSBidWYudHJpbUVuZCgpO1xuICAgICAgICBsZXQgZHVwUmVkaXJlY3QgPSBmYWxzZTtcbiAgICAgICAgaWYgKHRyaW1tZWQuZW5kc1dpdGgoJz4nKSkge1xuICAgICAgICAgIGNvbnN0IGJlZm9yZSA9IHRyaW1tZWQubGVuZ3RoID49IDIgPyB0cmltbWVkW3RyaW1tZWQubGVuZ3RoIC0gMl0gOiAnJztcbiAgICAgICAgICBkdXBSZWRpcmVjdCA9IHRyaW1tZWQubGVuZ3RoID09PSAxIHx8IC9cXHN8XFxkLy50ZXN0KGJlZm9yZSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNtZFtpICsgMV0gPT09ICc+JyB8fCBkdXBSZWRpcmVjdCkge1xuICAgICAgICAgIGJ1ZiArPSBjO1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBmbHVzaCgnb3RoZXInKTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgYnVmICs9IGM7XG4gICAgaSArPSAxO1xuICB9XG4gIGZsdXNoKCdvdGhlcicpO1xuICByZXR1cm4gcGFydHM7XG59XG5cbmNvbnN0IExFQURJTkdfQVNTSUdOTUVOVCA9IC9eKD86W0EtWmEtel9dW0EtWmEtejAtOV9dKj1cXFMqXFxzKykrLztcblxuLyoqIFN0cmlwIGxlYWRpbmcgRk9PPWJhciBWQVI9YmF6IGVudi1wcmVmaXggYXNzaWdubWVudHMgZnJvbSBhIHNpbXBsZSBjb21tYW5kLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0cmlwTGVhZGluZ0Fzc2lnbm1lbnRzKHNpbXBsZUNtZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHNpbXBsZUNtZC5yZXBsYWNlKExFQURJTkdfQVNTSUdOTUVOVCwgJycpO1xufVxuXG4vKiogT25lIHF1b3RlLWF3YXJlIGxleGljYWwgdG9rZW4gZnJvbSBhIHNpbXBsZSBjb21tYW5kJ3MgdGV4dCAocGxhbiBcdTAwQTc1LjEwKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG9rZW4ge1xuICAvKipcbiAgICogVGhlIHRva2VuIHRleHQuIFdvcmQgdG9rZW5zIGhhdmUgcXVvdGVzIHN0cmlwcGVkIGFuZCBlc2NhcGVzIHJlc29sdmVkO1xuICAgKiByZWRpcmVjdCB0b2tlbnMga2VlcCB0aGUgb3BlcmF0b3Igd2l0aCBhbnkgYXR0YWNoZWQgdGFyZ2V0IChgPmZgLFxuICAgKiBgPj5mYCksIHNoZWxsLWxleGVyIHN0eWxlLlxuICAgKi9cbiAgdGV4dDogc3RyaW5nO1xuICAvKipcbiAgICogV2hldGhlciB0aGUgdG9rZW4gd2FzIHF1b3RlZCBvciBlc2NhcGVkIGFueXdoZXJlIGluIHRoZSBzb3VyY2UuIEEgcXVvdGVkXG4gICAqIHRva2VuIGlzIGEgd29yZCwgbmV2ZXIgYW4gb3BlcmF0b3IgKGBlY2hvICc+J2AgaXMgbm90IGEgcmVkaXJlY3QpLlxuICAgKi9cbiAgcXVvdGVkOiBib29sZWFuO1xuICAvKipcbiAgICogV2hldGhlciB0aGUgdG9rZW4gaXMgYSByZWRpcmVjdCBvcGVyYXRvciAoYD5gLCBgPj5gLCBgMT5gLCBgMj5gLCBgJj5gLFxuICAgKiBgJj4+YCwgYD4mYCwgYDxgLCBgPDxgLCBgPDwtYCwgYDw8PGApLCB3aXRoIGFueSBhdHRhY2hlZCB0YXJnZXQgcHJlc2VydmVkXG4gICAqIGluIGB0ZXh0YC5cbiAgICovXG4gIGlzUmVkaXJlY3Q6IGJvb2xlYW47XG59XG5cbi8qKlxuICogUXVvdGUtYXdhcmUgdG9rZW5pemVyIHRoYXQgc3BsaXRzIHJlZGlyZWN0IG9wZXJhdG9ycyBhcyBkaXN0aW5jdCB0b2tlbnMgd2l0aFxuICogYXR0YWNoZWQtdGFyZ2V0IGZvcm1zIHByZXNlcnZlZCAocGxhbiBcdTAwQTc1LjEwKS4gV29yZCB0b2tlbnMgY2FycnkgdGhlXG4gKiBgcXVvdGVkYCBmbGFnIHNvIGNvbnN1bWVycyBjYW4gdGVsbCBhIHJlYWwgYDw8YCBvcGVyYXRvciBmcm9tIGEgcXVvdGVkXG4gKiBgXCI8PFwiYCBsaXRlcmFsLiBSZXR1cm5zIG51bGwgb24gdW5iYWxhbmNlZCBxdW90ZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0b2tlbml6ZShzOiBzdHJpbmcpOiBUb2tlbltdIHwgbnVsbCB7XG4gIGNvbnN0IHRva2VuczogVG9rZW5bXSA9IFtdO1xuICBsZXQgYnVmID0gJyc7XG4gIGxldCBxdW90ZWQgPSBmYWxzZTtcbiAgbGV0IGkgPSAwO1xuICBjb25zdCBuID0gcy5sZW5ndGg7XG5cbiAgY29uc3QgZmx1c2hXb3JkID0gKCk6IHZvaWQgPT4ge1xuICAgIGlmIChidWYubGVuZ3RoID09PSAwKSByZXR1cm47XG4gICAgdG9rZW5zLnB1c2goeyB0ZXh0OiBidWYsIHF1b3RlZCwgaXNSZWRpcmVjdDogZmFsc2UgfSk7XG4gICAgYnVmID0gJyc7XG4gICAgcXVvdGVkID0gZmFsc2U7XG4gIH07XG5cbiAgLyoqXG4gICAqIEFwcGVuZCB0aGUgdW5xdW90ZWQgY29udGVudCBvZiB0aGUgcXVvdGVkIHNlY3Rpb24gb3BlbmluZyBhdCBgc3RhcnRgXG4gICAqICh0aGUgcXVvdGUgY2hhcikgdG8gYG91dGAsIG1pcnJvcmluZyBzaGxleCdzIGVzY2FwZSBydWxlcyBmb3IgZG91YmxlXG4gICAqIHF1b3Rlcy4gUmV0dXJucyB0aGUgaW5kZXggYWZ0ZXIgdGhlIGNsb3NpbmcgcXVvdGUsIG9yIG51bGwgd2hlblxuICAgKiB1bmJhbGFuY2VkLlxuICAgKi9cbiAgY29uc3QgYXBwZW5kUXVvdGVkQ29udGVudCA9IChvdXQ6IHN0cmluZywgc3RhcnQ6IG51bWJlcik6IHsgb3V0OiBzdHJpbmc7IG5leHQ6IG51bWJlciB9IHwgbnVsbCA9PiB7XG4gICAgY29uc3QgcXVvdGUgPSBzW3N0YXJ0XTtcbiAgICBsZXQgaiA9IHN0YXJ0ICsgMTtcbiAgICB3aGlsZSAoaiA8IG4pIHtcbiAgICAgIGNvbnN0IGMgPSBzW2pdO1xuICAgICAgaWYgKHF1b3RlID09PSBcIidcIikge1xuICAgICAgICBpZiAoYyA9PT0gXCInXCIpIHJldHVybiB7IG91dCwgbmV4dDogaiArIDEgfTtcbiAgICAgICAgb3V0ICs9IGM7XG4gICAgICAgIGogKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGogKyAxIDwgbiAmJiAnXCJcXFxcJGAnLmluY2x1ZGVzKHNbaiArIDFdKSkge1xuICAgICAgICBvdXQgKz0gc1tqICsgMV07XG4gICAgICAgIGogKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1wiJykgcmV0dXJuIHsgb3V0LCBuZXh0OiBqICsgMSB9O1xuICAgICAgb3V0ICs9IGM7XG4gICAgICBqICs9IDE7XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9O1xuXG4gIC8qKlxuICAgKiBBcHBlbmQgdGhlIHJhdyBhdHRhY2hlZC10YXJnZXQgdGV4dCBzdGFydGluZyBhdCBgc3RhcnRgIHRvIGBvdXRgIFx1MjAxNFxuICAgKiB2ZXJiYXRpbSwgcXVvdGVkIHNlY3Rpb25zIHNwYW5uaW5nIHNwYWNlcyBpbmNsdWRlZCBcdTIwMTQgc3RvcHBpbmcgYXRcbiAgICogd2hpdGVzcGFjZSBvciBhbm90aGVyIHJlZGlyZWN0IG9wZXJhdG9yLiBSZXR1cm5zIHRoZSBuZXh0IGluZGV4LCBvciBudWxsXG4gICAqIG9uIHVuYmFsYW5jZWQgcXVvdGVzLlxuICAgKi9cbiAgY29uc3QgYXBwZW5kQXR0YWNoZWRUYXJnZXQgPSAob3V0OiBzdHJpbmcsIHN0YXJ0OiBudW1iZXIpOiB7IG91dDogc3RyaW5nOyBuZXh0OiBudW1iZXIgfSB8IG51bGwgPT4ge1xuICAgIGxldCBqID0gc3RhcnQ7XG4gICAgd2hpbGUgKGogPCBuKSB7XG4gICAgICBjb25zdCBjID0gc1tqXTtcbiAgICAgIGlmICgvXFxzLy50ZXN0KGMpIHx8IGMgPT09ICc8JyB8fCBjID09PSAnPicpIHJldHVybiB7IG91dCwgbmV4dDogaiB9O1xuICAgICAgaWYgKGMgPT09IFwiJ1wiIHx8IGMgPT09ICdcIicpIHtcbiAgICAgICAgY29uc3Qgc2VjdGlvbiA9IGFwcGVuZFF1b3RlZENvbnRlbnQoJycsIGopO1xuICAgICAgICBpZiAoc2VjdGlvbiA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gICAgICAgIG91dCArPSBzLnNsaWNlKGosIHNlY3Rpb24ubmV4dCk7XG4gICAgICAgIGogPSBzZWN0aW9uLm5leHQ7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcXFxcJyAmJiBqICsgMSA8IG4pIHtcbiAgICAgICAgb3V0ICs9IGMgKyBzW2ogKyAxXTtcbiAgICAgICAgaiArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIG91dCArPSBjO1xuICAgICAgaiArPSAxO1xuICAgIH1cbiAgICByZXR1cm4geyBvdXQsIG5leHQ6IGogfTtcbiAgfTtcblxuICAvKiogRW1pdCBhIHJlZGlyZWN0IHRva2VuIHdob3NlIHRleHQgcHJlZml4ZXMgdGhlIG9wZXJhdG9yIHdpdGggdGhlIGN1cnJlbnQgZGlnaXQgYnVmZmVyIChhbiBJT19OVU1CRVIgbGlrZSBgMj5gKS4gKi9cbiAgY29uc3QgZW1pdFJlZGlyZWN0ID0gKG9wZXJhdG9yOiBzdHJpbmcsIGF0dGFjaGVkU3RhcnQ6IG51bWJlcik6IGJvb2xlYW4gPT4ge1xuICAgIGNvbnN0IGF0dGFjaGVkID0gYXBwZW5kQXR0YWNoZWRUYXJnZXQoJycsIGF0dGFjaGVkU3RhcnQpO1xuICAgIGlmIChhdHRhY2hlZCA9PT0gbnVsbCkgcmV0dXJuIGZhbHNlO1xuICAgIHRva2Vucy5wdXNoKHsgdGV4dDogYnVmICsgb3BlcmF0b3IgKyBhdHRhY2hlZC5vdXQsIHF1b3RlZDogZmFsc2UsIGlzUmVkaXJlY3Q6IHRydWUgfSk7XG4gICAgYnVmID0gJyc7XG4gICAgcXVvdGVkID0gZmFsc2U7XG4gICAgaSA9IGF0dGFjaGVkLm5leHQ7XG4gICAgcmV0dXJuIHRydWU7XG4gIH07XG5cbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgY29uc3QgYyA9IHNbaV07XG4gICAgaWYgKC9cXHMvLnRlc3QoYykpIHtcbiAgICAgIGZsdXNoV29yZCgpO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSBcIidcIiB8fCBjID09PSAnXCInKSB7XG4gICAgICBxdW90ZWQgPSB0cnVlO1xuICAgICAgY29uc3Qgc2VjdGlvbiA9IGFwcGVuZFF1b3RlZENvbnRlbnQoYnVmLCBpKTtcbiAgICAgIGlmIChzZWN0aW9uID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgICAgIGJ1ZiA9IHNlY3Rpb24ub3V0O1xuICAgICAgaSA9IHNlY3Rpb24ubmV4dDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikge1xuICAgICAgcXVvdGVkID0gdHJ1ZTtcbiAgICAgIGJ1ZiArPSBzW2kgKyAxXTtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJzwnIHx8IGMgPT09ICc+Jykge1xuICAgICAgLy8gQSBgPGAvYD5gIGlzIGEgcmVkaXJlY3Qgb3BlcmF0b3IgYXQgYSB3b3JkIGJvdW5kYXJ5LCBvciBhZnRlciBhblxuICAgICAgLy8gSU9fTlVNQkVSIGRpZ2l0IHJ1biAoYDE+YCwgYDI+YCk7IG1pZC13b3JkIGl0IGVuZHMgdGhlIGN1cnJlbnQgd29yZFxuICAgICAgLy8gZmlyc3QgKGBlY2hvIGE+YmAgXHUyMTkyIHdvcmRzIGBlY2hvYCwgYGFgOyByZWRpcmVjdCBgPmJgKS5cbiAgICAgIGlmIChidWYgIT09ICcnICYmICEvXlxcZCskLy50ZXN0KGJ1ZikpIGZsdXNoV29yZCgpO1xuICAgICAgbGV0IG9wZXJhdG9yOiBzdHJpbmc7XG4gICAgICBpZiAoYyA9PT0gJzwnKSB7XG4gICAgICAgIGlmIChzLnNsaWNlKGksIGkgKyAzKSA9PT0gJzw8PCcpIG9wZXJhdG9yID0gJzw8PCc7XG4gICAgICAgIGVsc2UgaWYgKHMuc2xpY2UoaSwgaSArIDMpID09PSAnPDwtJykgb3BlcmF0b3IgPSAnPDwtJztcbiAgICAgICAgZWxzZSBpZiAocy5zbGljZShpLCBpICsgMikgPT09ICc8PCcpIG9wZXJhdG9yID0gJzw8JztcbiAgICAgICAgZWxzZSBvcGVyYXRvciA9ICc8JztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG9wZXJhdG9yID0gcy5zbGljZShpLCBpICsgMikgPT09ICc+PicgPyAnPj4nIDogJz4nO1xuICAgICAgfVxuICAgICAgaWYgKCFlbWl0UmVkaXJlY3Qob3BlcmF0b3IsIGkgKyBvcGVyYXRvci5sZW5ndGgpKSByZXR1cm4gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJyYnKSB7XG4gICAgICAvLyBgJj5gL2AmPj5gIFx1MjAxNCB0aGUgc3Rkb3V0K3N0ZGVyciByZWRpcmVjdCAoa2VwdCB0b2dldGhlciBieVxuICAgICAgLy8gc3BsaXRUb3BMZXZlbCkuIEEgYmFyZSBgJmAgaGVyZSBpcyBhbiBvcmRpbmFyeSB3b3JkIGNoYXIgKGAmMWAgaW5cbiAgICAgIC8vIGAyPiYxYCwgd2hpY2ggdGhlIGF0dGFjaGVkLXRhcmdldCBzY2FuIGFib3ZlIGNvbnN1bWVkIGFueXdheSkuXG4gICAgICBpZiAoc1tpICsgMV0gPT09ICc+Jykge1xuICAgICAgICBmbHVzaFdvcmQoKTtcbiAgICAgICAgY29uc3Qgb3BlcmF0b3IgPSBzLnNsaWNlKGksIGkgKyAzKSA9PT0gJyY+PicgPyAnJj4+JyA6ICcmPic7XG4gICAgICAgIGlmICghZW1pdFJlZGlyZWN0KG9wZXJhdG9yLCBpICsgb3BlcmF0b3IubGVuZ3RoKSkgcmV0dXJuIG51bGw7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgYnVmICs9IGM7XG4gICAgaSArPSAxO1xuICB9XG4gIGZsdXNoV29yZCgpO1xuICByZXR1cm4gdG9rZW5zO1xufVxuXG4vKipcbiAqIFRoZSBhdHRhY2hlZCB0YXJnZXQgb2YgYSByZWRpcmVjdCB0b2tlbiwgb3IgbnVsbCB3aGVuIHRoZSBvcGVyYXRvciBpc1xuICogc3RhbmRhbG9uZSAoYD5gIHZzIGA+ZmA7IGAyPmAgdnMgYDI+JjFgKS4gU3BsaXRzIGFuIG9wdGlvbmFsIElPX05VTUJFUlxuICogZGlnaXQgcnVuIG9mZiB0aGUgZnJvbnQsIHRoZW4gdGhlIG9wZXJhdG9yLCBsZWF2aW5nIHRoZSB0YXJnZXQuXG4gKi9cbmZ1bmN0aW9uIHJlZGlyZWN0QXR0YWNoZWRUYXJnZXQodGV4dDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IG1hdGNoID0gdGV4dC5tYXRjaCgvXihcXGQqKSg8PDx8PDwtfCY+Pnw8PHw+PnwmPnw+Jnw8fD4pKC4qKSQvKTtcbiAgaWYgKG1hdGNoID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgWywgLCAsIHJlc3RdID0gbWF0Y2g7XG4gIHJldHVybiByZXN0Lmxlbmd0aCA+IDAgPyByZXN0IDogbnVsbDtcbn1cblxuLyoqIEJlc3QtZWZmb3J0IGFyZ3YgZm9yIGEgc2ltcGxlIGNvbW1hbmQ6IGxlYWRpbmcgYXNzaWdubWVudHMgc3RyaXBwZWQsIHF1b3RlLWF3YXJlIHRva2VucyBtaW51cyByZWRpcmVjdCBvcGVyYXRvcnMgYW5kIHRoZWlyIHRhcmdldHMuIFJldHVybnMgbnVsbCBpZiB0aGUgY29tbWFuZCBkb2Vzbid0IHRva2VuaXplIGNsZWFubHkgKHVuYmFsYW5jZWQgcXVvdGVzKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhcmd2T2Yoc2ltcGxlQ21kOiBzdHJpbmcpOiBzdHJpbmdbXSB8IG51bGwge1xuICBjb25zdCB0b2tlbnMgPSB0b2tlbml6ZShzdHJpcExlYWRpbmdBc3NpZ25tZW50cyhzaW1wbGVDbWQpLnRyaW0oKSk7XG4gIGlmICh0b2tlbnMgPT09IG51bGwpIHJldHVybiBudWxsO1xuICBjb25zdCBhcmd2OiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHRva2Vucy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IHRva2VuID0gdG9rZW5zW2ldO1xuICAgIGlmICghdG9rZW4uaXNSZWRpcmVjdCkge1xuICAgICAgYXJndi5wdXNoKHRva2VuLnRleHQpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIEEgc3RhbmRhbG9uZSByZWRpcmVjdCBvcGVyYXRvciBjb25zdW1lcyB0aGUgbmV4dCB0b2tlbiBhcyBpdHMgdGFyZ2V0O1xuICAgIC8vIGFuIGF0dGFjaGVkIGZvcm0gKGA+ZmAsIGA+PmZgKSBpcyBzZWxmLWNvbnRhaW5lZC5cbiAgICBpZiAocmVkaXJlY3RBdHRhY2hlZFRhcmdldCh0b2tlbi50ZXh0KSA9PT0gbnVsbCkgaSArPSAxO1xuICB9XG4gIHJldHVybiBhcmd2O1xufVxuIiwgIi8qKlxuICogVGhlIHJhbmdlLXByZXNlcnZpbmcgdW5pZmllZC1kaWZmIHBhcnNlciAocGxhbiBcdTAwQTc1LjcpLCBzaWJsaW5nIHRvXG4gKiBtZWNoYW5pY2FsLWNoYW5nZS50cydzIHJhbmdlLWxlc3MgYHBhcnNlVW5pZmllZERpZmZgLiBUaGUgcGF0Y2gvZ2l0IGFwcGx5XG4gKiBncmFtbWFyIG5lZWRzIHRoZSBgQEAgLWEsYiArYyxkIEBAYCBodW5rIG51bWJlcnMgdGhhdCBwYXJzZVVuaWZpZWREaWZmXG4gKiBkaXNjYXJkcywgc28gdGhpcyBwYXJzZXMgdGhlIHNhbWUgaGVhZGVyIGRpYWxlY3QgZnJvbSBzY3JhdGNoLlxuICpcbiAqIEEgaHVuayB3aG9zZSBwcmUvcG9zdCBsaW5lIGNvdW50cyBtYXRjaCBwcmVzZXJ2ZXMgbGluZSBjb29yZGluYXRlcywgc28gYVxuICogZmlsZSB3aG9zZSBodW5rcyBhcmUgYWxsIGNvdW50LXByZXNlcnZpbmcgZ2V0cyBhbiBleGFjdCByYW5nZSBcdTIwMTQgdGhlIHVuaW9uIG9mXG4gKiBldmVyeSBodW5rJ3MgcmVnaW9uLiBBbnkgY291bnQtY2hhbmdpbmcgaHVuayAocHVyZSBhZGQsIHB1cmUgZGVsZXRlLCB1bmVxdWFsXG4gKiBjb3VudHMpIGRlZ3JhZGVzIHRoZSBmaWxlIHRvIGEgd2hvbGUtZmlsZSBtb2RpZnk6IHBvc2l0aW9ucyBiZWxvdyBpdCBzaGlmdCxcbiAqIGFuZCBhIGRlbGV0ZWQgbGluZSBvY2N1cGllcyBubyBwb3N0LWVkaXQgcmFuZ2UgYXQgYWxsLlxuICpcbiAqIFBlci1maWxlIGNsYXNzaWZpY2F0aW9uczogYG5ldyBmaWxlIG1vZGVgIFx1MjE5MiBjcmVhdGUtb3ZlcndyaXRlOyBgZGVsZXRlZCBmaWxlXG4gKiBtb2RlYCBcdTIxOTIgZGVsZXRlOyBgcmVuYW1lIGZyb21gL2ByZW5hbWUgdG9gIFx1MjE5MiBzb3VyY2UgZGVsZXRlICsgZGVzdFxuICogcmVuYW1lLWNvcHk7IGJpbmFyeSBkaWZmcyBcdTIxOTIgd2hvbGUtZmlsZSBtb2RpZnk7IGEgYCsrKyAvZGV2L251bGxgIHRhcmdldCAodGhlXG4gKiBzaGFwZSBgZGlmZiAtdWAtZm9ybWF0IGRlbGV0aW9ucyB0YWtlKSBcdTIxOTIgZGVsZXRlLCBhbmQgYSBgLS0tIC9kZXYvbnVsbGAgc2lkZVxuICogKHRoZSBgZGlmZiAtdWAtZm9ybWF0IGNyZWF0aW9uIHNoYXBlLCB3aXRoIG5vIGBuZXcgZmlsZSBtb2RlYCBoZWFkZXIpIFx1MjE5MlxuICogY3JlYXRlLW92ZXJ3cml0ZS5cbiAqXG4gKiBHaXQtc3R5bGUgYGEvXHUyMDI2YC9gYi9cdTIwMjZgIHByZWZpeGVzIGFyZSBzdHJpcHBlZCBwZXIgdGhlIGNhbGxlcidzIGAtcE5gIHN0cmlwXG4gKiBsZXZlbDogYSBudW1iZXIgc3RyaXBzIHRoYXQgbWFueSBsZWFkaW5nIHBhdGggY29tcG9uZW50cywgYW5kIGAnYXV0bydgXG4gKiAocGF0Y2gncyBkZWZhdWx0KSBzdHJpcHMgb25lIHdoZW4gdGhlIHBhdGggaXMgYS8tIG9yIGIvLXByZWZpeGVkIGFuZCBub25lXG4gKiBvdGhlcndpc2UuIGAvZGV2L251bGxgIGlzIGNoZWNrZWQgYmVmb3JlIHN0cmlwcGluZyBcdTIwMTQgdGhlIGhlYWRlciBtYXJrZXJcbiAqIHdvdWxkIG90aGVyd2lzZSBsb3NlIGl0cyBgZGV2L2AgY29tcG9uZW50LlxuICpcbiAqIGBkaWZmIC11YCBoZWFkZXJzIGNhcnJ5IGEgdGFiLXNlcGFyYXRlZCB0aW1lc3RhbXAgKGAtLS0gZi50eHRcXHQyMDI0LTAxLTAxXG4gKiAwMDowMDowMGApIGFuZCBtYXkgYmUgQ1JMRi10ZXJtaW5hdGVkOyBib3RoIGFyZSBzdHJpcHBlZCBiZWZvcmUgcGF0aFxuICogcmVzb2x1dGlvbi4gVGhlIHRhcmdldCBvZiBhIG1vZGlmeSBodW5rIGlzIHRoZSBgLS0tYCBzaWRlOiBwYXRjaCBhbmQgZ2l0XG4gKiBhcHBseSByZXdyaXRlIHRoZSBmaWxlIG5hbWVkIHRoZXJlIChmb3IgYGRpZmYgLXUgZi50eHQgZi5uZXdgLCB0aGUgYCsrK2BcbiAqIHNpZGUgaXMgb25seSBhIGxhYmVsKSwgc28gdGhlIGArKytgIGxpbmUgb3ZlcnJpZGVzIHRoZSBwYXRoIG9ubHkgZm9yIHRoZVxuICogYC9kZXYvbnVsbGAgbWFya2VycyBcdTIwMTQgYSBgLS0tIC9kZXYvbnVsbGAgc2lkZSAoYSBuZXcgZmlsZSkgbmFtZXMgdGhlIHRhcmdldFxuICogb24gYCsrK2AsIGFuZCBhIGArKysgL2Rldi9udWxsYCBzaWRlIG1hcmtzIGEgZGVsZXRpb24uXG4gKlxuICogTWFsZm9ybWVkIG9yIGVtcHR5IHBhdGNoIHRleHQgcmV0dXJucyBudWxsIChmYWlsIGNsb3NlZCBcdTIwMTQgdGhlIGNhbGxlciBlbWl0c1xuICogdW5yZXNvbHZlZCByYXRoZXIgdGhhbiBndWVzc2luZyBhdCB0YXJnZXRzKS5cbiAqL1xuXG4vKiogVGhlIGAtcE5gIGhlYWRlciBzdHJpcCBsZXZlbDogYSBjb21wb25lbnQgY291bnQsIG9yIHBhdGNoJ3MgYCdhdXRvJ2AgZGVmYXVsdC4gKi9cbmV4cG9ydCB0eXBlIFBhdGhTdHJpcCA9IG51bWJlciB8ICdhdXRvJztcblxuLyoqIE9uZSBmaWxlIGEgcGF0Y2ggdG91Y2hlczogdGhlIHRhcmdldCBwYXRoLCB0aGUgdG91Y2gga2luZCwgYW5kIHRoZSBleGFjdCByYW5nZSB3aGVuIHRoZSBodW5rcyBwcmVzZXJ2ZSBsaW5lIGNvdW50cy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVW5pZmllZERpZmZUYXJnZXQge1xuICBwYXRoOiBzdHJpbmc7XG4gIG9wZXJhdGlvbjogJ21vZGlmeScgfCAnY3JlYXRlLW92ZXJ3cml0ZScgfCAnZGVsZXRlJyB8ICdyZW5hbWUtY29weSc7XG4gIGxpbmVTdGFydD86IG51bWJlcjtcbiAgbGluZUVuZD86IG51bWJlcjtcbn1cblxuY29uc3QgSFVOS19IRUFERVIgPSAvXkBAIC0oXFxkKykoPzosKFxcZCspKT8gXFwrKFxcZCspKD86LChcXGQrKSk/IEBALztcblxuLyoqIFN0cmlwIHRoZSBmaXJzdCBgbmAgbGVhZGluZyBwYXRoIGNvbXBvbmVudHMgKGAtcE5gKSwgc3RvcHBpbmcgYXQgYSBjb21wb25lbnQtbGVzcyBwYXRoLiAqL1xuZnVuY3Rpb24gc3RyaXBQYXRoQ29tcG9uZW50cyhwOiBzdHJpbmcsIG46IG51bWJlcik6IHN0cmluZyB7XG4gIGxldCBzID0gcDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBuOyBpKyspIHtcbiAgICBjb25zdCBzbGFzaCA9IHMuaW5kZXhPZignLycpO1xuICAgIGlmIChzbGFzaCA9PT0gLTEpIHJldHVybiBzO1xuICAgIHMgPSBzLnNsaWNlKHNsYXNoICsgMSk7XG4gIH1cbiAgcmV0dXJuIHM7XG59XG5cbi8qKlxuICogVGhlIGxldmVsIHRvIHN0cmlwIGZyb20gYHJhd2AgdW5kZXIgYHN0cmlwYDogYSBudW1iZXIgcGFzc2VzIHRocm91Z2g7IGAnYXV0bydgXG4gKiByZXNvbHZlcyB0byBwMSB3aGVuIHRoZSBwYXRoIGlzIGBhL2AvYGIvYC1wcmVmaXhlZCBhbmQgcDAgb3RoZXJ3aXNlIFx1MjAxNCBwYXRjaCdzXG4gKiBkZWZhdWx0IGZvciBkaWZmcyB3aG9zZSBwcmVmaXhlcyBhcmUgYGRpZmYgLXVgLXN0eWxlIHJhdGhlciB0aGFuIGdpdCdzLlxuICovXG5mdW5jdGlvbiBzdHJpcExldmVsRm9yKHJhdzogc3RyaW5nLCBzdHJpcDogUGF0aFN0cmlwKTogbnVtYmVyIHtcbiAgcmV0dXJuIHN0cmlwID09PSAnYXV0bycgPyAocmF3LnN0YXJ0c1dpdGgoJ2EvJykgfHwgcmF3LnN0YXJ0c1dpdGgoJ2IvJykgPyAxIDogMCkgOiBzdHJpcDtcbn1cblxuLyoqXG4gKiBUaGUgcmF3IGAtLS1gL2ArKytgIGhlYWRlciBwYXRoOiB0aGUgdGV4dCB1cCB0byB0aGUgZmlyc3QgdGFiICh0aGVcbiAqIGBkaWZmIC11YCB0aW1lc3RhbXAgY29sdW1uKSwgb3IgdGhlIHdob2xlIHdvcmQgd2hlbiB0aGVyZSBpcyBub25lLiBDUkxGXG4gKiBpcyBoYW5kbGVkIGF0IHRoZSBsaW5lIGxldmVsIChzZWUgcGFyc2VVbmlmaWVkRGlmZlJhbmdlKSwgd2hpY2ggYWxzb1xuICogY292ZXJzIGh1bmsgaGVhZGVycy5cbiAqL1xuZnVuY3Rpb24gaGVhZGVyUGF0aFRleHQocmF3OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0YWIgPSByYXcuaW5kZXhPZignXFx0Jyk7XG4gIHJldHVybiB0YWIgPT09IC0xID8gcmF3IDogcmF3LnNsaWNlKDAsIHRhYik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVVuaWZpZWREaWZmUmFuZ2UocGF0Y2hUZXh0OiBzdHJpbmcsIHN0cmlwOiBQYXRoU3RyaXApOiBVbmlmaWVkRGlmZlRhcmdldFtdIHwgbnVsbCB7XG4gIGNvbnN0IHJlc3VsdHM6IFVuaWZpZWREaWZmVGFyZ2V0W10gPSBbXTtcbiAgbGV0IHNhd0Jsb2NrID0gZmFsc2U7XG4gIGxldCBjdXJyZW50OiB7XG4gICAgcGF0aDogc3RyaW5nO1xuICAgIGtpbmQ6ICdtb2RpZnknIHwgJ25ldycgfCAnZGVsZXRlZCc7XG4gICAgaHVua3M6IEFycmF5PHsgc3RhcnQ6IG51bWJlcjsgZW5kOiBudW1iZXIgfT47XG4gICAgY291bnRDaGFuZ2luZzogYm9vbGVhbjtcbiAgfSB8IG51bGwgPSBudWxsO1xuICBsZXQgcGVuZGluZ0tpbmQ6ICduZXcnIHwgJ2RlbGV0ZWQnIHwgbnVsbCA9IG51bGw7XG4gIGxldCByZW5hbWVGcm9tOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgbGV0IHJlbmFtZVRvOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgbGV0IGJpbmFyeSA9IGZhbHNlO1xuXG4gIC8qKiBUaGUgaGVhZGVyIHBhdGgsIHRhYi9DUi1zdHJpcHBlZCwgd2l0aCB0aGUgYC1wTmAgbGV2ZWwgYXBwbGllZCBcdTIwMTQgYC9kZXYvbnVsbGAga2VwdCB2ZXJiYXRpbSAodGhlIG1hcmtlciBpcyBuZXZlciBhIHJlYWwgcGF0aCkuICovXG4gIGNvbnN0IHN0cmlwcGVkID0gKHJhdzogc3RyaW5nKTogc3RyaW5nID0+IHtcbiAgICBjb25zdCB0ZXh0ID0gaGVhZGVyUGF0aFRleHQocmF3KTtcbiAgICBpZiAodGV4dCA9PT0gJy9kZXYvbnVsbCcpIHJldHVybiB0ZXh0O1xuICAgIHJldHVybiBzdHJpcFBhdGhDb21wb25lbnRzKHRleHQsIHN0cmlwTGV2ZWxGb3IodGV4dCwgc3RyaXApKTtcbiAgfTtcblxuICBjb25zdCBmaW5pc2ggPSAoKTogdm9pZCA9PiB7XG4gICAgaWYgKGN1cnJlbnQgIT09IG51bGwpIHtcbiAgICAgIGlmIChjdXJyZW50LmtpbmQgPT09ICduZXcnKSByZXN1bHRzLnB1c2goeyBwYXRoOiBjdXJyZW50LnBhdGgsIG9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnIH0pO1xuICAgICAgZWxzZSBpZiAoY3VycmVudC5raW5kID09PSAnZGVsZXRlZCcpIHJlc3VsdHMucHVzaCh7IHBhdGg6IGN1cnJlbnQucGF0aCwgb3BlcmF0aW9uOiAnZGVsZXRlJyB9KTtcbiAgICAgIGVsc2UgaWYgKGJpbmFyeSkgcmVzdWx0cy5wdXNoKHsgcGF0aDogY3VycmVudC5wYXRoLCBvcGVyYXRpb246ICdtb2RpZnknIH0pO1xuICAgICAgZWxzZSBpZiAoY3VycmVudC5odW5rcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgLy8gQSBoZWFkZXItb25seSBibG9jayB3aXRoIG5vIGh1bmtzOiBub3RoaW5nIHN0YXRpY2FsbHkga25vd24uXG4gICAgICB9IGVsc2UgaWYgKGN1cnJlbnQuY291bnRDaGFuZ2luZykgcmVzdWx0cy5wdXNoKHsgcGF0aDogY3VycmVudC5wYXRoLCBvcGVyYXRpb246ICdtb2RpZnknIH0pO1xuICAgICAgZWxzZSB7XG4gICAgICAgIGNvbnN0IHN0YXJ0ID0gTWF0aC5taW4oLi4uY3VycmVudC5odW5rcy5tYXAoKGgpID0+IGguc3RhcnQpKTtcbiAgICAgICAgY29uc3QgZW5kID0gTWF0aC5tYXgoLi4uY3VycmVudC5odW5rcy5tYXAoKGgpID0+IGguZW5kKSk7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7IHBhdGg6IGN1cnJlbnQucGF0aCwgb3BlcmF0aW9uOiAnbW9kaWZ5JywgbGluZVN0YXJ0OiBzdGFydCwgbGluZUVuZDogZW5kIH0pO1xuICAgICAgfVxuICAgICAgY3VycmVudCA9IG51bGw7XG4gICAgfVxuICAgIGlmIChyZW5hbWVGcm9tICE9PSBudWxsKSByZXN1bHRzLnB1c2goeyBwYXRoOiByZW5hbWVGcm9tLCBvcGVyYXRpb246ICdkZWxldGUnIH0pO1xuICAgIGlmIChyZW5hbWVUbyAhPT0gbnVsbCkgcmVzdWx0cy5wdXNoKHsgcGF0aDogcmVuYW1lVG8sIG9wZXJhdGlvbjogJ3JlbmFtZS1jb3B5JyB9KTtcbiAgICByZW5hbWVGcm9tID0gbnVsbDtcbiAgICByZW5hbWVUbyA9IG51bGw7XG4gICAgYmluYXJ5ID0gZmFsc2U7XG4gIH07XG5cbiAgZm9yIChjb25zdCByYXdMaW5lIG9mIHBhdGNoVGV4dC5zcGxpdCgnXFxuJykpIHtcbiAgICAvLyBBIHRyYWlsaW5nIGBcXHJgIChDUkxGIHBhdGNoIHRleHQgXHUyMDE0IFdpbmRvd3MtYXV0aG9yZWQgZGlmZnMpIHBvbGx1dGVzXG4gICAgLy8gaGVhZGVycywgaHVuayBoZWFkZXJzLCBhbmQgcGF0aCBsaW5lcyBhbGlrZTsgYm90aCBwYXRjaCBhbmQgZ2l0IGFwcGx5XG4gICAgLy8gc3RyaXAgaXQsIHNvIHRoZSBwYXJzZXIgZG9lcyB0b28uXG4gICAgY29uc3QgbGluZSA9IHJhd0xpbmUuZW5kc1dpdGgoJ1xccicpID8gcmF3TGluZS5zbGljZSgwLCAtMSkgOiByYXdMaW5lO1xuICAgIGlmIChsaW5lLnN0YXJ0c1dpdGgoJy0tLSAnKSkge1xuICAgICAgc2F3QmxvY2sgPSB0cnVlO1xuICAgICAgaWYgKGN1cnJlbnQgIT09IG51bGwpIGZpbmlzaCgpO1xuICAgICAgY3VycmVudCA9IHtcbiAgICAgICAgcGF0aDogc3RyaXBwZWQobGluZS5zbGljZSg0KSksXG4gICAgICAgIGtpbmQ6IHBlbmRpbmdLaW5kID8/ICdtb2RpZnknLFxuICAgICAgICBodW5rczogW10sXG4gICAgICAgIGNvdW50Q2hhbmdpbmc6IGZhbHNlXG4gICAgICB9O1xuICAgICAgcGVuZGluZ0tpbmQgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChsaW5lLnN0YXJ0c1dpdGgoJysrKyAnKSkge1xuICAgICAgc2F3QmxvY2sgPSB0cnVlO1xuICAgICAgY29uc3QgcGF0aCA9IHN0cmlwcGVkKGxpbmUuc2xpY2UoNCkpO1xuICAgICAgaWYgKGN1cnJlbnQgPT09IG51bGwpIGN1cnJlbnQgPSB7IHBhdGgsIGtpbmQ6IHBlbmRpbmdLaW5kID8/ICdtb2RpZnknLCBodW5rczogW10sIGNvdW50Q2hhbmdpbmc6IGZhbHNlIH07XG4gICAgICBlbHNlIGlmIChwYXRoID09PSAnL2Rldi9udWxsJykgY3VycmVudC5raW5kID0gJ2RlbGV0ZWQnO1xuICAgICAgZWxzZSBpZiAoY3VycmVudC5wYXRoID09PSAnL2Rldi9udWxsJykge1xuICAgICAgICAvLyBBIGAtLS0gL2Rldi9udWxsYCBzaWRlIHJlcGxhY2VkIGJ5IGEgcmVhbCBgKysrYCBwYXRoIGlzIGEgbmV3IGZpbGVcbiAgICAgICAgLy8gKHRoZSBgZGlmZiAtdWAtZm9ybWF0IGNyZWF0aW9uIHNoYXBlIFx1MjAxNCBubyBgbmV3IGZpbGUgbW9kZWAgaGVhZGVyKS5cbiAgICAgICAgLy8gSXRzIGBAQCAtMCwwICtOIEBAYCBodW5rIGhhcyBubyBwcmUtZWRpdCBsaW5lcywgc28gdGhlXG4gICAgICAgIC8vIGNyZWF0ZS1vdmVyd3JpdGUgaXMgZGVjaWRlZCBoZXJlLCBub3QgZnJvbSBodW5rIGNvdmVyYWdlLlxuICAgICAgICBjdXJyZW50LnBhdGggPSBwYXRoO1xuICAgICAgICBjdXJyZW50LmtpbmQgPSAnbmV3JztcbiAgICAgIH1cbiAgICAgIC8vIE90aGVyd2lzZSBrZWVwIHRoZSBgLS0tYCBzaWRlOiBwYXRjaCBhbmQgZ2l0IGFwcGx5IHJld3JpdGUgdGhlIGZpbGVcbiAgICAgIC8vIG5hbWVkIG9uIHRoZSBgLS0tYCBsaW5lLCBhbmQgYGRpZmYgLXUgZiBmLm5ld2AgaGVhZGVycyBuYW1lIHRoZVxuICAgICAgLy8gcHJlLWltYWdlIHRoZXJlIFx1MjAxNCB0aGUgYCsrK2AgcGF0aCBpcyBvbmx5IGEgbGFiZWwgKHRoZSBkaWZmLXV1XG4gICAgICAvLyBwYXRjaC1oZWFkZXIgbWlzcykuXG4gICAgICBwZW5kaW5nS2luZCA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGxpbmUuc3RhcnRzV2l0aCgnbmV3IGZpbGUgbW9kZScpKSB7XG4gICAgICBwZW5kaW5nS2luZCA9ICduZXcnO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChsaW5lLnN0YXJ0c1dpdGgoJ2RlbGV0ZWQgZmlsZSBtb2RlJykpIHtcbiAgICAgIHBlbmRpbmdLaW5kID0gJ2RlbGV0ZWQnO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChsaW5lLnN0YXJ0c1dpdGgoJ3JlbmFtZSBmcm9tICcpKSB7XG4gICAgICBzYXdCbG9jayA9IHRydWU7XG4gICAgICBpZiAoY3VycmVudCAhPT0gbnVsbCkgZmluaXNoKCk7XG4gICAgICByZW5hbWVGcm9tID0gc3RyaXBwZWQobGluZS5zbGljZSgncmVuYW1lIGZyb20gJy5sZW5ndGgpKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZS5zdGFydHNXaXRoKCdyZW5hbWUgdG8gJykpIHtcbiAgICAgIHNhd0Jsb2NrID0gdHJ1ZTtcbiAgICAgIHJlbmFtZVRvID0gc3RyaXBwZWQobGluZS5zbGljZSgncmVuYW1lIHRvICcubGVuZ3RoKSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGxpbmUuc3RhcnRzV2l0aCgnQmluYXJ5IGZpbGVzICcpIHx8IGxpbmUuc3RhcnRzV2l0aCgnR0lUIGJpbmFyeSBwYXRjaCcpKSB7XG4gICAgICBzYXdCbG9jayA9IHRydWU7XG4gICAgICBiaW5hcnkgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGh1bmsgPSBsaW5lLm1hdGNoKEhVTktfSEVBREVSKTtcbiAgICBpZiAoaHVuaykge1xuICAgICAgc2F3QmxvY2sgPSB0cnVlO1xuICAgICAgY29uc3QgcHJlU3RhcnQgPSBOdW1iZXIucGFyc2VJbnQoaHVua1sxXSwgMTApO1xuICAgICAgY29uc3QgcHJlQ291bnQgPSBodW5rWzJdID09PSB1bmRlZmluZWQgPyAxIDogTnVtYmVyLnBhcnNlSW50KGh1bmtbMl0sIDEwKTtcbiAgICAgIGNvbnN0IHBvc3RDb3VudCA9IGh1bmtbNF0gPT09IHVuZGVmaW5lZCA/IDEgOiBOdW1iZXIucGFyc2VJbnQoaHVua1s0XSwgMTApO1xuICAgICAgaWYgKGN1cnJlbnQgPT09IG51bGwpIHJldHVybiBudWxsOyAvLyBhIGh1bmsgd2l0aG91dCBhIGZpbGUgaGVhZGVyIFx1MjE5MiBtYWxmb3JtZWRcbiAgICAgIGlmIChwcmVDb3VudCAhPT0gcG9zdENvdW50KSBjdXJyZW50LmNvdW50Q2hhbmdpbmcgPSB0cnVlO1xuICAgICAgaWYgKHByZUNvdW50ID4gMCkgY3VycmVudC5odW5rcy5wdXNoKHsgc3RhcnQ6IHByZVN0YXJ0LCBlbmQ6IHByZVN0YXJ0ICsgcHJlQ291bnQgLSAxIH0pO1xuICAgIH1cbiAgfVxuICBmaW5pc2goKTtcbiAgcmV0dXJuIHNhd0Jsb2NrID8gcmVzdWx0cyA6IG51bGw7XG59XG4iLCAiLyoqXG4gKiBDbGF1ZGUgUG9zdFRvb2xVc2UgdG91Y2ggaG9vayBcdTIwMTQgdGhpbiBTREstYm91bmQgZW50cnkgcG9pbnQuXG4gKlxuICogRmlyZXMgYWZ0ZXIgYSBzdWNjZXNzZnVsIGBSZWFkYC9gRWRpdGAvYFdyaXRlYCwgb3IgYSBgQmFzaGAgY2FsbCB3aG9zZVxuICogYGNvbW1hbmRgIHN0YXRpY2FsbHkgcmVzb2x2ZXMgdG8gcmVjb2duaXphYmxlIGZpbGUrbGluZS1yYW5nZSBpZGlvbXMuIFRoZVxuICogQ2xhdWRlLXNwZWNpZmljIGpvYiBpcyB0cmFuc2xhdGluZyB0aGUgc3RydWN0dXJlZCBgdG9vbF9pbnB1dGBcbiAqIChgZmlsZV9wYXRoYCwgYG5ld19zdHJpbmdgL2Bjb250ZW50YCwgYG9mZnNldGAvYGxpbWl0YCkgYW5kIGB0b29sX25hbWVgIGludG9cbiAqIGEgaGFybmVzcy1hZ25vc3RpYyB7QGxpbmsgVG91Y2hJbnB1dH0sIHRoZW4gaGFuZGluZyBvZmYgdG8gdGhlIHNoYXJlZFxuICoge0BsaW5rIHJ1blRvdWNoSG9va30gY29yZTogb24gYSB3cml0ZSBpdCBoZWFsc1xuICogcG9zaXRpb25hbCBzcGFuIGRyaWZ0IGluIHRoZSB3b3JraW5nIHRyZWUgKGBnaXQgc3BhbiBkcmlmdCA8ZmlsZT4gLS1maXhgKSBhbmRcbiAqIGZvbGRzIGFueSBzZW1hbnRpYyByZXNpZHVlIGludG8gb25lIGA8Z2l0LXNwYW4+YCBibG9jazsgb24gYSByZWFkIGl0IHN1cmZhY2VzXG4gKiBzcGFucyBvdmVybGFwcGluZyB0aGUgcmVhZCdzIGBvZmZzZXRgL2BsaW1pdGAgd2luZG93ICh3aG9sZS1maWxlIHdoZW4gbmVpdGhlclxuICogaXMgZ2l2ZW4pIHdpdGggcG9zaXRpb25hbCBzdGF0dXNlcyBmaWx0ZXJlZCBvdXQsIGFuZCBuZXZlciBtdXRhdGVzIHRoZSB0cmVlLlxuICpcbiAqIFRoZSBibG9jayByZWFjaGVzIHRoZSBtb2RlbCBsb29wIHZpYSBgaG9va1NwZWNpZmljT3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0YCBhbmRcbiAqIHRoZSB1c2VyLWZhY2luZyBVSSB2aWEgYHN5c3RlbU1lc3NhZ2VgLiBGYWlsLW9wZW4gaXMgbG9hZC1iZWFyaW5nOiBhbiBhYnNlbnRcbiAqIENMSS9gLnNwYW4vYCwgdGltZW91dCwgb3Igbm9uLXplcm8gZXhpdCB5aWVsZHMgbm8gc2lnbmFsIGFuZCBuZXZlciBibG9ja3MgdGhlXG4gKiB0b29sIGNhbGwuIFRoZSB0aW1lb3V0IGlzIG1pbGxpc2Vjb25kcyBoZXJlICh0aGUgQ2xhdWRlIENMSSBlbWl0cyBtcyBpbnRvXG4gKiBgaG9va3MuanNvbmApOyBDb2RleCdzIGVxdWl2YWxlbnQgc291cmNlIHZhbHVlIGlzIGRpdmlkZWQgdG8gc2Vjb25kcyBhdCBlbWl0LlxuICovXG5cbmltcG9ydCB7XG4gIHR5cGUgSG9va0NvbnRleHQsXG4gIHR5cGUgUG9zdFRvb2xVc2VJbnB1dCxcbiAgcG9zdFRvb2xVc2VIb29rLFxuICBwb3N0VG9vbFVzZU91dHB1dFxufSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuaW1wb3J0IHsgZGVyaXZlUGF0aCB9IGZyb20gJy4uL2NvbW1vbi9hZ2VudC1ob29rcy1jb21tb24uanMnO1xuaW1wb3J0IHsgYmFzaFJlc3BvbnNlSW50ZXJydXB0ZWQsIHJ1bkJhc2hUb3VjaGVzIH0gZnJvbSAnLi4vY29tbW9uL2Jhc2gtdG91Y2guanMnO1xuaW1wb3J0IHsgcGFyc2VDb21tYW5kRGV0YWlsZWQgfSBmcm9tICcuLi9jb21tb24vcGFyc2UtY29tbWFuZC5qcyc7XG5pbXBvcnQgeyBjcmVhdGVEaXNrTWVtb1N0b3JlLCB0eXBlIE1lbW9GYWN0b3J5LCByZXNvbHZlVG91Y2hTY29wZSB9IGZyb20gJy4uL2NvbW1vbi9zcGFuLXN1cmZhY2UuanMnO1xuaW1wb3J0IHtcbiAgY3JlYXRlRGVmYXVsdFRvdWNoRXhlY3V0b3JzLFxuICBydW5Ub3VjaEhvb2ssXG4gIHR5cGUgVG91Y2hFeGVjdXRvcnMsXG4gIHR5cGUgVG91Y2hJbnB1dFxufSBmcm9tICcuLi9jb21tb24vdG91Y2gtY29yZS5qcyc7XG5cbnR5cGUgVG9vbElucHV0ID0gUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG5cbi8qKiBSZWFkIGEgYFRvb2xJbnB1dGAgZmllbGQgYXMgYSBwb3NpdGl2ZSBpbnRlZ2VyLCBvciBgdW5kZWZpbmVkYCB3aGVuIGFic2VudC9pbnZhbGlkLiAqL1xuZnVuY3Rpb24gcG9zaXRpdmVJbnRGaWVsZCh0b29sSW5wdXQ6IFRvb2xJbnB1dCwgZmllbGQ6IHN0cmluZyk6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IHJhdyA9IHRvb2xJbnB1dFtmaWVsZF07XG4gIHJldHVybiB0eXBlb2YgcmF3ID09PSAnbnVtYmVyJyAmJiBOdW1iZXIuaXNJbnRlZ2VyKHJhdykgJiYgcmF3ID4gMCA/IHJhdyA6IHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBUcmFuc2xhdGUgYSBDbGF1ZGUgdG9vbCBjYWxsIGludG8gYSB7QGxpbmsgVG91Y2hJbnB1dH0uIGBSZWFkYCBpcyBhIHJlYWQgdG91Y2hcbiAqIGNhcnJ5aW5nIGl0cyBgb2Zmc2V0YC9gbGltaXRgICh3aGVuIHByZXNlbnQpIGZvciByYW5nZS1wcmVjaXNlIHNjb3Bpbmc7XG4gKiBgRWRpdGAvYFdyaXRlYCBhcmUgd3JpdGUgdG91Y2hlcyB3aG9zZSBgd3JpdHRlbmAgYmxvY2sgaXMgdGhlIG5ldyBjb250ZW50IHRoZVxuICogdG9vbCBqdXN0IGFwcGxpZWQgKGBuZXdfc3RyaW5nYCBmb3IgRWRpdCwgYGNvbnRlbnRgIGZvciBXcml0ZSkuIEFuIHVua25vd24gdG9vbFxuICogb3IgYSBub24tc3RyaW5nIGNvbnRlbnQgZmllbGQgeWllbGRzIGBudWxsYCAobm90aGluZyB0byBkbykuXG4gKi9cbmZ1bmN0aW9uIHRvVG91Y2hJbnB1dChcbiAgdG9vbE5hbWU6IHN0cmluZyxcbiAgdG9vbElucHV0OiBUb29sSW5wdXQsXG4gIHNlc3Npb25JZDogc3RyaW5nLFxuICBjd2Q6IHN0cmluZyxcbiAgZmlsZVBhdGg6IHN0cmluZ1xuKTogVG91Y2hJbnB1dCB8IG51bGwge1xuICBpZiAodG9vbE5hbWUgPT09ICdSZWFkJykge1xuICAgIGNvbnN0IG9mZnNldCA9IHBvc2l0aXZlSW50RmllbGQodG9vbElucHV0LCAnb2Zmc2V0Jyk7XG4gICAgY29uc3QgbGltaXQgPSBwb3NpdGl2ZUludEZpZWxkKHRvb2xJbnB1dCwgJ2xpbWl0Jyk7XG4gICAgcmV0dXJuIHsga2luZDogJ3JlYWQnLCBzZXNzaW9uSWQsIGN3ZCwgZmlsZVBhdGgsIG9mZnNldCwgbGltaXQgfTtcbiAgfVxuICBpZiAodG9vbE5hbWUgPT09ICdFZGl0JyB8fCB0b29sTmFtZSA9PT0gJ1dyaXRlJykge1xuICAgIGNvbnN0IHJhdyA9IHRvb2xOYW1lID09PSAnRWRpdCcgPyB0b29sSW5wdXQubmV3X3N0cmluZyA6IHRvb2xJbnB1dC5jb250ZW50O1xuICAgIGNvbnN0IHdyaXR0ZW4gPSB0eXBlb2YgcmF3ID09PSAnc3RyaW5nJyA/IHJhdyA6ICcnO1xuICAgIC8vIFRoZSBFZGl0L1dyaXRlIHBhdGggcGFzc2VzICdleGlzdHMnIFx1MjAxNCB0aGUgdG9vbCByYW4sIHNvIHRoZSBmaWxlIGlzXG4gICAgLy8gcHJlc2VudDsgdGhlIHdyaXRlIGdhdGUgKHBsYW4gXHUwMEE3MyBzdGVwIDEpIHZlcmlmaWVzIGl0IGJlZm9yZSBhbnlcbiAgICAvLyBleGVjdXRvciBjYWxsLlxuICAgIHJldHVybiB7IGtpbmQ6ICd3cml0ZScsIHNlc3Npb25JZCwgY3dkLCBmaWxlUGF0aCwgd3JpdHRlbiwgdGFyZ2V0U3RhdGU6ICdleGlzdHMnIH07XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVIYW5kbGVyKFxuICBleGVjdXRvcnM6IFRvdWNoRXhlY3V0b3JzID0gY3JlYXRlRGVmYXVsdFRvdWNoRXhlY3V0b3JzKCksXG4gIG1lbW9GYWN0b3J5OiBNZW1vRmFjdG9yeSA9IGNyZWF0ZURpc2tNZW1vU3RvcmVcbikge1xuICByZXR1cm4gYXN5bmMgKGlucHV0OiBQb3N0VG9vbFVzZUlucHV0LCBjdHg6IEhvb2tDb250ZXh0KSA9PiB7XG4gICAgY29uc3QgbWVtbyA9IG1lbW9GYWN0b3J5KGN0eC5sb2dnZXIpO1xuICAgIGNvbnN0IHNlc3Npb25JZCA9IGlucHV0LnNlc3Npb25faWQ7XG4gICAgY29uc3QgY3dkID0gaW5wdXQuY3dkID8/ICcnO1xuICAgIGNvbnN0IHRvb2xOYW1lID0gaW5wdXQudG9vbF9uYW1lO1xuICAgIGNvbnN0IHRvb2xJbnB1dCA9IChpbnB1dC50b29sX2lucHV0ID8/IHt9KSBhcyBUb29sSW5wdXQ7XG5cbiAgICAvLyBCYXNoIGhhcyBubyBgZmlsZV9wYXRoYCBmaWVsZCwgc28gaXQgZ2V0cyBpdHMgb3duIGJyYW5jaDogcnVuIHRoZSBzdGF0aWNcbiAgICAvLyBjb21tYW5kIHBhcnNlciBhbmQgaGFuZCB0aGUgbWF0Y2hlcyB0byB0aGUgc2hhcmVkIGBydW5CYXNoVG91Y2hlc2BcbiAgICAvLyBkcml2ZXIgKHBsYW4gXHUwMEE3MyBzdGVwIDIpLCB3aGljaCBvd25zIHRoZSBwZXItY29tbWFuZCB2ZXJkaWN0IHRocmVhZCBcdTIwMTRcbiAgICAvLyBwb3N0LXN0YXRlIGdhdGVzLCBqb2luIGZpbHRlcmluZywgYW5kIHRoZSBpbnRlcnJ1cHRlZCBnYXRlIChwbGFuIFx1MDBBNzQpIFx1MjAxNFxuICAgIC8vIGFuZCByZXR1cm5zIHRoZSBtZXJnZWQgYmxvY2tzIGZvciB0aGUgYWRhcHRlcnMnIG91dHB1dCBidWlsZGVycy4gQVxuICAgIC8vIGNvbW1hbmQgd2l0aCBubyByZWNvZ25pemFibGUgaWRpb20geWllbGRzIG5vIGJsb2NrcyBhbmQgcmV0dXJucyBgbnVsbGAgXHUyMDE0XG4gICAgLy8gZmFpbC1vcGVuLCBzYW1lIGFzIHRoZSB0b29sIHBhdGggYmVsb3cuXG4gICAgaWYgKHRvb2xOYW1lID09PSAnQmFzaCcpIHtcbiAgICAgIGNvbnN0IGNvbW1hbmQgPSB0eXBlb2YgdG9vbElucHV0LmNvbW1hbmQgPT09ICdzdHJpbmcnID8gdG9vbElucHV0LmNvbW1hbmQgOiBudWxsO1xuICAgICAgaWYgKCFjb21tYW5kKSByZXR1cm4gbnVsbDtcbiAgICAgIC8vIEFuIGludGVycnVwdGVkIGNvbW1hbmQgcHJvZHVjZXMgbm8gdG91Y2hlcywgd2hhdGV2ZXIgaXRzIHNwYW5zOyB0aGVcbiAgICAgIC8vIGRyaXZlciByZS1jaGVja3MgZGVmZW5zaXZlbHkuXG4gICAgICBpZiAoYmFzaFJlc3BvbnNlSW50ZXJydXB0ZWQoaW5wdXQudG9vbF9yZXNwb25zZSkpIHJldHVybiBudWxsO1xuICAgICAgY29uc3QgbWF0Y2hlcyA9IHBhcnNlQ29tbWFuZERldGFpbGVkKGNvbW1hbmQsIGN3ZCk7XG4gICAgICBjb25zdCBibG9ja3MgPSBhd2FpdCBydW5CYXNoVG91Y2hlcyhtYXRjaGVzLCBzZXNzaW9uSWQsIGN3ZCwgaW5wdXQudG9vbF9yZXNwb25zZSwgZXhlY3V0b3JzLCBtZW1vLCAobWVzc2FnZSkgPT5cbiAgICAgICAgY3R4LmxvZ2dlci53YXJuKG1lc3NhZ2UpXG4gICAgICApO1xuICAgICAgaWYgKGJsb2Nrcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICAgICAgY29uc3QgY29tYmluZWQgPSBibG9ja3Muam9pbignJyk7XG4gICAgICByZXR1cm4gcG9zdFRvb2xVc2VPdXRwdXQoe1xuICAgICAgICBob29rU3BlY2lmaWNPdXRwdXQ6IHsgYWRkaXRpb25hbENvbnRleHQ6IGNvbWJpbmVkIH0sXG4gICAgICAgIHN5c3RlbU1lc3NhZ2U6IGNvbWJpbmVkXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBhYnNQYXRoID0gZGVyaXZlUGF0aCh0b29sSW5wdXQsIGN3ZCk7XG4gICAgaWYgKCFhYnNQYXRoKSByZXR1cm4gbnVsbDtcblxuICAgIC8vIEJvdW5kIHRoZSB0b3VjaCB0byB0aGUgQ1dEIHJlcG8gKGRyb3BzIGNyb3NzLXJlcG8sIGdpdGlnbm9yZWQsIGFuZCBzcGFuXG4gICAgLy8gZG9jdW1lbnRzKS4gRmFpbCBjbG9zZWQgb24gYW4gdW5yZXNvbHZhYmxlIENXRCByZXBvLlxuICAgIGNvbnN0IHNjb3BlID0gcmVzb2x2ZVRvdWNoU2NvcGUoY3dkLCBhYnNQYXRoKTtcbiAgICBpZiAoIXNjb3BlKSByZXR1cm4gbnVsbDtcblxuICAgIGNvbnN0IHRvdWNoID0gdG9Ub3VjaElucHV0KHRvb2xOYW1lLCB0b29sSW5wdXQsIHNlc3Npb25JZCwgY3dkLCBhYnNQYXRoKTtcbiAgICBpZiAoIXRvdWNoKSByZXR1cm4gbnVsbDtcblxuICAgIGNvbnN0IG91dHB1dCA9IGF3YWl0IHJ1blRvdWNoSG9vayh0b3VjaCwgZXhlY3V0b3JzLCBtZW1vKTtcbiAgICBpZiAoIW91dHB1dC5hZGRpdGlvbmFsQ29udGV4dCkgcmV0dXJuIG51bGw7XG5cbiAgICByZXR1cm4gcG9zdFRvb2xVc2VPdXRwdXQoe1xuICAgICAgaG9va1NwZWNpZmljT3V0cHV0OiB7IGFkZGl0aW9uYWxDb250ZXh0OiBvdXRwdXQuYWRkaXRpb25hbENvbnRleHQgfSxcbiAgICAgIHN5c3RlbU1lc3NhZ2U6IG91dHB1dC5hZGRpdGlvbmFsQ29udGV4dFxuICAgIH0pO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBwb3N0VG9vbFVzZUhvb2soeyBtYXRjaGVyOiAnUmVhZHxFZGl0fFdyaXRlfEJhc2gnLCB0aW1lb3V0OiAxMF8wMDAgfSwgY3JlYXRlSGFuZGxlcigpKTtcbiIsICJpbXBvcnQgaG9vayBmcm9tICcuL3Bvc3QtdG9vbC11c2UudHMnO1xuaW1wb3J0IHsgZXhlY3V0ZSB9IGZyb20gJy4uLy4uLy4uLy4uL25vZGVfbW9kdWxlcy9AZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3Mv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SDtBQUVBLFVBQU0sVUFBVSxXQUFXLFdBQVcsR0FBRztBQUN6QyxRQUFJLENBQUMsUUFBUyxRQUFPO0FBSXJCLFVBQU0sUUFBUSxrQkFBa0IsS0FBSyxPQUFPO0FBQzVDLFFBQUksQ0FBQyxNQUFPLFFBQU87QUFFbkIsVUFBTSxRQUFRLGFBQWEsVUFBVSxXQUFXLFdBQVcsS0FBSyxPQUFPO0FBQ3ZFLFFBQUksQ0FBQyxNQUFPLFFBQU87QUFFbkIsVUFBTSxTQUFTLE1BQU0sYUFBYSxPQUFPLFdBQVcsSUFBSTtBQUN4RCxRQUFJLENBQUMsT0FBTyxrQkFBbUIsUUFBTztBQUV0QyxXQUFPLGtCQUFrQjtBQUFBLE1BQ3ZCLG9CQUFvQixFQUFFLG1CQUFtQixPQUFPLGtCQUFrQjtBQUFBLE1BQ2xFLGVBQWUsT0FBTztBQUFBLElBQ3hCLENBQUM7QUFBQSxFQUNIO0FBQ0Y7QUFFQSxJQUFPLHdCQUFRLGdCQUFnQixFQUFFLFNBQVMsd0JBQXdCLFNBQVMsSUFBTyxHQUFHLGNBQWMsQ0FBQzs7O0FDbElwRyxRQUFRLHFCQUFJOyIsCiAgIm5hbWVzIjogWyJyZXNvbHZlIiwgImZzIiwgImV4ZWNGaWxlU3luYyIsICJmcyIsICJub2RlUGF0aCIsICJmcyIsICJub2RlUGF0aCIsICJsb2dnZXIiLCAiZXhlY0ZpbGVTeW5jIiwgImZzIiwgImJhc2VuYW1lIiwgImpvaW4iLCAiZXhlY0ZpbGVTeW5jIiwgImpvaW4iLCAiYmFzZW5hbWUiLCAiam9pbiIsICJyZWFkRmlsZVN5bmMiLCAic3RhdFN5bmMiLCAiYmFzZW5hbWUiLCAiZXhlY0ZpbGVTeW5jIiwgInJlYWRGaWxlU3luYyIsICJzdGF0U3luYyIsICJqb2luIiwgInN0YXRTeW5jIiwgImJhc2VuYW1lIiwgInJlYWRGaWxlU3luYyIsICJ0b2tlbnMiXQp9Cg==

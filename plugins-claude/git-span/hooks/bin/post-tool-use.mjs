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
          const indexStatus = entry.charAt(0);
          const worktreeStatus = entry.charAt(1);
          if (indexStatus === " " && worktreeStatus === " ") continue;
          if (indexStatus === "?" || indexStatus === "!" || worktreeStatus === "?" || worktreeStatus === "!") {
            continue;
          }
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcy9kaXN0L2Vudi5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL3NwYW4tc3VyZmFjZS50cyIsICJzcmMvY29tbW9uL3NwYW4taWdub3JlLnRzIiwgInNyYy9jb21tb24vdG91Y2gtY29yZS50cyIsICJzcmMvY29tbW9uL2FuY2hvci10cmVlLnRzIiwgInNyYy9jb21tb24vYmFzaC10b3VjaC50cyIsICJzcmMvY29tbW9uL3BhcnNlLWNvbW1hbmQudHMiLCAic3JjL2NvbW1vbi9jb21tYW5kLXJlc29sdmUudHMiLCAic3JjL2NvbW1vbi9zaGVsbC1zcGxpdC50cyIsICJzcmMvY29tbW9uL3VuaWZpZWQtZGlmZi50cyIsICJzcmMvY2xhdWRlL3Bvc3QtdG9vbC11c2UudHMiLCAic3JjL2NsYXVkZS9wb3N0LXRvb2wtdXNlLWVudHJ5LnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvKipcbiAqIEVudmlyb25tZW50IHZhcmlhYmxlIHV0aWxpdGllcyBmb3IgQ2xhdWRlIENvZGUgaG9va3MuXG4gKlxuICogUHJvdmlkZXMgdHlwZWQgYWNjZXNzIHRvIENsYXVkZSBDb2RlJ3MgZW52aXJvbm1lbnQgdmFyaWFibGVzIGFuZCB1dGlsaXRpZXNcbiAqIGZvciBwZXJzaXN0aW5nIGVudmlyb25tZW50IHZhcmlhYmxlcyBpbiBTZXNzaW9uU3RhcnQgaG9va3MuXG4gKlxuICogIyMgRW52aXJvbm1lbnQgVmFyaWFibGVzXG4gKlxuICogQ2xhdWRlIENvZGUgc2V0cyB0aGVzZSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgd2hlbiBydW5uaW5nIGhvb2tzOlxuICpcbiAqIHwgVmFyaWFibGUgfCBEZXNjcmlwdGlvbiB8IEF2YWlsYWJsZSBJbiB8XG4gKiB8LS0tLS0tLS0tLXwtLS0tLS0tLS0tLS0tfC0tLS0tLS0tLS0tLS0tfFxuICogfCBgQ0xBVURFX1BST0pFQ1RfRElSYCB8IEFic29sdXRlIHBhdGggdG8gcHJvamVjdCByb290IHwgQWxsIGhvb2tzIHxcbiAqIHwgYENMQVVERV9FTlZfRklMRWAgfCBQYXRoIHRvIGZpbGUgZm9yIHBlcnNpc3RpbmcgZW52IHZhcnMgfCBTZXNzaW9uU3RhcnQgb25seSB8XG4gKiB8IGBDTEFVREVfQ09ERV9SRU1PVEVgIHwgYFwidHJ1ZVwiYCBpZiBydW5uaW5nIHJlbW90ZWx5IHwgQWxsIGhvb2tzIHxcbiAqIEBtb2R1bGVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBnZXRQcm9qZWN0RGlyLCBwZXJzaXN0RW52VmFyLCBpc1JlbW90ZUVudmlyb25tZW50IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBHZXQgcHJvamVjdCBkaXJlY3RvcnlcbiAqIGNvbnN0IHByb2plY3REaXIgPSBnZXRQcm9qZWN0RGlyKCk7XG4gKlxuICogLy8gQ2hlY2sgaWYgcnVubmluZyByZW1vdGVseVxuICogaWYgKGlzUmVtb3RlRW52aXJvbm1lbnQoKSkge1xuICogICAvLyBIYW5kbGUgcmVtb3RlLXNwZWNpZmljIGxvZ2ljXG4gKiB9XG4gKlxuICogLy8gSW4gU2Vzc2lvblN0YXJ0IGhvb2s6IHBlcnNpc3QgZW52aXJvbm1lbnQgdmFyaWFibGVzXG4gKiBwZXJzaXN0RW52VmFyKCdOT0RFX0VOVicsICdwcm9kdWN0aW9uJyk7XG4gKiBwZXJzaXN0RW52VmFyKCdBUElfS0VZJywgJ3NlY3JldC1rZXknKTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI2hvb2stZXhlY3V0aW9uLWRldGFpbHNcbiAqL1xuaW1wb3J0ICogYXMgZnMgZnJvbSBcIm5vZGU6ZnNcIjtcbi8qKlxuICogQ2xhdWRlIENvZGUgZW52aXJvbm1lbnQgdmFyaWFibGUgbmFtZXMuXG4gKlxuICogVGhlc2UgYXJlIHRoZSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgdGhhdCBDbGF1ZGUgQ29kZSBzZXRzIHdoZW4gcnVubmluZyBob29rcy5cbiAqL1xuZXhwb3J0IGNvbnN0IENMQVVERV9FTlZfVkFSUyA9IHtcbiAgICAvKipcbiAgICAgKiBBYnNvbHV0ZSBwYXRoIHRvIHRoZSBwcm9qZWN0IHJvb3QgZGlyZWN0b3J5IHdoZXJlIENsYXVkZSBDb2RlIHdhcyBzdGFydGVkLlxuICAgICAqIEF2YWlsYWJsZSBpbiBhbGwgaG9va3MuXG4gICAgICovXG4gICAgUFJPSkVDVF9ESVI6IFwiQ0xBVURFX1BST0pFQ1RfRElSXCIsXG4gICAgLyoqXG4gICAgICogUGF0aCB0byBhIGZpbGUgd2hlcmUgU2Vzc2lvblN0YXJ0IGhvb2tzIGNhbiBwZXJzaXN0IGVudmlyb25tZW50IHZhcmlhYmxlcy5cbiAgICAgKiBWYXJpYWJsZXMgd3JpdHRlbiB0byB0aGlzIGZpbGUgd2lsbCBiZSBhdmFpbGFibGUgaW4gYWxsIHN1YnNlcXVlbnQgYmFzaCBjb21tYW5kcy5cbiAgICAgKiBPbmx5IGF2YWlsYWJsZSBpbiBTZXNzaW9uU3RhcnQgaG9va3MuXG4gICAgICovXG4gICAgRU5WX0ZJTEU6IFwiQ0xBVURFX0VOVl9GSUxFXCIsXG4gICAgLyoqXG4gICAgICogU2V0IHRvIFwidHJ1ZVwiIHdoZW4gcnVubmluZyBpbiBhIHJlbW90ZSAod2ViKSBlbnZpcm9ubWVudC5cbiAgICAgKiBOb3Qgc2V0IG9yIGVtcHR5IHdoZW4gcnVubmluZyBpbiBsb2NhbCBDTEkgZW52aXJvbm1lbnQuXG4gICAgICovXG4gICAgUkVNT1RFOiBcIkNMQVVERV9DT0RFX1JFTU9URVwiLFxufTtcbi8qKlxuICogR2V0cyB0aGUgQ2xhdWRlIENvZGUgcHJvamVjdCBkaXJlY3RvcnkuXG4gKlxuICogVGhpcyBpcyB0aGUgYWJzb2x1dGUgcGF0aCB0byB0aGUgcHJvamVjdCByb290IHdoZXJlIENsYXVkZSBDb2RlIHdhcyBzdGFydGVkLlxuICogVGhlIHZhbHVlIGNvbWVzIGZyb20gdGhlIGBDTEFVREVfUFJPSkVDVF9ESVJgIGVudmlyb25tZW50IHZhcmlhYmxlLlxuICogQHJldHVybnMgVGhlIHByb2plY3QgZGlyZWN0b3J5IHBhdGgsIG9yIHVuZGVmaW5lZCBpZiBub3Qgc2V0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogY29uc3QgcHJvamVjdERpciA9IGdldFByb2plY3REaXIoKTtcbiAqIGlmIChwcm9qZWN0RGlyKSB7XG4gKiAgIGNvbnN0IGNvbmZpZ1BhdGggPSBgJHtwcm9qZWN0RGlyfS8uY2xhdWRlL2NvbmZpZy5qc29uYDtcbiAqIH1cbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0UHJvamVjdERpcigpIHtcbiAgICByZXR1cm4gcHJvY2Vzcy5lbnZbQ0xBVURFX0VOVl9WQVJTLlBST0pFQ1RfRElSXTtcbn1cbi8qKlxuICogR2V0cyB0aGUgQ2xhdWRlIENvZGUgZW52IGZpbGUgcGF0aCBmb3IgcGVyc2lzdGluZyBlbnZpcm9ubWVudCB2YXJpYWJsZXMuXG4gKlxuICogVGhpcyBpcyBvbmx5IGF2YWlsYWJsZSBpbiBTZXNzaW9uU3RhcnQgaG9va3MuIFRoZSBwYXRoIHBvaW50cyB0byBhIGZpbGVcbiAqIHdoZXJlIHlvdSBjYW4gd3JpdGUgc2hlbGwgZXhwb3J0IHN0YXRlbWVudHMgdG8gcGVyc2lzdCBlbnZpcm9ubWVudCB2YXJpYWJsZXNcbiAqIGZvciBhbGwgc3Vic2VxdWVudCBiYXNoIGNvbW1hbmRzIGluIHRoZSBzZXNzaW9uLlxuICogQHJldHVybnMgVGhlIGVudiBmaWxlIHBhdGgsIG9yIHVuZGVmaW5lZCBpZiBub3Qgc2V0IChub3QgYSBTZXNzaW9uU3RhcnQgaG9vaylcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCBlbnZGaWxlID0gZ2V0RW52RmlsZVBhdGgoKTtcbiAqIGlmIChlbnZGaWxlKSB7XG4gKiAgIC8vIFdlJ3JlIGluIGEgU2Vzc2lvblN0YXJ0IGhvb2sgYW5kIGNhbiBwZXJzaXN0IGVudiB2YXJzXG4gKiAgIHBlcnNpc3RFbnZWYXIoJ01ZX1ZBUicsICdteS12YWx1ZScpO1xuICogfVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRFbnZGaWxlUGF0aCgpIHtcbiAgICByZXR1cm4gcHJvY2Vzcy5lbnZbQ0xBVURFX0VOVl9WQVJTLkVOVl9GSUxFXTtcbn1cbi8qKlxuICogQ2hlY2tzIGlmIHRoZSBob29rIGlzIHJ1bm5pbmcgaW4gYSByZW1vdGUgKHdlYikgZW52aXJvbm1lbnQuXG4gKlxuICogUmVtb3RlIGVudmlyb25tZW50cyBtYXkgaGF2ZSBkaWZmZXJlbnQgY2FwYWJpbGl0aWVzIG9yIHJlc3RyaWN0aW9uc1xuICogY29tcGFyZWQgdG8gbG9jYWwgQ0xJIGVudmlyb25tZW50cy5cbiAqIEByZXR1cm5zIHRydWUgaWYgcnVubmluZyByZW1vdGVseSwgZmFsc2UgaWYgcnVubmluZyBsb2NhbGx5XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaWYgKGlzUmVtb3RlRW52aXJvbm1lbnQoKSkge1xuICogICAvLyBVc2Ugd2ViLWNvbXBhdGlibGUgYXBwcm9hY2hlc1xuICogfSBlbHNlIHtcbiAqICAgLy8gQ2FuIHVzZSBsb2NhbCBDTEkgZmVhdHVyZXNcbiAqIH1cbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNSZW1vdGVFbnZpcm9ubWVudCgpIHtcbiAgICByZXR1cm4gcHJvY2Vzcy5lbnZbQ0xBVURFX0VOVl9WQVJTLlJFTU9URV0gPT09IFwidHJ1ZVwiO1xufVxuLyoqXG4gKiBQZXJzaXN0cyBhbiBlbnZpcm9ubWVudCB2YXJpYWJsZSBmb3IgdXNlIGluIHN1YnNlcXVlbnQgYmFzaCBjb21tYW5kcy5cbiAqXG4gKiBUaGlzIGZ1bmN0aW9uIHdyaXRlcyBhIHNoZWxsIGV4cG9ydCBzdGF0ZW1lbnQgdG8gdGhlIGBDTEFVREVfRU5WX0ZJTEVgLFxuICogd2hpY2ggQ2xhdWRlIENvZGUgc291cmNlcyBiZWZvcmUgcnVubmluZyBiYXNoIGNvbW1hbmRzLiBUaGlzIGFsbG93c1xuICogU2Vzc2lvblN0YXJ0IGhvb2tzIHRvIGNvbmZpZ3VyZSB0aGUgZW52aXJvbm1lbnQgZm9yIHRoZSBlbnRpcmUgc2Vzc2lvbi5cbiAqXG4gKiAqKkltcG9ydGFudCoqOiBUaGlzIGZ1bmN0aW9uIG9ubHkgd29ya3MgaW4gU2Vzc2lvblN0YXJ0IGhvb2tzIHdoZXJlXG4gKiBgQ0xBVURFX0VOVl9GSUxFYCBpcyBzZXQuIEluIG90aGVyIGhvb2tzLCBpdCB3aWxsIHRocm93IGFuIGVycm9yLlxuICogQHBhcmFtIG5hbWUgLSBUaGUgZW52aXJvbm1lbnQgdmFyaWFibGUgbmFtZVxuICogQHBhcmFtIHZhbHVlIC0gVGhlIGVudmlyb25tZW50IHZhcmlhYmxlIHZhbHVlICh3aWxsIGJlIHNoZWxsLWVzY2FwZWQpXG4gKiBAdGhyb3dzIEVycm9yIGlmIENMQVVERV9FTlZfRklMRSBpcyBub3Qgc2V0IChub3QgaW4gYSBTZXNzaW9uU3RhcnQgaG9vaylcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBzZXNzaW9uU3RhcnRIb29rLCBzZXNzaW9uU3RhcnRPdXRwdXQsIHBlcnNpc3RFbnZWYXIgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIGV4cG9ydCBkZWZhdWx0IHNlc3Npb25TdGFydEhvb2soe30sIGFzeW5jIChpbnB1dCkgPT4ge1xuICogICAvLyBQZXJzaXN0IGVudmlyb25tZW50IHZhcmlhYmxlcyBmb3IgdGhlIHNlc3Npb25cbiAqICAgcGVyc2lzdEVudlZhcignTk9ERV9FTlYnLCAncHJvZHVjdGlvbicpO1xuICogICBwZXJzaXN0RW52VmFyKCdBUElfS0VZJywgcHJvY2Vzcy5lbnYuTVlfQVBJX0tFWSA/PyAnZGVmYXVsdCcpO1xuICogICBwZXJzaXN0RW52VmFyKCdQQVRIJywgYCR7cHJvY2Vzcy5lbnYuUEFUSH06Li9ub2RlX21vZHVsZXMvLmJpbmApO1xuICpcbiAqICAgcmV0dXJuIHNlc3Npb25TdGFydE91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3BlcnNpc3RpbmctZW52aXJvbm1lbnQtdmFyaWFibGVzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwZXJzaXN0RW52VmFyKG5hbWUsIHZhbHVlKSB7XG4gICAgY29uc3QgZW52RmlsZSA9IGdldEVudkZpbGVQYXRoKCk7XG4gICAgaWYgKGVudkZpbGUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJwZXJzaXN0RW52VmFyIGNhbiBvbmx5IGJlIHVzZWQgaW4gU2Vzc2lvblN0YXJ0IGhvb2tzLiBcIiArIFwiQ0xBVURFX0VOVl9GSUxFIGVudmlyb25tZW50IHZhcmlhYmxlIGlzIG5vdCBzZXQuXCIpO1xuICAgIH1cbiAgICAvLyBTaGVsbC1lc2NhcGUgdGhlIHZhbHVlIHRvIGhhbmRsZSBzcGVjaWFsIGNoYXJhY3RlcnNcbiAgICBjb25zdCBlc2NhcGVkVmFsdWUgPSBlc2NhcGVTaGVsbFZhbHVlKHZhbHVlKTtcbiAgICAvLyBXcml0ZSB0aGUgZXhwb3J0IHN0YXRlbWVudFxuICAgIGNvbnN0IGV4cG9ydFN0YXRlbWVudCA9IGBleHBvcnQgJHtuYW1lfT0ke2VzY2FwZWRWYWx1ZX1cXG5gO1xuICAgIGZzLmFwcGVuZEZpbGVTeW5jKGVudkZpbGUsIGV4cG9ydFN0YXRlbWVudCwgXCJ1dGYtOFwiKTtcbn1cbi8qKlxuICogUGVyc2lzdHMgbXVsdGlwbGUgZW52aXJvbm1lbnQgdmFyaWFibGVzIGF0IG9uY2UuXG4gKlxuICogVGhpcyBpcyBhIGNvbnZlbmllbmNlIHdyYXBwZXIgYXJvdW5kIGBwZXJzaXN0RW52VmFyYCBmb3Igc2V0dGluZ1xuICogbXVsdGlwbGUgdmFyaWFibGVzIGluIGEgc2luZ2xlIGNhbGwuXG4gKiBAcGFyYW0gdmFycyAtIE9iamVjdCBtYXBwaW5nIHZhcmlhYmxlIG5hbWVzIHRvIHZhbHVlc1xuICogQHRocm93cyBFcnJvciBpZiBDTEFVREVfRU5WX0ZJTEUgaXMgbm90IHNldCAobm90IGluIGEgU2Vzc2lvblN0YXJ0IGhvb2spXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogcGVyc2lzdEVudlZhcnMoe1xuICogICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxuICogICBBUElfS0VZOiAnc2VjcmV0JyxcbiAqICAgREVCVUc6ICdmYWxzZSdcbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwZXJzaXN0RW52VmFycyh2YXJzKSB7XG4gICAgZm9yIChjb25zdCBbbmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHZhcnMpKSB7XG4gICAgICAgIHBlcnNpc3RFbnZWYXIobmFtZSwgdmFsdWUpO1xuICAgIH1cbn1cbi8qKlxuICogRXNjYXBlcyBhIHZhbHVlIGZvciBzYWZlIHVzZSBpbiBhIHNoZWxsIGV4cG9ydCBzdGF0ZW1lbnQuXG4gKlxuICogVXNlcyBzaW5nbGUgcXVvdGVzIGFuZCBlc2NhcGVzIGFueSBlbWJlZGRlZCBzaW5nbGUgcXVvdGVzLlxuICogVGhpcyBwcmV2ZW50cyBzaGVsbCBpbmplY3Rpb24gYW5kIGhhbmRsZXMgc3BlY2lhbCBjaGFyYWN0ZXJzLlxuICogQHBhcmFtIHZhbHVlIC0gVGhlIHZhbHVlIHRvIGVzY2FwZVxuICogQHJldHVybnMgVGhlIHNoZWxsLWVzY2FwZWQgdmFsdWUgKHdpdGggcXVvdGVzKVxuICogQGludGVybmFsXG4gKi9cbmZ1bmN0aW9uIGVzY2FwZVNoZWxsVmFsdWUodmFsdWUpIHtcbiAgICAvLyBVc2Ugc2luZ2xlIHF1b3RlcyBhbmQgZXNjYXBlIGFueSBlbWJlZGRlZCBzaW5nbGUgcXVvdGVzXG4gICAgLy8gJ3ZhbHVlJyAtPiAndmFsJ1xcJyd1ZScgZm9yIHZhbHVlcyBjb250YWluaW5nIHNpbmdsZSBxdW90ZXNcbiAgICBjb25zdCBlc2NhcGVkID0gdmFsdWUucmVwbGFjZSgvJy9nLCBcIidcXFxcJydcIik7XG4gICAgcmV0dXJuIGAnJHtlc2NhcGVkfSdgO1xufVxuIiwgIi8qKlxuICogSG9vayBmYWN0b3J5IGZ1bmN0aW9ucyBmb3IgQ2xhdWRlIENvZGUgaG9va3MuXG4gKlxuICogUHJvdmlkZXMgdHlwZWQgZmFjdG9yeSBmdW5jdGlvbnMgZm9yIGFsbCAxMiBob29rIHR5cGVzIHRoYXQgaGFuZGxlOlxuICogLSBJbnB1dCB0eXBlIG5hcnJvd2luZyBiYXNlZCBvbiBob29rIGV2ZW50IHR5cGVcbiAqIC0gT3V0cHV0IHR5cGUgZW5mb3JjZW1lbnQgdmlhIHJldHVybiB0eXBlc1xuICogLSBFcnJvciB3cmFwcGluZyB3aXRoIGF1dG9tYXRpYyBsb2dnaW5nXG4gKiAtIExvZ2dlciBjb250ZXh0IGluamVjdGlvblxuICpcbiAqIEVhY2ggZmFjdG9yeSBhY2NlcHRzIGEgSG9va0NvbmZpZyB3aXRoIG9wdGlvbmFsIG1hdGNoZXIgYW5kIHRpbWVvdXQgc2V0dGluZ3MsXG4gKiBhbmQgcmV0dXJucyBhIGZ1bmN0aW9uIHRoYXQgdGhlIHJ1bnRpbWUgaW52b2tlcyB3aGVuIHRoZSBob29rIGZpbGUgZXhlY3V0ZXMuXG4gKiBAbW9kdWxlXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgcHJlVG9vbFVzZUhvb2ssIHByZVRvb2xVc2VPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIGV4cG9ydCBkZWZhdWx0IHByZVRvb2xVc2VIb29rKHsgbWF0Y2hlcjogJ0Jhc2gnIH0sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnUHJvY2Vzc2luZyBCYXNoIGNvbW1hbmQnKTtcbiAqICAgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoeyBhbGxvdzogdHJ1ZSB9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3NcbiAqL1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gR2VuZXJpYyBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBob29rIGZhY3RvcnkgZnVuY3Rpb24gZm9yIGEgc3BlY2lmaWMgaG9vayB0eXBlLlxuICpcbiAqIFRoaXMgaXMgdGhlIGludGVybmFsIGltcGxlbWVudGF0aW9uIHVzZWQgYnkgYWxsIHR5cGVkIGZhY3Rvcmllcy5cbiAqIEl0IHdyYXBzIHRoZSBoYW5kbGVyIHdpdGggZXJyb3IgY2F0Y2hpbmcgYW5kIGxvZ2dpbmcuXG4gKiBAcGFyYW0gaG9va0V2ZW50TmFtZSAtIFRoZSBob29rIGV2ZW50IG5hbWVcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb25cbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gd3JhcFxuICogQHJldHVybnMgQSB3cmFwcGVkIGhvb2sgZnVuY3Rpb25cbiAqIEBpbnRlcm5hbFxuICovXG5mdW5jdGlvbiBjcmVhdGVIb29rRnVuY3Rpb24oaG9va0V2ZW50TmFtZSwgY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgY29uc3QgaG9va0ZuID0gYXN5bmMgKGlucHV0LCBjb250ZXh0KSA9PiB7XG4gICAgICAgIC8vIERlbGVnYXRlIGVycm9yIGhhbmRsaW5nIHRvIHRoZSBydW50aW1lIC0ganVzdCBleGVjdXRlIHRoZSBoYW5kbGVyXG4gICAgICAgIC8vIFRoZSBydW50aW1lIHdpbGwgY2F0Y2ggZXJyb3JzLCBsb2cgdGhlbSwgYW5kIHJldHVybiBhcHByb3ByaWF0ZSBvdXRwdXRcbiAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZXIoaW5wdXQsIGNvbnRleHQpO1xuICAgIH07XG4gICAgLy8gQXR0YWNoIG1ldGFkYXRhIGZvciBydW50aW1lIGluc3BlY3Rpb25cbiAgICBob29rRm4uaG9va0V2ZW50TmFtZSA9IGhvb2tFdmVudE5hbWU7XG4gICAgaG9va0ZuLm1hdGNoZXIgPSBjb25maWcubWF0Y2hlcjtcbiAgICBob29rRm4udGltZW91dCA9IGNvbmZpZy50aW1lb3V0O1xuICAgIHJldHVybiBob29rRm47XG59XG4vKiogQGluaGVyaXRkb2MgKi9cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiUHJlVG9vbFVzZVwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLyoqIEBpbmhlcml0ZG9jICovXG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJQb3N0VG9vbFVzZVwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLyoqIEBpbmhlcml0ZG9jICovXG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VGYWlsdXJlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiUG9zdFRvb2xVc2VGYWlsdXJlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBQb3N0VG9vbEJhdGNoIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgUG9zdFRvb2xCYXRjaCBob29rIGhhbmRsZXIuXG4gKlxuICogUG9zdFRvb2xCYXRjaCBob29rcyBmaXJlIGV4YWN0bHkgb25jZSBhZnRlciBldmVyeSB0b29sIGNhbGwgaW4gYSBiYXRjaCBoYXNcbiAqIHJlc29sdmVkLCBiZWZvcmUgdGhlIG5leHQgbW9kZWwgcmVxdWVzdC4gVW5saWtlIFBvc3RUb29sVXNlIFx1MjAxNCB3aGljaCBmaXJlcyBwZXJcbiAqIHRvb2wgYW5kIG1heSBydW4gY29uY3VycmVudGx5IGZvciBwYXJhbGxlbCB0b29sIGNhbGxzIFx1MjAxNCBQb3N0VG9vbEJhdGNoIHJlY2VpdmVzXG4gKiB0aGUgZnVsbCBiYXRjaCB2aWEgYGlucHV0LnRvb2xfY2FsbHNgLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEluc3BlY3Qgb3Igc3VtbWFyaXplIGFsbCB0b29sIGNhbGxzIGluIGEgc2luZ2xlIHR1cm4gdG9nZXRoZXJcbiAqIC0gSW5qZWN0IGFkZGl0aW9uYWwgY29udGV4dCBvbmNlIHBlciBiYXRjaCBpbnN0ZWFkIG9mIG9uY2UgcGVyIHRvb2xcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb25jZSBwZXIgYmF0Y2hcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0IChtYXRjaGVyIGlzIGlnbm9yZWQpXG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBwb3N0VG9vbEJhdGNoSG9vaywgcG9zdFRvb2xCYXRjaE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgcG9zdFRvb2xCYXRjaEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnVG9vbCBiYXRjaCBjb21wbGV0ZWQnLCB7IGNvdW50OiBpbnB1dC50b29sX2NhbGxzLmxlbmd0aCB9KTtcbiAqXG4gKiAgIHJldHVybiBwb3N0VG9vbEJhdGNoT3V0cHV0KHtcbiAqICAgICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBgUmV2aWV3ZWQgJHtpbnB1dC50b29sX2NhbGxzLmxlbmd0aH0gdG9vbCBjYWxsc2BcbiAqICAgICB9XG4gKiAgIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNwb3N0dG9vbGJhdGNoXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbEJhdGNoSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiUG9zdFRvb2xCYXRjaFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gTm90aWZpY2F0aW9uIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgTm90aWZpY2F0aW9uIGhvb2sgaGFuZGxlci5cbiAqXG4gKiBOb3RpZmljYXRpb24gaG9va3MgZmlyZSB3aGVuIENsYXVkZSBDb2RlIHNlbmRzIGEgbm90aWZpY2F0aW9uLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEZvcndhcmQgbm90aWZpY2F0aW9ucyB0byBleHRlcm5hbCBzeXN0ZW1zXG4gKiAtIExvZyBpbXBvcnRhbnQgZXZlbnRzXG4gKiAtIFRyaWdnZXIgY3VzdG9tIGFsZXJ0aW5nXG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgbm90aWZpY2F0aW9uX3R5cGVgXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgbWF0Y2hlciBhbmQgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgbm90aWZpY2F0aW9uSG9vaywgbm90aWZpY2F0aW9uT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBGb3J3YXJkIG5vdGlmaWNhdGlvbnMgdG8gU2xhY2tcbiAqIGV4cG9ydCBkZWZhdWx0IG5vdGlmaWNhdGlvbkhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnTm90aWZpY2F0aW9uIHJlY2VpdmVkJywge1xuICogICAgIHR5cGU6IGlucHV0Lm5vdGlmaWNhdGlvbl90eXBlLFxuICogICAgIHRpdGxlOiBpbnB1dC50aXRsZVxuICogICB9KTtcbiAqXG4gKiAgIGF3YWl0IHNlbmRTbGFja01lc3NhZ2UoaW5wdXQudGl0bGUgPz8gJ05vdGlmaWNhdGlvbicsIGlucHV0Lm1lc3NhZ2UpO1xuICpcbiAqICAgcmV0dXJuIG5vdGlmaWNhdGlvbk91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI25vdGlmaWNhdGlvblxuICovXG5leHBvcnQgZnVuY3Rpb24gbm90aWZpY2F0aW9uSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiTm90aWZpY2F0aW9uXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBVc2VyUHJvbXB0U3VibWl0IEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgVXNlclByb21wdFN1Ym1pdCBob29rIGhhbmRsZXIuXG4gKlxuICogVXNlclByb21wdFN1Ym1pdCBob29rcyBmaXJlIHdoZW4gYSB1c2VyIHN1Ym1pdHMgYSBwcm9tcHQsIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gQWRkIGFkZGl0aW9uYWwgY29udGV4dCBvciBpbnN0cnVjdGlvbnNcbiAqIC0gTG9nIHVzZXIgaW50ZXJhY3Rpb25zXG4gKiAtIFZhbGlkYXRlIG9yIHRyYW5zZm9ybSBwcm9tcHRzXG4gKlxuICogKipNYXRjaGVyKio6IE5vIG1hdGNoZXIgc3VwcG9ydCAtIGZpcmVzIG9uIGFsbCBwcm9tcHQgc3VibWlzc2lvbnNcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0IChtYXRjaGVyIGlzIGlnbm9yZWQpXG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyB1c2VyUHJvbXB0U3VibWl0SG9vaywgdXNlclByb21wdFN1Ym1pdE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gQWRkIHByb2plY3QgY29udGV4dCB0byBldmVyeSBwcm9tcHRcbiAqIGV4cG9ydCBkZWZhdWx0IHVzZXJQcm9tcHRTdWJtaXRIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmRlYnVnKCdVc2VyIHByb21wdCBzdWJtaXR0ZWQnLCB7IHByb21wdExlbmd0aDogaW5wdXQucHJvbXB0Lmxlbmd0aCB9KTtcbiAqXG4gKiAgIGNvbnN0IHByb2plY3RDb250ZXh0ID0gYXdhaXQgZ2V0UHJvamVjdENvbnRleHQoKTtcbiAqXG4gKiAgIHJldHVybiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KHtcbiAqICAgICBhZGRpdGlvbmFsQ29udGV4dDogcHJvamVjdENvbnRleHRcbiAqICAgfSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3VzZXJwcm9tcHRzdWJtaXRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVzZXJQcm9tcHRTdWJtaXRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJVc2VyUHJvbXB0U3VibWl0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBVc2VyUHJvbXB0RXhwYW5zaW9uIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgVXNlclByb21wdEV4cGFuc2lvbiBob29rIGhhbmRsZXIuXG4gKlxuICogVXNlclByb21wdEV4cGFuc2lvbiBob29rcyBmaXJlIHdoZW4gYSB1c2VyIHByb21wdCBpcyBleHBhbmRlZCBmcm9tIGEgc2xhc2hcbiAqIGNvbW1hbmQgb3IgTUNQIHByb21wdCwgYWxsb3dpbmcgeW91IHRvOlxuICogLSBBZGQgY29udGV4dCBiYXNlZCBvbiB0aGUgY29tbWFuZCBiZWluZyBpbnZva2VkXG4gKiAtIExvZyBzbGFzaCBjb21tYW5kIGFuZCBNQ1AgcHJvbXB0IHVzYWdlXG4gKiAtIE9ic2VydmUgcHJvbXB0IGV4cGFuc2lvbiBldmVudHNcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHByb21wdCBleHBhbnNpb25zXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dCAobWF0Y2hlciBpcyBpZ25vcmVkKVxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgdXNlclByb21wdEV4cGFuc2lvbkhvb2ssIHVzZXJQcm9tcHRFeHBhbnNpb25PdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIC8vIEFkZCBjb250ZXh0IHdoZW4gYSBzbGFzaCBjb21tYW5kIGlzIGludm9rZWRcbiAqIGV4cG9ydCBkZWZhdWx0IHVzZXJQcm9tcHRFeHBhbnNpb25Ib29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmRlYnVnKCdQcm9tcHQgZXhwYW5kZWQnLCB7IHR5cGU6IGlucHV0LmV4cGFuc2lvbl90eXBlLCBjb21tYW5kOiBpbnB1dC5jb21tYW5kX25hbWUgfSk7XG4gKlxuICogICByZXR1cm4gdXNlclByb21wdEV4cGFuc2lvbk91dHB1dCh7XG4gKiAgICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogYENvbW1hbmQ6ICR7aW5wdXQuY29tbWFuZF9uYW1lfWBcbiAqICAgICB9XG4gKiAgIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyN1c2VycHJvbXB0ZXhwYW5zaW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB1c2VyUHJvbXB0RXhwYW5zaW9uSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiVXNlclByb21wdEV4cGFuc2lvblwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU2Vzc2lvblN0YXJ0IEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgU2Vzc2lvblN0YXJ0IGhvb2sgaGFuZGxlci5cbiAqXG4gKiBTZXNzaW9uU3RhcnQgaG9va3MgZmlyZSB3aGVuIGEgQ2xhdWRlIENvZGUgc2Vzc2lvbiBzdGFydHMgb3IgcmVzdGFydHMsXG4gKiBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEluaXRpYWxpemUgc2Vzc2lvbiBzdGF0ZVxuICogLSBJbmplY3QgY29udGV4dCBvciBpbnN0cnVjdGlvbnNcbiAqIC0gUGVyc2lzdCBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZm9yIHN1YnNlcXVlbnQgYmFzaCBjb21tYW5kc1xuICogLSBTZXQgdXAgbG9nZ2luZyBvciBtb25pdG9yaW5nXG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgc291cmNlYCAoJ3N0YXJ0dXAnLCAncmVzdW1lJywgJ2NsZWFyJywgJ2NvbXBhY3QnKVxuICpcbiAqICoqQ29udGV4dCoqOiBTZXNzaW9uU3RhcnQgaG9va3MgcmVjZWl2ZSBhbiBleHRlbmRlZCBjb250ZXh0IHdpdGggYHBlcnNpc3RFbnZWYXJgXG4gKiBhbmQgYHBlcnNpc3RFbnZWYXJzYCBmdW5jdGlvbnMgZm9yIHNldHRpbmcgZW52aXJvbm1lbnQgdmFyaWFibGVzLlxuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIG1hdGNoZXIgYW5kIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHNlc3Npb25TdGFydEhvb2ssIHNlc3Npb25TdGFydE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gUGVyc2lzdCBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZm9yIHRoZSBzZXNzaW9uXG4gKiBleHBvcnQgZGVmYXVsdCBzZXNzaW9uU3RhcnRIb29rKHsgbWF0Y2hlcjogJ3N0YXJ0dXAnIH0sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIsIHBlcnNpc3RFbnZWYXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnTmV3IHNlc3Npb24gc3RhcnRlZCcsIHtcbiAqICAgICBzZXNzaW9uSWQ6IGlucHV0LnNlc3Npb25faWQsXG4gKiAgICAgY3dkOiBpbnB1dC5jd2RcbiAqICAgfSk7XG4gKlxuICogICAvLyBTZXQgZW52aXJvbm1lbnQgdmFyaWFibGVzIGZvciBhbGwgc3Vic2VxdWVudCBiYXNoIGNvbW1hbmRzXG4gKiAgIHBlcnNpc3RFbnZWYXIoJ05PREVfRU5WJywgJ2RldmVsb3BtZW50Jyk7XG4gKiAgIHBlcnNpc3RFbnZWYXIoJ0RFQlVHJywgJ3RydWUnKTtcbiAqXG4gKiAgIHJldHVybiBzZXNzaW9uU3RhcnRPdXRwdXQoe30pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBTZXQgbXVsdGlwbGUgZW52aXJvbm1lbnQgdmFyaWFibGVzIGF0IG9uY2VcbiAqIGV4cG9ydCBkZWZhdWx0IHNlc3Npb25TdGFydEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBwZXJzaXN0RW52VmFycyB9KSA9PiB7XG4gKiAgIHBlcnNpc3RFbnZWYXJzKHtcbiAqICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxuICogICAgIEFQSV9LRVk6ICdzZWNyZXQnLFxuICogICAgIERFQlVHOiAnZmFsc2UnXG4gKiAgIH0pO1xuICpcbiAqICAgcmV0dXJuIHNlc3Npb25TdGFydE91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3Nlc3Npb25zdGFydFxuICovXG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiU2Vzc2lvblN0YXJ0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTZXNzaW9uRW5kIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgU2Vzc2lvbkVuZCBob29rIGhhbmRsZXIuXG4gKlxuICogU2Vzc2lvbkVuZCBob29rcyBmaXJlIHdoZW4gYSBDbGF1ZGUgQ29kZSBzZXNzaW9uIGVuZHMsIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gQ2xlYW4gdXAgc2Vzc2lvbiByZXNvdXJjZXNcbiAqIC0gTG9nIHNlc3Npb24gbWV0cmljc1xuICogLSBQZXJzaXN0IHNlc3Npb24gc3RhdGVcbiAqXG4gKiAqKk1hdGNoZXIqKjogTWF0Y2hlcyBhZ2FpbnN0IGByZWFzb25gICh0aGUgZXhpdCByZWFzb24gc3RyaW5nKVxuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIG1hdGNoZXIgYW5kIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHNlc3Npb25FbmRIb29rLCBzZXNzaW9uRW5kT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBMb2cgc2Vzc2lvbiBlbmQgYW5kIGNsZWFuIHVwXG4gKiBleHBvcnQgZGVmYXVsdCBzZXNzaW9uRW5kSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdTZXNzaW9uIGVuZGVkJywge1xuICogICAgIHNlc3Npb25JZDogaW5wdXQuc2Vzc2lvbl9pZCxcbiAqICAgICByZWFzb246IGlucHV0LnJlYXNvblxuICogICB9KTtcbiAqXG4gKiAgIGF3YWl0IGNsZWFudXBTZXNzaW9uUmVzb3VyY2VzKGlucHV0LnNlc3Npb25faWQpO1xuICpcbiAqICAgcmV0dXJuIHNlc3Npb25FbmRPdXRwdXQoe30pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNzZXNzaW9uZW5kXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uRW5kSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiU2Vzc2lvbkVuZFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU3RvcCBIb29rIEZhY3Rvcnlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhIFN0b3AgaG9vayBoYW5kbGVyLlxuICpcbiAqIFN0b3AgaG9va3MgZmlyZSB3aGVuIENsYXVkZSBDb2RlIGlzIGFib3V0IHRvIHN0b3AsIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gQmxvY2sgdGhlIHN0b3AgYW5kIHJlcXVpcmUgYWRkaXRpb25hbCBhY3Rpb25cbiAqIC0gQ29uZmlybSB0aGUgdXNlciB3YW50cyB0byBzdG9wXG4gKiAtIENsZWFuIHVwIHJlc291cmNlcyBiZWZvcmUgc3RvcHBpbmdcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHN0b3AgZXZlbnRzXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dCAobWF0Y2hlciBpcyBpZ25vcmVkKVxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgc3RvcEhvb2ssIHN0b3BPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIC8vIEJsb2NrIHN0b3AgaWYgdGhlcmUgYXJlIHBlbmRpbmcgY2hhbmdlc1xuICogZXhwb3J0IGRlZmF1bHQgc3RvcEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBjb25zdCBwZW5kaW5nQ2hhbmdlcyA9IGF3YWl0IGNoZWNrUGVuZGluZ0NoYW5nZXMoKTtcbiAqXG4gKiAgIGlmIChwZW5kaW5nQ2hhbmdlcy5sZW5ndGggPiAwKSB7XG4gKiAgICAgbG9nZ2VyLndhcm4oJ0Jsb2NraW5nIHN0b3AgZHVlIHRvIHBlbmRpbmcgY2hhbmdlcycsIHtcbiAqICAgICAgIGNvdW50OiBwZW5kaW5nQ2hhbmdlcy5sZW5ndGhcbiAqICAgICB9KTtcbiAqXG4gKiAgICAgcmV0dXJuIHN0b3BPdXRwdXQoe1xuICogICAgICAgZGVjaXNpb246ICdibG9jaycsXG4gKiAgICAgICByZWFzb246IGBUaGVyZSBhcmUgJHtwZW5kaW5nQ2hhbmdlcy5sZW5ndGh9IHVuY29tbWl0dGVkIGNoYW5nZXNgLFxuICogICAgICAgc3lzdGVtTWVzc2FnZTogJ1BsZWFzZSBjb21taXQgb3IgZGlzY2FyZCBjaGFuZ2VzIGJlZm9yZSBzdG9wcGluZydcbiAqICAgICB9KTtcbiAqICAgfVxuICpcbiAqICAgbG9nZ2VyLmluZm8oJ0FwcHJvdmluZyBzdG9wJyk7XG4gKiAgIHJldHVybiBzdG9wT3V0cHV0KHsgZGVjaXNpb246ICdhcHByb3ZlJyB9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3Mjc3RvcFxuICovXG5leHBvcnQgZnVuY3Rpb24gc3RvcEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlN0b3BcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFN0b3BGYWlsdXJlIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgU3RvcEZhaWx1cmUgaG9vayBoYW5kbGVyLlxuICpcbiAqIFN0b3BGYWlsdXJlIGhvb2tzIGZpcmUgd2hlbiBDbGF1ZGUgQ29kZSBlbmNvdW50ZXJzIGFuIGVycm9yIHdoaWxlIHN0b3BwaW5nXG4gKiAoZS5nLiwgQVBJIGVycm9ycywgYXV0aGVudGljYXRpb24gZmFpbHVyZXMsIHJhdGUgbGltaXRzKSwgYWxsb3dpbmcgeW91IHRvOlxuICogLSBMb2cgc3RvcCBmYWlsdXJlIGV2ZW50cyBhbmQgZXJyb3IgZGV0YWlsc1xuICogLSBBbGVydCBvbiB1bmV4cGVjdGVkIHNlc3Npb24gdGVybWluYXRpb24gZXJyb3JzXG4gKiAtIE9ic2VydmUgd2hhdCBlcnJvciBjYXVzZWQgdGhlIGZhaWx1cmVcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHN0b3AgZmFpbHVyZSBldmVudHNcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0IChtYXRjaGVyIGlzIGlnbm9yZWQpXG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBzdG9wRmFpbHVyZUhvb2ssIHN0b3BGYWlsdXJlT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiBleHBvcnQgZGVmYXVsdCBzdG9wRmFpbHVyZUhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuZXJyb3IoJ1Nlc3Npb24gc3RvcHBlZCBkdWUgdG8gZXJyb3InLCB7XG4gKiAgICAgZXJyb3I6IGlucHV0LmVycm9yLFxuICogICAgIGRldGFpbHM6IGlucHV0LmVycm9yX2RldGFpbHNcbiAqICAgfSk7XG4gKiAgIHJldHVybiBzdG9wRmFpbHVyZU91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3N0b3BmYWlsdXJlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdG9wRmFpbHVyZUhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlN0b3BGYWlsdXJlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTdWJhZ2VudFN0YXJ0IEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgU3ViYWdlbnRTdGFydCBob29rIGhhbmRsZXIuXG4gKlxuICogU3ViYWdlbnRTdGFydCBob29rcyBmaXJlIHdoZW4gYSBzdWJhZ2VudCAoQWdlbnQgdG9vbCkgc3RhcnRzLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEluamVjdCBjb250ZXh0IGZvciB0aGUgc3ViYWdlbnRcbiAqIC0gTG9nIHN1YmFnZW50IGludm9jYXRpb25zXG4gKiAtIENvbmZpZ3VyZSBzdWJhZ2VudCBiZWhhdmlvclxuICpcbiAqICoqTWF0Y2hlcioqOiBNYXRjaGVzIGFnYWluc3QgYGFnZW50X3R5cGVgIChlLmcuLCAnZXhwbG9yZScsICdjb2RlYmFzZS1hbmFseXNpcycpXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgbWF0Y2hlciBhbmQgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgc3ViYWdlbnRTdGFydEhvb2ssIHN1YmFnZW50U3RhcnRPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIC8vIEFkZCBjb250ZXh0IGZvciBleHBsb3JlIHN1YmFnZW50c1xuICogZXhwb3J0IGRlZmF1bHQgc3ViYWdlbnRTdGFydEhvb2soeyBtYXRjaGVyOiAnZXhwbG9yZScgfSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdFeHBsb3JlIHN1YmFnZW50IHN0YXJ0aW5nJywge1xuICogICAgIGFnZW50SWQ6IGlucHV0LmFnZW50X2lkLFxuICogICAgIGFnZW50VHlwZTogaW5wdXQuYWdlbnRfdHlwZVxuICogICB9KTtcbiAqXG4gKiAgIHJldHVybiBzdWJhZ2VudFN0YXJ0T3V0cHV0KHtcbiAqICAgICBhZGRpdGlvbmFsQ29udGV4dDogJ0ZvY3VzIG9uIGZpbmRpbmcgcGF0dGVybnMgYW5kIGNvbnZlbnRpb25zJ1xuICogICB9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3Mjc3ViYWdlbnRzdGFydFxuICovXG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlN1YmFnZW50U3RhcnRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFN1YmFnZW50U3RvcCBIb29rIEZhY3Rvcnlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhIFN1YmFnZW50U3RvcCBob29rIGhhbmRsZXIuXG4gKlxuICogU3ViYWdlbnRTdG9wIGhvb2tzIGZpcmUgd2hlbiBhIHN1YmFnZW50IGNvbXBsZXRlcyBvciBzdG9wcywgYWxsb3dpbmcgeW91IHRvOlxuICogLSBCbG9jayB0aGUgc3ViYWdlbnQgZnJvbSBzdG9wcGluZ1xuICogLSBQcm9jZXNzIHN1YmFnZW50IHJlc3VsdHNcbiAqIC0gQ2xlYW4gdXAgc3ViYWdlbnQgcmVzb3VyY2VzXG4gKiAtIExvZyBzdWJhZ2VudCBjb21wbGV0aW9uXG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgYWdlbnRfdHlwZWAgKGUuZy4sICdleHBsb3JlJywgJ2NvZGViYXNlLWFuYWx5c2lzJylcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCBtYXRjaGVyIGFuZCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBzdWJhZ2VudFN0b3BIb29rLCBzdWJhZ2VudFN0b3BPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIC8vIEJsb2NrIGV4cGxvcmUgc3ViYWdlbnRzIGlmIHRhc2sgaW5jb21wbGV0ZVxuICogZXhwb3J0IGRlZmF1bHQgc3ViYWdlbnRTdG9wSG9vayh7IG1hdGNoZXI6ICdleHBsb3JlJyB9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ1N1YmFnZW50IHN0b3BwaW5nJywge1xuICogICAgIGFnZW50SWQ6IGlucHV0LmFnZW50X2lkLFxuICogICAgIGFnZW50VHlwZTogaW5wdXQuYWdlbnRfdHlwZVxuICogICB9KTtcbiAqXG4gKiAgIC8vIEJsb2NrIGlmIHRyYW5zY3JpcHQgc2hvd3MgaW5jb21wbGV0ZSB3b3JrXG4gKiAgIHJldHVybiBzdWJhZ2VudFN0b3BPdXRwdXQoe1xuICogICAgIGRlY2lzaW9uOiAnYmxvY2snLFxuICogICAgIHJlYXNvbjogJ1BsZWFzZSB2ZXJpZnkgZXhwbG9yYXRpb24gaXMgY29tcGxldGUnXG4gKiAgIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNzdWJhZ2VudHN0b3BcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN1YmFnZW50U3RvcEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlN1YmFnZW50U3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUHJlQ29tcGFjdCBIb29rIEZhY3Rvcnlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhIFByZUNvbXBhY3QgaG9vayBoYW5kbGVyLlxuICpcbiAqIFByZUNvbXBhY3QgaG9va3MgZmlyZSBiZWZvcmUgY29udGV4dCBjb21wYWN0aW9uIG9jY3VycywgYWxsb3dpbmcgeW91IHRvOlxuICogLSBQcmVzZXJ2ZSBpbXBvcnRhbnQgaW5mb3JtYXRpb24gYmVmb3JlIGNvbXBhY3Rpb25cbiAqIC0gTG9nIGNvbXBhY3Rpb24gZXZlbnRzXG4gKiAtIE1vZGlmeSBjdXN0b20gaW5zdHJ1Y3Rpb25zIGZvciB0aGUgY29tcGFjdGVkIGNvbnRleHRcbiAqXG4gKiAqKk1hdGNoZXIqKjogTWF0Y2hlcyBhZ2FpbnN0IGB0cmlnZ2VyYCAoJ21hbnVhbCcsICdhdXRvJylcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCBtYXRjaGVyIGFuZCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBwcmVDb21wYWN0SG9vaywgcHJlQ29tcGFjdE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gTG9nIGNvbXBhY3Rpb24gZXZlbnRzIGFuZCBwcmVzZXJ2ZSBjb250ZXh0XG4gKiBleHBvcnQgZGVmYXVsdCBwcmVDb21wYWN0SG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdDb250ZXh0IGNvbXBhY3Rpb24gdHJpZ2dlcmVkJywge1xuICogICAgIHRyaWdnZXI6IGlucHV0LnRyaWdnZXIsXG4gKiAgICAgaGFzQ3VzdG9tSW5zdHJ1Y3Rpb25zOiBpbnB1dC5jdXN0b21faW5zdHJ1Y3Rpb25zICE9PSBudWxsXG4gKiAgIH0pO1xuICpcbiAqICAgcmV0dXJuIHByZUNvbXBhY3RPdXRwdXQoe1xuICogICAgIHN5c3RlbU1lc3NhZ2U6ICdSZW1lbWJlcjogc3RyaWN0IG1vZGUgaXMgZW5hYmxlZCdcbiAqICAgfSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIE9ubHkgaGFuZGxlIG1hbnVhbCBjb21wYWN0aW9uXG4gKiBleHBvcnQgZGVmYXVsdCBwcmVDb21wYWN0SG9vayh7IG1hdGNoZXI6ICdtYW51YWwnIH0sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnTWFudWFsIGNvbXBhY3Rpb24gcmVxdWVzdGVkJyk7XG4gKiAgIHJldHVybiBwcmVDb21wYWN0T3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjcHJlY29tcGFjdFxuICovXG5leHBvcnQgZnVuY3Rpb24gcHJlQ29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlByZUNvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFBvc3RDb21wYWN0IEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgUG9zdENvbXBhY3QgaG9vayBoYW5kbGVyLlxuICpcbiAqIFBvc3RDb21wYWN0IGhvb2tzIGZpcmUgYWZ0ZXIgY29udGV4dCBjb21wYWN0aW9uIGNvbXBsZXRlcywgYWxsb3dpbmcgeW91IHRvOlxuICogLSBPYnNlcnZlIHRoZSBjb21wYWN0aW9uIHN1bW1hcnkgYW5kIGRldGFpbHNcbiAqIC0gTG9nIGNvbXBhY3Rpb24gZXZlbnRzXG4gKiAtIFJlYWN0IHRvIHRoZSBuZXcgY29tcGFjdGVkIHN0YXRlXG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgdHJpZ2dlcmAgKCdtYW51YWwnLCAnYXV0bycpXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgbWF0Y2hlciBhbmQgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgcG9zdENvbXBhY3RIb29rLCBwb3N0Q29tcGFjdE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgcG9zdENvbXBhY3RIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ0NvbnRleHQgY29tcGFjdGlvbiBjb21wbGV0ZWQnLCB7XG4gKiAgICAgdHJpZ2dlcjogaW5wdXQudHJpZ2dlcixcbiAqICAgICBzdW1tYXJ5OiBpbnB1dC5jb21wYWN0X3N1bW1hcnlcbiAqICAgfSk7XG4gKiAgIHJldHVybiBwb3N0Q29tcGFjdE91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3Bvc3Rjb21wYWN0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlBvc3RDb21wYWN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vKiogQGluaGVyaXRkb2MgKi9cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uUmVxdWVzdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBQZXJtaXNzaW9uRGVuaWVkIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgUGVybWlzc2lvbkRlbmllZCBob29rIGhhbmRsZXIuXG4gKlxuICogUGVybWlzc2lvbkRlbmllZCBob29rcyBmaXJlIHdoZW4gYSBwZXJtaXNzaW9uIHJlcXVlc3QgaXMgZGVuaWVkIChlaXRoZXIgYnkgdGhlXG4gKiB1c2VyIG9yIGJ5IGEgUGVybWlzc2lvblJlcXVlc3QgaG9vayksIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gTG9nIHBlcm1pc3Npb24gZGVuaWFscyBmb3IgYXVkaXRpbmdcbiAqIC0gUmVhY3QgdG8gZGVuaWVkIHRvb2wgZXhlY3V0aW9uc1xuICogLSBPcHRpb25hbGx5IHJlcXVlc3QgYSByZXRyeSB2aWEgdGhlIG91dHB1dFxuICpcbiAqICoqTWF0Y2hlcioqOiBNYXRjaGVzIGFnYWluc3QgYHRvb2xfbmFtZWBcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCBtYXRjaGVyIGFuZCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBwZXJtaXNzaW9uRGVuaWVkSG9vaywgcGVybWlzc2lvbkRlbmllZE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gTG9nIGFsbCBwZXJtaXNzaW9uIGRlbmlhbHNcbiAqIGV4cG9ydCBkZWZhdWx0IHBlcm1pc3Npb25EZW5pZWRIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLndhcm4oJ1Blcm1pc3Npb24gZGVuaWVkJywge1xuICogICAgIHRvb2xOYW1lOiBpbnB1dC50b29sX25hbWUsXG4gKiAgICAgcmVhc29uOiBpbnB1dC5yZWFzb25cbiAqICAgfSk7XG4gKiAgIHJldHVybiBwZXJtaXNzaW9uRGVuaWVkT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjcGVybWlzc2lvbmRlbmllZFxuICovXG5leHBvcnQgZnVuY3Rpb24gcGVybWlzc2lvbkRlbmllZEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlBlcm1pc3Npb25EZW5pZWRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNldHVwIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgU2V0dXAgaG9vayBoYW5kbGVyLlxuICpcbiAqIFNldHVwIGhvb2tzIGZpcmUgZHVyaW5nIGluaXRpYWxpemF0aW9uIG9yIG1haW50ZW5hbmNlLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIENvbmZpZ3VyZSBpbml0aWFsIHNlc3Npb24gc3RhdGVcbiAqIC0gUGVyZm9ybSBzZXR1cCB0YXNrcyBiZWZvcmUgdGhlIHNlc3Npb24gc3RhcnRzXG4gKiAtIEFkZCBjb250ZXh0IGZvciBtYWludGVuYW5jZSBvcGVyYXRpb25zXG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgdHJpZ2dlcmAgKCdpbml0JyBvciAnbWFpbnRlbmFuY2UnKVxuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIG1hdGNoZXIgYW5kIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHNldHVwSG9vaywgc2V0dXBPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIC8vIEhhbmRsZSBhbGwgc2V0dXAgZXZlbnRzXG4gKiBleHBvcnQgZGVmYXVsdCBzZXR1cEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnU2V0dXAgdHJpZ2dlcmVkJywgeyB0cmlnZ2VyOiBpbnB1dC50cmlnZ2VyIH0pO1xuICogICByZXR1cm4gc2V0dXBPdXRwdXQoe30pO1xuICogfSk7XG4gKlxuICogLy8gT25seSBoYW5kbGUgaW5pdGlhbGl6YXRpb25cbiAqIGV4cG9ydCBkZWZhdWx0IHNldHVwSG9vayh7IG1hdGNoZXI6ICdpbml0JyB9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ0luaXRpYWxpemluZyBzZXNzaW9uJyk7XG4gKiAgIHJldHVybiBzZXR1cE91dHB1dCh7XG4gKiAgICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogJ1Nlc3Npb24gaW5pdGlhbGl6ZWQgd2l0aCBjdXN0b20gY29uZmlndXJhdGlvbidcbiAqICAgICB9XG4gKiAgIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNzZXR1cFxuICovXG5leHBvcnQgZnVuY3Rpb24gc2V0dXBIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJTZXR1cFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVGVhbW1hdGVJZGxlIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgVGVhbW1hdGVJZGxlIGhvb2sgaGFuZGxlci5cbiAqXG4gKiBUZWFtbWF0ZUlkbGUgaG9va3MgZmlyZSB3aGVuIGEgdGVhbW1hdGUgaW4gYSB0ZWFtIGlzIGFib3V0IHRvIGdvIGlkbGUsXG4gKiBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEFzc2lnbiB3b3JrIHRvIGlkbGUgdGVhbW1hdGVzXG4gKiAtIExvZyB0ZWFtIGFjdGl2aXR5XG4gKiAtIENvb3JkaW5hdGUgbXVsdGktYWdlbnQgd29ya2Zsb3dzXG4gKlxuICogKipNYXRjaGVyKio6IE5vIG1hdGNoZXIgc3VwcG9ydCAtIGZpcmVzIG9uIGFsbCB0ZWFtbWF0ZSBpZGxlIGV2ZW50c1xuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIHRpbWVvdXQgKG1hdGNoZXIgaXMgaWdub3JlZClcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHRlYW1tYXRlSWRsZUhvb2ssIHRlYW1tYXRlSWRsZU91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gTG9nIHdoZW4gdGVhbW1hdGVzIGdvIGlkbGVcbiAqIGV4cG9ydCBkZWZhdWx0IHRlYW1tYXRlSWRsZUhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnVGVhbW1hdGUgZ29pbmcgaWRsZScsIHtcbiAqICAgICB0ZWFtbWF0ZU5hbWU6IGlucHV0LnRlYW1tYXRlX25hbWUsXG4gKiAgICAgdGVhbU5hbWU6IGlucHV0LnRlYW1fbmFtZVxuICogICB9KTtcbiAqXG4gKiAgIHJldHVybiB0ZWFtbWF0ZUlkbGVPdXRwdXQoe30pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyN0ZWFtbWF0ZWlkbGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRlYW1tYXRlSWRsZUhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlRlYW1tYXRlSWRsZVwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVGFza0NyZWF0ZWQgSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBUYXNrQ3JlYXRlZCBob29rIGhhbmRsZXIuXG4gKlxuICogVGFza0NyZWF0ZWQgaG9va3MgZmlyZSB3aGVuIGEgbmV3IHRhc2sgaXMgY3JlYXRlZCBhbmQgYXNzaWduZWQgdG8gYSB0ZWFtbWF0ZSxcbiAqIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gT2JzZXJ2ZSB0YXNrIGNyZWF0aW9uIGV2ZW50c1xuICogLSBMb2cgdGFzayBhc3NpZ25tZW50cyBmb3IgYXVkaXRpbmdcbiAqIC0gUmVhY3QgdG8gbmV3IHdvcmsgYmVpbmcgYXNzaWduZWRcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHRhc2sgY3JlYXRpb24gZXZlbnRzXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dCAobWF0Y2hlciBpcyBpZ25vcmVkKVxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgdGFza0NyZWF0ZWRIb29rLCB0YXNrQ3JlYXRlZE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gTG9nIHRhc2sgY3JlYXRpb25cbiAqIGV4cG9ydCBkZWZhdWx0IHRhc2tDcmVhdGVkSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdUYXNrIGNyZWF0ZWQnLCB7XG4gKiAgICAgdGFza0lkOiBpbnB1dC50YXNrX2lkLFxuICogICAgIHRhc2tTdWJqZWN0OiBpbnB1dC50YXNrX3N1YmplY3RcbiAqICAgfSk7XG4gKlxuICogICByZXR1cm4gdGFza0NyZWF0ZWRPdXRwdXQoe30pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyN0YXNrY3JlYXRlZFxuICovXG5leHBvcnQgZnVuY3Rpb24gdGFza0NyZWF0ZWRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJUYXNrQ3JlYXRlZFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVGFza0NvbXBsZXRlZCBIb29rIEZhY3Rvcnlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhIFRhc2tDb21wbGV0ZWQgaG9vayBoYW5kbGVyLlxuICpcbiAqIFRhc2tDb21wbGV0ZWQgaG9va3MgZmlyZSB3aGVuIGEgdGFzayBpcyBiZWluZyBtYXJrZWQgYXMgY29tcGxldGVkLFxuICogYWxsb3dpbmcgeW91IHRvOlxuICogLSBWZXJpZnkgdGFzayBjb21wbGV0aW9uXG4gKiAtIExvZyB0YXNrIG1ldHJpY3NcbiAqIC0gVHJpZ2dlciBmb2xsb3ctdXAgYWN0aW9uc1xuICpcbiAqICoqTWF0Y2hlcioqOiBObyBtYXRjaGVyIHN1cHBvcnQgLSBmaXJlcyBvbiBhbGwgdGFzayBjb21wbGV0aW9uIGV2ZW50c1xuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIHRpbWVvdXQgKG1hdGNoZXIgaXMgaWdub3JlZClcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHRhc2tDb21wbGV0ZWRIb29rLCB0YXNrQ29tcGxldGVkT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBMb2cgdGFzayBjb21wbGV0aW9uXG4gKiBleHBvcnQgZGVmYXVsdCB0YXNrQ29tcGxldGVkSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdUYXNrIGNvbXBsZXRlZCcsIHtcbiAqICAgICB0YXNrSWQ6IGlucHV0LnRhc2tfaWQsXG4gKiAgICAgdGFza1N1YmplY3Q6IGlucHV0LnRhc2tfc3ViamVjdFxuICogICB9KTtcbiAqXG4gKiAgIHJldHVybiB0YXNrQ29tcGxldGVkT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjdGFza2NvbXBsZXRlZFxuICovXG5leHBvcnQgZnVuY3Rpb24gdGFza0NvbXBsZXRlZEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlRhc2tDb21wbGV0ZWRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEVsaWNpdGF0aW9uIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGFuIEVsaWNpdGF0aW9uIGhvb2sgaGFuZGxlci5cbiAqXG4gKiBFbGljaXRhdGlvbiBob29rcyBmaXJlIHdoZW4gYW4gTUNQIHNlcnZlciByZXF1ZXN0cyB1c2VyIGlucHV0LCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEFjY2VwdCwgZGVjbGluZSwgb3IgY2FuY2VsIGVsaWNpdGF0aW9uIHJlcXVlc3RzIHByb2dyYW1tYXRpY2FsbHlcbiAqIC0gUHJvdmlkZSBzdHJ1Y3R1cmVkIGZvcm0gaW5wdXQgb3IgVVJMLWJhc2VkIGF1dGggcmVzcG9uc2VzXG4gKiAtIExvZyBvciBhdWRpdCBlbGljaXRhdGlvbiByZXF1ZXN0c1xuICpcbiAqICoqTWF0Y2hlcioqOiBObyBtYXRjaGVyIHN1cHBvcnQgLSBmaXJlcyBvbiBhbGwgZWxpY2l0YXRpb24gZXZlbnRzXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgZWxpY2l0YXRpb25Ib29rLCBlbGljaXRhdGlvbk91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgZWxpY2l0YXRpb25Ib29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ0VsaWNpdGF0aW9uIHJlcXVlc3QnLCB7IHNlcnZlcjogaW5wdXQubWNwX3NlcnZlcl9uYW1lIH0pO1xuICogICByZXR1cm4gZWxpY2l0YXRpb25PdXRwdXQoe1xuICogICAgIGhvb2tTcGVjaWZpY091dHB1dDogeyBhY3Rpb246ICdhY2NlcHQnLCBjb250ZW50OiB7IGFwcHJvdmVkOiB0cnVlIH0gfVxuICogICB9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjZWxpY2l0YXRpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVsaWNpdGF0aW9uSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiRWxpY2l0YXRpb25cIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEVsaWNpdGF0aW9uUmVzdWx0IEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGFuIEVsaWNpdGF0aW9uUmVzdWx0IGhvb2sgaGFuZGxlci5cbiAqXG4gKiBFbGljaXRhdGlvblJlc3VsdCBob29rcyBmaXJlIHdpdGggdGhlIHJlc3VsdCBvZiBhbiBNQ1AgZWxpY2l0YXRpb24gcmVxdWVzdCxcbiAqIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gT2JzZXJ2ZSBlbGljaXRhdGlvbiBvdXRjb21lc1xuICogLSBNb2RpZnkgdGhlIHJlc3VsdCBiZWZvcmUgaXQgaXMgcmV0dXJuZWQgdG8gdGhlIE1DUCBzZXJ2ZXJcbiAqIC0gTG9nIGVsaWNpdGF0aW9uIGNvbXBsZXRpb25zXG4gKlxuICogKipNYXRjaGVyKio6IE5vIG1hdGNoZXIgc3VwcG9ydCAtIGZpcmVzIG9uIGFsbCBlbGljaXRhdGlvbiByZXN1bHQgZXZlbnRzXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgZWxpY2l0YXRpb25SZXN1bHRIb29rLCBlbGljaXRhdGlvblJlc3VsdE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgZWxpY2l0YXRpb25SZXN1bHRIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ0VsaWNpdGF0aW9uIHJlc3VsdCcsIHsgYWN0aW9uOiBpbnB1dC5hY3Rpb24gfSk7XG4gKiAgIHJldHVybiBlbGljaXRhdGlvblJlc3VsdE91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI2VsaWNpdGF0aW9ucmVzdWx0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbGljaXRhdGlvblJlc3VsdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIkVsaWNpdGF0aW9uUmVzdWx0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBDb25maWdDaGFuZ2UgSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBDb25maWdDaGFuZ2UgaG9vayBoYW5kbGVyLlxuICpcbiAqIENvbmZpZ0NoYW5nZSBob29rcyBmaXJlIHdoZW4gQ2xhdWRlIENvZGUgY29uZmlndXJhdGlvbiBjaGFuZ2VzLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIFJlYWN0IHRvIHNldHRpbmdzIGZpbGUgY2hhbmdlc1xuICogLSBMb2cgb3IgYXVkaXQgY29uZmlndXJhdGlvbiBjaGFuZ2VzXG4gKiAtIEFwcGx5IGN1c3RvbSBsb2dpYyB3aGVuIHNldHRpbmdzIGFyZSB1cGRhdGVkXG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgc291cmNlYCAoJ3VzZXJfc2V0dGluZ3MnLCAncHJvamVjdF9zZXR0aW5ncycsIGV0Yy4pXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgbWF0Y2hlciBhbmQgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgY29uZmlnQ2hhbmdlSG9vaywgY29uZmlnQ2hhbmdlT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiBleHBvcnQgZGVmYXVsdCBjb25maWdDaGFuZ2VIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ0NvbmZpZyBjaGFuZ2VkJywgeyBzb3VyY2U6IGlucHV0LnNvdXJjZSwgZmlsZTogaW5wdXQuZmlsZV9wYXRoIH0pO1xuICogICByZXR1cm4gY29uZmlnQ2hhbmdlT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjY29uZmlnY2hhbmdlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb25maWdDaGFuZ2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJDb25maWdDaGFuZ2VcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEluc3RydWN0aW9uc0xvYWRlZCBIb29rIEZhY3Rvcnlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhbiBJbnN0cnVjdGlvbnNMb2FkZWQgaG9vayBoYW5kbGVyLlxuICpcbiAqIEluc3RydWN0aW9uc0xvYWRlZCBob29rcyBmaXJlIHdoZW4gYSBDTEFVREUubWQgb3Igc2ltaWxhciBpbnN0cnVjdGlvbnMgZmlsZVxuICogaXMgbG9hZGVkLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIFJlYWN0IHRvIGluc3RydWN0aW9ucyBiZWluZyBhcHBsaWVkXG4gKiAtIExvZyB3aGljaCBpbnN0cnVjdGlvbiBmaWxlcyBhcmUgYWN0aXZlXG4gKiAtIE9ic2VydmUgdGhlIGluc3RydWN0aW9uIGxvYWRpbmcgaGllcmFyY2h5XG4gKlxuICogKipNYXRjaGVyKio6IE5vIG1hdGNoZXIgc3VwcG9ydCAtIGZpcmVzIG9uIGFsbCBpbnN0cnVjdGlvbiBsb2FkIGV2ZW50c1xuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IGluc3RydWN0aW9uc0xvYWRlZEhvb2ssIGluc3RydWN0aW9uc0xvYWRlZE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgaW5zdHJ1Y3Rpb25zTG9hZGVkSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdJbnN0cnVjdGlvbnMgbG9hZGVkJywgeyBmaWxlOiBpbnB1dC5maWxlX3BhdGgsIHR5cGU6IGlucHV0Lm1lbW9yeV90eXBlIH0pO1xuICogICByZXR1cm4gaW5zdHJ1Y3Rpb25zTG9hZGVkT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjaW5zdHJ1Y3Rpb25zbG9hZGVkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpbnN0cnVjdGlvbnNMb2FkZWRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJJbnN0cnVjdGlvbnNMb2FkZWRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFdvcmt0cmVlQ3JlYXRlIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgV29ya3RyZWVDcmVhdGUgaG9vayBoYW5kbGVyLlxuICpcbiAqIFdvcmt0cmVlQ3JlYXRlIGhvb2tzIGZpcmUgd2hlbiBhIGdpdCB3b3JrdHJlZSBpcyBjcmVhdGVkLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIFNldCB1cCB3b3JrdHJlZS1zcGVjaWZpYyBjb25maWd1cmF0aW9uXG4gKiAtIExvZyB3b3JrdHJlZSBjcmVhdGlvbiBldmVudHNcbiAqIC0gSW5pdGlhbGl6ZSB3b3JrdHJlZSByZXNvdXJjZXNcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHdvcmt0cmVlIGNyZWF0aW9uIGV2ZW50c1xuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHdvcmt0cmVlQ3JlYXRlSG9vaywgd29ya3RyZWVDcmVhdGVPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIGV4cG9ydCBkZWZhdWx0IHdvcmt0cmVlQ3JlYXRlSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGNvbnN0IHdvcmt0cmVlUGF0aCA9IGAke2lucHV0LmN3ZH0vLndvcmt0cmVlcy8ke2lucHV0Lm5hbWV9YDtcbiAqICAgbG9nZ2VyLmluZm8oJ1dvcmt0cmVlIGNyZWF0ZWQnLCB7IG5hbWU6IGlucHV0Lm5hbWUsIHdvcmt0cmVlUGF0aCB9KTtcbiAqICAgLy8gV29ya3RyZWVDcmVhdGUgaXMgYSBjb21tYW5kIGhvb2s6IHRoZSBwYXRoIGlzIHdyaXR0ZW4gdG8gc3Rkb3V0IGFzIHBsYWluIHRleHQuXG4gKiAgIHJldHVybiB3b3JrdHJlZUNyZWF0ZU91dHB1dCh7IHdvcmt0cmVlUGF0aCB9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3Mjd29ya3RyZWVjcmVhdGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHdvcmt0cmVlQ3JlYXRlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiV29ya3RyZWVDcmVhdGVcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFdvcmt0cmVlUmVtb3ZlIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgV29ya3RyZWVSZW1vdmUgaG9vayBoYW5kbGVyLlxuICpcbiAqIFdvcmt0cmVlUmVtb3ZlIGhvb2tzIGZpcmUgd2hlbiBhIGdpdCB3b3JrdHJlZSBpcyByZW1vdmVkLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIENsZWFuIHVwIHdvcmt0cmVlLXNwZWNpZmljIHJlc291cmNlc1xuICogLSBMb2cgd29ya3RyZWUgcmVtb3ZhbCBldmVudHNcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHdvcmt0cmVlIHJlbW92YWwgZXZlbnRzXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgd29ya3RyZWVSZW1vdmVIb29rLCB3b3JrdHJlZVJlbW92ZU91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgd29ya3RyZWVSZW1vdmVIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ1dvcmt0cmVlIHJlbW92ZWQnLCB7IHBhdGg6IGlucHV0Lndvcmt0cmVlX3BhdGggfSk7XG4gKiAgIHJldHVybiB3b3JrdHJlZVJlbW92ZU91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3dvcmt0cmVlcmVtb3ZlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB3b3JrdHJlZVJlbW92ZUhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIldvcmt0cmVlUmVtb3ZlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBDd2RDaGFuZ2VkIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgQ3dkQ2hhbmdlZCBob29rIGhhbmRsZXIuXG4gKlxuICogQ3dkQ2hhbmdlZCBob29rcyBmaXJlIHdoZW4gQ2xhdWRlIENvZGUncyBjdXJyZW50IHdvcmtpbmcgZGlyZWN0b3J5IGNoYW5nZXMsXG4gKiBhbGxvd2luZyB5b3UgdG86XG4gKiAtIFJlYWN0IHRvIGRpcmVjdG9yeSBjaGFuZ2VzIHdpdGhpbiBhIHNlc3Npb25cbiAqIC0gVXBkYXRlIGZpbGUgd2F0Y2hlcnMgb3IgZW52aXJvbm1lbnQgc3RhdGVcbiAqIC0gUmV0dXJuIGB3YXRjaFBhdGhzYCB2aWEgYGhvb2tTcGVjaWZpY091dHB1dGAgdG8gcmVnaXN0ZXIgcGF0aHMgZm9yIEZpbGVDaGFuZ2VkIGV2ZW50c1xuICpcbiAqICoqTWF0Y2hlcioqOiBObyBtYXRjaGVyIHN1cHBvcnQgLSBmaXJlcyBvbiBhbGwgY3dkIGNoYW5nZSBldmVudHNcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBjd2RDaGFuZ2VkSG9vaywgY3dkQ2hhbmdlZE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgY3dkQ2hhbmdlZEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnV29ya2luZyBkaXJlY3RvcnkgY2hhbmdlZCcsIHsgZnJvbTogaW5wdXQub2xkX2N3ZCwgdG86IGlucHV0Lm5ld19jd2QgfSk7XG4gKiAgIHJldHVybiBjd2RDaGFuZ2VkT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjY3dkY2hhbmdlZFxuICovXG5leHBvcnQgZnVuY3Rpb24gY3dkQ2hhbmdlZEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIkN3ZENoYW5nZWRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEZpbGVDaGFuZ2VkIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgRmlsZUNoYW5nZWQgaG9vayBoYW5kbGVyLlxuICpcbiAqIEZpbGVDaGFuZ2VkIGhvb2tzIGZpcmUgd2hlbiBhIHdhdGNoZWQgZmlsZSBjaGFuZ2VzIG9uIGRpc2ssIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gUmVhY3QgdG8gZmlsZSBzeXN0ZW0gY2hhbmdlcyBkdXJpbmcgYSBzZXNzaW9uXG4gKiAtIEludmFsaWRhdGUgY2FjaGVzIG9yIHJlbG9hZCBjb25maWd1cmF0aW9uXG4gKiAtIFJldHVybiBgd2F0Y2hQYXRoc2AgdmlhIGBob29rU3BlY2lmaWNPdXRwdXRgIHRvIHVwZGF0ZSB0aGUgc2V0IG9mIHdhdGNoZWQgcGF0aHNcbiAqXG4gKiBUaGUgaW5wdXQgYGV2ZW50YCBmaWVsZCBpbmRpY2F0ZXMgdGhlIHR5cGUgb2YgY2hhbmdlOlxuICogLSBgJ2NoYW5nZSdgIC0gRmlsZSBjb250ZW50cyBjaGFuZ2VkXG4gKiAtIGAnYWRkJ2AgLSBGaWxlIHdhcyBjcmVhdGVkXG4gKiAtIGAndW5saW5rJ2AgLSBGaWxlIHdhcyBkZWxldGVkXG4gKlxuICogKipNYXRjaGVyKio6IE5vIG1hdGNoZXIgc3VwcG9ydCAtIGZpcmVzIG9uIGFsbCBmaWxlIGNoYW5nZSBldmVudHNcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBmaWxlQ2hhbmdlZEhvb2ssIGZpbGVDaGFuZ2VkT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiBleHBvcnQgZGVmYXVsdCBmaWxlQ2hhbmdlZEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnRmlsZSBjaGFuZ2VkJywgeyBwYXRoOiBpbnB1dC5maWxlX3BhdGgsIGV2ZW50OiBpbnB1dC5ldmVudCB9KTtcbiAqICAgcmV0dXJuIGZpbGVDaGFuZ2VkT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjZmlsZWNoYW5nZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZpbGVDaGFuZ2VkSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiRmlsZUNoYW5nZWRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIE1lc3NhZ2VEaXNwbGF5IEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgTWVzc2FnZURpc3BsYXkgaG9vayBoYW5kbGVyLlxuICpcbiAqIE1lc3NhZ2VEaXNwbGF5IGhvb2tzIGZpcmUgd2l0aCBlYWNoIGJhdGNoIG9mIG5ld2x5IGNvbXBsZXRlZCBsaW5lcyB3aGlsZSBhblxuICogYXNzaXN0YW50IG1lc3NhZ2Ugc3RyZWFtcy4gRGlzcGxheS1vbmx5OiB0aGUgc3RvcmVkIG1lc3NhZ2UgYW5kIHdoYXQgdGhlIG1vZGVsXG4gKiBzZWVzIGFyZSB1bnRvdWNoZWQuIEFsbG93cyB5b3UgdG86XG4gKiAtIFJlcGxhY2UgdGhlIGRlbHRhIHNob3duIG9uIHNjcmVlbiB3aXRoIGN1c3RvbSBjb250ZW50IHZpYSBgZGlzcGxheUNvbnRlbnRgXG4gKiAtIE9ic2VydmUgYW5kIGxvZyBtZXNzYWdlIHN0cmVhbWluZyBldmVudHNcbiAqXG4gKiBUaGUgaW5wdXQgY2FycmllcyBgdHVybl9pZGAsIGBtZXNzYWdlX2lkYCwgYGluZGV4YCwgYGZpbmFsYCwgYW5kIGBkZWx0YWAgZmllbGRzLlxuICogVGhlIGBmaW5hbGAgZmxhZyBpbmRpY2F0ZXMgdGhlIGxhc3QgZmx1c2ggb2YgYSBtZXNzYWdlIFx1MjAxNCBpdHMgYGRlbHRhYCBpcyBlbXB0eVxuICogd2hlbiB0aGUgbWVzc2FnZSBlbmRzIG9uIGEgbmV3bGluZTsgdHJlYXQgYGZpbmFsYCBhcyB0aGUgZW5kLW9mLW1lc3NhZ2Ugc2lnbmFsLlxuICpcbiAqICoqTWF0Y2hlcioqOiBObyBtYXRjaGVyIHN1cHBvcnQgLSBmaXJlcyBvbiBhbGwgbWVzc2FnZSBkaXNwbGF5IGV2ZW50c1xuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IG1lc3NhZ2VEaXNwbGF5SG9vaywgbWVzc2FnZURpc3BsYXlPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIGV4cG9ydCBkZWZhdWx0IG1lc3NhZ2VEaXNwbGF5SG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGlmIChpbnB1dC5maW5hbCkge1xuICogICAgIGxvZ2dlci5pbmZvKCdNZXNzYWdlIGNvbXBsZXRlJywgeyBtZXNzYWdlSWQ6IGlucHV0Lm1lc3NhZ2VfaWQgfSk7XG4gKiAgIH1cbiAqICAgcmV0dXJuIG1lc3NhZ2VEaXNwbGF5T3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjbWVzc2FnZWRpc3BsYXlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lc3NhZ2VEaXNwbGF5SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiTWVzc2FnZURpc3BsYXlcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbiIsICIvKipcbiAqIExvZ2dlciBzeXN0ZW0gZm9yIENsYXVkZSBDb2RlIGhvb2tzLlxuICpcbiAqIFByb3ZpZGVzIHN0cnVjdHVyZWQgbG9nZ2luZyB3aXRoIGV2ZW50IHN1YnNjcmlwdGlvbiBhbmQgb3B0aW9uYWwgZmlsZSBvdXRwdXQuXG4gKiBUaGUgbG9nZ2VyIGlzICoqc2lsZW50IGJ5IGRlZmF1bHQqKiB0byBhdm9pZCBpbnRlcmZlcmluZyB3aXRoIGhvb2sgcHJvdG9jb2xcbiAqIChzdGRvdXQgaXMgcmVzZXJ2ZWQgZm9yIEpTT04gcmVzcG9uc2VzLCBzdGRlcnIgbWF5IGNvbmZsaWN0IHdpdGggQ2xhdWRlIENvZGUpLlxuICogQG1vZHVsZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IGxvZ2dlciB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gU3Vic2NyaWJlIHRvIGxvZyBldmVudHNcbiAqIGNvbnN0IHVuc3Vic2NyaWJlID0gbG9nZ2VyLm9uKCdlcnJvcicsIChldmVudCkgPT4ge1xuICogICBjb25zb2xlLmVycm9yKGBFcnJvciBpbiAke2V2ZW50Lmhvb2tUeXBlfTogJHtldmVudC5tZXNzYWdlfWApO1xuICogfSk7XG4gKlxuICogLy8gTGF0ZXIsIGNsZWFuIHVwXG4gKiB1bnN1YnNjcmliZSgpO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3NcbiAqL1xuaW1wb3J0IHsgY2xvc2VTeW5jLCBleGlzdHNTeW5jLCBta2RpclN5bmMsIG9wZW5TeW5jLCB3cml0ZVN5bmMgfSBmcm9tIFwibm9kZTpmc1wiO1xuaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gXCJub2RlOnBhdGhcIjtcbi8qKlxuICogQWxsIGxvZyBsZXZlbHMgaW4gb3JkZXIgb2Ygc2V2ZXJpdHkgKGxvd2VzdCB0byBoaWdoZXN0KS5cbiAqL1xuZXhwb3J0IGNvbnN0IExPR19MRVZFTFMgPSBbXCJkZWJ1Z1wiLCBcImluZm9cIiwgXCJ3YXJuXCIsIFwiZXJyb3JcIl07XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBMb2dnZXIgQ2xhc3Ncbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogTG9nZ2VyIGZvciBDbGF1ZGUgQ29kZSBob29rcyB3aXRoIGV2ZW50IHN1YnNjcmlwdGlvbiBhbmQgZmlsZSBvdXRwdXQuXG4gKlxuICogIyMgS2V5IEJlaGF2aW9yc1xuICpcbiAqIHwgQ29uZmlndXJhdGlvbiB8IEJlaGF2aW9yIHxcbiAqIHwtLS0tLS0tLS0tLS0tLXwtLS0tLS0tLS0tfFxuICogfCBObyBjb25maWcgKGRlZmF1bHQpIHwgKipTaWxlbnQqKiAtIG5vIG91dHB1dCBhbnl3aGVyZSB8XG4gKiB8IGBDTEFVREVfQ09ERV9IT09LU19MT0dfRklMRWAgZW52IHZhciB8IEFwcGVuZCBKU09OIGxpbmVzIHRvIGZpbGUgfFxuICogfCBgLm9uKGxldmVsLCBoYW5kbGVyKWAgcmVnaXN0ZXJlZCB8IEV2ZW50cyBkZWxpdmVyZWQgdG8gaGFuZGxlcnMgb25seSB8XG4gKiB8IE11bHRpcGxlIGRlc3RpbmF0aW9ucyB8IEFsbCBkZXN0aW5hdGlvbnMgcmVjZWl2ZSBldmVudHMgfFxuICpcbiAqICMjIEltcG9ydGFudCBOb3Rlc1xuICpcbiAqIC0gKipOZXZlciBvdXRwdXRzIHRvIHN0ZG91dCoqIChyZXNlcnZlZCBmb3IgSlNPTiBob29rIHJlc3BvbnNlKVxuICogLSAqKk5ldmVyIG91dHB1dHMgdG8gc3RkZXJyKiogKG1heSBpbnRlcmZlcmUgd2l0aCBDbGF1ZGUgQ29kZSBlcnJvciBoYW5kbGluZylcbiAqIC0gRmlsZSBvdXRwdXQgdXNlcyBKU09OIExpbmVzIGZvcm1hdCBmb3IgZWFzeSBwYXJzaW5nXG4gKiAtIGAub24obGV2ZWwsIGhhbmRsZXIpYCByZXR1cm5zIGFuIHVuc3Vic2NyaWJlIGZ1bmN0aW9uXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBTdWJzY3JpYmUgdG8gZXZlbnRzIGF0IHNwZWNpZmljIGxldmVsXG4gKiBsb2dnZXIub24oJ3dhcm4nLCAoZXZlbnQpID0+IHtcbiAqICAgc2VuZEFsZXJ0KGV2ZW50Lm1lc3NhZ2UpO1xuICogfSk7XG4gKlxuICogLy8gTG9nIHdpdGhpbiBhIGhvb2sgaGFuZGxlclxuICogZXhwb3J0IGRlZmF1bHQgcHJlVG9vbFVzZUhvb2soeyBtYXRjaGVyOiAnQmFzaCcgfSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci53YXJuKCdBYm91dCB0byB2YWxpZGF0ZSBCYXNoIGNvbW1hbmQnKTtcbiAqICAgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoeyBhbGxvdzogdHJ1ZSB9KTtcbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjbGFzcyBMb2dnZXIge1xuICAgIC8qKlxuICAgICAqIFJlZ2lzdGVyZWQgZXZlbnQgaGFuZGxlcnMgYnkgbG9nIGxldmVsLlxuICAgICAqL1xuICAgIGhhbmRsZXJzID0gbmV3IE1hcCgpO1xuICAgIC8qKlxuICAgICAqIEZpbGUgZGVzY3JpcHRvciBmb3IgbG9nIGZpbGUgb3V0cHV0LlxuICAgICAqIExhemlseSBpbml0aWFsaXplZCBvbiBmaXJzdCB3cml0ZS5cbiAgICAgKi9cbiAgICBsb2dGaWxlRmQgPSBudWxsO1xuICAgIC8qKlxuICAgICAqIFBhdGggdG8gdGhlIGxvZyBmaWxlLCBpZiBjb25maWd1cmVkLlxuICAgICAqL1xuICAgIGxvZ0ZpbGVQYXRoID0gbnVsbDtcbiAgICAvKipcbiAgICAgKiBXaGV0aGVyIGZpbGUgaW5pdGlhbGl6YXRpb24gaGFzIGJlZW4gYXR0ZW1wdGVkLlxuICAgICAqL1xuICAgIGZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIC8qKlxuICAgICAqIEN1cnJlbnQgaG9vayBjb250ZXh0IGZvciBlbnJpY2hpbmcgbG9nIGV2ZW50cy5cbiAgICAgKi9cbiAgICBjdXJyZW50SG9va1R5cGU7XG4gICAgLyoqXG4gICAgICogQ3VycmVudCBob29rIGlucHV0IGZvciBlbnJpY2hpbmcgbG9nIGV2ZW50cy5cbiAgICAgKi9cbiAgICBjdXJyZW50SW5wdXQ7XG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhIG5ldyBMb2dnZXIgaW5zdGFuY2UuXG4gICAgICpcbiAgICAgKiBUeXBpY2FsbHkgeW91IHNob3VsZCB1c2UgdGhlIGV4cG9ydGVkIGBsb2dnZXJgIHNpbmdsZXRvbiByYXRoZXIgdGhhblxuICAgICAqIGNyZWF0aW5nIG5ldyBpbnN0YW5jZXMuXG4gICAgICogQHBhcmFtIGNvbmZpZyAtIE9wdGlvbmFsIGNvbmZpZ3VyYXRpb25cbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGBgYHR5cGVzY3JpcHRcbiAgICAgKiAvLyBVc2Ugc2luZ2xldG9uIChyZWNvbW1lbmRlZClcbiAgICAgKiBpbXBvcnQgeyBsb2dnZXIgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICAgICAqXG4gICAgICogLy8gT3IgY3JlYXRlIGN1c3RvbSBpbnN0YW5jZVxuICAgICAqIGNvbnN0IGN1c3RvbUxvZ2dlciA9IG5ldyBMb2dnZXIoeyBsb2dGaWxlUGF0aDogJy92YXIvbG9nL2hvb2tzLmxvZycgfSk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgY29uc3RydWN0b3IoY29uZmlnID0ge30pIHtcbiAgICAgICAgLy8gSW5pdGlhbGl6ZSBoYW5kbGVycyBtYXAgZm9yIGVhY2ggbGV2ZWxcbiAgICAgICAgZm9yIChjb25zdCBsZXZlbCBvZiBMT0dfTEVWRUxTKSB7XG4gICAgICAgICAgICB0aGlzLmhhbmRsZXJzLnNldChsZXZlbCwgbmV3IFNldCgpKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBTZXQgbG9nIGZpbGUgcGF0aCBmcm9tIGV4cGxpY2l0IGNvbmZpZywgb3IgYnkgcmVhZGluZyB0aGUgY29uZmlndXJlZCBlbnYgdmFyXG4gICAgICAgIHRoaXMubG9nRmlsZVBhdGggPSBjb25maWcubG9nRmlsZVBhdGggPz8gKGNvbmZpZy5sb2dFbnZWYXIgPyBwcm9jZXNzLmVudltjb25maWcubG9nRW52VmFyXSA6IHVuZGVmaW5lZCkgPz8gbnVsbDtcbiAgICB9XG4gICAgLyoqXG4gICAgICogTG9ncyBhIGRlYnVnIG1lc3NhZ2UuXG4gICAgICpcbiAgICAgKiBVc2UgZm9yIGRldGFpbGVkIGRlYnVnZ2luZyBpbmZvcm1hdGlvbiB0aGF0IGlzIHR5cGljYWxseSBvbmx5IHVzZWZ1bFxuICAgICAqIGR1cmluZyBkZXZlbG9wbWVudCBvciB0cm91Ymxlc2hvb3RpbmcuXG4gICAgICogQHBhcmFtIG1lc3NhZ2UgLSBUaGUgZGVidWcgbWVzc2FnZVxuICAgICAqIEBwYXJhbSBjb250ZXh0IC0gT3B0aW9uYWwgYWRkaXRpb25hbCBjb250ZXh0XG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0eXBlc2NyaXB0XG4gICAgICogbG9nZ2VyLmRlYnVnKCdQcm9jZXNzaW5nIHRvb2wgaW5wdXQnLCB7IHRvb2xOYW1lOiAnQmFzaCcsIGlucHV0U2l6ZTogMjU2IH0pO1xuICAgICAqIGBgYFxuICAgICAqL1xuICAgIGRlYnVnKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZGVidWdcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIExvZ3MgYW4gaW5mbyBtZXNzYWdlLlxuICAgICAqXG4gICAgICogVXNlIGZvciBnZW5lcmFsIG9wZXJhdGlvbmFsIGV2ZW50cyBsaWtlIGhvb2sgaW52b2NhdGlvbnMsIHN1Y2Nlc3NmdWxcbiAgICAgKiBjb21wbGV0aW9ucywgb3Igc3RhdGUgY2hhbmdlcy5cbiAgICAgKiBAcGFyYW0gbWVzc2FnZSAtIFRoZSBpbmZvIG1lc3NhZ2VcbiAgICAgKiBAcGFyYW0gY29udGV4dCAtIE9wdGlvbmFsIGFkZGl0aW9uYWwgY29udGV4dFxuICAgICAqIEBleGFtcGxlXG4gICAgICogYGBgdHlwZXNjcmlwdFxuICAgICAqIGxvZ2dlci5pbmZvKCdTZXNzaW9uIHN0YXJ0ZWQnLCB7IHNvdXJjZTogJ3N0YXJ0dXAnLCBzZXNzaW9uSWQ6ICdhYmMxMjMnIH0pO1xuICAgICAqIGBgYFxuICAgICAqL1xuICAgIGluZm8obWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJpbmZvXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBMb2dzIGEgd2FybmluZyBtZXNzYWdlLlxuICAgICAqXG4gICAgICogVXNlIGZvciBjb25kaXRpb25zIHRoYXQgbWF5IGluZGljYXRlIGlzc3VlcyBidXQgZG9uJ3QgcHJldmVudFxuICAgICAqIG9wZXJhdGlvbiwgc3VjaCBhcyBkZXByZWNhdGVkIHBhdHRlcm5zIG9yIHBlcmZvcm1hbmNlIGNvbmNlcm5zLlxuICAgICAqIEBwYXJhbSBtZXNzYWdlIC0gVGhlIHdhcm5pbmcgbWVzc2FnZVxuICAgICAqIEBwYXJhbSBjb250ZXh0IC0gT3B0aW9uYWwgYWRkaXRpb25hbCBjb250ZXh0XG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0eXBlc2NyaXB0XG4gICAgICogbG9nZ2VyLndhcm4oJ0RlcHJlY2F0ZWQgaG9vayBwYXR0ZXJuIGRldGVjdGVkJywgeyBwYXR0ZXJuOiAnbGVnYWN5TWF0Y2hlcicgfSk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgd2FybihtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcIndhcm5cIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIExvZ3MgYW4gZXJyb3IgbWVzc2FnZS5cbiAgICAgKlxuICAgICAqIFVzZSBmb3IgZXJyb3IgY29uZGl0aW9ucyB0aGF0IHJlcXVpcmUgYXR0ZW50aW9uIGJ1dCB3ZXJlIGhhbmRsZWRcbiAgICAgKiBncmFjZWZ1bGx5LiBGb3IgZXhjZXB0aW9ucywgcHJlZmVyIHtAbGluayBsb2dFcnJvcn0uXG4gICAgICogQHBhcmFtIG1lc3NhZ2UgLSBUaGUgZXJyb3IgbWVzc2FnZVxuICAgICAqIEBwYXJhbSBjb250ZXh0IC0gT3B0aW9uYWwgYWRkaXRpb25hbCBjb250ZXh0XG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0eXBlc2NyaXB0XG4gICAgICogbG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gdmFsaWRhdGUgdG9vbCBpbnB1dCcsIHsgdG9vbE5hbWU6ICdCYXNoJywgcmVhc29uOiAnZW1wdHkgY29tbWFuZCcgfSk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgZXJyb3IobWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJlcnJvclwiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogTG9ncyBhIHN0cnVjdHVyZWQgZXJyb3Igd2l0aCBmdWxsIGVycm9yIGRldGFpbHMuXG4gICAgICpcbiAgICAgKiBVc2UgdGhpcyBtZXRob2Qgd2hlbiBsb2dnaW5nIGNhdWdodCBleGNlcHRpb25zIHRvIGNhcHR1cmUgdGhlIGZ1bGxcbiAgICAgKiBlcnJvciBjb250ZXh0IGluY2x1ZGluZyBuYW1lLCBtZXNzYWdlLCBzdGFjayB0cmFjZSwgYW5kIGNhdXNlIGNoYWluLlxuICAgICAqIEBwYXJhbSBlcnJvciAtIFRoZSBlcnJvciB0byBsb2dcbiAgICAgKiBAcGFyYW0gbWVzc2FnZSAtIEh1bWFuLXJlYWRhYmxlIGRlc2NyaXB0aW9uIG9mIHdoYXQgZmFpbGVkXG4gICAgICogQHBhcmFtIGNvbnRleHQgLSBPcHRpb25hbCBhZGRpdGlvbmFsIGNvbnRleHRcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGBgYHR5cGVzY3JpcHRcbiAgICAgKiB0cnkge1xuICAgICAqICAgYXdhaXQgZGFuZ2Vyb3VzT3BlcmF0aW9uKCk7XG4gICAgICogfSBjYXRjaCAoZXJyKSB7XG4gICAgICogICBsb2dnZXIubG9nRXJyb3IoZXJyLCAnRmFpbGVkIHRvIGV4ZWN1dGUgZGFuZ2Vyb3VzIG9wZXJhdGlvbicsIHtcbiAgICAgKiAgICAgb3BlcmF0aW9uOiAnZGVsZXRlJyxcbiAgICAgKiAgICAgdGFyZ2V0OiAnL2ltcG9ydGFudC9maWxlLnR4dCdcbiAgICAgKiAgIH0pO1xuICAgICAqIH1cbiAgICAgKiBgYGBcbiAgICAgKi9cbiAgICBsb2dFcnJvcihlcnJvciwgbWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICBjb25zdCBlcnJvckluZm8gPSB0aGlzLmV4dHJhY3RFcnJvckluZm8oZXJyb3IpO1xuICAgICAgICBjb25zdCBldmVudCA9IHtcbiAgICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgbGV2ZWw6IFwiZXJyb3JcIixcbiAgICAgICAgICAgIGhvb2tUeXBlOiB0aGlzLmN1cnJlbnRIb29rVHlwZSxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICBpbnB1dDogdGhpcy5jdXJyZW50SW5wdXQsXG4gICAgICAgICAgICBlcnJvcjogZXJyb3JJbmZvLFxuICAgICAgICAgICAgY29udGV4dCxcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5kZWxpdmVyRXZlbnQoZXZlbnQpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBTdWJzY3JpYmVzIGEgaGFuZGxlciB0byBsb2cgZXZlbnRzIGF0IHRoZSBzcGVjaWZpZWQgbGV2ZWwuXG4gICAgICpcbiAgICAgKiBUaGUgaGFuZGxlciB3aWxsIGJlIGNhbGxlZCBmb3IgZXZlcnkgbG9nIGV2ZW50IGF0IHRoZSBzcGVjaWZpZWQgbGV2ZWwuXG4gICAgICogUmV0dXJucyBhbiB1bnN1YnNjcmliZSBmdW5jdGlvbiB0aGF0IHNob3VsZCBiZSBjYWxsZWQgd2hlbiB0aGUgaGFuZGxlclxuICAgICAqIGlzIG5vIGxvbmdlciBuZWVkZWQuXG4gICAgICogQHBhcmFtIGxldmVsIC0gVGhlIGxvZyBsZXZlbCB0byBzdWJzY3JpYmUgdG9cbiAgICAgKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGNhbGwgZm9yIGVhY2ggZXZlbnRcbiAgICAgKiBAcmV0dXJucyBBIGZ1bmN0aW9uIHRvIHVuc3Vic2NyaWJlIHRoZSBoYW5kbGVyXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0eXBlc2NyaXB0XG4gICAgICogLy8gU3Vic2NyaWJlIHRvIGVycm9yIGV2ZW50c1xuICAgICAqIGNvbnN0IHVuc3Vic2NyaWJlID0gbG9nZ2VyLm9uKCdlcnJvcicsIChldmVudCkgPT4ge1xuICAgICAqICAgY29uc29sZS5lcnJvcihgWyR7ZXZlbnQuaG9va1R5cGV9XSAke2V2ZW50Lm1lc3NhZ2V9YCk7XG4gICAgICogICBpZiAoZXZlbnQuZXJyb3IpIHtcbiAgICAgKiAgICAgY29uc29sZS5lcnJvcihldmVudC5lcnJvci5zdGFjayk7XG4gICAgICogICB9XG4gICAgICogfSk7XG4gICAgICpcbiAgICAgKiAvLyBMYXRlciwgY2xlYW4gdXBcbiAgICAgKiB1bnN1YnNjcmliZSgpO1xuICAgICAqIGBgYFxuICAgICAqIEBleGFtcGxlXG4gICAgICogYGBgdHlwZXNjcmlwdFxuICAgICAqIC8vIEZvcndhcmQgdG8gZXh0ZXJuYWwgbG9nZ2luZyBsaWJyYXJ5XG4gICAgICogaW1wb3J0IHBpbm8gZnJvbSAncGlubyc7XG4gICAgICogY29uc3QgcGlub0xvZ2dlciA9IHBpbm8oKTtcbiAgICAgKlxuICAgICAqIGxvZ2dlci5vbignaW5mbycsIChldmVudCkgPT4gcGlub0xvZ2dlci5pbmZvKGV2ZW50LCBldmVudC5tZXNzYWdlKSk7XG4gICAgICogbG9nZ2VyLm9uKCd3YXJuJywgKGV2ZW50KSA9PiBwaW5vTG9nZ2VyLndhcm4oZXZlbnQsIGV2ZW50Lm1lc3NhZ2UpKTtcbiAgICAgKiBsb2dnZXIub24oJ2Vycm9yJywgKGV2ZW50KSA9PiBwaW5vTG9nZ2VyLmVycm9yKGV2ZW50LCBldmVudC5tZXNzYWdlKSk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgb24obGV2ZWwsIGhhbmRsZXIpIHtcbiAgICAgICAgY29uc3QgbGV2ZWxIYW5kbGVycyA9IHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKTtcbiAgICAgICAgaWYgKGxldmVsSGFuZGxlcnMpIHtcbiAgICAgICAgICAgIGxldmVsSGFuZGxlcnMuYWRkKGhhbmRsZXIpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgICAgICBsZXZlbEhhbmRsZXJzPy5kZWxldGUoaGFuZGxlcik7XG4gICAgICAgIH07XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFNldHMgdGhlIGN1cnJlbnQgaG9vayBjb250ZXh0IGZvciBlbnJpY2hpbmcgbG9nIGV2ZW50cy5cbiAgICAgKlxuICAgICAqIFRoaXMgaXMgY2FsbGVkIGludGVybmFsbHkgYnkgdGhlIHJ1bnRpbWUgYmVmb3JlIGludm9raW5nIGhvb2sgaGFuZGxlcnMuXG4gICAgICogWW91IHR5cGljYWxseSBkb24ndCBuZWVkIHRvIGNhbGwgdGhpcyBkaXJlY3RseS5cbiAgICAgKiBAcGFyYW0gaG9va1R5cGUgLSBUaGUgdHlwZSBvZiBob29rIGJlaW5nIGV4ZWN1dGVkXG4gICAgICogQHBhcmFtIGlucHV0IC0gVGhlIGhvb2sgaW5wdXQgZGF0YVxuICAgICAqIEBpbnRlcm5hbFxuICAgICAqL1xuICAgIHNldENvbnRleHQoaG9va1R5cGUsIGlucHV0KSB7XG4gICAgICAgIHRoaXMuY3VycmVudEhvb2tUeXBlID0gaG9va1R5cGU7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gaW5wdXQ7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENsZWFycyB0aGUgY3VycmVudCBob29rIGNvbnRleHQuXG4gICAgICpcbiAgICAgKiBDYWxsZWQgaW50ZXJuYWxseSBieSB0aGUgcnVudGltZSBhZnRlciBob29rIGV4ZWN1dGlvbiBjb21wbGV0ZXMuXG4gICAgICogQGludGVybmFsXG4gICAgICovXG4gICAgY2xlYXJDb250ZXh0KCkge1xuICAgICAgICB0aGlzLmN1cnJlbnRIb29rVHlwZSA9IHVuZGVmaW5lZDtcbiAgICAgICAgdGhpcy5jdXJyZW50SW5wdXQgPSB1bmRlZmluZWQ7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENvbmZpZ3VyZXMgdGhlIGxvZyBmaWxlIHBhdGggYXQgcnVudGltZS5cbiAgICAgKlxuICAgICAqIENhbGwgdGhpcyB0byBlbmFibGUgb3IgY2hhbmdlIGZpbGUgbG9nZ2luZy4gU2V0dGluZyB0byBgbnVsbGAgZGlzYWJsZXNcbiAgICAgKiBmaWxlIGxvZ2dpbmcgKGJ1dCBkb2Vzbid0IGNsb3NlIGV4aXN0aW5nIGZpbGUgaGFuZGxlIGltbWVkaWF0ZWx5KS5cbiAgICAgKiBAcGFyYW0gZmlsZVBhdGggLSBQYXRoIHRvIHRoZSBsb2cgZmlsZSwgb3IgbnVsbCB0byBkaXNhYmxlXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0eXBlc2NyaXB0XG4gICAgICogLy8gRW5hYmxlIGZpbGUgbG9nZ2luZyBhdCBydW50aW1lXG4gICAgICogbG9nZ2VyLnNldExvZ0ZpbGUoJy92YXIvbG9nL2NsYXVkZS1ob29rcy5sb2cnKTtcbiAgICAgKlxuICAgICAqIC8vIERpc2FibGUgZmlsZSBsb2dnaW5nXG4gICAgICogbG9nZ2VyLnNldExvZ0ZpbGUobnVsbCk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgc2V0TG9nRmlsZShmaWxlUGF0aCkge1xuICAgICAgICAvLyBDbG9zZSBleGlzdGluZyBmaWxlIGlmIG9wZW5cbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZUZkICE9PSBudWxsKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNsb3NlU3luYyh0aGlzLmxvZ0ZpbGVGZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXRjaCAoY2xvc2VFcnJvcikge1xuICAgICAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGBbY2xhdWRlLWNvZGUtaG9va3NdIEZhaWxlZCB0byBjbG9zZSBsb2cgZmlsZTogJHtTdHJpbmcoY2xvc2VFcnJvcil9XFxuYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLmxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5sb2dGaWxlUGF0aCA9IGZpbGVQYXRoO1xuICAgICAgICB0aGlzLmZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBDbG9zZXMgYWxsIHJlc291cmNlcyBoZWxkIGJ5IHRoZSBsb2dnZXIuXG4gICAgICpcbiAgICAgKiBDYWxsIHRoaXMgZHVyaW5nIGdyYWNlZnVsIHNodXRkb3duIHRvIGVuc3VyZSBhbGwgbG9nIGRhdGEgaXMgZmx1c2hlZC5cbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGBgYHR5cGVzY3JpcHRcbiAgICAgKiBwcm9jZXNzLm9uKCdleGl0JywgKCkgPT4ge1xuICAgICAqICAgbG9nZ2VyLmNsb3NlKCk7XG4gICAgICogfSk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgY2xvc2UoKSB7XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjbG9zZVN5bmModGhpcy5sb2dGaWxlRmQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2F0Y2ggKGNsb3NlRXJyb3IpIHtcbiAgICAgICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgW2NsYXVkZS1jb2RlLWhvb2tzXSBGYWlsZWQgdG8gY2xvc2UgbG9nIGZpbGU6ICR7U3RyaW5nKGNsb3NlRXJyb3IpfVxcbmApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5sb2dGaWxlRmQgPSBudWxsO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuZmlsZUluaXRpYWxpemVkID0gZmFsc2U7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENoZWNrcyBpZiB0aGVyZSBhcmUgYW55IGFjdGl2ZSBoYW5kbGVycyBvciBkZXN0aW5hdGlvbnMuXG4gICAgICpcbiAgICAgKiBSZXR1cm5zIHRydWUgaWYgYW55IGhhbmRsZXJzIGFyZSByZWdpc3RlcmVkIG9yIGZpbGUgbG9nZ2luZyBpcyBlbmFibGVkLlxuICAgICAqIEByZXR1cm5zIFdoZXRoZXIgdGhlIGxvZ2dlciBoYXMgYW55IGFjdGl2ZSBvdXRwdXQgZGVzdGluYXRpb25zXG4gICAgICovXG4gICAgaGFzRGVzdGluYXRpb25zKCkge1xuICAgICAgICBmb3IgKGNvbnN0IGhhbmRsZXJzIG9mIHRoaXMuaGFuZGxlcnMudmFsdWVzKCkpIHtcbiAgICAgICAgICAgIGlmIChoYW5kbGVycy5zaXplID4gMClcbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5sb2dGaWxlUGF0aCAhPT0gbnVsbDtcbiAgICB9XG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFByaXZhdGUgTWV0aG9kc1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvKipcbiAgICAgKiBFbWl0cyBhIGxvZyBldmVudC5cbiAgICAgKiBAcGFyYW0gbGV2ZWwgLSBUaGUgc2V2ZXJpdHkgbGV2ZWwgb2YgdGhlIGV2ZW50XG4gICAgICogQHBhcmFtIG1lc3NhZ2UgLSBUaGUgbG9nIG1lc3NhZ2VcbiAgICAgKiBAcGFyYW0gY29udGV4dCAtIE9wdGlvbmFsIGFkZGl0aW9uYWwgY29udGV4dCBkYXRhXG4gICAgICovXG4gICAgZW1pdChsZXZlbCwgbWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICBjb25zdCBldmVudCA9IHtcbiAgICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgbGV2ZWwsXG4gICAgICAgICAgICBob29rVHlwZTogdGhpcy5jdXJyZW50SG9va1R5cGUsXG4gICAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgICAgaW5wdXQ6IHRoaXMuY3VycmVudElucHV0LFxuICAgICAgICAgICAgY29udGV4dCxcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5kZWxpdmVyRXZlbnQoZXZlbnQpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBEZWxpdmVycyBhbiBldmVudCB0byBhbGwgcmVnaXN0ZXJlZCBkZXN0aW5hdGlvbnMuXG4gICAgICogQHBhcmFtIGV2ZW50IC0gVGhlIGxvZyBldmVudCB0byBkZWxpdmVyXG4gICAgICovXG4gICAgZGVsaXZlckV2ZW50KGV2ZW50KSB7XG4gICAgICAgIC8vIERlbGl2ZXIgdG8gZXZlbnQgaGFuZGxlcnNcbiAgICAgICAgY29uc3QgbGV2ZWxIYW5kbGVycyA9IHRoaXMuaGFuZGxlcnMuZ2V0KGV2ZW50LmxldmVsKTtcbiAgICAgICAgaWYgKGxldmVsSGFuZGxlcnMpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgaGFuZGxlciBvZiBsZXZlbEhhbmRsZXJzKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgaGFuZGxlcihldmVudCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNhdGNoIChoYW5kbGVyRXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYFtjbGF1ZGUtY29kZS1ob29rc10gTG9nIGhhbmRsZXIgZXJyb3I6ICR7U3RyaW5nKGhhbmRsZXJFcnJvcil9XFxuYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIC8vIFdyaXRlIHRvIGZpbGUgaWYgY29uZmlndXJlZFxuICAgICAgICB0aGlzLndyaXRlVG9GaWxlKGV2ZW50KTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogV3JpdGVzIGFuIGV2ZW50IHRvIHRoZSBsb2cgZmlsZS5cbiAgICAgKiBAcGFyYW0gZXZlbnQgLSBUaGUgbG9nIGV2ZW50IHRvIHdyaXRlXG4gICAgICovXG4gICAgd3JpdGVUb0ZpbGUoZXZlbnQpIHtcbiAgICAgICAgaWYgKCF0aGlzLmxvZ0ZpbGVQYXRoKVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAvLyBMYXp5IGluaXRpYWxpemF0aW9uIG9mIGZpbGUgaGFuZGxlXG4gICAgICAgIGlmICghdGhpcy5maWxlSW5pdGlhbGl6ZWQpIHtcbiAgICAgICAgICAgIHRoaXMuaW5pdGlhbGl6ZUZpbGUoKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5sb2dGaWxlRmQgPT09IG51bGwpXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBsaW5lID0gYCR7SlNPTi5zdHJpbmdpZnkoZXZlbnQpfVxcbmA7XG4gICAgICAgICAgICB3cml0ZVN5bmModGhpcy5sb2dGaWxlRmQsIGxpbmUpO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoICh3cml0ZUVycm9yKSB7XG4gICAgICAgICAgICAvLyBEaXNhYmxlIGZpbGUgbG9nZ2luZyBhZnRlciBhIHdyaXRlIGZhaWx1cmUgdG8gYXZvaWQgcmVwZWF0ZWQgZXJyb3JzXG4gICAgICAgICAgICB0aGlzLmxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgICAgICAgICB0aGlzLmZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgICAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYFtjbGF1ZGUtY29kZS1ob29rc10gTG9nIGZpbGUgd3JpdGUgZmFpbGVkOiAke1N0cmluZyh3cml0ZUVycm9yKX1cXG5gKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBJbml0aWFsaXplcyB0aGUgbG9nIGZpbGUgZm9yIHdyaXRpbmcuXG4gICAgICovXG4gICAgaW5pdGlhbGl6ZUZpbGUoKSB7XG4gICAgICAgIHRoaXMuZmlsZUluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICAgICAgaWYgKCF0aGlzLmxvZ0ZpbGVQYXRoKVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgLy8gRW5zdXJlIGRpcmVjdG9yeSBleGlzdHNcbiAgICAgICAgICAgIGNvbnN0IGRpciA9IGRpcm5hbWUodGhpcy5sb2dGaWxlUGF0aCk7XG4gICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmMoZGlyKSkge1xuICAgICAgICAgICAgICAgIG1rZGlyU3luYyhkaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gT3BlbiBmaWxlIGZvciBhcHBlbmRpbmdcbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gb3BlblN5bmModGhpcy5sb2dGaWxlUGF0aCwgXCJhXCIpO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoIHtcbiAgICAgICAgICAgIC8vIFNpbGVudGx5IGlnbm9yZSBmaWxlIGluaXRpYWxpemF0aW9uIGVycm9yc1xuICAgICAgICAgICAgdGhpcy5sb2dGaWxlRmQgPSBudWxsO1xuICAgICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEV4dHJhY3RzIHN0cnVjdHVyZWQgZXJyb3IgaW5mb3JtYXRpb24gZnJvbSBhbiB1bmtub3duIGVycm9yLlxuICAgICAqIEBwYXJhbSBlcnJvciAtIFRoZSBlcnJvciB0byBleHRyYWN0IGluZm9ybWF0aW9uIGZyb21cbiAgICAgKiBAcmV0dXJucyBTdHJ1Y3R1cmVkIGVycm9yIGluZm9ybWF0aW9uXG4gICAgICovXG4gICAgZXh0cmFjdEVycm9ySW5mbyhlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICAgICAgY29uc3QgaW5mbyA9IHtcbiAgICAgICAgICAgICAgICBuYW1lOiBlcnJvci5uYW1lLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UsXG4gICAgICAgICAgICAgICAgc3RhY2s6IGVycm9yLnN0YWNrLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIC8vIEV4dHJhY3QgY2F1c2UgY2hhaW4gaWYgcHJlc2VudFxuICAgICAgICAgICAgaWYgKGVycm9yLmNhdXNlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICBpbmZvLmNhdXNlID0gdGhpcy5leHRyYWN0RXJyb3JJbmZvKGVycm9yLmNhdXNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBpbmZvO1xuICAgICAgICB9XG4gICAgICAgIC8vIEhhbmRsZSBub24tRXJyb3IgdmFsdWVzXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBuYW1lOiBcIlVua25vd25FcnJvclwiLFxuICAgICAgICAgICAgbWVzc2FnZTogU3RyaW5nKGVycm9yKSxcbiAgICAgICAgfTtcbiAgICB9XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTaW5nbGV0b24gRXhwb3J0XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIEdsb2JhbCBsb2dnZXIgaW5zdGFuY2UgZm9yIENsYXVkZSBDb2RlIGhvb2tzLlxuICpcbiAqIFVzZSB0aGlzIHNpbmdsZXRvbiBmb3IgYWxsIGxvZ2dpbmcgd2l0aGluIGhvb2tzLiBUaGUgbG9nZ2VyIGlzIGNvbmZpZ3VyZWRcbiAqIHZpYSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgYW5kIHN1cHBvcnRzIGV2ZW50IHN1YnNjcmlwdGlvbiBmb3IgY3VzdG9tXG4gKiBkZXN0aW5hdGlvbnMuXG4gKlxuICogIyMgQ29uZmlndXJhdGlvblxuICpcbiAqIHwgRW52aXJvbm1lbnQgVmFyaWFibGUgfCBEZXNjcmlwdGlvbiB8XG4gKiB8LS0tLS0tLS0tLS0tLS0tLS0tLS0tfC0tLS0tLS0tLS0tLS18XG4gKiB8IGBDTEFVREVfQ09ERV9IT09LU19MT0dfRklMRWAgfCBQYXRoIHRvIGxvZyBmaWxlIChKU09OIExpbmVzIGZvcm1hdCkgfFxuICpcbiAqICMjIFVzYWdlIGluIEhvb2tzXG4gKlxuICogVGhlIGxvZ2dlciBpcyBwYXNzZWQgdG8gaG9vayBoYW5kbGVycyB2aWEgY29udGV4dCBmb3IgY29udmVuaWVuY2U6XG4gKlxuICogYGBgdHlwZXNjcmlwdFxuICogZXhwb3J0IGRlZmF1bHQgcHJlVG9vbFVzZUhvb2soeyBtYXRjaGVyOiAnQmFzaCcgfSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci53YXJuKCdWYWxpZGF0aW5nIEJhc2ggY29tbWFuZCcpO1xuICogICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7IGFsbG93OiB0cnVlIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqXG4gKiAjIyBFeHRlcm5hbCBJbnRlZ3JhdGlvblxuICpcbiAqIFN1YnNjcmliZSB0byBldmVudHMgdG8gZm9yd2FyZCBsb2dzIHRvIGV4dGVybmFsIHN5c3RlbXM6XG4gKlxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqIGltcG9ydCBwaW5vIGZyb20gJ3Bpbm8nO1xuICpcbiAqIGNvbnN0IHBpbm9Mb2dnZXIgPSBwaW5vKHsgbGV2ZWw6ICdkZWJ1ZycgfSk7XG4gKlxuICogbG9nZ2VyLm9uKCdkZWJ1ZycsIChldmVudCkgPT4gcGlub0xvZ2dlci5kZWJ1ZyhldmVudCwgZXZlbnQubWVzc2FnZSkpO1xuICogbG9nZ2VyLm9uKCdpbmZvJywgKGV2ZW50KSA9PiBwaW5vTG9nZ2VyLmluZm8oZXZlbnQsIGV2ZW50Lm1lc3NhZ2UpKTtcbiAqIGxvZ2dlci5vbignd2FybicsIChldmVudCkgPT4gcGlub0xvZ2dlci53YXJuKGV2ZW50LCBldmVudC5tZXNzYWdlKSk7XG4gKiBsb2dnZXIub24oJ2Vycm9yJywgKGV2ZW50KSA9PiBwaW5vTG9nZ2VyLmVycm9yKGV2ZW50LCBldmVudC5tZXNzYWdlKSk7XG4gKiBgYGBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBEaXJlY3QgdXNhZ2VcbiAqIGltcG9ydCB7IGxvZ2dlciB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogbG9nZ2VyLmluZm8oJ1N0YXJ0aW5nIG9wZXJhdGlvbicpO1xuICogbG9nZ2VyLndhcm4oJ1Jlc291cmNlIGxpbWl0IGFwcHJvYWNoaW5nJywgeyB1c2FnZTogMC45IH0pO1xuICpcbiAqIHRyeSB7XG4gKiAgIGF3YWl0IHJpc2t5T3BlcmF0aW9uKCk7XG4gKiB9IGNhdGNoIChlcnIpIHtcbiAqICAgbG9nZ2VyLmxvZ0Vycm9yKGVyciwgJ1Jpc2t5IG9wZXJhdGlvbiBmYWlsZWQnKTtcbiAqIH1cbiAqIGBgYFxuICovXG4vLyBDTEFVREVfQ09ERV9IT09LU19MT0dfRU5WX1ZBUiBpcyBzZXQgdW5jb25kaXRpb25hbGx5IGJ5IHRoZSAtLWxvZy1lbnYtdmFyIGJhbm5lclxuLy8gYmVmb3JlIHRoaXMgbW9kdWxlIGluaXRpYWxpc2VzLiBJZiBhYnNlbnQsIGZhbGwgYmFjayB0byB0aGUgZGVmYXVsdCBlbnYgdmFyIG5hbWUuXG5leHBvcnQgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcih7XG4gICAgbG9nRW52VmFyOiBwcm9jZXNzLmVudi5DTEFVREVfQ09ERV9IT09LU19MT0dfRU5WX1ZBUiA/PyBcIkNMQVVERV9DT0RFX0hPT0tTX0xPR19GSUxFXCIsXG59KTtcbiIsICIvKipcbiAqIE91dHB1dCB0eXBlcyBhbmQgYnVpbGRlcnMgZm9yIENsYXVkZSBDb2RlIGhvb2tzLlxuICpcbiAqIFByb3ZpZGVzIHR5cGUtc2FmZSBvdXRwdXQgYnVpbGRlciBmdW5jdGlvbnMgZm9yIGFsbCAxMiBob29rIHR5cGVzLiBFYWNoIGJ1aWxkZXJcbiAqIGFjY2VwdHMgb3B0aW9ucyB0aGF0IG1hdGNoIHRoZSB3aXJlIGZvcm1hdCBleHBlY3RlZCBieSBDbGF1ZGUgQ29kZSwgd2l0aCB0eXBlc1xuICogZGVyaXZlZCBmcm9tIHRoZSBDbGF1ZGUgQWdlbnQgU0RLJ3MgYFN5bmNIb29rSlNPTk91dHB1dGAgdHlwZS5cbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rc1xuICogQG1vZHVsZVxuICovXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFeGl0IENvZGUgQ29uc3RhbnRzXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIEV4aXQgY29kZXMgdXNlZCBieSBDbGF1ZGUgQ29kZSBob29rcy5cbiAqXG4gKiB8IEV4aXQgQ29kZSB8IE5hbWUgfCBXaGVuIFVzZWQgfCBDbGF1ZGUgQ29kZSBCZWhhdmlvciB8XG4gKiB8LS0tLS0tLS0tLS18LS0tLS0tfC0tLS0tLS0tLS0tfC0tLS0tLS0tLS0tLS0tLS0tLS0tLXxcbiAqIHwgMCB8IFN1Y2Nlc3MgfCBIYW5kbGVyIHJldHVybnMgbm9ybWFsbHkgfCBDb250aW51ZSwgcGFyc2Ugc3Rkb3V0IGFzIEpTT04gfFxuICogfCAxIHwgRXJyb3IgfCBJbnZhbGlkIGlucHV0LCBub24tYmxvY2tpbmcgZXJyb3IgfCBOb24tYmxvY2tpbmcsIHN0ZGVyciB0byB1c2VyIG9ubHkgfFxuICogfCAyIHwgQmxvY2sgfCBIYW5kbGVyIHRocm93cyBPUiBgc3RvcFJlYXNvbmAgc2V0IHwgQmxvY2tpbmcsIHN0ZGVyciBzaG93biB0byBDbGF1ZGUgfFxuICovXG5leHBvcnQgY29uc3QgRVhJVF9DT0RFUyA9IHtcbiAgICAvKiogSGFuZGxlciBjb21wbGV0ZWQgc3VjY2Vzc2Z1bGx5LiBDbGF1ZGUgQ29kZSBwYXJzZXMgc3Rkb3V0IGFzIEpTT04uICovXG4gICAgU1VDQ0VTUzogMCxcbiAgICAvKiogTm9uLWJsb2NraW5nIGVycm9yIG9jY3VycmVkIChlLmcuLCBpbnZhbGlkIGlucHV0KS4gc3RkZXJyIHNob3duIHRvIHVzZXIgb25seS4gKi9cbiAgICBFUlJPUjogMSxcbiAgICAvKiogSGFuZGxlciB0aHJldyBleGNlcHRpb24gT1IgYmxvY2tpbmcgYWN0aW9uIHJlcXVlc3RlZC4gc3RkZXJyIHNob3duIHRvIENsYXVkZS4gKi9cbiAgICBCTE9DSzogMixcbn07XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBPdXRwdXQgQnVpbGRlciBGYWN0b3JpZXNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogRmFjdG9yeSBmb3IgaG9va3MgdGhhdCBoYXZlIGhvb2tTcGVjaWZpY091dHB1dCB3aXRoIGEgaG9va0V2ZW50TmFtZSBkaXNjcmltaW5hdG9yLlxuICogQHBhcmFtIGhvb2tUeXBlIC0gVGhlIGhvb2sgdHlwZSBuYW1lIHVzZWQgYXMgdGhlIF90eXBlIGRpc2NyaW1pbmF0b3JcbiAqIEByZXR1cm5zIEEgYnVpbGRlciBmdW5jdGlvbiB0aGF0IGNyZWF0ZXMgdGhlIG91dHB1dCBvYmplY3RcbiAqIEBpbnRlcm5hbFxuICovXG5mdW5jdGlvbiBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKGhvb2tUeXBlKSB7XG4gICAgcmV0dXJuIChvcHRpb25zID0ge30pID0+IHtcbiAgICAgICAgY29uc3QgeyBob29rU3BlY2lmaWNPdXRwdXQsIC4uLnJlc3QgfSA9IG9wdGlvbnM7XG4gICAgICAgIGNvbnN0IHN0ZG91dCA9IGhvb2tTcGVjaWZpY091dHB1dCAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgICA/IHsgLi4ucmVzdCwgaG9va1NwZWNpZmljT3V0cHV0OiB7IGhvb2tFdmVudE5hbWU6IGhvb2tUeXBlLCAuLi5ob29rU3BlY2lmaWNPdXRwdXQgfSB9XG4gICAgICAgICAgICA6IHJlc3Q7XG4gICAgICAgIHJldHVybiB7IF90eXBlOiBob29rVHlwZSwgc3Rkb3V0IH07XG4gICAgfTtcbn1cbi8qKlxuICogRmFjdG9yeSBmb3IgaG9va3MgdGhhdCBvbmx5IHVzZSBDb21tb25PcHRpb25zIChzaW1wbGUgcGFzc3Rocm91Z2gpLlxuICogQHBhcmFtIGhvb2tUeXBlIC0gVGhlIGhvb2sgdHlwZSBuYW1lIHVzZWQgYXMgdGhlIF90eXBlIGRpc2NyaW1pbmF0b3JcbiAqIEByZXR1cm5zIEEgYnVpbGRlciBmdW5jdGlvbiB0aGF0IGNyZWF0ZXMgdGhlIG91dHB1dCBvYmplY3RcbiAqIEBpbnRlcm5hbFxuICovXG5mdW5jdGlvbiBjcmVhdGVTaW1wbGVPdXRwdXRCdWlsZGVyKGhvb2tUeXBlKSB7XG4gICAgcmV0dXJuIChvcHRpb25zID0ge30pID0+ICh7XG4gICAgICAgIF90eXBlOiBob29rVHlwZSxcbiAgICAgICAgc3Rkb3V0OiBvcHRpb25zLFxuICAgIH0pO1xufVxuLyoqXG4gKiBGYWN0b3J5IGZvciB3b3JrdHJlZSBob29rcyAoV29ya3RyZWVDcmVhdGUsIFdvcmt0cmVlUmVtb3ZlKS5cbiAqXG4gKiBUaGVzZSBhcmUgY29tbWFuZCBob29rcyB3aG9zZSB3aXJlIHByb3RvY29sIGlzIGEgKipiYXJlIHBhdGggb24gc3Rkb3V0KiosIG5vdCBKU09OOlxuICogQ2xhdWRlIENvZGUgcmVhZHMgdGhlIGhvb2sncyBzdGRvdXQgdmVyYmF0aW0gYW5kIGBjaGRpcmBzIGludG8gaXQuIFRoZSBidWlsZGVyIGNhcnJpZXNcbiAqIHRoZSBwYXRoIGluIGByYXdTdGRvdXRgIHNvIHRoZSBydW50aW1lIGVtaXRzIGl0IGFzIHBsYWluIHRleHQgaW5zdGVhZCBvZlxuICogYEpTT04uc3RyaW5naWZ5KHN0ZG91dClgLlxuICogQHBhcmFtIGhvb2tUeXBlIC0gVGhlIGhvb2sgdHlwZSBuYW1lIHVzZWQgYXMgdGhlIF90eXBlIGRpc2NyaW1pbmF0b3JcbiAqIEByZXR1cm5zIEEgYnVpbGRlciBmdW5jdGlvbiB0aGF0IGNyZWF0ZXMgdGhlIG91dHB1dCBvYmplY3RcbiAqIEBpbnRlcm5hbFxuICovXG5mdW5jdGlvbiBjcmVhdGVXb3JrdHJlZU91dHB1dEJ1aWxkZXIoaG9va1R5cGUpIHtcbiAgICByZXR1cm4gKG9wdGlvbnMpID0+IHtcbiAgICAgICAgY29uc3QgeyB3b3JrdHJlZVBhdGgsIC4uLnJlc3QgfSA9IG9wdGlvbnM7XG4gICAgICAgIHJldHVybiB7IF90eXBlOiBob29rVHlwZSwgc3Rkb3V0OiByZXN0LCByYXdTdGRvdXQ6IHdvcmt0cmVlUGF0aCB9O1xuICAgIH07XG59XG4vKipcbiAqIEZhY3RvcnkgZm9yIGhvb2tzIHRoYXQgdXNlIGRlY2lzaW9uLWJhc2VkIG9wdGlvbnMgKFN0b3AsIFN1YmFnZW50U3RvcCkuXG4gKiBAcGFyYW0gaG9va1R5cGUgLSBUaGUgaG9vayB0eXBlIG5hbWUgdXNlZCBhcyB0aGUgX3R5cGUgZGlzY3JpbWluYXRvclxuICogQHJldHVybnMgQSBidWlsZGVyIGZ1bmN0aW9uIHRoYXQgY3JlYXRlcyB0aGUgb3V0cHV0IG9iamVjdFxuICogQGludGVybmFsXG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZURlY2lzaW9uT3V0cHV0QnVpbGRlcihob29rVHlwZSkge1xuICAgIHJldHVybiAob3B0aW9ucyA9IHt9KSA9PiAoe1xuICAgICAgICBfdHlwZTogaG9va1R5cGUsXG4gICAgICAgIHN0ZG91dDogb3B0aW9ucyxcbiAgICB9KTtcbn1cbi8qKlxuICogRmFjdG9yeSBmb3IgZXhpdC1jb2RlLWJhc2VkIGhvb2tzIChUZWFtbWF0ZUlkbGUsIFRhc2tDb21wbGV0ZWQpLlxuICpcbiAqIFRoZXNlIGhvb2tzIGRvbid0IHVzZSBKU09OIGRlY2lzaW9uIGNvbnRyb2wgKG5vIENvbW1vbk9wdGlvbnMpLlxuICogVGhlIG9ubHkgb3B0aW9uIGlzIGBzdGRlcnJgIFx1MjAxNCB3aGVuIHByZXNlbnQsIGl0IHRyaWdnZXJzIGV4aXQgY29kZSAyIChCTE9DSykuXG4gKiBTdGRvdXQgYWx3YXlzIHJlY2VpdmVzIGB7fWAgKGVtcHR5IEpTT04gb2JqZWN0KS5cbiAqIEBwYXJhbSBob29rVHlwZSAtIFRoZSBob29rIHR5cGUgbmFtZSB1c2VkIGFzIHRoZSBfdHlwZSBkaXNjcmltaW5hdG9yXG4gKiBAcmV0dXJucyBBIGJ1aWxkZXIgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIHRoZSBvdXRwdXQgb2JqZWN0XG4gKiBAaW50ZXJuYWxcbiAqL1xuZnVuY3Rpb24gY3JlYXRlRXhpdENvZGVPdXRwdXRCdWlsZGVyKGhvb2tUeXBlKSB7XG4gICAgcmV0dXJuICh7IHN0ZGVyciB9ID0ge30pID0+ICh7XG4gICAgICAgIF90eXBlOiBob29rVHlwZSxcbiAgICAgICAgc3Rkb3V0OiB7fSxcbiAgICAgICAgLi4uKHN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRlcnIgfSA6IHt9KSxcbiAgICB9KTtcbn1cbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFByZVRvb2xVc2UgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFByZVRvb2xVc2VPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEFsbG93IHRvb2wgZXhlY3V0aW9uXG4gKiBwcmVUb29sVXNlT3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7IHBlcm1pc3Npb25EZWNpc2lvbjogJ2FsbG93JyB9XG4gKiB9KTtcbiAqXG4gKiAvLyBEZW55IHdpdGggcmVhc29uXG4gKiBwcmVUb29sVXNlT3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgcGVybWlzc2lvbkRlY2lzaW9uOiAnZGVueScsXG4gKiAgICAgcGVybWlzc2lvbkRlY2lzaW9uUmVhc29uOiAnRGFuZ2Vyb3VzIGNvbW1hbmQgZGV0ZWN0ZWQnXG4gKiAgIH1cbiAqIH0pO1xuICpcbiAqIC8vIEFsbG93IHdpdGggbW9kaWZpZWQgaW5wdXRcbiAqIHByZVRvb2xVc2VPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICBwZXJtaXNzaW9uRGVjaXNpb246ICdhbGxvdycsXG4gKiAgICAgdXBkYXRlZElucHV0OiB7IGNvbW1hbmQ6ICdscyAtbGEnIH1cbiAqICAgfVxuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHByZVRvb2xVc2VPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIlByZVRvb2xVc2VcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBQb3N0VG9vbFVzZSBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgUG9zdFRvb2xVc2VPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEFkZCBjb250ZXh0IGFmdGVyIGEgZmlsZSByZWFkXG4gKiBwb3N0VG9vbFVzZU91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDoge1xuICogICAgIGFkZGl0aW9uYWxDb250ZXh0OiAnRmlsZSBjb250YWlucyBzZW5zaXRpdmUgZGF0YSdcbiAqICAgfVxuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHBvc3RUb29sVXNlT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJQb3N0VG9vbFVzZVwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFBvc3RUb29sVXNlRmFpbHVyZSBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgUG9zdFRvb2xVc2VGYWlsdXJlT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBwb3N0VG9vbFVzZUZhaWx1cmVPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICBhZGRpdGlvbmFsQ29udGV4dDogJ1RyeSB1c2luZyBhIGRpZmZlcmVudCBhcHByb2FjaCdcbiAqICAgfVxuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHBvc3RUb29sVXNlRmFpbHVyZU91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiUG9zdFRvb2xVc2VGYWlsdXJlXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgUG9zdFRvb2xCYXRjaCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgUG9zdFRvb2xCYXRjaE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogcG9zdFRvb2xCYXRjaE91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDoge1xuICogICAgIGFkZGl0aW9uYWxDb250ZXh0OiAnQWxsIGVkaXRzIGluIHRoZSBiYXRjaCB3ZXJlIGFwcGxpZWQgc3VjY2Vzc2Z1bGx5J1xuICogICB9XG4gKiB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgcG9zdFRvb2xCYXRjaE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiUG9zdFRvb2xCYXRjaFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFVzZXJQcm9tcHRFeHBhbnNpb24gaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFVzZXJQcm9tcHRFeHBhbnNpb25PdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIHVzZXJQcm9tcHRFeHBhbnNpb25PdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICBhZGRpdGlvbmFsQ29udGV4dDogJ1NsYXNoIGNvbW1hbmQgZXhwYW5kZWQgd2l0aCBhZGRpdGlvbmFsIGNvbnRleHQnXG4gKiAgIH1cbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCB1c2VyUHJvbXB0RXhwYW5zaW9uT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJVc2VyUHJvbXB0RXhwYW5zaW9uXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgVXNlclByb21wdFN1Ym1pdCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgVXNlclByb21wdFN1Ym1pdE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogdXNlclByb21wdFN1Ym1pdE91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDoge1xuICogICAgIGFkZGl0aW9uYWxDb250ZXh0OiAnVGhpcyBwcm9qZWN0IHVzZXMgVHlwZVNjcmlwdCBzdHJpY3QgbW9kZSdcbiAqICAgfVxuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHVzZXJQcm9tcHRTdWJtaXRPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIlVzZXJQcm9tcHRTdWJtaXRcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBTZXNzaW9uU3RhcnQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFNlc3Npb25TdGFydE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogc2Vzc2lvblN0YXJ0T3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgYWRkaXRpb25hbENvbnRleHQ6IEpTT04uc3RyaW5naWZ5KHsgcHJvamVjdDogJ215LXByb2plY3QnIH0pXG4gKiAgIH1cbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBzZXNzaW9uU3RhcnRPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIlNlc3Npb25TdGFydFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFNlc3Npb25FbmQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFNlc3Npb25FbmRPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIHNlc3Npb25FbmRPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBzZXNzaW9uRW5kT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZVNpbXBsZU91dHB1dEJ1aWxkZXIoXCJTZXNzaW9uRW5kXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgU3RvcCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgU3RvcE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQWxsb3cgdGhlIHN0b3BcbiAqIHN0b3BPdXRwdXQoeyBkZWNpc2lvbjogJ2FwcHJvdmUnIH0pO1xuICpcbiAqIC8vIEJsb2NrIHdpdGggcmVhc29uXG4gKiBzdG9wT3V0cHV0KHtcbiAqICAgZGVjaXNpb246ICdibG9jaycsXG4gKiAgIHJlYXNvbjogJ1RoZXJlIGFyZSB1bmNvbW1pdHRlZCBjaGFuZ2VzJ1xuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHN0b3BPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlRGVjaXNpb25PdXRwdXRCdWlsZGVyKFwiU3RvcFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFN0b3BGYWlsdXJlIGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBTdG9wRmFpbHVyZU91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogc3RvcEZhaWx1cmVPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBzdG9wRmFpbHVyZU91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVTaW1wbGVPdXRwdXRCdWlsZGVyKFwiU3RvcEZhaWx1cmVcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBTdWJhZ2VudFN0YXJ0IGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBTdWJhZ2VudFN0YXJ0T3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBzdWJhZ2VudFN0YXJ0T3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgYWRkaXRpb25hbENvbnRleHQ6ICdGb2N1cyBvbiBmaW5kaW5nIHBhdHRlcm5zJ1xuICogICB9XG4gKiB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3Qgc3ViYWdlbnRTdGFydE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiU3ViYWdlbnRTdGFydFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFN1YmFnZW50U3RvcCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgU3ViYWdlbnRTdG9wT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBCbG9jayB3aXRoIHJlYXNvblxuICogc3ViYWdlbnRTdG9wT3V0cHV0KHtcbiAqICAgZGVjaXNpb246ICdibG9jaycsXG4gKiAgIHJlYXNvbjogJ1Rhc2sgbm90IGNvbXBsZXRlJ1xuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHN1YmFnZW50U3RvcE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVEZWNpc2lvbk91dHB1dEJ1aWxkZXIoXCJTdWJhZ2VudFN0b3BcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBOb3RpZmljYXRpb24gaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIE5vdGlmaWNhdGlvbk91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQWRkIGNvbnRleHQgYWJvdXQgdGhlIG5vdGlmaWNhdGlvblxuICogbm90aWZpY2F0aW9uT3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgYWRkaXRpb25hbENvbnRleHQ6ICdOb3RpZmljYXRpb24gZm9yd2FyZGVkIHRvIFNsYWNrICNhbGVydHMgY2hhbm5lbCdcbiAqICAgfVxuICogfSk7XG4gKlxuICogLy8gU3VwcHJlc3MgdGhlIG5vdGlmaWNhdGlvblxuICogbm90aWZpY2F0aW9uT3V0cHV0KHsgc3VwcHJlc3NPdXRwdXQ6IHRydWUgfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IG5vdGlmaWNhdGlvbk91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiTm90aWZpY2F0aW9uXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgUHJlQ29tcGFjdCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgUHJlQ29tcGFjdE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogcHJlQ29tcGFjdE91dHB1dCh7XG4gKiAgIHN5c3RlbU1lc3NhZ2U6ICdSZW1lbWJlcjogc3RyaWN0IG1vZGUgaXMgZW5hYmxlZCdcbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBwcmVDb21wYWN0T3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZVNpbXBsZU91dHB1dEJ1aWxkZXIoXCJQcmVDb21wYWN0XCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgUG9zdENvbXBhY3QgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFBvc3RDb21wYWN0T3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBwb3N0Q29tcGFjdE91dHB1dCh7fSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHBvc3RDb21wYWN0T3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZVNpbXBsZU91dHB1dEJ1aWxkZXIoXCJQb3N0Q29tcGFjdFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFBlcm1pc3Npb25SZXF1ZXN0IGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBQZXJtaXNzaW9uUmVxdWVzdE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQXV0by1hcHByb3ZlXG4gKiBwZXJtaXNzaW9uUmVxdWVzdE91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDoge1xuICogICAgIGRlY2lzaW9uOiB7IGJlaGF2aW9yOiAnYWxsb3cnIH1cbiAqICAgfVxuICogfSk7XG4gKlxuICogLy8gQXV0by1hcHByb3ZlIHdpdGggbW9kaWZpZWQgaW5wdXRcbiAqIHBlcm1pc3Npb25SZXF1ZXN0T3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgZGVjaXNpb246IHtcbiAqICAgICAgIGJlaGF2aW9yOiAnYWxsb3cnLFxuICogICAgICAgdXBkYXRlZElucHV0OiB7IGZpbGVfcGF0aDogJy9zYWZlL3BhdGgnIH1cbiAqICAgICB9XG4gKiAgIH1cbiAqIH0pO1xuICpcbiAqIC8vIEF1dG8tZGVueVxuICogcGVybWlzc2lvblJlcXVlc3RPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICBkZWNpc2lvbjoge1xuICogICAgICAgYmVoYXZpb3I6ICdkZW55JyxcbiAqICAgICAgIG1lc3NhZ2U6ICdOb3QgYWxsb3dlZCcsXG4gKiAgICAgICBpbnRlcnJ1cHQ6IHRydWVcbiAqICAgICB9XG4gKiAgIH1cbiAqIH0pO1xuICpcbiAqIC8vIEZhbGwgdGhyb3VnaCB0byBub3JtYWwgcHJvbXB0XG4gKiBwZXJtaXNzaW9uUmVxdWVzdE91dHB1dCh7fSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHBlcm1pc3Npb25SZXF1ZXN0T3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJQZXJtaXNzaW9uUmVxdWVzdFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFBlcm1pc3Npb25EZW5pZWQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFBlcm1pc3Npb25EZW5pZWRPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIExvZyBhbmQgYWxsb3cgcmV0cnlcbiAqIHBlcm1pc3Npb25EZW5pZWRPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHsgcmV0cnk6IHRydWUgfVxuICogfSk7XG4gKlxuICogLy8gTG9nIHdpdGhvdXQgcmV0cnlcbiAqIHBlcm1pc3Npb25EZW5pZWRPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBwZXJtaXNzaW9uRGVuaWVkT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJQZXJtaXNzaW9uRGVuaWVkXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgU2V0dXAgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFNldHVwT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBBZGQgY29udGV4dCBkdXJpbmcgc2V0dXBcbiAqIHNldHVwT3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgYWRkaXRpb25hbENvbnRleHQ6ICdQcm9qZWN0IGluaXRpYWxpemVkIHdpdGggY3VzdG9tIHNldHRpbmdzJ1xuICogICB9XG4gKiB9KTtcbiAqXG4gKiAvLyBTaW1wbGUgcGFzc3Rocm91Z2hcbiAqIHNldHVwT3V0cHV0KHt9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3Qgc2V0dXBPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIlNldHVwXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgVGVhbW1hdGVJZGxlIGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBUZWFtbWF0ZUlkbGVPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEFsbG93IHRlYW1tYXRlIHRvIGdvIGlkbGVcbiAqIHRlYW1tYXRlSWRsZU91dHB1dCh7fSk7XG4gKlxuICogLy8gQmxvY2sgd2l0aCBmZWVkYmFja1xuICogdGVhbW1hdGVJZGxlT3V0cHV0KHsgc3RkZXJyOiAnQ29udGludWUgd29ya2luZzogdW5maW5pc2hlZCB0YXNrcyByZW1haW4uJyB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgdGVhbW1hdGVJZGxlT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUV4aXRDb2RlT3V0cHV0QnVpbGRlcihcIlRlYW1tYXRlSWRsZVwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFRhc2tDcmVhdGVkIGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBUYXNrQ3JlYXRlZE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQWxsb3cgdGFzayBjcmVhdGlvblxuICogdGFza0NyZWF0ZWRPdXRwdXQoe30pO1xuICpcbiAqIC8vIEJsb2NrIHdpdGggZmVlZGJhY2tcbiAqIHRhc2tDcmVhdGVkT3V0cHV0KHsgc3RkZXJyOiAnQ2Fubm90IGNyZWF0ZSB0YXNrOiBtaXNzaW5nIHJlcXVpcmVkIGZpZWxkcy4nIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCB0YXNrQ3JlYXRlZE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVFeGl0Q29kZU91dHB1dEJ1aWxkZXIoXCJUYXNrQ3JlYXRlZFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFRhc2tDb21wbGV0ZWQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFRhc2tDb21wbGV0ZWRPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEFsbG93IHRhc2sgY29tcGxldGlvblxuICogdGFza0NvbXBsZXRlZE91dHB1dCh7fSk7XG4gKlxuICogLy8gQmxvY2sgd2l0aCBmZWVkYmFja1xuICogdGFza0NvbXBsZXRlZE91dHB1dCh7IHN0ZGVycjogJ0Nhbm5vdCBjb21wbGV0ZTogdGVzdHMgYXJlIGZhaWxpbmcuJyB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgdGFza0NvbXBsZXRlZE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVFeGl0Q29kZU91dHB1dEJ1aWxkZXIoXCJUYXNrQ29tcGxldGVkXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgRWxpY2l0YXRpb24gaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBbiBFbGljaXRhdGlvbk91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQWNjZXB0IHRoZSBlbGljaXRhdGlvblxuICogZWxpY2l0YXRpb25PdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHsgYWN0aW9uOiAnYWNjZXB0JywgY29udGVudDogeyB1c2VybmFtZTogJ2FsaWNlJyB9IH1cbiAqIH0pO1xuICpcbiAqIC8vIERlY2xpbmUgdGhlIGVsaWNpdGF0aW9uXG4gKiBlbGljaXRhdGlvbk91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDogeyBhY3Rpb246ICdkZWNsaW5lJyB9XG4gKiB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgZWxpY2l0YXRpb25PdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIkVsaWNpdGF0aW9uXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgRWxpY2l0YXRpb25SZXN1bHQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBbiBFbGljaXRhdGlvblJlc3VsdE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogZWxpY2l0YXRpb25SZXN1bHRPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBlbGljaXRhdGlvblJlc3VsdE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiRWxpY2l0YXRpb25SZXN1bHRcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBDb25maWdDaGFuZ2UgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIENvbmZpZ0NoYW5nZU91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogY29uZmlnQ2hhbmdlT3V0cHV0KHt9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgY29uZmlnQ2hhbmdlT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZVNpbXBsZU91dHB1dEJ1aWxkZXIoXCJDb25maWdDaGFuZ2VcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBJbnN0cnVjdGlvbnNMb2FkZWQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBbiBJbnN0cnVjdGlvbnNMb2FkZWRPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGluc3RydWN0aW9uc0xvYWRlZE91dHB1dCh7fSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IGluc3RydWN0aW9uc0xvYWRlZE91dHB1dCA9IFxuLyogQF9fUFVSRV9fICovIGNyZWF0ZVNpbXBsZU91dHB1dEJ1aWxkZXIoXCJJbnN0cnVjdGlvbnNMb2FkZWRcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBXb3JrdHJlZUNyZWF0ZSBob29rcy5cbiAqXG4gKiBUaGUgcnVudGltZSB3cml0ZXMgYHdvcmt0cmVlUGF0aGAgdG8gc3Rkb3V0IGFzIHBsYWluIHRleHQgKG5vdCBKU09OKSBzbyBDbGF1ZGUgQ29kZVxuICogY2FuIGBjaGRpcmAgaW50byB0aGUgY3JlYXRlZCB3b3JrdHJlZS5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgV29ya3RyZWVDcmVhdGVPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIHdvcmt0cmVlQ3JlYXRlT3V0cHV0KHsgd29ya3RyZWVQYXRoOiAnL2Ficy9wYXRoL3RvL3dvcmt0cmVlJyB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3Qgd29ya3RyZWVDcmVhdGVPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlV29ya3RyZWVPdXRwdXRCdWlsZGVyKFwiV29ya3RyZWVDcmVhdGVcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBXb3JrdHJlZVJlbW92ZSBob29rcy5cbiAqXG4gKiBXaGVuIGB3b3JrdHJlZVBhdGhgIGlzIHN1cHBsaWVkLCB0aGUgcnVudGltZSB3cml0ZXMgaXQgdG8gc3Rkb3V0IGFzIHBsYWluIHRleHQgKG5vdFxuICogSlNPTiksIG1hdGNoaW5nIHRoZSB3b3JrdHJlZSBjb21tYW5kLWhvb2sgcHJvdG9jb2wuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFdvcmt0cmVlUmVtb3ZlT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBQbGFpbi10ZXh0IHBhdGggcHJvdG9jb2xcbiAqIHdvcmt0cmVlUmVtb3ZlT3V0cHV0KHsgd29ya3RyZWVQYXRoOiAnL2Ficy9wYXRoL3RvL3dvcmt0cmVlJyB9KTtcbiAqXG4gKiAvLyBObyBwYXRoIHBheWxvYWRcbiAqIHdvcmt0cmVlUmVtb3ZlT3V0cHV0KHt9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3Qgd29ya3RyZWVSZW1vdmVPdXRwdXQgPSAob3B0aW9ucyA9IHt9KSA9PiB7XG4gICAgY29uc3QgeyB3b3JrdHJlZVBhdGgsIC4uLnJlc3QgfSA9IG9wdGlvbnM7XG4gICAgcmV0dXJuIHdvcmt0cmVlUGF0aCAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8geyBfdHlwZTogXCJXb3JrdHJlZVJlbW92ZVwiLCBzdGRvdXQ6IHJlc3QsIHJhd1N0ZG91dDogd29ya3RyZWVQYXRoIH1cbiAgICAgICAgOiB7IF90eXBlOiBcIldvcmt0cmVlUmVtb3ZlXCIsIHN0ZG91dDogcmVzdCB9O1xufTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIEN3ZENoYW5nZWQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIEN3ZENoYW5nZWRPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIFJldHVybiBhZGRpdGlvbmFsIHBhdGhzIHRvIHdhdGNoIGFmdGVyIHRoZSBjd2QgY2hhbmdlXG4gKiBjd2RDaGFuZ2VkT3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgd2F0Y2hQYXRoczogWycvbmV3L3BhdGgvdG8vd2F0Y2gnXVxuICogICB9XG4gKiB9KTtcbiAqXG4gKiAvLyBTaW1wbGUgcGFzc3Rocm91Z2hcbiAqIGN3ZENoYW5nZWRPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBjd2RDaGFuZ2VkT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJDd2RDaGFuZ2VkXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgRmlsZUNoYW5nZWQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIEZpbGVDaGFuZ2VkT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBVcGRhdGUgdGhlIHNldCBvZiB3YXRjaGVkIHBhdGhzXG4gKiBmaWxlQ2hhbmdlZE91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDoge1xuICogICAgIHdhdGNoUGF0aHM6IFsnL3BhdGgvdG8vd2F0Y2gnLCAnL2Fub3RoZXIvcGF0aCddXG4gKiAgIH1cbiAqIH0pO1xuICpcbiAqIC8vIFNpbXBsZSBwYXNzdGhyb3VnaFxuICogZmlsZUNoYW5nZWRPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBmaWxlQ2hhbmdlZE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiRmlsZUNoYW5nZWRcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBNZXNzYWdlRGlzcGxheSBob29rcy5cbiAqXG4gKiBNZXNzYWdlRGlzcGxheSBpcyBkaXNwbGF5LW9ubHk6IHRoZSBgZGlzcGxheUNvbnRlbnRgIGZpZWxkIHJlcGxhY2VzIHRoZSBkZWx0YSBvblxuICogc2NyZWVuIHdpdGhvdXQgY2hhbmdpbmcgdGhlIHN0b3JlZCBtZXNzYWdlIG9yIHdoYXQgdGhlIG1vZGVsIHNlZXMuIE9taXRcbiAqIGBkaXNwbGF5Q29udGVudGAgKG9yIHNldCBpdCB0byB0aGUgb3JpZ2luYWwgZGVsdGEpIHRvIGxlYXZlIHRoZSBkaXNwbGF5IHVuY2hhbmdlZC5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgTWVzc2FnZURpc3BsYXlPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIFJlcGxhY2UgdGhlIGRlbHRhIHNob3duIG9uIHNjcmVlblxuICogbWVzc2FnZURpc3BsYXlPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHsgZGlzcGxheUNvbnRlbnQ6IFwiW3JlZGFjdGVkXVwiIH1cbiAqIH0pO1xuICpcbiAqIC8vIFBhc3N0aHJvdWdoIChubyBkaXNwbGF5IG1vZGlmaWNhdGlvbilcbiAqIG1lc3NhZ2VEaXNwbGF5T3V0cHV0KHt9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgbWVzc2FnZURpc3BsYXlPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIk1lc3NhZ2VEaXNwbGF5XCIpO1xuIiwgIi8qKlxuICogUnVudGltZSBtb2R1bGUgZm9yIENsYXVkZSBDb2RlIGhvb2tzLlxuICpcbiAqIEhhbmRsZXMgc3RkaW4vc3Rkb3V0L2V4aXQgY29kZSBzZW1hbnRpY3MgZm9yIGNvbXBpbGVkIGhvb2sgZXhlY3V0aW9uLlxuICogVGhpcyBtb2R1bGUgaXMgdGhlIGNvcmUgb3JjaGVzdHJhdG9yIHRoYXQ6XG4gKiAtIFJlYWRzIEpTT04gZnJvbSBzdGRpbiAod2lyZSBmb3JtYXQgd2l0aCBzbmFrZV9jYXNlIHByb3BlcnRpZXMpXG4gKiAtIEludm9rZXMgdGhlIGhvb2sgaGFuZGxlclxuICogLSBXcml0ZXMgb3V0cHV0IHRvIHN0ZG91dFxuICogLSBNYW5hZ2VzIGV4aXQgY29kZXNcbiAqIEBtb2R1bGVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBJbiBhIGNvbXBpbGVkIGhvb2sgZmlsZVxuICogaW1wb3J0IHsgZXhlY3V0ZSB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcy9ydW50aW1lJztcbiAqIGltcG9ydCBteUhvb2sgZnJvbSAnLi9teS1ob29rLmpzJztcbiAqXG4gKiBleGVjdXRlKG15SG9vayk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rc1xuICovXG5pbXBvcnQgeyBwZXJzaXN0RW52VmFyLCBwZXJzaXN0RW52VmFycyB9IGZyb20gXCIuL2Vudi5qc1wiO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSBcIi4vbG9nZ2VyLmpzXCI7XG5pbXBvcnQgeyBFWElUX0NPREVTIH0gZnJvbSBcIi4vb3V0cHV0cy5qc1wiO1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU3RkaW4vU3Rkb3V0IEhhbmRsaW5nXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIFJlYWRzIGFsbCBkYXRhIGZyb20gc3RkaW4uXG4gKiBAcmV0dXJucyBQcm9taXNlIHJlc29sdmluZyB0byB0aGUgY29tcGxldGUgc3RkaW4gY29udGVudFxuICovXG5hc3luYyBmdW5jdGlvbiByZWFkU3RkaW4oKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgY2h1bmtzID0gW107XG4gICAgICAgIC8vIFNldCBlbmNvZGluZyBmaXJzdCB0byBlbnN1cmUgZGF0YSBldmVudHMgcmVjZWl2ZSBzdHJpbmdzXG4gICAgICAgIHByb2Nlc3Muc3RkaW4uc2V0RW5jb2RpbmcoXCJ1dGYtOFwiKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImRhdGFcIiwgKGNodW5rKSA9PiB7XG4gICAgICAgICAgICBjaHVua3MucHVzaChjaHVuayk7XG4gICAgICAgIH0pO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZW5kXCIsICgpID0+IHtcbiAgICAgICAgICAgIHJlc29sdmUoY2h1bmtzLmpvaW4oXCJcIikpO1xuICAgICAgICB9KTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgICAgICAgcmVqZWN0KGVycm9yKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG59XG4vKipcbiAqIFBhcnNlcyBzdGRpbiBKU09OIGlucHV0LlxuICogQHBhcmFtIHN0ZGluQ29udGVudCAtIFJhdyBzdGRpbiBjb250ZW50XG4gKiBAcmV0dXJucyBQYXJzZWQgaW5wdXQgKHdpcmUgZm9ybWF0IHdpdGggc25ha2VfY2FzZSBwcm9wZXJ0aWVzKVxuICogQHRocm93cyBFcnJvciBpZiBKU09OIGlzIG1hbGZvcm1lZFxuICovXG5mdW5jdGlvbiBwYXJzZVN0ZGluSW5wdXQoc3RkaW5Db250ZW50KSB7XG4gICAgLy8gUGFyc2UgSlNPTiAtIGlucHV0IHVzZXMgd2lyZSBmb3JtYXQgKHNuYWtlX2Nhc2UpIGRpcmVjdGx5XG4gICAgY29uc3QgcmF3SW5wdXQgPSBKU09OLnBhcnNlKHN0ZGluQ29udGVudCk7XG4gICAgcmV0dXJuIHJhd0lucHV0O1xufVxuLyoqXG4gKiBXcml0ZXMgaG9vayBvdXRwdXQgdG8gc3Rkb3V0LlxuICpcbiAqIE91dHB1dCB1c2VzIGNhbWVsQ2FzZSBrZXlzIHBlciBDbGF1ZGUgQ29kZSBob29rIHNwZWNpZmljYXRpb24uXG4gKiBAcGFyYW0gb3V0cHV0IC0gVGhlIGhvb2sgb3V0cHV0IHRvIHdyaXRlXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjaG9vay1vdXRwdXQtc3RydWN0dXJlXG4gKi9cbmZ1bmN0aW9uIHdyaXRlU3Rkb3V0KG91dHB1dCkge1xuICAgIC8vIE91dHB1dCB1c2VzIGNhbWVsQ2FzZSAtIG5vIHRyYW5zZm9ybWF0aW9uIG5lZWRlZFxuICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKEpTT04uc3RyaW5naWZ5KG91dHB1dCkpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRXJyb3IgSGFuZGxpbmdcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhbiBlcnJvciBvdXRwdXQgZm9yIG1hbGZvcm1lZCBzdGRpbiBKU09OLlxuICogQHBhcmFtIGVycm9yIC0gVGhlIHBhcnNlIGVycm9yXG4gKiBAcmV0dXJucyBIb29rT3V0cHV0IHdpdGggZW1wdHkgc3Rkb3V0XG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZU1hbGZvcm1lZElucHV0T3V0cHV0KGVycm9yKSB7XG4gICAgbG9nZ2VyLmVycm9yKGBJbnZhbGlkIEpTT04gaW5wdXQ6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApO1xuICAgIHJldHVybiB7IHN0ZG91dDoge30gfTtcbn1cbi8qKlxuICogV3JpdGVzIGhhbmRsZXIgZXJyb3Igc3RhY2t0cmFjZSB0byBzdGRlcnIgYW5kIGV4aXRzIHdpdGggY29kZSAyLlxuICpcbiAqIFdoZW4gYSBob29rIGhhbmRsZXIgdGhyb3dzIGFuIGV4Y2VwdGlvbjpcbiAqIC0gU3RhY2t0cmFjZSAod2l0aCBzb3VyY2VtYXBzIGlmIGF2YWlsYWJsZSkgaXMgb3V0cHV0IHRvIHN0ZGVyclxuICogLSBQcm9jZXNzIGV4aXRzIHdpdGggY29kZSAyIChCTE9DSylcbiAqIC0gTm8gSlNPTiBpcyBvdXRwdXQgdG8gc3Rkb3V0XG4gKiBAcGFyYW0gZXJyb3IgLSBUaGUgZXJyb3IgdGhyb3duIGJ5IHRoZSBoYW5kbGVyXG4gKi9cbmZ1bmN0aW9uIGhhbmRsZUhhbmRsZXJFcnJvcihlcnJvcikge1xuICAgIC8vIFdyaXRlIHN0YWNrIHRyYWNlIHRvIHN0ZGVyciAoc291cmNlbWFwcyBhcmUgYXBwbGllZCBhdXRvbWF0aWNhbGx5IGJ5IE5vZGUuanMpXG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYCR7ZXJyb3Iuc3RhY2sgPz8gZXJyb3IubWVzc2FnZX1cXG5gKTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke1N0cmluZyhlcnJvcil9XFxuYCk7XG4gICAgfVxuICAgIC8vIExvZyB0byBmaWxlIGlmIGNvbmZpZ3VyZWRcbiAgICBsb2dnZXIuZXJyb3IoYEhvb2sgaGFuZGxlciBlcnJvcjogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gICAgLy8gQ2xlYXIgbG9nZ2VyIGNvbnRleHQgYW5kIGNsb3NlXG4gICAgbG9nZ2VyLmNsZWFyQ29udGV4dCgpO1xuICAgIGxvZ2dlci5jbG9zZSgpO1xuICAgIC8vIEV4aXQgd2l0aCBjb2RlIDIgKEJMT0NLKSAtIG5vIEpTT04gb3V0cHV0XG4gICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuQkxPQ0spO1xufVxuLyoqXG4gKiBDb252ZXJ0cyBhIFNwZWNpZmljSG9va091dHB1dCB0byBIb29rT3V0cHV0IGZvciB3aXJlIGZvcm1hdC5cbiAqXG4gKiBTcGVjaWZpY0hvb2tPdXRwdXQgdHlwZXMgaGF2ZTogeyBfdHlwZSwgc3Rkb3V0LCBzdGRlcnI/IH1cbiAqIEhvb2tPdXRwdXQgaGFzOiB7IHN0ZG91dCwgc3RkZXJyPyB9XG4gKlxuICogU2luY2Ugb3V0cHV0IGJ1aWxkZXJzIG5vdyBwcm9kdWNlIHdpcmUtZm9ybWF0IGRpcmVjdGx5LCB0aGlzIGZ1bmN0aW9uXG4gKiBzaW1wbHkgc3RyaXBzIHRoZSBgX3R5cGVgIGRpc2NyaW1pbmF0b3IgZmllbGQuXG4gKiBAcGFyYW0gc3BlY2lmaWNPdXRwdXQgLSBUaGUgc3BlY2lmaWMgb3V0cHV0IGZyb20gYSBob29rIGhhbmRsZXJcbiAqIEByZXR1cm5zIEhvb2tPdXRwdXQgcmVhZHkgZm9yIHNlcmlhbGl6YXRpb25cbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNob29rLW91dHB1dC1zdHJ1Y3R1cmVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCBzcGVjaWZpY091dHB1dCA9IHByZVRvb2xVc2VPdXRwdXQoeyBob29rU3BlY2lmaWNPdXRwdXQ6IHsgcGVybWlzc2lvbkRlY2lzaW9uOiAnYWxsb3cnIH0gfSk7XG4gKiBjb25zdCBob29rT3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChzcGVjaWZpY091dHB1dCk7XG4gKiAvLyBob29rT3V0cHV0OiB7IHN0ZG91dDogeyBob29rU3BlY2lmaWNPdXRwdXQ6IHsgLi4uIH0gfSB9XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbnZlcnRUb0hvb2tPdXRwdXQoc3BlY2lmaWNPdXRwdXQpIHtcbiAgICBjb25zdCB7IHN0ZG91dCwgc3RkZXJyLCByYXdTdGRvdXQgfSA9IHNwZWNpZmljT3V0cHV0O1xuICAgIGNvbnN0IHJlc3VsdCA9IHsgc3Rkb3V0IH07XG4gICAgaWYgKHN0ZGVyciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJlc3VsdC5zdGRlcnIgPSBzdGRlcnI7XG4gICAgfVxuICAgIGlmIChyYXdTdGRvdXQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXN1bHQucmF3U3Rkb3V0ID0gcmF3U3Rkb3V0O1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRXhlY3V0ZSBGdW5jdGlvblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBFeGVjdXRlcyBhIGhvb2sgaGFuZGxlciB3aXRoIGZ1bGwgcnVudGltZSBvcmNoZXN0cmF0aW9uLlxuICpcbiAqIFRoaXMgaXMgdGhlIG1haW4gZW50cnkgcG9pbnQgdGhhdCBjb21waWxlZCBob29rcyB1c2UuIFdoZW4gYSBjb21waWxlZCBob29rXG4gKiBydW5zIGFzIGEgQ0xJOlxuICpcbiAqIDEuIFJlYWRzIGFsbCBzdGRpblxuICogMi4gUGFyc2VzIEpTT04gKHdpcmUgZm9ybWF0IHdpdGggc25ha2VfY2FzZSBwcm9wZXJ0aWVzKVxuICogMy4gU2V0cyB1cCBsb2dnZXIgY29udGV4dCAoaG9va1R5cGUsIGlucHV0KVxuICogNC4gQ2FsbHMgaGFuZGxlciB3aXRoIGlucHV0IGFuZCBjb250ZXh0IChsb2dnZXIpXG4gKiA1LiBIYW5kbGVzIGFueSBlcnJvcnMsIGxvZ3MgdGhlbVxuICogNi4gV3JpdGVzIEpTT04gdG8gc3Rkb3V0XG4gKiA3LiBDbG9zZXMgbG9nZ2VyXG4gKiA4LiBFeGl0cyB3aXRoIGFwcHJvcHJpYXRlIGNvZGVcbiAqIEBwYXJhbSBob29rRm4gLSBUaGUgaG9vayBmdW5jdGlvbiB0byBleGVjdXRlIChmcm9tIGhvb2sgZmFjdG9yeSlcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBJbiBjb21waWxlZCBob29rIGZpbGVcbiAqIGltcG9ydCB7IGV4ZWN1dGUgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MvcnVudGltZSc7XG4gKiBpbXBvcnQgeyBwcmVUb29sVXNlSG9vaywgcHJlVG9vbFVzZU91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogY29uc3QgbXlIb29rID0gcHJlVG9vbFVzZUhvb2soeyBtYXRjaGVyOiAnQmFzaCcgfSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdQcm9jZXNzaW5nIEJhc2ggY29tbWFuZCcpO1xuICogICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7IGFsbG93OiB0cnVlIH0pO1xuICogfSk7XG4gKlxuICogZXhlY3V0ZShteUhvb2spO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3NcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGV4ZWN1dGUoaG9va0ZuKSB7XG4gICAgbGV0IG91dHB1dDtcbiAgICB0cnkge1xuICAgICAgICAvLyBSZWFkIGFuZCBwYXJzZSBzdGRpblxuICAgICAgICBsZXQgc3RkaW5Db250ZW50O1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgc3RkaW5Db250ZW50ID0gYXdhaXQgcmVhZFN0ZGluKCk7XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBsb2dnZXIubG9nRXJyb3IoZXJyb3IsIFwiRmFpbGVkIHRvIHJlYWQgc3RkaW5cIik7XG4gICAgICAgICAgICBvdXRwdXQgPSBjcmVhdGVNYWxmb3JtZWRJbnB1dE91dHB1dChlcnJvcik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgLy8gUGFyc2UgYW5kIHRyYW5zZm9ybSBpbnB1dFxuICAgICAgICBsZXQgaW5wdXQ7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBpbnB1dCA9IHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgbG9nZ2VyLmxvZ0Vycm9yKGVycm9yLCBcIkZhaWxlZCB0byBwYXJzZSBzdGRpbiBKU09OXCIpO1xuICAgICAgICAgICAgb3V0cHV0ID0gY3JlYXRlTWFsZm9ybWVkSW5wdXRPdXRwdXQoZXJyb3IpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIC8vIFNldCBsb2dnZXIgY29udGV4dFxuICAgICAgICBjb25zdCBob29rRXZlbnROYW1lID0gaG9va0ZuLmhvb2tFdmVudE5hbWU7XG4gICAgICAgIGxvZ2dlci5zZXRDb250ZXh0KGhvb2tFdmVudE5hbWUsIGlucHV0KTtcbiAgICAgICAgLy8gQnVpbGQgY29udGV4dCAtIFNlc3Npb25TdGFydCBob29rcyBnZXQgZXh0ZW5kZWQgY29udGV4dCB3aXRoIHBlcnNpc3RFbnZWYXJcbiAgICAgICAgY29uc3QgY29udGV4dCA9IGhvb2tFdmVudE5hbWUgPT09IFwiU2Vzc2lvblN0YXJ0XCIgPyB7IGxvZ2dlciwgcGVyc2lzdEVudlZhciwgcGVyc2lzdEVudlZhcnMgfSA6IHsgbG9nZ2VyIH07XG4gICAgICAgIC8vIEV4ZWN1dGUgaGFuZGxlclxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3Qgc3BlY2lmaWNPdXRwdXQgPSBhd2FpdCBob29rRm4oaW5wdXQsIGNvbnRleHQpO1xuICAgICAgICAgICAgaWYgKHNwZWNpZmljT3V0cHV0ICE9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgb3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChzcGVjaWZpY091dHB1dCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAvLyBIYW5kbGVyIHRocmV3IC0gb3V0cHV0IHN0YWNrdHJhY2UgdG8gc3RkZXJyIGFuZCBleGl0IHdpdGggY29kZSAyXG4gICAgICAgICAgICAvLyBUaGlzIGNhbGwgbmV2ZXIgcmV0dXJucyAocHJvY2Vzcy5leGl0KVxuICAgICAgICAgICAgaGFuZGxlSGFuZGxlckVycm9yKGVycm9yKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBmaW5hbGx5IHtcbiAgICAgICAgLy8gV3JpdGUgb3V0cHV0IGlmIHdlIGhhdmUgaXQuIENvbW1hbmQgaG9va3Mgd2l0aCBhIHBsYWluLXRleHQgcHJvdG9jb2wgKGUuZy5cbiAgICAgICAgLy8gV29ya3RyZWVDcmVhdGUsIHdoZXJlIENsYXVkZSBDb2RlIHJlYWRzIHN0ZG91dCBhcyB0aGUgd29ya3RyZWUgcGF0aCBhbmQgY2hkaXJzXG4gICAgICAgIC8vIGludG8gaXQpIGNhcnJ5IHRoZWlyIHBheWxvYWQgaW4gYHJhd1N0ZG91dGAgYW5kIGJ5cGFzcyBKU09OIHNlcmlhbGl6YXRpb24uXG4gICAgICAgIGlmIChvdXRwdXQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgaWYgKG91dHB1dC5yYXdTdGRvdXQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKG91dHB1dC5yYXdTdGRvdXQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgd3JpdGVTdGRvdXQob3V0cHV0LnN0ZG91dCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgLy8gQ2xlYW4gdXAgbG9nZ2VyIChzaW5nbGUgY2xlYW51cCBwYXRoKVxuICAgICAgICBsb2dnZXIuY2xlYXJDb250ZXh0KCk7XG4gICAgICAgIGxvZ2dlci5jbG9zZSgpO1xuICAgICAgICAvLyBFeGl0LWNvZGUgQkxPQ0s6IHVubGlrZSBoYW5kbGVyIHRocm93IChubyBzdGRvdXQpLCB0aGlzIHBhdGggc3RpbGwgd3JpdGVzXG4gICAgICAgIC8vIHN0cnVjdHVyZWQgSlNPTiB0byBzdGRvdXQgKGFzIGVtcHR5IHt9KSBhbG9uZ3NpZGUgdGhlIHN0ZGVyciBtZXNzYWdlLlxuICAgICAgICAvLyBUaGUgY2FsbGVyIGNvbnRyb2xzIHN0ZGVyciBmb3JtYXR0aW5nIChubyBhcHBlbmRlZCBuZXdsaW5lKS5cbiAgICAgICAgaWYgKG91dHB1dD8uc3RkZXJyICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKG91dHB1dC5zdGRlcnIpO1xuICAgICAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuQkxPQ0spO1xuICAgICAgICB9XG4gICAgICAgIC8vIEV4aXQgd2l0aCBzdWNjZXNzIChoYW5kbGVyIGVycm9ycyBleGl0IHZpYSBoYW5kbGVIYW5kbGVyRXJyb3Igd2l0aCBjb2RlIDIpXG4gICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLlNVQ0NFU1MpO1xuICAgIH1cbn1cbiIsICIvKipcbiAqIFNoYXJlZCBoZWxwZXJzIHVzZWQgYnkgbXVsdGlwbGUgYWdlbnQtaG9va3MgZW50cnkgcG9pbnRzLlxuICpcbiAqIEV4dHJhY3RlZCBmcm9tIHByZS10b29sLXVzZS50cyBzbyB0aGF0IHRoZSB1cGNvbWluZyBTdG9wIGhvb2sgKGFuZCBhbnlcbiAqIGZ1dHVyZSBob29rcykgY2FuIGltcG9ydCBwYXRoIHV0aWxpdGllcywgcmFuZ2UgaGVscGVycywgYW5kIHRoZVxuICogc2FuaXRpemVTZXNzaW9uSWQvZm9ybWF0QW5jaG9yIGZ1bmN0aW9ucyB3aXRob3V0IGRlcGVuZGluZyBvbiB0aGVcbiAqIFByZVRvb2xVc2Utc3BlY2lmaWMgbW9kdWxlLlxuICovXG5cbmltcG9ydCB7IGV4ZWNGaWxlU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG9zIGZyb20gJ25vZGU6b3MnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQYXRoIGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgZnVuY3Rpb24gdG9Qb3NpeChwOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG59XG5cbmZ1bmN0aW9uIGlzQWJzb2x1dGVQb3NpeChwOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHAuc3RhcnRzV2l0aCgnLycpIHx8IC9eW0EtWmEtel06XFwvLy50ZXN0KHApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYWJzcGF0aEFnYWluc3QoYmFzZTogc3RyaW5nLCB0YXJnZXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHQgPSB0b1Bvc2l4KHRhcmdldCk7XG4gIGlmIChpc0Fic29sdXRlUG9zaXgodCkpIHJldHVybiB0O1xuICBjb25zdCBiID0gdG9Qb3NpeChiYXNlKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgcmV0dXJuIGAke2J9LyR7dH1gO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVJlcG9Sb290KGRpcjogc3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbCk6IHN0cmluZyB8IG51bGwge1xuICBpZiAoIWRpcikgcmV0dXJuIG51bGw7XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgZGlyLCAncmV2LXBhcnNlJywgJy0tc2hvdy10b3BsZXZlbCddLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIGVuY29kaW5nOiAndXRmOCdcbiAgICB9KTtcbiAgICBjb25zdCB0cmltbWVkID0gb3V0LnRyaW0oKTtcbiAgICByZXR1cm4gdHJpbW1lZC5sZW5ndGggPiAwID8gdG9Qb3NpeCh0cmltbWVkKSA6IG51bGw7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbi8qKlxuICogUmVwb3J0IHdoZXRoZXIgYSByZXBvLXJlbGF0aXZlIHBhdGggaXMgZXhjbHVkZWQgYnkgZ2l0J3MgaWdub3JlIHJ1bGVzXG4gKiAoLmdpdGlnbm9yZSwgLmdpdC9pbmZvL2V4Y2x1ZGUsIGNvcmUuZXhjbHVkZXNGaWxlKS4gVXNlZCB0byBrZWVwIGlnbm9yZWRcbiAqIGZpbGVzIFx1MjAxNCBidWlsZCBvdXRwdXQsIGNhY2hlcywgbG9ncyBcdTIwMTQgb3V0IG9mIHRvdWNoIHRyYWNraW5nIGVudGlyZWx5LCBzb1xuICogdGhlIHRvdWNoIGhvb2sgbmV2ZXIgcmVwb3J0cyByZWFkcywgd3JpdGVzLCBvciB1bmNvdmVyZWQgd3JpdGVzIG9uIHRoZW0uXG4gKlxuICogYGdpdCBjaGVjay1pZ25vcmUgLXEgPHBhdGg+YCBleGl0cyAwIHdoZW4gdGhlIHBhdGggaXMgaWdub3JlZCwgMSB3aGVuIGl0IGlzXG4gKiBub3QsIGFuZCAxMjggb24gZXJyb3IuIGV4ZWNGaWxlU3luYyB0aHJvd3Mgb24gYW55IG5vbi16ZXJvIGV4aXQsIHNvIGEgY2xlYW5cbiAqIHJldHVybiBtZWFucyBcImlnbm9yZWRcIi4gQSBzdGF0dXMtMSB0aHJvdyBpcyB0aGUgZXhwZWN0ZWQgXCJub3QgaWdub3JlZFwiXG4gKiBzaWduYWw7IGFueSBvdGhlciBmYWlsdXJlIGlzIGFuIHVucmVsaWFibGUgYW5zd2VyLCBzbyB3ZSByZXBvcnQgYGZhbHNlYFxuICogKGRvIG5vdCBkcm9wIHRoZSB0b3VjaCkgcmF0aGVyIHRoYW4gc2lsZW50bHkgaGlkaW5nIGEgdHJhY2tlZCBmaWxlLlxuICovXG4vKipcbiAqIFRoZSBkZWZhdWx0IHNwYW4gcm9vdCBkaXJlY3RvcnksIHJlbGF0aXZlIHRvIHRoZSByZXBvIHJvb3QsIHVzZWQgd2hlbiBub1xuICogZW52aXJvbm1lbnQgdmFyaWFibGUgb3IgZ2l0IGNvbmZpZyBvdmVycmlkZXMgdGhlIGxvY2F0aW9uLlxuICovXG5leHBvcnQgY29uc3QgU1BBTl9ST09UID0gJy5zcGFuJztcblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBzcGFuIHJvb3QgZGlyZWN0b3J5IGZvciBhIGdpdmVuIHJlcG8sIG1pcnJvcmluZyB0aGUgUnVzdCBDTElcbiAqIHByZWNlZGVuY2UgKG1pbnVzIHRoZSAtLXNwYW4tZGlyIENMSSBmbGFnLCB3aGljaCBpcyBpbnZpc2libGUgdG8gZmlsZS13cml0ZVxuICogaG9va3MpOlxuICogICAxLiBHSVRfU1BBTl9ESVIgZW52aXJvbm1lbnQgdmFyaWFibGVcbiAqICAgMi4gYGdpdCBjb25maWcgZ2l0LXNwYW4uZGlyYCBpbiB0aGUgcmVwb1xuICogICAzLiBEZWZhdWx0OiBcIi5zcGFuXCJcbiAqXG4gKiBUaGUgcmV0dXJuZWQgdmFsdWUgaXMgYSBQT1NJWC1zdHlsZSBwYXRoIHdpdGggbm8gdHJhaWxpbmcgc2xhc2guXG4gKiBGYWlsLXNhZmU6IGFueSByZXNvbHV0aW9uIGVycm9yIGZhbGxzIGJhY2sgdG8gXCIuc3BhblwiIHNvIHRoZSBob29rIG5ldmVyXG4gKiBjcmFzaGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBlbnZEaXIgPSBwcm9jZXNzLmVudlsnR0lUX1NQQU5fRElSJ107XG4gIGlmIChlbnZEaXIgJiYgZW52RGlyLnRyaW0oKS5sZW5ndGggPiAwKSB7XG4gICAgcmV0dXJuIHRvUG9zaXgoZW52RGlyLnRyaW0oKSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIH1cbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ2NvbmZpZycsICdnaXQtc3Bhbi5kaXInXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnXG4gICAgfSk7XG4gICAgY29uc3QgdHJpbW1lZCA9IHRvUG9zaXgob3V0LnRyaW0oKSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gICAgaWYgKHRyaW1tZWQubGVuZ3RoID4gMCkgcmV0dXJuIHRyaW1tZWQ7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHZvaWQgZXJyOyAvLyBjb25maWcga2V5IGFic2VudCBvciBnaXQgZXJyb3IgXHUyMDE0IGZhbGwgdGhyb3VnaCB0byBkZWZhdWx0XG4gIH1cbiAgcmV0dXJuIFNQQU5fUk9PVDtcbn1cblxuLyoqXG4gKiBSZXBvcnQgd2hldGhlciBhIHJlcG8tcmVsYXRpdmUgUE9TSVggcGF0aCBmYWxscyBpbnNpZGUgdGhlIGdpdmVuIHNwYW4gcm9vdFxuICogZGlyZWN0b3J5LiBBIHBhdGggaXMgaW5zaWRlIHdoZW4gaXQgZXF1YWxzIHRoZSBzcGFuIHJvb3QgZXhhY3RseSBvciBpc1xuICogbmVzdGVkIGJlbmVhdGggaXQgKGkuZS4gc3RhcnRzIHdpdGggXCI8c3BhblJvb3Q+L1wiKS4gVGhlIFwiL1wiIGJvdW5kYXJ5IHByZXZlbnRzXG4gKiBmYWxzZSBwb3NpdGl2ZXMgZm9yIHNpYmxpbmdzIGxpa2UgXCIuc3BhbnMveFwiIG9yIFwiLnNwYW4tbm90ZXMveFwiLlxuICpcbiAqIFBhc3MgdGhlIHJlc3VsdCBvZiBgcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290KWAgYXMgYHNwYW5Sb290YC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzSW5zaWRlU3BhblJvb3QocmVwb1JlbFBhdGg6IHN0cmluZywgc3BhblJvb3Q6IHN0cmluZyA9IFNQQU5fUk9PVCk6IGJvb2xlYW4ge1xuICBjb25zdCByb290ID0gc3BhblJvb3QucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIHJldHVybiByZXBvUmVsUGF0aCA9PT0gcm9vdCB8fCByZXBvUmVsUGF0aC5zdGFydHNXaXRoKGAke3Jvb3R9L2ApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNHaXRJZ25vcmVkKHJlcG9Sb290OiBzdHJpbmcsIHJlcG9SZWxQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ2NoZWNrLWlnbm9yZScsICctcScsICctLScsIHJlcG9SZWxQYXRoXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ2lnbm9yZScsICdpZ25vcmUnXVxuICAgIH0pO1xuICAgIHJldHVybiB0cnVlO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB2b2lkIGVycjtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290OiBzdHJpbmcsIGFic1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHJvb3QgPSB0b1Bvc2l4KHJlcG9Sb290KTtcbiAgY29uc3QgYWJzID0gdG9Qb3NpeChhYnNQYXRoKTtcbiAgY29uc3QgcHJlZml4ID0gcm9vdC5lbmRzV2l0aCgnLycpID8gcm9vdCA6IGAke3Jvb3R9L2A7XG4gIHJldHVybiBhYnMuc3RhcnRzV2l0aChwcmVmaXgpID8gYWJzLnNsaWNlKHByZWZpeC5sZW5ndGgpIDogYWJzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2Fub25pY2FsaXplUGF0aChhYnNQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICB0cnkge1xuICAgIHJldHVybiB0b1Bvc2l4KGZzLnJlYWxwYXRoU3luYy5uYXRpdmUoYWJzUGF0aCkpO1xuICB9IGNhdGNoIHtcbiAgICAvLyBGaWxlIGRvZXNuJ3QgZXhpc3QgeWV0IChlLmcuIFdyaXRlIHRvIGEgbmV3IGZpbGUpOiBjYW5vbmljYWxpemUgdGhlXG4gICAgLy8gZGlyZWN0b3J5IGFuZCByZWpvaW4gdGhlIGJhc2VuYW1lIHNvIHN5bWxpbmtzIGluIHRoZSBwYXJlbnQgYXJlIHJlc29sdmVkLlxuICAgIHRyeSB7XG4gICAgICBjb25zdCBkaXIgPSB0b1Bvc2l4KGZzLnJlYWxwYXRoU3luYy5uYXRpdmUobm9kZVBhdGguZGlybmFtZShhYnNQYXRoKSkpO1xuICAgICAgcmV0dXJuIGAke2Rpcn0vJHtub2RlUGF0aC5iYXNlbmFtZShhYnNQYXRoKX1gO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gUGFyZW50IGRvZXNuJ3QgZXhpc3QgZWl0aGVyOyBmYWxsIGJhY2sgdG8gdGhlIHVuLWNhbm9uaWNhbGl6ZWQgcGF0aC5cbiAgICAgIHJldHVybiBhYnNQYXRoO1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZGVyaXZlUGF0aCh0b29sSW5wdXQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBjd2Q6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCBmcCA9IHRvb2xJbnB1dC5maWxlX3BhdGg7XG4gIGlmICh0eXBlb2YgZnAgIT09ICdzdHJpbmcnIHx8IGZwLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGFicyA9IGFic3BhdGhBZ2FpbnN0KGN3ZCwgZnApO1xuICByZXR1cm4gY2Fub25pY2FsaXplUGF0aChhYnMpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIExpbmUgcmFuZ2UgdHlwZXMgYW5kIGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIExpbmVSYW5nZSB7XG4gIHN0YXJ0OiBudW1iZXI7XG4gIGVuZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmFuZ2VzSW50ZXJzZWN0KGE6IExpbmVSYW5nZSwgYjogTGluZVJhbmdlKTogYm9vbGVhbiB7XG4gIHJldHVybiBhLnN0YXJ0IDw9IGIuZW5kICYmIGEuZW5kID49IGIuc3RhcnQ7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUG9yY2VsYWluIHJvdyBwYXJzaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBQb3JjZWxhaW5Sb3cge1xuICBuYW1lOiBzdHJpbmc7XG4gIHBhdGg6IHN0cmluZztcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVBvcmNlbGFpbihzdGRvdXQ6IHN0cmluZyk6IFBvcmNlbGFpblJvd1tdIHtcbiAgY29uc3Qgcm93czogUG9yY2VsYWluUm93W10gPSBbXTtcbiAgZm9yIChjb25zdCBsaW5lIG9mIHN0ZG91dC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkKSBjb250aW51ZTtcbiAgICBjb25zdCBwYXJ0cyA9IHRyaW1tZWQuc3BsaXQoJ1xcdCcpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPCAzKSBjb250aW51ZTtcbiAgICBjb25zdCBbbmFtZSwgcGF0aCwgcmFuZ2VdID0gcGFydHM7XG4gICAgY29uc3QgZGFzaElkeCA9IHJhbmdlLmluZGV4T2YoJy0nKTtcbiAgICBpZiAoZGFzaElkeCA9PT0gLTEpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHN0YXJ0ID0gcGFyc2VJbnQocmFuZ2Uuc2xpY2UoMCwgZGFzaElkeCksIDEwKTtcbiAgICBjb25zdCBlbmQgPSBwYXJzZUludChyYW5nZS5zbGljZShkYXNoSWR4ICsgMSksIDEwKTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0KSB8fCBOdW1iZXIuaXNOYU4oZW5kKSkgY29udGludWU7XG4gICAgcm93cy5wdXNoKHsgbmFtZSwgcGF0aCwgc3RhcnQsIGVuZCB9KTtcbiAgfVxuICByZXR1cm4gcm93cztcbn1cblxuLyoqXG4gKiBUaGUgZnVsbCBgZ2l0IHNwYW4gZHJpZnQgLS1mb3JtYXQgcG9yY2VsYWluYCBzdGF0dXMgdG9rZW4gdm9jYWJ1bGFyeSAodGhlXG4gKiBnaXQtc3BhbiBDTEkncyBwb3JjZWxhaW4gY29udHJhY3QpOiBgRlJFU0hgL2BNT1ZFRGAvYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYFxuICogYXJlIHBvc2l0aW9uYWwtb3ItY2xlYW4gYW5kIG5ldmVyIGRlYnQ7IGV2ZXJ5IG90aGVyIHRva2VuIGlzIHNlbWFudGljIGRyaWZ0XG4gKiBvciBhIHRlcm1pbmFsL2Vycm9yIGNvbmRpdGlvbiBhbmQgaXMgZGVidC4gU2VlIHtAbGluayBpc0RlYnR9IGZvciB0aGVcbiAqIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGggb24gdGhhdCBzcGxpdC5cbiAqL1xuZXhwb3J0IGNvbnN0IFBPUkNFTEFJTl9TVEFUVVNFUyA9IFtcbiAgJ0ZSRVNIJyxcbiAgJ1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUJyxcbiAgJ01PVkVEJyxcbiAgJ0NIQU5HRUQnLFxuICAnREVMRVRFRCcsXG4gICdDT05GTElDVCcsXG4gICdTVUJNT0RVTEUnLFxuICAnTEZTX05PVF9GRVRDSEVEJyxcbiAgJ0xGU19OT1RfSU5TVEFMTEVEJyxcbiAgJ1BST01JU09SX01JU1NJTkcnLFxuICAnU1BBUlNFX0VYQ0xVREVEJyxcbiAgJ0ZJTFRFUl9GQUlMRUQnLFxuICAnSU9fRVJST1InXG5dIGFzIGNvbnN0O1xuXG5leHBvcnQgdHlwZSBQb3JjZWxhaW5TdGF0dXMgPSAodHlwZW9mIFBPUkNFTEFJTl9TVEFUVVNFUylbbnVtYmVyXTtcblxuY29uc3QgUE9SQ0VMQUlOX1NUQVRVU19TRVQ6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFBPUkNFTEFJTl9TVEFUVVNFUyk7XG5cbmZ1bmN0aW9uIHBhcnNlUG9yY2VsYWluU3RhdHVzKHJhdzogc3RyaW5nKTogUG9yY2VsYWluU3RhdHVzIHwgbnVsbCB7XG4gIHJldHVybiBQT1JDRUxBSU5fU1RBVFVTX1NFVC5oYXMocmF3KSA/IChyYXcgYXMgUG9yY2VsYWluU3RhdHVzKSA6IG51bGw7XG59XG5cbi8qKiBBIGBwYXJzZURyaWZ0UG9yY2VsYWluYCByb3c6IGEge0BsaW5rIFBvcmNlbGFpblJvd30gcGx1cyBpdHMgc3RhdHVzIHRva2VuLiAqL1xuZXhwb3J0IGludGVyZmFjZSBEcmlmdFBvcmNlbGFpblJvdyBleHRlbmRzIFBvcmNlbGFpblJvdyB7XG4gIHN0YXR1czogUG9yY2VsYWluU3RhdHVzO1xufVxuXG4vKipcbiAqIFRoZSBkZWJ0IGludmFyaWFudCAoc3lzdGVtLXdpZGU7IGNvbnN1bWVkIGJ5IGJvdGggdGhlIGZ1dHVyZSB0b3VjaC1jb3JlIGFuZFxuICogYWR2aXNvci1jb3JlKTogb25seSBzZW1hbnRpYyBzdGF0dXNlcyBhcmUgZGVidC4gYENIQU5HRURgIGFuZCBgREVMRVRFRGAgYXJlXG4gKiBzZW1hbnRpYyBkcmlmdDsgdGhlIHJlbWFpbmluZyBub24tRlJFU0gvTU9WRUQvUkVTT0xWRURfUEVORElOR19DT01NSVQgdG9rZW5zXG4gKiBhcmUgdGVybWluYWwvZXJyb3IgY29uZGl0aW9ucyBhbmQgYXJlIHRyZWF0ZWQgYXMgZGVidCB0b28gKHRoZXkgYmxvY2sgb25cbiAqIHRoZWlyIG93biBtZXJpdHMgXHUyMDE0IHRoZSBDTEkgY291bGQgbm90IHJlc29sdmUgdGhlIGFuY2hvciBhdCBhbGwpLiBgRlJFU0hgLFxuICogYE1PVkVEYCwgYW5kIGBSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgYXJlIG5ldmVyIGRlYnQ6IHBvc2l0aW9uYWwgZHJpZnQgdGhlXG4gKiBDTEkgY2FuIGhlYWwgKG9yIGFscmVhZHkgaGFzKSBpcyBpbnZpc2libGUsIGFuZCBhIHBlbmRpbmctY29tbWl0IHJlc29sdXRpb25cbiAqIGlzIG5vdCBvdXRzdGFuZGluZyBkZWJ0LlxuICpcbiAqIE5vdGU6IHRoZSBwb3JjZWxhaW4gdm9jYWJ1bGFyeSBkb2VzIG5vdCBjdXJyZW50bHkgZGlzdGluZ3Vpc2hcbiAqIGNvbnRlbnQtZXF1aXZhbGVudCBgQ0hBTkdFRGAgKGUuZy4gd2hpdGVzcGFjZS1vbmx5IGRyaWZ0IGAtLWZpeGAgY2FuIGhlYWwpXG4gKiBmcm9tIGdlbnVpbmVseSBzZW1hbnRpYyBgQ0hBTkdFRGAgXHUyMDE0IHRoYXQgY2xhc3NpZmljYXRpb24gaXMgbm90IHByZXNlbnQgaW5cbiAqIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW5gIG91dHB1dCB0b2RheS4gVW50aWwgdGhlIENMSSBleHBvc2VzIGl0LFxuICogZXZlcnkgYENIQU5HRURgIHJvdyBpcyB0cmVhdGVkIGFzIGRlYnQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0RlYnQoc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBib29sZWFuIHtcbiAgc3dpdGNoIChzdGF0dXMpIHtcbiAgICBjYXNlICdGUkVTSCc6XG4gICAgY2FzZSAnTU9WRUQnOlxuICAgIGNhc2UgJ1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUJzpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIHRydWU7XG4gIH1cbn1cblxuLyoqXG4gKiBMb3dlcmNhc2UgaHVtYW4gbGFiZWwgZm9yIGEgcG9yY2VsYWluIHN0YXR1cyB0b2tlbiAoYExGU19OT1RfRkVUQ0hFRGAgXHUyMTkyXG4gKiBgbGZzIG5vdCBmZXRjaGVkYCkuIFRoZSBzaW5nbGUgbGFiZWwgbWFwcGluZyBmb3IgZXZlcnkgaHVtYW4tZm9ybWF0IGFuY2hvclxuICogc3VmZml4IFx1MjAxNCBib3RoIHRoZSB0b3VjaCBob29rJ3MgYmxvY2sgYW5kIHRoZSBhZHZpc29yJ3MgbWVzc2FnZXMgcmVuZGVyIHRocm91Z2hcbiAqIHRoaXMsIHNvIGEgc3RhdHVzIG5ldmVyIHJlYWRzIGRpZmZlcmVudGx5IGJldHdlZW4gdGhlIHR3by5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGh1bWFuU3RhdHVzTGFiZWwoc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBzdHJpbmcge1xuICByZXR1cm4gc3RhdHVzLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvXy9nLCAnICcpO1xufVxuXG4vKipcbiAqIFRoZSB0ZXJtaW5hbC9lbnZpcm9ubWVudGFsIHN0YXR1c2VzOiB0aGUgQ0xJIGNvdWxkIG5vdCByZXNvbHZlIHRoZSBhbmNob3IgYXRcbiAqIGFsbCwgc28gdGhlIHJvdyBpcyBub3Qgc3BhbiBkcmlmdCBhIHVzZXIgY2FuIGZpeCBieSBlZGl0aW5nIGEgc3Bhbi4gVGhlc2UgYXJlXG4gKiBgQ09ORkxJQ1RgICh1bnJlc29sdmVkIG1lcmdlKSwgYFNVQk1PRFVMRWAgKGFuY2hvciBpbnNpZGUgYSBzdWJtb2R1bGUpLFxuICogYExGU19OT1RfRkVUQ0hFRGAvYExGU19OT1RfSU5TVEFMTEVEYCAoR2l0IExGUyBjb250ZW50IHVuYXZhaWxhYmxlKSxcbiAqIGBQUk9NSVNPUl9NSVNTSU5HYCAocGFydGlhbC1jbG9uZSBvYmplY3Qgbm90IGZldGNoZWQpLCBgU1BBUlNFX0VYQ0xVREVEYFxuICogKHBhdGggb3V0c2lkZSB0aGUgc3BhcnNlLWNoZWNrb3V0IGNvbmUpLCBgRklMVEVSX0ZBSUxFRGAgKGEgY2xlYW4vc211ZGdlXG4gKiBmaWx0ZXIgZXJyb3JlZCksIGFuZCBgSU9fRVJST1JgICh0cmFuc2llbnQgcmVhZCBmYWlsdXJlKS5cbiAqXG4gKiBUaGVzZSBhcmUgYSBzdHJpY3Qgc3Vic2V0IG9mIHtAbGluayBpc0RlYnR9OiBldmVyeSBlbnZpcm9ubWVudGFsIHN0YXR1cyBpc1xuICogYWxzbyBkZWJ0IChpdCBibG9ja3Mgb24gaXRzIG93biBtZXJpdHMgd2hlbiBzdXJmYWNlZCBpbiBhIHN0YXR1cyByZXBvcnQpLCBidXRcbiAqIHRoZSBhZHZpc29yIG11c3QgdHJlYXQgdGhlbSBkaWZmZXJlbnRseSBmcm9tICpzZW1hbnRpYyogZHJpZnQgKGBDSEFOR0VEYCxcbiAqIGBERUxFVEVEYCkuIFNlbWFudGljIGRyaWZ0IGlzIGZpeGFibGUgYnkgZWRpdGluZyBhIHNwYW4sIHNvIHRoZSBhZHZpc29yIGZhaWxzXG4gKiBjbG9zZWQgb24gaXQ7IGFuIGVudmlyb25tZW50YWwgY29uZGl0aW9uIGlzIG5vdCBzb21ldGhpbmcgYSBzcGFuIGVkaXQgY2FuXG4gKiByZXNvbHZlLCBzbyB0aGUgYWR2aXNvciBmYWlscyBPUEVOIG9uIGl0IChhbGxvdywgYnV0IHN1cmZhY2UgdGhlIGNvbmRpdGlvbikgXHUyMDE0XG4gKiByZS1kZW55aW5nIGZvcmV2ZXIgb24gYW4gaW5mcmEgZmFpbHVyZSB0aGUgdXNlciBjYW5ub3QgY2xlYXIgZnJvbSBoZXJlIHdvdWxkXG4gKiBjb250cmFkaWN0IHRoZSBmYWlsLW9wZW4gY29udHJhY3QgdGhlIHJlc3Qgb2YgdGhlIGFkdmlzb3IgYWxyZWFkeSBob25vcnMgZm9yXG4gKiBDTEktYWJzZW50L3RpbWVvdXQvcGFyc2UtZmFpbHVyZSBjb25kaXRpb25zLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNFbnZpcm9ubWVudGFsU3RhdHVzKHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogYm9vbGVhbiB7XG4gIHN3aXRjaCAoc3RhdHVzKSB7XG4gICAgY2FzZSAnQ09ORkxJQ1QnOlxuICAgIGNhc2UgJ1NVQk1PRFVMRSc6XG4gICAgY2FzZSAnTEZTX05PVF9GRVRDSEVEJzpcbiAgICBjYXNlICdMRlNfTk9UX0lOU1RBTExFRCc6XG4gICAgY2FzZSAnUFJPTUlTT1JfTUlTU0lORyc6XG4gICAgY2FzZSAnU1BBUlNFX0VYQ0xVREVEJzpcbiAgICBjYXNlICdGSUxURVJfRkFJTEVEJzpcbiAgICBjYXNlICdJT19FUlJPUic6XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKlxuICogYGdpdCBzcGFuIGRyaWZ0IC0tZm9ybWF0IHBvcmNlbGFpbmAgZW1pdHMgYSBkaWZmZXJlbnQgc2hhcGUgdGhhblxuICogYGxpc3QgLS1wb3JjZWxhaW5gOiBhIGAjIHBvcmNlbGFpbiB2MmAgaGVhZGVyLCBgIyBmdXp6eSBOYCBjb21tZW50IGxpbmVzLFxuICogYW5kIG9uZSBgPHN0YXR1cz5cXHQ8c3JjPlxcdDxuYW1lPlxcdDxwYXRoPlxcdDxzdGFydD5cXHQ8ZW5kPmAgcm93IHBlciBkcmlmdGVkXG4gKiBhbmNob3IgKHdob2xlLWZpbGUgYW5jaG9ycyBjYXJyeSBgKHdob2xlKWAvYC1gIGluIHBsYWNlIG9mIHRoZSBsaW5lIGNvbHVtbnMpLlxuICogUm93cyB3aG9zZSBzdGF0dXMgdG9rZW4gaXMgbm90IGluIHtAbGluayBQT1JDRUxBSU5fU1RBVFVTRVN9IGFyZSBza2lwcGVkIFx1MjAxNFxuICogYW4gdW5yZWNvZ25pemVkIHRva2VuIGZyb20gYSBuZXdlciBDTEkgaXMgdHJlYXRlZCB0aGUgc2FtZSBhcyBhIG1hbGZvcm1lZFxuICogbGluZSByYXRoZXIgdGhhbiBndWVzc2VkIGF0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VEcmlmdFBvcmNlbGFpbihzdGRvdXQ6IHN0cmluZyk6IERyaWZ0UG9yY2VsYWluUm93W10ge1xuICBjb25zdCByb3dzOiBEcmlmdFBvcmNlbGFpblJvd1tdID0gW107XG4gIGZvciAoY29uc3QgbGluZSBvZiBzdGRvdXQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCB8fCB0cmltbWVkLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgY29uc3QgcGFydHMgPSB0cmltbWVkLnNwbGl0KCdcXHQnKTtcbiAgICBpZiAocGFydHMubGVuZ3RoIDwgNikgY29udGludWU7XG4gICAgY29uc3QgW3N0YXR1c0NvbCwgLCBuYW1lLCBwYXRoLCBzdGFydENvbCwgZW5kQ29sXSA9IHBhcnRzO1xuICAgIGNvbnN0IHN0YXR1cyA9IHBhcnNlUG9yY2VsYWluU3RhdHVzKHN0YXR1c0NvbCk7XG4gICAgaWYgKCFzdGF0dXMpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHN0YXJ0ID0gc3RhcnRDb2wgPT09ICcod2hvbGUpJyA/IDAgOiBwYXJzZUludChzdGFydENvbCwgMTApO1xuICAgIGNvbnN0IGVuZCA9IGVuZENvbCA9PT0gJy0nID8gMCA6IHBhcnNlSW50KGVuZENvbCwgMTApO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpIHx8IE51bWJlci5pc05hTihlbmQpKSBjb250aW51ZTtcbiAgICByb3dzLnB1c2goeyBuYW1lLCBwYXRoLCBzdGFydCwgZW5kLCBzdGF0dXMgfSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2Vzc2lvbiBJRCBzYW5pdGl6YXRpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIEluamVjdGl2ZSB0cmFuc2Zvcm06IHBlcmNlbnQtZW5jb2RlIGJ5dGVzIG91dHNpZGUgW0EtWmEtejAtOS5fLV0gYXMgJUhIXG4gKiAodXBwZXJjYXNlIGhleCkuIFVzZWQgdG8gcHJvZHVjZSBzYWZlIGZpbGVuYW1lcyBmcm9tIGFyYml0cmFyeSBzZXNzaW9uIGlkcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplU2Vzc2lvbklkKHNlc3Npb25JZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHNlc3Npb25JZC5yZXBsYWNlKC9bXkEtWmEtejAtOS5fLV0vZywgKGNoKSA9PiB7XG4gICAgcmV0dXJuIGAlJHtjaC5jaGFyQ29kZUF0KDApLnRvU3RyaW5nKDE2KS50b1VwcGVyQ2FzZSgpLnBhZFN0YXJ0KDIsICcwJyl9YDtcbiAgfSk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUGVyLXNlc3Npb24gYmFzZSBkaXJlY3Rvcnlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vLyBCYXNlIGRpciBzaGFyZWQgYnkgYWxsIHBlci1zZXNzaW9uIHN0YXRlOiBjdXJyZW50bHkganVzdCB0aGUgdG91Y2gtaG9va1xuLy8gc2Vzc2lvbiBtZW1vIChzcGFuLXN1cmZhY2UudHMncyBNZW1vU3RvcmUpLiBFYWNoIHNlc3Npb24gZ2V0cyBvbmVcbi8vIHN1YmRpcmVjdG9yeSBrZXllZCBieSBpdHMgc2FuaXRpemVkIGlkLCBzbyBldmVyeSB3cml0ZXIvcmVhZGVyIGZvciBhIGdpdmVuXG4vLyBzZXNzaW9uIGFncmVlcyBvbiBpdHMgbG9jYXRpb24uXG5leHBvcnQgY29uc3QgU0VTU0lPTl9CQVNFX0RJUiA9IG5vZGVQYXRoLmpvaW4ob3MuaG9tZWRpcigpLCAnLmNhY2hlJywgJ2dpdC1zcGFuJywgJ3Nlc3Npb24nKTtcblxuLyoqIFRoZSBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcnkgZm9yIGEgZ2l2ZW4gc2Vzc2lvbiBpZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uRGlyKHNlc3Npb25JZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4oU0VTU0lPTl9CQVNFX0RJUiwgc2FuaXRpemVTZXNzaW9uSWQoc2Vzc2lvbklkKSk7XG59XG5cbmNvbnN0IFRISVJUWV9EQVlTX01TID0gMzAgKiAyNCAqIDYwICogNjAgKiAxMDAwO1xuXG4vKipcbiAqIE9wcG9ydHVuaXN0aWNhbGx5IHBydW5lIHBlci1zZXNzaW9uIHN0YXRlIGRpcmVjdG9yaWVzIHVuZGVyXG4gKiB7QGxpbmsgU0VTU0lPTl9CQVNFX0RJUn0gd2hvc2UgbXRpbWUgaXMgb2xkZXIgdGhhbiBgbWF4QWdlTXNgIChkZWZhdWx0IDMwXG4gKiBkYXlzKS4gQSBkaXJlY3RvcnkncyBtdGltZSBhZHZhbmNlcyB3aGVuZXZlciBhbiBlbnRyeSBpbnNpZGUgaXQgaXNcbiAqIGNyZWF0ZWQvcmVuYW1lZC9yZW1vdmVkLCBzbyBhbiBhY3RpdmUgc2Vzc2lvbiAobWVtbyB3cml0ZXMpIHN0YXlzIGZyZXNoO1xuICogb25seSBnZW51aW5lbHkgYWJhbmRvbmVkIHNlc3Npb25zIGFnZSBvdXQuXG4gKlxuICogQmVzdC1lZmZvcnQgYW5kIG5vbi10aHJvd2luZzogY2FsbGVkIG9wcG9ydHVuaXN0aWNhbGx5IGZyb20gaG9vayByZWFkL3dyaXRlXG4gKiBwYXRocywgbm90IGEgc2VwYXJhdGUgY3Jvbi1saWtlIG1lY2hhbmlzbSwgc28gYSBmYWlsdXJlIGhlcmUgbXVzdCBuZXZlclxuICogYmxvY2sgdGhlIGNhbGxlcidzIGFjdHVhbCB3b3JrLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcHJ1bmVTdGFsZVNlc3Npb25zKG5vdzogbnVtYmVyID0gRGF0ZS5ub3coKSwgbWF4QWdlTXM6IG51bWJlciA9IFRISVJUWV9EQVlTX01TKTogdm9pZCB7XG4gIGxldCBlbnRyaWVzOiBmcy5EaXJlbnRbXTtcbiAgdHJ5IHtcbiAgICBlbnRyaWVzID0gZnMucmVhZGRpclN5bmMoU0VTU0lPTl9CQVNFX0RJUiwgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm47IC8vIGJhc2UgZGlyIGFic2VudCBvciB1bnJlYWRhYmxlIFx1MjAxNCBub3RoaW5nIHRvIHBydW5lXG4gIH1cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSB7XG4gICAgaWYgKCFlbnRyeS5pc0RpcmVjdG9yeSgpKSBjb250aW51ZTtcbiAgICBjb25zdCBkaXJQYXRoID0gbm9kZVBhdGguam9pbihTRVNTSU9OX0JBU0VfRElSLCBlbnRyeS5uYW1lKTtcbiAgICB0cnkge1xuICAgICAgY29uc3Qgc3RhdCA9IGZzLnN0YXRTeW5jKGRpclBhdGgpO1xuICAgICAgaWYgKG5vdyAtIHN0YXQubXRpbWVNcyA+IG1heEFnZU1zKSB7XG4gICAgICAgIGZzLnJtU3luYyhkaXJQYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XG4gICAgICB9XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBWYW5pc2hlZCBiZXR3ZWVuIHJlYWRkaXIgYW5kIHN0YXQsIG9yIHJlbW92YWwgZmFpbGVkIFx1MjAxNCBza2lwIGl0LiBBXG4gICAgICAvLyBiZXN0LWVmZm9ydCBwcnVuZSBtdXN0IG5ldmVyIHRocm93IGludG8gdGhlIGNhbGxlcidzIGhvdCBwYXRoLlxuICAgIH1cbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIGtpbmQgYW5kIGFuY2hvciBmb3JtYXR0aW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IHR5cGUgVG91Y2hLaW5kID0gJ3JlYWQnIHwgJ3dyaXRlJyB8ICd3aG9sZS1yZWFkJyB8ICd3aG9sZS13cml0ZScgfCAnY3JlYXRlJztcblxuLyoqXG4gKiBGb3JtYXQgYSBzcGFuIGFuY2hvciBzdHJpbmcuXG4gKlxuICogLSBgd2hvbGUtcmVhZGAsIGB3aG9sZS13cml0ZWAsIGFuZCBgY3JlYXRlYDogcmV0dXJucyBqdXN0IHRoZSBwYXRoXG4gKiAtIGByZWFkYCBhbmQgYHdyaXRlYDogcmV0dXJucyBgcGF0aCNMPHN0YXJ0Pi1MPGVuZD5gIChyZXF1aXJlcyByYW5nZSlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEFuY2hvcihwYXRoOiBzdHJpbmcsIGtpbmQ6IFRvdWNoS2luZCwgcmFuZ2U/OiBMaW5lUmFuZ2UpOiBzdHJpbmcge1xuICBpZiAoKGtpbmQgPT09ICdyZWFkJyB8fCBraW5kID09PSAnd3JpdGUnKSAmJiByYW5nZSkge1xuICAgIHJldHVybiBgJHtwYXRofSNMJHtyYW5nZS5zdGFydH0tTCR7cmFuZ2UuZW5kfWA7XG4gIH1cbiAgcmV0dXJuIHBhdGg7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQW5jaG9yIHNwZWMgdHlwZVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgQW5jaG9yU3BlYyB7XG4gIHBhdGg6IHN0cmluZztcbiAga2luZDogVG91Y2hLaW5kO1xuICByYW5nZT86IExpbmVSYW5nZTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBRdWV1ZSBkaXJlY3RvcnkgaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgZ2l0IGNvbW1vbiBkaXJlY3RvcnkgZm9yIHRoZSBnaXZlbiByZXBvIHJvb3QuXG4gKiBUaGlzIGlzIHRoZSBzaGFyZWQgZGlyZWN0b3J5IChub3QgdGhlIHdvcmt0cmVlLXNwZWNpZmljIC5naXQpLCBzbyBxdWV1ZVxuICogcmVjb3JkcyBzdXJ2aXZlIHdvcmt0cmVlIGRlbGV0aW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUdpdENvbW1vbkRpcihyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdyZXYtcGFyc2UnLCAnLS1naXQtY29tbW9uLWRpciddLCB7XG4gICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgZW5jb2Rpbmc6ICd1dGY4J1xuICB9KTtcbiAgY29uc3QgdHJpbW1lZCA9IHRvUG9zaXgob3V0LnRyaW0oKSk7XG4gIC8vIGdpdCByZXR1cm5zIGEgcmVsYXRpdmUgcGF0aCAoZS5nLiBcIi5naXRcIikgZm9yIHNpbXBsZSByZXBvcy4gUmVzb2x2ZSBpdFxuICAvLyBhZ2FpbnN0IHJlcG9Sb290IHNvIGNhbGxlcnMgbmV2ZXIgZGVwZW5kIG9uIHByb2Nlc3MuY3dkKCkuXG4gIGlmICghbm9kZVBhdGguaXNBYnNvbHV0ZSh0cmltbWVkKSkge1xuICAgIHJldHVybiB0b1Bvc2l4KG5vZGVQYXRoLnJlc29sdmUocmVwb1Jvb3QsIHRyaW1tZWQpKTtcbiAgfVxuICByZXR1cm4gdHJpbW1lZDtcbn1cblxuLyoqXG4gKiBSb290IG9mIHRoZSBnaXQtc3BhbiBxdWV1ZSBkaXJlY3RvcnkgdHJlZSwgdW5kZXIgdGhlIGdpdCBjb21tb24gZGlyLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcXVldWVSb290KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihyZXNvbHZlR2l0Q29tbW9uRGlyKHJlcG9Sb290KSwgJ2dpdC1zcGFuJyk7XG59XG5cbi8qKlxuICogRGlyZWN0b3J5IGZvciB0aGUgYWR2aXNvcidzIHBlci1jaGFuZ2VzZXQgc3RhdGUgbWVtb3MgKGRpZ2VzdCBvZiBzb3J0ZWRcbiAqIGZpbmRpbmdzICsgdW5jb3ZlcmVkIHBhdGhzKSwgdW5kZXIgdGhlIGdpdCBjb21tb24gZGlyIHNvIGl0IGlzIHNoYXJlZFxuICogYWNyb3NzIHdvcmt0cmVlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFkdmlzb3JNZW1vRGlyKHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihxdWV1ZVJvb3QocmVwb1Jvb3QpLCAnYWR2aXNvcicpO1xufVxuIiwgIi8qKlxuICogSGFybmVzcy1hZ25vc3RpYyBzcGFuLXN1cmZhY2luZyBjb3JlLlxuICpcbiAqIEdpdmVuIGFuIGFscmVhZHktcmVzb2x2ZWQgcmVwby1yZWxhdGl2ZSBwYXRoIGFuZCBhIGxpbmUgcmFuZ2UsIHRoaXMgbW9kdWxlXG4gKiBydW5zIHRoZSBzaGFyZWQgYGdpdCBzcGFuIGxpc3QgLS1wb3JjZWxhaW5gIC8gYC5ob29raWdub3JlYCAvIHNlc3Npb24tbWVtbyAvXG4gKiBgZ2l0IHNwYW4gZHJpZnRgIHBpcGVsaW5lIGFuZCBhc3NlbWJsZXMgdGhlIGh1bWFuLXJlYWRhYmxlIGA8Z2l0LXNwYW4+XHUyMDI2PC9naXQtc3Bhbj5gXG4gKiBibG9jayB0aGF0IGJvdGggYWRhcHRlcnMgc3VyZmFjZSBpbmxpbmUgYmVmb3JlIGFuIGVkaXQuIEl0IGltcG9ydHMgbm90aGluZ1xuICogZnJvbSBlaXRoZXIgaG9vayBTREs6IHRoZSBDbGF1ZGUgUHJlVG9vbFVzZSBob29rIGZlZWRzIGl0IGEgcmFuZ2UgZGVyaXZlZCBmcm9tXG4gKiBgZmlsZV9wYXRoYC9gb2Zmc2V0YC9gb2xkX3N0cmluZ2A7IHRoZSBDb2RleCBQcmVUb29sVXNlIGhvb2sgZmVlZHMgaXQgdGhlXG4gKiByYW5nZXMgcmVjb3ZlcmVkIGZyb20gYW4gYGFwcGx5X3BhdGNoYCBlbnZlbG9wZS4gRWFjaCBhZGFwdGVyIHdyYXBzIHRoZVxuICogcmV0dXJuZWQgYmxvY2sgc3RyaW5nIGluIGl0cyBvd24gU0RLIG91dHB1dCBidWlsZGVyLlxuICpcbiAqIFRoZSBleGVjdXRvci9kcmlmdC9tZW1vIGRlcGVuZGVuY2llcyBhcmUgaW5qZWN0ZWQgc28gdGhlIHBpcGVsaW5lIGlzIHRlc3RhYmxlXG4gKiB3aXRoIGZha2VzIGV4YWN0bHkgbGlrZSB0aGUgcG9yY2VsYWluIHBhcnNlcnMgaW4gdGhlIHNoYXJlZCBrZXJuZWwuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7XG4gIGlzR2l0SWdub3JlZCxcbiAgaXNJbnNpZGVTcGFuUm9vdCxcbiAgdHlwZSBMaW5lUmFuZ2UsXG4gIHR5cGUgUG9yY2VsYWluUm93LFxuICBwYXJzZURyaWZ0UG9yY2VsYWluLFxuICBwYXJzZVBvcmNlbGFpbixcbiAgcHJ1bmVTdGFsZVNlc3Npb25zLFxuICByYW5nZXNJbnRlcnNlY3QsXG4gIHJlbGF0aXZlVG9SZXBvLFxuICByZXNvbHZlUmVwb1Jvb3QsXG4gIHJlc29sdmVTcGFuUm9vdCxcbiAgc2Vzc2lvbkRpcixcbiAgdG9Qb3NpeFxufSBmcm9tICcuL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyB0eXBlIEhvb2tJZ25vcmVMb2FkZXIsIGlzU3BhblN1cHByZXNzZWQgfSBmcm9tICcuL3NwYW4taWdub3JlLmpzJztcblxuLyoqXG4gKiBNaW5pbWFsIGxvZ2dlciBzdXJmYWNlIHRoZSBgY29tbW9uL2AgbGF5ZXIgbG9ncyB0aHJvdWdoOyBib3RoIFNESyBsb2dnZXJzXG4gKiBzYXRpc2Z5IGl0LiBgd2FybmAgaXMgcmVxdWlyZWQgXHUyMDE0IGV2ZXJ5IGV4aXN0aW5nIGNhbGwgc2l0ZSByZXBvcnRzIGEgZmFpbHVyZS5cbiAqIGBpbmZvYCBpcyBvcHRpb25hbCBzbyBhIGZha2UgY2Fycnlpbmcgb25seSBgd2FybmAgc3RpbGwgc2F0aXNmaWVzIHRoZVxuICogaW50ZXJmYWNlOiBpdCBleGlzdHMgZm9yIHRoZSBkaWFnbm9zdGljIGJyZWFkY3J1bWJzIGEgKnN1Y2Nlc3NmdWwqIHJ1biBsZWF2ZXNcbiAqIGJlaGluZCAoYWR2aXNvci1jb3JlJ3MgY2h1cm4tc3VwcHJlc3Npb24gY291bnQpLCB3aGljaCBhcmUgbm90IHdhcm5pbmdzIGFuZFxuICogbXVzdCBub3QgcmVhZCBhcyBmYWlsdXJlcyBpbiB0aGUgaG9vayBsb2cuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29yZUxvZ2dlciB7XG4gIHdhcm4obWVzc2FnZTogc3RyaW5nLCBjb250ZXh0PzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB2b2lkO1xuICBpbmZvPyhtZXNzYWdlOiBzdHJpbmcsIGNvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQ7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU3BhbiBleGVjdXRvciBhYnN0cmFjdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogRXhlY3V0ZXMgYGdpdCBzcGFuIGxpc3RgIHdpdGggZ2l2ZW4gYXJncyBpbiBhIGdpdmVuIGN3ZC5cbiAqIFJldHVybnMgc3Rkb3V0IHN0cmluZy4gVGhyb3dzIG9uIG5vbi16ZXJvIGV4aXQuXG4gKi9cbmV4cG9ydCB0eXBlIFNwYW5FeGVjdXRvciA9IChhcmdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpID0+IHN0cmluZztcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHRTcGFuRXhlY3V0b3IodGltZW91dE1zID0gMTBfMDAwKTogU3BhbkV4ZWN1dG9yIHtcbiAgcmV0dXJuIChhcmdzLCBjd2QpID0+IHtcbiAgICByZXR1cm4gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnbGlzdCcsIC4uLmFyZ3NdLCB7XG4gICAgICBjd2QsXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgfSk7XG4gIH07XG59XG5cbi8qKlxuICogUnVucyBgZ2l0IHNwYW4gZHJpZnQgLS1mb3JtYXQgcG9yY2VsYWluIDxzbHVncz5gIGFuZCByZXR1cm5zIGl0cyBwb3JjZWxhaW4gc3Rkb3V0IFx1MjAxNFxuICogb25lIHJvdyBwZXIgKmRyaWZ0ZWQqIGFuY2hvciBhbW9uZyB0aGUgZ2l2ZW4gc3BhbnMsIGVtcHR5IHdoZW4gYWxsIGFyZSBjbGVhbi5cbiAqIGBnaXQgc3BhbiBkcmlmdGAgZXhpdHMgMCBpbiBwb3JjZWxhaW4gbW9kZSB3aGV0aGVyIG9yIG5vdCBkcmlmdCBleGlzdHMsIGJ1dCB3ZVxuICogc3RpbGwgY2FwdHVyZSBzdGRvdXQgZnJvbSBhIHRocm93biBlcnJvciBzbyBhIGRyaWZ0IHNpZ25hbCBpcyBuZXZlciBsb3N0IHRvIGFcbiAqIG5vbi16ZXJvIGV4aXQuIFRocm93cyBvbmx5IHdoZW4gbm8gc3Rkb3V0IGlzIGF2YWlsYWJsZSAoZ2VudWluZSBmYWlsdXJlKS5cbiAqL1xuZXhwb3J0IHR5cGUgRHJpZnRFeGVjdXRvciA9IChzbHVnczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKSA9PiBzdHJpbmc7XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0RHJpZnRFeGVjdXRvcih0aW1lb3V0TXMgPSAxMF8wMDApOiBEcmlmdEV4ZWN1dG9yIHtcbiAgcmV0dXJuIChzbHVncywgY3dkKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdkcmlmdCcsICctLWZvcm1hdCcsICdwb3JjZWxhaW4nLCAuLi5zbHVnc10sIHtcbiAgICAgICAgY3dkLFxuICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zdCBvdXQgPSAoZXJyIGFzIHsgc3Rkb3V0Pzogc3RyaW5nIH0pLnN0ZG91dDtcbiAgICAgIGlmICh0eXBlb2Ygb3V0ID09PSAnc3RyaW5nJykgcmV0dXJuIG91dDtcbiAgICAgIHRocm93IGVycjtcbiAgICB9XG4gIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2Vzc2lvbiBtZW1vIGFic3RyYWN0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBNZW1vU3RvcmUge1xuICBnZXRTdXJmYWNlZChzZXNzaW9uSWQ6IHN0cmluZyk6IFNldDxzdHJpbmc+O1xuICBhZGRTdXJmYWNlZChzZXNzaW9uSWQ6IHN0cmluZywgbmFtZXM6IHN0cmluZ1tdKTogdm9pZDtcbn1cblxuLy8gTGl2ZXMgdW5kZXIgdGhlIHNoYXJlZCBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcnkgKGFnZW50LWhvb2tzLWNvbW1vbi50cydzXG4vLyBzZXNzaW9uRGlyKSBcdTIwMTQgcmVsb2NhdGVkIGZyb20gb3MudG1wZGlyKCkvYWdlbnQtaG9va3MtZ2l0LXNwYW4vIHNvXG4vLyBwZXItc2Vzc2lvbiBzdGF0ZSBoYXMgb25lIGhvbWUgYW5kIGlzIGNvdmVyZWQgYnkgcHJ1bmVTdGFsZVNlc3Npb25zJ3Ncbi8vIG9wcG9ydHVuaXN0aWMgPjMwLWRheSBwcnVuaW5nLlxuZnVuY3Rpb24gbWVtb0ZpbGVQYXRoKHNlc3Npb25JZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4oc2Vzc2lvbkRpcihzZXNzaW9uSWQpLCAndG91Y2gtbWVtby5qc29uJyk7XG59XG5cbmV4cG9ydCB0eXBlIE1lbW9Mb2dnZXIgPSBDb3JlTG9nZ2VyO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGlza01lbW9TdG9yZShsb2dnZXI6IE1lbW9Mb2dnZXIpOiBNZW1vU3RvcmUge1xuICByZXR1cm4ge1xuICAgIGdldFN1cmZhY2VkKHNlc3Npb25JZCkge1xuICAgICAgcHJ1bmVTdGFsZVNlc3Npb25zKCk7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByYXcgPSBmcy5yZWFkRmlsZVN5bmMobWVtb0ZpbGVQYXRoKHNlc3Npb25JZCksICd1dGY4Jyk7XG4gICAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UocmF3KSBhcyB7IHN1cmZhY2VkPzogdW5rbm93biB9O1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShwYXJzZWQuc3VyZmFjZWQpKSB7XG4gICAgICAgICAgcmV0dXJuIG5ldyBTZXQocGFyc2VkLnN1cmZhY2VkIGFzIHN0cmluZ1tdKTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKCdtZW1vIHJlYWQgZmFpbGVkICh0cmVhdGluZyBhcyBlbXB0eSknLCB7IGVyciB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBuZXcgU2V0KCk7XG4gICAgfSxcbiAgICBhZGRTdXJmYWNlZChzZXNzaW9uSWQsIG5hbWVzKSB7XG4gICAgICBwcnVuZVN0YWxlU2Vzc2lvbnMoKTtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5nZXRTdXJmYWNlZChzZXNzaW9uSWQpO1xuICAgICAgZm9yIChjb25zdCBuIG9mIG5hbWVzKSBleGlzdGluZy5hZGQobik7XG4gICAgICBjb25zdCBtZW1vRGlyID0gc2Vzc2lvbkRpcihzZXNzaW9uSWQpO1xuICAgICAgY29uc3QgbWVtb1BhdGggPSBtZW1vRmlsZVBhdGgoc2Vzc2lvbklkKTtcbiAgICAgIGNvbnN0IHRtcFBhdGggPSBgJHttZW1vUGF0aH0udG1wYDtcbiAgICAgIHRyeSB7XG4gICAgICAgIGZzLm1rZGlyU3luYyhtZW1vRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgZnMud3JpdGVGaWxlU3luYyh0bXBQYXRoLCBKU09OLnN0cmluZ2lmeSh7IHN1cmZhY2VkOiBbLi4uZXhpc3RpbmddIH0pLCAndXRmOCcpO1xuICAgICAgICBmcy5yZW5hbWVTeW5jKHRtcFBhdGgsIG1lbW9QYXRoKTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBsb2dnZXIud2FybignbWVtbyB3cml0ZSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG59XG5cbi8qKiBGYWN0b3J5IGZ1bmN0aW9uIHRoYXQgY3JlYXRlcyBhIE1lbW9TdG9yZSBnaXZlbiBhIGxvZ2dlci4gKi9cbmV4cG9ydCB0eXBlIE1lbW9GYWN0b3J5ID0gKGxvZ2dlcjogTWVtb0xvZ2dlcikgPT4gTWVtb1N0b3JlO1xuXG4vKiogRGVmYXVsdCBkaXNrLWJhY2tlZCBtZW1vIGZhY3RvcnkgdXNlZCBpbiBwcm9kdWN0aW9uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRpc2tNZW1vRmFjdG9yeShsb2dnZXI6IE1lbW9Mb2dnZXIpOiBNZW1vU3RvcmUge1xuICByZXR1cm4gY3JlYXRlRGlza01lbW9TdG9yZShsb2dnZXIpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIHNjb3BlIHJlc29sdXRpb24gKHJlcG8tc2NvcGluZyArIGdpdGlnbm9yZSArIHNwYW4tcm9vdCBndWFyZHMpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBUb3VjaFNjb3BlIHtcbiAgcmVwb1Jvb3Q6IHN0cmluZztcbiAgcmVwb1JlbFBhdGg6IHN0cmluZztcbn1cblxuLyoqXG4gKiBCb3VuZCBhIHRvdWNoZWQgZmlsZSB0byB0aGUgQ1dEIHJlcG8uIFJlc29sdmUgdGhlIHJlcG8gcm9vdCBvZiB0aGUgY3VycmVudFxuICogd29ya2luZyBkaXJlY3RvcnkgYW5kIHJlcXVpcmUgdGhlIHRvdWNoZWQgZmlsZSB0byByZXNvbHZlIHRvIHRoZSBTQU1FIHJlcG9cbiAqIHJvb3Q7IGRyb3AgZmlsZXMgaW4gYSBkaWZmZXJlbnQgcmVwb3NpdG9yeS93b3JrdHJlZSwgZ2l0aWdub3JlZCBmaWxlcywgYW5kXG4gKiBmaWxlcyB1bmRlciB0aGUgc3BhbiByb290LiBSZXR1cm5zIHRoZSByZXNvbHZlZCBgeyByZXBvUm9vdCwgcmVwb1JlbFBhdGggfWBcbiAqIG9yIG51bGwgd2hlbiB0aGUgdG91Y2ggaXMgb3V0IG9mIHNjb3BlLlxuICpcbiAqIENvbXBhcmluZyByZXNvbHZlZCBgZ2l0IC0tc2hvdy10b3BsZXZlbGAgdG9wbGV2ZWxzIChub3QgcGF0aCBwcmVmaXhlcylcbiAqIGRpc3Rpbmd1aXNoZXMgc2VwYXJhdGUgcmVwb3MgYW5kIHdvcmt0cmVlcyBhbmQgaXMgcm9idXN0IHRvIHN5bWxpbmtzLiBGYWlsXG4gKiBjbG9zZWQ6IGlmIHRoZSBDV0QgcmVwbyBjYW4ndCBiZSByZXNvbHZlZCwgdGhlIHRvdWNoIGlzIGRyb3BwZWQgcmF0aGVyIHRoYW5cbiAqIGZhbGxpbmcgYmFjayB0byB0aGUgZmlsZSdzIG93biByZXBvLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVRvdWNoU2NvcGUoY3dkOiBzdHJpbmcsIGFic1BhdGg6IHN0cmluZyk6IFRvdWNoU2NvcGUgfCBudWxsIHtcbiAgY29uc3QgY3dkUmVwb1Jvb3QgPSBjd2QgPyByZXNvbHZlUmVwb1Jvb3QoY3dkKSA6IG51bGw7XG4gIGlmICghY3dkUmVwb1Jvb3QpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGFic0RpciA9IHRvUG9zaXgobm9kZVBhdGguZGlybmFtZShhYnNQYXRoKSk7XG4gIGNvbnN0IGZpbGVSZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChhYnNEaXIpO1xuICBpZiAoZmlsZVJlcG9Sb290ICE9PSBjd2RSZXBvUm9vdCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgcmVwb1Jvb3QgPSBjd2RSZXBvUm9vdDtcbiAgY29uc3QgcmVwb1JlbFBhdGggPSByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgYWJzUGF0aCk7XG5cbiAgLy8gU2tpcCBnaXRpZ25vcmVkIGZpbGVzIGVudGlyZWx5LiBCdWlsZCBvdXRwdXQsIGNhY2hlcywgYW5kIGxvZ3MgYXJlIG5vdFxuICAvLyBzcGFuLXJlbGV2YW50OiB0aGV5IG11c3QgbmV2ZXIgc3VyZmFjZSBzcGFuIG92ZXJsYXBzLlxuICBpZiAoaXNHaXRJZ25vcmVkKHJlcG9Sb290LCByZXBvUmVsUGF0aCkpIHJldHVybiBudWxsO1xuXG4gIC8vIFNraXAgc3BhbiBkb2N1bWVudHMgZW50aXJlbHkuIEZpbGVzIHVuZGVyIHRoZSByZXNvbHZlZCBzcGFuIHJvb3QgYXJlIG1hbmFnZWRcbiAgLy8gYnkgZ2l0IHNwYW4gaXRzZWxmIGFuZCBhcmUgbm90IGFwcGxpY2F0aW9uIHNvdXJjZXMgdGhhdCBuZWVkIHNwYW4gY292ZXJhZ2UuXG4gIGNvbnN0IHNwYW5Sb290ID0gcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290KTtcbiAgaWYgKGlzSW5zaWRlU3BhblJvb3QocmVwb1JlbFBhdGgsIHNwYW5Sb290KSkgcmV0dXJuIG51bGw7XG5cbiAgcmV0dXJuIHsgcmVwb1Jvb3QsIHJlcG9SZWxQYXRoIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU3VyZmFjZSByb3V0aW5lXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEluamVjdGVkIGRlcGVuZGVuY2llcyBmb3Ige0BsaW5rIHN1cmZhY2VPdmVybGFwcGluZ1NwYW5zfS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3VyZmFjZURlcHMge1xuICBleGVjdXRvcjogU3BhbkV4ZWN1dG9yO1xuICBkcmlmdEV4ZWN1dG9yOiBEcmlmdEV4ZWN1dG9yO1xuICBtZW1vOiBNZW1vU3RvcmU7XG4gIGxvYWRSdWxlczogSG9va0lnbm9yZUxvYWRlcjtcbiAgbG9nZ2VyOiBDb3JlTG9nZ2VyO1xufVxuXG4vKipcbiAqIEdpdmVuIGEgcmVwby1yZWxhdGl2ZSBwYXRoIGFuZCB0aGUgbGluZSByYW5nZSBiZWluZyB0b3VjaGVkIHdpdGhpbiBhblxuICogYWxyZWFkeS1yZXNvbHZlZCByZXBvLCBwcm9kdWNlIHRoZSBgPGdpdC1zcGFuPlx1MjAyNjwvZ2l0LXNwYW4+YCBibG9jayBmb3IgdGhlXG4gKiBzcGFucyBvdmVybGFwcGluZyB0aGF0IHJhbmdlLCBvciBudWxsIHdoZW4gdGhlcmUgaXMgbm90aGluZyB0byBzdXJmYWNlLlxuICpcbiAqIFRoZSBwaXBlbGluZTogYGdpdCBzcGFuIGxpc3QgPHBhdGg+IC0tcG9yY2VsYWluYCBcdTIxOTIga2VlcCBsaW5lLXJhbmdlZCBhbmNob3JzIG9uXG4gKiB0aGUgc2FtZSBmaWxlIHRoYXQgaW50ZXJzZWN0IHRoZSByYW5nZSBhbmQgYXJlIG5vdCBgLmhvb2tpZ25vcmVgLXN1cHByZXNzZWQgXHUyMTkyXG4gKiBkcm9wIHNsdWdzIGFscmVhZHkgc3VyZmFjZWQgdGhpcyBzZXNzaW9uIChtZW1vKSBcdTIxOTIgcmVuZGVyIGBnaXQgc3BhbiBsaXN0XG4gKiA8bmFtZXNcdTIwMjY+YCBcdTIxOTIgYXBwZW5kIGEgYGdpdCBzcGFuIGhpc3RvcnkgPG5hbWU+YCBwb2ludGVyIGZvciBhbnkgYWxyZWFkeS1kcmlmdGVkXG4gKiBzcGFuLiBPbiBzdWNjZXNzIHRoZSBzdXJmYWNlZCBuYW1lcyBhcmUgcmVjb3JkZWQgaW4gdGhlIG1lbW8uIEV4ZWN1dG9yIGFuZFxuICogZHJpZnQtcHJvYmUgZmFpbHVyZXMgYXJlIGxvZ2dlZCBhbmQgZGVncmFkZSB0byBudWxsIC8gdGhlIHBsYWluIGJsb2NrOyB0aGV5XG4gKiBuZXZlciB0aHJvdy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN1cmZhY2VPdmVybGFwcGluZ1NwYW5zKFxuICBkZXBzOiBTdXJmYWNlRGVwcyxcbiAgcmVwb1Jvb3Q6IHN0cmluZyxcbiAgcmVwb1JlbFBhdGg6IHN0cmluZyxcbiAgcmFuZ2U6IExpbmVSYW5nZSxcbiAgc2Vzc2lvbklkOiBzdHJpbmdcbik6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCB7IGV4ZWN1dG9yLCBkcmlmdEV4ZWN1dG9yLCBtZW1vLCBsb2FkUnVsZXMsIGxvZ2dlciB9ID0gZGVwcztcblxuICAvLyBGaWx0ZXIgcGFzczogZ2l0IHNwYW4gbGlzdCA8cGF0aD4gLS1wb3JjZWxhaW5cbiAgbGV0IHBvcmNlbGFpblN0ZG91dDogc3RyaW5nO1xuICB0cnkge1xuICAgIHBvcmNlbGFpblN0ZG91dCA9IGV4ZWN1dG9yKFsnLS1wb3JjZWxhaW4nLCByZXBvUmVsUGF0aF0sIHJlcG9Sb290KTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nZ2VyLndhcm4oJ2dpdCBzcGFuIGxpc3QgLS1wb3JjZWxhaW4gZmFpbGVkJywgeyBlcnIgfSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICAvLyBQYXRoLXNjb3BlZCBzdXBwcmVzc2lvbjogYSByZXBvJ3MgLnNwYW4vLmhvb2tpZ25vcmUgY2FuIGhvbGQgYmFjayBzcGFuIHNsdWdcbiAgLy8gcHJlZml4ZXMgZm9yIGFuY2hvcnMgdW5kZXIgZ2l2ZW4gcGF0aHMuIEEgc3VwcHJlc3NlZCBzcGFuIGlzIG5ldmVyIHN1cmZhY2VkLlxuICBjb25zdCBpZ25vcmVSdWxlcyA9IGxvYWRSdWxlcyhyZXBvUm9vdCk7XG5cbiAgY29uc3Qgcm93czogUG9yY2VsYWluUm93W10gPSBwYXJzZVBvcmNlbGFpbihwb3JjZWxhaW5TdGRvdXQpO1xuICBjb25zdCBjYW5kaWRhdGVOYW1lcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgaWYgKHJvdy5wYXRoICE9PSByZXBvUmVsUGF0aCkgY29udGludWU7XG4gICAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSBjb250aW51ZTsgLy8gd2hvbGUtZmlsZSBhbmNob3JcbiAgICBpZiAoIXJhbmdlc0ludGVyc2VjdChyYW5nZSwgeyBzdGFydDogcm93LnN0YXJ0LCBlbmQ6IHJvdy5lbmQgfSkpIGNvbnRpbnVlO1xuICAgIGlmIChpc1NwYW5TdXBwcmVzc2VkKGlnbm9yZVJ1bGVzLCByb3cucGF0aCwgcm93Lm5hbWUpKSBjb250aW51ZTtcbiAgICBjYW5kaWRhdGVOYW1lcy5hZGQocm93Lm5hbWUpO1xuICB9XG5cbiAgaWYgKGNhbmRpZGF0ZU5hbWVzLnNpemUgPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIFN1YnRyYWN0IGFscmVhZHktc3VyZmFjZWQgbmFtZXNcbiAgY29uc3Qgc3VyZmFjZWQgPSBtZW1vLmdldFN1cmZhY2VkKHNlc3Npb25JZCk7XG4gIGNvbnN0IHRvU3VyZmFjZSA9IFsuLi5jYW5kaWRhdGVOYW1lc10uZmlsdGVyKChuKSA9PiAhc3VyZmFjZWQuaGFzKG4pKS5zb3J0KCk7XG4gIGlmICh0b1N1cmZhY2UubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAvLyBSZW5kZXIgcGFzczogZ2l0IHNwYW4gbGlzdCA8bmFtZTE+IDxuYW1lMj4gLi4uXG4gIGxldCByZW5kZXJTdGRvdXQ6IHN0cmluZztcbiAgdHJ5IHtcbiAgICByZW5kZXJTdGRvdXQgPSBleGVjdXRvcih0b1N1cmZhY2UsIHJlcG9Sb290KTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nZ2VyLndhcm4oJ2dpdCBzcGFuIGxpc3QgKHJlbmRlcikgZmFpbGVkJywgeyBlcnIgfSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICAvLyBPZiB0aGUgc3BhbnMgYmVpbmcgc3VyZmFjZWQsIGZsYWcgYW55IGFscmVhZHkgZHJpZnRlZCBcdTIwMTQgdGhlIHRvdWNoZWQgbGluZXMgaGF2ZVxuICAvLyBkcmlmdGVkIGZyb20gdGhlaXIgYW5jaG9yZWQgc3RhdGUgXHUyMDE0IHdpdGggYSBgZ2l0IHNwYW4gaGlzdG9yeSA8bmFtZT5gIHBvaW50ZXIuXG4gIC8vIERldGVjdGlvbiBpcyBhcy1vZi1ub3cgKHN1cmZhY2luZyBydW5zIGJlZm9yZSB0aGUgZWRpdCBhcHBsaWVzKSwgc28gdGhpc1xuICAvLyBjYXRjaGVzIHByZS1leGlzdGluZyBkcmlmdDsgZHJpZnQgdGhpcyBzZXNzaW9uIGNhdXNlcyBpcyB0aGUgU3RvcCBob29rJ3Mgam9iLlxuICAvLyBGYWlsdXJlIHRvIGNvbXB1dGUgZHJpZnQgaXMgbm9uLWZhdGFsOiBmYWxsIGJhY2sgdG8gdGhlIHBsYWluIGJsb2NrLlxuICBsZXQgZHJpZnRIaW50ID0gJyc7XG4gIHRyeSB7XG4gICAgY29uc3QgZHJpZnROYW1lcyA9IG5ldyBTZXQocGFyc2VEcmlmdFBvcmNlbGFpbihkcmlmdEV4ZWN1dG9yKHRvU3VyZmFjZSwgcmVwb1Jvb3QpKS5tYXAoKHIpID0+IHIubmFtZSkpO1xuICAgIGNvbnN0IGRyaWZ0U3VyZmFjZWQgPSB0b1N1cmZhY2UuZmlsdGVyKChuKSA9PiBkcmlmdE5hbWVzLmhhcyhuKSk7XG4gICAgaWYgKGRyaWZ0U3VyZmFjZWQubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgbGluZXMgPSBkcmlmdFN1cmZhY2VkLm1hcCgobikgPT4gYCAgZ2l0IHNwYW4gaGlzdG9yeSAke259YCkuam9pbignXFxuJyk7XG4gICAgICBkcmlmdEhpbnQgPSBgXFxuRHJpZnQgXHUyMDE0IHRoZSBsaW5lcyB5b3UncmUgdG91Y2hpbmcgaGF2ZSBkcmlmdGVkIGZyb20gdGhlc2Ugc3BhbnMnIGFuY2hvcmVkIHN0YXRlLiBSZXZpZXcgaG93IGVhY2ggc3Vic3lzdGVtIGV2b2x2ZWQgYmVmb3JlIGNoYW5naW5nIGl0OlxcbiR7bGluZXN9YDtcbiAgICB9XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZ2dlci53YXJuKCdnaXQgc3BhbiBkcmlmdCAoaGlzdG9yeSBoaW50KSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgfVxuXG4gIGNvbnN0IHdyYXBwZWQgPSBgXFxuPGdpdC1zcGFuPlxcbiR7cmVuZGVyU3Rkb3V0fSR7ZHJpZnRIaW50fVxcbjwvZ2l0LXNwYW4+XFxuYDtcblxuICAvLyBVcGRhdGUgbWVtb1xuICBtZW1vLmFkZFN1cmZhY2VkKHNlc3Npb25JZCwgdG9TdXJmYWNlKTtcblxuICByZXR1cm4gd3JhcHBlZDtcbn1cbiIsICIvKipcbiAqIFBhdGgtc2NvcGVkIHNwYW4gc3VwcHJlc3Npb24gZm9yIHRoZSBhZ2VudCBob29rcy5cbiAqXG4gKiBTb21lIHNwYW5zIGFyZSBub2lzZSB3aGVuIGJyb3dzaW5nIGNlcnRhaW4gcGFydHMgb2YgdGhlIHRyZWUgXHUyMDE0IHdpa2kgb3JcbiAqIG1hcmtldGluZyBzcGFucyB0aGF0IGFuY2hvciBwcm9zZSwgc3VyZmFjZWQgaW5saW5lIHdoaWxlIHJlYWRpbmcgc291cmNlLFxuICogYWRkIGxpdHRsZS4gVGhpcyBtb2R1bGUgbGV0cyBhIHJlcG8gZGVjbGFyZSwgcGVyIHBhdGgsIHdoaWNoIHNwYW4gc2x1Z1xuICogcHJlZml4ZXMgdG8gaG9sZCBiYWNrLlxuICpcbiAqIENvbmZpZyBsaXZlcyBhdCBgPHJlcG9Sb290Pi8uc3Bhbi8uaG9va2lnbm9yZWAuIEVhY2ggbm9uLWNvbW1lbnQgbGluZSBpcyBhXG4gKiBnaXRpZ25vcmUtc3R5bGUgcGF0aCBwYXR0ZXJuLCBhIHNpbmdsZSBydW4gb2Ygd2hpdGVzcGFjZSwgdGhlbiBhXG4gKiBjb21tYS1zZXBhcmF0ZWQgbGlzdCBvZiBzcGFuIHNsdWcgcHJlZml4ZXMgdG8gc3VwcHJlc3MgZm9yIHBhdGhzIHRoZSBwYXR0ZXJuXG4gKiBtYXRjaGVzOlxuICpcbiAqICAgcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjIHdpa2ksbWFya2V0aW5nXG4gKlxuICogQSBzcGFuIHdob3NlIHNsdWcgYmVnaW5zIHdpdGggYHdpa2lgIG9yIGBtYXJrZXRpbmdgICh0aGUgc2x1ZyBlcXVhbHMgdGhlXG4gKiBwcmVmaXgsIG9yIGlzIGA8cHJlZml4Pi9cdTIwMjZgKSBpcyB0aGVuIG5ldmVyIHN1cmZhY2VkIGZvciBhbiBhbmNob3Igd2hvc2UgcGF0aFxuICogc2l0cyB1bmRlciBgcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjYCBcdTIwMTQgaXQgaXMgbmV2ZXIgc3VyZmFjZWQgaW4gdGhlIGlubGluZVxuICogYDxnaXQtc3Bhbj5gIGJsb2NrIHRoZSBgUG9zdFRvb2xVc2VgIHRvdWNoIGhvb2sgZW1pdHMuIEl0IGhhcyBubyBlZmZlY3Qgb25cbiAqIHRoZSBgUHJlVG9vbFVzZWAgYWR2aXNvciwgd2hvc2Ugb3duIHVuY292ZXJlZC13cml0ZXMgc3VwcHJlc3Npb24gbGl2ZXMgaW5cbiAqIGAuc3Bhbi8uYWR2aXNvcmlnbm9yZWAgKHNlZSBgYWR2aXNvci1pZ25vcmUudHNgKS5cbiAqXG4gKiBQYXR0ZXJuIGdyYW1tYXIgaXMgYSBkZWxpYmVyYXRlIHN1YnNldCBvZiBnaXRpZ25vcmU6XG4gKlxuICogLSBCbGFuayBsaW5lcyBhbmQgbGluZXMgYmVnaW5uaW5nIHdpdGggYCNgIGFyZSBza2lwcGVkLlxuICogLSBBIHRyYWlsaW5nIGAvYCByZXN0cmljdHMgdGhlIHBhdHRlcm4gdG8gZGlyZWN0b3JpZXMgKHRoZSBsZWFmIGZpbGUgaXMgbm90XG4gKiAgIGl0c2VsZiB0ZXN0ZWQsIG9ubHkgaXRzIGFuY2VzdG9yIGRpcmVjdG9yaWVzKS5cbiAqIC0gQSBwYXR0ZXJuIGNvbnRhaW5pbmcgYSBzbGFzaCBpcyBhbmNob3JlZCB0byB0aGUgcmVwbyByb290OyBhIHBhdHRlcm4gd2l0aFxuICogICBubyBzbGFzaCBtYXRjaGVzIGEgc2luZ2xlIHBhdGggY29tcG9uZW50IGF0IGFueSBkZXB0aC5cbiAqIC0gYCpgIGFuZCBgP2AgbWF0Y2ggd2l0aGluIG9uZSBwYXRoIHNlZ21lbnQ7IGAqKmAgbWF0Y2hlcyBhY3Jvc3Mgc2VnbWVudHMuXG4gKiAtIE5lZ2F0aW9uIChgIWApIGlzIG5vdCBzdXBwb3J0ZWQuXG4gKlxuICogU3VwcHJlc3Npb24gaXMgZmFpbC1vcGVuOiBhIG1pc3Npbmcgb3IgdW5yZWFkYWJsZSBgLmhvb2tpZ25vcmVgLCBvciBhXG4gKiBtYWxmb3JtZWQgbGluZSwgeWllbGRzIG5vIHJ1bGUgcmF0aGVyIHRoYW4gaGlkaW5nIHNwYW5zIHRoZSBhdXRob3IgZGlkIG5vdFxuICogYXNrIHRvIGhpZGUuXG4gKi9cblxuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuXG5leHBvcnQgaW50ZXJmYWNlIElnbm9yZVJ1bGUge1xuICAvKiogVGhlIHJhdyBnaXRpZ25vcmUtc3R5bGUgcGF0dGVybiwgcmV0YWluZWQgZm9yIGRpYWdub3N0aWNzLiAqL1xuICBwYXR0ZXJuOiBzdHJpbmc7XG4gIC8qKiBTcGFuIHNsdWcgcHJlZml4ZXMgc3VwcHJlc3NlZCBmb3IgcGF0aHMgdGhpcyBydWxlIG1hdGNoZXMuICovXG4gIHByZWZpeGVzOiBzdHJpbmdbXTtcbiAgLyoqIFRydWUgd2hlbiBgcmVwb1JlbFBhdGhgIChQT1NJWCwgcmVwby1yZWxhdGl2ZSkgaXMgZ292ZXJuZWQgYnkgdGhpcyBydWxlLiAqL1xuICBtYXRjaGVzOiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4gYm9vbGVhbjtcbn1cblxuY29uc3QgSE9PS19JR05PUkVfUkVMID0gbm9kZVBhdGguam9pbignLnNwYW4nLCAnLmhvb2tpZ25vcmUnKTtcblxuLyoqXG4gKiBUcmFuc2xhdGUgb25lIGdpdGlnbm9yZS1zdHlsZSBnbG9iIHNlZ21lbnQgaW50byBhbiBhbmNob3JlZCBSZWdFeHAuIGAqYCBhbmRcbiAqIGA/YCBzdGF5IHdpdGhpbiBhIHBhdGggc2VnbWVudDsgYCoqYCAob3B0aW9uYWxseSBmb2xsb3dlZCBieSBgL2ApIHNwYW5zIHRoZW0uXG4gKi9cbmZ1bmN0aW9uIGdsb2JUb1JlZ0V4cChnbG9iOiBzdHJpbmcpOiBSZWdFeHAge1xuICBsZXQgcmUgPSAnJztcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBnbG9iLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYyA9IGdsb2JbaV07XG4gICAgaWYgKGMgPT09ICcqJykge1xuICAgICAgaWYgKGdsb2JbaSArIDFdID09PSAnKicpIHtcbiAgICAgICAgcmUgKz0gJy4qJztcbiAgICAgICAgaSsrO1xuICAgICAgICAvLyBBYnNvcmIgYSBmb2xsb3dpbmcgc2xhc2ggc28gYCoqL2Zvb2AgZG9lcyBub3QgZGVtYW5kIGEgbGl0ZXJhbCBgL2AuXG4gICAgICAgIGlmIChnbG9iW2kgKyAxXSA9PT0gJy8nKSBpKys7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZSArPSAnW14vXSonO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoYyA9PT0gJz8nKSB7XG4gICAgICByZSArPSAnW14vXSc7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlICs9IGMucmVwbGFjZSgvWy4rXiR7fSgpfFtcXF1cXFxcXS9nLCAnXFxcXCQmJyk7XG4gICAgfVxuICB9XG4gIHJldHVybiBuZXcgUmVnRXhwKGBeJHtyZX0kYCk7XG59XG5cbi8qKiBBbmNlc3RvciBwYXRoIGNoYWluOiBgYS9iL2MudHNgIFx1MjE5MiBgWydhJywgJ2EvYicsICdhL2IvYy50cyddYC4gKi9cbmZ1bmN0aW9uIGFuY2VzdG9yUGF0aHMocGF0aDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBwYXJ0cyA9IHBhdGguc3BsaXQoJy8nKTtcbiAgY29uc3Qgb3V0OiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgb3V0LnB1c2gocGFydHMuc2xpY2UoMCwgaSArIDEpLmpvaW4oJy8nKSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBDb21waWxlIGEgc2luZ2xlIGdpdGlnbm9yZS1zdHlsZSBwYXR0ZXJuICh0aGlzIG1vZHVsZSdzIGdyYW1tYXIgXHUyMDE0IHNlZSB0aGVcbiAqIG1vZHVsZSBkb2MgY29tbWVudCkgaW50byBhIHBhdGggcHJlZGljYXRlLiBBIHBhdHRlcm4gbWF0Y2hlcyBhIGZpbGUgd2hlbiBpdFxuICogbWF0Y2hlcyB0aGUgZmlsZSdzIHBhdGggb3IgYW55IGFuY2VzdG9yIGRpcmVjdG9yeSBvZiBpdCwgc28gYSBkaXJlY3RvcnlcbiAqIHBhdHRlcm4gc3VwcHJlc3NlcyBldmVyeXRoaW5nIGJlbmVhdGggaXQuXG4gKlxuICogRXhwb3J0ZWQgc28gb3RoZXIgcGF0aC1zY29wZWQgaWdub3JlLWZpbGUgY29udmVudGlvbnMgKGUuZy4gYC5hZHZpc29yaWdub3JlYFxuICogaW4gYGFkdmlzb3ItaWdub3JlLnRzYCkgY2FuIHJldXNlIHRoZSBleGFjdCBtYXRjaGluZyBzZW1hbnRpY3MgcmF0aGVyIHRoYW5cbiAqIHJlaW1wbGVtZW50aW5nIHRoZW0uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21waWxlUGF0dGVybihwYXR0ZXJuOiBzdHJpbmcpOiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4gYm9vbGVhbiB7XG4gIGxldCBwYXQgPSBwYXR0ZXJuO1xuICBsZXQgZGlyT25seSA9IGZhbHNlO1xuICBpZiAocGF0LmVuZHNXaXRoKCcvJykpIHtcbiAgICBkaXJPbmx5ID0gdHJ1ZTtcbiAgICBwYXQgPSBwYXQuc2xpY2UoMCwgLTEpO1xuICB9XG4gIGxldCBhbmNob3JlZCA9IHBhdC5pbmNsdWRlcygnLycpO1xuICBpZiAocGF0LnN0YXJ0c1dpdGgoJy8nKSkge1xuICAgIGFuY2hvcmVkID0gdHJ1ZTtcbiAgICBwYXQgPSBwYXQuc2xpY2UoMSk7XG4gIH1cbiAgY29uc3QgcmUgPSBnbG9iVG9SZWdFeHAocGF0KTtcblxuICByZXR1cm4gKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IHtcbiAgICBpZiAoYW5jaG9yZWQpIHtcbiAgICAgIGNvbnN0IHNlZ3MgPSBhbmNlc3RvclBhdGhzKHJlcG9SZWxQYXRoKTtcbiAgICAgIC8vIEZvciBhIGRpci1vbmx5IHBhdHRlcm4sIG5ldmVyIHRlc3QgdGhlIGxlYWYgZmlsZSBpdHNlbGYuXG4gICAgICBjb25zdCBjYW5kaWRhdGVzID0gZGlyT25seSA/IHNlZ3Muc2xpY2UoMCwgLTEpIDogc2VncztcbiAgICAgIHJldHVybiBjYW5kaWRhdGVzLnNvbWUoKHMpID0+IHJlLnRlc3QocykpO1xuICAgIH1cbiAgICAvLyBVbmFuY2hvcmVkOiBtYXRjaCBhZ2FpbnN0IGluZGl2aWR1YWwgcGF0aCBjb21wb25lbnRzIGF0IGFueSBkZXB0aC5cbiAgICBjb25zdCBjb21wb25lbnRzID0gcmVwb1JlbFBhdGguc3BsaXQoJy8nKTtcbiAgICBjb25zdCBjYW5kaWRhdGVzID0gZGlyT25seSA/IGNvbXBvbmVudHMuc2xpY2UoMCwgLTEpIDogY29tcG9uZW50cztcbiAgICByZXR1cm4gY2FuZGlkYXRlcy5zb21lKChjKSA9PiByZS50ZXN0KGMpKTtcbiAgfTtcbn1cblxuLyoqIFBhcnNlIGAuaG9va2lnbm9yZWAgdGV4dCBpbnRvIHJ1bGVzLCBza2lwcGluZyBjb21tZW50cyBhbmQgbWFsZm9ybWVkIGxpbmVzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlSG9va0lnbm9yZShjb250ZW50OiBzdHJpbmcpOiBJZ25vcmVSdWxlW10ge1xuICBjb25zdCBydWxlczogSWdub3JlUnVsZVtdID0gW107XG4gIGZvciAoY29uc3QgcmF3TGluZSBvZiBjb250ZW50LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IGxpbmUgPSByYXdMaW5lLnRyaW0oKTtcbiAgICBpZiAoIWxpbmUgfHwgbGluZS5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIC8vIGA8cGF0dGVybj48d2hpdGVzcGFjZT48cHJlZml4ZXM+YCBcdTIwMTQgcGF0dGVybiBpcyB0aGUgZmlyc3QgdG9rZW4sIHByZWZpeGVzXG4gICAgLy8gdGhlIHNlY29uZC4gQSBsaW5lIHdpdGhvdXQgYm90aCBpcyBtYWxmb3JtZWQgYW5kIHNraXBwZWQuXG4gICAgY29uc3QgbWF0Y2ggPSBsaW5lLm1hdGNoKC9eKFxcUyspXFxzKyhcXFMrKSQvKTtcbiAgICBpZiAoIW1hdGNoKSBjb250aW51ZTtcbiAgICBjb25zdCBbLCBwYXR0ZXJuLCBwcmVmaXhlc1Jhd10gPSBtYXRjaDtcbiAgICBjb25zdCBwcmVmaXhlcyA9IHByZWZpeGVzUmF3XG4gICAgICAuc3BsaXQoJywnKVxuICAgICAgLm1hcCgocCkgPT4gcC50cmltKCkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgIGlmIChwcmVmaXhlcy5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgIHJ1bGVzLnB1c2goeyBwYXR0ZXJuLCBwcmVmaXhlcywgbWF0Y2hlczogY29tcGlsZVBhdHRlcm4ocGF0dGVybikgfSk7XG4gIH1cbiAgcmV0dXJuIHJ1bGVzO1xufVxuXG4vKipcbiAqIExvYWQgdGhlIHN1cHByZXNzaW9uIHJ1bGVzIGZvciBhIHJlcG8uIEZhaWwtb3BlbjogYW55IHJlYWQgb3IgcGFyc2UgZmFpbHVyZVxuICogeWllbGRzIGFuIGVtcHR5IHJ1bGUgc2V0LCBzbyBzcGFucyBzdXJmYWNlIGFzIG5vcm1hbCB3aGVuIG5vIGNvbmZpZyBleGlzdHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsb2FkSG9va0lnbm9yZShyZXBvUm9vdDogc3RyaW5nKTogSWdub3JlUnVsZVtdIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKG5vZGVQYXRoLmpvaW4ocmVwb1Jvb3QsIEhPT0tfSUdOT1JFX1JFTCksICd1dGY4Jyk7XG4gICAgcmV0dXJuIHBhcnNlSG9va0lnbm9yZShjb250ZW50KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG59XG5cbi8qKiBBIHNsdWcgY2FycmllcyBhIHByZWZpeCB3aGVuIGl0IGVxdWFscyB0aGUgcHJlZml4IG9yIGlzIGA8cHJlZml4Pi9cdTIwMjZgLiAqL1xuZnVuY3Rpb24gc2x1Z0hhc1ByZWZpeChzbHVnOiBzdHJpbmcsIHByZWZpeDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBzbHVnID09PSBwcmVmaXggfHwgc2x1Zy5zdGFydHNXaXRoKGAke3ByZWZpeH0vYCk7XG59XG5cbi8qKlxuICogVHJ1ZSB3aGVuIGEgc3BhbiBgc2x1Z2Agc2hvdWxkIGJlIHN1cHByZXNzZWQgZm9yIGFuIGFuY2hvciBhdCBgcmVwb1JlbFBhdGhgOlxuICogc29tZSBydWxlIG1hdGNoZXMgdGhlIHBhdGggYW5kIGxpc3RzIGEgcHJlZml4IHRoZSBzbHVnIGNhcnJpZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1NwYW5TdXBwcmVzc2VkKHJ1bGVzOiBJZ25vcmVSdWxlW10sIHJlcG9SZWxQYXRoOiBzdHJpbmcsIHNsdWc6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IHJ1bGUgb2YgcnVsZXMpIHtcbiAgICBpZiAoIXJ1bGUubWF0Y2hlcyhyZXBvUmVsUGF0aCkpIGNvbnRpbnVlO1xuICAgIGlmIChydWxlLnByZWZpeGVzLnNvbWUoKHApID0+IHNsdWdIYXNQcmVmaXgoc2x1ZywgcCkpKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBTaWduYXR1cmUgZm9yIGluamVjdGluZyBhIHJ1bGUgbG9hZGVyIChwcm9kdWN0aW9uIGRlZmF1bHQ6IHtAbGluayBsb2FkSG9va0lnbm9yZX0pLiAqL1xuZXhwb3J0IHR5cGUgSG9va0lnbm9yZUxvYWRlciA9IChyZXBvUm9vdDogc3RyaW5nKSA9PiBJZ25vcmVSdWxlW107XG4iLCAiLyoqXG4gKiBIYXJuZXNzLWFnbm9zdGljIHRvdWNoLWhvb2sgY29yZS5cbiAqXG4gKiBUaGlzIG1vZHVsZSBpbXBsZW1lbnRzIHRoZSBQb3N0VG9vbFVzZSBcInRvdWNoIHNpZ25hbFwiIHRoYXQgYm90aCB0aGUgQ2xhdWRlXG4gKiAoYFJlYWR8RWRpdHxXcml0ZWApIGFuZCBDb2RleCAoYGFwcGx5X3BhdGNoYCkgYWRhcHRlcnMgZHJpdmUuIEl0IGltcG9ydHNcbiAqIG5vdGhpbmcgZnJvbSBlaXRoZXIgaG9vayBTREsgYW5kIGlzIHR5cGVkIHN0cnVjdHVyYWxseSwgcGVyIHRoZSBgY29tbW9uL2BcbiAqIGxheWVyIGNvbnZlbnRpb246IGFkYXB0ZXJzIHRyYW5zbGF0ZSB0aGVpciBTREstc3BlY2lmaWMgaG9vayBpbnB1dCBpbnRvIGFcbiAqIHtAbGluayBUb3VjaElucHV0fSwgaW5qZWN0IGV4ZWN1dGlvbi9zdGF0ZSBkZXBlbmRlbmNpZXMsIGFuZCB3cmFwIHRoZSByZXR1cm5lZFxuICoge0BsaW5rIFRvdWNoT3V0cHV0fSBpbiB0aGVpciBvd24gb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogUmV1c2VkIGZyb20gdGhlIHNoYXJlZCBrZXJuZWwgKG5vdCByZWRlZmluZWQpOiBgaXNEZWJ0KClgICtcbiAqIGBQb3JjZWxhaW5TdGF0dXNgL2BEcmlmdFBvcmNlbGFpblJvd2AvYFBvcmNlbGFpblJvd2AvYHBhcnNlUG9yY2VsYWluYC9cbiAqIGBwYXJzZURyaWZ0UG9yY2VsYWluYCAoYWdlbnQtaG9va3MtY29tbW9uLnRzKSwgYHJhbmdlc0ludGVyc2VjdGAgYW5kIHRoZVxuICogcmVwby9zcGFuLXJvb3QgcGF0aCB1dGlsaXRpZXMgKGFnZW50LWhvb2tzLWNvbW1vbi50cyksIGFuZCB0aGUgYE1lbW9TdG9yZWBcbiAqIGNhZGVuY2Ugc3RvcmUgKHNwYW4tc3VyZmFjZS50cykuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0IHsgYmFzZW5hbWUsIGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHtcbiAgdHlwZSBEcmlmdFBvcmNlbGFpblJvdyxcbiAgaHVtYW5TdGF0dXNMYWJlbCxcbiAgaXNEZWJ0LFxuICB0eXBlIExpbmVSYW5nZSxcbiAgdHlwZSBQb3JjZWxhaW5Sb3csXG4gIHR5cGUgUG9yY2VsYWluU3RhdHVzLFxuICBwYXJzZURyaWZ0UG9yY2VsYWluLFxuICBwYXJzZVBvcmNlbGFpbixcbiAgcmFuZ2VzSW50ZXJzZWN0LFxuICByZWxhdGl2ZVRvUmVwbyxcbiAgcmVzb2x2ZVJlcG9Sb290LFxuICByZXNvbHZlU3BhblJvb3Rcbn0gZnJvbSAnLi9hZ2VudC1ob29rcy1jb21tb24uanMnO1xuaW1wb3J0IHsgY29sbGFwc2VCeVBhdGgsIHR5cGUgUmFuZ2VMYWJlbCwgcmVuZGVyQW5jaG9yVHJlZSB9IGZyb20gJy4vYW5jaG9yLXRyZWUuanMnO1xuaW1wb3J0IHR5cGUgeyBNZW1vU3RvcmUgfSBmcm9tICcuL3NwYW4tc3VyZmFjZS5qcyc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUG9zdC1lZGl0IHJhbmdlIHJlY292ZXJ5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBTcGxpdCB3cml0dGVuIGNvbnRlbnQgaW50byB0aGUgbGluZXMgdG8gbG9jYXRlIG9uIGRpc2suIEEgc2luZ2xlIHRyYWlsaW5nXG4gKiBuZXdsaW5lIGlzIGRyb3BwZWQgc28gYFwiYVxcbmJcXG5cImAgYW5kIGBcImFcXG5iXCJgIGxvY2F0ZSBpZGVudGljYWxseTsgYW4gZW1wdHlcbiAqIChvciBuZXdsaW5lLW9ubHkpIHdyaXRlIGhhcyBubyBsb2NhdGFibGUgYmxvY2suXG4gKi9cbmZ1bmN0aW9uIHRvTmVlZGxlTGluZXMod3JpdHRlbjogc3RyaW5nKTogc3RyaW5nW10ge1xuICBpZiAod3JpdHRlbi5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgY29uc3QgdHJpbW1lZCA9IHdyaXR0ZW4uZW5kc1dpdGgoJ1xcbicpID8gd3JpdHRlbi5zbGljZSgwLCAtMSkgOiB3cml0dGVuO1xuICBpZiAodHJpbW1lZC5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgcmV0dXJuIHRyaW1tZWQuc3BsaXQoJ1xcbicpO1xufVxuXG4vKipcbiAqIFJlY292ZXIgdGhlIGxpbmUgcmFuZ2UgdGhhdCB3cml0dGVuIGNvbnRlbnQgbm93IG9jY3VwaWVzIGluIHRoZSBvbi1kaXNrIGZpbGUsXG4gKiBmb3IgYW5jaG9yaW5nIHRoZSB0b3VjaGVkIHJlZ2lvbiBhZnRlciBhbiBlZGl0IGhhcyBhbHJlYWR5IGFwcGxpZWQuXG4gKlxuICogVGhpcyBnZW5lcmFsaXplcyB0aGUgcHJlLWVkaXQgYGxvY2F0ZUNodW5rKClgIHRlY2huaXF1ZSBpblxuICogW2FwcGx5LXBhdGNoLnRzXSguL3BhY2thZ2VzL2FnZW50LWhvb2tzL3NyYy9jb2RleC9hcHBseS1wYXRjaC50cyNMMjUzLUwyODYpXG4gKiAocHJldmlvdXNseSBDb2RleC1vbmx5KSBpbnRvIGEgc2hhcmVkIHBvc3QtZWRpdCBwcmltaXRpdmUgYm90aCBoYXJuZXNzZXMgdXNlOlxuICogc3BsaXQgYHdyaXR0ZW5gIGFuZCBgb25EaXNrQ29udGVudGAgaW50byBsaW5lcyBhbmQgbG9jYXRlIHRoZSB3cml0dGVuIGJsb2NrIGFzXG4gKiBhIGNvbnRpZ3VvdXMgcnVuIGluc2lkZSB0aGUgb24tZGlzayBsaW5lcy5cbiAqXG4gKiAtIEEgc2luZ2xlIGNvbnRpZ3VvdXMgbWF0Y2ggeWllbGRzIGl0cyAxLWJhc2VkIGluY2x1c2l2ZSB7QGxpbmsgTGluZVJhbmdlfS5cbiAqIC0gV2hlbiB0aGUgYmxvY2sgaXMgYWJzZW50LCBvciBhcHBlYXJzIG1vcmUgdGhhbiBvbmNlIChjb250ZXh0IHRvIGRpc2FtYmlndWF0ZVxuICogICBpcyBub3QgYXZhaWxhYmxlIHBvc3QtZWRpdCksIHJlY292ZXJ5IGlzIGFtYmlndW91cyBhbmQgdGhlIHJlc3VsdCBkZWdyYWRlc1xuICogICB0byBgJ3dob2xlLWZpbGUnYCAodGhlIHNhbWUgZmFsbGJhY2sgYGxvY2F0ZUNodW5rKClgIHNpZ25hbHMgd2l0aCBgbnVsbGApLlxuICpcbiAqIE5ldmVyIHRocm93czogYW4gdW5sb2NhdGFibGUgd3JpdGUgaXMgYSBgJ3dob2xlLWZpbGUnYCBhbnN3ZXIsIG5vdCBhbiBlcnJvci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY292ZXJSYW5nZSh3cml0dGVuOiBzdHJpbmcsIG9uRGlza0NvbnRlbnQ6IHN0cmluZyk6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyB7XG4gIGNvbnN0IG5lZWRsZSA9IHRvTmVlZGxlTGluZXMod3JpdHRlbik7XG4gIGlmIChuZWVkbGUubGVuZ3RoID09PSAwKSByZXR1cm4gJ3dob2xlLWZpbGUnO1xuXG4gIGNvbnN0IGhheXN0YWNrID0gb25EaXNrQ29udGVudC5zcGxpdCgnXFxuJyk7XG4gIGNvbnN0IGxhc3QgPSBoYXlzdGFjay5sZW5ndGggLSBuZWVkbGUubGVuZ3RoO1xuICBjb25zdCBzdGFydHM6IG51bWJlcltdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDw9IGxhc3Q7IGkrKykge1xuICAgIGxldCBvayA9IHRydWU7XG4gICAgZm9yIChsZXQgaiA9IDA7IGogPCBuZWVkbGUubGVuZ3RoOyBqKyspIHtcbiAgICAgIGlmIChoYXlzdGFja1tpICsgal0gIT09IG5lZWRsZVtqXSkge1xuICAgICAgICBvayA9IGZhbHNlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKG9rKSB7XG4gICAgICBzdGFydHMucHVzaChpKTtcbiAgICAgIGlmIChzdGFydHMubGVuZ3RoID4gMSkgYnJlYWs7IC8vIGR1cGxpY2F0ZWQgXHUyMTkyIGFtYmlndW91cywgc3RvcCBlYXJseVxuICAgIH1cbiAgfVxuXG4gIGlmIChzdGFydHMubGVuZ3RoID09PSAxKSB7XG4gICAgcmV0dXJuIHsgc3RhcnQ6IHN0YXJ0c1swXSArIDEsIGVuZDogc3RhcnRzWzBdICsgbmVlZGxlLmxlbmd0aCB9O1xuICB9XG4gIHJldHVybiAnd2hvbGUtZmlsZSc7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggaW5wdXRcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFdoaWNoIGhhcm5lc3MgZXZlbnQgZmlyZWQsIGFzIHRoZSB0b3VjaCBjb3JlIHNlZXMgaXQuIFRoZSBjb3JlIGJyYW5jaGVzIG9uXG4gKiB0aGlzOiBgd3JpdGVgIGhlYWxzIHBvc2l0aW9uYWwgZHJpZnQgaW4gdGhlIHdvcmtpbmcgdHJlZSBhbmQgbWF5IHN1cmZhY2UgYVxuICogbWVyZ2VkIGJsb2NrOyBgcmVhZGAgbmV2ZXIgbXV0YXRlcyB0aGUgdHJlZSBhbmQgZmlsdGVycyBwb3NpdGlvbmFsIHN0YXR1c2VzXG4gKiBvdXQgb2Ygd2hhdCBpdCBzdXJmYWNlcy5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hFdmVudEtpbmQgPSAncmVhZCcgfCAnd3JpdGUnO1xuXG4vKiogRmllbGRzIHNoYXJlZCBieSBldmVyeSB0b3VjaCwgcmVnYXJkbGVzcyBvZiBraW5kLiAqL1xuaW50ZXJmYWNlIFRvdWNoSW5wdXRCYXNlIHtcbiAgLyoqIEhhcm5lc3Mgc2Vzc2lvbiBpZCBcdTIwMTQga2V5cyB0aGUgcGVyLXNlc3Npb24gY2FkZW5jZSB7QGxpbmsgTWVtb1N0b3JlfS4gKi9cbiAgc2Vzc2lvbklkOiBzdHJpbmc7XG4gIC8qKlxuICAgKiBXb3JraW5nIGRpcmVjdG9yeSB0aGUgdG9vbCByYW4gaW4sIHVzZWQgdG8gYm91bmQgdGhlIHRvdWNoIHRvIHRoZSBDV0QgcmVwb1xuICAgKiB2aWEgYHJlc29sdmVUb3VjaFNjb3BlKClgIGJlZm9yZSBhbnkgc3BhbiBpbnZvY2F0aW9uLlxuICAgKi9cbiAgY3dkOiBzdHJpbmc7XG4gIC8qKiBBYnNvbHV0ZSwgY2Fub25pY2FsaXplZCBwYXRoIG9mIHRoZSB0b3VjaGVkIGZpbGUuICovXG4gIGZpbGVQYXRoOiBzdHJpbmc7XG59XG5cbi8qKiBBIHJlYWQgdG91Y2ggKENsYXVkZSBgUmVhZGAsIG9yIGEgcmVhZC1zaGFwZWQgQ29kZXggZXZlbnQpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaFJlYWRJbnB1dCBleHRlbmRzIFRvdWNoSW5wdXRCYXNlIHtcbiAga2luZDogJ3JlYWQnO1xuICAvKipcbiAgICogMS1iYXNlZCBzdGFydGluZyBsaW5lIG9mIHRoZSByZWFkLCBmcm9tIHRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wncyBgb2Zmc2V0YFxuICAgKiBpbnB1dC4gYHVuZGVmaW5lZGAgd2hlbiB0aGUgcmVhZCBoYWQgbm8gYG9mZnNldGAgKHJlYWRzIGZyb20gbGluZSAxKS5cbiAgICovXG4gIG9mZnNldD86IG51bWJlcjtcbiAgLyoqXG4gICAqIExpbmUgY291bnQgb2YgdGhlIHJlYWQsIGZyb20gdGhlIENsYXVkZSBgUmVhZGAgdG9vbCdzIGBsaW1pdGAgaW5wdXQuXG4gICAqIGB1bmRlZmluZWRgIHdoZW4gdGhlIHJlYWQgaGFkIG5vIGBsaW1pdGAgXHUyMDE0IHNlZSB7QGxpbmsgREVGQVVMVF9SRUFEX0xJTUlUfVxuICAgKiBmb3IgaG93IHRoZSByYW5nZSBpcyBjb21wdXRlZCBpbiB0aGF0IGNhc2UuXG4gICAqL1xuICBsaW1pdD86IG51bWJlcjtcbn1cblxuLyoqIEEgd3JpdGUgdG91Y2ggKENsYXVkZSBgRWRpdGAvYFdyaXRlYCwgQ29kZXggYGFwcGx5X3BhdGNoYCwgb3IgYSB0cmFuc2xhdGVkIEJhc2ggd3JpdGUgc3BhbikuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoV3JpdGVJbnB1dCBleHRlbmRzIFRvdWNoSW5wdXRCYXNlIHtcbiAga2luZDogJ3dyaXRlJztcbiAgLyoqXG4gICAqIFRoZSBjb250ZW50IGp1c3Qgd3JpdHRlbiB0byBgZmlsZVBhdGhgLCBmZWQgdG8ge0BsaW5rIHJlY292ZXJSYW5nZX0gdG9cbiAgICogcmUtYW5jaG9yIHRoZSB0b3VjaGVkIHJlZ2lvbiBhZ2FpbnN0IHRoZSBoZWFsZWQgb24tZGlzayBmaWxlLiBGb3IgYVxuICAgKiB3aG9sZS1maWxlIGNyZWF0ZSB0aGlzIGlzIHRoZSBlbnRpcmUgZmlsZSBib2R5OyBhbiBlbXB0eSBzdHJpbmcgbWVhbnNcbiAgICogXCJubyBsb2NhdGFibGUgYmxvY2tcIiBhbmQgdGhlIHRvdWNoIGlzIHNjb3BlZCBmaWxlLXdpZGUuXG4gICAqL1xuICB3cml0dGVuOiBzdHJpbmc7XG4gIC8qKlxuICAgKiBFeGFjdCBwb3N0LWVkaXQgcmFuZ2Ugd2hlbiBzdGF0aWNhbGx5IGtub3duIChzZWQgLWkgbnVtZXJpYyBhZGRyZXNzZXMsXG4gICAqIHBhdGNoIGh1bmsgdW5pb25zKTsgYnlwYXNzZXMge0BsaW5rIHJlY292ZXJSYW5nZUZyb21EaXNrfSAocGxhbiBcdTAwQTczXG4gICAqIHN0ZXAgMykuXG4gICAqL1xuICByYW5nZT86IExpbmVSYW5nZTtcbiAgLyoqXG4gICAqIFRoZSBmaWxlJ3MgZXhwZWN0ZWQgcG9zdC1jb21tYW5kIHN0YXRlOyB0aGUgd3JpdGUgcGF0aCBnYXRlcyBvbiBpdCBiZWZvcmVcbiAgICogaW52b2tpbmcgYW55IGV4ZWN1dG9yIChwbGFuIFx1MDBBNzMgc3RlcCAxKS4gQWJzZW50IG1lYW5zIGAnZXhpc3RzJ2AgXHUyMDE0IHRoZVxuICAgKiBFZGl0L1dyaXRlIGFuZCBhcHBseV9wYXRjaCBwYXRocycgZGVmYXVsdC5cbiAgICovXG4gIHRhcmdldFN0YXRlPzogJ2V4aXN0cycgfCAnYWJzZW50JztcbiAgLyoqXG4gICAqIFN0YXRpY2FsbHkga25vd2FibGUgZXhwZWN0ZWQgcG9zdC1jb250ZW50LCB2ZXJpZmllZCBiZWZvcmUgYW55IGV4ZWN1dG9yXG4gICAqIGNhbGwgKHBsYW4gXHUwMEE3MyBzdGVwIDFiKS4gYGNvbnRlbnRgIGNvbXBhcmVzIHRoZSBvbi1kaXNrIHN0YXRlIGFmdGVyIHRoZVxuICAgKiBjb21tYW5kIHJhbjsgYHJlYWxEZWxldGVgIGlzIGRlbGV0ZS1vbmx5IFx1MjAxNCB0aGUgcGF0aCBtdXN0IGFsc28gYmVcbiAgICogaW5kZXgtdHJhY2tlZCBvciBzcGFubmVkIChwcm9iZXMgY2FjaGVkIHBlciBjb21tYW5kKS5cbiAgICovXG4gIHBvc3RTdGF0ZT86IHtcbiAgICAvKiogYGV4YWN0YDogZmlsZSBieXRlcyBlcXVhbDsgYHN1ZmZpeGA6IGZpbGUgY29udGVudCBlbmRzIHdpdGggaXQ7IGBlbXB0eWA6IHplcm8gYnl0ZXM7IGBzaXplYDogYnl0ZSBjb3VudC4gKi9cbiAgICBjb250ZW50PzogVG91Y2hQb3N0Q29udGVudDtcbiAgICAvKiogZGVsZXRlLW9ubHk6IHRoZSBwYXRoIG11c3QgYWxzbyBiZSBpbmRleC10cmFja2VkIG9yIHNwYW5uZWQgKHByb2JlcyBjYWNoZWQgcGVyIGNvbW1hbmQpLiAqL1xuICAgIHJlYWxEZWxldGU/OiBib29sZWFuO1xuICB9O1xuICAvKipcbiAgICogY3AvaW5zdGFsbCBkZXN0aW5hdGlvbi12cy1zb3VyY2UgdmVyaWZpY2F0aW9uIChwbGFuIFx1MDBBNzMgc3RlcCAxYik6IGFcbiAgICogc3RpbGwtcHJlc2VudCBzb3VyY2UgbXVzdCBieXRlLWVxdWFsIHRoZSBkZXN0aW5hdGlvbjsgYW4gYWJzZW50IHNvdXJjZVxuICAgKiBhcHBsaWVzIHRoZSBhYnNlbnQtc291cmNlIHJ1bGUgKHJlYWwgKyBhYnNlbmNlIGV4cGxhaW5lZCBieSBhIGxhdGVyXG4gICAqIHNhbWUtcGF0aCBkZWNpc2l2ZVBhc3MgXHUyMDE0IHRoZSBkcml2ZXIncyBwYXNzLUEgaG9sZCkuIFNldCBieSB0aGVcbiAgICogYHJ1bkJhc2hUb3VjaGVzYCBkcml2ZXIgb24gcGFpcmVkIGNwIGNyZWF0ZS1vdmVyd3JpdGUgdG91Y2hlczsgbmV2ZXIgc2V0XG4gICAqIGJ5IGFkYXB0ZXJzLiBgaW5zdGFsbCAtc2AvYC0tc3RyaXBgIGlzIGRlbGliZXJhdGVseSBuZXZlciBwYWlyZWQgXHUyMDE0XG4gICAqIHN0cmlwcGVkIG91dHB1dCBuZXZlciBlcXVhbHMgdGhlIHNvdXJjZSwgc28gaW5zdGFsbCBkZXN0cyBnYXRlXG4gICAqIGV4aXN0ZW5jZS1vbmx5LlxuICAgKi9cbiAgc291cmNlUGF0aD86IHN0cmluZztcbiAgLyoqXG4gICAqIG12L2dpdCBtdi9wYXRjaCByZW5hbWUgc291cmNlIHZlcmlmaWNhdGlvbiAocGxhbiBcdTAwQTczIHN0ZXAgMWMpOiB0aGVcbiAgICogZGVzdGluYXRpb24gZmlyZXMgb25seSB3aGVuIGl0cyBzb3VyY2UgcGFzc2VkIHRoZSBkZWxldGUtcmVhbGl0eSBwcm9iZSBcdTIwMTRcbiAgICogYSBwaGFudG9tIHNvdXJjZSBtZWFucyB0aGUgbW92ZSBmYWlsZWQgYW5kIGEgcHJlLWV4aXN0aW5nIGRlc3RpbmF0aW9uIHdhc1xuICAgKiBuZXZlciB0b3VjaGVkLiBObyBjb250ZW50IGNvbXBhcmlzb24gKHBhdGNoIHJlbmFtZXMgbWF5IGNoYW5nZSBjb250ZW50KS5cbiAgICogU2V0IGJ5IHRoZSBgcnVuQmFzaFRvdWNoZXNgIGRyaXZlciBvbiBwYWlyZWQgcmVuYW1lLWNvcHkgdG91Y2hlcy5cbiAgICovXG4gIHJlbmFtZVNvdXJjZVBhdGg/OiBzdHJpbmc7XG59XG5cbi8qKiBUaGUgaGFybmVzcy1hZ25vc3RpYyB0b3VjaCB0aGUgY29yZSBjb25zdW1lcy4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoSW5wdXQgPSBUb3VjaFJlYWRJbnB1dCB8IFRvdWNoV3JpdGVJbnB1dDtcblxuLyoqXG4gKiBBIHN0YXRpY2FsbHkga25vd2FibGUgZXhwZWN0ZWQgcG9zdC1jb250ZW50IChwbGFuIFx1MDBBNzMgc3RlcCAxYik6IGBleGFjdGAgXHUyMDE0XG4gKiBmaWxlIGJ5dGVzIGVxdWFsOyBgc3VmZml4YCBcdTIwMTQgZmlsZSBjb250ZW50IGVuZHMgd2l0aCBpdDsgYGVtcHR5YCBcdTIwMTQgemVyb1xuICogYnl0ZXM7IGBzaXplYCBcdTIwMTQgYnl0ZSBjb3VudC5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hQb3N0Q29udGVudCA9IHsgZXhhY3Q6IHN0cmluZyB9IHwgeyBzdWZmaXg6IHN0cmluZyB9IHwgeyBlbXB0eTogdHJ1ZSB9IHwgeyBzaXplOiBudW1iZXIgfTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQb3N0LXN0YXRlIHdyaXRlIGdhdGUgKHBsYW4gXHUwMEE3MyBzdGVwIDEpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBUaGUgb3V0Y29tZSBvZiB7QGxpbmsgZXZhbHVhdGVXcml0ZUdhdGV9OiBhIGRlY2lzaXZlIHBhc3MvZmFpbCBjYXJyaWVzXG4gKiB2ZXJkaWN0IHdlaWdodCAoY29udGVudCB2ZXJpZmllZCwgb3IgYWJzZW5jZSArIGRlbGV0ZS1yZWFsaXR5IHZlcmlmaWVkKTtcbiAqIGAnaW5jb25jbHVzaXZlJ2AgaXMgZXZlcnl0aGluZyBlbHNlIFx1MjAxNCB0aGUgZXhpc3RlbmNlLWdhdGVkIGZhbWlsaWVzIChzZWQgLWksXG4gKiBwYXRjaC9naXQgYXBwbHksIGZvcm1hdHRlcnMsIHJlc3RvcmUvY2hlY2tvdXQpIHdob3NlIGV4aXN0ZW5jZSBwYXNzIHByb3Zlc1xuICogbm90aGluZywgYW5kIHByb2JlLWluYXBwbGljYWJsZSBjYXNlcyAocGhhbnRvbSBvciB1bnRyYWNrZWQtdW5zcGFubmVkXG4gKiBkZWxldGVzLCBkaXJlY3RvcnkgdGFyZ2V0cykuIGAncGVuZGluZydgIGlzIHRoZSBkcml2ZXIncyBhYnNlbnQtc291cmNlIGhvbGRcbiAqIChwbGFuIFx1MDBBNzMgc3RlcCAyKTogYW4gYWJzZW50IGNwIHNvdXJjZSB0aGF0IHBhc3NlZCB0aGUgcmVhbGl0eSBwcm9iZSBjYW5ub3RcbiAqIGRlY2lkZSBpdHMgZGVzdGluYXRpb24gdW50aWwgdGhlIHBhc3MtQSBleHBsYW5hdGlvbiBtYXAgaXMgY29tcGxldGUuXG4gKi9cbmV4cG9ydCB0eXBlIFdyaXRlR2F0ZU91dGNvbWUgPSAnZGVjaXNpdmVQYXNzJyB8ICdkZWNpc2l2ZUZhaWwnIHwgJ2luY29uY2x1c2l2ZScgfCAncGVuZGluZyc7XG5cbi8qKlxuICogUGVyLWNvbW1hbmQgcmVhbGl0eSBwcm9iZSBjYWNoZSAocGxhbiBcdTAwQTczIHN0ZXAgMWMsIHJvdW5kLTMpOiB0d28gbGF6eSxcbiAqIGJhdGNoZWQgcHJvYmVzIFx1MjAxNCBvbmUgYGdpdCBscy1maWxlcyAtLWVycm9yLXVubWF0Y2hgICsgYGdpdCBzcGFuIGxpc3RcbiAqIC0tcG9yY2VsYWluYCBwYWlyIGZvciB0aGUgZGVsZXRlLXJlYWxpdHkgbWVtYmVyc2hpcCwgYW5kIG9uZSBgZ2l0IHN0YXR1c1xuICogLS1wb3JjZWxhaW5gIGJhdGNoIGZvciB0aGUgd29ya2luZy10cmVlLXZzLWluZGV4IG1hcmsgXHUyMDE0IG5ldmVyIG9uZVxuICogc3VicHJvY2VzcyBwZXIgcGF0aCwgbWVtYmVyc2hpcCBmcm9tIHByaW50ZWQgcm93cy4gVGhlIGBydW5CYXNoVG91Y2hlc2BcbiAqIGRyaXZlciBzZWVkcyB0aGUgZGVsZXRlLXJlYWxpdHkgaGFsZiB3aXRoIGV2ZXJ5IGFic2VudCB0YXJnZXQgYW5kXG4gKiBjcC9pbnN0YWxsIHNvdXJjZSBvZiB0aGUgY29tcG91bmQgYW5kIHRoZSBzdGF0dXMgaGFsZiB3aXRoIHRoZVxuICogbGF0ZXItcmVjcmVhdGUgZXhwbGFuYXRpb24ncyBjYW5kaWRhdGUgcGF0aHMsIGFuZCBzaGFyZXMgdGhlIGNhY2hlIGludG9cbiAqIHBhc3MgQiBzbyBzdXJ2aXZpbmcgZGVsZXRlcyByZS1nYXRlIHdpdGhvdXQgcmUtcHJvYmluZy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBSZWFsaXR5UHJvYmVDYWNoZSB7XG4gIC8qKiBEaXN0aW5jdCBhYnNvbHV0ZSBwYXRocyB0byBwcm9iZSwgaW4gZmlyc3Qtc2VlbiBvcmRlci4gKi9cbiAgcGF0aHM6IHN0cmluZ1tdO1xuICAvKiogTGF6eTogYWJzb2x1dGUgcGF0aHMgY29uZmlybWVkIGluZGV4LXRyYWNrZWQgb3Igc3Bhbm5lZCwgY29tcHV0ZWQgb25jZS4gKi9cbiAgcmVhbFBhdGhzOiBTZXQ8c3RyaW5nPiB8IG51bGw7XG4gIC8qKlxuICAgKiBUaGUgbGF0ZXItcmVjcmVhdGUgZXhwbGFuYXRpb24ncyBwcm9iZSBzY29wZSAocGxhbiBcdTAwQTczIHN0ZXAgMik6IGRpc3RpbmN0XG4gICAqIGRlbGV0ZSBwYXRocyBhIGxhdGVyIGNvbW1hbmQgb2YgdGhlIGNvbXBvdW5kIGNhbiByZS1jcmVhdGUgd2l0aCBhXG4gICAqIGZpbGUtcHJvZHVjaW5nIHdyaXRlLCBpbiBmaXJzdC1zZWVuIG9yZGVyLlxuICAgKi9cbiAgY2hhbmdlZENhbmRpZGF0ZXM6IHN0cmluZ1tdO1xuICAvKiogTGF6eTogY2FuZGlkYXRlcyBjYXJyeWluZyBhbnkgdHJhY2tlZCBzdGF0dXMgcm93IChpbmRleCBvciB3b3JrdHJlZSBjb2x1bW4pLCBjb21wdXRlZCBvbmNlLiAqL1xuICBjaGFuZ2VkUGF0aHM6IFNldDxzdHJpbmc+IHwgbnVsbDtcbn1cblxuLyoqIENyZWF0ZSBhIHBlci1jb21tYW5kIHByb2JlIGNhY2hlIGZvciB0aGUgZ2l2ZW4gYWJzb2x1dGUgcGF0aHMuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlUmVhbGl0eVByb2JlQ2FjaGUoXG4gIHBhdGhzOiBJdGVyYWJsZTxzdHJpbmc+LFxuICBjaGFuZ2VkQ2FuZGlkYXRlczogSXRlcmFibGU8c3RyaW5nPiA9IFtdXG4pOiBSZWFsaXR5UHJvYmVDYWNoZSB7XG4gIHJldHVybiB7XG4gICAgcGF0aHM6IFsuLi5uZXcgU2V0KHBhdGhzKV0sXG4gICAgcmVhbFBhdGhzOiBudWxsLFxuICAgIGNoYW5nZWRDYW5kaWRhdGVzOiBbLi4ubmV3IFNldChjaGFuZ2VkQ2FuZGlkYXRlcyldLFxuICAgIGNoYW5nZWRQYXRoczogbnVsbFxuICB9O1xufVxuXG4vKiogV2hldGhlciB0aGUgcGF0aCBleGlzdHMgb24gZGlzayAoYW55IG5vZGUga2luZCk7IGBmYWxzZWAgb24gYW55IHN0YXQgZmFpbHVyZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmaWxlRXhpc3RzKGFic1BhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIGZzLnN0YXRTeW5jKGFic1BhdGgpO1xuICAgIHJldHVybiB0cnVlO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqIFdoZXRoZXIgdGhlIHBhdGggaXMgYSByZWd1bGFyIGZpbGUgXHUyMDE0IGEgZGlyZWN0b3J5IHRhcmdldCBmYWlscyB0aGUgYCdleGlzdHMnYCBnYXRlLiAqL1xuZnVuY3Rpb24gaXNGaWxlT25EaXNrKGFic1BhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIHJldHVybiBmcy5zdGF0U3luYyhhYnNQYXRoKS5pc0ZpbGUoKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKlxuICogVmVyaWZ5IGEgc3RhdGljYWxseSBrbm93YWJsZSBwb3N0LWNvbnRlbnQgZXhwZWN0YXRpb24gYWdhaW5zdCB0aGUgb24tZGlza1xuICogZmlsZSAocGxhbiBcdTAwQTczIHN0ZXAgMWIpLiBBbnkgcmVhZCBmYWlsdXJlIGlzIGEgbWlzbWF0Y2gsIG5ldmVyIGFuIGVycm9yLlxuICovXG5mdW5jdGlvbiBjb250ZW50TWF0Y2hlcyhwb3N0OiBUb3VjaFBvc3RDb250ZW50LCBmaWxlUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgaWYgKCdleGFjdCcgaW4gcG9zdCkgcmV0dXJuIGZzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCwgJ3V0ZjgnKSA9PT0gcG9zdC5leGFjdDtcbiAgICBpZiAoJ3N1ZmZpeCcgaW4gcG9zdCkge1xuICAgICAgLy8gVGhlIHNoZWxsIGFwcGVuZHMgdGhlIGJvZHkgcGx1cyBpdHMgdGVybWluYXRpbmcgbmV3bGluZTsgdGhlIGhlcmVkb2NcbiAgICAgIC8vIGdyYW1tYXIgc3RyaXBzIGV4YWN0bHkgdGhhdCBvbmUgYFxcbmAgZnJvbSBgc3Bhbi53cml0dGVuYFxuICAgICAgLy8gKHBhcnNlLWNvbW1hbmQudHMgaGVyZWRvYyBib2R5IGV4dHJhY3Rpb24pLCBzbyBhIGZpbGUgZW5kaW5nXG4gICAgICAvLyBgd3JpdHRlblxcbmAgaXMgdGhlIHNhbWUgYXBwZW5kZWQgdGV4dCBhcyBgd3JpdHRlbmAgXHUyMDE0IGFjY2VwdCBib3RoLlxuICAgICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCwgJ3V0ZjgnKTtcbiAgICAgIHJldHVybiBjb250ZW50LmVuZHNXaXRoKHBvc3Quc3VmZml4KSB8fCBjb250ZW50LmVuZHNXaXRoKGAke3Bvc3Quc3VmZml4fVxcbmApO1xuICAgIH1cbiAgICBpZiAoJ2VtcHR5JyBpbiBwb3N0KSByZXR1cm4gZnMuc3RhdFN5bmMoZmlsZVBhdGgpLnNpemUgPT09IDA7XG4gICAgcmV0dXJuIGZzLnN0YXRTeW5jKGZpbGVQYXRoKS5zaXplID09PSBwb3N0LnNpemU7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBkZWxldGUtcmVhbGl0eSBwcm9iZSAocGxhbiBcdTAwQTczIHN0ZXAgMWMpOiBsYXppbHkgcnVuIHRoZSB0d28gcGVyLWNvbW1hbmRcbiAqIGJhdGNoZXMgYW5kIGNhY2hlIHRoZSBjb25maXJtZWQtcmVhbCBwYXRoIHNldC4gTWVtYmVyc2hpcCBjb21lcyBmcm9tIHRoZVxuICogcHJpbnRlZCByb3dzLCBub3QgdGhlIGV4aXQgY29kZSBcdTIwMTQgYGdpdCBscy1maWxlcyAtLWVycm9yLXVubWF0Y2hgIHByaW50c1xuICogZXZlcnkgdHJhY2tlZCBwYXRoIGV2ZW4gd2hlbiBpdCBleGl0cyBub256ZXJvIChhbnkgbWlzc2luZyBwYXRoKSwgYW5kXG4gKiBgZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbmAgcHJpbnRzIG5vdGhpbmcgZm9yIHBoYW50b20gb3Iga25vd24tYnV0LVxuICogdW5zcGFubmVkIHBhdGhzIChleGl0IDAgd2l0aCBcIk5vIHNwYW5zIG1hdGNoIHRoZSBmaWx0ZXJzXCIpLiBBIHBsYWluLWBybWAnZFxuICogdHJhY2tlZCBmaWxlIGtlZXBzIGl0cyBpbmRleCBlbnRyeSAobHMtZmlsZXMgZXhpdCAwIFx1MjAxNCB0aGUgcHJvYmUgZmlyZXMpO1xuICogYGdpdCBybWAgcmVtb3ZlcyBpdCAobHMtZmlsZXMgMTI4KSBzbyBvbmx5IHNwYW5uZWQgZmlsZXMgc3RheSByZWFsLiBBXG4gKiBwaGFudG9tIG9yIHVudHJhY2tlZC11bnNwYW5uZWQgcGF0aCBmYWlscyBib3RoIHByb2JlcyBcdTIwMTQgdGhlIGRlbGV0ZSBkZWdyYWRlc1xuICogdG8gYCdpbmNvbmNsdXNpdmUnYCBhbmQgbmV2ZXIgZmlyZXMuIEZhaWwtc2FmZTogYW4gdW5yZXNvbHZhYmxlIHJlcG8gb3IgYVxuICogcHJvYmUgZmFpbHVyZSB5aWVsZHMgYW4gZW1wdHkgc2V0LCBuZXZlciBhbiBlcnJvci5cbiAqL1xuZnVuY3Rpb24gcmVhbFBhdGhzKGNhY2hlOiBSZWFsaXR5UHJvYmVDYWNoZSwgY3dkOiBzdHJpbmcpOiBTZXQ8c3RyaW5nPiB7XG4gIGlmIChjYWNoZS5yZWFsUGF0aHMgIT09IG51bGwpIHJldHVybiBjYWNoZS5yZWFsUGF0aHM7XG4gIGNvbnN0IHJlYWwgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgaWYgKGNhY2hlLnBhdGhzLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgIGlmIChyZXBvUm9vdCAhPT0gbnVsbCkge1xuICAgICAgY29uc3QgcmVscyA9IGNhY2hlLnBhdGhzLm1hcCgocCkgPT4gcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3QsIHApKTtcbiAgICAgIGNvbnN0IGNhcHR1cmUgPSAoYXJnczogc3RyaW5nW10pOiBzdHJpbmcgfCBudWxsID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICByZXR1cm4gZXhlY0ZpbGVTeW5jKCdnaXQnLCBhcmdzLCB7XG4gICAgICAgICAgICBjd2Q6IHJlcG9Sb290LFxuICAgICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICAgIHRpbWVvdXQ6IERFRkFVTFRfVElNRU9VVF9NU1xuICAgICAgICAgIH0pO1xuICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICBjb25zdCBzdGRvdXQgPSAoZXJyIGFzIHsgc3Rkb3V0Pzogc3RyaW5nIH0pLnN0ZG91dDtcbiAgICAgICAgICByZXR1cm4gdHlwZW9mIHN0ZG91dCA9PT0gJ3N0cmluZycgPyBzdGRvdXQgOiBudWxsO1xuICAgICAgICB9XG4gICAgICB9O1xuICAgICAgY29uc3QgbHNGaWxlcyA9IGNhcHR1cmUoWydscy1maWxlcycsICctLWVycm9yLXVubWF0Y2gnLCAnLS0nLCAuLi5yZWxzXSk7XG4gICAgICBpZiAobHNGaWxlcyAhPT0gbnVsbCkge1xuICAgICAgICBmb3IgKGNvbnN0IGxpbmUgb2YgbHNGaWxlcy5zcGxpdCgnXFxuJykpIHtcbiAgICAgICAgICBjb25zdCByZWwgPSBsaW5lLnRyaW0oKTtcbiAgICAgICAgICBpZiAocmVsLmxlbmd0aCA+IDApIHJlYWwuYWRkKGpvaW4ocmVwb1Jvb3QsIHJlbCkpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBjb25zdCBzcGFuTGlzdCA9IGNhcHR1cmUoWydzcGFuJywgJ2xpc3QnLCAnLS1wb3JjZWxhaW4nLCAuLi5yZWxzXSk7XG4gICAgICBpZiAoc3Bhbkxpc3QgIT09IG51bGwpIHtcbiAgICAgICAgZm9yIChjb25zdCByb3cgb2YgcGFyc2VQb3JjZWxhaW4oc3Bhbkxpc3QpKSByZWFsLmFkZChqb2luKHJlcG9Sb290LCByb3cucGF0aCkpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICBjYWNoZS5yZWFsUGF0aHMgPSByZWFsO1xuICByZXR1cm4gcmVhbDtcbn1cblxuLyoqXG4gKiBUaGUgd29ya2luZy10cmVlLXZzLWluZGV4IHByb2JlIChwbGFuIFx1MDBBNzMgc3RlcCAyLCByb3VuZC0zOyB3aWRlbmVkIHJvdW5kLTQpOlxuICogbGF6aWx5IHJ1biBvbmUgYGdpdCBzdGF0dXMgLS1wb3JjZWxhaW4gLXpgIGJhdGNoIG92ZXIgdGhlIHNlZWRlZCBjYW5kaWRhdGVzXG4gKiBhbmQgY2FjaGUgdGhlIHNldCBjYXJyeWluZyBhbnkgdHJhY2tlZCBzdGF0dXMgcm93IFx1MjAxNCB0aGUgcmUtY3JlYXRlJ3MgbWFyay5cbiAqIFRoZSBkcml2ZXIgY29uc3VsdHMgaXQgYmVmb3JlIGV4cGxhaW5pbmcgYSBkZWxldGUncyBkZWNpc2l2ZUZhaWwgKFwiZmlsZVxuICogcHJlc2VudCwgc28gdGhlIGRlbGV0ZSBkaWRuJ3QgaGFwcGVuXCIpIGJ5IGEgbGF0ZXIgc2FtZS1wYXRoIHdyaXRlOyBhXG4gKiBkZWNpc2l2ZUZhaWwgaW1wbGllcyB0aGUgcGF0aCBFWElTVFMgYXQgY29tcG91bmQgZW5kLCBzbyBldmVyeSByb3cgc2hhcGVcbiAqIGJlbG93IGlzIGp1ZGdlZCBhZ2FpbnN0IHRoYXQgcmVhbGl0eS5cbiAqXG4gKiBSb3VuZC0zIHJlYWQgb25seSB0aGUgWSAod29ya3RyZWUpIGNvbHVtbiwgdHJlYXRpbmcgXCJ3b3JraW5nIHRyZWUgPT1cbiAqIGluZGV4XCIgYXMgcHJvb2YgdGhlIHJlLWNyZWF0ZSB3cml0ZSBuZXZlciByYW4uIFRoYXQgcHJvYmUgc3RhdGUgaXMgc2hhcmVkXG4gKiBieSB0d28gcmVhbGl0aWVzIHRoZSBydWxlIGNvbmZsYXRlZDogKGEpIHRoZSB3cml0ZSBnZW51aW5lbHkgbmV2ZXIgcmFuIFx1MjAxNFxuICogYSBmYWlsZWQgcm0gc2hvcnQtY2lyY3VpdHMgdGhlIGAmJmAgY2hhaW4sIHRoZSBmaWxlIHN0aWxsIG1hdGNoZXMgSEVBRCBhbmRcbiAqIHRoZSBpbmRleCwgYW5kIE5PIHJvdyBleGlzdHMgXHUyMDE0IGFuZCAoYikgdGhlIHdyaXRlIHJhbiBBTkQgd2FzIHN0YWdlZCBpbiB0aGVcbiAqIHNhbWUgY29tcG91bmQgKGBybSBmICYmIHBhdGNoIDwgZCAmJiBnaXQgYWRkIGZgIFx1MjE5MiBgTSBgIHJvdywgYmxhbmsgWSk6IHRoZVxuICogcm91bmQtNCBmaW5kaW5nLCBhIHZlcmlmaWVkIHdyaXRlIGxlZnQgc2lsZW50LiBUaGUgcnVsZSBub3cgbWFya3MgQU5ZXG4gKiB0cmFja2VkIHN0YXR1cyByb3c6IHRoZSBYIChpbmRleCkgY29sdW1uIG9yIHRoZSBZICh3b3JrdHJlZSkgY29sdW1uXG4gKiBub24tYmxhbmsuIGAtLXVudHJhY2tlZC1maWxlcz1ub2Agc3VwcHJlc3NlcyBgPz8gYCByb3dzLCBhbmQgYD9gL2AhYCBhcmVcbiAqIHJlamVjdGVkIGRlZmVuc2l2ZWx5IFx1MjAxNCBhbiB1bnRyYWNrZWQgb3IgaWdub3JlZCBwYXRoIGNhcnJpZXMgbm8gaW5kZXhcbiAqIGJhc2VsaW5lLCBzbyBpdCBjYW4gbmV2ZXIgY291bnQgYXMgcmUtY3JlYXRlZCAoZmFpbCBjbG9zZWQpLlxuICpcbiAqIFBlci1jb2x1bW4gcmVhc29uaW5nIGFnYWluc3QgdGhlIGRlbGV0ZS1zcGFuIHJlYWxpdHkgKHRoZSBwYXRoIGlzIHRyYWNrZWRcbiAqIGluIHRoZSBpbmRleCBwZXIgdGhlIGRlbGV0ZS1yZWFsaXR5IHByb2JlLCBhbmQgZXhpc3RzIGF0IGNvbXBvdW5kIGVuZCk6XG4gKiAtIGBNIGAgLyBgQSBgIChpbmRleCBkaWZmZXJzIGZyb20gSEVBRCwgd29ya3RyZWUgbWF0Y2hlcyB0aGUgaW5kZXgpOiB0aGVcbiAqICAgY29tcG91bmQgc3RhZ2VkIGEgd3JpdGUgKGBnaXQgYWRkYDsgYEEgYCB3aGVuIHRoZSBwYXRoJ3MgYmFzZWxpbmUgd2FzXG4gKiAgIGl0c2VsZiBhIHN0YWdlZCBhZGQsIHNvIG5ldmVyIGluIEhFQUQpIFx1MjAxNCBjYXNlIChiKSwgdGhlIHJlLWNyZWF0ZSBpc1xuICogICB2ZXJpZmllZCByZWFsIGluIHRoZSBpbmRleC5cbiAqIC0gYFIgYCAoYSBzdGFnZWQgcmVuYW1lIHdob3NlIGRlc3RpbmF0aW9uIGlzIHRoZSBwYXRoKTogc2FtZSBcdTIwMTQgdGhlIGluZGV4XG4gKiAgIHJlY29yZHMgdGhlIHdyaXRlLlxuICogLSBgRCBgIChpbmRleCBkZWxldGVkLCB3b3JrdHJlZSBtYXRjaGVzKTogdGhlIGZpbGUgaXMgZWl0aGVyIGFic2VudFxuICogICAobWF0Y2hpbmcgdGhlIHN0YWdlZCBkZWxldGUgXHUyMDE0IG5vIGRlY2lzaXZlRmFpbCwgdGhlIGF4aXMgaXMgbmV2ZXJcbiAqICAgY29uc3VsdGVkKSBvciByZWNyZWF0ZWQtYnV0LXVudHJhY2tlZCBhZnRlciBhIGBnaXQgcm1gIChoaWRkZW4gYnlcbiAqICAgYC0tdW50cmFja2VkLWZpbGVzPW5vYCwgdGhlIHJvdyBwZXJzaXN0cykgXHUyMDE0IGEgcHJlc2VudCBmaWxlIG1lYW5zIHRoZVxuICogICBjb21wb3VuZCB3cm90ZSBpdCwgc28gaXQgY291bnRzLlxuICogLSBZLWNvbHVtbiByb3dzIChgIE1gLCBgTU1gLCBgIERgLCBgQU1gLi4uKTogdGhlIHJvdW5kLTMgcnVsZSB1bmNoYW5nZWQgXHUyMDE0XG4gKiAgIHRoZSB3b3JrdHJlZSBkZW1vbnN0cmFibHkgZGlmZmVycyBmcm9tIHRoZSBpbmRleC5cbiAqXG4gKiBDYXNlIChhKSBzdGlsbCB5aWVsZHMgTk8gcm93ICh0aGUgZmlsZSBtYXRjaGVzIEhFQUQgXHUyMDE0IHRoZSBjaGFpblxuICogc2hvcnQtY2lyY3VpdGVkIGJlZm9yZSBhbnl0aGluZyBjaGFuZ2VkKSwgc28gdGhlIGdlbnVpbmUgc3VwcHJlc3Npb24gaG9sZHMuXG4gKiBUaGUgb25lIHJlc2lkdWFsIGNsYXNzIChkb2N1bWVudGVkIGluIHRoZSBheGlzJ3MgY2FsbCBzaXRlKTogYSBQUkUtRVhJU1RJTkdcbiAqIHVuY29tbWl0dGVkIG9yIHN0YWdlZCBjaGFuZ2Ugb24gdGhlIGRlbGV0ZWQgcGF0aCBtYXNrcyB0aGUgZGlzY3JpbWluYXRvciBcdTIwMTRcbiAqIHRoZSBzdGF0dXMgcm93IHByZWRhdGVzIHRoZSBjb21wb3VuZCwgc28gYSBmYWlsZWQgcm0gbGV0cyB0aGUgam9pbmVkIHdyaXRlXG4gKiBmaXJlIGFkdmlzb3J5LiBUaGUgc3RhZ2VkIGZhY2UgaXMgdGhlIHdpZGVuaW5nJ3Mgb25lIGNvc3Q6IHJvdW5kLTMnc1xuICogYmxhbmstWSBydWxlIGtlcHQgYE0gYC9gQSBgIHJvd3MgaW52aXNpYmxlLCBzbyBvbmx5IHRoZSB3b3JrdHJlZS1kaXJ0eVxuICogbWFzayBmaXJlZDsgdGhlIGluZGV4IGNvbHVtbiBub3cgbWFya3MgYm90aC4gSXQgb25seSBtYW5pZmVzdHMgd2hlcmVcbiAqIGdlbnVpbmUgZHJpZnQgZXhpc3RzIGFnYWluc3QgdGhlIHNwYW4gYmFzZWxpbmUsIGFuZCBhIGhhcm5lc3Mtc3VwcGxpZWRcbiAqIG5vbi16ZXJvIGV4aXQgY29kZSBzdGlsbCBzdXBwcmVzc2VzIHRoZSBhZHZpc29yeSBjbGFzcyBpbiBwYXNzIEIgXHUyMDE0IHRoZVxuICogc2FtZSBib3VuZGVkIGhhcm0gYXMgdGhlIHBsYW4ncyBkb2N1bWVudGVkIFwiY29pbmNpZGVudGFsbHkgcGFzc2VzXCIgam9pblxuICogY29ybmVyLiBgLXpgIHByaW50cyByYXcsIE5VTC1zZXBhcmF0ZWQgYFhZIDxwYXRoPmAgZW50cmllcyBzbyBzcGFjZS0gYW5kXG4gKiBxdW90ZS1iZWFyaW5nIHBhdGhzIHBhcnNlIHVuYW1iaWd1b3VzbHkuIEZhaWwtc2FmZTogYW4gdW5yZXNvbHZhYmxlIHJlcG9cbiAqIG9yIGEgcHJvYmUgZmFpbHVyZSB5aWVsZHMgYW4gZW1wdHkgc2V0LCBuZXZlciBhbiBlcnJvci5cbiAqL1xuZnVuY3Rpb24gY2hhbmdlZE9uRGlzayhjYWNoZTogUmVhbGl0eVByb2JlQ2FjaGUsIGN3ZDogc3RyaW5nKTogU2V0PHN0cmluZz4ge1xuICBpZiAoY2FjaGUuY2hhbmdlZFBhdGhzICE9PSBudWxsKSByZXR1cm4gY2FjaGUuY2hhbmdlZFBhdGhzO1xuICBjb25zdCBjaGFuZ2VkID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGlmIChjYWNoZS5jaGFuZ2VkQ2FuZGlkYXRlcy5sZW5ndGggPiAwKSB7XG4gICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICBpZiAocmVwb1Jvb3QgIT09IG51bGwpIHtcbiAgICAgIGNvbnN0IHJlbHMgPSBjYWNoZS5jaGFuZ2VkQ2FuZGlkYXRlcy5tYXAoKHApID0+IHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290LCBwKSk7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3RhdHVzJywgJy0tcG9yY2VsYWluJywgJy16JywgJy0tdW50cmFja2VkLWZpbGVzPW5vJywgJy0tJywgLi4ucmVsc10sIHtcbiAgICAgICAgICBjd2Q6IHJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IERFRkFVTFRfVElNRU9VVF9NU1xuICAgICAgICB9KTtcbiAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBvdXQuc3BsaXQoJ1xcMCcpKSB7XG4gICAgICAgICAgaWYgKGVudHJ5Lmxlbmd0aCA8IDQpIGNvbnRpbnVlOyAvLyBza2lwIHRoZSB0cmFpbGluZyBlbXB0eSBlbnRyeSBhbmQgcmVuYW1lLXBhaXIgcGF0aCByb3dzXG4gICAgICAgICAgY29uc3QgaW5kZXhTdGF0dXMgPSBlbnRyeS5jaGFyQXQoMCk7XG4gICAgICAgICAgY29uc3Qgd29ya3RyZWVTdGF0dXMgPSBlbnRyeS5jaGFyQXQoMSk7XG4gICAgICAgICAgaWYgKGluZGV4U3RhdHVzID09PSAnICcgJiYgd29ya3RyZWVTdGF0dXMgPT09ICcgJykgY29udGludWU7IC8vIG5vIHRyYWNrZWQgZGlmZmVyZW5jZSBcdTIxOTIgbm8gbWFya1xuICAgICAgICAgIGlmIChpbmRleFN0YXR1cyA9PT0gJz8nIHx8IGluZGV4U3RhdHVzID09PSAnIScgfHwgd29ya3RyZWVTdGF0dXMgPT09ICc/JyB8fCB3b3JrdHJlZVN0YXR1cyA9PT0gJyEnKSB7XG4gICAgICAgICAgICBjb250aW51ZTsgLy8gdW50cmFja2VkIG9yIGlnbm9yZWQgXHUyMTkyIG5vIGluZGV4IGJhc2VsaW5lIChmYWlsIGNsb3NlZClcbiAgICAgICAgICB9XG4gICAgICAgICAgY2hhbmdlZC5hZGQoam9pbihyZXBvUm9vdCwgZW50cnkuc2xpY2UoMykpKTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIHZvaWQgZXJyOyAvLyBwcm9iZSBmYWlsdXJlIFx1MjE5MiBlbXB0eSBzZXQgKGZhaWwtc2FmZSwgbmV2ZXIgYW4gZXJyb3IpXG4gICAgICB9XG4gICAgfVxuICB9XG4gIGNhY2hlLmNoYW5nZWRQYXRocyA9IGNoYW5nZWQ7XG4gIHJldHVybiBjaGFuZ2VkO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhlIHBhdGggY2FycmllcyBhIHRyYWNrZWQgc3RhdHVzIHJvdyBcdTIwMTQgaXRzIGluZGV4IGNvbnRlbnQsIGl0c1xuICogd29ya2luZy10cmVlIGNvbnRlbnQsIG9yIGJvdGggZGlmZmVyIGZyb20gdGhlIGNvbW1pdHRlZC9pbmRleCBiYXNlbGluZVxuICogKHNlZSB0aGUgcHJvYmUncyBwZXItY29sdW1uIHJlYXNvbmluZykgXHUyMDE0IHRoZSBsYXRlci1yZWNyZWF0ZSBleHBsYW5hdGlvbidzXG4gKiBtYXJrLiBgZmFsc2VgIG9uIGFueSBwcm9iZSBmYWlsdXJlIG9yIGZvciBhbnkgcGF0aCBvdXRzaWRlIHRoZSBzZWVkZWRcbiAqIGNhbmRpZGF0ZXMgKGZhaWwgY2xvc2VkKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHdvcmtpbmdUcmVlQ2hhbmdlZChwcm9iZUNhY2hlOiBSZWFsaXR5UHJvYmVDYWNoZSwgY3dkOiBzdHJpbmcsIGFic1BhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gY2hhbmdlZE9uRGlzayhwcm9iZUNhY2hlLCBjd2QpLmhhcyhhYnNQYXRoKTtcbn1cblxuLyoqXG4gKiBUaGUgbGF5ZXJlZCBwb3N0LXN0YXRlIGdhdGUgKHBsYW4gXHUwMEE3MyBzdGVwIDEpLCBldmFsdWF0ZWQgYmVmb3JlIGFueSBleGVjdXRvclxuICogY2FsbCwgc2lkZS1lZmZlY3QtZnJlZSAobm8gbWVtbyB3cml0ZXMsIG5vIGV4ZWN1dG9yIGNhbGxzOyB0aGUgcHJvYmUgaXNcbiAqIHJlYWQtb25seSBhbmQgcGVyLWNvbW1hbmQgY2FjaGVkKTpcbiAqXG4gKiAxLiBgdGFyZ2V0U3RhdGU6ICdhYnNlbnQnYCBcdTIxOTIgdGhlIHBhdGggbXVzdCBiZSBhYnNlbnQ7IHdoZW4gaXQgaXMsIHRoZVxuICogICAgZGVsZXRlLXJlYWxpdHkgcHJvYmUgZGVjaWRlczogaW5kZXgtdHJhY2tlZCBvciBzcGFubmVkIFx1MjE5MiBgZGVjaXNpdmVQYXNzYFxuICogICAgKGRhbmdsaW5nIGFuY2hvcnMgc3VyZmFjZSksIHBoYW50b20gXHUyMTkyIGAnaW5jb25jbHVzaXZlJ2AgKG5vdGhpbmcgdG9cbiAqICAgIHN1cmZhY2UgXHUyMDE0IHRoZSBtaXNzIGlzIGhhcm1sZXNzLCBhbmQgdGhlIGRlbGV0ZSBuZXZlciBmaXJlcykuXG4gKiAyLiBgdGFyZ2V0U3RhdGU6ICdleGlzdHMnYCBcdTIxOTIgdGhlIHRhcmdldCBtdXN0IGJlIGEgcmVndWxhciBmaWxlIChhIGRpcmVjdG9yeVxuICogICAgb3IgbWlzc2luZyB0YXJnZXQgZmFpbHMpLlxuICogMy4gQ29udGVudCB2ZXJpZmljYXRpb24gd2hlcmUgdGhlIGV4cGVjdGVkIHBvc3QtY29udGVudCBpcyBzdGF0aWNhbGx5XG4gKiAgICBrbm93YWJsZSAoYGV4YWN0YC9gc3VmZml4YC9gZW1wdHlgL2BzaXplYCk6IGEgbWlzbWF0Y2ggbWVhbnMgdGhlIHdyaXRlJ3NcbiAqICAgIGVmZmVjdCBpcyBhYnNlbnQgXHUyMDE0IG5vIHRvdWNoLlxuICogNC4gY3AgZGVzdGluYXRpb24tdnMtc291cmNlOiBhIHN0aWxsLXByZXNlbnQgc291cmNlIG11c3QgYnl0ZS1lcXVhbCB0aGVcbiAqICAgIGRlc3RpbmF0aW9uOyBhbiBhYnNlbnQgc291cmNlIGFwcGxpZXMgdGhlIGFic2VudC1zb3VyY2UgcnVsZSAocGFzc2VkIHRoZVxuICogICAgcmVhbGl0eSBwcm9iZSBBTkQgaXRzIGFic2VuY2UgZXhwbGFpbmVkIGJ5IGEgbGF0ZXIgc2FtZS1wYXRoXG4gKiAgICBgZGVjaXNpdmVQYXNzYCBcdTIwMTQgdGhlIGRyaXZlciByZXNvbHZlcyB0aGUgYCdwZW5kaW5nJ2AgaG9sZCkuXG4gKiA1LiByZW5hbWUtY29weTogdGhlIGRlc3RpbmF0aW9uIGZpcmVzIG9ubHkgd2hlbiBpdHMgc291cmNlIHBhc3NlZCB0aGVcbiAqICAgIGRlbGV0ZS1yZWFsaXR5IHByb2JlIChhIHBoYW50b20gc291cmNlIG1lYW5zIHRoZSBtb3ZlIGZhaWxlZCkuXG4gKlxuICogRXZlcnl0aGluZyBlbHNlIFx1MjAxNCB0aGUgZXhpc3RlbmNlLWdhdGVkIGZhbWlsaWVzIHdob3NlIGV4aXN0ZW5jZSBwYXNzIHByb3Zlc1xuICogbm90aGluZyBcdTIwMTQgaXMgYCdpbmNvbmNsdXNpdmUnYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV2YWx1YXRlV3JpdGVHYXRlKGlucHV0OiBUb3VjaFdyaXRlSW5wdXQsIHByb2JlQ2FjaGU6IFJlYWxpdHlQcm9iZUNhY2hlKTogV3JpdGVHYXRlT3V0Y29tZSB7XG4gIGlmIChpbnB1dC50YXJnZXRTdGF0ZSA9PT0gJ2Fic2VudCcpIHtcbiAgICBpZiAoZmlsZUV4aXN0cyhpbnB1dC5maWxlUGF0aCkpIHJldHVybiAnZGVjaXNpdmVGYWlsJztcbiAgICByZXR1cm4gcmVhbFBhdGhzKHByb2JlQ2FjaGUsIGlucHV0LmN3ZCkuaGFzKGlucHV0LmZpbGVQYXRoKSA/ICdkZWNpc2l2ZVBhc3MnIDogJ2luY29uY2x1c2l2ZSc7XG4gIH1cblxuICBpZiAoIWlzRmlsZU9uRGlzayhpbnB1dC5maWxlUGF0aCkpIHJldHVybiAnZGVjaXNpdmVGYWlsJztcblxuICBjb25zdCBjb250ZW50ID0gaW5wdXQucG9zdFN0YXRlPy5jb250ZW50O1xuICBpZiAoY29udGVudCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIGNvbnRlbnRNYXRjaGVzKGNvbnRlbnQsIGlucHV0LmZpbGVQYXRoKSA/ICdkZWNpc2l2ZVBhc3MnIDogJ2RlY2lzaXZlRmFpbCc7XG4gIH1cblxuICBpZiAoaW5wdXQuc291cmNlUGF0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgaWYgKGZpbGVFeGlzdHMoaW5wdXQuc291cmNlUGF0aCkpIHtcbiAgICAgIGxldCBzcmM6IHN0cmluZztcbiAgICAgIGxldCBkc3Q6IHN0cmluZztcbiAgICAgIHRyeSB7XG4gICAgICAgIHNyYyA9IGZzLnJlYWRGaWxlU3luYyhpbnB1dC5zb3VyY2VQYXRoLCAndXRmOCcpO1xuICAgICAgICBkc3QgPSBmcy5yZWFkRmlsZVN5bmMoaW5wdXQuZmlsZVBhdGgsICd1dGY4Jyk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuICdkZWNpc2l2ZUZhaWwnO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHNyYyA9PT0gZHN0ID8gJ2RlY2lzaXZlUGFzcycgOiAnZGVjaXNpdmVGYWlsJztcbiAgICB9XG4gICAgLy8gQWJzZW50IHNvdXJjZSBcdTIwMTQgdGhlIGFic2VudC1zb3VyY2UgcnVsZSAocGxhbiBcdTAwQTczIHN0ZXAgMWIpOiB0aGUgZGVzdFxuICAgIC8vIGZpcmVzIG9ubHkgd2hlbiB0aGUgc291cmNlIHBhc3NlZCB0aGUgcmVhbGl0eSBwcm9iZSAoaXQgd2FzIGEgcmVhbFxuICAgIC8vIGZpbGUpIEFORCBpdHMgYWJzZW5jZSBpcyBleHBsYWluZWQgYnkgYSBsYXRlciBzYW1lLXBhdGggZGVjaXNpdmVQYXNzLlxuICAgIHJldHVybiByZWFsUGF0aHMocHJvYmVDYWNoZSwgaW5wdXQuY3dkKS5oYXMoaW5wdXQuc291cmNlUGF0aCkgPyAncGVuZGluZycgOiAnZGVjaXNpdmVGYWlsJztcbiAgfVxuXG4gIGlmIChpbnB1dC5yZW5hbWVTb3VyY2VQYXRoICE9PSB1bmRlZmluZWQpIHtcbiAgICAvLyBObyBjb250ZW50IGNvbXBhcmlzb24gXHUyMDE0IHBhdGNoIHJlbmFtZXMgbWF5IGNoYW5nZSBjb250ZW50OyBhIHBoYW50b21cbiAgICAvLyBzb3VyY2UgbWVhbnMgdGhlIG1vdmUgZmFpbGVkIGFuZCBhIHByZS1leGlzdGluZyBkZXN0aW5hdGlvbiB3YXMgbmV2ZXJcbiAgICAvLyB0b3VjaGVkIChwbGFuIFx1MDBBNzMgc3RlcCAxYykuXG4gICAgcmV0dXJuIHJlYWxQYXRocyhwcm9iZUNhY2hlLCBpbnB1dC5jd2QpLmhhcyhpbnB1dC5yZW5hbWVTb3VyY2VQYXRoKSA/ICdkZWNpc2l2ZVBhc3MnIDogJ2RlY2lzaXZlRmFpbCc7XG4gIH1cblxuICByZXR1cm4gJ2luY29uY2x1c2l2ZSc7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSW5qZWN0ZWQgZXhlY3V0b3JzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFN0cnVjdHVyZWQgcmVzdWx0IG9mIGEgc2NvcGVkIGBnaXQgc3BhbiBkcmlmdCA8ZmlsZT4gLS1maXhgLiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaEZpeFJlc3VsdCB7XG4gIC8qKlxuICAgKiBXaGV0aGVyIGAtLWZpeGAgcmUtYW5jaG9yZWQgYXQgbGVhc3Qgb25lIHNwYW4gaW4gdGhlIHdvcmtpbmcgdHJlZS4gRHJpdmVzXG4gICAqIHtAbGluayBUb3VjaE91dHB1dC50cmVlTW9kaWZpZWR9IHNvIGEgY2FsbGVyL3Rlc3QgY2FuIGFzc2VydCB0aGUgaGVhbGluZ1xuICAgKiBoYXBwZW5lZCB3aXRob3V0IGRpZmZpbmcgdGhlIHRyZWUgaXRzZWxmLlxuICAgKi9cbiAgbW9kaWZpZWQ6IGJvb2xlYW47XG59XG5cbi8qKlxuICogUnVuIGBnaXQgc3BhbiBkcmlmdCA8ZmlsZT4gLS1maXhgIHNjb3BlZCB0byB0aGUgdG91Y2hlZCBmaWxlICh3cml0ZSBwYXRoXG4gKiBvbmx5KSwgcmVwb3J0aW5nIHdoZXRoZXIgdGhlIHdvcmtpbmcgdHJlZSB3YXMgaGVhbGVkLiBBc3luYyBzbyB0aGUgZXZlbnR1YWxcbiAqIGltcGxlbWVudGF0aW9uIGFuZCBpdHMgdGVzdHMgY2FuIGluamVjdCBhIGZha2Ugd2l0aG91dCBhIHJlYWwgc3VicHJvY2Vzcy5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hGaXhFeGVjdXRvciA9IChmaWxlUGF0aDogc3RyaW5nLCBjd2Q6IHN0cmluZykgPT4gUHJvbWlzZTxUb3VjaEZpeFJlc3VsdD47XG5cbi8qKlxuICogUnVuIGBnaXQgc3BhbiBsaXN0IC0tcG9yY2VsYWluIDxmaWxlPmAgYW5kIHJldHVybiBpdHMgcGFyc2VkIHJvd3MgXHUyMDE0IG9uZSBwZXJcbiAqIGFuY2hvciBjb3ZlcmluZyB0aGUgZmlsZS4gU3RydWN0dXJlZCAobm90IHJhdyBzdGRvdXQpIHNvIHRoZSBtZXJnZWQtYmxvY2tcbiAqIGNvbXB1dGF0aW9uIGFuZCBpdHMgdGVzdHMgc2hhcmUgdGhlIHNhbWUgc2hhcGUuXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoTGlzdEV4ZWN1dG9yID0gKGZpbGVQYXRoOiBzdHJpbmcsIGN3ZDogc3RyaW5nKSA9PiBQcm9taXNlPFBvcmNlbGFpblJvd1tdPjtcblxuLyoqXG4gKiBSdW4gYGdpdCBzcGFuIGRyaWZ0IC0tZm9ybWF0IHBvcmNlbGFpbiA8YXJncz5gIChzY29wZWQgdG8gdGhlIHRvdWNoZWQgZmlsZSBvclxuICogaXRzIHNwYW5zKSBhbmQgcmV0dXJuIGl0cyBwYXJzZWQgcm93cyBcdTIwMTQgb25lIHBlciBkcmlmdGVkIGFuY2hvciwgZW1wdHkgd2hlblxuICogY2xlYW4uIFN0YXR1cyBjbGFzc2lmaWNhdGlvbiBpcyB2aWEgYGlzRGVidCgpYDsgcG9zaXRpb25hbCAoYE1PVkVEYCxcbiAqIGBSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGApIHJvd3MgYXJlIG5ldmVyIGRlYnQuXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoRHJpZnRFeGVjdXRvciA9IChhcmdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpID0+IFByb21pc2U8RHJpZnRQb3JjZWxhaW5Sb3dbXT47XG5cbi8qKlxuICogUnVuIGJhcmUgYGdpdCBzcGFuIHdoeSA8bmFtZT5gIGFuZCByZXR1cm4gdGhlIHNwYW4ncyByZWNvcmRlZCB3aHkgc2VudGVuY2UsXG4gKiBvciBgbnVsbGAgd2hlbiBub25lIGlzIHJlY29yZGVkIG9yIHRoZSByZWFkIGZhaWxzLiBGZWVkcyB0aGUgaHVtYW4tZm9ybWF0XG4gKiBzcGFuIHJlbmRlcjsgaW52b2tlZCBvbmx5IGZvciBzcGFucyBhY3R1YWxseSBiZWluZyBzdXJmYWNlZCB0aGlzIHRvdWNoLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaFdoeUV4ZWN1dG9yID0gKG5hbWU6IHN0cmluZywgY3dkOiBzdHJpbmcpID0+IFByb21pc2U8c3RyaW5nIHwgbnVsbD47XG5cbi8qKlxuICogVGhlIGluamVjdGVkIGV4ZWN1dGlvbiBzdXJmYWNlLiBLZXB0IGFzIGZvdXIgbmFycm93IGFzeW5jIGZ1bmN0aW9ucyAocmF0aGVyXG4gKiB0aGFuIGEgcmF3IGNvbW1hbmQgcnVubmVyKSBzbyB0ZXN0cyBpbmplY3QgZmFrZXMgcmV0dXJuaW5nIHN0cnVjdHVyZWQgZGF0YVxuICogYW5kIHRoZSBjb3JlIG5ldmVyIHNwYXducyBhIHN1YnByb2Nlc3MgaXRzZWxmLiBUaGUgYHJlYWRgIHBhdGggbmV2ZXIgaW52b2tlc1xuICogYGZpeGAuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hFeGVjdXRvcnMge1xuICBmaXg6IFRvdWNoRml4RXhlY3V0b3I7XG4gIGxpc3Q6IFRvdWNoTGlzdEV4ZWN1dG9yO1xuICBkcmlmdDogVG91Y2hEcmlmdEV4ZWN1dG9yO1xuICB3aHk6IFRvdWNoV2h5RXhlY3V0b3I7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggb3V0cHV0XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFdoYXQgdGhlIGNvcmUgaGFuZHMgYmFjayBmb3IgdGhlIGFkYXB0ZXIgdG8gdHJhbnNsYXRlIGludG8gU0RLIG91dHB1dC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hPdXRwdXQge1xuICAvKipcbiAgICogVGhlIG1lcmdlZCBgPGdpdC1zcGFuPmAgYmxvY2sgKGhlYWRlciwgb25lIGh1bWFuLWZvcm1hdCBzZWN0aW9uIHBlclxuICAgKiBzdXJmYWNlZCBzcGFuLCBmb290ZXIpIHRvIGluamVjdCB2aWEgdGhlIGhhcm5lc3MncyBgYWRkaXRpb25hbENvbnRleHRgLFxuICAgKiBvciBgbnVsbGAgd2hlbiB0aGVyZSBpcyBub3RoaW5nIHdvcnRoIHN1cmZhY2luZyB0aGlzIHRvdWNoLlxuICAgKi9cbiAgYWRkaXRpb25hbENvbnRleHQ6IHN0cmluZyB8IG51bGw7XG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSB3b3JraW5nIHRyZWUgd2FzIG1vZGlmaWVkIGJ5IGEgc2NvcGVkIGAtLWZpeGAgb24gdGhlIHdyaXRlIHBhdGguXG4gICAqIEFsd2F5cyBgZmFsc2VgIG9uIHRoZSByZWFkIHBhdGggKHJlYWRzIG5ldmVyIG11dGF0ZSB0aGUgdHJlZSkuXG4gICAqL1xuICB0cmVlTW9kaWZpZWQ6IGJvb2xlYW47XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTWVyZ2VkLWJsb2NrIGFzc2VtYmx5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFRoZSBtZW1vIGtleSB1bmRlciB3aGljaCBhIHNwYW4ncyByZW5kZXIgZm9yIGEgZ2l2ZW4gZHJpZnQgc3RhdHVzIGlzIGRlZHVwZWQuICovXG5mdW5jdGlvbiBkcmlmdEtleShuYW1lOiBzdHJpbmcsIHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogc3RyaW5nIHtcbiAgLy8gU3BhbiBuYW1lcyBjb21lIGZyb20gdGFiLWRlbGltaXRlZCBwb3JjZWxhaW4sIHNvIHRoZXkgbmV2ZXIgY29udGFpbiBhIHRhYjtcbiAgLy8gYSB0YWItam9pbmVkIGtleSBjYW4gbmV2ZXIgY29sbGlkZSB3aXRoIGEgYmFyZSBzcGFuIG5hbWUgKHRoZSBzdXJmYWNpbmcga2V5KS5cbiAgcmV0dXJuIGAke25hbWV9XFx0JHtzdGF0dXN9YDtcbn1cblxuLyoqIFRoZSBgcGF0aCNMc3RhcnQtTGVuZGAgKG9yIGJhcmUtcGF0aCwgd2hvbGUtZmlsZSkgYW5jaG9yIHRleHQgZm9yIGEgcm93LiAqL1xuZnVuY3Rpb24gYW5jaG9yVGV4dChyb3c6IFBvcmNlbGFpblJvdyk6IHN0cmluZyB7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHJvdy5wYXRoO1xuICByZXR1cm4gYCR7cm93LnBhdGh9I0wke3Jvdy5zdGFydH0tTCR7cm93LmVuZH1gO1xufVxuXG5mdW5jdGlvbiBjbGVhbkhlYWRlcihmaWxlTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGAke2ZpbGVOYW1lfSBoYXMgaW1wbGljaXQgZGVwZW5kZW5jaWVzOmA7XG59XG5cbmZ1bmN0aW9uIGNsZWFuRm9vdGVyKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYElmIHlvdSBjaGFuZ2UgJHtmaWxlTmFtZX0gY2hlY2sgdGhlIG90aGVyIGZpbGVzIHRvIGNvbmZpcm0gdGhleSBzdGlsbCB3b3JrIHRvZ2V0aGVyLmA7XG59XG5cbi8qKlxuICogVGhlIHdyaXRlIHBhdGggbmFtZXMgdGhlIGVkaXQgYXMgdGhlIGNhdXNlOyB0aGUgcmVhZCBwYXRoIG9ubHkgc3VyZmFjZXNcbiAqIHByZS1leGlzdGluZyBkcmlmdCBpdCBkaWRuJ3QgY3JlYXRlLCBzbyBpdCBuYW1lcyB0aGUgZGVwZW5kZW5jeSBpbnN0ZWFkLlxuICovXG5mdW5jdGlvbiBkcmlmdEhlYWRlcihkcmlmdGVkQ291bnQ6IG51bWJlciwga2luZDogVG91Y2hJbnB1dFsna2luZCddKTogc3RyaW5nIHtcbiAgaWYgKGtpbmQgPT09ICd3cml0ZScpIHtcbiAgICByZXR1cm4gZHJpZnRlZENvdW50ID09PSAxXG4gICAgICA/ICdUaGlzIGVkaXQgcHV0IGFuIGltcGxpY2l0IGRlcGVuZGVuY3kgb3V0IG9mIGRhdGU6J1xuICAgICAgOiAnVGhpcyBlZGl0IHB1dCBpbXBsaWNpdCBkZXBlbmRlbmNpZXMgb3V0IG9mIGRhdGU6JztcbiAgfVxuICByZXR1cm4gZHJpZnRlZENvdW50ID09PSAxXG4gICAgPyAnVGhpcyBmaWxlIGhhcyBhbiBpbXBsaWNpdCBkZXBlbmRlbmN5IG91dCBvZiBkYXRlOidcbiAgICA6ICdUaGlzIGZpbGUgaGFzIGltcGxpY2l0IGRlcGVuZGVuY2llcyBvdXQgb2YgZGF0ZTonO1xufVxuXG5mdW5jdGlvbiBkcmlmdEZvb3RlcihkcmlmdGVkTmFtZXM6IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgaWYgKGRyaWZ0ZWROYW1lcy5sZW5ndGggPT09IDEpIHtcbiAgICBjb25zdCBuYW1lID0gZHJpZnRlZE5hbWVzWzBdO1xuICAgIHJldHVybiBgUmVzdG9yZSBhZ3JlZW1lbnQgYmVmb3JlIGNvbW1pdHRpbmcuIEZvbGxvdyBjb25maXJtZWQgYXV0aG9yaXR5LiBQcmVzZXJ2ZSBhbmNob3Igc2hhcGU7IGlmIGFuIGFkZHJlc3MgY2hhbmdlZCwgcmVtb3ZlIGl0cyBvbGQgYW5jaG9yIGJlZm9yZSBhZGRpbmcgdGhlIG5ldyBvbmUuIFVwZGF0ZSBvciByZXRpcmUgdGhlIHdoeSBvbmx5IGlmIGl0cyBtZWFuaW5nIGNoYW5nZWQuIFJlcXVpcmUgXFxgZ2l0IHNwYW4gZHJpZnQgJHtuYW1lfVxcYCB0byByZXBvcnQgemVybywgdGhlbiBjaGVjayB0aGUgb3RoZXIgYW5jaG9ycy4gQ29uZm9ybSBhIHNpZGUgb25seSB3aGVuIGNvbmZpcm1lZCBhdXRob3JpdHkgb3IgYSBzYXRpc2ZpZWQgZ2F0ZSBkZWNpZGVzIGl0OyByZXBvcnQgYW1iaWd1aXR5IG9yIGFuIG9ic29sZXRlIGNvdXBsaW5nLmA7XG4gIH1cbiAgcmV0dXJuICdGb3IgZWFjaCBvdXQtb2YtZGF0ZSBzcGFuOiByZXN0b3JlIGFncmVlbWVudCBiZWZvcmUgY29tbWl0dGluZy4gRm9sbG93IGNvbmZpcm1lZCBhdXRob3JpdHkuIFByZXNlcnZlIGFuY2hvciBzaGFwZTsgaWYgYW4gYWRkcmVzcyBjaGFuZ2VkLCByZW1vdmUgaXRzIG9sZCBhbmNob3IgYmVmb3JlIGFkZGluZyB0aGUgbmV3IG9uZS4gVXBkYXRlIG9yIHJldGlyZSB0aGUgd2h5IG9ubHkgaWYgaXRzIG1lYW5pbmcgY2hhbmdlZC4gUmVxdWlyZSBgZ2l0IHNwYW4gZHJpZnQgPG5hbWU+YCB0byByZXBvcnQgemVybywgdGhlbiBjaGVjayB0aGUgb3RoZXIgYW5jaG9ycy4gQ29uZm9ybSBhIHNpZGUgb25seSB3aGVuIGNvbmZpcm1lZCBhdXRob3JpdHkgb3IgYSBzYXRpc2ZpZWQgZ2F0ZSBkZWNpZGVzIGl0OyByZXBvcnQgYW1iaWd1aXR5IG9yIGFuIG9ic29sZXRlIGNvdXBsaW5nLic7XG59XG5cbi8qKiBUaGUge0BsaW5rIFJhbmdlTGFiZWx9IGZvciBhIHBvcmNlbGFpbiByb3cgXHUyMDE0IGAwLTBgIGlzIHRoZSB3aG9sZS1maWxlIGFuY2hvci4gKi9cbmZ1bmN0aW9uIHJhbmdlTGFiZWwocm93OiBQb3JjZWxhaW5Sb3cpOiBSYW5nZUxhYmVsIHtcbiAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSByZXR1cm4geyBraW5kOiAnd2hvbGUtZmlsZScgfTtcbiAgcmV0dXJuIHsga2luZDogJ3JhbmdlJywgc3RhcnQ6IHJvdy5zdGFydCwgZW5kOiByb3cuZW5kIH07XG59XG5cbi8qKlxuICogQSBzcGFuJ3MgZnVsbCBhbmNob3IgbGlzdCwgcmVuZGVyZWQgYXMgYSBzaGFyZWQtcHJlZml4IHRyZWUgYnlcbiAqIHtAbGluayByZW5kZXJBbmNob3JUcmVlfSwgd2l0aCBlYWNoIGFuY2hvciB0aGF0IGNhcnJpZXMgZ2VudWluZSBkcmlmdFxuICogc3VmZml4ZWQgYnkgaXRzIGxvd2VyY2FzZSBzdGF0dXMgdG9rZW4ocykgKGAgXHUyMDE0IGNoYW5nZWRgKS5cbiAqXG4gKiBBIGRyaWZ0IHJvdyBtYXRjaGVzIGFuIGFuY2hvciBieSBleGFjdCBwYXRoK3JhbmdlLCBvciBieSBwYXRoIGFsb25lIHdoZW4gdGhlXG4gKiBzcGFuIGhhcyBhIHNpbmdsZSBhbmNob3Igb24gdGhhdCBwYXRoIChyYW5nZXMgY2FuIGRpc2FncmVlIGFmdGVyIGEgaGVhbCkuXG4gKiBgc29sZU9uUGF0aGAgaXMgZGVsaWJlcmF0ZWx5IGNvbXB1dGVkIG92ZXIgdGhlICoqZnVsbCBmbGF0IGFuY2hvciBsaXN0KiosXG4gKiBiZWZvcmUgYW55IGdyb3VwaW5nIFx1MjAxNCB0aGUgdHJlZSBsYXlvdXQgbXVzdCBuZXZlciBiZSBhYmxlIHRvIGNoYW5nZSAqd2hpY2gqXG4gKiBhbmNob3JzIGdldCBsYWJlbGVkLCBvbmx5IHdoZXJlIHRoZXkgc2l0IG9uIHRoZSBwYWdlLlxuICovXG5mdW5jdGlvbiBhbmNob3JCdWxsZXRzKGFuY2hvcnM6IFBvcmNlbGFpblJvd1tdLCBkZWJ0Um93czogRHJpZnRQb3JjZWxhaW5Sb3dbXSk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgcm93cyA9IGFuY2hvcnMubWFwKChhbmNob3IpID0+IHtcbiAgICBjb25zdCBzb2xlT25QYXRoID0gYW5jaG9ycy5maWx0ZXIoKGEpID0+IGEucGF0aCA9PT0gYW5jaG9yLnBhdGgpLmxlbmd0aCA9PT0gMTtcbiAgICBjb25zdCBzdGF0dXNlcyA9IG5ldyBTZXQ8UG9yY2VsYWluU3RhdHVzPigpO1xuICAgIGZvciAoY29uc3Qgcm93IG9mIGRlYnRSb3dzKSB7XG4gICAgICBpZiAocm93LnBhdGggIT09IGFuY2hvci5wYXRoKSBjb250aW51ZTtcbiAgICAgIGlmIChzb2xlT25QYXRoIHx8IChyb3cuc3RhcnQgPT09IGFuY2hvci5zdGFydCAmJiByb3cuZW5kID09PSBhbmNob3IuZW5kKSkge1xuICAgICAgICBzdGF0dXNlcy5hZGQocm93LnN0YXR1cyk7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IHNvcnRlZCA9IFsuLi5zdGF0dXNlc10uc29ydCgpO1xuICAgIGNvbnN0IHN1ZmZpeCA9IHNvcnRlZC5sZW5ndGggPiAwID8gYCBcdTIwMTQgJHtzb3J0ZWQubWFwKGh1bWFuU3RhdHVzTGFiZWwpLmpvaW4oJywgJyl9YCA6ICcnO1xuICAgIHJldHVybiB7IHBhdGg6IGFuY2hvci5wYXRoLCByYW5nZTogcmFuZ2VMYWJlbChhbmNob3IpLCBzdWZmaXggfTtcbiAgfSk7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHJlbmRlckFuY2hvclRyZWUoY29sbGFwc2VCeVBhdGgocm93cykpO1xuICB9IGNhdGNoIHtcbiAgICAvLyBGQUlMLUNMT1NFRCwgbm90IGEgYDxncmVlbmZpZWxkPmAtZm9yYmlkZGVuIGZhbGxiYWNrIFx1MjAxNCBkbyBub3QgcmVtb3ZlIGl0XG4gICAgLy8gb24gdGhlIHRoZW9yeSB0aGF0IGEgZGVncmFkZWQgZmFsbGJhY2sgaXMgaXRzZWxmIGZvcmJpZGRlbi4gQW4gdW5jYXVnaHRcbiAgICAvLyB0aHJvdyBoZXJlIGRvZXMgbm90IGRlZ3JhZGUgdG8gYSBmbGF0IGxpc3Q6IGl0IGVzY2FwZXMgdG9cbiAgICAvLyBgcnVuVG91Y2hIb29rYCdzIGNhdGNoLCB3aGljaCByZXNvbHZlcyB0aGUgd2hvbGUgaG9vayB0b1xuICAgIC8vIGBhZGRpdGlvbmFsQ29udGV4dDogbnVsbGAsIHNvIHRoZSBhZ2VudCBpcyBuZXZlciB0b2xkIGFib3V0IHRoZSBkcmlmdCBhdFxuICAgIC8vIGFsbC4gQ2F0Y2hpbmcgbG9jYWxseSBuYXJyb3dzIHdoYXQgYSByZW5kZXJpbmcgZGVmZWN0IGNhbiBjb3N0IGZyb20gXCJ0aGVcbiAgICAvLyByZW1pbmRlciBkaXNhcHBlYXJzXCIgdG8gXCJ0aGUgcmVtaW5kZXIgbG9va3MgbGlrZSBpdCBkaWQgYmVmb3JlIHRoZSB0cmVlXCIuXG4gICAgLy8gV2hldGhlciB0byBzdXJmYWNlIGFuZCB3aGF0IHNoYXBlIHRvIHN1cmZhY2UgaW4gYXJlIGRpZmZlcmVudCB0aGluZ3MsIGFuZFxuICAgIC8vIHRoaXMgY2F0Y2ggb25seSBldmVyIHRvdWNoZXMgdGhlIGxhdHRlci5cbiAgICAvLyBgcm93c2AgaXMgaW5kZXgtYWxpZ25lZCB3aXRoIGBhbmNob3JzYCwgc28gdGhpcyByZXByb2R1Y2VzIHRvZGF5J3MgZmxhdFxuICAgIC8vIGJ1bGxldCBydW4gYnl0ZSBmb3IgYnl0ZSwgc3VmZml4ZXMgaW5jbHVkZWQuXG4gICAgcmV0dXJuIGFuY2hvcnMubWFwKChhbmNob3IsIGkpID0+IGAtICR7YW5jaG9yVGV4dChhbmNob3IpfSR7cm93c1tpXS5zdWZmaXh9YCk7XG4gIH1cbn1cblxuLyoqXG4gKiBPbmUgaHVtYW4tZm9ybWF0IHNwYW4gc2VjdGlvbjogYCMjIDxuYW1lPmAsIHRoZSBmdWxsIGFuY2hvciBsaXN0IChkcmlmdGVkXG4gKiBhbmNob3JzIHN0YXR1cy1zdWZmaXhlZCksIGFuZCB0aGUgd2h5IHNlbnRlbmNlIHdoZW4gb25lIGlzIHJlY29yZGVkLlxuICpcbiAqIFRoZSBuYW1lIGhlYWRlciBhbmQgdGhlIHdoeSBzZW50ZW5jZSBhcmUgdGhlIHNhbWUgc2hhcGUgYGdpdCBzcGFuIGxpc3RgXG4gKiByZW5kZXJzOyB0aGUgYW5jaG9yIGxpc3QgZGVsaWJlcmF0ZWx5IGlzIG5vdCBcdTIwMTQgaXQgcmVuZGVycyBhcyBhIHNoYXJlZC1wcmVmaXhcbiAqIHRyZWUgKHtAbGluayBhbmNob3JCdWxsZXRzfSkgd2hlcmUgdGhlIENMSSBwcmludHMgYSBmbGF0IGAtIHBhdGgjTHJhbmdlYFxuICogYnVsbGV0IHJ1bi4gVGhlIENMSSdzIG93biB0ZXh0IGZvcm1hdCBpcyB1bnRvdWNoZWQ7IG9ubHkgdGhpcyBob29rJ3NcbiAqIHJlLXByZXNlbnRhdGlvbiBvZiBpdCBncm91cHMuXG4gKi9cbmZ1bmN0aW9uIHJlbmRlclNwYW5TZWN0aW9uKFxuICBuYW1lOiBzdHJpbmcsXG4gIGFuY2hvcnM6IFBvcmNlbGFpblJvd1tdLFxuICBkZWJ0Um93czogRHJpZnRQb3JjZWxhaW5Sb3dbXSxcbiAgd2h5OiBzdHJpbmcgfCBudWxsXG4pOiBzdHJpbmcge1xuICBjb25zdCBsaW5lcyA9IFtgIyMgJHtuYW1lfWAsIC4uLmFuY2hvckJ1bGxldHMoYW5jaG9ycywgZGVidFJvd3MpXTtcbiAgaWYgKHdoeSkgbGluZXMucHVzaCgnJywgd2h5KTtcbiAgcmV0dXJuIGxpbmVzLmpvaW4oJ1xcbicpO1xufVxuXG4vKipcbiAqIEFzc2VtYmxlIHRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrOiBoZWFkZXIsIG9uZSBzZWN0aW9uIHBlciBzdXJmYWNlZFxuICogc3BhbiAoc2VwYXJhdGVkIGJ5IGAtLS1gKSwgYW5kIGEgc2luZ2xlIGZvb3RlciBhZnRlciBhIGZpbmFsIGAtLS1gLlxuICovXG5mdW5jdGlvbiBidWlsZEJsb2NrKHNlY3Rpb25zOiBzdHJpbmdbXSwgaGVhZGVyOiBzdHJpbmcsIGZvb3Rlcjogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgYm9keSA9IGAke2hlYWRlcn1cXG5cXG4ke3NlY3Rpb25zLmpvaW4oJ1xcblxcbi0tLVxcblxcbicpfVxcblxcbi0tLVxcblxcbiR7Zm9vdGVyfWA7XG4gIHJldHVybiBgXFxuPGdpdC1zcGFuPlxcbiR7Ym9keX1cXG48L2dpdC1zcGFuPlxcbmA7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggaG9vayBlbnRyeSBwb2ludFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBXaGV0aGVyIGEgY292ZXJpbmcgcm93IGlzIGluIHNjb3BlIGZvciB0aGUgcmVjb3ZlcmVkIHJhbmdlLiAqL1xuZnVuY3Rpb24gaW50ZXJzZWN0cyhyb3c6IFBvcmNlbGFpblJvdywgcmFuZ2U6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyk6IGJvb2xlYW4ge1xuICBpZiAocmFuZ2UgPT09ICd3aG9sZS1maWxlJykgcmV0dXJuIHRydWU7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHRydWU7IC8vIHdob2xlLWZpbGUgYW5jaG9yXG4gIHJldHVybiByYW5nZXNJbnRlcnNlY3QocmFuZ2UsIHsgc3RhcnQ6IHJvdy5zdGFydCwgZW5kOiByb3cuZW5kIH0pO1xufVxuXG4vKipcbiAqIFJlY292ZXIgdGhlIHRvdWNoZWQgcmFuZ2UgZnJvbSB0aGUgb24tZGlzayBmaWxlIGZvciBhIHdyaXRlLiBBbiBlbXB0eSB3cml0ZSBvclxuICogYW4gdW5yZWFkYWJsZSBmaWxlIChlLmcuIGEgZGVsZXRlLCBvciB0aGUgZmlsZSB3YXMgbmV2ZXIgd3JpdHRlbikgZGVncmFkZXMgdG9cbiAqIGAnd2hvbGUtZmlsZSdgLCBzY29waW5nIHRoZSB0b3VjaCB0byBldmVyeSBjb3ZlcmluZyBzcGFuIFx1MjAxNCB0aGUgZmFpbC1vcGVuXG4gKiBiZWhhdmlvciwgbm90IGFuIGVycm9yLlxuICovXG5mdW5jdGlvbiByZWNvdmVyUmFuZ2VGcm9tRGlzayh3cml0dGVuOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcpOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScge1xuICBpZiAod3JpdHRlbi5sZW5ndGggPT09IDApIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIGxldCBjb250ZW50OiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCwgJ3V0ZjgnKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuICd3aG9sZS1maWxlJztcbiAgfVxuICByZXR1cm4gcmVjb3ZlclJhbmdlKHdyaXR0ZW4sIGNvbnRlbnQpO1xufVxuXG4vKipcbiAqIFRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wncyBkb2N1bWVudGVkIGRlZmF1bHQgbGluZSBjb3VudCB3aGVuIGBvZmZzZXRgIGlzXG4gKiBnaXZlbiB3aXRob3V0IGBsaW1pdGAgKFwiQnkgZGVmYXVsdCwgaXQgcmVhZHMgdXAgdG8gMjAwMCBsaW5lc1wiKS4gTmFtZWQgc29cbiAqIHRoZSBhc3N1bXB0aW9uIGlzIHZpc2libGUgYW5kIGVhc3kgdG8gdXBkYXRlIGlmIHRoYXQgZGVmYXVsdCBldmVyIGNoYW5nZXMuXG4gKi9cbmV4cG9ydCBjb25zdCBERUZBVUxUX1JFQURfTElNSVQgPSAyMDAwO1xuXG4vKipcbiAqIENvbXB1dGUgdGhlIHRvdWNoZWQgcmFuZ2UgZm9yIGEgcmVhZCBmcm9tIHRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wnc1xuICogYG9mZnNldGAvYGxpbWl0YCBpbnB1dHMuIE5laXRoZXIgcHJlc2VudCBtZWFucyBhIGdlbnVpbmUgd2hvbGUtZmlsZSByZWFkIFx1MjAxNFxuICogZXZlcnkgY292ZXJpbmcgc3BhbiBzdGF5cyBpbiBzY29wZSwgbWF0Y2hpbmcgdG9kYXkncyBiZWhhdmlvci4gT3RoZXJ3aXNlXG4gKiB0aGUgcmFuZ2Ugc3RhcnRzIGF0IGBvZmZzZXRgIChkZWZhdWx0IGxpbmUgMSkgYW5kIHJ1bnMgZm9yIGBsaW1pdGAgbGluZXNcbiAqIChkZWZhdWx0IHtAbGluayBERUZBVUxUX1JFQURfTElNSVR9KSwgY2xhbXBlZCB0byB0aGUgZmlsZSdzIGFjdHVhbCBsaW5lXG4gKiBjb3VudCBzbyBhIHNob3J0IGZpbGUgd2l0aCBhIGxhcmdlIGBvZmZzZXRgL2BsaW1pdGAgZG9lc24ndCBvdmVyc2hvb3QuXG4gKiBDbGFtcGluZyByZXF1aXJlcyByZWFkaW5nIHRoZSBmaWxlOyBhbiB1bnJlYWRhYmxlIGZpbGUgZGVncmFkZXMgdG9cbiAqIGAnd2hvbGUtZmlsZSdgIFx1MjAxNCB0aGUgc2FtZSBmYWlsLW9wZW4gYmVoYXZpb3IgdGhlIHdyaXRlIHBhdGggdXNlcy5cbiAqL1xuZnVuY3Rpb24gcmVjb3ZlclJlYWRSYW5nZShcbiAgb2Zmc2V0OiBudW1iZXIgfCB1bmRlZmluZWQsXG4gIGxpbWl0OiBudW1iZXIgfCB1bmRlZmluZWQsXG4gIGZpbGVQYXRoOiBzdHJpbmdcbik6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyB7XG4gIGlmIChvZmZzZXQgPT09IHVuZGVmaW5lZCAmJiBsaW1pdCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gJ3dob2xlLWZpbGUnO1xuICBjb25zdCBzdGFydCA9IG9mZnNldCA/PyAxO1xuICBsZXQgbGluZUNvdW50OiBudW1iZXI7XG4gIHRyeSB7XG4gICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCwgJ3V0ZjgnKTtcbiAgICBsaW5lQ291bnQgPSBjb250ZW50Lmxlbmd0aCA9PT0gMCA/IDAgOiBjb250ZW50LnNwbGl0KCdcXG4nKS5sZW5ndGg7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIH1cbiAgY29uc3QgZW5kID0gTWF0aC5taW4oc3RhcnQgKyAobGltaXQgPz8gREVGQVVMVF9SRUFEX0xJTUlUKSAtIDEsIE1hdGgubWF4KGxpbmVDb3VudCwgc3RhcnQpKTtcbiAgcmV0dXJuIHsgc3RhcnQsIGVuZCB9O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYSBjb3ZlcmluZyByb3cgaXMgYW4gYW5jaG9yIGluIHRoZSB0b3VjaGVkIGZpbGUgaXRzZWxmLiBgbGlzdFxuICogLS1wb3JjZWxhaW4gPGZpbGU+YCByZXR1cm5zIGV2ZXJ5IGFuY2hvciBvZiBlYWNoIG1hdGNoaW5nIHNwYW4gXHUyMDE0IGNyb3NzLWZpbGVcbiAqIGFuY2hvcnMgaW5jbHVkZWQgXHUyMDE0IGJ1dCBvbmx5IGFuY2hvcnMgaW4gdGhlIHRvdWNoZWQgZmlsZSBwYXJ0aWNpcGF0ZSBpbiB0aGVcbiAqIHJhbmdlLWludGVyc2VjdGlvbiBzY29wZSB0ZXN0LiBSb3cgcGF0aHMgYXJlIHJlcG8tcmVsYXRpdmU7IHRoZSB0b3VjaGVkIHBhdGhcbiAqIGlzIGFic29sdXRlLCBzbyBtYXRjaCBvbiBhbiBleGFjdCBvciBgL2Atc2VwYXJhdGVkIHN1ZmZpeC5cbiAqL1xuZnVuY3Rpb24gb25Ub3VjaGVkRmlsZShyb3c6IFBvcmNlbGFpblJvdywgZmlsZVBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gZmlsZVBhdGggPT09IHJvdy5wYXRoIHx8IGZpbGVQYXRoLmVuZHNXaXRoKGAvJHtyb3cucGF0aH1gKTtcbn1cblxuLyoqXG4gKiBDb21wdXRlIHRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrIGZvciB0aGUgdG91Y2gsIG9yIGBudWxsYCB3aGVuIHRoZXJlIGlzXG4gKiBub3RoaW5nIHdvcnRoIHN1cmZhY2luZy4gU2hhcmVkIGJ5IGJvdGggcGF0aHM7IHRoZSB3cml0ZSBwYXRoIHBhc3NlcyBhXG4gKiByZWNvdmVyZWQgcmFuZ2UgZm9yIHByZWNpc2lvbiwgdGhlIHJlYWQgcGF0aCBzY29wZXMgZmlsZS13aWRlLlxuICpcbiAqIEEgc3BhbiByZW5kZXJzIGFzIGEgZnVsbCBodW1hbi1mb3JtYXQgc2VjdGlvbiAobmFtZSwgYWxsIGFuY2hvcnMgd2l0aFxuICogZHJpZnRlZCBvbmVzIHN0YXR1cy1zdWZmaXhlZCwgd2h5KSB3aGVuIGl0cyBuYW1lIGhhcyBub3QgYmVlbiBzdXJmYWNlZCB0aGlzXG4gKiBzZXNzaW9uLCBvciB3aGVuIGl0IGNhcnJpZXMgYSBkcmlmdCBzdGF0dXMgbm90IHlldCBzdXJmYWNlZCBmb3IgaXQgXHUyMDE0IHNvIGFcbiAqIHNwYW4gZmlyc3Qgc2VlbiBoZWFsdGh5IHJlLXJlbmRlcnMgaW4gZnVsbCB3aGVuIGRyaWZ0IGxhdGVyIGFwcGVhcnMuIEEgc3BhblxuICogd2hvc2Ugb25seSBkcmlmdCBpcyBwb3NpdGlvbmFsIChgTU9WRURgL2BSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgXHUyMDE0IG5ldmVyXG4gKiBgaXNEZWJ0YCkgaXMgZmlsdGVyZWQgb3V0IGVudGlyZWx5OiBwb3NpdGlvbmFsIGRyaWZ0IG5ldmVyIHN1cmZhY2VzLlxuICovXG5hc3luYyBmdW5jdGlvbiBjb21wdXRlU3VyZmFjZShcbiAgaW5wdXQ6IFRvdWNoSW5wdXQsXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMsXG4gIG1lbW86IE1lbW9TdG9yZSxcbiAgcmFuZ2U6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJ1xuKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gIGNvbnN0IGNvdmVyaW5nID0gYXdhaXQgZXhlY3V0b3JzLmxpc3QoaW5wdXQuZmlsZVBhdGgsIGlucHV0LmN3ZCk7XG4gIGlmIChjb3ZlcmluZy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIEdyb3VwIGV2ZXJ5IGFuY2hvciBieSBzcGFuOyBhIHNwYW4gaXMgaW4gc2NvcGUgd2hlbiBvbmUgb2YgaXRzIGFuY2hvcnMgb25cbiAgLy8gdGhlIHRvdWNoZWQgZmlsZSBpbnRlcnNlY3RzIHRoZSByZWNvdmVyZWQgcmFuZ2UuXG4gIGNvbnN0IGFuY2hvcnNCeU5hbWUgPSBuZXcgTWFwPHN0cmluZywgUG9yY2VsYWluUm93W10+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIGNvdmVyaW5nKSB7XG4gICAgY29uc3Qgcm93cyA9IGFuY2hvcnNCeU5hbWUuZ2V0KHJvdy5uYW1lKSA/PyBbXTtcbiAgICByb3dzLnB1c2gocm93KTtcbiAgICBhbmNob3JzQnlOYW1lLnNldChyb3cubmFtZSwgcm93cyk7XG4gIH1cbiAgY29uc3QgdG91Y2hlZE5hbWVzID0gWy4uLmFuY2hvcnNCeU5hbWUua2V5cygpXS5maWx0ZXIoKG5hbWUpID0+XG4gICAgKGFuY2hvcnNCeU5hbWUuZ2V0KG5hbWUpID8/IFtdKS5zb21lKChyb3cpID0+IG9uVG91Y2hlZEZpbGUocm93LCBpbnB1dC5maWxlUGF0aCkgJiYgaW50ZXJzZWN0cyhyb3csIHJhbmdlKSlcbiAgKTtcbiAgaWYgKHRvdWNoZWROYW1lcy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGRyaWZ0Um93cyA9IGF3YWl0IGV4ZWN1dG9ycy5kcmlmdChbaW5wdXQuZmlsZVBhdGhdLCBpbnB1dC5jd2QpO1xuICBjb25zdCBkcmlmdEJ5TmFtZSA9IG5ldyBNYXA8c3RyaW5nLCBEcmlmdFBvcmNlbGFpblJvd1tdPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiBkcmlmdFJvd3MpIHtcbiAgICBjb25zdCByb3dzID0gZHJpZnRCeU5hbWUuZ2V0KHJvdy5uYW1lKSA/PyBbXTtcbiAgICByb3dzLnB1c2gocm93KTtcbiAgICBkcmlmdEJ5TmFtZS5zZXQocm93Lm5hbWUsIHJvd3MpO1xuICB9XG5cbiAgY29uc3Qgc3VyZmFjZWQgPSBtZW1vLmdldFN1cmZhY2VkKGlucHV0LnNlc3Npb25JZCk7XG4gIGNvbnN0IHRvUmVjb3JkOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBzZWN0aW9uczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgZHJpZnRlZE5hbWVzOiBzdHJpbmdbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgbmFtZSBvZiB0b3VjaGVkTmFtZXMpIHtcbiAgICBjb25zdCBzcGFuRHJpZnQgPSBkcmlmdEJ5TmFtZS5nZXQobmFtZSkgPz8gW107XG4gICAgY29uc3QgZGVidFJvd3MgPSBzcGFuRHJpZnQuZmlsdGVyKChyb3cpID0+IGlzRGVidChyb3cuc3RhdHVzKSk7XG4gICAgaWYgKHNwYW5EcmlmdC5sZW5ndGggPiAwICYmIGRlYnRSb3dzLmxlbmd0aCA9PT0gMCkgY29udGludWU7IC8vIHBvc2l0aW9uYWwtb25seSBkcmlmdCBuZXZlciBzdXJmYWNlc1xuXG4gICAgY29uc3QgZGVidFN0YXR1c2VzID0gWy4uLm5ldyBTZXQoZGVidFJvd3MubWFwKChyb3cpID0+IHJvdy5zdGF0dXMpKV0uc29ydCgpO1xuICAgIGNvbnN0IHVuc3VyZmFjZWREZWJ0ID0gZGVidFN0YXR1c2VzLmZpbHRlcigoc3RhdHVzKSA9PiAhc3VyZmFjZWQuaGFzKGRyaWZ0S2V5KG5hbWUsIHN0YXR1cykpKTtcbiAgICBjb25zdCBpc05ld05hbWUgPSAhc3VyZmFjZWQuaGFzKG5hbWUpO1xuICAgIGlmICghaXNOZXdOYW1lICYmIHVuc3VyZmFjZWREZWJ0Lmxlbmd0aCA9PT0gMCkgY29udGludWU7IC8vIGZ1bGx5IHN1cmZhY2VkIGFscmVhZHlcblxuICAgIGNvbnN0IHdoeSA9IGF3YWl0IGV4ZWN1dG9ycy53aHkobmFtZSwgaW5wdXQuY3dkKTtcbiAgICBzZWN0aW9ucy5wdXNoKHJlbmRlclNwYW5TZWN0aW9uKG5hbWUsIGFuY2hvcnNCeU5hbWUuZ2V0KG5hbWUpID8/IFtdLCBkZWJ0Um93cywgd2h5KSk7XG4gICAgaWYgKGRlYnRTdGF0dXNlcy5sZW5ndGggPiAwKSBkcmlmdGVkTmFtZXMucHVzaChuYW1lKTtcblxuICAgIGlmIChpc05ld05hbWUpIHRvUmVjb3JkLnB1c2gobmFtZSk7XG4gICAgZm9yIChjb25zdCBzdGF0dXMgb2YgdW5zdXJmYWNlZERlYnQpIHRvUmVjb3JkLnB1c2goZHJpZnRLZXkobmFtZSwgc3RhdHVzKSk7XG4gIH1cblxuICBpZiAoc2VjdGlvbnMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgbWVtby5hZGRTdXJmYWNlZChpbnB1dC5zZXNzaW9uSWQsIHRvUmVjb3JkKTtcbiAgY29uc3QgZmlsZU5hbWUgPSBiYXNlbmFtZShpbnB1dC5maWxlUGF0aCk7XG4gIGNvbnN0IGhlYWRlciA9IGRyaWZ0ZWROYW1lcy5sZW5ndGggPiAwID8gZHJpZnRIZWFkZXIoZHJpZnRlZE5hbWVzLmxlbmd0aCwgaW5wdXQua2luZCkgOiBjbGVhbkhlYWRlcihmaWxlTmFtZSk7XG4gIGNvbnN0IGZvb3RlciA9IGRyaWZ0ZWROYW1lcy5sZW5ndGggPiAwID8gZHJpZnRGb290ZXIoZHJpZnRlZE5hbWVzKSA6IGNsZWFuRm9vdGVyKGZpbGVOYW1lKTtcbiAgcmV0dXJuIGJ1aWxkQmxvY2soc2VjdGlvbnMsIGhlYWRlciwgZm9vdGVyKTtcbn1cblxuLyoqXG4gKiBSdW4gdGhlIHRvdWNoIGhvb2sgZm9yIGEgc2luZ2xlIHRvb2wgY2FsbCwgYnJhbmNoaW5nIG9uIHtAbGluayBUb3VjaElucHV0LmtpbmR9LlxuICpcbiAqIC0gKipXcml0ZSBwYXRoKio6IHtAbGluayBldmFsdWF0ZVdyaXRlR2F0ZX0gKHBsYW4gXHUwMEE3MyBzdGVwIDEpIHJ1bnMgZmlyc3QgXHUyMDE0XG4gKiAgIGFueSBkZWNpc2l2ZSBmYWlsLCBvciBhbiBpbmNvbmNsdXNpdmUgcGhhbnRvbSBkZWxldGUsIGJsb2NrcyB0aGUgdG91Y2hcbiAqICAgd2l0aCBubyBleGVjdXRvciBjYWxsIFx1MjAxNCB0aGVuIGBleGVjdXRvcnMuZml4YCAoYGdpdCBzcGFuIGRyaWZ0IDxmaWxlPlxuICogICAtLWZpeGApIHNjb3BlZCB0byB0aGUgdG91Y2hlZCBmaWxlIGhlYWxzIHBvc2l0aW9uYWwgZHJpZnQgaW4gdGhlIHdvcmtpbmdcbiAqICAgdHJlZSwgYW5kIHRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrIGlzIGNvbXB1dGVkIGFnYWluc3QgdGhlIGhlYWxlZFxuICogICBhbmNob3JzLCByZW5kZXJpbmcgZWFjaCBzdXJmYWNlZCBzcGFuIGFzIGEgZnVsbCBodW1hbi1mb3JtYXQgc2VjdGlvbiB3aXRoXG4gKiAgIGFueSByZW1haW5pbmcgc2VtYW50aWMgZHJpZnQgc3RhdHVzLXN1ZmZpeGVkIG9uIGl0cyBhbmNob3JzLiBDYWRlbmNlIGlzXG4gKiAgIGRlZHVwZWQgdGhyb3VnaCBgbWVtb2AgcGVyIHNwYW4gbmFtZSBhbmQgcGVyIChzcGFuLCBzdGF0dXMpLlxuICogLSAqKlJlYWQgcGF0aCoqOiBuZXZlciBpbnZva2VzIGBmaXhgIGFuZCBuZXZlciBtdXRhdGVzIHRoZSB0cmVlOyBzdXJmYWNlcyB0aGVcbiAqICAgc3BhbnMgb3ZlcmxhcHBpbmcgdGhlIHJlYWQncyBgb2Zmc2V0YC9gbGltaXRgIHdpbmRvdyAoc2VlXG4gKiAgIHtAbGluayByZWNvdmVyUmVhZFJhbmdlfTsgYSByZWFkIHdpdGggbmVpdGhlciBpcyB3aG9sZS1maWxlLCBtYXRjaGluZ1xuICogICB0b2RheSdzIGJlaGF2aW9yKSB3aXRoIHBvc2l0aW9uYWwgc3RhdHVzZXMgZmlsdGVyZWQgb3V0IHZpYSBgaXNEZWJ0KClgLlxuICpcbiAqIFRoZSBvcHRpb25hbCBgcHJvYmVDYWNoZWAgc2hhcmVzIHRoZSBkcml2ZXIncyBwZXItY29tbWFuZCBkZWxldGUtcmVhbGl0eVxuICogcHJvYmUgaW50byBwYXNzIEIgKHBsYW4gXHUwMEE3MyBzdGVwIDIpIHNvIHN1cnZpdmluZyBkZWxldGVzIHJlLWdhdGUgd2l0aG91dFxuICogcmUtcHJvYmluZzsgZGlyZWN0IGNhbGxlcnMgZ2V0IGEgcGVyLWNhbGwgY2FjaGUgc2VlZGVkIHdpdGggdGhlIHRvdWNoZWRcbiAqIHBhdGggd2hlbiB0aGUgdGFyZ2V0IGlzIGAnYWJzZW50J2AuXG4gKlxuICogRmFpbHMgb3BlbjogYW55IGV4ZWN1dG9yIHJlamVjdGlvbiBvciBpbnRlcm5hbCBlcnJvciB5aWVsZHNcbiAqIGBhZGRpdGlvbmFsQ29udGV4dDogbnVsbGAgKG5vIHNpZ25hbCwgZWRpdGluZyBuZXZlciBibG9ja2VkKSByYXRoZXIgdGhhblxuICogdGhyb3dpbmcuIGB0cmVlTW9kaWZpZWRgIHJlZmxlY3RzIGEgc3VjY2Vzc2Z1bCBgLS1maXhgIGV2ZW4gd2hlbiB0aGVcbiAqIHN1YnNlcXVlbnQgc3VyZmFjZSBjb21wdXRhdGlvbiBmYWlscy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJ1blRvdWNoSG9vayhcbiAgaW5wdXQ6IFRvdWNoSW5wdXQsXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMsXG4gIG1lbW86IE1lbW9TdG9yZSxcbiAgcHJvYmVDYWNoZT86IFJlYWxpdHlQcm9iZUNhY2hlXG4pOiBQcm9taXNlPFRvdWNoT3V0cHV0PiB7XG4gIGxldCB0cmVlTW9kaWZpZWQgPSBmYWxzZTtcbiAgdHJ5IHtcbiAgICBsZXQgcmFuZ2U6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyA9ICd3aG9sZS1maWxlJztcbiAgICBpZiAoaW5wdXQua2luZCA9PT0gJ3dyaXRlJykge1xuICAgICAgY29uc3QgcHJvYmUgPSBwcm9iZUNhY2hlID8/IGNyZWF0ZVJlYWxpdHlQcm9iZUNhY2hlKGlucHV0LnRhcmdldFN0YXRlID09PSAnYWJzZW50JyA/IFtpbnB1dC5maWxlUGF0aF0gOiBbXSk7XG4gICAgICBjb25zdCBvdXRjb21lID0gZXZhbHVhdGVXcml0ZUdhdGUoaW5wdXQsIHByb2JlKTtcbiAgICAgIGlmIChvdXRjb21lID09PSAnZGVjaXNpdmVGYWlsJyB8fCAob3V0Y29tZSA9PT0gJ2luY29uY2x1c2l2ZScgJiYgaW5wdXQudGFyZ2V0U3RhdGUgPT09ICdhYnNlbnQnKSkge1xuICAgICAgICByZXR1cm4geyBhZGRpdGlvbmFsQ29udGV4dDogbnVsbCwgdHJlZU1vZGlmaWVkOiBmYWxzZSB9O1xuICAgICAgfVxuICAgICAgY29uc3QgZml4ID0gYXdhaXQgZXhlY3V0b3JzLmZpeChpbnB1dC5maWxlUGF0aCwgaW5wdXQuY3dkKTtcbiAgICAgIHRyZWVNb2RpZmllZCA9IGZpeC5tb2RpZmllZDtcbiAgICAgIHJhbmdlID0gaW5wdXQucmFuZ2UgPz8gcmVjb3ZlclJhbmdlRnJvbURpc2soaW5wdXQud3JpdHRlbiwgaW5wdXQuZmlsZVBhdGgpO1xuICAgIH0gZWxzZSB7XG4gICAgICByYW5nZSA9IHJlY292ZXJSZWFkUmFuZ2UoaW5wdXQub2Zmc2V0LCBpbnB1dC5saW1pdCwgaW5wdXQuZmlsZVBhdGgpO1xuICAgIH1cbiAgICBjb25zdCBhZGRpdGlvbmFsQ29udGV4dCA9IGF3YWl0IGNvbXB1dGVTdXJmYWNlKGlucHV0LCBleGVjdXRvcnMsIG1lbW8sIHJhbmdlKTtcbiAgICByZXR1cm4geyBhZGRpdGlvbmFsQ29udGV4dCwgdHJlZU1vZGlmaWVkIH07XG4gIH0gY2F0Y2gge1xuICAgIC8vIEZhaWwgb3BlbjogbmV2ZXIgbGV0IGEgdG91Y2gtY29yZSBlcnJvciBwcm9wYWdhdGUgdXAgYW5kIGJsb2NrIHRoZSB0b29sXG4gICAgLy8gY2FsbC4gVGhlIHRyZWUgbWF5IGFscmVhZHkgaGF2ZSBiZWVuIGhlYWxlZCAodHJlZU1vZGlmaWVkIHByZXNlcnZlZCkuXG4gICAgcmV0dXJuIHsgYWRkaXRpb25hbENvbnRleHQ6IG51bGwsIHRyZWVNb2RpZmllZCB9O1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGVmYXVsdCBzdWJwcm9jZXNzLWJhY2tlZCBleGVjdXRvcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBERUZBVUxUX1RJTUVPVVRfTVMgPSAxMF8wMDA7XG5cbi8qKiBSZXNvbHZlIHRoZSB0b3VjaGVkIGZpbGUgdG8gYSBwYXRoIHJlbGF0aXZlIHRvIGl0cyByZXBvIHJvb3QsIGZvciBgZ2l0IHNwYW5gLiAqL1xuZnVuY3Rpb24gcmVwb1JlbEFyZyhmaWxlUGF0aDogc3RyaW5nLCBjd2Q6IHN0cmluZyk6IHsgcmVwb1Jvb3Q6IHN0cmluZzsgcmVsUGF0aDogc3RyaW5nIH0gfCBudWxsIHtcbiAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgaWYgKCFyZXBvUm9vdCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IHJlcG9Sb290LCByZWxQYXRoOiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgZmlsZVBhdGgpIH07XG59XG5cbi8qKlxuICogQSBzbmFwc2hvdCBvZiB0aGUgc3BhbiByb290J3Mgd29ya2luZy10cmVlIHN0YXR1cywgdXNlZCB0byBkZXRlY3Qgd2hldGhlciBhXG4gKiBgLS1maXhgIHJlLWFuY2hvcmVkIGFueXRoaW5nLiBDb21wYXJlZCBiZWZvcmUvYWZ0ZXI7IGFuIHVucmVzb2x2YWJsZSByZXBvIG9yXG4gKiBhIGZhaWxlZCBzdGF0dXMgeWllbGRzIGEgc3RhYmxlIGVtcHR5IHN0cmluZyAoXHUyMTkyIGBtb2RpZmllZDogZmFsc2VgKS5cbiAqL1xuZnVuY3Rpb24gc3BhblN0YXR1c1NuYXBzaG90KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBzcGFuUm9vdCA9IHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdCk7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnc3RhdHVzJywgJy0tcG9yY2VsYWluJywgJy0tJywgc3BhblJvb3RdLCB7XG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICB0aW1lb3V0OiBERUZBVUxUX1RJTUVPVVRfTVNcbiAgICB9KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuICcnO1xuICB9XG59XG5cbi8qKlxuICogVGhlIHByb2R1Y3Rpb24gZXhlY3V0aW9uIHN1cmZhY2U6IHRocmVlIHN1YnByb2Nlc3MtYmFja2VkIGV4ZWN1dG9ycyBmb2xsb3dpbmdcbiAqIHNwYW4tc3VyZmFjZS50cydzIGBjcmVhdGVEZWZhdWx0KkV4ZWN1dG9yYCBzdHlsZS4gRWFjaCBjYXB0dXJlcyBzdGRvdXQgZXZlbiBvblxuICogYSBub24temVybyBleGl0IHdoZXJlIHRoZSBDTEkgc3RpbGwgZW1pdHMgdXNlZnVsIG91dHB1dCwgYW5kIGV2ZXJ5IGZhaWx1cmVcbiAqIG1vZGUgKGFic2VudCBiaW5hcnksIHRpbWVvdXQsIHBhcnNlIGZhaWx1cmUpIHN1cmZhY2VzIGFzIGFuIGVtcHR5L2NsZWFuIHJlc3VsdFxuICogc28ge0BsaW5rIHJ1blRvdWNoSG9va30ncyBmYWlsLW9wZW4gY29udHJhY3QgaG9sZHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0VG91Y2hFeGVjdXRvcnModGltZW91dE1zOiBudW1iZXIgPSBERUZBVUxUX1RJTUVPVVRfTVMpOiBUb3VjaEV4ZWN1dG9ycyB7XG4gIHJldHVybiB7XG4gICAgZml4OiBhc3luYyAoZmlsZVBhdGgsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVzb2x2ZWQgPSByZXBvUmVsQXJnKGZpbGVQYXRoLCBjd2QpO1xuICAgICAgaWYgKCFyZXNvbHZlZCkgcmV0dXJuIHsgbW9kaWZpZWQ6IGZhbHNlIH07XG4gICAgICBjb25zdCBiZWZvcmUgPSBzcGFuU3RhdHVzU25hcHNob3QocmVzb2x2ZWQucmVwb1Jvb3QpO1xuICAgICAgdHJ5IHtcbiAgICAgICAgZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnZHJpZnQnLCByZXNvbHZlZC5yZWxQYXRoLCAnLS1maXgnXSwge1xuICAgICAgICAgIGN3ZDogcmVzb2x2ZWQucmVwb1Jvb3QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIHZvaWQgZXJyOyAvLyBgZ2l0IHNwYW4gZHJpZnRgIGV4aXRzIDEgb24gZHJpZnQgZXZlbiB3aGVuIGAtLWZpeGAgaGVhbGVkIHNvbWV0aGluZywgYW5kXG4gICAgICAgIC8vIG5vbi16ZXJvIG9uIGdlbnVpbmUgZmFpbHVyZTsgdGhlIHNuYXBzaG90IGRpZmYgaXMgdGhlIHNvdXJjZSBvZlxuICAgICAgICAvLyB0cnV0aCBmb3Igd2hldGhlciB0aGUgdHJlZSBjaGFuZ2VkLCBzbyB0aGUgZXhpdCBjb2RlIGlzIGlnbm9yZWQgaGVyZS5cbiAgICAgIH1cbiAgICAgIGNvbnN0IGFmdGVyID0gc3BhblN0YXR1c1NuYXBzaG90KHJlc29sdmVkLnJlcG9Sb290KTtcbiAgICAgIHJldHVybiB7IG1vZGlmaWVkOiBiZWZvcmUgIT09IGFmdGVyIH07XG4gICAgfSxcblxuICAgIGxpc3Q6IGFzeW5jIChmaWxlUGF0aCwgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXNvbHZlZCA9IHJlcG9SZWxBcmcoZmlsZVBhdGgsIGN3ZCk7XG4gICAgICBpZiAoIXJlc29sdmVkKSByZXR1cm4gW107XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdsaXN0JywgJy0tcG9yY2VsYWluJywgcmVzb2x2ZWQucmVsUGF0aF0sIHtcbiAgICAgICAgICBjd2Q6IHJlc29sdmVkLnJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHBhcnNlUG9yY2VsYWluKG91dCk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBkcmlmdDogYXN5bmMgKGFyZ3MsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIGNvbnN0IHJ1bkN3ZCA9IHJlcG9Sb290ID8/IGN3ZDtcbiAgICAgIC8vIFRoZSBjb3JlIHBhc3NlcyBhbiBhYnNvbHV0ZSBmaWxlIHBhdGg7IHNjb3BlIGBnaXQgc3BhbiBkcmlmdGAgdG8gaXRcbiAgICAgIC8vIHJlbGF0aXZlIHRvIHRoZSByZXBvIHJvb3Qgc28gdGhlIHBhdGggaW5kZXggcmVzb2x2ZXMgaXQuXG4gICAgICBjb25zdCBzY29wZWQgPSByZXBvUm9vdCA/IGFyZ3MubWFwKChhKSA9PiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgYSkpIDogYXJncztcbiAgICAgIGxldCBvdXQ6IHN0cmluZztcbiAgICAgIHRyeSB7XG4gICAgICAgIG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2RyaWZ0JywgJy0tZm9ybWF0JywgJ3BvcmNlbGFpbicsIC4uLnNjb3BlZF0sIHtcbiAgICAgICAgICBjd2Q6IHJ1bkN3ZCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgY29uc3QgY2FwdHVyZWQgPSAoZXJyIGFzIHsgc3Rkb3V0Pzogc3RyaW5nIH0pLnN0ZG91dDtcbiAgICAgICAgaWYgKHR5cGVvZiBjYXB0dXJlZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICBvdXQgPSBjYXB0dXJlZDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiBwYXJzZURyaWZ0UG9yY2VsYWluKG91dCk7XG4gICAgfSxcblxuICAgIHdoeTogYXN5bmMgKG5hbWUsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ3doeScsIG5hbWVdLCB7XG4gICAgICAgICAgY3dkOiByZXBvUm9vdCA/PyBjd2QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCB0ZXh0ID0gb3V0LnRyaW1FbmQoKTtcbiAgICAgICAgLy8gQmFyZSBgZ2l0IHNwYW4gd2h5YCBwcmludHMgdGhpcyBleGFjdCBzZW50aW5lbCAoZXhpdCAwKSB3aGVuIHRoZVxuICAgICAgICAvLyBzcGFuIGhhcyBubyB3aHkgcmVjb3JkZWQgXHUyMDE0IHRyZWF0IGl0IGFzIFwibm8gd2h5XCIsIG5vdCBhcyBjb250ZW50LlxuICAgICAgICBpZiAodGV4dC5sZW5ndGggPT09IDAgfHwgdGV4dCA9PT0gYFxcYCR7bmFtZX1cXGAgaGFzIG5vIHdoeSByZWNvcmRlZC5gKSByZXR1cm4gbnVsbDtcbiAgICAgICAgcmV0dXJuIHRleHQ7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgfVxuICB9O1xufVxuIiwgIi8qKlxuICogU2hhcmVkIGJveC1kcmF3aW5nIHRyZWUgcmVuZGVyZXIgZm9yIGEgc3BhbidzIGFuY2hvciBsaXN0LCB1c2VkIGJ5IGV2ZXJ5XG4gKiBjYWxsIHNpdGUgdGhhdCB0b2RheSBwcmludHMgYSBmbGF0IGAtIHBhdGgjTHN0YXJ0LUxlbmRgIGJ1bGxldCBydW5cbiAqIChgdG91Y2gtY29yZS50c2AncyBgYW5jaG9yQnVsbGV0c2AsIGFuZCBgYWR2aXNvci1jb3JlLnRzYCdzXG4gKiBgYW5ub3RhdGVCbG9ja3NgL2Bncm91cENvdmVyaW5nQnlOYW1lYCkuIEFuY2hvcnMgdGhhdCBzaGFyZSBhIGRpcmVjdG9yeVxuICogcHJlZml4IGNvbGxhcHNlIGludG8gb25lIHRyZWUgaW5zdGVhZCBvZiBiZWluZyByZWNvbnN0cnVjdGVkIGJ5IGV5ZSBmcm9tIGFcbiAqIGZsYXQgbGlzdCBcdTIwMTQgdGhlIG1vdGl2YXRpbmcgY2FzZSBpcyBwYXJpdHkgYW5jaG9ycyB1bmRlciBwYXJhbGxlbFxuICogYHB1YmxpYy9jbGF1ZGUvLi4uYC9gcHVibGljL2NvZGV4Ly4uLmAgdHJlZXMuXG4gKlxuICogVGhpcyBtb2R1bGUgaXMgYSBwdXJlIHByZXNlbnRhdGlvbiB0cmFuc2Zvcm06IGl0IG5ldmVyIGNvbXB1dGVzIGRyaWZ0XG4gKiBzdGF0dXMgb3IgZGVjaWRlcyB3aGljaCBhbmNob3JzIGFyZSBzdXJmYWNlZC4gQ2FsbGVycyBwcmVjb21wdXRlIGVhY2ggcm93J3NcbiAqIGBzdWZmaXhgIChlLmcuIGAgXHUyMDE0IGNoYW5nZWRgKSBleGFjdGx5IGFzIHRoZXkgZG8gdG9kYXksIGFuZCBvbmx5IHRoZSAqc2hhcGUqXG4gKiBvZiB0aGUgcHJpbnRlZCBsaXN0IGNoYW5nZXMuXG4gKi9cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQdWJsaWMgdHlwZXNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIEhvdyBhIHNpbmdsZSBhbmNob3IncyBsaW5lIHJhbmdlIGlzIGtub3duLiBgcmFuZ2VgIGFuZCBgd2hvbGUtZmlsZWAgYXJlIHRoZVxuICogdHdvIHNoYXBlcyBldmVyeSBhbmNob3IgdGFrZXMgdG9kYXk7IGB0cnVuY2F0ZWRgIGlzIGEgZGVmZW5zaXZlIHRoaXJkIHNoYXBlXG4gKiByZWFjaGFibGUgb25seSBmcm9tIHJlLXBhcnNpbmcgdGhlIENMSSdzIGZsYXQgaHVtYW4tZm9ybWF0IHRleHQgKGEgYCNMYFxuICogZnJhZ21lbnQgdGhhdCBkb2Vzbid0IGNsZWFubHkgbWF0Y2ggYCNMc3RhcnQtTGVuZGApLlxuICpcbiAqIFZlcmlmaWVkIGludmFyaWFudDogdGhlIHN0cnVjdHVyZWQtZGF0YSBjYWxsIHNpdGVzIGNhbiBuZXZlciBwcm9kdWNlXG4gKiBgdHJ1bmNhdGVkYC4gYHBhcnNlUG9yY2VsYWluYCAoYWdlbnQtaG9va3MtY29tbW9uLnRzKSBgY29udGludWVgcyBwYXN0IGFueVxuICogcm93IG1pc3NpbmcgYSB2YWxpZCByYW5nZSwgc28gYW4gaW5jb21wbGV0ZSBgUG9yY2VsYWluUm93YCBjYW4gbmV2ZXIgYmVcbiAqIGNvbnN0cnVjdGVkOyB0aGUgUnVzdCBDTEkncyBvd24gcG9yY2VsYWluIHdyaXRlciBhbHdheXMgZW1pdHMgYSByYW5nZVxuICogY29sdW1uIChgMC0wYCBmb3Igd2hvbGUtZmlsZSkuIGB0cnVuY2F0ZWRgIGlzIHJlYWNoYWJsZSBvbmx5IGZyb21cbiAqIGBhbm5vdGF0ZUJsb2Nrc2AnIGZsYXQtdGV4dCBwYXJzaW5nIG9mIGBibG9ja3NUZXh0YCBpbiBhIGxhdGVyIHBoYXNlLlxuICovXG5leHBvcnQgdHlwZSBSYW5nZUxhYmVsID0geyBraW5kOiAncmFuZ2UnOyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9IHwgeyBraW5kOiAnd2hvbGUtZmlsZScgfSB8IHsga2luZDogJ3RydW5jYXRlZCcgfTtcblxuLyoqIE9uZSBzdGFja2VkIHJhbmdlIHVuZGVyIGEgYFRyZWVBbmNob3JgLCB3aXRoIGl0cyBwcmVjb21wdXRlZCBkcmlmdCBzdWZmaXguICovXG5leHBvcnQgaW50ZXJmYWNlIFJhbmdlRW50cnkge1xuICByYW5nZTogUmFuZ2VMYWJlbDtcbiAgLyoqIFByZWNvbXB1dGVkIGAgXHUyMDE0IGNoYW5nZWRgIChldGMuKSwgb3IgYCcnYCB3aGVuIHRoZSBhbmNob3IgY2FycmllcyBubyBkcmlmdC4gKi9cbiAgc3VmZml4OiBzdHJpbmc7XG59XG5cbi8qKiBPbmUgZGlzdGluY3QgcGF0aCdzIGNvbGxhcHNlZCBhbmNob3IgZW50cnksIHJlYWR5IGZvciB0cmVlIGxheW91dC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVHJlZUFuY2hvciB7XG4gIC8qKiBSZXBvLXJlbGF0aXZlLCBwb3NpeC1zZXBhcmF0ZWQgcGF0aC4gKi9cbiAgcGF0aDogc3RyaW5nO1xuICAvKipcbiAgICogU3RhY2tlZCByYW5nZXMgb24gdGhpcyBwYXRoLiBFbXB0eSBtZWFucyBcInBhdGggb25seSwgbm8gcmFuZ2UgY29sdW1uIGF0XG4gICAqIGFsbFwiIFx1MjAxNCBhIGJhcmUtcGF0aCBsZWFmLCBkaXN0aW5jdCBmcm9tIGEgc2luZ2xlIGB3aG9sZS1maWxlYCBlbnRyeSAod2hpY2hcbiAgICogcmVuZGVycyB0aGUgcGF0aCB0b28sIGJ1dCBpcyBhbiBleHBsaWNpdCByYW5nZS1raW5kIGNsYXNzaWZpY2F0aW9uKS5cbiAgICovXG4gIHJhbmdlczogUmFuZ2VFbnRyeVtdO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIGNvbGxhcHNlQnlQYXRoXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBDb2xsYXBzZSByb3dzIHRoYXQgbmFtZSB0aGUgc2FtZSBwYXRoIGludG8gb25lIGBUcmVlQW5jaG9yYCB3aXRoIHN0YWNrZWRcbiAqIHJhbmdlcywgcHJlc2VydmluZyBmaXJzdC1zZWVuIG9yZGVyLiBgcmVuZGVyQW5jaG9yVHJlZWAncyBjb250cmFjdCByZXF1aXJlc1xuICogYXQgbW9zdCBvbmUgYFRyZWVBbmNob3JgIHBlciBkaXN0aW5jdCBwYXRoIFx1MjAxNCB0aGlzIGlzIHRoZSBtYW5kYXRvcnlcbiAqIHByZS1wcm9jZXNzaW5nIHN0ZXAgZXZlcnkgY2FsbGVyIHJ1bnMgZmlyc3QgdG8gZ3VhcmFudGVlIHRoYXQuXG4gKlxuICogTWlycm9ycyB0aGUgb3JkZXItYXJyYXktcGx1cy1NYXAgaWRpb20gYWxyZWFkeSB1c2VkIGJ5XG4gKiBgZGVkdXBlQnlBbmNob3IoKWAgKGFkdmlzb3ItY29yZS50cykgZm9yIHRoZSBzYW1lIHJlYXNvbjogdGhlIENMSSBjYW4gZW1pdFxuICogbXVsdGlwbGUgcm93cyBmb3Igb25lIGxvZ2ljYWwgcGF0aCwgYW5kIHRoZSAqcG9zaXRpb24qIG9mIGEgbGF0ZXJcbiAqIHNhbWUtcGF0aCByb3cgaXMgc3Vic3VtZWQgaW50byB0aGF0IHBhdGgncyBmaXJzdCBvY2N1cnJlbmNlLCBub3QgYXBwZW5kZWRcbiAqIGF0IGl0cyBvd24gbGF0ZXIgcG9zaXRpb24uIENvbmNyZXRlbHk6IGBhLnRzI0wxLUw1YCwgYGIudHMjTDEtTDVgLFxuICogYGEudHMjTDktTDEyYCBjb2xsYXBzZXMgdG8gYFthLnRzICh0d28gc3RhY2tlZCByYW5nZXMpLCBiLnRzIChvbmUgcmFuZ2UpXWBcbiAqIFx1MjAxNCBgYS50c2Agc2l0cyBhdCBwb3NpdGlvbiAwLCBpdHMgZmlyc3Qgb2NjdXJyZW5jZSwgbm90IGl0cyBsYXN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29sbGFwc2VCeVBhdGgocm93czogeyBwYXRoOiBzdHJpbmc7IHJhbmdlOiBSYW5nZUxhYmVsOyBzdWZmaXg6IHN0cmluZyB9W10pOiBUcmVlQW5jaG9yW10ge1xuICBjb25zdCBvcmRlcjogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgYnlQYXRoID0gbmV3IE1hcDxzdHJpbmcsIFRyZWVBbmNob3I+KCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBsZXQgYW5jaG9yID0gYnlQYXRoLmdldChyb3cucGF0aCk7XG4gICAgaWYgKCFhbmNob3IpIHtcbiAgICAgIGFuY2hvciA9IHsgcGF0aDogcm93LnBhdGgsIHJhbmdlczogW10gfTtcbiAgICAgIGJ5UGF0aC5zZXQocm93LnBhdGgsIGFuY2hvcik7XG4gICAgICBvcmRlci5wdXNoKHJvdy5wYXRoKTtcbiAgICB9XG4gICAgYW5jaG9yLnJhbmdlcy5wdXNoKHsgcmFuZ2U6IHJvdy5yYW5nZSwgc3VmZml4OiByb3cuc3VmZml4IH0pO1xuICB9XG4gIHJldHVybiBvcmRlci5tYXAoKHBhdGgpID0+IGJ5UGF0aC5nZXQocGF0aCkgYXMgVHJlZUFuY2hvcik7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVHJlZSBjb25zdHJ1Y3Rpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5pbnRlcmZhY2UgTGVhZk5vZGUge1xuICBraW5kOiAnbGVhZic7XG4gIG5hbWU6IHN0cmluZztcbiAgYW5jaG9yOiBUcmVlQW5jaG9yO1xufVxuXG5pbnRlcmZhY2UgRGlyTm9kZSB7XG4gIGtpbmQ6ICdkaXInO1xuICBuYW1lOiBzdHJpbmc7XG4gIGNoaWxkcmVuOiBQYXRoVHJlZU5vZGVbXTtcbn1cblxudHlwZSBQYXRoVHJlZU5vZGUgPSBMZWFmTm9kZSB8IERpck5vZGU7XG5cbi8qKlxuICogU3BsaXQgYSBwYXRoIGludG8gYC9gLXNlcGFyYXRlZCBzZWdtZW50cywgb3IgYG51bGxgIHdoZW4gZG9pbmcgc28gd291bGRcbiAqIGZlZWQgYW4gZW1wdHktc3RyaW5nIHNlZ21lbnQgaW50byB0aGUgdHJpZSAoYSBsZWFkaW5nIGAvYCwgYSB0cmFpbGluZyBgL2AsXG4gKiBhIGRvdWJsZWQgYC8vYCwgb3IgdGhlIGVtcHR5IHN0cmluZykuIGBudWxsYCBzaWduYWxzIHRoZSBjYWxsZXIgdG8gcmVuZGVyXG4gKiB0aGF0IGFuY2hvcidzIGZ1bGwgcGF0aCBzdHJpbmcgYXMgYSBzaW5nbGUsIHVuc3BsaXQsIGF0b21pYyB0b3AtbGV2ZWwgbGVhZlxuICogaW5zdGVhZCBvZiBhdHRlbXB0aW5nIHRvIG5lc3QgaXQgXHUyMDE0IGEga25vd24tZW51bWVyYWJsZSBjbGFzcyBvZiBtYWxmb3JtZWRcbiAqIHBhdGhzIGdldHMgYSByZWFsIHJ1bGUgaGVyZSByYXRoZXIgdGhhbiB0aGUgc3BsaXQgcnVubmluZyBhbnl3YXkgYW5kXG4gKiBmYWJyaWNhdGluZyBhbiBlbXB0eS1uYW1lZCBkaXJlY3Rvcnkgbm9kZS4gQSBiYXJlIGZpbGVuYW1lIHdpdGggbm8gYC9gIGF0XG4gKiBhbGwgcHJvZHVjZXMgZXhhY3RseSBvbmUgbm9uLWVtcHR5IHNlZ21lbnQgYW5kIGlzIGhhbmRsZWQgYnkgdGhlIG9yZGluYXJ5XG4gKiBwYXRoIGJlbG93IChpdCBiZWNvbWVzIGEgdG9wLWxldmVsIGxlYWYgd2l0aCBubyBkaXJlY3RvcnkgdG8gbmVzdCB1bmRlciBcdTIwMTRcbiAqIGFscmVhZHkgYXRvbWljLCBubyBzcGVjaWFsIGNhc2UgbmVlZGVkKS5cbiAqL1xuZnVuY3Rpb24gc3BsaXRTZWdtZW50cyhwYXRoOiBzdHJpbmcpOiBzdHJpbmdbXSB8IG51bGwge1xuICBpZiAocGF0aC5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBjb25zdCBzZWdtZW50cyA9IHBhdGguc3BsaXQoJy8nKTtcbiAgaWYgKHNlZ21lbnRzLnNvbWUoKHNlZ21lbnQpID0+IHNlZ21lbnQubGVuZ3RoID09PSAwKSkgcmV0dXJuIG51bGw7XG4gIHJldHVybiBzZWdtZW50cztcbn1cblxuZnVuY3Rpb24gZmluZE9yQ3JlYXRlRGlyKHBhcmVudDogRGlyTm9kZSwgbmFtZTogc3RyaW5nKTogRGlyTm9kZSB7XG4gIGZvciAoY29uc3QgY2hpbGQgb2YgcGFyZW50LmNoaWxkcmVuKSB7XG4gICAgaWYgKGNoaWxkLmtpbmQgPT09ICdkaXInICYmIGNoaWxkLm5hbWUgPT09IG5hbWUpIHJldHVybiBjaGlsZDtcbiAgfVxuICBjb25zdCBub2RlOiBEaXJOb2RlID0geyBraW5kOiAnZGlyJywgbmFtZSwgY2hpbGRyZW46IFtdIH07XG4gIHBhcmVudC5jaGlsZHJlbi5wdXNoKG5vZGUpO1xuICByZXR1cm4gbm9kZTtcbn1cblxuLyoqIEluc2VydCBvbmUgYW5jaG9yIGludG8gdGhlIHRyaWUsIGNyZWF0aW5nL3JldXNpbmcgZGlyZWN0b3J5IG5vZGVzIGluIGFycml2YWwgb3JkZXIuICovXG5mdW5jdGlvbiBpbnNlcnRBbmNob3Iocm9vdDogRGlyTm9kZSwgc2VnbWVudHM6IHN0cmluZ1tdLCBhbmNob3I6IFRyZWVBbmNob3IpOiB2b2lkIHtcbiAgbGV0IGN1ciA9IHJvb3Q7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2VnbWVudHMubGVuZ3RoIC0gMTsgaSsrKSB7XG4gICAgY3VyID0gZmluZE9yQ3JlYXRlRGlyKGN1ciwgc2VnbWVudHNbaV0pO1xuICB9XG4gIGN1ci5jaGlsZHJlbi5wdXNoKHsga2luZDogJ2xlYWYnLCBuYW1lOiBzZWdtZW50c1tzZWdtZW50cy5sZW5ndGggLSAxXSwgYW5jaG9yIH0pO1xufVxuXG4vKipcbiAqIEJ1aWxkIHRoZSB0b3AtbGV2ZWwgZm9yZXN0IGZyb20gYSBgVHJlZUFuY2hvcltdYCBhbHJlYWR5IGNvbGxhcHNlZCBieVxuICogYGNvbGxhcHNlQnlQYXRoYC4gU2libGluZyBvcmRlciBpcyBuZXZlciByZS1zb3J0ZWQgXHUyMDE0IGEgcGF0aCBlaXRoZXIgb3BlbnMgYVxuICogbmV3IG5vZGUgYXQgaXRzIGFycml2YWwgcG9zaXRpb24gb3IgaXMgbmVzdGVkIHVuZGVyIGEgZGlyZWN0b3J5IG5vZGVcbiAqIGNyZWF0ZWQvcmV1c2VkIGF0IHRoYXQgZGlyZWN0b3J5J3Mgb3duIGZpcnN0LW9jY3VycmVuY2UgcG9zaXRpb24uXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkRm9yZXN0KGFuY2hvcnM6IFRyZWVBbmNob3JbXSk6IFBhdGhUcmVlTm9kZVtdIHtcbiAgY29uc3Qgcm9vdDogRGlyTm9kZSA9IHsga2luZDogJ2RpcicsIG5hbWU6ICcnLCBjaGlsZHJlbjogW10gfTtcbiAgZm9yIChjb25zdCBhbmNob3Igb2YgYW5jaG9ycykge1xuICAgIGNvbnN0IHNlZ21lbnRzID0gc3BsaXRTZWdtZW50cyhhbmNob3IucGF0aCk7XG4gICAgaWYgKHNlZ21lbnRzID09PSBudWxsKSB7XG4gICAgICByb290LmNoaWxkcmVuLnB1c2goeyBraW5kOiAnbGVhZicsIG5hbWU6IGFuY2hvci5wYXRoLCBhbmNob3IgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaW5zZXJ0QW5jaG9yKHJvb3QsIHNlZ21lbnRzLCBhbmNob3IpO1xuICB9XG4gIHJldHVybiByb290LmNoaWxkcmVuO1xufVxuXG4vKiogQSBub2RlIHBhaXJlZCB3aXRoIHRoZSAocG9zc2libHkgZm9sZGVkKSBuYW1lIGl0IGRpc3BsYXlzIG9uIGl0cyBvd24gbGluZS4gKi9cbmludGVyZmFjZSBEaXNwbGF5SXRlbSB7XG4gIG5hbWU6IHN0cmluZztcbiAgbm9kZTogUGF0aFRyZWVOb2RlO1xufVxuXG4vKipcbiAqIEZvbGQgYSBjaGFpbiBvZiBzaW5nbGUtY2hpbGQgbm9kZXMgaW50byBvbmUgY29tYmluZWQgbmFtZVxuICogKGBwdWJsaWMvY2xhdWRlL3J1bnRpbWUvc2tpbGxzL2NhcmRgLCBgZGlydHkvbW9kLnJzYCxcbiAqIGAuZGV2Y29udGFpbmVyL0RvY2tlcmZpbGVgKS4gRm9sZGluZyBjb250aW51ZXMgd2hpbGUgdGhlIGN1cnJlbnQgbm9kZSBpcyBhXG4gKiBkaXJlY3Rvcnkgd2l0aCAqKmV4YWN0bHkgb25lIGNoaWxkKiosIHJlZ2FyZGxlc3Mgb2Ygd2hldGhlciB0aGF0IGNoaWxkIGlzIGFcbiAqIGRpcmVjdG9yeSBvciBhIGxlYWY6IGEgbm9kZSB3aXRoIG9uZSBjaGlsZCBjb252ZXlzIG5vIGdyb3VwaW5nIGJ5XG4gKiBkZWZpbml0aW9uLCBzbyBmb2xkaW5nIGl0IGxvc2VzIG5vIHN0cnVjdHVyZSB3aGlsZSByZW1vdmluZyBhIGxpbmUgd2hvc2VcbiAqIG9ubHkgY29udGVudCBpcyBhIGNvbm5lY3Rvci4gU3RvcHMgYXQgdGhlIGZpcnN0IGRpcmVjdG9yeSB3aXRoIDIrIGNoaWxkcmVuXG4gKiAoZXhwYW5kIGZyb20gdGhlcmUpIG9yIGF0IGEgbGVhZiAod2hpY2ggdGhlbiByZW5kZXJzIHdpdGggdGhlIGZvbGRlZCBuYW1lKS5cbiAqXG4gKiBGb2xkaW5nIGxvbmUgKmxlYXZlcyogXHUyMDE0IG5vdCBqdXN0IGxvbmUgZGlyZWN0b3JpZXMgXHUyMDE0IGlzIHdoYXQga2VlcHMgdGhlIHRyZWVcbiAqIG5vIHRhbGxlciB0aGFuIHRoZSBmbGF0IGJ1bGxldCBsaXN0IGl0IHJlcGxhY2VzLCBhbmQgd2hhdCBtYWtlcyBhIHNpbmdsZVxuICogYW5jaG9yIHJlbmRlciBhcyB0aGUgb25lLWxpbmUgdHJlZSB0aGUgcGxhbiBwcm9taXNlcyBldmVuIHdoZW4gaXRzIHBhdGggaGFzXG4gKiBkaXJlY3RvcmllcyBpbiBpdC4gSXQgYWxzbyBrZWVwcyB0aGUgZGlzY3JpbWluYXRpbmcgc2VnbWVudCBvbiB0aGUgc2FtZVxuICogbGluZSBhcyBpdHMgcmFuZ2UgKGBkaXJ0eS9tb2QucnMgI0wzOTItTDM5OWApIGZvciBgbW9kLnJzYC9gaW5kZXgudHNgXG4gKiBsYXlvdXRzLCB3aGVyZSB0aGUgZmlsZW5hbWUgYWxvbmUgaWRlbnRpZmllcyBub3RoaW5nLlxuICovXG5mdW5jdGlvbiBmb2xkQ2hhaW4obm9kZTogUGF0aFRyZWVOb2RlKTogRGlzcGxheUl0ZW0ge1xuICBsZXQgbmFtZSA9IG5vZGUubmFtZTtcbiAgbGV0IGN1ciA9IG5vZGU7XG4gIHdoaWxlIChjdXIua2luZCA9PT0gJ2RpcicgJiYgY3VyLmNoaWxkcmVuLmxlbmd0aCA9PT0gMSkge1xuICAgIGNvbnN0IGNoaWxkID0gY3VyLmNoaWxkcmVuWzBdO1xuICAgIG5hbWUgPSBgJHtuYW1lfS8ke2NoaWxkLm5hbWV9YDtcbiAgICBjdXIgPSBjaGlsZDtcbiAgfVxuICByZXR1cm4geyBuYW1lLCBub2RlOiBjdXIgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSZW5kZXJpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJhbmsgb2YgYSBzdGFja2VkIGVudHJ5J3MgcmFuZ2Uga2luZDogYHdob2xlLWZpbGVgIGZpcnN0LCB0aGVuIG51bWVyaWNcbiAqIGByYW5nZWBzLCB0aGVuIGB0cnVuY2F0ZWRgLiBBIHdob2xlLWZpbGUgYW5jaG9yIGlzIHRoZSBDTEkncyBgMC0wYCByb3cgXHUyMDE0IGl0XG4gKiBjb3ZlcnMgdGhlIGVudGlyZSBmaWxlLCBzbyBpdCBzb3J0cyBhaGVhZCBvZiBldmVyeSBsaW5lIHJhbmdlIG9uIHRoYXQgZmlsZVxuICogdGhlIHNhbWUgd2F5IGxpbmUgMCB3b3VsZC4gYHRydW5jYXRlZGAgY2FycmllcyBubyBwb3NpdGlvbiBhdCBhbGwgYW5kIHNvcnRzXG4gKiBsYXN0LlxuICovXG5mdW5jdGlvbiByYW5nZVJhbmsocmFuZ2U6IFJhbmdlTGFiZWwpOiBudW1iZXIge1xuICBzd2l0Y2ggKHJhbmdlLmtpbmQpIHtcbiAgICBjYXNlICd3aG9sZS1maWxlJzpcbiAgICAgIHJldHVybiAwO1xuICAgIGNhc2UgJ3JhbmdlJzpcbiAgICAgIHJldHVybiAxO1xuICAgIGNhc2UgJ3RydW5jYXRlZCc6XG4gICAgICByZXR1cm4gMjtcbiAgfVxufVxuXG4vKipcbiAqIFN0YWNrZWQtcmFuZ2Ugb3JkZXIgaXMgYnkga2luZCByYW5rIHRoZW4gbnVtZXJpYyAoYHN0YXJ0YCB0aGVuIGBlbmRgKSxcbiAqIG92ZXJyaWRpbmcgYXJyaXZhbCBvciBjb2RlcG9pbnQgb3JkZXIgXHUyMDE0IHRoZSBvbmx5IHNvcnRpbmcgdGhpcyBtb2R1bGUgZG9lcyxcbiAqIGFuZCBzY29wZWQgc3RyaWN0bHkgdG8gcmFuZ2VzIHN0YWNrZWQgb24gb25lIHBhdGggKG5ldmVyIHRvIHNpYmxpbmcgcGF0aHNcbiAqIG9yIGRpcmVjdG9yeSBvcmRlcikuIEVxdWFsLXJhbmtlZCBlbnRyaWVzICh0d28gYHRydW5jYXRlZGBzLCBvciB0d29cbiAqIGlkZW50aWNhbCByYW5nZXMpIGtlZXAgdGhlaXIgb3duIHJlbGF0aXZlIGFycml2YWwgb3JkZXIsIHNpbmNlIHRoZSBzb3J0IGlzXG4gKiBzdGFibGUuXG4gKi9cbmZ1bmN0aW9uIGNvbXBhcmVSYW5nZUVudHJpZXMoYTogUmFuZ2VFbnRyeSwgYjogUmFuZ2VFbnRyeSk6IG51bWJlciB7XG4gIGNvbnN0IHJhbmsgPSByYW5nZVJhbmsoYS5yYW5nZSkgLSByYW5nZVJhbmsoYi5yYW5nZSk7XG4gIGlmIChyYW5rICE9PSAwKSByZXR1cm4gcmFuaztcbiAgaWYgKGEucmFuZ2Uua2luZCA9PT0gJ3JhbmdlJyAmJiBiLnJhbmdlLmtpbmQgPT09ICdyYW5nZScpIHtcbiAgICByZXR1cm4gYS5yYW5nZS5zdGFydCAtIGIucmFuZ2Uuc3RhcnQgfHwgYS5yYW5nZS5lbmQgLSBiLnJhbmdlLmVuZDtcbiAgfVxuICByZXR1cm4gMDtcbn1cblxuLyoqXG4gKiBUaGUgcmFuZ2UgY29sdW1uJ3MgdGV4dCwgb3IgYG51bGxgIHdoZW4gdGhlIGVudHJ5IHByaW50cyBhcyBhIGJhcmUgcGF0aFxuICogd2l0aCBubyByYW5nZSBjb2x1bW4gYXQgYWxsLlxuICpcbiAqIEEgYHdob2xlLWZpbGVgIGVudHJ5IGlzIHRoZSBvbmUga2luZCB3aG9zZSByZW5kZXJpbmcgZGVwZW5kcyBvbiBjb250ZXh0LlxuICogQWxvbmUgb24gaXRzIHBhdGggaXQgc3RheXMgYSBiYXJlIHBhdGggd2l0aCB6ZXJvIG1hcmtlciBcdTIwMTQgdGhhdCBpcyB3aGF0IHRoZVxuICogQ0xJJ3Mgb3duIGZsYXQgbGlzdCBwcmludHMgZm9yIGEgd2hvbGUtZmlsZSBhbmNob3IsIGFuZCBhZGRpbmcgYSBtYXJrZXJcbiAqIHRoZXJlIHdvdWxkIGFubm90YXRlIHRoZSBvdmVyd2hlbG1pbmdseSBjb21tb24gY2FzZSBmb3IgdGhlIGJlbmVmaXQgb2YgdGhlXG4gKiByYXJlIG9uZS4gKlN0YWNrZWQqIGJlaGluZCBvdGhlciByYW5nZXMgb24gdGhlIHNhbWUgcGF0aCBpdCBtdXN0IGNhcnJ5IGFuXG4gKiBleHBsaWNpdCBtYXJrZXI6IHdpdGhvdXQgb25lIGl0IHJlbmRlcnMgYXMgYSBjb250aW51YXRpb24gbGluZSBob2xkaW5nXG4gKiBub3RoaW5nIGJ1dCBpbmRlbnRhdGlvbiBhbmQgaXRzIGRyaWZ0IHN1ZmZpeCwgd2hpY2ggZXJhc2VzIHRoZSBhbmNob3JcbiAqIG91dHJpZ2h0IHdoZW4gdGhlIHN1ZmZpeCBpcyBlbXB0eSBhbmQgXHUyMDE0IHdvcnNlIFx1MjAxNCBoYW5ncyBpdHMgYCBcdTIwMTQgY2hhbmdlZGBcbiAqIHVuZGVyIGEgbmVpZ2hib3VyaW5nIHJhbmdlLCBleGFjdGx5IHRoZSB2aXN1YWwgZ3JhbW1hciB0aGF0IG1lYW5zIFwiYW5vdGhlclxuICogcmFuZ2Ugb24gdGhpcyBzYW1lIGZpbGVcIi4gVGhlIHJlYWRlciB3b3VsZCB0aGVuIHJlY29uY2lsZSB0aGUgcmFuZ2UgdGhhdFxuICogZGlkIG5vdCBkcmlmdC4gT2YgdGhlIHRocmVlIGZpeGVzIGF2YWlsYWJsZSAocHJpbnQgdGhlIHBhdGggb25cbiAqIGNvbnRpbnVhdGlvbiBsaW5lcywgc29ydCB3aG9sZS1maWxlIHRvIHBvc2l0aW9uIDAsIG9yIHNwbGl0IGl0IGludG8gaXRzIG93blxuICogbGVhZiksIGFuIGV4cGxpY2l0IG1hcmtlciBpcyB0aGUgb25seSBvbmUgdGhhdCBtYWtlcyB0aGUgZW50cnkgaWRlbnRpZmlhYmxlXG4gKiBpbiAqZXZlcnkqIHBvc2l0aW9uIHJhdGhlciB0aGFuIG9ubHkgaW4gdGhlIHBvc2l0aW9uIHRoZSBzb3J0IGhhcHBlbnMgdG9cbiAqIHB1dCBpdCBpbjsgc29ydGluZyBpdCBmaXJzdCAoc2VlIHtAbGluayByYW5nZVJhbmt9KSBpcyBrZXB0IGFzIHdlbGwgYmVjYXVzZVxuICogXCJ3aG9sZSBmaWxlLCB0aGVuIGl0cyByYW5nZXMgaW4gbGluZSBvcmRlclwiIGlzIHRoZSBvcmRlciBhIHJlYWRlciBleHBlY3RzLFxuICogbm90IGJlY2F1c2UgaWRlbnRpZmlhYmlsaXR5IGRlcGVuZHMgb24gaXQuXG4gKi9cbmZ1bmN0aW9uIGxhYmVsRm9yKHJhbmdlOiBSYW5nZUxhYmVsLCBzb2xlOiBib29sZWFuKTogc3RyaW5nIHwgbnVsbCB7XG4gIHN3aXRjaCAocmFuZ2Uua2luZCkge1xuICAgIGNhc2UgJ3JhbmdlJzpcbiAgICAgIHJldHVybiBgI0wke3JhbmdlLnN0YXJ0fS1MJHtyYW5nZS5lbmR9YDtcbiAgICBjYXNlICd3aG9sZS1maWxlJzpcbiAgICAgIHJldHVybiBzb2xlID8gbnVsbCA6ICcod2hvbGUgZmlsZSknO1xuICAgIGNhc2UgJ3RydW5jYXRlZCc6XG4gICAgICByZXR1cm4gJyh0cnVuY2F0ZWQgaW4gc291cmNlIFx1MjAxNCBhbmNob3IgaW5jb21wbGV0ZSknO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQ29sdW1uIG1hdGhcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFRoZSBncmFwaGVtZSBzZWdtZW50ZXIsIGNvbnN0cnVjdGVkIG9uIGZpcnN0IHVzZSBhbmQgdGhlbiBjYWNoZWQgXHUyMDE0IGluY2x1ZGluZ1xuICogYSBjYWNoZWQgYG51bGxgIHdoZW4gaXQgY2Fubm90IGJlIGNvbnN0cnVjdGVkIGF0IGFsbC5cbiAqXG4gKiBMYXp5IG9uIHB1cnBvc2UuIGBJbnRsYCBpcyBub3QgcGFydCBvZiB0aGUgSmF2YVNjcmlwdCBsYW5ndWFnZSBjb3JlOiBhIE5vZGVcbiAqIGJ1aWx0IGAtLXdpdGgtaW50bD1ub25lYCBoYXMgbm8gYEludGxgIGdsb2JhbCB3aGF0c29ldmVyLCBhbmQgYGhvb2tzLmpzb25gXG4gKiBpbnZva2VzIGEgYmFyZSBgbm9kZWAgb2ZmIHRoZSB1c2VyJ3MgYFBBVEhgLCBzbyBgZW5naW5lcy5ub2RlYCBjb25zdHJhaW5zXG4gKiBub3RoaW5nIGhlcmUuIENvbnN0cnVjdGluZyB0aGlzIGF0IG1vZHVsZSBzY29wZSBwdXQgYSBgUmVmZXJlbmNlRXJyb3JgIGluXG4gKiB0aGUgYnVuZGxlcycgdG9wLWxldmVsIHN0YXRlbWVudHMsIHdoZXJlIGl0IHRocm93cyBhdCAqaW1wb3J0KiBcdTIwMTQgYmVmb3JlIGFueVxuICogb2YgdGhlIGZhaWwtY2xvc2VkIGB0cnkvY2F0Y2hgIGJsb2NrcyBpbiBgcmVuZGVyQW5jaG9yUnVuYCwgYHJlbmRlclBhdGhSdW5gXG4gKiBhbmQgYGFuY2hvckJ1bGxldHNgIGV4aXN0IHRvIGNhdGNoIGl0LiBUaGUgaG9vayBwcm9jZXNzIHRoZW4gZGllZCB3aXRoIGV4aXRcbiAqIDEsIHdoaWNoIENsYXVkZSBDb2RlIHRyZWF0cyBhcyBhIG5vbi1ibG9ja2luZyBob29rIGVycm9yOiB0aGUgY29tbWl0IGdhdGVcbiAqIHNpbGVudGx5IGFsbG93ZWQgdGhlIGNvbW1pdCBhbmQgdGhlIGRyaWZ0IHJlbWluZGVyIHNpbGVudGx5IHZhbmlzaGVkLlxuICogQnVpbGRpbmcgaXQgaW5zaWRlIHRoZSByZW5kZXIgcGF0aCBwdXRzIGFueSBmYWlsdXJlIGJhY2sgaW5zaWRlIHRob3NlXG4gKiBjYXRjaGVzLlxuICpcbiAqIEZBSUwtQ0xPU0VELCBub3QgYSBgPGdyZWVuZmllbGQ+YC1mb3JiaWRkZW4gZmFsbGJhY2sgXHUyMDE0IHRoZSBzYW1lIGNhdGVnb3J5IGFzXG4gKiB0aGUgbG9jYWwgYHRyeS9jYXRjaGAgYmxvY2tzIGF0IHRoaXMgbW9kdWxlJ3MgY2FsbCBzaXRlcywgYW5kIGxvYWQtYmVhcmluZ1xuICogZm9yIHRoZSBzYW1lIHJlYXNvbi4gTm90aGluZyBpbiB0aGUgY29sdW1uLWFsaWdubWVudCBwYXRoIG1heSBiZSBhYmxlIHRvXG4gKiBjb3N0IHRoZSBjb21taXQgZ2F0ZSBvciB0aGUgZHJpZnQgcmVtaW5kZXI6IGlmIGRpc3BsYXkgd2lkdGggY2Fubm90IGJlXG4gKiBtZWFzdXJlZCwgdGhlIGxpc3Qgc3RpbGwgcHJpbnRzIGFuZCB0aGUgZ2F0ZSBzdGlsbCBob2xkczsgb25seSBhbGlnbm1lbnQgaXNcbiAqIGxvc3QuXG4gKi9cbmxldCBjYWNoZWRTZWdtZW50ZXI6IHsgdmFsdWU6IEludGwuU2VnbWVudGVyIHwgbnVsbCB9IHwgdW5kZWZpbmVkO1xuXG5mdW5jdGlvbiBncmFwaGVtZVNlZ21lbnRlcigpOiBJbnRsLlNlZ21lbnRlciB8IG51bGwge1xuICBpZiAoY2FjaGVkU2VnbWVudGVyID09PSB1bmRlZmluZWQpIHtcbiAgICB0cnkge1xuICAgICAgY2FjaGVkU2VnbWVudGVyID0geyB2YWx1ZTogbmV3IEludGwuU2VnbWVudGVyKCdlbicsIHsgZ3JhbnVsYXJpdHk6ICdncmFwaGVtZScgfSkgfTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIGNhY2hlZFNlZ21lbnRlciA9IHsgdmFsdWU6IG51bGwgfTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGNhY2hlZFNlZ21lbnRlci52YWx1ZTtcbn1cblxuLyoqXG4gKiBDb2RlIHBvaW50IHJhbmdlcyByZW5kZXJlZCB0d28gY29sdW1ucyB3aWRlOiB0aGUgRWFzdCBBc2lhbiBXaWRlIChXKSBhbmRcbiAqIEZ1bGx3aWR0aCAoRikgYmxvY2tzIG9mIFVBWCAjMTEsIHBsdXMgdGhlIGVtb2ppIGJsb2NrcyB0aGF0IHRlcm1pbmFscyBhbmRcbiAqIHByb3BvcnRpb25hbCBhZ2VudC1mYWNpbmcgcmVuZGVyZXJzIGJvdGggZ2l2ZSBkb3VibGUgd2lkdGguIEV2ZXJ5dGhpbmcgZWxzZVxuICogY291bnRzIGFzIG9uZSBjb2x1bW4uXG4gKlxuICogU29ydGVkIGFzY2VuZGluZyBhbmQgbm9uLW92ZXJsYXBwaW5nIFx1MjAxNCB7QGxpbmsgaXNXaWRlQ29kZVBvaW50fSBzaG9ydC1jaXJjdWl0c1xuICogb24gdGhlIGZpcnN0IHJhbmdlIHN0YXJ0aW5nIHBhc3QgdGhlIGNvZGUgcG9pbnQuXG4gKi9cbmNvbnN0IFdJREVfUkFOR0VTOiByZWFkb25seSAocmVhZG9ubHkgW251bWJlciwgbnVtYmVyXSlbXSA9IFtcbiAgWzB4MTEwMCwgMHgxMTVmXSxcbiAgWzB4MjMyOSwgMHgyMzJhXSxcbiAgWzB4MjYwMCwgMHgyN2JmXSxcbiAgWzB4MmU4MCwgMHgzMDNlXSxcbiAgWzB4MzA0MSwgMHgzM2ZmXSxcbiAgWzB4MzQwMCwgMHg0ZGJmXSxcbiAgWzB4NGUwMCwgMHg5ZmZmXSxcbiAgWzB4YTAwMCwgMHhhNGNmXSxcbiAgWzB4YTk2MCwgMHhhOTdmXSxcbiAgWzB4YWMwMCwgMHhkN2EzXSxcbiAgWzB4ZjkwMCwgMHhmYWZmXSxcbiAgWzB4ZmUxMCwgMHhmZTE5XSxcbiAgWzB4ZmUzMCwgMHhmZTZmXSxcbiAgWzB4ZmYwMCwgMHhmZjYwXSxcbiAgWzB4ZmZlMCwgMHhmZmU2XSxcbiAgWzB4MTcwMDAsIDB4MThhZmZdLFxuICBbMHgxZjFlNiwgMHgxZjFmZl0sXG4gIFsweDFmMzAwLCAweDFmNjRmXSxcbiAgWzB4MWY2ODAsIDB4MWY2ZmZdLFxuICBbMHgxZjkwMCwgMHgxZjlmZl0sXG4gIFsweDFmYTcwLCAweDFmYWZmXSxcbiAgWzB4MjAwMDAsIDB4MmZmZmRdLFxuICBbMHgzMDAwMCwgMHgzZmZmZF1cbl07XG5cbmZ1bmN0aW9uIGlzV2lkZUNvZGVQb2ludChjcDogbnVtYmVyKTogYm9vbGVhbiB7XG4gIGZvciAoY29uc3QgW2xvLCBoaV0gb2YgV0lERV9SQU5HRVMpIHtcbiAgICBpZiAoY3AgPCBsbykgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChjcCA8PSBoaSkgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKipcbiAqIERpc3BsYXkgd2lkdGggb2YgYSBuYW1lIGluIHRlcm1pbmFsIGNvbHVtbnMgXHUyMDE0IHRoZSB1bml0IHRoZSByYW5nZSBjb2x1bW4gaXNcbiAqIGFjdHVhbGx5IGFsaWduZWQgaW4uIE1lYXN1cmVkIG92ZXIgZ3JhcGhlbWUgY2x1c3RlcnMgKHNvIGEgZGVjb21wb3NlZCBgXHUwMEU5YFxuICogb3IgYSBjb21iaW5pbmctbWFyayBzZXF1ZW5jZSBjb3VudHMgb25jZSwgbm90IG9uY2UgcGVyIGNvZGUgcG9pbnQpLCB3aXRoXG4gKiBlYWNoIGNsdXN0ZXIgY29udHJpYnV0aW5nIHR3byBjb2x1bW5zIHdoZW4gaXRzIGJhc2UgY29kZSBwb2ludCBpcyBFYXN0XG4gKiBBc2lhbiBXaWRlL0Z1bGx3aWR0aCBvciBlbW9qaSBhbmQgb25lIG90aGVyd2lzZS5cbiAqXG4gKiBOZWl0aGVyIFVURi0xNiBgLmxlbmd0aGAgbm9yIGBBcnJheS5mcm9tKG5hbWUpLmxlbmd0aGAgaXMgdGhpcyB1bml0OiB0aGVcbiAqIGZpcnN0IG92ZXItY291bnRzIGEgc3Vycm9nYXRlIHBhaXIsIHRoZSBzZWNvbmQgdW5kZXItY291bnRzIGEgQ0pLIGlkZW9ncmFwaFxuICogYW5kIG92ZXItY291bnRzIGEgZGVjb21wb3NlZCBhY2NlbnQuXG4gKlxuICogV2hlbiB7QGxpbmsgZ3JhcGhlbWVTZWdtZW50ZXJ9IGlzIHVuYXZhaWxhYmxlIChhIE5vZGUgYnVpbHRcbiAqIGAtLXdpdGgtaW50bD1ub25lYCBoYXMgbm8gYEludGxgIGdsb2JhbCBhdCBhbGwpLCB0aGlzIGRlZ3JhZGVzIHRvIHRoZSBjcnVkZXJcbiAqIHBlci1jb2RlLXBvaW50IG1lYXN1cmUgcmF0aGVyIHRoYW4gdGhyb3dpbmcuIFRoYXQgbWVhc3VyZSBvdmVyLWNvdW50cyBhXG4gKiBkZWNvbXBvc2VkIGFjY2VudCBhbmQgYSByZWdpb25hbC1pbmRpY2F0b3IgZmxhZyBwYWlyLCBzbyBhbGlnbm1lbnQgY2FuIGJlIGFcbiAqIGNvbHVtbiBvciB0d28gb2ZmIFx1MjAxNCB3aGljaCBpcyB0aGUgZW50aXJlIGNvc3QsIGFuZCBpcyB0aGUgY29ycmVjdCBwcmljZSB0b1xuICogcGF5OiB0aGUgYW5jaG9yIGxpc3Qgc3RpbGwgcHJpbnRzIGFuZCB0aGUgY29tbWl0IGdhdGUgc3RpbGwgaG9sZHMuXG4gKi9cbmZ1bmN0aW9uIGRpc3BsYXlXaWR0aChuYW1lOiBzdHJpbmcpOiBudW1iZXIge1xuICBjb25zdCBzZWdtZW50ZXIgPSBncmFwaGVtZVNlZ21lbnRlcigpO1xuICBsZXQgd2lkdGggPSAwO1xuICBpZiAoc2VnbWVudGVyID09PSBudWxsKSB7XG4gICAgZm9yIChjb25zdCBjb2RlUG9pbnQgb2YgbmFtZSkge1xuICAgICAgd2lkdGggKz0gaXNXaWRlQ29kZVBvaW50KGNvZGVQb2ludC5jb2RlUG9pbnRBdCgwKSA/PyAwKSA/IDIgOiAxO1xuICAgIH1cbiAgICByZXR1cm4gd2lkdGg7XG4gIH1cbiAgZm9yIChjb25zdCB7IHNlZ21lbnQgfSBvZiBzZWdtZW50ZXIuc2VnbWVudChuYW1lKSkge1xuICAgIHdpZHRoICs9IGlzV2lkZUNvZGVQb2ludChzZWdtZW50LmNvZGVQb2ludEF0KDApID8/IDApID8gMiA6IDE7XG4gIH1cbiAgcmV0dXJuIHdpZHRoO1xufVxuXG4vKipcbiAqIEFsaWdubWVudCBjZWlsaW5nLiBBIHNpYmxpbmcgZ3JvdXAgd2hvc2Ugd2lkZXN0IHJhbmdlLWJlYXJpbmcgbmFtZSBleGNlZWRzXG4gKiB0aGlzIHdpZHRoIGRvZXMgbm90IGFsaWduIGF0IGFsbCBcdTIwMTQgZXZlcnkgbmFtZSBpbiBpdCB0YWtlcyBhIHNpbmdsZSBzcGFjZVxuICogYmVmb3JlIGl0cyByYW5nZS4gVGhlIGFsdGVybmF0aXZlIChwYWQgdGhlIHNob3J0IG5hbWVzIHRvIHRoZSBjZWlsaW5nIHdoaWxlXG4gKiB0aGUgbG9uZyBvbmUgc2l0cyBhdCBpdHMgb3duIG5hdHVyYWwgY29sdW1uKSBwYXlzIG1vc3Qgb2YgdGhlIHdpZHRoIGZvclxuICogYWxpZ25tZW50IHRoYXQgYWxpZ25zIHdpdGggbm90aGluZywgd2hpY2ggaXMgc3RyaWN0bHkgd29yc2UgdGhhbiBub3RcbiAqIGFsaWduaW5nLiBOYW1lcyB0aGVtc2VsdmVzIGFyZSBuZXZlciB0cnVuY2F0ZWQgb3IgZWxpZGVkIGF0IGFueSB3aWR0aC5cbiAqL1xuY29uc3QgTUFYX0FMSUdOX0NPTFVNTiA9IDQ4O1xuXG4vKipcbiAqIFRoZSBjb2x1bW4gZXZlcnkgcmFuZ2UtYmVhcmluZyBuYW1lIGluIHRoaXMgc2libGluZyBncm91cCBwYWRzIHRvLCBvciBgMGBcbiAqIHdoZW4gdGhlIGdyb3VwIGZvcmdvZXMgYWxpZ25tZW50IChubyByYW5nZS1iZWFyaW5nIG5hbWVzLCBvciBhIG5hbWUgcGFzdFxuICoge0BsaW5rIE1BWF9BTElHTl9DT0xVTU59KS4gQWxpZ25tZW50IHNjb3BlIGlzIHRoZSBncm91cCdzIGRpcmVjdCBjaGlsZHJlblxuICogb25seSwgbmV2ZXIgdGhlIHdob2xlIHRyZWUgXHUyMDE0IHdob2xlLXRyZWUgYWxpZ25tZW50IHdvdWxkIGxldCBvbmUgZGVlcGx5XG4gKiBuZXN0ZWQgbG9uZyBuYW1lIHBhZCBldmVyeSB1bnJlbGF0ZWQgYnJhbmNoLlxuICovXG5mdW5jdGlvbiBjb21wdXRlR3JvdXBUYXJnZXQoaXRlbXM6IERpc3BsYXlJdGVtW10pOiBudW1iZXIge1xuICBsZXQgbWF4ID0gMDtcbiAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgaWYgKGl0ZW0ubm9kZS5raW5kID09PSAnbGVhZicgJiYgcHJpbnRzUmFuZ2VDb2x1bW4oaXRlbS5ub2RlLmFuY2hvcikpIHtcbiAgICAgIG1heCA9IE1hdGgubWF4KG1heCwgZGlzcGxheVdpZHRoKGl0ZW0ubmFtZSkpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbWF4ID4gTUFYX0FMSUdOX0NPTFVNTiA/IDAgOiBtYXg7XG59XG5cbi8qKlxuICogV2hldGhlciB0aGlzIGFuY2hvciBwcmludHMgYSByYW5nZSBjb2x1bW4gYXQgYWxsIFx1MjAxNCB0aGUgZXhhY3QgY29uZGl0aW9uXG4gKiB7QGxpbmsgbGFiZWxGb3J9IGVuY29kZXMsIGhvaXN0ZWQgc28ge0BsaW5rIGNvbXB1dGVHcm91cFRhcmdldH0gbWVhc3VyZXMgdGhlXG4gKiBzYW1lIHNldCBvZiBuYW1lcyBpdCBwYWRzLiBBbiBhbmNob3Igd2l0aCBubyByYW5nZXMsIG9yIGEgKnNvbGUqIHdob2xlLWZpbGVcbiAqIGVudHJ5ICh3aGljaCByZW5kZXJzIGFzIGEgYmFyZSBwYXRoIHdpdGggemVybyBtYXJrZXIpLCBjb250cmlidXRlcyBubyByYW5nZVxuICogY29sdW1uIGFuZCBzbyBtdXN0IG5vdCBjb250cmlidXRlIHRvIHRoZSBncm91cCBtYXggZWl0aGVyOiBvdGhlcndpc2UgYVxuICogd2hvbGUtZmlsZSBhbmNob3Igb24gYSBwYXRoIHBhc3Qge0BsaW5rIE1BWF9BTElHTl9DT0xVTU59IHNpbGVudGx5IHN1cHByZXNzZXNcbiAqIGFsaWdubWVudCBmb3IgaXRzIHJhbmdlLWJlYXJpbmcgc2libGluZ3Mgd2hpbGUgaXRzZWxmIHByaW50aW5nIG5vdGhpbmcgdG9cbiAqIGFsaWduLlxuICovXG5mdW5jdGlvbiBwcmludHNSYW5nZUNvbHVtbihhbmNob3I6IFRyZWVBbmNob3IpOiBib29sZWFuIHtcbiAgY29uc3QgeyByYW5nZXMgfSA9IGFuY2hvcjtcbiAgaWYgKHJhbmdlcy5sZW5ndGggPT09IDApIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIHJhbmdlcy5zb21lKChlbnRyeSkgPT4gbGFiZWxGb3IoZW50cnkucmFuZ2UsIHJhbmdlcy5sZW5ndGggPT09IDEpICE9PSBudWxsKTtcbn1cblxuLyoqIFRoZSBzcGFjaW5nIGJldHdlZW4gYSBuYW1lIG9mIGBuYW1lV2lkdGhgIGNvbHVtbnMgYW5kIGl0cyByYW5nZSBjb2x1bW4uICovXG5mdW5jdGlvbiBjb21wdXRlUGFkKG5hbWVXaWR0aDogbnVtYmVyLCB0YXJnZXQ6IG51bWJlcik6IHN0cmluZyB7XG4gIGlmIChuYW1lV2lkdGggPj0gdGFyZ2V0KSByZXR1cm4gJyAnO1xuICByZXR1cm4gJyAnLnJlcGVhdCh0YXJnZXQgLSBuYW1lV2lkdGggKyAxKTtcbn1cblxuLyoqXG4gKiBSZW5kZXIgb25lIGxlYWYncyBsaW5lKHMpLiBBbiBlbXB0eSBgcmFuZ2VzYCBhcnJheSBpcyBhIGJhcmUtcGF0aCBsZWFmIHdpdGhcbiAqIG5vIHJhbmdlIGNvbHVtbiBhdCBhbGwgKGRpc3RpbmN0IGZyb20gYSBgd2hvbGUtZmlsZWAgZW50cnksIHdoaWNoIGlzIGFuXG4gKiBleHBsaWNpdCBjbGFzc2lmaWNhdGlvbiB0aGF0IGFsc28gcHJpbnRzIHdpdGggemVybyBtYXJrZXIgd2hlbiBpdCBzdGFuZHNcbiAqIGFsb25lLCBidXQgdGhyb3VnaCB0aGUgcmFuZ2VzIHBpcGVsaW5lKS4gTXVsdGlwbGUgc3RhY2tlZCByYW5nZXMgcHJpbnRcbiAqIHVuZGVyIGEgY29udGludWF0aW9uIHByZWZpeCBpbnN0ZWFkIG9mIHJlcGVhdGluZyB0aGUgbmFtZTsgZWFjaCBjYXJyaWVzIGl0c1xuICogb3duIHN1ZmZpeCBpbmRlcGVuZGVudGx5LCBhbmQgZWFjaCBjYXJyaWVzIGEgbGFiZWwgaWRlbnRpZnlpbmcgd2hpY2ggYW5jaG9yXG4gKiB0aGUgc3VmZml4IGJlbG9uZ3MgdG8uXG4gKi9cbmZ1bmN0aW9uIHJlbmRlckxlYWZMaW5lcyhcbiAgbmFtZTogc3RyaW5nLFxuICBhbmNob3I6IFRyZWVBbmNob3IsXG4gIG93blByZWZpeDogc3RyaW5nLFxuICBjaGlsZFByZWZpeDogc3RyaW5nLFxuICBncm91cFRhcmdldDogbnVtYmVyXG4pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHsgcmFuZ2VzIH0gPSBhbmNob3I7XG4gIGlmIChyYW5nZXMubGVuZ3RoID09PSAwKSByZXR1cm4gW2Ake293blByZWZpeH0ke25hbWV9YF07XG5cbiAgY29uc3Qgc29ydGVkID0gWy4uLnJhbmdlc10uc29ydChjb21wYXJlUmFuZ2VFbnRyaWVzKTtcbiAgY29uc3Qgc29sZSA9IHNvcnRlZC5sZW5ndGggPT09IDE7XG4gIGNvbnN0IG5hbWVXaWR0aCA9IGRpc3BsYXlXaWR0aChuYW1lKTtcbiAgY29uc3QgcGFkID0gY29tcHV0ZVBhZChuYW1lV2lkdGgsIGdyb3VwVGFyZ2V0KTtcbiAgY29uc3QgYmxhbmsgPSAnICcucmVwZWF0KG5hbWVXaWR0aCArIHBhZC5sZW5ndGgpO1xuXG4gIHJldHVybiBzb3J0ZWQubWFwKChlbnRyeSwgaSkgPT4ge1xuICAgIGNvbnN0IGxhYmVsID0gbGFiZWxGb3IoZW50cnkucmFuZ2UsIHNvbGUpO1xuICAgIGlmIChsYWJlbCA9PT0gbnVsbCkgcmV0dXJuIGAke293blByZWZpeH0ke25hbWV9JHtlbnRyeS5zdWZmaXh9YDtcbiAgICBjb25zdCBiYXNlID0gaSA9PT0gMCA/IGAke293blByZWZpeH0ke25hbWV9JHtwYWR9YCA6IGAke2NoaWxkUHJlZml4fSR7Ymxhbmt9YDtcbiAgICByZXR1cm4gYCR7YmFzZX0ke2xhYmVsfSR7ZW50cnkuc3VmZml4fWA7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiByZW5kZXJOb2Rlcyhub2RlczogUGF0aFRyZWVOb2RlW10sIHByZWZpeDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBsaW5lczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgaXRlbXMgPSBub2Rlcy5tYXAoZm9sZENoYWluKTtcbiAgY29uc3QgZ3JvdXBUYXJnZXQgPSBjb21wdXRlR3JvdXBUYXJnZXQoaXRlbXMpO1xuICBpdGVtcy5mb3JFYWNoKChpdGVtLCBpKSA9PiB7XG4gICAgY29uc3QgaXNMYXN0ID0gaSA9PT0gaXRlbXMubGVuZ3RoIC0gMTtcbiAgICBjb25zdCBvd25QcmVmaXggPSBgJHtwcmVmaXh9JHtpc0xhc3QgPyAnXHUyNTE0XHUyNTAwICcgOiAnXHUyNTFDXHUyNTAwICd9YDtcbiAgICBjb25zdCBjaGlsZFByZWZpeCA9IGAke3ByZWZpeH0ke2lzTGFzdCA/ICcgICAnIDogJ1x1MjUwMiAgJ31gO1xuICAgIGlmIChpdGVtLm5vZGUua2luZCA9PT0gJ2xlYWYnKSB7XG4gICAgICBsaW5lcy5wdXNoKC4uLnJlbmRlckxlYWZMaW5lcyhpdGVtLm5hbWUsIGl0ZW0ubm9kZS5hbmNob3IsIG93blByZWZpeCwgY2hpbGRQcmVmaXgsIGdyb3VwVGFyZ2V0KSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxpbmVzLnB1c2goYCR7b3duUHJlZml4fSR7aXRlbS5uYW1lfS9gKTtcbiAgICAgIGxpbmVzLnB1c2goLi4ucmVuZGVyTm9kZXMoaXRlbS5ub2RlLmNoaWxkcmVuLCBjaGlsZFByZWZpeCkpO1xuICAgIH1cbiAgfSk7XG4gIHJldHVybiBsaW5lcztcbn1cblxuLyoqXG4gKiBSZW5kZXIgYSBjb2xsYXBzZWQgYW5jaG9yIGxpc3QgYXMgYSBib3gtZHJhd2luZyB0cmVlLCBncm91cGVkIGJ5IHNoYXJlZFxuICogcGF0aCBwcmVmaXguIEV2ZXJ5IGFuY2hvciBsaXN0IHJlbmRlcnMgYXMgYSB0cmVlIHVuY29uZGl0aW9uYWxseSBcdTIwMTQgYSBzaW5nbGVcbiAqIGFuY2hvciBiZWNvbWVzIGEgb25lLWxpbmUgdHJlZSB3aGF0ZXZlciBpdHMgZGVwdGggKHNlZSB7QGxpbmsgZm9sZENoYWlufSk7XG4gKiB0aGVyZSBpcyBubyBmbGF0LWJ1bGxldCBwYXRoIG9yIHNpemUgZmxvb3IgaW4gdGhpcyBtb2R1bGUuXG4gKlxuICogSGVpZ2h0IGlzIGJvdW5kZWQgYnkge0BsaW5rIGZvbGRDaGFpbn06IGEgZGlyZWN0b3J5IGxpbmUgb25seSBldmVyIGFwcGVhcnNcbiAqIHdoZXJlIGl0IGdlbnVpbmVseSBncm91cHMgdHdvIG9yIG1vcmUgc2libGluZ3MsIHNvIHRoZSB0cmVlIGFkZHMgYXQgbW9zdFxuICogb25lIGxpbmUgcGVyIHJlYWwgZ3JvdXBpbmcgYW5kIG5ldmVyIG9uZSBwZXIgcGF0aCBzZWdtZW50LlxuICpcbiAqIFRvdGFsIGZvciBhbnkgd2VsbC1mb3JtZWQgYFRyZWVBbmNob3JbXWA6IGRlZ2VuZXJhdGUgcGF0aHMgKHJ1bGUgZW5mb3JjZWRcbiAqIGluIHtAbGluayBzcGxpdFNlZ21lbnRzfSkgYXJlIG5vcm1hbGl6ZWQgdG8gYXRvbWljIGxlYXZlcyByYXRoZXIgdGhhblxuICogdGhyb3duIG9uLCBzbyB0aGlzIGZ1bmN0aW9uIG5ldmVyIG5lZWRzIGFuIGludGVybmFsIHRyeS9jYXRjaC4gQ2FsbGVycyBhZGRcbiAqIHRoZWlyIG93biBjYXRjaCBhcm91bmQgdGhpcyBjYWxsIGluIGEgbGF0ZXIgcGhhc2UgKGZhaWwtb3BlbiBkaXNjaXBsaW5lXG4gKiBsaXZlcyBhdCB0aGUgY2FsbCBzaXRlLCBub3QgaGVyZSkuXG4gKlxuICogYHJlbmRlckFuY2hvclRyZWVgJ3MgY29udHJhY3QgcmVxdWlyZXMgYXQgbW9zdCBvbmUgYFRyZWVBbmNob3JgIHBlclxuICogZGlzdGluY3QgYHBhdGhgIFx1MjAxNCBwYXNzIGFuY2hvcnMgdGhyb3VnaCB7QGxpbmsgY29sbGFwc2VCeVBhdGh9IGZpcnN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyQW5jaG9yVHJlZShhbmNob3JzOiBUcmVlQW5jaG9yW10pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IGZvcmVzdCA9IGJ1aWxkRm9yZXN0KGFuY2hvcnMpO1xuICByZXR1cm4gcmVuZGVyTm9kZXMoZm9yZXN0LCAnJyk7XG59XG4iLCAiLyoqXG4gKiBTaGFyZWQgQmFzaCBzcGFuIFx1MjE5MiB0b3VjaCB0cmFuc2xhdGlvbiBhbmQgdGhlIGpvaW4tZ2F0aW5nIGRyaXZlciAocGxhbiBcdTAwQTcyLFxuICogXHUwMEE3MyBzdGVwIDIpLiBCb3RoIGFkYXB0ZXJzIGNvbnN1bWUgdGhpcyBtb2R1bGUgb25jZSB0aGVpciBkdXBsaWNhdGUgQmFzaFxuICogc3BhbiBsb29wcyBjb2xsYXBzZTogaXQgb3ducyB0aGUgcGVyLWNvbW1hbmQgdmVyZGljdCB0aHJlYWQgXHUyMDE0IHBhc3MgQVxuICogYGV2YWx1YXRlV3JpdGVHYXRlYCBzd2VlcCwgdGhlIGV4cGxhbmF0aW9uIG1hcCwgdGhlIGpvaW4gZmlsdGVyLCBhbmQgcGFzcyBCXG4gKiBwZXItc3Vydml2aW5nLXNwYW4gYHJ1blRvdWNoSG9va2AgXHUyMDE0IHBsdXMgdGhlIHdob2xlLWNvbW1hbmQgYGludGVycnVwdGVkYFxuICogZ2F0ZSAocGxhbiBcdTAwQTc0KS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IFJlc29sdmVkU3BhbiwgU3Bhbk1hdGNoIH0gZnJvbSAnLi9wYXJzZS1jb21tYW5kLmpzJztcbmltcG9ydCB7IHR5cGUgTWVtb1N0b3JlLCByZXNvbHZlVG91Y2hTY29wZSB9IGZyb20gJy4vc3Bhbi1zdXJmYWNlLmpzJztcbmltcG9ydCB7XG4gIGNyZWF0ZVJlYWxpdHlQcm9iZUNhY2hlLFxuICBldmFsdWF0ZVdyaXRlR2F0ZSxcbiAgZmlsZUV4aXN0cyxcbiAgdHlwZSBSZWFsaXR5UHJvYmVDYWNoZSxcbiAgcnVuVG91Y2hIb29rLFxuICB0eXBlIFRvdWNoRXhlY3V0b3JzLFxuICB0eXBlIFRvdWNoSW5wdXQsXG4gIHR5cGUgV3JpdGVHYXRlT3V0Y29tZSxcbiAgd29ya2luZ1RyZWVDaGFuZ2VkXG59IGZyb20gJy4vdG91Y2gtY29yZS5qcyc7XG5cbi8qKlxuICogVHJhbnNsYXRlIG9uZSByZXNvbHZlZCBzcGFuIGludG8gYSBmdWxseS10eXBlZCB7QGxpbmsgVG91Y2hJbnB1dH0gcGVyIHRoZVxuICogcGxhbiBcdTAwQTcyIHRhYmxlLCBvciBgbnVsbGAgd2hlbiB0aGUgcGF0aCBmYWlscyBgcmVzb2x2ZVRvdWNoU2NvcGVgIFx1MjAxNCBjcm9zcy1cbiAqIHJlcG8sIGdpdGlnbm9yZWQsIGFuZCBzcGFuLWRvY3VtZW50IHBhdGhzIGZhaWwgY2xvc2VkLlxuICpcbiAqIFRoZSBwb3N0LXN0YXRlIGdhdGUgZmllbGRzIHRoZSBzcGFuIGNhbiBkZXRlcm1pbmUgKGB0YXJnZXRTdGF0ZWAsIGFuZFxuICogYHBvc3RTdGF0ZWAgZm9yIGFwcGVuZHMgYW5kIGRlbGV0ZXMpIGFyZSBzZXQgaGVyZTsgYSBsaXRlcmFsIG92ZXJ3cml0ZSBib2R5XG4gKiAoYHNwYW4ud3JpdHRlbmAgXHUyMDE0IHRoZSBmbGFnLWxlc3MgYGVjaG9gL2BwcmludGZgIGA+YCBjYXNlKSByaWRlcyBhcyB0aGVcbiAqIGBleGFjdGAgcG9zdC1jb250ZW50IGV4cGVjdGF0aW9uIHNvIHRoZSBnYXRlIHZlcmlmaWVzIHRoZSB3cml0ZSdzIGVmZmVjdFxuICogd2hpbGUgdGhlIHRvdWNoIGl0c2VsZiBzdGF5cyB3aG9sZS1maWxlIChwbGFuIFx1MDBBNzMgc3RlcCAxYikuIFRydW5jYXRlcyBtYXBcbiAqIHRoZSBzcGFuJ3Mgc3RhdGljYWxseSBldmFsdWF0ZWQgYWJzb2x1dGUgYC1zIE5gIHRvIHRoZSBgc2l6ZWAgcG9zdC1jb250ZW50XG4gKiAoYC1zIDBgIFx1MjE5MiBgZW1wdHlgKTsgYSB0cnVuY2F0ZSB3aXRob3V0IGEgc2l6ZSBnYXRlcyBleGlzdGVuY2Utb25seS4gVGhlXG4gKiBkcml2ZXIgcGFpcnMgY3AvaW5zdGFsbCBhbmQgbXYgc291cmNlcyBvbnRvIHRoZSBkZXN0aW5hdGlvbiB0b3VjaGVzXG4gKiBhZnRlcndhcmQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBiYXNoU3BhblRvVG91Y2goc3BhbjogUmVzb2x2ZWRTcGFuLCBzZXNzaW9uSWQ6IHN0cmluZywgY3dkOiBzdHJpbmcpOiBUb3VjaElucHV0IHwgbnVsbCB7XG4gIGlmICghcmVzb2x2ZVRvdWNoU2NvcGUoY3dkLCBzcGFuLmFic29sdXRlUGF0aCkpIHJldHVybiBudWxsO1xuICBzd2l0Y2ggKHNwYW4ub3BlcmF0aW9uKSB7XG4gICAgY2FzZSAncmVhZCc6XG4gICAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiAncmVhZCcsXG4gICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgY3dkLFxuICAgICAgICBmaWxlUGF0aDogc3Bhbi5hYnNvbHV0ZVBhdGgsXG4gICAgICAgIG9mZnNldDogc3Bhbi5saW5lU3RhcnQsXG4gICAgICAgIGxpbWl0OlxuICAgICAgICAgIHNwYW4ubGluZVN0YXJ0ICE9PSB1bmRlZmluZWQgJiYgc3Bhbi5saW5lRW5kICE9PSB1bmRlZmluZWQgPyBzcGFuLmxpbmVFbmQgLSBzcGFuLmxpbmVTdGFydCArIDEgOiB1bmRlZmluZWRcbiAgICAgIH07XG4gICAgY2FzZSAnY3JlYXRlLW92ZXJ3cml0ZSc6XG4gICAgY2FzZSAncmVuYW1lLWNvcHknOlxuICAgICAgLy8gV2hvbGUtZmlsZSB3cml0ZXM6IGB3cml0dGVuOiAnJ2Agc2NvcGVzIHRoZSB0b3VjaCB0byBldmVyeSBjb3ZlcmluZ1xuICAgICAgLy8gc3BhbiBcdTIwMTQgdHJ1bmNhdGluZyB3cml0ZXMgZGVzdHJveSBhbmNob3JzIGJleW9uZCB0aGUgbmV3IEVPRiAodGhlXG4gICAgICAvLyBtYWluLTIwMCBGMiBsZXNzb24pLiBBIGxpdGVyYWwgYm9keSByaWRlcyBhcyB0aGUgZXhhY3QgcG9zdC1jb250ZW50XG4gICAgICAvLyBleHBlY3RhdGlvbiBzbyB0aGUgZ2F0ZSB2ZXJpZmllcyB0aGUgd3JpdGUncyBlZmZlY3QuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiAnd3JpdGUnLFxuICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgIGN3ZCxcbiAgICAgICAgZmlsZVBhdGg6IHNwYW4uYWJzb2x1dGVQYXRoLFxuICAgICAgICB3cml0dGVuOiAnJyxcbiAgICAgICAgdGFyZ2V0U3RhdGU6ICdleGlzdHMnLFxuICAgICAgICBwb3N0U3RhdGU6IHNwYW4ud3JpdHRlbiAhPT0gdW5kZWZpbmVkID8geyBjb250ZW50OiB7IGV4YWN0OiBzcGFuLndyaXR0ZW4gfSB9IDogdW5kZWZpbmVkXG4gICAgICB9O1xuICAgIGNhc2UgJ3RydW5jYXRlJzpcbiAgICAgIC8vIFNhbWUgd2hvbGUtZmlsZSBzY29wZTsgdGhlIHNpemUgZ2F0ZSAocGxhbiBcdTAwQTcyLCBcdTAwQTczIHN0ZXAgMWIpIHZlcmlmaWVzXG4gICAgICAvLyB0aGUgcG9zdC1jb21tYW5kIGJ5dGUgY291bnQgd2hlbiB0aGUgc3BhbiBjYXJyaWVzIGEgc3RhdGljYWxseVxuICAgICAgLy8gZXZhbHVhdGVkIGFic29sdXRlIGAtcyBOYCAoYC1zIDBgIFx1MjE5MiBlbXB0eSk7IHdpdGhvdXQgb25lIHRoZSBnYXRlIGlzXG4gICAgICAvLyBleGlzdGVuY2Utb25seS5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGtpbmQ6ICd3cml0ZScsXG4gICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgY3dkLFxuICAgICAgICBmaWxlUGF0aDogc3Bhbi5hYnNvbHV0ZVBhdGgsXG4gICAgICAgIHdyaXR0ZW46ICcnLFxuICAgICAgICB0YXJnZXRTdGF0ZTogJ2V4aXN0cycsXG4gICAgICAgIHBvc3RTdGF0ZTpcbiAgICAgICAgICBzcGFuLnNpemUgPT09IDBcbiAgICAgICAgICAgID8geyBjb250ZW50OiB7IGVtcHR5OiB0cnVlIH0gfVxuICAgICAgICAgICAgOiBzcGFuLnNpemUgIT09IHVuZGVmaW5lZFxuICAgICAgICAgICAgICA/IHsgY29udGVudDogeyBzaXplOiBzcGFuLnNpemUgfSB9XG4gICAgICAgICAgICAgIDogdW5kZWZpbmVkXG4gICAgICB9O1xuICAgIGNhc2UgJ2FwcGVuZCc6XG4gICAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiAnd3JpdGUnLFxuICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgIGN3ZCxcbiAgICAgICAgZmlsZVBhdGg6IHNwYW4uYWJzb2x1dGVQYXRoLFxuICAgICAgICB3cml0dGVuOiBzcGFuLndyaXR0ZW4gPz8gJycsXG4gICAgICAgIHRhcmdldFN0YXRlOiAnZXhpc3RzJyxcbiAgICAgICAgcG9zdFN0YXRlOiBzcGFuLndyaXR0ZW4gIT09IHVuZGVmaW5lZCA/IHsgY29udGVudDogeyBzdWZmaXg6IHNwYW4ud3JpdHRlbiB9IH0gOiB1bmRlZmluZWRcbiAgICAgIH07XG4gICAgY2FzZSAnbW9kaWZ5JzpcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGtpbmQ6ICd3cml0ZScsXG4gICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgY3dkLFxuICAgICAgICBmaWxlUGF0aDogc3Bhbi5hYnNvbHV0ZVBhdGgsXG4gICAgICAgIHdyaXR0ZW46ICcnLFxuICAgICAgICB0YXJnZXRTdGF0ZTogJ2V4aXN0cycsXG4gICAgICAgIHJhbmdlOiBzcGFuLmxpbmVTdGFydCAhPT0gdW5kZWZpbmVkID8geyBzdGFydDogc3Bhbi5saW5lU3RhcnQsIGVuZDogc3Bhbi5saW5lRW5kID8/IHNwYW4ubGluZVN0YXJ0IH0gOiB1bmRlZmluZWRcbiAgICAgIH07XG4gICAgY2FzZSAnZGVsZXRlJzpcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGtpbmQ6ICd3cml0ZScsXG4gICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgY3dkLFxuICAgICAgICBmaWxlUGF0aDogc3Bhbi5hYnNvbHV0ZVBhdGgsXG4gICAgICAgIHdyaXR0ZW46ICcnLFxuICAgICAgICB0YXJnZXRTdGF0ZTogJ2Fic2VudCcsXG4gICAgICAgIHBvc3RTdGF0ZTogeyByZWFsRGVsZXRlOiB0cnVlIH1cbiAgICAgIH07XG4gIH1cbn1cblxuLyoqXG4gKiBXaGV0aGVyIHRoZSBCYXNoIGB0b29sX3Jlc3BvbnNlYCBzaWduYWxzIHRoYXQgdGhlIGNvbW1hbmQgd2FzIGludGVycnVwdGVkXG4gKiAocGxhbiBcdTAwQTc0KS4gVGhlIFNESyB0eXBlcyB0aGUgcmVzcG9uc2UgYHVua25vd25gIG9uIGJvdGggYWRhcHRlcnMsIHNvIHRoaXNcbiAqIGlzIGEgZGVmZW5zaXZlIHJ1bnRpbWUgc2hhcGUtcHJvYmU6IGFuIG9iamVjdCBjYXJyeWluZyBhIHRydXRoeVxuICogYGludGVycnVwdGVkYCBmaWVsZCBjbGFzc2lmaWVzIGFzIGludGVycnVwdGVkOyBhbnkgb3RoZXIgc2hhcGUgKHN0cmluZyxcbiAqIG51bGwsIG9iamVjdCB3aXRob3V0IHRoZSBmaWVsZCkgcHJvY2VlZHMgZmFpbC1vcGVuLCBtYXRjaGluZyB0b2RheSdzXG4gKiBiZWhhdmlvci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJhc2hSZXNwb25zZUludGVycnVwdGVkKHRvb2xSZXNwb25zZTogdW5rbm93bik6IGJvb2xlYW4ge1xuICBpZiAodG9vbFJlc3BvbnNlICE9PSBudWxsICYmIHR5cGVvZiB0b29sUmVzcG9uc2UgPT09ICdvYmplY3QnKSB7XG4gICAgcmV0dXJuIEJvb2xlYW4oKHRvb2xSZXNwb25zZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikuaW50ZXJydXB0ZWQpO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBUaGUgQmFzaCBgdG9vbF9yZXNwb25zZWAncyBwcm9jZXNzIGV4aXQgY29kZSwgd2hlbiB0aGUgaGFybmVzcyBzdXBwbGllc1xuICogb25lLiBUaGUgU0RLIHR5cGVzIHRoZSByZXNwb25zZSBgdW5rbm93bmAgb24gYm90aCBhZGFwdGVycyBhbmQgQ2xhdWRlJ3NcbiAqIEJhc2ggZW52ZWxvcGVzIGRvIG5vdCBjdXJyZW50bHkgY2FycnkgYW4gYGV4aXRfY29kZWAgZmllbGQsIHNvIHRoaXMgaXMgYVxuICogZGVmZW5zaXZlIHNoYXBlLXByb2JlIHdpdGggdGhlIHBsYW4gXHUwMEE3NCBmYWlsLW9wZW4gcG9zdHVyZTogcHJlc2VudCBcdTIxOTIgdGhlXG4gKiBpbnRlZ2VyIGNvZGUsIGFic2VudCBvciBhbnkgb3RoZXIgc2hhcGUgXHUyMTkyIHVuZGVmaW5lZCwgYW5kIHRoZSBjYWxsZXJcbiAqIHByb2NlZWRzIGV4YWN0bHkgYXMgdG9kYXkuIChUaGUgaG9vayBzdWJwcm9jZXNzJ3Mgb3duIGV4aXQgc3RhdHVzIFx1MjAxNCB0aGVcbiAqIFNESydzIGBTREtIb29rUmVzcG9uc2VNZXNzYWdlLmV4aXRfY29kZWAgXHUyMDE0IGlzIGEgZGlmZmVyZW50IGNoYW5uZWwgYW5kIGlzXG4gKiBuZXZlciByZWFkIGhlcmUuKVxuICpcbiAqIEdyYW51bGFyaXR5IGVkZ2UgKGRvY3VtZW50ZWQgcmVzaWR1ZSk6IHRoZSBjb2RlIGlzIHRoZSB3aG9sZSBjb21wb3VuZFxuICogY29tbWFuZCdzLCBub3Qgb25lIHNpbXBsZSBjb21tYW5kJ3MgXHUyMDE0IGEgbWFza2VkIGZhaWx1cmUgKGBnaXQgYXBwbHlcbiAqIHAuZGlmZiB8fCBlY2hvIG9rYCBleGl0aW5nIDApIHN1cHByZXNzZXMgbm90aGluZywgYW5kIGEgdHJhaWxpbmcgZmFpbHVyZVxuICogKGBzZWQgLWkgcy9hL2IvIGY7IGZhbHNlYCBleGl0aW5nIDEpIHN1cHByZXNzZXMgdGhlIGVhcmxpZXIgcmVhbCB3cml0ZS5cbiAqIEFuZCB0aGUgXCJmYWlsZWQsIHNvIHRoZSB3cml0ZSBkaWQgbm90IGhhcHBlblwiIHByZW1pc2UgYmVoaW5kIHRoZVxuICogc3VwcHJlc3Npb24gaG9sZHMgZm9yIGF0b21pYyBmYWlsdXJlcyAoYGdpdCBhcHBseWAgd2l0aG91dCBgLS1yZWplY3RgLFxuICogcHJldHRpZXIgb24gYSBzeW50YXggZXJyb3IpIGJ1dCBvdmVyLXN1cHByZXNzZXMgdGhlIG5vbi1hdG9taWMgd3JpdGVyc1xuICogdGhhdCBtb2RpZnkgYmVmb3JlIGZhaWxpbmcgXHUyMDE0IEdOVSBgcGF0Y2hgIGFwcGx5aW5nIGVhcmxpZXIgaHVua3MsIGBnaXRcbiAqIGFwcGx5IC0tcmVqZWN0YCB3cml0aW5nIHRoZSBhcHBsaWNhYmxlIGh1bmtzIHBsdXMgYC5yZWpgIGZpbGVzLCBhbmRcbiAqIGZvcm1hdHRlcnMgKGBlc2xpbnQgLS1maXhgLCBgcnVib2NvcCAtYWApIHdyaXRpbmcgdGhlaXIgZml4ZXMgYmVmb3JlXG4gKiBleGl0aW5nIG5vbnplcm8gb24gcmVtYWluaW5nIHZpb2xhdGlvbnMuIFRoYXQgd3JvdGUtYnV0LW5vbnplcm8gY29ybmVyIGlzXG4gKiBhY2NlcHRlZCBhbmQgcGlubmVkIGJ5IHRoZSBnYXRlJ3MgdGVzdHMgcmF0aGVyIHRoYW4gY2FydmVkIG91dC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJhc2hSZXNwb25zZUV4aXRDb2RlKHRvb2xSZXNwb25zZTogdW5rbm93bik6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIGlmICh0b29sUmVzcG9uc2UgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xSZXNwb25zZSA9PT0gJ29iamVjdCcpIHtcbiAgICBjb25zdCBjb2RlID0gKHRvb2xSZXNwb25zZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikuZXhpdF9jb2RlO1xuICAgIGlmICh0eXBlb2YgY29kZSA9PT0gJ251bWJlcicgJiYgTnVtYmVyLmlzSW50ZWdlcihjb2RlKSkgcmV0dXJuIGNvZGU7XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUaGUgcGVyLWNvbW1hbmQgdmVyZGljdCBkcml2ZXIgKHBsYW4gXHUwMEE3MyBzdGVwIDIpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudHlwZSBSZXNvbHZlZE1hdGNoID0gRXh0cmFjdDxTcGFuTWF0Y2gsIHsgc3RhdHVzOiAncmVzb2x2ZWQnIH0+O1xudHlwZSBHdWFyZE1hdGNoID0gRXh0cmFjdDxTcGFuTWF0Y2gsIHsgc3RhdHVzOiAnYnVpbHRpbi1ndWFyZCcgfT47XG5cbnR5cGUgVmVyZGljdCA9ICdmYWlsZWQnIHwgJ3N1Y2NlZWRlZCcgfCAndW5rbm93bic7XG5cbi8qKlxuICogRmlsZS1wcm9kdWNpbmcgd3JpdGUgb3BlcmF0aW9ucyBcdTIwMTQgdGhlIG9ubHkgc3BhbnMgdGhhdCBjYW4gZXhwbGFpbiBhXG4gKiBkZWxldGUncyBkZWNpc2l2ZUZhaWwgYnkgcmUtY3JlYXRpbmcgaXRzIHBhdGggbGF0ZXIgaW4gdGhlIGNvbXBvdW5kIChwbGFuXG4gKiBcdTAwQTczIHN0ZXAgMiwgcm91bmQtMykuIGBtb2RpZnlgIChzZWQgLWkgYW5kIGZyaWVuZHMpIGRlbGliZXJhdGVseSBjYW5ub3Q6XG4gKiBpdCBuZXZlciBjcmVhdGVzIGEgbWlzc2luZyBmaWxlLCBzbyBhbiBlbmQtc3RhdGUtcHJlc2VudCBwYXRoIGFmdGVyIGFcbiAqIGZhaWxlZCBgcm1gIGlzIG5ldmVyIGl0cyBkb2luZy5cbiAqL1xuY29uc3QgRklMRV9QUk9EVUNJTkdfT1BTOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChbJ2NyZWF0ZS1vdmVyd3JpdGUnLCAncmVuYW1lLWNvcHknLCAndHJ1bmNhdGUnLCAnYXBwZW5kJ10pO1xuXG4vKiogT25lIHBhc3MtQSBldmFsdWF0aW9uOiB0aGUgc3BhbiwgaXRzIHRvdWNoLCBhbmQgdGhlIChwb3N0LXJlc29sdXRpb24pIGdhdGUgb3V0Y29tZS4gKi9cbmludGVyZmFjZSBTcGFuRXZhbCB7XG4gIG1hdGNoOiBSZXNvbHZlZE1hdGNoO1xuICAvKiogVGhlIHRyYW5zbGF0ZWQgdG91Y2gsIG9yIGBudWxsYCB3aGVuIHRoZSBzcGFuIGZhaWxlZCBgcmVzb2x2ZVRvdWNoU2NvcGVgLiAqL1xuICB0b3VjaDogVG91Y2hJbnB1dCB8IG51bGw7XG4gIC8qKiBUaGUgcGFzcy1BIGdhdGUgb3V0Y29tZSwgcG9zdC1yZXNvbHV0aW9uIGZvciBgJ3BlbmRpbmcnYCBhbmQgZXhwbGFpbmVkIGZhaWxzLiAqL1xuICBvdXRjb21lOiBXcml0ZUdhdGVPdXRjb21lO1xuICAvKiogQSBkZWNpc2l2ZUZhaWwgZG93bmdyYWRlZCBieSBhIGxhdGVyIHNhbWUtcGF0aCBkZWNpc2l2ZVBhc3MgKHBsYW4gXHUwMEE3MyBzdGVwIDIpLiAqL1xuICBleHBsYWluZWQ6IGJvb2xlYW47XG4gIGNvbW1hbmRJbmRleDogbnVtYmVyO1xuICAvKiogVGhlIHNwYW4ncyBvd24gcGF0aCBcdTIwMTQgdGhlIGV4cGxhbmF0aW9uIGtleSBmb3IgZGVjaXNpdmUgZmFpbHMuICovXG4gIHBhdGg6IHN0cmluZztcbiAgLyoqIGNwIGRlc3RpbmF0aW9uczogdGhlIHBhaXJlZCBzb3VyY2UgcGF0aCBcdTIwMTQgdGhlIGV4cGxhbmF0aW9uIGtleSBmb3IgcGVuZGluZ3MuICovXG4gIHNvdXJjZUtleTogc3RyaW5nIHwgbnVsbDtcbn1cblxuLyoqXG4gKiBFdmFsdWF0ZSBvbmUgc3BhbidzIGdhdGUuIFJlYWRzIGhhdmUgbm8gZ2F0ZSBcdTIxOTIgYCdpbmNvbmNsdXNpdmUnYCwgd2l0aCBvbmVcbiAqIGV4Y2VwdGlvbjogY3AvaW5zdGFsbCBzb3VyY2UgcmVhZHMgZ2F0ZSBvbiB0aGUgc291cmNlIGV4aXN0aW5nIHBvc3QtY29tbWFuZFxuICogKHBsYW4gXHUwMEE3MikgXHUyMDE0IGEgZmFpbGVkIGNvcHkgbmV2ZXIgcmVhZCBhbnl0aGluZy4gVGhlIHJlYWQgdmVyZGljdCBmbGlwcyBvbmx5XG4gKiB0aGUgY29tbWFuZCdzIGpvaW4gdmVyZGljdCwgbmV2ZXIgdGhlIHNhbWUgY29tbWFuZCdzIGRlc3Qgd3JpdGUuXG4gKi9cbmZ1bmN0aW9uIGV2YWxTcGFuR2F0ZShtYXRjaDogUmVzb2x2ZWRNYXRjaCwgdG91Y2g6IFRvdWNoSW5wdXQgfCBudWxsLCBwcm9iZUNhY2hlOiBSZWFsaXR5UHJvYmVDYWNoZSk6IFdyaXRlR2F0ZU91dGNvbWUge1xuICBpZiAodG91Y2ggPT09IG51bGwpIHJldHVybiAnaW5jb25jbHVzaXZlJztcbiAgaWYgKHRvdWNoLmtpbmQgPT09ICdyZWFkJykge1xuICAgIGlmICgobWF0Y2guaWRpb20gPT09ICdjcC13cml0ZScgfHwgbWF0Y2guaWRpb20gPT09ICdpbnN0YWxsLXdyaXRlJykgJiYgbWF0Y2guc3Bhbi5vcGVyYXRpb24gPT09ICdyZWFkJykge1xuICAgICAgcmV0dXJuIGZpbGVFeGlzdHMobWF0Y2guc3Bhbi5hYnNvbHV0ZVBhdGgpID8gJ2luY29uY2x1c2l2ZScgOiAnZGVjaXNpdmVGYWlsJztcbiAgICB9XG4gICAgcmV0dXJuICdpbmNvbmNsdXNpdmUnO1xuICB9XG4gIHJldHVybiBldmFsdWF0ZVdyaXRlR2F0ZSh0b3VjaCwgcHJvYmVDYWNoZSk7XG59XG5cbi8qKiBUaGUgb3BlcmF0b3IgcHJlY2VkaW5nIGEgY29tbWFuZCwgZnJvbSBpdHMgZmlyc3Qgc3BhbiAoYWxsIHNwYW5zIG9mIG9uZSBjb21tYW5kIHNoYXJlIGl0KSBcdTIwMTQgb3IgZnJvbSBpdHMgZ3VhcmQgbWF0Y2ggd2hlbiB0aGUgY29tbWFuZCBoYXMgbm8gc3BhbnMuICovXG5mdW5jdGlvbiBqb2luT2ZDb21tYW5kKFxuICBpZHg6IG51bWJlcixcbiAgZ3JvdXBzOiBNYXA8bnVtYmVyLCBSZXNvbHZlZE1hdGNoW10+LFxuICBndWFyZEJ5SW5kZXg6IE1hcDxudW1iZXIsIEd1YXJkTWF0Y2g+XG4pOiAnJiYnIHwgJ3x8JyB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IHNwYW5zID0gZ3JvdXBzLmdldChpZHgpO1xuICBpZiAoc3BhbnMgIT09IHVuZGVmaW5lZCkge1xuICAgIGZvciAoY29uc3QgbSBvZiBzcGFucykge1xuICAgICAgaWYgKG0uc3Bhbi5qb2luICE9PSB1bmRlZmluZWQpIHJldHVybiBtLnNwYW4uam9pbjtcbiAgICB9XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICByZXR1cm4gZ3VhcmRCeUluZGV4LmdldChpZHgpPy5qb2luO1xufVxuXG4vKipcbiAqIFNoYXJlZCBCYXNoIGRyaXZlciAocGxhbiBcdTAwQTczIHN0ZXAgMik6IG93bnMgdGhlIHBlci1jb21tYW5kIHZlcmRpY3QgdGhyZWFkIFx1MjAxNFxuICogcGFzcyBBIGBldmFsdWF0ZVdyaXRlR2F0ZWAgc3dlZXAgKGV2ZXJ5IHNwYW4sIGJlZm9yZSBhbnkgam9pbiBkZWNpc2lvbiksXG4gKiB0aGUgZXhwbGFuYXRpb24gbWFwLCBwZXItY29tbWFuZCB2ZXJkaWN0cywgdGhlIGpvaW4gZmlsdGVyIHdpdGggY2hhaW5lZFxuICogc2tpcHMsIGFuZCBwYXNzIEIgcGVyLXN1cnZpdmluZy1zcGFuIGBydW5Ub3VjaEhvb2tgIFx1MjAxNCBwbHVzIHRoZSB3aG9sZS1jb21tYW5kXG4gKiBgaW50ZXJydXB0ZWRgIGFuZCBleGl0LWNvZGUgZ2F0ZXMgKHBsYW4gXHUwMEE3NCkgYW5kIHRoZSBzcGFuLWxlc3MtZ3VhcmRcbiAqIGNvbW1hbmRzIChgZmFsc2VgL2B0cnVlYC9gOmAgam9pbiB2ZXJkaWN0cyB3aXRoIG5vIHNwYW5zIG9mIHRoZWlyIG93bikuXG4gKiBSZXR1cm5zIHRoZSBub24tbnVsbCBgYWRkaXRpb25hbENvbnRleHRgIGJsb2NrcyBmb3IgdGhlIGFkYXB0ZXIgdG8gam9pbjtcbiAqIHRoZSBzZXNzaW9uIG1lbW8gZGVkdXBzIHJlcGVhdGVkIHRhcmdldHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5CYXNoVG91Y2hlcyhcbiAgbWF0Y2hlczogU3Bhbk1hdGNoW10sXG4gIHNlc3Npb25JZDogc3RyaW5nLFxuICBjd2Q6IHN0cmluZyxcbiAgdG9vbFJlc3BvbnNlOiB1bmtub3duLFxuICBleGVjdXRvcnM6IFRvdWNoRXhlY3V0b3JzLFxuICBtZW1vOiBNZW1vU3RvcmUsXG4gIHdhcm46IChtZXNzYWdlOiBzdHJpbmcpID0+IHZvaWQgPSBjb25zb2xlLndhcm5cbik6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgLy8gQSBjb21tYW5kIHRoYXQgZGlkIG5vdCBjb21wbGV0ZSBwcm9kdWNlcyBubyB0b3VjaGVzLCB3aGF0ZXZlciBpdHMgc3BhbnMuXG4gIGlmIChiYXNoUmVzcG9uc2VJbnRlcnJ1cHRlZCh0b29sUmVzcG9uc2UpKSByZXR1cm4gW107XG4gIGNvbnN0IGV4aXRDb2RlID0gYmFzaFJlc3BvbnNlRXhpdENvZGUodG9vbFJlc3BvbnNlKTtcbiAgY29uc3QgcmVzb2x2ZWQgPSBtYXRjaGVzLmZpbHRlcigobSk6IG0gaXMgUmVzb2x2ZWRNYXRjaCA9PiBtLnN0YXR1cyA9PT0gJ3Jlc29sdmVkJyk7XG4gIGNvbnN0IGd1YXJkcyA9IG1hdGNoZXMuZmlsdGVyKChtKTogbSBpcyBHdWFyZE1hdGNoID0+IG0uc3RhdHVzID09PSAnYnVpbHRpbi1ndWFyZCcpO1xuICBpZiAocmVzb2x2ZWQubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG5cbiAgLy8gU2VlZCB0aGUgcGVyLWNvbW1hbmQgcHJvYmUgY2FjaGUgKHBsYW4gXHUwMEE3MyBzdGVwIDFjKSB3aXRoIGV2ZXJ5IGFic2VudFxuICAvLyB0YXJnZXQgYW5kIGNwL2luc3RhbGwgc291cmNlIG9mIHRoZSBjb21wb3VuZDsgdGhlIGZpcnN0IGdhdGUgdGhhdCBuZWVkc1xuICAvLyBpdCBydW5zIG9uZSBscy1maWxlcyArIG9uZSBzcGFuLWxpc3QgYmF0Y2ggZm9yIGFsbCBvZiB0aGVtLiBUaGVcbiAgLy8gbGF0ZXItcmVjcmVhdGUgZXhwbGFuYXRpb24ncyBwcm9iZSBzY29wZSAocm91bmQtMykgcmlkZXMgYWxvbmdzaWRlOiB0aGVcbiAgLy8gZGVsZXRlIHBhdGhzIGEgbGF0ZXIgY29tbWFuZCBjYW4gcmUtY3JlYXRlIHdpdGggYSBmaWxlLXByb2R1Y2luZyB3cml0ZSBcdTIwMTRcbiAgLy8gdGhlaXIgd29ya2luZy10cmVlLXZzLWluZGV4IHN0YXR1cyBpcyB0aGUgcmUtY3JlYXRlJ3MgbWFyaywgcmVhZCBvbmNlIGluXG4gIC8vIG9uZSBgZ2l0IHN0YXR1c2AgYmF0Y2guXG4gIGNvbnN0IHByb2JlUGF0aHM6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGZpbGVQcm9kdWNpbmdCeVBhdGggPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyW10+KCk7XG4gIGZvciAoY29uc3QgbSBvZiByZXNvbHZlZCkge1xuICAgIGlmIChtLnNwYW4ub3BlcmF0aW9uID09PSAnZGVsZXRlJykgcHJvYmVQYXRocy5wdXNoKG0uc3Bhbi5hYnNvbHV0ZVBhdGgpO1xuICAgIGVsc2UgaWYgKChtLmlkaW9tID09PSAnY3Atd3JpdGUnIHx8IG0uaWRpb20gPT09ICdpbnN0YWxsLXdyaXRlJykgJiYgbS5zcGFuLm9wZXJhdGlvbiA9PT0gJ3JlYWQnKSB7XG4gICAgICBwcm9iZVBhdGhzLnB1c2gobS5zcGFuLmFic29sdXRlUGF0aCk7XG4gICAgfSBlbHNlIGlmIChGSUxFX1BST0RVQ0lOR19PUFMuaGFzKG0uc3Bhbi5vcGVyYXRpb24pKSB7XG4gICAgICBjb25zdCBsaXN0ID0gZmlsZVByb2R1Y2luZ0J5UGF0aC5nZXQobS5zcGFuLmFic29sdXRlUGF0aCk7XG4gICAgICBpZiAobGlzdCAhPT0gdW5kZWZpbmVkKSBsaXN0LnB1c2gobS5zcGFuLnNpbXBsZUNvbW1hbmRJbmRleCk7XG4gICAgICBlbHNlIGZpbGVQcm9kdWNpbmdCeVBhdGguc2V0KG0uc3Bhbi5hYnNvbHV0ZVBhdGgsIFttLnNwYW4uc2ltcGxlQ29tbWFuZEluZGV4XSk7XG4gICAgfVxuICB9XG4gIGNvbnN0IHJlY3JlYXRlUHJvYmVQYXRoczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBtIG9mIHJlc29sdmVkKSB7XG4gICAgaWYgKG0uc3Bhbi5vcGVyYXRpb24gIT09ICdkZWxldGUnKSBjb250aW51ZTtcbiAgICBjb25zdCBsYXRlciA9IChmaWxlUHJvZHVjaW5nQnlQYXRoLmdldChtLnNwYW4uYWJzb2x1dGVQYXRoKSA/PyBbXSkuc29tZSgoaSkgPT4gaSA+IG0uc3Bhbi5zaW1wbGVDb21tYW5kSW5kZXgpO1xuICAgIGlmIChsYXRlcikgcmVjcmVhdGVQcm9iZVBhdGhzLnB1c2gobS5zcGFuLmFic29sdXRlUGF0aCk7XG4gIH1cbiAgY29uc3QgcHJvYmVDYWNoZSA9IGNyZWF0ZVJlYWxpdHlQcm9iZUNhY2hlKHByb2JlUGF0aHMsIHJlY3JlYXRlUHJvYmVQYXRocyk7XG5cbiAgLy8gR3JvdXAgYnkgc2ltcGxlIGNvbW1hbmQgaW4gd2Fsa2VyIG9yZGVyLiBTcGFuLWxlc3MgZ3VhcmQgY29tbWFuZHNcbiAgLy8gKGBmYWxzZWAvYHRydWVgL2A6YCkgam9pbiB0aGUgb3JkZXIgd2l0aCBubyBncm91cDogdGhlaXIgZGV0ZXJtaW5pc3RpY1xuICAvLyBleGl0IHN0YXR1cyBkcml2ZXMgdGhlIGpvaW4gZmlsdGVyLCBhbmQgdGhleSBuZXZlciB0b3VjaCBhbnl0aGluZy5cbiAgY29uc3QgZ3JvdXBzID0gbmV3IE1hcDxudW1iZXIsIFJlc29sdmVkTWF0Y2hbXT4oKTtcbiAgY29uc3QgZ3VhcmRCeUluZGV4ID0gbmV3IE1hcDxudW1iZXIsIEd1YXJkTWF0Y2g+KCk7XG4gIGNvbnN0IGNvbW1hbmRPcmRlcjogbnVtYmVyW10gPSBbXTtcbiAgZm9yIChjb25zdCBtIG9mIHJlc29sdmVkKSB7XG4gICAgY29uc3QgaWR4ID0gbS5zcGFuLnNpbXBsZUNvbW1hbmRJbmRleDtcbiAgICBjb25zdCBsaXN0ID0gZ3JvdXBzLmdldChpZHgpO1xuICAgIGlmIChsaXN0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGxpc3QucHVzaChtKTtcbiAgICB9IGVsc2Uge1xuICAgICAgZ3JvdXBzLnNldChpZHgsIFttXSk7XG4gICAgICBjb21tYW5kT3JkZXIucHVzaChpZHgpO1xuICAgIH1cbiAgfVxuICBmb3IgKGNvbnN0IGcgb2YgZ3VhcmRzKSB7XG4gICAgaWYgKGdyb3Vwcy5oYXMoZy5zaW1wbGVDb21tYW5kSW5kZXgpIHx8IGd1YXJkQnlJbmRleC5oYXMoZy5zaW1wbGVDb21tYW5kSW5kZXgpKSBjb250aW51ZTtcbiAgICBndWFyZEJ5SW5kZXguc2V0KGcuc2ltcGxlQ29tbWFuZEluZGV4LCBnKTtcbiAgICBjb21tYW5kT3JkZXIucHVzaChnLnNpbXBsZUNvbW1hbmRJbmRleCk7XG4gIH1cbiAgY29tbWFuZE9yZGVyLnNvcnQoKGEsIGIpID0+IGEgLSBiKTtcblxuICAvLyBQYXNzIEE6IHRyYW5zbGF0ZSBldmVyeSBzcGFuIG9uY2UgYW5kIGV2YWx1YXRlIGl0cyBnYXRlLCBwYWlyaW5nXG4gIC8vIGNwL2luc3RhbGwgc291cmNlcyB3aXRoIGRlc3RpbmF0aW9ucyBhbmQgbXYgZGVsZXRlcyB3aXRoIHJlbmFtZS1jb3BpZXMgYnlcbiAgLy8gZGVjbGFyYXRpb24gb3JkZXIgKHRoZSBwYXJzZXIgZW1pdHMgc291cmNlcyBiZWZvcmUgZGVzdGluYXRpb25zKS5cbiAgY29uc3QgZXZhbHMgPSBuZXcgTWFwPG51bWJlciwgU3BhbkV2YWxbXT4oKTtcbiAgZm9yIChjb25zdCBpZHggb2YgY29tbWFuZE9yZGVyKSB7XG4gICAgY29uc3Qgc3BhbnMgPSBncm91cHMuZ2V0KGlkeCk7XG4gICAgaWYgKHNwYW5zID09PSB1bmRlZmluZWQpIGNvbnRpbnVlOyAvLyBndWFyZC1vbmx5IGNvbW1hbmQgXHUyMDE0IG5vdGhpbmcgdG8gZXZhbHVhdGVcbiAgICBjb25zdCByZWFkUGF0aHMgPSBzcGFuc1xuICAgICAgLmZpbHRlcigobSkgPT4gKG0uaWRpb20gPT09ICdjcC13cml0ZScgfHwgbS5pZGlvbSA9PT0gJ2luc3RhbGwtd3JpdGUnKSAmJiBtLnNwYW4ub3BlcmF0aW9uID09PSAncmVhZCcpXG4gICAgICAubWFwKChtKSA9PiBtLnNwYW4uYWJzb2x1dGVQYXRoKTtcbiAgICBjb25zdCBkZWxldGVQYXRocyA9IHNwYW5zLmZpbHRlcigobSkgPT4gbS5zcGFuLm9wZXJhdGlvbiA9PT0gJ2RlbGV0ZScpLm1hcCgobSkgPT4gbS5zcGFuLmFic29sdXRlUGF0aCk7XG4gICAgbGV0IHJlYWRDdXJzb3IgPSAwO1xuICAgIGxldCBkZWxldGVDdXJzb3IgPSAwO1xuICAgIGNvbnN0IGxpc3Q6IFNwYW5FdmFsW10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IG0gb2Ygc3BhbnMpIHtcbiAgICAgIGNvbnN0IHRvdWNoID0gYmFzaFNwYW5Ub1RvdWNoKG0uc3Bhbiwgc2Vzc2lvbklkLCBjd2QpO1xuICAgICAgY29uc3QgZW50cnk6IFNwYW5FdmFsID0ge1xuICAgICAgICBtYXRjaDogbSxcbiAgICAgICAgdG91Y2gsXG4gICAgICAgIG91dGNvbWU6ICdpbmNvbmNsdXNpdmUnLFxuICAgICAgICBleHBsYWluZWQ6IGZhbHNlLFxuICAgICAgICBjb21tYW5kSW5kZXg6IGlkeCxcbiAgICAgICAgcGF0aDogbS5zcGFuLmFic29sdXRlUGF0aCxcbiAgICAgICAgc291cmNlS2V5OiBudWxsXG4gICAgICB9O1xuICAgICAgaWYgKHRvdWNoICE9PSBudWxsICYmIHRvdWNoLmtpbmQgPT09ICd3cml0ZScpIHtcbiAgICAgICAgaWYgKG0uc3Bhbi5vcGVyYXRpb24gPT09ICdjcmVhdGUtb3ZlcndyaXRlJyAmJiAobS5pZGlvbSA9PT0gJ2NwLXdyaXRlJyB8fCBtLmlkaW9tID09PSAnaW5zdGFsbC13cml0ZScpKSB7XG4gICAgICAgICAgY29uc3Qgc291cmNlID0gcmVhZFBhdGhzW3JlYWRDdXJzb3JdO1xuICAgICAgICAgIGlmIChzb3VyY2UgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgcmVhZEN1cnNvciArPSAxO1xuICAgICAgICAgICAgLy8gYGluc3RhbGwgLXNgL2AtLXN0cmlwYCBpcyBkZWxpYmVyYXRlbHkgbmV2ZXIgcGFpcmVkOiBzdHJpcHBlZFxuICAgICAgICAgICAgLy8gb3V0cHV0IG5ldmVyIGVxdWFscyB0aGUgc291cmNlLCBzbyBpbnN0YWxsIGRlc3RzIGdhdGVcbiAgICAgICAgICAgIC8vIGV4aXN0ZW5jZS1vbmx5IChwbGFuIFx1MDBBNzMgc3RlcCAxYikuXG4gICAgICAgICAgICBpZiAobS5pZGlvbSA9PT0gJ2NwLXdyaXRlJykge1xuICAgICAgICAgICAgICB0b3VjaC5zb3VyY2VQYXRoID0gc291cmNlO1xuICAgICAgICAgICAgICBlbnRyeS5zb3VyY2VLZXkgPSBzb3VyY2U7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKG0uc3Bhbi5vcGVyYXRpb24gPT09ICdyZW5hbWUtY29weScpIHtcbiAgICAgICAgICBjb25zdCBzb3VyY2UgPSBkZWxldGVQYXRoc1tkZWxldGVDdXJzb3JdO1xuICAgICAgICAgIGlmIChzb3VyY2UgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZGVsZXRlQ3Vyc29yICs9IDE7XG4gICAgICAgICAgICB0b3VjaC5yZW5hbWVTb3VyY2VQYXRoID0gc291cmNlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgZW50cnkub3V0Y29tZSA9IGV2YWxTcGFuR2F0ZShtLCB0b3VjaCwgcHJvYmVDYWNoZSk7XG4gICAgICBsaXN0LnB1c2goZW50cnkpO1xuICAgIH1cbiAgICBldmFscy5zZXQoaWR4LCBsaXN0KTtcbiAgfVxuXG4gIC8vIFRoZSBleHBsYW5hdGlvbiBtYXAgKHBsYW4gXHUwMEE3MyBzdGVwIDIpOiB0aGUgaGlnaGVzdCBzaW1wbGVDb21tYW5kSW5kZXggd2l0aFxuICAvLyBhIGRlY2lzaXZlUGFzcyBvbiBlYWNoIHBhdGguXG4gIGNvbnN0IHBhc3NCeVBhdGggPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuICBmb3IgKGNvbnN0IGlkeCBvZiBjb21tYW5kT3JkZXIpIHtcbiAgICBjb25zdCBsaXN0ID0gZXZhbHMuZ2V0KGlkeCk7XG4gICAgaWYgKGxpc3QgPT09IHVuZGVmaW5lZCkgY29udGludWU7XG4gICAgZm9yIChjb25zdCBlIG9mIGxpc3QpIHtcbiAgICAgIGlmIChlLm91dGNvbWUgPT09ICdkZWNpc2l2ZVBhc3MnKSB7XG4gICAgICAgIGNvbnN0IHByZXYgPSBwYXNzQnlQYXRoLmdldChlLnBhdGgpO1xuICAgICAgICBpZiAocHJldiA9PT0gdW5kZWZpbmVkIHx8IGlkeCA+IHByZXYpIHBhc3NCeVBhdGguc2V0KGUucGF0aCwgaWR4KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBSZXNvbHZlIHRoZSBhYnNlbnQtc291cmNlIGhvbGRzIGFnYWluc3QgdGhlIG5vdy1jb21wbGV0ZSBtYXAsIGFuZFxuICAvLyBkb3duZ3JhZGUgZXhwbGFpbmVkIGZhaWxzOiBhIGRlY2lzaXZlRmFpbCBvbiBhIHBhdGggYSBsYXRlciBjb21tYW5kXG4gIC8vIGRlbW9uc3RyYWJseSByZXdyb3RlIG9yIGRlbGV0ZWQgaXMgdGhlIG92ZXJ3cml0ZSwgbm90IHRoZSBlYXJsaWVyIGNvbW1hbmRcbiAgLy8gZmFpbGluZyAocGxhbiBcdTAwQTczIHN0ZXAgMikuXG4gIGZvciAoY29uc3QgaWR4IG9mIGNvbW1hbmRPcmRlcikge1xuICAgIGNvbnN0IGxpc3QgPSBldmFscy5nZXQoaWR4KTtcbiAgICBpZiAobGlzdCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICBmb3IgKGNvbnN0IGUgb2YgbGlzdCkge1xuICAgICAgaWYgKGUub3V0Y29tZSA9PT0gJ3BlbmRpbmcnKSB7XG4gICAgICAgIGNvbnN0IHBhc3NJZHggPSBlLnNvdXJjZUtleSAhPT0gbnVsbCA/IHBhc3NCeVBhdGguZ2V0KGUuc291cmNlS2V5KSA6IHVuZGVmaW5lZDtcbiAgICAgICAgZS5vdXRjb21lID0gcGFzc0lkeCAhPT0gdW5kZWZpbmVkICYmIHBhc3NJZHggPiBlLmNvbW1hbmRJbmRleCA/ICdkZWNpc2l2ZVBhc3MnIDogJ2RlY2lzaXZlRmFpbCc7XG4gICAgICB9IGVsc2UgaWYgKGUub3V0Y29tZSA9PT0gJ2RlY2lzaXZlRmFpbCcpIHtcbiAgICAgICAgY29uc3QgcGFzc0lkeCA9IHBhc3NCeVBhdGguZ2V0KGUucGF0aCk7XG4gICAgICAgIGlmIChwYXNzSWR4ICE9PSB1bmRlZmluZWQgJiYgcGFzc0lkeCA+IGUuY29tbWFuZEluZGV4KSBlLmV4cGxhaW5lZCA9IHRydWU7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gVGhlIGxhdGVyLXJlY3JlYXRlIGV4cGxhbmF0aW9uIChyb3VuZC0zLCBtYXJrIHdpZGVuZWQgcm91bmQtNCk6IGFcbiAgLy8gZGVsZXRlJ3MgZGVjaXNpdmVGYWlsIFx1MjAxNCBcImZpbGUgcHJlc2VudCwgc28gdGhlIGRlbGV0ZSBkaWRuJ3QgaGFwcGVuXCIgXHUyMDE0IGlzXG4gIC8vIGFsc28gZXhwbGFpbmVkIHdoZW4gYSBMQVRFUiBjb21tYW5kIHdyaXRlcyB0aGUgc2FtZSBwYXRoIHdpdGggYVxuICAvLyBmaWxlLXByb2R1Y2luZyBvcGVyYXRpb24gd2hvc2Ugb3duIGdhdGUgZGlkIG5vdCBmYWlsIChhIGRlY2lzaXZlRmFpbFxuICAvLyB0aGVyZSBwcm92ZXMgdGhlIHdyaXRlIGRpZG4ndCBoYXBwZW4pIEFORCB0aGUgcGF0aCBjYXJyaWVzIGFueSB0cmFja2VkXG4gIC8vIHN0YXR1cyByb3cgXHUyMDE0IGluZGV4IGNvbHVtbiBvciB3b3JrdHJlZSBjb2x1bW4sIHJlYWQgZnJvbSB0aGUgcGVyLWNvbW1hbmRcbiAgLy8gcHJvYmUgKHNlZSB0aGUgcHJvYmUncyBwZXItY29sdW1uIHJlYXNvbmluZykuIEEgZmlsZSB3aXRoIE5PIHN0YXR1cyByb3dcbiAgLy8gbWVhbnMgaXQgc3RpbGwgbWF0Y2hlcyBIRUFEOiB0aGUgY2hhaW4gc2hvcnQtY2lyY3VpdGVkIGJlZm9yZSB0aGUgd3JpdGVcbiAgLy8gKHRoZSBybSBmYWlsZWQgYW5kIGAmJmAgZHJvcHBlZCB0aGUgcmVzdCksIHNvIHRoZSBmYWlsIHN0YW5kcyBhbmQgdGhlXG4gIC8vIGpvaW4gZmlsdGVyIHN0aWxsIHN1cHByZXNzZXMgdGhlIGpvaW5lZCBjb21tYW5kLiBUaGUgaW5kZXggY29sdW1uIGlzXG4gIC8vIHdoYXQgc2VwYXJhdGVzIHRoZSB0d28gcmVhbGl0aWVzIGEgY2xlYW4gd29ya3RyZWUgY2Fubm90OiBgcm0gZiAmJiBwYXRjaFxuICAvLyAtcDAgPCBkICYmIGdpdCBhZGQgZmAgZW5kcyB3aXRoIGYgc3RhZ2VkIChgTSBgIHJvdywgYmxhbmsgd29ya3RyZWVcbiAgLy8gY29sdW1uKSBcdTIwMTQgdGhlIHdyaXRlIHJhbiBhbmQgd2FzIHZlcmlmaWVkIGludG8gdGhlIGluZGV4IFx1MjAxNCB3aGlsZSBhXG4gIC8vIGdlbnVpbmVseSBmYWlsZWQgcm0gbGVhdmVzIG5vIHJvdyBhdCBhbGwuIFRoaXMgaXMgdGhlIGV4aXN0ZW5jZS1nYXRlZFxuICAvLyBzaWJsaW5nIG9mIHRoZSBkZWNpc2l2ZVBhc3MgZXhwbGFuYXRpb24gYWJvdmU6IGBybSBmICYmIHBhdGNoIC1wMCA8XG4gIC8vIG5ldy5kaWZmYCBlbmRzIHdpdGggZiBwcmVzZW50IGJlY2F1c2UgdGhlIHBhdGNoIHJlLWNyZWF0ZWQgaXQsIG5vdFxuICAvLyBiZWNhdXNlIHRoZSBybSBmYWlsZWQsIGFuZCB0aGUgcGF0Y2gncyBnYXRlIGlzIGluY29uY2x1c2l2ZSBcdTIwMTQgb25seSB0aGlzXG4gIC8vIHJ1bGUgY2FuIHNlZSB0aGUgcmUtY3JlYXRlLiBDb250ZW50LXZlcmlmaWVkIHJlLWNyZWF0ZXMgKGVjaG8vY3AvXG4gIC8vIHRydW5jYXRlIHdpdGggYSBib2R5KSBuZXZlciBuZWVkIGl0IFx1MjAxNCB0aGVpciBkZWNpc2l2ZVBhc3MgZXhwbGFpbnMgdmlhXG4gIC8vIHRoZSBtYXAgYWJvdmUuIFJlc2lkdWFsOiBhIHByZS1leGlzdGluZyB1bmNvbW1pdHRlZCBPUiBzdGFnZWQgY2hhbmdlIG9uXG4gIC8vIHRoZSBkZWxldGVkIHBhdGggbWFza3MgdGhlIGRpc2NyaW1pbmF0b3IgKHRoZSBmaWxlIGRpZmZlcmVkIGZyb20gdGhlXG4gIC8vIGluZGV4IGJlZm9yZSB0aGUgY29tcG91bmQgZXZlciByYW4pLCBzbyBhbiBybSB0aGF0IGZhaWxlZCBvbiBhIGRpcnR5XG4gIC8vIHBhdGggbGV0cyB0aGUgam9pbmVkIHdyaXRlIGZpcmUgYWR2aXNvcnkgXHUyMDE0IHNhbWUgYm91bmRlZCBoYXJtIGFzIHRoZVxuICAvLyBwbGFuJ3MgZG9jdW1lbnRlZCBcImNvaW5jaWRlbnRhbGx5IHBhc3Nlc1wiIGpvaW4gY29ybmVyLCBhbmQgYVxuICAvLyBoYXJuZXNzLXN1cHBsaWVkIG5vbi16ZXJvIGV4aXQgY29kZSBzdGlsbCBzdXBwcmVzc2VzIHRoZSBhZHZpc29yeSBjbGFzc1xuICAvLyBpbiBwYXNzIEIuIFRoZSBzdGFnZWQgZmFjZSBpcyB0aGUgd2lkZW5pbmcncyBvbmUgY29zdDogcm91bmQtMydzIGJsYW5rLVlcbiAgLy8gcnVsZSBrZXB0IGBNIGAvYEEgYCByb3dzIGludmlzaWJsZSwgc28gYSBmYWlsZWQgcm0gb24gYSBwcmUtc3RhZ2VkIHBhdGhcbiAgLy8gc3RheWVkIGZ1bGx5IHN1cHByZXNzZWQ7IHRoZSBpbmRleCBjb2x1bW4gbm93IG1hcmtzIGl0LCBhbmQgdGhlIGpvaW5lZFxuICAvLyB3cml0ZSBmaXJlcyBhZHZpc29yeSB3aGVyZXZlciBnZW51aW5lIHN0YWdlZCBkcmlmdCBleGlzdHMgYWdhaW5zdCB0aGVcbiAgLy8gc3BhbiBiYXNlbGluZSAocGlubmVkIGVuZC10by1lbmQgaW4gdGhlIGludGVncmF0aW9uIHN1aXRlKS5cbiAgY29uc3QgcmVjcmVhdGVCeVBhdGggPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuICBmb3IgKGNvbnN0IGlkeCBvZiBjb21tYW5kT3JkZXIpIHtcbiAgICBjb25zdCBsaXN0ID0gZXZhbHMuZ2V0KGlkeCk7XG4gICAgaWYgKGxpc3QgPT09IHVuZGVmaW5lZCkgY29udGludWU7XG4gICAgZm9yIChjb25zdCBlIG9mIGxpc3QpIHtcbiAgICAgIGlmIChlLm91dGNvbWUgPT09ICdkZWNpc2l2ZUZhaWwnKSBjb250aW51ZTtcbiAgICAgIGlmIChlLnRvdWNoID09PSBudWxsIHx8IGUudG91Y2gua2luZCAhPT0gJ3dyaXRlJyB8fCBlLnRvdWNoLnRhcmdldFN0YXRlICE9PSAnZXhpc3RzJykgY29udGludWU7XG4gICAgICBpZiAoIUZJTEVfUFJPRFVDSU5HX09QUy5oYXMoZS5tYXRjaC5zcGFuLm9wZXJhdGlvbikpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgcHJldiA9IHJlY3JlYXRlQnlQYXRoLmdldChlLnBhdGgpO1xuICAgICAgaWYgKHByZXYgPT09IHVuZGVmaW5lZCB8fCBpZHggPiBwcmV2KSByZWNyZWF0ZUJ5UGF0aC5zZXQoZS5wYXRoLCBpZHgpO1xuICAgIH1cbiAgfVxuICBpZiAocmVjcmVhdGVCeVBhdGguc2l6ZSA+IDApIHtcbiAgICBmb3IgKGNvbnN0IGlkeCBvZiBjb21tYW5kT3JkZXIpIHtcbiAgICAgIGNvbnN0IGxpc3QgPSBldmFscy5nZXQoaWR4KTtcbiAgICAgIGlmIChsaXN0ID09PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xuICAgICAgZm9yIChjb25zdCBlIG9mIGxpc3QpIHtcbiAgICAgICAgaWYgKGUub3V0Y29tZSAhPT0gJ2RlY2lzaXZlRmFpbCcgfHwgZS5leHBsYWluZWQpIGNvbnRpbnVlO1xuICAgICAgICBpZiAoZS50b3VjaCA9PT0gbnVsbCB8fCBlLnRvdWNoLmtpbmQgIT09ICd3cml0ZScgfHwgZS50b3VjaC50YXJnZXRTdGF0ZSAhPT0gJ2Fic2VudCcpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCByZWNyZWF0ZUlkeCA9IHJlY3JlYXRlQnlQYXRoLmdldChlLnBhdGgpO1xuICAgICAgICBpZiAocmVjcmVhdGVJZHggIT09IHVuZGVmaW5lZCAmJiByZWNyZWF0ZUlkeCA+IGUuY29tbWFuZEluZGV4ICYmIHdvcmtpbmdUcmVlQ2hhbmdlZChwcm9iZUNhY2hlLCBjd2QsIGUucGF0aCkpIHtcbiAgICAgICAgICBlLmV4cGxhaW5lZCA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBQZXItY29tbWFuZCB2ZXJkaWN0czogJ2ZhaWxlZCcgb24gYW55IHVuZXhwbGFpbmVkIGRlY2lzaXZlRmFpbCwgZWxzZVxuICAvLyAnc3VjY2VlZGVkJyBvbiBhdCBsZWFzdCBvbmUgZGVjaXNpdmUgb3V0Y29tZSwgZWxzZSAndW5rbm93bicuIEFcbiAgLy8gZ3VhcmQtb25seSBjb21tYW5kJ3MgZGV0ZXJtaW5pc3RpYyBleGl0IHN0YXR1cyBJUyBpdHMgdmVyZGljdCAocGxhbiBcdTAwQTczXG4gIC8vIHN0ZXAgMidzIHNwYW4tbGVzcy1ndWFyZCBydWxlKS5cbiAgY29uc3QgY29tcHV0ZWQgPSBuZXcgTWFwPG51bWJlciwgVmVyZGljdD4oKTtcbiAgZm9yIChjb25zdCBpZHggb2YgY29tbWFuZE9yZGVyKSB7XG4gICAgY29uc3QgbGlzdCA9IGV2YWxzLmdldChpZHgpO1xuICAgIGlmIChsaXN0ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGNvbnN0IGd1YXJkID0gZ3VhcmRCeUluZGV4LmdldChpZHgpO1xuICAgICAgY29tcHV0ZWQuc2V0KGlkeCwgZ3VhcmQgIT09IHVuZGVmaW5lZCA/IChndWFyZC5leGl0U3RhdHVzID09PSAwID8gJ3N1Y2NlZWRlZCcgOiAnZmFpbGVkJykgOiAndW5rbm93bicpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGxldCBmYWlsZWQgPSBmYWxzZTtcbiAgICBsZXQgcGFzc2VkID0gZmFsc2U7XG4gICAgZm9yIChjb25zdCBlIG9mIGxpc3QpIHtcbiAgICAgIGlmIChlLm91dGNvbWUgPT09ICdkZWNpc2l2ZUZhaWwnICYmICFlLmV4cGxhaW5lZCkgZmFpbGVkID0gdHJ1ZTtcbiAgICAgIGlmIChlLm91dGNvbWUgPT09ICdkZWNpc2l2ZVBhc3MnKSBwYXNzZWQgPSB0cnVlO1xuICAgIH1cbiAgICBjb21wdXRlZC5zZXQoaWR4LCBmYWlsZWQgPyAnZmFpbGVkJyA6IHBhc3NlZCA/ICdzdWNjZWVkZWQnIDogJ3Vua25vd24nKTtcbiAgfVxuXG4gIC8vIFRoZSBqb2luIGZpbHRlciAocGxhbiBcdTAwQTczIHN0ZXAgMik6IGEgc2tpcHBlZCBjb21tYW5kJ3MgY2hhaW5lZCB2ZXJkaWN0IGlzXG4gIC8vIHRoZSBndWFyZCB0aGF0IHNraXBwZWQgaXQgXHUyMDE0ICdmYWlsZWQnIGFmdGVyIGFuICYmLXNraXAsICdzdWNjZWVkZWQnIGFmdGVyXG4gIC8vIGFuIHx8LXNraXAgXHUyMDE0IG1hdGNoaW5nIHRoZSBzaGVsbCBzaG9ydC1jaXJjdWl0IChhIHx8IGIgfHwgYyBzdG9wcyBhZnRlclxuICAvLyB0aGUgZmlyc3Qgc3VjY2VzcykuICd1bmtub3duJyBmYWlscyBvcGVuLlxuICBjb25zdCBlZmZlY3RpdmUgPSBuZXcgTWFwPG51bWJlciwgVmVyZGljdD4oKTtcbiAgY29uc3Qgc2tpcHBlZCA9IG5ldyBTZXQ8bnVtYmVyPigpO1xuICBsZXQgcHJldkluZGV4OiBudW1iZXIgfCBudWxsID0gbnVsbDtcbiAgZm9yIChjb25zdCBpZHggb2YgY29tbWFuZE9yZGVyKSB7XG4gICAgY29uc3Qgam9pbiA9IGpvaW5PZkNvbW1hbmQoaWR4LCBncm91cHMsIGd1YXJkQnlJbmRleCk7XG4gICAgY29uc3QgcHJldlZlcmRpY3QgPSBwcmV2SW5kZXggIT09IG51bGwgPyBlZmZlY3RpdmUuZ2V0KHByZXZJbmRleCkgOiB1bmRlZmluZWQ7XG4gICAgaWYgKHByZXZWZXJkaWN0ICE9PSB1bmRlZmluZWQgJiYgam9pbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAoKGpvaW4gPT09ICcmJicgJiYgcHJldlZlcmRpY3QgPT09ICdmYWlsZWQnKSB8fCAoam9pbiA9PT0gJ3x8JyAmJiBwcmV2VmVyZGljdCA9PT0gJ3N1Y2NlZWRlZCcpKSB7XG4gICAgICAgIGVmZmVjdGl2ZS5zZXQoaWR4LCBqb2luID09PSAnJiYnID8gJ2ZhaWxlZCcgOiAnc3VjY2VlZGVkJyk7XG4gICAgICAgIHNraXBwZWQuYWRkKGlkeCk7XG4gICAgICAgIHByZXZJbmRleCA9IGlkeDtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuICAgIGVmZmVjdGl2ZS5zZXQoaWR4LCBjb21wdXRlZC5nZXQoaWR4KSEpO1xuICAgIHByZXZJbmRleCA9IGlkeDtcbiAgfVxuXG4gIC8vIFBhc3MgQjogcnVuIHRoZSB0b3VjaCBob29rIGZvciBzdXJ2aXZpbmcgc3BhbnMgb25seSBcdTIwMTQgZGVjaXNpdmVQYXNzLCBvclxuICAvLyBpbmNvbmNsdXNpdmUgd2l0aCBhbiAnZXhpc3RzJyB0YXJnZXQgKHRoZSBhZHZpc29yeSByZXNpZHVhbCBjbGFzczpcbiAgLy8gZXhpc3RlbmNlLWdhdGVkIGZhbWlsaWVzIGZpcmUgYW5kIGhlYWwvc3VyZmFjZTsgcGhhbnRvbSBkZWxldGVzIG5ldmVyXG4gIC8vIGZpcmUpLiBBIGhhcm5lc3Mtc3VwcGxpZWQgbm9uLXplcm8gZXhpdCBjb2RlIHN1cHByZXNzZXMgdGhlIGFkdmlzb3J5XG4gIC8vIGNsYXNzIHRvbywgYm91bmRlZCBieSB0d28gZG9jdW1lbnRlZC1yZXNpZHVlIGZhY2VzIChzZWVcbiAgLy8gYmFzaFJlc3BvbnNlRXhpdENvZGUpOiB0aGUgY29kZSBpcyB0aGUgY29tcG91bmQncywgc28gYSBtYXNrZWQgZmFpbHVyZVxuICAvLyAoYGdpdCBhcHBseSBwLmRpZmYgfHwgZWNobyBva2AgZXhpdGluZyAwKSBzdXBwcmVzc2VzIG5vdGhpbmcgYW5kIGFcbiAgLy8gdHJhaWxpbmcgZmFpbHVyZSAoYHNlZCAtaSBzL2EvYi8gZjsgZmFsc2VgKSBzdXBwcmVzc2VzIGFuIGVhcmxpZXIgcmVhbFxuICAvLyB3cml0ZSBcdTIwMTQgYW5kIGEgbm9uemVybyBjb2RlIGRvZXMgbm90IHByb3ZlIHRoZSB3cml0ZSBkaWQgbm90IGhhcHBlbiBmb3JcbiAgLy8gdGhlIG5vbi1hdG9taWMgd3JpdGVycyB0aGF0IG1vZGlmeSBiZWZvcmUgZmFpbGluZyAocGF0Y2ggYXBwbHlpbmdcbiAgLy8gZWFybGllciBodW5rcywgYGdpdCBhcHBseSAtLXJlamVjdGAsIGZvcm1hdHRlcnMgd3JpdGluZyBmaXhlcyB0aGVuXG4gIC8vIGV4aXRpbmcgbm9uemVybykuIEEgemVybyBvciBhYnNlbnQgY29kZSBwcm9jZWVkcywgYW5kIGNvbnRlbnQtdmVyaWZpZWRcbiAgLy8gZGVjaXNpdmUgcGFzc2VzIGZpcmUgcmVnYXJkbGVzcyAoZmFpbC1vcGVuLCBwbGFuIFx1MDBBNzQpLiBHdWFyZC1vbmx5XG4gIC8vIGNvbW1hbmRzIGhhdmUgbm8gdG91Y2hlcy4gRXhwbGFpbmVkIGZhaWxzIGFuZCBkZWNpc2l2ZSBmYWlscyBuZXZlclxuICAvLyByZWFjaCBhbiBleGVjdXRvci5cbiAgY29uc3QgYmxvY2tzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGlkeCBvZiBjb21tYW5kT3JkZXIpIHtcbiAgICBpZiAoc2tpcHBlZC5oYXMoaWR4KSkgY29udGludWU7XG4gICAgY29uc3QgbGlzdCA9IGV2YWxzLmdldChpZHgpO1xuICAgIGlmIChsaXN0ID09PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xuICAgIGxldCB0b3VjaGVzID0gMDtcbiAgICBmb3IgKGNvbnN0IGUgb2YgbGlzdCkge1xuICAgICAgaWYgKGUudG91Y2ggPT09IG51bGwgfHwgZS5leHBsYWluZWQpIGNvbnRpbnVlO1xuICAgICAgaWYgKGUub3V0Y29tZSA9PT0gJ2RlY2lzaXZlRmFpbCcpIGNvbnRpbnVlO1xuICAgICAgaWYgKGUub3V0Y29tZSA9PT0gJ2luY29uY2x1c2l2ZScgJiYgZS50b3VjaC5raW5kID09PSAnd3JpdGUnICYmIGUudG91Y2gudGFyZ2V0U3RhdGUgPT09ICdhYnNlbnQnKSBjb250aW51ZTtcbiAgICAgIGlmIChlLm91dGNvbWUgPT09ICdpbmNvbmNsdXNpdmUnICYmIGUudG91Y2gua2luZCA9PT0gJ3dyaXRlJyAmJiBleGl0Q29kZSAhPT0gdW5kZWZpbmVkICYmIGV4aXRDb2RlICE9PSAwKVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIGlmICh0b3VjaGVzID49IDMyKSB7XG4gICAgICAgIC8vIEhhcmQgcGVyLWNvbW1hbmQgdm9sdW1lIGNhcCAocGxhbiBcdTAwQTczIHN0ZXAgMik6IGRyb3AgdGhlIHN1cnBsdXMgd2l0aFxuICAgICAgICAvLyBhIHdhcm5pbmcgcmF0aGVyIHRoYW4gYmxvdyB0aGUgaG9vayB0aW1lb3V0IG9uIGEgNTAtY29weSBjaGFpbi5cbiAgICAgICAgd2FybihgQmFzaCB0b3VjaCBjYXAgKDMyKSByZWFjaGVkIGZvciBzaW1wbGUgY29tbWFuZCAke2lkeH07IGRyb3BwaW5nIHRoZSByZW1haW5pbmcgdG91Y2hlc2ApO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIHRvdWNoZXMgKz0gMTtcbiAgICAgIGNvbnN0IG91dHB1dCA9IGF3YWl0IHJ1blRvdWNoSG9vayhlLnRvdWNoLCBleGVjdXRvcnMsIG1lbW8sIHByb2JlQ2FjaGUpO1xuICAgICAgaWYgKG91dHB1dC5hZGRpdGlvbmFsQ29udGV4dCkgYmxvY2tzLnB1c2gob3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGJsb2Nrcztcbn1cbiIsICIvKipcbiAqIFN0YXRpYyBjbGFzc2lmaWNhdGlvbiBvZiBhIEJhc2ggdG9vbCBgY29tbWFuZGAgc3RyaW5nIGludG8gdGhlIGZpbGVcbiAqIHBhdGgocykgKyBsaW5lIHJhbmdlKHMpIGl0IHJlYWRzIG9yIHdyaXRlcywgd2hlcmUgdGhhdCdzIHN0YXRpY2FsbHlcbiAqIGRldGVybWluYWJsZS4gQnVpbHQgZnJvbSBhbiBlbXBpcmljYWwgcGFzcyBvdmVyIH4zMWsgcmVhbCBDbGF1ZGUgQ29kZVxuICogQmFzaCBpbnZvY2F0aW9ucyAoc2VlIGFuYWx5emUtdHJhbnNjcmlwdHMubXRzKSBcdTIwMTQgdGhlIGlkaW9tcyBiZWxvdyBhcmVcbiAqIGV4YWN0bHkgdGhlIG9uZXMgdGhhdCB0dXJuZWQgb3V0IHRvIGJlIGNvbW1vbiBBTkQgcmVsaWFibGUgdGhlcmUuXG4gKlxuICogRGVsaWJlcmF0ZWx5IE5PVCBjb3ZlcmVkIChzZWUgdGhlIHJlc2VhcmNoIHJlcG9ydCk6IGF3ayBOUi10cmlja3MgKHJhcmUsXG4gKiB1bmNvbnN0cmFpbmVkIHN5bnRheCksIGdyZXAgLW4vLUEvLUIvLUMgKHRoZSB3aW5kb3cgaXMgYW5jaG9yZWQgdG8gbWF0Y2hcbiAqIHBvc2l0aW9uLCB3aGljaCBpcyBkYXRhLWRlcGVuZGVudCwgbm90IGluIHRoZSBjb21tYW5kIHRleHQpLCBlbWJlZGRlZFxuICogcHl0aG9uMy9ub2RlIGhlcmVkb2Mgc2NyaXB0cyAoYSBkaWZmZXJlbnQgbGFuZ3VhZ2UncyBBU1QsIG5vdCBhIHNoZWxsXG4gKiBjb25jZXJuKSwgYW5kIGBmaW5kIDxkaXI+IC1uYW1lLy1wYXRoIC4uLiAtZGVsZXRlYCAodGhlIGRlbGV0ZWQgcGF0aHMgYXJlXG4gKiB0aGUgZGlyZWN0b3J5J3MgY29udGVudHMgYXMgdGhlIGZpbmRlciB3YWxrcyBpdCBcdTIwMTQgZGF0YS1kZXBlbmRlbnQsIG5vdFxuICogc3RhdGljYWxseSBlbnVtZXJhYmxlOyB0aGUgcmVjdXJzaXZlLXJlbW92YWwgZmFpbC1jbG9zZWQgcnVsZSBhcHBsaWVzKS5cbiAqXG4gKiBUaGUgY2FyZCdzIHdyaXRlLXRvdWNoIGZhbWlsaWVzIFx1MjAxNCByZWRpcmVjdGlvbnMgYW5kIGhlcmVkb2NzIChcdTAwQTc1LjFcdTIwMTNcdTAwQTc1LjIpLFxuICogY3AgYW5kIGluc3RhbGwgKFx1MDBBNzUuMyksIG12IGFuZCBnaXQgbXYgKFx1MDBBNzUuNCksIHJtIGFuZCB0cnVuY2F0ZSAoXHUwMEE3NS41KSxcbiAqIHNlZCAtaSAoXHUwMEE3NS42KSwgcGF0Y2ggYW5kIGdpdCBhcHBseSAoXHUwMEE3NS43KSwgZm9ybWF0dGVyIHdyaXRlIGZsYWdzIChcdTAwQTc1LjgpLFxuICogYW5kIGdpdCByZXN0b3JlL2NoZWNrb3V0IHBhdGhzcGVjcyAoXHUwMEE3NS45KSBcdTIwMTQgYXJlIHRoZSBncmFtbWFycyBiZWxvdy4gRWFjaFxuICogZmFtaWx5IGZhaWxzIGNsb3NlZCBvbiB3aGF0IGl0IGNhbm5vdCBzdGF0aWNhbGx5IGF0dHJpYnV0ZTpcbiAqIHNoZWxsLWV4cGFuZGVkIG9yIGR5bmFtaWMgY29udGVudCwgcmVjdXJzaXZlIHJlbW92YWwgKGBybSAtcmApLFxuICogaGVyZS1zdHJpbmdzIChgPDw8YCksIGRpcmVjdG9yeS1zaGFwZWQgdGFyZ2V0cywgd3JhcHBlci13cmFwcGVkIGNvbW1hbmRzXG4gKiB3aG9zZSBhcmd2IGNhbm5vdCBiZSByZWNvdmVyZWQsIGFuZCB1bm1hdGNoZWQgcGF0aHNwZWNzIGVtaXQgbm8gc3BhbiBhdFxuICogYWxsIG9yIGFuIGV4cGxpY2l0IHVucmVzb2x2ZWQgZW50cnkgXHUyMDE0IG5ldmVyIGEgZ3Vlc3NlZCB3cml0ZS5cbiAqL1xuaW1wb3J0IHsgcmVhZEZpbGVTeW5jLCBzdGF0U3luYyB9IGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0IHsgYmFzZW5hbWUsIGpvaW4gYXMgam9pblBhdGgsIHJlc29sdmUgYXMgcmVzb2x2ZVBhdGggfSBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHsgY291bnRGaWxlTGluZXMsIGNvdW50R2l0QmxvYkxpbmVzIH0gZnJvbSAnLi9jb21tYW5kLXJlc29sdmUuanMnO1xuaW1wb3J0IHsgdHlwZSBTaW1wbGVDb21tYW5kLCBzcGxpdFRvcExldmVsLCBzdHJpcExlYWRpbmdBc3NpZ25tZW50cywgdHlwZSBUb2tlbiwgdG9rZW5pemUgfSBmcm9tICcuL3NoZWxsLXNwbGl0LmpzJztcbmltcG9ydCB7IHR5cGUgUGF0aFN0cmlwLCBwYXJzZVVuaWZpZWREaWZmUmFuZ2UgfSBmcm9tICcuL3VuaWZpZWQtZGlmZi5qcyc7XG5cbi8qKlxuICogVGhlIGV4cGxpY2l0IG9wZXJhdGlvbiBraW5kIG9mIGEgcmVzb2x2ZWQgc3Bhbi4gVGhlIGFkYXB0ZXJzIHRyYW5zbGF0ZSBmcm9tXG4gKiB0aGlzLCBuZXZlciBmcm9tIGBpZGlvbSA9PT0gJ2hlcmVkb2Mtd3JpdGUnYC1zdHlsZSBjaGVja3MgKHBsYW4gXHUwMEE3MSkuXG4gKi9cbmV4cG9ydCB0eXBlIE9wZXJhdGlvbiA9XG4gIHwgJ3JlYWQnIC8vIHJlYWQgaWRpb21zOyBjcC9pbnN0YWxsIHNvdXJjZSBvcGVyYW5kc1xuICB8ICdjcmVhdGUtb3ZlcndyaXRlJyAvLyB0cnVuY2F0aW5nIGNvbnRlbnQgd3JpdGVzOiA+IHJlZGlyZWN0cywgdGVlLCBoZXJlZG9jID4sIGNwL212IGRlc3QsIHJlc3RvcmUvY2hlY2tvdXQsIHBhdGNoIGFkZFxuICB8ICdhcHBlbmQnIC8vID4+IHJlZGlyZWN0cywgdGVlIC1hLCBoZXJlZG9jID4+XG4gIHwgJ21vZGlmeScgLy8gaW4tcGxhY2UgZWRpdHMgd2l0aCB1bmtub3duIGNvbnRlbnQ6IHNlZCAtaSwgcGF0Y2ggaHVua3MsIGZvcm1hdHRlciB3cml0ZSBmbGFnc1xuICB8ICdyZW5hbWUtY29weScgLy8gbXYvZ2l0IG12L3BhdGNoLXJlbmFtZSBkZXN0aW5hdGlvbiAod2hvbGUtZmlsZSB3cml0ZSwgc2FtZSB0b3VjaCBhcyBjcmVhdGUtb3ZlcndyaXRlKVxuICB8ICd0cnVuY2F0ZScgLy8gOiA+IGYsIGJhcmUgPiBmLCB0cnVuY2F0ZVxuICB8ICdkZWxldGUnOyAvLyBybSwgbXYvZ2l0IG12IHNvdXJjZSwgcGF0Y2ggZGVsZXRlXG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVzb2x2ZWRTcGFuIHtcbiAgb3BlcmF0aW9uOiBPcGVyYXRpb247XG4gIGFic29sdXRlUGF0aDogc3RyaW5nO1xuICAvKipcbiAgICogRXhhY3QgcmFuZ2U6IGV2ZXJ5IHJlYWQ7IG1vZGlmeSBvcGVyYXRpb25zIHdpdGggYSBzdGF0aWNhbGx5IGtub3duIHJhbmdlXG4gICAqIChzZWQgLWkgbnVtZXJpYyBhZGRyZXNzZXMsIHBhdGNoIGh1bmsgdW5pb25zKS4gQWJzZW50IGZvciB3cml0ZXMgXHUyMTkyXG4gICAqIHdob2xlLWZpbGUgc2NvcGUuXG4gICAqL1xuICBsaW5lU3RhcnQ/OiBudW1iZXI7XG4gIGxpbmVFbmQ/OiBudW1iZXI7XG4gIC8qKlxuICAgKiBTdGF0aWNhbGx5IGtub3duIHdyaXR0ZW4gY29udGVudCBcdTIwMTQgYXBwZW5kIGJvZGllcyBhbmQgbGl0ZXJhbCBvdmVyd3JpdGVcbiAgICogYm9kaWVzIChoZXJlZG9jL2VjaG8vcHJpbnRmL3RlZSBsaXRlcmFscywgcGxhbiBcdTAwQTczIHN0ZXAgMWIpLiBPbiBhcHBlbmRzIGl0XG4gICAqIGlzIHRoZSBzdWZmaXggZ2F0ZSdzIGJvZHk7IG9uIGBjcmVhdGUtb3ZlcndyaXRlYCBpdCBpcyB0aGUgZXhhY3QgZ2F0ZSdzXG4gICAqIHBvc3QtY29udGVudCBcdTIwMTQgdGhlIHRvdWNoIGl0c2VsZiBzdGF5cyB3aG9sZS1maWxlIChgd3JpdHRlbjogJydgKSBlaXRoZXJcbiAgICogd2F5LlxuICAgKi9cbiAgd3JpdHRlbj86IHN0cmluZztcbiAgLyoqXG4gICAqIFRoZSBzdGF0aWNhbGx5IGV2YWx1YXRlZCBhYnNvbHV0ZSBgdHJ1bmNhdGUgLXMgTmAgc2l6ZSAocGxhbiBcdTAwQTc1LjUpOiB0aGVcbiAgICogXHUwMEE3MyBgc2l6ZWAgZ2F0ZSdzIHBvc3QtY29tbWFuZCBieXRlIGNvdW50IChgLXMgMGAgXHUyMTkyIHRoZSBlbXB0eSBnYXRlKS5cbiAgICogQWJzZW50IGZvciByZWxhdGl2ZSBzaXplcyAoYC1zICtOYC9gLXMgLU5gKSwgYC1yIHJlZmAsIGFuZCBldmVyeSBvdGhlclxuICAgKiBvcGVyYXRpb24gXHUyMDE0IHRob3NlIGdhdGUgZXhpc3RlbmNlLW9ubHkuXG4gICAqL1xuICBzaXplPzogbnVtYmVyO1xuICAvKipcbiAgICogT3JkaW5hbCBvZiB0aGUgc3BhbidzIHNpbXBsZSBjb21tYW5kIHdpdGhpbiB0aGUgY29tcG91bmQsIGluIHdhbGtlclxuICAgKiBvcmRlcjsgZ3JvdXBzIHRoZSBzcGFucyBvZiBvbmUgY29tbWFuZCBmb3Igam9pbiBnYXRpbmcgKHBsYW4gXHUwMEE3MyBzdGVwIDIpLlxuICAgKi9cbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXI7XG4gIC8qKlxuICAgKiBUaGUgb3BlcmF0b3IgcHJlY2VkaW5nIHRoZSBzcGFuJ3Mgc2ltcGxlIGNvbW1hbmQ7IG9ubHkgYCcmJidgL2AnfHwnYCBnYXRlLlxuICAgKiBBYnNlbnQgZm9yIGBzdGFydGAvYDtgL25ld2xpbmUvYCZgL2B8YCBib3VuZGFyaWVzLlxuICAgKi9cbiAgam9pbj86ICcmJicgfCAnfHwnO1xuICBub3RlPzogc3RyaW5nO1xufVxuXG5leHBvcnQgdHlwZSBJZGlvbSA9XG4gIHwgJ3NlZC1uLXJhbmdlJ1xuICB8ICdoZWFkLWZpbGUnXG4gIHwgJ3RhaWwtZmlsZSdcbiAgfCAnY2F0LWZpbGUnXG4gIHwgJ25sLWZpbGUnXG4gIHwgJ2dpdC1zaG93LXJldi1wYXRoJ1xuICB8ICdnaXQtbG9nLUwnXG4gIHwgJ2hlcmVkb2Mtd3JpdGUnXG4gIC8vIFRoZSB3cml0ZS10b3VjaCBmYW1pbGllcyAocGxhbiBcdTAwQTc1KS4gSWRpb20gc3RheXMgbWF0Y2ggbWV0YWRhdGEgZm9yIHRlc3RzXG4gIC8vIGFuZCB1bnJlc29sdmVkIHJlYXNvbnM7IGFkYXB0ZXIgYmVoYXZpb3Iga2V5cyBvbiBgb3BlcmF0aW9uYCwgbmV2ZXIgaWRpb20uXG4gIHwgJ3JlZGlyZWN0LXdyaXRlJyAvLyBcdTAwQTc1LjE6IGVjaG8vcHJpbnRmL3RlZSBjb250ZW50IHJlZGlyZWN0c1xuICB8ICd0cnVuY2F0ZS13cml0ZScgLy8gXHUwMEE3NS4xOiBiYXJlIGA+IGZgIC8gYDogPiBmYCB0cnVuY2F0aW9uc1xuICB8ICdjcC13cml0ZScgLy8gXHUwMEE3NS4zXG4gIHwgJ2luc3RhbGwtd3JpdGUnIC8vIFx1MDBBNzUuM1xuICB8ICdtdi13cml0ZScgLy8gXHUwMEE3NS40OiBtdiBhbmQgZ2l0IG12XG4gIHwgJ3JtLXdyaXRlJyAvLyBcdTAwQTc1LjU6IHJtIGFuZCBnaXQgcm1cbiAgfCAndHJ1bmNhdGUtY29tbWFuZCcgLy8gXHUwMEE3NS41OiB0aGUgdHJ1bmNhdGUgY29tbWFuZFxuICB8ICdzZWQtaW5wbGFjZScgLy8gXHUwMEE3NS42OiBzZWQgLWlcbiAgfCAncGF0Y2gtd3JpdGUnIC8vIFx1MDBBNzUuNzogcGF0Y2ggYW5kIGdpdCBhcHBseVxuICB8ICdmb3JtYXR0ZXItd3JpdGUnIC8vIFx1MDBBNzUuOFxuICB8ICdnaXQtcmVzdG9yZS13cml0ZScgLy8gXHUwMEE3NS45OiBnaXQgcmVzdG9yZSBwYXRoc3BlY3NcbiAgfCAnZ2l0LWNoZWNrb3V0LXdyaXRlJzsgLy8gXHUwMEE3NS45OiBnaXQgY2hlY2tvdXQgLS0gcGF0aHNwZWNzXG5cbmV4cG9ydCB0eXBlIFNwYW5NYXRjaCA9XG4gIHwgeyBzdGF0dXM6ICdyZXNvbHZlZCc7IGlkaW9tOiBJZGlvbTsgc3BhbjogUmVzb2x2ZWRTcGFuOyBub3RlPzogc3RyaW5nIH1cbiAgfCB7IHN0YXR1czogJ3VucmVzb2x2ZWQnOyBpZGlvbTogSWRpb207IGZpbGVBcmc6IHN0cmluZzsgcmVhc29uOiBzdHJpbmcgfVxuICB8IHtcbiAgICAgIC8qKlxuICAgICAgICogQSBzcGFuLWxlc3MgY29tbWFuZCB3aXRoIGEgZGV0ZXJtaW5pc3RpYyBleGl0IHN0YXR1cyBcdTIwMTQgYGZhbHNlYCAoMSksXG4gICAgICAgKiBgdHJ1ZWAgKDApLCBgOmAgKDApLiBObyBzcGFuIGFuZCBubyB0b3VjaCwgYnV0IHRoZSBqb2luIGRyaXZlciBuZWVkc1xuICAgICAgICogdGhlIHZlcmRpY3Q6IGBmYWxzZSAmJiBlY2hvIHggPiBmYCBza2lwcyB0aGUgZWNobywgYHRydWUgfHwgZWNobyB4ID5cbiAgICAgICAqIGZgIHNraXBzIGl0IHRvbywgYW5kIHdpdGhvdXQgdGhlIGd1YXJkIGJvdGggd291bGQgZmlyZSBhbiBleGFjdC1nYXRlXG4gICAgICAgKiB0b3VjaCBmb3IgYSB3cml0ZSB0aGF0IG5ldmVyIHJhbiAocGxhbiBcdTAwQTczIHN0ZXAgMidzIHNwYW4tbGVzcy1ndWFyZFxuICAgICAgICogcnVsZSkuIEZpbHRlcmVkIG91dCBvZiBgcGFyc2VDb21tYW5kYCdzIHNwYW4gbGlzdCB3aXRoIHRoZVxuICAgICAgICogdW5yZXNvbHZlZHMuXG4gICAgICAgKi9cbiAgICAgIHN0YXR1czogJ2J1aWx0aW4tZ3VhcmQnO1xuICAgICAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXI7XG4gICAgICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXTtcbiAgICAgIGV4aXRTdGF0dXM6IDAgfCAxO1xuICAgIH07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTGluZS1yYW5nZSBzcGVjczogd2hhdCBhIG1hdGNoZWQgaWRpb20gc2F5cyBhYm91dCB0aGUgcmFuZ2UsIGJlZm9yZSB3ZSBrbm93XG4vLyB3aGV0aGVyIHJlc29sdmluZyBpdCBuZWVkcyB0byBjb25zdWx0IGEgcmVhbCBmaWxlL2dpdCBibG9iLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnR5cGUgTGluZVJhbmdlU3BlYyA9XG4gIHwgeyBraW5kOiAnbGl0ZXJhbCc7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6ICd1cHBlckJvdW5kRnJvbVN0YXJ0JzsgZW5kOiBudW1iZXIgfVxuICB8IHsga2luZDogJ3RvRW9mJzsgc3RhcnQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAnbGFzdE5MaW5lcyc7IGNvdW50OiBudW1iZXIgfVxuICB8IHsga2luZDogJ2FwcGVuZExpbmVzJzsgY291bnQ6IG51bWJlciB9O1xuXG5mdW5jdGlvbiByZXNvbHZlU3BlYyhcbiAgc3BlYzogTGluZVJhbmdlU3BlYyxcbiAgdG90YWxMaW5lczogKCkgPT4gbnVtYmVyIHwgbnVsbFxuKTogeyBsaW5lU3RhcnQ6IG51bWJlcjsgbGluZUVuZDogbnVtYmVyIH0gfCBudWxsIHtcbiAgc3dpdGNoIChzcGVjLmtpbmQpIHtcbiAgICBjYXNlICdsaXRlcmFsJzpcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogc3BlYy5zdGFydCwgbGluZUVuZDogc3BlYy5lbmQgfTtcbiAgICBjYXNlICd1cHBlckJvdW5kRnJvbVN0YXJ0Jzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCk7XG4gICAgICByZXR1cm4geyBsaW5lU3RhcnQ6IDEsIGxpbmVFbmQ6IHRvdGFsICE9PSBudWxsID8gTWF0aC5taW4oc3BlYy5lbmQsIHRvdGFsKSA6IHNwZWMuZW5kIH07XG4gICAgfVxuICAgIGNhc2UgJ3RvRW9mJzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCk7XG4gICAgICBpZiAodG90YWwgPT09IG51bGwgfHwgdG90YWwgPT09IDApIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiBzcGVjLnN0YXJ0LCBsaW5lRW5kOiBNYXRoLm1heChzcGVjLnN0YXJ0LCB0b3RhbCkgfTtcbiAgICB9XG4gICAgY2FzZSAnbGFzdE5MaW5lcyc6IHtcbiAgICAgIGNvbnN0IHRvdGFsID0gdG90YWxMaW5lcygpO1xuICAgICAgaWYgKHRvdGFsID09PSBudWxsIHx8IHRvdGFsID09PSAwKSByZXR1cm4gbnVsbDtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogTWF0aC5tYXgoMSwgdG90YWwgLSBzcGVjLmNvdW50ICsgMSksIGxpbmVFbmQ6IHRvdGFsIH07XG4gICAgfVxuICAgIGNhc2UgJ2FwcGVuZExpbmVzJzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCkgPz8gMDtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogdG90YWwgKyAxLCBsaW5lRW5kOiB0b3RhbCArIHNwZWMuY291bnQgfTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gaGFzU2hlbGxFeHBhbnNpb24oczogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiAvWyRgXS8udGVzdChzKTtcbn1cblxuZnVuY3Rpb24gbG9va3NVbnJlc29sdmFibGUoczogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBoYXNTaGVsbEV4cGFuc2lvbihzKSB8fCAvWyo/XS8udGVzdChzKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBJZGlvbSBtYXRjaGVyczogcHVyZSBmdW5jdGlvbnMgb3ZlciBvbmUgc2ltcGxlIGNvbW1hbmQncyBhcmd2LlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmludGVyZmFjZSBSYXdDYW5kaWRhdGUge1xuICBraW5kOiAnY2FuZGlkYXRlJztcbiAgaWRpb206IElkaW9tO1xuICBmaWxlQXJnOiBzdHJpbmc7XG4gIHNwZWM6IExpbmVSYW5nZVNwZWM7XG4gIHJlc29sdmVyS2luZDogJ2ZzJyB8IHsga2luZDogJ2dpdCc7IHJldjogc3RyaW5nIH07XG4gIGRpck92ZXJyaWRlPzogc3RyaW5nO1xufVxuaW50ZXJmYWNlIFJhd1VucmVzb2x2ZWQge1xuICBraW5kOiAndW5yZXNvbHZlZCc7XG4gIGlkaW9tOiBJZGlvbTtcbiAgZmlsZUFyZzogc3RyaW5nO1xuICByZWFzb246IHN0cmluZztcbn1cbnR5cGUgTWF0Y2hSZXN1bHQgPSBSYXdDYW5kaWRhdGUgfCBSYXdVbnJlc29sdmVkO1xuXG5jb25zdCBTRURfUkFOR0UgPSAvXihcXGQrKSg/OiwoXFxkK3xcXCQpKT9wJC87XG5cbi8qKiBTcGxpdCBhIGBzZWRgIHNjcmlwdCBhcmd1bWVudCBpbnRvIGl0cyBgO2Atc2VwYXJhdGVkIHNlZ21lbnRzLiAqL1xuZnVuY3Rpb24gc2VkU2NyaXB0U2VnbWVudHMoc2NyaXB0OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiBzY3JpcHQuc3BsaXQoJzsnKTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hTZWQoYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdzZWQnKSByZXR1cm4gW107XG4gIGNvbnN0IHJlc3QgPSBhcmd2LnNsaWNlKDEpO1xuICBpZiAoIXJlc3QuaW5jbHVkZXMoJy1uJykpIHJldHVybiBbXTtcbiAgbGV0IHNjcmlwdElkeCA9IC0xO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHJlc3QubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAocmVzdFtpXSA9PT0gJy1uJykgY29udGludWU7XG4gICAgaWYgKHNlZFNjcmlwdFNlZ21lbnRzKHJlc3RbaV0pLnNvbWUoKHNlZykgPT4gU0VEX1JBTkdFLnRlc3Qoc2VnKSkpIHtcbiAgICAgIHNjcmlwdElkeCA9IGk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgaWYgKHNjcmlwdElkeCA9PT0gLTEpIHJldHVybiBbXTtcbiAgY29uc3QgZmlsZUNhbmRpZGF0ZXMgPSByZXN0LmZpbHRlcigoYSwgaSkgPT4gaSAhPT0gc2NyaXB0SWR4ICYmIGEgIT09ICctbicgJiYgIWEuc3RhcnRzV2l0aCgnLScpKTtcbiAgaWYgKGZpbGVDYW5kaWRhdGVzLmxlbmd0aCAhPT0gMSkgcmV0dXJuIFtdO1xuICBjb25zdCBmaWxlQXJnID0gZmlsZUNhbmRpZGF0ZXNbMF07XG4gIGNvbnN0IHJlc3VsdHM6IE1hdGNoUmVzdWx0W10gPSBbXTtcbiAgZm9yIChjb25zdCBzZWdtZW50IG9mIHNlZFNjcmlwdFNlZ21lbnRzKHJlc3Rbc2NyaXB0SWR4XSkpIHtcbiAgICBjb25zdCBtYXRjaCA9IHNlZ21lbnQubWF0Y2goU0VEX1JBTkdFKTtcbiAgICBpZiAoIW1hdGNoKSBjb250aW51ZTtcbiAgICBjb25zdCBzdGFydCA9IE51bWJlci5wYXJzZUludChtYXRjaFsxXSwgMTApO1xuICAgIGNvbnN0IGVuZFRva2VuID0gbWF0Y2hbMl07XG4gICAgY29uc3Qgc3BlYzogTGluZVJhbmdlU3BlYyA9XG4gICAgICBlbmRUb2tlbiA9PT0gdW5kZWZpbmVkXG4gICAgICAgID8geyBraW5kOiAnbGl0ZXJhbCcsIHN0YXJ0LCBlbmQ6IHN0YXJ0IH1cbiAgICAgICAgOiBlbmRUb2tlbiA9PT0gJyQnXG4gICAgICAgICAgPyB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0IH1cbiAgICAgICAgICA6IHsga2luZDogJ2xpdGVyYWwnLCBzdGFydCwgZW5kOiBOdW1iZXIucGFyc2VJbnQoZW5kVG9rZW4sIDEwKSB9O1xuICAgIHJlc3VsdHMucHVzaCh7IGtpbmQ6ICdjYW5kaWRhdGUnLCBpZGlvbTogJ3NlZC1uLXJhbmdlJywgZmlsZUFyZywgc3BlYywgcmVzb2x2ZXJLaW5kOiAnZnMnIH0pO1xuICB9XG4gIHJldHVybiByZXN1bHRzO1xufVxuXG5mdW5jdGlvbiBwYXJzZUhlYWRUYWlsRmxhZ3MocmVzdDogc3RyaW5nW10pOiB7XG4gIGNvdW50OiBudW1iZXIgfCBudWxsO1xuICBmcm9tU3RhcnQ6IGJvb2xlYW47XG4gIGRpc3F1YWxpZmllZDogYm9vbGVhbjtcbiAgZmlsZXM6IHN0cmluZ1tdO1xufSB7XG4gIGNvbnN0IGZpbGVzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgY291bnQ6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICBsZXQgZnJvbVN0YXJ0ID0gZmFsc2U7XG4gIGxldCBkaXNxdWFsaWZpZWQgPSBmYWxzZTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCByZXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IHJlc3RbaV07XG4gICAgaWYgKGEgPT09ICctZicgfHwgYSA9PT0gJy1GJyB8fCBhID09PSAnLS1mb2xsb3cnIHx8IGEuc3RhcnRzV2l0aCgnLS1mb2xsb3c9JykpIHtcbiAgICAgIGRpc3F1YWxpZmllZCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICcteicgfHwgYSA9PT0gJy0temVyby10ZXJtaW5hdGVkJykge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1jJyB8fCBhID09PSAnLS1ieXRlcycpIHtcbiAgICAgIGRpc3F1YWxpZmllZCA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eKC1jfC0tYnl0ZXM9KS8udGVzdChhKSkge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1xJyB8fCBhID09PSAnLXYnIHx8IGEgPT09ICctLXF1aWV0JyB8fCBhID09PSAnLS1zaWxlbnQnIHx8IGEgPT09ICctLXZlcmJvc2UnKSBjb250aW51ZTtcbiAgICBpZiAoYSA9PT0gJy1uJykge1xuICAgICAgY29uc3QgdiA9IHJlc3RbaSArIDFdO1xuICAgICAgaWYgKHYgIT09IHVuZGVmaW5lZCAmJiAvXlxcKz9cXGQrJC8udGVzdCh2KSkge1xuICAgICAgICBmcm9tU3RhcnQgPSB2LnN0YXJ0c1dpdGgoJysnKTtcbiAgICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQodi5yZXBsYWNlKCcrJywgJycpLCAxMCk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctLWxpbmVzPScpKSB7XG4gICAgICBjb25zdCB2ID0gYS5zbGljZSgnLS1saW5lcz0nLmxlbmd0aCk7XG4gICAgICBpZiAoL15cXCs/XFxkKyQvLnRlc3QodikpIHtcbiAgICAgICAgZnJvbVN0YXJ0ID0gdi5zdGFydHNXaXRoKCcrJyk7XG4gICAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KHYucmVwbGFjZSgnKycsICcnKSwgMTApO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgvXi1uXFwrP1xcZCskLy50ZXN0KGEpKSB7XG4gICAgICBjb25zdCB2ID0gYS5zbGljZSgyKTtcbiAgICAgIGZyb21TdGFydCA9IHYuc3RhcnRzV2l0aCgnKycpO1xuICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQodi5yZXBsYWNlKCcrJywgJycpLCAxMCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eXFwrXFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgIGZyb21TdGFydCA9IHRydWU7XG4gICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludChhLnNsaWNlKDEpLCAxMCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eLVxcZCskLy50ZXN0KGEpKSB7XG4gICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludChhLnNsaWNlKDEpLCAxMCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctJykge1xuICAgICAgZmlsZXMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlO1xuICAgIGZpbGVzLnB1c2goYSk7XG4gIH1cbiAgcmV0dXJuIHsgY291bnQsIGZyb21TdGFydCwgZGlzcXVhbGlmaWVkLCBmaWxlcyB9O1xufVxuXG5mdW5jdGlvbiBtYXRjaEhlYWQoYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdoZWFkJykgcmV0dXJuIFtdO1xuICBjb25zdCB7IGNvdW50LCBkaXNxdWFsaWZpZWQsIGZpbGVzIH0gPSBwYXJzZUhlYWRUYWlsRmxhZ3MoYXJndi5zbGljZSgxKSk7XG4gIGlmIChkaXNxdWFsaWZpZWQpIHJldHVybiBbXTtcbiAgY29uc3QgcmVhbEZpbGVzID0gZmlsZXMuZmlsdGVyKChmKSA9PiBmICE9PSAnLScpO1xuICBpZiAocmVhbEZpbGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICBjb25zdCBuID0gY291bnQgPz8gMTA7XG4gIHJldHVybiByZWFsRmlsZXMubWFwKChmaWxlQXJnKSA9PiAoe1xuICAgIGtpbmQ6ICdjYW5kaWRhdGUnIGFzIGNvbnN0LFxuICAgIGlkaW9tOiAnaGVhZC1maWxlJyBhcyBjb25zdCxcbiAgICBmaWxlQXJnLFxuICAgIHNwZWM6IHsga2luZDogJ3VwcGVyQm91bmRGcm9tU3RhcnQnLCBlbmQ6IG4gfSBhcyBMaW5lUmFuZ2VTcGVjLFxuICAgIHJlc29sdmVyS2luZDogJ2ZzJyBhcyBjb25zdFxuICB9KSk7XG59XG5cbmZ1bmN0aW9uIG1hdGNoVGFpbChhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ3RhaWwnKSByZXR1cm4gW107XG4gIGNvbnN0IHsgY291bnQsIGZyb21TdGFydCwgZGlzcXVhbGlmaWVkLCBmaWxlcyB9ID0gcGFyc2VIZWFkVGFpbEZsYWdzKGFyZ3Yuc2xpY2UoMSkpO1xuICBpZiAoZGlzcXVhbGlmaWVkKSByZXR1cm4gW107XG4gIGNvbnN0IHJlYWxGaWxlcyA9IGZpbGVzLmZpbHRlcigoZikgPT4gZiAhPT0gJy0nKTtcbiAgaWYgKHJlYWxGaWxlcy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgY29uc3QgbiA9IGNvdW50ID8/IDEwO1xuICBjb25zdCBzcGVjOiBMaW5lUmFuZ2VTcGVjID0gZnJvbVN0YXJ0ID8geyBraW5kOiAndG9Fb2YnLCBzdGFydDogbiB9IDogeyBraW5kOiAnbGFzdE5MaW5lcycsIGNvdW50OiBuIH07XG4gIHJldHVybiByZWFsRmlsZXMubWFwKChmaWxlQXJnKSA9PiAoe1xuICAgIGtpbmQ6ICdjYW5kaWRhdGUnIGFzIGNvbnN0LFxuICAgIGlkaW9tOiAndGFpbC1maWxlJyBhcyBjb25zdCxcbiAgICBmaWxlQXJnLFxuICAgIHNwZWMsXG4gICAgcmVzb2x2ZXJLaW5kOiAnZnMnIGFzIGNvbnN0XG4gIH0pKTtcbn1cblxuZnVuY3Rpb24gZmluZEdpdFN1YmNvbW1hbmQoXG4gIHJlc3Q6IHN0cmluZ1tdXG4pOiB7IHN1YklkeDogbnVtYmVyOyBzdWJjb21tYW5kOiBzdHJpbmc7IGNEaXI6IHN0cmluZyB8IG51bGw7IGNEaXJVbnJlc29sdmFibGU6IGJvb2xlYW4gfSB8IG51bGwge1xuICBsZXQgY0Rpcjogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCBjRGlyVW5yZXNvbHZhYmxlID0gZmFsc2U7XG4gIGxldCBpID0gMDtcbiAgd2hpbGUgKGkgPCByZXN0Lmxlbmd0aCkge1xuICAgIGNvbnN0IGEgPSByZXN0W2ldO1xuICAgIGlmIChhID09PSAnLUMnKSB7XG4gICAgICBjb25zdCB2ID0gcmVzdFtpICsgMV07XG4gICAgICBpZiAodiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgICAgIGlmIChoYXNTaGVsbEV4cGFuc2lvbih2KSkgY0RpclVucmVzb2x2YWJsZSA9IHRydWU7XG4gICAgICBlbHNlIGNEaXIgPSB2O1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWMnKSB7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgcmV0dXJuIHsgc3ViSWR4OiBpLCBzdWJjb21tYW5kOiBhLCBjRGlyLCBjRGlyVW5yZXNvbHZhYmxlIH07XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbmNvbnN0IFJFVl9QQVRIID0gL14oW15cXHM6XSspOiguKykkLztcblxuZnVuY3Rpb24gbWF0Y2hHaXRTaG93KGFyZ3Y6IHN0cmluZ1tdKTogTWF0Y2hSZXN1bHRbXSB7XG4gIGlmIChhcmd2WzBdICE9PSAnZ2l0JykgcmV0dXJuIFtdO1xuICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChhcmd2LnNsaWNlKDEpKTtcbiAgaWYgKCFzdWIgfHwgc3ViLnN1YmNvbW1hbmQgIT09ICdzaG93JykgcmV0dXJuIFtdO1xuICBjb25zdCBhZnRlciA9IGFyZ3ZcbiAgICAuc2xpY2UoMSlcbiAgICAuc2xpY2Uoc3ViLnN1YklkeCArIDEpXG4gICAgLmZpbHRlcigoYSkgPT4gIWEuc3RhcnRzV2l0aCgnLScpKTtcbiAgY29uc3QgcmV2UGF0aEFyZyA9IGFmdGVyLmZpbmQoKGEpID0+IFJFVl9QQVRILnRlc3QoYSkpO1xuICBpZiAoIXJldlBhdGhBcmcpIHJldHVybiBbXTtcbiAgY29uc3QgbSA9IHJldlBhdGhBcmcubWF0Y2goUkVWX1BBVEgpO1xuICBpZiAoIW0pIHJldHVybiBbXTtcbiAgY29uc3QgWywgcmV2LCBwYXRoXSA9IG07XG4gIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSB8fCBoYXNTaGVsbEV4cGFuc2lvbihyZXYpKSB7XG4gICAgcmV0dXJuIFtcbiAgICAgIHtcbiAgICAgICAga2luZDogJ3VucmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogJ2dpdC1zaG93LXJldi1wYXRoJyxcbiAgICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgICAgcmVhc29uOiAnZ2l0IC1DIHRhcmdldCBvciByZXZpc2lvbiBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJ1xuICAgICAgfVxuICAgIF07XG4gIH1cbiAgcmV0dXJuIFtcbiAgICB7XG4gICAgICBraW5kOiAnY2FuZGlkYXRlJyxcbiAgICAgIGlkaW9tOiAnZ2l0LXNob3ctcmV2LXBhdGgnLFxuICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgIHNwZWM6IHsga2luZDogJ3RvRW9mJywgc3RhcnQ6IDEgfSxcbiAgICAgIHJlc29sdmVyS2luZDogeyBraW5kOiAnZ2l0JywgcmV2IH0sXG4gICAgICBkaXJPdmVycmlkZTogc3ViLmNEaXIgPz8gdW5kZWZpbmVkXG4gICAgfVxuICBdO1xufVxuXG5mdW5jdGlvbiBtYXRjaEdpdExvZ0woYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdnaXQnKSByZXR1cm4gW107XG4gIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKGFyZ3Yuc2xpY2UoMSkpO1xuICBpZiAoIXN1YiB8fCBzdWIuc3ViY29tbWFuZCAhPT0gJ2xvZycpIHJldHVybiBbXTtcbiAgY29uc3QgYWZ0ZXIgPSBhcmd2LnNsaWNlKDEpLnNsaWNlKHN1Yi5zdWJJZHggKyAxKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBhZnRlci5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhZnRlcltpXTtcbiAgICBsZXQgc3BlYzogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgaWYgKGEgPT09ICctTCcpIHNwZWMgPSBhZnRlcltpICsgMV0gPz8gbnVsbDtcbiAgICBlbHNlIGlmIChhLnN0YXJ0c1dpdGgoJy1MJykpIHNwZWMgPSBhLnNsaWNlKDIpO1xuICAgIGlmICghc3BlYykgY29udGludWU7XG4gICAgY29uc3QgbSA9IHNwZWMubWF0Y2goL14oXFxkKyksKFxcZCspOiguKykkLyk7XG4gICAgaWYgKCFtKSBjb250aW51ZTtcbiAgICBjb25zdCBbLCBzLCBlLCBwYXRoXSA9IG07XG4gICAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlKSB7XG4gICAgICByZXR1cm4gW1xuICAgICAgICB7XG4gICAgICAgICAga2luZDogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnZ2l0LWxvZy1MJyxcbiAgICAgICAgICBmaWxlQXJnOiBwYXRoLFxuICAgICAgICAgIHJlYXNvbjogJ2dpdCAtQyB0YXJnZXQgY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZSdcbiAgICAgICAgfVxuICAgICAgXTtcbiAgICB9XG4gICAgcmV0dXJuIFtcbiAgICAgIHtcbiAgICAgICAga2luZDogJ2NhbmRpZGF0ZScsXG4gICAgICAgIGlkaW9tOiAnZ2l0LWxvZy1MJyxcbiAgICAgICAgZmlsZUFyZzogcGF0aCxcbiAgICAgICAgc3BlYzogeyBraW5kOiAnbGl0ZXJhbCcsIHN0YXJ0OiBOdW1iZXIucGFyc2VJbnQocywgMTApLCBlbmQ6IE51bWJlci5wYXJzZUludChlLCAxMCkgfSxcbiAgICAgICAgcmVzb2x2ZXJLaW5kOiAnZnMnLFxuICAgICAgICBkaXJPdmVycmlkZTogc3ViLmNEaXIgPz8gdW5kZWZpbmVkXG4gICAgICB9XG4gICAgXTtcbiAgfVxuICByZXR1cm4gW107XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSGVyZWRvYyB3cml0ZXMgKHBsYW4gXHUwMEE3NS4yKTogaGFuZGxlZCBhcyBhIGRlZGljYXRlZCByYXctdGV4dCBwYXNzIGJlY2F1c2UgdGhlXG4vLyBib2R5IGNhbiBpdHNlbGYgY29udGFpbiAmJi87L3wvbmV3bGluZXMgdGhhdCB3b3VsZCBvdGhlcndpc2UgY29uZnVzZVxuLy8gc3BsaXRUb3BMZXZlbC4gVGhlIG9wZW5lciBzY2FubmVyIGlzIHF1b3RlLWF3YXJlIGFuZCB2YWxpZGF0ZXMgdGhlIGNsb3Npbmdcbi8vIGRlbGltaXRlcjsgbWF0Y2hlZCBoZXJlZG9jcyBhcmUgbWFza2VkIG91dCBvZiB0aGUgc3RyaW5nIChyZXBsYWNlZCB3aXRoIGFuXG4vLyBpbmRleGVkIHBsYWNlaG9sZGVyIHNpbXBsZS1jb21tYW5kKSBiZWZvcmUgdGhlIHJlc3Qgb2YgdGhlIHBpcGVsaW5lIHJ1bnMsXG4vLyBhbmQgcmUtYXNzb2NpYXRlZCBieSBpbmRleCBkdXJpbmcgdGhlIG1haW4gd2FsayBzbyB0aGUgd3JpdGUgaXMgcmVzb2x2ZWRcbi8vIGFnYWluc3QgdGhlIGNvcnJlY3QgYGNkYC10cmFja2VkIGRpcmVjdG9yeS5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogVGhlIGhlcmVkb2MncyBjb250ZW50LWNhcnJ5aW5nIGZhY3RzLCByZS1hc3NvY2lhdGVkIGJ5IGluZGV4IGR1cmluZyB0aGUgd2Fsay4gKi9cbmludGVyZmFjZSBIZXJlZG9jV3JpdGUge1xuICAvKiogVGhlIG9wZW5lciBsaW5lIHZlcmJhdGltIChlLmcuIGBjYXQgPiBmIDw8J0VPRidgKSwgcmUtdG9rZW5pemVkIGR1cmluZyB0aGUgd2Fsay4gKi9cbiAgb3BlbmVyOiBzdHJpbmc7XG4gIC8qKiBUaGUgaGVyZWRvYyBib2R5OyBgPDwtYCBib2RpZXMgaGF2ZSBsZWFkaW5nIHRhYnMgc3RyaXBwZWQgcGVyIGxpbmUuICovXG4gIGJvZHk6IHN0cmluZztcbiAgLyoqIFdoZXRoZXIgdGhlIGRlbGltaXRlciB3YXMgcXVvdGVkL2VzY2FwZWQgKGA8PCdFT0YnYCwgYDw8XCJFT0ZcImAsIGA8PFxcRU9GYCk6IHRoZSBib2R5IHRoZW4gdW5kZXJnb2VzIG5vIHNoZWxsIGV4cGFuc2lvbi4gKi9cbiAgcXVvdGVkRGVsaW06IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBIZXJlZG9jT3BlbmVyIHtcbiAgLyoqIFdoZXJlIHRoZSBoZXJlZG9jJ3Mgc2ltcGxlIGNvbW1hbmQgc3RhcnRzIGluIHRoZSByYXcgc3RyaW5nLiAqL1xuICBjbWRTdGFydDogbnVtYmVyO1xuICAvKiogVGhlIG5ld2xpbmUgZW5kaW5nIHRoZSBvcGVuZXIgbGluZSwgb3IgcmF3Lmxlbmd0aCB3aGVuIGl0J3MgdGhlIGxhc3QgbGluZS4gKi9cbiAgb3BlbmVyTGluZUVuZDogbnVtYmVyO1xuICAvKiogVGhlIGNsb3NpbmcgZGVsaW1pdGVyIChxdW90ZXMgc3RyaXBwZWQpLiAqL1xuICBkZWxpbTogc3RyaW5nO1xuICAvKiogYDw8LWA6IHN0cmlwIGxlYWRpbmcgdGFicyBmcm9tIHRoZSBib2R5IGFuZCB0aGUgY2xvc2VyIGxpbmUuICovXG4gIHRhYlN0cmlwOiBib29sZWFuO1xuICAvKiogV2hldGhlciB0aGUgZGVsaW1pdGVyIHdhcyBxdW90ZWQvZXNjYXBlZCBcdTIwMTQgdGhlIHNoZWxsIHNraXBzIGJvZHkgZXhwYW5zaW9uIHRoZW4uICovXG4gIHF1b3RlZERlbGltOiBib29sZWFuO1xufVxuXG5jb25zdCBCQVJFX0RFTElNID0gL15bQS1aYS16X11bQS1aYS16MC05X10qJC87XG5cbi8qKlxuICogRmluZCB0aGUgbmV4dCBoZXJlZG9jIG9wZW5lciAoYDw8YC9gPDwtYCkgYXQgdG9wIGxldmVsLCBzY2FubmluZyBmcm9tXG4gKiBgZnJvbWAuIE1pcnJvcnMgc3BsaXRUb3BMZXZlbCdzIHNlcGFyYXRvciBoYW5kbGluZyBzbyBgY21kU3RhcnRgIG1hcmtzIHRoZVxuICogb3BlbmVyJ3Mgb3duIHNpbXBsZSBjb21tYW5kOiB0b3AtbGV2ZWwgYCYmYC9gfHxgL2A7YC9uZXdsaW5lL2AmYCBzdGFydCBhIG5ld1xuICogY29tbWFuZCAoYSBuZXdsaW5lIGFmdGVyIGEgcGlwZSBpcyBhIGxpbmUgY29udGludWF0aW9uKSwgYD5gLXJlZGlyZWN0cywgZHVwXG4gKiByZWRpcmVjdHMgKGAyPiYxYCkgYW5kIHBhcmVuIG5lc3Rpbmcgc3RheSBpbnNpZGUgdGhlIGNvbW1hbmQsIGFuZFxuICogaGVyZS1zdHJpbmdzIChgPDw8YCkgYXJlIG91dCBvZiBzY29wZS4gQW4gSU9fTlVNQkVSIGZkIGRpcmVjdGx5IGJlZm9yZSB0aGVcbiAqIG9wZXJhdG9yIChgMjw8RU9GYCkgcmVkaXJlY3RzIHRoYXQgZmQsIG5vdCBzdGRpbiBcdTIwMTQgbm90IGEgaGVyZWRvYy4gUmV0dXJuc1xuICogbnVsbCB3aGVuIG5vIG9wZW5lciBpcyBmb3VuZC5cbiAqL1xuZnVuY3Rpb24gZmluZEhlcmVkb2NPcGVuZXIocmF3OiBzdHJpbmcsIGZyb206IG51bWJlcik6IEhlcmVkb2NPcGVuZXIgfCBudWxsIHtcbiAgY29uc3QgbiA9IHJhdy5sZW5ndGg7XG4gIGxldCBpblNxdW90ZSA9IGZhbHNlO1xuICBsZXQgaW5EcXVvdGUgPSBmYWxzZTtcbiAgbGV0IGRlcHRoID0gMDtcbiAgbGV0IGNtZFN0YXJ0ID0gZnJvbTtcbiAgbGV0IHBlbmRpbmdQaXBlID0gZmFsc2U7XG4gIGxldCBpID0gZnJvbTtcblxuICAvKiogUmVhZCBvbmUgZGVsaW1pdGVyIHdvcmQgc3RhcnRpbmcgYXQgYHN0YXJ0YCAodGhlIGF0dGFjaGVkIHRhaWwgb2YgYDw8RU9GYC9gPDwnRU9GJ2AsIG9yIGEgc3RhbmRhbG9uZSBuZXh0IHdvcmQpLiBRdW90ZXMgY29udHJpYnV0ZSB0aGVpciBjb250ZW50OyBhIGJhY2tzbGFzaCBlc2NhcGVzIHRoZSBuZXh0IGNoYXIuIFJldHVybnMgbnVsbCBvbiBhbiB1bmJhbGFuY2VkIHF1b3RlIChmYWlsIGNsb3NlZCkuICovXG4gIGNvbnN0IHJlYWREZWxpbVdvcmQgPSAoc3RhcnQ6IG51bWJlcik6IHsgZGVsaW06IHN0cmluZzsgc2F3UXVvdGU6IGJvb2xlYW47IG5leHQ6IG51bWJlciB9IHwgbnVsbCA9PiB7XG4gICAgbGV0IGQgPSAnJztcbiAgICBsZXQgc2F3UXVvdGUgPSBmYWxzZTtcbiAgICBsZXQgayA9IHN0YXJ0O1xuICAgIHdoaWxlIChrIDwgbiAmJiAhL1xccy8udGVzdChyYXdba10pICYmIHJhd1trXSAhPT0gJzwnICYmIHJhd1trXSAhPT0gJz4nKSB7XG4gICAgICBjb25zdCBjID0gcmF3W2tdO1xuICAgICAgaWYgKGMgPT09IFwiJ1wiIHx8IGMgPT09ICdcIicpIHtcbiAgICAgICAgY29uc3QgcXVvdGUgPSBjO1xuICAgICAgICBsZXQgbSA9IGsgKyAxO1xuICAgICAgICB3aGlsZSAobSA8IG4gJiYgcmF3W21dICE9PSBxdW90ZSkge1xuICAgICAgICAgIGQgKz0gcmF3W21dO1xuICAgICAgICAgIG0gKz0gMTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobSA+PSBuKSByZXR1cm4gbnVsbDtcbiAgICAgICAgc2F3UXVvdGUgPSB0cnVlO1xuICAgICAgICBrID0gbSArIDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcXFxcJyAmJiBrICsgMSA8IG4pIHtcbiAgICAgICAgLy8gQSBiYWNrc2xhc2gtZXNjYXBlZCBkZWxpbWl0ZXIgY2hhciBxdW90ZXMgdGhlIGRlbGltaXRlciBcdTIwMTQgdGhlIGJvZHlcbiAgICAgICAgLy8gaXMgbGl0ZXJhbCAoYDw8XFxFT0ZgKSwgc2FtZSBhcyBxdW90ZXMuXG4gICAgICAgIGQgKz0gcmF3W2sgKyAxXTtcbiAgICAgICAgc2F3UXVvdGUgPSB0cnVlO1xuICAgICAgICBrICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgZCArPSBjO1xuICAgICAgayArPSAxO1xuICAgIH1cbiAgICByZXR1cm4geyBkZWxpbTogZCwgc2F3UXVvdGUsIG5leHQ6IGsgfTtcbiAgfTtcblxuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBjb25zdCBjID0gcmF3W2ldO1xuICAgIGlmIChpblNxdW90ZSkge1xuICAgICAgaWYgKGMgPT09IFwiJ1wiKSBpblNxdW90ZSA9IGZhbHNlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpbkRxdW90ZSkge1xuICAgICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIHtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXCInKSBpbkRxdW90ZSA9IGZhbHNlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSBcIidcIikge1xuICAgICAgaW5TcXVvdGUgPSB0cnVlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXCInKSB7XG4gICAgICBpbkRxdW90ZSA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIHtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJygnKSB7XG4gICAgICBkZXB0aCArPSAxO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnKScpIHtcbiAgICAgIGRlcHRoID0gTWF0aC5tYXgoMCwgZGVwdGggLSAxKTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoZGVwdGggPiAwKSB7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKHJhdy5zdGFydHNXaXRoKCcmJicsIGkpIHx8IHJhdy5zdGFydHNXaXRoKCd8fCcsIGkpKSB7XG4gICAgICBjbWRTdGFydCA9IGkgKyAyO1xuICAgICAgcGVuZGluZ1BpcGUgPSBmYWxzZTtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAocmF3LnN0YXJ0c1dpdGgoJ3wmJywgaSkpIHtcbiAgICAgIGNtZFN0YXJ0ID0gaSArIDE7XG4gICAgICBwZW5kaW5nUGlwZSA9IHRydWU7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICc7Jykge1xuICAgICAgY21kU3RhcnQgPSBpICsgMTtcbiAgICAgIHBlbmRpbmdQaXBlID0gZmFsc2U7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICd8Jykge1xuICAgICAgY21kU3RhcnQgPSBpICsgMTtcbiAgICAgIHBlbmRpbmdQaXBlID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1xcbicpIHtcbiAgICAgIC8vIEEgbmV3bGluZSBhZnRlciBhIHBpcGUgaXMgYSBsaW5lIGNvbnRpbnVhdGlvbiAobWlycm9yaW5nXG4gICAgICAvLyBzcGxpdFRvcExldmVsKTsgYW55dGhpbmcgZWxzZSBzdGFydHMgYSBuZXcgc2ltcGxlIGNvbW1hbmQuXG4gICAgICBpZiAoIXBlbmRpbmdQaXBlKSBjbWRTdGFydCA9IGkgKyAxO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnJicpIHtcbiAgICAgIC8vIGAmPmAvYCY+PmAgYW5kIGR1cCByZWRpcmVjdHMgKGAyPiYxYCkgYXJlIHJlZGlyZWN0IG9wZXJhdG9ycywgbm90XG4gICAgICAvLyBjb21tYW5kIHNlcGFyYXRvcnMgKG1pcnJvcmluZyBzcGxpdFRvcExldmVsKS5cbiAgICAgIGNvbnN0IHRyaW1tZWQgPSByYXcuc2xpY2UoY21kU3RhcnQsIGkpLnRyaW1FbmQoKTtcbiAgICAgIGNvbnN0IGR1cFJlZGlyZWN0ID1cbiAgICAgICAgdHJpbW1lZC5lbmRzV2l0aCgnPicpICYmICh0cmltbWVkLmxlbmd0aCA9PT0gMSB8fCAvXFxzfFxcZC8udGVzdCh0cmltbWVkW3RyaW1tZWQubGVuZ3RoIC0gMl0gPz8gJycpKTtcbiAgICAgIGlmIChyYXdbaSArIDFdID09PSAnPicgfHwgZHVwUmVkaXJlY3QpIHtcbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNtZFN0YXJ0ID0gaSArIDE7XG4gICAgICBwZW5kaW5nUGlwZSA9IGZhbHNlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnPCcgJiYgcmF3W2kgKyAxXSA9PT0gJzwnKSB7XG4gICAgICAvLyBgPDw8YCBpcyBhIGhlcmUtc3RyaW5nIChvdXQgb2Ygc2NvcGUpOyBgPDwtYCBzdHJpcHMgbGVhZGluZyB0YWJzLlxuICAgICAgaWYgKHJhd1tpICsgMl0gPT09ICc8Jykge1xuICAgICAgICBpICs9IDM7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgbGV0IGogPSBpIC0gMTtcbiAgICAgIHdoaWxlIChqID49IGZyb20gJiYgL1xcZC8udGVzdChyYXdbal0pKSBqIC09IDE7XG4gICAgICBjb25zdCBpb051bWJlciA9IGogPCBpIC0gMSAmJiAoaiA8IGZyb20gfHwgL1xcc3xbO3wmKF0vLnRlc3QocmF3W2pdKSk7XG4gICAgICBpZiAoaW9OdW1iZXIpIHtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHRhYlN0cmlwID0gcmF3W2kgKyAyXSA9PT0gJy0nO1xuICAgICAgY29uc3Qgb3BMZW4gPSB0YWJTdHJpcCA/IDMgOiAyO1xuICAgICAgY29uc3QgbGluZUVuZCA9IHJhdy5pbmRleE9mKCdcXG4nLCBpKTtcbiAgICAgIGNvbnN0IG9wZW5lckxpbmVFbmQgPSBsaW5lRW5kID09PSAtMSA/IG4gOiBsaW5lRW5kO1xuICAgICAgY29uc3QgYXR0YWNoZWQgPSByZWFkRGVsaW1Xb3JkKGkgKyBvcExlbik7XG4gICAgICBsZXQgZGVsaW0gPSBhdHRhY2hlZCA9PT0gbnVsbCA/ICcnIDogYXR0YWNoZWQuZGVsaW07XG4gICAgICBsZXQgc2F3UXVvdGUgPSBhdHRhY2hlZCA9PT0gbnVsbCA/IGZhbHNlIDogYXR0YWNoZWQuc2F3UXVvdGU7XG4gICAgICBpZiAoZGVsaW0gPT09ICcnICYmIGF0dGFjaGVkICE9PSBudWxsKSB7XG4gICAgICAgIC8vIFN0YW5kYWxvbmUgb3BlcmF0b3I6IHRoZSBkZWxpbWl0ZXIgaXMgdGhlIG5leHQgd29yZC5cbiAgICAgICAgbGV0IGsgPSBhdHRhY2hlZC5uZXh0O1xuICAgICAgICB3aGlsZSAoayA8IG9wZW5lckxpbmVFbmQgJiYgL1xccy8udGVzdChyYXdba10pKSBrICs9IDE7XG4gICAgICAgIGNvbnN0IHdvcmQgPSByZWFkRGVsaW1Xb3JkKGspO1xuICAgICAgICBpZiAod29yZCA9PT0gbnVsbCkgZGVsaW0gPSAnJztcbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgZGVsaW0gPSB3b3JkLmRlbGltO1xuICAgICAgICAgIHNhd1F1b3RlID0gd29yZC5zYXdRdW90ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKGRlbGltID09PSAnJyB8fCAoIXNhd1F1b3RlICYmICFCQVJFX0RFTElNLnRlc3QoZGVsaW0pKSkge1xuICAgICAgICAvLyBObyBkZWxpbWl0ZXIsIG9yIGEgYmFyZSBmb3JtIG91dHNpZGUgdGhlIGlkZW50aWZpZXIgc2hhcGUgXHUyMDE0IGZhaWxcbiAgICAgICAgLy8gY2xvc2VkIGFuZCBrZWVwIHNjYW5uaW5nIHBhc3QgdGhlIG9wZXJhdG9yLlxuICAgICAgICBpICs9IG9wTGVuO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB7IGNtZFN0YXJ0LCBvcGVuZXJMaW5lRW5kLCBkZWxpbSwgdGFiU3RyaXAsIHF1b3RlZERlbGltOiBzYXdRdW90ZSB9O1xuICAgIH1cbiAgICBpICs9IDE7XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKlxuICogVGhlIGJvZHkgb2YgYW4gb3BlbmVyIHJ1bnMgZnJvbSBhZnRlciB0aGUgb3BlbmVyIGxpbmUncyBuZXdsaW5lIHRvIHRoZSBsaW5lXG4gKiB0aGF0IGlzIGV4YWN0bHkgdGhlIGRlbGltaXRlciAoYDw8YCksIG9yIGl0cyBsZWFkaW5nLXRhYi1zdHJpcHBlZCBmb3JtXG4gKiAoYDw8LWApLCB0cmFpbGluZyB3aGl0ZXNwYWNlIGFsbG93ZWQuIFJldHVybnMgdGhlIGNsb3NlcidzIGxpbmUgYm91bmRzLCBvclxuICogbnVsbCB3aGVuIG5vIGNsb3NlciBleGlzdHMgKGZhaWwgY2xvc2VkKS5cbiAqL1xuZnVuY3Rpb24gaGVyZWRvY0Nsb3NlcihyYXc6IHN0cmluZywgb3BlbjogSGVyZWRvY09wZW5lcik6IHsgbGluZVN0YXJ0OiBudW1iZXI7IGxpbmVFbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gIGNvbnN0IG4gPSByYXcubGVuZ3RoO1xuICBjb25zdCBib2R5U3RhcnQgPSBvcGVuLm9wZW5lckxpbmVFbmQgPCBuID8gb3Blbi5vcGVuZXJMaW5lRW5kICsgMSA6IG47XG4gIGxldCBsaW5lUG9zID0gYm9keVN0YXJ0O1xuICB3aGlsZSAobGluZVBvcyA8IG4pIHtcbiAgICBjb25zdCBubCA9IHJhdy5pbmRleE9mKCdcXG4nLCBsaW5lUG9zKTtcbiAgICBjb25zdCBsaW5lRW5kID0gbmwgPT09IC0xID8gbiA6IG5sO1xuICAgIGNvbnN0IGNhbmRpZGF0ZSA9IG9wZW4udGFiU3RyaXAgPyByYXcuc2xpY2UobGluZVBvcywgbGluZUVuZCkucmVwbGFjZSgvXlxcdCsvLCAnJykgOiByYXcuc2xpY2UobGluZVBvcywgbGluZUVuZCk7XG4gICAgaWYgKFxuICAgICAgY2FuZGlkYXRlID09PSBvcGVuLmRlbGltIHx8XG4gICAgICAoY2FuZGlkYXRlLnN0YXJ0c1dpdGgob3Blbi5kZWxpbSkgJiYgL15bIFxcdF0qJC8udGVzdChjYW5kaWRhdGUuc2xpY2Uob3Blbi5kZWxpbS5sZW5ndGgpKSlcbiAgICApIHtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogbGluZVBvcywgbGluZUVuZCB9O1xuICAgIH1cbiAgICBpZiAobmwgPT09IC0xKSByZXR1cm4gbnVsbDtcbiAgICBsaW5lUG9zID0gbmwgKyAxO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIE1hc2sgZXZlcnkgaGVyZWRvYyBvdXQgb2YgdGhlIHJhdyBjb21tYW5kIHN0cmluZywgcmV0dXJuaW5nIHRoZSBib2RpZXMgYW5kXG4gKiBvcGVuZXJzIGZvciByZS1hc3NvY2lhdGlvbiBieSBpbmRleC4gVGhlIG1hc2sgY292ZXJzXG4gKiBgW2NtZFN0YXJ0LCBjbG9zZXJMaW5lRW5kKWAgXHUyMDE0IHRoZSBvcGVuZXIgbGluZSB0aHJvdWdoIHRoZSBjbG9zZXIgbGluZSwgdGhlXG4gKiBjbG9zZXIncyBuZXdsaW5lIGV4Y2x1ZGVkIFx1MjAxNCBzbyBhIGNvbW1hbmQgam9pbmVkIGJlZm9yZSB0aGUgb3BlbmVyXG4gKiAoYGNtZDEgJiYgY2F0IDw8RU9GYCkga2VlcHMgaXRzIHN0cnVjdHVyZSwgYW5kIHRoZSBwbGFjZWhvbGRlciBzdGFuZHMgYWxvbmVcbiAqIGFzIGl0cyBvd24gc2ltcGxlIGNvbW1hbmQuIEEgaGVyZWRvYyB3aXRob3V0IGEgY2xvc2VyIGZhaWxzIGNsb3NlZDogaXRzXG4gKiBvcGVuZXIgbGluZSBzdGF5cyB1bm1hc2tlZCBhbmQgc2Nhbm5pbmcgcmVzdW1lcyBhZnRlciBpdC5cbiAqL1xuZnVuY3Rpb24gZXh0cmFjdEhlcmVkb2NXcml0ZXMocmF3OiBzdHJpbmcpOiB7IHdyaXRlczogSGVyZWRvY1dyaXRlW107IG1hc2tlZDogc3RyaW5nIH0ge1xuICBjb25zdCB3cml0ZXM6IEhlcmVkb2NXcml0ZVtdID0gW107XG4gIGxldCBtYXNrZWQgPSAnJztcbiAgbGV0IGN1cnNvciA9IDA7XG4gIGZvciAoOzspIHtcbiAgICBjb25zdCBvcGVuID0gZmluZEhlcmVkb2NPcGVuZXIocmF3LCBjdXJzb3IpO1xuICAgIGlmIChvcGVuID09PSBudWxsKSBicmVhaztcbiAgICBjb25zdCBjbG9zZSA9IGhlcmVkb2NDbG9zZXIocmF3LCBvcGVuKTtcbiAgICBpZiAoY2xvc2UgPT09IG51bGwpIHtcbiAgICAgIGN1cnNvciA9IG9wZW4ub3BlbmVyTGluZUVuZCA8IHJhdy5sZW5ndGggPyBvcGVuLm9wZW5lckxpbmVFbmQgKyAxIDogcmF3Lmxlbmd0aDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBib2R5U3RhcnQgPSBvcGVuLm9wZW5lckxpbmVFbmQgPCByYXcubGVuZ3RoID8gb3Blbi5vcGVuZXJMaW5lRW5kICsgMSA6IHJhdy5sZW5ndGg7XG4gICAgbGV0IGJvZHkgPSByYXcuc2xpY2UoYm9keVN0YXJ0LCBjbG9zZS5saW5lU3RhcnQpLnJlcGxhY2UoL1xcbiQvLCAnJyk7XG4gICAgaWYgKG9wZW4udGFiU3RyaXApIGJvZHkgPSBib2R5LnJlcGxhY2UoL15cXHQrL2dtLCAnJyk7XG4gICAgbWFza2VkICs9IHJhdy5zbGljZShjdXJzb3IsIG9wZW4uY21kU3RhcnQpO1xuICAgIG1hc2tlZCArPSBgX19oZXJlZG9jXyR7d3JpdGVzLmxlbmd0aH1fX2A7XG4gICAgd3JpdGVzLnB1c2goeyBvcGVuZXI6IHJhdy5zbGljZShvcGVuLmNtZFN0YXJ0LCBvcGVuLm9wZW5lckxpbmVFbmQpLCBib2R5LCBxdW90ZWREZWxpbTogb3Blbi5xdW90ZWREZWxpbSB9KTtcbiAgICBjdXJzb3IgPSBjbG9zZS5saW5lRW5kO1xuICB9XG4gIG1hc2tlZCArPSByYXcuc2xpY2UoY3Vyc29yKTtcbiAgcmV0dXJuIHsgd3JpdGVzLCBtYXNrZWQgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSZWRpcmVjdC10b2tlbiBhbmFseXNpcyBhbmQgdGhlIHdyaXRlLXRvdWNoIGdyYW1tYXJzIChwbGFuIFx1MDBBNzUuMSwgXHUwMEE3NS4yKS5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5pbnRlcmZhY2UgUmVkaXJlY3RJbmZvIHtcbiAgLyoqIElPX05VTUJFUiBmZCAoYDE+YC9gMj5gKSwgb3IgbnVsbCB3aGVuIGltcGxpY2l0LiAqL1xuICBmZDogbnVtYmVyIHwgbnVsbDtcbiAgLyoqIFRoZSBvcGVyYXRvci4gKi9cbiAgb3A6ICc+JyB8ICc+PicgfCAnJj4nIHwgJyY+PicgfCAnPiYnIHwgJzwnIHwgJzw8JyB8ICc8PC0nIHwgJzw8PCc7XG4gIC8qKiBBdHRhY2hlZCB0YXJnZXQgdGV4dCwgb3IgbnVsbCBmb3IgYSBzdGFuZGFsb25lIG9wZXJhdG9yICh0YXJnZXQgPSBuZXh0IHRva2VuKS4gKi9cbiAgdGFyZ2V0OiBzdHJpbmcgfCBudWxsO1xufVxuXG5jb25zdCBSRURJUkVDVF9UT0tFTiA9IC9eKFxcZCopKDw8PHw8PC18Jj4+fDw8fD4+fCY+fD4mfDx8PikoLiopJC87XG5cbmZ1bmN0aW9uIGNsYXNzaWZ5UmVkaXJlY3RUb2tlbih0ZXh0OiBzdHJpbmcpOiBSZWRpcmVjdEluZm8gfCBudWxsIHtcbiAgY29uc3QgbSA9IHRleHQubWF0Y2goUkVESVJFQ1RfVE9LRU4pO1xuICBpZiAobSA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IFssIGZkVGV4dCwgb3AsIHRhcmdldF0gPSBtO1xuICByZXR1cm4ge1xuICAgIGZkOiBmZFRleHQgPT09ICcnID8gbnVsbCA6IE51bWJlci5wYXJzZUludChmZFRleHQsIDEwKSxcbiAgICBvcDogb3AgYXMgUmVkaXJlY3RJbmZvWydvcCddLFxuICAgIHRhcmdldDogdGFyZ2V0ID09PSAnJyA/IG51bGwgOiB0YXJnZXRcbiAgfTtcbn1cblxuLyoqXG4gKiBBIGNvbnRlbnQtcHJvZHVjaW5nIHJlZGlyZWN0IChwbGFuIFx1MDBBNzUuMSk6IGZkLTEgYD5gL2A+PmAgKGV4cGxpY2l0IGAxPmAvYDE+PmBcbiAqIGluY2x1ZGVkKSBhbmQgYCY+YC9gJj4+YC4gRkQtbnVtYmVyZWQgKGAyPmApLCBkdXAgKGAyPiYxYCwgYD4mZmApLFxuICogYCZgLWxlYWRpbmctdGFyZ2V0IGR1cCAoYD4mYCkgYW5kIHN0ZGluIChgPGApIGZvcm1zIG5ldmVyIHByb2R1Y2UgY29udGVudC5cbiAqL1xuZnVuY3Rpb24gaXNDb250ZW50UmVkaXJlY3QocjogUmVkaXJlY3RJbmZvKTogYm9vbGVhbiB7XG4gIGlmIChyLm9wID09PSAnPicgfHwgci5vcCA9PT0gJz4+Jykge1xuICAgIGlmIChyLmZkICE9PSBudWxsICYmIHIuZmQgIT09IDEpIHJldHVybiBmYWxzZTtcbiAgICBpZiAoci50YXJnZXQ/LnN0YXJ0c1dpdGgoJyYnKSkgcmV0dXJuIGZhbHNlO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiByLm9wID09PSAnJj4nIHx8IHIub3AgPT09ICcmPj4nO1xufVxuXG4vKiogVGhlIGFyZ3Ygc3RyZWFtIGFuZCByZWRpcmVjdCBsaXN0IG9mIGEgc2ltcGxlIGNvbW1hbmQgKHBsYW4gXHUwMEE3NS4xMCk6IHdvcmRzIG1pbnVzIHJlZGlyZWN0IHRva2VucyBhbmQgdGhlaXIgdGFyZ2V0cy4gKi9cbmZ1bmN0aW9uIGFuYWx5emVUb2tlbnModG9rZW5zOiBUb2tlbltdKTogeyBhcmd2OiBzdHJpbmdbXTsgcmVkaXJlY3RzOiBSZWRpcmVjdEluZm9bXSB9IHtcbiAgY29uc3QgYXJndjogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgcmVkaXJlY3RzOiBSZWRpcmVjdEluZm9bXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHRva2Vucy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IHRva2VuID0gdG9rZW5zW2ldO1xuICAgIGlmICghdG9rZW4uaXNSZWRpcmVjdCkge1xuICAgICAgYXJndi5wdXNoKHRva2VuLnRleHQpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGluZm8gPSBjbGFzc2lmeVJlZGlyZWN0VG9rZW4odG9rZW4udGV4dCk7XG4gICAgaWYgKGluZm8gPT09IG51bGwpIHtcbiAgICAgIGFyZ3YucHVzaCh0b2tlbi50ZXh0KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaW5mby50YXJnZXQgPT09IG51bGwpIHtcbiAgICAgIC8vIEEgc3RhbmRhbG9uZSBvcGVyYXRvciBjb25zdW1lcyB0aGUgbmV4dCB0b2tlbiBhcyBpdHMgdGFyZ2V0IChvclxuICAgICAgLy8gaGVyZWRvYyBkZWxpbWl0ZXIgLyBoZXJlLXN0cmluZyBjb250ZW50KSBcdTIwMTQgYXR0YWNoZWQgdG8gdGhlIHJlZGlyZWN0XG4gICAgICAvLyBzbyB0aGUgd3JpdGUgZ3JhbW1hcnMgc2VlIGl0LCBhbmQgZXhjbHVkZWQgZnJvbSBhcmd2LlxuICAgICAgY29uc3QgbmV4dCA9IHRva2Vuc1tpICsgMV07XG4gICAgICBpZiAobmV4dCAhPT0gdW5kZWZpbmVkICYmICFuZXh0LmlzUmVkaXJlY3QpIHtcbiAgICAgICAgcmVkaXJlY3RzLnB1c2goeyAuLi5pbmZvLCB0YXJnZXQ6IG5leHQudGV4dCB9KTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmVkaXJlY3RzLnB1c2goaW5mbyk7XG4gIH1cbiAgcmV0dXJuIHsgYXJndiwgcmVkaXJlY3RzIH07XG59XG5cbi8qKlxuICogTGl0ZXJhbCBgZWNob2AvYHByaW50ZmAgY29udGVudCAocGxhbiBcdTAwQTc1LjEpIGZvciBib2R5IHRocmVhZGluZzogbm9cbiAqIGZsYWdzLCBubyBzaGVsbCBleHBhbnNpb24sIG5vIGdsb2JzOyBgcHJpbnRmYCBvbmx5IHdoZW4gdGhlIGZvcm1hdCBoYXMgbm9cbiAqIGAlYC9iYWNrc2xhc2ggZGlyZWN0aXZlcyAodGhlbiB0aGUgZm9ybWF0IGl0c2VsZiBpcyB0aGUgbGl0ZXJhbCBjb250ZW50KS5cbiAqIFRocmVhZGVkIG9uIGFwcGVuZHMgYXMgdGhlIHN1ZmZpeCBnYXRlJ3MgYm9keSBhbmQgb24gc2luZ2xlIHBsYWluIGA+YFxuICogb3ZlcndyaXRlcyAoYW5kIHRlZSBvcGVyYW5kcyB3aXRoIGEgb25lLWhvcCBsaXRlcmFsIHBpcGUgc291cmNlKSBhcyB0aGVcbiAqIGV4YWN0IGdhdGUncyBwb3N0LWNvbnRlbnQuXG4gKi9cbmZ1bmN0aW9uIGxpdGVyYWxDb250ZW50KGFyZ3Y6IHN0cmluZ1tdKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgaG9zdCA9IGFyZ3ZbMF07XG4gIGlmIChob3N0ICE9PSAnZWNobycgJiYgaG9zdCAhPT0gJ3ByaW50ZicpIHJldHVybiB1bmRlZmluZWQ7XG4gIGNvbnN0IGFyZ3MgPSBhcmd2LnNsaWNlKDEpO1xuICBpZiAoYXJncy5sZW5ndGggPT09IDApIHJldHVybiB1bmRlZmluZWQ7XG4gIGZvciAoY29uc3QgYSBvZiBhcmdzKSB7XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpIHx8IGhhc1NoZWxsRXhwYW5zaW9uKGEpIHx8IC9bKj9dLy50ZXN0KGEpKSByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGlmIChob3N0ID09PSAncHJpbnRmJykge1xuICAgIGlmIChhcmdzLmxlbmd0aCAhPT0gMSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBjb25zdCBmbXQgPSBhcmdzWzBdO1xuICAgIGlmIChmbXQuaW5jbHVkZXMoJyUnKSB8fCBmbXQuaW5jbHVkZXMoJ1xcXFwnKSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICByZXR1cm4gZm10O1xuICB9XG4gIHJldHVybiBgJHthcmdzLmpvaW4oJyAnKX1cXG5gO1xufVxuXG4vKipcbiAqIFJlc29sdmUgYSByZWRpcmVjdCB0YXJnZXQgYWdhaW5zdCB0aGUgY3VycmVudCBkaXJlY3RvcnksIGVtaXR0aW5nIHRoZVxuICogdW5yZXNvbHZlZCB2ZXJkaWN0ICh0aGUgcmVhZCBpZGlvbXMnIHJlYXNvbikgd2hlbiB0aGUgcGF0aCBjYXJyaWVzIGFuXG4gKiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2IuIFJldHVybnMgdGhlIGFic29sdXRlIHBhdGgsIG9yIG51bGwuXG4gKi9cbmZ1bmN0aW9uIHJlc29sdmVUYXJnZXQocmVzdWx0czogU3Bhbk1hdGNoW10sIGlkaW9tOiBJZGlvbSwgdGFyZ2V0OiBzdHJpbmcsIGN1cnJlbnREaXI6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICBpZiAobG9va3NVbnJlc29sdmFibGUodGFyZ2V0KSkge1xuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgIGlkaW9tLFxuICAgICAgZmlsZUFyZzogdGFyZ2V0LFxuICAgICAgcmVhc29uOiAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InXG4gICAgfSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgcmV0dXJuIHJlc29sdmVQYXRoKGN1cnJlbnREaXIsIHRhcmdldCk7XG59XG5cbi8qKiBUaGUgYHRlZWAgb3BlcmFuZCBncmFtbWFyOiBhcHBlbmQgbW9kZSBhbmQgb3BlcmFuZCBsaXN0OyB1bmtub3duIG9wdGlvbnMgcmV0dXJuIG51bGwgKGZhaWwgY2xvc2VkKS4gKi9cbmZ1bmN0aW9uIHRlZU9wZXJhbmRQYXJ0cyhhcmd2OiBzdHJpbmdbXSk6IHsgYXBwZW5kOiBib29sZWFuOyBvcGVyYW5kczogc3RyaW5nW10gfSB8IG51bGwge1xuICBsZXQgYXBwZW5kID0gZmFsc2U7XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG4gIGNvbnN0IG9wZXJhbmRzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGEgb2YgYXJndi5zbGljZSgxKSkge1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1hJyB8fCBhID09PSAnLS1hcHBlbmQnKSB7XG4gICAgICBhcHBlbmQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgcmV0dXJuIG51bGw7XG4gICAgb3BlcmFuZHMucHVzaChhKTtcbiAgfVxuICByZXR1cm4geyBhcHBlbmQsIG9wZXJhbmRzIH07XG59XG5cbi8qKlxuICogVGhlIGB0ZWVgIG9wZXJhbmQgd3JpdGVzIChwbGFuIFx1MDBBNzUuMSk6IGVhY2ggb3BlcmFuZCBpcyBhIHdob2xlLWZpbGVcbiAqIGNyZWF0ZS1vdmVyd3JpdGUgKHRydW5jYXRpbmcpLCBvciBhIHdob2xlLWZpbGUgYXBwZW5kIHVuZGVyIGAtYWAvYC0tYXBwZW5kYC5cbiAqIEEgb25lLWhvcCBsaXRlcmFsIGVjaG8vcHJpbnRmIHBpcGUgc291cmNlIChgZWNobyB4IHwgdGVlIGZgLCBgcHJpbnRmIHkgfFxuICogdGVlIC1hIGZgLCBwbGFuIFx1MDBBNzUuMikgdGhyZWFkcyBhcyB0aGUgd3JpdHRlbiBib2R5IFx1MjAxNCB0aGUgZXhhY3QgZ2F0ZSdzXG4gKiBwb3N0LWNvbnRlbnQgb24gdGhlIHRydW5jYXRpbmcgd3JpdGUsIHRoZSBzdWZmaXggZ2F0ZSdzIGJvZHkgb24gdGhlIGFwcGVuZDtcbiAqIHdpdGhvdXQgYSBrbm93biBzb3VyY2UgbmVpdGhlciBvcCBjYXJyaWVzIHdyaXR0ZW4gY29udGVudC5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hUZWVPcGVyYW5kcyhcbiAgYXJndjogc3RyaW5nW10sXG4gIHBpcGVFY2hvQ29udGVudDogc3RyaW5nIHwgbnVsbCxcbiAgY3VycmVudERpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcGFydHMgPSB0ZWVPcGVyYW5kUGFydHMoYXJndik7XG4gIGlmIChwYXJ0cyA9PT0gbnVsbCkgcmV0dXJuO1xuICBmb3IgKGNvbnN0IG9wZXJhbmQgb2YgcGFydHMub3BlcmFuZHMpIHtcbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlVGFyZ2V0KHJlc3VsdHMsICdyZWRpcmVjdC13cml0ZScsIG9wZXJhbmQsIGN1cnJlbnREaXIpO1xuICAgIGlmIChhYnNvbHV0ZVBhdGggPT09IG51bGwpIGNvbnRpbnVlO1xuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogJ3JlZGlyZWN0LXdyaXRlJyxcbiAgICAgIHNwYW46ICFwYXJ0cy5hcHBlbmRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBvcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJyxcbiAgICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgICAuLi4ocGlwZUVjaG9Db250ZW50ICE9PSBudWxsID8geyB3cml0dGVuOiBwaXBlRWNob0NvbnRlbnQgfSA6IHt9KVxuICAgICAgICAgIH1cbiAgICAgICAgOiB7XG4gICAgICAgICAgICBvcGVyYXRpb246ICdhcHBlbmQnLFxuICAgICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICAgICAgam9pbixcbiAgICAgICAgICAgIC4uLihwaXBlRWNob0NvbnRlbnQgIT09IG51bGwgPyB7IHdyaXR0ZW46IHBpcGVFY2hvQ29udGVudCB9IDoge30pXG4gICAgICAgICAgfVxuICAgIH0pO1xuICB9XG59XG5cbi8qKlxuICogVGhlIHJlZGlyZWN0IGZhbWlseSBncmFtbWFyIChwbGFuIFx1MDBBNzUuMSksIHJ1biBmb3IgZXZlcnkgc2ltcGxlIGNvbW1hbmQgYWZ0ZXJcbiAqIHRoZSByZWFkIG1hdGNoZXJzOiBjb250ZW50LXByb2R1Y2luZyByZWRpcmVjdHMgb24gYGVjaG9gL2BwcmludGZgL2B0ZWVgXG4gKiB3cml0ZSB3aG9sZS1maWxlOyBhIGJhcmUgYD4gZmAgLyBgOiA+IGZgIHRydW5jYXRlcyAodGhlIG1haW4gd2FsayBoYW5kc1xuICogYXJndi1lbXB0eSBjb21tYW5kcyBkaXJlY3RseSBoZXJlKTsgYD4+YC1vbmx5IHRydW5jYXRpb24gZm9ybXMgYXBwZW5kXG4gKiBub3RoaW5nIGFuZCB0b3VjaCBub3RoaW5nLiBBbnkgb3RoZXIgaG9zdCB3aXRoIGEgY29udGVudCByZWRpcmVjdCAoYGxzID4gZmAsXG4gKiBgcHl0aG9uMyB4LnB5ID4gb3V0YCwgYGNhdCBmID4gZ2ApIGdldHMgbm8gd3JpdGUgdG91Y2ggXHUyMDE0IHRoZSByZWRpcmVjdCBpc1xuICogcmVhbCwgYnV0IGl0cyBjb250ZW50IGlzIGR5bmFtaWMgYW5kIG91dCBvZiBzY29wZS5cbiAqXG4gKiBCb2R5IHRocmVhZGluZzogZXhhY3RseSBvbmUgcGxhaW4gYD4+YCAob3IgYDE+PmApIGNvbnRlbnQgcmVkaXJlY3Qgb24gYVxuICogZnVsbHkgbGl0ZXJhbCBgZWNob2AvYHByaW50ZmAgdGhyZWFkcyB0aGUgd3JpdHRlbiBib2R5ICh0aGUgc3VmZml4IGdhdGUpLFxuICogYW5kIGV4YWN0bHkgb25lIHBsYWluIGA+YCAob3IgYDE+YCkgY29udGVudCByZWRpcmVjdCBvbiB0aGUgc2FtZSBsaXRlcmFsc1xuICogdGhyZWFkcyBpdCBhcyB0aGUgZXhhY3QgZ2F0ZSdzIHBvc3QtY29udGVudCAocGxhbiBcdTAwQTczIHN0ZXAgMWIgXHUyMDE0IHRoZVxuICogY29udGVudCBsYXllciBpcyB3aGF0IHN1cHByZXNzZXMgYGVjaG8gaGkgPiByZWFkLW9ubHktZmlsZWAsIHdoZXJlIHRoZVxuICogZmlsZSBzdGF5cyBwcmVzZW50IGJ1dCB1bmNoYW5nZWQpLiBgJj5gL2AmPj5gLCBtdWx0aS1yZWRpcmVjdCBjb21tYW5kcyxcbiAqIGFuZCBgdGVlYCdzIG93biByZWRpcmVjdHMgbmV2ZXIgdGhyZWFkLlxuICovXG5mdW5jdGlvbiBtYXRjaFJlZGlyZWN0RmFtaWx5KFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgcmVkaXJlY3RzOiBSZWRpcmVjdEluZm9bXSxcbiAgcGlwZUVjaG9Db250ZW50OiBzdHJpbmcgfCBudWxsLFxuICBjdXJyZW50RGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCBjb250ZW50UmVkaXJlY3RzID0gcmVkaXJlY3RzLmZpbHRlcihpc0NvbnRlbnRSZWRpcmVjdCk7XG4gIGNvbnN0IGhvc3QgPSBhcmd2WzBdO1xuICBpZiAoY29udGVudFJlZGlyZWN0cy5sZW5ndGggPT09IDApIHtcbiAgICBpZiAoaG9zdCA9PT0gJ3RlZScpIG1hdGNoVGVlT3BlcmFuZHMoYXJndiwgcGlwZUVjaG9Db250ZW50LCBjdXJyZW50RGlyLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoaG9zdCA9PT0gdW5kZWZpbmVkIHx8IGhvc3QgPT09ICc6JyB8fCBob3N0ID09PSAnZXhlYycpIHtcbiAgICAvLyBCYXJlIGA+IGZgLCBgOiA+IGZgIGFuZCBgZXhlYyA+IGZgIHRydW5jYXRlIChleGVjIGFwcGxpZXMgdGhlIHJlZGlyZWN0XG4gICAgLy8gdG8gdGhlIHNoZWxsJ3Mgb3duIGZkIDEgaW1tZWRpYXRlbHkgXHUyMDE0IHRoZSBmZC0xIHRhcmdldCBpcyBzdGF0aWMsIHNvIHRoZVxuICAgIC8vIHRydW5jYXRpb24gaGFwcGVucyBldmVuIHRob3VnaCB0aGUgY29tbWFuZCBuZXZlciB3cml0ZXMpO1xuICAgIC8vIGA+PmAvYCY+PmAgYXBwZW5kIG5vdGhpbmcgXHUyMTkyIG5vIHRvdWNoLlxuICAgIGZvciAoY29uc3QgciBvZiBjb250ZW50UmVkaXJlY3RzKSB7XG4gICAgICBpZiAoci5vcCA9PT0gJz4+JyB8fCByLm9wID09PSAnJj4+JyB8fCByLnRhcmdldCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlVGFyZ2V0KHJlc3VsdHMsICd0cnVuY2F0ZS13cml0ZScsIHIudGFyZ2V0LCBjdXJyZW50RGlyKTtcbiAgICAgIGlmIChhYnNvbHV0ZVBhdGggPT09IG51bGwpIGNvbnRpbnVlO1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogJ3RydW5jYXRlLXdyaXRlJyxcbiAgICAgICAgc3BhbjogeyBvcGVyYXRpb246ICd0cnVuY2F0ZScsIGFic29sdXRlUGF0aCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGhvc3QgIT09ICdlY2hvJyAmJiBob3N0ICE9PSAncHJpbnRmJyAmJiBob3N0ICE9PSAndGVlJykgcmV0dXJuO1xuICBjb25zdCBzaW5nbGVQbGFpbkFwcGVuZCA9IGNvbnRlbnRSZWRpcmVjdHMubGVuZ3RoID09PSAxICYmIGNvbnRlbnRSZWRpcmVjdHNbMF0ub3AgPT09ICc+Pic7XG4gIGNvbnN0IHNpbmdsZVBsYWluT3ZlcndyaXRlID0gY29udGVudFJlZGlyZWN0cy5sZW5ndGggPT09IDEgJiYgY29udGVudFJlZGlyZWN0c1swXS5vcCA9PT0gJz4nO1xuICBjb25zdCB0aHJlYWRlZEFwcGVuZCA9IHNpbmdsZVBsYWluQXBwZW5kICYmIGhvc3QgIT09ICd0ZWUnID8gbGl0ZXJhbENvbnRlbnQoYXJndikgOiB1bmRlZmluZWQ7XG4gIGNvbnN0IHRocmVhZGVkT3ZlcndyaXRlID0gc2luZ2xlUGxhaW5PdmVyd3JpdGUgJiYgaG9zdCAhPT0gJ3RlZScgPyBsaXRlcmFsQ29udGVudChhcmd2KSA6IHVuZGVmaW5lZDtcbiAgZm9yIChjb25zdCByIG9mIGNvbnRlbnRSZWRpcmVjdHMpIHtcbiAgICBpZiAoci50YXJnZXQgPT09IG51bGwpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgJ3JlZGlyZWN0LXdyaXRlJywgci50YXJnZXQsIGN1cnJlbnREaXIpO1xuICAgIGlmIChhYnNvbHV0ZVBhdGggPT09IG51bGwpIGNvbnRpbnVlO1xuICAgIGlmIChyLm9wID09PSAnPj4nIHx8IHIub3AgPT09ICcmPj4nKSB7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiAncmVkaXJlY3Qtd3JpdGUnLFxuICAgICAgICBzcGFuOiB7XG4gICAgICAgICAgb3BlcmF0aW9uOiAnYXBwZW5kJyxcbiAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgLi4uKHRocmVhZGVkQXBwZW5kICE9PSB1bmRlZmluZWQgPyB7IHdyaXR0ZW46IHRocmVhZGVkQXBwZW5kIH0gOiB7fSlcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgaWRpb206ICdyZWRpcmVjdC13cml0ZScsXG4gICAgICAgIHNwYW46IHtcbiAgICAgICAgICBvcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJyxcbiAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgLi4uKHRocmVhZGVkT3ZlcndyaXRlICE9PSB1bmRlZmluZWQgPyB7IHdyaXR0ZW46IHRocmVhZGVkT3ZlcndyaXRlIH0gOiB7fSlcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9XG4gIGlmIChob3N0ID09PSAndGVlJykgbWF0Y2hUZWVPcGVyYW5kcyhhcmd2LCBwaXBlRWNob0NvbnRlbnQsIGN1cnJlbnREaXIsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiwgcmVzdWx0cyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVGhlIGZpbGUtbXV0YXRpb24gZmFtaWx5IGdyYW1tYXJzIChwbGFuIFx1MDBBNzUuM1x1MjAxM1x1MDBBNzUuNyk6IGNwL2luc3RhbGwvbXYvZ2l0IG12LFxuLy8gcm0vZ2l0IHJtL3RydW5jYXRlLCBzZWQgLWkgaW4tcGxhY2UgZWRpdHMsIGFuZCBwYXRjaC9naXQgYXBwbHkuIFRoZXkgc2hhcmVcbi8vIHRoZSBcdTAwQTc1IGZhaWwtY2xvc2VkIHJ1bGVzOiBsZWFkaW5nIGVudiBhc3NpZ25tZW50cyAoc3RyaXBwZWQgYnkgdGhlIHdhbGspXG4vLyBhbmQgb25lIGBjb21tYW5kYC9gZW52YCB3cmFwcGVyIGFyZSBza2lwcGVkIChtZWNoYW5pY2FsbHkgY2VydGFpbik7IGFueVxuLy8gb3RoZXIgd3JhcHBlciBpcyB1bnJlc29sdmVkOyBhIGxlYWRpbmctYC1gIHRva2VuIHRoYXQgaXMgbm90IGEga25vd24gb3B0aW9uXG4vLyBpcyB0cmVhdGVkIGFzIGFuIG9wdGlvbjsgYC0tYCBtYWtlcyB0aGUgcmVzdCBvcGVyYW5kczsgZ2xvYmJlZCBvciB2YXJpYWJsZVxuLy8gcGF0aHMgYXJlIHVucmVzb2x2ZWQ7IGRpcmVjdG9yeS1zaGFwZWQgc291cmNlIG9wZXJhbmRzIGZhaWwgY2xvc2VkLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBXcmFwcGVyIHdvcmRzIHRoYXQgb2JzY3VyZSB0aGUgd3JhcHBlZCBjb21tYW5kJ3MgYXJndiAocGxhbiBcdTAwQTc1KTogYSBmYW1pbHkgY29tbWFuZCBiZWhpbmQgb25lIGlzIHVucmVzb2x2ZWQsIG5ldmVyIGd1ZXNzZWQuICovXG5jb25zdCBGT1JFSUdOX1dSQVBQRVJTID0gbmV3IFNldChbJ3N1ZG8nLCAneGFyZ3MnLCAnbm9odXAnLCAndGltZScsICduaWNlJywgJ2RvYXMnXSk7XG5cbi8qKiBBIGxlYWRpbmcgYE5BTUU9dmFsdWVgIGFzc2lnbm1lbnQgdG9rZW4gKGBlbnYgRk9PPWJhciBjcCBhIGJgIGtlZXBzIG9uZSBhZnRlciB0aGUgd3JhcHBlciB3b3JkKS4gKi9cbmNvbnN0IEFTU0lHTk1FTlRfVE9LRU4gPSAvXltBLVphLXpfXVtBLVphLXowLTlfXSo9LztcblxuLyoqXG4gKiBTdHJpcCBhdCBtb3N0IG9uZSBgY29tbWFuZGAvYGVudmAgd3JhcHBlciBcdTIwMTQgbWVjaGFuaWNhbGx5IHRyYW5zcGFyZW50IChwbGFuXG4gKiBcdTAwQTc1KSBcdTIwMTQgYW5kIGFueSBsZWFkaW5nIGFzc2lnbm1lbnRzIGFmdGVyIGl0OiBgZW52IEZPTz1iYXIgY3AgYSBiYCBzZXRzIEZPT1xuICogdGhlbiBydW5zIGNwLCBleGFjdGx5IHRoZSB0cmFuc3BhcmVudC1wcmVmaXggY2xhc3MgdGhlIHdhbGsgc3RyaXBzIGJlZm9yZVxuICogdG9rZW5pemluZyAoYEZPTz1iYXIgZW52IGNwIGEgYmAgYXJyaXZlcyBoZXJlIHdpdGggdGhlIGFzc2lnbm1lbnRzIGFscmVhZHlcbiAqIGdvbmUpLlxuICovXG5mdW5jdGlvbiBzdHJpcFRyYW5zcGFyZW50V3JhcHBlcihhcmd2OiBzdHJpbmdbXSk6IHN0cmluZ1tdIHtcbiAgY29uc3QgdW53cmFwcGVkID0gYXJndlswXSA9PT0gJ2NvbW1hbmQnIHx8IGFyZ3ZbMF0gPT09ICdlbnYnID8gYXJndi5zbGljZSgxKSA6IGFyZ3Y7XG4gIGxldCBpID0gMDtcbiAgd2hpbGUgKGkgPCB1bndyYXBwZWQubGVuZ3RoICYmIEFTU0lHTk1FTlRfVE9LRU4udGVzdCh1bndyYXBwZWRbaV0pKSBpICs9IDE7XG4gIHJldHVybiBpID4gMCA/IHVud3JhcHBlZC5zbGljZShpKSA6IHVud3JhcHBlZDtcbn1cblxuZnVuY3Rpb24gcHVzaFVucmVzb2x2ZWQocmVzdWx0czogU3Bhbk1hdGNoW10sIGlkaW9tOiBJZGlvbSwgZmlsZUFyZzogc3RyaW5nLCByZWFzb246IHN0cmluZyk6IHZvaWQge1xuICByZXN1bHRzLnB1c2goeyBzdGF0dXM6ICd1bnJlc29sdmVkJywgaWRpb20sIGZpbGVBcmcsIHJlYXNvbiB9KTtcbn1cblxuLyoqIFdoZXRoZXIgdGhlIHBhdGggaXMgYW4gZXhpc3RpbmcgZGlyZWN0b3J5ICh0aGUgZGVzdC1kaXIgZGVjaXNpb24sIHBsYW4gXHUwMEE3NS4zL1x1MDBBNzUuNDsgZnMgc3RhdCBsaWtlIHRoZSByZWFkIGlkaW9tcycgbGluZSBjb3VudHMpLiAqL1xuZnVuY3Rpb24gaXNFeGlzdGluZ0RpcmVjdG9yeShhYnNvbHV0ZVBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIHJldHVybiBzdGF0U3luYyhhYnNvbHV0ZVBhdGgpLmlzRGlyZWN0b3J5KCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBzaGFyZWQgY3AvaW5zdGFsbC9tdiBvcGVyYW5kIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS4zL1x1MDBBNzUuNCk6IHBlci1mYW1pbHkgb3B0aW9uXG4gKiBzZXRzIGFuZCB0b3VjaCBvcGVyYXRpb25zIGJlaGluZCBvbmUgcGFyc2VyLlxuICovXG5pbnRlcmZhY2UgQ29weU1vdmVTcGVjIHtcbiAgaWRpb206ICdjcC13cml0ZScgfCAnaW5zdGFsbC13cml0ZScgfCAnbXYtd3JpdGUnO1xuICAvKiogS25vd24gbm8tdmFsdWUgZmxhZ3MgKGNvbnN1bWVkLCBuZXZlciBvcGVyYW5kcykuICovXG4gIG5vVmFsdWU6IFJlYWRvbmx5U2V0PHN0cmluZz47XG4gIC8qKlxuICAgKiBOby1jbG9iYmVyIGZsYWdzIChgY3AgLW5gL2AtLW5vLWNsb2JiZXJgKTogY29uc3VtZWQgbGlrZSBuby12YWx1ZSBmbGFncyxcbiAgICogYnV0IHRoZSB3cml0ZSBzdGlsbCBwYXJzZXMgXHUyMDE0IHRoZSBza2lwIGlzIGludmlzaWJsZSB0byB0aGUgcG9zdC1jb21tYW5kXG4gICAqIGJ5dGUtY29tcGFyZSBnYXRlLCB3aGljaCBjYW5ub3QgZGlzdGluZ3Vpc2ggYSByZWFsIGNvcHkgZnJvbSBhIHByZS1leGlzdGluZ1xuICAgKiBlcXVhbCBkZXN0ICh0aGUgZG9jdW1lbnRlZCBuby1vcCByZXNpZHVlLCBwaW5uZWQgaW5cbiAgICogYmFzaC13cml0ZS1pbnRlZ3JhdGlvbi50ZXN0LnRzKS5cbiAgICovXG4gIG5vQ2xvYmJlcjogUmVhZG9ubHlTZXQ8c3RyaW5nPjtcbiAgLyoqIEtub3duIHZhbHVlLXRha2luZyBmbGFncyAodGhlIG5leHQgd29yZCBpcyB0aGUgdmFsdWUgXHUyMDE0IGAtdCBESVJgLCBvciBhbiBpbnN0YWxsIG1vZGUvb3duZXIvZ3JvdXApLiAqL1xuICB2YWx1ZVRha2luZzogUmVhZG9ubHlTZXQ8c3RyaW5nPjtcbiAgLyoqIEZsYWdzIHRoYXQgZmFpbCB0aGUgd2hvbGUgY29tbWFuZCBjbG9zZWQgKGBjcCAtYmAvYC0tYmFja3VwYCwgYGluc3RhbGwgLWRgLCBnaXQgbXYgZHJ5LXJ1biBgLW5gL2AtLWRyeS1ydW5gKS4gKi9cbiAgZXhjbHVkZWQ6IFJlYWRvbmx5U2V0PHN0cmluZz47XG4gIC8qKiBUaGUgcGVyLXNvdXJjZSB0b3VjaDogY3AvaW5zdGFsbCByZWFkIHRoZWlyIHNvdXJjZXM7IG12IGRlbGV0ZXMgdGhlbS4gKi9cbiAgc291cmNlT3BlcmF0aW9uOiAncmVhZCcgfCAnZGVsZXRlJztcbiAgLyoqIFRoZSBwZXItZGVzdCB0b3VjaDogY3AvaW5zdGFsbCBvdmVyd3JpdGU7IG12IHJlbmFtZS1jb3BpZXMuICovXG4gIGRlc3RPcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJyB8ICdyZW5hbWUtY29weSc7XG59XG5cbmNvbnN0IENQX1NQRUM6IENvcHlNb3ZlU3BlYyA9IHtcbiAgaWRpb206ICdjcC13cml0ZScsXG4gIG5vVmFsdWU6IG5ldyBTZXQoWyctcicsICctUicsICctcCcsICctZicsICctdicsICctaScsICctdScsICctYScsICctZCcsICctTCcsICctUCddKSxcbiAgbm9DbG9iYmVyOiBuZXcgU2V0KFsnLW4nLCAnLS1uby1jbG9iYmVyJ10pLFxuICB2YWx1ZVRha2luZzogbmV3IFNldChbJy10JywgJy0tdGFyZ2V0LWRpcmVjdG9yeSddKSxcbiAgZXhjbHVkZWQ6IG5ldyBTZXQoWyctYicsICctLWJhY2t1cCddKSxcbiAgc291cmNlT3BlcmF0aW9uOiAncmVhZCcsXG4gIGRlc3RPcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJ1xufTtcblxuY29uc3QgSU5TVEFMTF9TUEVDOiBDb3B5TW92ZVNwZWMgPSB7XG4gIGlkaW9tOiAnaW5zdGFsbC13cml0ZScsXG4gIG5vVmFsdWU6IG5ldyBTZXQoWyctRCcsICctcycsICctdiddKSxcbiAgbm9DbG9iYmVyOiBuZXcgU2V0KCksXG4gIHZhbHVlVGFraW5nOiBuZXcgU2V0KFsnLXQnLCAnLS10YXJnZXQtZGlyZWN0b3J5JywgJy1tJywgJy1vJywgJy1nJ10pLFxuICBleGNsdWRlZDogbmV3IFNldChbJy1kJ10pLFxuICBzb3VyY2VPcGVyYXRpb246ICdyZWFkJyxcbiAgZGVzdE9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnXG59O1xuXG5jb25zdCBNVl9TUEVDOiBDb3B5TW92ZVNwZWMgPSB7XG4gIGlkaW9tOiAnbXYtd3JpdGUnLFxuICAvLyBgbXYgLW5gIHN0YXlzIGluIG5vVmFsdWUsIG5vdCBub0Nsb2JiZXI6IGFuIG12IHNraXAgbGVhdmVzIHRoZSBzb3VyY2UgaW5cbiAgLy8gcGxhY2UsIGFuZCB0aGUgZGVsZXRlJ3Mgb3duIGFic2VuY2UgZ2F0ZSB0aGVuIGZhaWxzIHRoZSB0b3VjaCBcdTIwMTQgdGhlXG4gIC8vIG5vLWNsb2JiZXIgYmxpbmQgc3BvdCBpcyBjcCdzIGJ5dGUtY29tcGFyZSwgbm90IG12J3MuXG4gIG5vVmFsdWU6IG5ldyBTZXQoWyctZicsICctaScsICctbicsICctdicsICctdSddKSxcbiAgbm9DbG9iYmVyOiBuZXcgU2V0KCksXG4gIHZhbHVlVGFraW5nOiBuZXcgU2V0KFsnLXQnLCAnLS10YXJnZXQtZGlyZWN0b3J5J10pLFxuICBleGNsdWRlZDogbmV3IFNldCgpLFxuICBzb3VyY2VPcGVyYXRpb246ICdkZWxldGUnLFxuICBkZXN0T3BlcmF0aW9uOiAncmVuYW1lLWNvcHknXG59O1xuXG5jb25zdCBHSVRfTVZfU1BFQzogQ29weU1vdmVTcGVjID0ge1xuICBpZGlvbTogJ212LXdyaXRlJyxcbiAgbm9WYWx1ZTogbmV3IFNldChbJy1mJywgJy1rJywgJy12J10pLFxuICBub0Nsb2JiZXI6IG5ldyBTZXQoKSxcbiAgdmFsdWVUYWtpbmc6IG5ldyBTZXQoKSxcbiAgLy8gYGdpdCBtdiAtbmAvYC0tZHJ5LXJ1bmAgaXMgYSB0cmlhbCBydW4gdGhhdCBtb3ZlcyBub3RoaW5nICh0aGUgc2FtZVxuICAvLyByZWFkLW9ubHkgY2xhc3MgYXMgYHBhdGNoIC0tZHJ5LXJ1bmAsIHBsYW4gXHUwMEE3NS43KSBcdTIwMTQgZmFpbCBjbG9zZWQuXG4gIGV4Y2x1ZGVkOiBuZXcgU2V0KFsnLW4nLCAnLS1kcnktcnVuJ10pLFxuICBzb3VyY2VPcGVyYXRpb246ICdkZWxldGUnLFxuICBkZXN0T3BlcmF0aW9uOiAncmVuYW1lLWNvcHknXG59O1xuXG5pbnRlcmZhY2UgQ29weU1vdmVQYXJ0cyB7XG4gIC8qKiBPcGVyYW5kcyBpbiBvcmRlciAoc291cmNlczsgaW4gdGhlIG5vbi1gLXRgIGZvcm0gdGhlIGxhc3QgaXMgdGhlIGRlc3QpLiAqL1xuICBvcGVyYW5kczogc3RyaW5nW107XG4gIC8qKiBUaGUgYC10YC9gLS10YXJnZXQtZGlyZWN0b3J5YCB2YWx1ZSwgb3IgbnVsbC4gKi9cbiAgdGFyZ2V0RGlyOiBzdHJpbmcgfCBudWxsO1xufVxuXG4vKipcbiAqIFBhcnNlIHRoZSBvcGVyYW5kcyBvZiBhIGNwL2luc3RhbGwvbXYgY29tbWFuZDoga25vd24gb3B0aW9ucyBhcmUgY29uc3VtZWQsXG4gKiBgLS1gIG1ha2VzIHRoZSByZXN0IG9wZXJhbmRzLCBhbmQgYC10YC9gLS10YXJnZXQtZGlyZWN0b3J5Wz1ESVJdYCBpc1xuICogdmFsdWUtdGFraW5nIFx1MjAxNCB0aGUgbmV4dCB3b3JkIGlzIHRoZSB0YXJnZXQgZGlyZWN0b3J5LCBuZXZlciBhIHNvdXJjZS4gQVxuICogbGVhZGluZy1gLWAgdG9rZW4gdGhhdCBpcyBub3QgYSBrbm93biBvcHRpb24gaXMgdHJlYXRlZCBhcyBhbiBvcHRpb24gKG5vXG4gKiB0b3VjaCkuIFJldHVybnMgbnVsbCB3aGVuIGEgZmFpbC1jbG9zZWQgb3B0aW9uIGlzIHByZXNlbnQgb3IgYSB2YWx1ZS10YWtpbmdcbiAqIGZsYWcgaXMgbGVmdCB2YWx1ZWxlc3MuXG4gKi9cbmZ1bmN0aW9uIGNvcHlNb3ZlUGFydHMoYXJnczogc3RyaW5nW10sIHNwZWM6IENvcHlNb3ZlU3BlYyk6IENvcHlNb3ZlUGFydHMgfCBudWxsIHtcbiAgY29uc3Qgb3BlcmFuZHM6IHN0cmluZ1tdID0gW107XG4gIGxldCB0YXJnZXREaXI6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBsZXQgaSA9IDA7XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG4gIHdoaWxlIChpIDwgYXJncy5sZW5ndGgpIHtcbiAgICBjb25zdCBhID0gYXJnc1tpXTtcbiAgICBpZiAoYWZ0ZXJEYXNoRGFzaCkge1xuICAgICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctdCcgfHwgYSA9PT0gJy0tdGFyZ2V0LWRpcmVjdG9yeScpIHtcbiAgICAgIGNvbnN0IHYgPSBhcmdzW2kgKyAxXTtcbiAgICAgIGlmICh2ID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICAgICAgdGFyZ2V0RGlyID0gdjtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctLXRhcmdldC1kaXJlY3Rvcnk9JykpIHtcbiAgICAgIHRhcmdldERpciA9IGEuc2xpY2UoJy0tdGFyZ2V0LWRpcmVjdG9yeT0nLmxlbmd0aCk7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKHNwZWMuZXhjbHVkZWQuaGFzKGEpKSByZXR1cm4gbnVsbDtcbiAgICBpZiAoc3BlYy52YWx1ZVRha2luZy5oYXMoYSkpIHtcbiAgICAgIGlmIChhcmdzW2kgKyAxXSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoc3BlYy5ub1ZhbHVlLmhhcyhhKSB8fCBzcGVjLm5vQ2xvYmJlci5oYXMoYSkpIHtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIHtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgIGkgKz0gMTtcbiAgfVxuICByZXR1cm4geyBvcGVyYW5kcywgdGFyZ2V0RGlyIH07XG59XG5cbi8qKlxuICogVGhlIHBlci1zb3VyY2UgdG91Y2ggb2YgYSBjcC9pbnN0YWxsL212IGNvbW1hbmQuIGNwL2luc3RhbGwgc291cmNlcyBhcmVcbiAqIHdob2xlLWZpbGUgcmVhZHMgcmVzb2x2ZWQgYWdhaW5zdCBmcyBsaWtlIHRoZSByZWFkIGlkaW9tczsgYSBzb3VyY2Ugd2hvc2VcbiAqIGxpbmUgY291bnQgY2Fubm90IGJlIHJlYWQgYXQgcGFyc2UgdGltZSAobWlzc2luZyBvciB1bnJlYWRhYmxlIFx1MjAxNCB0aGUgcGFyc2VcbiAqIHJ1bnMgcG9zdC1jb21tYW5kLCBzbyBhIHNvdXJjZSB0aGUgY29tcG91bmQncyBvd24gZWFybGllciBgcm1gIGRlbGV0ZWQgaXNcbiAqIGV4YWN0bHkgdGhpcykgc3RpbGwgcmVzb2x2ZXMgYXMgYSByYW5nZS1sZXNzIHdob2xlLWZpbGUgcmVhZDogdGhlIGRyaXZlclxuICogcGFpcnMgdGhlIGRlc3RpbmF0aW9uIGFnYWluc3QgaXQsIHNvIHRoZSBhYnNlbnQtc291cmNlIHJ1bGUgKHBsYW4gXHUwMEE3MyBzdGVwXG4gKiAxYikgYW5kIHRoZSByZWFkJ3MgcG9zdC1jb21tYW5kIGV4aXN0ZW5jZSBnYXRlIGFwcGx5IFx1MjAxNCBhbiB1bmV4cGxhaW5lZFxuICogYWJzZW5jZSBmYWlscyB0aGUgY29weSBkZWNpc2l2ZWx5IGFuZCBhIHBoYW50b20gc291cmNlIG5ldmVyIGZpcmVzIHRoZVxuICogZGVzdC4gVGhlIG12IHNvdXJjZSBpcyBhIGRlbGV0ZS5cbiAqL1xuZnVuY3Rpb24gZW1pdFNvdXJjZVNwYW4oXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdLFxuICBzcGVjOiBDb3B5TW92ZVNwZWMsXG4gIGFic29sdXRlUGF0aDogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ11cbik6IHZvaWQge1xuICBpZiAoc3BlYy5zb3VyY2VPcGVyYXRpb24gPT09ICdkZWxldGUnKSB7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiBzcGVjLmlkaW9tLFxuICAgICAgc3BhbjogeyBvcGVyYXRpb246ICdkZWxldGUnLCBhYnNvbHV0ZVBhdGgsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgfSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHJhbmdlID0gcmVzb2x2ZVNwZWMoeyBraW5kOiAndG9Fb2YnLCBzdGFydDogMSB9LCAoKSA9PiBjb3VudEZpbGVMaW5lcyhhYnNvbHV0ZVBhdGgpKTtcbiAgcmVzdWx0cy5wdXNoKHtcbiAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgaWRpb206IHNwZWMuaWRpb20sXG4gICAgc3BhbjpcbiAgICAgIHJhbmdlID09PSBudWxsXG4gICAgICAgID8geyBvcGVyYXRpb246ICdyZWFkJywgYWJzb2x1dGVQYXRoLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgICAgICA6IHtcbiAgICAgICAgICAgIG9wZXJhdGlvbjogJ3JlYWQnLFxuICAgICAgICAgICAgbGluZVN0YXJ0OiByYW5nZS5saW5lU3RhcnQsXG4gICAgICAgICAgICBsaW5lRW5kOiByYW5nZS5saW5lRW5kLFxuICAgICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICAgICAgam9pblxuICAgICAgICAgIH1cbiAgfSk7XG59XG5cbi8qKlxuICogVGhlIGNwL2luc3RhbGwvbXYgZmFtaWx5IChwbGFuIFx1MDBBNzUuMy9cdTAwQTc1LjQpOiBvcGVyYW5kcyByZXNvbHZlIHRvIHNvdXJjZS9kZXN0XG4gKiBwYWlycyBcdTIwMTQgZWFjaCBzb3VyY2UgaXMgYSByZWFkIChjcC9pbnN0YWxsKSBvciBkZWxldGUgKG12KSwgZWFjaCBkZXN0IGFcbiAqIGNyZWF0ZS1vdmVyd3JpdGUgKGNwL2luc3RhbGwpIG9yIHJlbmFtZS1jb3B5IChtdiksIHNvdXJjZXMgYmVmb3JlIGRlc3RzIGluXG4gKiBkZWNsYXJhdGlvbiBvcmRlci4gQSBkZXN0IHRoYXQgZW5kcyBpbiBgL2Agb3Igc3RhdHMgYXMgYW4gZXhpc3RpbmcgZGlyZWN0b3J5XG4gKiBtYXBzIHRvIGBkaXIvYmFzZW5hbWUoc291cmNlKWAgcGVyIHNvdXJjZTsgYC10IERJUmAvYC0tdGFyZ2V0LWRpcmVjdG9yeT1ESVJgXG4gKiBtYXBzIHRoZSBzYW1lIHdheSBhbmQgaXMgdW5yZXNvbHZlZCB3aGVuIGl0cyB2YWx1ZSBpcyBub3QgZGlyZWN0b3J5LXNoYXBlZC5cbiAqIE11bHRpLXNvdXJjZSBjb21tYW5kcyBuZWVkIGEgZGlyZWN0b3J5IGRlc3Q7IGEgZGlyZWN0b3J5LXNoYXBlZCBvclxuICogZ2xvYmJlZC92YXJpYWJsZSBzb3VyY2UsIGEgZ2xvYmJlZC92YXJpYWJsZSBkZXN0LCBvciBhIGZhaWwtY2xvc2VkIG9wdGlvblxuICogKGBjcCAtYmAsIGBpbnN0YWxsIC1kYCwgZ2l0IG12IGAtbmApIGVtaXRzIG5vIHRvdWNoZXMuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoQ29weU1vdmVGYW1pbHkoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBkaXJGb3JSZXNvbHV0aW9uOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCByZXN0ID0gc3RyaXBUcmFuc3BhcmVudFdyYXBwZXIoYXJndik7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICBjb25zdCBjb21tYW5kID0gcmVzdFswXTtcbiAgbGV0IHNwZWM6IENvcHlNb3ZlU3BlYyB8IG51bGwgPSBudWxsO1xuICBsZXQgYXJnczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGRpciA9IGRpckZvclJlc29sdXRpb247XG4gIGlmIChjb21tYW5kID09PSAnY3AnIHx8IGNvbW1hbmQgPT09ICdpbnN0YWxsJyB8fCBjb21tYW5kID09PSAnbXYnKSB7XG4gICAgc3BlYyA9IGNvbW1hbmQgPT09ICdjcCcgPyBDUF9TUEVDIDogY29tbWFuZCA9PT0gJ2luc3RhbGwnID8gSU5TVEFMTF9TUEVDIDogTVZfU1BFQztcbiAgICBhcmdzID0gcmVzdC5zbGljZSgxKTtcbiAgfSBlbHNlIGlmIChjb21tYW5kID09PSAnZ2l0Jykge1xuICAgIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKHJlc3Quc2xpY2UoMSkpO1xuICAgIGlmIChzdWIgIT09IG51bGwgJiYgc3ViLnN1YmNvbW1hbmQgPT09ICdtdicpIHtcbiAgICAgIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSkge1xuICAgICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAnbXYtd3JpdGUnLCAnbXYnLCAnZ2l0IC1DIHRhcmdldCBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHNwZWMgPSBHSVRfTVZfU1BFQztcbiAgICAgIGFyZ3MgPSByZXN0LnNsaWNlKDEpLnNsaWNlKHN1Yi5zdWJJZHggKyAxKTtcbiAgICAgIGRpciA9IHN1Yi5jRGlyID8/IGRpckZvclJlc29sdXRpb247XG4gICAgfVxuICB9IGVsc2UgaWYgKEZPUkVJR05fV1JBUFBFUlMuaGFzKGNvbW1hbmQpKSB7XG4gICAgLy8gQSB3cmFwcGVyIG9ic2N1cmVzIHRoZSB3cmFwcGVkIGFyZ3YgXHUyMDE0IGZhaWwgY2xvc2VkIHJhdGhlciB0aGFuIG1pcy1wYXJzZS5cbiAgICBjb25zdCB3cmFwcGVkID0gcmVzdFsxXTtcbiAgICBjb25zdCB3cmFwcGVkU3BlYyA9XG4gICAgICB3cmFwcGVkID09PSAnY3AnID8gQ1BfU1BFQyA6IHdyYXBwZWQgPT09ICdpbnN0YWxsJyA/IElOU1RBTExfU1BFQyA6IHdyYXBwZWQgPT09ICdtdicgPyBNVl9TUEVDIDogbnVsbDtcbiAgICBpZiAod3JhcHBlZFNwZWMgIT09IG51bGwpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsIHdyYXBwZWRTcGVjLmlkaW9tLCB3cmFwcGVkLCBgdGhlICR7Y29tbWFuZH0gd3JhcHBlciBvYnNjdXJlcyB0aGUgJHt3cmFwcGVkfSBhcmd2YCk7XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuICBpZiAoc3BlYyA9PT0gbnVsbCkgcmV0dXJuO1xuXG4gIGNvbnN0IHBhcnRzID0gY29weU1vdmVQYXJ0cyhhcmdzLCBzcGVjKTtcbiAgaWYgKHBhcnRzID09PSBudWxsIHx8IHBhcnRzLm9wZXJhbmRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gIC8vIFJlc29sdmUgZXZlcnkgc291cmNlIGJlZm9yZSBlbWl0dGluZyBhbnl0aGluZzogYSBkaXJlY3Rvcnktc2hhcGVkLFxuICAvLyBnbG9iYmVkLCBvciB2YXJpYWJsZSBzb3VyY2UgZmFpbHMgdGhlIHdob2xlIGNvbW1hbmQgY2xvc2VkICh0aGUgZGVzdFxuICAvLyBtYXBwaW5nIGlzIHBlci1zb3VyY2UsIHNvIGFuIHVua25vd2FibGUgc291cmNlIG1ha2VzIHRoZSBkZXN0cyB1bmtub3dhYmxlKS5cbiAgY29uc3Qgc291cmNlUGF0aHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3Qgc291cmNlIG9mIHBhcnRzLm9wZXJhbmRzLnNsaWNlKDAsIHBhcnRzLnRhcmdldERpciA9PT0gbnVsbCA/IC0xIDogdW5kZWZpbmVkKSkge1xuICAgIGlmIChzb3VyY2UuZW5kc1dpdGgoJy8nKSkgcmV0dXJuO1xuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgc3BlYy5pZGlvbSwgc291cmNlLCBkaXIpO1xuICAgIGlmIChhYnNvbHV0ZVBhdGggPT09IG51bGwpIHJldHVybjtcbiAgICBpZiAoaXNFeGlzdGluZ0RpcmVjdG9yeShhYnNvbHV0ZVBhdGgpKSByZXR1cm47XG4gICAgc291cmNlUGF0aHMucHVzaChhYnNvbHV0ZVBhdGgpO1xuICB9XG4gIGlmIChzb3VyY2VQYXRocy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICBsZXQgZGVzdFBhdGhzOiBzdHJpbmdbXTtcbiAgaWYgKHBhcnRzLnRhcmdldERpciAhPT0gbnVsbCkge1xuICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShwYXJ0cy50YXJnZXREaXIpKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCBzcGVjLmlkaW9tLCBwYXJ0cy50YXJnZXREaXIsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoIXBhcnRzLnRhcmdldERpci5lbmRzV2l0aCgnLycpICYmICFpc0V4aXN0aW5nRGlyZWN0b3J5KHJlc29sdmVQYXRoKGRpciwgcGFydHMudGFyZ2V0RGlyKSkpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsIHNwZWMuaWRpb20sIHBhcnRzLnRhcmdldERpciwgJ3RoZSAtdCB0YXJnZXQgaXMgbm90IGFuIGV4aXN0aW5nIGRpcmVjdG9yeScpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB0YXJnZXRBYnMgPSByZXNvbHZlUGF0aChkaXIsIHBhcnRzLnRhcmdldERpcik7XG4gICAgZGVzdFBhdGhzID0gc291cmNlUGF0aHMubWFwKChwKSA9PiBqb2luUGF0aCh0YXJnZXRBYnMsIGJhc2VuYW1lKHApKSk7XG4gIH0gZWxzZSB7XG4gICAgY29uc3QgZGVzdCA9IHBhcnRzLm9wZXJhbmRzW3BhcnRzLm9wZXJhbmRzLmxlbmd0aCAtIDFdO1xuICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShkZXN0KSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgc3BlYy5pZGlvbSwgZGVzdCwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGRlc3RBYnMgPSByZXNvbHZlUGF0aChkaXIsIGRlc3QpO1xuICAgIGNvbnN0IGRlc3RJc0RpciA9IGRlc3QuZW5kc1dpdGgoJy8nKSB8fCBpc0V4aXN0aW5nRGlyZWN0b3J5KGRlc3RBYnMpO1xuICAgIGlmIChzb3VyY2VQYXRocy5sZW5ndGggPiAxICYmICFkZXN0SXNEaXIpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsIHNwZWMuaWRpb20sIGRlc3QsICdhIG11bHRpLXNvdXJjZSBjb3B5L21vdmUgbmVlZHMgYSBkaXJlY3RvcnkgZGVzdGluYXRpb24nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZGVzdFBhdGhzID0gZGVzdElzRGlyID8gc291cmNlUGF0aHMubWFwKChwKSA9PiBqb2luUGF0aChkZXN0QWJzLCBiYXNlbmFtZShwKSkpIDogW2Rlc3RBYnNdO1xuICB9XG5cbiAgZm9yIChsZXQgayA9IDA7IGsgPCBzb3VyY2VQYXRocy5sZW5ndGg7IGsrKykge1xuICAgIGVtaXRTb3VyY2VTcGFuKHJlc3VsdHMsIHNwZWMsIHNvdXJjZVBhdGhzW2tdLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4pO1xuICB9XG4gIGZvciAobGV0IGsgPSAwOyBrIDwgc291cmNlUGF0aHMubGVuZ3RoOyBrKyspIHtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206IHNwZWMuaWRpb20sXG4gICAgICBzcGFuOiB7IG9wZXJhdGlvbjogc3BlYy5kZXN0T3BlcmF0aW9uLCBhYnNvbHV0ZVBhdGg6IGRlc3RQYXRoc1trXSwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICB9KTtcbiAgfVxufVxuXG5jb25zdCBSTV9OT19WQUxVRSA9IG5ldyBTZXQoWyctZicsICctaScsICctdiddKTtcbi8qKiBgcm1gL2BnaXQgcm1gIGZsYWdzIHdob3NlIHNlbWFudGljcyBhcmUgb3V0IG9mIHNjb3BlOiByZWN1cnNpdmUgcmVtb3ZhbCBhbmQgcm1kaXIuICovXG5jb25zdCBSTV9FWENMVURFRCA9IG5ldyBTZXQoWyctcicsICctUicsICctLXJlY3Vyc2l2ZScsICctZCddKTtcbi8qKiBgZ2l0IHJtYCBhZGRzIHRoZSBkcnktcnVuIGZvcm0gdG8gdGhlIGV4Y2x1c2lvbnMuICovXG5jb25zdCBHSVRfUk1fRVhDTFVERUQgPSBuZXcgU2V0KFsnLXInLCAnLVInLCAnLS1yZWN1cnNpdmUnLCAnLWQnLCAnLW4nLCAnLS1kcnktcnVuJ10pO1xuXG4vKipcbiAqIFRoZSBzaGFyZWQgcm0vZ2l0IHJtIG9wZXJhbmQgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjUpOiBhIHJlY3Vyc2l2ZS9ybWRpciBmbGFnIChvclxuICogYC0tY2FjaGVkYCBmb3IgZ2l0IHJtIFx1MjAxNCB0aGUgd29ya3RyZWUgZmlsZSBzdXJ2aXZlcykgZXhjbHVkZXMgdGhlIHdob2xlXG4gKiBjb21tYW5kOyBlYWNoIHJlbWFpbmluZyBmaWxlLXNoYXBlZCBvcGVyYW5kIGlzIGEgZGVsZXRlLCBhbmQgYVxuICogZGlyZWN0b3J5LXNoYXBlZCBvcGVyYW5kIGZhaWxzIGNsb3NlZC5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hSbU9wZXJhbmRzKFxuICBhcmdzOiBzdHJpbmdbXSxcbiAgZXhjbHVkZWQ6IFJlYWRvbmx5U2V0PHN0cmluZz4sXG4gIGV4Y2x1ZGVDYWNoZWQ6IGJvb2xlYW4sXG4gIGRpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcbiAgY29uc3Qgb3BlcmFuZHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgYSBvZiBhcmdzKSB7XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChleGNsdWRlZC5oYXMoYSkgfHwgKGV4Y2x1ZGVDYWNoZWQgJiYgYSA9PT0gJy0tY2FjaGVkJykpIHJldHVybjtcbiAgICBpZiAoUk1fTk9fVkFMVUUuaGFzKGEpKSBjb250aW51ZTtcbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlOyAvLyB1bmtub3duIG9wdGlvbiBcdTIxOTIgdHJlYXRlZCBhcyBhbiBvcHRpb25cbiAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICB9XG4gIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBvcGVyYW5kcykge1xuICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShvcGVyYW5kKSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3JtLXdyaXRlJywgb3BlcmFuZCwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKG9wZXJhbmQuZW5kc1dpdGgoJy8nKSB8fCBpc0V4aXN0aW5nRGlyZWN0b3J5KHJlc29sdmVQYXRoKGRpciwgb3BlcmFuZCkpKSBjb250aW51ZTtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206ICdybS13cml0ZScsXG4gICAgICBzcGFuOiB7IG9wZXJhdGlvbjogJ2RlbGV0ZScsIGFic29sdXRlUGF0aDogcmVzb2x2ZVBhdGgoZGlyLCBvcGVyYW5kKSwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIFN0YXRpY2FsbHkgZXZhbHVhdGUgYW4gYWJzb2x1dGUgYHRydW5jYXRlIC1zYCBzaXplIChwbGFuIFx1MDBBNzUuNSk6IGEgcGxhaW5cbiAqIGludGVnZXIgd2l0aCBhbiBvcHRpb25hbCBLL00vRyBzdWZmaXguIFJlbGF0aXZlIHNpemVzIChgLXMgK05gL2AtcyAtTmApLFxuICogYC1yIHJlZmAgdmFsdWVzLCBhbmQgc2hlbGwtZXhwYW5kZWQgdmFsdWVzIGRlcGVuZCBvbiBydW50aW1lIHN0YXRlIFx1MjE5MlxuICogdW5kZWZpbmVkICh0aG9zZSBzcGFucyBnYXRlIGV4aXN0ZW5jZS1vbmx5KS5cbiAqL1xuZnVuY3Rpb24gZXZhbHVhdGVTdGF0aWNTaXplKHZhbHVlOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBudW1iZXIgfCB1bmRlZmluZWQge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3QgbSA9IHZhbHVlLm1hdGNoKC9eKFxcZCspKFtLTUddKT8kLyk7XG4gIGlmIChtID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCBiYXNlID0gTnVtYmVyLnBhcnNlSW50KG1bMV0sIDEwKTtcbiAgY29uc3QgbXVsdCA9IG1bMl0gPT09ICdLJyA/IDEwMjQgOiBtWzJdID09PSAnTScgPyAxMDI0ICoqIDIgOiBtWzJdID09PSAnRycgPyAxMDI0ICoqIDMgOiAxO1xuICByZXR1cm4gYmFzZSAqIG11bHQ7XG59XG5cbi8qKlxuICogVGhlIHRydW5jYXRlIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS41KTogYC1zIFNJWkVgL2AtciByZWZgIGFyZSB2YWx1ZS10YWtpbmcgXHUyMDE0IHRoZVxuICogc2l6ZSB2YWx1ZSBtYXkgaXRzZWxmIGxlYWQgd2l0aCBgLWAgKGB0cnVuY2F0ZSAtcyAtMTAgZmApIFx1MjAxNCBhbmQgYC1jYCBpc1xuICogY29tcGF0aWJsZS4gV2l0aG91dCBgLXNgL2AtcmAgdGhlIGNvbW1hbmQgY2hhbmdlcyBub3RoaW5nIFx1MjE5MiBubyB0b3VjaC4gRWFjaFxuICogZmlsZS1zaGFwZWQgb3BlcmFuZCBpcyBhIHRydW5jYXRlOyBhbiBhYnNvbHV0ZSBgLXMgTmAgY2FycmllcyB0aGUgc3RhdGljYWxseVxuICogZXZhbHVhdGVkIHNpemUgb24gdGhlIHNwYW4gKHRoZSBcdTAwQTczIGBzaXplYCBnYXRlJ3MgcG9zdC1jb21tYW5kIGJ5dGUgY291bnQsXG4gKiBgLXMgMGAgXHUyMTkyIGVtcHR5KSwgcmVsYXRpdmUgc2l6ZXMgYW5kIGAtciByZWZgIHN0YXkgZXhpc3RlbmNlLW9ubHkuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoVHJ1bmNhdGVPcGVyYW5kcyhcbiAgYXJnczogc3RyaW5nW10sXG4gIGRpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgbGV0IHNhd1NpemVGbGFnID0gZmFsc2U7XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG4gIGxldCBzdGF0aWNTaXplOiBudW1iZXIgfCB1bmRlZmluZWQ7XG4gIGNvbnN0IG9wZXJhbmRzOiBBcnJheTx7IHBhdGg6IHN0cmluZzsgc2l6ZTogbnVtYmVyIHwgdW5kZWZpbmVkIH0+ID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYXJncy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmdzW2ldO1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBvcGVyYW5kcy5wdXNoKHsgcGF0aDogYSwgc2l6ZTogc3RhdGljU2l6ZSB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctcycpIHtcbiAgICAgIHNhd1NpemVGbGFnID0gdHJ1ZTtcbiAgICAgIHN0YXRpY1NpemUgPSBldmFsdWF0ZVN0YXRpY1NpemUoYXJnc1tpICsgMV0pO1xuICAgICAgaSArPSAxOyAvLyBjb25zdW1lIHRoZSBzaXplIHZhbHVlLCBldmVuIHdoZW4gaXQgbGVhZHMgd2l0aCBgLWBcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1yJykge1xuICAgICAgc2F3U2l6ZUZsYWcgPSB0cnVlO1xuICAgICAgc3RhdGljU2l6ZSA9IHVuZGVmaW5lZDsgLy8gdGhlIGxhc3Qgc2l6ZSBvcHRpb24gd2luczsgYSByZWYgaGFzIG5vIHN0YXRpYyB2YWx1ZVxuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWMnKSBjb250aW51ZTtcbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlOyAvLyB1bmtub3duIG9wdGlvbiBcdTIxOTIgdHJlYXRlZCBhcyBhbiBvcHRpb25cbiAgICBvcGVyYW5kcy5wdXNoKHsgcGF0aDogYSwgc2l6ZTogc3RhdGljU2l6ZSB9KTtcbiAgfVxuICBpZiAoIXNhd1NpemVGbGFnKSByZXR1cm47XG4gIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBvcGVyYW5kcykge1xuICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShvcGVyYW5kLnBhdGgpKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAndHJ1bmNhdGUtY29tbWFuZCcsIG9wZXJhbmQucGF0aCwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKG9wZXJhbmQucGF0aC5lbmRzV2l0aCgnLycpIHx8IGlzRXhpc3RpbmdEaXJlY3RvcnkocmVzb2x2ZVBhdGgoZGlyLCBvcGVyYW5kLnBhdGgpKSkgY29udGludWU7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiAndHJ1bmNhdGUtY29tbWFuZCcsXG4gICAgICBzcGFuOiB7XG4gICAgICAgIG9wZXJhdGlvbjogJ3RydW5jYXRlJyxcbiAgICAgICAgYWJzb2x1dGVQYXRoOiByZXNvbHZlUGF0aChkaXIsIG9wZXJhbmQucGF0aCksXG4gICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgam9pbixcbiAgICAgICAgLi4uKG9wZXJhbmQuc2l6ZSAhPT0gdW5kZWZpbmVkID8geyBzaXplOiBvcGVyYW5kLnNpemUgfSA6IHt9KVxuICAgICAgfVxuICAgIH0pO1xuICB9XG59XG5cbi8qKlxuICogVGhlIHJtL2dpdCBybS90cnVuY2F0ZSBmYW1pbHkgKHBsYW4gXHUwMEE3NS41KTogYHJtYC9gZ2l0IHJtYCBvcGVyYW5kcyBhcmVcbiAqIGRlbGV0ZXMsIGB0cnVuY2F0ZWAgb3BlcmFuZHMgYXJlIHRydW5jYXRpb25zIChvbmx5IHdoZW4gYC1zYC9gLXJgIGlzXG4gKiBwcmVzZW50KS4gYGdpdCBybSAtLWNhY2hlZGAgdG91Y2hlcyBub3RoaW5nLlxuICovXG5mdW5jdGlvbiBtYXRjaFJtVHJ1bmNhdGUoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBkaXJGb3JSZXNvbHV0aW9uOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCByZXN0ID0gc3RyaXBUcmFuc3BhcmVudFdyYXBwZXIoYXJndik7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICBjb25zdCBjb21tYW5kID0gcmVzdFswXTtcbiAgaWYgKGNvbW1hbmQgPT09ICdybScpIHtcbiAgICBtYXRjaFJtT3BlcmFuZHMocmVzdC5zbGljZSgxKSwgUk1fRVhDTFVERUQsIGZhbHNlLCBkaXJGb3JSZXNvbHV0aW9uLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoY29tbWFuZCA9PT0gJ3RydW5jYXRlJykge1xuICAgIG1hdGNoVHJ1bmNhdGVPcGVyYW5kcyhyZXN0LnNsaWNlKDEpLCBkaXJGb3JSZXNvbHV0aW9uLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoY29tbWFuZCA9PT0gJ2dpdCcpIHtcbiAgICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChyZXN0LnNsaWNlKDEpKTtcbiAgICBpZiAoc3ViICE9PSBudWxsICYmIHN1Yi5zdWJjb21tYW5kID09PSAncm0nKSB7XG4gICAgICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUpIHtcbiAgICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3JtLXdyaXRlJywgJ3JtJywgJ2dpdCAtQyB0YXJnZXQgY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZScpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBtYXRjaFJtT3BlcmFuZHMoXG4gICAgICAgIHJlc3Quc2xpY2UoMSkuc2xpY2Uoc3ViLnN1YklkeCArIDEpLFxuICAgICAgICBHSVRfUk1fRVhDTFVERUQsXG4gICAgICAgIHRydWUsXG4gICAgICAgIHN1Yi5jRGlyID8/IGRpckZvclJlc29sdXRpb24sXG4gICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgam9pbixcbiAgICAgICAgcmVzdWx0c1xuICAgICAgKTtcbiAgICB9XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChGT1JFSUdOX1dSQVBQRVJTLmhhcyhjb21tYW5kKSkge1xuICAgIGNvbnN0IHdyYXBwZWQgPSByZXN0WzFdO1xuICAgIGlmICh3cmFwcGVkID09PSAncm0nIHx8IHdyYXBwZWQgPT09ICd0cnVuY2F0ZScpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKFxuICAgICAgICByZXN1bHRzLFxuICAgICAgICB3cmFwcGVkID09PSAncm0nID8gJ3JtLXdyaXRlJyA6ICd0cnVuY2F0ZS1jb21tYW5kJyxcbiAgICAgICAgd3JhcHBlZCxcbiAgICAgICAgYHRoZSAke2NvbW1hbmR9IHdyYXBwZXIgb2JzY3VyZXMgdGhlICR7d3JhcHBlZH0gYXJndmBcbiAgICAgICk7XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogV2hldGhlciB0aGUgYm9keSBvZiBhbiB1bnF1b3RlZCBoZXJlZG9jIGlzIHNoZWxsLWxpdGVyYWwuIFRoZSBzaGVsbCBleHBhbmRzXG4gKiBgJGAgYW5kIGJhY2t0aWNrIHN1YnN0aXR1dGlvbnMgYW5kIHByb2Nlc3NlcyBiYWNrc2xhc2ggZXNjYXBlcyAoYFxcJGAsIGBgIFxcYCBgYCxcbiAqIGBcXFxcYCwgYmFja3NsYXNoLW5ld2xpbmUpIGluIGFuIHVucXVvdGVkIGJvZHkgYmVmb3JlIHRoZSBob3N0IHJlYWRzIGl0OyBhXG4gKiBiYXJlIGJhY2tzbGFzaCBiZWZvcmUgYW55IG90aGVyIGNoYXIgc3Vydml2ZXMgbGl0ZXJhbGx5LiBBIHF1b3RlZCBkZWxpbWl0ZXJcbiAqIG1ha2VzIHRoZSBib2R5IGxpdGVyYWwgcmVnYXJkbGVzcyBcdTIwMTQgY2hlY2tlZCBieSB0aGUgY2FsbGVyLlxuICovXG5mdW5jdGlvbiBoZXJlZG9jQm9keUlzTGl0ZXJhbChib2R5OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgaWYgKGJvZHkuaW5jbHVkZXMoJyQnKSB8fCBib2R5LmluY2x1ZGVzKCdgJykpIHJldHVybiBmYWxzZTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBib2R5Lmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKGJvZHlbaV0gIT09ICdcXFxcJykgY29udGludWU7XG4gICAgY29uc3QgbmV4dCA9IGJvZHlbaSArIDFdO1xuICAgIGlmIChuZXh0ID09PSB1bmRlZmluZWQgfHwgbmV4dCA9PT0gJyQnIHx8IG5leHQgPT09ICdgJyB8fCBuZXh0ID09PSAnXFxcXCcgfHwgbmV4dCA9PT0gJ1xcbicpIHJldHVybiBmYWxzZTtcbiAgICBpICs9IDE7XG4gIH1cbiAgcmV0dXJuIHRydWU7XG59XG5cbi8qKlxuICogVGhlIGhlcmVkb2Mgd3JpdGUgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjIpIGZvciB0aGUgaG9zdCBmYW1pbGllcyB3aG9zZSBib2RpZXMgYXJlXG4gKiBjb250ZW50OiBgY2F0YCAoYm9keSBcdTIxOTIgdGhlIGNvbnRlbnQgcmVkaXJlY3RzKSwgYHRlZWAgKGJvZHkgXHUyMTkyIHRoZSBvcGVyYW5kcyksXG4gKiBhbmQgYHBhdGNoYC9gZ2l0IGFwcGx5YCAoYm9keSBcdTIxOTIgcGF0Y2ggdGV4dCwgXHUwMEE3NS43KS4gQW55IG90aGVyIGhvc3QncyBoZXJlZG9jXG4gKiBib2R5IGlzIG5vdCBhdHRyaWJ1dGFibGUgY29udGVudCBcdTIwMTQgc3RkaW4tb25seSBhbmQgbm9uLWZhbWlseSBjb21tYW5kc1xuICogKGBweXRob24zIC0gPDxFT0YgPiBvdXRgLCBgbHMgPiBvdXQgPDxFT0ZgKSBnZXQgbm8gd3JpdGUgdG91Y2gsIGFuZFxuICogcmVhZC1mYW1pbHkgY29tbWFuZHMgKGBzZWQgLW4gJzEsMnAnIDw8RU9GYCkgZmFsbCB0aHJvdWdoIHRvIHRoZSByZWFkXG4gKiBtYXRjaGVycy4gRW1wdHkgYD4+YC1ib2RpZXMgYXBwZW5kIG5vdGhpbmcgYW5kIHRvdWNoIG5vdGhpbmc7IGVtcHR5IGA+YC1ib2RpZXNcbiAqIHRydW5jYXRlICh3aG9sZS1maWxlLCB0aGUgRjIgcnVsZSkuXG4gKlxuICogQm9keSB0aHJlYWRpbmc6IGA+PmAgYXBwZW5kcyBhbmQgYD5gIG92ZXJ3cml0ZXMgdGhyZWFkIHRoZSBib2R5IHdoZW4gdGhlXG4gKiBjb250ZW50IHJlZGlyZWN0IGlzIHNpbmdsZSBhbmQgcGxhaW4gXHUyMDE0IHRoZSBleGFjdCBnYXRlJ3MgcG9zdC1jb250ZW50IG9uIHRoZVxuICogb3ZlcndyaXRlICh0aGUgdHJhaWxpbmcgYFxcbmAgdGhlIGV4dHJhY3Rpb24gc3RyaXBzIGlzIHJlc3RvcmVkLCBzaW5jZSB0aGVcbiAqIGdhdGUgY29tcGFyZXMgZnVsbCBmaWxlIGJ5dGVzKSwgdGhlIHN1ZmZpeCBnYXRlJ3MgYm9keSBvbiB0aGUgYXBwZW5kIChwbGFuXG4gKiBcdTAwQTczIHN0ZXAgMWIgbGlzdHMgXCJ0ZWUvaGVyZWRvYyB3aXRoIGEgbGl0ZXJhbCBib2R5XCIgaW4gdGhlIGV4YWN0IGNsYXNzKS5cbiAqIEFuIHVucXVvdGVkIGRlbGltaXRlciBsZXRzIHRoZSBzaGVsbCBleHBhbmQgdGhlIGJvZHkgYmVmb3JlIHRoZSBob3N0IHJlYWRzXG4gKiBpdCwgc28gb25seSBhIGxpdGVyYWwgYm9keSAobm8gYCRgLCBiYWNrdGljaywgb3Igc2hlbGwtcHJvY2Vzc2VkIGJhY2tzbGFzaClcbiAqIHRocmVhZHMgXHUyMDE0IGFuIGV4cGFuZGFibGUgb25lIGRlZ3JhZGVzIHRvIHRoZSBleGlzdGVuY2UtZ2F0ZWQgYWR2aXNvcnkgY2xhc3NcbiAqIHJhdGhlciB0aGFuIHJpc2sgYSBkZWNpc2l2ZS1mYWlsIG9uIGNvbnRlbnQgdGhhdCBuZXZlciByZWFjaGVkIHRoZSBmaWxlLlxuICovXG5mdW5jdGlvbiBjbGFzc2lmeUhlcmVkb2NPcGVuZXIoXG4gIG9wZW5lcjogc3RyaW5nLFxuICBib2R5OiBzdHJpbmcsXG4gIHF1b3RlZERlbGltOiBib29sZWFuLFxuICBjdXJyZW50RGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCBib2R5TGl0ZXJhbCA9IHF1b3RlZERlbGltIHx8IGhlcmVkb2NCb2R5SXNMaXRlcmFsKGJvZHkpO1xuICBjb25zdCB0b2tlbnMgPSB0b2tlbml6ZShzdHJpcExlYWRpbmdBc3NpZ25tZW50cyhvcGVuZXIpLnRyaW0oKSk7XG4gIGlmICh0b2tlbnMgPT09IG51bGwpIHJldHVybjtcbiAgY29uc3QgeyBhcmd2LCByZWRpcmVjdHMgfSA9IGFuYWx5emVUb2tlbnModG9rZW5zKTtcbiAgY29uc3QgaG9zdCA9IGFyZ3ZbMF07XG4gIGNvbnN0IGNvbnRlbnRSZWRpcmVjdHMgPSByZWRpcmVjdHMuZmlsdGVyKGlzQ29udGVudFJlZGlyZWN0KTtcbiAgY29uc3Qgc2luZ2xlUGxhaW5BcHBlbmQgPSBjb250ZW50UmVkaXJlY3RzLmxlbmd0aCA9PT0gMSAmJiBjb250ZW50UmVkaXJlY3RzWzBdLm9wID09PSAnPj4nO1xuICBjb25zdCBzaW5nbGVQbGFpbk92ZXJ3cml0ZSA9IGNvbnRlbnRSZWRpcmVjdHMubGVuZ3RoID09PSAxICYmIGNvbnRlbnRSZWRpcmVjdHNbMF0ub3AgPT09ICc+JztcblxuICBjb25zdCBlbWl0Q29udGVudFJlZGlyZWN0cyA9ICgpOiB2b2lkID0+IHtcbiAgICBmb3IgKGNvbnN0IHIgb2YgY29udGVudFJlZGlyZWN0cykge1xuICAgICAgaWYgKHIudGFyZ2V0ID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgJ2hlcmVkb2Mtd3JpdGUnLCByLnRhcmdldCwgY3VycmVudERpcik7XG4gICAgICBpZiAoYWJzb2x1dGVQYXRoID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgIGlmIChyLm9wID09PSAnPj4nIHx8IHIub3AgPT09ICcmPj4nKSB7XG4gICAgICAgIGlmIChib2R5Lmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgc3Bhbjoge1xuICAgICAgICAgICAgb3BlcmF0aW9uOiAnYXBwZW5kJyxcbiAgICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgICAuLi4oc2luZ2xlUGxhaW5BcHBlbmQgJiYgci5vcCA9PT0gJz4+JyAmJiBib2R5TGl0ZXJhbCA/IHsgd3JpdHRlbjogYm9keSB9IDoge30pXG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgc3BhbjpcbiAgICAgICAgICAgIGJvZHkubGVuZ3RoID09PSAwXG4gICAgICAgICAgICAgID8geyBvcGVyYXRpb246ICd0cnVuY2F0ZScsIGFic29sdXRlUGF0aCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICAgICAgICAgICAgOiB7XG4gICAgICAgICAgICAgICAgICBvcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJyxcbiAgICAgICAgICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgICAgICAgICAvLyBUaGUgZXhhY3QgZ2F0ZSBjb21wYXJlcyBmdWxsIGZpbGUgYnl0ZXMsIHNvIHRoZSB0cmFpbGluZ1xuICAgICAgICAgICAgICAgICAgLy8gYFxcbmAgdGhlIGV4dHJhY3Rpb24gc3RyaXBwZWQgY29tZXMgYmFjayBvbiB0aGUgb3ZlcndyaXRlLlxuICAgICAgICAgICAgICAgICAgLi4uKHNpbmdsZVBsYWluT3ZlcndyaXRlICYmIGJvZHlMaXRlcmFsID8geyB3cml0dGVuOiBgJHtib2R5fVxcbmAgfSA6IHt9KVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICB9O1xuXG4gIGlmIChob3N0ID09PSAnY2F0Jykge1xuICAgIGVtaXRDb250ZW50UmVkaXJlY3RzKCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChob3N0ID09PSAndGVlJykge1xuICAgIGNvbnN0IHBhcnRzID0gdGVlT3BlcmFuZFBhcnRzKGFyZ3YpO1xuICAgIGlmIChwYXJ0cyAhPT0gbnVsbCkge1xuICAgICAgZm9yIChjb25zdCBvcGVyYW5kIG9mIHBhcnRzLm9wZXJhbmRzKSB7XG4gICAgICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgJ2hlcmVkb2Mtd3JpdGUnLCBvcGVyYW5kLCBjdXJyZW50RGlyKTtcbiAgICAgICAgaWYgKGFic29sdXRlUGF0aCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgICAgIGlmIChwYXJ0cy5hcHBlbmQpIHtcbiAgICAgICAgICBpZiAoYm9keS5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgICAgICBpZGlvbTogJ2hlcmVkb2Mtd3JpdGUnLFxuICAgICAgICAgICAgc3Bhbjoge1xuICAgICAgICAgICAgICBvcGVyYXRpb246ICdhcHBlbmQnLFxuICAgICAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICAgICAgam9pbixcbiAgICAgICAgICAgICAgLi4uKGNvbnRlbnRSZWRpcmVjdHMubGVuZ3RoID09PSAwICYmIGJvZHlMaXRlcmFsID8geyB3cml0dGVuOiBib2R5IH0gOiB7fSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICAgICAgaWRpb206ICdoZXJlZG9jLXdyaXRlJyxcbiAgICAgICAgICAgIHNwYW46XG4gICAgICAgICAgICAgIGJvZHkubGVuZ3RoID09PSAwXG4gICAgICAgICAgICAgICAgPyB7IG9wZXJhdGlvbjogJ3RydW5jYXRlJywgYWJzb2x1dGVQYXRoLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgICAgICAgICAgICAgIDoge1xuICAgICAgICAgICAgICAgICAgICBvcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJyxcbiAgICAgICAgICAgICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgICAgICAgICAgIGpvaW4sXG4gICAgICAgICAgICAgICAgICAgIC8vIFNhbWUgcmVzdG9yZWQtYFxcbmAgZXhhY3QgYm9keSBhcyB0aGUgcmVkaXJlY3QgYnJhbmNoOyBhXG4gICAgICAgICAgICAgICAgICAgIC8vIHRlZSBvcGVyYW5kIHdpdGggYSBjb250ZW50IHJlZGlyZWN0IHByZXNlbnQga2VlcHMgdGhlXG4gICAgICAgICAgICAgICAgICAgIC8vIHJlZGlyZWN0J3MgdGhyZWFkaW5nIG9ubHkgKG1pcnJvciBvZiB0aGUgYXBwZW5kIGJyYW5jaCkuXG4gICAgICAgICAgICAgICAgICAgIC4uLihjb250ZW50UmVkaXJlY3RzLmxlbmd0aCA9PT0gMCAmJiBib2R5TGl0ZXJhbCA/IHsgd3JpdHRlbjogYCR7Ym9keX1cXG5gIH0gOiB7fSlcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBlbWl0Q29udGVudFJlZGlyZWN0cygpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoaG9zdCA9PT0gJ3BhdGNoJyB8fCBob3N0ID09PSAnZ2l0Jykge1xuICAgIGNsYXNzaWZ5UGF0Y2hIZXJlZG9jKGFyZ3YsIGJvZHksIGN1cnJlbnREaXIsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiwgcmVzdWx0cyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIE5vbi1mYW1pbHkgaG9zdDogdGhlIGJvZHkgaXMgbm90IGF0dHJpYnV0YWJsZSBjb250ZW50IFx1MjAxNCBubyB3cml0ZSB0b3VjaC5cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUaGUgc2VkIC1pIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS42KSwgdGhlIGZpcnN0IGNvbnN1bWVyIG9mIGV4YWN0IHJhbmdlczogYVxuLy8gc3Vic3RpdHV0aW9uLW9ubHkgc2NyaXB0IHdpdGggbnVtZXJpYyBhZGRyZXNzZXMgbW9kaWZpZXMgdGhlIGFkZHJlc3NlZFxuLy8gbGluZXM7IGFueXRoaW5nIGxlc3Mgc3RhdGljYWxseSBjZXJ0YWluIGlzIGEgd2hvbGUtZmlsZSBtb2RpZnkuIFRoZVxuLy8gc3VmZml4L3NjcmlwdCBkaXNhbWJpZ3VhdGlvbiBhbmQgdGhlIHNlZ21lbnQgY2xhc3NpZmljYXRpb24gYmVsb3cgYXJlIHRoZVxuLy8gd2hvbGUgb2YgaXQgXHUyMDE0IGV2ZXJ5dGhpbmcgZWxzZSBmb2xsb3dzIHRoZSBzaGFyZWQgXHUwMEE3NSBmYWlsLWNsb3NlZCBydWxlcy5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogQSBudW1lcmljLWFkZHJlc3NlZCBzdWJzdGl0dXRpb24gc2VnbWVudCAoYE5gLCBgTixNYCkgXHUyMDE0IHRoZSBvbmx5IGZvcm0gd2l0aCBhbiBleGFjdCByYW5nZS4gKi9cbmNvbnN0IE5VTUVSSUNfU1VCU1RJVFVUSU9OID0gL14oXFxkKykoPzosKFxcZCspKT9bc3ldLztcblxuLyoqIEFuIHVuYWRkcmVzc2VkIHN1YnN0aXR1dGlvbiBzZWdtZW50IFx1MjAxNCBsaW5lLWNvdW50LXByZXNlcnZpbmcsIHdob2xlIGZpbGUgYWRkcmVzc2VkLiAqL1xuY29uc3QgVU5SRVNUUklDVEVEX1NVQlNUSVRVVElPTiA9IC9eW3N5XS87XG5cbmZ1bmN0aW9uIG1hdGNoU2VkSW5wbGFjZShcbiAgYXJndjogc3RyaW5nW10sXG4gIGRpckZvclJlc29sdXRpb246IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHJlc3QgPSBzdHJpcFRyYW5zcGFyZW50V3JhcHBlcihhcmd2KTtcbiAgaWYgKHJlc3QubGVuZ3RoID09PSAwKSByZXR1cm47XG4gIGNvbnN0IGNvbW1hbmQgPSByZXN0WzBdO1xuICBpZiAoY29tbWFuZCA9PT0gJ3NlZCcpIHtcbiAgICBtYXRjaFNlZElucGxhY2VBcmdzKHJlc3Quc2xpY2UoMSksIGRpckZvclJlc29sdXRpb24sIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiwgcmVzdWx0cyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChGT1JFSUdOX1dSQVBQRVJTLmhhcyhjb21tYW5kKSkge1xuICAgIGNvbnN0IHdyYXBwZWQgPSByZXN0WzFdO1xuICAgIGlmICh3cmFwcGVkID09PSAnc2VkJykge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3NlZC1pbnBsYWNlJywgd3JhcHBlZCwgYHRoZSAke2NvbW1hbmR9IHdyYXBwZXIgb2JzY3VyZXMgdGhlICR7d3JhcHBlZH0gYXJndmApO1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFRoZSBzZWQgLWkgb3BlcmFuZCBncmFtbWFyOiBgLWlgIGJhcmUsIGAtaVNVRkZJWGAgYXR0YWNoZWQsIG9yIGEgc2VwYXJhdGVcbiAqIHN1ZmZpeCB3b3JkIHJlc29sdmVkIGJ5IHRoZSBzdGFuZGFyZCBkaXNhbWJpZ3VhdGlvbiBcdTIwMTQgdGhlIHdvcmQgYWZ0ZXIgYC1pYFxuICogaXMgdGhlIHN1ZmZpeCBvbmx5IHdoZW4gaXQgZG9lcyBub3Qgc3RhcnQgd2l0aCBgLWAsIGlzIG5vdCBzY3JpcHQtc2hhcGVkXG4gKiAoYSBzZWQgY29tbWFuZCBsZXR0ZXIgb3IgYW4gYWRkcmVzcyBzdGFydCBcdTIwMTQgYHMvYS9iL2AsIGAyZGAsIGAveC9kYCksIGFuZCBhXG4gKiBzY3JpcHQgcGx1cyBhdCBsZWFzdCBvbmUgZmlsZSBvcGVyYW5kIHN0aWxsIGZvbGxvdyBpdCAodGhlIEJTRFxuICogc2VwYXJhdGUtc3VmZml4IHJlYWRpbmc7IEdOVSdzIGF0dGFjaGVkLW9ubHkgcmVhZGluZyBvdGhlcndpc2UpLiBBXG4gKiBzY3JpcHQtc2hhcGVkIHdvcmQgaXMgdGhlIHNjcmlwdCB1bmRlciBHTlUncyByZWFkaW5nOiBgc2VkIC1pIHMvYS9iLyBmIGdgXG4gKiB3b3VsZCBvdGhlcndpc2Ugc3RlYWwgdGhlIGZpcnN0IGZpbGUgb3BlcmFuZCBhcyBhIHN1ZmZpeCBhbmQgc2lsZW50bHkgbWlzc1xuICogaXRzIHdyaXRlICh0aGUgbXVsdGktZmlsZS1zZWQgbWlzcGFyc2UpLiBBbiBhdHRhY2hlZCBvciBkaXNhbWJpZ3VhdGVkXG4gKiBzdWZmaXggaXMgYSBiYWNrdXA6IGEgbm9uLWVtcHR5IHN1ZmZpeCBlbWl0cyBhbiBhZGRpdGlvbmFsIGNyZWF0ZS1vdmVyd3JpdGVcbiAqIHRvdWNoIG9uIGA8ZmlsZT48U1VGRklYPmA7IGFuIGVtcHR5IHN1ZmZpeCAod2hpY2ggdGhlIHF1b3RlLWF3YXJlIHRva2VuaXplclxuICogZHJvcHMgZW50aXJlbHkgXHUyMDE0IGBzZWQgLWkgJycgZmAgYW5kIGBzZWQgLWkgZmAgdG9rZW5pemUgYWxpa2UpIGNyZWF0ZXMgbm9cbiAqIGJhY2t1cC5cbiAqXG4gKiBUaGUgc2NyaXB0IGlzIHRoZSBzY3JpcHQgYXJndW1lbnQgcGx1cyBldmVyeSBgLWVgIGFyZ3VtZW50LCBzcGxpdCBvbiBgO2AuXG4gKiBTZWdtZW50cyB0aGF0IGFyZSBhbGwgbnVtZXJpYy1hZGRyZXNzZWQgc3Vic3RpdHV0aW9ucyB5aWVsZCB0aGUgZXhhY3QgcmFuZ2VcbiAqIFttaW4gc3RhcnQsIG1pbihtYXggZW5kLCBFT0YpXSAocGVyIGZpbGUsIEVPRiBmcm9tIHRoZSBwb3N0LWVkaXQgY291bnQpO1xuICogc2VnbWVudHMgdGhhdCBhcmUgYWxsIHN1YnN0aXR1dGlvbnMgXHUyMDE0IGFueSBudW1lcmljL3VuYWRkcmVzc2VkIG1peCBcdTIwMTQgYXJlXG4gKiBzdGlsbCBsaW5lLWNvdW50LXByZXNlcnZpbmcsIHNvIHRoZSB3aG9sZSBmaWxlIGlzIGFkZHJlc3NlZCAoWzEsIEVPRl0pO1xuICogYW55IGNvdW50LWNoYW5naW5nLCBwYXR0ZXJuLWFkZHJlc3NlZCwgc3RlcCwgb3IgYCRgLWFkZHJlc3NlZCBzZWdtZW50IGlzIGFcbiAqIHdob2xlLWZpbGUgbW9kaWZ5IHdpdGggbm8gcmFuZ2UuIEFuIGFic2VudCBzY3JpcHQgKG5vIHNjcmlwdCBhcmd1bWVudCwgbm9cbiAqIGAtZWApIGlzIHVucmVzb2x2ZWQuXG4gKi9cbi8qKlxuICogQSB3b3JkIHRoYXQgY2FuIG9ubHkgYmUgYSBzZWQgc2NyaXB0LCBuZXZlciBhIEJTRCBzZXBhcmF0ZSBzdWZmaXg6IGEgc2VkXG4gKiBjb21tYW5kIGxldHRlciAoYHNgL2B5YC9gZGAvXHUyMDI2KSwgb3IgYW4gYWRkcmVzcyBzdGFydCAoZGlnaXQsIGAvYCwgYFxcYCwgYCRgLFxuICogYH5gKS4gVGhlIG11bHRpLWZpbGUgZm9ybSBgc2VkIC1pIHMvYS9iLyBmIGdgIHB1dHMgdGhlIHNjcmlwdCBpbW1lZGlhdGVseVxuICogYWZ0ZXIgYmFyZSBgLWlgIChHTlUncyByZWFkaW5nOyB0aGUgQlNEIHJlYWRpbmcgbmVlZHMgYSBzZXBhcmF0ZSBzdWZmaXhcbiAqIHdvcmQgZmlyc3QsIGFuZCBhIGxldHRlci1sZWFkaW5nIG9yIGFkZHJlc3MtbGVhZGluZyB3b3JkIGlzIG5vdCBvbmUpLlxuICovXG5jb25zdCBTRURfU0NSSVBUX1NIQVBFID0gL14oPzpbQS1aYS16XXxcXGR8XFwvfFxcXFx8XFwkfH4pLztcblxuZnVuY3Rpb24gbWF0Y2hTZWRJbnBsYWNlQXJncyhcbiAgYXJnczogc3RyaW5nW10sXG4gIGRpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgbGV0IHN1ZmZpeDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCBzYXdJbnBsYWNlID0gZmFsc2U7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgZVNjcmlwdHM6IHN0cmluZ1tdID0gW107XG4gIC8vIFRoZSBzY3JpcHQvZmlsZSBzcGxpdCBvZiB0aGUgcG9zaXRpb25hbHMgaXMgZGVyaXZlZCBhZnRlciB0aGUgc2NhbjogdGhlXG4gIC8vIGZpcnN0IHBvc2l0aW9uYWwgaXMgdGhlIHNjcmlwdCBhcmd1bWVudCBvbmx5IHdoZW4gbm8gYC1lYCBzY3JpcHQgZXhpc3RzIFx1MjAxNFxuICAvLyB3aXRoIGAtZWAgcHJlc2VudCBldmVyeSBwb3NpdGlvbmFsIGlzIGEgZmlsZSAoR05VIHNlZCByZWFkcyB0aGUgc2NyaXB0XG4gIC8vIGZyb20gYC1lYCB0aGVuLCBub3QgZnJvbSB0aGUgZmlyc3QgcG9zaXRpb25hbCkuXG4gIGNvbnN0IHBvc2l0aW9uYWxzOiBzdHJpbmdbXSA9IFtdO1xuICAvLyBGaWxlcyBwdXNoZWQgb3V0c2lkZSB0aGUgcG9zaXRpb25hbCBwYXRoOiBgc2VkIC1pIGZgIChzY3JpcHQgYWJzZW50KS5cbiAgY29uc3QgZmlsZXM6IHN0cmluZ1tdID0gW107XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG5cbiAgd2hpbGUgKGkgPCBhcmdzLmxlbmd0aCkge1xuICAgIGNvbnN0IGEgPSBhcmdzW2ldO1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBwb3NpdGlvbmFscy5wdXNoKGEpO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1uJykge1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWUnKSB7XG4gICAgICBjb25zdCB2ID0gYXJnc1tpICsgMV07XG4gICAgICBpZiAodiA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdzZWQtaW5wbGFjZScsIGEsICd0aGUgLWUgZmxhZyBpcyBsZWZ0IHZhbHVlbGVzcycpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBlU2NyaXB0cy5wdXNoKHYpO1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWknKSB7XG4gICAgICBzYXdJbnBsYWNlID0gdHJ1ZTtcbiAgICAgIGNvbnN0IHcgPSBhcmdzW2kgKyAxXTtcbiAgICAgIGlmICh3ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgLy8gYHNlZCAtaWAgd2l0aCBub3RoaW5nIGFmdGVyOiBubyBzdWZmaXgsIG5vIHNjcmlwdCBcdTIwMTQgdGhlIGFic2VudC1zY3JpcHRcbiAgICAgICAgLy8gY2hlY2sgYmVsb3cgcmVzb2x2ZXMgdGhpcyB1bnJlc29sdmVkLlxuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKHcuc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICAgIC8vIFRoZSB3b3JkIGFmdGVyIC1pIGlzIGFuIG9wdGlvbiwgbmV2ZXIgYSBzdWZmaXguXG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCByZXN0QWZ0ZXIgPSBhcmdzLnNsaWNlKGkgKyAyKTtcbiAgICAgIGlmIChyZXN0QWZ0ZXIubGVuZ3RoID49IDIgJiYgIVNFRF9TQ1JJUFRfU0hBUEUudGVzdCh3KSkge1xuICAgICAgICAvLyBUaGUgQlNEIHNlcGFyYXRlLXN1ZmZpeCByZWFkaW5nOiB3IGlzIHRoZSBzdWZmaXgsIGFuZCBhIHNjcmlwdCBwbHVzXG4gICAgICAgIC8vIGF0IGxlYXN0IG9uZSBmaWxlIG9wZXJhbmQgc3RpbGwgZm9sbG93IFx1MjAxNCBvbmx5IGZvciBhIHN1ZmZpeC1zaGFwZWRcbiAgICAgICAgLy8gd29yZCAoYC5iYWtgLCBgJydgKS4gQSBzY3JpcHQtc2hhcGVkIHdvcmQgaXMgdGhlIHNjcmlwdCB1bmRlciBHTlUnc1xuICAgICAgICAvLyByZWFkaW5nLCBzbyBgc2VkIC1pIHMvYS9iLyBmIGdgIHRyZWF0cyBgcy9hL2IvYCBhcyB0aGUgc2NyaXB0IGFuZFxuICAgICAgICAvLyBib3RoIGYgYW5kIGcgYXMgZmlsZXMuXG4gICAgICAgIHN1ZmZpeCA9IHc7XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAocmVzdEFmdGVyLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAvLyBgc2VkIC1pIGZgOiB3IGlzIHRoZSBsYXN0IHRva2VuIFx1MjAxNCBubyBzY3JpcHQgY2FuIGZvbGxvdywgc28gdyBpcyB0aGVcbiAgICAgICAgLy8gZmlsZSBvcGVyYW5kIHdpdGggdGhlIHNjcmlwdCBhYnNlbnQgKEdOVSBpbnN0ZWFkIHJlYWRzIHcgYXMgYSBzY3JpcHRcbiAgICAgICAgLy8gYW5kIGVycm9yczsgZWl0aGVyIHdheSB0aGUgZWRpdCBkb2VzIG5vdCBoYXBwZW4pLlxuICAgICAgICBmaWxlcy5wdXNoKHcpO1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgLy8gT25lIHRva2VuIGFmdGVyIHc6IHcgaXMgdGhlIHNjcmlwdCBhcmd1bWVudCAob3IgYSBmaWxlLCB3aGVuIGAtZWBcbiAgICAgIC8vIHNjcmlwdHMgYXJlIHByZXNlbnQpIGFuZCB0aGUgdG9rZW4gaXMgYSBmaWxlIFx1MjAxNCBjb25zdW1lIGJvdGgsIHNvXG4gICAgICAvLyBuZWl0aGVyIGZhbGxzIHRocm91Z2ggdG8gdGhlIHBvc2l0aW9uYWwgcGF0aCBhZ2Fpbi5cbiAgICAgIHBvc2l0aW9uYWxzLnB1c2godywgcmVzdEFmdGVyWzBdKTtcbiAgICAgIGkgKz0gMztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctaScpICYmIGEubGVuZ3RoID4gMikge1xuICAgICAgc2F3SW5wbGFjZSA9IHRydWU7XG4gICAgICBzdWZmaXggPSBhLnNsaWNlKDIpO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgLy8gVW5rbm93biBvcHRpb24gXHUyMDE0IG5ldmVyIGEgc2NyaXB0IG9yIGZpbGUuXG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgcG9zaXRpb25hbHMucHVzaChhKTtcbiAgICBpICs9IDE7XG4gIH1cblxuICBpZiAoIXNhd0lucGxhY2UpIHJldHVybjsgLy8gbm90IGFuIGluLXBsYWNlIGVkaXQgYXQgYWxsXG4gIGNvbnN0IHNjcmlwdEFyZyA9IGVTY3JpcHRzLmxlbmd0aCA9PT0gMCA/IChwb3NpdGlvbmFsc1swXSA/PyBudWxsKSA6IG51bGw7XG4gIGlmIChzY3JpcHRBcmcgIT09IG51bGwpIGZpbGVzLnB1c2goLi4ucG9zaXRpb25hbHMuc2xpY2UoMSkpO1xuICBlbHNlIGZpbGVzLnB1c2goLi4ucG9zaXRpb25hbHMpO1xuICBjb25zdCBzZWdtZW50czogc3RyaW5nW10gPSBbXTtcbiAgaWYgKHNjcmlwdEFyZyAhPT0gbnVsbCkgc2VnbWVudHMucHVzaCguLi5zY3JpcHRBcmcuc3BsaXQoJzsnKSk7XG4gIGZvciAoY29uc3QgcyBvZiBlU2NyaXB0cykgc2VnbWVudHMucHVzaCguLi5zLnNwbGl0KCc7JykpO1xuICBpZiAoc2VnbWVudHMubGVuZ3RoID09PSAwKSB7XG4gICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3NlZC1pbnBsYWNlJywgZmlsZXNbMF0gPz8gJ3NlZCcsICdubyBzY3JpcHQgKGFic2VudCBvciBlbXB0eSBzY3JpcHQgYXJndW1lbnQpJyk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gU2VnbWVudCBjbGFzc2lmaWNhdGlvbjogZXhhY3Qgd2hlbiBldmVyeSBzZWdtZW50IGlzIGEgbnVtZXJpYy1hZGRyZXNzZWRcbiAgLy8gc3Vic3RpdHV0aW9uOyBleHBsaWNpdCB3aG9sZS1maWxlIFsxLCBFT0ZdIHdoZW4gZXZlcnkgc2VnbWVudCBpcyBzdGlsbCBhXG4gIC8vIHN1YnN0aXR1dGlvbiAoYW55IHVuYWRkcmVzc2VkL251bWVyaWMgbWl4KTsgbm8gcmFuZ2Ugb3RoZXJ3aXNlLlxuICBsZXQgYWxsTnVtZXJpYyA9IHRydWU7XG4gIGxldCBhbGxTdWJzdGl0dXRpb24gPSB0cnVlO1xuICBsZXQgbWluU3RhcnQgPSBJbmZpbml0eTtcbiAgbGV0IG1heEVuZCA9IDA7XG4gIGZvciAoY29uc3Qgc2VnbWVudCBvZiBzZWdtZW50cykge1xuICAgIGNvbnN0IG0gPSBzZWdtZW50Lm1hdGNoKE5VTUVSSUNfU1VCU1RJVFVUSU9OKTtcbiAgICBpZiAobSA9PT0gbnVsbCkge1xuICAgICAgYWxsTnVtZXJpYyA9IGZhbHNlO1xuICAgICAgaWYgKCFVTlJFU1RSSUNURURfU1VCU1RJVFVUSU9OLnRlc3Qoc2VnbWVudCkpIGFsbFN1YnN0aXR1dGlvbiA9IGZhbHNlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IHMgPSBOdW1iZXIucGFyc2VJbnQobVsxXSwgMTApO1xuICAgIGNvbnN0IGUgPSBtWzJdID09PSB1bmRlZmluZWQgPyBzIDogTnVtYmVyLnBhcnNlSW50KG1bMl0sIDEwKTtcbiAgICBtaW5TdGFydCA9IE1hdGgubWluKG1pblN0YXJ0LCBzKTtcbiAgICBtYXhFbmQgPSBNYXRoLm1heChtYXhFbmQsIGUpO1xuICB9XG5cbiAgZm9yIChjb25zdCBmIG9mIGZpbGVzKSB7XG4gICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKGYpKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAnc2VkLWlucGxhY2UnLCBmLCAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlUGF0aChkaXIsIGYpO1xuICAgIGlmIChhbGxOdW1lcmljIHx8IGFsbFN1YnN0aXR1dGlvbikge1xuICAgICAgY29uc3QgdG90YWwgPSBjb3VudEZpbGVMaW5lcyhhYnNvbHV0ZVBhdGgpO1xuICAgICAgaWYgKHRvdGFsID09PSBudWxsKSB7XG4gICAgICAgIHB1c2hVbnJlc29sdmVkKFxuICAgICAgICAgIHJlc3VsdHMsXG4gICAgICAgICAgJ3NlZC1pbnBsYWNlJyxcbiAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgJ2NvdWxkIG5vdCBkZXRlcm1pbmUgZW5kLW9mLWZpbGUgbGluZSBjb3VudCAoZmlsZSB1bnJlYWRhYmxlLCBlbXB0eSwgb3IgbWlzc2luZyknXG4gICAgICAgICk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3Qgc3RhcnQgPSBhbGxOdW1lcmljID8gbWluU3RhcnQgOiAxO1xuICAgICAgY29uc3QgZW5kID0gYWxsTnVtZXJpYyA/IE1hdGgubWluKG1heEVuZCwgdG90YWwpIDogdG90YWw7XG4gICAgICBpZiAoc3RhcnQgPiBlbmQpIGNvbnRpbnVlOyAvLyB0aGUgYWRkcmVzc2VkIHJhbmdlIGxpZXMgYmV5b25kIEVPRiBcdTIwMTQgbm90aGluZyBpcyBtb2RpZmllZFxuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogJ3NlZC1pbnBsYWNlJyxcbiAgICAgICAgc3BhbjogeyBvcGVyYXRpb246ICdtb2RpZnknLCBsaW5lU3RhcnQ6IHN0YXJ0LCBsaW5lRW5kOiBlbmQsIGFic29sdXRlUGF0aCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiAnc2VkLWlucGxhY2UnLFxuICAgICAgICBzcGFuOiB7IG9wZXJhdGlvbjogJ21vZGlmeScsIGFic29sdXRlUGF0aCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICBpZiAoc3VmZml4ICE9PSBudWxsICYmIHN1ZmZpeCAhPT0gJycpIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgaWRpb206ICdzZWQtaW5wbGFjZScsXG4gICAgICAgIHNwYW46IHsgb3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZScsIGFic29sdXRlUGF0aDogYCR7YWJzb2x1dGVQYXRofSR7c3VmZml4fWAsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgICB9KTtcbiAgICB9XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUaGUgcGF0Y2ggLyBnaXQgYXBwbHkgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjcpLiBQYXRjaCB0ZXh0IHNvdXJjZXMsIGluIG9yZGVyIG9mXG4vLyByZWNvZ25pdGlvbjogYSBsaXRlcmFsIHBhdGNoLWZpbGUgb3BlcmFuZCAoYGdpdCBhcHBseSA8ZmlsZT5gIFx1MjAxNCBhIGBwYXRjaGBcbi8vIG9wZXJhbmQgaXMgYSB0YXJnZXQgZmlsZSwgbm90IGEgc291cmNlLCBhbmQgaXMgaWdub3JlZCksIHRoZSBzdGRpbiBgPGBcbi8vIHNvdXJjZSAoYHBhdGNoIC1wTiA8IGZpbGVgLCBgZ2l0IGFwcGx5IC0gPCBmaWxlYCksIG9yIGEgaGVyZWRvYyBib2R5XG4vLyAoY2xhc3NpZnlQYXRjaEhlcmVkb2MsIFx1MDBBNzUuMikuIFJlYWQtb25seSBtb2RlcyAoYC0tY2hlY2tgL2AtLXN0YXRgL1xuLy8gYC0tbnVtc3RhdGAvYC0tc3VtbWFyeWAsIGBwYXRjaCAtLWRyeS1ydW5gKSBhbmQgaW5kZXgtb25seSBgLS1jYWNoZWRgIHRvdWNoXG4vLyBub3RoaW5nOyBgLS1kaXJlY3RvcnlgIGZhaWxzIGNsb3NlZCAoaXQgcmV3cml0ZXMgcGF0Y2ggcGF0aHMpLiBBIGNvbW1hbmRcbi8vIHdpdGggbm8gc3RhdGljYWxseSBrbm93biBzb3VyY2UgKHBpcGVkIG9yIHRlcm1pbmFsIHN0ZGluLCBhIHZhcmlhYmxlIHBhdGNoXG4vLyBwYXRoKSBpcyB1bnJlc29sdmVkLiBUYXJnZXRzIGFuZCByYW5nZXMgY29tZSBmcm9tIHRoZSBuZXdcbi8vIHJhbmdlLXByZXNlcnZpbmcgdW5pZmllZC1kaWZmIHBhcnNlciAodW5pZmllZC1kaWZmLnRzKS5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogVGhlIHNoYXJlZCBgcGF0Y2hgL2BnaXQgYXBwbHlgIG9wdGlvbiBzdXJmYWNlIChwbGFuIFx1MDBBNzUuNyk6IHN0cmlwIGxldmVsLCByZWFkLW9ubHkgYW5kIGluZGV4LW9ubHkgbW9kZXMsIGAtLWRpcmVjdG9yeWAsIGFuZCBvcGVyYW5kcy4gKi9cbmludGVyZmFjZSBQYXRjaEFwcGx5UGFydHMge1xuICBzdHJpcDogUGF0aFN0cmlwO1xuICByZWFkT25seTogYm9vbGVhbjtcbiAgY2FjaGVkT25seTogYm9vbGVhbjtcbiAgZGlyZWN0b3J5OiBib29sZWFuO1xuICBvcGVyYW5kczogc3RyaW5nW107XG59XG5cbmZ1bmN0aW9uIHBhdGNoQXBwbHlQYXJ0cyhhcmdzOiBzdHJpbmdbXSwgaXNHaXRBcHBseTogYm9vbGVhbik6IFBhdGNoQXBwbHlQYXJ0cyB7XG4gIGxldCBzdHJpcDogUGF0aFN0cmlwID0gaXNHaXRBcHBseSA/IDEgOiAnYXV0byc7XG4gIGxldCByZWFkT25seSA9IGZhbHNlO1xuICBsZXQgY2FjaGVkT25seSA9IGZhbHNlO1xuICBsZXQgZGlyZWN0b3J5ID0gZmFsc2U7XG4gIGNvbnN0IG9wZXJhbmRzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgYWZ0ZXJEYXNoRGFzaCA9IGZhbHNlO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJnc1tpXTtcbiAgICBpZiAoYWZ0ZXJEYXNoRGFzaCkge1xuICAgICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGlzR2l0QXBwbHkpIHtcbiAgICAgIGlmIChhID09PSAnLS1jaGVjaycgfHwgYSA9PT0gJy0tc3RhdCcgfHwgYSA9PT0gJy0tbnVtc3RhdCcgfHwgYSA9PT0gJy0tc3VtbWFyeScpIHtcbiAgICAgICAgcmVhZE9ubHkgPSB0cnVlO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChhID09PSAnLS1jYWNoZWQnKSB7XG4gICAgICAgIGNhY2hlZE9ubHkgPSB0cnVlO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChhID09PSAnLS1pbmRleCcgfHwgYSA9PT0gJy1SJyB8fCBhID09PSAnLS1yZXZlcnNlJyB8fCBhID09PSAnLS11bnNhZmUtcGF0aHMnIHx8IGEgPT09ICctLXJlamVjdCcpIGNvbnRpbnVlO1xuICAgICAgaWYgKGEgPT09ICctLWRpcmVjdG9yeScpIHtcbiAgICAgICAgZGlyZWN0b3J5ID0gdHJ1ZTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYS5zdGFydHNXaXRoKCctLWRpcmVjdG9yeT0nKSkge1xuICAgICAgICBkaXJlY3RvcnkgPSB0cnVlO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChhID09PSAnLXAnKSB7XG4gICAgICAgIGNvbnN0IHYgPSBhcmdzW2kgKyAxXTtcbiAgICAgICAgaWYgKHYgIT09IHVuZGVmaW5lZCAmJiAvXlxcZCskLy50ZXN0KHYpKSB7XG4gICAgICAgICAgc3RyaXAgPSBOdW1iZXIucGFyc2VJbnQodiwgMTApO1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgfVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmICgvXi1wXFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgICAgc3RyaXAgPSBOdW1iZXIucGFyc2VJbnQoYS5zbGljZSgyKSwgMTApO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7XG4gICAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIHBhdGNoXG4gICAgaWYgKGEgPT09ICctLWRyeS1ydW4nKSB7XG4gICAgICByZWFkT25seSA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctTicgfHwgYSA9PT0gJy0tZm9yd2FyZCcpIGNvbnRpbnVlO1xuICAgIGlmIChhID09PSAnLXAnKSB7XG4gICAgICBjb25zdCB2ID0gYXJnc1tpICsgMV07XG4gICAgICBpZiAodiAhPT0gdW5kZWZpbmVkICYmIC9eXFxkKyQvLnRlc3QodikpIHtcbiAgICAgICAgc3RyaXAgPSBOdW1iZXIucGFyc2VJbnQodiwgMTApO1xuICAgICAgICBpICs9IDE7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eLXBcXGQrJC8udGVzdChhKSkge1xuICAgICAgc3RyaXAgPSBOdW1iZXIucGFyc2VJbnQoYS5zbGljZSgyKSwgMTApO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7XG4gICAgb3BlcmFuZHMucHVzaChhKTtcbiAgfVxuICByZXR1cm4geyBzdHJpcCwgcmVhZE9ubHksIGNhY2hlZE9ubHksIGRpcmVjdG9yeSwgb3BlcmFuZHMgfTtcbn1cblxuLyoqIFRoZSBwYXRjaCB0ZXh0IGF0IGBhYnNvbHV0ZVBhdGhgLCBvciBudWxsIHdoZW4gaXQgY2FuJ3QgYmUgcmVhZC4gKi9cbmZ1bmN0aW9uIHJlYWRQYXRjaEZpbGUoYWJzb2x1dGVQYXRoOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gcmVhZEZpbGVTeW5jKGFic29sdXRlUGF0aCwgJ3V0ZjgnKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqXG4gKiBFbWl0IHRoZSB3cml0ZSB0b3VjaGVzIGZvciBhIGBwYXRjaGAvYGdpdCBhcHBseWAgY29tbWFuZCB3aXRoIGEgc3RhdGljYWxseVxuICoga25vd24gcGF0Y2gtdGV4dCBzb3VyY2UuIGB0YXJnZXREaXJgIGlzIHdoZXJlIHRoZSBwYXRjaCdzIHRhcmdldCBwYXRoc1xuICogcmVzb2x2ZSAodGhlIGdpdCBgLUNgIGRpcmVjdG9yeSBmb3IgYGdpdCBhcHBseWAsIHRoZSBjdXJyZW50IGRpcmVjdG9yeVxuICogb3RoZXJ3aXNlKTsgYHNoZWxsRGlyYCBpcyB3aGVyZSB0aGUgc2hlbGwncyBzdGRpbiBgPGAgcmVkaXJlY3QgdGFyZ2V0XG4gKiByZXNvbHZlcyBcdTIwMTQgYSByZWRpcmVjdCBpcyBzaGVsbC1zaWRlLCBzbyBgZ2l0IC1DYCBuZXZlciBhZmZlY3RzIGl0LlxuICovXG5mdW5jdGlvbiBlbWl0UGF0Y2hUYXJnZXRzKFxuICBhcmdzOiBzdHJpbmdbXSxcbiAgaXNHaXRBcHBseTogYm9vbGVhbixcbiAgaG9zdDogc3RyaW5nLFxuICB0YXJnZXREaXI6IHN0cmluZyxcbiAgc2hlbGxEaXI6IHN0cmluZyxcbiAgcmVkaXJlY3RzOiBSZWRpcmVjdEluZm9bXSxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHBhcnRzID0gcGF0Y2hBcHBseVBhcnRzKGFyZ3MsIGlzR2l0QXBwbHkpO1xuICBpZiAocGFydHMucmVhZE9ubHkgfHwgcGFydHMuY2FjaGVkT25seSkgcmV0dXJuOyAvLyByZWFkLW9ubHkgLyBpbmRleC1vbmx5IFx1MjAxNCBubyB0b3VjaGVzXG4gIGlmIChwYXJ0cy5kaXJlY3RvcnkpIHtcbiAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCAnLS1kaXJlY3RvcnknLCAnLS1kaXJlY3RvcnkgcmV3cml0ZXMgcGF0Y2ggcGF0aHMnKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBsZXQgcGF0Y2hUZXh0OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgbGV0IHNvdXJjZTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIC8vIDEuIEEgbGl0ZXJhbCBwYXRjaC1maWxlIG9wZXJhbmQgKGdpdCBhcHBseSBvbmx5OyBhIHBhdGNoIG9wZXJhbmQgaXMgYVxuICAvLyAgICB0YXJnZXQgZmlsZSwgbm90IGEgc291cmNlIFx1MjAxNCBpZ25vcmVkKS5cbiAgaWYgKGlzR2l0QXBwbHkpIHtcbiAgICBjb25zdCBvcGVyYW5kID0gcGFydHMub3BlcmFuZHMuZmluZCgobykgPT4gbyAhPT0gJy0nKTtcbiAgICBpZiAob3BlcmFuZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAobG9va3NVbnJlc29sdmFibGUob3BlcmFuZCkpIHtcbiAgICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgb3BlcmFuZCwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHNvdXJjZSA9IHJlc29sdmVQYXRoKHRhcmdldERpciwgb3BlcmFuZCk7XG4gICAgICBwYXRjaFRleHQgPSByZWFkUGF0Y2hGaWxlKHNvdXJjZSk7XG4gICAgICBpZiAocGF0Y2hUZXh0ID09PSBudWxsKSB7XG4gICAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsIHNvdXJjZSwgJ3BhdGNoIGZpbGUgdW5yZWFkYWJsZSBvciBtaXNzaW5nJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgLy8gMi4gVGhlIHN0ZGluIGA8YCBzb3VyY2UgKHBhdGNoIGFuZCBnaXQgYXBwbHkpLlxuICBpZiAocGF0Y2hUZXh0ID09PSBudWxsKSB7XG4gICAgY29uc3Qgc3RkaW4gPSByZWRpcmVjdHMuZmluZCgocikgPT4gci5vcCA9PT0gJzwnKTtcbiAgICBpZiAoc3RkaW4gIT09IHVuZGVmaW5lZCAmJiBzdGRpbi50YXJnZXQgIT09IG51bGwpIHtcbiAgICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShzdGRpbi50YXJnZXQpKSB7XG4gICAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsIHN0ZGluLnRhcmdldCwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHNvdXJjZSA9IHJlc29sdmVQYXRoKHNoZWxsRGlyLCBzdGRpbi50YXJnZXQpO1xuICAgICAgcGF0Y2hUZXh0ID0gcmVhZFBhdGNoRmlsZShzb3VyY2UpO1xuICAgICAgaWYgKHBhdGNoVGV4dCA9PT0gbnVsbCkge1xuICAgICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCBzb3VyY2UsICdwYXRjaCB0ZXh0IHVucmVhZGFibGUgb3IgbWlzc2luZycpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuICB9XG4gIC8vIDMuIE5vIHN0YXRpY2FsbHkga25vd24gc291cmNlOiBzdGRpbiBpcyBkeW5hbWljICh0ZXJtaW5hbCwgcGlwZSwgdmFyaWFibGUpLlxuICBpZiAocGF0Y2hUZXh0ID09PSBudWxsKSB7XG4gICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgaG9zdCwgJ25vIHN0YXRpY2FsbHkga25vd24gcGF0Y2ggdGV4dCBzb3VyY2UgKHN0ZGluIGlzIGR5bmFtaWMpJyk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgdGFyZ2V0cyA9IHBhcnNlVW5pZmllZERpZmZSYW5nZShwYXRjaFRleHQsIHBhcnRzLnN0cmlwKTtcbiAgaWYgKHRhcmdldHMgPT09IG51bGwpIHtcbiAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCBzb3VyY2UgPz8gaG9zdCwgJ21hbGZvcm1lZCBvciBlbXB0eSBwYXRjaCB0ZXh0Jyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGZvciAoY29uc3QgdCBvZiB0YXJnZXRzKSB7XG4gICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVRhcmdldChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCB0LnBhdGgsIHRhcmdldERpcik7XG4gICAgaWYgKGFic29sdXRlUGF0aCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiAncGF0Y2gtd3JpdGUnLFxuICAgICAgc3Bhbjoge1xuICAgICAgICBvcGVyYXRpb246IHQub3BlcmF0aW9uLFxuICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgam9pbixcbiAgICAgICAgLi4uKHQubGluZVN0YXJ0ICE9PSB1bmRlZmluZWQgPyB7IGxpbmVTdGFydDogdC5saW5lU3RhcnQsIGxpbmVFbmQ6IHQubGluZUVuZCB9IDoge30pXG4gICAgICB9XG4gICAgfSk7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgcGF0Y2gvZ2l0IGFwcGx5IGdyYW1tYXIgaW4gdGhlIG1haW4gd2FsazogYHBhdGNoYCByZWFkcyBwYXRjaCB0ZXh0IGZyb21cbiAqIHN0ZGluIG9yIGEgYDxgIHJlZGlyZWN0OyBgZ2l0IGFwcGx5YCBhZGRpdGlvbmFsbHkgYWNjZXB0cyBhIHBhdGNoLWZpbGVcbiAqIG9wZXJhbmQgYW5kIHJlc29sdmVzIHRhcmdldHMgYWdhaW5zdCBpdHMgYC1DYCBkaXJlY3RvcnkuIEEgd3JhcHBlZFxuICogYHBhdGNoYC9gYXBwbHlgIGlzIHVucmVzb2x2ZWQgXHUyMDE0IHRoZSB3cmFwcGVyIG9ic2N1cmVzIHRoZSBhcmd2LlxuICovXG5mdW5jdGlvbiBtYXRjaFBhdGNoQXBwbHkoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICByZWRpcmVjdHM6IFJlZGlyZWN0SW5mb1tdLFxuICBkaXJGb3JSZXNvbHV0aW9uOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCByZXN0ID0gc3RyaXBUcmFuc3BhcmVudFdyYXBwZXIoYXJndik7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICBjb25zdCBjb21tYW5kID0gcmVzdFswXTtcbiAgaWYgKGNvbW1hbmQgPT09ICdwYXRjaCcpIHtcbiAgICBlbWl0UGF0Y2hUYXJnZXRzKFxuICAgICAgcmVzdC5zbGljZSgxKSxcbiAgICAgIGZhbHNlLFxuICAgICAgJ3BhdGNoJyxcbiAgICAgIGRpckZvclJlc29sdXRpb24sXG4gICAgICBkaXJGb3JSZXNvbHV0aW9uLFxuICAgICAgcmVkaXJlY3RzLFxuICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgam9pbixcbiAgICAgIHJlc3VsdHNcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoY29tbWFuZCA9PT0gJ2dpdCcpIHtcbiAgICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChyZXN0LnNsaWNlKDEpKTtcbiAgICBpZiAoc3ViID09PSBudWxsIHx8IHN1Yi5zdWJjb21tYW5kICE9PSAnYXBwbHknKSByZXR1cm47XG4gICAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCAnYXBwbHknLCAnZ2l0IC1DIHRhcmdldCBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGVtaXRQYXRjaFRhcmdldHMoXG4gICAgICByZXN0LnNsaWNlKDEpLnNsaWNlKHN1Yi5zdWJJZHggKyAxKSxcbiAgICAgIHRydWUsXG4gICAgICAnYXBwbHknLFxuICAgICAgc3ViLmNEaXIgPz8gZGlyRm9yUmVzb2x1dGlvbixcbiAgICAgIGRpckZvclJlc29sdXRpb24sXG4gICAgICByZWRpcmVjdHMsXG4gICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICBqb2luLFxuICAgICAgcmVzdWx0c1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChGT1JFSUdOX1dSQVBQRVJTLmhhcyhjb21tYW5kKSkge1xuICAgIGNvbnN0IHdyYXBwZWQgPSByZXN0WzFdO1xuICAgIGlmICh3cmFwcGVkID09PSAncGF0Y2gnIHx8IHdyYXBwZWQgPT09ICdhcHBseScpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsIHdyYXBwZWQsIGB0aGUgJHtjb21tYW5kfSB3cmFwcGVyIG9ic2N1cmVzIHRoZSAke3dyYXBwZWR9IGFyZ3ZgKTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgaGVyZWRvYyBwYXRjaC10ZXh0IGdyYW1tYXIgKHBsYW4gXHUwMEE3NS43KTogYSBgcGF0Y2hgL2BnaXQgYXBwbHlgIGhlcmVkb2NcbiAqIGJvZHkgaXMgcGF0Y2ggdGV4dC4gVGhlIG9wZW5lcidzIG93biBvcHRpb25zIHN0aWxsIGFwcGx5IFx1MjAxNCBgLS1kcnktcnVuYC9cbiAqIGAtLWNoZWNrYC9gLS1zdGF0YC9gLS1udW1zdGF0YC9gLS1zdW1tYXJ5YC9gLS1jYWNoZWRgIG1ha2UgdGhlIGJvZHlcbiAqIHJlYWQtb25seSAobm8gdG91Y2hlcyksIGAtLWRpcmVjdG9yeWAgZmFpbHMgY2xvc2VkLCBhbmQgYC1wTmAgc2V0cyB0aGVcbiAqIGhlYWRlciBzdHJpcCBsZXZlbC5cbiAqL1xuZnVuY3Rpb24gY2xhc3NpZnlQYXRjaEhlcmVkb2MoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBib2R5OiBzdHJpbmcsXG4gIGN1cnJlbnREaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHJlc3QgPSBzdHJpcFRyYW5zcGFyZW50V3JhcHBlcihhcmd2KTtcbiAgaWYgKHJlc3QubGVuZ3RoID09PSAwKSByZXR1cm47XG4gIGNvbnN0IGNvbW1hbmQgPSByZXN0WzBdO1xuICBsZXQgaXNHaXRBcHBseSA9IGZhbHNlO1xuICBsZXQgYXJnczogc3RyaW5nW107XG4gIGxldCBkaXIgPSBjdXJyZW50RGlyO1xuICBpZiAoY29tbWFuZCA9PT0gJ3BhdGNoJykge1xuICAgIGFyZ3MgPSByZXN0LnNsaWNlKDEpO1xuICB9IGVsc2UgaWYgKGNvbW1hbmQgPT09ICdnaXQnKSB7XG4gICAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQocmVzdC5zbGljZSgxKSk7XG4gICAgaWYgKHN1YiA9PT0gbnVsbCB8fCBzdWIuc3ViY29tbWFuZCAhPT0gJ2FwcGx5JykgcmV0dXJuO1xuICAgIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgJ2FwcGx5JywgJ2dpdCAtQyB0YXJnZXQgY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZScpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpc0dpdEFwcGx5ID0gdHJ1ZTtcbiAgICBhcmdzID0gcmVzdC5zbGljZSgxKS5zbGljZShzdWIuc3ViSWR4ICsgMSk7XG4gICAgZGlyID0gc3ViLmNEaXIgPz8gY3VycmVudERpcjtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgcGFydHMgPSBwYXRjaEFwcGx5UGFydHMoYXJncywgaXNHaXRBcHBseSk7XG4gIGlmIChwYXJ0cy5yZWFkT25seSB8fCBwYXJ0cy5jYWNoZWRPbmx5KSByZXR1cm47XG4gIGlmIChwYXJ0cy5kaXJlY3RvcnkpIHtcbiAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCAnLS1kaXJlY3RvcnknLCAnLS1kaXJlY3RvcnkgcmV3cml0ZXMgcGF0Y2ggcGF0aHMnKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgdGFyZ2V0cyA9IHBhcnNlVW5pZmllZERpZmZSYW5nZShib2R5LCBwYXJ0cy5zdHJpcCk7XG4gIGlmICh0YXJnZXRzID09PSBudWxsKSB7XG4gICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgJ2hlcmVkb2MnLCAnbWFsZm9ybWVkIG9yIGVtcHR5IHBhdGNoIHRleHQnKTtcbiAgICByZXR1cm47XG4gIH1cbiAgZm9yIChjb25zdCB0IG9mIHRhcmdldHMpIHtcbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlVGFyZ2V0KHJlc3VsdHMsICdwYXRjaC13cml0ZScsIHQucGF0aCwgZGlyKTtcbiAgICBpZiAoYWJzb2x1dGVQYXRoID09PSBudWxsKSBjb250aW51ZTtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206ICdwYXRjaC13cml0ZScsXG4gICAgICBzcGFuOiB7XG4gICAgICAgIG9wZXJhdGlvbjogdC5vcGVyYXRpb24sXG4gICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICBqb2luLFxuICAgICAgICAuLi4odC5saW5lU3RhcnQgIT09IHVuZGVmaW5lZCA/IHsgbGluZVN0YXJ0OiB0LmxpbmVTdGFydCwgbGluZUVuZDogdC5saW5lRW5kIH0gOiB7fSlcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRoZSBmb3JtYXR0ZXIgLyBmaXhlciBncmFtbWFyIChwbGFuIFx1MDBBNzUuOCk6IGEgdGFibGUtZHJpdmVuIGZhbWlseSBvdmVyIHRoZVxuLy8gY29ycHVzLWRlcml2ZWQgMTYtdG9vbCBzZXQuIEZsYWcgbWF0Y2hpbmcgaXMgZXhhY3QtdG9rZW4gb24gZnVsbCBhcmd2IHdvcmRzIFx1MjAxNFxuLy8gbmV2ZXIgcHJlZml4IG9yIHN1YnN0cmluZyBcdTIwMTQgYW5kIHRoZSByZWFkLW9ubHkgbGlzdCBpcyBjb25zdWx0ZWQgZmlyc3QsIHNvXG4vLyBgLS1maXgtZHJ5LXJ1bmAgY2FuIG5ldmVyIGNvbGxpZGUgd2l0aCBgLS1maXhgIGFuZCBgYmxhY2sgLS1jaGVja2AgbmV2ZXJcbi8vIGhlYWxzLiBUb29scyB3aG9zZSB3cml0ZSBmb3JtIGlzIGEgYmFyZSBpbnZvY2F0aW9uIChibGFjaywgaXNvcnQsIHJ1c3RmbXQpXG4vLyBjYXJyeSB0aGUgZW1wdHkgZm9ybSBhbmQgZmlyZSBvbiB0aGUgd3JpdGUgZm9ybSBpdHNlbGYuIExlYWRpbmcgdHJhbnNwYXJlbnRcbi8vIHBhY2thZ2UtcnVubmVyIHdyYXBwZXJzIChucHgsIHlhcm4sIHBucG0gZXhlYy9kbHgsIGJ1bngsIG5wbSBleGVjKSBzdHJpcFxuLy8gdW5kZXIgYSBwaW5uZWQgb3B0aW9uIGdyYW1tYXI7IGEgd3JhcHBlciB0aGF0IGNvdWxkIHJld3JpdGUgYXJndiBmYWlsc1xuLy8gY2xvc2VkIGFzIHVucmVzb2x2ZWQuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIE9uZSBcdTAwQTc1LjggdGFibGUgcm93OiB0aGUgdG9vbCBjb21tYW5kIGFuZCBpdHMgd3JpdGUvcmVhZC1vbmx5IHRva2VuIGZvcm1zLiAqL1xuZXhwb3J0IGludGVyZmFjZSBGb3JtYXR0ZXJUb29sUm93IHtcbiAgY29tbWFuZDogc3RyaW5nO1xuICAvKiogVG9rZW4gc2VxdWVuY2VzIHdob3NlIGV4YWN0LXRva2VuIHByZXNlbmNlIG1hcmtzIHRoZSBpbnZvY2F0aW9uIGEgd3JpdGUuICovXG4gIHdyaXRlRm9ybXM6IHN0cmluZ1tdW107XG4gIC8qKiBUb2tlbiBzZXF1ZW5jZXMgY29uc3VsdGVkIGZpcnN0IFx1MjAxNCBwcmVzZW5jZSBzdXBwcmVzc2VzIHRoZSB3cml0ZSAodGhlIHJlYWQtb25seSBtb2RlIHdpbnMpLiAqL1xuICByZWFkT25seUZvcm1zOiBzdHJpbmdbXVtdO1xufVxuXG4vKipcbiAqIFRoZSBcdTAwQTc1LjggdGFibGUsIGV4cG9ydGVkIHNvIHRoZSBjb3JwdXMtY292ZXJhZ2UgZml4dHVyZSBjYW4gYXNzZXJ0IHR3by1zaWRlZFxuICogdG9vbC1zZXQgZXF1YWxpdHkgYW5kIHBlci10b29sIHJlYWQtb25seSBzdXBwcmVzc2lvbiAocGxhbiBcdTAwQTc1LjgsIFBoYXNlIDNcbiAqIHN0ZXAgOCkuXG4gKi9cbmV4cG9ydCBjb25zdCBGT1JNQVRURVJfVEFCTEU6IHJlYWRvbmx5IEZvcm1hdHRlclRvb2xSb3dbXSA9IFtcbiAge1xuICAgIGNvbW1hbmQ6ICdwcmV0dGllcicsXG4gICAgd3JpdGVGb3JtczogW1snLS13cml0ZSddLCBbJy13J11dLFxuICAgIHJlYWRPbmx5Rm9ybXM6IFtbJy0tY2hlY2snXSwgWyctLWxpc3QtZGlmZmVyZW50J10sIFsnLS1kZWJ1Zy1jaGVjayddXVxuICB9LFxuICB7IGNvbW1hbmQ6ICdlc2xpbnQnLCB3cml0ZUZvcm1zOiBbWyctLWZpeCddXSwgcmVhZE9ubHlGb3JtczogW1snLS1maXgtZHJ5LXJ1biddXSB9LFxuICB7XG4gICAgY29tbWFuZDogJ2Jpb21lJyxcbiAgICB3cml0ZUZvcm1zOiBbXG4gICAgICBbJ2NoZWNrJywgJy0td3JpdGUnXSxcbiAgICAgIFsnY2hlY2snLCAnLS1maXgnXSxcbiAgICAgIFsnZm9ybWF0JywgJy0td3JpdGUnXVxuICAgIF0sXG4gICAgcmVhZE9ubHlGb3JtczogW11cbiAgfSxcbiAgeyBjb21tYW5kOiAnZ29mbXQnLCB3cml0ZUZvcm1zOiBbWyctdyddXSwgcmVhZE9ubHlGb3JtczogW1snLWwnXV0gfSxcbiAgeyBjb21tYW5kOiAnZ29pbXBvcnRzJywgd3JpdGVGb3JtczogW1snLXcnXV0sIHJlYWRPbmx5Rm9ybXM6IFtdIH0sXG4gIHsgY29tbWFuZDogJ2NsYW5nLWZvcm1hdCcsIHdyaXRlRm9ybXM6IFtbJy1pJ11dLCByZWFkT25seUZvcm1zOiBbWyctLWRyeS1ydW4nXV0gfSxcbiAgeyBjb21tYW5kOiAnc2hmbXQnLCB3cml0ZUZvcm1zOiBbWyctdyddXSwgcmVhZE9ubHlGb3JtczogW1snLWQnXV0gfSxcbiAgeyBjb21tYW5kOiAneWFwZicsIHdyaXRlRm9ybXM6IFtbJy1pJ11dLCByZWFkT25seUZvcm1zOiBbWyctLWRpZmYnXV0gfSxcbiAgeyBjb21tYW5kOiAnYXV0b3BlcDgnLCB3cml0ZUZvcm1zOiBbWyctaSddXSwgcmVhZE9ubHlGb3JtczogW1snLWQnXSwgWyctLWRpZmYnXV0gfSxcbiAgeyBjb21tYW5kOiAnYmxhY2snLCB3cml0ZUZvcm1zOiBbW11dLCByZWFkT25seUZvcm1zOiBbWyctLWNoZWNrJ10sIFsnLS1kaWZmJ11dIH0sXG4gIHsgY29tbWFuZDogJ2lzb3J0Jywgd3JpdGVGb3JtczogW1tdXSwgcmVhZE9ubHlGb3JtczogW1snLS1jaGVjay1vbmx5J10sIFsnLS1kaWZmJ11dIH0sXG4gIHtcbiAgICBjb21tYW5kOiAncnVmZicsXG4gICAgd3JpdGVGb3JtczogW1snZm9ybWF0J10sIFsnY2hlY2snLCAnLS1maXgnXV0sXG4gICAgcmVhZE9ubHlGb3JtczogW1xuICAgICAgWydjaGVjaycsICctLW5vLWZpeCddLFxuICAgICAgWydmb3JtYXQnLCAnLS1jaGVjayddXG4gICAgXVxuICB9LFxuICB7IGNvbW1hbmQ6ICdkZW5vJywgd3JpdGVGb3JtczogW1snZm10J11dLCByZWFkT25seUZvcm1zOiBbWydmbXQnLCAnLS1jaGVjayddXSB9LFxuICB7IGNvbW1hbmQ6ICdkcHJpbnQnLCB3cml0ZUZvcm1zOiBbWydmbXQnXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJ2NoZWNrJ11dIH0sXG4gIHsgY29tbWFuZDogJ3J1c3RmbXQnLCB3cml0ZUZvcm1zOiBbW11dLCByZWFkT25seUZvcm1zOiBbWyctLWNoZWNrJ10sIFsnLS1lbWl0JywgJ3N0ZG91dCddXSB9LFxuICB7XG4gICAgY29tbWFuZDogJ3RlcnJhZm9ybScsXG4gICAgd3JpdGVGb3JtczogW1snZm10J11dLFxuICAgIHJlYWRPbmx5Rm9ybXM6IFtcbiAgICAgIFsnZm10JywgJy1jaGVjayddLFxuICAgICAgWydmbXQnLCAnLWRpZmYnXVxuICAgIF1cbiAgfVxuXTtcblxuLyoqIFRoZSBwaW5uZWQgcGFja2FnZS1ydW5uZXIgbm8tYXJnIGZsYWdzIChwbGFuIFx1MDBBNzUuOCk6IGZsYWdzIHRoYXQgY2Fubm90IG1vdmUgb3IgcmV3cml0ZSBhcmd2LiAqL1xuY29uc3QgUlVOTkVSX05PX0FSR19GTEFHUyA9IG5ldyBTZXQoWycteScsICctLXllcycsICctLW5vLWluc3RhbGwnXSk7XG5cbi8qKiBUaGUgb3V0Y29tZSBvZiBzdHJpcHBpbmcgb25lIGxlYWRpbmcgcGFja2FnZS1ydW5uZXIgd3JhcHBlci4gKi9cbnR5cGUgUnVubmVyU3RyaXAgPSB7IGtpbmQ6ICdzdHJpcHBlZCc7IHN0cmlwcGVkOiBzdHJpbmdbXSB9IHwgeyBraW5kOiAnb2JzY3VyZWQnIH07XG5cbi8qKlxuICogU3RyaXAgb25lIGxlYWRpbmcgdHJhbnNwYXJlbnQgcGFja2FnZS1ydW5uZXIgd3JhcHBlciAocGxhbiBcdTAwQTc1LjgpOiBgbnB4YCxcbiAqIGB5YXJuYCwgYHBucG0gZXhlY2AvYHBucG0gZGx4YCwgYGJ1bnhgLCBhbmQgYG5wbSBleGVjYCBmb2xsb3dlZCBkaXJlY3RseSBieVxuICogdGhlIHdyYXBwZWQgY29tbWFuZCB3b3JkLCB3aXRoIG9ubHkgdGhlIHBpbm5lZCBuby1hcmcgZmxhZ3MgKGAteWAvYC0teWVzYCxcbiAqIGAtLW5vLWluc3RhbGxgKSBhbmQgYG5wbSBleGVjYCdzIGAtLWAgdGVybWluYXRvciBiZXR3ZWVuLiBBIHN0cmluZy1mb3JtXG4gKiBhcmd1bWVudCAoYG5weCBcInByZXR0aWVyIC0td3JpdGUgZlwiYCksIGFuIGFyZ3YtYWx0ZXJpbmcgcnVubmVyIGZsYWdcbiAqIChgLS1wYWNrYWdlPVhgIG9yIGEgZmxhZyBjb25zdW1pbmcgdGhlIG5leHQgd29yZCksIG9yIGEgd3JhcHBlciB3b3JkIHRoYXQgaXNcbiAqIGl0c2VsZiBhIHNjcmlwdCAoYC5gLXByZWZpeGVkKSBvYnNjdXJlcyB0aGUgd3JhcHBlZCBhcmd2IFx1MjAxNCB0aGUgd3JhcHBlciBpc1xuICogdHJhbnNwYXJlbnQgb25seSB3aGVuIHRoZSBwaW5uZWQgZ3JhbW1hciBwcm92ZXMgaXQgc28uIFJldHVybnMgJ25vdC1ydW5uZXInXG4gKiB3aGVuIHRoZSB3b3JkIGlzIG5vdCBhIHJ1bm5lciBhdCBhbGwgKGEgZGlmZmVyZW50IG5wbS9wbnBtIHN1YmNvbW1hbmQsIG9yIGFcbiAqIGJhcmUgcnVubmVyIHdpdGggbm8gY29tbWFuZCB3b3JkKSBcdTIwMTQgdGhlIHRhYmxlIG1hdGNoZXMgaXQgZGlyZWN0bHksIHdoaWNoXG4gKiBmYWlscyBjbG9zZWQgZm9yIG5vbi1mb3JtYXR0ZXIgcnVubmVycy5cbiAqL1xuZnVuY3Rpb24gc3RyaXBQYWNrYWdlUnVubmVyKGFyZ3Y6IHN0cmluZ1tdKTogUnVubmVyU3RyaXAgfCAnbm90LXJ1bm5lcicge1xuICBjb25zdCBydW5uZXIgPSBhcmd2WzBdO1xuICBsZXQgcmVzdCA9IGFyZ3Yuc2xpY2UoMSk7XG4gIGlmIChydW5uZXIgPT09ICducHgnIHx8IHJ1bm5lciA9PT0gJ3lhcm4nIHx8IHJ1bm5lciA9PT0gJ2J1bngnKSB7XG4gICAgLy8gVGhlc2UgcnVubmVycyB0YWtlIHRoZSBjb21tYW5kIHdvcmQgZGlyZWN0bHkuXG4gIH0gZWxzZSBpZiAocnVubmVyID09PSAncG5wbScpIHtcbiAgICBpZiAocmVzdFswXSAhPT0gJ2V4ZWMnICYmIHJlc3RbMF0gIT09ICdkbHgnKSByZXR1cm4gJ25vdC1ydW5uZXInO1xuICAgIHJlc3QgPSByZXN0LnNsaWNlKDEpO1xuICB9IGVsc2UgaWYgKHJ1bm5lciA9PT0gJ25wbScpIHtcbiAgICBpZiAocmVzdFswXSAhPT0gJ2V4ZWMnKSByZXR1cm4gJ25vdC1ydW5uZXInO1xuICAgIHJlc3QgPSByZXN0LnNsaWNlKDEpO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiAnbm90LXJ1bm5lcic7XG4gIH1cbiAgd2hpbGUgKFJVTk5FUl9OT19BUkdfRkxBR1MuaGFzKHJlc3RbMF0pKSByZXN0ID0gcmVzdC5zbGljZSgxKTtcbiAgaWYgKHJ1bm5lciA9PT0gJ25wbScgJiYgcmVzdFswXSA9PT0gJy0tJykgcmVzdCA9IHJlc3Quc2xpY2UoMSk7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuICdub3QtcnVubmVyJzsgLy8gYSBiYXJlIHJ1bm5lciBhdHRyaWJ1dGVzIG5vdGhpbmdcbiAgY29uc3Qgd3JhcHBlZCA9IHJlc3RbMF07XG4gIGlmICh3cmFwcGVkLnN0YXJ0c1dpdGgoJy0nKSB8fCB3cmFwcGVkLnN0YXJ0c1dpdGgoJy4nKSB8fCAvXFxzLy50ZXN0KHdyYXBwZWQpKSByZXR1cm4geyBraW5kOiAnb2JzY3VyZWQnIH07XG4gIHJldHVybiB7IGtpbmQ6ICdzdHJpcHBlZCcsIHN0cmlwcGVkOiByZXN0IH07XG59XG5cbi8qKlxuICogVGhlIGZvcm1hdHRlci9maXhlciBmYW1pbHkgKHBsYW4gXHUwMEE3NS44KS4gVGhlIHJlYWQtb25seSBmb3JtcyBhcmUgY29uc3VsdGVkXG4gKiBmaXJzdCBhbmQgd2luIG92ZXIgYW55IHdyaXRlIGZvcm07IGEgd3JpdGUgZm9ybSB3aXRoIG5vIHJlYWQtb25seSBmb3JtIGFuZFxuICogZXZlcnkgb3BlcmFuZCBhbiBleHBsaWNpdCBmaWxlIGVtaXRzIGEgd2hvbGUtZmlsZSBgbW9kaWZ5YCBwZXIgb3BlcmFuZDtcbiAqIGRpcmVjdG9yeS9nbG9iL25vLW9wZXJhbmQgaW52b2NhdGlvbnMgdG91Y2ggbm90aGluZzsgdW5rbm93biBleGVjdXRhYmxlc1xuICogZmFpbCBjbG9zZWQuIEEgZm9ybSdzIGxlYWRpbmcgc3ViY29tbWFuZCB3b3JkIChgY2hlY2tgL2Bmb3JtYXRgL2BmbXRgKSBpc1xuICogcG9zaXRpb25hbCBcdTIwMTQgaXQgbXVzdCBsZWFkIHRoZSB0b29sJ3MgYXJncywgc28gYGRlbm8gdGFzayBmbXRgIGlzIGEgc2NyaXB0XG4gKiBydW5uZXIsIG5vdCBhIGZvcm1hdHRlci5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hGb3JtYXR0ZXIoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBkaXJGb3JSZXNvbHV0aW9uOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCByZXN0ID0gc3RyaXBUcmFuc3BhcmVudFdyYXBwZXIoYXJndik7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICBsZXQgd29yZHMgPSByZXN0O1xuICBjb25zdCBzdHJpcCA9IHN0cmlwUGFja2FnZVJ1bm5lcihyZXN0KTtcbiAgaWYgKHN0cmlwID09PSAnbm90LXJ1bm5lcicpIHtcbiAgICAvLyByZXN0WzBdIGlzIG5vdCBhIHBhY2thZ2UgcnVubmVyIFx1MjAxNCB0aGUgdGFibGUgbWF0Y2hlcyBpdCBkaXJlY3RseS5cbiAgfSBlbHNlIGlmIChzdHJpcC5raW5kID09PSAnb2JzY3VyZWQnKSB7XG4gICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ2Zvcm1hdHRlci13cml0ZScsIHJlc3RbMF0sIGB0aGUgJHtyZXN0WzBdfSB3cmFwcGVyIG9ic2N1cmVzIHRoZSB3cmFwcGVkIGFyZ3ZgKTtcbiAgICByZXR1cm47XG4gIH0gZWxzZSB7XG4gICAgd29yZHMgPSBzdHJpcC5zdHJpcHBlZDtcbiAgfVxuICBpZiAoRk9SRUlHTl9XUkFQUEVSUy5oYXMod29yZHNbMF0pKSB7XG4gICAgY29uc3Qgd3JhcHBlZCA9IHdvcmRzWzFdO1xuICAgIGlmICh3cmFwcGVkICE9PSB1bmRlZmluZWQgJiYgRk9STUFUVEVSX1RBQkxFLnNvbWUoKHIpID0+IHIuY29tbWFuZCA9PT0gd3JhcHBlZCkpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdmb3JtYXR0ZXItd3JpdGUnLCB3cmFwcGVkLCBgdGhlICR7d29yZHNbMF19IHdyYXBwZXIgb2JzY3VyZXMgdGhlICR7d3JhcHBlZH0gYXJndmApO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgcm93ID0gRk9STUFUVEVSX1RBQkxFLmZpbmQoKHIpID0+IHIuY29tbWFuZCA9PT0gd29yZHNbMF0pO1xuICBpZiAocm93ID09PSB1bmRlZmluZWQpIHJldHVybjsgLy8gdW5rbm93biBleGVjdXRhYmxlIFx1MjAxNCBmYWlsIGNsb3NlZCwgbm8gdG91Y2hcbiAgY29uc3QgYXJncyA9IHdvcmRzLnNsaWNlKDEpO1xuICBjb25zdCBmb3JtUHJlc2VudCA9IChmb3JtOiBzdHJpbmdbXSk6IGJvb2xlYW4gPT4ge1xuICAgIGNvbnN0IGZpcnN0ID0gZm9ybVswXTtcbiAgICBpZiAoZmlyc3QgIT09IHVuZGVmaW5lZCAmJiAhZmlyc3Quc3RhcnRzV2l0aCgnLScpICYmIGFyZ3NbMF0gIT09IGZpcnN0KSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIGZvcm0uZXZlcnkoKHRva2VuKSA9PiBhcmdzLmluY2x1ZGVzKHRva2VuKSk7XG4gIH07XG4gIC8vIFRoZSByZWFkLW9ubHkgbGlzdCBpcyBjb25zdWx0ZWQgZmlyc3QgYW5kIHdpbnMgb3ZlciBhbnkgd3JpdGUgZm9ybTpcbiAgLy8gYGVzbGludCAtLWZpeCAtLWZpeC1kcnktcnVuIGZgIHdyaXRlcyBub3RoaW5nLCBgYmxhY2sgLS1jaGVjayBmYCBuZXZlciBoZWFscy5cbiAgaWYgKHJvdy5yZWFkT25seUZvcm1zLnNvbWUoZm9ybVByZXNlbnQpKSByZXR1cm47XG4gIGlmICghcm93LndyaXRlRm9ybXMuc29tZShmb3JtUHJlc2VudCkpIHJldHVybjsgLy8gYmFyZSBpbnZvY2F0aW9ucyBvZiBmbGFnLXJlcXVpcmVkIHRvb2xzIGFyZSByZWFkLW9ubHkgKHN0ZG91dC9saW50KVxuICAvLyBDb25zdW1lIHRoZSB0b29sJ3Mgc3ViY29tbWFuZCB3b3JkIGJlZm9yZSBjb2xsZWN0aW5nIG9wZXJhbmRzLlxuICBjb25zdCBzdWJjb21tYW5kV29yZHMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgZm9yIChjb25zdCBmb3JtIG9mIHJvdy53cml0ZUZvcm1zKSB7XG4gICAgZm9yIChjb25zdCB0b2tlbiBvZiBmb3JtKSB7XG4gICAgICBpZiAoIXRva2VuLnN0YXJ0c1dpdGgoJy0nKSkgc3ViY29tbWFuZFdvcmRzLmFkZCh0b2tlbik7XG4gICAgfVxuICB9XG4gIGNvbnN0IGFmdGVyU3ViY29tbWFuZCA9IHN1YmNvbW1hbmRXb3Jkcy5oYXMoYXJnc1swXSkgPyBhcmdzLnNsaWNlKDEpIDogYXJncztcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcbiAgY29uc3Qgb3BlcmFuZHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgYSBvZiBhZnRlclN1YmNvbW1hbmQpIHtcbiAgICBpZiAoYWZ0ZXJEYXNoRGFzaCkge1xuICAgICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTsgLy8gdW5rbm93biBvcHRpb24gXHUyMTkyIHRyZWF0ZWQgYXMgYW4gb3B0aW9uIChzaGFyZWQgXHUwMEE3NSlcbiAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICB9XG4gIGlmIChvcGVyYW5kcy5sZW5ndGggPT09IDApIHJldHVybjsgLy8gbm8tb3BlcmFuZCBpbnZvY2F0aW9ucyB0b3VjaCBub3RoaW5nXG4gIC8vIEV2ZXJ5IG9wZXJhbmQgbXVzdCBiZSBhbiBleHBsaWNpdCBmaWxlIFx1MjAxNCBhIGdsb2IsIHZhcmlhYmxlLCBkaXJlY3RvcnksIG9yXG4gIC8vIHRyYWlsaW5nLXNsYXNoIG9wZXJhbmQgZmFpbHMgdGhlIHdob2xlIGNvbW1hbmQgY2xvc2VkLlxuICBmb3IgKGNvbnN0IG9wZXJhbmQgb2Ygb3BlcmFuZHMpIHtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUob3BlcmFuZCkpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdmb3JtYXR0ZXItd3JpdGUnLCBvcGVyYW5kLCAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKG9wZXJhbmQuZW5kc1dpdGgoJy8nKSB8fCBpc0V4aXN0aW5nRGlyZWN0b3J5KHJlc29sdmVQYXRoKGRpckZvclJlc29sdXRpb24sIG9wZXJhbmQpKSkgcmV0dXJuO1xuICB9XG4gIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBvcGVyYW5kcykge1xuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogJ2Zvcm1hdHRlci13cml0ZScsXG4gICAgICBzcGFuOiB7IG9wZXJhdGlvbjogJ21vZGlmeScsIGFic29sdXRlUGF0aDogcmVzb2x2ZVBhdGgoZGlyRm9yUmVzb2x1dGlvbiwgb3BlcmFuZCksIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgfSk7XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUaGUgZ2l0IHJlc3RvcmUgLyBnaXQgY2hlY2tvdXQgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjkpLCB0aGUgbGFzdCBwdXJlLXBhcnNlclxuLy8gZmFtaWx5LiBSZXN0b3JlIGhhcyBubyByZXZpc2lvbiBvcGVyYW5kIGZvcm0gXHUyMDE0IGl0cyBwb3NpdGlvbmFsIGFyZ3MgYXJlXG4vLyBhbHdheXMgcGF0aHNwZWNzOyBjaGVja291dCBza2lwcyBhIHByZS1gLS1gIHJldmlzaW9uL3JlZiBvcGVyYW5kIGFuZCB0YWtlc1xuLy8gcGF0aHNwZWNzIG9ubHkgYWZ0ZXIgYC0tYC4gRXZlcnkgZXhwbGljaXQtZmlsZSBwYXRoc3BlYyBpcyBhIHdob2xlLWZpbGVcbi8vIGNyZWF0ZS1vdmVyd3JpdGUgdG91Y2g7IGEgZGlyZWN0b3J5LXNoYXBlZCBwYXRoc3BlYyAoYC5gL2AuLmAsIHRyYWlsaW5nIGAvYCxcbi8vIG9yIGEgcGF0aCB0aGF0IHN0YXRzIGFzIGEgZGlyZWN0b3J5KSwgYC0tc3RhZ2VkYC1vbmx5IHJlc3RvcmUsIGFuZFxuLy8gYC1wYC9gLS1wYXRjaGAgaW50ZXJhY3RpdmUgaHVuayBzZWxlY3Rpb24gYWxsIGZhaWwgY2xvc2VkLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBnaXQgcmVzdG9yZSBuby12YWx1ZSBmbGFncyAocGxhbiBcdTAwQTc1LjkpOyBgLXNgL2AtLXNvdXJjZWAsIGAtLXN0YWdlZGAsIGAtV2AvYC0td29ya3RyZWVgLCBgLW1gL2AtLW1lcmdlYCwgYW5kIGAtcGAvYC0tcGF0Y2hgIGFyZSBoYW5kbGVkIGV4cGxpY2l0bHkuICovXG5jb25zdCBSRVNUT1JFX05PX1ZBTFVFID0gbmV3IFNldChbJy1xJywgJy1mJywgJy11J10pO1xuXG4vKipcbiAqIFRoZSBzaGFyZWQgcmVzdG9yZS9jaGVja291dCBwYXRoc3BlYyBlbWlzc2lvbiAocGxhbiBcdTAwQTc1LjkpOiBhbiBleHBsaWNpdC1maWxlXG4gKiBwYXRoc3BlYyAobm8gZ2xvYnMsIG5vIGAuYC9gLi5gLCBubyBkaXJlY3RvcnksIG5vIHRyYWlsaW5nIGAvYCkgaXMgYVxuICogY3JlYXRlLW92ZXJ3cml0ZSB3aG9sZS1maWxlIHRvdWNoOyBhIGRpcmVjdG9yeS1zaGFwZWQgcGF0aHNwZWMgaXNcbiAqIHVucmVzb2x2ZWQgXHUyMDE0IGEgZGlyZWN0b3J5IHJlc3RvcmUvY2hlY2tvdXQgcmV3cml0ZXMgYXJiaXRyYXJ5IGZpbGVzIGJlbmVhdGhcbiAqIGl0IGFuZCBjYW5ub3QgYmUgYXR0cmlidXRlZCB0byBhIGZpbGUgd3JpdGUuXG4gKi9cbmZ1bmN0aW9uIGVtaXRSZXN0b3JlQ2hlY2tvdXRQYXRoc3BlYyhcbiAgcmVzdWx0czogU3Bhbk1hdGNoW10sXG4gIGlkaW9tOiAnZ2l0LXJlc3RvcmUtd3JpdGUnIHwgJ2dpdC1jaGVja291dC13cml0ZScsXG4gIG9wZXJhbmQ6IHN0cmluZyxcbiAgZGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXVxuKTogdm9pZCB7XG4gIGlmIChsb29rc1VucmVzb2x2YWJsZShvcGVyYW5kKSkge1xuICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsIGlkaW9tLCBvcGVyYW5kLCAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVBhdGgoZGlyLCBvcGVyYW5kKTtcbiAgaWYgKG9wZXJhbmQgPT09ICcuJyB8fCBvcGVyYW5kID09PSAnLi4nIHx8IG9wZXJhbmQuZW5kc1dpdGgoJy8nKSB8fCBpc0V4aXN0aW5nRGlyZWN0b3J5KGFic29sdXRlUGF0aCkpIHtcbiAgICBwdXNoVW5yZXNvbHZlZChcbiAgICAgIHJlc3VsdHMsXG4gICAgICBpZGlvbSxcbiAgICAgIG9wZXJhbmQsXG4gICAgICAnZGlyZWN0b3J5LXNoYXBlZCBwYXRoc3BlYyByZXdyaXRlcyBhcmJpdHJhcnkgZmlsZXMgYmVuZWF0aCBpdCBcdTIwMTQgbm90IGF0dHJpYnV0YWJsZSB0byBhIGZpbGUgd3JpdGUnXG4gICAgKTtcbiAgICByZXR1cm47XG4gIH1cbiAgcmVzdWx0cy5wdXNoKHtcbiAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgaWRpb20sXG4gICAgc3BhbjogeyBvcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJywgYWJzb2x1dGVQYXRoLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICB9KTtcbn1cblxuLyoqXG4gKiBUaGUgZ2l0IHJlc3RvcmUgb3BlcmFuZCBncmFtbWFyIChwbGFuIFx1MDBBNzUuOSk6IGAtc2AvYC0tc291cmNlPTx0cmVlPmAgaXNcbiAqIHZhbHVlLXRha2luZyBcdTIwMTQgdGhlIHRyZWUgb3BlcmFuZCBuZXZlciByZXNvbHZlcyBhcyBhIHBhdGhzcGVjOyBgLXBgL2AtLXBhdGNoYFxuICogaW50ZXJhY3RpdmUgaHVuayBzZWxlY3Rpb24gaXMgdW5yZXNvbHZlZDsgYC1tYC9gLS1tZXJnZWAgKHRoZSBtZXJnZVxuICogbWFjaGluZXJ5LCBjb25kaXRpb25hbCBvbiB0aGUgaW5kZXggYmVpbmcgdW5tZXJnZWQpIGFuZCBgLS1zdGFnZWRgIHdpdGhvdXRcbiAqIGAtLXdvcmt0cmVlYCAoaW5kZXgtb25seSBcdTIwMTQgdGhlIHdvcmtpbmcgZmlsZSBzdXJ2aXZlcykgdG91Y2ggbm90aGluZy5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hSZXN0b3JlT3BlcmFuZHMoXG4gIGFyZ3M6IHN0cmluZ1tdLFxuICBkaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGxldCBzdGFnZWQgPSBmYWxzZTtcbiAgbGV0IHdvcmt0cmVlID0gZmFsc2U7XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG4gIGNvbnN0IG9wZXJhbmRzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJnc1tpXTtcbiAgICBpZiAoYWZ0ZXJEYXNoRGFzaCkge1xuICAgICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctcCcgfHwgYSA9PT0gJy0tcGF0Y2gnKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChcbiAgICAgICAgcmVzdWx0cyxcbiAgICAgICAgJ2dpdC1yZXN0b3JlLXdyaXRlJyxcbiAgICAgICAgYSxcbiAgICAgICAgJ2ludGVyYWN0aXZlIHBhdGNoIG1vZGUgYXBwbGllcyB1c2VyLWNob3NlbiBodW5rcyBcdTIwMTQgbm8gc3RhdGljIHNwYW4nXG4gICAgICApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1zJyB8fCBhID09PSAnLS1zb3VyY2UnKSB7XG4gICAgICBpICs9IDE7IC8vIHRoZSB0cmVlIG9wZXJhbmQgaXMgbmV2ZXIgYSBwYXRoc3BlY1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0tc291cmNlPScpKSBjb250aW51ZTtcbiAgICBpZiAoYSA9PT0gJy1tJyB8fCBhID09PSAnLS1tZXJnZScpIHJldHVybjtcbiAgICBpZiAoYSA9PT0gJy0tc3RhZ2VkJykge1xuICAgICAgc3RhZ2VkID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1XJyB8fCBhID09PSAnLS13b3JrdHJlZScpIHtcbiAgICAgIHdvcmt0cmVlID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoUkVTVE9SRV9OT19WQUxVRS5oYXMoYSkpIGNvbnRpbnVlO1xuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7IC8vIHVua25vd24gb3B0aW9uIFx1MjE5MiB0cmVhdGVkIGFzIGFuIG9wdGlvbiAoZmFpbCBjbG9zZWQpXG4gICAgb3BlcmFuZHMucHVzaChhKTtcbiAgfVxuICBpZiAoc3RhZ2VkICYmICF3b3JrdHJlZSkgcmV0dXJuOyAvLyBpbmRleC1vbmx5IHJlc3RvcmUgZG9lcyBub3QgdG91Y2ggdGhlIHdvcmtpbmcgZmlsZVxuICBmb3IgKGNvbnN0IG9wZXJhbmQgb2Ygb3BlcmFuZHMpIHtcbiAgICBlbWl0UmVzdG9yZUNoZWNrb3V0UGF0aHNwZWMocmVzdWx0cywgJ2dpdC1yZXN0b3JlLXdyaXRlJywgb3BlcmFuZCwgZGlyLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4pO1xuICB9XG59XG5cbi8qKlxuICogVGhlIGdpdCBjaGVja291dCBvcGVyYW5kIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS45KTogYC1iYC9gLUJgL2AtLW9ycGhhbiA8YnJhbmNoPmBcbiAqIGFyZSB2YWx1ZS10YWtpbmcgXHUyMDE0IHRoZSBicmFuY2ggbmFtZSBuZXZlciByZXNvbHZlcyBhcyBhIHBhdGhzcGVjOyBgLXBgL1xuICogYC0tcGF0Y2hgIGludGVyYWN0aXZlIGh1bmsgc2VsZWN0aW9uIGlzIHVucmVzb2x2ZWQ7IGEgcHJlLWAtLWAgcG9zaXRpb25hbCBpc1xuICogYSByZXZpc2lvbi9yZWYgb3BlcmFuZCBhbmQgaXMgc2tpcHBlZC4gUGF0aHNwZWNzIG9ubHkgYWZ0ZXIgYC0tYC5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hDaGVja291dE9wZXJhbmRzKFxuICBhcmdzOiBzdHJpbmdbXSxcbiAgZGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBsZXQgYWZ0ZXJEYXNoRGFzaCA9IGZhbHNlO1xuICBjb25zdCBvcGVyYW5kczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBhcmdzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFyZ3NbaV07XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLXAnIHx8IGEgPT09ICctLXBhdGNoJykge1xuICAgICAgcHVzaFVucmVzb2x2ZWQoXG4gICAgICAgIHJlc3VsdHMsXG4gICAgICAgICdnaXQtY2hlY2tvdXQtd3JpdGUnLFxuICAgICAgICBhLFxuICAgICAgICAnaW50ZXJhY3RpdmUgcGF0Y2ggbW9kZSBhcHBsaWVzIHVzZXItY2hvc2VuIGh1bmtzIFx1MjAxNCBubyBzdGF0aWMgc3BhbidcbiAgICAgICk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmIChhID09PSAnLWInIHx8IGEgPT09ICctQicgfHwgYSA9PT0gJy0tb3JwaGFuJykge1xuICAgICAgaSArPSAxOyAvLyB0aGUgYnJhbmNoIG5hbWUgaXMgbmV2ZXIgYSBwYXRoc3BlY1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWYnIHx8IGEgPT09ICctcScgfHwgYSA9PT0gJy1tJyB8fCBhID09PSAnLXQnKSBjb250aW51ZTtcbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlOyAvLyB1bmtub3duIG9wdGlvbiBcdTIxOTIgdHJlYXRlZCBhcyBhbiBvcHRpb24gKGZhaWwgY2xvc2VkKVxuICAgIC8vIEEgcHJlLWAtLWAgcG9zaXRpb25hbCBpcyBhIHJldmlzaW9uL3JlZiBvcGVyYW5kIFx1MjAxNCBuZXZlciBhIHBhdGhzcGVjLlxuICB9XG4gIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBvcGVyYW5kcykge1xuICAgIGVtaXRSZXN0b3JlQ2hlY2tvdXRQYXRoc3BlYyhyZXN1bHRzLCAnZ2l0LWNoZWNrb3V0LXdyaXRlJywgb3BlcmFuZCwgZGlyLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4pO1xuICB9XG59XG5cbi8qKlxuICogVGhlIGdpdCByZXN0b3JlIC8gZ2l0IGNoZWNrb3V0IGZhbWlseSAocGxhbiBcdTAwQTc1LjkpOiB2aWEgYGZpbmRHaXRTdWJjb21tYW5kYFxuICogKGhhbmRsZXMgYGdpdCAtQ2AvYC1jYCksIHRoZSB0d28gc3ViY29tbWFuZHMgcmVzb2x2ZSB0aGVpciBwYXRoc3BlY3MgdG9cbiAqIHdob2xlLWZpbGUgY3JlYXRlLW92ZXJ3cml0ZSB0b3VjaGVzOyBhIHdyYXBwZWQgc3ViY29tbWFuZCBmYWlscyBjbG9zZWQuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoR2l0UmVzdG9yZUNoZWNrb3V0KFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgZGlyRm9yUmVzb2x1dGlvbjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcmVzdCA9IHN0cmlwVHJhbnNwYXJlbnRXcmFwcGVyKGFyZ3YpO1xuICBpZiAocmVzdC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgY29uc3QgY29tbWFuZCA9IHJlc3RbMF07XG4gIGlmIChjb21tYW5kID09PSAnZ2l0Jykge1xuICAgIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKHJlc3Quc2xpY2UoMSkpO1xuICAgIGlmIChzdWIgPT09IG51bGwgfHwgKHN1Yi5zdWJjb21tYW5kICE9PSAncmVzdG9yZScgJiYgc3ViLnN1YmNvbW1hbmQgIT09ICdjaGVja291dCcpKSByZXR1cm47XG4gICAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChcbiAgICAgICAgcmVzdWx0cyxcbiAgICAgICAgc3ViLnN1YmNvbW1hbmQgPT09ICdyZXN0b3JlJyA/ICdnaXQtcmVzdG9yZS13cml0ZScgOiAnZ2l0LWNoZWNrb3V0LXdyaXRlJyxcbiAgICAgICAgc3ViLnN1YmNvbW1hbmQsXG4gICAgICAgICdnaXQgLUMgdGFyZ2V0IGNvbnRhaW5zIGFuIHVucmVzb2x2ZWQgc2hlbGwgdmFyaWFibGUnXG4gICAgICApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBkaXIgPSBzdWIuY0RpciA/PyBkaXJGb3JSZXNvbHV0aW9uO1xuICAgIGNvbnN0IGFyZ3MgPSByZXN0LnNsaWNlKDEpLnNsaWNlKHN1Yi5zdWJJZHggKyAxKTtcbiAgICBpZiAoc3ViLnN1YmNvbW1hbmQgPT09ICdyZXN0b3JlJykgbWF0Y2hSZXN0b3JlT3BlcmFuZHMoYXJncywgZGlyLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xuICAgIGVsc2UgbWF0Y2hDaGVja291dE9wZXJhbmRzKGFyZ3MsIGRpciwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luLCByZXN1bHRzKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKEZPUkVJR05fV1JBUFBFUlMuaGFzKGNvbW1hbmQpKSB7XG4gICAgY29uc3Qgd3JhcHBlZCA9IHJlc3RbMV07XG4gICAgaWYgKHdyYXBwZWQgPT09ICdyZXN0b3JlJyB8fCB3cmFwcGVkID09PSAnY2hlY2tvdXQnKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChcbiAgICAgICAgcmVzdWx0cyxcbiAgICAgICAgd3JhcHBlZCA9PT0gJ3Jlc3RvcmUnID8gJ2dpdC1yZXN0b3JlLXdyaXRlJyA6ICdnaXQtY2hlY2tvdXQtd3JpdGUnLFxuICAgICAgICB3cmFwcGVkLFxuICAgICAgICBgdGhlICR7Y29tbWFuZH0gd3JhcHBlciBvYnNjdXJlcyB0aGUgJHt3cmFwcGVkfSBhcmd2YFxuICAgICAgKTtcbiAgICB9XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBPcmNoZXN0cmF0b3Jcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBMSU5FX1NFTEVDVE9SUyA9IFttYXRjaFNlZCwgbWF0Y2hIZWFkLCBtYXRjaFRhaWxdO1xuXG4vKipcbiAqIFNwYW4tbGVzcyBjb21tYW5kcyB3aG9zZSBleGl0IHN0YXR1cyBpcyBkZXRlcm1pbmlzdGljIFx1MjAxNCB1c2FibGUgYXMgZ3VhcmRzIGluXG4gKiBgJiZgL2B8fGAgam9pbnMgKHBsYW4gXHUwMEE3MyBzdGVwIDIncyBzcGFuLWxlc3MtZ3VhcmQgcnVsZSk6IGBmYWxzZWAgYWx3YXlzXG4gKiBleGl0cyAxLCBgdHJ1ZWAgYW5kIGA6YCBhbHdheXMgMCwgc28gYSBmb2xsb3dpbmcgam9pbmVkIGNvbW1hbmQncyBza2lwIGlzXG4gKiBrbm93YWJsZSBldmVuIHRob3VnaCBuZWl0aGVyIHByb2R1Y2VzIGEgc3Bhbi5cbiAqL1xuY29uc3QgQlVJTFRJTl9HVUFSRF9TVEFUVVMgPSBuZXcgTWFwPHN0cmluZywgMCB8IDE+KFtcbiAgWydmYWxzZScsIDFdLFxuICBbJ3RydWUnLCAwXSxcbiAgWyc6JywgMF1cbl0pO1xuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb21tYW5kRGV0YWlsZWQoY29tbWFuZDogc3RyaW5nLCBjd2Q6IHN0cmluZyA9IHByb2Nlc3MuY3dkKCkpOiBTcGFuTWF0Y2hbXSB7XG4gIGNvbnN0IHsgd3JpdGVzOiBoZXJlZG9jV3JpdGVzLCBtYXNrZWQgfSA9IGV4dHJhY3RIZXJlZG9jV3JpdGVzKGNvbW1hbmQpO1xuICBjb25zdCBzaW1wbGVDb21tYW5kcyA9IHNwbGl0VG9wTGV2ZWwobWFza2VkKTtcblxuICBjb25zdCByZXN1bHRzOiBTcGFuTWF0Y2hbXSA9IFtdO1xuICBjb25zdCBmc0xpbmVDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXIgfCBudWxsPigpO1xuICBjb25zdCBnaXRMaW5lQ2FjaGUgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyIHwgbnVsbD4oKTtcblxuICBjb25zdCBjYWNoZWRGc1RvdGFsTGluZXMgPSAoYWJzUGF0aDogc3RyaW5nKSA9PiAoKSA9PiB7XG4gICAgaWYgKCFmc0xpbmVDYWNoZS5oYXMoYWJzUGF0aCkpIGZzTGluZUNhY2hlLnNldChhYnNQYXRoLCBjb3VudEZpbGVMaW5lcyhhYnNQYXRoKSk7XG4gICAgcmV0dXJuIGZzTGluZUNhY2hlLmdldChhYnNQYXRoKSA/PyBudWxsO1xuICB9O1xuICBjb25zdCBjYWNoZWRHaXRUb3RhbExpbmVzID0gKGdpdEN3ZDogc3RyaW5nLCByZXY6IHN0cmluZywgcGF0aDogc3RyaW5nKSA9PiAoKSA9PiB7XG4gICAgY29uc3Qga2V5ID0gYCR7Z2l0Q3dkfVx1MDAwMCR7cmV2fVx1MDAwMCR7cGF0aH1gO1xuICAgIGlmICghZ2l0TGluZUNhY2hlLmhhcyhrZXkpKSBnaXRMaW5lQ2FjaGUuc2V0KGtleSwgY291bnRHaXRCbG9iTGluZXMoZ2l0Q3dkLCByZXYsIHBhdGgpKTtcbiAgICByZXR1cm4gZ2l0TGluZUNhY2hlLmdldChrZXkpID8/IG51bGw7XG4gIH07XG5cbiAgbGV0IGN1cnJlbnREaXIgPSBjd2Q7XG4gIGxldCBsYXN0UGxhaW5GaWxlU291cmNlOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgLy8gVGhlIG9uZS1ob3AgbGl0ZXJhbCBlY2hvL3ByaW50ZiBwaXBlIHNvdXJjZSAocGxhbiBcdTAwQTc1LjIpOiBzZXQgYXQgdGhlIGVuZCBvZlxuICAvLyBlYWNoIHNpbXBsZSBjb21tYW5kLCBjbGVhcmVkIGF0IGFueSBub24tcGlwZSBib3VuZGFyeSwgdGhyZWFkZWQgYnkgdGVlIC1hXG4gIC8vIGFwcGVuZHMgaW4gdGhlIG5leHQgcGlwZSBzdGFnZSAoYGVjaG8geCB8IHRlZSAtYSBmYCkuXG4gIGxldCBwaXBlRWNob0NvbnRlbnQ6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuXG4gIC8qKiBUaGUgYGpvaW5gIHN0YW1wIGZvciBhIHNpbXBsZSBjb21tYW5kOiBvbmx5IHRoZSBjb25kaXRpb25hbCBvcGVyYXRvcnMgZ2F0ZSAocGxhbiBcdTAwQTczIHN0ZXAgMikuICovXG4gIGNvbnN0IGpvaW5PZiA9IChzaW1wbGU6IFNpbXBsZUNvbW1hbmQpOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSA9PlxuICAgIHNpbXBsZS5wcmVjZWRlZEJ5ID09PSAnJiYnIHx8IHNpbXBsZS5wcmVjZWRlZEJ5ID09PSAnfHwnID8gc2ltcGxlLnByZWNlZGVkQnkgOiB1bmRlZmluZWQ7XG5cbiAgY29uc3QgZW1pdENhbmRpZGF0ZSA9IChcbiAgICBjOiBSYXdDYW5kaWRhdGUsXG4gICAgZGlyRm9yUmVzb2x1dGlvbjogc3RyaW5nLFxuICAgIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICAgIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddXG4gICkgPT4ge1xuICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShjLmZpbGVBcmcpKSB7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgaWRpb206IGMuaWRpb20sXG4gICAgICAgIGZpbGVBcmc6IGMuZmlsZUFyZyxcbiAgICAgICAgcmVhc29uOiAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVBhdGgoZGlyRm9yUmVzb2x1dGlvbiwgYy5maWxlQXJnKTtcbiAgICBjb25zdCB0b3RhbExpbmVzID1cbiAgICAgIGMucmVzb2x2ZXJLaW5kID09PSAnZnMnXG4gICAgICAgID8gY2FjaGVkRnNUb3RhbExpbmVzKGFic29sdXRlUGF0aClcbiAgICAgICAgOiBjYWNoZWRHaXRUb3RhbExpbmVzKGMuZGlyT3ZlcnJpZGUgPz8gZGlyRm9yUmVzb2x1dGlvbiwgYy5yZXNvbHZlcktpbmQucmV2LCBjLmZpbGVBcmcpO1xuICAgIGNvbnN0IHJhbmdlID0gcmVzb2x2ZVNwZWMoYy5zcGVjLCB0b3RhbExpbmVzKTtcbiAgICBpZiAocmFuZ2UgPT09IG51bGwpIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogYy5pZGlvbSxcbiAgICAgICAgZmlsZUFyZzogYWJzb2x1dGVQYXRoLFxuICAgICAgICByZWFzb246ICdjb3VsZCBub3QgZGV0ZXJtaW5lIGVuZC1vZi1maWxlIGxpbmUgY291bnQgKGZpbGUgdW5yZWFkYWJsZSwgZW1wdHksIG9yIGdpdCByZXYvcGF0aCBub3QgZm91bmQpJ1xuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogYy5pZGlvbSxcbiAgICAgIHNwYW46IHtcbiAgICAgICAgb3BlcmF0aW9uOiAncmVhZCcsXG4gICAgICAgIGxpbmVTdGFydDogcmFuZ2UubGluZVN0YXJ0LFxuICAgICAgICBsaW5lRW5kOiByYW5nZS5saW5lRW5kLFxuICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgam9pblxuICAgICAgfVxuICAgIH0pO1xuICB9O1xuXG4gIC8qKlxuICAgKiBUaGUgcmVhZCBpZGlvbXMgZm9yIG9uZSBzaW1wbGUgY29tbWFuZCAodGhlIGV4aXN0aW5nIGNvcnB1cyBncmFtbWFyKTpcbiAgICogcGxhaW4gYGNhdGAvYG5sYCBzb3VyY2VzLCB0aGUgbGluZSBzZWxlY3RvcnMsIGFuZCB0aGUgZ2l0IG1hdGNoZXJzLCB3aXRoXG4gICAqIG9uZS1ob3AgcGlwZS1zb3VyY2UgcHJvcGFnYXRpb24gZm9yIGRvd25zdHJlYW0gYGhlYWRgL2B0YWlsYC9gc2VkIC1uYC5cbiAgICovXG4gIGNvbnN0IG1hdGNoUmVhZHMgPSAoc2ltcGxlOiBTaW1wbGVDb21tYW5kLCBhcmd2OiBzdHJpbmdbXSwgaTogbnVtYmVyKTogdm9pZCA9PiB7XG4gICAgbGV0IGlzUGxhaW5Tb3VyY2UgPSBmYWxzZTtcbiAgICBsZXQgcGxhaW5GaWxlQXJnOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgICBpZiAoYXJndlswXSA9PT0gJ2NhdCcgJiYgYXJndi5sZW5ndGggPT09IDIgJiYgIWFyZ3ZbMV0uc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICBpc1BsYWluU291cmNlID0gdHJ1ZTtcbiAgICAgIHBsYWluRmlsZUFyZyA9IGFyZ3ZbMV07XG4gICAgICBsYXN0UGxhaW5GaWxlU291cmNlID0gaGFzU2hlbGxFeHBhbnNpb24oYXJndlsxXSkgPyBudWxsIDogcmVzb2x2ZVBhdGgoY3VycmVudERpciwgYXJndlsxXSk7XG4gICAgfSBlbHNlIGlmIChhcmd2WzBdID09PSAnbmwnICYmIGFyZ3YubGVuZ3RoID49IDIgJiYgIWFyZ3ZbYXJndi5sZW5ndGggLSAxXS5zdGFydHNXaXRoKCctJykpIHtcbiAgICAgIGlzUGxhaW5Tb3VyY2UgPSB0cnVlO1xuICAgICAgY29uc3QgZiA9IGFyZ3ZbYXJndi5sZW5ndGggLSAxXTtcbiAgICAgIHBsYWluRmlsZUFyZyA9IGY7XG4gICAgICBsYXN0UGxhaW5GaWxlU291cmNlID0gaGFzU2hlbGxFeHBhbnNpb24oZikgPyBudWxsIDogcmVzb2x2ZVBhdGgoY3VycmVudERpciwgZik7XG4gICAgfVxuXG4gICAgLy8gQSBiYXJlIGBjYXQgZmlsZWAvYG5sIGZpbGVgIHRoYXQgaXMgbm90IGZlZWRpbmcgYSBkb3duc3RyZWFtIHBpcGUgc3RhZ2VcbiAgICAvLyByZWFkcyB0aGUgd2hvbGUgZmlsZTogZW1pdCB0aGUgc2FtZSB3aG9sZS1maWxlIHNwYW4gYGdpdCBzaG93IHJldjpwYXRoYFxuICAgIC8vIHByb2R1Y2VzLiBXaGVuIGEgcGlwZSBmb2xsb3dzLCB0aGUgZG93bnN0cmVhbSBsaW5lLXNlbGVjdG9yIGFscmVhZHlcbiAgICAvLyBlbWl0cyB0aGUgcHJlY2lzZSByYW5nZSwgc28gdGhlIHNvdXJjZSBzdGF5cyBzb3VyY2Utb25seS5cbiAgICBpZiAocGxhaW5GaWxlQXJnICE9PSBudWxsKSB7XG4gICAgICBjb25zdCBuZXh0ID0gc2ltcGxlQ29tbWFuZHNbaSArIDFdO1xuICAgICAgaWYgKG5leHQgPT09IHVuZGVmaW5lZCB8fCBuZXh0LnByZWNlZGVkQnkgIT09ICd8Jykge1xuICAgICAgICBlbWl0Q2FuZGlkYXRlKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGtpbmQ6ICdjYW5kaWRhdGUnLFxuICAgICAgICAgICAgaWRpb206IGFyZ3ZbMF0gPT09ICdjYXQnID8gJ2NhdC1maWxlJyA6ICdubC1maWxlJyxcbiAgICAgICAgICAgIGZpbGVBcmc6IHBsYWluRmlsZUFyZyxcbiAgICAgICAgICAgIHNwZWM6IHsga2luZDogJ3RvRW9mJywgc3RhcnQ6IDEgfSxcbiAgICAgICAgICAgIHJlc29sdmVyS2luZDogJ2ZzJ1xuICAgICAgICAgIH0sXG4gICAgICAgICAgY3VycmVudERpcixcbiAgICAgICAgICBpLFxuICAgICAgICAgIGpvaW5PZihzaW1wbGUpXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgbGV0IG1hdGNoZWQgPSBmYWxzZTtcbiAgICBmb3IgKGNvbnN0IG1hdGNoZXIgb2YgWy4uLkxJTkVfU0VMRUNUT1JTLCBtYXRjaEdpdFNob3csIG1hdGNoR2l0TG9nTF0pIHtcbiAgICAgIGZvciAoY29uc3Qgb3V0Y29tZSBvZiBtYXRjaGVyKGFyZ3YpKSB7XG4gICAgICAgIG1hdGNoZWQgPSB0cnVlO1xuICAgICAgICBpZiAob3V0Y29tZS5raW5kID09PSAndW5yZXNvbHZlZCcpIHtcbiAgICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgICBpZGlvbTogb3V0Y29tZS5pZGlvbSxcbiAgICAgICAgICAgIGZpbGVBcmc6IG91dGNvbWUuZmlsZUFyZyxcbiAgICAgICAgICAgIHJlYXNvbjogb3V0Y29tZS5yZWFzb25cbiAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBlbWl0Q2FuZGlkYXRlKG91dGNvbWUsIG91dGNvbWUuZGlyT3ZlcnJpZGUgPz8gY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSkpO1xuICAgICAgICAgIC8vIGBnaXQgc2hvdyByZXY6cGF0aGAgcHJpbnRzIHRoZSBibG9iIHZlcmJhdGltLCBzbyAodW5saWtlIGBnaXQgbG9nIC1MYCxcbiAgICAgICAgICAvLyB3aGljaCBwcmludHMgZGlmZi1mb3JtYXR0ZWQgaGlzdG9yeSkgaXQncyBhIHZhbGlkIG9uZS1ob3AgcGlwZSBzb3VyY2VcbiAgICAgICAgICAvLyBmb3IgYSBkb3duc3RyZWFtIGxpbmUtc2VsZWN0b3IsIHNhbWUgYXMgYGNhdGAvYG5sYC5cbiAgICAgICAgICBpZiAob3V0Y29tZS5pZGlvbSA9PT0gJ2dpdC1zaG93LXJldi1wYXRoJyAmJiAhbG9va3NVbnJlc29sdmFibGUob3V0Y29tZS5maWxlQXJnKSkge1xuICAgICAgICAgICAgaXNQbGFpblNvdXJjZSA9IHRydWU7XG4gICAgICAgICAgICBsYXN0UGxhaW5GaWxlU291cmNlID0gcmVzb2x2ZVBhdGgob3V0Y29tZS5kaXJPdmVycmlkZSA/PyBjdXJyZW50RGlyLCBvdXRjb21lLmZpbGVBcmcpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghbWF0Y2hlZCAmJiBzaW1wbGUucHJlY2VkZWRCeSA9PT0gJ3wnICYmIGxhc3RQbGFpbkZpbGVTb3VyY2UpIHtcbiAgICAgIGNvbnN0IHdpdGhGaWxlID0gWy4uLmFyZ3YsIGxhc3RQbGFpbkZpbGVTb3VyY2VdO1xuICAgICAgZm9yIChjb25zdCBtYXRjaGVyIG9mIExJTkVfU0VMRUNUT1JTKSB7XG4gICAgICAgIGZvciAoY29uc3Qgb3V0Y29tZSBvZiBtYXRjaGVyKHdpdGhGaWxlKSkge1xuICAgICAgICAgIGlmIChvdXRjb21lLmtpbmQgPT09ICdjYW5kaWRhdGUnKSBlbWl0Q2FuZGlkYXRlKG91dGNvbWUsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpKTtcbiAgICAgICAgICBlbHNlXG4gICAgICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgICAgICAgaWRpb206IG91dGNvbWUuaWRpb20sXG4gICAgICAgICAgICAgIGZpbGVBcmc6IG91dGNvbWUuZmlsZUFyZyxcbiAgICAgICAgICAgICAgcmVhc29uOiBvdXRjb21lLnJlYXNvblxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWlzUGxhaW5Tb3VyY2UpIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBudWxsO1xuICB9O1xuXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgc2ltcGxlQ29tbWFuZHMubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBzaW1wbGUgPSBzaW1wbGVDb21tYW5kc1tpXTtcblxuICAgIC8vIEEgcGlwZSBzdGFnZSBtYXkgaW5oZXJpdCB0aGUgcHJldmlvdXMgc3RhZ2UncyBsaXRlcmFsIGVjaG8gY29udGVudDsgYW55XG4gICAgLy8gb3RoZXIgYm91bmRhcnkgY2xlYXJzIGl0LlxuICAgIGlmIChzaW1wbGUucHJlY2VkZWRCeSAhPT0gJ3wnKSBwaXBlRWNob0NvbnRlbnQgPSBudWxsO1xuXG4gICAgY29uc3QgaGVyZWRvY1JlZiA9IHNpbXBsZS50ZXh0Lm1hdGNoKC9eX19oZXJlZG9jXyhcXGQrKV9fJC8pO1xuICAgIGlmIChoZXJlZG9jUmVmKSB7XG4gICAgICBjb25zdCB3ID0gaGVyZWRvY1dyaXRlc1tOdW1iZXIucGFyc2VJbnQoaGVyZWRvY1JlZlsxXSwgMTApXTtcbiAgICAgIGNvbnN0IHRva2VucyA9IHRva2VuaXplKHN0cmlwTGVhZGluZ0Fzc2lnbm1lbnRzKHcub3BlbmVyKS50cmltKCkpO1xuICAgICAgaWYgKHRva2VucyA9PT0gbnVsbCkge1xuICAgICAgICBsYXN0UGxhaW5GaWxlU291cmNlID0gbnVsbDtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBvcGVuZXJBcmd2ID0gYW5hbHl6ZVRva2Vucyh0b2tlbnMpLmFyZ3Y7XG4gICAgICBtYXRjaFJlYWRzKHNpbXBsZSwgb3BlbmVyQXJndiwgaSk7XG4gICAgICBjbGFzc2lmeUhlcmVkb2NPcGVuZXIody5vcGVuZXIsIHcuYm9keSwgdy5xdW90ZWREZWxpbSwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgICAgcGlwZUVjaG9Db250ZW50ID0gbGl0ZXJhbENvbnRlbnQob3BlbmVyQXJndikgPz8gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IHRva2VucyA9IHRva2VuaXplKHN0cmlwTGVhZGluZ0Fzc2lnbm1lbnRzKHNpbXBsZS50ZXh0KS50cmltKCkpO1xuICAgIGlmICh0b2tlbnMgPT09IG51bGwpIHtcbiAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IHsgYXJndiwgcmVkaXJlY3RzIH0gPSBhbmFseXplVG9rZW5zKHRva2Vucyk7XG4gICAgaWYgKGFyZ3YubGVuZ3RoID09PSAwKSB7XG4gICAgICAvLyBCYXJlIGA+IGZgIC8gYDogPiBmYDogbm8gYXJndiwgYnV0IHRoZSB0cnVuY2F0aW9uIGdyYW1tYXIgc3RpbGwgZmlyZXMuXG4gICAgICBtYXRjaFJlZGlyZWN0RmFtaWx5KGFyZ3YsIHJlZGlyZWN0cywgcGlwZUVjaG9Db250ZW50LCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgICBsYXN0UGxhaW5GaWxlU291cmNlID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChhcmd2WzBdID09PSAnY2QnKSB7XG4gICAgICBsYXN0UGxhaW5GaWxlU291cmNlID0gbnVsbDtcbiAgICAgIGNvbnN0IHRhcmdldCA9IGFyZ3ZbMV07XG4gICAgICBpZiAodGFyZ2V0ICE9PSB1bmRlZmluZWQgJiYgdGFyZ2V0ICE9PSAnLScgJiYgIWhhc1NoZWxsRXhwYW5zaW9uKHRhcmdldCkpIHtcbiAgICAgICAgY3VycmVudERpciA9IHJlc29sdmVQYXRoKGN1cnJlbnREaXIsIHRhcmdldCk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBiZWZvcmUgPSByZXN1bHRzLmxlbmd0aDtcbiAgICBtYXRjaFJlYWRzKHNpbXBsZSwgYXJndiwgaSk7XG4gICAgbWF0Y2hSZWRpcmVjdEZhbWlseShhcmd2LCByZWRpcmVjdHMsIHBpcGVFY2hvQ29udGVudCwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgIG1hdGNoQ29weU1vdmVGYW1pbHkoYXJndiwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgIG1hdGNoUm1UcnVuY2F0ZShhcmd2LCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgbWF0Y2hTZWRJbnBsYWNlKGFyZ3YsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICBtYXRjaFBhdGNoQXBwbHkoYXJndiwgcmVkaXJlY3RzLCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgbWF0Y2hGb3JtYXR0ZXIoYXJndiwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgIG1hdGNoR2l0UmVzdG9yZUNoZWNrb3V0KGFyZ3YsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICBpZiAocmVzdWx0cy5sZW5ndGggPT09IGJlZm9yZSkge1xuICAgICAgLy8gTm8gc3BhbiBmb3IgdGhpcyBjb21tYW5kOiBhIGRldGVybWluaXN0aWMgYnVpbHRpbiBpcyBzdGlsbCBhIHVzYWJsZVxuICAgICAgLy8gam9pbiBndWFyZCAoYGZhbHNlICYmIGVjaG8geCA+IGZgIG11c3Qgc2tpcCB0aGUgZWNobykuIEFueSBvdGhlclxuICAgICAgLy8gY29tbWFuZCBzdGF5cyBzcGFuLWxlc3MgYW5kIHVua25vd2FibGUgXHUyMDE0IHRoZSBkcml2ZXIgZmFpbHMgb3Blbi5cbiAgICAgIGNvbnN0IHN0YXR1cyA9IEJVSUxUSU5fR1VBUkRfU1RBVFVTLmdldChhcmd2WzBdKTtcbiAgICAgIGlmIChzdGF0dXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIHN0YXR1czogJ2J1aWx0aW4tZ3VhcmQnLFxuICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleDogaSxcbiAgICAgICAgICBqb2luOiBqb2luT2Yoc2ltcGxlKSxcbiAgICAgICAgICBleGl0U3RhdHVzOiBzdGF0dXNcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICAgIHBpcGVFY2hvQ29udGVudCA9IGxpdGVyYWxDb250ZW50KGFyZ3YpID8/IG51bGw7XG4gIH1cblxuICByZXR1cm4gcmVzdWx0cztcbn1cblxuLyoqIFBhcnNlcyBhIEJhc2ggYGNvbW1hbmRgIHN0cmluZyBpbnRvIHRoZSBmaWxlK2xpbmUtcmFuZ2Ugc3BhbnMgaXQgc3RhdGljYWxseSwgcmVsaWFibHkgcmVhZHMgb3Igd3JpdGVzLiBgY3dkYCBkZWZhdWx0cyB0byBgcHJvY2Vzcy5jd2QoKWAgXHUyMDE0IHBhc3MgdGhlIGhvb2sncyBvd24gYGN3ZGAgZmllbGQgZm9yIGNvcnJlY3QgcmVzb2x1dGlvbiBvZiByZWxhdGl2ZSBwYXRocyBhbmQgYGNkYC9gZ2l0IC1DYCB0YXJnZXRzLCBhbmQgb2YgYGdpdCBzaG93YC9gZ2l0IGxvZyAtTGAgcmV2aXNpb25zLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQ29tbWFuZChjb21tYW5kOiBzdHJpbmcsIGN3ZDogc3RyaW5nID0gcHJvY2Vzcy5jd2QoKSk6IFJlc29sdmVkU3BhbltdIHtcbiAgY29uc3QgZGV0YWlsZWQgPSBwYXJzZUNvbW1hbmREZXRhaWxlZChjb21tYW5kLCBjd2QpO1xuICBjb25zdCBzcGFuczogUmVzb2x2ZWRTcGFuW10gPSBbXTtcbiAgZm9yIChjb25zdCBtIG9mIGRldGFpbGVkKSB7XG4gICAgaWYgKG0uc3RhdHVzID09PSAncmVzb2x2ZWQnKSBzcGFucy5wdXNoKG0uc3Bhbik7XG4gIH1cbiAgcmV0dXJuIHNwYW5zO1xufVxuIiwgIi8qKlxuICogVGhlIG9ubHkgaW1wdXJlIGJpdHM6IGNvdW50aW5nIGxpbmVzIG9mIGEgd29ya2luZy10cmVlIGZpbGUsIGFuZCBvZiBhIGZpbGVcbiAqIGFzIGl0IGV4aXN0ZWQgYXQgYSBnaXZlbiBnaXQgcmV2aXNpb24uIEJvdGggcmV0dXJuIG51bGwgb24gYW55IGZhaWx1cmVcbiAqIChtaXNzaW5nIGZpbGUsIGJhZCByZXYsIG5vdCBhIGdpdCByZXBvLCBldGMuKSBpbnN0ZWFkIG9mIHRocm93aW5nIFx1MjAxNCBhXG4gKiBjb21tYW5kIHRoYXQgc3RhdGljYWxseSBtYXRjaGVkIGFuIGlkaW9tIGJ1dCBwb2ludHMgYXQgc29tZXRoaW5nIHRoaXNcbiAqIG1hY2hpbmUgY2FuJ3QgY3VycmVudGx5IHJlc29sdmUgaXMgYSBub3JtYWwsIGV4cGVjdGVkIG91dGNvbWUsIG5vdCBhIGJ1Zy5cbiAqL1xuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IHJlYWRGaWxlU3luYywgc3RhdFN5bmMgfSBmcm9tICdub2RlOmZzJztcblxuLyoqIE51bWJlciBvZiBsaW5lcyBpbiBhIHdvcmtpbmctdHJlZSBmaWxlLCBvciBudWxsIGlmIGl0IGNhbid0IGJlIHJlYWQuIFRyYWlsaW5nIG5ld2xpbmUgZG9lcyBub3QgY291bnQgYXMgYW4gZXh0cmEgZW1wdHkgbGluZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb3VudEZpbGVMaW5lcyhhYnNvbHV0ZVBhdGg6IHN0cmluZyk6IG51bWJlciB8IG51bGwge1xuICB0cnkge1xuICAgIGlmICghc3RhdFN5bmMoYWJzb2x1dGVQYXRoKS5pc0ZpbGUoKSkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgY29udGVudCA9IHJlYWRGaWxlU3luYyhhYnNvbHV0ZVBhdGgsICd1dGY4Jyk7XG4gICAgaWYgKGNvbnRlbnQubGVuZ3RoID09PSAwKSByZXR1cm4gMDtcbiAgICBjb25zdCB3aXRob3V0VHJhaWxpbmdOZXdsaW5lID0gY29udGVudC5lbmRzV2l0aCgnXFxuJykgPyBjb250ZW50LnNsaWNlKDAsIC0xKSA6IGNvbnRlbnQ7XG4gICAgcmV0dXJuIHdpdGhvdXRUcmFpbGluZ05ld2xpbmUuc3BsaXQoJ1xcbicpLmxlbmd0aDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqIE51bWJlciBvZiBsaW5lcyBpbiBgcGF0aGAgYXMgaXQgZXhpc3RzIGF0IGByZXZgLCBydW4gZnJvbSBgY3dkYCwgb3IgbnVsbCBpZiB0aGUgcmV2L3BhdGgvcmVwbyBkb2Vzbid0IHJlc29sdmUuICovXG5leHBvcnQgZnVuY3Rpb24gY291bnRHaXRCbG9iTGluZXMoY3dkOiBzdHJpbmcsIHJldjogc3RyaW5nLCBwYXRoOiBzdHJpbmcpOiBudW1iZXIgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc2hvdycsIGAke3Jldn06JHtwYXRofWBdLCB7XG4gICAgICBjd2QsXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ11cbiAgICB9KTtcbiAgICBpZiAob3V0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuIDA7XG4gICAgY29uc3Qgd2l0aG91dFRyYWlsaW5nTmV3bGluZSA9IG91dC5lbmRzV2l0aCgnXFxuJykgPyBvdXQuc2xpY2UoMCwgLTEpIDogb3V0O1xuICAgIHJldHVybiB3aXRob3V0VHJhaWxpbmdOZXdsaW5lLnNwbGl0KCdcXG4nKS5sZW5ndGg7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG4iLCAiLyoqXG4gKiBIZXVyaXN0aWMsIGRlcGVuZGVuY3ktZnJlZSBzaGVsbCBzcGxpdHRpbmcuIE5vdCBhIGZ1bGwgc2hlbGwgcGFyc2VyIFx1MjAxNCBnb29kXG4gKiBlbm91Z2ggdG8gbG9jYXRlIHNpbXBsZSBjb21tYW5kcyAoYW5kIHRoZWlyIGFyZ3YpIGluc2lkZSBhIGxhcmdlclxuICogJiYvfHwvOy98LWpvaW5lZCBCYXNoIHN0cmluZyB3aXRob3V0IHB1bGxpbmcgaW4gYSByZWFsIGJhc2ggQVNUIHBhcnNlci5cbiAqIFZhbGlkYXRlZCBkdXJpbmcgcmVzZWFyY2ggYWdhaW5zdCBiYXNobGV4IG9uIHRoZSByZWFsIHRyYW5zY3JpcHQgY29ycHVzO1xuICogdGhpcyBwb3J0cyB0aGUgc2FtZSBhbGdvcml0aG0uXG4gKlxuICogVGhlIHdvcmQtbGV2ZWwgdG9rZW5pemVyIChbdG9rZW5pemVdKSBpcyBxdW90ZS0gYW5kIHJlZGlyZWN0LWF3YXJlIChwbGFuXG4gKiBcdTAwQTc1LjEwKTogcmVkaXJlY3Qgb3BlcmF0b3JzIGFyZSBzcGxpdCBhcyBkaXN0aW5jdCB0b2tlbnMgd2l0aCBhdHRhY2hlZC10YXJnZXRcbiAqIGZvcm1zIHByZXNlcnZlZCAoYD5mYCksIHF1b3RlZCB0b2tlbnMgYXJlIHdvcmRzIGFuZCBuZXZlciBvcGVyYXRvcnMsIGFuZFxuICogW2FyZ3ZPZl0gZGVyaXZlcyBvcGVyYW5kcyBmcm9tIHRoZSB0b2tlbiBzdHJlYW0gbWludXMgcmVkaXJlY3QgdG9rZW5zIGFuZFxuICogdGhlaXIgdGFyZ2V0cy5cbiAqL1xuXG4vKiogT25lIGBzaW1wbGUgY29tbWFuZGAgZm91bmQgaW4gYSBsYXJnZXIgc2NyaXB0LCBwbHVzIHdoaWNoIG9wZXJhdG9yIHByZWNlZGVkIGl0LiAqL1xuZXhwb3J0IGludGVyZmFjZSBTaW1wbGVDb21tYW5kIHtcbiAgdGV4dDogc3RyaW5nO1xuICAvKipcbiAgICogVGhlIG9wZXJhdG9yIGltbWVkaWF0ZWx5IGJlZm9yZSB0aGlzIGNvbW1hbmQ6ICd8JyBmb3IgYSBwaXBlbGluZSBzdGFnZSxcbiAgICogJyYmJy8nfHwnIGZvciB0aGUgY29uZGl0aW9uYWwgb3BlcmF0b3JzICh0aGUgb25seSBvbmVzIHRoYXQgZ2F0ZSwgcGxhblxuICAgKiBcdTAwQTczIHN0ZXAgMiksICdvdGhlcicgZm9yICc7Jy9uZXdsaW5lLycmJywgb3IgJ3N0YXJ0JyBmb3IgdGhlIGZpcnN0IGNvbW1hbmQuXG4gICAqL1xuICBwcmVjZWRlZEJ5OiAnc3RhcnQnIHwgJ3wnIHwgJyYmJyB8ICd8fCcgfCAnb3RoZXInO1xufVxuXG4vKiogU3BsaXQgYSBjb21tYW5kIHN0cmluZyBpbnRvIHNpbXBsZS1jb21tYW5kIHN1YnN0cmluZ3MgYXQgdG9wLWxldmVsICYmLCB8fCwgOywgfCwgfCYsIGFuZCBuZXdsaW5lIGJvdW5kYXJpZXMuIFF1b3RlcyBhbmQgJCgpL2BgLygpIG5lc3RpbmcgYXJlIHJlc3BlY3RlZCAobm90IHNwbGl0IGluc2lkZSkuICovXG5leHBvcnQgZnVuY3Rpb24gc3BsaXRUb3BMZXZlbChjbWQ6IHN0cmluZyk6IFNpbXBsZUNvbW1hbmRbXSB7XG4gIGNvbnN0IHBhcnRzOiBTaW1wbGVDb21tYW5kW10gPSBbXTtcbiAgbGV0IGJ1ZiA9ICcnO1xuICBsZXQgaSA9IDA7XG4gIGNvbnN0IG4gPSBjbWQubGVuZ3RoO1xuICBsZXQgZGVwdGggPSAwO1xuICBsZXQgaW5TcXVvdGUgPSBmYWxzZTtcbiAgbGV0IGluRHF1b3RlID0gZmFsc2U7XG4gIGxldCBwZW5kaW5nT3A6IFNpbXBsZUNvbW1hbmRbJ3ByZWNlZGVkQnknXSA9ICdzdGFydCc7XG5cbiAgY29uc3QgZmx1c2ggPSAobmV4dE9wOiBTaW1wbGVDb21tYW5kWydwcmVjZWRlZEJ5J10pID0+IHtcbiAgICBjb25zdCBzID0gYnVmLnRyaW0oKTtcbiAgICBpZiAocykgcGFydHMucHVzaCh7IHRleHQ6IHMsIHByZWNlZGVkQnk6IHBlbmRpbmdPcCB9KTtcbiAgICBidWYgPSAnJztcbiAgICBwZW5kaW5nT3AgPSBuZXh0T3A7XG4gIH07XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIG9wZXJhdG9yIGN1cnJlbnRseSBwZW5kaW5nIGlzIGEgcGlwZSAoYHxgL2B8JmApLiBBIGhlbHBlclxuICAgKiByYXRoZXIgdGhhbiBhbiBpbmxpbmUgY29tcGFyaXNvbjogVHlwZVNjcmlwdCdzIGNvbnRyb2wtZmxvdyBuYXJyb3dpbmdcbiAgICogY2Fubm90IHNlZSB0aGUgYXNzaWdubWVudHMgYGZsdXNoYCBtYWtlcyB0byBgcGVuZGluZ09wYCBmcm9tIGluc2lkZSBpdHNcbiAgICogY2xvc3VyZSwgYW5kIHdvdWxkIG90aGVyd2lzZSBuYXJyb3cgdGhlIGRpcmVjdCBjb21wYXJpc29uIHRvIHRoZVxuICAgKiBpbml0aWFsaXplciBgJ3N0YXJ0J2AuXG4gICAqL1xuICBjb25zdCBpc1BlbmRpbmdQaXBlID0gKCk6IGJvb2xlYW4gPT4gcGVuZGluZ09wID09PSAnfCc7XG5cbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgY29uc3QgYyA9IGNtZFtpXTtcbiAgICBpZiAoaW5TcXVvdGUpIHtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaWYgKGMgPT09IFwiJ1wiKSBpblNxdW90ZSA9IGZhbHNlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpbkRxdW90ZSkge1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikge1xuICAgICAgICBidWYgKz0gY21kW2kgKyAxXTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXCInKSBpbkRxdW90ZSA9IGZhbHNlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSBcIidcIikge1xuICAgICAgaW5TcXVvdGUgPSB0cnVlO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcIicpIHtcbiAgICAgIGluRHF1b3RlID0gdHJ1ZTtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICBidWYgKz0gYyArIGNtZFtpICsgMV07XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcoJykge1xuICAgICAgZGVwdGggKz0gMTtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnKScpIHtcbiAgICAgIGRlcHRoID0gTWF0aC5tYXgoMCwgZGVwdGggLSAxKTtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChkZXB0aCA9PT0gMCkge1xuICAgICAgaWYgKGNtZC5zbGljZShpLCBpICsgMikgPT09ICcmJicpIHtcbiAgICAgICAgZmx1c2goJyYmJyk7XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoY21kLnNsaWNlKGksIGkgKyAyKSA9PT0gJ3x8Jykge1xuICAgICAgICBmbHVzaCgnfHwnKTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjbWQuc2xpY2UoaSwgaSArIDIpID09PSAnfCYnKSB7XG4gICAgICAgIGZsdXNoKCd8Jyk7XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJzsnKSB7XG4gICAgICAgIGZsdXNoKCdvdGhlcicpO1xuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICd8Jykge1xuICAgICAgICBmbHVzaCgnfCcpO1xuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcXG4nKSB7XG4gICAgICAgIC8vIEEgbmV3bGluZSBpbW1lZGlhdGVseSBhZnRlciBhIHBpcGUgb3BlcmF0b3IgaXMgYSBsaW5lIGNvbnRpbnVhdGlvblxuICAgICAgICAvLyAoYGNhdCBhLnR4dCB8XFxuc2VkIC4uLmAga2VlcHMgdGhlIHBpcGVsaW5lKSwgbm90IGEgc3RhdGVtZW50XG4gICAgICAgIC8vIHNlcGFyYXRvcjogc2tpcHBpbmcgaXQgcHJlc2VydmVzIGBwcmVjZWRlZEJ5OiAnfCdgIGZvciB0aGUgbmV4dFxuICAgICAgICAvLyBzdGFnZSBpbnN0ZWFkIG9mIGRlZ3JhZGluZyBpdCB0byAnb3RoZXInLlxuICAgICAgICBpZiAoaXNQZW5kaW5nUGlwZSgpKSB7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGZsdXNoKCdvdGhlcicpO1xuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICcmJykge1xuICAgICAgICAvLyBgJj5gL2AmPj5gIChzdGRvdXQrc3RkZXJyIHJlZGlyZWN0KSBhbmQgYD4mYCAoZmQtZHVwIHJlZGlyZWN0LCBhcyBpblxuICAgICAgICAvLyBgMj4mMWApIGFyZSByZWRpcmVjdCBvcGVyYXRvcnMsIG5vdCBjb21tYW5kIHNlcGFyYXRvcnMgXHUyMDE0IGtlZXAgdGhlbVxuICAgICAgICAvLyBpbiB0aGUgY3VycmVudCBzaW1wbGUgY29tbWFuZCBzbyB0aGUgdG9rZW5pemVyIGNhbiBsZXggdGhlbSBhcyBvbmVcbiAgICAgICAgLy8gdG9rZW4uIEEgYD5gIGNvdW50cyBhcyBhIGR1cC1yZWRpcmVjdCBwcmVmaXggb25seSBhdCBhIHRva2VuXG4gICAgICAgIC8vIGJvdW5kYXJ5IChzdGFydCwgb3IgYWZ0ZXIgd2hpdGVzcGFjZS9kaWdpdHMpIFx1MjAxNCBgYT5iJmNgIHN0aWxsXG4gICAgICAgIC8vIGJhY2tncm91bmRzIHRoZSBgYT5iYCByZWRpcmVjdC5cbiAgICAgICAgY29uc3QgdHJpbW1lZCA9IGJ1Zi50cmltRW5kKCk7XG4gICAgICAgIGxldCBkdXBSZWRpcmVjdCA9IGZhbHNlO1xuICAgICAgICBpZiAodHJpbW1lZC5lbmRzV2l0aCgnPicpKSB7XG4gICAgICAgICAgY29uc3QgYmVmb3JlID0gdHJpbW1lZC5sZW5ndGggPj0gMiA/IHRyaW1tZWRbdHJpbW1lZC5sZW5ndGggLSAyXSA6ICcnO1xuICAgICAgICAgIGR1cFJlZGlyZWN0ID0gdHJpbW1lZC5sZW5ndGggPT09IDEgfHwgL1xcc3xcXGQvLnRlc3QoYmVmb3JlKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY21kW2kgKyAxXSA9PT0gJz4nIHx8IGR1cFJlZGlyZWN0KSB7XG4gICAgICAgICAgYnVmICs9IGM7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGZsdXNoKCdvdGhlcicpO1xuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH1cbiAgICBidWYgKz0gYztcbiAgICBpICs9IDE7XG4gIH1cbiAgZmx1c2goJ290aGVyJyk7XG4gIHJldHVybiBwYXJ0cztcbn1cblxuY29uc3QgTEVBRElOR19BU1NJR05NRU5UID0gL14oPzpbQS1aYS16X11bQS1aYS16MC05X10qPVxcUypcXHMrKSsvO1xuXG4vKiogU3RyaXAgbGVhZGluZyBGT089YmFyIFZBUj1iYXogZW52LXByZWZpeCBhc3NpZ25tZW50cyBmcm9tIGEgc2ltcGxlIGNvbW1hbmQuICovXG5leHBvcnQgZnVuY3Rpb24gc3RyaXBMZWFkaW5nQXNzaWdubWVudHMoc2ltcGxlQ21kOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gc2ltcGxlQ21kLnJlcGxhY2UoTEVBRElOR19BU1NJR05NRU5ULCAnJyk7XG59XG5cbi8qKiBPbmUgcXVvdGUtYXdhcmUgbGV4aWNhbCB0b2tlbiBmcm9tIGEgc2ltcGxlIGNvbW1hbmQncyB0ZXh0IChwbGFuIFx1MDBBNzUuMTApLiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb2tlbiB7XG4gIC8qKlxuICAgKiBUaGUgdG9rZW4gdGV4dC4gV29yZCB0b2tlbnMgaGF2ZSBxdW90ZXMgc3RyaXBwZWQgYW5kIGVzY2FwZXMgcmVzb2x2ZWQ7XG4gICAqIHJlZGlyZWN0IHRva2VucyBrZWVwIHRoZSBvcGVyYXRvciB3aXRoIGFueSBhdHRhY2hlZCB0YXJnZXQgKGA+ZmAsXG4gICAqIGA+PmZgKSwgc2hlbGwtbGV4ZXIgc3R5bGUuXG4gICAqL1xuICB0ZXh0OiBzdHJpbmc7XG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSB0b2tlbiB3YXMgcXVvdGVkIG9yIGVzY2FwZWQgYW55d2hlcmUgaW4gdGhlIHNvdXJjZS4gQSBxdW90ZWRcbiAgICogdG9rZW4gaXMgYSB3b3JkLCBuZXZlciBhbiBvcGVyYXRvciAoYGVjaG8gJz4nYCBpcyBub3QgYSByZWRpcmVjdCkuXG4gICAqL1xuICBxdW90ZWQ6IGJvb2xlYW47XG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSB0b2tlbiBpcyBhIHJlZGlyZWN0IG9wZXJhdG9yIChgPmAsIGA+PmAsIGAxPmAsIGAyPmAsIGAmPmAsXG4gICAqIGAmPj5gLCBgPiZgLCBgPGAsIGA8PGAsIGA8PC1gLCBgPDw8YCksIHdpdGggYW55IGF0dGFjaGVkIHRhcmdldCBwcmVzZXJ2ZWRcbiAgICogaW4gYHRleHRgLlxuICAgKi9cbiAgaXNSZWRpcmVjdDogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBRdW90ZS1hd2FyZSB0b2tlbml6ZXIgdGhhdCBzcGxpdHMgcmVkaXJlY3Qgb3BlcmF0b3JzIGFzIGRpc3RpbmN0IHRva2VucyB3aXRoXG4gKiBhdHRhY2hlZC10YXJnZXQgZm9ybXMgcHJlc2VydmVkIChwbGFuIFx1MDBBNzUuMTApLiBXb3JkIHRva2VucyBjYXJyeSB0aGVcbiAqIGBxdW90ZWRgIGZsYWcgc28gY29uc3VtZXJzIGNhbiB0ZWxsIGEgcmVhbCBgPDxgIG9wZXJhdG9yIGZyb20gYSBxdW90ZWRcbiAqIGBcIjw8XCJgIGxpdGVyYWwuIFJldHVybnMgbnVsbCBvbiB1bmJhbGFuY2VkIHF1b3Rlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRva2VuaXplKHM6IHN0cmluZyk6IFRva2VuW10gfCBudWxsIHtcbiAgY29uc3QgdG9rZW5zOiBUb2tlbltdID0gW107XG4gIGxldCBidWYgPSAnJztcbiAgbGV0IHF1b3RlZCA9IGZhbHNlO1xuICBsZXQgaSA9IDA7XG4gIGNvbnN0IG4gPSBzLmxlbmd0aDtcblxuICBjb25zdCBmbHVzaFdvcmQgPSAoKTogdm9pZCA9PiB7XG4gICAgaWYgKGJ1Zi5sZW5ndGggPT09IDApIHJldHVybjtcbiAgICB0b2tlbnMucHVzaCh7IHRleHQ6IGJ1ZiwgcXVvdGVkLCBpc1JlZGlyZWN0OiBmYWxzZSB9KTtcbiAgICBidWYgPSAnJztcbiAgICBxdW90ZWQgPSBmYWxzZTtcbiAgfTtcblxuICAvKipcbiAgICogQXBwZW5kIHRoZSB1bnF1b3RlZCBjb250ZW50IG9mIHRoZSBxdW90ZWQgc2VjdGlvbiBvcGVuaW5nIGF0IGBzdGFydGBcbiAgICogKHRoZSBxdW90ZSBjaGFyKSB0byBgb3V0YCwgbWlycm9yaW5nIHNobGV4J3MgZXNjYXBlIHJ1bGVzIGZvciBkb3VibGVcbiAgICogcXVvdGVzLiBSZXR1cm5zIHRoZSBpbmRleCBhZnRlciB0aGUgY2xvc2luZyBxdW90ZSwgb3IgbnVsbCB3aGVuXG4gICAqIHVuYmFsYW5jZWQuXG4gICAqL1xuICBjb25zdCBhcHBlbmRRdW90ZWRDb250ZW50ID0gKG91dDogc3RyaW5nLCBzdGFydDogbnVtYmVyKTogeyBvdXQ6IHN0cmluZzsgbmV4dDogbnVtYmVyIH0gfCBudWxsID0+IHtcbiAgICBjb25zdCBxdW90ZSA9IHNbc3RhcnRdO1xuICAgIGxldCBqID0gc3RhcnQgKyAxO1xuICAgIHdoaWxlIChqIDwgbikge1xuICAgICAgY29uc3QgYyA9IHNbal07XG4gICAgICBpZiAocXVvdGUgPT09IFwiJ1wiKSB7XG4gICAgICAgIGlmIChjID09PSBcIidcIikgcmV0dXJuIHsgb3V0LCBuZXh0OiBqICsgMSB9O1xuICAgICAgICBvdXQgKz0gYztcbiAgICAgICAgaiArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXFxcXCcgJiYgaiArIDEgPCBuICYmICdcIlxcXFwkYCcuaW5jbHVkZXMoc1tqICsgMV0pKSB7XG4gICAgICAgIG91dCArPSBzW2ogKyAxXTtcbiAgICAgICAgaiArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXCInKSByZXR1cm4geyBvdXQsIG5leHQ6IGogKyAxIH07XG4gICAgICBvdXQgKz0gYztcbiAgICAgIGogKz0gMTtcbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH07XG5cbiAgLyoqXG4gICAqIEFwcGVuZCB0aGUgcmF3IGF0dGFjaGVkLXRhcmdldCB0ZXh0IHN0YXJ0aW5nIGF0IGBzdGFydGAgdG8gYG91dGAgXHUyMDE0XG4gICAqIHZlcmJhdGltLCBxdW90ZWQgc2VjdGlvbnMgc3Bhbm5pbmcgc3BhY2VzIGluY2x1ZGVkIFx1MjAxNCBzdG9wcGluZyBhdFxuICAgKiB3aGl0ZXNwYWNlIG9yIGFub3RoZXIgcmVkaXJlY3Qgb3BlcmF0b3IuIFJldHVybnMgdGhlIG5leHQgaW5kZXgsIG9yIG51bGxcbiAgICogb24gdW5iYWxhbmNlZCBxdW90ZXMuXG4gICAqL1xuICBjb25zdCBhcHBlbmRBdHRhY2hlZFRhcmdldCA9IChvdXQ6IHN0cmluZywgc3RhcnQ6IG51bWJlcik6IHsgb3V0OiBzdHJpbmc7IG5leHQ6IG51bWJlciB9IHwgbnVsbCA9PiB7XG4gICAgbGV0IGogPSBzdGFydDtcbiAgICB3aGlsZSAoaiA8IG4pIHtcbiAgICAgIGNvbnN0IGMgPSBzW2pdO1xuICAgICAgaWYgKC9cXHMvLnRlc3QoYykgfHwgYyA9PT0gJzwnIHx8IGMgPT09ICc+JykgcmV0dXJuIHsgb3V0LCBuZXh0OiBqIH07XG4gICAgICBpZiAoYyA9PT0gXCInXCIgfHwgYyA9PT0gJ1wiJykge1xuICAgICAgICBjb25zdCBzZWN0aW9uID0gYXBwZW5kUXVvdGVkQ29udGVudCgnJywgaik7XG4gICAgICAgIGlmIChzZWN0aW9uID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgICAgICAgb3V0ICs9IHMuc2xpY2Uoaiwgc2VjdGlvbi5uZXh0KTtcbiAgICAgICAgaiA9IHNlY3Rpb24ubmV4dDtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGogKyAxIDwgbikge1xuICAgICAgICBvdXQgKz0gYyArIHNbaiArIDFdO1xuICAgICAgICBqICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgb3V0ICs9IGM7XG4gICAgICBqICs9IDE7XG4gICAgfVxuICAgIHJldHVybiB7IG91dCwgbmV4dDogaiB9O1xuICB9O1xuXG4gIC8qKiBFbWl0IGEgcmVkaXJlY3QgdG9rZW4gd2hvc2UgdGV4dCBwcmVmaXhlcyB0aGUgb3BlcmF0b3Igd2l0aCB0aGUgY3VycmVudCBkaWdpdCBidWZmZXIgKGFuIElPX05VTUJFUiBsaWtlIGAyPmApLiAqL1xuICBjb25zdCBlbWl0UmVkaXJlY3QgPSAob3BlcmF0b3I6IHN0cmluZywgYXR0YWNoZWRTdGFydDogbnVtYmVyKTogYm9vbGVhbiA9PiB7XG4gICAgY29uc3QgYXR0YWNoZWQgPSBhcHBlbmRBdHRhY2hlZFRhcmdldCgnJywgYXR0YWNoZWRTdGFydCk7XG4gICAgaWYgKGF0dGFjaGVkID09PSBudWxsKSByZXR1cm4gZmFsc2U7XG4gICAgdG9rZW5zLnB1c2goeyB0ZXh0OiBidWYgKyBvcGVyYXRvciArIGF0dGFjaGVkLm91dCwgcXVvdGVkOiBmYWxzZSwgaXNSZWRpcmVjdDogdHJ1ZSB9KTtcbiAgICBidWYgPSAnJztcbiAgICBxdW90ZWQgPSBmYWxzZTtcbiAgICBpID0gYXR0YWNoZWQubmV4dDtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfTtcblxuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBjb25zdCBjID0gc1tpXTtcbiAgICBpZiAoL1xccy8udGVzdChjKSkge1xuICAgICAgZmx1c2hXb3JkKCk7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09IFwiJ1wiIHx8IGMgPT09ICdcIicpIHtcbiAgICAgIHF1b3RlZCA9IHRydWU7XG4gICAgICBjb25zdCBzZWN0aW9uID0gYXBwZW5kUXVvdGVkQ29udGVudChidWYsIGkpO1xuICAgICAgaWYgKHNlY3Rpb24gPT09IG51bGwpIHJldHVybiBudWxsO1xuICAgICAgYnVmID0gc2VjdGlvbi5vdXQ7XG4gICAgICBpID0gc2VjdGlvbi5uZXh0O1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICBxdW90ZWQgPSB0cnVlO1xuICAgICAgYnVmICs9IHNbaSArIDFdO1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnPCcgfHwgYyA9PT0gJz4nKSB7XG4gICAgICAvLyBBIGA8YC9gPmAgaXMgYSByZWRpcmVjdCBvcGVyYXRvciBhdCBhIHdvcmQgYm91bmRhcnksIG9yIGFmdGVyIGFuXG4gICAgICAvLyBJT19OVU1CRVIgZGlnaXQgcnVuIChgMT5gLCBgMj5gKTsgbWlkLXdvcmQgaXQgZW5kcyB0aGUgY3VycmVudCB3b3JkXG4gICAgICAvLyBmaXJzdCAoYGVjaG8gYT5iYCBcdTIxOTIgd29yZHMgYGVjaG9gLCBgYWA7IHJlZGlyZWN0IGA+YmApLlxuICAgICAgaWYgKGJ1ZiAhPT0gJycgJiYgIS9eXFxkKyQvLnRlc3QoYnVmKSkgZmx1c2hXb3JkKCk7XG4gICAgICBsZXQgb3BlcmF0b3I6IHN0cmluZztcbiAgICAgIGlmIChjID09PSAnPCcpIHtcbiAgICAgICAgaWYgKHMuc2xpY2UoaSwgaSArIDMpID09PSAnPDw8Jykgb3BlcmF0b3IgPSAnPDw8JztcbiAgICAgICAgZWxzZSBpZiAocy5zbGljZShpLCBpICsgMykgPT09ICc8PC0nKSBvcGVyYXRvciA9ICc8PC0nO1xuICAgICAgICBlbHNlIGlmIChzLnNsaWNlKGksIGkgKyAyKSA9PT0gJzw8Jykgb3BlcmF0b3IgPSAnPDwnO1xuICAgICAgICBlbHNlIG9wZXJhdG9yID0gJzwnO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgb3BlcmF0b3IgPSBzLnNsaWNlKGksIGkgKyAyKSA9PT0gJz4+JyA/ICc+PicgOiAnPic7XG4gICAgICB9XG4gICAgICBpZiAoIWVtaXRSZWRpcmVjdChvcGVyYXRvciwgaSArIG9wZXJhdG9yLmxlbmd0aCkpIHJldHVybiBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnJicpIHtcbiAgICAgIC8vIGAmPmAvYCY+PmAgXHUyMDE0IHRoZSBzdGRvdXQrc3RkZXJyIHJlZGlyZWN0IChrZXB0IHRvZ2V0aGVyIGJ5XG4gICAgICAvLyBzcGxpdFRvcExldmVsKS4gQSBiYXJlIGAmYCBoZXJlIGlzIGFuIG9yZGluYXJ5IHdvcmQgY2hhciAoYCYxYCBpblxuICAgICAgLy8gYDI+JjFgLCB3aGljaCB0aGUgYXR0YWNoZWQtdGFyZ2V0IHNjYW4gYWJvdmUgY29uc3VtZWQgYW55d2F5KS5cbiAgICAgIGlmIChzW2kgKyAxXSA9PT0gJz4nKSB7XG4gICAgICAgIGZsdXNoV29yZCgpO1xuICAgICAgICBjb25zdCBvcGVyYXRvciA9IHMuc2xpY2UoaSwgaSArIDMpID09PSAnJj4+JyA/ICcmPj4nIDogJyY+JztcbiAgICAgICAgaWYgKCFlbWl0UmVkaXJlY3Qob3BlcmF0b3IsIGkgKyBvcGVyYXRvci5sZW5ndGgpKSByZXR1cm4gbnVsbDtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBidWYgKz0gYztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBidWYgKz0gYztcbiAgICBpICs9IDE7XG4gIH1cbiAgZmx1c2hXb3JkKCk7XG4gIHJldHVybiB0b2tlbnM7XG59XG5cbi8qKlxuICogVGhlIGF0dGFjaGVkIHRhcmdldCBvZiBhIHJlZGlyZWN0IHRva2VuLCBvciBudWxsIHdoZW4gdGhlIG9wZXJhdG9yIGlzXG4gKiBzdGFuZGFsb25lIChgPmAgdnMgYD5mYDsgYDI+YCB2cyBgMj4mMWApLiBTcGxpdHMgYW4gb3B0aW9uYWwgSU9fTlVNQkVSXG4gKiBkaWdpdCBydW4gb2ZmIHRoZSBmcm9udCwgdGhlbiB0aGUgb3BlcmF0b3IsIGxlYXZpbmcgdGhlIHRhcmdldC5cbiAqL1xuZnVuY3Rpb24gcmVkaXJlY3RBdHRhY2hlZFRhcmdldCh0ZXh0OiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3QgbWF0Y2ggPSB0ZXh0Lm1hdGNoKC9eKFxcZCopKDw8PHw8PC18Jj4+fDw8fD4+fCY+fD4mfDx8PikoLiopJC8pO1xuICBpZiAobWF0Y2ggPT09IG51bGwpIHJldHVybiBudWxsO1xuICBjb25zdCBbLCAsICwgcmVzdF0gPSBtYXRjaDtcbiAgcmV0dXJuIHJlc3QubGVuZ3RoID4gMCA/IHJlc3QgOiBudWxsO1xufVxuXG4vKiogQmVzdC1lZmZvcnQgYXJndiBmb3IgYSBzaW1wbGUgY29tbWFuZDogbGVhZGluZyBhc3NpZ25tZW50cyBzdHJpcHBlZCwgcXVvdGUtYXdhcmUgdG9rZW5zIG1pbnVzIHJlZGlyZWN0IG9wZXJhdG9ycyBhbmQgdGhlaXIgdGFyZ2V0cy4gUmV0dXJucyBudWxsIGlmIHRoZSBjb21tYW5kIGRvZXNuJ3QgdG9rZW5pemUgY2xlYW5seSAodW5iYWxhbmNlZCBxdW90ZXMpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFyZ3ZPZihzaW1wbGVDbWQ6IHN0cmluZyk6IHN0cmluZ1tdIHwgbnVsbCB7XG4gIGNvbnN0IHRva2VucyA9IHRva2VuaXplKHN0cmlwTGVhZGluZ0Fzc2lnbm1lbnRzKHNpbXBsZUNtZCkudHJpbSgpKTtcbiAgaWYgKHRva2VucyA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGFyZ3Y6IHN0cmluZ1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgdG9rZW5zLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgdG9rZW4gPSB0b2tlbnNbaV07XG4gICAgaWYgKCF0b2tlbi5pc1JlZGlyZWN0KSB7XG4gICAgICBhcmd2LnB1c2godG9rZW4udGV4dCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gQSBzdGFuZGFsb25lIHJlZGlyZWN0IG9wZXJhdG9yIGNvbnN1bWVzIHRoZSBuZXh0IHRva2VuIGFzIGl0cyB0YXJnZXQ7XG4gICAgLy8gYW4gYXR0YWNoZWQgZm9ybSAoYD5mYCwgYD4+ZmApIGlzIHNlbGYtY29udGFpbmVkLlxuICAgIGlmIChyZWRpcmVjdEF0dGFjaGVkVGFyZ2V0KHRva2VuLnRleHQpID09PSBudWxsKSBpICs9IDE7XG4gIH1cbiAgcmV0dXJuIGFyZ3Y7XG59XG4iLCAiLyoqXG4gKiBUaGUgcmFuZ2UtcHJlc2VydmluZyB1bmlmaWVkLWRpZmYgcGFyc2VyIChwbGFuIFx1MDBBNzUuNyksIHNpYmxpbmcgdG9cbiAqIG1lY2hhbmljYWwtY2hhbmdlLnRzJ3MgcmFuZ2UtbGVzcyBgcGFyc2VVbmlmaWVkRGlmZmAuIFRoZSBwYXRjaC9naXQgYXBwbHlcbiAqIGdyYW1tYXIgbmVlZHMgdGhlIGBAQCAtYSxiICtjLGQgQEBgIGh1bmsgbnVtYmVycyB0aGF0IHBhcnNlVW5pZmllZERpZmZcbiAqIGRpc2NhcmRzLCBzbyB0aGlzIHBhcnNlcyB0aGUgc2FtZSBoZWFkZXIgZGlhbGVjdCBmcm9tIHNjcmF0Y2guXG4gKlxuICogQSBodW5rIHdob3NlIHByZS9wb3N0IGxpbmUgY291bnRzIG1hdGNoIHByZXNlcnZlcyBsaW5lIGNvb3JkaW5hdGVzLCBzbyBhXG4gKiBmaWxlIHdob3NlIGh1bmtzIGFyZSBhbGwgY291bnQtcHJlc2VydmluZyBnZXRzIGFuIGV4YWN0IHJhbmdlIFx1MjAxNCB0aGUgdW5pb24gb2ZcbiAqIGV2ZXJ5IGh1bmsncyByZWdpb24uIEFueSBjb3VudC1jaGFuZ2luZyBodW5rIChwdXJlIGFkZCwgcHVyZSBkZWxldGUsIHVuZXF1YWxcbiAqIGNvdW50cykgZGVncmFkZXMgdGhlIGZpbGUgdG8gYSB3aG9sZS1maWxlIG1vZGlmeTogcG9zaXRpb25zIGJlbG93IGl0IHNoaWZ0LFxuICogYW5kIGEgZGVsZXRlZCBsaW5lIG9jY3VwaWVzIG5vIHBvc3QtZWRpdCByYW5nZSBhdCBhbGwuXG4gKlxuICogUGVyLWZpbGUgY2xhc3NpZmljYXRpb25zOiBgbmV3IGZpbGUgbW9kZWAgXHUyMTkyIGNyZWF0ZS1vdmVyd3JpdGU7IGBkZWxldGVkIGZpbGVcbiAqIG1vZGVgIFx1MjE5MiBkZWxldGU7IGByZW5hbWUgZnJvbWAvYHJlbmFtZSB0b2AgXHUyMTkyIHNvdXJjZSBkZWxldGUgKyBkZXN0XG4gKiByZW5hbWUtY29weTsgYmluYXJ5IGRpZmZzIFx1MjE5MiB3aG9sZS1maWxlIG1vZGlmeTsgYSBgKysrIC9kZXYvbnVsbGAgdGFyZ2V0ICh0aGVcbiAqIHNoYXBlIGBkaWZmIC11YC1mb3JtYXQgZGVsZXRpb25zIHRha2UpIFx1MjE5MiBkZWxldGUsIGFuZCBhIGAtLS0gL2Rldi9udWxsYCBzaWRlXG4gKiAodGhlIGBkaWZmIC11YC1mb3JtYXQgY3JlYXRpb24gc2hhcGUsIHdpdGggbm8gYG5ldyBmaWxlIG1vZGVgIGhlYWRlcikgXHUyMTkyXG4gKiBjcmVhdGUtb3ZlcndyaXRlLlxuICpcbiAqIEdpdC1zdHlsZSBgYS9cdTIwMjZgL2BiL1x1MjAyNmAgcHJlZml4ZXMgYXJlIHN0cmlwcGVkIHBlciB0aGUgY2FsbGVyJ3MgYC1wTmAgc3RyaXBcbiAqIGxldmVsOiBhIG51bWJlciBzdHJpcHMgdGhhdCBtYW55IGxlYWRpbmcgcGF0aCBjb21wb25lbnRzLCBhbmQgYCdhdXRvJ2BcbiAqIChwYXRjaCdzIGRlZmF1bHQpIHN0cmlwcyBvbmUgd2hlbiB0aGUgcGF0aCBpcyBhLy0gb3IgYi8tcHJlZml4ZWQgYW5kIG5vbmVcbiAqIG90aGVyd2lzZS4gYC9kZXYvbnVsbGAgaXMgY2hlY2tlZCBiZWZvcmUgc3RyaXBwaW5nIFx1MjAxNCB0aGUgaGVhZGVyIG1hcmtlclxuICogd291bGQgb3RoZXJ3aXNlIGxvc2UgaXRzIGBkZXYvYCBjb21wb25lbnQuXG4gKlxuICogYGRpZmYgLXVgIGhlYWRlcnMgY2FycnkgYSB0YWItc2VwYXJhdGVkIHRpbWVzdGFtcCAoYC0tLSBmLnR4dFxcdDIwMjQtMDEtMDFcbiAqIDAwOjAwOjAwYCkgYW5kIG1heSBiZSBDUkxGLXRlcm1pbmF0ZWQ7IGJvdGggYXJlIHN0cmlwcGVkIGJlZm9yZSBwYXRoXG4gKiByZXNvbHV0aW9uLiBUaGUgdGFyZ2V0IG9mIGEgbW9kaWZ5IGh1bmsgaXMgdGhlIGAtLS1gIHNpZGU6IHBhdGNoIGFuZCBnaXRcbiAqIGFwcGx5IHJld3JpdGUgdGhlIGZpbGUgbmFtZWQgdGhlcmUgKGZvciBgZGlmZiAtdSBmLnR4dCBmLm5ld2AsIHRoZSBgKysrYFxuICogc2lkZSBpcyBvbmx5IGEgbGFiZWwpLCBzbyB0aGUgYCsrK2AgbGluZSBvdmVycmlkZXMgdGhlIHBhdGggb25seSBmb3IgdGhlXG4gKiBgL2Rldi9udWxsYCBtYXJrZXJzIFx1MjAxNCBhIGAtLS0gL2Rldi9udWxsYCBzaWRlIChhIG5ldyBmaWxlKSBuYW1lcyB0aGUgdGFyZ2V0XG4gKiBvbiBgKysrYCwgYW5kIGEgYCsrKyAvZGV2L251bGxgIHNpZGUgbWFya3MgYSBkZWxldGlvbi5cbiAqXG4gKiBNYWxmb3JtZWQgb3IgZW1wdHkgcGF0Y2ggdGV4dCByZXR1cm5zIG51bGwgKGZhaWwgY2xvc2VkIFx1MjAxNCB0aGUgY2FsbGVyIGVtaXRzXG4gKiB1bnJlc29sdmVkIHJhdGhlciB0aGFuIGd1ZXNzaW5nIGF0IHRhcmdldHMpLlxuICovXG5cbi8qKiBUaGUgYC1wTmAgaGVhZGVyIHN0cmlwIGxldmVsOiBhIGNvbXBvbmVudCBjb3VudCwgb3IgcGF0Y2gncyBgJ2F1dG8nYCBkZWZhdWx0LiAqL1xuZXhwb3J0IHR5cGUgUGF0aFN0cmlwID0gbnVtYmVyIHwgJ2F1dG8nO1xuXG4vKiogT25lIGZpbGUgYSBwYXRjaCB0b3VjaGVzOiB0aGUgdGFyZ2V0IHBhdGgsIHRoZSB0b3VjaCBraW5kLCBhbmQgdGhlIGV4YWN0IHJhbmdlIHdoZW4gdGhlIGh1bmtzIHByZXNlcnZlIGxpbmUgY291bnRzLiAqL1xuZXhwb3J0IGludGVyZmFjZSBVbmlmaWVkRGlmZlRhcmdldCB7XG4gIHBhdGg6IHN0cmluZztcbiAgb3BlcmF0aW9uOiAnbW9kaWZ5JyB8ICdjcmVhdGUtb3ZlcndyaXRlJyB8ICdkZWxldGUnIHwgJ3JlbmFtZS1jb3B5JztcbiAgbGluZVN0YXJ0PzogbnVtYmVyO1xuICBsaW5lRW5kPzogbnVtYmVyO1xufVxuXG5jb25zdCBIVU5LX0hFQURFUiA9IC9eQEAgLShcXGQrKSg/OiwoXFxkKykpPyBcXCsoXFxkKykoPzosKFxcZCspKT8gQEAvO1xuXG4vKiogU3RyaXAgdGhlIGZpcnN0IGBuYCBsZWFkaW5nIHBhdGggY29tcG9uZW50cyAoYC1wTmApLCBzdG9wcGluZyBhdCBhIGNvbXBvbmVudC1sZXNzIHBhdGguICovXG5mdW5jdGlvbiBzdHJpcFBhdGhDb21wb25lbnRzKHA6IHN0cmluZywgbjogbnVtYmVyKTogc3RyaW5nIHtcbiAgbGV0IHMgPSBwO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IG47IGkrKykge1xuICAgIGNvbnN0IHNsYXNoID0gcy5pbmRleE9mKCcvJyk7XG4gICAgaWYgKHNsYXNoID09PSAtMSkgcmV0dXJuIHM7XG4gICAgcyA9IHMuc2xpY2Uoc2xhc2ggKyAxKTtcbiAgfVxuICByZXR1cm4gcztcbn1cblxuLyoqXG4gKiBUaGUgbGV2ZWwgdG8gc3RyaXAgZnJvbSBgcmF3YCB1bmRlciBgc3RyaXBgOiBhIG51bWJlciBwYXNzZXMgdGhyb3VnaDsgYCdhdXRvJ2BcbiAqIHJlc29sdmVzIHRvIHAxIHdoZW4gdGhlIHBhdGggaXMgYGEvYC9gYi9gLXByZWZpeGVkIGFuZCBwMCBvdGhlcndpc2UgXHUyMDE0IHBhdGNoJ3NcbiAqIGRlZmF1bHQgZm9yIGRpZmZzIHdob3NlIHByZWZpeGVzIGFyZSBgZGlmZiAtdWAtc3R5bGUgcmF0aGVyIHRoYW4gZ2l0J3MuXG4gKi9cbmZ1bmN0aW9uIHN0cmlwTGV2ZWxGb3IocmF3OiBzdHJpbmcsIHN0cmlwOiBQYXRoU3RyaXApOiBudW1iZXIge1xuICByZXR1cm4gc3RyaXAgPT09ICdhdXRvJyA/IChyYXcuc3RhcnRzV2l0aCgnYS8nKSB8fCByYXcuc3RhcnRzV2l0aCgnYi8nKSA/IDEgOiAwKSA6IHN0cmlwO1xufVxuXG4vKipcbiAqIFRoZSByYXcgYC0tLWAvYCsrK2AgaGVhZGVyIHBhdGg6IHRoZSB0ZXh0IHVwIHRvIHRoZSBmaXJzdCB0YWIgKHRoZVxuICogYGRpZmYgLXVgIHRpbWVzdGFtcCBjb2x1bW4pLCBvciB0aGUgd2hvbGUgd29yZCB3aGVuIHRoZXJlIGlzIG5vbmUuIENSTEZcbiAqIGlzIGhhbmRsZWQgYXQgdGhlIGxpbmUgbGV2ZWwgKHNlZSBwYXJzZVVuaWZpZWREaWZmUmFuZ2UpLCB3aGljaCBhbHNvXG4gKiBjb3ZlcnMgaHVuayBoZWFkZXJzLlxuICovXG5mdW5jdGlvbiBoZWFkZXJQYXRoVGV4dChyYXc6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRhYiA9IHJhdy5pbmRleE9mKCdcXHQnKTtcbiAgcmV0dXJuIHRhYiA9PT0gLTEgPyByYXcgOiByYXcuc2xpY2UoMCwgdGFiKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlVW5pZmllZERpZmZSYW5nZShwYXRjaFRleHQ6IHN0cmluZywgc3RyaXA6IFBhdGhTdHJpcCk6IFVuaWZpZWREaWZmVGFyZ2V0W10gfCBudWxsIHtcbiAgY29uc3QgcmVzdWx0czogVW5pZmllZERpZmZUYXJnZXRbXSA9IFtdO1xuICBsZXQgc2F3QmxvY2sgPSBmYWxzZTtcbiAgbGV0IGN1cnJlbnQ6IHtcbiAgICBwYXRoOiBzdHJpbmc7XG4gICAga2luZDogJ21vZGlmeScgfCAnbmV3JyB8ICdkZWxldGVkJztcbiAgICBodW5rczogQXJyYXk8eyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9PjtcbiAgICBjb3VudENoYW5naW5nOiBib29sZWFuO1xuICB9IHwgbnVsbCA9IG51bGw7XG4gIGxldCBwZW5kaW5nS2luZDogJ25ldycgfCAnZGVsZXRlZCcgfCBudWxsID0gbnVsbDtcbiAgbGV0IHJlbmFtZUZyb206IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBsZXQgcmVuYW1lVG86IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBsZXQgYmluYXJ5ID0gZmFsc2U7XG5cbiAgLyoqIFRoZSBoZWFkZXIgcGF0aCwgdGFiL0NSLXN0cmlwcGVkLCB3aXRoIHRoZSBgLXBOYCBsZXZlbCBhcHBsaWVkIFx1MjAxNCBgL2Rldi9udWxsYCBrZXB0IHZlcmJhdGltICh0aGUgbWFya2VyIGlzIG5ldmVyIGEgcmVhbCBwYXRoKS4gKi9cbiAgY29uc3Qgc3RyaXBwZWQgPSAocmF3OiBzdHJpbmcpOiBzdHJpbmcgPT4ge1xuICAgIGNvbnN0IHRleHQgPSBoZWFkZXJQYXRoVGV4dChyYXcpO1xuICAgIGlmICh0ZXh0ID09PSAnL2Rldi9udWxsJykgcmV0dXJuIHRleHQ7XG4gICAgcmV0dXJuIHN0cmlwUGF0aENvbXBvbmVudHModGV4dCwgc3RyaXBMZXZlbEZvcih0ZXh0LCBzdHJpcCkpO1xuICB9O1xuXG4gIGNvbnN0IGZpbmlzaCA9ICgpOiB2b2lkID0+IHtcbiAgICBpZiAoY3VycmVudCAhPT0gbnVsbCkge1xuICAgICAgaWYgKGN1cnJlbnQua2luZCA9PT0gJ25ldycpIHJlc3VsdHMucHVzaCh7IHBhdGg6IGN1cnJlbnQucGF0aCwgb3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZScgfSk7XG4gICAgICBlbHNlIGlmIChjdXJyZW50LmtpbmQgPT09ICdkZWxldGVkJykgcmVzdWx0cy5wdXNoKHsgcGF0aDogY3VycmVudC5wYXRoLCBvcGVyYXRpb246ICdkZWxldGUnIH0pO1xuICAgICAgZWxzZSBpZiAoYmluYXJ5KSByZXN1bHRzLnB1c2goeyBwYXRoOiBjdXJyZW50LnBhdGgsIG9wZXJhdGlvbjogJ21vZGlmeScgfSk7XG4gICAgICBlbHNlIGlmIChjdXJyZW50Lmh1bmtzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAvLyBBIGhlYWRlci1vbmx5IGJsb2NrIHdpdGggbm8gaHVua3M6IG5vdGhpbmcgc3RhdGljYWxseSBrbm93bi5cbiAgICAgIH0gZWxzZSBpZiAoY3VycmVudC5jb3VudENoYW5naW5nKSByZXN1bHRzLnB1c2goeyBwYXRoOiBjdXJyZW50LnBhdGgsIG9wZXJhdGlvbjogJ21vZGlmeScgfSk7XG4gICAgICBlbHNlIHtcbiAgICAgICAgY29uc3Qgc3RhcnQgPSBNYXRoLm1pbiguLi5jdXJyZW50Lmh1bmtzLm1hcCgoaCkgPT4gaC5zdGFydCkpO1xuICAgICAgICBjb25zdCBlbmQgPSBNYXRoLm1heCguLi5jdXJyZW50Lmh1bmtzLm1hcCgoaCkgPT4gaC5lbmQpKTtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHsgcGF0aDogY3VycmVudC5wYXRoLCBvcGVyYXRpb246ICdtb2RpZnknLCBsaW5lU3RhcnQ6IHN0YXJ0LCBsaW5lRW5kOiBlbmQgfSk7XG4gICAgICB9XG4gICAgICBjdXJyZW50ID0gbnVsbDtcbiAgICB9XG4gICAgaWYgKHJlbmFtZUZyb20gIT09IG51bGwpIHJlc3VsdHMucHVzaCh7IHBhdGg6IHJlbmFtZUZyb20sIG9wZXJhdGlvbjogJ2RlbGV0ZScgfSk7XG4gICAgaWYgKHJlbmFtZVRvICE9PSBudWxsKSByZXN1bHRzLnB1c2goeyBwYXRoOiByZW5hbWVUbywgb3BlcmF0aW9uOiAncmVuYW1lLWNvcHknIH0pO1xuICAgIHJlbmFtZUZyb20gPSBudWxsO1xuICAgIHJlbmFtZVRvID0gbnVsbDtcbiAgICBiaW5hcnkgPSBmYWxzZTtcbiAgfTtcblxuICBmb3IgKGNvbnN0IHJhd0xpbmUgb2YgcGF0Y2hUZXh0LnNwbGl0KCdcXG4nKSkge1xuICAgIC8vIEEgdHJhaWxpbmcgYFxccmAgKENSTEYgcGF0Y2ggdGV4dCBcdTIwMTQgV2luZG93cy1hdXRob3JlZCBkaWZmcykgcG9sbHV0ZXNcbiAgICAvLyBoZWFkZXJzLCBodW5rIGhlYWRlcnMsIGFuZCBwYXRoIGxpbmVzIGFsaWtlOyBib3RoIHBhdGNoIGFuZCBnaXQgYXBwbHlcbiAgICAvLyBzdHJpcCBpdCwgc28gdGhlIHBhcnNlciBkb2VzIHRvby5cbiAgICBjb25zdCBsaW5lID0gcmF3TGluZS5lbmRzV2l0aCgnXFxyJykgPyByYXdMaW5lLnNsaWNlKDAsIC0xKSA6IHJhd0xpbmU7XG4gICAgaWYgKGxpbmUuc3RhcnRzV2l0aCgnLS0tICcpKSB7XG4gICAgICBzYXdCbG9jayA9IHRydWU7XG4gICAgICBpZiAoY3VycmVudCAhPT0gbnVsbCkgZmluaXNoKCk7XG4gICAgICBjdXJyZW50ID0ge1xuICAgICAgICBwYXRoOiBzdHJpcHBlZChsaW5lLnNsaWNlKDQpKSxcbiAgICAgICAga2luZDogcGVuZGluZ0tpbmQgPz8gJ21vZGlmeScsXG4gICAgICAgIGh1bmtzOiBbXSxcbiAgICAgICAgY291bnRDaGFuZ2luZzogZmFsc2VcbiAgICAgIH07XG4gICAgICBwZW5kaW5nS2luZCA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGxpbmUuc3RhcnRzV2l0aCgnKysrICcpKSB7XG4gICAgICBzYXdCbG9jayA9IHRydWU7XG4gICAgICBjb25zdCBwYXRoID0gc3RyaXBwZWQobGluZS5zbGljZSg0KSk7XG4gICAgICBpZiAoY3VycmVudCA9PT0gbnVsbCkgY3VycmVudCA9IHsgcGF0aCwga2luZDogcGVuZGluZ0tpbmQgPz8gJ21vZGlmeScsIGh1bmtzOiBbXSwgY291bnRDaGFuZ2luZzogZmFsc2UgfTtcbiAgICAgIGVsc2UgaWYgKHBhdGggPT09ICcvZGV2L251bGwnKSBjdXJyZW50LmtpbmQgPSAnZGVsZXRlZCc7XG4gICAgICBlbHNlIGlmIChjdXJyZW50LnBhdGggPT09ICcvZGV2L251bGwnKSB7XG4gICAgICAgIC8vIEEgYC0tLSAvZGV2L251bGxgIHNpZGUgcmVwbGFjZWQgYnkgYSByZWFsIGArKytgIHBhdGggaXMgYSBuZXcgZmlsZVxuICAgICAgICAvLyAodGhlIGBkaWZmIC11YC1mb3JtYXQgY3JlYXRpb24gc2hhcGUgXHUyMDE0IG5vIGBuZXcgZmlsZSBtb2RlYCBoZWFkZXIpLlxuICAgICAgICAvLyBJdHMgYEBAIC0wLDAgK04gQEBgIGh1bmsgaGFzIG5vIHByZS1lZGl0IGxpbmVzLCBzbyB0aGVcbiAgICAgICAgLy8gY3JlYXRlLW92ZXJ3cml0ZSBpcyBkZWNpZGVkIGhlcmUsIG5vdCBmcm9tIGh1bmsgY292ZXJhZ2UuXG4gICAgICAgIGN1cnJlbnQucGF0aCA9IHBhdGg7XG4gICAgICAgIGN1cnJlbnQua2luZCA9ICduZXcnO1xuICAgICAgfVxuICAgICAgLy8gT3RoZXJ3aXNlIGtlZXAgdGhlIGAtLS1gIHNpZGU6IHBhdGNoIGFuZCBnaXQgYXBwbHkgcmV3cml0ZSB0aGUgZmlsZVxuICAgICAgLy8gbmFtZWQgb24gdGhlIGAtLS1gIGxpbmUsIGFuZCBgZGlmZiAtdSBmIGYubmV3YCBoZWFkZXJzIG5hbWUgdGhlXG4gICAgICAvLyBwcmUtaW1hZ2UgdGhlcmUgXHUyMDE0IHRoZSBgKysrYCBwYXRoIGlzIG9ubHkgYSBsYWJlbCAodGhlIGRpZmYtdXVcbiAgICAgIC8vIHBhdGNoLWhlYWRlciBtaXNzKS5cbiAgICAgIHBlbmRpbmdLaW5kID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZS5zdGFydHNXaXRoKCduZXcgZmlsZSBtb2RlJykpIHtcbiAgICAgIHBlbmRpbmdLaW5kID0gJ25ldyc7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGxpbmUuc3RhcnRzV2l0aCgnZGVsZXRlZCBmaWxlIG1vZGUnKSkge1xuICAgICAgcGVuZGluZ0tpbmQgPSAnZGVsZXRlZCc7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGxpbmUuc3RhcnRzV2l0aCgncmVuYW1lIGZyb20gJykpIHtcbiAgICAgIHNhd0Jsb2NrID0gdHJ1ZTtcbiAgICAgIGlmIChjdXJyZW50ICE9PSBudWxsKSBmaW5pc2goKTtcbiAgICAgIHJlbmFtZUZyb20gPSBzdHJpcHBlZChsaW5lLnNsaWNlKCdyZW5hbWUgZnJvbSAnLmxlbmd0aCkpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChsaW5lLnN0YXJ0c1dpdGgoJ3JlbmFtZSB0byAnKSkge1xuICAgICAgc2F3QmxvY2sgPSB0cnVlO1xuICAgICAgcmVuYW1lVG8gPSBzdHJpcHBlZChsaW5lLnNsaWNlKCdyZW5hbWUgdG8gJy5sZW5ndGgpKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZS5zdGFydHNXaXRoKCdCaW5hcnkgZmlsZXMgJykgfHwgbGluZS5zdGFydHNXaXRoKCdHSVQgYmluYXJ5IHBhdGNoJykpIHtcbiAgICAgIHNhd0Jsb2NrID0gdHJ1ZTtcbiAgICAgIGJpbmFyeSA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgaHVuayA9IGxpbmUubWF0Y2goSFVOS19IRUFERVIpO1xuICAgIGlmIChodW5rKSB7XG4gICAgICBzYXdCbG9jayA9IHRydWU7XG4gICAgICBjb25zdCBwcmVTdGFydCA9IE51bWJlci5wYXJzZUludChodW5rWzFdLCAxMCk7XG4gICAgICBjb25zdCBwcmVDb3VudCA9IGh1bmtbMl0gPT09IHVuZGVmaW5lZCA/IDEgOiBOdW1iZXIucGFyc2VJbnQoaHVua1syXSwgMTApO1xuICAgICAgY29uc3QgcG9zdENvdW50ID0gaHVua1s0XSA9PT0gdW5kZWZpbmVkID8gMSA6IE51bWJlci5wYXJzZUludChodW5rWzRdLCAxMCk7XG4gICAgICBpZiAoY3VycmVudCA9PT0gbnVsbCkgcmV0dXJuIG51bGw7IC8vIGEgaHVuayB3aXRob3V0IGEgZmlsZSBoZWFkZXIgXHUyMTkyIG1hbGZvcm1lZFxuICAgICAgaWYgKHByZUNvdW50ICE9PSBwb3N0Q291bnQpIGN1cnJlbnQuY291bnRDaGFuZ2luZyA9IHRydWU7XG4gICAgICBpZiAocHJlQ291bnQgPiAwKSBjdXJyZW50Lmh1bmtzLnB1c2goeyBzdGFydDogcHJlU3RhcnQsIGVuZDogcHJlU3RhcnQgKyBwcmVDb3VudCAtIDEgfSk7XG4gICAgfVxuICB9XG4gIGZpbmlzaCgpO1xuICByZXR1cm4gc2F3QmxvY2sgPyByZXN1bHRzIDogbnVsbDtcbn1cbiIsICIvKipcbiAqIENsYXVkZSBQb3N0VG9vbFVzZSB0b3VjaCBob29rIFx1MjAxNCB0aGluIFNESy1ib3VuZCBlbnRyeSBwb2ludC5cbiAqXG4gKiBGaXJlcyBhZnRlciBhIHN1Y2Nlc3NmdWwgYFJlYWRgL2BFZGl0YC9gV3JpdGVgLCBvciBhIGBCYXNoYCBjYWxsIHdob3NlXG4gKiBgY29tbWFuZGAgc3RhdGljYWxseSByZXNvbHZlcyB0byByZWNvZ25pemFibGUgZmlsZStsaW5lLXJhbmdlIGlkaW9tcy4gVGhlXG4gKiBDbGF1ZGUtc3BlY2lmaWMgam9iIGlzIHRyYW5zbGF0aW5nIHRoZSBzdHJ1Y3R1cmVkIGB0b29sX2lucHV0YFxuICogKGBmaWxlX3BhdGhgLCBgbmV3X3N0cmluZ2AvYGNvbnRlbnRgLCBgb2Zmc2V0YC9gbGltaXRgKSBhbmQgYHRvb2xfbmFtZWAgaW50b1xuICogYSBoYXJuZXNzLWFnbm9zdGljIHtAbGluayBUb3VjaElucHV0fSwgdGhlbiBoYW5kaW5nIG9mZiB0byB0aGUgc2hhcmVkXG4gKiB7QGxpbmsgcnVuVG91Y2hIb29rfSBjb3JlOiBvbiBhIHdyaXRlIGl0IGhlYWxzXG4gKiBwb3NpdGlvbmFsIHNwYW4gZHJpZnQgaW4gdGhlIHdvcmtpbmcgdHJlZSAoYGdpdCBzcGFuIGRyaWZ0IDxmaWxlPiAtLWZpeGApIGFuZFxuICogZm9sZHMgYW55IHNlbWFudGljIHJlc2lkdWUgaW50byBvbmUgYDxnaXQtc3Bhbj5gIGJsb2NrOyBvbiBhIHJlYWQgaXQgc3VyZmFjZXNcbiAqIHNwYW5zIG92ZXJsYXBwaW5nIHRoZSByZWFkJ3MgYG9mZnNldGAvYGxpbWl0YCB3aW5kb3cgKHdob2xlLWZpbGUgd2hlbiBuZWl0aGVyXG4gKiBpcyBnaXZlbikgd2l0aCBwb3NpdGlvbmFsIHN0YXR1c2VzIGZpbHRlcmVkIG91dCwgYW5kIG5ldmVyIG11dGF0ZXMgdGhlIHRyZWUuXG4gKlxuICogVGhlIGJsb2NrIHJlYWNoZXMgdGhlIG1vZGVsIGxvb3AgdmlhIGBob29rU3BlY2lmaWNPdXRwdXQuYWRkaXRpb25hbENvbnRleHRgIGFuZFxuICogdGhlIHVzZXItZmFjaW5nIFVJIHZpYSBgc3lzdGVtTWVzc2FnZWAuIEZhaWwtb3BlbiBpcyBsb2FkLWJlYXJpbmc6IGFuIGFic2VudFxuICogQ0xJL2Auc3Bhbi9gLCB0aW1lb3V0LCBvciBub24temVybyBleGl0IHlpZWxkcyBubyBzaWduYWwgYW5kIG5ldmVyIGJsb2NrcyB0aGVcbiAqIHRvb2wgY2FsbC4gVGhlIHRpbWVvdXQgaXMgbWlsbGlzZWNvbmRzIGhlcmUgKHRoZSBDbGF1ZGUgQ0xJIGVtaXRzIG1zIGludG9cbiAqIGBob29rcy5qc29uYCk7IENvZGV4J3MgZXF1aXZhbGVudCBzb3VyY2UgdmFsdWUgaXMgZGl2aWRlZCB0byBzZWNvbmRzIGF0IGVtaXQuXG4gKi9cblxuaW1wb3J0IHtcbiAgdHlwZSBIb29rQ29udGV4dCxcbiAgdHlwZSBQb3N0VG9vbFVzZUlucHV0LFxuICBwb3N0VG9vbFVzZUhvb2ssXG4gIHBvc3RUb29sVXNlT3V0cHV0XG59IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG5pbXBvcnQgeyBkZXJpdmVQYXRoIH0gZnJvbSAnLi4vY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyBiYXNoUmVzcG9uc2VJbnRlcnJ1cHRlZCwgcnVuQmFzaFRvdWNoZXMgfSBmcm9tICcuLi9jb21tb24vYmFzaC10b3VjaC5qcyc7XG5pbXBvcnQgeyBwYXJzZUNvbW1hbmREZXRhaWxlZCB9IGZyb20gJy4uL2NvbW1vbi9wYXJzZS1jb21tYW5kLmpzJztcbmltcG9ydCB7IGNyZWF0ZURpc2tNZW1vU3RvcmUsIHR5cGUgTWVtb0ZhY3RvcnksIHJlc29sdmVUb3VjaFNjb3BlIH0gZnJvbSAnLi4vY29tbW9uL3NwYW4tc3VyZmFjZS5qcyc7XG5pbXBvcnQge1xuICBjcmVhdGVEZWZhdWx0VG91Y2hFeGVjdXRvcnMsXG4gIHJ1blRvdWNoSG9vayxcbiAgdHlwZSBUb3VjaEV4ZWN1dG9ycyxcbiAgdHlwZSBUb3VjaElucHV0XG59IGZyb20gJy4uL2NvbW1vbi90b3VjaC1jb3JlLmpzJztcblxudHlwZSBUb29sSW5wdXQgPSBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcblxuLyoqIFJlYWQgYSBgVG9vbElucHV0YCBmaWVsZCBhcyBhIHBvc2l0aXZlIGludGVnZXIsIG9yIGB1bmRlZmluZWRgIHdoZW4gYWJzZW50L2ludmFsaWQuICovXG5mdW5jdGlvbiBwb3NpdGl2ZUludEZpZWxkKHRvb2xJbnB1dDogVG9vbElucHV0LCBmaWVsZDogc3RyaW5nKTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgcmF3ID0gdG9vbElucHV0W2ZpZWxkXTtcbiAgcmV0dXJuIHR5cGVvZiByYXcgPT09ICdudW1iZXInICYmIE51bWJlci5pc0ludGVnZXIocmF3KSAmJiByYXcgPiAwID8gcmF3IDogdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIFRyYW5zbGF0ZSBhIENsYXVkZSB0b29sIGNhbGwgaW50byBhIHtAbGluayBUb3VjaElucHV0fS4gYFJlYWRgIGlzIGEgcmVhZCB0b3VjaFxuICogY2FycnlpbmcgaXRzIGBvZmZzZXRgL2BsaW1pdGAgKHdoZW4gcHJlc2VudCkgZm9yIHJhbmdlLXByZWNpc2Ugc2NvcGluZztcbiAqIGBFZGl0YC9gV3JpdGVgIGFyZSB3cml0ZSB0b3VjaGVzIHdob3NlIGB3cml0dGVuYCBibG9jayBpcyB0aGUgbmV3IGNvbnRlbnQgdGhlXG4gKiB0b29sIGp1c3QgYXBwbGllZCAoYG5ld19zdHJpbmdgIGZvciBFZGl0LCBgY29udGVudGAgZm9yIFdyaXRlKS4gQW4gdW5rbm93biB0b29sXG4gKiBvciBhIG5vbi1zdHJpbmcgY29udGVudCBmaWVsZCB5aWVsZHMgYG51bGxgIChub3RoaW5nIHRvIGRvKS5cbiAqL1xuZnVuY3Rpb24gdG9Ub3VjaElucHV0KFxuICB0b29sTmFtZTogc3RyaW5nLFxuICB0b29sSW5wdXQ6IFRvb2xJbnB1dCxcbiAgc2Vzc2lvbklkOiBzdHJpbmcsXG4gIGN3ZDogc3RyaW5nLFxuICBmaWxlUGF0aDogc3RyaW5nXG4pOiBUb3VjaElucHV0IHwgbnVsbCB7XG4gIGlmICh0b29sTmFtZSA9PT0gJ1JlYWQnKSB7XG4gICAgY29uc3Qgb2Zmc2V0ID0gcG9zaXRpdmVJbnRGaWVsZCh0b29sSW5wdXQsICdvZmZzZXQnKTtcbiAgICBjb25zdCBsaW1pdCA9IHBvc2l0aXZlSW50RmllbGQodG9vbElucHV0LCAnbGltaXQnKTtcbiAgICByZXR1cm4geyBraW5kOiAncmVhZCcsIHNlc3Npb25JZCwgY3dkLCBmaWxlUGF0aCwgb2Zmc2V0LCBsaW1pdCB9O1xuICB9XG4gIGlmICh0b29sTmFtZSA9PT0gJ0VkaXQnIHx8IHRvb2xOYW1lID09PSAnV3JpdGUnKSB7XG4gICAgY29uc3QgcmF3ID0gdG9vbE5hbWUgPT09ICdFZGl0JyA/IHRvb2xJbnB1dC5uZXdfc3RyaW5nIDogdG9vbElucHV0LmNvbnRlbnQ7XG4gICAgY29uc3Qgd3JpdHRlbiA9IHR5cGVvZiByYXcgPT09ICdzdHJpbmcnID8gcmF3IDogJyc7XG4gICAgLy8gVGhlIEVkaXQvV3JpdGUgcGF0aCBwYXNzZXMgJ2V4aXN0cycgXHUyMDE0IHRoZSB0b29sIHJhbiwgc28gdGhlIGZpbGUgaXNcbiAgICAvLyBwcmVzZW50OyB0aGUgd3JpdGUgZ2F0ZSAocGxhbiBcdTAwQTczIHN0ZXAgMSkgdmVyaWZpZXMgaXQgYmVmb3JlIGFueVxuICAgIC8vIGV4ZWN1dG9yIGNhbGwuXG4gICAgcmV0dXJuIHsga2luZDogJ3dyaXRlJywgc2Vzc2lvbklkLCBjd2QsIGZpbGVQYXRoLCB3cml0dGVuLCB0YXJnZXRTdGF0ZTogJ2V4aXN0cycgfTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUhhbmRsZXIoXG4gIGV4ZWN1dG9yczogVG91Y2hFeGVjdXRvcnMgPSBjcmVhdGVEZWZhdWx0VG91Y2hFeGVjdXRvcnMoKSxcbiAgbWVtb0ZhY3Rvcnk6IE1lbW9GYWN0b3J5ID0gY3JlYXRlRGlza01lbW9TdG9yZVxuKSB7XG4gIHJldHVybiBhc3luYyAoaW5wdXQ6IFBvc3RUb29sVXNlSW5wdXQsIGN0eDogSG9va0NvbnRleHQpID0+IHtcbiAgICBjb25zdCBtZW1vID0gbWVtb0ZhY3RvcnkoY3R4LmxvZ2dlcik7XG4gICAgY29uc3Qgc2Vzc2lvbklkID0gaW5wdXQuc2Vzc2lvbl9pZDtcbiAgICBjb25zdCBjd2QgPSBpbnB1dC5jd2QgPz8gJyc7XG4gICAgY29uc3QgdG9vbE5hbWUgPSBpbnB1dC50b29sX25hbWU7XG4gICAgY29uc3QgdG9vbElucHV0ID0gKGlucHV0LnRvb2xfaW5wdXQgPz8ge30pIGFzIFRvb2xJbnB1dDtcblxuICAgIC8vIEJhc2ggaGFzIG5vIGBmaWxlX3BhdGhgIGZpZWxkLCBzbyBpdCBnZXRzIGl0cyBvd24gYnJhbmNoOiBydW4gdGhlIHN0YXRpY1xuICAgIC8vIGNvbW1hbmQgcGFyc2VyIGFuZCBoYW5kIHRoZSBtYXRjaGVzIHRvIHRoZSBzaGFyZWQgYHJ1bkJhc2hUb3VjaGVzYFxuICAgIC8vIGRyaXZlciAocGxhbiBcdTAwQTczIHN0ZXAgMiksIHdoaWNoIG93bnMgdGhlIHBlci1jb21tYW5kIHZlcmRpY3QgdGhyZWFkIFx1MjAxNFxuICAgIC8vIHBvc3Qtc3RhdGUgZ2F0ZXMsIGpvaW4gZmlsdGVyaW5nLCBhbmQgdGhlIGludGVycnVwdGVkIGdhdGUgKHBsYW4gXHUwMEE3NCkgXHUyMDE0XG4gICAgLy8gYW5kIHJldHVybnMgdGhlIG1lcmdlZCBibG9ja3MgZm9yIHRoZSBhZGFwdGVycycgb3V0cHV0IGJ1aWxkZXJzLiBBXG4gICAgLy8gY29tbWFuZCB3aXRoIG5vIHJlY29nbml6YWJsZSBpZGlvbSB5aWVsZHMgbm8gYmxvY2tzIGFuZCByZXR1cm5zIGBudWxsYCBcdTIwMTRcbiAgICAvLyBmYWlsLW9wZW4sIHNhbWUgYXMgdGhlIHRvb2wgcGF0aCBiZWxvdy5cbiAgICBpZiAodG9vbE5hbWUgPT09ICdCYXNoJykge1xuICAgICAgY29uc3QgY29tbWFuZCA9IHR5cGVvZiB0b29sSW5wdXQuY29tbWFuZCA9PT0gJ3N0cmluZycgPyB0b29sSW5wdXQuY29tbWFuZCA6IG51bGw7XG4gICAgICBpZiAoIWNvbW1hbmQpIHJldHVybiBudWxsO1xuICAgICAgLy8gQW4gaW50ZXJydXB0ZWQgY29tbWFuZCBwcm9kdWNlcyBubyB0b3VjaGVzLCB3aGF0ZXZlciBpdHMgc3BhbnM7IHRoZVxuICAgICAgLy8gZHJpdmVyIHJlLWNoZWNrcyBkZWZlbnNpdmVseS5cbiAgICAgIGlmIChiYXNoUmVzcG9uc2VJbnRlcnJ1cHRlZChpbnB1dC50b29sX3Jlc3BvbnNlKSkgcmV0dXJuIG51bGw7XG4gICAgICBjb25zdCBtYXRjaGVzID0gcGFyc2VDb21tYW5kRGV0YWlsZWQoY29tbWFuZCwgY3dkKTtcbiAgICAgIGNvbnN0IGJsb2NrcyA9IGF3YWl0IHJ1bkJhc2hUb3VjaGVzKG1hdGNoZXMsIHNlc3Npb25JZCwgY3dkLCBpbnB1dC50b29sX3Jlc3BvbnNlLCBleGVjdXRvcnMsIG1lbW8sIChtZXNzYWdlKSA9PlxuICAgICAgICBjdHgubG9nZ2VyLndhcm4obWVzc2FnZSlcbiAgICAgICk7XG4gICAgICBpZiAoYmxvY2tzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gICAgICBjb25zdCBjb21iaW5lZCA9IGJsb2Nrcy5qb2luKCcnKTtcbiAgICAgIHJldHVybiBwb3N0VG9vbFVzZU91dHB1dCh7XG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dDogeyBhZGRpdGlvbmFsQ29udGV4dDogY29tYmluZWQgfSxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogY29tYmluZWRcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGFic1BhdGggPSBkZXJpdmVQYXRoKHRvb2xJbnB1dCwgY3dkKTtcbiAgICBpZiAoIWFic1BhdGgpIHJldHVybiBudWxsO1xuXG4gICAgLy8gQm91bmQgdGhlIHRvdWNoIHRvIHRoZSBDV0QgcmVwbyAoZHJvcHMgY3Jvc3MtcmVwbywgZ2l0aWdub3JlZCwgYW5kIHNwYW5cbiAgICAvLyBkb2N1bWVudHMpLiBGYWlsIGNsb3NlZCBvbiBhbiB1bnJlc29sdmFibGUgQ1dEIHJlcG8uXG4gICAgY29uc3Qgc2NvcGUgPSByZXNvbHZlVG91Y2hTY29wZShjd2QsIGFic1BhdGgpO1xuICAgIGlmICghc2NvcGUpIHJldHVybiBudWxsO1xuXG4gICAgY29uc3QgdG91Y2ggPSB0b1RvdWNoSW5wdXQodG9vbE5hbWUsIHRvb2xJbnB1dCwgc2Vzc2lvbklkLCBjd2QsIGFic1BhdGgpO1xuICAgIGlmICghdG91Y2gpIHJldHVybiBudWxsO1xuXG4gICAgY29uc3Qgb3V0cHV0ID0gYXdhaXQgcnVuVG91Y2hIb29rKHRvdWNoLCBleGVjdXRvcnMsIG1lbW8pO1xuICAgIGlmICghb3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KSByZXR1cm4gbnVsbDtcblxuICAgIHJldHVybiBwb3N0VG9vbFVzZU91dHB1dCh7XG4gICAgICBob29rU3BlY2lmaWNPdXRwdXQ6IHsgYWRkaXRpb25hbENvbnRleHQ6IG91dHB1dC5hZGRpdGlvbmFsQ29udGV4dCB9LFxuICAgICAgc3lzdGVtTWVzc2FnZTogb3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0XG4gICAgfSk7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IHBvc3RUb29sVXNlSG9vayh7IG1hdGNoZXI6ICdSZWFkfEVkaXR8V3JpdGV8QmFzaCcsIHRpbWVvdXQ6IDEwXzAwMCB9LCBjcmVhdGVIYW5kbGVyKCkpO1xuIiwgImltcG9ydCBob29rIGZyb20gJy4vcG9zdC10b29sLXVzZS50cyc7XG5pbXBvcnQgeyBleGVjdXRlIH0gZnJvbSAnLi4vLi4vLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcy9kaXN0L3J1bnRpbWUuanMnO1xuXG5leGVjdXRlKGhvb2spO1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7QUFrQ0EsWUFBWSxRQUFRO0FBTWIsSUFBTSxrQkFBa0I7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBSzNCLGFBQWE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFNYixVQUFVO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQUtWLFFBQVE7QUFDWjtBQWtDTyxTQUFTLGlCQUFpQjtBQUM3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QUFRLGFBQWEsVUFBVSxXQUFXLFdBQVcsS0FBSyxPQUFPO0FBQ3ZFLFFBQUksQ0FBQyxNQUFPLFFBQU87QUFFbkIsVUFBTSxTQUFTLE1BQU0sYUFBYSxPQUFPLFdBQVcsSUFBSTtBQUN4RCxRQUFJLENBQUMsT0FBTyxrQkFBbUIsUUFBTztBQUV0QyxXQUFPLGtCQUFrQjtBQUFBLE1BQ3ZCLG9CQUFvQixFQUFFLG1CQUFtQixPQUFPLGtCQUFrQjtBQUFBLE1BQ2xFLGVBQWUsT0FBTztBQUFBLElBQ3hCLENBQUM7QUFBQSxFQUNIO0FBQ0Y7QUFFQSxJQUFPLHdCQUFRLGdCQUFnQixFQUFFLFNBQVMsd0JBQXdCLFNBQVMsSUFBTyxHQUFHLGNBQWMsQ0FBQzs7O0FDbElwRyxRQUFRLHFCQUFJOyIsCiAgIm5hbWVzIjogWyJyZXNvbHZlIiwgImZzIiwgImV4ZWNGaWxlU3luYyIsICJmcyIsICJub2RlUGF0aCIsICJmcyIsICJub2RlUGF0aCIsICJsb2dnZXIiLCAiZXhlY0ZpbGVTeW5jIiwgImZzIiwgImJhc2VuYW1lIiwgImpvaW4iLCAiZXhlY0ZpbGVTeW5jIiwgImpvaW4iLCAiYmFzZW5hbWUiLCAiam9pbiIsICJyZWFkRmlsZVN5bmMiLCAic3RhdFN5bmMiLCAiYmFzZW5hbWUiLCAiZXhlY0ZpbGVTeW5jIiwgInJlYWRGaWxlU3luYyIsICJzdGF0U3luYyIsICJqb2luIiwgInN0YXRTeW5jIiwgImJhc2VuYW1lIiwgInJlYWRGaWxlU3luYyIsICJ0b2tlbnMiXQp9Cg==

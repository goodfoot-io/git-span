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
function bashResponseExitCode(toolResponse) {
  if (toolResponse !== null && typeof toolResponse === "object") {
    const code = toolResponse.exit_code;
    if (typeof code === "number" && Number.isInteger(code)) return code;
  }
  return void 0;
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
  for (const m of resolved) {
    if (m.span.operation === "delete") probePaths.push(m.span.absolutePath);
    else if ((m.idiom === "cp-write" || m.idiom === "install-write") && m.span.operation === "read") {
      probePaths.push(m.span.absolutePath);
    }
  }
  const probeCache = createRealityProbeCache(probePaths);
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcy9kaXN0L2Vudi5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL3NwYW4tc3VyZmFjZS50cyIsICJzcmMvY29tbW9uL3NwYW4taWdub3JlLnRzIiwgInNyYy9jb21tb24vdG91Y2gtY29yZS50cyIsICJzcmMvY29tbW9uL2FuY2hvci10cmVlLnRzIiwgInNyYy9jb21tb24vYmFzaC10b3VjaC50cyIsICJzcmMvY29tbW9uL3BhcnNlLWNvbW1hbmQudHMiLCAic3JjL2NvbW1vbi9jb21tYW5kLXJlc29sdmUudHMiLCAic3JjL2NvbW1vbi9zaGVsbC1zcGxpdC50cyIsICJzcmMvY29tbW9uL3VuaWZpZWQtZGlmZi50cyIsICJzcmMvY2xhdWRlL3Bvc3QtdG9vbC11c2UudHMiLCAic3JjL2NsYXVkZS9wb3N0LXRvb2wtdXNlLWVudHJ5LnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvKipcbiAqIEVudmlyb25tZW50IHZhcmlhYmxlIHV0aWxpdGllcyBmb3IgQ2xhdWRlIENvZGUgaG9va3MuXG4gKlxuICogUHJvdmlkZXMgdHlwZWQgYWNjZXNzIHRvIENsYXVkZSBDb2RlJ3MgZW52aXJvbm1lbnQgdmFyaWFibGVzIGFuZCB1dGlsaXRpZXNcbiAqIGZvciBwZXJzaXN0aW5nIGVudmlyb25tZW50IHZhcmlhYmxlcyBpbiBTZXNzaW9uU3RhcnQgaG9va3MuXG4gKlxuICogIyMgRW52aXJvbm1lbnQgVmFyaWFibGVzXG4gKlxuICogQ2xhdWRlIENvZGUgc2V0cyB0aGVzZSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgd2hlbiBydW5uaW5nIGhvb2tzOlxuICpcbiAqIHwgVmFyaWFibGUgfCBEZXNjcmlwdGlvbiB8IEF2YWlsYWJsZSBJbiB8XG4gKiB8LS0tLS0tLS0tLXwtLS0tLS0tLS0tLS0tfC0tLS0tLS0tLS0tLS0tfFxuICogfCBgQ0xBVURFX1BST0pFQ1RfRElSYCB8IEFic29sdXRlIHBhdGggdG8gcHJvamVjdCByb290IHwgQWxsIGhvb2tzIHxcbiAqIHwgYENMQVVERV9FTlZfRklMRWAgfCBQYXRoIHRvIGZpbGUgZm9yIHBlcnNpc3RpbmcgZW52IHZhcnMgfCBTZXNzaW9uU3RhcnQgb25seSB8XG4gKiB8IGBDTEFVREVfQ09ERV9SRU1PVEVgIHwgYFwidHJ1ZVwiYCBpZiBydW5uaW5nIHJlbW90ZWx5IHwgQWxsIGhvb2tzIHxcbiAqIEBtb2R1bGVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBnZXRQcm9qZWN0RGlyLCBwZXJzaXN0RW52VmFyLCBpc1JlbW90ZUVudmlyb25tZW50IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBHZXQgcHJvamVjdCBkaXJlY3RvcnlcbiAqIGNvbnN0IHByb2plY3REaXIgPSBnZXRQcm9qZWN0RGlyKCk7XG4gKlxuICogLy8gQ2hlY2sgaWYgcnVubmluZyByZW1vdGVseVxuICogaWYgKGlzUmVtb3RlRW52aXJvbm1lbnQoKSkge1xuICogICAvLyBIYW5kbGUgcmVtb3RlLXNwZWNpZmljIGxvZ2ljXG4gKiB9XG4gKlxuICogLy8gSW4gU2Vzc2lvblN0YXJ0IGhvb2s6IHBlcnNpc3QgZW52aXJvbm1lbnQgdmFyaWFibGVzXG4gKiBwZXJzaXN0RW52VmFyKCdOT0RFX0VOVicsICdwcm9kdWN0aW9uJyk7XG4gKiBwZXJzaXN0RW52VmFyKCdBUElfS0VZJywgJ3NlY3JldC1rZXknKTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI2hvb2stZXhlY3V0aW9uLWRldGFpbHNcbiAqL1xuaW1wb3J0ICogYXMgZnMgZnJvbSBcIm5vZGU6ZnNcIjtcbi8qKlxuICogQ2xhdWRlIENvZGUgZW52aXJvbm1lbnQgdmFyaWFibGUgbmFtZXMuXG4gKlxuICogVGhlc2UgYXJlIHRoZSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgdGhhdCBDbGF1ZGUgQ29kZSBzZXRzIHdoZW4gcnVubmluZyBob29rcy5cbiAqL1xuZXhwb3J0IGNvbnN0IENMQVVERV9FTlZfVkFSUyA9IHtcbiAgICAvKipcbiAgICAgKiBBYnNvbHV0ZSBwYXRoIHRvIHRoZSBwcm9qZWN0IHJvb3QgZGlyZWN0b3J5IHdoZXJlIENsYXVkZSBDb2RlIHdhcyBzdGFydGVkLlxuICAgICAqIEF2YWlsYWJsZSBpbiBhbGwgaG9va3MuXG4gICAgICovXG4gICAgUFJPSkVDVF9ESVI6IFwiQ0xBVURFX1BST0pFQ1RfRElSXCIsXG4gICAgLyoqXG4gICAgICogUGF0aCB0byBhIGZpbGUgd2hlcmUgU2Vzc2lvblN0YXJ0IGhvb2tzIGNhbiBwZXJzaXN0IGVudmlyb25tZW50IHZhcmlhYmxlcy5cbiAgICAgKiBWYXJpYWJsZXMgd3JpdHRlbiB0byB0aGlzIGZpbGUgd2lsbCBiZSBhdmFpbGFibGUgaW4gYWxsIHN1YnNlcXVlbnQgYmFzaCBjb21tYW5kcy5cbiAgICAgKiBPbmx5IGF2YWlsYWJsZSBpbiBTZXNzaW9uU3RhcnQgaG9va3MuXG4gICAgICovXG4gICAgRU5WX0ZJTEU6IFwiQ0xBVURFX0VOVl9GSUxFXCIsXG4gICAgLyoqXG4gICAgICogU2V0IHRvIFwidHJ1ZVwiIHdoZW4gcnVubmluZyBpbiBhIHJlbW90ZSAod2ViKSBlbnZpcm9ubWVudC5cbiAgICAgKiBOb3Qgc2V0IG9yIGVtcHR5IHdoZW4gcnVubmluZyBpbiBsb2NhbCBDTEkgZW52aXJvbm1lbnQuXG4gICAgICovXG4gICAgUkVNT1RFOiBcIkNMQVVERV9DT0RFX1JFTU9URVwiLFxufTtcbi8qKlxuICogR2V0cyB0aGUgQ2xhdWRlIENvZGUgcHJvamVjdCBkaXJlY3RvcnkuXG4gKlxuICogVGhpcyBpcyB0aGUgYWJzb2x1dGUgcGF0aCB0byB0aGUgcHJvamVjdCByb290IHdoZXJlIENsYXVkZSBDb2RlIHdhcyBzdGFydGVkLlxuICogVGhlIHZhbHVlIGNvbWVzIGZyb20gdGhlIGBDTEFVREVfUFJPSkVDVF9ESVJgIGVudmlyb25tZW50IHZhcmlhYmxlLlxuICogQHJldHVybnMgVGhlIHByb2plY3QgZGlyZWN0b3J5IHBhdGgsIG9yIHVuZGVmaW5lZCBpZiBub3Qgc2V0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogY29uc3QgcHJvamVjdERpciA9IGdldFByb2plY3REaXIoKTtcbiAqIGlmIChwcm9qZWN0RGlyKSB7XG4gKiAgIGNvbnN0IGNvbmZpZ1BhdGggPSBgJHtwcm9qZWN0RGlyfS8uY2xhdWRlL2NvbmZpZy5qc29uYDtcbiAqIH1cbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0UHJvamVjdERpcigpIHtcbiAgICByZXR1cm4gcHJvY2Vzcy5lbnZbQ0xBVURFX0VOVl9WQVJTLlBST0pFQ1RfRElSXTtcbn1cbi8qKlxuICogR2V0cyB0aGUgQ2xhdWRlIENvZGUgZW52IGZpbGUgcGF0aCBmb3IgcGVyc2lzdGluZyBlbnZpcm9ubWVudCB2YXJpYWJsZXMuXG4gKlxuICogVGhpcyBpcyBvbmx5IGF2YWlsYWJsZSBpbiBTZXNzaW9uU3RhcnQgaG9va3MuIFRoZSBwYXRoIHBvaW50cyB0byBhIGZpbGVcbiAqIHdoZXJlIHlvdSBjYW4gd3JpdGUgc2hlbGwgZXhwb3J0IHN0YXRlbWVudHMgdG8gcGVyc2lzdCBlbnZpcm9ubWVudCB2YXJpYWJsZXNcbiAqIGZvciBhbGwgc3Vic2VxdWVudCBiYXNoIGNvbW1hbmRzIGluIHRoZSBzZXNzaW9uLlxuICogQHJldHVybnMgVGhlIGVudiBmaWxlIHBhdGgsIG9yIHVuZGVmaW5lZCBpZiBub3Qgc2V0IChub3QgYSBTZXNzaW9uU3RhcnQgaG9vaylcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCBlbnZGaWxlID0gZ2V0RW52RmlsZVBhdGgoKTtcbiAqIGlmIChlbnZGaWxlKSB7XG4gKiAgIC8vIFdlJ3JlIGluIGEgU2Vzc2lvblN0YXJ0IGhvb2sgYW5kIGNhbiBwZXJzaXN0IGVudiB2YXJzXG4gKiAgIHBlcnNpc3RFbnZWYXIoJ01ZX1ZBUicsICdteS12YWx1ZScpO1xuICogfVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRFbnZGaWxlUGF0aCgpIHtcbiAgICByZXR1cm4gcHJvY2Vzcy5lbnZbQ0xBVURFX0VOVl9WQVJTLkVOVl9GSUxFXTtcbn1cbi8qKlxuICogQ2hlY2tzIGlmIHRoZSBob29rIGlzIHJ1bm5pbmcgaW4gYSByZW1vdGUgKHdlYikgZW52aXJvbm1lbnQuXG4gKlxuICogUmVtb3RlIGVudmlyb25tZW50cyBtYXkgaGF2ZSBkaWZmZXJlbnQgY2FwYWJpbGl0aWVzIG9yIHJlc3RyaWN0aW9uc1xuICogY29tcGFyZWQgdG8gbG9jYWwgQ0xJIGVudmlyb25tZW50cy5cbiAqIEByZXR1cm5zIHRydWUgaWYgcnVubmluZyByZW1vdGVseSwgZmFsc2UgaWYgcnVubmluZyBsb2NhbGx5XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaWYgKGlzUmVtb3RlRW52aXJvbm1lbnQoKSkge1xuICogICAvLyBVc2Ugd2ViLWNvbXBhdGlibGUgYXBwcm9hY2hlc1xuICogfSBlbHNlIHtcbiAqICAgLy8gQ2FuIHVzZSBsb2NhbCBDTEkgZmVhdHVyZXNcbiAqIH1cbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNSZW1vdGVFbnZpcm9ubWVudCgpIHtcbiAgICByZXR1cm4gcHJvY2Vzcy5lbnZbQ0xBVURFX0VOVl9WQVJTLlJFTU9URV0gPT09IFwidHJ1ZVwiO1xufVxuLyoqXG4gKiBQZXJzaXN0cyBhbiBlbnZpcm9ubWVudCB2YXJpYWJsZSBmb3IgdXNlIGluIHN1YnNlcXVlbnQgYmFzaCBjb21tYW5kcy5cbiAqXG4gKiBUaGlzIGZ1bmN0aW9uIHdyaXRlcyBhIHNoZWxsIGV4cG9ydCBzdGF0ZW1lbnQgdG8gdGhlIGBDTEFVREVfRU5WX0ZJTEVgLFxuICogd2hpY2ggQ2xhdWRlIENvZGUgc291cmNlcyBiZWZvcmUgcnVubmluZyBiYXNoIGNvbW1hbmRzLiBUaGlzIGFsbG93c1xuICogU2Vzc2lvblN0YXJ0IGhvb2tzIHRvIGNvbmZpZ3VyZSB0aGUgZW52aXJvbm1lbnQgZm9yIHRoZSBlbnRpcmUgc2Vzc2lvbi5cbiAqXG4gKiAqKkltcG9ydGFudCoqOiBUaGlzIGZ1bmN0aW9uIG9ubHkgd29ya3MgaW4gU2Vzc2lvblN0YXJ0IGhvb2tzIHdoZXJlXG4gKiBgQ0xBVURFX0VOVl9GSUxFYCBpcyBzZXQuIEluIG90aGVyIGhvb2tzLCBpdCB3aWxsIHRocm93IGFuIGVycm9yLlxuICogQHBhcmFtIG5hbWUgLSBUaGUgZW52aXJvbm1lbnQgdmFyaWFibGUgbmFtZVxuICogQHBhcmFtIHZhbHVlIC0gVGhlIGVudmlyb25tZW50IHZhcmlhYmxlIHZhbHVlICh3aWxsIGJlIHNoZWxsLWVzY2FwZWQpXG4gKiBAdGhyb3dzIEVycm9yIGlmIENMQVVERV9FTlZfRklMRSBpcyBub3Qgc2V0IChub3QgaW4gYSBTZXNzaW9uU3RhcnQgaG9vaylcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBzZXNzaW9uU3RhcnRIb29rLCBzZXNzaW9uU3RhcnRPdXRwdXQsIHBlcnNpc3RFbnZWYXIgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIGV4cG9ydCBkZWZhdWx0IHNlc3Npb25TdGFydEhvb2soe30sIGFzeW5jIChpbnB1dCkgPT4ge1xuICogICAvLyBQZXJzaXN0IGVudmlyb25tZW50IHZhcmlhYmxlcyBmb3IgdGhlIHNlc3Npb25cbiAqICAgcGVyc2lzdEVudlZhcignTk9ERV9FTlYnLCAncHJvZHVjdGlvbicpO1xuICogICBwZXJzaXN0RW52VmFyKCdBUElfS0VZJywgcHJvY2Vzcy5lbnYuTVlfQVBJX0tFWSA/PyAnZGVmYXVsdCcpO1xuICogICBwZXJzaXN0RW52VmFyKCdQQVRIJywgYCR7cHJvY2Vzcy5lbnYuUEFUSH06Li9ub2RlX21vZHVsZXMvLmJpbmApO1xuICpcbiAqICAgcmV0dXJuIHNlc3Npb25TdGFydE91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3BlcnNpc3RpbmctZW52aXJvbm1lbnQtdmFyaWFibGVzXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwZXJzaXN0RW52VmFyKG5hbWUsIHZhbHVlKSB7XG4gICAgY29uc3QgZW52RmlsZSA9IGdldEVudkZpbGVQYXRoKCk7XG4gICAgaWYgKGVudkZpbGUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJwZXJzaXN0RW52VmFyIGNhbiBvbmx5IGJlIHVzZWQgaW4gU2Vzc2lvblN0YXJ0IGhvb2tzLiBcIiArIFwiQ0xBVURFX0VOVl9GSUxFIGVudmlyb25tZW50IHZhcmlhYmxlIGlzIG5vdCBzZXQuXCIpO1xuICAgIH1cbiAgICAvLyBTaGVsbC1lc2NhcGUgdGhlIHZhbHVlIHRvIGhhbmRsZSBzcGVjaWFsIGNoYXJhY3RlcnNcbiAgICBjb25zdCBlc2NhcGVkVmFsdWUgPSBlc2NhcGVTaGVsbFZhbHVlKHZhbHVlKTtcbiAgICAvLyBXcml0ZSB0aGUgZXhwb3J0IHN0YXRlbWVudFxuICAgIGNvbnN0IGV4cG9ydFN0YXRlbWVudCA9IGBleHBvcnQgJHtuYW1lfT0ke2VzY2FwZWRWYWx1ZX1cXG5gO1xuICAgIGZzLmFwcGVuZEZpbGVTeW5jKGVudkZpbGUsIGV4cG9ydFN0YXRlbWVudCwgXCJ1dGYtOFwiKTtcbn1cbi8qKlxuICogUGVyc2lzdHMgbXVsdGlwbGUgZW52aXJvbm1lbnQgdmFyaWFibGVzIGF0IG9uY2UuXG4gKlxuICogVGhpcyBpcyBhIGNvbnZlbmllbmNlIHdyYXBwZXIgYXJvdW5kIGBwZXJzaXN0RW52VmFyYCBmb3Igc2V0dGluZ1xuICogbXVsdGlwbGUgdmFyaWFibGVzIGluIGEgc2luZ2xlIGNhbGwuXG4gKiBAcGFyYW0gdmFycyAtIE9iamVjdCBtYXBwaW5nIHZhcmlhYmxlIG5hbWVzIHRvIHZhbHVlc1xuICogQHRocm93cyBFcnJvciBpZiBDTEFVREVfRU5WX0ZJTEUgaXMgbm90IHNldCAobm90IGluIGEgU2Vzc2lvblN0YXJ0IGhvb2spXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogcGVyc2lzdEVudlZhcnMoe1xuICogICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxuICogICBBUElfS0VZOiAnc2VjcmV0JyxcbiAqICAgREVCVUc6ICdmYWxzZSdcbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwZXJzaXN0RW52VmFycyh2YXJzKSB7XG4gICAgZm9yIChjb25zdCBbbmFtZSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHZhcnMpKSB7XG4gICAgICAgIHBlcnNpc3RFbnZWYXIobmFtZSwgdmFsdWUpO1xuICAgIH1cbn1cbi8qKlxuICogRXNjYXBlcyBhIHZhbHVlIGZvciBzYWZlIHVzZSBpbiBhIHNoZWxsIGV4cG9ydCBzdGF0ZW1lbnQuXG4gKlxuICogVXNlcyBzaW5nbGUgcXVvdGVzIGFuZCBlc2NhcGVzIGFueSBlbWJlZGRlZCBzaW5nbGUgcXVvdGVzLlxuICogVGhpcyBwcmV2ZW50cyBzaGVsbCBpbmplY3Rpb24gYW5kIGhhbmRsZXMgc3BlY2lhbCBjaGFyYWN0ZXJzLlxuICogQHBhcmFtIHZhbHVlIC0gVGhlIHZhbHVlIHRvIGVzY2FwZVxuICogQHJldHVybnMgVGhlIHNoZWxsLWVzY2FwZWQgdmFsdWUgKHdpdGggcXVvdGVzKVxuICogQGludGVybmFsXG4gKi9cbmZ1bmN0aW9uIGVzY2FwZVNoZWxsVmFsdWUodmFsdWUpIHtcbiAgICAvLyBVc2Ugc2luZ2xlIHF1b3RlcyBhbmQgZXNjYXBlIGFueSBlbWJlZGRlZCBzaW5nbGUgcXVvdGVzXG4gICAgLy8gJ3ZhbHVlJyAtPiAndmFsJ1xcJyd1ZScgZm9yIHZhbHVlcyBjb250YWluaW5nIHNpbmdsZSBxdW90ZXNcbiAgICBjb25zdCBlc2NhcGVkID0gdmFsdWUucmVwbGFjZSgvJy9nLCBcIidcXFxcJydcIik7XG4gICAgcmV0dXJuIGAnJHtlc2NhcGVkfSdgO1xufVxuIiwgIi8qKlxuICogSG9vayBmYWN0b3J5IGZ1bmN0aW9ucyBmb3IgQ2xhdWRlIENvZGUgaG9va3MuXG4gKlxuICogUHJvdmlkZXMgdHlwZWQgZmFjdG9yeSBmdW5jdGlvbnMgZm9yIGFsbCAxMiBob29rIHR5cGVzIHRoYXQgaGFuZGxlOlxuICogLSBJbnB1dCB0eXBlIG5hcnJvd2luZyBiYXNlZCBvbiBob29rIGV2ZW50IHR5cGVcbiAqIC0gT3V0cHV0IHR5cGUgZW5mb3JjZW1lbnQgdmlhIHJldHVybiB0eXBlc1xuICogLSBFcnJvciB3cmFwcGluZyB3aXRoIGF1dG9tYXRpYyBsb2dnaW5nXG4gKiAtIExvZ2dlciBjb250ZXh0IGluamVjdGlvblxuICpcbiAqIEVhY2ggZmFjdG9yeSBhY2NlcHRzIGEgSG9va0NvbmZpZyB3aXRoIG9wdGlvbmFsIG1hdGNoZXIgYW5kIHRpbWVvdXQgc2V0dGluZ3MsXG4gKiBhbmQgcmV0dXJucyBhIGZ1bmN0aW9uIHRoYXQgdGhlIHJ1bnRpbWUgaW52b2tlcyB3aGVuIHRoZSBob29rIGZpbGUgZXhlY3V0ZXMuXG4gKiBAbW9kdWxlXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgcHJlVG9vbFVzZUhvb2ssIHByZVRvb2xVc2VPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIGV4cG9ydCBkZWZhdWx0IHByZVRvb2xVc2VIb29rKHsgbWF0Y2hlcjogJ0Jhc2gnIH0sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnUHJvY2Vzc2luZyBCYXNoIGNvbW1hbmQnKTtcbiAqICAgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoeyBhbGxvdzogdHJ1ZSB9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3NcbiAqL1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gR2VuZXJpYyBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBob29rIGZhY3RvcnkgZnVuY3Rpb24gZm9yIGEgc3BlY2lmaWMgaG9vayB0eXBlLlxuICpcbiAqIFRoaXMgaXMgdGhlIGludGVybmFsIGltcGxlbWVudGF0aW9uIHVzZWQgYnkgYWxsIHR5cGVkIGZhY3Rvcmllcy5cbiAqIEl0IHdyYXBzIHRoZSBoYW5kbGVyIHdpdGggZXJyb3IgY2F0Y2hpbmcgYW5kIGxvZ2dpbmcuXG4gKiBAcGFyYW0gaG9va0V2ZW50TmFtZSAtIFRoZSBob29rIGV2ZW50IG5hbWVcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb25cbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gd3JhcFxuICogQHJldHVybnMgQSB3cmFwcGVkIGhvb2sgZnVuY3Rpb25cbiAqIEBpbnRlcm5hbFxuICovXG5mdW5jdGlvbiBjcmVhdGVIb29rRnVuY3Rpb24oaG9va0V2ZW50TmFtZSwgY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgY29uc3QgaG9va0ZuID0gYXN5bmMgKGlucHV0LCBjb250ZXh0KSA9PiB7XG4gICAgICAgIC8vIERlbGVnYXRlIGVycm9yIGhhbmRsaW5nIHRvIHRoZSBydW50aW1lIC0ganVzdCBleGVjdXRlIHRoZSBoYW5kbGVyXG4gICAgICAgIC8vIFRoZSBydW50aW1lIHdpbGwgY2F0Y2ggZXJyb3JzLCBsb2cgdGhlbSwgYW5kIHJldHVybiBhcHByb3ByaWF0ZSBvdXRwdXRcbiAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZXIoaW5wdXQsIGNvbnRleHQpO1xuICAgIH07XG4gICAgLy8gQXR0YWNoIG1ldGFkYXRhIGZvciBydW50aW1lIGluc3BlY3Rpb25cbiAgICBob29rRm4uaG9va0V2ZW50TmFtZSA9IGhvb2tFdmVudE5hbWU7XG4gICAgaG9va0ZuLm1hdGNoZXIgPSBjb25maWcubWF0Y2hlcjtcbiAgICBob29rRm4udGltZW91dCA9IGNvbmZpZy50aW1lb3V0O1xuICAgIHJldHVybiBob29rRm47XG59XG4vKiogQGluaGVyaXRkb2MgKi9cbmV4cG9ydCBmdW5jdGlvbiBwcmVUb29sVXNlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiUHJlVG9vbFVzZVwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLyoqIEBpbmhlcml0ZG9jICovXG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJQb3N0VG9vbFVzZVwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLyoqIEBpbmhlcml0ZG9jICovXG5leHBvcnQgZnVuY3Rpb24gcG9zdFRvb2xVc2VGYWlsdXJlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiUG9zdFRvb2xVc2VGYWlsdXJlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBQb3N0VG9vbEJhdGNoIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgUG9zdFRvb2xCYXRjaCBob29rIGhhbmRsZXIuXG4gKlxuICogUG9zdFRvb2xCYXRjaCBob29rcyBmaXJlIGV4YWN0bHkgb25jZSBhZnRlciBldmVyeSB0b29sIGNhbGwgaW4gYSBiYXRjaCBoYXNcbiAqIHJlc29sdmVkLCBiZWZvcmUgdGhlIG5leHQgbW9kZWwgcmVxdWVzdC4gVW5saWtlIFBvc3RUb29sVXNlIFx1MjAxNCB3aGljaCBmaXJlcyBwZXJcbiAqIHRvb2wgYW5kIG1heSBydW4gY29uY3VycmVudGx5IGZvciBwYXJhbGxlbCB0b29sIGNhbGxzIFx1MjAxNCBQb3N0VG9vbEJhdGNoIHJlY2VpdmVzXG4gKiB0aGUgZnVsbCBiYXRjaCB2aWEgYGlucHV0LnRvb2xfY2FsbHNgLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEluc3BlY3Qgb3Igc3VtbWFyaXplIGFsbCB0b29sIGNhbGxzIGluIGEgc2luZ2xlIHR1cm4gdG9nZXRoZXJcbiAqIC0gSW5qZWN0IGFkZGl0aW9uYWwgY29udGV4dCBvbmNlIHBlciBiYXRjaCBpbnN0ZWFkIG9mIG9uY2UgcGVyIHRvb2xcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb25jZSBwZXIgYmF0Y2hcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0IChtYXRjaGVyIGlzIGlnbm9yZWQpXG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBwb3N0VG9vbEJhdGNoSG9vaywgcG9zdFRvb2xCYXRjaE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgcG9zdFRvb2xCYXRjaEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnVG9vbCBiYXRjaCBjb21wbGV0ZWQnLCB7IGNvdW50OiBpbnB1dC50b29sX2NhbGxzLmxlbmd0aCB9KTtcbiAqXG4gKiAgIHJldHVybiBwb3N0VG9vbEJhdGNoT3V0cHV0KHtcbiAqICAgICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBgUmV2aWV3ZWQgJHtpbnB1dC50b29sX2NhbGxzLmxlbmd0aH0gdG9vbCBjYWxsc2BcbiAqICAgICB9XG4gKiAgIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNwb3N0dG9vbGJhdGNoXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbEJhdGNoSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiUG9zdFRvb2xCYXRjaFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gTm90aWZpY2F0aW9uIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgTm90aWZpY2F0aW9uIGhvb2sgaGFuZGxlci5cbiAqXG4gKiBOb3RpZmljYXRpb24gaG9va3MgZmlyZSB3aGVuIENsYXVkZSBDb2RlIHNlbmRzIGEgbm90aWZpY2F0aW9uLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEZvcndhcmQgbm90aWZpY2F0aW9ucyB0byBleHRlcm5hbCBzeXN0ZW1zXG4gKiAtIExvZyBpbXBvcnRhbnQgZXZlbnRzXG4gKiAtIFRyaWdnZXIgY3VzdG9tIGFsZXJ0aW5nXG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgbm90aWZpY2F0aW9uX3R5cGVgXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgbWF0Y2hlciBhbmQgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgbm90aWZpY2F0aW9uSG9vaywgbm90aWZpY2F0aW9uT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBGb3J3YXJkIG5vdGlmaWNhdGlvbnMgdG8gU2xhY2tcbiAqIGV4cG9ydCBkZWZhdWx0IG5vdGlmaWNhdGlvbkhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnTm90aWZpY2F0aW9uIHJlY2VpdmVkJywge1xuICogICAgIHR5cGU6IGlucHV0Lm5vdGlmaWNhdGlvbl90eXBlLFxuICogICAgIHRpdGxlOiBpbnB1dC50aXRsZVxuICogICB9KTtcbiAqXG4gKiAgIGF3YWl0IHNlbmRTbGFja01lc3NhZ2UoaW5wdXQudGl0bGUgPz8gJ05vdGlmaWNhdGlvbicsIGlucHV0Lm1lc3NhZ2UpO1xuICpcbiAqICAgcmV0dXJuIG5vdGlmaWNhdGlvbk91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI25vdGlmaWNhdGlvblxuICovXG5leHBvcnQgZnVuY3Rpb24gbm90aWZpY2F0aW9uSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiTm90aWZpY2F0aW9uXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBVc2VyUHJvbXB0U3VibWl0IEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgVXNlclByb21wdFN1Ym1pdCBob29rIGhhbmRsZXIuXG4gKlxuICogVXNlclByb21wdFN1Ym1pdCBob29rcyBmaXJlIHdoZW4gYSB1c2VyIHN1Ym1pdHMgYSBwcm9tcHQsIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gQWRkIGFkZGl0aW9uYWwgY29udGV4dCBvciBpbnN0cnVjdGlvbnNcbiAqIC0gTG9nIHVzZXIgaW50ZXJhY3Rpb25zXG4gKiAtIFZhbGlkYXRlIG9yIHRyYW5zZm9ybSBwcm9tcHRzXG4gKlxuICogKipNYXRjaGVyKio6IE5vIG1hdGNoZXIgc3VwcG9ydCAtIGZpcmVzIG9uIGFsbCBwcm9tcHQgc3VibWlzc2lvbnNcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0IChtYXRjaGVyIGlzIGlnbm9yZWQpXG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyB1c2VyUHJvbXB0U3VibWl0SG9vaywgdXNlclByb21wdFN1Ym1pdE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gQWRkIHByb2plY3QgY29udGV4dCB0byBldmVyeSBwcm9tcHRcbiAqIGV4cG9ydCBkZWZhdWx0IHVzZXJQcm9tcHRTdWJtaXRIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmRlYnVnKCdVc2VyIHByb21wdCBzdWJtaXR0ZWQnLCB7IHByb21wdExlbmd0aDogaW5wdXQucHJvbXB0Lmxlbmd0aCB9KTtcbiAqXG4gKiAgIGNvbnN0IHByb2plY3RDb250ZXh0ID0gYXdhaXQgZ2V0UHJvamVjdENvbnRleHQoKTtcbiAqXG4gKiAgIHJldHVybiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KHtcbiAqICAgICBhZGRpdGlvbmFsQ29udGV4dDogcHJvamVjdENvbnRleHRcbiAqICAgfSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3VzZXJwcm9tcHRzdWJtaXRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVzZXJQcm9tcHRTdWJtaXRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJVc2VyUHJvbXB0U3VibWl0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBVc2VyUHJvbXB0RXhwYW5zaW9uIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgVXNlclByb21wdEV4cGFuc2lvbiBob29rIGhhbmRsZXIuXG4gKlxuICogVXNlclByb21wdEV4cGFuc2lvbiBob29rcyBmaXJlIHdoZW4gYSB1c2VyIHByb21wdCBpcyBleHBhbmRlZCBmcm9tIGEgc2xhc2hcbiAqIGNvbW1hbmQgb3IgTUNQIHByb21wdCwgYWxsb3dpbmcgeW91IHRvOlxuICogLSBBZGQgY29udGV4dCBiYXNlZCBvbiB0aGUgY29tbWFuZCBiZWluZyBpbnZva2VkXG4gKiAtIExvZyBzbGFzaCBjb21tYW5kIGFuZCBNQ1AgcHJvbXB0IHVzYWdlXG4gKiAtIE9ic2VydmUgcHJvbXB0IGV4cGFuc2lvbiBldmVudHNcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHByb21wdCBleHBhbnNpb25zXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dCAobWF0Y2hlciBpcyBpZ25vcmVkKVxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgdXNlclByb21wdEV4cGFuc2lvbkhvb2ssIHVzZXJQcm9tcHRFeHBhbnNpb25PdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIC8vIEFkZCBjb250ZXh0IHdoZW4gYSBzbGFzaCBjb21tYW5kIGlzIGludm9rZWRcbiAqIGV4cG9ydCBkZWZhdWx0IHVzZXJQcm9tcHRFeHBhbnNpb25Ib29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmRlYnVnKCdQcm9tcHQgZXhwYW5kZWQnLCB7IHR5cGU6IGlucHV0LmV4cGFuc2lvbl90eXBlLCBjb21tYW5kOiBpbnB1dC5jb21tYW5kX25hbWUgfSk7XG4gKlxuICogICByZXR1cm4gdXNlclByb21wdEV4cGFuc2lvbk91dHB1dCh7XG4gKiAgICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogYENvbW1hbmQ6ICR7aW5wdXQuY29tbWFuZF9uYW1lfWBcbiAqICAgICB9XG4gKiAgIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyN1c2VycHJvbXB0ZXhwYW5zaW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB1c2VyUHJvbXB0RXhwYW5zaW9uSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiVXNlclByb21wdEV4cGFuc2lvblwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU2Vzc2lvblN0YXJ0IEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgU2Vzc2lvblN0YXJ0IGhvb2sgaGFuZGxlci5cbiAqXG4gKiBTZXNzaW9uU3RhcnQgaG9va3MgZmlyZSB3aGVuIGEgQ2xhdWRlIENvZGUgc2Vzc2lvbiBzdGFydHMgb3IgcmVzdGFydHMsXG4gKiBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEluaXRpYWxpemUgc2Vzc2lvbiBzdGF0ZVxuICogLSBJbmplY3QgY29udGV4dCBvciBpbnN0cnVjdGlvbnNcbiAqIC0gUGVyc2lzdCBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZm9yIHN1YnNlcXVlbnQgYmFzaCBjb21tYW5kc1xuICogLSBTZXQgdXAgbG9nZ2luZyBvciBtb25pdG9yaW5nXG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgc291cmNlYCAoJ3N0YXJ0dXAnLCAncmVzdW1lJywgJ2NsZWFyJywgJ2NvbXBhY3QnKVxuICpcbiAqICoqQ29udGV4dCoqOiBTZXNzaW9uU3RhcnQgaG9va3MgcmVjZWl2ZSBhbiBleHRlbmRlZCBjb250ZXh0IHdpdGggYHBlcnNpc3RFbnZWYXJgXG4gKiBhbmQgYHBlcnNpc3RFbnZWYXJzYCBmdW5jdGlvbnMgZm9yIHNldHRpbmcgZW52aXJvbm1lbnQgdmFyaWFibGVzLlxuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIG1hdGNoZXIgYW5kIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHNlc3Npb25TdGFydEhvb2ssIHNlc3Npb25TdGFydE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gUGVyc2lzdCBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZm9yIHRoZSBzZXNzaW9uXG4gKiBleHBvcnQgZGVmYXVsdCBzZXNzaW9uU3RhcnRIb29rKHsgbWF0Y2hlcjogJ3N0YXJ0dXAnIH0sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIsIHBlcnNpc3RFbnZWYXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnTmV3IHNlc3Npb24gc3RhcnRlZCcsIHtcbiAqICAgICBzZXNzaW9uSWQ6IGlucHV0LnNlc3Npb25faWQsXG4gKiAgICAgY3dkOiBpbnB1dC5jd2RcbiAqICAgfSk7XG4gKlxuICogICAvLyBTZXQgZW52aXJvbm1lbnQgdmFyaWFibGVzIGZvciBhbGwgc3Vic2VxdWVudCBiYXNoIGNvbW1hbmRzXG4gKiAgIHBlcnNpc3RFbnZWYXIoJ05PREVfRU5WJywgJ2RldmVsb3BtZW50Jyk7XG4gKiAgIHBlcnNpc3RFbnZWYXIoJ0RFQlVHJywgJ3RydWUnKTtcbiAqXG4gKiAgIHJldHVybiBzZXNzaW9uU3RhcnRPdXRwdXQoe30pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBTZXQgbXVsdGlwbGUgZW52aXJvbm1lbnQgdmFyaWFibGVzIGF0IG9uY2VcbiAqIGV4cG9ydCBkZWZhdWx0IHNlc3Npb25TdGFydEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBwZXJzaXN0RW52VmFycyB9KSA9PiB7XG4gKiAgIHBlcnNpc3RFbnZWYXJzKHtcbiAqICAgICBOT0RFX0VOVjogJ3Byb2R1Y3Rpb24nLFxuICogICAgIEFQSV9LRVk6ICdzZWNyZXQnLFxuICogICAgIERFQlVHOiAnZmFsc2UnXG4gKiAgIH0pO1xuICpcbiAqICAgcmV0dXJuIHNlc3Npb25TdGFydE91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3Nlc3Npb25zdGFydFxuICovXG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiU2Vzc2lvblN0YXJ0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTZXNzaW9uRW5kIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgU2Vzc2lvbkVuZCBob29rIGhhbmRsZXIuXG4gKlxuICogU2Vzc2lvbkVuZCBob29rcyBmaXJlIHdoZW4gYSBDbGF1ZGUgQ29kZSBzZXNzaW9uIGVuZHMsIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gQ2xlYW4gdXAgc2Vzc2lvbiByZXNvdXJjZXNcbiAqIC0gTG9nIHNlc3Npb24gbWV0cmljc1xuICogLSBQZXJzaXN0IHNlc3Npb24gc3RhdGVcbiAqXG4gKiAqKk1hdGNoZXIqKjogTWF0Y2hlcyBhZ2FpbnN0IGByZWFzb25gICh0aGUgZXhpdCByZWFzb24gc3RyaW5nKVxuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIG1hdGNoZXIgYW5kIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHNlc3Npb25FbmRIb29rLCBzZXNzaW9uRW5kT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBMb2cgc2Vzc2lvbiBlbmQgYW5kIGNsZWFuIHVwXG4gKiBleHBvcnQgZGVmYXVsdCBzZXNzaW9uRW5kSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdTZXNzaW9uIGVuZGVkJywge1xuICogICAgIHNlc3Npb25JZDogaW5wdXQuc2Vzc2lvbl9pZCxcbiAqICAgICByZWFzb246IGlucHV0LnJlYXNvblxuICogICB9KTtcbiAqXG4gKiAgIGF3YWl0IGNsZWFudXBTZXNzaW9uUmVzb3VyY2VzKGlucHV0LnNlc3Npb25faWQpO1xuICpcbiAqICAgcmV0dXJuIHNlc3Npb25FbmRPdXRwdXQoe30pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNzZXNzaW9uZW5kXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uRW5kSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiU2Vzc2lvbkVuZFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU3RvcCBIb29rIEZhY3Rvcnlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhIFN0b3AgaG9vayBoYW5kbGVyLlxuICpcbiAqIFN0b3AgaG9va3MgZmlyZSB3aGVuIENsYXVkZSBDb2RlIGlzIGFib3V0IHRvIHN0b3AsIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gQmxvY2sgdGhlIHN0b3AgYW5kIHJlcXVpcmUgYWRkaXRpb25hbCBhY3Rpb25cbiAqIC0gQ29uZmlybSB0aGUgdXNlciB3YW50cyB0byBzdG9wXG4gKiAtIENsZWFuIHVwIHJlc291cmNlcyBiZWZvcmUgc3RvcHBpbmdcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHN0b3AgZXZlbnRzXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dCAobWF0Y2hlciBpcyBpZ25vcmVkKVxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgc3RvcEhvb2ssIHN0b3BPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIC8vIEJsb2NrIHN0b3AgaWYgdGhlcmUgYXJlIHBlbmRpbmcgY2hhbmdlc1xuICogZXhwb3J0IGRlZmF1bHQgc3RvcEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBjb25zdCBwZW5kaW5nQ2hhbmdlcyA9IGF3YWl0IGNoZWNrUGVuZGluZ0NoYW5nZXMoKTtcbiAqXG4gKiAgIGlmIChwZW5kaW5nQ2hhbmdlcy5sZW5ndGggPiAwKSB7XG4gKiAgICAgbG9nZ2VyLndhcm4oJ0Jsb2NraW5nIHN0b3AgZHVlIHRvIHBlbmRpbmcgY2hhbmdlcycsIHtcbiAqICAgICAgIGNvdW50OiBwZW5kaW5nQ2hhbmdlcy5sZW5ndGhcbiAqICAgICB9KTtcbiAqXG4gKiAgICAgcmV0dXJuIHN0b3BPdXRwdXQoe1xuICogICAgICAgZGVjaXNpb246ICdibG9jaycsXG4gKiAgICAgICByZWFzb246IGBUaGVyZSBhcmUgJHtwZW5kaW5nQ2hhbmdlcy5sZW5ndGh9IHVuY29tbWl0dGVkIGNoYW5nZXNgLFxuICogICAgICAgc3lzdGVtTWVzc2FnZTogJ1BsZWFzZSBjb21taXQgb3IgZGlzY2FyZCBjaGFuZ2VzIGJlZm9yZSBzdG9wcGluZydcbiAqICAgICB9KTtcbiAqICAgfVxuICpcbiAqICAgbG9nZ2VyLmluZm8oJ0FwcHJvdmluZyBzdG9wJyk7XG4gKiAgIHJldHVybiBzdG9wT3V0cHV0KHsgZGVjaXNpb246ICdhcHByb3ZlJyB9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3Mjc3RvcFxuICovXG5leHBvcnQgZnVuY3Rpb24gc3RvcEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlN0b3BcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFN0b3BGYWlsdXJlIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgU3RvcEZhaWx1cmUgaG9vayBoYW5kbGVyLlxuICpcbiAqIFN0b3BGYWlsdXJlIGhvb2tzIGZpcmUgd2hlbiBDbGF1ZGUgQ29kZSBlbmNvdW50ZXJzIGFuIGVycm9yIHdoaWxlIHN0b3BwaW5nXG4gKiAoZS5nLiwgQVBJIGVycm9ycywgYXV0aGVudGljYXRpb24gZmFpbHVyZXMsIHJhdGUgbGltaXRzKSwgYWxsb3dpbmcgeW91IHRvOlxuICogLSBMb2cgc3RvcCBmYWlsdXJlIGV2ZW50cyBhbmQgZXJyb3IgZGV0YWlsc1xuICogLSBBbGVydCBvbiB1bmV4cGVjdGVkIHNlc3Npb24gdGVybWluYXRpb24gZXJyb3JzXG4gKiAtIE9ic2VydmUgd2hhdCBlcnJvciBjYXVzZWQgdGhlIGZhaWx1cmVcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHN0b3AgZmFpbHVyZSBldmVudHNcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0IChtYXRjaGVyIGlzIGlnbm9yZWQpXG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBzdG9wRmFpbHVyZUhvb2ssIHN0b3BGYWlsdXJlT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiBleHBvcnQgZGVmYXVsdCBzdG9wRmFpbHVyZUhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuZXJyb3IoJ1Nlc3Npb24gc3RvcHBlZCBkdWUgdG8gZXJyb3InLCB7XG4gKiAgICAgZXJyb3I6IGlucHV0LmVycm9yLFxuICogICAgIGRldGFpbHM6IGlucHV0LmVycm9yX2RldGFpbHNcbiAqICAgfSk7XG4gKiAgIHJldHVybiBzdG9wRmFpbHVyZU91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3N0b3BmYWlsdXJlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdG9wRmFpbHVyZUhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlN0b3BGYWlsdXJlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTdWJhZ2VudFN0YXJ0IEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgU3ViYWdlbnRTdGFydCBob29rIGhhbmRsZXIuXG4gKlxuICogU3ViYWdlbnRTdGFydCBob29rcyBmaXJlIHdoZW4gYSBzdWJhZ2VudCAoQWdlbnQgdG9vbCkgc3RhcnRzLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEluamVjdCBjb250ZXh0IGZvciB0aGUgc3ViYWdlbnRcbiAqIC0gTG9nIHN1YmFnZW50IGludm9jYXRpb25zXG4gKiAtIENvbmZpZ3VyZSBzdWJhZ2VudCBiZWhhdmlvclxuICpcbiAqICoqTWF0Y2hlcioqOiBNYXRjaGVzIGFnYWluc3QgYGFnZW50X3R5cGVgIChlLmcuLCAnZXhwbG9yZScsICdjb2RlYmFzZS1hbmFseXNpcycpXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgbWF0Y2hlciBhbmQgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgc3ViYWdlbnRTdGFydEhvb2ssIHN1YmFnZW50U3RhcnRPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIC8vIEFkZCBjb250ZXh0IGZvciBleHBsb3JlIHN1YmFnZW50c1xuICogZXhwb3J0IGRlZmF1bHQgc3ViYWdlbnRTdGFydEhvb2soeyBtYXRjaGVyOiAnZXhwbG9yZScgfSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdFeHBsb3JlIHN1YmFnZW50IHN0YXJ0aW5nJywge1xuICogICAgIGFnZW50SWQ6IGlucHV0LmFnZW50X2lkLFxuICogICAgIGFnZW50VHlwZTogaW5wdXQuYWdlbnRfdHlwZVxuICogICB9KTtcbiAqXG4gKiAgIHJldHVybiBzdWJhZ2VudFN0YXJ0T3V0cHV0KHtcbiAqICAgICBhZGRpdGlvbmFsQ29udGV4dDogJ0ZvY3VzIG9uIGZpbmRpbmcgcGF0dGVybnMgYW5kIGNvbnZlbnRpb25zJ1xuICogICB9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3Mjc3ViYWdlbnRzdGFydFxuICovXG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdGFydEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlN1YmFnZW50U3RhcnRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFN1YmFnZW50U3RvcCBIb29rIEZhY3Rvcnlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhIFN1YmFnZW50U3RvcCBob29rIGhhbmRsZXIuXG4gKlxuICogU3ViYWdlbnRTdG9wIGhvb2tzIGZpcmUgd2hlbiBhIHN1YmFnZW50IGNvbXBsZXRlcyBvciBzdG9wcywgYWxsb3dpbmcgeW91IHRvOlxuICogLSBCbG9jayB0aGUgc3ViYWdlbnQgZnJvbSBzdG9wcGluZ1xuICogLSBQcm9jZXNzIHN1YmFnZW50IHJlc3VsdHNcbiAqIC0gQ2xlYW4gdXAgc3ViYWdlbnQgcmVzb3VyY2VzXG4gKiAtIExvZyBzdWJhZ2VudCBjb21wbGV0aW9uXG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgYWdlbnRfdHlwZWAgKGUuZy4sICdleHBsb3JlJywgJ2NvZGViYXNlLWFuYWx5c2lzJylcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCBtYXRjaGVyIGFuZCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBzdWJhZ2VudFN0b3BIb29rLCBzdWJhZ2VudFN0b3BPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIC8vIEJsb2NrIGV4cGxvcmUgc3ViYWdlbnRzIGlmIHRhc2sgaW5jb21wbGV0ZVxuICogZXhwb3J0IGRlZmF1bHQgc3ViYWdlbnRTdG9wSG9vayh7IG1hdGNoZXI6ICdleHBsb3JlJyB9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ1N1YmFnZW50IHN0b3BwaW5nJywge1xuICogICAgIGFnZW50SWQ6IGlucHV0LmFnZW50X2lkLFxuICogICAgIGFnZW50VHlwZTogaW5wdXQuYWdlbnRfdHlwZVxuICogICB9KTtcbiAqXG4gKiAgIC8vIEJsb2NrIGlmIHRyYW5zY3JpcHQgc2hvd3MgaW5jb21wbGV0ZSB3b3JrXG4gKiAgIHJldHVybiBzdWJhZ2VudFN0b3BPdXRwdXQoe1xuICogICAgIGRlY2lzaW9uOiAnYmxvY2snLFxuICogICAgIHJlYXNvbjogJ1BsZWFzZSB2ZXJpZnkgZXhwbG9yYXRpb24gaXMgY29tcGxldGUnXG4gKiAgIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNzdWJhZ2VudHN0b3BcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN1YmFnZW50U3RvcEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlN1YmFnZW50U3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUHJlQ29tcGFjdCBIb29rIEZhY3Rvcnlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhIFByZUNvbXBhY3QgaG9vayBoYW5kbGVyLlxuICpcbiAqIFByZUNvbXBhY3QgaG9va3MgZmlyZSBiZWZvcmUgY29udGV4dCBjb21wYWN0aW9uIG9jY3VycywgYWxsb3dpbmcgeW91IHRvOlxuICogLSBQcmVzZXJ2ZSBpbXBvcnRhbnQgaW5mb3JtYXRpb24gYmVmb3JlIGNvbXBhY3Rpb25cbiAqIC0gTG9nIGNvbXBhY3Rpb24gZXZlbnRzXG4gKiAtIE1vZGlmeSBjdXN0b20gaW5zdHJ1Y3Rpb25zIGZvciB0aGUgY29tcGFjdGVkIGNvbnRleHRcbiAqXG4gKiAqKk1hdGNoZXIqKjogTWF0Y2hlcyBhZ2FpbnN0IGB0cmlnZ2VyYCAoJ21hbnVhbCcsICdhdXRvJylcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCBtYXRjaGVyIGFuZCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBwcmVDb21wYWN0SG9vaywgcHJlQ29tcGFjdE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gTG9nIGNvbXBhY3Rpb24gZXZlbnRzIGFuZCBwcmVzZXJ2ZSBjb250ZXh0XG4gKiBleHBvcnQgZGVmYXVsdCBwcmVDb21wYWN0SG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdDb250ZXh0IGNvbXBhY3Rpb24gdHJpZ2dlcmVkJywge1xuICogICAgIHRyaWdnZXI6IGlucHV0LnRyaWdnZXIsXG4gKiAgICAgaGFzQ3VzdG9tSW5zdHJ1Y3Rpb25zOiBpbnB1dC5jdXN0b21faW5zdHJ1Y3Rpb25zICE9PSBudWxsXG4gKiAgIH0pO1xuICpcbiAqICAgcmV0dXJuIHByZUNvbXBhY3RPdXRwdXQoe1xuICogICAgIHN5c3RlbU1lc3NhZ2U6ICdSZW1lbWJlcjogc3RyaWN0IG1vZGUgaXMgZW5hYmxlZCdcbiAqICAgfSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIE9ubHkgaGFuZGxlIG1hbnVhbCBjb21wYWN0aW9uXG4gKiBleHBvcnQgZGVmYXVsdCBwcmVDb21wYWN0SG9vayh7IG1hdGNoZXI6ICdtYW51YWwnIH0sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnTWFudWFsIGNvbXBhY3Rpb24gcmVxdWVzdGVkJyk7XG4gKiAgIHJldHVybiBwcmVDb21wYWN0T3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjcHJlY29tcGFjdFxuICovXG5leHBvcnQgZnVuY3Rpb24gcHJlQ29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlByZUNvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFBvc3RDb21wYWN0IEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgUG9zdENvbXBhY3QgaG9vayBoYW5kbGVyLlxuICpcbiAqIFBvc3RDb21wYWN0IGhvb2tzIGZpcmUgYWZ0ZXIgY29udGV4dCBjb21wYWN0aW9uIGNvbXBsZXRlcywgYWxsb3dpbmcgeW91IHRvOlxuICogLSBPYnNlcnZlIHRoZSBjb21wYWN0aW9uIHN1bW1hcnkgYW5kIGRldGFpbHNcbiAqIC0gTG9nIGNvbXBhY3Rpb24gZXZlbnRzXG4gKiAtIFJlYWN0IHRvIHRoZSBuZXcgY29tcGFjdGVkIHN0YXRlXG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgdHJpZ2dlcmAgKCdtYW51YWwnLCAnYXV0bycpXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgbWF0Y2hlciBhbmQgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgcG9zdENvbXBhY3RIb29rLCBwb3N0Q29tcGFjdE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgcG9zdENvbXBhY3RIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ0NvbnRleHQgY29tcGFjdGlvbiBjb21wbGV0ZWQnLCB7XG4gKiAgICAgdHJpZ2dlcjogaW5wdXQudHJpZ2dlcixcbiAqICAgICBzdW1tYXJ5OiBpbnB1dC5jb21wYWN0X3N1bW1hcnlcbiAqICAgfSk7XG4gKiAgIHJldHVybiBwb3N0Q29tcGFjdE91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3Bvc3Rjb21wYWN0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwb3N0Q29tcGFjdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlBvc3RDb21wYWN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vKiogQGluaGVyaXRkb2MgKi9cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uUmVxdWVzdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlBlcm1pc3Npb25SZXF1ZXN0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBQZXJtaXNzaW9uRGVuaWVkIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgUGVybWlzc2lvbkRlbmllZCBob29rIGhhbmRsZXIuXG4gKlxuICogUGVybWlzc2lvbkRlbmllZCBob29rcyBmaXJlIHdoZW4gYSBwZXJtaXNzaW9uIHJlcXVlc3QgaXMgZGVuaWVkIChlaXRoZXIgYnkgdGhlXG4gKiB1c2VyIG9yIGJ5IGEgUGVybWlzc2lvblJlcXVlc3QgaG9vayksIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gTG9nIHBlcm1pc3Npb24gZGVuaWFscyBmb3IgYXVkaXRpbmdcbiAqIC0gUmVhY3QgdG8gZGVuaWVkIHRvb2wgZXhlY3V0aW9uc1xuICogLSBPcHRpb25hbGx5IHJlcXVlc3QgYSByZXRyeSB2aWEgdGhlIG91dHB1dFxuICpcbiAqICoqTWF0Y2hlcioqOiBNYXRjaGVzIGFnYWluc3QgYHRvb2xfbmFtZWBcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCBtYXRjaGVyIGFuZCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBwZXJtaXNzaW9uRGVuaWVkSG9vaywgcGVybWlzc2lvbkRlbmllZE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gTG9nIGFsbCBwZXJtaXNzaW9uIGRlbmlhbHNcbiAqIGV4cG9ydCBkZWZhdWx0IHBlcm1pc3Npb25EZW5pZWRIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLndhcm4oJ1Blcm1pc3Npb24gZGVuaWVkJywge1xuICogICAgIHRvb2xOYW1lOiBpbnB1dC50b29sX25hbWUsXG4gKiAgICAgcmVhc29uOiBpbnB1dC5yZWFzb25cbiAqICAgfSk7XG4gKiAgIHJldHVybiBwZXJtaXNzaW9uRGVuaWVkT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjcGVybWlzc2lvbmRlbmllZFxuICovXG5leHBvcnQgZnVuY3Rpb24gcGVybWlzc2lvbkRlbmllZEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlBlcm1pc3Npb25EZW5pZWRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNldHVwIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgU2V0dXAgaG9vayBoYW5kbGVyLlxuICpcbiAqIFNldHVwIGhvb2tzIGZpcmUgZHVyaW5nIGluaXRpYWxpemF0aW9uIG9yIG1haW50ZW5hbmNlLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIENvbmZpZ3VyZSBpbml0aWFsIHNlc3Npb24gc3RhdGVcbiAqIC0gUGVyZm9ybSBzZXR1cCB0YXNrcyBiZWZvcmUgdGhlIHNlc3Npb24gc3RhcnRzXG4gKiAtIEFkZCBjb250ZXh0IGZvciBtYWludGVuYW5jZSBvcGVyYXRpb25zXG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgdHJpZ2dlcmAgKCdpbml0JyBvciAnbWFpbnRlbmFuY2UnKVxuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIG1hdGNoZXIgYW5kIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHNldHVwSG9vaywgc2V0dXBPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIC8vIEhhbmRsZSBhbGwgc2V0dXAgZXZlbnRzXG4gKiBleHBvcnQgZGVmYXVsdCBzZXR1cEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnU2V0dXAgdHJpZ2dlcmVkJywgeyB0cmlnZ2VyOiBpbnB1dC50cmlnZ2VyIH0pO1xuICogICByZXR1cm4gc2V0dXBPdXRwdXQoe30pO1xuICogfSk7XG4gKlxuICogLy8gT25seSBoYW5kbGUgaW5pdGlhbGl6YXRpb25cbiAqIGV4cG9ydCBkZWZhdWx0IHNldHVwSG9vayh7IG1hdGNoZXI6ICdpbml0JyB9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ0luaXRpYWxpemluZyBzZXNzaW9uJyk7XG4gKiAgIHJldHVybiBzZXR1cE91dHB1dCh7XG4gKiAgICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgICBhZGRpdGlvbmFsQ29udGV4dDogJ1Nlc3Npb24gaW5pdGlhbGl6ZWQgd2l0aCBjdXN0b20gY29uZmlndXJhdGlvbidcbiAqICAgICB9XG4gKiAgIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNzZXR1cFxuICovXG5leHBvcnQgZnVuY3Rpb24gc2V0dXBIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJTZXR1cFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVGVhbW1hdGVJZGxlIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgVGVhbW1hdGVJZGxlIGhvb2sgaGFuZGxlci5cbiAqXG4gKiBUZWFtbWF0ZUlkbGUgaG9va3MgZmlyZSB3aGVuIGEgdGVhbW1hdGUgaW4gYSB0ZWFtIGlzIGFib3V0IHRvIGdvIGlkbGUsXG4gKiBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEFzc2lnbiB3b3JrIHRvIGlkbGUgdGVhbW1hdGVzXG4gKiAtIExvZyB0ZWFtIGFjdGl2aXR5XG4gKiAtIENvb3JkaW5hdGUgbXVsdGktYWdlbnQgd29ya2Zsb3dzXG4gKlxuICogKipNYXRjaGVyKio6IE5vIG1hdGNoZXIgc3VwcG9ydCAtIGZpcmVzIG9uIGFsbCB0ZWFtbWF0ZSBpZGxlIGV2ZW50c1xuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIHRpbWVvdXQgKG1hdGNoZXIgaXMgaWdub3JlZClcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHRlYW1tYXRlSWRsZUhvb2ssIHRlYW1tYXRlSWRsZU91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gTG9nIHdoZW4gdGVhbW1hdGVzIGdvIGlkbGVcbiAqIGV4cG9ydCBkZWZhdWx0IHRlYW1tYXRlSWRsZUhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnVGVhbW1hdGUgZ29pbmcgaWRsZScsIHtcbiAqICAgICB0ZWFtbWF0ZU5hbWU6IGlucHV0LnRlYW1tYXRlX25hbWUsXG4gKiAgICAgdGVhbU5hbWU6IGlucHV0LnRlYW1fbmFtZVxuICogICB9KTtcbiAqXG4gKiAgIHJldHVybiB0ZWFtbWF0ZUlkbGVPdXRwdXQoe30pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyN0ZWFtbWF0ZWlkbGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRlYW1tYXRlSWRsZUhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlRlYW1tYXRlSWRsZVwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVGFza0NyZWF0ZWQgSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBUYXNrQ3JlYXRlZCBob29rIGhhbmRsZXIuXG4gKlxuICogVGFza0NyZWF0ZWQgaG9va3MgZmlyZSB3aGVuIGEgbmV3IHRhc2sgaXMgY3JlYXRlZCBhbmQgYXNzaWduZWQgdG8gYSB0ZWFtbWF0ZSxcbiAqIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gT2JzZXJ2ZSB0YXNrIGNyZWF0aW9uIGV2ZW50c1xuICogLSBMb2cgdGFzayBhc3NpZ25tZW50cyBmb3IgYXVkaXRpbmdcbiAqIC0gUmVhY3QgdG8gbmV3IHdvcmsgYmVpbmcgYXNzaWduZWRcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHRhc2sgY3JlYXRpb24gZXZlbnRzXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dCAobWF0Y2hlciBpcyBpZ25vcmVkKVxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgdGFza0NyZWF0ZWRIb29rLCB0YXNrQ3JlYXRlZE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gTG9nIHRhc2sgY3JlYXRpb25cbiAqIGV4cG9ydCBkZWZhdWx0IHRhc2tDcmVhdGVkSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdUYXNrIGNyZWF0ZWQnLCB7XG4gKiAgICAgdGFza0lkOiBpbnB1dC50YXNrX2lkLFxuICogICAgIHRhc2tTdWJqZWN0OiBpbnB1dC50YXNrX3N1YmplY3RcbiAqICAgfSk7XG4gKlxuICogICByZXR1cm4gdGFza0NyZWF0ZWRPdXRwdXQoe30pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyN0YXNrY3JlYXRlZFxuICovXG5leHBvcnQgZnVuY3Rpb24gdGFza0NyZWF0ZWRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJUYXNrQ3JlYXRlZFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gVGFza0NvbXBsZXRlZCBIb29rIEZhY3Rvcnlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhIFRhc2tDb21wbGV0ZWQgaG9vayBoYW5kbGVyLlxuICpcbiAqIFRhc2tDb21wbGV0ZWQgaG9va3MgZmlyZSB3aGVuIGEgdGFzayBpcyBiZWluZyBtYXJrZWQgYXMgY29tcGxldGVkLFxuICogYWxsb3dpbmcgeW91IHRvOlxuICogLSBWZXJpZnkgdGFzayBjb21wbGV0aW9uXG4gKiAtIExvZyB0YXNrIG1ldHJpY3NcbiAqIC0gVHJpZ2dlciBmb2xsb3ctdXAgYWN0aW9uc1xuICpcbiAqICoqTWF0Y2hlcioqOiBObyBtYXRjaGVyIHN1cHBvcnQgLSBmaXJlcyBvbiBhbGwgdGFzayBjb21wbGV0aW9uIGV2ZW50c1xuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIHRpbWVvdXQgKG1hdGNoZXIgaXMgaWdub3JlZClcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHRhc2tDb21wbGV0ZWRIb29rLCB0YXNrQ29tcGxldGVkT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBMb2cgdGFzayBjb21wbGV0aW9uXG4gKiBleHBvcnQgZGVmYXVsdCB0YXNrQ29tcGxldGVkSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdUYXNrIGNvbXBsZXRlZCcsIHtcbiAqICAgICB0YXNrSWQ6IGlucHV0LnRhc2tfaWQsXG4gKiAgICAgdGFza1N1YmplY3Q6IGlucHV0LnRhc2tfc3ViamVjdFxuICogICB9KTtcbiAqXG4gKiAgIHJldHVybiB0YXNrQ29tcGxldGVkT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjdGFza2NvbXBsZXRlZFxuICovXG5leHBvcnQgZnVuY3Rpb24gdGFza0NvbXBsZXRlZEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlRhc2tDb21wbGV0ZWRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEVsaWNpdGF0aW9uIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGFuIEVsaWNpdGF0aW9uIGhvb2sgaGFuZGxlci5cbiAqXG4gKiBFbGljaXRhdGlvbiBob29rcyBmaXJlIHdoZW4gYW4gTUNQIHNlcnZlciByZXF1ZXN0cyB1c2VyIGlucHV0LCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEFjY2VwdCwgZGVjbGluZSwgb3IgY2FuY2VsIGVsaWNpdGF0aW9uIHJlcXVlc3RzIHByb2dyYW1tYXRpY2FsbHlcbiAqIC0gUHJvdmlkZSBzdHJ1Y3R1cmVkIGZvcm0gaW5wdXQgb3IgVVJMLWJhc2VkIGF1dGggcmVzcG9uc2VzXG4gKiAtIExvZyBvciBhdWRpdCBlbGljaXRhdGlvbiByZXF1ZXN0c1xuICpcbiAqICoqTWF0Y2hlcioqOiBObyBtYXRjaGVyIHN1cHBvcnQgLSBmaXJlcyBvbiBhbGwgZWxpY2l0YXRpb24gZXZlbnRzXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgZWxpY2l0YXRpb25Ib29rLCBlbGljaXRhdGlvbk91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgZWxpY2l0YXRpb25Ib29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ0VsaWNpdGF0aW9uIHJlcXVlc3QnLCB7IHNlcnZlcjogaW5wdXQubWNwX3NlcnZlcl9uYW1lIH0pO1xuICogICByZXR1cm4gZWxpY2l0YXRpb25PdXRwdXQoe1xuICogICAgIGhvb2tTcGVjaWZpY091dHB1dDogeyBhY3Rpb246ICdhY2NlcHQnLCBjb250ZW50OiB7IGFwcHJvdmVkOiB0cnVlIH0gfVxuICogICB9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjZWxpY2l0YXRpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVsaWNpdGF0aW9uSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiRWxpY2l0YXRpb25cIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEVsaWNpdGF0aW9uUmVzdWx0IEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGFuIEVsaWNpdGF0aW9uUmVzdWx0IGhvb2sgaGFuZGxlci5cbiAqXG4gKiBFbGljaXRhdGlvblJlc3VsdCBob29rcyBmaXJlIHdpdGggdGhlIHJlc3VsdCBvZiBhbiBNQ1AgZWxpY2l0YXRpb24gcmVxdWVzdCxcbiAqIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gT2JzZXJ2ZSBlbGljaXRhdGlvbiBvdXRjb21lc1xuICogLSBNb2RpZnkgdGhlIHJlc3VsdCBiZWZvcmUgaXQgaXMgcmV0dXJuZWQgdG8gdGhlIE1DUCBzZXJ2ZXJcbiAqIC0gTG9nIGVsaWNpdGF0aW9uIGNvbXBsZXRpb25zXG4gKlxuICogKipNYXRjaGVyKio6IE5vIG1hdGNoZXIgc3VwcG9ydCAtIGZpcmVzIG9uIGFsbCBlbGljaXRhdGlvbiByZXN1bHQgZXZlbnRzXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgZWxpY2l0YXRpb25SZXN1bHRIb29rLCBlbGljaXRhdGlvblJlc3VsdE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgZWxpY2l0YXRpb25SZXN1bHRIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ0VsaWNpdGF0aW9uIHJlc3VsdCcsIHsgYWN0aW9uOiBpbnB1dC5hY3Rpb24gfSk7XG4gKiAgIHJldHVybiBlbGljaXRhdGlvblJlc3VsdE91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI2VsaWNpdGF0aW9ucmVzdWx0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbGljaXRhdGlvblJlc3VsdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIkVsaWNpdGF0aW9uUmVzdWx0XCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBDb25maWdDaGFuZ2UgSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBDb25maWdDaGFuZ2UgaG9vayBoYW5kbGVyLlxuICpcbiAqIENvbmZpZ0NoYW5nZSBob29rcyBmaXJlIHdoZW4gQ2xhdWRlIENvZGUgY29uZmlndXJhdGlvbiBjaGFuZ2VzLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIFJlYWN0IHRvIHNldHRpbmdzIGZpbGUgY2hhbmdlc1xuICogLSBMb2cgb3IgYXVkaXQgY29uZmlndXJhdGlvbiBjaGFuZ2VzXG4gKiAtIEFwcGx5IGN1c3RvbSBsb2dpYyB3aGVuIHNldHRpbmdzIGFyZSB1cGRhdGVkXG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgc291cmNlYCAoJ3VzZXJfc2V0dGluZ3MnLCAncHJvamVjdF9zZXR0aW5ncycsIGV0Yy4pXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgbWF0Y2hlciBhbmQgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgY29uZmlnQ2hhbmdlSG9vaywgY29uZmlnQ2hhbmdlT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiBleHBvcnQgZGVmYXVsdCBjb25maWdDaGFuZ2VIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ0NvbmZpZyBjaGFuZ2VkJywgeyBzb3VyY2U6IGlucHV0LnNvdXJjZSwgZmlsZTogaW5wdXQuZmlsZV9wYXRoIH0pO1xuICogICByZXR1cm4gY29uZmlnQ2hhbmdlT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjY29uZmlnY2hhbmdlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb25maWdDaGFuZ2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJDb25maWdDaGFuZ2VcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEluc3RydWN0aW9uc0xvYWRlZCBIb29rIEZhY3Rvcnlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhbiBJbnN0cnVjdGlvbnNMb2FkZWQgaG9vayBoYW5kbGVyLlxuICpcbiAqIEluc3RydWN0aW9uc0xvYWRlZCBob29rcyBmaXJlIHdoZW4gYSBDTEFVREUubWQgb3Igc2ltaWxhciBpbnN0cnVjdGlvbnMgZmlsZVxuICogaXMgbG9hZGVkLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIFJlYWN0IHRvIGluc3RydWN0aW9ucyBiZWluZyBhcHBsaWVkXG4gKiAtIExvZyB3aGljaCBpbnN0cnVjdGlvbiBmaWxlcyBhcmUgYWN0aXZlXG4gKiAtIE9ic2VydmUgdGhlIGluc3RydWN0aW9uIGxvYWRpbmcgaGllcmFyY2h5XG4gKlxuICogKipNYXRjaGVyKio6IE5vIG1hdGNoZXIgc3VwcG9ydCAtIGZpcmVzIG9uIGFsbCBpbnN0cnVjdGlvbiBsb2FkIGV2ZW50c1xuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IGluc3RydWN0aW9uc0xvYWRlZEhvb2ssIGluc3RydWN0aW9uc0xvYWRlZE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgaW5zdHJ1Y3Rpb25zTG9hZGVkSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdJbnN0cnVjdGlvbnMgbG9hZGVkJywgeyBmaWxlOiBpbnB1dC5maWxlX3BhdGgsIHR5cGU6IGlucHV0Lm1lbW9yeV90eXBlIH0pO1xuICogICByZXR1cm4gaW5zdHJ1Y3Rpb25zTG9hZGVkT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjaW5zdHJ1Y3Rpb25zbG9hZGVkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpbnN0cnVjdGlvbnNMb2FkZWRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJJbnN0cnVjdGlvbnNMb2FkZWRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFdvcmt0cmVlQ3JlYXRlIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgV29ya3RyZWVDcmVhdGUgaG9vayBoYW5kbGVyLlxuICpcbiAqIFdvcmt0cmVlQ3JlYXRlIGhvb2tzIGZpcmUgd2hlbiBhIGdpdCB3b3JrdHJlZSBpcyBjcmVhdGVkLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIFNldCB1cCB3b3JrdHJlZS1zcGVjaWZpYyBjb25maWd1cmF0aW9uXG4gKiAtIExvZyB3b3JrdHJlZSBjcmVhdGlvbiBldmVudHNcbiAqIC0gSW5pdGlhbGl6ZSB3b3JrdHJlZSByZXNvdXJjZXNcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHdvcmt0cmVlIGNyZWF0aW9uIGV2ZW50c1xuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHdvcmt0cmVlQ3JlYXRlSG9vaywgd29ya3RyZWVDcmVhdGVPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIGV4cG9ydCBkZWZhdWx0IHdvcmt0cmVlQ3JlYXRlSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGNvbnN0IHdvcmt0cmVlUGF0aCA9IGAke2lucHV0LmN3ZH0vLndvcmt0cmVlcy8ke2lucHV0Lm5hbWV9YDtcbiAqICAgbG9nZ2VyLmluZm8oJ1dvcmt0cmVlIGNyZWF0ZWQnLCB7IG5hbWU6IGlucHV0Lm5hbWUsIHdvcmt0cmVlUGF0aCB9KTtcbiAqICAgLy8gV29ya3RyZWVDcmVhdGUgaXMgYSBjb21tYW5kIGhvb2s6IHRoZSBwYXRoIGlzIHdyaXR0ZW4gdG8gc3Rkb3V0IGFzIHBsYWluIHRleHQuXG4gKiAgIHJldHVybiB3b3JrdHJlZUNyZWF0ZU91dHB1dCh7IHdvcmt0cmVlUGF0aCB9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3Mjd29ya3RyZWVjcmVhdGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHdvcmt0cmVlQ3JlYXRlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiV29ya3RyZWVDcmVhdGVcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFdvcmt0cmVlUmVtb3ZlIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgV29ya3RyZWVSZW1vdmUgaG9vayBoYW5kbGVyLlxuICpcbiAqIFdvcmt0cmVlUmVtb3ZlIGhvb2tzIGZpcmUgd2hlbiBhIGdpdCB3b3JrdHJlZSBpcyByZW1vdmVkLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIENsZWFuIHVwIHdvcmt0cmVlLXNwZWNpZmljIHJlc291cmNlc1xuICogLSBMb2cgd29ya3RyZWUgcmVtb3ZhbCBldmVudHNcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHdvcmt0cmVlIHJlbW92YWwgZXZlbnRzXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgd29ya3RyZWVSZW1vdmVIb29rLCB3b3JrdHJlZVJlbW92ZU91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgd29ya3RyZWVSZW1vdmVIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ1dvcmt0cmVlIHJlbW92ZWQnLCB7IHBhdGg6IGlucHV0Lndvcmt0cmVlX3BhdGggfSk7XG4gKiAgIHJldHVybiB3b3JrdHJlZVJlbW92ZU91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3dvcmt0cmVlcmVtb3ZlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB3b3JrdHJlZVJlbW92ZUhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIldvcmt0cmVlUmVtb3ZlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBDd2RDaGFuZ2VkIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgQ3dkQ2hhbmdlZCBob29rIGhhbmRsZXIuXG4gKlxuICogQ3dkQ2hhbmdlZCBob29rcyBmaXJlIHdoZW4gQ2xhdWRlIENvZGUncyBjdXJyZW50IHdvcmtpbmcgZGlyZWN0b3J5IGNoYW5nZXMsXG4gKiBhbGxvd2luZyB5b3UgdG86XG4gKiAtIFJlYWN0IHRvIGRpcmVjdG9yeSBjaGFuZ2VzIHdpdGhpbiBhIHNlc3Npb25cbiAqIC0gVXBkYXRlIGZpbGUgd2F0Y2hlcnMgb3IgZW52aXJvbm1lbnQgc3RhdGVcbiAqIC0gUmV0dXJuIGB3YXRjaFBhdGhzYCB2aWEgYGhvb2tTcGVjaWZpY091dHB1dGAgdG8gcmVnaXN0ZXIgcGF0aHMgZm9yIEZpbGVDaGFuZ2VkIGV2ZW50c1xuICpcbiAqICoqTWF0Y2hlcioqOiBObyBtYXRjaGVyIHN1cHBvcnQgLSBmaXJlcyBvbiBhbGwgY3dkIGNoYW5nZSBldmVudHNcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBjd2RDaGFuZ2VkSG9vaywgY3dkQ2hhbmdlZE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgY3dkQ2hhbmdlZEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnV29ya2luZyBkaXJlY3RvcnkgY2hhbmdlZCcsIHsgZnJvbTogaW5wdXQub2xkX2N3ZCwgdG86IGlucHV0Lm5ld19jd2QgfSk7XG4gKiAgIHJldHVybiBjd2RDaGFuZ2VkT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjY3dkY2hhbmdlZFxuICovXG5leHBvcnQgZnVuY3Rpb24gY3dkQ2hhbmdlZEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIkN3ZENoYW5nZWRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEZpbGVDaGFuZ2VkIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgRmlsZUNoYW5nZWQgaG9vayBoYW5kbGVyLlxuICpcbiAqIEZpbGVDaGFuZ2VkIGhvb2tzIGZpcmUgd2hlbiBhIHdhdGNoZWQgZmlsZSBjaGFuZ2VzIG9uIGRpc2ssIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gUmVhY3QgdG8gZmlsZSBzeXN0ZW0gY2hhbmdlcyBkdXJpbmcgYSBzZXNzaW9uXG4gKiAtIEludmFsaWRhdGUgY2FjaGVzIG9yIHJlbG9hZCBjb25maWd1cmF0aW9uXG4gKiAtIFJldHVybiBgd2F0Y2hQYXRoc2AgdmlhIGBob29rU3BlY2lmaWNPdXRwdXRgIHRvIHVwZGF0ZSB0aGUgc2V0IG9mIHdhdGNoZWQgcGF0aHNcbiAqXG4gKiBUaGUgaW5wdXQgYGV2ZW50YCBmaWVsZCBpbmRpY2F0ZXMgdGhlIHR5cGUgb2YgY2hhbmdlOlxuICogLSBgJ2NoYW5nZSdgIC0gRmlsZSBjb250ZW50cyBjaGFuZ2VkXG4gKiAtIGAnYWRkJ2AgLSBGaWxlIHdhcyBjcmVhdGVkXG4gKiAtIGAndW5saW5rJ2AgLSBGaWxlIHdhcyBkZWxldGVkXG4gKlxuICogKipNYXRjaGVyKio6IE5vIG1hdGNoZXIgc3VwcG9ydCAtIGZpcmVzIG9uIGFsbCBmaWxlIGNoYW5nZSBldmVudHNcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBmaWxlQ2hhbmdlZEhvb2ssIGZpbGVDaGFuZ2VkT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiBleHBvcnQgZGVmYXVsdCBmaWxlQ2hhbmdlZEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnRmlsZSBjaGFuZ2VkJywgeyBwYXRoOiBpbnB1dC5maWxlX3BhdGgsIGV2ZW50OiBpbnB1dC5ldmVudCB9KTtcbiAqICAgcmV0dXJuIGZpbGVDaGFuZ2VkT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjZmlsZWNoYW5nZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZpbGVDaGFuZ2VkSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiRmlsZUNoYW5nZWRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIE1lc3NhZ2VEaXNwbGF5IEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgTWVzc2FnZURpc3BsYXkgaG9vayBoYW5kbGVyLlxuICpcbiAqIE1lc3NhZ2VEaXNwbGF5IGhvb2tzIGZpcmUgd2l0aCBlYWNoIGJhdGNoIG9mIG5ld2x5IGNvbXBsZXRlZCBsaW5lcyB3aGlsZSBhblxuICogYXNzaXN0YW50IG1lc3NhZ2Ugc3RyZWFtcy4gRGlzcGxheS1vbmx5OiB0aGUgc3RvcmVkIG1lc3NhZ2UgYW5kIHdoYXQgdGhlIG1vZGVsXG4gKiBzZWVzIGFyZSB1bnRvdWNoZWQuIEFsbG93cyB5b3UgdG86XG4gKiAtIFJlcGxhY2UgdGhlIGRlbHRhIHNob3duIG9uIHNjcmVlbiB3aXRoIGN1c3RvbSBjb250ZW50IHZpYSBgZGlzcGxheUNvbnRlbnRgXG4gKiAtIE9ic2VydmUgYW5kIGxvZyBtZXNzYWdlIHN0cmVhbWluZyBldmVudHNcbiAqXG4gKiBUaGUgaW5wdXQgY2FycmllcyBgdHVybl9pZGAsIGBtZXNzYWdlX2lkYCwgYGluZGV4YCwgYGZpbmFsYCwgYW5kIGBkZWx0YWAgZmllbGRzLlxuICogVGhlIGBmaW5hbGAgZmxhZyBpbmRpY2F0ZXMgdGhlIGxhc3QgZmx1c2ggb2YgYSBtZXNzYWdlIFx1MjAxNCBpdHMgYGRlbHRhYCBpcyBlbXB0eVxuICogd2hlbiB0aGUgbWVzc2FnZSBlbmRzIG9uIGEgbmV3bGluZTsgdHJlYXQgYGZpbmFsYCBhcyB0aGUgZW5kLW9mLW1lc3NhZ2Ugc2lnbmFsLlxuICpcbiAqICoqTWF0Y2hlcioqOiBObyBtYXRjaGVyIHN1cHBvcnQgLSBmaXJlcyBvbiBhbGwgbWVzc2FnZSBkaXNwbGF5IGV2ZW50c1xuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IG1lc3NhZ2VEaXNwbGF5SG9vaywgbWVzc2FnZURpc3BsYXlPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIGV4cG9ydCBkZWZhdWx0IG1lc3NhZ2VEaXNwbGF5SG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGlmIChpbnB1dC5maW5hbCkge1xuICogICAgIGxvZ2dlci5pbmZvKCdNZXNzYWdlIGNvbXBsZXRlJywgeyBtZXNzYWdlSWQ6IGlucHV0Lm1lc3NhZ2VfaWQgfSk7XG4gKiAgIH1cbiAqICAgcmV0dXJuIG1lc3NhZ2VEaXNwbGF5T3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjbWVzc2FnZWRpc3BsYXlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1lc3NhZ2VEaXNwbGF5SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiTWVzc2FnZURpc3BsYXlcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbiIsICIvKipcbiAqIExvZ2dlciBzeXN0ZW0gZm9yIENsYXVkZSBDb2RlIGhvb2tzLlxuICpcbiAqIFByb3ZpZGVzIHN0cnVjdHVyZWQgbG9nZ2luZyB3aXRoIGV2ZW50IHN1YnNjcmlwdGlvbiBhbmQgb3B0aW9uYWwgZmlsZSBvdXRwdXQuXG4gKiBUaGUgbG9nZ2VyIGlzICoqc2lsZW50IGJ5IGRlZmF1bHQqKiB0byBhdm9pZCBpbnRlcmZlcmluZyB3aXRoIGhvb2sgcHJvdG9jb2xcbiAqIChzdGRvdXQgaXMgcmVzZXJ2ZWQgZm9yIEpTT04gcmVzcG9uc2VzLCBzdGRlcnIgbWF5IGNvbmZsaWN0IHdpdGggQ2xhdWRlIENvZGUpLlxuICogQG1vZHVsZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IGxvZ2dlciB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gU3Vic2NyaWJlIHRvIGxvZyBldmVudHNcbiAqIGNvbnN0IHVuc3Vic2NyaWJlID0gbG9nZ2VyLm9uKCdlcnJvcicsIChldmVudCkgPT4ge1xuICogICBjb25zb2xlLmVycm9yKGBFcnJvciBpbiAke2V2ZW50Lmhvb2tUeXBlfTogJHtldmVudC5tZXNzYWdlfWApO1xuICogfSk7XG4gKlxuICogLy8gTGF0ZXIsIGNsZWFuIHVwXG4gKiB1bnN1YnNjcmliZSgpO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3NcbiAqL1xuaW1wb3J0IHsgY2xvc2VTeW5jLCBleGlzdHNTeW5jLCBta2RpclN5bmMsIG9wZW5TeW5jLCB3cml0ZVN5bmMgfSBmcm9tIFwibm9kZTpmc1wiO1xuaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gXCJub2RlOnBhdGhcIjtcbi8qKlxuICogQWxsIGxvZyBsZXZlbHMgaW4gb3JkZXIgb2Ygc2V2ZXJpdHkgKGxvd2VzdCB0byBoaWdoZXN0KS5cbiAqL1xuZXhwb3J0IGNvbnN0IExPR19MRVZFTFMgPSBbXCJkZWJ1Z1wiLCBcImluZm9cIiwgXCJ3YXJuXCIsIFwiZXJyb3JcIl07XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBMb2dnZXIgQ2xhc3Ncbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogTG9nZ2VyIGZvciBDbGF1ZGUgQ29kZSBob29rcyB3aXRoIGV2ZW50IHN1YnNjcmlwdGlvbiBhbmQgZmlsZSBvdXRwdXQuXG4gKlxuICogIyMgS2V5IEJlaGF2aW9yc1xuICpcbiAqIHwgQ29uZmlndXJhdGlvbiB8IEJlaGF2aW9yIHxcbiAqIHwtLS0tLS0tLS0tLS0tLXwtLS0tLS0tLS0tfFxuICogfCBObyBjb25maWcgKGRlZmF1bHQpIHwgKipTaWxlbnQqKiAtIG5vIG91dHB1dCBhbnl3aGVyZSB8XG4gKiB8IGBDTEFVREVfQ09ERV9IT09LU19MT0dfRklMRWAgZW52IHZhciB8IEFwcGVuZCBKU09OIGxpbmVzIHRvIGZpbGUgfFxuICogfCBgLm9uKGxldmVsLCBoYW5kbGVyKWAgcmVnaXN0ZXJlZCB8IEV2ZW50cyBkZWxpdmVyZWQgdG8gaGFuZGxlcnMgb25seSB8XG4gKiB8IE11bHRpcGxlIGRlc3RpbmF0aW9ucyB8IEFsbCBkZXN0aW5hdGlvbnMgcmVjZWl2ZSBldmVudHMgfFxuICpcbiAqICMjIEltcG9ydGFudCBOb3Rlc1xuICpcbiAqIC0gKipOZXZlciBvdXRwdXRzIHRvIHN0ZG91dCoqIChyZXNlcnZlZCBmb3IgSlNPTiBob29rIHJlc3BvbnNlKVxuICogLSAqKk5ldmVyIG91dHB1dHMgdG8gc3RkZXJyKiogKG1heSBpbnRlcmZlcmUgd2l0aCBDbGF1ZGUgQ29kZSBlcnJvciBoYW5kbGluZylcbiAqIC0gRmlsZSBvdXRwdXQgdXNlcyBKU09OIExpbmVzIGZvcm1hdCBmb3IgZWFzeSBwYXJzaW5nXG4gKiAtIGAub24obGV2ZWwsIGhhbmRsZXIpYCByZXR1cm5zIGFuIHVuc3Vic2NyaWJlIGZ1bmN0aW9uXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBTdWJzY3JpYmUgdG8gZXZlbnRzIGF0IHNwZWNpZmljIGxldmVsXG4gKiBsb2dnZXIub24oJ3dhcm4nLCAoZXZlbnQpID0+IHtcbiAqICAgc2VuZEFsZXJ0KGV2ZW50Lm1lc3NhZ2UpO1xuICogfSk7XG4gKlxuICogLy8gTG9nIHdpdGhpbiBhIGhvb2sgaGFuZGxlclxuICogZXhwb3J0IGRlZmF1bHQgcHJlVG9vbFVzZUhvb2soeyBtYXRjaGVyOiAnQmFzaCcgfSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci53YXJuKCdBYm91dCB0byB2YWxpZGF0ZSBCYXNoIGNvbW1hbmQnKTtcbiAqICAgcmV0dXJuIHByZVRvb2xVc2VPdXRwdXQoeyBhbGxvdzogdHJ1ZSB9KTtcbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjbGFzcyBMb2dnZXIge1xuICAgIC8qKlxuICAgICAqIFJlZ2lzdGVyZWQgZXZlbnQgaGFuZGxlcnMgYnkgbG9nIGxldmVsLlxuICAgICAqL1xuICAgIGhhbmRsZXJzID0gbmV3IE1hcCgpO1xuICAgIC8qKlxuICAgICAqIEZpbGUgZGVzY3JpcHRvciBmb3IgbG9nIGZpbGUgb3V0cHV0LlxuICAgICAqIExhemlseSBpbml0aWFsaXplZCBvbiBmaXJzdCB3cml0ZS5cbiAgICAgKi9cbiAgICBsb2dGaWxlRmQgPSBudWxsO1xuICAgIC8qKlxuICAgICAqIFBhdGggdG8gdGhlIGxvZyBmaWxlLCBpZiBjb25maWd1cmVkLlxuICAgICAqL1xuICAgIGxvZ0ZpbGVQYXRoID0gbnVsbDtcbiAgICAvKipcbiAgICAgKiBXaGV0aGVyIGZpbGUgaW5pdGlhbGl6YXRpb24gaGFzIGJlZW4gYXR0ZW1wdGVkLlxuICAgICAqL1xuICAgIGZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIC8qKlxuICAgICAqIEN1cnJlbnQgaG9vayBjb250ZXh0IGZvciBlbnJpY2hpbmcgbG9nIGV2ZW50cy5cbiAgICAgKi9cbiAgICBjdXJyZW50SG9va1R5cGU7XG4gICAgLyoqXG4gICAgICogQ3VycmVudCBob29rIGlucHV0IGZvciBlbnJpY2hpbmcgbG9nIGV2ZW50cy5cbiAgICAgKi9cbiAgICBjdXJyZW50SW5wdXQ7XG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhIG5ldyBMb2dnZXIgaW5zdGFuY2UuXG4gICAgICpcbiAgICAgKiBUeXBpY2FsbHkgeW91IHNob3VsZCB1c2UgdGhlIGV4cG9ydGVkIGBsb2dnZXJgIHNpbmdsZXRvbiByYXRoZXIgdGhhblxuICAgICAqIGNyZWF0aW5nIG5ldyBpbnN0YW5jZXMuXG4gICAgICogQHBhcmFtIGNvbmZpZyAtIE9wdGlvbmFsIGNvbmZpZ3VyYXRpb25cbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGBgYHR5cGVzY3JpcHRcbiAgICAgKiAvLyBVc2Ugc2luZ2xldG9uIChyZWNvbW1lbmRlZClcbiAgICAgKiBpbXBvcnQgeyBsb2dnZXIgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICAgICAqXG4gICAgICogLy8gT3IgY3JlYXRlIGN1c3RvbSBpbnN0YW5jZVxuICAgICAqIGNvbnN0IGN1c3RvbUxvZ2dlciA9IG5ldyBMb2dnZXIoeyBsb2dGaWxlUGF0aDogJy92YXIvbG9nL2hvb2tzLmxvZycgfSk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgY29uc3RydWN0b3IoY29uZmlnID0ge30pIHtcbiAgICAgICAgLy8gSW5pdGlhbGl6ZSBoYW5kbGVycyBtYXAgZm9yIGVhY2ggbGV2ZWxcbiAgICAgICAgZm9yIChjb25zdCBsZXZlbCBvZiBMT0dfTEVWRUxTKSB7XG4gICAgICAgICAgICB0aGlzLmhhbmRsZXJzLnNldChsZXZlbCwgbmV3IFNldCgpKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBTZXQgbG9nIGZpbGUgcGF0aCBmcm9tIGV4cGxpY2l0IGNvbmZpZywgb3IgYnkgcmVhZGluZyB0aGUgY29uZmlndXJlZCBlbnYgdmFyXG4gICAgICAgIHRoaXMubG9nRmlsZVBhdGggPSBjb25maWcubG9nRmlsZVBhdGggPz8gKGNvbmZpZy5sb2dFbnZWYXIgPyBwcm9jZXNzLmVudltjb25maWcubG9nRW52VmFyXSA6IHVuZGVmaW5lZCkgPz8gbnVsbDtcbiAgICB9XG4gICAgLyoqXG4gICAgICogTG9ncyBhIGRlYnVnIG1lc3NhZ2UuXG4gICAgICpcbiAgICAgKiBVc2UgZm9yIGRldGFpbGVkIGRlYnVnZ2luZyBpbmZvcm1hdGlvbiB0aGF0IGlzIHR5cGljYWxseSBvbmx5IHVzZWZ1bFxuICAgICAqIGR1cmluZyBkZXZlbG9wbWVudCBvciB0cm91Ymxlc2hvb3RpbmcuXG4gICAgICogQHBhcmFtIG1lc3NhZ2UgLSBUaGUgZGVidWcgbWVzc2FnZVxuICAgICAqIEBwYXJhbSBjb250ZXh0IC0gT3B0aW9uYWwgYWRkaXRpb25hbCBjb250ZXh0XG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0eXBlc2NyaXB0XG4gICAgICogbG9nZ2VyLmRlYnVnKCdQcm9jZXNzaW5nIHRvb2wgaW5wdXQnLCB7IHRvb2xOYW1lOiAnQmFzaCcsIGlucHV0U2l6ZTogMjU2IH0pO1xuICAgICAqIGBgYFxuICAgICAqL1xuICAgIGRlYnVnKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwiZGVidWdcIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIExvZ3MgYW4gaW5mbyBtZXNzYWdlLlxuICAgICAqXG4gICAgICogVXNlIGZvciBnZW5lcmFsIG9wZXJhdGlvbmFsIGV2ZW50cyBsaWtlIGhvb2sgaW52b2NhdGlvbnMsIHN1Y2Nlc3NmdWxcbiAgICAgKiBjb21wbGV0aW9ucywgb3Igc3RhdGUgY2hhbmdlcy5cbiAgICAgKiBAcGFyYW0gbWVzc2FnZSAtIFRoZSBpbmZvIG1lc3NhZ2VcbiAgICAgKiBAcGFyYW0gY29udGV4dCAtIE9wdGlvbmFsIGFkZGl0aW9uYWwgY29udGV4dFxuICAgICAqIEBleGFtcGxlXG4gICAgICogYGBgdHlwZXNjcmlwdFxuICAgICAqIGxvZ2dlci5pbmZvKCdTZXNzaW9uIHN0YXJ0ZWQnLCB7IHNvdXJjZTogJ3N0YXJ0dXAnLCBzZXNzaW9uSWQ6ICdhYmMxMjMnIH0pO1xuICAgICAqIGBgYFxuICAgICAqL1xuICAgIGluZm8obWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJpbmZvXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBMb2dzIGEgd2FybmluZyBtZXNzYWdlLlxuICAgICAqXG4gICAgICogVXNlIGZvciBjb25kaXRpb25zIHRoYXQgbWF5IGluZGljYXRlIGlzc3VlcyBidXQgZG9uJ3QgcHJldmVudFxuICAgICAqIG9wZXJhdGlvbiwgc3VjaCBhcyBkZXByZWNhdGVkIHBhdHRlcm5zIG9yIHBlcmZvcm1hbmNlIGNvbmNlcm5zLlxuICAgICAqIEBwYXJhbSBtZXNzYWdlIC0gVGhlIHdhcm5pbmcgbWVzc2FnZVxuICAgICAqIEBwYXJhbSBjb250ZXh0IC0gT3B0aW9uYWwgYWRkaXRpb25hbCBjb250ZXh0XG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0eXBlc2NyaXB0XG4gICAgICogbG9nZ2VyLndhcm4oJ0RlcHJlY2F0ZWQgaG9vayBwYXR0ZXJuIGRldGVjdGVkJywgeyBwYXR0ZXJuOiAnbGVnYWN5TWF0Y2hlcicgfSk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgd2FybihtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcIndhcm5cIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIExvZ3MgYW4gZXJyb3IgbWVzc2FnZS5cbiAgICAgKlxuICAgICAqIFVzZSBmb3IgZXJyb3IgY29uZGl0aW9ucyB0aGF0IHJlcXVpcmUgYXR0ZW50aW9uIGJ1dCB3ZXJlIGhhbmRsZWRcbiAgICAgKiBncmFjZWZ1bGx5LiBGb3IgZXhjZXB0aW9ucywgcHJlZmVyIHtAbGluayBsb2dFcnJvcn0uXG4gICAgICogQHBhcmFtIG1lc3NhZ2UgLSBUaGUgZXJyb3IgbWVzc2FnZVxuICAgICAqIEBwYXJhbSBjb250ZXh0IC0gT3B0aW9uYWwgYWRkaXRpb25hbCBjb250ZXh0XG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0eXBlc2NyaXB0XG4gICAgICogbG9nZ2VyLmVycm9yKCdGYWlsZWQgdG8gdmFsaWRhdGUgdG9vbCBpbnB1dCcsIHsgdG9vbE5hbWU6ICdCYXNoJywgcmVhc29uOiAnZW1wdHkgY29tbWFuZCcgfSk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgZXJyb3IobWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJlcnJvclwiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogTG9ncyBhIHN0cnVjdHVyZWQgZXJyb3Igd2l0aCBmdWxsIGVycm9yIGRldGFpbHMuXG4gICAgICpcbiAgICAgKiBVc2UgdGhpcyBtZXRob2Qgd2hlbiBsb2dnaW5nIGNhdWdodCBleGNlcHRpb25zIHRvIGNhcHR1cmUgdGhlIGZ1bGxcbiAgICAgKiBlcnJvciBjb250ZXh0IGluY2x1ZGluZyBuYW1lLCBtZXNzYWdlLCBzdGFjayB0cmFjZSwgYW5kIGNhdXNlIGNoYWluLlxuICAgICAqIEBwYXJhbSBlcnJvciAtIFRoZSBlcnJvciB0byBsb2dcbiAgICAgKiBAcGFyYW0gbWVzc2FnZSAtIEh1bWFuLXJlYWRhYmxlIGRlc2NyaXB0aW9uIG9mIHdoYXQgZmFpbGVkXG4gICAgICogQHBhcmFtIGNvbnRleHQgLSBPcHRpb25hbCBhZGRpdGlvbmFsIGNvbnRleHRcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGBgYHR5cGVzY3JpcHRcbiAgICAgKiB0cnkge1xuICAgICAqICAgYXdhaXQgZGFuZ2Vyb3VzT3BlcmF0aW9uKCk7XG4gICAgICogfSBjYXRjaCAoZXJyKSB7XG4gICAgICogICBsb2dnZXIubG9nRXJyb3IoZXJyLCAnRmFpbGVkIHRvIGV4ZWN1dGUgZGFuZ2Vyb3VzIG9wZXJhdGlvbicsIHtcbiAgICAgKiAgICAgb3BlcmF0aW9uOiAnZGVsZXRlJyxcbiAgICAgKiAgICAgdGFyZ2V0OiAnL2ltcG9ydGFudC9maWxlLnR4dCdcbiAgICAgKiAgIH0pO1xuICAgICAqIH1cbiAgICAgKiBgYGBcbiAgICAgKi9cbiAgICBsb2dFcnJvcihlcnJvciwgbWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICBjb25zdCBlcnJvckluZm8gPSB0aGlzLmV4dHJhY3RFcnJvckluZm8oZXJyb3IpO1xuICAgICAgICBjb25zdCBldmVudCA9IHtcbiAgICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgbGV2ZWw6IFwiZXJyb3JcIixcbiAgICAgICAgICAgIGhvb2tUeXBlOiB0aGlzLmN1cnJlbnRIb29rVHlwZSxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICBpbnB1dDogdGhpcy5jdXJyZW50SW5wdXQsXG4gICAgICAgICAgICBlcnJvcjogZXJyb3JJbmZvLFxuICAgICAgICAgICAgY29udGV4dCxcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5kZWxpdmVyRXZlbnQoZXZlbnQpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBTdWJzY3JpYmVzIGEgaGFuZGxlciB0byBsb2cgZXZlbnRzIGF0IHRoZSBzcGVjaWZpZWQgbGV2ZWwuXG4gICAgICpcbiAgICAgKiBUaGUgaGFuZGxlciB3aWxsIGJlIGNhbGxlZCBmb3IgZXZlcnkgbG9nIGV2ZW50IGF0IHRoZSBzcGVjaWZpZWQgbGV2ZWwuXG4gICAgICogUmV0dXJucyBhbiB1bnN1YnNjcmliZSBmdW5jdGlvbiB0aGF0IHNob3VsZCBiZSBjYWxsZWQgd2hlbiB0aGUgaGFuZGxlclxuICAgICAqIGlzIG5vIGxvbmdlciBuZWVkZWQuXG4gICAgICogQHBhcmFtIGxldmVsIC0gVGhlIGxvZyBsZXZlbCB0byBzdWJzY3JpYmUgdG9cbiAgICAgKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGNhbGwgZm9yIGVhY2ggZXZlbnRcbiAgICAgKiBAcmV0dXJucyBBIGZ1bmN0aW9uIHRvIHVuc3Vic2NyaWJlIHRoZSBoYW5kbGVyXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0eXBlc2NyaXB0XG4gICAgICogLy8gU3Vic2NyaWJlIHRvIGVycm9yIGV2ZW50c1xuICAgICAqIGNvbnN0IHVuc3Vic2NyaWJlID0gbG9nZ2VyLm9uKCdlcnJvcicsIChldmVudCkgPT4ge1xuICAgICAqICAgY29uc29sZS5lcnJvcihgWyR7ZXZlbnQuaG9va1R5cGV9XSAke2V2ZW50Lm1lc3NhZ2V9YCk7XG4gICAgICogICBpZiAoZXZlbnQuZXJyb3IpIHtcbiAgICAgKiAgICAgY29uc29sZS5lcnJvcihldmVudC5lcnJvci5zdGFjayk7XG4gICAgICogICB9XG4gICAgICogfSk7XG4gICAgICpcbiAgICAgKiAvLyBMYXRlciwgY2xlYW4gdXBcbiAgICAgKiB1bnN1YnNjcmliZSgpO1xuICAgICAqIGBgYFxuICAgICAqIEBleGFtcGxlXG4gICAgICogYGBgdHlwZXNjcmlwdFxuICAgICAqIC8vIEZvcndhcmQgdG8gZXh0ZXJuYWwgbG9nZ2luZyBsaWJyYXJ5XG4gICAgICogaW1wb3J0IHBpbm8gZnJvbSAncGlubyc7XG4gICAgICogY29uc3QgcGlub0xvZ2dlciA9IHBpbm8oKTtcbiAgICAgKlxuICAgICAqIGxvZ2dlci5vbignaW5mbycsIChldmVudCkgPT4gcGlub0xvZ2dlci5pbmZvKGV2ZW50LCBldmVudC5tZXNzYWdlKSk7XG4gICAgICogbG9nZ2VyLm9uKCd3YXJuJywgKGV2ZW50KSA9PiBwaW5vTG9nZ2VyLndhcm4oZXZlbnQsIGV2ZW50Lm1lc3NhZ2UpKTtcbiAgICAgKiBsb2dnZXIub24oJ2Vycm9yJywgKGV2ZW50KSA9PiBwaW5vTG9nZ2VyLmVycm9yKGV2ZW50LCBldmVudC5tZXNzYWdlKSk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgb24obGV2ZWwsIGhhbmRsZXIpIHtcbiAgICAgICAgY29uc3QgbGV2ZWxIYW5kbGVycyA9IHRoaXMuaGFuZGxlcnMuZ2V0KGxldmVsKTtcbiAgICAgICAgaWYgKGxldmVsSGFuZGxlcnMpIHtcbiAgICAgICAgICAgIGxldmVsSGFuZGxlcnMuYWRkKGhhbmRsZXIpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgICAgICBsZXZlbEhhbmRsZXJzPy5kZWxldGUoaGFuZGxlcik7XG4gICAgICAgIH07XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFNldHMgdGhlIGN1cnJlbnQgaG9vayBjb250ZXh0IGZvciBlbnJpY2hpbmcgbG9nIGV2ZW50cy5cbiAgICAgKlxuICAgICAqIFRoaXMgaXMgY2FsbGVkIGludGVybmFsbHkgYnkgdGhlIHJ1bnRpbWUgYmVmb3JlIGludm9raW5nIGhvb2sgaGFuZGxlcnMuXG4gICAgICogWW91IHR5cGljYWxseSBkb24ndCBuZWVkIHRvIGNhbGwgdGhpcyBkaXJlY3RseS5cbiAgICAgKiBAcGFyYW0gaG9va1R5cGUgLSBUaGUgdHlwZSBvZiBob29rIGJlaW5nIGV4ZWN1dGVkXG4gICAgICogQHBhcmFtIGlucHV0IC0gVGhlIGhvb2sgaW5wdXQgZGF0YVxuICAgICAqIEBpbnRlcm5hbFxuICAgICAqL1xuICAgIHNldENvbnRleHQoaG9va1R5cGUsIGlucHV0KSB7XG4gICAgICAgIHRoaXMuY3VycmVudEhvb2tUeXBlID0gaG9va1R5cGU7XG4gICAgICAgIHRoaXMuY3VycmVudElucHV0ID0gaW5wdXQ7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENsZWFycyB0aGUgY3VycmVudCBob29rIGNvbnRleHQuXG4gICAgICpcbiAgICAgKiBDYWxsZWQgaW50ZXJuYWxseSBieSB0aGUgcnVudGltZSBhZnRlciBob29rIGV4ZWN1dGlvbiBjb21wbGV0ZXMuXG4gICAgICogQGludGVybmFsXG4gICAgICovXG4gICAgY2xlYXJDb250ZXh0KCkge1xuICAgICAgICB0aGlzLmN1cnJlbnRIb29rVHlwZSA9IHVuZGVmaW5lZDtcbiAgICAgICAgdGhpcy5jdXJyZW50SW5wdXQgPSB1bmRlZmluZWQ7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENvbmZpZ3VyZXMgdGhlIGxvZyBmaWxlIHBhdGggYXQgcnVudGltZS5cbiAgICAgKlxuICAgICAqIENhbGwgdGhpcyB0byBlbmFibGUgb3IgY2hhbmdlIGZpbGUgbG9nZ2luZy4gU2V0dGluZyB0byBgbnVsbGAgZGlzYWJsZXNcbiAgICAgKiBmaWxlIGxvZ2dpbmcgKGJ1dCBkb2Vzbid0IGNsb3NlIGV4aXN0aW5nIGZpbGUgaGFuZGxlIGltbWVkaWF0ZWx5KS5cbiAgICAgKiBAcGFyYW0gZmlsZVBhdGggLSBQYXRoIHRvIHRoZSBsb2cgZmlsZSwgb3IgbnVsbCB0byBkaXNhYmxlXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0eXBlc2NyaXB0XG4gICAgICogLy8gRW5hYmxlIGZpbGUgbG9nZ2luZyBhdCBydW50aW1lXG4gICAgICogbG9nZ2VyLnNldExvZ0ZpbGUoJy92YXIvbG9nL2NsYXVkZS1ob29rcy5sb2cnKTtcbiAgICAgKlxuICAgICAqIC8vIERpc2FibGUgZmlsZSBsb2dnaW5nXG4gICAgICogbG9nZ2VyLnNldExvZ0ZpbGUobnVsbCk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgc2V0TG9nRmlsZShmaWxlUGF0aCkge1xuICAgICAgICAvLyBDbG9zZSBleGlzdGluZyBmaWxlIGlmIG9wZW5cbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZUZkICE9PSBudWxsKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNsb3NlU3luYyh0aGlzLmxvZ0ZpbGVGZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXRjaCAoY2xvc2VFcnJvcikge1xuICAgICAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGBbY2xhdWRlLWNvZGUtaG9va3NdIEZhaWxlZCB0byBjbG9zZSBsb2cgZmlsZTogJHtTdHJpbmcoY2xvc2VFcnJvcil9XFxuYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLmxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5sb2dGaWxlUGF0aCA9IGZpbGVQYXRoO1xuICAgICAgICB0aGlzLmZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBDbG9zZXMgYWxsIHJlc291cmNlcyBoZWxkIGJ5IHRoZSBsb2dnZXIuXG4gICAgICpcbiAgICAgKiBDYWxsIHRoaXMgZHVyaW5nIGdyYWNlZnVsIHNodXRkb3duIHRvIGVuc3VyZSBhbGwgbG9nIGRhdGEgaXMgZmx1c2hlZC5cbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGBgYHR5cGVzY3JpcHRcbiAgICAgKiBwcm9jZXNzLm9uKCdleGl0JywgKCkgPT4ge1xuICAgICAqICAgbG9nZ2VyLmNsb3NlKCk7XG4gICAgICogfSk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgY2xvc2UoKSB7XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjbG9zZVN5bmModGhpcy5sb2dGaWxlRmQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2F0Y2ggKGNsb3NlRXJyb3IpIHtcbiAgICAgICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgW2NsYXVkZS1jb2RlLWhvb2tzXSBGYWlsZWQgdG8gY2xvc2UgbG9nIGZpbGU6ICR7U3RyaW5nKGNsb3NlRXJyb3IpfVxcbmApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5sb2dGaWxlRmQgPSBudWxsO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuZmlsZUluaXRpYWxpemVkID0gZmFsc2U7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENoZWNrcyBpZiB0aGVyZSBhcmUgYW55IGFjdGl2ZSBoYW5kbGVycyBvciBkZXN0aW5hdGlvbnMuXG4gICAgICpcbiAgICAgKiBSZXR1cm5zIHRydWUgaWYgYW55IGhhbmRsZXJzIGFyZSByZWdpc3RlcmVkIG9yIGZpbGUgbG9nZ2luZyBpcyBlbmFibGVkLlxuICAgICAqIEByZXR1cm5zIFdoZXRoZXIgdGhlIGxvZ2dlciBoYXMgYW55IGFjdGl2ZSBvdXRwdXQgZGVzdGluYXRpb25zXG4gICAgICovXG4gICAgaGFzRGVzdGluYXRpb25zKCkge1xuICAgICAgICBmb3IgKGNvbnN0IGhhbmRsZXJzIG9mIHRoaXMuaGFuZGxlcnMudmFsdWVzKCkpIHtcbiAgICAgICAgICAgIGlmIChoYW5kbGVycy5zaXplID4gMClcbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5sb2dGaWxlUGF0aCAhPT0gbnVsbDtcbiAgICB9XG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFByaXZhdGUgTWV0aG9kc1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvKipcbiAgICAgKiBFbWl0cyBhIGxvZyBldmVudC5cbiAgICAgKiBAcGFyYW0gbGV2ZWwgLSBUaGUgc2V2ZXJpdHkgbGV2ZWwgb2YgdGhlIGV2ZW50XG4gICAgICogQHBhcmFtIG1lc3NhZ2UgLSBUaGUgbG9nIG1lc3NhZ2VcbiAgICAgKiBAcGFyYW0gY29udGV4dCAtIE9wdGlvbmFsIGFkZGl0aW9uYWwgY29udGV4dCBkYXRhXG4gICAgICovXG4gICAgZW1pdChsZXZlbCwgbWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICBjb25zdCBldmVudCA9IHtcbiAgICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgbGV2ZWwsXG4gICAgICAgICAgICBob29rVHlwZTogdGhpcy5jdXJyZW50SG9va1R5cGUsXG4gICAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgICAgaW5wdXQ6IHRoaXMuY3VycmVudElucHV0LFxuICAgICAgICAgICAgY29udGV4dCxcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5kZWxpdmVyRXZlbnQoZXZlbnQpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBEZWxpdmVycyBhbiBldmVudCB0byBhbGwgcmVnaXN0ZXJlZCBkZXN0aW5hdGlvbnMuXG4gICAgICogQHBhcmFtIGV2ZW50IC0gVGhlIGxvZyBldmVudCB0byBkZWxpdmVyXG4gICAgICovXG4gICAgZGVsaXZlckV2ZW50KGV2ZW50KSB7XG4gICAgICAgIC8vIERlbGl2ZXIgdG8gZXZlbnQgaGFuZGxlcnNcbiAgICAgICAgY29uc3QgbGV2ZWxIYW5kbGVycyA9IHRoaXMuaGFuZGxlcnMuZ2V0KGV2ZW50LmxldmVsKTtcbiAgICAgICAgaWYgKGxldmVsSGFuZGxlcnMpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgaGFuZGxlciBvZiBsZXZlbEhhbmRsZXJzKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgaGFuZGxlcihldmVudCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNhdGNoIChoYW5kbGVyRXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYFtjbGF1ZGUtY29kZS1ob29rc10gTG9nIGhhbmRsZXIgZXJyb3I6ICR7U3RyaW5nKGhhbmRsZXJFcnJvcil9XFxuYCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIC8vIFdyaXRlIHRvIGZpbGUgaWYgY29uZmlndXJlZFxuICAgICAgICB0aGlzLndyaXRlVG9GaWxlKGV2ZW50KTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogV3JpdGVzIGFuIGV2ZW50IHRvIHRoZSBsb2cgZmlsZS5cbiAgICAgKiBAcGFyYW0gZXZlbnQgLSBUaGUgbG9nIGV2ZW50IHRvIHdyaXRlXG4gICAgICovXG4gICAgd3JpdGVUb0ZpbGUoZXZlbnQpIHtcbiAgICAgICAgaWYgKCF0aGlzLmxvZ0ZpbGVQYXRoKVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAvLyBMYXp5IGluaXRpYWxpemF0aW9uIG9mIGZpbGUgaGFuZGxlXG4gICAgICAgIGlmICghdGhpcy5maWxlSW5pdGlhbGl6ZWQpIHtcbiAgICAgICAgICAgIHRoaXMuaW5pdGlhbGl6ZUZpbGUoKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5sb2dGaWxlRmQgPT09IG51bGwpXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBsaW5lID0gYCR7SlNPTi5zdHJpbmdpZnkoZXZlbnQpfVxcbmA7XG4gICAgICAgICAgICB3cml0ZVN5bmModGhpcy5sb2dGaWxlRmQsIGxpbmUpO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoICh3cml0ZUVycm9yKSB7XG4gICAgICAgICAgICAvLyBEaXNhYmxlIGZpbGUgbG9nZ2luZyBhZnRlciBhIHdyaXRlIGZhaWx1cmUgdG8gYXZvaWQgcmVwZWF0ZWQgZXJyb3JzXG4gICAgICAgICAgICB0aGlzLmxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgICAgICAgICB0aGlzLmZpbGVJbml0aWFsaXplZCA9IGZhbHNlO1xuICAgICAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYFtjbGF1ZGUtY29kZS1ob29rc10gTG9nIGZpbGUgd3JpdGUgZmFpbGVkOiAke1N0cmluZyh3cml0ZUVycm9yKX1cXG5gKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBJbml0aWFsaXplcyB0aGUgbG9nIGZpbGUgZm9yIHdyaXRpbmcuXG4gICAgICovXG4gICAgaW5pdGlhbGl6ZUZpbGUoKSB7XG4gICAgICAgIHRoaXMuZmlsZUluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICAgICAgaWYgKCF0aGlzLmxvZ0ZpbGVQYXRoKVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgLy8gRW5zdXJlIGRpcmVjdG9yeSBleGlzdHNcbiAgICAgICAgICAgIGNvbnN0IGRpciA9IGRpcm5hbWUodGhpcy5sb2dGaWxlUGF0aCk7XG4gICAgICAgICAgICBpZiAoIWV4aXN0c1N5bmMoZGlyKSkge1xuICAgICAgICAgICAgICAgIG1rZGlyU3luYyhkaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gT3BlbiBmaWxlIGZvciBhcHBlbmRpbmdcbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gb3BlblN5bmModGhpcy5sb2dGaWxlUGF0aCwgXCJhXCIpO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoIHtcbiAgICAgICAgICAgIC8vIFNpbGVudGx5IGlnbm9yZSBmaWxlIGluaXRpYWxpemF0aW9uIGVycm9yc1xuICAgICAgICAgICAgdGhpcy5sb2dGaWxlRmQgPSBudWxsO1xuICAgICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEV4dHJhY3RzIHN0cnVjdHVyZWQgZXJyb3IgaW5mb3JtYXRpb24gZnJvbSBhbiB1bmtub3duIGVycm9yLlxuICAgICAqIEBwYXJhbSBlcnJvciAtIFRoZSBlcnJvciB0byBleHRyYWN0IGluZm9ybWF0aW9uIGZyb21cbiAgICAgKiBAcmV0dXJucyBTdHJ1Y3R1cmVkIGVycm9yIGluZm9ybWF0aW9uXG4gICAgICovXG4gICAgZXh0cmFjdEVycm9ySW5mbyhlcnJvcikge1xuICAgICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICAgICAgY29uc3QgaW5mbyA9IHtcbiAgICAgICAgICAgICAgICBuYW1lOiBlcnJvci5uYW1lLFxuICAgICAgICAgICAgICAgIG1lc3NhZ2U6IGVycm9yLm1lc3NhZ2UsXG4gICAgICAgICAgICAgICAgc3RhY2s6IGVycm9yLnN0YWNrLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIC8vIEV4dHJhY3QgY2F1c2UgY2hhaW4gaWYgcHJlc2VudFxuICAgICAgICAgICAgaWYgKGVycm9yLmNhdXNlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICBpbmZvLmNhdXNlID0gdGhpcy5leHRyYWN0RXJyb3JJbmZvKGVycm9yLmNhdXNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBpbmZvO1xuICAgICAgICB9XG4gICAgICAgIC8vIEhhbmRsZSBub24tRXJyb3IgdmFsdWVzXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBuYW1lOiBcIlVua25vd25FcnJvclwiLFxuICAgICAgICAgICAgbWVzc2FnZTogU3RyaW5nKGVycm9yKSxcbiAgICAgICAgfTtcbiAgICB9XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTaW5nbGV0b24gRXhwb3J0XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIEdsb2JhbCBsb2dnZXIgaW5zdGFuY2UgZm9yIENsYXVkZSBDb2RlIGhvb2tzLlxuICpcbiAqIFVzZSB0aGlzIHNpbmdsZXRvbiBmb3IgYWxsIGxvZ2dpbmcgd2l0aGluIGhvb2tzLiBUaGUgbG9nZ2VyIGlzIGNvbmZpZ3VyZWRcbiAqIHZpYSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgYW5kIHN1cHBvcnRzIGV2ZW50IHN1YnNjcmlwdGlvbiBmb3IgY3VzdG9tXG4gKiBkZXN0aW5hdGlvbnMuXG4gKlxuICogIyMgQ29uZmlndXJhdGlvblxuICpcbiAqIHwgRW52aXJvbm1lbnQgVmFyaWFibGUgfCBEZXNjcmlwdGlvbiB8XG4gKiB8LS0tLS0tLS0tLS0tLS0tLS0tLS0tfC0tLS0tLS0tLS0tLS18XG4gKiB8IGBDTEFVREVfQ09ERV9IT09LU19MT0dfRklMRWAgfCBQYXRoIHRvIGxvZyBmaWxlIChKU09OIExpbmVzIGZvcm1hdCkgfFxuICpcbiAqICMjIFVzYWdlIGluIEhvb2tzXG4gKlxuICogVGhlIGxvZ2dlciBpcyBwYXNzZWQgdG8gaG9vayBoYW5kbGVycyB2aWEgY29udGV4dCBmb3IgY29udmVuaWVuY2U6XG4gKlxuICogYGBgdHlwZXNjcmlwdFxuICogZXhwb3J0IGRlZmF1bHQgcHJlVG9vbFVzZUhvb2soeyBtYXRjaGVyOiAnQmFzaCcgfSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci53YXJuKCdWYWxpZGF0aW5nIEJhc2ggY29tbWFuZCcpO1xuICogICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7IGFsbG93OiB0cnVlIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqXG4gKiAjIyBFeHRlcm5hbCBJbnRlZ3JhdGlvblxuICpcbiAqIFN1YnNjcmliZSB0byBldmVudHMgdG8gZm9yd2FyZCBsb2dzIHRvIGV4dGVybmFsIHN5c3RlbXM6XG4gKlxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqIGltcG9ydCBwaW5vIGZyb20gJ3Bpbm8nO1xuICpcbiAqIGNvbnN0IHBpbm9Mb2dnZXIgPSBwaW5vKHsgbGV2ZWw6ICdkZWJ1ZycgfSk7XG4gKlxuICogbG9nZ2VyLm9uKCdkZWJ1ZycsIChldmVudCkgPT4gcGlub0xvZ2dlci5kZWJ1ZyhldmVudCwgZXZlbnQubWVzc2FnZSkpO1xuICogbG9nZ2VyLm9uKCdpbmZvJywgKGV2ZW50KSA9PiBwaW5vTG9nZ2VyLmluZm8oZXZlbnQsIGV2ZW50Lm1lc3NhZ2UpKTtcbiAqIGxvZ2dlci5vbignd2FybicsIChldmVudCkgPT4gcGlub0xvZ2dlci53YXJuKGV2ZW50LCBldmVudC5tZXNzYWdlKSk7XG4gKiBsb2dnZXIub24oJ2Vycm9yJywgKGV2ZW50KSA9PiBwaW5vTG9nZ2VyLmVycm9yKGV2ZW50LCBldmVudC5tZXNzYWdlKSk7XG4gKiBgYGBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBEaXJlY3QgdXNhZ2VcbiAqIGltcG9ydCB7IGxvZ2dlciB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogbG9nZ2VyLmluZm8oJ1N0YXJ0aW5nIG9wZXJhdGlvbicpO1xuICogbG9nZ2VyLndhcm4oJ1Jlc291cmNlIGxpbWl0IGFwcHJvYWNoaW5nJywgeyB1c2FnZTogMC45IH0pO1xuICpcbiAqIHRyeSB7XG4gKiAgIGF3YWl0IHJpc2t5T3BlcmF0aW9uKCk7XG4gKiB9IGNhdGNoIChlcnIpIHtcbiAqICAgbG9nZ2VyLmxvZ0Vycm9yKGVyciwgJ1Jpc2t5IG9wZXJhdGlvbiBmYWlsZWQnKTtcbiAqIH1cbiAqIGBgYFxuICovXG4vLyBDTEFVREVfQ09ERV9IT09LU19MT0dfRU5WX1ZBUiBpcyBzZXQgdW5jb25kaXRpb25hbGx5IGJ5IHRoZSAtLWxvZy1lbnYtdmFyIGJhbm5lclxuLy8gYmVmb3JlIHRoaXMgbW9kdWxlIGluaXRpYWxpc2VzLiBJZiBhYnNlbnQsIGZhbGwgYmFjayB0byB0aGUgZGVmYXVsdCBlbnYgdmFyIG5hbWUuXG5leHBvcnQgY29uc3QgbG9nZ2VyID0gbmV3IExvZ2dlcih7XG4gICAgbG9nRW52VmFyOiBwcm9jZXNzLmVudi5DTEFVREVfQ09ERV9IT09LU19MT0dfRU5WX1ZBUiA/PyBcIkNMQVVERV9DT0RFX0hPT0tTX0xPR19GSUxFXCIsXG59KTtcbiIsICIvKipcbiAqIE91dHB1dCB0eXBlcyBhbmQgYnVpbGRlcnMgZm9yIENsYXVkZSBDb2RlIGhvb2tzLlxuICpcbiAqIFByb3ZpZGVzIHR5cGUtc2FmZSBvdXRwdXQgYnVpbGRlciBmdW5jdGlvbnMgZm9yIGFsbCAxMiBob29rIHR5cGVzLiBFYWNoIGJ1aWxkZXJcbiAqIGFjY2VwdHMgb3B0aW9ucyB0aGF0IG1hdGNoIHRoZSB3aXJlIGZvcm1hdCBleHBlY3RlZCBieSBDbGF1ZGUgQ29kZSwgd2l0aCB0eXBlc1xuICogZGVyaXZlZCBmcm9tIHRoZSBDbGF1ZGUgQWdlbnQgU0RLJ3MgYFN5bmNIb29rSlNPTk91dHB1dGAgdHlwZS5cbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rc1xuICogQG1vZHVsZVxuICovXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFeGl0IENvZGUgQ29uc3RhbnRzXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIEV4aXQgY29kZXMgdXNlZCBieSBDbGF1ZGUgQ29kZSBob29rcy5cbiAqXG4gKiB8IEV4aXQgQ29kZSB8IE5hbWUgfCBXaGVuIFVzZWQgfCBDbGF1ZGUgQ29kZSBCZWhhdmlvciB8XG4gKiB8LS0tLS0tLS0tLS18LS0tLS0tfC0tLS0tLS0tLS0tfC0tLS0tLS0tLS0tLS0tLS0tLS0tLXxcbiAqIHwgMCB8IFN1Y2Nlc3MgfCBIYW5kbGVyIHJldHVybnMgbm9ybWFsbHkgfCBDb250aW51ZSwgcGFyc2Ugc3Rkb3V0IGFzIEpTT04gfFxuICogfCAxIHwgRXJyb3IgfCBJbnZhbGlkIGlucHV0LCBub24tYmxvY2tpbmcgZXJyb3IgfCBOb24tYmxvY2tpbmcsIHN0ZGVyciB0byB1c2VyIG9ubHkgfFxuICogfCAyIHwgQmxvY2sgfCBIYW5kbGVyIHRocm93cyBPUiBgc3RvcFJlYXNvbmAgc2V0IHwgQmxvY2tpbmcsIHN0ZGVyciBzaG93biB0byBDbGF1ZGUgfFxuICovXG5leHBvcnQgY29uc3QgRVhJVF9DT0RFUyA9IHtcbiAgICAvKiogSGFuZGxlciBjb21wbGV0ZWQgc3VjY2Vzc2Z1bGx5LiBDbGF1ZGUgQ29kZSBwYXJzZXMgc3Rkb3V0IGFzIEpTT04uICovXG4gICAgU1VDQ0VTUzogMCxcbiAgICAvKiogTm9uLWJsb2NraW5nIGVycm9yIG9jY3VycmVkIChlLmcuLCBpbnZhbGlkIGlucHV0KS4gc3RkZXJyIHNob3duIHRvIHVzZXIgb25seS4gKi9cbiAgICBFUlJPUjogMSxcbiAgICAvKiogSGFuZGxlciB0aHJldyBleGNlcHRpb24gT1IgYmxvY2tpbmcgYWN0aW9uIHJlcXVlc3RlZC4gc3RkZXJyIHNob3duIHRvIENsYXVkZS4gKi9cbiAgICBCTE9DSzogMixcbn07XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBPdXRwdXQgQnVpbGRlciBGYWN0b3JpZXNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogRmFjdG9yeSBmb3IgaG9va3MgdGhhdCBoYXZlIGhvb2tTcGVjaWZpY091dHB1dCB3aXRoIGEgaG9va0V2ZW50TmFtZSBkaXNjcmltaW5hdG9yLlxuICogQHBhcmFtIGhvb2tUeXBlIC0gVGhlIGhvb2sgdHlwZSBuYW1lIHVzZWQgYXMgdGhlIF90eXBlIGRpc2NyaW1pbmF0b3JcbiAqIEByZXR1cm5zIEEgYnVpbGRlciBmdW5jdGlvbiB0aGF0IGNyZWF0ZXMgdGhlIG91dHB1dCBvYmplY3RcbiAqIEBpbnRlcm5hbFxuICovXG5mdW5jdGlvbiBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKGhvb2tUeXBlKSB7XG4gICAgcmV0dXJuIChvcHRpb25zID0ge30pID0+IHtcbiAgICAgICAgY29uc3QgeyBob29rU3BlY2lmaWNPdXRwdXQsIC4uLnJlc3QgfSA9IG9wdGlvbnM7XG4gICAgICAgIGNvbnN0IHN0ZG91dCA9IGhvb2tTcGVjaWZpY091dHB1dCAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgICA/IHsgLi4ucmVzdCwgaG9va1NwZWNpZmljT3V0cHV0OiB7IGhvb2tFdmVudE5hbWU6IGhvb2tUeXBlLCAuLi5ob29rU3BlY2lmaWNPdXRwdXQgfSB9XG4gICAgICAgICAgICA6IHJlc3Q7XG4gICAgICAgIHJldHVybiB7IF90eXBlOiBob29rVHlwZSwgc3Rkb3V0IH07XG4gICAgfTtcbn1cbi8qKlxuICogRmFjdG9yeSBmb3IgaG9va3MgdGhhdCBvbmx5IHVzZSBDb21tb25PcHRpb25zIChzaW1wbGUgcGFzc3Rocm91Z2gpLlxuICogQHBhcmFtIGhvb2tUeXBlIC0gVGhlIGhvb2sgdHlwZSBuYW1lIHVzZWQgYXMgdGhlIF90eXBlIGRpc2NyaW1pbmF0b3JcbiAqIEByZXR1cm5zIEEgYnVpbGRlciBmdW5jdGlvbiB0aGF0IGNyZWF0ZXMgdGhlIG91dHB1dCBvYmplY3RcbiAqIEBpbnRlcm5hbFxuICovXG5mdW5jdGlvbiBjcmVhdGVTaW1wbGVPdXRwdXRCdWlsZGVyKGhvb2tUeXBlKSB7XG4gICAgcmV0dXJuIChvcHRpb25zID0ge30pID0+ICh7XG4gICAgICAgIF90eXBlOiBob29rVHlwZSxcbiAgICAgICAgc3Rkb3V0OiBvcHRpb25zLFxuICAgIH0pO1xufVxuLyoqXG4gKiBGYWN0b3J5IGZvciB3b3JrdHJlZSBob29rcyAoV29ya3RyZWVDcmVhdGUsIFdvcmt0cmVlUmVtb3ZlKS5cbiAqXG4gKiBUaGVzZSBhcmUgY29tbWFuZCBob29rcyB3aG9zZSB3aXJlIHByb3RvY29sIGlzIGEgKipiYXJlIHBhdGggb24gc3Rkb3V0KiosIG5vdCBKU09OOlxuICogQ2xhdWRlIENvZGUgcmVhZHMgdGhlIGhvb2sncyBzdGRvdXQgdmVyYmF0aW0gYW5kIGBjaGRpcmBzIGludG8gaXQuIFRoZSBidWlsZGVyIGNhcnJpZXNcbiAqIHRoZSBwYXRoIGluIGByYXdTdGRvdXRgIHNvIHRoZSBydW50aW1lIGVtaXRzIGl0IGFzIHBsYWluIHRleHQgaW5zdGVhZCBvZlxuICogYEpTT04uc3RyaW5naWZ5KHN0ZG91dClgLlxuICogQHBhcmFtIGhvb2tUeXBlIC0gVGhlIGhvb2sgdHlwZSBuYW1lIHVzZWQgYXMgdGhlIF90eXBlIGRpc2NyaW1pbmF0b3JcbiAqIEByZXR1cm5zIEEgYnVpbGRlciBmdW5jdGlvbiB0aGF0IGNyZWF0ZXMgdGhlIG91dHB1dCBvYmplY3RcbiAqIEBpbnRlcm5hbFxuICovXG5mdW5jdGlvbiBjcmVhdGVXb3JrdHJlZU91dHB1dEJ1aWxkZXIoaG9va1R5cGUpIHtcbiAgICByZXR1cm4gKG9wdGlvbnMpID0+IHtcbiAgICAgICAgY29uc3QgeyB3b3JrdHJlZVBhdGgsIC4uLnJlc3QgfSA9IG9wdGlvbnM7XG4gICAgICAgIHJldHVybiB7IF90eXBlOiBob29rVHlwZSwgc3Rkb3V0OiByZXN0LCByYXdTdGRvdXQ6IHdvcmt0cmVlUGF0aCB9O1xuICAgIH07XG59XG4vKipcbiAqIEZhY3RvcnkgZm9yIGhvb2tzIHRoYXQgdXNlIGRlY2lzaW9uLWJhc2VkIG9wdGlvbnMgKFN0b3AsIFN1YmFnZW50U3RvcCkuXG4gKiBAcGFyYW0gaG9va1R5cGUgLSBUaGUgaG9vayB0eXBlIG5hbWUgdXNlZCBhcyB0aGUgX3R5cGUgZGlzY3JpbWluYXRvclxuICogQHJldHVybnMgQSBidWlsZGVyIGZ1bmN0aW9uIHRoYXQgY3JlYXRlcyB0aGUgb3V0cHV0IG9iamVjdFxuICogQGludGVybmFsXG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZURlY2lzaW9uT3V0cHV0QnVpbGRlcihob29rVHlwZSkge1xuICAgIHJldHVybiAob3B0aW9ucyA9IHt9KSA9PiAoe1xuICAgICAgICBfdHlwZTogaG9va1R5cGUsXG4gICAgICAgIHN0ZG91dDogb3B0aW9ucyxcbiAgICB9KTtcbn1cbi8qKlxuICogRmFjdG9yeSBmb3IgZXhpdC1jb2RlLWJhc2VkIGhvb2tzIChUZWFtbWF0ZUlkbGUsIFRhc2tDb21wbGV0ZWQpLlxuICpcbiAqIFRoZXNlIGhvb2tzIGRvbid0IHVzZSBKU09OIGRlY2lzaW9uIGNvbnRyb2wgKG5vIENvbW1vbk9wdGlvbnMpLlxuICogVGhlIG9ubHkgb3B0aW9uIGlzIGBzdGRlcnJgIFx1MjAxNCB3aGVuIHByZXNlbnQsIGl0IHRyaWdnZXJzIGV4aXQgY29kZSAyIChCTE9DSykuXG4gKiBTdGRvdXQgYWx3YXlzIHJlY2VpdmVzIGB7fWAgKGVtcHR5IEpTT04gb2JqZWN0KS5cbiAqIEBwYXJhbSBob29rVHlwZSAtIFRoZSBob29rIHR5cGUgbmFtZSB1c2VkIGFzIHRoZSBfdHlwZSBkaXNjcmltaW5hdG9yXG4gKiBAcmV0dXJucyBBIGJ1aWxkZXIgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIHRoZSBvdXRwdXQgb2JqZWN0XG4gKiBAaW50ZXJuYWxcbiAqL1xuZnVuY3Rpb24gY3JlYXRlRXhpdENvZGVPdXRwdXRCdWlsZGVyKGhvb2tUeXBlKSB7XG4gICAgcmV0dXJuICh7IHN0ZGVyciB9ID0ge30pID0+ICh7XG4gICAgICAgIF90eXBlOiBob29rVHlwZSxcbiAgICAgICAgc3Rkb3V0OiB7fSxcbiAgICAgICAgLi4uKHN0ZGVyciAhPT0gdW5kZWZpbmVkID8geyBzdGRlcnIgfSA6IHt9KSxcbiAgICB9KTtcbn1cbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFByZVRvb2xVc2UgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFByZVRvb2xVc2VPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEFsbG93IHRvb2wgZXhlY3V0aW9uXG4gKiBwcmVUb29sVXNlT3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7IHBlcm1pc3Npb25EZWNpc2lvbjogJ2FsbG93JyB9XG4gKiB9KTtcbiAqXG4gKiAvLyBEZW55IHdpdGggcmVhc29uXG4gKiBwcmVUb29sVXNlT3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgcGVybWlzc2lvbkRlY2lzaW9uOiAnZGVueScsXG4gKiAgICAgcGVybWlzc2lvbkRlY2lzaW9uUmVhc29uOiAnRGFuZ2Vyb3VzIGNvbW1hbmQgZGV0ZWN0ZWQnXG4gKiAgIH1cbiAqIH0pO1xuICpcbiAqIC8vIEFsbG93IHdpdGggbW9kaWZpZWQgaW5wdXRcbiAqIHByZVRvb2xVc2VPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICBwZXJtaXNzaW9uRGVjaXNpb246ICdhbGxvdycsXG4gKiAgICAgdXBkYXRlZElucHV0OiB7IGNvbW1hbmQ6ICdscyAtbGEnIH1cbiAqICAgfVxuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHByZVRvb2xVc2VPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIlByZVRvb2xVc2VcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBQb3N0VG9vbFVzZSBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgUG9zdFRvb2xVc2VPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEFkZCBjb250ZXh0IGFmdGVyIGEgZmlsZSByZWFkXG4gKiBwb3N0VG9vbFVzZU91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDoge1xuICogICAgIGFkZGl0aW9uYWxDb250ZXh0OiAnRmlsZSBjb250YWlucyBzZW5zaXRpdmUgZGF0YSdcbiAqICAgfVxuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHBvc3RUb29sVXNlT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJQb3N0VG9vbFVzZVwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFBvc3RUb29sVXNlRmFpbHVyZSBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgUG9zdFRvb2xVc2VGYWlsdXJlT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBwb3N0VG9vbFVzZUZhaWx1cmVPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICBhZGRpdGlvbmFsQ29udGV4dDogJ1RyeSB1c2luZyBhIGRpZmZlcmVudCBhcHByb2FjaCdcbiAqICAgfVxuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHBvc3RUb29sVXNlRmFpbHVyZU91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiUG9zdFRvb2xVc2VGYWlsdXJlXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgUG9zdFRvb2xCYXRjaCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgUG9zdFRvb2xCYXRjaE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogcG9zdFRvb2xCYXRjaE91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDoge1xuICogICAgIGFkZGl0aW9uYWxDb250ZXh0OiAnQWxsIGVkaXRzIGluIHRoZSBiYXRjaCB3ZXJlIGFwcGxpZWQgc3VjY2Vzc2Z1bGx5J1xuICogICB9XG4gKiB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgcG9zdFRvb2xCYXRjaE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiUG9zdFRvb2xCYXRjaFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFVzZXJQcm9tcHRFeHBhbnNpb24gaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFVzZXJQcm9tcHRFeHBhbnNpb25PdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIHVzZXJQcm9tcHRFeHBhbnNpb25PdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICBhZGRpdGlvbmFsQ29udGV4dDogJ1NsYXNoIGNvbW1hbmQgZXhwYW5kZWQgd2l0aCBhZGRpdGlvbmFsIGNvbnRleHQnXG4gKiAgIH1cbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCB1c2VyUHJvbXB0RXhwYW5zaW9uT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJVc2VyUHJvbXB0RXhwYW5zaW9uXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgVXNlclByb21wdFN1Ym1pdCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgVXNlclByb21wdFN1Ym1pdE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogdXNlclByb21wdFN1Ym1pdE91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDoge1xuICogICAgIGFkZGl0aW9uYWxDb250ZXh0OiAnVGhpcyBwcm9qZWN0IHVzZXMgVHlwZVNjcmlwdCBzdHJpY3QgbW9kZSdcbiAqICAgfVxuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHVzZXJQcm9tcHRTdWJtaXRPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIlVzZXJQcm9tcHRTdWJtaXRcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBTZXNzaW9uU3RhcnQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFNlc3Npb25TdGFydE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogc2Vzc2lvblN0YXJ0T3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgYWRkaXRpb25hbENvbnRleHQ6IEpTT04uc3RyaW5naWZ5KHsgcHJvamVjdDogJ215LXByb2plY3QnIH0pXG4gKiAgIH1cbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBzZXNzaW9uU3RhcnRPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIlNlc3Npb25TdGFydFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFNlc3Npb25FbmQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFNlc3Npb25FbmRPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIHNlc3Npb25FbmRPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBzZXNzaW9uRW5kT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZVNpbXBsZU91dHB1dEJ1aWxkZXIoXCJTZXNzaW9uRW5kXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgU3RvcCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgU3RvcE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQWxsb3cgdGhlIHN0b3BcbiAqIHN0b3BPdXRwdXQoeyBkZWNpc2lvbjogJ2FwcHJvdmUnIH0pO1xuICpcbiAqIC8vIEJsb2NrIHdpdGggcmVhc29uXG4gKiBzdG9wT3V0cHV0KHtcbiAqICAgZGVjaXNpb246ICdibG9jaycsXG4gKiAgIHJlYXNvbjogJ1RoZXJlIGFyZSB1bmNvbW1pdHRlZCBjaGFuZ2VzJ1xuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHN0b3BPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlRGVjaXNpb25PdXRwdXRCdWlsZGVyKFwiU3RvcFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFN0b3BGYWlsdXJlIGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBTdG9wRmFpbHVyZU91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogc3RvcEZhaWx1cmVPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBzdG9wRmFpbHVyZU91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVTaW1wbGVPdXRwdXRCdWlsZGVyKFwiU3RvcEZhaWx1cmVcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBTdWJhZ2VudFN0YXJ0IGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBTdWJhZ2VudFN0YXJ0T3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBzdWJhZ2VudFN0YXJ0T3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgYWRkaXRpb25hbENvbnRleHQ6ICdGb2N1cyBvbiBmaW5kaW5nIHBhdHRlcm5zJ1xuICogICB9XG4gKiB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3Qgc3ViYWdlbnRTdGFydE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiU3ViYWdlbnRTdGFydFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFN1YmFnZW50U3RvcCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgU3ViYWdlbnRTdG9wT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBCbG9jayB3aXRoIHJlYXNvblxuICogc3ViYWdlbnRTdG9wT3V0cHV0KHtcbiAqICAgZGVjaXNpb246ICdibG9jaycsXG4gKiAgIHJlYXNvbjogJ1Rhc2sgbm90IGNvbXBsZXRlJ1xuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHN1YmFnZW50U3RvcE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVEZWNpc2lvbk91dHB1dEJ1aWxkZXIoXCJTdWJhZ2VudFN0b3BcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBOb3RpZmljYXRpb24gaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIE5vdGlmaWNhdGlvbk91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQWRkIGNvbnRleHQgYWJvdXQgdGhlIG5vdGlmaWNhdGlvblxuICogbm90aWZpY2F0aW9uT3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgYWRkaXRpb25hbENvbnRleHQ6ICdOb3RpZmljYXRpb24gZm9yd2FyZGVkIHRvIFNsYWNrICNhbGVydHMgY2hhbm5lbCdcbiAqICAgfVxuICogfSk7XG4gKlxuICogLy8gU3VwcHJlc3MgdGhlIG5vdGlmaWNhdGlvblxuICogbm90aWZpY2F0aW9uT3V0cHV0KHsgc3VwcHJlc3NPdXRwdXQ6IHRydWUgfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IG5vdGlmaWNhdGlvbk91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiTm90aWZpY2F0aW9uXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgUHJlQ29tcGFjdCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgUHJlQ29tcGFjdE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogcHJlQ29tcGFjdE91dHB1dCh7XG4gKiAgIHN5c3RlbU1lc3NhZ2U6ICdSZW1lbWJlcjogc3RyaWN0IG1vZGUgaXMgZW5hYmxlZCdcbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBwcmVDb21wYWN0T3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZVNpbXBsZU91dHB1dEJ1aWxkZXIoXCJQcmVDb21wYWN0XCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgUG9zdENvbXBhY3QgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFBvc3RDb21wYWN0T3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBwb3N0Q29tcGFjdE91dHB1dCh7fSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHBvc3RDb21wYWN0T3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZVNpbXBsZU91dHB1dEJ1aWxkZXIoXCJQb3N0Q29tcGFjdFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFBlcm1pc3Npb25SZXF1ZXN0IGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBQZXJtaXNzaW9uUmVxdWVzdE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQXV0by1hcHByb3ZlXG4gKiBwZXJtaXNzaW9uUmVxdWVzdE91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDoge1xuICogICAgIGRlY2lzaW9uOiB7IGJlaGF2aW9yOiAnYWxsb3cnIH1cbiAqICAgfVxuICogfSk7XG4gKlxuICogLy8gQXV0by1hcHByb3ZlIHdpdGggbW9kaWZpZWQgaW5wdXRcbiAqIHBlcm1pc3Npb25SZXF1ZXN0T3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgZGVjaXNpb246IHtcbiAqICAgICAgIGJlaGF2aW9yOiAnYWxsb3cnLFxuICogICAgICAgdXBkYXRlZElucHV0OiB7IGZpbGVfcGF0aDogJy9zYWZlL3BhdGgnIH1cbiAqICAgICB9XG4gKiAgIH1cbiAqIH0pO1xuICpcbiAqIC8vIEF1dG8tZGVueVxuICogcGVybWlzc2lvblJlcXVlc3RPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICBkZWNpc2lvbjoge1xuICogICAgICAgYmVoYXZpb3I6ICdkZW55JyxcbiAqICAgICAgIG1lc3NhZ2U6ICdOb3QgYWxsb3dlZCcsXG4gKiAgICAgICBpbnRlcnJ1cHQ6IHRydWVcbiAqICAgICB9XG4gKiAgIH1cbiAqIH0pO1xuICpcbiAqIC8vIEZhbGwgdGhyb3VnaCB0byBub3JtYWwgcHJvbXB0XG4gKiBwZXJtaXNzaW9uUmVxdWVzdE91dHB1dCh7fSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHBlcm1pc3Npb25SZXF1ZXN0T3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJQZXJtaXNzaW9uUmVxdWVzdFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFBlcm1pc3Npb25EZW5pZWQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFBlcm1pc3Npb25EZW5pZWRPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIExvZyBhbmQgYWxsb3cgcmV0cnlcbiAqIHBlcm1pc3Npb25EZW5pZWRPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHsgcmV0cnk6IHRydWUgfVxuICogfSk7XG4gKlxuICogLy8gTG9nIHdpdGhvdXQgcmV0cnlcbiAqIHBlcm1pc3Npb25EZW5pZWRPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBwZXJtaXNzaW9uRGVuaWVkT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJQZXJtaXNzaW9uRGVuaWVkXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgU2V0dXAgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFNldHVwT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBBZGQgY29udGV4dCBkdXJpbmcgc2V0dXBcbiAqIHNldHVwT3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgYWRkaXRpb25hbENvbnRleHQ6ICdQcm9qZWN0IGluaXRpYWxpemVkIHdpdGggY3VzdG9tIHNldHRpbmdzJ1xuICogICB9XG4gKiB9KTtcbiAqXG4gKiAvLyBTaW1wbGUgcGFzc3Rocm91Z2hcbiAqIHNldHVwT3V0cHV0KHt9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3Qgc2V0dXBPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIlNldHVwXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgVGVhbW1hdGVJZGxlIGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBUZWFtbWF0ZUlkbGVPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEFsbG93IHRlYW1tYXRlIHRvIGdvIGlkbGVcbiAqIHRlYW1tYXRlSWRsZU91dHB1dCh7fSk7XG4gKlxuICogLy8gQmxvY2sgd2l0aCBmZWVkYmFja1xuICogdGVhbW1hdGVJZGxlT3V0cHV0KHsgc3RkZXJyOiAnQ29udGludWUgd29ya2luZzogdW5maW5pc2hlZCB0YXNrcyByZW1haW4uJyB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgdGVhbW1hdGVJZGxlT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUV4aXRDb2RlT3V0cHV0QnVpbGRlcihcIlRlYW1tYXRlSWRsZVwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFRhc2tDcmVhdGVkIGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBUYXNrQ3JlYXRlZE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQWxsb3cgdGFzayBjcmVhdGlvblxuICogdGFza0NyZWF0ZWRPdXRwdXQoe30pO1xuICpcbiAqIC8vIEJsb2NrIHdpdGggZmVlZGJhY2tcbiAqIHRhc2tDcmVhdGVkT3V0cHV0KHsgc3RkZXJyOiAnQ2Fubm90IGNyZWF0ZSB0YXNrOiBtaXNzaW5nIHJlcXVpcmVkIGZpZWxkcy4nIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCB0YXNrQ3JlYXRlZE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVFeGl0Q29kZU91dHB1dEJ1aWxkZXIoXCJUYXNrQ3JlYXRlZFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFRhc2tDb21wbGV0ZWQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFRhc2tDb21wbGV0ZWRPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEFsbG93IHRhc2sgY29tcGxldGlvblxuICogdGFza0NvbXBsZXRlZE91dHB1dCh7fSk7XG4gKlxuICogLy8gQmxvY2sgd2l0aCBmZWVkYmFja1xuICogdGFza0NvbXBsZXRlZE91dHB1dCh7IHN0ZGVycjogJ0Nhbm5vdCBjb21wbGV0ZTogdGVzdHMgYXJlIGZhaWxpbmcuJyB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgdGFza0NvbXBsZXRlZE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVFeGl0Q29kZU91dHB1dEJ1aWxkZXIoXCJUYXNrQ29tcGxldGVkXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgRWxpY2l0YXRpb24gaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBbiBFbGljaXRhdGlvbk91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQWNjZXB0IHRoZSBlbGljaXRhdGlvblxuICogZWxpY2l0YXRpb25PdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHsgYWN0aW9uOiAnYWNjZXB0JywgY29udGVudDogeyB1c2VybmFtZTogJ2FsaWNlJyB9IH1cbiAqIH0pO1xuICpcbiAqIC8vIERlY2xpbmUgdGhlIGVsaWNpdGF0aW9uXG4gKiBlbGljaXRhdGlvbk91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDogeyBhY3Rpb246ICdkZWNsaW5lJyB9XG4gKiB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgZWxpY2l0YXRpb25PdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIkVsaWNpdGF0aW9uXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgRWxpY2l0YXRpb25SZXN1bHQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBbiBFbGljaXRhdGlvblJlc3VsdE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogZWxpY2l0YXRpb25SZXN1bHRPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBlbGljaXRhdGlvblJlc3VsdE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiRWxpY2l0YXRpb25SZXN1bHRcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBDb25maWdDaGFuZ2UgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIENvbmZpZ0NoYW5nZU91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogY29uZmlnQ2hhbmdlT3V0cHV0KHt9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgY29uZmlnQ2hhbmdlT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZVNpbXBsZU91dHB1dEJ1aWxkZXIoXCJDb25maWdDaGFuZ2VcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBJbnN0cnVjdGlvbnNMb2FkZWQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBbiBJbnN0cnVjdGlvbnNMb2FkZWRPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGluc3RydWN0aW9uc0xvYWRlZE91dHB1dCh7fSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IGluc3RydWN0aW9uc0xvYWRlZE91dHB1dCA9IFxuLyogQF9fUFVSRV9fICovIGNyZWF0ZVNpbXBsZU91dHB1dEJ1aWxkZXIoXCJJbnN0cnVjdGlvbnNMb2FkZWRcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBXb3JrdHJlZUNyZWF0ZSBob29rcy5cbiAqXG4gKiBUaGUgcnVudGltZSB3cml0ZXMgYHdvcmt0cmVlUGF0aGAgdG8gc3Rkb3V0IGFzIHBsYWluIHRleHQgKG5vdCBKU09OKSBzbyBDbGF1ZGUgQ29kZVxuICogY2FuIGBjaGRpcmAgaW50byB0aGUgY3JlYXRlZCB3b3JrdHJlZS5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgV29ya3RyZWVDcmVhdGVPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIHdvcmt0cmVlQ3JlYXRlT3V0cHV0KHsgd29ya3RyZWVQYXRoOiAnL2Ficy9wYXRoL3RvL3dvcmt0cmVlJyB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3Qgd29ya3RyZWVDcmVhdGVPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlV29ya3RyZWVPdXRwdXRCdWlsZGVyKFwiV29ya3RyZWVDcmVhdGVcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBXb3JrdHJlZVJlbW92ZSBob29rcy5cbiAqXG4gKiBXaGVuIGB3b3JrdHJlZVBhdGhgIGlzIHN1cHBsaWVkLCB0aGUgcnVudGltZSB3cml0ZXMgaXQgdG8gc3Rkb3V0IGFzIHBsYWluIHRleHQgKG5vdFxuICogSlNPTiksIG1hdGNoaW5nIHRoZSB3b3JrdHJlZSBjb21tYW5kLWhvb2sgcHJvdG9jb2wuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFdvcmt0cmVlUmVtb3ZlT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBQbGFpbi10ZXh0IHBhdGggcHJvdG9jb2xcbiAqIHdvcmt0cmVlUmVtb3ZlT3V0cHV0KHsgd29ya3RyZWVQYXRoOiAnL2Ficy9wYXRoL3RvL3dvcmt0cmVlJyB9KTtcbiAqXG4gKiAvLyBObyBwYXRoIHBheWxvYWRcbiAqIHdvcmt0cmVlUmVtb3ZlT3V0cHV0KHt9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3Qgd29ya3RyZWVSZW1vdmVPdXRwdXQgPSAob3B0aW9ucyA9IHt9KSA9PiB7XG4gICAgY29uc3QgeyB3b3JrdHJlZVBhdGgsIC4uLnJlc3QgfSA9IG9wdGlvbnM7XG4gICAgcmV0dXJuIHdvcmt0cmVlUGF0aCAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8geyBfdHlwZTogXCJXb3JrdHJlZVJlbW92ZVwiLCBzdGRvdXQ6IHJlc3QsIHJhd1N0ZG91dDogd29ya3RyZWVQYXRoIH1cbiAgICAgICAgOiB7IF90eXBlOiBcIldvcmt0cmVlUmVtb3ZlXCIsIHN0ZG91dDogcmVzdCB9O1xufTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIEN3ZENoYW5nZWQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIEN3ZENoYW5nZWRPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIFJldHVybiBhZGRpdGlvbmFsIHBhdGhzIHRvIHdhdGNoIGFmdGVyIHRoZSBjd2QgY2hhbmdlXG4gKiBjd2RDaGFuZ2VkT3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgd2F0Y2hQYXRoczogWycvbmV3L3BhdGgvdG8vd2F0Y2gnXVxuICogICB9XG4gKiB9KTtcbiAqXG4gKiAvLyBTaW1wbGUgcGFzc3Rocm91Z2hcbiAqIGN3ZENoYW5nZWRPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBjd2RDaGFuZ2VkT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJDd2RDaGFuZ2VkXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgRmlsZUNoYW5nZWQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIEZpbGVDaGFuZ2VkT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBVcGRhdGUgdGhlIHNldCBvZiB3YXRjaGVkIHBhdGhzXG4gKiBmaWxlQ2hhbmdlZE91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDoge1xuICogICAgIHdhdGNoUGF0aHM6IFsnL3BhdGgvdG8vd2F0Y2gnLCAnL2Fub3RoZXIvcGF0aCddXG4gKiAgIH1cbiAqIH0pO1xuICpcbiAqIC8vIFNpbXBsZSBwYXNzdGhyb3VnaFxuICogZmlsZUNoYW5nZWRPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBmaWxlQ2hhbmdlZE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiRmlsZUNoYW5nZWRcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBNZXNzYWdlRGlzcGxheSBob29rcy5cbiAqXG4gKiBNZXNzYWdlRGlzcGxheSBpcyBkaXNwbGF5LW9ubHk6IHRoZSBgZGlzcGxheUNvbnRlbnRgIGZpZWxkIHJlcGxhY2VzIHRoZSBkZWx0YSBvblxuICogc2NyZWVuIHdpdGhvdXQgY2hhbmdpbmcgdGhlIHN0b3JlZCBtZXNzYWdlIG9yIHdoYXQgdGhlIG1vZGVsIHNlZXMuIE9taXRcbiAqIGBkaXNwbGF5Q29udGVudGAgKG9yIHNldCBpdCB0byB0aGUgb3JpZ2luYWwgZGVsdGEpIHRvIGxlYXZlIHRoZSBkaXNwbGF5IHVuY2hhbmdlZC5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgTWVzc2FnZURpc3BsYXlPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIFJlcGxhY2UgdGhlIGRlbHRhIHNob3duIG9uIHNjcmVlblxuICogbWVzc2FnZURpc3BsYXlPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHsgZGlzcGxheUNvbnRlbnQ6IFwiW3JlZGFjdGVkXVwiIH1cbiAqIH0pO1xuICpcbiAqIC8vIFBhc3N0aHJvdWdoIChubyBkaXNwbGF5IG1vZGlmaWNhdGlvbilcbiAqIG1lc3NhZ2VEaXNwbGF5T3V0cHV0KHt9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgbWVzc2FnZURpc3BsYXlPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIk1lc3NhZ2VEaXNwbGF5XCIpO1xuIiwgIi8qKlxuICogUnVudGltZSBtb2R1bGUgZm9yIENsYXVkZSBDb2RlIGhvb2tzLlxuICpcbiAqIEhhbmRsZXMgc3RkaW4vc3Rkb3V0L2V4aXQgY29kZSBzZW1hbnRpY3MgZm9yIGNvbXBpbGVkIGhvb2sgZXhlY3V0aW9uLlxuICogVGhpcyBtb2R1bGUgaXMgdGhlIGNvcmUgb3JjaGVzdHJhdG9yIHRoYXQ6XG4gKiAtIFJlYWRzIEpTT04gZnJvbSBzdGRpbiAod2lyZSBmb3JtYXQgd2l0aCBzbmFrZV9jYXNlIHByb3BlcnRpZXMpXG4gKiAtIEludm9rZXMgdGhlIGhvb2sgaGFuZGxlclxuICogLSBXcml0ZXMgb3V0cHV0IHRvIHN0ZG91dFxuICogLSBNYW5hZ2VzIGV4aXQgY29kZXNcbiAqIEBtb2R1bGVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBJbiBhIGNvbXBpbGVkIGhvb2sgZmlsZVxuICogaW1wb3J0IHsgZXhlY3V0ZSB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcy9ydW50aW1lJztcbiAqIGltcG9ydCBteUhvb2sgZnJvbSAnLi9teS1ob29rLmpzJztcbiAqXG4gKiBleGVjdXRlKG15SG9vayk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rc1xuICovXG5pbXBvcnQgeyBwZXJzaXN0RW52VmFyLCBwZXJzaXN0RW52VmFycyB9IGZyb20gXCIuL2Vudi5qc1wiO1xuaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSBcIi4vbG9nZ2VyLmpzXCI7XG5pbXBvcnQgeyBFWElUX0NPREVTIH0gZnJvbSBcIi4vb3V0cHV0cy5qc1wiO1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU3RkaW4vU3Rkb3V0IEhhbmRsaW5nXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIFJlYWRzIGFsbCBkYXRhIGZyb20gc3RkaW4uXG4gKiBAcmV0dXJucyBQcm9taXNlIHJlc29sdmluZyB0byB0aGUgY29tcGxldGUgc3RkaW4gY29udGVudFxuICovXG5hc3luYyBmdW5jdGlvbiByZWFkU3RkaW4oKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgY2h1bmtzID0gW107XG4gICAgICAgIC8vIFNldCBlbmNvZGluZyBmaXJzdCB0byBlbnN1cmUgZGF0YSBldmVudHMgcmVjZWl2ZSBzdHJpbmdzXG4gICAgICAgIHByb2Nlc3Muc3RkaW4uc2V0RW5jb2RpbmcoXCJ1dGYtOFwiKTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImRhdGFcIiwgKGNodW5rKSA9PiB7XG4gICAgICAgICAgICBjaHVua3MucHVzaChjaHVuayk7XG4gICAgICAgIH0pO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZW5kXCIsICgpID0+IHtcbiAgICAgICAgICAgIHJlc29sdmUoY2h1bmtzLmpvaW4oXCJcIikpO1xuICAgICAgICB9KTtcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5vbihcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgICAgICAgcmVqZWN0KGVycm9yKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG59XG4vKipcbiAqIFBhcnNlcyBzdGRpbiBKU09OIGlucHV0LlxuICogQHBhcmFtIHN0ZGluQ29udGVudCAtIFJhdyBzdGRpbiBjb250ZW50XG4gKiBAcmV0dXJucyBQYXJzZWQgaW5wdXQgKHdpcmUgZm9ybWF0IHdpdGggc25ha2VfY2FzZSBwcm9wZXJ0aWVzKVxuICogQHRocm93cyBFcnJvciBpZiBKU09OIGlzIG1hbGZvcm1lZFxuICovXG5mdW5jdGlvbiBwYXJzZVN0ZGluSW5wdXQoc3RkaW5Db250ZW50KSB7XG4gICAgLy8gUGFyc2UgSlNPTiAtIGlucHV0IHVzZXMgd2lyZSBmb3JtYXQgKHNuYWtlX2Nhc2UpIGRpcmVjdGx5XG4gICAgY29uc3QgcmF3SW5wdXQgPSBKU09OLnBhcnNlKHN0ZGluQ29udGVudCk7XG4gICAgcmV0dXJuIHJhd0lucHV0O1xufVxuLyoqXG4gKiBXcml0ZXMgaG9vayBvdXRwdXQgdG8gc3Rkb3V0LlxuICpcbiAqIE91dHB1dCB1c2VzIGNhbWVsQ2FzZSBrZXlzIHBlciBDbGF1ZGUgQ29kZSBob29rIHNwZWNpZmljYXRpb24uXG4gKiBAcGFyYW0gb3V0cHV0IC0gVGhlIGhvb2sgb3V0cHV0IHRvIHdyaXRlXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjaG9vay1vdXRwdXQtc3RydWN0dXJlXG4gKi9cbmZ1bmN0aW9uIHdyaXRlU3Rkb3V0KG91dHB1dCkge1xuICAgIC8vIE91dHB1dCB1c2VzIGNhbWVsQ2FzZSAtIG5vIHRyYW5zZm9ybWF0aW9uIG5lZWRlZFxuICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKEpTT04uc3RyaW5naWZ5KG91dHB1dCkpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRXJyb3IgSGFuZGxpbmdcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhbiBlcnJvciBvdXRwdXQgZm9yIG1hbGZvcm1lZCBzdGRpbiBKU09OLlxuICogQHBhcmFtIGVycm9yIC0gVGhlIHBhcnNlIGVycm9yXG4gKiBAcmV0dXJucyBIb29rT3V0cHV0IHdpdGggZW1wdHkgc3Rkb3V0XG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZU1hbGZvcm1lZElucHV0T3V0cHV0KGVycm9yKSB7XG4gICAgbG9nZ2VyLmVycm9yKGBJbnZhbGlkIEpTT04gaW5wdXQ6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWApO1xuICAgIHJldHVybiB7IHN0ZG91dDoge30gfTtcbn1cbi8qKlxuICogV3JpdGVzIGhhbmRsZXIgZXJyb3Igc3RhY2t0cmFjZSB0byBzdGRlcnIgYW5kIGV4aXRzIHdpdGggY29kZSAyLlxuICpcbiAqIFdoZW4gYSBob29rIGhhbmRsZXIgdGhyb3dzIGFuIGV4Y2VwdGlvbjpcbiAqIC0gU3RhY2t0cmFjZSAod2l0aCBzb3VyY2VtYXBzIGlmIGF2YWlsYWJsZSkgaXMgb3V0cHV0IHRvIHN0ZGVyclxuICogLSBQcm9jZXNzIGV4aXRzIHdpdGggY29kZSAyIChCTE9DSylcbiAqIC0gTm8gSlNPTiBpcyBvdXRwdXQgdG8gc3Rkb3V0XG4gKiBAcGFyYW0gZXJyb3IgLSBUaGUgZXJyb3IgdGhyb3duIGJ5IHRoZSBoYW5kbGVyXG4gKi9cbmZ1bmN0aW9uIGhhbmRsZUhhbmRsZXJFcnJvcihlcnJvcikge1xuICAgIC8vIFdyaXRlIHN0YWNrIHRyYWNlIHRvIHN0ZGVyciAoc291cmNlbWFwcyBhcmUgYXBwbGllZCBhdXRvbWF0aWNhbGx5IGJ5IE5vZGUuanMpXG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYCR7ZXJyb3Iuc3RhY2sgPz8gZXJyb3IubWVzc2FnZX1cXG5gKTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGAke1N0cmluZyhlcnJvcil9XFxuYCk7XG4gICAgfVxuICAgIC8vIExvZyB0byBmaWxlIGlmIGNvbmZpZ3VyZWRcbiAgICBsb2dnZXIuZXJyb3IoYEhvb2sgaGFuZGxlciBlcnJvcjogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gICAgLy8gQ2xlYXIgbG9nZ2VyIGNvbnRleHQgYW5kIGNsb3NlXG4gICAgbG9nZ2VyLmNsZWFyQ29udGV4dCgpO1xuICAgIGxvZ2dlci5jbG9zZSgpO1xuICAgIC8vIEV4aXQgd2l0aCBjb2RlIDIgKEJMT0NLKSAtIG5vIEpTT04gb3V0cHV0XG4gICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuQkxPQ0spO1xufVxuLyoqXG4gKiBDb252ZXJ0cyBhIFNwZWNpZmljSG9va091dHB1dCB0byBIb29rT3V0cHV0IGZvciB3aXJlIGZvcm1hdC5cbiAqXG4gKiBTcGVjaWZpY0hvb2tPdXRwdXQgdHlwZXMgaGF2ZTogeyBfdHlwZSwgc3Rkb3V0LCBzdGRlcnI/IH1cbiAqIEhvb2tPdXRwdXQgaGFzOiB7IHN0ZG91dCwgc3RkZXJyPyB9XG4gKlxuICogU2luY2Ugb3V0cHV0IGJ1aWxkZXJzIG5vdyBwcm9kdWNlIHdpcmUtZm9ybWF0IGRpcmVjdGx5LCB0aGlzIGZ1bmN0aW9uXG4gKiBzaW1wbHkgc3RyaXBzIHRoZSBgX3R5cGVgIGRpc2NyaW1pbmF0b3IgZmllbGQuXG4gKiBAcGFyYW0gc3BlY2lmaWNPdXRwdXQgLSBUaGUgc3BlY2lmaWMgb3V0cHV0IGZyb20gYSBob29rIGhhbmRsZXJcbiAqIEByZXR1cm5zIEhvb2tPdXRwdXQgcmVhZHkgZm9yIHNlcmlhbGl6YXRpb25cbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNob29rLW91dHB1dC1zdHJ1Y3R1cmVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCBzcGVjaWZpY091dHB1dCA9IHByZVRvb2xVc2VPdXRwdXQoeyBob29rU3BlY2lmaWNPdXRwdXQ6IHsgcGVybWlzc2lvbkRlY2lzaW9uOiAnYWxsb3cnIH0gfSk7XG4gKiBjb25zdCBob29rT3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChzcGVjaWZpY091dHB1dCk7XG4gKiAvLyBob29rT3V0cHV0OiB7IHN0ZG91dDogeyBob29rU3BlY2lmaWNPdXRwdXQ6IHsgLi4uIH0gfSB9XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbnZlcnRUb0hvb2tPdXRwdXQoc3BlY2lmaWNPdXRwdXQpIHtcbiAgICBjb25zdCB7IHN0ZG91dCwgc3RkZXJyLCByYXdTdGRvdXQgfSA9IHNwZWNpZmljT3V0cHV0O1xuICAgIGNvbnN0IHJlc3VsdCA9IHsgc3Rkb3V0IH07XG4gICAgaWYgKHN0ZGVyciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJlc3VsdC5zdGRlcnIgPSBzdGRlcnI7XG4gICAgfVxuICAgIGlmIChyYXdTdGRvdXQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXN1bHQucmF3U3Rkb3V0ID0gcmF3U3Rkb3V0O1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRXhlY3V0ZSBGdW5jdGlvblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBFeGVjdXRlcyBhIGhvb2sgaGFuZGxlciB3aXRoIGZ1bGwgcnVudGltZSBvcmNoZXN0cmF0aW9uLlxuICpcbiAqIFRoaXMgaXMgdGhlIG1haW4gZW50cnkgcG9pbnQgdGhhdCBjb21waWxlZCBob29rcyB1c2UuIFdoZW4gYSBjb21waWxlZCBob29rXG4gKiBydW5zIGFzIGEgQ0xJOlxuICpcbiAqIDEuIFJlYWRzIGFsbCBzdGRpblxuICogMi4gUGFyc2VzIEpTT04gKHdpcmUgZm9ybWF0IHdpdGggc25ha2VfY2FzZSBwcm9wZXJ0aWVzKVxuICogMy4gU2V0cyB1cCBsb2dnZXIgY29udGV4dCAoaG9va1R5cGUsIGlucHV0KVxuICogNC4gQ2FsbHMgaGFuZGxlciB3aXRoIGlucHV0IGFuZCBjb250ZXh0IChsb2dnZXIpXG4gKiA1LiBIYW5kbGVzIGFueSBlcnJvcnMsIGxvZ3MgdGhlbVxuICogNi4gV3JpdGVzIEpTT04gdG8gc3Rkb3V0XG4gKiA3LiBDbG9zZXMgbG9nZ2VyXG4gKiA4LiBFeGl0cyB3aXRoIGFwcHJvcHJpYXRlIGNvZGVcbiAqIEBwYXJhbSBob29rRm4gLSBUaGUgaG9vayBmdW5jdGlvbiB0byBleGVjdXRlIChmcm9tIGhvb2sgZmFjdG9yeSlcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBJbiBjb21waWxlZCBob29rIGZpbGVcbiAqIGltcG9ydCB7IGV4ZWN1dGUgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MvcnVudGltZSc7XG4gKiBpbXBvcnQgeyBwcmVUb29sVXNlSG9vaywgcHJlVG9vbFVzZU91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogY29uc3QgbXlIb29rID0gcHJlVG9vbFVzZUhvb2soeyBtYXRjaGVyOiAnQmFzaCcgfSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdQcm9jZXNzaW5nIEJhc2ggY29tbWFuZCcpO1xuICogICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7IGFsbG93OiB0cnVlIH0pO1xuICogfSk7XG4gKlxuICogZXhlY3V0ZShteUhvb2spO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3NcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGV4ZWN1dGUoaG9va0ZuKSB7XG4gICAgbGV0IG91dHB1dDtcbiAgICB0cnkge1xuICAgICAgICAvLyBSZWFkIGFuZCBwYXJzZSBzdGRpblxuICAgICAgICBsZXQgc3RkaW5Db250ZW50O1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgc3RkaW5Db250ZW50ID0gYXdhaXQgcmVhZFN0ZGluKCk7XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBsb2dnZXIubG9nRXJyb3IoZXJyb3IsIFwiRmFpbGVkIHRvIHJlYWQgc3RkaW5cIik7XG4gICAgICAgICAgICBvdXRwdXQgPSBjcmVhdGVNYWxmb3JtZWRJbnB1dE91dHB1dChlcnJvcik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgLy8gUGFyc2UgYW5kIHRyYW5zZm9ybSBpbnB1dFxuICAgICAgICBsZXQgaW5wdXQ7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBpbnB1dCA9IHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgbG9nZ2VyLmxvZ0Vycm9yKGVycm9yLCBcIkZhaWxlZCB0byBwYXJzZSBzdGRpbiBKU09OXCIpO1xuICAgICAgICAgICAgb3V0cHV0ID0gY3JlYXRlTWFsZm9ybWVkSW5wdXRPdXRwdXQoZXJyb3IpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIC8vIFNldCBsb2dnZXIgY29udGV4dFxuICAgICAgICBjb25zdCBob29rRXZlbnROYW1lID0gaG9va0ZuLmhvb2tFdmVudE5hbWU7XG4gICAgICAgIGxvZ2dlci5zZXRDb250ZXh0KGhvb2tFdmVudE5hbWUsIGlucHV0KTtcbiAgICAgICAgLy8gQnVpbGQgY29udGV4dCAtIFNlc3Npb25TdGFydCBob29rcyBnZXQgZXh0ZW5kZWQgY29udGV4dCB3aXRoIHBlcnNpc3RFbnZWYXJcbiAgICAgICAgY29uc3QgY29udGV4dCA9IGhvb2tFdmVudE5hbWUgPT09IFwiU2Vzc2lvblN0YXJ0XCIgPyB7IGxvZ2dlciwgcGVyc2lzdEVudlZhciwgcGVyc2lzdEVudlZhcnMgfSA6IHsgbG9nZ2VyIH07XG4gICAgICAgIC8vIEV4ZWN1dGUgaGFuZGxlclxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3Qgc3BlY2lmaWNPdXRwdXQgPSBhd2FpdCBob29rRm4oaW5wdXQsIGNvbnRleHQpO1xuICAgICAgICAgICAgaWYgKHNwZWNpZmljT3V0cHV0ICE9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgb3V0cHV0ID0gY29udmVydFRvSG9va091dHB1dChzcGVjaWZpY091dHB1dCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAvLyBIYW5kbGVyIHRocmV3IC0gb3V0cHV0IHN0YWNrdHJhY2UgdG8gc3RkZXJyIGFuZCBleGl0IHdpdGggY29kZSAyXG4gICAgICAgICAgICAvLyBUaGlzIGNhbGwgbmV2ZXIgcmV0dXJucyAocHJvY2Vzcy5leGl0KVxuICAgICAgICAgICAgaGFuZGxlSGFuZGxlckVycm9yKGVycm9yKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBmaW5hbGx5IHtcbiAgICAgICAgLy8gV3JpdGUgb3V0cHV0IGlmIHdlIGhhdmUgaXQuIENvbW1hbmQgaG9va3Mgd2l0aCBhIHBsYWluLXRleHQgcHJvdG9jb2wgKGUuZy5cbiAgICAgICAgLy8gV29ya3RyZWVDcmVhdGUsIHdoZXJlIENsYXVkZSBDb2RlIHJlYWRzIHN0ZG91dCBhcyB0aGUgd29ya3RyZWUgcGF0aCBhbmQgY2hkaXJzXG4gICAgICAgIC8vIGludG8gaXQpIGNhcnJ5IHRoZWlyIHBheWxvYWQgaW4gYHJhd1N0ZG91dGAgYW5kIGJ5cGFzcyBKU09OIHNlcmlhbGl6YXRpb24uXG4gICAgICAgIGlmIChvdXRwdXQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgaWYgKG91dHB1dC5yYXdTdGRvdXQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKG91dHB1dC5yYXdTdGRvdXQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgd3JpdGVTdGRvdXQob3V0cHV0LnN0ZG91dCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgLy8gQ2xlYW4gdXAgbG9nZ2VyIChzaW5nbGUgY2xlYW51cCBwYXRoKVxuICAgICAgICBsb2dnZXIuY2xlYXJDb250ZXh0KCk7XG4gICAgICAgIGxvZ2dlci5jbG9zZSgpO1xuICAgICAgICAvLyBFeGl0LWNvZGUgQkxPQ0s6IHVubGlrZSBoYW5kbGVyIHRocm93IChubyBzdGRvdXQpLCB0aGlzIHBhdGggc3RpbGwgd3JpdGVzXG4gICAgICAgIC8vIHN0cnVjdHVyZWQgSlNPTiB0byBzdGRvdXQgKGFzIGVtcHR5IHt9KSBhbG9uZ3NpZGUgdGhlIHN0ZGVyciBtZXNzYWdlLlxuICAgICAgICAvLyBUaGUgY2FsbGVyIGNvbnRyb2xzIHN0ZGVyciBmb3JtYXR0aW5nIChubyBhcHBlbmRlZCBuZXdsaW5lKS5cbiAgICAgICAgaWYgKG91dHB1dD8uc3RkZXJyICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKG91dHB1dC5zdGRlcnIpO1xuICAgICAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuQkxPQ0spO1xuICAgICAgICB9XG4gICAgICAgIC8vIEV4aXQgd2l0aCBzdWNjZXNzIChoYW5kbGVyIGVycm9ycyBleGl0IHZpYSBoYW5kbGVIYW5kbGVyRXJyb3Igd2l0aCBjb2RlIDIpXG4gICAgICAgIHByb2Nlc3MuZXhpdChFWElUX0NPREVTLlNVQ0NFU1MpO1xuICAgIH1cbn1cbiIsICIvKipcbiAqIFNoYXJlZCBoZWxwZXJzIHVzZWQgYnkgbXVsdGlwbGUgYWdlbnQtaG9va3MgZW50cnkgcG9pbnRzLlxuICpcbiAqIEV4dHJhY3RlZCBmcm9tIHByZS10b29sLXVzZS50cyBzbyB0aGF0IHRoZSB1cGNvbWluZyBTdG9wIGhvb2sgKGFuZCBhbnlcbiAqIGZ1dHVyZSBob29rcykgY2FuIGltcG9ydCBwYXRoIHV0aWxpdGllcywgcmFuZ2UgaGVscGVycywgYW5kIHRoZVxuICogc2FuaXRpemVTZXNzaW9uSWQvZm9ybWF0QW5jaG9yIGZ1bmN0aW9ucyB3aXRob3V0IGRlcGVuZGluZyBvbiB0aGVcbiAqIFByZVRvb2xVc2Utc3BlY2lmaWMgbW9kdWxlLlxuICovXG5cbmltcG9ydCB7IGV4ZWNGaWxlU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG9zIGZyb20gJ25vZGU6b3MnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQYXRoIGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgZnVuY3Rpb24gdG9Qb3NpeChwOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG59XG5cbmZ1bmN0aW9uIGlzQWJzb2x1dGVQb3NpeChwOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIHAuc3RhcnRzV2l0aCgnLycpIHx8IC9eW0EtWmEtel06XFwvLy50ZXN0KHApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYWJzcGF0aEFnYWluc3QoYmFzZTogc3RyaW5nLCB0YXJnZXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHQgPSB0b1Bvc2l4KHRhcmdldCk7XG4gIGlmIChpc0Fic29sdXRlUG9zaXgodCkpIHJldHVybiB0O1xuICBjb25zdCBiID0gdG9Qb3NpeChiYXNlKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgcmV0dXJuIGAke2J9LyR7dH1gO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVJlcG9Sb290KGRpcjogc3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbCk6IHN0cmluZyB8IG51bGwge1xuICBpZiAoIWRpcikgcmV0dXJuIG51bGw7XG4gIHRyeSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgZGlyLCAncmV2LXBhcnNlJywgJy0tc2hvdy10b3BsZXZlbCddLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIGVuY29kaW5nOiAndXRmOCdcbiAgICB9KTtcbiAgICBjb25zdCB0cmltbWVkID0gb3V0LnRyaW0oKTtcbiAgICByZXR1cm4gdHJpbW1lZC5sZW5ndGggPiAwID8gdG9Qb3NpeCh0cmltbWVkKSA6IG51bGw7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbi8qKlxuICogUmVwb3J0IHdoZXRoZXIgYSByZXBvLXJlbGF0aXZlIHBhdGggaXMgZXhjbHVkZWQgYnkgZ2l0J3MgaWdub3JlIHJ1bGVzXG4gKiAoLmdpdGlnbm9yZSwgLmdpdC9pbmZvL2V4Y2x1ZGUsIGNvcmUuZXhjbHVkZXNGaWxlKS4gVXNlZCB0byBrZWVwIGlnbm9yZWRcbiAqIGZpbGVzIFx1MjAxNCBidWlsZCBvdXRwdXQsIGNhY2hlcywgbG9ncyBcdTIwMTQgb3V0IG9mIHRvdWNoIHRyYWNraW5nIGVudGlyZWx5LCBzb1xuICogdGhlIHRvdWNoIGhvb2sgbmV2ZXIgcmVwb3J0cyByZWFkcywgd3JpdGVzLCBvciB1bmNvdmVyZWQgd3JpdGVzIG9uIHRoZW0uXG4gKlxuICogYGdpdCBjaGVjay1pZ25vcmUgLXEgPHBhdGg+YCBleGl0cyAwIHdoZW4gdGhlIHBhdGggaXMgaWdub3JlZCwgMSB3aGVuIGl0IGlzXG4gKiBub3QsIGFuZCAxMjggb24gZXJyb3IuIGV4ZWNGaWxlU3luYyB0aHJvd3Mgb24gYW55IG5vbi16ZXJvIGV4aXQsIHNvIGEgY2xlYW5cbiAqIHJldHVybiBtZWFucyBcImlnbm9yZWRcIi4gQSBzdGF0dXMtMSB0aHJvdyBpcyB0aGUgZXhwZWN0ZWQgXCJub3QgaWdub3JlZFwiXG4gKiBzaWduYWw7IGFueSBvdGhlciBmYWlsdXJlIGlzIGFuIHVucmVsaWFibGUgYW5zd2VyLCBzbyB3ZSByZXBvcnQgYGZhbHNlYFxuICogKGRvIG5vdCBkcm9wIHRoZSB0b3VjaCkgcmF0aGVyIHRoYW4gc2lsZW50bHkgaGlkaW5nIGEgdHJhY2tlZCBmaWxlLlxuICovXG4vKipcbiAqIFRoZSBkZWZhdWx0IHNwYW4gcm9vdCBkaXJlY3RvcnksIHJlbGF0aXZlIHRvIHRoZSByZXBvIHJvb3QsIHVzZWQgd2hlbiBub1xuICogZW52aXJvbm1lbnQgdmFyaWFibGUgb3IgZ2l0IGNvbmZpZyBvdmVycmlkZXMgdGhlIGxvY2F0aW9uLlxuICovXG5leHBvcnQgY29uc3QgU1BBTl9ST09UID0gJy5zcGFuJztcblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBzcGFuIHJvb3QgZGlyZWN0b3J5IGZvciBhIGdpdmVuIHJlcG8sIG1pcnJvcmluZyB0aGUgUnVzdCBDTElcbiAqIHByZWNlZGVuY2UgKG1pbnVzIHRoZSAtLXNwYW4tZGlyIENMSSBmbGFnLCB3aGljaCBpcyBpbnZpc2libGUgdG8gZmlsZS13cml0ZVxuICogaG9va3MpOlxuICogICAxLiBHSVRfU1BBTl9ESVIgZW52aXJvbm1lbnQgdmFyaWFibGVcbiAqICAgMi4gYGdpdCBjb25maWcgZ2l0LXNwYW4uZGlyYCBpbiB0aGUgcmVwb1xuICogICAzLiBEZWZhdWx0OiBcIi5zcGFuXCJcbiAqXG4gKiBUaGUgcmV0dXJuZWQgdmFsdWUgaXMgYSBQT1NJWC1zdHlsZSBwYXRoIHdpdGggbm8gdHJhaWxpbmcgc2xhc2guXG4gKiBGYWlsLXNhZmU6IGFueSByZXNvbHV0aW9uIGVycm9yIGZhbGxzIGJhY2sgdG8gXCIuc3BhblwiIHNvIHRoZSBob29rIG5ldmVyXG4gKiBjcmFzaGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBlbnZEaXIgPSBwcm9jZXNzLmVudlsnR0lUX1NQQU5fRElSJ107XG4gIGlmIChlbnZEaXIgJiYgZW52RGlyLnRyaW0oKS5sZW5ndGggPiAwKSB7XG4gICAgcmV0dXJuIHRvUG9zaXgoZW52RGlyLnRyaW0oKSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIH1cbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ2NvbmZpZycsICdnaXQtc3Bhbi5kaXInXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnXG4gICAgfSk7XG4gICAgY29uc3QgdHJpbW1lZCA9IHRvUG9zaXgob3V0LnRyaW0oKSkucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gICAgaWYgKHRyaW1tZWQubGVuZ3RoID4gMCkgcmV0dXJuIHRyaW1tZWQ7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHZvaWQgZXJyOyAvLyBjb25maWcga2V5IGFic2VudCBvciBnaXQgZXJyb3IgXHUyMDE0IGZhbGwgdGhyb3VnaCB0byBkZWZhdWx0XG4gIH1cbiAgcmV0dXJuIFNQQU5fUk9PVDtcbn1cblxuLyoqXG4gKiBSZXBvcnQgd2hldGhlciBhIHJlcG8tcmVsYXRpdmUgUE9TSVggcGF0aCBmYWxscyBpbnNpZGUgdGhlIGdpdmVuIHNwYW4gcm9vdFxuICogZGlyZWN0b3J5LiBBIHBhdGggaXMgaW5zaWRlIHdoZW4gaXQgZXF1YWxzIHRoZSBzcGFuIHJvb3QgZXhhY3RseSBvciBpc1xuICogbmVzdGVkIGJlbmVhdGggaXQgKGkuZS4gc3RhcnRzIHdpdGggXCI8c3BhblJvb3Q+L1wiKS4gVGhlIFwiL1wiIGJvdW5kYXJ5IHByZXZlbnRzXG4gKiBmYWxzZSBwb3NpdGl2ZXMgZm9yIHNpYmxpbmdzIGxpa2UgXCIuc3BhbnMveFwiIG9yIFwiLnNwYW4tbm90ZXMveFwiLlxuICpcbiAqIFBhc3MgdGhlIHJlc3VsdCBvZiBgcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290KWAgYXMgYHNwYW5Sb290YC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzSW5zaWRlU3BhblJvb3QocmVwb1JlbFBhdGg6IHN0cmluZywgc3BhblJvb3Q6IHN0cmluZyA9IFNQQU5fUk9PVCk6IGJvb2xlYW4ge1xuICBjb25zdCByb290ID0gc3BhblJvb3QucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gIHJldHVybiByZXBvUmVsUGF0aCA9PT0gcm9vdCB8fCByZXBvUmVsUGF0aC5zdGFydHNXaXRoKGAke3Jvb3R9L2ApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNHaXRJZ25vcmVkKHJlcG9Sb290OiBzdHJpbmcsIHJlcG9SZWxQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ2NoZWNrLWlnbm9yZScsICctcScsICctLScsIHJlcG9SZWxQYXRoXSwge1xuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ2lnbm9yZScsICdpZ25vcmUnXVxuICAgIH0pO1xuICAgIHJldHVybiB0cnVlO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICB2b2lkIGVycjtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290OiBzdHJpbmcsIGFic1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHJvb3QgPSB0b1Bvc2l4KHJlcG9Sb290KTtcbiAgY29uc3QgYWJzID0gdG9Qb3NpeChhYnNQYXRoKTtcbiAgY29uc3QgcHJlZml4ID0gcm9vdC5lbmRzV2l0aCgnLycpID8gcm9vdCA6IGAke3Jvb3R9L2A7XG4gIHJldHVybiBhYnMuc3RhcnRzV2l0aChwcmVmaXgpID8gYWJzLnNsaWNlKHByZWZpeC5sZW5ndGgpIDogYWJzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY2Fub25pY2FsaXplUGF0aChhYnNQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICB0cnkge1xuICAgIHJldHVybiB0b1Bvc2l4KGZzLnJlYWxwYXRoU3luYy5uYXRpdmUoYWJzUGF0aCkpO1xuICB9IGNhdGNoIHtcbiAgICAvLyBGaWxlIGRvZXNuJ3QgZXhpc3QgeWV0IChlLmcuIFdyaXRlIHRvIGEgbmV3IGZpbGUpOiBjYW5vbmljYWxpemUgdGhlXG4gICAgLy8gZGlyZWN0b3J5IGFuZCByZWpvaW4gdGhlIGJhc2VuYW1lIHNvIHN5bWxpbmtzIGluIHRoZSBwYXJlbnQgYXJlIHJlc29sdmVkLlxuICAgIHRyeSB7XG4gICAgICBjb25zdCBkaXIgPSB0b1Bvc2l4KGZzLnJlYWxwYXRoU3luYy5uYXRpdmUobm9kZVBhdGguZGlybmFtZShhYnNQYXRoKSkpO1xuICAgICAgcmV0dXJuIGAke2Rpcn0vJHtub2RlUGF0aC5iYXNlbmFtZShhYnNQYXRoKX1gO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gUGFyZW50IGRvZXNuJ3QgZXhpc3QgZWl0aGVyOyBmYWxsIGJhY2sgdG8gdGhlIHVuLWNhbm9uaWNhbGl6ZWQgcGF0aC5cbiAgICAgIHJldHVybiBhYnNQYXRoO1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZGVyaXZlUGF0aCh0b29sSW5wdXQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBjd2Q6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCBmcCA9IHRvb2xJbnB1dC5maWxlX3BhdGg7XG4gIGlmICh0eXBlb2YgZnAgIT09ICdzdHJpbmcnIHx8IGZwLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGFicyA9IGFic3BhdGhBZ2FpbnN0KGN3ZCwgZnApO1xuICByZXR1cm4gY2Fub25pY2FsaXplUGF0aChhYnMpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIExpbmUgcmFuZ2UgdHlwZXMgYW5kIGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIExpbmVSYW5nZSB7XG4gIHN0YXJ0OiBudW1iZXI7XG4gIGVuZDogbnVtYmVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmFuZ2VzSW50ZXJzZWN0KGE6IExpbmVSYW5nZSwgYjogTGluZVJhbmdlKTogYm9vbGVhbiB7XG4gIHJldHVybiBhLnN0YXJ0IDw9IGIuZW5kICYmIGEuZW5kID49IGIuc3RhcnQ7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUG9yY2VsYWluIHJvdyBwYXJzaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBQb3JjZWxhaW5Sb3cge1xuICBuYW1lOiBzdHJpbmc7XG4gIHBhdGg6IHN0cmluZztcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVBvcmNlbGFpbihzdGRvdXQ6IHN0cmluZyk6IFBvcmNlbGFpblJvd1tdIHtcbiAgY29uc3Qgcm93czogUG9yY2VsYWluUm93W10gPSBbXTtcbiAgZm9yIChjb25zdCBsaW5lIG9mIHN0ZG91dC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkKSBjb250aW51ZTtcbiAgICBjb25zdCBwYXJ0cyA9IHRyaW1tZWQuc3BsaXQoJ1xcdCcpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPCAzKSBjb250aW51ZTtcbiAgICBjb25zdCBbbmFtZSwgcGF0aCwgcmFuZ2VdID0gcGFydHM7XG4gICAgY29uc3QgZGFzaElkeCA9IHJhbmdlLmluZGV4T2YoJy0nKTtcbiAgICBpZiAoZGFzaElkeCA9PT0gLTEpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHN0YXJ0ID0gcGFyc2VJbnQocmFuZ2Uuc2xpY2UoMCwgZGFzaElkeCksIDEwKTtcbiAgICBjb25zdCBlbmQgPSBwYXJzZUludChyYW5nZS5zbGljZShkYXNoSWR4ICsgMSksIDEwKTtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHN0YXJ0KSB8fCBOdW1iZXIuaXNOYU4oZW5kKSkgY29udGludWU7XG4gICAgcm93cy5wdXNoKHsgbmFtZSwgcGF0aCwgc3RhcnQsIGVuZCB9KTtcbiAgfVxuICByZXR1cm4gcm93cztcbn1cblxuLyoqXG4gKiBUaGUgZnVsbCBgZ2l0IHNwYW4gZHJpZnQgLS1mb3JtYXQgcG9yY2VsYWluYCBzdGF0dXMgdG9rZW4gdm9jYWJ1bGFyeSAodGhlXG4gKiBnaXQtc3BhbiBDTEkncyBwb3JjZWxhaW4gY29udHJhY3QpOiBgRlJFU0hgL2BNT1ZFRGAvYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYFxuICogYXJlIHBvc2l0aW9uYWwtb3ItY2xlYW4gYW5kIG5ldmVyIGRlYnQ7IGV2ZXJ5IG90aGVyIHRva2VuIGlzIHNlbWFudGljIGRyaWZ0XG4gKiBvciBhIHRlcm1pbmFsL2Vycm9yIGNvbmRpdGlvbiBhbmQgaXMgZGVidC4gU2VlIHtAbGluayBpc0RlYnR9IGZvciB0aGVcbiAqIHNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGggb24gdGhhdCBzcGxpdC5cbiAqL1xuZXhwb3J0IGNvbnN0IFBPUkNFTEFJTl9TVEFUVVNFUyA9IFtcbiAgJ0ZSRVNIJyxcbiAgJ1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUJyxcbiAgJ01PVkVEJyxcbiAgJ0NIQU5HRUQnLFxuICAnREVMRVRFRCcsXG4gICdDT05GTElDVCcsXG4gICdTVUJNT0RVTEUnLFxuICAnTEZTX05PVF9GRVRDSEVEJyxcbiAgJ0xGU19OT1RfSU5TVEFMTEVEJyxcbiAgJ1BST01JU09SX01JU1NJTkcnLFxuICAnU1BBUlNFX0VYQ0xVREVEJyxcbiAgJ0ZJTFRFUl9GQUlMRUQnLFxuICAnSU9fRVJST1InXG5dIGFzIGNvbnN0O1xuXG5leHBvcnQgdHlwZSBQb3JjZWxhaW5TdGF0dXMgPSAodHlwZW9mIFBPUkNFTEFJTl9TVEFUVVNFUylbbnVtYmVyXTtcblxuY29uc3QgUE9SQ0VMQUlOX1NUQVRVU19TRVQ6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFBPUkNFTEFJTl9TVEFUVVNFUyk7XG5cbmZ1bmN0aW9uIHBhcnNlUG9yY2VsYWluU3RhdHVzKHJhdzogc3RyaW5nKTogUG9yY2VsYWluU3RhdHVzIHwgbnVsbCB7XG4gIHJldHVybiBQT1JDRUxBSU5fU1RBVFVTX1NFVC5oYXMocmF3KSA/IChyYXcgYXMgUG9yY2VsYWluU3RhdHVzKSA6IG51bGw7XG59XG5cbi8qKiBBIGBwYXJzZURyaWZ0UG9yY2VsYWluYCByb3c6IGEge0BsaW5rIFBvcmNlbGFpblJvd30gcGx1cyBpdHMgc3RhdHVzIHRva2VuLiAqL1xuZXhwb3J0IGludGVyZmFjZSBEcmlmdFBvcmNlbGFpblJvdyBleHRlbmRzIFBvcmNlbGFpblJvdyB7XG4gIHN0YXR1czogUG9yY2VsYWluU3RhdHVzO1xufVxuXG4vKipcbiAqIFRoZSBkZWJ0IGludmFyaWFudCAoc3lzdGVtLXdpZGU7IGNvbnN1bWVkIGJ5IGJvdGggdGhlIGZ1dHVyZSB0b3VjaC1jb3JlIGFuZFxuICogYWR2aXNvci1jb3JlKTogb25seSBzZW1hbnRpYyBzdGF0dXNlcyBhcmUgZGVidC4gYENIQU5HRURgIGFuZCBgREVMRVRFRGAgYXJlXG4gKiBzZW1hbnRpYyBkcmlmdDsgdGhlIHJlbWFpbmluZyBub24tRlJFU0gvTU9WRUQvUkVTT0xWRURfUEVORElOR19DT01NSVQgdG9rZW5zXG4gKiBhcmUgdGVybWluYWwvZXJyb3IgY29uZGl0aW9ucyBhbmQgYXJlIHRyZWF0ZWQgYXMgZGVidCB0b28gKHRoZXkgYmxvY2sgb25cbiAqIHRoZWlyIG93biBtZXJpdHMgXHUyMDE0IHRoZSBDTEkgY291bGQgbm90IHJlc29sdmUgdGhlIGFuY2hvciBhdCBhbGwpLiBgRlJFU0hgLFxuICogYE1PVkVEYCwgYW5kIGBSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGAgYXJlIG5ldmVyIGRlYnQ6IHBvc2l0aW9uYWwgZHJpZnQgdGhlXG4gKiBDTEkgY2FuIGhlYWwgKG9yIGFscmVhZHkgaGFzKSBpcyBpbnZpc2libGUsIGFuZCBhIHBlbmRpbmctY29tbWl0IHJlc29sdXRpb25cbiAqIGlzIG5vdCBvdXRzdGFuZGluZyBkZWJ0LlxuICpcbiAqIE5vdGU6IHRoZSBwb3JjZWxhaW4gdm9jYWJ1bGFyeSBkb2VzIG5vdCBjdXJyZW50bHkgZGlzdGluZ3Vpc2hcbiAqIGNvbnRlbnQtZXF1aXZhbGVudCBgQ0hBTkdFRGAgKGUuZy4gd2hpdGVzcGFjZS1vbmx5IGRyaWZ0IGAtLWZpeGAgY2FuIGhlYWwpXG4gKiBmcm9tIGdlbnVpbmVseSBzZW1hbnRpYyBgQ0hBTkdFRGAgXHUyMDE0IHRoYXQgY2xhc3NpZmljYXRpb24gaXMgbm90IHByZXNlbnQgaW5cbiAqIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW5gIG91dHB1dCB0b2RheS4gVW50aWwgdGhlIENMSSBleHBvc2VzIGl0LFxuICogZXZlcnkgYENIQU5HRURgIHJvdyBpcyB0cmVhdGVkIGFzIGRlYnQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0RlYnQoc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBib29sZWFuIHtcbiAgc3dpdGNoIChzdGF0dXMpIHtcbiAgICBjYXNlICdGUkVTSCc6XG4gICAgY2FzZSAnTU9WRUQnOlxuICAgIGNhc2UgJ1JFU09MVkVEX1BFTkRJTkdfQ09NTUlUJzpcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIHRydWU7XG4gIH1cbn1cblxuLyoqXG4gKiBMb3dlcmNhc2UgaHVtYW4gbGFiZWwgZm9yIGEgcG9yY2VsYWluIHN0YXR1cyB0b2tlbiAoYExGU19OT1RfRkVUQ0hFRGAgXHUyMTkyXG4gKiBgbGZzIG5vdCBmZXRjaGVkYCkuIFRoZSBzaW5nbGUgbGFiZWwgbWFwcGluZyBmb3IgZXZlcnkgaHVtYW4tZm9ybWF0IGFuY2hvclxuICogc3VmZml4IFx1MjAxNCBib3RoIHRoZSB0b3VjaCBob29rJ3MgYmxvY2sgYW5kIHRoZSBhZHZpc29yJ3MgbWVzc2FnZXMgcmVuZGVyIHRocm91Z2hcbiAqIHRoaXMsIHNvIGEgc3RhdHVzIG5ldmVyIHJlYWRzIGRpZmZlcmVudGx5IGJldHdlZW4gdGhlIHR3by5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGh1bWFuU3RhdHVzTGFiZWwoc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBzdHJpbmcge1xuICByZXR1cm4gc3RhdHVzLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvXy9nLCAnICcpO1xufVxuXG4vKipcbiAqIFRoZSB0ZXJtaW5hbC9lbnZpcm9ubWVudGFsIHN0YXR1c2VzOiB0aGUgQ0xJIGNvdWxkIG5vdCByZXNvbHZlIHRoZSBhbmNob3IgYXRcbiAqIGFsbCwgc28gdGhlIHJvdyBpcyBub3Qgc3BhbiBkcmlmdCBhIHVzZXIgY2FuIGZpeCBieSBlZGl0aW5nIGEgc3Bhbi4gVGhlc2UgYXJlXG4gKiBgQ09ORkxJQ1RgICh1bnJlc29sdmVkIG1lcmdlKSwgYFNVQk1PRFVMRWAgKGFuY2hvciBpbnNpZGUgYSBzdWJtb2R1bGUpLFxuICogYExGU19OT1RfRkVUQ0hFRGAvYExGU19OT1RfSU5TVEFMTEVEYCAoR2l0IExGUyBjb250ZW50IHVuYXZhaWxhYmxlKSxcbiAqIGBQUk9NSVNPUl9NSVNTSU5HYCAocGFydGlhbC1jbG9uZSBvYmplY3Qgbm90IGZldGNoZWQpLCBgU1BBUlNFX0VYQ0xVREVEYFxuICogKHBhdGggb3V0c2lkZSB0aGUgc3BhcnNlLWNoZWNrb3V0IGNvbmUpLCBgRklMVEVSX0ZBSUxFRGAgKGEgY2xlYW4vc211ZGdlXG4gKiBmaWx0ZXIgZXJyb3JlZCksIGFuZCBgSU9fRVJST1JgICh0cmFuc2llbnQgcmVhZCBmYWlsdXJlKS5cbiAqXG4gKiBUaGVzZSBhcmUgYSBzdHJpY3Qgc3Vic2V0IG9mIHtAbGluayBpc0RlYnR9OiBldmVyeSBlbnZpcm9ubWVudGFsIHN0YXR1cyBpc1xuICogYWxzbyBkZWJ0IChpdCBibG9ja3Mgb24gaXRzIG93biBtZXJpdHMgd2hlbiBzdXJmYWNlZCBpbiBhIHN0YXR1cyByZXBvcnQpLCBidXRcbiAqIHRoZSBhZHZpc29yIG11c3QgdHJlYXQgdGhlbSBkaWZmZXJlbnRseSBmcm9tICpzZW1hbnRpYyogZHJpZnQgKGBDSEFOR0VEYCxcbiAqIGBERUxFVEVEYCkuIFNlbWFudGljIGRyaWZ0IGlzIGZpeGFibGUgYnkgZWRpdGluZyBhIHNwYW4sIHNvIHRoZSBhZHZpc29yIGZhaWxzXG4gKiBjbG9zZWQgb24gaXQ7IGFuIGVudmlyb25tZW50YWwgY29uZGl0aW9uIGlzIG5vdCBzb21ldGhpbmcgYSBzcGFuIGVkaXQgY2FuXG4gKiByZXNvbHZlLCBzbyB0aGUgYWR2aXNvciBmYWlscyBPUEVOIG9uIGl0IChhbGxvdywgYnV0IHN1cmZhY2UgdGhlIGNvbmRpdGlvbikgXHUyMDE0XG4gKiByZS1kZW55aW5nIGZvcmV2ZXIgb24gYW4gaW5mcmEgZmFpbHVyZSB0aGUgdXNlciBjYW5ub3QgY2xlYXIgZnJvbSBoZXJlIHdvdWxkXG4gKiBjb250cmFkaWN0IHRoZSBmYWlsLW9wZW4gY29udHJhY3QgdGhlIHJlc3Qgb2YgdGhlIGFkdmlzb3IgYWxyZWFkeSBob25vcnMgZm9yXG4gKiBDTEktYWJzZW50L3RpbWVvdXQvcGFyc2UtZmFpbHVyZSBjb25kaXRpb25zLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNFbnZpcm9ubWVudGFsU3RhdHVzKHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogYm9vbGVhbiB7XG4gIHN3aXRjaCAoc3RhdHVzKSB7XG4gICAgY2FzZSAnQ09ORkxJQ1QnOlxuICAgIGNhc2UgJ1NVQk1PRFVMRSc6XG4gICAgY2FzZSAnTEZTX05PVF9GRVRDSEVEJzpcbiAgICBjYXNlICdMRlNfTk9UX0lOU1RBTExFRCc6XG4gICAgY2FzZSAnUFJPTUlTT1JfTUlTU0lORyc6XG4gICAgY2FzZSAnU1BBUlNFX0VYQ0xVREVEJzpcbiAgICBjYXNlICdGSUxURVJfRkFJTEVEJzpcbiAgICBjYXNlICdJT19FUlJPUic6XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKlxuICogYGdpdCBzcGFuIGRyaWZ0IC0tZm9ybWF0IHBvcmNlbGFpbmAgZW1pdHMgYSBkaWZmZXJlbnQgc2hhcGUgdGhhblxuICogYGxpc3QgLS1wb3JjZWxhaW5gOiBhIGAjIHBvcmNlbGFpbiB2MmAgaGVhZGVyLCBgIyBmdXp6eSBOYCBjb21tZW50IGxpbmVzLFxuICogYW5kIG9uZSBgPHN0YXR1cz5cXHQ8c3JjPlxcdDxuYW1lPlxcdDxwYXRoPlxcdDxzdGFydD5cXHQ8ZW5kPmAgcm93IHBlciBkcmlmdGVkXG4gKiBhbmNob3IgKHdob2xlLWZpbGUgYW5jaG9ycyBjYXJyeSBgKHdob2xlKWAvYC1gIGluIHBsYWNlIG9mIHRoZSBsaW5lIGNvbHVtbnMpLlxuICogUm93cyB3aG9zZSBzdGF0dXMgdG9rZW4gaXMgbm90IGluIHtAbGluayBQT1JDRUxBSU5fU1RBVFVTRVN9IGFyZSBza2lwcGVkIFx1MjAxNFxuICogYW4gdW5yZWNvZ25pemVkIHRva2VuIGZyb20gYSBuZXdlciBDTEkgaXMgdHJlYXRlZCB0aGUgc2FtZSBhcyBhIG1hbGZvcm1lZFxuICogbGluZSByYXRoZXIgdGhhbiBndWVzc2VkIGF0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VEcmlmdFBvcmNlbGFpbihzdGRvdXQ6IHN0cmluZyk6IERyaWZ0UG9yY2VsYWluUm93W10ge1xuICBjb25zdCByb3dzOiBEcmlmdFBvcmNlbGFpblJvd1tdID0gW107XG4gIGZvciAoY29uc3QgbGluZSBvZiBzdGRvdXQuc3BsaXQoJ1xcbicpKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCB8fCB0cmltbWVkLnN0YXJ0c1dpdGgoJyMnKSkgY29udGludWU7XG4gICAgY29uc3QgcGFydHMgPSB0cmltbWVkLnNwbGl0KCdcXHQnKTtcbiAgICBpZiAocGFydHMubGVuZ3RoIDwgNikgY29udGludWU7XG4gICAgY29uc3QgW3N0YXR1c0NvbCwgLCBuYW1lLCBwYXRoLCBzdGFydENvbCwgZW5kQ29sXSA9IHBhcnRzO1xuICAgIGNvbnN0IHN0YXR1cyA9IHBhcnNlUG9yY2VsYWluU3RhdHVzKHN0YXR1c0NvbCk7XG4gICAgaWYgKCFzdGF0dXMpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHN0YXJ0ID0gc3RhcnRDb2wgPT09ICcod2hvbGUpJyA/IDAgOiBwYXJzZUludChzdGFydENvbCwgMTApO1xuICAgIGNvbnN0IGVuZCA9IGVuZENvbCA9PT0gJy0nID8gMCA6IHBhcnNlSW50KGVuZENvbCwgMTApO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpIHx8IE51bWJlci5pc05hTihlbmQpKSBjb250aW51ZTtcbiAgICByb3dzLnB1c2goeyBuYW1lLCBwYXRoLCBzdGFydCwgZW5kLCBzdGF0dXMgfSk7XG4gIH1cbiAgcmV0dXJuIHJvd3M7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2Vzc2lvbiBJRCBzYW5pdGl6YXRpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIEluamVjdGl2ZSB0cmFuc2Zvcm06IHBlcmNlbnQtZW5jb2RlIGJ5dGVzIG91dHNpZGUgW0EtWmEtejAtOS5fLV0gYXMgJUhIXG4gKiAodXBwZXJjYXNlIGhleCkuIFVzZWQgdG8gcHJvZHVjZSBzYWZlIGZpbGVuYW1lcyBmcm9tIGFyYml0cmFyeSBzZXNzaW9uIGlkcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplU2Vzc2lvbklkKHNlc3Npb25JZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHNlc3Npb25JZC5yZXBsYWNlKC9bXkEtWmEtejAtOS5fLV0vZywgKGNoKSA9PiB7XG4gICAgcmV0dXJuIGAlJHtjaC5jaGFyQ29kZUF0KDApLnRvU3RyaW5nKDE2KS50b1VwcGVyQ2FzZSgpLnBhZFN0YXJ0KDIsICcwJyl9YDtcbiAgfSk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUGVyLXNlc3Npb24gYmFzZSBkaXJlY3Rvcnlcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vLyBCYXNlIGRpciBzaGFyZWQgYnkgYWxsIHBlci1zZXNzaW9uIHN0YXRlOiBjdXJyZW50bHkganVzdCB0aGUgdG91Y2gtaG9va1xuLy8gc2Vzc2lvbiBtZW1vIChzcGFuLXN1cmZhY2UudHMncyBNZW1vU3RvcmUpLiBFYWNoIHNlc3Npb24gZ2V0cyBvbmVcbi8vIHN1YmRpcmVjdG9yeSBrZXllZCBieSBpdHMgc2FuaXRpemVkIGlkLCBzbyBldmVyeSB3cml0ZXIvcmVhZGVyIGZvciBhIGdpdmVuXG4vLyBzZXNzaW9uIGFncmVlcyBvbiBpdHMgbG9jYXRpb24uXG5leHBvcnQgY29uc3QgU0VTU0lPTl9CQVNFX0RJUiA9IG5vZGVQYXRoLmpvaW4ob3MuaG9tZWRpcigpLCAnLmNhY2hlJywgJ2dpdC1zcGFuJywgJ3Nlc3Npb24nKTtcblxuLyoqIFRoZSBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcnkgZm9yIGEgZ2l2ZW4gc2Vzc2lvbiBpZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uRGlyKHNlc3Npb25JZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4oU0VTU0lPTl9CQVNFX0RJUiwgc2FuaXRpemVTZXNzaW9uSWQoc2Vzc2lvbklkKSk7XG59XG5cbmNvbnN0IFRISVJUWV9EQVlTX01TID0gMzAgKiAyNCAqIDYwICogNjAgKiAxMDAwO1xuXG4vKipcbiAqIE9wcG9ydHVuaXN0aWNhbGx5IHBydW5lIHBlci1zZXNzaW9uIHN0YXRlIGRpcmVjdG9yaWVzIHVuZGVyXG4gKiB7QGxpbmsgU0VTU0lPTl9CQVNFX0RJUn0gd2hvc2UgbXRpbWUgaXMgb2xkZXIgdGhhbiBgbWF4QWdlTXNgIChkZWZhdWx0IDMwXG4gKiBkYXlzKS4gQSBkaXJlY3RvcnkncyBtdGltZSBhZHZhbmNlcyB3aGVuZXZlciBhbiBlbnRyeSBpbnNpZGUgaXQgaXNcbiAqIGNyZWF0ZWQvcmVuYW1lZC9yZW1vdmVkLCBzbyBhbiBhY3RpdmUgc2Vzc2lvbiAobWVtbyB3cml0ZXMpIHN0YXlzIGZyZXNoO1xuICogb25seSBnZW51aW5lbHkgYWJhbmRvbmVkIHNlc3Npb25zIGFnZSBvdXQuXG4gKlxuICogQmVzdC1lZmZvcnQgYW5kIG5vbi10aHJvd2luZzogY2FsbGVkIG9wcG9ydHVuaXN0aWNhbGx5IGZyb20gaG9vayByZWFkL3dyaXRlXG4gKiBwYXRocywgbm90IGEgc2VwYXJhdGUgY3Jvbi1saWtlIG1lY2hhbmlzbSwgc28gYSBmYWlsdXJlIGhlcmUgbXVzdCBuZXZlclxuICogYmxvY2sgdGhlIGNhbGxlcidzIGFjdHVhbCB3b3JrLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcHJ1bmVTdGFsZVNlc3Npb25zKG5vdzogbnVtYmVyID0gRGF0ZS5ub3coKSwgbWF4QWdlTXM6IG51bWJlciA9IFRISVJUWV9EQVlTX01TKTogdm9pZCB7XG4gIGxldCBlbnRyaWVzOiBmcy5EaXJlbnRbXTtcbiAgdHJ5IHtcbiAgICBlbnRyaWVzID0gZnMucmVhZGRpclN5bmMoU0VTU0lPTl9CQVNFX0RJUiwgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm47IC8vIGJhc2UgZGlyIGFic2VudCBvciB1bnJlYWRhYmxlIFx1MjAxNCBub3RoaW5nIHRvIHBydW5lXG4gIH1cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSB7XG4gICAgaWYgKCFlbnRyeS5pc0RpcmVjdG9yeSgpKSBjb250aW51ZTtcbiAgICBjb25zdCBkaXJQYXRoID0gbm9kZVBhdGguam9pbihTRVNTSU9OX0JBU0VfRElSLCBlbnRyeS5uYW1lKTtcbiAgICB0cnkge1xuICAgICAgY29uc3Qgc3RhdCA9IGZzLnN0YXRTeW5jKGRpclBhdGgpO1xuICAgICAgaWYgKG5vdyAtIHN0YXQubXRpbWVNcyA+IG1heEFnZU1zKSB7XG4gICAgICAgIGZzLnJtU3luYyhkaXJQYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XG4gICAgICB9XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBWYW5pc2hlZCBiZXR3ZWVuIHJlYWRkaXIgYW5kIHN0YXQsIG9yIHJlbW92YWwgZmFpbGVkIFx1MjAxNCBza2lwIGl0LiBBXG4gICAgICAvLyBiZXN0LWVmZm9ydCBwcnVuZSBtdXN0IG5ldmVyIHRocm93IGludG8gdGhlIGNhbGxlcidzIGhvdCBwYXRoLlxuICAgIH1cbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIGtpbmQgYW5kIGFuY2hvciBmb3JtYXR0aW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IHR5cGUgVG91Y2hLaW5kID0gJ3JlYWQnIHwgJ3dyaXRlJyB8ICd3aG9sZS1yZWFkJyB8ICd3aG9sZS13cml0ZScgfCAnY3JlYXRlJztcblxuLyoqXG4gKiBGb3JtYXQgYSBzcGFuIGFuY2hvciBzdHJpbmcuXG4gKlxuICogLSBgd2hvbGUtcmVhZGAsIGB3aG9sZS13cml0ZWAsIGFuZCBgY3JlYXRlYDogcmV0dXJucyBqdXN0IHRoZSBwYXRoXG4gKiAtIGByZWFkYCBhbmQgYHdyaXRlYDogcmV0dXJucyBgcGF0aCNMPHN0YXJ0Pi1MPGVuZD5gIChyZXF1aXJlcyByYW5nZSlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEFuY2hvcihwYXRoOiBzdHJpbmcsIGtpbmQ6IFRvdWNoS2luZCwgcmFuZ2U/OiBMaW5lUmFuZ2UpOiBzdHJpbmcge1xuICBpZiAoKGtpbmQgPT09ICdyZWFkJyB8fCBraW5kID09PSAnd3JpdGUnKSAmJiByYW5nZSkge1xuICAgIHJldHVybiBgJHtwYXRofSNMJHtyYW5nZS5zdGFydH0tTCR7cmFuZ2UuZW5kfWA7XG4gIH1cbiAgcmV0dXJuIHBhdGg7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQW5jaG9yIHNwZWMgdHlwZVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgQW5jaG9yU3BlYyB7XG4gIHBhdGg6IHN0cmluZztcbiAga2luZDogVG91Y2hLaW5kO1xuICByYW5nZT86IExpbmVSYW5nZTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBRdWV1ZSBkaXJlY3RvcnkgaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmVzb2x2ZSB0aGUgZ2l0IGNvbW1vbiBkaXJlY3RvcnkgZm9yIHRoZSBnaXZlbiByZXBvIHJvb3QuXG4gKiBUaGlzIGlzIHRoZSBzaGFyZWQgZGlyZWN0b3J5IChub3QgdGhlIHdvcmt0cmVlLXNwZWNpZmljIC5naXQpLCBzbyBxdWV1ZVxuICogcmVjb3JkcyBzdXJ2aXZlIHdvcmt0cmVlIGRlbGV0aW9uLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZUdpdENvbW1vbkRpcihyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJy1DJywgcmVwb1Jvb3QsICdyZXYtcGFyc2UnLCAnLS1naXQtY29tbW9uLWRpciddLCB7XG4gICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgZW5jb2Rpbmc6ICd1dGY4J1xuICB9KTtcbiAgY29uc3QgdHJpbW1lZCA9IHRvUG9zaXgob3V0LnRyaW0oKSk7XG4gIC8vIGdpdCByZXR1cm5zIGEgcmVsYXRpdmUgcGF0aCAoZS5nLiBcIi5naXRcIikgZm9yIHNpbXBsZSByZXBvcy4gUmVzb2x2ZSBpdFxuICAvLyBhZ2FpbnN0IHJlcG9Sb290IHNvIGNhbGxlcnMgbmV2ZXIgZGVwZW5kIG9uIHByb2Nlc3MuY3dkKCkuXG4gIGlmICghbm9kZVBhdGguaXNBYnNvbHV0ZSh0cmltbWVkKSkge1xuICAgIHJldHVybiB0b1Bvc2l4KG5vZGVQYXRoLnJlc29sdmUocmVwb1Jvb3QsIHRyaW1tZWQpKTtcbiAgfVxuICByZXR1cm4gdHJpbW1lZDtcbn1cblxuLyoqXG4gKiBSb290IG9mIHRoZSBnaXQtc3BhbiBxdWV1ZSBkaXJlY3RvcnkgdHJlZSwgdW5kZXIgdGhlIGdpdCBjb21tb24gZGlyLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcXVldWVSb290KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihyZXNvbHZlR2l0Q29tbW9uRGlyKHJlcG9Sb290KSwgJ2dpdC1zcGFuJyk7XG59XG5cbi8qKlxuICogRGlyZWN0b3J5IGZvciB0aGUgYWR2aXNvcidzIHBlci1jaGFuZ2VzZXQgc3RhdGUgbWVtb3MgKGRpZ2VzdCBvZiBzb3J0ZWRcbiAqIGZpbmRpbmdzICsgdW5jb3ZlcmVkIHBhdGhzKSwgdW5kZXIgdGhlIGdpdCBjb21tb24gZGlyIHNvIGl0IGlzIHNoYXJlZFxuICogYWNyb3NzIHdvcmt0cmVlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFkdmlzb3JNZW1vRGlyKHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihxdWV1ZVJvb3QocmVwb1Jvb3QpLCAnYWR2aXNvcicpO1xufVxuIiwgIi8qKlxuICogSGFybmVzcy1hZ25vc3RpYyBzcGFuLXN1cmZhY2luZyBjb3JlLlxuICpcbiAqIEdpdmVuIGFuIGFscmVhZHktcmVzb2x2ZWQgcmVwby1yZWxhdGl2ZSBwYXRoIGFuZCBhIGxpbmUgcmFuZ2UsIHRoaXMgbW9kdWxlXG4gKiBydW5zIHRoZSBzaGFyZWQgYGdpdCBzcGFuIGxpc3QgLS1wb3JjZWxhaW5gIC8gYC5ob29raWdub3JlYCAvIHNlc3Npb24tbWVtbyAvXG4gKiBgZ2l0IHNwYW4gZHJpZnRgIHBpcGVsaW5lIGFuZCBhc3NlbWJsZXMgdGhlIGh1bWFuLXJlYWRhYmxlIGA8Z2l0LXNwYW4+XHUyMDI2PC9naXQtc3Bhbj5gXG4gKiBibG9jayB0aGF0IGJvdGggYWRhcHRlcnMgc3VyZmFjZSBpbmxpbmUgYmVmb3JlIGFuIGVkaXQuIEl0IGltcG9ydHMgbm90aGluZ1xuICogZnJvbSBlaXRoZXIgaG9vayBTREs6IHRoZSBDbGF1ZGUgUHJlVG9vbFVzZSBob29rIGZlZWRzIGl0IGEgcmFuZ2UgZGVyaXZlZCBmcm9tXG4gKiBgZmlsZV9wYXRoYC9gb2Zmc2V0YC9gb2xkX3N0cmluZ2A7IHRoZSBDb2RleCBQcmVUb29sVXNlIGhvb2sgZmVlZHMgaXQgdGhlXG4gKiByYW5nZXMgcmVjb3ZlcmVkIGZyb20gYW4gYGFwcGx5X3BhdGNoYCBlbnZlbG9wZS4gRWFjaCBhZGFwdGVyIHdyYXBzIHRoZVxuICogcmV0dXJuZWQgYmxvY2sgc3RyaW5nIGluIGl0cyBvd24gU0RLIG91dHB1dCBidWlsZGVyLlxuICpcbiAqIFRoZSBleGVjdXRvci9kcmlmdC9tZW1vIGRlcGVuZGVuY2llcyBhcmUgaW5qZWN0ZWQgc28gdGhlIHBpcGVsaW5lIGlzIHRlc3RhYmxlXG4gKiB3aXRoIGZha2VzIGV4YWN0bHkgbGlrZSB0aGUgcG9yY2VsYWluIHBhcnNlcnMgaW4gdGhlIHNoYXJlZCBrZXJuZWwuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7XG4gIGlzR2l0SWdub3JlZCxcbiAgaXNJbnNpZGVTcGFuUm9vdCxcbiAgdHlwZSBMaW5lUmFuZ2UsXG4gIHR5cGUgUG9yY2VsYWluUm93LFxuICBwYXJzZURyaWZ0UG9yY2VsYWluLFxuICBwYXJzZVBvcmNlbGFpbixcbiAgcHJ1bmVTdGFsZVNlc3Npb25zLFxuICByYW5nZXNJbnRlcnNlY3QsXG4gIHJlbGF0aXZlVG9SZXBvLFxuICByZXNvbHZlUmVwb1Jvb3QsXG4gIHJlc29sdmVTcGFuUm9vdCxcbiAgc2Vzc2lvbkRpcixcbiAgdG9Qb3NpeFxufSBmcm9tICcuL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyB0eXBlIEhvb2tJZ25vcmVMb2FkZXIsIGlzU3BhblN1cHByZXNzZWQgfSBmcm9tICcuL3NwYW4taWdub3JlLmpzJztcblxuLyoqXG4gKiBNaW5pbWFsIGxvZ2dlciBzdXJmYWNlIHRoZSBgY29tbW9uL2AgbGF5ZXIgbG9ncyB0aHJvdWdoOyBib3RoIFNESyBsb2dnZXJzXG4gKiBzYXRpc2Z5IGl0LiBgd2FybmAgaXMgcmVxdWlyZWQgXHUyMDE0IGV2ZXJ5IGV4aXN0aW5nIGNhbGwgc2l0ZSByZXBvcnRzIGEgZmFpbHVyZS5cbiAqIGBpbmZvYCBpcyBvcHRpb25hbCBzbyBhIGZha2UgY2Fycnlpbmcgb25seSBgd2FybmAgc3RpbGwgc2F0aXNmaWVzIHRoZVxuICogaW50ZXJmYWNlOiBpdCBleGlzdHMgZm9yIHRoZSBkaWFnbm9zdGljIGJyZWFkY3J1bWJzIGEgKnN1Y2Nlc3NmdWwqIHJ1biBsZWF2ZXNcbiAqIGJlaGluZCAoYWR2aXNvci1jb3JlJ3MgY2h1cm4tc3VwcHJlc3Npb24gY291bnQpLCB3aGljaCBhcmUgbm90IHdhcm5pbmdzIGFuZFxuICogbXVzdCBub3QgcmVhZCBhcyBmYWlsdXJlcyBpbiB0aGUgaG9vayBsb2cuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29yZUxvZ2dlciB7XG4gIHdhcm4obWVzc2FnZTogc3RyaW5nLCBjb250ZXh0PzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB2b2lkO1xuICBpbmZvPyhtZXNzYWdlOiBzdHJpbmcsIGNvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQ7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU3BhbiBleGVjdXRvciBhYnN0cmFjdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogRXhlY3V0ZXMgYGdpdCBzcGFuIGxpc3RgIHdpdGggZ2l2ZW4gYXJncyBpbiBhIGdpdmVuIGN3ZC5cbiAqIFJldHVybnMgc3Rkb3V0IHN0cmluZy4gVGhyb3dzIG9uIG5vbi16ZXJvIGV4aXQuXG4gKi9cbmV4cG9ydCB0eXBlIFNwYW5FeGVjdXRvciA9IChhcmdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpID0+IHN0cmluZztcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURlZmF1bHRTcGFuRXhlY3V0b3IodGltZW91dE1zID0gMTBfMDAwKTogU3BhbkV4ZWN1dG9yIHtcbiAgcmV0dXJuIChhcmdzLCBjd2QpID0+IHtcbiAgICByZXR1cm4gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnbGlzdCcsIC4uLmFyZ3NdLCB7XG4gICAgICBjd2QsXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgfSk7XG4gIH07XG59XG5cbi8qKlxuICogUnVucyBgZ2l0IHNwYW4gZHJpZnQgLS1mb3JtYXQgcG9yY2VsYWluIDxzbHVncz5gIGFuZCByZXR1cm5zIGl0cyBwb3JjZWxhaW4gc3Rkb3V0IFx1MjAxNFxuICogb25lIHJvdyBwZXIgKmRyaWZ0ZWQqIGFuY2hvciBhbW9uZyB0aGUgZ2l2ZW4gc3BhbnMsIGVtcHR5IHdoZW4gYWxsIGFyZSBjbGVhbi5cbiAqIGBnaXQgc3BhbiBkcmlmdGAgZXhpdHMgMCBpbiBwb3JjZWxhaW4gbW9kZSB3aGV0aGVyIG9yIG5vdCBkcmlmdCBleGlzdHMsIGJ1dCB3ZVxuICogc3RpbGwgY2FwdHVyZSBzdGRvdXQgZnJvbSBhIHRocm93biBlcnJvciBzbyBhIGRyaWZ0IHNpZ25hbCBpcyBuZXZlciBsb3N0IHRvIGFcbiAqIG5vbi16ZXJvIGV4aXQuIFRocm93cyBvbmx5IHdoZW4gbm8gc3Rkb3V0IGlzIGF2YWlsYWJsZSAoZ2VudWluZSBmYWlsdXJlKS5cbiAqL1xuZXhwb3J0IHR5cGUgRHJpZnRFeGVjdXRvciA9IChzbHVnczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKSA9PiBzdHJpbmc7XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0RHJpZnRFeGVjdXRvcih0aW1lb3V0TXMgPSAxMF8wMDApOiBEcmlmdEV4ZWN1dG9yIHtcbiAgcmV0dXJuIChzbHVncywgY3dkKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdkcmlmdCcsICctLWZvcm1hdCcsICdwb3JjZWxhaW4nLCAuLi5zbHVnc10sIHtcbiAgICAgICAgY3dkLFxuICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zdCBvdXQgPSAoZXJyIGFzIHsgc3Rkb3V0Pzogc3RyaW5nIH0pLnN0ZG91dDtcbiAgICAgIGlmICh0eXBlb2Ygb3V0ID09PSAnc3RyaW5nJykgcmV0dXJuIG91dDtcbiAgICAgIHRocm93IGVycjtcbiAgICB9XG4gIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU2Vzc2lvbiBtZW1vIGFic3RyYWN0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBNZW1vU3RvcmUge1xuICBnZXRTdXJmYWNlZChzZXNzaW9uSWQ6IHN0cmluZyk6IFNldDxzdHJpbmc+O1xuICBhZGRTdXJmYWNlZChzZXNzaW9uSWQ6IHN0cmluZywgbmFtZXM6IHN0cmluZ1tdKTogdm9pZDtcbn1cblxuLy8gTGl2ZXMgdW5kZXIgdGhlIHNoYXJlZCBwZXItc2Vzc2lvbiBzdGF0ZSBkaXJlY3RvcnkgKGFnZW50LWhvb2tzLWNvbW1vbi50cydzXG4vLyBzZXNzaW9uRGlyKSBcdTIwMTQgcmVsb2NhdGVkIGZyb20gb3MudG1wZGlyKCkvYWdlbnQtaG9va3MtZ2l0LXNwYW4vIHNvXG4vLyBwZXItc2Vzc2lvbiBzdGF0ZSBoYXMgb25lIGhvbWUgYW5kIGlzIGNvdmVyZWQgYnkgcHJ1bmVTdGFsZVNlc3Npb25zJ3Ncbi8vIG9wcG9ydHVuaXN0aWMgPjMwLWRheSBwcnVuaW5nLlxuZnVuY3Rpb24gbWVtb0ZpbGVQYXRoKHNlc3Npb25JZDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5vZGVQYXRoLmpvaW4oc2Vzc2lvbkRpcihzZXNzaW9uSWQpLCAndG91Y2gtbWVtby5qc29uJyk7XG59XG5cbmV4cG9ydCB0eXBlIE1lbW9Mb2dnZXIgPSBDb3JlTG9nZ2VyO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGlza01lbW9TdG9yZShsb2dnZXI6IE1lbW9Mb2dnZXIpOiBNZW1vU3RvcmUge1xuICByZXR1cm4ge1xuICAgIGdldFN1cmZhY2VkKHNlc3Npb25JZCkge1xuICAgICAgcHJ1bmVTdGFsZVNlc3Npb25zKCk7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByYXcgPSBmcy5yZWFkRmlsZVN5bmMobWVtb0ZpbGVQYXRoKHNlc3Npb25JZCksICd1dGY4Jyk7XG4gICAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UocmF3KSBhcyB7IHN1cmZhY2VkPzogdW5rbm93biB9O1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShwYXJzZWQuc3VyZmFjZWQpKSB7XG4gICAgICAgICAgcmV0dXJuIG5ldyBTZXQocGFyc2VkLnN1cmZhY2VkIGFzIHN0cmluZ1tdKTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGxvZ2dlci53YXJuKCdtZW1vIHJlYWQgZmFpbGVkICh0cmVhdGluZyBhcyBlbXB0eSknLCB7IGVyciB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBuZXcgU2V0KCk7XG4gICAgfSxcbiAgICBhZGRTdXJmYWNlZChzZXNzaW9uSWQsIG5hbWVzKSB7XG4gICAgICBwcnVuZVN0YWxlU2Vzc2lvbnMoKTtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5nZXRTdXJmYWNlZChzZXNzaW9uSWQpO1xuICAgICAgZm9yIChjb25zdCBuIG9mIG5hbWVzKSBleGlzdGluZy5hZGQobik7XG4gICAgICBjb25zdCBtZW1vRGlyID0gc2Vzc2lvbkRpcihzZXNzaW9uSWQpO1xuICAgICAgY29uc3QgbWVtb1BhdGggPSBtZW1vRmlsZVBhdGgoc2Vzc2lvbklkKTtcbiAgICAgIGNvbnN0IHRtcFBhdGggPSBgJHttZW1vUGF0aH0udG1wYDtcbiAgICAgIHRyeSB7XG4gICAgICAgIGZzLm1rZGlyU3luYyhtZW1vRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgZnMud3JpdGVGaWxlU3luYyh0bXBQYXRoLCBKU09OLnN0cmluZ2lmeSh7IHN1cmZhY2VkOiBbLi4uZXhpc3RpbmddIH0pLCAndXRmOCcpO1xuICAgICAgICBmcy5yZW5hbWVTeW5jKHRtcFBhdGgsIG1lbW9QYXRoKTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBsb2dnZXIud2FybignbWVtbyB3cml0ZSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG59XG5cbi8qKiBGYWN0b3J5IGZ1bmN0aW9uIHRoYXQgY3JlYXRlcyBhIE1lbW9TdG9yZSBnaXZlbiBhIGxvZ2dlci4gKi9cbmV4cG9ydCB0eXBlIE1lbW9GYWN0b3J5ID0gKGxvZ2dlcjogTWVtb0xvZ2dlcikgPT4gTWVtb1N0b3JlO1xuXG4vKiogRGVmYXVsdCBkaXNrLWJhY2tlZCBtZW1vIGZhY3RvcnkgdXNlZCBpbiBwcm9kdWN0aW9uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRpc2tNZW1vRmFjdG9yeShsb2dnZXI6IE1lbW9Mb2dnZXIpOiBNZW1vU3RvcmUge1xuICByZXR1cm4gY3JlYXRlRGlza01lbW9TdG9yZShsb2dnZXIpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIHNjb3BlIHJlc29sdXRpb24gKHJlcG8tc2NvcGluZyArIGdpdGlnbm9yZSArIHNwYW4tcm9vdCBndWFyZHMpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBUb3VjaFNjb3BlIHtcbiAgcmVwb1Jvb3Q6IHN0cmluZztcbiAgcmVwb1JlbFBhdGg6IHN0cmluZztcbn1cblxuLyoqXG4gKiBCb3VuZCBhIHRvdWNoZWQgZmlsZSB0byB0aGUgQ1dEIHJlcG8uIFJlc29sdmUgdGhlIHJlcG8gcm9vdCBvZiB0aGUgY3VycmVudFxuICogd29ya2luZyBkaXJlY3RvcnkgYW5kIHJlcXVpcmUgdGhlIHRvdWNoZWQgZmlsZSB0byByZXNvbHZlIHRvIHRoZSBTQU1FIHJlcG9cbiAqIHJvb3Q7IGRyb3AgZmlsZXMgaW4gYSBkaWZmZXJlbnQgcmVwb3NpdG9yeS93b3JrdHJlZSwgZ2l0aWdub3JlZCBmaWxlcywgYW5kXG4gKiBmaWxlcyB1bmRlciB0aGUgc3BhbiByb290LiBSZXR1cm5zIHRoZSByZXNvbHZlZCBgeyByZXBvUm9vdCwgcmVwb1JlbFBhdGggfWBcbiAqIG9yIG51bGwgd2hlbiB0aGUgdG91Y2ggaXMgb3V0IG9mIHNjb3BlLlxuICpcbiAqIENvbXBhcmluZyByZXNvbHZlZCBgZ2l0IC0tc2hvdy10b3BsZXZlbGAgdG9wbGV2ZWxzIChub3QgcGF0aCBwcmVmaXhlcylcbiAqIGRpc3Rpbmd1aXNoZXMgc2VwYXJhdGUgcmVwb3MgYW5kIHdvcmt0cmVlcyBhbmQgaXMgcm9idXN0IHRvIHN5bWxpbmtzLiBGYWlsXG4gKiBjbG9zZWQ6IGlmIHRoZSBDV0QgcmVwbyBjYW4ndCBiZSByZXNvbHZlZCwgdGhlIHRvdWNoIGlzIGRyb3BwZWQgcmF0aGVyIHRoYW5cbiAqIGZhbGxpbmcgYmFjayB0byB0aGUgZmlsZSdzIG93biByZXBvLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2ZVRvdWNoU2NvcGUoY3dkOiBzdHJpbmcsIGFic1BhdGg6IHN0cmluZyk6IFRvdWNoU2NvcGUgfCBudWxsIHtcbiAgY29uc3QgY3dkUmVwb1Jvb3QgPSBjd2QgPyByZXNvbHZlUmVwb1Jvb3QoY3dkKSA6IG51bGw7XG4gIGlmICghY3dkUmVwb1Jvb3QpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGFic0RpciA9IHRvUG9zaXgobm9kZVBhdGguZGlybmFtZShhYnNQYXRoKSk7XG4gIGNvbnN0IGZpbGVSZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChhYnNEaXIpO1xuICBpZiAoZmlsZVJlcG9Sb290ICE9PSBjd2RSZXBvUm9vdCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgcmVwb1Jvb3QgPSBjd2RSZXBvUm9vdDtcbiAgY29uc3QgcmVwb1JlbFBhdGggPSByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgYWJzUGF0aCk7XG5cbiAgLy8gU2tpcCBnaXRpZ25vcmVkIGZpbGVzIGVudGlyZWx5LiBCdWlsZCBvdXRwdXQsIGNhY2hlcywgYW5kIGxvZ3MgYXJlIG5vdFxuICAvLyBzcGFuLXJlbGV2YW50OiB0aGV5IG11c3QgbmV2ZXIgc3VyZmFjZSBzcGFuIG92ZXJsYXBzLlxuICBpZiAoaXNHaXRJZ25vcmVkKHJlcG9Sb290LCByZXBvUmVsUGF0aCkpIHJldHVybiBudWxsO1xuXG4gIC8vIFNraXAgc3BhbiBkb2N1bWVudHMgZW50aXJlbHkuIEZpbGVzIHVuZGVyIHRoZSByZXNvbHZlZCBzcGFuIHJvb3QgYXJlIG1hbmFnZWRcbiAgLy8gYnkgZ2l0IHNwYW4gaXRzZWxmIGFuZCBhcmUgbm90IGFwcGxpY2F0aW9uIHNvdXJjZXMgdGhhdCBuZWVkIHNwYW4gY292ZXJhZ2UuXG4gIGNvbnN0IHNwYW5Sb290ID0gcmVzb2x2ZVNwYW5Sb290KHJlcG9Sb290KTtcbiAgaWYgKGlzSW5zaWRlU3BhblJvb3QocmVwb1JlbFBhdGgsIHNwYW5Sb290KSkgcmV0dXJuIG51bGw7XG5cbiAgcmV0dXJuIHsgcmVwb1Jvb3QsIHJlcG9SZWxQYXRoIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gU3VyZmFjZSByb3V0aW5lXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEluamVjdGVkIGRlcGVuZGVuY2llcyBmb3Ige0BsaW5rIHN1cmZhY2VPdmVybGFwcGluZ1NwYW5zfS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3VyZmFjZURlcHMge1xuICBleGVjdXRvcjogU3BhbkV4ZWN1dG9yO1xuICBkcmlmdEV4ZWN1dG9yOiBEcmlmdEV4ZWN1dG9yO1xuICBtZW1vOiBNZW1vU3RvcmU7XG4gIGxvYWRSdWxlczogSG9va0lnbm9yZUxvYWRlcjtcbiAgbG9nZ2VyOiBDb3JlTG9nZ2VyO1xufVxuXG4vKipcbiAqIEdpdmVuIGEgcmVwby1yZWxhdGl2ZSBwYXRoIGFuZCB0aGUgbGluZSByYW5nZSBiZWluZyB0b3VjaGVkIHdpdGhpbiBhblxuICogYWxyZWFkeS1yZXNvbHZlZCByZXBvLCBwcm9kdWNlIHRoZSBgPGdpdC1zcGFuPlx1MjAyNjwvZ2l0LXNwYW4+YCBibG9jayBmb3IgdGhlXG4gKiBzcGFucyBvdmVybGFwcGluZyB0aGF0IHJhbmdlLCBvciBudWxsIHdoZW4gdGhlcmUgaXMgbm90aGluZyB0byBzdXJmYWNlLlxuICpcbiAqIFRoZSBwaXBlbGluZTogYGdpdCBzcGFuIGxpc3QgPHBhdGg+IC0tcG9yY2VsYWluYCBcdTIxOTIga2VlcCBsaW5lLXJhbmdlZCBhbmNob3JzIG9uXG4gKiB0aGUgc2FtZSBmaWxlIHRoYXQgaW50ZXJzZWN0IHRoZSByYW5nZSBhbmQgYXJlIG5vdCBgLmhvb2tpZ25vcmVgLXN1cHByZXNzZWQgXHUyMTkyXG4gKiBkcm9wIHNsdWdzIGFscmVhZHkgc3VyZmFjZWQgdGhpcyBzZXNzaW9uIChtZW1vKSBcdTIxOTIgcmVuZGVyIGBnaXQgc3BhbiBsaXN0XG4gKiA8bmFtZXNcdTIwMjY+YCBcdTIxOTIgYXBwZW5kIGEgYGdpdCBzcGFuIGhpc3RvcnkgPG5hbWU+YCBwb2ludGVyIGZvciBhbnkgYWxyZWFkeS1kcmlmdGVkXG4gKiBzcGFuLiBPbiBzdWNjZXNzIHRoZSBzdXJmYWNlZCBuYW1lcyBhcmUgcmVjb3JkZWQgaW4gdGhlIG1lbW8uIEV4ZWN1dG9yIGFuZFxuICogZHJpZnQtcHJvYmUgZmFpbHVyZXMgYXJlIGxvZ2dlZCBhbmQgZGVncmFkZSB0byBudWxsIC8gdGhlIHBsYWluIGJsb2NrOyB0aGV5XG4gKiBuZXZlciB0aHJvdy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN1cmZhY2VPdmVybGFwcGluZ1NwYW5zKFxuICBkZXBzOiBTdXJmYWNlRGVwcyxcbiAgcmVwb1Jvb3Q6IHN0cmluZyxcbiAgcmVwb1JlbFBhdGg6IHN0cmluZyxcbiAgcmFuZ2U6IExpbmVSYW5nZSxcbiAgc2Vzc2lvbklkOiBzdHJpbmdcbik6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCB7IGV4ZWN1dG9yLCBkcmlmdEV4ZWN1dG9yLCBtZW1vLCBsb2FkUnVsZXMsIGxvZ2dlciB9ID0gZGVwcztcblxuICAvLyBGaWx0ZXIgcGFzczogZ2l0IHNwYW4gbGlzdCA8cGF0aD4gLS1wb3JjZWxhaW5cbiAgbGV0IHBvcmNlbGFpblN0ZG91dDogc3RyaW5nO1xuICB0cnkge1xuICAgIHBvcmNlbGFpblN0ZG91dCA9IGV4ZWN1dG9yKFsnLS1wb3JjZWxhaW4nLCByZXBvUmVsUGF0aF0sIHJlcG9Sb290KTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nZ2VyLndhcm4oJ2dpdCBzcGFuIGxpc3QgLS1wb3JjZWxhaW4gZmFpbGVkJywgeyBlcnIgfSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICAvLyBQYXRoLXNjb3BlZCBzdXBwcmVzc2lvbjogYSByZXBvJ3MgLnNwYW4vLmhvb2tpZ25vcmUgY2FuIGhvbGQgYmFjayBzcGFuIHNsdWdcbiAgLy8gcHJlZml4ZXMgZm9yIGFuY2hvcnMgdW5kZXIgZ2l2ZW4gcGF0aHMuIEEgc3VwcHJlc3NlZCBzcGFuIGlzIG5ldmVyIHN1cmZhY2VkLlxuICBjb25zdCBpZ25vcmVSdWxlcyA9IGxvYWRSdWxlcyhyZXBvUm9vdCk7XG5cbiAgY29uc3Qgcm93czogUG9yY2VsYWluUm93W10gPSBwYXJzZVBvcmNlbGFpbihwb3JjZWxhaW5TdGRvdXQpO1xuICBjb25zdCBjYW5kaWRhdGVOYW1lcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgaWYgKHJvdy5wYXRoICE9PSByZXBvUmVsUGF0aCkgY29udGludWU7XG4gICAgaWYgKHJvdy5zdGFydCA9PT0gMCAmJiByb3cuZW5kID09PSAwKSBjb250aW51ZTsgLy8gd2hvbGUtZmlsZSBhbmNob3JcbiAgICBpZiAoIXJhbmdlc0ludGVyc2VjdChyYW5nZSwgeyBzdGFydDogcm93LnN0YXJ0LCBlbmQ6IHJvdy5lbmQgfSkpIGNvbnRpbnVlO1xuICAgIGlmIChpc1NwYW5TdXBwcmVzc2VkKGlnbm9yZVJ1bGVzLCByb3cucGF0aCwgcm93Lm5hbWUpKSBjb250aW51ZTtcbiAgICBjYW5kaWRhdGVOYW1lcy5hZGQocm93Lm5hbWUpO1xuICB9XG5cbiAgaWYgKGNhbmRpZGF0ZU5hbWVzLnNpemUgPT09IDApIHJldHVybiBudWxsO1xuXG4gIC8vIFN1YnRyYWN0IGFscmVhZHktc3VyZmFjZWQgbmFtZXNcbiAgY29uc3Qgc3VyZmFjZWQgPSBtZW1vLmdldFN1cmZhY2VkKHNlc3Npb25JZCk7XG4gIGNvbnN0IHRvU3VyZmFjZSA9IFsuLi5jYW5kaWRhdGVOYW1lc10uZmlsdGVyKChuKSA9PiAhc3VyZmFjZWQuaGFzKG4pKS5zb3J0KCk7XG4gIGlmICh0b1N1cmZhY2UubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAvLyBSZW5kZXIgcGFzczogZ2l0IHNwYW4gbGlzdCA8bmFtZTE+IDxuYW1lMj4gLi4uXG4gIGxldCByZW5kZXJTdGRvdXQ6IHN0cmluZztcbiAgdHJ5IHtcbiAgICByZW5kZXJTdGRvdXQgPSBleGVjdXRvcih0b1N1cmZhY2UsIHJlcG9Sb290KTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nZ2VyLndhcm4oJ2dpdCBzcGFuIGxpc3QgKHJlbmRlcikgZmFpbGVkJywgeyBlcnIgfSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICAvLyBPZiB0aGUgc3BhbnMgYmVpbmcgc3VyZmFjZWQsIGZsYWcgYW55IGFscmVhZHkgZHJpZnRlZCBcdTIwMTQgdGhlIHRvdWNoZWQgbGluZXMgaGF2ZVxuICAvLyBkcmlmdGVkIGZyb20gdGhlaXIgYW5jaG9yZWQgc3RhdGUgXHUyMDE0IHdpdGggYSBgZ2l0IHNwYW4gaGlzdG9yeSA8bmFtZT5gIHBvaW50ZXIuXG4gIC8vIERldGVjdGlvbiBpcyBhcy1vZi1ub3cgKHN1cmZhY2luZyBydW5zIGJlZm9yZSB0aGUgZWRpdCBhcHBsaWVzKSwgc28gdGhpc1xuICAvLyBjYXRjaGVzIHByZS1leGlzdGluZyBkcmlmdDsgZHJpZnQgdGhpcyBzZXNzaW9uIGNhdXNlcyBpcyB0aGUgU3RvcCBob29rJ3Mgam9iLlxuICAvLyBGYWlsdXJlIHRvIGNvbXB1dGUgZHJpZnQgaXMgbm9uLWZhdGFsOiBmYWxsIGJhY2sgdG8gdGhlIHBsYWluIGJsb2NrLlxuICBsZXQgZHJpZnRIaW50ID0gJyc7XG4gIHRyeSB7XG4gICAgY29uc3QgZHJpZnROYW1lcyA9IG5ldyBTZXQocGFyc2VEcmlmdFBvcmNlbGFpbihkcmlmdEV4ZWN1dG9yKHRvU3VyZmFjZSwgcmVwb1Jvb3QpKS5tYXAoKHIpID0+IHIubmFtZSkpO1xuICAgIGNvbnN0IGRyaWZ0U3VyZmFjZWQgPSB0b1N1cmZhY2UuZmlsdGVyKChuKSA9PiBkcmlmdE5hbWVzLmhhcyhuKSk7XG4gICAgaWYgKGRyaWZ0U3VyZmFjZWQubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgbGluZXMgPSBkcmlmdFN1cmZhY2VkLm1hcCgobikgPT4gYCAgZ2l0IHNwYW4gaGlzdG9yeSAke259YCkuam9pbignXFxuJyk7XG4gICAgICBkcmlmdEhpbnQgPSBgXFxuRHJpZnQgXHUyMDE0IHRoZSBsaW5lcyB5b3UncmUgdG91Y2hpbmcgaGF2ZSBkcmlmdGVkIGZyb20gdGhlc2Ugc3BhbnMnIGFuY2hvcmVkIHN0YXRlLiBSZXZpZXcgaG93IGVhY2ggc3Vic3lzdGVtIGV2b2x2ZWQgYmVmb3JlIGNoYW5naW5nIGl0OlxcbiR7bGluZXN9YDtcbiAgICB9XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZ2dlci53YXJuKCdnaXQgc3BhbiBkcmlmdCAoaGlzdG9yeSBoaW50KSBmYWlsZWQnLCB7IGVyciB9KTtcbiAgfVxuXG4gIGNvbnN0IHdyYXBwZWQgPSBgXFxuPGdpdC1zcGFuPlxcbiR7cmVuZGVyU3Rkb3V0fSR7ZHJpZnRIaW50fVxcbjwvZ2l0LXNwYW4+XFxuYDtcblxuICAvLyBVcGRhdGUgbWVtb1xuICBtZW1vLmFkZFN1cmZhY2VkKHNlc3Npb25JZCwgdG9TdXJmYWNlKTtcblxuICByZXR1cm4gd3JhcHBlZDtcbn1cbiIsICIvKipcbiAqIFBhdGgtc2NvcGVkIHNwYW4gc3VwcHJlc3Npb24gZm9yIHRoZSBhZ2VudCBob29rcy5cbiAqXG4gKiBTb21lIHNwYW5zIGFyZSBub2lzZSB3aGVuIGJyb3dzaW5nIGNlcnRhaW4gcGFydHMgb2YgdGhlIHRyZWUgXHUyMDE0IHdpa2kgb3JcbiAqIG1hcmtldGluZyBzcGFucyB0aGF0IGFuY2hvciBwcm9zZSwgc3VyZmFjZWQgaW5saW5lIHdoaWxlIHJlYWRpbmcgc291cmNlLFxuICogYWRkIGxpdHRsZS4gVGhpcyBtb2R1bGUgbGV0cyBhIHJlcG8gZGVjbGFyZSwgcGVyIHBhdGgsIHdoaWNoIHNwYW4gc2x1Z1xuICogcHJlZml4ZXMgdG8gaG9sZCBiYWNrLlxuICpcbiAqIENvbmZpZyBsaXZlcyBhdCBgPHJlcG9Sb290Pi8uc3Bhbi8uaG9va2lnbm9yZWAuIEVhY2ggbm9uLWNvbW1lbnQgbGluZSBpcyBhXG4gKiBnaXRpZ25vcmUtc3R5bGUgcGF0aCBwYXR0ZXJuLCBhIHNpbmdsZSBydW4gb2Ygd2hpdGVzcGFjZSwgdGhlbiBhXG4gKiBjb21tYS1zZXBhcmF0ZWQgbGlzdCBvZiBzcGFuIHNsdWcgcHJlZml4ZXMgdG8gc3VwcHJlc3MgZm9yIHBhdGhzIHRoZSBwYXR0ZXJuXG4gKiBtYXRjaGVzOlxuICpcbiAqICAgcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjIHdpa2ksbWFya2V0aW5nXG4gKlxuICogQSBzcGFuIHdob3NlIHNsdWcgYmVnaW5zIHdpdGggYHdpa2lgIG9yIGBtYXJrZXRpbmdgICh0aGUgc2x1ZyBlcXVhbHMgdGhlXG4gKiBwcmVmaXgsIG9yIGlzIGA8cHJlZml4Pi9cdTIwMjZgKSBpcyB0aGVuIG5ldmVyIHN1cmZhY2VkIGZvciBhbiBhbmNob3Igd2hvc2UgcGF0aFxuICogc2l0cyB1bmRlciBgcGFja2FnZXMvYWdlbnQtaG9va3Mvc3JjYCBcdTIwMTQgaXQgaXMgbmV2ZXIgc3VyZmFjZWQgaW4gdGhlIGlubGluZVxuICogYDxnaXQtc3Bhbj5gIGJsb2NrIHRoZSBgUG9zdFRvb2xVc2VgIHRvdWNoIGhvb2sgZW1pdHMuIEl0IGhhcyBubyBlZmZlY3Qgb25cbiAqIHRoZSBgUHJlVG9vbFVzZWAgYWR2aXNvciwgd2hvc2Ugb3duIHVuY292ZXJlZC13cml0ZXMgc3VwcHJlc3Npb24gbGl2ZXMgaW5cbiAqIGAuc3Bhbi8uYWR2aXNvcmlnbm9yZWAgKHNlZSBgYWR2aXNvci1pZ25vcmUudHNgKS5cbiAqXG4gKiBQYXR0ZXJuIGdyYW1tYXIgaXMgYSBkZWxpYmVyYXRlIHN1YnNldCBvZiBnaXRpZ25vcmU6XG4gKlxuICogLSBCbGFuayBsaW5lcyBhbmQgbGluZXMgYmVnaW5uaW5nIHdpdGggYCNgIGFyZSBza2lwcGVkLlxuICogLSBBIHRyYWlsaW5nIGAvYCByZXN0cmljdHMgdGhlIHBhdHRlcm4gdG8gZGlyZWN0b3JpZXMgKHRoZSBsZWFmIGZpbGUgaXMgbm90XG4gKiAgIGl0c2VsZiB0ZXN0ZWQsIG9ubHkgaXRzIGFuY2VzdG9yIGRpcmVjdG9yaWVzKS5cbiAqIC0gQSBwYXR0ZXJuIGNvbnRhaW5pbmcgYSBzbGFzaCBpcyBhbmNob3JlZCB0byB0aGUgcmVwbyByb290OyBhIHBhdHRlcm4gd2l0aFxuICogICBubyBzbGFzaCBtYXRjaGVzIGEgc2luZ2xlIHBhdGggY29tcG9uZW50IGF0IGFueSBkZXB0aC5cbiAqIC0gYCpgIGFuZCBgP2AgbWF0Y2ggd2l0aGluIG9uZSBwYXRoIHNlZ21lbnQ7IGAqKmAgbWF0Y2hlcyBhY3Jvc3Mgc2VnbWVudHMuXG4gKiAtIE5lZ2F0aW9uIChgIWApIGlzIG5vdCBzdXBwb3J0ZWQuXG4gKlxuICogU3VwcHJlc3Npb24gaXMgZmFpbC1vcGVuOiBhIG1pc3Npbmcgb3IgdW5yZWFkYWJsZSBgLmhvb2tpZ25vcmVgLCBvciBhXG4gKiBtYWxmb3JtZWQgbGluZSwgeWllbGRzIG5vIHJ1bGUgcmF0aGVyIHRoYW4gaGlkaW5nIHNwYW5zIHRoZSBhdXRob3IgZGlkIG5vdFxuICogYXNrIHRvIGhpZGUuXG4gKi9cblxuaW1wb3J0ICogYXMgZnMgZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuXG5leHBvcnQgaW50ZXJmYWNlIElnbm9yZVJ1bGUge1xuICAvKiogVGhlIHJhdyBnaXRpZ25vcmUtc3R5bGUgcGF0dGVybiwgcmV0YWluZWQgZm9yIGRpYWdub3N0aWNzLiAqL1xuICBwYXR0ZXJuOiBzdHJpbmc7XG4gIC8qKiBTcGFuIHNsdWcgcHJlZml4ZXMgc3VwcHJlc3NlZCBmb3IgcGF0aHMgdGhpcyBydWxlIG1hdGNoZXMuICovXG4gIHByZWZpeGVzOiBzdHJpbmdbXTtcbiAgLyoqIFRydWUgd2hlbiBgcmVwb1JlbFBhdGhgIChQT1NJWCwgcmVwby1yZWxhdGl2ZSkgaXMgZ292ZXJuZWQgYnkgdGhpcyBydWxlLiAqL1xuICBtYXRjaGVzOiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4gYm9vbGVhbjtcbn1cblxuY29uc3QgSE9PS19JR05PUkVfUkVMID0gbm9kZVBhdGguam9pbignLnNwYW4nLCAnLmhvb2tpZ25vcmUnKTtcblxuLyoqXG4gKiBUcmFuc2xhdGUgb25lIGdpdGlnbm9yZS1zdHlsZSBnbG9iIHNlZ21lbnQgaW50byBhbiBhbmNob3JlZCBSZWdFeHAuIGAqYCBhbmRcbiAqIGA/YCBzdGF5IHdpdGhpbiBhIHBhdGggc2VnbWVudDsgYCoqYCAob3B0aW9uYWxseSBmb2xsb3dlZCBieSBgL2ApIHNwYW5zIHRoZW0uXG4gKi9cbmZ1bmN0aW9uIGdsb2JUb1JlZ0V4cChnbG9iOiBzdHJpbmcpOiBSZWdFeHAge1xuICBsZXQgcmUgPSAnJztcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBnbG9iLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYyA9IGdsb2JbaV07XG4gICAgaWYgKGMgPT09ICcqJykge1xuICAgICAgaWYgKGdsb2JbaSArIDFdID09PSAnKicpIHtcbiAgICAgICAgcmUgKz0gJy4qJztcbiAgICAgICAgaSsrO1xuICAgICAgICAvLyBBYnNvcmIgYSBmb2xsb3dpbmcgc2xhc2ggc28gYCoqL2Zvb2AgZG9lcyBub3QgZGVtYW5kIGEgbGl0ZXJhbCBgL2AuXG4gICAgICAgIGlmIChnbG9iW2kgKyAxXSA9PT0gJy8nKSBpKys7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZSArPSAnW14vXSonO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoYyA9PT0gJz8nKSB7XG4gICAgICByZSArPSAnW14vXSc7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlICs9IGMucmVwbGFjZSgvWy4rXiR7fSgpfFtcXF1cXFxcXS9nLCAnXFxcXCQmJyk7XG4gICAgfVxuICB9XG4gIHJldHVybiBuZXcgUmVnRXhwKGBeJHtyZX0kYCk7XG59XG5cbi8qKiBBbmNlc3RvciBwYXRoIGNoYWluOiBgYS9iL2MudHNgIFx1MjE5MiBgWydhJywgJ2EvYicsICdhL2IvYy50cyddYC4gKi9cbmZ1bmN0aW9uIGFuY2VzdG9yUGF0aHMocGF0aDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBwYXJ0cyA9IHBhdGguc3BsaXQoJy8nKTtcbiAgY29uc3Qgb3V0OiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgb3V0LnB1c2gocGFydHMuc2xpY2UoMCwgaSArIDEpLmpvaW4oJy8nKSk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBDb21waWxlIGEgc2luZ2xlIGdpdGlnbm9yZS1zdHlsZSBwYXR0ZXJuICh0aGlzIG1vZHVsZSdzIGdyYW1tYXIgXHUyMDE0IHNlZSB0aGVcbiAqIG1vZHVsZSBkb2MgY29tbWVudCkgaW50byBhIHBhdGggcHJlZGljYXRlLiBBIHBhdHRlcm4gbWF0Y2hlcyBhIGZpbGUgd2hlbiBpdFxuICogbWF0Y2hlcyB0aGUgZmlsZSdzIHBhdGggb3IgYW55IGFuY2VzdG9yIGRpcmVjdG9yeSBvZiBpdCwgc28gYSBkaXJlY3RvcnlcbiAqIHBhdHRlcm4gc3VwcHJlc3NlcyBldmVyeXRoaW5nIGJlbmVhdGggaXQuXG4gKlxuICogRXhwb3J0ZWQgc28gb3RoZXIgcGF0aC1zY29wZWQgaWdub3JlLWZpbGUgY29udmVudGlvbnMgKGUuZy4gYC5hZHZpc29yaWdub3JlYFxuICogaW4gYGFkdmlzb3ItaWdub3JlLnRzYCkgY2FuIHJldXNlIHRoZSBleGFjdCBtYXRjaGluZyBzZW1hbnRpY3MgcmF0aGVyIHRoYW5cbiAqIHJlaW1wbGVtZW50aW5nIHRoZW0uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21waWxlUGF0dGVybihwYXR0ZXJuOiBzdHJpbmcpOiAocmVwb1JlbFBhdGg6IHN0cmluZykgPT4gYm9vbGVhbiB7XG4gIGxldCBwYXQgPSBwYXR0ZXJuO1xuICBsZXQgZGlyT25seSA9IGZhbHNlO1xuICBpZiAocGF0LmVuZHNXaXRoKCcvJykpIHtcbiAgICBkaXJPbmx5ID0gdHJ1ZTtcbiAgICBwYXQgPSBwYXQuc2xpY2UoMCwgLTEpO1xuICB9XG4gIGxldCBhbmNob3JlZCA9IHBhdC5pbmNsdWRlcygnLycpO1xuICBpZiAocGF0LnN0YXJ0c1dpdGgoJy8nKSkge1xuICAgIGFuY2hvcmVkID0gdHJ1ZTtcbiAgICBwYXQgPSBwYXQuc2xpY2UoMSk7XG4gIH1cbiAgY29uc3QgcmUgPSBnbG9iVG9SZWdFeHAocGF0KTtcblxuICByZXR1cm4gKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IHtcbiAgICBpZiAoYW5jaG9yZWQpIHtcbiAgICAgIGNvbnN0IHNlZ3MgPSBhbmNlc3RvclBhdGhzKHJlcG9SZWxQYXRoKTtcbiAgICAgIC8vIEZvciBhIGRpci1vbmx5IHBhdHRlcm4sIG5ldmVyIHRlc3QgdGhlIGxlYWYgZmlsZSBpdHNlbGYuXG4gICAgICBjb25zdCBjYW5kaWRhdGVzID0gZGlyT25seSA/IHNlZ3Muc2xpY2UoMCwgLTEpIDogc2VncztcbiAgICAgIHJldHVybiBjYW5kaWRhdGVzLnNvbWUoKHMpID0+IHJlLnRlc3QocykpO1xuICAgIH1cbiAgICAvLyBVbmFuY2hvcmVkOiBtYXRjaCBhZ2FpbnN0IGluZGl2aWR1YWwgcGF0aCBjb21wb25lbnRzIGF0IGFueSBkZXB0aC5cbiAgICBjb25zdCBjb21wb25lbnRzID0gcmVwb1JlbFBhdGguc3BsaXQoJy8nKTtcbiAgICBjb25zdCBjYW5kaWRhdGVzID0gZGlyT25seSA/IGNvbXBvbmVudHMuc2xpY2UoMCwgLTEpIDogY29tcG9uZW50cztcbiAgICByZXR1cm4gY2FuZGlkYXRlcy5zb21lKChjKSA9PiByZS50ZXN0KGMpKTtcbiAgfTtcbn1cblxuLyoqIFBhcnNlIGAuaG9va2lnbm9yZWAgdGV4dCBpbnRvIHJ1bGVzLCBza2lwcGluZyBjb21tZW50cyBhbmQgbWFsZm9ybWVkIGxpbmVzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlSG9va0lnbm9yZShjb250ZW50OiBzdHJpbmcpOiBJZ25vcmVSdWxlW10ge1xuICBjb25zdCBydWxlczogSWdub3JlUnVsZVtdID0gW107XG4gIGZvciAoY29uc3QgcmF3TGluZSBvZiBjb250ZW50LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IGxpbmUgPSByYXdMaW5lLnRyaW0oKTtcbiAgICBpZiAoIWxpbmUgfHwgbGluZS5zdGFydHNXaXRoKCcjJykpIGNvbnRpbnVlO1xuICAgIC8vIGA8cGF0dGVybj48d2hpdGVzcGFjZT48cHJlZml4ZXM+YCBcdTIwMTQgcGF0dGVybiBpcyB0aGUgZmlyc3QgdG9rZW4sIHByZWZpeGVzXG4gICAgLy8gdGhlIHNlY29uZC4gQSBsaW5lIHdpdGhvdXQgYm90aCBpcyBtYWxmb3JtZWQgYW5kIHNraXBwZWQuXG4gICAgY29uc3QgbWF0Y2ggPSBsaW5lLm1hdGNoKC9eKFxcUyspXFxzKyhcXFMrKSQvKTtcbiAgICBpZiAoIW1hdGNoKSBjb250aW51ZTtcbiAgICBjb25zdCBbLCBwYXR0ZXJuLCBwcmVmaXhlc1Jhd10gPSBtYXRjaDtcbiAgICBjb25zdCBwcmVmaXhlcyA9IHByZWZpeGVzUmF3XG4gICAgICAuc3BsaXQoJywnKVxuICAgICAgLm1hcCgocCkgPT4gcC50cmltKCkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgIGlmIChwcmVmaXhlcy5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgIHJ1bGVzLnB1c2goeyBwYXR0ZXJuLCBwcmVmaXhlcywgbWF0Y2hlczogY29tcGlsZVBhdHRlcm4ocGF0dGVybikgfSk7XG4gIH1cbiAgcmV0dXJuIHJ1bGVzO1xufVxuXG4vKipcbiAqIExvYWQgdGhlIHN1cHByZXNzaW9uIHJ1bGVzIGZvciBhIHJlcG8uIEZhaWwtb3BlbjogYW55IHJlYWQgb3IgcGFyc2UgZmFpbHVyZVxuICogeWllbGRzIGFuIGVtcHR5IHJ1bGUgc2V0LCBzbyBzcGFucyBzdXJmYWNlIGFzIG5vcm1hbCB3aGVuIG5vIGNvbmZpZyBleGlzdHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsb2FkSG9va0lnbm9yZShyZXBvUm9vdDogc3RyaW5nKTogSWdub3JlUnVsZVtdIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKG5vZGVQYXRoLmpvaW4ocmVwb1Jvb3QsIEhPT0tfSUdOT1JFX1JFTCksICd1dGY4Jyk7XG4gICAgcmV0dXJuIHBhcnNlSG9va0lnbm9yZShjb250ZW50KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG59XG5cbi8qKiBBIHNsdWcgY2FycmllcyBhIHByZWZpeCB3aGVuIGl0IGVxdWFscyB0aGUgcHJlZml4IG9yIGlzIGA8cHJlZml4Pi9cdTIwMjZgLiAqL1xuZnVuY3Rpb24gc2x1Z0hhc1ByZWZpeChzbHVnOiBzdHJpbmcsIHByZWZpeDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBzbHVnID09PSBwcmVmaXggfHwgc2x1Zy5zdGFydHNXaXRoKGAke3ByZWZpeH0vYCk7XG59XG5cbi8qKlxuICogVHJ1ZSB3aGVuIGEgc3BhbiBgc2x1Z2Agc2hvdWxkIGJlIHN1cHByZXNzZWQgZm9yIGFuIGFuY2hvciBhdCBgcmVwb1JlbFBhdGhgOlxuICogc29tZSBydWxlIG1hdGNoZXMgdGhlIHBhdGggYW5kIGxpc3RzIGEgcHJlZml4IHRoZSBzbHVnIGNhcnJpZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1NwYW5TdXBwcmVzc2VkKHJ1bGVzOiBJZ25vcmVSdWxlW10sIHJlcG9SZWxQYXRoOiBzdHJpbmcsIHNsdWc6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IHJ1bGUgb2YgcnVsZXMpIHtcbiAgICBpZiAoIXJ1bGUubWF0Y2hlcyhyZXBvUmVsUGF0aCkpIGNvbnRpbnVlO1xuICAgIGlmIChydWxlLnByZWZpeGVzLnNvbWUoKHApID0+IHNsdWdIYXNQcmVmaXgoc2x1ZywgcCkpKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBTaWduYXR1cmUgZm9yIGluamVjdGluZyBhIHJ1bGUgbG9hZGVyIChwcm9kdWN0aW9uIGRlZmF1bHQ6IHtAbGluayBsb2FkSG9va0lnbm9yZX0pLiAqL1xuZXhwb3J0IHR5cGUgSG9va0lnbm9yZUxvYWRlciA9IChyZXBvUm9vdDogc3RyaW5nKSA9PiBJZ25vcmVSdWxlW107XG4iLCAiLyoqXG4gKiBIYXJuZXNzLWFnbm9zdGljIHRvdWNoLWhvb2sgY29yZS5cbiAqXG4gKiBUaGlzIG1vZHVsZSBpbXBsZW1lbnRzIHRoZSBQb3N0VG9vbFVzZSBcInRvdWNoIHNpZ25hbFwiIHRoYXQgYm90aCB0aGUgQ2xhdWRlXG4gKiAoYFJlYWR8RWRpdHxXcml0ZWApIGFuZCBDb2RleCAoYGFwcGx5X3BhdGNoYCkgYWRhcHRlcnMgZHJpdmUuIEl0IGltcG9ydHNcbiAqIG5vdGhpbmcgZnJvbSBlaXRoZXIgaG9vayBTREsgYW5kIGlzIHR5cGVkIHN0cnVjdHVyYWxseSwgcGVyIHRoZSBgY29tbW9uL2BcbiAqIGxheWVyIGNvbnZlbnRpb246IGFkYXB0ZXJzIHRyYW5zbGF0ZSB0aGVpciBTREstc3BlY2lmaWMgaG9vayBpbnB1dCBpbnRvIGFcbiAqIHtAbGluayBUb3VjaElucHV0fSwgaW5qZWN0IGV4ZWN1dGlvbi9zdGF0ZSBkZXBlbmRlbmNpZXMsIGFuZCB3cmFwIHRoZSByZXR1cm5lZFxuICoge0BsaW5rIFRvdWNoT3V0cHV0fSBpbiB0aGVpciBvd24gb3V0cHV0IGJ1aWxkZXIuXG4gKlxuICogUmV1c2VkIGZyb20gdGhlIHNoYXJlZCBrZXJuZWwgKG5vdCByZWRlZmluZWQpOiBgaXNEZWJ0KClgICtcbiAqIGBQb3JjZWxhaW5TdGF0dXNgL2BEcmlmdFBvcmNlbGFpblJvd2AvYFBvcmNlbGFpblJvd2AvYHBhcnNlUG9yY2VsYWluYC9cbiAqIGBwYXJzZURyaWZ0UG9yY2VsYWluYCAoYWdlbnQtaG9va3MtY29tbW9uLnRzKSwgYHJhbmdlc0ludGVyc2VjdGAgYW5kIHRoZVxuICogcmVwby9zcGFuLXJvb3QgcGF0aCB1dGlsaXRpZXMgKGFnZW50LWhvb2tzLWNvbW1vbi50cyksIGFuZCB0aGUgYE1lbW9TdG9yZWBcbiAqIGNhZGVuY2Ugc3RvcmUgKHNwYW4tc3VyZmFjZS50cykuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0IHsgYmFzZW5hbWUsIGpvaW4gfSBmcm9tICdub2RlOnBhdGgnO1xuaW1wb3J0IHtcbiAgdHlwZSBEcmlmdFBvcmNlbGFpblJvdyxcbiAgaHVtYW5TdGF0dXNMYWJlbCxcbiAgaXNEZWJ0LFxuICB0eXBlIExpbmVSYW5nZSxcbiAgdHlwZSBQb3JjZWxhaW5Sb3csXG4gIHR5cGUgUG9yY2VsYWluU3RhdHVzLFxuICBwYXJzZURyaWZ0UG9yY2VsYWluLFxuICBwYXJzZVBvcmNlbGFpbixcbiAgcmFuZ2VzSW50ZXJzZWN0LFxuICByZWxhdGl2ZVRvUmVwbyxcbiAgcmVzb2x2ZVJlcG9Sb290LFxuICByZXNvbHZlU3BhblJvb3Rcbn0gZnJvbSAnLi9hZ2VudC1ob29rcy1jb21tb24uanMnO1xuaW1wb3J0IHsgY29sbGFwc2VCeVBhdGgsIHR5cGUgUmFuZ2VMYWJlbCwgcmVuZGVyQW5jaG9yVHJlZSB9IGZyb20gJy4vYW5jaG9yLXRyZWUuanMnO1xuaW1wb3J0IHR5cGUgeyBNZW1vU3RvcmUgfSBmcm9tICcuL3NwYW4tc3VyZmFjZS5qcyc7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUG9zdC1lZGl0IHJhbmdlIHJlY292ZXJ5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBTcGxpdCB3cml0dGVuIGNvbnRlbnQgaW50byB0aGUgbGluZXMgdG8gbG9jYXRlIG9uIGRpc2suIEEgc2luZ2xlIHRyYWlsaW5nXG4gKiBuZXdsaW5lIGlzIGRyb3BwZWQgc28gYFwiYVxcbmJcXG5cImAgYW5kIGBcImFcXG5iXCJgIGxvY2F0ZSBpZGVudGljYWxseTsgYW4gZW1wdHlcbiAqIChvciBuZXdsaW5lLW9ubHkpIHdyaXRlIGhhcyBubyBsb2NhdGFibGUgYmxvY2suXG4gKi9cbmZ1bmN0aW9uIHRvTmVlZGxlTGluZXMod3JpdHRlbjogc3RyaW5nKTogc3RyaW5nW10ge1xuICBpZiAod3JpdHRlbi5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgY29uc3QgdHJpbW1lZCA9IHdyaXR0ZW4uZW5kc1dpdGgoJ1xcbicpID8gd3JpdHRlbi5zbGljZSgwLCAtMSkgOiB3cml0dGVuO1xuICBpZiAodHJpbW1lZC5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgcmV0dXJuIHRyaW1tZWQuc3BsaXQoJ1xcbicpO1xufVxuXG4vKipcbiAqIFJlY292ZXIgdGhlIGxpbmUgcmFuZ2UgdGhhdCB3cml0dGVuIGNvbnRlbnQgbm93IG9jY3VwaWVzIGluIHRoZSBvbi1kaXNrIGZpbGUsXG4gKiBmb3IgYW5jaG9yaW5nIHRoZSB0b3VjaGVkIHJlZ2lvbiBhZnRlciBhbiBlZGl0IGhhcyBhbHJlYWR5IGFwcGxpZWQuXG4gKlxuICogVGhpcyBnZW5lcmFsaXplcyB0aGUgcHJlLWVkaXQgYGxvY2F0ZUNodW5rKClgIHRlY2huaXF1ZSBpblxuICogW2FwcGx5LXBhdGNoLnRzXSguL3BhY2thZ2VzL2FnZW50LWhvb2tzL3NyYy9jb2RleC9hcHBseS1wYXRjaC50cyNMMjUzLUwyODYpXG4gKiAocHJldmlvdXNseSBDb2RleC1vbmx5KSBpbnRvIGEgc2hhcmVkIHBvc3QtZWRpdCBwcmltaXRpdmUgYm90aCBoYXJuZXNzZXMgdXNlOlxuICogc3BsaXQgYHdyaXR0ZW5gIGFuZCBgb25EaXNrQ29udGVudGAgaW50byBsaW5lcyBhbmQgbG9jYXRlIHRoZSB3cml0dGVuIGJsb2NrIGFzXG4gKiBhIGNvbnRpZ3VvdXMgcnVuIGluc2lkZSB0aGUgb24tZGlzayBsaW5lcy5cbiAqXG4gKiAtIEEgc2luZ2xlIGNvbnRpZ3VvdXMgbWF0Y2ggeWllbGRzIGl0cyAxLWJhc2VkIGluY2x1c2l2ZSB7QGxpbmsgTGluZVJhbmdlfS5cbiAqIC0gV2hlbiB0aGUgYmxvY2sgaXMgYWJzZW50LCBvciBhcHBlYXJzIG1vcmUgdGhhbiBvbmNlIChjb250ZXh0IHRvIGRpc2FtYmlndWF0ZVxuICogICBpcyBub3QgYXZhaWxhYmxlIHBvc3QtZWRpdCksIHJlY292ZXJ5IGlzIGFtYmlndW91cyBhbmQgdGhlIHJlc3VsdCBkZWdyYWRlc1xuICogICB0byBgJ3dob2xlLWZpbGUnYCAodGhlIHNhbWUgZmFsbGJhY2sgYGxvY2F0ZUNodW5rKClgIHNpZ25hbHMgd2l0aCBgbnVsbGApLlxuICpcbiAqIE5ldmVyIHRocm93czogYW4gdW5sb2NhdGFibGUgd3JpdGUgaXMgYSBgJ3dob2xlLWZpbGUnYCBhbnN3ZXIsIG5vdCBhbiBlcnJvci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlY292ZXJSYW5nZSh3cml0dGVuOiBzdHJpbmcsIG9uRGlza0NvbnRlbnQ6IHN0cmluZyk6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyB7XG4gIGNvbnN0IG5lZWRsZSA9IHRvTmVlZGxlTGluZXMod3JpdHRlbik7XG4gIGlmIChuZWVkbGUubGVuZ3RoID09PSAwKSByZXR1cm4gJ3dob2xlLWZpbGUnO1xuXG4gIGNvbnN0IGhheXN0YWNrID0gb25EaXNrQ29udGVudC5zcGxpdCgnXFxuJyk7XG4gIGNvbnN0IGxhc3QgPSBoYXlzdGFjay5sZW5ndGggLSBuZWVkbGUubGVuZ3RoO1xuICBjb25zdCBzdGFydHM6IG51bWJlcltdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDw9IGxhc3Q7IGkrKykge1xuICAgIGxldCBvayA9IHRydWU7XG4gICAgZm9yIChsZXQgaiA9IDA7IGogPCBuZWVkbGUubGVuZ3RoOyBqKyspIHtcbiAgICAgIGlmIChoYXlzdGFja1tpICsgal0gIT09IG5lZWRsZVtqXSkge1xuICAgICAgICBvayA9IGZhbHNlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKG9rKSB7XG4gICAgICBzdGFydHMucHVzaChpKTtcbiAgICAgIGlmIChzdGFydHMubGVuZ3RoID4gMSkgYnJlYWs7IC8vIGR1cGxpY2F0ZWQgXHUyMTkyIGFtYmlndW91cywgc3RvcCBlYXJseVxuICAgIH1cbiAgfVxuXG4gIGlmIChzdGFydHMubGVuZ3RoID09PSAxKSB7XG4gICAgcmV0dXJuIHsgc3RhcnQ6IHN0YXJ0c1swXSArIDEsIGVuZDogc3RhcnRzWzBdICsgbmVlZGxlLmxlbmd0aCB9O1xuICB9XG4gIHJldHVybiAnd2hvbGUtZmlsZSc7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggaW5wdXRcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFdoaWNoIGhhcm5lc3MgZXZlbnQgZmlyZWQsIGFzIHRoZSB0b3VjaCBjb3JlIHNlZXMgaXQuIFRoZSBjb3JlIGJyYW5jaGVzIG9uXG4gKiB0aGlzOiBgd3JpdGVgIGhlYWxzIHBvc2l0aW9uYWwgZHJpZnQgaW4gdGhlIHdvcmtpbmcgdHJlZSBhbmQgbWF5IHN1cmZhY2UgYVxuICogbWVyZ2VkIGJsb2NrOyBgcmVhZGAgbmV2ZXIgbXV0YXRlcyB0aGUgdHJlZSBhbmQgZmlsdGVycyBwb3NpdGlvbmFsIHN0YXR1c2VzXG4gKiBvdXQgb2Ygd2hhdCBpdCBzdXJmYWNlcy5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hFdmVudEtpbmQgPSAncmVhZCcgfCAnd3JpdGUnO1xuXG4vKiogRmllbGRzIHNoYXJlZCBieSBldmVyeSB0b3VjaCwgcmVnYXJkbGVzcyBvZiBraW5kLiAqL1xuaW50ZXJmYWNlIFRvdWNoSW5wdXRCYXNlIHtcbiAgLyoqIEhhcm5lc3Mgc2Vzc2lvbiBpZCBcdTIwMTQga2V5cyB0aGUgcGVyLXNlc3Npb24gY2FkZW5jZSB7QGxpbmsgTWVtb1N0b3JlfS4gKi9cbiAgc2Vzc2lvbklkOiBzdHJpbmc7XG4gIC8qKlxuICAgKiBXb3JraW5nIGRpcmVjdG9yeSB0aGUgdG9vbCByYW4gaW4sIHVzZWQgdG8gYm91bmQgdGhlIHRvdWNoIHRvIHRoZSBDV0QgcmVwb1xuICAgKiB2aWEgYHJlc29sdmVUb3VjaFNjb3BlKClgIGJlZm9yZSBhbnkgc3BhbiBpbnZvY2F0aW9uLlxuICAgKi9cbiAgY3dkOiBzdHJpbmc7XG4gIC8qKiBBYnNvbHV0ZSwgY2Fub25pY2FsaXplZCBwYXRoIG9mIHRoZSB0b3VjaGVkIGZpbGUuICovXG4gIGZpbGVQYXRoOiBzdHJpbmc7XG59XG5cbi8qKiBBIHJlYWQgdG91Y2ggKENsYXVkZSBgUmVhZGAsIG9yIGEgcmVhZC1zaGFwZWQgQ29kZXggZXZlbnQpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaFJlYWRJbnB1dCBleHRlbmRzIFRvdWNoSW5wdXRCYXNlIHtcbiAga2luZDogJ3JlYWQnO1xuICAvKipcbiAgICogMS1iYXNlZCBzdGFydGluZyBsaW5lIG9mIHRoZSByZWFkLCBmcm9tIHRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wncyBgb2Zmc2V0YFxuICAgKiBpbnB1dC4gYHVuZGVmaW5lZGAgd2hlbiB0aGUgcmVhZCBoYWQgbm8gYG9mZnNldGAgKHJlYWRzIGZyb20gbGluZSAxKS5cbiAgICovXG4gIG9mZnNldD86IG51bWJlcjtcbiAgLyoqXG4gICAqIExpbmUgY291bnQgb2YgdGhlIHJlYWQsIGZyb20gdGhlIENsYXVkZSBgUmVhZGAgdG9vbCdzIGBsaW1pdGAgaW5wdXQuXG4gICAqIGB1bmRlZmluZWRgIHdoZW4gdGhlIHJlYWQgaGFkIG5vIGBsaW1pdGAgXHUyMDE0IHNlZSB7QGxpbmsgREVGQVVMVF9SRUFEX0xJTUlUfVxuICAgKiBmb3IgaG93IHRoZSByYW5nZSBpcyBjb21wdXRlZCBpbiB0aGF0IGNhc2UuXG4gICAqL1xuICBsaW1pdD86IG51bWJlcjtcbn1cblxuLyoqIEEgd3JpdGUgdG91Y2ggKENsYXVkZSBgRWRpdGAvYFdyaXRlYCwgQ29kZXggYGFwcGx5X3BhdGNoYCwgb3IgYSB0cmFuc2xhdGVkIEJhc2ggd3JpdGUgc3BhbikuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoV3JpdGVJbnB1dCBleHRlbmRzIFRvdWNoSW5wdXRCYXNlIHtcbiAga2luZDogJ3dyaXRlJztcbiAgLyoqXG4gICAqIFRoZSBjb250ZW50IGp1c3Qgd3JpdHRlbiB0byBgZmlsZVBhdGhgLCBmZWQgdG8ge0BsaW5rIHJlY292ZXJSYW5nZX0gdG9cbiAgICogcmUtYW5jaG9yIHRoZSB0b3VjaGVkIHJlZ2lvbiBhZ2FpbnN0IHRoZSBoZWFsZWQgb24tZGlzayBmaWxlLiBGb3IgYVxuICAgKiB3aG9sZS1maWxlIGNyZWF0ZSB0aGlzIGlzIHRoZSBlbnRpcmUgZmlsZSBib2R5OyBhbiBlbXB0eSBzdHJpbmcgbWVhbnNcbiAgICogXCJubyBsb2NhdGFibGUgYmxvY2tcIiBhbmQgdGhlIHRvdWNoIGlzIHNjb3BlZCBmaWxlLXdpZGUuXG4gICAqL1xuICB3cml0dGVuOiBzdHJpbmc7XG4gIC8qKlxuICAgKiBFeGFjdCBwb3N0LWVkaXQgcmFuZ2Ugd2hlbiBzdGF0aWNhbGx5IGtub3duIChzZWQgLWkgbnVtZXJpYyBhZGRyZXNzZXMsXG4gICAqIHBhdGNoIGh1bmsgdW5pb25zKTsgYnlwYXNzZXMge0BsaW5rIHJlY292ZXJSYW5nZUZyb21EaXNrfSAocGxhbiBcdTAwQTczXG4gICAqIHN0ZXAgMykuXG4gICAqL1xuICByYW5nZT86IExpbmVSYW5nZTtcbiAgLyoqXG4gICAqIFRoZSBmaWxlJ3MgZXhwZWN0ZWQgcG9zdC1jb21tYW5kIHN0YXRlOyB0aGUgd3JpdGUgcGF0aCBnYXRlcyBvbiBpdCBiZWZvcmVcbiAgICogaW52b2tpbmcgYW55IGV4ZWN1dG9yIChwbGFuIFx1MDBBNzMgc3RlcCAxKS4gQWJzZW50IG1lYW5zIGAnZXhpc3RzJ2AgXHUyMDE0IHRoZVxuICAgKiBFZGl0L1dyaXRlIGFuZCBhcHBseV9wYXRjaCBwYXRocycgZGVmYXVsdC5cbiAgICovXG4gIHRhcmdldFN0YXRlPzogJ2V4aXN0cycgfCAnYWJzZW50JztcbiAgLyoqXG4gICAqIFN0YXRpY2FsbHkga25vd2FibGUgZXhwZWN0ZWQgcG9zdC1jb250ZW50LCB2ZXJpZmllZCBiZWZvcmUgYW55IGV4ZWN1dG9yXG4gICAqIGNhbGwgKHBsYW4gXHUwMEE3MyBzdGVwIDFiKS4gYGNvbnRlbnRgIGNvbXBhcmVzIHRoZSBvbi1kaXNrIHN0YXRlIGFmdGVyIHRoZVxuICAgKiBjb21tYW5kIHJhbjsgYHJlYWxEZWxldGVgIGlzIGRlbGV0ZS1vbmx5IFx1MjAxNCB0aGUgcGF0aCBtdXN0IGFsc28gYmVcbiAgICogaW5kZXgtdHJhY2tlZCBvciBzcGFubmVkIChwcm9iZXMgY2FjaGVkIHBlciBjb21tYW5kKS5cbiAgICovXG4gIHBvc3RTdGF0ZT86IHtcbiAgICAvKiogYGV4YWN0YDogZmlsZSBieXRlcyBlcXVhbDsgYHN1ZmZpeGA6IGZpbGUgY29udGVudCBlbmRzIHdpdGggaXQ7IGBlbXB0eWA6IHplcm8gYnl0ZXM7IGBzaXplYDogYnl0ZSBjb3VudC4gKi9cbiAgICBjb250ZW50PzogVG91Y2hQb3N0Q29udGVudDtcbiAgICAvKiogZGVsZXRlLW9ubHk6IHRoZSBwYXRoIG11c3QgYWxzbyBiZSBpbmRleC10cmFja2VkIG9yIHNwYW5uZWQgKHByb2JlcyBjYWNoZWQgcGVyIGNvbW1hbmQpLiAqL1xuICAgIHJlYWxEZWxldGU/OiBib29sZWFuO1xuICB9O1xuICAvKipcbiAgICogY3AvaW5zdGFsbCBkZXN0aW5hdGlvbi12cy1zb3VyY2UgdmVyaWZpY2F0aW9uIChwbGFuIFx1MDBBNzMgc3RlcCAxYik6IGFcbiAgICogc3RpbGwtcHJlc2VudCBzb3VyY2UgbXVzdCBieXRlLWVxdWFsIHRoZSBkZXN0aW5hdGlvbjsgYW4gYWJzZW50IHNvdXJjZVxuICAgKiBhcHBsaWVzIHRoZSBhYnNlbnQtc291cmNlIHJ1bGUgKHJlYWwgKyBhYnNlbmNlIGV4cGxhaW5lZCBieSBhIGxhdGVyXG4gICAqIHNhbWUtcGF0aCBkZWNpc2l2ZVBhc3MgXHUyMDE0IHRoZSBkcml2ZXIncyBwYXNzLUEgaG9sZCkuIFNldCBieSB0aGVcbiAgICogYHJ1bkJhc2hUb3VjaGVzYCBkcml2ZXIgb24gcGFpcmVkIGNwIGNyZWF0ZS1vdmVyd3JpdGUgdG91Y2hlczsgbmV2ZXIgc2V0XG4gICAqIGJ5IGFkYXB0ZXJzLiBgaW5zdGFsbCAtc2AvYC0tc3RyaXBgIGlzIGRlbGliZXJhdGVseSBuZXZlciBwYWlyZWQgXHUyMDE0XG4gICAqIHN0cmlwcGVkIG91dHB1dCBuZXZlciBlcXVhbHMgdGhlIHNvdXJjZSwgc28gaW5zdGFsbCBkZXN0cyBnYXRlXG4gICAqIGV4aXN0ZW5jZS1vbmx5LlxuICAgKi9cbiAgc291cmNlUGF0aD86IHN0cmluZztcbiAgLyoqXG4gICAqIG12L2dpdCBtdi9wYXRjaCByZW5hbWUgc291cmNlIHZlcmlmaWNhdGlvbiAocGxhbiBcdTAwQTczIHN0ZXAgMWMpOiB0aGVcbiAgICogZGVzdGluYXRpb24gZmlyZXMgb25seSB3aGVuIGl0cyBzb3VyY2UgcGFzc2VkIHRoZSBkZWxldGUtcmVhbGl0eSBwcm9iZSBcdTIwMTRcbiAgICogYSBwaGFudG9tIHNvdXJjZSBtZWFucyB0aGUgbW92ZSBmYWlsZWQgYW5kIGEgcHJlLWV4aXN0aW5nIGRlc3RpbmF0aW9uIHdhc1xuICAgKiBuZXZlciB0b3VjaGVkLiBObyBjb250ZW50IGNvbXBhcmlzb24gKHBhdGNoIHJlbmFtZXMgbWF5IGNoYW5nZSBjb250ZW50KS5cbiAgICogU2V0IGJ5IHRoZSBgcnVuQmFzaFRvdWNoZXNgIGRyaXZlciBvbiBwYWlyZWQgcmVuYW1lLWNvcHkgdG91Y2hlcy5cbiAgICovXG4gIHJlbmFtZVNvdXJjZVBhdGg/OiBzdHJpbmc7XG59XG5cbi8qKiBUaGUgaGFybmVzcy1hZ25vc3RpYyB0b3VjaCB0aGUgY29yZSBjb25zdW1lcy4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoSW5wdXQgPSBUb3VjaFJlYWRJbnB1dCB8IFRvdWNoV3JpdGVJbnB1dDtcblxuLyoqXG4gKiBBIHN0YXRpY2FsbHkga25vd2FibGUgZXhwZWN0ZWQgcG9zdC1jb250ZW50IChwbGFuIFx1MDBBNzMgc3RlcCAxYik6IGBleGFjdGAgXHUyMDE0XG4gKiBmaWxlIGJ5dGVzIGVxdWFsOyBgc3VmZml4YCBcdTIwMTQgZmlsZSBjb250ZW50IGVuZHMgd2l0aCBpdDsgYGVtcHR5YCBcdTIwMTQgemVyb1xuICogYnl0ZXM7IGBzaXplYCBcdTIwMTQgYnl0ZSBjb3VudC5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hQb3N0Q29udGVudCA9IHsgZXhhY3Q6IHN0cmluZyB9IHwgeyBzdWZmaXg6IHN0cmluZyB9IHwgeyBlbXB0eTogdHJ1ZSB9IHwgeyBzaXplOiBudW1iZXIgfTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQb3N0LXN0YXRlIHdyaXRlIGdhdGUgKHBsYW4gXHUwMEE3MyBzdGVwIDEpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBUaGUgb3V0Y29tZSBvZiB7QGxpbmsgZXZhbHVhdGVXcml0ZUdhdGV9OiBhIGRlY2lzaXZlIHBhc3MvZmFpbCBjYXJyaWVzXG4gKiB2ZXJkaWN0IHdlaWdodCAoY29udGVudCB2ZXJpZmllZCwgb3IgYWJzZW5jZSArIGRlbGV0ZS1yZWFsaXR5IHZlcmlmaWVkKTtcbiAqIGAnaW5jb25jbHVzaXZlJ2AgaXMgZXZlcnl0aGluZyBlbHNlIFx1MjAxNCB0aGUgZXhpc3RlbmNlLWdhdGVkIGZhbWlsaWVzIChzZWQgLWksXG4gKiBwYXRjaC9naXQgYXBwbHksIGZvcm1hdHRlcnMsIHJlc3RvcmUvY2hlY2tvdXQpIHdob3NlIGV4aXN0ZW5jZSBwYXNzIHByb3Zlc1xuICogbm90aGluZywgYW5kIHByb2JlLWluYXBwbGljYWJsZSBjYXNlcyAocGhhbnRvbSBvciB1bnRyYWNrZWQtdW5zcGFubmVkXG4gKiBkZWxldGVzLCBkaXJlY3RvcnkgdGFyZ2V0cykuIGAncGVuZGluZydgIGlzIHRoZSBkcml2ZXIncyBhYnNlbnQtc291cmNlIGhvbGRcbiAqIChwbGFuIFx1MDBBNzMgc3RlcCAyKTogYW4gYWJzZW50IGNwIHNvdXJjZSB0aGF0IHBhc3NlZCB0aGUgcmVhbGl0eSBwcm9iZSBjYW5ub3RcbiAqIGRlY2lkZSBpdHMgZGVzdGluYXRpb24gdW50aWwgdGhlIHBhc3MtQSBleHBsYW5hdGlvbiBtYXAgaXMgY29tcGxldGUuXG4gKi9cbmV4cG9ydCB0eXBlIFdyaXRlR2F0ZU91dGNvbWUgPSAnZGVjaXNpdmVQYXNzJyB8ICdkZWNpc2l2ZUZhaWwnIHwgJ2luY29uY2x1c2l2ZScgfCAncGVuZGluZyc7XG5cbi8qKlxuICogUGVyLWNvbW1hbmQgZGVsZXRlLXJlYWxpdHkgcHJvYmUgY2FjaGUgKHBsYW4gXHUwMEE3MyBzdGVwIDFjKTogb25lIGBnaXRcbiAqIGxzLWZpbGVzIC0tZXJyb3ItdW5tYXRjaGAgYW5kIG9uZSBgZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbmAgYmF0Y2ggcGVyXG4gKiBjb21tYW5kLCBuZXZlciBvbmUgcGVyIHBhdGgsIG1lbWJlcnNoaXAgZnJvbSBwcmludGVkIHJvd3MuIFRoZVxuICogYHJ1bkJhc2hUb3VjaGVzYCBkcml2ZXIgc2VlZHMgaXQgd2l0aCBldmVyeSBhYnNlbnQgdGFyZ2V0IGFuZCBjcC9pbnN0YWxsXG4gKiBzb3VyY2Ugb2YgdGhlIGNvbXBvdW5kIGFuZCBzaGFyZXMgaXQgaW50byBwYXNzIEIgc28gc3Vydml2aW5nIGRlbGV0ZXNcbiAqIHJlLWdhdGUgd2l0aG91dCByZS1wcm9iaW5nLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFJlYWxpdHlQcm9iZUNhY2hlIHtcbiAgLyoqIERpc3RpbmN0IGFic29sdXRlIHBhdGhzIHRvIHByb2JlLCBpbiBmaXJzdC1zZWVuIG9yZGVyLiAqL1xuICBwYXRoczogc3RyaW5nW107XG4gIC8qKiBMYXp5OiBhYnNvbHV0ZSBwYXRocyBjb25maXJtZWQgaW5kZXgtdHJhY2tlZCBvciBzcGFubmVkLCBjb21wdXRlZCBvbmNlLiAqL1xuICByZWFsUGF0aHM6IFNldDxzdHJpbmc+IHwgbnVsbDtcbn1cblxuLyoqIENyZWF0ZSBhIHBlci1jb21tYW5kIHByb2JlIGNhY2hlIGZvciB0aGUgZ2l2ZW4gYWJzb2x1dGUgcGF0aHMuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlUmVhbGl0eVByb2JlQ2FjaGUocGF0aHM6IEl0ZXJhYmxlPHN0cmluZz4pOiBSZWFsaXR5UHJvYmVDYWNoZSB7XG4gIHJldHVybiB7IHBhdGhzOiBbLi4ubmV3IFNldChwYXRocyldLCByZWFsUGF0aHM6IG51bGwgfTtcbn1cblxuLyoqIFdoZXRoZXIgdGhlIHBhdGggZXhpc3RzIG9uIGRpc2sgKGFueSBub2RlIGtpbmQpOyBgZmFsc2VgIG9uIGFueSBzdGF0IGZhaWx1cmUuICovXG5leHBvcnQgZnVuY3Rpb24gZmlsZUV4aXN0cyhhYnNQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICBmcy5zdGF0U3luYyhhYnNQYXRoKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKiBXaGV0aGVyIHRoZSBwYXRoIGlzIGEgcmVndWxhciBmaWxlIFx1MjAxNCBhIGRpcmVjdG9yeSB0YXJnZXQgZmFpbHMgdGhlIGAnZXhpc3RzJ2AgZ2F0ZS4gKi9cbmZ1bmN0aW9uIGlzRmlsZU9uRGlzayhhYnNQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZnMuc3RhdFN5bmMoYWJzUGF0aCkuaXNGaWxlKCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIFZlcmlmeSBhIHN0YXRpY2FsbHkga25vd2FibGUgcG9zdC1jb250ZW50IGV4cGVjdGF0aW9uIGFnYWluc3QgdGhlIG9uLWRpc2tcbiAqIGZpbGUgKHBsYW4gXHUwMEE3MyBzdGVwIDFiKS4gQW55IHJlYWQgZmFpbHVyZSBpcyBhIG1pc21hdGNoLCBuZXZlciBhbiBlcnJvci5cbiAqL1xuZnVuY3Rpb24gY29udGVudE1hdGNoZXMocG9zdDogVG91Y2hQb3N0Q29udGVudCwgZmlsZVBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIGlmICgnZXhhY3QnIGluIHBvc3QpIHJldHVybiBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgsICd1dGY4JykgPT09IHBvc3QuZXhhY3Q7XG4gICAgaWYgKCdzdWZmaXgnIGluIHBvc3QpIHtcbiAgICAgIC8vIFRoZSBzaGVsbCBhcHBlbmRzIHRoZSBib2R5IHBsdXMgaXRzIHRlcm1pbmF0aW5nIG5ld2xpbmU7IHRoZSBoZXJlZG9jXG4gICAgICAvLyBncmFtbWFyIHN0cmlwcyBleGFjdGx5IHRoYXQgb25lIGBcXG5gIGZyb20gYHNwYW4ud3JpdHRlbmBcbiAgICAgIC8vIChwYXJzZS1jb21tYW5kLnRzIGhlcmVkb2MgYm9keSBleHRyYWN0aW9uKSwgc28gYSBmaWxlIGVuZGluZ1xuICAgICAgLy8gYHdyaXR0ZW5cXG5gIGlzIHRoZSBzYW1lIGFwcGVuZGVkIHRleHQgYXMgYHdyaXR0ZW5gIFx1MjAxNCBhY2NlcHQgYm90aC5cbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgsICd1dGY4Jyk7XG4gICAgICByZXR1cm4gY29udGVudC5lbmRzV2l0aChwb3N0LnN1ZmZpeCkgfHwgY29udGVudC5lbmRzV2l0aChgJHtwb3N0LnN1ZmZpeH1cXG5gKTtcbiAgICB9XG4gICAgaWYgKCdlbXB0eScgaW4gcG9zdCkgcmV0dXJuIGZzLnN0YXRTeW5jKGZpbGVQYXRoKS5zaXplID09PSAwO1xuICAgIHJldHVybiBmcy5zdGF0U3luYyhmaWxlUGF0aCkuc2l6ZSA9PT0gcG9zdC5zaXplO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgZGVsZXRlLXJlYWxpdHkgcHJvYmUgKHBsYW4gXHUwMEE3MyBzdGVwIDFjKTogbGF6aWx5IHJ1biB0aGUgdHdvIHBlci1jb21tYW5kXG4gKiBiYXRjaGVzIGFuZCBjYWNoZSB0aGUgY29uZmlybWVkLXJlYWwgcGF0aCBzZXQuIE1lbWJlcnNoaXAgY29tZXMgZnJvbSB0aGVcbiAqIHByaW50ZWQgcm93cywgbm90IHRoZSBleGl0IGNvZGUgXHUyMDE0IGBnaXQgbHMtZmlsZXMgLS1lcnJvci11bm1hdGNoYCBwcmludHNcbiAqIGV2ZXJ5IHRyYWNrZWQgcGF0aCBldmVuIHdoZW4gaXQgZXhpdHMgbm9uemVybyAoYW55IG1pc3NpbmcgcGF0aCksIGFuZFxuICogYGdpdCBzcGFuIGxpc3QgLS1wb3JjZWxhaW5gIHByaW50cyBub3RoaW5nIGZvciBwaGFudG9tIG9yIGtub3duLWJ1dC1cbiAqIHVuc3Bhbm5lZCBwYXRocyAoZXhpdCAwIHdpdGggXCJObyBzcGFucyBtYXRjaCB0aGUgZmlsdGVyc1wiKS4gQSBwbGFpbi1gcm1gJ2RcbiAqIHRyYWNrZWQgZmlsZSBrZWVwcyBpdHMgaW5kZXggZW50cnkgKGxzLWZpbGVzIGV4aXQgMCBcdTIwMTQgdGhlIHByb2JlIGZpcmVzKTtcbiAqIGBnaXQgcm1gIHJlbW92ZXMgaXQgKGxzLWZpbGVzIDEyOCkgc28gb25seSBzcGFubmVkIGZpbGVzIHN0YXkgcmVhbC4gQVxuICogcGhhbnRvbSBvciB1bnRyYWNrZWQtdW5zcGFubmVkIHBhdGggZmFpbHMgYm90aCBwcm9iZXMgXHUyMDE0IHRoZSBkZWxldGUgZGVncmFkZXNcbiAqIHRvIGAnaW5jb25jbHVzaXZlJ2AgYW5kIG5ldmVyIGZpcmVzLiBGYWlsLXNhZmU6IGFuIHVucmVzb2x2YWJsZSByZXBvIG9yIGFcbiAqIHByb2JlIGZhaWx1cmUgeWllbGRzIGFuIGVtcHR5IHNldCwgbmV2ZXIgYW4gZXJyb3IuXG4gKi9cbmZ1bmN0aW9uIHJlYWxQYXRocyhjYWNoZTogUmVhbGl0eVByb2JlQ2FjaGUsIGN3ZDogc3RyaW5nKTogU2V0PHN0cmluZz4ge1xuICBpZiAoY2FjaGUucmVhbFBhdGhzICE9PSBudWxsKSByZXR1cm4gY2FjaGUucmVhbFBhdGhzO1xuICBjb25zdCByZWFsID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGlmIChjYWNoZS5wYXRocy5sZW5ndGggPiAwKSB7XG4gICAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgICBpZiAocmVwb1Jvb3QgIT09IG51bGwpIHtcbiAgICAgIGNvbnN0IHJlbHMgPSBjYWNoZS5wYXRocy5tYXAoKHApID0+IHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290LCBwKSk7XG4gICAgICBjb25zdCBjYXB0dXJlID0gKGFyZ3M6IHN0cmluZ1tdKTogc3RyaW5nIHwgbnVsbCA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgYXJncywge1xuICAgICAgICAgICAgY3dkOiByZXBvUm9vdCxcbiAgICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgICB0aW1lb3V0OiBERUZBVUxUX1RJTUVPVVRfTVNcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgY29uc3Qgc3Rkb3V0ID0gKGVyciBhcyB7IHN0ZG91dD86IHN0cmluZyB9KS5zdGRvdXQ7XG4gICAgICAgICAgcmV0dXJuIHR5cGVvZiBzdGRvdXQgPT09ICdzdHJpbmcnID8gc3Rkb3V0IDogbnVsbDtcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICAgIGNvbnN0IGxzRmlsZXMgPSBjYXB0dXJlKFsnbHMtZmlsZXMnLCAnLS1lcnJvci11bm1hdGNoJywgJy0tJywgLi4ucmVsc10pO1xuICAgICAgaWYgKGxzRmlsZXMgIT09IG51bGwpIHtcbiAgICAgICAgZm9yIChjb25zdCBsaW5lIG9mIGxzRmlsZXMuc3BsaXQoJ1xcbicpKSB7XG4gICAgICAgICAgY29uc3QgcmVsID0gbGluZS50cmltKCk7XG4gICAgICAgICAgaWYgKHJlbC5sZW5ndGggPiAwKSByZWFsLmFkZChqb2luKHJlcG9Sb290LCByZWwpKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgY29uc3Qgc3Bhbkxpc3QgPSBjYXB0dXJlKFsnc3BhbicsICdsaXN0JywgJy0tcG9yY2VsYWluJywgLi4ucmVsc10pO1xuICAgICAgaWYgKHNwYW5MaXN0ICE9PSBudWxsKSB7XG4gICAgICAgIGZvciAoY29uc3Qgcm93IG9mIHBhcnNlUG9yY2VsYWluKHNwYW5MaXN0KSkgcmVhbC5hZGQoam9pbihyZXBvUm9vdCwgcm93LnBhdGgpKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgY2FjaGUucmVhbFBhdGhzID0gcmVhbDtcbiAgcmV0dXJuIHJlYWw7XG59XG5cbi8qKlxuICogVGhlIGxheWVyZWQgcG9zdC1zdGF0ZSBnYXRlIChwbGFuIFx1MDBBNzMgc3RlcCAxKSwgZXZhbHVhdGVkIGJlZm9yZSBhbnkgZXhlY3V0b3JcbiAqIGNhbGwsIHNpZGUtZWZmZWN0LWZyZWUgKG5vIG1lbW8gd3JpdGVzLCBubyBleGVjdXRvciBjYWxsczsgdGhlIHByb2JlIGlzXG4gKiByZWFkLW9ubHkgYW5kIHBlci1jb21tYW5kIGNhY2hlZCk6XG4gKlxuICogMS4gYHRhcmdldFN0YXRlOiAnYWJzZW50J2AgXHUyMTkyIHRoZSBwYXRoIG11c3QgYmUgYWJzZW50OyB3aGVuIGl0IGlzLCB0aGVcbiAqICAgIGRlbGV0ZS1yZWFsaXR5IHByb2JlIGRlY2lkZXM6IGluZGV4LXRyYWNrZWQgb3Igc3Bhbm5lZCBcdTIxOTIgYGRlY2lzaXZlUGFzc2BcbiAqICAgIChkYW5nbGluZyBhbmNob3JzIHN1cmZhY2UpLCBwaGFudG9tIFx1MjE5MiBgJ2luY29uY2x1c2l2ZSdgIChub3RoaW5nIHRvXG4gKiAgICBzdXJmYWNlIFx1MjAxNCB0aGUgbWlzcyBpcyBoYXJtbGVzcywgYW5kIHRoZSBkZWxldGUgbmV2ZXIgZmlyZXMpLlxuICogMi4gYHRhcmdldFN0YXRlOiAnZXhpc3RzJ2AgXHUyMTkyIHRoZSB0YXJnZXQgbXVzdCBiZSBhIHJlZ3VsYXIgZmlsZSAoYSBkaXJlY3RvcnlcbiAqICAgIG9yIG1pc3NpbmcgdGFyZ2V0IGZhaWxzKS5cbiAqIDMuIENvbnRlbnQgdmVyaWZpY2F0aW9uIHdoZXJlIHRoZSBleHBlY3RlZCBwb3N0LWNvbnRlbnQgaXMgc3RhdGljYWxseVxuICogICAga25vd2FibGUgKGBleGFjdGAvYHN1ZmZpeGAvYGVtcHR5YC9gc2l6ZWApOiBhIG1pc21hdGNoIG1lYW5zIHRoZSB3cml0ZSdzXG4gKiAgICBlZmZlY3QgaXMgYWJzZW50IFx1MjAxNCBubyB0b3VjaC5cbiAqIDQuIGNwIGRlc3RpbmF0aW9uLXZzLXNvdXJjZTogYSBzdGlsbC1wcmVzZW50IHNvdXJjZSBtdXN0IGJ5dGUtZXF1YWwgdGhlXG4gKiAgICBkZXN0aW5hdGlvbjsgYW4gYWJzZW50IHNvdXJjZSBhcHBsaWVzIHRoZSBhYnNlbnQtc291cmNlIHJ1bGUgKHBhc3NlZCB0aGVcbiAqICAgIHJlYWxpdHkgcHJvYmUgQU5EIGl0cyBhYnNlbmNlIGV4cGxhaW5lZCBieSBhIGxhdGVyIHNhbWUtcGF0aFxuICogICAgYGRlY2lzaXZlUGFzc2AgXHUyMDE0IHRoZSBkcml2ZXIgcmVzb2x2ZXMgdGhlIGAncGVuZGluZydgIGhvbGQpLlxuICogNS4gcmVuYW1lLWNvcHk6IHRoZSBkZXN0aW5hdGlvbiBmaXJlcyBvbmx5IHdoZW4gaXRzIHNvdXJjZSBwYXNzZWQgdGhlXG4gKiAgICBkZWxldGUtcmVhbGl0eSBwcm9iZSAoYSBwaGFudG9tIHNvdXJjZSBtZWFucyB0aGUgbW92ZSBmYWlsZWQpLlxuICpcbiAqIEV2ZXJ5dGhpbmcgZWxzZSBcdTIwMTQgdGhlIGV4aXN0ZW5jZS1nYXRlZCBmYW1pbGllcyB3aG9zZSBleGlzdGVuY2UgcGFzcyBwcm92ZXNcbiAqIG5vdGhpbmcgXHUyMDE0IGlzIGAnaW5jb25jbHVzaXZlJ2AuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBldmFsdWF0ZVdyaXRlR2F0ZShpbnB1dDogVG91Y2hXcml0ZUlucHV0LCBwcm9iZUNhY2hlOiBSZWFsaXR5UHJvYmVDYWNoZSk6IFdyaXRlR2F0ZU91dGNvbWUge1xuICBpZiAoaW5wdXQudGFyZ2V0U3RhdGUgPT09ICdhYnNlbnQnKSB7XG4gICAgaWYgKGZpbGVFeGlzdHMoaW5wdXQuZmlsZVBhdGgpKSByZXR1cm4gJ2RlY2lzaXZlRmFpbCc7XG4gICAgcmV0dXJuIHJlYWxQYXRocyhwcm9iZUNhY2hlLCBpbnB1dC5jd2QpLmhhcyhpbnB1dC5maWxlUGF0aCkgPyAnZGVjaXNpdmVQYXNzJyA6ICdpbmNvbmNsdXNpdmUnO1xuICB9XG5cbiAgaWYgKCFpc0ZpbGVPbkRpc2soaW5wdXQuZmlsZVBhdGgpKSByZXR1cm4gJ2RlY2lzaXZlRmFpbCc7XG5cbiAgY29uc3QgY29udGVudCA9IGlucHV0LnBvc3RTdGF0ZT8uY29udGVudDtcbiAgaWYgKGNvbnRlbnQgIT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiBjb250ZW50TWF0Y2hlcyhjb250ZW50LCBpbnB1dC5maWxlUGF0aCkgPyAnZGVjaXNpdmVQYXNzJyA6ICdkZWNpc2l2ZUZhaWwnO1xuICB9XG5cbiAgaWYgKGlucHV0LnNvdXJjZVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgIGlmIChmaWxlRXhpc3RzKGlucHV0LnNvdXJjZVBhdGgpKSB7XG4gICAgICBsZXQgc3JjOiBzdHJpbmc7XG4gICAgICBsZXQgZHN0OiBzdHJpbmc7XG4gICAgICB0cnkge1xuICAgICAgICBzcmMgPSBmcy5yZWFkRmlsZVN5bmMoaW5wdXQuc291cmNlUGF0aCwgJ3V0ZjgnKTtcbiAgICAgICAgZHN0ID0gZnMucmVhZEZpbGVTeW5jKGlucHV0LmZpbGVQYXRoLCAndXRmOCcpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiAnZGVjaXNpdmVGYWlsJztcbiAgICAgIH1cbiAgICAgIHJldHVybiBzcmMgPT09IGRzdCA/ICdkZWNpc2l2ZVBhc3MnIDogJ2RlY2lzaXZlRmFpbCc7XG4gICAgfVxuICAgIC8vIEFic2VudCBzb3VyY2UgXHUyMDE0IHRoZSBhYnNlbnQtc291cmNlIHJ1bGUgKHBsYW4gXHUwMEE3MyBzdGVwIDFiKTogdGhlIGRlc3RcbiAgICAvLyBmaXJlcyBvbmx5IHdoZW4gdGhlIHNvdXJjZSBwYXNzZWQgdGhlIHJlYWxpdHkgcHJvYmUgKGl0IHdhcyBhIHJlYWxcbiAgICAvLyBmaWxlKSBBTkQgaXRzIGFic2VuY2UgaXMgZXhwbGFpbmVkIGJ5IGEgbGF0ZXIgc2FtZS1wYXRoIGRlY2lzaXZlUGFzcy5cbiAgICByZXR1cm4gcmVhbFBhdGhzKHByb2JlQ2FjaGUsIGlucHV0LmN3ZCkuaGFzKGlucHV0LnNvdXJjZVBhdGgpID8gJ3BlbmRpbmcnIDogJ2RlY2lzaXZlRmFpbCc7XG4gIH1cblxuICBpZiAoaW5wdXQucmVuYW1lU291cmNlUGF0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgLy8gTm8gY29udGVudCBjb21wYXJpc29uIFx1MjAxNCBwYXRjaCByZW5hbWVzIG1heSBjaGFuZ2UgY29udGVudDsgYSBwaGFudG9tXG4gICAgLy8gc291cmNlIG1lYW5zIHRoZSBtb3ZlIGZhaWxlZCBhbmQgYSBwcmUtZXhpc3RpbmcgZGVzdGluYXRpb24gd2FzIG5ldmVyXG4gICAgLy8gdG91Y2hlZCAocGxhbiBcdTAwQTczIHN0ZXAgMWMpLlxuICAgIHJldHVybiByZWFsUGF0aHMocHJvYmVDYWNoZSwgaW5wdXQuY3dkKS5oYXMoaW5wdXQucmVuYW1lU291cmNlUGF0aCkgPyAnZGVjaXNpdmVQYXNzJyA6ICdkZWNpc2l2ZUZhaWwnO1xuICB9XG5cbiAgcmV0dXJuICdpbmNvbmNsdXNpdmUnO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEluamVjdGVkIGV4ZWN1dG9yc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBTdHJ1Y3R1cmVkIHJlc3VsdCBvZiBhIHNjb3BlZCBgZ2l0IHNwYW4gZHJpZnQgPGZpbGU+IC0tZml4YC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hGaXhSZXN1bHQge1xuICAvKipcbiAgICogV2hldGhlciBgLS1maXhgIHJlLWFuY2hvcmVkIGF0IGxlYXN0IG9uZSBzcGFuIGluIHRoZSB3b3JraW5nIHRyZWUuIERyaXZlc1xuICAgKiB7QGxpbmsgVG91Y2hPdXRwdXQudHJlZU1vZGlmaWVkfSBzbyBhIGNhbGxlci90ZXN0IGNhbiBhc3NlcnQgdGhlIGhlYWxpbmdcbiAgICogaGFwcGVuZWQgd2l0aG91dCBkaWZmaW5nIHRoZSB0cmVlIGl0c2VsZi5cbiAgICovXG4gIG1vZGlmaWVkOiBib29sZWFuO1xufVxuXG4vKipcbiAqIFJ1biBgZ2l0IHNwYW4gZHJpZnQgPGZpbGU+IC0tZml4YCBzY29wZWQgdG8gdGhlIHRvdWNoZWQgZmlsZSAod3JpdGUgcGF0aFxuICogb25seSksIHJlcG9ydGluZyB3aGV0aGVyIHRoZSB3b3JraW5nIHRyZWUgd2FzIGhlYWxlZC4gQXN5bmMgc28gdGhlIGV2ZW50dWFsXG4gKiBpbXBsZW1lbnRhdGlvbiBhbmQgaXRzIHRlc3RzIGNhbiBpbmplY3QgYSBmYWtlIHdpdGhvdXQgYSByZWFsIHN1YnByb2Nlc3MuXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoRml4RXhlY3V0b3IgPSAoZmlsZVBhdGg6IHN0cmluZywgY3dkOiBzdHJpbmcpID0+IFByb21pc2U8VG91Y2hGaXhSZXN1bHQ+O1xuXG4vKipcbiAqIFJ1biBgZ2l0IHNwYW4gbGlzdCAtLXBvcmNlbGFpbiA8ZmlsZT5gIGFuZCByZXR1cm4gaXRzIHBhcnNlZCByb3dzIFx1MjAxNCBvbmUgcGVyXG4gKiBhbmNob3IgY292ZXJpbmcgdGhlIGZpbGUuIFN0cnVjdHVyZWQgKG5vdCByYXcgc3Rkb3V0KSBzbyB0aGUgbWVyZ2VkLWJsb2NrXG4gKiBjb21wdXRhdGlvbiBhbmQgaXRzIHRlc3RzIHNoYXJlIHRoZSBzYW1lIHNoYXBlLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaExpc3RFeGVjdXRvciA9IChmaWxlUGF0aDogc3RyaW5nLCBjd2Q6IHN0cmluZykgPT4gUHJvbWlzZTxQb3JjZWxhaW5Sb3dbXT47XG5cbi8qKlxuICogUnVuIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW4gPGFyZ3M+YCAoc2NvcGVkIHRvIHRoZSB0b3VjaGVkIGZpbGUgb3JcbiAqIGl0cyBzcGFucykgYW5kIHJldHVybiBpdHMgcGFyc2VkIHJvd3MgXHUyMDE0IG9uZSBwZXIgZHJpZnRlZCBhbmNob3IsIGVtcHR5IHdoZW5cbiAqIGNsZWFuLiBTdGF0dXMgY2xhc3NpZmljYXRpb24gaXMgdmlhIGBpc0RlYnQoKWA7IHBvc2l0aW9uYWwgKGBNT1ZFRGAsXG4gKiBgUkVTT0xWRURfUEVORElOR19DT01NSVRgKSByb3dzIGFyZSBuZXZlciBkZWJ0LlxuICovXG5leHBvcnQgdHlwZSBUb3VjaERyaWZ0RXhlY3V0b3IgPSAoYXJnczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKSA9PiBQcm9taXNlPERyaWZ0UG9yY2VsYWluUm93W10+O1xuXG4vKipcbiAqIFJ1biBiYXJlIGBnaXQgc3BhbiB3aHkgPG5hbWU+YCBhbmQgcmV0dXJuIHRoZSBzcGFuJ3MgcmVjb3JkZWQgd2h5IHNlbnRlbmNlLFxuICogb3IgYG51bGxgIHdoZW4gbm9uZSBpcyByZWNvcmRlZCBvciB0aGUgcmVhZCBmYWlscy4gRmVlZHMgdGhlIGh1bWFuLWZvcm1hdFxuICogc3BhbiByZW5kZXI7IGludm9rZWQgb25seSBmb3Igc3BhbnMgYWN0dWFsbHkgYmVpbmcgc3VyZmFjZWQgdGhpcyB0b3VjaC5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hXaHlFeGVjdXRvciA9IChuYW1lOiBzdHJpbmcsIGN3ZDogc3RyaW5nKSA9PiBQcm9taXNlPHN0cmluZyB8IG51bGw+O1xuXG4vKipcbiAqIFRoZSBpbmplY3RlZCBleGVjdXRpb24gc3VyZmFjZS4gS2VwdCBhcyBmb3VyIG5hcnJvdyBhc3luYyBmdW5jdGlvbnMgKHJhdGhlclxuICogdGhhbiBhIHJhdyBjb21tYW5kIHJ1bm5lcikgc28gdGVzdHMgaW5qZWN0IGZha2VzIHJldHVybmluZyBzdHJ1Y3R1cmVkIGRhdGFcbiAqIGFuZCB0aGUgY29yZSBuZXZlciBzcGF3bnMgYSBzdWJwcm9jZXNzIGl0c2VsZi4gVGhlIGByZWFkYCBwYXRoIG5ldmVyIGludm9rZXNcbiAqIGBmaXhgLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoRXhlY3V0b3JzIHtcbiAgZml4OiBUb3VjaEZpeEV4ZWN1dG9yO1xuICBsaXN0OiBUb3VjaExpc3RFeGVjdXRvcjtcbiAgZHJpZnQ6IFRvdWNoRHJpZnRFeGVjdXRvcjtcbiAgd2h5OiBUb3VjaFdoeUV4ZWN1dG9yO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIG91dHB1dFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBXaGF0IHRoZSBjb3JlIGhhbmRzIGJhY2sgZm9yIHRoZSBhZGFwdGVyIHRvIHRyYW5zbGF0ZSBpbnRvIFNESyBvdXRwdXQuICovXG5leHBvcnQgaW50ZXJmYWNlIFRvdWNoT3V0cHV0IHtcbiAgLyoqXG4gICAqIFRoZSBtZXJnZWQgYDxnaXQtc3Bhbj5gIGJsb2NrIChoZWFkZXIsIG9uZSBodW1hbi1mb3JtYXQgc2VjdGlvbiBwZXJcbiAgICogc3VyZmFjZWQgc3BhbiwgZm9vdGVyKSB0byBpbmplY3QgdmlhIHRoZSBoYXJuZXNzJ3MgYGFkZGl0aW9uYWxDb250ZXh0YCxcbiAgICogb3IgYG51bGxgIHdoZW4gdGhlcmUgaXMgbm90aGluZyB3b3J0aCBzdXJmYWNpbmcgdGhpcyB0b3VjaC5cbiAgICovXG4gIGFkZGl0aW9uYWxDb250ZXh0OiBzdHJpbmcgfCBudWxsO1xuICAvKipcbiAgICogV2hldGhlciB0aGUgd29ya2luZyB0cmVlIHdhcyBtb2RpZmllZCBieSBhIHNjb3BlZCBgLS1maXhgIG9uIHRoZSB3cml0ZSBwYXRoLlxuICAgKiBBbHdheXMgYGZhbHNlYCBvbiB0aGUgcmVhZCBwYXRoIChyZWFkcyBuZXZlciBtdXRhdGUgdGhlIHRyZWUpLlxuICAgKi9cbiAgdHJlZU1vZGlmaWVkOiBib29sZWFuO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE1lcmdlZC1ibG9jayBhc3NlbWJseVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBUaGUgbWVtbyBrZXkgdW5kZXIgd2hpY2ggYSBzcGFuJ3MgcmVuZGVyIGZvciBhIGdpdmVuIGRyaWZ0IHN0YXR1cyBpcyBkZWR1cGVkLiAqL1xuZnVuY3Rpb24gZHJpZnRLZXkobmFtZTogc3RyaW5nLCBzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IHN0cmluZyB7XG4gIC8vIFNwYW4gbmFtZXMgY29tZSBmcm9tIHRhYi1kZWxpbWl0ZWQgcG9yY2VsYWluLCBzbyB0aGV5IG5ldmVyIGNvbnRhaW4gYSB0YWI7XG4gIC8vIGEgdGFiLWpvaW5lZCBrZXkgY2FuIG5ldmVyIGNvbGxpZGUgd2l0aCBhIGJhcmUgc3BhbiBuYW1lICh0aGUgc3VyZmFjaW5nIGtleSkuXG4gIHJldHVybiBgJHtuYW1lfVxcdCR7c3RhdHVzfWA7XG59XG5cbi8qKiBUaGUgYHBhdGgjTHN0YXJ0LUxlbmRgIChvciBiYXJlLXBhdGgsIHdob2xlLWZpbGUpIGFuY2hvciB0ZXh0IGZvciBhIHJvdy4gKi9cbmZ1bmN0aW9uIGFuY2hvclRleHQocm93OiBQb3JjZWxhaW5Sb3cpOiBzdHJpbmcge1xuICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIHJldHVybiByb3cucGF0aDtcbiAgcmV0dXJuIGAke3Jvdy5wYXRofSNMJHtyb3cuc3RhcnR9LUwke3Jvdy5lbmR9YDtcbn1cblxuZnVuY3Rpb24gY2xlYW5IZWFkZXIoZmlsZU5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgJHtmaWxlTmFtZX0gaGFzIGltcGxpY2l0IGRlcGVuZGVuY2llczpgO1xufVxuXG5mdW5jdGlvbiBjbGVhbkZvb3RlcihmaWxlTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGBJZiB5b3UgY2hhbmdlICR7ZmlsZU5hbWV9IGNoZWNrIHRoZSBvdGhlciBmaWxlcyB0byBjb25maXJtIHRoZXkgc3RpbGwgd29yayB0b2dldGhlci5gO1xufVxuXG4vKipcbiAqIFRoZSB3cml0ZSBwYXRoIG5hbWVzIHRoZSBlZGl0IGFzIHRoZSBjYXVzZTsgdGhlIHJlYWQgcGF0aCBvbmx5IHN1cmZhY2VzXG4gKiBwcmUtZXhpc3RpbmcgZHJpZnQgaXQgZGlkbid0IGNyZWF0ZSwgc28gaXQgbmFtZXMgdGhlIGRlcGVuZGVuY3kgaW5zdGVhZC5cbiAqL1xuZnVuY3Rpb24gZHJpZnRIZWFkZXIoZHJpZnRlZENvdW50OiBudW1iZXIsIGtpbmQ6IFRvdWNoSW5wdXRbJ2tpbmQnXSk6IHN0cmluZyB7XG4gIGlmIChraW5kID09PSAnd3JpdGUnKSB7XG4gICAgcmV0dXJuIGRyaWZ0ZWRDb3VudCA9PT0gMVxuICAgICAgPyAnVGhpcyBlZGl0IHB1dCBhbiBpbXBsaWNpdCBkZXBlbmRlbmN5IG91dCBvZiBkYXRlOidcbiAgICAgIDogJ1RoaXMgZWRpdCBwdXQgaW1wbGljaXQgZGVwZW5kZW5jaWVzIG91dCBvZiBkYXRlOic7XG4gIH1cbiAgcmV0dXJuIGRyaWZ0ZWRDb3VudCA9PT0gMVxuICAgID8gJ1RoaXMgZmlsZSBoYXMgYW4gaW1wbGljaXQgZGVwZW5kZW5jeSBvdXQgb2YgZGF0ZTonXG4gICAgOiAnVGhpcyBmaWxlIGhhcyBpbXBsaWNpdCBkZXBlbmRlbmNpZXMgb3V0IG9mIGRhdGU6Jztcbn1cblxuZnVuY3Rpb24gZHJpZnRGb290ZXIoZHJpZnRlZE5hbWVzOiBzdHJpbmdbXSk6IHN0cmluZyB7XG4gIGlmIChkcmlmdGVkTmFtZXMubGVuZ3RoID09PSAxKSB7XG4gICAgY29uc3QgbmFtZSA9IGRyaWZ0ZWROYW1lc1swXTtcbiAgICByZXR1cm4gYFJlc3RvcmUgYWdyZWVtZW50IGJlZm9yZSBjb21taXR0aW5nLiBGb2xsb3cgY29uZmlybWVkIGF1dGhvcml0eS4gUHJlc2VydmUgYW5jaG9yIHNoYXBlOyBpZiBhbiBhZGRyZXNzIGNoYW5nZWQsIHJlbW92ZSBpdHMgb2xkIGFuY2hvciBiZWZvcmUgYWRkaW5nIHRoZSBuZXcgb25lLiBVcGRhdGUgb3IgcmV0aXJlIHRoZSB3aHkgb25seSBpZiBpdHMgbWVhbmluZyBjaGFuZ2VkLiBSZXF1aXJlIFxcYGdpdCBzcGFuIGRyaWZ0ICR7bmFtZX1cXGAgdG8gcmVwb3J0IHplcm8sIHRoZW4gY2hlY2sgdGhlIG90aGVyIGFuY2hvcnMuIENvbmZvcm0gYSBzaWRlIG9ubHkgd2hlbiBjb25maXJtZWQgYXV0aG9yaXR5IG9yIGEgc2F0aXNmaWVkIGdhdGUgZGVjaWRlcyBpdDsgcmVwb3J0IGFtYmlndWl0eSBvciBhbiBvYnNvbGV0ZSBjb3VwbGluZy5gO1xuICB9XG4gIHJldHVybiAnRm9yIGVhY2ggb3V0LW9mLWRhdGUgc3BhbjogcmVzdG9yZSBhZ3JlZW1lbnQgYmVmb3JlIGNvbW1pdHRpbmcuIEZvbGxvdyBjb25maXJtZWQgYXV0aG9yaXR5LiBQcmVzZXJ2ZSBhbmNob3Igc2hhcGU7IGlmIGFuIGFkZHJlc3MgY2hhbmdlZCwgcmVtb3ZlIGl0cyBvbGQgYW5jaG9yIGJlZm9yZSBhZGRpbmcgdGhlIG5ldyBvbmUuIFVwZGF0ZSBvciByZXRpcmUgdGhlIHdoeSBvbmx5IGlmIGl0cyBtZWFuaW5nIGNoYW5nZWQuIFJlcXVpcmUgYGdpdCBzcGFuIGRyaWZ0IDxuYW1lPmAgdG8gcmVwb3J0IHplcm8sIHRoZW4gY2hlY2sgdGhlIG90aGVyIGFuY2hvcnMuIENvbmZvcm0gYSBzaWRlIG9ubHkgd2hlbiBjb25maXJtZWQgYXV0aG9yaXR5IG9yIGEgc2F0aXNmaWVkIGdhdGUgZGVjaWRlcyBpdDsgcmVwb3J0IGFtYmlndWl0eSBvciBhbiBvYnNvbGV0ZSBjb3VwbGluZy4nO1xufVxuXG4vKiogVGhlIHtAbGluayBSYW5nZUxhYmVsfSBmb3IgYSBwb3JjZWxhaW4gcm93IFx1MjAxNCBgMC0wYCBpcyB0aGUgd2hvbGUtZmlsZSBhbmNob3IuICovXG5mdW5jdGlvbiByYW5nZUxhYmVsKHJvdzogUG9yY2VsYWluUm93KTogUmFuZ2VMYWJlbCB7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHsga2luZDogJ3dob2xlLWZpbGUnIH07XG4gIHJldHVybiB7IGtpbmQ6ICdyYW5nZScsIHN0YXJ0OiByb3cuc3RhcnQsIGVuZDogcm93LmVuZCB9O1xufVxuXG4vKipcbiAqIEEgc3BhbidzIGZ1bGwgYW5jaG9yIGxpc3QsIHJlbmRlcmVkIGFzIGEgc2hhcmVkLXByZWZpeCB0cmVlIGJ5XG4gKiB7QGxpbmsgcmVuZGVyQW5jaG9yVHJlZX0sIHdpdGggZWFjaCBhbmNob3IgdGhhdCBjYXJyaWVzIGdlbnVpbmUgZHJpZnRcbiAqIHN1ZmZpeGVkIGJ5IGl0cyBsb3dlcmNhc2Ugc3RhdHVzIHRva2VuKHMpIChgIFx1MjAxNCBjaGFuZ2VkYCkuXG4gKlxuICogQSBkcmlmdCByb3cgbWF0Y2hlcyBhbiBhbmNob3IgYnkgZXhhY3QgcGF0aCtyYW5nZSwgb3IgYnkgcGF0aCBhbG9uZSB3aGVuIHRoZVxuICogc3BhbiBoYXMgYSBzaW5nbGUgYW5jaG9yIG9uIHRoYXQgcGF0aCAocmFuZ2VzIGNhbiBkaXNhZ3JlZSBhZnRlciBhIGhlYWwpLlxuICogYHNvbGVPblBhdGhgIGlzIGRlbGliZXJhdGVseSBjb21wdXRlZCBvdmVyIHRoZSAqKmZ1bGwgZmxhdCBhbmNob3IgbGlzdCoqLFxuICogYmVmb3JlIGFueSBncm91cGluZyBcdTIwMTQgdGhlIHRyZWUgbGF5b3V0IG11c3QgbmV2ZXIgYmUgYWJsZSB0byBjaGFuZ2UgKndoaWNoKlxuICogYW5jaG9ycyBnZXQgbGFiZWxlZCwgb25seSB3aGVyZSB0aGV5IHNpdCBvbiB0aGUgcGFnZS5cbiAqL1xuZnVuY3Rpb24gYW5jaG9yQnVsbGV0cyhhbmNob3JzOiBQb3JjZWxhaW5Sb3dbXSwgZGVidFJvd3M6IERyaWZ0UG9yY2VsYWluUm93W10pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHJvd3MgPSBhbmNob3JzLm1hcCgoYW5jaG9yKSA9PiB7XG4gICAgY29uc3Qgc29sZU9uUGF0aCA9IGFuY2hvcnMuZmlsdGVyKChhKSA9PiBhLnBhdGggPT09IGFuY2hvci5wYXRoKS5sZW5ndGggPT09IDE7XG4gICAgY29uc3Qgc3RhdHVzZXMgPSBuZXcgU2V0PFBvcmNlbGFpblN0YXR1cz4oKTtcbiAgICBmb3IgKGNvbnN0IHJvdyBvZiBkZWJ0Um93cykge1xuICAgICAgaWYgKHJvdy5wYXRoICE9PSBhbmNob3IucGF0aCkgY29udGludWU7XG4gICAgICBpZiAoc29sZU9uUGF0aCB8fCAocm93LnN0YXJ0ID09PSBhbmNob3Iuc3RhcnQgJiYgcm93LmVuZCA9PT0gYW5jaG9yLmVuZCkpIHtcbiAgICAgICAgc3RhdHVzZXMuYWRkKHJvdy5zdGF0dXMpO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBzb3J0ZWQgPSBbLi4uc3RhdHVzZXNdLnNvcnQoKTtcbiAgICBjb25zdCBzdWZmaXggPSBzb3J0ZWQubGVuZ3RoID4gMCA/IGAgXHUyMDE0ICR7c29ydGVkLm1hcChodW1hblN0YXR1c0xhYmVsKS5qb2luKCcsICcpfWAgOiAnJztcbiAgICByZXR1cm4geyBwYXRoOiBhbmNob3IucGF0aCwgcmFuZ2U6IHJhbmdlTGFiZWwoYW5jaG9yKSwgc3VmZml4IH07XG4gIH0pO1xuICB0cnkge1xuICAgIHJldHVybiByZW5kZXJBbmNob3JUcmVlKGNvbGxhcHNlQnlQYXRoKHJvd3MpKTtcbiAgfSBjYXRjaCB7XG4gICAgLy8gRkFJTC1DTE9TRUQsIG5vdCBhIGA8Z3JlZW5maWVsZD5gLWZvcmJpZGRlbiBmYWxsYmFjayBcdTIwMTQgZG8gbm90IHJlbW92ZSBpdFxuICAgIC8vIG9uIHRoZSB0aGVvcnkgdGhhdCBhIGRlZ3JhZGVkIGZhbGxiYWNrIGlzIGl0c2VsZiBmb3JiaWRkZW4uIEFuIHVuY2F1Z2h0XG4gICAgLy8gdGhyb3cgaGVyZSBkb2VzIG5vdCBkZWdyYWRlIHRvIGEgZmxhdCBsaXN0OiBpdCBlc2NhcGVzIHRvXG4gICAgLy8gYHJ1blRvdWNoSG9va2AncyBjYXRjaCwgd2hpY2ggcmVzb2x2ZXMgdGhlIHdob2xlIGhvb2sgdG9cbiAgICAvLyBgYWRkaXRpb25hbENvbnRleHQ6IG51bGxgLCBzbyB0aGUgYWdlbnQgaXMgbmV2ZXIgdG9sZCBhYm91dCB0aGUgZHJpZnQgYXRcbiAgICAvLyBhbGwuIENhdGNoaW5nIGxvY2FsbHkgbmFycm93cyB3aGF0IGEgcmVuZGVyaW5nIGRlZmVjdCBjYW4gY29zdCBmcm9tIFwidGhlXG4gICAgLy8gcmVtaW5kZXIgZGlzYXBwZWFyc1wiIHRvIFwidGhlIHJlbWluZGVyIGxvb2tzIGxpa2UgaXQgZGlkIGJlZm9yZSB0aGUgdHJlZVwiLlxuICAgIC8vIFdoZXRoZXIgdG8gc3VyZmFjZSBhbmQgd2hhdCBzaGFwZSB0byBzdXJmYWNlIGluIGFyZSBkaWZmZXJlbnQgdGhpbmdzLCBhbmRcbiAgICAvLyB0aGlzIGNhdGNoIG9ubHkgZXZlciB0b3VjaGVzIHRoZSBsYXR0ZXIuXG4gICAgLy8gYHJvd3NgIGlzIGluZGV4LWFsaWduZWQgd2l0aCBgYW5jaG9yc2AsIHNvIHRoaXMgcmVwcm9kdWNlcyB0b2RheSdzIGZsYXRcbiAgICAvLyBidWxsZXQgcnVuIGJ5dGUgZm9yIGJ5dGUsIHN1ZmZpeGVzIGluY2x1ZGVkLlxuICAgIHJldHVybiBhbmNob3JzLm1hcCgoYW5jaG9yLCBpKSA9PiBgLSAke2FuY2hvclRleHQoYW5jaG9yKX0ke3Jvd3NbaV0uc3VmZml4fWApO1xuICB9XG59XG5cbi8qKlxuICogT25lIGh1bWFuLWZvcm1hdCBzcGFuIHNlY3Rpb246IGAjIyA8bmFtZT5gLCB0aGUgZnVsbCBhbmNob3IgbGlzdCAoZHJpZnRlZFxuICogYW5jaG9ycyBzdGF0dXMtc3VmZml4ZWQpLCBhbmQgdGhlIHdoeSBzZW50ZW5jZSB3aGVuIG9uZSBpcyByZWNvcmRlZC5cbiAqXG4gKiBUaGUgbmFtZSBoZWFkZXIgYW5kIHRoZSB3aHkgc2VudGVuY2UgYXJlIHRoZSBzYW1lIHNoYXBlIGBnaXQgc3BhbiBsaXN0YFxuICogcmVuZGVyczsgdGhlIGFuY2hvciBsaXN0IGRlbGliZXJhdGVseSBpcyBub3QgXHUyMDE0IGl0IHJlbmRlcnMgYXMgYSBzaGFyZWQtcHJlZml4XG4gKiB0cmVlICh7QGxpbmsgYW5jaG9yQnVsbGV0c30pIHdoZXJlIHRoZSBDTEkgcHJpbnRzIGEgZmxhdCBgLSBwYXRoI0xyYW5nZWBcbiAqIGJ1bGxldCBydW4uIFRoZSBDTEkncyBvd24gdGV4dCBmb3JtYXQgaXMgdW50b3VjaGVkOyBvbmx5IHRoaXMgaG9vaydzXG4gKiByZS1wcmVzZW50YXRpb24gb2YgaXQgZ3JvdXBzLlxuICovXG5mdW5jdGlvbiByZW5kZXJTcGFuU2VjdGlvbihcbiAgbmFtZTogc3RyaW5nLFxuICBhbmNob3JzOiBQb3JjZWxhaW5Sb3dbXSxcbiAgZGVidFJvd3M6IERyaWZ0UG9yY2VsYWluUm93W10sXG4gIHdoeTogc3RyaW5nIHwgbnVsbFxuKTogc3RyaW5nIHtcbiAgY29uc3QgbGluZXMgPSBbYCMjICR7bmFtZX1gLCAuLi5hbmNob3JCdWxsZXRzKGFuY2hvcnMsIGRlYnRSb3dzKV07XG4gIGlmICh3aHkpIGxpbmVzLnB1c2goJycsIHdoeSk7XG4gIHJldHVybiBsaW5lcy5qb2luKCdcXG4nKTtcbn1cblxuLyoqXG4gKiBBc3NlbWJsZSB0aGUgbWVyZ2VkIGA8Z2l0LXNwYW4+YCBibG9jazogaGVhZGVyLCBvbmUgc2VjdGlvbiBwZXIgc3VyZmFjZWRcbiAqIHNwYW4gKHNlcGFyYXRlZCBieSBgLS0tYCksIGFuZCBhIHNpbmdsZSBmb290ZXIgYWZ0ZXIgYSBmaW5hbCBgLS0tYC5cbiAqL1xuZnVuY3Rpb24gYnVpbGRCbG9jayhzZWN0aW9uczogc3RyaW5nW10sIGhlYWRlcjogc3RyaW5nLCBmb290ZXI6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGJvZHkgPSBgJHtoZWFkZXJ9XFxuXFxuJHtzZWN0aW9ucy5qb2luKCdcXG5cXG4tLS1cXG5cXG4nKX1cXG5cXG4tLS1cXG5cXG4ke2Zvb3Rlcn1gO1xuICByZXR1cm4gYFxcbjxnaXQtc3Bhbj5cXG4ke2JvZHl9XFxuPC9naXQtc3Bhbj5cXG5gO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIGhvb2sgZW50cnkgcG9pbnRcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogV2hldGhlciBhIGNvdmVyaW5nIHJvdyBpcyBpbiBzY29wZSBmb3IgdGhlIHJlY292ZXJlZCByYW5nZS4gKi9cbmZ1bmN0aW9uIGludGVyc2VjdHMocm93OiBQb3JjZWxhaW5Sb3csIHJhbmdlOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScpOiBib29sZWFuIHtcbiAgaWYgKHJhbmdlID09PSAnd2hvbGUtZmlsZScpIHJldHVybiB0cnVlO1xuICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIHJldHVybiB0cnVlOyAvLyB3aG9sZS1maWxlIGFuY2hvclxuICByZXR1cm4gcmFuZ2VzSW50ZXJzZWN0KHJhbmdlLCB7IHN0YXJ0OiByb3cuc3RhcnQsIGVuZDogcm93LmVuZCB9KTtcbn1cblxuLyoqXG4gKiBSZWNvdmVyIHRoZSB0b3VjaGVkIHJhbmdlIGZyb20gdGhlIG9uLWRpc2sgZmlsZSBmb3IgYSB3cml0ZS4gQW4gZW1wdHkgd3JpdGUgb3JcbiAqIGFuIHVucmVhZGFibGUgZmlsZSAoZS5nLiBhIGRlbGV0ZSwgb3IgdGhlIGZpbGUgd2FzIG5ldmVyIHdyaXR0ZW4pIGRlZ3JhZGVzIHRvXG4gKiBgJ3dob2xlLWZpbGUnYCwgc2NvcGluZyB0aGUgdG91Y2ggdG8gZXZlcnkgY292ZXJpbmcgc3BhbiBcdTIwMTQgdGhlIGZhaWwtb3BlblxuICogYmVoYXZpb3IsIG5vdCBhbiBlcnJvci5cbiAqL1xuZnVuY3Rpb24gcmVjb3ZlclJhbmdlRnJvbURpc2sod3JpdHRlbjogc3RyaW5nLCBmaWxlUGF0aDogc3RyaW5nKTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnIHtcbiAgaWYgKHdyaXR0ZW4ubGVuZ3RoID09PSAwKSByZXR1cm4gJ3dob2xlLWZpbGUnO1xuICBsZXQgY29udGVudDogc3RyaW5nO1xuICB0cnkge1xuICAgIGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgsICd1dGY4Jyk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIH1cbiAgcmV0dXJuIHJlY292ZXJSYW5nZSh3cml0dGVuLCBjb250ZW50KTtcbn1cblxuLyoqXG4gKiBUaGUgQ2xhdWRlIGBSZWFkYCB0b29sJ3MgZG9jdW1lbnRlZCBkZWZhdWx0IGxpbmUgY291bnQgd2hlbiBgb2Zmc2V0YCBpc1xuICogZ2l2ZW4gd2l0aG91dCBgbGltaXRgIChcIkJ5IGRlZmF1bHQsIGl0IHJlYWRzIHVwIHRvIDIwMDAgbGluZXNcIikuIE5hbWVkIHNvXG4gKiB0aGUgYXNzdW1wdGlvbiBpcyB2aXNpYmxlIGFuZCBlYXN5IHRvIHVwZGF0ZSBpZiB0aGF0IGRlZmF1bHQgZXZlciBjaGFuZ2VzLlxuICovXG5leHBvcnQgY29uc3QgREVGQVVMVF9SRUFEX0xJTUlUID0gMjAwMDtcblxuLyoqXG4gKiBDb21wdXRlIHRoZSB0b3VjaGVkIHJhbmdlIGZvciBhIHJlYWQgZnJvbSB0aGUgQ2xhdWRlIGBSZWFkYCB0b29sJ3NcbiAqIGBvZmZzZXRgL2BsaW1pdGAgaW5wdXRzLiBOZWl0aGVyIHByZXNlbnQgbWVhbnMgYSBnZW51aW5lIHdob2xlLWZpbGUgcmVhZCBcdTIwMTRcbiAqIGV2ZXJ5IGNvdmVyaW5nIHNwYW4gc3RheXMgaW4gc2NvcGUsIG1hdGNoaW5nIHRvZGF5J3MgYmVoYXZpb3IuIE90aGVyd2lzZVxuICogdGhlIHJhbmdlIHN0YXJ0cyBhdCBgb2Zmc2V0YCAoZGVmYXVsdCBsaW5lIDEpIGFuZCBydW5zIGZvciBgbGltaXRgIGxpbmVzXG4gKiAoZGVmYXVsdCB7QGxpbmsgREVGQVVMVF9SRUFEX0xJTUlUfSksIGNsYW1wZWQgdG8gdGhlIGZpbGUncyBhY3R1YWwgbGluZVxuICogY291bnQgc28gYSBzaG9ydCBmaWxlIHdpdGggYSBsYXJnZSBgb2Zmc2V0YC9gbGltaXRgIGRvZXNuJ3Qgb3ZlcnNob290LlxuICogQ2xhbXBpbmcgcmVxdWlyZXMgcmVhZGluZyB0aGUgZmlsZTsgYW4gdW5yZWFkYWJsZSBmaWxlIGRlZ3JhZGVzIHRvXG4gKiBgJ3dob2xlLWZpbGUnYCBcdTIwMTQgdGhlIHNhbWUgZmFpbC1vcGVuIGJlaGF2aW9yIHRoZSB3cml0ZSBwYXRoIHVzZXMuXG4gKi9cbmZ1bmN0aW9uIHJlY292ZXJSZWFkUmFuZ2UoXG4gIG9mZnNldDogbnVtYmVyIHwgdW5kZWZpbmVkLFxuICBsaW1pdDogbnVtYmVyIHwgdW5kZWZpbmVkLFxuICBmaWxlUGF0aDogc3RyaW5nXG4pOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScge1xuICBpZiAob2Zmc2V0ID09PSB1bmRlZmluZWQgJiYgbGltaXQgPT09IHVuZGVmaW5lZCkgcmV0dXJuICd3aG9sZS1maWxlJztcbiAgY29uc3Qgc3RhcnQgPSBvZmZzZXQgPz8gMTtcbiAgbGV0IGxpbmVDb3VudDogbnVtYmVyO1xuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgsICd1dGY4Jyk7XG4gICAgbGluZUNvdW50ID0gY29udGVudC5sZW5ndGggPT09IDAgPyAwIDogY29udGVudC5zcGxpdCgnXFxuJykubGVuZ3RoO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gJ3dob2xlLWZpbGUnO1xuICB9XG4gIGNvbnN0IGVuZCA9IE1hdGgubWluKHN0YXJ0ICsgKGxpbWl0ID8/IERFRkFVTFRfUkVBRF9MSU1JVCkgLSAxLCBNYXRoLm1heChsaW5lQ291bnQsIHN0YXJ0KSk7XG4gIHJldHVybiB7IHN0YXJ0LCBlbmQgfTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGEgY292ZXJpbmcgcm93IGlzIGFuIGFuY2hvciBpbiB0aGUgdG91Y2hlZCBmaWxlIGl0c2VsZi4gYGxpc3RcbiAqIC0tcG9yY2VsYWluIDxmaWxlPmAgcmV0dXJucyBldmVyeSBhbmNob3Igb2YgZWFjaCBtYXRjaGluZyBzcGFuIFx1MjAxNCBjcm9zcy1maWxlXG4gKiBhbmNob3JzIGluY2x1ZGVkIFx1MjAxNCBidXQgb25seSBhbmNob3JzIGluIHRoZSB0b3VjaGVkIGZpbGUgcGFydGljaXBhdGUgaW4gdGhlXG4gKiByYW5nZS1pbnRlcnNlY3Rpb24gc2NvcGUgdGVzdC4gUm93IHBhdGhzIGFyZSByZXBvLXJlbGF0aXZlOyB0aGUgdG91Y2hlZCBwYXRoXG4gKiBpcyBhYnNvbHV0ZSwgc28gbWF0Y2ggb24gYW4gZXhhY3Qgb3IgYC9gLXNlcGFyYXRlZCBzdWZmaXguXG4gKi9cbmZ1bmN0aW9uIG9uVG91Y2hlZEZpbGUocm93OiBQb3JjZWxhaW5Sb3csIGZpbGVQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIGZpbGVQYXRoID09PSByb3cucGF0aCB8fCBmaWxlUGF0aC5lbmRzV2l0aChgLyR7cm93LnBhdGh9YCk7XG59XG5cbi8qKlxuICogQ29tcHV0ZSB0aGUgbWVyZ2VkIGA8Z2l0LXNwYW4+YCBibG9jayBmb3IgdGhlIHRvdWNoLCBvciBgbnVsbGAgd2hlbiB0aGVyZSBpc1xuICogbm90aGluZyB3b3J0aCBzdXJmYWNpbmcuIFNoYXJlZCBieSBib3RoIHBhdGhzOyB0aGUgd3JpdGUgcGF0aCBwYXNzZXMgYVxuICogcmVjb3ZlcmVkIHJhbmdlIGZvciBwcmVjaXNpb24sIHRoZSByZWFkIHBhdGggc2NvcGVzIGZpbGUtd2lkZS5cbiAqXG4gKiBBIHNwYW4gcmVuZGVycyBhcyBhIGZ1bGwgaHVtYW4tZm9ybWF0IHNlY3Rpb24gKG5hbWUsIGFsbCBhbmNob3JzIHdpdGhcbiAqIGRyaWZ0ZWQgb25lcyBzdGF0dXMtc3VmZml4ZWQsIHdoeSkgd2hlbiBpdHMgbmFtZSBoYXMgbm90IGJlZW4gc3VyZmFjZWQgdGhpc1xuICogc2Vzc2lvbiwgb3Igd2hlbiBpdCBjYXJyaWVzIGEgZHJpZnQgc3RhdHVzIG5vdCB5ZXQgc3VyZmFjZWQgZm9yIGl0IFx1MjAxNCBzbyBhXG4gKiBzcGFuIGZpcnN0IHNlZW4gaGVhbHRoeSByZS1yZW5kZXJzIGluIGZ1bGwgd2hlbiBkcmlmdCBsYXRlciBhcHBlYXJzLiBBIHNwYW5cbiAqIHdob3NlIG9ubHkgZHJpZnQgaXMgcG9zaXRpb25hbCAoYE1PVkVEYC9gUkVTT0xWRURfUEVORElOR19DT01NSVRgIFx1MjAxNCBuZXZlclxuICogYGlzRGVidGApIGlzIGZpbHRlcmVkIG91dCBlbnRpcmVseTogcG9zaXRpb25hbCBkcmlmdCBuZXZlciBzdXJmYWNlcy5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gY29tcHV0ZVN1cmZhY2UoXG4gIGlucHV0OiBUb3VjaElucHV0LFxuICBleGVjdXRvcnM6IFRvdWNoRXhlY3V0b3JzLFxuICBtZW1vOiBNZW1vU3RvcmUsXG4gIHJhbmdlOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZSdcbik6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICBjb25zdCBjb3ZlcmluZyA9IGF3YWl0IGV4ZWN1dG9ycy5saXN0KGlucHV0LmZpbGVQYXRoLCBpbnB1dC5jd2QpO1xuICBpZiAoY292ZXJpbmcubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAvLyBHcm91cCBldmVyeSBhbmNob3IgYnkgc3BhbjsgYSBzcGFuIGlzIGluIHNjb3BlIHdoZW4gb25lIG9mIGl0cyBhbmNob3JzIG9uXG4gIC8vIHRoZSB0b3VjaGVkIGZpbGUgaW50ZXJzZWN0cyB0aGUgcmVjb3ZlcmVkIHJhbmdlLlxuICBjb25zdCBhbmNob3JzQnlOYW1lID0gbmV3IE1hcDxzdHJpbmcsIFBvcmNlbGFpblJvd1tdPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiBjb3ZlcmluZykge1xuICAgIGNvbnN0IHJvd3MgPSBhbmNob3JzQnlOYW1lLmdldChyb3cubmFtZSkgPz8gW107XG4gICAgcm93cy5wdXNoKHJvdyk7XG4gICAgYW5jaG9yc0J5TmFtZS5zZXQocm93Lm5hbWUsIHJvd3MpO1xuICB9XG4gIGNvbnN0IHRvdWNoZWROYW1lcyA9IFsuLi5hbmNob3JzQnlOYW1lLmtleXMoKV0uZmlsdGVyKChuYW1lKSA9PlxuICAgIChhbmNob3JzQnlOYW1lLmdldChuYW1lKSA/PyBbXSkuc29tZSgocm93KSA9PiBvblRvdWNoZWRGaWxlKHJvdywgaW5wdXQuZmlsZVBhdGgpICYmIGludGVyc2VjdHMocm93LCByYW5nZSkpXG4gICk7XG4gIGlmICh0b3VjaGVkTmFtZXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBkcmlmdFJvd3MgPSBhd2FpdCBleGVjdXRvcnMuZHJpZnQoW2lucHV0LmZpbGVQYXRoXSwgaW5wdXQuY3dkKTtcbiAgY29uc3QgZHJpZnRCeU5hbWUgPSBuZXcgTWFwPHN0cmluZywgRHJpZnRQb3JjZWxhaW5Sb3dbXT4oKTtcbiAgZm9yIChjb25zdCByb3cgb2YgZHJpZnRSb3dzKSB7XG4gICAgY29uc3Qgcm93cyA9IGRyaWZ0QnlOYW1lLmdldChyb3cubmFtZSkgPz8gW107XG4gICAgcm93cy5wdXNoKHJvdyk7XG4gICAgZHJpZnRCeU5hbWUuc2V0KHJvdy5uYW1lLCByb3dzKTtcbiAgfVxuXG4gIGNvbnN0IHN1cmZhY2VkID0gbWVtby5nZXRTdXJmYWNlZChpbnB1dC5zZXNzaW9uSWQpO1xuICBjb25zdCB0b1JlY29yZDogc3RyaW5nW10gPSBbXTtcbiAgY29uc3Qgc2VjdGlvbnM6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGRyaWZ0ZWROYW1lczogc3RyaW5nW10gPSBbXTtcblxuICBmb3IgKGNvbnN0IG5hbWUgb2YgdG91Y2hlZE5hbWVzKSB7XG4gICAgY29uc3Qgc3BhbkRyaWZ0ID0gZHJpZnRCeU5hbWUuZ2V0KG5hbWUpID8/IFtdO1xuICAgIGNvbnN0IGRlYnRSb3dzID0gc3BhbkRyaWZ0LmZpbHRlcigocm93KSA9PiBpc0RlYnQocm93LnN0YXR1cykpO1xuICAgIGlmIChzcGFuRHJpZnQubGVuZ3RoID4gMCAmJiBkZWJ0Um93cy5sZW5ndGggPT09IDApIGNvbnRpbnVlOyAvLyBwb3NpdGlvbmFsLW9ubHkgZHJpZnQgbmV2ZXIgc3VyZmFjZXNcblxuICAgIGNvbnN0IGRlYnRTdGF0dXNlcyA9IFsuLi5uZXcgU2V0KGRlYnRSb3dzLm1hcCgocm93KSA9PiByb3cuc3RhdHVzKSldLnNvcnQoKTtcbiAgICBjb25zdCB1bnN1cmZhY2VkRGVidCA9IGRlYnRTdGF0dXNlcy5maWx0ZXIoKHN0YXR1cykgPT4gIXN1cmZhY2VkLmhhcyhkcmlmdEtleShuYW1lLCBzdGF0dXMpKSk7XG4gICAgY29uc3QgaXNOZXdOYW1lID0gIXN1cmZhY2VkLmhhcyhuYW1lKTtcbiAgICBpZiAoIWlzTmV3TmFtZSAmJiB1bnN1cmZhY2VkRGVidC5sZW5ndGggPT09IDApIGNvbnRpbnVlOyAvLyBmdWxseSBzdXJmYWNlZCBhbHJlYWR5XG5cbiAgICBjb25zdCB3aHkgPSBhd2FpdCBleGVjdXRvcnMud2h5KG5hbWUsIGlucHV0LmN3ZCk7XG4gICAgc2VjdGlvbnMucHVzaChyZW5kZXJTcGFuU2VjdGlvbihuYW1lLCBhbmNob3JzQnlOYW1lLmdldChuYW1lKSA/PyBbXSwgZGVidFJvd3MsIHdoeSkpO1xuICAgIGlmIChkZWJ0U3RhdHVzZXMubGVuZ3RoID4gMCkgZHJpZnRlZE5hbWVzLnB1c2gobmFtZSk7XG5cbiAgICBpZiAoaXNOZXdOYW1lKSB0b1JlY29yZC5wdXNoKG5hbWUpO1xuICAgIGZvciAoY29uc3Qgc3RhdHVzIG9mIHVuc3VyZmFjZWREZWJ0KSB0b1JlY29yZC5wdXNoKGRyaWZ0S2V5KG5hbWUsIHN0YXR1cykpO1xuICB9XG5cbiAgaWYgKHNlY3Rpb25zLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIG1lbW8uYWRkU3VyZmFjZWQoaW5wdXQuc2Vzc2lvbklkLCB0b1JlY29yZCk7XG4gIGNvbnN0IGZpbGVOYW1lID0gYmFzZW5hbWUoaW5wdXQuZmlsZVBhdGgpO1xuICBjb25zdCBoZWFkZXIgPSBkcmlmdGVkTmFtZXMubGVuZ3RoID4gMCA/IGRyaWZ0SGVhZGVyKGRyaWZ0ZWROYW1lcy5sZW5ndGgsIGlucHV0LmtpbmQpIDogY2xlYW5IZWFkZXIoZmlsZU5hbWUpO1xuICBjb25zdCBmb290ZXIgPSBkcmlmdGVkTmFtZXMubGVuZ3RoID4gMCA/IGRyaWZ0Rm9vdGVyKGRyaWZ0ZWROYW1lcykgOiBjbGVhbkZvb3RlcihmaWxlTmFtZSk7XG4gIHJldHVybiBidWlsZEJsb2NrKHNlY3Rpb25zLCBoZWFkZXIsIGZvb3Rlcik7XG59XG5cbi8qKlxuICogUnVuIHRoZSB0b3VjaCBob29rIGZvciBhIHNpbmdsZSB0b29sIGNhbGwsIGJyYW5jaGluZyBvbiB7QGxpbmsgVG91Y2hJbnB1dC5raW5kfS5cbiAqXG4gKiAtICoqV3JpdGUgcGF0aCoqOiB7QGxpbmsgZXZhbHVhdGVXcml0ZUdhdGV9IChwbGFuIFx1MDBBNzMgc3RlcCAxKSBydW5zIGZpcnN0IFx1MjAxNFxuICogICBhbnkgZGVjaXNpdmUgZmFpbCwgb3IgYW4gaW5jb25jbHVzaXZlIHBoYW50b20gZGVsZXRlLCBibG9ja3MgdGhlIHRvdWNoXG4gKiAgIHdpdGggbm8gZXhlY3V0b3IgY2FsbCBcdTIwMTQgdGhlbiBgZXhlY3V0b3JzLmZpeGAgKGBnaXQgc3BhbiBkcmlmdCA8ZmlsZT5cbiAqICAgLS1maXhgKSBzY29wZWQgdG8gdGhlIHRvdWNoZWQgZmlsZSBoZWFscyBwb3NpdGlvbmFsIGRyaWZ0IGluIHRoZSB3b3JraW5nXG4gKiAgIHRyZWUsIGFuZCB0aGUgbWVyZ2VkIGA8Z2l0LXNwYW4+YCBibG9jayBpcyBjb21wdXRlZCBhZ2FpbnN0IHRoZSBoZWFsZWRcbiAqICAgYW5jaG9ycywgcmVuZGVyaW5nIGVhY2ggc3VyZmFjZWQgc3BhbiBhcyBhIGZ1bGwgaHVtYW4tZm9ybWF0IHNlY3Rpb24gd2l0aFxuICogICBhbnkgcmVtYWluaW5nIHNlbWFudGljIGRyaWZ0IHN0YXR1cy1zdWZmaXhlZCBvbiBpdHMgYW5jaG9ycy4gQ2FkZW5jZSBpc1xuICogICBkZWR1cGVkIHRocm91Z2ggYG1lbW9gIHBlciBzcGFuIG5hbWUgYW5kIHBlciAoc3Bhbiwgc3RhdHVzKS5cbiAqIC0gKipSZWFkIHBhdGgqKjogbmV2ZXIgaW52b2tlcyBgZml4YCBhbmQgbmV2ZXIgbXV0YXRlcyB0aGUgdHJlZTsgc3VyZmFjZXMgdGhlXG4gKiAgIHNwYW5zIG92ZXJsYXBwaW5nIHRoZSByZWFkJ3MgYG9mZnNldGAvYGxpbWl0YCB3aW5kb3cgKHNlZVxuICogICB7QGxpbmsgcmVjb3ZlclJlYWRSYW5nZX07IGEgcmVhZCB3aXRoIG5laXRoZXIgaXMgd2hvbGUtZmlsZSwgbWF0Y2hpbmdcbiAqICAgdG9kYXkncyBiZWhhdmlvcikgd2l0aCBwb3NpdGlvbmFsIHN0YXR1c2VzIGZpbHRlcmVkIG91dCB2aWEgYGlzRGVidCgpYC5cbiAqXG4gKiBUaGUgb3B0aW9uYWwgYHByb2JlQ2FjaGVgIHNoYXJlcyB0aGUgZHJpdmVyJ3MgcGVyLWNvbW1hbmQgZGVsZXRlLXJlYWxpdHlcbiAqIHByb2JlIGludG8gcGFzcyBCIChwbGFuIFx1MDBBNzMgc3RlcCAyKSBzbyBzdXJ2aXZpbmcgZGVsZXRlcyByZS1nYXRlIHdpdGhvdXRcbiAqIHJlLXByb2Jpbmc7IGRpcmVjdCBjYWxsZXJzIGdldCBhIHBlci1jYWxsIGNhY2hlIHNlZWRlZCB3aXRoIHRoZSB0b3VjaGVkXG4gKiBwYXRoIHdoZW4gdGhlIHRhcmdldCBpcyBgJ2Fic2VudCdgLlxuICpcbiAqIEZhaWxzIG9wZW46IGFueSBleGVjdXRvciByZWplY3Rpb24gb3IgaW50ZXJuYWwgZXJyb3IgeWllbGRzXG4gKiBgYWRkaXRpb25hbENvbnRleHQ6IG51bGxgIChubyBzaWduYWwsIGVkaXRpbmcgbmV2ZXIgYmxvY2tlZCkgcmF0aGVyIHRoYW5cbiAqIHRocm93aW5nLiBgdHJlZU1vZGlmaWVkYCByZWZsZWN0cyBhIHN1Y2Nlc3NmdWwgYC0tZml4YCBldmVuIHdoZW4gdGhlXG4gKiBzdWJzZXF1ZW50IHN1cmZhY2UgY29tcHV0YXRpb24gZmFpbHMuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5Ub3VjaEhvb2soXG4gIGlucHV0OiBUb3VjaElucHV0LFxuICBleGVjdXRvcnM6IFRvdWNoRXhlY3V0b3JzLFxuICBtZW1vOiBNZW1vU3RvcmUsXG4gIHByb2JlQ2FjaGU/OiBSZWFsaXR5UHJvYmVDYWNoZVxuKTogUHJvbWlzZTxUb3VjaE91dHB1dD4ge1xuICBsZXQgdHJlZU1vZGlmaWVkID0gZmFsc2U7XG4gIHRyeSB7XG4gICAgbGV0IHJhbmdlOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScgPSAnd2hvbGUtZmlsZSc7XG4gICAgaWYgKGlucHV0LmtpbmQgPT09ICd3cml0ZScpIHtcbiAgICAgIGNvbnN0IHByb2JlID0gcHJvYmVDYWNoZSA/PyBjcmVhdGVSZWFsaXR5UHJvYmVDYWNoZShpbnB1dC50YXJnZXRTdGF0ZSA9PT0gJ2Fic2VudCcgPyBbaW5wdXQuZmlsZVBhdGhdIDogW10pO1xuICAgICAgY29uc3Qgb3V0Y29tZSA9IGV2YWx1YXRlV3JpdGVHYXRlKGlucHV0LCBwcm9iZSk7XG4gICAgICBpZiAob3V0Y29tZSA9PT0gJ2RlY2lzaXZlRmFpbCcgfHwgKG91dGNvbWUgPT09ICdpbmNvbmNsdXNpdmUnICYmIGlucHV0LnRhcmdldFN0YXRlID09PSAnYWJzZW50JykpIHtcbiAgICAgICAgcmV0dXJuIHsgYWRkaXRpb25hbENvbnRleHQ6IG51bGwsIHRyZWVNb2RpZmllZDogZmFsc2UgfTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGZpeCA9IGF3YWl0IGV4ZWN1dG9ycy5maXgoaW5wdXQuZmlsZVBhdGgsIGlucHV0LmN3ZCk7XG4gICAgICB0cmVlTW9kaWZpZWQgPSBmaXgubW9kaWZpZWQ7XG4gICAgICByYW5nZSA9IGlucHV0LnJhbmdlID8/IHJlY292ZXJSYW5nZUZyb21EaXNrKGlucHV0LndyaXR0ZW4sIGlucHV0LmZpbGVQYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmFuZ2UgPSByZWNvdmVyUmVhZFJhbmdlKGlucHV0Lm9mZnNldCwgaW5wdXQubGltaXQsIGlucHV0LmZpbGVQYXRoKTtcbiAgICB9XG4gICAgY29uc3QgYWRkaXRpb25hbENvbnRleHQgPSBhd2FpdCBjb21wdXRlU3VyZmFjZShpbnB1dCwgZXhlY3V0b3JzLCBtZW1vLCByYW5nZSk7XG4gICAgcmV0dXJuIHsgYWRkaXRpb25hbENvbnRleHQsIHRyZWVNb2RpZmllZCB9O1xuICB9IGNhdGNoIHtcbiAgICAvLyBGYWlsIG9wZW46IG5ldmVyIGxldCBhIHRvdWNoLWNvcmUgZXJyb3IgcHJvcGFnYXRlIHVwIGFuZCBibG9jayB0aGUgdG9vbFxuICAgIC8vIGNhbGwuIFRoZSB0cmVlIG1heSBhbHJlYWR5IGhhdmUgYmVlbiBoZWFsZWQgKHRyZWVNb2RpZmllZCBwcmVzZXJ2ZWQpLlxuICAgIHJldHVybiB7IGFkZGl0aW9uYWxDb250ZXh0OiBudWxsLCB0cmVlTW9kaWZpZWQgfTtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERlZmF1bHQgc3VicHJvY2Vzcy1iYWNrZWQgZXhlY3V0b3JzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgREVGQVVMVF9USU1FT1VUX01TID0gMTBfMDAwO1xuXG4vKiogUmVzb2x2ZSB0aGUgdG91Y2hlZCBmaWxlIHRvIGEgcGF0aCByZWxhdGl2ZSB0byBpdHMgcmVwbyByb290LCBmb3IgYGdpdCBzcGFuYC4gKi9cbmZ1bmN0aW9uIHJlcG9SZWxBcmcoZmlsZVBhdGg6IHN0cmluZywgY3dkOiBzdHJpbmcpOiB7IHJlcG9Sb290OiBzdHJpbmc7IHJlbFBhdGg6IHN0cmluZyB9IHwgbnVsbCB7XG4gIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gIGlmICghcmVwb1Jvb3QpIHJldHVybiBudWxsO1xuICByZXR1cm4geyByZXBvUm9vdCwgcmVsUGF0aDogcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3QsIGZpbGVQYXRoKSB9O1xufVxuXG4vKipcbiAqIEEgc25hcHNob3Qgb2YgdGhlIHNwYW4gcm9vdCdzIHdvcmtpbmctdHJlZSBzdGF0dXMsIHVzZWQgdG8gZGV0ZWN0IHdoZXRoZXIgYVxuICogYC0tZml4YCByZS1hbmNob3JlZCBhbnl0aGluZy4gQ29tcGFyZWQgYmVmb3JlL2FmdGVyOyBhbiB1bnJlc29sdmFibGUgcmVwbyBvclxuICogYSBmYWlsZWQgc3RhdHVzIHlpZWxkcyBhIHN0YWJsZSBlbXB0eSBzdHJpbmcgKFx1MjE5MiBgbW9kaWZpZWQ6IGZhbHNlYCkuXG4gKi9cbmZ1bmN0aW9uIHNwYW5TdGF0dXNTbmFwc2hvdChyZXBvUm9vdDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgc3BhblJvb3QgPSByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3QpO1xuICB0cnkge1xuICAgIHJldHVybiBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ3N0YXR1cycsICctLXBvcmNlbGFpbicsICctLScsIHNwYW5Sb290XSwge1xuICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgdGltZW91dDogREVGQVVMVF9USU1FT1VUX01TXG4gICAgfSk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnJztcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBwcm9kdWN0aW9uIGV4ZWN1dGlvbiBzdXJmYWNlOiB0aHJlZSBzdWJwcm9jZXNzLWJhY2tlZCBleGVjdXRvcnMgZm9sbG93aW5nXG4gKiBzcGFuLXN1cmZhY2UudHMncyBgY3JlYXRlRGVmYXVsdCpFeGVjdXRvcmAgc3R5bGUuIEVhY2ggY2FwdHVyZXMgc3Rkb3V0IGV2ZW4gb25cbiAqIGEgbm9uLXplcm8gZXhpdCB3aGVyZSB0aGUgQ0xJIHN0aWxsIGVtaXRzIHVzZWZ1bCBvdXRwdXQsIGFuZCBldmVyeSBmYWlsdXJlXG4gKiBtb2RlIChhYnNlbnQgYmluYXJ5LCB0aW1lb3V0LCBwYXJzZSBmYWlsdXJlKSBzdXJmYWNlcyBhcyBhbiBlbXB0eS9jbGVhbiByZXN1bHRcbiAqIHNvIHtAbGluayBydW5Ub3VjaEhvb2t9J3MgZmFpbC1vcGVuIGNvbnRyYWN0IGhvbGRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdFRvdWNoRXhlY3V0b3JzKHRpbWVvdXRNczogbnVtYmVyID0gREVGQVVMVF9USU1FT1VUX01TKTogVG91Y2hFeGVjdXRvcnMge1xuICByZXR1cm4ge1xuICAgIGZpeDogYXN5bmMgKGZpbGVQYXRoLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlc29sdmVkID0gcmVwb1JlbEFyZyhmaWxlUGF0aCwgY3dkKTtcbiAgICAgIGlmICghcmVzb2x2ZWQpIHJldHVybiB7IG1vZGlmaWVkOiBmYWxzZSB9O1xuICAgICAgY29uc3QgYmVmb3JlID0gc3BhblN0YXR1c1NuYXBzaG90KHJlc29sdmVkLnJlcG9Sb290KTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2RyaWZ0JywgcmVzb2x2ZWQucmVsUGF0aCwgJy0tZml4J10sIHtcbiAgICAgICAgICBjd2Q6IHJlc29sdmVkLnJlcG9Sb290LFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICB2b2lkIGVycjsgLy8gYGdpdCBzcGFuIGRyaWZ0YCBleGl0cyAxIG9uIGRyaWZ0IGV2ZW4gd2hlbiBgLS1maXhgIGhlYWxlZCBzb21ldGhpbmcsIGFuZFxuICAgICAgICAvLyBub24temVybyBvbiBnZW51aW5lIGZhaWx1cmU7IHRoZSBzbmFwc2hvdCBkaWZmIGlzIHRoZSBzb3VyY2Ugb2ZcbiAgICAgICAgLy8gdHJ1dGggZm9yIHdoZXRoZXIgdGhlIHRyZWUgY2hhbmdlZCwgc28gdGhlIGV4aXQgY29kZSBpcyBpZ25vcmVkIGhlcmUuXG4gICAgICB9XG4gICAgICBjb25zdCBhZnRlciA9IHNwYW5TdGF0dXNTbmFwc2hvdChyZXNvbHZlZC5yZXBvUm9vdCk7XG4gICAgICByZXR1cm4geyBtb2RpZmllZDogYmVmb3JlICE9PSBhZnRlciB9O1xuICAgIH0sXG5cbiAgICBsaXN0OiBhc3luYyAoZmlsZVBhdGgsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVzb2x2ZWQgPSByZXBvUmVsQXJnKGZpbGVQYXRoLCBjd2QpO1xuICAgICAgaWYgKCFyZXNvbHZlZCkgcmV0dXJuIFtdO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnbGlzdCcsICctLXBvcmNlbGFpbicsIHJlc29sdmVkLnJlbFBhdGhdLCB7XG4gICAgICAgICAgY3dkOiByZXNvbHZlZC5yZXBvUm9vdCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBwYXJzZVBvcmNlbGFpbihvdXQpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgZHJpZnQ6IGFzeW5jIChhcmdzLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICBjb25zdCBydW5Dd2QgPSByZXBvUm9vdCA/PyBjd2Q7XG4gICAgICAvLyBUaGUgY29yZSBwYXNzZXMgYW4gYWJzb2x1dGUgZmlsZSBwYXRoOyBzY29wZSBgZ2l0IHNwYW4gZHJpZnRgIHRvIGl0XG4gICAgICAvLyByZWxhdGl2ZSB0byB0aGUgcmVwbyByb290IHNvIHRoZSBwYXRoIGluZGV4IHJlc29sdmVzIGl0LlxuICAgICAgY29uc3Qgc2NvcGVkID0gcmVwb1Jvb3QgPyBhcmdzLm1hcCgoYSkgPT4gcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3QsIGEpKSA6IGFyZ3M7XG4gICAgICBsZXQgb3V0OiBzdHJpbmc7XG4gICAgICB0cnkge1xuICAgICAgICBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICdkcmlmdCcsICctLWZvcm1hdCcsICdwb3JjZWxhaW4nLCAuLi5zY29wZWRdLCB7XG4gICAgICAgICAgY3dkOiBydW5Dd2QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGNvbnN0IGNhcHR1cmVkID0gKGVyciBhcyB7IHN0ZG91dD86IHN0cmluZyB9KS5zdGRvdXQ7XG4gICAgICAgIGlmICh0eXBlb2YgY2FwdHVyZWQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgb3V0ID0gY2FwdHVyZWQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gcGFyc2VEcmlmdFBvcmNlbGFpbihvdXQpO1xuICAgIH0sXG5cbiAgICB3aHk6IGFzeW5jIChuYW1lLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlcG9Sb290ID0gcmVzb2x2ZVJlcG9Sb290KGN3ZCk7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc3BhbicsICd3aHknLCBuYW1lXSwge1xuICAgICAgICAgIGN3ZDogcmVwb1Jvb3QgPz8gY3dkLFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgdGV4dCA9IG91dC50cmltRW5kKCk7XG4gICAgICAgIC8vIEJhcmUgYGdpdCBzcGFuIHdoeWAgcHJpbnRzIHRoaXMgZXhhY3Qgc2VudGluZWwgKGV4aXQgMCkgd2hlbiB0aGVcbiAgICAgICAgLy8gc3BhbiBoYXMgbm8gd2h5IHJlY29yZGVkIFx1MjAxNCB0cmVhdCBpdCBhcyBcIm5vIHdoeVwiLCBub3QgYXMgY29udGVudC5cbiAgICAgICAgaWYgKHRleHQubGVuZ3RoID09PSAwIHx8IHRleHQgPT09IGBcXGAke25hbWV9XFxgIGhhcyBubyB3aHkgcmVjb3JkZWQuYCkgcmV0dXJuIG51bGw7XG4gICAgICAgIHJldHVybiB0ZXh0O1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgIH1cbiAgfTtcbn1cbiIsICIvKipcbiAqIFNoYXJlZCBib3gtZHJhd2luZyB0cmVlIHJlbmRlcmVyIGZvciBhIHNwYW4ncyBhbmNob3IgbGlzdCwgdXNlZCBieSBldmVyeVxuICogY2FsbCBzaXRlIHRoYXQgdG9kYXkgcHJpbnRzIGEgZmxhdCBgLSBwYXRoI0xzdGFydC1MZW5kYCBidWxsZXQgcnVuXG4gKiAoYHRvdWNoLWNvcmUudHNgJ3MgYGFuY2hvckJ1bGxldHNgLCBhbmQgYGFkdmlzb3ItY29yZS50c2Anc1xuICogYGFubm90YXRlQmxvY2tzYC9gZ3JvdXBDb3ZlcmluZ0J5TmFtZWApLiBBbmNob3JzIHRoYXQgc2hhcmUgYSBkaXJlY3RvcnlcbiAqIHByZWZpeCBjb2xsYXBzZSBpbnRvIG9uZSB0cmVlIGluc3RlYWQgb2YgYmVpbmcgcmVjb25zdHJ1Y3RlZCBieSBleWUgZnJvbSBhXG4gKiBmbGF0IGxpc3QgXHUyMDE0IHRoZSBtb3RpdmF0aW5nIGNhc2UgaXMgcGFyaXR5IGFuY2hvcnMgdW5kZXIgcGFyYWxsZWxcbiAqIGBwdWJsaWMvY2xhdWRlLy4uLmAvYHB1YmxpYy9jb2RleC8uLi5gIHRyZWVzLlxuICpcbiAqIFRoaXMgbW9kdWxlIGlzIGEgcHVyZSBwcmVzZW50YXRpb24gdHJhbnNmb3JtOiBpdCBuZXZlciBjb21wdXRlcyBkcmlmdFxuICogc3RhdHVzIG9yIGRlY2lkZXMgd2hpY2ggYW5jaG9ycyBhcmUgc3VyZmFjZWQuIENhbGxlcnMgcHJlY29tcHV0ZSBlYWNoIHJvdydzXG4gKiBgc3VmZml4YCAoZS5nLiBgIFx1MjAxNCBjaGFuZ2VkYCkgZXhhY3RseSBhcyB0aGV5IGRvIHRvZGF5LCBhbmQgb25seSB0aGUgKnNoYXBlKlxuICogb2YgdGhlIHByaW50ZWQgbGlzdCBjaGFuZ2VzLlxuICovXG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUHVibGljIHR5cGVzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBIb3cgYSBzaW5nbGUgYW5jaG9yJ3MgbGluZSByYW5nZSBpcyBrbm93bi4gYHJhbmdlYCBhbmQgYHdob2xlLWZpbGVgIGFyZSB0aGVcbiAqIHR3byBzaGFwZXMgZXZlcnkgYW5jaG9yIHRha2VzIHRvZGF5OyBgdHJ1bmNhdGVkYCBpcyBhIGRlZmVuc2l2ZSB0aGlyZCBzaGFwZVxuICogcmVhY2hhYmxlIG9ubHkgZnJvbSByZS1wYXJzaW5nIHRoZSBDTEkncyBmbGF0IGh1bWFuLWZvcm1hdCB0ZXh0IChhIGAjTGBcbiAqIGZyYWdtZW50IHRoYXQgZG9lc24ndCBjbGVhbmx5IG1hdGNoIGAjTHN0YXJ0LUxlbmRgKS5cbiAqXG4gKiBWZXJpZmllZCBpbnZhcmlhbnQ6IHRoZSBzdHJ1Y3R1cmVkLWRhdGEgY2FsbCBzaXRlcyBjYW4gbmV2ZXIgcHJvZHVjZVxuICogYHRydW5jYXRlZGAuIGBwYXJzZVBvcmNlbGFpbmAgKGFnZW50LWhvb2tzLWNvbW1vbi50cykgYGNvbnRpbnVlYHMgcGFzdCBhbnlcbiAqIHJvdyBtaXNzaW5nIGEgdmFsaWQgcmFuZ2UsIHNvIGFuIGluY29tcGxldGUgYFBvcmNlbGFpblJvd2AgY2FuIG5ldmVyIGJlXG4gKiBjb25zdHJ1Y3RlZDsgdGhlIFJ1c3QgQ0xJJ3Mgb3duIHBvcmNlbGFpbiB3cml0ZXIgYWx3YXlzIGVtaXRzIGEgcmFuZ2VcbiAqIGNvbHVtbiAoYDAtMGAgZm9yIHdob2xlLWZpbGUpLiBgdHJ1bmNhdGVkYCBpcyByZWFjaGFibGUgb25seSBmcm9tXG4gKiBgYW5ub3RhdGVCbG9ja3NgJyBmbGF0LXRleHQgcGFyc2luZyBvZiBgYmxvY2tzVGV4dGAgaW4gYSBsYXRlciBwaGFzZS5cbiAqL1xuZXhwb3J0IHR5cGUgUmFuZ2VMYWJlbCA9IHsga2luZDogJ3JhbmdlJzsgc3RhcnQ6IG51bWJlcjsgZW5kOiBudW1iZXIgfSB8IHsga2luZDogJ3dob2xlLWZpbGUnIH0gfCB7IGtpbmQ6ICd0cnVuY2F0ZWQnIH07XG5cbi8qKiBPbmUgc3RhY2tlZCByYW5nZSB1bmRlciBhIGBUcmVlQW5jaG9yYCwgd2l0aCBpdHMgcHJlY29tcHV0ZWQgZHJpZnQgc3VmZml4LiAqL1xuZXhwb3J0IGludGVyZmFjZSBSYW5nZUVudHJ5IHtcbiAgcmFuZ2U6IFJhbmdlTGFiZWw7XG4gIC8qKiBQcmVjb21wdXRlZCBgIFx1MjAxNCBjaGFuZ2VkYCAoZXRjLiksIG9yIGAnJ2Agd2hlbiB0aGUgYW5jaG9yIGNhcnJpZXMgbm8gZHJpZnQuICovXG4gIHN1ZmZpeDogc3RyaW5nO1xufVxuXG4vKiogT25lIGRpc3RpbmN0IHBhdGgncyBjb2xsYXBzZWQgYW5jaG9yIGVudHJ5LCByZWFkeSBmb3IgdHJlZSBsYXlvdXQuICovXG5leHBvcnQgaW50ZXJmYWNlIFRyZWVBbmNob3Ige1xuICAvKiogUmVwby1yZWxhdGl2ZSwgcG9zaXgtc2VwYXJhdGVkIHBhdGguICovXG4gIHBhdGg6IHN0cmluZztcbiAgLyoqXG4gICAqIFN0YWNrZWQgcmFuZ2VzIG9uIHRoaXMgcGF0aC4gRW1wdHkgbWVhbnMgXCJwYXRoIG9ubHksIG5vIHJhbmdlIGNvbHVtbiBhdFxuICAgKiBhbGxcIiBcdTIwMTQgYSBiYXJlLXBhdGggbGVhZiwgZGlzdGluY3QgZnJvbSBhIHNpbmdsZSBgd2hvbGUtZmlsZWAgZW50cnkgKHdoaWNoXG4gICAqIHJlbmRlcnMgdGhlIHBhdGggdG9vLCBidXQgaXMgYW4gZXhwbGljaXQgcmFuZ2Uta2luZCBjbGFzc2lmaWNhdGlvbikuXG4gICAqL1xuICByYW5nZXM6IFJhbmdlRW50cnlbXTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBjb2xsYXBzZUJ5UGF0aFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogQ29sbGFwc2Ugcm93cyB0aGF0IG5hbWUgdGhlIHNhbWUgcGF0aCBpbnRvIG9uZSBgVHJlZUFuY2hvcmAgd2l0aCBzdGFja2VkXG4gKiByYW5nZXMsIHByZXNlcnZpbmcgZmlyc3Qtc2VlbiBvcmRlci4gYHJlbmRlckFuY2hvclRyZWVgJ3MgY29udHJhY3QgcmVxdWlyZXNcbiAqIGF0IG1vc3Qgb25lIGBUcmVlQW5jaG9yYCBwZXIgZGlzdGluY3QgcGF0aCBcdTIwMTQgdGhpcyBpcyB0aGUgbWFuZGF0b3J5XG4gKiBwcmUtcHJvY2Vzc2luZyBzdGVwIGV2ZXJ5IGNhbGxlciBydW5zIGZpcnN0IHRvIGd1YXJhbnRlZSB0aGF0LlxuICpcbiAqIE1pcnJvcnMgdGhlIG9yZGVyLWFycmF5LXBsdXMtTWFwIGlkaW9tIGFscmVhZHkgdXNlZCBieVxuICogYGRlZHVwZUJ5QW5jaG9yKClgIChhZHZpc29yLWNvcmUudHMpIGZvciB0aGUgc2FtZSByZWFzb246IHRoZSBDTEkgY2FuIGVtaXRcbiAqIG11bHRpcGxlIHJvd3MgZm9yIG9uZSBsb2dpY2FsIHBhdGgsIGFuZCB0aGUgKnBvc2l0aW9uKiBvZiBhIGxhdGVyXG4gKiBzYW1lLXBhdGggcm93IGlzIHN1YnN1bWVkIGludG8gdGhhdCBwYXRoJ3MgZmlyc3Qgb2NjdXJyZW5jZSwgbm90IGFwcGVuZGVkXG4gKiBhdCBpdHMgb3duIGxhdGVyIHBvc2l0aW9uLiBDb25jcmV0ZWx5OiBgYS50cyNMMS1MNWAsIGBiLnRzI0wxLUw1YCxcbiAqIGBhLnRzI0w5LUwxMmAgY29sbGFwc2VzIHRvIGBbYS50cyAodHdvIHN0YWNrZWQgcmFuZ2VzKSwgYi50cyAob25lIHJhbmdlKV1gXG4gKiBcdTIwMTQgYGEudHNgIHNpdHMgYXQgcG9zaXRpb24gMCwgaXRzIGZpcnN0IG9jY3VycmVuY2UsIG5vdCBpdHMgbGFzdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbGxhcHNlQnlQYXRoKHJvd3M6IHsgcGF0aDogc3RyaW5nOyByYW5nZTogUmFuZ2VMYWJlbDsgc3VmZml4OiBzdHJpbmcgfVtdKTogVHJlZUFuY2hvcltdIHtcbiAgY29uc3Qgb3JkZXI6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGJ5UGF0aCA9IG5ldyBNYXA8c3RyaW5nLCBUcmVlQW5jaG9yPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgbGV0IGFuY2hvciA9IGJ5UGF0aC5nZXQocm93LnBhdGgpO1xuICAgIGlmICghYW5jaG9yKSB7XG4gICAgICBhbmNob3IgPSB7IHBhdGg6IHJvdy5wYXRoLCByYW5nZXM6IFtdIH07XG4gICAgICBieVBhdGguc2V0KHJvdy5wYXRoLCBhbmNob3IpO1xuICAgICAgb3JkZXIucHVzaChyb3cucGF0aCk7XG4gICAgfVxuICAgIGFuY2hvci5yYW5nZXMucHVzaCh7IHJhbmdlOiByb3cucmFuZ2UsIHN1ZmZpeDogcm93LnN1ZmZpeCB9KTtcbiAgfVxuICByZXR1cm4gb3JkZXIubWFwKChwYXRoKSA9PiBieVBhdGguZ2V0KHBhdGgpIGFzIFRyZWVBbmNob3IpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRyZWUgY29uc3RydWN0aW9uXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuaW50ZXJmYWNlIExlYWZOb2RlIHtcbiAga2luZDogJ2xlYWYnO1xuICBuYW1lOiBzdHJpbmc7XG4gIGFuY2hvcjogVHJlZUFuY2hvcjtcbn1cblxuaW50ZXJmYWNlIERpck5vZGUge1xuICBraW5kOiAnZGlyJztcbiAgbmFtZTogc3RyaW5nO1xuICBjaGlsZHJlbjogUGF0aFRyZWVOb2RlW107XG59XG5cbnR5cGUgUGF0aFRyZWVOb2RlID0gTGVhZk5vZGUgfCBEaXJOb2RlO1xuXG4vKipcbiAqIFNwbGl0IGEgcGF0aCBpbnRvIGAvYC1zZXBhcmF0ZWQgc2VnbWVudHMsIG9yIGBudWxsYCB3aGVuIGRvaW5nIHNvIHdvdWxkXG4gKiBmZWVkIGFuIGVtcHR5LXN0cmluZyBzZWdtZW50IGludG8gdGhlIHRyaWUgKGEgbGVhZGluZyBgL2AsIGEgdHJhaWxpbmcgYC9gLFxuICogYSBkb3VibGVkIGAvL2AsIG9yIHRoZSBlbXB0eSBzdHJpbmcpLiBgbnVsbGAgc2lnbmFscyB0aGUgY2FsbGVyIHRvIHJlbmRlclxuICogdGhhdCBhbmNob3IncyBmdWxsIHBhdGggc3RyaW5nIGFzIGEgc2luZ2xlLCB1bnNwbGl0LCBhdG9taWMgdG9wLWxldmVsIGxlYWZcbiAqIGluc3RlYWQgb2YgYXR0ZW1wdGluZyB0byBuZXN0IGl0IFx1MjAxNCBhIGtub3duLWVudW1lcmFibGUgY2xhc3Mgb2YgbWFsZm9ybWVkXG4gKiBwYXRocyBnZXRzIGEgcmVhbCBydWxlIGhlcmUgcmF0aGVyIHRoYW4gdGhlIHNwbGl0IHJ1bm5pbmcgYW55d2F5IGFuZFxuICogZmFicmljYXRpbmcgYW4gZW1wdHktbmFtZWQgZGlyZWN0b3J5IG5vZGUuIEEgYmFyZSBmaWxlbmFtZSB3aXRoIG5vIGAvYCBhdFxuICogYWxsIHByb2R1Y2VzIGV4YWN0bHkgb25lIG5vbi1lbXB0eSBzZWdtZW50IGFuZCBpcyBoYW5kbGVkIGJ5IHRoZSBvcmRpbmFyeVxuICogcGF0aCBiZWxvdyAoaXQgYmVjb21lcyBhIHRvcC1sZXZlbCBsZWFmIHdpdGggbm8gZGlyZWN0b3J5IHRvIG5lc3QgdW5kZXIgXHUyMDE0XG4gKiBhbHJlYWR5IGF0b21pYywgbm8gc3BlY2lhbCBjYXNlIG5lZWRlZCkuXG4gKi9cbmZ1bmN0aW9uIHNwbGl0U2VnbWVudHMocGF0aDogc3RyaW5nKTogc3RyaW5nW10gfCBudWxsIHtcbiAgaWYgKHBhdGgubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgY29uc3Qgc2VnbWVudHMgPSBwYXRoLnNwbGl0KCcvJyk7XG4gIGlmIChzZWdtZW50cy5zb21lKChzZWdtZW50KSA9PiBzZWdtZW50Lmxlbmd0aCA9PT0gMCkpIHJldHVybiBudWxsO1xuICByZXR1cm4gc2VnbWVudHM7XG59XG5cbmZ1bmN0aW9uIGZpbmRPckNyZWF0ZURpcihwYXJlbnQ6IERpck5vZGUsIG5hbWU6IHN0cmluZyk6IERpck5vZGUge1xuICBmb3IgKGNvbnN0IGNoaWxkIG9mIHBhcmVudC5jaGlsZHJlbikge1xuICAgIGlmIChjaGlsZC5raW5kID09PSAnZGlyJyAmJiBjaGlsZC5uYW1lID09PSBuYW1lKSByZXR1cm4gY2hpbGQ7XG4gIH1cbiAgY29uc3Qgbm9kZTogRGlyTm9kZSA9IHsga2luZDogJ2RpcicsIG5hbWUsIGNoaWxkcmVuOiBbXSB9O1xuICBwYXJlbnQuY2hpbGRyZW4ucHVzaChub2RlKTtcbiAgcmV0dXJuIG5vZGU7XG59XG5cbi8qKiBJbnNlcnQgb25lIGFuY2hvciBpbnRvIHRoZSB0cmllLCBjcmVhdGluZy9yZXVzaW5nIGRpcmVjdG9yeSBub2RlcyBpbiBhcnJpdmFsIG9yZGVyLiAqL1xuZnVuY3Rpb24gaW5zZXJ0QW5jaG9yKHJvb3Q6IERpck5vZGUsIHNlZ21lbnRzOiBzdHJpbmdbXSwgYW5jaG9yOiBUcmVlQW5jaG9yKTogdm9pZCB7XG4gIGxldCBjdXIgPSByb290O1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHNlZ21lbnRzLmxlbmd0aCAtIDE7IGkrKykge1xuICAgIGN1ciA9IGZpbmRPckNyZWF0ZURpcihjdXIsIHNlZ21lbnRzW2ldKTtcbiAgfVxuICBjdXIuY2hpbGRyZW4ucHVzaCh7IGtpbmQ6ICdsZWFmJywgbmFtZTogc2VnbWVudHNbc2VnbWVudHMubGVuZ3RoIC0gMV0sIGFuY2hvciB9KTtcbn1cblxuLyoqXG4gKiBCdWlsZCB0aGUgdG9wLWxldmVsIGZvcmVzdCBmcm9tIGEgYFRyZWVBbmNob3JbXWAgYWxyZWFkeSBjb2xsYXBzZWQgYnlcbiAqIGBjb2xsYXBzZUJ5UGF0aGAuIFNpYmxpbmcgb3JkZXIgaXMgbmV2ZXIgcmUtc29ydGVkIFx1MjAxNCBhIHBhdGggZWl0aGVyIG9wZW5zIGFcbiAqIG5ldyBub2RlIGF0IGl0cyBhcnJpdmFsIHBvc2l0aW9uIG9yIGlzIG5lc3RlZCB1bmRlciBhIGRpcmVjdG9yeSBub2RlXG4gKiBjcmVhdGVkL3JldXNlZCBhdCB0aGF0IGRpcmVjdG9yeSdzIG93biBmaXJzdC1vY2N1cnJlbmNlIHBvc2l0aW9uLlxuICovXG5mdW5jdGlvbiBidWlsZEZvcmVzdChhbmNob3JzOiBUcmVlQW5jaG9yW10pOiBQYXRoVHJlZU5vZGVbXSB7XG4gIGNvbnN0IHJvb3Q6IERpck5vZGUgPSB7IGtpbmQ6ICdkaXInLCBuYW1lOiAnJywgY2hpbGRyZW46IFtdIH07XG4gIGZvciAoY29uc3QgYW5jaG9yIG9mIGFuY2hvcnMpIHtcbiAgICBjb25zdCBzZWdtZW50cyA9IHNwbGl0U2VnbWVudHMoYW5jaG9yLnBhdGgpO1xuICAgIGlmIChzZWdtZW50cyA9PT0gbnVsbCkge1xuICAgICAgcm9vdC5jaGlsZHJlbi5wdXNoKHsga2luZDogJ2xlYWYnLCBuYW1lOiBhbmNob3IucGF0aCwgYW5jaG9yIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGluc2VydEFuY2hvcihyb290LCBzZWdtZW50cywgYW5jaG9yKTtcbiAgfVxuICByZXR1cm4gcm9vdC5jaGlsZHJlbjtcbn1cblxuLyoqIEEgbm9kZSBwYWlyZWQgd2l0aCB0aGUgKHBvc3NpYmx5IGZvbGRlZCkgbmFtZSBpdCBkaXNwbGF5cyBvbiBpdHMgb3duIGxpbmUuICovXG5pbnRlcmZhY2UgRGlzcGxheUl0ZW0ge1xuICBuYW1lOiBzdHJpbmc7XG4gIG5vZGU6IFBhdGhUcmVlTm9kZTtcbn1cblxuLyoqXG4gKiBGb2xkIGEgY2hhaW4gb2Ygc2luZ2xlLWNoaWxkIG5vZGVzIGludG8gb25lIGNvbWJpbmVkIG5hbWVcbiAqIChgcHVibGljL2NsYXVkZS9ydW50aW1lL3NraWxscy9jYXJkYCwgYGRpcnR5L21vZC5yc2AsXG4gKiBgLmRldmNvbnRhaW5lci9Eb2NrZXJmaWxlYCkuIEZvbGRpbmcgY29udGludWVzIHdoaWxlIHRoZSBjdXJyZW50IG5vZGUgaXMgYVxuICogZGlyZWN0b3J5IHdpdGggKipleGFjdGx5IG9uZSBjaGlsZCoqLCByZWdhcmRsZXNzIG9mIHdoZXRoZXIgdGhhdCBjaGlsZCBpcyBhXG4gKiBkaXJlY3Rvcnkgb3IgYSBsZWFmOiBhIG5vZGUgd2l0aCBvbmUgY2hpbGQgY29udmV5cyBubyBncm91cGluZyBieVxuICogZGVmaW5pdGlvbiwgc28gZm9sZGluZyBpdCBsb3NlcyBubyBzdHJ1Y3R1cmUgd2hpbGUgcmVtb3ZpbmcgYSBsaW5lIHdob3NlXG4gKiBvbmx5IGNvbnRlbnQgaXMgYSBjb25uZWN0b3IuIFN0b3BzIGF0IHRoZSBmaXJzdCBkaXJlY3Rvcnkgd2l0aCAyKyBjaGlsZHJlblxuICogKGV4cGFuZCBmcm9tIHRoZXJlKSBvciBhdCBhIGxlYWYgKHdoaWNoIHRoZW4gcmVuZGVycyB3aXRoIHRoZSBmb2xkZWQgbmFtZSkuXG4gKlxuICogRm9sZGluZyBsb25lICpsZWF2ZXMqIFx1MjAxNCBub3QganVzdCBsb25lIGRpcmVjdG9yaWVzIFx1MjAxNCBpcyB3aGF0IGtlZXBzIHRoZSB0cmVlXG4gKiBubyB0YWxsZXIgdGhhbiB0aGUgZmxhdCBidWxsZXQgbGlzdCBpdCByZXBsYWNlcywgYW5kIHdoYXQgbWFrZXMgYSBzaW5nbGVcbiAqIGFuY2hvciByZW5kZXIgYXMgdGhlIG9uZS1saW5lIHRyZWUgdGhlIHBsYW4gcHJvbWlzZXMgZXZlbiB3aGVuIGl0cyBwYXRoIGhhc1xuICogZGlyZWN0b3JpZXMgaW4gaXQuIEl0IGFsc28ga2VlcHMgdGhlIGRpc2NyaW1pbmF0aW5nIHNlZ21lbnQgb24gdGhlIHNhbWVcbiAqIGxpbmUgYXMgaXRzIHJhbmdlIChgZGlydHkvbW9kLnJzICNMMzkyLUwzOTlgKSBmb3IgYG1vZC5yc2AvYGluZGV4LnRzYFxuICogbGF5b3V0cywgd2hlcmUgdGhlIGZpbGVuYW1lIGFsb25lIGlkZW50aWZpZXMgbm90aGluZy5cbiAqL1xuZnVuY3Rpb24gZm9sZENoYWluKG5vZGU6IFBhdGhUcmVlTm9kZSk6IERpc3BsYXlJdGVtIHtcbiAgbGV0IG5hbWUgPSBub2RlLm5hbWU7XG4gIGxldCBjdXIgPSBub2RlO1xuICB3aGlsZSAoY3VyLmtpbmQgPT09ICdkaXInICYmIGN1ci5jaGlsZHJlbi5sZW5ndGggPT09IDEpIHtcbiAgICBjb25zdCBjaGlsZCA9IGN1ci5jaGlsZHJlblswXTtcbiAgICBuYW1lID0gYCR7bmFtZX0vJHtjaGlsZC5uYW1lfWA7XG4gICAgY3VyID0gY2hpbGQ7XG4gIH1cbiAgcmV0dXJuIHsgbmFtZSwgbm9kZTogY3VyIH07XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUmVuZGVyaW5nXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSYW5rIG9mIGEgc3RhY2tlZCBlbnRyeSdzIHJhbmdlIGtpbmQ6IGB3aG9sZS1maWxlYCBmaXJzdCwgdGhlbiBudW1lcmljXG4gKiBgcmFuZ2VgcywgdGhlbiBgdHJ1bmNhdGVkYC4gQSB3aG9sZS1maWxlIGFuY2hvciBpcyB0aGUgQ0xJJ3MgYDAtMGAgcm93IFx1MjAxNCBpdFxuICogY292ZXJzIHRoZSBlbnRpcmUgZmlsZSwgc28gaXQgc29ydHMgYWhlYWQgb2YgZXZlcnkgbGluZSByYW5nZSBvbiB0aGF0IGZpbGVcbiAqIHRoZSBzYW1lIHdheSBsaW5lIDAgd291bGQuIGB0cnVuY2F0ZWRgIGNhcnJpZXMgbm8gcG9zaXRpb24gYXQgYWxsIGFuZCBzb3J0c1xuICogbGFzdC5cbiAqL1xuZnVuY3Rpb24gcmFuZ2VSYW5rKHJhbmdlOiBSYW5nZUxhYmVsKTogbnVtYmVyIHtcbiAgc3dpdGNoIChyYW5nZS5raW5kKSB7XG4gICAgY2FzZSAnd2hvbGUtZmlsZSc6XG4gICAgICByZXR1cm4gMDtcbiAgICBjYXNlICdyYW5nZSc6XG4gICAgICByZXR1cm4gMTtcbiAgICBjYXNlICd0cnVuY2F0ZWQnOlxuICAgICAgcmV0dXJuIDI7XG4gIH1cbn1cblxuLyoqXG4gKiBTdGFja2VkLXJhbmdlIG9yZGVyIGlzIGJ5IGtpbmQgcmFuayB0aGVuIG51bWVyaWMgKGBzdGFydGAgdGhlbiBgZW5kYCksXG4gKiBvdmVycmlkaW5nIGFycml2YWwgb3IgY29kZXBvaW50IG9yZGVyIFx1MjAxNCB0aGUgb25seSBzb3J0aW5nIHRoaXMgbW9kdWxlIGRvZXMsXG4gKiBhbmQgc2NvcGVkIHN0cmljdGx5IHRvIHJhbmdlcyBzdGFja2VkIG9uIG9uZSBwYXRoIChuZXZlciB0byBzaWJsaW5nIHBhdGhzXG4gKiBvciBkaXJlY3Rvcnkgb3JkZXIpLiBFcXVhbC1yYW5rZWQgZW50cmllcyAodHdvIGB0cnVuY2F0ZWRgcywgb3IgdHdvXG4gKiBpZGVudGljYWwgcmFuZ2VzKSBrZWVwIHRoZWlyIG93biByZWxhdGl2ZSBhcnJpdmFsIG9yZGVyLCBzaW5jZSB0aGUgc29ydCBpc1xuICogc3RhYmxlLlxuICovXG5mdW5jdGlvbiBjb21wYXJlUmFuZ2VFbnRyaWVzKGE6IFJhbmdlRW50cnksIGI6IFJhbmdlRW50cnkpOiBudW1iZXIge1xuICBjb25zdCByYW5rID0gcmFuZ2VSYW5rKGEucmFuZ2UpIC0gcmFuZ2VSYW5rKGIucmFuZ2UpO1xuICBpZiAocmFuayAhPT0gMCkgcmV0dXJuIHJhbms7XG4gIGlmIChhLnJhbmdlLmtpbmQgPT09ICdyYW5nZScgJiYgYi5yYW5nZS5raW5kID09PSAncmFuZ2UnKSB7XG4gICAgcmV0dXJuIGEucmFuZ2Uuc3RhcnQgLSBiLnJhbmdlLnN0YXJ0IHx8IGEucmFuZ2UuZW5kIC0gYi5yYW5nZS5lbmQ7XG4gIH1cbiAgcmV0dXJuIDA7XG59XG5cbi8qKlxuICogVGhlIHJhbmdlIGNvbHVtbidzIHRleHQsIG9yIGBudWxsYCB3aGVuIHRoZSBlbnRyeSBwcmludHMgYXMgYSBiYXJlIHBhdGhcbiAqIHdpdGggbm8gcmFuZ2UgY29sdW1uIGF0IGFsbC5cbiAqXG4gKiBBIGB3aG9sZS1maWxlYCBlbnRyeSBpcyB0aGUgb25lIGtpbmQgd2hvc2UgcmVuZGVyaW5nIGRlcGVuZHMgb24gY29udGV4dC5cbiAqIEFsb25lIG9uIGl0cyBwYXRoIGl0IHN0YXlzIGEgYmFyZSBwYXRoIHdpdGggemVybyBtYXJrZXIgXHUyMDE0IHRoYXQgaXMgd2hhdCB0aGVcbiAqIENMSSdzIG93biBmbGF0IGxpc3QgcHJpbnRzIGZvciBhIHdob2xlLWZpbGUgYW5jaG9yLCBhbmQgYWRkaW5nIGEgbWFya2VyXG4gKiB0aGVyZSB3b3VsZCBhbm5vdGF0ZSB0aGUgb3ZlcndoZWxtaW5nbHkgY29tbW9uIGNhc2UgZm9yIHRoZSBiZW5lZml0IG9mIHRoZVxuICogcmFyZSBvbmUuICpTdGFja2VkKiBiZWhpbmQgb3RoZXIgcmFuZ2VzIG9uIHRoZSBzYW1lIHBhdGggaXQgbXVzdCBjYXJyeSBhblxuICogZXhwbGljaXQgbWFya2VyOiB3aXRob3V0IG9uZSBpdCByZW5kZXJzIGFzIGEgY29udGludWF0aW9uIGxpbmUgaG9sZGluZ1xuICogbm90aGluZyBidXQgaW5kZW50YXRpb24gYW5kIGl0cyBkcmlmdCBzdWZmaXgsIHdoaWNoIGVyYXNlcyB0aGUgYW5jaG9yXG4gKiBvdXRyaWdodCB3aGVuIHRoZSBzdWZmaXggaXMgZW1wdHkgYW5kIFx1MjAxNCB3b3JzZSBcdTIwMTQgaGFuZ3MgaXRzIGAgXHUyMDE0IGNoYW5nZWRgXG4gKiB1bmRlciBhIG5laWdoYm91cmluZyByYW5nZSwgZXhhY3RseSB0aGUgdmlzdWFsIGdyYW1tYXIgdGhhdCBtZWFucyBcImFub3RoZXJcbiAqIHJhbmdlIG9uIHRoaXMgc2FtZSBmaWxlXCIuIFRoZSByZWFkZXIgd291bGQgdGhlbiByZWNvbmNpbGUgdGhlIHJhbmdlIHRoYXRcbiAqIGRpZCBub3QgZHJpZnQuIE9mIHRoZSB0aHJlZSBmaXhlcyBhdmFpbGFibGUgKHByaW50IHRoZSBwYXRoIG9uXG4gKiBjb250aW51YXRpb24gbGluZXMsIHNvcnQgd2hvbGUtZmlsZSB0byBwb3NpdGlvbiAwLCBvciBzcGxpdCBpdCBpbnRvIGl0cyBvd25cbiAqIGxlYWYpLCBhbiBleHBsaWNpdCBtYXJrZXIgaXMgdGhlIG9ubHkgb25lIHRoYXQgbWFrZXMgdGhlIGVudHJ5IGlkZW50aWZpYWJsZVxuICogaW4gKmV2ZXJ5KiBwb3NpdGlvbiByYXRoZXIgdGhhbiBvbmx5IGluIHRoZSBwb3NpdGlvbiB0aGUgc29ydCBoYXBwZW5zIHRvXG4gKiBwdXQgaXQgaW47IHNvcnRpbmcgaXQgZmlyc3QgKHNlZSB7QGxpbmsgcmFuZ2VSYW5rfSkgaXMga2VwdCBhcyB3ZWxsIGJlY2F1c2VcbiAqIFwid2hvbGUgZmlsZSwgdGhlbiBpdHMgcmFuZ2VzIGluIGxpbmUgb3JkZXJcIiBpcyB0aGUgb3JkZXIgYSByZWFkZXIgZXhwZWN0cyxcbiAqIG5vdCBiZWNhdXNlIGlkZW50aWZpYWJpbGl0eSBkZXBlbmRzIG9uIGl0LlxuICovXG5mdW5jdGlvbiBsYWJlbEZvcihyYW5nZTogUmFuZ2VMYWJlbCwgc29sZTogYm9vbGVhbik6IHN0cmluZyB8IG51bGwge1xuICBzd2l0Y2ggKHJhbmdlLmtpbmQpIHtcbiAgICBjYXNlICdyYW5nZSc6XG4gICAgICByZXR1cm4gYCNMJHtyYW5nZS5zdGFydH0tTCR7cmFuZ2UuZW5kfWA7XG4gICAgY2FzZSAnd2hvbGUtZmlsZSc6XG4gICAgICByZXR1cm4gc29sZSA/IG51bGwgOiAnKHdob2xlIGZpbGUpJztcbiAgICBjYXNlICd0cnVuY2F0ZWQnOlxuICAgICAgcmV0dXJuICcodHJ1bmNhdGVkIGluIHNvdXJjZSBcdTIwMTQgYW5jaG9yIGluY29tcGxldGUpJztcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENvbHVtbiBtYXRoXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBUaGUgZ3JhcGhlbWUgc2VnbWVudGVyLCBjb25zdHJ1Y3RlZCBvbiBmaXJzdCB1c2UgYW5kIHRoZW4gY2FjaGVkIFx1MjAxNCBpbmNsdWRpbmdcbiAqIGEgY2FjaGVkIGBudWxsYCB3aGVuIGl0IGNhbm5vdCBiZSBjb25zdHJ1Y3RlZCBhdCBhbGwuXG4gKlxuICogTGF6eSBvbiBwdXJwb3NlLiBgSW50bGAgaXMgbm90IHBhcnQgb2YgdGhlIEphdmFTY3JpcHQgbGFuZ3VhZ2UgY29yZTogYSBOb2RlXG4gKiBidWlsdCBgLS13aXRoLWludGw9bm9uZWAgaGFzIG5vIGBJbnRsYCBnbG9iYWwgd2hhdHNvZXZlciwgYW5kIGBob29rcy5qc29uYFxuICogaW52b2tlcyBhIGJhcmUgYG5vZGVgIG9mZiB0aGUgdXNlcidzIGBQQVRIYCwgc28gYGVuZ2luZXMubm9kZWAgY29uc3RyYWluc1xuICogbm90aGluZyBoZXJlLiBDb25zdHJ1Y3RpbmcgdGhpcyBhdCBtb2R1bGUgc2NvcGUgcHV0IGEgYFJlZmVyZW5jZUVycm9yYCBpblxuICogdGhlIGJ1bmRsZXMnIHRvcC1sZXZlbCBzdGF0ZW1lbnRzLCB3aGVyZSBpdCB0aHJvd3MgYXQgKmltcG9ydCogXHUyMDE0IGJlZm9yZSBhbnlcbiAqIG9mIHRoZSBmYWlsLWNsb3NlZCBgdHJ5L2NhdGNoYCBibG9ja3MgaW4gYHJlbmRlckFuY2hvclJ1bmAsIGByZW5kZXJQYXRoUnVuYFxuICogYW5kIGBhbmNob3JCdWxsZXRzYCBleGlzdCB0byBjYXRjaCBpdC4gVGhlIGhvb2sgcHJvY2VzcyB0aGVuIGRpZWQgd2l0aCBleGl0XG4gKiAxLCB3aGljaCBDbGF1ZGUgQ29kZSB0cmVhdHMgYXMgYSBub24tYmxvY2tpbmcgaG9vayBlcnJvcjogdGhlIGNvbW1pdCBnYXRlXG4gKiBzaWxlbnRseSBhbGxvd2VkIHRoZSBjb21taXQgYW5kIHRoZSBkcmlmdCByZW1pbmRlciBzaWxlbnRseSB2YW5pc2hlZC5cbiAqIEJ1aWxkaW5nIGl0IGluc2lkZSB0aGUgcmVuZGVyIHBhdGggcHV0cyBhbnkgZmFpbHVyZSBiYWNrIGluc2lkZSB0aG9zZVxuICogY2F0Y2hlcy5cbiAqXG4gKiBGQUlMLUNMT1NFRCwgbm90IGEgYDxncmVlbmZpZWxkPmAtZm9yYmlkZGVuIGZhbGxiYWNrIFx1MjAxNCB0aGUgc2FtZSBjYXRlZ29yeSBhc1xuICogdGhlIGxvY2FsIGB0cnkvY2F0Y2hgIGJsb2NrcyBhdCB0aGlzIG1vZHVsZSdzIGNhbGwgc2l0ZXMsIGFuZCBsb2FkLWJlYXJpbmdcbiAqIGZvciB0aGUgc2FtZSByZWFzb24uIE5vdGhpbmcgaW4gdGhlIGNvbHVtbi1hbGlnbm1lbnQgcGF0aCBtYXkgYmUgYWJsZSB0b1xuICogY29zdCB0aGUgY29tbWl0IGdhdGUgb3IgdGhlIGRyaWZ0IHJlbWluZGVyOiBpZiBkaXNwbGF5IHdpZHRoIGNhbm5vdCBiZVxuICogbWVhc3VyZWQsIHRoZSBsaXN0IHN0aWxsIHByaW50cyBhbmQgdGhlIGdhdGUgc3RpbGwgaG9sZHM7IG9ubHkgYWxpZ25tZW50IGlzXG4gKiBsb3N0LlxuICovXG5sZXQgY2FjaGVkU2VnbWVudGVyOiB7IHZhbHVlOiBJbnRsLlNlZ21lbnRlciB8IG51bGwgfSB8IHVuZGVmaW5lZDtcblxuZnVuY3Rpb24gZ3JhcGhlbWVTZWdtZW50ZXIoKTogSW50bC5TZWdtZW50ZXIgfCBudWxsIHtcbiAgaWYgKGNhY2hlZFNlZ21lbnRlciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNhY2hlZFNlZ21lbnRlciA9IHsgdmFsdWU6IG5ldyBJbnRsLlNlZ21lbnRlcignZW4nLCB7IGdyYW51bGFyaXR5OiAnZ3JhcGhlbWUnIH0pIH07XG4gICAgfSBjYXRjaCB7XG4gICAgICBjYWNoZWRTZWdtZW50ZXIgPSB7IHZhbHVlOiBudWxsIH07XG4gICAgfVxuICB9XG4gIHJldHVybiBjYWNoZWRTZWdtZW50ZXIudmFsdWU7XG59XG5cbi8qKlxuICogQ29kZSBwb2ludCByYW5nZXMgcmVuZGVyZWQgdHdvIGNvbHVtbnMgd2lkZTogdGhlIEVhc3QgQXNpYW4gV2lkZSAoVykgYW5kXG4gKiBGdWxsd2lkdGggKEYpIGJsb2NrcyBvZiBVQVggIzExLCBwbHVzIHRoZSBlbW9qaSBibG9ja3MgdGhhdCB0ZXJtaW5hbHMgYW5kXG4gKiBwcm9wb3J0aW9uYWwgYWdlbnQtZmFjaW5nIHJlbmRlcmVycyBib3RoIGdpdmUgZG91YmxlIHdpZHRoLiBFdmVyeXRoaW5nIGVsc2VcbiAqIGNvdW50cyBhcyBvbmUgY29sdW1uLlxuICpcbiAqIFNvcnRlZCBhc2NlbmRpbmcgYW5kIG5vbi1vdmVybGFwcGluZyBcdTIwMTQge0BsaW5rIGlzV2lkZUNvZGVQb2ludH0gc2hvcnQtY2lyY3VpdHNcbiAqIG9uIHRoZSBmaXJzdCByYW5nZSBzdGFydGluZyBwYXN0IHRoZSBjb2RlIHBvaW50LlxuICovXG5jb25zdCBXSURFX1JBTkdFUzogcmVhZG9ubHkgKHJlYWRvbmx5IFtudW1iZXIsIG51bWJlcl0pW10gPSBbXG4gIFsweDExMDAsIDB4MTE1Zl0sXG4gIFsweDIzMjksIDB4MjMyYV0sXG4gIFsweDI2MDAsIDB4MjdiZl0sXG4gIFsweDJlODAsIDB4MzAzZV0sXG4gIFsweDMwNDEsIDB4MzNmZl0sXG4gIFsweDM0MDAsIDB4NGRiZl0sXG4gIFsweDRlMDAsIDB4OWZmZl0sXG4gIFsweGEwMDAsIDB4YTRjZl0sXG4gIFsweGE5NjAsIDB4YTk3Zl0sXG4gIFsweGFjMDAsIDB4ZDdhM10sXG4gIFsweGY5MDAsIDB4ZmFmZl0sXG4gIFsweGZlMTAsIDB4ZmUxOV0sXG4gIFsweGZlMzAsIDB4ZmU2Zl0sXG4gIFsweGZmMDAsIDB4ZmY2MF0sXG4gIFsweGZmZTAsIDB4ZmZlNl0sXG4gIFsweDE3MDAwLCAweDE4YWZmXSxcbiAgWzB4MWYxZTYsIDB4MWYxZmZdLFxuICBbMHgxZjMwMCwgMHgxZjY0Zl0sXG4gIFsweDFmNjgwLCAweDFmNmZmXSxcbiAgWzB4MWY5MDAsIDB4MWY5ZmZdLFxuICBbMHgxZmE3MCwgMHgxZmFmZl0sXG4gIFsweDIwMDAwLCAweDJmZmZkXSxcbiAgWzB4MzAwMDAsIDB4M2ZmZmRdXG5dO1xuXG5mdW5jdGlvbiBpc1dpZGVDb2RlUG9pbnQoY3A6IG51bWJlcik6IGJvb2xlYW4ge1xuICBmb3IgKGNvbnN0IFtsbywgaGldIG9mIFdJREVfUkFOR0VTKSB7XG4gICAgaWYgKGNwIDwgbG8pIHJldHVybiBmYWxzZTtcbiAgICBpZiAoY3AgPD0gaGkpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBEaXNwbGF5IHdpZHRoIG9mIGEgbmFtZSBpbiB0ZXJtaW5hbCBjb2x1bW5zIFx1MjAxNCB0aGUgdW5pdCB0aGUgcmFuZ2UgY29sdW1uIGlzXG4gKiBhY3R1YWxseSBhbGlnbmVkIGluLiBNZWFzdXJlZCBvdmVyIGdyYXBoZW1lIGNsdXN0ZXJzIChzbyBhIGRlY29tcG9zZWQgYFx1MDBFOWBcbiAqIG9yIGEgY29tYmluaW5nLW1hcmsgc2VxdWVuY2UgY291bnRzIG9uY2UsIG5vdCBvbmNlIHBlciBjb2RlIHBvaW50KSwgd2l0aFxuICogZWFjaCBjbHVzdGVyIGNvbnRyaWJ1dGluZyB0d28gY29sdW1ucyB3aGVuIGl0cyBiYXNlIGNvZGUgcG9pbnQgaXMgRWFzdFxuICogQXNpYW4gV2lkZS9GdWxsd2lkdGggb3IgZW1vamkgYW5kIG9uZSBvdGhlcndpc2UuXG4gKlxuICogTmVpdGhlciBVVEYtMTYgYC5sZW5ndGhgIG5vciBgQXJyYXkuZnJvbShuYW1lKS5sZW5ndGhgIGlzIHRoaXMgdW5pdDogdGhlXG4gKiBmaXJzdCBvdmVyLWNvdW50cyBhIHN1cnJvZ2F0ZSBwYWlyLCB0aGUgc2Vjb25kIHVuZGVyLWNvdW50cyBhIENKSyBpZGVvZ3JhcGhcbiAqIGFuZCBvdmVyLWNvdW50cyBhIGRlY29tcG9zZWQgYWNjZW50LlxuICpcbiAqIFdoZW4ge0BsaW5rIGdyYXBoZW1lU2VnbWVudGVyfSBpcyB1bmF2YWlsYWJsZSAoYSBOb2RlIGJ1aWx0XG4gKiBgLS13aXRoLWludGw9bm9uZWAgaGFzIG5vIGBJbnRsYCBnbG9iYWwgYXQgYWxsKSwgdGhpcyBkZWdyYWRlcyB0byB0aGUgY3J1ZGVyXG4gKiBwZXItY29kZS1wb2ludCBtZWFzdXJlIHJhdGhlciB0aGFuIHRocm93aW5nLiBUaGF0IG1lYXN1cmUgb3Zlci1jb3VudHMgYVxuICogZGVjb21wb3NlZCBhY2NlbnQgYW5kIGEgcmVnaW9uYWwtaW5kaWNhdG9yIGZsYWcgcGFpciwgc28gYWxpZ25tZW50IGNhbiBiZSBhXG4gKiBjb2x1bW4gb3IgdHdvIG9mZiBcdTIwMTQgd2hpY2ggaXMgdGhlIGVudGlyZSBjb3N0LCBhbmQgaXMgdGhlIGNvcnJlY3QgcHJpY2UgdG9cbiAqIHBheTogdGhlIGFuY2hvciBsaXN0IHN0aWxsIHByaW50cyBhbmQgdGhlIGNvbW1pdCBnYXRlIHN0aWxsIGhvbGRzLlxuICovXG5mdW5jdGlvbiBkaXNwbGF5V2lkdGgobmFtZTogc3RyaW5nKTogbnVtYmVyIHtcbiAgY29uc3Qgc2VnbWVudGVyID0gZ3JhcGhlbWVTZWdtZW50ZXIoKTtcbiAgbGV0IHdpZHRoID0gMDtcbiAgaWYgKHNlZ21lbnRlciA9PT0gbnVsbCkge1xuICAgIGZvciAoY29uc3QgY29kZVBvaW50IG9mIG5hbWUpIHtcbiAgICAgIHdpZHRoICs9IGlzV2lkZUNvZGVQb2ludChjb2RlUG9pbnQuY29kZVBvaW50QXQoMCkgPz8gMCkgPyAyIDogMTtcbiAgICB9XG4gICAgcmV0dXJuIHdpZHRoO1xuICB9XG4gIGZvciAoY29uc3QgeyBzZWdtZW50IH0gb2Ygc2VnbWVudGVyLnNlZ21lbnQobmFtZSkpIHtcbiAgICB3aWR0aCArPSBpc1dpZGVDb2RlUG9pbnQoc2VnbWVudC5jb2RlUG9pbnRBdCgwKSA/PyAwKSA/IDIgOiAxO1xuICB9XG4gIHJldHVybiB3aWR0aDtcbn1cblxuLyoqXG4gKiBBbGlnbm1lbnQgY2VpbGluZy4gQSBzaWJsaW5nIGdyb3VwIHdob3NlIHdpZGVzdCByYW5nZS1iZWFyaW5nIG5hbWUgZXhjZWVkc1xuICogdGhpcyB3aWR0aCBkb2VzIG5vdCBhbGlnbiBhdCBhbGwgXHUyMDE0IGV2ZXJ5IG5hbWUgaW4gaXQgdGFrZXMgYSBzaW5nbGUgc3BhY2VcbiAqIGJlZm9yZSBpdHMgcmFuZ2UuIFRoZSBhbHRlcm5hdGl2ZSAocGFkIHRoZSBzaG9ydCBuYW1lcyB0byB0aGUgY2VpbGluZyB3aGlsZVxuICogdGhlIGxvbmcgb25lIHNpdHMgYXQgaXRzIG93biBuYXR1cmFsIGNvbHVtbikgcGF5cyBtb3N0IG9mIHRoZSB3aWR0aCBmb3JcbiAqIGFsaWdubWVudCB0aGF0IGFsaWducyB3aXRoIG5vdGhpbmcsIHdoaWNoIGlzIHN0cmljdGx5IHdvcnNlIHRoYW4gbm90XG4gKiBhbGlnbmluZy4gTmFtZXMgdGhlbXNlbHZlcyBhcmUgbmV2ZXIgdHJ1bmNhdGVkIG9yIGVsaWRlZCBhdCBhbnkgd2lkdGguXG4gKi9cbmNvbnN0IE1BWF9BTElHTl9DT0xVTU4gPSA0ODtcblxuLyoqXG4gKiBUaGUgY29sdW1uIGV2ZXJ5IHJhbmdlLWJlYXJpbmcgbmFtZSBpbiB0aGlzIHNpYmxpbmcgZ3JvdXAgcGFkcyB0bywgb3IgYDBgXG4gKiB3aGVuIHRoZSBncm91cCBmb3Jnb2VzIGFsaWdubWVudCAobm8gcmFuZ2UtYmVhcmluZyBuYW1lcywgb3IgYSBuYW1lIHBhc3RcbiAqIHtAbGluayBNQVhfQUxJR05fQ09MVU1OfSkuIEFsaWdubWVudCBzY29wZSBpcyB0aGUgZ3JvdXAncyBkaXJlY3QgY2hpbGRyZW5cbiAqIG9ubHksIG5ldmVyIHRoZSB3aG9sZSB0cmVlIFx1MjAxNCB3aG9sZS10cmVlIGFsaWdubWVudCB3b3VsZCBsZXQgb25lIGRlZXBseVxuICogbmVzdGVkIGxvbmcgbmFtZSBwYWQgZXZlcnkgdW5yZWxhdGVkIGJyYW5jaC5cbiAqL1xuZnVuY3Rpb24gY29tcHV0ZUdyb3VwVGFyZ2V0KGl0ZW1zOiBEaXNwbGF5SXRlbVtdKTogbnVtYmVyIHtcbiAgbGV0IG1heCA9IDA7XG4gIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcykge1xuICAgIGlmIChpdGVtLm5vZGUua2luZCA9PT0gJ2xlYWYnICYmIHByaW50c1JhbmdlQ29sdW1uKGl0ZW0ubm9kZS5hbmNob3IpKSB7XG4gICAgICBtYXggPSBNYXRoLm1heChtYXgsIGRpc3BsYXlXaWR0aChpdGVtLm5hbWUpKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG1heCA+IE1BWF9BTElHTl9DT0xVTU4gPyAwIDogbWF4O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhpcyBhbmNob3IgcHJpbnRzIGEgcmFuZ2UgY29sdW1uIGF0IGFsbCBcdTIwMTQgdGhlIGV4YWN0IGNvbmRpdGlvblxuICoge0BsaW5rIGxhYmVsRm9yfSBlbmNvZGVzLCBob2lzdGVkIHNvIHtAbGluayBjb21wdXRlR3JvdXBUYXJnZXR9IG1lYXN1cmVzIHRoZVxuICogc2FtZSBzZXQgb2YgbmFtZXMgaXQgcGFkcy4gQW4gYW5jaG9yIHdpdGggbm8gcmFuZ2VzLCBvciBhICpzb2xlKiB3aG9sZS1maWxlXG4gKiBlbnRyeSAod2hpY2ggcmVuZGVycyBhcyBhIGJhcmUgcGF0aCB3aXRoIHplcm8gbWFya2VyKSwgY29udHJpYnV0ZXMgbm8gcmFuZ2VcbiAqIGNvbHVtbiBhbmQgc28gbXVzdCBub3QgY29udHJpYnV0ZSB0byB0aGUgZ3JvdXAgbWF4IGVpdGhlcjogb3RoZXJ3aXNlIGFcbiAqIHdob2xlLWZpbGUgYW5jaG9yIG9uIGEgcGF0aCBwYXN0IHtAbGluayBNQVhfQUxJR05fQ09MVU1OfSBzaWxlbnRseSBzdXBwcmVzc2VzXG4gKiBhbGlnbm1lbnQgZm9yIGl0cyByYW5nZS1iZWFyaW5nIHNpYmxpbmdzIHdoaWxlIGl0c2VsZiBwcmludGluZyBub3RoaW5nIHRvXG4gKiBhbGlnbi5cbiAqL1xuZnVuY3Rpb24gcHJpbnRzUmFuZ2VDb2x1bW4oYW5jaG9yOiBUcmVlQW5jaG9yKTogYm9vbGVhbiB7XG4gIGNvbnN0IHsgcmFuZ2VzIH0gPSBhbmNob3I7XG4gIGlmIChyYW5nZXMubGVuZ3RoID09PSAwKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiByYW5nZXMuc29tZSgoZW50cnkpID0+IGxhYmVsRm9yKGVudHJ5LnJhbmdlLCByYW5nZXMubGVuZ3RoID09PSAxKSAhPT0gbnVsbCk7XG59XG5cbi8qKiBUaGUgc3BhY2luZyBiZXR3ZWVuIGEgbmFtZSBvZiBgbmFtZVdpZHRoYCBjb2x1bW5zIGFuZCBpdHMgcmFuZ2UgY29sdW1uLiAqL1xuZnVuY3Rpb24gY29tcHV0ZVBhZChuYW1lV2lkdGg6IG51bWJlciwgdGFyZ2V0OiBudW1iZXIpOiBzdHJpbmcge1xuICBpZiAobmFtZVdpZHRoID49IHRhcmdldCkgcmV0dXJuICcgJztcbiAgcmV0dXJuICcgJy5yZXBlYXQodGFyZ2V0IC0gbmFtZVdpZHRoICsgMSk7XG59XG5cbi8qKlxuICogUmVuZGVyIG9uZSBsZWFmJ3MgbGluZShzKS4gQW4gZW1wdHkgYHJhbmdlc2AgYXJyYXkgaXMgYSBiYXJlLXBhdGggbGVhZiB3aXRoXG4gKiBubyByYW5nZSBjb2x1bW4gYXQgYWxsIChkaXN0aW5jdCBmcm9tIGEgYHdob2xlLWZpbGVgIGVudHJ5LCB3aGljaCBpcyBhblxuICogZXhwbGljaXQgY2xhc3NpZmljYXRpb24gdGhhdCBhbHNvIHByaW50cyB3aXRoIHplcm8gbWFya2VyIHdoZW4gaXQgc3RhbmRzXG4gKiBhbG9uZSwgYnV0IHRocm91Z2ggdGhlIHJhbmdlcyBwaXBlbGluZSkuIE11bHRpcGxlIHN0YWNrZWQgcmFuZ2VzIHByaW50XG4gKiB1bmRlciBhIGNvbnRpbnVhdGlvbiBwcmVmaXggaW5zdGVhZCBvZiByZXBlYXRpbmcgdGhlIG5hbWU7IGVhY2ggY2FycmllcyBpdHNcbiAqIG93biBzdWZmaXggaW5kZXBlbmRlbnRseSwgYW5kIGVhY2ggY2FycmllcyBhIGxhYmVsIGlkZW50aWZ5aW5nIHdoaWNoIGFuY2hvclxuICogdGhlIHN1ZmZpeCBiZWxvbmdzIHRvLlxuICovXG5mdW5jdGlvbiByZW5kZXJMZWFmTGluZXMoXG4gIG5hbWU6IHN0cmluZyxcbiAgYW5jaG9yOiBUcmVlQW5jaG9yLFxuICBvd25QcmVmaXg6IHN0cmluZyxcbiAgY2hpbGRQcmVmaXg6IHN0cmluZyxcbiAgZ3JvdXBUYXJnZXQ6IG51bWJlclxuKTogc3RyaW5nW10ge1xuICBjb25zdCB7IHJhbmdlcyB9ID0gYW5jaG9yO1xuICBpZiAocmFuZ2VzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtgJHtvd25QcmVmaXh9JHtuYW1lfWBdO1xuXG4gIGNvbnN0IHNvcnRlZCA9IFsuLi5yYW5nZXNdLnNvcnQoY29tcGFyZVJhbmdlRW50cmllcyk7XG4gIGNvbnN0IHNvbGUgPSBzb3J0ZWQubGVuZ3RoID09PSAxO1xuICBjb25zdCBuYW1lV2lkdGggPSBkaXNwbGF5V2lkdGgobmFtZSk7XG4gIGNvbnN0IHBhZCA9IGNvbXB1dGVQYWQobmFtZVdpZHRoLCBncm91cFRhcmdldCk7XG4gIGNvbnN0IGJsYW5rID0gJyAnLnJlcGVhdChuYW1lV2lkdGggKyBwYWQubGVuZ3RoKTtcblxuICByZXR1cm4gc29ydGVkLm1hcCgoZW50cnksIGkpID0+IHtcbiAgICBjb25zdCBsYWJlbCA9IGxhYmVsRm9yKGVudHJ5LnJhbmdlLCBzb2xlKTtcbiAgICBpZiAobGFiZWwgPT09IG51bGwpIHJldHVybiBgJHtvd25QcmVmaXh9JHtuYW1lfSR7ZW50cnkuc3VmZml4fWA7XG4gICAgY29uc3QgYmFzZSA9IGkgPT09IDAgPyBgJHtvd25QcmVmaXh9JHtuYW1lfSR7cGFkfWAgOiBgJHtjaGlsZFByZWZpeH0ke2JsYW5rfWA7XG4gICAgcmV0dXJuIGAke2Jhc2V9JHtsYWJlbH0ke2VudHJ5LnN1ZmZpeH1gO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gcmVuZGVyTm9kZXMobm9kZXM6IFBhdGhUcmVlTm9kZVtdLCBwcmVmaXg6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgbGluZXM6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGl0ZW1zID0gbm9kZXMubWFwKGZvbGRDaGFpbik7XG4gIGNvbnN0IGdyb3VwVGFyZ2V0ID0gY29tcHV0ZUdyb3VwVGFyZ2V0KGl0ZW1zKTtcbiAgaXRlbXMuZm9yRWFjaCgoaXRlbSwgaSkgPT4ge1xuICAgIGNvbnN0IGlzTGFzdCA9IGkgPT09IGl0ZW1zLmxlbmd0aCAtIDE7XG4gICAgY29uc3Qgb3duUHJlZml4ID0gYCR7cHJlZml4fSR7aXNMYXN0ID8gJ1x1MjUxNFx1MjUwMCAnIDogJ1x1MjUxQ1x1MjUwMCAnfWA7XG4gICAgY29uc3QgY2hpbGRQcmVmaXggPSBgJHtwcmVmaXh9JHtpc0xhc3QgPyAnICAgJyA6ICdcdTI1MDIgICd9YDtcbiAgICBpZiAoaXRlbS5ub2RlLmtpbmQgPT09ICdsZWFmJykge1xuICAgICAgbGluZXMucHVzaCguLi5yZW5kZXJMZWFmTGluZXMoaXRlbS5uYW1lLCBpdGVtLm5vZGUuYW5jaG9yLCBvd25QcmVmaXgsIGNoaWxkUHJlZml4LCBncm91cFRhcmdldCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICBsaW5lcy5wdXNoKGAke293blByZWZpeH0ke2l0ZW0ubmFtZX0vYCk7XG4gICAgICBsaW5lcy5wdXNoKC4uLnJlbmRlck5vZGVzKGl0ZW0ubm9kZS5jaGlsZHJlbiwgY2hpbGRQcmVmaXgpKTtcbiAgICB9XG4gIH0pO1xuICByZXR1cm4gbGluZXM7XG59XG5cbi8qKlxuICogUmVuZGVyIGEgY29sbGFwc2VkIGFuY2hvciBsaXN0IGFzIGEgYm94LWRyYXdpbmcgdHJlZSwgZ3JvdXBlZCBieSBzaGFyZWRcbiAqIHBhdGggcHJlZml4LiBFdmVyeSBhbmNob3IgbGlzdCByZW5kZXJzIGFzIGEgdHJlZSB1bmNvbmRpdGlvbmFsbHkgXHUyMDE0IGEgc2luZ2xlXG4gKiBhbmNob3IgYmVjb21lcyBhIG9uZS1saW5lIHRyZWUgd2hhdGV2ZXIgaXRzIGRlcHRoIChzZWUge0BsaW5rIGZvbGRDaGFpbn0pO1xuICogdGhlcmUgaXMgbm8gZmxhdC1idWxsZXQgcGF0aCBvciBzaXplIGZsb29yIGluIHRoaXMgbW9kdWxlLlxuICpcbiAqIEhlaWdodCBpcyBib3VuZGVkIGJ5IHtAbGluayBmb2xkQ2hhaW59OiBhIGRpcmVjdG9yeSBsaW5lIG9ubHkgZXZlciBhcHBlYXJzXG4gKiB3aGVyZSBpdCBnZW51aW5lbHkgZ3JvdXBzIHR3byBvciBtb3JlIHNpYmxpbmdzLCBzbyB0aGUgdHJlZSBhZGRzIGF0IG1vc3RcbiAqIG9uZSBsaW5lIHBlciByZWFsIGdyb3VwaW5nIGFuZCBuZXZlciBvbmUgcGVyIHBhdGggc2VnbWVudC5cbiAqXG4gKiBUb3RhbCBmb3IgYW55IHdlbGwtZm9ybWVkIGBUcmVlQW5jaG9yW11gOiBkZWdlbmVyYXRlIHBhdGhzIChydWxlIGVuZm9yY2VkXG4gKiBpbiB7QGxpbmsgc3BsaXRTZWdtZW50c30pIGFyZSBub3JtYWxpemVkIHRvIGF0b21pYyBsZWF2ZXMgcmF0aGVyIHRoYW5cbiAqIHRocm93biBvbiwgc28gdGhpcyBmdW5jdGlvbiBuZXZlciBuZWVkcyBhbiBpbnRlcm5hbCB0cnkvY2F0Y2guIENhbGxlcnMgYWRkXG4gKiB0aGVpciBvd24gY2F0Y2ggYXJvdW5kIHRoaXMgY2FsbCBpbiBhIGxhdGVyIHBoYXNlIChmYWlsLW9wZW4gZGlzY2lwbGluZVxuICogbGl2ZXMgYXQgdGhlIGNhbGwgc2l0ZSwgbm90IGhlcmUpLlxuICpcbiAqIGByZW5kZXJBbmNob3JUcmVlYCdzIGNvbnRyYWN0IHJlcXVpcmVzIGF0IG1vc3Qgb25lIGBUcmVlQW5jaG9yYCBwZXJcbiAqIGRpc3RpbmN0IGBwYXRoYCBcdTIwMTQgcGFzcyBhbmNob3JzIHRocm91Z2gge0BsaW5rIGNvbGxhcHNlQnlQYXRofSBmaXJzdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlckFuY2hvclRyZWUoYW5jaG9yczogVHJlZUFuY2hvcltdKTogc3RyaW5nW10ge1xuICBjb25zdCBmb3Jlc3QgPSBidWlsZEZvcmVzdChhbmNob3JzKTtcbiAgcmV0dXJuIHJlbmRlck5vZGVzKGZvcmVzdCwgJycpO1xufVxuIiwgIi8qKlxuICogU2hhcmVkIEJhc2ggc3BhbiBcdTIxOTIgdG91Y2ggdHJhbnNsYXRpb24gYW5kIHRoZSBqb2luLWdhdGluZyBkcml2ZXIgKHBsYW4gXHUwMEE3MixcbiAqIFx1MDBBNzMgc3RlcCAyKS4gQm90aCBhZGFwdGVycyBjb25zdW1lIHRoaXMgbW9kdWxlIG9uY2UgdGhlaXIgZHVwbGljYXRlIEJhc2hcbiAqIHNwYW4gbG9vcHMgY29sbGFwc2U6IGl0IG93bnMgdGhlIHBlci1jb21tYW5kIHZlcmRpY3QgdGhyZWFkIFx1MjAxNCBwYXNzIEFcbiAqIGBldmFsdWF0ZVdyaXRlR2F0ZWAgc3dlZXAsIHRoZSBleHBsYW5hdGlvbiBtYXAsIHRoZSBqb2luIGZpbHRlciwgYW5kIHBhc3MgQlxuICogcGVyLXN1cnZpdmluZy1zcGFuIGBydW5Ub3VjaEhvb2tgIFx1MjAxNCBwbHVzIHRoZSB3aG9sZS1jb21tYW5kIGBpbnRlcnJ1cHRlZGBcbiAqIGdhdGUgKHBsYW4gXHUwMEE3NCkuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBSZXNvbHZlZFNwYW4sIFNwYW5NYXRjaCB9IGZyb20gJy4vcGFyc2UtY29tbWFuZC5qcyc7XG5pbXBvcnQgeyB0eXBlIE1lbW9TdG9yZSwgcmVzb2x2ZVRvdWNoU2NvcGUgfSBmcm9tICcuL3NwYW4tc3VyZmFjZS5qcyc7XG5pbXBvcnQge1xuICBjcmVhdGVSZWFsaXR5UHJvYmVDYWNoZSxcbiAgZXZhbHVhdGVXcml0ZUdhdGUsXG4gIGZpbGVFeGlzdHMsXG4gIHR5cGUgUmVhbGl0eVByb2JlQ2FjaGUsXG4gIHJ1blRvdWNoSG9vayxcbiAgdHlwZSBUb3VjaEV4ZWN1dG9ycyxcbiAgdHlwZSBUb3VjaElucHV0LFxuICB0eXBlIFdyaXRlR2F0ZU91dGNvbWVcbn0gZnJvbSAnLi90b3VjaC1jb3JlLmpzJztcblxuLyoqXG4gKiBUcmFuc2xhdGUgb25lIHJlc29sdmVkIHNwYW4gaW50byBhIGZ1bGx5LXR5cGVkIHtAbGluayBUb3VjaElucHV0fSBwZXIgdGhlXG4gKiBwbGFuIFx1MDBBNzIgdGFibGUsIG9yIGBudWxsYCB3aGVuIHRoZSBwYXRoIGZhaWxzIGByZXNvbHZlVG91Y2hTY29wZWAgXHUyMDE0IGNyb3NzLVxuICogcmVwbywgZ2l0aWdub3JlZCwgYW5kIHNwYW4tZG9jdW1lbnQgcGF0aHMgZmFpbCBjbG9zZWQuXG4gKlxuICogVGhlIHBvc3Qtc3RhdGUgZ2F0ZSBmaWVsZHMgdGhlIHNwYW4gY2FuIGRldGVybWluZSAoYHRhcmdldFN0YXRlYCwgYW5kXG4gKiBgcG9zdFN0YXRlYCBmb3IgYXBwZW5kcyBhbmQgZGVsZXRlcykgYXJlIHNldCBoZXJlOyBhIGxpdGVyYWwgb3ZlcndyaXRlIGJvZHlcbiAqIChgc3Bhbi53cml0dGVuYCBcdTIwMTQgdGhlIGZsYWctbGVzcyBgZWNob2AvYHByaW50ZmAgYD5gIGNhc2UpIHJpZGVzIGFzIHRoZVxuICogYGV4YWN0YCBwb3N0LWNvbnRlbnQgZXhwZWN0YXRpb24gc28gdGhlIGdhdGUgdmVyaWZpZXMgdGhlIHdyaXRlJ3MgZWZmZWN0XG4gKiB3aGlsZSB0aGUgdG91Y2ggaXRzZWxmIHN0YXlzIHdob2xlLWZpbGUgKHBsYW4gXHUwMEE3MyBzdGVwIDFiKS4gVHJ1bmNhdGVzIG1hcFxuICogdGhlIHNwYW4ncyBzdGF0aWNhbGx5IGV2YWx1YXRlZCBhYnNvbHV0ZSBgLXMgTmAgdG8gdGhlIGBzaXplYCBwb3N0LWNvbnRlbnRcbiAqIChgLXMgMGAgXHUyMTkyIGBlbXB0eWApOyBhIHRydW5jYXRlIHdpdGhvdXQgYSBzaXplIGdhdGVzIGV4aXN0ZW5jZS1vbmx5LiBUaGVcbiAqIGRyaXZlciBwYWlycyBjcC9pbnN0YWxsIGFuZCBtdiBzb3VyY2VzIG9udG8gdGhlIGRlc3RpbmF0aW9uIHRvdWNoZXNcbiAqIGFmdGVyd2FyZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJhc2hTcGFuVG9Ub3VjaChzcGFuOiBSZXNvbHZlZFNwYW4sIHNlc3Npb25JZDogc3RyaW5nLCBjd2Q6IHN0cmluZyk6IFRvdWNoSW5wdXQgfCBudWxsIHtcbiAgaWYgKCFyZXNvbHZlVG91Y2hTY29wZShjd2QsIHNwYW4uYWJzb2x1dGVQYXRoKSkgcmV0dXJuIG51bGw7XG4gIHN3aXRjaCAoc3Bhbi5vcGVyYXRpb24pIHtcbiAgICBjYXNlICdyZWFkJzpcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGtpbmQ6ICdyZWFkJyxcbiAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICBjd2QsXG4gICAgICAgIGZpbGVQYXRoOiBzcGFuLmFic29sdXRlUGF0aCxcbiAgICAgICAgb2Zmc2V0OiBzcGFuLmxpbmVTdGFydCxcbiAgICAgICAgbGltaXQ6XG4gICAgICAgICAgc3Bhbi5saW5lU3RhcnQgIT09IHVuZGVmaW5lZCAmJiBzcGFuLmxpbmVFbmQgIT09IHVuZGVmaW5lZCA/IHNwYW4ubGluZUVuZCAtIHNwYW4ubGluZVN0YXJ0ICsgMSA6IHVuZGVmaW5lZFxuICAgICAgfTtcbiAgICBjYXNlICdjcmVhdGUtb3ZlcndyaXRlJzpcbiAgICBjYXNlICdyZW5hbWUtY29weSc6XG4gICAgICAvLyBXaG9sZS1maWxlIHdyaXRlczogYHdyaXR0ZW46ICcnYCBzY29wZXMgdGhlIHRvdWNoIHRvIGV2ZXJ5IGNvdmVyaW5nXG4gICAgICAvLyBzcGFuIFx1MjAxNCB0cnVuY2F0aW5nIHdyaXRlcyBkZXN0cm95IGFuY2hvcnMgYmV5b25kIHRoZSBuZXcgRU9GICh0aGVcbiAgICAgIC8vIG1haW4tMjAwIEYyIGxlc3NvbikuIEEgbGl0ZXJhbCBib2R5IHJpZGVzIGFzIHRoZSBleGFjdCBwb3N0LWNvbnRlbnRcbiAgICAgIC8vIGV4cGVjdGF0aW9uIHNvIHRoZSBnYXRlIHZlcmlmaWVzIHRoZSB3cml0ZSdzIGVmZmVjdC5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGtpbmQ6ICd3cml0ZScsXG4gICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgY3dkLFxuICAgICAgICBmaWxlUGF0aDogc3Bhbi5hYnNvbHV0ZVBhdGgsXG4gICAgICAgIHdyaXR0ZW46ICcnLFxuICAgICAgICB0YXJnZXRTdGF0ZTogJ2V4aXN0cycsXG4gICAgICAgIHBvc3RTdGF0ZTogc3Bhbi53cml0dGVuICE9PSB1bmRlZmluZWQgPyB7IGNvbnRlbnQ6IHsgZXhhY3Q6IHNwYW4ud3JpdHRlbiB9IH0gOiB1bmRlZmluZWRcbiAgICAgIH07XG4gICAgY2FzZSAndHJ1bmNhdGUnOlxuICAgICAgLy8gU2FtZSB3aG9sZS1maWxlIHNjb3BlOyB0aGUgc2l6ZSBnYXRlIChwbGFuIFx1MDBBNzIsIFx1MDBBNzMgc3RlcCAxYikgdmVyaWZpZXNcbiAgICAgIC8vIHRoZSBwb3N0LWNvbW1hbmQgYnl0ZSBjb3VudCB3aGVuIHRoZSBzcGFuIGNhcnJpZXMgYSBzdGF0aWNhbGx5XG4gICAgICAvLyBldmFsdWF0ZWQgYWJzb2x1dGUgYC1zIE5gIChgLXMgMGAgXHUyMTkyIGVtcHR5KTsgd2l0aG91dCBvbmUgdGhlIGdhdGUgaXNcbiAgICAgIC8vIGV4aXN0ZW5jZS1vbmx5LlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogJ3dyaXRlJyxcbiAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICBjd2QsXG4gICAgICAgIGZpbGVQYXRoOiBzcGFuLmFic29sdXRlUGF0aCxcbiAgICAgICAgd3JpdHRlbjogJycsXG4gICAgICAgIHRhcmdldFN0YXRlOiAnZXhpc3RzJyxcbiAgICAgICAgcG9zdFN0YXRlOlxuICAgICAgICAgIHNwYW4uc2l6ZSA9PT0gMFxuICAgICAgICAgICAgPyB7IGNvbnRlbnQ6IHsgZW1wdHk6IHRydWUgfSB9XG4gICAgICAgICAgICA6IHNwYW4uc2l6ZSAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgICAgID8geyBjb250ZW50OiB7IHNpemU6IHNwYW4uc2l6ZSB9IH1cbiAgICAgICAgICAgICAgOiB1bmRlZmluZWRcbiAgICAgIH07XG4gICAgY2FzZSAnYXBwZW5kJzpcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGtpbmQ6ICd3cml0ZScsXG4gICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgY3dkLFxuICAgICAgICBmaWxlUGF0aDogc3Bhbi5hYnNvbHV0ZVBhdGgsXG4gICAgICAgIHdyaXR0ZW46IHNwYW4ud3JpdHRlbiA/PyAnJyxcbiAgICAgICAgdGFyZ2V0U3RhdGU6ICdleGlzdHMnLFxuICAgICAgICBwb3N0U3RhdGU6IHNwYW4ud3JpdHRlbiAhPT0gdW5kZWZpbmVkID8geyBjb250ZW50OiB7IHN1ZmZpeDogc3Bhbi53cml0dGVuIH0gfSA6IHVuZGVmaW5lZFxuICAgICAgfTtcbiAgICBjYXNlICdtb2RpZnknOlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogJ3dyaXRlJyxcbiAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICBjd2QsXG4gICAgICAgIGZpbGVQYXRoOiBzcGFuLmFic29sdXRlUGF0aCxcbiAgICAgICAgd3JpdHRlbjogJycsXG4gICAgICAgIHRhcmdldFN0YXRlOiAnZXhpc3RzJyxcbiAgICAgICAgcmFuZ2U6IHNwYW4ubGluZVN0YXJ0ICE9PSB1bmRlZmluZWQgPyB7IHN0YXJ0OiBzcGFuLmxpbmVTdGFydCwgZW5kOiBzcGFuLmxpbmVFbmQgPz8gc3Bhbi5saW5lU3RhcnQgfSA6IHVuZGVmaW5lZFxuICAgICAgfTtcbiAgICBjYXNlICdkZWxldGUnOlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogJ3dyaXRlJyxcbiAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICBjd2QsXG4gICAgICAgIGZpbGVQYXRoOiBzcGFuLmFic29sdXRlUGF0aCxcbiAgICAgICAgd3JpdHRlbjogJycsXG4gICAgICAgIHRhcmdldFN0YXRlOiAnYWJzZW50JyxcbiAgICAgICAgcG9zdFN0YXRlOiB7IHJlYWxEZWxldGU6IHRydWUgfVxuICAgICAgfTtcbiAgfVxufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhlIEJhc2ggYHRvb2xfcmVzcG9uc2VgIHNpZ25hbHMgdGhhdCB0aGUgY29tbWFuZCB3YXMgaW50ZXJydXB0ZWRcbiAqIChwbGFuIFx1MDBBNzQpLiBUaGUgU0RLIHR5cGVzIHRoZSByZXNwb25zZSBgdW5rbm93bmAgb24gYm90aCBhZGFwdGVycywgc28gdGhpc1xuICogaXMgYSBkZWZlbnNpdmUgcnVudGltZSBzaGFwZS1wcm9iZTogYW4gb2JqZWN0IGNhcnJ5aW5nIGEgdHJ1dGh5XG4gKiBgaW50ZXJydXB0ZWRgIGZpZWxkIGNsYXNzaWZpZXMgYXMgaW50ZXJydXB0ZWQ7IGFueSBvdGhlciBzaGFwZSAoc3RyaW5nLFxuICogbnVsbCwgb2JqZWN0IHdpdGhvdXQgdGhlIGZpZWxkKSBwcm9jZWVkcyBmYWlsLW9wZW4sIG1hdGNoaW5nIHRvZGF5J3NcbiAqIGJlaGF2aW9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYmFzaFJlc3BvbnNlSW50ZXJydXB0ZWQodG9vbFJlc3BvbnNlOiB1bmtub3duKTogYm9vbGVhbiB7XG4gIGlmICh0b29sUmVzcG9uc2UgIT09IG51bGwgJiYgdHlwZW9mIHRvb2xSZXNwb25zZSA9PT0gJ29iamVjdCcpIHtcbiAgICByZXR1cm4gQm9vbGVhbigodG9vbFJlc3BvbnNlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KS5pbnRlcnJ1cHRlZCk7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKipcbiAqIFRoZSBCYXNoIGB0b29sX3Jlc3BvbnNlYCdzIHByb2Nlc3MgZXhpdCBjb2RlLCB3aGVuIHRoZSBoYXJuZXNzIHN1cHBsaWVzXG4gKiBvbmUuIFRoZSBTREsgdHlwZXMgdGhlIHJlc3BvbnNlIGB1bmtub3duYCBvbiBib3RoIGFkYXB0ZXJzIGFuZCBDbGF1ZGUnc1xuICogQmFzaCBlbnZlbG9wZXMgZG8gbm90IGN1cnJlbnRseSBjYXJyeSBhbiBgZXhpdF9jb2RlYCBmaWVsZCwgc28gdGhpcyBpcyBhXG4gKiBkZWZlbnNpdmUgc2hhcGUtcHJvYmUgd2l0aCB0aGUgcGxhbiBcdTAwQTc0IGZhaWwtb3BlbiBwb3N0dXJlOiBwcmVzZW50IFx1MjE5MiB0aGVcbiAqIGludGVnZXIgY29kZSwgYWJzZW50IG9yIGFueSBvdGhlciBzaGFwZSBcdTIxOTIgdW5kZWZpbmVkLCBhbmQgdGhlIGNhbGxlclxuICogcHJvY2VlZHMgZXhhY3RseSBhcyB0b2RheS4gKFRoZSBob29rIHN1YnByb2Nlc3MncyBvd24gZXhpdCBzdGF0dXMgXHUyMDE0IHRoZVxuICogU0RLJ3MgYFNES0hvb2tSZXNwb25zZU1lc3NhZ2UuZXhpdF9jb2RlYCBcdTIwMTQgaXMgYSBkaWZmZXJlbnQgY2hhbm5lbCBhbmQgaXNcbiAqIG5ldmVyIHJlYWQgaGVyZS4pXG4gKlxuICogR3JhbnVsYXJpdHkgZWRnZSAoZG9jdW1lbnRlZCByZXNpZHVlKTogdGhlIGNvZGUgaXMgdGhlIHdob2xlIGNvbXBvdW5kXG4gKiBjb21tYW5kJ3MsIG5vdCBvbmUgc2ltcGxlIGNvbW1hbmQncyBcdTIwMTQgYSBtYXNrZWQgZmFpbHVyZSAoYGdpdCBhcHBseVxuICogcC5kaWZmIHx8IGVjaG8gb2tgIGV4aXRpbmcgMCkgc3VwcHJlc3NlcyBub3RoaW5nLCBhbmQgYSB0cmFpbGluZyBmYWlsdXJlXG4gKiAoYHNlZCAtaSBzL2EvYi8gZjsgZmFsc2VgIGV4aXRpbmcgMSkgc3VwcHJlc3NlcyB0aGUgZWFybGllciByZWFsIHdyaXRlLlxuICogQW5kIHRoZSBcImZhaWxlZCwgc28gdGhlIHdyaXRlIGRpZCBub3QgaGFwcGVuXCIgcHJlbWlzZSBiZWhpbmQgdGhlXG4gKiBzdXBwcmVzc2lvbiBob2xkcyBmb3IgYXRvbWljIGZhaWx1cmVzIChgZ2l0IGFwcGx5YCB3aXRob3V0IGAtLXJlamVjdGAsXG4gKiBwcmV0dGllciBvbiBhIHN5bnRheCBlcnJvcikgYnV0IG92ZXItc3VwcHJlc3NlcyB0aGUgbm9uLWF0b21pYyB3cml0ZXJzXG4gKiB0aGF0IG1vZGlmeSBiZWZvcmUgZmFpbGluZyBcdTIwMTQgR05VIGBwYXRjaGAgYXBwbHlpbmcgZWFybGllciBodW5rcywgYGdpdFxuICogYXBwbHkgLS1yZWplY3RgIHdyaXRpbmcgdGhlIGFwcGxpY2FibGUgaHVua3MgcGx1cyBgLnJlamAgZmlsZXMsIGFuZFxuICogZm9ybWF0dGVycyAoYGVzbGludCAtLWZpeGAsIGBydWJvY29wIC1hYCkgd3JpdGluZyB0aGVpciBmaXhlcyBiZWZvcmVcbiAqIGV4aXRpbmcgbm9uemVybyBvbiByZW1haW5pbmcgdmlvbGF0aW9ucy4gVGhhdCB3cm90ZS1idXQtbm9uemVybyBjb3JuZXIgaXNcbiAqIGFjY2VwdGVkIGFuZCBwaW5uZWQgYnkgdGhlIGdhdGUncyB0ZXN0cyByYXRoZXIgdGhhbiBjYXJ2ZWQgb3V0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gYmFzaFJlc3BvbnNlRXhpdENvZGUodG9vbFJlc3BvbnNlOiB1bmtub3duKTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHRvb2xSZXNwb25zZSAhPT0gbnVsbCAmJiB0eXBlb2YgdG9vbFJlc3BvbnNlID09PSAnb2JqZWN0Jykge1xuICAgIGNvbnN0IGNvZGUgPSAodG9vbFJlc3BvbnNlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KS5leGl0X2NvZGU7XG4gICAgaWYgKHR5cGVvZiBjb2RlID09PSAnbnVtYmVyJyAmJiBOdW1iZXIuaXNJbnRlZ2VyKGNvZGUpKSByZXR1cm4gY29kZTtcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRoZSBwZXItY29tbWFuZCB2ZXJkaWN0IGRyaXZlciAocGxhbiBcdTAwQTczIHN0ZXAgMilcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50eXBlIFJlc29sdmVkTWF0Y2ggPSBFeHRyYWN0PFNwYW5NYXRjaCwgeyBzdGF0dXM6ICdyZXNvbHZlZCcgfT47XG50eXBlIEd1YXJkTWF0Y2ggPSBFeHRyYWN0PFNwYW5NYXRjaCwgeyBzdGF0dXM6ICdidWlsdGluLWd1YXJkJyB9PjtcblxudHlwZSBWZXJkaWN0ID0gJ2ZhaWxlZCcgfCAnc3VjY2VlZGVkJyB8ICd1bmtub3duJztcblxuLyoqIE9uZSBwYXNzLUEgZXZhbHVhdGlvbjogdGhlIHNwYW4sIGl0cyB0b3VjaCwgYW5kIHRoZSAocG9zdC1yZXNvbHV0aW9uKSBnYXRlIG91dGNvbWUuICovXG5pbnRlcmZhY2UgU3BhbkV2YWwge1xuICBtYXRjaDogUmVzb2x2ZWRNYXRjaDtcbiAgLyoqIFRoZSB0cmFuc2xhdGVkIHRvdWNoLCBvciBgbnVsbGAgd2hlbiB0aGUgc3BhbiBmYWlsZWQgYHJlc29sdmVUb3VjaFNjb3BlYC4gKi9cbiAgdG91Y2g6IFRvdWNoSW5wdXQgfCBudWxsO1xuICAvKiogVGhlIHBhc3MtQSBnYXRlIG91dGNvbWUsIHBvc3QtcmVzb2x1dGlvbiBmb3IgYCdwZW5kaW5nJ2AgYW5kIGV4cGxhaW5lZCBmYWlscy4gKi9cbiAgb3V0Y29tZTogV3JpdGVHYXRlT3V0Y29tZTtcbiAgLyoqIEEgZGVjaXNpdmVGYWlsIGRvd25ncmFkZWQgYnkgYSBsYXRlciBzYW1lLXBhdGggZGVjaXNpdmVQYXNzIChwbGFuIFx1MDBBNzMgc3RlcCAyKS4gKi9cbiAgZXhwbGFpbmVkOiBib29sZWFuO1xuICBjb21tYW5kSW5kZXg6IG51bWJlcjtcbiAgLyoqIFRoZSBzcGFuJ3Mgb3duIHBhdGggXHUyMDE0IHRoZSBleHBsYW5hdGlvbiBrZXkgZm9yIGRlY2lzaXZlIGZhaWxzLiAqL1xuICBwYXRoOiBzdHJpbmc7XG4gIC8qKiBjcCBkZXN0aW5hdGlvbnM6IHRoZSBwYWlyZWQgc291cmNlIHBhdGggXHUyMDE0IHRoZSBleHBsYW5hdGlvbiBrZXkgZm9yIHBlbmRpbmdzLiAqL1xuICBzb3VyY2VLZXk6IHN0cmluZyB8IG51bGw7XG59XG5cbi8qKlxuICogRXZhbHVhdGUgb25lIHNwYW4ncyBnYXRlLiBSZWFkcyBoYXZlIG5vIGdhdGUgXHUyMTkyIGAnaW5jb25jbHVzaXZlJ2AsIHdpdGggb25lXG4gKiBleGNlcHRpb246IGNwL2luc3RhbGwgc291cmNlIHJlYWRzIGdhdGUgb24gdGhlIHNvdXJjZSBleGlzdGluZyBwb3N0LWNvbW1hbmRcbiAqIChwbGFuIFx1MDBBNzIpIFx1MjAxNCBhIGZhaWxlZCBjb3B5IG5ldmVyIHJlYWQgYW55dGhpbmcuIFRoZSByZWFkIHZlcmRpY3QgZmxpcHMgb25seVxuICogdGhlIGNvbW1hbmQncyBqb2luIHZlcmRpY3QsIG5ldmVyIHRoZSBzYW1lIGNvbW1hbmQncyBkZXN0IHdyaXRlLlxuICovXG5mdW5jdGlvbiBldmFsU3BhbkdhdGUobWF0Y2g6IFJlc29sdmVkTWF0Y2gsIHRvdWNoOiBUb3VjaElucHV0IHwgbnVsbCwgcHJvYmVDYWNoZTogUmVhbGl0eVByb2JlQ2FjaGUpOiBXcml0ZUdhdGVPdXRjb21lIHtcbiAgaWYgKHRvdWNoID09PSBudWxsKSByZXR1cm4gJ2luY29uY2x1c2l2ZSc7XG4gIGlmICh0b3VjaC5raW5kID09PSAncmVhZCcpIHtcbiAgICBpZiAoKG1hdGNoLmlkaW9tID09PSAnY3Atd3JpdGUnIHx8IG1hdGNoLmlkaW9tID09PSAnaW5zdGFsbC13cml0ZScpICYmIG1hdGNoLnNwYW4ub3BlcmF0aW9uID09PSAncmVhZCcpIHtcbiAgICAgIHJldHVybiBmaWxlRXhpc3RzKG1hdGNoLnNwYW4uYWJzb2x1dGVQYXRoKSA/ICdpbmNvbmNsdXNpdmUnIDogJ2RlY2lzaXZlRmFpbCc7XG4gICAgfVxuICAgIHJldHVybiAnaW5jb25jbHVzaXZlJztcbiAgfVxuICByZXR1cm4gZXZhbHVhdGVXcml0ZUdhdGUodG91Y2gsIHByb2JlQ2FjaGUpO1xufVxuXG4vKiogVGhlIG9wZXJhdG9yIHByZWNlZGluZyBhIGNvbW1hbmQsIGZyb20gaXRzIGZpcnN0IHNwYW4gKGFsbCBzcGFucyBvZiBvbmUgY29tbWFuZCBzaGFyZSBpdCkgXHUyMDE0IG9yIGZyb20gaXRzIGd1YXJkIG1hdGNoIHdoZW4gdGhlIGNvbW1hbmQgaGFzIG5vIHNwYW5zLiAqL1xuZnVuY3Rpb24gam9pbk9mQ29tbWFuZChcbiAgaWR4OiBudW1iZXIsXG4gIGdyb3VwczogTWFwPG51bWJlciwgUmVzb2x2ZWRNYXRjaFtdPixcbiAgZ3VhcmRCeUluZGV4OiBNYXA8bnVtYmVyLCBHdWFyZE1hdGNoPlxuKTogJyYmJyB8ICd8fCcgfCB1bmRlZmluZWQge1xuICBjb25zdCBzcGFucyA9IGdyb3Vwcy5nZXQoaWR4KTtcbiAgaWYgKHNwYW5zICE9PSB1bmRlZmluZWQpIHtcbiAgICBmb3IgKGNvbnN0IG0gb2Ygc3BhbnMpIHtcbiAgICAgIGlmIChtLnNwYW4uam9pbiAhPT0gdW5kZWZpbmVkKSByZXR1cm4gbS5zcGFuLmpvaW47XG4gICAgfVxuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgcmV0dXJuIGd1YXJkQnlJbmRleC5nZXQoaWR4KT8uam9pbjtcbn1cblxuLyoqXG4gKiBTaGFyZWQgQmFzaCBkcml2ZXIgKHBsYW4gXHUwMEE3MyBzdGVwIDIpOiBvd25zIHRoZSBwZXItY29tbWFuZCB2ZXJkaWN0IHRocmVhZCBcdTIwMTRcbiAqIHBhc3MgQSBgZXZhbHVhdGVXcml0ZUdhdGVgIHN3ZWVwIChldmVyeSBzcGFuLCBiZWZvcmUgYW55IGpvaW4gZGVjaXNpb24pLFxuICogdGhlIGV4cGxhbmF0aW9uIG1hcCwgcGVyLWNvbW1hbmQgdmVyZGljdHMsIHRoZSBqb2luIGZpbHRlciB3aXRoIGNoYWluZWRcbiAqIHNraXBzLCBhbmQgcGFzcyBCIHBlci1zdXJ2aXZpbmctc3BhbiBgcnVuVG91Y2hIb29rYCBcdTIwMTQgcGx1cyB0aGUgd2hvbGUtY29tbWFuZFxuICogYGludGVycnVwdGVkYCBhbmQgZXhpdC1jb2RlIGdhdGVzIChwbGFuIFx1MDBBNzQpIGFuZCB0aGUgc3Bhbi1sZXNzLWd1YXJkXG4gKiBjb21tYW5kcyAoYGZhbHNlYC9gdHJ1ZWAvYDpgIGpvaW4gdmVyZGljdHMgd2l0aCBubyBzcGFucyBvZiB0aGVpciBvd24pLlxuICogUmV0dXJucyB0aGUgbm9uLW51bGwgYGFkZGl0aW9uYWxDb250ZXh0YCBibG9ja3MgZm9yIHRoZSBhZGFwdGVyIHRvIGpvaW47XG4gKiB0aGUgc2Vzc2lvbiBtZW1vIGRlZHVwcyByZXBlYXRlZCB0YXJnZXRzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuQmFzaFRvdWNoZXMoXG4gIG1hdGNoZXM6IFNwYW5NYXRjaFtdLFxuICBzZXNzaW9uSWQ6IHN0cmluZyxcbiAgY3dkOiBzdHJpbmcsXG4gIHRvb2xSZXNwb25zZTogdW5rbm93bixcbiAgZXhlY3V0b3JzOiBUb3VjaEV4ZWN1dG9ycyxcbiAgbWVtbzogTWVtb1N0b3JlLFxuICB3YXJuOiAobWVzc2FnZTogc3RyaW5nKSA9PiB2b2lkID0gY29uc29sZS53YXJuXG4pOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIC8vIEEgY29tbWFuZCB0aGF0IGRpZCBub3QgY29tcGxldGUgcHJvZHVjZXMgbm8gdG91Y2hlcywgd2hhdGV2ZXIgaXRzIHNwYW5zLlxuICBpZiAoYmFzaFJlc3BvbnNlSW50ZXJydXB0ZWQodG9vbFJlc3BvbnNlKSkgcmV0dXJuIFtdO1xuICBjb25zdCBleGl0Q29kZSA9IGJhc2hSZXNwb25zZUV4aXRDb2RlKHRvb2xSZXNwb25zZSk7XG4gIGNvbnN0IHJlc29sdmVkID0gbWF0Y2hlcy5maWx0ZXIoKG0pOiBtIGlzIFJlc29sdmVkTWF0Y2ggPT4gbS5zdGF0dXMgPT09ICdyZXNvbHZlZCcpO1xuICBjb25zdCBndWFyZHMgPSBtYXRjaGVzLmZpbHRlcigobSk6IG0gaXMgR3VhcmRNYXRjaCA9PiBtLnN0YXR1cyA9PT0gJ2J1aWx0aW4tZ3VhcmQnKTtcbiAgaWYgKHJlc29sdmVkLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuXG4gIC8vIFNlZWQgdGhlIHBlci1jb21tYW5kIHByb2JlIGNhY2hlIChwbGFuIFx1MDBBNzMgc3RlcCAxYykgd2l0aCBldmVyeSBhYnNlbnRcbiAgLy8gdGFyZ2V0IGFuZCBjcC9pbnN0YWxsIHNvdXJjZSBvZiB0aGUgY29tcG91bmQ7IHRoZSBmaXJzdCBnYXRlIHRoYXQgbmVlZHNcbiAgLy8gaXQgcnVucyBvbmUgbHMtZmlsZXMgKyBvbmUgc3Bhbi1saXN0IGJhdGNoIGZvciBhbGwgb2YgdGhlbS5cbiAgY29uc3QgcHJvYmVQYXRoczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBtIG9mIHJlc29sdmVkKSB7XG4gICAgaWYgKG0uc3Bhbi5vcGVyYXRpb24gPT09ICdkZWxldGUnKSBwcm9iZVBhdGhzLnB1c2gobS5zcGFuLmFic29sdXRlUGF0aCk7XG4gICAgZWxzZSBpZiAoKG0uaWRpb20gPT09ICdjcC13cml0ZScgfHwgbS5pZGlvbSA9PT0gJ2luc3RhbGwtd3JpdGUnKSAmJiBtLnNwYW4ub3BlcmF0aW9uID09PSAncmVhZCcpIHtcbiAgICAgIHByb2JlUGF0aHMucHVzaChtLnNwYW4uYWJzb2x1dGVQYXRoKTtcbiAgICB9XG4gIH1cbiAgY29uc3QgcHJvYmVDYWNoZSA9IGNyZWF0ZVJlYWxpdHlQcm9iZUNhY2hlKHByb2JlUGF0aHMpO1xuXG4gIC8vIEdyb3VwIGJ5IHNpbXBsZSBjb21tYW5kIGluIHdhbGtlciBvcmRlci4gU3Bhbi1sZXNzIGd1YXJkIGNvbW1hbmRzXG4gIC8vIChgZmFsc2VgL2B0cnVlYC9gOmApIGpvaW4gdGhlIG9yZGVyIHdpdGggbm8gZ3JvdXA6IHRoZWlyIGRldGVybWluaXN0aWNcbiAgLy8gZXhpdCBzdGF0dXMgZHJpdmVzIHRoZSBqb2luIGZpbHRlciwgYW5kIHRoZXkgbmV2ZXIgdG91Y2ggYW55dGhpbmcuXG4gIGNvbnN0IGdyb3VwcyA9IG5ldyBNYXA8bnVtYmVyLCBSZXNvbHZlZE1hdGNoW10+KCk7XG4gIGNvbnN0IGd1YXJkQnlJbmRleCA9IG5ldyBNYXA8bnVtYmVyLCBHdWFyZE1hdGNoPigpO1xuICBjb25zdCBjb21tYW5kT3JkZXI6IG51bWJlcltdID0gW107XG4gIGZvciAoY29uc3QgbSBvZiByZXNvbHZlZCkge1xuICAgIGNvbnN0IGlkeCA9IG0uc3Bhbi5zaW1wbGVDb21tYW5kSW5kZXg7XG4gICAgY29uc3QgbGlzdCA9IGdyb3Vwcy5nZXQoaWR4KTtcbiAgICBpZiAobGlzdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBsaXN0LnB1c2gobSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGdyb3Vwcy5zZXQoaWR4LCBbbV0pO1xuICAgICAgY29tbWFuZE9yZGVyLnB1c2goaWR4KTtcbiAgICB9XG4gIH1cbiAgZm9yIChjb25zdCBnIG9mIGd1YXJkcykge1xuICAgIGlmIChncm91cHMuaGFzKGcuc2ltcGxlQ29tbWFuZEluZGV4KSB8fCBndWFyZEJ5SW5kZXguaGFzKGcuc2ltcGxlQ29tbWFuZEluZGV4KSkgY29udGludWU7XG4gICAgZ3VhcmRCeUluZGV4LnNldChnLnNpbXBsZUNvbW1hbmRJbmRleCwgZyk7XG4gICAgY29tbWFuZE9yZGVyLnB1c2goZy5zaW1wbGVDb21tYW5kSW5kZXgpO1xuICB9XG4gIGNvbW1hbmRPcmRlci5zb3J0KChhLCBiKSA9PiBhIC0gYik7XG5cbiAgLy8gUGFzcyBBOiB0cmFuc2xhdGUgZXZlcnkgc3BhbiBvbmNlIGFuZCBldmFsdWF0ZSBpdHMgZ2F0ZSwgcGFpcmluZ1xuICAvLyBjcC9pbnN0YWxsIHNvdXJjZXMgd2l0aCBkZXN0aW5hdGlvbnMgYW5kIG12IGRlbGV0ZXMgd2l0aCByZW5hbWUtY29waWVzIGJ5XG4gIC8vIGRlY2xhcmF0aW9uIG9yZGVyICh0aGUgcGFyc2VyIGVtaXRzIHNvdXJjZXMgYmVmb3JlIGRlc3RpbmF0aW9ucykuXG4gIGNvbnN0IGV2YWxzID0gbmV3IE1hcDxudW1iZXIsIFNwYW5FdmFsW10+KCk7XG4gIGZvciAoY29uc3QgaWR4IG9mIGNvbW1hbmRPcmRlcikge1xuICAgIGNvbnN0IHNwYW5zID0gZ3JvdXBzLmdldChpZHgpO1xuICAgIGlmIChzcGFucyA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTsgLy8gZ3VhcmQtb25seSBjb21tYW5kIFx1MjAxNCBub3RoaW5nIHRvIGV2YWx1YXRlXG4gICAgY29uc3QgcmVhZFBhdGhzID0gc3BhbnNcbiAgICAgIC5maWx0ZXIoKG0pID0+IChtLmlkaW9tID09PSAnY3Atd3JpdGUnIHx8IG0uaWRpb20gPT09ICdpbnN0YWxsLXdyaXRlJykgJiYgbS5zcGFuLm9wZXJhdGlvbiA9PT0gJ3JlYWQnKVxuICAgICAgLm1hcCgobSkgPT4gbS5zcGFuLmFic29sdXRlUGF0aCk7XG4gICAgY29uc3QgZGVsZXRlUGF0aHMgPSBzcGFucy5maWx0ZXIoKG0pID0+IG0uc3Bhbi5vcGVyYXRpb24gPT09ICdkZWxldGUnKS5tYXAoKG0pID0+IG0uc3Bhbi5hYnNvbHV0ZVBhdGgpO1xuICAgIGxldCByZWFkQ3Vyc29yID0gMDtcbiAgICBsZXQgZGVsZXRlQ3Vyc29yID0gMDtcbiAgICBjb25zdCBsaXN0OiBTcGFuRXZhbFtdID0gW107XG4gICAgZm9yIChjb25zdCBtIG9mIHNwYW5zKSB7XG4gICAgICBjb25zdCB0b3VjaCA9IGJhc2hTcGFuVG9Ub3VjaChtLnNwYW4sIHNlc3Npb25JZCwgY3dkKTtcbiAgICAgIGNvbnN0IGVudHJ5OiBTcGFuRXZhbCA9IHtcbiAgICAgICAgbWF0Y2g6IG0sXG4gICAgICAgIHRvdWNoLFxuICAgICAgICBvdXRjb21lOiAnaW5jb25jbHVzaXZlJyxcbiAgICAgICAgZXhwbGFpbmVkOiBmYWxzZSxcbiAgICAgICAgY29tbWFuZEluZGV4OiBpZHgsXG4gICAgICAgIHBhdGg6IG0uc3Bhbi5hYnNvbHV0ZVBhdGgsXG4gICAgICAgIHNvdXJjZUtleTogbnVsbFxuICAgICAgfTtcbiAgICAgIGlmICh0b3VjaCAhPT0gbnVsbCAmJiB0b3VjaC5raW5kID09PSAnd3JpdGUnKSB7XG4gICAgICAgIGlmIChtLnNwYW4ub3BlcmF0aW9uID09PSAnY3JlYXRlLW92ZXJ3cml0ZScgJiYgKG0uaWRpb20gPT09ICdjcC13cml0ZScgfHwgbS5pZGlvbSA9PT0gJ2luc3RhbGwtd3JpdGUnKSkge1xuICAgICAgICAgIGNvbnN0IHNvdXJjZSA9IHJlYWRQYXRoc1tyZWFkQ3Vyc29yXTtcbiAgICAgICAgICBpZiAoc291cmNlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHJlYWRDdXJzb3IgKz0gMTtcbiAgICAgICAgICAgIC8vIGBpbnN0YWxsIC1zYC9gLS1zdHJpcGAgaXMgZGVsaWJlcmF0ZWx5IG5ldmVyIHBhaXJlZDogc3RyaXBwZWRcbiAgICAgICAgICAgIC8vIG91dHB1dCBuZXZlciBlcXVhbHMgdGhlIHNvdXJjZSwgc28gaW5zdGFsbCBkZXN0cyBnYXRlXG4gICAgICAgICAgICAvLyBleGlzdGVuY2Utb25seSAocGxhbiBcdTAwQTczIHN0ZXAgMWIpLlxuICAgICAgICAgICAgaWYgKG0uaWRpb20gPT09ICdjcC13cml0ZScpIHtcbiAgICAgICAgICAgICAgdG91Y2guc291cmNlUGF0aCA9IHNvdXJjZTtcbiAgICAgICAgICAgICAgZW50cnkuc291cmNlS2V5ID0gc291cmNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChtLnNwYW4ub3BlcmF0aW9uID09PSAncmVuYW1lLWNvcHknKSB7XG4gICAgICAgICAgY29uc3Qgc291cmNlID0gZGVsZXRlUGF0aHNbZGVsZXRlQ3Vyc29yXTtcbiAgICAgICAgICBpZiAoc291cmNlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGRlbGV0ZUN1cnNvciArPSAxO1xuICAgICAgICAgICAgdG91Y2gucmVuYW1lU291cmNlUGF0aCA9IHNvdXJjZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGVudHJ5Lm91dGNvbWUgPSBldmFsU3BhbkdhdGUobSwgdG91Y2gsIHByb2JlQ2FjaGUpO1xuICAgICAgbGlzdC5wdXNoKGVudHJ5KTtcbiAgICB9XG4gICAgZXZhbHMuc2V0KGlkeCwgbGlzdCk7XG4gIH1cblxuICAvLyBUaGUgZXhwbGFuYXRpb24gbWFwIChwbGFuIFx1MDBBNzMgc3RlcCAyKTogdGhlIGhpZ2hlc3Qgc2ltcGxlQ29tbWFuZEluZGV4IHdpdGhcbiAgLy8gYSBkZWNpc2l2ZVBhc3Mgb24gZWFjaCBwYXRoLlxuICBjb25zdCBwYXNzQnlQYXRoID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcbiAgZm9yIChjb25zdCBpZHggb2YgY29tbWFuZE9yZGVyKSB7XG4gICAgY29uc3QgbGlzdCA9IGV2YWxzLmdldChpZHgpO1xuICAgIGlmIChsaXN0ID09PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xuICAgIGZvciAoY29uc3QgZSBvZiBsaXN0KSB7XG4gICAgICBpZiAoZS5vdXRjb21lID09PSAnZGVjaXNpdmVQYXNzJykge1xuICAgICAgICBjb25zdCBwcmV2ID0gcGFzc0J5UGF0aC5nZXQoZS5wYXRoKTtcbiAgICAgICAgaWYgKHByZXYgPT09IHVuZGVmaW5lZCB8fCBpZHggPiBwcmV2KSBwYXNzQnlQYXRoLnNldChlLnBhdGgsIGlkeCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gUmVzb2x2ZSB0aGUgYWJzZW50LXNvdXJjZSBob2xkcyBhZ2FpbnN0IHRoZSBub3ctY29tcGxldGUgbWFwLCBhbmRcbiAgLy8gZG93bmdyYWRlIGV4cGxhaW5lZCBmYWlsczogYSBkZWNpc2l2ZUZhaWwgb24gYSBwYXRoIGEgbGF0ZXIgY29tbWFuZFxuICAvLyBkZW1vbnN0cmFibHkgcmV3cm90ZSBvciBkZWxldGVkIGlzIHRoZSBvdmVyd3JpdGUsIG5vdCB0aGUgZWFybGllciBjb21tYW5kXG4gIC8vIGZhaWxpbmcgKHBsYW4gXHUwMEE3MyBzdGVwIDIpLlxuICBmb3IgKGNvbnN0IGlkeCBvZiBjb21tYW5kT3JkZXIpIHtcbiAgICBjb25zdCBsaXN0ID0gZXZhbHMuZ2V0KGlkeCk7XG4gICAgaWYgKGxpc3QgPT09IHVuZGVmaW5lZCkgY29udGludWU7XG4gICAgZm9yIChjb25zdCBlIG9mIGxpc3QpIHtcbiAgICAgIGlmIChlLm91dGNvbWUgPT09ICdwZW5kaW5nJykge1xuICAgICAgICBjb25zdCBwYXNzSWR4ID0gZS5zb3VyY2VLZXkgIT09IG51bGwgPyBwYXNzQnlQYXRoLmdldChlLnNvdXJjZUtleSkgOiB1bmRlZmluZWQ7XG4gICAgICAgIGUub3V0Y29tZSA9IHBhc3NJZHggIT09IHVuZGVmaW5lZCAmJiBwYXNzSWR4ID4gZS5jb21tYW5kSW5kZXggPyAnZGVjaXNpdmVQYXNzJyA6ICdkZWNpc2l2ZUZhaWwnO1xuICAgICAgfSBlbHNlIGlmIChlLm91dGNvbWUgPT09ICdkZWNpc2l2ZUZhaWwnKSB7XG4gICAgICAgIGNvbnN0IHBhc3NJZHggPSBwYXNzQnlQYXRoLmdldChlLnBhdGgpO1xuICAgICAgICBpZiAocGFzc0lkeCAhPT0gdW5kZWZpbmVkICYmIHBhc3NJZHggPiBlLmNvbW1hbmRJbmRleCkgZS5leHBsYWluZWQgPSB0cnVlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIFBlci1jb21tYW5kIHZlcmRpY3RzOiAnZmFpbGVkJyBvbiBhbnkgdW5leHBsYWluZWQgZGVjaXNpdmVGYWlsLCBlbHNlXG4gIC8vICdzdWNjZWVkZWQnIG9uIGF0IGxlYXN0IG9uZSBkZWNpc2l2ZSBvdXRjb21lLCBlbHNlICd1bmtub3duJy4gQVxuICAvLyBndWFyZC1vbmx5IGNvbW1hbmQncyBkZXRlcm1pbmlzdGljIGV4aXQgc3RhdHVzIElTIGl0cyB2ZXJkaWN0IChwbGFuIFx1MDBBNzNcbiAgLy8gc3RlcCAyJ3Mgc3Bhbi1sZXNzLWd1YXJkIHJ1bGUpLlxuICBjb25zdCBjb21wdXRlZCA9IG5ldyBNYXA8bnVtYmVyLCBWZXJkaWN0PigpO1xuICBmb3IgKGNvbnN0IGlkeCBvZiBjb21tYW5kT3JkZXIpIHtcbiAgICBjb25zdCBsaXN0ID0gZXZhbHMuZ2V0KGlkeCk7XG4gICAgaWYgKGxpc3QgPT09IHVuZGVmaW5lZCkge1xuICAgICAgY29uc3QgZ3VhcmQgPSBndWFyZEJ5SW5kZXguZ2V0KGlkeCk7XG4gICAgICBjb21wdXRlZC5zZXQoaWR4LCBndWFyZCAhPT0gdW5kZWZpbmVkID8gKGd1YXJkLmV4aXRTdGF0dXMgPT09IDAgPyAnc3VjY2VlZGVkJyA6ICdmYWlsZWQnKSA6ICd1bmtub3duJyk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgbGV0IGZhaWxlZCA9IGZhbHNlO1xuICAgIGxldCBwYXNzZWQgPSBmYWxzZTtcbiAgICBmb3IgKGNvbnN0IGUgb2YgbGlzdCkge1xuICAgICAgaWYgKGUub3V0Y29tZSA9PT0gJ2RlY2lzaXZlRmFpbCcgJiYgIWUuZXhwbGFpbmVkKSBmYWlsZWQgPSB0cnVlO1xuICAgICAgaWYgKGUub3V0Y29tZSA9PT0gJ2RlY2lzaXZlUGFzcycpIHBhc3NlZCA9IHRydWU7XG4gICAgfVxuICAgIGNvbXB1dGVkLnNldChpZHgsIGZhaWxlZCA/ICdmYWlsZWQnIDogcGFzc2VkID8gJ3N1Y2NlZWRlZCcgOiAndW5rbm93bicpO1xuICB9XG5cbiAgLy8gVGhlIGpvaW4gZmlsdGVyIChwbGFuIFx1MDBBNzMgc3RlcCAyKTogYSBza2lwcGVkIGNvbW1hbmQncyBjaGFpbmVkIHZlcmRpY3QgaXNcbiAgLy8gdGhlIGd1YXJkIHRoYXQgc2tpcHBlZCBpdCBcdTIwMTQgJ2ZhaWxlZCcgYWZ0ZXIgYW4gJiYtc2tpcCwgJ3N1Y2NlZWRlZCcgYWZ0ZXJcbiAgLy8gYW4gfHwtc2tpcCBcdTIwMTQgbWF0Y2hpbmcgdGhlIHNoZWxsIHNob3J0LWNpcmN1aXQgKGEgfHwgYiB8fCBjIHN0b3BzIGFmdGVyXG4gIC8vIHRoZSBmaXJzdCBzdWNjZXNzKS4gJ3Vua25vd24nIGZhaWxzIG9wZW4uXG4gIGNvbnN0IGVmZmVjdGl2ZSA9IG5ldyBNYXA8bnVtYmVyLCBWZXJkaWN0PigpO1xuICBjb25zdCBza2lwcGVkID0gbmV3IFNldDxudW1iZXI+KCk7XG4gIGxldCBwcmV2SW5kZXg6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICBmb3IgKGNvbnN0IGlkeCBvZiBjb21tYW5kT3JkZXIpIHtcbiAgICBjb25zdCBqb2luID0gam9pbk9mQ29tbWFuZChpZHgsIGdyb3VwcywgZ3VhcmRCeUluZGV4KTtcbiAgICBjb25zdCBwcmV2VmVyZGljdCA9IHByZXZJbmRleCAhPT0gbnVsbCA/IGVmZmVjdGl2ZS5nZXQocHJldkluZGV4KSA6IHVuZGVmaW5lZDtcbiAgICBpZiAocHJldlZlcmRpY3QgIT09IHVuZGVmaW5lZCAmJiBqb2luICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmICgoam9pbiA9PT0gJyYmJyAmJiBwcmV2VmVyZGljdCA9PT0gJ2ZhaWxlZCcpIHx8IChqb2luID09PSAnfHwnICYmIHByZXZWZXJkaWN0ID09PSAnc3VjY2VlZGVkJykpIHtcbiAgICAgICAgZWZmZWN0aXZlLnNldChpZHgsIGpvaW4gPT09ICcmJicgPyAnZmFpbGVkJyA6ICdzdWNjZWVkZWQnKTtcbiAgICAgICAgc2tpcHBlZC5hZGQoaWR4KTtcbiAgICAgICAgcHJldkluZGV4ID0gaWR4O1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgZWZmZWN0aXZlLnNldChpZHgsIGNvbXB1dGVkLmdldChpZHgpISk7XG4gICAgcHJldkluZGV4ID0gaWR4O1xuICB9XG5cbiAgLy8gUGFzcyBCOiBydW4gdGhlIHRvdWNoIGhvb2sgZm9yIHN1cnZpdmluZyBzcGFucyBvbmx5IFx1MjAxNCBkZWNpc2l2ZVBhc3MsIG9yXG4gIC8vIGluY29uY2x1c2l2ZSB3aXRoIGFuICdleGlzdHMnIHRhcmdldCAodGhlIGFkdmlzb3J5IHJlc2lkdWFsIGNsYXNzOlxuICAvLyBleGlzdGVuY2UtZ2F0ZWQgZmFtaWxpZXMgZmlyZSBhbmQgaGVhbC9zdXJmYWNlOyBwaGFudG9tIGRlbGV0ZXMgbmV2ZXJcbiAgLy8gZmlyZSkuIEEgaGFybmVzcy1zdXBwbGllZCBub24temVybyBleGl0IGNvZGUgc3VwcHJlc3NlcyB0aGUgYWR2aXNvcnlcbiAgLy8gY2xhc3MgdG9vOiB0aGUgY29tbWFuZCBmYWlsZWQsIHNvIHRoZSBleGlzdGVuY2UtZ2F0ZWQgd3JpdGUgKHNlZCAtaSxcbiAgLy8gcGF0Y2gsIGdpdCBhcHBseSwgZm9ybWF0dGVyKSBkaWQgbm90IGNvbXBsZXRlLiBUaGF0IHByZW1pc2UgaXMgZXhhY3RcbiAgLy8gZm9yIGF0b21pYyBmYWlsdXJlcyBhbmQgb3Zlci1zdXBwcmVzc2VzIHRoZSBub24tYXRvbWljIHdyaXRlcnMgdGhhdFxuICAvLyBtb2RpZnkgYmVmb3JlIGZhaWxpbmcgKHBhdGNoIGFwcGx5aW5nIGVhcmxpZXIgaHVua3MsIGBnaXQgYXBwbHlcbiAgLy8gLS1yZWplY3RgLCBmb3JtYXR0ZXJzIHdyaXRpbmcgZml4ZXMgdGhlbiBleGl0aW5nIG5vbnplcm8pIFx1MjAxNCB0aGVcbiAgLy8gd3JvdGUtYnV0LW5vbnplcm8gcmVzaWR1ZSBwaW5uZWQgYnkgdGhlIGdhdGUncyB0ZXN0cyAoc2VlXG4gIC8vIGJhc2hSZXNwb25zZUV4aXRDb2RlKTsgYSB6ZXJvIG9yIGFic2VudCBjb2RlIHByb2NlZWRzLCBhbmRcbiAgLy8gY29udGVudC12ZXJpZmllZCBkZWNpc2l2ZSBwYXNzZXMgZmlyZSByZWdhcmRsZXNzIChmYWlsLW9wZW4sIHBsYW4gXHUwMEE3NCkuXG4gIC8vIEd1YXJkLW9ubHkgY29tbWFuZHMgaGF2ZSBubyB0b3VjaGVzLiBFeHBsYWluZWQgZmFpbHMgYW5kIGRlY2lzaXZlXG4gIC8vIGZhaWxzIG5ldmVyIHJlYWNoIGFuIGV4ZWN1dG9yLlxuICBjb25zdCBibG9ja3M6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgaWR4IG9mIGNvbW1hbmRPcmRlcikge1xuICAgIGlmIChza2lwcGVkLmhhcyhpZHgpKSBjb250aW51ZTtcbiAgICBjb25zdCBsaXN0ID0gZXZhbHMuZ2V0KGlkeCk7XG4gICAgaWYgKGxpc3QgPT09IHVuZGVmaW5lZCkgY29udGludWU7XG4gICAgbGV0IHRvdWNoZXMgPSAwO1xuICAgIGZvciAoY29uc3QgZSBvZiBsaXN0KSB7XG4gICAgICBpZiAoZS50b3VjaCA9PT0gbnVsbCB8fCBlLmV4cGxhaW5lZCkgY29udGludWU7XG4gICAgICBpZiAoZS5vdXRjb21lID09PSAnZGVjaXNpdmVGYWlsJykgY29udGludWU7XG4gICAgICBpZiAoZS5vdXRjb21lID09PSAnaW5jb25jbHVzaXZlJyAmJiBlLnRvdWNoLmtpbmQgPT09ICd3cml0ZScgJiYgZS50b3VjaC50YXJnZXRTdGF0ZSA9PT0gJ2Fic2VudCcpIGNvbnRpbnVlO1xuICAgICAgaWYgKGUub3V0Y29tZSA9PT0gJ2luY29uY2x1c2l2ZScgJiYgZS50b3VjaC5raW5kID09PSAnd3JpdGUnICYmIGV4aXRDb2RlICE9PSB1bmRlZmluZWQgJiYgZXhpdENvZGUgIT09IDApXG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgaWYgKHRvdWNoZXMgPj0gMzIpIHtcbiAgICAgICAgLy8gSGFyZCBwZXItY29tbWFuZCB2b2x1bWUgY2FwIChwbGFuIFx1MDBBNzMgc3RlcCAyKTogZHJvcCB0aGUgc3VycGx1cyB3aXRoXG4gICAgICAgIC8vIGEgd2FybmluZyByYXRoZXIgdGhhbiBibG93IHRoZSBob29rIHRpbWVvdXQgb24gYSA1MC1jb3B5IGNoYWluLlxuICAgICAgICB3YXJuKGBCYXNoIHRvdWNoIGNhcCAoMzIpIHJlYWNoZWQgZm9yIHNpbXBsZSBjb21tYW5kICR7aWR4fTsgZHJvcHBpbmcgdGhlIHJlbWFpbmluZyB0b3VjaGVzYCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgdG91Y2hlcyArPSAxO1xuICAgICAgY29uc3Qgb3V0cHV0ID0gYXdhaXQgcnVuVG91Y2hIb29rKGUudG91Y2gsIGV4ZWN1dG9ycywgbWVtbywgcHJvYmVDYWNoZSk7XG4gICAgICBpZiAob3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KSBibG9ja3MucHVzaChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gYmxvY2tzO1xufVxuIiwgIi8qKlxuICogU3RhdGljIGNsYXNzaWZpY2F0aW9uIG9mIGEgQmFzaCB0b29sIGBjb21tYW5kYCBzdHJpbmcgaW50byB0aGUgZmlsZVxuICogcGF0aChzKSArIGxpbmUgcmFuZ2UocykgaXQgcmVhZHMgb3Igd3JpdGVzLCB3aGVyZSB0aGF0J3Mgc3RhdGljYWxseVxuICogZGV0ZXJtaW5hYmxlLiBCdWlsdCBmcm9tIGFuIGVtcGlyaWNhbCBwYXNzIG92ZXIgfjMxayByZWFsIENsYXVkZSBDb2RlXG4gKiBCYXNoIGludm9jYXRpb25zIChzZWUgYW5hbHl6ZS10cmFuc2NyaXB0cy5tdHMpIFx1MjAxNCB0aGUgaWRpb21zIGJlbG93IGFyZVxuICogZXhhY3RseSB0aGUgb25lcyB0aGF0IHR1cm5lZCBvdXQgdG8gYmUgY29tbW9uIEFORCByZWxpYWJsZSB0aGVyZS5cbiAqXG4gKiBEZWxpYmVyYXRlbHkgTk9UIGNvdmVyZWQgKHNlZSB0aGUgcmVzZWFyY2ggcmVwb3J0KTogYXdrIE5SLXRyaWNrcyAocmFyZSxcbiAqIHVuY29uc3RyYWluZWQgc3ludGF4KSwgZ3JlcCAtbi8tQS8tQi8tQyAodGhlIHdpbmRvdyBpcyBhbmNob3JlZCB0byBtYXRjaFxuICogcG9zaXRpb24sIHdoaWNoIGlzIGRhdGEtZGVwZW5kZW50LCBub3QgaW4gdGhlIGNvbW1hbmQgdGV4dCksIGVtYmVkZGVkXG4gKiBweXRob24zL25vZGUgaGVyZWRvYyBzY3JpcHRzIChhIGRpZmZlcmVudCBsYW5ndWFnZSdzIEFTVCwgbm90IGEgc2hlbGxcbiAqIGNvbmNlcm4pLCBhbmQgYGZpbmQgPGRpcj4gLW5hbWUvLXBhdGggLi4uIC1kZWxldGVgICh0aGUgZGVsZXRlZCBwYXRocyBhcmVcbiAqIHRoZSBkaXJlY3RvcnkncyBjb250ZW50cyBhcyB0aGUgZmluZGVyIHdhbGtzIGl0IFx1MjAxNCBkYXRhLWRlcGVuZGVudCwgbm90XG4gKiBzdGF0aWNhbGx5IGVudW1lcmFibGU7IHRoZSByZWN1cnNpdmUtcmVtb3ZhbCBmYWlsLWNsb3NlZCBydWxlIGFwcGxpZXMpLlxuICpcbiAqIFRoZSBjYXJkJ3Mgd3JpdGUtdG91Y2ggZmFtaWxpZXMgXHUyMDE0IHJlZGlyZWN0aW9ucyBhbmQgaGVyZWRvY3MgKFx1MDBBNzUuMVx1MjAxM1x1MDBBNzUuMiksXG4gKiBjcCBhbmQgaW5zdGFsbCAoXHUwMEE3NS4zKSwgbXYgYW5kIGdpdCBtdiAoXHUwMEE3NS40KSwgcm0gYW5kIHRydW5jYXRlIChcdTAwQTc1LjUpLFxuICogc2VkIC1pIChcdTAwQTc1LjYpLCBwYXRjaCBhbmQgZ2l0IGFwcGx5IChcdTAwQTc1LjcpLCBmb3JtYXR0ZXIgd3JpdGUgZmxhZ3MgKFx1MDBBNzUuOCksXG4gKiBhbmQgZ2l0IHJlc3RvcmUvY2hlY2tvdXQgcGF0aHNwZWNzIChcdTAwQTc1LjkpIFx1MjAxNCBhcmUgdGhlIGdyYW1tYXJzIGJlbG93LiBFYWNoXG4gKiBmYW1pbHkgZmFpbHMgY2xvc2VkIG9uIHdoYXQgaXQgY2Fubm90IHN0YXRpY2FsbHkgYXR0cmlidXRlOlxuICogc2hlbGwtZXhwYW5kZWQgb3IgZHluYW1pYyBjb250ZW50LCByZWN1cnNpdmUgcmVtb3ZhbCAoYHJtIC1yYCksXG4gKiBoZXJlLXN0cmluZ3MgKGA8PDxgKSwgZGlyZWN0b3J5LXNoYXBlZCB0YXJnZXRzLCB3cmFwcGVyLXdyYXBwZWQgY29tbWFuZHNcbiAqIHdob3NlIGFyZ3YgY2Fubm90IGJlIHJlY292ZXJlZCwgYW5kIHVubWF0Y2hlZCBwYXRoc3BlY3MgZW1pdCBubyBzcGFuIGF0XG4gKiBhbGwgb3IgYW4gZXhwbGljaXQgdW5yZXNvbHZlZCBlbnRyeSBcdTIwMTQgbmV2ZXIgYSBndWVzc2VkIHdyaXRlLlxuICovXG5pbXBvcnQgeyByZWFkRmlsZVN5bmMsIHN0YXRTeW5jIH0gZnJvbSAnbm9kZTpmcyc7XG5pbXBvcnQgeyBiYXNlbmFtZSwgam9pbiBhcyBqb2luUGF0aCwgcmVzb2x2ZSBhcyByZXNvbHZlUGF0aCB9IGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBjb3VudEZpbGVMaW5lcywgY291bnRHaXRCbG9iTGluZXMgfSBmcm9tICcuL2NvbW1hbmQtcmVzb2x2ZS5qcyc7XG5pbXBvcnQgeyB0eXBlIFNpbXBsZUNvbW1hbmQsIHNwbGl0VG9wTGV2ZWwsIHN0cmlwTGVhZGluZ0Fzc2lnbm1lbnRzLCB0eXBlIFRva2VuLCB0b2tlbml6ZSB9IGZyb20gJy4vc2hlbGwtc3BsaXQuanMnO1xuaW1wb3J0IHsgdHlwZSBQYXRoU3RyaXAsIHBhcnNlVW5pZmllZERpZmZSYW5nZSB9IGZyb20gJy4vdW5pZmllZC1kaWZmLmpzJztcblxuLyoqXG4gKiBUaGUgZXhwbGljaXQgb3BlcmF0aW9uIGtpbmQgb2YgYSByZXNvbHZlZCBzcGFuLiBUaGUgYWRhcHRlcnMgdHJhbnNsYXRlIGZyb21cbiAqIHRoaXMsIG5ldmVyIGZyb20gYGlkaW9tID09PSAnaGVyZWRvYy13cml0ZSdgLXN0eWxlIGNoZWNrcyAocGxhbiBcdTAwQTcxKS5cbiAqL1xuZXhwb3J0IHR5cGUgT3BlcmF0aW9uID1cbiAgfCAncmVhZCcgLy8gcmVhZCBpZGlvbXM7IGNwL2luc3RhbGwgc291cmNlIG9wZXJhbmRzXG4gIHwgJ2NyZWF0ZS1vdmVyd3JpdGUnIC8vIHRydW5jYXRpbmcgY29udGVudCB3cml0ZXM6ID4gcmVkaXJlY3RzLCB0ZWUsIGhlcmVkb2MgPiwgY3AvbXYgZGVzdCwgcmVzdG9yZS9jaGVja291dCwgcGF0Y2ggYWRkXG4gIHwgJ2FwcGVuZCcgLy8gPj4gcmVkaXJlY3RzLCB0ZWUgLWEsIGhlcmVkb2MgPj5cbiAgfCAnbW9kaWZ5JyAvLyBpbi1wbGFjZSBlZGl0cyB3aXRoIHVua25vd24gY29udGVudDogc2VkIC1pLCBwYXRjaCBodW5rcywgZm9ybWF0dGVyIHdyaXRlIGZsYWdzXG4gIHwgJ3JlbmFtZS1jb3B5JyAvLyBtdi9naXQgbXYvcGF0Y2gtcmVuYW1lIGRlc3RpbmF0aW9uICh3aG9sZS1maWxlIHdyaXRlLCBzYW1lIHRvdWNoIGFzIGNyZWF0ZS1vdmVyd3JpdGUpXG4gIHwgJ3RydW5jYXRlJyAvLyA6ID4gZiwgYmFyZSA+IGYsIHRydW5jYXRlXG4gIHwgJ2RlbGV0ZSc7IC8vIHJtLCBtdi9naXQgbXYgc291cmNlLCBwYXRjaCBkZWxldGVcblxuZXhwb3J0IGludGVyZmFjZSBSZXNvbHZlZFNwYW4ge1xuICBvcGVyYXRpb246IE9wZXJhdGlvbjtcbiAgYWJzb2x1dGVQYXRoOiBzdHJpbmc7XG4gIC8qKlxuICAgKiBFeGFjdCByYW5nZTogZXZlcnkgcmVhZDsgbW9kaWZ5IG9wZXJhdGlvbnMgd2l0aCBhIHN0YXRpY2FsbHkga25vd24gcmFuZ2VcbiAgICogKHNlZCAtaSBudW1lcmljIGFkZHJlc3NlcywgcGF0Y2ggaHVuayB1bmlvbnMpLiBBYnNlbnQgZm9yIHdyaXRlcyBcdTIxOTJcbiAgICogd2hvbGUtZmlsZSBzY29wZS5cbiAgICovXG4gIGxpbmVTdGFydD86IG51bWJlcjtcbiAgbGluZUVuZD86IG51bWJlcjtcbiAgLyoqXG4gICAqIFN0YXRpY2FsbHkga25vd24gd3JpdHRlbiBjb250ZW50IFx1MjAxNCBhcHBlbmQgYm9kaWVzIGFuZCBsaXRlcmFsIG92ZXJ3cml0ZVxuICAgKiBib2RpZXMgKGhlcmVkb2MvZWNoby9wcmludGYvdGVlIGxpdGVyYWxzLCBwbGFuIFx1MDBBNzMgc3RlcCAxYikuIE9uIGFwcGVuZHMgaXRcbiAgICogaXMgdGhlIHN1ZmZpeCBnYXRlJ3MgYm9keTsgb24gYGNyZWF0ZS1vdmVyd3JpdGVgIGl0IGlzIHRoZSBleGFjdCBnYXRlJ3NcbiAgICogcG9zdC1jb250ZW50IFx1MjAxNCB0aGUgdG91Y2ggaXRzZWxmIHN0YXlzIHdob2xlLWZpbGUgKGB3cml0dGVuOiAnJ2ApIGVpdGhlclxuICAgKiB3YXkuXG4gICAqL1xuICB3cml0dGVuPzogc3RyaW5nO1xuICAvKipcbiAgICogVGhlIHN0YXRpY2FsbHkgZXZhbHVhdGVkIGFic29sdXRlIGB0cnVuY2F0ZSAtcyBOYCBzaXplIChwbGFuIFx1MDBBNzUuNSk6IHRoZVxuICAgKiBcdTAwQTczIGBzaXplYCBnYXRlJ3MgcG9zdC1jb21tYW5kIGJ5dGUgY291bnQgKGAtcyAwYCBcdTIxOTIgdGhlIGVtcHR5IGdhdGUpLlxuICAgKiBBYnNlbnQgZm9yIHJlbGF0aXZlIHNpemVzIChgLXMgK05gL2AtcyAtTmApLCBgLXIgcmVmYCwgYW5kIGV2ZXJ5IG90aGVyXG4gICAqIG9wZXJhdGlvbiBcdTIwMTQgdGhvc2UgZ2F0ZSBleGlzdGVuY2Utb25seS5cbiAgICovXG4gIHNpemU/OiBudW1iZXI7XG4gIC8qKlxuICAgKiBPcmRpbmFsIG9mIHRoZSBzcGFuJ3Mgc2ltcGxlIGNvbW1hbmQgd2l0aGluIHRoZSBjb21wb3VuZCwgaW4gd2Fsa2VyXG4gICAqIG9yZGVyOyBncm91cHMgdGhlIHNwYW5zIG9mIG9uZSBjb21tYW5kIGZvciBqb2luIGdhdGluZyAocGxhbiBcdTAwQTczIHN0ZXAgMikuXG4gICAqL1xuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcjtcbiAgLyoqXG4gICAqIFRoZSBvcGVyYXRvciBwcmVjZWRpbmcgdGhlIHNwYW4ncyBzaW1wbGUgY29tbWFuZDsgb25seSBgJyYmJ2AvYCd8fCdgIGdhdGUuXG4gICAqIEFic2VudCBmb3IgYHN0YXJ0YC9gO2AvbmV3bGluZS9gJmAvYHxgIGJvdW5kYXJpZXMuXG4gICAqL1xuICBqb2luPzogJyYmJyB8ICd8fCc7XG4gIG5vdGU/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCB0eXBlIElkaW9tID1cbiAgfCAnc2VkLW4tcmFuZ2UnXG4gIHwgJ2hlYWQtZmlsZSdcbiAgfCAndGFpbC1maWxlJ1xuICB8ICdjYXQtZmlsZSdcbiAgfCAnbmwtZmlsZSdcbiAgfCAnZ2l0LXNob3ctcmV2LXBhdGgnXG4gIHwgJ2dpdC1sb2ctTCdcbiAgfCAnaGVyZWRvYy13cml0ZSdcbiAgLy8gVGhlIHdyaXRlLXRvdWNoIGZhbWlsaWVzIChwbGFuIFx1MDBBNzUpLiBJZGlvbSBzdGF5cyBtYXRjaCBtZXRhZGF0YSBmb3IgdGVzdHNcbiAgLy8gYW5kIHVucmVzb2x2ZWQgcmVhc29uczsgYWRhcHRlciBiZWhhdmlvciBrZXlzIG9uIGBvcGVyYXRpb25gLCBuZXZlciBpZGlvbS5cbiAgfCAncmVkaXJlY3Qtd3JpdGUnIC8vIFx1MDBBNzUuMTogZWNoby9wcmludGYvdGVlIGNvbnRlbnQgcmVkaXJlY3RzXG4gIHwgJ3RydW5jYXRlLXdyaXRlJyAvLyBcdTAwQTc1LjE6IGJhcmUgYD4gZmAgLyBgOiA+IGZgIHRydW5jYXRpb25zXG4gIHwgJ2NwLXdyaXRlJyAvLyBcdTAwQTc1LjNcbiAgfCAnaW5zdGFsbC13cml0ZScgLy8gXHUwMEE3NS4zXG4gIHwgJ212LXdyaXRlJyAvLyBcdTAwQTc1LjQ6IG12IGFuZCBnaXQgbXZcbiAgfCAncm0td3JpdGUnIC8vIFx1MDBBNzUuNTogcm0gYW5kIGdpdCBybVxuICB8ICd0cnVuY2F0ZS1jb21tYW5kJyAvLyBcdTAwQTc1LjU6IHRoZSB0cnVuY2F0ZSBjb21tYW5kXG4gIHwgJ3NlZC1pbnBsYWNlJyAvLyBcdTAwQTc1LjY6IHNlZCAtaVxuICB8ICdwYXRjaC13cml0ZScgLy8gXHUwMEE3NS43OiBwYXRjaCBhbmQgZ2l0IGFwcGx5XG4gIHwgJ2Zvcm1hdHRlci13cml0ZScgLy8gXHUwMEE3NS44XG4gIHwgJ2dpdC1yZXN0b3JlLXdyaXRlJyAvLyBcdTAwQTc1Ljk6IGdpdCByZXN0b3JlIHBhdGhzcGVjc1xuICB8ICdnaXQtY2hlY2tvdXQtd3JpdGUnOyAvLyBcdTAwQTc1Ljk6IGdpdCBjaGVja291dCAtLSBwYXRoc3BlY3NcblxuZXhwb3J0IHR5cGUgU3Bhbk1hdGNoID1cbiAgfCB7IHN0YXR1czogJ3Jlc29sdmVkJzsgaWRpb206IElkaW9tOyBzcGFuOiBSZXNvbHZlZFNwYW47IG5vdGU/OiBzdHJpbmcgfVxuICB8IHsgc3RhdHVzOiAndW5yZXNvbHZlZCc7IGlkaW9tOiBJZGlvbTsgZmlsZUFyZzogc3RyaW5nOyByZWFzb246IHN0cmluZyB9XG4gIHwge1xuICAgICAgLyoqXG4gICAgICAgKiBBIHNwYW4tbGVzcyBjb21tYW5kIHdpdGggYSBkZXRlcm1pbmlzdGljIGV4aXQgc3RhdHVzIFx1MjAxNCBgZmFsc2VgICgxKSxcbiAgICAgICAqIGB0cnVlYCAoMCksIGA6YCAoMCkuIE5vIHNwYW4gYW5kIG5vIHRvdWNoLCBidXQgdGhlIGpvaW4gZHJpdmVyIG5lZWRzXG4gICAgICAgKiB0aGUgdmVyZGljdDogYGZhbHNlICYmIGVjaG8geCA+IGZgIHNraXBzIHRoZSBlY2hvLCBgdHJ1ZSB8fCBlY2hvIHggPlxuICAgICAgICogZmAgc2tpcHMgaXQgdG9vLCBhbmQgd2l0aG91dCB0aGUgZ3VhcmQgYm90aCB3b3VsZCBmaXJlIGFuIGV4YWN0LWdhdGVcbiAgICAgICAqIHRvdWNoIGZvciBhIHdyaXRlIHRoYXQgbmV2ZXIgcmFuIChwbGFuIFx1MDBBNzMgc3RlcCAyJ3Mgc3Bhbi1sZXNzLWd1YXJkXG4gICAgICAgKiBydWxlKS4gRmlsdGVyZWQgb3V0IG9mIGBwYXJzZUNvbW1hbmRgJ3Mgc3BhbiBsaXN0IHdpdGggdGhlXG4gICAgICAgKiB1bnJlc29sdmVkcy5cbiAgICAgICAqL1xuICAgICAgc3RhdHVzOiAnYnVpbHRpbi1ndWFyZCc7XG4gICAgICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcjtcbiAgICAgIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddO1xuICAgICAgZXhpdFN0YXR1czogMCB8IDE7XG4gICAgfTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBMaW5lLXJhbmdlIHNwZWNzOiB3aGF0IGEgbWF0Y2hlZCBpZGlvbSBzYXlzIGFib3V0IHRoZSByYW5nZSwgYmVmb3JlIHdlIGtub3dcbi8vIHdoZXRoZXIgcmVzb2x2aW5nIGl0IG5lZWRzIHRvIGNvbnN1bHQgYSByZWFsIGZpbGUvZ2l0IGJsb2IuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudHlwZSBMaW5lUmFuZ2VTcGVjID1cbiAgfCB7IGtpbmQ6ICdsaXRlcmFsJzsgc3RhcnQ6IG51bWJlcjsgZW5kOiBudW1iZXIgfVxuICB8IHsga2luZDogJ3VwcGVyQm91bmRGcm9tU3RhcnQnOyBlbmQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAndG9Fb2YnOyBzdGFydDogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6ICdsYXN0TkxpbmVzJzsgY291bnQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAnYXBwZW5kTGluZXMnOyBjb3VudDogbnVtYmVyIH07XG5cbmZ1bmN0aW9uIHJlc29sdmVTcGVjKFxuICBzcGVjOiBMaW5lUmFuZ2VTcGVjLFxuICB0b3RhbExpbmVzOiAoKSA9PiBudW1iZXIgfCBudWxsXG4pOiB7IGxpbmVTdGFydDogbnVtYmVyOyBsaW5lRW5kOiBudW1iZXIgfSB8IG51bGwge1xuICBzd2l0Y2ggKHNwZWMua2luZCkge1xuICAgIGNhc2UgJ2xpdGVyYWwnOlxuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiBzcGVjLnN0YXJ0LCBsaW5lRW5kOiBzcGVjLmVuZCB9O1xuICAgIGNhc2UgJ3VwcGVyQm91bmRGcm9tU3RhcnQnOiB7XG4gICAgICBjb25zdCB0b3RhbCA9IHRvdGFsTGluZXMoKTtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogMSwgbGluZUVuZDogdG90YWwgIT09IG51bGwgPyBNYXRoLm1pbihzcGVjLmVuZCwgdG90YWwpIDogc3BlYy5lbmQgfTtcbiAgICB9XG4gICAgY2FzZSAndG9Fb2YnOiB7XG4gICAgICBjb25zdCB0b3RhbCA9IHRvdGFsTGluZXMoKTtcbiAgICAgIGlmICh0b3RhbCA9PT0gbnVsbCB8fCB0b3RhbCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gICAgICByZXR1cm4geyBsaW5lU3RhcnQ6IHNwZWMuc3RhcnQsIGxpbmVFbmQ6IE1hdGgubWF4KHNwZWMuc3RhcnQsIHRvdGFsKSB9O1xuICAgIH1cbiAgICBjYXNlICdsYXN0TkxpbmVzJzoge1xuICAgICAgY29uc3QgdG90YWwgPSB0b3RhbExpbmVzKCk7XG4gICAgICBpZiAodG90YWwgPT09IG51bGwgfHwgdG90YWwgPT09IDApIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiBNYXRoLm1heCgxLCB0b3RhbCAtIHNwZWMuY291bnQgKyAxKSwgbGluZUVuZDogdG90YWwgfTtcbiAgICB9XG4gICAgY2FzZSAnYXBwZW5kTGluZXMnOiB7XG4gICAgICBjb25zdCB0b3RhbCA9IHRvdGFsTGluZXMoKSA/PyAwO1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiB0b3RhbCArIDEsIGxpbmVFbmQ6IHRvdGFsICsgc3BlYy5jb3VudCB9O1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBoYXNTaGVsbEV4cGFuc2lvbihzOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIC9bJGBdLy50ZXN0KHMpO1xufVxuXG5mdW5jdGlvbiBsb29rc1VucmVzb2x2YWJsZShzOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIGhhc1NoZWxsRXhwYW5zaW9uKHMpIHx8IC9bKj9dLy50ZXN0KHMpO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIElkaW9tIG1hdGNoZXJzOiBwdXJlIGZ1bmN0aW9ucyBvdmVyIG9uZSBzaW1wbGUgY29tbWFuZCdzIGFyZ3YuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuaW50ZXJmYWNlIFJhd0NhbmRpZGF0ZSB7XG4gIGtpbmQ6ICdjYW5kaWRhdGUnO1xuICBpZGlvbTogSWRpb207XG4gIGZpbGVBcmc6IHN0cmluZztcbiAgc3BlYzogTGluZVJhbmdlU3BlYztcbiAgcmVzb2x2ZXJLaW5kOiAnZnMnIHwgeyBraW5kOiAnZ2l0JzsgcmV2OiBzdHJpbmcgfTtcbiAgZGlyT3ZlcnJpZGU/OiBzdHJpbmc7XG59XG5pbnRlcmZhY2UgUmF3VW5yZXNvbHZlZCB7XG4gIGtpbmQ6ICd1bnJlc29sdmVkJztcbiAgaWRpb206IElkaW9tO1xuICBmaWxlQXJnOiBzdHJpbmc7XG4gIHJlYXNvbjogc3RyaW5nO1xufVxudHlwZSBNYXRjaFJlc3VsdCA9IFJhd0NhbmRpZGF0ZSB8IFJhd1VucmVzb2x2ZWQ7XG5cbmNvbnN0IFNFRF9SQU5HRSA9IC9eKFxcZCspKD86LChcXGQrfFxcJCkpP3AkLztcblxuLyoqIFNwbGl0IGEgYHNlZGAgc2NyaXB0IGFyZ3VtZW50IGludG8gaXRzIGA7YC1zZXBhcmF0ZWQgc2VnbWVudHMuICovXG5mdW5jdGlvbiBzZWRTY3JpcHRTZWdtZW50cyhzY3JpcHQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIHNjcmlwdC5zcGxpdCgnOycpO1xufVxuXG5mdW5jdGlvbiBtYXRjaFNlZChhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ3NlZCcpIHJldHVybiBbXTtcbiAgY29uc3QgcmVzdCA9IGFyZ3Yuc2xpY2UoMSk7XG4gIGlmICghcmVzdC5pbmNsdWRlcygnLW4nKSkgcmV0dXJuIFtdO1xuICBsZXQgc2NyaXB0SWR4ID0gLTE7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcmVzdC5sZW5ndGg7IGkrKykge1xuICAgIGlmIChyZXN0W2ldID09PSAnLW4nKSBjb250aW51ZTtcbiAgICBpZiAoc2VkU2NyaXB0U2VnbWVudHMocmVzdFtpXSkuc29tZSgoc2VnKSA9PiBTRURfUkFOR0UudGVzdChzZWcpKSkge1xuICAgICAgc2NyaXB0SWR4ID0gaTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICBpZiAoc2NyaXB0SWR4ID09PSAtMSkgcmV0dXJuIFtdO1xuICBjb25zdCBmaWxlQ2FuZGlkYXRlcyA9IHJlc3QuZmlsdGVyKChhLCBpKSA9PiBpICE9PSBzY3JpcHRJZHggJiYgYSAhPT0gJy1uJyAmJiAhYS5zdGFydHNXaXRoKCctJykpO1xuICBpZiAoZmlsZUNhbmRpZGF0ZXMubGVuZ3RoICE9PSAxKSByZXR1cm4gW107XG4gIGNvbnN0IGZpbGVBcmcgPSBmaWxlQ2FuZGlkYXRlc1swXTtcbiAgY29uc3QgcmVzdWx0czogTWF0Y2hSZXN1bHRbXSA9IFtdO1xuICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc2VkU2NyaXB0U2VnbWVudHMocmVzdFtzY3JpcHRJZHhdKSkge1xuICAgIGNvbnN0IG1hdGNoID0gc2VnbWVudC5tYXRjaChTRURfUkFOR0UpO1xuICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHN0YXJ0ID0gTnVtYmVyLnBhcnNlSW50KG1hdGNoWzFdLCAxMCk7XG4gICAgY29uc3QgZW5kVG9rZW4gPSBtYXRjaFsyXTtcbiAgICBjb25zdCBzcGVjOiBMaW5lUmFuZ2VTcGVjID1cbiAgICAgIGVuZFRva2VuID09PSB1bmRlZmluZWRcbiAgICAgICAgPyB7IGtpbmQ6ICdsaXRlcmFsJywgc3RhcnQsIGVuZDogc3RhcnQgfVxuICAgICAgICA6IGVuZFRva2VuID09PSAnJCdcbiAgICAgICAgICA/IHsga2luZDogJ3RvRW9mJywgc3RhcnQgfVxuICAgICAgICAgIDogeyBraW5kOiAnbGl0ZXJhbCcsIHN0YXJ0LCBlbmQ6IE51bWJlci5wYXJzZUludChlbmRUb2tlbiwgMTApIH07XG4gICAgcmVzdWx0cy5wdXNoKHsga2luZDogJ2NhbmRpZGF0ZScsIGlkaW9tOiAnc2VkLW4tcmFuZ2UnLCBmaWxlQXJnLCBzcGVjLCByZXNvbHZlcktpbmQ6ICdmcycgfSk7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdHM7XG59XG5cbmZ1bmN0aW9uIHBhcnNlSGVhZFRhaWxGbGFncyhyZXN0OiBzdHJpbmdbXSk6IHtcbiAgY291bnQ6IG51bWJlciB8IG51bGw7XG4gIGZyb21TdGFydDogYm9vbGVhbjtcbiAgZGlzcXVhbGlmaWVkOiBib29sZWFuO1xuICBmaWxlczogc3RyaW5nW107XG59IHtcbiAgY29uc3QgZmlsZXM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjb3VudDogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG4gIGxldCBmcm9tU3RhcnQgPSBmYWxzZTtcbiAgbGV0IGRpc3F1YWxpZmllZCA9IGZhbHNlO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHJlc3QubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gcmVzdFtpXTtcbiAgICBpZiAoYSA9PT0gJy1mJyB8fCBhID09PSAnLUYnIHx8IGEgPT09ICctLWZvbGxvdycgfHwgYS5zdGFydHNXaXRoKCctLWZvbGxvdz0nKSkge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy16JyB8fCBhID09PSAnLS16ZXJvLXRlcm1pbmF0ZWQnKSB7XG4gICAgICBkaXNxdWFsaWZpZWQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWMnIHx8IGEgPT09ICctLWJ5dGVzJykge1xuICAgICAgZGlzcXVhbGlmaWVkID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoL14oLWN8LS1ieXRlcz0pLy50ZXN0KGEpKSB7XG4gICAgICBkaXNxdWFsaWZpZWQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLXEnIHx8IGEgPT09ICctdicgfHwgYSA9PT0gJy0tcXVpZXQnIHx8IGEgPT09ICctLXNpbGVudCcgfHwgYSA9PT0gJy0tdmVyYm9zZScpIGNvbnRpbnVlO1xuICAgIGlmIChhID09PSAnLW4nKSB7XG4gICAgICBjb25zdCB2ID0gcmVzdFtpICsgMV07XG4gICAgICBpZiAodiAhPT0gdW5kZWZpbmVkICYmIC9eXFwrP1xcZCskLy50ZXN0KHYpKSB7XG4gICAgICAgIGZyb21TdGFydCA9IHYuc3RhcnRzV2l0aCgnKycpO1xuICAgICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludCh2LnJlcGxhY2UoJysnLCAnJyksIDEwKTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0tbGluZXM9JykpIHtcbiAgICAgIGNvbnN0IHYgPSBhLnNsaWNlKCctLWxpbmVzPScubGVuZ3RoKTtcbiAgICAgIGlmICgvXlxcKz9cXGQrJC8udGVzdCh2KSkge1xuICAgICAgICBmcm9tU3RhcnQgPSB2LnN0YXJ0c1dpdGgoJysnKTtcbiAgICAgICAgY291bnQgPSBOdW1iZXIucGFyc2VJbnQodi5yZXBsYWNlKCcrJywgJycpLCAxMCk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eLW5cXCs/XFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgIGNvbnN0IHYgPSBhLnNsaWNlKDIpO1xuICAgICAgZnJvbVN0YXJ0ID0gdi5zdGFydHNXaXRoKCcrJyk7XG4gICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludCh2LnJlcGxhY2UoJysnLCAnJyksIDEwKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoL15cXCtcXGQrJC8udGVzdChhKSkge1xuICAgICAgZnJvbVN0YXJ0ID0gdHJ1ZTtcbiAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KGEuc2xpY2UoMSksIDEwKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoL14tXFxkKyQvLnRlc3QoYSkpIHtcbiAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KGEuc2xpY2UoMSksIDEwKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0nKSB7XG4gICAgICBmaWxlcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7XG4gICAgZmlsZXMucHVzaChhKTtcbiAgfVxuICByZXR1cm4geyBjb3VudCwgZnJvbVN0YXJ0LCBkaXNxdWFsaWZpZWQsIGZpbGVzIH07XG59XG5cbmZ1bmN0aW9uIG1hdGNoSGVhZChhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ2hlYWQnKSByZXR1cm4gW107XG4gIGNvbnN0IHsgY291bnQsIGRpc3F1YWxpZmllZCwgZmlsZXMgfSA9IHBhcnNlSGVhZFRhaWxGbGFncyhhcmd2LnNsaWNlKDEpKTtcbiAgaWYgKGRpc3F1YWxpZmllZCkgcmV0dXJuIFtdO1xuICBjb25zdCByZWFsRmlsZXMgPSBmaWxlcy5maWx0ZXIoKGYpID0+IGYgIT09ICctJyk7XG4gIGlmIChyZWFsRmlsZXMubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gIGNvbnN0IG4gPSBjb3VudCA/PyAxMDtcbiAgcmV0dXJuIHJlYWxGaWxlcy5tYXAoKGZpbGVBcmcpID0+ICh7XG4gICAga2luZDogJ2NhbmRpZGF0ZScgYXMgY29uc3QsXG4gICAgaWRpb206ICdoZWFkLWZpbGUnIGFzIGNvbnN0LFxuICAgIGZpbGVBcmcsXG4gICAgc3BlYzogeyBraW5kOiAndXBwZXJCb3VuZEZyb21TdGFydCcsIGVuZDogbiB9IGFzIExpbmVSYW5nZVNwZWMsXG4gICAgcmVzb2x2ZXJLaW5kOiAnZnMnIGFzIGNvbnN0XG4gIH0pKTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hUYWlsKGFyZ3Y6IHN0cmluZ1tdKTogTWF0Y2hSZXN1bHRbXSB7XG4gIGlmIChhcmd2WzBdICE9PSAndGFpbCcpIHJldHVybiBbXTtcbiAgY29uc3QgeyBjb3VudCwgZnJvbVN0YXJ0LCBkaXNxdWFsaWZpZWQsIGZpbGVzIH0gPSBwYXJzZUhlYWRUYWlsRmxhZ3MoYXJndi5zbGljZSgxKSk7XG4gIGlmIChkaXNxdWFsaWZpZWQpIHJldHVybiBbXTtcbiAgY29uc3QgcmVhbEZpbGVzID0gZmlsZXMuZmlsdGVyKChmKSA9PiBmICE9PSAnLScpO1xuICBpZiAocmVhbEZpbGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICBjb25zdCBuID0gY291bnQgPz8gMTA7XG4gIGNvbnN0IHNwZWM6IExpbmVSYW5nZVNwZWMgPSBmcm9tU3RhcnQgPyB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0OiBuIH0gOiB7IGtpbmQ6ICdsYXN0TkxpbmVzJywgY291bnQ6IG4gfTtcbiAgcmV0dXJuIHJlYWxGaWxlcy5tYXAoKGZpbGVBcmcpID0+ICh7XG4gICAga2luZDogJ2NhbmRpZGF0ZScgYXMgY29uc3QsXG4gICAgaWRpb206ICd0YWlsLWZpbGUnIGFzIGNvbnN0LFxuICAgIGZpbGVBcmcsXG4gICAgc3BlYyxcbiAgICByZXNvbHZlcktpbmQ6ICdmcycgYXMgY29uc3RcbiAgfSkpO1xufVxuXG5mdW5jdGlvbiBmaW5kR2l0U3ViY29tbWFuZChcbiAgcmVzdDogc3RyaW5nW11cbik6IHsgc3ViSWR4OiBudW1iZXI7IHN1YmNvbW1hbmQ6IHN0cmluZzsgY0Rpcjogc3RyaW5nIHwgbnVsbDsgY0RpclVucmVzb2x2YWJsZTogYm9vbGVhbiB9IHwgbnVsbCB7XG4gIGxldCBjRGlyOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgbGV0IGNEaXJVbnJlc29sdmFibGUgPSBmYWxzZTtcbiAgbGV0IGkgPSAwO1xuICB3aGlsZSAoaSA8IHJlc3QubGVuZ3RoKSB7XG4gICAgY29uc3QgYSA9IHJlc3RbaV07XG4gICAgaWYgKGEgPT09ICctQycpIHtcbiAgICAgIGNvbnN0IHYgPSByZXN0W2kgKyAxXTtcbiAgICAgIGlmICh2ID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICAgICAgaWYgKGhhc1NoZWxsRXhwYW5zaW9uKHYpKSBjRGlyVW5yZXNvbHZhYmxlID0gdHJ1ZTtcbiAgICAgIGVsc2UgY0RpciA9IHY7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctYycpIHtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIHtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICByZXR1cm4geyBzdWJJZHg6IGksIHN1YmNvbW1hbmQ6IGEsIGNEaXIsIGNEaXJVbnJlc29sdmFibGUgfTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuY29uc3QgUkVWX1BBVEggPSAvXihbXlxcczpdKyk6KC4rKSQvO1xuXG5mdW5jdGlvbiBtYXRjaEdpdFNob3coYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdnaXQnKSByZXR1cm4gW107XG4gIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKGFyZ3Yuc2xpY2UoMSkpO1xuICBpZiAoIXN1YiB8fCBzdWIuc3ViY29tbWFuZCAhPT0gJ3Nob3cnKSByZXR1cm4gW107XG4gIGNvbnN0IGFmdGVyID0gYXJndlxuICAgIC5zbGljZSgxKVxuICAgIC5zbGljZShzdWIuc3ViSWR4ICsgMSlcbiAgICAuZmlsdGVyKChhKSA9PiAhYS5zdGFydHNXaXRoKCctJykpO1xuICBjb25zdCByZXZQYXRoQXJnID0gYWZ0ZXIuZmluZCgoYSkgPT4gUkVWX1BBVEgudGVzdChhKSk7XG4gIGlmICghcmV2UGF0aEFyZykgcmV0dXJuIFtdO1xuICBjb25zdCBtID0gcmV2UGF0aEFyZy5tYXRjaChSRVZfUEFUSCk7XG4gIGlmICghbSkgcmV0dXJuIFtdO1xuICBjb25zdCBbLCByZXYsIHBhdGhdID0gbTtcbiAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlIHx8IGhhc1NoZWxsRXhwYW5zaW9uKHJldikpIHtcbiAgICByZXR1cm4gW1xuICAgICAge1xuICAgICAgICBraW5kOiAndW5yZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiAnZ2l0LXNob3ctcmV2LXBhdGgnLFxuICAgICAgICBmaWxlQXJnOiBwYXRoLFxuICAgICAgICByZWFzb246ICdnaXQgLUMgdGFyZ2V0IG9yIHJldmlzaW9uIGNvbnRhaW5zIGFuIHVucmVzb2x2ZWQgc2hlbGwgdmFyaWFibGUnXG4gICAgICB9XG4gICAgXTtcbiAgfVxuICByZXR1cm4gW1xuICAgIHtcbiAgICAgIGtpbmQ6ICdjYW5kaWRhdGUnLFxuICAgICAgaWRpb206ICdnaXQtc2hvdy1yZXYtcGF0aCcsXG4gICAgICBmaWxlQXJnOiBwYXRoLFxuICAgICAgc3BlYzogeyBraW5kOiAndG9Fb2YnLCBzdGFydDogMSB9LFxuICAgICAgcmVzb2x2ZXJLaW5kOiB7IGtpbmQ6ICdnaXQnLCByZXYgfSxcbiAgICAgIGRpck92ZXJyaWRlOiBzdWIuY0RpciA/PyB1bmRlZmluZWRcbiAgICB9XG4gIF07XG59XG5cbmZ1bmN0aW9uIG1hdGNoR2l0TG9nTChhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ2dpdCcpIHJldHVybiBbXTtcbiAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQoYXJndi5zbGljZSgxKSk7XG4gIGlmICghc3ViIHx8IHN1Yi5zdWJjb21tYW5kICE9PSAnbG9nJykgcmV0dXJuIFtdO1xuICBjb25zdCBhZnRlciA9IGFyZ3Yuc2xpY2UoMSkuc2xpY2Uoc3ViLnN1YklkeCArIDEpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGFmdGVyLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFmdGVyW2ldO1xuICAgIGxldCBzcGVjOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgICBpZiAoYSA9PT0gJy1MJykgc3BlYyA9IGFmdGVyW2kgKyAxXSA/PyBudWxsO1xuICAgIGVsc2UgaWYgKGEuc3RhcnRzV2l0aCgnLUwnKSkgc3BlYyA9IGEuc2xpY2UoMik7XG4gICAgaWYgKCFzcGVjKSBjb250aW51ZTtcbiAgICBjb25zdCBtID0gc3BlYy5tYXRjaCgvXihcXGQrKSwoXFxkKyk6KC4rKSQvKTtcbiAgICBpZiAoIW0pIGNvbnRpbnVlO1xuICAgIGNvbnN0IFssIHMsIGUsIHBhdGhdID0gbTtcbiAgICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUpIHtcbiAgICAgIHJldHVybiBbXG4gICAgICAgIHtcbiAgICAgICAgICBraW5kOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgaWRpb206ICdnaXQtbG9nLUwnLFxuICAgICAgICAgIGZpbGVBcmc6IHBhdGgsXG4gICAgICAgICAgcmVhc29uOiAnZ2l0IC1DIHRhcmdldCBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJ1xuICAgICAgICB9XG4gICAgICBdO1xuICAgIH1cbiAgICByZXR1cm4gW1xuICAgICAge1xuICAgICAgICBraW5kOiAnY2FuZGlkYXRlJyxcbiAgICAgICAgaWRpb206ICdnaXQtbG9nLUwnLFxuICAgICAgICBmaWxlQXJnOiBwYXRoLFxuICAgICAgICBzcGVjOiB7IGtpbmQ6ICdsaXRlcmFsJywgc3RhcnQ6IE51bWJlci5wYXJzZUludChzLCAxMCksIGVuZDogTnVtYmVyLnBhcnNlSW50KGUsIDEwKSB9LFxuICAgICAgICByZXNvbHZlcktpbmQ6ICdmcycsXG4gICAgICAgIGRpck92ZXJyaWRlOiBzdWIuY0RpciA/PyB1bmRlZmluZWRcbiAgICAgIH1cbiAgICBdO1xuICB9XG4gIHJldHVybiBbXTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBIZXJlZG9jIHdyaXRlcyAocGxhbiBcdTAwQTc1LjIpOiBoYW5kbGVkIGFzIGEgZGVkaWNhdGVkIHJhdy10ZXh0IHBhc3MgYmVjYXVzZSB0aGVcbi8vIGJvZHkgY2FuIGl0c2VsZiBjb250YWluICYmLzsvfC9uZXdsaW5lcyB0aGF0IHdvdWxkIG90aGVyd2lzZSBjb25mdXNlXG4vLyBzcGxpdFRvcExldmVsLiBUaGUgb3BlbmVyIHNjYW5uZXIgaXMgcXVvdGUtYXdhcmUgYW5kIHZhbGlkYXRlcyB0aGUgY2xvc2luZ1xuLy8gZGVsaW1pdGVyOyBtYXRjaGVkIGhlcmVkb2NzIGFyZSBtYXNrZWQgb3V0IG9mIHRoZSBzdHJpbmcgKHJlcGxhY2VkIHdpdGggYW5cbi8vIGluZGV4ZWQgcGxhY2Vob2xkZXIgc2ltcGxlLWNvbW1hbmQpIGJlZm9yZSB0aGUgcmVzdCBvZiB0aGUgcGlwZWxpbmUgcnVucyxcbi8vIGFuZCByZS1hc3NvY2lhdGVkIGJ5IGluZGV4IGR1cmluZyB0aGUgbWFpbiB3YWxrIHNvIHRoZSB3cml0ZSBpcyByZXNvbHZlZFxuLy8gYWdhaW5zdCB0aGUgY29ycmVjdCBgY2RgLXRyYWNrZWQgZGlyZWN0b3J5LlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBUaGUgaGVyZWRvYydzIGNvbnRlbnQtY2FycnlpbmcgZmFjdHMsIHJlLWFzc29jaWF0ZWQgYnkgaW5kZXggZHVyaW5nIHRoZSB3YWxrLiAqL1xuaW50ZXJmYWNlIEhlcmVkb2NXcml0ZSB7XG4gIC8qKiBUaGUgb3BlbmVyIGxpbmUgdmVyYmF0aW0gKGUuZy4gYGNhdCA+IGYgPDwnRU9GJ2ApLCByZS10b2tlbml6ZWQgZHVyaW5nIHRoZSB3YWxrLiAqL1xuICBvcGVuZXI6IHN0cmluZztcbiAgLyoqIFRoZSBoZXJlZG9jIGJvZHk7IGA8PC1gIGJvZGllcyBoYXZlIGxlYWRpbmcgdGFicyBzdHJpcHBlZCBwZXIgbGluZS4gKi9cbiAgYm9keTogc3RyaW5nO1xuICAvKiogV2hldGhlciB0aGUgZGVsaW1pdGVyIHdhcyBxdW90ZWQvZXNjYXBlZCAoYDw8J0VPRidgLCBgPDxcIkVPRlwiYCwgYDw8XFxFT0ZgKTogdGhlIGJvZHkgdGhlbiB1bmRlcmdvZXMgbm8gc2hlbGwgZXhwYW5zaW9uLiAqL1xuICBxdW90ZWREZWxpbTogYm9vbGVhbjtcbn1cblxuaW50ZXJmYWNlIEhlcmVkb2NPcGVuZXIge1xuICAvKiogV2hlcmUgdGhlIGhlcmVkb2MncyBzaW1wbGUgY29tbWFuZCBzdGFydHMgaW4gdGhlIHJhdyBzdHJpbmcuICovXG4gIGNtZFN0YXJ0OiBudW1iZXI7XG4gIC8qKiBUaGUgbmV3bGluZSBlbmRpbmcgdGhlIG9wZW5lciBsaW5lLCBvciByYXcubGVuZ3RoIHdoZW4gaXQncyB0aGUgbGFzdCBsaW5lLiAqL1xuICBvcGVuZXJMaW5lRW5kOiBudW1iZXI7XG4gIC8qKiBUaGUgY2xvc2luZyBkZWxpbWl0ZXIgKHF1b3RlcyBzdHJpcHBlZCkuICovXG4gIGRlbGltOiBzdHJpbmc7XG4gIC8qKiBgPDwtYDogc3RyaXAgbGVhZGluZyB0YWJzIGZyb20gdGhlIGJvZHkgYW5kIHRoZSBjbG9zZXIgbGluZS4gKi9cbiAgdGFiU3RyaXA6IGJvb2xlYW47XG4gIC8qKiBXaGV0aGVyIHRoZSBkZWxpbWl0ZXIgd2FzIHF1b3RlZC9lc2NhcGVkIFx1MjAxNCB0aGUgc2hlbGwgc2tpcHMgYm9keSBleHBhbnNpb24gdGhlbi4gKi9cbiAgcXVvdGVkRGVsaW06IGJvb2xlYW47XG59XG5cbmNvbnN0IEJBUkVfREVMSU0gPSAvXltBLVphLXpfXVtBLVphLXowLTlfXSokLztcblxuLyoqXG4gKiBGaW5kIHRoZSBuZXh0IGhlcmVkb2Mgb3BlbmVyIChgPDxgL2A8PC1gKSBhdCB0b3AgbGV2ZWwsIHNjYW5uaW5nIGZyb21cbiAqIGBmcm9tYC4gTWlycm9ycyBzcGxpdFRvcExldmVsJ3Mgc2VwYXJhdG9yIGhhbmRsaW5nIHNvIGBjbWRTdGFydGAgbWFya3MgdGhlXG4gKiBvcGVuZXIncyBvd24gc2ltcGxlIGNvbW1hbmQ6IHRvcC1sZXZlbCBgJiZgL2B8fGAvYDtgL25ld2xpbmUvYCZgIHN0YXJ0IGEgbmV3XG4gKiBjb21tYW5kIChhIG5ld2xpbmUgYWZ0ZXIgYSBwaXBlIGlzIGEgbGluZSBjb250aW51YXRpb24pLCBgPmAtcmVkaXJlY3RzLCBkdXBcbiAqIHJlZGlyZWN0cyAoYDI+JjFgKSBhbmQgcGFyZW4gbmVzdGluZyBzdGF5IGluc2lkZSB0aGUgY29tbWFuZCwgYW5kXG4gKiBoZXJlLXN0cmluZ3MgKGA8PDxgKSBhcmUgb3V0IG9mIHNjb3BlLiBBbiBJT19OVU1CRVIgZmQgZGlyZWN0bHkgYmVmb3JlIHRoZVxuICogb3BlcmF0b3IgKGAyPDxFT0ZgKSByZWRpcmVjdHMgdGhhdCBmZCwgbm90IHN0ZGluIFx1MjAxNCBub3QgYSBoZXJlZG9jLiBSZXR1cm5zXG4gKiBudWxsIHdoZW4gbm8gb3BlbmVyIGlzIGZvdW5kLlxuICovXG5mdW5jdGlvbiBmaW5kSGVyZWRvY09wZW5lcihyYXc6IHN0cmluZywgZnJvbTogbnVtYmVyKTogSGVyZWRvY09wZW5lciB8IG51bGwge1xuICBjb25zdCBuID0gcmF3Lmxlbmd0aDtcbiAgbGV0IGluU3F1b3RlID0gZmFsc2U7XG4gIGxldCBpbkRxdW90ZSA9IGZhbHNlO1xuICBsZXQgZGVwdGggPSAwO1xuICBsZXQgY21kU3RhcnQgPSBmcm9tO1xuICBsZXQgcGVuZGluZ1BpcGUgPSBmYWxzZTtcbiAgbGV0IGkgPSBmcm9tO1xuXG4gIC8qKiBSZWFkIG9uZSBkZWxpbWl0ZXIgd29yZCBzdGFydGluZyBhdCBgc3RhcnRgICh0aGUgYXR0YWNoZWQgdGFpbCBvZiBgPDxFT0ZgL2A8PCdFT0YnYCwgb3IgYSBzdGFuZGFsb25lIG5leHQgd29yZCkuIFF1b3RlcyBjb250cmlidXRlIHRoZWlyIGNvbnRlbnQ7IGEgYmFja3NsYXNoIGVzY2FwZXMgdGhlIG5leHQgY2hhci4gUmV0dXJucyBudWxsIG9uIGFuIHVuYmFsYW5jZWQgcXVvdGUgKGZhaWwgY2xvc2VkKS4gKi9cbiAgY29uc3QgcmVhZERlbGltV29yZCA9IChzdGFydDogbnVtYmVyKTogeyBkZWxpbTogc3RyaW5nOyBzYXdRdW90ZTogYm9vbGVhbjsgbmV4dDogbnVtYmVyIH0gfCBudWxsID0+IHtcbiAgICBsZXQgZCA9ICcnO1xuICAgIGxldCBzYXdRdW90ZSA9IGZhbHNlO1xuICAgIGxldCBrID0gc3RhcnQ7XG4gICAgd2hpbGUgKGsgPCBuICYmICEvXFxzLy50ZXN0KHJhd1trXSkgJiYgcmF3W2tdICE9PSAnPCcgJiYgcmF3W2tdICE9PSAnPicpIHtcbiAgICAgIGNvbnN0IGMgPSByYXdba107XG4gICAgICBpZiAoYyA9PT0gXCInXCIgfHwgYyA9PT0gJ1wiJykge1xuICAgICAgICBjb25zdCBxdW90ZSA9IGM7XG4gICAgICAgIGxldCBtID0gayArIDE7XG4gICAgICAgIHdoaWxlIChtIDwgbiAmJiByYXdbbV0gIT09IHF1b3RlKSB7XG4gICAgICAgICAgZCArPSByYXdbbV07XG4gICAgICAgICAgbSArPSAxO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtID49IG4pIHJldHVybiBudWxsO1xuICAgICAgICBzYXdRdW90ZSA9IHRydWU7XG4gICAgICAgIGsgPSBtICsgMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGsgKyAxIDwgbikge1xuICAgICAgICAvLyBBIGJhY2tzbGFzaC1lc2NhcGVkIGRlbGltaXRlciBjaGFyIHF1b3RlcyB0aGUgZGVsaW1pdGVyIFx1MjAxNCB0aGUgYm9keVxuICAgICAgICAvLyBpcyBsaXRlcmFsIChgPDxcXEVPRmApLCBzYW1lIGFzIHF1b3Rlcy5cbiAgICAgICAgZCArPSByYXdbayArIDFdO1xuICAgICAgICBzYXdRdW90ZSA9IHRydWU7XG4gICAgICAgIGsgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBkICs9IGM7XG4gICAgICBrICs9IDE7XG4gICAgfVxuICAgIHJldHVybiB7IGRlbGltOiBkLCBzYXdRdW90ZSwgbmV4dDogayB9O1xuICB9O1xuXG4gIHdoaWxlIChpIDwgbikge1xuICAgIGNvbnN0IGMgPSByYXdbaV07XG4gICAgaWYgKGluU3F1b3RlKSB7XG4gICAgICBpZiAoYyA9PT0gXCInXCIpIGluU3F1b3RlID0gZmFsc2U7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGluRHF1b3RlKSB7XG4gICAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikge1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcIicpIGluRHF1b3RlID0gZmFsc2U7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09IFwiJ1wiKSB7XG4gICAgICBpblNxdW90ZSA9IHRydWU7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcIicpIHtcbiAgICAgIGluRHF1b3RlID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikge1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnKCcpIHtcbiAgICAgIGRlcHRoICs9IDE7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcpJykge1xuICAgICAgZGVwdGggPSBNYXRoLm1heCgwLCBkZXB0aCAtIDEpO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChkZXB0aCA+IDApIHtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAocmF3LnN0YXJ0c1dpdGgoJyYmJywgaSkgfHwgcmF3LnN0YXJ0c1dpdGgoJ3x8JywgaSkpIHtcbiAgICAgIGNtZFN0YXJ0ID0gaSArIDI7XG4gICAgICBwZW5kaW5nUGlwZSA9IGZhbHNlO1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChyYXcuc3RhcnRzV2l0aCgnfCYnLCBpKSkge1xuICAgICAgY21kU3RhcnQgPSBpICsgMTtcbiAgICAgIHBlbmRpbmdQaXBlID0gdHJ1ZTtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJzsnKSB7XG4gICAgICBjbWRTdGFydCA9IGkgKyAxO1xuICAgICAgcGVuZGluZ1BpcGUgPSBmYWxzZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ3wnKSB7XG4gICAgICBjbWRTdGFydCA9IGkgKyAxO1xuICAgICAgcGVuZGluZ1BpcGUgPSB0cnVlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXFxuJykge1xuICAgICAgLy8gQSBuZXdsaW5lIGFmdGVyIGEgcGlwZSBpcyBhIGxpbmUgY29udGludWF0aW9uIChtaXJyb3JpbmdcbiAgICAgIC8vIHNwbGl0VG9wTGV2ZWwpOyBhbnl0aGluZyBlbHNlIHN0YXJ0cyBhIG5ldyBzaW1wbGUgY29tbWFuZC5cbiAgICAgIGlmICghcGVuZGluZ1BpcGUpIGNtZFN0YXJ0ID0gaSArIDE7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcmJykge1xuICAgICAgLy8gYCY+YC9gJj4+YCBhbmQgZHVwIHJlZGlyZWN0cyAoYDI+JjFgKSBhcmUgcmVkaXJlY3Qgb3BlcmF0b3JzLCBub3RcbiAgICAgIC8vIGNvbW1hbmQgc2VwYXJhdG9ycyAobWlycm9yaW5nIHNwbGl0VG9wTGV2ZWwpLlxuICAgICAgY29uc3QgdHJpbW1lZCA9IHJhdy5zbGljZShjbWRTdGFydCwgaSkudHJpbUVuZCgpO1xuICAgICAgY29uc3QgZHVwUmVkaXJlY3QgPVxuICAgICAgICB0cmltbWVkLmVuZHNXaXRoKCc+JykgJiYgKHRyaW1tZWQubGVuZ3RoID09PSAxIHx8IC9cXHN8XFxkLy50ZXN0KHRyaW1tZWRbdHJpbW1lZC5sZW5ndGggLSAyXSA/PyAnJykpO1xuICAgICAgaWYgKHJhd1tpICsgMV0gPT09ICc+JyB8fCBkdXBSZWRpcmVjdCkge1xuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY21kU3RhcnQgPSBpICsgMTtcbiAgICAgIHBlbmRpbmdQaXBlID0gZmFsc2U7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICc8JyAmJiByYXdbaSArIDFdID09PSAnPCcpIHtcbiAgICAgIC8vIGA8PDxgIGlzIGEgaGVyZS1zdHJpbmcgKG91dCBvZiBzY29wZSk7IGA8PC1gIHN0cmlwcyBsZWFkaW5nIHRhYnMuXG4gICAgICBpZiAocmF3W2kgKyAyXSA9PT0gJzwnKSB7XG4gICAgICAgIGkgKz0gMztcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBsZXQgaiA9IGkgLSAxO1xuICAgICAgd2hpbGUgKGogPj0gZnJvbSAmJiAvXFxkLy50ZXN0KHJhd1tqXSkpIGogLT0gMTtcbiAgICAgIGNvbnN0IGlvTnVtYmVyID0gaiA8IGkgLSAxICYmIChqIDwgZnJvbSB8fCAvXFxzfFs7fCYoXS8udGVzdChyYXdbal0pKTtcbiAgICAgIGlmIChpb051bWJlcikge1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgdGFiU3RyaXAgPSByYXdbaSArIDJdID09PSAnLSc7XG4gICAgICBjb25zdCBvcExlbiA9IHRhYlN0cmlwID8gMyA6IDI7XG4gICAgICBjb25zdCBsaW5lRW5kID0gcmF3LmluZGV4T2YoJ1xcbicsIGkpO1xuICAgICAgY29uc3Qgb3BlbmVyTGluZUVuZCA9IGxpbmVFbmQgPT09IC0xID8gbiA6IGxpbmVFbmQ7XG4gICAgICBjb25zdCBhdHRhY2hlZCA9IHJlYWREZWxpbVdvcmQoaSArIG9wTGVuKTtcbiAgICAgIGxldCBkZWxpbSA9IGF0dGFjaGVkID09PSBudWxsID8gJycgOiBhdHRhY2hlZC5kZWxpbTtcbiAgICAgIGxldCBzYXdRdW90ZSA9IGF0dGFjaGVkID09PSBudWxsID8gZmFsc2UgOiBhdHRhY2hlZC5zYXdRdW90ZTtcbiAgICAgIGlmIChkZWxpbSA9PT0gJycgJiYgYXR0YWNoZWQgIT09IG51bGwpIHtcbiAgICAgICAgLy8gU3RhbmRhbG9uZSBvcGVyYXRvcjogdGhlIGRlbGltaXRlciBpcyB0aGUgbmV4dCB3b3JkLlxuICAgICAgICBsZXQgayA9IGF0dGFjaGVkLm5leHQ7XG4gICAgICAgIHdoaWxlIChrIDwgb3BlbmVyTGluZUVuZCAmJiAvXFxzLy50ZXN0KHJhd1trXSkpIGsgKz0gMTtcbiAgICAgICAgY29uc3Qgd29yZCA9IHJlYWREZWxpbVdvcmQoayk7XG4gICAgICAgIGlmICh3b3JkID09PSBudWxsKSBkZWxpbSA9ICcnO1xuICAgICAgICBlbHNlIHtcbiAgICAgICAgICBkZWxpbSA9IHdvcmQuZGVsaW07XG4gICAgICAgICAgc2F3UXVvdGUgPSB3b3JkLnNhd1F1b3RlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoZGVsaW0gPT09ICcnIHx8ICghc2F3UXVvdGUgJiYgIUJBUkVfREVMSU0udGVzdChkZWxpbSkpKSB7XG4gICAgICAgIC8vIE5vIGRlbGltaXRlciwgb3IgYSBiYXJlIGZvcm0gb3V0c2lkZSB0aGUgaWRlbnRpZmllciBzaGFwZSBcdTIwMTQgZmFpbFxuICAgICAgICAvLyBjbG9zZWQgYW5kIGtlZXAgc2Nhbm5pbmcgcGFzdCB0aGUgb3BlcmF0b3IuXG4gICAgICAgIGkgKz0gb3BMZW47XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHsgY21kU3RhcnQsIG9wZW5lckxpbmVFbmQsIGRlbGltLCB0YWJTdHJpcCwgcXVvdGVkRGVsaW06IHNhd1F1b3RlIH07XG4gICAgfVxuICAgIGkgKz0gMTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBUaGUgYm9keSBvZiBhbiBvcGVuZXIgcnVucyBmcm9tIGFmdGVyIHRoZSBvcGVuZXIgbGluZSdzIG5ld2xpbmUgdG8gdGhlIGxpbmVcbiAqIHRoYXQgaXMgZXhhY3RseSB0aGUgZGVsaW1pdGVyIChgPDxgKSwgb3IgaXRzIGxlYWRpbmctdGFiLXN0cmlwcGVkIGZvcm1cbiAqIChgPDwtYCksIHRyYWlsaW5nIHdoaXRlc3BhY2UgYWxsb3dlZC4gUmV0dXJucyB0aGUgY2xvc2VyJ3MgbGluZSBib3VuZHMsIG9yXG4gKiBudWxsIHdoZW4gbm8gY2xvc2VyIGV4aXN0cyAoZmFpbCBjbG9zZWQpLlxuICovXG5mdW5jdGlvbiBoZXJlZG9jQ2xvc2VyKHJhdzogc3RyaW5nLCBvcGVuOiBIZXJlZG9jT3BlbmVyKTogeyBsaW5lU3RhcnQ6IG51bWJlcjsgbGluZUVuZDogbnVtYmVyIH0gfCBudWxsIHtcbiAgY29uc3QgbiA9IHJhdy5sZW5ndGg7XG4gIGNvbnN0IGJvZHlTdGFydCA9IG9wZW4ub3BlbmVyTGluZUVuZCA8IG4gPyBvcGVuLm9wZW5lckxpbmVFbmQgKyAxIDogbjtcbiAgbGV0IGxpbmVQb3MgPSBib2R5U3RhcnQ7XG4gIHdoaWxlIChsaW5lUG9zIDwgbikge1xuICAgIGNvbnN0IG5sID0gcmF3LmluZGV4T2YoJ1xcbicsIGxpbmVQb3MpO1xuICAgIGNvbnN0IGxpbmVFbmQgPSBubCA9PT0gLTEgPyBuIDogbmw7XG4gICAgY29uc3QgY2FuZGlkYXRlID0gb3Blbi50YWJTdHJpcCA/IHJhdy5zbGljZShsaW5lUG9zLCBsaW5lRW5kKS5yZXBsYWNlKC9eXFx0Ky8sICcnKSA6IHJhdy5zbGljZShsaW5lUG9zLCBsaW5lRW5kKTtcbiAgICBpZiAoXG4gICAgICBjYW5kaWRhdGUgPT09IG9wZW4uZGVsaW0gfHxcbiAgICAgIChjYW5kaWRhdGUuc3RhcnRzV2l0aChvcGVuLmRlbGltKSAmJiAvXlsgXFx0XSokLy50ZXN0KGNhbmRpZGF0ZS5zbGljZShvcGVuLmRlbGltLmxlbmd0aCkpKVxuICAgICkge1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiBsaW5lUG9zLCBsaW5lRW5kIH07XG4gICAgfVxuICAgIGlmIChubCA9PT0gLTEpIHJldHVybiBudWxsO1xuICAgIGxpbmVQb3MgPSBubCArIDE7XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKlxuICogTWFzayBldmVyeSBoZXJlZG9jIG91dCBvZiB0aGUgcmF3IGNvbW1hbmQgc3RyaW5nLCByZXR1cm5pbmcgdGhlIGJvZGllcyBhbmRcbiAqIG9wZW5lcnMgZm9yIHJlLWFzc29jaWF0aW9uIGJ5IGluZGV4LiBUaGUgbWFzayBjb3ZlcnNcbiAqIGBbY21kU3RhcnQsIGNsb3NlckxpbmVFbmQpYCBcdTIwMTQgdGhlIG9wZW5lciBsaW5lIHRocm91Z2ggdGhlIGNsb3NlciBsaW5lLCB0aGVcbiAqIGNsb3NlcidzIG5ld2xpbmUgZXhjbHVkZWQgXHUyMDE0IHNvIGEgY29tbWFuZCBqb2luZWQgYmVmb3JlIHRoZSBvcGVuZXJcbiAqIChgY21kMSAmJiBjYXQgPDxFT0ZgKSBrZWVwcyBpdHMgc3RydWN0dXJlLCBhbmQgdGhlIHBsYWNlaG9sZGVyIHN0YW5kcyBhbG9uZVxuICogYXMgaXRzIG93biBzaW1wbGUgY29tbWFuZC4gQSBoZXJlZG9jIHdpdGhvdXQgYSBjbG9zZXIgZmFpbHMgY2xvc2VkOiBpdHNcbiAqIG9wZW5lciBsaW5lIHN0YXlzIHVubWFza2VkIGFuZCBzY2FubmluZyByZXN1bWVzIGFmdGVyIGl0LlxuICovXG5mdW5jdGlvbiBleHRyYWN0SGVyZWRvY1dyaXRlcyhyYXc6IHN0cmluZyk6IHsgd3JpdGVzOiBIZXJlZG9jV3JpdGVbXTsgbWFza2VkOiBzdHJpbmcgfSB7XG4gIGNvbnN0IHdyaXRlczogSGVyZWRvY1dyaXRlW10gPSBbXTtcbiAgbGV0IG1hc2tlZCA9ICcnO1xuICBsZXQgY3Vyc29yID0gMDtcbiAgZm9yICg7Oykge1xuICAgIGNvbnN0IG9wZW4gPSBmaW5kSGVyZWRvY09wZW5lcihyYXcsIGN1cnNvcik7XG4gICAgaWYgKG9wZW4gPT09IG51bGwpIGJyZWFrO1xuICAgIGNvbnN0IGNsb3NlID0gaGVyZWRvY0Nsb3NlcihyYXcsIG9wZW4pO1xuICAgIGlmIChjbG9zZSA9PT0gbnVsbCkge1xuICAgICAgY3Vyc29yID0gb3Blbi5vcGVuZXJMaW5lRW5kIDwgcmF3Lmxlbmd0aCA/IG9wZW4ub3BlbmVyTGluZUVuZCArIDEgOiByYXcubGVuZ3RoO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGJvZHlTdGFydCA9IG9wZW4ub3BlbmVyTGluZUVuZCA8IHJhdy5sZW5ndGggPyBvcGVuLm9wZW5lckxpbmVFbmQgKyAxIDogcmF3Lmxlbmd0aDtcbiAgICBsZXQgYm9keSA9IHJhdy5zbGljZShib2R5U3RhcnQsIGNsb3NlLmxpbmVTdGFydCkucmVwbGFjZSgvXFxuJC8sICcnKTtcbiAgICBpZiAob3Blbi50YWJTdHJpcCkgYm9keSA9IGJvZHkucmVwbGFjZSgvXlxcdCsvZ20sICcnKTtcbiAgICBtYXNrZWQgKz0gcmF3LnNsaWNlKGN1cnNvciwgb3Blbi5jbWRTdGFydCk7XG4gICAgbWFza2VkICs9IGBfX2hlcmVkb2NfJHt3cml0ZXMubGVuZ3RofV9fYDtcbiAgICB3cml0ZXMucHVzaCh7IG9wZW5lcjogcmF3LnNsaWNlKG9wZW4uY21kU3RhcnQsIG9wZW4ub3BlbmVyTGluZUVuZCksIGJvZHksIHF1b3RlZERlbGltOiBvcGVuLnF1b3RlZERlbGltIH0pO1xuICAgIGN1cnNvciA9IGNsb3NlLmxpbmVFbmQ7XG4gIH1cbiAgbWFza2VkICs9IHJhdy5zbGljZShjdXJzb3IpO1xuICByZXR1cm4geyB3cml0ZXMsIG1hc2tlZCB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFJlZGlyZWN0LXRva2VuIGFuYWx5c2lzIGFuZCB0aGUgd3JpdGUtdG91Y2ggZ3JhbW1hcnMgKHBsYW4gXHUwMEE3NS4xLCBcdTAwQTc1LjIpLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmludGVyZmFjZSBSZWRpcmVjdEluZm8ge1xuICAvKiogSU9fTlVNQkVSIGZkIChgMT5gL2AyPmApLCBvciBudWxsIHdoZW4gaW1wbGljaXQuICovXG4gIGZkOiBudW1iZXIgfCBudWxsO1xuICAvKiogVGhlIG9wZXJhdG9yLiAqL1xuICBvcDogJz4nIHwgJz4+JyB8ICcmPicgfCAnJj4+JyB8ICc+JicgfCAnPCcgfCAnPDwnIHwgJzw8LScgfCAnPDw8JztcbiAgLyoqIEF0dGFjaGVkIHRhcmdldCB0ZXh0LCBvciBudWxsIGZvciBhIHN0YW5kYWxvbmUgb3BlcmF0b3IgKHRhcmdldCA9IG5leHQgdG9rZW4pLiAqL1xuICB0YXJnZXQ6IHN0cmluZyB8IG51bGw7XG59XG5cbmNvbnN0IFJFRElSRUNUX1RPS0VOID0gL14oXFxkKikoPDw8fDw8LXwmPj58PDx8Pj58Jj58PiZ8PHw+KSguKikkLztcblxuZnVuY3Rpb24gY2xhc3NpZnlSZWRpcmVjdFRva2VuKHRleHQ6IHN0cmluZyk6IFJlZGlyZWN0SW5mbyB8IG51bGwge1xuICBjb25zdCBtID0gdGV4dC5tYXRjaChSRURJUkVDVF9UT0tFTik7XG4gIGlmIChtID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgWywgZmRUZXh0LCBvcCwgdGFyZ2V0XSA9IG07XG4gIHJldHVybiB7XG4gICAgZmQ6IGZkVGV4dCA9PT0gJycgPyBudWxsIDogTnVtYmVyLnBhcnNlSW50KGZkVGV4dCwgMTApLFxuICAgIG9wOiBvcCBhcyBSZWRpcmVjdEluZm9bJ29wJ10sXG4gICAgdGFyZ2V0OiB0YXJnZXQgPT09ICcnID8gbnVsbCA6IHRhcmdldFxuICB9O1xufVxuXG4vKipcbiAqIEEgY29udGVudC1wcm9kdWNpbmcgcmVkaXJlY3QgKHBsYW4gXHUwMEE3NS4xKTogZmQtMSBgPmAvYD4+YCAoZXhwbGljaXQgYDE+YC9gMT4+YFxuICogaW5jbHVkZWQpIGFuZCBgJj5gL2AmPj5gLiBGRC1udW1iZXJlZCAoYDI+YCksIGR1cCAoYDI+JjFgLCBgPiZmYCksXG4gKiBgJmAtbGVhZGluZy10YXJnZXQgZHVwIChgPiZgKSBhbmQgc3RkaW4gKGA8YCkgZm9ybXMgbmV2ZXIgcHJvZHVjZSBjb250ZW50LlxuICovXG5mdW5jdGlvbiBpc0NvbnRlbnRSZWRpcmVjdChyOiBSZWRpcmVjdEluZm8pOiBib29sZWFuIHtcbiAgaWYgKHIub3AgPT09ICc+JyB8fCByLm9wID09PSAnPj4nKSB7XG4gICAgaWYgKHIuZmQgIT09IG51bGwgJiYgci5mZCAhPT0gMSkgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChyLnRhcmdldD8uc3RhcnRzV2l0aCgnJicpKSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIHIub3AgPT09ICcmPicgfHwgci5vcCA9PT0gJyY+Pic7XG59XG5cbi8qKiBUaGUgYXJndiBzdHJlYW0gYW5kIHJlZGlyZWN0IGxpc3Qgb2YgYSBzaW1wbGUgY29tbWFuZCAocGxhbiBcdTAwQTc1LjEwKTogd29yZHMgbWludXMgcmVkaXJlY3QgdG9rZW5zIGFuZCB0aGVpciB0YXJnZXRzLiAqL1xuZnVuY3Rpb24gYW5hbHl6ZVRva2Vucyh0b2tlbnM6IFRva2VuW10pOiB7IGFyZ3Y6IHN0cmluZ1tdOyByZWRpcmVjdHM6IFJlZGlyZWN0SW5mb1tdIH0ge1xuICBjb25zdCBhcmd2OiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCByZWRpcmVjdHM6IFJlZGlyZWN0SW5mb1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgdG9rZW5zLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgdG9rZW4gPSB0b2tlbnNbaV07XG4gICAgaWYgKCF0b2tlbi5pc1JlZGlyZWN0KSB7XG4gICAgICBhcmd2LnB1c2godG9rZW4udGV4dCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgaW5mbyA9IGNsYXNzaWZ5UmVkaXJlY3RUb2tlbih0b2tlbi50ZXh0KTtcbiAgICBpZiAoaW5mbyA9PT0gbnVsbCkge1xuICAgICAgYXJndi5wdXNoKHRva2VuLnRleHQpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpbmZvLnRhcmdldCA9PT0gbnVsbCkge1xuICAgICAgLy8gQSBzdGFuZGFsb25lIG9wZXJhdG9yIGNvbnN1bWVzIHRoZSBuZXh0IHRva2VuIGFzIGl0cyB0YXJnZXQgKG9yXG4gICAgICAvLyBoZXJlZG9jIGRlbGltaXRlciAvIGhlcmUtc3RyaW5nIGNvbnRlbnQpIFx1MjAxNCBhdHRhY2hlZCB0byB0aGUgcmVkaXJlY3RcbiAgICAgIC8vIHNvIHRoZSB3cml0ZSBncmFtbWFycyBzZWUgaXQsIGFuZCBleGNsdWRlZCBmcm9tIGFyZ3YuXG4gICAgICBjb25zdCBuZXh0ID0gdG9rZW5zW2kgKyAxXTtcbiAgICAgIGlmIChuZXh0ICE9PSB1bmRlZmluZWQgJiYgIW5leHQuaXNSZWRpcmVjdCkge1xuICAgICAgICByZWRpcmVjdHMucHVzaCh7IC4uLmluZm8sIHRhcmdldDogbmV4dC50ZXh0IH0pO1xuICAgICAgICBpICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH1cbiAgICByZWRpcmVjdHMucHVzaChpbmZvKTtcbiAgfVxuICByZXR1cm4geyBhcmd2LCByZWRpcmVjdHMgfTtcbn1cblxuLyoqXG4gKiBMaXRlcmFsIGBlY2hvYC9gcHJpbnRmYCBjb250ZW50IChwbGFuIFx1MDBBNzUuMSkgZm9yIGJvZHkgdGhyZWFkaW5nOiBub1xuICogZmxhZ3MsIG5vIHNoZWxsIGV4cGFuc2lvbiwgbm8gZ2xvYnM7IGBwcmludGZgIG9ubHkgd2hlbiB0aGUgZm9ybWF0IGhhcyBub1xuICogYCVgL2JhY2tzbGFzaCBkaXJlY3RpdmVzICh0aGVuIHRoZSBmb3JtYXQgaXRzZWxmIGlzIHRoZSBsaXRlcmFsIGNvbnRlbnQpLlxuICogVGhyZWFkZWQgb24gYXBwZW5kcyBhcyB0aGUgc3VmZml4IGdhdGUncyBib2R5IGFuZCBvbiBzaW5nbGUgcGxhaW4gYD5gXG4gKiBvdmVyd3JpdGVzIChhbmQgdGVlIG9wZXJhbmRzIHdpdGggYSBvbmUtaG9wIGxpdGVyYWwgcGlwZSBzb3VyY2UpIGFzIHRoZVxuICogZXhhY3QgZ2F0ZSdzIHBvc3QtY29udGVudC5cbiAqL1xuZnVuY3Rpb24gbGl0ZXJhbENvbnRlbnQoYXJndjogc3RyaW5nW10pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICBjb25zdCBob3N0ID0gYXJndlswXTtcbiAgaWYgKGhvc3QgIT09ICdlY2hvJyAmJiBob3N0ICE9PSAncHJpbnRmJykgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3QgYXJncyA9IGFyZ3Yuc2xpY2UoMSk7XG4gIGlmIChhcmdzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgZm9yIChjb25zdCBhIG9mIGFyZ3MpIHtcbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykgfHwgaGFzU2hlbGxFeHBhbnNpb24oYSkgfHwgL1sqP10vLnRlc3QoYSkpIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgaWYgKGhvc3QgPT09ICdwcmludGYnKSB7XG4gICAgaWYgKGFyZ3MubGVuZ3RoICE9PSAxKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGZtdCA9IGFyZ3NbMF07XG4gICAgaWYgKGZtdC5pbmNsdWRlcygnJScpIHx8IGZtdC5pbmNsdWRlcygnXFxcXCcpKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIHJldHVybiBmbXQ7XG4gIH1cbiAgcmV0dXJuIGAke2FyZ3Muam9pbignICcpfVxcbmA7XG59XG5cbi8qKlxuICogUmVzb2x2ZSBhIHJlZGlyZWN0IHRhcmdldCBhZ2FpbnN0IHRoZSBjdXJyZW50IGRpcmVjdG9yeSwgZW1pdHRpbmcgdGhlXG4gKiB1bnJlc29sdmVkIHZlcmRpY3QgKHRoZSByZWFkIGlkaW9tcycgcmVhc29uKSB3aGVuIHRoZSBwYXRoIGNhcnJpZXMgYW5cbiAqIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYi4gUmV0dXJucyB0aGUgYWJzb2x1dGUgcGF0aCwgb3IgbnVsbC5cbiAqL1xuZnVuY3Rpb24gcmVzb2x2ZVRhcmdldChyZXN1bHRzOiBTcGFuTWF0Y2hbXSwgaWRpb206IElkaW9tLCB0YXJnZXQ6IHN0cmluZywgY3VycmVudERpcjogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmIChsb29rc1VucmVzb2x2YWJsZSh0YXJnZXQpKSB7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgaWRpb20sXG4gICAgICBmaWxlQXJnOiB0YXJnZXQsXG4gICAgICByZWFzb246ICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYidcbiAgICB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICByZXR1cm4gcmVzb2x2ZVBhdGgoY3VycmVudERpciwgdGFyZ2V0KTtcbn1cblxuLyoqIFRoZSBgdGVlYCBvcGVyYW5kIGdyYW1tYXI6IGFwcGVuZCBtb2RlIGFuZCBvcGVyYW5kIGxpc3Q7IHVua25vd24gb3B0aW9ucyByZXR1cm4gbnVsbCAoZmFpbCBjbG9zZWQpLiAqL1xuZnVuY3Rpb24gdGVlT3BlcmFuZFBhcnRzKGFyZ3Y6IHN0cmluZ1tdKTogeyBhcHBlbmQ6IGJvb2xlYW47IG9wZXJhbmRzOiBzdHJpbmdbXSB9IHwgbnVsbCB7XG4gIGxldCBhcHBlbmQgPSBmYWxzZTtcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcbiAgY29uc3Qgb3BlcmFuZHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgYSBvZiBhcmd2LnNsaWNlKDEpKSB7XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLWEnIHx8IGEgPT09ICctLWFwcGVuZCcpIHtcbiAgICAgIGFwcGVuZCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSByZXR1cm4gbnVsbDtcbiAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICB9XG4gIHJldHVybiB7IGFwcGVuZCwgb3BlcmFuZHMgfTtcbn1cblxuLyoqXG4gKiBUaGUgYHRlZWAgb3BlcmFuZCB3cml0ZXMgKHBsYW4gXHUwMEE3NS4xKTogZWFjaCBvcGVyYW5kIGlzIGEgd2hvbGUtZmlsZVxuICogY3JlYXRlLW92ZXJ3cml0ZSAodHJ1bmNhdGluZyksIG9yIGEgd2hvbGUtZmlsZSBhcHBlbmQgdW5kZXIgYC1hYC9gLS1hcHBlbmRgLlxuICogQSBvbmUtaG9wIGxpdGVyYWwgZWNoby9wcmludGYgcGlwZSBzb3VyY2UgKGBlY2hvIHggfCB0ZWUgZmAsIGBwcmludGYgeSB8XG4gKiB0ZWUgLWEgZmAsIHBsYW4gXHUwMEE3NS4yKSB0aHJlYWRzIGFzIHRoZSB3cml0dGVuIGJvZHkgXHUyMDE0IHRoZSBleGFjdCBnYXRlJ3NcbiAqIHBvc3QtY29udGVudCBvbiB0aGUgdHJ1bmNhdGluZyB3cml0ZSwgdGhlIHN1ZmZpeCBnYXRlJ3MgYm9keSBvbiB0aGUgYXBwZW5kO1xuICogd2l0aG91dCBhIGtub3duIHNvdXJjZSBuZWl0aGVyIG9wIGNhcnJpZXMgd3JpdHRlbiBjb250ZW50LlxuICovXG5mdW5jdGlvbiBtYXRjaFRlZU9wZXJhbmRzKFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgcGlwZUVjaG9Db250ZW50OiBzdHJpbmcgfCBudWxsLFxuICBjdXJyZW50RGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCBwYXJ0cyA9IHRlZU9wZXJhbmRQYXJ0cyhhcmd2KTtcbiAgaWYgKHBhcnRzID09PSBudWxsKSByZXR1cm47XG4gIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBwYXJ0cy5vcGVyYW5kcykge1xuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgJ3JlZGlyZWN0LXdyaXRlJywgb3BlcmFuZCwgY3VycmVudERpcik7XG4gICAgaWYgKGFic29sdXRlUGF0aCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiAncmVkaXJlY3Qtd3JpdGUnLFxuICAgICAgc3BhbjogIXBhcnRzLmFwcGVuZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIG9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnLFxuICAgICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICAgICAgam9pbixcbiAgICAgICAgICAgIC4uLihwaXBlRWNob0NvbnRlbnQgIT09IG51bGwgPyB7IHdyaXR0ZW46IHBpcGVFY2hvQ29udGVudCB9IDoge30pXG4gICAgICAgICAgfVxuICAgICAgICA6IHtcbiAgICAgICAgICAgIG9wZXJhdGlvbjogJ2FwcGVuZCcsXG4gICAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgICBqb2luLFxuICAgICAgICAgICAgLi4uKHBpcGVFY2hvQ29udGVudCAhPT0gbnVsbCA/IHsgd3JpdHRlbjogcGlwZUVjaG9Db250ZW50IH0gOiB7fSlcbiAgICAgICAgICB9XG4gICAgfSk7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgcmVkaXJlY3QgZmFtaWx5IGdyYW1tYXIgKHBsYW4gXHUwMEE3NS4xKSwgcnVuIGZvciBldmVyeSBzaW1wbGUgY29tbWFuZCBhZnRlclxuICogdGhlIHJlYWQgbWF0Y2hlcnM6IGNvbnRlbnQtcHJvZHVjaW5nIHJlZGlyZWN0cyBvbiBgZWNob2AvYHByaW50ZmAvYHRlZWBcbiAqIHdyaXRlIHdob2xlLWZpbGU7IGEgYmFyZSBgPiBmYCAvIGA6ID4gZmAgdHJ1bmNhdGVzICh0aGUgbWFpbiB3YWxrIGhhbmRzXG4gKiBhcmd2LWVtcHR5IGNvbW1hbmRzIGRpcmVjdGx5IGhlcmUpOyBgPj5gLW9ubHkgdHJ1bmNhdGlvbiBmb3JtcyBhcHBlbmRcbiAqIG5vdGhpbmcgYW5kIHRvdWNoIG5vdGhpbmcuIEFueSBvdGhlciBob3N0IHdpdGggYSBjb250ZW50IHJlZGlyZWN0IChgbHMgPiBmYCxcbiAqIGBweXRob24zIHgucHkgPiBvdXRgLCBgY2F0IGYgPiBnYCkgZ2V0cyBubyB3cml0ZSB0b3VjaCBcdTIwMTQgdGhlIHJlZGlyZWN0IGlzXG4gKiByZWFsLCBidXQgaXRzIGNvbnRlbnQgaXMgZHluYW1pYyBhbmQgb3V0IG9mIHNjb3BlLlxuICpcbiAqIEJvZHkgdGhyZWFkaW5nOiBleGFjdGx5IG9uZSBwbGFpbiBgPj5gIChvciBgMT4+YCkgY29udGVudCByZWRpcmVjdCBvbiBhXG4gKiBmdWxseSBsaXRlcmFsIGBlY2hvYC9gcHJpbnRmYCB0aHJlYWRzIHRoZSB3cml0dGVuIGJvZHkgKHRoZSBzdWZmaXggZ2F0ZSksXG4gKiBhbmQgZXhhY3RseSBvbmUgcGxhaW4gYD5gIChvciBgMT5gKSBjb250ZW50IHJlZGlyZWN0IG9uIHRoZSBzYW1lIGxpdGVyYWxzXG4gKiB0aHJlYWRzIGl0IGFzIHRoZSBleGFjdCBnYXRlJ3MgcG9zdC1jb250ZW50IChwbGFuIFx1MDBBNzMgc3RlcCAxYiBcdTIwMTQgdGhlXG4gKiBjb250ZW50IGxheWVyIGlzIHdoYXQgc3VwcHJlc3NlcyBgZWNobyBoaSA+IHJlYWQtb25seS1maWxlYCwgd2hlcmUgdGhlXG4gKiBmaWxlIHN0YXlzIHByZXNlbnQgYnV0IHVuY2hhbmdlZCkuIGAmPmAvYCY+PmAsIG11bHRpLXJlZGlyZWN0IGNvbW1hbmRzLFxuICogYW5kIGB0ZWVgJ3Mgb3duIHJlZGlyZWN0cyBuZXZlciB0aHJlYWQuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoUmVkaXJlY3RGYW1pbHkoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICByZWRpcmVjdHM6IFJlZGlyZWN0SW5mb1tdLFxuICBwaXBlRWNob0NvbnRlbnQ6IHN0cmluZyB8IG51bGwsXG4gIGN1cnJlbnREaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IGNvbnRlbnRSZWRpcmVjdHMgPSByZWRpcmVjdHMuZmlsdGVyKGlzQ29udGVudFJlZGlyZWN0KTtcbiAgY29uc3QgaG9zdCA9IGFyZ3ZbMF07XG4gIGlmIChjb250ZW50UmVkaXJlY3RzLmxlbmd0aCA9PT0gMCkge1xuICAgIGlmIChob3N0ID09PSAndGVlJykgbWF0Y2hUZWVPcGVyYW5kcyhhcmd2LCBwaXBlRWNob0NvbnRlbnQsIGN1cnJlbnREaXIsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiwgcmVzdWx0cyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChob3N0ID09PSB1bmRlZmluZWQgfHwgaG9zdCA9PT0gJzonIHx8IGhvc3QgPT09ICdleGVjJykge1xuICAgIC8vIEJhcmUgYD4gZmAsIGA6ID4gZmAgYW5kIGBleGVjID4gZmAgdHJ1bmNhdGUgKGV4ZWMgYXBwbGllcyB0aGUgcmVkaXJlY3RcbiAgICAvLyB0byB0aGUgc2hlbGwncyBvd24gZmQgMSBpbW1lZGlhdGVseSBcdTIwMTQgdGhlIGZkLTEgdGFyZ2V0IGlzIHN0YXRpYywgc28gdGhlXG4gICAgLy8gdHJ1bmNhdGlvbiBoYXBwZW5zIGV2ZW4gdGhvdWdoIHRoZSBjb21tYW5kIG5ldmVyIHdyaXRlcyk7XG4gICAgLy8gYD4+YC9gJj4+YCBhcHBlbmQgbm90aGluZyBcdTIxOTIgbm8gdG91Y2guXG4gICAgZm9yIChjb25zdCByIG9mIGNvbnRlbnRSZWRpcmVjdHMpIHtcbiAgICAgIGlmIChyLm9wID09PSAnPj4nIHx8IHIub3AgPT09ICcmPj4nIHx8IHIudGFyZ2V0ID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgJ3RydW5jYXRlLXdyaXRlJywgci50YXJnZXQsIGN1cnJlbnREaXIpO1xuICAgICAgaWYgKGFic29sdXRlUGF0aCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiAndHJ1bmNhdGUtd3JpdGUnLFxuICAgICAgICBzcGFuOiB7IG9wZXJhdGlvbjogJ3RydW5jYXRlJywgYWJzb2x1dGVQYXRoLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuICBpZiAoaG9zdCAhPT0gJ2VjaG8nICYmIGhvc3QgIT09ICdwcmludGYnICYmIGhvc3QgIT09ICd0ZWUnKSByZXR1cm47XG4gIGNvbnN0IHNpbmdsZVBsYWluQXBwZW5kID0gY29udGVudFJlZGlyZWN0cy5sZW5ndGggPT09IDEgJiYgY29udGVudFJlZGlyZWN0c1swXS5vcCA9PT0gJz4+JztcbiAgY29uc3Qgc2luZ2xlUGxhaW5PdmVyd3JpdGUgPSBjb250ZW50UmVkaXJlY3RzLmxlbmd0aCA9PT0gMSAmJiBjb250ZW50UmVkaXJlY3RzWzBdLm9wID09PSAnPic7XG4gIGNvbnN0IHRocmVhZGVkQXBwZW5kID0gc2luZ2xlUGxhaW5BcHBlbmQgJiYgaG9zdCAhPT0gJ3RlZScgPyBsaXRlcmFsQ29udGVudChhcmd2KSA6IHVuZGVmaW5lZDtcbiAgY29uc3QgdGhyZWFkZWRPdmVyd3JpdGUgPSBzaW5nbGVQbGFpbk92ZXJ3cml0ZSAmJiBob3N0ICE9PSAndGVlJyA/IGxpdGVyYWxDb250ZW50KGFyZ3YpIDogdW5kZWZpbmVkO1xuICBmb3IgKGNvbnN0IHIgb2YgY29udGVudFJlZGlyZWN0cykge1xuICAgIGlmIChyLnRhcmdldCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVRhcmdldChyZXN1bHRzLCAncmVkaXJlY3Qtd3JpdGUnLCByLnRhcmdldCwgY3VycmVudERpcik7XG4gICAgaWYgKGFic29sdXRlUGF0aCA9PT0gbnVsbCkgY29udGludWU7XG4gICAgaWYgKHIub3AgPT09ICc+PicgfHwgci5vcCA9PT0gJyY+PicpIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgaWRpb206ICdyZWRpcmVjdC13cml0ZScsXG4gICAgICAgIHNwYW46IHtcbiAgICAgICAgICBvcGVyYXRpb246ICdhcHBlbmQnLFxuICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgam9pbixcbiAgICAgICAgICAuLi4odGhyZWFkZWRBcHBlbmQgIT09IHVuZGVmaW5lZCA/IHsgd3JpdHRlbjogdGhyZWFkZWRBcHBlbmQgfSA6IHt9KVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogJ3JlZGlyZWN0LXdyaXRlJyxcbiAgICAgICAgc3Bhbjoge1xuICAgICAgICAgIG9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnLFxuICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgam9pbixcbiAgICAgICAgICAuLi4odGhyZWFkZWRPdmVyd3JpdGUgIT09IHVuZGVmaW5lZCA/IHsgd3JpdHRlbjogdGhyZWFkZWRPdmVyd3JpdGUgfSA6IHt9KVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH1cbiAgaWYgKGhvc3QgPT09ICd0ZWUnKSBtYXRjaFRlZU9wZXJhbmRzKGFyZ3YsIHBpcGVFY2hvQ29udGVudCwgY3VycmVudERpciwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luLCByZXN1bHRzKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUaGUgZmlsZS1tdXRhdGlvbiBmYW1pbHkgZ3JhbW1hcnMgKHBsYW4gXHUwMEE3NS4zXHUyMDEzXHUwMEE3NS43KTogY3AvaW5zdGFsbC9tdi9naXQgbXYsXG4vLyBybS9naXQgcm0vdHJ1bmNhdGUsIHNlZCAtaSBpbi1wbGFjZSBlZGl0cywgYW5kIHBhdGNoL2dpdCBhcHBseS4gVGhleSBzaGFyZVxuLy8gdGhlIFx1MDBBNzUgZmFpbC1jbG9zZWQgcnVsZXM6IGxlYWRpbmcgZW52IGFzc2lnbm1lbnRzIChzdHJpcHBlZCBieSB0aGUgd2Fsaylcbi8vIGFuZCBvbmUgYGNvbW1hbmRgL2BlbnZgIHdyYXBwZXIgYXJlIHNraXBwZWQgKG1lY2hhbmljYWxseSBjZXJ0YWluKTsgYW55XG4vLyBvdGhlciB3cmFwcGVyIGlzIHVucmVzb2x2ZWQ7IGEgbGVhZGluZy1gLWAgdG9rZW4gdGhhdCBpcyBub3QgYSBrbm93biBvcHRpb25cbi8vIGlzIHRyZWF0ZWQgYXMgYW4gb3B0aW9uOyBgLS1gIG1ha2VzIHRoZSByZXN0IG9wZXJhbmRzOyBnbG9iYmVkIG9yIHZhcmlhYmxlXG4vLyBwYXRocyBhcmUgdW5yZXNvbHZlZDsgZGlyZWN0b3J5LXNoYXBlZCBzb3VyY2Ugb3BlcmFuZHMgZmFpbCBjbG9zZWQuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFdyYXBwZXIgd29yZHMgdGhhdCBvYnNjdXJlIHRoZSB3cmFwcGVkIGNvbW1hbmQncyBhcmd2IChwbGFuIFx1MDBBNzUpOiBhIGZhbWlseSBjb21tYW5kIGJlaGluZCBvbmUgaXMgdW5yZXNvbHZlZCwgbmV2ZXIgZ3Vlc3NlZC4gKi9cbmNvbnN0IEZPUkVJR05fV1JBUFBFUlMgPSBuZXcgU2V0KFsnc3VkbycsICd4YXJncycsICdub2h1cCcsICd0aW1lJywgJ25pY2UnLCAnZG9hcyddKTtcblxuLyoqIEEgbGVhZGluZyBgTkFNRT12YWx1ZWAgYXNzaWdubWVudCB0b2tlbiAoYGVudiBGT089YmFyIGNwIGEgYmAga2VlcHMgb25lIGFmdGVyIHRoZSB3cmFwcGVyIHdvcmQpLiAqL1xuY29uc3QgQVNTSUdOTUVOVF9UT0tFTiA9IC9eW0EtWmEtel9dW0EtWmEtejAtOV9dKj0vO1xuXG4vKipcbiAqIFN0cmlwIGF0IG1vc3Qgb25lIGBjb21tYW5kYC9gZW52YCB3cmFwcGVyIFx1MjAxNCBtZWNoYW5pY2FsbHkgdHJhbnNwYXJlbnQgKHBsYW5cbiAqIFx1MDBBNzUpIFx1MjAxNCBhbmQgYW55IGxlYWRpbmcgYXNzaWdubWVudHMgYWZ0ZXIgaXQ6IGBlbnYgRk9PPWJhciBjcCBhIGJgIHNldHMgRk9PXG4gKiB0aGVuIHJ1bnMgY3AsIGV4YWN0bHkgdGhlIHRyYW5zcGFyZW50LXByZWZpeCBjbGFzcyB0aGUgd2FsayBzdHJpcHMgYmVmb3JlXG4gKiB0b2tlbml6aW5nIChgRk9PPWJhciBlbnYgY3AgYSBiYCBhcnJpdmVzIGhlcmUgd2l0aCB0aGUgYXNzaWdubWVudHMgYWxyZWFkeVxuICogZ29uZSkuXG4gKi9cbmZ1bmN0aW9uIHN0cmlwVHJhbnNwYXJlbnRXcmFwcGVyKGFyZ3Y6IHN0cmluZ1tdKTogc3RyaW5nW10ge1xuICBjb25zdCB1bndyYXBwZWQgPSBhcmd2WzBdID09PSAnY29tbWFuZCcgfHwgYXJndlswXSA9PT0gJ2VudicgPyBhcmd2LnNsaWNlKDEpIDogYXJndjtcbiAgbGV0IGkgPSAwO1xuICB3aGlsZSAoaSA8IHVud3JhcHBlZC5sZW5ndGggJiYgQVNTSUdOTUVOVF9UT0tFTi50ZXN0KHVud3JhcHBlZFtpXSkpIGkgKz0gMTtcbiAgcmV0dXJuIGkgPiAwID8gdW53cmFwcGVkLnNsaWNlKGkpIDogdW53cmFwcGVkO1xufVxuXG5mdW5jdGlvbiBwdXNoVW5yZXNvbHZlZChyZXN1bHRzOiBTcGFuTWF0Y2hbXSwgaWRpb206IElkaW9tLCBmaWxlQXJnOiBzdHJpbmcsIHJlYXNvbjogc3RyaW5nKTogdm9pZCB7XG4gIHJlc3VsdHMucHVzaCh7IHN0YXR1czogJ3VucmVzb2x2ZWQnLCBpZGlvbSwgZmlsZUFyZywgcmVhc29uIH0pO1xufVxuXG4vKiogV2hldGhlciB0aGUgcGF0aCBpcyBhbiBleGlzdGluZyBkaXJlY3RvcnkgKHRoZSBkZXN0LWRpciBkZWNpc2lvbiwgcGxhbiBcdTAwQTc1LjMvXHUwMEE3NS40OyBmcyBzdGF0IGxpa2UgdGhlIHJlYWQgaWRpb21zJyBsaW5lIGNvdW50cykuICovXG5mdW5jdGlvbiBpc0V4aXN0aW5nRGlyZWN0b3J5KGFic29sdXRlUGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHN0YXRTeW5jKGFic29sdXRlUGF0aCkuaXNEaXJlY3RvcnkoKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKlxuICogVGhlIHNoYXJlZCBjcC9pbnN0YWxsL212IG9wZXJhbmQgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjMvXHUwMEE3NS40KTogcGVyLWZhbWlseSBvcHRpb25cbiAqIHNldHMgYW5kIHRvdWNoIG9wZXJhdGlvbnMgYmVoaW5kIG9uZSBwYXJzZXIuXG4gKi9cbmludGVyZmFjZSBDb3B5TW92ZVNwZWMge1xuICBpZGlvbTogJ2NwLXdyaXRlJyB8ICdpbnN0YWxsLXdyaXRlJyB8ICdtdi13cml0ZSc7XG4gIC8qKiBLbm93biBuby12YWx1ZSBmbGFncyAoY29uc3VtZWQsIG5ldmVyIG9wZXJhbmRzKS4gKi9cbiAgbm9WYWx1ZTogUmVhZG9ubHlTZXQ8c3RyaW5nPjtcbiAgLyoqXG4gICAqIE5vLWNsb2JiZXIgZmxhZ3MgKGBjcCAtbmAvYC0tbm8tY2xvYmJlcmApOiBjb25zdW1lZCBsaWtlIG5vLXZhbHVlIGZsYWdzLFxuICAgKiBidXQgdGhlIHdyaXRlIHN0aWxsIHBhcnNlcyBcdTIwMTQgdGhlIHNraXAgaXMgaW52aXNpYmxlIHRvIHRoZSBwb3N0LWNvbW1hbmRcbiAgICogYnl0ZS1jb21wYXJlIGdhdGUsIHdoaWNoIGNhbm5vdCBkaXN0aW5ndWlzaCBhIHJlYWwgY29weSBmcm9tIGEgcHJlLWV4aXN0aW5nXG4gICAqIGVxdWFsIGRlc3QgKHRoZSBkb2N1bWVudGVkIG5vLW9wIHJlc2lkdWUsIHBpbm5lZCBpblxuICAgKiBiYXNoLXdyaXRlLWludGVncmF0aW9uLnRlc3QudHMpLlxuICAgKi9cbiAgbm9DbG9iYmVyOiBSZWFkb25seVNldDxzdHJpbmc+O1xuICAvKiogS25vd24gdmFsdWUtdGFraW5nIGZsYWdzICh0aGUgbmV4dCB3b3JkIGlzIHRoZSB2YWx1ZSBcdTIwMTQgYC10IERJUmAsIG9yIGFuIGluc3RhbGwgbW9kZS9vd25lci9ncm91cCkuICovXG4gIHZhbHVlVGFraW5nOiBSZWFkb25seVNldDxzdHJpbmc+O1xuICAvKiogRmxhZ3MgdGhhdCBmYWlsIHRoZSB3aG9sZSBjb21tYW5kIGNsb3NlZCAoYGNwIC1iYC9gLS1iYWNrdXBgLCBgaW5zdGFsbCAtZGAsIGdpdCBtdiBkcnktcnVuIGAtbmAvYC0tZHJ5LXJ1bmApLiAqL1xuICBleGNsdWRlZDogUmVhZG9ubHlTZXQ8c3RyaW5nPjtcbiAgLyoqIFRoZSBwZXItc291cmNlIHRvdWNoOiBjcC9pbnN0YWxsIHJlYWQgdGhlaXIgc291cmNlczsgbXYgZGVsZXRlcyB0aGVtLiAqL1xuICBzb3VyY2VPcGVyYXRpb246ICdyZWFkJyB8ICdkZWxldGUnO1xuICAvKiogVGhlIHBlci1kZXN0IHRvdWNoOiBjcC9pbnN0YWxsIG92ZXJ3cml0ZTsgbXYgcmVuYW1lLWNvcGllcy4gKi9cbiAgZGVzdE9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnIHwgJ3JlbmFtZS1jb3B5Jztcbn1cblxuY29uc3QgQ1BfU1BFQzogQ29weU1vdmVTcGVjID0ge1xuICBpZGlvbTogJ2NwLXdyaXRlJyxcbiAgbm9WYWx1ZTogbmV3IFNldChbJy1yJywgJy1SJywgJy1wJywgJy1mJywgJy12JywgJy1pJywgJy11JywgJy1hJywgJy1kJywgJy1MJywgJy1QJ10pLFxuICBub0Nsb2JiZXI6IG5ldyBTZXQoWyctbicsICctLW5vLWNsb2JiZXInXSksXG4gIHZhbHVlVGFraW5nOiBuZXcgU2V0KFsnLXQnLCAnLS10YXJnZXQtZGlyZWN0b3J5J10pLFxuICBleGNsdWRlZDogbmV3IFNldChbJy1iJywgJy0tYmFja3VwJ10pLFxuICBzb3VyY2VPcGVyYXRpb246ICdyZWFkJyxcbiAgZGVzdE9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnXG59O1xuXG5jb25zdCBJTlNUQUxMX1NQRUM6IENvcHlNb3ZlU3BlYyA9IHtcbiAgaWRpb206ICdpbnN0YWxsLXdyaXRlJyxcbiAgbm9WYWx1ZTogbmV3IFNldChbJy1EJywgJy1zJywgJy12J10pLFxuICBub0Nsb2JiZXI6IG5ldyBTZXQoKSxcbiAgdmFsdWVUYWtpbmc6IG5ldyBTZXQoWyctdCcsICctLXRhcmdldC1kaXJlY3RvcnknLCAnLW0nLCAnLW8nLCAnLWcnXSksXG4gIGV4Y2x1ZGVkOiBuZXcgU2V0KFsnLWQnXSksXG4gIHNvdXJjZU9wZXJhdGlvbjogJ3JlYWQnLFxuICBkZXN0T3BlcmF0aW9uOiAnY3JlYXRlLW92ZXJ3cml0ZSdcbn07XG5cbmNvbnN0IE1WX1NQRUM6IENvcHlNb3ZlU3BlYyA9IHtcbiAgaWRpb206ICdtdi13cml0ZScsXG4gIC8vIGBtdiAtbmAgc3RheXMgaW4gbm9WYWx1ZSwgbm90IG5vQ2xvYmJlcjogYW4gbXYgc2tpcCBsZWF2ZXMgdGhlIHNvdXJjZSBpblxuICAvLyBwbGFjZSwgYW5kIHRoZSBkZWxldGUncyBvd24gYWJzZW5jZSBnYXRlIHRoZW4gZmFpbHMgdGhlIHRvdWNoIFx1MjAxNCB0aGVcbiAgLy8gbm8tY2xvYmJlciBibGluZCBzcG90IGlzIGNwJ3MgYnl0ZS1jb21wYXJlLCBub3QgbXYncy5cbiAgbm9WYWx1ZTogbmV3IFNldChbJy1mJywgJy1pJywgJy1uJywgJy12JywgJy11J10pLFxuICBub0Nsb2JiZXI6IG5ldyBTZXQoKSxcbiAgdmFsdWVUYWtpbmc6IG5ldyBTZXQoWyctdCcsICctLXRhcmdldC1kaXJlY3RvcnknXSksXG4gIGV4Y2x1ZGVkOiBuZXcgU2V0KCksXG4gIHNvdXJjZU9wZXJhdGlvbjogJ2RlbGV0ZScsXG4gIGRlc3RPcGVyYXRpb246ICdyZW5hbWUtY29weSdcbn07XG5cbmNvbnN0IEdJVF9NVl9TUEVDOiBDb3B5TW92ZVNwZWMgPSB7XG4gIGlkaW9tOiAnbXYtd3JpdGUnLFxuICBub1ZhbHVlOiBuZXcgU2V0KFsnLWYnLCAnLWsnLCAnLXYnXSksXG4gIG5vQ2xvYmJlcjogbmV3IFNldCgpLFxuICB2YWx1ZVRha2luZzogbmV3IFNldCgpLFxuICAvLyBgZ2l0IG12IC1uYC9gLS1kcnktcnVuYCBpcyBhIHRyaWFsIHJ1biB0aGF0IG1vdmVzIG5vdGhpbmcgKHRoZSBzYW1lXG4gIC8vIHJlYWQtb25seSBjbGFzcyBhcyBgcGF0Y2ggLS1kcnktcnVuYCwgcGxhbiBcdTAwQTc1LjcpIFx1MjAxNCBmYWlsIGNsb3NlZC5cbiAgZXhjbHVkZWQ6IG5ldyBTZXQoWyctbicsICctLWRyeS1ydW4nXSksXG4gIHNvdXJjZU9wZXJhdGlvbjogJ2RlbGV0ZScsXG4gIGRlc3RPcGVyYXRpb246ICdyZW5hbWUtY29weSdcbn07XG5cbmludGVyZmFjZSBDb3B5TW92ZVBhcnRzIHtcbiAgLyoqIE9wZXJhbmRzIGluIG9yZGVyIChzb3VyY2VzOyBpbiB0aGUgbm9uLWAtdGAgZm9ybSB0aGUgbGFzdCBpcyB0aGUgZGVzdCkuICovXG4gIG9wZXJhbmRzOiBzdHJpbmdbXTtcbiAgLyoqIFRoZSBgLXRgL2AtLXRhcmdldC1kaXJlY3RvcnlgIHZhbHVlLCBvciBudWxsLiAqL1xuICB0YXJnZXREaXI6IHN0cmluZyB8IG51bGw7XG59XG5cbi8qKlxuICogUGFyc2UgdGhlIG9wZXJhbmRzIG9mIGEgY3AvaW5zdGFsbC9tdiBjb21tYW5kOiBrbm93biBvcHRpb25zIGFyZSBjb25zdW1lZCxcbiAqIGAtLWAgbWFrZXMgdGhlIHJlc3Qgb3BlcmFuZHMsIGFuZCBgLXRgL2AtLXRhcmdldC1kaXJlY3RvcnlbPURJUl1gIGlzXG4gKiB2YWx1ZS10YWtpbmcgXHUyMDE0IHRoZSBuZXh0IHdvcmQgaXMgdGhlIHRhcmdldCBkaXJlY3RvcnksIG5ldmVyIGEgc291cmNlLiBBXG4gKiBsZWFkaW5nLWAtYCB0b2tlbiB0aGF0IGlzIG5vdCBhIGtub3duIG9wdGlvbiBpcyB0cmVhdGVkIGFzIGFuIG9wdGlvbiAobm9cbiAqIHRvdWNoKS4gUmV0dXJucyBudWxsIHdoZW4gYSBmYWlsLWNsb3NlZCBvcHRpb24gaXMgcHJlc2VudCBvciBhIHZhbHVlLXRha2luZ1xuICogZmxhZyBpcyBsZWZ0IHZhbHVlbGVzcy5cbiAqL1xuZnVuY3Rpb24gY29weU1vdmVQYXJ0cyhhcmdzOiBzdHJpbmdbXSwgc3BlYzogQ29weU1vdmVTcGVjKTogQ29weU1vdmVQYXJ0cyB8IG51bGwge1xuICBjb25zdCBvcGVyYW5kczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IHRhcmdldERpcjogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCBpID0gMDtcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcbiAgd2hpbGUgKGkgPCBhcmdzLmxlbmd0aCkge1xuICAgIGNvbnN0IGEgPSBhcmdzW2ldO1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy10JyB8fCBhID09PSAnLS10YXJnZXQtZGlyZWN0b3J5Jykge1xuICAgICAgY29uc3QgdiA9IGFyZ3NbaSArIDFdO1xuICAgICAgaWYgKHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGw7XG4gICAgICB0YXJnZXREaXIgPSB2O1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0tdGFyZ2V0LWRpcmVjdG9yeT0nKSkge1xuICAgICAgdGFyZ2V0RGlyID0gYS5zbGljZSgnLS10YXJnZXQtZGlyZWN0b3J5PScubGVuZ3RoKTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoc3BlYy5leGNsdWRlZC5oYXMoYSkpIHJldHVybiBudWxsO1xuICAgIGlmIChzcGVjLnZhbHVlVGFraW5nLmhhcyhhKSkge1xuICAgICAgaWYgKGFyZ3NbaSArIDFdID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChzcGVjLm5vVmFsdWUuaGFzKGEpIHx8IHNwZWMubm9DbG9iYmVyLmhhcyhhKSkge1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgaSArPSAxO1xuICB9XG4gIHJldHVybiB7IG9wZXJhbmRzLCB0YXJnZXREaXIgfTtcbn1cblxuLyoqXG4gKiBUaGUgcGVyLXNvdXJjZSB0b3VjaCBvZiBhIGNwL2luc3RhbGwvbXYgY29tbWFuZC4gY3AvaW5zdGFsbCBzb3VyY2VzIGFyZVxuICogd2hvbGUtZmlsZSByZWFkcyByZXNvbHZlZCBhZ2FpbnN0IGZzIGxpa2UgdGhlIHJlYWQgaWRpb21zOyBhIHNvdXJjZSB3aG9zZVxuICogbGluZSBjb3VudCBjYW5ub3QgYmUgcmVhZCBhdCBwYXJzZSB0aW1lIChtaXNzaW5nIG9yIHVucmVhZGFibGUgXHUyMDE0IHRoZSBwYXJzZVxuICogcnVucyBwb3N0LWNvbW1hbmQsIHNvIGEgc291cmNlIHRoZSBjb21wb3VuZCdzIG93biBlYXJsaWVyIGBybWAgZGVsZXRlZCBpc1xuICogZXhhY3RseSB0aGlzKSBzdGlsbCByZXNvbHZlcyBhcyBhIHJhbmdlLWxlc3Mgd2hvbGUtZmlsZSByZWFkOiB0aGUgZHJpdmVyXG4gKiBwYWlycyB0aGUgZGVzdGluYXRpb24gYWdhaW5zdCBpdCwgc28gdGhlIGFic2VudC1zb3VyY2UgcnVsZSAocGxhbiBcdTAwQTczIHN0ZXBcbiAqIDFiKSBhbmQgdGhlIHJlYWQncyBwb3N0LWNvbW1hbmQgZXhpc3RlbmNlIGdhdGUgYXBwbHkgXHUyMDE0IGFuIHVuZXhwbGFpbmVkXG4gKiBhYnNlbmNlIGZhaWxzIHRoZSBjb3B5IGRlY2lzaXZlbHkgYW5kIGEgcGhhbnRvbSBzb3VyY2UgbmV2ZXIgZmlyZXMgdGhlXG4gKiBkZXN0LiBUaGUgbXYgc291cmNlIGlzIGEgZGVsZXRlLlxuICovXG5mdW5jdGlvbiBlbWl0U291cmNlU3BhbihcbiAgcmVzdWx0czogU3Bhbk1hdGNoW10sXG4gIHNwZWM6IENvcHlNb3ZlU3BlYyxcbiAgYWJzb2x1dGVQYXRoOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXVxuKTogdm9pZCB7XG4gIGlmIChzcGVjLnNvdXJjZU9wZXJhdGlvbiA9PT0gJ2RlbGV0ZScpIHtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206IHNwZWMuaWRpb20sXG4gICAgICBzcGFuOiB7IG9wZXJhdGlvbjogJ2RlbGV0ZScsIGFic29sdXRlUGF0aCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICB9KTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgcmFuZ2UgPSByZXNvbHZlU3BlYyh7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0OiAxIH0sICgpID0+IGNvdW50RmlsZUxpbmVzKGFic29sdXRlUGF0aCkpO1xuICByZXN1bHRzLnB1c2goe1xuICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICBpZGlvbTogc3BlYy5pZGlvbSxcbiAgICBzcGFuOlxuICAgICAgcmFuZ2UgPT09IG51bGxcbiAgICAgICAgPyB7IG9wZXJhdGlvbjogJ3JlYWQnLCBhYnNvbHV0ZVBhdGgsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgICAgIDoge1xuICAgICAgICAgICAgb3BlcmF0aW9uOiAncmVhZCcsXG4gICAgICAgICAgICBsaW5lU3RhcnQ6IHJhbmdlLmxpbmVTdGFydCxcbiAgICAgICAgICAgIGxpbmVFbmQ6IHJhbmdlLmxpbmVFbmQsXG4gICAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgICAgICBqb2luXG4gICAgICAgICAgfVxuICB9KTtcbn1cblxuLyoqXG4gKiBUaGUgY3AvaW5zdGFsbC9tdiBmYW1pbHkgKHBsYW4gXHUwMEE3NS4zL1x1MDBBNzUuNCk6IG9wZXJhbmRzIHJlc29sdmUgdG8gc291cmNlL2Rlc3RcbiAqIHBhaXJzIFx1MjAxNCBlYWNoIHNvdXJjZSBpcyBhIHJlYWQgKGNwL2luc3RhbGwpIG9yIGRlbGV0ZSAobXYpLCBlYWNoIGRlc3QgYVxuICogY3JlYXRlLW92ZXJ3cml0ZSAoY3AvaW5zdGFsbCkgb3IgcmVuYW1lLWNvcHkgKG12KSwgc291cmNlcyBiZWZvcmUgZGVzdHMgaW5cbiAqIGRlY2xhcmF0aW9uIG9yZGVyLiBBIGRlc3QgdGhhdCBlbmRzIGluIGAvYCBvciBzdGF0cyBhcyBhbiBleGlzdGluZyBkaXJlY3RvcnlcbiAqIG1hcHMgdG8gYGRpci9iYXNlbmFtZShzb3VyY2UpYCBwZXIgc291cmNlOyBgLXQgRElSYC9gLS10YXJnZXQtZGlyZWN0b3J5PURJUmBcbiAqIG1hcHMgdGhlIHNhbWUgd2F5IGFuZCBpcyB1bnJlc29sdmVkIHdoZW4gaXRzIHZhbHVlIGlzIG5vdCBkaXJlY3Rvcnktc2hhcGVkLlxuICogTXVsdGktc291cmNlIGNvbW1hbmRzIG5lZWQgYSBkaXJlY3RvcnkgZGVzdDsgYSBkaXJlY3Rvcnktc2hhcGVkIG9yXG4gKiBnbG9iYmVkL3ZhcmlhYmxlIHNvdXJjZSwgYSBnbG9iYmVkL3ZhcmlhYmxlIGRlc3QsIG9yIGEgZmFpbC1jbG9zZWQgb3B0aW9uXG4gKiAoYGNwIC1iYCwgYGluc3RhbGwgLWRgLCBnaXQgbXYgYC1uYCkgZW1pdHMgbm8gdG91Y2hlcy5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hDb3B5TW92ZUZhbWlseShcbiAgYXJndjogc3RyaW5nW10sXG4gIGRpckZvclJlc29sdXRpb246IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHJlc3QgPSBzdHJpcFRyYW5zcGFyZW50V3JhcHBlcihhcmd2KTtcbiAgaWYgKHJlc3QubGVuZ3RoID09PSAwKSByZXR1cm47XG4gIGNvbnN0IGNvbW1hbmQgPSByZXN0WzBdO1xuICBsZXQgc3BlYzogQ29weU1vdmVTcGVjIHwgbnVsbCA9IG51bGw7XG4gIGxldCBhcmdzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgZGlyID0gZGlyRm9yUmVzb2x1dGlvbjtcbiAgaWYgKGNvbW1hbmQgPT09ICdjcCcgfHwgY29tbWFuZCA9PT0gJ2luc3RhbGwnIHx8IGNvbW1hbmQgPT09ICdtdicpIHtcbiAgICBzcGVjID0gY29tbWFuZCA9PT0gJ2NwJyA/IENQX1NQRUMgOiBjb21tYW5kID09PSAnaW5zdGFsbCcgPyBJTlNUQUxMX1NQRUMgOiBNVl9TUEVDO1xuICAgIGFyZ3MgPSByZXN0LnNsaWNlKDEpO1xuICB9IGVsc2UgaWYgKGNvbW1hbmQgPT09ICdnaXQnKSB7XG4gICAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQocmVzdC5zbGljZSgxKSk7XG4gICAgaWYgKHN1YiAhPT0gbnVsbCAmJiBzdWIuc3ViY29tbWFuZCA9PT0gJ212Jykge1xuICAgICAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlKSB7XG4gICAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdtdi13cml0ZScsICdtdicsICdnaXQgLUMgdGFyZ2V0IGNvbnRhaW5zIGFuIHVucmVzb2x2ZWQgc2hlbGwgdmFyaWFibGUnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgc3BlYyA9IEdJVF9NVl9TUEVDO1xuICAgICAgYXJncyA9IHJlc3Quc2xpY2UoMSkuc2xpY2Uoc3ViLnN1YklkeCArIDEpO1xuICAgICAgZGlyID0gc3ViLmNEaXIgPz8gZGlyRm9yUmVzb2x1dGlvbjtcbiAgICB9XG4gIH0gZWxzZSBpZiAoRk9SRUlHTl9XUkFQUEVSUy5oYXMoY29tbWFuZCkpIHtcbiAgICAvLyBBIHdyYXBwZXIgb2JzY3VyZXMgdGhlIHdyYXBwZWQgYXJndiBcdTIwMTQgZmFpbCBjbG9zZWQgcmF0aGVyIHRoYW4gbWlzLXBhcnNlLlxuICAgIGNvbnN0IHdyYXBwZWQgPSByZXN0WzFdO1xuICAgIGNvbnN0IHdyYXBwZWRTcGVjID1cbiAgICAgIHdyYXBwZWQgPT09ICdjcCcgPyBDUF9TUEVDIDogd3JhcHBlZCA9PT0gJ2luc3RhbGwnID8gSU5TVEFMTF9TUEVDIDogd3JhcHBlZCA9PT0gJ212JyA/IE1WX1NQRUMgOiBudWxsO1xuICAgIGlmICh3cmFwcGVkU3BlYyAhPT0gbnVsbCkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgd3JhcHBlZFNwZWMuaWRpb20sIHdyYXBwZWQsIGB0aGUgJHtjb21tYW5kfSB3cmFwcGVyIG9ic2N1cmVzIHRoZSAke3dyYXBwZWR9IGFyZ3ZgKTtcbiAgICB9XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChzcGVjID09PSBudWxsKSByZXR1cm47XG5cbiAgY29uc3QgcGFydHMgPSBjb3B5TW92ZVBhcnRzKGFyZ3MsIHNwZWMpO1xuICBpZiAocGFydHMgPT09IG51bGwgfHwgcGFydHMub3BlcmFuZHMubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgLy8gUmVzb2x2ZSBldmVyeSBzb3VyY2UgYmVmb3JlIGVtaXR0aW5nIGFueXRoaW5nOiBhIGRpcmVjdG9yeS1zaGFwZWQsXG4gIC8vIGdsb2JiZWQsIG9yIHZhcmlhYmxlIHNvdXJjZSBmYWlscyB0aGUgd2hvbGUgY29tbWFuZCBjbG9zZWQgKHRoZSBkZXN0XG4gIC8vIG1hcHBpbmcgaXMgcGVyLXNvdXJjZSwgc28gYW4gdW5rbm93YWJsZSBzb3VyY2UgbWFrZXMgdGhlIGRlc3RzIHVua25vd2FibGUpLlxuICBjb25zdCBzb3VyY2VQYXRoczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBzb3VyY2Ugb2YgcGFydHMub3BlcmFuZHMuc2xpY2UoMCwgcGFydHMudGFyZ2V0RGlyID09PSBudWxsID8gLTEgOiB1bmRlZmluZWQpKSB7XG4gICAgaWYgKHNvdXJjZS5lbmRzV2l0aCgnLycpKSByZXR1cm47XG4gICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVRhcmdldChyZXN1bHRzLCBzcGVjLmlkaW9tLCBzb3VyY2UsIGRpcik7XG4gICAgaWYgKGFic29sdXRlUGF0aCA9PT0gbnVsbCkgcmV0dXJuO1xuICAgIGlmIChpc0V4aXN0aW5nRGlyZWN0b3J5KGFic29sdXRlUGF0aCkpIHJldHVybjtcbiAgICBzb3VyY2VQYXRocy5wdXNoKGFic29sdXRlUGF0aCk7XG4gIH1cbiAgaWYgKHNvdXJjZVBhdGhzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gIGxldCBkZXN0UGF0aHM6IHN0cmluZ1tdO1xuICBpZiAocGFydHMudGFyZ2V0RGlyICE9PSBudWxsKSB7XG4gICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKHBhcnRzLnRhcmdldERpcikpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsIHNwZWMuaWRpb20sIHBhcnRzLnRhcmdldERpciwgJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICghcGFydHMudGFyZ2V0RGlyLmVuZHNXaXRoKCcvJykgJiYgIWlzRXhpc3RpbmdEaXJlY3RvcnkocmVzb2x2ZVBhdGgoZGlyLCBwYXJ0cy50YXJnZXREaXIpKSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgc3BlYy5pZGlvbSwgcGFydHMudGFyZ2V0RGlyLCAndGhlIC10IHRhcmdldCBpcyBub3QgYW4gZXhpc3RpbmcgZGlyZWN0b3J5Jyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHRhcmdldEFicyA9IHJlc29sdmVQYXRoKGRpciwgcGFydHMudGFyZ2V0RGlyKTtcbiAgICBkZXN0UGF0aHMgPSBzb3VyY2VQYXRocy5tYXAoKHApID0+IGpvaW5QYXRoKHRhcmdldEFicywgYmFzZW5hbWUocCkpKTtcbiAgfSBlbHNlIHtcbiAgICBjb25zdCBkZXN0ID0gcGFydHMub3BlcmFuZHNbcGFydHMub3BlcmFuZHMubGVuZ3RoIC0gMV07XG4gICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKGRlc3QpKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCBzcGVjLmlkaW9tLCBkZXN0LCAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgZGVzdEFicyA9IHJlc29sdmVQYXRoKGRpciwgZGVzdCk7XG4gICAgY29uc3QgZGVzdElzRGlyID0gZGVzdC5lbmRzV2l0aCgnLycpIHx8IGlzRXhpc3RpbmdEaXJlY3RvcnkoZGVzdEFicyk7XG4gICAgaWYgKHNvdXJjZVBhdGhzLmxlbmd0aCA+IDEgJiYgIWRlc3RJc0Rpcikge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgc3BlYy5pZGlvbSwgZGVzdCwgJ2EgbXVsdGktc291cmNlIGNvcHkvbW92ZSBuZWVkcyBhIGRpcmVjdG9yeSBkZXN0aW5hdGlvbicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBkZXN0UGF0aHMgPSBkZXN0SXNEaXIgPyBzb3VyY2VQYXRocy5tYXAoKHApID0+IGpvaW5QYXRoKGRlc3RBYnMsIGJhc2VuYW1lKHApKSkgOiBbZGVzdEFic107XG4gIH1cblxuICBmb3IgKGxldCBrID0gMDsgayA8IHNvdXJjZVBhdGhzLmxlbmd0aDsgaysrKSB7XG4gICAgZW1pdFNvdXJjZVNwYW4ocmVzdWx0cywgc3BlYywgc291cmNlUGF0aHNba10sIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbik7XG4gIH1cbiAgZm9yIChsZXQgayA9IDA7IGsgPCBzb3VyY2VQYXRocy5sZW5ndGg7IGsrKykge1xuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogc3BlYy5pZGlvbSxcbiAgICAgIHNwYW46IHsgb3BlcmF0aW9uOiBzcGVjLmRlc3RPcGVyYXRpb24sIGFic29sdXRlUGF0aDogZGVzdFBhdGhzW2tdLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgIH0pO1xuICB9XG59XG5cbmNvbnN0IFJNX05PX1ZBTFVFID0gbmV3IFNldChbJy1mJywgJy1pJywgJy12J10pO1xuLyoqIGBybWAvYGdpdCBybWAgZmxhZ3Mgd2hvc2Ugc2VtYW50aWNzIGFyZSBvdXQgb2Ygc2NvcGU6IHJlY3Vyc2l2ZSByZW1vdmFsIGFuZCBybWRpci4gKi9cbmNvbnN0IFJNX0VYQ0xVREVEID0gbmV3IFNldChbJy1yJywgJy1SJywgJy0tcmVjdXJzaXZlJywgJy1kJ10pO1xuLyoqIGBnaXQgcm1gIGFkZHMgdGhlIGRyeS1ydW4gZm9ybSB0byB0aGUgZXhjbHVzaW9ucy4gKi9cbmNvbnN0IEdJVF9STV9FWENMVURFRCA9IG5ldyBTZXQoWyctcicsICctUicsICctLXJlY3Vyc2l2ZScsICctZCcsICctbicsICctLWRyeS1ydW4nXSk7XG5cbi8qKlxuICogVGhlIHNoYXJlZCBybS9naXQgcm0gb3BlcmFuZCBncmFtbWFyIChwbGFuIFx1MDBBNzUuNSk6IGEgcmVjdXJzaXZlL3JtZGlyIGZsYWcgKG9yXG4gKiBgLS1jYWNoZWRgIGZvciBnaXQgcm0gXHUyMDE0IHRoZSB3b3JrdHJlZSBmaWxlIHN1cnZpdmVzKSBleGNsdWRlcyB0aGUgd2hvbGVcbiAqIGNvbW1hbmQ7IGVhY2ggcmVtYWluaW5nIGZpbGUtc2hhcGVkIG9wZXJhbmQgaXMgYSBkZWxldGUsIGFuZCBhXG4gKiBkaXJlY3Rvcnktc2hhcGVkIG9wZXJhbmQgZmFpbHMgY2xvc2VkLlxuICovXG5mdW5jdGlvbiBtYXRjaFJtT3BlcmFuZHMoXG4gIGFyZ3M6IHN0cmluZ1tdLFxuICBleGNsdWRlZDogUmVhZG9ubHlTZXQ8c3RyaW5nPixcbiAgZXhjbHVkZUNhY2hlZDogYm9vbGVhbixcbiAgZGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBsZXQgYWZ0ZXJEYXNoRGFzaCA9IGZhbHNlO1xuICBjb25zdCBvcGVyYW5kczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBhIG9mIGFyZ3MpIHtcbiAgICBpZiAoYWZ0ZXJEYXNoRGFzaCkge1xuICAgICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGV4Y2x1ZGVkLmhhcyhhKSB8fCAoZXhjbHVkZUNhY2hlZCAmJiBhID09PSAnLS1jYWNoZWQnKSkgcmV0dXJuO1xuICAgIGlmIChSTV9OT19WQUxVRS5oYXMoYSkpIGNvbnRpbnVlO1xuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7IC8vIHVua25vd24gb3B0aW9uIFx1MjE5MiB0cmVhdGVkIGFzIGFuIG9wdGlvblxuICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gIH1cbiAgZm9yIChjb25zdCBvcGVyYW5kIG9mIG9wZXJhbmRzKSB7XG4gICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKG9wZXJhbmQpKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncm0td3JpdGUnLCBvcGVyYW5kLCAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAob3BlcmFuZC5lbmRzV2l0aCgnLycpIHx8IGlzRXhpc3RpbmdEaXJlY3RvcnkocmVzb2x2ZVBhdGgoZGlyLCBvcGVyYW5kKSkpIGNvbnRpbnVlO1xuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogJ3JtLXdyaXRlJyxcbiAgICAgIHNwYW46IHsgb3BlcmF0aW9uOiAnZGVsZXRlJywgYWJzb2x1dGVQYXRoOiByZXNvbHZlUGF0aChkaXIsIG9wZXJhbmQpLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgIH0pO1xuICB9XG59XG5cbi8qKlxuICogU3RhdGljYWxseSBldmFsdWF0ZSBhbiBhYnNvbHV0ZSBgdHJ1bmNhdGUgLXNgIHNpemUgKHBsYW4gXHUwMEE3NS41KTogYSBwbGFpblxuICogaW50ZWdlciB3aXRoIGFuIG9wdGlvbmFsIEsvTS9HIHN1ZmZpeC4gUmVsYXRpdmUgc2l6ZXMgKGAtcyArTmAvYC1zIC1OYCksXG4gKiBgLXIgcmVmYCB2YWx1ZXMsIGFuZCBzaGVsbC1leHBhbmRlZCB2YWx1ZXMgZGVwZW5kIG9uIHJ1bnRpbWUgc3RhdGUgXHUyMTkyXG4gKiB1bmRlZmluZWQgKHRob3NlIHNwYW5zIGdhdGUgZXhpc3RlbmNlLW9ubHkpLlxuICovXG5mdW5jdGlvbiBldmFsdWF0ZVN0YXRpY1NpemUodmFsdWU6IHN0cmluZyB8IHVuZGVmaW5lZCk6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCBtID0gdmFsdWUubWF0Y2goL14oXFxkKykoW0tNR10pPyQvKTtcbiAgaWYgKG0gPT09IG51bGwpIHJldHVybiB1bmRlZmluZWQ7XG4gIGNvbnN0IGJhc2UgPSBOdW1iZXIucGFyc2VJbnQobVsxXSwgMTApO1xuICBjb25zdCBtdWx0ID0gbVsyXSA9PT0gJ0snID8gMTAyNCA6IG1bMl0gPT09ICdNJyA/IDEwMjQgKiogMiA6IG1bMl0gPT09ICdHJyA/IDEwMjQgKiogMyA6IDE7XG4gIHJldHVybiBiYXNlICogbXVsdDtcbn1cblxuLyoqXG4gKiBUaGUgdHJ1bmNhdGUgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjUpOiBgLXMgU0laRWAvYC1yIHJlZmAgYXJlIHZhbHVlLXRha2luZyBcdTIwMTQgdGhlXG4gKiBzaXplIHZhbHVlIG1heSBpdHNlbGYgbGVhZCB3aXRoIGAtYCAoYHRydW5jYXRlIC1zIC0xMCBmYCkgXHUyMDE0IGFuZCBgLWNgIGlzXG4gKiBjb21wYXRpYmxlLiBXaXRob3V0IGAtc2AvYC1yYCB0aGUgY29tbWFuZCBjaGFuZ2VzIG5vdGhpbmcgXHUyMTkyIG5vIHRvdWNoLiBFYWNoXG4gKiBmaWxlLXNoYXBlZCBvcGVyYW5kIGlzIGEgdHJ1bmNhdGU7IGFuIGFic29sdXRlIGAtcyBOYCBjYXJyaWVzIHRoZSBzdGF0aWNhbGx5XG4gKiBldmFsdWF0ZWQgc2l6ZSBvbiB0aGUgc3BhbiAodGhlIFx1MDBBNzMgYHNpemVgIGdhdGUncyBwb3N0LWNvbW1hbmQgYnl0ZSBjb3VudCxcbiAqIGAtcyAwYCBcdTIxOTIgZW1wdHkpLCByZWxhdGl2ZSBzaXplcyBhbmQgYC1yIHJlZmAgc3RheSBleGlzdGVuY2Utb25seS5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hUcnVuY2F0ZU9wZXJhbmRzKFxuICBhcmdzOiBzdHJpbmdbXSxcbiAgZGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBsZXQgc2F3U2l6ZUZsYWcgPSBmYWxzZTtcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcbiAgbGV0IHN0YXRpY1NpemU6IG51bWJlciB8IHVuZGVmaW5lZDtcbiAgY29uc3Qgb3BlcmFuZHM6IEFycmF5PHsgcGF0aDogc3RyaW5nOyBzaXplOiBudW1iZXIgfCB1bmRlZmluZWQgfT4gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBhcmdzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFyZ3NbaV07XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIG9wZXJhbmRzLnB1c2goeyBwYXRoOiBhLCBzaXplOiBzdGF0aWNTaXplIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1zJykge1xuICAgICAgc2F3U2l6ZUZsYWcgPSB0cnVlO1xuICAgICAgc3RhdGljU2l6ZSA9IGV2YWx1YXRlU3RhdGljU2l6ZShhcmdzW2kgKyAxXSk7XG4gICAgICBpICs9IDE7IC8vIGNvbnN1bWUgdGhlIHNpemUgdmFsdWUsIGV2ZW4gd2hlbiBpdCBsZWFkcyB3aXRoIGAtYFxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLXInKSB7XG4gICAgICBzYXdTaXplRmxhZyA9IHRydWU7XG4gICAgICBzdGF0aWNTaXplID0gdW5kZWZpbmVkOyAvLyB0aGUgbGFzdCBzaXplIG9wdGlvbiB3aW5zOyBhIHJlZiBoYXMgbm8gc3RhdGljIHZhbHVlXG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctYycpIGNvbnRpbnVlO1xuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7IC8vIHVua25vd24gb3B0aW9uIFx1MjE5MiB0cmVhdGVkIGFzIGFuIG9wdGlvblxuICAgIG9wZXJhbmRzLnB1c2goeyBwYXRoOiBhLCBzaXplOiBzdGF0aWNTaXplIH0pO1xuICB9XG4gIGlmICghc2F3U2l6ZUZsYWcpIHJldHVybjtcbiAgZm9yIChjb25zdCBvcGVyYW5kIG9mIG9wZXJhbmRzKSB7XG4gICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKG9wZXJhbmQucGF0aCkpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICd0cnVuY2F0ZS1jb21tYW5kJywgb3BlcmFuZC5wYXRoLCAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAob3BlcmFuZC5wYXRoLmVuZHNXaXRoKCcvJykgfHwgaXNFeGlzdGluZ0RpcmVjdG9yeShyZXNvbHZlUGF0aChkaXIsIG9wZXJhbmQucGF0aCkpKSBjb250aW51ZTtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206ICd0cnVuY2F0ZS1jb21tYW5kJyxcbiAgICAgIHNwYW46IHtcbiAgICAgICAgb3BlcmF0aW9uOiAndHJ1bmNhdGUnLFxuICAgICAgICBhYnNvbHV0ZVBhdGg6IHJlc29sdmVQYXRoKGRpciwgb3BlcmFuZC5wYXRoKSxcbiAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICBqb2luLFxuICAgICAgICAuLi4ob3BlcmFuZC5zaXplICE9PSB1bmRlZmluZWQgPyB7IHNpemU6IG9wZXJhbmQuc2l6ZSB9IDoge30pXG4gICAgICB9XG4gICAgfSk7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgcm0vZ2l0IHJtL3RydW5jYXRlIGZhbWlseSAocGxhbiBcdTAwQTc1LjUpOiBgcm1gL2BnaXQgcm1gIG9wZXJhbmRzIGFyZVxuICogZGVsZXRlcywgYHRydW5jYXRlYCBvcGVyYW5kcyBhcmUgdHJ1bmNhdGlvbnMgKG9ubHkgd2hlbiBgLXNgL2AtcmAgaXNcbiAqIHByZXNlbnQpLiBgZ2l0IHJtIC0tY2FjaGVkYCB0b3VjaGVzIG5vdGhpbmcuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoUm1UcnVuY2F0ZShcbiAgYXJndjogc3RyaW5nW10sXG4gIGRpckZvclJlc29sdXRpb246IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHJlc3QgPSBzdHJpcFRyYW5zcGFyZW50V3JhcHBlcihhcmd2KTtcbiAgaWYgKHJlc3QubGVuZ3RoID09PSAwKSByZXR1cm47XG4gIGNvbnN0IGNvbW1hbmQgPSByZXN0WzBdO1xuICBpZiAoY29tbWFuZCA9PT0gJ3JtJykge1xuICAgIG1hdGNoUm1PcGVyYW5kcyhyZXN0LnNsaWNlKDEpLCBSTV9FWENMVURFRCwgZmFsc2UsIGRpckZvclJlc29sdXRpb24sIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiwgcmVzdWx0cyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChjb21tYW5kID09PSAndHJ1bmNhdGUnKSB7XG4gICAgbWF0Y2hUcnVuY2F0ZU9wZXJhbmRzKHJlc3Quc2xpY2UoMSksIGRpckZvclJlc29sdXRpb24sIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiwgcmVzdWx0cyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChjb21tYW5kID09PSAnZ2l0Jykge1xuICAgIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKHJlc3Quc2xpY2UoMSkpO1xuICAgIGlmIChzdWIgIT09IG51bGwgJiYgc3ViLnN1YmNvbW1hbmQgPT09ICdybScpIHtcbiAgICAgIGlmIChzdWIuY0RpclVucmVzb2x2YWJsZSkge1xuICAgICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncm0td3JpdGUnLCAncm0nLCAnZ2l0IC1DIHRhcmdldCBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIG1hdGNoUm1PcGVyYW5kcyhcbiAgICAgICAgcmVzdC5zbGljZSgxKS5zbGljZShzdWIuc3ViSWR4ICsgMSksXG4gICAgICAgIEdJVF9STV9FWENMVURFRCxcbiAgICAgICAgdHJ1ZSxcbiAgICAgICAgc3ViLmNEaXIgPz8gZGlyRm9yUmVzb2x1dGlvbixcbiAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICBqb2luLFxuICAgICAgICByZXN1bHRzXG4gICAgICApO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKEZPUkVJR05fV1JBUFBFUlMuaGFzKGNvbW1hbmQpKSB7XG4gICAgY29uc3Qgd3JhcHBlZCA9IHJlc3RbMV07XG4gICAgaWYgKHdyYXBwZWQgPT09ICdybScgfHwgd3JhcHBlZCA9PT0gJ3RydW5jYXRlJykge1xuICAgICAgcHVzaFVucmVzb2x2ZWQoXG4gICAgICAgIHJlc3VsdHMsXG4gICAgICAgIHdyYXBwZWQgPT09ICdybScgPyAncm0td3JpdGUnIDogJ3RydW5jYXRlLWNvbW1hbmQnLFxuICAgICAgICB3cmFwcGVkLFxuICAgICAgICBgdGhlICR7Y29tbWFuZH0gd3JhcHBlciBvYnNjdXJlcyB0aGUgJHt3cmFwcGVkfSBhcmd2YFxuICAgICAgKTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBXaGV0aGVyIHRoZSBib2R5IG9mIGFuIHVucXVvdGVkIGhlcmVkb2MgaXMgc2hlbGwtbGl0ZXJhbC4gVGhlIHNoZWxsIGV4cGFuZHNcbiAqIGAkYCBhbmQgYmFja3RpY2sgc3Vic3RpdHV0aW9ucyBhbmQgcHJvY2Vzc2VzIGJhY2tzbGFzaCBlc2NhcGVzIChgXFwkYCwgYGAgXFxgIGBgLFxuICogYFxcXFxgLCBiYWNrc2xhc2gtbmV3bGluZSkgaW4gYW4gdW5xdW90ZWQgYm9keSBiZWZvcmUgdGhlIGhvc3QgcmVhZHMgaXQ7IGFcbiAqIGJhcmUgYmFja3NsYXNoIGJlZm9yZSBhbnkgb3RoZXIgY2hhciBzdXJ2aXZlcyBsaXRlcmFsbHkuIEEgcXVvdGVkIGRlbGltaXRlclxuICogbWFrZXMgdGhlIGJvZHkgbGl0ZXJhbCByZWdhcmRsZXNzIFx1MjAxNCBjaGVja2VkIGJ5IHRoZSBjYWxsZXIuXG4gKi9cbmZ1bmN0aW9uIGhlcmVkb2NCb2R5SXNMaXRlcmFsKGJvZHk6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBpZiAoYm9keS5pbmNsdWRlcygnJCcpIHx8IGJvZHkuaW5jbHVkZXMoJ2AnKSkgcmV0dXJuIGZhbHNlO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGJvZHkubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAoYm9keVtpXSAhPT0gJ1xcXFwnKSBjb250aW51ZTtcbiAgICBjb25zdCBuZXh0ID0gYm9keVtpICsgMV07XG4gICAgaWYgKG5leHQgPT09IHVuZGVmaW5lZCB8fCBuZXh0ID09PSAnJCcgfHwgbmV4dCA9PT0gJ2AnIHx8IG5leHQgPT09ICdcXFxcJyB8fCBuZXh0ID09PSAnXFxuJykgcmV0dXJuIGZhbHNlO1xuICAgIGkgKz0gMTtcbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn1cblxuLyoqXG4gKiBUaGUgaGVyZWRvYyB3cml0ZSBncmFtbWFyIChwbGFuIFx1MDBBNzUuMikgZm9yIHRoZSBob3N0IGZhbWlsaWVzIHdob3NlIGJvZGllcyBhcmVcbiAqIGNvbnRlbnQ6IGBjYXRgIChib2R5IFx1MjE5MiB0aGUgY29udGVudCByZWRpcmVjdHMpLCBgdGVlYCAoYm9keSBcdTIxOTIgdGhlIG9wZXJhbmRzKSxcbiAqIGFuZCBgcGF0Y2hgL2BnaXQgYXBwbHlgIChib2R5IFx1MjE5MiBwYXRjaCB0ZXh0LCBcdTAwQTc1LjcpLiBBbnkgb3RoZXIgaG9zdCdzIGhlcmVkb2NcbiAqIGJvZHkgaXMgbm90IGF0dHJpYnV0YWJsZSBjb250ZW50IFx1MjAxNCBzdGRpbi1vbmx5IGFuZCBub24tZmFtaWx5IGNvbW1hbmRzXG4gKiAoYHB5dGhvbjMgLSA8PEVPRiA+IG91dGAsIGBscyA+IG91dCA8PEVPRmApIGdldCBubyB3cml0ZSB0b3VjaCwgYW5kXG4gKiByZWFkLWZhbWlseSBjb21tYW5kcyAoYHNlZCAtbiAnMSwycCcgPDxFT0ZgKSBmYWxsIHRocm91Z2ggdG8gdGhlIHJlYWRcbiAqIG1hdGNoZXJzLiBFbXB0eSBgPj5gLWJvZGllcyBhcHBlbmQgbm90aGluZyBhbmQgdG91Y2ggbm90aGluZzsgZW1wdHkgYD5gLWJvZGllc1xuICogdHJ1bmNhdGUgKHdob2xlLWZpbGUsIHRoZSBGMiBydWxlKS5cbiAqXG4gKiBCb2R5IHRocmVhZGluZzogYD4+YCBhcHBlbmRzIGFuZCBgPmAgb3ZlcndyaXRlcyB0aHJlYWQgdGhlIGJvZHkgd2hlbiB0aGVcbiAqIGNvbnRlbnQgcmVkaXJlY3QgaXMgc2luZ2xlIGFuZCBwbGFpbiBcdTIwMTQgdGhlIGV4YWN0IGdhdGUncyBwb3N0LWNvbnRlbnQgb24gdGhlXG4gKiBvdmVyd3JpdGUgKHRoZSB0cmFpbGluZyBgXFxuYCB0aGUgZXh0cmFjdGlvbiBzdHJpcHMgaXMgcmVzdG9yZWQsIHNpbmNlIHRoZVxuICogZ2F0ZSBjb21wYXJlcyBmdWxsIGZpbGUgYnl0ZXMpLCB0aGUgc3VmZml4IGdhdGUncyBib2R5IG9uIHRoZSBhcHBlbmQgKHBsYW5cbiAqIFx1MDBBNzMgc3RlcCAxYiBsaXN0cyBcInRlZS9oZXJlZG9jIHdpdGggYSBsaXRlcmFsIGJvZHlcIiBpbiB0aGUgZXhhY3QgY2xhc3MpLlxuICogQW4gdW5xdW90ZWQgZGVsaW1pdGVyIGxldHMgdGhlIHNoZWxsIGV4cGFuZCB0aGUgYm9keSBiZWZvcmUgdGhlIGhvc3QgcmVhZHNcbiAqIGl0LCBzbyBvbmx5IGEgbGl0ZXJhbCBib2R5IChubyBgJGAsIGJhY2t0aWNrLCBvciBzaGVsbC1wcm9jZXNzZWQgYmFja3NsYXNoKVxuICogdGhyZWFkcyBcdTIwMTQgYW4gZXhwYW5kYWJsZSBvbmUgZGVncmFkZXMgdG8gdGhlIGV4aXN0ZW5jZS1nYXRlZCBhZHZpc29yeSBjbGFzc1xuICogcmF0aGVyIHRoYW4gcmlzayBhIGRlY2lzaXZlLWZhaWwgb24gY29udGVudCB0aGF0IG5ldmVyIHJlYWNoZWQgdGhlIGZpbGUuXG4gKi9cbmZ1bmN0aW9uIGNsYXNzaWZ5SGVyZWRvY09wZW5lcihcbiAgb3BlbmVyOiBzdHJpbmcsXG4gIGJvZHk6IHN0cmluZyxcbiAgcXVvdGVkRGVsaW06IGJvb2xlYW4sXG4gIGN1cnJlbnREaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IGJvZHlMaXRlcmFsID0gcXVvdGVkRGVsaW0gfHwgaGVyZWRvY0JvZHlJc0xpdGVyYWwoYm9keSk7XG4gIGNvbnN0IHRva2VucyA9IHRva2VuaXplKHN0cmlwTGVhZGluZ0Fzc2lnbm1lbnRzKG9wZW5lcikudHJpbSgpKTtcbiAgaWYgKHRva2VucyA9PT0gbnVsbCkgcmV0dXJuO1xuICBjb25zdCB7IGFyZ3YsIHJlZGlyZWN0cyB9ID0gYW5hbHl6ZVRva2Vucyh0b2tlbnMpO1xuICBjb25zdCBob3N0ID0gYXJndlswXTtcbiAgY29uc3QgY29udGVudFJlZGlyZWN0cyA9IHJlZGlyZWN0cy5maWx0ZXIoaXNDb250ZW50UmVkaXJlY3QpO1xuICBjb25zdCBzaW5nbGVQbGFpbkFwcGVuZCA9IGNvbnRlbnRSZWRpcmVjdHMubGVuZ3RoID09PSAxICYmIGNvbnRlbnRSZWRpcmVjdHNbMF0ub3AgPT09ICc+Pic7XG4gIGNvbnN0IHNpbmdsZVBsYWluT3ZlcndyaXRlID0gY29udGVudFJlZGlyZWN0cy5sZW5ndGggPT09IDEgJiYgY29udGVudFJlZGlyZWN0c1swXS5vcCA9PT0gJz4nO1xuXG4gIGNvbnN0IGVtaXRDb250ZW50UmVkaXJlY3RzID0gKCk6IHZvaWQgPT4ge1xuICAgIGZvciAoY29uc3QgciBvZiBjb250ZW50UmVkaXJlY3RzKSB7XG4gICAgICBpZiAoci50YXJnZXQgPT09IG51bGwpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVRhcmdldChyZXN1bHRzLCAnaGVyZWRvYy13cml0ZScsIHIudGFyZ2V0LCBjdXJyZW50RGlyKTtcbiAgICAgIGlmIChhYnNvbHV0ZVBhdGggPT09IG51bGwpIGNvbnRpbnVlO1xuICAgICAgaWYgKHIub3AgPT09ICc+PicgfHwgci5vcCA9PT0gJyY+PicpIHtcbiAgICAgICAgaWYgKGJvZHkubGVuZ3RoID09PSAwKSBjb250aW51ZTtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgICAgaWRpb206ICdoZXJlZG9jLXdyaXRlJyxcbiAgICAgICAgICBzcGFuOiB7XG4gICAgICAgICAgICBvcGVyYXRpb246ICdhcHBlbmQnLFxuICAgICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICAgICAgam9pbixcbiAgICAgICAgICAgIC4uLihzaW5nbGVQbGFpbkFwcGVuZCAmJiByLm9wID09PSAnPj4nICYmIGJvZHlMaXRlcmFsID8geyB3cml0dGVuOiBib2R5IH0gOiB7fSlcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgICAgaWRpb206ICdoZXJlZG9jLXdyaXRlJyxcbiAgICAgICAgICBzcGFuOlxuICAgICAgICAgICAgYm9keS5sZW5ndGggPT09IDBcbiAgICAgICAgICAgICAgPyB7IG9wZXJhdGlvbjogJ3RydW5jYXRlJywgYWJzb2x1dGVQYXRoLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgICAgICAgICAgICA6IHtcbiAgICAgICAgICAgICAgICAgIG9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnLFxuICAgICAgICAgICAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICAgICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICAgICAgICAgICAgam9pbixcbiAgICAgICAgICAgICAgICAgIC8vIFRoZSBleGFjdCBnYXRlIGNvbXBhcmVzIGZ1bGwgZmlsZSBieXRlcywgc28gdGhlIHRyYWlsaW5nXG4gICAgICAgICAgICAgICAgICAvLyBgXFxuYCB0aGUgZXh0cmFjdGlvbiBzdHJpcHBlZCBjb21lcyBiYWNrIG9uIHRoZSBvdmVyd3JpdGUuXG4gICAgICAgICAgICAgICAgICAuLi4oc2luZ2xlUGxhaW5PdmVyd3JpdGUgJiYgYm9keUxpdGVyYWwgPyB7IHdyaXR0ZW46IGAke2JvZHl9XFxuYCB9IDoge30pXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG5cbiAgaWYgKGhvc3QgPT09ICdjYXQnKSB7XG4gICAgZW1pdENvbnRlbnRSZWRpcmVjdHMoKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKGhvc3QgPT09ICd0ZWUnKSB7XG4gICAgY29uc3QgcGFydHMgPSB0ZWVPcGVyYW5kUGFydHMoYXJndik7XG4gICAgaWYgKHBhcnRzICE9PSBudWxsKSB7XG4gICAgICBmb3IgKGNvbnN0IG9wZXJhbmQgb2YgcGFydHMub3BlcmFuZHMpIHtcbiAgICAgICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVRhcmdldChyZXN1bHRzLCAnaGVyZWRvYy13cml0ZScsIG9wZXJhbmQsIGN1cnJlbnREaXIpO1xuICAgICAgICBpZiAoYWJzb2x1dGVQYXRoID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgICAgaWYgKHBhcnRzLmFwcGVuZCkge1xuICAgICAgICAgIGlmIChib2R5Lmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgICAgIGlkaW9tOiAnaGVyZWRvYy13cml0ZScsXG4gICAgICAgICAgICBzcGFuOiB7XG4gICAgICAgICAgICAgIG9wZXJhdGlvbjogJ2FwcGVuZCcsXG4gICAgICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICAgICAgICBqb2luLFxuICAgICAgICAgICAgICAuLi4oY29udGVudFJlZGlyZWN0cy5sZW5ndGggPT09IDAgJiYgYm9keUxpdGVyYWwgPyB7IHdyaXR0ZW46IGJvZHkgfSA6IHt9KVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgICAgICBpZGlvbTogJ2hlcmVkb2Mtd3JpdGUnLFxuICAgICAgICAgICAgc3BhbjpcbiAgICAgICAgICAgICAgYm9keS5sZW5ndGggPT09IDBcbiAgICAgICAgICAgICAgICA/IHsgb3BlcmF0aW9uOiAndHJ1bmNhdGUnLCBhYnNvbHV0ZVBhdGgsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gICAgICAgICAgICAgICAgOiB7XG4gICAgICAgICAgICAgICAgICAgIG9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnLFxuICAgICAgICAgICAgICAgICAgICBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgICAgICAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgICAgICAgICAgICAgICAgam9pbixcbiAgICAgICAgICAgICAgICAgICAgLy8gU2FtZSByZXN0b3JlZC1gXFxuYCBleGFjdCBib2R5IGFzIHRoZSByZWRpcmVjdCBicmFuY2g7IGFcbiAgICAgICAgICAgICAgICAgICAgLy8gdGVlIG9wZXJhbmQgd2l0aCBhIGNvbnRlbnQgcmVkaXJlY3QgcHJlc2VudCBrZWVwcyB0aGVcbiAgICAgICAgICAgICAgICAgICAgLy8gcmVkaXJlY3QncyB0aHJlYWRpbmcgb25seSAobWlycm9yIG9mIHRoZSBhcHBlbmQgYnJhbmNoKS5cbiAgICAgICAgICAgICAgICAgICAgLi4uKGNvbnRlbnRSZWRpcmVjdHMubGVuZ3RoID09PSAwICYmIGJvZHlMaXRlcmFsID8geyB3cml0dGVuOiBgJHtib2R5fVxcbmAgfSA6IHt9KVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIGVtaXRDb250ZW50UmVkaXJlY3RzKCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChob3N0ID09PSAncGF0Y2gnIHx8IGhvc3QgPT09ICdnaXQnKSB7XG4gICAgY2xhc3NpZnlQYXRjaEhlcmVkb2MoYXJndiwgYm9keSwgY3VycmVudERpciwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luLCByZXN1bHRzKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gTm9uLWZhbWlseSBob3N0OiB0aGUgYm9keSBpcyBub3QgYXR0cmlidXRhYmxlIGNvbnRlbnQgXHUyMDE0IG5vIHdyaXRlIHRvdWNoLlxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRoZSBzZWQgLWkgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjYpLCB0aGUgZmlyc3QgY29uc3VtZXIgb2YgZXhhY3QgcmFuZ2VzOiBhXG4vLyBzdWJzdGl0dXRpb24tb25seSBzY3JpcHQgd2l0aCBudW1lcmljIGFkZHJlc3NlcyBtb2RpZmllcyB0aGUgYWRkcmVzc2VkXG4vLyBsaW5lczsgYW55dGhpbmcgbGVzcyBzdGF0aWNhbGx5IGNlcnRhaW4gaXMgYSB3aG9sZS1maWxlIG1vZGlmeS4gVGhlXG4vLyBzdWZmaXgvc2NyaXB0IGRpc2FtYmlndWF0aW9uIGFuZCB0aGUgc2VnbWVudCBjbGFzc2lmaWNhdGlvbiBiZWxvdyBhcmUgdGhlXG4vLyB3aG9sZSBvZiBpdCBcdTIwMTQgZXZlcnl0aGluZyBlbHNlIGZvbGxvd3MgdGhlIHNoYXJlZCBcdTAwQTc1IGZhaWwtY2xvc2VkIHJ1bGVzLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBBIG51bWVyaWMtYWRkcmVzc2VkIHN1YnN0aXR1dGlvbiBzZWdtZW50IChgTmAsIGBOLE1gKSBcdTIwMTQgdGhlIG9ubHkgZm9ybSB3aXRoIGFuIGV4YWN0IHJhbmdlLiAqL1xuY29uc3QgTlVNRVJJQ19TVUJTVElUVVRJT04gPSAvXihcXGQrKSg/OiwoXFxkKykpP1tzeV0vO1xuXG4vKiogQW4gdW5hZGRyZXNzZWQgc3Vic3RpdHV0aW9uIHNlZ21lbnQgXHUyMDE0IGxpbmUtY291bnQtcHJlc2VydmluZywgd2hvbGUgZmlsZSBhZGRyZXNzZWQuICovXG5jb25zdCBVTlJFU1RSSUNURURfU1VCU1RJVFVUSU9OID0gL15bc3ldLztcblxuZnVuY3Rpb24gbWF0Y2hTZWRJbnBsYWNlKFxuICBhcmd2OiBzdHJpbmdbXSxcbiAgZGlyRm9yUmVzb2x1dGlvbjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcmVzdCA9IHN0cmlwVHJhbnNwYXJlbnRXcmFwcGVyKGFyZ3YpO1xuICBpZiAocmVzdC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgY29uc3QgY29tbWFuZCA9IHJlc3RbMF07XG4gIGlmIChjb21tYW5kID09PSAnc2VkJykge1xuICAgIG1hdGNoU2VkSW5wbGFjZUFyZ3MocmVzdC5zbGljZSgxKSwgZGlyRm9yUmVzb2x1dGlvbiwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luLCByZXN1bHRzKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKEZPUkVJR05fV1JBUFBFUlMuaGFzKGNvbW1hbmQpKSB7XG4gICAgY29uc3Qgd3JhcHBlZCA9IHJlc3RbMV07XG4gICAgaWYgKHdyYXBwZWQgPT09ICdzZWQnKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAnc2VkLWlucGxhY2UnLCB3cmFwcGVkLCBgdGhlICR7Y29tbWFuZH0gd3JhcHBlciBvYnNjdXJlcyB0aGUgJHt3cmFwcGVkfSBhcmd2YCk7XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogVGhlIHNlZCAtaSBvcGVyYW5kIGdyYW1tYXI6IGAtaWAgYmFyZSwgYC1pU1VGRklYYCBhdHRhY2hlZCwgb3IgYSBzZXBhcmF0ZVxuICogc3VmZml4IHdvcmQgcmVzb2x2ZWQgYnkgdGhlIHN0YW5kYXJkIGRpc2FtYmlndWF0aW9uIFx1MjAxNCB0aGUgd29yZCBhZnRlciBgLWlgXG4gKiBpcyB0aGUgc3VmZml4IG9ubHkgd2hlbiBpdCBkb2VzIG5vdCBzdGFydCB3aXRoIGAtYCwgaXMgbm90IHNjcmlwdC1zaGFwZWRcbiAqIChhIHNlZCBjb21tYW5kIGxldHRlciBvciBhbiBhZGRyZXNzIHN0YXJ0IFx1MjAxNCBgcy9hL2IvYCwgYDJkYCwgYC94L2RgKSwgYW5kIGFcbiAqIHNjcmlwdCBwbHVzIGF0IGxlYXN0IG9uZSBmaWxlIG9wZXJhbmQgc3RpbGwgZm9sbG93IGl0ICh0aGUgQlNEXG4gKiBzZXBhcmF0ZS1zdWZmaXggcmVhZGluZzsgR05VJ3MgYXR0YWNoZWQtb25seSByZWFkaW5nIG90aGVyd2lzZSkuIEFcbiAqIHNjcmlwdC1zaGFwZWQgd29yZCBpcyB0aGUgc2NyaXB0IHVuZGVyIEdOVSdzIHJlYWRpbmc6IGBzZWQgLWkgcy9hL2IvIGYgZ2BcbiAqIHdvdWxkIG90aGVyd2lzZSBzdGVhbCB0aGUgZmlyc3QgZmlsZSBvcGVyYW5kIGFzIGEgc3VmZml4IGFuZCBzaWxlbnRseSBtaXNzXG4gKiBpdHMgd3JpdGUgKHRoZSBtdWx0aS1maWxlLXNlZCBtaXNwYXJzZSkuIEFuIGF0dGFjaGVkIG9yIGRpc2FtYmlndWF0ZWRcbiAqIHN1ZmZpeCBpcyBhIGJhY2t1cDogYSBub24tZW1wdHkgc3VmZml4IGVtaXRzIGFuIGFkZGl0aW9uYWwgY3JlYXRlLW92ZXJ3cml0ZVxuICogdG91Y2ggb24gYDxmaWxlPjxTVUZGSVg+YDsgYW4gZW1wdHkgc3VmZml4ICh3aGljaCB0aGUgcXVvdGUtYXdhcmUgdG9rZW5pemVyXG4gKiBkcm9wcyBlbnRpcmVseSBcdTIwMTQgYHNlZCAtaSAnJyBmYCBhbmQgYHNlZCAtaSBmYCB0b2tlbml6ZSBhbGlrZSkgY3JlYXRlcyBub1xuICogYmFja3VwLlxuICpcbiAqIFRoZSBzY3JpcHQgaXMgdGhlIHNjcmlwdCBhcmd1bWVudCBwbHVzIGV2ZXJ5IGAtZWAgYXJndW1lbnQsIHNwbGl0IG9uIGA7YC5cbiAqIFNlZ21lbnRzIHRoYXQgYXJlIGFsbCBudW1lcmljLWFkZHJlc3NlZCBzdWJzdGl0dXRpb25zIHlpZWxkIHRoZSBleGFjdCByYW5nZVxuICogW21pbiBzdGFydCwgbWluKG1heCBlbmQsIEVPRildIChwZXIgZmlsZSwgRU9GIGZyb20gdGhlIHBvc3QtZWRpdCBjb3VudCk7XG4gKiBzZWdtZW50cyB0aGF0IGFyZSBhbGwgc3Vic3RpdHV0aW9ucyBcdTIwMTQgYW55IG51bWVyaWMvdW5hZGRyZXNzZWQgbWl4IFx1MjAxNCBhcmVcbiAqIHN0aWxsIGxpbmUtY291bnQtcHJlc2VydmluZywgc28gdGhlIHdob2xlIGZpbGUgaXMgYWRkcmVzc2VkIChbMSwgRU9GXSk7XG4gKiBhbnkgY291bnQtY2hhbmdpbmcsIHBhdHRlcm4tYWRkcmVzc2VkLCBzdGVwLCBvciBgJGAtYWRkcmVzc2VkIHNlZ21lbnQgaXMgYVxuICogd2hvbGUtZmlsZSBtb2RpZnkgd2l0aCBubyByYW5nZS4gQW4gYWJzZW50IHNjcmlwdCAobm8gc2NyaXB0IGFyZ3VtZW50LCBub1xuICogYC1lYCkgaXMgdW5yZXNvbHZlZC5cbiAqL1xuLyoqXG4gKiBBIHdvcmQgdGhhdCBjYW4gb25seSBiZSBhIHNlZCBzY3JpcHQsIG5ldmVyIGEgQlNEIHNlcGFyYXRlIHN1ZmZpeDogYSBzZWRcbiAqIGNvbW1hbmQgbGV0dGVyIChgc2AvYHlgL2BkYC9cdTIwMjYpLCBvciBhbiBhZGRyZXNzIHN0YXJ0IChkaWdpdCwgYC9gLCBgXFxgLCBgJGAsXG4gKiBgfmApLiBUaGUgbXVsdGktZmlsZSBmb3JtIGBzZWQgLWkgcy9hL2IvIGYgZ2AgcHV0cyB0aGUgc2NyaXB0IGltbWVkaWF0ZWx5XG4gKiBhZnRlciBiYXJlIGAtaWAgKEdOVSdzIHJlYWRpbmc7IHRoZSBCU0QgcmVhZGluZyBuZWVkcyBhIHNlcGFyYXRlIHN1ZmZpeFxuICogd29yZCBmaXJzdCwgYW5kIGEgbGV0dGVyLWxlYWRpbmcgb3IgYWRkcmVzcy1sZWFkaW5nIHdvcmQgaXMgbm90IG9uZSkuXG4gKi9cbmNvbnN0IFNFRF9TQ1JJUFRfU0hBUEUgPSAvXig/OltBLVphLXpdfFxcZHxcXC98XFxcXHxcXCR8fikvO1xuXG5mdW5jdGlvbiBtYXRjaFNlZElucGxhY2VBcmdzKFxuICBhcmdzOiBzdHJpbmdbXSxcbiAgZGlyOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBsZXQgc3VmZml4OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgbGV0IHNhd0lucGxhY2UgPSBmYWxzZTtcbiAgbGV0IGkgPSAwO1xuICBjb25zdCBlU2NyaXB0czogc3RyaW5nW10gPSBbXTtcbiAgLy8gVGhlIHNjcmlwdC9maWxlIHNwbGl0IG9mIHRoZSBwb3NpdGlvbmFscyBpcyBkZXJpdmVkIGFmdGVyIHRoZSBzY2FuOiB0aGVcbiAgLy8gZmlyc3QgcG9zaXRpb25hbCBpcyB0aGUgc2NyaXB0IGFyZ3VtZW50IG9ubHkgd2hlbiBubyBgLWVgIHNjcmlwdCBleGlzdHMgXHUyMDE0XG4gIC8vIHdpdGggYC1lYCBwcmVzZW50IGV2ZXJ5IHBvc2l0aW9uYWwgaXMgYSBmaWxlIChHTlUgc2VkIHJlYWRzIHRoZSBzY3JpcHRcbiAgLy8gZnJvbSBgLWVgIHRoZW4sIG5vdCBmcm9tIHRoZSBmaXJzdCBwb3NpdGlvbmFsKS5cbiAgY29uc3QgcG9zaXRpb25hbHM6IHN0cmluZ1tdID0gW107XG4gIC8vIEZpbGVzIHB1c2hlZCBvdXRzaWRlIHRoZSBwb3NpdGlvbmFsIHBhdGg6IGBzZWQgLWkgZmAgKHNjcmlwdCBhYnNlbnQpLlxuICBjb25zdCBmaWxlczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcblxuICB3aGlsZSAoaSA8IGFyZ3MubGVuZ3RoKSB7XG4gICAgY29uc3QgYSA9IGFyZ3NbaV07XG4gICAgaWYgKGFmdGVyRGFzaERhc2gpIHtcbiAgICAgIHBvc2l0aW9uYWxzLnB1c2goYSk7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctLScpIHtcbiAgICAgIGFmdGVyRGFzaERhc2ggPSB0cnVlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLW4nKSB7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctZScpIHtcbiAgICAgIGNvbnN0IHYgPSBhcmdzW2kgKyAxXTtcbiAgICAgIGlmICh2ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3NlZC1pbnBsYWNlJywgYSwgJ3RoZSAtZSBmbGFnIGlzIGxlZnQgdmFsdWVsZXNzJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGVTY3JpcHRzLnB1c2godik7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctaScpIHtcbiAgICAgIHNhd0lucGxhY2UgPSB0cnVlO1xuICAgICAgY29uc3QgdyA9IGFyZ3NbaSArIDFdO1xuICAgICAgaWYgKHcgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAvLyBgc2VkIC1pYCB3aXRoIG5vdGhpbmcgYWZ0ZXI6IG5vIHN1ZmZpeCwgbm8gc2NyaXB0IFx1MjAxNCB0aGUgYWJzZW50LXNjcmlwdFxuICAgICAgICAvLyBjaGVjayBiZWxvdyByZXNvbHZlcyB0aGlzIHVucmVzb2x2ZWQuXG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAody5zdGFydHNXaXRoKCctJykpIHtcbiAgICAgICAgLy8gVGhlIHdvcmQgYWZ0ZXIgLWkgaXMgYW4gb3B0aW9uLCBuZXZlciBhIHN1ZmZpeC5cbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHJlc3RBZnRlciA9IGFyZ3Muc2xpY2UoaSArIDIpO1xuICAgICAgaWYgKHJlc3RBZnRlci5sZW5ndGggPj0gMiAmJiAhU0VEX1NDUklQVF9TSEFQRS50ZXN0KHcpKSB7XG4gICAgICAgIC8vIFRoZSBCU0Qgc2VwYXJhdGUtc3VmZml4IHJlYWRpbmc6IHcgaXMgdGhlIHN1ZmZpeCwgYW5kIGEgc2NyaXB0IHBsdXNcbiAgICAgICAgLy8gYXQgbGVhc3Qgb25lIGZpbGUgb3BlcmFuZCBzdGlsbCBmb2xsb3cgXHUyMDE0IG9ubHkgZm9yIGEgc3VmZml4LXNoYXBlZFxuICAgICAgICAvLyB3b3JkIChgLmJha2AsIGAnJ2ApLiBBIHNjcmlwdC1zaGFwZWQgd29yZCBpcyB0aGUgc2NyaXB0IHVuZGVyIEdOVSdzXG4gICAgICAgIC8vIHJlYWRpbmcsIHNvIGBzZWQgLWkgcy9hL2IvIGYgZ2AgdHJlYXRzIGBzL2EvYi9gIGFzIHRoZSBzY3JpcHQgYW5kXG4gICAgICAgIC8vIGJvdGggZiBhbmQgZyBhcyBmaWxlcy5cbiAgICAgICAgc3VmZml4ID0gdztcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChyZXN0QWZ0ZXIubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIC8vIGBzZWQgLWkgZmA6IHcgaXMgdGhlIGxhc3QgdG9rZW4gXHUyMDE0IG5vIHNjcmlwdCBjYW4gZm9sbG93LCBzbyB3IGlzIHRoZVxuICAgICAgICAvLyBmaWxlIG9wZXJhbmQgd2l0aCB0aGUgc2NyaXB0IGFic2VudCAoR05VIGluc3RlYWQgcmVhZHMgdyBhcyBhIHNjcmlwdFxuICAgICAgICAvLyBhbmQgZXJyb3JzOyBlaXRoZXIgd2F5IHRoZSBlZGl0IGRvZXMgbm90IGhhcHBlbikuXG4gICAgICAgIGZpbGVzLnB1c2godyk7XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICAvLyBPbmUgdG9rZW4gYWZ0ZXIgdzogdyBpcyB0aGUgc2NyaXB0IGFyZ3VtZW50IChvciBhIGZpbGUsIHdoZW4gYC1lYFxuICAgICAgLy8gc2NyaXB0cyBhcmUgcHJlc2VudCkgYW5kIHRoZSB0b2tlbiBpcyBhIGZpbGUgXHUyMDE0IGNvbnN1bWUgYm90aCwgc29cbiAgICAgIC8vIG5laXRoZXIgZmFsbHMgdGhyb3VnaCB0byB0aGUgcG9zaXRpb25hbCBwYXRoIGFnYWluLlxuICAgICAgcG9zaXRpb25hbHMucHVzaCh3LCByZXN0QWZ0ZXJbMF0pO1xuICAgICAgaSArPSAzO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy1pJykgJiYgYS5sZW5ndGggPiAyKSB7XG4gICAgICBzYXdJbnBsYWNlID0gdHJ1ZTtcbiAgICAgIHN1ZmZpeCA9IGEuc2xpY2UoMik7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSB7XG4gICAgICAvLyBVbmtub3duIG9wdGlvbiBcdTIwMTQgbmV2ZXIgYSBzY3JpcHQgb3IgZmlsZS5cbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBwb3NpdGlvbmFscy5wdXNoKGEpO1xuICAgIGkgKz0gMTtcbiAgfVxuXG4gIGlmICghc2F3SW5wbGFjZSkgcmV0dXJuOyAvLyBub3QgYW4gaW4tcGxhY2UgZWRpdCBhdCBhbGxcbiAgY29uc3Qgc2NyaXB0QXJnID0gZVNjcmlwdHMubGVuZ3RoID09PSAwID8gKHBvc2l0aW9uYWxzWzBdID8/IG51bGwpIDogbnVsbDtcbiAgaWYgKHNjcmlwdEFyZyAhPT0gbnVsbCkgZmlsZXMucHVzaCguLi5wb3NpdGlvbmFscy5zbGljZSgxKSk7XG4gIGVsc2UgZmlsZXMucHVzaCguLi5wb3NpdGlvbmFscyk7XG4gIGNvbnN0IHNlZ21lbnRzOiBzdHJpbmdbXSA9IFtdO1xuICBpZiAoc2NyaXB0QXJnICE9PSBudWxsKSBzZWdtZW50cy5wdXNoKC4uLnNjcmlwdEFyZy5zcGxpdCgnOycpKTtcbiAgZm9yIChjb25zdCBzIG9mIGVTY3JpcHRzKSBzZWdtZW50cy5wdXNoKC4uLnMuc3BsaXQoJzsnKSk7XG4gIGlmIChzZWdtZW50cy5sZW5ndGggPT09IDApIHtcbiAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAnc2VkLWlucGxhY2UnLCBmaWxlc1swXSA/PyAnc2VkJywgJ25vIHNjcmlwdCAoYWJzZW50IG9yIGVtcHR5IHNjcmlwdCBhcmd1bWVudCknKTtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBTZWdtZW50IGNsYXNzaWZpY2F0aW9uOiBleGFjdCB3aGVuIGV2ZXJ5IHNlZ21lbnQgaXMgYSBudW1lcmljLWFkZHJlc3NlZFxuICAvLyBzdWJzdGl0dXRpb247IGV4cGxpY2l0IHdob2xlLWZpbGUgWzEsIEVPRl0gd2hlbiBldmVyeSBzZWdtZW50IGlzIHN0aWxsIGFcbiAgLy8gc3Vic3RpdHV0aW9uIChhbnkgdW5hZGRyZXNzZWQvbnVtZXJpYyBtaXgpOyBubyByYW5nZSBvdGhlcndpc2UuXG4gIGxldCBhbGxOdW1lcmljID0gdHJ1ZTtcbiAgbGV0IGFsbFN1YnN0aXR1dGlvbiA9IHRydWU7XG4gIGxldCBtaW5TdGFydCA9IEluZmluaXR5O1xuICBsZXQgbWF4RW5kID0gMDtcbiAgZm9yIChjb25zdCBzZWdtZW50IG9mIHNlZ21lbnRzKSB7XG4gICAgY29uc3QgbSA9IHNlZ21lbnQubWF0Y2goTlVNRVJJQ19TVUJTVElUVVRJT04pO1xuICAgIGlmIChtID09PSBudWxsKSB7XG4gICAgICBhbGxOdW1lcmljID0gZmFsc2U7XG4gICAgICBpZiAoIVVOUkVTVFJJQ1RFRF9TVUJTVElUVVRJT04udGVzdChzZWdtZW50KSkgYWxsU3Vic3RpdHV0aW9uID0gZmFsc2U7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgcyA9IE51bWJlci5wYXJzZUludChtWzFdLCAxMCk7XG4gICAgY29uc3QgZSA9IG1bMl0gPT09IHVuZGVmaW5lZCA/IHMgOiBOdW1iZXIucGFyc2VJbnQobVsyXSwgMTApO1xuICAgIG1pblN0YXJ0ID0gTWF0aC5taW4obWluU3RhcnQsIHMpO1xuICAgIG1heEVuZCA9IE1hdGgubWF4KG1heEVuZCwgZSk7XG4gIH1cblxuICBmb3IgKGNvbnN0IGYgb2YgZmlsZXMpIHtcbiAgICBpZiAobG9va3NVbnJlc29sdmFibGUoZikpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdzZWQtaW5wbGFjZScsIGYsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVQYXRoKGRpciwgZik7XG4gICAgaWYgKGFsbE51bWVyaWMgfHwgYWxsU3Vic3RpdHV0aW9uKSB7XG4gICAgICBjb25zdCB0b3RhbCA9IGNvdW50RmlsZUxpbmVzKGFic29sdXRlUGF0aCk7XG4gICAgICBpZiAodG90YWwgPT09IG51bGwpIHtcbiAgICAgICAgcHVzaFVucmVzb2x2ZWQoXG4gICAgICAgICAgcmVzdWx0cyxcbiAgICAgICAgICAnc2VkLWlucGxhY2UnLFxuICAgICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgICAnY291bGQgbm90IGRldGVybWluZSBlbmQtb2YtZmlsZSBsaW5lIGNvdW50IChmaWxlIHVucmVhZGFibGUsIGVtcHR5LCBvciBtaXNzaW5nKSdcbiAgICAgICAgKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBzdGFydCA9IGFsbE51bWVyaWMgPyBtaW5TdGFydCA6IDE7XG4gICAgICBjb25zdCBlbmQgPSBhbGxOdW1lcmljID8gTWF0aC5taW4obWF4RW5kLCB0b3RhbCkgOiB0b3RhbDtcbiAgICAgIGlmIChzdGFydCA+IGVuZCkgY29udGludWU7IC8vIHRoZSBhZGRyZXNzZWQgcmFuZ2UgbGllcyBiZXlvbmQgRU9GIFx1MjAxNCBub3RoaW5nIGlzIG1vZGlmaWVkXG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiAnc2VkLWlucGxhY2UnLFxuICAgICAgICBzcGFuOiB7IG9wZXJhdGlvbjogJ21vZGlmeScsIGxpbmVTdGFydDogc3RhcnQsIGxpbmVFbmQ6IGVuZCwgYWJzb2x1dGVQYXRoLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgaWRpb206ICdzZWQtaW5wbGFjZScsXG4gICAgICAgIHNwYW46IHsgb3BlcmF0aW9uOiAnbW9kaWZ5JywgYWJzb2x1dGVQYXRoLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4gfVxuICAgICAgfSk7XG4gICAgfVxuICAgIGlmIChzdWZmaXggIT09IG51bGwgJiYgc3VmZml4ICE9PSAnJykge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogJ3NlZC1pbnBsYWNlJyxcbiAgICAgICAgc3BhbjogeyBvcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJywgYWJzb2x1dGVQYXRoOiBgJHthYnNvbHV0ZVBhdGh9JHtzdWZmaXh9YCwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRoZSBwYXRjaCAvIGdpdCBhcHBseSBncmFtbWFyIChwbGFuIFx1MDBBNzUuNykuIFBhdGNoIHRleHQgc291cmNlcywgaW4gb3JkZXIgb2Zcbi8vIHJlY29nbml0aW9uOiBhIGxpdGVyYWwgcGF0Y2gtZmlsZSBvcGVyYW5kIChgZ2l0IGFwcGx5IDxmaWxlPmAgXHUyMDE0IGEgYHBhdGNoYFxuLy8gb3BlcmFuZCBpcyBhIHRhcmdldCBmaWxlLCBub3QgYSBzb3VyY2UsIGFuZCBpcyBpZ25vcmVkKSwgdGhlIHN0ZGluIGA8YFxuLy8gc291cmNlIChgcGF0Y2ggLXBOIDwgZmlsZWAsIGBnaXQgYXBwbHkgLSA8IGZpbGVgKSwgb3IgYSBoZXJlZG9jIGJvZHlcbi8vIChjbGFzc2lmeVBhdGNoSGVyZWRvYywgXHUwMEE3NS4yKS4gUmVhZC1vbmx5IG1vZGVzIChgLS1jaGVja2AvYC0tc3RhdGAvXG4vLyBgLS1udW1zdGF0YC9gLS1zdW1tYXJ5YCwgYHBhdGNoIC0tZHJ5LXJ1bmApIGFuZCBpbmRleC1vbmx5IGAtLWNhY2hlZGAgdG91Y2hcbi8vIG5vdGhpbmc7IGAtLWRpcmVjdG9yeWAgZmFpbHMgY2xvc2VkIChpdCByZXdyaXRlcyBwYXRjaCBwYXRocykuIEEgY29tbWFuZFxuLy8gd2l0aCBubyBzdGF0aWNhbGx5IGtub3duIHNvdXJjZSAocGlwZWQgb3IgdGVybWluYWwgc3RkaW4sIGEgdmFyaWFibGUgcGF0Y2hcbi8vIHBhdGgpIGlzIHVucmVzb2x2ZWQuIFRhcmdldHMgYW5kIHJhbmdlcyBjb21lIGZyb20gdGhlIG5ld1xuLy8gcmFuZ2UtcHJlc2VydmluZyB1bmlmaWVkLWRpZmYgcGFyc2VyICh1bmlmaWVkLWRpZmYudHMpLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBUaGUgc2hhcmVkIGBwYXRjaGAvYGdpdCBhcHBseWAgb3B0aW9uIHN1cmZhY2UgKHBsYW4gXHUwMEE3NS43KTogc3RyaXAgbGV2ZWwsIHJlYWQtb25seSBhbmQgaW5kZXgtb25seSBtb2RlcywgYC0tZGlyZWN0b3J5YCwgYW5kIG9wZXJhbmRzLiAqL1xuaW50ZXJmYWNlIFBhdGNoQXBwbHlQYXJ0cyB7XG4gIHN0cmlwOiBQYXRoU3RyaXA7XG4gIHJlYWRPbmx5OiBib29sZWFuO1xuICBjYWNoZWRPbmx5OiBib29sZWFuO1xuICBkaXJlY3Rvcnk6IGJvb2xlYW47XG4gIG9wZXJhbmRzOiBzdHJpbmdbXTtcbn1cblxuZnVuY3Rpb24gcGF0Y2hBcHBseVBhcnRzKGFyZ3M6IHN0cmluZ1tdLCBpc0dpdEFwcGx5OiBib29sZWFuKTogUGF0Y2hBcHBseVBhcnRzIHtcbiAgbGV0IHN0cmlwOiBQYXRoU3RyaXAgPSBpc0dpdEFwcGx5ID8gMSA6ICdhdXRvJztcbiAgbGV0IHJlYWRPbmx5ID0gZmFsc2U7XG4gIGxldCBjYWNoZWRPbmx5ID0gZmFsc2U7XG4gIGxldCBkaXJlY3RvcnkgPSBmYWxzZTtcbiAgY29uc3Qgb3BlcmFuZHM6IHN0cmluZ1tdID0gW107XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYXJncy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmdzW2ldO1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaXNHaXRBcHBseSkge1xuICAgICAgaWYgKGEgPT09ICctLWNoZWNrJyB8fCBhID09PSAnLS1zdGF0JyB8fCBhID09PSAnLS1udW1zdGF0JyB8fCBhID09PSAnLS1zdW1tYXJ5Jykge1xuICAgICAgICByZWFkT25seSA9IHRydWU7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGEgPT09ICctLWNhY2hlZCcpIHtcbiAgICAgICAgY2FjaGVkT25seSA9IHRydWU7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGEgPT09ICctLWluZGV4JyB8fCBhID09PSAnLVInIHx8IGEgPT09ICctLXJldmVyc2UnIHx8IGEgPT09ICctLXVuc2FmZS1wYXRocycgfHwgYSA9PT0gJy0tcmVqZWN0JykgY29udGludWU7XG4gICAgICBpZiAoYSA9PT0gJy0tZGlyZWN0b3J5Jykge1xuICAgICAgICBkaXJlY3RvcnkgPSB0cnVlO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0tZGlyZWN0b3J5PScpKSB7XG4gICAgICAgIGRpcmVjdG9yeSA9IHRydWU7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGEgPT09ICctcCcpIHtcbiAgICAgICAgY29uc3QgdiA9IGFyZ3NbaSArIDFdO1xuICAgICAgICBpZiAodiAhPT0gdW5kZWZpbmVkICYmIC9eXFxkKyQvLnRlc3QodikpIHtcbiAgICAgICAgICBzdHJpcCA9IE51bWJlci5wYXJzZUludCh2LCAxMCk7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICB9XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKC9eLXBcXGQrJC8udGVzdChhKSkge1xuICAgICAgICBzdHJpcCA9IE51bWJlci5wYXJzZUludChhLnNsaWNlKDIpLCAxMCk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTtcbiAgICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gcGF0Y2hcbiAgICBpZiAoYSA9PT0gJy0tZHJ5LXJ1bicpIHtcbiAgICAgIHJlYWRPbmx5ID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1OJyB8fCBhID09PSAnLS1mb3J3YXJkJykgY29udGludWU7XG4gICAgaWYgKGEgPT09ICctcCcpIHtcbiAgICAgIGNvbnN0IHYgPSBhcmdzW2kgKyAxXTtcbiAgICAgIGlmICh2ICE9PSB1bmRlZmluZWQgJiYgL15cXGQrJC8udGVzdCh2KSkge1xuICAgICAgICBzdHJpcCA9IE51bWJlci5wYXJzZUludCh2LCAxMCk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoL14tcFxcZCskLy50ZXN0KGEpKSB7XG4gICAgICBzdHJpcCA9IE51bWJlci5wYXJzZUludChhLnNsaWNlKDIpLCAxMCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTtcbiAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICB9XG4gIHJldHVybiB7IHN0cmlwLCByZWFkT25seSwgY2FjaGVkT25seSwgZGlyZWN0b3J5LCBvcGVyYW5kcyB9O1xufVxuXG4vKiogVGhlIHBhdGNoIHRleHQgYXQgYGFic29sdXRlUGF0aGAsIG9yIG51bGwgd2hlbiBpdCBjYW4ndCBiZSByZWFkLiAqL1xuZnVuY3Rpb24gcmVhZFBhdGNoRmlsZShhYnNvbHV0ZVBhdGg6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICB0cnkge1xuICAgIHJldHVybiByZWFkRmlsZVN5bmMoYWJzb2x1dGVQYXRoLCAndXRmOCcpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKipcbiAqIEVtaXQgdGhlIHdyaXRlIHRvdWNoZXMgZm9yIGEgYHBhdGNoYC9gZ2l0IGFwcGx5YCBjb21tYW5kIHdpdGggYSBzdGF0aWNhbGx5XG4gKiBrbm93biBwYXRjaC10ZXh0IHNvdXJjZS4gYHRhcmdldERpcmAgaXMgd2hlcmUgdGhlIHBhdGNoJ3MgdGFyZ2V0IHBhdGhzXG4gKiByZXNvbHZlICh0aGUgZ2l0IGAtQ2AgZGlyZWN0b3J5IGZvciBgZ2l0IGFwcGx5YCwgdGhlIGN1cnJlbnQgZGlyZWN0b3J5XG4gKiBvdGhlcndpc2UpOyBgc2hlbGxEaXJgIGlzIHdoZXJlIHRoZSBzaGVsbCdzIHN0ZGluIGA8YCByZWRpcmVjdCB0YXJnZXRcbiAqIHJlc29sdmVzIFx1MjAxNCBhIHJlZGlyZWN0IGlzIHNoZWxsLXNpZGUsIHNvIGBnaXQgLUNgIG5ldmVyIGFmZmVjdHMgaXQuXG4gKi9cbmZ1bmN0aW9uIGVtaXRQYXRjaFRhcmdldHMoXG4gIGFyZ3M6IHN0cmluZ1tdLFxuICBpc0dpdEFwcGx5OiBib29sZWFuLFxuICBob3N0OiBzdHJpbmcsXG4gIHRhcmdldERpcjogc3RyaW5nLFxuICBzaGVsbERpcjogc3RyaW5nLFxuICByZWRpcmVjdHM6IFJlZGlyZWN0SW5mb1tdLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcGFydHMgPSBwYXRjaEFwcGx5UGFydHMoYXJncywgaXNHaXRBcHBseSk7XG4gIGlmIChwYXJ0cy5yZWFkT25seSB8fCBwYXJ0cy5jYWNoZWRPbmx5KSByZXR1cm47IC8vIHJlYWQtb25seSAvIGluZGV4LW9ubHkgXHUyMDE0IG5vIHRvdWNoZXNcbiAgaWYgKHBhcnRzLmRpcmVjdG9yeSkge1xuICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsICctLWRpcmVjdG9yeScsICctLWRpcmVjdG9yeSByZXdyaXRlcyBwYXRjaCBwYXRocycpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGxldCBwYXRjaFRleHQ6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBsZXQgc291cmNlOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgLy8gMS4gQSBsaXRlcmFsIHBhdGNoLWZpbGUgb3BlcmFuZCAoZ2l0IGFwcGx5IG9ubHk7IGEgcGF0Y2ggb3BlcmFuZCBpcyBhXG4gIC8vICAgIHRhcmdldCBmaWxlLCBub3QgYSBzb3VyY2UgXHUyMDE0IGlnbm9yZWQpLlxuICBpZiAoaXNHaXRBcHBseSkge1xuICAgIGNvbnN0IG9wZXJhbmQgPSBwYXJ0cy5vcGVyYW5kcy5maW5kKChvKSA9PiBvICE9PSAnLScpO1xuICAgIGlmIChvcGVyYW5kICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShvcGVyYW5kKSkge1xuICAgICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCBvcGVyYW5kLCAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgc291cmNlID0gcmVzb2x2ZVBhdGgodGFyZ2V0RGlyLCBvcGVyYW5kKTtcbiAgICAgIHBhdGNoVGV4dCA9IHJlYWRQYXRjaEZpbGUoc291cmNlKTtcbiAgICAgIGlmIChwYXRjaFRleHQgPT09IG51bGwpIHtcbiAgICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgc291cmNlLCAncGF0Y2ggZmlsZSB1bnJlYWRhYmxlIG9yIG1pc3NpbmcnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICAvLyAyLiBUaGUgc3RkaW4gYDxgIHNvdXJjZSAocGF0Y2ggYW5kIGdpdCBhcHBseSkuXG4gIGlmIChwYXRjaFRleHQgPT09IG51bGwpIHtcbiAgICBjb25zdCBzdGRpbiA9IHJlZGlyZWN0cy5maW5kKChyKSA9PiByLm9wID09PSAnPCcpO1xuICAgIGlmIChzdGRpbiAhPT0gdW5kZWZpbmVkICYmIHN0ZGluLnRhcmdldCAhPT0gbnVsbCkge1xuICAgICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKHN0ZGluLnRhcmdldCkpIHtcbiAgICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgc3RkaW4udGFyZ2V0LCAncGF0aCBjb250YWlucyBhbiB1bmV4cGFuZGVkIHNoZWxsIHZhcmlhYmxlIG9yIGdsb2InKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgc291cmNlID0gcmVzb2x2ZVBhdGgoc2hlbGxEaXIsIHN0ZGluLnRhcmdldCk7XG4gICAgICBwYXRjaFRleHQgPSByZWFkUGF0Y2hGaWxlKHNvdXJjZSk7XG4gICAgICBpZiAocGF0Y2hUZXh0ID09PSBudWxsKSB7XG4gICAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsIHNvdXJjZSwgJ3BhdGNoIHRleHQgdW5yZWFkYWJsZSBvciBtaXNzaW5nJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgLy8gMy4gTm8gc3RhdGljYWxseSBrbm93biBzb3VyY2U6IHN0ZGluIGlzIGR5bmFtaWMgKHRlcm1pbmFsLCBwaXBlLCB2YXJpYWJsZSkuXG4gIGlmIChwYXRjaFRleHQgPT09IG51bGwpIHtcbiAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCBob3N0LCAnbm8gc3RhdGljYWxseSBrbm93biBwYXRjaCB0ZXh0IHNvdXJjZSAoc3RkaW4gaXMgZHluYW1pYyknKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCB0YXJnZXRzID0gcGFyc2VVbmlmaWVkRGlmZlJhbmdlKHBhdGNoVGV4dCwgcGFydHMuc3RyaXApO1xuICBpZiAodGFyZ2V0cyA9PT0gbnVsbCkge1xuICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsIHNvdXJjZSA/PyBob3N0LCAnbWFsZm9ybWVkIG9yIGVtcHR5IHBhdGNoIHRleHQnKTtcbiAgICByZXR1cm47XG4gIH1cbiAgZm9yIChjb25zdCB0IG9mIHRhcmdldHMpIHtcbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlVGFyZ2V0KHJlc3VsdHMsICdwYXRjaC13cml0ZScsIHQucGF0aCwgdGFyZ2V0RGlyKTtcbiAgICBpZiAoYWJzb2x1dGVQYXRoID09PSBudWxsKSBjb250aW51ZTtcbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206ICdwYXRjaC13cml0ZScsXG4gICAgICBzcGFuOiB7XG4gICAgICAgIG9wZXJhdGlvbjogdC5vcGVyYXRpb24sXG4gICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICBqb2luLFxuICAgICAgICAuLi4odC5saW5lU3RhcnQgIT09IHVuZGVmaW5lZCA/IHsgbGluZVN0YXJ0OiB0LmxpbmVTdGFydCwgbGluZUVuZDogdC5saW5lRW5kIH0gOiB7fSlcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBwYXRjaC9naXQgYXBwbHkgZ3JhbW1hciBpbiB0aGUgbWFpbiB3YWxrOiBgcGF0Y2hgIHJlYWRzIHBhdGNoIHRleHQgZnJvbVxuICogc3RkaW4gb3IgYSBgPGAgcmVkaXJlY3Q7IGBnaXQgYXBwbHlgIGFkZGl0aW9uYWxseSBhY2NlcHRzIGEgcGF0Y2gtZmlsZVxuICogb3BlcmFuZCBhbmQgcmVzb2x2ZXMgdGFyZ2V0cyBhZ2FpbnN0IGl0cyBgLUNgIGRpcmVjdG9yeS4gQSB3cmFwcGVkXG4gKiBgcGF0Y2hgL2BhcHBseWAgaXMgdW5yZXNvbHZlZCBcdTIwMTQgdGhlIHdyYXBwZXIgb2JzY3VyZXMgdGhlIGFyZ3YuXG4gKi9cbmZ1bmN0aW9uIG1hdGNoUGF0Y2hBcHBseShcbiAgYXJndjogc3RyaW5nW10sXG4gIHJlZGlyZWN0czogUmVkaXJlY3RJbmZvW10sXG4gIGRpckZvclJlc29sdXRpb246IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHJlc3QgPSBzdHJpcFRyYW5zcGFyZW50V3JhcHBlcihhcmd2KTtcbiAgaWYgKHJlc3QubGVuZ3RoID09PSAwKSByZXR1cm47XG4gIGNvbnN0IGNvbW1hbmQgPSByZXN0WzBdO1xuICBpZiAoY29tbWFuZCA9PT0gJ3BhdGNoJykge1xuICAgIGVtaXRQYXRjaFRhcmdldHMoXG4gICAgICByZXN0LnNsaWNlKDEpLFxuICAgICAgZmFsc2UsXG4gICAgICAncGF0Y2gnLFxuICAgICAgZGlyRm9yUmVzb2x1dGlvbixcbiAgICAgIGRpckZvclJlc29sdXRpb24sXG4gICAgICByZWRpcmVjdHMsXG4gICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICBqb2luLFxuICAgICAgcmVzdWx0c1xuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChjb21tYW5kID09PSAnZ2l0Jykge1xuICAgIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKHJlc3Quc2xpY2UoMSkpO1xuICAgIGlmIChzdWIgPT09IG51bGwgfHwgc3ViLnN1YmNvbW1hbmQgIT09ICdhcHBseScpIHJldHVybjtcbiAgICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsICdhcHBseScsICdnaXQgLUMgdGFyZ2V0IGNvbnRhaW5zIGFuIHVucmVzb2x2ZWQgc2hlbGwgdmFyaWFibGUnKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZW1pdFBhdGNoVGFyZ2V0cyhcbiAgICAgIHJlc3Quc2xpY2UoMSkuc2xpY2Uoc3ViLnN1YklkeCArIDEpLFxuICAgICAgdHJ1ZSxcbiAgICAgICdhcHBseScsXG4gICAgICBzdWIuY0RpciA/PyBkaXJGb3JSZXNvbHV0aW9uLFxuICAgICAgZGlyRm9yUmVzb2x1dGlvbixcbiAgICAgIHJlZGlyZWN0cyxcbiAgICAgIHNpbXBsZUNvbW1hbmRJbmRleCxcbiAgICAgIGpvaW4sXG4gICAgICByZXN1bHRzXG4gICAgKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKEZPUkVJR05fV1JBUFBFUlMuaGFzKGNvbW1hbmQpKSB7XG4gICAgY29uc3Qgd3JhcHBlZCA9IHJlc3RbMV07XG4gICAgaWYgKHdyYXBwZWQgPT09ICdwYXRjaCcgfHwgd3JhcHBlZCA9PT0gJ2FwcGx5Jykge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgd3JhcHBlZCwgYHRoZSAke2NvbW1hbmR9IHdyYXBwZXIgb2JzY3VyZXMgdGhlICR7d3JhcHBlZH0gYXJndmApO1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFRoZSBoZXJlZG9jIHBhdGNoLXRleHQgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjcpOiBhIGBwYXRjaGAvYGdpdCBhcHBseWAgaGVyZWRvY1xuICogYm9keSBpcyBwYXRjaCB0ZXh0LiBUaGUgb3BlbmVyJ3Mgb3duIG9wdGlvbnMgc3RpbGwgYXBwbHkgXHUyMDE0IGAtLWRyeS1ydW5gL1xuICogYC0tY2hlY2tgL2AtLXN0YXRgL2AtLW51bXN0YXRgL2AtLXN1bW1hcnlgL2AtLWNhY2hlZGAgbWFrZSB0aGUgYm9keVxuICogcmVhZC1vbmx5IChubyB0b3VjaGVzKSwgYC0tZGlyZWN0b3J5YCBmYWlscyBjbG9zZWQsIGFuZCBgLXBOYCBzZXRzIHRoZVxuICogaGVhZGVyIHN0cmlwIGxldmVsLlxuICovXG5mdW5jdGlvbiBjbGFzc2lmeVBhdGNoSGVyZWRvYyhcbiAgYXJndjogc3RyaW5nW10sXG4gIGJvZHk6IHN0cmluZyxcbiAgY3VycmVudERpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgY29uc3QgcmVzdCA9IHN0cmlwVHJhbnNwYXJlbnRXcmFwcGVyKGFyZ3YpO1xuICBpZiAocmVzdC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgY29uc3QgY29tbWFuZCA9IHJlc3RbMF07XG4gIGxldCBpc0dpdEFwcGx5ID0gZmFsc2U7XG4gIGxldCBhcmdzOiBzdHJpbmdbXTtcbiAgbGV0IGRpciA9IGN1cnJlbnREaXI7XG4gIGlmIChjb21tYW5kID09PSAncGF0Y2gnKSB7XG4gICAgYXJncyA9IHJlc3Quc2xpY2UoMSk7XG4gIH0gZWxzZSBpZiAoY29tbWFuZCA9PT0gJ2dpdCcpIHtcbiAgICBjb25zdCBzdWIgPSBmaW5kR2l0U3ViY29tbWFuZChyZXN0LnNsaWNlKDEpKTtcbiAgICBpZiAoc3ViID09PSBudWxsIHx8IHN1Yi5zdWJjb21tYW5kICE9PSAnYXBwbHknKSByZXR1cm47XG4gICAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCAnYXBwbHknLCAnZ2l0IC1DIHRhcmdldCBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlzR2l0QXBwbHkgPSB0cnVlO1xuICAgIGFyZ3MgPSByZXN0LnNsaWNlKDEpLnNsaWNlKHN1Yi5zdWJJZHggKyAxKTtcbiAgICBkaXIgPSBzdWIuY0RpciA/PyBjdXJyZW50RGlyO1xuICB9IGVsc2Uge1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBwYXJ0cyA9IHBhdGNoQXBwbHlQYXJ0cyhhcmdzLCBpc0dpdEFwcGx5KTtcbiAgaWYgKHBhcnRzLnJlYWRPbmx5IHx8IHBhcnRzLmNhY2hlZE9ubHkpIHJldHVybjtcbiAgaWYgKHBhcnRzLmRpcmVjdG9yeSkge1xuICAgIHB1c2hVbnJlc29sdmVkKHJlc3VsdHMsICdwYXRjaC13cml0ZScsICctLWRpcmVjdG9yeScsICctLWRpcmVjdG9yeSByZXdyaXRlcyBwYXRjaCBwYXRocycpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB0YXJnZXRzID0gcGFyc2VVbmlmaWVkRGlmZlJhbmdlKGJvZHksIHBhcnRzLnN0cmlwKTtcbiAgaWYgKHRhcmdldHMgPT09IG51bGwpIHtcbiAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAncGF0Y2gtd3JpdGUnLCAnaGVyZWRvYycsICdtYWxmb3JtZWQgb3IgZW1wdHkgcGF0Y2ggdGV4dCcpO1xuICAgIHJldHVybjtcbiAgfVxuICBmb3IgKGNvbnN0IHQgb2YgdGFyZ2V0cykge1xuICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVUYXJnZXQocmVzdWx0cywgJ3BhdGNoLXdyaXRlJywgdC5wYXRoLCBkaXIpO1xuICAgIGlmIChhYnNvbHV0ZVBhdGggPT09IG51bGwpIGNvbnRpbnVlO1xuICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICBzdGF0dXM6ICdyZXNvbHZlZCcsXG4gICAgICBpZGlvbTogJ3BhdGNoLXdyaXRlJyxcbiAgICAgIHNwYW46IHtcbiAgICAgICAgb3BlcmF0aW9uOiB0Lm9wZXJhdGlvbixcbiAgICAgICAgYWJzb2x1dGVQYXRoLFxuICAgICAgICBzaW1wbGVDb21tYW5kSW5kZXgsXG4gICAgICAgIGpvaW4sXG4gICAgICAgIC4uLih0LmxpbmVTdGFydCAhPT0gdW5kZWZpbmVkID8geyBsaW5lU3RhcnQ6IHQubGluZVN0YXJ0LCBsaW5lRW5kOiB0LmxpbmVFbmQgfSA6IHt9KVxuICAgICAgfVxuICAgIH0pO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVGhlIGZvcm1hdHRlciAvIGZpeGVyIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS44KTogYSB0YWJsZS1kcml2ZW4gZmFtaWx5IG92ZXIgdGhlXG4vLyBjb3JwdXMtZGVyaXZlZCAxNi10b29sIHNldC4gRmxhZyBtYXRjaGluZyBpcyBleGFjdC10b2tlbiBvbiBmdWxsIGFyZ3Ygd29yZHMgXHUyMDE0XG4vLyBuZXZlciBwcmVmaXggb3Igc3Vic3RyaW5nIFx1MjAxNCBhbmQgdGhlIHJlYWQtb25seSBsaXN0IGlzIGNvbnN1bHRlZCBmaXJzdCwgc29cbi8vIGAtLWZpeC1kcnktcnVuYCBjYW4gbmV2ZXIgY29sbGlkZSB3aXRoIGAtLWZpeGAgYW5kIGBibGFjayAtLWNoZWNrYCBuZXZlclxuLy8gaGVhbHMuIFRvb2xzIHdob3NlIHdyaXRlIGZvcm0gaXMgYSBiYXJlIGludm9jYXRpb24gKGJsYWNrLCBpc29ydCwgcnVzdGZtdClcbi8vIGNhcnJ5IHRoZSBlbXB0eSBmb3JtIGFuZCBmaXJlIG9uIHRoZSB3cml0ZSBmb3JtIGl0c2VsZi4gTGVhZGluZyB0cmFuc3BhcmVudFxuLy8gcGFja2FnZS1ydW5uZXIgd3JhcHBlcnMgKG5weCwgeWFybiwgcG5wbSBleGVjL2RseCwgYnVueCwgbnBtIGV4ZWMpIHN0cmlwXG4vLyB1bmRlciBhIHBpbm5lZCBvcHRpb24gZ3JhbW1hcjsgYSB3cmFwcGVyIHRoYXQgY291bGQgcmV3cml0ZSBhcmd2IGZhaWxzXG4vLyBjbG9zZWQgYXMgdW5yZXNvbHZlZC5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogT25lIFx1MDBBNzUuOCB0YWJsZSByb3c6IHRoZSB0b29sIGNvbW1hbmQgYW5kIGl0cyB3cml0ZS9yZWFkLW9ubHkgdG9rZW4gZm9ybXMuICovXG5leHBvcnQgaW50ZXJmYWNlIEZvcm1hdHRlclRvb2xSb3cge1xuICBjb21tYW5kOiBzdHJpbmc7XG4gIC8qKiBUb2tlbiBzZXF1ZW5jZXMgd2hvc2UgZXhhY3QtdG9rZW4gcHJlc2VuY2UgbWFya3MgdGhlIGludm9jYXRpb24gYSB3cml0ZS4gKi9cbiAgd3JpdGVGb3Jtczogc3RyaW5nW11bXTtcbiAgLyoqIFRva2VuIHNlcXVlbmNlcyBjb25zdWx0ZWQgZmlyc3QgXHUyMDE0IHByZXNlbmNlIHN1cHByZXNzZXMgdGhlIHdyaXRlICh0aGUgcmVhZC1vbmx5IG1vZGUgd2lucykuICovXG4gIHJlYWRPbmx5Rm9ybXM6IHN0cmluZ1tdW107XG59XG5cbi8qKlxuICogVGhlIFx1MDBBNzUuOCB0YWJsZSwgZXhwb3J0ZWQgc28gdGhlIGNvcnB1cy1jb3ZlcmFnZSBmaXh0dXJlIGNhbiBhc3NlcnQgdHdvLXNpZGVkXG4gKiB0b29sLXNldCBlcXVhbGl0eSBhbmQgcGVyLXRvb2wgcmVhZC1vbmx5IHN1cHByZXNzaW9uIChwbGFuIFx1MDBBNzUuOCwgUGhhc2UgM1xuICogc3RlcCA4KS5cbiAqL1xuZXhwb3J0IGNvbnN0IEZPUk1BVFRFUl9UQUJMRTogcmVhZG9ubHkgRm9ybWF0dGVyVG9vbFJvd1tdID0gW1xuICB7XG4gICAgY29tbWFuZDogJ3ByZXR0aWVyJyxcbiAgICB3cml0ZUZvcm1zOiBbWyctLXdyaXRlJ10sIFsnLXcnXV0sXG4gICAgcmVhZE9ubHlGb3JtczogW1snLS1jaGVjayddLCBbJy0tbGlzdC1kaWZmZXJlbnQnXSwgWyctLWRlYnVnLWNoZWNrJ11dXG4gIH0sXG4gIHsgY29tbWFuZDogJ2VzbGludCcsIHdyaXRlRm9ybXM6IFtbJy0tZml4J11dLCByZWFkT25seUZvcm1zOiBbWyctLWZpeC1kcnktcnVuJ11dIH0sXG4gIHtcbiAgICBjb21tYW5kOiAnYmlvbWUnLFxuICAgIHdyaXRlRm9ybXM6IFtcbiAgICAgIFsnY2hlY2snLCAnLS13cml0ZSddLFxuICAgICAgWydjaGVjaycsICctLWZpeCddLFxuICAgICAgWydmb3JtYXQnLCAnLS13cml0ZSddXG4gICAgXSxcbiAgICByZWFkT25seUZvcm1zOiBbXVxuICB9LFxuICB7IGNvbW1hbmQ6ICdnb2ZtdCcsIHdyaXRlRm9ybXM6IFtbJy13J11dLCByZWFkT25seUZvcm1zOiBbWyctbCddXSB9LFxuICB7IGNvbW1hbmQ6ICdnb2ltcG9ydHMnLCB3cml0ZUZvcm1zOiBbWyctdyddXSwgcmVhZE9ubHlGb3JtczogW10gfSxcbiAgeyBjb21tYW5kOiAnY2xhbmctZm9ybWF0Jywgd3JpdGVGb3JtczogW1snLWknXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy0tZHJ5LXJ1biddXSB9LFxuICB7IGNvbW1hbmQ6ICdzaGZtdCcsIHdyaXRlRm9ybXM6IFtbJy13J11dLCByZWFkT25seUZvcm1zOiBbWyctZCddXSB9LFxuICB7IGNvbW1hbmQ6ICd5YXBmJywgd3JpdGVGb3JtczogW1snLWknXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy0tZGlmZiddXSB9LFxuICB7IGNvbW1hbmQ6ICdhdXRvcGVwOCcsIHdyaXRlRm9ybXM6IFtbJy1pJ11dLCByZWFkT25seUZvcm1zOiBbWyctZCddLCBbJy0tZGlmZiddXSB9LFxuICB7IGNvbW1hbmQ6ICdibGFjaycsIHdyaXRlRm9ybXM6IFtbXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy0tY2hlY2snXSwgWyctLWRpZmYnXV0gfSxcbiAgeyBjb21tYW5kOiAnaXNvcnQnLCB3cml0ZUZvcm1zOiBbW11dLCByZWFkT25seUZvcm1zOiBbWyctLWNoZWNrLW9ubHknXSwgWyctLWRpZmYnXV0gfSxcbiAge1xuICAgIGNvbW1hbmQ6ICdydWZmJyxcbiAgICB3cml0ZUZvcm1zOiBbWydmb3JtYXQnXSwgWydjaGVjaycsICctLWZpeCddXSxcbiAgICByZWFkT25seUZvcm1zOiBbXG4gICAgICBbJ2NoZWNrJywgJy0tbm8tZml4J10sXG4gICAgICBbJ2Zvcm1hdCcsICctLWNoZWNrJ11cbiAgICBdXG4gIH0sXG4gIHsgY29tbWFuZDogJ2Rlbm8nLCB3cml0ZUZvcm1zOiBbWydmbXQnXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJ2ZtdCcsICctLWNoZWNrJ11dIH0sXG4gIHsgY29tbWFuZDogJ2RwcmludCcsIHdyaXRlRm9ybXM6IFtbJ2ZtdCddXSwgcmVhZE9ubHlGb3JtczogW1snY2hlY2snXV0gfSxcbiAgeyBjb21tYW5kOiAncnVzdGZtdCcsIHdyaXRlRm9ybXM6IFtbXV0sIHJlYWRPbmx5Rm9ybXM6IFtbJy0tY2hlY2snXSwgWyctLWVtaXQnLCAnc3Rkb3V0J11dIH0sXG4gIHtcbiAgICBjb21tYW5kOiAndGVycmFmb3JtJyxcbiAgICB3cml0ZUZvcm1zOiBbWydmbXQnXV0sXG4gICAgcmVhZE9ubHlGb3JtczogW1xuICAgICAgWydmbXQnLCAnLWNoZWNrJ10sXG4gICAgICBbJ2ZtdCcsICctZGlmZiddXG4gICAgXVxuICB9XG5dO1xuXG4vKiogVGhlIHBpbm5lZCBwYWNrYWdlLXJ1bm5lciBuby1hcmcgZmxhZ3MgKHBsYW4gXHUwMEE3NS44KTogZmxhZ3MgdGhhdCBjYW5ub3QgbW92ZSBvciByZXdyaXRlIGFyZ3YuICovXG5jb25zdCBSVU5ORVJfTk9fQVJHX0ZMQUdTID0gbmV3IFNldChbJy15JywgJy0teWVzJywgJy0tbm8taW5zdGFsbCddKTtcblxuLyoqIFRoZSBvdXRjb21lIG9mIHN0cmlwcGluZyBvbmUgbGVhZGluZyBwYWNrYWdlLXJ1bm5lciB3cmFwcGVyLiAqL1xudHlwZSBSdW5uZXJTdHJpcCA9IHsga2luZDogJ3N0cmlwcGVkJzsgc3RyaXBwZWQ6IHN0cmluZ1tdIH0gfCB7IGtpbmQ6ICdvYnNjdXJlZCcgfTtcblxuLyoqXG4gKiBTdHJpcCBvbmUgbGVhZGluZyB0cmFuc3BhcmVudCBwYWNrYWdlLXJ1bm5lciB3cmFwcGVyIChwbGFuIFx1MDBBNzUuOCk6IGBucHhgLFxuICogYHlhcm5gLCBgcG5wbSBleGVjYC9gcG5wbSBkbHhgLCBgYnVueGAsIGFuZCBgbnBtIGV4ZWNgIGZvbGxvd2VkIGRpcmVjdGx5IGJ5XG4gKiB0aGUgd3JhcHBlZCBjb21tYW5kIHdvcmQsIHdpdGggb25seSB0aGUgcGlubmVkIG5vLWFyZyBmbGFncyAoYC15YC9gLS15ZXNgLFxuICogYC0tbm8taW5zdGFsbGApIGFuZCBgbnBtIGV4ZWNgJ3MgYC0tYCB0ZXJtaW5hdG9yIGJldHdlZW4uIEEgc3RyaW5nLWZvcm1cbiAqIGFyZ3VtZW50IChgbnB4IFwicHJldHRpZXIgLS13cml0ZSBmXCJgKSwgYW4gYXJndi1hbHRlcmluZyBydW5uZXIgZmxhZ1xuICogKGAtLXBhY2thZ2U9WGAgb3IgYSBmbGFnIGNvbnN1bWluZyB0aGUgbmV4dCB3b3JkKSwgb3IgYSB3cmFwcGVyIHdvcmQgdGhhdCBpc1xuICogaXRzZWxmIGEgc2NyaXB0IChgLmAtcHJlZml4ZWQpIG9ic2N1cmVzIHRoZSB3cmFwcGVkIGFyZ3YgXHUyMDE0IHRoZSB3cmFwcGVyIGlzXG4gKiB0cmFuc3BhcmVudCBvbmx5IHdoZW4gdGhlIHBpbm5lZCBncmFtbWFyIHByb3ZlcyBpdCBzby4gUmV0dXJucyAnbm90LXJ1bm5lcidcbiAqIHdoZW4gdGhlIHdvcmQgaXMgbm90IGEgcnVubmVyIGF0IGFsbCAoYSBkaWZmZXJlbnQgbnBtL3BucG0gc3ViY29tbWFuZCwgb3IgYVxuICogYmFyZSBydW5uZXIgd2l0aCBubyBjb21tYW5kIHdvcmQpIFx1MjAxNCB0aGUgdGFibGUgbWF0Y2hlcyBpdCBkaXJlY3RseSwgd2hpY2hcbiAqIGZhaWxzIGNsb3NlZCBmb3Igbm9uLWZvcm1hdHRlciBydW5uZXJzLlxuICovXG5mdW5jdGlvbiBzdHJpcFBhY2thZ2VSdW5uZXIoYXJndjogc3RyaW5nW10pOiBSdW5uZXJTdHJpcCB8ICdub3QtcnVubmVyJyB7XG4gIGNvbnN0IHJ1bm5lciA9IGFyZ3ZbMF07XG4gIGxldCByZXN0ID0gYXJndi5zbGljZSgxKTtcbiAgaWYgKHJ1bm5lciA9PT0gJ25weCcgfHwgcnVubmVyID09PSAneWFybicgfHwgcnVubmVyID09PSAnYnVueCcpIHtcbiAgICAvLyBUaGVzZSBydW5uZXJzIHRha2UgdGhlIGNvbW1hbmQgd29yZCBkaXJlY3RseS5cbiAgfSBlbHNlIGlmIChydW5uZXIgPT09ICdwbnBtJykge1xuICAgIGlmIChyZXN0WzBdICE9PSAnZXhlYycgJiYgcmVzdFswXSAhPT0gJ2RseCcpIHJldHVybiAnbm90LXJ1bm5lcic7XG4gICAgcmVzdCA9IHJlc3Quc2xpY2UoMSk7XG4gIH0gZWxzZSBpZiAocnVubmVyID09PSAnbnBtJykge1xuICAgIGlmIChyZXN0WzBdICE9PSAnZXhlYycpIHJldHVybiAnbm90LXJ1bm5lcic7XG4gICAgcmVzdCA9IHJlc3Quc2xpY2UoMSk7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuICdub3QtcnVubmVyJztcbiAgfVxuICB3aGlsZSAoUlVOTkVSX05PX0FSR19GTEFHUy5oYXMocmVzdFswXSkpIHJlc3QgPSByZXN0LnNsaWNlKDEpO1xuICBpZiAocnVubmVyID09PSAnbnBtJyAmJiByZXN0WzBdID09PSAnLS0nKSByZXN0ID0gcmVzdC5zbGljZSgxKTtcbiAgaWYgKHJlc3QubGVuZ3RoID09PSAwKSByZXR1cm4gJ25vdC1ydW5uZXInOyAvLyBhIGJhcmUgcnVubmVyIGF0dHJpYnV0ZXMgbm90aGluZ1xuICBjb25zdCB3cmFwcGVkID0gcmVzdFswXTtcbiAgaWYgKHdyYXBwZWQuc3RhcnRzV2l0aCgnLScpIHx8IHdyYXBwZWQuc3RhcnRzV2l0aCgnLicpIHx8IC9cXHMvLnRlc3Qod3JhcHBlZCkpIHJldHVybiB7IGtpbmQ6ICdvYnNjdXJlZCcgfTtcbiAgcmV0dXJuIHsga2luZDogJ3N0cmlwcGVkJywgc3RyaXBwZWQ6IHJlc3QgfTtcbn1cblxuLyoqXG4gKiBUaGUgZm9ybWF0dGVyL2ZpeGVyIGZhbWlseSAocGxhbiBcdTAwQTc1LjgpLiBUaGUgcmVhZC1vbmx5IGZvcm1zIGFyZSBjb25zdWx0ZWRcbiAqIGZpcnN0IGFuZCB3aW4gb3ZlciBhbnkgd3JpdGUgZm9ybTsgYSB3cml0ZSBmb3JtIHdpdGggbm8gcmVhZC1vbmx5IGZvcm0gYW5kXG4gKiBldmVyeSBvcGVyYW5kIGFuIGV4cGxpY2l0IGZpbGUgZW1pdHMgYSB3aG9sZS1maWxlIGBtb2RpZnlgIHBlciBvcGVyYW5kO1xuICogZGlyZWN0b3J5L2dsb2Ivbm8tb3BlcmFuZCBpbnZvY2F0aW9ucyB0b3VjaCBub3RoaW5nOyB1bmtub3duIGV4ZWN1dGFibGVzXG4gKiBmYWlsIGNsb3NlZC4gQSBmb3JtJ3MgbGVhZGluZyBzdWJjb21tYW5kIHdvcmQgKGBjaGVja2AvYGZvcm1hdGAvYGZtdGApIGlzXG4gKiBwb3NpdGlvbmFsIFx1MjAxNCBpdCBtdXN0IGxlYWQgdGhlIHRvb2wncyBhcmdzLCBzbyBgZGVubyB0YXNrIGZtdGAgaXMgYSBzY3JpcHRcbiAqIHJ1bm5lciwgbm90IGEgZm9ybWF0dGVyLlxuICovXG5mdW5jdGlvbiBtYXRjaEZvcm1hdHRlcihcbiAgYXJndjogc3RyaW5nW10sXG4gIGRpckZvclJlc29sdXRpb246IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGNvbnN0IHJlc3QgPSBzdHJpcFRyYW5zcGFyZW50V3JhcHBlcihhcmd2KTtcbiAgaWYgKHJlc3QubGVuZ3RoID09PSAwKSByZXR1cm47XG4gIGxldCB3b3JkcyA9IHJlc3Q7XG4gIGNvbnN0IHN0cmlwID0gc3RyaXBQYWNrYWdlUnVubmVyKHJlc3QpO1xuICBpZiAoc3RyaXAgPT09ICdub3QtcnVubmVyJykge1xuICAgIC8vIHJlc3RbMF0gaXMgbm90IGEgcGFja2FnZSBydW5uZXIgXHUyMDE0IHRoZSB0YWJsZSBtYXRjaGVzIGl0IGRpcmVjdGx5LlxuICB9IGVsc2UgaWYgKHN0cmlwLmtpbmQgPT09ICdvYnNjdXJlZCcpIHtcbiAgICBwdXNoVW5yZXNvbHZlZChyZXN1bHRzLCAnZm9ybWF0dGVyLXdyaXRlJywgcmVzdFswXSwgYHRoZSAke3Jlc3RbMF19IHdyYXBwZXIgb2JzY3VyZXMgdGhlIHdyYXBwZWQgYXJndmApO1xuICAgIHJldHVybjtcbiAgfSBlbHNlIHtcbiAgICB3b3JkcyA9IHN0cmlwLnN0cmlwcGVkO1xuICB9XG4gIGlmIChGT1JFSUdOX1dSQVBQRVJTLmhhcyh3b3Jkc1swXSkpIHtcbiAgICBjb25zdCB3cmFwcGVkID0gd29yZHNbMV07XG4gICAgaWYgKHdyYXBwZWQgIT09IHVuZGVmaW5lZCAmJiBGT1JNQVRURVJfVEFCTEUuc29tZSgocikgPT4gci5jb21tYW5kID09PSB3cmFwcGVkKSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ2Zvcm1hdHRlci13cml0ZScsIHdyYXBwZWQsIGB0aGUgJHt3b3Jkc1swXX0gd3JhcHBlciBvYnNjdXJlcyB0aGUgJHt3cmFwcGVkfSBhcmd2YCk7XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCByb3cgPSBGT1JNQVRURVJfVEFCTEUuZmluZCgocikgPT4gci5jb21tYW5kID09PSB3b3Jkc1swXSk7XG4gIGlmIChyb3cgPT09IHVuZGVmaW5lZCkgcmV0dXJuOyAvLyB1bmtub3duIGV4ZWN1dGFibGUgXHUyMDE0IGZhaWwgY2xvc2VkLCBubyB0b3VjaFxuICBjb25zdCBhcmdzID0gd29yZHMuc2xpY2UoMSk7XG4gIGNvbnN0IGZvcm1QcmVzZW50ID0gKGZvcm06IHN0cmluZ1tdKTogYm9vbGVhbiA9PiB7XG4gICAgY29uc3QgZmlyc3QgPSBmb3JtWzBdO1xuICAgIGlmIChmaXJzdCAhPT0gdW5kZWZpbmVkICYmICFmaXJzdC5zdGFydHNXaXRoKCctJykgJiYgYXJnc1swXSAhPT0gZmlyc3QpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gZm9ybS5ldmVyeSgodG9rZW4pID0+IGFyZ3MuaW5jbHVkZXModG9rZW4pKTtcbiAgfTtcbiAgLy8gVGhlIHJlYWQtb25seSBsaXN0IGlzIGNvbnN1bHRlZCBmaXJzdCBhbmQgd2lucyBvdmVyIGFueSB3cml0ZSBmb3JtOlxuICAvLyBgZXNsaW50IC0tZml4IC0tZml4LWRyeS1ydW4gZmAgd3JpdGVzIG5vdGhpbmcsIGBibGFjayAtLWNoZWNrIGZgIG5ldmVyIGhlYWxzLlxuICBpZiAocm93LnJlYWRPbmx5Rm9ybXMuc29tZShmb3JtUHJlc2VudCkpIHJldHVybjtcbiAgaWYgKCFyb3cud3JpdGVGb3Jtcy5zb21lKGZvcm1QcmVzZW50KSkgcmV0dXJuOyAvLyBiYXJlIGludm9jYXRpb25zIG9mIGZsYWctcmVxdWlyZWQgdG9vbHMgYXJlIHJlYWQtb25seSAoc3Rkb3V0L2xpbnQpXG4gIC8vIENvbnN1bWUgdGhlIHRvb2wncyBzdWJjb21tYW5kIHdvcmQgYmVmb3JlIGNvbGxlY3Rpbmcgb3BlcmFuZHMuXG4gIGNvbnN0IHN1YmNvbW1hbmRXb3JkcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBmb3IgKGNvbnN0IGZvcm0gb2Ygcm93LndyaXRlRm9ybXMpIHtcbiAgICBmb3IgKGNvbnN0IHRva2VuIG9mIGZvcm0pIHtcbiAgICAgIGlmICghdG9rZW4uc3RhcnRzV2l0aCgnLScpKSBzdWJjb21tYW5kV29yZHMuYWRkKHRva2VuKTtcbiAgICB9XG4gIH1cbiAgY29uc3QgYWZ0ZXJTdWJjb21tYW5kID0gc3ViY29tbWFuZFdvcmRzLmhhcyhhcmdzWzBdKSA/IGFyZ3Muc2xpY2UoMSkgOiBhcmdzO1xuICBsZXQgYWZ0ZXJEYXNoRGFzaCA9IGZhbHNlO1xuICBjb25zdCBvcGVyYW5kczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBhIG9mIGFmdGVyU3ViY29tbWFuZCkge1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlOyAvLyB1bmtub3duIG9wdGlvbiBcdTIxOTIgdHJlYXRlZCBhcyBhbiBvcHRpb24gKHNoYXJlZCBcdTAwQTc1KVxuICAgIG9wZXJhbmRzLnB1c2goYSk7XG4gIH1cbiAgaWYgKG9wZXJhbmRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuOyAvLyBuby1vcGVyYW5kIGludm9jYXRpb25zIHRvdWNoIG5vdGhpbmdcbiAgLy8gRXZlcnkgb3BlcmFuZCBtdXN0IGJlIGFuIGV4cGxpY2l0IGZpbGUgXHUyMDE0IGEgZ2xvYiwgdmFyaWFibGUsIGRpcmVjdG9yeSwgb3JcbiAgLy8gdHJhaWxpbmctc2xhc2ggb3BlcmFuZCBmYWlscyB0aGUgd2hvbGUgY29tbWFuZCBjbG9zZWQuXG4gIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBvcGVyYW5kcykge1xuICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShvcGVyYW5kKSkge1xuICAgICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgJ2Zvcm1hdHRlci13cml0ZScsIG9wZXJhbmQsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAob3BlcmFuZC5lbmRzV2l0aCgnLycpIHx8IGlzRXhpc3RpbmdEaXJlY3RvcnkocmVzb2x2ZVBhdGgoZGlyRm9yUmVzb2x1dGlvbiwgb3BlcmFuZCkpKSByZXR1cm47XG4gIH1cbiAgZm9yIChjb25zdCBvcGVyYW5kIG9mIG9wZXJhbmRzKSB7XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiAnZm9ybWF0dGVyLXdyaXRlJyxcbiAgICAgIHNwYW46IHsgb3BlcmF0aW9uOiAnbW9kaWZ5JywgYWJzb2x1dGVQYXRoOiByZXNvbHZlUGF0aChkaXJGb3JSZXNvbHV0aW9uLCBvcGVyYW5kKSwgc2ltcGxlQ29tbWFuZEluZGV4LCBqb2luIH1cbiAgICB9KTtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRoZSBnaXQgcmVzdG9yZSAvIGdpdCBjaGVja291dCBncmFtbWFyIChwbGFuIFx1MDBBNzUuOSksIHRoZSBsYXN0IHB1cmUtcGFyc2VyXG4vLyBmYW1pbHkuIFJlc3RvcmUgaGFzIG5vIHJldmlzaW9uIG9wZXJhbmQgZm9ybSBcdTIwMTQgaXRzIHBvc2l0aW9uYWwgYXJncyBhcmVcbi8vIGFsd2F5cyBwYXRoc3BlY3M7IGNoZWNrb3V0IHNraXBzIGEgcHJlLWAtLWAgcmV2aXNpb24vcmVmIG9wZXJhbmQgYW5kIHRha2VzXG4vLyBwYXRoc3BlY3Mgb25seSBhZnRlciBgLS1gLiBFdmVyeSBleHBsaWNpdC1maWxlIHBhdGhzcGVjIGlzIGEgd2hvbGUtZmlsZVxuLy8gY3JlYXRlLW92ZXJ3cml0ZSB0b3VjaDsgYSBkaXJlY3Rvcnktc2hhcGVkIHBhdGhzcGVjIChgLmAvYC4uYCwgdHJhaWxpbmcgYC9gLFxuLy8gb3IgYSBwYXRoIHRoYXQgc3RhdHMgYXMgYSBkaXJlY3RvcnkpLCBgLS1zdGFnZWRgLW9ubHkgcmVzdG9yZSwgYW5kXG4vLyBgLXBgL2AtLXBhdGNoYCBpbnRlcmFjdGl2ZSBodW5rIHNlbGVjdGlvbiBhbGwgZmFpbCBjbG9zZWQuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIGdpdCByZXN0b3JlIG5vLXZhbHVlIGZsYWdzIChwbGFuIFx1MDBBNzUuOSk7IGAtc2AvYC0tc291cmNlYCwgYC0tc3RhZ2VkYCwgYC1XYC9gLS13b3JrdHJlZWAsIGAtbWAvYC0tbWVyZ2VgLCBhbmQgYC1wYC9gLS1wYXRjaGAgYXJlIGhhbmRsZWQgZXhwbGljaXRseS4gKi9cbmNvbnN0IFJFU1RPUkVfTk9fVkFMVUUgPSBuZXcgU2V0KFsnLXEnLCAnLWYnLCAnLXUnXSk7XG5cbi8qKlxuICogVGhlIHNoYXJlZCByZXN0b3JlL2NoZWNrb3V0IHBhdGhzcGVjIGVtaXNzaW9uIChwbGFuIFx1MDBBNzUuOSk6IGFuIGV4cGxpY2l0LWZpbGVcbiAqIHBhdGhzcGVjIChubyBnbG9icywgbm8gYC5gL2AuLmAsIG5vIGRpcmVjdG9yeSwgbm8gdHJhaWxpbmcgYC9gKSBpcyBhXG4gKiBjcmVhdGUtb3ZlcndyaXRlIHdob2xlLWZpbGUgdG91Y2g7IGEgZGlyZWN0b3J5LXNoYXBlZCBwYXRoc3BlYyBpc1xuICogdW5yZXNvbHZlZCBcdTIwMTQgYSBkaXJlY3RvcnkgcmVzdG9yZS9jaGVja291dCByZXdyaXRlcyBhcmJpdHJhcnkgZmlsZXMgYmVuZWF0aFxuICogaXQgYW5kIGNhbm5vdCBiZSBhdHRyaWJ1dGVkIHRvIGEgZmlsZSB3cml0ZS5cbiAqL1xuZnVuY3Rpb24gZW1pdFJlc3RvcmVDaGVja291dFBhdGhzcGVjKFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXSxcbiAgaWRpb206ICdnaXQtcmVzdG9yZS13cml0ZScgfCAnZ2l0LWNoZWNrb3V0LXdyaXRlJyxcbiAgb3BlcmFuZDogc3RyaW5nLFxuICBkaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddXG4pOiB2b2lkIHtcbiAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKG9wZXJhbmQpKSB7XG4gICAgcHVzaFVucmVzb2x2ZWQocmVzdWx0cywgaWRpb20sIG9wZXJhbmQsICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYicpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlUGF0aChkaXIsIG9wZXJhbmQpO1xuICBpZiAob3BlcmFuZCA9PT0gJy4nIHx8IG9wZXJhbmQgPT09ICcuLicgfHwgb3BlcmFuZC5lbmRzV2l0aCgnLycpIHx8IGlzRXhpc3RpbmdEaXJlY3RvcnkoYWJzb2x1dGVQYXRoKSkge1xuICAgIHB1c2hVbnJlc29sdmVkKFxuICAgICAgcmVzdWx0cyxcbiAgICAgIGlkaW9tLFxuICAgICAgb3BlcmFuZCxcbiAgICAgICdkaXJlY3Rvcnktc2hhcGVkIHBhdGhzcGVjIHJld3JpdGVzIGFyYml0cmFyeSBmaWxlcyBiZW5lYXRoIGl0IFx1MjAxNCBub3QgYXR0cmlidXRhYmxlIHRvIGEgZmlsZSB3cml0ZSdcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuICByZXN1bHRzLnB1c2goe1xuICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICBpZGlvbSxcbiAgICBzcGFuOiB7IG9wZXJhdGlvbjogJ2NyZWF0ZS1vdmVyd3JpdGUnLCBhYnNvbHV0ZVBhdGgsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiB9XG4gIH0pO1xufVxuXG4vKipcbiAqIFRoZSBnaXQgcmVzdG9yZSBvcGVyYW5kIGdyYW1tYXIgKHBsYW4gXHUwMEE3NS45KTogYC1zYC9gLS1zb3VyY2U9PHRyZWU+YCBpc1xuICogdmFsdWUtdGFraW5nIFx1MjAxNCB0aGUgdHJlZSBvcGVyYW5kIG5ldmVyIHJlc29sdmVzIGFzIGEgcGF0aHNwZWM7IGAtcGAvYC0tcGF0Y2hgXG4gKiBpbnRlcmFjdGl2ZSBodW5rIHNlbGVjdGlvbiBpcyB1bnJlc29sdmVkOyBgLW1gL2AtLW1lcmdlYCAodGhlIG1lcmdlXG4gKiBtYWNoaW5lcnksIGNvbmRpdGlvbmFsIG9uIHRoZSBpbmRleCBiZWluZyB1bm1lcmdlZCkgYW5kIGAtLXN0YWdlZGAgd2l0aG91dFxuICogYC0td29ya3RyZWVgIChpbmRleC1vbmx5IFx1MjAxNCB0aGUgd29ya2luZyBmaWxlIHN1cnZpdmVzKSB0b3VjaCBub3RoaW5nLlxuICovXG5mdW5jdGlvbiBtYXRjaFJlc3RvcmVPcGVyYW5kcyhcbiAgYXJnczogc3RyaW5nW10sXG4gIGRpcjogc3RyaW5nLFxuICBzaW1wbGVDb21tYW5kSW5kZXg6IG51bWJlcixcbiAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ10sXG4gIHJlc3VsdHM6IFNwYW5NYXRjaFtdXG4pOiB2b2lkIHtcbiAgbGV0IHN0YWdlZCA9IGZhbHNlO1xuICBsZXQgd29ya3RyZWUgPSBmYWxzZTtcbiAgbGV0IGFmdGVyRGFzaERhc2ggPSBmYWxzZTtcbiAgY29uc3Qgb3BlcmFuZHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYXJncy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSBhcmdzW2ldO1xuICAgIGlmIChhZnRlckRhc2hEYXNoKSB7XG4gICAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLS0nKSB7XG4gICAgICBhZnRlckRhc2hEYXNoID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy1wJyB8fCBhID09PSAnLS1wYXRjaCcpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKFxuICAgICAgICByZXN1bHRzLFxuICAgICAgICAnZ2l0LXJlc3RvcmUtd3JpdGUnLFxuICAgICAgICBhLFxuICAgICAgICAnaW50ZXJhY3RpdmUgcGF0Y2ggbW9kZSBhcHBsaWVzIHVzZXItY2hvc2VuIGh1bmtzIFx1MjAxNCBubyBzdGF0aWMgc3BhbidcbiAgICAgICk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmIChhID09PSAnLXMnIHx8IGEgPT09ICctLXNvdXJjZScpIHtcbiAgICAgIGkgKz0gMTsgLy8gdGhlIHRyZWUgb3BlcmFuZCBpcyBuZXZlciBhIHBhdGhzcGVjXG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLS1zb3VyY2U9JykpIGNvbnRpbnVlO1xuICAgIGlmIChhID09PSAnLW0nIHx8IGEgPT09ICctLW1lcmdlJykgcmV0dXJuO1xuICAgIGlmIChhID09PSAnLS1zdGFnZWQnKSB7XG4gICAgICBzdGFnZWQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLVcnIHx8IGEgPT09ICctLXdvcmt0cmVlJykge1xuICAgICAgd29ya3RyZWUgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChSRVNUT1JFX05PX1ZBTFVFLmhhcyhhKSkgY29udGludWU7XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLScpKSBjb250aW51ZTsgLy8gdW5rbm93biBvcHRpb24gXHUyMTkyIHRyZWF0ZWQgYXMgYW4gb3B0aW9uIChmYWlsIGNsb3NlZClcbiAgICBvcGVyYW5kcy5wdXNoKGEpO1xuICB9XG4gIGlmIChzdGFnZWQgJiYgIXdvcmt0cmVlKSByZXR1cm47IC8vIGluZGV4LW9ubHkgcmVzdG9yZSBkb2VzIG5vdCB0b3VjaCB0aGUgd29ya2luZyBmaWxlXG4gIGZvciAoY29uc3Qgb3BlcmFuZCBvZiBvcGVyYW5kcykge1xuICAgIGVtaXRSZXN0b3JlQ2hlY2tvdXRQYXRoc3BlYyhyZXN1bHRzLCAnZ2l0LXJlc3RvcmUtd3JpdGUnLCBvcGVyYW5kLCBkaXIsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbik7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgZ2l0IGNoZWNrb3V0IG9wZXJhbmQgZ3JhbW1hciAocGxhbiBcdTAwQTc1LjkpOiBgLWJgL2AtQmAvYC0tb3JwaGFuIDxicmFuY2g+YFxuICogYXJlIHZhbHVlLXRha2luZyBcdTIwMTQgdGhlIGJyYW5jaCBuYW1lIG5ldmVyIHJlc29sdmVzIGFzIGEgcGF0aHNwZWM7IGAtcGAvXG4gKiBgLS1wYXRjaGAgaW50ZXJhY3RpdmUgaHVuayBzZWxlY3Rpb24gaXMgdW5yZXNvbHZlZDsgYSBwcmUtYC0tYCBwb3NpdGlvbmFsIGlzXG4gKiBhIHJldmlzaW9uL3JlZiBvcGVyYW5kIGFuZCBpcyBza2lwcGVkLiBQYXRoc3BlY3Mgb25seSBhZnRlciBgLS1gLlxuICovXG5mdW5jdGlvbiBtYXRjaENoZWNrb3V0T3BlcmFuZHMoXG4gIGFyZ3M6IHN0cmluZ1tdLFxuICBkaXI6IHN0cmluZyxcbiAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gIGpvaW46IFJlc29sdmVkU3Bhblsnam9pbiddLFxuICByZXN1bHRzOiBTcGFuTWF0Y2hbXVxuKTogdm9pZCB7XG4gIGxldCBhZnRlckRhc2hEYXNoID0gZmFsc2U7XG4gIGNvbnN0IG9wZXJhbmRzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBhID0gYXJnc1tpXTtcbiAgICBpZiAoYWZ0ZXJEYXNoRGFzaCkge1xuICAgICAgb3BlcmFuZHMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYSA9PT0gJy0tJykge1xuICAgICAgYWZ0ZXJEYXNoRGFzaCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctcCcgfHwgYSA9PT0gJy0tcGF0Y2gnKSB7XG4gICAgICBwdXNoVW5yZXNvbHZlZChcbiAgICAgICAgcmVzdWx0cyxcbiAgICAgICAgJ2dpdC1jaGVja291dC13cml0ZScsXG4gICAgICAgIGEsXG4gICAgICAgICdpbnRlcmFjdGl2ZSBwYXRjaCBtb2RlIGFwcGxpZXMgdXNlci1jaG9zZW4gaHVua3MgXHUyMDE0IG5vIHN0YXRpYyBzcGFuJ1xuICAgICAgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctYicgfHwgYSA9PT0gJy1CJyB8fCBhID09PSAnLS1vcnBoYW4nKSB7XG4gICAgICBpICs9IDE7IC8vIHRoZSBicmFuY2ggbmFtZSBpcyBuZXZlciBhIHBhdGhzcGVjXG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctZicgfHwgYSA9PT0gJy1xJyB8fCBhID09PSAnLW0nIHx8IGEgPT09ICctdCcpIGNvbnRpbnVlO1xuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSkgY29udGludWU7IC8vIHVua25vd24gb3B0aW9uIFx1MjE5MiB0cmVhdGVkIGFzIGFuIG9wdGlvbiAoZmFpbCBjbG9zZWQpXG4gICAgLy8gQSBwcmUtYC0tYCBwb3NpdGlvbmFsIGlzIGEgcmV2aXNpb24vcmVmIG9wZXJhbmQgXHUyMDE0IG5ldmVyIGEgcGF0aHNwZWMuXG4gIH1cbiAgZm9yIChjb25zdCBvcGVyYW5kIG9mIG9wZXJhbmRzKSB7XG4gICAgZW1pdFJlc3RvcmVDaGVja291dFBhdGhzcGVjKHJlc3VsdHMsICdnaXQtY2hlY2tvdXQtd3JpdGUnLCBvcGVyYW5kLCBkaXIsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbik7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgZ2l0IHJlc3RvcmUgLyBnaXQgY2hlY2tvdXQgZmFtaWx5IChwbGFuIFx1MDBBNzUuOSk6IHZpYSBgZmluZEdpdFN1YmNvbW1hbmRgXG4gKiAoaGFuZGxlcyBgZ2l0IC1DYC9gLWNgKSwgdGhlIHR3byBzdWJjb21tYW5kcyByZXNvbHZlIHRoZWlyIHBhdGhzcGVjcyB0b1xuICogd2hvbGUtZmlsZSBjcmVhdGUtb3ZlcndyaXRlIHRvdWNoZXM7IGEgd3JhcHBlZCBzdWJjb21tYW5kIGZhaWxzIGNsb3NlZC5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hHaXRSZXN0b3JlQ2hlY2tvdXQoXG4gIGFyZ3Y6IHN0cmluZ1tdLFxuICBkaXJGb3JSZXNvbHV0aW9uOiBzdHJpbmcsXG4gIHNpbXBsZUNvbW1hbmRJbmRleDogbnVtYmVyLFxuICBqb2luOiBSZXNvbHZlZFNwYW5bJ2pvaW4nXSxcbiAgcmVzdWx0czogU3Bhbk1hdGNoW11cbik6IHZvaWQge1xuICBjb25zdCByZXN0ID0gc3RyaXBUcmFuc3BhcmVudFdyYXBwZXIoYXJndik7XG4gIGlmIChyZXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICBjb25zdCBjb21tYW5kID0gcmVzdFswXTtcbiAgaWYgKGNvbW1hbmQgPT09ICdnaXQnKSB7XG4gICAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQocmVzdC5zbGljZSgxKSk7XG4gICAgaWYgKHN1YiA9PT0gbnVsbCB8fCAoc3ViLnN1YmNvbW1hbmQgIT09ICdyZXN0b3JlJyAmJiBzdWIuc3ViY29tbWFuZCAhPT0gJ2NoZWNrb3V0JykpIHJldHVybjtcbiAgICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKFxuICAgICAgICByZXN1bHRzLFxuICAgICAgICBzdWIuc3ViY29tbWFuZCA9PT0gJ3Jlc3RvcmUnID8gJ2dpdC1yZXN0b3JlLXdyaXRlJyA6ICdnaXQtY2hlY2tvdXQtd3JpdGUnLFxuICAgICAgICBzdWIuc3ViY29tbWFuZCxcbiAgICAgICAgJ2dpdCAtQyB0YXJnZXQgY29udGFpbnMgYW4gdW5yZXNvbHZlZCBzaGVsbCB2YXJpYWJsZSdcbiAgICAgICk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGRpciA9IHN1Yi5jRGlyID8/IGRpckZvclJlc29sdXRpb247XG4gICAgY29uc3QgYXJncyA9IHJlc3Quc2xpY2UoMSkuc2xpY2Uoc3ViLnN1YklkeCArIDEpO1xuICAgIGlmIChzdWIuc3ViY29tbWFuZCA9PT0gJ3Jlc3RvcmUnKSBtYXRjaFJlc3RvcmVPcGVyYW5kcyhhcmdzLCBkaXIsIHNpbXBsZUNvbW1hbmRJbmRleCwgam9pbiwgcmVzdWx0cyk7XG4gICAgZWxzZSBtYXRjaENoZWNrb3V0T3BlcmFuZHMoYXJncywgZGlyLCBzaW1wbGVDb21tYW5kSW5kZXgsIGpvaW4sIHJlc3VsdHMpO1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoRk9SRUlHTl9XUkFQUEVSUy5oYXMoY29tbWFuZCkpIHtcbiAgICBjb25zdCB3cmFwcGVkID0gcmVzdFsxXTtcbiAgICBpZiAod3JhcHBlZCA9PT0gJ3Jlc3RvcmUnIHx8IHdyYXBwZWQgPT09ICdjaGVja291dCcpIHtcbiAgICAgIHB1c2hVbnJlc29sdmVkKFxuICAgICAgICByZXN1bHRzLFxuICAgICAgICB3cmFwcGVkID09PSAncmVzdG9yZScgPyAnZ2l0LXJlc3RvcmUtd3JpdGUnIDogJ2dpdC1jaGVja291dC13cml0ZScsXG4gICAgICAgIHdyYXBwZWQsXG4gICAgICAgIGB0aGUgJHtjb21tYW5kfSB3cmFwcGVyIG9ic2N1cmVzIHRoZSAke3dyYXBwZWR9IGFyZ3ZgXG4gICAgICApO1xuICAgIH1cbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE9yY2hlc3RyYXRvclxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IExJTkVfU0VMRUNUT1JTID0gW21hdGNoU2VkLCBtYXRjaEhlYWQsIG1hdGNoVGFpbF07XG5cbi8qKlxuICogU3Bhbi1sZXNzIGNvbW1hbmRzIHdob3NlIGV4aXQgc3RhdHVzIGlzIGRldGVybWluaXN0aWMgXHUyMDE0IHVzYWJsZSBhcyBndWFyZHMgaW5cbiAqIGAmJmAvYHx8YCBqb2lucyAocGxhbiBcdTAwQTczIHN0ZXAgMidzIHNwYW4tbGVzcy1ndWFyZCBydWxlKTogYGZhbHNlYCBhbHdheXNcbiAqIGV4aXRzIDEsIGB0cnVlYCBhbmQgYDpgIGFsd2F5cyAwLCBzbyBhIGZvbGxvd2luZyBqb2luZWQgY29tbWFuZCdzIHNraXAgaXNcbiAqIGtub3dhYmxlIGV2ZW4gdGhvdWdoIG5laXRoZXIgcHJvZHVjZXMgYSBzcGFuLlxuICovXG5jb25zdCBCVUlMVElOX0dVQVJEX1NUQVRVUyA9IG5ldyBNYXA8c3RyaW5nLCAwIHwgMT4oW1xuICBbJ2ZhbHNlJywgMV0sXG4gIFsndHJ1ZScsIDBdLFxuICBbJzonLCAwXVxuXSk7XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNvbW1hbmREZXRhaWxlZChjb21tYW5kOiBzdHJpbmcsIGN3ZDogc3RyaW5nID0gcHJvY2Vzcy5jd2QoKSk6IFNwYW5NYXRjaFtdIHtcbiAgY29uc3QgeyB3cml0ZXM6IGhlcmVkb2NXcml0ZXMsIG1hc2tlZCB9ID0gZXh0cmFjdEhlcmVkb2NXcml0ZXMoY29tbWFuZCk7XG4gIGNvbnN0IHNpbXBsZUNvbW1hbmRzID0gc3BsaXRUb3BMZXZlbChtYXNrZWQpO1xuXG4gIGNvbnN0IHJlc3VsdHM6IFNwYW5NYXRjaFtdID0gW107XG4gIGNvbnN0IGZzTGluZUNhY2hlID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlciB8IG51bGw+KCk7XG4gIGNvbnN0IGdpdExpbmVDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXIgfCBudWxsPigpO1xuXG4gIGNvbnN0IGNhY2hlZEZzVG90YWxMaW5lcyA9IChhYnNQYXRoOiBzdHJpbmcpID0+ICgpID0+IHtcbiAgICBpZiAoIWZzTGluZUNhY2hlLmhhcyhhYnNQYXRoKSkgZnNMaW5lQ2FjaGUuc2V0KGFic1BhdGgsIGNvdW50RmlsZUxpbmVzKGFic1BhdGgpKTtcbiAgICByZXR1cm4gZnNMaW5lQ2FjaGUuZ2V0KGFic1BhdGgpID8/IG51bGw7XG4gIH07XG4gIGNvbnN0IGNhY2hlZEdpdFRvdGFsTGluZXMgPSAoZ2l0Q3dkOiBzdHJpbmcsIHJldjogc3RyaW5nLCBwYXRoOiBzdHJpbmcpID0+ICgpID0+IHtcbiAgICBjb25zdCBrZXkgPSBgJHtnaXRDd2R9XHUwMDAwJHtyZXZ9XHUwMDAwJHtwYXRofWA7XG4gICAgaWYgKCFnaXRMaW5lQ2FjaGUuaGFzKGtleSkpIGdpdExpbmVDYWNoZS5zZXQoa2V5LCBjb3VudEdpdEJsb2JMaW5lcyhnaXRDd2QsIHJldiwgcGF0aCkpO1xuICAgIHJldHVybiBnaXRMaW5lQ2FjaGUuZ2V0KGtleSkgPz8gbnVsbDtcbiAgfTtcblxuICBsZXQgY3VycmVudERpciA9IGN3ZDtcbiAgbGV0IGxhc3RQbGFpbkZpbGVTb3VyY2U6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAvLyBUaGUgb25lLWhvcCBsaXRlcmFsIGVjaG8vcHJpbnRmIHBpcGUgc291cmNlIChwbGFuIFx1MDBBNzUuMik6IHNldCBhdCB0aGUgZW5kIG9mXG4gIC8vIGVhY2ggc2ltcGxlIGNvbW1hbmQsIGNsZWFyZWQgYXQgYW55IG5vbi1waXBlIGJvdW5kYXJ5LCB0aHJlYWRlZCBieSB0ZWUgLWFcbiAgLy8gYXBwZW5kcyBpbiB0aGUgbmV4dCBwaXBlIHN0YWdlIChgZWNobyB4IHwgdGVlIC1hIGZgKS5cbiAgbGV0IHBpcGVFY2hvQ29udGVudDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG5cbiAgLyoqIFRoZSBgam9pbmAgc3RhbXAgZm9yIGEgc2ltcGxlIGNvbW1hbmQ6IG9ubHkgdGhlIGNvbmRpdGlvbmFsIG9wZXJhdG9ycyBnYXRlIChwbGFuIFx1MDBBNzMgc3RlcCAyKS4gKi9cbiAgY29uc3Qgam9pbk9mID0gKHNpbXBsZTogU2ltcGxlQ29tbWFuZCk6IFJlc29sdmVkU3Bhblsnam9pbiddID0+XG4gICAgc2ltcGxlLnByZWNlZGVkQnkgPT09ICcmJicgfHwgc2ltcGxlLnByZWNlZGVkQnkgPT09ICd8fCcgPyBzaW1wbGUucHJlY2VkZWRCeSA6IHVuZGVmaW5lZDtcblxuICBjb25zdCBlbWl0Q2FuZGlkYXRlID0gKFxuICAgIGM6IFJhd0NhbmRpZGF0ZSxcbiAgICBkaXJGb3JSZXNvbHV0aW9uOiBzdHJpbmcsXG4gICAgc2ltcGxlQ29tbWFuZEluZGV4OiBudW1iZXIsXG4gICAgam9pbjogUmVzb2x2ZWRTcGFuWydqb2luJ11cbiAgKSA9PiB7XG4gICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKGMuZmlsZUFyZykpIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogYy5pZGlvbSxcbiAgICAgICAgZmlsZUFyZzogYy5maWxlQXJnLFxuICAgICAgICByZWFzb246ICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYidcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBhYnNvbHV0ZVBhdGggPSByZXNvbHZlUGF0aChkaXJGb3JSZXNvbHV0aW9uLCBjLmZpbGVBcmcpO1xuICAgIGNvbnN0IHRvdGFsTGluZXMgPVxuICAgICAgYy5yZXNvbHZlcktpbmQgPT09ICdmcydcbiAgICAgICAgPyBjYWNoZWRGc1RvdGFsTGluZXMoYWJzb2x1dGVQYXRoKVxuICAgICAgICA6IGNhY2hlZEdpdFRvdGFsTGluZXMoYy5kaXJPdmVycmlkZSA/PyBkaXJGb3JSZXNvbHV0aW9uLCBjLnJlc29sdmVyS2luZC5yZXYsIGMuZmlsZUFyZyk7XG4gICAgY29uc3QgcmFuZ2UgPSByZXNvbHZlU3BlYyhjLnNwZWMsIHRvdGFsTGluZXMpO1xuICAgIGlmIChyYW5nZSA9PT0gbnVsbCkge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiBjLmlkaW9tLFxuICAgICAgICBmaWxlQXJnOiBhYnNvbHV0ZVBhdGgsXG4gICAgICAgIHJlYXNvbjogJ2NvdWxkIG5vdCBkZXRlcm1pbmUgZW5kLW9mLWZpbGUgbGluZSBjb3VudCAoZmlsZSB1bnJlYWRhYmxlLCBlbXB0eSwgb3IgZ2l0IHJldi9wYXRoIG5vdCBmb3VuZCknXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgIGlkaW9tOiBjLmlkaW9tLFxuICAgICAgc3Bhbjoge1xuICAgICAgICBvcGVyYXRpb246ICdyZWFkJyxcbiAgICAgICAgbGluZVN0YXJ0OiByYW5nZS5saW5lU3RhcnQsXG4gICAgICAgIGxpbmVFbmQ6IHJhbmdlLmxpbmVFbmQsXG4gICAgICAgIGFic29sdXRlUGF0aCxcbiAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4LFxuICAgICAgICBqb2luXG4gICAgICB9XG4gICAgfSk7XG4gIH07XG5cbiAgLyoqXG4gICAqIFRoZSByZWFkIGlkaW9tcyBmb3Igb25lIHNpbXBsZSBjb21tYW5kICh0aGUgZXhpc3RpbmcgY29ycHVzIGdyYW1tYXIpOlxuICAgKiBwbGFpbiBgY2F0YC9gbmxgIHNvdXJjZXMsIHRoZSBsaW5lIHNlbGVjdG9ycywgYW5kIHRoZSBnaXQgbWF0Y2hlcnMsIHdpdGhcbiAgICogb25lLWhvcCBwaXBlLXNvdXJjZSBwcm9wYWdhdGlvbiBmb3IgZG93bnN0cmVhbSBgaGVhZGAvYHRhaWxgL2BzZWQgLW5gLlxuICAgKi9cbiAgY29uc3QgbWF0Y2hSZWFkcyA9IChzaW1wbGU6IFNpbXBsZUNvbW1hbmQsIGFyZ3Y6IHN0cmluZ1tdLCBpOiBudW1iZXIpOiB2b2lkID0+IHtcbiAgICBsZXQgaXNQbGFpblNvdXJjZSA9IGZhbHNlO1xuICAgIGxldCBwbGFpbkZpbGVBcmc6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAgIGlmIChhcmd2WzBdID09PSAnY2F0JyAmJiBhcmd2Lmxlbmd0aCA9PT0gMiAmJiAhYXJndlsxXS5zdGFydHNXaXRoKCctJykpIHtcbiAgICAgIGlzUGxhaW5Tb3VyY2UgPSB0cnVlO1xuICAgICAgcGxhaW5GaWxlQXJnID0gYXJndlsxXTtcbiAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBoYXNTaGVsbEV4cGFuc2lvbihhcmd2WzFdKSA/IG51bGwgOiByZXNvbHZlUGF0aChjdXJyZW50RGlyLCBhcmd2WzFdKTtcbiAgICB9IGVsc2UgaWYgKGFyZ3ZbMF0gPT09ICdubCcgJiYgYXJndi5sZW5ndGggPj0gMiAmJiAhYXJndlthcmd2Lmxlbmd0aCAtIDFdLnN0YXJ0c1dpdGgoJy0nKSkge1xuICAgICAgaXNQbGFpblNvdXJjZSA9IHRydWU7XG4gICAgICBjb25zdCBmID0gYXJndlthcmd2Lmxlbmd0aCAtIDFdO1xuICAgICAgcGxhaW5GaWxlQXJnID0gZjtcbiAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBoYXNTaGVsbEV4cGFuc2lvbihmKSA/IG51bGwgOiByZXNvbHZlUGF0aChjdXJyZW50RGlyLCBmKTtcbiAgICB9XG5cbiAgICAvLyBBIGJhcmUgYGNhdCBmaWxlYC9gbmwgZmlsZWAgdGhhdCBpcyBub3QgZmVlZGluZyBhIGRvd25zdHJlYW0gcGlwZSBzdGFnZVxuICAgIC8vIHJlYWRzIHRoZSB3aG9sZSBmaWxlOiBlbWl0IHRoZSBzYW1lIHdob2xlLWZpbGUgc3BhbiBgZ2l0IHNob3cgcmV2OnBhdGhgXG4gICAgLy8gcHJvZHVjZXMuIFdoZW4gYSBwaXBlIGZvbGxvd3MsIHRoZSBkb3duc3RyZWFtIGxpbmUtc2VsZWN0b3IgYWxyZWFkeVxuICAgIC8vIGVtaXRzIHRoZSBwcmVjaXNlIHJhbmdlLCBzbyB0aGUgc291cmNlIHN0YXlzIHNvdXJjZS1vbmx5LlxuICAgIGlmIChwbGFpbkZpbGVBcmcgIT09IG51bGwpIHtcbiAgICAgIGNvbnN0IG5leHQgPSBzaW1wbGVDb21tYW5kc1tpICsgMV07XG4gICAgICBpZiAobmV4dCA9PT0gdW5kZWZpbmVkIHx8IG5leHQucHJlY2VkZWRCeSAhPT0gJ3wnKSB7XG4gICAgICAgIGVtaXRDYW5kaWRhdGUoXG4gICAgICAgICAge1xuICAgICAgICAgICAga2luZDogJ2NhbmRpZGF0ZScsXG4gICAgICAgICAgICBpZGlvbTogYXJndlswXSA9PT0gJ2NhdCcgPyAnY2F0LWZpbGUnIDogJ25sLWZpbGUnLFxuICAgICAgICAgICAgZmlsZUFyZzogcGxhaW5GaWxlQXJnLFxuICAgICAgICAgICAgc3BlYzogeyBraW5kOiAndG9Fb2YnLCBzdGFydDogMSB9LFxuICAgICAgICAgICAgcmVzb2x2ZXJLaW5kOiAnZnMnXG4gICAgICAgICAgfSxcbiAgICAgICAgICBjdXJyZW50RGlyLFxuICAgICAgICAgIGksXG4gICAgICAgICAgam9pbk9mKHNpbXBsZSlcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBsZXQgbWF0Y2hlZCA9IGZhbHNlO1xuICAgIGZvciAoY29uc3QgbWF0Y2hlciBvZiBbLi4uTElORV9TRUxFQ1RPUlMsIG1hdGNoR2l0U2hvdywgbWF0Y2hHaXRMb2dMXSkge1xuICAgICAgZm9yIChjb25zdCBvdXRjb21lIG9mIG1hdGNoZXIoYXJndikpIHtcbiAgICAgICAgbWF0Y2hlZCA9IHRydWU7XG4gICAgICAgIGlmIChvdXRjb21lLmtpbmQgPT09ICd1bnJlc29sdmVkJykge1xuICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgICAgIGlkaW9tOiBvdXRjb21lLmlkaW9tLFxuICAgICAgICAgICAgZmlsZUFyZzogb3V0Y29tZS5maWxlQXJnLFxuICAgICAgICAgICAgcmVhc29uOiBvdXRjb21lLnJlYXNvblxuICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGVtaXRDYW5kaWRhdGUob3V0Y29tZSwgb3V0Y29tZS5kaXJPdmVycmlkZSA/PyBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSk7XG4gICAgICAgICAgLy8gYGdpdCBzaG93IHJldjpwYXRoYCBwcmludHMgdGhlIGJsb2IgdmVyYmF0aW0sIHNvICh1bmxpa2UgYGdpdCBsb2cgLUxgLFxuICAgICAgICAgIC8vIHdoaWNoIHByaW50cyBkaWZmLWZvcm1hdHRlZCBoaXN0b3J5KSBpdCdzIGEgdmFsaWQgb25lLWhvcCBwaXBlIHNvdXJjZVxuICAgICAgICAgIC8vIGZvciBhIGRvd25zdHJlYW0gbGluZS1zZWxlY3Rvciwgc2FtZSBhcyBgY2F0YC9gbmxgLlxuICAgICAgICAgIGlmIChvdXRjb21lLmlkaW9tID09PSAnZ2l0LXNob3ctcmV2LXBhdGgnICYmICFsb29rc1VucmVzb2x2YWJsZShvdXRjb21lLmZpbGVBcmcpKSB7XG4gICAgICAgICAgICBpc1BsYWluU291cmNlID0gdHJ1ZTtcbiAgICAgICAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSByZXNvbHZlUGF0aChvdXRjb21lLmRpck92ZXJyaWRlID8/IGN1cnJlbnREaXIsIG91dGNvbWUuZmlsZUFyZyk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFtYXRjaGVkICYmIHNpbXBsZS5wcmVjZWRlZEJ5ID09PSAnfCcgJiYgbGFzdFBsYWluRmlsZVNvdXJjZSkge1xuICAgICAgY29uc3Qgd2l0aEZpbGUgPSBbLi4uYXJndiwgbGFzdFBsYWluRmlsZVNvdXJjZV07XG4gICAgICBmb3IgKGNvbnN0IG1hdGNoZXIgb2YgTElORV9TRUxFQ1RPUlMpIHtcbiAgICAgICAgZm9yIChjb25zdCBvdXRjb21lIG9mIG1hdGNoZXIod2l0aEZpbGUpKSB7XG4gICAgICAgICAgaWYgKG91dGNvbWUua2luZCA9PT0gJ2NhbmRpZGF0ZScpIGVtaXRDYW5kaWRhdGUob3V0Y29tZSwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSkpO1xuICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgICAgICBpZGlvbTogb3V0Y29tZS5pZGlvbSxcbiAgICAgICAgICAgICAgZmlsZUFyZzogb3V0Y29tZS5maWxlQXJnLFxuICAgICAgICAgICAgICByZWFzb246IG91dGNvbWUucmVhc29uXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghaXNQbGFpblNvdXJjZSkgbGFzdFBsYWluRmlsZVNvdXJjZSA9IG51bGw7XG4gIH07XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBzaW1wbGVDb21tYW5kcy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IHNpbXBsZSA9IHNpbXBsZUNvbW1hbmRzW2ldO1xuXG4gICAgLy8gQSBwaXBlIHN0YWdlIG1heSBpbmhlcml0IHRoZSBwcmV2aW91cyBzdGFnZSdzIGxpdGVyYWwgZWNobyBjb250ZW50OyBhbnlcbiAgICAvLyBvdGhlciBib3VuZGFyeSBjbGVhcnMgaXQuXG4gICAgaWYgKHNpbXBsZS5wcmVjZWRlZEJ5ICE9PSAnfCcpIHBpcGVFY2hvQ29udGVudCA9IG51bGw7XG5cbiAgICBjb25zdCBoZXJlZG9jUmVmID0gc2ltcGxlLnRleHQubWF0Y2goL15fX2hlcmVkb2NfKFxcZCspX18kLyk7XG4gICAgaWYgKGhlcmVkb2NSZWYpIHtcbiAgICAgIGNvbnN0IHcgPSBoZXJlZG9jV3JpdGVzW051bWJlci5wYXJzZUludChoZXJlZG9jUmVmWzFdLCAxMCldO1xuICAgICAgY29uc3QgdG9rZW5zID0gdG9rZW5pemUoc3RyaXBMZWFkaW5nQXNzaWdubWVudHMody5vcGVuZXIpLnRyaW0oKSk7XG4gICAgICBpZiAodG9rZW5zID09PSBudWxsKSB7XG4gICAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBudWxsO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IG9wZW5lckFyZ3YgPSBhbmFseXplVG9rZW5zKHRva2VucykuYXJndjtcbiAgICAgIG1hdGNoUmVhZHMoc2ltcGxlLCBvcGVuZXJBcmd2LCBpKTtcbiAgICAgIGNsYXNzaWZ5SGVyZWRvY09wZW5lcih3Lm9wZW5lciwgdy5ib2R5LCB3LnF1b3RlZERlbGltLCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgICBwaXBlRWNob0NvbnRlbnQgPSBsaXRlcmFsQ29udGVudChvcGVuZXJBcmd2KSA/PyBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgdG9rZW5zID0gdG9rZW5pemUoc3RyaXBMZWFkaW5nQXNzaWdubWVudHMoc2ltcGxlLnRleHQpLnRyaW0oKSk7XG4gICAgaWYgKHRva2VucyA9PT0gbnVsbCkge1xuICAgICAgbGFzdFBsYWluRmlsZVNvdXJjZSA9IG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgeyBhcmd2LCByZWRpcmVjdHMgfSA9IGFuYWx5emVUb2tlbnModG9rZW5zKTtcbiAgICBpZiAoYXJndi5sZW5ndGggPT09IDApIHtcbiAgICAgIC8vIEJhcmUgYD4gZmAgLyBgOiA+IGZgOiBubyBhcmd2LCBidXQgdGhlIHRydW5jYXRpb24gZ3JhbW1hciBzdGlsbCBmaXJlcy5cbiAgICAgIG1hdGNoUmVkaXJlY3RGYW1pbHkoYXJndiwgcmVkaXJlY3RzLCBwaXBlRWNob0NvbnRlbnQsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKGFyZ3ZbMF0gPT09ICdjZCcpIHtcbiAgICAgIGxhc3RQbGFpbkZpbGVTb3VyY2UgPSBudWxsO1xuICAgICAgY29uc3QgdGFyZ2V0ID0gYXJndlsxXTtcbiAgICAgIGlmICh0YXJnZXQgIT09IHVuZGVmaW5lZCAmJiB0YXJnZXQgIT09ICctJyAmJiAhaGFzU2hlbGxFeHBhbnNpb24odGFyZ2V0KSkge1xuICAgICAgICBjdXJyZW50RGlyID0gcmVzb2x2ZVBhdGgoY3VycmVudERpciwgdGFyZ2V0KTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGJlZm9yZSA9IHJlc3VsdHMubGVuZ3RoO1xuICAgIG1hdGNoUmVhZHMoc2ltcGxlLCBhcmd2LCBpKTtcbiAgICBtYXRjaFJlZGlyZWN0RmFtaWx5KGFyZ3YsIHJlZGlyZWN0cywgcGlwZUVjaG9Db250ZW50LCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgbWF0Y2hDb3B5TW92ZUZhbWlseShhcmd2LCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgbWF0Y2hSbVRydW5jYXRlKGFyZ3YsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICBtYXRjaFNlZElucGxhY2UoYXJndiwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgIG1hdGNoUGF0Y2hBcHBseShhcmd2LCByZWRpcmVjdHMsIGN1cnJlbnREaXIsIGksIGpvaW5PZihzaW1wbGUpLCByZXN1bHRzKTtcbiAgICBtYXRjaEZvcm1hdHRlcihhcmd2LCBjdXJyZW50RGlyLCBpLCBqb2luT2Yoc2ltcGxlKSwgcmVzdWx0cyk7XG4gICAgbWF0Y2hHaXRSZXN0b3JlQ2hlY2tvdXQoYXJndiwgY3VycmVudERpciwgaSwgam9pbk9mKHNpbXBsZSksIHJlc3VsdHMpO1xuICAgIGlmIChyZXN1bHRzLmxlbmd0aCA9PT0gYmVmb3JlKSB7XG4gICAgICAvLyBObyBzcGFuIGZvciB0aGlzIGNvbW1hbmQ6IGEgZGV0ZXJtaW5pc3RpYyBidWlsdGluIGlzIHN0aWxsIGEgdXNhYmxlXG4gICAgICAvLyBqb2luIGd1YXJkIChgZmFsc2UgJiYgZWNobyB4ID4gZmAgbXVzdCBza2lwIHRoZSBlY2hvKS4gQW55IG90aGVyXG4gICAgICAvLyBjb21tYW5kIHN0YXlzIHNwYW4tbGVzcyBhbmQgdW5rbm93YWJsZSBcdTIwMTQgdGhlIGRyaXZlciBmYWlscyBvcGVuLlxuICAgICAgY29uc3Qgc3RhdHVzID0gQlVJTFRJTl9HVUFSRF9TVEFUVVMuZ2V0KGFyZ3ZbMF0pO1xuICAgICAgaWYgKHN0YXR1cyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAnYnVpbHRpbi1ndWFyZCcsXG4gICAgICAgICAgc2ltcGxlQ29tbWFuZEluZGV4OiBpLFxuICAgICAgICAgIGpvaW46IGpvaW5PZihzaW1wbGUpLFxuICAgICAgICAgIGV4aXRTdGF0dXM6IHN0YXR1c1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gICAgcGlwZUVjaG9Db250ZW50ID0gbGl0ZXJhbENvbnRlbnQoYXJndikgPz8gbnVsbDtcbiAgfVxuXG4gIHJldHVybiByZXN1bHRzO1xufVxuXG4vKiogUGFyc2VzIGEgQmFzaCBgY29tbWFuZGAgc3RyaW5nIGludG8gdGhlIGZpbGUrbGluZS1yYW5nZSBzcGFucyBpdCBzdGF0aWNhbGx5LCByZWxpYWJseSByZWFkcyBvciB3cml0ZXMuIGBjd2RgIGRlZmF1bHRzIHRvIGBwcm9jZXNzLmN3ZCgpYCBcdTIwMTQgcGFzcyB0aGUgaG9vaydzIG93biBgY3dkYCBmaWVsZCBmb3IgY29ycmVjdCByZXNvbHV0aW9uIG9mIHJlbGF0aXZlIHBhdGhzIGFuZCBgY2RgL2BnaXQgLUNgIHRhcmdldHMsIGFuZCBvZiBgZ2l0IHNob3dgL2BnaXQgbG9nIC1MYCByZXZpc2lvbnMuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb21tYW5kKGNvbW1hbmQ6IHN0cmluZywgY3dkOiBzdHJpbmcgPSBwcm9jZXNzLmN3ZCgpKTogUmVzb2x2ZWRTcGFuW10ge1xuICBjb25zdCBkZXRhaWxlZCA9IHBhcnNlQ29tbWFuZERldGFpbGVkKGNvbW1hbmQsIGN3ZCk7XG4gIGNvbnN0IHNwYW5zOiBSZXNvbHZlZFNwYW5bXSA9IFtdO1xuICBmb3IgKGNvbnN0IG0gb2YgZGV0YWlsZWQpIHtcbiAgICBpZiAobS5zdGF0dXMgPT09ICdyZXNvbHZlZCcpIHNwYW5zLnB1c2gobS5zcGFuKTtcbiAgfVxuICByZXR1cm4gc3BhbnM7XG59XG4iLCAiLyoqXG4gKiBUaGUgb25seSBpbXB1cmUgYml0czogY291bnRpbmcgbGluZXMgb2YgYSB3b3JraW5nLXRyZWUgZmlsZSwgYW5kIG9mIGEgZmlsZVxuICogYXMgaXQgZXhpc3RlZCBhdCBhIGdpdmVuIGdpdCByZXZpc2lvbi4gQm90aCByZXR1cm4gbnVsbCBvbiBhbnkgZmFpbHVyZVxuICogKG1pc3NpbmcgZmlsZSwgYmFkIHJldiwgbm90IGEgZ2l0IHJlcG8sIGV0Yy4pIGluc3RlYWQgb2YgdGhyb3dpbmcgXHUyMDE0IGFcbiAqIGNvbW1hbmQgdGhhdCBzdGF0aWNhbGx5IG1hdGNoZWQgYW4gaWRpb20gYnV0IHBvaW50cyBhdCBzb21ldGhpbmcgdGhpc1xuICogbWFjaGluZSBjYW4ndCBjdXJyZW50bHkgcmVzb2x2ZSBpcyBhIG5vcm1hbCwgZXhwZWN0ZWQgb3V0Y29tZSwgbm90IGEgYnVnLlxuICovXG5pbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHsgcmVhZEZpbGVTeW5jLCBzdGF0U3luYyB9IGZyb20gJ25vZGU6ZnMnO1xuXG4vKiogTnVtYmVyIG9mIGxpbmVzIGluIGEgd29ya2luZy10cmVlIGZpbGUsIG9yIG51bGwgaWYgaXQgY2FuJ3QgYmUgcmVhZC4gVHJhaWxpbmcgbmV3bGluZSBkb2VzIG5vdCBjb3VudCBhcyBhbiBleHRyYSBlbXB0eSBsaW5lLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvdW50RmlsZUxpbmVzKGFic29sdXRlUGF0aDogc3RyaW5nKTogbnVtYmVyIHwgbnVsbCB7XG4gIHRyeSB7XG4gICAgaWYgKCFzdGF0U3luYyhhYnNvbHV0ZVBhdGgpLmlzRmlsZSgpKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBjb250ZW50ID0gcmVhZEZpbGVTeW5jKGFic29sdXRlUGF0aCwgJ3V0ZjgnKTtcbiAgICBpZiAoY29udGVudC5sZW5ndGggPT09IDApIHJldHVybiAwO1xuICAgIGNvbnN0IHdpdGhvdXRUcmFpbGluZ05ld2xpbmUgPSBjb250ZW50LmVuZHNXaXRoKCdcXG4nKSA/IGNvbnRlbnQuc2xpY2UoMCwgLTEpIDogY29udGVudDtcbiAgICByZXR1cm4gd2l0aG91dFRyYWlsaW5nTmV3bGluZS5zcGxpdCgnXFxuJykubGVuZ3RoO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKiogTnVtYmVyIG9mIGxpbmVzIGluIGBwYXRoYCBhcyBpdCBleGlzdHMgYXQgYHJldmAsIHJ1biBmcm9tIGBjd2RgLCBvciBudWxsIGlmIHRoZSByZXYvcGF0aC9yZXBvIGRvZXNuJ3QgcmVzb2x2ZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb3VudEdpdEJsb2JMaW5lcyhjd2Q6IHN0cmluZywgcmV2OiBzdHJpbmcsIHBhdGg6IHN0cmluZyk6IG51bWJlciB8IG51bGwge1xuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzaG93JywgYCR7cmV2fToke3BhdGh9YF0sIHtcbiAgICAgIGN3ZCxcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXVxuICAgIH0pO1xuICAgIGlmIChvdXQubGVuZ3RoID09PSAwKSByZXR1cm4gMDtcbiAgICBjb25zdCB3aXRob3V0VHJhaWxpbmdOZXdsaW5lID0gb3V0LmVuZHNXaXRoKCdcXG4nKSA/IG91dC5zbGljZSgwLCAtMSkgOiBvdXQ7XG4gICAgcmV0dXJuIHdpdGhvdXRUcmFpbGluZ05ld2xpbmUuc3BsaXQoJ1xcbicpLmxlbmd0aDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cbiIsICIvKipcbiAqIEhldXJpc3RpYywgZGVwZW5kZW5jeS1mcmVlIHNoZWxsIHNwbGl0dGluZy4gTm90IGEgZnVsbCBzaGVsbCBwYXJzZXIgXHUyMDE0IGdvb2RcbiAqIGVub3VnaCB0byBsb2NhdGUgc2ltcGxlIGNvbW1hbmRzIChhbmQgdGhlaXIgYXJndikgaW5zaWRlIGEgbGFyZ2VyXG4gKiAmJi98fC87L3wtam9pbmVkIEJhc2ggc3RyaW5nIHdpdGhvdXQgcHVsbGluZyBpbiBhIHJlYWwgYmFzaCBBU1QgcGFyc2VyLlxuICogVmFsaWRhdGVkIGR1cmluZyByZXNlYXJjaCBhZ2FpbnN0IGJhc2hsZXggb24gdGhlIHJlYWwgdHJhbnNjcmlwdCBjb3JwdXM7XG4gKiB0aGlzIHBvcnRzIHRoZSBzYW1lIGFsZ29yaXRobS5cbiAqXG4gKiBUaGUgd29yZC1sZXZlbCB0b2tlbml6ZXIgKFt0b2tlbml6ZV0pIGlzIHF1b3RlLSBhbmQgcmVkaXJlY3QtYXdhcmUgKHBsYW5cbiAqIFx1MDBBNzUuMTApOiByZWRpcmVjdCBvcGVyYXRvcnMgYXJlIHNwbGl0IGFzIGRpc3RpbmN0IHRva2VucyB3aXRoIGF0dGFjaGVkLXRhcmdldFxuICogZm9ybXMgcHJlc2VydmVkIChgPmZgKSwgcXVvdGVkIHRva2VucyBhcmUgd29yZHMgYW5kIG5ldmVyIG9wZXJhdG9ycywgYW5kXG4gKiBbYXJndk9mXSBkZXJpdmVzIG9wZXJhbmRzIGZyb20gdGhlIHRva2VuIHN0cmVhbSBtaW51cyByZWRpcmVjdCB0b2tlbnMgYW5kXG4gKiB0aGVpciB0YXJnZXRzLlxuICovXG5cbi8qKiBPbmUgYHNpbXBsZSBjb21tYW5kYCBmb3VuZCBpbiBhIGxhcmdlciBzY3JpcHQsIHBsdXMgd2hpY2ggb3BlcmF0b3IgcHJlY2VkZWQgaXQuICovXG5leHBvcnQgaW50ZXJmYWNlIFNpbXBsZUNvbW1hbmQge1xuICB0ZXh0OiBzdHJpbmc7XG4gIC8qKlxuICAgKiBUaGUgb3BlcmF0b3IgaW1tZWRpYXRlbHkgYmVmb3JlIHRoaXMgY29tbWFuZDogJ3wnIGZvciBhIHBpcGVsaW5lIHN0YWdlLFxuICAgKiAnJiYnLyd8fCcgZm9yIHRoZSBjb25kaXRpb25hbCBvcGVyYXRvcnMgKHRoZSBvbmx5IG9uZXMgdGhhdCBnYXRlLCBwbGFuXG4gICAqIFx1MDBBNzMgc3RlcCAyKSwgJ290aGVyJyBmb3IgJzsnL25ld2xpbmUvJyYnLCBvciAnc3RhcnQnIGZvciB0aGUgZmlyc3QgY29tbWFuZC5cbiAgICovXG4gIHByZWNlZGVkQnk6ICdzdGFydCcgfCAnfCcgfCAnJiYnIHwgJ3x8JyB8ICdvdGhlcic7XG59XG5cbi8qKiBTcGxpdCBhIGNvbW1hbmQgc3RyaW5nIGludG8gc2ltcGxlLWNvbW1hbmQgc3Vic3RyaW5ncyBhdCB0b3AtbGV2ZWwgJiYsIHx8LCA7LCB8LCB8JiwgYW5kIG5ld2xpbmUgYm91bmRhcmllcy4gUXVvdGVzIGFuZCAkKCkvYGAvKCkgbmVzdGluZyBhcmUgcmVzcGVjdGVkIChub3Qgc3BsaXQgaW5zaWRlKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzcGxpdFRvcExldmVsKGNtZDogc3RyaW5nKTogU2ltcGxlQ29tbWFuZFtdIHtcbiAgY29uc3QgcGFydHM6IFNpbXBsZUNvbW1hbmRbXSA9IFtdO1xuICBsZXQgYnVmID0gJyc7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgbiA9IGNtZC5sZW5ndGg7XG4gIGxldCBkZXB0aCA9IDA7XG4gIGxldCBpblNxdW90ZSA9IGZhbHNlO1xuICBsZXQgaW5EcXVvdGUgPSBmYWxzZTtcbiAgbGV0IHBlbmRpbmdPcDogU2ltcGxlQ29tbWFuZFsncHJlY2VkZWRCeSddID0gJ3N0YXJ0JztcblxuICBjb25zdCBmbHVzaCA9IChuZXh0T3A6IFNpbXBsZUNvbW1hbmRbJ3ByZWNlZGVkQnknXSkgPT4ge1xuICAgIGNvbnN0IHMgPSBidWYudHJpbSgpO1xuICAgIGlmIChzKSBwYXJ0cy5wdXNoKHsgdGV4dDogcywgcHJlY2VkZWRCeTogcGVuZGluZ09wIH0pO1xuICAgIGJ1ZiA9ICcnO1xuICAgIHBlbmRpbmdPcCA9IG5leHRPcDtcbiAgfTtcblxuICAvKipcbiAgICogV2hldGhlciB0aGUgb3BlcmF0b3IgY3VycmVudGx5IHBlbmRpbmcgaXMgYSBwaXBlIChgfGAvYHwmYCkuIEEgaGVscGVyXG4gICAqIHJhdGhlciB0aGFuIGFuIGlubGluZSBjb21wYXJpc29uOiBUeXBlU2NyaXB0J3MgY29udHJvbC1mbG93IG5hcnJvd2luZ1xuICAgKiBjYW5ub3Qgc2VlIHRoZSBhc3NpZ25tZW50cyBgZmx1c2hgIG1ha2VzIHRvIGBwZW5kaW5nT3BgIGZyb20gaW5zaWRlIGl0c1xuICAgKiBjbG9zdXJlLCBhbmQgd291bGQgb3RoZXJ3aXNlIG5hcnJvdyB0aGUgZGlyZWN0IGNvbXBhcmlzb24gdG8gdGhlXG4gICAqIGluaXRpYWxpemVyIGAnc3RhcnQnYC5cbiAgICovXG4gIGNvbnN0IGlzUGVuZGluZ1BpcGUgPSAoKTogYm9vbGVhbiA9PiBwZW5kaW5nT3AgPT09ICd8JztcblxuICB3aGlsZSAoaSA8IG4pIHtcbiAgICBjb25zdCBjID0gY21kW2ldO1xuICAgIGlmIChpblNxdW90ZSkge1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpZiAoYyA9PT0gXCInXCIpIGluU3F1b3RlID0gZmFsc2U7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGluRHF1b3RlKSB7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICAgIGJ1ZiArPSBjbWRbaSArIDFdO1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcIicpIGluRHF1b3RlID0gZmFsc2U7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09IFwiJ1wiKSB7XG4gICAgICBpblNxdW90ZSA9IHRydWU7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1wiJykge1xuICAgICAgaW5EcXVvdGUgPSB0cnVlO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIHtcbiAgICAgIGJ1ZiArPSBjICsgY21kW2kgKyAxXTtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJygnKSB7XG4gICAgICBkZXB0aCArPSAxO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcpJykge1xuICAgICAgZGVwdGggPSBNYXRoLm1heCgwLCBkZXB0aCAtIDEpO1xuICAgICAgYnVmICs9IGM7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGRlcHRoID09PSAwKSB7XG4gICAgICBpZiAoY21kLnNsaWNlKGksIGkgKyAyKSA9PT0gJyYmJykge1xuICAgICAgICBmbHVzaCgnJiYnKTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjbWQuc2xpY2UoaSwgaSArIDIpID09PSAnfHwnKSB7XG4gICAgICAgIGZsdXNoKCd8fCcpO1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGNtZC5zbGljZShpLCBpICsgMikgPT09ICd8JicpIHtcbiAgICAgICAgZmx1c2goJ3wnKTtcbiAgICAgICAgaSArPSAyO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnOycpIHtcbiAgICAgICAgZmx1c2goJ290aGVyJyk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ3wnKSB7XG4gICAgICAgIGZsdXNoKCd8Jyk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1xcbicpIHtcbiAgICAgICAgLy8gQSBuZXdsaW5lIGltbWVkaWF0ZWx5IGFmdGVyIGEgcGlwZSBvcGVyYXRvciBpcyBhIGxpbmUgY29udGludWF0aW9uXG4gICAgICAgIC8vIChgY2F0IGEudHh0IHxcXG5zZWQgLi4uYCBrZWVwcyB0aGUgcGlwZWxpbmUpLCBub3QgYSBzdGF0ZW1lbnRcbiAgICAgICAgLy8gc2VwYXJhdG9yOiBza2lwcGluZyBpdCBwcmVzZXJ2ZXMgYHByZWNlZGVkQnk6ICd8J2AgZm9yIHRoZSBuZXh0XG4gICAgICAgIC8vIHN0YWdlIGluc3RlYWQgb2YgZGVncmFkaW5nIGl0IHRvICdvdGhlcicuXG4gICAgICAgIGlmIChpc1BlbmRpbmdQaXBlKCkpIHtcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgZmx1c2goJ290aGVyJyk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJyYnKSB7XG4gICAgICAgIC8vIGAmPmAvYCY+PmAgKHN0ZG91dCtzdGRlcnIgcmVkaXJlY3QpIGFuZCBgPiZgIChmZC1kdXAgcmVkaXJlY3QsIGFzIGluXG4gICAgICAgIC8vIGAyPiYxYCkgYXJlIHJlZGlyZWN0IG9wZXJhdG9ycywgbm90IGNvbW1hbmQgc2VwYXJhdG9ycyBcdTIwMTQga2VlcCB0aGVtXG4gICAgICAgIC8vIGluIHRoZSBjdXJyZW50IHNpbXBsZSBjb21tYW5kIHNvIHRoZSB0b2tlbml6ZXIgY2FuIGxleCB0aGVtIGFzIG9uZVxuICAgICAgICAvLyB0b2tlbi4gQSBgPmAgY291bnRzIGFzIGEgZHVwLXJlZGlyZWN0IHByZWZpeCBvbmx5IGF0IGEgdG9rZW5cbiAgICAgICAgLy8gYm91bmRhcnkgKHN0YXJ0LCBvciBhZnRlciB3aGl0ZXNwYWNlL2RpZ2l0cykgXHUyMDE0IGBhPmImY2Agc3RpbGxcbiAgICAgICAgLy8gYmFja2dyb3VuZHMgdGhlIGBhPmJgIHJlZGlyZWN0LlxuICAgICAgICBjb25zdCB0cmltbWVkID0gYnVmLnRyaW1FbmQoKTtcbiAgICAgICAgbGV0IGR1cFJlZGlyZWN0ID0gZmFsc2U7XG4gICAgICAgIGlmICh0cmltbWVkLmVuZHNXaXRoKCc+JykpIHtcbiAgICAgICAgICBjb25zdCBiZWZvcmUgPSB0cmltbWVkLmxlbmd0aCA+PSAyID8gdHJpbW1lZFt0cmltbWVkLmxlbmd0aCAtIDJdIDogJyc7XG4gICAgICAgICAgZHVwUmVkaXJlY3QgPSB0cmltbWVkLmxlbmd0aCA9PT0gMSB8fCAvXFxzfFxcZC8udGVzdChiZWZvcmUpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjbWRbaSArIDFdID09PSAnPicgfHwgZHVwUmVkaXJlY3QpIHtcbiAgICAgICAgICBidWYgKz0gYztcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgZmx1c2goJ290aGVyJyk7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuICAgIGJ1ZiArPSBjO1xuICAgIGkgKz0gMTtcbiAgfVxuICBmbHVzaCgnb3RoZXInKTtcbiAgcmV0dXJuIHBhcnRzO1xufVxuXG5jb25zdCBMRUFESU5HX0FTU0lHTk1FTlQgPSAvXig/OltBLVphLXpfXVtBLVphLXowLTlfXSo9XFxTKlxccyspKy87XG5cbi8qKiBTdHJpcCBsZWFkaW5nIEZPTz1iYXIgVkFSPWJheiBlbnYtcHJlZml4IGFzc2lnbm1lbnRzIGZyb20gYSBzaW1wbGUgY29tbWFuZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdHJpcExlYWRpbmdBc3NpZ25tZW50cyhzaW1wbGVDbWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzaW1wbGVDbWQucmVwbGFjZShMRUFESU5HX0FTU0lHTk1FTlQsICcnKTtcbn1cblxuLyoqIE9uZSBxdW90ZS1hd2FyZSBsZXhpY2FsIHRva2VuIGZyb20gYSBzaW1wbGUgY29tbWFuZCdzIHRleHQgKHBsYW4gXHUwMEE3NS4xMCkuICovXG5leHBvcnQgaW50ZXJmYWNlIFRva2VuIHtcbiAgLyoqXG4gICAqIFRoZSB0b2tlbiB0ZXh0LiBXb3JkIHRva2VucyBoYXZlIHF1b3RlcyBzdHJpcHBlZCBhbmQgZXNjYXBlcyByZXNvbHZlZDtcbiAgICogcmVkaXJlY3QgdG9rZW5zIGtlZXAgdGhlIG9wZXJhdG9yIHdpdGggYW55IGF0dGFjaGVkIHRhcmdldCAoYD5mYCxcbiAgICogYD4+ZmApLCBzaGVsbC1sZXhlciBzdHlsZS5cbiAgICovXG4gIHRleHQ6IHN0cmluZztcbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIHRva2VuIHdhcyBxdW90ZWQgb3IgZXNjYXBlZCBhbnl3aGVyZSBpbiB0aGUgc291cmNlLiBBIHF1b3RlZFxuICAgKiB0b2tlbiBpcyBhIHdvcmQsIG5ldmVyIGFuIG9wZXJhdG9yIChgZWNobyAnPidgIGlzIG5vdCBhIHJlZGlyZWN0KS5cbiAgICovXG4gIHF1b3RlZDogYm9vbGVhbjtcbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIHRva2VuIGlzIGEgcmVkaXJlY3Qgb3BlcmF0b3IgKGA+YCwgYD4+YCwgYDE+YCwgYDI+YCwgYCY+YCxcbiAgICogYCY+PmAsIGA+JmAsIGA8YCwgYDw8YCwgYDw8LWAsIGA8PDxgKSwgd2l0aCBhbnkgYXR0YWNoZWQgdGFyZ2V0IHByZXNlcnZlZFxuICAgKiBpbiBgdGV4dGAuXG4gICAqL1xuICBpc1JlZGlyZWN0OiBib29sZWFuO1xufVxuXG4vKipcbiAqIFF1b3RlLWF3YXJlIHRva2VuaXplciB0aGF0IHNwbGl0cyByZWRpcmVjdCBvcGVyYXRvcnMgYXMgZGlzdGluY3QgdG9rZW5zIHdpdGhcbiAqIGF0dGFjaGVkLXRhcmdldCBmb3JtcyBwcmVzZXJ2ZWQgKHBsYW4gXHUwMEE3NS4xMCkuIFdvcmQgdG9rZW5zIGNhcnJ5IHRoZVxuICogYHF1b3RlZGAgZmxhZyBzbyBjb25zdW1lcnMgY2FuIHRlbGwgYSByZWFsIGA8PGAgb3BlcmF0b3IgZnJvbSBhIHF1b3RlZFxuICogYFwiPDxcImAgbGl0ZXJhbC4gUmV0dXJucyBudWxsIG9uIHVuYmFsYW5jZWQgcXVvdGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gdG9rZW5pemUoczogc3RyaW5nKTogVG9rZW5bXSB8IG51bGwge1xuICBjb25zdCB0b2tlbnM6IFRva2VuW10gPSBbXTtcbiAgbGV0IGJ1ZiA9ICcnO1xuICBsZXQgcXVvdGVkID0gZmFsc2U7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgbiA9IHMubGVuZ3RoO1xuXG4gIGNvbnN0IGZsdXNoV29yZCA9ICgpOiB2b2lkID0+IHtcbiAgICBpZiAoYnVmLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICAgIHRva2Vucy5wdXNoKHsgdGV4dDogYnVmLCBxdW90ZWQsIGlzUmVkaXJlY3Q6IGZhbHNlIH0pO1xuICAgIGJ1ZiA9ICcnO1xuICAgIHF1b3RlZCA9IGZhbHNlO1xuICB9O1xuXG4gIC8qKlxuICAgKiBBcHBlbmQgdGhlIHVucXVvdGVkIGNvbnRlbnQgb2YgdGhlIHF1b3RlZCBzZWN0aW9uIG9wZW5pbmcgYXQgYHN0YXJ0YFxuICAgKiAodGhlIHF1b3RlIGNoYXIpIHRvIGBvdXRgLCBtaXJyb3Jpbmcgc2hsZXgncyBlc2NhcGUgcnVsZXMgZm9yIGRvdWJsZVxuICAgKiBxdW90ZXMuIFJldHVybnMgdGhlIGluZGV4IGFmdGVyIHRoZSBjbG9zaW5nIHF1b3RlLCBvciBudWxsIHdoZW5cbiAgICogdW5iYWxhbmNlZC5cbiAgICovXG4gIGNvbnN0IGFwcGVuZFF1b3RlZENvbnRlbnQgPSAob3V0OiBzdHJpbmcsIHN0YXJ0OiBudW1iZXIpOiB7IG91dDogc3RyaW5nOyBuZXh0OiBudW1iZXIgfSB8IG51bGwgPT4ge1xuICAgIGNvbnN0IHF1b3RlID0gc1tzdGFydF07XG4gICAgbGV0IGogPSBzdGFydCArIDE7XG4gICAgd2hpbGUgKGogPCBuKSB7XG4gICAgICBjb25zdCBjID0gc1tqXTtcbiAgICAgIGlmIChxdW90ZSA9PT0gXCInXCIpIHtcbiAgICAgICAgaWYgKGMgPT09IFwiJ1wiKSByZXR1cm4geyBvdXQsIG5leHQ6IGogKyAxIH07XG4gICAgICAgIG91dCArPSBjO1xuICAgICAgICBqICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcXFxcJyAmJiBqICsgMSA8IG4gJiYgJ1wiXFxcXCRgJy5pbmNsdWRlcyhzW2ogKyAxXSkpIHtcbiAgICAgICAgb3V0ICs9IHNbaiArIDFdO1xuICAgICAgICBqICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcIicpIHJldHVybiB7IG91dCwgbmV4dDogaiArIDEgfTtcbiAgICAgIG91dCArPSBjO1xuICAgICAgaiArPSAxO1xuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfTtcblxuICAvKipcbiAgICogQXBwZW5kIHRoZSByYXcgYXR0YWNoZWQtdGFyZ2V0IHRleHQgc3RhcnRpbmcgYXQgYHN0YXJ0YCB0byBgb3V0YCBcdTIwMTRcbiAgICogdmVyYmF0aW0sIHF1b3RlZCBzZWN0aW9ucyBzcGFubmluZyBzcGFjZXMgaW5jbHVkZWQgXHUyMDE0IHN0b3BwaW5nIGF0XG4gICAqIHdoaXRlc3BhY2Ugb3IgYW5vdGhlciByZWRpcmVjdCBvcGVyYXRvci4gUmV0dXJucyB0aGUgbmV4dCBpbmRleCwgb3IgbnVsbFxuICAgKiBvbiB1bmJhbGFuY2VkIHF1b3Rlcy5cbiAgICovXG4gIGNvbnN0IGFwcGVuZEF0dGFjaGVkVGFyZ2V0ID0gKG91dDogc3RyaW5nLCBzdGFydDogbnVtYmVyKTogeyBvdXQ6IHN0cmluZzsgbmV4dDogbnVtYmVyIH0gfCBudWxsID0+IHtcbiAgICBsZXQgaiA9IHN0YXJ0O1xuICAgIHdoaWxlIChqIDwgbikge1xuICAgICAgY29uc3QgYyA9IHNbal07XG4gICAgICBpZiAoL1xccy8udGVzdChjKSB8fCBjID09PSAnPCcgfHwgYyA9PT0gJz4nKSByZXR1cm4geyBvdXQsIG5leHQ6IGogfTtcbiAgICAgIGlmIChjID09PSBcIidcIiB8fCBjID09PSAnXCInKSB7XG4gICAgICAgIGNvbnN0IHNlY3Rpb24gPSBhcHBlbmRRdW90ZWRDb250ZW50KCcnLCBqKTtcbiAgICAgICAgaWYgKHNlY3Rpb24gPT09IG51bGwpIHJldHVybiBudWxsO1xuICAgICAgICBvdXQgKz0gcy5zbGljZShqLCBzZWN0aW9uLm5leHQpO1xuICAgICAgICBqID0gc2VjdGlvbi5uZXh0O1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnXFxcXCcgJiYgaiArIDEgPCBuKSB7XG4gICAgICAgIG91dCArPSBjICsgc1tqICsgMV07XG4gICAgICAgIGogKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBvdXQgKz0gYztcbiAgICAgIGogKz0gMTtcbiAgICB9XG4gICAgcmV0dXJuIHsgb3V0LCBuZXh0OiBqIH07XG4gIH07XG5cbiAgLyoqIEVtaXQgYSByZWRpcmVjdCB0b2tlbiB3aG9zZSB0ZXh0IHByZWZpeGVzIHRoZSBvcGVyYXRvciB3aXRoIHRoZSBjdXJyZW50IGRpZ2l0IGJ1ZmZlciAoYW4gSU9fTlVNQkVSIGxpa2UgYDI+YCkuICovXG4gIGNvbnN0IGVtaXRSZWRpcmVjdCA9IChvcGVyYXRvcjogc3RyaW5nLCBhdHRhY2hlZFN0YXJ0OiBudW1iZXIpOiBib29sZWFuID0+IHtcbiAgICBjb25zdCBhdHRhY2hlZCA9IGFwcGVuZEF0dGFjaGVkVGFyZ2V0KCcnLCBhdHRhY2hlZFN0YXJ0KTtcbiAgICBpZiAoYXR0YWNoZWQgPT09IG51bGwpIHJldHVybiBmYWxzZTtcbiAgICB0b2tlbnMucHVzaCh7IHRleHQ6IGJ1ZiArIG9wZXJhdG9yICsgYXR0YWNoZWQub3V0LCBxdW90ZWQ6IGZhbHNlLCBpc1JlZGlyZWN0OiB0cnVlIH0pO1xuICAgIGJ1ZiA9ICcnO1xuICAgIHF1b3RlZCA9IGZhbHNlO1xuICAgIGkgPSBhdHRhY2hlZC5uZXh0O1xuICAgIHJldHVybiB0cnVlO1xuICB9O1xuXG4gIHdoaWxlIChpIDwgbikge1xuICAgIGNvbnN0IGMgPSBzW2ldO1xuICAgIGlmICgvXFxzLy50ZXN0KGMpKSB7XG4gICAgICBmbHVzaFdvcmQoKTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gXCInXCIgfHwgYyA9PT0gJ1wiJykge1xuICAgICAgcXVvdGVkID0gdHJ1ZTtcbiAgICAgIGNvbnN0IHNlY3Rpb24gPSBhcHBlbmRRdW90ZWRDb250ZW50KGJ1ZiwgaSk7XG4gICAgICBpZiAoc2VjdGlvbiA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gICAgICBidWYgPSBzZWN0aW9uLm91dDtcbiAgICAgIGkgPSBzZWN0aW9uLm5leHQ7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIHtcbiAgICAgIHF1b3RlZCA9IHRydWU7XG4gICAgICBidWYgKz0gc1tpICsgMV07XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICc8JyB8fCBjID09PSAnPicpIHtcbiAgICAgIC8vIEEgYDxgL2A+YCBpcyBhIHJlZGlyZWN0IG9wZXJhdG9yIGF0IGEgd29yZCBib3VuZGFyeSwgb3IgYWZ0ZXIgYW5cbiAgICAgIC8vIElPX05VTUJFUiBkaWdpdCBydW4gKGAxPmAsIGAyPmApOyBtaWQtd29yZCBpdCBlbmRzIHRoZSBjdXJyZW50IHdvcmRcbiAgICAgIC8vIGZpcnN0IChgZWNobyBhPmJgIFx1MjE5MiB3b3JkcyBgZWNob2AsIGBhYDsgcmVkaXJlY3QgYD5iYCkuXG4gICAgICBpZiAoYnVmICE9PSAnJyAmJiAhL15cXGQrJC8udGVzdChidWYpKSBmbHVzaFdvcmQoKTtcbiAgICAgIGxldCBvcGVyYXRvcjogc3RyaW5nO1xuICAgICAgaWYgKGMgPT09ICc8Jykge1xuICAgICAgICBpZiAocy5zbGljZShpLCBpICsgMykgPT09ICc8PDwnKSBvcGVyYXRvciA9ICc8PDwnO1xuICAgICAgICBlbHNlIGlmIChzLnNsaWNlKGksIGkgKyAzKSA9PT0gJzw8LScpIG9wZXJhdG9yID0gJzw8LSc7XG4gICAgICAgIGVsc2UgaWYgKHMuc2xpY2UoaSwgaSArIDIpID09PSAnPDwnKSBvcGVyYXRvciA9ICc8PCc7XG4gICAgICAgIGVsc2Ugb3BlcmF0b3IgPSAnPCc7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBvcGVyYXRvciA9IHMuc2xpY2UoaSwgaSArIDIpID09PSAnPj4nID8gJz4+JyA6ICc+JztcbiAgICAgIH1cbiAgICAgIGlmICghZW1pdFJlZGlyZWN0KG9wZXJhdG9yLCBpICsgb3BlcmF0b3IubGVuZ3RoKSkgcmV0dXJuIG51bGw7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcmJykge1xuICAgICAgLy8gYCY+YC9gJj4+YCBcdTIwMTQgdGhlIHN0ZG91dCtzdGRlcnIgcmVkaXJlY3QgKGtlcHQgdG9nZXRoZXIgYnlcbiAgICAgIC8vIHNwbGl0VG9wTGV2ZWwpLiBBIGJhcmUgYCZgIGhlcmUgaXMgYW4gb3JkaW5hcnkgd29yZCBjaGFyIChgJjFgIGluXG4gICAgICAvLyBgMj4mMWAsIHdoaWNoIHRoZSBhdHRhY2hlZC10YXJnZXQgc2NhbiBhYm92ZSBjb25zdW1lZCBhbnl3YXkpLlxuICAgICAgaWYgKHNbaSArIDFdID09PSAnPicpIHtcbiAgICAgICAgZmx1c2hXb3JkKCk7XG4gICAgICAgIGNvbnN0IG9wZXJhdG9yID0gcy5zbGljZShpLCBpICsgMykgPT09ICcmPj4nID8gJyY+PicgOiAnJj4nO1xuICAgICAgICBpZiAoIWVtaXRSZWRpcmVjdChvcGVyYXRvciwgaSArIG9wZXJhdG9yLmxlbmd0aCkpIHJldHVybiBudWxsO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGJ1ZiArPSBjO1xuICAgIGkgKz0gMTtcbiAgfVxuICBmbHVzaFdvcmQoKTtcbiAgcmV0dXJuIHRva2Vucztcbn1cblxuLyoqXG4gKiBUaGUgYXR0YWNoZWQgdGFyZ2V0IG9mIGEgcmVkaXJlY3QgdG9rZW4sIG9yIG51bGwgd2hlbiB0aGUgb3BlcmF0b3IgaXNcbiAqIHN0YW5kYWxvbmUgKGA+YCB2cyBgPmZgOyBgMj5gIHZzIGAyPiYxYCkuIFNwbGl0cyBhbiBvcHRpb25hbCBJT19OVU1CRVJcbiAqIGRpZ2l0IHJ1biBvZmYgdGhlIGZyb250LCB0aGVuIHRoZSBvcGVyYXRvciwgbGVhdmluZyB0aGUgdGFyZ2V0LlxuICovXG5mdW5jdGlvbiByZWRpcmVjdEF0dGFjaGVkVGFyZ2V0KHRleHQ6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICBjb25zdCBtYXRjaCA9IHRleHQubWF0Y2goL14oXFxkKikoPDw8fDw8LXwmPj58PDx8Pj58Jj58PiZ8PHw+KSguKikkLyk7XG4gIGlmIChtYXRjaCA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IFssICwgLCByZXN0XSA9IG1hdGNoO1xuICByZXR1cm4gcmVzdC5sZW5ndGggPiAwID8gcmVzdCA6IG51bGw7XG59XG5cbi8qKiBCZXN0LWVmZm9ydCBhcmd2IGZvciBhIHNpbXBsZSBjb21tYW5kOiBsZWFkaW5nIGFzc2lnbm1lbnRzIHN0cmlwcGVkLCBxdW90ZS1hd2FyZSB0b2tlbnMgbWludXMgcmVkaXJlY3Qgb3BlcmF0b3JzIGFuZCB0aGVpciB0YXJnZXRzLiBSZXR1cm5zIG51bGwgaWYgdGhlIGNvbW1hbmQgZG9lc24ndCB0b2tlbml6ZSBjbGVhbmx5ICh1bmJhbGFuY2VkIHF1b3RlcykuICovXG5leHBvcnQgZnVuY3Rpb24gYXJndk9mKHNpbXBsZUNtZDogc3RyaW5nKTogc3RyaW5nW10gfCBudWxsIHtcbiAgY29uc3QgdG9rZW5zID0gdG9rZW5pemUoc3RyaXBMZWFkaW5nQXNzaWdubWVudHMoc2ltcGxlQ21kKS50cmltKCkpO1xuICBpZiAodG9rZW5zID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgYXJndjogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCB0b2tlbnMubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCB0b2tlbiA9IHRva2Vuc1tpXTtcbiAgICBpZiAoIXRva2VuLmlzUmVkaXJlY3QpIHtcbiAgICAgIGFyZ3YucHVzaCh0b2tlbi50ZXh0KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBBIHN0YW5kYWxvbmUgcmVkaXJlY3Qgb3BlcmF0b3IgY29uc3VtZXMgdGhlIG5leHQgdG9rZW4gYXMgaXRzIHRhcmdldDtcbiAgICAvLyBhbiBhdHRhY2hlZCBmb3JtIChgPmZgLCBgPj5mYCkgaXMgc2VsZi1jb250YWluZWQuXG4gICAgaWYgKHJlZGlyZWN0QXR0YWNoZWRUYXJnZXQodG9rZW4udGV4dCkgPT09IG51bGwpIGkgKz0gMTtcbiAgfVxuICByZXR1cm4gYXJndjtcbn1cbiIsICIvKipcbiAqIFRoZSByYW5nZS1wcmVzZXJ2aW5nIHVuaWZpZWQtZGlmZiBwYXJzZXIgKHBsYW4gXHUwMEE3NS43KSwgc2libGluZyB0b1xuICogbWVjaGFuaWNhbC1jaGFuZ2UudHMncyByYW5nZS1sZXNzIGBwYXJzZVVuaWZpZWREaWZmYC4gVGhlIHBhdGNoL2dpdCBhcHBseVxuICogZ3JhbW1hciBuZWVkcyB0aGUgYEBAIC1hLGIgK2MsZCBAQGAgaHVuayBudW1iZXJzIHRoYXQgcGFyc2VVbmlmaWVkRGlmZlxuICogZGlzY2FyZHMsIHNvIHRoaXMgcGFyc2VzIHRoZSBzYW1lIGhlYWRlciBkaWFsZWN0IGZyb20gc2NyYXRjaC5cbiAqXG4gKiBBIGh1bmsgd2hvc2UgcHJlL3Bvc3QgbGluZSBjb3VudHMgbWF0Y2ggcHJlc2VydmVzIGxpbmUgY29vcmRpbmF0ZXMsIHNvIGFcbiAqIGZpbGUgd2hvc2UgaHVua3MgYXJlIGFsbCBjb3VudC1wcmVzZXJ2aW5nIGdldHMgYW4gZXhhY3QgcmFuZ2UgXHUyMDE0IHRoZSB1bmlvbiBvZlxuICogZXZlcnkgaHVuaydzIHJlZ2lvbi4gQW55IGNvdW50LWNoYW5naW5nIGh1bmsgKHB1cmUgYWRkLCBwdXJlIGRlbGV0ZSwgdW5lcXVhbFxuICogY291bnRzKSBkZWdyYWRlcyB0aGUgZmlsZSB0byBhIHdob2xlLWZpbGUgbW9kaWZ5OiBwb3NpdGlvbnMgYmVsb3cgaXQgc2hpZnQsXG4gKiBhbmQgYSBkZWxldGVkIGxpbmUgb2NjdXBpZXMgbm8gcG9zdC1lZGl0IHJhbmdlIGF0IGFsbC5cbiAqXG4gKiBQZXItZmlsZSBjbGFzc2lmaWNhdGlvbnM6IGBuZXcgZmlsZSBtb2RlYCBcdTIxOTIgY3JlYXRlLW92ZXJ3cml0ZTsgYGRlbGV0ZWQgZmlsZVxuICogbW9kZWAgXHUyMTkyIGRlbGV0ZTsgYHJlbmFtZSBmcm9tYC9gcmVuYW1lIHRvYCBcdTIxOTIgc291cmNlIGRlbGV0ZSArIGRlc3RcbiAqIHJlbmFtZS1jb3B5OyBiaW5hcnkgZGlmZnMgXHUyMTkyIHdob2xlLWZpbGUgbW9kaWZ5OyBhIGArKysgL2Rldi9udWxsYCB0YXJnZXQgKHRoZVxuICogc2hhcGUgYGRpZmYgLXVgLWZvcm1hdCBkZWxldGlvbnMgdGFrZSkgXHUyMTkyIGRlbGV0ZSwgYW5kIGEgYC0tLSAvZGV2L251bGxgIHNpZGVcbiAqICh0aGUgYGRpZmYgLXVgLWZvcm1hdCBjcmVhdGlvbiBzaGFwZSwgd2l0aCBubyBgbmV3IGZpbGUgbW9kZWAgaGVhZGVyKSBcdTIxOTJcbiAqIGNyZWF0ZS1vdmVyd3JpdGUuXG4gKlxuICogR2l0LXN0eWxlIGBhL1x1MjAyNmAvYGIvXHUyMDI2YCBwcmVmaXhlcyBhcmUgc3RyaXBwZWQgcGVyIHRoZSBjYWxsZXIncyBgLXBOYCBzdHJpcFxuICogbGV2ZWw6IGEgbnVtYmVyIHN0cmlwcyB0aGF0IG1hbnkgbGVhZGluZyBwYXRoIGNvbXBvbmVudHMsIGFuZCBgJ2F1dG8nYFxuICogKHBhdGNoJ3MgZGVmYXVsdCkgc3RyaXBzIG9uZSB3aGVuIHRoZSBwYXRoIGlzIGEvLSBvciBiLy1wcmVmaXhlZCBhbmQgbm9uZVxuICogb3RoZXJ3aXNlLiBgL2Rldi9udWxsYCBpcyBjaGVja2VkIGJlZm9yZSBzdHJpcHBpbmcgXHUyMDE0IHRoZSBoZWFkZXIgbWFya2VyXG4gKiB3b3VsZCBvdGhlcndpc2UgbG9zZSBpdHMgYGRldi9gIGNvbXBvbmVudC5cbiAqXG4gKiBgZGlmZiAtdWAgaGVhZGVycyBjYXJyeSBhIHRhYi1zZXBhcmF0ZWQgdGltZXN0YW1wIChgLS0tIGYudHh0XFx0MjAyNC0wMS0wMVxuICogMDA6MDA6MDBgKSBhbmQgbWF5IGJlIENSTEYtdGVybWluYXRlZDsgYm90aCBhcmUgc3RyaXBwZWQgYmVmb3JlIHBhdGhcbiAqIHJlc29sdXRpb24uIFRoZSB0YXJnZXQgb2YgYSBtb2RpZnkgaHVuayBpcyB0aGUgYC0tLWAgc2lkZTogcGF0Y2ggYW5kIGdpdFxuICogYXBwbHkgcmV3cml0ZSB0aGUgZmlsZSBuYW1lZCB0aGVyZSAoZm9yIGBkaWZmIC11IGYudHh0IGYubmV3YCwgdGhlIGArKytgXG4gKiBzaWRlIGlzIG9ubHkgYSBsYWJlbCksIHNvIHRoZSBgKysrYCBsaW5lIG92ZXJyaWRlcyB0aGUgcGF0aCBvbmx5IGZvciB0aGVcbiAqIGAvZGV2L251bGxgIG1hcmtlcnMgXHUyMDE0IGEgYC0tLSAvZGV2L251bGxgIHNpZGUgKGEgbmV3IGZpbGUpIG5hbWVzIHRoZSB0YXJnZXRcbiAqIG9uIGArKytgLCBhbmQgYSBgKysrIC9kZXYvbnVsbGAgc2lkZSBtYXJrcyBhIGRlbGV0aW9uLlxuICpcbiAqIE1hbGZvcm1lZCBvciBlbXB0eSBwYXRjaCB0ZXh0IHJldHVybnMgbnVsbCAoZmFpbCBjbG9zZWQgXHUyMDE0IHRoZSBjYWxsZXIgZW1pdHNcbiAqIHVucmVzb2x2ZWQgcmF0aGVyIHRoYW4gZ3Vlc3NpbmcgYXQgdGFyZ2V0cykuXG4gKi9cblxuLyoqIFRoZSBgLXBOYCBoZWFkZXIgc3RyaXAgbGV2ZWw6IGEgY29tcG9uZW50IGNvdW50LCBvciBwYXRjaCdzIGAnYXV0bydgIGRlZmF1bHQuICovXG5leHBvcnQgdHlwZSBQYXRoU3RyaXAgPSBudW1iZXIgfCAnYXV0byc7XG5cbi8qKiBPbmUgZmlsZSBhIHBhdGNoIHRvdWNoZXM6IHRoZSB0YXJnZXQgcGF0aCwgdGhlIHRvdWNoIGtpbmQsIGFuZCB0aGUgZXhhY3QgcmFuZ2Ugd2hlbiB0aGUgaHVua3MgcHJlc2VydmUgbGluZSBjb3VudHMuICovXG5leHBvcnQgaW50ZXJmYWNlIFVuaWZpZWREaWZmVGFyZ2V0IHtcbiAgcGF0aDogc3RyaW5nO1xuICBvcGVyYXRpb246ICdtb2RpZnknIHwgJ2NyZWF0ZS1vdmVyd3JpdGUnIHwgJ2RlbGV0ZScgfCAncmVuYW1lLWNvcHknO1xuICBsaW5lU3RhcnQ/OiBudW1iZXI7XG4gIGxpbmVFbmQ/OiBudW1iZXI7XG59XG5cbmNvbnN0IEhVTktfSEVBREVSID0gL15AQCAtKFxcZCspKD86LChcXGQrKSk/IFxcKyhcXGQrKSg/OiwoXFxkKykpPyBAQC87XG5cbi8qKiBTdHJpcCB0aGUgZmlyc3QgYG5gIGxlYWRpbmcgcGF0aCBjb21wb25lbnRzIChgLXBOYCksIHN0b3BwaW5nIGF0IGEgY29tcG9uZW50LWxlc3MgcGF0aC4gKi9cbmZ1bmN0aW9uIHN0cmlwUGF0aENvbXBvbmVudHMocDogc3RyaW5nLCBuOiBudW1iZXIpOiBzdHJpbmcge1xuICBsZXQgcyA9IHA7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgbjsgaSsrKSB7XG4gICAgY29uc3Qgc2xhc2ggPSBzLmluZGV4T2YoJy8nKTtcbiAgICBpZiAoc2xhc2ggPT09IC0xKSByZXR1cm4gcztcbiAgICBzID0gcy5zbGljZShzbGFzaCArIDEpO1xuICB9XG4gIHJldHVybiBzO1xufVxuXG4vKipcbiAqIFRoZSBsZXZlbCB0byBzdHJpcCBmcm9tIGByYXdgIHVuZGVyIGBzdHJpcGA6IGEgbnVtYmVyIHBhc3NlcyB0aHJvdWdoOyBgJ2F1dG8nYFxuICogcmVzb2x2ZXMgdG8gcDEgd2hlbiB0aGUgcGF0aCBpcyBgYS9gL2BiL2AtcHJlZml4ZWQgYW5kIHAwIG90aGVyd2lzZSBcdTIwMTQgcGF0Y2gnc1xuICogZGVmYXVsdCBmb3IgZGlmZnMgd2hvc2UgcHJlZml4ZXMgYXJlIGBkaWZmIC11YC1zdHlsZSByYXRoZXIgdGhhbiBnaXQncy5cbiAqL1xuZnVuY3Rpb24gc3RyaXBMZXZlbEZvcihyYXc6IHN0cmluZywgc3RyaXA6IFBhdGhTdHJpcCk6IG51bWJlciB7XG4gIHJldHVybiBzdHJpcCA9PT0gJ2F1dG8nID8gKHJhdy5zdGFydHNXaXRoKCdhLycpIHx8IHJhdy5zdGFydHNXaXRoKCdiLycpID8gMSA6IDApIDogc3RyaXA7XG59XG5cbi8qKlxuICogVGhlIHJhdyBgLS0tYC9gKysrYCBoZWFkZXIgcGF0aDogdGhlIHRleHQgdXAgdG8gdGhlIGZpcnN0IHRhYiAodGhlXG4gKiBgZGlmZiAtdWAgdGltZXN0YW1wIGNvbHVtbiksIG9yIHRoZSB3aG9sZSB3b3JkIHdoZW4gdGhlcmUgaXMgbm9uZS4gQ1JMRlxuICogaXMgaGFuZGxlZCBhdCB0aGUgbGluZSBsZXZlbCAoc2VlIHBhcnNlVW5pZmllZERpZmZSYW5nZSksIHdoaWNoIGFsc29cbiAqIGNvdmVycyBodW5rIGhlYWRlcnMuXG4gKi9cbmZ1bmN0aW9uIGhlYWRlclBhdGhUZXh0KHJhdzogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdGFiID0gcmF3LmluZGV4T2YoJ1xcdCcpO1xuICByZXR1cm4gdGFiID09PSAtMSA/IHJhdyA6IHJhdy5zbGljZSgwLCB0YWIpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VVbmlmaWVkRGlmZlJhbmdlKHBhdGNoVGV4dDogc3RyaW5nLCBzdHJpcDogUGF0aFN0cmlwKTogVW5pZmllZERpZmZUYXJnZXRbXSB8IG51bGwge1xuICBjb25zdCByZXN1bHRzOiBVbmlmaWVkRGlmZlRhcmdldFtdID0gW107XG4gIGxldCBzYXdCbG9jayA9IGZhbHNlO1xuICBsZXQgY3VycmVudDoge1xuICAgIHBhdGg6IHN0cmluZztcbiAgICBraW5kOiAnbW9kaWZ5JyB8ICduZXcnIHwgJ2RlbGV0ZWQnO1xuICAgIGh1bmtzOiBBcnJheTx7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIH0+O1xuICAgIGNvdW50Q2hhbmdpbmc6IGJvb2xlYW47XG4gIH0gfCBudWxsID0gbnVsbDtcbiAgbGV0IHBlbmRpbmdLaW5kOiAnbmV3JyB8ICdkZWxldGVkJyB8IG51bGwgPSBudWxsO1xuICBsZXQgcmVuYW1lRnJvbTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCByZW5hbWVUbzogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGxldCBiaW5hcnkgPSBmYWxzZTtcblxuICAvKiogVGhlIGhlYWRlciBwYXRoLCB0YWIvQ1Itc3RyaXBwZWQsIHdpdGggdGhlIGAtcE5gIGxldmVsIGFwcGxpZWQgXHUyMDE0IGAvZGV2L251bGxgIGtlcHQgdmVyYmF0aW0gKHRoZSBtYXJrZXIgaXMgbmV2ZXIgYSByZWFsIHBhdGgpLiAqL1xuICBjb25zdCBzdHJpcHBlZCA9IChyYXc6IHN0cmluZyk6IHN0cmluZyA9PiB7XG4gICAgY29uc3QgdGV4dCA9IGhlYWRlclBhdGhUZXh0KHJhdyk7XG4gICAgaWYgKHRleHQgPT09ICcvZGV2L251bGwnKSByZXR1cm4gdGV4dDtcbiAgICByZXR1cm4gc3RyaXBQYXRoQ29tcG9uZW50cyh0ZXh0LCBzdHJpcExldmVsRm9yKHRleHQsIHN0cmlwKSk7XG4gIH07XG5cbiAgY29uc3QgZmluaXNoID0gKCk6IHZvaWQgPT4ge1xuICAgIGlmIChjdXJyZW50ICE9PSBudWxsKSB7XG4gICAgICBpZiAoY3VycmVudC5raW5kID09PSAnbmV3JykgcmVzdWx0cy5wdXNoKHsgcGF0aDogY3VycmVudC5wYXRoLCBvcGVyYXRpb246ICdjcmVhdGUtb3ZlcndyaXRlJyB9KTtcbiAgICAgIGVsc2UgaWYgKGN1cnJlbnQua2luZCA9PT0gJ2RlbGV0ZWQnKSByZXN1bHRzLnB1c2goeyBwYXRoOiBjdXJyZW50LnBhdGgsIG9wZXJhdGlvbjogJ2RlbGV0ZScgfSk7XG4gICAgICBlbHNlIGlmIChiaW5hcnkpIHJlc3VsdHMucHVzaCh7IHBhdGg6IGN1cnJlbnQucGF0aCwgb3BlcmF0aW9uOiAnbW9kaWZ5JyB9KTtcbiAgICAgIGVsc2UgaWYgKGN1cnJlbnQuaHVua3MubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIC8vIEEgaGVhZGVyLW9ubHkgYmxvY2sgd2l0aCBubyBodW5rczogbm90aGluZyBzdGF0aWNhbGx5IGtub3duLlxuICAgICAgfSBlbHNlIGlmIChjdXJyZW50LmNvdW50Q2hhbmdpbmcpIHJlc3VsdHMucHVzaCh7IHBhdGg6IGN1cnJlbnQucGF0aCwgb3BlcmF0aW9uOiAnbW9kaWZ5JyB9KTtcbiAgICAgIGVsc2Uge1xuICAgICAgICBjb25zdCBzdGFydCA9IE1hdGgubWluKC4uLmN1cnJlbnQuaHVua3MubWFwKChoKSA9PiBoLnN0YXJ0KSk7XG4gICAgICAgIGNvbnN0IGVuZCA9IE1hdGgubWF4KC4uLmN1cnJlbnQuaHVua3MubWFwKChoKSA9PiBoLmVuZCkpO1xuICAgICAgICByZXN1bHRzLnB1c2goeyBwYXRoOiBjdXJyZW50LnBhdGgsIG9wZXJhdGlvbjogJ21vZGlmeScsIGxpbmVTdGFydDogc3RhcnQsIGxpbmVFbmQ6IGVuZCB9KTtcbiAgICAgIH1cbiAgICAgIGN1cnJlbnQgPSBudWxsO1xuICAgIH1cbiAgICBpZiAocmVuYW1lRnJvbSAhPT0gbnVsbCkgcmVzdWx0cy5wdXNoKHsgcGF0aDogcmVuYW1lRnJvbSwgb3BlcmF0aW9uOiAnZGVsZXRlJyB9KTtcbiAgICBpZiAocmVuYW1lVG8gIT09IG51bGwpIHJlc3VsdHMucHVzaCh7IHBhdGg6IHJlbmFtZVRvLCBvcGVyYXRpb246ICdyZW5hbWUtY29weScgfSk7XG4gICAgcmVuYW1lRnJvbSA9IG51bGw7XG4gICAgcmVuYW1lVG8gPSBudWxsO1xuICAgIGJpbmFyeSA9IGZhbHNlO1xuICB9O1xuXG4gIGZvciAoY29uc3QgcmF3TGluZSBvZiBwYXRjaFRleHQuc3BsaXQoJ1xcbicpKSB7XG4gICAgLy8gQSB0cmFpbGluZyBgXFxyYCAoQ1JMRiBwYXRjaCB0ZXh0IFx1MjAxNCBXaW5kb3dzLWF1dGhvcmVkIGRpZmZzKSBwb2xsdXRlc1xuICAgIC8vIGhlYWRlcnMsIGh1bmsgaGVhZGVycywgYW5kIHBhdGggbGluZXMgYWxpa2U7IGJvdGggcGF0Y2ggYW5kIGdpdCBhcHBseVxuICAgIC8vIHN0cmlwIGl0LCBzbyB0aGUgcGFyc2VyIGRvZXMgdG9vLlxuICAgIGNvbnN0IGxpbmUgPSByYXdMaW5lLmVuZHNXaXRoKCdcXHInKSA/IHJhd0xpbmUuc2xpY2UoMCwgLTEpIDogcmF3TGluZTtcbiAgICBpZiAobGluZS5zdGFydHNXaXRoKCctLS0gJykpIHtcbiAgICAgIHNhd0Jsb2NrID0gdHJ1ZTtcbiAgICAgIGlmIChjdXJyZW50ICE9PSBudWxsKSBmaW5pc2goKTtcbiAgICAgIGN1cnJlbnQgPSB7XG4gICAgICAgIHBhdGg6IHN0cmlwcGVkKGxpbmUuc2xpY2UoNCkpLFxuICAgICAgICBraW5kOiBwZW5kaW5nS2luZCA/PyAnbW9kaWZ5JyxcbiAgICAgICAgaHVua3M6IFtdLFxuICAgICAgICBjb3VudENoYW5naW5nOiBmYWxzZVxuICAgICAgfTtcbiAgICAgIHBlbmRpbmdLaW5kID0gbnVsbDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZS5zdGFydHNXaXRoKCcrKysgJykpIHtcbiAgICAgIHNhd0Jsb2NrID0gdHJ1ZTtcbiAgICAgIGNvbnN0IHBhdGggPSBzdHJpcHBlZChsaW5lLnNsaWNlKDQpKTtcbiAgICAgIGlmIChjdXJyZW50ID09PSBudWxsKSBjdXJyZW50ID0geyBwYXRoLCBraW5kOiBwZW5kaW5nS2luZCA/PyAnbW9kaWZ5JywgaHVua3M6IFtdLCBjb3VudENoYW5naW5nOiBmYWxzZSB9O1xuICAgICAgZWxzZSBpZiAocGF0aCA9PT0gJy9kZXYvbnVsbCcpIGN1cnJlbnQua2luZCA9ICdkZWxldGVkJztcbiAgICAgIGVsc2UgaWYgKGN1cnJlbnQucGF0aCA9PT0gJy9kZXYvbnVsbCcpIHtcbiAgICAgICAgLy8gQSBgLS0tIC9kZXYvbnVsbGAgc2lkZSByZXBsYWNlZCBieSBhIHJlYWwgYCsrK2AgcGF0aCBpcyBhIG5ldyBmaWxlXG4gICAgICAgIC8vICh0aGUgYGRpZmYgLXVgLWZvcm1hdCBjcmVhdGlvbiBzaGFwZSBcdTIwMTQgbm8gYG5ldyBmaWxlIG1vZGVgIGhlYWRlcikuXG4gICAgICAgIC8vIEl0cyBgQEAgLTAsMCArTiBAQGAgaHVuayBoYXMgbm8gcHJlLWVkaXQgbGluZXMsIHNvIHRoZVxuICAgICAgICAvLyBjcmVhdGUtb3ZlcndyaXRlIGlzIGRlY2lkZWQgaGVyZSwgbm90IGZyb20gaHVuayBjb3ZlcmFnZS5cbiAgICAgICAgY3VycmVudC5wYXRoID0gcGF0aDtcbiAgICAgICAgY3VycmVudC5raW5kID0gJ25ldyc7XG4gICAgICB9XG4gICAgICAvLyBPdGhlcndpc2Uga2VlcCB0aGUgYC0tLWAgc2lkZTogcGF0Y2ggYW5kIGdpdCBhcHBseSByZXdyaXRlIHRoZSBmaWxlXG4gICAgICAvLyBuYW1lZCBvbiB0aGUgYC0tLWAgbGluZSwgYW5kIGBkaWZmIC11IGYgZi5uZXdgIGhlYWRlcnMgbmFtZSB0aGVcbiAgICAgIC8vIHByZS1pbWFnZSB0aGVyZSBcdTIwMTQgdGhlIGArKytgIHBhdGggaXMgb25seSBhIGxhYmVsICh0aGUgZGlmZi11dVxuICAgICAgLy8gcGF0Y2gtaGVhZGVyIG1pc3MpLlxuICAgICAgcGVuZGluZ0tpbmQgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChsaW5lLnN0YXJ0c1dpdGgoJ25ldyBmaWxlIG1vZGUnKSkge1xuICAgICAgcGVuZGluZ0tpbmQgPSAnbmV3JztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZS5zdGFydHNXaXRoKCdkZWxldGVkIGZpbGUgbW9kZScpKSB7XG4gICAgICBwZW5kaW5nS2luZCA9ICdkZWxldGVkJztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAobGluZS5zdGFydHNXaXRoKCdyZW5hbWUgZnJvbSAnKSkge1xuICAgICAgc2F3QmxvY2sgPSB0cnVlO1xuICAgICAgaWYgKGN1cnJlbnQgIT09IG51bGwpIGZpbmlzaCgpO1xuICAgICAgcmVuYW1lRnJvbSA9IHN0cmlwcGVkKGxpbmUuc2xpY2UoJ3JlbmFtZSBmcm9tICcubGVuZ3RoKSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGxpbmUuc3RhcnRzV2l0aCgncmVuYW1lIHRvICcpKSB7XG4gICAgICBzYXdCbG9jayA9IHRydWU7XG4gICAgICByZW5hbWVUbyA9IHN0cmlwcGVkKGxpbmUuc2xpY2UoJ3JlbmFtZSB0byAnLmxlbmd0aCkpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChsaW5lLnN0YXJ0c1dpdGgoJ0JpbmFyeSBmaWxlcyAnKSB8fCBsaW5lLnN0YXJ0c1dpdGgoJ0dJVCBiaW5hcnkgcGF0Y2gnKSkge1xuICAgICAgc2F3QmxvY2sgPSB0cnVlO1xuICAgICAgYmluYXJ5ID0gdHJ1ZTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBodW5rID0gbGluZS5tYXRjaChIVU5LX0hFQURFUik7XG4gICAgaWYgKGh1bmspIHtcbiAgICAgIHNhd0Jsb2NrID0gdHJ1ZTtcbiAgICAgIGNvbnN0IHByZVN0YXJ0ID0gTnVtYmVyLnBhcnNlSW50KGh1bmtbMV0sIDEwKTtcbiAgICAgIGNvbnN0IHByZUNvdW50ID0gaHVua1syXSA9PT0gdW5kZWZpbmVkID8gMSA6IE51bWJlci5wYXJzZUludChodW5rWzJdLCAxMCk7XG4gICAgICBjb25zdCBwb3N0Q291bnQgPSBodW5rWzRdID09PSB1bmRlZmluZWQgPyAxIDogTnVtYmVyLnBhcnNlSW50KGh1bmtbNF0sIDEwKTtcbiAgICAgIGlmIChjdXJyZW50ID09PSBudWxsKSByZXR1cm4gbnVsbDsgLy8gYSBodW5rIHdpdGhvdXQgYSBmaWxlIGhlYWRlciBcdTIxOTIgbWFsZm9ybWVkXG4gICAgICBpZiAocHJlQ291bnQgIT09IHBvc3RDb3VudCkgY3VycmVudC5jb3VudENoYW5naW5nID0gdHJ1ZTtcbiAgICAgIGlmIChwcmVDb3VudCA+IDApIGN1cnJlbnQuaHVua3MucHVzaCh7IHN0YXJ0OiBwcmVTdGFydCwgZW5kOiBwcmVTdGFydCArIHByZUNvdW50IC0gMSB9KTtcbiAgICB9XG4gIH1cbiAgZmluaXNoKCk7XG4gIHJldHVybiBzYXdCbG9jayA/IHJlc3VsdHMgOiBudWxsO1xufVxuIiwgIi8qKlxuICogQ2xhdWRlIFBvc3RUb29sVXNlIHRvdWNoIGhvb2sgXHUyMDE0IHRoaW4gU0RLLWJvdW5kIGVudHJ5IHBvaW50LlxuICpcbiAqIEZpcmVzIGFmdGVyIGEgc3VjY2Vzc2Z1bCBgUmVhZGAvYEVkaXRgL2BXcml0ZWAsIG9yIGEgYEJhc2hgIGNhbGwgd2hvc2VcbiAqIGBjb21tYW5kYCBzdGF0aWNhbGx5IHJlc29sdmVzIHRvIHJlY29nbml6YWJsZSBmaWxlK2xpbmUtcmFuZ2UgaWRpb21zLiBUaGVcbiAqIENsYXVkZS1zcGVjaWZpYyBqb2IgaXMgdHJhbnNsYXRpbmcgdGhlIHN0cnVjdHVyZWQgYHRvb2xfaW5wdXRgXG4gKiAoYGZpbGVfcGF0aGAsIGBuZXdfc3RyaW5nYC9gY29udGVudGAsIGBvZmZzZXRgL2BsaW1pdGApIGFuZCBgdG9vbF9uYW1lYCBpbnRvXG4gKiBhIGhhcm5lc3MtYWdub3N0aWMge0BsaW5rIFRvdWNoSW5wdXR9LCB0aGVuIGhhbmRpbmcgb2ZmIHRvIHRoZSBzaGFyZWRcbiAqIHtAbGluayBydW5Ub3VjaEhvb2t9IGNvcmU6IG9uIGEgd3JpdGUgaXQgaGVhbHNcbiAqIHBvc2l0aW9uYWwgc3BhbiBkcmlmdCBpbiB0aGUgd29ya2luZyB0cmVlIChgZ2l0IHNwYW4gZHJpZnQgPGZpbGU+IC0tZml4YCkgYW5kXG4gKiBmb2xkcyBhbnkgc2VtYW50aWMgcmVzaWR1ZSBpbnRvIG9uZSBgPGdpdC1zcGFuPmAgYmxvY2s7IG9uIGEgcmVhZCBpdCBzdXJmYWNlc1xuICogc3BhbnMgb3ZlcmxhcHBpbmcgdGhlIHJlYWQncyBgb2Zmc2V0YC9gbGltaXRgIHdpbmRvdyAod2hvbGUtZmlsZSB3aGVuIG5laXRoZXJcbiAqIGlzIGdpdmVuKSB3aXRoIHBvc2l0aW9uYWwgc3RhdHVzZXMgZmlsdGVyZWQgb3V0LCBhbmQgbmV2ZXIgbXV0YXRlcyB0aGUgdHJlZS5cbiAqXG4gKiBUaGUgYmxvY2sgcmVhY2hlcyB0aGUgbW9kZWwgbG9vcCB2aWEgYGhvb2tTcGVjaWZpY091dHB1dC5hZGRpdGlvbmFsQ29udGV4dGAgYW5kXG4gKiB0aGUgdXNlci1mYWNpbmcgVUkgdmlhIGBzeXN0ZW1NZXNzYWdlYC4gRmFpbC1vcGVuIGlzIGxvYWQtYmVhcmluZzogYW4gYWJzZW50XG4gKiBDTEkvYC5zcGFuL2AsIHRpbWVvdXQsIG9yIG5vbi16ZXJvIGV4aXQgeWllbGRzIG5vIHNpZ25hbCBhbmQgbmV2ZXIgYmxvY2tzIHRoZVxuICogdG9vbCBjYWxsLiBUaGUgdGltZW91dCBpcyBtaWxsaXNlY29uZHMgaGVyZSAodGhlIENsYXVkZSBDTEkgZW1pdHMgbXMgaW50b1xuICogYGhvb2tzLmpzb25gKTsgQ29kZXgncyBlcXVpdmFsZW50IHNvdXJjZSB2YWx1ZSBpcyBkaXZpZGVkIHRvIHNlY29uZHMgYXQgZW1pdC5cbiAqL1xuXG5pbXBvcnQge1xuICB0eXBlIEhvb2tDb250ZXh0LFxuICB0eXBlIFBvc3RUb29sVXNlSW5wdXQsXG4gIHBvc3RUb29sVXNlSG9vayxcbiAgcG9zdFRvb2xVc2VPdXRwdXRcbn0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbmltcG9ydCB7IGRlcml2ZVBhdGggfSBmcm9tICcuLi9jb21tb24vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcbmltcG9ydCB7IGJhc2hSZXNwb25zZUludGVycnVwdGVkLCBydW5CYXNoVG91Y2hlcyB9IGZyb20gJy4uL2NvbW1vbi9iYXNoLXRvdWNoLmpzJztcbmltcG9ydCB7IHBhcnNlQ29tbWFuZERldGFpbGVkIH0gZnJvbSAnLi4vY29tbW9uL3BhcnNlLWNvbW1hbmQuanMnO1xuaW1wb3J0IHsgY3JlYXRlRGlza01lbW9TdG9yZSwgdHlwZSBNZW1vRmFjdG9yeSwgcmVzb2x2ZVRvdWNoU2NvcGUgfSBmcm9tICcuLi9jb21tb24vc3Bhbi1zdXJmYWNlLmpzJztcbmltcG9ydCB7XG4gIGNyZWF0ZURlZmF1bHRUb3VjaEV4ZWN1dG9ycyxcbiAgcnVuVG91Y2hIb29rLFxuICB0eXBlIFRvdWNoRXhlY3V0b3JzLFxuICB0eXBlIFRvdWNoSW5wdXRcbn0gZnJvbSAnLi4vY29tbW9uL3RvdWNoLWNvcmUuanMnO1xuXG50eXBlIFRvb2xJbnB1dCA9IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuXG4vKiogUmVhZCBhIGBUb29sSW5wdXRgIGZpZWxkIGFzIGEgcG9zaXRpdmUgaW50ZWdlciwgb3IgYHVuZGVmaW5lZGAgd2hlbiBhYnNlbnQvaW52YWxpZC4gKi9cbmZ1bmN0aW9uIHBvc2l0aXZlSW50RmllbGQodG9vbElucHV0OiBUb29sSW5wdXQsIGZpZWxkOiBzdHJpbmcpOiBudW1iZXIgfCB1bmRlZmluZWQge1xuICBjb25zdCByYXcgPSB0b29sSW5wdXRbZmllbGRdO1xuICByZXR1cm4gdHlwZW9mIHJhdyA9PT0gJ251bWJlcicgJiYgTnVtYmVyLmlzSW50ZWdlcihyYXcpICYmIHJhdyA+IDAgPyByYXcgOiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogVHJhbnNsYXRlIGEgQ2xhdWRlIHRvb2wgY2FsbCBpbnRvIGEge0BsaW5rIFRvdWNoSW5wdXR9LiBgUmVhZGAgaXMgYSByZWFkIHRvdWNoXG4gKiBjYXJyeWluZyBpdHMgYG9mZnNldGAvYGxpbWl0YCAod2hlbiBwcmVzZW50KSBmb3IgcmFuZ2UtcHJlY2lzZSBzY29waW5nO1xuICogYEVkaXRgL2BXcml0ZWAgYXJlIHdyaXRlIHRvdWNoZXMgd2hvc2UgYHdyaXR0ZW5gIGJsb2NrIGlzIHRoZSBuZXcgY29udGVudCB0aGVcbiAqIHRvb2wganVzdCBhcHBsaWVkIChgbmV3X3N0cmluZ2AgZm9yIEVkaXQsIGBjb250ZW50YCBmb3IgV3JpdGUpLiBBbiB1bmtub3duIHRvb2xcbiAqIG9yIGEgbm9uLXN0cmluZyBjb250ZW50IGZpZWxkIHlpZWxkcyBgbnVsbGAgKG5vdGhpbmcgdG8gZG8pLlxuICovXG5mdW5jdGlvbiB0b1RvdWNoSW5wdXQoXG4gIHRvb2xOYW1lOiBzdHJpbmcsXG4gIHRvb2xJbnB1dDogVG9vbElucHV0LFxuICBzZXNzaW9uSWQ6IHN0cmluZyxcbiAgY3dkOiBzdHJpbmcsXG4gIGZpbGVQYXRoOiBzdHJpbmdcbik6IFRvdWNoSW5wdXQgfCBudWxsIHtcbiAgaWYgKHRvb2xOYW1lID09PSAnUmVhZCcpIHtcbiAgICBjb25zdCBvZmZzZXQgPSBwb3NpdGl2ZUludEZpZWxkKHRvb2xJbnB1dCwgJ29mZnNldCcpO1xuICAgIGNvbnN0IGxpbWl0ID0gcG9zaXRpdmVJbnRGaWVsZCh0b29sSW5wdXQsICdsaW1pdCcpO1xuICAgIHJldHVybiB7IGtpbmQ6ICdyZWFkJywgc2Vzc2lvbklkLCBjd2QsIGZpbGVQYXRoLCBvZmZzZXQsIGxpbWl0IH07XG4gIH1cbiAgaWYgKHRvb2xOYW1lID09PSAnRWRpdCcgfHwgdG9vbE5hbWUgPT09ICdXcml0ZScpIHtcbiAgICBjb25zdCByYXcgPSB0b29sTmFtZSA9PT0gJ0VkaXQnID8gdG9vbElucHV0Lm5ld19zdHJpbmcgOiB0b29sSW5wdXQuY29udGVudDtcbiAgICBjb25zdCB3cml0dGVuID0gdHlwZW9mIHJhdyA9PT0gJ3N0cmluZycgPyByYXcgOiAnJztcbiAgICAvLyBUaGUgRWRpdC9Xcml0ZSBwYXRoIHBhc3NlcyAnZXhpc3RzJyBcdTIwMTQgdGhlIHRvb2wgcmFuLCBzbyB0aGUgZmlsZSBpc1xuICAgIC8vIHByZXNlbnQ7IHRoZSB3cml0ZSBnYXRlIChwbGFuIFx1MDBBNzMgc3RlcCAxKSB2ZXJpZmllcyBpdCBiZWZvcmUgYW55XG4gICAgLy8gZXhlY3V0b3IgY2FsbC5cbiAgICByZXR1cm4geyBraW5kOiAnd3JpdGUnLCBzZXNzaW9uSWQsIGN3ZCwgZmlsZVBhdGgsIHdyaXR0ZW4sIHRhcmdldFN0YXRlOiAnZXhpc3RzJyB9O1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlSGFuZGxlcihcbiAgZXhlY3V0b3JzOiBUb3VjaEV4ZWN1dG9ycyA9IGNyZWF0ZURlZmF1bHRUb3VjaEV4ZWN1dG9ycygpLFxuICBtZW1vRmFjdG9yeTogTWVtb0ZhY3RvcnkgPSBjcmVhdGVEaXNrTWVtb1N0b3JlXG4pIHtcbiAgcmV0dXJuIGFzeW5jIChpbnB1dDogUG9zdFRvb2xVc2VJbnB1dCwgY3R4OiBIb29rQ29udGV4dCkgPT4ge1xuICAgIGNvbnN0IG1lbW8gPSBtZW1vRmFjdG9yeShjdHgubG9nZ2VyKTtcbiAgICBjb25zdCBzZXNzaW9uSWQgPSBpbnB1dC5zZXNzaW9uX2lkO1xuICAgIGNvbnN0IGN3ZCA9IGlucHV0LmN3ZCA/PyAnJztcbiAgICBjb25zdCB0b29sTmFtZSA9IGlucHV0LnRvb2xfbmFtZTtcbiAgICBjb25zdCB0b29sSW5wdXQgPSAoaW5wdXQudG9vbF9pbnB1dCA/PyB7fSkgYXMgVG9vbElucHV0O1xuXG4gICAgLy8gQmFzaCBoYXMgbm8gYGZpbGVfcGF0aGAgZmllbGQsIHNvIGl0IGdldHMgaXRzIG93biBicmFuY2g6IHJ1biB0aGUgc3RhdGljXG4gICAgLy8gY29tbWFuZCBwYXJzZXIgYW5kIGhhbmQgdGhlIG1hdGNoZXMgdG8gdGhlIHNoYXJlZCBgcnVuQmFzaFRvdWNoZXNgXG4gICAgLy8gZHJpdmVyIChwbGFuIFx1MDBBNzMgc3RlcCAyKSwgd2hpY2ggb3ducyB0aGUgcGVyLWNvbW1hbmQgdmVyZGljdCB0aHJlYWQgXHUyMDE0XG4gICAgLy8gcG9zdC1zdGF0ZSBnYXRlcywgam9pbiBmaWx0ZXJpbmcsIGFuZCB0aGUgaW50ZXJydXB0ZWQgZ2F0ZSAocGxhbiBcdTAwQTc0KSBcdTIwMTRcbiAgICAvLyBhbmQgcmV0dXJucyB0aGUgbWVyZ2VkIGJsb2NrcyBmb3IgdGhlIGFkYXB0ZXJzJyBvdXRwdXQgYnVpbGRlcnMuIEFcbiAgICAvLyBjb21tYW5kIHdpdGggbm8gcmVjb2duaXphYmxlIGlkaW9tIHlpZWxkcyBubyBibG9ja3MgYW5kIHJldHVybnMgYG51bGxgIFx1MjAxNFxuICAgIC8vIGZhaWwtb3Blbiwgc2FtZSBhcyB0aGUgdG9vbCBwYXRoIGJlbG93LlxuICAgIGlmICh0b29sTmFtZSA9PT0gJ0Jhc2gnKSB7XG4gICAgICBjb25zdCBjb21tYW5kID0gdHlwZW9mIHRvb2xJbnB1dC5jb21tYW5kID09PSAnc3RyaW5nJyA/IHRvb2xJbnB1dC5jb21tYW5kIDogbnVsbDtcbiAgICAgIGlmICghY29tbWFuZCkgcmV0dXJuIG51bGw7XG4gICAgICAvLyBBbiBpbnRlcnJ1cHRlZCBjb21tYW5kIHByb2R1Y2VzIG5vIHRvdWNoZXMsIHdoYXRldmVyIGl0cyBzcGFuczsgdGhlXG4gICAgICAvLyBkcml2ZXIgcmUtY2hlY2tzIGRlZmVuc2l2ZWx5LlxuICAgICAgaWYgKGJhc2hSZXNwb25zZUludGVycnVwdGVkKGlucHV0LnRvb2xfcmVzcG9uc2UpKSByZXR1cm4gbnVsbDtcbiAgICAgIGNvbnN0IG1hdGNoZXMgPSBwYXJzZUNvbW1hbmREZXRhaWxlZChjb21tYW5kLCBjd2QpO1xuICAgICAgY29uc3QgYmxvY2tzID0gYXdhaXQgcnVuQmFzaFRvdWNoZXMobWF0Y2hlcywgc2Vzc2lvbklkLCBjd2QsIGlucHV0LnRvb2xfcmVzcG9uc2UsIGV4ZWN1dG9ycywgbWVtbywgKG1lc3NhZ2UpID0+XG4gICAgICAgIGN0eC5sb2dnZXIud2FybihtZXNzYWdlKVxuICAgICAgKTtcbiAgICAgIGlmIChibG9ja3MubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgICAgIGNvbnN0IGNvbWJpbmVkID0gYmxvY2tzLmpvaW4oJycpO1xuICAgICAgcmV0dXJuIHBvc3RUb29sVXNlT3V0cHV0KHtcbiAgICAgICAgaG9va1NwZWNpZmljT3V0cHV0OiB7IGFkZGl0aW9uYWxDb250ZXh0OiBjb21iaW5lZCB9LFxuICAgICAgICBzeXN0ZW1NZXNzYWdlOiBjb21iaW5lZFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgYWJzUGF0aCA9IGRlcml2ZVBhdGgodG9vbElucHV0LCBjd2QpO1xuICAgIGlmICghYWJzUGF0aCkgcmV0dXJuIG51bGw7XG5cbiAgICAvLyBCb3VuZCB0aGUgdG91Y2ggdG8gdGhlIENXRCByZXBvIChkcm9wcyBjcm9zcy1yZXBvLCBnaXRpZ25vcmVkLCBhbmQgc3BhblxuICAgIC8vIGRvY3VtZW50cykuIEZhaWwgY2xvc2VkIG9uIGFuIHVucmVzb2x2YWJsZSBDV0QgcmVwby5cbiAgICBjb25zdCBzY29wZSA9IHJlc29sdmVUb3VjaFNjb3BlKGN3ZCwgYWJzUGF0aCk7XG4gICAgaWYgKCFzY29wZSkgcmV0dXJuIG51bGw7XG5cbiAgICBjb25zdCB0b3VjaCA9IHRvVG91Y2hJbnB1dCh0b29sTmFtZSwgdG9vbElucHV0LCBzZXNzaW9uSWQsIGN3ZCwgYWJzUGF0aCk7XG4gICAgaWYgKCF0b3VjaCkgcmV0dXJuIG51bGw7XG5cbiAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCBydW5Ub3VjaEhvb2sodG91Y2gsIGV4ZWN1dG9ycywgbWVtbyk7XG4gICAgaWYgKCFvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpIHJldHVybiBudWxsO1xuXG4gICAgcmV0dXJuIHBvc3RUb29sVXNlT3V0cHV0KHtcbiAgICAgIGhvb2tTcGVjaWZpY091dHB1dDogeyBhZGRpdGlvbmFsQ29udGV4dDogb3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0IH0sXG4gICAgICBzeXN0ZW1NZXNzYWdlOiBvdXRwdXQuYWRkaXRpb25hbENvbnRleHRcbiAgICB9KTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgcG9zdFRvb2xVc2VIb29rKHsgbWF0Y2hlcjogJ1JlYWR8RWRpdHxXcml0ZXxCYXNoJywgdGltZW91dDogMTBfMDAwIH0sIGNyZWF0ZUhhbmRsZXIoKSk7XG4iLCAiaW1wb3J0IGhvb2sgZnJvbSAnLi9wb3N0LXRvb2wtdXNlLnRzJztcbmltcG9ydCB7IGV4ZWN1dGUgfSBmcm9tICcuLi8uLi8uLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzL2Rpc3QvcnVudGltZS5qcyc7XG5cbmV4ZWN1dGUoaG9vayk7XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7OztBQWtDQSxZQUFZLFFBQVE7QUFNYixJQUFNLGtCQUFrQjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFLM0IsYUFBYTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQU1iLFVBQVU7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBS1YsUUFBUTtBQUNaO0FBa0NPLFNBQVMsaUJBQWlCO0FBQzdCLFNBQU8sUUFBUSxJQUFJLGdCQUFnQixRQUFRO0FBQy9DO0FBOENPLFNBQVMsY0FBYyxNQUFNLE9BQU87QUFDdkMsUUFBTSxVQUFVLGVBQWU7QUFDL0IsTUFBSSxZQUFZLFFBQVc7QUFDdkIsVUFBTSxJQUFJLE1BQU0sd0dBQTZHO0FBQUEsRUFDakk7QUFFQSxRQUFNLGVBQWUsaUJBQWlCLEtBQUs7QUFFM0MsUUFBTSxrQkFBa0IsVUFBVSxJQUFJLElBQUksWUFBWTtBQUFBO0FBQ3RELEVBQUcsa0JBQWUsU0FBUyxpQkFBaUIsT0FBTztBQUN2RDtBQWlCTyxTQUFTLGVBQWUsTUFBTTtBQUNqQyxhQUFXLENBQUMsTUFBTSxLQUFLLEtBQUssT0FBTyxRQUFRLElBQUksR0FBRztBQUM5QyxrQkFBYyxNQUFNLEtBQUs7QUFBQSxFQUM3QjtBQUNKO0FBVUEsU0FBUyxpQkFBaUIsT0FBTztBQUc3QixRQUFNLFVBQVUsTUFBTSxRQUFRLE1BQU0sT0FBTztBQUMz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QWEsVUFBVSxXQUFXLFdBQVcsS0FBSyxPQUFPO0FBQ3ZFLFFBQUksQ0FBQyxNQUFPLFFBQU87QUFFbkIsVUFBTSxTQUFTLE1BQU0sYUFBYSxPQUFPLFdBQVcsSUFBSTtBQUN4RCxRQUFJLENBQUMsT0FBTyxrQkFBbUIsUUFBTztBQUV0QyxXQUFPLGtCQUFrQjtBQUFBLE1BQ3ZCLG9CQUFvQixFQUFFLG1CQUFtQixPQUFPLGtCQUFrQjtBQUFBLE1BQ2xFLGVBQWUsT0FBTztBQUFBLElBQ3hCLENBQUM7QUFBQSxFQUNIO0FBQ0Y7QUFFQSxJQUFPLHdCQUFRLGdCQUFnQixFQUFFLFNBQVMsd0JBQXdCLFNBQVMsSUFBTyxHQUFHLGNBQWMsQ0FBQzs7O0FDbElwRyxRQUFRLHFCQUFJOyIsCiAgIm5hbWVzIjogWyJyZXNvbHZlIiwgImZzIiwgImV4ZWNGaWxlU3luYyIsICJmcyIsICJub2RlUGF0aCIsICJmcyIsICJub2RlUGF0aCIsICJsb2dnZXIiLCAiZXhlY0ZpbGVTeW5jIiwgImZzIiwgImJhc2VuYW1lIiwgImpvaW4iLCAiZXhlY0ZpbGVTeW5jIiwgImpvaW4iLCAiYmFzZW5hbWUiLCAiam9pbiIsICJyZWFkRmlsZVN5bmMiLCAic3RhdFN5bmMiLCAiYmFzZW5hbWUiLCAiZXhlY0ZpbGVTeW5jIiwgInJlYWRGaWxlU3luYyIsICJzdGF0U3luYyIsICJqb2luIiwgInN0YXRTeW5jIiwgImJhc2VuYW1lIiwgInJlYWRGaWxlU3luYyIsICJ0b2tlbnMiXQp9Cg==

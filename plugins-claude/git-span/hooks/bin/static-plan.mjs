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
  hookFn.unexpectedError = config.unexpectedError;
  hookFn.onUnexpectedError = config.onUnexpectedError;
  return hookFn;
}
function preToolUseHook(config, handler) {
  return createHookFunction("PreToolUse", config, handler);
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

// ../../node_modules/@goodfoot/claude-code-hooks/dist/runtime.js
async function readStdin() {
  return new Promise((resolve3, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      chunks.push(chunk);
    });
    process.stdin.on("end", () => {
      resolve3(chunks.join(""));
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
function writeUnexpectedErrorStderr(error) {
  if (error instanceof Error) {
    process.stderr.write(`${error.stack ?? error.message}
`);
  } else {
    process.stderr.write(`${String(error)}
`);
  }
}
function reportUnexpectedError(onUnexpectedError, error, phase) {
  try {
    onUnexpectedError?.(error, phase);
  } catch {
  }
  try {
    logger.logError(error, `Unexpected error in ${phase} phase (fail-open)`, { phase });
  } catch {
  }
}
function handleUnexpectedError(error, phase, policy, onUnexpectedError) {
  if (policy === "continue") {
    reportUnexpectedError(onUnexpectedError, error, phase);
    return;
  }
  writeUnexpectedErrorStderr(error);
  process.exit(EXIT_CODES.ERROR);
}
function cleanup(policy, onUnexpectedError) {
  try {
    logger.clearContext();
    logger.close();
  } catch (error) {
    handleUnexpectedError(error, "cleanup", policy, onUnexpectedError);
  }
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
var HandlerThrewError = class {
  original;
  constructor(original) {
    this.original = original;
  }
};
async function runHandlerPhases(hookFn, policy, onUnexpectedError, setPhase) {
  let stdinContent;
  try {
    stdinContent = await readStdin();
  } catch (error) {
    logger.logError(error, "Failed to read stdin");
    return createMalformedInputOutput(error);
  }
  setPhase("parse");
  let input;
  try {
    input = parseStdinInput(stdinContent);
  } catch (error) {
    logger.logError(error, "Failed to parse stdin JSON");
    return createMalformedInputOutput(error);
  }
  const hookEventName = hookFn.hookEventName;
  logger.setContext(hookEventName, input);
  const context = hookEventName === "SessionStart" ? { logger, persistEnvVar, persistEnvVars } : { logger };
  setPhase("handler");
  try {
    const specificOutput = await hookFn(input, context);
    return specificOutput !== null ? convertToHookOutput(specificOutput) : void 0;
  } catch (error) {
    if (policy !== "continue") {
      throw new HandlerThrewError(error);
    }
    reportUnexpectedError(onUnexpectedError, error, "handler");
    return void 0;
  }
}
async function execute(hookFn) {
  const policy = hookFn.unexpectedError ?? "error";
  const onUnexpectedError = hookFn.onUnexpectedError;
  let phase = "read";
  let output;
  try {
    output = await runHandlerPhases(hookFn, policy, onUnexpectedError, (p) => {
      phase = p;
    });
  } catch (error) {
    if (error instanceof HandlerThrewError) {
      handleHandlerError(error.original);
    }
    handleUnexpectedError(error, phase, policy, onUnexpectedError);
    output = void 0;
  }
  if (output?.stderr !== void 0) {
    phase = "cleanup";
    cleanup(policy, onUnexpectedError);
    process.stderr.write(output.stderr);
    process.exit(EXIT_CODES.BLOCK);
  }
  phase = "serialize";
  let serializedText;
  try {
    serializedText = output?.rawStdout !== void 0 ? output.rawStdout : JSON.stringify(output?.stdout ?? {});
  } catch (error) {
    handleUnexpectedError(error, "serialize", policy, onUnexpectedError);
    serializedText = "{}";
  }
  phase = "write";
  try {
    process.stdout.write(serializedText);
  } catch (error) {
    handleUnexpectedError(error, "write", policy, onUnexpectedError);
  }
  phase = "cleanup";
  cleanup(policy, onUnexpectedError);
  process.exit(EXIT_CODES.SUCCESS);
}

// src/common/agent-hooks-common.ts
import { execFileSync } from "node:child_process";
import * as fs2 from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
function toPosix(p) {
  return p.replace(/\\/g, "/");
}
var repoRootCache = /* @__PURE__ */ new Map();
function resolveRepoRoot(dir) {
  if (!dir) return null;
  const cached = repoRootCache.get(dir);
  if (cached !== void 0) return cached;
  const resolved = resolveRepoRootUncached(dir);
  repoRootCache.set(dir, resolved);
  return resolved;
}
function resolveRepoRootUncached(dir) {
  try {
    let current = fs2.realpathSync.native(dir);
    for (; ; ) {
      if (fs2.existsSync(nodePath.join(current, ".git"))) return toPosix(current);
      const parent = nodePath.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  } catch {
  }
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
var spanRootCache = /* @__PURE__ */ new Map();
function resolveSpanRoot(repoRoot) {
  const cached = spanRootCache.get(repoRoot);
  if (cached !== void 0) return cached;
  const resolved = resolveSpanRootUncached(repoRoot);
  spanRootCache.set(repoRoot, resolved);
  return resolved;
}
function resolveSpanRootUncached(repoRoot) {
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
function sanitizeSessionId(sessionId) {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, (ch) => {
    return `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
  });
}
function createSessionLayout(base) {
  const dir = (sessionId) => nodePath.join(base, sanitizeSessionId(sessionId));
  const plannedTouchesDir = (sessionId) => nodePath.join(dir(sessionId), "planned-touches");
  const plannedTouchFile = (sessionId, toolUseId, suffix) => nodePath.join(plannedTouchesDir(sessionId), `${sanitizeSessionId(toolUseId)}${suffix}`);
  return Object.freeze({
    base,
    trashDir: nodePath.join(nodePath.dirname(base), "session-trash"),
    dir,
    memoFile: (sessionId) => nodePath.join(dir(sessionId), "touch-memo.json"),
    plannedTouchesDir,
    plannedTouchRecordFile: (sessionId, toolUseId) => plannedTouchFile(sessionId, toolUseId, ".json"),
    plannedTouchConsumedFile: (sessionId, toolUseId) => plannedTouchFile(sessionId, toolUseId, ".consumed")
  });
}
var DEFAULT_SESSION_LAYOUT = createSessionLayout(
  nodePath.join(os.homedir(), ".cache", "git-span", "session")
);
var THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1e3;
var SESSION_TRASH_TTL_MS = 6e4;
var SESSION_TRASH_MARKER = ".trash-session-";
function pruneStaleSessions(layout, now = Date.now(), maxAgeMs = THIRTY_DAYS_MS) {
  try {
    for (const entry of fs2.readdirSync(layout.trashDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.includes(SESSION_TRASH_MARKER)) continue;
      const trashPath = nodePath.join(layout.trashDir, entry.name);
      try {
        const stat = fs2.statSync(trashPath);
        if (now - stat.mtimeMs > SESSION_TRASH_TTL_MS) {
          fs2.rmSync(trashPath, { recursive: true, force: true });
        }
      } catch (err) {
      }
    }
  } catch (err) {
  }
  let entries;
  try {
    entries = fs2.readdirSync(layout.base, { withFileTypes: true });
  } catch {
    return;
  }
  let trashDirReady = false;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = nodePath.join(layout.base, entry.name);
    try {
      const stat = fs2.statSync(dirPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        if (!trashDirReady) {
          fs2.mkdirSync(layout.trashDir, { recursive: true, mode: 448 });
          trashDirReady = true;
        }
        const trashPath = nodePath.join(
          layout.trashDir,
          `${entry.name}${SESSION_TRASH_MARKER}${process.pid}-${Date.now().toString(36)}`
        );
        fs2.renameSync(dirPath, trashPath);
        fs2.utimesSync(trashPath, now / 1e3, now / 1e3);
      }
    } catch (err) {
    }
  }
}
var PRUNE_THROTTLE_WINDOW_MS = SESSION_TRASH_TTL_MS;
var lastOpportunisticPruneAt = Number.NEGATIVE_INFINITY;
function pruneStaleSessionsThrottled(layout, now = Date.now()) {
  if (now - lastOpportunisticPruneAt < PRUNE_THROTTLE_WINDOW_MS) return;
  lastOpportunisticPruneAt = now;
  pruneStaleSessions(layout, now);
}

// src/common/bash-attribution.ts
import { createHash as createHash2 } from "node:crypto";
import * as fs7 from "node:fs";
import * as nodePath5 from "node:path";

// src/common/span-surface.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import * as fs4 from "node:fs";
import * as nodePath3 from "node:path";

// src/common/span-ignore.ts
import * as fs3 from "node:fs";
import * as nodePath2 from "node:path";
var HOOK_IGNORE_REL = nodePath2.join(".span", ".hookignore");

// src/common/static-attribution.ts
import { execFileSync as execFileSync4 } from "node:child_process";
import * as fs5 from "node:fs";
import * as nodePath4 from "node:path";

// src/common/parse-command.ts
import { readFileSync as readFileSync4, statSync as statSync3 } from "node:fs";
import { basename as basename2, isAbsolute as isAbsolute2, join as joinPath, resolve as resolvePath } from "node:path";

// src/common/command-resolve.ts
import { execFileSync as execFileSync3 } from "node:child_process";
import { readFileSync as readFileSync3, statSync as statSync2 } from "node:fs";
function countFileLines(absolutePath) {
  try {
    if (!statSync2(absolutePath).isFile()) return null;
    const content = readFileSync3(absolutePath, "utf8");
    if (content.length === 0) return 0;
    const withoutTrailingNewline = content.endsWith("\n") ? content.slice(0, -1) : content;
    return withoutTrailingNewline.split("\n").length;
  } catch {
    return null;
  }
}
function countGitBlobLines(cwd, rev, path) {
  try {
    const out = execFileSync3("git", ["show", `${rev}:${path}`], {
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

// src/common/shell-split-machines.ts
function createScan(cmd) {
  return {
    cmd,
    n: cmd.length,
    i: 0,
    buf: "",
    parts: [],
    pendingOp: "start",
    listStart: 0,
    inSquote: false,
    inDquote: false,
    braceDepth: 0,
    depth: 0,
    levels: [[]],
    afterKeyword: false,
    functionSeen: false,
    nameSeen: false,
    caseRegion: null,
    heredocs: [],
    inBody: false,
    bufHeredoc: false
  };
}
var WORD_END = /[\s;&|()<>]/;
var COMMAND_OPENER_WORDS = /* @__PURE__ */ new Set(["do", "then", "else", "elif", "if", "while", "until", "!", "time", "{", "("]);
var DANGLING_REDIRECT_WORD = /^(?:>|>>|&>|&>>|>\||<|<>|<<|<<-|<<<|>&|\d+(?:>|>>|>\||<|<>|<<|<<-|<<<|>&|<&))$/;
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function lastWord(buf) {
  return buf.trimEnd().match(/\S+$/)?.[0] ?? "";
}
function bufferEndsInDanglingRedirect(buf) {
  return DANGLING_REDIRECT_WORD.test(lastWord(buf));
}
function wordStart(buf) {
  return buf === "" || /\s$/.test(buf);
}
function commandPosition(buf) {
  return buf.trim() === "" || /\n$/.test(buf) || /[;&|()]$/.test(buf.trimEnd()) || COMMAND_OPENER_WORDS.has(lastWord(buf));
}
function fnNameShapeIsPending(buf) {
  return /^[A-Za-z_][A-Za-z0-9_]*\(\)$/.test(lastWord(buf)) || lastWord(buf) === "()";
}
function startsRedirectAt(s) {
  const c = s.cmd[s.i];
  if (c === ">" || c === "<") return true;
  if (c === "&") return s.cmd[s.i + 1] === ">";
  if (c >= "0" && c <= "9") {
    let j = s.i;
    while (j < s.n && s.cmd[j] >= "0" && s.cmd[j] <= "9") j += 1;
    return s.cmd[j] === ">" || s.cmd[j] === "<";
  }
  return false;
}
function unconsumedPipeOp(s) {
  return (s.pendingOp === "pipe" || s.pendingOp === "and" || s.pendingOp === "or") && s.buf.trim() === "";
}
function appendStage(s, nextOp) {
  const text = s.buf.trim();
  if (text) {
    if (s.pendingOp === "pipe" && (text === "!" || /^!\s/.test(text))) {
      rejectList(s, "pipe-bang");
      return;
    }
    s.parts.push({ text, precededBy: s.pendingOp, ...s.bufHeredoc ? { heredoc: true } : {} });
  }
  s.buf = "";
  s.bufHeredoc = false;
  s.pendingOp = nextOp;
}
function rejectList(s, v) {
  s.malformed = v;
  s.parts.length = s.listStart;
  s.i = s.n;
}
function stepQuote(s) {
  const c = s.cmd[s.i];
  if (s.inSquote) {
    s.buf += c;
    if (c === "'") s.inSquote = false;
    s.i += 1;
    return true;
  }
  if (s.inDquote) {
    s.buf += c;
    if (c === "\\" && s.i + 1 < s.n) {
      s.buf += s.cmd[s.i + 1];
      s.i += 2;
      return true;
    }
    if (c === '"') s.inDquote = false;
    s.i += 1;
    return true;
  }
  if (c === "'") {
    s.inSquote = true;
    s.buf += c;
    s.i += 1;
    return true;
  }
  if (c === '"') {
    s.inDquote = true;
    s.buf += c;
    s.i += 1;
    return true;
  }
  if (c === "\\" && s.i + 1 < s.n) {
    s.buf += c + s.cmd[s.i + 1];
    s.i += 2;
    return true;
  }
  return false;
}
function stepBraceContent(s) {
  if (s.braceDepth === 0) return false;
  const c = s.cmd[s.i];
  if (c === "}") s.braceDepth -= 1;
  s.buf += c;
  s.i += 1;
  return true;
}
function stepHeredocBody(s) {
  if (!s.inBody) return false;
  const lineEnd = s.cmd.indexOf("\n", s.i);
  const line = lineEnd === -1 ? s.cmd.slice(s.i) : s.cmd.slice(s.i, lineEnd);
  if (s.heredocs[0].close.test(line)) {
    s.heredocs.shift();
    if (s.heredocs.length === 0) s.inBody = false;
  }
  if (insideOpenRegion(s)) {
    s.buf += line;
    if (lineEnd !== -1) s.buf += "\n";
  }
  s.i = lineEnd === -1 ? s.n : lineEnd + 1;
  return true;
}
function stepHeredocDelimiterNewline(s) {
  if (s.cmd[s.i] !== "\n" || s.heredocs.length === 0) return false;
  if (insideOpenRegion(s)) {
    s.buf += "\n";
    s.inBody = true;
    s.i += 1;
    return true;
  }
  if (unconsumedPipeOp(s) || bufferEndsInDanglingRedirect(s.buf)) {
    rejectList(s, "dangling-operator");
    return true;
  }
  appendStage(s, "newline");
  s.inBody = true;
  s.i += 1;
  return true;
}
function stepHereString(s) {
  if (s.depth !== 0) return false;
  const { i } = s;
  if (s.cmd[i] !== "<" || s.cmd[i + 1] !== "<" || s.cmd[i + 2] !== "<") return false;
  if (s.cmd[i + 3] === "<" || s.cmd[i - 1] === "<") return false;
  s.buf += "<<<";
  s.i += 3;
  return true;
}
function stepHeredocOpen(s) {
  if (s.depth !== 0) return false;
  const { i } = s;
  if (s.cmd[i] !== "<" || s.cmd[i + 1] !== "<" || s.cmd[i + 2] === "<") return false;
  const scanned = scanHeredocDelimiter(s);
  if (scanned.delim === "") return false;
  s.heredocs.push({
    close: new RegExp(`^${scanned.allowTabs ? "	*" : ""}${escapeRegExp(scanned.delim)}[ \\t]*$`)
  });
  s.bufHeredoc = true;
  if (insideOpenRegion(s)) {
    s.buf += s.cmd.slice(i, scanned.next);
  }
  s.i = scanned.next;
  return true;
}
function scanHeredocDelimiter(s) {
  let j = s.i + 2;
  let allowTabs = false;
  if (s.cmd[j] === "-") {
    allowTabs = true;
    j += 1;
  }
  while (s.cmd[j] === " " || s.cmd[j] === "	") j += 1;
  if (s.cmd[j] === "'" || s.cmd[j] === '"') {
    const q = s.cmd.indexOf(s.cmd[j], j + 1);
    if (q === -1) return { delim: s.cmd.slice(j + 1), allowTabs, next: s.n };
    return { delim: s.cmd.slice(j + 1, q), allowTabs, next: q + 1 };
  }
  const delimStart = j;
  while (j < s.n && !WORD_END.test(s.cmd[j])) j += 1;
  return { delim: s.cmd.slice(delimStart, j), allowTabs, next: j };
}
function insideOpenRegion(s) {
  return s.levels[s.levels.length - 1].length > 0 || s.caseRegion !== null;
}
function stepCaseRegion(s) {
  const r = s.caseRegion;
  if (r?.localDepth !== 0) return false;
  if (stepCasePunct(s, r)) return true;
  return stepCaseWord(s, r);
}
function stepCasePunct(s, r) {
  const c = s.cmd[s.i];
  const termLen = caseTerminatorLength(s);
  if (termLen > 0) {
    r.pos = "pattern-start";
    s.buf += s.cmd.slice(s.i, s.i + termLen);
    s.i += termLen;
    return true;
  }
  if (c === ";") {
    r.pos = "command";
    r.cmdEmpty = true;
    s.buf += c;
    s.i += 1;
    return true;
  }
  if (caseBareAmpersand(s)) {
    r.pos = "command";
    r.cmdEmpty = true;
    s.buf += c;
    s.i += 1;
    return true;
  }
  if (c === "\n") {
    if (r.pos === "pattern") {
      rejectList(s, "unclosed-case");
      return true;
    }
    if (r.pos === "command") r.cmdEmpty = true;
    s.buf += c;
    s.i += 1;
    return true;
  }
  if (c === "#" && wordStart(s.buf)) {
    while (s.i < s.n && s.cmd[s.i] !== "\n") s.i += 1;
    return true;
  }
  return false;
}
function caseTerminatorLength(s) {
  const three = s.cmd.slice(s.i, s.i + 3);
  if (three === ";;&") return 3;
  const two = s.cmd.slice(s.i, s.i + 2);
  return two === ";;" || two === ";&" ? 2 : 0;
}
function caseBareAmpersand(s) {
  if (s.cmd[s.i] !== "&") return false;
  return s.cmd[s.i + 1] !== ">" && s.cmd[s.i + 1] !== "&" && !bufferEndsInRedirectChar(s.buf);
}
function stepCaseWord(s, r) {
  const c = s.cmd[s.i];
  if (!wordStart(s.buf) || WORD_END.test(c)) return false;
  let j = s.i;
  while (j < s.n && !WORD_END.test(s.cmd[j])) j += 1;
  const w = s.cmd.slice(s.i, j);
  if (w === "esac" && (r.pos === "pattern-start" || r.pos === "command" && r.cmdEmpty)) {
    s.caseRegion = null;
    s.afterKeyword = false;
  } else if (w === "in" && r.pos === "subject") {
    r.pos = "pattern-start";
  } else if (r.pos === "pattern-start") {
    r.pos = "pattern";
  } else if (r.pos === "command") {
    r.cmdEmpty = false;
  }
  s.buf += w;
  s.i = j;
  return true;
}
function bufferEndsInRedirectChar(buf) {
  const last = buf[buf.length - 1];
  return last === ">" || last === "<";
}
function stepParen(s) {
  const c = s.cmd[s.i];
  if (c !== "(" && c !== ")") return false;
  if (c === "(") {
    if (s.caseRegion) {
      s.caseRegion.localDepth += 1;
    } else {
      markEnclosingBraceBody(s);
      s.depth += 1;
      s.levels.push([]);
    }
    s.afterKeyword = false;
    s.buf += c;
    s.i += 1;
    return true;
  }
  if (s.caseRegion) {
    if (s.caseRegion.localDepth === 0) {
      s.caseRegion.pos = "command";
      s.caseRegion.cmdEmpty = true;
    } else {
      s.caseRegion.localDepth -= 1;
    }
  } else {
    if (s.depth === 0) {
      rejectList(s, "unbalanced-paren");
      return true;
    }
    if (s.levels[s.levels.length - 1].length > 0) {
      rejectList(s, "unclosed-construct");
      return true;
    }
    s.depth -= 1;
    s.levels.pop();
  }
  s.buf += c;
  s.i += 1;
  return true;
}
function stepConstructWord(s) {
  if (!startsConstructWord(s)) return false;
  let j = s.i;
  while (j < s.n && !WORD_END.test(s.cmd[j])) j += 1;
  const w = s.cmd.slice(s.i, j);
  const top = topFrame(s.levels);
  const atCommand = commandPosition(s.buf);
  if (forSelectSeparator(w, top)) {
  } else if (opensBraceGroup(s, w, atCommand)) {
    openBraceGroup(s);
  } else if (w === "}" && atCommand) {
    closeBraceGroup(s);
  } else if (atCommand) {
    if (!applyCommandKeyword(s, w)) ordinaryConstructWord(s);
  } else {
    ordinaryArgumentWord(s);
  }
  s.buf += w;
  s.i = j;
  return true;
}
function forSelectSeparator(w, top) {
  return w === "in" && top !== void 0 && (top.kind === "for" || top.kind === "select");
}
function opensBraceGroup(s, w, atCommand) {
  return w === "{" && (atCommand || fnNameShapeIsPending(s.buf) || s.functionSeen && s.nameSeen);
}
function startsConstructWord(s) {
  if (s.caseRegion) return false;
  const c = s.cmd[s.i];
  if (WORD_END.test(c)) return false;
  if (!wordStart(s.buf) && !/[()]$/.test(s.buf)) return false;
  return !(c === "$" && s.cmd[s.i + 1] === "{");
}
function pushConstruct(s, kind) {
  markEnclosingBraceBody(s);
  s.levels[s.levels.length - 1].push({ kind, body: false });
  s.afterKeyword = true;
}
function requireTopOf(s, kinds, requireBody) {
  const t = topFrame(s.levels);
  if (t === void 0 || !kinds.includes(t.kind) || requireBody && !t.body) {
    rejectList(s, "unclosed-construct");
    return null;
  }
  return t;
}
function closeConstruct(s, kinds) {
  if (requireTopOf(s, kinds, true) === null) return;
  s.levels[s.levels.length - 1].pop();
  s.afterKeyword = false;
}
function openBraceGroup(s) {
  if (s.functionSeen && s.nameSeen) {
    s.functionSeen = false;
    s.nameSeen = false;
  }
  pushConstruct(s, "brace");
}
function closeBraceGroup(s) {
  const t = topFrame(s.levels);
  if (s.afterKeyword || t === void 0 || t.kind !== "brace" || !t.body) {
    rejectList(s, "unclosed-construct");
    return;
  }
  s.levels[s.levels.length - 1].pop();
  s.afterKeyword = false;
}
function requireIfBranch(s) {
  if (requireTopOf(s, ["if"], true) !== null) s.afterKeyword = true;
}
var CONSTRUCT_KEYWORDS = /* @__PURE__ */ new Map([
  [
    "case",
    (s) => {
      s.caseRegion = { pos: "subject", cmdEmpty: false, localDepth: 0 };
      s.afterKeyword = false;
    }
  ],
  [
    "function",
    (s) => {
      s.functionSeen = true;
      s.nameSeen = false;
      s.afterKeyword = false;
    }
  ],
  ["if", (s) => pushConstruct(s, "if")],
  ["while", (s) => pushConstruct(s, "loop")],
  ["until", (s) => pushConstruct(s, "loop")],
  ["for", (s) => pushConstruct(s, "for")],
  ["select", (s) => pushConstruct(s, "select")],
  [
    "do",
    (s) => {
      const t = requireTopOf(s, ["for", "loop", "select"], false);
      if (t !== null) {
        t.body = true;
        s.afterKeyword = true;
      }
    }
  ],
  [
    "then",
    (s) => {
      const t = requireTopOf(s, ["if"], false);
      if (t !== null) {
        t.body = true;
        s.afterKeyword = true;
      }
    }
  ],
  ["else", (s) => requireIfBranch(s)],
  ["elif", (s) => requireIfBranch(s)],
  // `in` only validates the for/select frame — it arms nothing and starts no body.
  ["in", (s) => void requireTopOf(s, ["for", "select"], false)],
  ["fi", (s) => closeConstruct(s, ["if"])],
  ["done", (s) => closeConstruct(s, ["for", "loop", "select"])],
  // No open region — a stray esac is a parse error.
  ["esac", (s) => rejectList(s, "unclosed-construct")]
]);
function applyCommandKeyword(s, w) {
  const kw = CONSTRUCT_KEYWORDS.get(w);
  if (kw === void 0) return false;
  kw(s);
  return true;
}
function topFrame(levels) {
  const lv = levels[levels.length - 1];
  return lv.length > 0 ? lv[lv.length - 1] : void 0;
}
function markEnclosingBraceBody(s) {
  const t = topFrame(s.levels);
  if (t?.kind === "brace") t.body = true;
}
function ordinaryConstructWord(s) {
  s.afterKeyword = false;
  markEnclosingBraceBody(s);
  advanceFunctionNameHandoff(s);
}
function ordinaryArgumentWord(s) {
  s.afterKeyword = false;
  advanceFunctionNameHandoff(s);
}
function advanceFunctionNameHandoff(s) {
  if (!s.functionSeen) return;
  if (s.nameSeen) {
    s.functionSeen = false;
    s.nameSeen = false;
  } else {
    s.nameSeen = true;
  }
}
function rejectEmptyConstructList(s) {
  const c = s.cmd[s.i];
  if (s.caseRegion === null && s.levels[s.levels.length - 1].length > 0 && (c === ";" || c === "&") && s.afterKeyword) {
    rejectList(s, "unclosed-construct");
    return true;
  }
  return false;
}
function skipTopLevelComment(s) {
  if (s.cmd[s.i] !== "#" || s.depth !== 0 || !wordStart(s.buf)) return false;
  while (s.i < s.n && s.cmd[s.i] !== "\n") s.i += 1;
  return true;
}
function stepRedirectToken(s) {
  if (s.depth !== 0) return false;
  const c = s.cmd[s.i];
  if (wordStart(s.buf) && bufferEndsInDanglingRedirect(s.buf) && startsRedirectAt(s)) {
    rejectList(s, "dangling-operator");
    return true;
  }
  if (c === "$" && s.cmd[s.i + 1] === "{") {
    s.braceDepth += 1;
    s.buf += c;
    s.i += 1;
    return true;
  }
  if (stepHereString(s)) return true;
  return stepHeredocOpen(s);
}
function stepBoundaryOperator(s) {
  if (s.depth !== 0) return false;
  if (s.caseRegion !== null) return false;
  if (s.levels[s.levels.length - 1].length > 0) return false;
  const c = s.cmd[s.i];
  const twoOp = TWO_CHAR_BOUNDARY_OPS.get(s.cmd.slice(s.i, s.i + 2));
  if (twoOp !== void 0) {
    flushBoundaryOrReject(s, twoOp);
    s.i += 2;
    return true;
  }
  if (c === ";") {
    flushBoundaryOrReject(s, "semicolon");
    s.i += 1;
    return true;
  }
  if (c === "|") {
    flushBoundaryOrReject(s, "pipe");
    s.i += 1;
    return true;
  }
  if (c === "\n") return stepNewlineBoundary(s);
  if (c === "&") {
    if (ampersandIsRedirectText(s)) {
      s.buf += c;
      s.i += 1;
      return true;
    }
    flushBoundaryOrReject(s, "background");
    s.i += 1;
    return true;
  }
  return false;
}
var TWO_CHAR_BOUNDARY_OPS = /* @__PURE__ */ new Map([
  ["&&", "and"],
  ["||", "or"],
  ["|&", "pipe"]
]);
function stepNewlineBoundary(s) {
  if (unconsumedPipeOp(s)) {
    s.i += 1;
    return true;
  }
  if (bufferEndsInDanglingRedirect(s.buf)) {
    rejectList(s, "dangling-operator");
    return true;
  }
  appendStage(s, "newline");
  s.listStart = s.parts.length;
  s.i += 1;
  return true;
}
function flushBoundaryOrReject(s, nextOp) {
  if (unconsumedPipeOp(s) || bufferEndsInDanglingRedirect(s.buf)) {
    rejectList(s, "dangling-operator");
    return;
  }
  appendStage(s, nextOp);
}
function ampersandIsRedirectText(s) {
  if (s.cmd[s.i + 1] === ">") return true;
  if (s.buf[s.buf.length - 1] === "<") return true;
  const trimmed = s.buf.trimEnd();
  if (!trimmed.endsWith(">")) return false;
  const before = trimmed.length >= 2 ? trimmed[trimmed.length - 2] : "";
  return trimmed.length === 1 || /\s|\d/.test(before);
}
function finishScan(s) {
  if (s.malformed) return { stages: s.parts, malformed: s.malformed };
  if (s.inSquote || s.inDquote) {
    rejectList(s, "unclosed-quote");
  } else if (s.braceDepth > 0) {
    rejectList(s, "unclosed-brace");
  } else if (s.caseRegion !== null) {
    rejectList(s, "unclosed-case");
  } else if (s.depth > 0) {
    rejectList(s, "unbalanced-paren");
  } else if (s.levels[s.levels.length - 1].length > 0) {
    rejectList(s, "unclosed-construct");
  } else if (unconsumedPipeOp(s) || bufferEndsInDanglingRedirect(s.buf)) {
    rejectList(s, "dangling-operator");
  } else if (s.inBody || s.heredocs.length > 0) {
    appendStage(s, "newline");
    s.malformed = "unterminated-heredoc";
  } else {
    appendStage(s, "newline");
  }
  return { stages: s.parts, malformed: s.malformed };
}
function createTokenizeScan(src) {
  return { src, n: src.length, i: 0, buf: "", quoted: false, tokens: [] };
}
function flushWord(t) {
  if (t.buf.length === 0) return;
  t.tokens.push({ text: t.buf, quoted: t.quoted, isRedirect: false });
  t.buf = "";
  t.quoted = false;
}
function appendQuotedContent(t, out, start) {
  const quote = t.src[start];
  let j = start + 1;
  while (j < t.n) {
    const c = t.src[j];
    if (quote === "'") {
      if (c === "'") return { out, next: j + 1 };
      out += c;
      j += 1;
      continue;
    }
    if (c === "\\" && j + 1 < t.n && '"\\$`'.includes(t.src[j + 1])) {
      out += t.src[j + 1];
      j += 2;
      continue;
    }
    if (c === '"') return { out, next: j + 1 };
    out += c;
    j += 1;
  }
  return null;
}
function appendAttachedTarget(t, out, start) {
  let j = start;
  while (j < t.n) {
    const c = t.src[j];
    if (/\s/.test(c) || c === "<" || c === ">") return { out, next: j };
    if (c === "'" || c === '"') {
      const section = appendQuotedContent(t, "", j);
      if (section === null) return null;
      out += t.src.slice(j, section.next);
      j = section.next;
      continue;
    }
    if (c === "\\" && j + 1 < t.n) {
      out += c + t.src[j + 1];
      j += 2;
      continue;
    }
    out += c;
    j += 1;
  }
  return { out, next: j };
}
function emitRedirect(t, operator, attachedStart) {
  const attached = appendAttachedTarget(t, "", attachedStart);
  if (attached === null) return false;
  t.tokens.push({ text: t.buf + operator + attached.out, quoted: false, isRedirect: true });
  t.buf = "";
  t.quoted = false;
  t.i = attached.next;
  return true;
}
function stepTokenizerQuote(t) {
  const c = t.src[t.i];
  if (c !== "'" && c !== '"') return false;
  t.quoted = true;
  const section = appendQuotedContent(t, t.buf, t.i);
  if (section === null) {
    t.failed = true;
    return true;
  }
  t.buf = section.out;
  t.i = section.next;
  return true;
}
function stepTokenizerEscape(t) {
  if (t.src[t.i] !== "\\" || t.i + 1 >= t.n) return false;
  t.quoted = true;
  t.buf += t.src[t.i + 1];
  t.i += 2;
  return true;
}
function readRedirectOperator(t) {
  const two = t.src.slice(t.i, t.i + 2);
  const three = t.src.slice(t.i, t.i + 3);
  if (t.src[t.i] === "<") {
    if (three === "<<<") return "<<<";
    if (three === "<<-") return "<<-";
    if (two === "<<") return "<<";
    return "<";
  }
  return two === ">>" ? ">>" : ">";
}
function stepTokenizerRedirect(t) {
  const c = t.src[t.i];
  if (c !== "<" && c !== ">") return false;
  if (t.buf !== "" && !/^\d+$/.test(t.buf)) flushWord(t);
  const operator = readRedirectOperator(t);
  if (!emitRedirect(t, operator, t.i + operator.length)) t.failed = true;
  return true;
}
function stepTokenizerAmpersand(t) {
  if (t.src[t.i] !== "&") return false;
  if (t.src[t.i + 1] === ">") {
    flushWord(t);
    const operator = t.src.slice(t.i, t.i + 3) === "&>>" ? "&>>" : "&>";
    if (!emitRedirect(t, operator, t.i + operator.length)) t.failed = true;
  } else {
    t.buf += "&";
    t.i += 1;
  }
  return true;
}
function finishTokenizeScan(t) {
  if (t.failed) return null;
  flushWord(t);
  return t.tokens;
}

// src/common/shell-split.ts
function splitTopLevel(cmd) {
  const s = createScan(cmd);
  while (s.i < s.n) {
    if (stepQuote(s)) continue;
    if (stepBraceContent(s)) continue;
    if (stepHeredocBody(s)) continue;
    if (stepHeredocDelimiterNewline(s)) continue;
    if (skipTopLevelComment(s)) continue;
    if (stepCaseRegion(s)) continue;
    if (stepParen(s)) continue;
    if (stepConstructWord(s)) continue;
    if (rejectEmptyConstructList(s)) continue;
    if (stepRedirectToken(s)) continue;
    if (stepBoundaryOperator(s)) continue;
    s.buf += s.cmd[s.i];
    s.i += 1;
  }
  return finishScan(s);
}
var LEADING_ASSIGNMENT = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/;
function stripLeadingAssignments(simpleCmd) {
  return simpleCmd.replace(LEADING_ASSIGNMENT, "");
}
function tokenize(s) {
  const t = createTokenizeScan(s);
  while (t.i < t.n && !t.failed) {
    if (/\s/.test(t.src[t.i])) {
      flushWord(t);
      t.i += 1;
      continue;
    }
    if (stepTokenizerQuote(t)) continue;
    if (stepTokenizerEscape(t)) continue;
    if (stepTokenizerRedirect(t)) continue;
    if (stepTokenizerAmpersand(t)) continue;
    t.buf += t.src[t.i];
    t.i += 1;
  }
  return finishTokenizeScan(t);
}
function redirectAttachedTarget(text) {
  const match = text.match(/^(\d*)(<<<|<<-|&>>|<<|>>|&>|>&|<|>)(.*)$/);
  if (match === null) return null;
  const [, , , rest] = match;
  return rest.length > 0 ? rest : null;
}
function argvOf(simpleCmd) {
  const tokens = tokenize(stripLeadingAssignments(simpleCmd).trim());
  if (tokens === null) return null;
  const argv = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.isRedirect) {
      argv.push(token.text);
      continue;
    }
    if (redirectAttachedTarget(token.text) === null) i += 1;
  }
  return argv;
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
function parseHeadTailFlags(rest, barePlusIsCount) {
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
      if (barePlusIsCount) {
        fromStart = true;
        count = Number.parseInt(a.slice(1), 10);
      } else {
        files.push(a);
      }
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
  const { count, disqualified, files } = parseHeadTailFlags(argv.slice(1), false);
  if (disqualified) return [];
  const realFiles = files.filter((f) => f !== "-" && !/^\+\d+$/.test(f));
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
  const { count, fromStart, disqualified, files } = parseHeadTailFlags(argv.slice(1), true);
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
  if (sub?.subcommand !== "show") return [];
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
  if (sub?.subcommand !== "log") return [];
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
function matchTeeOperands(argv, pipeEchoContent, currentDir, simpleCommandIndex, join7, results) {
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
        join: join7,
        ...pipeEchoContent !== null ? { written: pipeEchoContent } : {}
      } : {
        operation: "append",
        absolutePath,
        simpleCommandIndex,
        join: join7,
        ...pipeEchoContent !== null ? { written: pipeEchoContent } : {}
      }
    });
  }
}
function matchRedirectFamily(argv, redirects, pipeEchoContent, currentDir, simpleCommandIndex, join7, results) {
  const contentRedirects = redirects.filter(isContentRedirect);
  const host = argv[0];
  if (contentRedirects.length === 0) {
    if (host === "tee") matchTeeOperands(argv, pipeEchoContent, currentDir, simpleCommandIndex, join7, results);
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
        span: { operation: "truncate", absolutePath, simpleCommandIndex, join: join7 }
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
          join: join7,
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
          join: join7,
          ...threadedOverwrite !== void 0 ? { written: threadedOverwrite } : {}
        }
      });
    }
  }
  if (host === "tee") matchTeeOperands(argv, pipeEchoContent, currentDir, simpleCommandIndex, join7, results);
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
    return statSync3(absolutePath).isDirectory();
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
function emitSourceSpan(results, spec, absolutePath, simpleCommandIndex, join7) {
  if (spec.sourceOperation === "delete") {
    results.push({
      status: "resolved",
      idiom: spec.idiom,
      span: { operation: "delete", absolutePath, simpleCommandIndex, join: join7 }
    });
    return;
  }
  const range = resolveSpec({ kind: "toEof", start: 1 }, () => countFileLines(absolutePath));
  results.push({
    status: "resolved",
    idiom: spec.idiom,
    span: range === null ? { operation: "read", absolutePath, simpleCommandIndex, join: join7 } : {
      operation: "read",
      lineStart: range.lineStart,
      lineEnd: range.lineEnd,
      absolutePath,
      simpleCommandIndex,
      join: join7
    }
  });
}
function matchCopyMoveFamily(argv, dirForResolution, simpleCommandIndex, join7, results) {
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
    destPaths = sourcePaths.map((p) => joinPath(targetAbs, basename2(p)));
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
    destPaths = destIsDir ? sourcePaths.map((p) => joinPath(destAbs, basename2(p))) : [destAbs];
  }
  for (let k = 0; k < sourcePaths.length; k++) {
    emitSourceSpan(results, spec, sourcePaths[k], simpleCommandIndex, join7);
  }
  for (let k = 0; k < sourcePaths.length; k++) {
    results.push({
      status: "resolved",
      idiom: spec.idiom,
      span: { operation: spec.destOperation, absolutePath: destPaths[k], simpleCommandIndex, join: join7 }
    });
  }
}
var RM_NO_VALUE = /* @__PURE__ */ new Set(["-f", "-i", "-v"]);
var RM_EXCLUDED = /* @__PURE__ */ new Set(["-r", "-R", "--recursive", "-d"]);
var GIT_RM_EXCLUDED = /* @__PURE__ */ new Set(["-r", "-R", "--recursive", "-d", "-n", "--dry-run"]);
function matchRmOperands(args, excluded, excludeCached, dir, simpleCommandIndex, join7, results) {
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
      span: { operation: "delete", absolutePath: resolvePath(dir, operand), simpleCommandIndex, join: join7 }
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
function matchTruncateOperands(args, dir, simpleCommandIndex, join7, results) {
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
        join: join7,
        ...operand.size !== void 0 ? { size: operand.size } : {}
      }
    });
  }
}
function matchRmTruncate(argv, dirForResolution, simpleCommandIndex, join7, results) {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  if (command === "rm") {
    matchRmOperands(rest.slice(1), RM_EXCLUDED, false, dirForResolution, simpleCommandIndex, join7, results);
    return;
  }
  if (command === "truncate") {
    matchTruncateOperands(rest.slice(1), dirForResolution, simpleCommandIndex, join7, results);
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
        join7,
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
function classifyHeredocOpener(opener, body, quotedDelim, currentDir, simpleCommandIndex, join7, results) {
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
            join: join7,
            ...singlePlainAppend && r.op === ">>" && bodyLiteral ? { written: body } : {}
          }
        });
      } else {
        results.push({
          status: "resolved",
          idiom: "heredoc-write",
          span: body.length === 0 ? { operation: "truncate", absolutePath, simpleCommandIndex, join: join7 } : {
            operation: "create-overwrite",
            absolutePath,
            simpleCommandIndex,
            join: join7,
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
              join: join7,
              ...contentRedirects.length === 0 && bodyLiteral ? { written: body } : {}
            }
          });
        } else {
          results.push({
            status: "resolved",
            idiom: "heredoc-write",
            span: body.length === 0 ? { operation: "truncate", absolutePath, simpleCommandIndex, join: join7 } : {
              operation: "create-overwrite",
              absolutePath,
              simpleCommandIndex,
              join: join7,
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
    classifyPatchHeredoc(argv, body, currentDir, simpleCommandIndex, join7, results);
    return;
  }
}
var NUMERIC_SUBSTITUTION = /^(\d+)(?:,(\d+))?[sy]/;
var UNRESTRICTED_SUBSTITUTION = /^[sy]/;
function matchSedInplace(argv, dirForResolution, simpleCommandIndex, join7, results) {
  const rest = stripTransparentWrapper(argv);
  if (rest.length === 0) return;
  const command = rest[0];
  if (command === "sed") {
    matchSedInplaceArgs(rest.slice(1), dirForResolution, simpleCommandIndex, join7, results);
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
function matchSedInplaceArgs(args, dir, simpleCommandIndex, join7, results) {
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
        span: { operation: "modify", lineStart: start, lineEnd: end, absolutePath, simpleCommandIndex, join: join7 }
      });
    } else {
      results.push({
        status: "resolved",
        idiom: "sed-inplace",
        span: { operation: "modify", absolutePath, simpleCommandIndex, join: join7 }
      });
    }
    if (suffix !== null && suffix !== "") {
      results.push({
        status: "resolved",
        idiom: "sed-inplace",
        span: { operation: "create-overwrite", absolutePath: `${absolutePath}${suffix}`, simpleCommandIndex, join: join7 }
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
    return readFileSync4(absolutePath, "utf8");
  } catch {
    return null;
  }
}
function emitPatchTargets(args, isGitApply, host, targetDir, shellDir, redirects, simpleCommandIndex, join7, results) {
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
        join: join7,
        ...t.lineStart !== void 0 ? { lineStart: t.lineStart, lineEnd: t.lineEnd } : {}
      }
    });
  }
}
function matchPatchApply(argv, redirects, dirForResolution, simpleCommandIndex, join7, results) {
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
      join7,
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
      join7,
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
function classifyPatchHeredoc(argv, body, currentDir, simpleCommandIndex, join7, results) {
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
        join: join7,
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
function matchFormatter(argv, dirForResolution, simpleCommandIndex, join7, results) {
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
      span: { operation: "modify", absolutePath: resolvePath(dirForResolution, operand), simpleCommandIndex, join: join7 }
    });
  }
}
var RESTORE_NO_VALUE = /* @__PURE__ */ new Set(["-q", "-f", "-u"]);
function emitRestoreCheckoutPathspec(results, idiom, operand, dir, simpleCommandIndex, join7) {
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
    span: { operation: "create-overwrite", absolutePath, simpleCommandIndex, join: join7 }
  });
}
function matchRestoreOperands(args, dir, simpleCommandIndex, join7, results) {
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
    emitRestoreCheckoutPathspec(results, "git-restore-write", operand, dir, simpleCommandIndex, join7);
  }
}
function matchCheckoutOperands(args, dir, simpleCommandIndex, join7, results) {
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
    emitRestoreCheckoutPathspec(results, "git-checkout-write", operand, dir, simpleCommandIndex, join7);
  }
}
function matchGitRestoreCheckout(argv, dirForResolution, simpleCommandIndex, join7, results) {
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
    if (sub.subcommand === "restore") matchRestoreOperands(args, dir, simpleCommandIndex, join7, results);
    else matchCheckoutOperands(args, dir, simpleCommandIndex, join7, results);
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
function parseCommandDetailed(command, opts = {}) {
  const cwd = typeof opts === "string" ? opts : opts.cwd ?? process.cwd();
  const { writes: heredocWrites, masked } = extractHeredocWrites(command);
  const { stages: simpleCommands, malformed } = splitTopLevel(masked);
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
  const joinOf = (simple) => {
    if (simple.precededBy === "and") return "&&";
    if (simple.precededBy === "or") return "||";
    return void 0;
  };
  const gitDirOf = (c, frame) => {
    if (c.dirOverride === void 0) return frame.certain ? frame.dir : void 0;
    if (isAbsolute2(c.dirOverride)) return c.dirOverride;
    return frame.certain ? resolvePath(frame.dir, c.dirOverride) : void 0;
  };
  const emitCandidate = (c, frame, simpleCommandIndex, join7) => {
    if (looksUnresolvable(c.fileArg)) {
      results.push({
        status: "unresolved",
        idiom: c.idiom,
        fileArg: c.fileArg,
        reason: "path contains an unexpanded shell variable or glob"
      });
      return;
    }
    if (c.resolverKind === "fs") {
      if (!frame.certain && !isAbsolute2(c.fileArg)) {
        results.push({
          status: "unresolved",
          idiom: c.idiom,
          fileArg: c.fileArg,
          reason: "the working directory is uncertain \u2014 the relative path cannot be resolved"
        });
        return;
      }
    } else if (gitDirOf(c, frame) === void 0) {
      results.push({
        status: "unresolved",
        idiom: c.idiom,
        fileArg: c.fileArg,
        reason: "the git -C target cannot be resolved against the tracked directory"
      });
      return;
    }
    const resolutionDir = c.resolverKind === "fs" ? c.dirOverride === void 0 ? frame.dir : isAbsolute2(c.dirOverride) ? c.dirOverride : resolvePath(frame.dir, c.dirOverride) : gitDirOf(c, frame);
    const absolutePath = resolvePath(resolutionDir, c.fileArg);
    const totalLines = c.resolverKind === "fs" ? cachedFsTotalLines(absolutePath) : cachedGitTotalLines(resolutionDir, c.resolverKind.rev, c.fileArg);
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
        join: join7
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
      if (next === void 0 || next.precededBy !== "pipe") {
        emitCandidate(
          {
            kind: "candidate",
            idiom: argv[0] === "cat" ? "cat-file" : "nl-file",
            fileArg: plainFileArg,
            spec: { kind: "toEof", start: 1 },
            resolverKind: "fs"
          },
          { dir: currentDir, certain: true },
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
          emitCandidate(outcome, { dir: currentDir, certain: true }, i, joinOf(simple));
          if (outcome.idiom === "git-show-rev-path" && !looksUnresolvable(outcome.fileArg)) {
            isPlainSource = true;
            lastPlainFileSource = resolvePath(outcome.dirOverride ?? currentDir, outcome.fileArg);
          }
        }
      }
    }
    if (!matched && simple.precededBy === "pipe" && lastPlainFileSource) {
      const withFile = [...argv, lastPlainFileSource];
      for (const matcher of LINE_SELECTORS) {
        for (const outcome of matcher(withFile)) {
          if (outcome.kind === "candidate")
            emitCandidate(outcome, { dir: currentDir, certain: true }, i, joinOf(simple));
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
    if (simple.precededBy !== "pipe") pipeEchoContent = null;
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

// src/common/static-attribution.ts
var DEFAULT_MAX_ATTRIBUTION_CANDIDATES = 32;
var SHELL_EXPANSION = /(?:\$|`)/;
var GLOB_META = /[*?[\]]/;
var REGEX_META = /[.^$*+?()[\]{}|]/;
var STATIC_INTENT_COMMANDS = /* @__PURE__ */ new Set([
  ":",
  "autopep8",
  "biome",
  "black",
  "bunx",
  "cat",
  "cd",
  "clang-format",
  "command",
  "cp",
  "deno",
  "doas",
  "dprint",
  "echo",
  "env",
  "eslint",
  "false",
  "git",
  "gofmt",
  "goimports",
  "head",
  "install",
  "isort",
  "make",
  "mv",
  "nice",
  "nl",
  "node",
  "nohup",
  "npm",
  "npx",
  "patch",
  "perl",
  "pnpm",
  "prettier",
  "printf",
  "rm",
  "ruff",
  "rustfmt",
  "sed",
  "shfmt",
  "sudo",
  "tail",
  "tee",
  "terraform",
  "time",
  "truncate",
  "true",
  "xargs",
  "yapf",
  "yarn"
]);
var SHELL_INTENT_SYNTAX = /[<>|;&\n(){}$`]/;
var STATICALLY_SILENT_GIT_SUBCOMMANDS = /* @__PURE__ */ new Set([
  "add",
  "branch",
  "commit",
  "config",
  "diff",
  "fetch",
  "ls-files",
  "pull",
  "push",
  "remote",
  "rev-parse",
  "status",
  "tag",
  "worktree"
]);
function canCarryStaticIntent(command) {
  const trimmed = command.trimStart();
  if (trimmed.length === 0) return false;
  if (SHELL_INTENT_SYNTAX.test(trimmed)) return true;
  const firstWord = trimmed.match(/^[^\s]+/)?.[0] ?? "";
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(firstWord)) return true;
  if (/^python(?:3(?:\.\d+)?)?$/.test(firstWord)) return true;
  if (firstWord === "git") {
    const subcommand = trimmed.slice(firstWord.length).trimStart().match(/^[^\s]+/)?.[0] ?? "";
    if (STATICALLY_SILENT_GIT_SUBCOMMANDS.has(subcommand)) return false;
  }
  return STATIC_INTENT_COMMANDS.has(firstWord);
}
function unresolved(layer, idiom, reasonCode, detail, fileArg, simpleCommandIndex = 0) {
  return { status: "unresolved", layer, idiom, reasonCode, detail, fileArg, simpleCommandIndex };
}
function classifyDynamicWord(word) {
  if (word.includes("$(") || word.includes("`")) return "command-substitution";
  if (SHELL_EXPANSION.test(word)) return "dynamic-path";
  if (GLOB_META.test(word)) return "glob-path";
  return null;
}
function decodeLiteralField(raw, delimiter, replacement) {
  let value = "";
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (character === "\\") {
      const next = raw[index + 1];
      if (next === void 0) return null;
      if (next === "n") value += "\n";
      else if (next === delimiter || next === "\\" || !replacement && REGEX_META.test(next)) value += next;
      else return null;
      index += 1;
      continue;
    }
    if (!replacement && REGEX_META.test(character) || replacement && character === "&") return null;
    value += character;
  }
  return value;
}
function readDelimitedField(source, start, delimiter) {
  let raw = "";
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") {
      const next = source[index + 1];
      if (next === void 0) return null;
      raw += `${character}${next}`;
      index += 1;
      continue;
    }
    if (character === delimiter) return { raw, next: index + 1 };
    raw += character;
  }
  return null;
}
function parseLiteralSubstitution(script) {
  if (script.length < 4 || script[0] !== "s") return null;
  const delimiter = script[1];
  if (/\w|\s/.test(delimiter)) return null;
  const patternField = readDelimitedField(script, 2, delimiter);
  if (patternField === null) return null;
  const replacementField = readDelimitedField(script, patternField.next, delimiter);
  if (replacementField === null) return null;
  const flags = script.slice(replacementField.next);
  if (flags !== "" && flags !== "g") return null;
  const pattern = decodeLiteralField(patternField.raw, delimiter, false);
  const replacement = decodeLiteralField(replacementField.raw, delimiter, true);
  if (pattern === null || pattern.length === 0 || replacement === null) return null;
  return { pattern, replacement, global: flags === "g" };
}
function literalOccurrenceRanges(content, literal) {
  if (literal.length === 0) return [];
  const ranges = [];
  let cursor = 0;
  let scannedTo = 0;
  let currentLine = 1;
  while (cursor <= content.length - literal.length) {
    const offset = content.indexOf(literal, cursor);
    if (offset < 0) break;
    for (let index = scannedTo; index < offset; index += 1) {
      if (content.charCodeAt(index) === 10) currentLine += 1;
    }
    const embeddedNewlines = literal.match(/\n/g)?.length ?? 0;
    const range = { start: currentLine, end: currentLine + embeddedNewlines };
    const previous = ranges[ranges.length - 1];
    if (previous === void 0 || previous.start !== range.start || previous.end !== range.end) ranges.push(range);
    cursor = offset + Math.max(1, literal.length);
    scannedTo = offset;
  }
  return ranges;
}
function replaceLiteral(source, pattern, replacement, global) {
  if (global) return source.split(pattern).join(replacement);
  const offset = source.indexOf(pattern);
  if (offset < 0) return source;
  return `${source.slice(0, offset)}${replacement}${source.slice(offset + pattern.length)}`;
}
function expectedSubstitutionContent(content, substitution, kind, addressLiteral) {
  if (kind === "perl-zero") {
    return replaceLiteral(content, substitution.pattern, substitution.replacement, substitution.global);
  }
  return content.split(/(?<=\n)/).map((line) => {
    if (addressLiteral !== null && !line.includes(addressLiteral)) return line;
    return replaceLiteral(line, substitution.pattern, substitution.replacement, substitution.global);
  }).join("");
}
function parsePatternCommand(command) {
  const argv = argvOf(command.trim());
  if (argv === null || argv.length < 2) return null;
  if (argv[0] === "sed") {
    let inplace2 = false;
    let backupSuffix;
    let script2 = null;
    const files2 = [];
    for (let index = 1; index < argv.length; index += 1) {
      const argument = argv[index];
      if (argument === "-i") {
        inplace2 = true;
        continue;
      }
      if (argument.startsWith("-i")) {
        inplace2 = true;
        backupSuffix = argument.slice(2);
        continue;
      }
      if (argument === "-e") {
        script2 = argv[index + 1] ?? null;
        index += 1;
        continue;
      }
      if (argument.startsWith("-"))
        return inplace2 ? { kind: "sed", script: "", files: [], backupSuffix, simpleCommandIndex: 0 } : null;
      if (script2 === null) script2 = argument;
      else files2.push(argument);
    }
    return inplace2 && script2 !== null ? { kind: "sed", script: script2, files: files2, backupSuffix, simpleCommandIndex: 0 } : null;
  }
  if (argv[0] !== "perl") return null;
  let inplace = false;
  let zero = false;
  let script = null;
  const files = [];
  let unsupportedOption = false;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "-e") {
      script = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) {
      const attachedScript = argument.match(/^-e(.+)$/)?.[1];
      if (attachedScript !== void 0) {
        script = attachedScript;
        continue;
      }
      if (argument === "-pi") inplace = true;
      else if (argument === "-0pi") {
        inplace = true;
        zero = true;
      } else {
        if (argument.includes("p") && argument.includes("i")) inplace = true;
        unsupportedOption = true;
      }
      continue;
    }
    files.push(argument);
  }
  if (unsupportedOption && inplace)
    return { kind: zero ? "perl-zero" : "perl", script: "", files: [], simpleCommandIndex: 0 };
  return inplace && script !== null ? { kind: zero ? "perl-zero" : "perl", script, files, simpleCommandIndex: 0 } : null;
}
function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
function expandLiteralLoopVariable(body, variable, binding) {
  let command = "";
  let quote = null;
  let replacements = 0;
  let unsafeUnquoted = false;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === "\\" && quote !== "'") {
      command += character;
      if (index + 1 < body.length) command += body[++index];
      continue;
    }
    if (character === "'" && quote !== '"') {
      quote = quote === "'" ? null : "'";
      command += character;
      continue;
    }
    if (character === '"' && quote !== "'") {
      quote = quote === '"' ? null : '"';
      command += character;
      continue;
    }
    if (character !== "$" || quote === "'") {
      command += character;
      continue;
    }
    const braced = body.startsWith(`\${${variable}}`, index);
    const plain = body.startsWith(`$${variable}`, index);
    const suffix = body[index + variable.length + 1];
    if (!braced && (!plain || suffix !== void 0 && /[A-Za-z0-9_]/.test(suffix))) {
      command += character;
      continue;
    }
    const length = braced ? variable.length + 3 : variable.length + 1;
    if (quote === null && /\s/.test(binding)) unsafeUnquoted = true;
    command += quote === '"' ? binding.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$") : shellQuote(binding);
    replacements += 1;
    index += length - 1;
  }
  return { command, replacements, unsafeUnquoted };
}
function stableReason(match) {
  if (match.fileArg.includes("$(") || match.fileArg.includes("`")) return "command-substitution";
  if (SHELL_EXPANSION.test(match.fileArg)) return "dynamic-path";
  if (GLOB_META.test(match.fileArg)) return "glob-path";
  if (match.reason.includes("working directory")) return "dynamic-path";
  return "unsupported-expression";
}
function createPythonContext(options) {
  return {
    cwd: options.cwd ?? process.cwd(),
    options,
    paths: /* @__PURE__ */ new Map(),
    texts: /* @__PURE__ */ new Map(),
    replacements: /* @__PURE__ */ new Map(),
    anchors: /* @__PURE__ */ new Map(),
    lines: /* @__PURE__ */ new Map(),
    structured: /* @__PURE__ */ new Map(),
    countAssertions: /* @__PURE__ */ new Map(),
    resolved: [],
    preStateRequests: []
  };
}
function rejectPython(reasonCode, detail, fileArg, preStateRequests = []) {
  return {
    resolved: [],
    unresolved: [unresolved("python", "python-edit", reasonCode, detail, fileArg)],
    preStateRequests
  };
}
function requestPythonPreState(ctx, absolutePath, operation, requirement) {
  if (!ctx.preStateRequests.some(
    (entry) => entry.absolutePath === absolutePath && entry.operation === operation && entry.requirement === requirement
  )) {
    ctx.preStateRequests.push({ absolutePath, operation, requirement, simpleCommandIndex: 0 });
  }
}
function readPythonPreState(ctx, absolutePath, requirements) {
  for (const requirement of requirements) requestPythonPreState(ctx, absolutePath, "modify", requirement);
  const content = ctx.options.readPreState?.(absolutePath) ?? null;
  if (content === null)
    return rejectPython(
      "missing-pre-state",
      "Python range recovery requires pre-command text",
      absolutePath,
      ctx.preStateRequests
    );
  if (content.includes("\0"))
    return rejectPython(
      "binary-content",
      "Python range recovery does not accept binary content",
      absolutePath,
      ctx.preStateRequests
    );
  return content;
}
function pythonReplacementRequirements(transformation) {
  const requirements = ["match-locations"];
  if (transformation.replacement.length === 0 || (transformation.pattern.match(/\n/g)?.length ?? 0) !== (transformation.replacement.match(/\n/g)?.length ?? 0)) {
    requirements.push("deleted-text");
  }
  return requirements;
}
function expectedPythonReplacement(content, transformation, occurrences) {
  if (transformation.count === void 0) {
    return content.split(transformation.pattern).join(transformation.replacement);
  }
  let expected = content;
  for (let index = 0; index < Math.min(transformation.count, occurrences); index += 1) {
    expected = replaceLiteral(expected, transformation.pattern, transformation.replacement, false);
  }
  return expected;
}
function emitPythonReplace(ctx, absolutePath, transformation) {
  const read = ctx.texts.get(transformation.source);
  if (read === void 0 || nodePath4.resolve(ctx.cwd, read.path) !== absolutePath) {
    return rejectPython("unsupported-dataflow", "Python read and write paths are not provably identical", absolutePath);
  }
  const content = readPythonPreState(ctx, absolutePath, pythonReplacementRequirements(transformation));
  if (typeof content !== "string") return content;
  const assertion = ctx.countAssertions.get(`${transformation.source}\0${transformation.pattern}`);
  const occurrences = countLiteralOccurrences(content, transformation.pattern);
  if (assertion !== void 0 && occurrences !== assertion) {
    return rejectPython(
      "evidence-mismatch",
      "Python count assertion does not match pre-state",
      absolutePath,
      ctx.preStateRequests
    );
  }
  const count = transformation.count ?? occurrences;
  const ranges = literalOccurrenceRanges(content, transformation.pattern).slice(0, count);
  if (ranges.length === 0) {
    return rejectPython(
      "evidence-mismatch",
      "Python replacement literal is absent from pre-state",
      absolutePath,
      ctx.preStateRequests
    );
  }
  const expected = expectedPythonReplacement(content, transformation, occurrences);
  for (const range of ranges) {
    ctx.resolved.push({
      status: "resolved",
      layer: "python",
      idiom: "python-replace",
      span: {
        operation: "modify",
        absolutePath,
        lineStart: range.start,
        lineEnd: range.end,
        expectedContent: expected,
        simpleCommandIndex: 0
      }
    });
  }
  return null;
}
var PYTHON_INTERPRETER = /^(?:python|python3(?:\.\d+)?)$/;
var PYTHON_STRING_SOURCE = String.raw`(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")`;
var PYTHON_NAME_SOURCE = `[A-Za-z_][A-Za-z0-9_]*`;
var compiledPatternCache = /* @__PURE__ */ new Map();
function compileOnce(source, flags) {
  const key = `${flags ?? ""}\0${source}`;
  let pattern = compiledPatternCache.get(key);
  if (pattern === void 0) {
    pattern = new RegExp(source, flags);
    compiledPatternCache.set(key, pattern);
  }
  return pattern;
}
var PYTHON_PATH_LITERAL_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\s*=\\s*(?:Path|pathlib\\.Path)\\((${PYTHON_STRING_SOURCE})\\)$`
);
var PYTHON_STRING_BINDING_PATTERN = new RegExp(`^(${PYTHON_NAME_SOURCE})\\s*=\\s*(${PYTHON_STRING_SOURCE})$`);
var PYTHON_NAME_ALIAS_PATTERN = new RegExp(`^(${PYTHON_NAME_SOURCE})\\s*=\\s*(${PYTHON_NAME_SOURCE})$`);
var PYTHON_TEXT_READ_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\s*=\\s*(${PYTHON_NAME_SOURCE})\\.read_text\\(([^)]*)\\)$`
);
var PYTHON_REPLACE_BINDING_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\s*=\\s*(${PYTHON_NAME_SOURCE})\\.replace\\((${PYTHON_STRING_SOURCE})\\s*,\\s*(${PYTHON_STRING_SOURCE})(?:\\s*,\\s*(\\d+))?\\)$`
);
var PYTHON_COUNT_ASSERT_PATTERN = new RegExp(
  `^assert\\s+(${PYTHON_NAME_SOURCE})\\.count\\((${PYTHON_STRING_SOURCE})\\)\\s*==\\s*(\\d+)$`
);
var PYTHON_INDEX_ANCHOR_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\s*=\\s*(${PYTHON_NAME_SOURCE})\\.index\\((${PYTHON_STRING_SOURCE})\\)$`
);
var PYTHON_LINE_ARRAY_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\s*=\\s*(${PYTHON_NAME_SOURCE})\\.read_text\\(\\)\\.splitlines\\(\\)$`
);
var PYTHON_LINE_EDIT_PATTERN = new RegExp(`^(${PYTHON_NAME_SOURCE})\\[(\\d+)\\]\\s*=\\s*(${PYTHON_STRING_SOURCE})$`);
var PYTHON_STRUCTURED_LOAD_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\s*=\\s*(json|tomllib|yaml)\\.(?:loads|safe_load)\\((${PYTHON_NAME_SOURCE})\\.read_text\\(\\)\\)$`
);
var PYTHON_STRUCTURED_ASSIGN_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})((?:\\[${PYTHON_STRING_SOURCE}\\])+?)\\s*=\\s*(?:True|False|None|-?\\d+(?:\\.\\d+)?|${PYTHON_STRING_SOURCE})$`
);
var PYTHON_STRUCTURED_KEY_SCAN_PATTERN = new RegExp(`\\[(${PYTHON_STRING_SOURCE})\\]`, "g");
var PYTHON_APPEND_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\.open\\((${PYTHON_STRING_SOURCE})\\)\\.write\\((${PYTHON_STRING_SOURCE})\\)$`
);
var PYTHON_WRITE_TARGET_PATTERN = new RegExp(`^(${PYTHON_NAME_SOURCE})\\.write_text\\((.+)\\)$`);
var PYTHON_DIRECT_REPLACE_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\.replace\\((${PYTHON_STRING_SOURCE})\\s*,\\s*(${PYTHON_STRING_SOURCE})(?:\\s*,\\s*(\\d+))?\\)$`
);
var PYTHON_ANCHOR_SLICE_PATTERN = new RegExp(
  `^(${PYTHON_NAME_SOURCE})\\[:(${PYTHON_NAME_SOURCE})\\]\\s*\\+\\s*(${PYTHON_STRING_SOURCE})\\s*\\+\\s*\\1\\[\\2\\s*\\+\\s*(\\d+):\\]$`
);
var PYTHON_LINE_JOIN_PATTERN = new RegExp(
  `^(${PYTHON_STRING_SOURCE})\\.join\\((${PYTHON_NAME_SOURCE})\\)(?:\\s*\\+\\s*(${PYTHON_STRING_SOURCE}))?$`
);
function decodePythonString(raw) {
  if (raw.length < 2 || raw[0] !== "'" && raw[0] !== '"' || raw.at(-1) !== raw[0]) return null;
  let value = "";
  for (let index = 1; index < raw.length - 1; index += 1) {
    const character = raw[index];
    if (character !== "\\") {
      if (character === raw[0]) return null;
      value += character;
      continue;
    }
    const escaped = raw[index + 1];
    if (escaped === void 0 || index + 1 >= raw.length - 1) return null;
    if (escaped === "n") value += "\n";
    else if (escaped === "r") value += "\r";
    else if (escaped === "t") value += "	";
    else if (escaped === "\\" || escaped === "'" || escaped === '"') value += escaped;
    else return null;
    index += 1;
  }
  return value;
}
function extractPythonProgram(command) {
  const trimmed = command.trim();
  const interpreter = trimmed.match(/^(python(?:3(?:\.\d+)?)?)\b/)?.[1];
  if (interpreter === void 0 || !PYTHON_INTERPRETER.test(interpreter)) return null;
  if (trimmed.includes("<<")) {
    const heredoc = trimmed.match(
      /^(?:python|python3(?:\.\d+)?)\s+-\s+<<(['"])([A-Za-z_][A-Za-z0-9_]*)\1[ \t]*\r?\n([\s\S]*?)\r?\n\2[ \t]*$/
    );
    if (heredoc === null) {
      return {
        reason: "unsupported-syntax",
        detail: "Python heredocs require a quoted literal delimiter and a complete body"
      };
    }
    return { program: heredoc[3] };
  }
  const argv = argvOf(trimmed);
  if (argv === null || argv[0] !== interpreter || argv[1] !== "-c" || argv[2] === void 0) {
    return {
      reason: "unsupported-syntax",
      detail: "only literal Python -c programs and quoted heredocs are supported"
    };
  }
  if (argv[2].includes("$(") || argv[2].includes("`") || /^\$\{?[A-Za-z_]/.test(argv[2])) {
    return { reason: "unsupported-syntax", detail: "the Python program is shell-derived rather than literal" };
  }
  return { program: argv[2] };
}
function splitPythonStatements(program) {
  const statements = [];
  let statement = "";
  let quote = null;
  let escaped = false;
  let depth = 0;
  let comment = false;
  for (const character of program) {
    if (comment) {
      if (character === "\n") {
        comment = false;
        if (depth === 0 && statement.trim() !== "") {
          statements.push(statement.trim());
          statement = "";
        }
      }
      continue;
    }
    if (quote !== null) {
      statement += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      statement += character;
      continue;
    }
    if (character === "#") {
      comment = true;
      continue;
    }
    if (character === "(" || character === "[" || character === "{") depth += 1;
    else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      if (depth < 0) return null;
    }
    if ((character === "\n" || character === ";") && depth === 0) {
      if (statement.trim() !== "") statements.push(statement.trim());
      statement = "";
      continue;
    }
    statement += character;
  }
  if (quote !== null || escaped || depth !== 0) return null;
  if (statement.trim() !== "") statements.push(statement.trim());
  return statements;
}
function pythonLineAtOffset(content, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) if (content.charCodeAt(index) === 10) line += 1;
  return line;
}
function countLiteralOccurrences(content, literal) {
  if (literal.length === 0) return 0;
  let count = 0;
  let cursor = 0;
  while (cursor <= content.length - literal.length) {
    const offset = content.indexOf(literal, cursor);
    if (offset < 0) break;
    count += 1;
    cursor = offset + literal.length;
  }
  return count;
}
function structuredKeyRanges(content, format, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = format === "json" ? compileOnce(`^[ \\t]*["']${escaped}["'][ \\t]*:`, "m") : format === "toml" ? compileOnce(`^[ \\t]*(?:["']${escaped}["']|${escaped})[ \\t]*=`, "m") : compileOnce(`^[ \\t]*(?:["']${escaped}["']|${escaped})[ \\t]*:`, "m");
  const ranges = [];
  let offset = 0;
  for (const line of content.split(/(?<=\n)/)) {
    if (pattern.test(line)) {
      const number = pythonLineAtOffset(content, offset);
      ranges.push({ start: number, end: number });
    }
    offset += line.length;
  }
  return ranges;
}
function consumeUnmatchedPython(statement) {
  if (/sys\.argv|os\.(?:environ|getenv)|input\s*\(/.test(statement)) {
    return rejectPython("dynamic-path", "Python target depends on runtime input");
  }
  return rejectPython(
    /(?:\.write|open\s*\(|Path\s*\()/.test(statement) ? "unsupported-dataflow" : "unsupported-syntax",
    "Python statement is outside the bounded lexical/dataflow allowlist"
  );
}
function consumePythonStatement(statement, ctx) {
  let match = statement.match(PYTHON_PATH_LITERAL_PATTERN);
  if (match !== null) {
    const path = decodePythonString(match[2]);
    if (path === null) return rejectPython("unsupported-syntax", "Python path literal uses an unsupported escape");
    ctx.paths.set(match[1], { path, depth: 0 });
    return void 0;
  }
  match = statement.match(PYTHON_STRING_BINDING_PATTERN);
  if (match !== null) {
    const path = decodePythonString(match[2]);
    if (path === null) return rejectPython("unsupported-syntax", "Python string literal uses an unsupported escape");
    ctx.paths.set(match[1], { path, depth: 0 });
    return void 0;
  }
  match = statement.match(PYTHON_NAME_ALIAS_PATTERN);
  if (match !== null) {
    const source = ctx.paths.get(match[2]);
    if (source === void 0 || source.depth !== 0) {
      return rejectPython("unsupported-dataflow", "Python path aliases are limited to one literal hop");
    }
    ctx.paths.set(match[1], { path: source.path, depth: 1 });
    return void 0;
  }
  match = statement.match(PYTHON_TEXT_READ_PATTERN);
  if (match !== null) {
    const binding = ctx.paths.get(match[2]);
    if (binding === void 0) return rejectPython("dynamic-path", "Python read target is not a literal path binding");
    if (match[3].trim() !== "" && !/^encoding\s*=\s*['"]utf-?8['"]$/.test(match[3].trim())) {
      return rejectPython(
        "unsupported-encoding",
        "only default or UTF-8 Python text reads are supported",
        binding.path
      );
    }
    ctx.texts.set(match[1], { path: binding.path });
    return void 0;
  }
  match = statement.match(PYTHON_REPLACE_BINDING_PATTERN);
  if (match !== null) {
    if (!ctx.texts.has(match[2]))
      return rejectPython("unsupported-dataflow", "Python replace source is not a direct text read");
    const pattern = decodePythonString(match[3]);
    const replacement = decodePythonString(match[4]);
    const count = match[5] === void 0 ? void 0 : Number.parseInt(match[5], 10);
    if (pattern === null || pattern.length === 0 || replacement === null || count === 0) {
      return rejectPython(
        "unsupported-expression",
        "Python replace requires non-empty literal input and a positive count"
      );
    }
    ctx.replacements.set(match[1], { source: match[2], pattern, replacement, count });
    return void 0;
  }
  match = statement.match(PYTHON_COUNT_ASSERT_PATTERN);
  if (match !== null) {
    const literal = decodePythonString(match[2]);
    if (literal === null || literal.length === 0 || !ctx.texts.has(match[1])) {
      return rejectPython("unsupported-dataflow", "Python count assertion is not tied to a direct text read");
    }
    ctx.countAssertions.set(`${match[1]}\0${literal}`, Number.parseInt(match[3], 10));
    return void 0;
  }
  match = statement.match(PYTHON_INDEX_ANCHOR_PATTERN);
  if (match !== null) {
    const literal = decodePythonString(match[3]);
    if (literal === null || literal.length === 0 || !ctx.texts.has(match[2])) {
      return rejectPython("unsupported-dataflow", "Python index anchor is not tied to a direct text read");
    }
    ctx.anchors.set(match[1], { source: match[2], literal });
    return void 0;
  }
  match = statement.match(PYTHON_LINE_ARRAY_PATTERN);
  if (match !== null) {
    const binding = ctx.paths.get(match[2]);
    if (binding === void 0) return rejectPython("dynamic-path", "Python line-array target is not literal");
    ctx.lines.set(match[1], { path: binding.path, edits: /* @__PURE__ */ new Map() });
    return void 0;
  }
  match = statement.match(PYTHON_LINE_EDIT_PATTERN);
  if (match !== null) {
    const array = ctx.lines.get(match[1]);
    const value = decodePythonString(match[3]);
    if (array === void 0 || value === null)
      return rejectPython("unsupported-dataflow", "line edit is not a bounded literal array edit");
    array.edits.set(Number.parseInt(match[2], 10), value);
    return void 0;
  }
  match = statement.match(PYTHON_STRUCTURED_LOAD_PATTERN);
  if (match !== null) {
    const binding = ctx.paths.get(match[3]);
    if (binding === void 0) return rejectPython("dynamic-path", "structured Python load target is not literal");
    const format = match[2] === "tomllib" ? "toml" : match[2];
    ctx.structured.set(match[1], { format, path: binding.path, keys: [] });
    return void 0;
  }
  match = statement.match(PYTHON_STRUCTURED_ASSIGN_PATTERN);
  if (match !== null && ctx.structured.has(match[1])) {
    const keys = [...match[2].matchAll(PYTHON_STRUCTURED_KEY_SCAN_PATTERN)].map((key) => decodePythonString(key[1]));
    if (keys.length === 0 || keys.some((key) => key === null)) {
      return rejectPython("unsupported-expression", "structured Python mutation requires literal string keys");
    }
    ctx.structured.get(match[1]).keys.push(keys);
    return void 0;
  }
  match = statement.match(PYTHON_APPEND_PATTERN);
  if (match !== null) {
    const binding = ctx.paths.get(match[1]);
    const mode = decodePythonString(match[2]);
    const written = decodePythonString(match[3]);
    if (binding === void 0) return rejectPython("dynamic-path", "Python append target is not literal");
    if (mode !== "a" || written === null)
      return rejectPython("unsupported-expression", "only literal text append mode is supported");
    const absolutePath = nodePath4.resolve(ctx.cwd, binding.path);
    requestPythonPreState(ctx, absolutePath, "append", "pre-command-eof");
    const content = ctx.options.readPreState?.(absolutePath) ?? null;
    if (content === null)
      return rejectPython(
        "missing-pre-state",
        "Python append range requires pre-command text",
        absolutePath,
        ctx.preStateRequests
      );
    if (content.includes("\0"))
      return rejectPython(
        "binary-content",
        "Python append does not accept binary content",
        absolutePath,
        ctx.preStateRequests
      );
    const line = pythonLineAtOffset(content, content.length);
    ctx.resolved.push({
      status: "resolved",
      layer: "python",
      idiom: "python-append",
      span: {
        operation: "append",
        absolutePath,
        lineStart: line,
        lineEnd: line,
        written,
        expectedContent: `${content}${written}`,
        simpleCommandIndex: 0
      }
    });
    return void 0;
  }
  match = statement.match(PYTHON_WRITE_TARGET_PATTERN);
  if (match !== null) {
    const binding = ctx.paths.get(match[1]);
    if (binding === void 0) return rejectPython("dynamic-path", "Python write target is not literal");
    const absolutePath = nodePath4.resolve(ctx.cwd, binding.path);
    return resolvePythonWriteSink(ctx, match[2].trim(), absolutePath);
  }
  return "unmatched";
}
function preparePythonStatements(command) {
  const extracted = extractPythonProgram(command);
  if (extracted === null) return { kind: "unrecognized" };
  if (extracted.program === void 0) {
    return {
      kind: "rejected",
      result: rejectPython(
        extracted.reason ?? "unsupported-syntax",
        extracted.detail ?? "unsupported Python invocation"
      )
    };
  }
  const statements = splitPythonStatements(extracted.program);
  if (statements === null || statements.length === 0) {
    return {
      kind: "rejected",
      result: rejectPython("unsupported-syntax", "the Python program is incomplete or cannot be tokenized")
    };
  }
  if (statements.length > 64) {
    return {
      kind: "rejected",
      result: rejectPython("candidate-budget-exceeded", "the Python program exceeds the statement budget")
    };
  }
  return { kind: "ready", statements };
}
function runPythonStatements(statements, ctx) {
  for (const statement of statements) {
    if (/^(?:from\s+pathlib\s+import\s+Path|import\s+(?:pathlib|json|tomllib|tomli_w|toml|yaml|sys)(?:\s*,\s*(?:pathlib|json|tomllib|tomli_w|toml|yaml|sys))*)$/.test(
      statement
    )) {
      continue;
    }
    if (/^(?:for|while|if|def|class|with|try)\b/.test(statement)) {
      return rejectPython("unsupported-dataflow", "control flow is outside the bounded Python recognizer");
    }
    const verdict = consumePythonStatement(statement, ctx);
    if (verdict === void 0) continue;
    return verdict === "unmatched" ? consumeUnmatchedPython(statement) : verdict;
  }
  return null;
}
function parsePythonAttribution(command, options) {
  const prepared = preparePythonStatements(command);
  if (prepared.kind === "unrecognized") return null;
  if (prepared.kind === "rejected") return prepared.result;
  const ctx = createPythonContext(options);
  const rejected = runPythonStatements(prepared.statements, ctx);
  if (rejected !== null) return rejected;
  if (ctx.resolved.length === 0)
    return rejectPython("unsupported-dataflow", "Python program has no supported authoring sink");
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_ATTRIBUTION_CANDIDATES;
  const overBudget = rejectOverBudget(ctx.resolved, "python", "python-edit", "Python program", maxCandidates);
  if (overBudget !== null) return overBudget;
  return { resolved: ctx.resolved, unresolved: [], preStateRequests: ctx.preStateRequests };
}
var NODE_STRING_SOURCE = String.raw`(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")`;
var NODE_NAME_SOURCE = `[A-Za-z_$][A-Za-z0-9_$]*`;
var NODE_FS_MEMBER_PATTERN = new RegExp(`^(${NODE_NAME_SOURCE})\\.(readFileSync|writeFileSync|appendFileSync)$`);
var NODE_REQUIRE_FS_PATTERN = new RegExp(
  `^(?:const|let|var)\\s+(${NODE_NAME_SOURCE})\\s*=\\s*require\\((['"])(?:node:)?fs\\2\\)$`
);
var NODE_STRING_DECL_PATTERN = new RegExp(
  `^(?:const|let|var)\\s+(${NODE_NAME_SOURCE})\\s*=\\s*(${NODE_STRING_SOURCE})$`
);
var NODE_NAME_ALIAS_PATTERN = new RegExp(
  `^(?:const|let|var)\\s+(${NODE_NAME_SOURCE})\\s*=\\s*(${NODE_NAME_SOURCE})$`
);
var NODE_GENERIC_DECL_PATTERN = new RegExp(`^(?:const|let|var)\\s+(${NODE_NAME_SOURCE})\\s*=\\s*(.+)$`);
var NODE_REPLACE_CALL_PATTERN = new RegExp(
  `^(${NODE_NAME_SOURCE})\\.(replace|replaceAll)\\((${NODE_STRING_SOURCE})\\s*,\\s*(${NODE_STRING_SOURCE})\\)$`
);
var NODE_JSON_PARSE_PATTERN = new RegExp(`^JSON\\.parse\\((${NODE_NAME_SOURCE})\\)$`);
var NODE_STRUCTURED_ASSIGN_PATTERN = new RegExp(
  `^(${NODE_NAME_SOURCE})((?:(?:\\.${NODE_NAME_SOURCE})|(?:\\[${NODE_STRING_SOURCE}\\]))+)\\s*=\\s*(.+)$`
);
var NODE_KEY_SEGMENT_SCAN_PATTERN = new RegExp(`\\.(${NODE_NAME_SOURCE})|\\[(${NODE_STRING_SOURCE})\\]`, "g");
var NODE_COUNT_GUARD_PATTERN = new RegExp(
  `^if\\s*\\(\\s*(${NODE_NAME_SOURCE})\\.split\\((${NODE_STRING_SOURCE})\\)\\.length\\s*-\\s*1\\s*!==?\\s*(\\d+)\\s*\\)\\s*throw\\b.+$`
);
function decodeNodeString(raw) {
  if (raw.length < 2 || raw[0] !== "'" && raw[0] !== '"' || raw.at(-1) !== raw[0]) return null;
  let value = "";
  for (let index = 1; index < raw.length - 1; index += 1) {
    const character = raw[index];
    if (character !== "\\") {
      if (character === raw[0] || character === "\n" || character === "\r") return null;
      value += character;
      continue;
    }
    const escaped = raw[index + 1];
    if (escaped === void 0 || index + 1 >= raw.length - 1) return null;
    if (escaped === "n") value += "\n";
    else if (escaped === "r") value += "\r";
    else if (escaped === "t") value += "	";
    else if (escaped === "b") value += "\b";
    else if (escaped === "f") value += "\f";
    else if (escaped === "v") value += "\v";
    else if (escaped === "0") value += "\0";
    else if (escaped === "\\" || escaped === "'" || escaped === '"') value += escaped;
    else return null;
    index += 1;
  }
  return value;
}
function extractNodeProgram(command) {
  const trimmed = command.trim();
  if (!/^node\b/.test(trimmed)) return null;
  if (trimmed.includes("<<")) {
    const heredoc = trimmed.match(
      /^node(?:\s+-)?\s+<<(['"])([A-Za-z_][A-Za-z0-9_]*)\1[ \t]*\r?\n([\s\S]*?)\r?\n\2[ \t]*$/
    );
    if (heredoc === null) {
      return {
        reason: "unsupported-syntax",
        detail: "Node heredocs require a quoted literal delimiter and a complete body"
      };
    }
    return { program: heredoc[3] };
  }
  const argv = argvOf(trimmed);
  if (argv === null) {
    return /^node\s+-e(?:\s|$)/.test(trimmed) ? { reason: "unsupported-syntax", detail: "the literal Node -e program cannot be tokenized" } : null;
  }
  if (argv[0] !== "node" || argv[1] !== "-e") return null;
  if (argv[2] === void 0) return { reason: "unsupported-syntax", detail: "Node -e requires a literal program" };
  if (argv[2].includes("$(") || argv[2].includes("`") || /^\$\{?[A-Za-z_]/.test(argv[2])) {
    return { reason: "unsupported-syntax", detail: "the Node program is shell-derived rather than literal" };
  }
  return { program: argv[2] };
}
function splitNodeStatements(program) {
  if (program.includes("`")) return null;
  const statements = [];
  let statement = "";
  let quote = null;
  let escaped = false;
  let depth = 0;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < program.length; index += 1) {
    const character = program[index];
    const next = program[index + 1];
    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
        if (depth === 0 && statement.trim() !== "") {
          statements.push(statement.trim());
          statement = "";
        }
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== null) {
      statement += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      statement += character;
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "(" || character === "[" || character === "{") depth += 1;
    else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      if (depth < 0) return null;
    }
    if ((character === ";" || character === "\n") && depth === 0) {
      if (statement.trim() !== "") statements.push(statement.trim());
      statement = "";
      continue;
    }
    statement += character;
  }
  if (quote !== null || escaped || depth !== 0 || blockComment) return null;
  if (statement.trim() !== "") statements.push(statement.trim());
  return statements;
}
function splitNodeArguments(source) {
  const arguments_ = [];
  let argument = "";
  let quote = null;
  let escaped = false;
  let depth = 0;
  for (const character of source) {
    if (quote !== null) {
      argument += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      argument += character;
      continue;
    }
    if (character === "(" || character === "[" || character === "{") depth += 1;
    else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      if (depth < 0) return null;
    }
    if (character === "," && depth === 0) {
      arguments_.push(argument.trim());
      argument = "";
      continue;
    }
    argument += character;
  }
  if (quote !== null || escaped || depth !== 0) return null;
  if (argument.trim() !== "" || arguments_.length > 0) arguments_.push(argument.trim());
  return arguments_;
}
function emitPythonAnchorSlice(ctx, expression, absolutePath) {
  const slice = expression.match(PYTHON_ANCHOR_SLICE_PATTERN);
  if (slice === null) return "unmatched";
  const anchor = ctx.anchors.get(slice[2]);
  const read = ctx.texts.get(slice[1]);
  const replacementText = decodePythonString(slice[3]);
  if (anchor === void 0 || read === void 0 || anchor.source !== slice[1] || replacementText === null || Number.parseInt(slice[4], 10) !== anchor.literal.length || nodePath4.resolve(ctx.cwd, read.path) !== absolutePath) {
    return rejectPython(
      "unsupported-dataflow",
      "Python slice reconstruction is not tied to one literal anchor",
      absolutePath
    );
  }
  const content = readPythonPreState(ctx, absolutePath, ["match-locations", "deleted-text"]);
  if (typeof content !== "string") return content;
  const offset = content.indexOf(anchor.literal);
  if (offset < 0)
    return rejectPython(
      "evidence-mismatch",
      "Python slice anchor is absent from pre-state",
      absolutePath,
      ctx.preStateRequests
    );
  const range = literalOccurrenceRanges(content, anchor.literal)[0];
  ctx.resolved.push({
    status: "resolved",
    layer: "python",
    idiom: "python-anchor-slice",
    span: {
      operation: "modify",
      absolutePath,
      lineStart: range.start,
      lineEnd: range.end,
      expectedContent: `${content.slice(0, offset)}${replacementText}${content.slice(offset + anchor.literal.length)}`,
      simpleCommandIndex: 0
    }
  });
  return void 0;
}
function emitPythonLineJoin(ctx, expression, absolutePath) {
  const lineJoin = expression.match(PYTHON_LINE_JOIN_PATTERN);
  if (lineJoin === null) return "unmatched";
  const delimiter = decodePythonString(lineJoin[1]);
  const array = ctx.lines.get(lineJoin[2]);
  const suffix = lineJoin[3] === void 0 ? "" : decodePythonString(lineJoin[3]);
  if (delimiter !== "\n" || array === void 0 || suffix === null || suffix !== "" && suffix !== "\n") {
    return rejectPython("unsupported-expression", "line-array writes require a literal newline join", absolutePath);
  }
  if (nodePath4.resolve(ctx.cwd, array.path) !== absolutePath || array.edits.size === 0) {
    return rejectPython(
      "unsupported-dataflow",
      "line-array read and write paths are not provably identical",
      absolutePath
    );
  }
  const content = readPythonPreState(ctx, absolutePath, ["deleted-text"]);
  if (typeof content !== "string") return content;
  if (content.includes("\r"))
    return rejectPython("unsupported-encoding", "line-array edits require LF text", absolutePath, ctx.preStateRequests);
  const sourceLines = content.split("\n");
  if (sourceLines.at(-1) === "") sourceLines.pop();
  for (const [index, value] of array.edits) {
    if (index >= sourceLines.length)
      return rejectPython(
        "evidence-mismatch",
        "line-array index is outside pre-state",
        absolutePath,
        ctx.preStateRequests
      );
    sourceLines[index] = value;
  }
  const expectedContent = `${sourceLines.join("\n")}${suffix}`;
  for (const index of array.edits.keys()) {
    ctx.resolved.push({
      status: "resolved",
      layer: "python",
      idiom: "python-line-array",
      span: {
        operation: "modify",
        absolutePath,
        lineStart: index + 1,
        lineEnd: index + 1,
        expectedContent,
        simpleCommandIndex: 0
      }
    });
  }
  return void 0;
}
function emitPythonStructuredDump(ctx, expression, absolutePath) {
  const structuredSink = expression.match(/^(json|tomli_w|toml|yaml)\.(dumps|safe_dump)\(([A-Za-z_][A-Za-z0-9_]*)\)$/);
  if (structuredSink === null) return "unmatched";
  const value = ctx.structured.get(structuredSink[3]);
  const sinkFormat = structuredSink[1] === "json" ? "json" : structuredSink[1] === "yaml" ? "yaml" : "toml";
  if (value === void 0 || value.format !== sinkFormat || nodePath4.resolve(ctx.cwd, value.path) !== absolutePath || value.keys.length === 0) {
    return rejectPython(
      "unsupported-dataflow",
      "structured read, literal-key mutation, and write are not linked",
      absolutePath
    );
  }
  const content = readPythonPreState(ctx, absolutePath, ["match-locations"]);
  if (typeof content !== "string") return content;
  for (const keyPath of value.keys) {
    const key = keyPath.at(-1);
    const ranges = structuredKeyRanges(content, value.format, key);
    if (ranges.length !== 1) {
      return rejectPython(
        "unsupported-expression",
        "structured literal key is absent or ambiguous in pre-state",
        absolutePath,
        ctx.preStateRequests
      );
    }
    ctx.resolved.push({
      status: "resolved",
      layer: "python",
      idiom: `python-${value.format}`,
      span: {
        operation: "modify",
        absolutePath,
        lineStart: ranges[0].start,
        lineEnd: ranges[0].end,
        simpleCommandIndex: 0
      }
    });
  }
  return void 0;
}
function resolvePythonWriteSink(ctx, expression, absolutePath) {
  const literal = decodePythonString(expression);
  if (literal !== null) {
    ctx.resolved.push({
      status: "resolved",
      layer: "python",
      idiom: "python-write",
      span: {
        operation: "create-overwrite",
        absolutePath,
        written: literal,
        expectedContent: literal,
        simpleCommandIndex: 0
      }
    });
    return void 0;
  }
  const directReplace = expression.match(PYTHON_DIRECT_REPLACE_PATTERN);
  const replacement = directReplace === null ? ctx.replacements.get(expression) : {
    source: directReplace[1],
    pattern: decodePythonString(directReplace[2]) ?? "",
    replacement: decodePythonString(directReplace[3]) ?? "",
    count: directReplace[4] === void 0 ? void 0 : Number.parseInt(directReplace[4], 10)
  };
  if (replacement !== void 0) {
    const rejected = emitPythonReplace(ctx, absolutePath, replacement);
    if (rejected !== null) return rejected;
    return void 0;
  }
  for (const sink of [emitPythonAnchorSlice, emitPythonLineJoin, emitPythonStructuredDump]) {
    const outcome = sink(ctx, expression, absolutePath);
    if (outcome !== "unmatched") return outcome;
  }
  return rejectPython("unsupported-dataflow", "Python write expression is outside the bounded allowlist", absolutePath);
}
function createNodeContext(options) {
  return {
    cwd: options.cwd ?? process.cwd(),
    options,
    fsNamespaces: /* @__PURE__ */ new Set(),
    fsFunctions: /* @__PURE__ */ new Map(),
    paths: /* @__PURE__ */ new Map(),
    texts: /* @__PURE__ */ new Map(),
    replacements: /* @__PURE__ */ new Map(),
    structured: /* @__PURE__ */ new Map(),
    countAssertions: /* @__PURE__ */ new Map(),
    resolved: [],
    preStateRequests: []
  };
}
function rejectNode(reasonCode, detail, fileArg, preStateRequests = []) {
  return {
    resolved: [],
    unresolved: [unresolved("node", "node-edit", reasonCode, detail, fileArg)],
    preStateRequests
  };
}
function requestNodePreState(ctx, absolutePath, operation, requirement) {
  if (!ctx.preStateRequests.some(
    (entry) => entry.absolutePath === absolutePath && entry.operation === operation && entry.requirement === requirement
  )) {
    ctx.preStateRequests.push({ absolutePath, operation, requirement, simpleCommandIndex: 0 });
  }
}
function readNodePreState(ctx, absolutePath, operation, requirements) {
  for (const requirement of requirements) requestNodePreState(ctx, absolutePath, operation, requirement);
  const content = ctx.options.readPreState?.(absolutePath) ?? null;
  if (content === null)
    return rejectNode(
      "missing-pre-state",
      "Node range recovery requires pre-command text",
      absolutePath,
      ctx.preStateRequests
    );
  if (content.includes("\0"))
    return rejectNode(
      "binary-content",
      "Node range recovery does not accept binary content",
      absolutePath,
      ctx.preStateRequests
    );
  return content;
}
function nodeResolvePathExpression(ctx, expression) {
  const literal = decodeNodeString(expression.trim());
  if (literal !== null) return { path: literal, depth: 0 };
  return ctx.paths.get(expression.trim()) ?? null;
}
function nodeFsMethod(ctx, callee) {
  const bare = ctx.fsFunctions.get(callee);
  if (bare !== void 0) return bare;
  const member = callee.match(NODE_FS_MEMBER_PATTERN);
  if (member !== null && ctx.fsNamespaces.has(member[1])) {
    return member[2];
  }
  const required = callee.match(/^require\((['"])(?:node:)?fs\1\)\.(readFileSync|writeFileSync|appendFileSync)$/);
  return required?.[2] ?? null;
}
function nodeParseCall(ctx, expression) {
  const call = expression.trim().match(/^(require\((['"])(?:node:)?fs\2\)\.(?:readFileSync|writeFileSync|appendFileSync))\(([\s\S]*)\)$/) ?? expression.trim().match(/^([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?)\(([\s\S]*)\)$/);
  if (call === null) return null;
  const method = nodeFsMethod(ctx, call[1].trim());
  if (method === null) return null;
  const args = splitNodeArguments(call.length === 4 ? call[3] : call[2]);
  return args === null ? null : { method, args };
}
function emitNodeReplacement(ctx, absolutePath, replacement) {
  const read = ctx.texts.get(replacement.source);
  if (read === void 0 || nodePath4.resolve(ctx.cwd, read.path) !== absolutePath) {
    return rejectNode(
      "unsupported-dataflow",
      "Node replacement read and write paths are not provably identical",
      absolutePath
    );
  }
  const content = readNodePreState(ctx, absolutePath, "modify", ["match-locations"]);
  if (typeof content !== "string") return content;
  const occurrences = countLiteralOccurrences(content, replacement.pattern);
  const assertion = ctx.countAssertions.get(`${replacement.source}\0${replacement.pattern}`);
  if (assertion !== void 0 && occurrences !== assertion) {
    return rejectNode(
      "evidence-mismatch",
      "Node count assertion does not match pre-state",
      absolutePath,
      ctx.preStateRequests
    );
  }
  const ranges = literalOccurrenceRanges(content, replacement.pattern);
  if (ranges.length === 0) {
    return rejectNode(
      "evidence-mismatch",
      "Node replacement literal is absent from pre-state",
      absolutePath,
      ctx.preStateRequests
    );
  }
  const affected = replacement.global ? ranges : ranges.slice(0, 1);
  const expectedContent = replaceLiteral(content, replacement.pattern, replacement.replacement, replacement.global);
  for (const range of affected) {
    ctx.resolved.push({
      status: "resolved",
      layer: "node",
      idiom: "node-replace",
      span: {
        operation: "modify",
        absolutePath,
        lineStart: range.start,
        lineEnd: range.end,
        expectedContent,
        simpleCommandIndex: 0
      }
    });
  }
  return null;
}
function consumeNodeStatement(statement, ctx) {
  let match = statement.match(NODE_REQUIRE_FS_PATTERN);
  if (match !== null) {
    ctx.fsNamespaces.add(match[1]);
    return void 0;
  }
  match = statement.match(/^const\s+\{([^}]+)\}\s*=\s*require\((['"])(?:node:)?fs\2\)$/);
  if (match !== null) {
    for (const entry of match[1].split(",")) {
      const binding = entry.trim().match(/^(readFileSync|writeFileSync|appendFileSync)(?:\s*:\s*([A-Za-z_$][A-Za-z0-9_$]*))?$/);
      if (binding === null)
        return rejectNode("unsupported-syntax", "Node fs destructuring contains an unsupported binding");
      ctx.fsFunctions.set(binding[2] ?? binding[1], binding[1]);
    }
    return void 0;
  }
  match = statement.match(NODE_STRING_DECL_PATTERN);
  if (match !== null) {
    const path = decodeNodeString(match[2]);
    if (path === null) return rejectNode("unsupported-syntax", "Node string literal uses an unsupported escape");
    ctx.paths.set(match[1], { path, depth: 0 });
    return void 0;
  }
  match = statement.match(NODE_NAME_ALIAS_PATTERN);
  if (match !== null) {
    const source = ctx.paths.get(match[2]);
    if (source === void 0 || source.depth !== 0) {
      return rejectNode("unsupported-dataflow", "Node path aliases are limited to one literal hop");
    }
    ctx.paths.set(match[1], { path: source.path, depth: 1 });
    return void 0;
  }
  match = statement.match(NODE_GENERIC_DECL_PATTERN);
  if (match !== null) {
    const name = match[1];
    const expression = match[2].trim();
    const call2 = nodeParseCall(ctx, expression);
    if (call2?.method === "readFileSync") {
      const binding = call2.args[0] === void 0 ? null : nodeResolvePathExpression(ctx, call2.args[0]);
      if (binding === null) return rejectNode("dynamic-path", "Node read target is not a literal path binding");
      const encoding = call2.args[1] === void 0 ? null : decodeNodeString(call2.args[1]);
      if (encoding !== "utf8" && encoding !== "utf-8") {
        return rejectNode("unsupported-encoding", "Node text reads require an explicit UTF-8 encoding", binding.path);
      }
      if (call2.args.length !== 2)
        return rejectNode("unsupported-syntax", "Node readFileSync call has unsupported arguments");
      ctx.texts.set(name, { path: binding.path });
      return void 0;
    }
    const replacement = expression.match(NODE_REPLACE_CALL_PATTERN);
    if (replacement !== null) {
      if (!ctx.texts.has(replacement[1]))
        return rejectNode("unsupported-dataflow", "Node replace source is not a direct text read");
      const pattern = decodeNodeString(replacement[3]);
      const replacementText = decodeNodeString(replacement[4]);
      if (pattern === null || pattern.length === 0 || replacementText === null || replacementText.includes("$")) {
        return rejectNode("unsupported-expression", "Node replace requires non-empty literal input");
      }
      ctx.replacements.set(name, {
        source: replacement[1],
        pattern,
        replacement: replacementText,
        global: replacement[2] === "replaceAll"
      });
      return void 0;
    }
    const parsedJson = expression.match(NODE_JSON_PARSE_PATTERN);
    if (parsedJson !== null) {
      const text = ctx.texts.get(parsedJson[1]);
      if (text === void 0) return rejectNode("unsupported-dataflow", "JSON.parse source is not a direct text read");
      ctx.structured.set(name, { path: text.path, keys: [] });
      return void 0;
    }
    const directJson = expression.match(/^JSON\.parse\((.+)\)$/);
    if (directJson !== null) {
      const read = nodeParseCall(ctx, directJson[1]);
      if (read?.method !== "readFileSync" || read.args[0] === void 0) {
        return rejectNode("unsupported-dataflow", "JSON.parse source is not a direct Node text read");
      }
      const binding = nodeResolvePathExpression(ctx, read.args[0]);
      const encoding = read.args[1] === void 0 ? null : decodeNodeString(read.args[1]);
      if (binding === null) return rejectNode("dynamic-path", "Node JSON target is not a literal path binding");
      if (encoding !== "utf8" && encoding !== "utf-8") {
        return rejectNode("unsupported-encoding", "Node JSON reads require an explicit UTF-8 encoding", binding.path);
      }
      ctx.structured.set(name, { path: binding.path, keys: [] });
      return void 0;
    }
    return rejectNode("unsupported-dataflow", "Node variable initializer is outside the bounded allowlist");
  }
  match = statement.match(NODE_STRUCTURED_ASSIGN_PATTERN);
  if (match !== null && ctx.structured.has(match[1])) {
    const keySegments = [...match[2].matchAll(NODE_KEY_SEGMENT_SCAN_PATTERN)];
    const keys = keySegments.map((segment) => segment[1] ?? decodeNodeString(segment[2]));
    if (keys.length === 0 || keys.some((key) => key === null)) {
      return rejectNode("unsupported-expression", "structured Node mutation requires literal property keys");
    }
    if (!/^(?:true|false|null|-?\d+(?:\.\d+)?|(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"))$/.test(match[3].trim())) {
      return rejectNode("unsupported-expression", "structured Node mutation requires a literal value");
    }
    ctx.structured.get(match[1]).keys.push(keys);
    return void 0;
  }
  match = statement.match(NODE_COUNT_GUARD_PATTERN);
  if (match !== null) {
    const literal = decodeNodeString(match[2]);
    if (literal === null || literal.length === 0 || !ctx.texts.has(match[1])) {
      return rejectNode("unsupported-dataflow", "Node count guard is not tied to a direct text read");
    }
    ctx.countAssertions.set(`${match[1]}\0${literal}`, Number.parseInt(match[3], 10));
    return void 0;
  }
  const call = nodeParseCall(ctx, statement);
  if (call?.method === "appendFileSync") {
    const binding = call.args[0] === void 0 ? null : nodeResolvePathExpression(ctx, call.args[0]);
    if (binding === null) return rejectNode("dynamic-path", "Node append target is not a literal path binding");
    const written = call.args[1] === void 0 ? null : decodeNodeString(call.args[1]);
    const encoding = call.args[2] === void 0 ? "utf8" : decodeNodeString(call.args[2]);
    if (written === null)
      return rejectNode("unsupported-expression", "Node append content must be literal", binding.path);
    if (encoding !== "utf8" && encoding !== "utf-8") {
      return rejectNode("unsupported-encoding", "Node append requires default or UTF-8 encoding", binding.path);
    }
    if (call.args.length < 2 || call.args.length > 3)
      return rejectNode("unsupported-syntax", "Node appendFileSync call has unsupported arguments", binding.path);
    const absolutePath = nodePath4.resolve(ctx.cwd, binding.path);
    const content = readNodePreState(ctx, absolutePath, "append", ["pre-command-eof"]);
    if (typeof content !== "string") return content;
    const line = pythonLineAtOffset(content, content.length);
    ctx.resolved.push({
      status: "resolved",
      layer: "node",
      idiom: "node-append",
      span: {
        operation: "append",
        absolutePath,
        lineStart: line,
        lineEnd: line,
        written,
        expectedContent: `${content}${written}`,
        simpleCommandIndex: 0
      }
    });
    return void 0;
  }
  if (call?.method === "writeFileSync") {
    const binding = call.args[0] === void 0 ? null : nodeResolvePathExpression(ctx, call.args[0]);
    if (binding === null) return rejectNode("dynamic-path", "Node write target is not a literal path binding");
    if (call.args.length < 2 || call.args.length > 3)
      return rejectNode("unsupported-syntax", "Node writeFileSync call has unsupported arguments", binding.path);
    const encoding = call.args[2] === void 0 ? "utf8" : decodeNodeString(call.args[2]);
    if (encoding !== "utf8" && encoding !== "utf-8") {
      return rejectNode("unsupported-encoding", "Node write requires default or UTF-8 encoding", binding.path);
    }
    const absolutePath = nodePath4.resolve(ctx.cwd, binding.path);
    return resolveNodeWriteSink(ctx, call.args[1], absolutePath);
  }
  return "unmatched";
}
function consumeUnmatchedNode(statement) {
  if (/\b(?:readFile|writeFile|appendFile)\s*\(/.test(statement) || /\bPromise\b|\.then\s*\(/.test(statement)) {
    return rejectNode("unsupported-dataflow", "asynchronous Node filesystem APIs are outside the bounded recognizer");
  }
  return rejectNode(
    /(?:writeFile|appendFile|readFile|require\s*\()/.test(statement) ? "unsupported-dataflow" : "unsupported-syntax",
    "Node statement is outside the bounded lexical/dataflow allowlist"
  );
}
function prepareNodeStatements(command) {
  const extracted = extractNodeProgram(command);
  if (extracted === null) return { kind: "unrecognized" };
  if (extracted.program === void 0) {
    return {
      kind: "rejected",
      result: rejectNode(extracted.reason ?? "unsupported-syntax", extracted.detail ?? "unsupported Node invocation")
    };
  }
  if (/\b(?:process\.(?:argv|env)|require\s*\(\s*[^'"]|import\s*\()/.test(extracted.program)) {
    return {
      kind: "rejected",
      result: rejectNode("dynamic-path", "Node target depends on runtime input or a computed import")
    };
  }
  const statements = splitNodeStatements(extracted.program);
  if (statements === null || statements.length === 0) {
    return {
      kind: "rejected",
      result: rejectNode("unsupported-syntax", "the Node program is incomplete or cannot be tokenized")
    };
  }
  if (statements.length > 64) {
    return {
      kind: "rejected",
      result: rejectNode("candidate-budget-exceeded", "the Node program exceeds the statement budget")
    };
  }
  return { kind: "ready", statements };
}
function runNodeStatements(statements, ctx) {
  for (const statement of statements) {
    if (/^['"]use strict['"]$/.test(statement)) continue;
    if (/^(?:for|while|do|switch|function|class|async|await|try|with|import)\b/.test(statement)) {
      return rejectNode(
        "unsupported-dataflow",
        "control flow, asynchronous code, and imports are outside the Node recognizer"
      );
    }
    const verdict = consumeNodeStatement(statement, ctx);
    if (verdict === void 0) continue;
    return verdict === "unmatched" ? consumeUnmatchedNode(statement) : verdict;
  }
  return null;
}
function parseNodeAttribution(command, options) {
  const prepared = prepareNodeStatements(command);
  if (prepared.kind === "unrecognized") return null;
  if (prepared.kind === "rejected") return prepared.result;
  const ctx = createNodeContext(options);
  const rejected = runNodeStatements(prepared.statements, ctx);
  if (rejected !== null) return rejected;
  if (ctx.resolved.length === 0)
    return rejectNode("unsupported-dataflow", "Node program has no supported authoring sink");
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_ATTRIBUTION_CANDIDATES;
  const overBudget = rejectOverBudget(ctx.resolved, "node", "node-edit", "Node program", maxCandidates);
  if (overBudget !== null) return overBudget;
  return { resolved: ctx.resolved, unresolved: [], preStateRequests: ctx.preStateRequests };
}
function resolveNodeWriteSink(ctx, expression, absolutePath) {
  const literal = decodeNodeString(expression);
  if (literal !== null) {
    ctx.resolved.push({
      status: "resolved",
      layer: "node",
      idiom: "node-write",
      span: {
        operation: "create-overwrite",
        absolutePath,
        written: literal,
        expectedContent: literal,
        simpleCommandIndex: 0
      }
    });
    return void 0;
  }
  const directReplacement = expression.match(NODE_REPLACE_CALL_PATTERN);
  const replacement = directReplacement === null ? ctx.replacements.get(expression) : {
    source: directReplacement[1],
    pattern: decodeNodeString(directReplacement[3]) ?? "",
    replacement: decodeNodeString(directReplacement[4]) ?? "",
    global: directReplacement[2] === "replaceAll"
  };
  if (replacement !== void 0) {
    if (replacement.pattern.length === 0 || replacement.replacement.includes("$")) {
      return rejectNode("unsupported-expression", "Node replace requires non-empty literal input", absolutePath);
    }
    const rejected = emitNodeReplacement(ctx, absolutePath, replacement);
    if (rejected !== null) return rejected;
    return void 0;
  }
  const dumped = emitNodeStructuredDump(ctx, expression, absolutePath);
  if (dumped !== "unmatched") return dumped;
  return rejectNode("unsupported-dataflow", "Node write expression is outside the bounded allowlist", absolutePath);
}
function emitNodeStructuredDump(ctx, expression, absolutePath) {
  const serialized = expression.match(/^JSON\.stringify\(([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*,\s*null\s*,\s*\d+)?\)$/);
  if (serialized === null) return "unmatched";
  const value = ctx.structured.get(serialized[1]);
  if (value === void 0 || nodePath4.resolve(ctx.cwd, value.path) !== absolutePath || value.keys.length === 0) {
    return rejectNode(
      "unsupported-dataflow",
      "JSON read, literal-key mutation, and write are not linked",
      absolutePath
    );
  }
  const content = readNodePreState(ctx, absolutePath, "modify", ["match-locations"]);
  if (typeof content !== "string") return content;
  for (const keyPath of value.keys) {
    const key = keyPath.at(-1);
    const ranges = structuredKeyRanges(content, "json", key);
    if (ranges.length !== 1) {
      return rejectNode(
        "unsupported-expression",
        "structured literal key is absent or ambiguous in pre-state",
        absolutePath,
        ctx.preStateRequests
      );
    }
    ctx.resolved.push({
      status: "resolved",
      layer: "node",
      idiom: "node-json",
      span: {
        operation: "modify",
        absolutePath,
        lineStart: ranges[0].start,
        lineEnd: ranges[0].end,
        simpleCommandIndex: 0
      }
    });
  }
  return void 0;
}
function numericSedForFile(patternCommand, substitution, start, end, file, options, cwd, resolved, unresolvedMatches, preStateRequests) {
  const reason = classifyDynamicWord(file);
  if (reason !== null) {
    unresolvedMatches.push(unresolved("shell", "sed-inplace", reason, "target path is dynamic", file));
    return;
  }
  const absolutePath = nodePath4.resolve(cwd, file);
  const content = options.readPreState?.(absolutePath) ?? null;
  const expectedContent = content === null || content.includes("\0") ? void 0 : content.split(/(?<=\n)/).map(
    (line, index) => index + 1 >= start && index + 1 <= end ? replaceLiteral(line, substitution.pattern, substitution.replacement, substitution.global) : line
  ).join("");
  resolved.push({
    status: "resolved",
    layer: "shell",
    idiom: "sed-inplace",
    span: {
      operation: "modify",
      absolutePath,
      lineStart: start,
      lineEnd: end,
      expectedContent,
      simpleCommandIndex: patternCommand.simpleCommandIndex
    }
  });
  if (expectedContent !== void 0) {
    preStateRequests.push({
      absolutePath,
      operation: "modify",
      requirement: "match-locations",
      simpleCommandIndex: patternCommand.simpleCommandIndex
    });
  }
  if (patternCommand.backupSuffix !== void 0 && patternCommand.backupSuffix !== "") {
    resolved.push({
      status: "resolved",
      layer: "shell",
      idiom: "sed-inplace",
      span: {
        operation: "create-overwrite",
        absolutePath: `${nodePath4.resolve(cwd, file)}${patternCommand.backupSuffix}`,
        simpleCommandIndex: patternCommand.simpleCommandIndex
      }
    });
  }
}
function resolveNumericSed(patternCommand, numericMatch, options, cwd, maxCandidates) {
  if (patternCommand.files.length === 0) {
    return {
      resolved: [],
      unresolved: [
        unresolved("shell", "sed-inplace", "unsupported-syntax", "numeric in-place substitution has no file operand")
      ],
      preStateRequests: []
    };
  }
  const start = Number.parseInt(numericMatch[1], 10);
  const end = Number.parseInt(numericMatch[2] ?? numericMatch[1], 10);
  const substitution = parseLiteralSubstitution(patternCommand.script.slice(numericMatch[0].indexOf("s")));
  if (substitution === null) {
    return {
      resolved: [],
      unresolved: [
        unresolved(
          "pattern-substitution",
          "sed-inplace",
          "unsupported-expression",
          "numeric substitutions require a literal pattern and replacement for post-state verification"
        )
      ],
      preStateRequests: []
    };
  }
  const resolved = [];
  const unresolvedMatches = [];
  const preStateRequests = [];
  for (const file of patternCommand.files) {
    numericSedForFile(
      patternCommand,
      substitution,
      start,
      end,
      file,
      options,
      cwd,
      resolved,
      unresolvedMatches,
      preStateRequests
    );
  }
  if (unresolvedMatches.length > 0) return { resolved: [], unresolved: unresolvedMatches, preStateRequests: [] };
  const overBudget = rejectOverBudget(resolved, "shell", "sed-inplace", "numeric substitution", maxCandidates);
  if (overBudget !== null) return overBudget;
  return { resolved, unresolved: [], preStateRequests };
}
function patternIdiom(kind) {
  return kind === "sed" ? "sed-inplace" : "perl-inplace";
}
function preparePatternSubstitution(patternCommand) {
  let addressLiteral = null;
  let substitutionSource = patternCommand.script;
  if (patternCommand.kind === "sed" && substitutionSource.startsWith("/")) {
    const address = readDelimitedField(substitutionSource, 1, "/");
    if (address === null) substitutionSource = "";
    else {
      addressLiteral = decodeLiteralField(address.raw, "/", false);
      if (addressLiteral === "") addressLiteral = null;
      substitutionSource = substitutionSource.slice(address.next);
    }
  }
  const substitution = parseLiteralSubstitution(substitutionSource);
  const patternNewlines = substitution?.pattern.match(/\n/g)?.length ?? 0;
  const replacementNewlines = substitution?.replacement.match(/\n/g)?.length ?? 0;
  if (substitution === null || patternNewlines !== replacementNewlines || patternCommand.kind !== "perl-zero" && patternNewlines > 0) {
    return {
      kind: "rejected",
      result: {
        resolved: [],
        unresolved: [
          unresolved(
            "pattern-substitution",
            patternIdiom(patternCommand.kind),
            "unsupported-expression",
            "only literal line-count-preserving substitutions are supported"
          )
        ],
        preStateRequests: []
      }
    };
  }
  if (patternCommand.files.length === 0) {
    return {
      kind: "rejected",
      result: {
        resolved: [],
        unresolved: [
          unresolved(
            "pattern-substitution",
            patternIdiom(patternCommand.kind),
            "unsupported-syntax",
            "in-place substitution has no literal file operand"
          )
        ],
        preStateRequests: []
      }
    };
  }
  if (addressLiteral === null && patternCommand.kind === "sed" && patternCommand.script.startsWith("/")) {
    return {
      kind: "rejected",
      result: {
        resolved: [],
        unresolved: [
          unresolved(
            "pattern-substitution",
            "sed-inplace",
            "unsupported-expression",
            "sed address is not a literal pattern"
          )
        ],
        preStateRequests: []
      }
    };
  }
  return { kind: "ready", idiom: patternIdiom(patternCommand.kind), addressLiteral, substitution };
}
function substituteOneFile(patternCommand, idiom, addressLiteral, substitution, file, options, cwd, resolved, unresolvedMatches, preStateRequests) {
  const reason = classifyDynamicWord(file);
  if (reason !== null) {
    unresolvedMatches.push(unresolved("pattern-substitution", idiom, reason, "target path is dynamic", file));
    return;
  }
  const absolutePath = nodePath4.resolve(cwd, file);
  preStateRequests.push({
    absolutePath,
    operation: "modify",
    requirement: "match-locations",
    simpleCommandIndex: patternCommand.simpleCommandIndex
  });
  if (patternCommand.kind === "perl-zero") {
    preStateRequests.push({
      absolutePath,
      operation: "modify",
      requirement: "deleted-text",
      simpleCommandIndex: patternCommand.simpleCommandIndex
    });
  }
  const content = options.readPreState?.(absolutePath) ?? null;
  if (content === null) {
    unresolvedMatches.push(
      unresolved(
        "pattern-substitution",
        idiom,
        "missing-pre-state",
        "literal substitution range requires pre-command text",
        absolutePath
      )
    );
    return;
  }
  if (content.includes("\0")) {
    unresolvedMatches.push(
      unresolved(
        "pattern-substitution",
        idiom,
        "binary-content",
        "substitution range recovery does not accept NUL-delimited content",
        absolutePath
      )
    );
    return;
  }
  let ranges = literalOccurrenceRanges(content, substitution.pattern);
  if (addressLiteral !== null) {
    const addressedLines = new Set(literalOccurrenceRanges(content, addressLiteral).map(({ start }) => start));
    ranges = ranges.filter(({ start, end }) => start === end && addressedLines.has(start));
  }
  if (patternCommand.kind === "perl" && ranges.length > 1) {
    ranges = [{ start: ranges[0].start, end: ranges[ranges.length - 1].end }];
  } else if (patternCommand.kind === "perl-zero" && !substitution.global) {
    ranges = ranges.slice(0, 1);
  }
  const expectedContent = expectedSubstitutionContent(content, substitution, patternCommand.kind, addressLiteral);
  for (const range of ranges) {
    resolved.push({
      status: "resolved",
      layer: "pattern-substitution",
      idiom,
      span: {
        operation: "modify",
        absolutePath,
        lineStart: range.start,
        lineEnd: range.end,
        expectedContent,
        simpleCommandIndex: patternCommand.simpleCommandIndex
      }
    });
  }
  if (patternCommand.backupSuffix !== void 0 && patternCommand.backupSuffix !== "") {
    resolved.push({
      status: "resolved",
      layer: "pattern-substitution",
      idiom: "sed-inplace",
      span: {
        operation: "create-overwrite",
        absolutePath: `${absolutePath}${patternCommand.backupSuffix}`,
        simpleCommandIndex: patternCommand.simpleCommandIndex
      }
    });
  }
}
function resolvePatternSubstitution(patternCommand, options, cwd, maxCandidates) {
  const prepared = preparePatternSubstitution(patternCommand);
  if (prepared.kind === "rejected") return prepared.result;
  const { idiom, addressLiteral, substitution } = prepared;
  const resolved = [];
  const unresolvedMatches = [];
  const preStateRequests = [];
  for (const file of patternCommand.files) {
    substituteOneFile(
      patternCommand,
      idiom,
      addressLiteral,
      substitution,
      file,
      options,
      cwd,
      resolved,
      unresolvedMatches,
      preStateRequests
    );
  }
  if (unresolvedMatches.length > 0) return { resolved: [], unresolved: unresolvedMatches, preStateRequests };
  const overBudget = rejectOverBudget(resolved, "pattern-substitution", idiom, "substitution", maxCandidates);
  if (overBudget !== null) return overBudget;
  return { resolved, unresolved: [], preStateRequests };
}
function rejectOverBudget(resolved, layer, idiom, noun, maxCandidates) {
  if (resolved.length <= maxCandidates) return null;
  return {
    resolved: [],
    unresolved: [
      unresolved(
        layer,
        idiom,
        "candidate-budget-exceeded",
        `${noun} produced ${resolved.length} candidates; the limit is ${maxCandidates}`
      )
    ],
    preStateRequests: []
  };
}
function literalListLoopDecline(listSource, body, maxCandidates) {
  if (body.includes("for ") || body.includes("while ") || body.includes("until ")) {
    return {
      resolved: [],
      unresolved: [
        unresolved("literal-loop", "literal-list-loop", "unsupported-syntax", "nested loop bodies are not supported")
      ],
      preStateRequests: []
    };
  }
  if (listSource.includes("$(") || listSource.includes("`")) {
    return {
      resolved: [],
      unresolved: [
        unresolved("literal-loop", "literal-list-loop", "command-substitution", "loop list uses command substitution")
      ],
      preStateRequests: []
    };
  }
  if (GLOB_META.test(listSource)) {
    return {
      resolved: [],
      unresolved: [unresolved("literal-loop", "literal-list-loop", "glob-path", "loop list uses glob expansion")],
      preStateRequests: []
    };
  }
  if (SHELL_EXPANSION.test(listSource)) {
    return {
      resolved: [],
      unresolved: [unresolved("literal-loop", "literal-list-loop", "dynamic-list", "loop list is not a literal list")],
      preStateRequests: []
    };
  }
  const bindings = argvOf(listSource);
  if (bindings === null || bindings.length === 0) {
    return {
      resolved: [],
      unresolved: [
        unresolved("literal-loop", "literal-list-loop", "unsupported-syntax", "loop list cannot be tokenized")
      ],
      preStateRequests: []
    };
  }
  if (bindings.length > maxCandidates) {
    return {
      resolved: [],
      unresolved: [
        unresolved(
          "literal-loop",
          "literal-list-loop",
          "candidate-budget-exceeded",
          `literal list has ${bindings.length} bindings; the limit is ${maxCandidates}`
        )
      ],
      preStateRequests: []
    };
  }
  return null;
}
function parseLiteralListLoop(variable, listSource, body, options, maxCandidates, parse) {
  const declined = literalListLoopDecline(listSource, body, maxCandidates);
  if (declined !== null) return declined;
  const bindings = argvOf(listSource) ?? [];
  const resolved = [];
  const unresolvedMatches = [];
  const preStateRequests = [];
  for (const binding of bindings) {
    const dynamic = classifyDynamicWord(binding);
    if (dynamic !== null) {
      return {
        resolved: [],
        unresolved: [unresolved("literal-loop", "literal-list-loop", dynamic, "loop binding is not literal", binding)],
        preStateRequests: []
      };
    }
    const expanded = expandLiteralLoopVariable(body, variable, binding);
    if (expanded.unsafeUnquoted) {
      return {
        resolved: [],
        unresolved: [
          unresolved(
            "literal-loop",
            "literal-list-loop",
            "unsupported-dataflow",
            "unquoted loop expansion would perform shell field splitting"
          )
        ],
        preStateRequests: []
      };
    }
    if (expanded.replacements === 0) {
      return {
        resolved: [],
        unresolved: [
          unresolved(
            "literal-loop",
            "literal-list-loop",
            "unsupported-dataflow",
            "loop variable is not used in an expandable shell context"
          )
        ],
        preStateRequests: []
      };
    }
    const result = parse(expanded.command, { ...options, maxCandidates });
    resolved.push(...result.resolved.map((match) => ({ ...match, layer: "literal-loop" })));
    unresolvedMatches.push(...result.unresolved.map((match) => ({ ...match, layer: "literal-loop" })));
    preStateRequests.push(...result.preStateRequests);
  }
  if (unresolvedMatches.length > 0) return { resolved: [], unresolved: unresolvedMatches, preStateRequests: [] };
  const overBudget = rejectOverBudget(
    resolved,
    "literal-loop",
    "literal-list-loop",
    "literal expansion",
    maxCandidates
  );
  if (overBudget !== null) return overBudget;
  for (const match of resolved) {
    if (match.span.operation !== "modify") continue;
    if (preStateRequests.some((request) => request.absolutePath === match.span.absolutePath)) continue;
    preStateRequests.push({
      absolutePath: match.span.absolutePath,
      operation: match.span.operation,
      requirement: "match-locations",
      simpleCommandIndex: match.span.simpleCommandIndex
    });
  }
  return { resolved, unresolved: [], preStateRequests };
}
function reconcilePipelineStages(command, options, resolved, unresolvedMatches) {
  const pipelineDetailed = parseCommandDetailed(command, options);
  const pipelineReads = pipelineDetailed.flatMap(
    (match) => match.status === "resolved" && match.span.operation === "read" ? [{ status: "resolved", layer: "shell", idiom: match.idiom, span: match.span }] : []
  );
  const pipelineUnresolved = pipelineDetailed.flatMap(
    (match) => match.status === "unresolved" ? [unresolved("shell", match.idiom, stableReason(match), match.reason, match.fileArg)] : []
  );
  const layeredReads = resolved.filter(({ layer, span }) => layer !== "shell" && span.operation === "read");
  const writes = resolved.filter(({ span }) => span.operation !== "read");
  resolved.splice(0, resolved.length, ...pipelineReads, ...layeredReads, ...writes);
  const layeredUnresolved = unresolvedMatches.filter(({ layer }) => layer !== "shell");
  unresolvedMatches.splice(0, unresolvedMatches.length, ...pipelineUnresolved, ...layeredUnresolved);
}
function parseCompoundStages(command, split, options, maxCandidates, parse) {
  const hasPipeline = split.stages.some((stage) => stage.precededBy === "pipe");
  const hasLayeredPipelineStage = split.stages.some((stage) => {
    const stageText = stage.text.trimStart();
    return /^(?:python(?:3(?:\.\d+)?)?|node|for)\b/.test(stageText) || parsePatternCommand(stage.text) !== null;
  });
  if (!(split.malformed === void 0 && split.stages.length > 1 && (!hasPipeline || hasLayeredPipelineStage))) {
    return null;
  }
  if (split.stages.some((stage) => argvOf(stage.text)?.[0] === "cd")) {
    return {
      resolved: [],
      unresolved: [
        unresolved(
          "pattern-substitution",
          "compound-command",
          "dynamic-path",
          "a directory-changing compound cannot safely resolve substitution targets"
        )
      ],
      preStateRequests: []
    };
  }
  const resolved = [];
  const unresolvedMatches = [];
  const preStateRequests = [];
  for (let index = 0; index < split.stages.length; index += 1) {
    const stage = split.stages[index];
    const child = parse(stage.text, options);
    const join7 = stage.precededBy === "and" ? "&&" : stage.precededBy === "or" ? "||" : void 0;
    resolved.push(
      ...child.resolved.map((match) => ({
        ...match,
        span: { ...match.span, simpleCommandIndex: index, join: join7 }
      }))
    );
    unresolvedMatches.push(...child.unresolved.map((match) => ({ ...match, simpleCommandIndex: index })));
    preStateRequests.push(...child.preStateRequests.map((request) => ({ ...request, simpleCommandIndex: index })));
  }
  if (hasPipeline) reconcilePipelineStages(command, options, resolved, unresolvedMatches);
  const overBudget = rejectOverBudget(resolved, "shell", "compound-command", "compound", maxCandidates);
  if (overBudget !== null) return overBudget;
  return { resolved, unresolved: unresolvedMatches, preStateRequests };
}
function resolvePatternStage(split, options, cwd, maxCandidates) {
  const patternCommand = split.malformed === void 0 && split.stages.length === 1 ? parsePatternCommand(split.stages[0].text) : null;
  if (patternCommand === null) return null;
  const numericMatch = patternCommand.kind === "sed" ? patternCommand.script.match(/^(\d+)(?:,(\d+))?s\W/) : null;
  if (numericMatch !== null) return resolveNumericSed(patternCommand, numericMatch, options, cwd, maxCandidates);
  return resolvePatternSubstitution(patternCommand, options, cwd, maxCandidates);
}
function historyOrGeneratorRefusal(argv) {
  if (argv[0] === "git" && ["rebase", "merge", "cherry-pick", "reset"].includes(argv[1] ?? "")) {
    return {
      resolved: [],
      unresolved: [
        unresolved("shell", "history-operation", "history-operation", "history-changing commands have no file intent")
      ],
      preStateRequests: []
    };
  }
  if (["yarn", "npm", "pnpm", "make"].includes(argv[0]) && /(?:generate|build|install)/.test(argv.slice(1).join(" "))) {
    return {
      resolved: [],
      unresolved: [
        unresolved(
          "shell",
          "generator-operation",
          "generator-operation",
          "generators have no bounded static output set"
        )
      ],
      preStateRequests: []
    };
  }
  return null;
}
function parseInterpreterAttribution(command, options) {
  const trimmed = command.trimStart();
  if (/^python(?:3(?:\.\d+)?)?\b/.test(trimmed)) {
    const python = parsePythonAttribution(command, options);
    if (python !== null) return python;
  }
  if (/^node\b/.test(trimmed)) {
    const node = parseNodeAttribution(command, options);
    if (node !== null) return node;
  }
  return null;
}
function parseShellFallback(command, options, maxCandidates) {
  const detailed = parseCommandDetailed(command, options);
  const resolved = detailed.flatMap(
    (match) => match.status === "resolved" ? [{ status: "resolved", layer: "shell", idiom: match.idiom, span: match.span }] : []
  );
  const unresolvedMatches = detailed.flatMap(
    (match) => match.status === "unresolved" ? [unresolved("shell", match.idiom, stableReason(match), match.reason, match.fileArg)] : []
  );
  const overBudget = rejectOverBudget(resolved, "shell", "deterministic-shell", "command", maxCandidates);
  if (overBudget !== null) return overBudget;
  return { resolved, unresolved: unresolvedMatches, preStateRequests: [] };
}
function parseCommandLayered(command, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_ATTRIBUTION_CANDIDATES;
  if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1) {
    throw new Error("maxCandidates must be a positive safe integer");
  }
  if (!canCarryStaticIntent(command)) return { resolved: [], unresolved: [], preStateRequests: [] };
  const interpreted = parseInterpreterAttribution(command, options);
  if (interpreted !== null) return interpreted;
  const loop = command.trim().match(/^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([\s\S]*?)\s*;\s*do\s+([\s\S]*?)\s*;\s*done\s*$/);
  if (loop !== null)
    return parseLiteralListLoop(loop[1], loop[2], loop[3], options, maxCandidates, parseCommandLayered);
  const split = splitTopLevel(command);
  const compound = parseCompoundStages(command, split, options, maxCandidates, parseCommandLayered);
  if (compound !== null) return compound;
  const patternResult = resolvePatternStage(split, options, cwd, maxCandidates);
  if (patternResult !== null) return patternResult;
  const argv = argvOf(command.trim());
  if (argv !== null) {
    const refusal = historyOrGeneratorRefusal(argv);
    if (refusal !== null) return refusal;
  }
  return parseShellFallback(command, options, maxCandidates);
}
var DEFAULT_PLANNED_TOUCH_BUDGETS = Object.freeze({
  maxTouchesPerRecord: DEFAULT_MAX_ATTRIBUTION_CANDIDATES,
  maxRangesPerTouch: DEFAULT_MAX_ATTRIBUTION_CANDIDATES,
  maxEvidenceBytes: 16 * 1024,
  maxRecordBytes: 64 * 1024
});
function createPlannedTouchStore(layout, budgets) {
  validateBudgets(budgets);
  if (layout.base.length === 0) throw new Error("planned-touch base directory must not be empty");
  const recordPaths = (sessionId, toolUseId) => {
    if (sessionId.length === 0 || toolUseId.length === 0) {
      throw new Error("planned-touch session and tool-use ids must not be empty");
    }
    return {
      dir: layout.plannedTouchesDir(sessionId),
      record: layout.plannedTouchRecordFile(sessionId, toolUseId),
      consumed: layout.plannedTouchConsumedFile(sessionId, toolUseId)
    };
  };
  const makeRestrictiveDir = (dir) => {
    fs5.mkdirSync(dir, { recursive: true, mode: 448 });
    fs5.chmodSync(layout.base, 448);
    fs5.chmodSync(nodePath4.dirname(dir), 448);
    fs5.chmodSync(dir, 448);
  };
  const claim = (consumed) => {
    try {
      fs5.writeFileSync(consumed, "", { encoding: "utf8", flag: "wx", mode: 384 });
      return true;
    } catch (error) {
      if (error.code === "EEXIST") return false;
      throw error;
    }
  };
  const take = (sessionId, toolUseId) => {
    pruneStaleSessionsThrottled(layout);
    const paths = recordPaths(sessionId, toolUseId);
    makeRestrictiveDir(paths.dir);
    if (!claim(paths.consumed)) return { status: "consumed" };
    let raw;
    try {
      raw = fs5.readFileSync(paths.record, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return { status: "missing" };
      throw error;
    } finally {
      fs5.rmSync(paths.record, { force: true });
    }
    try {
      const record = normalizePlannedTouchRecord(JSON.parse(raw), budgets);
      return { status: "record", record };
    } catch {
      return { status: "missing" };
    }
  };
  return {
    put(record) {
      pruneStaleSessionsThrottled(layout);
      const normalized = normalizePlannedTouchRecord(record, budgets);
      const paths = recordPaths(normalized.sessionId, normalized.toolUseId);
      makeRestrictiveDir(paths.dir);
      if (fs5.existsSync(paths.consumed)) {
        throw new Error("planned-touch record has already been consumed or discarded");
      }
      const encoded = JSON.stringify(normalized);
      const tmp = nodePath4.join(
        paths.dir,
        `.${nodePath4.basename(paths.record)}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}.tmp`
      );
      try {
        fs5.writeFileSync(tmp, encoded, { encoding: "utf8", mode: 384 });
        fs5.chmodSync(tmp, 384);
        fs5.renameSync(tmp, paths.record);
      } catch (error) {
        fs5.rmSync(tmp, { force: true });
        throw error;
      }
    },
    consume(sessionId, toolUseId) {
      const result = take(sessionId, toolUseId);
      return result.status === "record" ? result.record : null;
    },
    take,
    discard(sessionId, toolUseId) {
      pruneStaleSessionsThrottled(layout);
      const paths = recordPaths(sessionId, toolUseId);
      makeRestrictiveDir(paths.dir);
      claim(paths.consumed);
      fs5.rmSync(paths.record, { force: true });
    }
  };
}
var OPERATIONS = /* @__PURE__ */ new Set([
  "read",
  "create-overwrite",
  "append",
  "modify",
  "rename-copy",
  "truncate",
  "delete"
]);
function validateBudgets(budgets) {
  for (const [name, value] of [
    ["maxTouchesPerRecord", budgets.maxTouchesPerRecord],
    ["maxRangesPerTouch", budgets.maxRangesPerTouch],
    ["maxEvidenceBytes", budgets.maxEvidenceBytes],
    ["maxRecordBytes", budgets.maxRecordBytes]
  ]) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error(`planned-touch ${name} must be a non-negative integer`);
  }
}
function validRange(value) {
  if (typeof value !== "object" || value === null) return false;
  const range = value;
  return Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end) && range.start >= 1 && range.end >= range.start;
}
function normalizeEvidence(value) {
  if (value === void 0) return void 0;
  switch (value.kind) {
    case "literal-occurrences":
      if (typeof value.literal !== "string" || !Array.isArray(value.ranges) || !value.ranges.every(validRange) || !Number.isSafeInteger(value.expectedCount) || value.expectedCount < 0) {
        throw new Error("invalid literal-occurrences evidence");
      }
      return {
        kind: value.kind,
        literal: value.literal,
        ranges: value.ranges.map(({ start, end }) => ({ start, end })),
        expectedCount: value.expectedCount
      };
    case "anchor":
      if (typeof value.literal !== "string" || !Number.isSafeInteger(value.line) || value.line < 1) {
        throw new Error("invalid anchor evidence");
      }
      return { kind: value.kind, literal: value.literal, line: value.line };
    case "eof":
      if (!Number.isSafeInteger(value.line) || value.line < 0 || !Number.isSafeInteger(value.byteLength) || value.byteLength < 0) {
        throw new Error("invalid eof evidence");
      }
      return { kind: value.kind, line: value.line, byteLength: value.byteLength };
    case "content-digest":
      if (value.algorithm !== "sha256" || !/^[a-f0-9]{64}$/.test(value.digest) || !validRange(value.range)) {
        throw new Error("invalid content-digest evidence");
      }
      return {
        kind: value.kind,
        algorithm: value.algorithm,
        digest: value.digest,
        range: { start: value.range.start, end: value.range.end }
      };
    case "tracked":
      if (value.tracked !== true) throw new Error("invalid tracked evidence");
      return { kind: value.kind, tracked: true };
    default:
      throw new Error("invalid planned-touch evidence kind");
  }
}
function normalizePlannedTouchRecord(record, budgets) {
  if (typeof record !== "object" || record === null || record.version !== 1 || typeof record.sessionId !== "string" || record.sessionId.length === 0 || typeof record.toolUseId !== "string" || record.toolUseId.length === 0 || typeof record.repoRoot !== "string" || record.repoRoot.length === 0 || !Number.isFinite(record.createdAtMs) || record.createdAtMs < 0 || !Array.isArray(record.touches)) {
    throw new Error("invalid planned-touch record");
  }
  const repoRoot = toPosix(record.repoRoot);
  if (!nodePath4.isAbsolute(record.repoRoot) && !/^[A-Za-z]:\//.test(repoRoot)) {
    throw new Error("planned-touch repository root must be absolute");
  }
  if (record.touches.length > budgets.maxTouchesPerRecord) {
    throw new Error("planned-touch record exceeds touch budget");
  }
  let evidenceBytes = 0;
  const touches = record.touches.map((touch) => {
    if (typeof touch !== "object" || touch === null) throw new Error("invalid planned touch");
    const repoRelativePath = toPosix(touch.repoRelativePath);
    if (repoRelativePath.length === 0 || repoRelativePath.startsWith("/") || /^[A-Za-z]:\//.test(repoRelativePath) || repoRelativePath.split("/").some((part) => part === "..")) {
      throw new Error("planned-touch path must be repository-relative");
    }
    if (!OPERATIONS.has(touch.operation)) throw new Error("invalid planned-touch operation");
    if (!Array.isArray(touch.ranges) || touch.ranges.length > budgets.maxRangesPerTouch) {
      throw new Error("planned touch exceeds range budget");
    }
    if (!touch.ranges.every(validRange)) throw new Error("invalid planned-touch range");
    if (!Number.isSafeInteger(touch.simpleCommandIndex) || touch.simpleCommandIndex < 0) {
      throw new Error("invalid planned-touch command index");
    }
    const evidence = normalizeEvidence(touch.evidence);
    if (evidence !== void 0) evidenceBytes += Buffer.byteLength(JSON.stringify(evidence));
    return {
      repoRelativePath,
      operation: touch.operation,
      ranges: touch.ranges.map((range) => ({ start: range.start, end: range.end })),
      simpleCommandIndex: touch.simpleCommandIndex,
      ...evidence === void 0 ? {} : { evidence }
    };
  });
  if (evidenceBytes > budgets.maxEvidenceBytes) throw new Error("planned-touch record exceeds evidence budget");
  const normalized = {
    version: 1,
    sessionId: record.sessionId,
    toolUseId: record.toolUseId,
    repoRoot,
    createdAtMs: record.createdAtMs,
    touches
  };
  if (Buffer.byteLength(JSON.stringify(normalized)) > budgets.maxRecordBytes) {
    throw new Error("planned-touch record exceeds byte budget");
  }
  return normalized;
}
var queryTrackedFiles = (repoRoot, repoRelativePaths) => {
  if (repoRelativePaths.length === 0) return /* @__PURE__ */ new Set();
  const stdout = execFileSync4("git", ["-C", repoRoot, "ls-files", "-z", "--cached", "--", ...repoRelativePaths], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  return new Set(
    stdout.split("\0").filter((path) => path.length > 0).map(toPosix)
  );
};
var queryIgnoredFiles = (repoRoot, repoRelativePaths) => {
  if (repoRelativePaths.length === 0) return /* @__PURE__ */ new Set();
  const input = `${repoRelativePaths.join("\0")}\0`;
  let stdout;
  try {
    stdout = execFileSync4("git", ["-C", repoRoot, "check-ignore", "--no-index", "-z", "--stdin"], {
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"]
    });
  } catch (error) {
    const failure = error;
    if (failure.status !== 1) throw error;
    stdout = typeof failure.stdout === "string" ? failure.stdout : "";
  }
  return new Set(
    stdout.split("\0").filter((path) => path.length > 0).map(toPosix)
  );
};
function filterTrackedEligibility(candidates, options) {
  const eligible = [];
  const dropped = [];
  const errors = [];
  if (candidates.length === 0) return { eligible, dropped, errors, ignoreQueryCount: 0, trackedQueryCount: 0 };
  const cwdRepoRoot = resolveRepoRoot(options.cwd);
  if (cwdRepoRoot === null) {
    return {
      eligible,
      dropped: candidates.map((candidate) => ({ candidate, reason: "outside-repository" })),
      errors,
      ignoreQueryCount: 0,
      trackedQueryCount: 0
    };
  }
  const inScope = [];
  const spanRoot = resolveSpanRoot(cwdRepoRoot);
  for (const candidate of candidates) {
    const canonicalPath = canonicalizePath(candidate.absolutePath);
    const relativePath = nodePath4.relative(cwdRepoRoot, canonicalPath);
    if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${nodePath4.sep}`) || nodePath4.isAbsolute(relativePath)) {
      dropped.push({ candidate, reason: "outside-repository" });
      continue;
    }
    const repoRelativePath = toPosix(relativePath);
    if (isInsideSpanRoot(repoRelativePath, spanRoot)) {
      dropped.push({ candidate, reason: "span-metadata-path" });
      continue;
    }
    inScope.push({ candidate, repoRoot: cwdRepoRoot, repoRelativePath });
  }
  const ignoreQuery = options.queryIgnoredFiles ?? queryIgnoredFiles;
  let ignoreQueryCount = 0;
  let ignored;
  try {
    const ignorePaths = [...new Set(inScope.map(({ repoRelativePath }) => repoRelativePath))];
    if (ignorePaths.length > 0) ignoreQueryCount += 1;
    ignored = ignoreQuery(cwdRepoRoot, ignorePaths);
  } catch (error) {
    errors.push({
      kind: "ignored-files-query-failed",
      repoRoot: cwdRepoRoot,
      message: error instanceof Error ? error.message : String(error)
    });
    dropped.push(...inScope.map(({ candidate }) => ({ candidate, reason: "eligibility-query-failed" })));
    const candidateOrder2 = new Map(candidates.map((candidate, index) => [candidate, index]));
    dropped.sort(
      (left, right) => (candidateOrder2.get(left.candidate) ?? 0) - (candidateOrder2.get(right.candidate) ?? 0)
    );
    return { eligible, dropped, errors, ignoreQueryCount, trackedQueryCount: 0 };
  }
  const normalizedIgnored = new Set([...ignored].map(toPosix));
  const eligibleForMembership = inScope.filter(({ candidate, repoRelativePath }) => {
    if (!normalizedIgnored.has(repoRelativePath)) return true;
    dropped.push({ candidate, reason: "ignored-path" });
    return false;
  });
  const byRepo = /* @__PURE__ */ new Map();
  for (const scoped of eligibleForMembership) {
    const group = byRepo.get(scoped.repoRoot) ?? [];
    group.push(scoped);
    byRepo.set(scoped.repoRoot, group);
  }
  let trackedQueryCount = 0;
  const query = options.queryTrackedFiles ?? queryTrackedFiles;
  for (const [repoRoot, group] of byRepo) {
    const paths = [...new Set(group.map(({ repoRelativePath }) => repoRelativePath))];
    let tracked;
    trackedQueryCount += 1;
    try {
      tracked = query(repoRoot, paths);
    } catch (error) {
      errors.push({
        kind: "tracked-files-query-failed",
        repoRoot,
        message: error instanceof Error ? error.message : String(error)
      });
      dropped.push(...group.map(({ candidate }) => ({ candidate, reason: "eligibility-query-failed" })));
      continue;
    }
    const normalizedTracked = new Set([...tracked].map(toPosix));
    for (const scoped of group) {
      if (normalizedTracked.has(scoped.repoRelativePath)) eligible.push(scoped.candidate);
      else dropped.push({ candidate: scoped.candidate, reason: "untracked-path" });
    }
  }
  const candidateOrder = new Map(candidates.map((candidate, index) => [candidate, index]));
  eligible.sort((left, right) => (candidateOrder.get(left) ?? 0) - (candidateOrder.get(right) ?? 0));
  dropped.sort((left, right) => (candidateOrder.get(left.candidate) ?? 0) - (candidateOrder.get(right.candidate) ?? 0));
  return { eligible, dropped, errors, ignoreQueryCount, trackedQueryCount };
}

// src/common/touch-core.ts
import { execFileSync as execFileSync5 } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs6 from "node:fs";
import { basename as basename4, dirname as dirname5, join as join4 } from "node:path";
var MAX_CONTEXT_JSON_BYTES = 16 * 1024 * 1024;

// src/common/parse-response.ts
import { existsSync as existsSync4, statSync as statSync5 } from "node:fs";
import { dirname as dirname6, join as join5, resolve as resolvePath2, sep as sep2 } from "node:path";

// src/common/bash-attribution.ts
function createDefaultPlannedTouchStore(layout) {
  return createPlannedTouchStore(layout, DEFAULT_PLANNED_TOUCH_BUDGETS);
}
function readText(path) {
  try {
    return fs7.readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
function unionRange(ranges) {
  return ranges.reduce(
    (union, range) => ({ start: Math.min(union.start, range.start), end: Math.max(union.end, range.end) }),
    { start: ranges[0]?.start ?? 1, end: ranges[0]?.end ?? 1 }
  );
}
function planEvidence(matches, requirements) {
  if (matches.some(({ span }) => span.operation === "delete")) return { kind: "tracked", tracked: true };
  const expectedContent = matches.find(({ span }) => span.expectedContent !== void 0)?.span.expectedContent;
  const ranges = matches.flatMap(
    ({ span }) => span.lineStart === void 0 ? [] : [{ start: span.lineStart, end: span.lineEnd ?? span.lineStart }]
  );
  if (expectedContent !== void 0) {
    return {
      kind: "content-digest",
      algorithm: "sha256",
      digest: createHash2("sha256").update(expectedContent).digest("hex"),
      range: unionRange(ranges)
    };
  }
  if (requirements.has("pre-command-eof")) {
    const content = readText(matches[0].span.absolutePath);
    if (content !== null) {
      return {
        kind: "eof",
        line: content.length === 0 ? 0 : content.split("\n").length,
        byteLength: Buffer.byteLength(content)
      };
    }
  }
  return void 0;
}
function planGroupKey(span) {
  return `${span.absolutePath}\0${span.operation}\0${span.simpleCommandIndex}`;
}
function countBy(values) {
  return values.reduce(
    (counts, value) => {
      counts[value] = (counts[value] ?? 0) + 1;
      return counts;
    },
    {}
  );
}
function planBashTouches(command, cwd, sessionId, toolUseId, logger2, store) {
  const started = performance.now();
  const parsed = parseCommandLayered(command, { cwd, readPreState: readText });
  const requested = /* @__PURE__ */ new Map();
  for (const request of parsed.preStateRequests) {
    const key = `${request.absolutePath}\0${request.operation}\0${request.simpleCommandIndex}`;
    const requirements = requested.get(key) ?? /* @__PURE__ */ new Set();
    requirements.add(request.requirement);
    requested.set(key, requirements);
  }
  const candidates = parsed.resolved.filter(
    ({ span }) => span.operation === "delete" || requested.has(planGroupKey(span))
  );
  const tracked = filterTrackedEligibility(
    candidates.map((value) => ({ absolutePath: value.span.absolutePath, value })),
    { cwd }
  );
  if (tracked.eligible.length === 0) {
    logger2.info?.("git-span static attribution pre-plan", {
      resolved: parsed.resolved.length,
      unresolved: parsed.unresolved.length,
      unresolvedByIdiom: countBy(parsed.unresolved.map(({ idiom }) => idiom)),
      unresolvedByReason: countBy(parsed.unresolved.map(({ reasonCode }) => reasonCode)),
      planned: 0,
      trackedDrops: tracked.dropped.length,
      executionGateDrops: 0,
      parserLatencyMs: performance.now() - started,
      ignoreQueryCount: tracked.ignoreQueryCount,
      trackedQueryCount: tracked.trackedQueryCount,
      eligibilityErrors: tracked.errors
    });
    return;
  }
  const repoRoot = resolveRepoRoot(cwd);
  if (repoRoot === null) return;
  const groups = /* @__PURE__ */ new Map();
  for (const { value } of tracked.eligible) {
    const key = planGroupKey(value.span);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  const touches = [];
  for (const [key, matches] of groups) {
    const span = matches[0].span;
    const requirements = requested.get(key) ?? /* @__PURE__ */ new Set();
    const evidence = planEvidence(matches, requirements);
    touches.push({
      repoRelativePath: toPosix(relativeToRepo(repoRoot, span.absolutePath)),
      operation: span.operation,
      ranges: matches.flatMap(
        ({ span: item }) => item.lineStart === void 0 ? [] : [{ start: item.lineStart, end: item.lineEnd ?? item.lineStart }]
      ),
      simpleCommandIndex: span.simpleCommandIndex,
      ...evidence === void 0 ? {} : { evidence }
    });
  }
  store.put({ version: 1, sessionId, toolUseId, repoRoot, createdAtMs: Date.now(), touches });
  logger2.info?.("git-span static attribution pre-plan", {
    resolved: parsed.resolved.length,
    unresolved: parsed.unresolved.length,
    unresolvedReasons: parsed.unresolved.map(({ reasonCode }) => reasonCode),
    unresolvedByIdiom: countBy(parsed.unresolved.map(({ idiom }) => idiom)),
    unresolvedByReason: countBy(parsed.unresolved.map(({ reasonCode }) => reasonCode)),
    planned: touches.length,
    trackedDrops: tracked.dropped.length,
    executionGateDrops: 0,
    parserLatencyMs: performance.now() - started,
    ignoreQueryCount: tracked.ignoreQueryCount,
    trackedQueryCount: tracked.trackedQueryCount,
    eligibilityErrors: tracked.errors
  });
}

// src/common/update-check-env.ts
function disableUpdateCheck() {
  process.env.GIT_SPAN_DISABLE_UPDATE_CHECK = "1";
}

// src/claude/static-plan.ts
function narrowCommand(toolInput) {
  if (toolInput !== null && typeof toolInput === "object" && "command" in toolInput) {
    const command = toolInput.command;
    if (typeof command === "string" && command.length > 0) return command;
  }
  return null;
}
function createHandler(layout = DEFAULT_SESSION_LAYOUT) {
  return async (input, ctx) => {
    try {
      if (!input.session_id || !input.tool_use_id) return null;
      const command = narrowCommand(input.tool_input);
      if (command === null) return null;
      planBashTouches(
        command,
        input.cwd ?? "",
        input.session_id,
        input.tool_use_id,
        ctx.logger,
        createDefaultPlannedTouchStore(layout)
      );
      return null;
    } catch (err) {
      ctx.logger.warn("git-span static Bash pre-plan failed closed for attribution", { err });
      return null;
    }
  };
}
disableUpdateCheck();
var static_plan_default = preToolUseHook({ matcher: "Bash", timeout: 1e4 }, createHandler());

// src/claude/static-plan-entry.ts
execute(static_plan_default);

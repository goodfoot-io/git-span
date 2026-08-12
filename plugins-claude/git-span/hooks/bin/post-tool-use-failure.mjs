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
function postToolUseFailureHook(config, handler) {
  return createHookFunction("PostToolUseFailure", config, handler);
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
var postToolUseFailureOutput = /* @__PURE__ */ createHookSpecificOutputBuilder("PostToolUseFailure");

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
function relativeToRepo(repoRoot, absPath) {
  const root = toPosix(repoRoot);
  const abs = toPosix(absPath);
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return abs.startsWith(prefix) ? abs.slice(prefix.length) : abs;
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
var SNAPSHOTS_DIR = "snapshots";
var TOMBSTONE_SUFFIX = ".tombstone.json";
var OBJECT_DIR_SUFFIX = ".objects";
var TEMP_INDEX_SUFFIX = ".index";
var RECORD_SUFFIX = ".json";
function createSessionLayout(base) {
  const dir = (sessionId) => nodePath.join(base, sanitizeSessionId(sessionId));
  const snapshotsDir = (sessionId) => nodePath.join(dir(sessionId), SNAPSHOTS_DIR);
  const callFile = (sessionId, toolUseId, suffix) => nodePath.join(snapshotsDir(sessionId), `${sanitizeSessionId(toolUseId)}${suffix}`);
  const isTombstoneName = (name) => name.endsWith(TOMBSTONE_SUFFIX);
  return Object.freeze({
    base,
    trashDir: nodePath.join(nodePath.dirname(base), "session-trash"),
    dir,
    snapshotsDir,
    recordFile: (sessionId, toolUseId) => callFile(sessionId, toolUseId, RECORD_SUFFIX),
    objectDir: (sessionId, toolUseId) => callFile(sessionId, toolUseId, OBJECT_DIR_SUFFIX),
    tempIndexFile: (sessionId, toolUseId) => callFile(sessionId, toolUseId, TEMP_INDEX_SUFFIX),
    tombstoneFile: (sessionId, toolUseId) => callFile(sessionId, toolUseId, TOMBSTONE_SUFFIX),
    memoFile: (sessionId) => nodePath.join(dir(sessionId), "touch-memo.json"),
    recordlessNoteFile: (sessionId) => nodePath.join(dir(sessionId), "snapshot-recordless-note"),
    isTombstoneName,
    isRecordName: (name) => name.endsWith(RECORD_SUFFIX) && !isTombstoneName(name),
    callStem: (name) => {
      for (const suffix of [TOMBSTONE_SUFFIX, RECORD_SUFFIX, OBJECT_DIR_SUFFIX, TEMP_INDEX_SUFFIX]) {
        if (name.endsWith(suffix)) return name.slice(0, -suffix.length);
      }
      return null;
    },
    callFiles: (snapshots, stem) => ({
      record: nodePath.join(snapshots, `${stem}${RECORD_SUFFIX}`),
      tombstone: nodePath.join(snapshots, `${stem}${TOMBSTONE_SUFFIX}`),
      objectDir: nodePath.join(snapshots, `${stem}${OBJECT_DIR_SUFFIX}`),
      tempIndexFile: nodePath.join(snapshots, `${stem}${TEMP_INDEX_SUFFIX}`)
    })
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
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = nodePath.join(layout.base, entry.name);
    try {
      const stat = fs2.statSync(dirPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs2.mkdirSync(layout.trashDir, { recursive: true, mode: 448 });
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
function indentBlockBody(text) {
  return text.split("\n").map((line) => line.length > 0 ? `  ${line}` : line).join("\n");
}

// src/common/snapshot-harness.ts
import { execFileSync as execFileSync4 } from "node:child_process";
import { mkdirSync as mkdirSync5, readdirSync as readdirSync3, readFileSync as readFileSync3, rmSync as rmSync3, statSync as statSync4, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join5 } from "node:path";

// src/common/snapshot-core.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync as mkdirSync3, writeFileSync } from "node:fs";
import { isAbsolute as isAbsolute2, join as join2, relative, resolve as resolve2, sep } from "node:path";
var DEFAULT_SNAPSHOT_BUDGETS = {
  preSideMaxWallSeconds: 1,
  maxStorageBytes: 64 * 1024 * 1024,
  maxTouchedFiles: 100,
  postSideWallSeconds: 5,
  recordTtlMs: 24 * 60 * 60 * 1e3,
  unfinishedEntryTtlMs: 15 * 60 * 1e3
};
function hunksToPostRanges(hunks) {
  if (hunks.some((h) => h.postLines === 0)) return { changed: [], wholeFile: true };
  const changed = hunks.map((h) => ({
    start: h.postStart,
    end: h.postStart + h.postLines - 1
  }));
  return { changed, wholeFile: false };
}
var PATH_COVERAGE_GAP = /^(?:post-side wall budget exhausted:|touched-files cap \d+ exceeded:|unreadable at compare:|snapshot compare aborted:|write-tree degraded to stat-only:)/;
function recordHasPathCoverageGap(record) {
  return record.gaps.some((g) => PATH_COVERAGE_GAP.test(g));
}
function applyAmbiguityRules(mine, siblings, path) {
  const myPreHash = mine.preHash;
  const ordered = [...siblings].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.toolUseId < b.toolUseId ? -1 : a.toolUseId > b.toolUseId ? 1 : 0;
  });
  for (const sib of ordered) {
    const covers = sib.coverageGap || sib.pre !== null || sib.post !== null;
    if (!covers) continue;
    if (!sib.consumed) {
      return {
        ambiguous: true,
        reason: `unconsumed sibling ${sib.toolUseId} may still write ${path}`,
        siblingToolUseId: sib.toolUseId,
        siblingSessionId: sib.sessionId
      };
    }
    const preHash = sib.pre?.hash ?? null;
    const postHash = sib.post?.hash ?? null;
    if (sib.createdAt > mine.createdAt) {
      if (postHash === null) {
        if (sib.coverageGap) {
          return {
            ambiguous: true,
            reason: `sibling ${sib.toolUseId} consumed with a coverage gap and no post state for ${path} \u2014 its end state is unknowable`,
            siblingToolUseId: sib.toolUseId,
            siblingSessionId: sib.sessionId
          };
        }
        continue;
      }
      if (postHash === preHash) continue;
      return {
        ambiguous: true,
        reason: `sibling ${sib.toolUseId} changed ${path} in a window overlapping mine`,
        siblingToolUseId: sib.toolUseId,
        siblingSessionId: sib.sessionId
      };
    }
    if (preHash !== null && preHash === postHash) continue;
    if (postHash !== null && postHash === myPreHash) continue;
    if (sib.consumedAt !== null && sib.consumedAt <= mine.createdAt) continue;
    return {
      ambiguous: true,
      reason: `sibling ${sib.toolUseId} changed ${path} in a window extending past my baseline`,
      siblingToolUseId: sib.toolUseId,
      siblingSessionId: sib.sessionId
    };
  }
  return { ambiguous: false };
}
function classifyTextOrBinary(content) {
  if (content.length === 0) return true;
  let suspect = 0;
  let i = 0;
  while (i < content.length) {
    const b = content[i];
    if (b < 128) {
      if (b < 32 && (b < 8 || b > 13) && b !== 27 || b === 127) suspect += 1;
      i += 1;
      continue;
    }
    const len = b >= 240 && b <= 244 ? 4 : b >= 224 && b <= 239 ? 3 : b >= 194 && b <= 223 ? 2 : 0;
    if (len === 0) {
      suspect += 1;
      i += 1;
      continue;
    }
    let wellFormed = i + len <= content.length;
    for (let j = 1; wellFormed && j < len; j += 1) {
      const c = content[i + j];
      if (c < 128 || c > 191) wellFormed = false;
    }
    if (wellFormed) {
      i += len;
    } else {
      suspect += 1;
      i += 1;
    }
  }
  return suspect / content.length <= BINARY_SUSPECT_RATIO;
}
var BINARY_SUSPECT_RATIO = 0.1;
var STAT_ONLY_SWEEP_FLOOR_MS = 2e3;
function captureWriteTree(input) {
  const { repoRoot, objectDir, indexFile: indexFile2, alternates, realIndexFile, spanRoot, wallBudgetMs, runGit, stat } = input;
  const gaps = [];
  const start = input.wallStart ?? Date.now();
  const remaining = () => Math.max(1, wallBudgetMs - (Date.now() - start));
  try {
    mkdirSync3(join2(objectDir, "info"), { recursive: true, mode: 448 });
    writeFileSync(join2(objectDir, "info", "alternates"), `${alternates}
`, { mode: 384 });
    if (realIndexFile !== null) copyFileSync(realIndexFile, indexFile2);
    const env = { GIT_INDEX_FILE: indexFile2, GIT_OBJECT_DIRECTORY: objectDir };
    runGit(["add", "-A"], { cwd: repoRoot, env, timeoutMs: remaining() });
    const out = runGit(["write-tree"], { cwd: repoRoot, env, timeoutMs: remaining() });
    const treeSha = out.toString("utf8").trim();
    if (/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(treeSha)) return { treeSha, gaps };
    gaps.push(`write-tree degraded to stat-only: unexpected write-tree output ${JSON.stringify(treeSha)}`);
  } catch (err) {
    gaps.push(`write-tree degraded to stat-only: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    return {
      treeSha: null,
      statOnly: statOnlySweep({
        repoRoot,
        spanRoot,
        timeoutMs: Math.max(remaining(), STAT_ONLY_SWEEP_FLOOR_MS),
        runGit,
        stat
      }),
      gaps
    };
  } catch (err) {
    gaps.push(`stat-only sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    return { treeSha: null, gaps };
  }
}
function statOnlySweep(input) {
  const raw = input.runGit(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: input.repoRoot,
    timeoutMs: input.timeoutMs
  }).toString("utf8");
  const spanRel = spanRootRelative(input.repoRoot, input.spanRoot);
  const statOnly = {};
  for (const rel of raw.split("\0")) {
    if (rel.length === 0 || isInsideSpanRoot(rel, spanRel)) continue;
    const st = input.stat(join2(input.repoRoot, rel));
    if (st !== null) statOnly[rel] = { size: st.size, mtimeNs: st.mtimeNs };
  }
  return statOnly;
}
function spanRootRelative(repoRoot, spanRoot) {
  return isAbsolute2(spanRoot) ? relative(repoRoot, spanRoot).split(sep).join("/") : spanRoot;
}
function compareTrees(input) {
  const { preTreeSha, postTreeSha, repoRoot, objectDir, spanRoot, budgets, wallStart, runGit } = input;
  const clock = input.wallClock ?? Date.now;
  const wallMs = budgets.postSideWallSeconds * 1e3;
  const wallExhausted = () => clock() - wallStart > wallMs;
  const remaining = () => Math.max(1, wallMs - (clock() - wallStart));
  const env = { GIT_OBJECT_DIRECTORY: objectDir };
  const spanRel = spanRootRelative(repoRoot, spanRoot);
  const attributions = /* @__PURE__ */ new Map();
  const gaps = [];
  const contentHashes = /* @__PURE__ */ new Map();
  const catBlob = (tree, path) => runGit(["cat-file", "blob", `${tree}:${path}`], { cwd: repoRoot, env, timeoutMs: remaining() });
  const isTimeout = (err) => err !== null && typeof err === "object" && "code" in err && err.code === "ETIMEDOUT" || /ETIMEDOUT/.test(String(err));
  const enumerationExhausted = {
    attributions,
    unchanged: /* @__PURE__ */ new Set(),
    gaps,
    contentHashes
  };
  let preTreePaths;
  try {
    preTreePaths = runGit(["ls-tree", "-r", "--name-only", "-z", preTreeSha], {
      cwd: repoRoot,
      env,
      timeoutMs: remaining()
    }).toString("utf8").split("\0").filter((p) => p.length > 0 && !isInsideSpanRoot(p, spanRel));
  } catch (err) {
    if (!isTimeout(err)) throw err;
    gaps.push("post-side wall budget exhausted: attributed 0, the pre-tree enumeration timed out");
    return enumerationExhausted;
  }
  const unchanged = new Set(preTreePaths);
  if (preTreeSha === postTreeSha) return { attributions, unchanged, gaps, contentHashes };
  let raw;
  try {
    raw = runGit(["diff", "--name-status", "-M100%", "--text", "-z", preTreeSha, postTreeSha], {
      cwd: repoRoot,
      env,
      timeoutMs: remaining()
    }).toString("utf8");
  } catch (err) {
    if (!isTimeout(err)) throw err;
    gaps.push("post-side wall budget exhausted: attributed 0, the changed-path enumeration timed out");
    return enumerationExhausted;
  }
  const entries = [];
  const tokens = raw.split("\0");
  for (let i = 0; i < tokens.length; ) {
    const status = tokens[i];
    if (status.length === 0) {
      i += 1;
      continue;
    }
    if (status.startsWith("R") || status.startsWith("C")) {
      const from = tokens[i + 1] ?? "";
      const to = tokens[i + 2] ?? "";
      i += 3;
      if (isInsideSpanRoot(from, spanRel) || isInsideSpanRoot(to, spanRel)) continue;
      unchanged.delete(from);
      entries.push({ status: "R", from, to });
      continue;
    }
    const path = tokens[i + 1] ?? "";
    i += 2;
    if (isInsideSpanRoot(path, spanRel)) continue;
    if (status === "M" || status === "D") unchanged.delete(path);
    if (status === "M" || status === "A" || status === "D") entries.push({ status, path });
  }
  let touchedCount = 0;
  let attributed = 0;
  const pushWallGap = (fromIndex) => {
    const rest = entries.slice(fromIndex).map((e) => e.status === "R" ? e.to : e.path);
    gaps.push(
      `post-side wall budget exhausted: attributed ${attributed}/${entries.length}, unattributed ${rest.join(", ")}`
    );
  };
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (wallExhausted()) {
      pushWallGap(i);
      break;
    }
    if (touchedCount >= budgets.maxTouchedFiles) {
      const capPath = entry.status === "R" ? entry.to : entry.path;
      gaps.push(`touched-files cap ${budgets.maxTouchedFiles} exceeded: ${capPath} not attributed`);
      continue;
    }
    touchedCount += 1;
    if (entry.status === "R") {
      attributions.set(entry.to, { kind: "rename", from: entry.from });
      attributed += 1;
      continue;
    }
    const path = entry.path;
    if (entry.status === "A" || entry.status === "D") {
      const tree = entry.status === "A" ? postTreeSha : preTreeSha;
      let hash;
      try {
        hash = createHash("sha256").update(catBlob(tree, path)).digest("hex");
      } catch (err) {
        if (isTimeout(err)) {
          pushWallGap(i);
          break;
        }
        gaps.push(`unreadable at compare: ${path} dropped without attribution`);
        continue;
      }
      contentHashes.set(path, entry.status === "A" ? { pre: null, post: hash } : { pre: hash, post: null });
      attributions.set(path, { kind: entry.status === "A" ? "created" : "deleted" });
      attributed += 1;
      continue;
    }
    let preBlob;
    let postBlob;
    try {
      preBlob = catBlob(preTreeSha, path);
      postBlob = catBlob(postTreeSha, path);
    } catch (err) {
      if (isTimeout(err)) {
        pushWallGap(i);
        break;
      }
      gaps.push(`unreadable at compare: ${path} dropped without attribution`);
      continue;
    }
    contentHashes.set(path, {
      pre: createHash("sha256").update(preBlob).digest("hex"),
      post: createHash("sha256").update(postBlob).digest("hex")
    });
    if (classifyTextOrBinary(preBlob) && classifyTextOrBinary(postBlob)) {
      let diffOut;
      try {
        diffOut = runGit(["diff", "--unified=0", "--text", preTreeSha, postTreeSha, "--", `:(literal)${path}`], {
          cwd: repoRoot,
          env,
          timeoutMs: remaining()
        }).toString("utf8");
      } catch (err) {
        if (isTimeout(err)) {
          pushWallGap(i);
          break;
        }
        throw err;
      }
      const hunks = parseUnifiedZeroHunks(diffOut);
      attributions.set(path, {
        kind: "changed",
        observed: hunks.length > 0 ? hunksToPostRanges(hunks) : { changed: [], wholeFile: true }
      });
    } else {
      gaps.push(`binary-scope: ${path} classified binary, whole-file scope`);
      attributions.set(path, { kind: "changed", observed: { changed: [], wholeFile: true } });
    }
    attributed += 1;
  }
  return { attributions, unchanged, gaps, contentHashes };
}
function parseUnifiedZeroHunks(diffText) {
  const hunks = [];
  for (const m of diffText.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    hunks.push({
      preStart: Number(m[1]),
      preLines: m[2] === void 0 ? 1 : Number(m[2]),
      postStart: Number(m[3]),
      postLines: m[4] === void 0 ? 1 : Number(m[4])
    });
  }
  return hunks;
}
function compareStatOnly(pre, post) {
  const attributions = /* @__PURE__ */ new Map();
  const unchanged = /* @__PURE__ */ new Set();
  for (const [path, preEntry] of Object.entries(pre)) {
    const postEntry = post[path];
    if (postEntry === void 0) {
      attributions.set(path, { kind: "deleted" });
    } else if (postEntry.size === preEntry.size && postEntry.mtimeNs === preEntry.mtimeNs) {
      unchanged.add(path);
    } else {
      attributions.set(path, { kind: "changed", observed: { changed: [], wholeFile: true } });
    }
  }
  for (const path of Object.keys(post)) {
    if (!(path in pre)) attributions.set(path, { kind: "created" });
  }
  return { attributions, unchanged, gaps: [], contentHashes: /* @__PURE__ */ new Map() };
}
function hashTreePath(input) {
  const opts = {
    cwd: input.repoRoot,
    env: { GIT_OBJECT_DIRECTORY: input.objectDir },
    ...input.timeoutMs !== void 0 ? { timeoutMs: input.timeoutMs } : {}
  };
  try {
    const listing = input.runGit(["ls-tree", input.treeSha, "--", `:(literal)${input.path}`], opts);
    if (listing.toString("utf8").trim() === "") return { kind: "absent" };
    const blob = input.runGit(["cat-file", "blob", `${input.treeSha}:${input.path}`], opts);
    return { kind: "hash", hash: createHash("sha256").update(blob).digest("hex") };
  } catch (err) {
    return { kind: "error", reason: String(err) };
  }
}

// src/common/snapshot-store.ts
import {
  chmodSync,
  existsSync as existsSync2,
  mkdirSync as mkdirSync4,
  readdirSync as readdirSync2,
  readFileSync,
  renameSync as renameSync2,
  rmSync as rmSync2,
  statSync as statSync2,
  utimesSync as utimesSync2,
  writeFileSync as writeFileSync2
} from "node:fs";
import { basename as basename2, dirname as dirname3, join as join3 } from "node:path";
var SNAPSHOT_INDEX_DIR = "snapshot-index";
var ACTIVITY_LOG_DIR = "activity-log";
function indexDir(repoRoot) {
  return join3(queueRoot(repoRoot), SNAPSHOT_INDEX_DIR);
}
function indexFile(repoRoot, sessionId, toolUseId) {
  return join3(indexDir(repoRoot), `${sanitizeSessionId(sessionId)}__${sanitizeSessionId(toolUseId)}.json`);
}
function activityDir(repoRoot) {
  return join3(queueRoot(repoRoot), ACTIVITY_LOG_DIR);
}
var SWEEP_READ_MARGIN_MS = 5e3;
var TRASH_TTL_MS = 6e4;
var TRASH_MARKER = ".trash-";
function isTrashName(name) {
  return name.startsWith(".") && name.includes(TRASH_MARKER);
}
function trashFile(file) {
  try {
    const trashPath = join3(dirname3(file), `.${basename2(file)}${TRASH_MARKER}${process.pid}-${Date.now().toString(36)}`);
    renameSync2(file, trashPath);
    try {
      const now = Date.now() / 1e3;
      utimesSync2(trashPath, now, now);
    } catch (err) {
    }
    return "trashed";
  } catch (err) {
    return err.code === "ENOENT" ? "absent" : "failed";
  }
}
function isRecentlyWritten(file, now) {
  try {
    return statSync2(file).mtimeMs > now - SWEEP_READ_MARGIN_MS;
  } catch {
    return false;
  }
}
function emptyTrash(dir, now) {
  for (const name of listDir(dir)) {
    if (!isTrashName(name)) continue;
    const file = join3(dir, name);
    let mtimeMs;
    try {
      mtimeMs = statSync2(file).mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs < now - TRASH_TTL_MS) rmSync2(file, { recursive: true, force: true });
  }
}
function bigintReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}
function recordReviver(key, value) {
  if (key === "mtimeNs" && typeof value === "string") {
    try {
      return BigInt(value);
    } catch {
      return value;
    }
  }
  return value;
}
function readJsonFile(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
function writeJsonAtomic(file, data, replacer) {
  const dir = dirname3(file);
  mkdirSync4(dir, { recursive: true, mode: 448 });
  chmodSync(dir, 448);
  chmodSync(dirname3(dir), 448);
  const tmp = join3(
    dir,
    `.${basename2(file)}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}.tmp`
  );
  try {
    writeFileSync2(tmp, JSON.stringify(data, replacer), { mode: 384 });
    chmodSync(tmp, 384);
    renameSync2(tmp, file);
  } catch (err) {
    rmSync2(tmp, { force: true });
    throw err;
  }
}
function fileSize(file) {
  try {
    return statSync2(file).size;
  } catch {
    return 0;
  }
}
function dirSizeBytes(dir) {
  let total = 0;
  let names;
  try {
    names = readdirSync2(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    const entry = join3(dir, name);
    let st;
    try {
      st = statSync2(entry);
    } catch {
      continue;
    }
    total += st.isDirectory() ? dirSizeBytes(entry) : st.size;
  }
  return total;
}
function listDir(dir) {
  try {
    return readdirSync2(dir);
  } catch {
    return [];
  }
}
function readRecordFile(file, logger2) {
  if (!existsSync2(file)) return null;
  const data = readJsonFile(file);
  if (data === null) {
    logger2.warn(`snapshot store: unreadable record file ${file}, treated as absent`);
    return null;
  }
  if (typeof data !== "object" || data === null || data.version !== 2) {
    logger2.warn(`snapshot store: incompatible record version in ${file}, treated as absent`);
    return null;
  }
  return JSON.parse(JSON.stringify(data, bigintReplacer), recordReviver);
}
function readTombstoneFile(file, logger2) {
  const data = readJsonFile(file);
  if (data === null) return null;
  if (typeof data !== "object" || data === null || data.version !== 1) {
    logger2.warn(`snapshot store: incompatible tombstone version in ${file}, treated as absent`);
    return null;
  }
  return data;
}
function readIndexEntries(repoRoot, logger2) {
  const out = [];
  for (const name of listDir(indexDir(repoRoot))) {
    if (!name.endsWith(".json")) continue;
    const data = readJsonFile(join3(indexDir(repoRoot), name));
    if (data === null || typeof data !== "object" || data === null) continue;
    const version = data.version;
    if (version !== void 0 && version !== 1) {
      logger2.warn(`snapshot store: incompatible index version in ${name}, excluded`);
      continue;
    }
    out.push(data);
  }
  return out;
}
function readActivityEntry(file) {
  const data = readJsonFile(file);
  if (data === null || typeof data !== "object" || data === null) return null;
  const version = data.version;
  if (version !== void 0 && version !== 1) return null;
  return data;
}
function createSnapshotStore(logger2, budgets = DEFAULT_SNAPSHOT_BUDGETS, layout = DEFAULT_SESSION_LAYOUT) {
  const recordFile = (sessionId, toolUseId) => layout.recordFile(sessionId, toolUseId);
  const tombstoneFile = (sessionId, toolUseId) => layout.tombstoneFile(sessionId, toolUseId);
  function tombstoneExists(sessionId, toolUseId) {
    try {
      statSync2(tombstoneFile(sessionId, toolUseId));
      return true;
    } catch {
      return false;
    }
  }
  function repoRecordBytes(repoRoot) {
    let total = 0;
    for (const entry of readIndexEntries(repoRoot, logger2)) {
      total += fileSize(recordFile(entry.sessionId, entry.toolUseId));
      total += dirSizeBytes(layout.objectDir(entry.sessionId, entry.toolUseId));
      total += fileSize(layout.tempIndexFile(entry.sessionId, entry.toolUseId));
    }
    return total;
  }
  function writeIndexEntry(repoRoot, entry) {
    writeJsonAtomic(indexFile(repoRoot, entry.sessionId, entry.toolUseId), { ...entry, version: 1 });
  }
  function removeIndexEntry(repoRoot, sessionId, toolUseId) {
    if (trashFile(indexFile(repoRoot, sessionId, toolUseId)) === "failed") {
      logger2.warn(`snapshot store: index entry cleanup failed for ${repoRoot}`);
    }
  }
  function reapForeignRecord(dir, name, parsed) {
    const stem = layout.callStem(name) ?? name;
    const siblings = layout.callFiles(dir, stem);
    trashFile(join3(dir, name));
    trashFile(siblings.tombstone);
    trashFile(siblings.objectDir);
    trashFile(siblings.tempIndexFile);
    const repoRoot = parsed?.repoRoot;
    const sessionId = parsed?.sessionId;
    const toolUseId = parsed?.toolUseId;
    if (typeof repoRoot === "string" && typeof sessionId === "string" && typeof toolUseId === "string") {
      removeIndexEntry(repoRoot, sessionId, toolUseId);
    }
    logger2.info?.("git-span snapshot sweep reaped an incompatible or unreadable record", {
      file: join3(dir, name)
    });
  }
  function writeRecord(record) {
    writeJsonAtomic(recordFile(record.sessionId, record.toolUseId), record, bigintReplacer);
  }
  function reposFromRecords() {
    const repos = /* @__PURE__ */ new Set();
    for (const sessionName of listDir(layout.base)) {
      const dir = layout.snapshotsDir(sessionName);
      for (const name of listDir(dir)) {
        if (!layout.isRecordName(name)) continue;
        const file = join3(dir, name);
        if (isRecentlyWritten(file, Date.now())) continue;
        const rec = readRecordFile(file, logger2);
        if (rec !== null) repos.add(rec.repoRoot);
      }
    }
    return repos;
  }
  function pruneStaleActivity(now, repos) {
    let removed = 0;
    for (const repo of repos) {
      try {
        for (const name of listDir(activityDir(repo))) {
          if (!name.endsWith(".json")) continue;
          const file = join3(activityDir(repo), name);
          if (isRecentlyWritten(file, now)) continue;
          const entry = readActivityEntry(file);
          if (entry === null) continue;
          let mtimeMs;
          try {
            mtimeMs = statSync2(file).mtimeMs;
          } catch {
            continue;
          }
          const ttlMs = entry.finishedAt !== null ? budgets.recordTtlMs : budgets.unfinishedEntryTtlMs;
          if (mtimeMs < now - ttlMs) {
            trashFile(file);
            removed += 1;
          }
        }
      } catch (e) {
        logger2.warn(`snapshot store: activity prune skipped ${repo}: ${String(e)}`);
      }
    }
    return removed;
  }
  function sweepOrphanIndexes(_now, repos) {
    let removed = 0;
    for (const repo of repos) {
      try {
        for (const name of listDir(indexDir(repo))) {
          if (!name.endsWith(".json")) continue;
          const file = join3(indexDir(repo), name);
          if (isRecentlyWritten(file, _now)) continue;
          const data = readJsonFile(file);
          if (data === null || typeof data !== "object" || data === null) continue;
          const version = data.version;
          if (version !== void 0 && version !== 1) continue;
          const entry = data;
          const recFile = recordFile(entry.sessionId, entry.toolUseId);
          if (!isRecentlyWritten(recFile, _now) && readRecordFile(recFile, logger2) === null) {
            trashFile(file);
            removed += 1;
          }
        }
      } catch (e) {
        logger2.warn(`snapshot store: orphan-index sweep skipped ${repo}: ${String(e)}`);
      }
    }
    return removed;
  }
  function runSweep(now, extraRepos) {
    const result = { records: 0, tombstones: 0, activityEntries: 0, indexEntries: 0, foreignRecords: 0 };
    const repos = new Set(extraRepos);
    for (const sessionName of listDir(layout.base)) {
      const dir = layout.snapshotsDir(sessionName);
      const names = listDir(dir);
      for (const name of names) {
        if (!layout.isTombstoneName(name)) continue;
        const file = join3(dir, name);
        if (isRecentlyWritten(file, now)) continue;
        const t = readTombstoneFile(file, logger2);
        if (t === null) continue;
        if (now - t.consumedAt > budgets.recordTtlMs) {
          const siblings = layout.callFiles(dir, layout.callStem(name) ?? name);
          const recordPath = siblings.record;
          const rec = isRecentlyWritten(recordPath, now) ? null : readRecordFile(recordPath, logger2);
          trashFile(recordPath);
          trashFile(file);
          trashFile(siblings.objectDir);
          trashFile(siblings.tempIndexFile);
          if (rec !== null) removeIndexEntry(rec.repoRoot, rec.sessionId, rec.toolUseId);
          result.tombstones += 1;
        }
      }
      for (const name of names) {
        if (!layout.isRecordName(name)) continue;
        const file = join3(dir, name);
        if (isRecentlyWritten(file, now)) continue;
        const data = readJsonFile(file);
        const parsed = data !== null && typeof data === "object" ? data : null;
        if (parsed === null) {
          let mtimeMs;
          try {
            mtimeMs = statSync2(file).mtimeMs;
          } catch {
            continue;
          }
          if (now - mtimeMs > budgets.recordTtlMs) {
            reapForeignRecord(dir, name, parsed);
            result.foreignRecords += 1;
          }
          continue;
        }
        if (parsed.version !== 2) {
          reapForeignRecord(dir, name, parsed);
          result.foreignRecords += 1;
          continue;
        }
        const rec = readRecordFile(file, logger2);
        if (rec === null) continue;
        repos.add(rec.repoRoot);
        if (now - rec.createdAt > budgets.recordTtlMs) {
          trashFile(file);
          trashFile(tombstoneFile(rec.sessionId, rec.toolUseId));
          trashFile(layout.objectDir(rec.sessionId, rec.toolUseId));
          trashFile(layout.tempIndexFile(rec.sessionId, rec.toolUseId));
          removeIndexEntry(rec.repoRoot, rec.sessionId, rec.toolUseId);
          result.records += 1;
        }
      }
      for (const name of names) {
        if (!name.endsWith(".objects") && !name.endsWith(".index")) continue;
        const stem = layout.callStem(name);
        if (stem === null) continue;
        const file = join3(dir, name);
        if (existsSync2(layout.callFiles(dir, stem).record)) continue;
        if (isRecentlyWritten(file, now)) continue;
        let mtimeMs;
        try {
          mtimeMs = statSync2(file).mtimeMs;
        } catch {
          continue;
        }
        if (now - mtimeMs > budgets.recordTtlMs) trashFile(file);
      }
      emptyTrash(dir, now);
    }
    result.activityEntries = pruneStaleActivity(now, repos);
    result.indexEntries = sweepOrphanIndexes(now, repos);
    for (const repo of repos) {
      try {
        emptyTrash(activityDir(repo), now);
        emptyTrash(indexDir(repo), now);
      } catch (e) {
        logger2.warn(`snapshot store: trash pass skipped ${repo}: ${String(e)}`);
      }
    }
    return result;
  }
  return {
    layout,
    write(record) {
      const swept = runSweep(Date.now(), [record.repoRoot]);
      const removed = swept.records + swept.tombstones + swept.activityEntries + swept.indexEntries + swept.foreignRecords;
      if (removed > 0) {
        logger2.info?.("git-span snapshot sweep removed expired state", {
          records: swept.records,
          tombstones: swept.tombstones,
          activityEntries: swept.activityEntries,
          indexEntries: swept.indexEntries,
          foreignRecords: swept.foreignRecords
        });
      }
      const repo = record.repoRoot;
      const json = JSON.stringify(record, bigintReplacer);
      const total = repoRecordBytes(repo) + Buffer.byteLength(json, "utf8");
      if (total > budgets.maxStorageBytes) {
        logger2.warn(
          `snapshot store: refusing to persist ${record.toolUseId}: repo storage ${total} bytes exceeds maxStorageBytes ${budgets.maxStorageBytes}; nothing was dropped`
        );
        return false;
      }
      writeRecord(record);
      writeIndexEntry(repo, {
        sessionId: record.sessionId,
        toolUseId: record.toolUseId,
        createdAt: record.createdAt,
        consumed: false,
        consumedAt: null
      });
      return true;
    },
    find(sessionId, toolUseId) {
      if (tombstoneExists(sessionId, toolUseId)) return "tombstoned";
      return readRecordFile(recordFile(sessionId, toolUseId), logger2);
    },
    consume(sessionId, toolUseId, post) {
      if (tombstoneExists(sessionId, toolUseId)) return null;
      const rec = readRecordFile(recordFile(sessionId, toolUseId), logger2);
      if (rec === null) return null;
      const consumedAt = Date.now();
      if (!this.tombstone(sessionId, toolUseId, consumedAt)) return null;
      const consumed = { ...rec, post, consumed: true, consumedAt };
      writeRecord(consumed);
      const indexData = readJsonFile(indexFile(rec.repoRoot, sessionId, toolUseId));
      if (indexData !== null && typeof indexData === "object") {
        writeIndexEntry(rec.repoRoot, {
          sessionId,
          toolUseId,
          createdAt: indexData.createdAt,
          consumed: true,
          consumedAt
        });
      }
      return consumed;
    },
    tombstone(sessionId, toolUseId, consumedAt) {
      const file = tombstoneFile(sessionId, toolUseId);
      const dir = dirname3(file);
      mkdirSync4(dir, { recursive: true, mode: 448 });
      chmodSync(dir, 448);
      chmodSync(dirname3(dir), 448);
      try {
        writeFileSync2(file, JSON.stringify({ version: 1, toolUseId, consumedAt }), { flag: "wx", mode: 384 });
        return true;
      } catch {
        return false;
      }
    },
    listRepoRecords(repoRoot) {
      return readIndexEntries(repoRoot, logger2);
    },
    sweep(now = Date.now()) {
      return runSweep(now, []);
    },
    removeSession(sessionId, agentId) {
      const dir = layout.snapshotsDir(sessionId);
      const repos = /* @__PURE__ */ new Set();
      let recordsRemoved = 0;
      for (const name of listDir(dir)) {
        if (!layout.isRecordName(name)) continue;
        const data = readJsonFile(join3(dir, name));
        const parsed = data !== null && typeof data === "object" ? data : null;
        if (parsed === null || parsed.version !== 2) {
          if (agentId === void 0) {
            reapForeignRecord(dir, name, parsed);
            recordsRemoved += 1;
          }
          continue;
        }
        const rec = readRecordFile(join3(dir, name), logger2);
        if (rec === null) continue;
        if (agentId !== void 0 && rec.agentId !== agentId) continue;
        repos.add(rec.repoRoot);
        trashFile(join3(dir, name));
        trashFile(tombstoneFile(rec.sessionId, rec.toolUseId));
        trashFile(layout.objectDir(rec.sessionId, rec.toolUseId));
        trashFile(layout.tempIndexFile(rec.sessionId, rec.toolUseId));
        removeIndexEntry(rec.repoRoot, rec.sessionId, rec.toolUseId);
        recordsRemoved += 1;
      }
      for (const repo of reposFromRecords()) repos.add(repo);
      let activityRemoved = 0;
      for (const repo of repos) {
        try {
          for (const name of listDir(activityDir(repo))) {
            if (!name.endsWith(".json")) continue;
            const entry = readActivityEntry(join3(activityDir(repo), name));
            if (entry !== null && entry.sessionId === sessionId && (agentId === void 0 || entry.agentId === agentId)) {
              trashFile(join3(activityDir(repo), name));
              activityRemoved += 1;
            }
          }
        } catch (e) {
          logger2.warn(`snapshot store: activity cleanup skipped ${repo}: ${String(e)}`);
        }
      }
      if (recordsRemoved + activityRemoved > 0) {
        logger2.info?.("git-span session cleanup removed snapshot state", {
          sessionId,
          agentId: agentId ?? null,
          records: recordsRemoved,
          activityEntries: activityRemoved
        });
      }
    }
  };
}
function activityEntriesCovering(repoRoot, path, windowStart, now, budgets) {
  const earliest = windowStart - budgets.unfinishedEntryTtlMs;
  const out = [];
  for (const name of listDir(activityDir(repoRoot))) {
    if (!name.endsWith(".json")) continue;
    const file = join3(activityDir(repoRoot), name);
    let mtimeMs;
    try {
      mtimeMs = statSync2(file).mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs < earliest || mtimeMs > now + 1) continue;
    const entry = readActivityEntry(file);
    if (entry === null || entry.finishedAt === null || entry.finishedAt > windowStart) continue;
    if (!entry.paths.some((p) => p.path === path)) continue;
    out.push(entry);
  }
  out.sort((a, b) => a.startedAt - b.startedAt || (a.toolUseId < b.toolUseId ? -1 : a.toolUseId > b.toolUseId ? 1 : 0));
  return out;
}

// src/common/touch-core.ts
import { execFileSync as execFileSync3 } from "node:child_process";
import * as fs3 from "node:fs";
import { basename as basename3, join as join4 } from "node:path";

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
    fs3.statSync(absPath);
    return true;
  } catch {
    return false;
  }
}
function isFileOnDisk(absPath) {
  try {
    return fs3.statSync(absPath).isFile();
  } catch {
    return false;
  }
}
function contentMatches(post, filePath) {
  try {
    if ("exact" in post) return fs3.readFileSync(filePath, "utf8") === post.exact;
    if ("suffix" in post) {
      const content = fs3.readFileSync(filePath, "utf8");
      return content.endsWith(post.suffix) || content.endsWith(`${post.suffix}
`);
    }
    if ("empty" in post) return fs3.statSync(filePath).size === 0;
    return fs3.statSync(filePath).size === post.size;
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
        src = fs3.readFileSync(input.sourcePath, "utf8");
        dst = fs3.readFileSync(input.filePath, "utf8");
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
    return `Restore agreement before committing. Follow confirmed authority. Preserve anchor shape; if an address changed, swap the old anchor for the new one with \`git span replace\`. Update or retire the why only if its meaning changed. Require \`git span drift ${name}\` to report zero, then check the other anchors. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete coupling.`;
  }
  return "For each out-of-date span: restore agreement before committing. Follow confirmed authority. Preserve anchor shape; if an address changed, swap the old anchor for the new one with `git span replace`. Update or retire the why only if its meaning changed. Require `git span drift <name>` to report zero, then check the other anchors. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete coupling.";
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
function intersectsAny(row, ranges) {
  if (ranges === "whole-file") return true;
  if (row.start === 0 && row.end === 0) return true;
  return ranges.some((range) => rangesIntersect(range, { start: row.start, end: row.end }));
}
function recoverRangeFromDisk(written, filePath) {
  if (written.length === 0) return "whole-file";
  let content;
  try {
    content = fs3.readFileSync(filePath, "utf8");
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
    const content = fs3.readFileSync(filePath, "utf8");
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
async function computeSurfaceParts(input, executors, memo, range, driftRows) {
  const covering = await executors.list(input.filePath, input.cwd);
  if (covering.length === 0) return null;
  const anchorsByName = /* @__PURE__ */ new Map();
  for (const row of covering) {
    const rows = anchorsByName.get(row.name) ?? [];
    rows.push(row);
    anchorsByName.set(row.name, rows);
  }
  const touchedNames = [...anchorsByName.keys()].filter(
    (name) => (anchorsByName.get(name) ?? []).some((row) => onTouchedFile(row, input.filePath) && intersectsAny(row, range))
  );
  if (touchedNames.length === 0) return null;
  const driftByName = /* @__PURE__ */ new Map();
  for (const row of driftRows ?? await executors.drift([input.filePath], input.cwd)) {
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
  const fileName = basename3(input.filePath);
  const header = driftedNames.length > 0 ? driftHeader(driftedNames.length, input.kind) : cleanHeader(fileName);
  const footer = driftedNames.length > 0 ? driftFooter(driftedNames) : cleanFooter(fileName);
  return { sections, header, footer, toRecord };
}
async function computeSurface(input, executors, memo, range) {
  const parts = await computeSurfaceParts(input, executors, memo, range);
  if (parts === null) return null;
  return buildBlock(parts.sections, parts.header, parts.footer);
}
async function runTouchHook(input, executors, memo, probeCache, scopes) {
  if (input.kind === "write" && input.observed !== void 0 && input.written.length > 0) {
    throw new Error("touch write carries both written and observed: exactly one must be set");
  }
  if (scopes !== void 0 && scopes.length > 0) {
    let treeModified2 = false;
    try {
      for (const scope of scopes) {
        const fix = await executors.fix(scope.filePath, input.cwd);
        treeModified2 = treeModified2 || fix.modified;
      }
      const driftRows = await executors.drift([], input.cwd);
      const sections = [];
      let header = null;
      let footer = null;
      for (const scope of scopes) {
        const scopeInput = { ...input, filePath: scope.filePath };
        const range = scope.observed.wholeFile ? "whole-file" : scope.observed.changed;
        const parts = await computeSurfaceParts(scopeInput, executors, memo, range, driftRows);
        if (parts === null) continue;
        if (header === null) {
          header = parts.header;
          footer = parts.footer;
        }
        sections.push(...parts.sections);
      }
      if (sections.length === 0) return { additionalContext: null, treeModified: treeModified2 };
      return { additionalContext: buildBlock(sections, header, footer), treeModified: treeModified2 };
    } catch {
      return { additionalContext: null, treeModified: treeModified2 };
    }
  }
  let treeModified = false;
  try {
    let range = "whole-file";
    if (input.kind === "write") {
      if (input.observed === void 0 && input.targetState !== void 0) {
        const probe = probeCache ?? createRealityProbeCache(input.targetState === "absent" ? [input.filePath] : []);
        const outcome = evaluateWriteGate(input, probe);
        if (outcome === "decisiveFail" || outcome === "inconclusive" && input.targetState === "absent") {
          return { additionalContext: null, treeModified: false };
        }
      }
      const fix = await executors.fix(input.filePath, input.cwd);
      treeModified = fix.modified;
      if (input.range !== void 0) {
        range = [input.range];
      } else if (input.observed !== void 0) {
        range = input.observed.wholeFile ? "whole-file" : input.observed.changed;
      } else {
        const recovered = recoverRangeFromDisk(input.written, input.filePath);
        range = recovered === "whole-file" ? "whole-file" : [recovered];
      }
    } else {
      const recovered = recoverReadRange(input.offset, input.limit, input.filePath);
      range = recovered === "whole-file" ? "whole-file" : [recovered];
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

// src/common/snapshot-harness.ts
function resolveSnapshotBudgets(repoRoot) {
  const budgets = { ...DEFAULT_SNAPSHOT_BUDGETS };
  const overrides = [
    ["preSideMaxWallSeconds", "GIT_SPAN_SNAPSHOT_PRE_SIDE_MAX_WALL_SECONDS"],
    ["maxStorageBytes", "GIT_SPAN_SNAPSHOT_MAX_STORAGE_BYTES"],
    ["maxTouchedFiles", "GIT_SPAN_SNAPSHOT_MAX_TOUCHED_FILES"],
    ["postSideWallSeconds", "GIT_SPAN_SNAPSHOT_POST_SIDE_WALL_SECONDS"],
    ["recordTtlMs", "GIT_SPAN_SNAPSHOT_RECORD_TTL_MS"],
    ["unfinishedEntryTtlMs", "GIT_SPAN_SNAPSHOT_UNFINISHED_ENTRY_TTL_MS"]
  ];
  const config = repoRoot === null ? null : readSnapshotConfig(repoRoot);
  for (const [key, envName] of overrides) {
    const raw = process.env[envName];
    if (raw !== void 0 && raw.trim() !== "") {
      const value = Number(raw.trim());
      if (Number.isFinite(value) && value >= 0) {
        budgets[key] = value;
        continue;
      }
    }
    const configKey = `git-span.${envName.slice("GIT_SPAN_".length).toLowerCase().replaceAll("_", "-")}`;
    const configValue = config?.get(configKey);
    if (configValue !== void 0 && configValue !== "") {
      const value = Number(configValue);
      if (Number.isFinite(value) && value >= 0) budgets[key] = value;
    }
  }
  return budgets;
}
function readSnapshotConfig(repoRoot) {
  const values = /* @__PURE__ */ new Map();
  try {
    const out = execFileSync4("git", ["-C", repoRoot, "config", "--get-regexp", "^git-span\\.snapshot[-.]"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8"
    });
    for (const line of out.split("\n")) {
      const sep2 = line.indexOf(" ");
      if (sep2 <= 0) continue;
      const key = line.slice(0, sep2);
      values.set(key.replace(/^git-span\.snapshot\./, "git-span.snapshot-"), line.slice(sep2 + 1).trim());
    }
  } catch (err) {
  }
  return values;
}
var AMBIENT_GIT_LOCATION_VARS = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_WORK_TREE"
];
var defaultGitRunner = (args, opts) => {
  const ambient = { ...process.env };
  for (const key of AMBIENT_GIT_LOCATION_VARS) delete ambient[key];
  return execFileSync4("git", args, {
    cwd: opts.cwd,
    env: opts.env === void 0 ? ambient : { ...ambient, ...opts.env },
    // execFileSync rejects non-integer timeouts, and a fractional
    // postSideWallSeconds budget (0.5 is a valid budget value) produces
    // fractional remaining-milliseconds — ceil, never crash the capture.
    timeout: opts.timeoutMs === void 0 ? void 0 : Math.ceil(opts.timeoutMs),
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"]
  });
};
var statFile = (absPath) => {
  try {
    const st = statSync4(absPath);
    return { size: st.size, mtimeNs: BigInt(Math.trunc(st.mtimeMs)) * 1000000n };
  } catch {
    return null;
  }
};
function resolveGitPaths(repoRoot, runGit = defaultGitRunner) {
  try {
    const out = runGit(["rev-parse", "--path-format=absolute", "--git-path", "objects", "--git-path", "index"], {
      cwd: repoRoot
    }).toString("utf8").split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    if (out.length < 2) return null;
    return { objectsDir: out[0], indexFile: out[1] };
  } catch {
    return null;
  }
}
var SNAPSHOT_RECORDLESS_NOTE = `<git-span-error>
${indentBlockBody(
  "git-span: snapshot record unavailable \u2014 this command's file writes were not snapshot-attributed; the static spans below are the only attribution"
)}
</git-span-error>`;
function readSiblingRecord(layout, sessionId, toolUseId, cache) {
  const key = `${sessionId}	${toolUseId}`;
  const cached = cache.get(key);
  if (cached !== void 0) return cached;
  let record = null;
  try {
    const raw = JSON.parse(readFileSync3(layout.recordFile(sessionId, toolUseId), "utf8"));
    if (raw !== null && typeof raw === "object") {
      record = raw.version === 2 ? raw : "incompatible";
    }
  } catch {
    record = null;
  }
  cache.set(key, record);
  return record;
}
function appendRecordGap(layout, sessionId, toolUseId, gaps, logger2) {
  try {
    const file = layout.recordFile(sessionId, toolUseId);
    const raw = JSON.parse(readFileSync3(file, "utf8"));
    if (raw === null || typeof raw !== "object" || raw.version !== 2) return;
    const rec = raw;
    let changed = false;
    for (const gap of gaps) {
      if (rec.gaps.includes(gap)) continue;
      rec.gaps.push(gap);
      changed = true;
    }
    if (changed) writeJsonAtomic(file, rec);
  } catch (err) {
    logger2.warn(`git-span record-gap append failed open: ${String(err)}`);
  }
}
function siblingsForPath(layout, mine, index, path, recordCache, hashCache, runGit, hashTimeoutMs, logger2) {
  const treeHash = (record, treeSha) => {
    if (treeSha === null) return { kind: "absent" };
    const key = `${treeSha}	${path}`;
    const cached = hashCache.get(key);
    if (cached !== void 0) return cached;
    const result = hashTreePath({
      treeSha,
      path,
      repoRoot: record.repoRoot,
      objectDir: layout.objectDir(record.sessionId, record.toolUseId),
      runGit,
      timeoutMs: hashTimeoutMs
    });
    hashCache.set(key, result);
    return result;
  };
  const out = [];
  for (const entry of index) {
    if (entry.sessionId === mine.sessionId && entry.toolUseId === mine.toolUseId) continue;
    const record = readSiblingRecord(layout, entry.sessionId, entry.toolUseId, recordCache);
    if (record === null) continue;
    if (record === "incompatible") {
      out.push({
        sessionId: entry.sessionId,
        toolUseId: entry.toolUseId,
        createdAt: 0,
        consumed: false,
        consumedAt: null,
        coverageGap: true,
        pre: null,
        post: null
      });
      continue;
    }
    const preHash = treeHash(record, record.treeSha);
    const postHash = treeHash(record, record.post?.treeSha ?? null);
    const hashError = preHash.kind === "error" || postHash.kind === "error";
    if (hashError) {
      const reason = preHash.kind === "error" ? preHash.reason : postHash.kind === "error" ? postHash.reason : "";
      logger2.warn(`git-span sibling hash read failed for ${record.toolUseId} at ${path} \u2014 failing closed: ${reason}`);
    }
    out.push({
      sessionId: record.sessionId,
      toolUseId: record.toolUseId,
      createdAt: record.createdAt,
      consumed: record.consumed,
      consumedAt: record.consumedAt,
      // Kind-based, never ANY-gap: a precision-loss diagnostic (binary-scope)
      // does not make the sibling's coverage unknowable — only the
      // path-coverage family does (which includes the stat-only degrade),
      // plus the unreadable-evidence case above.
      coverageGap: recordHasPathCoverageGap(record) || hashError,
      pre: preHash.kind === "hash" ? { hash: preHash.hash } : null,
      post: postHash.kind === "hash" ? { hash: postHash.hash } : null
    });
  }
  return out;
}
function unfinishedEntryCovering(repoRoot, path, now, budgets) {
  const earliest = now - budgets.unfinishedEntryTtlMs;
  let dir;
  try {
    dir = join5(queueRoot(repoRoot), "activity-log");
  } catch {
    return null;
  }
  let names;
  try {
    names = readdirSync3(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const file = join5(dir, name);
    let mtimeMs;
    try {
      mtimeMs = statSync4(file).mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs < earliest || mtimeMs > now + 1) continue;
    let entry;
    try {
      entry = JSON.parse(readFileSync3(file, "utf8"));
    } catch {
      continue;
    }
    if (entry.finishedAt !== null) continue;
    if (typeof entry.startedAt !== "number" || entry.startedAt >= now) continue;
    if (entry.paths.some((p) => p.path === path)) return entry.toolUseId;
  }
  return null;
}
async function snapshotBashBranch(store, sessionId, toolUseId, cwd, executors, memo, logger2, budgets, runGit = defaultGitRunner) {
  const layout = store.layout;
  const found = store.find(sessionId, toolUseId);
  if (found === "tombstoned") return { kind: "tombstoned", additionalContext: null, excludedPaths: /* @__PURE__ */ new Set() };
  if (found === null) return { kind: "no-record", additionalContext: null, excludedPaths: /* @__PURE__ */ new Set() };
  const repoRoot = found.repoRoot;
  const now = Date.now();
  const excludedPaths = /* @__PURE__ */ new Set();
  const scopes = [];
  const notes = [];
  const interleavedDrops = [];
  const siblingCache = /* @__PURE__ */ new Map();
  const siblingHashCache = /* @__PURE__ */ new Map();
  const siblingIndex = store.listRepoRecords(repoRoot);
  let post = { treeSha: null };
  let compared;
  try {
    const spanRoot = resolveSpanRoot(repoRoot);
    const wallBudgetMs = budgets.postSideWallSeconds * 1e3;
    const postWallStart = Date.now();
    if (found.treeSha === null) {
      const sweep = statOnlySweep({ repoRoot, spanRoot, timeoutMs: wallBudgetMs, runGit, stat: statFile });
      post = { treeSha: null, statOnly: sweep };
      compared = compareStatOnly(found.statOnly ?? {}, sweep);
    } else {
      const gitPaths = resolveGitPaths(repoRoot, runGit);
      if (gitPaths === null) throw new Error("git paths unresolvable at post time");
      const captured = captureWriteTree({
        repoRoot,
        objectDir: layout.objectDir(sessionId, toolUseId),
        indexFile: layout.tempIndexFile(sessionId, toolUseId),
        alternates: gitPaths.objectsDir,
        realIndexFile: gitPaths.indexFile,
        spanRoot,
        wallBudgetMs,
        wallStart: postWallStart,
        runGit,
        stat: statFile
      });
      if (captured.treeSha === null) {
        post = { treeSha: null, ...captured.statOnly !== void 0 ? { statOnly: captured.statOnly } : {} };
        compared = { attributions: /* @__PURE__ */ new Map(), unchanged: /* @__PURE__ */ new Set(), gaps: captured.gaps, contentHashes: /* @__PURE__ */ new Map() };
      } else {
        post = { treeSha: captured.treeSha };
        compared = compareTrees({
          preTreeSha: found.treeSha,
          postTreeSha: captured.treeSha,
          repoRoot,
          objectDir: layout.objectDir(sessionId, toolUseId),
          spanRoot,
          budgets,
          wallStart: postWallStart,
          runGit
        });
      }
    }
    for (const gap of compared.gaps) logger2.info?.(`git-span snapshot compare: ${gap}`);
    for (const path of compared.unchanged) excludedPaths.add(path);
    if (compared.gaps.length > 0) appendRecordGap(layout, sessionId, toolUseId, compared.gaps, logger2);
    const consumed = store.consume(sessionId, toolUseId, post);
    if (consumed === null) return { kind: "done", additionalContext: null, excludedPaths };
  } catch (err) {
    const failureGap = `snapshot compare aborted: ${String(err)}`;
    logger2.warn(`git-span ${failureGap}`);
    appendRecordGap(layout, sessionId, toolUseId, [failureGap], logger2);
    store.consume(sessionId, toolUseId, post);
    return {
      kind: "done",
      additionalContext: `<git-span-error>
${indentBlockBody(
        `git-span: snapshot comparison aborted before attribution completed (${String(err)}); the record was consumed with a gap`
      )}
</git-span-error>`,
      excludedPaths
    };
  }
  for (const [path, attribution] of compared.attributions) {
    const baseline = {
      createdAt: found.createdAt,
      preHash: compared.contentHashes.get(path)?.pre ?? null
    };
    const verdict = applyAmbiguityRules(
      baseline,
      siblingsForPath(
        layout,
        found,
        siblingIndex,
        path,
        siblingCache,
        siblingHashCache,
        runGit,
        budgets.postSideWallSeconds * 1e3,
        logger2
      ),
      path
    );
    if (verdict.ambiguous) {
      logger2.warn(`git-span ambiguity: ${path} dropped (${verdict.reason}); session ${verdict.siblingSessionId}`);
      excludedPaths.add(path);
      continue;
    }
    const inFlight = unfinishedEntryCovering(repoRoot, path, now, budgets);
    if (inFlight !== null) {
      logger2.info?.(`git-span interleaved-tool: ${path} dropped (unfinished entry ${inFlight} in flight)`);
      excludedPaths.add(path);
      interleavedDrops.push(path);
      continue;
    }
    const consulted = activityEntriesCovering(repoRoot, path, now, now, budgets);
    const myPreHash = compared.contentHashes.get(path)?.pre ?? null;
    const currentHash = compared.contentHashes.get(path)?.post ?? null;
    if (consulted.some((e) => e.finishedAt !== null && e.finishedAt <= found.createdAt)) {
    } else if (
      // Both boundary equalities must be over REAL content hashes: a
      // created/deleted path (or a stat-only degrade) has a null side, and
      // null === null is not evidence that the edit's touch covered my
      // change — it is the absence of evidence on both sides. Without the
      // non-null guard a deletion interleaved with an edit's deletion of the
      // same path skipped silently on null-postHash equality.
      myPreHash !== null && currentHash !== null && consulted.some(
        (e) => e.paths.some((p) => p.path === path && p.preHash === myPreHash && p.postHash === currentHash)
      )
    ) {
      logger2.info?.(`git-span covered-by-edit: ${path} skipped (equal baselines)`);
      excludedPaths.add(path);
      continue;
    } else if (consulted.length > 0) {
      logger2.info?.(`git-span absorbed-double: ${path} attributed (interleaved edit absorbed)`);
    }
    if (attribution.kind === "rename") {
      scopes.push({ filePath: join5(repoRoot, attribution.from), observed: { changed: [], wholeFile: true } });
      excludedPaths.add(attribution.from);
      excludedPaths.add(path);
    } else {
      const observed = attribution.kind === "changed" ? attribution.observed : { changed: [], wholeFile: true };
      scopes.push({ filePath: join5(repoRoot, path), observed });
      excludedPaths.add(path);
    }
  }
  if (interleavedDrops.length > 0) {
    notes.push(
      `attribution deferred: ${interleavedDrops.join(", ")} \u2014 an interleaved edit is still in flight; not attributed. Re-run the command once the overlapping edit completes to attribute the write.`
    );
  }
  if (compared.gaps.some((g) => g.includes("post-side wall budget exhausted"))) {
    notes.push(
      scopes.length === 0 ? `<git-span-error>
${indentBlockBody("git-span: the post-side wall budget was exhausted before any file could be attributed \u2014 no git-span block was produced")}
</git-span-error>` : `<git-span-error>
${indentBlockBody(`git-span: the post-side wall budget was exhausted partway \u2014 ${scopes.length} path(s) attributed, the rest dropped`)}
</git-span-error>`
    );
  }
  if (compared.gaps.some((g) => g.startsWith("write-tree degraded to stat-only:"))) {
    notes.push(
      `<git-span-error>
${indentBlockBody("git-span: the post-side snapshot degraded to stat-only under a pre-side tree \u2014 no comparable evidence, nothing attributed")}
</git-span-error>`
    );
  }
  let additionalContext = null;
  if (scopes.length > 0) {
    const baseInput = {
      kind: "write",
      sessionId,
      cwd,
      filePath: scopes[0].filePath,
      written: ""
    };
    const output = await runTouchHook(baseInput, executors, memo, void 0, scopes);
    additionalContext = output.additionalContext;
  }
  if (notes.length > 0) {
    const noteText = notes.join("\n");
    additionalContext = additionalContext === null ? noteText : `${additionalContext}
${noteText}`;
  }
  return { kind: "done", additionalContext, excludedPaths };
}

// src/common/span-surface.ts
import { execFileSync as execFileSync5 } from "node:child_process";
import * as fs5 from "node:fs";
import * as nodePath3 from "node:path";

// src/common/span-ignore.ts
import * as fs4 from "node:fs";
import * as nodePath2 from "node:path";
var HOOK_IGNORE_REL = nodePath2.join(".span", ".hookignore");

// src/common/span-surface.ts
function createDiskMemoStore(logger2, layout) {
  return {
    getSurfaced(sessionId) {
      pruneStaleSessions(layout);
      try {
        const raw = fs5.readFileSync(layout.memoFile(sessionId), "utf8");
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
      pruneStaleSessions(layout);
      const existing = this.getSurfaced(sessionId);
      for (const n of names) existing.add(n);
      const memoDir = layout.dir(sessionId);
      const memoPath = layout.memoFile(sessionId);
      const tmpPath = `${memoPath}.tmp`;
      try {
        fs5.mkdirSync(memoDir, { recursive: true, mode: 448 });
        fs5.writeFileSync(tmpPath, JSON.stringify({ surfaced: [...existing] }), "utf8");
        fs5.renameSync(tmpPath, memoPath);
      } catch (err) {
        logger2.warn("memo write failed", { err });
      }
    }
  };
}

// src/claude/post-tool-use-failure.ts
function narrowCommand(toolInput) {
  if (toolInput !== null && typeof toolInput === "object" && "command" in toolInput) {
    const command = toolInput.command;
    if (typeof command === "string" && command.length > 0) return command;
  }
  return null;
}
function createHandler(executors = createDefaultTouchExecutors(), memoFactory = createDiskMemoStore, layout = DEFAULT_SESSION_LAYOUT, storeFactory = (logger2, repoRoot) => createSnapshotStore(logger2, resolveSnapshotBudgets(repoRoot), layout)) {
  return async (input, ctx) => {
    try {
      const command = narrowCommand(input.tool_input);
      if (command === null) return null;
      const repoRoot = resolveRepoRoot(input.cwd ?? "");
      const outcome = await snapshotBashBranch(
        storeFactory(ctx.logger, repoRoot),
        input.session_id,
        input.tool_use_id,
        input.cwd ?? "",
        executors,
        memoFactory(ctx.logger, layout),
        ctx.logger,
        resolveSnapshotBudgets(repoRoot)
      );
      if (outcome.kind === "no-record") {
        ctx.logger.warn("git-span: failed Bash call has no snapshot record; discarding", {
          toolUseId: input.tool_use_id
        });
        return null;
      }
      if (outcome.kind === "tombstoned") {
        return null;
      }
      if (outcome.additionalContext === null) return null;
      return postToolUseFailureOutput({
        hookSpecificOutput: { additionalContext: outcome.additionalContext }
      });
    } catch (err) {
      ctx.logger.warn("git-span post-tool-use-failure failed open on an uncaught error", { err });
      return null;
    }
  };
}
var post_tool_use_failure_default = postToolUseFailureHook({ matcher: "Bash", timeout: 1e4 }, createHandler());

// src/claude/post-tool-use-failure-entry.ts
execute(post_tool_use_failure_default);

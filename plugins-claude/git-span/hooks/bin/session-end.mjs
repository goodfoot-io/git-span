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
function sessionEndHook(config, handler) {
  return createHookFunction("SessionEnd", config, handler);
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

// src/common/snapshot-store.ts
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

// src/claude/session-end.ts
var createHandler = (layout = DEFAULT_SESSION_LAYOUT) => async (input, ctx) => {
  try {
    createSnapshotStore(ctx.logger, void 0, layout).removeSession(input.session_id);
    return null;
  } catch (err) {
    ctx.logger.warn("git-span session-end cleanup failed open on an uncaught error", { err });
    return null;
  }
};
var session_end_default = sessionEndHook({ timeout: 1e4 }, createHandler());

// src/claude/session-end-entry.ts
execute(session_end_default);

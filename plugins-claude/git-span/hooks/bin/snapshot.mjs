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
function indentBlockBody(text) {
  return text.split("\n").map((line) => line.length > 0 ? `  ${line}` : line).join("\n");
}

// src/common/snapshot-core.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync as mkdirSync3, writeFileSync } from "node:fs";
import { isAbsolute as isAbsolute2, join as join2, relative, resolve as resolve2, sep } from "node:path";

// src/common/shell-split.ts
var COMMAND_OPENER_WORDS = /* @__PURE__ */ new Set(["do", "then", "else", "elif", "if", "while", "until", "!", "time", "{", "("]);
var WORD_END = /[\s;&|()<>]/;
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function splitTopLevel(cmd) {
  const parts = [];
  let buf = "";
  let i = 0;
  const n = cmd.length;
  let depth = 0;
  let braceDepth = 0;
  let inSquote = false;
  let inDquote = false;
  let pendingOp = "start";
  let malformed;
  let listStart = 0;
  const reject = (v) => {
    malformed = v;
    parts.length = listStart;
    i = n;
  };
  const isUnconsumedOperator = () => (pendingOp === "pipe" || pendingOp === "and" || pendingOp === "or") && buf.trim() === "";
  const lastWord = () => buf.trimEnd().match(/\S+$/)?.[0] ?? "";
  const DANGLING_REDIRECT_WORD = /^(?:>|>>|&>|&>>|>\||<|<>|<<|<<-|<<<|>&|\d+(?:>|>>|>\||<|<>|<<|<<-|<<<|>&|<&))$/;
  const lastWordIsDanglingRedirect = () => DANGLING_REDIRECT_WORD.test(lastWord());
  const isWordStart = () => buf === "" || /\s$/.test(buf);
  const startsRedirectAt = (i2) => {
    const c = cmd[i2];
    if (c === ">" || c === "<") return true;
    if (c === "&") return cmd[i2 + 1] === ">";
    if (c >= "0" && c <= "9") {
      let j = i2;
      while (j < n && cmd[j] >= "0" && cmd[j] <= "9") j += 1;
      return cmd[j] === ">" || cmd[j] === "<";
    }
    return false;
  };
  const isCommandPosition = () => buf.trim() === "" || /\n$/.test(buf) || /[;&|()]$/.test(buf.trimEnd()) || COMMAND_OPENER_WORDS.has(lastWord());
  const flush = (nextOp) => {
    const s = buf.trim();
    if (s) {
      if (pendingOp === "pipe" && (s === "!" || /^!\s/.test(s))) {
        reject("pipe-bang");
        return;
      }
      parts.push({ text: s, precededBy: pendingOp, ...bufHeredoc ? { heredoc: true } : {} });
    }
    buf = "";
    bufHeredoc = false;
    pendingOp = nextOp;
  };
  const levels = [[]];
  const top = () => {
    const lv = levels[levels.length - 1];
    return lv.length > 0 ? lv[lv.length - 1] : void 0;
  };
  let afterKeyword = false;
  let functionSeen = false;
  let nameSeen = false;
  let caseRegion = null;
  const heredocs = [];
  let inBody = false;
  let bufHeredoc = false;
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
    if (braceDepth > 0) {
      if (c === "}") braceDepth -= 1;
      buf += c;
      i += 1;
      continue;
    }
    if (inBody) {
      const lineEnd = cmd.indexOf("\n", i);
      const line = lineEnd === -1 ? cmd.slice(i) : cmd.slice(i, lineEnd);
      if (heredocs[0].close.test(line)) {
        heredocs.shift();
        if (heredocs.length === 0) inBody = false;
      }
      if (levels[levels.length - 1].length > 0 || caseRegion !== null) {
        buf += line;
        if (lineEnd !== -1) buf += "\n";
      }
      i = lineEnd === -1 ? n : lineEnd + 1;
      continue;
    }
    if (c === "\n" && heredocs.length > 0) {
      if (levels[levels.length - 1].length > 0 || caseRegion !== null) {
        buf += c;
        inBody = true;
        i += 1;
        continue;
      }
      if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
        reject("dangling-operator");
        break;
      }
      flush("newline");
      inBody = true;
      i += 1;
      continue;
    }
    if (c === "#" && depth === 0 && isWordStart()) {
      while (i < n && cmd[i] !== "\n") i += 1;
      continue;
    }
    if (caseRegion) {
      const r = caseRegion;
      if (r.localDepth === 0) {
        const s2 = cmd.slice(i, i + 2);
        const s3 = cmd.slice(i, i + 3);
        if (s3 === ";;&" || s2 === ";;" || s2 === ";&") {
          r.pos = "pattern-start";
          buf += s3 === ";;&" ? s3 : s2;
          i += s3 === ";;&" ? 3 : 2;
          continue;
        }
        if (c === ";") {
          r.pos = "command";
          r.cmdEmpty = true;
          buf += c;
          i += 1;
          continue;
        }
        const last = buf[buf.length - 1];
        if (c === "&" && cmd[i + 1] !== ">" && cmd[i + 1] !== "&" && last !== ">" && last !== "<") {
          r.pos = "command";
          r.cmdEmpty = true;
          buf += c;
          i += 1;
          continue;
        }
        if (c === "\n") {
          if (r.pos === "pattern") {
            reject("unclosed-case");
            break;
          }
          if (r.pos === "command") r.cmdEmpty = true;
          buf += c;
          i += 1;
          continue;
        }
        if (c === "#" && isWordStart()) {
          while (i < n && cmd[i] !== "\n") i += 1;
          continue;
        }
        if (isWordStart() && !WORD_END.test(c)) {
          let j = i;
          while (j < n && !WORD_END.test(cmd[j])) j += 1;
          const w = cmd.slice(i, j);
          if (w === "esac" && (r.pos === "pattern-start" || r.pos === "command" && r.cmdEmpty)) {
            caseRegion = null;
            afterKeyword = false;
          } else if (w === "in" && r.pos === "subject") {
            r.pos = "pattern-start";
          } else if (r.pos === "pattern-start") {
            r.pos = "pattern";
          } else if (r.pos === "command") {
            r.cmdEmpty = false;
          }
          buf += w;
          i = j;
          continue;
        }
      }
    }
    if (c === "(") {
      if (caseRegion) {
        caseRegion.localDepth += 1;
      } else {
        const t = top();
        if (t?.kind === "brace") t.body = true;
        depth += 1;
        levels.push([]);
      }
      afterKeyword = false;
      buf += c;
      i += 1;
      continue;
    }
    if (c === ")") {
      if (caseRegion) {
        if (caseRegion.localDepth === 0) {
          caseRegion.pos = "command";
          caseRegion.cmdEmpty = true;
        } else {
          caseRegion.localDepth -= 1;
        }
      } else {
        if (depth === 0) {
          reject("unbalanced-paren");
          break;
        }
        if (levels[levels.length - 1].length > 0) {
          reject("unclosed-construct");
          break;
        }
        depth -= 1;
        levels.pop();
      }
      buf += c;
      i += 1;
      continue;
    }
    if (!caseRegion && !WORD_END.test(c) && (isWordStart() || /[()]$/.test(buf)) && !(c === "$" && cmd[i + 1] === "{")) {
      let j = i;
      while (j < n && !WORD_END.test(cmd[j])) j += 1;
      const w = cmd.slice(i, j);
      const isFnShape = () => /^[A-Za-z_][A-Za-z0-9_]*\(\)$/.test(lastWord()) || lastWord() === "()";
      if (w === "in" && top() !== void 0 && ["for", "select"].includes(top().kind)) {
      } else if (w === "{" && (isCommandPosition() || isFnShape() || functionSeen && nameSeen)) {
        if (functionSeen && nameSeen) {
          functionSeen = false;
          nameSeen = false;
        }
        if (top()?.kind === "brace") top().body = true;
        levels[levels.length - 1].push({ kind: "brace", body: false });
        afterKeyword = true;
      } else if (w === "}" && isCommandPosition()) {
        const t = top();
        if (afterKeyword || t === void 0 || t.kind !== "brace" || !t.body) {
          reject("unclosed-construct");
          break;
        }
        levels[levels.length - 1].pop();
        afterKeyword = false;
      } else if (isCommandPosition()) {
        if (w === "case") {
          caseRegion = { pos: "subject", cmdEmpty: false, localDepth: 0 };
          afterKeyword = false;
        } else if (w === "function") {
          functionSeen = true;
          nameSeen = false;
          afterKeyword = false;
        } else if (w === "if") {
          if (top()?.kind === "brace") top().body = true;
          levels[levels.length - 1].push({ kind: "if", body: false });
          afterKeyword = true;
        } else if (w === "while" || w === "until") {
          if (top()?.kind === "brace") top().body = true;
          levels[levels.length - 1].push({ kind: "loop", body: false });
          afterKeyword = true;
        } else if (w === "for") {
          if (top()?.kind === "brace") top().body = true;
          levels[levels.length - 1].push({ kind: "for", body: false });
          afterKeyword = true;
        } else if (w === "select") {
          if (top()?.kind === "brace") top().body = true;
          levels[levels.length - 1].push({ kind: "select", body: false });
          afterKeyword = true;
        } else if (w === "do") {
          const t = top();
          if (t === void 0 || !["for", "loop", "select"].includes(t.kind)) {
            reject("unclosed-construct");
            break;
          }
          t.body = true;
          afterKeyword = true;
        } else if (w === "then") {
          const t = top();
          if (t === void 0 || t.kind !== "if") {
            reject("unclosed-construct");
            break;
          }
          t.body = true;
          afterKeyword = true;
        } else if (w === "else" || w === "elif") {
          const t = top();
          if (t === void 0 || t.kind !== "if" || !t.body) {
            reject("unclosed-construct");
            break;
          }
          afterKeyword = true;
        } else if (w === "in") {
          const t = top();
          if (t === void 0 || !["for", "select"].includes(t.kind)) {
            reject("unclosed-construct");
            break;
          }
        } else if (w === "fi") {
          const t = top();
          if (t === void 0 || t.kind !== "if" || !t.body) {
            reject("unclosed-construct");
            break;
          }
          levels[levels.length - 1].pop();
          afterKeyword = false;
        } else if (w === "done") {
          const t = top();
          if (t === void 0 || !["for", "loop", "select"].includes(t.kind) || !t.body) {
            reject("unclosed-construct");
            break;
          }
          levels[levels.length - 1].pop();
          afterKeyword = false;
        } else if (w === "esac") {
          reject("unclosed-construct");
          break;
        } else {
          afterKeyword = false;
          if (top()?.kind === "brace") top().body = true;
          if (functionSeen) {
            if (nameSeen) {
              functionSeen = false;
              nameSeen = false;
            } else {
              nameSeen = true;
            }
          }
        }
      } else {
        afterKeyword = false;
        if (functionSeen) {
          if (nameSeen) {
            functionSeen = false;
            nameSeen = false;
          } else {
            nameSeen = true;
          }
        }
      }
      buf += w;
      i = j;
      continue;
    }
    if (caseRegion === null && levels[levels.length - 1].length > 0 && (c === ";" || c === "&") && afterKeyword) {
      reject("unclosed-construct");
      break;
    }
    if (depth === 0) {
      if (isWordStart() && lastWordIsDanglingRedirect() && startsRedirectAt(i)) {
        reject("dangling-operator");
        break;
      }
      if (c === "$" && cmd[i + 1] === "{") {
        braceDepth += 1;
        buf += c;
        i += 1;
        continue;
      }
      if (c === "<" && cmd[i + 1] === "<" && cmd[i + 2] === "<" && cmd[i + 3] !== "<" && cmd[i - 1] !== "<") {
        buf += "<<<";
        i += 3;
        continue;
      }
      if (c === "<" && cmd[i + 1] === "<" && cmd[i + 2] !== "<") {
        let j = i + 2;
        let allowTabs = false;
        if (cmd[j] === "-") {
          allowTabs = true;
          j += 1;
        }
        while (cmd[j] === " " || cmd[j] === "	") j += 1;
        let delim = "";
        if (cmd[j] === "'" || cmd[j] === '"') {
          const q = cmd.indexOf(cmd[j], j + 1);
          if (q === -1) {
            delim = cmd.slice(j + 1);
            j = n;
          } else {
            delim = cmd.slice(j + 1, q);
            j = q + 1;
          }
        } else {
          const wordStart = j;
          while (j < n && !WORD_END.test(cmd[j])) j += 1;
          delim = cmd.slice(wordStart, j);
        }
        if (delim !== "") {
          heredocs.push({
            close: new RegExp(`^${allowTabs ? "	*" : ""}${escapeRegExp(delim)}[ \\t]*$`)
          });
          bufHeredoc = true;
          if (levels[levels.length - 1].length > 0 || caseRegion !== null) {
            buf += cmd.slice(i, j);
          }
          i = j;
          continue;
        }
      }
      if (caseRegion === null && levels[levels.length - 1].length === 0) {
        if (cmd.slice(i, i + 2) === "&&") {
          if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
            reject("dangling-operator");
            break;
          }
          flush("and");
          i += 2;
          continue;
        }
        if (cmd.slice(i, i + 2) === "||") {
          if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
            reject("dangling-operator");
            break;
          }
          flush("or");
          i += 2;
          continue;
        }
        if (cmd.slice(i, i + 2) === "|&") {
          if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
            reject("dangling-operator");
            break;
          }
          flush("pipe");
          i += 2;
          continue;
        }
        if (c === ";") {
          if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
            reject("dangling-operator");
            break;
          }
          flush("semicolon");
          i += 1;
          continue;
        }
        if (c === "|") {
          if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
            reject("dangling-operator");
            break;
          }
          flush("pipe");
          i += 1;
          continue;
        }
        if (c === "\n") {
          if (isUnconsumedOperator()) {
            i += 1;
            continue;
          }
          if (lastWordIsDanglingRedirect()) {
            reject("dangling-operator");
            break;
          }
          flush("newline");
          listStart = parts.length;
          i += 1;
          continue;
        }
        if (c === "&") {
          const next = cmd[i + 1];
          const last = buf[buf.length - 1];
          const trimmed = buf.trimEnd();
          let dupRedirect = false;
          if (trimmed.endsWith(">")) {
            const before = trimmed.length >= 2 ? trimmed[trimmed.length - 2] : "";
            dupRedirect = trimmed.length === 1 || /\s|\d/.test(before);
          }
          if (next === ">" || dupRedirect || last === "<") {
            buf += c;
            i += 1;
            continue;
          }
          if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
            reject("dangling-operator");
            break;
          }
          flush("background");
          i += 1;
          continue;
        }
      }
    }
    buf += c;
    i += 1;
  }
  if (malformed) return { stages: parts, malformed };
  if (inSquote || inDquote) {
    reject("unclosed-quote");
  } else if (braceDepth > 0) {
    reject("unclosed-brace");
  } else if (caseRegion !== null) {
    reject("unclosed-case");
  } else if (depth > 0) {
    reject("unbalanced-paren");
  } else if (levels[levels.length - 1].length > 0) {
    reject("unclosed-construct");
  } else if (isUnconsumedOperator() || lastWordIsDanglingRedirect()) {
    reject("dangling-operator");
  } else if (inBody || heredocs.length > 0) {
    flush("newline");
    malformed = "unterminated-heredoc";
  } else {
    flush("newline");
  }
  return { stages: parts, malformed };
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

// src/common/snapshot-core.ts
var DEFAULT_SNAPSHOT_BUDGETS = {
  preSideMaxWallSeconds: 1,
  maxStorageBytes: 64 * 1024 * 1024,
  maxTouchedFiles: 100,
  postSideWallSeconds: 5,
  recordTtlMs: 24 * 60 * 60 * 1e3,
  unfinishedEntryTtlMs: 15 * 60 * 1e3
};
var READ_ONLY_TOOLS = /* @__PURE__ */ new Set(["ls", "grep", "rg", "cat", "head", "tail", "echo", "cd"]);
var GIT_WRITE_SUBCOMMANDS = /* @__PURE__ */ new Set([
  "config",
  "branch",
  "tag",
  "remote",
  "stash",
  "checkout",
  "switch",
  "reset",
  "restore",
  "clean",
  "rebase",
  "merge",
  "pull",
  "commit",
  "add"
]);
var GIT_READ_SUBCOMMANDS = /* @__PURE__ */ new Set(["status", "diff", "log", "show", "help"]);
var EXEC_WRAPPERS = /* @__PURE__ */ new Set(["env", "time", "xargs", "sudo", "nohup", "nice", "command", "exec"]);
var OUTPUT_FLAG = /^(?:-o|--output|--output-file)(?:=|$)/;
var EXEC_CONFIG_KEY = /^diff\.(?:external|.*\.(?:textconv|command))$/;
var GIT_REDIRECT_ASSIGNMENT = /(?:^|\s)(?:GIT_DIR|GIT_WORK_TREE|GIT_OBJECT_DIRECTORY|GIT_INDEX_FILE|GIT_CONFIG_GLOBAL|GIT_CONFIG_SYSTEM|GIT_CONFIG_COUNT|GIT_CONFIG_KEY_[0-9]+|GIT_CONFIG_VALUE_[0-9]+|XDG_CONFIG_HOME|HOME)=/;
var EXEC_CONFIG_PATTERN = "^(diff\\.external|diff\\..*\\.(textconv|command))$";
var HEREDOC_OPEN = /\bcat[ \t]+(>{1,2})[ \t]*(\S+)[ \t]*<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|([A-Za-z_][A-Za-z0-9_]*))[ \t]*\r?\n/g;
function escapeRegExp2(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function extractHeredocs(raw) {
  const writes = [];
  let masked = "";
  let cursor = 0;
  HEREDOC_OPEN.lastIndex = 0;
  let openMatch = HEREDOC_OPEN.exec(raw);
  while (openMatch !== null) {
    const [, redirect, target, dash, dq1, dq2, bare] = openMatch;
    const delim = dq1 ?? dq2 ?? bare;
    const bodyStart = openMatch.index + openMatch[0].length;
    if (delim === void 0 || bodyStart < cursor) {
      HEREDOC_OPEN.lastIndex = openMatch.index + 1;
      openMatch = HEREDOC_OPEN.exec(raw);
      continue;
    }
    const closeRe = new RegExp(`^${dash === void 0 ? "" : "\\t*"}${escapeRegExp2(delim)}[ \\t]*$`, "m");
    const closeMatch = closeRe.exec(raw.slice(bodyStart));
    if (closeMatch === null) {
      HEREDOC_OPEN.lastIndex = bodyStart;
      openMatch = HEREDOC_OPEN.exec(raw);
      continue;
    }
    const matchEnd = bodyStart + closeMatch.index + closeMatch[0].length;
    masked += raw.slice(cursor, openMatch.index);
    masked += `__heredoc_${writes.length}__`;
    cursor = matchEnd;
    writes.push({ redirect, target, inert: dq1 !== void 0 });
    HEREDOC_OPEN.lastIndex = matchEnd;
    openMatch = HEREDOC_OPEN.exec(raw);
  }
  masked += raw.slice(cursor);
  return { writes, masked };
}
function hasUnquotedExpansion(text) {
  let inSquote = false;
  let inDquote = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inSquote) {
      if (c === "'") inSquote = false;
      continue;
    }
    if (c === "'") {
      inSquote = true;
      continue;
    }
    if (inDquote) {
      if (c === "\\") {
        i += 1;
        continue;
      }
      if (c === '"') {
        inDquote = false;
        continue;
      }
      if (c === "$" || c === "`") return true;
      continue;
    }
    if (c === '"') {
      inDquote = true;
      continue;
    }
    if (c === "\\") {
      i += 1;
      continue;
    }
    if (c === "$" || c === "`") return true;
  }
  return false;
}
function hasBackground(raw) {
  let inSquote = false;
  let inDquote = false;
  let depth = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (inSquote) {
      if (c === "'") inSquote = false;
      continue;
    }
    if (c === "'") {
      inSquote = true;
      continue;
    }
    if (inDquote) {
      if (c === "\\") {
        i += 1;
        continue;
      }
      if (c === '"') inDquote = false;
      continue;
    }
    if (c === "\\") {
      i += 1;
      continue;
    }
    if (c === "(") {
      depth += 1;
      continue;
    }
    if (c === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && c === "&") {
      const prev = i > 0 ? raw[i - 1] : "";
      const next = i + 1 < raw.length ? raw[i + 1] : "";
      if (prev === "&" || prev === "|" || prev === ">" || prev === "<") continue;
      if (next === "&" || next === ">") continue;
      return true;
    }
  }
  return false;
}
function findRedirects(argv, currentDir) {
  const targets = [];
  let present = false;
  for (let i = 0; i < argv.length; i += 1) {
    const w = argv[i];
    const m = /^(?:[12]?>>?|&>>?)(.*)$/.exec(w);
    if (m === null) continue;
    let target = m[1];
    if (target.startsWith("&")) continue;
    present = true;
    if (target === "") target = argv[i + 1] ?? "";
    if (target !== "" && !target.startsWith("~") && !/[$`*?]/.test(target)) {
      targets.push(resolve2(currentDir, target));
    }
  }
  return { present, targets };
}
function classifyGitExec(argv, assignments, cwd) {
  if (argv[0] !== "git") return null;
  let subIdx = -1;
  let subcommand = null;
  let cTarget = null;
  let repoRedirected = false;
  let i = 1;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "-C") {
      cTarget = resolve2(cTarget ?? cwd, argv[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (a === "-c") {
      i += 2;
      continue;
    }
    if (a === "--git-dir" || a === "--work-tree") {
      repoRedirected = true;
      i += 2;
      continue;
    }
    if (a.startsWith("--git-dir=") || a.startsWith("--work-tree=")) {
      repoRedirected = true;
      i += 1;
      continue;
    }
    if (a.startsWith("-")) {
      i += 1;
      continue;
    }
    subIdx = i;
    subcommand = a;
    break;
  }
  if (subcommand === null) return "opaque";
  if (GIT_WRITE_SUBCOMMANDS.has(subcommand)) return "opaque";
  if (subcommand === "help") {
    return argv.some((a) => a === "-w" || a === "--web") ? "opaque" : "read-only";
  }
  if (!GIT_READ_SUBCOMMANDS.has(subcommand)) return "opaque";
  if (repoRedirected) return "opaque";
  if (cTarget !== null) {
    const cwdRoot = repoTopLevel(cwd);
    const targetRoot = repoTopLevel(cTarget);
    if (cwdRoot === null || targetRoot === null || cwdRoot !== targetRoot) return "opaque";
  }
  const rendersDiff = subcommand === "diff" || subcommand === "log" || subcommand === "show";
  if (/(?:^|\s)(?:GIT_PAGER|PAGER)=/.test(assignments)) return "opaque";
  if (rendersDiff && /(?:^|\s)GIT_EXTERNAL_DIFF=/.test(assignments)) return "opaque";
  if (rendersDiff && GIT_REDIRECT_ASSIGNMENT.test(assignments)) return "opaque";
  if (rendersDiff) {
    for (let j = 0; j < argv.length; j += 1) {
      const a = argv[j];
      const key = a === "-c" ? argv[j + 1] ?? "" : a.startsWith("-c") && a.length > 2 ? a.slice(2) : null;
      if (key !== null && EXEC_CONFIG_KEY.test(key.split("=")[0] ?? "")) return "opaque";
    }
  }
  if (subcommand === "status") return "read-only";
  const postSubArgs = argv.slice(subIdx + 1);
  const noExtDiff = postSubArgs.includes("--no-ext-diff");
  const noTextconv = postSubArgs.includes("--no-textconv");
  if (!noExtDiff && process.env.GIT_EXTERNAL_DIFF !== void 0) return "opaque";
  if (!noExtDiff || !noTextconv) {
    const { external, driver } = readExecConfig(cwd);
    if (external && !noExtDiff) return "opaque";
    if (driver && !noTextconv) return "opaque";
  }
  return "read-only";
}
function repoTopLevel(dir) {
  try {
    const out = execFileSync2("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const trimmed = out.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}
function readExecConfig(cwd) {
  try {
    const out = execFileSync2("git", ["config", "--get-regexp", EXEC_CONFIG_PATTERN], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    let external = false;
    let driver = false;
    for (const line of out.split("\n")) {
      const key = line.split(/\s/)[0] ?? "";
      if (key === "diff.external") external = true;
      else if (/^diff\..*\.(textconv|command)$/.test(key)) driver = true;
    }
    return { external, driver };
  } catch {
    return { external: false, driver: false };
  }
}
function isSymlinkOrUnknowable(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch (err) {
    return err.code !== "ENOENT";
  }
}
function fastPathTargetsOk(absTarget, cwd) {
  if (isSymlinkOrUnknowable(absTarget)) return false;
  const rel = relative(cwd, absTarget);
  if (rel === "" || isAbsolute2(rel) || rel.startsWith("..")) return true;
  const parts = rel.split("/");
  let cur = cwd;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (part === "" || part === ".") continue;
    cur = join2(cur, part);
    if (isSymlinkOrUnknowable(cur)) return false;
  }
  return true;
}
function classifySimple(text, argv, currentDir, background) {
  const opaque = (tier1 = []) => ({
    writeCapable: true,
    opaque: true,
    covered: false,
    coveredTargets: [],
    tier1
  });
  const readOnly = {
    writeCapable: false,
    opaque: false,
    covered: false,
    coveredTargets: [],
    tier1: []
  };
  if (background) return opaque();
  if (argv.some((w) => w.startsWith("~") || /[*?]/.test(w))) return opaque();
  const rawTokens = (tokenize(text) ?? []).map((t) => t.text);
  if (hasUnquotedExpansion(text)) return opaque(findRedirects(rawTokens, currentDir).targets);
  if (EXEC_WRAPPERS.has(argv[0])) return opaque();
  if (argv.some((w) => OUTPUT_FLAG.test(w))) return opaque();
  const redirects = findRedirects(rawTokens, currentDir);
  if (redirects.present) return opaque(redirects.targets);
  if (argv[0] === "git") {
    const assignments = (text.match(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/) ?? [""])[0] ?? "";
    const verdict = classifyGitExec(argv, assignments, currentDir);
    return verdict === "read-only" ? readOnly : opaque();
  }
  if (READ_ONLY_TOOLS.has(argv[0])) return readOnly;
  return opaque();
}
function classifyCommandForSnapshot(command, cwd) {
  const background = hasBackground(command);
  const { writes, masked } = extractHeredocs(command);
  const simpleCommands = splitTopLevel(masked).stages;
  let currentDir = cwd;
  let hasOpaque = false;
  let hasCovered = false;
  let anyWrite = false;
  const tier1 = [];
  const coveredTargets = [];
  const pushTier1 = (t) => {
    if (!tier1.includes(t)) tier1.push(t);
  };
  for (const simple of simpleCommands) {
    const heredocRef = simple.text.match(/^__heredoc_(\d+)__$/);
    if (heredocRef !== null) {
      const h = writes[Number.parseInt(heredocRef[1], 10)];
      const absTarget = resolve2(currentDir, h.target);
      const literal = !h.target.startsWith("~") && !/[$`*?]/.test(h.target);
      if (literal) pushTier1(absTarget);
      anyWrite = true;
      if (background || !h.inert || !literal) hasOpaque = true;
      else {
        hasCovered = true;
        coveredTargets.push(absTarget);
      }
      continue;
    }
    const argv = argvOf(simple.text);
    if (argv === null) {
      hasOpaque = true;
      anyWrite = true;
      continue;
    }
    if (argv[0] === "cd" && argv.length >= 2 && argv[1] !== "-" && !/[$`]/.test(argv[1])) {
      currentDir = resolve2(currentDir, argv[1]);
    }
    const cls = classifySimple(simple.text, argv, currentDir, background);
    if (cls.writeCapable) anyWrite = true;
    if (cls.opaque) hasOpaque = true;
    if (cls.covered) {
      hasCovered = true;
      coveredTargets.push(...cls.coveredTargets);
    }
    for (const t of cls.tier1) pushTier1(t);
  }
  if (background) return { decision: { kind: "snapshot", reason: "opaque" }, tier1Targets: tier1 };
  if (!anyWrite) return { decision: { kind: "no-snapshot", reason: "read-only" }, tier1Targets: [] };
  if (hasOpaque) {
    return {
      decision: { kind: "snapshot", reason: hasCovered ? "mixed" : "opaque" },
      tier1Targets: tier1
    };
  }
  if (coveredTargets.every((t) => fastPathTargetsOk(t, cwd))) {
    return { decision: { kind: "no-snapshot", reason: "statically-covered" }, tier1Targets: [] };
  }
  return { decision: { kind: "snapshot", reason: "opaque" }, tier1Targets: tier1 };
}
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

// src/common/snapshot-harness.ts
import { execFileSync as execFileSync4 } from "node:child_process";
import { mkdirSync as mkdirSync5, readdirSync as readdirSync3, readFileSync as readFileSync3, rmSync as rmSync3, statSync as statSync4, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join5 } from "node:path";

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

// src/common/touch-core.ts
import { execFileSync as execFileSync3 } from "node:child_process";
import * as fs3 from "node:fs";
import { basename as basename3, join as join4 } from "node:path";

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
function capturePreSnapshot(opts) {
  const runGit = opts.runGit ?? defaultGitRunner;
  const layout = opts.store.layout;
  const objectDir = layout.objectDir(opts.sessionId, opts.toolUseId);
  const indexFile2 = layout.tempIndexFile(opts.sessionId, opts.toolUseId);
  const removeArtifacts = () => {
    rmSync3(objectDir, { recursive: true, force: true });
    rmSync3(indexFile2, { force: true });
  };
  const gitPaths = resolveGitPaths(opts.repoRoot, runGit);
  if (gitPaths === null) return null;
  const captured = captureWriteTree({
    repoRoot: opts.repoRoot,
    objectDir,
    indexFile: indexFile2,
    alternates: gitPaths.objectsDir,
    realIndexFile: gitPaths.indexFile,
    spanRoot: resolveSpanRoot(opts.repoRoot),
    wallBudgetMs: opts.budgets.preSideMaxWallSeconds * 1e3,
    runGit,
    stat: opts.stat ?? statFile
  });
  if (captured.treeSha === null && captured.statOnly === void 0) {
    for (const gap of captured.gaps) opts.logger.warn(`git-span snapshot pre-capture failed open: ${gap}`);
    removeArtifacts();
    return null;
  }
  const record = {
    version: 2,
    sessionId: opts.sessionId,
    toolUseId: opts.toolUseId,
    ...opts.agentId !== void 0 ? { agentId: opts.agentId } : {},
    repoRoot: opts.repoRoot,
    createdAt: Date.now(),
    consumed: false,
    consumedAt: null,
    treeSha: captured.treeSha,
    ...captured.statOnly !== void 0 ? { statOnly: captured.statOnly } : {},
    gaps: captured.gaps
  };
  const wrote = opts.store.write(record);
  if (!wrote) removeArtifacts();
  return { wrote, treeSha: captured.treeSha, gaps: captured.gaps.length };
}
var SNAPSHOT_RECORDLESS_NOTE = `<git-span-error>
${indentBlockBody(
  "git-span: snapshot record unavailable \u2014 this command's file writes were not snapshot-attributed; the static spans below are the only attribution"
)}
</git-span-error>`;

// src/claude/snapshot.ts
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
      const plan = classifyCommandForSnapshot(command, input.cwd ?? "");
      if (plan.decision.kind !== "snapshot") {
        return null;
      }
      const repoRoot = resolveRepoRoot(input.cwd ?? "");
      if (repoRoot === null) return null;
      const budgets = resolveSnapshotBudgets(repoRoot);
      const result = capturePreSnapshot({
        store: createSnapshotStore(ctx.logger, budgets, layout),
        sessionId: input.session_id,
        toolUseId: input.tool_use_id,
        repoRoot,
        budgets,
        logger: ctx.logger
      });
      if (result === null) return null;
      ctx.logger.info("git-span snapshot pre-capture", {
        toolUseId: input.tool_use_id,
        decision: plan.decision.reason,
        treeSha: result.treeSha,
        gaps: result.gaps,
        refused: !result.wrote
      });
      return null;
    } catch (err) {
      ctx.logger.warn("git-span snapshot pre-hook failed open on an uncaught error", { err });
      return null;
    }
  };
}
var snapshot_default = preToolUseHook({ matcher: "Bash", timeout: 1e4 }, createHandler());

// src/claude/snapshot-entry.ts
execute(snapshot_default);

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

// src/common/parse-command.ts
import { isAbsolute as isAbsolute2, resolve as resolvePath } from "node:path";

// src/common/command-resolve.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import { readFileSync, statSync as statSync2 } from "node:fs";
function countFileLines(absolutePath) {
  try {
    if (!statSync2(absolutePath).isFile()) return null;
    const content = readFileSync(absolutePath, "utf8");
    if (content.length === 0) return 0;
    const withoutTrailingNewline = content.endsWith("\n") ? content.slice(0, -1) : content;
    return withoutTrailingNewline.split("\n").length;
  } catch {
    return null;
  }
}
function countGitBlobLines(cwd, rev, path) {
  try {
    const out = execFileSync2("git", ["show", `${rev}:${path}`], {
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
      parts.push({ text: s, precededBy: pendingOp });
    }
    buf = "";
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
          if (next !== ">" && last !== ">" && last !== "<") {
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
function splitWords(s) {
  const words = [];
  let cur = "";
  let has = false;
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (/\s/.test(c)) {
      if (has) {
        words.push(cur);
        cur = "";
        has = false;
      }
      i += 1;
      continue;
    }
    if (c === "'") {
      has = true;
      i += 1;
      const end = s.indexOf("'", i);
      if (end === -1) return null;
      cur += s.slice(i, end);
      i = end + 1;
      continue;
    }
    if (c === '"') {
      has = true;
      i += 1;
      while (i < n && s[i] !== '"') {
        if (s[i] === "\\" && i + 1 < n && '"\\$`'.includes(s[i + 1])) {
          cur += s[i + 1];
          i += 2;
        } else {
          cur += s[i];
          i += 1;
        }
      }
      if (i >= n) return null;
      i += 1;
      continue;
    }
    if (c === "\\" && i + 1 < n) {
      has = true;
      cur += s[i + 1];
      i += 2;
      continue;
    }
    has = true;
    cur += c;
    i += 1;
  }
  if (has) words.push(cur);
  return words;
}
function argvOf(simpleCmd) {
  return splitWords(stripLeadingAssignments(simpleCmd).trim());
}
var REDIRECT_TWO_TOKEN = /^(?:>>?|<>|<|&>>?|[0-9]+(?:>>?|<>|<))$/;
var REDIRECT_DUP = /^(?:[0-9]+)?[<>]&(?:[0-9]+|-)$/;
var REDIRECT_FUSED = /^(?:>>?|<>|<|&>>?|[0-9]+(?:>>?|<>|<))[^<>&|]/;
var HEREDOC_TWO_TOKEN = /^(?:<<-?|<<<)$/;
var HEREDOC_FUSED = /^(?:<<-?|<<<)[^<>&|]/;
var REDIRECT_TOKEN = (w) => REDIRECT_TWO_TOKEN.test(w) || REDIRECT_DUP.test(w) || REDIRECT_FUSED.test(w) || HEREDOC_TWO_TOKEN.test(w) || HEREDOC_FUSED.test(w);
function stripRedirects(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (REDIRECT_TWO_TOKEN.test(a) || HEREDOC_TWO_TOKEN.test(a)) {
      const next = argv[i + 1];
      if (next !== void 0 && !REDIRECT_TOKEN(next)) {
        i += 1;
      } else {
        out.push(a);
      }
      continue;
    }
    if (REDIRECT_DUP.test(a) || REDIRECT_FUSED.test(a) || HEREDOC_FUSED.test(a)) continue;
    out.push(a);
  }
  return out;
}
var WRAPPER_BUILTINS = /* @__PURE__ */ new Set([
  "exit",
  "exec",
  "true",
  "false",
  ":",
  "cd",
  "set",
  "unset",
  "export",
  "readonly",
  "return",
  "break",
  "continue"
]);
var RECOGNIZED_EXTERNAL_NAMES = /* @__PURE__ */ new Set([
  "sed",
  "head",
  "tail",
  "cat",
  "nl",
  "git",
  "true",
  "false",
  "timeout",
  "env",
  "command"
]);
var TIMEOUT_DURATION = /^\d+(?:\.\d+)?[smhd]?$/;
var ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=.*$/;
function stripWrappersOnce(argv) {
  let i = 0;
  while (i < argv.length && argv[i] === "!") i++;
  if (i >= argv.length) return argv.slice(i);
  const head = argv[i];
  if (head === "command") {
    const next = argv[i + 1];
    if (next === "-v" || next === "-V") return null;
    if (next === "-p") return argv.slice(i + 2);
    if (next !== void 0 && !next.startsWith("-")) return argv.slice(i + 1);
    return null;
  }
  if (head === "builtin") {
    const next = argv[i + 1];
    if (next !== void 0 && WRAPPER_BUILTINS.has(next)) return argv.slice(i + 2);
    return null;
  }
  if (head === "env") {
    let j = i + 1;
    while (j < argv.length && ENV_ASSIGNMENT.test(argv[j])) j++;
    if (j === i + 1) return null;
    return argv.slice(j);
  }
  if (head === "timeout") {
    let j = i + 1;
    while (j < argv.length && argv[j].startsWith("--")) j++;
    if (j >= argv.length || !TIMEOUT_DURATION.test(argv[j])) return null;
    return argv.slice(j + 1);
  }
  if (head.startsWith("/")) {
    const base = head.slice(head.lastIndexOf("/") + 1);
    if (RECOGNIZED_EXTERNAL_NAMES.has(base)) return [base, ...argv.slice(i + 1)];
    return null;
  }
  if (head.includes("/")) return null;
  return argv.slice(i);
}
function stripWrappers(argv) {
  let current = argv;
  for (let iter = 0; iter < argv.length + 2; iter++) {
    const next = stripWrappersOnce(current);
    if (next === null) return argv;
    if (next.length === current.length && next.every((w, k) => w === current[k])) return current;
    current = next;
  }
  return argv;
}

// src/common/variable-expand.ts
var DEFAULT_PATH_ALLOWLIST = [
  "HOME",
  "PWD",
  "WORKSPACE_PATH",
  "CARD_REPO_PATH",
  "REPO_ROOT",
  "BASE_BRANCH"
];
var BARE_NAME = /^[A-Za-z_][A-Za-z0-9_]*/;
var BRACED_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
function expandVariables(text, variables, env) {
  const resolve2 = (name) => {
    const fromTable = variables.get(name);
    if (fromTable !== void 0) return fromTable;
    const fromEnv = env[name];
    return fromEnv !== void 0 ? fromEnv : void 0;
  };
  let out = "";
  let i = 0;
  const n = text.length;
  let inSingle = false;
  let inDouble = false;
  while (i < n) {
    const c = text[i];
    if (inSingle) {
      if (c === "'") inSingle = false;
      out += c;
      i++;
      continue;
    }
    if (inDouble) {
      if (c === '"') {
        inDouble = false;
        out += c;
        i++;
        continue;
      }
      if (c === "\\" && i + 1 < n && '"\\$`'.includes(text[i + 1])) {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (c === "\\") {
        out += c;
        i++;
        continue;
      }
      if (c === "$") {
        const ref = expandRef(text, i, resolve2);
        out += ref.text;
        i = ref.next;
        continue;
      }
      out += c;
      i++;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      out += c;
      i++;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      out += c;
      i++;
      continue;
    }
    if (c === "\\") {
      out += c;
      if (i + 1 < n) {
        out += text[i + 1];
        i += 2;
      } else {
        i++;
      }
      continue;
    }
    if (c === "$") {
      const ref = expandRef(text, i, resolve2);
      out += ref.text;
      i = ref.next;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
function expandRef(text, start, resolve2) {
  const rest = text.slice(start + 1);
  if (rest.startsWith("(")) return { text: "$", next: start + 1 };
  if (rest.startsWith("{")) {
    const close = text.indexOf("}", start + 2);
    if (close === -1) return { text: "$", next: start + 1 };
    const inner = text.slice(start + 2, close);
    if (BRACED_NAME.test(inner)) {
      const value2 = resolve2(inner);
      if (value2 !== void 0) return { text: value2, next: close + 1 };
    }
    return { text: "$", next: start + 1 };
  }
  const name = BARE_NAME.exec(rest);
  if (name === null) return { text: "$", next: start + 1 };
  const value = resolve2(name[0]);
  if (value !== void 0) return { text: value, next: start + 1 + name[0].length };
  return { text: "$", next: start + 1 };
}

// src/common/parse-command.ts
var ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
var SET_OPTION_NAMES = /* @__PURE__ */ new Set([
  "allexport",
  "braceexpand",
  "emacs",
  "errexit",
  "errtrace",
  "functrace",
  "hashall",
  "histexpand",
  "history",
  "ignoreeof",
  "interactive-comments",
  "keyword",
  "lexical-word-processing",
  "monitor",
  "noclobber",
  "noexec",
  "noglob",
  "nolog",
  "notify",
  "nounset",
  "onecmd",
  "physical",
  "pipefail",
  "posix",
  "privileged",
  "verbose",
  "vi",
  "xtrace"
]);
var SET_FLAG_LETTERS = "aBbCeEfhHikmnopPtTuvx";
var RECOGNIZED_BUILTINS = /* @__PURE__ */ new Set([
  "true",
  ":",
  "false",
  "set",
  "exit",
  "exec",
  "return",
  "break",
  "continue",
  "cd",
  "export",
  "command",
  "builtin"
]);
function walkStrip(argv) {
  let i = 0;
  while (i < argv.length && argv[i] === "!") i++;
  while (i < argv.length && argv[i] === "command") i++;
  while (i < argv.length && argv[i] === "builtin" && argv[i + 1] !== void 0 && RECOGNIZED_BUILTINS.has(argv[i + 1]))
    i++;
  return argv.slice(i);
}
function stripForEmission(argv) {
  let i = 0;
  while (i < argv.length && argv[i] === "!") i++;
  while (i < argv.length && (argv[i] === "command" || argv[i] === "exec")) i++;
  while (i < argv.length && argv[i] === "builtin" && argv[i + 1] !== void 0 && RECOGNIZED_BUILTINS.has(argv[i + 1]))
    i++;
  return argv.slice(i);
}
function setFlagsKnown(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") continue;
    if (a.startsWith("-") || a.startsWith("+")) {
      const chars = a.slice(1);
      if (chars.length === 0) return false;
      for (let k = 0; k < chars.length; k++) {
        const c = chars[k];
        if (c === "o") {
          const name = args[i + 1];
          if (name === void 0 || !SET_OPTION_NAMES.has(name)) return false;
          i++;
        } else if (!SET_FLAG_LETTERS.includes(c)) {
          return false;
        }
      }
    }
  }
  return true;
}
var CONSTRUCT_OPENERS = /* @__PURE__ */ new Set(["if", "while", "until", "for", "case", "select"]);
var CONSTRUCT_CLOSERS = /* @__PURE__ */ new Set(["fi", "done", "esac"]);
function scanTokens(text) {
  const toks = [];
  let i = 0;
  const n = text.length;
  let parenDepth = 0;
  let braceDepth = 0;
  let constructDepth = 0;
  while (i < n) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "(" || c === "{") {
      if (c === "(") parenDepth++;
      else braceDepth++;
      i++;
      continue;
    }
    if (c === ")" || c === "}") {
      if (c === ")") parenDepth = Math.max(0, parenDepth - 1);
      else braceDepth = Math.max(0, braceDepth - 1);
      i++;
      continue;
    }
    if (";&|<>".includes(c)) {
      i++;
      continue;
    }
    const start = i;
    const w = readWordAt(text, i);
    if (w === null) {
      i++;
      continue;
    }
    i = w.end;
    toks.push({ word: w.word, start, end: w.end, depth: parenDepth, braceDepth, constructDepth, quoted: w.quoted });
    if (parenDepth === 0 && braceDepth === 0 && !w.quoted) {
      if (CONSTRUCT_OPENERS.has(w.word)) constructDepth++;
      else if (CONSTRUCT_CLOSERS.has(w.word)) constructDepth = Math.max(0, constructDepth - 1);
    }
  }
  return toks;
}
function readWordAt(text, i) {
  if (i >= text.length) return null;
  let word = "";
  let quoted = false;
  const n = text.length;
  while (i < n && !/\s/.test(text[i]) && !"(){};&|<>".includes(text[i])) {
    const ch = text[i];
    if (ch === "'") {
      quoted = true;
      i++;
      while (i < n && text[i] !== "'") {
        word += text[i];
        i++;
      }
      if (i < n) i++;
    } else if (ch === '"') {
      quoted = true;
      i++;
      while (i < n && text[i] !== '"') {
        if (text[i] === "\\" && i + 1 < n && '"\\$`'.includes(text[i + 1])) {
          word += text[i + 1];
          i += 2;
        } else {
          word += text[i];
          i++;
        }
      }
      if (i < n) i++;
    } else if (ch === "\\" && i + 1 < n) {
      word += text[i + 1];
      i += 2;
    } else {
      word += ch;
      i++;
    }
  }
  return { word, end: i, quoted };
}
function extractGroupBody(text, open, close) {
  const start = text.indexOf(open);
  if (start === -1) return null;
  let depth = 0;
  let inQuote = null;
  for (let p = start; p < text.length; p++) {
    const ch = text[p];
    if (inQuote !== null) {
      if (ch === "\\" && inQuote === '"' && p + 1 < text.length && '"\\$`'.includes(text[p + 1])) p++;
      else if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch;
      continue;
    }
    if (ch === "\\") {
      p++;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start + 1, p);
    }
  }
  return null;
}
function classifyStage(text) {
  const t = text.trimStart();
  if (t.startsWith("{")) return "brace";
  if (t.startsWith("(")) return "subshell";
  const kw = t.match(/^(if|while|until|for|case|select)\b/);
  if (kw !== null) return kw[1];
  if (/^(?:function\s+)?[A-Za-z_][A-Za-z0-9_]*\(\)\s*\{/.test(t)) return "def";
  return "plain";
}
function parseDef(text) {
  const m = text.match(/^(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\))?\s*\{/);
  if (m === null) return null;
  const body = extractGroupBody(text, "{", "}");
  if (body === null) return null;
  return { name: m[1], body };
}
function parseIf(text) {
  const toks = scanTokens(text);
  if (toks.length === 0 || toks[0].word !== "if") return null;
  const thenIdx = toks.findIndex((t) => t.word === "then" && t.constructDepth === 1);
  if (thenIdx === -1) return null;
  const thenTok = toks[thenIdx];
  const condition = text.slice(toks[0].end, thenTok.start);
  const boundaries = [];
  for (let idx = thenIdx + 1; idx < toks.length; idx++) {
    const t = toks[idx];
    if (t.constructDepth !== 1 || t.word !== "elif" && t.word !== "else" && t.word !== "fi") continue;
    if (t.word === "elif") {
      const eThenIdx = toks.findIndex((tt, ii) => ii > idx && tt.word === "then" && tt.constructDepth === 1);
      if (eThenIdx === -1) return null;
      boundaries.push({ word: "elif", tok: t }, { word: "then", tok: toks[eThenIdx] });
      idx = eThenIdx;
      continue;
    }
    boundaries.push({ word: t.word, tok: t });
    if (t.word === "else") {
      const fiIdx = toks.findIndex((tt, ii) => ii > idx && tt.word === "fi" && tt.constructDepth === 1);
      if (fiIdx === -1) return null;
      boundaries.push({ word: "fi", tok: toks[fiIdx] });
      break;
    }
    break;
  }
  if (boundaries.length === 0) return null;
  const thenBody = text.slice(thenTok.end, boundaries[0].tok.start);
  const elifs = [];
  let elseBody = null;
  for (let b = 0; b < boundaries.length; b++) {
    const { word, tok } = boundaries[b];
    if (word === "elif") {
      const eThen = boundaries[b + 1];
      if (eThen === void 0 || eThen.word !== "then") return null;
      const nextStart = boundaries[b + 2]?.tok.start ?? text.length;
      elifs.push({ condition: text.slice(tok.end, eThen.tok.start), body: text.slice(eThen.tok.end, nextStart) });
      b++;
    } else if (word === "else") {
      const fi = boundaries[b + 1];
      if (fi === void 0 || fi.word !== "fi") return null;
      elseBody = text.slice(tok.end, fi.tok.start);
      break;
    }
  }
  return { condition, thenBody, elifs, elseBody };
}
function parseLoop(text, keyword) {
  const toks = scanTokens(text);
  if (toks.length === 0 || toks[0].word !== keyword) return null;
  const doTok = toks.find((t) => t.word === "do" && t.constructDepth === 1);
  if (doTok === void 0) return null;
  const doneTok = toks.find((t) => t.start > doTok.end && t.word === "done" && t.constructDepth === 1);
  if (doneTok === void 0) return null;
  return { condition: text.slice(toks[0].end, doTok.start), body: text.slice(doTok.end, doneTok.start) };
}
function parseFor(text) {
  const toks = scanTokens(text);
  if (toks.length === 0 || toks[0].word !== "for") return null;
  const nameTok = toks[1];
  if (nameTok === void 0) return null;
  const doTok = toks.find((t) => t.word === "do" && t.constructDepth === 1 && t.start > nameTok.end);
  if (doTok === void 0) return null;
  const doneTok = toks.find((t) => t.start > doTok.end && t.word === "done" && t.constructDepth === 1);
  if (doneTok === void 0) return null;
  const inTok = toks.find(
    (t) => t.start > nameTok.end && t.start < doTok.start && t.word === "in" && t.constructDepth === 1
  );
  let list = null;
  if (inTok !== void 0) {
    list = toks.filter((t) => t.start > inTok.end && t.start < doTok.start).map((t) => t.word);
  }
  return { list, body: text.slice(doTok.end, doneTok.start), wholeInterior: text.slice(nameTok.end, doneTok.start) };
}
function parseCase(text) {
  let i = 0;
  const n = text.length;
  const skipWs = () => {
    while (i < n && /\s/.test(text[i])) i++;
  };
  skipWs();
  const lead = readWordAt(text, i);
  if (lead === null || lead.word !== "case") return null;
  i = lead.end;
  let parenDepth = 0;
  const subjectWords = [];
  while (i < n) {
    skipWs();
    if (i >= n) return null;
    const c = text[i];
    if (c === "(") {
      parenDepth++;
      i++;
      continue;
    }
    if (c === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      i++;
      continue;
    }
    if (";&|<>".includes(c)) {
      i++;
      continue;
    }
    const w = readWordAt(text, i);
    if (w === null) {
      i++;
      continue;
    }
    i = w.end;
    if (parenDepth === 0 && !w.quoted && w.word === "in") break;
    subjectWords.push(w.word);
  }
  if (i >= n) return null;
  const branches = [];
  let fallthrough = false;
  while (true) {
    skipWs();
    if (i >= n) return null;
    const w = readWordAt(text, i);
    if (w !== null && !w.quoted && w.word === "esac") {
      return { subject: subjectWords.join(" "), branches, fallthrough };
    }
    let patEnd = -1;
    {
      let p = i;
      let depth = 0;
      let inQuote = null;
      while (p < n) {
        const ch = text[p];
        if (inQuote !== null) {
          if (ch === "\\" && inQuote === '"' && p + 1 < n && '"\\$`'.includes(text[p + 1])) {
            p += 2;
            continue;
          }
          if (ch === inQuote) inQuote = null;
          p++;
          continue;
        }
        if (ch === "'" || ch === '"') {
          inQuote = ch;
          p++;
          continue;
        }
        if (ch === "\\") {
          p += 2;
          continue;
        }
        if (ch === "(") {
          depth++;
          p++;
          continue;
        }
        if (ch === ")") {
          if (depth === 0) {
            patEnd = p;
            break;
          }
          depth--;
          p++;
          continue;
        }
        p++;
      }
    }
    if (patEnd === -1) return null;
    const pattern = text.slice(i, patEnd).trim();
    i = patEnd + 1;
    let bodyEnd = -1;
    let term = "";
    {
      let p = i;
      let depth = 0;
      let bdepth = 0;
      let inQuote = null;
      while (p < n) {
        const ch = text[p];
        if (inQuote !== null) {
          if (ch === "\\" && inQuote === '"' && p + 1 < n && '"\\$`'.includes(text[p + 1])) {
            p += 2;
            continue;
          }
          if (ch === inQuote) inQuote = null;
          p++;
          continue;
        }
        if (ch === "'" || ch === '"') {
          inQuote = ch;
          p++;
          continue;
        }
        if (ch === "\\") {
          p += 2;
          continue;
        }
        if (ch === "(") {
          depth++;
          p++;
          continue;
        }
        if (ch === ")") {
          depth = Math.max(0, depth - 1);
          p++;
          continue;
        }
        if (ch === "{") {
          bdepth++;
          p++;
          continue;
        }
        if (ch === "}") {
          bdepth = Math.max(0, bdepth - 1);
          p++;
          continue;
        }
        if (depth === 0 && bdepth === 0 && ch === ";") {
          const next = text[p + 1];
          if (next === ";" || next === "&") {
            term = next === ";" ? text[p + 2] === "&" ? ";;&" : ";;" : ";&";
            bodyEnd = p;
            break;
          }
        }
        p++;
      }
    }
    if (term === "") return null;
    branches.push({ pattern, body: text.slice(i, bodyEnd).trim() });
    i = bodyEnd + term.length;
    if (term === ";&" || term === ";;&") fallthrough = true;
  }
}
function resolveSubject(subject, assignments) {
  const m = subject.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/) ?? subject.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
  if (m !== null) {
    const v = assignments.get(m[1]);
    return v !== void 0 ? v : null;
  }
  if (/[$`]/.test(subject)) return null;
  return subject;
}
function splitPatternAlternatives(pattern) {
  const parts = [];
  let cur = "";
  let inQuote = null;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (inQuote !== null) {
      if (ch === "\\" && inQuote === '"' && i + 1 < pattern.length && '"\\$`'.includes(pattern[i + 1])) {
        cur += ch;
        cur += pattern[i + 1];
        i++;
        continue;
      }
      if (ch === inQuote) {
        inQuote = null;
        cur += ch;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch;
      cur += ch;
      continue;
    }
    if (ch === "\\" && i + 1 < pattern.length) {
      cur += ch;
      cur += pattern[i + 1];
      i++;
      continue;
    }
    if (ch === "|") {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}
function analyzePattern(pattern) {
  let literal = "";
  let glob = false;
  let inQuote = null;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (inQuote !== null) {
      if (ch === "\\" && inQuote === '"' && i + 1 < pattern.length && '"\\$`'.includes(pattern[i + 1])) {
        literal += pattern[i + 1];
        i++;
        continue;
      }
      if (ch === inQuote) {
        inQuote = null;
        continue;
      }
      literal += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch;
      continue;
    }
    if (ch === "\\" && i + 1 < pattern.length) {
      literal += pattern[i + 1];
      i++;
      continue;
    }
    if ("*?[".includes(ch)) {
      glob = true;
      literal += ch;
      continue;
    }
    literal += ch;
  }
  return { literal, glob };
}
function evalPattern(pattern, subject) {
  const alts = splitPatternAlternatives(pattern);
  let matched = false;
  for (const alt of alts) {
    const { literal, glob } = analyzePattern(alt);
    if (glob) {
      if (!matched) return "glob";
    } else if (literal === subject) {
      matched = true;
    } else if (matched) {
      return "undecidable";
    }
  }
  return matched ? "match" : "no-match";
}
var ExecutionWalker = class {
  chain = "success";
  errexit = false;
  pipefail = false;
  assignments = /* @__PURE__ */ new Map();
  defs = /* @__PURE__ */ new Map();
  dead = null;
  returned = false;
  fnDepth = 0;
  loopStack = [];
  expanded = [];
  verdicts = [];
  dirFrame = 0;
  defProbeStack = /* @__PURE__ */ new Set();
  walkInput(stages) {
    this.walkList(stages, { liveness: true, discard: false, sideEffects: true, inputFacing: true });
    return this.expanded;
  }
  stopped() {
    if (this.dead !== null || this.returned) return true;
    const top = this.loopStack[this.loopStack.length - 1];
    return top !== void 0 && (top.bodyTerminated || top.ambiguousStop);
  }
  /** Walk one list (a fresh `&&`/`||` chain); returns the list's final chain status. */
  walkList(stages, opts) {
    const savedChain = this.chain;
    this.chain = "success";
    let i = 0;
    while (i < stages.length && !this.stopped()) {
      const end = this.groupEnd(stages, i);
      const next = end < stages.length ? stages[end] : null;
      this.processGroup(stages.slice(i, end), next, opts);
      i = end;
    }
    const result = this.chain;
    while (i < stages.length) {
      if (opts.inputFacing) this.verdicts.push("no");
      i++;
    }
    this.chain = savedChain;
    return result;
  }
  groupEnd(stages, start) {
    let end = start;
    while (end + 1 < stages.length && stages[end + 1].precededBy === "pipe") end++;
    return end + 1;
  }
  processGroup(group, next, opts) {
    const first = group[0];
    let executes;
    switch (first.precededBy) {
      case "and":
        executes = this.chain === "success" ? true : this.chain === "failure" ? false : "unknown";
        break;
      case "or":
        executes = this.chain === "failure" ? true : this.chain === "success" ? false : "unknown";
        break;
      default:
        executes = true;
    }
    const exec = executes === true ? "yes" : executes === false ? "no" : "unknown";
    const backgrounded = first.precededBy === "background" || next !== null && next.precededBy === "background";
    if (opts.inputFacing) {
      for (let i = 0; i < group.length; i++) this.verdicts.push(exec);
    }
    const firstArgv = argvOf(first.text);
    let bangCount = 0;
    let memberArgv = firstArgv;
    if (firstArgv !== null) {
      while (memberArgv[bangCount] === "!") bangCount++;
      memberArgv = memberArgv.slice(bangCount);
    }
    const inverted = bangCount % 2 === 1;
    if (exec === "no") return;
    const statuses = [];
    const inPipeline = group.length > 1;
    for (let m = 0; m < group.length; m++) {
      statuses.push(
        this.processMember(group[m], {
          exec,
          inPipeline,
          backgrounded,
          memberArgv: m === 0 ? memberArgv : null,
          opts
        })
      );
    }
    let groupStatus;
    if (this.pipefail && group.length > 1) {
      if (statuses.every((s) => s === "success")) groupStatus = "success";
      else if (statuses.some((s) => s === "failure")) groupStatus = "failure";
      else groupStatus = "unknown";
    } else {
      groupStatus = statuses[statuses.length - 1];
    }
    if (inverted) {
      groupStatus = groupStatus === "success" ? "failure" : groupStatus === "failure" ? "success" : "unknown";
    }
    if (opts.liveness && this.errexit && groupStatus !== "success") {
      const chainFinal = next === null || next.precededBy !== "and" && next.precededBy !== "or";
      if (chainFinal && !inverted && !backgrounded) this.dead = "errexit";
    }
    if (exec === "yes") this.chain = groupStatus;
    else this.chain = "unknown";
  }
  processMember(member, ctx) {
    const kind = classifyStage(member.text);
    if (kind === "plain") return this.processPlainMember(member, ctx);
    return this.processConstruct(member, kind, ctx);
  }
  processPlainMember(member, ctx) {
    const { exec, inPipeline, backgrounded, memberArgv, opts } = ctx;
    const argv = memberArgv ?? argvOf(member.text);
    const stripped = argv === null ? null : walkStrip(argv);
    if (exec === "yes" && !inPipeline && opts.sideEffects) {
      this.applySideEffects(member, argv, stripped);
    }
    const status = this.knownStatus(argv);
    if (!inPipeline && exec !== "no" && stripped !== null && (stripped[0] === "exit" || stripped[0] === "exec")) {
      this.dead = "exit";
    }
    if (!inPipeline && exec === "yes" && this.fnDepth > 0 && stripped !== null && stripped[0] === "return") {
      this.returned = true;
      const top = this.loopStack[this.loopStack.length - 1];
      if (top !== void 0) top.outcome = "return";
    }
    if (!inPipeline && exec !== "no" && stripped !== null && (stripped[0] === "break" || stripped[0] === "continue")) {
      this.applyBreakContinue(stripped, exec);
    }
    if (exec !== "no" && stripped !== null && stripped.length > 0) {
      this.applyCall(stripped[0], inPipeline, backgrounded);
    }
    if (!opts.discard) {
      this.expanded.push({
        text: member.text,
        precededBy: member.precededBy,
        exec,
        inPipeline,
        dirFrame: this.dirFrame,
        assignments: new Map(this.assignments)
      });
    }
    return status;
  }
  applyBreakContinue(stripped, exec) {
    const depth = Number.parseInt(stripped[1] ?? "1", 10);
    if (Number.isNaN(depth) || depth < 1) return;
    if (this.loopStack.length === 0 || depth > this.loopStack.length) return;
    if (exec === "unknown") {
      for (let d = 0; d < depth; d++) {
        const frame = this.loopStack[this.loopStack.length - 1 - d];
        if (frame.outcome === "none") {
          frame.outcome = "ambiguous";
          frame.ambiguousStop = true;
        }
      }
      return;
    }
    const isContinue = stripped[0] === "continue";
    for (let d = 0; d < depth; d++) {
      const frame = this.loopStack[this.loopStack.length - 1 - d];
      frame.outcome = isContinue ? "continue" : "break";
      frame.bodyTerminated = true;
    }
  }
  /** A may-run call to a registered definition fires per its body's dead kind. */
  applyCall(name, inPipeline, backgrounded) {
    if (!this.defs.has(name) || backgrounded) return;
    if (this.defProbeStack.has(name)) return;
    const body = this.defs.get(name);
    this.defProbeStack.add(name);
    const kind = this.defBodyFireKind(body);
    this.defProbeStack.delete(name);
    if (kind === null) return;
    if (kind === "never-return") {
      this.dead = "never-return";
    } else if (!inPipeline) {
      this.dead = kind;
    }
  }
  /** Whether a definition body, walked as its own function, ends dead. */
  defBodyFireKind(body) {
    const res = splitTopLevel(body);
    if (res.malformed !== void 0) return "malformed";
    const savedDead = this.dead;
    const savedReturned = this.returned;
    const savedFnDepth = this.fnDepth;
    const savedLoopStack = this.loopStack;
    this.dead = null;
    this.returned = false;
    this.fnDepth = this.fnDepth + 1;
    this.loopStack = [];
    this.walkList(res.stages, { liveness: true, discard: true, sideEffects: true, inputFacing: false });
    const kind = this.dead;
    this.dead = savedDead;
    this.returned = savedReturned;
    this.fnDepth = savedFnDepth;
    this.loopStack = savedLoopStack;
    return kind;
  }
  knownStatus(argv) {
    if (argv === null || argv.length === 0) return "success";
    const a = walkStrip(stripWrappers(stripRedirects(argv)));
    if (a.length === 0) return "success";
    if (a[0] === "true" || a[0] === ":") return "success";
    if (a[0] === "false") return "failure";
    if (a.every((w) => ASSIGNMENT_RE.test(w))) return "success";
    if (a[0] === "export" && a.length > 1 && a.slice(1).every((w) => ASSIGNMENT_RE.test(w))) return "success";
    if (a[0] === "set") return setFlagsKnown(a.slice(1)) ? "success" : "unknown";
    return "unknown";
  }
  applySideEffects(member, argv, stripped) {
    if (argv === null || argv.length === 0) return;
    const words = splitWords(member.text);
    if (words !== null && words.length > 0) {
      let k = 0;
      while (k < words.length && ASSIGNMENT_RE.test(words[k])) k++;
      if (k === words.length) {
        for (const w of words) {
          const eq = w.indexOf("=");
          this.assignments.set(w.slice(0, eq), w.slice(eq + 1));
        }
      } else if (words[0] === "export") {
        for (const w of words.slice(1)) {
          if (ASSIGNMENT_RE.test(w)) {
            const eq = w.indexOf("=");
            this.assignments.set(w.slice(0, eq), w.slice(eq + 1));
          }
        }
      }
    }
    if (stripped !== null && stripped[0] === "set") this.applySetFlags(stripped.slice(1));
    if (stripped !== null && stripped[0] === "unset") {
      for (const w of stripped.slice(1)) {
        if (!w.startsWith("-")) this.assignments.delete(w);
      }
    }
  }
  applySetFlags(args) {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "--") continue;
      if (!(a.startsWith("-") || a.startsWith("+"))) continue;
      const on = a.startsWith("-");
      const chars = a.slice(1);
      for (let k = 0; k < chars.length; k++) {
        const c = chars[k];
        if (c === "o") {
          const name = args[i + 1];
          if (name === void 0) return;
          if (name === "errexit") this.errexit = on;
          else if (name === "noerrexit") this.errexit = !on;
          else if (name === "pipefail") this.pipefail = on;
          else if (name === "nopipefail") this.pipefail = !on;
          i++;
          break;
        }
        if (c === "e") this.errexit = on;
      }
    }
  }
  processConstruct(member, kind, ctx) {
    const { exec, backgrounded, opts } = ctx;
    const discard = opts.discard || exec !== "yes";
    const sideEffects = opts.sideEffects && exec === "yes";
    switch (kind) {
      case "if": {
        const parsed = parseIf(member.text);
        if (parsed === null) return "unknown";
        const regions = [
          parsed.condition,
          parsed.thenBody,
          ...parsed.elifs.flatMap((e) => [e.condition, e.body]),
          ...parsed.elseBody !== null ? [parsed.elseBody] : []
        ];
        const condStatus = this.walkList(splitTopLevel(parsed.condition).stages, {
          liveness: false,
          discard: true,
          sideEffects: true,
          inputFacing: false
        });
        if (condStatus === "unknown") return this.opaquePath(regions, ctx);
        if (condStatus === "success") {
          return this.walkBranch(parsed.thenBody, discard, sideEffects);
        }
        for (const elif of parsed.elifs) {
          const eStatus = this.walkList(splitTopLevel(elif.condition).stages, {
            liveness: false,
            discard: true,
            sideEffects: true,
            inputFacing: false
          });
          if (eStatus === "unknown") return this.opaquePath(regions, ctx);
          if (eStatus === "success") return this.walkBranch(elif.body, discard, sideEffects);
        }
        if (parsed.elseBody !== null) return this.walkBranch(parsed.elseBody, discard, sideEffects);
        return "success";
      }
      case "while":
      case "until": {
        const parsed = parseLoop(member.text, kind);
        if (parsed === null) return "unknown";
        const condStatus = this.walkList(splitTopLevel(parsed.condition).stages, {
          liveness: false,
          discard: true,
          sideEffects: true,
          inputFacing: false
        });
        if (condStatus === "unknown") return this.opaquePath([parsed.condition, parsed.body], ctx);
        const bodyRuns = kind === "while" ? condStatus === "success" : condStatus === "failure";
        if (!bodyRuns) return "success";
        const res = splitTopLevel(parsed.body);
        if (res.malformed !== void 0) {
          this.dead = "malformed";
          return "unknown";
        }
        const frame = { outcome: "none", bodyTerminated: false, ambiguousStop: false };
        this.loopStack.push(frame);
        this.walkList(res.stages, { liveness: true, discard, sideEffects, inputFacing: false });
        this.loopStack.pop();
        switch (frame.outcome) {
          case "break":
            return "success";
          case "continue":
          case "none":
            if (this.dead === null && !backgrounded) this.dead = "never-return";
            return "unknown";
          case "ambiguous":
          case "return":
            return "unknown";
        }
        return "unknown";
      }
      case "for": {
        const parsed = parseFor(member.text);
        if (parsed === null) return "unknown";
        if (parsed.list === null || parsed.list.some((w) => /[$`]/.test(w))) {
          return this.opaquePath([parsed.wholeInterior], ctx);
        }
        if (parsed.list.length === 0) return "success";
        const res = splitTopLevel(parsed.body);
        if (res.malformed !== void 0) {
          this.dead = "malformed";
          return "unknown";
        }
        return this.walkList(res.stages, { liveness: true, discard, sideEffects, inputFacing: false });
      }
      case "case": {
        const parsed = parseCase(member.text);
        if (parsed === null) return "unknown";
        const regions = parsed.branches.map((b) => b.body);
        if (parsed.fallthrough || resolveSubject(parsed.subject, this.assignments) === null) {
          return this.opaquePath(regions, ctx);
        }
        const subject = resolveSubject(parsed.subject, this.assignments);
        let matchedBranch = -1;
        let undecidable = false;
        for (let b = 0; b < parsed.branches.length; b++) {
          const r = evalPattern(parsed.branches[b].pattern, subject);
          if (r === "match") {
            matchedBranch = b;
            break;
          }
          if (r === "glob" || r === "undecidable") {
            undecidable = true;
            break;
          }
        }
        if (undecidable) return this.opaquePath(regions, ctx);
        if (matchedBranch !== -1) {
          return this.walkBranch(parsed.branches[matchedBranch].body, discard, sideEffects);
        }
        return "success";
      }
      case "select": {
        const parsed = parseLoop(member.text, "while");
        return this.opaquePath(parsed !== null ? [parsed.body] : [], ctx);
      }
      case "brace": {
        const interior = extractGroupBody(member.text, "{", "}");
        if (interior === null) return "unknown";
        const res = splitTopLevel(interior);
        if (res.malformed !== void 0) {
          this.dead = "malformed";
          return "unknown";
        }
        return this.walkList(res.stages, { liveness: true, discard, sideEffects, inputFacing: false });
      }
      case "subshell": {
        const interior = extractGroupBody(member.text, "(", ")");
        if (interior === null) return "unknown";
        const res = splitTopLevel(interior);
        if (res.malformed !== void 0) {
          this.dead = "malformed";
          return "unknown";
        }
        const savedErrexit = this.errexit;
        const savedPipefail = this.pipefail;
        const savedAssignments = this.assignments;
        const savedDefs = this.defs;
        const savedReturned = this.returned;
        const savedFnDepth = this.fnDepth;
        const savedLoopStack = this.loopStack;
        const savedDirFrame = this.dirFrame;
        const savedDead = this.dead;
        this.errexit = savedErrexit;
        this.pipefail = savedPipefail;
        this.assignments = new Map(savedAssignments);
        this.defs = new Map(savedDefs);
        this.returned = false;
        this.fnDepth = 0;
        this.loopStack = [];
        this.dirFrame = savedDirFrame + 1;
        this.dead = null;
        const status = this.walkList(res.stages, { liveness: true, discard, sideEffects, inputFacing: false });
        const innerDead = this.dead;
        this.errexit = savedErrexit;
        this.pipefail = savedPipefail;
        this.assignments = savedAssignments;
        this.defs = savedDefs;
        this.returned = savedReturned;
        this.fnDepth = savedFnDepth;
        this.loopStack = savedLoopStack;
        this.dirFrame = savedDirFrame;
        this.dead = savedDead;
        if (innerDead === "never-return") this.dead = "never-return";
        return status;
      }
      case "def": {
        if (sideEffects) {
          const def = parseDef(member.text);
          if (def !== null) this.defs.set(def.name, def.body);
        }
        return "success";
      }
    }
    return "unknown";
  }
  walkBranch(body, discard, sideEffects) {
    const res = splitTopLevel(body);
    if (res.malformed !== void 0) {
      this.dead = "malformed";
      return "unknown";
    }
    return this.walkList(res.stages, { liveness: true, discard, sideEffects, inputFacing: false });
  }
  /**
   * The opaque-construct treatment (plan §2): re-split each region and walk it
   * with the same machinery so an `exit`/`exec` that may have run, or a
   * never-exit loop, fires fail-closed; hidden break/continue words reach the
   * scanned loop as an ambiguous termination. State is snapshot-restored.
   */
  opaquePath(regions, ctx) {
    const findings = this.scanOpaque(regions);
    if (findings.fire !== null) {
      if (findings.fire === "never-return") {
        if (!ctx.backgrounded) this.dead = "never-return";
      } else if (!ctx.inPipeline && !ctx.backgrounded) {
        this.dead = findings.fire;
      }
    }
    if (findings.breakTarget !== "none") {
      const top = this.loopStack[this.loopStack.length - 1];
      if (top !== void 0) {
        top.outcome = "ambiguous";
        top.ambiguousStop = true;
      }
    }
    return "unknown";
  }
  scanOpaque(regions) {
    const report = {
      fire: null,
      breakTarget: "none"
    };
    const savedChain = this.chain;
    const savedErrexit = this.errexit;
    const savedPipefail = this.pipefail;
    const savedAssignments = this.assignments;
    const savedDefs = this.defs;
    const savedDead = this.dead;
    const savedReturned = this.returned;
    const savedFnDepth = this.fnDepth;
    const savedLoopStack = this.loopStack;
    const savedDirFrame = this.dirFrame;
    const savedVerdicts = this.verdicts.length;
    const savedExpanded = this.expanded.length;
    const savedDefProbe = new Set(this.defProbeStack);
    for (const region of regions) {
      const res = splitTopLevel(region);
      if (res.malformed !== void 0) {
        report.fire = "malformed";
        break;
      }
      this.dead = null;
      this.returned = false;
      this.loopStack = savedLoopStack.map((f) => ({ ...f }));
      this.walkList(res.stages, { liveness: true, discard: true, sideEffects: false, inputFacing: false });
      if (this.dead !== null) {
        if (report.fire === null || this.dead === "never-return" || this.dead === "malformed") report.fire = this.dead;
      }
      if (report.breakTarget === "none") {
        const innermost = this.loopStack[this.loopStack.length - 1];
        if (innermost !== void 0 && (innermost.outcome === "break" || innermost.outcome === "continue")) {
          report.breakTarget = innermost.outcome;
        }
      }
    }
    this.chain = savedChain;
    this.errexit = savedErrexit;
    this.pipefail = savedPipefail;
    this.assignments = savedAssignments;
    this.defs = savedDefs;
    this.dead = savedDead;
    this.returned = savedReturned;
    this.fnDepth = savedFnDepth;
    this.loopStack = savedLoopStack;
    this.dirFrame = savedDirFrame;
    this.verdicts.length = savedVerdicts;
    this.expanded.length = savedExpanded;
    this.defProbeStack.clear();
    for (const name of savedDefProbe) this.defProbeStack.add(name);
    return report;
  }
};
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
var HEREDOC_OPEN = /\bcat[ \t]+(>{1,2})[ \t]*(\S+)[ \t]*<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|([A-Za-z_][A-Za-z0-9_]*))/g;
function escapeRegExp2(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function extractHeredocWrites(raw) {
  const writes = [];
  let masked = "";
  let cursor = 0;
  HEREDOC_OPEN.lastIndex = 0;
  let openMatch = HEREDOC_OPEN.exec(raw);
  while (openMatch !== null) {
    const [, redirect, target, dash, dq1, dq2, bare] = openMatch;
    const delim = dq1 ?? dq2 ?? bare;
    const openEnd = openMatch.index + openMatch[0].length;
    if (!delim || openMatch.index < cursor) {
      HEREDOC_OPEN.lastIndex = openMatch.index + 1;
      openMatch = HEREDOC_OPEN.exec(raw);
      continue;
    }
    const nl = raw.slice(openEnd).match(/^[ \t]*\r?\n/);
    const bodyStart = nl !== null ? openEnd + nl[0].length : openEnd;
    const remainder = raw.slice(bodyStart);
    const closeRe = new RegExp(`^${dash ? "\\t*" : ""}${escapeRegExp2(delim)}[ \\t]*$`, "m");
    const closeMatch = closeRe.exec(remainder);
    let body;
    let matchEnd;
    if (closeMatch) {
      body = remainder.slice(0, closeMatch.index).replace(/\n$/, "");
      matchEnd = bodyStart + closeMatch.index + closeMatch[0].length;
    } else if (nl === null) {
      body = "";
      matchEnd = openEnd;
    } else {
      body = remainder.replace(/\n$/, "");
      matchEnd = raw.length;
    }
    masked += raw.slice(cursor, openMatch.index);
    masked += `__heredoc_${writes.length}__`;
    cursor = matchEnd;
    writes.push({ redirect, target, body });
    HEREDOC_OPEN.lastIndex = matchEnd;
    openMatch = HEREDOC_OPEN.exec(raw);
  }
  masked += raw.slice(cursor);
  return { writes, masked };
}
var NL_ARG_FLAGS = /* @__PURE__ */ new Set(["-b", "-i", "-l", "-s", "-v", "-w"]);
var STDOUT_REDIRECT_TWO_TOKEN = /^(?:>>?|&>>?|1>>?|>\|)$/;
var STDOUT_REDIRECT_FUSED = /^(?:>>?|&>>?|1>>?)[^<>&|]/;
var STDOUT_REDIRECT_FUSED_PIPE = /^>\|[^<>&|]/;
var hasStdoutRedirect = (raw) => raw.some(
  (w) => STDOUT_REDIRECT_TWO_TOKEN.test(w) || STDOUT_REDIRECT_FUSED.test(w) || STDOUT_REDIRECT_FUSED_PIPE.test(w)
);
function analyzeSource(argv) {
  if (argv[0] === "cat" || argv[0] === "nl") {
    const files = [];
    if (argv[0] === "cat") {
      for (let i = 1; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith("-") && a !== "-") continue;
        files.push(a);
      }
    } else {
      for (let i = 1; i < argv.length; i++) {
        const a = argv[i];
        if (a === "-") {
          files.push(a);
          continue;
        }
        if (a.startsWith("-")) {
          if (NL_ARG_FLAGS.has(a)) i += 1;
          continue;
        }
        files.push(a);
      }
    }
    const real = files.filter((f) => f !== "-");
    if (real.length === 0) return { kind: "none" };
    const idiom = argv[0] === "cat" ? "cat-file" : "nl-file";
    if (real.length === 1 && !files.includes("-")) {
      return { kind: "narrowable", fileArg: real[0], idiom, resolverKind: "fs" };
    }
    return { kind: "unnarrowable", files: real.map((fileArg) => ({ fileArg, idiom })) };
  }
  if (argv[0] === "git") {
    const outcomes = matchGitShow(argv);
    if (outcomes.length === 1) {
      const o = outcomes[0];
      if (o.kind === "unresolved") {
        return { kind: "gitUnresolved", fileArg: o.fileArg, reason: o.reason };
      }
      if (o.kind === "candidate" && o.resolverKind !== "fs") {
        return {
          kind: "git",
          fileArg: o.fileArg,
          idiom: "git-show-rev-path",
          rev: o.resolverKind.rev,
          resolverKind: o.resolverKind,
          dirOverride: o.dirOverride
        };
      }
    }
  }
  return { kind: "none" };
}
function classifyStdinSelector(argv) {
  if (argv[0] === "head" || argv[0] === "tail") {
    const { count, fromStart, disqualified, files } = parseHeadTailFlags(argv.slice(1), argv[0] === "tail");
    if (disqualified) return null;
    const fileArgs = files.filter((f) => f !== "-");
    if (fileArgs.length > 0) return null;
    return argv[0] === "head" ? { kind: "head", count: count ?? 10 } : { kind: "tail", count: count ?? 10, fromStart };
  }
  if (argv[0] === "sed") {
    const rest = argv.slice(1);
    if (!rest.includes("-n")) return null;
    let scriptIdx = -1;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "-n") continue;
      if (sedScriptSegments(rest[i]).some((seg) => SED_RANGE.test(seg))) {
        scriptIdx = i;
        break;
      }
    }
    if (scriptIdx === -1) return null;
    const fileCandidates = rest.filter((a, i) => i !== scriptIdx && a !== "-n" && !a.startsWith("-"));
    if (fileCandidates.length !== 0) return null;
    const ranges = [];
    for (const segment of sedScriptSegments(rest[scriptIdx])) {
      const m = segment.match(SED_RANGE);
      if (!m) continue;
      const start = Number.parseInt(m[1], 10);
      ranges.push({ start, end: m[2] === void 0 ? start : m[2] === "$" ? "$" : Number.parseInt(m[2], 10) });
    }
    if (ranges.length === 0) return null;
    return { kind: "sed", ranges };
  }
  return null;
}
var LINE_SELECTORS = [matchSed, matchHead, matchTail];
function parseCommandDetailed(command, opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const allowlist = opts.allowlist ?? DEFAULT_PATH_ALLOWLIST;
  const env = opts.env ?? Object.fromEntries(allowlist.map((n) => [n, process.env[n]]));
  const { writes: heredocWrites, masked } = extractHeredocWrites(command);
  const { stages: simpleCommands, malformed } = splitTopLevel(masked);
  const expanded = new ExecutionWalker().walkInput(simpleCommands);
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
  const dirFrames = [{ dir: cwd, certain: true, prev: void 0 }];
  const gitDirOf = (c, frame) => {
    if (c.dirOverride === void 0) return frame.certain ? frame.dir : void 0;
    if (isAbsolute2(c.dirOverride)) return c.dirOverride;
    return frame.certain ? resolvePath(frame.dir, c.dirOverride) : void 0;
  };
  let window = null;
  const wholeFileCandidate = (s) => ({
    kind: "candidate",
    idiom: s.idiom,
    fileArg: s.fileArg,
    spec: { kind: "toEof", start: 1 },
    resolverKind: "fs"
  });
  const sourceCandidate = (src) => ({
    kind: "candidate",
    idiom: src.idiom,
    fileArg: src.fileArg,
    spec: { kind: "toEof", start: 1 },
    resolverKind: src.resolverKind,
    dirOverride: src.dirOverride
  });
  const emitWindowTouch = (w) => {
    const spec = w.consumed ? { kind: "literal", start: w.lo, end: w.hi } : { kind: "toEof", start: 1 };
    emitCandidate(
      {
        kind: "candidate",
        idiom: w.idiom,
        fileArg: w.fileArg,
        spec,
        resolverKind: w.resolverKind,
        dirOverride: w.dirOverride
      },
      { dir: w.dir, certain: w.certain }
    );
  };
  const initWindow = (src, frame) => {
    if (gitDirOf(src, frame) === void 0 || !frame.certain && src.resolverKind === "fs" && !isAbsolute2(src.fileArg)) {
      emitCandidate(sourceCandidate(src), frame);
      return;
    }
    const total = (src.resolverKind === "fs" ? cachedFsTotalLines(resolvePath(frame.dir, src.fileArg)) : cachedGitTotalLines(gitDirOf(src, frame), src.resolverKind.rev, src.fileArg))();
    if (total === null) {
      emitCandidate(sourceCandidate(src), frame);
      return;
    }
    window = {
      idiom: src.idiom,
      fileArg: src.fileArg,
      dir: frame.dir,
      certain: frame.certain,
      dirOverride: src.dirOverride,
      resolverKind: src.resolverKind,
      lo: 1,
      hi: total,
      consumed: false
    };
  };
  const applyWindowTransform = (sel) => {
    const w = window;
    const lo = w.lo;
    const hi = w.hi;
    let nLo;
    let nHi;
    if (sel.kind === "head") {
      nLo = lo;
      nHi = lo + sel.count - 1;
    } else if (sel.kind === "tail") {
      if (sel.fromStart) {
        nLo = lo + sel.count - 1;
        nHi = hi;
      } else {
        nLo = hi - sel.count + 1;
        nHi = hi;
      }
    } else {
      nLo = lo + sel.ranges[0].start - 1;
      nHi = sel.ranges[0].end === "$" ? hi : lo + sel.ranges[0].end - 1;
    }
    nLo = Math.max(nLo, lo);
    nHi = Math.min(nHi, hi);
    if (nLo > nHi) return false;
    w.lo = nLo;
    w.hi = nHi;
    w.consumed = true;
    return true;
  };
  const emitMultiRange = (ranges) => {
    const w = window;
    let emitted = false;
    for (const r of ranges) {
      const mLo = Math.max(w.lo, w.lo + r.start - 1);
      const mHi = Math.min(w.hi, r.end === "$" ? w.hi : w.lo + r.end - 1);
      if (mLo > mHi) continue;
      emitted = true;
      emitCandidate(
        {
          kind: "candidate",
          idiom: w.idiom,
          fileArg: w.fileArg,
          spec: { kind: "literal", start: mLo, end: mHi },
          resolverKind: w.resolverKind,
          dirOverride: w.dirOverride
        },
        { dir: w.dir, certain: w.certain }
      );
    }
    if (!emitted) emitWindowTouch(w);
  };
  const emitCandidate = (c, frame) => {
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
    const resolutionDir = c.resolverKind === "fs" ? frame.dir : gitDirOf(c, frame);
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
      span: { lineStart: range.lineStart, lineEnd: range.lineEnd, absolutePath }
    });
  };
  for (let i = 0; i < expanded.length; i++) {
    const item = expanded[i];
    while (dirFrames.length > item.dirFrame + 1) dirFrames.pop();
    while (dirFrames.length < item.dirFrame + 1) dirFrames.push({ ...dirFrames[dirFrames.length - 1] });
    const frame = dirFrames[dirFrames.length - 1];
    const stageEnv = { ...env, PWD: frame.dir };
    const pipePrecedes = item.precededBy === "pipe";
    const pipeFollows = expanded[i + 1] !== void 0 && expanded[i + 1].precededBy === "pipe";
    if (!pipePrecedes && window !== null) {
      emitWindowTouch(window);
      window = null;
    }
    const cdArgv = stripForEmission(stripRedirects(argvOf(item.text) ?? []));
    if (cdArgv[0] === "cd" && !item.inPipeline) {
      if (item.exec === "yes") {
        const expandedArgv = stripForEmission(
          stripRedirects(argvOf(expandVariables(item.text, item.assignments, stageEnv)) ?? [])
        );
        const target = expandedArgv[1];
        if (target === void 0 || target === "~" || target.startsWith("~/")) {
          const home = expandVariables("$HOME", item.assignments, stageEnv);
          if (looksUnresolvable(home)) frame.certain = false;
          else {
            frame.prev = frame.dir;
            frame.dir = resolvePath(frame.dir, target === void 0 ? home : home + target.slice(1));
            frame.certain = true;
          }
        } else if (target === "-") {
          if (frame.prev !== void 0) {
            const old = frame.dir;
            frame.dir = frame.prev;
            frame.prev = old;
          }
        } else if (target.startsWith("~")) {
          frame.certain = false;
        } else if (looksUnresolvable(target)) {
          frame.certain = false;
        } else {
          frame.prev = frame.dir;
          frame.dir = resolvePath(frame.dir, target);
          frame.certain = true;
        }
      } else if (item.exec === "unknown") {
        frame.certain = false;
      }
      continue;
    }
    if (item.exec !== "yes") {
      continue;
    }
    const heredocRef = item.text.match(/^__heredoc_(\d+)__$/);
    if (heredocRef) {
      if (window !== null) {
        emitWindowTouch(window);
        window = null;
      }
      const w = heredocWrites[Number.parseInt(heredocRef[1], 10)];
      if (looksUnresolvable(w.target)) {
        results.push({
          status: "unresolved",
          idiom: "heredoc-write",
          fileArg: w.target,
          reason: "path contains an unexpanded shell variable or glob"
        });
        continue;
      }
      if (!frame.certain && !isAbsolute2(w.target)) {
        results.push({
          status: "unresolved",
          idiom: "heredoc-write",
          fileArg: w.target,
          reason: "the working directory is uncertain \u2014 the relative path cannot be resolved"
        });
        continue;
      }
      const absolutePath = resolvePath(frame.dir, w.target);
      const bodyLines = w.body.length === 0 ? 0 : w.body.split("\n").length;
      if (bodyLines === 0) {
        if (w.redirect !== ">") continue;
        results.push({
          status: "resolved",
          idiom: "heredoc-write",
          span: { lineStart: 1, lineEnd: 1, absolutePath, body: "", redirect: w.redirect }
        });
        continue;
      }
      const spec = w.redirect === ">" ? { kind: "literal", start: 1, end: bodyLines } : { kind: "appendLines", count: bodyLines };
      const range = resolveSpec(spec, cachedFsTotalLines(absolutePath));
      if (range === null) {
        results.push({
          status: "unresolved",
          idiom: "heredoc-write",
          fileArg: absolutePath,
          reason: "append target: could not read existing file to find its current length"
        });
      } else {
        results.push({
          status: "resolved",
          idiom: "heredoc-write",
          span: { lineStart: range.lineStart, lineEnd: range.lineEnd, absolutePath, body: w.body, redirect: w.redirect }
        });
      }
      continue;
    }
    const rawArgv = argvOf(expandVariables(item.text, item.assignments, stageEnv)) ?? [];
    const stripped = stripForEmission(stripWrappers(stripRedirects(rawArgv)));
    if (stripped.length === 0) {
      if (window !== null) {
        emitWindowTouch(window);
        window = null;
      }
      continue;
    }
    if (stripped.some((w) => w.startsWith(">") || w.startsWith("<"))) {
      if (window !== null) {
        emitWindowTouch(window);
        window = null;
      }
      continue;
    }
    if (!pipePrecedes && pipeFollows && (stripped[0] === "cat" || stripped[0] === "nl" || stripped[0] === "git")) {
      const src = analyzeSource(stripped);
      switch (src.kind) {
        case "none":
          break;
        // fall through to the ordinary dispatch
        case "gitUnresolved":
          results.push({
            status: "unresolved",
            idiom: "git-show-rev-path",
            fileArg: src.fileArg,
            reason: src.reason
          });
          continue;
        case "unnarrowable": {
          for (const f of src.files) emitCandidate(wholeFileCandidate(f), frame);
          continue;
        }
        case "narrowable":
        case "git": {
          if (hasStdoutRedirect(rawArgv)) {
            emitCandidate(sourceCandidate(src), frame);
          } else {
            initWindow(src, frame);
          }
          continue;
        }
      }
    }
    if (pipePrecedes && window !== null) {
      const sel = classifyStdinSelector(stripped);
      if (sel !== null) {
        if (sel.kind === "sed" && sel.ranges.length > 1) {
          emitMultiRange(sel.ranges);
          window = null;
        } else {
          applyWindowTransform(sel);
          if (hasStdoutRedirect(rawArgv)) {
            emitWindowTouch(window);
            window = null;
          }
        }
      } else {
        emitWindowTouch(window);
        window = null;
      }
    }
    if (stripped[0] === "cat" || stripped[0] === "nl") {
      const src = analyzeSource(stripped);
      if (src.kind === "narrowable") {
        emitCandidate(wholeFileCandidate({ fileArg: src.fileArg, idiom: src.idiom }), frame);
      } else if (src.kind === "unnarrowable") {
        for (const f of src.files) emitCandidate(wholeFileCandidate(f), frame);
      }
    } else {
      for (const matcher of [...LINE_SELECTORS, matchGitShow, matchGitLogL]) {
        for (const outcome of matcher(stripped)) {
          if (outcome.kind === "unresolved") {
            results.push({
              status: "unresolved",
              idiom: outcome.idiom,
              fileArg: outcome.fileArg,
              reason: outcome.reason
            });
          } else {
            emitCandidate(outcome, frame);
          }
        }
      }
    }
  }
  if (window !== null) {
    emitWindowTouch(window);
  }
  return results;
}

// src/common/span-surface.ts
import { execFileSync as execFileSync3 } from "node:child_process";
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
import { execFileSync as execFileSync4 } from "node:child_process";
import * as fs5 from "node:fs";
import { basename as basename2 } from "node:path";

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
async function runTouchHook(input, executors, memo) {
  let treeModified = false;
  try {
    let range = "whole-file";
    if (input.kind === "write") {
      const fix = await executors.fix(input.filePath, input.cwd);
      treeModified = fix.modified;
      range = recoverRangeFromDisk(input.written, input.filePath);
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
    return execFileSync4("git", ["-C", repoRoot, "status", "--porcelain", "--", spanRoot], {
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
        execFileSync4("git", ["span", "drift", resolved.relPath, "--fix"], {
          cwd: resolved.repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs
        });
      } catch {
      }
      const after = spanStatusSnapshot(resolved.repoRoot);
      return { modified: before !== after };
    },
    list: async (filePath, cwd) => {
      const resolved = repoRelArg(filePath, cwd);
      if (!resolved) return [];
      try {
        const out = execFileSync4("git", ["span", "list", "--porcelain", resolved.relPath], {
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
        out = execFileSync4("git", ["span", "drift", "--format", "porcelain", ...scoped], {
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
        const out = execFileSync4("git", ["span", "why", name], {
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
    return { kind: "write", sessionId, cwd, filePath, written };
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
      const matches = parseCommandDetailed(command, { cwd });
      const blocks = [];
      for (const match of matches) {
        if (match.status !== "resolved") continue;
        const span = match.span;
        const scope2 = resolveTouchScope(cwd, span.absolutePath);
        if (!scope2) continue;
        let touch2;
        if (match.idiom === "heredoc-write") {
          const written = span.redirect === ">" ? "" : span.body ?? "";
          touch2 = { kind: "write", sessionId, cwd, filePath: span.absolutePath, written };
        } else {
          touch2 = {
            kind: "read",
            sessionId,
            cwd,
            filePath: span.absolutePath,
            offset: span.lineStart,
            limit: span.lineEnd - span.lineStart + 1
          };
        }
        const output2 = await runTouchHook(touch2, executors, memo);
        if (output2.additionalContext) blocks.push(output2.additionalContext);
      }
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcy9kaXN0L2Vudi5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzL2Rpc3QvaG9va3MuanMiLCAiLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcy9kaXN0L2xvZ2dlci5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzL2Rpc3Qvb3V0cHV0cy5qcyIsICIuLi8uLi9ub2RlX21vZHVsZXMvQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzL2Rpc3QvcnVudGltZS5qcyIsICJzcmMvY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi50cyIsICJzcmMvY29tbW9uL3BhcnNlLWNvbW1hbmQudHMiLCAic3JjL2NvbW1vbi9jb21tYW5kLXJlc29sdmUudHMiLCAic3JjL2NvbW1vbi9zaGVsbC1zcGxpdC50cyIsICJzcmMvY29tbW9uL3ZhcmlhYmxlLWV4cGFuZC50cyIsICJzcmMvY29tbW9uL3NwYW4tc3VyZmFjZS50cyIsICJzcmMvY29tbW9uL3NwYW4taWdub3JlLnRzIiwgInNyYy9jb21tb24vdG91Y2gtY29yZS50cyIsICJzcmMvY29tbW9uL2FuY2hvci10cmVlLnRzIiwgInNyYy9jbGF1ZGUvcG9zdC10b29sLXVzZS50cyIsICJzcmMvY2xhdWRlL3Bvc3QtdG9vbC11c2UtZW50cnkudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8qKlxuICogRW52aXJvbm1lbnQgdmFyaWFibGUgdXRpbGl0aWVzIGZvciBDbGF1ZGUgQ29kZSBob29rcy5cbiAqXG4gKiBQcm92aWRlcyB0eXBlZCBhY2Nlc3MgdG8gQ2xhdWRlIENvZGUncyBlbnZpcm9ubWVudCB2YXJpYWJsZXMgYW5kIHV0aWxpdGllc1xuICogZm9yIHBlcnNpc3RpbmcgZW52aXJvbm1lbnQgdmFyaWFibGVzIGluIFNlc3Npb25TdGFydCBob29rcy5cbiAqXG4gKiAjIyBFbnZpcm9ubWVudCBWYXJpYWJsZXNcbiAqXG4gKiBDbGF1ZGUgQ29kZSBzZXRzIHRoZXNlIGVudmlyb25tZW50IHZhcmlhYmxlcyB3aGVuIHJ1bm5pbmcgaG9va3M6XG4gKlxuICogfCBWYXJpYWJsZSB8IERlc2NyaXB0aW9uIHwgQXZhaWxhYmxlIEluIHxcbiAqIHwtLS0tLS0tLS0tfC0tLS0tLS0tLS0tLS18LS0tLS0tLS0tLS0tLS18XG4gKiB8IGBDTEFVREVfUFJPSkVDVF9ESVJgIHwgQWJzb2x1dGUgcGF0aCB0byBwcm9qZWN0IHJvb3QgfCBBbGwgaG9va3MgfFxuICogfCBgQ0xBVURFX0VOVl9GSUxFYCB8IFBhdGggdG8gZmlsZSBmb3IgcGVyc2lzdGluZyBlbnYgdmFycyB8IFNlc3Npb25TdGFydCBvbmx5IHxcbiAqIHwgYENMQVVERV9DT0RFX1JFTU9URWAgfCBgXCJ0cnVlXCJgIGlmIHJ1bm5pbmcgcmVtb3RlbHkgfCBBbGwgaG9va3MgfFxuICogQG1vZHVsZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IGdldFByb2plY3REaXIsIHBlcnNpc3RFbnZWYXIsIGlzUmVtb3RlRW52aXJvbm1lbnQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIC8vIEdldCBwcm9qZWN0IGRpcmVjdG9yeVxuICogY29uc3QgcHJvamVjdERpciA9IGdldFByb2plY3REaXIoKTtcbiAqXG4gKiAvLyBDaGVjayBpZiBydW5uaW5nIHJlbW90ZWx5XG4gKiBpZiAoaXNSZW1vdGVFbnZpcm9ubWVudCgpKSB7XG4gKiAgIC8vIEhhbmRsZSByZW1vdGUtc3BlY2lmaWMgbG9naWNcbiAqIH1cbiAqXG4gKiAvLyBJbiBTZXNzaW9uU3RhcnQgaG9vazogcGVyc2lzdCBlbnZpcm9ubWVudCB2YXJpYWJsZXNcbiAqIHBlcnNpc3RFbnZWYXIoJ05PREVfRU5WJywgJ3Byb2R1Y3Rpb24nKTtcbiAqIHBlcnNpc3RFbnZWYXIoJ0FQSV9LRVknLCAnc2VjcmV0LWtleScpO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjaG9vay1leGVjdXRpb24tZGV0YWlsc1xuICovXG5pbXBvcnQgKiBhcyBmcyBmcm9tIFwibm9kZTpmc1wiO1xuLyoqXG4gKiBDbGF1ZGUgQ29kZSBlbnZpcm9ubWVudCB2YXJpYWJsZSBuYW1lcy5cbiAqXG4gKiBUaGVzZSBhcmUgdGhlIGVudmlyb25tZW50IHZhcmlhYmxlcyB0aGF0IENsYXVkZSBDb2RlIHNldHMgd2hlbiBydW5uaW5nIGhvb2tzLlxuICovXG5leHBvcnQgY29uc3QgQ0xBVURFX0VOVl9WQVJTID0ge1xuICAgIC8qKlxuICAgICAqIEFic29sdXRlIHBhdGggdG8gdGhlIHByb2plY3Qgcm9vdCBkaXJlY3Rvcnkgd2hlcmUgQ2xhdWRlIENvZGUgd2FzIHN0YXJ0ZWQuXG4gICAgICogQXZhaWxhYmxlIGluIGFsbCBob29rcy5cbiAgICAgKi9cbiAgICBQUk9KRUNUX0RJUjogXCJDTEFVREVfUFJPSkVDVF9ESVJcIixcbiAgICAvKipcbiAgICAgKiBQYXRoIHRvIGEgZmlsZSB3aGVyZSBTZXNzaW9uU3RhcnQgaG9va3MgY2FuIHBlcnNpc3QgZW52aXJvbm1lbnQgdmFyaWFibGVzLlxuICAgICAqIFZhcmlhYmxlcyB3cml0dGVuIHRvIHRoaXMgZmlsZSB3aWxsIGJlIGF2YWlsYWJsZSBpbiBhbGwgc3Vic2VxdWVudCBiYXNoIGNvbW1hbmRzLlxuICAgICAqIE9ubHkgYXZhaWxhYmxlIGluIFNlc3Npb25TdGFydCBob29rcy5cbiAgICAgKi9cbiAgICBFTlZfRklMRTogXCJDTEFVREVfRU5WX0ZJTEVcIixcbiAgICAvKipcbiAgICAgKiBTZXQgdG8gXCJ0cnVlXCIgd2hlbiBydW5uaW5nIGluIGEgcmVtb3RlICh3ZWIpIGVudmlyb25tZW50LlxuICAgICAqIE5vdCBzZXQgb3IgZW1wdHkgd2hlbiBydW5uaW5nIGluIGxvY2FsIENMSSBlbnZpcm9ubWVudC5cbiAgICAgKi9cbiAgICBSRU1PVEU6IFwiQ0xBVURFX0NPREVfUkVNT1RFXCIsXG59O1xuLyoqXG4gKiBHZXRzIHRoZSBDbGF1ZGUgQ29kZSBwcm9qZWN0IGRpcmVjdG9yeS5cbiAqXG4gKiBUaGlzIGlzIHRoZSBhYnNvbHV0ZSBwYXRoIHRvIHRoZSBwcm9qZWN0IHJvb3Qgd2hlcmUgQ2xhdWRlIENvZGUgd2FzIHN0YXJ0ZWQuXG4gKiBUaGUgdmFsdWUgY29tZXMgZnJvbSB0aGUgYENMQVVERV9QUk9KRUNUX0RJUmAgZW52aXJvbm1lbnQgdmFyaWFibGUuXG4gKiBAcmV0dXJucyBUaGUgcHJvamVjdCBkaXJlY3RvcnkgcGF0aCwgb3IgdW5kZWZpbmVkIGlmIG5vdCBzZXRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCBwcm9qZWN0RGlyID0gZ2V0UHJvamVjdERpcigpO1xuICogaWYgKHByb2plY3REaXIpIHtcbiAqICAgY29uc3QgY29uZmlnUGF0aCA9IGAke3Byb2plY3REaXJ9Ly5jbGF1ZGUvY29uZmlnLmpzb25gO1xuICogfVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRQcm9qZWN0RGlyKCkge1xuICAgIHJldHVybiBwcm9jZXNzLmVudltDTEFVREVfRU5WX1ZBUlMuUFJPSkVDVF9ESVJdO1xufVxuLyoqXG4gKiBHZXRzIHRoZSBDbGF1ZGUgQ29kZSBlbnYgZmlsZSBwYXRoIGZvciBwZXJzaXN0aW5nIGVudmlyb25tZW50IHZhcmlhYmxlcy5cbiAqXG4gKiBUaGlzIGlzIG9ubHkgYXZhaWxhYmxlIGluIFNlc3Npb25TdGFydCBob29rcy4gVGhlIHBhdGggcG9pbnRzIHRvIGEgZmlsZVxuICogd2hlcmUgeW91IGNhbiB3cml0ZSBzaGVsbCBleHBvcnQgc3RhdGVtZW50cyB0byBwZXJzaXN0IGVudmlyb25tZW50IHZhcmlhYmxlc1xuICogZm9yIGFsbCBzdWJzZXF1ZW50IGJhc2ggY29tbWFuZHMgaW4gdGhlIHNlc3Npb24uXG4gKiBAcmV0dXJucyBUaGUgZW52IGZpbGUgcGF0aCwgb3IgdW5kZWZpbmVkIGlmIG5vdCBzZXQgKG5vdCBhIFNlc3Npb25TdGFydCBob29rKVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNvbnN0IGVudkZpbGUgPSBnZXRFbnZGaWxlUGF0aCgpO1xuICogaWYgKGVudkZpbGUpIHtcbiAqICAgLy8gV2UncmUgaW4gYSBTZXNzaW9uU3RhcnQgaG9vayBhbmQgY2FuIHBlcnNpc3QgZW52IHZhcnNcbiAqICAgcGVyc2lzdEVudlZhcignTVlfVkFSJywgJ215LXZhbHVlJyk7XG4gKiB9XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldEVudkZpbGVQYXRoKCkge1xuICAgIHJldHVybiBwcm9jZXNzLmVudltDTEFVREVfRU5WX1ZBUlMuRU5WX0ZJTEVdO1xufVxuLyoqXG4gKiBDaGVja3MgaWYgdGhlIGhvb2sgaXMgcnVubmluZyBpbiBhIHJlbW90ZSAod2ViKSBlbnZpcm9ubWVudC5cbiAqXG4gKiBSZW1vdGUgZW52aXJvbm1lbnRzIG1heSBoYXZlIGRpZmZlcmVudCBjYXBhYmlsaXRpZXMgb3IgcmVzdHJpY3Rpb25zXG4gKiBjb21wYXJlZCB0byBsb2NhbCBDTEkgZW52aXJvbm1lbnRzLlxuICogQHJldHVybnMgdHJ1ZSBpZiBydW5uaW5nIHJlbW90ZWx5LCBmYWxzZSBpZiBydW5uaW5nIGxvY2FsbHlcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpZiAoaXNSZW1vdGVFbnZpcm9ubWVudCgpKSB7XG4gKiAgIC8vIFVzZSB3ZWItY29tcGF0aWJsZSBhcHByb2FjaGVzXG4gKiB9IGVsc2Uge1xuICogICAvLyBDYW4gdXNlIGxvY2FsIENMSSBmZWF0dXJlc1xuICogfVxuICogYGBgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1JlbW90ZUVudmlyb25tZW50KCkge1xuICAgIHJldHVybiBwcm9jZXNzLmVudltDTEFVREVfRU5WX1ZBUlMuUkVNT1RFXSA9PT0gXCJ0cnVlXCI7XG59XG4vKipcbiAqIFBlcnNpc3RzIGFuIGVudmlyb25tZW50IHZhcmlhYmxlIGZvciB1c2UgaW4gc3Vic2VxdWVudCBiYXNoIGNvbW1hbmRzLlxuICpcbiAqIFRoaXMgZnVuY3Rpb24gd3JpdGVzIGEgc2hlbGwgZXhwb3J0IHN0YXRlbWVudCB0byB0aGUgYENMQVVERV9FTlZfRklMRWAsXG4gKiB3aGljaCBDbGF1ZGUgQ29kZSBzb3VyY2VzIGJlZm9yZSBydW5uaW5nIGJhc2ggY29tbWFuZHMuIFRoaXMgYWxsb3dzXG4gKiBTZXNzaW9uU3RhcnQgaG9va3MgdG8gY29uZmlndXJlIHRoZSBlbnZpcm9ubWVudCBmb3IgdGhlIGVudGlyZSBzZXNzaW9uLlxuICpcbiAqICoqSW1wb3J0YW50Kio6IFRoaXMgZnVuY3Rpb24gb25seSB3b3JrcyBpbiBTZXNzaW9uU3RhcnQgaG9va3Mgd2hlcmVcbiAqIGBDTEFVREVfRU5WX0ZJTEVgIGlzIHNldC4gSW4gb3RoZXIgaG9va3MsIGl0IHdpbGwgdGhyb3cgYW4gZXJyb3IuXG4gKiBAcGFyYW0gbmFtZSAtIFRoZSBlbnZpcm9ubWVudCB2YXJpYWJsZSBuYW1lXG4gKiBAcGFyYW0gdmFsdWUgLSBUaGUgZW52aXJvbm1lbnQgdmFyaWFibGUgdmFsdWUgKHdpbGwgYmUgc2hlbGwtZXNjYXBlZClcbiAqIEB0aHJvd3MgRXJyb3IgaWYgQ0xBVURFX0VOVl9GSUxFIGlzIG5vdCBzZXQgKG5vdCBpbiBhIFNlc3Npb25TdGFydCBob29rKVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHNlc3Npb25TdGFydEhvb2ssIHNlc3Npb25TdGFydE91dHB1dCwgcGVyc2lzdEVudlZhciB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgc2Vzc2lvblN0YXJ0SG9vayh7fSwgYXN5bmMgKGlucHV0KSA9PiB7XG4gKiAgIC8vIFBlcnNpc3QgZW52aXJvbm1lbnQgdmFyaWFibGVzIGZvciB0aGUgc2Vzc2lvblxuICogICBwZXJzaXN0RW52VmFyKCdOT0RFX0VOVicsICdwcm9kdWN0aW9uJyk7XG4gKiAgIHBlcnNpc3RFbnZWYXIoJ0FQSV9LRVknLCBwcm9jZXNzLmVudi5NWV9BUElfS0VZID8/ICdkZWZhdWx0Jyk7XG4gKiAgIHBlcnNpc3RFbnZWYXIoJ1BBVEgnLCBgJHtwcm9jZXNzLmVudi5QQVRIfTouL25vZGVfbW9kdWxlcy8uYmluYCk7XG4gKlxuICogICByZXR1cm4gc2Vzc2lvblN0YXJ0T3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjcGVyc2lzdGluZy1lbnZpcm9ubWVudC12YXJpYWJsZXNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBlcnNpc3RFbnZWYXIobmFtZSwgdmFsdWUpIHtcbiAgICBjb25zdCBlbnZGaWxlID0gZ2V0RW52RmlsZVBhdGgoKTtcbiAgICBpZiAoZW52RmlsZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcInBlcnNpc3RFbnZWYXIgY2FuIG9ubHkgYmUgdXNlZCBpbiBTZXNzaW9uU3RhcnQgaG9va3MuIFwiICsgXCJDTEFVREVfRU5WX0ZJTEUgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgbm90IHNldC5cIik7XG4gICAgfVxuICAgIC8vIFNoZWxsLWVzY2FwZSB0aGUgdmFsdWUgdG8gaGFuZGxlIHNwZWNpYWwgY2hhcmFjdGVyc1xuICAgIGNvbnN0IGVzY2FwZWRWYWx1ZSA9IGVzY2FwZVNoZWxsVmFsdWUodmFsdWUpO1xuICAgIC8vIFdyaXRlIHRoZSBleHBvcnQgc3RhdGVtZW50XG4gICAgY29uc3QgZXhwb3J0U3RhdGVtZW50ID0gYGV4cG9ydCAke25hbWV9PSR7ZXNjYXBlZFZhbHVlfVxcbmA7XG4gICAgZnMuYXBwZW5kRmlsZVN5bmMoZW52RmlsZSwgZXhwb3J0U3RhdGVtZW50LCBcInV0Zi04XCIpO1xufVxuLyoqXG4gKiBQZXJzaXN0cyBtdWx0aXBsZSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgYXQgb25jZS5cbiAqXG4gKiBUaGlzIGlzIGEgY29udmVuaWVuY2Ugd3JhcHBlciBhcm91bmQgYHBlcnNpc3RFbnZWYXJgIGZvciBzZXR0aW5nXG4gKiBtdWx0aXBsZSB2YXJpYWJsZXMgaW4gYSBzaW5nbGUgY2FsbC5cbiAqIEBwYXJhbSB2YXJzIC0gT2JqZWN0IG1hcHBpbmcgdmFyaWFibGUgbmFtZXMgdG8gdmFsdWVzXG4gKiBAdGhyb3dzIEVycm9yIGlmIENMQVVERV9FTlZfRklMRSBpcyBub3Qgc2V0IChub3QgaW4gYSBTZXNzaW9uU3RhcnQgaG9vaylcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBwZXJzaXN0RW52VmFycyh7XG4gKiAgIE5PREVfRU5WOiAncHJvZHVjdGlvbicsXG4gKiAgIEFQSV9LRVk6ICdzZWNyZXQnLFxuICogICBERUJVRzogJ2ZhbHNlJ1xuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBlcnNpc3RFbnZWYXJzKHZhcnMpIHtcbiAgICBmb3IgKGNvbnN0IFtuYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXModmFycykpIHtcbiAgICAgICAgcGVyc2lzdEVudlZhcihuYW1lLCB2YWx1ZSk7XG4gICAgfVxufVxuLyoqXG4gKiBFc2NhcGVzIGEgdmFsdWUgZm9yIHNhZmUgdXNlIGluIGEgc2hlbGwgZXhwb3J0IHN0YXRlbWVudC5cbiAqXG4gKiBVc2VzIHNpbmdsZSBxdW90ZXMgYW5kIGVzY2FwZXMgYW55IGVtYmVkZGVkIHNpbmdsZSBxdW90ZXMuXG4gKiBUaGlzIHByZXZlbnRzIHNoZWxsIGluamVjdGlvbiBhbmQgaGFuZGxlcyBzcGVjaWFsIGNoYXJhY3RlcnMuXG4gKiBAcGFyYW0gdmFsdWUgLSBUaGUgdmFsdWUgdG8gZXNjYXBlXG4gKiBAcmV0dXJucyBUaGUgc2hlbGwtZXNjYXBlZCB2YWx1ZSAod2l0aCBxdW90ZXMpXG4gKiBAaW50ZXJuYWxcbiAqL1xuZnVuY3Rpb24gZXNjYXBlU2hlbGxWYWx1ZSh2YWx1ZSkge1xuICAgIC8vIFVzZSBzaW5nbGUgcXVvdGVzIGFuZCBlc2NhcGUgYW55IGVtYmVkZGVkIHNpbmdsZSBxdW90ZXNcbiAgICAvLyAndmFsdWUnIC0+ICd2YWwnXFwnJ3VlJyBmb3IgdmFsdWVzIGNvbnRhaW5pbmcgc2luZ2xlIHF1b3Rlc1xuICAgIGNvbnN0IGVzY2FwZWQgPSB2YWx1ZS5yZXBsYWNlKC8nL2csIFwiJ1xcXFwnJ1wiKTtcbiAgICByZXR1cm4gYCcke2VzY2FwZWR9J2A7XG59XG4iLCAiLyoqXG4gKiBIb29rIGZhY3RvcnkgZnVuY3Rpb25zIGZvciBDbGF1ZGUgQ29kZSBob29rcy5cbiAqXG4gKiBQcm92aWRlcyB0eXBlZCBmYWN0b3J5IGZ1bmN0aW9ucyBmb3IgYWxsIDEyIGhvb2sgdHlwZXMgdGhhdCBoYW5kbGU6XG4gKiAtIElucHV0IHR5cGUgbmFycm93aW5nIGJhc2VkIG9uIGhvb2sgZXZlbnQgdHlwZVxuICogLSBPdXRwdXQgdHlwZSBlbmZvcmNlbWVudCB2aWEgcmV0dXJuIHR5cGVzXG4gKiAtIEVycm9yIHdyYXBwaW5nIHdpdGggYXV0b21hdGljIGxvZ2dpbmdcbiAqIC0gTG9nZ2VyIGNvbnRleHQgaW5qZWN0aW9uXG4gKlxuICogRWFjaCBmYWN0b3J5IGFjY2VwdHMgYSBIb29rQ29uZmlnIHdpdGggb3B0aW9uYWwgbWF0Y2hlciBhbmQgdGltZW91dCBzZXR0aW5ncyxcbiAqIGFuZCByZXR1cm5zIGEgZnVuY3Rpb24gdGhhdCB0aGUgcnVudGltZSBpbnZva2VzIHdoZW4gdGhlIGhvb2sgZmlsZSBleGVjdXRlcy5cbiAqIEBtb2R1bGVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBwcmVUb29sVXNlSG9vaywgcHJlVG9vbFVzZU91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgcHJlVG9vbFVzZUhvb2soeyBtYXRjaGVyOiAnQmFzaCcgfSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdQcm9jZXNzaW5nIEJhc2ggY29tbWFuZCcpO1xuICogICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7IGFsbG93OiB0cnVlIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rc1xuICovXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBHZW5lcmljIEZhY3Rvcnlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhIGhvb2sgZmFjdG9yeSBmdW5jdGlvbiBmb3IgYSBzcGVjaWZpYyBob29rIHR5cGUuXG4gKlxuICogVGhpcyBpcyB0aGUgaW50ZXJuYWwgaW1wbGVtZW50YXRpb24gdXNlZCBieSBhbGwgdHlwZWQgZmFjdG9yaWVzLlxuICogSXQgd3JhcHMgdGhlIGhhbmRsZXIgd2l0aCBlcnJvciBjYXRjaGluZyBhbmQgbG9nZ2luZy5cbiAqIEBwYXJhbSBob29rRXZlbnROYW1lIC0gVGhlIGhvb2sgZXZlbnQgbmFtZVxuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvblxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byB3cmFwXG4gKiBAcmV0dXJucyBBIHdyYXBwZWQgaG9vayBmdW5jdGlvblxuICogQGludGVybmFsXG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZUhvb2tGdW5jdGlvbihob29rRXZlbnROYW1lLCBjb25maWcsIGhhbmRsZXIpIHtcbiAgICBjb25zdCBob29rRm4gPSBhc3luYyAoaW5wdXQsIGNvbnRleHQpID0+IHtcbiAgICAgICAgLy8gRGVsZWdhdGUgZXJyb3IgaGFuZGxpbmcgdG8gdGhlIHJ1bnRpbWUgLSBqdXN0IGV4ZWN1dGUgdGhlIGhhbmRsZXJcbiAgICAgICAgLy8gVGhlIHJ1bnRpbWUgd2lsbCBjYXRjaCBlcnJvcnMsIGxvZyB0aGVtLCBhbmQgcmV0dXJuIGFwcHJvcHJpYXRlIG91dHB1dFxuICAgICAgICByZXR1cm4gYXdhaXQgaGFuZGxlcihpbnB1dCwgY29udGV4dCk7XG4gICAgfTtcbiAgICAvLyBBdHRhY2ggbWV0YWRhdGEgZm9yIHJ1bnRpbWUgaW5zcGVjdGlvblxuICAgIGhvb2tGbi5ob29rRXZlbnROYW1lID0gaG9va0V2ZW50TmFtZTtcbiAgICBob29rRm4ubWF0Y2hlciA9IGNvbmZpZy5tYXRjaGVyO1xuICAgIGhvb2tGbi50aW1lb3V0ID0gY29uZmlnLnRpbWVvdXQ7XG4gICAgcmV0dXJuIGhvb2tGbjtcbn1cbi8qKiBAaW5oZXJpdGRvYyAqL1xuZXhwb3J0IGZ1bmN0aW9uIHByZVRvb2xVc2VIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJQcmVUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vKiogQGluaGVyaXRkb2MgKi9cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbFVzZUhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlBvc3RUb29sVXNlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vKiogQGluaGVyaXRkb2MgKi9cbmV4cG9ydCBmdW5jdGlvbiBwb3N0VG9vbFVzZUZhaWx1cmVIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJQb3N0VG9vbFVzZUZhaWx1cmVcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFBvc3RUb29sQmF0Y2ggSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBQb3N0VG9vbEJhdGNoIGhvb2sgaGFuZGxlci5cbiAqXG4gKiBQb3N0VG9vbEJhdGNoIGhvb2tzIGZpcmUgZXhhY3RseSBvbmNlIGFmdGVyIGV2ZXJ5IHRvb2wgY2FsbCBpbiBhIGJhdGNoIGhhc1xuICogcmVzb2x2ZWQsIGJlZm9yZSB0aGUgbmV4dCBtb2RlbCByZXF1ZXN0LiBVbmxpa2UgUG9zdFRvb2xVc2UgXHUyMDE0IHdoaWNoIGZpcmVzIHBlclxuICogdG9vbCBhbmQgbWF5IHJ1biBjb25jdXJyZW50bHkgZm9yIHBhcmFsbGVsIHRvb2wgY2FsbHMgXHUyMDE0IFBvc3RUb29sQmF0Y2ggcmVjZWl2ZXNcbiAqIHRoZSBmdWxsIGJhdGNoIHZpYSBgaW5wdXQudG9vbF9jYWxsc2AsIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gSW5zcGVjdCBvciBzdW1tYXJpemUgYWxsIHRvb2wgY2FsbHMgaW4gYSBzaW5nbGUgdHVybiB0b2dldGhlclxuICogLSBJbmplY3QgYWRkaXRpb25hbCBjb250ZXh0IG9uY2UgcGVyIGJhdGNoIGluc3RlYWQgb2Ygb25jZSBwZXIgdG9vbFxuICpcbiAqICoqTWF0Y2hlcioqOiBObyBtYXRjaGVyIHN1cHBvcnQgLSBmaXJlcyBvbmNlIHBlciBiYXRjaFxuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIHRpbWVvdXQgKG1hdGNoZXIgaXMgaWdub3JlZClcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHBvc3RUb29sQmF0Y2hIb29rLCBwb3N0VG9vbEJhdGNoT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiBleHBvcnQgZGVmYXVsdCBwb3N0VG9vbEJhdGNoSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdUb29sIGJhdGNoIGNvbXBsZXRlZCcsIHsgY291bnQ6IGlucHV0LnRvb2xfY2FsbHMubGVuZ3RoIH0pO1xuICpcbiAqICAgcmV0dXJuIHBvc3RUb29sQmF0Y2hPdXRwdXQoe1xuICogICAgIGhvb2tTcGVjaWZpY091dHB1dDoge1xuICogICAgICAgYWRkaXRpb25hbENvbnRleHQ6IGBSZXZpZXdlZCAke2lucHV0LnRvb2xfY2FsbHMubGVuZ3RofSB0b29sIGNhbGxzYFxuICogICAgIH1cbiAqICAgfSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3Bvc3R0b29sYmF0Y2hcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBvc3RUb29sQmF0Y2hIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJQb3N0VG9vbEJhdGNoXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBOb3RpZmljYXRpb24gSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBOb3RpZmljYXRpb24gaG9vayBoYW5kbGVyLlxuICpcbiAqIE5vdGlmaWNhdGlvbiBob29rcyBmaXJlIHdoZW4gQ2xhdWRlIENvZGUgc2VuZHMgYSBub3RpZmljYXRpb24sIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gRm9yd2FyZCBub3RpZmljYXRpb25zIHRvIGV4dGVybmFsIHN5c3RlbXNcbiAqIC0gTG9nIGltcG9ydGFudCBldmVudHNcbiAqIC0gVHJpZ2dlciBjdXN0b20gYWxlcnRpbmdcbiAqXG4gKiAqKk1hdGNoZXIqKjogTWF0Y2hlcyBhZ2FpbnN0IGBub3RpZmljYXRpb25fdHlwZWBcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCBtYXRjaGVyIGFuZCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBub3RpZmljYXRpb25Ib29rLCBub3RpZmljYXRpb25PdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIC8vIEZvcndhcmQgbm90aWZpY2F0aW9ucyB0byBTbGFja1xuICogZXhwb3J0IGRlZmF1bHQgbm90aWZpY2F0aW9uSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdOb3RpZmljYXRpb24gcmVjZWl2ZWQnLCB7XG4gKiAgICAgdHlwZTogaW5wdXQubm90aWZpY2F0aW9uX3R5cGUsXG4gKiAgICAgdGl0bGU6IGlucHV0LnRpdGxlXG4gKiAgIH0pO1xuICpcbiAqICAgYXdhaXQgc2VuZFNsYWNrTWVzc2FnZShpbnB1dC50aXRsZSA/PyAnTm90aWZpY2F0aW9uJywgaW5wdXQubWVzc2FnZSk7XG4gKlxuICogICByZXR1cm4gbm90aWZpY2F0aW9uT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3Mjbm90aWZpY2F0aW9uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3RpZmljYXRpb25Ib29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJOb3RpZmljYXRpb25cIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFVzZXJQcm9tcHRTdWJtaXQgSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBVc2VyUHJvbXB0U3VibWl0IGhvb2sgaGFuZGxlci5cbiAqXG4gKiBVc2VyUHJvbXB0U3VibWl0IGhvb2tzIGZpcmUgd2hlbiBhIHVzZXIgc3VibWl0cyBhIHByb21wdCwgYWxsb3dpbmcgeW91IHRvOlxuICogLSBBZGQgYWRkaXRpb25hbCBjb250ZXh0IG9yIGluc3RydWN0aW9uc1xuICogLSBMb2cgdXNlciBpbnRlcmFjdGlvbnNcbiAqIC0gVmFsaWRhdGUgb3IgdHJhbnNmb3JtIHByb21wdHNcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHByb21wdCBzdWJtaXNzaW9uc1xuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIHRpbWVvdXQgKG1hdGNoZXIgaXMgaWdub3JlZClcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHVzZXJQcm9tcHRTdWJtaXRIb29rLCB1c2VyUHJvbXB0U3VibWl0T3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBBZGQgcHJvamVjdCBjb250ZXh0IHRvIGV2ZXJ5IHByb21wdFxuICogZXhwb3J0IGRlZmF1bHQgdXNlclByb21wdFN1Ym1pdEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuZGVidWcoJ1VzZXIgcHJvbXB0IHN1Ym1pdHRlZCcsIHsgcHJvbXB0TGVuZ3RoOiBpbnB1dC5wcm9tcHQubGVuZ3RoIH0pO1xuICpcbiAqICAgY29uc3QgcHJvamVjdENvbnRleHQgPSBhd2FpdCBnZXRQcm9qZWN0Q29udGV4dCgpO1xuICpcbiAqICAgcmV0dXJuIHVzZXJQcm9tcHRTdWJtaXRPdXRwdXQoe1xuICogICAgIGFkZGl0aW9uYWxDb250ZXh0OiBwcm9qZWN0Q29udGV4dFxuICogICB9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjdXNlcnByb21wdHN1Ym1pdFxuICovXG5leHBvcnQgZnVuY3Rpb24gdXNlclByb21wdFN1Ym1pdEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlVzZXJQcm9tcHRTdWJtaXRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFVzZXJQcm9tcHRFeHBhbnNpb24gSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBVc2VyUHJvbXB0RXhwYW5zaW9uIGhvb2sgaGFuZGxlci5cbiAqXG4gKiBVc2VyUHJvbXB0RXhwYW5zaW9uIGhvb2tzIGZpcmUgd2hlbiBhIHVzZXIgcHJvbXB0IGlzIGV4cGFuZGVkIGZyb20gYSBzbGFzaFxuICogY29tbWFuZCBvciBNQ1AgcHJvbXB0LCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEFkZCBjb250ZXh0IGJhc2VkIG9uIHRoZSBjb21tYW5kIGJlaW5nIGludm9rZWRcbiAqIC0gTG9nIHNsYXNoIGNvbW1hbmQgYW5kIE1DUCBwcm9tcHQgdXNhZ2VcbiAqIC0gT2JzZXJ2ZSBwcm9tcHQgZXhwYW5zaW9uIGV2ZW50c1xuICpcbiAqICoqTWF0Y2hlcioqOiBObyBtYXRjaGVyIHN1cHBvcnQgLSBmaXJlcyBvbiBhbGwgcHJvbXB0IGV4cGFuc2lvbnNcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0IChtYXRjaGVyIGlzIGlnbm9yZWQpXG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyB1c2VyUHJvbXB0RXhwYW5zaW9uSG9vaywgdXNlclByb21wdEV4cGFuc2lvbk91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gQWRkIGNvbnRleHQgd2hlbiBhIHNsYXNoIGNvbW1hbmQgaXMgaW52b2tlZFxuICogZXhwb3J0IGRlZmF1bHQgdXNlclByb21wdEV4cGFuc2lvbkhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuZGVidWcoJ1Byb21wdCBleHBhbmRlZCcsIHsgdHlwZTogaW5wdXQuZXhwYW5zaW9uX3R5cGUsIGNvbW1hbmQ6IGlucHV0LmNvbW1hbmRfbmFtZSB9KTtcbiAqXG4gKiAgIHJldHVybiB1c2VyUHJvbXB0RXhwYW5zaW9uT3V0cHV0KHtcbiAqICAgICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiBgQ29tbWFuZDogJHtpbnB1dC5jb21tYW5kX25hbWV9YFxuICogICAgIH1cbiAqICAgfSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3VzZXJwcm9tcHRleHBhbnNpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVzZXJQcm9tcHRFeHBhbnNpb25Ib29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJVc2VyUHJvbXB0RXhwYW5zaW9uXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTZXNzaW9uU3RhcnQgSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBTZXNzaW9uU3RhcnQgaG9vayBoYW5kbGVyLlxuICpcbiAqIFNlc3Npb25TdGFydCBob29rcyBmaXJlIHdoZW4gYSBDbGF1ZGUgQ29kZSBzZXNzaW9uIHN0YXJ0cyBvciByZXN0YXJ0cyxcbiAqIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gSW5pdGlhbGl6ZSBzZXNzaW9uIHN0YXRlXG4gKiAtIEluamVjdCBjb250ZXh0IG9yIGluc3RydWN0aW9uc1xuICogLSBQZXJzaXN0IGVudmlyb25tZW50IHZhcmlhYmxlcyBmb3Igc3Vic2VxdWVudCBiYXNoIGNvbW1hbmRzXG4gKiAtIFNldCB1cCBsb2dnaW5nIG9yIG1vbml0b3JpbmdcbiAqXG4gKiAqKk1hdGNoZXIqKjogTWF0Y2hlcyBhZ2FpbnN0IGBzb3VyY2VgICgnc3RhcnR1cCcsICdyZXN1bWUnLCAnY2xlYXInLCAnY29tcGFjdCcpXG4gKlxuICogKipDb250ZXh0Kio6IFNlc3Npb25TdGFydCBob29rcyByZWNlaXZlIGFuIGV4dGVuZGVkIGNvbnRleHQgd2l0aCBgcGVyc2lzdEVudlZhcmBcbiAqIGFuZCBgcGVyc2lzdEVudlZhcnNgIGZ1bmN0aW9ucyBmb3Igc2V0dGluZyBlbnZpcm9ubWVudCB2YXJpYWJsZXMuXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgbWF0Y2hlciBhbmQgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgc2Vzc2lvblN0YXJ0SG9vaywgc2Vzc2lvblN0YXJ0T3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBQZXJzaXN0IGVudmlyb25tZW50IHZhcmlhYmxlcyBmb3IgdGhlIHNlc3Npb25cbiAqIGV4cG9ydCBkZWZhdWx0IHNlc3Npb25TdGFydEhvb2soeyBtYXRjaGVyOiAnc3RhcnR1cCcgfSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciwgcGVyc2lzdEVudlZhciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdOZXcgc2Vzc2lvbiBzdGFydGVkJywge1xuICogICAgIHNlc3Npb25JZDogaW5wdXQuc2Vzc2lvbl9pZCxcbiAqICAgICBjd2Q6IGlucHV0LmN3ZFxuICogICB9KTtcbiAqXG4gKiAgIC8vIFNldCBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZm9yIGFsbCBzdWJzZXF1ZW50IGJhc2ggY29tbWFuZHNcbiAqICAgcGVyc2lzdEVudlZhcignTk9ERV9FTlYnLCAnZGV2ZWxvcG1lbnQnKTtcbiAqICAgcGVyc2lzdEVudlZhcignREVCVUcnLCAndHJ1ZScpO1xuICpcbiAqICAgcmV0dXJuIHNlc3Npb25TdGFydE91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIFNldCBtdWx0aXBsZSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgYXQgb25jZVxuICogZXhwb3J0IGRlZmF1bHQgc2Vzc2lvblN0YXJ0SG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IHBlcnNpc3RFbnZWYXJzIH0pID0+IHtcbiAqICAgcGVyc2lzdEVudlZhcnMoe1xuICogICAgIE5PREVfRU5WOiAncHJvZHVjdGlvbicsXG4gKiAgICAgQVBJX0tFWTogJ3NlY3JldCcsXG4gKiAgICAgREVCVUc6ICdmYWxzZSdcbiAqICAgfSk7XG4gKlxuICogICByZXR1cm4gc2Vzc2lvblN0YXJ0T3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3Mjc2Vzc2lvbnN0YXJ0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXNzaW9uU3RhcnRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJTZXNzaW9uU3RhcnRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNlc3Npb25FbmQgSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBTZXNzaW9uRW5kIGhvb2sgaGFuZGxlci5cbiAqXG4gKiBTZXNzaW9uRW5kIGhvb2tzIGZpcmUgd2hlbiBhIENsYXVkZSBDb2RlIHNlc3Npb24gZW5kcywgYWxsb3dpbmcgeW91IHRvOlxuICogLSBDbGVhbiB1cCBzZXNzaW9uIHJlc291cmNlc1xuICogLSBMb2cgc2Vzc2lvbiBtZXRyaWNzXG4gKiAtIFBlcnNpc3Qgc2Vzc2lvbiBzdGF0ZVxuICpcbiAqICoqTWF0Y2hlcioqOiBNYXRjaGVzIGFnYWluc3QgYHJlYXNvbmAgKHRoZSBleGl0IHJlYXNvbiBzdHJpbmcpXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgbWF0Y2hlciBhbmQgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgc2Vzc2lvbkVuZEhvb2ssIHNlc3Npb25FbmRPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIC8vIExvZyBzZXNzaW9uIGVuZCBhbmQgY2xlYW4gdXBcbiAqIGV4cG9ydCBkZWZhdWx0IHNlc3Npb25FbmRIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ1Nlc3Npb24gZW5kZWQnLCB7XG4gKiAgICAgc2Vzc2lvbklkOiBpbnB1dC5zZXNzaW9uX2lkLFxuICogICAgIHJlYXNvbjogaW5wdXQucmVhc29uXG4gKiAgIH0pO1xuICpcbiAqICAgYXdhaXQgY2xlYW51cFNlc3Npb25SZXNvdXJjZXMoaW5wdXQuc2Vzc2lvbl9pZCk7XG4gKlxuICogICByZXR1cm4gc2Vzc2lvbkVuZE91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3Nlc3Npb25lbmRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25FbmRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJTZXNzaW9uRW5kXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTdG9wIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgU3RvcCBob29rIGhhbmRsZXIuXG4gKlxuICogU3RvcCBob29rcyBmaXJlIHdoZW4gQ2xhdWRlIENvZGUgaXMgYWJvdXQgdG8gc3RvcCwgYWxsb3dpbmcgeW91IHRvOlxuICogLSBCbG9jayB0aGUgc3RvcCBhbmQgcmVxdWlyZSBhZGRpdGlvbmFsIGFjdGlvblxuICogLSBDb25maXJtIHRoZSB1c2VyIHdhbnRzIHRvIHN0b3BcbiAqIC0gQ2xlYW4gdXAgcmVzb3VyY2VzIGJlZm9yZSBzdG9wcGluZ1xuICpcbiAqICoqTWF0Y2hlcioqOiBObyBtYXRjaGVyIHN1cHBvcnQgLSBmaXJlcyBvbiBhbGwgc3RvcCBldmVudHNcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0IChtYXRjaGVyIGlzIGlnbm9yZWQpXG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBzdG9wSG9vaywgc3RvcE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gQmxvY2sgc3RvcCBpZiB0aGVyZSBhcmUgcGVuZGluZyBjaGFuZ2VzXG4gKiBleHBvcnQgZGVmYXVsdCBzdG9wSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGNvbnN0IHBlbmRpbmdDaGFuZ2VzID0gYXdhaXQgY2hlY2tQZW5kaW5nQ2hhbmdlcygpO1xuICpcbiAqICAgaWYgKHBlbmRpbmdDaGFuZ2VzLmxlbmd0aCA+IDApIHtcbiAqICAgICBsb2dnZXIud2FybignQmxvY2tpbmcgc3RvcCBkdWUgdG8gcGVuZGluZyBjaGFuZ2VzJywge1xuICogICAgICAgY291bnQ6IHBlbmRpbmdDaGFuZ2VzLmxlbmd0aFxuICogICAgIH0pO1xuICpcbiAqICAgICByZXR1cm4gc3RvcE91dHB1dCh7XG4gKiAgICAgICBkZWNpc2lvbjogJ2Jsb2NrJyxcbiAqICAgICAgIHJlYXNvbjogYFRoZXJlIGFyZSAke3BlbmRpbmdDaGFuZ2VzLmxlbmd0aH0gdW5jb21taXR0ZWQgY2hhbmdlc2AsXG4gKiAgICAgICBzeXN0ZW1NZXNzYWdlOiAnUGxlYXNlIGNvbW1pdCBvciBkaXNjYXJkIGNoYW5nZXMgYmVmb3JlIHN0b3BwaW5nJ1xuICogICAgIH0pO1xuICogICB9XG4gKlxuICogICBsb2dnZXIuaW5mbygnQXBwcm92aW5nIHN0b3AnKTtcbiAqICAgcmV0dXJuIHN0b3BPdXRwdXQoeyBkZWNpc2lvbjogJ2FwcHJvdmUnIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNzdG9wXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdG9wSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiU3RvcFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU3RvcEZhaWx1cmUgSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBTdG9wRmFpbHVyZSBob29rIGhhbmRsZXIuXG4gKlxuICogU3RvcEZhaWx1cmUgaG9va3MgZmlyZSB3aGVuIENsYXVkZSBDb2RlIGVuY291bnRlcnMgYW4gZXJyb3Igd2hpbGUgc3RvcHBpbmdcbiAqIChlLmcuLCBBUEkgZXJyb3JzLCBhdXRoZW50aWNhdGlvbiBmYWlsdXJlcywgcmF0ZSBsaW1pdHMpLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIExvZyBzdG9wIGZhaWx1cmUgZXZlbnRzIGFuZCBlcnJvciBkZXRhaWxzXG4gKiAtIEFsZXJ0IG9uIHVuZXhwZWN0ZWQgc2Vzc2lvbiB0ZXJtaW5hdGlvbiBlcnJvcnNcbiAqIC0gT2JzZXJ2ZSB3aGF0IGVycm9yIGNhdXNlZCB0aGUgZmFpbHVyZVxuICpcbiAqICoqTWF0Y2hlcioqOiBObyBtYXRjaGVyIHN1cHBvcnQgLSBmaXJlcyBvbiBhbGwgc3RvcCBmYWlsdXJlIGV2ZW50c1xuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIHRpbWVvdXQgKG1hdGNoZXIgaXMgaWdub3JlZClcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHN0b3BGYWlsdXJlSG9vaywgc3RvcEZhaWx1cmVPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIGV4cG9ydCBkZWZhdWx0IHN0b3BGYWlsdXJlSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5lcnJvcignU2Vzc2lvbiBzdG9wcGVkIGR1ZSB0byBlcnJvcicsIHtcbiAqICAgICBlcnJvcjogaW5wdXQuZXJyb3IsXG4gKiAgICAgZGV0YWlsczogaW5wdXQuZXJyb3JfZGV0YWlsc1xuICogICB9KTtcbiAqICAgcmV0dXJuIHN0b3BGYWlsdXJlT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3Mjc3RvcGZhaWx1cmVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0b3BGYWlsdXJlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiU3RvcEZhaWx1cmVcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFN1YmFnZW50U3RhcnQgSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBTdWJhZ2VudFN0YXJ0IGhvb2sgaGFuZGxlci5cbiAqXG4gKiBTdWJhZ2VudFN0YXJ0IGhvb2tzIGZpcmUgd2hlbiBhIHN1YmFnZW50IChBZ2VudCB0b29sKSBzdGFydHMsIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gSW5qZWN0IGNvbnRleHQgZm9yIHRoZSBzdWJhZ2VudFxuICogLSBMb2cgc3ViYWdlbnQgaW52b2NhdGlvbnNcbiAqIC0gQ29uZmlndXJlIHN1YmFnZW50IGJlaGF2aW9yXG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgYWdlbnRfdHlwZWAgKGUuZy4sICdleHBsb3JlJywgJ2NvZGViYXNlLWFuYWx5c2lzJylcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCBtYXRjaGVyIGFuZCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBzdWJhZ2VudFN0YXJ0SG9vaywgc3ViYWdlbnRTdGFydE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gQWRkIGNvbnRleHQgZm9yIGV4cGxvcmUgc3ViYWdlbnRzXG4gKiBleHBvcnQgZGVmYXVsdCBzdWJhZ2VudFN0YXJ0SG9vayh7IG1hdGNoZXI6ICdleHBsb3JlJyB9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ0V4cGxvcmUgc3ViYWdlbnQgc3RhcnRpbmcnLCB7XG4gKiAgICAgYWdlbnRJZDogaW5wdXQuYWdlbnRfaWQsXG4gKiAgICAgYWdlbnRUeXBlOiBpbnB1dC5hZ2VudF90eXBlXG4gKiAgIH0pO1xuICpcbiAqICAgcmV0dXJuIHN1YmFnZW50U3RhcnRPdXRwdXQoe1xuICogICAgIGFkZGl0aW9uYWxDb250ZXh0OiAnRm9jdXMgb24gZmluZGluZyBwYXR0ZXJucyBhbmQgY29udmVudGlvbnMnXG4gKiAgIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNzdWJhZ2VudHN0YXJ0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdWJhZ2VudFN0YXJ0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiU3ViYWdlbnRTdGFydFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU3ViYWdlbnRTdG9wIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgU3ViYWdlbnRTdG9wIGhvb2sgaGFuZGxlci5cbiAqXG4gKiBTdWJhZ2VudFN0b3AgaG9va3MgZmlyZSB3aGVuIGEgc3ViYWdlbnQgY29tcGxldGVzIG9yIHN0b3BzLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIEJsb2NrIHRoZSBzdWJhZ2VudCBmcm9tIHN0b3BwaW5nXG4gKiAtIFByb2Nlc3Mgc3ViYWdlbnQgcmVzdWx0c1xuICogLSBDbGVhbiB1cCBzdWJhZ2VudCByZXNvdXJjZXNcbiAqIC0gTG9nIHN1YmFnZW50IGNvbXBsZXRpb25cbiAqXG4gKiAqKk1hdGNoZXIqKjogTWF0Y2hlcyBhZ2FpbnN0IGBhZ2VudF90eXBlYCAoZS5nLiwgJ2V4cGxvcmUnLCAnY29kZWJhc2UtYW5hbHlzaXMnKVxuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIG1hdGNoZXIgYW5kIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHN1YmFnZW50U3RvcEhvb2ssIHN1YmFnZW50U3RvcE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gQmxvY2sgZXhwbG9yZSBzdWJhZ2VudHMgaWYgdGFzayBpbmNvbXBsZXRlXG4gKiBleHBvcnQgZGVmYXVsdCBzdWJhZ2VudFN0b3BIb29rKHsgbWF0Y2hlcjogJ2V4cGxvcmUnIH0sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnU3ViYWdlbnQgc3RvcHBpbmcnLCB7XG4gKiAgICAgYWdlbnRJZDogaW5wdXQuYWdlbnRfaWQsXG4gKiAgICAgYWdlbnRUeXBlOiBpbnB1dC5hZ2VudF90eXBlXG4gKiAgIH0pO1xuICpcbiAqICAgLy8gQmxvY2sgaWYgdHJhbnNjcmlwdCBzaG93cyBpbmNvbXBsZXRlIHdvcmtcbiAqICAgcmV0dXJuIHN1YmFnZW50U3RvcE91dHB1dCh7XG4gKiAgICAgZGVjaXNpb246ICdibG9jaycsXG4gKiAgICAgcmVhc29uOiAnUGxlYXNlIHZlcmlmeSBleHBsb3JhdGlvbiBpcyBjb21wbGV0ZSdcbiAqICAgfSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3N1YmFnZW50c3RvcFxuICovXG5leHBvcnQgZnVuY3Rpb24gc3ViYWdlbnRTdG9wSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiU3ViYWdlbnRTdG9wXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBQcmVDb21wYWN0IEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgUHJlQ29tcGFjdCBob29rIGhhbmRsZXIuXG4gKlxuICogUHJlQ29tcGFjdCBob29rcyBmaXJlIGJlZm9yZSBjb250ZXh0IGNvbXBhY3Rpb24gb2NjdXJzLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIFByZXNlcnZlIGltcG9ydGFudCBpbmZvcm1hdGlvbiBiZWZvcmUgY29tcGFjdGlvblxuICogLSBMb2cgY29tcGFjdGlvbiBldmVudHNcbiAqIC0gTW9kaWZ5IGN1c3RvbSBpbnN0cnVjdGlvbnMgZm9yIHRoZSBjb21wYWN0ZWQgY29udGV4dFxuICpcbiAqICoqTWF0Y2hlcioqOiBNYXRjaGVzIGFnYWluc3QgYHRyaWdnZXJgICgnbWFudWFsJywgJ2F1dG8nKVxuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIG1hdGNoZXIgYW5kIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHByZUNvbXBhY3RIb29rLCBwcmVDb21wYWN0T3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBMb2cgY29tcGFjdGlvbiBldmVudHMgYW5kIHByZXNlcnZlIGNvbnRleHRcbiAqIGV4cG9ydCBkZWZhdWx0IHByZUNvbXBhY3RIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ0NvbnRleHQgY29tcGFjdGlvbiB0cmlnZ2VyZWQnLCB7XG4gKiAgICAgdHJpZ2dlcjogaW5wdXQudHJpZ2dlcixcbiAqICAgICBoYXNDdXN0b21JbnN0cnVjdGlvbnM6IGlucHV0LmN1c3RvbV9pbnN0cnVjdGlvbnMgIT09IG51bGxcbiAqICAgfSk7XG4gKlxuICogICByZXR1cm4gcHJlQ29tcGFjdE91dHB1dCh7XG4gKiAgICAgc3lzdGVtTWVzc2FnZTogJ1JlbWVtYmVyOiBzdHJpY3QgbW9kZSBpcyBlbmFibGVkJ1xuICogICB9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gT25seSBoYW5kbGUgbWFudWFsIGNvbXBhY3Rpb25cbiAqIGV4cG9ydCBkZWZhdWx0IHByZUNvbXBhY3RIb29rKHsgbWF0Y2hlcjogJ21hbnVhbCcgfSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdNYW51YWwgY29tcGFjdGlvbiByZXF1ZXN0ZWQnKTtcbiAqICAgcmV0dXJuIHByZUNvbXBhY3RPdXRwdXQoe30pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNwcmVjb21wYWN0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwcmVDb21wYWN0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiUHJlQ29tcGFjdFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gUG9zdENvbXBhY3QgSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBQb3N0Q29tcGFjdCBob29rIGhhbmRsZXIuXG4gKlxuICogUG9zdENvbXBhY3QgaG9va3MgZmlyZSBhZnRlciBjb250ZXh0IGNvbXBhY3Rpb24gY29tcGxldGVzLCBhbGxvd2luZyB5b3UgdG86XG4gKiAtIE9ic2VydmUgdGhlIGNvbXBhY3Rpb24gc3VtbWFyeSBhbmQgZGV0YWlsc1xuICogLSBMb2cgY29tcGFjdGlvbiBldmVudHNcbiAqIC0gUmVhY3QgdG8gdGhlIG5ldyBjb21wYWN0ZWQgc3RhdGVcbiAqXG4gKiAqKk1hdGNoZXIqKjogTWF0Y2hlcyBhZ2FpbnN0IGB0cmlnZ2VyYCAoJ21hbnVhbCcsICdhdXRvJylcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCBtYXRjaGVyIGFuZCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBwb3N0Q29tcGFjdEhvb2ssIHBvc3RDb21wYWN0T3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiBleHBvcnQgZGVmYXVsdCBwb3N0Q29tcGFjdEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnQ29udGV4dCBjb21wYWN0aW9uIGNvbXBsZXRlZCcsIHtcbiAqICAgICB0cmlnZ2VyOiBpbnB1dC50cmlnZ2VyLFxuICogICAgIHN1bW1hcnk6IGlucHV0LmNvbXBhY3Rfc3VtbWFyeVxuICogICB9KTtcbiAqICAgcmV0dXJuIHBvc3RDb21wYWN0T3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjcG9zdGNvbXBhY3RcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBvc3RDb21wYWN0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiUG9zdENvbXBhY3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8qKiBAaW5oZXJpdGRvYyAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBlcm1pc3Npb25SZXF1ZXN0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiUGVybWlzc2lvblJlcXVlc3RcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFBlcm1pc3Npb25EZW5pZWQgSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBQZXJtaXNzaW9uRGVuaWVkIGhvb2sgaGFuZGxlci5cbiAqXG4gKiBQZXJtaXNzaW9uRGVuaWVkIGhvb2tzIGZpcmUgd2hlbiBhIHBlcm1pc3Npb24gcmVxdWVzdCBpcyBkZW5pZWQgKGVpdGhlciBieSB0aGVcbiAqIHVzZXIgb3IgYnkgYSBQZXJtaXNzaW9uUmVxdWVzdCBob29rKSwgYWxsb3dpbmcgeW91IHRvOlxuICogLSBMb2cgcGVybWlzc2lvbiBkZW5pYWxzIGZvciBhdWRpdGluZ1xuICogLSBSZWFjdCB0byBkZW5pZWQgdG9vbCBleGVjdXRpb25zXG4gKiAtIE9wdGlvbmFsbHkgcmVxdWVzdCBhIHJldHJ5IHZpYSB0aGUgb3V0cHV0XG4gKlxuICogKipNYXRjaGVyKio6IE1hdGNoZXMgYWdhaW5zdCBgdG9vbF9uYW1lYFxuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIG1hdGNoZXIgYW5kIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IHBlcm1pc3Npb25EZW5pZWRIb29rLCBwZXJtaXNzaW9uRGVuaWVkT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBMb2cgYWxsIHBlcm1pc3Npb24gZGVuaWFsc1xuICogZXhwb3J0IGRlZmF1bHQgcGVybWlzc2lvbkRlbmllZEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIud2FybignUGVybWlzc2lvbiBkZW5pZWQnLCB7XG4gKiAgICAgdG9vbE5hbWU6IGlucHV0LnRvb2xfbmFtZSxcbiAqICAgICByZWFzb246IGlucHV0LnJlYXNvblxuICogICB9KTtcbiAqICAgcmV0dXJuIHBlcm1pc3Npb25EZW5pZWRPdXRwdXQoe30pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNwZXJtaXNzaW9uZGVuaWVkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwZXJtaXNzaW9uRGVuaWVkSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiUGVybWlzc2lvbkRlbmllZFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gU2V0dXAgSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBTZXR1cCBob29rIGhhbmRsZXIuXG4gKlxuICogU2V0dXAgaG9va3MgZmlyZSBkdXJpbmcgaW5pdGlhbGl6YXRpb24gb3IgbWFpbnRlbmFuY2UsIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gQ29uZmlndXJlIGluaXRpYWwgc2Vzc2lvbiBzdGF0ZVxuICogLSBQZXJmb3JtIHNldHVwIHRhc2tzIGJlZm9yZSB0aGUgc2Vzc2lvbiBzdGFydHNcbiAqIC0gQWRkIGNvbnRleHQgZm9yIG1haW50ZW5hbmNlIG9wZXJhdGlvbnNcbiAqXG4gKiAqKk1hdGNoZXIqKjogTWF0Y2hlcyBhZ2FpbnN0IGB0cmlnZ2VyYCAoJ2luaXQnIG9yICdtYWludGVuYW5jZScpXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgbWF0Y2hlciBhbmQgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgc2V0dXBIb29rLCBzZXR1cE91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogLy8gSGFuZGxlIGFsbCBzZXR1cCBldmVudHNcbiAqIGV4cG9ydCBkZWZhdWx0IHNldHVwSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdTZXR1cCB0cmlnZ2VyZWQnLCB7IHRyaWdnZXI6IGlucHV0LnRyaWdnZXIgfSk7XG4gKiAgIHJldHVybiBzZXR1cE91dHB1dCh7fSk7XG4gKiB9KTtcbiAqXG4gKiAvLyBPbmx5IGhhbmRsZSBpbml0aWFsaXphdGlvblxuICogZXhwb3J0IGRlZmF1bHQgc2V0dXBIb29rKHsgbWF0Y2hlcjogJ2luaXQnIH0sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnSW5pdGlhbGl6aW5nIHNlc3Npb24nKTtcbiAqICAgcmV0dXJuIHNldHVwT3V0cHV0KHtcbiAqICAgICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICAgIGFkZGl0aW9uYWxDb250ZXh0OiAnU2Vzc2lvbiBpbml0aWFsaXplZCB3aXRoIGN1c3RvbSBjb25maWd1cmF0aW9uJ1xuICogICAgIH1cbiAqICAgfSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3NldHVwXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXR1cEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlNldHVwXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBUZWFtbWF0ZUlkbGUgSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBUZWFtbWF0ZUlkbGUgaG9vayBoYW5kbGVyLlxuICpcbiAqIFRlYW1tYXRlSWRsZSBob29rcyBmaXJlIHdoZW4gYSB0ZWFtbWF0ZSBpbiBhIHRlYW0gaXMgYWJvdXQgdG8gZ28gaWRsZSxcbiAqIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gQXNzaWduIHdvcmsgdG8gaWRsZSB0ZWFtbWF0ZXNcbiAqIC0gTG9nIHRlYW0gYWN0aXZpdHlcbiAqIC0gQ29vcmRpbmF0ZSBtdWx0aS1hZ2VudCB3b3JrZmxvd3NcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIHRlYW1tYXRlIGlkbGUgZXZlbnRzXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dCAobWF0Y2hlciBpcyBpZ25vcmVkKVxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgdGVhbW1hdGVJZGxlSG9vaywgdGVhbW1hdGVJZGxlT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBMb2cgd2hlbiB0ZWFtbWF0ZXMgZ28gaWRsZVxuICogZXhwb3J0IGRlZmF1bHQgdGVhbW1hdGVJZGxlSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdUZWFtbWF0ZSBnb2luZyBpZGxlJywge1xuICogICAgIHRlYW1tYXRlTmFtZTogaW5wdXQudGVhbW1hdGVfbmFtZSxcbiAqICAgICB0ZWFtTmFtZTogaW5wdXQudGVhbV9uYW1lXG4gKiAgIH0pO1xuICpcbiAqICAgcmV0dXJuIHRlYW1tYXRlSWRsZU91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3RlYW1tYXRlaWRsZVxuICovXG5leHBvcnQgZnVuY3Rpb24gdGVhbW1hdGVJZGxlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiVGVhbW1hdGVJZGxlXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBUYXNrQ3JlYXRlZCBIb29rIEZhY3Rvcnlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhIFRhc2tDcmVhdGVkIGhvb2sgaGFuZGxlci5cbiAqXG4gKiBUYXNrQ3JlYXRlZCBob29rcyBmaXJlIHdoZW4gYSBuZXcgdGFzayBpcyBjcmVhdGVkIGFuZCBhc3NpZ25lZCB0byBhIHRlYW1tYXRlLFxuICogYWxsb3dpbmcgeW91IHRvOlxuICogLSBPYnNlcnZlIHRhc2sgY3JlYXRpb24gZXZlbnRzXG4gKiAtIExvZyB0YXNrIGFzc2lnbm1lbnRzIGZvciBhdWRpdGluZ1xuICogLSBSZWFjdCB0byBuZXcgd29yayBiZWluZyBhc3NpZ25lZFxuICpcbiAqICoqTWF0Y2hlcioqOiBObyBtYXRjaGVyIHN1cHBvcnQgLSBmaXJlcyBvbiBhbGwgdGFzayBjcmVhdGlvbiBldmVudHNcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0IChtYXRjaGVyIGlzIGlnbm9yZWQpXG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyB0YXNrQ3JlYXRlZEhvb2ssIHRhc2tDcmVhdGVkT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBMb2cgdGFzayBjcmVhdGlvblxuICogZXhwb3J0IGRlZmF1bHQgdGFza0NyZWF0ZWRIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ1Rhc2sgY3JlYXRlZCcsIHtcbiAqICAgICB0YXNrSWQ6IGlucHV0LnRhc2tfaWQsXG4gKiAgICAgdGFza1N1YmplY3Q6IGlucHV0LnRhc2tfc3ViamVjdFxuICogICB9KTtcbiAqXG4gKiAgIHJldHVybiB0YXNrQ3JlYXRlZE91dHB1dCh7fSk7XG4gKiB9KTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI3Rhc2tjcmVhdGVkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0YXNrQ3JlYXRlZEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIlRhc2tDcmVhdGVkXCIsIGNvbmZpZywgaGFuZGxlcik7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBUYXNrQ29tcGxldGVkIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGEgVGFza0NvbXBsZXRlZCBob29rIGhhbmRsZXIuXG4gKlxuICogVGFza0NvbXBsZXRlZCBob29rcyBmaXJlIHdoZW4gYSB0YXNrIGlzIGJlaW5nIG1hcmtlZCBhcyBjb21wbGV0ZWQsXG4gKiBhbGxvd2luZyB5b3UgdG86XG4gKiAtIFZlcmlmeSB0YXNrIGNvbXBsZXRpb25cbiAqIC0gTG9nIHRhc2sgbWV0cmljc1xuICogLSBUcmlnZ2VyIGZvbGxvdy11cCBhY3Rpb25zXG4gKlxuICogKipNYXRjaGVyKio6IE5vIG1hdGNoZXIgc3VwcG9ydCAtIGZpcmVzIG9uIGFsbCB0YXNrIGNvbXBsZXRpb24gZXZlbnRzXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dCAobWF0Y2hlciBpcyBpZ25vcmVkKVxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgdGFza0NvbXBsZXRlZEhvb2ssIHRhc2tDb21wbGV0ZWRPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIC8vIExvZyB0YXNrIGNvbXBsZXRpb25cbiAqIGV4cG9ydCBkZWZhdWx0IHRhc2tDb21wbGV0ZWRIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ1Rhc2sgY29tcGxldGVkJywge1xuICogICAgIHRhc2tJZDogaW5wdXQudGFza19pZCxcbiAqICAgICB0YXNrU3ViamVjdDogaW5wdXQudGFza19zdWJqZWN0XG4gKiAgIH0pO1xuICpcbiAqICAgcmV0dXJuIHRhc2tDb21wbGV0ZWRPdXRwdXQoe30pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyN0YXNrY29tcGxldGVkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0YXNrQ29tcGxldGVkSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiVGFza0NvbXBsZXRlZFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRWxpY2l0YXRpb24gSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYW4gRWxpY2l0YXRpb24gaG9vayBoYW5kbGVyLlxuICpcbiAqIEVsaWNpdGF0aW9uIGhvb2tzIGZpcmUgd2hlbiBhbiBNQ1Agc2VydmVyIHJlcXVlc3RzIHVzZXIgaW5wdXQsIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gQWNjZXB0LCBkZWNsaW5lLCBvciBjYW5jZWwgZWxpY2l0YXRpb24gcmVxdWVzdHMgcHJvZ3JhbW1hdGljYWxseVxuICogLSBQcm92aWRlIHN0cnVjdHVyZWQgZm9ybSBpbnB1dCBvciBVUkwtYmFzZWQgYXV0aCByZXNwb25zZXNcbiAqIC0gTG9nIG9yIGF1ZGl0IGVsaWNpdGF0aW9uIHJlcXVlc3RzXG4gKlxuICogKipNYXRjaGVyKio6IE5vIG1hdGNoZXIgc3VwcG9ydCAtIGZpcmVzIG9uIGFsbCBlbGljaXRhdGlvbiBldmVudHNcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBlbGljaXRhdGlvbkhvb2ssIGVsaWNpdGF0aW9uT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiBleHBvcnQgZGVmYXVsdCBlbGljaXRhdGlvbkhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnRWxpY2l0YXRpb24gcmVxdWVzdCcsIHsgc2VydmVyOiBpbnB1dC5tY3Bfc2VydmVyX25hbWUgfSk7XG4gKiAgIHJldHVybiBlbGljaXRhdGlvbk91dHB1dCh7XG4gKiAgICAgaG9va1NwZWNpZmljT3V0cHV0OiB7IGFjdGlvbjogJ2FjY2VwdCcsIGNvbnRlbnQ6IHsgYXBwcm92ZWQ6IHRydWUgfSB9XG4gKiAgIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNlbGljaXRhdGlvblxuICovXG5leHBvcnQgZnVuY3Rpb24gZWxpY2l0YXRpb25Ib29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJFbGljaXRhdGlvblwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRWxpY2l0YXRpb25SZXN1bHQgSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYW4gRWxpY2l0YXRpb25SZXN1bHQgaG9vayBoYW5kbGVyLlxuICpcbiAqIEVsaWNpdGF0aW9uUmVzdWx0IGhvb2tzIGZpcmUgd2l0aCB0aGUgcmVzdWx0IG9mIGFuIE1DUCBlbGljaXRhdGlvbiByZXF1ZXN0LFxuICogYWxsb3dpbmcgeW91IHRvOlxuICogLSBPYnNlcnZlIGVsaWNpdGF0aW9uIG91dGNvbWVzXG4gKiAtIE1vZGlmeSB0aGUgcmVzdWx0IGJlZm9yZSBpdCBpcyByZXR1cm5lZCB0byB0aGUgTUNQIHNlcnZlclxuICogLSBMb2cgZWxpY2l0YXRpb24gY29tcGxldGlvbnNcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIGVsaWNpdGF0aW9uIHJlc3VsdCBldmVudHNcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBlbGljaXRhdGlvblJlc3VsdEhvb2ssIGVsaWNpdGF0aW9uUmVzdWx0T3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiBleHBvcnQgZGVmYXVsdCBlbGljaXRhdGlvblJlc3VsdEhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnRWxpY2l0YXRpb24gcmVzdWx0JywgeyBhY3Rpb246IGlucHV0LmFjdGlvbiB9KTtcbiAqICAgcmV0dXJuIGVsaWNpdGF0aW9uUmVzdWx0T3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3MjZWxpY2l0YXRpb25yZXN1bHRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVsaWNpdGF0aW9uUmVzdWx0SG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiRWxpY2l0YXRpb25SZXN1bHRcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIENvbmZpZ0NoYW5nZSBIb29rIEZhY3Rvcnlcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogQ3JlYXRlcyBhIENvbmZpZ0NoYW5nZSBob29rIGhhbmRsZXIuXG4gKlxuICogQ29uZmlnQ2hhbmdlIGhvb2tzIGZpcmUgd2hlbiBDbGF1ZGUgQ29kZSBjb25maWd1cmF0aW9uIGNoYW5nZXMsIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gUmVhY3QgdG8gc2V0dGluZ3MgZmlsZSBjaGFuZ2VzXG4gKiAtIExvZyBvciBhdWRpdCBjb25maWd1cmF0aW9uIGNoYW5nZXNcbiAqIC0gQXBwbHkgY3VzdG9tIGxvZ2ljIHdoZW4gc2V0dGluZ3MgYXJlIHVwZGF0ZWRcbiAqXG4gKiAqKk1hdGNoZXIqKjogTWF0Y2hlcyBhZ2FpbnN0IGBzb3VyY2VgICgndXNlcl9zZXR0aW5ncycsICdwcm9qZWN0X3NldHRpbmdzJywgZXRjLilcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCBtYXRjaGVyIGFuZCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBjb25maWdDaGFuZ2VIb29rLCBjb25maWdDaGFuZ2VPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIGV4cG9ydCBkZWZhdWx0IGNvbmZpZ0NoYW5nZUhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnQ29uZmlnIGNoYW5nZWQnLCB7IHNvdXJjZTogaW5wdXQuc291cmNlLCBmaWxlOiBpbnB1dC5maWxlX3BhdGggfSk7XG4gKiAgIHJldHVybiBjb25maWdDaGFuZ2VPdXRwdXQoe30pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNjb25maWdjaGFuZ2VcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbmZpZ0NoYW5nZUhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIkNvbmZpZ0NoYW5nZVwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gSW5zdHJ1Y3Rpb25zTG9hZGVkIEhvb2sgRmFjdG9yeVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGFuIEluc3RydWN0aW9uc0xvYWRlZCBob29rIGhhbmRsZXIuXG4gKlxuICogSW5zdHJ1Y3Rpb25zTG9hZGVkIGhvb2tzIGZpcmUgd2hlbiBhIENMQVVERS5tZCBvciBzaW1pbGFyIGluc3RydWN0aW9ucyBmaWxlXG4gKiBpcyBsb2FkZWQsIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gUmVhY3QgdG8gaW5zdHJ1Y3Rpb25zIGJlaW5nIGFwcGxpZWRcbiAqIC0gTG9nIHdoaWNoIGluc3RydWN0aW9uIGZpbGVzIGFyZSBhY3RpdmVcbiAqIC0gT2JzZXJ2ZSB0aGUgaW5zdHJ1Y3Rpb24gbG9hZGluZyBoaWVyYXJjaHlcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIGluc3RydWN0aW9uIGxvYWQgZXZlbnRzXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgaW5zdHJ1Y3Rpb25zTG9hZGVkSG9vaywgaW5zdHJ1Y3Rpb25zTG9hZGVkT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiBleHBvcnQgZGVmYXVsdCBpbnN0cnVjdGlvbnNMb2FkZWRIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ0luc3RydWN0aW9ucyBsb2FkZWQnLCB7IGZpbGU6IGlucHV0LmZpbGVfcGF0aCwgdHlwZTogaW5wdXQubWVtb3J5X3R5cGUgfSk7XG4gKiAgIHJldHVybiBpbnN0cnVjdGlvbnNMb2FkZWRPdXRwdXQoe30pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNpbnN0cnVjdGlvbnNsb2FkZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGluc3RydWN0aW9uc0xvYWRlZEhvb2soY29uZmlnLCBoYW5kbGVyKSB7XG4gICAgcmV0dXJuIGNyZWF0ZUhvb2tGdW5jdGlvbihcIkluc3RydWN0aW9uc0xvYWRlZFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gV29ya3RyZWVDcmVhdGUgSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBXb3JrdHJlZUNyZWF0ZSBob29rIGhhbmRsZXIuXG4gKlxuICogV29ya3RyZWVDcmVhdGUgaG9va3MgZmlyZSB3aGVuIGEgZ2l0IHdvcmt0cmVlIGlzIGNyZWF0ZWQsIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gU2V0IHVwIHdvcmt0cmVlLXNwZWNpZmljIGNvbmZpZ3VyYXRpb25cbiAqIC0gTG9nIHdvcmt0cmVlIGNyZWF0aW9uIGV2ZW50c1xuICogLSBJbml0aWFsaXplIHdvcmt0cmVlIHJlc291cmNlc1xuICpcbiAqICoqTWF0Y2hlcioqOiBObyBtYXRjaGVyIHN1cHBvcnQgLSBmaXJlcyBvbiBhbGwgd29ya3RyZWUgY3JlYXRpb24gZXZlbnRzXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgd29ya3RyZWVDcmVhdGVIb29rLCB3b3JrdHJlZUNyZWF0ZU91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgd29ya3RyZWVDcmVhdGVIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgY29uc3Qgd29ya3RyZWVQYXRoID0gYCR7aW5wdXQuY3dkfS8ud29ya3RyZWVzLyR7aW5wdXQubmFtZX1gO1xuICogICBsb2dnZXIuaW5mbygnV29ya3RyZWUgY3JlYXRlZCcsIHsgbmFtZTogaW5wdXQubmFtZSwgd29ya3RyZWVQYXRoIH0pO1xuICogICAvLyBXb3JrdHJlZUNyZWF0ZSBpcyBhIGNvbW1hbmQgaG9vazogdGhlIHBhdGggaXMgd3JpdHRlbiB0byBzdGRvdXQgYXMgcGxhaW4gdGV4dC5cbiAqICAgcmV0dXJuIHdvcmt0cmVlQ3JlYXRlT3V0cHV0KHsgd29ya3RyZWVQYXRoIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyN3b3JrdHJlZWNyZWF0ZVxuICovXG5leHBvcnQgZnVuY3Rpb24gd29ya3RyZWVDcmVhdGVIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJXb3JrdHJlZUNyZWF0ZVwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gV29ya3RyZWVSZW1vdmUgSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBXb3JrdHJlZVJlbW92ZSBob29rIGhhbmRsZXIuXG4gKlxuICogV29ya3RyZWVSZW1vdmUgaG9va3MgZmlyZSB3aGVuIGEgZ2l0IHdvcmt0cmVlIGlzIHJlbW92ZWQsIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gQ2xlYW4gdXAgd29ya3RyZWUtc3BlY2lmaWMgcmVzb3VyY2VzXG4gKiAtIExvZyB3b3JrdHJlZSByZW1vdmFsIGV2ZW50c1xuICpcbiAqICoqTWF0Y2hlcioqOiBObyBtYXRjaGVyIHN1cHBvcnQgLSBmaXJlcyBvbiBhbGwgd29ya3RyZWUgcmVtb3ZhbCBldmVudHNcbiAqIEBwYXJhbSBjb25maWcgLSBIb29rIGNvbmZpZ3VyYXRpb24gd2l0aCBvcHRpb25hbCB0aW1lb3V0XG4gKiBAcGFyYW0gaGFuZGxlciAtIFRoZSBoYW5kbGVyIGZ1bmN0aW9uIHRvIGV4ZWN1dGVcbiAqIEByZXR1cm5zIEEgaG9vayBmdW5jdGlvbiB0aGF0IGNhbiBiZSBleHBvcnRlZCBhcyB0aGUgZGVmYXVsdCBleHBvcnRcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyB3b3JrdHJlZVJlbW92ZUhvb2ssIHdvcmt0cmVlUmVtb3ZlT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiBleHBvcnQgZGVmYXVsdCB3b3JrdHJlZVJlbW92ZUhvb2soe30sIGFzeW5jIChpbnB1dCwgeyBsb2dnZXIgfSkgPT4ge1xuICogICBsb2dnZXIuaW5mbygnV29ya3RyZWUgcmVtb3ZlZCcsIHsgcGF0aDogaW5wdXQud29ya3RyZWVfcGF0aCB9KTtcbiAqICAgcmV0dXJuIHdvcmt0cmVlUmVtb3ZlT3V0cHV0KHt9KTtcbiAqIH0pO1xuICogYGBgXG4gKiBAc2VlIGh0dHBzOi8vY29kZS5jbGF1ZGUuY29tL2RvY3MvZW4vaG9va3Mjd29ya3RyZWVyZW1vdmVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHdvcmt0cmVlUmVtb3ZlSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiV29ya3RyZWVSZW1vdmVcIiwgY29uZmlnLCBoYW5kbGVyKTtcbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEN3ZENoYW5nZWQgSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBDd2RDaGFuZ2VkIGhvb2sgaGFuZGxlci5cbiAqXG4gKiBDd2RDaGFuZ2VkIGhvb2tzIGZpcmUgd2hlbiBDbGF1ZGUgQ29kZSdzIGN1cnJlbnQgd29ya2luZyBkaXJlY3RvcnkgY2hhbmdlcyxcbiAqIGFsbG93aW5nIHlvdSB0bzpcbiAqIC0gUmVhY3QgdG8gZGlyZWN0b3J5IGNoYW5nZXMgd2l0aGluIGEgc2Vzc2lvblxuICogLSBVcGRhdGUgZmlsZSB3YXRjaGVycyBvciBlbnZpcm9ubWVudCBzdGF0ZVxuICogLSBSZXR1cm4gYHdhdGNoUGF0aHNgIHZpYSBgaG9va1NwZWNpZmljT3V0cHV0YCB0byByZWdpc3RlciBwYXRocyBmb3IgRmlsZUNoYW5nZWQgZXZlbnRzXG4gKlxuICogKipNYXRjaGVyKio6IE5vIG1hdGNoZXIgc3VwcG9ydCAtIGZpcmVzIG9uIGFsbCBjd2QgY2hhbmdlIGV2ZW50c1xuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IGN3ZENoYW5nZWRIb29rLCBjd2RDaGFuZ2VkT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiBleHBvcnQgZGVmYXVsdCBjd2RDaGFuZ2VkSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdXb3JraW5nIGRpcmVjdG9yeSBjaGFuZ2VkJywgeyBmcm9tOiBpbnB1dC5vbGRfY3dkLCB0bzogaW5wdXQubmV3X2N3ZCB9KTtcbiAqICAgcmV0dXJuIGN3ZENoYW5nZWRPdXRwdXQoe30pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNjd2RjaGFuZ2VkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjd2RDaGFuZ2VkSG9vayhjb25maWcsIGhhbmRsZXIpIHtcbiAgICByZXR1cm4gY3JlYXRlSG9va0Z1bmN0aW9uKFwiQ3dkQ2hhbmdlZFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gRmlsZUNoYW5nZWQgSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBGaWxlQ2hhbmdlZCBob29rIGhhbmRsZXIuXG4gKlxuICogRmlsZUNoYW5nZWQgaG9va3MgZmlyZSB3aGVuIGEgd2F0Y2hlZCBmaWxlIGNoYW5nZXMgb24gZGlzaywgYWxsb3dpbmcgeW91IHRvOlxuICogLSBSZWFjdCB0byBmaWxlIHN5c3RlbSBjaGFuZ2VzIGR1cmluZyBhIHNlc3Npb25cbiAqIC0gSW52YWxpZGF0ZSBjYWNoZXMgb3IgcmVsb2FkIGNvbmZpZ3VyYXRpb25cbiAqIC0gUmV0dXJuIGB3YXRjaFBhdGhzYCB2aWEgYGhvb2tTcGVjaWZpY091dHB1dGAgdG8gdXBkYXRlIHRoZSBzZXQgb2Ygd2F0Y2hlZCBwYXRoc1xuICpcbiAqIFRoZSBpbnB1dCBgZXZlbnRgIGZpZWxkIGluZGljYXRlcyB0aGUgdHlwZSBvZiBjaGFuZ2U6XG4gKiAtIGAnY2hhbmdlJ2AgLSBGaWxlIGNvbnRlbnRzIGNoYW5nZWRcbiAqIC0gYCdhZGQnYCAtIEZpbGUgd2FzIGNyZWF0ZWRcbiAqIC0gYCd1bmxpbmsnYCAtIEZpbGUgd2FzIGRlbGV0ZWRcbiAqXG4gKiAqKk1hdGNoZXIqKjogTm8gbWF0Y2hlciBzdXBwb3J0IC0gZmlyZXMgb24gYWxsIGZpbGUgY2hhbmdlIGV2ZW50c1xuICogQHBhcmFtIGNvbmZpZyAtIEhvb2sgY29uZmlndXJhdGlvbiB3aXRoIG9wdGlvbmFsIHRpbWVvdXRcbiAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gZXhlY3V0ZVxuICogQHJldHVybnMgQSBob29rIGZ1bmN0aW9uIHRoYXQgY2FuIGJlIGV4cG9ydGVkIGFzIHRoZSBkZWZhdWx0IGV4cG9ydFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGltcG9ydCB7IGZpbGVDaGFuZ2VkSG9vaywgZmlsZUNoYW5nZWRPdXRwdXQgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIGV4cG9ydCBkZWZhdWx0IGZpbGVDaGFuZ2VkSG9vayh7fSwgYXN5bmMgKGlucHV0LCB7IGxvZ2dlciB9KSA9PiB7XG4gKiAgIGxvZ2dlci5pbmZvKCdGaWxlIGNoYW5nZWQnLCB7IHBhdGg6IGlucHV0LmZpbGVfcGF0aCwgZXZlbnQ6IGlucHV0LmV2ZW50IH0pO1xuICogICByZXR1cm4gZmlsZUNoYW5nZWRPdXRwdXQoe30pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNmaWxlY2hhbmdlZFxuICovXG5leHBvcnQgZnVuY3Rpb24gZmlsZUNoYW5nZWRIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJGaWxlQ2hhbmdlZFwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gTWVzc2FnZURpc3BsYXkgSG9vayBGYWN0b3J5XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIENyZWF0ZXMgYSBNZXNzYWdlRGlzcGxheSBob29rIGhhbmRsZXIuXG4gKlxuICogTWVzc2FnZURpc3BsYXkgaG9va3MgZmlyZSB3aXRoIGVhY2ggYmF0Y2ggb2YgbmV3bHkgY29tcGxldGVkIGxpbmVzIHdoaWxlIGFuXG4gKiBhc3Npc3RhbnQgbWVzc2FnZSBzdHJlYW1zLiBEaXNwbGF5LW9ubHk6IHRoZSBzdG9yZWQgbWVzc2FnZSBhbmQgd2hhdCB0aGUgbW9kZWxcbiAqIHNlZXMgYXJlIHVudG91Y2hlZC4gQWxsb3dzIHlvdSB0bzpcbiAqIC0gUmVwbGFjZSB0aGUgZGVsdGEgc2hvd24gb24gc2NyZWVuIHdpdGggY3VzdG9tIGNvbnRlbnQgdmlhIGBkaXNwbGF5Q29udGVudGBcbiAqIC0gT2JzZXJ2ZSBhbmQgbG9nIG1lc3NhZ2Ugc3RyZWFtaW5nIGV2ZW50c1xuICpcbiAqIFRoZSBpbnB1dCBjYXJyaWVzIGB0dXJuX2lkYCwgYG1lc3NhZ2VfaWRgLCBgaW5kZXhgLCBgZmluYWxgLCBhbmQgYGRlbHRhYCBmaWVsZHMuXG4gKiBUaGUgYGZpbmFsYCBmbGFnIGluZGljYXRlcyB0aGUgbGFzdCBmbHVzaCBvZiBhIG1lc3NhZ2UgXHUyMDE0IGl0cyBgZGVsdGFgIGlzIGVtcHR5XG4gKiB3aGVuIHRoZSBtZXNzYWdlIGVuZHMgb24gYSBuZXdsaW5lOyB0cmVhdCBgZmluYWxgIGFzIHRoZSBlbmQtb2YtbWVzc2FnZSBzaWduYWwuXG4gKlxuICogKipNYXRjaGVyKio6IE5vIG1hdGNoZXIgc3VwcG9ydCAtIGZpcmVzIG9uIGFsbCBtZXNzYWdlIGRpc3BsYXkgZXZlbnRzXG4gKiBAcGFyYW0gY29uZmlnIC0gSG9vayBjb25maWd1cmF0aW9uIHdpdGggb3B0aW9uYWwgdGltZW91dFxuICogQHBhcmFtIGhhbmRsZXIgLSBUaGUgaGFuZGxlciBmdW5jdGlvbiB0byBleGVjdXRlXG4gKiBAcmV0dXJucyBBIGhvb2sgZnVuY3Rpb24gdGhhdCBjYW4gYmUgZXhwb3J0ZWQgYXMgdGhlIGRlZmF1bHQgZXhwb3J0XG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgbWVzc2FnZURpc3BsYXlIb29rLCBtZXNzYWdlRGlzcGxheU91dHB1dCB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gKlxuICogZXhwb3J0IGRlZmF1bHQgbWVzc2FnZURpc3BsYXlIb29rKHt9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgaWYgKGlucHV0LmZpbmFsKSB7XG4gKiAgICAgbG9nZ2VyLmluZm8oJ01lc3NhZ2UgY29tcGxldGUnLCB7IG1lc3NhZ2VJZDogaW5wdXQubWVzc2FnZV9pZCB9KTtcbiAqICAgfVxuICogICByZXR1cm4gbWVzc2FnZURpc3BsYXlPdXRwdXQoe30pO1xuICogfSk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNtZXNzYWdlZGlzcGxheVxuICovXG5leHBvcnQgZnVuY3Rpb24gbWVzc2FnZURpc3BsYXlIb29rKGNvbmZpZywgaGFuZGxlcikge1xuICAgIHJldHVybiBjcmVhdGVIb29rRnVuY3Rpb24oXCJNZXNzYWdlRGlzcGxheVwiLCBjb25maWcsIGhhbmRsZXIpO1xufVxuIiwgIi8qKlxuICogTG9nZ2VyIHN5c3RlbSBmb3IgQ2xhdWRlIENvZGUgaG9va3MuXG4gKlxuICogUHJvdmlkZXMgc3RydWN0dXJlZCBsb2dnaW5nIHdpdGggZXZlbnQgc3Vic2NyaXB0aW9uIGFuZCBvcHRpb25hbCBmaWxlIG91dHB1dC5cbiAqIFRoZSBsb2dnZXIgaXMgKipzaWxlbnQgYnkgZGVmYXVsdCoqIHRvIGF2b2lkIGludGVyZmVyaW5nIHdpdGggaG9vayBwcm90b2NvbFxuICogKHN0ZG91dCBpcyByZXNlcnZlZCBmb3IgSlNPTiByZXNwb25zZXMsIHN0ZGVyciBtYXkgY29uZmxpY3Qgd2l0aCBDbGF1ZGUgQ29kZSkuXG4gKiBAbW9kdWxlXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiAvLyBTdWJzY3JpYmUgdG8gbG9nIGV2ZW50c1xuICogY29uc3QgdW5zdWJzY3JpYmUgPSBsb2dnZXIub24oJ2Vycm9yJywgKGV2ZW50KSA9PiB7XG4gKiAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIGluICR7ZXZlbnQuaG9va1R5cGV9OiAke2V2ZW50Lm1lc3NhZ2V9YCk7XG4gKiB9KTtcbiAqXG4gKiAvLyBMYXRlciwgY2xlYW4gdXBcbiAqIHVuc3Vic2NyaWJlKCk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rc1xuICovXG5pbXBvcnQgeyBjbG9zZVN5bmMsIGV4aXN0c1N5bmMsIG1rZGlyU3luYywgb3BlblN5bmMsIHdyaXRlU3luYyB9IGZyb20gXCJub2RlOmZzXCI7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuLyoqXG4gKiBBbGwgbG9nIGxldmVscyBpbiBvcmRlciBvZiBzZXZlcml0eSAobG93ZXN0IHRvIGhpZ2hlc3QpLlxuICovXG5leHBvcnQgY29uc3QgTE9HX0xFVkVMUyA9IFtcImRlYnVnXCIsIFwiaW5mb1wiLCBcIndhcm5cIiwgXCJlcnJvclwiXTtcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIExvZ2dlciBDbGFzc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBMb2dnZXIgZm9yIENsYXVkZSBDb2RlIGhvb2tzIHdpdGggZXZlbnQgc3Vic2NyaXB0aW9uIGFuZCBmaWxlIG91dHB1dC5cbiAqXG4gKiAjIyBLZXkgQmVoYXZpb3JzXG4gKlxuICogfCBDb25maWd1cmF0aW9uIHwgQmVoYXZpb3IgfFxuICogfC0tLS0tLS0tLS0tLS0tfC0tLS0tLS0tLS18XG4gKiB8IE5vIGNvbmZpZyAoZGVmYXVsdCkgfCAqKlNpbGVudCoqIC0gbm8gb3V0cHV0IGFueXdoZXJlIHxcbiAqIHwgYENMQVVERV9DT0RFX0hPT0tTX0xPR19GSUxFYCBlbnYgdmFyIHwgQXBwZW5kIEpTT04gbGluZXMgdG8gZmlsZSB8XG4gKiB8IGAub24obGV2ZWwsIGhhbmRsZXIpYCByZWdpc3RlcmVkIHwgRXZlbnRzIGRlbGl2ZXJlZCB0byBoYW5kbGVycyBvbmx5IHxcbiAqIHwgTXVsdGlwbGUgZGVzdGluYXRpb25zIHwgQWxsIGRlc3RpbmF0aW9ucyByZWNlaXZlIGV2ZW50cyB8XG4gKlxuICogIyMgSW1wb3J0YW50IE5vdGVzXG4gKlxuICogLSAqKk5ldmVyIG91dHB1dHMgdG8gc3Rkb3V0KiogKHJlc2VydmVkIGZvciBKU09OIGhvb2sgcmVzcG9uc2UpXG4gKiAtICoqTmV2ZXIgb3V0cHV0cyB0byBzdGRlcnIqKiAobWF5IGludGVyZmVyZSB3aXRoIENsYXVkZSBDb2RlIGVycm9yIGhhbmRsaW5nKVxuICogLSBGaWxlIG91dHB1dCB1c2VzIEpTT04gTGluZXMgZm9ybWF0IGZvciBlYXN5IHBhcnNpbmdcbiAqIC0gYC5vbihsZXZlbCwgaGFuZGxlcilgIHJldHVybnMgYW4gdW5zdWJzY3JpYmUgZnVuY3Rpb25cbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBsb2dnZXIgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICpcbiAqIC8vIFN1YnNjcmliZSB0byBldmVudHMgYXQgc3BlY2lmaWMgbGV2ZWxcbiAqIGxvZ2dlci5vbignd2FybicsIChldmVudCkgPT4ge1xuICogICBzZW5kQWxlcnQoZXZlbnQubWVzc2FnZSk7XG4gKiB9KTtcbiAqXG4gKiAvLyBMb2cgd2l0aGluIGEgaG9vayBoYW5kbGVyXG4gKiBleHBvcnQgZGVmYXVsdCBwcmVUb29sVXNlSG9vayh7IG1hdGNoZXI6ICdCYXNoJyB9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLndhcm4oJ0Fib3V0IHRvIHZhbGlkYXRlIEJhc2ggY29tbWFuZCcpO1xuICogICByZXR1cm4gcHJlVG9vbFVzZU91dHB1dCh7IGFsbG93OiB0cnVlIH0pO1xuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNsYXNzIExvZ2dlciB7XG4gICAgLyoqXG4gICAgICogUmVnaXN0ZXJlZCBldmVudCBoYW5kbGVycyBieSBsb2cgbGV2ZWwuXG4gICAgICovXG4gICAgaGFuZGxlcnMgPSBuZXcgTWFwKCk7XG4gICAgLyoqXG4gICAgICogRmlsZSBkZXNjcmlwdG9yIGZvciBsb2cgZmlsZSBvdXRwdXQuXG4gICAgICogTGF6aWx5IGluaXRpYWxpemVkIG9uIGZpcnN0IHdyaXRlLlxuICAgICAqL1xuICAgIGxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgLyoqXG4gICAgICogUGF0aCB0byB0aGUgbG9nIGZpbGUsIGlmIGNvbmZpZ3VyZWQuXG4gICAgICovXG4gICAgbG9nRmlsZVBhdGggPSBudWxsO1xuICAgIC8qKlxuICAgICAqIFdoZXRoZXIgZmlsZSBpbml0aWFsaXphdGlvbiBoYXMgYmVlbiBhdHRlbXB0ZWQuXG4gICAgICovXG4gICAgZmlsZUluaXRpYWxpemVkID0gZmFsc2U7XG4gICAgLyoqXG4gICAgICogQ3VycmVudCBob29rIGNvbnRleHQgZm9yIGVucmljaGluZyBsb2cgZXZlbnRzLlxuICAgICAqL1xuICAgIGN1cnJlbnRIb29rVHlwZTtcbiAgICAvKipcbiAgICAgKiBDdXJyZW50IGhvb2sgaW5wdXQgZm9yIGVucmljaGluZyBsb2cgZXZlbnRzLlxuICAgICAqL1xuICAgIGN1cnJlbnRJbnB1dDtcbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIGEgbmV3IExvZ2dlciBpbnN0YW5jZS5cbiAgICAgKlxuICAgICAqIFR5cGljYWxseSB5b3Ugc2hvdWxkIHVzZSB0aGUgZXhwb3J0ZWQgYGxvZ2dlcmAgc2luZ2xldG9uIHJhdGhlciB0aGFuXG4gICAgICogY3JlYXRpbmcgbmV3IGluc3RhbmNlcy5cbiAgICAgKiBAcGFyYW0gY29uZmlnIC0gT3B0aW9uYWwgY29uZmlndXJhdGlvblxuICAgICAqIEBleGFtcGxlXG4gICAgICogYGBgdHlwZXNjcmlwdFxuICAgICAqIC8vIFVzZSBzaW5nbGV0b24gKHJlY29tbWVuZGVkKVxuICAgICAqIGltcG9ydCB7IGxvZ2dlciB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG4gICAgICpcbiAgICAgKiAvLyBPciBjcmVhdGUgY3VzdG9tIGluc3RhbmNlXG4gICAgICogY29uc3QgY3VzdG9tTG9nZ2VyID0gbmV3IExvZ2dlcih7IGxvZ0ZpbGVQYXRoOiAnL3Zhci9sb2cvaG9va3MubG9nJyB9KTtcbiAgICAgKiBgYGBcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3Rvcihjb25maWcgPSB7fSkge1xuICAgICAgICAvLyBJbml0aWFsaXplIGhhbmRsZXJzIG1hcCBmb3IgZWFjaCBsZXZlbFxuICAgICAgICBmb3IgKGNvbnN0IGxldmVsIG9mIExPR19MRVZFTFMpIHtcbiAgICAgICAgICAgIHRoaXMuaGFuZGxlcnMuc2V0KGxldmVsLCBuZXcgU2V0KCkpO1xuICAgICAgICB9XG4gICAgICAgIC8vIFNldCBsb2cgZmlsZSBwYXRoIGZyb20gZXhwbGljaXQgY29uZmlnLCBvciBieSByZWFkaW5nIHRoZSBjb25maWd1cmVkIGVudiB2YXJcbiAgICAgICAgdGhpcy5sb2dGaWxlUGF0aCA9IGNvbmZpZy5sb2dGaWxlUGF0aCA/PyAoY29uZmlnLmxvZ0VudlZhciA/IHByb2Nlc3MuZW52W2NvbmZpZy5sb2dFbnZWYXJdIDogdW5kZWZpbmVkKSA/PyBudWxsO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBMb2dzIGEgZGVidWcgbWVzc2FnZS5cbiAgICAgKlxuICAgICAqIFVzZSBmb3IgZGV0YWlsZWQgZGVidWdnaW5nIGluZm9ybWF0aW9uIHRoYXQgaXMgdHlwaWNhbGx5IG9ubHkgdXNlZnVsXG4gICAgICogZHVyaW5nIGRldmVsb3BtZW50IG9yIHRyb3VibGVzaG9vdGluZy5cbiAgICAgKiBAcGFyYW0gbWVzc2FnZSAtIFRoZSBkZWJ1ZyBtZXNzYWdlXG4gICAgICogQHBhcmFtIGNvbnRleHQgLSBPcHRpb25hbCBhZGRpdGlvbmFsIGNvbnRleHRcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGBgYHR5cGVzY3JpcHRcbiAgICAgKiBsb2dnZXIuZGVidWcoJ1Byb2Nlc3NpbmcgdG9vbCBpbnB1dCcsIHsgdG9vbE5hbWU6ICdCYXNoJywgaW5wdXRTaXplOiAyNTYgfSk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgZGVidWcobWVzc2FnZSwgY29udGV4dCkge1xuICAgICAgICB0aGlzLmVtaXQoXCJkZWJ1Z1wiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogTG9ncyBhbiBpbmZvIG1lc3NhZ2UuXG4gICAgICpcbiAgICAgKiBVc2UgZm9yIGdlbmVyYWwgb3BlcmF0aW9uYWwgZXZlbnRzIGxpa2UgaG9vayBpbnZvY2F0aW9ucywgc3VjY2Vzc2Z1bFxuICAgICAqIGNvbXBsZXRpb25zLCBvciBzdGF0ZSBjaGFuZ2VzLlxuICAgICAqIEBwYXJhbSBtZXNzYWdlIC0gVGhlIGluZm8gbWVzc2FnZVxuICAgICAqIEBwYXJhbSBjb250ZXh0IC0gT3B0aW9uYWwgYWRkaXRpb25hbCBjb250ZXh0XG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0eXBlc2NyaXB0XG4gICAgICogbG9nZ2VyLmluZm8oJ1Nlc3Npb24gc3RhcnRlZCcsIHsgc291cmNlOiAnc3RhcnR1cCcsIHNlc3Npb25JZDogJ2FiYzEyMycgfSk7XG4gICAgICogYGBgXG4gICAgICovXG4gICAgaW5mbyhtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImluZm9cIiwgbWVzc2FnZSwgY29udGV4dCk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIExvZ3MgYSB3YXJuaW5nIG1lc3NhZ2UuXG4gICAgICpcbiAgICAgKiBVc2UgZm9yIGNvbmRpdGlvbnMgdGhhdCBtYXkgaW5kaWNhdGUgaXNzdWVzIGJ1dCBkb24ndCBwcmV2ZW50XG4gICAgICogb3BlcmF0aW9uLCBzdWNoIGFzIGRlcHJlY2F0ZWQgcGF0dGVybnMgb3IgcGVyZm9ybWFuY2UgY29uY2VybnMuXG4gICAgICogQHBhcmFtIG1lc3NhZ2UgLSBUaGUgd2FybmluZyBtZXNzYWdlXG4gICAgICogQHBhcmFtIGNvbnRleHQgLSBPcHRpb25hbCBhZGRpdGlvbmFsIGNvbnRleHRcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGBgYHR5cGVzY3JpcHRcbiAgICAgKiBsb2dnZXIud2FybignRGVwcmVjYXRlZCBob29rIHBhdHRlcm4gZGV0ZWN0ZWQnLCB7IHBhdHRlcm46ICdsZWdhY3lNYXRjaGVyJyB9KTtcbiAgICAgKiBgYGBcbiAgICAgKi9cbiAgICB3YXJuKG1lc3NhZ2UsIGNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5lbWl0KFwid2FyblwiLCBtZXNzYWdlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogTG9ncyBhbiBlcnJvciBtZXNzYWdlLlxuICAgICAqXG4gICAgICogVXNlIGZvciBlcnJvciBjb25kaXRpb25zIHRoYXQgcmVxdWlyZSBhdHRlbnRpb24gYnV0IHdlcmUgaGFuZGxlZFxuICAgICAqIGdyYWNlZnVsbHkuIEZvciBleGNlcHRpb25zLCBwcmVmZXIge0BsaW5rIGxvZ0Vycm9yfS5cbiAgICAgKiBAcGFyYW0gbWVzc2FnZSAtIFRoZSBlcnJvciBtZXNzYWdlXG4gICAgICogQHBhcmFtIGNvbnRleHQgLSBPcHRpb25hbCBhZGRpdGlvbmFsIGNvbnRleHRcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGBgYHR5cGVzY3JpcHRcbiAgICAgKiBsb2dnZXIuZXJyb3IoJ0ZhaWxlZCB0byB2YWxpZGF0ZSB0b29sIGlucHV0JywgeyB0b29sTmFtZTogJ0Jhc2gnLCByZWFzb246ICdlbXB0eSBjb21tYW5kJyB9KTtcbiAgICAgKiBgYGBcbiAgICAgKi9cbiAgICBlcnJvcihtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIHRoaXMuZW1pdChcImVycm9yXCIsIG1lc3NhZ2UsIGNvbnRleHQpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBMb2dzIGEgc3RydWN0dXJlZCBlcnJvciB3aXRoIGZ1bGwgZXJyb3IgZGV0YWlscy5cbiAgICAgKlxuICAgICAqIFVzZSB0aGlzIG1ldGhvZCB3aGVuIGxvZ2dpbmcgY2F1Z2h0IGV4Y2VwdGlvbnMgdG8gY2FwdHVyZSB0aGUgZnVsbFxuICAgICAqIGVycm9yIGNvbnRleHQgaW5jbHVkaW5nIG5hbWUsIG1lc3NhZ2UsIHN0YWNrIHRyYWNlLCBhbmQgY2F1c2UgY2hhaW4uXG4gICAgICogQHBhcmFtIGVycm9yIC0gVGhlIGVycm9yIHRvIGxvZ1xuICAgICAqIEBwYXJhbSBtZXNzYWdlIC0gSHVtYW4tcmVhZGFibGUgZGVzY3JpcHRpb24gb2Ygd2hhdCBmYWlsZWRcbiAgICAgKiBAcGFyYW0gY29udGV4dCAtIE9wdGlvbmFsIGFkZGl0aW9uYWwgY29udGV4dFxuICAgICAqIEBleGFtcGxlXG4gICAgICogYGBgdHlwZXNjcmlwdFxuICAgICAqIHRyeSB7XG4gICAgICogICBhd2FpdCBkYW5nZXJvdXNPcGVyYXRpb24oKTtcbiAgICAgKiB9IGNhdGNoIChlcnIpIHtcbiAgICAgKiAgIGxvZ2dlci5sb2dFcnJvcihlcnIsICdGYWlsZWQgdG8gZXhlY3V0ZSBkYW5nZXJvdXMgb3BlcmF0aW9uJywge1xuICAgICAqICAgICBvcGVyYXRpb246ICdkZWxldGUnLFxuICAgICAqICAgICB0YXJnZXQ6ICcvaW1wb3J0YW50L2ZpbGUudHh0J1xuICAgICAqICAgfSk7XG4gICAgICogfVxuICAgICAqIGBgYFxuICAgICAqL1xuICAgIGxvZ0Vycm9yKGVycm9yLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIGNvbnN0IGVycm9ySW5mbyA9IHRoaXMuZXh0cmFjdEVycm9ySW5mbyhlcnJvcik7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0ge1xuICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICBsZXZlbDogXCJlcnJvclwiLFxuICAgICAgICAgICAgaG9va1R5cGU6IHRoaXMuY3VycmVudEhvb2tUeXBlLFxuICAgICAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgICAgIGlucHV0OiB0aGlzLmN1cnJlbnRJbnB1dCxcbiAgICAgICAgICAgIGVycm9yOiBlcnJvckluZm8sXG4gICAgICAgICAgICBjb250ZXh0LFxuICAgICAgICB9O1xuICAgICAgICB0aGlzLmRlbGl2ZXJFdmVudChldmVudCk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFN1YnNjcmliZXMgYSBoYW5kbGVyIHRvIGxvZyBldmVudHMgYXQgdGhlIHNwZWNpZmllZCBsZXZlbC5cbiAgICAgKlxuICAgICAqIFRoZSBoYW5kbGVyIHdpbGwgYmUgY2FsbGVkIGZvciBldmVyeSBsb2cgZXZlbnQgYXQgdGhlIHNwZWNpZmllZCBsZXZlbC5cbiAgICAgKiBSZXR1cm5zIGFuIHVuc3Vic2NyaWJlIGZ1bmN0aW9uIHRoYXQgc2hvdWxkIGJlIGNhbGxlZCB3aGVuIHRoZSBoYW5kbGVyXG4gICAgICogaXMgbm8gbG9uZ2VyIG5lZWRlZC5cbiAgICAgKiBAcGFyYW0gbGV2ZWwgLSBUaGUgbG9nIGxldmVsIHRvIHN1YnNjcmliZSB0b1xuICAgICAqIEBwYXJhbSBoYW5kbGVyIC0gVGhlIGhhbmRsZXIgZnVuY3Rpb24gdG8gY2FsbCBmb3IgZWFjaCBldmVudFxuICAgICAqIEByZXR1cm5zIEEgZnVuY3Rpb24gdG8gdW5zdWJzY3JpYmUgdGhlIGhhbmRsZXJcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGBgYHR5cGVzY3JpcHRcbiAgICAgKiAvLyBTdWJzY3JpYmUgdG8gZXJyb3IgZXZlbnRzXG4gICAgICogY29uc3QgdW5zdWJzY3JpYmUgPSBsb2dnZXIub24oJ2Vycm9yJywgKGV2ZW50KSA9PiB7XG4gICAgICogICBjb25zb2xlLmVycm9yKGBbJHtldmVudC5ob29rVHlwZX1dICR7ZXZlbnQubWVzc2FnZX1gKTtcbiAgICAgKiAgIGlmIChldmVudC5lcnJvcikge1xuICAgICAqICAgICBjb25zb2xlLmVycm9yKGV2ZW50LmVycm9yLnN0YWNrKTtcbiAgICAgKiAgIH1cbiAgICAgKiB9KTtcbiAgICAgKlxuICAgICAqIC8vIExhdGVyLCBjbGVhbiB1cFxuICAgICAqIHVuc3Vic2NyaWJlKCk7XG4gICAgICogYGBgXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBgYGB0eXBlc2NyaXB0XG4gICAgICogLy8gRm9yd2FyZCB0byBleHRlcm5hbCBsb2dnaW5nIGxpYnJhcnlcbiAgICAgKiBpbXBvcnQgcGlubyBmcm9tICdwaW5vJztcbiAgICAgKiBjb25zdCBwaW5vTG9nZ2VyID0gcGlubygpO1xuICAgICAqXG4gICAgICogbG9nZ2VyLm9uKCdpbmZvJywgKGV2ZW50KSA9PiBwaW5vTG9nZ2VyLmluZm8oZXZlbnQsIGV2ZW50Lm1lc3NhZ2UpKTtcbiAgICAgKiBsb2dnZXIub24oJ3dhcm4nLCAoZXZlbnQpID0+IHBpbm9Mb2dnZXIud2FybihldmVudCwgZXZlbnQubWVzc2FnZSkpO1xuICAgICAqIGxvZ2dlci5vbignZXJyb3InLCAoZXZlbnQpID0+IHBpbm9Mb2dnZXIuZXJyb3IoZXZlbnQsIGV2ZW50Lm1lc3NhZ2UpKTtcbiAgICAgKiBgYGBcbiAgICAgKi9cbiAgICBvbihsZXZlbCwgaGFuZGxlcikge1xuICAgICAgICBjb25zdCBsZXZlbEhhbmRsZXJzID0gdGhpcy5oYW5kbGVycy5nZXQobGV2ZWwpO1xuICAgICAgICBpZiAobGV2ZWxIYW5kbGVycykge1xuICAgICAgICAgICAgbGV2ZWxIYW5kbGVycy5hZGQoaGFuZGxlcik7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgIGxldmVsSGFuZGxlcnM/LmRlbGV0ZShoYW5kbGVyKTtcbiAgICAgICAgfTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogU2V0cyB0aGUgY3VycmVudCBob29rIGNvbnRleHQgZm9yIGVucmljaGluZyBsb2cgZXZlbnRzLlxuICAgICAqXG4gICAgICogVGhpcyBpcyBjYWxsZWQgaW50ZXJuYWxseSBieSB0aGUgcnVudGltZSBiZWZvcmUgaW52b2tpbmcgaG9vayBoYW5kbGVycy5cbiAgICAgKiBZb3UgdHlwaWNhbGx5IGRvbid0IG5lZWQgdG8gY2FsbCB0aGlzIGRpcmVjdGx5LlxuICAgICAqIEBwYXJhbSBob29rVHlwZSAtIFRoZSB0eXBlIG9mIGhvb2sgYmVpbmcgZXhlY3V0ZWRcbiAgICAgKiBAcGFyYW0gaW5wdXQgLSBUaGUgaG9vayBpbnB1dCBkYXRhXG4gICAgICogQGludGVybmFsXG4gICAgICovXG4gICAgc2V0Q29udGV4dChob29rVHlwZSwgaW5wdXQpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50SG9va1R5cGUgPSBob29rVHlwZTtcbiAgICAgICAgdGhpcy5jdXJyZW50SW5wdXQgPSBpbnB1dDtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2xlYXJzIHRoZSBjdXJyZW50IGhvb2sgY29udGV4dC5cbiAgICAgKlxuICAgICAqIENhbGxlZCBpbnRlcm5hbGx5IGJ5IHRoZSBydW50aW1lIGFmdGVyIGhvb2sgZXhlY3V0aW9uIGNvbXBsZXRlcy5cbiAgICAgKiBAaW50ZXJuYWxcbiAgICAgKi9cbiAgICBjbGVhckNvbnRleHQoKSB7XG4gICAgICAgIHRoaXMuY3VycmVudEhvb2tUeXBlID0gdW5kZWZpbmVkO1xuICAgICAgICB0aGlzLmN1cnJlbnRJbnB1dCA9IHVuZGVmaW5lZDtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ29uZmlndXJlcyB0aGUgbG9nIGZpbGUgcGF0aCBhdCBydW50aW1lLlxuICAgICAqXG4gICAgICogQ2FsbCB0aGlzIHRvIGVuYWJsZSBvciBjaGFuZ2UgZmlsZSBsb2dnaW5nLiBTZXR0aW5nIHRvIGBudWxsYCBkaXNhYmxlc1xuICAgICAqIGZpbGUgbG9nZ2luZyAoYnV0IGRvZXNuJ3QgY2xvc2UgZXhpc3RpbmcgZmlsZSBoYW5kbGUgaW1tZWRpYXRlbHkpLlxuICAgICAqIEBwYXJhbSBmaWxlUGF0aCAtIFBhdGggdG8gdGhlIGxvZyBmaWxlLCBvciBudWxsIHRvIGRpc2FibGVcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGBgYHR5cGVzY3JpcHRcbiAgICAgKiAvLyBFbmFibGUgZmlsZSBsb2dnaW5nIGF0IHJ1bnRpbWVcbiAgICAgKiBsb2dnZXIuc2V0TG9nRmlsZSgnL3Zhci9sb2cvY2xhdWRlLWhvb2tzLmxvZycpO1xuICAgICAqXG4gICAgICogLy8gRGlzYWJsZSBmaWxlIGxvZ2dpbmdcbiAgICAgKiBsb2dnZXIuc2V0TG9nRmlsZShudWxsKTtcbiAgICAgKiBgYGBcbiAgICAgKi9cbiAgICBzZXRMb2dGaWxlKGZpbGVQYXRoKSB7XG4gICAgICAgIC8vIENsb3NlIGV4aXN0aW5nIGZpbGUgaWYgb3BlblxuICAgICAgICBpZiAodGhpcy5sb2dGaWxlRmQgIT09IG51bGwpIHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgY2xvc2VTeW5jKHRoaXMubG9nRmlsZUZkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNhdGNoIChjbG9zZUVycm9yKSB7XG4gICAgICAgICAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYFtjbGF1ZGUtY29kZS1ob29rc10gRmFpbGVkIHRvIGNsb3NlIGxvZyBmaWxlOiAke1N0cmluZyhjbG9zZUVycm9yKX1cXG5gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmxvZ0ZpbGVQYXRoID0gZmlsZVBhdGg7XG4gICAgICAgIHRoaXMuZmlsZUluaXRpYWxpemVkID0gZmFsc2U7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENsb3NlcyBhbGwgcmVzb3VyY2VzIGhlbGQgYnkgdGhlIGxvZ2dlci5cbiAgICAgKlxuICAgICAqIENhbGwgdGhpcyBkdXJpbmcgZ3JhY2VmdWwgc2h1dGRvd24gdG8gZW5zdXJlIGFsbCBsb2cgZGF0YSBpcyBmbHVzaGVkLlxuICAgICAqIEBleGFtcGxlXG4gICAgICogYGBgdHlwZXNjcmlwdFxuICAgICAqIHByb2Nlc3Mub24oJ2V4aXQnLCAoKSA9PiB7XG4gICAgICogICBsb2dnZXIuY2xvc2UoKTtcbiAgICAgKiB9KTtcbiAgICAgKiBgYGBcbiAgICAgKi9cbiAgICBjbG9zZSgpIHtcbiAgICAgICAgaWYgKHRoaXMubG9nRmlsZUZkICE9PSBudWxsKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNsb3NlU3luYyh0aGlzLmxvZ0ZpbGVGZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXRjaCAoY2xvc2VFcnJvcikge1xuICAgICAgICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGBbY2xhdWRlLWNvZGUtaG9va3NdIEZhaWxlZCB0byBjbG9zZSBsb2cgZmlsZTogJHtTdHJpbmcoY2xvc2VFcnJvcil9XFxuYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLmxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5maWxlSW5pdGlhbGl6ZWQgPSBmYWxzZTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2hlY2tzIGlmIHRoZXJlIGFyZSBhbnkgYWN0aXZlIGhhbmRsZXJzIG9yIGRlc3RpbmF0aW9ucy5cbiAgICAgKlxuICAgICAqIFJldHVybnMgdHJ1ZSBpZiBhbnkgaGFuZGxlcnMgYXJlIHJlZ2lzdGVyZWQgb3IgZmlsZSBsb2dnaW5nIGlzIGVuYWJsZWQuXG4gICAgICogQHJldHVybnMgV2hldGhlciB0aGUgbG9nZ2VyIGhhcyBhbnkgYWN0aXZlIG91dHB1dCBkZXN0aW5hdGlvbnNcbiAgICAgKi9cbiAgICBoYXNEZXN0aW5hdGlvbnMoKSB7XG4gICAgICAgIGZvciAoY29uc3QgaGFuZGxlcnMgb2YgdGhpcy5oYW5kbGVycy52YWx1ZXMoKSkge1xuICAgICAgICAgICAgaWYgKGhhbmRsZXJzLnNpemUgPiAwKVxuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmxvZ0ZpbGVQYXRoICE9PSBudWxsO1xuICAgIH1cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gUHJpdmF0ZSBNZXRob2RzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8qKlxuICAgICAqIEVtaXRzIGEgbG9nIGV2ZW50LlxuICAgICAqIEBwYXJhbSBsZXZlbCAtIFRoZSBzZXZlcml0eSBsZXZlbCBvZiB0aGUgZXZlbnRcbiAgICAgKiBAcGFyYW0gbWVzc2FnZSAtIFRoZSBsb2cgbWVzc2FnZVxuICAgICAqIEBwYXJhbSBjb250ZXh0IC0gT3B0aW9uYWwgYWRkaXRpb25hbCBjb250ZXh0IGRhdGFcbiAgICAgKi9cbiAgICBlbWl0KGxldmVsLCBtZXNzYWdlLCBjb250ZXh0KSB7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0ge1xuICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICBsZXZlbCxcbiAgICAgICAgICAgIGhvb2tUeXBlOiB0aGlzLmN1cnJlbnRIb29rVHlwZSxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICBpbnB1dDogdGhpcy5jdXJyZW50SW5wdXQsXG4gICAgICAgICAgICBjb250ZXh0LFxuICAgICAgICB9O1xuICAgICAgICB0aGlzLmRlbGl2ZXJFdmVudChldmVudCk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIERlbGl2ZXJzIGFuIGV2ZW50IHRvIGFsbCByZWdpc3RlcmVkIGRlc3RpbmF0aW9ucy5cbiAgICAgKiBAcGFyYW0gZXZlbnQgLSBUaGUgbG9nIGV2ZW50IHRvIGRlbGl2ZXJcbiAgICAgKi9cbiAgICBkZWxpdmVyRXZlbnQoZXZlbnQpIHtcbiAgICAgICAgLy8gRGVsaXZlciB0byBldmVudCBoYW5kbGVyc1xuICAgICAgICBjb25zdCBsZXZlbEhhbmRsZXJzID0gdGhpcy5oYW5kbGVycy5nZXQoZXZlbnQubGV2ZWwpO1xuICAgICAgICBpZiAobGV2ZWxIYW5kbGVycykge1xuICAgICAgICAgICAgZm9yIChjb25zdCBoYW5kbGVyIG9mIGxldmVsSGFuZGxlcnMpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBoYW5kbGVyKGV2ZW50KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY2F0Y2ggKGhhbmRsZXJFcnJvcikge1xuICAgICAgICAgICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgW2NsYXVkZS1jb2RlLWhvb2tzXSBMb2cgaGFuZGxlciBlcnJvcjogJHtTdHJpbmcoaGFuZGxlckVycm9yKX1cXG5gKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgLy8gV3JpdGUgdG8gZmlsZSBpZiBjb25maWd1cmVkXG4gICAgICAgIHRoaXMud3JpdGVUb0ZpbGUoZXZlbnQpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBXcml0ZXMgYW4gZXZlbnQgdG8gdGhlIGxvZyBmaWxlLlxuICAgICAqIEBwYXJhbSBldmVudCAtIFRoZSBsb2cgZXZlbnQgdG8gd3JpdGVcbiAgICAgKi9cbiAgICB3cml0ZVRvRmlsZShldmVudCkge1xuICAgICAgICBpZiAoIXRoaXMubG9nRmlsZVBhdGgpXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIC8vIExhenkgaW5pdGlhbGl6YXRpb24gb2YgZmlsZSBoYW5kbGVcbiAgICAgICAgaWYgKCF0aGlzLmZpbGVJbml0aWFsaXplZCkge1xuICAgICAgICAgICAgdGhpcy5pbml0aWFsaXplRmlsZSgpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmxvZ0ZpbGVGZCA9PT0gbnVsbClcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IGxpbmUgPSBgJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuYDtcbiAgICAgICAgICAgIHdyaXRlU3luYyh0aGlzLmxvZ0ZpbGVGZCwgbGluZSk7XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2ggKHdyaXRlRXJyb3IpIHtcbiAgICAgICAgICAgIC8vIERpc2FibGUgZmlsZSBsb2dnaW5nIGFmdGVyIGEgd3JpdGUgZmFpbHVyZSB0byBhdm9pZCByZXBlYXRlZCBlcnJvcnNcbiAgICAgICAgICAgIHRoaXMubG9nRmlsZUZkID0gbnVsbDtcbiAgICAgICAgICAgIHRoaXMuZmlsZUluaXRpYWxpemVkID0gZmFsc2U7XG4gICAgICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgW2NsYXVkZS1jb2RlLWhvb2tzXSBMb2cgZmlsZSB3cml0ZSBmYWlsZWQ6ICR7U3RyaW5nKHdyaXRlRXJyb3IpfVxcbmApO1xuICAgICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEluaXRpYWxpemVzIHRoZSBsb2cgZmlsZSBmb3Igd3JpdGluZy5cbiAgICAgKi9cbiAgICBpbml0aWFsaXplRmlsZSgpIHtcbiAgICAgICAgdGhpcy5maWxlSW5pdGlhbGl6ZWQgPSB0cnVlO1xuICAgICAgICBpZiAoIXRoaXMubG9nRmlsZVBhdGgpXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICAvLyBFbnN1cmUgZGlyZWN0b3J5IGV4aXN0c1xuICAgICAgICAgICAgY29uc3QgZGlyID0gZGlybmFtZSh0aGlzLmxvZ0ZpbGVQYXRoKTtcbiAgICAgICAgICAgIGlmICghZXhpc3RzU3luYyhkaXIpKSB7XG4gICAgICAgICAgICAgICAgbWtkaXJTeW5jKGRpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBPcGVuIGZpbGUgZm9yIGFwcGVuZGluZ1xuICAgICAgICAgICAgdGhpcy5sb2dGaWxlRmQgPSBvcGVuU3luYyh0aGlzLmxvZ0ZpbGVQYXRoLCBcImFcIik7XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2gge1xuICAgICAgICAgICAgLy8gU2lsZW50bHkgaWdub3JlIGZpbGUgaW5pdGlhbGl6YXRpb24gZXJyb3JzXG4gICAgICAgICAgICB0aGlzLmxvZ0ZpbGVGZCA9IG51bGw7XG4gICAgICAgIH1cbiAgICB9XG4gICAgLyoqXG4gICAgICogRXh0cmFjdHMgc3RydWN0dXJlZCBlcnJvciBpbmZvcm1hdGlvbiBmcm9tIGFuIHVua25vd24gZXJyb3IuXG4gICAgICogQHBhcmFtIGVycm9yIC0gVGhlIGVycm9yIHRvIGV4dHJhY3QgaW5mb3JtYXRpb24gZnJvbVxuICAgICAqIEByZXR1cm5zIFN0cnVjdHVyZWQgZXJyb3IgaW5mb3JtYXRpb25cbiAgICAgKi9cbiAgICBleHRyYWN0RXJyb3JJbmZvKGVycm9yKSB7XG4gICAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgICAgICBjb25zdCBpbmZvID0ge1xuICAgICAgICAgICAgICAgIG5hbWU6IGVycm9yLm5hbWUsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogZXJyb3IubWVzc2FnZSxcbiAgICAgICAgICAgICAgICBzdGFjazogZXJyb3Iuc3RhY2ssXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgLy8gRXh0cmFjdCBjYXVzZSBjaGFpbiBpZiBwcmVzZW50XG4gICAgICAgICAgICBpZiAoZXJyb3IuY2F1c2UgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIGluZm8uY2F1c2UgPSB0aGlzLmV4dHJhY3RFcnJvckluZm8oZXJyb3IuY2F1c2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGluZm87XG4gICAgICAgIH1cbiAgICAgICAgLy8gSGFuZGxlIG5vbi1FcnJvciB2YWx1ZXNcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIG5hbWU6IFwiVW5rbm93bkVycm9yXCIsXG4gICAgICAgICAgICBtZXNzYWdlOiBTdHJpbmcoZXJyb3IpLFxuICAgICAgICB9O1xuICAgIH1cbn1cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIFNpbmdsZXRvbiBFeHBvcnRcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogR2xvYmFsIGxvZ2dlciBpbnN0YW5jZSBmb3IgQ2xhdWRlIENvZGUgaG9va3MuXG4gKlxuICogVXNlIHRoaXMgc2luZ2xldG9uIGZvciBhbGwgbG9nZ2luZyB3aXRoaW4gaG9va3MuIFRoZSBsb2dnZXIgaXMgY29uZmlndXJlZFxuICogdmlhIGVudmlyb25tZW50IHZhcmlhYmxlcyBhbmQgc3VwcG9ydHMgZXZlbnQgc3Vic2NyaXB0aW9uIGZvciBjdXN0b21cbiAqIGRlc3RpbmF0aW9ucy5cbiAqXG4gKiAjIyBDb25maWd1cmF0aW9uXG4gKlxuICogfCBFbnZpcm9ubWVudCBWYXJpYWJsZSB8IERlc2NyaXB0aW9uIHxcbiAqIHwtLS0tLS0tLS0tLS0tLS0tLS0tLS18LS0tLS0tLS0tLS0tLXxcbiAqIHwgYENMQVVERV9DT0RFX0hPT0tTX0xPR19GSUxFYCB8IFBhdGggdG8gbG9nIGZpbGUgKEpTT04gTGluZXMgZm9ybWF0KSB8XG4gKlxuICogIyMgVXNhZ2UgaW4gSG9va3NcbiAqXG4gKiBUaGUgbG9nZ2VyIGlzIHBhc3NlZCB0byBob29rIGhhbmRsZXJzIHZpYSBjb250ZXh0IGZvciBjb252ZW5pZW5jZTpcbiAqXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBleHBvcnQgZGVmYXVsdCBwcmVUb29sVXNlSG9vayh7IG1hdGNoZXI6ICdCYXNoJyB9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLndhcm4oJ1ZhbGlkYXRpbmcgQmFzaCBjb21tYW5kJyk7XG4gKiAgIHJldHVybiBwcmVUb29sVXNlT3V0cHV0KHsgYWxsb3c6IHRydWUgfSk7XG4gKiB9KTtcbiAqIGBgYFxuICpcbiAqICMjIEV4dGVybmFsIEludGVncmF0aW9uXG4gKlxuICogU3Vic2NyaWJlIHRvIGV2ZW50cyB0byBmb3J3YXJkIGxvZ3MgdG8gZXh0ZXJuYWwgc3lzdGVtczpcbiAqXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBpbXBvcnQgeyBsb2dnZXIgfSBmcm9tICdAZ29vZGZvb3QvY2xhdWRlLWNvZGUtaG9va3MnO1xuICogaW1wb3J0IHBpbm8gZnJvbSAncGlubyc7XG4gKlxuICogY29uc3QgcGlub0xvZ2dlciA9IHBpbm8oeyBsZXZlbDogJ2RlYnVnJyB9KTtcbiAqXG4gKiBsb2dnZXIub24oJ2RlYnVnJywgKGV2ZW50KSA9PiBwaW5vTG9nZ2VyLmRlYnVnKGV2ZW50LCBldmVudC5tZXNzYWdlKSk7XG4gKiBsb2dnZXIub24oJ2luZm8nLCAoZXZlbnQpID0+IHBpbm9Mb2dnZXIuaW5mbyhldmVudCwgZXZlbnQubWVzc2FnZSkpO1xuICogbG9nZ2VyLm9uKCd3YXJuJywgKGV2ZW50KSA9PiBwaW5vTG9nZ2VyLndhcm4oZXZlbnQsIGV2ZW50Lm1lc3NhZ2UpKTtcbiAqIGxvZ2dlci5vbignZXJyb3InLCAoZXZlbnQpID0+IHBpbm9Mb2dnZXIuZXJyb3IoZXZlbnQsIGV2ZW50Lm1lc3NhZ2UpKTtcbiAqIGBgYFxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIERpcmVjdCB1c2FnZVxuICogaW1wb3J0IHsgbG9nZ2VyIH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiBsb2dnZXIuaW5mbygnU3RhcnRpbmcgb3BlcmF0aW9uJyk7XG4gKiBsb2dnZXIud2FybignUmVzb3VyY2UgbGltaXQgYXBwcm9hY2hpbmcnLCB7IHVzYWdlOiAwLjkgfSk7XG4gKlxuICogdHJ5IHtcbiAqICAgYXdhaXQgcmlza3lPcGVyYXRpb24oKTtcbiAqIH0gY2F0Y2ggKGVycikge1xuICogICBsb2dnZXIubG9nRXJyb3IoZXJyLCAnUmlza3kgb3BlcmF0aW9uIGZhaWxlZCcpO1xuICogfVxuICogYGBgXG4gKi9cbi8vIENMQVVERV9DT0RFX0hPT0tTX0xPR19FTlZfVkFSIGlzIHNldCB1bmNvbmRpdGlvbmFsbHkgYnkgdGhlIC0tbG9nLWVudi12YXIgYmFubmVyXG4vLyBiZWZvcmUgdGhpcyBtb2R1bGUgaW5pdGlhbGlzZXMuIElmIGFic2VudCwgZmFsbCBiYWNrIHRvIHRoZSBkZWZhdWx0IGVudiB2YXIgbmFtZS5cbmV4cG9ydCBjb25zdCBsb2dnZXIgPSBuZXcgTG9nZ2VyKHtcbiAgICBsb2dFbnZWYXI6IHByb2Nlc3MuZW52LkNMQVVERV9DT0RFX0hPT0tTX0xPR19FTlZfVkFSID8/IFwiQ0xBVURFX0NPREVfSE9PS1NfTE9HX0ZJTEVcIixcbn0pO1xuIiwgIi8qKlxuICogT3V0cHV0IHR5cGVzIGFuZCBidWlsZGVycyBmb3IgQ2xhdWRlIENvZGUgaG9va3MuXG4gKlxuICogUHJvdmlkZXMgdHlwZS1zYWZlIG91dHB1dCBidWlsZGVyIGZ1bmN0aW9ucyBmb3IgYWxsIDEyIGhvb2sgdHlwZXMuIEVhY2ggYnVpbGRlclxuICogYWNjZXB0cyBvcHRpb25zIHRoYXQgbWF0Y2ggdGhlIHdpcmUgZm9ybWF0IGV4cGVjdGVkIGJ5IENsYXVkZSBDb2RlLCB3aXRoIHR5cGVzXG4gKiBkZXJpdmVkIGZyb20gdGhlIENsYXVkZSBBZ2VudCBTREsncyBgU3luY0hvb2tKU09OT3V0cHV0YCB0eXBlLlxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzXG4gKiBAbW9kdWxlXG4gKi9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEV4aXQgQ29kZSBDb25zdGFudHNcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogRXhpdCBjb2RlcyB1c2VkIGJ5IENsYXVkZSBDb2RlIGhvb2tzLlxuICpcbiAqIHwgRXhpdCBDb2RlIHwgTmFtZSB8IFdoZW4gVXNlZCB8IENsYXVkZSBDb2RlIEJlaGF2aW9yIHxcbiAqIHwtLS0tLS0tLS0tLXwtLS0tLS18LS0tLS0tLS0tLS18LS0tLS0tLS0tLS0tLS0tLS0tLS0tfFxuICogfCAwIHwgU3VjY2VzcyB8IEhhbmRsZXIgcmV0dXJucyBub3JtYWxseSB8IENvbnRpbnVlLCBwYXJzZSBzdGRvdXQgYXMgSlNPTiB8XG4gKiB8IDEgfCBFcnJvciB8IEludmFsaWQgaW5wdXQsIG5vbi1ibG9ja2luZyBlcnJvciB8IE5vbi1ibG9ja2luZywgc3RkZXJyIHRvIHVzZXIgb25seSB8XG4gKiB8IDIgfCBCbG9jayB8IEhhbmRsZXIgdGhyb3dzIE9SIGBzdG9wUmVhc29uYCBzZXQgfCBCbG9ja2luZywgc3RkZXJyIHNob3duIHRvIENsYXVkZSB8XG4gKi9cbmV4cG9ydCBjb25zdCBFWElUX0NPREVTID0ge1xuICAgIC8qKiBIYW5kbGVyIGNvbXBsZXRlZCBzdWNjZXNzZnVsbHkuIENsYXVkZSBDb2RlIHBhcnNlcyBzdGRvdXQgYXMgSlNPTi4gKi9cbiAgICBTVUNDRVNTOiAwLFxuICAgIC8qKiBOb24tYmxvY2tpbmcgZXJyb3Igb2NjdXJyZWQgKGUuZy4sIGludmFsaWQgaW5wdXQpLiBzdGRlcnIgc2hvd24gdG8gdXNlciBvbmx5LiAqL1xuICAgIEVSUk9SOiAxLFxuICAgIC8qKiBIYW5kbGVyIHRocmV3IGV4Y2VwdGlvbiBPUiBibG9ja2luZyBhY3Rpb24gcmVxdWVzdGVkLiBzdGRlcnIgc2hvd24gdG8gQ2xhdWRlLiAqL1xuICAgIEJMT0NLOiAyLFxufTtcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIE91dHB1dCBCdWlsZGVyIEZhY3Rvcmllc1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBGYWN0b3J5IGZvciBob29rcyB0aGF0IGhhdmUgaG9va1NwZWNpZmljT3V0cHV0IHdpdGggYSBob29rRXZlbnROYW1lIGRpc2NyaW1pbmF0b3IuXG4gKiBAcGFyYW0gaG9va1R5cGUgLSBUaGUgaG9vayB0eXBlIG5hbWUgdXNlZCBhcyB0aGUgX3R5cGUgZGlzY3JpbWluYXRvclxuICogQHJldHVybnMgQSBidWlsZGVyIGZ1bmN0aW9uIHRoYXQgY3JlYXRlcyB0aGUgb3V0cHV0IG9iamVjdFxuICogQGludGVybmFsXG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoaG9va1R5cGUpIHtcbiAgICByZXR1cm4gKG9wdGlvbnMgPSB7fSkgPT4ge1xuICAgICAgICBjb25zdCB7IGhvb2tTcGVjaWZpY091dHB1dCwgLi4ucmVzdCB9ID0gb3B0aW9ucztcbiAgICAgICAgY29uc3Qgc3Rkb3V0ID0gaG9va1NwZWNpZmljT3V0cHV0ICE9PSB1bmRlZmluZWRcbiAgICAgICAgICAgID8geyAuLi5yZXN0LCBob29rU3BlY2lmaWNPdXRwdXQ6IHsgaG9va0V2ZW50TmFtZTogaG9va1R5cGUsIC4uLmhvb2tTcGVjaWZpY091dHB1dCB9IH1cbiAgICAgICAgICAgIDogcmVzdDtcbiAgICAgICAgcmV0dXJuIHsgX3R5cGU6IGhvb2tUeXBlLCBzdGRvdXQgfTtcbiAgICB9O1xufVxuLyoqXG4gKiBGYWN0b3J5IGZvciBob29rcyB0aGF0IG9ubHkgdXNlIENvbW1vbk9wdGlvbnMgKHNpbXBsZSBwYXNzdGhyb3VnaCkuXG4gKiBAcGFyYW0gaG9va1R5cGUgLSBUaGUgaG9vayB0eXBlIG5hbWUgdXNlZCBhcyB0aGUgX3R5cGUgZGlzY3JpbWluYXRvclxuICogQHJldHVybnMgQSBidWlsZGVyIGZ1bmN0aW9uIHRoYXQgY3JlYXRlcyB0aGUgb3V0cHV0IG9iamVjdFxuICogQGludGVybmFsXG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZVNpbXBsZU91dHB1dEJ1aWxkZXIoaG9va1R5cGUpIHtcbiAgICByZXR1cm4gKG9wdGlvbnMgPSB7fSkgPT4gKHtcbiAgICAgICAgX3R5cGU6IGhvb2tUeXBlLFxuICAgICAgICBzdGRvdXQ6IG9wdGlvbnMsXG4gICAgfSk7XG59XG4vKipcbiAqIEZhY3RvcnkgZm9yIHdvcmt0cmVlIGhvb2tzIChXb3JrdHJlZUNyZWF0ZSwgV29ya3RyZWVSZW1vdmUpLlxuICpcbiAqIFRoZXNlIGFyZSBjb21tYW5kIGhvb2tzIHdob3NlIHdpcmUgcHJvdG9jb2wgaXMgYSAqKmJhcmUgcGF0aCBvbiBzdGRvdXQqKiwgbm90IEpTT046XG4gKiBDbGF1ZGUgQ29kZSByZWFkcyB0aGUgaG9vaydzIHN0ZG91dCB2ZXJiYXRpbSBhbmQgYGNoZGlyYHMgaW50byBpdC4gVGhlIGJ1aWxkZXIgY2Fycmllc1xuICogdGhlIHBhdGggaW4gYHJhd1N0ZG91dGAgc28gdGhlIHJ1bnRpbWUgZW1pdHMgaXQgYXMgcGxhaW4gdGV4dCBpbnN0ZWFkIG9mXG4gKiBgSlNPTi5zdHJpbmdpZnkoc3Rkb3V0KWAuXG4gKiBAcGFyYW0gaG9va1R5cGUgLSBUaGUgaG9vayB0eXBlIG5hbWUgdXNlZCBhcyB0aGUgX3R5cGUgZGlzY3JpbWluYXRvclxuICogQHJldHVybnMgQSBidWlsZGVyIGZ1bmN0aW9uIHRoYXQgY3JlYXRlcyB0aGUgb3V0cHV0IG9iamVjdFxuICogQGludGVybmFsXG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZVdvcmt0cmVlT3V0cHV0QnVpbGRlcihob29rVHlwZSkge1xuICAgIHJldHVybiAob3B0aW9ucykgPT4ge1xuICAgICAgICBjb25zdCB7IHdvcmt0cmVlUGF0aCwgLi4ucmVzdCB9ID0gb3B0aW9ucztcbiAgICAgICAgcmV0dXJuIHsgX3R5cGU6IGhvb2tUeXBlLCBzdGRvdXQ6IHJlc3QsIHJhd1N0ZG91dDogd29ya3RyZWVQYXRoIH07XG4gICAgfTtcbn1cbi8qKlxuICogRmFjdG9yeSBmb3IgaG9va3MgdGhhdCB1c2UgZGVjaXNpb24tYmFzZWQgb3B0aW9ucyAoU3RvcCwgU3ViYWdlbnRTdG9wKS5cbiAqIEBwYXJhbSBob29rVHlwZSAtIFRoZSBob29rIHR5cGUgbmFtZSB1c2VkIGFzIHRoZSBfdHlwZSBkaXNjcmltaW5hdG9yXG4gKiBAcmV0dXJucyBBIGJ1aWxkZXIgZnVuY3Rpb24gdGhhdCBjcmVhdGVzIHRoZSBvdXRwdXQgb2JqZWN0XG4gKiBAaW50ZXJuYWxcbiAqL1xuZnVuY3Rpb24gY3JlYXRlRGVjaXNpb25PdXRwdXRCdWlsZGVyKGhvb2tUeXBlKSB7XG4gICAgcmV0dXJuIChvcHRpb25zID0ge30pID0+ICh7XG4gICAgICAgIF90eXBlOiBob29rVHlwZSxcbiAgICAgICAgc3Rkb3V0OiBvcHRpb25zLFxuICAgIH0pO1xufVxuLyoqXG4gKiBGYWN0b3J5IGZvciBleGl0LWNvZGUtYmFzZWQgaG9va3MgKFRlYW1tYXRlSWRsZSwgVGFza0NvbXBsZXRlZCkuXG4gKlxuICogVGhlc2UgaG9va3MgZG9uJ3QgdXNlIEpTT04gZGVjaXNpb24gY29udHJvbCAobm8gQ29tbW9uT3B0aW9ucykuXG4gKiBUaGUgb25seSBvcHRpb24gaXMgYHN0ZGVycmAgXHUyMDE0IHdoZW4gcHJlc2VudCwgaXQgdHJpZ2dlcnMgZXhpdCBjb2RlIDIgKEJMT0NLKS5cbiAqIFN0ZG91dCBhbHdheXMgcmVjZWl2ZXMgYHt9YCAoZW1wdHkgSlNPTiBvYmplY3QpLlxuICogQHBhcmFtIGhvb2tUeXBlIC0gVGhlIGhvb2sgdHlwZSBuYW1lIHVzZWQgYXMgdGhlIF90eXBlIGRpc2NyaW1pbmF0b3JcbiAqIEByZXR1cm5zIEEgYnVpbGRlciBmdW5jdGlvbiB0aGF0IGNyZWF0ZXMgdGhlIG91dHB1dCBvYmplY3RcbiAqIEBpbnRlcm5hbFxuICovXG5mdW5jdGlvbiBjcmVhdGVFeGl0Q29kZU91dHB1dEJ1aWxkZXIoaG9va1R5cGUpIHtcbiAgICByZXR1cm4gKHsgc3RkZXJyIH0gPSB7fSkgPT4gKHtcbiAgICAgICAgX3R5cGU6IGhvb2tUeXBlLFxuICAgICAgICBzdGRvdXQ6IHt9LFxuICAgICAgICAuLi4oc3RkZXJyICE9PSB1bmRlZmluZWQgPyB7IHN0ZGVyciB9IDoge30pLFxuICAgIH0pO1xufVxuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgUHJlVG9vbFVzZSBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgUHJlVG9vbFVzZU91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQWxsb3cgdG9vbCBleGVjdXRpb25cbiAqIHByZVRvb2xVc2VPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHsgcGVybWlzc2lvbkRlY2lzaW9uOiAnYWxsb3cnIH1cbiAqIH0pO1xuICpcbiAqIC8vIERlbnkgd2l0aCByZWFzb25cbiAqIHByZVRvb2xVc2VPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICBwZXJtaXNzaW9uRGVjaXNpb246ICdkZW55JyxcbiAqICAgICBwZXJtaXNzaW9uRGVjaXNpb25SZWFzb246ICdEYW5nZXJvdXMgY29tbWFuZCBkZXRlY3RlZCdcbiAqICAgfVxuICogfSk7XG4gKlxuICogLy8gQWxsb3cgd2l0aCBtb2RpZmllZCBpbnB1dFxuICogcHJlVG9vbFVzZU91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDoge1xuICogICAgIHBlcm1pc3Npb25EZWNpc2lvbjogJ2FsbG93JyxcbiAqICAgICB1cGRhdGVkSW5wdXQ6IHsgY29tbWFuZDogJ2xzIC1sYScgfVxuICogICB9XG4gKiB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgcHJlVG9vbFVzZU91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiUHJlVG9vbFVzZVwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFBvc3RUb29sVXNlIGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBQb3N0VG9vbFVzZU91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQWRkIGNvbnRleHQgYWZ0ZXIgYSBmaWxlIHJlYWRcbiAqIHBvc3RUb29sVXNlT3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgYWRkaXRpb25hbENvbnRleHQ6ICdGaWxlIGNvbnRhaW5zIHNlbnNpdGl2ZSBkYXRhJ1xuICogICB9XG4gKiB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgcG9zdFRvb2xVc2VPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIlBvc3RUb29sVXNlXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgUG9zdFRvb2xVc2VGYWlsdXJlIGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBQb3N0VG9vbFVzZUZhaWx1cmVPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIHBvc3RUb29sVXNlRmFpbHVyZU91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDoge1xuICogICAgIGFkZGl0aW9uYWxDb250ZXh0OiAnVHJ5IHVzaW5nIGEgZGlmZmVyZW50IGFwcHJvYWNoJ1xuICogICB9XG4gKiB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgcG9zdFRvb2xVc2VGYWlsdXJlT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJQb3N0VG9vbFVzZUZhaWx1cmVcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBQb3N0VG9vbEJhdGNoIGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBQb3N0VG9vbEJhdGNoT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBwb3N0VG9vbEJhdGNoT3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgYWRkaXRpb25hbENvbnRleHQ6ICdBbGwgZWRpdHMgaW4gdGhlIGJhdGNoIHdlcmUgYXBwbGllZCBzdWNjZXNzZnVsbHknXG4gKiAgIH1cbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBwb3N0VG9vbEJhdGNoT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJQb3N0VG9vbEJhdGNoXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgVXNlclByb21wdEV4cGFuc2lvbiBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgVXNlclByb21wdEV4cGFuc2lvbk91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogdXNlclByb21wdEV4cGFuc2lvbk91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDoge1xuICogICAgIGFkZGl0aW9uYWxDb250ZXh0OiAnU2xhc2ggY29tbWFuZCBleHBhbmRlZCB3aXRoIGFkZGl0aW9uYWwgY29udGV4dCdcbiAqICAgfVxuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHVzZXJQcm9tcHRFeHBhbnNpb25PdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIlVzZXJQcm9tcHRFeHBhbnNpb25cIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBVc2VyUHJvbXB0U3VibWl0IGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBVc2VyUHJvbXB0U3VibWl0T3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiB1c2VyUHJvbXB0U3VibWl0T3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgYWRkaXRpb25hbENvbnRleHQ6ICdUaGlzIHByb2plY3QgdXNlcyBUeXBlU2NyaXB0IHN0cmljdCBtb2RlJ1xuICogICB9XG4gKiB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgdXNlclByb21wdFN1Ym1pdE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiVXNlclByb21wdFN1Ym1pdFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFNlc3Npb25TdGFydCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgU2Vzc2lvblN0YXJ0T3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBzZXNzaW9uU3RhcnRPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICBhZGRpdGlvbmFsQ29udGV4dDogSlNPTi5zdHJpbmdpZnkoeyBwcm9qZWN0OiAnbXktcHJvamVjdCcgfSlcbiAqICAgfVxuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHNlc3Npb25TdGFydE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiU2Vzc2lvblN0YXJ0XCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgU2Vzc2lvbkVuZCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgU2Vzc2lvbkVuZE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogc2Vzc2lvbkVuZE91dHB1dCh7fSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHNlc3Npb25FbmRPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlU2ltcGxlT3V0cHV0QnVpbGRlcihcIlNlc3Npb25FbmRcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBTdG9wIGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBTdG9wT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBBbGxvdyB0aGUgc3RvcFxuICogc3RvcE91dHB1dCh7IGRlY2lzaW9uOiAnYXBwcm92ZScgfSk7XG4gKlxuICogLy8gQmxvY2sgd2l0aCByZWFzb25cbiAqIHN0b3BPdXRwdXQoe1xuICogICBkZWNpc2lvbjogJ2Jsb2NrJyxcbiAqICAgcmVhc29uOiAnVGhlcmUgYXJlIHVuY29tbWl0dGVkIGNoYW5nZXMnXG4gKiB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3Qgc3RvcE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVEZWNpc2lvbk91dHB1dEJ1aWxkZXIoXCJTdG9wXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgU3RvcEZhaWx1cmUgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFN0b3BGYWlsdXJlT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBzdG9wRmFpbHVyZU91dHB1dCh7fSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHN0b3BGYWlsdXJlT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZVNpbXBsZU91dHB1dEJ1aWxkZXIoXCJTdG9wRmFpbHVyZVwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFN1YmFnZW50U3RhcnQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFN1YmFnZW50U3RhcnRPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIHN1YmFnZW50U3RhcnRPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICBhZGRpdGlvbmFsQ29udGV4dDogJ0ZvY3VzIG9uIGZpbmRpbmcgcGF0dGVybnMnXG4gKiAgIH1cbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBzdWJhZ2VudFN0YXJ0T3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJTdWJhZ2VudFN0YXJ0XCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgU3ViYWdlbnRTdG9wIGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBTdWJhZ2VudFN0b3BPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEJsb2NrIHdpdGggcmVhc29uXG4gKiBzdWJhZ2VudFN0b3BPdXRwdXQoe1xuICogICBkZWNpc2lvbjogJ2Jsb2NrJyxcbiAqICAgcmVhc29uOiAnVGFzayBub3QgY29tcGxldGUnXG4gKiB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3Qgc3ViYWdlbnRTdG9wT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZURlY2lzaW9uT3V0cHV0QnVpbGRlcihcIlN1YmFnZW50U3RvcFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIE5vdGlmaWNhdGlvbiBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgTm90aWZpY2F0aW9uT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBBZGQgY29udGV4dCBhYm91dCB0aGUgbm90aWZpY2F0aW9uXG4gKiBub3RpZmljYXRpb25PdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICBhZGRpdGlvbmFsQ29udGV4dDogJ05vdGlmaWNhdGlvbiBmb3J3YXJkZWQgdG8gU2xhY2sgI2FsZXJ0cyBjaGFubmVsJ1xuICogICB9XG4gKiB9KTtcbiAqXG4gKiAvLyBTdXBwcmVzcyB0aGUgbm90aWZpY2F0aW9uXG4gKiBub3RpZmljYXRpb25PdXRwdXQoeyBzdXBwcmVzc091dHB1dDogdHJ1ZSB9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3Qgbm90aWZpY2F0aW9uT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJOb3RpZmljYXRpb25cIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBQcmVDb21wYWN0IGhvb2tzLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBQcmVDb21wYWN0T3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBwcmVDb21wYWN0T3V0cHV0KHtcbiAqICAgc3lzdGVtTWVzc2FnZTogJ1JlbWVtYmVyOiBzdHJpY3QgbW9kZSBpcyBlbmFibGVkJ1xuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHByZUNvbXBhY3RPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlU2ltcGxlT3V0cHV0QnVpbGRlcihcIlByZUNvbXBhY3RcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBQb3N0Q29tcGFjdCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgUG9zdENvbXBhY3RPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIHBvc3RDb21wYWN0T3V0cHV0KHt9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgcG9zdENvbXBhY3RPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlU2ltcGxlT3V0cHV0QnVpbGRlcihcIlBvc3RDb21wYWN0XCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgUGVybWlzc2lvblJlcXVlc3QgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFBlcm1pc3Npb25SZXF1ZXN0T3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBBdXRvLWFwcHJvdmVcbiAqIHBlcm1pc3Npb25SZXF1ZXN0T3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgZGVjaXNpb246IHsgYmVoYXZpb3I6ICdhbGxvdycgfVxuICogICB9XG4gKiB9KTtcbiAqXG4gKiAvLyBBdXRvLWFwcHJvdmUgd2l0aCBtb2RpZmllZCBpbnB1dFxuICogcGVybWlzc2lvblJlcXVlc3RPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICBkZWNpc2lvbjoge1xuICogICAgICAgYmVoYXZpb3I6ICdhbGxvdycsXG4gKiAgICAgICB1cGRhdGVkSW5wdXQ6IHsgZmlsZV9wYXRoOiAnL3NhZmUvcGF0aCcgfVxuICogICAgIH1cbiAqICAgfVxuICogfSk7XG4gKlxuICogLy8gQXV0by1kZW55XG4gKiBwZXJtaXNzaW9uUmVxdWVzdE91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDoge1xuICogICAgIGRlY2lzaW9uOiB7XG4gKiAgICAgICBiZWhhdmlvcjogJ2RlbnknLFxuICogICAgICAgbWVzc2FnZTogJ05vdCBhbGxvd2VkJyxcbiAqICAgICAgIGludGVycnVwdDogdHJ1ZVxuICogICAgIH1cbiAqICAgfVxuICogfSk7XG4gKlxuICogLy8gRmFsbCB0aHJvdWdoIHRvIG5vcm1hbCBwcm9tcHRcbiAqIHBlcm1pc3Npb25SZXF1ZXN0T3V0cHV0KHt9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgcGVybWlzc2lvblJlcXVlc3RPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIlBlcm1pc3Npb25SZXF1ZXN0XCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgUGVybWlzc2lvbkRlbmllZCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgUGVybWlzc2lvbkRlbmllZE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gTG9nIGFuZCBhbGxvdyByZXRyeVxuICogcGVybWlzc2lvbkRlbmllZE91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDogeyByZXRyeTogdHJ1ZSB9XG4gKiB9KTtcbiAqXG4gKiAvLyBMb2cgd2l0aG91dCByZXRyeVxuICogcGVybWlzc2lvbkRlbmllZE91dHB1dCh7fSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHBlcm1pc3Npb25EZW5pZWRPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIlBlcm1pc3Npb25EZW5pZWRcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBTZXR1cCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgU2V0dXBPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEFkZCBjb250ZXh0IGR1cmluZyBzZXR1cFxuICogc2V0dXBPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICBhZGRpdGlvbmFsQ29udGV4dDogJ1Byb2plY3QgaW5pdGlhbGl6ZWQgd2l0aCBjdXN0b20gc2V0dGluZ3MnXG4gKiAgIH1cbiAqIH0pO1xuICpcbiAqIC8vIFNpbXBsZSBwYXNzdGhyb3VnaFxuICogc2V0dXBPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBzZXR1cE91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiU2V0dXBcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBUZWFtbWF0ZUlkbGUgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFRlYW1tYXRlSWRsZU91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQWxsb3cgdGVhbW1hdGUgdG8gZ28gaWRsZVxuICogdGVhbW1hdGVJZGxlT3V0cHV0KHt9KTtcbiAqXG4gKiAvLyBCbG9jayB3aXRoIGZlZWRiYWNrXG4gKiB0ZWFtbWF0ZUlkbGVPdXRwdXQoeyBzdGRlcnI6ICdDb250aW51ZSB3b3JraW5nOiB1bmZpbmlzaGVkIHRhc2tzIHJlbWFpbi4nIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCB0ZWFtbWF0ZUlkbGVPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlRXhpdENvZGVPdXRwdXRCdWlsZGVyKFwiVGVhbW1hdGVJZGxlXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgVGFza0NyZWF0ZWQgaG9va3MuXG4gKiBAcGFyYW0gb3B0aW9ucyAtIENvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgdGhlIGhvb2sgb3V0cHV0XG4gKiBAcmV0dXJucyBBIFRhc2tDcmVhdGVkT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBBbGxvdyB0YXNrIGNyZWF0aW9uXG4gKiB0YXNrQ3JlYXRlZE91dHB1dCh7fSk7XG4gKlxuICogLy8gQmxvY2sgd2l0aCBmZWVkYmFja1xuICogdGFza0NyZWF0ZWRPdXRwdXQoeyBzdGRlcnI6ICdDYW5ub3QgY3JlYXRlIHRhc2s6IG1pc3NpbmcgcmVxdWlyZWQgZmllbGRzLicgfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IHRhc2tDcmVhdGVkT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUV4aXRDb2RlT3V0cHV0QnVpbGRlcihcIlRhc2tDcmVhdGVkXCIpO1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgVGFza0NvbXBsZXRlZCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgVGFza0NvbXBsZXRlZE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gQWxsb3cgdGFzayBjb21wbGV0aW9uXG4gKiB0YXNrQ29tcGxldGVkT3V0cHV0KHt9KTtcbiAqXG4gKiAvLyBCbG9jayB3aXRoIGZlZWRiYWNrXG4gKiB0YXNrQ29tcGxldGVkT3V0cHV0KHsgc3RkZXJyOiAnQ2Fubm90IGNvbXBsZXRlOiB0ZXN0cyBhcmUgZmFpbGluZy4nIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCB0YXNrQ29tcGxldGVkT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUV4aXRDb2RlT3V0cHV0QnVpbGRlcihcIlRhc2tDb21wbGV0ZWRcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBFbGljaXRhdGlvbiBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEFuIEVsaWNpdGF0aW9uT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBBY2NlcHQgdGhlIGVsaWNpdGF0aW9uXG4gKiBlbGljaXRhdGlvbk91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDogeyBhY3Rpb246ICdhY2NlcHQnLCBjb250ZW50OiB7IHVzZXJuYW1lOiAnYWxpY2UnIH0gfVxuICogfSk7XG4gKlxuICogLy8gRGVjbGluZSB0aGUgZWxpY2l0YXRpb25cbiAqIGVsaWNpdGF0aW9uT3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7IGFjdGlvbjogJ2RlY2xpbmUnIH1cbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBlbGljaXRhdGlvbk91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiRWxpY2l0YXRpb25cIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBFbGljaXRhdGlvblJlc3VsdCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEFuIEVsaWNpdGF0aW9uUmVzdWx0T3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBlbGljaXRhdGlvblJlc3VsdE91dHB1dCh7fSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IGVsaWNpdGF0aW9uUmVzdWx0T3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJFbGljaXRhdGlvblJlc3VsdFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIENvbmZpZ0NoYW5nZSBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgQ29uZmlnQ2hhbmdlT3V0cHV0IG9iamVjdCByZWFkeSBmb3IgdGhlIHJ1bnRpbWVcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25maWdDaGFuZ2VPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBjb25maWdDaGFuZ2VPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlU2ltcGxlT3V0cHV0QnVpbGRlcihcIkNvbmZpZ0NoYW5nZVwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIEluc3RydWN0aW9uc0xvYWRlZCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEFuIEluc3RydWN0aW9uc0xvYWRlZE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogaW5zdHJ1Y3Rpb25zTG9hZGVkT3V0cHV0KHt9KTtcbiAqIGBgYFxuICovXG5leHBvcnQgY29uc3QgaW5zdHJ1Y3Rpb25zTG9hZGVkT3V0cHV0ID0gXG4vKiBAX19QVVJFX18gKi8gY3JlYXRlU2ltcGxlT3V0cHV0QnVpbGRlcihcIkluc3RydWN0aW9uc0xvYWRlZFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFdvcmt0cmVlQ3JlYXRlIGhvb2tzLlxuICpcbiAqIFRoZSBydW50aW1lIHdyaXRlcyBgd29ya3RyZWVQYXRoYCB0byBzdGRvdXQgYXMgcGxhaW4gdGV4dCAobm90IEpTT04pIHNvIENsYXVkZSBDb2RlXG4gKiBjYW4gYGNoZGlyYCBpbnRvIHRoZSBjcmVhdGVkIHdvcmt0cmVlLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBXb3JrdHJlZUNyZWF0ZU91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogd29ya3RyZWVDcmVhdGVPdXRwdXQoeyB3b3JrdHJlZVBhdGg6ICcvYWJzL3BhdGgvdG8vd29ya3RyZWUnIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCB3b3JrdHJlZUNyZWF0ZU91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVXb3JrdHJlZU91dHB1dEJ1aWxkZXIoXCJXb3JrdHJlZUNyZWF0ZVwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIFdvcmt0cmVlUmVtb3ZlIGhvb2tzLlxuICpcbiAqIFdoZW4gYHdvcmt0cmVlUGF0aGAgaXMgc3VwcGxpZWQsIHRoZSBydW50aW1lIHdyaXRlcyBpdCB0byBzdGRvdXQgYXMgcGxhaW4gdGV4dCAobm90XG4gKiBKU09OKSwgbWF0Y2hpbmcgdGhlIHdvcmt0cmVlIGNvbW1hbmQtaG9vayBwcm90b2NvbC5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgV29ya3RyZWVSZW1vdmVPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIFBsYWluLXRleHQgcGF0aCBwcm90b2NvbFxuICogd29ya3RyZWVSZW1vdmVPdXRwdXQoeyB3b3JrdHJlZVBhdGg6ICcvYWJzL3BhdGgvdG8vd29ya3RyZWUnIH0pO1xuICpcbiAqIC8vIE5vIHBhdGggcGF5bG9hZFxuICogd29ya3RyZWVSZW1vdmVPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCB3b3JrdHJlZVJlbW92ZU91dHB1dCA9IChvcHRpb25zID0ge30pID0+IHtcbiAgICBjb25zdCB7IHdvcmt0cmVlUGF0aCwgLi4ucmVzdCB9ID0gb3B0aW9ucztcbiAgICByZXR1cm4gd29ya3RyZWVQYXRoICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyB7IF90eXBlOiBcIldvcmt0cmVlUmVtb3ZlXCIsIHN0ZG91dDogcmVzdCwgcmF3U3Rkb3V0OiB3b3JrdHJlZVBhdGggfVxuICAgICAgICA6IHsgX3R5cGU6IFwiV29ya3RyZWVSZW1vdmVcIiwgc3Rkb3V0OiByZXN0IH07XG59O1xuLyoqXG4gKiBDcmVhdGVzIGFuIG91dHB1dCBmb3IgQ3dkQ2hhbmdlZCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgQ3dkQ2hhbmdlZE91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gUmV0dXJuIGFkZGl0aW9uYWwgcGF0aHMgdG8gd2F0Y2ggYWZ0ZXIgdGhlIGN3ZCBjaGFuZ2VcbiAqIGN3ZENoYW5nZWRPdXRwdXQoe1xuICogICBob29rU3BlY2lmaWNPdXRwdXQ6IHtcbiAqICAgICB3YXRjaFBhdGhzOiBbJy9uZXcvcGF0aC90by93YXRjaCddXG4gKiAgIH1cbiAqIH0pO1xuICpcbiAqIC8vIFNpbXBsZSBwYXNzdGhyb3VnaFxuICogY3dkQ2hhbmdlZE91dHB1dCh7fSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IGN3ZENoYW5nZWRPdXRwdXQgPSAvKiBAX19QVVJFX18gKi8gY3JlYXRlSG9va1NwZWNpZmljT3V0cHV0QnVpbGRlcihcIkN3ZENoYW5nZWRcIik7XG4vKipcbiAqIENyZWF0ZXMgYW4gb3V0cHV0IGZvciBGaWxlQ2hhbmdlZCBob29rcy5cbiAqIEBwYXJhbSBvcHRpb25zIC0gQ29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgaG9vayBvdXRwdXRcbiAqIEByZXR1cm5zIEEgRmlsZUNoYW5nZWRPdXRwdXQgb2JqZWN0IHJlYWR5IGZvciB0aGUgcnVudGltZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIFVwZGF0ZSB0aGUgc2V0IG9mIHdhdGNoZWQgcGF0aHNcbiAqIGZpbGVDaGFuZ2VkT3V0cHV0KHtcbiAqICAgaG9va1NwZWNpZmljT3V0cHV0OiB7XG4gKiAgICAgd2F0Y2hQYXRoczogWycvcGF0aC90by93YXRjaCcsICcvYW5vdGhlci9wYXRoJ11cbiAqICAgfVxuICogfSk7XG4gKlxuICogLy8gU2ltcGxlIHBhc3N0aHJvdWdoXG4gKiBmaWxlQ2hhbmdlZE91dHB1dCh7fSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNvbnN0IGZpbGVDaGFuZ2VkT3V0cHV0ID0gLyogQF9fUFVSRV9fICovIGNyZWF0ZUhvb2tTcGVjaWZpY091dHB1dEJ1aWxkZXIoXCJGaWxlQ2hhbmdlZFwiKTtcbi8qKlxuICogQ3JlYXRlcyBhbiBvdXRwdXQgZm9yIE1lc3NhZ2VEaXNwbGF5IGhvb2tzLlxuICpcbiAqIE1lc3NhZ2VEaXNwbGF5IGlzIGRpc3BsYXktb25seTogdGhlIGBkaXNwbGF5Q29udGVudGAgZmllbGQgcmVwbGFjZXMgdGhlIGRlbHRhIG9uXG4gKiBzY3JlZW4gd2l0aG91dCBjaGFuZ2luZyB0aGUgc3RvcmVkIG1lc3NhZ2Ugb3Igd2hhdCB0aGUgbW9kZWwgc2Vlcy4gT21pdFxuICogYGRpc3BsYXlDb250ZW50YCAob3Igc2V0IGl0IHRvIHRoZSBvcmlnaW5hbCBkZWx0YSkgdG8gbGVhdmUgdGhlIGRpc3BsYXkgdW5jaGFuZ2VkLlxuICogQHBhcmFtIG9wdGlvbnMgLSBDb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIHRoZSBob29rIG91dHB1dFxuICogQHJldHVybnMgQSBNZXNzYWdlRGlzcGxheU91dHB1dCBvYmplY3QgcmVhZHkgZm9yIHRoZSBydW50aW1lXG4gKiBAZXhhbXBsZVxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gUmVwbGFjZSB0aGUgZGVsdGEgc2hvd24gb24gc2NyZWVuXG4gKiBtZXNzYWdlRGlzcGxheU91dHB1dCh7XG4gKiAgIGhvb2tTcGVjaWZpY091dHB1dDogeyBkaXNwbGF5Q29udGVudDogXCJbcmVkYWN0ZWRdXCIgfVxuICogfSk7XG4gKlxuICogLy8gUGFzc3Rocm91Z2ggKG5vIGRpc3BsYXkgbW9kaWZpY2F0aW9uKVxuICogbWVzc2FnZURpc3BsYXlPdXRwdXQoe30pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjb25zdCBtZXNzYWdlRGlzcGxheU91dHB1dCA9IC8qIEBfX1BVUkVfXyAqLyBjcmVhdGVIb29rU3BlY2lmaWNPdXRwdXRCdWlsZGVyKFwiTWVzc2FnZURpc3BsYXlcIik7XG4iLCAiLyoqXG4gKiBSdW50aW1lIG1vZHVsZSBmb3IgQ2xhdWRlIENvZGUgaG9va3MuXG4gKlxuICogSGFuZGxlcyBzdGRpbi9zdGRvdXQvZXhpdCBjb2RlIHNlbWFudGljcyBmb3IgY29tcGlsZWQgaG9vayBleGVjdXRpb24uXG4gKiBUaGlzIG1vZHVsZSBpcyB0aGUgY29yZSBvcmNoZXN0cmF0b3IgdGhhdDpcbiAqIC0gUmVhZHMgSlNPTiBmcm9tIHN0ZGluICh3aXJlIGZvcm1hdCB3aXRoIHNuYWtlX2Nhc2UgcHJvcGVydGllcylcbiAqIC0gSW52b2tlcyB0aGUgaG9vayBoYW5kbGVyXG4gKiAtIFdyaXRlcyBvdXRwdXQgdG8gc3Rkb3V0XG4gKiAtIE1hbmFnZXMgZXhpdCBjb2Rlc1xuICogQG1vZHVsZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEluIGEgY29tcGlsZWQgaG9vayBmaWxlXG4gKiBpbXBvcnQgeyBleGVjdXRlIH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzL3J1bnRpbWUnO1xuICogaW1wb3J0IG15SG9vayBmcm9tICcuL215LWhvb2suanMnO1xuICpcbiAqIGV4ZWN1dGUobXlIb29rKTtcbiAqIGBgYFxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzXG4gKi9cbmltcG9ydCB7IHBlcnNpc3RFbnZWYXIsIHBlcnNpc3RFbnZWYXJzIH0gZnJvbSBcIi4vZW52LmpzXCI7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tIFwiLi9sb2dnZXIuanNcIjtcbmltcG9ydCB7IEVYSVRfQ09ERVMgfSBmcm9tIFwiLi9vdXRwdXRzLmpzXCI7XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBTdGRpbi9TdGRvdXQgSGFuZGxpbmdcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8qKlxuICogUmVhZHMgYWxsIGRhdGEgZnJvbSBzdGRpbi5cbiAqIEByZXR1cm5zIFByb21pc2UgcmVzb2x2aW5nIHRvIHRoZSBjb21wbGV0ZSBzdGRpbiBjb250ZW50XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHJlYWRTdGRpbigpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBjb25zdCBjaHVua3MgPSBbXTtcbiAgICAgICAgLy8gU2V0IGVuY29kaW5nIGZpcnN0IHRvIGVuc3VyZSBkYXRhIGV2ZW50cyByZWNlaXZlIHN0cmluZ3NcbiAgICAgICAgcHJvY2Vzcy5zdGRpbi5zZXRFbmNvZGluZyhcInV0Zi04XCIpO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZGF0YVwiLCAoY2h1bmspID0+IHtcbiAgICAgICAgICAgIGNodW5rcy5wdXNoKGNodW5rKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHByb2Nlc3Muc3RkaW4ub24oXCJlbmRcIiwgKCkgPT4ge1xuICAgICAgICAgICAgcmVzb2x2ZShjaHVua3Muam9pbihcIlwiKSk7XG4gICAgICAgIH0pO1xuICAgICAgICBwcm9jZXNzLnN0ZGluLm9uKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICAgICAgICByZWplY3QoZXJyb3IpO1xuICAgICAgICB9KTtcbiAgICB9KTtcbn1cbi8qKlxuICogUGFyc2VzIHN0ZGluIEpTT04gaW5wdXQuXG4gKiBAcGFyYW0gc3RkaW5Db250ZW50IC0gUmF3IHN0ZGluIGNvbnRlbnRcbiAqIEByZXR1cm5zIFBhcnNlZCBpbnB1dCAod2lyZSBmb3JtYXQgd2l0aCBzbmFrZV9jYXNlIHByb3BlcnRpZXMpXG4gKiBAdGhyb3dzIEVycm9yIGlmIEpTT04gaXMgbWFsZm9ybWVkXG4gKi9cbmZ1bmN0aW9uIHBhcnNlU3RkaW5JbnB1dChzdGRpbkNvbnRlbnQpIHtcbiAgICAvLyBQYXJzZSBKU09OIC0gaW5wdXQgdXNlcyB3aXJlIGZvcm1hdCAoc25ha2VfY2FzZSkgZGlyZWN0bHlcbiAgICBjb25zdCByYXdJbnB1dCA9IEpTT04ucGFyc2Uoc3RkaW5Db250ZW50KTtcbiAgICByZXR1cm4gcmF3SW5wdXQ7XG59XG4vKipcbiAqIFdyaXRlcyBob29rIG91dHB1dCB0byBzdGRvdXQuXG4gKlxuICogT3V0cHV0IHVzZXMgY2FtZWxDYXNlIGtleXMgcGVyIENsYXVkZSBDb2RlIGhvb2sgc3BlY2lmaWNhdGlvbi5cbiAqIEBwYXJhbSBvdXRwdXQgLSBUaGUgaG9vayBvdXRwdXQgdG8gd3JpdGVcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rcyNob29rLW91dHB1dC1zdHJ1Y3R1cmVcbiAqL1xuZnVuY3Rpb24gd3JpdGVTdGRvdXQob3V0cHV0KSB7XG4gICAgLy8gT3V0cHV0IHVzZXMgY2FtZWxDYXNlIC0gbm8gdHJhbnNmb3JtYXRpb24gbmVlZGVkXG4gICAgcHJvY2Vzcy5zdGRvdXQud3JpdGUoSlNPTi5zdHJpbmdpZnkob3V0cHV0KSk7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFcnJvciBIYW5kbGluZ1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLyoqXG4gKiBDcmVhdGVzIGFuIGVycm9yIG91dHB1dCBmb3IgbWFsZm9ybWVkIHN0ZGluIEpTT04uXG4gKiBAcGFyYW0gZXJyb3IgLSBUaGUgcGFyc2UgZXJyb3JcbiAqIEByZXR1cm5zIEhvb2tPdXRwdXQgd2l0aCBlbXB0eSBzdGRvdXRcbiAqL1xuZnVuY3Rpb24gY3JlYXRlTWFsZm9ybWVkSW5wdXRPdXRwdXQoZXJyb3IpIHtcbiAgICBsb2dnZXIuZXJyb3IoYEludmFsaWQgSlNPTiBpbnB1dDogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCk7XG4gICAgcmV0dXJuIHsgc3Rkb3V0OiB7fSB9O1xufVxuLyoqXG4gKiBXcml0ZXMgaGFuZGxlciBlcnJvciBzdGFja3RyYWNlIHRvIHN0ZGVyciBhbmQgZXhpdHMgd2l0aCBjb2RlIDIuXG4gKlxuICogV2hlbiBhIGhvb2sgaGFuZGxlciB0aHJvd3MgYW4gZXhjZXB0aW9uOlxuICogLSBTdGFja3RyYWNlICh3aXRoIHNvdXJjZW1hcHMgaWYgYXZhaWxhYmxlKSBpcyBvdXRwdXQgdG8gc3RkZXJyXG4gKiAtIFByb2Nlc3MgZXhpdHMgd2l0aCBjb2RlIDIgKEJMT0NLKVxuICogLSBObyBKU09OIGlzIG91dHB1dCB0byBzdGRvdXRcbiAqIEBwYXJhbSBlcnJvciAtIFRoZSBlcnJvciB0aHJvd24gYnkgdGhlIGhhbmRsZXJcbiAqL1xuZnVuY3Rpb24gaGFuZGxlSGFuZGxlckVycm9yKGVycm9yKSB7XG4gICAgLy8gV3JpdGUgc3RhY2sgdHJhY2UgdG8gc3RkZXJyIChzb3VyY2VtYXBzIGFyZSBhcHBsaWVkIGF1dG9tYXRpY2FsbHkgYnkgTm9kZS5qcylcbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgJHtlcnJvci5zdGFjayA/PyBlcnJvci5tZXNzYWdlfVxcbmApO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYCR7U3RyaW5nKGVycm9yKX1cXG5gKTtcbiAgICB9XG4gICAgLy8gTG9nIHRvIGZpbGUgaWYgY29uZmlndXJlZFxuICAgIGxvZ2dlci5lcnJvcihgSG9vayBoYW5kbGVyIGVycm9yOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gKTtcbiAgICAvLyBDbGVhciBsb2dnZXIgY29udGV4dCBhbmQgY2xvc2VcbiAgICBsb2dnZXIuY2xlYXJDb250ZXh0KCk7XG4gICAgbG9nZ2VyLmNsb3NlKCk7XG4gICAgLy8gRXhpdCB3aXRoIGNvZGUgMiAoQkxPQ0spIC0gbm8gSlNPTiBvdXRwdXRcbiAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5CTE9DSyk7XG59XG4vKipcbiAqIENvbnZlcnRzIGEgU3BlY2lmaWNIb29rT3V0cHV0IHRvIEhvb2tPdXRwdXQgZm9yIHdpcmUgZm9ybWF0LlxuICpcbiAqIFNwZWNpZmljSG9va091dHB1dCB0eXBlcyBoYXZlOiB7IF90eXBlLCBzdGRvdXQsIHN0ZGVycj8gfVxuICogSG9va091dHB1dCBoYXM6IHsgc3Rkb3V0LCBzdGRlcnI/IH1cbiAqXG4gKiBTaW5jZSBvdXRwdXQgYnVpbGRlcnMgbm93IHByb2R1Y2Ugd2lyZS1mb3JtYXQgZGlyZWN0bHksIHRoaXMgZnVuY3Rpb25cbiAqIHNpbXBseSBzdHJpcHMgdGhlIGBfdHlwZWAgZGlzY3JpbWluYXRvciBmaWVsZC5cbiAqIEBwYXJhbSBzcGVjaWZpY091dHB1dCAtIFRoZSBzcGVjaWZpYyBvdXRwdXQgZnJvbSBhIGhvb2sgaGFuZGxlclxuICogQHJldHVybnMgSG9va091dHB1dCByZWFkeSBmb3Igc2VyaWFsaXphdGlvblxuICogQHNlZSBodHRwczovL2NvZGUuY2xhdWRlLmNvbS9kb2NzL2VuL2hvb2tzI2hvb2stb3V0cHV0LXN0cnVjdHVyZVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNvbnN0IHNwZWNpZmljT3V0cHV0ID0gcHJlVG9vbFVzZU91dHB1dCh7IGhvb2tTcGVjaWZpY091dHB1dDogeyBwZXJtaXNzaW9uRGVjaXNpb246ICdhbGxvdycgfSB9KTtcbiAqIGNvbnN0IGhvb2tPdXRwdXQgPSBjb252ZXJ0VG9Ib29rT3V0cHV0KHNwZWNpZmljT3V0cHV0KTtcbiAqIC8vIGhvb2tPdXRwdXQ6IHsgc3Rkb3V0OiB7IGhvb2tTcGVjaWZpY091dHB1dDogeyAuLi4gfSB9IH1cbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gY29udmVydFRvSG9va091dHB1dChzcGVjaWZpY091dHB1dCkge1xuICAgIGNvbnN0IHsgc3Rkb3V0LCBzdGRlcnIsIHJhd1N0ZG91dCB9ID0gc3BlY2lmaWNPdXRwdXQ7XG4gICAgY29uc3QgcmVzdWx0ID0geyBzdGRvdXQgfTtcbiAgICBpZiAoc3RkZXJyICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcmVzdWx0LnN0ZGVyciA9IHN0ZGVycjtcbiAgICB9XG4gICAgaWYgKHJhd1N0ZG91dCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHJlc3VsdC5yYXdTdGRvdXQgPSByYXdTdGRvdXQ7XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG59XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBFeGVjdXRlIEZ1bmN0aW9uXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vKipcbiAqIEV4ZWN1dGVzIGEgaG9vayBoYW5kbGVyIHdpdGggZnVsbCBydW50aW1lIG9yY2hlc3RyYXRpb24uXG4gKlxuICogVGhpcyBpcyB0aGUgbWFpbiBlbnRyeSBwb2ludCB0aGF0IGNvbXBpbGVkIGhvb2tzIHVzZS4gV2hlbiBhIGNvbXBpbGVkIGhvb2tcbiAqIHJ1bnMgYXMgYSBDTEk6XG4gKlxuICogMS4gUmVhZHMgYWxsIHN0ZGluXG4gKiAyLiBQYXJzZXMgSlNPTiAod2lyZSBmb3JtYXQgd2l0aCBzbmFrZV9jYXNlIHByb3BlcnRpZXMpXG4gKiAzLiBTZXRzIHVwIGxvZ2dlciBjb250ZXh0IChob29rVHlwZSwgaW5wdXQpXG4gKiA0LiBDYWxscyBoYW5kbGVyIHdpdGggaW5wdXQgYW5kIGNvbnRleHQgKGxvZ2dlcilcbiAqIDUuIEhhbmRsZXMgYW55IGVycm9ycywgbG9ncyB0aGVtXG4gKiA2LiBXcml0ZXMgSlNPTiB0byBzdGRvdXRcbiAqIDcuIENsb3NlcyBsb2dnZXJcbiAqIDguIEV4aXRzIHdpdGggYXBwcm9wcmlhdGUgY29kZVxuICogQHBhcmFtIGhvb2tGbiAtIFRoZSBob29rIGZ1bmN0aW9uIHRvIGV4ZWN1dGUgKGZyb20gaG9vayBmYWN0b3J5KVxuICogQGV4YW1wbGVcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIC8vIEluIGNvbXBpbGVkIGhvb2sgZmlsZVxuICogaW1wb3J0IHsgZXhlY3V0ZSB9IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcy9ydW50aW1lJztcbiAqIGltcG9ydCB7IHByZVRvb2xVc2VIb29rLCBwcmVUb29sVXNlT3V0cHV0IH0gZnJvbSAnQGdvb2Rmb290L2NsYXVkZS1jb2RlLWhvb2tzJztcbiAqXG4gKiBjb25zdCBteUhvb2sgPSBwcmVUb29sVXNlSG9vayh7IG1hdGNoZXI6ICdCYXNoJyB9LCBhc3luYyAoaW5wdXQsIHsgbG9nZ2VyIH0pID0+IHtcbiAqICAgbG9nZ2VyLmluZm8oJ1Byb2Nlc3NpbmcgQmFzaCBjb21tYW5kJyk7XG4gKiAgIHJldHVybiBwcmVUb29sVXNlT3V0cHV0KHsgYWxsb3c6IHRydWUgfSk7XG4gKiB9KTtcbiAqXG4gKiBleGVjdXRlKG15SG9vayk7XG4gKiBgYGBcbiAqIEBzZWUgaHR0cHM6Ly9jb2RlLmNsYXVkZS5jb20vZG9jcy9lbi9ob29rc1xuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZXhlY3V0ZShob29rRm4pIHtcbiAgICBsZXQgb3V0cHV0O1xuICAgIHRyeSB7XG4gICAgICAgIC8vIFJlYWQgYW5kIHBhcnNlIHN0ZGluXG4gICAgICAgIGxldCBzdGRpbkNvbnRlbnQ7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBzdGRpbkNvbnRlbnQgPSBhd2FpdCByZWFkU3RkaW4oKTtcbiAgICAgICAgfVxuICAgICAgICBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGxvZ2dlci5sb2dFcnJvcihlcnJvciwgXCJGYWlsZWQgdG8gcmVhZCBzdGRpblwiKTtcbiAgICAgICAgICAgIG91dHB1dCA9IGNyZWF0ZU1hbGZvcm1lZElucHV0T3V0cHV0KGVycm9yKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICAvLyBQYXJzZSBhbmQgdHJhbnNmb3JtIGlucHV0XG4gICAgICAgIGxldCBpbnB1dDtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGlucHV0ID0gcGFyc2VTdGRpbklucHV0KHN0ZGluQ29udGVudCk7XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBsb2dnZXIubG9nRXJyb3IoZXJyb3IsIFwiRmFpbGVkIHRvIHBhcnNlIHN0ZGluIEpTT05cIik7XG4gICAgICAgICAgICBvdXRwdXQgPSBjcmVhdGVNYWxmb3JtZWRJbnB1dE91dHB1dChlcnJvcik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgLy8gU2V0IGxvZ2dlciBjb250ZXh0XG4gICAgICAgIGNvbnN0IGhvb2tFdmVudE5hbWUgPSBob29rRm4uaG9va0V2ZW50TmFtZTtcbiAgICAgICAgbG9nZ2VyLnNldENvbnRleHQoaG9va0V2ZW50TmFtZSwgaW5wdXQpO1xuICAgICAgICAvLyBCdWlsZCBjb250ZXh0IC0gU2Vzc2lvblN0YXJ0IGhvb2tzIGdldCBleHRlbmRlZCBjb250ZXh0IHdpdGggcGVyc2lzdEVudlZhclxuICAgICAgICBjb25zdCBjb250ZXh0ID0gaG9va0V2ZW50TmFtZSA9PT0gXCJTZXNzaW9uU3RhcnRcIiA/IHsgbG9nZ2VyLCBwZXJzaXN0RW52VmFyLCBwZXJzaXN0RW52VmFycyB9IDogeyBsb2dnZXIgfTtcbiAgICAgICAgLy8gRXhlY3V0ZSBoYW5kbGVyXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBzcGVjaWZpY091dHB1dCA9IGF3YWl0IGhvb2tGbihpbnB1dCwgY29udGV4dCk7XG4gICAgICAgICAgICBpZiAoc3BlY2lmaWNPdXRwdXQgIT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICBvdXRwdXQgPSBjb252ZXJ0VG9Ib29rT3V0cHV0KHNwZWNpZmljT3V0cHV0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIC8vIEhhbmRsZXIgdGhyZXcgLSBvdXRwdXQgc3RhY2t0cmFjZSB0byBzdGRlcnIgYW5kIGV4aXQgd2l0aCBjb2RlIDJcbiAgICAgICAgICAgIC8vIFRoaXMgY2FsbCBuZXZlciByZXR1cm5zIChwcm9jZXNzLmV4aXQpXG4gICAgICAgICAgICBoYW5kbGVIYW5kbGVyRXJyb3IoZXJyb3IpO1xuICAgICAgICB9XG4gICAgfVxuICAgIGZpbmFsbHkge1xuICAgICAgICAvLyBXcml0ZSBvdXRwdXQgaWYgd2UgaGF2ZSBpdC4gQ29tbWFuZCBob29rcyB3aXRoIGEgcGxhaW4tdGV4dCBwcm90b2NvbCAoZS5nLlxuICAgICAgICAvLyBXb3JrdHJlZUNyZWF0ZSwgd2hlcmUgQ2xhdWRlIENvZGUgcmVhZHMgc3Rkb3V0IGFzIHRoZSB3b3JrdHJlZSBwYXRoIGFuZCBjaGRpcnNcbiAgICAgICAgLy8gaW50byBpdCkgY2FycnkgdGhlaXIgcGF5bG9hZCBpbiBgcmF3U3Rkb3V0YCBhbmQgYnlwYXNzIEpTT04gc2VyaWFsaXphdGlvbi5cbiAgICAgICAgaWYgKG91dHB1dCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBpZiAob3V0cHV0LnJhd1N0ZG91dCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgcHJvY2Vzcy5zdGRvdXQud3JpdGUob3V0cHV0LnJhd1N0ZG91dCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICB3cml0ZVN0ZG91dChvdXRwdXQuc3Rkb3V0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICAvLyBDbGVhbiB1cCBsb2dnZXIgKHNpbmdsZSBjbGVhbnVwIHBhdGgpXG4gICAgICAgIGxvZ2dlci5jbGVhckNvbnRleHQoKTtcbiAgICAgICAgbG9nZ2VyLmNsb3NlKCk7XG4gICAgICAgIC8vIEV4aXQtY29kZSBCTE9DSzogdW5saWtlIGhhbmRsZXIgdGhyb3cgKG5vIHN0ZG91dCksIHRoaXMgcGF0aCBzdGlsbCB3cml0ZXNcbiAgICAgICAgLy8gc3RydWN0dXJlZCBKU09OIHRvIHN0ZG91dCAoYXMgZW1wdHkge30pIGFsb25nc2lkZSB0aGUgc3RkZXJyIG1lc3NhZ2UuXG4gICAgICAgIC8vIFRoZSBjYWxsZXIgY29udHJvbHMgc3RkZXJyIGZvcm1hdHRpbmcgKG5vIGFwcGVuZGVkIG5ld2xpbmUpLlxuICAgICAgICBpZiAob3V0cHV0Py5zdGRlcnIgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUob3V0cHV0LnN0ZGVycik7XG4gICAgICAgICAgICBwcm9jZXNzLmV4aXQoRVhJVF9DT0RFUy5CTE9DSyk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gRXhpdCB3aXRoIHN1Y2Nlc3MgKGhhbmRsZXIgZXJyb3JzIGV4aXQgdmlhIGhhbmRsZUhhbmRsZXJFcnJvciB3aXRoIGNvZGUgMilcbiAgICAgICAgcHJvY2Vzcy5leGl0KEVYSVRfQ09ERVMuU1VDQ0VTUyk7XG4gICAgfVxufVxuIiwgIi8qKlxuICogU2hhcmVkIGhlbHBlcnMgdXNlZCBieSBtdWx0aXBsZSBhZ2VudC1ob29rcyBlbnRyeSBwb2ludHMuXG4gKlxuICogRXh0cmFjdGVkIGZyb20gcHJlLXRvb2wtdXNlLnRzIHNvIHRoYXQgdGhlIHVwY29taW5nIFN0b3AgaG9vayAoYW5kIGFueVxuICogZnV0dXJlIGhvb2tzKSBjYW4gaW1wb3J0IHBhdGggdXRpbGl0aWVzLCByYW5nZSBoZWxwZXJzLCBhbmQgdGhlXG4gKiBzYW5pdGl6ZVNlc3Npb25JZC9mb3JtYXRBbmNob3IgZnVuY3Rpb25zIHdpdGhvdXQgZGVwZW5kaW5nIG9uIHRoZVxuICogUHJlVG9vbFVzZS1zcGVjaWZpYyBtb2R1bGUuXG4gKi9cblxuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgb3MgZnJvbSAnbm9kZTpvcyc7XG5pbXBvcnQgKiBhcyBub2RlUGF0aCBmcm9tICdub2RlOnBhdGgnO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBhdGggaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiB0b1Bvc2l4KHA6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBwLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbn1cblxuZnVuY3Rpb24gaXNBYnNvbHV0ZVBvc2l4KHA6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gcC5zdGFydHNXaXRoKCcvJykgfHwgL15bQS1aYS16XTpcXC8vLnRlc3QocCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhYnNwYXRoQWdhaW5zdChiYXNlOiBzdHJpbmcsIHRhcmdldDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdCA9IHRvUG9zaXgodGFyZ2V0KTtcbiAgaWYgKGlzQWJzb2x1dGVQb3NpeCh0KSkgcmV0dXJuIHQ7XG4gIGNvbnN0IGIgPSB0b1Bvc2l4KGJhc2UpLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICByZXR1cm4gYCR7Yn0vJHt0fWA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlUmVwb1Jvb3QoZGlyOiBzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICghZGlyKSByZXR1cm4gbnVsbDtcbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCBkaXIsICdyZXYtcGFyc2UnLCAnLS1zaG93LXRvcGxldmVsJ10sIHtcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ2lnbm9yZSddLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4J1xuICAgIH0pO1xuICAgIGNvbnN0IHRyaW1tZWQgPSBvdXQudHJpbSgpO1xuICAgIHJldHVybiB0cmltbWVkLmxlbmd0aCA+IDAgPyB0b1Bvc2l4KHRyaW1tZWQpIDogbnVsbDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqXG4gKiBSZXBvcnQgd2hldGhlciBhIHJlcG8tcmVsYXRpdmUgcGF0aCBpcyBleGNsdWRlZCBieSBnaXQncyBpZ25vcmUgcnVsZXNcbiAqICguZ2l0aWdub3JlLCAuZ2l0L2luZm8vZXhjbHVkZSwgY29yZS5leGNsdWRlc0ZpbGUpLiBVc2VkIHRvIGtlZXAgaWdub3JlZFxuICogZmlsZXMgXHUyMDE0IGJ1aWxkIG91dHB1dCwgY2FjaGVzLCBsb2dzIFx1MjAxNCBvdXQgb2YgdG91Y2ggdHJhY2tpbmcgZW50aXJlbHksIHNvXG4gKiB0aGUgdG91Y2ggaG9vayBuZXZlciByZXBvcnRzIHJlYWRzLCB3cml0ZXMsIG9yIHVuY292ZXJlZCB3cml0ZXMgb24gdGhlbS5cbiAqXG4gKiBgZ2l0IGNoZWNrLWlnbm9yZSAtcSA8cGF0aD5gIGV4aXRzIDAgd2hlbiB0aGUgcGF0aCBpcyBpZ25vcmVkLCAxIHdoZW4gaXQgaXNcbiAqIG5vdCwgYW5kIDEyOCBvbiBlcnJvci4gZXhlY0ZpbGVTeW5jIHRocm93cyBvbiBhbnkgbm9uLXplcm8gZXhpdCwgc28gYSBjbGVhblxuICogcmV0dXJuIG1lYW5zIFwiaWdub3JlZFwiLiBBIHN0YXR1cy0xIHRocm93IGlzIHRoZSBleHBlY3RlZCBcIm5vdCBpZ25vcmVkXCJcbiAqIHNpZ25hbDsgYW55IG90aGVyIGZhaWx1cmUgaXMgYW4gdW5yZWxpYWJsZSBhbnN3ZXIsIHNvIHdlIHJlcG9ydCBgZmFsc2VgXG4gKiAoZG8gbm90IGRyb3AgdGhlIHRvdWNoKSByYXRoZXIgdGhhbiBzaWxlbnRseSBoaWRpbmcgYSB0cmFja2VkIGZpbGUuXG4gKi9cbi8qKlxuICogVGhlIGRlZmF1bHQgc3BhbiByb290IGRpcmVjdG9yeSwgcmVsYXRpdmUgdG8gdGhlIHJlcG8gcm9vdCwgdXNlZCB3aGVuIG5vXG4gKiBlbnZpcm9ubWVudCB2YXJpYWJsZSBvciBnaXQgY29uZmlnIG92ZXJyaWRlcyB0aGUgbG9jYXRpb24uXG4gKi9cbmV4cG9ydCBjb25zdCBTUEFOX1JPT1QgPSAnLnNwYW4nO1xuXG4vKipcbiAqIFJlc29sdmUgdGhlIHNwYW4gcm9vdCBkaXJlY3RvcnkgZm9yIGEgZ2l2ZW4gcmVwbywgbWlycm9yaW5nIHRoZSBSdXN0IENMSVxuICogcHJlY2VkZW5jZSAobWludXMgdGhlIC0tc3Bhbi1kaXIgQ0xJIGZsYWcsIHdoaWNoIGlzIGludmlzaWJsZSB0byBmaWxlLXdyaXRlXG4gKiBob29rcyk6XG4gKiAgIDEuIEdJVF9TUEFOX0RJUiBlbnZpcm9ubWVudCB2YXJpYWJsZVxuICogICAyLiBgZ2l0IGNvbmZpZyBnaXQtc3Bhbi5kaXJgIGluIHRoZSByZXBvXG4gKiAgIDMuIERlZmF1bHQ6IFwiLnNwYW5cIlxuICpcbiAqIFRoZSByZXR1cm5lZCB2YWx1ZSBpcyBhIFBPU0lYLXN0eWxlIHBhdGggd2l0aCBubyB0cmFpbGluZyBzbGFzaC5cbiAqIEZhaWwtc2FmZTogYW55IHJlc29sdXRpb24gZXJyb3IgZmFsbHMgYmFjayB0byBcIi5zcGFuXCIgc28gdGhlIGhvb2sgbmV2ZXJcbiAqIGNyYXNoZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGVudkRpciA9IHByb2Nlc3MuZW52WydHSVRfU1BBTl9ESVInXTtcbiAgaWYgKGVudkRpciAmJiBlbnZEaXIudHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4gdG9Qb3NpeChlbnZEaXIudHJpbSgpKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgfVxuICB0cnkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnY29uZmlnJywgJ2dpdC1zcGFuLmRpciddLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICAgIGVuY29kaW5nOiAndXRmOCdcbiAgICB9KTtcbiAgICBjb25zdCB0cmltbWVkID0gdG9Qb3NpeChvdXQudHJpbSgpKS5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgICBpZiAodHJpbW1lZC5sZW5ndGggPiAwKSByZXR1cm4gdHJpbW1lZDtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdm9pZCBlcnI7IC8vIGNvbmZpZyBrZXkgYWJzZW50IG9yIGdpdCBlcnJvciBcdTIwMTQgZmFsbCB0aHJvdWdoIHRvIGRlZmF1bHRcbiAgfVxuICByZXR1cm4gU1BBTl9ST09UO1xufVxuXG4vKipcbiAqIFJlcG9ydCB3aGV0aGVyIGEgcmVwby1yZWxhdGl2ZSBQT1NJWCBwYXRoIGZhbGxzIGluc2lkZSB0aGUgZ2l2ZW4gc3BhbiByb290XG4gKiBkaXJlY3RvcnkuIEEgcGF0aCBpcyBpbnNpZGUgd2hlbiBpdCBlcXVhbHMgdGhlIHNwYW4gcm9vdCBleGFjdGx5IG9yIGlzXG4gKiBuZXN0ZWQgYmVuZWF0aCBpdCAoaS5lLiBzdGFydHMgd2l0aCBcIjxzcGFuUm9vdD4vXCIpLiBUaGUgXCIvXCIgYm91bmRhcnkgcHJldmVudHNcbiAqIGZhbHNlIHBvc2l0aXZlcyBmb3Igc2libGluZ3MgbGlrZSBcIi5zcGFucy94XCIgb3IgXCIuc3Bhbi1ub3Rlcy94XCIuXG4gKlxuICogUGFzcyB0aGUgcmVzdWx0IG9mIGByZXNvbHZlU3BhblJvb3QocmVwb1Jvb3QpYCBhcyBgc3BhblJvb3RgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNJbnNpZGVTcGFuUm9vdChyZXBvUmVsUGF0aDogc3RyaW5nLCBzcGFuUm9vdDogc3RyaW5nID0gU1BBTl9ST09UKTogYm9vbGVhbiB7XG4gIGNvbnN0IHJvb3QgPSBzcGFuUm9vdC5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgcmV0dXJuIHJlcG9SZWxQYXRoID09PSByb290IHx8IHJlcG9SZWxQYXRoLnN0YXJ0c1dpdGgoYCR7cm9vdH0vYCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0dpdElnbm9yZWQocmVwb1Jvb3Q6IHN0cmluZywgcmVwb1JlbFBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnY2hlY2staWdub3JlJywgJy1xJywgJy0tJywgcmVwb1JlbFBhdGhdLCB7XG4gICAgICBzdGRpbzogWydpZ25vcmUnLCAnaWdub3JlJywgJ2lnbm9yZSddXG4gICAgfSk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHZvaWQgZXJyO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3Q6IHN0cmluZywgYWJzUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgcm9vdCA9IHRvUG9zaXgocmVwb1Jvb3QpO1xuICBjb25zdCBhYnMgPSB0b1Bvc2l4KGFic1BhdGgpO1xuICBjb25zdCBwcmVmaXggPSByb290LmVuZHNXaXRoKCcvJykgPyByb290IDogYCR7cm9vdH0vYDtcbiAgcmV0dXJuIGFicy5zdGFydHNXaXRoKHByZWZpeCkgPyBhYnMuc2xpY2UocHJlZml4Lmxlbmd0aCkgOiBhYnM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjYW5vbmljYWxpemVQYXRoKGFic1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHRvUG9zaXgoZnMucmVhbHBhdGhTeW5jLm5hdGl2ZShhYnNQYXRoKSk7XG4gIH0gY2F0Y2gge1xuICAgIC8vIEZpbGUgZG9lc24ndCBleGlzdCB5ZXQgKGUuZy4gV3JpdGUgdG8gYSBuZXcgZmlsZSk6IGNhbm9uaWNhbGl6ZSB0aGVcbiAgICAvLyBkaXJlY3RvcnkgYW5kIHJlam9pbiB0aGUgYmFzZW5hbWUgc28gc3ltbGlua3MgaW4gdGhlIHBhcmVudCBhcmUgcmVzb2x2ZWQuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGRpciA9IHRvUG9zaXgoZnMucmVhbHBhdGhTeW5jLm5hdGl2ZShub2RlUGF0aC5kaXJuYW1lKGFic1BhdGgpKSk7XG4gICAgICByZXR1cm4gYCR7ZGlyfS8ke25vZGVQYXRoLmJhc2VuYW1lKGFic1BhdGgpfWA7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBQYXJlbnQgZG9lc24ndCBleGlzdCBlaXRoZXI7IGZhbGwgYmFjayB0byB0aGUgdW4tY2Fub25pY2FsaXplZCBwYXRoLlxuICAgICAgcmV0dXJuIGFic1BhdGg7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkZXJpdmVQYXRoKHRvb2xJbnB1dDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGN3ZDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IGZwID0gdG9vbElucHV0LmZpbGVfcGF0aDtcbiAgaWYgKHR5cGVvZiBmcCAhPT0gJ3N0cmluZycgfHwgZnAubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgYWJzID0gYWJzcGF0aEFnYWluc3QoY3dkLCBmcCk7XG4gIHJldHVybiBjYW5vbmljYWxpemVQYXRoKGFicyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTGluZSByYW5nZSB0eXBlcyBhbmQgaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgTGluZVJhbmdlIHtcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByYW5nZXNJbnRlcnNlY3QoYTogTGluZVJhbmdlLCBiOiBMaW5lUmFuZ2UpOiBib29sZWFuIHtcbiAgcmV0dXJuIGEuc3RhcnQgPD0gYi5lbmQgJiYgYS5lbmQgPj0gYi5zdGFydDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQb3JjZWxhaW4gcm93IHBhcnNpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIFBvcmNlbGFpblJvdyB7XG4gIG5hbWU6IHN0cmluZztcbiAgcGF0aDogc3RyaW5nO1xuICBzdGFydDogbnVtYmVyO1xuICBlbmQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlUG9yY2VsYWluKHN0ZG91dDogc3RyaW5nKTogUG9yY2VsYWluUm93W10ge1xuICBjb25zdCByb3dzOiBQb3JjZWxhaW5Sb3dbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygc3Rkb3V0LnNwbGl0KCdcXG4nKSkge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHBhcnRzID0gdHJpbW1lZC5zcGxpdCgnXFx0Jyk7XG4gICAgaWYgKHBhcnRzLmxlbmd0aCA8IDMpIGNvbnRpbnVlO1xuICAgIGNvbnN0IFtuYW1lLCBwYXRoLCByYW5nZV0gPSBwYXJ0cztcbiAgICBjb25zdCBkYXNoSWR4ID0gcmFuZ2UuaW5kZXhPZignLScpO1xuICAgIGlmIChkYXNoSWR4ID09PSAtMSkgY29udGludWU7XG4gICAgY29uc3Qgc3RhcnQgPSBwYXJzZUludChyYW5nZS5zbGljZSgwLCBkYXNoSWR4KSwgMTApO1xuICAgIGNvbnN0IGVuZCA9IHBhcnNlSW50KHJhbmdlLnNsaWNlKGRhc2hJZHggKyAxKSwgMTApO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oc3RhcnQpIHx8IE51bWJlci5pc05hTihlbmQpKSBjb250aW51ZTtcbiAgICByb3dzLnB1c2goeyBuYW1lLCBwYXRoLCBzdGFydCwgZW5kIH0pO1xuICB9XG4gIHJldHVybiByb3dzO1xufVxuXG4vKipcbiAqIFRoZSBmdWxsIGBnaXQgc3BhbiBkcmlmdCAtLWZvcm1hdCBwb3JjZWxhaW5gIHN0YXR1cyB0b2tlbiB2b2NhYnVsYXJ5ICh0aGVcbiAqIGdpdC1zcGFuIENMSSdzIHBvcmNlbGFpbiBjb250cmFjdCk6IGBGUkVTSGAvYE1PVkVEYC9gUkVTT0xWRURfUEVORElOR19DT01NSVRgXG4gKiBhcmUgcG9zaXRpb25hbC1vci1jbGVhbiBhbmQgbmV2ZXIgZGVidDsgZXZlcnkgb3RoZXIgdG9rZW4gaXMgc2VtYW50aWMgZHJpZnRcbiAqIG9yIGEgdGVybWluYWwvZXJyb3IgY29uZGl0aW9uIGFuZCBpcyBkZWJ0LiBTZWUge0BsaW5rIGlzRGVidH0gZm9yIHRoZVxuICogc2luZ2xlIHNvdXJjZSBvZiB0cnV0aCBvbiB0aGF0IHNwbGl0LlxuICovXG5leHBvcnQgY29uc3QgUE9SQ0VMQUlOX1NUQVRVU0VTID0gW1xuICAnRlJFU0gnLFxuICAnUkVTT0xWRURfUEVORElOR19DT01NSVQnLFxuICAnTU9WRUQnLFxuICAnQ0hBTkdFRCcsXG4gICdERUxFVEVEJyxcbiAgJ0NPTkZMSUNUJyxcbiAgJ1NVQk1PRFVMRScsXG4gICdMRlNfTk9UX0ZFVENIRUQnLFxuICAnTEZTX05PVF9JTlNUQUxMRUQnLFxuICAnUFJPTUlTT1JfTUlTU0lORycsXG4gICdTUEFSU0VfRVhDTFVERUQnLFxuICAnRklMVEVSX0ZBSUxFRCcsXG4gICdJT19FUlJPUidcbl0gYXMgY29uc3Q7XG5cbmV4cG9ydCB0eXBlIFBvcmNlbGFpblN0YXR1cyA9ICh0eXBlb2YgUE9SQ0VMQUlOX1NUQVRVU0VTKVtudW1iZXJdO1xuXG5jb25zdCBQT1JDRUxBSU5fU1RBVFVTX1NFVDogUmVhZG9ubHlTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoUE9SQ0VMQUlOX1NUQVRVU0VTKTtcblxuZnVuY3Rpb24gcGFyc2VQb3JjZWxhaW5TdGF0dXMocmF3OiBzdHJpbmcpOiBQb3JjZWxhaW5TdGF0dXMgfCBudWxsIHtcbiAgcmV0dXJuIFBPUkNFTEFJTl9TVEFUVVNfU0VULmhhcyhyYXcpID8gKHJhdyBhcyBQb3JjZWxhaW5TdGF0dXMpIDogbnVsbDtcbn1cblxuLyoqIEEgYHBhcnNlRHJpZnRQb3JjZWxhaW5gIHJvdzogYSB7QGxpbmsgUG9yY2VsYWluUm93fSBwbHVzIGl0cyBzdGF0dXMgdG9rZW4uICovXG5leHBvcnQgaW50ZXJmYWNlIERyaWZ0UG9yY2VsYWluUm93IGV4dGVuZHMgUG9yY2VsYWluUm93IHtcbiAgc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXM7XG59XG5cbi8qKlxuICogVGhlIGRlYnQgaW52YXJpYW50IChzeXN0ZW0td2lkZTsgY29uc3VtZWQgYnkgYm90aCB0aGUgZnV0dXJlIHRvdWNoLWNvcmUgYW5kXG4gKiBhZHZpc29yLWNvcmUpOiBvbmx5IHNlbWFudGljIHN0YXR1c2VzIGFyZSBkZWJ0LiBgQ0hBTkdFRGAgYW5kIGBERUxFVEVEYCBhcmVcbiAqIHNlbWFudGljIGRyaWZ0OyB0aGUgcmVtYWluaW5nIG5vbi1GUkVTSC9NT1ZFRC9SRVNPTFZFRF9QRU5ESU5HX0NPTU1JVCB0b2tlbnNcbiAqIGFyZSB0ZXJtaW5hbC9lcnJvciBjb25kaXRpb25zIGFuZCBhcmUgdHJlYXRlZCBhcyBkZWJ0IHRvbyAodGhleSBibG9jayBvblxuICogdGhlaXIgb3duIG1lcml0cyBcdTIwMTQgdGhlIENMSSBjb3VsZCBub3QgcmVzb2x2ZSB0aGUgYW5jaG9yIGF0IGFsbCkuIGBGUkVTSGAsXG4gKiBgTU9WRURgLCBhbmQgYFJFU09MVkVEX1BFTkRJTkdfQ09NTUlUYCBhcmUgbmV2ZXIgZGVidDogcG9zaXRpb25hbCBkcmlmdCB0aGVcbiAqIENMSSBjYW4gaGVhbCAob3IgYWxyZWFkeSBoYXMpIGlzIGludmlzaWJsZSwgYW5kIGEgcGVuZGluZy1jb21taXQgcmVzb2x1dGlvblxuICogaXMgbm90IG91dHN0YW5kaW5nIGRlYnQuXG4gKlxuICogTm90ZTogdGhlIHBvcmNlbGFpbiB2b2NhYnVsYXJ5IGRvZXMgbm90IGN1cnJlbnRseSBkaXN0aW5ndWlzaFxuICogY29udGVudC1lcXVpdmFsZW50IGBDSEFOR0VEYCAoZS5nLiB3aGl0ZXNwYWNlLW9ubHkgZHJpZnQgYC0tZml4YCBjYW4gaGVhbClcbiAqIGZyb20gZ2VudWluZWx5IHNlbWFudGljIGBDSEFOR0VEYCBcdTIwMTQgdGhhdCBjbGFzc2lmaWNhdGlvbiBpcyBub3QgcHJlc2VudCBpblxuICogYGdpdCBzcGFuIGRyaWZ0IC0tZm9ybWF0IHBvcmNlbGFpbmAgb3V0cHV0IHRvZGF5LiBVbnRpbCB0aGUgQ0xJIGV4cG9zZXMgaXQsXG4gKiBldmVyeSBgQ0hBTkdFRGAgcm93IGlzIHRyZWF0ZWQgYXMgZGVidC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRGVidChzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IGJvb2xlYW4ge1xuICBzd2l0Y2ggKHN0YXR1cykge1xuICAgIGNhc2UgJ0ZSRVNIJzpcbiAgICBjYXNlICdNT1ZFRCc6XG4gICAgY2FzZSAnUkVTT0xWRURfUEVORElOR19DT01NSVQnOlxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgfVxufVxuXG4vKipcbiAqIExvd2VyY2FzZSBodW1hbiBsYWJlbCBmb3IgYSBwb3JjZWxhaW4gc3RhdHVzIHRva2VuIChgTEZTX05PVF9GRVRDSEVEYCBcdTIxOTJcbiAqIGBsZnMgbm90IGZldGNoZWRgKS4gVGhlIHNpbmdsZSBsYWJlbCBtYXBwaW5nIGZvciBldmVyeSBodW1hbi1mb3JtYXQgYW5jaG9yXG4gKiBzdWZmaXggXHUyMDE0IGJvdGggdGhlIHRvdWNoIGhvb2sncyBibG9jayBhbmQgdGhlIGFkdmlzb3IncyBtZXNzYWdlcyByZW5kZXIgdGhyb3VnaFxuICogdGhpcywgc28gYSBzdGF0dXMgbmV2ZXIgcmVhZHMgZGlmZmVyZW50bHkgYmV0d2VlbiB0aGUgdHdvLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaHVtYW5TdGF0dXNMYWJlbChzdGF0dXM6IFBvcmNlbGFpblN0YXR1cyk6IHN0cmluZyB7XG4gIHJldHVybiBzdGF0dXMudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9fL2csICcgJyk7XG59XG5cbi8qKlxuICogVGhlIHRlcm1pbmFsL2Vudmlyb25tZW50YWwgc3RhdHVzZXM6IHRoZSBDTEkgY291bGQgbm90IHJlc29sdmUgdGhlIGFuY2hvciBhdFxuICogYWxsLCBzbyB0aGUgcm93IGlzIG5vdCBzcGFuIGRyaWZ0IGEgdXNlciBjYW4gZml4IGJ5IGVkaXRpbmcgYSBzcGFuLiBUaGVzZSBhcmVcbiAqIGBDT05GTElDVGAgKHVucmVzb2x2ZWQgbWVyZ2UpLCBgU1VCTU9EVUxFYCAoYW5jaG9yIGluc2lkZSBhIHN1Ym1vZHVsZSksXG4gKiBgTEZTX05PVF9GRVRDSEVEYC9gTEZTX05PVF9JTlNUQUxMRURgIChHaXQgTEZTIGNvbnRlbnQgdW5hdmFpbGFibGUpLFxuICogYFBST01JU09SX01JU1NJTkdgIChwYXJ0aWFsLWNsb25lIG9iamVjdCBub3QgZmV0Y2hlZCksIGBTUEFSU0VfRVhDTFVERURgXG4gKiAocGF0aCBvdXRzaWRlIHRoZSBzcGFyc2UtY2hlY2tvdXQgY29uZSksIGBGSUxURVJfRkFJTEVEYCAoYSBjbGVhbi9zbXVkZ2VcbiAqIGZpbHRlciBlcnJvcmVkKSwgYW5kIGBJT19FUlJPUmAgKHRyYW5zaWVudCByZWFkIGZhaWx1cmUpLlxuICpcbiAqIFRoZXNlIGFyZSBhIHN0cmljdCBzdWJzZXQgb2Yge0BsaW5rIGlzRGVidH06IGV2ZXJ5IGVudmlyb25tZW50YWwgc3RhdHVzIGlzXG4gKiBhbHNvIGRlYnQgKGl0IGJsb2NrcyBvbiBpdHMgb3duIG1lcml0cyB3aGVuIHN1cmZhY2VkIGluIGEgc3RhdHVzIHJlcG9ydCksIGJ1dFxuICogdGhlIGFkdmlzb3IgbXVzdCB0cmVhdCB0aGVtIGRpZmZlcmVudGx5IGZyb20gKnNlbWFudGljKiBkcmlmdCAoYENIQU5HRURgLFxuICogYERFTEVURURgKS4gU2VtYW50aWMgZHJpZnQgaXMgZml4YWJsZSBieSBlZGl0aW5nIGEgc3Bhbiwgc28gdGhlIGFkdmlzb3IgZmFpbHNcbiAqIGNsb3NlZCBvbiBpdDsgYW4gZW52aXJvbm1lbnRhbCBjb25kaXRpb24gaXMgbm90IHNvbWV0aGluZyBhIHNwYW4gZWRpdCBjYW5cbiAqIHJlc29sdmUsIHNvIHRoZSBhZHZpc29yIGZhaWxzIE9QRU4gb24gaXQgKGFsbG93LCBidXQgc3VyZmFjZSB0aGUgY29uZGl0aW9uKSBcdTIwMTRcbiAqIHJlLWRlbnlpbmcgZm9yZXZlciBvbiBhbiBpbmZyYSBmYWlsdXJlIHRoZSB1c2VyIGNhbm5vdCBjbGVhciBmcm9tIGhlcmUgd291bGRcbiAqIGNvbnRyYWRpY3QgdGhlIGZhaWwtb3BlbiBjb250cmFjdCB0aGUgcmVzdCBvZiB0aGUgYWR2aXNvciBhbHJlYWR5IGhvbm9ycyBmb3JcbiAqIENMSS1hYnNlbnQvdGltZW91dC9wYXJzZS1mYWlsdXJlIGNvbmRpdGlvbnMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0Vudmlyb25tZW50YWxTdGF0dXMoc3RhdHVzOiBQb3JjZWxhaW5TdGF0dXMpOiBib29sZWFuIHtcbiAgc3dpdGNoIChzdGF0dXMpIHtcbiAgICBjYXNlICdDT05GTElDVCc6XG4gICAgY2FzZSAnU1VCTU9EVUxFJzpcbiAgICBjYXNlICdMRlNfTk9UX0ZFVENIRUQnOlxuICAgIGNhc2UgJ0xGU19OT1RfSU5TVEFMTEVEJzpcbiAgICBjYXNlICdQUk9NSVNPUl9NSVNTSU5HJzpcbiAgICBjYXNlICdTUEFSU0VfRVhDTFVERUQnOlxuICAgIGNhc2UgJ0ZJTFRFUl9GQUlMRUQnOlxuICAgIGNhc2UgJ0lPX0VSUk9SJzpcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBgZ2l0IHNwYW4gZHJpZnQgLS1mb3JtYXQgcG9yY2VsYWluYCBlbWl0cyBhIGRpZmZlcmVudCBzaGFwZSB0aGFuXG4gKiBgbGlzdCAtLXBvcmNlbGFpbmA6IGEgYCMgcG9yY2VsYWluIHYyYCBoZWFkZXIsIGAjIGZ1enp5IE5gIGNvbW1lbnQgbGluZXMsXG4gKiBhbmQgb25lIGA8c3RhdHVzPlxcdDxzcmM+XFx0PG5hbWU+XFx0PHBhdGg+XFx0PHN0YXJ0PlxcdDxlbmQ+YCByb3cgcGVyIGRyaWZ0ZWRcbiAqIGFuY2hvciAod2hvbGUtZmlsZSBhbmNob3JzIGNhcnJ5IGAod2hvbGUpYC9gLWAgaW4gcGxhY2Ugb2YgdGhlIGxpbmUgY29sdW1ucykuXG4gKiBSb3dzIHdob3NlIHN0YXR1cyB0b2tlbiBpcyBub3QgaW4ge0BsaW5rIFBPUkNFTEFJTl9TVEFUVVNFU30gYXJlIHNraXBwZWQgXHUyMDE0XG4gKiBhbiB1bnJlY29nbml6ZWQgdG9rZW4gZnJvbSBhIG5ld2VyIENMSSBpcyB0cmVhdGVkIHRoZSBzYW1lIGFzIGEgbWFsZm9ybWVkXG4gKiBsaW5lIHJhdGhlciB0aGFuIGd1ZXNzZWQgYXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZURyaWZ0UG9yY2VsYWluKHN0ZG91dDogc3RyaW5nKTogRHJpZnRQb3JjZWxhaW5Sb3dbXSB7XG4gIGNvbnN0IHJvd3M6IERyaWZ0UG9yY2VsYWluUm93W10gPSBbXTtcbiAgZm9yIChjb25zdCBsaW5lIG9mIHN0ZG91dC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgaWYgKCF0cmltbWVkIHx8IHRyaW1tZWQuc3RhcnRzV2l0aCgnIycpKSBjb250aW51ZTtcbiAgICBjb25zdCBwYXJ0cyA9IHRyaW1tZWQuc3BsaXQoJ1xcdCcpO1xuICAgIGlmIChwYXJ0cy5sZW5ndGggPCA2KSBjb250aW51ZTtcbiAgICBjb25zdCBbc3RhdHVzQ29sLCAsIG5hbWUsIHBhdGgsIHN0YXJ0Q29sLCBlbmRDb2xdID0gcGFydHM7XG4gICAgY29uc3Qgc3RhdHVzID0gcGFyc2VQb3JjZWxhaW5TdGF0dXMoc3RhdHVzQ29sKTtcbiAgICBpZiAoIXN0YXR1cykgY29udGludWU7XG4gICAgY29uc3Qgc3RhcnQgPSBzdGFydENvbCA9PT0gJyh3aG9sZSknID8gMCA6IHBhcnNlSW50KHN0YXJ0Q29sLCAxMCk7XG4gICAgY29uc3QgZW5kID0gZW5kQ29sID09PSAnLScgPyAwIDogcGFyc2VJbnQoZW5kQ29sLCAxMCk7XG4gICAgaWYgKE51bWJlci5pc05hTihzdGFydCkgfHwgTnVtYmVyLmlzTmFOKGVuZCkpIGNvbnRpbnVlO1xuICAgIHJvd3MucHVzaCh7IG5hbWUsIHBhdGgsIHN0YXJ0LCBlbmQsIHN0YXR1cyB9KTtcbiAgfVxuICByZXR1cm4gcm93cztcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBTZXNzaW9uIElEIHNhbml0aXphdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogSW5qZWN0aXZlIHRyYW5zZm9ybTogcGVyY2VudC1lbmNvZGUgYnl0ZXMgb3V0c2lkZSBbQS1aYS16MC05Ll8tXSBhcyAlSEhcbiAqICh1cHBlcmNhc2UgaGV4KS4gVXNlZCB0byBwcm9kdWNlIHNhZmUgZmlsZW5hbWVzIGZyb20gYXJiaXRyYXJ5IHNlc3Npb24gaWRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemVTZXNzaW9uSWQoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gc2Vzc2lvbklkLnJlcGxhY2UoL1teQS1aYS16MC05Ll8tXS9nLCAoY2gpID0+IHtcbiAgICByZXR1cm4gYCUke2NoLmNoYXJDb2RlQXQoMCkudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCkucGFkU3RhcnQoMiwgJzAnKX1gO1xuICB9KTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQZXItc2Vzc2lvbiBiYXNlIGRpcmVjdG9yeVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vIEJhc2UgZGlyIHNoYXJlZCBieSBhbGwgcGVyLXNlc3Npb24gc3RhdGU6IGN1cnJlbnRseSBqdXN0IHRoZSB0b3VjaC1ob29rXG4vLyBzZXNzaW9uIG1lbW8gKHNwYW4tc3VyZmFjZS50cydzIE1lbW9TdG9yZSkuIEVhY2ggc2Vzc2lvbiBnZXRzIG9uZVxuLy8gc3ViZGlyZWN0b3J5IGtleWVkIGJ5IGl0cyBzYW5pdGl6ZWQgaWQsIHNvIGV2ZXJ5IHdyaXRlci9yZWFkZXIgZm9yIGEgZ2l2ZW5cbi8vIHNlc3Npb24gYWdyZWVzIG9uIGl0cyBsb2NhdGlvbi5cbmV4cG9ydCBjb25zdCBTRVNTSU9OX0JBU0VfRElSID0gbm9kZVBhdGguam9pbihvcy5ob21lZGlyKCksICcuY2FjaGUnLCAnZ2l0LXNwYW4nLCAnc2Vzc2lvbicpO1xuXG4vKiogVGhlIHBlci1zZXNzaW9uIHN0YXRlIGRpcmVjdG9yeSBmb3IgYSBnaXZlbiBzZXNzaW9uIGlkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNlc3Npb25EaXIoc2Vzc2lvbklkOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbm9kZVBhdGguam9pbihTRVNTSU9OX0JBU0VfRElSLCBzYW5pdGl6ZVNlc3Npb25JZChzZXNzaW9uSWQpKTtcbn1cblxuY29uc3QgVEhJUlRZX0RBWVNfTVMgPSAzMCAqIDI0ICogNjAgKiA2MCAqIDEwMDA7XG5cbi8qKlxuICogT3Bwb3J0dW5pc3RpY2FsbHkgcHJ1bmUgcGVyLXNlc3Npb24gc3RhdGUgZGlyZWN0b3JpZXMgdW5kZXJcbiAqIHtAbGluayBTRVNTSU9OX0JBU0VfRElSfSB3aG9zZSBtdGltZSBpcyBvbGRlciB0aGFuIGBtYXhBZ2VNc2AgKGRlZmF1bHQgMzBcbiAqIGRheXMpLiBBIGRpcmVjdG9yeSdzIG10aW1lIGFkdmFuY2VzIHdoZW5ldmVyIGFuIGVudHJ5IGluc2lkZSBpdCBpc1xuICogY3JlYXRlZC9yZW5hbWVkL3JlbW92ZWQsIHNvIGFuIGFjdGl2ZSBzZXNzaW9uIChtZW1vIHdyaXRlcykgc3RheXMgZnJlc2g7XG4gKiBvbmx5IGdlbnVpbmVseSBhYmFuZG9uZWQgc2Vzc2lvbnMgYWdlIG91dC5cbiAqXG4gKiBCZXN0LWVmZm9ydCBhbmQgbm9uLXRocm93aW5nOiBjYWxsZWQgb3Bwb3J0dW5pc3RpY2FsbHkgZnJvbSBob29rIHJlYWQvd3JpdGVcbiAqIHBhdGhzLCBub3QgYSBzZXBhcmF0ZSBjcm9uLWxpa2UgbWVjaGFuaXNtLCBzbyBhIGZhaWx1cmUgaGVyZSBtdXN0IG5ldmVyXG4gKiBibG9jayB0aGUgY2FsbGVyJ3MgYWN0dWFsIHdvcmsuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwcnVuZVN0YWxlU2Vzc2lvbnMobm93OiBudW1iZXIgPSBEYXRlLm5vdygpLCBtYXhBZ2VNczogbnVtYmVyID0gVEhJUlRZX0RBWVNfTVMpOiB2b2lkIHtcbiAgbGV0IGVudHJpZXM6IGZzLkRpcmVudFtdO1xuICB0cnkge1xuICAgIGVudHJpZXMgPSBmcy5yZWFkZGlyU3luYyhTRVNTSU9OX0JBU0VfRElSLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybjsgLy8gYmFzZSBkaXIgYWJzZW50IG9yIHVucmVhZGFibGUgXHUyMDE0IG5vdGhpbmcgdG8gcHJ1bmVcbiAgfVxuICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXMpIHtcbiAgICBpZiAoIWVudHJ5LmlzRGlyZWN0b3J5KCkpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGRpclBhdGggPSBub2RlUGF0aC5qb2luKFNFU1NJT05fQkFTRV9ESVIsIGVudHJ5Lm5hbWUpO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBzdGF0ID0gZnMuc3RhdFN5bmMoZGlyUGF0aCk7XG4gICAgICBpZiAobm93IC0gc3RhdC5tdGltZU1zID4gbWF4QWdlTXMpIHtcbiAgICAgICAgZnMucm1TeW5jKGRpclBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFZhbmlzaGVkIGJldHdlZW4gcmVhZGRpciBhbmQgc3RhdCwgb3IgcmVtb3ZhbCBmYWlsZWQgXHUyMDE0IHNraXAgaXQuIEFcbiAgICAgIC8vIGJlc3QtZWZmb3J0IHBydW5lIG11c3QgbmV2ZXIgdGhyb3cgaW50byB0aGUgY2FsbGVyJ3MgaG90IHBhdGguXG4gICAgfVxuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2gga2luZCBhbmQgYW5jaG9yIGZvcm1hdHRpbmdcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgdHlwZSBUb3VjaEtpbmQgPSAncmVhZCcgfCAnd3JpdGUnIHwgJ3dob2xlLXJlYWQnIHwgJ3dob2xlLXdyaXRlJyB8ICdjcmVhdGUnO1xuXG4vKipcbiAqIEZvcm1hdCBhIHNwYW4gYW5jaG9yIHN0cmluZy5cbiAqXG4gKiAtIGB3aG9sZS1yZWFkYCwgYHdob2xlLXdyaXRlYCwgYW5kIGBjcmVhdGVgOiByZXR1cm5zIGp1c3QgdGhlIHBhdGhcbiAqIC0gYHJlYWRgIGFuZCBgd3JpdGVgOiByZXR1cm5zIGBwYXRoI0w8c3RhcnQ+LUw8ZW5kPmAgKHJlcXVpcmVzIHJhbmdlKVxuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0QW5jaG9yKHBhdGg6IHN0cmluZywga2luZDogVG91Y2hLaW5kLCByYW5nZT86IExpbmVSYW5nZSk6IHN0cmluZyB7XG4gIGlmICgoa2luZCA9PT0gJ3JlYWQnIHx8IGtpbmQgPT09ICd3cml0ZScpICYmIHJhbmdlKSB7XG4gICAgcmV0dXJuIGAke3BhdGh9I0wke3JhbmdlLnN0YXJ0fS1MJHtyYW5nZS5lbmR9YDtcbiAgfVxuICByZXR1cm4gcGF0aDtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBBbmNob3Igc3BlYyB0eXBlXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBBbmNob3JTcGVjIHtcbiAgcGF0aDogc3RyaW5nO1xuICBraW5kOiBUb3VjaEtpbmQ7XG4gIHJhbmdlPzogTGluZVJhbmdlO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFF1ZXVlIGRpcmVjdG9yeSBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBnaXQgY29tbW9uIGRpcmVjdG9yeSBmb3IgdGhlIGdpdmVuIHJlcG8gcm9vdC5cbiAqIFRoaXMgaXMgdGhlIHNoYXJlZCBkaXJlY3RvcnkgKG5vdCB0aGUgd29ya3RyZWUtc3BlY2lmaWMgLmdpdCksIHNvIHF1ZXVlXG4gKiByZWNvcmRzIHN1cnZpdmUgd29ya3RyZWUgZGVsZXRpb24uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlR2l0Q29tbW9uRGlyKHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnLUMnLCByZXBvUm9vdCwgJ3Jldi1wYXJzZScsICctLWdpdC1jb21tb24tZGlyJ10sIHtcbiAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdpZ25vcmUnXSxcbiAgICBlbmNvZGluZzogJ3V0ZjgnXG4gIH0pO1xuICBjb25zdCB0cmltbWVkID0gdG9Qb3NpeChvdXQudHJpbSgpKTtcbiAgLy8gZ2l0IHJldHVybnMgYSByZWxhdGl2ZSBwYXRoIChlLmcuIFwiLmdpdFwiKSBmb3Igc2ltcGxlIHJlcG9zLiBSZXNvbHZlIGl0XG4gIC8vIGFnYWluc3QgcmVwb1Jvb3Qgc28gY2FsbGVycyBuZXZlciBkZXBlbmQgb24gcHJvY2Vzcy5jd2QoKS5cbiAgaWYgKCFub2RlUGF0aC5pc0Fic29sdXRlKHRyaW1tZWQpKSB7XG4gICAgcmV0dXJuIHRvUG9zaXgobm9kZVBhdGgucmVzb2x2ZShyZXBvUm9vdCwgdHJpbW1lZCkpO1xuICB9XG4gIHJldHVybiB0cmltbWVkO1xufVxuXG4vKipcbiAqIFJvb3Qgb2YgdGhlIGdpdC1zcGFuIHF1ZXVlIGRpcmVjdG9yeSB0cmVlLCB1bmRlciB0aGUgZ2l0IGNvbW1vbiBkaXIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBxdWV1ZVJvb3QocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKHJlc29sdmVHaXRDb21tb25EaXIocmVwb1Jvb3QpLCAnZ2l0LXNwYW4nKTtcbn1cblxuLyoqXG4gKiBEaXJlY3RvcnkgZm9yIHRoZSBhZHZpc29yJ3MgcGVyLWNoYW5nZXNldCBzdGF0ZSBtZW1vcyAoZGlnZXN0IG9mIHNvcnRlZFxuICogZmluZGluZ3MgKyB1bmNvdmVyZWQgcGF0aHMpLCB1bmRlciB0aGUgZ2l0IGNvbW1vbiBkaXIgc28gaXQgaXMgc2hhcmVkXG4gKiBhY3Jvc3Mgd29ya3RyZWVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYWR2aXNvck1lbW9EaXIocmVwb1Jvb3Q6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKHF1ZXVlUm9vdChyZXBvUm9vdCksICdhZHZpc29yJyk7XG59XG4iLCAiLyoqXG4gKiBTdGF0aWMgY2xhc3NpZmljYXRpb24gb2YgYSBCYXNoIHRvb2wgYGNvbW1hbmRgIHN0cmluZyBpbnRvIHRoZSBmaWxlXG4gKiBwYXRoKHMpICsgbGluZSByYW5nZShzKSBpdCByZWFkcyBvciB3cml0ZXMsIHdoZXJlIHRoYXQncyBzdGF0aWNhbGx5XG4gKiBkZXRlcm1pbmFibGUuIEJ1aWx0IGZyb20gYW4gZW1waXJpY2FsIHBhc3Mgb3ZlciB+MzFrIHJlYWwgQ2xhdWRlIENvZGVcbiAqIEJhc2ggaW52b2NhdGlvbnMgKHNlZSBhbmFseXplLXRyYW5zY3JpcHRzLm10cykgXHUyMDE0IHRoZSBpZGlvbXMgYmVsb3cgYXJlXG4gKiBleGFjdGx5IHRoZSBvbmVzIHRoYXQgdHVybmVkIG91dCB0byBiZSBjb21tb24gQU5EIHJlbGlhYmxlIHRoZXJlLlxuICpcbiAqIERlbGliZXJhdGVseSBOT1QgY292ZXJlZCAoc2VlIHRoZSByZXNlYXJjaCByZXBvcnQpOiBhd2sgTlItdHJpY2tzIChyYXJlLFxuICogdW5jb25zdHJhaW5lZCBzeW50YXgpLCBncmVwIC1uLy1BLy1CLy1DICh0aGUgd2luZG93IGlzIGFuY2hvcmVkIHRvIG1hdGNoXG4gKiBwb3NpdGlvbiwgd2hpY2ggaXMgZGF0YS1kZXBlbmRlbnQsIG5vdCBpbiB0aGUgY29tbWFuZCB0ZXh0KSwgZW1iZWRkZWRcbiAqIHB5dGhvbjMvbm9kZSBoZXJlZG9jIHNjcmlwdHMgKGEgZGlmZmVyZW50IGxhbmd1YWdlJ3MgQVNULCBub3QgYSBzaGVsbFxuICogY29uY2VybiksIHNlZCAtaSAobm8gbGluZS1hZGRyZXNzZWQgdXNhZ2Ugb2JzZXJ2ZWQgXHUyMDE0IGFsbCBwYXR0ZXJuLW9ubHlcbiAqIHN1YnN0aXR1dGlvbnMgd2l0aCBubyBzdGF0aWMgcmFuZ2UpLCBwbGFpbiBgZWNob2AvYHByaW50ZmAgcmVkaXJlY3RzIChyYXJlXG4gKiBhbmQgc2VtYW50aWNhbGx5IGFtYmlndW91cyBpbiB0aGUgY29ycHVzKS5cbiAqL1xuaW1wb3J0IHsgaXNBYnNvbHV0ZSwgcmVzb2x2ZSBhcyByZXNvbHZlUGF0aCB9IGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgeyBjb3VudEZpbGVMaW5lcywgY291bnRHaXRCbG9iTGluZXMgfSBmcm9tICcuL2NvbW1hbmQtcmVzb2x2ZS5qcyc7XG5pbXBvcnQge1xuICBhcmd2T2YsXG4gIHR5cGUgT3BlcmF0b3IsXG4gIHR5cGUgU2ltcGxlQ29tbWFuZCxcbiAgc3BsaXRUb3BMZXZlbCxcbiAgc3BsaXRXb3JkcyxcbiAgc3RyaXBSZWRpcmVjdHMsXG4gIHN0cmlwV3JhcHBlcnNcbn0gZnJvbSAnLi9zaGVsbC1zcGxpdC5qcyc7XG5pbXBvcnQgeyBERUZBVUxUX1BBVEhfQUxMT1dMSVNULCBleHBhbmRWYXJpYWJsZXMgfSBmcm9tICcuL3ZhcmlhYmxlLWV4cGFuZC5qcyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVzb2x2ZWRTcGFuIHtcbiAgbGluZVN0YXJ0OiBudW1iZXI7XG4gIGxpbmVFbmQ6IG51bWJlcjtcbiAgYWJzb2x1dGVQYXRoOiBzdHJpbmc7XG4gIC8qKlxuICAgKiBUaGUgZXhhY3QgYm9keSBvZiBhIGBoZXJlZG9jLXdyaXRlYCBzcGFuIFx1MjAxNCB0aGUgY29udGVudCB0aGUgaGVyZWRvYyB3cml0ZXMuXG4gICAqIEFic2VudCAodW5kZWZpbmVkKSBmb3IgcmVhZCBpZGlvbXMuXG4gICAqL1xuICBib2R5Pzogc3RyaW5nO1xuICAvKipcbiAgICogVGhlIGhlcmVkb2MgcmVkaXJlY3Qgb3BlcmF0b3IuIGA+YCBtZWFucyB0aGUgZmlsZSB3YXMgb3ZlcndyaXR0ZW5cbiAgICogKHdob2xlLWZpbGUgc2NvcGUgXHUyMDE0IGFueSBzcGFuIGJleW9uZCB0aGUgbmV3IEVPRiB3YXMgZGVsZXRlZCBhbmQgbXVzdFxuICAgKiBzdXJmYWNlKTsgYD4+YCBtZWFucyB0aGUgYm9keSB3YXMgYXBwZW5kZWQgKG5hcnJvdyB0byB0aGUgYXBwZW5kIHJhbmdlKS5cbiAgICogQWJzZW50ICh1bmRlZmluZWQpIGZvciByZWFkIGlkaW9tcy5cbiAgICovXG4gIHJlZGlyZWN0PzogJz4nIHwgJz4+Jztcbn1cblxuZXhwb3J0IHR5cGUgSWRpb20gPVxuICB8ICdzZWQtbi1yYW5nZSdcbiAgfCAnaGVhZC1maWxlJ1xuICB8ICd0YWlsLWZpbGUnXG4gIHwgJ2NhdC1maWxlJ1xuICB8ICdubC1maWxlJ1xuICB8ICdnaXQtc2hvdy1yZXYtcGF0aCdcbiAgfCAnZ2l0LWxvZy1MJ1xuICB8ICdoZXJlZG9jLXdyaXRlJztcblxuZXhwb3J0IHR5cGUgU3Bhbk1hdGNoID1cbiAgfCB7IHN0YXR1czogJ3Jlc29sdmVkJzsgaWRpb206IElkaW9tOyBzcGFuOiBSZXNvbHZlZFNwYW47IG5vdGU/OiBzdHJpbmcgfVxuICB8IHsgc3RhdHVzOiAndW5yZXNvbHZlZCc7IGlkaW9tOiBJZGlvbTsgZmlsZUFyZzogc3RyaW5nOyByZWFzb246IHN0cmluZyB9O1xuXG4vKiogT3B0aW9ucyBmb3IgdGhlIEJhc2ggY29tbWFuZCBwYXJzZXIgKHBsYW4gXHUwMEE3OCkuICovXG5leHBvcnQgaW50ZXJmYWNlIFBhcnNlT3B0aW9ucyB7XG4gIC8qKiBUaGUgd29ya2luZyBkaXJlY3RvcnkgdG8gcmVzb2x2ZSByZWxhdGl2ZSBwYXRocyBhZ2FpbnN0OyBkZWZhdWx0cyB0byBgcHJvY2Vzcy5jd2QoKWAuICovXG4gIGN3ZD86IHN0cmluZztcbiAgLyoqIFRoZSBob29rIHByb2Nlc3MgZW52LCBmb3IgYWxsb3dsaXN0ZWQgcGF0aC12YXJpYWJsZSByZXNvbHV0aW9uOyBkZWZhdWx0cyB0byBgcHJvY2Vzcy5lbnZgLiAqL1xuICBlbnY/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCB1bmRlZmluZWQ+O1xuICAvKiogVmFyaWFibGUgbmFtZXMgYWxsb3dlZCB0byByZXNvbHZlIGZyb20gYGVudmA7IGRlZmF1bHRzIHRvIGBERUZBVUxUX1BBVEhfQUxMT1dMSVNUYC4gKi9cbiAgYWxsb3dsaXN0PzogcmVhZG9ubHkgc3RyaW5nW107XG59XG5cbi8qKiBXaGV0aGVyIGEgc2ltcGxlIGNvbW1hbmQgaXMga25vd24gdG8gaGF2ZSBleGVjdXRlZCwgcHJvdmFibHkgbm90LCBvciB1bmRldGVybWluYWJsZSAocGxhbiBcdTAwQTcyKS4gKi9cbmV4cG9ydCB0eXBlIEV4ZWNTdGF0dXMgPSAneWVzJyB8ICdubycgfCAndW5rbm93bic7XG5cbi8qKiBUaGUgZXhlY3V0aW9uLWF3YXJlIHdhbGsncyB2ZXJkaWN0IGZvciBvbmUgc2ltcGxlIGNvbW1hbmQgKHBsYW4gXHUwMEE3MikuICovXG5leHBvcnQgaW50ZXJmYWNlIFN0YWdlRXhlYyB7XG4gIC8qKiBgJ3llcydgIFx1MjAxNCBwcm92YWJseSBleGVjdXRlZDsgYCdubydgIFx1MjAxNCBwcm92YWJseSBub3Q7IGAndW5rbm93bidgIFx1MjAxNCB1bmRldGVybWluYWJsZSAoZmFpbCBjbG9zZWQpLiAqL1xuICBleGVjOiBFeGVjU3RhdHVzO1xufVxuXG4vKipcbiAqIENvbXB1dGUsIHBlciBzaW1wbGUgY29tbWFuZCwgd2hldGhlciBpdCBleGVjdXRlZCAocGxhbiBcdTAwQTcyKTogcGlwZWxpbmVcbiAqIGdyb3VwaW5nLCBgJiZgL2B8fGAgY2hhaW4gZ2F0aW5nIGFnYWluc3Qga25vd24gc3RhdHVzZXMsIGAhYCBncm91cC1sZXZlbFxuICogbmVnYXRpb24sIGluLXN0cmluZyBlcnJleGl0L3BpcGVmYWlsIGxpdmVuZXNzLCB0ZXJtaW5hdG9yIGFuZCBuZXZlci1yZXR1cm5cbiAqIGZpcmVzLCBhbmQgdGhlIGRlY2lkYWJsZS1jb250cm9sIGNvbnN0cnVjdCBjbGFzc2VzLiBJTy1mcmVlIGFuZCBleHBvcnRlZCBzb1xuICogdGhlIHh0cmFjZSBvcmFjbGUgY2FuIGNvbXBhcmUgZXhlY3V0ZWQgc2V0cyBhZ2FpbnN0IHJlYWwgYmFzaC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFuYWx5emVFeGVjdXRpb24oc2ltcGxlQ29tbWFuZHM6IFNpbXBsZUNvbW1hbmRbXSwgX29wdHM6IFBhcnNlT3B0aW9ucyA9IHt9KTogU3RhZ2VFeGVjW10ge1xuICBjb25zdCB3YWxrZXIgPSBuZXcgRXhlY3V0aW9uV2Fsa2VyKCk7XG4gIHdhbGtlci53YWxrSW5wdXQoc2ltcGxlQ29tbWFuZHMpO1xuICByZXR1cm4gd2Fsa2VyLnZlcmRpY3RzLm1hcCgoZXhlYykgPT4gKHsgZXhlYyB9KSk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRXhlY3V0aW9uIHdhbGsgKHBsYW4gXHUwMEE3Mik6IHBlci1zaW1wbGUtY29tbWFuZCBFeGVjU3RhdHVzLCBkcml2ZW4gYnkgcGlwZWxpbmVcbi8vIGdyb3VwaW5nLCAmJi98fCBjaGFpbiBzdGF0dXMsIGluLXN0cmluZyBlcnJleGl0L3BpcGVmYWlsIGxpdmVuZXNzLCBhbmQgdGhlXG4vLyBkZWNpZGFibGUtY29udHJvbCBjb25zdHJ1Y3QgY2xhc3Nlcy4gVGhlIHdhbGsgYWxzbyBleHBhbmRzIGRlY2lkYWJsZVxuLy8gY29uc3RydWN0IGludGVyaW9ycyBpbnRvIHRoZSBzdGFnZSBzdHJlYW0gdGhlIGVtaXNzaW9uIHJlcGxheSBjb25zdW1lcy5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50eXBlIENoYWluU3RhdHVzID0gJ3N1Y2Nlc3MnIHwgJ2ZhaWx1cmUnIHwgJ3Vua25vd24nO1xuXG50eXBlIERlYWRLaW5kID0gJ2V4aXQnIHwgJ25ldmVyLXJldHVybicgfCAnZXJyZXhpdCcgfCAnbWFsZm9ybWVkJztcblxuLyoqIE9uZSBzdGFnZSB0aGUgd2FsayBjb250cmlidXRlcyB0byB0aGUgZW1pc3Npb24gcmVwbGF5LiAqL1xuaW50ZXJmYWNlIEV4cGFuZGVkU3RhZ2Uge1xuICB0ZXh0OiBzdHJpbmc7XG4gIHByZWNlZGVkQnk6IE9wZXJhdG9yO1xuICBleGVjOiBFeGVjU3RhdHVzO1xuICAvKiogQSBtZW1iZXIgb2YgYSBtdWx0aS1tZW1iZXIgcGlwZWxpbmU6IHNpZGUgZWZmZWN0cyBhbmQgYGV4aXRgL2BleGVjYCB0ZXJtaW5hdG9ycyBhcmUgc3VwcHJlc3NlZC4gKi9cbiAgaW5QaXBlbGluZTogYm9vbGVhbjtcbiAgLyoqIFRoZSBlbWlzc2lvbidzIGBjZGAgZnJhbWU6ICsxIGluc2lkZSBhIHN1YnNoZWxsIGludGVyaW9yLCBkaXNjYXJkZWQgYXQgdGhlIGNsb3NlLiAqL1xuICBkaXJGcmFtZTogbnVtYmVyO1xuICAvKiogVGhlIHNjcmlwdCB2YXJpYWJsZSB0YWJsZSBhcyBvZiB0aGlzIHN0YWdlIChwbGFuIFx1MDBBNzcpOiB0aGUgZXhlY3V0ZWQgbm9uLXBpcGUgYXNzaWdubWVudHMgc2VlbiBzbyBmYXIsIGluIG9yZGVyLiAqL1xuICBhc3NpZ25tZW50czogUmVhZG9ubHlNYXA8c3RyaW5nLCBzdHJpbmc+O1xufVxuXG5pbnRlcmZhY2UgTG9vcEZyYW1lIHtcbiAgb3V0Y29tZTogJ25vbmUnIHwgJ2JyZWFrJyB8ICdjb250aW51ZScgfCAnYW1iaWd1b3VzJyB8ICdyZXR1cm4nO1xuICAvKiogQSBkZWNpc2l2ZSBvd24tZGVwdGggYnJlYWsvY29udGludWUgZmlyZWQ6IHRoZSByZXN0IG9mIHRoZSBib2R5IGxpc3QgaXMgZGVhZC4gKi9cbiAgYm9keVRlcm1pbmF0ZWQ6IGJvb2xlYW47XG4gIC8qKiBBIGhpZGRlbiBicmVhay9jb250aW51ZSBtYWRlIHRoZSBndWFyZCBvbndhcmQgdW50b3VjaGFibGUuICovXG4gIGFtYmlndW91c1N0b3A6IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBXYWxrT3B0aW9ucyB7XG4gIC8qKiBFcnJleGl0IGxpdmVuZXNzIGlzIHN1c3BlbmRlZCBpbnNpZGUgaWYvd2hpbGUvdW50aWwgY29uZGl0aW9ucyAoYmFzaCBleGVtcHRzIHRoZW0pLiAqL1xuICBsaXZlbmVzczogYm9vbGVhbjtcbiAgLyoqIFRoZSBleHBhbmRlZCBzdGFnZSBzdHJlYW0gaXMgZGlzY2FyZGVkIChjb25kaXRpb25zLCBzY2FucywgZGVmLWJvZHkgcHJvYmVzKS4gKi9cbiAgZGlzY2FyZDogYm9vbGVhbjtcbiAgLyoqIFNpZGUgZWZmZWN0cyAoYXNzaWdubWVudHMsIHNldCB0b2dnbGVzLCBkZWYgcmVnaXN0cmF0aW9uKSBhcmUgYXBwbGllZC4gKi9cbiAgc2lkZUVmZmVjdHM6IGJvb2xlYW47XG4gIC8qKiBUaGlzIGxpc3QgaXMgdGhlIHRvcC1sZXZlbCBpbnB1dDogcmVjb3JkIHRoZSBwZXItaW5wdXQgdmVyZGljdHMuICovXG4gIGlucHV0RmFjaW5nOiBib29sZWFuO1xufVxuXG5jb25zdCBBU1NJR05NRU5UX1JFID0gL15bQS1aYS16X11bQS1aYS16MC05X10qPS87XG5cbi8qKiBUaGUgYC1vYC9gK29gIG9wdGlvbiBuYW1lcyBvZiBgc2V0YCB0aGF0IGJhc2ggZG9jdW1lbnRzIChwbGFuIFx1MDBBNzIsIGtub3duIHN0YXR1c2VzKS4gKi9cbmNvbnN0IFNFVF9PUFRJT05fTkFNRVMgPSBuZXcgU2V0KFtcbiAgJ2FsbGV4cG9ydCcsXG4gICdicmFjZWV4cGFuZCcsXG4gICdlbWFjcycsXG4gICdlcnJleGl0JyxcbiAgJ2VycnRyYWNlJyxcbiAgJ2Z1bmN0cmFjZScsXG4gICdoYXNoYWxsJyxcbiAgJ2hpc3RleHBhbmQnLFxuICAnaGlzdG9yeScsXG4gICdpZ25vcmVlb2YnLFxuICAnaW50ZXJhY3RpdmUtY29tbWVudHMnLFxuICAna2V5d29yZCcsXG4gICdsZXhpY2FsLXdvcmQtcHJvY2Vzc2luZycsXG4gICdtb25pdG9yJyxcbiAgJ25vY2xvYmJlcicsXG4gICdub2V4ZWMnLFxuICAnbm9nbG9iJyxcbiAgJ25vbG9nJyxcbiAgJ25vdGlmeScsXG4gICdub3Vuc2V0JyxcbiAgJ29uZWNtZCcsXG4gICdwaHlzaWNhbCcsXG4gICdwaXBlZmFpbCcsXG4gICdwb3NpeCcsXG4gICdwcml2aWxlZ2VkJyxcbiAgJ3ZlcmJvc2UnLFxuICAndmknLFxuICAneHRyYWNlJ1xuXSk7XG5cbi8qKiBiYXNoJ3MgZG9jdW1lbnRlZCBzaW5nbGUtbGV0dGVyIGBzZXRgIGZsYWdzIChwbGFuIFx1MDBBNzIsIGtub3duIHN0YXR1c2VzKS4gKi9cbmNvbnN0IFNFVF9GTEFHX0xFVFRFUlMgPSAnYUJiQ2VFZmhIaWttbm9wUHRUdXZ4JztcblxuLyoqIEJ1aWx0aW5zIHRoZSB3YWxrJ3MgcmVzdHJpY3RlZCBgYnVpbHRpbmAgd3JhcHBlciBzdHJpcCBmb3J3YXJkcyAocGxhbiBcdTAwQTcyLCB3cmFwcGVyIGRpc2NpcGxpbmUpLiAqL1xuY29uc3QgUkVDT0dOSVpFRF9CVUlMVElOUyA9IG5ldyBTZXQoW1xuICAndHJ1ZScsXG4gICc6JyxcbiAgJ2ZhbHNlJyxcbiAgJ3NldCcsXG4gICdleGl0JyxcbiAgJ2V4ZWMnLFxuICAncmV0dXJuJyxcbiAgJ2JyZWFrJyxcbiAgJ2NvbnRpbnVlJyxcbiAgJ2NkJyxcbiAgJ2V4cG9ydCcsXG4gICdjb21tYW5kJyxcbiAgJ2J1aWx0aW4nXG5dKTtcblxuLyoqIFdhbGstc2lkZSB3cmFwcGVyIHN0cmlwOiBgIWAsIGBjb21tYW5kYCwgYW5kIGBidWlsdGluYCAocmVzdHJpY3RlZCB0byB0aGUgcmVjb2duaXplZCBidWlsdGlucykuICovXG5mdW5jdGlvbiB3YWxrU3RyaXAoYXJndjogc3RyaW5nW10pOiBzdHJpbmdbXSB7XG4gIGxldCBpID0gMDtcbiAgd2hpbGUgKGkgPCBhcmd2Lmxlbmd0aCAmJiBhcmd2W2ldID09PSAnIScpIGkrKztcbiAgd2hpbGUgKGkgPCBhcmd2Lmxlbmd0aCAmJiBhcmd2W2ldID09PSAnY29tbWFuZCcpIGkrKztcbiAgd2hpbGUgKGkgPCBhcmd2Lmxlbmd0aCAmJiBhcmd2W2ldID09PSAnYnVpbHRpbicgJiYgYXJndltpICsgMV0gIT09IHVuZGVmaW5lZCAmJiBSRUNPR05JWkVEX0JVSUxUSU5TLmhhcyhhcmd2W2kgKyAxXSkpXG4gICAgaSsrO1xuICByZXR1cm4gYXJndi5zbGljZShpKTtcbn1cblxuLyoqIEVtaXNzaW9uLXNpZGUgc3RyaXA6IGxlYWRpbmcgYCFgLCBgY29tbWFuZGAsIGBleGVjYCwgYW5kIGBidWlsdGluYCAocmVzdHJpY3RlZCB0byB0aGUgcmVjb2duaXplZCBidWlsdGlucykgYmVmb3JlIG1hdGNoZXIgZGlzcGF0Y2guICovXG5mdW5jdGlvbiBzdHJpcEZvckVtaXNzaW9uKGFyZ3Y6IHN0cmluZ1tdKTogc3RyaW5nW10ge1xuICBsZXQgaSA9IDA7XG4gIHdoaWxlIChpIDwgYXJndi5sZW5ndGggJiYgYXJndltpXSA9PT0gJyEnKSBpKys7XG4gIHdoaWxlIChpIDwgYXJndi5sZW5ndGggJiYgKGFyZ3ZbaV0gPT09ICdjb21tYW5kJyB8fCBhcmd2W2ldID09PSAnZXhlYycpKSBpKys7XG4gIHdoaWxlIChpIDwgYXJndi5sZW5ndGggJiYgYXJndltpXSA9PT0gJ2J1aWx0aW4nICYmIGFyZ3ZbaSArIDFdICE9PSB1bmRlZmluZWQgJiYgUkVDT0dOSVpFRF9CVUlMVElOUy5oYXMoYXJndltpICsgMV0pKVxuICAgIGkrKztcbiAgcmV0dXJuIGFyZ3Yuc2xpY2UoaSk7XG59XG5cbi8qKiBFdmVyeSBhcmcgYSByZWNvZ25pemVkIGBzZXRgIGZsYWcgZ3JvdXAgKGAtb2AgY29uc3VtZXMgaXRzIG5hbWUpLCBgLS1gLCBvciBhIHBvc2l0aW9uYWwgd29yZC4gKi9cbmZ1bmN0aW9uIHNldEZsYWdzS25vd24oYXJnczogc3RyaW5nW10pOiBib29sZWFuIHtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBhcmdzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFyZ3NbaV07XG4gICAgaWYgKGEgPT09ICctLScpIGNvbnRpbnVlO1xuICAgIGlmIChhLnN0YXJ0c1dpdGgoJy0nKSB8fCBhLnN0YXJ0c1dpdGgoJysnKSkge1xuICAgICAgY29uc3QgY2hhcnMgPSBhLnNsaWNlKDEpO1xuICAgICAgaWYgKGNoYXJzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIGZhbHNlO1xuICAgICAgZm9yIChsZXQgayA9IDA7IGsgPCBjaGFycy5sZW5ndGg7IGsrKykge1xuICAgICAgICBjb25zdCBjID0gY2hhcnNba107XG4gICAgICAgIGlmIChjID09PSAnbycpIHtcbiAgICAgICAgICBjb25zdCBuYW1lID0gYXJnc1tpICsgMV07XG4gICAgICAgICAgaWYgKG5hbWUgPT09IHVuZGVmaW5lZCB8fCAhU0VUX09QVElPTl9OQU1FUy5oYXMobmFtZSkpIHJldHVybiBmYWxzZTtcbiAgICAgICAgICBpKys7XG4gICAgICAgIH0gZWxzZSBpZiAoIVNFVF9GTEFHX0xFVFRFUlMuaW5jbHVkZXMoYykpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgLy8gQSBwb3NpdGlvbmFsIHBhcmFtZXRlciB3b3JkIFx1MjAxNCBgc2V0IGZvb2AgZXhpdHMgMC5cbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn1cblxuLyoqXG4gKiBBIHF1b3RlLWF3YXJlIHNjYW4gb2YgYSBjb25zdHJ1Y3QncyB0ZXh0IHRoYXQgeWllbGRzIGl0cyB3b3JkcyAocXVvdGVcbiAqIGNvbnRlbnQgc3RyaXBwZWQpIHdpdGggdGhlIHBhcmVuL2JyYWNlL2NvbnN0cnVjdCBkZXB0aHMgYXQgZWFjaCB3b3JkLCBzb1xuICogYHRoZW5gL2Bkb2AvYGRvbmVgL2BmaWAvYGVzYWNgL2BpbmAga2V5d29yZHMgYXJlIHJlY29nbml6ZWQgb25seSBhdCB0aGVcbiAqIGxldmVsIHRoYXQgb3ducyB0aGVtLlxuICovXG5pbnRlcmZhY2UgV29yZFRvayB7XG4gIHdvcmQ6IHN0cmluZztcbiAgc3RhcnQ6IG51bWJlcjtcbiAgZW5kOiBudW1iZXI7XG4gIGRlcHRoOiBudW1iZXI7XG4gIGJyYWNlRGVwdGg6IG51bWJlcjtcbiAgY29uc3RydWN0RGVwdGg6IG51bWJlcjtcbiAgcXVvdGVkOiBib29sZWFuO1xufVxuXG5jb25zdCBDT05TVFJVQ1RfT1BFTkVSUyA9IG5ldyBTZXQoWydpZicsICd3aGlsZScsICd1bnRpbCcsICdmb3InLCAnY2FzZScsICdzZWxlY3QnXSk7XG5jb25zdCBDT05TVFJVQ1RfQ0xPU0VSUyA9IG5ldyBTZXQoWydmaScsICdkb25lJywgJ2VzYWMnXSk7XG5cbmZ1bmN0aW9uIHNjYW5Ub2tlbnModGV4dDogc3RyaW5nKTogV29yZFRva1tdIHtcbiAgY29uc3QgdG9rczogV29yZFRva1tdID0gW107XG4gIGxldCBpID0gMDtcbiAgY29uc3QgbiA9IHRleHQubGVuZ3RoO1xuICBsZXQgcGFyZW5EZXB0aCA9IDA7XG4gIGxldCBicmFjZURlcHRoID0gMDtcbiAgbGV0IGNvbnN0cnVjdERlcHRoID0gMDtcbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgY29uc3QgYyA9IHRleHRbaV07XG4gICAgaWYgKC9cXHMvLnRlc3QoYykpIHtcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJygnIHx8IGMgPT09ICd7Jykge1xuICAgICAgaWYgKGMgPT09ICcoJykgcGFyZW5EZXB0aCsrO1xuICAgICAgZWxzZSBicmFjZURlcHRoKys7XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICcpJyB8fCBjID09PSAnfScpIHtcbiAgICAgIGlmIChjID09PSAnKScpIHBhcmVuRGVwdGggPSBNYXRoLm1heCgwLCBwYXJlbkRlcHRoIC0gMSk7XG4gICAgICBlbHNlIGJyYWNlRGVwdGggPSBNYXRoLm1heCgwLCBicmFjZURlcHRoIC0gMSk7XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKCc7Jnw8PicuaW5jbHVkZXMoYykpIHtcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBzdGFydCA9IGk7XG4gICAgY29uc3QgdyA9IHJlYWRXb3JkQXQodGV4dCwgaSk7XG4gICAgaWYgKHcgPT09IG51bGwpIHtcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpID0gdy5lbmQ7XG4gICAgdG9rcy5wdXNoKHsgd29yZDogdy53b3JkLCBzdGFydCwgZW5kOiB3LmVuZCwgZGVwdGg6IHBhcmVuRGVwdGgsIGJyYWNlRGVwdGgsIGNvbnN0cnVjdERlcHRoLCBxdW90ZWQ6IHcucXVvdGVkIH0pO1xuICAgIGlmIChwYXJlbkRlcHRoID09PSAwICYmIGJyYWNlRGVwdGggPT09IDAgJiYgIXcucXVvdGVkKSB7XG4gICAgICBpZiAoQ09OU1RSVUNUX09QRU5FUlMuaGFzKHcud29yZCkpIGNvbnN0cnVjdERlcHRoKys7XG4gICAgICBlbHNlIGlmIChDT05TVFJVQ1RfQ0xPU0VSUy5oYXMody53b3JkKSkgY29uc3RydWN0RGVwdGggPSBNYXRoLm1heCgwLCBjb25zdHJ1Y3REZXB0aCAtIDEpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdG9rcztcbn1cblxuLyoqIFJlYWQgb25lIHdvcmQgYXQgYGlgIChxdW90ZS1hd2FyZSwgc2VwYXJhdG9yLXRlcm1pbmF0ZWQpOyByZXR1cm5zIGl0cyBjb250ZW50IGFuZCBzcGFuLiAqL1xuZnVuY3Rpb24gcmVhZFdvcmRBdCh0ZXh0OiBzdHJpbmcsIGk6IG51bWJlcik6IHsgd29yZDogc3RyaW5nOyBlbmQ6IG51bWJlcjsgcXVvdGVkOiBib29sZWFuIH0gfCBudWxsIHtcbiAgaWYgKGkgPj0gdGV4dC5sZW5ndGgpIHJldHVybiBudWxsO1xuICBsZXQgd29yZCA9ICcnO1xuICBsZXQgcXVvdGVkID0gZmFsc2U7XG4gIGNvbnN0IG4gPSB0ZXh0Lmxlbmd0aDtcbiAgd2hpbGUgKGkgPCBuICYmICEvXFxzLy50ZXN0KHRleHRbaV0pICYmICEnKCl7fTsmfDw+Jy5pbmNsdWRlcyh0ZXh0W2ldKSkge1xuICAgIGNvbnN0IGNoID0gdGV4dFtpXTtcbiAgICBpZiAoY2ggPT09IFwiJ1wiKSB7XG4gICAgICBxdW90ZWQgPSB0cnVlO1xuICAgICAgaSsrO1xuICAgICAgd2hpbGUgKGkgPCBuICYmIHRleHRbaV0gIT09IFwiJ1wiKSB7XG4gICAgICAgIHdvcmQgKz0gdGV4dFtpXTtcbiAgICAgICAgaSsrO1xuICAgICAgfVxuICAgICAgaWYgKGkgPCBuKSBpKys7XG4gICAgfSBlbHNlIGlmIChjaCA9PT0gJ1wiJykge1xuICAgICAgcXVvdGVkID0gdHJ1ZTtcbiAgICAgIGkrKztcbiAgICAgIHdoaWxlIChpIDwgbiAmJiB0ZXh0W2ldICE9PSAnXCInKSB7XG4gICAgICAgIGlmICh0ZXh0W2ldID09PSAnXFxcXCcgJiYgaSArIDEgPCBuICYmICdcIlxcXFwkYCcuaW5jbHVkZXModGV4dFtpICsgMV0pKSB7XG4gICAgICAgICAgd29yZCArPSB0ZXh0W2kgKyAxXTtcbiAgICAgICAgICBpICs9IDI7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgd29yZCArPSB0ZXh0W2ldO1xuICAgICAgICAgIGkrKztcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKGkgPCBuKSBpKys7XG4gICAgfSBlbHNlIGlmIChjaCA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikge1xuICAgICAgd29yZCArPSB0ZXh0W2kgKyAxXTtcbiAgICAgIGkgKz0gMjtcbiAgICB9IGVsc2Uge1xuICAgICAgd29yZCArPSBjaDtcbiAgICAgIGkrKztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHsgd29yZCwgZW5kOiBpLCBxdW90ZWQgfTtcbn1cblxuLyoqIFRoZSBpbnRlcmlvciBiZXR3ZWVuIHRoZSBmaXJzdCBgb3BlbmAgY2hhciBhbmQgaXRzIG1hdGNoaW5nIGBjbG9zZWAsIHF1b3RlcyBhd2FyZS4gKi9cbmZ1bmN0aW9uIGV4dHJhY3RHcm91cEJvZHkodGV4dDogc3RyaW5nLCBvcGVuOiAneycgfCAnKCcsIGNsb3NlOiAnfScgfCAnKScpOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3Qgc3RhcnQgPSB0ZXh0LmluZGV4T2Yob3Blbik7XG4gIGlmIChzdGFydCA9PT0gLTEpIHJldHVybiBudWxsO1xuICBsZXQgZGVwdGggPSAwO1xuICBsZXQgaW5RdW90ZTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGZvciAobGV0IHAgPSBzdGFydDsgcCA8IHRleHQubGVuZ3RoOyBwKyspIHtcbiAgICBjb25zdCBjaCA9IHRleHRbcF07XG4gICAgaWYgKGluUXVvdGUgIT09IG51bGwpIHtcbiAgICAgIGlmIChjaCA9PT0gJ1xcXFwnICYmIGluUXVvdGUgPT09ICdcIicgJiYgcCArIDEgPCB0ZXh0Lmxlbmd0aCAmJiAnXCJcXFxcJGAnLmluY2x1ZGVzKHRleHRbcCArIDFdKSkgcCsrO1xuICAgICAgZWxzZSBpZiAoY2ggPT09IGluUXVvdGUpIGluUXVvdGUgPSBudWxsO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gXCInXCIgfHwgY2ggPT09ICdcIicpIHtcbiAgICAgIGluUXVvdGUgPSBjaDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY2ggPT09ICdcXFxcJykge1xuICAgICAgcCsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gb3BlbikgZGVwdGgrKztcbiAgICBlbHNlIGlmIChjaCA9PT0gY2xvc2UpIHtcbiAgICAgIGRlcHRoLS07XG4gICAgICBpZiAoZGVwdGggPT09IDApIHJldHVybiB0ZXh0LnNsaWNlKHN0YXJ0ICsgMSwgcCk7XG4gICAgfVxuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG50eXBlIENvbnN0cnVjdEtpbmQgPSAnaWYnIHwgJ3doaWxlJyB8ICd1bnRpbCcgfCAnZm9yJyB8ICdjYXNlJyB8ICdzZWxlY3QnIHwgJ2JyYWNlJyB8ICdzdWJzaGVsbCcgfCAnZGVmJyB8ICdwbGFpbic7XG5cbmZ1bmN0aW9uIGNsYXNzaWZ5U3RhZ2UodGV4dDogc3RyaW5nKTogQ29uc3RydWN0S2luZCB7XG4gIGNvbnN0IHQgPSB0ZXh0LnRyaW1TdGFydCgpO1xuICBpZiAodC5zdGFydHNXaXRoKCd7JykpIHJldHVybiAnYnJhY2UnO1xuICBpZiAodC5zdGFydHNXaXRoKCcoJykpIHJldHVybiAnc3Vic2hlbGwnO1xuICBjb25zdCBrdyA9IHQubWF0Y2goL14oaWZ8d2hpbGV8dW50aWx8Zm9yfGNhc2V8c2VsZWN0KVxcYi8pO1xuICBpZiAoa3cgIT09IG51bGwpIHJldHVybiBrd1sxXSBhcyBDb25zdHJ1Y3RLaW5kO1xuICBpZiAoL14oPzpmdW5jdGlvblxccyspP1tBLVphLXpfXVtBLVphLXowLTlfXSpcXChcXClcXHMqXFx7Ly50ZXN0KHQpKSByZXR1cm4gJ2RlZic7XG4gIHJldHVybiAncGxhaW4nO1xufVxuXG4vKiogQSBmdW5jdGlvbiBkZWZpbml0aW9uJ3MgbmFtZSBhbmQgYm9keSB0ZXh0IChicmFjZS1ncm91cCBpbnRlcmlvcikuICovXG5mdW5jdGlvbiBwYXJzZURlZih0ZXh0OiBzdHJpbmcpOiB7IG5hbWU6IHN0cmluZzsgYm9keTogc3RyaW5nIH0gfCBudWxsIHtcbiAgY29uc3QgbSA9IHRleHQubWF0Y2goL14oPzpmdW5jdGlvblxccyspPyhbQS1aYS16X11bQS1aYS16MC05X10qKVxccyooPzpcXChcXCkpP1xccypcXHsvKTtcbiAgaWYgKG0gPT09IG51bGwpIHJldHVybiBudWxsO1xuICBjb25zdCBib2R5ID0gZXh0cmFjdEdyb3VwQm9keSh0ZXh0LCAneycsICd9Jyk7XG4gIGlmIChib2R5ID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHsgbmFtZTogbVsxXSwgYm9keSB9O1xufVxuXG5pbnRlcmZhY2UgUGFyc2VkSWYge1xuICBjb25kaXRpb246IHN0cmluZztcbiAgdGhlbkJvZHk6IHN0cmluZztcbiAgZWxpZnM6IHsgY29uZGl0aW9uOiBzdHJpbmc7IGJvZHk6IHN0cmluZyB9W107XG4gIGVsc2VCb2R5OiBzdHJpbmcgfCBudWxsO1xufVxuXG5mdW5jdGlvbiBwYXJzZUlmKHRleHQ6IHN0cmluZyk6IFBhcnNlZElmIHwgbnVsbCB7XG4gIGNvbnN0IHRva3MgPSBzY2FuVG9rZW5zKHRleHQpO1xuICBpZiAodG9rcy5sZW5ndGggPT09IDAgfHwgdG9rc1swXS53b3JkICE9PSAnaWYnKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgdGhlbklkeCA9IHRva3MuZmluZEluZGV4KCh0KSA9PiB0LndvcmQgPT09ICd0aGVuJyAmJiB0LmNvbnN0cnVjdERlcHRoID09PSAxKTtcbiAgaWYgKHRoZW5JZHggPT09IC0xKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgdGhlblRvayA9IHRva3NbdGhlbklkeF07XG4gIGNvbnN0IGNvbmRpdGlvbiA9IHRleHQuc2xpY2UodG9rc1swXS5lbmQsIHRoZW5Ub2suc3RhcnQpO1xuXG4gIGNvbnN0IGJvdW5kYXJpZXM6IHsgd29yZDogc3RyaW5nOyB0b2s6IFdvcmRUb2sgfVtdID0gW107XG4gIGZvciAobGV0IGlkeCA9IHRoZW5JZHggKyAxOyBpZHggPCB0b2tzLmxlbmd0aDsgaWR4KyspIHtcbiAgICBjb25zdCB0ID0gdG9rc1tpZHhdO1xuICAgIGlmICh0LmNvbnN0cnVjdERlcHRoICE9PSAxIHx8ICh0LndvcmQgIT09ICdlbGlmJyAmJiB0LndvcmQgIT09ICdlbHNlJyAmJiB0LndvcmQgIT09ICdmaScpKSBjb250aW51ZTtcbiAgICBpZiAodC53b3JkID09PSAnZWxpZicpIHtcbiAgICAgIGNvbnN0IGVUaGVuSWR4ID0gdG9rcy5maW5kSW5kZXgoKHR0LCBpaSkgPT4gaWkgPiBpZHggJiYgdHQud29yZCA9PT0gJ3RoZW4nICYmIHR0LmNvbnN0cnVjdERlcHRoID09PSAxKTtcbiAgICAgIGlmIChlVGhlbklkeCA9PT0gLTEpIHJldHVybiBudWxsO1xuICAgICAgYm91bmRhcmllcy5wdXNoKHsgd29yZDogJ2VsaWYnLCB0b2s6IHQgfSwgeyB3b3JkOiAndGhlbicsIHRvazogdG9rc1tlVGhlbklkeF0gfSk7XG4gICAgICBpZHggPSBlVGhlbklkeDtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBib3VuZGFyaWVzLnB1c2goeyB3b3JkOiB0LndvcmQsIHRvazogdCB9KTtcbiAgICBpZiAodC53b3JkID09PSAnZWxzZScpIHtcbiAgICAgIGNvbnN0IGZpSWR4ID0gdG9rcy5maW5kSW5kZXgoKHR0LCBpaSkgPT4gaWkgPiBpZHggJiYgdHQud29yZCA9PT0gJ2ZpJyAmJiB0dC5jb25zdHJ1Y3REZXB0aCA9PT0gMSk7XG4gICAgICBpZiAoZmlJZHggPT09IC0xKSByZXR1cm4gbnVsbDtcbiAgICAgIGJvdW5kYXJpZXMucHVzaCh7IHdvcmQ6ICdmaScsIHRvazogdG9rc1tmaUlkeF0gfSk7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgYnJlYWs7XG4gIH1cbiAgaWYgKGJvdW5kYXJpZXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICBjb25zdCB0aGVuQm9keSA9IHRleHQuc2xpY2UodGhlblRvay5lbmQsIGJvdW5kYXJpZXNbMF0udG9rLnN0YXJ0KTtcbiAgY29uc3QgZWxpZnM6IHsgY29uZGl0aW9uOiBzdHJpbmc7IGJvZHk6IHN0cmluZyB9W10gPSBbXTtcbiAgbGV0IGVsc2VCb2R5OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgZm9yIChsZXQgYiA9IDA7IGIgPCBib3VuZGFyaWVzLmxlbmd0aDsgYisrKSB7XG4gICAgY29uc3QgeyB3b3JkLCB0b2sgfSA9IGJvdW5kYXJpZXNbYl07XG4gICAgaWYgKHdvcmQgPT09ICdlbGlmJykge1xuICAgICAgY29uc3QgZVRoZW4gPSBib3VuZGFyaWVzW2IgKyAxXTtcbiAgICAgIGlmIChlVGhlbiA9PT0gdW5kZWZpbmVkIHx8IGVUaGVuLndvcmQgIT09ICd0aGVuJykgcmV0dXJuIG51bGw7XG4gICAgICBjb25zdCBuZXh0U3RhcnQgPSBib3VuZGFyaWVzW2IgKyAyXT8udG9rLnN0YXJ0ID8/IHRleHQubGVuZ3RoO1xuICAgICAgZWxpZnMucHVzaCh7IGNvbmRpdGlvbjogdGV4dC5zbGljZSh0b2suZW5kLCBlVGhlbi50b2suc3RhcnQpLCBib2R5OiB0ZXh0LnNsaWNlKGVUaGVuLnRvay5lbmQsIG5leHRTdGFydCkgfSk7XG4gICAgICBiKys7XG4gICAgfSBlbHNlIGlmICh3b3JkID09PSAnZWxzZScpIHtcbiAgICAgIGNvbnN0IGZpID0gYm91bmRhcmllc1tiICsgMV07XG4gICAgICBpZiAoZmkgPT09IHVuZGVmaW5lZCB8fCBmaS53b3JkICE9PSAnZmknKSByZXR1cm4gbnVsbDtcbiAgICAgIGVsc2VCb2R5ID0gdGV4dC5zbGljZSh0b2suZW5kLCBmaS50b2suc3RhcnQpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG4gIHJldHVybiB7IGNvbmRpdGlvbiwgdGhlbkJvZHksIGVsaWZzLCBlbHNlQm9keSB9O1xufVxuXG5mdW5jdGlvbiBwYXJzZUxvb3AodGV4dDogc3RyaW5nLCBrZXl3b3JkOiAnd2hpbGUnIHwgJ3VudGlsJyk6IHsgY29uZGl0aW9uOiBzdHJpbmc7IGJvZHk6IHN0cmluZyB9IHwgbnVsbCB7XG4gIGNvbnN0IHRva3MgPSBzY2FuVG9rZW5zKHRleHQpO1xuICBpZiAodG9rcy5sZW5ndGggPT09IDAgfHwgdG9rc1swXS53b3JkICE9PSBrZXl3b3JkKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgZG9Ub2sgPSB0b2tzLmZpbmQoKHQpID0+IHQud29yZCA9PT0gJ2RvJyAmJiB0LmNvbnN0cnVjdERlcHRoID09PSAxKTtcbiAgaWYgKGRvVG9rID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICBjb25zdCBkb25lVG9rID0gdG9rcy5maW5kKCh0KSA9PiB0LnN0YXJ0ID4gZG9Ub2suZW5kICYmIHQud29yZCA9PT0gJ2RvbmUnICYmIHQuY29uc3RydWN0RGVwdGggPT09IDEpO1xuICBpZiAoZG9uZVRvayA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHsgY29uZGl0aW9uOiB0ZXh0LnNsaWNlKHRva3NbMF0uZW5kLCBkb1Rvay5zdGFydCksIGJvZHk6IHRleHQuc2xpY2UoZG9Ub2suZW5kLCBkb25lVG9rLnN0YXJ0KSB9O1xufVxuXG5pbnRlcmZhY2UgUGFyc2VkRm9yIHtcbiAgbGlzdDogc3RyaW5nW10gfCBudWxsO1xuICBib2R5OiBzdHJpbmc7XG4gIHdob2xlSW50ZXJpb3I6IHN0cmluZztcbn1cblxuZnVuY3Rpb24gcGFyc2VGb3IodGV4dDogc3RyaW5nKTogUGFyc2VkRm9yIHwgbnVsbCB7XG4gIGNvbnN0IHRva3MgPSBzY2FuVG9rZW5zKHRleHQpO1xuICBpZiAodG9rcy5sZW5ndGggPT09IDAgfHwgdG9rc1swXS53b3JkICE9PSAnZm9yJykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IG5hbWVUb2sgPSB0b2tzWzFdO1xuICBpZiAobmFtZVRvayA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgZG9Ub2sgPSB0b2tzLmZpbmQoKHQpID0+IHQud29yZCA9PT0gJ2RvJyAmJiB0LmNvbnN0cnVjdERlcHRoID09PSAxICYmIHQuc3RhcnQgPiBuYW1lVG9rLmVuZCk7XG4gIGlmIChkb1RvayA9PT0gdW5kZWZpbmVkKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgZG9uZVRvayA9IHRva3MuZmluZCgodCkgPT4gdC5zdGFydCA+IGRvVG9rLmVuZCAmJiB0LndvcmQgPT09ICdkb25lJyAmJiB0LmNvbnN0cnVjdERlcHRoID09PSAxKTtcbiAgaWYgKGRvbmVUb2sgPT09IHVuZGVmaW5lZCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGluVG9rID0gdG9rcy5maW5kKFxuICAgICh0KSA9PiB0LnN0YXJ0ID4gbmFtZVRvay5lbmQgJiYgdC5zdGFydCA8IGRvVG9rLnN0YXJ0ICYmIHQud29yZCA9PT0gJ2luJyAmJiB0LmNvbnN0cnVjdERlcHRoID09PSAxXG4gICk7XG4gIGxldCBsaXN0OiBzdHJpbmdbXSB8IG51bGwgPSBudWxsO1xuICBpZiAoaW5Ub2sgIT09IHVuZGVmaW5lZCkge1xuICAgIGxpc3QgPSB0b2tzLmZpbHRlcigodCkgPT4gdC5zdGFydCA+IGluVG9rLmVuZCAmJiB0LnN0YXJ0IDwgZG9Ub2suc3RhcnQpLm1hcCgodCkgPT4gdC53b3JkKTtcbiAgfVxuICByZXR1cm4geyBsaXN0LCBib2R5OiB0ZXh0LnNsaWNlKGRvVG9rLmVuZCwgZG9uZVRvay5zdGFydCksIHdob2xlSW50ZXJpb3I6IHRleHQuc2xpY2UobmFtZVRvay5lbmQsIGRvbmVUb2suc3RhcnQpIH07XG59XG5cbmludGVyZmFjZSBQYXJzZWRDYXNlIHtcbiAgc3ViamVjdDogc3RyaW5nO1xuICBicmFuY2hlczogeyBwYXR0ZXJuOiBzdHJpbmc7IGJvZHk6IHN0cmluZyB9W107XG4gIGZhbGx0aHJvdWdoOiBib29sZWFuO1xufVxuXG5mdW5jdGlvbiBwYXJzZUNhc2UodGV4dDogc3RyaW5nKTogUGFyc2VkQ2FzZSB8IG51bGwge1xuICBsZXQgaSA9IDA7XG4gIGNvbnN0IG4gPSB0ZXh0Lmxlbmd0aDtcbiAgY29uc3Qgc2tpcFdzID0gKCkgPT4ge1xuICAgIHdoaWxlIChpIDwgbiAmJiAvXFxzLy50ZXN0KHRleHRbaV0pKSBpKys7XG4gIH07XG4gIHNraXBXcygpO1xuICBjb25zdCBsZWFkID0gcmVhZFdvcmRBdCh0ZXh0LCBpKTtcbiAgaWYgKGxlYWQgPT09IG51bGwgfHwgbGVhZC53b3JkICE9PSAnY2FzZScpIHJldHVybiBudWxsO1xuICBpID0gbGVhZC5lbmQ7XG5cbiAgLy8gVGhlIHN1YmplY3Qgd29yZHMgdXAgdG8gdGhlIGBpbmAgYXQgcGFyZW4gZGVwdGggMCAocXVvdGUgY29udGVudCBvbmx5KS5cbiAgbGV0IHBhcmVuRGVwdGggPSAwO1xuICBjb25zdCBzdWJqZWN0V29yZHM6IHN0cmluZ1tdID0gW107XG4gIHdoaWxlIChpIDwgbikge1xuICAgIHNraXBXcygpO1xuICAgIGlmIChpID49IG4pIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGMgPSB0ZXh0W2ldO1xuICAgIGlmIChjID09PSAnKCcpIHtcbiAgICAgIHBhcmVuRGVwdGgrKztcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJyknKSB7XG4gICAgICBwYXJlbkRlcHRoID0gTWF0aC5tYXgoMCwgcGFyZW5EZXB0aCAtIDEpO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgnOyZ8PD4nLmluY2x1ZGVzKGMpKSB7XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgdyA9IHJlYWRXb3JkQXQodGV4dCwgaSk7XG4gICAgaWYgKHcgPT09IG51bGwpIHtcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpID0gdy5lbmQ7XG4gICAgaWYgKHBhcmVuRGVwdGggPT09IDAgJiYgIXcucXVvdGVkICYmIHcud29yZCA9PT0gJ2luJykgYnJlYWs7XG4gICAgc3ViamVjdFdvcmRzLnB1c2gody53b3JkKTtcbiAgfVxuICBpZiAoaSA+PSBuKSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBicmFuY2hlczogeyBwYXR0ZXJuOiBzdHJpbmc7IGJvZHk6IHN0cmluZyB9W10gPSBbXTtcbiAgbGV0IGZhbGx0aHJvdWdoID0gZmFsc2U7XG4gIHdoaWxlICh0cnVlKSB7XG4gICAgc2tpcFdzKCk7XG4gICAgaWYgKGkgPj0gbikgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgdyA9IHJlYWRXb3JkQXQodGV4dCwgaSk7XG4gICAgaWYgKHcgIT09IG51bGwgJiYgIXcucXVvdGVkICYmIHcud29yZCA9PT0gJ2VzYWMnKSB7XG4gICAgICByZXR1cm4geyBzdWJqZWN0OiBzdWJqZWN0V29yZHMuam9pbignICcpLCBicmFuY2hlcywgZmFsbHRocm91Z2ggfTtcbiAgICB9XG4gICAgLy8gVGhlIHBhdHRlcm46IGV2ZXJ5dGhpbmcgdXAgdG8gdGhlIGApYCBhdCBwYXJlbiBkZXB0aCAwLlxuICAgIGxldCBwYXRFbmQgPSAtMTtcbiAgICB7XG4gICAgICBsZXQgcCA9IGk7XG4gICAgICBsZXQgZGVwdGggPSAwO1xuICAgICAgbGV0IGluUXVvdGU6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAgICAgd2hpbGUgKHAgPCBuKSB7XG4gICAgICAgIGNvbnN0IGNoID0gdGV4dFtwXTtcbiAgICAgICAgaWYgKGluUXVvdGUgIT09IG51bGwpIHtcbiAgICAgICAgICBpZiAoY2ggPT09ICdcXFxcJyAmJiBpblF1b3RlID09PSAnXCInICYmIHAgKyAxIDwgbiAmJiAnXCJcXFxcJGAnLmluY2x1ZGVzKHRleHRbcCArIDFdKSkge1xuICAgICAgICAgICAgcCArPSAyO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChjaCA9PT0gaW5RdW90ZSkgaW5RdW90ZSA9IG51bGw7XG4gICAgICAgICAgcCsrO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjaCA9PT0gXCInXCIgfHwgY2ggPT09ICdcIicpIHtcbiAgICAgICAgICBpblF1b3RlID0gY2g7XG4gICAgICAgICAgcCsrO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjaCA9PT0gJ1xcXFwnKSB7XG4gICAgICAgICAgcCArPSAyO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjaCA9PT0gJygnKSB7XG4gICAgICAgICAgZGVwdGgrKztcbiAgICAgICAgICBwKys7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoID09PSAnKScpIHtcbiAgICAgICAgICBpZiAoZGVwdGggPT09IDApIHtcbiAgICAgICAgICAgIHBhdEVuZCA9IHA7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgZGVwdGgtLTtcbiAgICAgICAgICBwKys7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgcCsrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAocGF0RW5kID09PSAtMSkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgcGF0dGVybiA9IHRleHQuc2xpY2UoaSwgcGF0RW5kKS50cmltKCk7XG4gICAgaSA9IHBhdEVuZCArIDE7XG5cbiAgICAvLyBUaGUgYm9keTogZXZlcnl0aGluZyB1cCB0byB0aGUgYDs7YC9gOyZgL2A7OyZgIGF0IHBhcmVuL2JyYWNlIGRlcHRoIDAuXG4gICAgbGV0IGJvZHlFbmQgPSAtMTtcbiAgICBsZXQgdGVybSA9ICcnO1xuICAgIHtcbiAgICAgIGxldCBwID0gaTtcbiAgICAgIGxldCBkZXB0aCA9IDA7XG4gICAgICBsZXQgYmRlcHRoID0gMDtcbiAgICAgIGxldCBpblF1b3RlOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgICAgIHdoaWxlIChwIDwgbikge1xuICAgICAgICBjb25zdCBjaCA9IHRleHRbcF07XG4gICAgICAgIGlmIChpblF1b3RlICE9PSBudWxsKSB7XG4gICAgICAgICAgaWYgKGNoID09PSAnXFxcXCcgJiYgaW5RdW90ZSA9PT0gJ1wiJyAmJiBwICsgMSA8IG4gJiYgJ1wiXFxcXCRgJy5pbmNsdWRlcyh0ZXh0W3AgKyAxXSkpIHtcbiAgICAgICAgICAgIHAgKz0gMjtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoY2ggPT09IGluUXVvdGUpIGluUXVvdGUgPSBudWxsO1xuICAgICAgICAgIHArKztcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY2ggPT09IFwiJ1wiIHx8IGNoID09PSAnXCInKSB7XG4gICAgICAgICAgaW5RdW90ZSA9IGNoO1xuICAgICAgICAgIHArKztcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY2ggPT09ICdcXFxcJykge1xuICAgICAgICAgIHAgKz0gMjtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY2ggPT09ICcoJykge1xuICAgICAgICAgIGRlcHRoKys7XG4gICAgICAgICAgcCsrO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjaCA9PT0gJyknKSB7XG4gICAgICAgICAgZGVwdGggPSBNYXRoLm1heCgwLCBkZXB0aCAtIDEpO1xuICAgICAgICAgIHArKztcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY2ggPT09ICd7Jykge1xuICAgICAgICAgIGJkZXB0aCsrO1xuICAgICAgICAgIHArKztcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY2ggPT09ICd9Jykge1xuICAgICAgICAgIGJkZXB0aCA9IE1hdGgubWF4KDAsIGJkZXB0aCAtIDEpO1xuICAgICAgICAgIHArKztcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZGVwdGggPT09IDAgJiYgYmRlcHRoID09PSAwICYmIGNoID09PSAnOycpIHtcbiAgICAgICAgICBjb25zdCBuZXh0ID0gdGV4dFtwICsgMV07XG4gICAgICAgICAgaWYgKG5leHQgPT09ICc7JyB8fCBuZXh0ID09PSAnJicpIHtcbiAgICAgICAgICAgIHRlcm0gPSBuZXh0ID09PSAnOycgPyAodGV4dFtwICsgMl0gPT09ICcmJyA/ICc7OyYnIDogJzs7JykgOiAnOyYnO1xuICAgICAgICAgICAgYm9keUVuZCA9IHA7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcCsrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAodGVybSA9PT0gJycpIHJldHVybiBudWxsO1xuICAgIGJyYW5jaGVzLnB1c2goeyBwYXR0ZXJuLCBib2R5OiB0ZXh0LnNsaWNlKGksIGJvZHlFbmQpLnRyaW0oKSB9KTtcbiAgICBpID0gYm9keUVuZCArIHRlcm0ubGVuZ3RoO1xuICAgIGlmICh0ZXJtID09PSAnOyYnIHx8IHRlcm0gPT09ICc7OyYnKSBmYWxsdGhyb3VnaCA9IHRydWU7XG4gIH1cbn1cblxuLyoqIFJlc29sdmUgYSBgY2FzZWAgc3ViamVjdCBhZ2FpbnN0IHRoZSByZWNvcmRlZCBhc3NpZ25tZW50cyAocGxhbiBcdTAwQTcxLCBkZWNpZGFibGUgY2FzZSkuICovXG5mdW5jdGlvbiByZXNvbHZlU3ViamVjdChzdWJqZWN0OiBzdHJpbmcsIGFzc2lnbm1lbnRzOiBNYXA8c3RyaW5nLCBzdHJpbmc+KTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IG0gPSBzdWJqZWN0Lm1hdGNoKC9eXFwkKFtBLVphLXpfXVtBLVphLXowLTlfXSopJC8pID8/IHN1YmplY3QubWF0Y2goL15cXCRcXHsoW0EtWmEtel9dW0EtWmEtejAtOV9dKilcXH0kLyk7XG4gIGlmIChtICE9PSBudWxsKSB7XG4gICAgY29uc3QgdiA9IGFzc2lnbm1lbnRzLmdldChtWzFdKTtcbiAgICByZXR1cm4gdiAhPT0gdW5kZWZpbmVkID8gdiA6IG51bGw7XG4gIH1cbiAgaWYgKC9bJGBdLy50ZXN0KHN1YmplY3QpKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHN1YmplY3Q7XG59XG5cbi8qKlxuICogQWx0ZXJuYXRpdmUgc3BsaXQgb2YgYSBgY2FzZWAgcGF0dGVybiBvbiB1bnF1b3RlZCBgfGAuIFRoZSBhbHRlcm5hdGl2ZXMgYXJlXG4gKiByZXR1cm5lZCB2ZXJiYXRpbSBcdTIwMTQgcXVvdGVzIGFuZCBiYWNrc2xhc2ggZXNjYXBlcyBwcmVzZXJ2ZWQgXHUyMDE0IHNvXG4gKiBgYW5hbHl6ZVBhdHRlcm5gJ3MgcXVvdGUgaGFuZGxpbmcgaXMgdGhlIHNpbmdsZSBpbnRlcnByZXRlcjogc3RyaXBwaW5nIHRoZW1cbiAqIGhlcmUgd291bGQgdHVybiBgJ2EqJ2AgaW50byBhbiB1bnF1b3RlZCBnbG9iIGFuZCBgXFx8YCBpbnRvIGEgc3BsaXQgcG9pbnQuXG4gKi9cbmZ1bmN0aW9uIHNwbGl0UGF0dGVybkFsdGVybmF0aXZlcyhwYXR0ZXJuOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHBhcnRzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgY3VyID0gJyc7XG4gIGxldCBpblF1b3RlOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBwYXR0ZXJuLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgY2ggPSBwYXR0ZXJuW2ldO1xuICAgIGlmIChpblF1b3RlICE9PSBudWxsKSB7XG4gICAgICBpZiAoY2ggPT09ICdcXFxcJyAmJiBpblF1b3RlID09PSAnXCInICYmIGkgKyAxIDwgcGF0dGVybi5sZW5ndGggJiYgJ1wiXFxcXCRgJy5pbmNsdWRlcyhwYXR0ZXJuW2kgKyAxXSkpIHtcbiAgICAgICAgY3VyICs9IGNoO1xuICAgICAgICBjdXIgKz0gcGF0dGVybltpICsgMV07XG4gICAgICAgIGkrKztcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoY2ggPT09IGluUXVvdGUpIHtcbiAgICAgICAgaW5RdW90ZSA9IG51bGw7XG4gICAgICAgIGN1ciArPSBjaDtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjdXIgKz0gY2g7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSBcIidcIiB8fCBjaCA9PT0gJ1wiJykge1xuICAgICAgaW5RdW90ZSA9IGNoO1xuICAgICAgY3VyICs9IGNoO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgcGF0dGVybi5sZW5ndGgpIHtcbiAgICAgIGN1ciArPSBjaDtcbiAgICAgIGN1ciArPSBwYXR0ZXJuW2kgKyAxXTtcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY2ggPT09ICd8Jykge1xuICAgICAgcGFydHMucHVzaChjdXIpO1xuICAgICAgY3VyID0gJyc7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY3VyICs9IGNoO1xuICB9XG4gIHBhcnRzLnB1c2goY3VyKTtcbiAgcmV0dXJuIHBhcnRzO1xufVxuXG4vKipcbiAqIFF1b3RlLWF3YXJlIHBhdHRlcm4gYW5hbHlzaXM6IHRoZSBsaXRlcmFsIHZhbHVlIChxdW90ZXMgc3RyaXBwZWQsIGJhY2tzbGFzaFxuICogZXNjYXBlcyByZXNvbHZlZCkgYW5kIHdoZXRoZXIgYW55IHVucXVvdGVkIGdsb2IgY2hhciBhcHBlYXJzLlxuICovXG5mdW5jdGlvbiBhbmFseXplUGF0dGVybihwYXR0ZXJuOiBzdHJpbmcpOiB7IGxpdGVyYWw6IHN0cmluZzsgZ2xvYjogYm9vbGVhbiB9IHtcbiAgbGV0IGxpdGVyYWwgPSAnJztcbiAgbGV0IGdsb2IgPSBmYWxzZTtcbiAgbGV0IGluUXVvdGU6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHBhdHRlcm4ubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBjaCA9IHBhdHRlcm5baV07XG4gICAgaWYgKGluUXVvdGUgIT09IG51bGwpIHtcbiAgICAgIGlmIChjaCA9PT0gJ1xcXFwnICYmIGluUXVvdGUgPT09ICdcIicgJiYgaSArIDEgPCBwYXR0ZXJuLmxlbmd0aCAmJiAnXCJcXFxcJGAnLmluY2x1ZGVzKHBhdHRlcm5baSArIDFdKSkge1xuICAgICAgICBsaXRlcmFsICs9IHBhdHRlcm5baSArIDFdO1xuICAgICAgICBpKys7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGNoID09PSBpblF1b3RlKSB7XG4gICAgICAgIGluUXVvdGUgPSBudWxsO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGxpdGVyYWwgKz0gY2g7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoID09PSBcIidcIiB8fCBjaCA9PT0gJ1wiJykge1xuICAgICAgaW5RdW90ZSA9IGNoO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjaCA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgcGF0dGVybi5sZW5ndGgpIHtcbiAgICAgIGxpdGVyYWwgKz0gcGF0dGVybltpICsgMV07XG4gICAgICBpKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKCcqP1snLmluY2x1ZGVzKGNoKSkge1xuICAgICAgZ2xvYiA9IHRydWU7XG4gICAgICBsaXRlcmFsICs9IGNoO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGxpdGVyYWwgKz0gY2g7XG4gIH1cbiAgcmV0dXJuIHsgbGl0ZXJhbCwgZ2xvYiB9O1xufVxuXG50eXBlIFBhdHRlcm5SZXN1bHQgPSAnbWF0Y2gnIHwgJ25vLW1hdGNoJyB8ICdnbG9iJyB8ICd1bmRlY2lkYWJsZSc7XG5cbi8qKlxuICogRml4dHVyZS1waW5uZWQgYGNhc2VgIHBhdHRlcm4gZXZhbHVhdGlvbiAocGxhbiBcdTAwQTcxLCBkZWNpZGFibGUgY2FzZSk6IGEgYHxgXG4gKiBwYXR0ZXJuIGlzIGRlY2lkYWJsZSBpZmYgaXRzIGZpcnN0IGFsdGVybmF0aXZlIGlzIGEgbGl0ZXJhbCBtYXRjaCBhbmQgZXZlcnlcbiAqIGFsdGVybmF0aXZlIGFmdGVyIHRoZSBmaXJzdCBpcyBhIGdsb2IgKGRlYWQpOyBhIGdsb2IgYmVmb3JlIGFueSBsaXRlcmFsXG4gKiBtYXRjaCBpcyB1bmRlY2lkYWJsZSwgYW5kIGEgbGF0ZXIgbGl0ZXJhbCBub24tbWF0Y2ggYWZ0ZXIgYSBsaXRlcmFsIG1hdGNoXG4gKiBpcyB1bmRlY2lkYWJsZSAodGhlIGFsbC1saXRlcmFsIGBhfGJgIGZhaWwtY2xvc2VkIGRpdmVyZ2VuY2UgXHUyMDE0IGJhc2ggcnVuc1xuICogdGhlIGJyYW5jaCkuXG4gKi9cbmZ1bmN0aW9uIGV2YWxQYXR0ZXJuKHBhdHRlcm46IHN0cmluZywgc3ViamVjdDogc3RyaW5nKTogUGF0dGVyblJlc3VsdCB7XG4gIGNvbnN0IGFsdHMgPSBzcGxpdFBhdHRlcm5BbHRlcm5hdGl2ZXMocGF0dGVybik7XG4gIGxldCBtYXRjaGVkID0gZmFsc2U7XG4gIGZvciAoY29uc3QgYWx0IG9mIGFsdHMpIHtcbiAgICBjb25zdCB7IGxpdGVyYWwsIGdsb2IgfSA9IGFuYWx5emVQYXR0ZXJuKGFsdCk7XG4gICAgaWYgKGdsb2IpIHtcbiAgICAgIGlmICghbWF0Y2hlZCkgcmV0dXJuICdnbG9iJztcbiAgICB9IGVsc2UgaWYgKGxpdGVyYWwgPT09IHN1YmplY3QpIHtcbiAgICAgIG1hdGNoZWQgPSB0cnVlO1xuICAgIH0gZWxzZSBpZiAobWF0Y2hlZCkge1xuICAgICAgcmV0dXJuICd1bmRlY2lkYWJsZSc7XG4gICAgfVxuICB9XG4gIHJldHVybiBtYXRjaGVkID8gJ21hdGNoJyA6ICduby1tYXRjaCc7XG59XG5cbi8qKiBUaGUgZXhlY3V0aW9uIHdhbGsncyBzaGFyZWQgc3RhdGUsIG9uZSBpbnN0YW5jZSBwZXIgYHBhcnNlQ29tbWFuZERldGFpbGVkYCBjYWxsLiAqL1xuY2xhc3MgRXhlY3V0aW9uV2Fsa2VyIHtcbiAgY2hhaW46IENoYWluU3RhdHVzID0gJ3N1Y2Nlc3MnO1xuICBlcnJleGl0ID0gZmFsc2U7XG4gIHBpcGVmYWlsID0gZmFsc2U7XG4gIGFzc2lnbm1lbnRzID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKTtcbiAgZGVmcyA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XG4gIGRlYWQ6IERlYWRLaW5kIHwgbnVsbCA9IG51bGw7XG4gIHJldHVybmVkID0gZmFsc2U7XG4gIGZuRGVwdGggPSAwO1xuICBsb29wU3RhY2s6IExvb3BGcmFtZVtdID0gW107XG4gIHJlYWRvbmx5IGV4cGFuZGVkOiBFeHBhbmRlZFN0YWdlW10gPSBbXTtcbiAgcmVhZG9ubHkgdmVyZGljdHM6IEV4ZWNTdGF0dXNbXSA9IFtdO1xuICBkaXJGcmFtZSA9IDA7XG4gIHJlYWRvbmx5IGRlZlByb2JlU3RhY2sgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuICB3YWxrSW5wdXQoc3RhZ2VzOiBTaW1wbGVDb21tYW5kW10pOiBFeHBhbmRlZFN0YWdlW10ge1xuICAgIHRoaXMud2Fsa0xpc3Qoc3RhZ2VzLCB7IGxpdmVuZXNzOiB0cnVlLCBkaXNjYXJkOiBmYWxzZSwgc2lkZUVmZmVjdHM6IHRydWUsIGlucHV0RmFjaW5nOiB0cnVlIH0pO1xuICAgIHJldHVybiB0aGlzLmV4cGFuZGVkO1xuICB9XG5cbiAgcHJpdmF0ZSBzdG9wcGVkKCk6IGJvb2xlYW4ge1xuICAgIGlmICh0aGlzLmRlYWQgIT09IG51bGwgfHwgdGhpcy5yZXR1cm5lZCkgcmV0dXJuIHRydWU7XG4gICAgY29uc3QgdG9wID0gdGhpcy5sb29wU3RhY2tbdGhpcy5sb29wU3RhY2subGVuZ3RoIC0gMV07XG4gICAgcmV0dXJuIHRvcCAhPT0gdW5kZWZpbmVkICYmICh0b3AuYm9keVRlcm1pbmF0ZWQgfHwgdG9wLmFtYmlndW91c1N0b3ApO1xuICB9XG5cbiAgLyoqIFdhbGsgb25lIGxpc3QgKGEgZnJlc2ggYCYmYC9gfHxgIGNoYWluKTsgcmV0dXJucyB0aGUgbGlzdCdzIGZpbmFsIGNoYWluIHN0YXR1cy4gKi9cbiAgcHJpdmF0ZSB3YWxrTGlzdChzdGFnZXM6IFNpbXBsZUNvbW1hbmRbXSwgb3B0czogV2Fsa09wdGlvbnMpOiBDaGFpblN0YXR1cyB7XG4gICAgY29uc3Qgc2F2ZWRDaGFpbiA9IHRoaXMuY2hhaW47XG4gICAgdGhpcy5jaGFpbiA9ICdzdWNjZXNzJztcbiAgICBsZXQgaSA9IDA7XG4gICAgd2hpbGUgKGkgPCBzdGFnZXMubGVuZ3RoICYmICF0aGlzLnN0b3BwZWQoKSkge1xuICAgICAgY29uc3QgZW5kID0gdGhpcy5ncm91cEVuZChzdGFnZXMsIGkpO1xuICAgICAgY29uc3QgbmV4dCA9IGVuZCA8IHN0YWdlcy5sZW5ndGggPyBzdGFnZXNbZW5kXSA6IG51bGw7XG4gICAgICB0aGlzLnByb2Nlc3NHcm91cChzdGFnZXMuc2xpY2UoaSwgZW5kKSwgbmV4dCwgb3B0cyk7XG4gICAgICBpID0gZW5kO1xuICAgIH1cbiAgICBjb25zdCByZXN1bHQgPSB0aGlzLmNoYWluO1xuICAgIHdoaWxlIChpIDwgc3RhZ2VzLmxlbmd0aCkge1xuICAgICAgaWYgKG9wdHMuaW5wdXRGYWNpbmcpIHRoaXMudmVyZGljdHMucHVzaCgnbm8nKTtcbiAgICAgIGkrKztcbiAgICB9XG4gICAgdGhpcy5jaGFpbiA9IHNhdmVkQ2hhaW47XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIHByaXZhdGUgZ3JvdXBFbmQoc3RhZ2VzOiBTaW1wbGVDb21tYW5kW10sIHN0YXJ0OiBudW1iZXIpOiBudW1iZXIge1xuICAgIGxldCBlbmQgPSBzdGFydDtcbiAgICB3aGlsZSAoZW5kICsgMSA8IHN0YWdlcy5sZW5ndGggJiYgc3RhZ2VzW2VuZCArIDFdLnByZWNlZGVkQnkgPT09ICdwaXBlJykgZW5kKys7XG4gICAgcmV0dXJuIGVuZCArIDE7XG4gIH1cblxuICBwcml2YXRlIHByb2Nlc3NHcm91cChncm91cDogU2ltcGxlQ29tbWFuZFtdLCBuZXh0OiBTaW1wbGVDb21tYW5kIHwgbnVsbCwgb3B0czogV2Fsa09wdGlvbnMpOiB2b2lkIHtcbiAgICBjb25zdCBmaXJzdCA9IGdyb3VwWzBdO1xuICAgIGxldCBleGVjdXRlczogYm9vbGVhbiB8ICd1bmtub3duJztcbiAgICBzd2l0Y2ggKGZpcnN0LnByZWNlZGVkQnkpIHtcbiAgICAgIGNhc2UgJ2FuZCc6XG4gICAgICAgIGV4ZWN1dGVzID0gdGhpcy5jaGFpbiA9PT0gJ3N1Y2Nlc3MnID8gdHJ1ZSA6IHRoaXMuY2hhaW4gPT09ICdmYWlsdXJlJyA/IGZhbHNlIDogJ3Vua25vd24nO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ29yJzpcbiAgICAgICAgZXhlY3V0ZXMgPSB0aGlzLmNoYWluID09PSAnZmFpbHVyZScgPyB0cnVlIDogdGhpcy5jaGFpbiA9PT0gJ3N1Y2Nlc3MnID8gZmFsc2UgOiAndW5rbm93bic7XG4gICAgICAgIGJyZWFrO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgZXhlY3V0ZXMgPSB0cnVlO1xuICAgIH1cbiAgICBjb25zdCBleGVjOiBFeGVjU3RhdHVzID0gZXhlY3V0ZXMgPT09IHRydWUgPyAneWVzJyA6IGV4ZWN1dGVzID09PSBmYWxzZSA/ICdubycgOiAndW5rbm93bic7XG4gICAgY29uc3QgYmFja2dyb3VuZGVkID0gZmlyc3QucHJlY2VkZWRCeSA9PT0gJ2JhY2tncm91bmQnIHx8IChuZXh0ICE9PSBudWxsICYmIG5leHQucHJlY2VkZWRCeSA9PT0gJ2JhY2tncm91bmQnKTtcbiAgICBpZiAob3B0cy5pbnB1dEZhY2luZykge1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBncm91cC5sZW5ndGg7IGkrKykgdGhpcy52ZXJkaWN0cy5wdXNoKGV4ZWMpO1xuICAgIH1cblxuICAgIC8vIGAhYCBpcyBhIGdyb3VwLWxldmVsIG1vZGlmaWVyOiB0aGUgY291bnQgb2YgbGVhZGluZyBgIWAgd29yZHMgb24gdGhlXG4gICAgLy8gZmlyc3QgbWVtYmVyJ3MgYXJndiBuZWdhdGVzIHRoZSBncm91cCdzIGZpbmFsIHN0YXR1cyAob2RkIG5lZ2F0ZXMpLlxuICAgIGNvbnN0IGZpcnN0QXJndiA9IGFyZ3ZPZihmaXJzdC50ZXh0KTtcbiAgICBsZXQgYmFuZ0NvdW50ID0gMDtcbiAgICBsZXQgbWVtYmVyQXJndjogc3RyaW5nW10gfCBudWxsID0gZmlyc3RBcmd2O1xuICAgIGlmIChmaXJzdEFyZ3YgIT09IG51bGwpIHtcbiAgICAgIHdoaWxlIChtZW1iZXJBcmd2IVtiYW5nQ291bnRdID09PSAnIScpIGJhbmdDb3VudCsrO1xuICAgICAgbWVtYmVyQXJndiA9IG1lbWJlckFyZ3YhLnNsaWNlKGJhbmdDb3VudCk7XG4gICAgfVxuICAgIGNvbnN0IGludmVydGVkID0gYmFuZ0NvdW50ICUgMiA9PT0gMTtcblxuICAgIGlmIChleGVjID09PSAnbm8nKSByZXR1cm47XG5cbiAgICBjb25zdCBzdGF0dXNlczogQ2hhaW5TdGF0dXNbXSA9IFtdO1xuICAgIGNvbnN0IGluUGlwZWxpbmUgPSBncm91cC5sZW5ndGggPiAxO1xuICAgIGZvciAobGV0IG0gPSAwOyBtIDwgZ3JvdXAubGVuZ3RoOyBtKyspIHtcbiAgICAgIHN0YXR1c2VzLnB1c2goXG4gICAgICAgIHRoaXMucHJvY2Vzc01lbWJlcihncm91cFttXSwge1xuICAgICAgICAgIGV4ZWMsXG4gICAgICAgICAgaW5QaXBlbGluZSxcbiAgICAgICAgICBiYWNrZ3JvdW5kZWQsXG4gICAgICAgICAgbWVtYmVyQXJndjogbSA9PT0gMCA/IG1lbWJlckFyZ3YgOiBudWxsLFxuICAgICAgICAgIG9wdHNcbiAgICAgICAgfSlcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gVGhlIGdyb3VwIHN0YXR1czogdGhlIGxhc3QgbWVtYmVyJ3MsIHVubGVzcyBwaXBlZmFpbCBtYWtlcyBpdCB0aGUgd29yc3QgbWVtYmVyLlxuICAgIGxldCBncm91cFN0YXR1czogQ2hhaW5TdGF0dXM7XG4gICAgaWYgKHRoaXMucGlwZWZhaWwgJiYgZ3JvdXAubGVuZ3RoID4gMSkge1xuICAgICAgaWYgKHN0YXR1c2VzLmV2ZXJ5KChzKSA9PiBzID09PSAnc3VjY2VzcycpKSBncm91cFN0YXR1cyA9ICdzdWNjZXNzJztcbiAgICAgIGVsc2UgaWYgKHN0YXR1c2VzLnNvbWUoKHMpID0+IHMgPT09ICdmYWlsdXJlJykpIGdyb3VwU3RhdHVzID0gJ2ZhaWx1cmUnO1xuICAgICAgZWxzZSBncm91cFN0YXR1cyA9ICd1bmtub3duJztcbiAgICB9IGVsc2Uge1xuICAgICAgZ3JvdXBTdGF0dXMgPSBzdGF0dXNlc1tzdGF0dXNlcy5sZW5ndGggLSAxXTtcbiAgICB9XG4gICAgaWYgKGludmVydGVkKSB7XG4gICAgICBncm91cFN0YXR1cyA9IGdyb3VwU3RhdHVzID09PSAnc3VjY2VzcycgPyAnZmFpbHVyZScgOiBncm91cFN0YXR1cyA9PT0gJ2ZhaWx1cmUnID8gJ3N1Y2Nlc3MnIDogJ3Vua25vd24nO1xuICAgIH1cblxuICAgIC8vIEVycmV4aXQgbGl2ZW5lc3M6IGFuIGV4ZWN1dGluZyBncm91cCB3aG9zZSBub24tZXhlbXB0IG1lbWJlcnMgZGlkIG5vdFxuICAgIC8vIGFsbCBzdWNjZWVkIGtpbGxzIHRoZSBzaGVsbDsgZXZlcnkgbGF0ZXIgc3RhZ2UgaXMgJ25vJy5cbiAgICBpZiAob3B0cy5saXZlbmVzcyAmJiB0aGlzLmVycmV4aXQgJiYgZ3JvdXBTdGF0dXMgIT09ICdzdWNjZXNzJykge1xuICAgICAgY29uc3QgY2hhaW5GaW5hbCA9IG5leHQgPT09IG51bGwgfHwgKG5leHQucHJlY2VkZWRCeSAhPT0gJ2FuZCcgJiYgbmV4dC5wcmVjZWRlZEJ5ICE9PSAnb3InKTtcbiAgICAgIGlmIChjaGFpbkZpbmFsICYmICFpbnZlcnRlZCAmJiAhYmFja2dyb3VuZGVkKSB0aGlzLmRlYWQgPSAnZXJyZXhpdCc7XG4gICAgfVxuXG4gICAgaWYgKGV4ZWMgPT09ICd5ZXMnKSB0aGlzLmNoYWluID0gZ3JvdXBTdGF0dXM7XG4gICAgZWxzZSB0aGlzLmNoYWluID0gJ3Vua25vd24nO1xuICB9XG5cbiAgcHJpdmF0ZSBwcm9jZXNzTWVtYmVyKFxuICAgIG1lbWJlcjogU2ltcGxlQ29tbWFuZCxcbiAgICBjdHg6IHtcbiAgICAgIGV4ZWM6IEV4ZWNTdGF0dXM7XG4gICAgICBpblBpcGVsaW5lOiBib29sZWFuO1xuICAgICAgYmFja2dyb3VuZGVkOiBib29sZWFuO1xuICAgICAgbWVtYmVyQXJndjogc3RyaW5nW10gfCBudWxsO1xuICAgICAgb3B0czogV2Fsa09wdGlvbnM7XG4gICAgfVxuICApOiBDaGFpblN0YXR1cyB7XG4gICAgY29uc3Qga2luZCA9IGNsYXNzaWZ5U3RhZ2UobWVtYmVyLnRleHQpO1xuICAgIGlmIChraW5kID09PSAncGxhaW4nKSByZXR1cm4gdGhpcy5wcm9jZXNzUGxhaW5NZW1iZXIobWVtYmVyLCBjdHgpO1xuICAgIHJldHVybiB0aGlzLnByb2Nlc3NDb25zdHJ1Y3QobWVtYmVyLCBraW5kLCBjdHgpO1xuICB9XG5cbiAgcHJpdmF0ZSBwcm9jZXNzUGxhaW5NZW1iZXIoXG4gICAgbWVtYmVyOiBTaW1wbGVDb21tYW5kLFxuICAgIGN0eDoge1xuICAgICAgZXhlYzogRXhlY1N0YXR1cztcbiAgICAgIGluUGlwZWxpbmU6IGJvb2xlYW47XG4gICAgICBiYWNrZ3JvdW5kZWQ6IGJvb2xlYW47XG4gICAgICBtZW1iZXJBcmd2OiBzdHJpbmdbXSB8IG51bGw7XG4gICAgICBvcHRzOiBXYWxrT3B0aW9ucztcbiAgICB9XG4gICk6IENoYWluU3RhdHVzIHtcbiAgICBjb25zdCB7IGV4ZWMsIGluUGlwZWxpbmUsIGJhY2tncm91bmRlZCwgbWVtYmVyQXJndiwgb3B0cyB9ID0gY3R4O1xuICAgIGNvbnN0IGFyZ3YgPSBtZW1iZXJBcmd2ID8/IGFyZ3ZPZihtZW1iZXIudGV4dCk7XG4gICAgY29uc3Qgc3RyaXBwZWQgPSBhcmd2ID09PSBudWxsID8gbnVsbCA6IHdhbGtTdHJpcChhcmd2KTtcblxuICAgIC8vIFNpZGUgZWZmZWN0cyBvbmx5IGZyb20gZXhlY3V0ZWQsIG5vbi1waXBlIHN0YWdlcy5cbiAgICBpZiAoZXhlYyA9PT0gJ3llcycgJiYgIWluUGlwZWxpbmUgJiYgb3B0cy5zaWRlRWZmZWN0cykge1xuICAgICAgdGhpcy5hcHBseVNpZGVFZmZlY3RzKG1lbWJlciwgYXJndiwgc3RyaXBwZWQpO1xuICAgIH1cblxuICAgIC8vIFRoZSBrbm93biBzdGF0dXMuXG4gICAgY29uc3Qgc3RhdHVzID0gdGhpcy5rbm93blN0YXR1cyhhcmd2KTtcblxuICAgIC8vIFRoZSB0ZXJtaW5hdG9yOiBhbiBleGVjdXRlZCBvciB1bmtub3duLWV4ZWN1dGlvbiBub24tcGlwZSBzdGFnZSB3aG9zZVxuICAgIC8vIHRlcm1pbmF0b3Igd29yZCAoYmFyZSwgb3IgYmVoaW5kIGBjb21tYW5kYC9gYnVpbHRpbmApIGlzIGBleGl0YC9gZXhlY2AuXG4gICAgaWYgKCFpblBpcGVsaW5lICYmIGV4ZWMgIT09ICdubycgJiYgc3RyaXBwZWQgIT09IG51bGwgJiYgKHN0cmlwcGVkWzBdID09PSAnZXhpdCcgfHwgc3RyaXBwZWRbMF0gPT09ICdleGVjJykpIHtcbiAgICAgIHRoaXMuZGVhZCA9ICdleGl0JztcbiAgICB9XG5cbiAgICAvLyBSZXR1cm4tc3RvcHBpbmc6IGEgcHJvdmFibHktZmlyaW5nIGNvbW1hbmQtcG9zaXRpb24gYHJldHVybmAgYXRcbiAgICAvLyBmdW5jdGlvbi1ib2R5IGRlcHRoIGV4aXRzIHRoZSBmdW5jdGlvbiBcdTIwMTQgZXZlcnl0aGluZyBhZnRlciBuZXZlciBydW5zLlxuICAgIGlmICghaW5QaXBlbGluZSAmJiBleGVjID09PSAneWVzJyAmJiB0aGlzLmZuRGVwdGggPiAwICYmIHN0cmlwcGVkICE9PSBudWxsICYmIHN0cmlwcGVkWzBdID09PSAncmV0dXJuJykge1xuICAgICAgdGhpcy5yZXR1cm5lZCA9IHRydWU7XG4gICAgICBjb25zdCB0b3AgPSB0aGlzLmxvb3BTdGFja1t0aGlzLmxvb3BTdGFjay5sZW5ndGggLSAxXTtcbiAgICAgIGlmICh0b3AgIT09IHVuZGVmaW5lZCkgdG9wLm91dGNvbWUgPSAncmV0dXJuJztcbiAgICB9XG5cbiAgICAvLyBCcmVhay9jb250aW51ZSBldmVudHMgKGEgaGlkZGVuIGAndW5rbm93bidgLWV4ZWMgb25lIG1ha2VzIHRoZSBndWFyZFxuICAgIC8vIHVudG91Y2hhYmxlIFx1MjAxNCBhbWJpZ3VvdXMgXHUyMDE0IHBlciB0aGUgbG9vcC1zY2FuIGRpc2NpcGxpbmUpLlxuICAgIGlmICghaW5QaXBlbGluZSAmJiBleGVjICE9PSAnbm8nICYmIHN0cmlwcGVkICE9PSBudWxsICYmIChzdHJpcHBlZFswXSA9PT0gJ2JyZWFrJyB8fCBzdHJpcHBlZFswXSA9PT0gJ2NvbnRpbnVlJykpIHtcbiAgICAgIHRoaXMuYXBwbHlCcmVha0NvbnRpbnVlKHN0cmlwcGVkLCBleGVjKTtcbiAgICB9XG5cbiAgICAvLyBBIGNhbGwgdG8gYSByZWdpc3RlcmVkIGRlZmluaXRpb24uXG4gICAgaWYgKGV4ZWMgIT09ICdubycgJiYgc3RyaXBwZWQgIT09IG51bGwgJiYgc3RyaXBwZWQubGVuZ3RoID4gMCkge1xuICAgICAgdGhpcy5hcHBseUNhbGwoc3RyaXBwZWRbMF0sIGluUGlwZWxpbmUsIGJhY2tncm91bmRlZCk7XG4gICAgfVxuXG4gICAgaWYgKCFvcHRzLmRpc2NhcmQpIHtcbiAgICAgIHRoaXMuZXhwYW5kZWQucHVzaCh7XG4gICAgICAgIHRleHQ6IG1lbWJlci50ZXh0LFxuICAgICAgICBwcmVjZWRlZEJ5OiBtZW1iZXIucHJlY2VkZWRCeSxcbiAgICAgICAgZXhlYyxcbiAgICAgICAgaW5QaXBlbGluZSxcbiAgICAgICAgZGlyRnJhbWU6IHRoaXMuZGlyRnJhbWUsXG4gICAgICAgIGFzc2lnbm1lbnRzOiBuZXcgTWFwKHRoaXMuYXNzaWdubWVudHMpXG4gICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuIHN0YXR1cztcbiAgfVxuXG4gIHByaXZhdGUgYXBwbHlCcmVha0NvbnRpbnVlKHN0cmlwcGVkOiBzdHJpbmdbXSwgZXhlYzogRXhlY1N0YXR1cyk6IHZvaWQge1xuICAgIGNvbnN0IGRlcHRoID0gTnVtYmVyLnBhcnNlSW50KHN0cmlwcGVkWzFdID8/ICcxJywgMTApO1xuICAgIGlmIChOdW1iZXIuaXNOYU4oZGVwdGgpIHx8IGRlcHRoIDwgMSkgcmV0dXJuO1xuICAgIGlmICh0aGlzLmxvb3BTdGFjay5sZW5ndGggPT09IDAgfHwgZGVwdGggPiB0aGlzLmxvb3BTdGFjay5sZW5ndGgpIHJldHVybjtcbiAgICBpZiAoZXhlYyA9PT0gJ3Vua25vd24nKSB7XG4gICAgICBmb3IgKGxldCBkID0gMDsgZCA8IGRlcHRoOyBkKyspIHtcbiAgICAgICAgY29uc3QgZnJhbWUgPSB0aGlzLmxvb3BTdGFja1t0aGlzLmxvb3BTdGFjay5sZW5ndGggLSAxIC0gZF07XG4gICAgICAgIGlmIChmcmFtZS5vdXRjb21lID09PSAnbm9uZScpIHtcbiAgICAgICAgICBmcmFtZS5vdXRjb21lID0gJ2FtYmlndW91cyc7XG4gICAgICAgICAgZnJhbWUuYW1iaWd1b3VzU3RvcCA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgaXNDb250aW51ZSA9IHN0cmlwcGVkWzBdID09PSAnY29udGludWUnO1xuICAgIGZvciAobGV0IGQgPSAwOyBkIDwgZGVwdGg7IGQrKykge1xuICAgICAgY29uc3QgZnJhbWUgPSB0aGlzLmxvb3BTdGFja1t0aGlzLmxvb3BTdGFjay5sZW5ndGggLSAxIC0gZF07XG4gICAgICBmcmFtZS5vdXRjb21lID0gaXNDb250aW51ZSA/ICdjb250aW51ZScgOiAnYnJlYWsnO1xuICAgICAgZnJhbWUuYm9keVRlcm1pbmF0ZWQgPSB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIC8qKiBBIG1heS1ydW4gY2FsbCB0byBhIHJlZ2lzdGVyZWQgZGVmaW5pdGlvbiBmaXJlcyBwZXIgaXRzIGJvZHkncyBkZWFkIGtpbmQuICovXG4gIHByaXZhdGUgYXBwbHlDYWxsKG5hbWU6IHN0cmluZywgaW5QaXBlbGluZTogYm9vbGVhbiwgYmFja2dyb3VuZGVkOiBib29sZWFuKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmRlZnMuaGFzKG5hbWUpIHx8IGJhY2tncm91bmRlZCkgcmV0dXJuO1xuICAgIGlmICh0aGlzLmRlZlByb2JlU3RhY2suaGFzKG5hbWUpKSByZXR1cm47IC8vIHJlY3Vyc2lvbjogdGhlIGlubmVyIGNhbGwgcmV0dXJucyBub3JtYWxseVxuICAgIGNvbnN0IGJvZHkgPSB0aGlzLmRlZnMuZ2V0KG5hbWUpITtcbiAgICB0aGlzLmRlZlByb2JlU3RhY2suYWRkKG5hbWUpO1xuICAgIGNvbnN0IGtpbmQgPSB0aGlzLmRlZkJvZHlGaXJlS2luZChib2R5KTtcbiAgICB0aGlzLmRlZlByb2JlU3RhY2suZGVsZXRlKG5hbWUpO1xuICAgIGlmIChraW5kID09PSBudWxsKSByZXR1cm47XG4gICAgaWYgKGtpbmQgPT09ICduZXZlci1yZXR1cm4nKSB7XG4gICAgICB0aGlzLmRlYWQgPSAnbmV2ZXItcmV0dXJuJztcbiAgICB9IGVsc2UgaWYgKCFpblBpcGVsaW5lKSB7XG4gICAgICB0aGlzLmRlYWQgPSBraW5kO1xuICAgIH1cbiAgfVxuXG4gIC8qKiBXaGV0aGVyIGEgZGVmaW5pdGlvbiBib2R5LCB3YWxrZWQgYXMgaXRzIG93biBmdW5jdGlvbiwgZW5kcyBkZWFkLiAqL1xuICBwcml2YXRlIGRlZkJvZHlGaXJlS2luZChib2R5OiBzdHJpbmcpOiBEZWFkS2luZCB8IG51bGwge1xuICAgIGNvbnN0IHJlcyA9IHNwbGl0VG9wTGV2ZWwoYm9keSk7XG4gICAgaWYgKHJlcy5tYWxmb3JtZWQgIT09IHVuZGVmaW5lZCkgcmV0dXJuICdtYWxmb3JtZWQnO1xuICAgIGNvbnN0IHNhdmVkRGVhZCA9IHRoaXMuZGVhZDtcbiAgICBjb25zdCBzYXZlZFJldHVybmVkID0gdGhpcy5yZXR1cm5lZDtcbiAgICBjb25zdCBzYXZlZEZuRGVwdGggPSB0aGlzLmZuRGVwdGg7XG4gICAgY29uc3Qgc2F2ZWRMb29wU3RhY2sgPSB0aGlzLmxvb3BTdGFjaztcbiAgICB0aGlzLmRlYWQgPSBudWxsO1xuICAgIHRoaXMucmV0dXJuZWQgPSBmYWxzZTtcbiAgICB0aGlzLmZuRGVwdGggPSB0aGlzLmZuRGVwdGggKyAxO1xuICAgIHRoaXMubG9vcFN0YWNrID0gW107XG4gICAgdGhpcy53YWxrTGlzdChyZXMuc3RhZ2VzLCB7IGxpdmVuZXNzOiB0cnVlLCBkaXNjYXJkOiB0cnVlLCBzaWRlRWZmZWN0czogdHJ1ZSwgaW5wdXRGYWNpbmc6IGZhbHNlIH0pO1xuICAgIGNvbnN0IGtpbmQgPSB0aGlzLmRlYWQ7XG4gICAgdGhpcy5kZWFkID0gc2F2ZWREZWFkO1xuICAgIHRoaXMucmV0dXJuZWQgPSBzYXZlZFJldHVybmVkO1xuICAgIHRoaXMuZm5EZXB0aCA9IHNhdmVkRm5EZXB0aDtcbiAgICB0aGlzLmxvb3BTdGFjayA9IHNhdmVkTG9vcFN0YWNrO1xuICAgIHJldHVybiBraW5kO1xuICB9XG5cbiAgcHJpdmF0ZSBrbm93blN0YXR1cyhhcmd2OiBzdHJpbmdbXSB8IG51bGwpOiBDaGFpblN0YXR1cyB7XG4gICAgaWYgKGFyZ3YgPT09IG51bGwgfHwgYXJndi5sZW5ndGggPT09IDApIHJldHVybiAnc3VjY2Vzcyc7XG4gICAgLy8gUmVkaXJlY3RzIGFuZCB0cmFuc3BhcmVudCB3cmFwcGVycyBhcmUgc3RyaXBwZWQgYmVmb3JlIHN0YXR1cyBldmFsdWF0aW9uXG4gICAgLy8gKHBsYW4gXHUwMEE3NC9cdTAwQTc1KTogYGVudiBGT089MSB0cnVlYCBhbmQgYHRpbWVvdXQgNSB0cnVlYCBhcmUga25vd24gc3VjY2Vzc2VzLFxuICAgIC8vIGB0cnVlID4gb3V0YCBrZWVwcyBpdHMgc3VjY2VzcywgYW5kIGEgZmFpbC1jbG9zZWQgd3JhcHBlciAoYGVudiAtaSBcdTIwMjZgKVxuICAgIC8vIHN0YXlzIHVua25vd24uXG4gICAgY29uc3QgYSA9IHdhbGtTdHJpcChzdHJpcFdyYXBwZXJzKHN0cmlwUmVkaXJlY3RzKGFyZ3YpKSk7XG4gICAgaWYgKGEubGVuZ3RoID09PSAwKSByZXR1cm4gJ3N1Y2Nlc3MnO1xuICAgIGlmIChhWzBdID09PSAndHJ1ZScgfHwgYVswXSA9PT0gJzonKSByZXR1cm4gJ3N1Y2Nlc3MnO1xuICAgIGlmIChhWzBdID09PSAnZmFsc2UnKSByZXR1cm4gJ2ZhaWx1cmUnO1xuICAgIGlmIChhLmV2ZXJ5KCh3KSA9PiBBU1NJR05NRU5UX1JFLnRlc3QodykpKSByZXR1cm4gJ3N1Y2Nlc3MnO1xuICAgIGlmIChhWzBdID09PSAnZXhwb3J0JyAmJiBhLmxlbmd0aCA+IDEgJiYgYS5zbGljZSgxKS5ldmVyeSgodykgPT4gQVNTSUdOTUVOVF9SRS50ZXN0KHcpKSkgcmV0dXJuICdzdWNjZXNzJztcbiAgICBpZiAoYVswXSA9PT0gJ3NldCcpIHJldHVybiBzZXRGbGFnc0tub3duKGEuc2xpY2UoMSkpID8gJ3N1Y2Nlc3MnIDogJ3Vua25vd24nO1xuICAgIHJldHVybiAndW5rbm93bic7XG4gIH1cblxuICBwcml2YXRlIGFwcGx5U2lkZUVmZmVjdHMobWVtYmVyOiBTaW1wbGVDb21tYW5kLCBhcmd2OiBzdHJpbmdbXSB8IG51bGwsIHN0cmlwcGVkOiBzdHJpbmdbXSB8IG51bGwpOiB2b2lkIHtcbiAgICBpZiAoYXJndiA9PT0gbnVsbCB8fCBhcmd2Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICAgIC8vIEFzc2lnbm1lbnQgcmVjb3JkaW5nIChsYXN0IGRlZmluaXRpb24gd2lucywgZmVlZGluZyBjYXNlIHN1YmplY3RzKS5cbiAgICBjb25zdCB3b3JkcyA9IHNwbGl0V29yZHMobWVtYmVyLnRleHQpO1xuICAgIGlmICh3b3JkcyAhPT0gbnVsbCAmJiB3b3Jkcy5sZW5ndGggPiAwKSB7XG4gICAgICBsZXQgayA9IDA7XG4gICAgICB3aGlsZSAoayA8IHdvcmRzLmxlbmd0aCAmJiBBU1NJR05NRU5UX1JFLnRlc3Qod29yZHNba10pKSBrKys7XG4gICAgICBpZiAoayA9PT0gd29yZHMubGVuZ3RoKSB7XG4gICAgICAgIGZvciAoY29uc3QgdyBvZiB3b3Jkcykge1xuICAgICAgICAgIGNvbnN0IGVxID0gdy5pbmRleE9mKCc9Jyk7XG4gICAgICAgICAgdGhpcy5hc3NpZ25tZW50cy5zZXQody5zbGljZSgwLCBlcSksIHcuc2xpY2UoZXEgKyAxKSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAod29yZHNbMF0gPT09ICdleHBvcnQnKSB7XG4gICAgICAgIGZvciAoY29uc3QgdyBvZiB3b3Jkcy5zbGljZSgxKSkge1xuICAgICAgICAgIGlmIChBU1NJR05NRU5UX1JFLnRlc3QodykpIHtcbiAgICAgICAgICAgIGNvbnN0IGVxID0gdy5pbmRleE9mKCc9Jyk7XG4gICAgICAgICAgICB0aGlzLmFzc2lnbm1lbnRzLnNldCh3LnNsaWNlKDAsIGVxKSwgdy5zbGljZShlcSArIDEpKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHN0cmlwcGVkICE9PSBudWxsICYmIHN0cmlwcGVkWzBdID09PSAnc2V0JykgdGhpcy5hcHBseVNldEZsYWdzKHN0cmlwcGVkLnNsaWNlKDEpKTtcbiAgICAvLyBUYWJsZSBsaWZlY3ljbGUgKHBsYW4gXHUwMEE3Nyk6IGFuIGV4ZWN1dGVkIG5vbi1waXBlIGB1bnNldCBOQU1FYCBkZWxldGVzIHRoZVxuICAgIC8vIGVudHJ5LCBzbyBgWD0vYTsgdW5zZXQgWDsgY2F0ICRYL2ZgIHN0YXlzIHVucmVzb2x2ZWQgaW5zdGVhZCBvZlxuICAgIC8vIHJlc3VycmVjdGluZyB0aGUgc3RhbGUgdmFsdWUuIGBleHBvcnQgTkFNRWAgd2l0aG91dCBhIHZhbHVlIGlzIGEgbm8tb3BcbiAgICAvLyBmb3IgdGhlIHRhYmxlIChiYXNoIGtlZXBzIHRoZSB2YWx1ZSwganVzdCBtYXJrcyBpdCBleHBvcnRlZCkuXG4gICAgaWYgKHN0cmlwcGVkICE9PSBudWxsICYmIHN0cmlwcGVkWzBdID09PSAndW5zZXQnKSB7XG4gICAgICBmb3IgKGNvbnN0IHcgb2Ygc3RyaXBwZWQuc2xpY2UoMSkpIHtcbiAgICAgICAgaWYgKCF3LnN0YXJ0c1dpdGgoJy0nKSkgdGhpcy5hc3NpZ25tZW50cy5kZWxldGUodyk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhcHBseVNldEZsYWdzKGFyZ3M6IHN0cmluZ1tdKTogdm9pZCB7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBhcmdzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBjb25zdCBhID0gYXJnc1tpXTtcbiAgICAgIGlmIChhID09PSAnLS0nKSBjb250aW51ZTtcbiAgICAgIGlmICghKGEuc3RhcnRzV2l0aCgnLScpIHx8IGEuc3RhcnRzV2l0aCgnKycpKSkgY29udGludWU7XG4gICAgICBjb25zdCBvbiA9IGEuc3RhcnRzV2l0aCgnLScpO1xuICAgICAgY29uc3QgY2hhcnMgPSBhLnNsaWNlKDEpO1xuICAgICAgZm9yIChsZXQgayA9IDA7IGsgPCBjaGFycy5sZW5ndGg7IGsrKykge1xuICAgICAgICBjb25zdCBjID0gY2hhcnNba107XG4gICAgICAgIGlmIChjID09PSAnbycpIHtcbiAgICAgICAgICBjb25zdCBuYW1lID0gYXJnc1tpICsgMV07XG4gICAgICAgICAgaWYgKG5hbWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuO1xuICAgICAgICAgIGlmIChuYW1lID09PSAnZXJyZXhpdCcpIHRoaXMuZXJyZXhpdCA9IG9uO1xuICAgICAgICAgIGVsc2UgaWYgKG5hbWUgPT09ICdub2VycmV4aXQnKSB0aGlzLmVycmV4aXQgPSAhb247XG4gICAgICAgICAgZWxzZSBpZiAobmFtZSA9PT0gJ3BpcGVmYWlsJykgdGhpcy5waXBlZmFpbCA9IG9uO1xuICAgICAgICAgIGVsc2UgaWYgKG5hbWUgPT09ICdub3BpcGVmYWlsJykgdGhpcy5waXBlZmFpbCA9ICFvbjtcbiAgICAgICAgICBpKys7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGMgPT09ICdlJykgdGhpcy5lcnJleGl0ID0gb247XG4gICAgICAgIC8vIEV2ZXJ5IG90aGVyIHJlY29nbml6ZWQgbGV0dGVyIGlzIGEgbm8tb3AgZm9yIHRoZSB3YWxrLlxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgcHJvY2Vzc0NvbnN0cnVjdChcbiAgICBtZW1iZXI6IFNpbXBsZUNvbW1hbmQsXG4gICAga2luZDogQ29uc3RydWN0S2luZCxcbiAgICBjdHg6IHtcbiAgICAgIGV4ZWM6IEV4ZWNTdGF0dXM7XG4gICAgICBpblBpcGVsaW5lOiBib29sZWFuO1xuICAgICAgYmFja2dyb3VuZGVkOiBib29sZWFuO1xuICAgICAgbWVtYmVyQXJndjogc3RyaW5nW10gfCBudWxsO1xuICAgICAgb3B0czogV2Fsa09wdGlvbnM7XG4gICAgfVxuICApOiBDaGFpblN0YXR1cyB7XG4gICAgY29uc3QgeyBleGVjLCBiYWNrZ3JvdW5kZWQsIG9wdHMgfSA9IGN0eDtcbiAgICBjb25zdCBkaXNjYXJkID0gb3B0cy5kaXNjYXJkIHx8IGV4ZWMgIT09ICd5ZXMnO1xuICAgIGNvbnN0IHNpZGVFZmZlY3RzID0gb3B0cy5zaWRlRWZmZWN0cyAmJiBleGVjID09PSAneWVzJztcblxuICAgIHN3aXRjaCAoa2luZCkge1xuICAgICAgY2FzZSAnaWYnOiB7XG4gICAgICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlSWYobWVtYmVyLnRleHQpO1xuICAgICAgICBpZiAocGFyc2VkID09PSBudWxsKSByZXR1cm4gJ3Vua25vd24nO1xuICAgICAgICBjb25zdCByZWdpb25zID0gW1xuICAgICAgICAgIHBhcnNlZC5jb25kaXRpb24sXG4gICAgICAgICAgcGFyc2VkLnRoZW5Cb2R5LFxuICAgICAgICAgIC4uLnBhcnNlZC5lbGlmcy5mbGF0TWFwKChlKSA9PiBbZS5jb25kaXRpb24sIGUuYm9keV0pLFxuICAgICAgICAgIC4uLihwYXJzZWQuZWxzZUJvZHkgIT09IG51bGwgPyBbcGFyc2VkLmVsc2VCb2R5XSA6IFtdKVxuICAgICAgICBdO1xuICAgICAgICBjb25zdCBjb25kU3RhdHVzID0gdGhpcy53YWxrTGlzdChzcGxpdFRvcExldmVsKHBhcnNlZC5jb25kaXRpb24pLnN0YWdlcywge1xuICAgICAgICAgIGxpdmVuZXNzOiBmYWxzZSxcbiAgICAgICAgICBkaXNjYXJkOiB0cnVlLFxuICAgICAgICAgIHNpZGVFZmZlY3RzOiB0cnVlLFxuICAgICAgICAgIGlucHV0RmFjaW5nOiBmYWxzZVxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKGNvbmRTdGF0dXMgPT09ICd1bmtub3duJykgcmV0dXJuIHRoaXMub3BhcXVlUGF0aChyZWdpb25zLCBjdHgpO1xuICAgICAgICBpZiAoY29uZFN0YXR1cyA9PT0gJ3N1Y2Nlc3MnKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMud2Fsa0JyYW5jaChwYXJzZWQudGhlbkJvZHksIGRpc2NhcmQsIHNpZGVFZmZlY3RzKTtcbiAgICAgICAgfVxuICAgICAgICBmb3IgKGNvbnN0IGVsaWYgb2YgcGFyc2VkLmVsaWZzKSB7XG4gICAgICAgICAgY29uc3QgZVN0YXR1cyA9IHRoaXMud2Fsa0xpc3Qoc3BsaXRUb3BMZXZlbChlbGlmLmNvbmRpdGlvbikuc3RhZ2VzLCB7XG4gICAgICAgICAgICBsaXZlbmVzczogZmFsc2UsXG4gICAgICAgICAgICBkaXNjYXJkOiB0cnVlLFxuICAgICAgICAgICAgc2lkZUVmZmVjdHM6IHRydWUsXG4gICAgICAgICAgICBpbnB1dEZhY2luZzogZmFsc2VcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBpZiAoZVN0YXR1cyA9PT0gJ3Vua25vd24nKSByZXR1cm4gdGhpcy5vcGFxdWVQYXRoKHJlZ2lvbnMsIGN0eCk7XG4gICAgICAgICAgaWYgKGVTdGF0dXMgPT09ICdzdWNjZXNzJykgcmV0dXJuIHRoaXMud2Fsa0JyYW5jaChlbGlmLmJvZHksIGRpc2NhcmQsIHNpZGVFZmZlY3RzKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocGFyc2VkLmVsc2VCb2R5ICE9PSBudWxsKSByZXR1cm4gdGhpcy53YWxrQnJhbmNoKHBhcnNlZC5lbHNlQm9keSwgZGlzY2FyZCwgc2lkZUVmZmVjdHMpO1xuICAgICAgICByZXR1cm4gJ3N1Y2Nlc3MnO1xuICAgICAgfVxuICAgICAgY2FzZSAnd2hpbGUnOlxuICAgICAgY2FzZSAndW50aWwnOiB7XG4gICAgICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlTG9vcChtZW1iZXIudGV4dCwga2luZCk7XG4gICAgICAgIGlmIChwYXJzZWQgPT09IG51bGwpIHJldHVybiAndW5rbm93bic7XG4gICAgICAgIGNvbnN0IGNvbmRTdGF0dXMgPSB0aGlzLndhbGtMaXN0KHNwbGl0VG9wTGV2ZWwocGFyc2VkLmNvbmRpdGlvbikuc3RhZ2VzLCB7XG4gICAgICAgICAgbGl2ZW5lc3M6IGZhbHNlLFxuICAgICAgICAgIGRpc2NhcmQ6IHRydWUsXG4gICAgICAgICAgc2lkZUVmZmVjdHM6IHRydWUsXG4gICAgICAgICAgaW5wdXRGYWNpbmc6IGZhbHNlXG4gICAgICAgIH0pO1xuICAgICAgICBpZiAoY29uZFN0YXR1cyA9PT0gJ3Vua25vd24nKSByZXR1cm4gdGhpcy5vcGFxdWVQYXRoKFtwYXJzZWQuY29uZGl0aW9uLCBwYXJzZWQuYm9keV0sIGN0eCk7XG4gICAgICAgIGNvbnN0IGJvZHlSdW5zID0ga2luZCA9PT0gJ3doaWxlJyA/IGNvbmRTdGF0dXMgPT09ICdzdWNjZXNzJyA6IGNvbmRTdGF0dXMgPT09ICdmYWlsdXJlJztcbiAgICAgICAgaWYgKCFib2R5UnVucykgcmV0dXJuICdzdWNjZXNzJztcbiAgICAgICAgY29uc3QgcmVzID0gc3BsaXRUb3BMZXZlbChwYXJzZWQuYm9keSk7XG4gICAgICAgIGlmIChyZXMubWFsZm9ybWVkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB0aGlzLmRlYWQgPSAnbWFsZm9ybWVkJztcbiAgICAgICAgICByZXR1cm4gJ3Vua25vd24nO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGZyYW1lOiBMb29wRnJhbWUgPSB7IG91dGNvbWU6ICdub25lJywgYm9keVRlcm1pbmF0ZWQ6IGZhbHNlLCBhbWJpZ3VvdXNTdG9wOiBmYWxzZSB9O1xuICAgICAgICB0aGlzLmxvb3BTdGFjay5wdXNoKGZyYW1lKTtcbiAgICAgICAgdGhpcy53YWxrTGlzdChyZXMuc3RhZ2VzLCB7IGxpdmVuZXNzOiB0cnVlLCBkaXNjYXJkLCBzaWRlRWZmZWN0cywgaW5wdXRGYWNpbmc6IGZhbHNlIH0pO1xuICAgICAgICB0aGlzLmxvb3BTdGFjay5wb3AoKTtcbiAgICAgICAgc3dpdGNoIChmcmFtZS5vdXRjb21lKSB7XG4gICAgICAgICAgY2FzZSAnYnJlYWsnOlxuICAgICAgICAgICAgcmV0dXJuICdzdWNjZXNzJztcbiAgICAgICAgICBjYXNlICdjb250aW51ZSc6XG4gICAgICAgICAgY2FzZSAnbm9uZSc6XG4gICAgICAgICAgICBpZiAodGhpcy5kZWFkID09PSBudWxsICYmICFiYWNrZ3JvdW5kZWQpIHRoaXMuZGVhZCA9ICduZXZlci1yZXR1cm4nO1xuICAgICAgICAgICAgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgICBjYXNlICdhbWJpZ3VvdXMnOlxuICAgICAgICAgIGNhc2UgJ3JldHVybic6XG4gICAgICAgICAgICByZXR1cm4gJ3Vua25vd24nO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAndW5rbm93bic7XG4gICAgICB9XG4gICAgICBjYXNlICdmb3InOiB7XG4gICAgICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlRm9yKG1lbWJlci50ZXh0KTtcbiAgICAgICAgaWYgKHBhcnNlZCA9PT0gbnVsbCkgcmV0dXJuICd1bmtub3duJztcbiAgICAgICAgaWYgKHBhcnNlZC5saXN0ID09PSBudWxsIHx8IHBhcnNlZC5saXN0LnNvbWUoKHcpID0+IC9bJGBdLy50ZXN0KHcpKSkge1xuICAgICAgICAgIHJldHVybiB0aGlzLm9wYXF1ZVBhdGgoW3BhcnNlZC53aG9sZUludGVyaW9yXSwgY3R4KTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocGFyc2VkLmxpc3QubGVuZ3RoID09PSAwKSByZXR1cm4gJ3N1Y2Nlc3MnO1xuICAgICAgICBjb25zdCByZXMgPSBzcGxpdFRvcExldmVsKHBhcnNlZC5ib2R5KTtcbiAgICAgICAgaWYgKHJlcy5tYWxmb3JtZWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRoaXMuZGVhZCA9ICdtYWxmb3JtZWQnO1xuICAgICAgICAgIHJldHVybiAndW5rbm93bic7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMud2Fsa0xpc3QocmVzLnN0YWdlcywgeyBsaXZlbmVzczogdHJ1ZSwgZGlzY2FyZCwgc2lkZUVmZmVjdHMsIGlucHV0RmFjaW5nOiBmYWxzZSB9KTtcbiAgICAgIH1cbiAgICAgIGNhc2UgJ2Nhc2UnOiB7XG4gICAgICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlQ2FzZShtZW1iZXIudGV4dCk7XG4gICAgICAgIGlmIChwYXJzZWQgPT09IG51bGwpIHJldHVybiAndW5rbm93bic7XG4gICAgICAgIGNvbnN0IHJlZ2lvbnMgPSBwYXJzZWQuYnJhbmNoZXMubWFwKChiKSA9PiBiLmJvZHkpO1xuICAgICAgICBpZiAocGFyc2VkLmZhbGx0aHJvdWdoIHx8IHJlc29sdmVTdWJqZWN0KHBhcnNlZC5zdWJqZWN0LCB0aGlzLmFzc2lnbm1lbnRzKSA9PT0gbnVsbCkge1xuICAgICAgICAgIHJldHVybiB0aGlzLm9wYXF1ZVBhdGgocmVnaW9ucywgY3R4KTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBzdWJqZWN0ID0gcmVzb2x2ZVN1YmplY3QocGFyc2VkLnN1YmplY3QsIHRoaXMuYXNzaWdubWVudHMpITtcbiAgICAgICAgbGV0IG1hdGNoZWRCcmFuY2ggPSAtMTtcbiAgICAgICAgbGV0IHVuZGVjaWRhYmxlID0gZmFsc2U7XG4gICAgICAgIGZvciAobGV0IGIgPSAwOyBiIDwgcGFyc2VkLmJyYW5jaGVzLmxlbmd0aDsgYisrKSB7XG4gICAgICAgICAgY29uc3QgciA9IGV2YWxQYXR0ZXJuKHBhcnNlZC5icmFuY2hlc1tiXS5wYXR0ZXJuLCBzdWJqZWN0KTtcbiAgICAgICAgICBpZiAociA9PT0gJ21hdGNoJykge1xuICAgICAgICAgICAgbWF0Y2hlZEJyYW5jaCA9IGI7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHIgPT09ICdnbG9iJyB8fCByID09PSAndW5kZWNpZGFibGUnKSB7XG4gICAgICAgICAgICB1bmRlY2lkYWJsZSA9IHRydWU7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHVuZGVjaWRhYmxlKSByZXR1cm4gdGhpcy5vcGFxdWVQYXRoKHJlZ2lvbnMsIGN0eCk7XG4gICAgICAgIGlmIChtYXRjaGVkQnJhbmNoICE9PSAtMSkge1xuICAgICAgICAgIHJldHVybiB0aGlzLndhbGtCcmFuY2gocGFyc2VkLmJyYW5jaGVzW21hdGNoZWRCcmFuY2hdLmJvZHksIGRpc2NhcmQsIHNpZGVFZmZlY3RzKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gJ3N1Y2Nlc3MnO1xuICAgICAgfVxuICAgICAgY2FzZSAnc2VsZWN0Jzoge1xuICAgICAgICBjb25zdCBwYXJzZWQgPSBwYXJzZUxvb3AobWVtYmVyLnRleHQsICd3aGlsZScpO1xuICAgICAgICByZXR1cm4gdGhpcy5vcGFxdWVQYXRoKHBhcnNlZCAhPT0gbnVsbCA/IFtwYXJzZWQuYm9keV0gOiBbXSwgY3R4KTtcbiAgICAgIH1cbiAgICAgIGNhc2UgJ2JyYWNlJzoge1xuICAgICAgICBjb25zdCBpbnRlcmlvciA9IGV4dHJhY3RHcm91cEJvZHkobWVtYmVyLnRleHQsICd7JywgJ30nKTtcbiAgICAgICAgaWYgKGludGVyaW9yID09PSBudWxsKSByZXR1cm4gJ3Vua25vd24nO1xuICAgICAgICBjb25zdCByZXMgPSBzcGxpdFRvcExldmVsKGludGVyaW9yKTtcbiAgICAgICAgaWYgKHJlcy5tYWxmb3JtZWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRoaXMuZGVhZCA9ICdtYWxmb3JtZWQnO1xuICAgICAgICAgIHJldHVybiAndW5rbm93bic7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMud2Fsa0xpc3QocmVzLnN0YWdlcywgeyBsaXZlbmVzczogdHJ1ZSwgZGlzY2FyZCwgc2lkZUVmZmVjdHMsIGlucHV0RmFjaW5nOiBmYWxzZSB9KTtcbiAgICAgIH1cbiAgICAgIGNhc2UgJ3N1YnNoZWxsJzoge1xuICAgICAgICBjb25zdCBpbnRlcmlvciA9IGV4dHJhY3RHcm91cEJvZHkobWVtYmVyLnRleHQsICcoJywgJyknKTtcbiAgICAgICAgaWYgKGludGVyaW9yID09PSBudWxsKSByZXR1cm4gJ3Vua25vd24nO1xuICAgICAgICBjb25zdCByZXMgPSBzcGxpdFRvcExldmVsKGludGVyaW9yKTtcbiAgICAgICAgaWYgKHJlcy5tYWxmb3JtZWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHRoaXMuZGVhZCA9ICdtYWxmb3JtZWQnO1xuICAgICAgICAgIHJldHVybiAndW5rbm93bic7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgc2F2ZWRFcnJleGl0ID0gdGhpcy5lcnJleGl0O1xuICAgICAgICBjb25zdCBzYXZlZFBpcGVmYWlsID0gdGhpcy5waXBlZmFpbDtcbiAgICAgICAgY29uc3Qgc2F2ZWRBc3NpZ25tZW50cyA9IHRoaXMuYXNzaWdubWVudHM7XG4gICAgICAgIGNvbnN0IHNhdmVkRGVmcyA9IHRoaXMuZGVmcztcbiAgICAgICAgY29uc3Qgc2F2ZWRSZXR1cm5lZCA9IHRoaXMucmV0dXJuZWQ7XG4gICAgICAgIGNvbnN0IHNhdmVkRm5EZXB0aCA9IHRoaXMuZm5EZXB0aDtcbiAgICAgICAgY29uc3Qgc2F2ZWRMb29wU3RhY2sgPSB0aGlzLmxvb3BTdGFjaztcbiAgICAgICAgY29uc3Qgc2F2ZWREaXJGcmFtZSA9IHRoaXMuZGlyRnJhbWU7XG4gICAgICAgIGNvbnN0IHNhdmVkRGVhZCA9IHRoaXMuZGVhZDtcbiAgICAgICAgdGhpcy5lcnJleGl0ID0gc2F2ZWRFcnJleGl0O1xuICAgICAgICB0aGlzLnBpcGVmYWlsID0gc2F2ZWRQaXBlZmFpbDtcbiAgICAgICAgdGhpcy5hc3NpZ25tZW50cyA9IG5ldyBNYXAoc2F2ZWRBc3NpZ25tZW50cyk7XG4gICAgICAgIHRoaXMuZGVmcyA9IG5ldyBNYXAoc2F2ZWREZWZzKTtcbiAgICAgICAgdGhpcy5yZXR1cm5lZCA9IGZhbHNlO1xuICAgICAgICB0aGlzLmZuRGVwdGggPSAwO1xuICAgICAgICB0aGlzLmxvb3BTdGFjayA9IFtdO1xuICAgICAgICB0aGlzLmRpckZyYW1lID0gc2F2ZWREaXJGcmFtZSArIDE7XG4gICAgICAgIHRoaXMuZGVhZCA9IG51bGw7XG4gICAgICAgIGNvbnN0IHN0YXR1cyA9IHRoaXMud2Fsa0xpc3QocmVzLnN0YWdlcywgeyBsaXZlbmVzczogdHJ1ZSwgZGlzY2FyZCwgc2lkZUVmZmVjdHMsIGlucHV0RmFjaW5nOiBmYWxzZSB9KTtcbiAgICAgICAgY29uc3QgaW5uZXJEZWFkID0gdGhpcy5kZWFkO1xuICAgICAgICB0aGlzLmVycmV4aXQgPSBzYXZlZEVycmV4aXQ7XG4gICAgICAgIHRoaXMucGlwZWZhaWwgPSBzYXZlZFBpcGVmYWlsO1xuICAgICAgICB0aGlzLmFzc2lnbm1lbnRzID0gc2F2ZWRBc3NpZ25tZW50cztcbiAgICAgICAgdGhpcy5kZWZzID0gc2F2ZWREZWZzO1xuICAgICAgICB0aGlzLnJldHVybmVkID0gc2F2ZWRSZXR1cm5lZDtcbiAgICAgICAgdGhpcy5mbkRlcHRoID0gc2F2ZWRGbkRlcHRoO1xuICAgICAgICB0aGlzLmxvb3BTdGFjayA9IHNhdmVkTG9vcFN0YWNrO1xuICAgICAgICB0aGlzLmRpckZyYW1lID0gc2F2ZWREaXJGcmFtZTtcbiAgICAgICAgdGhpcy5kZWFkID0gc2F2ZWREZWFkO1xuICAgICAgICAvLyBBIHN1YnNoZWxsIGlzIGEgcHJvY2VzcyBib3VuZGFyeSBmb3IgdGhlIGV4aXQgZmlyZSBidXQgbm90IGZvciB0aGVcbiAgICAgICAgLy8gbmV2ZXItcmV0dXJuIGZpcmU6IHRoZSBzaGVsbCBzeW5jaHJvbm91c2x5IHdhaXRzIGZvciB0aGUgc3Vic2hlbGwuXG4gICAgICAgIGlmIChpbm5lckRlYWQgPT09ICduZXZlci1yZXR1cm4nKSB0aGlzLmRlYWQgPSAnbmV2ZXItcmV0dXJuJztcbiAgICAgICAgcmV0dXJuIHN0YXR1cztcbiAgICAgIH1cbiAgICAgIGNhc2UgJ2RlZic6IHtcbiAgICAgICAgLy8gVGhlIGRlZmluaXRpb24gcmVnaXN0ZXJzIHdpdGggdGhlIHdhbGsgc2NvcGUgd2hlbiBleGVjdXRlZC5cbiAgICAgICAgaWYgKHNpZGVFZmZlY3RzKSB7XG4gICAgICAgICAgY29uc3QgZGVmID0gcGFyc2VEZWYobWVtYmVyLnRleHQpO1xuICAgICAgICAgIGlmIChkZWYgIT09IG51bGwpIHRoaXMuZGVmcy5zZXQoZGVmLm5hbWUsIGRlZi5ib2R5KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gJ3N1Y2Nlc3MnO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gJ3Vua25vd24nO1xuICB9XG5cbiAgcHJpdmF0ZSB3YWxrQnJhbmNoKGJvZHk6IHN0cmluZywgZGlzY2FyZDogYm9vbGVhbiwgc2lkZUVmZmVjdHM6IGJvb2xlYW4pOiBDaGFpblN0YXR1cyB7XG4gICAgY29uc3QgcmVzID0gc3BsaXRUb3BMZXZlbChib2R5KTtcbiAgICBpZiAocmVzLm1hbGZvcm1lZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLmRlYWQgPSAnbWFsZm9ybWVkJztcbiAgICAgIHJldHVybiAndW5rbm93bic7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLndhbGtMaXN0KHJlcy5zdGFnZXMsIHsgbGl2ZW5lc3M6IHRydWUsIGRpc2NhcmQsIHNpZGVFZmZlY3RzLCBpbnB1dEZhY2luZzogZmFsc2UgfSk7XG4gIH1cblxuICAvKipcbiAgICogVGhlIG9wYXF1ZS1jb25zdHJ1Y3QgdHJlYXRtZW50IChwbGFuIFx1MDBBNzIpOiByZS1zcGxpdCBlYWNoIHJlZ2lvbiBhbmQgd2FsayBpdFxuICAgKiB3aXRoIHRoZSBzYW1lIG1hY2hpbmVyeSBzbyBhbiBgZXhpdGAvYGV4ZWNgIHRoYXQgbWF5IGhhdmUgcnVuLCBvciBhXG4gICAqIG5ldmVyLWV4aXQgbG9vcCwgZmlyZXMgZmFpbC1jbG9zZWQ7IGhpZGRlbiBicmVhay9jb250aW51ZSB3b3JkcyByZWFjaCB0aGVcbiAgICogc2Nhbm5lZCBsb29wIGFzIGFuIGFtYmlndW91cyB0ZXJtaW5hdGlvbi4gU3RhdGUgaXMgc25hcHNob3QtcmVzdG9yZWQuXG4gICAqL1xuICBwcml2YXRlIG9wYXF1ZVBhdGgoXG4gICAgcmVnaW9uczogc3RyaW5nW10sXG4gICAgY3R4OiB7IGV4ZWM6IEV4ZWNTdGF0dXM7IGluUGlwZWxpbmU6IGJvb2xlYW47IGJhY2tncm91bmRlZDogYm9vbGVhbjsgb3B0czogV2Fsa09wdGlvbnMgfVxuICApOiBDaGFpblN0YXR1cyB7XG4gICAgY29uc3QgZmluZGluZ3MgPSB0aGlzLnNjYW5PcGFxdWUocmVnaW9ucyk7XG4gICAgaWYgKGZpbmRpbmdzLmZpcmUgIT09IG51bGwpIHtcbiAgICAgIGlmIChmaW5kaW5ncy5maXJlID09PSAnbmV2ZXItcmV0dXJuJykge1xuICAgICAgICBpZiAoIWN0eC5iYWNrZ3JvdW5kZWQpIHRoaXMuZGVhZCA9ICduZXZlci1yZXR1cm4nO1xuICAgICAgfSBlbHNlIGlmICghY3R4LmluUGlwZWxpbmUgJiYgIWN0eC5iYWNrZ3JvdW5kZWQpIHtcbiAgICAgICAgdGhpcy5kZWFkID0gZmluZGluZ3MuZmlyZTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKGZpbmRpbmdzLmJyZWFrVGFyZ2V0ICE9PSAnbm9uZScpIHtcbiAgICAgIGNvbnN0IHRvcCA9IHRoaXMubG9vcFN0YWNrW3RoaXMubG9vcFN0YWNrLmxlbmd0aCAtIDFdO1xuICAgICAgaWYgKHRvcCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRvcC5vdXRjb21lID0gJ2FtYmlndW91cyc7XG4gICAgICAgIHRvcC5hbWJpZ3VvdXNTdG9wID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuICd1bmtub3duJztcbiAgfVxuXG4gIHByaXZhdGUgc2Nhbk9wYXF1ZShyZWdpb25zOiBzdHJpbmdbXSk6IHsgZmlyZTogRGVhZEtpbmQgfCBudWxsOyBicmVha1RhcmdldDogJ2JyZWFrJyB8ICdjb250aW51ZScgfCAnbm9uZScgfSB7XG4gICAgY29uc3QgcmVwb3J0OiB7IGZpcmU6IERlYWRLaW5kIHwgbnVsbDsgYnJlYWtUYXJnZXQ6ICdicmVhaycgfCAnY29udGludWUnIHwgJ25vbmUnIH0gPSB7XG4gICAgICBmaXJlOiBudWxsLFxuICAgICAgYnJlYWtUYXJnZXQ6ICdub25lJ1xuICAgIH07XG4gICAgY29uc3Qgc2F2ZWRDaGFpbiA9IHRoaXMuY2hhaW47XG4gICAgY29uc3Qgc2F2ZWRFcnJleGl0ID0gdGhpcy5lcnJleGl0O1xuICAgIGNvbnN0IHNhdmVkUGlwZWZhaWwgPSB0aGlzLnBpcGVmYWlsO1xuICAgIGNvbnN0IHNhdmVkQXNzaWdubWVudHMgPSB0aGlzLmFzc2lnbm1lbnRzO1xuICAgIGNvbnN0IHNhdmVkRGVmcyA9IHRoaXMuZGVmcztcbiAgICBjb25zdCBzYXZlZERlYWQgPSB0aGlzLmRlYWQ7XG4gICAgY29uc3Qgc2F2ZWRSZXR1cm5lZCA9IHRoaXMucmV0dXJuZWQ7XG4gICAgY29uc3Qgc2F2ZWRGbkRlcHRoID0gdGhpcy5mbkRlcHRoO1xuICAgIGNvbnN0IHNhdmVkTG9vcFN0YWNrID0gdGhpcy5sb29wU3RhY2s7XG4gICAgY29uc3Qgc2F2ZWREaXJGcmFtZSA9IHRoaXMuZGlyRnJhbWU7XG4gICAgY29uc3Qgc2F2ZWRWZXJkaWN0cyA9IHRoaXMudmVyZGljdHMubGVuZ3RoO1xuICAgIGNvbnN0IHNhdmVkRXhwYW5kZWQgPSB0aGlzLmV4cGFuZGVkLmxlbmd0aDtcbiAgICBjb25zdCBzYXZlZERlZlByb2JlID0gbmV3IFNldCh0aGlzLmRlZlByb2JlU3RhY2spO1xuXG4gICAgZm9yIChjb25zdCByZWdpb24gb2YgcmVnaW9ucykge1xuICAgICAgY29uc3QgcmVzID0gc3BsaXRUb3BMZXZlbChyZWdpb24pO1xuICAgICAgaWYgKHJlcy5tYWxmb3JtZWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXBvcnQuZmlyZSA9ICdtYWxmb3JtZWQnO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIHRoaXMuZGVhZCA9IG51bGw7XG4gICAgICB0aGlzLnJldHVybmVkID0gZmFsc2U7XG4gICAgICAvLyBFYWNoIHJlZ2lvbiB3YWxrcyBhZ2FpbnN0IGEgZnJlc2ggY29weSBvZiB0aGUgZW5jbG9zaW5nIGxvb3AgZnJhbWVzIHNvXG4gICAgICAvLyBpdHMgaGlkZGVuIGJyZWFrL2NvbnRpbnVlIGV2ZW50cyBhcmUgcmVwb3J0ZWQsIG5ldmVyIGFwcGxpZWQuXG4gICAgICB0aGlzLmxvb3BTdGFjayA9IHNhdmVkTG9vcFN0YWNrLm1hcCgoZikgPT4gKHsgLi4uZiB9KSk7XG4gICAgICB0aGlzLndhbGtMaXN0KHJlcy5zdGFnZXMsIHsgbGl2ZW5lc3M6IHRydWUsIGRpc2NhcmQ6IHRydWUsIHNpZGVFZmZlY3RzOiBmYWxzZSwgaW5wdXRGYWNpbmc6IGZhbHNlIH0pO1xuICAgICAgaWYgKHRoaXMuZGVhZCAhPT0gbnVsbCkge1xuICAgICAgICBpZiAocmVwb3J0LmZpcmUgPT09IG51bGwgfHwgdGhpcy5kZWFkID09PSAnbmV2ZXItcmV0dXJuJyB8fCB0aGlzLmRlYWQgPT09ICdtYWxmb3JtZWQnKSByZXBvcnQuZmlyZSA9IHRoaXMuZGVhZDtcbiAgICAgIH1cbiAgICAgIGlmIChyZXBvcnQuYnJlYWtUYXJnZXQgPT09ICdub25lJykge1xuICAgICAgICBjb25zdCBpbm5lcm1vc3QgPSB0aGlzLmxvb3BTdGFja1t0aGlzLmxvb3BTdGFjay5sZW5ndGggLSAxXTtcbiAgICAgICAgaWYgKGlubmVybW9zdCAhPT0gdW5kZWZpbmVkICYmIChpbm5lcm1vc3Qub3V0Y29tZSA9PT0gJ2JyZWFrJyB8fCBpbm5lcm1vc3Qub3V0Y29tZSA9PT0gJ2NvbnRpbnVlJykpIHtcbiAgICAgICAgICByZXBvcnQuYnJlYWtUYXJnZXQgPSBpbm5lcm1vc3Qub3V0Y29tZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuY2hhaW4gPSBzYXZlZENoYWluO1xuICAgIHRoaXMuZXJyZXhpdCA9IHNhdmVkRXJyZXhpdDtcbiAgICB0aGlzLnBpcGVmYWlsID0gc2F2ZWRQaXBlZmFpbDtcbiAgICB0aGlzLmFzc2lnbm1lbnRzID0gc2F2ZWRBc3NpZ25tZW50cztcbiAgICB0aGlzLmRlZnMgPSBzYXZlZERlZnM7XG4gICAgdGhpcy5kZWFkID0gc2F2ZWREZWFkO1xuICAgIHRoaXMucmV0dXJuZWQgPSBzYXZlZFJldHVybmVkO1xuICAgIHRoaXMuZm5EZXB0aCA9IHNhdmVkRm5EZXB0aDtcbiAgICB0aGlzLmxvb3BTdGFjayA9IHNhdmVkTG9vcFN0YWNrO1xuICAgIHRoaXMuZGlyRnJhbWUgPSBzYXZlZERpckZyYW1lO1xuICAgIHRoaXMudmVyZGljdHMubGVuZ3RoID0gc2F2ZWRWZXJkaWN0cztcbiAgICB0aGlzLmV4cGFuZGVkLmxlbmd0aCA9IHNhdmVkRXhwYW5kZWQ7XG4gICAgdGhpcy5kZWZQcm9iZVN0YWNrLmNsZWFyKCk7XG4gICAgZm9yIChjb25zdCBuYW1lIG9mIHNhdmVkRGVmUHJvYmUpIHRoaXMuZGVmUHJvYmVTdGFjay5hZGQobmFtZSk7XG4gICAgcmV0dXJuIHJlcG9ydDtcbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIExpbmUtcmFuZ2Ugc3BlY3M6IHdoYXQgYSBtYXRjaGVkIGlkaW9tIHNheXMgYWJvdXQgdGhlIHJhbmdlLCBiZWZvcmUgd2Uga25vd1xuLy8gd2hldGhlciByZXNvbHZpbmcgaXQgbmVlZHMgdG8gY29uc3VsdCBhIHJlYWwgZmlsZS9naXQgYmxvYi5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50eXBlIExpbmVSYW5nZVNwZWMgPVxuICB8IHsga2luZDogJ2xpdGVyYWwnOyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9XG4gIHwgeyBraW5kOiAndXBwZXJCb3VuZEZyb21TdGFydCc7IGVuZDogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6ICd0b0VvZic7IHN0YXJ0OiBudW1iZXIgfVxuICB8IHsga2luZDogJ2xhc3ROTGluZXMnOyBjb3VudDogbnVtYmVyIH1cbiAgfCB7IGtpbmQ6ICdhcHBlbmRMaW5lcyc7IGNvdW50OiBudW1iZXIgfTtcblxuZnVuY3Rpb24gcmVzb2x2ZVNwZWMoXG4gIHNwZWM6IExpbmVSYW5nZVNwZWMsXG4gIHRvdGFsTGluZXM6ICgpID0+IG51bWJlciB8IG51bGxcbik6IHsgbGluZVN0YXJ0OiBudW1iZXI7IGxpbmVFbmQ6IG51bWJlciB9IHwgbnVsbCB7XG4gIHN3aXRjaCAoc3BlYy5raW5kKSB7XG4gICAgY2FzZSAnbGl0ZXJhbCc6XG4gICAgICByZXR1cm4geyBsaW5lU3RhcnQ6IHNwZWMuc3RhcnQsIGxpbmVFbmQ6IHNwZWMuZW5kIH07XG4gICAgY2FzZSAndXBwZXJCb3VuZEZyb21TdGFydCc6IHtcbiAgICAgIGNvbnN0IHRvdGFsID0gdG90YWxMaW5lcygpO1xuICAgICAgcmV0dXJuIHsgbGluZVN0YXJ0OiAxLCBsaW5lRW5kOiB0b3RhbCAhPT0gbnVsbCA/IE1hdGgubWluKHNwZWMuZW5kLCB0b3RhbCkgOiBzcGVjLmVuZCB9O1xuICAgIH1cbiAgICBjYXNlICd0b0VvZic6IHtcbiAgICAgIGNvbnN0IHRvdGFsID0gdG90YWxMaW5lcygpO1xuICAgICAgaWYgKHRvdGFsID09PSBudWxsIHx8IHRvdGFsID09PSAwKSByZXR1cm4gbnVsbDtcbiAgICAgIHJldHVybiB7IGxpbmVTdGFydDogc3BlYy5zdGFydCwgbGluZUVuZDogTWF0aC5tYXgoc3BlYy5zdGFydCwgdG90YWwpIH07XG4gICAgfVxuICAgIGNhc2UgJ2xhc3ROTGluZXMnOiB7XG4gICAgICBjb25zdCB0b3RhbCA9IHRvdGFsTGluZXMoKTtcbiAgICAgIGlmICh0b3RhbCA9PT0gbnVsbCB8fCB0b3RhbCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gICAgICByZXR1cm4geyBsaW5lU3RhcnQ6IE1hdGgubWF4KDEsIHRvdGFsIC0gc3BlYy5jb3VudCArIDEpLCBsaW5lRW5kOiB0b3RhbCB9O1xuICAgIH1cbiAgICBjYXNlICdhcHBlbmRMaW5lcyc6IHtcbiAgICAgIGNvbnN0IHRvdGFsID0gdG90YWxMaW5lcygpID8/IDA7XG4gICAgICByZXR1cm4geyBsaW5lU3RhcnQ6IHRvdGFsICsgMSwgbGluZUVuZDogdG90YWwgKyBzcGVjLmNvdW50IH07XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGhhc1NoZWxsRXhwYW5zaW9uKHM6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gL1skYF0vLnRlc3Qocyk7XG59XG5cbmZ1bmN0aW9uIGxvb2tzVW5yZXNvbHZhYmxlKHM6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gaGFzU2hlbGxFeHBhbnNpb24ocykgfHwgL1sqP10vLnRlc3Qocyk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSWRpb20gbWF0Y2hlcnM6IHB1cmUgZnVuY3Rpb25zIG92ZXIgb25lIHNpbXBsZSBjb21tYW5kJ3MgYXJndi5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5pbnRlcmZhY2UgUmF3Q2FuZGlkYXRlIHtcbiAga2luZDogJ2NhbmRpZGF0ZSc7XG4gIGlkaW9tOiBJZGlvbTtcbiAgZmlsZUFyZzogc3RyaW5nO1xuICBzcGVjOiBMaW5lUmFuZ2VTcGVjO1xuICByZXNvbHZlcktpbmQ6ICdmcycgfCB7IGtpbmQ6ICdnaXQnOyByZXY6IHN0cmluZyB9O1xuICBkaXJPdmVycmlkZT86IHN0cmluZztcbn1cbmludGVyZmFjZSBSYXdVbnJlc29sdmVkIHtcbiAga2luZDogJ3VucmVzb2x2ZWQnO1xuICBpZGlvbTogSWRpb207XG4gIGZpbGVBcmc6IHN0cmluZztcbiAgcmVhc29uOiBzdHJpbmc7XG59XG50eXBlIE1hdGNoUmVzdWx0ID0gUmF3Q2FuZGlkYXRlIHwgUmF3VW5yZXNvbHZlZDtcblxuY29uc3QgU0VEX1JBTkdFID0gL14oXFxkKykoPzosKFxcZCt8XFwkKSk/cCQvO1xuXG4vKiogU3BsaXQgYSBgc2VkYCBzY3JpcHQgYXJndW1lbnQgaW50byBpdHMgYDtgLXNlcGFyYXRlZCBzZWdtZW50cy4gKi9cbmZ1bmN0aW9uIHNlZFNjcmlwdFNlZ21lbnRzKHNjcmlwdDogc3RyaW5nKTogc3RyaW5nW10ge1xuICByZXR1cm4gc2NyaXB0LnNwbGl0KCc7Jyk7XG59XG5cbmZ1bmN0aW9uIG1hdGNoU2VkKGFyZ3Y6IHN0cmluZ1tdKTogTWF0Y2hSZXN1bHRbXSB7XG4gIGlmIChhcmd2WzBdICE9PSAnc2VkJykgcmV0dXJuIFtdO1xuICBjb25zdCByZXN0ID0gYXJndi5zbGljZSgxKTtcbiAgaWYgKCFyZXN0LmluY2x1ZGVzKCctbicpKSByZXR1cm4gW107XG4gIGxldCBzY3JpcHRJZHggPSAtMTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCByZXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKHJlc3RbaV0gPT09ICctbicpIGNvbnRpbnVlO1xuICAgIGlmIChzZWRTY3JpcHRTZWdtZW50cyhyZXN0W2ldKS5zb21lKChzZWcpID0+IFNFRF9SQU5HRS50ZXN0KHNlZykpKSB7XG4gICAgICBzY3JpcHRJZHggPSBpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG4gIGlmIChzY3JpcHRJZHggPT09IC0xKSByZXR1cm4gW107XG4gIGNvbnN0IGZpbGVDYW5kaWRhdGVzID0gcmVzdC5maWx0ZXIoKGEsIGkpID0+IGkgIT09IHNjcmlwdElkeCAmJiBhICE9PSAnLW4nICYmICFhLnN0YXJ0c1dpdGgoJy0nKSk7XG4gIGlmIChmaWxlQ2FuZGlkYXRlcy5sZW5ndGggIT09IDEpIHJldHVybiBbXTtcbiAgY29uc3QgZmlsZUFyZyA9IGZpbGVDYW5kaWRhdGVzWzBdO1xuICBjb25zdCByZXN1bHRzOiBNYXRjaFJlc3VsdFtdID0gW107XG4gIGZvciAoY29uc3Qgc2VnbWVudCBvZiBzZWRTY3JpcHRTZWdtZW50cyhyZXN0W3NjcmlwdElkeF0pKSB7XG4gICAgY29uc3QgbWF0Y2ggPSBzZWdtZW50Lm1hdGNoKFNFRF9SQU5HRSk7XG4gICAgaWYgKCFtYXRjaCkgY29udGludWU7XG4gICAgY29uc3Qgc3RhcnQgPSBOdW1iZXIucGFyc2VJbnQobWF0Y2hbMV0sIDEwKTtcbiAgICBjb25zdCBlbmRUb2tlbiA9IG1hdGNoWzJdO1xuICAgIGNvbnN0IHNwZWM6IExpbmVSYW5nZVNwZWMgPVxuICAgICAgZW5kVG9rZW4gPT09IHVuZGVmaW5lZFxuICAgICAgICA/IHsga2luZDogJ2xpdGVyYWwnLCBzdGFydCwgZW5kOiBzdGFydCB9XG4gICAgICAgIDogZW5kVG9rZW4gPT09ICckJ1xuICAgICAgICAgID8geyBraW5kOiAndG9Fb2YnLCBzdGFydCB9XG4gICAgICAgICAgOiB7IGtpbmQ6ICdsaXRlcmFsJywgc3RhcnQsIGVuZDogTnVtYmVyLnBhcnNlSW50KGVuZFRva2VuLCAxMCkgfTtcbiAgICByZXN1bHRzLnB1c2goeyBraW5kOiAnY2FuZGlkYXRlJywgaWRpb206ICdzZWQtbi1yYW5nZScsIGZpbGVBcmcsIHNwZWMsIHJlc29sdmVyS2luZDogJ2ZzJyB9KTtcbiAgfVxuICByZXR1cm4gcmVzdWx0cztcbn1cblxuLyoqXG4gKiBQYXJzZSBgaGVhZGAvYHRhaWxgIGZsYWdzIGFuZCBmaWxlIGFyZ3MuIEEgYmFyZSBgK05gIGlzIGEgZnJvbS1OIGNvdW50IG9ubHlcbiAqIGZvciBgdGFpbGAgKGB0YWlsICs1IGZgIHN0YXJ0cyBhdCBsaW5lIDUpOyBHTlUgYGhlYWRgIHRyZWF0cyBiYXJlIGArTmAgYXMgYVxuICogKmZpbGUqIChjb3JldXRpbHMgOS43IFx1MjAxNCBwcm9iZTogYGhlYWQgKzUgZmAgZXJyb3JzIFwiY2Fubm90IG9wZW4gJys1J1wiIGFuZFxuICogcmVhZHMgZidzIGZpcnN0IDEwIGxpbmVzKSwgc28gYGJhcmVQbHVzSXNDb3VudGAgaXMgZmFsc2UgZm9yIGhlYWQgYW5kIHRoZVxuICogd29yZCBmYWxscyB0aHJvdWdoIHRvIHRoZSBmaWxlIGxpc3QuXG4gKi9cbmZ1bmN0aW9uIHBhcnNlSGVhZFRhaWxGbGFncyhcbiAgcmVzdDogc3RyaW5nW10sXG4gIGJhcmVQbHVzSXNDb3VudDogYm9vbGVhblxuKToge1xuICBjb3VudDogbnVtYmVyIHwgbnVsbDtcbiAgZnJvbVN0YXJ0OiBib29sZWFuO1xuICBkaXNxdWFsaWZpZWQ6IGJvb2xlYW47XG4gIGZpbGVzOiBzdHJpbmdbXTtcbn0ge1xuICBjb25zdCBmaWxlczogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGNvdW50OiBudW1iZXIgfCBudWxsID0gbnVsbDtcbiAgbGV0IGZyb21TdGFydCA9IGZhbHNlO1xuICBsZXQgZGlzcXVhbGlmaWVkID0gZmFsc2U7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgcmVzdC5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGEgPSByZXN0W2ldO1xuICAgIGlmIChhID09PSAnLWYnIHx8IGEgPT09ICctRicgfHwgYSA9PT0gJy0tZm9sbG93JyB8fCBhLnN0YXJ0c1dpdGgoJy0tZm9sbG93PScpKSB7XG4gICAgICBkaXNxdWFsaWZpZWQgPSB0cnVlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChhID09PSAnLXonIHx8IGEgPT09ICctLXplcm8tdGVybWluYXRlZCcpIHtcbiAgICAgIGRpc3F1YWxpZmllZCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctYycgfHwgYSA9PT0gJy0tYnl0ZXMnKSB7XG4gICAgICBkaXNxdWFsaWZpZWQgPSB0cnVlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgvXigtY3wtLWJ5dGVzPSkvLnRlc3QoYSkpIHtcbiAgICAgIGRpc3F1YWxpZmllZCA9IHRydWU7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctcScgfHwgYSA9PT0gJy12JyB8fCBhID09PSAnLS1xdWlldCcgfHwgYSA9PT0gJy0tc2lsZW50JyB8fCBhID09PSAnLS12ZXJib3NlJykgY29udGludWU7XG4gICAgaWYgKGEgPT09ICctbicpIHtcbiAgICAgIGNvbnN0IHYgPSByZXN0W2kgKyAxXTtcbiAgICAgIGlmICh2ICE9PSB1bmRlZmluZWQgJiYgL15cXCs/XFxkKyQvLnRlc3QodikpIHtcbiAgICAgICAgZnJvbVN0YXJ0ID0gdi5zdGFydHNXaXRoKCcrJyk7XG4gICAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KHYucmVwbGFjZSgnKycsICcnKSwgMTApO1xuICAgICAgICBpICs9IDE7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEuc3RhcnRzV2l0aCgnLS1saW5lcz0nKSkge1xuICAgICAgY29uc3QgdiA9IGEuc2xpY2UoJy0tbGluZXM9Jy5sZW5ndGgpO1xuICAgICAgaWYgKC9eXFwrP1xcZCskLy50ZXN0KHYpKSB7XG4gICAgICAgIGZyb21TdGFydCA9IHYuc3RhcnRzV2l0aCgnKycpO1xuICAgICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludCh2LnJlcGxhY2UoJysnLCAnJyksIDEwKTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoL14tblxcKz9cXGQrJC8udGVzdChhKSkge1xuICAgICAgY29uc3QgdiA9IGEuc2xpY2UoMik7XG4gICAgICBmcm9tU3RhcnQgPSB2LnN0YXJ0c1dpdGgoJysnKTtcbiAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KHYucmVwbGFjZSgnKycsICcnKSwgMTApO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICgvXlxcK1xcZCskLy50ZXN0KGEpKSB7XG4gICAgICBpZiAoYmFyZVBsdXNJc0NvdW50KSB7XG4gICAgICAgIGZyb21TdGFydCA9IHRydWU7XG4gICAgICAgIGNvdW50ID0gTnVtYmVyLnBhcnNlSW50KGEuc2xpY2UoMSksIDEwKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZpbGVzLnB1c2goYSk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKC9eLVxcZCskLy50ZXN0KGEpKSB7XG4gICAgICBjb3VudCA9IE51bWJlci5wYXJzZUludChhLnNsaWNlKDEpLCAxMCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctJykge1xuICAgICAgZmlsZXMucHVzaChhKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIGNvbnRpbnVlO1xuICAgIGZpbGVzLnB1c2goYSk7XG4gIH1cbiAgcmV0dXJuIHsgY291bnQsIGZyb21TdGFydCwgZGlzcXVhbGlmaWVkLCBmaWxlcyB9O1xufVxuXG5mdW5jdGlvbiBtYXRjaEhlYWQoYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdoZWFkJykgcmV0dXJuIFtdO1xuICBjb25zdCB7IGNvdW50LCBkaXNxdWFsaWZpZWQsIGZpbGVzIH0gPSBwYXJzZUhlYWRUYWlsRmxhZ3MoYXJndi5zbGljZSgxKSwgZmFsc2UpO1xuICBpZiAoZGlzcXVhbGlmaWVkKSByZXR1cm4gW107XG4gIC8vIEJhcmUgYCtOYCBpcyBhIEdOVS1oZWFkIGZpbGUgYXJ0aWZhY3QsIG5ldmVyIGEgcmVhbCByZWFkIFx1MjAxNCBkcm9wIGl0LlxuICBjb25zdCByZWFsRmlsZXMgPSBmaWxlcy5maWx0ZXIoKGYpID0+IGYgIT09ICctJyAmJiAhL15cXCtcXGQrJC8udGVzdChmKSk7XG4gIGlmIChyZWFsRmlsZXMubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gIGNvbnN0IG4gPSBjb3VudCA/PyAxMDtcbiAgcmV0dXJuIHJlYWxGaWxlcy5tYXAoKGZpbGVBcmcpID0+ICh7XG4gICAga2luZDogJ2NhbmRpZGF0ZScgYXMgY29uc3QsXG4gICAgaWRpb206ICdoZWFkLWZpbGUnIGFzIGNvbnN0LFxuICAgIGZpbGVBcmcsXG4gICAgc3BlYzogeyBraW5kOiAndXBwZXJCb3VuZEZyb21TdGFydCcsIGVuZDogbiB9IGFzIExpbmVSYW5nZVNwZWMsXG4gICAgcmVzb2x2ZXJLaW5kOiAnZnMnIGFzIGNvbnN0XG4gIH0pKTtcbn1cblxuZnVuY3Rpb24gbWF0Y2hUYWlsKGFyZ3Y6IHN0cmluZ1tdKTogTWF0Y2hSZXN1bHRbXSB7XG4gIGlmIChhcmd2WzBdICE9PSAndGFpbCcpIHJldHVybiBbXTtcbiAgY29uc3QgeyBjb3VudCwgZnJvbVN0YXJ0LCBkaXNxdWFsaWZpZWQsIGZpbGVzIH0gPSBwYXJzZUhlYWRUYWlsRmxhZ3MoYXJndi5zbGljZSgxKSwgdHJ1ZSk7XG4gIGlmIChkaXNxdWFsaWZpZWQpIHJldHVybiBbXTtcbiAgY29uc3QgcmVhbEZpbGVzID0gZmlsZXMuZmlsdGVyKChmKSA9PiBmICE9PSAnLScpO1xuICBpZiAocmVhbEZpbGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICBjb25zdCBuID0gY291bnQgPz8gMTA7XG4gIGNvbnN0IHNwZWM6IExpbmVSYW5nZVNwZWMgPSBmcm9tU3RhcnQgPyB7IGtpbmQ6ICd0b0VvZicsIHN0YXJ0OiBuIH0gOiB7IGtpbmQ6ICdsYXN0TkxpbmVzJywgY291bnQ6IG4gfTtcbiAgcmV0dXJuIHJlYWxGaWxlcy5tYXAoKGZpbGVBcmcpID0+ICh7XG4gICAga2luZDogJ2NhbmRpZGF0ZScgYXMgY29uc3QsXG4gICAgaWRpb206ICd0YWlsLWZpbGUnIGFzIGNvbnN0LFxuICAgIGZpbGVBcmcsXG4gICAgc3BlYyxcbiAgICByZXNvbHZlcktpbmQ6ICdmcycgYXMgY29uc3RcbiAgfSkpO1xufVxuXG5mdW5jdGlvbiBmaW5kR2l0U3ViY29tbWFuZChcbiAgcmVzdDogc3RyaW5nW11cbik6IHsgc3ViSWR4OiBudW1iZXI7IHN1YmNvbW1hbmQ6IHN0cmluZzsgY0Rpcjogc3RyaW5nIHwgbnVsbDsgY0RpclVucmVzb2x2YWJsZTogYm9vbGVhbiB9IHwgbnVsbCB7XG4gIGxldCBjRGlyOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgbGV0IGNEaXJVbnJlc29sdmFibGUgPSBmYWxzZTtcbiAgbGV0IGkgPSAwO1xuICB3aGlsZSAoaSA8IHJlc3QubGVuZ3RoKSB7XG4gICAgY29uc3QgYSA9IHJlc3RbaV07XG4gICAgaWYgKGEgPT09ICctQycpIHtcbiAgICAgIGNvbnN0IHYgPSByZXN0W2kgKyAxXTtcbiAgICAgIGlmICh2ID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xuICAgICAgaWYgKGhhc1NoZWxsRXhwYW5zaW9uKHYpKSBjRGlyVW5yZXNvbHZhYmxlID0gdHJ1ZTtcbiAgICAgIGVsc2UgY0RpciA9IHY7XG4gICAgICBpICs9IDI7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGEgPT09ICctYycpIHtcbiAgICAgIGkgKz0gMjtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIHtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICByZXR1cm4geyBzdWJJZHg6IGksIHN1YmNvbW1hbmQ6IGEsIGNEaXIsIGNEaXJVbnJlc29sdmFibGUgfTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuY29uc3QgUkVWX1BBVEggPSAvXihbXlxcczpdKyk6KC4rKSQvO1xuXG5mdW5jdGlvbiBtYXRjaEdpdFNob3coYXJndjogc3RyaW5nW10pOiBNYXRjaFJlc3VsdFtdIHtcbiAgaWYgKGFyZ3ZbMF0gIT09ICdnaXQnKSByZXR1cm4gW107XG4gIGNvbnN0IHN1YiA9IGZpbmRHaXRTdWJjb21tYW5kKGFyZ3Yuc2xpY2UoMSkpO1xuICBpZiAoIXN1YiB8fCBzdWIuc3ViY29tbWFuZCAhPT0gJ3Nob3cnKSByZXR1cm4gW107XG4gIGNvbnN0IGFmdGVyID0gYXJndlxuICAgIC5zbGljZSgxKVxuICAgIC5zbGljZShzdWIuc3ViSWR4ICsgMSlcbiAgICAuZmlsdGVyKChhKSA9PiAhYS5zdGFydHNXaXRoKCctJykpO1xuICBjb25zdCByZXZQYXRoQXJnID0gYWZ0ZXIuZmluZCgoYSkgPT4gUkVWX1BBVEgudGVzdChhKSk7XG4gIGlmICghcmV2UGF0aEFyZykgcmV0dXJuIFtdO1xuICBjb25zdCBtID0gcmV2UGF0aEFyZy5tYXRjaChSRVZfUEFUSCk7XG4gIGlmICghbSkgcmV0dXJuIFtdO1xuICBjb25zdCBbLCByZXYsIHBhdGhdID0gbTtcbiAgaWYgKHN1Yi5jRGlyVW5yZXNvbHZhYmxlIHx8IGhhc1NoZWxsRXhwYW5zaW9uKHJldikpIHtcbiAgICByZXR1cm4gW1xuICAgICAge1xuICAgICAgICBraW5kOiAndW5yZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiAnZ2l0LXNob3ctcmV2LXBhdGgnLFxuICAgICAgICBmaWxlQXJnOiBwYXRoLFxuICAgICAgICByZWFzb246ICdnaXQgLUMgdGFyZ2V0IG9yIHJldmlzaW9uIGNvbnRhaW5zIGFuIHVucmVzb2x2ZWQgc2hlbGwgdmFyaWFibGUnXG4gICAgICB9XG4gICAgXTtcbiAgfVxuICByZXR1cm4gW1xuICAgIHtcbiAgICAgIGtpbmQ6ICdjYW5kaWRhdGUnLFxuICAgICAgaWRpb206ICdnaXQtc2hvdy1yZXYtcGF0aCcsXG4gICAgICBmaWxlQXJnOiBwYXRoLFxuICAgICAgc3BlYzogeyBraW5kOiAndG9Fb2YnLCBzdGFydDogMSB9LFxuICAgICAgcmVzb2x2ZXJLaW5kOiB7IGtpbmQ6ICdnaXQnLCByZXYgfSxcbiAgICAgIGRpck92ZXJyaWRlOiBzdWIuY0RpciA/PyB1bmRlZmluZWRcbiAgICB9XG4gIF07XG59XG5cbmZ1bmN0aW9uIG1hdGNoR2l0TG9nTChhcmd2OiBzdHJpbmdbXSk6IE1hdGNoUmVzdWx0W10ge1xuICBpZiAoYXJndlswXSAhPT0gJ2dpdCcpIHJldHVybiBbXTtcbiAgY29uc3Qgc3ViID0gZmluZEdpdFN1YmNvbW1hbmQoYXJndi5zbGljZSgxKSk7XG4gIGlmICghc3ViIHx8IHN1Yi5zdWJjb21tYW5kICE9PSAnbG9nJykgcmV0dXJuIFtdO1xuICBjb25zdCBhZnRlciA9IGFyZ3Yuc2xpY2UoMSkuc2xpY2Uoc3ViLnN1YklkeCArIDEpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGFmdGVyLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFmdGVyW2ldO1xuICAgIGxldCBzcGVjOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgICBpZiAoYSA9PT0gJy1MJykgc3BlYyA9IGFmdGVyW2kgKyAxXSA/PyBudWxsO1xuICAgIGVsc2UgaWYgKGEuc3RhcnRzV2l0aCgnLUwnKSkgc3BlYyA9IGEuc2xpY2UoMik7XG4gICAgaWYgKCFzcGVjKSBjb250aW51ZTtcbiAgICBjb25zdCBtID0gc3BlYy5tYXRjaCgvXihcXGQrKSwoXFxkKyk6KC4rKSQvKTtcbiAgICBpZiAoIW0pIGNvbnRpbnVlO1xuICAgIGNvbnN0IFssIHMsIGUsIHBhdGhdID0gbTtcbiAgICBpZiAoc3ViLmNEaXJVbnJlc29sdmFibGUpIHtcbiAgICAgIHJldHVybiBbXG4gICAgICAgIHtcbiAgICAgICAgICBraW5kOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgaWRpb206ICdnaXQtbG9nLUwnLFxuICAgICAgICAgIGZpbGVBcmc6IHBhdGgsXG4gICAgICAgICAgcmVhc29uOiAnZ2l0IC1DIHRhcmdldCBjb250YWlucyBhbiB1bnJlc29sdmVkIHNoZWxsIHZhcmlhYmxlJ1xuICAgICAgICB9XG4gICAgICBdO1xuICAgIH1cbiAgICByZXR1cm4gW1xuICAgICAge1xuICAgICAgICBraW5kOiAnY2FuZGlkYXRlJyxcbiAgICAgICAgaWRpb206ICdnaXQtbG9nLUwnLFxuICAgICAgICBmaWxlQXJnOiBwYXRoLFxuICAgICAgICBzcGVjOiB7IGtpbmQ6ICdsaXRlcmFsJywgc3RhcnQ6IE51bWJlci5wYXJzZUludChzLCAxMCksIGVuZDogTnVtYmVyLnBhcnNlSW50KGUsIDEwKSB9LFxuICAgICAgICByZXNvbHZlcktpbmQ6ICdmcycsXG4gICAgICAgIGRpck92ZXJyaWRlOiBzdWIuY0RpciA/PyB1bmRlZmluZWRcbiAgICAgIH1cbiAgICBdO1xuICB9XG4gIHJldHVybiBbXTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBIZXJlZG9jIHdyaXRlcyAoYGNhdCA+IGZpbGUgPDxFT0YgLi4uIEVPRmApOiBoYW5kbGVkIGFzIGEgZGVkaWNhdGVkIHJhdy10ZXh0XG4vLyBwYXNzIGJlY2F1c2UgdGhlIGJvZHkgY2FuIGl0c2VsZiBjb250YWluICYmLzsvfC9uZXdsaW5lcyB0aGF0IHdvdWxkXG4vLyBvdGhlcndpc2UgY29uZnVzZSBzcGxpdFRvcExldmVsLiBNYXRjaGVkIHNwYW5zIGFyZSBtYXNrZWQgb3V0IG9mIHRoZSBzdHJpbmdcbi8vIChyZXBsYWNlZCB3aXRoIGFuIGluZGV4ZWQgcGxhY2Vob2xkZXIgc2ltcGxlLWNvbW1hbmQpIGJlZm9yZSB0aGUgcmVzdCBvZlxuLy8gdGhlIHBpcGVsaW5lIHJ1bnMsIGFuZCByZS1hc3NvY2lhdGVkIGJ5IGluZGV4IGR1cmluZyB0aGUgbWFpbiB3YWxrIHNvIHRoZVxuLy8gd3JpdGUgaXMgcmVzb2x2ZWQgYWdhaW5zdCB0aGUgY29ycmVjdCBgY2RgLXRyYWNrZWQgZGlyZWN0b3J5LlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmludGVyZmFjZSBIZXJlZG9jV3JpdGUge1xuICByZWRpcmVjdDogJz4nIHwgJz4+JztcbiAgdGFyZ2V0OiBzdHJpbmc7XG4gIGJvZHk6IHN0cmluZztcbn1cblxuY29uc3QgSEVSRURPQ19PUEVOID1cbiAgL1xcYmNhdFsgXFx0XSsoPnsxLDJ9KVsgXFx0XSooXFxTKylbIFxcdF0qPDwoLT8pWyBcXHRdKig/OicoW14nXSopJ3xcIihbXlwiXSopXCJ8KFtBLVphLXpfXVtBLVphLXowLTlfXSopKS9nO1xuXG5mdW5jdGlvbiBlc2NhcGVSZWdFeHAoczogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHMucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcbn1cblxuZnVuY3Rpb24gZXh0cmFjdEhlcmVkb2NXcml0ZXMocmF3OiBzdHJpbmcpOiB7IHdyaXRlczogSGVyZWRvY1dyaXRlW107IG1hc2tlZDogc3RyaW5nIH0ge1xuICBjb25zdCB3cml0ZXM6IEhlcmVkb2NXcml0ZVtdID0gW107XG4gIGxldCBtYXNrZWQgPSAnJztcbiAgbGV0IGN1cnNvciA9IDA7XG4gIEhFUkVET0NfT1BFTi5sYXN0SW5kZXggPSAwO1xuICBsZXQgb3Blbk1hdGNoOiBSZWdFeHBFeGVjQXJyYXkgfCBudWxsID0gSEVSRURPQ19PUEVOLmV4ZWMocmF3KTtcbiAgd2hpbGUgKG9wZW5NYXRjaCAhPT0gbnVsbCkge1xuICAgIGNvbnN0IFssIHJlZGlyZWN0LCB0YXJnZXQsIGRhc2gsIGRxMSwgZHEyLCBiYXJlXSA9IG9wZW5NYXRjaDtcbiAgICBjb25zdCBkZWxpbSA9IGRxMSA/PyBkcTIgPz8gYmFyZTtcbiAgICBjb25zdCBvcGVuRW5kID0gb3Blbk1hdGNoLmluZGV4ICsgb3Blbk1hdGNoWzBdLmxlbmd0aDtcbiAgICBpZiAoIWRlbGltIHx8IG9wZW5NYXRjaC5pbmRleCA8IGN1cnNvcikge1xuICAgICAgSEVSRURPQ19PUEVOLmxhc3RJbmRleCA9IG9wZW5NYXRjaC5pbmRleCArIDE7XG4gICAgICBvcGVuTWF0Y2ggPSBIRVJFRE9DX09QRU4uZXhlYyhyYXcpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIFRoZSBib2R5IHJlZ2lvbiBzdGFydHMgcmlnaHQgYWZ0ZXIgdGhlIGRlbGltaXRlciBsaW5lJ3MgbmV3bGluZS4gQW5cbiAgICAvLyBhYnNlbnQgbmV3bGluZSAoaW5wdXQgZW5kcyBhdCB0aGUgZGVsaW1pdGVyLCBvciBgJiZgL2A7YCBjb250aW51ZXMgdGhlXG4gICAgLy8gbGluZSkgaXMgYSBzYW1lLWxpbmUgdW50ZXJtaW5hdGVkIGhlcmVkb2Mgd2l0aCBhbiBlbXB0eSBib2R5IFx1MjAxNCB0aGUgYD5gXG4gICAgLy8gcmVkaXJlY3Qgc3RpbGwgdHJ1bmNhdGVzIHRoZSBmaWxlLCBhbmQgdGhlIGNvbnRpbnVhdGlvbiBzdGF5cyBjb21tYW5kcy5cbiAgICBjb25zdCBubCA9IHJhdy5zbGljZShvcGVuRW5kKS5tYXRjaCgvXlsgXFx0XSpcXHI/XFxuLyk7XG4gICAgY29uc3QgYm9keVN0YXJ0ID0gbmwgIT09IG51bGwgPyBvcGVuRW5kICsgbmxbMF0ubGVuZ3RoIDogb3BlbkVuZDtcbiAgICBjb25zdCByZW1haW5kZXIgPSByYXcuc2xpY2UoYm9keVN0YXJ0KTtcbiAgICBjb25zdCBjbG9zZVJlID0gbmV3IFJlZ0V4cChgXiR7ZGFzaCA/ICdcXFxcdConIDogJyd9JHtlc2NhcGVSZWdFeHAoZGVsaW0pfVsgXFxcXHRdKiRgLCAnbScpO1xuICAgIGNvbnN0IGNsb3NlTWF0Y2ggPSBjbG9zZVJlLmV4ZWMocmVtYWluZGVyKTtcbiAgICBsZXQgYm9keTogc3RyaW5nO1xuICAgIGxldCBtYXRjaEVuZDogbnVtYmVyO1xuICAgIGlmIChjbG9zZU1hdGNoKSB7XG4gICAgICBib2R5ID0gcmVtYWluZGVyLnNsaWNlKDAsIGNsb3NlTWF0Y2guaW5kZXgpLnJlcGxhY2UoL1xcbiQvLCAnJyk7XG4gICAgICBtYXRjaEVuZCA9IGJvZHlTdGFydCArIGNsb3NlTWF0Y2guaW5kZXggKyBjbG9zZU1hdGNoWzBdLmxlbmd0aDtcbiAgICB9IGVsc2UgaWYgKG5sID09PSBudWxsKSB7XG4gICAgICBib2R5ID0gJyc7XG4gICAgICBtYXRjaEVuZCA9IG9wZW5FbmQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFVudGVybWluYXRlZCB3aXRoIGEgYm9keSByZWdpb246IHRoZSBkYXRhIHJlZ2lvbiBydW5zIHRvIEVPRi5cbiAgICAgIGJvZHkgPSByZW1haW5kZXIucmVwbGFjZSgvXFxuJC8sICcnKTtcbiAgICAgIG1hdGNoRW5kID0gcmF3Lmxlbmd0aDtcbiAgICB9XG5cbiAgICBtYXNrZWQgKz0gcmF3LnNsaWNlKGN1cnNvciwgb3Blbk1hdGNoLmluZGV4KTtcbiAgICBtYXNrZWQgKz0gYF9faGVyZWRvY18ke3dyaXRlcy5sZW5ndGh9X19gO1xuICAgIGN1cnNvciA9IG1hdGNoRW5kO1xuICAgIHdyaXRlcy5wdXNoKHsgcmVkaXJlY3Q6IHJlZGlyZWN0IGFzICc+JyB8ICc+PicsIHRhcmdldCwgYm9keSB9KTtcblxuICAgIEhFUkVET0NfT1BFTi5sYXN0SW5kZXggPSBtYXRjaEVuZDtcbiAgICBvcGVuTWF0Y2ggPSBIRVJFRE9DX09QRU4uZXhlYyhyYXcpO1xuICB9XG4gIG1hc2tlZCArPSByYXcuc2xpY2UoY3Vyc29yKTtcbiAgcmV0dXJuIHsgd3JpdGVzLCBtYXNrZWQgfTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBXaW5kb3cgYWxnZWJyYSAocGxhbiBcdTAwQTczKTogc291cmNlIGFuYWx5c2lzIGFuZCBzdGRpbi1zZWxlY3RvciBjbGFzc2lmaWNhdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBgbmxgJ3MgYXJnLXRha2luZyBmbGFncyBcdTIwMTQgZWFjaCBjb25zdW1lcyB0aGUgZm9sbG93aW5nIHdvcmQgKHBsYW4gXHUwMEE3MykuICovXG5jb25zdCBOTF9BUkdfRkxBR1MgPSBuZXcgU2V0KFsnLWInLCAnLWknLCAnLWwnLCAnLXMnLCAnLXYnLCAnLXcnXSk7XG5cbi8qKiBTdGRvdXQtZm9ybSByZWRpcmVjdCBvcGVyYXRvcnMgb24gdGhlIHByZS1zdHJpcCBhcmd2IChwbGFuIFx1MDBBNzMgc2V2ZXJhbmNlKTogYD5gLCBgPj5gLCBgJj5gLCBgJj4+YCwgYDE+YCwgYDE+PmAsIGA+fGAuICovXG5jb25zdCBTVERPVVRfUkVESVJFQ1RfVFdPX1RPS0VOID0gL14oPzo+Pj98Jj4+P3wxPj4/fD5cXHwpJC87XG5jb25zdCBTVERPVVRfUkVESVJFQ1RfRlVTRUQgPSAvXig/Oj4+P3wmPj4/fDE+Pj8pW148PiZ8XS87XG5jb25zdCBTVERPVVRfUkVESVJFQ1RfRlVTRURfUElQRSA9IC9ePlxcfFtePD4mfF0vO1xuXG4vKiogV2hldGhlciBhIHByZS1zdHJpcCBhcmd2IGNhcnJpZXMgYSBzdGRvdXQtZm9ybSByZWRpcmVjdCAoc3RkZXJyIGAyPmAgYW5kIGR1cCBgMj4mMWAgbmV2ZXIgc2V2ZXIpLiAqL1xuY29uc3QgaGFzU3Rkb3V0UmVkaXJlY3QgPSAocmF3OiBzdHJpbmdbXSk6IGJvb2xlYW4gPT5cbiAgcmF3LnNvbWUoXG4gICAgKHcpID0+IFNURE9VVF9SRURJUkVDVF9UV09fVE9LRU4udGVzdCh3KSB8fCBTVERPVVRfUkVESVJFQ1RfRlVTRUQudGVzdCh3KSB8fCBTVERPVVRfUkVESVJFQ1RfRlVTRURfUElQRS50ZXN0KHcpXG4gICk7XG5cbnR5cGUgU291cmNlQW5hbHlzaXMgPVxuICB8IHsga2luZDogJ25vbmUnIH1cbiAgfCB7IGtpbmQ6ICd1bm5hcnJvd2FibGUnOyBmaWxlczogeyBmaWxlQXJnOiBzdHJpbmc7IGlkaW9tOiAnY2F0LWZpbGUnIHwgJ25sLWZpbGUnIH1bXSB9XG4gIHwgeyBraW5kOiAnbmFycm93YWJsZSc7IGZpbGVBcmc6IHN0cmluZzsgaWRpb206ICdjYXQtZmlsZScgfCAnbmwtZmlsZSc7IHJlc29sdmVyS2luZDogJ2ZzJzsgZGlyT3ZlcnJpZGU/OiBzdHJpbmcgfVxuICB8IHtcbiAgICAgIGtpbmQ6ICdnaXQnO1xuICAgICAgZmlsZUFyZzogc3RyaW5nO1xuICAgICAgaWRpb206ICdnaXQtc2hvdy1yZXYtcGF0aCc7XG4gICAgICByZXY6IHN0cmluZztcbiAgICAgIHJlc29sdmVyS2luZDogeyBraW5kOiAnZ2l0JzsgcmV2OiBzdHJpbmcgfTtcbiAgICAgIGRpck92ZXJyaWRlPzogc3RyaW5nO1xuICAgIH1cbiAgfCB7IGtpbmQ6ICdnaXRVbnJlc29sdmVkJzsgZmlsZUFyZzogc3RyaW5nOyByZWFzb246IHN0cmluZyB9O1xuXG4vKiogQSBzb3VyY2UgdGhhdCBvcGVucyBhIG5hcnJvd2FibGUgd2luZG93OiBhIHNpbmdsZS1maWxlIGBjYXRgL2BubGAgb3IgYSBgZ2l0IHNob3cgcmV2OnBhdGhgLiAqL1xudHlwZSBOYXJyb3dhYmxlU291cmNlID0gRXh0cmFjdDxTb3VyY2VBbmFseXNpcywgeyBraW5kOiAnbmFycm93YWJsZScgfCAnZ2l0JyB9PjtcblxuLyoqXG4gKiBUaGUgcGlwZWxpbmUtc291cmNlIGFuYWx5c2lzIChwbGFuIFx1MDBBNzMpOiBhIGBjYXRgL2BubGAgd2hvc2UgZmlsZSBhcmdzIFx1MjAxNFxuICogZXZlcnkgbm9uLWZsYWcgd29yZCwgd2hlcmUgYSBgLWAtcHJlZml4ZWQgd29yZCBpcyBhIGZsYWcgYW5kIGEgYmFyZSBgLWAgaXNcbiAqIGEgc3RkaW4gbWFya2VyIFx1MjAxNCBhcmUgYWxsIGZpbGVzLW9yLWAtYCB3aXRoIGF0IGxlYXN0IG9uZSBmaWxlLCBvciBhXG4gKiBgZ2l0IHNob3cgcmV2OnBhdGhgLiBBIHNpbmdsZS1maWxlIHNvdXJjZSBpcyBuYXJyb3dhYmxlOyBhIG11bHRpLWZpbGUgb3JcbiAqIHN0ZGluLW1peGVkIHNvdXJjZSBpcyB1bi1uYXJyb3dhYmxlIChlYWNoIGZpbGUgZW1pdHMgaXRzIG93biBjb25zZXJ2YXRpdmVcbiAqIHdob2xlLWZpbGUgcmVhZCwgYW5kIHN0ZGluIHNlbGVjdG9ycyBuZXZlciBuYXJyb3cgaXQpLlxuICovXG5mdW5jdGlvbiBhbmFseXplU291cmNlKGFyZ3Y6IHN0cmluZ1tdKTogU291cmNlQW5hbHlzaXMge1xuICBpZiAoYXJndlswXSA9PT0gJ2NhdCcgfHwgYXJndlswXSA9PT0gJ25sJykge1xuICAgIGNvbnN0IGZpbGVzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGlmIChhcmd2WzBdID09PSAnY2F0Jykge1xuICAgICAgZm9yIChsZXQgaSA9IDE7IGkgPCBhcmd2Lmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IGEgPSBhcmd2W2ldO1xuICAgICAgICBpZiAoYS5zdGFydHNXaXRoKCctJykgJiYgYSAhPT0gJy0nKSBjb250aW51ZTsgLy8gYSBmbGFnIFx1MjAxNCBjYXQgZmxhZ3MgbmV2ZXIgdGFrZSBhcmd1bWVudHNcbiAgICAgICAgZmlsZXMucHVzaChhKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgZm9yIChsZXQgaSA9IDE7IGkgPCBhcmd2Lmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IGEgPSBhcmd2W2ldO1xuICAgICAgICBpZiAoYSA9PT0gJy0nKSB7XG4gICAgICAgICAgZmlsZXMucHVzaChhKTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoYS5zdGFydHNXaXRoKCctJykpIHtcbiAgICAgICAgICBpZiAoTkxfQVJHX0ZMQUdTLmhhcyhhKSkgaSArPSAxOyAvLyBhcmctdGFraW5nIGZsYWcgY29uc3VtZXMgdGhlIG5leHQgd29yZFxuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGZpbGVzLnB1c2goYSk7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IHJlYWwgPSBmaWxlcy5maWx0ZXIoKGYpID0+IGYgIT09ICctJyk7XG4gICAgaWYgKHJlYWwubGVuZ3RoID09PSAwKSByZXR1cm4geyBraW5kOiAnbm9uZScgfTtcbiAgICBjb25zdCBpZGlvbSA9IGFyZ3ZbMF0gPT09ICdjYXQnID8gJ2NhdC1maWxlJyA6ICdubC1maWxlJztcbiAgICBpZiAocmVhbC5sZW5ndGggPT09IDEgJiYgIWZpbGVzLmluY2x1ZGVzKCctJykpIHtcbiAgICAgIHJldHVybiB7IGtpbmQ6ICduYXJyb3dhYmxlJywgZmlsZUFyZzogcmVhbFswXSwgaWRpb20sIHJlc29sdmVyS2luZDogJ2ZzJyB9O1xuICAgIH1cbiAgICByZXR1cm4geyBraW5kOiAndW5uYXJyb3dhYmxlJywgZmlsZXM6IHJlYWwubWFwKChmaWxlQXJnKSA9PiAoeyBmaWxlQXJnLCBpZGlvbSB9KSkgfTtcbiAgfVxuICBpZiAoYXJndlswXSA9PT0gJ2dpdCcpIHtcbiAgICBjb25zdCBvdXRjb21lcyA9IG1hdGNoR2l0U2hvdyhhcmd2KTtcbiAgICBpZiAob3V0Y29tZXMubGVuZ3RoID09PSAxKSB7XG4gICAgICBjb25zdCBvID0gb3V0Y29tZXNbMF07XG4gICAgICBpZiAoby5raW5kID09PSAndW5yZXNvbHZlZCcpIHtcbiAgICAgICAgcmV0dXJuIHsga2luZDogJ2dpdFVucmVzb2x2ZWQnLCBmaWxlQXJnOiBvLmZpbGVBcmcsIHJlYXNvbjogby5yZWFzb24gfTtcbiAgICAgIH1cbiAgICAgIGlmIChvLmtpbmQgPT09ICdjYW5kaWRhdGUnICYmIG8ucmVzb2x2ZXJLaW5kICE9PSAnZnMnKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAga2luZDogJ2dpdCcsXG4gICAgICAgICAgZmlsZUFyZzogby5maWxlQXJnLFxuICAgICAgICAgIGlkaW9tOiAnZ2l0LXNob3ctcmV2LXBhdGgnLFxuICAgICAgICAgIHJldjogby5yZXNvbHZlcktpbmQucmV2LFxuICAgICAgICAgIHJlc29sdmVyS2luZDogby5yZXNvbHZlcktpbmQsXG4gICAgICAgICAgZGlyT3ZlcnJpZGU6IG8uZGlyT3ZlcnJpZGVcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIHsga2luZDogJ25vbmUnIH07XG59XG5cbnR5cGUgU3RkaW5TZWxlY3RvciA9XG4gIHwgeyBraW5kOiAnaGVhZCc7IGNvdW50OiBudW1iZXIgfVxuICB8IHsga2luZDogJ3RhaWwnOyBjb3VudDogbnVtYmVyOyBmcm9tU3RhcnQ6IGJvb2xlYW4gfVxuICB8IHsga2luZDogJ3NlZCc7IHJhbmdlczogeyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB8ICckJyB9W10gfTtcblxuLyoqXG4gKiBXaGV0aGVyIGEgd3JhcHBlci1zdHJpcHBlZCBzdGFnZSBpcyBhIHN0ZGluIGxpbmUtc2VsZWN0b3IgKHBsYW4gXHUwMEE3Myk6IGFcbiAqIGBzZWQgLW5gIHJhbmdlIHNjcmlwdCwgYGhlYWRgLCBvciBgdGFpbGAgd2l0aCBubyBmaWxlIGFyZ3MgKGEgYmFyZSBgLWAgaXMgYVxuICogc3RkaW4gbWFya2VyLCBub3QgYSBmaWxlKS4gQSByZWNvZ25pemVkIHNlbGVjdG9yIGNhcnJ5aW5nIGl0cyBvd24gZmlsZSBhcmdzXG4gKiBpcyBhIG5vbi1jb25zdW1lciBcdTIwMTQgaXQgbmV2ZXIgcmVhZHMgdGhlIHBpcGUgXHUyMDE0IGFuZCByZXR1cm5zIG51bGwuXG4gKi9cbmZ1bmN0aW9uIGNsYXNzaWZ5U3RkaW5TZWxlY3Rvcihhcmd2OiBzdHJpbmdbXSk6IFN0ZGluU2VsZWN0b3IgfCBudWxsIHtcbiAgaWYgKGFyZ3ZbMF0gPT09ICdoZWFkJyB8fCBhcmd2WzBdID09PSAndGFpbCcpIHtcbiAgICBjb25zdCB7IGNvdW50LCBmcm9tU3RhcnQsIGRpc3F1YWxpZmllZCwgZmlsZXMgfSA9IHBhcnNlSGVhZFRhaWxGbGFncyhhcmd2LnNsaWNlKDEpLCBhcmd2WzBdID09PSAndGFpbCcpO1xuICAgIGlmIChkaXNxdWFsaWZpZWQpIHJldHVybiBudWxsOyAvLyBieXRlL3plcm8tdGVybWluYXRlZCByZWFkcyBhcmUgbm90IGxpbmUgc2VsZWN0b3JzXG4gICAgY29uc3QgZmlsZUFyZ3MgPSBmaWxlcy5maWx0ZXIoKGYpID0+IGYgIT09ICctJyk7XG4gICAgaWYgKGZpbGVBcmdzLmxlbmd0aCA+IDApIHJldHVybiBudWxsO1xuICAgIHJldHVybiBhcmd2WzBdID09PSAnaGVhZCcgPyB7IGtpbmQ6ICdoZWFkJywgY291bnQ6IGNvdW50ID8/IDEwIH0gOiB7IGtpbmQ6ICd0YWlsJywgY291bnQ6IGNvdW50ID8/IDEwLCBmcm9tU3RhcnQgfTtcbiAgfVxuICBpZiAoYXJndlswXSA9PT0gJ3NlZCcpIHtcbiAgICBjb25zdCByZXN0ID0gYXJndi5zbGljZSgxKTtcbiAgICBpZiAoIXJlc3QuaW5jbHVkZXMoJy1uJykpIHJldHVybiBudWxsO1xuICAgIGxldCBzY3JpcHRJZHggPSAtMTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJlc3QubGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmIChyZXN0W2ldID09PSAnLW4nKSBjb250aW51ZTtcbiAgICAgIGlmIChzZWRTY3JpcHRTZWdtZW50cyhyZXN0W2ldKS5zb21lKChzZWcpID0+IFNFRF9SQU5HRS50ZXN0KHNlZykpKSB7XG4gICAgICAgIHNjcmlwdElkeCA9IGk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoc2NyaXB0SWR4ID09PSAtMSkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgZmlsZUNhbmRpZGF0ZXMgPSByZXN0LmZpbHRlcigoYSwgaSkgPT4gaSAhPT0gc2NyaXB0SWR4ICYmIGEgIT09ICctbicgJiYgIWEuc3RhcnRzV2l0aCgnLScpKTtcbiAgICBpZiAoZmlsZUNhbmRpZGF0ZXMubGVuZ3RoICE9PSAwKSByZXR1cm4gbnVsbDsgLy8gbm9uLWNvbnN1bWVyIFx1MjAxNCByZWFkcyBpdHMgZmlsZSwgbmV2ZXIgdGhlIHBpcGVcbiAgICBjb25zdCByYW5nZXM6IHsgc3RhcnQ6IG51bWJlcjsgZW5kOiBudW1iZXIgfCAnJCcgfVtdID0gW107XG4gICAgZm9yIChjb25zdCBzZWdtZW50IG9mIHNlZFNjcmlwdFNlZ21lbnRzKHJlc3Rbc2NyaXB0SWR4XSkpIHtcbiAgICAgIGNvbnN0IG0gPSBzZWdtZW50Lm1hdGNoKFNFRF9SQU5HRSk7XG4gICAgICBpZiAoIW0pIGNvbnRpbnVlO1xuICAgICAgY29uc3Qgc3RhcnQgPSBOdW1iZXIucGFyc2VJbnQobVsxXSwgMTApO1xuICAgICAgcmFuZ2VzLnB1c2goeyBzdGFydCwgZW5kOiBtWzJdID09PSB1bmRlZmluZWQgPyBzdGFydCA6IG1bMl0gPT09ICckJyA/ICckJyA6IE51bWJlci5wYXJzZUludChtWzJdLCAxMCkgfSk7XG4gICAgfVxuICAgIGlmIChyYW5nZXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4geyBraW5kOiAnc2VkJywgcmFuZ2VzIH07XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gT3JjaGVzdHJhdG9yXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgTElORV9TRUxFQ1RPUlMgPSBbbWF0Y2hTZWQsIG1hdGNoSGVhZCwgbWF0Y2hUYWlsXTtcblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQ29tbWFuZERldGFpbGVkKGNvbW1hbmQ6IHN0cmluZywgb3B0czogUGFyc2VPcHRpb25zID0ge30pOiBTcGFuTWF0Y2hbXSB7XG4gIGNvbnN0IGN3ZCA9IG9wdHMuY3dkID8/IHByb2Nlc3MuY3dkKCk7XG4gIC8vIFBsYW4gXHUwMEE3NzogdGhlIHBhcnNlciBkZWZhdWx0cyBgZW52YCB0byB0aGUgaG9vayBwcm9jZXNzIGVudiwgZ2F0ZWQgYnkgdGhlXG4gIC8vIGFsbG93bGlzdCBcdTIwMTQgb25seSBgREVGQVVMVF9QQVRIX0FMTE9XTElTVGAgbmFtZXMgbWF5IHJlc29sdmUgZnJvbSBpdC4gQW5cbiAgLy8gZXhwbGljaXRseSBpbmplY3RlZCBlbnYgKHRlc3RzLCBhZGFwdGVycykgaXMgY29uc3VsdGVkIHdob2xlc2FsZS5cbiAgY29uc3QgYWxsb3dsaXN0ID0gb3B0cy5hbGxvd2xpc3QgPz8gREVGQVVMVF9QQVRIX0FMTE9XTElTVDtcbiAgY29uc3QgZW52OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCB1bmRlZmluZWQ+ID1cbiAgICBvcHRzLmVudiA/PyBPYmplY3QuZnJvbUVudHJpZXMoYWxsb3dsaXN0Lm1hcCgobikgPT4gW24sIHByb2Nlc3MuZW52W25dXSkpO1xuICBjb25zdCB7IHdyaXRlczogaGVyZWRvY1dyaXRlcywgbWFza2VkIH0gPSBleHRyYWN0SGVyZWRvY1dyaXRlcyhjb21tYW5kKTtcbiAgY29uc3QgeyBzdGFnZXM6IHNpbXBsZUNvbW1hbmRzLCBtYWxmb3JtZWQgfSA9IHNwbGl0VG9wTGV2ZWwobWFza2VkKTtcblxuICAvLyBWZXJkaWN0IGNvbnN1bXB0aW9uIChwbGFuIFx1MDBBNzEsIGxpc3Qtc2NvcGUgKyB0ZXJtaW5hbCBzZW1hbnRpY3MpOiB0aGVcbiAgLy8gc3BsaXR0ZXIgaGFzIGFscmVhZHkgZHJvcHBlZCB0aGUgcmVqZWN0aW5nIGxpc3QncyBzdGFnZXMgYW5kIHRydW5jYXRlZCBhdFxuICAvLyB0aGUgZmlyc3QgbWFsZm9ybWVkIGxpc3QsIHNvIGBzaW1wbGVDb21tYW5kc2AgaXMgZXhhY3RseSB0aGUgY29tcGxldGVkXG4gIC8vIGVhcmxpZXIgbGlzdHMgYW5kIHdhbGtzIG5vcm1hbGx5IGJlbG93IFx1MjAxNCB0aGUgZnVsbC1saW5lIGtpbmRzXG4gIC8vICgndW5jbG9zZWQtcXVvdGUnLCAndW5iYWxhbmNlZC1wYXJlbicsICdkYW5nbGluZy1vcGVyYXRvcicsICdwaXBlLWJhbmcnLFxuICAvLyAndW5jbG9zZWQtYnJhY2UnLCAndW5jbG9zZWQtY2FzZScsICd1bmNsb3NlZC1jb25zdHJ1Y3QnKSBlbWl0IG5vIHRvdWNoZXNcbiAgLy8gd2l0aG91dCBmdXJ0aGVyIGhhbmRsaW5nLiAndW50ZXJtaW5hdGVkLWhlcmVkb2MnICh0aGUgcGFydGlhbCwgYXJyaXZpbmdcbiAgLy8gd2l0aCB0aGUgaGVyZWRvYyBtYWNoaW5lcnkgaW4gYSBsYXRlciBwaGFzZSkga2VlcHMgdGhlIGN1cnJlbnQgYmVoYXZpb3I6XG4gIC8vIGl0cyBzdGFnZSBsaXN0IHJ1bnMgdGhyb3VnaCB0aGUgZGVsaW1pdGVyJ3MgbGluZSBhbmQgbGlrZXdpc2UgYW5hbHl6ZXNcbiAgLy8gYXMtaXMuXG4gIHZvaWQgbWFsZm9ybWVkO1xuXG4gIC8vIFRoZSBleGVjdXRpb24gd2FsayAocGxhbiBcdTAwQTcyKSBkZWNpZGVzIHdoaWNoIHN0YWdlcyByYW4gYW5kIGV4cGFuZHMgdGhlXG4gIC8vIGRlY2lkYWJsZSBjb25zdHJ1Y3QgaW50ZXJpb3JzIGluIHRoZWlyIHBsYWNlLiBPbmx5IGAneWVzJ2Agc3RhZ2VzIGVtaXQuXG4gIGNvbnN0IGV4cGFuZGVkID0gbmV3IEV4ZWN1dGlvbldhbGtlcigpLndhbGtJbnB1dChzaW1wbGVDb21tYW5kcyk7XG5cbiAgY29uc3QgcmVzdWx0czogU3Bhbk1hdGNoW10gPSBbXTtcbiAgY29uc3QgZnNMaW5lQ2FjaGUgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyIHwgbnVsbD4oKTtcbiAgY29uc3QgZ2l0TGluZUNhY2hlID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlciB8IG51bGw+KCk7XG5cbiAgY29uc3QgY2FjaGVkRnNUb3RhbExpbmVzID0gKGFic1BhdGg6IHN0cmluZykgPT4gKCkgPT4ge1xuICAgIGlmICghZnNMaW5lQ2FjaGUuaGFzKGFic1BhdGgpKSBmc0xpbmVDYWNoZS5zZXQoYWJzUGF0aCwgY291bnRGaWxlTGluZXMoYWJzUGF0aCkpO1xuICAgIHJldHVybiBmc0xpbmVDYWNoZS5nZXQoYWJzUGF0aCkgPz8gbnVsbDtcbiAgfTtcbiAgY29uc3QgY2FjaGVkR2l0VG90YWxMaW5lcyA9IChnaXRDd2Q6IHN0cmluZywgcmV2OiBzdHJpbmcsIHBhdGg6IHN0cmluZykgPT4gKCkgPT4ge1xuICAgIGNvbnN0IGtleSA9IGAke2dpdEN3ZH1cXHUwMDAwJHtyZXZ9XFx1MDAwMCR7cGF0aH1gO1xuICAgIGlmICghZ2l0TGluZUNhY2hlLmhhcyhrZXkpKSBnaXRMaW5lQ2FjaGUuc2V0KGtleSwgY291bnRHaXRCbG9iTGluZXMoZ2l0Q3dkLCByZXYsIHBhdGgpKTtcbiAgICByZXR1cm4gZ2l0TGluZUNhY2hlLmdldChrZXkpID8/IG51bGw7XG4gIH07XG5cbiAgLy8gYGNkYCBmcmFtZXMgKHBsYW4gXHUwMEE3Nik6IHRoZSB3YWxrIGFzc2lnbnMgZWFjaCBzdGFnZSB0aGUgc3Vic2hlbGwgZnJhbWUgaXRcbiAgLy8gcmFuIGluOyBhIHN1YnNoZWxsJ3MgYGNkYCByZS1iYXNlcyB3aXRoaW4gaXRzIGZyZXNoIGZyYW1lLCBkaXNjYXJkZWQgYXRcbiAgLy8gdGhlIGNsb3NlLiBFYWNoIGZyYW1lIHRyYWNrcyB0aGUgY29tcG9zZWQgZWZmZWN0aXZlIGRpcmVjdG9yeSwgaXRzXG4gIC8vIGNlcnRhaW50eSAoYW4gZXhlY3V0ZWQgb3IgbWF5LWhhdmUtcnVuIGBjZGAgd2l0aCBhbiB1bnJlc29sdmFibGUgdGFyZ2V0XG4gIC8vIHBvaXNvbnMgaXQgXHUyMDE0IHJlbGF0aXZlIHJlc29sdXRpb24gZmFpbHMgY2xvc2VkKSwgYW5kIHRoZSBwcmUtYGNkYCBwYXRoXG4gIC8vIChgY2QgLWAncyBPTERQV0QpLlxuICBpbnRlcmZhY2UgRGlyRnJhbWUge1xuICAgIGRpcjogc3RyaW5nO1xuICAgIGNlcnRhaW46IGJvb2xlYW47XG4gICAgcHJldjogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICB9XG4gIGNvbnN0IGRpckZyYW1lczogRGlyRnJhbWVbXSA9IFt7IGRpcjogY3dkLCBjZXJ0YWluOiB0cnVlLCBwcmV2OiB1bmRlZmluZWQgfV07XG5cbiAgLyoqIFRoZSBwYXJ0cyBvZiBhIGZyYW1lIHRoZSByZXNvbHV0aW9uIHBhdGhzIG5lZWQgKG5vIE9MRFBXRCkuICovXG4gIGludGVyZmFjZSBGcmFtZSB7XG4gICAgZGlyOiBzdHJpbmc7XG4gICAgY2VydGFpbjogYm9vbGVhbjtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgZWZmZWN0aXZlIGdpdCByZXBvIGRpciBmb3IgYSBjYW5kaWRhdGUgKHBsYW4gXHUwMEE3Nik6IGFuIGFic29sdXRlIGAtQ2BcbiAgICogdGFyZ2V0IGlzIHNlbGYtY29udGFpbmVkOyBhIHJlbGF0aXZlIG9uZSBjb21wb3NlcyB3aXRoIHRoZSB0cmFja2VkXG4gICAqIGRpcmVjdG9yeTsgbm8gYC1DYCB1c2VzIHRoZSB0cmFja2VkIGRpcmVjdG9yeSBpdHNlbGYuIFVuZGVmaW5lZCB3aGVuIHRoZVxuICAgKiBmcmFtZSBpcyB1bmNlcnRhaW4gXHUyMDE0IHRoZSByZXBvIGxvY2F0aW9uIGlzIHVua25vd24sIGZhaWwgY2xvc2VkLlxuICAgKi9cbiAgY29uc3QgZ2l0RGlyT2YgPSAoYzogeyBkaXJPdmVycmlkZT86IHN0cmluZyB9LCBmcmFtZTogRnJhbWUpOiBzdHJpbmcgfCB1bmRlZmluZWQgPT4ge1xuICAgIGlmIChjLmRpck92ZXJyaWRlID09PSB1bmRlZmluZWQpIHJldHVybiBmcmFtZS5jZXJ0YWluID8gZnJhbWUuZGlyIDogdW5kZWZpbmVkO1xuICAgIGlmIChpc0Fic29sdXRlKGMuZGlyT3ZlcnJpZGUpKSByZXR1cm4gYy5kaXJPdmVycmlkZTtcbiAgICByZXR1cm4gZnJhbWUuY2VydGFpbiA/IHJlc29sdmVQYXRoKGZyYW1lLmRpciwgYy5kaXJPdmVycmlkZSkgOiB1bmRlZmluZWQ7XG4gIH07XG5cbiAgLyoqIFRoZSBydW5uaW5nIHdpbmRvdyBvZiB0aGUgY3VycmVudCBwaXBlbGluZSBncm91cCAocGxhbiBcdTAwQTczKS4gKi9cbiAgaW50ZXJmYWNlIFdpbmRvd1N0YXRlIHtcbiAgICBpZGlvbTogSWRpb207XG4gICAgZmlsZUFyZzogc3RyaW5nO1xuICAgIGRpcjogc3RyaW5nO1xuICAgIGNlcnRhaW46IGJvb2xlYW47XG4gICAgZGlyT3ZlcnJpZGU/OiBzdHJpbmc7XG4gICAgcmVzb2x2ZXJLaW5kOiAnZnMnIHwgeyBraW5kOiAnZ2l0JzsgcmV2OiBzdHJpbmcgfTtcbiAgICBsbzogbnVtYmVyO1xuICAgIGhpOiBudW1iZXI7XG4gICAgY29uc3VtZWQ6IGJvb2xlYW47XG4gIH1cbiAgbGV0IHdpbmRvdzogV2luZG93U3RhdGUgfCBudWxsID0gbnVsbDtcblxuICBjb25zdCB3aG9sZUZpbGVDYW5kaWRhdGUgPSAoczogeyBmaWxlQXJnOiBzdHJpbmc7IGlkaW9tOiAnY2F0LWZpbGUnIHwgJ25sLWZpbGUnIH0pOiBSYXdDYW5kaWRhdGUgPT4gKHtcbiAgICBraW5kOiAnY2FuZGlkYXRlJyxcbiAgICBpZGlvbTogcy5pZGlvbSxcbiAgICBmaWxlQXJnOiBzLmZpbGVBcmcsXG4gICAgc3BlYzogeyBraW5kOiAndG9Fb2YnLCBzdGFydDogMSB9LFxuICAgIHJlc29sdmVyS2luZDogJ2ZzJ1xuICB9KTtcblxuICAvKiogQSBzb3VyY2UncyB3aG9sZS1maWxlIHJlYWQgYXMgYSBjYW5kaWRhdGUgKGZzIG9yIGdpdCByZXNvbHZlcikuICovXG4gIGNvbnN0IHNvdXJjZUNhbmRpZGF0ZSA9IChzcmM6IE5hcnJvd2FibGVTb3VyY2UpOiBSYXdDYW5kaWRhdGUgPT4gKHtcbiAgICBraW5kOiAnY2FuZGlkYXRlJyxcbiAgICBpZGlvbTogc3JjLmlkaW9tLFxuICAgIGZpbGVBcmc6IHNyYy5maWxlQXJnLFxuICAgIHNwZWM6IHsga2luZDogJ3RvRW9mJywgc3RhcnQ6IDEgfSxcbiAgICByZXNvbHZlcktpbmQ6IHNyYy5yZXNvbHZlcktpbmQsXG4gICAgZGlyT3ZlcnJpZGU6IHNyYy5kaXJPdmVycmlkZVxuICB9KTtcblxuICAvKiogRW1pdCB0aGUgd2luZG93J3MgdG91Y2g6IG9uZSBuYXJyb3cgcmFuZ2Ugd2hlbiBhIHN0ZGluIHNlbGVjdG9yIGNvbnN1bWVkIGl0LCBlbHNlIHRoZSB3aG9sZS1maWxlIHJlYWQuICovXG4gIGNvbnN0IGVtaXRXaW5kb3dUb3VjaCA9ICh3OiBXaW5kb3dTdGF0ZSkgPT4ge1xuICAgIGNvbnN0IHNwZWM6IExpbmVSYW5nZVNwZWMgPSB3LmNvbnN1bWVkID8geyBraW5kOiAnbGl0ZXJhbCcsIHN0YXJ0OiB3LmxvLCBlbmQ6IHcuaGkgfSA6IHsga2luZDogJ3RvRW9mJywgc3RhcnQ6IDEgfTtcbiAgICBlbWl0Q2FuZGlkYXRlKFxuICAgICAge1xuICAgICAgICBraW5kOiAnY2FuZGlkYXRlJyxcbiAgICAgICAgaWRpb206IHcuaWRpb20sXG4gICAgICAgIGZpbGVBcmc6IHcuZmlsZUFyZyxcbiAgICAgICAgc3BlYyxcbiAgICAgICAgcmVzb2x2ZXJLaW5kOiB3LnJlc29sdmVyS2luZCxcbiAgICAgICAgZGlyT3ZlcnJpZGU6IHcuZGlyT3ZlcnJpZGVcbiAgICAgIH0sXG4gICAgICB7IGRpcjogdy5kaXIsIGNlcnRhaW46IHcuY2VydGFpbiB9XG4gICAgKTtcbiAgfTtcblxuICAvKipcbiAgICogT3BlbiBhIHdpbmRvdyBvdmVyIGEgbmFycm93YWJsZSBzb3VyY2UuIEFuIHVucmVzb2x2YWJsZSBzb3VyY2UgXHUyMDE0IGFuXG4gICAqIHVuZXhwYW5kZWQgcGF0aCwgYW4gdW5jZXJ0YWluIHRyYWNrZWQgZGlyZWN0b3J5LCBvciBhbiB1bnJlc29sdmFibGVcbiAgICogYGdpdCAtQ2AgdGFyZ2V0IChwbGFuIFx1MDBBNzYpIFx1MjAxNCBlbWl0cyBhbiBgdW5yZXNvbHZlZGAgZW50cnkgYW5kIG5vIHdpbmRvdzpcbiAgICogZG93bnN0cmVhbSBzdGRpbiBzZWxlY3RvcnMgY29uc3VtZSBub3RoaW5nIChwbGFuIFx1MDBBNzMpLlxuICAgKi9cbiAgY29uc3QgaW5pdFdpbmRvdyA9IChzcmM6IE5hcnJvd2FibGVTb3VyY2UsIGZyYW1lOiBGcmFtZSkgPT4ge1xuICAgIGlmIChcbiAgICAgIGdpdERpck9mKHNyYywgZnJhbWUpID09PSB1bmRlZmluZWQgfHxcbiAgICAgICghZnJhbWUuY2VydGFpbiAmJiBzcmMucmVzb2x2ZXJLaW5kID09PSAnZnMnICYmICFpc0Fic29sdXRlKHNyYy5maWxlQXJnKSlcbiAgICApIHtcbiAgICAgIGVtaXRDYW5kaWRhdGUoc291cmNlQ2FuZGlkYXRlKHNyYyksIGZyYW1lKTsgLy8gdGhlIGdhdGUgcmVwb3J0cyB0aGUgdW5yZXNvbHZlZCBlbnRyeVxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB0b3RhbCA9IChcbiAgICAgIHNyYy5yZXNvbHZlcktpbmQgPT09ICdmcydcbiAgICAgICAgPyBjYWNoZWRGc1RvdGFsTGluZXMocmVzb2x2ZVBhdGgoZnJhbWUuZGlyLCBzcmMuZmlsZUFyZykpXG4gICAgICAgIDogY2FjaGVkR2l0VG90YWxMaW5lcyhnaXREaXJPZihzcmMsIGZyYW1lKSEsIHNyYy5yZXNvbHZlcktpbmQucmV2LCBzcmMuZmlsZUFyZylcbiAgICApKCk7XG4gICAgaWYgKHRvdGFsID09PSBudWxsKSB7XG4gICAgICBlbWl0Q2FuZGlkYXRlKHNvdXJjZUNhbmRpZGF0ZShzcmMpLCBmcmFtZSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHdpbmRvdyA9IHtcbiAgICAgIGlkaW9tOiBzcmMuaWRpb20sXG4gICAgICBmaWxlQXJnOiBzcmMuZmlsZUFyZyxcbiAgICAgIGRpcjogZnJhbWUuZGlyLFxuICAgICAgY2VydGFpbjogZnJhbWUuY2VydGFpbixcbiAgICAgIGRpck92ZXJyaWRlOiBzcmMuZGlyT3ZlcnJpZGUsXG4gICAgICByZXNvbHZlcktpbmQ6IHNyYy5yZXNvbHZlcktpbmQsXG4gICAgICBsbzogMSxcbiAgICAgIGhpOiB0b3RhbCxcbiAgICAgIGNvbnN1bWVkOiBmYWxzZVxuICAgIH07XG4gIH07XG5cbiAgLyoqXG4gICAqIEFwcGx5IGEgc3RkaW4gc2VsZWN0b3IncyB0cmFuc2Zvcm0gdG8gdGhlIGxpdmUgd2luZG93LCBjbGFtcGVkIHRvIHRoZVxuICAgKiBjdXJyZW50IHdpbmRvdy4gQSBuYXJyb3dpbmcgdHJhbnNmb3JtIG1hcmtzIHRoZSB3aW5kb3cgY29uc3VtZWQgKHRoZVxuICAgKiBlbWl0dGVkIHRvdWNoIGlzIHRoZSBuYXJyb3cgcmFuZ2UsIG5vdCB0aGUgd2hvbGUtZmlsZSByZWFkKS4gUmV0dXJuc1xuICAgKiBmYWxzZSB3aGVuIHRoZSB0cmFuc2Zvcm0gZW1wdGllcyB0aGUgd2luZG93IFx1MjAxNCB0aGUgcHJlLXRyYW5zZm9ybSB3aW5kb3dcbiAgICogc3Vydml2ZXMgKHdoYXQgYSByZWFkZXIgYWN0dWFsbHkgY29uc3VtZWQpIGFuZCBzdGF5cyB1bmNvbnN1bWVkLlxuICAgKi9cbiAgY29uc3QgYXBwbHlXaW5kb3dUcmFuc2Zvcm0gPSAoc2VsOiBTdGRpblNlbGVjdG9yKTogYm9vbGVhbiA9PiB7XG4gICAgY29uc3QgdyA9IHdpbmRvdyE7XG4gICAgY29uc3QgbG8gPSB3LmxvO1xuICAgIGNvbnN0IGhpID0gdy5oaTtcbiAgICBsZXQgbkxvOiBudW1iZXI7XG4gICAgbGV0IG5IaTogbnVtYmVyO1xuICAgIGlmIChzZWwua2luZCA9PT0gJ2hlYWQnKSB7XG4gICAgICBuTG8gPSBsbztcbiAgICAgIG5IaSA9IGxvICsgc2VsLmNvdW50IC0gMTtcbiAgICB9IGVsc2UgaWYgKHNlbC5raW5kID09PSAndGFpbCcpIHtcbiAgICAgIGlmIChzZWwuZnJvbVN0YXJ0KSB7XG4gICAgICAgIG5MbyA9IGxvICsgc2VsLmNvdW50IC0gMTtcbiAgICAgICAgbkhpID0gaGk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBuTG8gPSBoaSAtIHNlbC5jb3VudCArIDE7XG4gICAgICAgIG5IaSA9IGhpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBuTG8gPSBsbyArIHNlbC5yYW5nZXNbMF0uc3RhcnQgLSAxO1xuICAgICAgbkhpID0gc2VsLnJhbmdlc1swXS5lbmQgPT09ICckJyA/IGhpIDogbG8gKyBzZWwucmFuZ2VzWzBdLmVuZCAtIDE7XG4gICAgfVxuICAgIG5MbyA9IE1hdGgubWF4KG5MbywgbG8pO1xuICAgIG5IaSA9IE1hdGgubWluKG5IaSwgaGkpO1xuICAgIGlmIChuTG8gPiBuSGkpIHJldHVybiBmYWxzZTtcbiAgICB3LmxvID0gbkxvO1xuICAgIHcuaGkgPSBuSGk7XG4gICAgdy5jb25zdW1lZCA9IHRydWU7XG4gICAgcmV0dXJuIHRydWU7XG4gIH07XG5cbiAgLyoqIEEgbXVsdGktcmFuZ2Ugc3RkaW4gc2VkIGRlbGl2ZXJzIGVhY2ggcmFuZ2UgYXMgaXRzIG93biB0b3VjaCBhbmQgc2V2ZXJzOyBlbXB0eSBjbGFtcHMgZHJvcC4gKi9cbiAgY29uc3QgZW1pdE11bHRpUmFuZ2UgPSAocmFuZ2VzOiB7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIHwgJyQnIH1bXSkgPT4ge1xuICAgIGNvbnN0IHcgPSB3aW5kb3chO1xuICAgIGxldCBlbWl0dGVkID0gZmFsc2U7XG4gICAgZm9yIChjb25zdCByIG9mIHJhbmdlcykge1xuICAgICAgY29uc3QgbUxvID0gTWF0aC5tYXgody5sbywgdy5sbyArIHIuc3RhcnQgLSAxKTtcbiAgICAgIGNvbnN0IG1IaSA9IE1hdGgubWluKHcuaGksIHIuZW5kID09PSAnJCcgPyB3LmhpIDogdy5sbyArIHIuZW5kIC0gMSk7XG4gICAgICBpZiAobUxvID4gbUhpKSBjb250aW51ZTtcbiAgICAgIGVtaXR0ZWQgPSB0cnVlO1xuICAgICAgZW1pdENhbmRpZGF0ZShcbiAgICAgICAge1xuICAgICAgICAgIGtpbmQ6ICdjYW5kaWRhdGUnLFxuICAgICAgICAgIGlkaW9tOiB3LmlkaW9tLFxuICAgICAgICAgIGZpbGVBcmc6IHcuZmlsZUFyZyxcbiAgICAgICAgICBzcGVjOiB7IGtpbmQ6ICdsaXRlcmFsJywgc3RhcnQ6IG1MbywgZW5kOiBtSGkgfSxcbiAgICAgICAgICByZXNvbHZlcktpbmQ6IHcucmVzb2x2ZXJLaW5kLFxuICAgICAgICAgIGRpck92ZXJyaWRlOiB3LmRpck92ZXJyaWRlXG4gICAgICAgIH0sXG4gICAgICAgIHsgZGlyOiB3LmRpciwgY2VydGFpbjogdy5jZXJ0YWluIH1cbiAgICAgICk7XG4gICAgfVxuICAgIGlmICghZW1pdHRlZCkgZW1pdFdpbmRvd1RvdWNoKHcpOyAvLyBldmVyeSByYW5nZSBkcm9wcGVkIFx1MjAxNCB0aGUgcHJlLXRyYW5zZm9ybSB3aW5kb3cgc3Vydml2ZXNcbiAgfTtcblxuICBjb25zdCBlbWl0Q2FuZGlkYXRlID0gKGM6IFJhd0NhbmRpZGF0ZSwgZnJhbWU6IEZyYW1lKSA9PiB7XG4gICAgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKGMuZmlsZUFyZykpIHtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICBpZGlvbTogYy5pZGlvbSxcbiAgICAgICAgZmlsZUFyZzogYy5maWxlQXJnLFxuICAgICAgICByZWFzb246ICdwYXRoIGNvbnRhaW5zIGFuIHVuZXhwYW5kZWQgc2hlbGwgdmFyaWFibGUgb3IgZ2xvYidcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICAvLyBQbGFuIFx1MDBBNzYgY2VydGFpbnR5OiBhIHJlbGF0aXZlIHBhdGggYWdhaW5zdCBhbiB1bmNlcnRhaW4gZGlyZWN0b3J5LCBvciBhXG4gICAgLy8gZ2l0IGNhbmRpZGF0ZSB3aG9zZSByZXBvIGZyYW1lIGNhbm5vdCBiZSBjb21wb3NlZCwgaXMgdW5yZXNvbHZhYmxlIFx1MjAxNFxuICAgIC8vIG5ldmVyIGEgZ3Vlc3NlZCB0b3VjaC4gQWJzb2x1dGUgcGF0aHMgYXJlIHVuYWZmZWN0ZWQuXG4gICAgaWYgKGMucmVzb2x2ZXJLaW5kID09PSAnZnMnKSB7XG4gICAgICBpZiAoIWZyYW1lLmNlcnRhaW4gJiYgIWlzQWJzb2x1dGUoYy5maWxlQXJnKSkge1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIHN0YXR1czogJ3VucmVzb2x2ZWQnLFxuICAgICAgICAgIGlkaW9tOiBjLmlkaW9tLFxuICAgICAgICAgIGZpbGVBcmc6IGMuZmlsZUFyZyxcbiAgICAgICAgICByZWFzb246ICd0aGUgd29ya2luZyBkaXJlY3RvcnkgaXMgdW5jZXJ0YWluIFx1MjAxNCB0aGUgcmVsYXRpdmUgcGF0aCBjYW5ub3QgYmUgcmVzb2x2ZWQnXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChnaXREaXJPZihjLCBmcmFtZSkgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgIGlkaW9tOiBjLmlkaW9tLFxuICAgICAgICBmaWxlQXJnOiBjLmZpbGVBcmcsXG4gICAgICAgIHJlYXNvbjogJ3RoZSBnaXQgLUMgdGFyZ2V0IGNhbm5vdCBiZSByZXNvbHZlZCBhZ2FpbnN0IHRoZSB0cmFja2VkIGRpcmVjdG9yeSdcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICAvLyBBIGdpdCBjYW5kaWRhdGUncyBwYXRoIHJlc29sdmVzIGluc2lkZSBpdHMgcmVwbyBkaXIgKGAtQ2AgdGFyZ2V0IG9yIHRoZVxuICAgIC8vIHRyYWNrZWQgZGlyZWN0b3J5KSwgbm90IHRoZSBwcm9jZXNzIGRpciBcdTIwMTQgcGxhbiBcdTAwQTc2LlxuICAgIGNvbnN0IHJlc29sdXRpb25EaXIgPSBjLnJlc29sdmVyS2luZCA9PT0gJ2ZzJyA/IGZyYW1lLmRpciA6IGdpdERpck9mKGMsIGZyYW1lKSE7XG4gICAgY29uc3QgYWJzb2x1dGVQYXRoID0gcmVzb2x2ZVBhdGgocmVzb2x1dGlvbkRpciwgYy5maWxlQXJnKTtcbiAgICBjb25zdCB0b3RhbExpbmVzID1cbiAgICAgIGMucmVzb2x2ZXJLaW5kID09PSAnZnMnXG4gICAgICAgID8gY2FjaGVkRnNUb3RhbExpbmVzKGFic29sdXRlUGF0aClcbiAgICAgICAgOiBjYWNoZWRHaXRUb3RhbExpbmVzKHJlc29sdXRpb25EaXIsIGMucmVzb2x2ZXJLaW5kLnJldiwgYy5maWxlQXJnKTtcbiAgICBjb25zdCByYW5nZSA9IHJlc29sdmVTcGVjKGMuc3BlYywgdG90YWxMaW5lcyk7XG4gICAgaWYgKHJhbmdlID09PSBudWxsKSB7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgaWRpb206IGMuaWRpb20sXG4gICAgICAgIGZpbGVBcmc6IGFic29sdXRlUGF0aCxcbiAgICAgICAgcmVhc29uOiAnY291bGQgbm90IGRldGVybWluZSBlbmQtb2YtZmlsZSBsaW5lIGNvdW50IChmaWxlIHVucmVhZGFibGUsIGVtcHR5LCBvciBnaXQgcmV2L3BhdGggbm90IGZvdW5kKSdcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICByZXN1bHRzLnB1c2goe1xuICAgICAgc3RhdHVzOiAncmVzb2x2ZWQnLFxuICAgICAgaWRpb206IGMuaWRpb20sXG4gICAgICBzcGFuOiB7IGxpbmVTdGFydDogcmFuZ2UubGluZVN0YXJ0LCBsaW5lRW5kOiByYW5nZS5saW5lRW5kLCBhYnNvbHV0ZVBhdGggfVxuICAgIH0pO1xuICB9O1xuXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgZXhwYW5kZWQubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCBpdGVtID0gZXhwYW5kZWRbaV07XG4gICAgd2hpbGUgKGRpckZyYW1lcy5sZW5ndGggPiBpdGVtLmRpckZyYW1lICsgMSkgZGlyRnJhbWVzLnBvcCgpO1xuICAgIHdoaWxlIChkaXJGcmFtZXMubGVuZ3RoIDwgaXRlbS5kaXJGcmFtZSArIDEpIGRpckZyYW1lcy5wdXNoKHsgLi4uZGlyRnJhbWVzW2RpckZyYW1lcy5sZW5ndGggLSAxXSB9KTtcbiAgICBjb25zdCBmcmFtZSA9IGRpckZyYW1lc1tkaXJGcmFtZXMubGVuZ3RoIC0gMV07XG5cbiAgICAvLyBgJFBXRGAgcmVzb2x2ZXMgdG8gdGhlIHRyYWNrZWQgZGlyZWN0b3J5LCBub3QgdGhlIHN0YWxlIGhvb2sgZW52IChwbGFuXG4gICAgLy8gXHUwMEE3NikgXHUyMDE0IHRoZSBwZXItc3RhZ2UgZW52IG92ZXJyaWRlcyBpdCB3aXRoIHRoZSBjb21wb3NlZCBmcmFtZS5cbiAgICBjb25zdCBzdGFnZUVudiA9IHsgLi4uZW52LCBQV0Q6IGZyYW1lLmRpciB9O1xuXG4gICAgY29uc3QgcGlwZVByZWNlZGVzID0gaXRlbS5wcmVjZWRlZEJ5ID09PSAncGlwZSc7XG4gICAgY29uc3QgcGlwZUZvbGxvd3MgPSBleHBhbmRlZFtpICsgMV0gIT09IHVuZGVmaW5lZCAmJiBleHBhbmRlZFtpICsgMV0ucHJlY2VkZWRCeSA9PT0gJ3BpcGUnO1xuXG4gICAgLy8gQSBwaXBlbGluZSBncm91cCBpcyBkb25lIGF0IGl0cyBuZXh0IG5vbi1waXBlIHN0YWdlOiBmbHVzaCB0aGUgd2luZG93XG4gICAgLy8gKG9uZSBuYXJyb3cgdG91Y2ggaWYgYSBzdGRpbiBzZWxlY3RvciBjb25zdW1lZCB0aGUgc291cmNlLCBlbHNlIHRoZVxuICAgIC8vIGNvbnNlcnZhdGl2ZSB3aG9sZS1maWxlIHJlYWQgXHUyMDE0IHBsYW4gXHUwMEE3MywgZW1pdCkuXG4gICAgaWYgKCFwaXBlUHJlY2VkZXMgJiYgd2luZG93ICE9PSBudWxsKSB7XG4gICAgICBlbWl0V2luZG93VG91Y2god2luZG93KTtcbiAgICAgIHdpbmRvdyA9IG51bGw7XG4gICAgfVxuXG4gICAgLy8gYGNkYCBib29ra2VlcGluZyAocGxhbiBcdTAwQTc2KSBydW5zIGJlZm9yZSB0aGUgZXhlYyBnYXRlOiBhIG1heS1oYXZlLXJ1blxuICAgIC8vIChgJ3Vua25vd24nYCkgY2QgcG9pc29ucyBjZXJ0YWludHkgZXZlbiB0aG91Z2ggaXRzIG93biBzdGFnZSBlbWl0c1xuICAgIC8vIG5vdGhpbmcsIGFuZCBhIHNraXBwZWQgKGAnbm8nYCkgY2QgbGVhdmVzIHRoZSBkaXIgdW5jaGFuZ2VkLlxuICAgIGNvbnN0IGNkQXJndiA9IHN0cmlwRm9yRW1pc3Npb24oc3RyaXBSZWRpcmVjdHMoYXJndk9mKGl0ZW0udGV4dCkgPz8gW10pKTtcbiAgICBpZiAoY2RBcmd2WzBdID09PSAnY2QnICYmICFpdGVtLmluUGlwZWxpbmUpIHtcbiAgICAgIGlmIChpdGVtLmV4ZWMgPT09ICd5ZXMnKSB7XG4gICAgICAgIC8vIFRoZSB0YXJnZXQgZXhwYW5kcyBsaWtlIGFueSBvdGhlciB3b3JkIFx1MjAxNCBgY2QgXCIkV09SS1NQQUNFX1BBVEhcImBcbiAgICAgICAgLy8gZmluYWxseSB3b3JrcyAocGxhbiBcdTAwQTc3KS4gQmFyZSBgY2RgIGlzIGAkSE9NRWAgdmlhIHRoZSBzYW1lXG4gICAgICAgIC8vIGV4cGFuc2lvbiBtYWNoaW5lcnkuXG4gICAgICAgIGNvbnN0IGV4cGFuZGVkQXJndiA9IHN0cmlwRm9yRW1pc3Npb24oXG4gICAgICAgICAgc3RyaXBSZWRpcmVjdHMoYXJndk9mKGV4cGFuZFZhcmlhYmxlcyhpdGVtLnRleHQsIGl0ZW0uYXNzaWdubWVudHMsIHN0YWdlRW52KSkgPz8gW10pXG4gICAgICAgICk7XG4gICAgICAgIGNvbnN0IHRhcmdldCA9IGV4cGFuZGVkQXJndlsxXTtcbiAgICAgICAgaWYgKHRhcmdldCA9PT0gdW5kZWZpbmVkIHx8IHRhcmdldCA9PT0gJ34nIHx8IHRhcmdldC5zdGFydHNXaXRoKCd+LycpKSB7XG4gICAgICAgICAgLy8gQmFyZSBgY2RgIGlzIGAkSE9NRWA7IGEgYH5gL2B+L1x1MjAyNmAgdGFyZ2V0IGlzIHRoZSBzYW1lIHRpbGRlXG4gICAgICAgICAgLy8gZXhwYW5zaW9uIChwbGFuIFx1MDBBNzYpIFx1MjAxNCB0aGUgYWxsb3dsaXN0ZWQgSE9NRSB2aWEgdGhlIGV4cGFuc2lvblxuICAgICAgICAgIC8vIG1hY2hpbmVyeSwgY2VydGFpbiB3aGVuIGl0IHJlc29sdmVzLCB1bmNlcnRhaW4gb3RoZXJ3aXNlLlxuICAgICAgICAgIGNvbnN0IGhvbWUgPSBleHBhbmRWYXJpYWJsZXMoJyRIT01FJywgaXRlbS5hc3NpZ25tZW50cywgc3RhZ2VFbnYpO1xuICAgICAgICAgIGlmIChsb29rc1VucmVzb2x2YWJsZShob21lKSkgZnJhbWUuY2VydGFpbiA9IGZhbHNlO1xuICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgZnJhbWUucHJldiA9IGZyYW1lLmRpcjtcbiAgICAgICAgICAgIGZyYW1lLmRpciA9IHJlc29sdmVQYXRoKGZyYW1lLmRpciwgdGFyZ2V0ID09PSB1bmRlZmluZWQgPyBob21lIDogaG9tZSArIHRhcmdldC5zbGljZSgxKSk7XG4gICAgICAgICAgICBmcmFtZS5jZXJ0YWluID0gdHJ1ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAodGFyZ2V0ID09PSAnLScpIHtcbiAgICAgICAgICAvLyBgY2QgLWAgaXMgYmFzaCdzIE9MRFBXRCBcdTIwMTQgdGhlIHByZXZpb3VzIHRyYWNrZWQgcGF0aC4gV2l0aCBub1xuICAgICAgICAgIC8vIHByZXZpb3VzIHBhdGggdGhlIGNkIGZhaWxzIGFuZCB0aGUgc2hlbGwgc3RheXMgcHV0LlxuICAgICAgICAgIGlmIChmcmFtZS5wcmV2ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGNvbnN0IG9sZCA9IGZyYW1lLmRpcjtcbiAgICAgICAgICAgIGZyYW1lLmRpciA9IGZyYW1lLnByZXY7XG4gICAgICAgICAgICBmcmFtZS5wcmV2ID0gb2xkO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmICh0YXJnZXQuc3RhcnRzV2l0aCgnficpKSB7XG4gICAgICAgICAgLy8gQSBgfnVzZXJgLXN0eWxlIHRhcmdldCByZXNvbHZlcyB0byB0aGF0IHVzZXIncyBob21lIFx1MjAxNCB1bmtub3duIHRvXG4gICAgICAgICAgLy8gdGhlIHdhbGs6IGJhc2ggbW92ZWQgdG8gYW4gdW5rbm93biBkaXIgb3IgZmFpbGVkIGFuZCBzdGF5ZWQsIGJvdGhcbiAgICAgICAgICAvLyBsaXZlLCBzbyBjZXJ0YWludHkgaXMgcG9pc29uZWQuXG4gICAgICAgICAgZnJhbWUuY2VydGFpbiA9IGZhbHNlO1xuICAgICAgICB9IGVsc2UgaWYgKGxvb2tzVW5yZXNvbHZhYmxlKHRhcmdldCkpIHtcbiAgICAgICAgICAvLyBWYXJpYWJsZS9nbG9iIHRhcmdldDogYmFzaCBlaXRoZXIgbW92ZWQgdG8gYW4gdW5rbm93biBkaXIgb3JcbiAgICAgICAgICAvLyBmYWlsZWQgYW5kIHN0YXllZCBcdTIwMTQgYm90aCBsaXZlLCBzbyBjZXJ0YWludHkgaXMgcG9pc29uZWQuXG4gICAgICAgICAgZnJhbWUuY2VydGFpbiA9IGZhbHNlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGZyYW1lLnByZXYgPSBmcmFtZS5kaXI7XG4gICAgICAgICAgZnJhbWUuZGlyID0gcmVzb2x2ZVBhdGgoZnJhbWUuZGlyLCB0YXJnZXQpO1xuICAgICAgICAgIGZyYW1lLmNlcnRhaW4gPSB0cnVlO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKGl0ZW0uZXhlYyA9PT0gJ3Vua25vd24nKSB7XG4gICAgICAgIGZyYW1lLmNlcnRhaW4gPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlOyAvLyBhIGNkIG5ldmVyIG1hdGNoZXMgYSBzb3VyY2UvY29uc3VtZXIgaWRpb21cbiAgICB9XG5cbiAgICBpZiAoaXRlbS5leGVjICE9PSAneWVzJykge1xuICAgICAgLy8gQSBkZWFkIG9yIHVua25vd24gc3RhZ2UgbmV2ZXIgcnVucyBcdTIwMTQgbm8gdG91Y2gsIG5vIHNpZGUgZWZmZWN0cy5cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGhlcmVkb2NSZWYgPSBpdGVtLnRleHQubWF0Y2goL15fX2hlcmVkb2NfKFxcZCspX18kLyk7XG4gICAgaWYgKGhlcmVkb2NSZWYpIHtcbiAgICAgIC8vIFRoZSBoZXJlZG9jLXdyaXRlIHN0YWdlIGRvZXNuJ3QgcmVhZCB0aGUgcGlwZSBcdTIwMTQgYWxpZ25tZW50IHNldmVycy5cbiAgICAgIGlmICh3aW5kb3cgIT09IG51bGwpIHtcbiAgICAgICAgZW1pdFdpbmRvd1RvdWNoKHdpbmRvdyk7XG4gICAgICAgIHdpbmRvdyA9IG51bGw7XG4gICAgICB9XG4gICAgICBjb25zdCB3ID0gaGVyZWRvY1dyaXRlc1tOdW1iZXIucGFyc2VJbnQoaGVyZWRvY1JlZlsxXSwgMTApXTtcbiAgICAgIGlmIChsb29rc1VucmVzb2x2YWJsZSh3LnRhcmdldCkpIHtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgICBpZGlvbTogJ2hlcmVkb2Mtd3JpdGUnLFxuICAgICAgICAgIGZpbGVBcmc6IHcudGFyZ2V0LFxuICAgICAgICAgIHJlYXNvbjogJ3BhdGggY29udGFpbnMgYW4gdW5leHBhbmRlZCBzaGVsbCB2YXJpYWJsZSBvciBnbG9iJ1xuICAgICAgICB9KTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoIWZyYW1lLmNlcnRhaW4gJiYgIWlzQWJzb2x1dGUody50YXJnZXQpKSB7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgaWRpb206ICdoZXJlZG9jLXdyaXRlJyxcbiAgICAgICAgICBmaWxlQXJnOiB3LnRhcmdldCxcbiAgICAgICAgICByZWFzb246ICd0aGUgd29ya2luZyBkaXJlY3RvcnkgaXMgdW5jZXJ0YWluIFx1MjAxNCB0aGUgcmVsYXRpdmUgcGF0aCBjYW5ub3QgYmUgcmVzb2x2ZWQnXG4gICAgICAgIH0pO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGFic29sdXRlUGF0aCA9IHJlc29sdmVQYXRoKGZyYW1lLmRpciwgdy50YXJnZXQpO1xuICAgICAgY29uc3QgYm9keUxpbmVzID0gdy5ib2R5Lmxlbmd0aCA9PT0gMCA/IDAgOiB3LmJvZHkuc3BsaXQoJ1xcbicpLmxlbmd0aDtcbiAgICAgIGlmIChib2R5TGluZXMgPT09IDApIHtcbiAgICAgICAgLy8gYGNhdCA+IGYgPDwnRU9GJ2Agd2l0aCBhbiBlbXB0eSBib2R5IHRydW5jYXRlcyB0aGUgZmlsZSB0byBlbXB0eSBcdTIwMTQgYVxuICAgICAgICAvLyByZWFsIHdyaXRlIHRoYXQgbXVzdCBwcm9kdWNlIGEgdG91Y2ggKHdob2xlLWZpbGUsIHZpYSBgYm9keTogJydgKS5cbiAgICAgICAgLy8gYD4+YCB3aXRoIGFuIGVtcHR5IGJvZHkgYXBwZW5kcyBub3RoaW5nIGFuZCBpcyBhIGdlbnVpbmUgbm8tb3AuXG4gICAgICAgIGlmICh3LnJlZGlyZWN0ICE9PSAnPicpIGNvbnRpbnVlO1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgICBpZGlvbTogJ2hlcmVkb2Mtd3JpdGUnLFxuICAgICAgICAgIHNwYW46IHsgbGluZVN0YXJ0OiAxLCBsaW5lRW5kOiAxLCBhYnNvbHV0ZVBhdGgsIGJvZHk6ICcnLCByZWRpcmVjdDogdy5yZWRpcmVjdCB9XG4gICAgICAgIH0pO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHNwZWM6IExpbmVSYW5nZVNwZWMgPVxuICAgICAgICB3LnJlZGlyZWN0ID09PSAnPicgPyB7IGtpbmQ6ICdsaXRlcmFsJywgc3RhcnQ6IDEsIGVuZDogYm9keUxpbmVzIH0gOiB7IGtpbmQ6ICdhcHBlbmRMaW5lcycsIGNvdW50OiBib2R5TGluZXMgfTtcbiAgICAgIGNvbnN0IHJhbmdlID0gcmVzb2x2ZVNwZWMoc3BlYywgY2FjaGVkRnNUb3RhbExpbmVzKGFic29sdXRlUGF0aCkpO1xuICAgICAgaWYgKHJhbmdlID09PSBudWxsKSB7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgaWRpb206ICdoZXJlZG9jLXdyaXRlJyxcbiAgICAgICAgICBmaWxlQXJnOiBhYnNvbHV0ZVBhdGgsXG4gICAgICAgICAgcmVhc29uOiAnYXBwZW5kIHRhcmdldDogY291bGQgbm90IHJlYWQgZXhpc3RpbmcgZmlsZSB0byBmaW5kIGl0cyBjdXJyZW50IGxlbmd0aCdcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIHN0YXR1czogJ3Jlc29sdmVkJyxcbiAgICAgICAgICBpZGlvbTogJ2hlcmVkb2Mtd3JpdGUnLFxuICAgICAgICAgIHNwYW46IHsgbGluZVN0YXJ0OiByYW5nZS5saW5lU3RhcnQsIGxpbmVFbmQ6IHJhbmdlLmxpbmVFbmQsIGFic29sdXRlUGF0aCwgYm9keTogdy5ib2R5LCByZWRpcmVjdDogdy5yZWRpcmVjdCB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gRGlzcGF0Y2ggYXJndiAocGxhbiBcdTAwQTc3KTogdGhlIHN0YWdlJ3MgcmF3IHRleHQgaXMgZXhwYW5kZWQgYmVmb3JlXG4gICAgLy8gdG9rZW5pemluZyBcdTIwMTQgYSByZXNvbHZlZCBgY2F0IFwiJFdPUktTUEFDRV9QQVRIL2ZcImAgbmFycm93cyB0aHJvdWdoIGFcbiAgICAvLyBwaXBlbGluZSBleGFjdGx5IGxpa2UgYGNhdCBmYC4gUmVkaXJlY3RzIGFyZSBzdHJpcHBlZCBmaXJzdCAodGhlXG4gICAgLy8gcmVhZC1zaWRlIHJlY292ZXJ5LCBcdTAwQTc0KSwgdGhlbiB0aGUgdHJhbnNwYXJlbnQgd3JhcHBlcnMgKFx1MDBBNzUpLCB0aGVuIHRoZVxuICAgIC8vIGVtaXNzaW9uLXNpZGUgYCFgL2Bjb21tYW5kYC9gZXhlY2Agc3RyaXAgXHUyMDE0IHNvIGBjb21tYW5kIC1wIHNlZCBcdTIwMjZgIHN0aWxsXG4gICAgLy8gcmVhY2hlcyBgc2VkYC5cbiAgICBjb25zdCByYXdBcmd2ID0gYXJndk9mKGV4cGFuZFZhcmlhYmxlcyhpdGVtLnRleHQsIGl0ZW0uYXNzaWdubWVudHMsIHN0YWdlRW52KSkgPz8gW107XG4gICAgY29uc3Qgc3RyaXBwZWQgPSBzdHJpcEZvckVtaXNzaW9uKHN0cmlwV3JhcHBlcnMoc3RyaXBSZWRpcmVjdHMocmF3QXJndikpKTtcbiAgICBpZiAoc3RyaXBwZWQubGVuZ3RoID09PSAwKSB7XG4gICAgICBpZiAod2luZG93ICE9PSBudWxsKSB7XG4gICAgICAgIGVtaXRXaW5kb3dUb3VjaCh3aW5kb3cpO1xuICAgICAgICB3aW5kb3cgPSBudWxsO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gQSByZXNpZHVhbCByZWRpcmVjdCB0b2tlbiAoYD58YCwgYW55dGhpbmcgZWxzZSBiZWdpbm5pbmcgd2l0aCBgPmAvYDxgXG4gICAgLy8gdGhhdCBzdHJpcFJlZGlyZWN0cyBsZWZ0IGFsb25lLCBcdTAwQTc0KSBmYWlscyBjbG9zZWQ6IHRoZSBzdGFnZSBtYXRjaGVzXG4gICAgLy8gbm90aGluZyBcdTIwMTQgbm8gc291cmNlLCBubyBzZWxlY3Rvciwgbm8gdG91Y2guXG4gICAgaWYgKHN0cmlwcGVkLnNvbWUoKHcpID0+IHcuc3RhcnRzV2l0aCgnPicpIHx8IHcuc3RhcnRzV2l0aCgnPCcpKSkge1xuICAgICAgaWYgKHdpbmRvdyAhPT0gbnVsbCkge1xuICAgICAgICBlbWl0V2luZG93VG91Y2god2luZG93KTtcbiAgICAgICAgd2luZG93ID0gbnVsbDtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIFRoZSBzb3VyY2Ugb2YgYSBwaXBlbGluZSBncm91cCAocGxhbiBcdTAwQTczKTogYSBuYXJyb3dhYmxlIGBjYXRgL2BubGAgb3JcbiAgICAvLyBgZ2l0IHNob3dgIG9wZW5zIHRoZSB3aW5kb3cgYW5kIGRlZmVycyBpdHMgd2hvbGUtZmlsZSByZWFkOyBhXG4gICAgLy8gbXVsdGktZmlsZS9zdGRpbi1taXhlZCBzb3VyY2UgZW1pdHMgZWFjaCBmaWxlJ3MgY29uc2VydmF0aXZlIHdob2xlLWZpbGVcbiAgICAvLyByZWFkIGFuZCBuZXZlciBuYXJyb3dzOyBhIHN0ZG91dC1mb3JtIHJlZGlyZWN0IG9uIHRoZSBzb3VyY2UgZW1wdGllc1xuICAgIC8vIHRoZSBwaXBlIFx1MjAxNCBpdHMgd2hvbGUtZmlsZSByZWFkIHN0YW5kcyBhbmQgZG93bnN0cmVhbSBjb25zdW1lcyBub3RoaW5nLlxuICAgIGlmICghcGlwZVByZWNlZGVzICYmIHBpcGVGb2xsb3dzICYmIChzdHJpcHBlZFswXSA9PT0gJ2NhdCcgfHwgc3RyaXBwZWRbMF0gPT09ICdubCcgfHwgc3RyaXBwZWRbMF0gPT09ICdnaXQnKSkge1xuICAgICAgY29uc3Qgc3JjID0gYW5hbHl6ZVNvdXJjZShzdHJpcHBlZCk7XG4gICAgICBzd2l0Y2ggKHNyYy5raW5kKSB7XG4gICAgICAgIGNhc2UgJ25vbmUnOlxuICAgICAgICAgIGJyZWFrOyAvLyBmYWxsIHRocm91Z2ggdG8gdGhlIG9yZGluYXJ5IGRpc3BhdGNoXG4gICAgICAgIGNhc2UgJ2dpdFVucmVzb2x2ZWQnOlxuICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICBzdGF0dXM6ICd1bnJlc29sdmVkJyxcbiAgICAgICAgICAgIGlkaW9tOiAnZ2l0LXNob3ctcmV2LXBhdGgnLFxuICAgICAgICAgICAgZmlsZUFyZzogc3JjLmZpbGVBcmcsXG4gICAgICAgICAgICByZWFzb246IHNyYy5yZWFzb25cbiAgICAgICAgICB9KTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgY2FzZSAndW5uYXJyb3dhYmxlJzoge1xuICAgICAgICAgIGZvciAoY29uc3QgZiBvZiBzcmMuZmlsZXMpIGVtaXRDYW5kaWRhdGUod2hvbGVGaWxlQ2FuZGlkYXRlKGYpLCBmcmFtZSk7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgY2FzZSAnbmFycm93YWJsZSc6XG4gICAgICAgIGNhc2UgJ2dpdCc6IHtcbiAgICAgICAgICBpZiAoaGFzU3Rkb3V0UmVkaXJlY3QocmF3QXJndikpIHtcbiAgICAgICAgICAgIGVtaXRDYW5kaWRhdGUoc291cmNlQ2FuZGlkYXRlKHNyYyksIGZyYW1lKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaW5pdFdpbmRvdyhzcmMsIGZyYW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBBIHBpcGUgbWVtYmVyIG9mIGEgbGl2ZSB3aW5kb3cgKHBsYW4gXHUwMEE3MywgY29uc3VtZXJzKTogYSBzdGRpblxuICAgIC8vIGxpbmUtc2VsZWN0b3IgdHJhbnNmb3JtcyB0aGUgd2luZG93IHdoaWxlIGFsaWduZWQ7IGEgbm9uLWNvbnN1bWVyIG9yXG4gICAgLy8gdW5yZWNvZ25pemVkIHN0YWdlIHNldmVycyBcdTIwMTQgdGhlIHRvdWNoIGlzIHRoZSB3aW5kb3cgYXQgdGhlIHNldmVyIHBvaW50XG4gICAgLy8gYW5kIGxhdGVyIHN0YWdlcyBhcmUgaWdub3JlZCBmb3Igd2luZG93IHB1cnBvc2VzLiBBIHN0ZG91dC1mb3JtXG4gICAgLy8gcmVkaXJlY3Qgb24gdGhlIHN0YWdlIG9ubHkgbW92ZXMgaXRzIG93biBvdXRwdXQgXHUyMDE0IGl0IHJlYWRzIG5vcm1hbGx5LFxuICAgIC8vIHRoZW4gc2V2ZXJzLlxuICAgIGlmIChwaXBlUHJlY2VkZXMgJiYgd2luZG93ICE9PSBudWxsKSB7XG4gICAgICBjb25zdCBzZWwgPSBjbGFzc2lmeVN0ZGluU2VsZWN0b3Ioc3RyaXBwZWQpO1xuICAgICAgaWYgKHNlbCAhPT0gbnVsbCkge1xuICAgICAgICBpZiAoc2VsLmtpbmQgPT09ICdzZWQnICYmIHNlbC5yYW5nZXMubGVuZ3RoID4gMSkge1xuICAgICAgICAgIGVtaXRNdWx0aVJhbmdlKHNlbC5yYW5nZXMpO1xuICAgICAgICAgIHdpbmRvdyA9IG51bGw7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYXBwbHlXaW5kb3dUcmFuc2Zvcm0oc2VsKTtcbiAgICAgICAgICBpZiAoaGFzU3Rkb3V0UmVkaXJlY3QocmF3QXJndikpIHtcbiAgICAgICAgICAgIGVtaXRXaW5kb3dUb3VjaCh3aW5kb3cpO1xuICAgICAgICAgICAgd2luZG93ID0gbnVsbDtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGVtaXRXaW5kb3dUb3VjaCh3aW5kb3cpO1xuICAgICAgICB3aW5kb3cgPSBudWxsO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIE9yZGluYXJ5IGRpc3BhdGNoOiBhIGNhdC9ubCBzdGFnZSdzIG93biB3aG9sZS1maWxlIHJlYWQgKGEgbG9uZSBzdGFnZVxuICAgIC8vIG9yIGEgbm9uLXNvdXJjZSBwaXBlIG1lbWJlciksIGFuZCB0aGUgbGluZS1zZWxlY3Rvci9naXQgaWRpb21zLlxuICAgIGlmIChzdHJpcHBlZFswXSA9PT0gJ2NhdCcgfHwgc3RyaXBwZWRbMF0gPT09ICdubCcpIHtcbiAgICAgIGNvbnN0IHNyYyA9IGFuYWx5emVTb3VyY2Uoc3RyaXBwZWQpO1xuICAgICAgaWYgKHNyYy5raW5kID09PSAnbmFycm93YWJsZScpIHtcbiAgICAgICAgZW1pdENhbmRpZGF0ZSh3aG9sZUZpbGVDYW5kaWRhdGUoeyBmaWxlQXJnOiBzcmMuZmlsZUFyZywgaWRpb206IHNyYy5pZGlvbSB9KSwgZnJhbWUpO1xuICAgICAgfSBlbHNlIGlmIChzcmMua2luZCA9PT0gJ3VubmFycm93YWJsZScpIHtcbiAgICAgICAgZm9yIChjb25zdCBmIG9mIHNyYy5maWxlcykgZW1pdENhbmRpZGF0ZSh3aG9sZUZpbGVDYW5kaWRhdGUoZiksIGZyYW1lKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgZm9yIChjb25zdCBtYXRjaGVyIG9mIFsuLi5MSU5FX1NFTEVDVE9SUywgbWF0Y2hHaXRTaG93LCBtYXRjaEdpdExvZ0xdKSB7XG4gICAgICAgIGZvciAoY29uc3Qgb3V0Y29tZSBvZiBtYXRjaGVyKHN0cmlwcGVkKSkge1xuICAgICAgICAgIGlmIChvdXRjb21lLmtpbmQgPT09ICd1bnJlc29sdmVkJykge1xuICAgICAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICAgICAgc3RhdHVzOiAndW5yZXNvbHZlZCcsXG4gICAgICAgICAgICAgIGlkaW9tOiBvdXRjb21lLmlkaW9tLFxuICAgICAgICAgICAgICBmaWxlQXJnOiBvdXRjb21lLmZpbGVBcmcsXG4gICAgICAgICAgICAgIHJlYXNvbjogb3V0Y29tZS5yZWFzb25cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBlbWl0Q2FuZGlkYXRlKG91dGNvbWUsIGZyYW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBpZiAod2luZG93ICE9PSBudWxsKSB7XG4gICAgZW1pdFdpbmRvd1RvdWNoKHdpbmRvdyk7XG4gIH1cblxuICByZXR1cm4gcmVzdWx0cztcbn1cblxuLyoqIFBhcnNlcyBhIEJhc2ggYGNvbW1hbmRgIHN0cmluZyBpbnRvIHRoZSBmaWxlK2xpbmUtcmFuZ2Ugc3BhbnMgaXQgc3RhdGljYWxseSwgcmVsaWFibHkgcmVhZHMgb3Igd3JpdGVzLiBQYXNzIGBvcHRzLmN3ZGAgKGRlZmF1bHRzIHRvIGBwcm9jZXNzLmN3ZCgpYCkgZm9yIGNvcnJlY3QgcmVzb2x1dGlvbiBvZiByZWxhdGl2ZSBwYXRocyBhbmQgYGNkYC9gZ2l0IC1DYCB0YXJnZXRzLCBhbmQgb2YgYGdpdCBzaG93YC9gZ2l0IGxvZyAtTGAgcmV2aXNpb25zOyBgb3B0cy5lbnZgL2BvcHRzLmFsbG93bGlzdGAgZmVlZCB0aGUgUGhhc2UgMyBhbGxvd2xpc3RlZCB2YXJpYWJsZSByZXNvbHV0aW9uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQ29tbWFuZChjb21tYW5kOiBzdHJpbmcsIG9wdHM6IFBhcnNlT3B0aW9ucyA9IHt9KTogUmVzb2x2ZWRTcGFuW10ge1xuICBjb25zdCBkZXRhaWxlZCA9IHBhcnNlQ29tbWFuZERldGFpbGVkKGNvbW1hbmQsIG9wdHMpO1xuICBjb25zdCBzcGFuczogUmVzb2x2ZWRTcGFuW10gPSBbXTtcbiAgZm9yIChjb25zdCBtIG9mIGRldGFpbGVkKSB7XG4gICAgaWYgKG0uc3RhdHVzID09PSAncmVzb2x2ZWQnKSBzcGFucy5wdXNoKG0uc3Bhbik7XG4gIH1cbiAgcmV0dXJuIHNwYW5zO1xufVxuIiwgIi8qKlxuICogVGhlIG9ubHkgaW1wdXJlIGJpdHM6IGNvdW50aW5nIGxpbmVzIG9mIGEgd29ya2luZy10cmVlIGZpbGUsIGFuZCBvZiBhIGZpbGVcbiAqIGFzIGl0IGV4aXN0ZWQgYXQgYSBnaXZlbiBnaXQgcmV2aXNpb24uIEJvdGggcmV0dXJuIG51bGwgb24gYW55IGZhaWx1cmVcbiAqIChtaXNzaW5nIGZpbGUsIGJhZCByZXYsIG5vdCBhIGdpdCByZXBvLCBldGMuKSBpbnN0ZWFkIG9mIHRocm93aW5nIFx1MjAxNCBhXG4gKiBjb21tYW5kIHRoYXQgc3RhdGljYWxseSBtYXRjaGVkIGFuIGlkaW9tIGJ1dCBwb2ludHMgYXQgc29tZXRoaW5nIHRoaXNcbiAqIG1hY2hpbmUgY2FuJ3QgY3VycmVudGx5IHJlc29sdmUgaXMgYSBub3JtYWwsIGV4cGVjdGVkIG91dGNvbWUsIG5vdCBhIGJ1Zy5cbiAqL1xuaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IHJlYWRGaWxlU3luYywgc3RhdFN5bmMgfSBmcm9tICdub2RlOmZzJztcblxuLyoqIE51bWJlciBvZiBsaW5lcyBpbiBhIHdvcmtpbmctdHJlZSBmaWxlLCBvciBudWxsIGlmIGl0IGNhbid0IGJlIHJlYWQuIFRyYWlsaW5nIG5ld2xpbmUgZG9lcyBub3QgY291bnQgYXMgYW4gZXh0cmEgZW1wdHkgbGluZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb3VudEZpbGVMaW5lcyhhYnNvbHV0ZVBhdGg6IHN0cmluZyk6IG51bWJlciB8IG51bGwge1xuICB0cnkge1xuICAgIGlmICghc3RhdFN5bmMoYWJzb2x1dGVQYXRoKS5pc0ZpbGUoKSkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgY29udGVudCA9IHJlYWRGaWxlU3luYyhhYnNvbHV0ZVBhdGgsICd1dGY4Jyk7XG4gICAgaWYgKGNvbnRlbnQubGVuZ3RoID09PSAwKSByZXR1cm4gMDtcbiAgICBjb25zdCB3aXRob3V0VHJhaWxpbmdOZXdsaW5lID0gY29udGVudC5lbmRzV2l0aCgnXFxuJykgPyBjb250ZW50LnNsaWNlKDAsIC0xKSA6IGNvbnRlbnQ7XG4gICAgcmV0dXJuIHdpdGhvdXRUcmFpbGluZ05ld2xpbmUuc3BsaXQoJ1xcbicpLmxlbmd0aDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqIE51bWJlciBvZiBsaW5lcyBpbiBgcGF0aGAgYXMgaXQgZXhpc3RzIGF0IGByZXZgLCBydW4gZnJvbSBgY3dkYCwgb3IgbnVsbCBpZiB0aGUgcmV2L3BhdGgvcmVwbyBkb2Vzbid0IHJlc29sdmUuICovXG5leHBvcnQgZnVuY3Rpb24gY291bnRHaXRCbG9iTGluZXMoY3dkOiBzdHJpbmcsIHJldjogc3RyaW5nLCBwYXRoOiBzdHJpbmcpOiBudW1iZXIgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBvdXQgPSBleGVjRmlsZVN5bmMoJ2dpdCcsIFsnc2hvdycsIGAke3Jldn06JHtwYXRofWBdLCB7XG4gICAgICBjd2QsXG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ11cbiAgICB9KTtcbiAgICBpZiAob3V0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuIDA7XG4gICAgY29uc3Qgd2l0aG91dFRyYWlsaW5nTmV3bGluZSA9IG91dC5lbmRzV2l0aCgnXFxuJykgPyBvdXQuc2xpY2UoMCwgLTEpIDogb3V0O1xuICAgIHJldHVybiB3aXRob3V0VHJhaWxpbmdOZXdsaW5lLnNwbGl0KCdcXG4nKS5sZW5ndGg7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG4iLCAiLyoqXG4gKiBIZXVyaXN0aWMsIGRlcGVuZGVuY3ktZnJlZSBzaGVsbCBzcGxpdHRpbmcuIE5vdCBhIGZ1bGwgc2hlbGwgcGFyc2VyIFx1MjAxNCBnb29kXG4gKiBlbm91Z2ggdG8gbG9jYXRlIHNpbXBsZSBjb21tYW5kcyAoYW5kIHRoZWlyIGFyZ3YpIGluc2lkZSBhIGxhcmdlclxuICogJiYvfHwvOy98LWpvaW5lZCBCYXNoIHN0cmluZyB3aXRob3V0IHB1bGxpbmcgaW4gYSByZWFsIGJhc2ggQVNUIHBhcnNlci5cbiAqIFZhbGlkYXRlZCBkdXJpbmcgcmVzZWFyY2ggYWdhaW5zdCBiYXNobGV4IG9uIHRoZSByZWFsIHRyYW5zY3JpcHQgY29ycHVzO1xuICogdGhpcyBwb3J0cyB0aGUgc2FtZSBhbGdvcml0aG0uXG4gKi9cblxuLyoqXG4gKiBUaGUgbm9ybWFsaXplZCBib3VuZGFyeSBvcGVyYXRvcnMgYHNwbGl0VG9wTGV2ZWxgIGVtaXRzIFx1MjAxNCB0aGUgc2luZ2xlXG4gKiByZXByZXNlbnRhdGlvbiBib3RoIGFkYXB0ZXJzIGNvbnN1bWUuXG4gKi9cbmV4cG9ydCB0eXBlIE9wZXJhdG9yID0gJ3BpcGUnIHwgJ2FuZCcgfCAnb3InIHwgJ3NlbWljb2xvbicgfCAnbmV3bGluZScgfCAnYmFja2dyb3VuZCcgfCAnc3RhcnQnO1xuXG4vKiogT25lIGBzaW1wbGUgY29tbWFuZGAgZm91bmQgaW4gYSBsYXJnZXIgc2NyaXB0LCBwbHVzIHdoaWNoIG9wZXJhdG9yIHByZWNlZGVkIGl0LiAqL1xuZXhwb3J0IGludGVyZmFjZSBTaW1wbGVDb21tYW5kIHtcbiAgdGV4dDogc3RyaW5nO1xuICAvKiogVGhlIG9wZXJhdG9yIGltbWVkaWF0ZWx5IGJlZm9yZSB0aGlzIGNvbW1hbmQgKCdwaXBlJyBmb3IgYSBwaXBlbGluZSBzdGFnZSwgJ2FuZCcgZm9yIGAmJmAsICdvcicgZm9yIGB8fGAsICdzZW1pY29sb24nIGZvciBgO2AsICduZXdsaW5lJyBmb3IgYSBuZXdsaW5lIHNlcGFyYXRvciwgJ2JhY2tncm91bmQnIGZvciBgJmAsIG9yICdzdGFydCcgZm9yIHRoZSBmaXJzdCBjb21tYW5kKS4gKi9cbiAgcHJlY2VkZWRCeTogT3BlcmF0b3I7XG59XG5cbi8qKiBUaGUgdmVyZGljdCBraW5kcyBgc3BsaXRUb3BMZXZlbGAgY2FuIHJldHVybiB3aGVuIHRoZSBpbnB1dCBpcyBhIEJhc2ggcGFyc2UgZXJyb3IgKHBsYW4gXHUwMEE3MSkuICovXG5leHBvcnQgdHlwZSBNYWxmb3JtZWRWZXJkaWN0ID1cbiAgfCAndW5jbG9zZWQtcXVvdGUnXG4gIHwgJ3VuYmFsYW5jZWQtcGFyZW4nXG4gIHwgJ2RhbmdsaW5nLW9wZXJhdG9yJ1xuICB8ICdwaXBlLWJhbmcnXG4gIHwgJ3VudGVybWluYXRlZC1oZXJlZG9jJ1xuICB8ICd1bmNsb3NlZC1icmFjZSdcbiAgfCAndW5jbG9zZWQtY2FzZSdcbiAgfCAndW5jbG9zZWQtY29uc3RydWN0JztcblxuLyoqIFRoZSByZXN1bHQgb2YgYSB0b3AtbGV2ZWwgc3BsaXQ6IHRoZSBzdGFnZSBsaXN0LCBwbHVzIGEgYG1hbGZvcm1lZGAgdmVyZGljdCB3aGVuIHRoZSBpbnB1dCBpcyBhIEJhc2ggcGFyc2UgZXJyb3IuICovXG5leHBvcnQgaW50ZXJmYWNlIFNwbGl0UmVzdWx0IHtcbiAgc3RhZ2VzOiBTaW1wbGVDb21tYW5kW107XG4gIC8qKlxuICAgKiBTZXQgd2hlbiB0aGUgaW5wdXQgaXMgYSBCYXNoIHBhcnNlIGVycm9yIFx1MjAxNCBiYXNoIHJlamVjdHMgdGhlIGVudGlyZSBsaXN0IGF0XG4gICAqIHBhcnNlIHRpbWUgKGV4aXQgMiwgbm90aGluZyBleGVjdXRlZCksIHNvIGFueSBzdGFnZS1kZXJpdmVkIHRvdWNoIHdvdWxkIGJlXG4gICAqIGEgcGhhbnRvbS4gVGhlIHJlamVjdGlvbiBpcyBsaXN0LXNjb3BlZCBhbmQgdGVybWluYWwgKHBsYW4gXHUwMEE3MSk6IHRoZSBzdGFnZVxuICAgKiBsaXN0IGtlZXBzIGV2ZXJ5IHN0YWdlIGZyb20gY29tcGxldGVkIGVhcmxpZXIgbGlzdHMsIGRyb3BzIHRoZSByZWplY3RpbmdcbiAgICogbGlzdCdzIG93biBzdGFnZXMsIGFuZCBzdG9wcyBhdCBpdCBcdTIwMTQgZXZlcnkgbGF0ZXIgdW5pdCBpcyBkZWFkLlxuICAgKi9cbiAgbWFsZm9ybWVkPzogTWFsZm9ybWVkVmVyZGljdDtcbn1cblxuLyoqIFRoZSBjb25zdHJ1Y3Qga2luZHMgdGhlIGtpbmQtbWF0Y2hlZCBzdGFjayB0cmFja3MgKHBsYW4gXHUwMEE3MykuICovXG50eXBlIENvbnN0cnVjdEtpbmQgPSAnaWYnIHwgJ2xvb3AnIHwgJ2ZvcicgfCAnc2VsZWN0JyB8ICdicmFjZSc7XG5cbi8qKiBPbmUgb3BlbiBjb25zdHJ1Y3Q6IGl0cyBraW5kLCBhbmQgd2hldGhlciBhIGJvZHkgd29yZCBoYXMgYmVlbiBzZWVuLiAqL1xuaW50ZXJmYWNlIE9wZW5Db25zdHJ1Y3Qge1xuICBraW5kOiBDb25zdHJ1Y3RLaW5kO1xuICAvKipcbiAgICogV2hldGhlciBhIGJvZHkgaGFzIHN0YXJ0ZWQuIEZvciBgaWZgIHRoZSBib2R5IHN0YXJ0cyBhdCBgdGhlbmAvYGVsc2VgL1xuICAgKiBgZWxpZmAsIGZvciBsb29wcyBhdCBgZG9gLCBmb3IgYnJhY2UgZ3JvdXBzIGF0IGFueSBjb21tYW5kIHdvcmQgXHUyMDE0IGFcbiAgICogY2xvc2VyIHdpdGggbm8gYm9keSAoYGlmIHg7IGZpYCwgYHsgfWApIGlzIGEgQmFzaCBwYXJzZSBlcnJvci5cbiAgICovXG4gIGJvZHk6IGJvb2xlYW47XG59XG5cbi8qKiBUaGUgY2FzZSByZWdpb24ncyBwb3NpdGlvbiBzdGF0ZSAocGxhbiBcdTAwQTczKS4gKi9cbnR5cGUgQ2FzZVBvcyA9ICdzdWJqZWN0JyB8ICdwYXR0ZXJuLXN0YXJ0JyB8ICdwYXR0ZXJuJyB8ICdjb21tYW5kJztcblxuLyoqIEFuIG9wZW4gY2FzZSByZWdpb246IG9wYXF1ZSBjb250ZW50IG93bmVkIGJ5IHRoZSBjYXNlIHNjYW4uICovXG5pbnRlcmZhY2UgQ2FzZVJlZ2lvbiB7XG4gIHBvczogQ2FzZVBvcztcbiAgLyoqIEluIGEgYGNvbW1hbmRgIHBvc2l0aW9uOiB3aGV0aGVyIHRoZSBjdXJyZW50IGxpc3QgaXRlbSBpcyBzdGlsbCBlbXB0eSAob25seSBgKWAsIGA7YCwgYCZgLCBhbmQgbmV3bGluZXMgcmVzZXQgaXQpLiAqL1xuICBjbWRFbXB0eTogYm9vbGVhbjtcbiAgLyoqIFRoZSByZWdpb24ncyBvd24gcGFyZW4gZGVwdGggXHUyMDE0IGdsb2JhbCBwYXJlbiBkZXB0aCBpcyBmcm96ZW4gd2hpbGUgdGhlIHJlZ2lvbiBpcyBvcGVuICh0aGUgcmVnaW9uIGlzIG5vdCBhIHN0YWNrOyBpdCBvdXRsaXZlcyBwYXJlbiBjbG9zZXMpLiAqL1xuICBsb2NhbERlcHRoOiBudW1iZXI7XG59XG5cbi8qKiBBIHBlbmRpbmcgaGVyZWRvYyB3aG9zZSBib2R5IGhhcyBub3Qgc3RhcnRlZCB5ZXQgKG9yIHdob3NlIGJvZHkgaXMgYmVpbmcgc2Nhbm5lZCkuICovXG5pbnRlcmZhY2UgUGVuZGluZ0hlcmVkb2Mge1xuICAvKiogVGhlIGxpbmUgdGhhdCBjbG9zZXMgdGhlIGJvZHk6IHRoZSBkZWxpbWl0ZXIsIG9wdGlvbmFsbHkgYFxcdGAtcHJlZml4ZWQgZm9yIGA8PC1gLCB3aXRoIG9wdGlvbmFsIHRyYWlsaW5nIHdoaXRlc3BhY2UuICovXG4gIGNsb3NlOiBSZWdFeHA7XG59XG5cbi8qKiBUaGUgd29yZHMgdGhhdCBwdXQgdGhlIHBhcnNlciBiYWNrIGF0IGNvbW1hbmQgc3RhcnQgd2hlbiB0aGV5IGFyZSB0aGUgYnVmZmVyJ3MgbGFzdCB3b3JkIChwbGFuIFx1MDBBNzMpLiAqL1xuY29uc3QgQ09NTUFORF9PUEVORVJfV09SRFMgPSBuZXcgU2V0KFsnZG8nLCAndGhlbicsICdlbHNlJywgJ2VsaWYnLCAnaWYnLCAnd2hpbGUnLCAndW50aWwnLCAnIScsICd0aW1lJywgJ3snLCAnKCddKTtcblxuLyoqIFdvcmQgY2hhcnMgZW5kIGF0IHdoaXRlc3BhY2UgYW5kIHRoZSBvcGVyYXRvci9wYXJlbi9yZWRpcmVjdCBtZXRhY2hhcnMuICovXG5jb25zdCBXT1JEX0VORCA9IC9bXFxzOyZ8KCk8Pl0vO1xuXG5mdW5jdGlvbiBlc2NhcGVSZWdFeHAoczogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHMucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcbn1cblxuLyoqXG4gKiBTcGxpdCBhIGNvbW1hbmQgc3RyaW5nIGludG8gc2ltcGxlLWNvbW1hbmQgc3Vic3RyaW5ncyBhdCB0b3AtbGV2ZWwgJiYsIHx8LFxuICogOywgfCwgfCYsICYsIGFuZCBuZXdsaW5lIGJvdW5kYXJpZXMuIFF1b3RlcyBhbmQgJCgpL2BgLygpIG5lc3RpbmcgYXJlXG4gKiByZXNwZWN0ZWQgKG5vdCBzcGxpdCBpbnNpZGUpOyBgI2AgY29tbWVudHMgYW5kIGAke1x1MjAyNn1gIGJyYWNlIGNvbnRlbnQgYXJlXG4gKiBvcGFxdWUsIHBpcGUvYW5kL29yIG5ld2xpbmVzIGFyZSBsaW5lIGNvbnRpbnVhdGlvbnMsIGFuZCBCYXNoIHBhcnNlIGVycm9yc1xuICogKHBsYW4gXHUwMEE3MSkgY29tZSBiYWNrIGFzIGEgYG1hbGZvcm1lZGAgdmVyZGljdCB3aXRoIHRoZSBzdGFnZSBsaXN0IHRydW5jYXRlZFxuICogYXQgdGhlIHJlamVjdGluZyBsaXN0LlxuICpcbiAqIFBoYXNlIDIgKHBsYW4gXHUwMEE3MykgYWRkcyB0aHJlZSBtYWNoaW5lczpcbiAqXG4gKiAtIFRoZSBraW5kLW1hdGNoZWQgY29uc3RydWN0IHN0YWNrOiBgaWZgL2B3aGlsZWAvYHVudGlsYC9gZm9yYC9gc2VsZWN0YC9cbiAqICAgYHtgL2B9YC9gZnVuY3Rpb25gIG9wZW4gY29uc3RydWN0IGZyYW1lcyBhdCBjb21tYW5kIHBvc2l0aW9uLCBjb250ZXh0XG4gKiAgIGtleXdvcmRzIChgZG9gLCBgdGhlbmAsIGBlbHNlYCwgYGVsaWZgLCBgaW5gKSBhbmQgY2xvc2VycyAoYGZpYCwgYGRvbmVgLFxuICogICBgZXNhY2AsIGB9YCkgcmVxdWlyZSBhIG1hdGNoaW5nIG9wZW5lciBvbiB0b3Agb2YgdGhlIHN0YWNrICh3aXRoIHRoZVxuICogICByaWdodCBib2R5IHN0YXRlKSwgYW5kIHdoaWxlIGEgY29uc3RydWN0IGlzIG9wZW4gYXQgZGVwdGggMCB0aGUgYm91bmRhcnlcbiAqICAgb3BlcmF0b3JzIGFyZSB0ZXh0IFx1MjAxNCB0aGUgY29uc3RydWN0IGZvbGRzIHRvIG9uZSBzdGFnZS4gRWFjaCBgKGAgcHVzaGVzIGFcbiAqICAgZnJlc2ggc3RhY2sgYW5kIGVhY2ggYClgIGZpcmVzICd1bmNsb3NlZC1jb25zdHJ1Y3QnIHdoZW4gaXRzIGxldmVsIGlzXG4gKiAgIG5vbi1lbXB0eSAoZmlyZS1iZWZvcmUtcmVzdG9yZSkuXG4gKlxuICogLSBUaGUgY2FzZS1yZWdpb24gbWFjaGluZTogYGNhc2VgIGluIGNvbW1hbmQgcG9zaXRpb24gb3BlbnMgYSByZWdpb24gY2xvc2VkXG4gKiAgIGJ5IGEgbWF0Y2hpbmcgYGVzYWNgLiBUaGUgcmVnaW9uJ3MgY29udGVudCBpcyBvcGFxdWUgXHUyMDE0IHBhdHRlcm4gYClgcyBhbmRcbiAqICAgYHxgcyBhcmUgcGF0dGVybiBzeW50YXgsIG5vdCBwYXJlbnMvcGlwZXMgXHUyMDE0IHdpdGggaXRzIG93biBwYXJlbiBkZXB0aFxuICogICAodGhlIGdsb2JhbCBkZXB0aCBmcmVlemVzIHdoaWxlIG9wZW4pLCBgOztgL2A7JmAvYDs7JmAgcmV0dXJuaW5nIHRvXG4gKiAgIHBhdHRlcm4tc3RhcnQgYW5kIGApYCwgYDtgLCBgJmAsIGFuZCBuZXdsaW5lcyB0byBjb21tYW5kIHN0YXJ0LiBBIHJlZ2lvblxuICogICBvcGVuIGF0IEVPRiBpcyAndW5jbG9zZWQtY2FzZScuXG4gKlxuICogLSBUaGUgaGVyZWRvYyBtYWNoaW5lcnk6IGA8PGAvYDw8LWAgYXQgZGVwdGggMCB3aXRoIGEgZGVsaW1pdGVyIHdvcmQgc3RyaXBzXG4gKiAgIHRoZSBvcGVyYXRvcitkZWxpbWl0ZXIgZnJvbSB0aGUgc3RhZ2UgdGV4dCBhbmQgc2NhbnMgYm9keSBsaW5lcyByYXcgdW50aWxcbiAqICAgdGhlIGRlbGltaXRlciBsaW5lOyBhbiB1bnRlcm1pbmF0ZWQgaGVyZWRvYyBpcyB0aGUgJ3VudGVybWluYXRlZC1oZXJlZG9jJ1xuICogICBwYXJ0aWFsIFx1MjAxNCB0aGUgZGVsaW1pdGVyJ3MgbGluZSAoYW5kIGV2ZXJ5dGhpbmcgYmVmb3JlIGl0KSBhbmFseXplc1xuICogICBub3JtYWxseSBhbmQgdGhlIGJvZHkgcHJvZHVjZXMgbm8gc3RhZ2VzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3BsaXRUb3BMZXZlbChjbWQ6IHN0cmluZyk6IFNwbGl0UmVzdWx0IHtcbiAgY29uc3QgcGFydHM6IFNpbXBsZUNvbW1hbmRbXSA9IFtdO1xuICBsZXQgYnVmID0gJyc7XG4gIGxldCBpID0gMDtcbiAgY29uc3QgbiA9IGNtZC5sZW5ndGg7XG4gIGxldCBkZXB0aCA9IDA7XG4gIGxldCBicmFjZURlcHRoID0gMDtcbiAgbGV0IGluU3F1b3RlID0gZmFsc2U7XG4gIGxldCBpbkRxdW90ZSA9IGZhbHNlO1xuICBsZXQgcGVuZGluZ09wOiBPcGVyYXRvciA9ICdzdGFydCc7XG4gIC8qKiBTZXQgd2hlbiB0aGUgY3VycmVudCBsaXN0IGlzIGEgQmFzaCBwYXJzZSBlcnJvcjsgdGhlIHNjYW4gc3RvcHMgYXQgaXQgKHBsYW4gXHUwMEE3MSwgbGlzdC1zY29wZSArIHRlcm1pbmFsKS4gKi9cbiAgbGV0IG1hbGZvcm1lZDogTWFsZm9ybWVkVmVyZGljdCB8IHVuZGVmaW5lZDtcbiAgLyoqIEluZGV4IGludG8gYHBhcnRzYCB3aGVyZSB0aGUgY3VycmVudCBsaXN0IGJlZ2FuIFx1MjAxNCB0aGUgcmVqZWN0aW5nIGxpc3QncyBzdGFnZXMgYXJlIGRyb3BwZWQgYnkgcm9sbGluZyBiYWNrIHRvIGl0LiAqL1xuICBsZXQgbGlzdFN0YXJ0ID0gMDtcblxuICAvKiogUmVwb3J0IGEgbWFsZm9ybWVkIGxpc3Q6IGRyb3AgaXRzIHN0YWdlcyAoY29tcGxldGVkIGVhcmxpZXIgbGlzdHMgc3RheSksIGFuZCBzdG9wIHRoZSBzY2FuIFx1MjAxNCBiYXNoIGFib3J0cyBhdCB0aGUgZmlyc3QgcGFyc2UgZXJyb3IuICovXG4gIGNvbnN0IHJlamVjdCA9ICh2OiBNYWxmb3JtZWRWZXJkaWN0KSA9PiB7XG4gICAgbWFsZm9ybWVkID0gdjtcbiAgICBwYXJ0cy5sZW5ndGggPSBsaXN0U3RhcnQ7XG4gICAgaSA9IG47XG4gIH07XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYSBwaXBlL2FuZC9vciBvcGVyYXRvciBpcyBwZW5kaW5nIHdpdGggYSB3aGl0ZXNwYWNlLW9ubHkgYnVmZmVyXG4gICAqIHNpbmNlIGl0LiBBIGhlbHBlciByYXRoZXIgdGhhbiBhbiBpbmxpbmUgY29tcGFyaXNvbjogVHlwZVNjcmlwdCdzXG4gICAqIGNvbnRyb2wtZmxvdyBuYXJyb3dpbmcgY2Fubm90IHNlZSB0aGUgYXNzaWdubWVudHMgYGZsdXNoYCBtYWtlcyB0b1xuICAgKiBgcGVuZGluZ09wYCBmcm9tIGluc2lkZSBpdHMgY2xvc3VyZSwgYW5kIHdvdWxkIG90aGVyd2lzZSBuYXJyb3cgdGhlXG4gICAqIGRpcmVjdCBjb21wYXJpc29uIHRvIHRoZSBpbml0aWFsaXplciBgJ3N0YXJ0J2AuXG4gICAqL1xuICBjb25zdCBpc1VuY29uc3VtZWRPcGVyYXRvciA9ICgpOiBib29sZWFuID0+XG4gICAgKHBlbmRpbmdPcCA9PT0gJ3BpcGUnIHx8IHBlbmRpbmdPcCA9PT0gJ2FuZCcgfHwgcGVuZGluZ09wID09PSAnb3InKSAmJiBidWYudHJpbSgpID09PSAnJztcblxuICAvKiogVGhlIGJ1ZmZlcidzIGxhc3Qgd2hpdGVzcGFjZS1kZWxpbWl0ZWQgd29yZCAoJycgd2hlbiB0aGUgYnVmZmVyIGlzIGVtcHR5KS4gKi9cbiAgY29uc3QgbGFzdFdvcmQgPSAoKTogc3RyaW5nID0+IGJ1Zi50cmltRW5kKCkubWF0Y2goL1xcUyskLyk/LlswXSA/PyAnJztcblxuICAvKipcbiAgICogUmVkaXJlY3Qgb3BlcmF0b3JzIHRoYXQgYXJlIG1pc3NpbmcgdGhlaXIgdGFyZ2V0IHdvcmQgd2hlbiB0aGV5IGFyZSB0aGVcbiAgICogYnVmZmVyJ3MgbGFzdCB3b3JkIChwbGFuIFx1MDBBNzEpOiBhIHRhcmdldCBtdXN0IGJlIGEgcGxhaW4gd29yZCwgc28gZXZlcnlcbiAgICogbm9uLXNlbGYtY29tcGxldGUgZm9ybSBpcyBhIHBhcnNlIGVycm9yLiBEdXAgZm9ybXMgd2l0aCBib3RoIGZkcyBwcmVzZW50XG4gICAqIChgMj4mMWAsIGA+Ji1gLCBgMzwmMGApIGFuZCBmdXNlZCB3b3JkcyAoYD5vdXRgLCBgMj5lcnJgLCBgPDxFT0ZgLFxuICAgKiBgJj5vdXRgKSBhcmUgY29tcGxldGUgYW5kIG5ldmVyIG1hdGNoLlxuICAgKi9cbiAgY29uc3QgREFOR0xJTkdfUkVESVJFQ1RfV09SRCA9IC9eKD86Pnw+PnwmPnwmPj58PlxcfHw8fDw+fDw8fDw8LXw8PDx8PiZ8XFxkKyg/Oj58Pj58PlxcfHw8fDw+fDw8fDw8LXw8PDx8PiZ8PCYpKSQvO1xuXG4gIGNvbnN0IGxhc3RXb3JkSXNEYW5nbGluZ1JlZGlyZWN0ID0gKCk6IGJvb2xlYW4gPT4gREFOR0xJTkdfUkVESVJFQ1RfV09SRC50ZXN0KGxhc3RXb3JkKCkpO1xuXG4gIC8qKiBXaGV0aGVyIHRoZSBjdXJyZW50IGNoYXIgc3RhcnRzIGEgbmV3IHdvcmQgaW4gdGhlIGJ1ZmZlciAoZW1wdHkgYnVmZmVyLCBvciBwcmVjZWRlZCBieSB3aGl0ZXNwYWNlKS4gKi9cbiAgY29uc3QgaXNXb3JkU3RhcnQgPSAoKTogYm9vbGVhbiA9PiBidWYgPT09ICcnIHx8IC9cXHMkLy50ZXN0KGJ1Zik7XG5cbiAgLyoqIFdoZXRoZXIgYSByZWRpcmVjdCB0b2tlbiBiZWdpbnMgYXQgYGlgOiBhIGA+YC9gPGAgZm9ybSwgYCY+YCwgb3IgYSBkaWdpdC1wcmVmaXhlZCBmb3JtIGxpa2UgYDI+YC9gMj4mMWAuICovXG4gIGNvbnN0IHN0YXJ0c1JlZGlyZWN0QXQgPSAoaTogbnVtYmVyKTogYm9vbGVhbiA9PiB7XG4gICAgY29uc3QgYyA9IGNtZFtpXTtcbiAgICBpZiAoYyA9PT0gJz4nIHx8IGMgPT09ICc8JykgcmV0dXJuIHRydWU7XG4gICAgaWYgKGMgPT09ICcmJykgcmV0dXJuIGNtZFtpICsgMV0gPT09ICc+JztcbiAgICBpZiAoYyA+PSAnMCcgJiYgYyA8PSAnOScpIHtcbiAgICAgIGxldCBqID0gaTtcbiAgICAgIHdoaWxlIChqIDwgbiAmJiBjbWRbal0gPj0gJzAnICYmIGNtZFtqXSA8PSAnOScpIGogKz0gMTtcbiAgICAgIHJldHVybiBjbWRbal0gPT09ICc+JyB8fCBjbWRbal0gPT09ICc8JztcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9O1xuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgbmV3IGNvbW1hbmQgY2FuIHN0YXJ0IGhlcmU6IHRoZSBidWZmZXIgaXMgZW1wdHksIGEgYm91bmRhcnlcbiAgICogb3BlcmF0b3Igb3IgYChgL2ApYCBwcmVjZWRlcywgdGhlIGJ1ZmZlciBlbmRzIHdpdGggYSBuZXdsaW5lIChhIG5ld2xpbmVcbiAgICogaW5zaWRlIGFuIG9wZW4gY29uc3RydWN0IGlzIHRleHQgYnV0IHN0aWxsIGVuZHMgdGhlIGxpc3QgaXRlbSksIG9yIHRoZVxuICAgKiBsYXN0IHdvcmQgZXhwZWN0cyBhIGNvbW1hbmQgYm9keSAoYHRoZW5gLCBgZG9gLCBge2AsIFx1MjAyNikuXG4gICAqL1xuICBjb25zdCBpc0NvbW1hbmRQb3NpdGlvbiA9ICgpOiBib29sZWFuID0+XG4gICAgYnVmLnRyaW0oKSA9PT0gJycgfHwgL1xcbiQvLnRlc3QoYnVmKSB8fCAvWzsmfCgpXSQvLnRlc3QoYnVmLnRyaW1FbmQoKSkgfHwgQ09NTUFORF9PUEVORVJfV09SRFMuaGFzKGxhc3RXb3JkKCkpO1xuXG4gIGNvbnN0IGZsdXNoID0gKG5leHRPcDogT3BlcmF0b3IpID0+IHtcbiAgICBjb25zdCBzID0gYnVmLnRyaW0oKTtcbiAgICBpZiAocykge1xuICAgICAgLy8gYCFgIGluIHBpcGUgcG9zaXRpb24gaXMgYSBwYXJzZSBlcnJvciAocGxhbiBcdTAwQTcxKTogdGhlIGZpcnN0IHdvcmQgb2YgYVxuICAgICAgLy8gcGlwZS1wcmVjZWRlZCBzdGFnZSBtYXkgbm90IGJlIGAhYCAoYGZhbHNlIHwgISB0cnVlYCwgYGNhdCBmIHxcXG4hIHRydWVgKS5cbiAgICAgIGlmIChwZW5kaW5nT3AgPT09ICdwaXBlJyAmJiAocyA9PT0gJyEnIHx8IC9eIVxccy8udGVzdChzKSkpIHtcbiAgICAgICAgcmVqZWN0KCdwaXBlLWJhbmcnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgcGFydHMucHVzaCh7IHRleHQ6IHMsIHByZWNlZGVkQnk6IHBlbmRpbmdPcCB9KTtcbiAgICB9XG4gICAgYnVmID0gJyc7XG4gICAgcGVuZGluZ09wID0gbmV4dE9wO1xuICB9O1xuXG4gIC8vIFRoZSBraW5kLW1hdGNoZWQgY29uc3RydWN0IHN0YWNrLCBvbmUgbGlzdCBwZXIgcGFyZW4gbGV2ZWw6IGAoYCBwdXNoZXMgYVxuICAvLyBmcmVzaCBsZXZlbCwgYClgIHBvcHMgaXQgYW5kIGZpcmVzIHdoZW4gaXQgaXMgbm9uLWVtcHR5IFx1MjAxNCBhbiB1bmNsb3NlZFxuICAvLyBjb25zdHJ1Y3QgY2Fubm90IG91dGxpdmUgdGhlIHN1YnNoZWxsIHRoYXQgY2xvc2VkIChwbGFuIFx1MDBBNzMpLlxuICBjb25zdCBsZXZlbHM6IE9wZW5Db25zdHJ1Y3RbXVtdID0gW1tdXTtcbiAgY29uc3QgdG9wID0gKCk6IE9wZW5Db25zdHJ1Y3QgfCB1bmRlZmluZWQgPT4ge1xuICAgIGNvbnN0IGx2ID0gbGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXTtcbiAgICByZXR1cm4gbHYubGVuZ3RoID4gMCA/IGx2W2x2Lmxlbmd0aCAtIDFdIDogdW5kZWZpbmVkO1xuICB9O1xuICAvKiogU2V0IGJ5IG9wZW5lcnMgYW5kIGJvZHkga2V5d29yZHMsIGNsZWFyZWQgYnkgb3RoZXIgd29yZHMgYW5kIGAoYCBcdTIwMTQgYW4gb3BlcmF0b3Igb3IgY2xvc2VyIGRpcmVjdGx5IGFmdGVyIGl0IGlzIGFuIGVtcHR5LWxpc3QgcGFyc2UgZXJyb3IgKGBpZiB0cnVlOyB0aGVuOyBmaWAsIGB7IDsgfWApLiAqL1xuICBsZXQgYWZ0ZXJLZXl3b3JkID0gZmFsc2U7XG4gIC8qKiBgZnVuY3Rpb25gIHNlZW47IHRoZSBuZXh0IHdvcmQgaXMgdGhlIGZ1bmN0aW9uIG5hbWUsIGFuZCBge2AgcmlnaHQgYWZ0ZXIgaXQgb3BlbnMgdGhlIGRlZmluaXRpb24gYm9keS4gKi9cbiAgbGV0IGZ1bmN0aW9uU2VlbiA9IGZhbHNlO1xuICBsZXQgbmFtZVNlZW4gPSBmYWxzZTtcblxuICAvLyBUaGUgb3BlbiBjYXNlIHJlZ2lvbiwgaWYgYW55IChwbGFuIFx1MDBBNzMpLiBXaGlsZSBvcGVuLCBpdHMgY29udGVudCBpcyBvcGFxdWVcbiAgLy8gdG8gZXZlcnkgb3RoZXIgbWFjaGluZTogdGhlIGdsb2JhbCBwYXJlbiBkZXB0aCBpcyBmcm96ZW4sIHRoZSBjb25zdHJ1Y3RcbiAgLy8gc3RhY2sgaXMgdW50b3VjaGVkLCBhbmQgYm91bmRhcnkgb3BlcmF0b3JzIGFyZSB0ZXh0LlxuICBsZXQgY2FzZVJlZ2lvbjogQ2FzZVJlZ2lvbiB8IG51bGwgPSBudWxsO1xuXG4gIC8vIFBlbmRpbmcgaGVyZWRvY3MgKHBsYW4gXHUwMEE3Myk6IGA8PGAvYDw8LWAgYXQgZGVwdGggMCB3aXRoIGEgZGVsaW1pdGVyIHdvcmQuXG4gIGNvbnN0IGhlcmVkb2NzOiBQZW5kaW5nSGVyZWRvY1tdID0gW107XG4gIC8qKiBJbiB0aGUgYm9keSBvZiBhIHBlbmRpbmcgaGVyZWRvYyBcdTIwMTQgbGluZXMgYXJlIHNjYW5uZWQgcmF3IGZvciB0aGUgY2xvc2UgbGluZS4gKi9cbiAgbGV0IGluQm9keSA9IGZhbHNlO1xuXG4gIHdoaWxlIChpIDwgbikge1xuICAgIGNvbnN0IGMgPSBjbWRbaV07XG4gICAgaWYgKGluU3F1b3RlKSB7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGlmIChjID09PSBcIidcIikgaW5TcXVvdGUgPSBmYWxzZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaW5EcXVvdGUpIHtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IG4pIHtcbiAgICAgICAgYnVmICs9IGNtZFtpICsgMV07XG4gICAgICAgIGkgKz0gMjtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAoYyA9PT0gJ1wiJykgaW5EcXVvdGUgPSBmYWxzZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gXCInXCIpIHtcbiAgICAgIGluU3F1b3RlID0gdHJ1ZTtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXCInKSB7XG4gICAgICBpbkRxdW90ZSA9IHRydWU7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1xcXFwnICYmIGkgKyAxIDwgbikge1xuICAgICAgYnVmICs9IGMgKyBjbWRbaSArIDFdO1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIGAke1x1MjAyNn1gIGNvbnRlbnQgaXMgb3BhcXVlIChwbGFuIFx1MDBBNzEpOiBuZXN0ZWQgZXhwYW5zaW9ucyBuZXN0LCBhbmQgd2hpbGVcbiAgICAvLyB0aGUgYnJhY2UgZGVwdGggaXMgcG9zaXRpdmUgbm90aGluZyBpbnNpZGUgY291bnRzIHBhcmVucywgc3BsaXRzXG4gICAgLy8gb3BlcmF0b3JzLCBzdGFydHMgY29tbWVudHMsIG9yIHJlY29nbml6ZXMgY29uc3RydWN0cyBcdTIwMTQgYCR7eCUpfWAsXG4gICAgLy8gYCR7eC8vKC99YCwgYW5kIGAke3g6LSQoZWNobyB5KX1gIGFyZSBhbGwgdmFsaWQuXG4gICAgaWYgKGJyYWNlRGVwdGggPiAwKSB7XG4gICAgICBpZiAoYyA9PT0gJ30nKSBicmFjZURlcHRoIC09IDE7XG4gICAgICBidWYgKz0gYztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBIZXJlZG9jIGJvZHkgbW9kZTogc2NhbiBsaW5lcyByYXcgdW50aWwgdGhlIGZpcnN0IHBlbmRpbmcgaGVyZWRvYydzXG4gICAgLy8gY2xvc2UgbGluZSAoYSBsaW5lIHRoYXQgaXMgZXhhY3RseSB0aGUgZGVsaW1pdGVyLCBvcHRpb25hbGx5IHRhYi1cbiAgICAvLyBwcmVmaXhlZCBmb3IgYDw8LWAsIHdpdGggb3B0aW9uYWwgdHJhaWxpbmcgd2hpdGVzcGFjZSkuIFRoZSBib2R5IGlzXG4gICAgLy8gb3BhcXVlIFx1MjAxNCBpdCBwcm9kdWNlcyBubyBzdGFnZXMgXHUyMDE0IGFuZCB1bnRlcm1pbmF0ZWQgYm9kaWVzIGVuZCBhdCBFT0YuXG4gICAgaWYgKGluQm9keSkge1xuICAgICAgY29uc3QgbGluZUVuZCA9IGNtZC5pbmRleE9mKCdcXG4nLCBpKTtcbiAgICAgIGNvbnN0IGxpbmUgPSBsaW5lRW5kID09PSAtMSA/IGNtZC5zbGljZShpKSA6IGNtZC5zbGljZShpLCBsaW5lRW5kKTtcbiAgICAgIGlmIChoZXJlZG9jc1swXS5jbG9zZS50ZXN0KGxpbmUpKSB7XG4gICAgICAgIGhlcmVkb2NzLnNoaWZ0KCk7XG4gICAgICAgIGlmIChoZXJlZG9jcy5sZW5ndGggPT09IDApIGluQm9keSA9IGZhbHNlO1xuICAgICAgfVxuICAgICAgaWYgKGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ubGVuZ3RoID4gMCB8fCBjYXNlUmVnaW9uICE9PSBudWxsKSB7XG4gICAgICAgIC8vIEluc2lkZSBhbiBvcGVuIGNvbnN0cnVjdCB0aGUgYm9keSBsaW5lIGZvbGRzIGludG8gdGhlIGNvbnN0cnVjdCdzXG4gICAgICAgIC8vIGludGVyaW9yIHRleHQgKGEgbmV3bGluZSBpbnNpZGUgYW4gb3BlbiBjb25zdHJ1Y3QgaXMgbm90IGFcbiAgICAgICAgLy8gYm91bmRhcnksIHBsYW4gXHUwMEE3MSkgXHUyMDE0IHRoZSBpbnRlcmlvciByZS1zcGxpdCByZS1zY2FucyBpdCBhcyBib2R5LlxuICAgICAgICBidWYgKz0gbGluZTtcbiAgICAgICAgaWYgKGxpbmVFbmQgIT09IC0xKSBidWYgKz0gJ1xcbic7XG4gICAgICB9XG4gICAgICBpID0gbGluZUVuZCA9PT0gLTEgPyBuIDogbGluZUVuZCArIDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gVGhlIG5ld2xpbmUgcmlnaHQgYWZ0ZXIgYSBoZXJlZG9jJ3MgZGVsaW1pdGVyIGxpbmUgZW5kcyB0aGUgZGVsaW1pdGVyJ3NcbiAgICAvLyBsaW5lIFx1MjAxNCBpdCBzcGxpdHMgbm9ybWFsbHkgKGEgY29tcGxldGVkIGxpc3QsIGJ1dCB3aXRob3V0IGFkdmFuY2luZ1xuICAgIC8vIGBsaXN0U3RhcnRgOiBhIGNvbXBsZXRlbmVzcyB2aW9sYXRpb24gdGhhdCByZWplY3RzIGxhdGVyIGRyb3BzIHRoZVxuICAgIC8vIGRlbGltaXRlcidzLWxpbmUgc3RhZ2UgdG9vKSBcdTIwMTQgYW5kIHN0YXJ0cyB0aGUgYm9keS4gSW5zaWRlIGFuIG9wZW5cbiAgICAvLyBjb25zdHJ1Y3QgdGhlIG5ld2xpbmUgaXMgbm90IGEgYm91bmRhcnk6IHRoZSBkZWxpbWl0ZXIncyBsaW5lLCB0aGVcbiAgICAvLyBib2R5LCBhbmQgdGhlIGNsb3NlIGxpbmUgYWxsIGZvbGQgaW50byB0aGUgY29uc3RydWN0J3Mgb25lIHN0YWdlLCBhbmRcbiAgICAvLyB0aGUgd2FsaydzIGludGVyaW9yIHJlLXNwbGl0IGFwcGxpZXMgdGhlIHNhbWUgaGVyZWRvYyBtYWNoaW5lcnkgdGhlcmUuXG4gICAgaWYgKGMgPT09ICdcXG4nICYmIGhlcmVkb2NzLmxlbmd0aCA+IDApIHtcbiAgICAgIGlmIChsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLmxlbmd0aCA+IDAgfHwgY2FzZVJlZ2lvbiAhPT0gbnVsbCkge1xuICAgICAgICBidWYgKz0gYztcbiAgICAgICAgaW5Cb2R5ID0gdHJ1ZTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChpc1VuY29uc3VtZWRPcGVyYXRvcigpIHx8IGxhc3RXb3JkSXNEYW5nbGluZ1JlZGlyZWN0KCkpIHtcbiAgICAgICAgcmVqZWN0KCdkYW5nbGluZy1vcGVyYXRvcicpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGZsdXNoKCduZXdsaW5lJyk7XG4gICAgICBpbkJvZHkgPSB0cnVlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIGAjYCBiZWdpbnMgYSBjb21tZW50IHdoZW4gaXQgc3RhcnRzIGEgd29yZCBhdCBkZXB0aCAwIChlbXB0eSBidWZmZXIgb3JcbiAgICAvLyBwcmVjZWRlZCBieSB3aGl0ZXNwYWNlKTsgY29tbWVudHMgcnVuIHRvIHRoZSBuZXdsaW5lLCBrZWVwaW5nIHRoZSBidWZmZXJcbiAgICAvLyBlbXB0eSBmb3IgdGhlIGNvbnRpbnVhdGlvbiBydWxlLiBNaWQtd29yZCBhbmQgcXVvdGVkIGAjYCBhcmUgdGV4dCwgYW5kXG4gICAgLy8gY29tbWVudHMgaW5zaWRlIHBhcmVucyBhcmUgb3BhcXVlIGxpa2UgZXZlcnl0aGluZyBlbHNlIHRoZXJlIChwbGFuIFx1MDBBNzEpLlxuICAgIGlmIChjID09PSAnIycgJiYgZGVwdGggPT09IDAgJiYgaXNXb3JkU3RhcnQoKSkge1xuICAgICAgd2hpbGUgKGkgPCBuICYmIGNtZFtpXSAhPT0gJ1xcbicpIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBUaGUgY2FzZS1yZWdpb24gc2NhbiBvd25zIGV2ZXJ5dGhpbmcgYXQgaXRzIGxvY2FsIGRlcHRoIDAgXHUyMDE0IHBhdHRlcm5cbiAgICAvLyBzeW50YXgsIGxpc3QgdGVybWluYXRvcnMsIGFuZCB3b3JkcyBcdTIwMTQgd2hpbGUgdGhlIHJlZ2lvbiBpcyBvcGVuLlxuICAgIGlmIChjYXNlUmVnaW9uKSB7XG4gICAgICBjb25zdCByID0gY2FzZVJlZ2lvbjtcbiAgICAgIGlmIChyLmxvY2FsRGVwdGggPT09IDApIHtcbiAgICAgICAgY29uc3QgczIgPSBjbWQuc2xpY2UoaSwgaSArIDIpO1xuICAgICAgICBjb25zdCBzMyA9IGNtZC5zbGljZShpLCBpICsgMyk7XG4gICAgICAgIC8vIGA7O2AvYDsmYC9gOzsmYCBlbmQgdGhlIGN1cnJlbnQgcGF0dGVybiBsaXN0IFx1MjAxNCBiYWNrIHRvIHBhdHRlcm4tc3RhcnQuXG4gICAgICAgIGlmIChzMyA9PT0gJzs7JicgfHwgczIgPT09ICc7OycgfHwgczIgPT09ICc7JicpIHtcbiAgICAgICAgICByLnBvcyA9ICdwYXR0ZXJuLXN0YXJ0JztcbiAgICAgICAgICBidWYgKz0gczMgPT09ICc7OyYnID8gczMgOiBzMjtcbiAgICAgICAgICBpICs9IHMzID09PSAnOzsmJyA/IDMgOiAyO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIC8vIGA7YCByZXR1cm5zIHRvIGNvbW1hbmQgc3RhcnQgKGEgYDs7YCB3YXMgaGFuZGxlZCBhYm92ZSkuXG4gICAgICAgIGlmIChjID09PSAnOycpIHtcbiAgICAgICAgICByLnBvcyA9ICdjb21tYW5kJztcbiAgICAgICAgICByLmNtZEVtcHR5ID0gdHJ1ZTtcbiAgICAgICAgICBidWYgKz0gYztcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgLy8gQSBzaW5nbGUgYCZgIChub3QgcGFydCBvZiBhIHJlZGlyZWN0IG9yIGAmJmApIGlzIHRoZSBiYWNrZ3JvdW5kXG4gICAgICAgIC8vIG9wZXJhdG9yIFx1MjAxNCBhbHNvIGNvbW1hbmQgc3RhcnQuXG4gICAgICAgIGNvbnN0IGxhc3QgPSBidWZbYnVmLmxlbmd0aCAtIDFdO1xuICAgICAgICBpZiAoYyA9PT0gJyYnICYmIGNtZFtpICsgMV0gIT09ICc+JyAmJiBjbWRbaSArIDFdICE9PSAnJicgJiYgbGFzdCAhPT0gJz4nICYmIGxhc3QgIT09ICc8Jykge1xuICAgICAgICAgIHIucG9zID0gJ2NvbW1hbmQnO1xuICAgICAgICAgIHIuY21kRW1wdHkgPSB0cnVlO1xuICAgICAgICAgIGJ1ZiArPSBjO1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoYyA9PT0gJ1xcbicpIHtcbiAgICAgICAgICAvLyBBIHBhdHRlcm4gY2Fubm90IGNvbnRpbnVlIGFjcm9zcyBhIG5ld2xpbmUgKGJhc2ggZXJyb3JzKSwgYnV0IGFcbiAgICAgICAgICAvLyBuZXdsaW5lIGFmdGVyIGBpbmAgb3IgaW5zaWRlIGEgbGlzdCBpdGVtIGlzIGZpbmUuXG4gICAgICAgICAgaWYgKHIucG9zID09PSAncGF0dGVybicpIHtcbiAgICAgICAgICAgIHJlamVjdCgndW5jbG9zZWQtY2FzZScpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChyLnBvcyA9PT0gJ2NvbW1hbmQnKSByLmNtZEVtcHR5ID0gdHJ1ZTtcbiAgICAgICAgICBidWYgKz0gYztcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGMgPT09ICcjJyAmJiBpc1dvcmRTdGFydCgpKSB7XG4gICAgICAgICAgLy8gQSBjb21tZW50IGluc2lkZSB0aGUgcmVnaW9uIHJ1bnMgdG8gdGhlIG5ld2xpbmUgbGlrZSBvdXRzaWRlLlxuICAgICAgICAgIHdoaWxlIChpIDwgbiAmJiBjbWRbaV0gIT09ICdcXG4nKSBpICs9IDE7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGlzV29yZFN0YXJ0KCkgJiYgIVdPUkRfRU5ELnRlc3QoYykpIHtcbiAgICAgICAgICBsZXQgaiA9IGk7XG4gICAgICAgICAgd2hpbGUgKGogPCBuICYmICFXT1JEX0VORC50ZXN0KGNtZFtqXSkpIGogKz0gMTtcbiAgICAgICAgICBjb25zdCB3ID0gY21kLnNsaWNlKGksIGopO1xuICAgICAgICAgIC8vIGBlc2FjYCBjbG9zZXMgYXQgYSBwYXR0ZXJuLWxpc3Qgc3RhcnQgb3IgYXQgdGhlIHN0YXJ0IG9mIGEgbGlzdFxuICAgICAgICAgIC8vIGl0ZW07IGVsc2V3aGVyZSBpdCBpcyBhbiBvcmRpbmFyeSB3b3JkIChgZWNobyBlc2FjYCwgYGF8ZXNhYylgKSxcbiAgICAgICAgICAvLyBhcyBpcyBgY2FzZWAgaW4gdGhlIHN1YmplY3QgKGBjYXNlIGVzYWMgaW4gXHUyMDI2YCkuXG4gICAgICAgICAgaWYgKHcgPT09ICdlc2FjJyAmJiAoci5wb3MgPT09ICdwYXR0ZXJuLXN0YXJ0JyB8fCAoci5wb3MgPT09ICdjb21tYW5kJyAmJiByLmNtZEVtcHR5KSkpIHtcbiAgICAgICAgICAgIGNhc2VSZWdpb24gPSBudWxsO1xuICAgICAgICAgICAgYWZ0ZXJLZXl3b3JkID0gZmFsc2U7XG4gICAgICAgICAgfSBlbHNlIGlmICh3ID09PSAnaW4nICYmIHIucG9zID09PSAnc3ViamVjdCcpIHtcbiAgICAgICAgICAgIHIucG9zID0gJ3BhdHRlcm4tc3RhcnQnO1xuICAgICAgICAgIH0gZWxzZSBpZiAoci5wb3MgPT09ICdwYXR0ZXJuLXN0YXJ0Jykge1xuICAgICAgICAgICAgci5wb3MgPSAncGF0dGVybic7XG4gICAgICAgICAgfSBlbHNlIGlmIChyLnBvcyA9PT0gJ2NvbW1hbmQnKSB7XG4gICAgICAgICAgICByLmNtZEVtcHR5ID0gZmFsc2U7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJ1ZiArPSB3O1xuICAgICAgICAgIGkgPSBqO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICAvLyBMb2NhbCBkZXB0aCA+IDAgb3Igbm9uLXdvcmQgY2hhcnMgZmFsbCB0aHJvdWdoIHRvIHRoZSBwYXJlbiBicmFuY2hlc1xuICAgICAgLy8gYW5kIHRoZSBnZW5lcmljIGJ1ZmZlci5cbiAgICB9XG4gICAgaWYgKGMgPT09ICcoJykge1xuICAgICAgaWYgKGNhc2VSZWdpb24pIHtcbiAgICAgICAgY2FzZVJlZ2lvbi5sb2NhbERlcHRoICs9IDE7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBBIHN1YnNoZWxsIHN0YXJ0cyBhIGNvbW1hbmQgXHUyMDE0IGBpZiB0cnVlOyB0aGVuICggZWNobyBoaSApOyBmaWAgaXNcbiAgICAgICAgLy8gdmFsaWQgd2hpbGUgYGlmIHRydWU7IHRoZW47IGZpYCBpcyBub3Q7IHRoZSBzYW1lIHN1YnNoZWxsIGNvdW50cyBhc1xuICAgICAgICAvLyBhIGJvZHkgd29yZCBmb3IgYW4gZW5jbG9zaW5nIGJyYWNlIGdyb3VwIChgeyAoIGVjaG8gaGkgKTsgfWApLlxuICAgICAgICBjb25zdCB0ID0gdG9wKCk7XG4gICAgICAgIGlmICh0Py5raW5kID09PSAnYnJhY2UnKSB0LmJvZHkgPSB0cnVlO1xuICAgICAgICBkZXB0aCArPSAxO1xuICAgICAgICBsZXZlbHMucHVzaChbXSk7XG4gICAgICB9XG4gICAgICBhZnRlcktleXdvcmQgPSBmYWxzZTtcbiAgICAgIGJ1ZiArPSBjO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnKScpIHtcbiAgICAgIGlmIChjYXNlUmVnaW9uKSB7XG4gICAgICAgIC8vIEF0IGxvY2FsIGRlcHRoIDAgYSBgKWAgaXMgdGhlIHBhdHRlcm4gdGVybWluYXRvciAob3IgdGhlIGVuZCBvZiBhXG4gICAgICAgIC8vIGxpc3QgaXRlbSkgXHUyMDE0IHRoZSByZWdpb24gb3ducyBpdCBhbmQgdGhlIGdsb2JhbCBkZXB0aCBzdGF5cyBmcm96ZW4uXG4gICAgICAgIGlmIChjYXNlUmVnaW9uLmxvY2FsRGVwdGggPT09IDApIHtcbiAgICAgICAgICBjYXNlUmVnaW9uLnBvcyA9ICdjb21tYW5kJztcbiAgICAgICAgICBjYXNlUmVnaW9uLmNtZEVtcHR5ID0gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjYXNlUmVnaW9uLmxvY2FsRGVwdGggLT0gMTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQSBzdHJheSBgKWAgYXQgZGVwdGggMCAoYW5kIGJyYWNlIGRlcHRoIDAsIG91dHNpZGUgcXVvdGVzKSBpcyBhIHBhcnNlXG4gICAgICAgIC8vIGVycm9yIFx1MjAxNCBgZWNobyB4KSAmJiBcdTIwMjZgIChwbGFuIFx1MDBBNzEpLiBgKWAgaW5zaWRlIHF1b3RlcywgYCR7XHUyMDI2fWAsIGFuZFxuICAgICAgICAvLyBoZXJlZG9jIGJvZGllcyBuZXZlciByZWFjaGVzIHRoaXMgYnJhbmNoLlxuICAgICAgICBpZiAoZGVwdGggPT09IDApIHtcbiAgICAgICAgICByZWplY3QoJ3VuYmFsYW5jZWQtcGFyZW4nKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICAvLyBGaXJlLWJlZm9yZS1yZXN0b3JlOiBhbiB1bmNsb3NlZCBjb25zdHJ1Y3Qgb24gdGhlIGNsb3NpbmcgbGV2ZWxcbiAgICAgICAgLy8gY2Fubm90IG91dGxpdmUgdGhlIHN1YnNoZWxsIChwbGFuIFx1MDBBNzMpLlxuICAgICAgICBpZiAobGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgcmVqZWN0KCd1bmNsb3NlZC1jb25zdHJ1Y3QnKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBkZXB0aCAtPSAxO1xuICAgICAgICBsZXZlbHMucG9wKCk7XG4gICAgICB9XG4gICAgICBidWYgKz0gYztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBDb25zdHJ1Y3Qga2V5d29yZHMgYW5kIHRoZSBjYXNlLXJlZ2lvbiBvcGVuZXI6IHJlY29nbml6ZWQgYXQgd29yZFxuICAgIC8vIHN0YXJ0cyBhdCBhbnkgcGFyZW4gZGVwdGggKGNvbnN0cnVjdHMgdHJhY2sgdGhyb3VnaCBzdWJzaGVsbHMpLCBvdXRzaWRlXG4gICAgLy8gcXVvdGVzLCAke1x1MjAyNn0sIGhlcmVkb2MgYm9kaWVzLCBhbmQgb3BlbiBjYXNlIHJlZ2lvbnMgKHRoZSByZWdpb24gc2NhblxuICAgIC8vIGFib3ZlIG93bnMgdGhvc2Ugd29yZHMpLiBXb3JkLWVuZCBjaGFycyAoYDtgLCBgJmAsIGB8YCwgYDxgLCBgPmApXG4gICAgLy8gbmV2ZXIgYmVnaW4gYSB3b3JkIGhlcmUuXG4gICAgaWYgKFxuICAgICAgIWNhc2VSZWdpb24gJiZcbiAgICAgICFXT1JEX0VORC50ZXN0KGMpICYmXG4gICAgICAoaXNXb3JkU3RhcnQoKSB8fCAvWygpXSQvLnRlc3QoYnVmKSkgJiZcbiAgICAgICEoYyA9PT0gJyQnICYmIGNtZFtpICsgMV0gPT09ICd7JylcbiAgICApIHtcbiAgICAgIGxldCBqID0gaTtcbiAgICAgIHdoaWxlIChqIDwgbiAmJiAhV09SRF9FTkQudGVzdChjbWRbal0pKSBqICs9IDE7XG4gICAgICBjb25zdCB3ID0gY21kLnNsaWNlKGksIGopO1xuICAgICAgY29uc3QgaXNGblNoYXBlID0gKCk6IGJvb2xlYW4gPT4gL15bQS1aYS16X11bQS1aYS16MC05X10qXFwoXFwpJC8udGVzdChsYXN0V29yZCgpKSB8fCBsYXN0V29yZCgpID09PSAnKCknO1xuICAgICAgaWYgKHcgPT09ICdpbicgJiYgdG9wKCkgIT09IHVuZGVmaW5lZCAmJiBbJ2ZvcicsICdzZWxlY3QnXS5pbmNsdWRlcyh0b3AoKSEua2luZCkpIHtcbiAgICAgICAgLy8gVGhlIGZvci9zZWxlY3Qgd29yZC1saXN0IHNlcGFyYXRvciBcdTIwMTQgcmVjb2duaXplZCB3aGVyZXZlciBpdCBhcHBlYXJzXG4gICAgICAgIC8vIHdoaWxlIGEgZm9yL3NlbGVjdCBpcyBvcGVuIChgZm9yIGkgaW4gYSBiYCwgYHNlbGVjdCB4IGluIGFgKS5cbiAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ3snICYmIChpc0NvbW1hbmRQb3NpdGlvbigpIHx8IGlzRm5TaGFwZSgpIHx8IChmdW5jdGlvblNlZW4gJiYgbmFtZVNlZW4pKSkge1xuICAgICAgICAvLyBge2Agb3BlbnMgYSBicmFjZSBncm91cCBhdCBjb21tYW5kIHBvc2l0aW9uLCBvciByaWdodCBhZnRlciBhXG4gICAgICAgIC8vIGZ1bmN0aW9uIG5hbWUgKGBmKCkge2AsIGBmKCl7YCwgYGZ1bmN0aW9uIGYge2ApLiBge2NhdGAgaXMgYSB3b3JkLlxuICAgICAgICBpZiAoZnVuY3Rpb25TZWVuICYmIG5hbWVTZWVuKSB7XG4gICAgICAgICAgZnVuY3Rpb25TZWVuID0gZmFsc2U7XG4gICAgICAgICAgbmFtZVNlZW4gPSBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodG9wKCk/LmtpbmQgPT09ICdicmFjZScpIHRvcCgpIS5ib2R5ID0gdHJ1ZTtcbiAgICAgICAgbGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5wdXNoKHsga2luZDogJ2JyYWNlJywgYm9keTogZmFsc2UgfSk7XG4gICAgICAgIGFmdGVyS2V5d29yZCA9IHRydWU7XG4gICAgICB9IGVsc2UgaWYgKHcgPT09ICd9JyAmJiBpc0NvbW1hbmRQb3NpdGlvbigpKSB7XG4gICAgICAgIGNvbnN0IHQgPSB0b3AoKTtcbiAgICAgICAgaWYgKGFmdGVyS2V5d29yZCB8fCB0ID09PSB1bmRlZmluZWQgfHwgdC5raW5kICE9PSAnYnJhY2UnIHx8ICF0LmJvZHkpIHtcbiAgICAgICAgICByZWplY3QoJ3VuY2xvc2VkLWNvbnN0cnVjdCcpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ucG9wKCk7XG4gICAgICAgIGFmdGVyS2V5d29yZCA9IGZhbHNlO1xuICAgICAgfSBlbHNlIGlmIChpc0NvbW1hbmRQb3NpdGlvbigpKSB7XG4gICAgICAgIGlmICh3ID09PSAnY2FzZScpIHtcbiAgICAgICAgICBjYXNlUmVnaW9uID0geyBwb3M6ICdzdWJqZWN0JywgY21kRW1wdHk6IGZhbHNlLCBsb2NhbERlcHRoOiAwIH07XG4gICAgICAgICAgYWZ0ZXJLZXl3b3JkID0gZmFsc2U7XG4gICAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgIGZ1bmN0aW9uU2VlbiA9IHRydWU7XG4gICAgICAgICAgbmFtZVNlZW4gPSBmYWxzZTtcbiAgICAgICAgICBhZnRlcktleXdvcmQgPSBmYWxzZTtcbiAgICAgICAgfSBlbHNlIGlmICh3ID09PSAnaWYnKSB7XG4gICAgICAgICAgaWYgKHRvcCgpPy5raW5kID09PSAnYnJhY2UnKSB0b3AoKSEuYm9keSA9IHRydWU7XG4gICAgICAgICAgbGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5wdXNoKHsga2luZDogJ2lmJywgYm9keTogZmFsc2UgfSk7XG4gICAgICAgICAgYWZ0ZXJLZXl3b3JkID0gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIGlmICh3ID09PSAnd2hpbGUnIHx8IHcgPT09ICd1bnRpbCcpIHtcbiAgICAgICAgICBpZiAodG9wKCk/LmtpbmQgPT09ICdicmFjZScpIHRvcCgpIS5ib2R5ID0gdHJ1ZTtcbiAgICAgICAgICBsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLnB1c2goeyBraW5kOiAnbG9vcCcsIGJvZHk6IGZhbHNlIH0pO1xuICAgICAgICAgIGFmdGVyS2V5d29yZCA9IHRydWU7XG4gICAgICAgIH0gZWxzZSBpZiAodyA9PT0gJ2ZvcicpIHtcbiAgICAgICAgICBpZiAodG9wKCk/LmtpbmQgPT09ICdicmFjZScpIHRvcCgpIS5ib2R5ID0gdHJ1ZTtcbiAgICAgICAgICBsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLnB1c2goeyBraW5kOiAnZm9yJywgYm9keTogZmFsc2UgfSk7XG4gICAgICAgICAgYWZ0ZXJLZXl3b3JkID0gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIGlmICh3ID09PSAnc2VsZWN0Jykge1xuICAgICAgICAgIGlmICh0b3AoKT8ua2luZCA9PT0gJ2JyYWNlJykgdG9wKCkhLmJvZHkgPSB0cnVlO1xuICAgICAgICAgIGxldmVsc1tsZXZlbHMubGVuZ3RoIC0gMV0ucHVzaCh7IGtpbmQ6ICdzZWxlY3QnLCBib2R5OiBmYWxzZSB9KTtcbiAgICAgICAgICBhZnRlcktleXdvcmQgPSB0cnVlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdkbycpIHtcbiAgICAgICAgICBjb25zdCB0ID0gdG9wKCk7XG4gICAgICAgICAgaWYgKHQgPT09IHVuZGVmaW5lZCB8fCAhWydmb3InLCAnbG9vcCcsICdzZWxlY3QnXS5pbmNsdWRlcyh0LmtpbmQpKSB7XG4gICAgICAgICAgICByZWplY3QoJ3VuY2xvc2VkLWNvbnN0cnVjdCcpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIHQuYm9keSA9IHRydWU7XG4gICAgICAgICAgYWZ0ZXJLZXl3b3JkID0gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIGlmICh3ID09PSAndGhlbicpIHtcbiAgICAgICAgICBjb25zdCB0ID0gdG9wKCk7XG4gICAgICAgICAgaWYgKHQgPT09IHVuZGVmaW5lZCB8fCB0LmtpbmQgIT09ICdpZicpIHtcbiAgICAgICAgICAgIHJlamVjdCgndW5jbG9zZWQtY29uc3RydWN0Jyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgdC5ib2R5ID0gdHJ1ZTtcbiAgICAgICAgICBhZnRlcktleXdvcmQgPSB0cnVlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdlbHNlJyB8fCB3ID09PSAnZWxpZicpIHtcbiAgICAgICAgICAvLyBlbHNlL2VsaWYgcmVxdWlyZSBhIGJvZHkgYWxyZWFkeSBcdTIwMTQgYW4gZW1wdHkgaWYtbGlzdCBpcyBhbiBlcnJvci5cbiAgICAgICAgICBjb25zdCB0ID0gdG9wKCk7XG4gICAgICAgICAgaWYgKHQgPT09IHVuZGVmaW5lZCB8fCB0LmtpbmQgIT09ICdpZicgfHwgIXQuYm9keSkge1xuICAgICAgICAgICAgcmVqZWN0KCd1bmNsb3NlZC1jb25zdHJ1Y3QnKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBhZnRlcktleXdvcmQgPSB0cnVlO1xuICAgICAgICB9IGVsc2UgaWYgKHcgPT09ICdpbicpIHtcbiAgICAgICAgICBjb25zdCB0ID0gdG9wKCk7XG4gICAgICAgICAgaWYgKHQgPT09IHVuZGVmaW5lZCB8fCAhWydmb3InLCAnc2VsZWN0J10uaW5jbHVkZXModC5raW5kKSkge1xuICAgICAgICAgICAgcmVqZWN0KCd1bmNsb3NlZC1jb25zdHJ1Y3QnKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmICh3ID09PSAnZmknKSB7XG4gICAgICAgICAgY29uc3QgdCA9IHRvcCgpO1xuICAgICAgICAgIGlmICh0ID09PSB1bmRlZmluZWQgfHwgdC5raW5kICE9PSAnaWYnIHx8ICF0LmJvZHkpIHtcbiAgICAgICAgICAgIHJlamVjdCgndW5jbG9zZWQtY29uc3RydWN0Jyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgbGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5wb3AoKTtcbiAgICAgICAgICBhZnRlcktleXdvcmQgPSBmYWxzZTtcbiAgICAgICAgfSBlbHNlIGlmICh3ID09PSAnZG9uZScpIHtcbiAgICAgICAgICBjb25zdCB0ID0gdG9wKCk7XG4gICAgICAgICAgaWYgKHQgPT09IHVuZGVmaW5lZCB8fCAhWydmb3InLCAnbG9vcCcsICdzZWxlY3QnXS5pbmNsdWRlcyh0LmtpbmQpIHx8ICF0LmJvZHkpIHtcbiAgICAgICAgICAgIHJlamVjdCgndW5jbG9zZWQtY29uc3RydWN0Jyk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgbGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5wb3AoKTtcbiAgICAgICAgICBhZnRlcktleXdvcmQgPSBmYWxzZTtcbiAgICAgICAgfSBlbHNlIGlmICh3ID09PSAnZXNhYycpIHtcbiAgICAgICAgICAvLyBObyBvcGVuIHJlZ2lvbiBcdTIwMTQgYSBzdHJheSBlc2FjIGlzIGEgcGFyc2UgZXJyb3IuXG4gICAgICAgICAgcmVqZWN0KCd1bmNsb3NlZC1jb25zdHJ1Y3QnKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBhZnRlcktleXdvcmQgPSBmYWxzZTtcbiAgICAgICAgICBpZiAodG9wKCk/LmtpbmQgPT09ICdicmFjZScpIHRvcCgpIS5ib2R5ID0gdHJ1ZTtcbiAgICAgICAgICBpZiAoZnVuY3Rpb25TZWVuKSB7XG4gICAgICAgICAgICBpZiAobmFtZVNlZW4pIHtcbiAgICAgICAgICAgICAgZnVuY3Rpb25TZWVuID0gZmFsc2U7XG4gICAgICAgICAgICAgIG5hbWVTZWVuID0gZmFsc2U7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBuYW1lU2VlbiA9IHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBBbiBhcmd1bWVudC1wb3NpdGlvbiB3b3JkOiBub3RoaW5nIG9wZW5zLCB0aGUgZW1wdHktYm9keSBmbGFnXG4gICAgICAgIC8vIGNsZWFycywgYW5kIHRoZSBmdW5jdGlvbi1uYW1lIGhhbmRvZmYgYWR2YW5jZXMuXG4gICAgICAgIGFmdGVyS2V5d29yZCA9IGZhbHNlO1xuICAgICAgICBpZiAoZnVuY3Rpb25TZWVuKSB7XG4gICAgICAgICAgaWYgKG5hbWVTZWVuKSB7XG4gICAgICAgICAgICBmdW5jdGlvblNlZW4gPSBmYWxzZTtcbiAgICAgICAgICAgIG5hbWVTZWVuID0gZmFsc2U7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIG5hbWVTZWVuID0gdHJ1ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGJ1ZiArPSB3O1xuICAgICAgaSA9IGo7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gQSBgO2AvYCZgIGRpcmVjdGx5IGFmdGVyIGFuIG9wZW5lciBvciBib2R5IGtleXdvcmQgaXMgYW4gZW1wdHktbGlzdFxuICAgIC8vIHBhcnNlIGVycm9yIGF0IGFueSBkZXB0aCAoYGlmIHRydWU7IHRoZW47IGZpYCwgYHsgOyB9YCxcbiAgICAvLyBgZm9yIGkgaW4gYSBiOyBkbzsgZG9uZWAsIGAoIGlmIHRydWU7IHRoZW47IGZpIClgKS5cbiAgICBpZiAoY2FzZVJlZ2lvbiA9PT0gbnVsbCAmJiBsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLmxlbmd0aCA+IDAgJiYgKGMgPT09ICc7JyB8fCBjID09PSAnJicpICYmIGFmdGVyS2V5d29yZCkge1xuICAgICAgcmVqZWN0KCd1bmNsb3NlZC1jb25zdHJ1Y3QnKTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBpZiAoZGVwdGggPT09IDApIHtcbiAgICAgIC8vIEEgcmVkaXJlY3QgdG9rZW4gd2l0aCBubyB0YXJnZXQgd29yZCwgaW1tZWRpYXRlbHkgZm9sbG93ZWQgYnkgYW5vdGhlclxuICAgICAgLy8gcmVkaXJlY3QgdG9rZW4gbWlkLXN0YWdlLCBpcyBhIHBhcnNlIGVycm9yOiBgY2F0IGYgPiA+IG91dGAsXG4gICAgICAvLyBgY2F0IGYgPiAyPiYxYCwgYGNhdCBmID4gJj5vdXRgLCBgY2F0IGYgPiA8PDwgeGAgKHBsYW4gXHUwMEE3MSkuXG4gICAgICBpZiAoaXNXb3JkU3RhcnQoKSAmJiBsYXN0V29yZElzRGFuZ2xpbmdSZWRpcmVjdCgpICYmIHN0YXJ0c1JlZGlyZWN0QXQoaSkpIHtcbiAgICAgICAgcmVqZWN0KCdkYW5nbGluZy1vcGVyYXRvcicpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnJCcgJiYgY21kW2kgKyAxXSA9PT0gJ3snKSB7XG4gICAgICAgIGJyYWNlRGVwdGggKz0gMTtcbiAgICAgICAgYnVmICs9IGM7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICAvLyBIZXJlZG9jIHJlY29nbml0aW9uIChwbGFuIFx1MDBBNzMpOiBgPDxgL2A8PC1gIChub3QgYDw8PGApIGF0IGRlcHRoIDAgd2l0aFxuICAgICAgLy8gYSBkZWxpbWl0ZXIgd29yZC4gVGhlIG9wZXJhdG9yK2RlbGltaXRlciBhcmUgc3RyaXBwZWQgZnJvbSB0aGUgc3RhZ2VcbiAgICAgIC8vIHRleHQgXHUyMDE0IHRoZSBzdGFnZSBrZWVwcyBhIHBsYWluIGFyZ3YgKGBjYXQgZmAgc3RheXMgYGNhdCBmYCkuXG4gICAgICBpZiAoYyA9PT0gJzwnICYmIGNtZFtpICsgMV0gPT09ICc8JyAmJiBjbWRbaSArIDJdICE9PSAnPCcpIHtcbiAgICAgICAgbGV0IGogPSBpICsgMjtcbiAgICAgICAgbGV0IGFsbG93VGFicyA9IGZhbHNlO1xuICAgICAgICBpZiAoY21kW2pdID09PSAnLScpIHtcbiAgICAgICAgICBhbGxvd1RhYnMgPSB0cnVlO1xuICAgICAgICAgIGogKz0gMTtcbiAgICAgICAgfVxuICAgICAgICB3aGlsZSAoY21kW2pdID09PSAnICcgfHwgY21kW2pdID09PSAnXFx0JykgaiArPSAxO1xuICAgICAgICBsZXQgZGVsaW0gPSAnJztcbiAgICAgICAgaWYgKGNtZFtqXSA9PT0gXCInXCIgfHwgY21kW2pdID09PSAnXCInKSB7XG4gICAgICAgICAgY29uc3QgcSA9IGNtZC5pbmRleE9mKGNtZFtqXSwgaiArIDEpO1xuICAgICAgICAgIGlmIChxID09PSAtMSkge1xuICAgICAgICAgICAgZGVsaW0gPSBjbWQuc2xpY2UoaiArIDEpO1xuICAgICAgICAgICAgaiA9IG47XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGRlbGltID0gY21kLnNsaWNlKGogKyAxLCBxKTtcbiAgICAgICAgICAgIGogPSBxICsgMTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc3Qgd29yZFN0YXJ0ID0gajtcbiAgICAgICAgICB3aGlsZSAoaiA8IG4gJiYgIVdPUkRfRU5ELnRlc3QoY21kW2pdKSkgaiArPSAxO1xuICAgICAgICAgIGRlbGltID0gY21kLnNsaWNlKHdvcmRTdGFydCwgaik7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGRlbGltICE9PSAnJykge1xuICAgICAgICAgIGhlcmVkb2NzLnB1c2goe1xuICAgICAgICAgICAgY2xvc2U6IG5ldyBSZWdFeHAoYF4ke2FsbG93VGFicyA/ICdcXHQqJyA6ICcnfSR7ZXNjYXBlUmVnRXhwKGRlbGltKX1bIFxcXFx0XSokYClcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBpZiAobGV2ZWxzW2xldmVscy5sZW5ndGggLSAxXS5sZW5ndGggPiAwIHx8IGNhc2VSZWdpb24gIT09IG51bGwpIHtcbiAgICAgICAgICAgIC8vIEluc2lkZSBhbiBvcGVuIGNvbnN0cnVjdCB0aGUgb3BlcmF0b3IrZGVsaW1pdGVyIHN0YXkgaW4gdGhlXG4gICAgICAgICAgICAvLyBzdGFnZSB0ZXh0IFx1MjAxNCB0aGUgd2FsaydzIGludGVyaW9yIHJlLXNwbGl0IHJlLXJlY29nbml6ZXMgdGhlXG4gICAgICAgICAgICAvLyBoZXJlZG9jIHRoZXJlIChwbGFuIFx1MDBBNzMpLlxuICAgICAgICAgICAgYnVmICs9IGNtZC5zbGljZShpLCBqKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaSA9IGo7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIFdoaWxlIGEgY29uc3RydWN0IGlzIG9wZW4gYXQgZGVwdGggMCB0aGUgYm91bmRhcnkgb3BlcmF0b3JzIGFyZSB0ZXh0IFx1MjAxNFxuICAgICAgLy8gdGhlIGNvbnN0cnVjdCBpcyBvbmUgc3RhZ2UuXG4gICAgICBpZiAoY2FzZVJlZ2lvbiA9PT0gbnVsbCAmJiBsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBpZiAoY21kLnNsaWNlKGksIGkgKyAyKSA9PT0gJyYmJykge1xuICAgICAgICAgIGlmIChpc1VuY29uc3VtZWRPcGVyYXRvcigpIHx8IGxhc3RXb3JkSXNEYW5nbGluZ1JlZGlyZWN0KCkpIHtcbiAgICAgICAgICAgIHJlamVjdCgnZGFuZ2xpbmctb3BlcmF0b3InKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBmbHVzaCgnYW5kJyk7XG4gICAgICAgICAgaSArPSAyO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjbWQuc2xpY2UoaSwgaSArIDIpID09PSAnfHwnKSB7XG4gICAgICAgICAgaWYgKGlzVW5jb25zdW1lZE9wZXJhdG9yKCkgfHwgbGFzdFdvcmRJc0RhbmdsaW5nUmVkaXJlY3QoKSkge1xuICAgICAgICAgICAgcmVqZWN0KCdkYW5nbGluZy1vcGVyYXRvcicpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGZsdXNoKCdvcicpO1xuICAgICAgICAgIGkgKz0gMjtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY21kLnNsaWNlKGksIGkgKyAyKSA9PT0gJ3wmJykge1xuICAgICAgICAgIGlmIChpc1VuY29uc3VtZWRPcGVyYXRvcigpIHx8IGxhc3RXb3JkSXNEYW5nbGluZ1JlZGlyZWN0KCkpIHtcbiAgICAgICAgICAgIHJlamVjdCgnZGFuZ2xpbmctb3BlcmF0b3InKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBmbHVzaCgncGlwZScpO1xuICAgICAgICAgIGkgKz0gMjtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoYyA9PT0gJzsnKSB7XG4gICAgICAgICAgaWYgKGlzVW5jb25zdW1lZE9wZXJhdG9yKCkgfHwgbGFzdFdvcmRJc0RhbmdsaW5nUmVkaXJlY3QoKSkge1xuICAgICAgICAgICAgcmVqZWN0KCdkYW5nbGluZy1vcGVyYXRvcicpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGZsdXNoKCdzZW1pY29sb24nKTtcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGMgPT09ICd8Jykge1xuICAgICAgICAgIGlmIChpc1VuY29uc3VtZWRPcGVyYXRvcigpIHx8IGxhc3RXb3JkSXNEYW5nbGluZ1JlZGlyZWN0KCkpIHtcbiAgICAgICAgICAgIHJlamVjdCgnZGFuZ2xpbmctb3BlcmF0b3InKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBmbHVzaCgncGlwZScpO1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoYyA9PT0gJ1xcbicpIHtcbiAgICAgICAgICAvLyBBIG5ld2xpbmUgaXMgYSBsaW5lIGNvbnRpbnVhdGlvbiBcdTIwMTQgbm90IGEgc3RhdGVtZW50IHNlcGFyYXRvciBcdTIwMTQgd2hlblxuICAgICAgICAgIC8vIGEgcGlwZS9hbmQvb3Igb3BlcmF0b3IgaXMgcGVuZGluZyB3aXRoIGEgd2hpdGVzcGFjZS1vbmx5IGJ1ZmZlclxuICAgICAgICAgIC8vIHNpbmNlIGl0IChgY2F0IGEudHh0IHxcXG5zZWQgLi4uYCwgYGZhbHNlICYmXFxuc2VkIC4uLmApLiBgY2F0IGYgfCBoZWFkIC0xXFxuY2F0IGdgXG4gICAgICAgICAgLy8gaXMgdGhlcmVmb3JlIHR3byBsaXN0cywgYW5kIGEgcmVkaXJlY3QgdGFyZ2V0IG5ldmVyIGNvbnRpbnVlcyBvbnRvXG4gICAgICAgICAgLy8gYSBsYXRlciBsaW5lIChwbGFuIFx1MDBBNzEpLlxuICAgICAgICAgIGlmIChpc1VuY29uc3VtZWRPcGVyYXRvcigpKSB7XG4gICAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGxhc3RXb3JkSXNEYW5nbGluZ1JlZGlyZWN0KCkpIHtcbiAgICAgICAgICAgIHJlamVjdCgnZGFuZ2xpbmctb3BlcmF0b3InKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBmbHVzaCgnbmV3bGluZScpO1xuICAgICAgICAgIGxpc3RTdGFydCA9IHBhcnRzLmxlbmd0aDtcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGMgPT09ICcmJykge1xuICAgICAgICAgIC8vIEEgYmFyZSBgJmAgaXMgYSBiYWNrZ3JvdW5kIG9wZXJhdG9yIG9ubHkgd2hlbiBpdCBpcyBub3QgcGFydCBvZiBhXG4gICAgICAgICAgLy8gcmVkaXJlY3QgdG9rZW46IHRoZSBuZXh0IGNoYXJhY3RlciBpcyBgPmAgKGAmPmAvYCY+PmApLCBvciB0aGVcbiAgICAgICAgICAvLyBidWZmZXIncyBsYXN0IGNoYXJhY3RlciBpcyBgPmAgb3IgYDxgIChgMj4mMWAsIGA+JiBmaWxlYCwgYDM8JjBgKS5cbiAgICAgICAgICAvLyBTcGxpdHRpbmcgaW5zaWRlIHRob3NlIHRva2VucyB3b3VsZCBwcm9kdWNlIGp1bmsgc3RhZ2VzLlxuICAgICAgICAgIGNvbnN0IG5leHQgPSBjbWRbaSArIDFdO1xuICAgICAgICAgIGNvbnN0IGxhc3QgPSBidWZbYnVmLmxlbmd0aCAtIDFdO1xuICAgICAgICAgIGlmIChuZXh0ICE9PSAnPicgJiYgbGFzdCAhPT0gJz4nICYmIGxhc3QgIT09ICc8Jykge1xuICAgICAgICAgICAgaWYgKGlzVW5jb25zdW1lZE9wZXJhdG9yKCkgfHwgbGFzdFdvcmRJc0RhbmdsaW5nUmVkaXJlY3QoKSkge1xuICAgICAgICAgICAgICByZWplY3QoJ2RhbmdsaW5nLW9wZXJhdG9yJyk7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZmx1c2goJ2JhY2tncm91bmQnKTtcbiAgICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBidWYgKz0gYztcbiAgICBpICs9IDE7XG4gIH1cblxuICAvLyBFbmQgb2YgaW5wdXQ6IHRoZSBFT0Ytc3RhdGUgdmVyZGljdHMgXHUyMDE0IGFuIHVuY2xvc2VkIHF1b3RlLCBicmFjZSwgY2FzZVxuICAvLyByZWdpb24sIHBhcmVuIGxldmVsLCBvciBjb25zdHJ1Y3QgXHUyMDE0IHRoZW4gdGhlIHVuY29uc3VtZWQtb3BlcmF0b3IgY2hlY2tzLFxuICAvLyB0aGVuIHRoZSB1bnRlcm1pbmF0ZWQtaGVyZWRvYyBwYXJ0aWFsLCB0aGVuIHRoZSBmaW5hbCBmbHVzaC4gQSB2ZXJkaWN0XG4gIC8vIHNldCBtaWQtc2NhbiBhbHJlYWR5IGRyb3BwZWQgdGhlIHJlamVjdGluZyBsaXN0IGFuZCBlbmRlZCB0aGUgbG9vcCwgc29cbiAgLy8gYHBhcnRzYCBpcyBleGFjdGx5IHRoZSBjb21wbGV0ZWQgZWFybGllciBsaXN0cyBoZXJlLlxuICBpZiAobWFsZm9ybWVkKSByZXR1cm4geyBzdGFnZXM6IHBhcnRzLCBtYWxmb3JtZWQgfTtcbiAgaWYgKGluU3F1b3RlIHx8IGluRHF1b3RlKSB7XG4gICAgcmVqZWN0KCd1bmNsb3NlZC1xdW90ZScpO1xuICB9IGVsc2UgaWYgKGJyYWNlRGVwdGggPiAwKSB7XG4gICAgcmVqZWN0KCd1bmNsb3NlZC1icmFjZScpO1xuICB9IGVsc2UgaWYgKGNhc2VSZWdpb24gIT09IG51bGwpIHtcbiAgICByZWplY3QoJ3VuY2xvc2VkLWNhc2UnKTtcbiAgfSBlbHNlIGlmIChkZXB0aCA+IDApIHtcbiAgICByZWplY3QoJ3VuYmFsYW5jZWQtcGFyZW4nKTtcbiAgfSBlbHNlIGlmIChsZXZlbHNbbGV2ZWxzLmxlbmd0aCAtIDFdLmxlbmd0aCA+IDApIHtcbiAgICByZWplY3QoJ3VuY2xvc2VkLWNvbnN0cnVjdCcpO1xuICB9IGVsc2UgaWYgKGlzVW5jb25zdW1lZE9wZXJhdG9yKCkgfHwgbGFzdFdvcmRJc0RhbmdsaW5nUmVkaXJlY3QoKSkge1xuICAgIHJlamVjdCgnZGFuZ2xpbmctb3BlcmF0b3InKTtcbiAgfSBlbHNlIGlmIChpbkJvZHkgfHwgaGVyZWRvY3MubGVuZ3RoID4gMCkge1xuICAgIC8vIFVudGVybWluYXRlZCBoZXJlZG9jIFx1MjAxNCBiYXNoIHdhcm5zLCBydW5zIHRoZSBkZWxpbWl0ZXIncyBsaW5lLCBhbmRcbiAgICAvLyB0cmVhdHMgdGhlIHRhaWwgYXMgYm9keTogdGhlIHBhcnRpYWwuIFRoZSBkZWxpbWl0ZXIncy1saW5lIHN0YWdlKHMpXG4gICAgLy8gYW5hbHl6ZSBhcy1pczsgdGhlIGJvZHkgcHJvZHVjZXMgbm8gc3RhZ2VzIChwbGFuIFx1MDBBNzMpLlxuICAgIGZsdXNoKCduZXdsaW5lJyk7XG4gICAgbWFsZm9ybWVkID0gJ3VudGVybWluYXRlZC1oZXJlZG9jJztcbiAgfSBlbHNlIHtcbiAgICBmbHVzaCgnbmV3bGluZScpO1xuICB9XG4gIHJldHVybiB7IHN0YWdlczogcGFydHMsIG1hbGZvcm1lZCB9O1xufVxuXG5jb25zdCBMRUFESU5HX0FTU0lHTk1FTlQgPSAvXig/OltBLVphLXpfXVtBLVphLXowLTlfXSo9XFxTKlxccyspKy87XG5cbi8qKiBTdHJpcCBsZWFkaW5nIEZPTz1iYXIgVkFSPWJheiBlbnYtcHJlZml4IGFzc2lnbm1lbnRzIGZyb20gYSBzaW1wbGUgY29tbWFuZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdHJpcExlYWRpbmdBc3NpZ25tZW50cyhzaW1wbGVDbWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBzaW1wbGVDbWQucmVwbGFjZShMRUFESU5HX0FTU0lHTk1FTlQsICcnKTtcbn1cblxuLyoqIFF1b3RlLWF3YXJlIHdoaXRlc3BhY2UgdG9rZW5pemVyLCByb3VnaGx5IG1hdGNoaW5nIGBzaGxleC5zcGxpdChzLCBwb3NpeD1UcnVlKWAuIFJldHVybnMgbnVsbCBvbiB1bmJhbGFuY2VkIHF1b3Rlcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzcGxpdFdvcmRzKHM6IHN0cmluZyk6IHN0cmluZ1tdIHwgbnVsbCB7XG4gIGNvbnN0IHdvcmRzOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgY3VyID0gJyc7XG4gIGxldCBoYXMgPSBmYWxzZTtcbiAgbGV0IGkgPSAwO1xuICBjb25zdCBuID0gcy5sZW5ndGg7XG5cbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgY29uc3QgYyA9IHNbaV07XG4gICAgaWYgKC9cXHMvLnRlc3QoYykpIHtcbiAgICAgIGlmIChoYXMpIHtcbiAgICAgICAgd29yZHMucHVzaChjdXIpO1xuICAgICAgICBjdXIgPSAnJztcbiAgICAgICAgaGFzID0gZmFsc2U7XG4gICAgICB9XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09IFwiJ1wiKSB7XG4gICAgICBoYXMgPSB0cnVlO1xuICAgICAgaSArPSAxO1xuICAgICAgY29uc3QgZW5kID0gcy5pbmRleE9mKFwiJ1wiLCBpKTtcbiAgICAgIGlmIChlbmQgPT09IC0xKSByZXR1cm4gbnVsbDtcbiAgICAgIGN1ciArPSBzLnNsaWNlKGksIGVuZCk7XG4gICAgICBpID0gZW5kICsgMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1wiJykge1xuICAgICAgaGFzID0gdHJ1ZTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIHdoaWxlIChpIDwgbiAmJiBzW2ldICE9PSAnXCInKSB7XG4gICAgICAgIGlmIChzW2ldID09PSAnXFxcXCcgJiYgaSArIDEgPCBuICYmICdcIlxcXFwkYCcuaW5jbHVkZXMoc1tpICsgMV0pKSB7XG4gICAgICAgICAgY3VyICs9IHNbaSArIDFdO1xuICAgICAgICAgIGkgKz0gMjtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjdXIgKz0gc1tpXTtcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChpID49IG4pIHJldHVybiBudWxsO1xuICAgICAgaSArPSAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXFxcXCcgJiYgaSArIDEgPCBuKSB7XG4gICAgICBoYXMgPSB0cnVlO1xuICAgICAgY3VyICs9IHNbaSArIDFdO1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGhhcyA9IHRydWU7XG4gICAgY3VyICs9IGM7XG4gICAgaSArPSAxO1xuICB9XG4gIGlmIChoYXMpIHdvcmRzLnB1c2goY3VyKTtcbiAgcmV0dXJuIHdvcmRzO1xufVxuXG4vKiogQmVzdC1lZmZvcnQgYXJndiBmb3IgYSBzaW1wbGUgY29tbWFuZDogbGVhZGluZyBhc3NpZ25tZW50cyBzdHJpcHBlZCwgcXVvdGUtYXdhcmUgc3BsaXQuIFJldHVybnMgbnVsbCBpZiB0aGUgY29tbWFuZCBkb2Vzbid0IHRva2VuaXplIGNsZWFubHkgKHVuYmFsYW5jZWQgcXVvdGVzKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhcmd2T2Yoc2ltcGxlQ21kOiBzdHJpbmcpOiBzdHJpbmdbXSB8IG51bGwge1xuICByZXR1cm4gc3BsaXRXb3JkcyhzdHJpcExlYWRpbmdBc3NpZ25tZW50cyhzaW1wbGVDbWQpLnRyaW0oKSk7XG59XG5cbi8qKlxuICogUmVkaXJlY3Qgb3BlcmF0b3JzIHRoYXQgZHJvcCB0b2dldGhlciB3aXRoIHRoZWlyIHBsYWluIHRhcmdldCB3b3JkIChwbGFuIFx1MDBBNzRcbiAqIHR3by10b2tlbiBzaGFwZXMpOiBgPmAsIGA+PmAsIGA8YCwgYDw+YCwgYCY+YCwgYCY+PmAsIGFuZCBkaWdpdC1wcmVmaXhlZFxuICogZm9ybXMgbGlrZSBgMj5gL2AyPj5gL2AzPGAuIGA+fGAgaXMgZGVsaWJlcmF0ZWx5IGFic2VudCBcdTIwMTQgaXQgZmFpbHMgY2xvc2VkLlxuICovXG5jb25zdCBSRURJUkVDVF9UV09fVE9LRU4gPSAvXig/Oj4+P3w8Pnw8fCY+Pj98WzAtOV0rKD86Pj4/fDw+fDwpKSQvO1xuXG4vKiogRHVwIGZvcm1zIHRoYXQgZHJvcCBhbG9uZSAocGxhbiBcdTAwQTc0KTogYDI+JjFgLCBgPiYtYCwgYDM8JjBgLiAqL1xuY29uc3QgUkVESVJFQ1RfRFVQID0gL14oPzpbMC05XSspP1s8Pl0mKD86WzAtOV0rfC0pJC87XG5cbi8qKiBGdXNlZCBvcGVyYXRvcit0YXJnZXQgd29yZHMgdGhhdCBkcm9wIHdob2xlIChwbGFuIFx1MDBBNzQpOiBgPm91dGAsIGAyPmVycmAsIGAmPm91dGAuICovXG5jb25zdCBSRURJUkVDVF9GVVNFRCA9IC9eKD86Pj4/fDw+fDx8Jj4+P3xbMC05XSsoPzo+Pj98PD58PCkpW148PiZ8XS87XG5cbi8qKiBIZXJlZG9jL2hlcmUtc3RyaW5nIG9wZXJhdG9ycyB3aXRoIGEgc2VwYXJhdGUgdGFyZ2V0IHdvcmQ6IGA8PGAsIGA8PC1gLCBgPDw8YC4gKi9cbmNvbnN0IEhFUkVET0NfVFdPX1RPS0VOID0gL14oPzo8PC0/fDw8PCkkLztcblxuLyoqIEZ1c2VkIGhlcmVkb2Mgd29yZHMgKHBsYW4gXHUwMEE3NCk6IGA8PEVPRmAsIGA8PC1FT0ZgLCBgPDw8eGAuICovXG5jb25zdCBIRVJFRE9DX0ZVU0VEID0gL14oPzo8PC0/fDw8PClbXjw+JnxdLztcblxuLyoqIFdoZXRoZXIgYSB3b3JkIGlzIGl0c2VsZiBhIHJlZGlyZWN0IHRva2VuIFx1MjAxNCBuZXZlciBhIHZhbGlkIHJlZGlyZWN0IHRhcmdldC4gKi9cbmNvbnN0IFJFRElSRUNUX1RPS0VOID0gKHc6IHN0cmluZyk6IGJvb2xlYW4gPT5cbiAgUkVESVJFQ1RfVFdPX1RPS0VOLnRlc3QodykgfHxcbiAgUkVESVJFQ1RfRFVQLnRlc3QodykgfHxcbiAgUkVESVJFQ1RfRlVTRUQudGVzdCh3KSB8fFxuICBIRVJFRE9DX1RXT19UT0tFTi50ZXN0KHcpIHx8XG4gIEhFUkVET0NfRlVTRUQudGVzdCh3KTtcblxuLyoqXG4gKiBTdHJpcCByZWRpcmVjdCB0b2tlbnMgZnJvbSBhIHNpbXBsZSBjb21tYW5kJ3MgYXJndiBzbyB0aGUgcmVhZC1zaWRlXG4gKiBtYXRjaGVycyBzZWUgdGhlIHdvcmRzIHRoYXQgd2VyZSBhY3R1YWxseSByZWFkIChwbGFuIFx1MDBBNzQpOiB0d28tdG9rZW5cbiAqIG9wZXJhdG9ycyAoYD5gLCBgPj5gLCBgPGAsIGA8PmAsIGAmPmAsIGAmPj5gLCBkaWdpdC1wcmVmaXhlZCBgMj5gL2AyPj5gL1xuICogYDM8YCwgLi4uKSBkcm9wIHRvZ2V0aGVyIHdpdGggdGhlaXIgcGxhaW4gdGFyZ2V0IHdvcmQsIGR1cCBmb3JtcyAoYDI+JjFgLFxuICogYD4mLWAsIGAzPCYwYCkgZHJvcCBhbG9uZSwgZnVzZWQgZm9ybXMgKGA+b3V0YCwgYDI+ZXJyYCwgYCY+b3V0YCkgZHJvcCBhc1xuICogb25lIHdvcmQsIGFuZCBoZXJlZG9jL2hlcmUtc3RyaW5nIG9wZXJhdG9ycyBkcm9wIHdpdGggdGhlaXIgdGFyZ2V0IHdvcmQgaW5cbiAqIGJvdGggc3BlbGxpbmdzLiBBIHR3by10b2tlbiBvcGVyYXRvcidzIHRhcmdldCBtdXN0IGJlIGEgcGxhaW4gZmlsZSB3b3JkIFx1MjAxNCBhXG4gKiBmb2xsb3dpbmcgcmVkaXJlY3QgdG9rZW4gKGBjYXQgZiA+IDI+JjFgKSBpcyBiYXNoJ3MgXCJzeW50YXggZXJyb3IgbmVhclxuICogdW5leHBlY3RlZCB0b2tlblwiIGFuZCBsZWF2ZXMgdGhlIG9wZXJhdG9yIGRhbmdsaW5nLCB1bm1hdGNoZWQuIEFueXRoaW5nXG4gKiBlbHNlIGJlZ2lubmluZyB3aXRoIGA+YC9gPGAgKG5vdGFibHkgYD58YCkgaXMgbGVmdCBhbG9uZSBcdTIwMTQgdGhlIGNhbGxlclxuICogdHJlYXRzIGEgcmVzaWR1YWwgcmVkaXJlY3Qgd29yZCBhcyBhbiB1bm1hdGNoZWQgc3RhZ2UuIEFwcGxpZWQgdG8gZXZlcnlcbiAqIHN0YWdlIFx1MjAxNCBzb3VyY2VzLCBzZWxlY3RvcnMsIGFuZCBwcmVkaWNhdGVzIFx1MjAxNCBiZWZvcmUgc3RhdHVzIGV2YWx1YXRpb24gYW5kXG4gKiBtYXRjaGVyIGRpc3BhdGNoLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3RyaXBSZWRpcmVjdHMoYXJndjogc3RyaW5nW10pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IG91dDogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBhcmd2Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGFyZ3ZbaV07XG4gICAgaWYgKFJFRElSRUNUX1RXT19UT0tFTi50ZXN0KGEpIHx8IEhFUkVET0NfVFdPX1RPS0VOLnRlc3QoYSkpIHtcbiAgICAgIGNvbnN0IG5leHQgPSBhcmd2W2kgKyAxXTtcbiAgICAgIC8vIFRoZSBvcGVyYXRvcidzIHRhcmdldCBtdXN0IGJlIGEgcGxhaW4gZmlsZSB3b3JkIFx1MjAxNCBhIGZvbGxvd2luZyByZWRpcmVjdFxuICAgICAgLy8gdG9rZW4gbWVhbnMgdGhlIG9wZXJhdG9yIGRhbmdsZXMgYW5kIHRoZSBjb21tYW5kIG5ldmVyIHJ1bnMuIFRoZVxuICAgICAgLy8gZGFuZ2xpbmcgb3BlcmF0b3IgaXRzZWxmIGlzIGxlZnQgaW4gcGxhY2Ugc28gdGhlIGNhbGxlciByZWplY3RzIHRoZVxuICAgICAgLy8gc3RhZ2UgYXMgdW5tYXRjaGVkLlxuICAgICAgaWYgKG5leHQgIT09IHVuZGVmaW5lZCAmJiAhUkVESVJFQ1RfVE9LRU4obmV4dCkpIHtcbiAgICAgICAgaSArPSAxO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgb3V0LnB1c2goYSk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKFJFRElSRUNUX0RVUC50ZXN0KGEpIHx8IFJFRElSRUNUX0ZVU0VELnRlc3QoYSkgfHwgSEVSRURPQ19GVVNFRC50ZXN0KGEpKSBjb250aW51ZTtcbiAgICBvdXQucHVzaChhKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKiogU2hlbGwgYnVpbHRpbnMgdGhlIHdhbGsgcmVjb2duaXplcyBhIGBidWlsdGluYCB3cmFwcGVyIG1heSBmb3J3YXJkIChwbGFuIFx1MDBBNzUpLiAqL1xuY29uc3QgV1JBUFBFUl9CVUlMVElOUyA9IG5ldyBTZXQoW1xuICAnZXhpdCcsXG4gICdleGVjJyxcbiAgJ3RydWUnLFxuICAnZmFsc2UnLFxuICAnOicsXG4gICdjZCcsXG4gICdzZXQnLFxuICAndW5zZXQnLFxuICAnZXhwb3J0JyxcbiAgJ3JlYWRvbmx5JyxcbiAgJ3JldHVybicsXG4gICdicmVhaycsXG4gICdjb250aW51ZSdcbl0pO1xuXG4vKiogRXh0ZXJuYWxzIHdob3NlIGFic29sdXRlIGV4ZWN1dGFibGUgcGF0aHMgc3RyaXAgdG8gdGhlaXIgYmFzZW5hbWUgKHBsYW4gXHUwMEE3NSkuICovXG5jb25zdCBSRUNPR05JWkVEX0VYVEVSTkFMX05BTUVTID0gbmV3IFNldChbXG4gICdzZWQnLFxuICAnaGVhZCcsXG4gICd0YWlsJyxcbiAgJ2NhdCcsXG4gICdubCcsXG4gICdnaXQnLFxuICAndHJ1ZScsXG4gICdmYWxzZScsXG4gICd0aW1lb3V0JyxcbiAgJ2VudicsXG4gICdjb21tYW5kJ1xuXSk7XG5cbi8qKiBBIGB0aW1lb3V0YCBkdXJhdGlvbiB3b3JkOiBgNWAsIGA1LjVzYCwgYDFtYCwgYDJoYCwgLi4uICovXG5jb25zdCBUSU1FT1VUX0RVUkFUSU9OID0gL15cXGQrKD86XFwuXFxkKyk/W3NtaGRdPyQvO1xuXG4vKiogQSBsaXRlcmFsIGBOQU1FPXZhbHVlYCBlbnYtcHJlZml4IHdvcmQuICovXG5jb25zdCBFTlZfQVNTSUdOTUVOVCA9IC9eW0EtWmEtel9dW0EtWmEtejAtOV9dKj0uKiQvO1xuXG4vKipcbiAqIE9uZSBzdHJpcCBzdGVwLiBSZXR1cm5zIG51bGwgd2hlbiB0aGUgd3JhcHBlciBpcyBub3QgY2xlYW4gKGZhaWwgY2xvc2VkIFx1MjAxNFxuICogdGhlIGNhbGxlciByZXN0b3JlcyB0aGUgb3JpZ2luYWwgYXJndiwgc28gbm90aGluZyBpcyBmb3J3YXJkZWQgdG8gdGhlXG4gKiBtYXRjaGVycyksIG9yIHRoZSBhcmd2IHdpdGggb25lIHdyYXBwZXIgbGF5ZXIgcmVtb3ZlZC5cbiAqL1xuZnVuY3Rpb24gc3RyaXBXcmFwcGVyc09uY2UoYXJndjogc3RyaW5nW10pOiBzdHJpbmdbXSB8IG51bGwge1xuICBsZXQgaSA9IDA7XG4gIHdoaWxlIChpIDwgYXJndi5sZW5ndGggJiYgYXJndltpXSA9PT0gJyEnKSBpKys7XG4gIGlmIChpID49IGFyZ3YubGVuZ3RoKSByZXR1cm4gYXJndi5zbGljZShpKTtcbiAgY29uc3QgaGVhZCA9IGFyZ3ZbaV07XG4gIGlmIChoZWFkID09PSAnY29tbWFuZCcpIHtcbiAgICBjb25zdCBuZXh0ID0gYXJndltpICsgMV07XG4gICAgaWYgKG5leHQgPT09ICctdicgfHwgbmV4dCA9PT0gJy1WJykgcmV0dXJuIG51bGw7IC8vIGEgcXVlcnkgXHUyMDE0IHJ1bnMgbm90aGluZ1xuICAgIGlmIChuZXh0ID09PSAnLXAnKSByZXR1cm4gYXJndi5zbGljZShpICsgMik7XG4gICAgaWYgKG5leHQgIT09IHVuZGVmaW5lZCAmJiAhbmV4dC5zdGFydHNXaXRoKCctJykpIHJldHVybiBhcmd2LnNsaWNlKGkgKyAxKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICBpZiAoaGVhZCA9PT0gJ2J1aWx0aW4nKSB7XG4gICAgY29uc3QgbmV4dCA9IGFyZ3ZbaSArIDFdO1xuICAgIGlmIChuZXh0ICE9PSB1bmRlZmluZWQgJiYgV1JBUFBFUl9CVUlMVElOUy5oYXMobmV4dCkpIHJldHVybiBhcmd2LnNsaWNlKGkgKyAyKTtcbiAgICByZXR1cm4gbnVsbDsgLy8gYGJ1aWx0aW4gc2VkYCBlcnJvcnMgXHUyMDE0IG5ldmVyIGZvcndhcmQgYSBub24tYnVpbHRpbiB3b3JkXG4gIH1cbiAgaWYgKGhlYWQgPT09ICdlbnYnKSB7XG4gICAgbGV0IGogPSBpICsgMTtcbiAgICB3aGlsZSAoaiA8IGFyZ3YubGVuZ3RoICYmIEVOVl9BU1NJR05NRU5ULnRlc3QoYXJndltqXSkpIGorKztcbiAgICBpZiAoaiA9PT0gaSArIDEpIHJldHVybiBudWxsOyAvLyBgLWlgLCBgLXUgWGAsIGEgbm9uLWFzc2lnbm1lbnQgd29yZCBcdTIwMTQgbm90IGEgY2xlYW4gd3JhcHBlclxuICAgIHJldHVybiBhcmd2LnNsaWNlKGopO1xuICB9XG4gIGlmIChoZWFkID09PSAndGltZW91dCcpIHtcbiAgICBsZXQgaiA9IGkgKyAxO1xuICAgIHdoaWxlIChqIDwgYXJndi5sZW5ndGggJiYgYXJndltqXS5zdGFydHNXaXRoKCctLScpKSBqKys7XG4gICAgaWYgKGogPj0gYXJndi5sZW5ndGggfHwgIVRJTUVPVVRfRFVSQVRJT04udGVzdChhcmd2W2pdKSkgcmV0dXJuIG51bGw7IC8vIG5vIGR1cmF0aW9uIFx1MjAxNCBub3RoaW5nIHJ1bnNcbiAgICByZXR1cm4gYXJndi5zbGljZShqICsgMSk7XG4gIH1cbiAgaWYgKGhlYWQuc3RhcnRzV2l0aCgnLycpKSB7XG4gICAgY29uc3QgYmFzZSA9IGhlYWQuc2xpY2UoaGVhZC5sYXN0SW5kZXhPZignLycpICsgMSk7XG4gICAgaWYgKFJFQ09HTklaRURfRVhURVJOQUxfTkFNRVMuaGFzKGJhc2UpKSByZXR1cm4gW2Jhc2UsIC4uLmFyZ3Yuc2xpY2UoaSArIDEpXTtcbiAgICByZXR1cm4gbnVsbDsgLy8gYC91c3IvYmluL2V4aXRgIGFuZCBmcmllbmRzIGFyZSBub3QgcmVjb2duaXplZCBleHRlcm5hbHNcbiAgfVxuICBpZiAoaGVhZC5pbmNsdWRlcygnLycpKSByZXR1cm4gbnVsbDsgLy8gYSByZWxhdGl2ZSBjb2xsaWRpbmcgcGF0aCBpcyBhIGxvY2FsIGJpbmFyeSwgbm90IHRoZSBjb3JldXRpbFxuICByZXR1cm4gYXJndi5zbGljZShpKTtcbn1cblxuLyoqXG4gKiBTdHJpcCB0cmFuc3BhcmVudCB3cmFwcGVyIHByZWZpeGVzIGZyb20gYSBzaW1wbGUgY29tbWFuZCdzIGFyZ3Ygc28gbWF0Y2hlclxuICogZGlzcGF0Y2ggc2VlcyB0aGUgdW5kZXJseWluZyBjb21tYW5kIHdvcmQgKHBsYW4gXHUwMEE3NSk6IGBjb21tYW5kYCAoc3RvcHBpbmcgYXRcbiAqIHRoZSBxdWVyeSBmb3JtcyBgLXZgL2AtVmApLCBgYnVpbHRpbmAgcmVzdHJpY3RlZCB0byB0aGUgd2FsaydzIHJlY29nbml6ZWRcbiAqIGJ1aWx0aW5zLCBgZW52IE5BTUU9dmFsdWVgIHByZWZpeGVzLCBgdGltZW91dGAgcGx1cyBpdHMgYC0tKmAgZmxhZ3MgYW5kIG9uZVxuICogZHVyYXRpb24sIGFuZCBhYnNvbHV0ZSBleGVjdXRhYmxlIHBhdGhzIHdob3NlIGJhc2VuYW1lIGlzIGluIHRoZSByZWNvZ25pemVkXG4gKiBzZXQgXHUyMDE0IGl0ZXJhdGluZyB1bnRpbCBmaXhlZC1wb2ludCBzbyBzdGFja2VkIHdyYXBwZXJzIHN0aWxsIHJlYWNoIHRoZSB3b3JkLlxuICogQW55IHVuY2xlYW4gd3JhcHBlciBmYWlscyBjbG9zZWQ6IHRoZSBvcmlnaW5hbCBhcmd2IGlzIHJldHVybmVkIHVuY2hhbmdlZCxcbiAqIHNvIHRoZSBzdGFnZSBtYXRjaGVzIG5vdGhpbmcuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdHJpcFdyYXBwZXJzKGFyZ3Y6IHN0cmluZ1tdKTogc3RyaW5nW10ge1xuICBsZXQgY3VycmVudCA9IGFyZ3Y7XG4gIGZvciAobGV0IGl0ZXIgPSAwOyBpdGVyIDwgYXJndi5sZW5ndGggKyAyOyBpdGVyKyspIHtcbiAgICBjb25zdCBuZXh0ID0gc3RyaXBXcmFwcGVyc09uY2UoY3VycmVudCk7XG4gICAgaWYgKG5leHQgPT09IG51bGwpIHJldHVybiBhcmd2O1xuICAgIGlmIChuZXh0Lmxlbmd0aCA9PT0gY3VycmVudC5sZW5ndGggJiYgbmV4dC5ldmVyeSgodywgaykgPT4gdyA9PT0gY3VycmVudFtrXSkpIHJldHVybiBjdXJyZW50O1xuICAgIGN1cnJlbnQgPSBuZXh0O1xuICB9XG4gIHJldHVybiBhcmd2O1xufVxuIiwgIi8qKlxuICogVmFyaWFibGUgcmVzb2x1dGlvbiBmb3IgdGhlIGV4ZWN1dGlvbi1hd2FyZSBCYXNoIHRvdWNoIHBhcnNlciAocGxhbiBcdTAwQTc3KS5cbiAqXG4gKiBFeHBhbnNpb24gcnVucyBvdmVyIHRoZSByYXcgc2ltcGxlLWNvbW1hbmQgdGV4dCAqYmVmb3JlKiB0b2tlbml6aW5nLCB3aXRoIGFcbiAqIHF1b3RlLWF3YXJlIHNjYW5uZXI6IHNpbmdsZS1xdW90ZWQgc3BhbnMgc3RheSBsaXRlcmFsLCBkb3VibGUtcXVvdGVkIGFuZFxuICogdW5xdW90ZWQgc3BhbnMgZXhwYW5kIGAkVkFSYCBhbmQgYCR7VkFSfWAgKGdyZWVkeSBpZGVudGlmaWVyKSwgYW5kIGFcbiAqIGJhY2tzbGFzaC1lc2NhcGVkIGAkYCBzdGF5cyBsaXRlcmFsLiBFeHBhbmRpbmcgYmVmb3JlIHRva2VuaXppbmcga2VlcHMgYW5cbiAqIGV4cGFuZGVkIHZhbHVlJ3MgYCYmYC9zcGFjZXMgb3V0IG9mIHRoZSBzcGxpdHRlcidzIHJlYWNoLiBWYWx1ZSBwcmVjZWRlbmNlXG4gKiBpcyBzY3JpcHQgdmFyaWFibGUgdGFibGUgPiBlbnYgPiB1bnJlc29sdmVkIFx1MjAxNCBhIG5hbWUgYWJzZW50IGZyb20gYm90aCBpc1xuICogbGVmdCBhcyB0aGUgcmVzaWR1YWwgYCRgLCB3aGljaCB0cmlwcyB0aGUgcGFyc2VyJ3MgYGxvb2tzVW5yZXNvbHZhYmxlYCBwYXRoXG4gKiAoZmFpbCBjbG9zZWQsIG5vIHRvdWNoKS5cbiAqXG4gKiBUaGUgZW52IGlzIGV4cGVjdGVkIHRvIGJlIHByZS1jdXJhdGVkOiBgcGFyc2VDb21tYW5kRGV0YWlsZWRgIGdhdGVzIGl0c1xuICogYHByb2Nlc3MuZW52YCBkZWZhdWx0IGJ5IGBQYXJzZU9wdGlvbnMuYWxsb3dsaXN0YCAoc28gb25seSB0aGVcbiAqIGBERUZBVUxUX1BBVEhfQUxMT1dMSVNUYCBuYW1lcyBldmVyIHJlc29sdmUgZnJvbSB0aGUgaG9vayBlbnYpLCB3aGlsZSBhblxuICogZXhwbGljaXRseSBpbmplY3RlZCBlbnYgXHUyMDE0IGFzIGluIHRlc3RzIFx1MjAxNCBpcyBjb25zdWx0ZWQgd2hvbGVzYWxlLlxuICovXG5cbi8qKlxuICogVGhlIHNoYXJlZCBhbGxvd2xpc3Qgb2YgaG9vay1lbnYgdmFyaWFibGUgbmFtZXMgcGF0aCBhcmd1bWVudHMgbWF5IHJlc29sdmVcbiAqIGZyb20gXHUyMDE0IGlkZW50aWNhbCBhY3Jvc3MgaGFybmVzc2VzIHNvIHRoZSBzYW1lIGNvbW1hbmQgc3RyaW5nIHByb2R1Y2VzIHRoZVxuICogc2FtZSB0b3VjaGVzIGV2ZXJ5d2hlcmUuIEFuIGFsbG93bGlzdGVkIG5hbWUgYWJzZW50IGZyb20gYSBwYXJ0aWN1bGFyIGhvb2tcbiAqIGVudiBzdGF5cyB1bnJlc29sdmVkIChmYWlsIGNsb3NlZCksIHNvIHRoZSBsaXN0IGlzIHNhZmUgdG8gc2hhcmUuXG4gKi9cbmV4cG9ydCBjb25zdCBERUZBVUxUX1BBVEhfQUxMT1dMSVNUID0gW1xuICAnSE9NRScsXG4gICdQV0QnLFxuICAnV09SS1NQQUNFX1BBVEgnLFxuICAnQ0FSRF9SRVBPX1BBVEgnLFxuICAnUkVQT19ST09UJyxcbiAgJ0JBU0VfQlJBTkNIJ1xuXSBhcyBjb25zdDtcblxuLyoqIEEgYmFyZSByZWZlcmVuY2UgbmFtZTogZ3JlZWR5IGlkZW50aWZpZXIgYWZ0ZXIgYCRgLiAqL1xuY29uc3QgQkFSRV9OQU1FID0gL15bQS1aYS16X11bQS1aYS16MC05X10qLztcblxuLyoqIEEgYnJhY2VkIHJlZmVyZW5jZSBtdXN0IGJlIGV4YWN0bHkgYW4gaWRlbnRpZmllciBcdTIwMTQgYCR7IVh9YCwgYCR7WDotZH1gLCBgJHsjWH1gIG5ldmVyIGV4cGFuZC4gKi9cbmNvbnN0IEJSQUNFRF9OQU1FID0gL15bQS1aYS16X11bQS1aYS16MC05X10qJC87XG5cbi8qKlxuICogRXhwYW5kIGAkVkFSYCAvIGAke1ZBUn1gIHJlZmVyZW5jZXMgaW4gYSBzaW1wbGUgY29tbWFuZCdzIHJhdyB0ZXh0IChwbGFuXG4gKiBcdTAwQTc3KS4gYCQoXHUyMDI2KWAsIGAkKChcdTIwMjYpKWAsIGAkeyFYfWAgaW5kaXJlY3QgZXhwYW5zaW9uLCBgJHtYOlx1MjAyNn1gIG9wZXJhdG9ycyxcbiAqIHNwZWNpYWwgcGFyYW1ldGVycywgYW5kIHVua25vd24gdmFyaWFibGVzIHN0YXkgdW50b3VjaGVkLlxuICpcbiAqIEBwYXJhbSB0ZXh0IFRoZSByYXcgc2ltcGxlLWNvbW1hbmQgdGV4dCwgYmVmb3JlIHRva2VuaXppbmcuXG4gKiBAcGFyYW0gdmFyaWFibGVzIFRoZSBzY3JpcHQgdmFyaWFibGUgdGFibGUgZnJvbSBleGVjdXRlZCBub24tcGlwZSBhc3NpZ25tZW50XG4gKiAgIHN0YWdlcywgaW4gb3JkZXIgKHRha2VzIHByZWNlZGVuY2Ugb3ZlciBgZW52YCkuXG4gKiBAcGFyYW0gZW52IFRoZSBjdXJhdGVkIGVudmlyb25tZW50ICh0aGUgcGFyc2VyIGdhdGVzIGl0cyBgcHJvY2Vzcy5lbnZgXG4gKiAgIGRlZmF1bHQgYnkgYERFRkFVTFRfUEFUSF9BTExPV0xJU1RgOyBhbiBpbmplY3RlZCBlbnYgaXMgdXNlZCB3aG9sZXNhbGUpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXhwYW5kVmFyaWFibGVzKFxuICB0ZXh0OiBzdHJpbmcsXG4gIHZhcmlhYmxlczogUmVhZG9ubHlNYXA8c3RyaW5nLCBzdHJpbmc+LFxuICBlbnY6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHVuZGVmaW5lZD5cbik6IHN0cmluZyB7XG4gIGNvbnN0IHJlc29sdmUgPSAobmFtZTogc3RyaW5nKTogc3RyaW5nIHwgdW5kZWZpbmVkID0+IHtcbiAgICBjb25zdCBmcm9tVGFibGUgPSB2YXJpYWJsZXMuZ2V0KG5hbWUpO1xuICAgIGlmIChmcm9tVGFibGUgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGZyb21UYWJsZTtcbiAgICBjb25zdCBmcm9tRW52ID0gZW52W25hbWVdO1xuICAgIHJldHVybiBmcm9tRW52ICE9PSB1bmRlZmluZWQgPyBmcm9tRW52IDogdW5kZWZpbmVkO1xuICB9O1xuXG4gIGxldCBvdXQgPSAnJztcbiAgbGV0IGkgPSAwO1xuICBjb25zdCBuID0gdGV4dC5sZW5ndGg7XG4gIGxldCBpblNpbmdsZSA9IGZhbHNlO1xuICBsZXQgaW5Eb3VibGUgPSBmYWxzZTtcbiAgd2hpbGUgKGkgPCBuKSB7XG4gICAgY29uc3QgYyA9IHRleHRbaV07XG4gICAgaWYgKGluU2luZ2xlKSB7XG4gICAgICAvLyBTaW5nbGUtcXVvdGVkIHNwYW5zIGFyZSBmdWxseSBsaXRlcmFsIFx1MjAxNCBgJGAgYW5kIGBcXGAgaW5jbHVkZWQuXG4gICAgICBpZiAoYyA9PT0gXCInXCIpIGluU2luZ2xlID0gZmFsc2U7XG4gICAgICBvdXQgKz0gYztcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaW5Eb3VibGUpIHtcbiAgICAgIGlmIChjID09PSAnXCInKSB7XG4gICAgICAgIGluRG91YmxlID0gZmFsc2U7XG4gICAgICAgIG91dCArPSBjO1xuICAgICAgICBpKys7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcXFxcJyAmJiBpICsgMSA8IG4gJiYgJ1wiXFxcXCRgJy5pbmNsdWRlcyh0ZXh0W2kgKyAxXSkpIHtcbiAgICAgICAgLy8gSW5zaWRlIGRvdWJsZSBxdW90ZXMgYmFja3NsYXNoIGVzY2FwZXMgYFwiYCBgXFxgIGAkYCBgYCBgIGBgIFx1MjAxNCB0aGVcbiAgICAgICAgLy8gZXNjYXBlZCBjaGFyYWN0ZXIgc3RheXMgbGl0ZXJhbCAobm8gZXhwYW5zaW9uIG9mIGBcXCRgKS5cbiAgICAgICAgb3V0ICs9IHRleHRbaSArIDFdO1xuICAgICAgICBpICs9IDI7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGMgPT09ICdcXFxcJykge1xuICAgICAgICBvdXQgKz0gYztcbiAgICAgICAgaSsrO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChjID09PSAnJCcpIHtcbiAgICAgICAgY29uc3QgcmVmID0gZXhwYW5kUmVmKHRleHQsIGksIHJlc29sdmUpO1xuICAgICAgICBvdXQgKz0gcmVmLnRleHQ7XG4gICAgICAgIGkgPSByZWYubmV4dDtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBvdXQgKz0gYztcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBVbnF1b3RlZC5cbiAgICBpZiAoYyA9PT0gXCInXCIpIHtcbiAgICAgIGluU2luZ2xlID0gdHJ1ZTtcbiAgICAgIG91dCArPSBjO1xuICAgICAgaSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChjID09PSAnXCInKSB7XG4gICAgICBpbkRvdWJsZSA9IHRydWU7XG4gICAgICBvdXQgKz0gYztcbiAgICAgIGkrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoYyA9PT0gJ1xcXFwnKSB7XG4gICAgICAvLyBBIGJhY2tzbGFzaCBlc2NhcGVzIHRoZSBuZXh0IGNoYXJhY3RlciBcdTIwMTQgYFxcJGAgc3RheXMgbGl0ZXJhbCAodGhlXG4gICAgICAvLyB0b2tlbml6ZXIgcmVzb2x2ZXMgdGhlIGVzY2FwZSkuXG4gICAgICBvdXQgKz0gYztcbiAgICAgIGlmIChpICsgMSA8IG4pIHtcbiAgICAgICAgb3V0ICs9IHRleHRbaSArIDFdO1xuICAgICAgICBpICs9IDI7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpKys7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGMgPT09ICckJykge1xuICAgICAgY29uc3QgcmVmID0gZXhwYW5kUmVmKHRleHQsIGksIHJlc29sdmUpO1xuICAgICAgb3V0ICs9IHJlZi50ZXh0O1xuICAgICAgaSA9IHJlZi5uZXh0O1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIG91dCArPSBjO1xuICAgIGkrKztcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIFJlc29sdmUgdGhlIHJlZmVyZW5jZSBzdGFydGluZyBhdCBgdGV4dFtzdGFydF1gIChhIGAkYCkuIEEga25vd24gbmFtZSdzXG4gKiB2YWx1ZSByZXBsYWNlcyB0aGUgd2hvbGUgcmVmZXJlbmNlOyBhbnl0aGluZyBlbHNlIFx1MjAxNCBjb21tYW5kIHN1YnN0aXR1dGlvbixcbiAqIGFyaXRobWV0aWMsIGluZGlyZWN0IGV4cGFuc2lvbiwgcGFyYW1ldGVyIG9wZXJhdG9ycywgc3BlY2lhbCBwYXJhbWV0ZXJzLFxuICogdW5rbm93biBvciB1bnNldCBuYW1lcyBcdTIwMTQgaXMgcmV0dXJuZWQgdmVyYmF0aW0gKHRoZSBgJGAgb25seSksIHNvIHRoZVxuICogY2FsbGVyJ3Mgc2NhbiBjb250aW51ZXMgYW5kIHRoZSByZXNpZHVhbCB0ZXh0IGlzIHVuY2hhbmdlZC5cbiAqL1xuZnVuY3Rpb24gZXhwYW5kUmVmKFxuICB0ZXh0OiBzdHJpbmcsXG4gIHN0YXJ0OiBudW1iZXIsXG4gIHJlc29sdmU6IChuYW1lOiBzdHJpbmcpID0+IHN0cmluZyB8IHVuZGVmaW5lZFxuKTogeyB0ZXh0OiBzdHJpbmc7IG5leHQ6IG51bWJlciB9IHtcbiAgY29uc3QgcmVzdCA9IHRleHQuc2xpY2Uoc3RhcnQgKyAxKTtcbiAgaWYgKHJlc3Quc3RhcnRzV2l0aCgnKCcpKSByZXR1cm4geyB0ZXh0OiAnJCcsIG5leHQ6IHN0YXJ0ICsgMSB9OyAvLyBgJChcdTIwMjYpYCAvIGAkKChcdTIwMjYpKWAgXHUyMDE0IHVudG91Y2hlZFxuICBpZiAocmVzdC5zdGFydHNXaXRoKCd7JykpIHtcbiAgICBjb25zdCBjbG9zZSA9IHRleHQuaW5kZXhPZignfScsIHN0YXJ0ICsgMik7XG4gICAgaWYgKGNsb3NlID09PSAtMSkgcmV0dXJuIHsgdGV4dDogJyQnLCBuZXh0OiBzdGFydCArIDEgfTsgLy8gdW50ZXJtaW5hdGVkIGAkIHtgIFx1MjAxNCB1bnRvdWNoZWRcbiAgICBjb25zdCBpbm5lciA9IHRleHQuc2xpY2Uoc3RhcnQgKyAyLCBjbG9zZSk7XG4gICAgaWYgKEJSQUNFRF9OQU1FLnRlc3QoaW5uZXIpKSB7XG4gICAgICBjb25zdCB2YWx1ZSA9IHJlc29sdmUoaW5uZXIpO1xuICAgICAgaWYgKHZhbHVlICE9PSB1bmRlZmluZWQpIHJldHVybiB7IHRleHQ6IHZhbHVlLCBuZXh0OiBjbG9zZSArIDEgfTtcbiAgICB9XG4gICAgcmV0dXJuIHsgdGV4dDogJyQnLCBuZXh0OiBzdGFydCArIDEgfTsgLy8gYCR7IVh9YCwgYCR7WDpcdTIwMjZ9YCwgdW5rbm93biBuYW1lcyBcdTIwMTQgdW50b3VjaGVkXG4gIH1cbiAgY29uc3QgbmFtZSA9IEJBUkVfTkFNRS5leGVjKHJlc3QpO1xuICBpZiAobmFtZSA9PT0gbnVsbCkgcmV0dXJuIHsgdGV4dDogJyQnLCBuZXh0OiBzdGFydCArIDEgfTsgLy8gc3BlY2lhbCBwYXJhbWV0ZXJzLCBiYXJlIGAkYCBcdTIwMTQgdW50b3VjaGVkXG4gIGNvbnN0IHZhbHVlID0gcmVzb2x2ZShuYW1lWzBdKTtcbiAgaWYgKHZhbHVlICE9PSB1bmRlZmluZWQpIHJldHVybiB7IHRleHQ6IHZhbHVlLCBuZXh0OiBzdGFydCArIDEgKyBuYW1lWzBdLmxlbmd0aCB9O1xuICByZXR1cm4geyB0ZXh0OiAnJCcsIG5leHQ6IHN0YXJ0ICsgMSB9OyAvLyB1bmtub3duIG5hbWUgXHUyMDE0IHRoZSByZXNpZHVhbCBgJGAgdHJpcHMgbG9va3NVbnJlc29sdmFibGVcbn1cbiIsICIvKipcbiAqIEhhcm5lc3MtYWdub3N0aWMgc3Bhbi1zdXJmYWNpbmcgY29yZS5cbiAqXG4gKiBHaXZlbiBhbiBhbHJlYWR5LXJlc29sdmVkIHJlcG8tcmVsYXRpdmUgcGF0aCBhbmQgYSBsaW5lIHJhbmdlLCB0aGlzIG1vZHVsZVxuICogcnVucyB0aGUgc2hhcmVkIGBnaXQgc3BhbiBsaXN0IC0tcG9yY2VsYWluYCAvIGAuaG9va2lnbm9yZWAgLyBzZXNzaW9uLW1lbW8gL1xuICogYGdpdCBzcGFuIGRyaWZ0YCBwaXBlbGluZSBhbmQgYXNzZW1ibGVzIHRoZSBodW1hbi1yZWFkYWJsZSBgPGdpdC1zcGFuPlx1MjAyNjwvZ2l0LXNwYW4+YFxuICogYmxvY2sgdGhhdCBib3RoIGFkYXB0ZXJzIHN1cmZhY2UgaW5saW5lIGJlZm9yZSBhbiBlZGl0LiBJdCBpbXBvcnRzIG5vdGhpbmdcbiAqIGZyb20gZWl0aGVyIGhvb2sgU0RLOiB0aGUgQ2xhdWRlIFByZVRvb2xVc2UgaG9vayBmZWVkcyBpdCBhIHJhbmdlIGRlcml2ZWQgZnJvbVxuICogYGZpbGVfcGF0aGAvYG9mZnNldGAvYG9sZF9zdHJpbmdgOyB0aGUgQ29kZXggUHJlVG9vbFVzZSBob29rIGZlZWRzIGl0IHRoZVxuICogcmFuZ2VzIHJlY292ZXJlZCBmcm9tIGFuIGBhcHBseV9wYXRjaGAgZW52ZWxvcGUuIEVhY2ggYWRhcHRlciB3cmFwcyB0aGVcbiAqIHJldHVybmVkIGJsb2NrIHN0cmluZyBpbiBpdHMgb3duIFNESyBvdXRwdXQgYnVpbGRlci5cbiAqXG4gKiBUaGUgZXhlY3V0b3IvZHJpZnQvbWVtbyBkZXBlbmRlbmNpZXMgYXJlIGluamVjdGVkIHNvIHRoZSBwaXBlbGluZSBpcyB0ZXN0YWJsZVxuICogd2l0aCBmYWtlcyBleGFjdGx5IGxpa2UgdGhlIHBvcmNlbGFpbiBwYXJzZXJzIGluIHRoZSBzaGFyZWQga2VybmVsLlxuICovXG5cbmltcG9ydCB7IGV4ZWNGaWxlU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIG5vZGVQYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQge1xuICBpc0dpdElnbm9yZWQsXG4gIGlzSW5zaWRlU3BhblJvb3QsXG4gIHR5cGUgTGluZVJhbmdlLFxuICB0eXBlIFBvcmNlbGFpblJvdyxcbiAgcGFyc2VEcmlmdFBvcmNlbGFpbixcbiAgcGFyc2VQb3JjZWxhaW4sXG4gIHBydW5lU3RhbGVTZXNzaW9ucyxcbiAgcmFuZ2VzSW50ZXJzZWN0LFxuICByZWxhdGl2ZVRvUmVwbyxcbiAgcmVzb2x2ZVJlcG9Sb290LFxuICByZXNvbHZlU3BhblJvb3QsXG4gIHNlc3Npb25EaXIsXG4gIHRvUG9zaXhcbn0gZnJvbSAnLi9hZ2VudC1ob29rcy1jb21tb24uanMnO1xuaW1wb3J0IHsgdHlwZSBIb29rSWdub3JlTG9hZGVyLCBpc1NwYW5TdXBwcmVzc2VkIH0gZnJvbSAnLi9zcGFuLWlnbm9yZS5qcyc7XG5cbi8qKlxuICogTWluaW1hbCBsb2dnZXIgc3VyZmFjZSB0aGUgYGNvbW1vbi9gIGxheWVyIGxvZ3MgdGhyb3VnaDsgYm90aCBTREsgbG9nZ2Vyc1xuICogc2F0aXNmeSBpdC4gYHdhcm5gIGlzIHJlcXVpcmVkIFx1MjAxNCBldmVyeSBleGlzdGluZyBjYWxsIHNpdGUgcmVwb3J0cyBhIGZhaWx1cmUuXG4gKiBgaW5mb2AgaXMgb3B0aW9uYWwgc28gYSBmYWtlIGNhcnJ5aW5nIG9ubHkgYHdhcm5gIHN0aWxsIHNhdGlzZmllcyB0aGVcbiAqIGludGVyZmFjZTogaXQgZXhpc3RzIGZvciB0aGUgZGlhZ25vc3RpYyBicmVhZGNydW1icyBhICpzdWNjZXNzZnVsKiBydW4gbGVhdmVzXG4gKiBiZWhpbmQgKGFkdmlzb3ItY29yZSdzIGNodXJuLXN1cHByZXNzaW9uIGNvdW50KSwgd2hpY2ggYXJlIG5vdCB3YXJuaW5ncyBhbmRcbiAqIG11c3Qgbm90IHJlYWQgYXMgZmFpbHVyZXMgaW4gdGhlIGhvb2sgbG9nLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENvcmVMb2dnZXIge1xuICB3YXJuKG1lc3NhZ2U6IHN0cmluZywgY29udGV4dD86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZDtcbiAgaW5mbz8obWVzc2FnZTogc3RyaW5nLCBjb250ZXh0PzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB2b2lkO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFNwYW4gZXhlY3V0b3IgYWJzdHJhY3Rpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIEV4ZWN1dGVzIGBnaXQgc3BhbiBsaXN0YCB3aXRoIGdpdmVuIGFyZ3MgaW4gYSBnaXZlbiBjd2QuXG4gKiBSZXR1cm5zIHN0ZG91dCBzdHJpbmcuIFRocm93cyBvbiBub24temVybyBleGl0LlxuICovXG5leHBvcnQgdHlwZSBTcGFuRXhlY3V0b3IgPSAoYXJnczogc3RyaW5nW10sIGN3ZDogc3RyaW5nKSA9PiBzdHJpbmc7XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0U3BhbkV4ZWN1dG9yKHRpbWVvdXRNcyA9IDEwXzAwMCk6IFNwYW5FeGVjdXRvciB7XG4gIHJldHVybiAoYXJncywgY3dkKSA9PiB7XG4gICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2xpc3QnLCAuLi5hcmdzXSwge1xuICAgICAgY3dkLFxuICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgIH0pO1xuICB9O1xufVxuXG4vKipcbiAqIFJ1bnMgYGdpdCBzcGFuIGRyaWZ0IC0tZm9ybWF0IHBvcmNlbGFpbiA8c2x1Z3M+YCBhbmQgcmV0dXJucyBpdHMgcG9yY2VsYWluIHN0ZG91dCBcdTIwMTRcbiAqIG9uZSByb3cgcGVyICpkcmlmdGVkKiBhbmNob3IgYW1vbmcgdGhlIGdpdmVuIHNwYW5zLCBlbXB0eSB3aGVuIGFsbCBhcmUgY2xlYW4uXG4gKiBgZ2l0IHNwYW4gZHJpZnRgIGV4aXRzIDAgaW4gcG9yY2VsYWluIG1vZGUgd2hldGhlciBvciBub3QgZHJpZnQgZXhpc3RzLCBidXQgd2VcbiAqIHN0aWxsIGNhcHR1cmUgc3Rkb3V0IGZyb20gYSB0aHJvd24gZXJyb3Igc28gYSBkcmlmdCBzaWduYWwgaXMgbmV2ZXIgbG9zdCB0byBhXG4gKiBub24temVybyBleGl0LiBUaHJvd3Mgb25seSB3aGVuIG5vIHN0ZG91dCBpcyBhdmFpbGFibGUgKGdlbnVpbmUgZmFpbHVyZSkuXG4gKi9cbmV4cG9ydCB0eXBlIERyaWZ0RXhlY3V0b3IgPSAoc2x1Z3M6IHN0cmluZ1tdLCBjd2Q6IHN0cmluZykgPT4gc3RyaW5nO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdERyaWZ0RXhlY3V0b3IodGltZW91dE1zID0gMTBfMDAwKTogRHJpZnRFeGVjdXRvciB7XG4gIHJldHVybiAoc2x1Z3MsIGN3ZCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnZHJpZnQnLCAnLS1mb3JtYXQnLCAncG9yY2VsYWluJywgLi4uc2x1Z3NdLCB7XG4gICAgICAgIGN3ZCxcbiAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY29uc3Qgb3V0ID0gKGVyciBhcyB7IHN0ZG91dD86IHN0cmluZyB9KS5zdGRvdXQ7XG4gICAgICBpZiAodHlwZW9mIG91dCA9PT0gJ3N0cmluZycpIHJldHVybiBvdXQ7XG4gICAgICB0aHJvdyBlcnI7XG4gICAgfVxuICB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFNlc3Npb24gbWVtbyBhYnN0cmFjdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgTWVtb1N0b3JlIHtcbiAgZ2V0U3VyZmFjZWQoc2Vzc2lvbklkOiBzdHJpbmcpOiBTZXQ8c3RyaW5nPjtcbiAgYWRkU3VyZmFjZWQoc2Vzc2lvbklkOiBzdHJpbmcsIG5hbWVzOiBzdHJpbmdbXSk6IHZvaWQ7XG59XG5cbi8vIExpdmVzIHVuZGVyIHRoZSBzaGFyZWQgcGVyLXNlc3Npb24gc3RhdGUgZGlyZWN0b3J5IChhZ2VudC1ob29rcy1jb21tb24udHMnc1xuLy8gc2Vzc2lvbkRpcikgXHUyMDE0IHJlbG9jYXRlZCBmcm9tIG9zLnRtcGRpcigpL2FnZW50LWhvb2tzLWdpdC1zcGFuLyBzb1xuLy8gcGVyLXNlc3Npb24gc3RhdGUgaGFzIG9uZSBob21lIGFuZCBpcyBjb3ZlcmVkIGJ5IHBydW5lU3RhbGVTZXNzaW9ucydzXG4vLyBvcHBvcnR1bmlzdGljID4zMC1kYXkgcHJ1bmluZy5cbmZ1bmN0aW9uIG1lbW9GaWxlUGF0aChzZXNzaW9uSWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBub2RlUGF0aC5qb2luKHNlc3Npb25EaXIoc2Vzc2lvbklkKSwgJ3RvdWNoLW1lbW8uanNvbicpO1xufVxuXG5leHBvcnQgdHlwZSBNZW1vTG9nZ2VyID0gQ29yZUxvZ2dlcjtcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZURpc2tNZW1vU3RvcmUobG9nZ2VyOiBNZW1vTG9nZ2VyKTogTWVtb1N0b3JlIHtcbiAgcmV0dXJuIHtcbiAgICBnZXRTdXJmYWNlZChzZXNzaW9uSWQpIHtcbiAgICAgIHBydW5lU3RhbGVTZXNzaW9ucygpO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmF3ID0gZnMucmVhZEZpbGVTeW5jKG1lbW9GaWxlUGF0aChzZXNzaW9uSWQpLCAndXRmOCcpO1xuICAgICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKHJhdykgYXMgeyBzdXJmYWNlZD86IHVua25vd24gfTtcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkocGFyc2VkLnN1cmZhY2VkKSkge1xuICAgICAgICAgIHJldHVybiBuZXcgU2V0KHBhcnNlZC5zdXJmYWNlZCBhcyBzdHJpbmdbXSk7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBsb2dnZXIud2FybignbWVtbyByZWFkIGZhaWxlZCAodHJlYXRpbmcgYXMgZW1wdHkpJywgeyBlcnIgfSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gbmV3IFNldCgpO1xuICAgIH0sXG4gICAgYWRkU3VyZmFjZWQoc2Vzc2lvbklkLCBuYW1lcykge1xuICAgICAgcHJ1bmVTdGFsZVNlc3Npb25zKCk7XG4gICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuZ2V0U3VyZmFjZWQoc2Vzc2lvbklkKTtcbiAgICAgIGZvciAoY29uc3QgbiBvZiBuYW1lcykgZXhpc3RpbmcuYWRkKG4pO1xuICAgICAgY29uc3QgbWVtb0RpciA9IHNlc3Npb25EaXIoc2Vzc2lvbklkKTtcbiAgICAgIGNvbnN0IG1lbW9QYXRoID0gbWVtb0ZpbGVQYXRoKHNlc3Npb25JZCk7XG4gICAgICBjb25zdCB0bXBQYXRoID0gYCR7bWVtb1BhdGh9LnRtcGA7XG4gICAgICB0cnkge1xuICAgICAgICBmcy5ta2RpclN5bmMobWVtb0RpciwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgICAgIGZzLndyaXRlRmlsZVN5bmModG1wUGF0aCwgSlNPTi5zdHJpbmdpZnkoeyBzdXJmYWNlZDogWy4uLmV4aXN0aW5nXSB9KSwgJ3V0ZjgnKTtcbiAgICAgICAgZnMucmVuYW1lU3luYyh0bXBQYXRoLCBtZW1vUGF0aCk7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgbG9nZ2VyLndhcm4oJ21lbW8gd3JpdGUgZmFpbGVkJywgeyBlcnIgfSk7XG4gICAgICB9XG4gICAgfVxuICB9O1xufVxuXG4vKiogRmFjdG9yeSBmdW5jdGlvbiB0aGF0IGNyZWF0ZXMgYSBNZW1vU3RvcmUgZ2l2ZW4gYSBsb2dnZXIuICovXG5leHBvcnQgdHlwZSBNZW1vRmFjdG9yeSA9IChsb2dnZXI6IE1lbW9Mb2dnZXIpID0+IE1lbW9TdG9yZTtcblxuLyoqIERlZmF1bHQgZGlzay1iYWNrZWQgbWVtbyBmYWN0b3J5IHVzZWQgaW4gcHJvZHVjdGlvbi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkaXNrTWVtb0ZhY3RvcnkobG9nZ2VyOiBNZW1vTG9nZ2VyKTogTWVtb1N0b3JlIHtcbiAgcmV0dXJuIGNyZWF0ZURpc2tNZW1vU3RvcmUobG9nZ2VyKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUb3VjaCBzY29wZSByZXNvbHV0aW9uIChyZXBvLXNjb3BpbmcgKyBnaXRpZ25vcmUgKyBzcGFuLXJvb3QgZ3VhcmRzKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hTY29wZSB7XG4gIHJlcG9Sb290OiBzdHJpbmc7XG4gIHJlcG9SZWxQYXRoOiBzdHJpbmc7XG59XG5cbi8qKlxuICogQm91bmQgYSB0b3VjaGVkIGZpbGUgdG8gdGhlIENXRCByZXBvLiBSZXNvbHZlIHRoZSByZXBvIHJvb3Qgb2YgdGhlIGN1cnJlbnRcbiAqIHdvcmtpbmcgZGlyZWN0b3J5IGFuZCByZXF1aXJlIHRoZSB0b3VjaGVkIGZpbGUgdG8gcmVzb2x2ZSB0byB0aGUgU0FNRSByZXBvXG4gKiByb290OyBkcm9wIGZpbGVzIGluIGEgZGlmZmVyZW50IHJlcG9zaXRvcnkvd29ya3RyZWUsIGdpdGlnbm9yZWQgZmlsZXMsIGFuZFxuICogZmlsZXMgdW5kZXIgdGhlIHNwYW4gcm9vdC4gUmV0dXJucyB0aGUgcmVzb2x2ZWQgYHsgcmVwb1Jvb3QsIHJlcG9SZWxQYXRoIH1gXG4gKiBvciBudWxsIHdoZW4gdGhlIHRvdWNoIGlzIG91dCBvZiBzY29wZS5cbiAqXG4gKiBDb21wYXJpbmcgcmVzb2x2ZWQgYGdpdCAtLXNob3ctdG9wbGV2ZWxgIHRvcGxldmVscyAobm90IHBhdGggcHJlZml4ZXMpXG4gKiBkaXN0aW5ndWlzaGVzIHNlcGFyYXRlIHJlcG9zIGFuZCB3b3JrdHJlZXMgYW5kIGlzIHJvYnVzdCB0byBzeW1saW5rcy4gRmFpbFxuICogY2xvc2VkOiBpZiB0aGUgQ1dEIHJlcG8gY2FuJ3QgYmUgcmVzb2x2ZWQsIHRoZSB0b3VjaCBpcyBkcm9wcGVkIHJhdGhlciB0aGFuXG4gKiBmYWxsaW5nIGJhY2sgdG8gdGhlIGZpbGUncyBvd24gcmVwby5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVUb3VjaFNjb3BlKGN3ZDogc3RyaW5nLCBhYnNQYXRoOiBzdHJpbmcpOiBUb3VjaFNjb3BlIHwgbnVsbCB7XG4gIGNvbnN0IGN3ZFJlcG9Sb290ID0gY3dkID8gcmVzb2x2ZVJlcG9Sb290KGN3ZCkgOiBudWxsO1xuICBpZiAoIWN3ZFJlcG9Sb290KSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBhYnNEaXIgPSB0b1Bvc2l4KG5vZGVQYXRoLmRpcm5hbWUoYWJzUGF0aCkpO1xuICBjb25zdCBmaWxlUmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoYWJzRGlyKTtcbiAgaWYgKGZpbGVSZXBvUm9vdCAhPT0gY3dkUmVwb1Jvb3QpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IHJlcG9Sb290ID0gY3dkUmVwb1Jvb3Q7XG4gIGNvbnN0IHJlcG9SZWxQYXRoID0gcmVsYXRpdmVUb1JlcG8ocmVwb1Jvb3QsIGFic1BhdGgpO1xuXG4gIC8vIFNraXAgZ2l0aWdub3JlZCBmaWxlcyBlbnRpcmVseS4gQnVpbGQgb3V0cHV0LCBjYWNoZXMsIGFuZCBsb2dzIGFyZSBub3RcbiAgLy8gc3Bhbi1yZWxldmFudDogdGhleSBtdXN0IG5ldmVyIHN1cmZhY2Ugc3BhbiBvdmVybGFwcy5cbiAgaWYgKGlzR2l0SWdub3JlZChyZXBvUm9vdCwgcmVwb1JlbFBhdGgpKSByZXR1cm4gbnVsbDtcblxuICAvLyBTa2lwIHNwYW4gZG9jdW1lbnRzIGVudGlyZWx5LiBGaWxlcyB1bmRlciB0aGUgcmVzb2x2ZWQgc3BhbiByb290IGFyZSBtYW5hZ2VkXG4gIC8vIGJ5IGdpdCBzcGFuIGl0c2VsZiBhbmQgYXJlIG5vdCBhcHBsaWNhdGlvbiBzb3VyY2VzIHRoYXQgbmVlZCBzcGFuIGNvdmVyYWdlLlxuICBjb25zdCBzcGFuUm9vdCA9IHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdCk7XG4gIGlmIChpc0luc2lkZVNwYW5Sb290KHJlcG9SZWxQYXRoLCBzcGFuUm9vdCkpIHJldHVybiBudWxsO1xuXG4gIHJldHVybiB7IHJlcG9Sb290LCByZXBvUmVsUGF0aCB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFN1cmZhY2Ugcm91dGluZVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBJbmplY3RlZCBkZXBlbmRlbmNpZXMgZm9yIHtAbGluayBzdXJmYWNlT3ZlcmxhcHBpbmdTcGFuc30uICovXG5leHBvcnQgaW50ZXJmYWNlIFN1cmZhY2VEZXBzIHtcbiAgZXhlY3V0b3I6IFNwYW5FeGVjdXRvcjtcbiAgZHJpZnRFeGVjdXRvcjogRHJpZnRFeGVjdXRvcjtcbiAgbWVtbzogTWVtb1N0b3JlO1xuICBsb2FkUnVsZXM6IEhvb2tJZ25vcmVMb2FkZXI7XG4gIGxvZ2dlcjogQ29yZUxvZ2dlcjtcbn1cblxuLyoqXG4gKiBHaXZlbiBhIHJlcG8tcmVsYXRpdmUgcGF0aCBhbmQgdGhlIGxpbmUgcmFuZ2UgYmVpbmcgdG91Y2hlZCB3aXRoaW4gYW5cbiAqIGFscmVhZHktcmVzb2x2ZWQgcmVwbywgcHJvZHVjZSB0aGUgYDxnaXQtc3Bhbj5cdTIwMjY8L2dpdC1zcGFuPmAgYmxvY2sgZm9yIHRoZVxuICogc3BhbnMgb3ZlcmxhcHBpbmcgdGhhdCByYW5nZSwgb3IgbnVsbCB3aGVuIHRoZXJlIGlzIG5vdGhpbmcgdG8gc3VyZmFjZS5cbiAqXG4gKiBUaGUgcGlwZWxpbmU6IGBnaXQgc3BhbiBsaXN0IDxwYXRoPiAtLXBvcmNlbGFpbmAgXHUyMTkyIGtlZXAgbGluZS1yYW5nZWQgYW5jaG9ycyBvblxuICogdGhlIHNhbWUgZmlsZSB0aGF0IGludGVyc2VjdCB0aGUgcmFuZ2UgYW5kIGFyZSBub3QgYC5ob29raWdub3JlYC1zdXBwcmVzc2VkIFx1MjE5MlxuICogZHJvcCBzbHVncyBhbHJlYWR5IHN1cmZhY2VkIHRoaXMgc2Vzc2lvbiAobWVtbykgXHUyMTkyIHJlbmRlciBgZ2l0IHNwYW4gbGlzdFxuICogPG5hbWVzXHUyMDI2PmAgXHUyMTkyIGFwcGVuZCBhIGBnaXQgc3BhbiBoaXN0b3J5IDxuYW1lPmAgcG9pbnRlciBmb3IgYW55IGFscmVhZHktZHJpZnRlZFxuICogc3Bhbi4gT24gc3VjY2VzcyB0aGUgc3VyZmFjZWQgbmFtZXMgYXJlIHJlY29yZGVkIGluIHRoZSBtZW1vLiBFeGVjdXRvciBhbmRcbiAqIGRyaWZ0LXByb2JlIGZhaWx1cmVzIGFyZSBsb2dnZWQgYW5kIGRlZ3JhZGUgdG8gbnVsbCAvIHRoZSBwbGFpbiBibG9jazsgdGhleVxuICogbmV2ZXIgdGhyb3cuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdXJmYWNlT3ZlcmxhcHBpbmdTcGFucyhcbiAgZGVwczogU3VyZmFjZURlcHMsXG4gIHJlcG9Sb290OiBzdHJpbmcsXG4gIHJlcG9SZWxQYXRoOiBzdHJpbmcsXG4gIHJhbmdlOiBMaW5lUmFuZ2UsXG4gIHNlc3Npb25JZDogc3RyaW5nXG4pOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3QgeyBleGVjdXRvciwgZHJpZnRFeGVjdXRvciwgbWVtbywgbG9hZFJ1bGVzLCBsb2dnZXIgfSA9IGRlcHM7XG5cbiAgLy8gRmlsdGVyIHBhc3M6IGdpdCBzcGFuIGxpc3QgPHBhdGg+IC0tcG9yY2VsYWluXG4gIGxldCBwb3JjZWxhaW5TdGRvdXQ6IHN0cmluZztcbiAgdHJ5IHtcbiAgICBwb3JjZWxhaW5TdGRvdXQgPSBleGVjdXRvcihbJy0tcG9yY2VsYWluJywgcmVwb1JlbFBhdGhdLCByZXBvUm9vdCk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZ2dlci53YXJuKCdnaXQgc3BhbiBsaXN0IC0tcG9yY2VsYWluIGZhaWxlZCcsIHsgZXJyIH0pO1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgLy8gUGF0aC1zY29wZWQgc3VwcHJlc3Npb246IGEgcmVwbydzIC5zcGFuLy5ob29raWdub3JlIGNhbiBob2xkIGJhY2sgc3BhbiBzbHVnXG4gIC8vIHByZWZpeGVzIGZvciBhbmNob3JzIHVuZGVyIGdpdmVuIHBhdGhzLiBBIHN1cHByZXNzZWQgc3BhbiBpcyBuZXZlciBzdXJmYWNlZC5cbiAgY29uc3QgaWdub3JlUnVsZXMgPSBsb2FkUnVsZXMocmVwb1Jvb3QpO1xuXG4gIGNvbnN0IHJvd3M6IFBvcmNlbGFpblJvd1tdID0gcGFyc2VQb3JjZWxhaW4ocG9yY2VsYWluU3Rkb3V0KTtcbiAgY29uc3QgY2FuZGlkYXRlTmFtZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgIGlmIChyb3cucGF0aCAhPT0gcmVwb1JlbFBhdGgpIGNvbnRpbnVlO1xuICAgIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgY29udGludWU7IC8vIHdob2xlLWZpbGUgYW5jaG9yXG4gICAgaWYgKCFyYW5nZXNJbnRlcnNlY3QocmFuZ2UsIHsgc3RhcnQ6IHJvdy5zdGFydCwgZW5kOiByb3cuZW5kIH0pKSBjb250aW51ZTtcbiAgICBpZiAoaXNTcGFuU3VwcHJlc3NlZChpZ25vcmVSdWxlcywgcm93LnBhdGgsIHJvdy5uYW1lKSkgY29udGludWU7XG4gICAgY2FuZGlkYXRlTmFtZXMuYWRkKHJvdy5uYW1lKTtcbiAgfVxuXG4gIGlmIChjYW5kaWRhdGVOYW1lcy5zaXplID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAvLyBTdWJ0cmFjdCBhbHJlYWR5LXN1cmZhY2VkIG5hbWVzXG4gIGNvbnN0IHN1cmZhY2VkID0gbWVtby5nZXRTdXJmYWNlZChzZXNzaW9uSWQpO1xuICBjb25zdCB0b1N1cmZhY2UgPSBbLi4uY2FuZGlkYXRlTmFtZXNdLmZpbHRlcigobikgPT4gIXN1cmZhY2VkLmhhcyhuKSkuc29ydCgpO1xuICBpZiAodG9TdXJmYWNlLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgLy8gUmVuZGVyIHBhc3M6IGdpdCBzcGFuIGxpc3QgPG5hbWUxPiA8bmFtZTI+IC4uLlxuICBsZXQgcmVuZGVyU3Rkb3V0OiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgcmVuZGVyU3Rkb3V0ID0gZXhlY3V0b3IodG9TdXJmYWNlLCByZXBvUm9vdCk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZ2dlci53YXJuKCdnaXQgc3BhbiBsaXN0IChyZW5kZXIpIGZhaWxlZCcsIHsgZXJyIH0pO1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgLy8gT2YgdGhlIHNwYW5zIGJlaW5nIHN1cmZhY2VkLCBmbGFnIGFueSBhbHJlYWR5IGRyaWZ0ZWQgXHUyMDE0IHRoZSB0b3VjaGVkIGxpbmVzIGhhdmVcbiAgLy8gZHJpZnRlZCBmcm9tIHRoZWlyIGFuY2hvcmVkIHN0YXRlIFx1MjAxNCB3aXRoIGEgYGdpdCBzcGFuIGhpc3RvcnkgPG5hbWU+YCBwb2ludGVyLlxuICAvLyBEZXRlY3Rpb24gaXMgYXMtb2Ytbm93IChzdXJmYWNpbmcgcnVucyBiZWZvcmUgdGhlIGVkaXQgYXBwbGllcyksIHNvIHRoaXNcbiAgLy8gY2F0Y2hlcyBwcmUtZXhpc3RpbmcgZHJpZnQ7IGRyaWZ0IHRoaXMgc2Vzc2lvbiBjYXVzZXMgaXMgdGhlIFN0b3AgaG9vaydzIGpvYi5cbiAgLy8gRmFpbHVyZSB0byBjb21wdXRlIGRyaWZ0IGlzIG5vbi1mYXRhbDogZmFsbCBiYWNrIHRvIHRoZSBwbGFpbiBibG9jay5cbiAgbGV0IGRyaWZ0SGludCA9ICcnO1xuICB0cnkge1xuICAgIGNvbnN0IGRyaWZ0TmFtZXMgPSBuZXcgU2V0KHBhcnNlRHJpZnRQb3JjZWxhaW4oZHJpZnRFeGVjdXRvcih0b1N1cmZhY2UsIHJlcG9Sb290KSkubWFwKChyKSA9PiByLm5hbWUpKTtcbiAgICBjb25zdCBkcmlmdFN1cmZhY2VkID0gdG9TdXJmYWNlLmZpbHRlcigobikgPT4gZHJpZnROYW1lcy5oYXMobikpO1xuICAgIGlmIChkcmlmdFN1cmZhY2VkLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGxpbmVzID0gZHJpZnRTdXJmYWNlZC5tYXAoKG4pID0+IGAgIGdpdCBzcGFuIGhpc3RvcnkgJHtufWApLmpvaW4oJ1xcbicpO1xuICAgICAgZHJpZnRIaW50ID0gYFxcbkRyaWZ0IFx1MjAxNCB0aGUgbGluZXMgeW91J3JlIHRvdWNoaW5nIGhhdmUgZHJpZnRlZCBmcm9tIHRoZXNlIHNwYW5zJyBhbmNob3JlZCBzdGF0ZS4gUmV2aWV3IGhvdyBlYWNoIHN1YnN5c3RlbSBldm9sdmVkIGJlZm9yZSBjaGFuZ2luZyBpdDpcXG4ke2xpbmVzfWA7XG4gICAgfVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2dnZXIud2FybignZ2l0IHNwYW4gZHJpZnQgKGhpc3RvcnkgaGludCkgZmFpbGVkJywgeyBlcnIgfSk7XG4gIH1cblxuICBjb25zdCB3cmFwcGVkID0gYFxcbjxnaXQtc3Bhbj5cXG4ke3JlbmRlclN0ZG91dH0ke2RyaWZ0SGludH1cXG48L2dpdC1zcGFuPlxcbmA7XG5cbiAgLy8gVXBkYXRlIG1lbW9cbiAgbWVtby5hZGRTdXJmYWNlZChzZXNzaW9uSWQsIHRvU3VyZmFjZSk7XG5cbiAgcmV0dXJuIHdyYXBwZWQ7XG59XG4iLCAiLyoqXG4gKiBQYXRoLXNjb3BlZCBzcGFuIHN1cHByZXNzaW9uIGZvciB0aGUgYWdlbnQgaG9va3MuXG4gKlxuICogU29tZSBzcGFucyBhcmUgbm9pc2Ugd2hlbiBicm93c2luZyBjZXJ0YWluIHBhcnRzIG9mIHRoZSB0cmVlIFx1MjAxNCB3aWtpIG9yXG4gKiBtYXJrZXRpbmcgc3BhbnMgdGhhdCBhbmNob3IgcHJvc2UsIHN1cmZhY2VkIGlubGluZSB3aGlsZSByZWFkaW5nIHNvdXJjZSxcbiAqIGFkZCBsaXR0bGUuIFRoaXMgbW9kdWxlIGxldHMgYSByZXBvIGRlY2xhcmUsIHBlciBwYXRoLCB3aGljaCBzcGFuIHNsdWdcbiAqIHByZWZpeGVzIHRvIGhvbGQgYmFjay5cbiAqXG4gKiBDb25maWcgbGl2ZXMgYXQgYDxyZXBvUm9vdD4vLnNwYW4vLmhvb2tpZ25vcmVgLiBFYWNoIG5vbi1jb21tZW50IGxpbmUgaXMgYVxuICogZ2l0aWdub3JlLXN0eWxlIHBhdGggcGF0dGVybiwgYSBzaW5nbGUgcnVuIG9mIHdoaXRlc3BhY2UsIHRoZW4gYVxuICogY29tbWEtc2VwYXJhdGVkIGxpc3Qgb2Ygc3BhbiBzbHVnIHByZWZpeGVzIHRvIHN1cHByZXNzIGZvciBwYXRocyB0aGUgcGF0dGVyblxuICogbWF0Y2hlczpcbiAqXG4gKiAgIHBhY2thZ2VzL2FnZW50LWhvb2tzL3NyYyB3aWtpLG1hcmtldGluZ1xuICpcbiAqIEEgc3BhbiB3aG9zZSBzbHVnIGJlZ2lucyB3aXRoIGB3aWtpYCBvciBgbWFya2V0aW5nYCAodGhlIHNsdWcgZXF1YWxzIHRoZVxuICogcHJlZml4LCBvciBpcyBgPHByZWZpeD4vXHUyMDI2YCkgaXMgdGhlbiBuZXZlciBzdXJmYWNlZCBmb3IgYW4gYW5jaG9yIHdob3NlIHBhdGhcbiAqIHNpdHMgdW5kZXIgYHBhY2thZ2VzL2FnZW50LWhvb2tzL3NyY2AgXHUyMDE0IGl0IGlzIG5ldmVyIHN1cmZhY2VkIGluIHRoZSBpbmxpbmVcbiAqIGA8Z2l0LXNwYW4+YCBibG9jayB0aGUgYFBvc3RUb29sVXNlYCB0b3VjaCBob29rIGVtaXRzLiBJdCBoYXMgbm8gZWZmZWN0IG9uXG4gKiB0aGUgYFByZVRvb2xVc2VgIGFkdmlzb3IsIHdob3NlIG93biB1bmNvdmVyZWQtd3JpdGVzIHN1cHByZXNzaW9uIGxpdmVzIGluXG4gKiBgLnNwYW4vLmFkdmlzb3JpZ25vcmVgIChzZWUgYGFkdmlzb3ItaWdub3JlLnRzYCkuXG4gKlxuICogUGF0dGVybiBncmFtbWFyIGlzIGEgZGVsaWJlcmF0ZSBzdWJzZXQgb2YgZ2l0aWdub3JlOlxuICpcbiAqIC0gQmxhbmsgbGluZXMgYW5kIGxpbmVzIGJlZ2lubmluZyB3aXRoIGAjYCBhcmUgc2tpcHBlZC5cbiAqIC0gQSB0cmFpbGluZyBgL2AgcmVzdHJpY3RzIHRoZSBwYXR0ZXJuIHRvIGRpcmVjdG9yaWVzICh0aGUgbGVhZiBmaWxlIGlzIG5vdFxuICogICBpdHNlbGYgdGVzdGVkLCBvbmx5IGl0cyBhbmNlc3RvciBkaXJlY3RvcmllcykuXG4gKiAtIEEgcGF0dGVybiBjb250YWluaW5nIGEgc2xhc2ggaXMgYW5jaG9yZWQgdG8gdGhlIHJlcG8gcm9vdDsgYSBwYXR0ZXJuIHdpdGhcbiAqICAgbm8gc2xhc2ggbWF0Y2hlcyBhIHNpbmdsZSBwYXRoIGNvbXBvbmVudCBhdCBhbnkgZGVwdGguXG4gKiAtIGAqYCBhbmQgYD9gIG1hdGNoIHdpdGhpbiBvbmUgcGF0aCBzZWdtZW50OyBgKipgIG1hdGNoZXMgYWNyb3NzIHNlZ21lbnRzLlxuICogLSBOZWdhdGlvbiAoYCFgKSBpcyBub3Qgc3VwcG9ydGVkLlxuICpcbiAqIFN1cHByZXNzaW9uIGlzIGZhaWwtb3BlbjogYSBtaXNzaW5nIG9yIHVucmVhZGFibGUgYC5ob29raWdub3JlYCwgb3IgYVxuICogbWFsZm9ybWVkIGxpbmUsIHlpZWxkcyBubyBydWxlIHJhdGhlciB0aGFuIGhpZGluZyBzcGFucyB0aGUgYXV0aG9yIGRpZCBub3RcbiAqIGFzayB0byBoaWRlLlxuICovXG5cbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0ICogYXMgbm9kZVBhdGggZnJvbSAnbm9kZTpwYXRoJztcblxuZXhwb3J0IGludGVyZmFjZSBJZ25vcmVSdWxlIHtcbiAgLyoqIFRoZSByYXcgZ2l0aWdub3JlLXN0eWxlIHBhdHRlcm4sIHJldGFpbmVkIGZvciBkaWFnbm9zdGljcy4gKi9cbiAgcGF0dGVybjogc3RyaW5nO1xuICAvKiogU3BhbiBzbHVnIHByZWZpeGVzIHN1cHByZXNzZWQgZm9yIHBhdGhzIHRoaXMgcnVsZSBtYXRjaGVzLiAqL1xuICBwcmVmaXhlczogc3RyaW5nW107XG4gIC8qKiBUcnVlIHdoZW4gYHJlcG9SZWxQYXRoYCAoUE9TSVgsIHJlcG8tcmVsYXRpdmUpIGlzIGdvdmVybmVkIGJ5IHRoaXMgcnVsZS4gKi9cbiAgbWF0Y2hlczogKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IGJvb2xlYW47XG59XG5cbmNvbnN0IEhPT0tfSUdOT1JFX1JFTCA9IG5vZGVQYXRoLmpvaW4oJy5zcGFuJywgJy5ob29raWdub3JlJyk7XG5cbi8qKlxuICogVHJhbnNsYXRlIG9uZSBnaXRpZ25vcmUtc3R5bGUgZ2xvYiBzZWdtZW50IGludG8gYW4gYW5jaG9yZWQgUmVnRXhwLiBgKmAgYW5kXG4gKiBgP2Agc3RheSB3aXRoaW4gYSBwYXRoIHNlZ21lbnQ7IGAqKmAgKG9wdGlvbmFsbHkgZm9sbG93ZWQgYnkgYC9gKSBzcGFucyB0aGVtLlxuICovXG5mdW5jdGlvbiBnbG9iVG9SZWdFeHAoZ2xvYjogc3RyaW5nKTogUmVnRXhwIHtcbiAgbGV0IHJlID0gJyc7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgZ2xvYi5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGMgPSBnbG9iW2ldO1xuICAgIGlmIChjID09PSAnKicpIHtcbiAgICAgIGlmIChnbG9iW2kgKyAxXSA9PT0gJyonKSB7XG4gICAgICAgIHJlICs9ICcuKic7XG4gICAgICAgIGkrKztcbiAgICAgICAgLy8gQWJzb3JiIGEgZm9sbG93aW5nIHNsYXNoIHNvIGAqKi9mb29gIGRvZXMgbm90IGRlbWFuZCBhIGxpdGVyYWwgYC9gLlxuICAgICAgICBpZiAoZ2xvYltpICsgMV0gPT09ICcvJykgaSsrO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmUgKz0gJ1teL10qJztcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGMgPT09ICc/Jykge1xuICAgICAgcmUgKz0gJ1teL10nO1xuICAgIH0gZWxzZSB7XG4gICAgICByZSArPSBjLnJlcGxhY2UoL1suK14ke30oKXxbXFxdXFxcXF0vZywgJ1xcXFwkJicpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbmV3IFJlZ0V4cChgXiR7cmV9JGApO1xufVxuXG4vKiogQW5jZXN0b3IgcGF0aCBjaGFpbjogYGEvYi9jLnRzYCBcdTIxOTIgYFsnYScsICdhL2InLCAnYS9iL2MudHMnXWAuICovXG5mdW5jdGlvbiBhbmNlc3RvclBhdGhzKHBhdGg6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgcGFydHMgPSBwYXRoLnNwbGl0KCcvJyk7XG4gIGNvbnN0IG91dDogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIG91dC5wdXNoKHBhcnRzLnNsaWNlKDAsIGkgKyAxKS5qb2luKCcvJykpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKlxuICogQ29tcGlsZSBhIHNpbmdsZSBnaXRpZ25vcmUtc3R5bGUgcGF0dGVybiAodGhpcyBtb2R1bGUncyBncmFtbWFyIFx1MjAxNCBzZWUgdGhlXG4gKiBtb2R1bGUgZG9jIGNvbW1lbnQpIGludG8gYSBwYXRoIHByZWRpY2F0ZS4gQSBwYXR0ZXJuIG1hdGNoZXMgYSBmaWxlIHdoZW4gaXRcbiAqIG1hdGNoZXMgdGhlIGZpbGUncyBwYXRoIG9yIGFueSBhbmNlc3RvciBkaXJlY3Rvcnkgb2YgaXQsIHNvIGEgZGlyZWN0b3J5XG4gKiBwYXR0ZXJuIHN1cHByZXNzZXMgZXZlcnl0aGluZyBiZW5lYXRoIGl0LlxuICpcbiAqIEV4cG9ydGVkIHNvIG90aGVyIHBhdGgtc2NvcGVkIGlnbm9yZS1maWxlIGNvbnZlbnRpb25zIChlLmcuIGAuYWR2aXNvcmlnbm9yZWBcbiAqIGluIGBhZHZpc29yLWlnbm9yZS50c2ApIGNhbiByZXVzZSB0aGUgZXhhY3QgbWF0Y2hpbmcgc2VtYW50aWNzIHJhdGhlciB0aGFuXG4gKiByZWltcGxlbWVudGluZyB0aGVtLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29tcGlsZVBhdHRlcm4ocGF0dGVybjogc3RyaW5nKTogKHJlcG9SZWxQYXRoOiBzdHJpbmcpID0+IGJvb2xlYW4ge1xuICBsZXQgcGF0ID0gcGF0dGVybjtcbiAgbGV0IGRpck9ubHkgPSBmYWxzZTtcbiAgaWYgKHBhdC5lbmRzV2l0aCgnLycpKSB7XG4gICAgZGlyT25seSA9IHRydWU7XG4gICAgcGF0ID0gcGF0LnNsaWNlKDAsIC0xKTtcbiAgfVxuICBsZXQgYW5jaG9yZWQgPSBwYXQuaW5jbHVkZXMoJy8nKTtcbiAgaWYgKHBhdC5zdGFydHNXaXRoKCcvJykpIHtcbiAgICBhbmNob3JlZCA9IHRydWU7XG4gICAgcGF0ID0gcGF0LnNsaWNlKDEpO1xuICB9XG4gIGNvbnN0IHJlID0gZ2xvYlRvUmVnRXhwKHBhdCk7XG5cbiAgcmV0dXJuIChyZXBvUmVsUGF0aDogc3RyaW5nKSA9PiB7XG4gICAgaWYgKGFuY2hvcmVkKSB7XG4gICAgICBjb25zdCBzZWdzID0gYW5jZXN0b3JQYXRocyhyZXBvUmVsUGF0aCk7XG4gICAgICAvLyBGb3IgYSBkaXItb25seSBwYXR0ZXJuLCBuZXZlciB0ZXN0IHRoZSBsZWFmIGZpbGUgaXRzZWxmLlxuICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IGRpck9ubHkgPyBzZWdzLnNsaWNlKDAsIC0xKSA6IHNlZ3M7XG4gICAgICByZXR1cm4gY2FuZGlkYXRlcy5zb21lKChzKSA9PiByZS50ZXN0KHMpKTtcbiAgICB9XG4gICAgLy8gVW5hbmNob3JlZDogbWF0Y2ggYWdhaW5zdCBpbmRpdmlkdWFsIHBhdGggY29tcG9uZW50cyBhdCBhbnkgZGVwdGguXG4gICAgY29uc3QgY29tcG9uZW50cyA9IHJlcG9SZWxQYXRoLnNwbGl0KCcvJyk7XG4gICAgY29uc3QgY2FuZGlkYXRlcyA9IGRpck9ubHkgPyBjb21wb25lbnRzLnNsaWNlKDAsIC0xKSA6IGNvbXBvbmVudHM7XG4gICAgcmV0dXJuIGNhbmRpZGF0ZXMuc29tZSgoYykgPT4gcmUudGVzdChjKSk7XG4gIH07XG59XG5cbi8qKiBQYXJzZSBgLmhvb2tpZ25vcmVgIHRleHQgaW50byBydWxlcywgc2tpcHBpbmcgY29tbWVudHMgYW5kIG1hbGZvcm1lZCBsaW5lcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUhvb2tJZ25vcmUoY29udGVudDogc3RyaW5nKTogSWdub3JlUnVsZVtdIHtcbiAgY29uc3QgcnVsZXM6IElnbm9yZVJ1bGVbXSA9IFtdO1xuICBmb3IgKGNvbnN0IHJhd0xpbmUgb2YgY29udGVudC5zcGxpdCgnXFxuJykpIHtcbiAgICBjb25zdCBsaW5lID0gcmF3TGluZS50cmltKCk7XG4gICAgaWYgKCFsaW5lIHx8IGxpbmUuc3RhcnRzV2l0aCgnIycpKSBjb250aW51ZTtcbiAgICAvLyBgPHBhdHRlcm4+PHdoaXRlc3BhY2U+PHByZWZpeGVzPmAgXHUyMDE0IHBhdHRlcm4gaXMgdGhlIGZpcnN0IHRva2VuLCBwcmVmaXhlc1xuICAgIC8vIHRoZSBzZWNvbmQuIEEgbGluZSB3aXRob3V0IGJvdGggaXMgbWFsZm9ybWVkIGFuZCBza2lwcGVkLlxuICAgIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXihcXFMrKVxccysoXFxTKykkLyk7XG4gICAgaWYgKCFtYXRjaCkgY29udGludWU7XG4gICAgY29uc3QgWywgcGF0dGVybiwgcHJlZml4ZXNSYXddID0gbWF0Y2g7XG4gICAgY29uc3QgcHJlZml4ZXMgPSBwcmVmaXhlc1Jhd1xuICAgICAgLnNwbGl0KCcsJylcbiAgICAgIC5tYXAoKHApID0+IHAudHJpbSgpKVxuICAgICAgLmZpbHRlcihCb29sZWFuKTtcbiAgICBpZiAocHJlZml4ZXMubGVuZ3RoID09PSAwKSBjb250aW51ZTtcbiAgICBydWxlcy5wdXNoKHsgcGF0dGVybiwgcHJlZml4ZXMsIG1hdGNoZXM6IGNvbXBpbGVQYXR0ZXJuKHBhdHRlcm4pIH0pO1xuICB9XG4gIHJldHVybiBydWxlcztcbn1cblxuLyoqXG4gKiBMb2FkIHRoZSBzdXBwcmVzc2lvbiBydWxlcyBmb3IgYSByZXBvLiBGYWlsLW9wZW46IGFueSByZWFkIG9yIHBhcnNlIGZhaWx1cmVcbiAqIHlpZWxkcyBhbiBlbXB0eSBydWxlIHNldCwgc28gc3BhbnMgc3VyZmFjZSBhcyBub3JtYWwgd2hlbiBubyBjb25maWcgZXhpc3RzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbG9hZEhvb2tJZ25vcmUocmVwb1Jvb3Q6IHN0cmluZyk6IElnbm9yZVJ1bGVbXSB7XG4gIHRyeSB7XG4gICAgY29uc3QgY29udGVudCA9IGZzLnJlYWRGaWxlU3luYyhub2RlUGF0aC5qb2luKHJlcG9Sb290LCBIT09LX0lHTk9SRV9SRUwpLCAndXRmOCcpO1xuICAgIHJldHVybiBwYXJzZUhvb2tJZ25vcmUoY29udGVudCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBbXTtcbiAgfVxufVxuXG4vKiogQSBzbHVnIGNhcnJpZXMgYSBwcmVmaXggd2hlbiBpdCBlcXVhbHMgdGhlIHByZWZpeCBvciBpcyBgPHByZWZpeD4vXHUyMDI2YC4gKi9cbmZ1bmN0aW9uIHNsdWdIYXNQcmVmaXgoc2x1Zzogc3RyaW5nLCBwcmVmaXg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gc2x1ZyA9PT0gcHJlZml4IHx8IHNsdWcuc3RhcnRzV2l0aChgJHtwcmVmaXh9L2ApO1xufVxuXG4vKipcbiAqIFRydWUgd2hlbiBhIHNwYW4gYHNsdWdgIHNob3VsZCBiZSBzdXBwcmVzc2VkIGZvciBhbiBhbmNob3IgYXQgYHJlcG9SZWxQYXRoYDpcbiAqIHNvbWUgcnVsZSBtYXRjaGVzIHRoZSBwYXRoIGFuZCBsaXN0cyBhIHByZWZpeCB0aGUgc2x1ZyBjYXJyaWVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNTcGFuU3VwcHJlc3NlZChydWxlczogSWdub3JlUnVsZVtdLCByZXBvUmVsUGF0aDogc3RyaW5nLCBzbHVnOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgZm9yIChjb25zdCBydWxlIG9mIHJ1bGVzKSB7XG4gICAgaWYgKCFydWxlLm1hdGNoZXMocmVwb1JlbFBhdGgpKSBjb250aW51ZTtcbiAgICBpZiAocnVsZS5wcmVmaXhlcy5zb21lKChwKSA9PiBzbHVnSGFzUHJlZml4KHNsdWcsIHApKSkgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKiogU2lnbmF0dXJlIGZvciBpbmplY3RpbmcgYSBydWxlIGxvYWRlciAocHJvZHVjdGlvbiBkZWZhdWx0OiB7QGxpbmsgbG9hZEhvb2tJZ25vcmV9KS4gKi9cbmV4cG9ydCB0eXBlIEhvb2tJZ25vcmVMb2FkZXIgPSAocmVwb1Jvb3Q6IHN0cmluZykgPT4gSWdub3JlUnVsZVtdO1xuIiwgIi8qKlxuICogSGFybmVzcy1hZ25vc3RpYyB0b3VjaC1ob29rIGNvcmUuXG4gKlxuICogVGhpcyBtb2R1bGUgaW1wbGVtZW50cyB0aGUgUG9zdFRvb2xVc2UgXCJ0b3VjaCBzaWduYWxcIiB0aGF0IGJvdGggdGhlIENsYXVkZVxuICogKGBSZWFkfEVkaXR8V3JpdGVgKSBhbmQgQ29kZXggKGBhcHBseV9wYXRjaGApIGFkYXB0ZXJzIGRyaXZlLiBJdCBpbXBvcnRzXG4gKiBub3RoaW5nIGZyb20gZWl0aGVyIGhvb2sgU0RLIGFuZCBpcyB0eXBlZCBzdHJ1Y3R1cmFsbHksIHBlciB0aGUgYGNvbW1vbi9gXG4gKiBsYXllciBjb252ZW50aW9uOiBhZGFwdGVycyB0cmFuc2xhdGUgdGhlaXIgU0RLLXNwZWNpZmljIGhvb2sgaW5wdXQgaW50byBhXG4gKiB7QGxpbmsgVG91Y2hJbnB1dH0sIGluamVjdCBleGVjdXRpb24vc3RhdGUgZGVwZW5kZW5jaWVzLCBhbmQgd3JhcCB0aGUgcmV0dXJuZWRcbiAqIHtAbGluayBUb3VjaE91dHB1dH0gaW4gdGhlaXIgb3duIG91dHB1dCBidWlsZGVyLlxuICpcbiAqIFJldXNlZCBmcm9tIHRoZSBzaGFyZWQga2VybmVsIChub3QgcmVkZWZpbmVkKTogYGlzRGVidCgpYCArXG4gKiBgUG9yY2VsYWluU3RhdHVzYC9gRHJpZnRQb3JjZWxhaW5Sb3dgL2BQb3JjZWxhaW5Sb3dgL2BwYXJzZVBvcmNlbGFpbmAvXG4gKiBgcGFyc2VEcmlmdFBvcmNlbGFpbmAgKGFnZW50LWhvb2tzLWNvbW1vbi50cyksIGByYW5nZXNJbnRlcnNlY3RgIGFuZCB0aGVcbiAqIHJlcG8vc3Bhbi1yb290IHBhdGggdXRpbGl0aWVzIChhZ2VudC1ob29rcy1jb21tb24udHMpLCBhbmQgdGhlIGBNZW1vU3RvcmVgXG4gKiBjYWRlbmNlIHN0b3JlIChzcGFuLXN1cmZhY2UudHMpLlxuICovXG5cbmltcG9ydCB7IGV4ZWNGaWxlU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJztcbmltcG9ydCB7IGJhc2VuYW1lIH0gZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7XG4gIHR5cGUgRHJpZnRQb3JjZWxhaW5Sb3csXG4gIGh1bWFuU3RhdHVzTGFiZWwsXG4gIGlzRGVidCxcbiAgdHlwZSBMaW5lUmFuZ2UsXG4gIHR5cGUgUG9yY2VsYWluUm93LFxuICB0eXBlIFBvcmNlbGFpblN0YXR1cyxcbiAgcGFyc2VEcmlmdFBvcmNlbGFpbixcbiAgcGFyc2VQb3JjZWxhaW4sXG4gIHJhbmdlc0ludGVyc2VjdCxcbiAgcmVsYXRpdmVUb1JlcG8sXG4gIHJlc29sdmVSZXBvUm9vdCxcbiAgcmVzb2x2ZVNwYW5Sb290XG59IGZyb20gJy4vYWdlbnQtaG9va3MtY29tbW9uLmpzJztcbmltcG9ydCB7IGNvbGxhcHNlQnlQYXRoLCB0eXBlIFJhbmdlTGFiZWwsIHJlbmRlckFuY2hvclRyZWUgfSBmcm9tICcuL2FuY2hvci10cmVlLmpzJztcbmltcG9ydCB0eXBlIHsgTWVtb1N0b3JlIH0gZnJvbSAnLi9zcGFuLXN1cmZhY2UuanMnO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBvc3QtZWRpdCByYW5nZSByZWNvdmVyeVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogU3BsaXQgd3JpdHRlbiBjb250ZW50IGludG8gdGhlIGxpbmVzIHRvIGxvY2F0ZSBvbiBkaXNrLiBBIHNpbmdsZSB0cmFpbGluZ1xuICogbmV3bGluZSBpcyBkcm9wcGVkIHNvIGBcImFcXG5iXFxuXCJgIGFuZCBgXCJhXFxuYlwiYCBsb2NhdGUgaWRlbnRpY2FsbHk7IGFuIGVtcHR5XG4gKiAob3IgbmV3bGluZS1vbmx5KSB3cml0ZSBoYXMgbm8gbG9jYXRhYmxlIGJsb2NrLlxuICovXG5mdW5jdGlvbiB0b05lZWRsZUxpbmVzKHdyaXR0ZW46IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgaWYgKHdyaXR0ZW4ubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gIGNvbnN0IHRyaW1tZWQgPSB3cml0dGVuLmVuZHNXaXRoKCdcXG4nKSA/IHdyaXR0ZW4uc2xpY2UoMCwgLTEpIDogd3JpdHRlbjtcbiAgaWYgKHRyaW1tZWQubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG4gIHJldHVybiB0cmltbWVkLnNwbGl0KCdcXG4nKTtcbn1cblxuLyoqXG4gKiBSZWNvdmVyIHRoZSBsaW5lIHJhbmdlIHRoYXQgd3JpdHRlbiBjb250ZW50IG5vdyBvY2N1cGllcyBpbiB0aGUgb24tZGlzayBmaWxlLFxuICogZm9yIGFuY2hvcmluZyB0aGUgdG91Y2hlZCByZWdpb24gYWZ0ZXIgYW4gZWRpdCBoYXMgYWxyZWFkeSBhcHBsaWVkLlxuICpcbiAqIFRoaXMgZ2VuZXJhbGl6ZXMgdGhlIHByZS1lZGl0IGBsb2NhdGVDaHVuaygpYCB0ZWNobmlxdWUgaW5cbiAqIFthcHBseS1wYXRjaC50c10oLi9wYWNrYWdlcy9hZ2VudC1ob29rcy9zcmMvY29kZXgvYXBwbHktcGF0Y2gudHMjTDI1My1MMjg2KVxuICogKHByZXZpb3VzbHkgQ29kZXgtb25seSkgaW50byBhIHNoYXJlZCBwb3N0LWVkaXQgcHJpbWl0aXZlIGJvdGggaGFybmVzc2VzIHVzZTpcbiAqIHNwbGl0IGB3cml0dGVuYCBhbmQgYG9uRGlza0NvbnRlbnRgIGludG8gbGluZXMgYW5kIGxvY2F0ZSB0aGUgd3JpdHRlbiBibG9jayBhc1xuICogYSBjb250aWd1b3VzIHJ1biBpbnNpZGUgdGhlIG9uLWRpc2sgbGluZXMuXG4gKlxuICogLSBBIHNpbmdsZSBjb250aWd1b3VzIG1hdGNoIHlpZWxkcyBpdHMgMS1iYXNlZCBpbmNsdXNpdmUge0BsaW5rIExpbmVSYW5nZX0uXG4gKiAtIFdoZW4gdGhlIGJsb2NrIGlzIGFic2VudCwgb3IgYXBwZWFycyBtb3JlIHRoYW4gb25jZSAoY29udGV4dCB0byBkaXNhbWJpZ3VhdGVcbiAqICAgaXMgbm90IGF2YWlsYWJsZSBwb3N0LWVkaXQpLCByZWNvdmVyeSBpcyBhbWJpZ3VvdXMgYW5kIHRoZSByZXN1bHQgZGVncmFkZXNcbiAqICAgdG8gYCd3aG9sZS1maWxlJ2AgKHRoZSBzYW1lIGZhbGxiYWNrIGBsb2NhdGVDaHVuaygpYCBzaWduYWxzIHdpdGggYG51bGxgKS5cbiAqXG4gKiBOZXZlciB0aHJvd3M6IGFuIHVubG9jYXRhYmxlIHdyaXRlIGlzIGEgYCd3aG9sZS1maWxlJ2AgYW5zd2VyLCBub3QgYW4gZXJyb3IuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWNvdmVyUmFuZ2Uod3JpdHRlbjogc3RyaW5nLCBvbkRpc2tDb250ZW50OiBzdHJpbmcpOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScge1xuICBjb25zdCBuZWVkbGUgPSB0b05lZWRsZUxpbmVzKHdyaXR0ZW4pO1xuICBpZiAobmVlZGxlLmxlbmd0aCA9PT0gMCkgcmV0dXJuICd3aG9sZS1maWxlJztcblxuICBjb25zdCBoYXlzdGFjayA9IG9uRGlza0NvbnRlbnQuc3BsaXQoJ1xcbicpO1xuICBjb25zdCBsYXN0ID0gaGF5c3RhY2subGVuZ3RoIC0gbmVlZGxlLmxlbmd0aDtcbiAgY29uc3Qgc3RhcnRzOiBudW1iZXJbXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8PSBsYXN0OyBpKyspIHtcbiAgICBsZXQgb2sgPSB0cnVlO1xuICAgIGZvciAobGV0IGogPSAwOyBqIDwgbmVlZGxlLmxlbmd0aDsgaisrKSB7XG4gICAgICBpZiAoaGF5c3RhY2tbaSArIGpdICE9PSBuZWVkbGVbal0pIHtcbiAgICAgICAgb2sgPSBmYWxzZTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChvaykge1xuICAgICAgc3RhcnRzLnB1c2goaSk7XG4gICAgICBpZiAoc3RhcnRzLmxlbmd0aCA+IDEpIGJyZWFrOyAvLyBkdXBsaWNhdGVkIFx1MjE5MiBhbWJpZ3VvdXMsIHN0b3AgZWFybHlcbiAgICB9XG4gIH1cblxuICBpZiAoc3RhcnRzLmxlbmd0aCA9PT0gMSkge1xuICAgIHJldHVybiB7IHN0YXJ0OiBzdGFydHNbMF0gKyAxLCBlbmQ6IHN0YXJ0c1swXSArIG5lZWRsZS5sZW5ndGggfTtcbiAgfVxuICByZXR1cm4gJ3dob2xlLWZpbGUnO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIGlucHV0XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBXaGljaCBoYXJuZXNzIGV2ZW50IGZpcmVkLCBhcyB0aGUgdG91Y2ggY29yZSBzZWVzIGl0LiBUaGUgY29yZSBicmFuY2hlcyBvblxuICogdGhpczogYHdyaXRlYCBoZWFscyBwb3NpdGlvbmFsIGRyaWZ0IGluIHRoZSB3b3JraW5nIHRyZWUgYW5kIG1heSBzdXJmYWNlIGFcbiAqIG1lcmdlZCBibG9jazsgYHJlYWRgIG5ldmVyIG11dGF0ZXMgdGhlIHRyZWUgYW5kIGZpbHRlcnMgcG9zaXRpb25hbCBzdGF0dXNlc1xuICogb3V0IG9mIHdoYXQgaXQgc3VyZmFjZXMuXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoRXZlbnRLaW5kID0gJ3JlYWQnIHwgJ3dyaXRlJztcblxuLyoqIEZpZWxkcyBzaGFyZWQgYnkgZXZlcnkgdG91Y2gsIHJlZ2FyZGxlc3Mgb2Yga2luZC4gKi9cbmludGVyZmFjZSBUb3VjaElucHV0QmFzZSB7XG4gIC8qKiBIYXJuZXNzIHNlc3Npb24gaWQgXHUyMDE0IGtleXMgdGhlIHBlci1zZXNzaW9uIGNhZGVuY2Uge0BsaW5rIE1lbW9TdG9yZX0uICovXG4gIHNlc3Npb25JZDogc3RyaW5nO1xuICAvKipcbiAgICogV29ya2luZyBkaXJlY3RvcnkgdGhlIHRvb2wgcmFuIGluLCB1c2VkIHRvIGJvdW5kIHRoZSB0b3VjaCB0byB0aGUgQ1dEIHJlcG9cbiAgICogdmlhIGByZXNvbHZlVG91Y2hTY29wZSgpYCBiZWZvcmUgYW55IHNwYW4gaW52b2NhdGlvbi5cbiAgICovXG4gIGN3ZDogc3RyaW5nO1xuICAvKiogQWJzb2x1dGUsIGNhbm9uaWNhbGl6ZWQgcGF0aCBvZiB0aGUgdG91Y2hlZCBmaWxlLiAqL1xuICBmaWxlUGF0aDogc3RyaW5nO1xufVxuXG4vKiogQSByZWFkIHRvdWNoIChDbGF1ZGUgYFJlYWRgLCBvciBhIHJlYWQtc2hhcGVkIENvZGV4IGV2ZW50KS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hSZWFkSW5wdXQgZXh0ZW5kcyBUb3VjaElucHV0QmFzZSB7XG4gIGtpbmQ6ICdyZWFkJztcbiAgLyoqXG4gICAqIDEtYmFzZWQgc3RhcnRpbmcgbGluZSBvZiB0aGUgcmVhZCwgZnJvbSB0aGUgQ2xhdWRlIGBSZWFkYCB0b29sJ3MgYG9mZnNldGBcbiAgICogaW5wdXQuIGB1bmRlZmluZWRgIHdoZW4gdGhlIHJlYWQgaGFkIG5vIGBvZmZzZXRgIChyZWFkcyBmcm9tIGxpbmUgMSkuXG4gICAqL1xuICBvZmZzZXQ/OiBudW1iZXI7XG4gIC8qKlxuICAgKiBMaW5lIGNvdW50IG9mIHRoZSByZWFkLCBmcm9tIHRoZSBDbGF1ZGUgYFJlYWRgIHRvb2wncyBgbGltaXRgIGlucHV0LlxuICAgKiBgdW5kZWZpbmVkYCB3aGVuIHRoZSByZWFkIGhhZCBubyBgbGltaXRgIFx1MjAxNCBzZWUge0BsaW5rIERFRkFVTFRfUkVBRF9MSU1JVH1cbiAgICogZm9yIGhvdyB0aGUgcmFuZ2UgaXMgY29tcHV0ZWQgaW4gdGhhdCBjYXNlLlxuICAgKi9cbiAgbGltaXQ/OiBudW1iZXI7XG59XG5cbi8qKiBBIHdyaXRlIHRvdWNoIChDbGF1ZGUgYEVkaXRgL2BXcml0ZWAsIENvZGV4IGBhcHBseV9wYXRjaGApLiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaFdyaXRlSW5wdXQgZXh0ZW5kcyBUb3VjaElucHV0QmFzZSB7XG4gIGtpbmQ6ICd3cml0ZSc7XG4gIC8qKlxuICAgKiBUaGUgY29udGVudCBqdXN0IHdyaXR0ZW4gdG8gYGZpbGVQYXRoYCwgZmVkIHRvIHtAbGluayByZWNvdmVyUmFuZ2V9IHRvXG4gICAqIHJlLWFuY2hvciB0aGUgdG91Y2hlZCByZWdpb24gYWdhaW5zdCB0aGUgaGVhbGVkIG9uLWRpc2sgZmlsZS4gRm9yIGFcbiAgICogd2hvbGUtZmlsZSBjcmVhdGUgdGhpcyBpcyB0aGUgZW50aXJlIGZpbGUgYm9keTsgYW4gZW1wdHkgc3RyaW5nIG1lYW5zXG4gICAqIFwibm8gbG9jYXRhYmxlIGJsb2NrXCIgYW5kIHRoZSB0b3VjaCBpcyBzY29wZWQgZmlsZS13aWRlLlxuICAgKi9cbiAgd3JpdHRlbjogc3RyaW5nO1xufVxuXG4vKiogVGhlIGhhcm5lc3MtYWdub3N0aWMgdG91Y2ggdGhlIGNvcmUgY29uc3VtZXMuICovXG5leHBvcnQgdHlwZSBUb3VjaElucHV0ID0gVG91Y2hSZWFkSW5wdXQgfCBUb3VjaFdyaXRlSW5wdXQ7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gSW5qZWN0ZWQgZXhlY3V0b3JzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFN0cnVjdHVyZWQgcmVzdWx0IG9mIGEgc2NvcGVkIGBnaXQgc3BhbiBkcmlmdCA8ZmlsZT4gLS1maXhgLiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb3VjaEZpeFJlc3VsdCB7XG4gIC8qKlxuICAgKiBXaGV0aGVyIGAtLWZpeGAgcmUtYW5jaG9yZWQgYXQgbGVhc3Qgb25lIHNwYW4gaW4gdGhlIHdvcmtpbmcgdHJlZS4gRHJpdmVzXG4gICAqIHtAbGluayBUb3VjaE91dHB1dC50cmVlTW9kaWZpZWR9IHNvIGEgY2FsbGVyL3Rlc3QgY2FuIGFzc2VydCB0aGUgaGVhbGluZ1xuICAgKiBoYXBwZW5lZCB3aXRob3V0IGRpZmZpbmcgdGhlIHRyZWUgaXRzZWxmLlxuICAgKi9cbiAgbW9kaWZpZWQ6IGJvb2xlYW47XG59XG5cbi8qKlxuICogUnVuIGBnaXQgc3BhbiBkcmlmdCA8ZmlsZT4gLS1maXhgIHNjb3BlZCB0byB0aGUgdG91Y2hlZCBmaWxlICh3cml0ZSBwYXRoXG4gKiBvbmx5KSwgcmVwb3J0aW5nIHdoZXRoZXIgdGhlIHdvcmtpbmcgdHJlZSB3YXMgaGVhbGVkLiBBc3luYyBzbyB0aGUgZXZlbnR1YWxcbiAqIGltcGxlbWVudGF0aW9uIGFuZCBpdHMgdGVzdHMgY2FuIGluamVjdCBhIGZha2Ugd2l0aG91dCBhIHJlYWwgc3VicHJvY2Vzcy5cbiAqL1xuZXhwb3J0IHR5cGUgVG91Y2hGaXhFeGVjdXRvciA9IChmaWxlUGF0aDogc3RyaW5nLCBjd2Q6IHN0cmluZykgPT4gUHJvbWlzZTxUb3VjaEZpeFJlc3VsdD47XG5cbi8qKlxuICogUnVuIGBnaXQgc3BhbiBsaXN0IC0tcG9yY2VsYWluIDxmaWxlPmAgYW5kIHJldHVybiBpdHMgcGFyc2VkIHJvd3MgXHUyMDE0IG9uZSBwZXJcbiAqIGFuY2hvciBjb3ZlcmluZyB0aGUgZmlsZS4gU3RydWN0dXJlZCAobm90IHJhdyBzdGRvdXQpIHNvIHRoZSBtZXJnZWQtYmxvY2tcbiAqIGNvbXB1dGF0aW9uIGFuZCBpdHMgdGVzdHMgc2hhcmUgdGhlIHNhbWUgc2hhcGUuXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoTGlzdEV4ZWN1dG9yID0gKGZpbGVQYXRoOiBzdHJpbmcsIGN3ZDogc3RyaW5nKSA9PiBQcm9taXNlPFBvcmNlbGFpblJvd1tdPjtcblxuLyoqXG4gKiBSdW4gYGdpdCBzcGFuIGRyaWZ0IC0tZm9ybWF0IHBvcmNlbGFpbiA8YXJncz5gIChzY29wZWQgdG8gdGhlIHRvdWNoZWQgZmlsZSBvclxuICogaXRzIHNwYW5zKSBhbmQgcmV0dXJuIGl0cyBwYXJzZWQgcm93cyBcdTIwMTQgb25lIHBlciBkcmlmdGVkIGFuY2hvciwgZW1wdHkgd2hlblxuICogY2xlYW4uIFN0YXR1cyBjbGFzc2lmaWNhdGlvbiBpcyB2aWEgYGlzRGVidCgpYDsgcG9zaXRpb25hbCAoYE1PVkVEYCxcbiAqIGBSRVNPTFZFRF9QRU5ESU5HX0NPTU1JVGApIHJvd3MgYXJlIG5ldmVyIGRlYnQuXG4gKi9cbmV4cG9ydCB0eXBlIFRvdWNoRHJpZnRFeGVjdXRvciA9IChhcmdzOiBzdHJpbmdbXSwgY3dkOiBzdHJpbmcpID0+IFByb21pc2U8RHJpZnRQb3JjZWxhaW5Sb3dbXT47XG5cbi8qKlxuICogUnVuIGJhcmUgYGdpdCBzcGFuIHdoeSA8bmFtZT5gIGFuZCByZXR1cm4gdGhlIHNwYW4ncyByZWNvcmRlZCB3aHkgc2VudGVuY2UsXG4gKiBvciBgbnVsbGAgd2hlbiBub25lIGlzIHJlY29yZGVkIG9yIHRoZSByZWFkIGZhaWxzLiBGZWVkcyB0aGUgaHVtYW4tZm9ybWF0XG4gKiBzcGFuIHJlbmRlcjsgaW52b2tlZCBvbmx5IGZvciBzcGFucyBhY3R1YWxseSBiZWluZyBzdXJmYWNlZCB0aGlzIHRvdWNoLlxuICovXG5leHBvcnQgdHlwZSBUb3VjaFdoeUV4ZWN1dG9yID0gKG5hbWU6IHN0cmluZywgY3dkOiBzdHJpbmcpID0+IFByb21pc2U8c3RyaW5nIHwgbnVsbD47XG5cbi8qKlxuICogVGhlIGluamVjdGVkIGV4ZWN1dGlvbiBzdXJmYWNlLiBLZXB0IGFzIGZvdXIgbmFycm93IGFzeW5jIGZ1bmN0aW9ucyAocmF0aGVyXG4gKiB0aGFuIGEgcmF3IGNvbW1hbmQgcnVubmVyKSBzbyB0ZXN0cyBpbmplY3QgZmFrZXMgcmV0dXJuaW5nIHN0cnVjdHVyZWQgZGF0YVxuICogYW5kIHRoZSBjb3JlIG5ldmVyIHNwYXducyBhIHN1YnByb2Nlc3MgaXRzZWxmLiBUaGUgYHJlYWRgIHBhdGggbmV2ZXIgaW52b2tlc1xuICogYGZpeGAuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hFeGVjdXRvcnMge1xuICBmaXg6IFRvdWNoRml4RXhlY3V0b3I7XG4gIGxpc3Q6IFRvdWNoTGlzdEV4ZWN1dG9yO1xuICBkcmlmdDogVG91Y2hEcmlmdEV4ZWN1dG9yO1xuICB3aHk6IFRvdWNoV2h5RXhlY3V0b3I7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVG91Y2ggb3V0cHV0XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFdoYXQgdGhlIGNvcmUgaGFuZHMgYmFjayBmb3IgdGhlIGFkYXB0ZXIgdG8gdHJhbnNsYXRlIGludG8gU0RLIG91dHB1dC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVG91Y2hPdXRwdXQge1xuICAvKipcbiAgICogVGhlIG1lcmdlZCBgPGdpdC1zcGFuPmAgYmxvY2sgKGhlYWRlciwgb25lIGh1bWFuLWZvcm1hdCBzZWN0aW9uIHBlclxuICAgKiBzdXJmYWNlZCBzcGFuLCBmb290ZXIpIHRvIGluamVjdCB2aWEgdGhlIGhhcm5lc3MncyBgYWRkaXRpb25hbENvbnRleHRgLFxuICAgKiBvciBgbnVsbGAgd2hlbiB0aGVyZSBpcyBub3RoaW5nIHdvcnRoIHN1cmZhY2luZyB0aGlzIHRvdWNoLlxuICAgKi9cbiAgYWRkaXRpb25hbENvbnRleHQ6IHN0cmluZyB8IG51bGw7XG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSB3b3JraW5nIHRyZWUgd2FzIG1vZGlmaWVkIGJ5IGEgc2NvcGVkIGAtLWZpeGAgb24gdGhlIHdyaXRlIHBhdGguXG4gICAqIEFsd2F5cyBgZmFsc2VgIG9uIHRoZSByZWFkIHBhdGggKHJlYWRzIG5ldmVyIG11dGF0ZSB0aGUgdHJlZSkuXG4gICAqL1xuICB0cmVlTW9kaWZpZWQ6IGJvb2xlYW47XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTWVyZ2VkLWJsb2NrIGFzc2VtYmx5XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFRoZSBtZW1vIGtleSB1bmRlciB3aGljaCBhIHNwYW4ncyByZW5kZXIgZm9yIGEgZ2l2ZW4gZHJpZnQgc3RhdHVzIGlzIGRlZHVwZWQuICovXG5mdW5jdGlvbiBkcmlmdEtleShuYW1lOiBzdHJpbmcsIHN0YXR1czogUG9yY2VsYWluU3RhdHVzKTogc3RyaW5nIHtcbiAgLy8gU3BhbiBuYW1lcyBjb21lIGZyb20gdGFiLWRlbGltaXRlZCBwb3JjZWxhaW4sIHNvIHRoZXkgbmV2ZXIgY29udGFpbiBhIHRhYjtcbiAgLy8gYSB0YWItam9pbmVkIGtleSBjYW4gbmV2ZXIgY29sbGlkZSB3aXRoIGEgYmFyZSBzcGFuIG5hbWUgKHRoZSBzdXJmYWNpbmcga2V5KS5cbiAgcmV0dXJuIGAke25hbWV9XFx0JHtzdGF0dXN9YDtcbn1cblxuLyoqIFRoZSBgcGF0aCNMc3RhcnQtTGVuZGAgKG9yIGJhcmUtcGF0aCwgd2hvbGUtZmlsZSkgYW5jaG9yIHRleHQgZm9yIGEgcm93LiAqL1xuZnVuY3Rpb24gYW5jaG9yVGV4dChyb3c6IFBvcmNlbGFpblJvdyk6IHN0cmluZyB7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHJvdy5wYXRoO1xuICByZXR1cm4gYCR7cm93LnBhdGh9I0wke3Jvdy5zdGFydH0tTCR7cm93LmVuZH1gO1xufVxuXG5mdW5jdGlvbiBjbGVhbkhlYWRlcihmaWxlTmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGAke2ZpbGVOYW1lfSBoYXMgaW1wbGljaXQgZGVwZW5kZW5jaWVzOmA7XG59XG5cbmZ1bmN0aW9uIGNsZWFuRm9vdGVyKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYElmIHlvdSBjaGFuZ2UgJHtmaWxlTmFtZX0gY2hlY2sgdGhlIG90aGVyIGZpbGVzIHRvIGNvbmZpcm0gdGhleSBzdGlsbCB3b3JrIHRvZ2V0aGVyLmA7XG59XG5cbi8qKlxuICogVGhlIHdyaXRlIHBhdGggbmFtZXMgdGhlIGVkaXQgYXMgdGhlIGNhdXNlOyB0aGUgcmVhZCBwYXRoIG9ubHkgc3VyZmFjZXNcbiAqIHByZS1leGlzdGluZyBkcmlmdCBpdCBkaWRuJ3QgY3JlYXRlLCBzbyBpdCBuYW1lcyB0aGUgZGVwZW5kZW5jeSBpbnN0ZWFkLlxuICovXG5mdW5jdGlvbiBkcmlmdEhlYWRlcihkcmlmdGVkQ291bnQ6IG51bWJlciwga2luZDogVG91Y2hJbnB1dFsna2luZCddKTogc3RyaW5nIHtcbiAgaWYgKGtpbmQgPT09ICd3cml0ZScpIHtcbiAgICByZXR1cm4gZHJpZnRlZENvdW50ID09PSAxXG4gICAgICA/ICdUaGlzIGVkaXQgcHV0IGFuIGltcGxpY2l0IGRlcGVuZGVuY3kgb3V0IG9mIGRhdGU6J1xuICAgICAgOiAnVGhpcyBlZGl0IHB1dCBpbXBsaWNpdCBkZXBlbmRlbmNpZXMgb3V0IG9mIGRhdGU6JztcbiAgfVxuICByZXR1cm4gZHJpZnRlZENvdW50ID09PSAxXG4gICAgPyAnVGhpcyBmaWxlIGhhcyBhbiBpbXBsaWNpdCBkZXBlbmRlbmN5IG91dCBvZiBkYXRlOidcbiAgICA6ICdUaGlzIGZpbGUgaGFzIGltcGxpY2l0IGRlcGVuZGVuY2llcyBvdXQgb2YgZGF0ZTonO1xufVxuXG5mdW5jdGlvbiBkcmlmdEZvb3RlcihkcmlmdGVkTmFtZXM6IHN0cmluZ1tdKTogc3RyaW5nIHtcbiAgaWYgKGRyaWZ0ZWROYW1lcy5sZW5ndGggPT09IDEpIHtcbiAgICBjb25zdCBuYW1lID0gZHJpZnRlZE5hbWVzWzBdO1xuICAgIHJldHVybiBgUmVzdG9yZSBhZ3JlZW1lbnQgYmVmb3JlIGNvbW1pdHRpbmcuIEZvbGxvdyBjb25maXJtZWQgYXV0aG9yaXR5LiBQcmVzZXJ2ZSBhbmNob3Igc2hhcGU7IGlmIGFuIGFkZHJlc3MgY2hhbmdlZCwgc3dhcCB0aGUgb2xkIGFuY2hvciBmb3IgdGhlIG5ldyBvbmUgd2l0aCBcXGBnaXQgc3BhbiByZXBsYWNlXFxgLiBVcGRhdGUgb3IgcmV0aXJlIHRoZSB3aHkgb25seSBpZiBpdHMgbWVhbmluZyBjaGFuZ2VkLiBSZXF1aXJlIFxcYGdpdCBzcGFuIGRyaWZ0ICR7bmFtZX1cXGAgdG8gcmVwb3J0IHplcm8sIHRoZW4gY2hlY2sgdGhlIG90aGVyIGFuY2hvcnMuIENvbmZvcm0gYSBzaWRlIG9ubHkgd2hlbiBjb25maXJtZWQgYXV0aG9yaXR5IG9yIGEgc2F0aXNmaWVkIGdhdGUgZGVjaWRlcyBpdDsgcmVwb3J0IGFtYmlndWl0eSBvciBhbiBvYnNvbGV0ZSBjb3VwbGluZy5gO1xuICB9XG4gIHJldHVybiAnRm9yIGVhY2ggb3V0LW9mLWRhdGUgc3BhbjogcmVzdG9yZSBhZ3JlZW1lbnQgYmVmb3JlIGNvbW1pdHRpbmcuIEZvbGxvdyBjb25maXJtZWQgYXV0aG9yaXR5LiBQcmVzZXJ2ZSBhbmNob3Igc2hhcGU7IGlmIGFuIGFkZHJlc3MgY2hhbmdlZCwgc3dhcCB0aGUgb2xkIGFuY2hvciBmb3IgdGhlIG5ldyBvbmUgd2l0aCBgZ2l0IHNwYW4gcmVwbGFjZWAuIFVwZGF0ZSBvciByZXRpcmUgdGhlIHdoeSBvbmx5IGlmIGl0cyBtZWFuaW5nIGNoYW5nZWQuIFJlcXVpcmUgYGdpdCBzcGFuIGRyaWZ0IDxuYW1lPmAgdG8gcmVwb3J0IHplcm8sIHRoZW4gY2hlY2sgdGhlIG90aGVyIGFuY2hvcnMuIENvbmZvcm0gYSBzaWRlIG9ubHkgd2hlbiBjb25maXJtZWQgYXV0aG9yaXR5IG9yIGEgc2F0aXNmaWVkIGdhdGUgZGVjaWRlcyBpdDsgcmVwb3J0IGFtYmlndWl0eSBvciBhbiBvYnNvbGV0ZSBjb3VwbGluZy4nO1xufVxuXG4vKiogVGhlIHtAbGluayBSYW5nZUxhYmVsfSBmb3IgYSBwb3JjZWxhaW4gcm93IFx1MjAxNCBgMC0wYCBpcyB0aGUgd2hvbGUtZmlsZSBhbmNob3IuICovXG5mdW5jdGlvbiByYW5nZUxhYmVsKHJvdzogUG9yY2VsYWluUm93KTogUmFuZ2VMYWJlbCB7XG4gIGlmIChyb3cuc3RhcnQgPT09IDAgJiYgcm93LmVuZCA9PT0gMCkgcmV0dXJuIHsga2luZDogJ3dob2xlLWZpbGUnIH07XG4gIHJldHVybiB7IGtpbmQ6ICdyYW5nZScsIHN0YXJ0OiByb3cuc3RhcnQsIGVuZDogcm93LmVuZCB9O1xufVxuXG4vKipcbiAqIEEgc3BhbidzIGZ1bGwgYW5jaG9yIGxpc3QsIHJlbmRlcmVkIGFzIGEgc2hhcmVkLXByZWZpeCB0cmVlIGJ5XG4gKiB7QGxpbmsgcmVuZGVyQW5jaG9yVHJlZX0sIHdpdGggZWFjaCBhbmNob3IgdGhhdCBjYXJyaWVzIGdlbnVpbmUgZHJpZnRcbiAqIHN1ZmZpeGVkIGJ5IGl0cyBsb3dlcmNhc2Ugc3RhdHVzIHRva2VuKHMpIChgIFx1MjAxNCBjaGFuZ2VkYCkuXG4gKlxuICogQSBkcmlmdCByb3cgbWF0Y2hlcyBhbiBhbmNob3IgYnkgZXhhY3QgcGF0aCtyYW5nZSwgb3IgYnkgcGF0aCBhbG9uZSB3aGVuIHRoZVxuICogc3BhbiBoYXMgYSBzaW5nbGUgYW5jaG9yIG9uIHRoYXQgcGF0aCAocmFuZ2VzIGNhbiBkaXNhZ3JlZSBhZnRlciBhIGhlYWwpLlxuICogYHNvbGVPblBhdGhgIGlzIGRlbGliZXJhdGVseSBjb21wdXRlZCBvdmVyIHRoZSAqKmZ1bGwgZmxhdCBhbmNob3IgbGlzdCoqLFxuICogYmVmb3JlIGFueSBncm91cGluZyBcdTIwMTQgdGhlIHRyZWUgbGF5b3V0IG11c3QgbmV2ZXIgYmUgYWJsZSB0byBjaGFuZ2UgKndoaWNoKlxuICogYW5jaG9ycyBnZXQgbGFiZWxlZCwgb25seSB3aGVyZSB0aGV5IHNpdCBvbiB0aGUgcGFnZS5cbiAqL1xuZnVuY3Rpb24gYW5jaG9yQnVsbGV0cyhhbmNob3JzOiBQb3JjZWxhaW5Sb3dbXSwgZGVidFJvd3M6IERyaWZ0UG9yY2VsYWluUm93W10pOiBzdHJpbmdbXSB7XG4gIGNvbnN0IHJvd3MgPSBhbmNob3JzLm1hcCgoYW5jaG9yKSA9PiB7XG4gICAgY29uc3Qgc29sZU9uUGF0aCA9IGFuY2hvcnMuZmlsdGVyKChhKSA9PiBhLnBhdGggPT09IGFuY2hvci5wYXRoKS5sZW5ndGggPT09IDE7XG4gICAgY29uc3Qgc3RhdHVzZXMgPSBuZXcgU2V0PFBvcmNlbGFpblN0YXR1cz4oKTtcbiAgICBmb3IgKGNvbnN0IHJvdyBvZiBkZWJ0Um93cykge1xuICAgICAgaWYgKHJvdy5wYXRoICE9PSBhbmNob3IucGF0aCkgY29udGludWU7XG4gICAgICBpZiAoc29sZU9uUGF0aCB8fCAocm93LnN0YXJ0ID09PSBhbmNob3Iuc3RhcnQgJiYgcm93LmVuZCA9PT0gYW5jaG9yLmVuZCkpIHtcbiAgICAgICAgc3RhdHVzZXMuYWRkKHJvdy5zdGF0dXMpO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBzb3J0ZWQgPSBbLi4uc3RhdHVzZXNdLnNvcnQoKTtcbiAgICBjb25zdCBzdWZmaXggPSBzb3J0ZWQubGVuZ3RoID4gMCA/IGAgXHUyMDE0ICR7c29ydGVkLm1hcChodW1hblN0YXR1c0xhYmVsKS5qb2luKCcsICcpfWAgOiAnJztcbiAgICByZXR1cm4geyBwYXRoOiBhbmNob3IucGF0aCwgcmFuZ2U6IHJhbmdlTGFiZWwoYW5jaG9yKSwgc3VmZml4IH07XG4gIH0pO1xuICB0cnkge1xuICAgIHJldHVybiByZW5kZXJBbmNob3JUcmVlKGNvbGxhcHNlQnlQYXRoKHJvd3MpKTtcbiAgfSBjYXRjaCB7XG4gICAgLy8gRkFJTC1DTE9TRUQsIG5vdCBhIGA8Z3JlZW5maWVsZD5gLWZvcmJpZGRlbiBmYWxsYmFjayBcdTIwMTQgZG8gbm90IHJlbW92ZSBpdFxuICAgIC8vIG9uIHRoZSB0aGVvcnkgdGhhdCBhIGRlZ3JhZGVkIGZhbGxiYWNrIGlzIGl0c2VsZiBmb3JiaWRkZW4uIEFuIHVuY2F1Z2h0XG4gICAgLy8gdGhyb3cgaGVyZSBkb2VzIG5vdCBkZWdyYWRlIHRvIGEgZmxhdCBsaXN0OiBpdCBlc2NhcGVzIHRvXG4gICAgLy8gYHJ1blRvdWNoSG9va2AncyBjYXRjaCwgd2hpY2ggcmVzb2x2ZXMgdGhlIHdob2xlIGhvb2sgdG9cbiAgICAvLyBgYWRkaXRpb25hbENvbnRleHQ6IG51bGxgLCBzbyB0aGUgYWdlbnQgaXMgbmV2ZXIgdG9sZCBhYm91dCB0aGUgZHJpZnQgYXRcbiAgICAvLyBhbGwuIENhdGNoaW5nIGxvY2FsbHkgbmFycm93cyB3aGF0IGEgcmVuZGVyaW5nIGRlZmVjdCBjYW4gY29zdCBmcm9tIFwidGhlXG4gICAgLy8gcmVtaW5kZXIgZGlzYXBwZWFyc1wiIHRvIFwidGhlIHJlbWluZGVyIGxvb2tzIGxpa2UgaXQgZGlkIGJlZm9yZSB0aGUgdHJlZVwiLlxuICAgIC8vIFdoZXRoZXIgdG8gc3VyZmFjZSBhbmQgd2hhdCBzaGFwZSB0byBzdXJmYWNlIGluIGFyZSBkaWZmZXJlbnQgdGhpbmdzLCBhbmRcbiAgICAvLyB0aGlzIGNhdGNoIG9ubHkgZXZlciB0b3VjaGVzIHRoZSBsYXR0ZXIuXG4gICAgLy8gYHJvd3NgIGlzIGluZGV4LWFsaWduZWQgd2l0aCBgYW5jaG9yc2AsIHNvIHRoaXMgcmVwcm9kdWNlcyB0b2RheSdzIGZsYXRcbiAgICAvLyBidWxsZXQgcnVuIGJ5dGUgZm9yIGJ5dGUsIHN1ZmZpeGVzIGluY2x1ZGVkLlxuICAgIHJldHVybiBhbmNob3JzLm1hcCgoYW5jaG9yLCBpKSA9PiBgLSAke2FuY2hvclRleHQoYW5jaG9yKX0ke3Jvd3NbaV0uc3VmZml4fWApO1xuICB9XG59XG5cbi8qKlxuICogT25lIGh1bWFuLWZvcm1hdCBzcGFuIHNlY3Rpb246IGAjIyA8bmFtZT5gLCB0aGUgZnVsbCBhbmNob3IgbGlzdCAoZHJpZnRlZFxuICogYW5jaG9ycyBzdGF0dXMtc3VmZml4ZWQpLCBhbmQgdGhlIHdoeSBzZW50ZW5jZSB3aGVuIG9uZSBpcyByZWNvcmRlZC5cbiAqXG4gKiBUaGUgbmFtZSBoZWFkZXIgYW5kIHRoZSB3aHkgc2VudGVuY2UgYXJlIHRoZSBzYW1lIHNoYXBlIGBnaXQgc3BhbiBsaXN0YFxuICogcmVuZGVyczsgdGhlIGFuY2hvciBsaXN0IGRlbGliZXJhdGVseSBpcyBub3QgXHUyMDE0IGl0IHJlbmRlcnMgYXMgYSBzaGFyZWQtcHJlZml4XG4gKiB0cmVlICh7QGxpbmsgYW5jaG9yQnVsbGV0c30pIHdoZXJlIHRoZSBDTEkgcHJpbnRzIGEgZmxhdCBgLSBwYXRoI0xyYW5nZWBcbiAqIGJ1bGxldCBydW4uIFRoZSBDTEkncyBvd24gdGV4dCBmb3JtYXQgaXMgdW50b3VjaGVkOyBvbmx5IHRoaXMgaG9vaydzXG4gKiByZS1wcmVzZW50YXRpb24gb2YgaXQgZ3JvdXBzLlxuICovXG5mdW5jdGlvbiByZW5kZXJTcGFuU2VjdGlvbihcbiAgbmFtZTogc3RyaW5nLFxuICBhbmNob3JzOiBQb3JjZWxhaW5Sb3dbXSxcbiAgZGVidFJvd3M6IERyaWZ0UG9yY2VsYWluUm93W10sXG4gIHdoeTogc3RyaW5nIHwgbnVsbFxuKTogc3RyaW5nIHtcbiAgY29uc3QgbGluZXMgPSBbYCMjICR7bmFtZX1gLCAuLi5hbmNob3JCdWxsZXRzKGFuY2hvcnMsIGRlYnRSb3dzKV07XG4gIGlmICh3aHkpIGxpbmVzLnB1c2goJycsIHdoeSk7XG4gIHJldHVybiBsaW5lcy5qb2luKCdcXG4nKTtcbn1cblxuLyoqXG4gKiBBc3NlbWJsZSB0aGUgbWVyZ2VkIGA8Z2l0LXNwYW4+YCBibG9jazogaGVhZGVyLCBvbmUgc2VjdGlvbiBwZXIgc3VyZmFjZWRcbiAqIHNwYW4gKHNlcGFyYXRlZCBieSBgLS0tYCksIGFuZCBhIHNpbmdsZSBmb290ZXIgYWZ0ZXIgYSBmaW5hbCBgLS0tYC5cbiAqL1xuZnVuY3Rpb24gYnVpbGRCbG9jayhzZWN0aW9uczogc3RyaW5nW10sIGhlYWRlcjogc3RyaW5nLCBmb290ZXI6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGJvZHkgPSBgJHtoZWFkZXJ9XFxuXFxuJHtzZWN0aW9ucy5qb2luKCdcXG5cXG4tLS1cXG5cXG4nKX1cXG5cXG4tLS1cXG5cXG4ke2Zvb3Rlcn1gO1xuICByZXR1cm4gYFxcbjxnaXQtc3Bhbj5cXG4ke2JvZHl9XFxuPC9naXQtc3Bhbj5cXG5gO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRvdWNoIGhvb2sgZW50cnkgcG9pbnRcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogV2hldGhlciBhIGNvdmVyaW5nIHJvdyBpcyBpbiBzY29wZSBmb3IgdGhlIHJlY292ZXJlZCByYW5nZS4gKi9cbmZ1bmN0aW9uIGludGVyc2VjdHMocm93OiBQb3JjZWxhaW5Sb3csIHJhbmdlOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScpOiBib29sZWFuIHtcbiAgaWYgKHJhbmdlID09PSAnd2hvbGUtZmlsZScpIHJldHVybiB0cnVlO1xuICBpZiAocm93LnN0YXJ0ID09PSAwICYmIHJvdy5lbmQgPT09IDApIHJldHVybiB0cnVlOyAvLyB3aG9sZS1maWxlIGFuY2hvclxuICByZXR1cm4gcmFuZ2VzSW50ZXJzZWN0KHJhbmdlLCB7IHN0YXJ0OiByb3cuc3RhcnQsIGVuZDogcm93LmVuZCB9KTtcbn1cblxuLyoqXG4gKiBSZWNvdmVyIHRoZSB0b3VjaGVkIHJhbmdlIGZyb20gdGhlIG9uLWRpc2sgZmlsZSBmb3IgYSB3cml0ZS4gQW4gZW1wdHkgd3JpdGUgb3JcbiAqIGFuIHVucmVhZGFibGUgZmlsZSAoZS5nLiBhIGRlbGV0ZSwgb3IgdGhlIGZpbGUgd2FzIG5ldmVyIHdyaXR0ZW4pIGRlZ3JhZGVzIHRvXG4gKiBgJ3dob2xlLWZpbGUnYCwgc2NvcGluZyB0aGUgdG91Y2ggdG8gZXZlcnkgY292ZXJpbmcgc3BhbiBcdTIwMTQgdGhlIGZhaWwtb3BlblxuICogYmVoYXZpb3IsIG5vdCBhbiBlcnJvci5cbiAqL1xuZnVuY3Rpb24gcmVjb3ZlclJhbmdlRnJvbURpc2sod3JpdHRlbjogc3RyaW5nLCBmaWxlUGF0aDogc3RyaW5nKTogTGluZVJhbmdlIHwgJ3dob2xlLWZpbGUnIHtcbiAgaWYgKHdyaXR0ZW4ubGVuZ3RoID09PSAwKSByZXR1cm4gJ3dob2xlLWZpbGUnO1xuICBsZXQgY29udGVudDogc3RyaW5nO1xuICB0cnkge1xuICAgIGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgsICd1dGY4Jyk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiAnd2hvbGUtZmlsZSc7XG4gIH1cbiAgcmV0dXJuIHJlY292ZXJSYW5nZSh3cml0dGVuLCBjb250ZW50KTtcbn1cblxuLyoqXG4gKiBUaGUgQ2xhdWRlIGBSZWFkYCB0b29sJ3MgZG9jdW1lbnRlZCBkZWZhdWx0IGxpbmUgY291bnQgd2hlbiBgb2Zmc2V0YCBpc1xuICogZ2l2ZW4gd2l0aG91dCBgbGltaXRgIChcIkJ5IGRlZmF1bHQsIGl0IHJlYWRzIHVwIHRvIDIwMDAgbGluZXNcIikuIE5hbWVkIHNvXG4gKiB0aGUgYXNzdW1wdGlvbiBpcyB2aXNpYmxlIGFuZCBlYXN5IHRvIHVwZGF0ZSBpZiB0aGF0IGRlZmF1bHQgZXZlciBjaGFuZ2VzLlxuICovXG5leHBvcnQgY29uc3QgREVGQVVMVF9SRUFEX0xJTUlUID0gMjAwMDtcblxuLyoqXG4gKiBDb21wdXRlIHRoZSB0b3VjaGVkIHJhbmdlIGZvciBhIHJlYWQgZnJvbSB0aGUgQ2xhdWRlIGBSZWFkYCB0b29sJ3NcbiAqIGBvZmZzZXRgL2BsaW1pdGAgaW5wdXRzLiBOZWl0aGVyIHByZXNlbnQgbWVhbnMgYSBnZW51aW5lIHdob2xlLWZpbGUgcmVhZCBcdTIwMTRcbiAqIGV2ZXJ5IGNvdmVyaW5nIHNwYW4gc3RheXMgaW4gc2NvcGUsIG1hdGNoaW5nIHRvZGF5J3MgYmVoYXZpb3IuIE90aGVyd2lzZVxuICogdGhlIHJhbmdlIHN0YXJ0cyBhdCBgb2Zmc2V0YCAoZGVmYXVsdCBsaW5lIDEpIGFuZCBydW5zIGZvciBgbGltaXRgIGxpbmVzXG4gKiAoZGVmYXVsdCB7QGxpbmsgREVGQVVMVF9SRUFEX0xJTUlUfSksIGNsYW1wZWQgdG8gdGhlIGZpbGUncyBhY3R1YWwgbGluZVxuICogY291bnQgc28gYSBzaG9ydCBmaWxlIHdpdGggYSBsYXJnZSBgb2Zmc2V0YC9gbGltaXRgIGRvZXNuJ3Qgb3ZlcnNob290LlxuICogQ2xhbXBpbmcgcmVxdWlyZXMgcmVhZGluZyB0aGUgZmlsZTsgYW4gdW5yZWFkYWJsZSBmaWxlIGRlZ3JhZGVzIHRvXG4gKiBgJ3dob2xlLWZpbGUnYCBcdTIwMTQgdGhlIHNhbWUgZmFpbC1vcGVuIGJlaGF2aW9yIHRoZSB3cml0ZSBwYXRoIHVzZXMuXG4gKi9cbmZ1bmN0aW9uIHJlY292ZXJSZWFkUmFuZ2UoXG4gIG9mZnNldDogbnVtYmVyIHwgdW5kZWZpbmVkLFxuICBsaW1pdDogbnVtYmVyIHwgdW5kZWZpbmVkLFxuICBmaWxlUGF0aDogc3RyaW5nXG4pOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZScge1xuICBpZiAob2Zmc2V0ID09PSB1bmRlZmluZWQgJiYgbGltaXQgPT09IHVuZGVmaW5lZCkgcmV0dXJuICd3aG9sZS1maWxlJztcbiAgY29uc3Qgc3RhcnQgPSBvZmZzZXQgPz8gMTtcbiAgbGV0IGxpbmVDb3VudDogbnVtYmVyO1xuICB0cnkge1xuICAgIGNvbnN0IGNvbnRlbnQgPSBmcy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgsICd1dGY4Jyk7XG4gICAgbGluZUNvdW50ID0gY29udGVudC5sZW5ndGggPT09IDAgPyAwIDogY29udGVudC5zcGxpdCgnXFxuJykubGVuZ3RoO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gJ3dob2xlLWZpbGUnO1xuICB9XG4gIGNvbnN0IGVuZCA9IE1hdGgubWluKHN0YXJ0ICsgKGxpbWl0ID8/IERFRkFVTFRfUkVBRF9MSU1JVCkgLSAxLCBNYXRoLm1heChsaW5lQ291bnQsIHN0YXJ0KSk7XG4gIHJldHVybiB7IHN0YXJ0LCBlbmQgfTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGEgY292ZXJpbmcgcm93IGlzIGFuIGFuY2hvciBpbiB0aGUgdG91Y2hlZCBmaWxlIGl0c2VsZi4gYGxpc3RcbiAqIC0tcG9yY2VsYWluIDxmaWxlPmAgcmV0dXJucyBldmVyeSBhbmNob3Igb2YgZWFjaCBtYXRjaGluZyBzcGFuIFx1MjAxNCBjcm9zcy1maWxlXG4gKiBhbmNob3JzIGluY2x1ZGVkIFx1MjAxNCBidXQgb25seSBhbmNob3JzIGluIHRoZSB0b3VjaGVkIGZpbGUgcGFydGljaXBhdGUgaW4gdGhlXG4gKiByYW5nZS1pbnRlcnNlY3Rpb24gc2NvcGUgdGVzdC4gUm93IHBhdGhzIGFyZSByZXBvLXJlbGF0aXZlOyB0aGUgdG91Y2hlZCBwYXRoXG4gKiBpcyBhYnNvbHV0ZSwgc28gbWF0Y2ggb24gYW4gZXhhY3Qgb3IgYC9gLXNlcGFyYXRlZCBzdWZmaXguXG4gKi9cbmZ1bmN0aW9uIG9uVG91Y2hlZEZpbGUocm93OiBQb3JjZWxhaW5Sb3csIGZpbGVQYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgcmV0dXJuIGZpbGVQYXRoID09PSByb3cucGF0aCB8fCBmaWxlUGF0aC5lbmRzV2l0aChgLyR7cm93LnBhdGh9YCk7XG59XG5cbi8qKlxuICogQ29tcHV0ZSB0aGUgbWVyZ2VkIGA8Z2l0LXNwYW4+YCBibG9jayBmb3IgdGhlIHRvdWNoLCBvciBgbnVsbGAgd2hlbiB0aGVyZSBpc1xuICogbm90aGluZyB3b3J0aCBzdXJmYWNpbmcuIFNoYXJlZCBieSBib3RoIHBhdGhzOyB0aGUgd3JpdGUgcGF0aCBwYXNzZXMgYVxuICogcmVjb3ZlcmVkIHJhbmdlIGZvciBwcmVjaXNpb24sIHRoZSByZWFkIHBhdGggc2NvcGVzIGZpbGUtd2lkZS5cbiAqXG4gKiBBIHNwYW4gcmVuZGVycyBhcyBhIGZ1bGwgaHVtYW4tZm9ybWF0IHNlY3Rpb24gKG5hbWUsIGFsbCBhbmNob3JzIHdpdGhcbiAqIGRyaWZ0ZWQgb25lcyBzdGF0dXMtc3VmZml4ZWQsIHdoeSkgd2hlbiBpdHMgbmFtZSBoYXMgbm90IGJlZW4gc3VyZmFjZWQgdGhpc1xuICogc2Vzc2lvbiwgb3Igd2hlbiBpdCBjYXJyaWVzIGEgZHJpZnQgc3RhdHVzIG5vdCB5ZXQgc3VyZmFjZWQgZm9yIGl0IFx1MjAxNCBzbyBhXG4gKiBzcGFuIGZpcnN0IHNlZW4gaGVhbHRoeSByZS1yZW5kZXJzIGluIGZ1bGwgd2hlbiBkcmlmdCBsYXRlciBhcHBlYXJzLiBBIHNwYW5cbiAqIHdob3NlIG9ubHkgZHJpZnQgaXMgcG9zaXRpb25hbCAoYE1PVkVEYC9gUkVTT0xWRURfUEVORElOR19DT01NSVRgIFx1MjAxNCBuZXZlclxuICogYGlzRGVidGApIGlzIGZpbHRlcmVkIG91dCBlbnRpcmVseTogcG9zaXRpb25hbCBkcmlmdCBuZXZlciBzdXJmYWNlcy5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gY29tcHV0ZVN1cmZhY2UoXG4gIGlucHV0OiBUb3VjaElucHV0LFxuICBleGVjdXRvcnM6IFRvdWNoRXhlY3V0b3JzLFxuICBtZW1vOiBNZW1vU3RvcmUsXG4gIHJhbmdlOiBMaW5lUmFuZ2UgfCAnd2hvbGUtZmlsZSdcbik6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICBjb25zdCBjb3ZlcmluZyA9IGF3YWl0IGV4ZWN1dG9ycy5saXN0KGlucHV0LmZpbGVQYXRoLCBpbnB1dC5jd2QpO1xuICBpZiAoY292ZXJpbmcubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICAvLyBHcm91cCBldmVyeSBhbmNob3IgYnkgc3BhbjsgYSBzcGFuIGlzIGluIHNjb3BlIHdoZW4gb25lIG9mIGl0cyBhbmNob3JzIG9uXG4gIC8vIHRoZSB0b3VjaGVkIGZpbGUgaW50ZXJzZWN0cyB0aGUgcmVjb3ZlcmVkIHJhbmdlLlxuICBjb25zdCBhbmNob3JzQnlOYW1lID0gbmV3IE1hcDxzdHJpbmcsIFBvcmNlbGFpblJvd1tdPigpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiBjb3ZlcmluZykge1xuICAgIGNvbnN0IHJvd3MgPSBhbmNob3JzQnlOYW1lLmdldChyb3cubmFtZSkgPz8gW107XG4gICAgcm93cy5wdXNoKHJvdyk7XG4gICAgYW5jaG9yc0J5TmFtZS5zZXQocm93Lm5hbWUsIHJvd3MpO1xuICB9XG4gIGNvbnN0IHRvdWNoZWROYW1lcyA9IFsuLi5hbmNob3JzQnlOYW1lLmtleXMoKV0uZmlsdGVyKChuYW1lKSA9PlxuICAgIChhbmNob3JzQnlOYW1lLmdldChuYW1lKSA/PyBbXSkuc29tZSgocm93KSA9PiBvblRvdWNoZWRGaWxlKHJvdywgaW5wdXQuZmlsZVBhdGgpICYmIGludGVyc2VjdHMocm93LCByYW5nZSkpXG4gICk7XG4gIGlmICh0b3VjaGVkTmFtZXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBkcmlmdFJvd3MgPSBhd2FpdCBleGVjdXRvcnMuZHJpZnQoW2lucHV0LmZpbGVQYXRoXSwgaW5wdXQuY3dkKTtcbiAgY29uc3QgZHJpZnRCeU5hbWUgPSBuZXcgTWFwPHN0cmluZywgRHJpZnRQb3JjZWxhaW5Sb3dbXT4oKTtcbiAgZm9yIChjb25zdCByb3cgb2YgZHJpZnRSb3dzKSB7XG4gICAgY29uc3Qgcm93cyA9IGRyaWZ0QnlOYW1lLmdldChyb3cubmFtZSkgPz8gW107XG4gICAgcm93cy5wdXNoKHJvdyk7XG4gICAgZHJpZnRCeU5hbWUuc2V0KHJvdy5uYW1lLCByb3dzKTtcbiAgfVxuXG4gIGNvbnN0IHN1cmZhY2VkID0gbWVtby5nZXRTdXJmYWNlZChpbnB1dC5zZXNzaW9uSWQpO1xuICBjb25zdCB0b1JlY29yZDogc3RyaW5nW10gPSBbXTtcbiAgY29uc3Qgc2VjdGlvbnM6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGRyaWZ0ZWROYW1lczogc3RyaW5nW10gPSBbXTtcblxuICBmb3IgKGNvbnN0IG5hbWUgb2YgdG91Y2hlZE5hbWVzKSB7XG4gICAgY29uc3Qgc3BhbkRyaWZ0ID0gZHJpZnRCeU5hbWUuZ2V0KG5hbWUpID8/IFtdO1xuICAgIGNvbnN0IGRlYnRSb3dzID0gc3BhbkRyaWZ0LmZpbHRlcigocm93KSA9PiBpc0RlYnQocm93LnN0YXR1cykpO1xuICAgIGlmIChzcGFuRHJpZnQubGVuZ3RoID4gMCAmJiBkZWJ0Um93cy5sZW5ndGggPT09IDApIGNvbnRpbnVlOyAvLyBwb3NpdGlvbmFsLW9ubHkgZHJpZnQgbmV2ZXIgc3VyZmFjZXNcblxuICAgIGNvbnN0IGRlYnRTdGF0dXNlcyA9IFsuLi5uZXcgU2V0KGRlYnRSb3dzLm1hcCgocm93KSA9PiByb3cuc3RhdHVzKSldLnNvcnQoKTtcbiAgICBjb25zdCB1bnN1cmZhY2VkRGVidCA9IGRlYnRTdGF0dXNlcy5maWx0ZXIoKHN0YXR1cykgPT4gIXN1cmZhY2VkLmhhcyhkcmlmdEtleShuYW1lLCBzdGF0dXMpKSk7XG4gICAgY29uc3QgaXNOZXdOYW1lID0gIXN1cmZhY2VkLmhhcyhuYW1lKTtcbiAgICBpZiAoIWlzTmV3TmFtZSAmJiB1bnN1cmZhY2VkRGVidC5sZW5ndGggPT09IDApIGNvbnRpbnVlOyAvLyBmdWxseSBzdXJmYWNlZCBhbHJlYWR5XG5cbiAgICBjb25zdCB3aHkgPSBhd2FpdCBleGVjdXRvcnMud2h5KG5hbWUsIGlucHV0LmN3ZCk7XG4gICAgc2VjdGlvbnMucHVzaChyZW5kZXJTcGFuU2VjdGlvbihuYW1lLCBhbmNob3JzQnlOYW1lLmdldChuYW1lKSA/PyBbXSwgZGVidFJvd3MsIHdoeSkpO1xuICAgIGlmIChkZWJ0U3RhdHVzZXMubGVuZ3RoID4gMCkgZHJpZnRlZE5hbWVzLnB1c2gobmFtZSk7XG5cbiAgICBpZiAoaXNOZXdOYW1lKSB0b1JlY29yZC5wdXNoKG5hbWUpO1xuICAgIGZvciAoY29uc3Qgc3RhdHVzIG9mIHVuc3VyZmFjZWREZWJ0KSB0b1JlY29yZC5wdXNoKGRyaWZ0S2V5KG5hbWUsIHN0YXR1cykpO1xuICB9XG5cbiAgaWYgKHNlY3Rpb25zLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIG1lbW8uYWRkU3VyZmFjZWQoaW5wdXQuc2Vzc2lvbklkLCB0b1JlY29yZCk7XG4gIGNvbnN0IGZpbGVOYW1lID0gYmFzZW5hbWUoaW5wdXQuZmlsZVBhdGgpO1xuICBjb25zdCBoZWFkZXIgPSBkcmlmdGVkTmFtZXMubGVuZ3RoID4gMCA/IGRyaWZ0SGVhZGVyKGRyaWZ0ZWROYW1lcy5sZW5ndGgsIGlucHV0LmtpbmQpIDogY2xlYW5IZWFkZXIoZmlsZU5hbWUpO1xuICBjb25zdCBmb290ZXIgPSBkcmlmdGVkTmFtZXMubGVuZ3RoID4gMCA/IGRyaWZ0Rm9vdGVyKGRyaWZ0ZWROYW1lcykgOiBjbGVhbkZvb3RlcihmaWxlTmFtZSk7XG4gIHJldHVybiBidWlsZEJsb2NrKHNlY3Rpb25zLCBoZWFkZXIsIGZvb3Rlcik7XG59XG5cbi8qKlxuICogUnVuIHRoZSB0b3VjaCBob29rIGZvciBhIHNpbmdsZSB0b29sIGNhbGwsIGJyYW5jaGluZyBvbiB7QGxpbmsgVG91Y2hJbnB1dC5raW5kfS5cbiAqXG4gKiAtICoqV3JpdGUgcGF0aCoqOiBydW4gYGV4ZWN1dG9ycy5maXhgIChgZ2l0IHNwYW4gZHJpZnQgPGZpbGU+IC0tZml4YCkgc2NvcGVkXG4gKiAgIHRvIHRoZSB0b3VjaGVkIGZpbGUgdG8gaGVhbCBwb3NpdGlvbmFsIGRyaWZ0IGluIHRoZSB3b3JraW5nIHRyZWUsIHRoZW5cbiAqICAgY29tcHV0ZSB0aGUgbWVyZ2VkIGA8Z2l0LXNwYW4+YCBibG9jayBhZ2FpbnN0IHRoZSBoZWFsZWQgYW5jaG9ycywgcmVuZGVyaW5nXG4gKiAgIGVhY2ggc3VyZmFjZWQgc3BhbiBhcyBhIGZ1bGwgaHVtYW4tZm9ybWF0IHNlY3Rpb24gd2l0aCBhbnkgcmVtYWluaW5nXG4gKiAgIHNlbWFudGljIGRyaWZ0IHN0YXR1cy1zdWZmaXhlZCBvbiBpdHMgYW5jaG9ycy4gQ2FkZW5jZSBpcyBkZWR1cGVkIHRocm91Z2hcbiAqICAgYG1lbW9gIHBlciBzcGFuIG5hbWUgYW5kIHBlciAoc3Bhbiwgc3RhdHVzKS5cbiAqIC0gKipSZWFkIHBhdGgqKjogbmV2ZXIgaW52b2tlcyBgZml4YCBhbmQgbmV2ZXIgbXV0YXRlcyB0aGUgdHJlZTsgc3VyZmFjZXMgdGhlXG4gKiAgIHNwYW5zIG92ZXJsYXBwaW5nIHRoZSByZWFkJ3MgYG9mZnNldGAvYGxpbWl0YCB3aW5kb3cgKHNlZVxuICogICB7QGxpbmsgcmVjb3ZlclJlYWRSYW5nZX07IGEgcmVhZCB3aXRoIG5laXRoZXIgaXMgd2hvbGUtZmlsZSwgbWF0Y2hpbmdcbiAqICAgdG9kYXkncyBiZWhhdmlvcikgd2l0aCBwb3NpdGlvbmFsIHN0YXR1c2VzIGZpbHRlcmVkIG91dCB2aWEgYGlzRGVidCgpYC5cbiAqXG4gKiBGYWlscyBvcGVuOiBhbnkgZXhlY3V0b3IgcmVqZWN0aW9uIG9yIGludGVybmFsIGVycm9yIHlpZWxkc1xuICogYGFkZGl0aW9uYWxDb250ZXh0OiBudWxsYCAobm8gc2lnbmFsLCBlZGl0aW5nIG5ldmVyIGJsb2NrZWQpIHJhdGhlciB0aGFuXG4gKiB0aHJvd2luZy4gYHRyZWVNb2RpZmllZGAgcmVmbGVjdHMgYSBzdWNjZXNzZnVsIGAtLWZpeGAgZXZlbiB3aGVuIHRoZVxuICogc3Vic2VxdWVudCBzdXJmYWNlIGNvbXB1dGF0aW9uIGZhaWxzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuVG91Y2hIb29rKFxuICBpbnB1dDogVG91Y2hJbnB1dCxcbiAgZXhlY3V0b3JzOiBUb3VjaEV4ZWN1dG9ycyxcbiAgbWVtbzogTWVtb1N0b3JlXG4pOiBQcm9taXNlPFRvdWNoT3V0cHV0PiB7XG4gIGxldCB0cmVlTW9kaWZpZWQgPSBmYWxzZTtcbiAgdHJ5IHtcbiAgICBsZXQgcmFuZ2U6IExpbmVSYW5nZSB8ICd3aG9sZS1maWxlJyA9ICd3aG9sZS1maWxlJztcbiAgICBpZiAoaW5wdXQua2luZCA9PT0gJ3dyaXRlJykge1xuICAgICAgY29uc3QgZml4ID0gYXdhaXQgZXhlY3V0b3JzLmZpeChpbnB1dC5maWxlUGF0aCwgaW5wdXQuY3dkKTtcbiAgICAgIHRyZWVNb2RpZmllZCA9IGZpeC5tb2RpZmllZDtcbiAgICAgIHJhbmdlID0gcmVjb3ZlclJhbmdlRnJvbURpc2soaW5wdXQud3JpdHRlbiwgaW5wdXQuZmlsZVBhdGgpO1xuICAgIH0gZWxzZSB7XG4gICAgICByYW5nZSA9IHJlY292ZXJSZWFkUmFuZ2UoaW5wdXQub2Zmc2V0LCBpbnB1dC5saW1pdCwgaW5wdXQuZmlsZVBhdGgpO1xuICAgIH1cbiAgICBjb25zdCBhZGRpdGlvbmFsQ29udGV4dCA9IGF3YWl0IGNvbXB1dGVTdXJmYWNlKGlucHV0LCBleGVjdXRvcnMsIG1lbW8sIHJhbmdlKTtcbiAgICByZXR1cm4geyBhZGRpdGlvbmFsQ29udGV4dCwgdHJlZU1vZGlmaWVkIH07XG4gIH0gY2F0Y2gge1xuICAgIC8vIEZhaWwgb3BlbjogbmV2ZXIgbGV0IGEgdG91Y2gtY29yZSBlcnJvciBwcm9wYWdhdGUgdXAgYW5kIGJsb2NrIHRoZSB0b29sXG4gICAgLy8gY2FsbC4gVGhlIHRyZWUgbWF5IGFscmVhZHkgaGF2ZSBiZWVuIGhlYWxlZCAodHJlZU1vZGlmaWVkIHByZXNlcnZlZCkuXG4gICAgcmV0dXJuIHsgYWRkaXRpb25hbENvbnRleHQ6IG51bGwsIHRyZWVNb2RpZmllZCB9O1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRGVmYXVsdCBzdWJwcm9jZXNzLWJhY2tlZCBleGVjdXRvcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBERUZBVUxUX1RJTUVPVVRfTVMgPSAxMF8wMDA7XG5cbi8qKiBSZXNvbHZlIHRoZSB0b3VjaGVkIGZpbGUgdG8gYSBwYXRoIHJlbGF0aXZlIHRvIGl0cyByZXBvIHJvb3QsIGZvciBgZ2l0IHNwYW5gLiAqL1xuZnVuY3Rpb24gcmVwb1JlbEFyZyhmaWxlUGF0aDogc3RyaW5nLCBjd2Q6IHN0cmluZyk6IHsgcmVwb1Jvb3Q6IHN0cmluZzsgcmVsUGF0aDogc3RyaW5nIH0gfCBudWxsIHtcbiAgY29uc3QgcmVwb1Jvb3QgPSByZXNvbHZlUmVwb1Jvb3QoY3dkKTtcbiAgaWYgKCFyZXBvUm9vdCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IHJlcG9Sb290LCByZWxQYXRoOiByZWxhdGl2ZVRvUmVwbyhyZXBvUm9vdCwgZmlsZVBhdGgpIH07XG59XG5cbi8qKlxuICogQSBzbmFwc2hvdCBvZiB0aGUgc3BhbiByb290J3Mgd29ya2luZy10cmVlIHN0YXR1cywgdXNlZCB0byBkZXRlY3Qgd2hldGhlciBhXG4gKiBgLS1maXhgIHJlLWFuY2hvcmVkIGFueXRoaW5nLiBDb21wYXJlZCBiZWZvcmUvYWZ0ZXI7IGFuIHVucmVzb2x2YWJsZSByZXBvIG9yXG4gKiBhIGZhaWxlZCBzdGF0dXMgeWllbGRzIGEgc3RhYmxlIGVtcHR5IHN0cmluZyAoXHUyMTkyIGBtb2RpZmllZDogZmFsc2VgKS5cbiAqL1xuZnVuY3Rpb24gc3BhblN0YXR1c1NuYXBzaG90KHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBzcGFuUm9vdCA9IHJlc29sdmVTcGFuUm9vdChyZXBvUm9vdCk7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGV4ZWNGaWxlU3luYygnZ2l0JywgWyctQycsIHJlcG9Sb290LCAnc3RhdHVzJywgJy0tcG9yY2VsYWluJywgJy0tJywgc3BhblJvb3RdLCB7XG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAnaWdub3JlJ10sXG4gICAgICB0aW1lb3V0OiBERUZBVUxUX1RJTUVPVVRfTVNcbiAgICB9KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuICcnO1xuICB9XG59XG5cbi8qKlxuICogVGhlIHByb2R1Y3Rpb24gZXhlY3V0aW9uIHN1cmZhY2U6IHRocmVlIHN1YnByb2Nlc3MtYmFja2VkIGV4ZWN1dG9ycyBmb2xsb3dpbmdcbiAqIHNwYW4tc3VyZmFjZS50cydzIGBjcmVhdGVEZWZhdWx0KkV4ZWN1dG9yYCBzdHlsZS4gRWFjaCBjYXB0dXJlcyBzdGRvdXQgZXZlbiBvblxuICogYSBub24temVybyBleGl0IHdoZXJlIHRoZSBDTEkgc3RpbGwgZW1pdHMgdXNlZnVsIG91dHB1dCwgYW5kIGV2ZXJ5IGZhaWx1cmVcbiAqIG1vZGUgKGFic2VudCBiaW5hcnksIHRpbWVvdXQsIHBhcnNlIGZhaWx1cmUpIHN1cmZhY2VzIGFzIGFuIGVtcHR5L2NsZWFuIHJlc3VsdFxuICogc28ge0BsaW5rIHJ1blRvdWNoSG9va30ncyBmYWlsLW9wZW4gY29udHJhY3QgaG9sZHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0VG91Y2hFeGVjdXRvcnModGltZW91dE1zOiBudW1iZXIgPSBERUZBVUxUX1RJTUVPVVRfTVMpOiBUb3VjaEV4ZWN1dG9ycyB7XG4gIHJldHVybiB7XG4gICAgZml4OiBhc3luYyAoZmlsZVBhdGgsIGN3ZCkgPT4ge1xuICAgICAgY29uc3QgcmVzb2x2ZWQgPSByZXBvUmVsQXJnKGZpbGVQYXRoLCBjd2QpO1xuICAgICAgaWYgKCFyZXNvbHZlZCkgcmV0dXJuIHsgbW9kaWZpZWQ6IGZhbHNlIH07XG4gICAgICBjb25zdCBiZWZvcmUgPSBzcGFuU3RhdHVzU25hcHNob3QocmVzb2x2ZWQucmVwb1Jvb3QpO1xuICAgICAgdHJ5IHtcbiAgICAgICAgZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnZHJpZnQnLCByZXNvbHZlZC5yZWxQYXRoLCAnLS1maXgnXSwge1xuICAgICAgICAgIGN3ZDogcmVzb2x2ZWQucmVwb1Jvb3QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIGBnaXQgc3BhbiBkcmlmdGAgZXhpdHMgMSBvbiBkcmlmdCBldmVuIHdoZW4gYC0tZml4YCBoZWFsZWQgc29tZXRoaW5nLFxuICAgICAgICAvLyBhbmQgbm9uLXplcm8gb24gZ2VudWluZSBmYWlsdXJlOyB0aGUgc25hcHNob3QgZGlmZiBpcyB0aGUgc291cmNlIG9mXG4gICAgICAgIC8vIHRydXRoIGZvciB3aGV0aGVyIHRoZSB0cmVlIGNoYW5nZWQsIHNvIHRoZSBleGl0IGNvZGUgaXMgaWdub3JlZCBoZXJlLlxuICAgICAgfVxuICAgICAgY29uc3QgYWZ0ZXIgPSBzcGFuU3RhdHVzU25hcHNob3QocmVzb2x2ZWQucmVwb1Jvb3QpO1xuICAgICAgcmV0dXJuIHsgbW9kaWZpZWQ6IGJlZm9yZSAhPT0gYWZ0ZXIgfTtcbiAgICB9LFxuXG4gICAgbGlzdDogYXN5bmMgKGZpbGVQYXRoLCBjd2QpID0+IHtcbiAgICAgIGNvbnN0IHJlc29sdmVkID0gcmVwb1JlbEFyZyhmaWxlUGF0aCwgY3dkKTtcbiAgICAgIGlmICghcmVzb2x2ZWQpIHJldHVybiBbXTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG91dCA9IGV4ZWNGaWxlU3luYygnZ2l0JywgWydzcGFuJywgJ2xpc3QnLCAnLS1wb3JjZWxhaW4nLCByZXNvbHZlZC5yZWxQYXRoXSwge1xuICAgICAgICAgIGN3ZDogcmVzb2x2ZWQucmVwb1Jvb3QsXG4gICAgICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICAgICAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gICAgICAgICAgdGltZW91dDogdGltZW91dE1zXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gcGFyc2VQb3JjZWxhaW4ob3V0KTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gW107XG4gICAgICB9XG4gICAgfSxcblxuICAgIGRyaWZ0OiBhc3luYyAoYXJncywgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgY29uc3QgcnVuQ3dkID0gcmVwb1Jvb3QgPz8gY3dkO1xuICAgICAgLy8gVGhlIGNvcmUgcGFzc2VzIGFuIGFic29sdXRlIGZpbGUgcGF0aDsgc2NvcGUgYGdpdCBzcGFuIGRyaWZ0YCB0byBpdFxuICAgICAgLy8gcmVsYXRpdmUgdG8gdGhlIHJlcG8gcm9vdCBzbyB0aGUgcGF0aCBpbmRleCByZXNvbHZlcyBpdC5cbiAgICAgIGNvbnN0IHNjb3BlZCA9IHJlcG9Sb290ID8gYXJncy5tYXAoKGEpID0+IHJlbGF0aXZlVG9SZXBvKHJlcG9Sb290LCBhKSkgOiBhcmdzO1xuICAgICAgbGV0IG91dDogc3RyaW5nO1xuICAgICAgdHJ5IHtcbiAgICAgICAgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnZHJpZnQnLCAnLS1mb3JtYXQnLCAncG9yY2VsYWluJywgLi4uc2NvcGVkXSwge1xuICAgICAgICAgIGN3ZDogcnVuQ3dkLFxuICAgICAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgICAgICAgc3RkaW86IFsnaWdub3JlJywgJ3BpcGUnLCAncGlwZSddLFxuICAgICAgICAgIHRpbWVvdXQ6IHRpbWVvdXRNc1xuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBjb25zdCBjYXB0dXJlZCA9IChlcnIgYXMgeyBzdGRvdXQ/OiBzdHJpbmcgfSkuc3Rkb3V0O1xuICAgICAgICBpZiAodHlwZW9mIGNhcHR1cmVkID09PSAnc3RyaW5nJykge1xuICAgICAgICAgIG91dCA9IGNhcHR1cmVkO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIHBhcnNlRHJpZnRQb3JjZWxhaW4ob3V0KTtcbiAgICB9LFxuXG4gICAgd2h5OiBhc3luYyAobmFtZSwgY3dkKSA9PiB7XG4gICAgICBjb25zdCByZXBvUm9vdCA9IHJlc29sdmVSZXBvUm9vdChjd2QpO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgb3V0ID0gZXhlY0ZpbGVTeW5jKCdnaXQnLCBbJ3NwYW4nLCAnd2h5JywgbmFtZV0sIHtcbiAgICAgICAgICBjd2Q6IHJlcG9Sb290ID8/IGN3ZCxcbiAgICAgICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSxcbiAgICAgICAgICB0aW1lb3V0OiB0aW1lb3V0TXNcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IHRleHQgPSBvdXQudHJpbUVuZCgpO1xuICAgICAgICAvLyBCYXJlIGBnaXQgc3BhbiB3aHlgIHByaW50cyB0aGlzIGV4YWN0IHNlbnRpbmVsIChleGl0IDApIHdoZW4gdGhlXG4gICAgICAgIC8vIHNwYW4gaGFzIG5vIHdoeSByZWNvcmRlZCBcdTIwMTQgdHJlYXQgaXQgYXMgXCJubyB3aHlcIiwgbm90IGFzIGNvbnRlbnQuXG4gICAgICAgIGlmICh0ZXh0Lmxlbmd0aCA9PT0gMCB8fCB0ZXh0ID09PSBgXFxgJHtuYW1lfVxcYCBoYXMgbm8gd2h5IHJlY29yZGVkLmApIHJldHVybiBudWxsO1xuICAgICAgICByZXR1cm4gdGV4dDtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cbiAgICB9XG4gIH07XG59XG4iLCAiLyoqXG4gKiBTaGFyZWQgYm94LWRyYXdpbmcgdHJlZSByZW5kZXJlciBmb3IgYSBzcGFuJ3MgYW5jaG9yIGxpc3QsIHVzZWQgYnkgZXZlcnlcbiAqIGNhbGwgc2l0ZSB0aGF0IHRvZGF5IHByaW50cyBhIGZsYXQgYC0gcGF0aCNMc3RhcnQtTGVuZGAgYnVsbGV0IHJ1blxuICogKGB0b3VjaC1jb3JlLnRzYCdzIGBhbmNob3JCdWxsZXRzYCwgYW5kIGBhZHZpc29yLWNvcmUudHNgJ3NcbiAqIGBhbm5vdGF0ZUJsb2Nrc2AvYGdyb3VwQ292ZXJpbmdCeU5hbWVgKS4gQW5jaG9ycyB0aGF0IHNoYXJlIGEgZGlyZWN0b3J5XG4gKiBwcmVmaXggY29sbGFwc2UgaW50byBvbmUgdHJlZSBpbnN0ZWFkIG9mIGJlaW5nIHJlY29uc3RydWN0ZWQgYnkgZXllIGZyb20gYVxuICogZmxhdCBsaXN0IFx1MjAxNCB0aGUgbW90aXZhdGluZyBjYXNlIGlzIHBhcml0eSBhbmNob3JzIHVuZGVyIHBhcmFsbGVsXG4gKiBgcHVibGljL2NsYXVkZS8uLi5gL2BwdWJsaWMvY29kZXgvLi4uYCB0cmVlcy5cbiAqXG4gKiBUaGlzIG1vZHVsZSBpcyBhIHB1cmUgcHJlc2VudGF0aW9uIHRyYW5zZm9ybTogaXQgbmV2ZXIgY29tcHV0ZXMgZHJpZnRcbiAqIHN0YXR1cyBvciBkZWNpZGVzIHdoaWNoIGFuY2hvcnMgYXJlIHN1cmZhY2VkLiBDYWxsZXJzIHByZWNvbXB1dGUgZWFjaCByb3cnc1xuICogYHN1ZmZpeGAgKGUuZy4gYCBcdTIwMTQgY2hhbmdlZGApIGV4YWN0bHkgYXMgdGhleSBkbyB0b2RheSwgYW5kIG9ubHkgdGhlICpzaGFwZSpcbiAqIG9mIHRoZSBwcmludGVkIGxpc3QgY2hhbmdlcy5cbiAqL1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFB1YmxpYyB0eXBlc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogSG93IGEgc2luZ2xlIGFuY2hvcidzIGxpbmUgcmFuZ2UgaXMga25vd24uIGByYW5nZWAgYW5kIGB3aG9sZS1maWxlYCBhcmUgdGhlXG4gKiB0d28gc2hhcGVzIGV2ZXJ5IGFuY2hvciB0YWtlcyB0b2RheTsgYHRydW5jYXRlZGAgaXMgYSBkZWZlbnNpdmUgdGhpcmQgc2hhcGVcbiAqIHJlYWNoYWJsZSBvbmx5IGZyb20gcmUtcGFyc2luZyB0aGUgQ0xJJ3MgZmxhdCBodW1hbi1mb3JtYXQgdGV4dCAoYSBgI0xgXG4gKiBmcmFnbWVudCB0aGF0IGRvZXNuJ3QgY2xlYW5seSBtYXRjaCBgI0xzdGFydC1MZW5kYCkuXG4gKlxuICogVmVyaWZpZWQgaW52YXJpYW50OiB0aGUgc3RydWN0dXJlZC1kYXRhIGNhbGwgc2l0ZXMgY2FuIG5ldmVyIHByb2R1Y2VcbiAqIGB0cnVuY2F0ZWRgLiBgcGFyc2VQb3JjZWxhaW5gIChhZ2VudC1ob29rcy1jb21tb24udHMpIGBjb250aW51ZWBzIHBhc3QgYW55XG4gKiByb3cgbWlzc2luZyBhIHZhbGlkIHJhbmdlLCBzbyBhbiBpbmNvbXBsZXRlIGBQb3JjZWxhaW5Sb3dgIGNhbiBuZXZlciBiZVxuICogY29uc3RydWN0ZWQ7IHRoZSBSdXN0IENMSSdzIG93biBwb3JjZWxhaW4gd3JpdGVyIGFsd2F5cyBlbWl0cyBhIHJhbmdlXG4gKiBjb2x1bW4gKGAwLTBgIGZvciB3aG9sZS1maWxlKS4gYHRydW5jYXRlZGAgaXMgcmVhY2hhYmxlIG9ubHkgZnJvbVxuICogYGFubm90YXRlQmxvY2tzYCcgZmxhdC10ZXh0IHBhcnNpbmcgb2YgYGJsb2Nrc1RleHRgIGluIGEgbGF0ZXIgcGhhc2UuXG4gKi9cbmV4cG9ydCB0eXBlIFJhbmdlTGFiZWwgPSB7IGtpbmQ6ICdyYW5nZSc7IHN0YXJ0OiBudW1iZXI7IGVuZDogbnVtYmVyIH0gfCB7IGtpbmQ6ICd3aG9sZS1maWxlJyB9IHwgeyBraW5kOiAndHJ1bmNhdGVkJyB9O1xuXG4vKiogT25lIHN0YWNrZWQgcmFuZ2UgdW5kZXIgYSBgVHJlZUFuY2hvcmAsIHdpdGggaXRzIHByZWNvbXB1dGVkIGRyaWZ0IHN1ZmZpeC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUmFuZ2VFbnRyeSB7XG4gIHJhbmdlOiBSYW5nZUxhYmVsO1xuICAvKiogUHJlY29tcHV0ZWQgYCBcdTIwMTQgY2hhbmdlZGAgKGV0Yy4pLCBvciBgJydgIHdoZW4gdGhlIGFuY2hvciBjYXJyaWVzIG5vIGRyaWZ0LiAqL1xuICBzdWZmaXg6IHN0cmluZztcbn1cblxuLyoqIE9uZSBkaXN0aW5jdCBwYXRoJ3MgY29sbGFwc2VkIGFuY2hvciBlbnRyeSwgcmVhZHkgZm9yIHRyZWUgbGF5b3V0LiAqL1xuZXhwb3J0IGludGVyZmFjZSBUcmVlQW5jaG9yIHtcbiAgLyoqIFJlcG8tcmVsYXRpdmUsIHBvc2l4LXNlcGFyYXRlZCBwYXRoLiAqL1xuICBwYXRoOiBzdHJpbmc7XG4gIC8qKlxuICAgKiBTdGFja2VkIHJhbmdlcyBvbiB0aGlzIHBhdGguIEVtcHR5IG1lYW5zIFwicGF0aCBvbmx5LCBubyByYW5nZSBjb2x1bW4gYXRcbiAgICogYWxsXCIgXHUyMDE0IGEgYmFyZS1wYXRoIGxlYWYsIGRpc3RpbmN0IGZyb20gYSBzaW5nbGUgYHdob2xlLWZpbGVgIGVudHJ5ICh3aGljaFxuICAgKiByZW5kZXJzIHRoZSBwYXRoIHRvbywgYnV0IGlzIGFuIGV4cGxpY2l0IHJhbmdlLWtpbmQgY2xhc3NpZmljYXRpb24pLlxuICAgKi9cbiAgcmFuZ2VzOiBSYW5nZUVudHJ5W107XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gY29sbGFwc2VCeVBhdGhcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIENvbGxhcHNlIHJvd3MgdGhhdCBuYW1lIHRoZSBzYW1lIHBhdGggaW50byBvbmUgYFRyZWVBbmNob3JgIHdpdGggc3RhY2tlZFxuICogcmFuZ2VzLCBwcmVzZXJ2aW5nIGZpcnN0LXNlZW4gb3JkZXIuIGByZW5kZXJBbmNob3JUcmVlYCdzIGNvbnRyYWN0IHJlcXVpcmVzXG4gKiBhdCBtb3N0IG9uZSBgVHJlZUFuY2hvcmAgcGVyIGRpc3RpbmN0IHBhdGggXHUyMDE0IHRoaXMgaXMgdGhlIG1hbmRhdG9yeVxuICogcHJlLXByb2Nlc3Npbmcgc3RlcCBldmVyeSBjYWxsZXIgcnVucyBmaXJzdCB0byBndWFyYW50ZWUgdGhhdC5cbiAqXG4gKiBNaXJyb3JzIHRoZSBvcmRlci1hcnJheS1wbHVzLU1hcCBpZGlvbSBhbHJlYWR5IHVzZWQgYnlcbiAqIGBkZWR1cGVCeUFuY2hvcigpYCAoYWR2aXNvci1jb3JlLnRzKSBmb3IgdGhlIHNhbWUgcmVhc29uOiB0aGUgQ0xJIGNhbiBlbWl0XG4gKiBtdWx0aXBsZSByb3dzIGZvciBvbmUgbG9naWNhbCBwYXRoLCBhbmQgdGhlICpwb3NpdGlvbiogb2YgYSBsYXRlclxuICogc2FtZS1wYXRoIHJvdyBpcyBzdWJzdW1lZCBpbnRvIHRoYXQgcGF0aCdzIGZpcnN0IG9jY3VycmVuY2UsIG5vdCBhcHBlbmRlZFxuICogYXQgaXRzIG93biBsYXRlciBwb3NpdGlvbi4gQ29uY3JldGVseTogYGEudHMjTDEtTDVgLCBgYi50cyNMMS1MNWAsXG4gKiBgYS50cyNMOS1MMTJgIGNvbGxhcHNlcyB0byBgW2EudHMgKHR3byBzdGFja2VkIHJhbmdlcyksIGIudHMgKG9uZSByYW5nZSldYFxuICogXHUyMDE0IGBhLnRzYCBzaXRzIGF0IHBvc2l0aW9uIDAsIGl0cyBmaXJzdCBvY2N1cnJlbmNlLCBub3QgaXRzIGxhc3QuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb2xsYXBzZUJ5UGF0aChyb3dzOiB7IHBhdGg6IHN0cmluZzsgcmFuZ2U6IFJhbmdlTGFiZWw7IHN1ZmZpeDogc3RyaW5nIH1bXSk6IFRyZWVBbmNob3JbXSB7XG4gIGNvbnN0IG9yZGVyOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBieVBhdGggPSBuZXcgTWFwPHN0cmluZywgVHJlZUFuY2hvcj4oKTtcbiAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgIGxldCBhbmNob3IgPSBieVBhdGguZ2V0KHJvdy5wYXRoKTtcbiAgICBpZiAoIWFuY2hvcikge1xuICAgICAgYW5jaG9yID0geyBwYXRoOiByb3cucGF0aCwgcmFuZ2VzOiBbXSB9O1xuICAgICAgYnlQYXRoLnNldChyb3cucGF0aCwgYW5jaG9yKTtcbiAgICAgIG9yZGVyLnB1c2gocm93LnBhdGgpO1xuICAgIH1cbiAgICBhbmNob3IucmFuZ2VzLnB1c2goeyByYW5nZTogcm93LnJhbmdlLCBzdWZmaXg6IHJvdy5zdWZmaXggfSk7XG4gIH1cbiAgcmV0dXJuIG9yZGVyLm1hcCgocGF0aCkgPT4gYnlQYXRoLmdldChwYXRoKSBhcyBUcmVlQW5jaG9yKTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUcmVlIGNvbnN0cnVjdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmludGVyZmFjZSBMZWFmTm9kZSB7XG4gIGtpbmQ6ICdsZWFmJztcbiAgbmFtZTogc3RyaW5nO1xuICBhbmNob3I6IFRyZWVBbmNob3I7XG59XG5cbmludGVyZmFjZSBEaXJOb2RlIHtcbiAga2luZDogJ2Rpcic7XG4gIG5hbWU6IHN0cmluZztcbiAgY2hpbGRyZW46IFBhdGhUcmVlTm9kZVtdO1xufVxuXG50eXBlIFBhdGhUcmVlTm9kZSA9IExlYWZOb2RlIHwgRGlyTm9kZTtcblxuLyoqXG4gKiBTcGxpdCBhIHBhdGggaW50byBgL2Atc2VwYXJhdGVkIHNlZ21lbnRzLCBvciBgbnVsbGAgd2hlbiBkb2luZyBzbyB3b3VsZFxuICogZmVlZCBhbiBlbXB0eS1zdHJpbmcgc2VnbWVudCBpbnRvIHRoZSB0cmllIChhIGxlYWRpbmcgYC9gLCBhIHRyYWlsaW5nIGAvYCxcbiAqIGEgZG91YmxlZCBgLy9gLCBvciB0aGUgZW1wdHkgc3RyaW5nKS4gYG51bGxgIHNpZ25hbHMgdGhlIGNhbGxlciB0byByZW5kZXJcbiAqIHRoYXQgYW5jaG9yJ3MgZnVsbCBwYXRoIHN0cmluZyBhcyBhIHNpbmdsZSwgdW5zcGxpdCwgYXRvbWljIHRvcC1sZXZlbCBsZWFmXG4gKiBpbnN0ZWFkIG9mIGF0dGVtcHRpbmcgdG8gbmVzdCBpdCBcdTIwMTQgYSBrbm93bi1lbnVtZXJhYmxlIGNsYXNzIG9mIG1hbGZvcm1lZFxuICogcGF0aHMgZ2V0cyBhIHJlYWwgcnVsZSBoZXJlIHJhdGhlciB0aGFuIHRoZSBzcGxpdCBydW5uaW5nIGFueXdheSBhbmRcbiAqIGZhYnJpY2F0aW5nIGFuIGVtcHR5LW5hbWVkIGRpcmVjdG9yeSBub2RlLiBBIGJhcmUgZmlsZW5hbWUgd2l0aCBubyBgL2AgYXRcbiAqIGFsbCBwcm9kdWNlcyBleGFjdGx5IG9uZSBub24tZW1wdHkgc2VnbWVudCBhbmQgaXMgaGFuZGxlZCBieSB0aGUgb3JkaW5hcnlcbiAqIHBhdGggYmVsb3cgKGl0IGJlY29tZXMgYSB0b3AtbGV2ZWwgbGVhZiB3aXRoIG5vIGRpcmVjdG9yeSB0byBuZXN0IHVuZGVyIFx1MjAxNFxuICogYWxyZWFkeSBhdG9taWMsIG5vIHNwZWNpYWwgY2FzZSBuZWVkZWQpLlxuICovXG5mdW5jdGlvbiBzcGxpdFNlZ21lbnRzKHBhdGg6IHN0cmluZyk6IHN0cmluZ1tdIHwgbnVsbCB7XG4gIGlmIChwYXRoLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHNlZ21lbnRzID0gcGF0aC5zcGxpdCgnLycpO1xuICBpZiAoc2VnbWVudHMuc29tZSgoc2VnbWVudCkgPT4gc2VnbWVudC5sZW5ndGggPT09IDApKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHNlZ21lbnRzO1xufVxuXG5mdW5jdGlvbiBmaW5kT3JDcmVhdGVEaXIocGFyZW50OiBEaXJOb2RlLCBuYW1lOiBzdHJpbmcpOiBEaXJOb2RlIHtcbiAgZm9yIChjb25zdCBjaGlsZCBvZiBwYXJlbnQuY2hpbGRyZW4pIHtcbiAgICBpZiAoY2hpbGQua2luZCA9PT0gJ2RpcicgJiYgY2hpbGQubmFtZSA9PT0gbmFtZSkgcmV0dXJuIGNoaWxkO1xuICB9XG4gIGNvbnN0IG5vZGU6IERpck5vZGUgPSB7IGtpbmQ6ICdkaXInLCBuYW1lLCBjaGlsZHJlbjogW10gfTtcbiAgcGFyZW50LmNoaWxkcmVuLnB1c2gobm9kZSk7XG4gIHJldHVybiBub2RlO1xufVxuXG4vKiogSW5zZXJ0IG9uZSBhbmNob3IgaW50byB0aGUgdHJpZSwgY3JlYXRpbmcvcmV1c2luZyBkaXJlY3Rvcnkgbm9kZXMgaW4gYXJyaXZhbCBvcmRlci4gKi9cbmZ1bmN0aW9uIGluc2VydEFuY2hvcihyb290OiBEaXJOb2RlLCBzZWdtZW50czogc3RyaW5nW10sIGFuY2hvcjogVHJlZUFuY2hvcik6IHZvaWQge1xuICBsZXQgY3VyID0gcm9vdDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBzZWdtZW50cy5sZW5ndGggLSAxOyBpKyspIHtcbiAgICBjdXIgPSBmaW5kT3JDcmVhdGVEaXIoY3VyLCBzZWdtZW50c1tpXSk7XG4gIH1cbiAgY3VyLmNoaWxkcmVuLnB1c2goeyBraW5kOiAnbGVhZicsIG5hbWU6IHNlZ21lbnRzW3NlZ21lbnRzLmxlbmd0aCAtIDFdLCBhbmNob3IgfSk7XG59XG5cbi8qKlxuICogQnVpbGQgdGhlIHRvcC1sZXZlbCBmb3Jlc3QgZnJvbSBhIGBUcmVlQW5jaG9yW11gIGFscmVhZHkgY29sbGFwc2VkIGJ5XG4gKiBgY29sbGFwc2VCeVBhdGhgLiBTaWJsaW5nIG9yZGVyIGlzIG5ldmVyIHJlLXNvcnRlZCBcdTIwMTQgYSBwYXRoIGVpdGhlciBvcGVucyBhXG4gKiBuZXcgbm9kZSBhdCBpdHMgYXJyaXZhbCBwb3NpdGlvbiBvciBpcyBuZXN0ZWQgdW5kZXIgYSBkaXJlY3Rvcnkgbm9kZVxuICogY3JlYXRlZC9yZXVzZWQgYXQgdGhhdCBkaXJlY3RvcnkncyBvd24gZmlyc3Qtb2NjdXJyZW5jZSBwb3NpdGlvbi5cbiAqL1xuZnVuY3Rpb24gYnVpbGRGb3Jlc3QoYW5jaG9yczogVHJlZUFuY2hvcltdKTogUGF0aFRyZWVOb2RlW10ge1xuICBjb25zdCByb290OiBEaXJOb2RlID0geyBraW5kOiAnZGlyJywgbmFtZTogJycsIGNoaWxkcmVuOiBbXSB9O1xuICBmb3IgKGNvbnN0IGFuY2hvciBvZiBhbmNob3JzKSB7XG4gICAgY29uc3Qgc2VnbWVudHMgPSBzcGxpdFNlZ21lbnRzKGFuY2hvci5wYXRoKTtcbiAgICBpZiAoc2VnbWVudHMgPT09IG51bGwpIHtcbiAgICAgIHJvb3QuY2hpbGRyZW4ucHVzaCh7IGtpbmQ6ICdsZWFmJywgbmFtZTogYW5jaG9yLnBhdGgsIGFuY2hvciB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpbnNlcnRBbmNob3Iocm9vdCwgc2VnbWVudHMsIGFuY2hvcik7XG4gIH1cbiAgcmV0dXJuIHJvb3QuY2hpbGRyZW47XG59XG5cbi8qKiBBIG5vZGUgcGFpcmVkIHdpdGggdGhlIChwb3NzaWJseSBmb2xkZWQpIG5hbWUgaXQgZGlzcGxheXMgb24gaXRzIG93biBsaW5lLiAqL1xuaW50ZXJmYWNlIERpc3BsYXlJdGVtIHtcbiAgbmFtZTogc3RyaW5nO1xuICBub2RlOiBQYXRoVHJlZU5vZGU7XG59XG5cbi8qKlxuICogRm9sZCBhIGNoYWluIG9mIHNpbmdsZS1jaGlsZCBub2RlcyBpbnRvIG9uZSBjb21iaW5lZCBuYW1lXG4gKiAoYHB1YmxpYy9jbGF1ZGUvcnVudGltZS9za2lsbHMvY2FyZGAsIGBkaXJ0eS9tb2QucnNgLFxuICogYC5kZXZjb250YWluZXIvRG9ja2VyZmlsZWApLiBGb2xkaW5nIGNvbnRpbnVlcyB3aGlsZSB0aGUgY3VycmVudCBub2RlIGlzIGFcbiAqIGRpcmVjdG9yeSB3aXRoICoqZXhhY3RseSBvbmUgY2hpbGQqKiwgcmVnYXJkbGVzcyBvZiB3aGV0aGVyIHRoYXQgY2hpbGQgaXMgYVxuICogZGlyZWN0b3J5IG9yIGEgbGVhZjogYSBub2RlIHdpdGggb25lIGNoaWxkIGNvbnZleXMgbm8gZ3JvdXBpbmcgYnlcbiAqIGRlZmluaXRpb24sIHNvIGZvbGRpbmcgaXQgbG9zZXMgbm8gc3RydWN0dXJlIHdoaWxlIHJlbW92aW5nIGEgbGluZSB3aG9zZVxuICogb25seSBjb250ZW50IGlzIGEgY29ubmVjdG9yLiBTdG9wcyBhdCB0aGUgZmlyc3QgZGlyZWN0b3J5IHdpdGggMisgY2hpbGRyZW5cbiAqIChleHBhbmQgZnJvbSB0aGVyZSkgb3IgYXQgYSBsZWFmICh3aGljaCB0aGVuIHJlbmRlcnMgd2l0aCB0aGUgZm9sZGVkIG5hbWUpLlxuICpcbiAqIEZvbGRpbmcgbG9uZSAqbGVhdmVzKiBcdTIwMTQgbm90IGp1c3QgbG9uZSBkaXJlY3RvcmllcyBcdTIwMTQgaXMgd2hhdCBrZWVwcyB0aGUgdHJlZVxuICogbm8gdGFsbGVyIHRoYW4gdGhlIGZsYXQgYnVsbGV0IGxpc3QgaXQgcmVwbGFjZXMsIGFuZCB3aGF0IG1ha2VzIGEgc2luZ2xlXG4gKiBhbmNob3IgcmVuZGVyIGFzIHRoZSBvbmUtbGluZSB0cmVlIHRoZSBwbGFuIHByb21pc2VzIGV2ZW4gd2hlbiBpdHMgcGF0aCBoYXNcbiAqIGRpcmVjdG9yaWVzIGluIGl0LiBJdCBhbHNvIGtlZXBzIHRoZSBkaXNjcmltaW5hdGluZyBzZWdtZW50IG9uIHRoZSBzYW1lXG4gKiBsaW5lIGFzIGl0cyByYW5nZSAoYGRpcnR5L21vZC5ycyAjTDM5Mi1MMzk5YCkgZm9yIGBtb2QucnNgL2BpbmRleC50c2BcbiAqIGxheW91dHMsIHdoZXJlIHRoZSBmaWxlbmFtZSBhbG9uZSBpZGVudGlmaWVzIG5vdGhpbmcuXG4gKi9cbmZ1bmN0aW9uIGZvbGRDaGFpbihub2RlOiBQYXRoVHJlZU5vZGUpOiBEaXNwbGF5SXRlbSB7XG4gIGxldCBuYW1lID0gbm9kZS5uYW1lO1xuICBsZXQgY3VyID0gbm9kZTtcbiAgd2hpbGUgKGN1ci5raW5kID09PSAnZGlyJyAmJiBjdXIuY2hpbGRyZW4ubGVuZ3RoID09PSAxKSB7XG4gICAgY29uc3QgY2hpbGQgPSBjdXIuY2hpbGRyZW5bMF07XG4gICAgbmFtZSA9IGAke25hbWV9LyR7Y2hpbGQubmFtZX1gO1xuICAgIGN1ciA9IGNoaWxkO1xuICB9XG4gIHJldHVybiB7IG5hbWUsIG5vZGU6IGN1ciB9O1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFJlbmRlcmluZ1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmFuayBvZiBhIHN0YWNrZWQgZW50cnkncyByYW5nZSBraW5kOiBgd2hvbGUtZmlsZWAgZmlyc3QsIHRoZW4gbnVtZXJpY1xuICogYHJhbmdlYHMsIHRoZW4gYHRydW5jYXRlZGAuIEEgd2hvbGUtZmlsZSBhbmNob3IgaXMgdGhlIENMSSdzIGAwLTBgIHJvdyBcdTIwMTQgaXRcbiAqIGNvdmVycyB0aGUgZW50aXJlIGZpbGUsIHNvIGl0IHNvcnRzIGFoZWFkIG9mIGV2ZXJ5IGxpbmUgcmFuZ2Ugb24gdGhhdCBmaWxlXG4gKiB0aGUgc2FtZSB3YXkgbGluZSAwIHdvdWxkLiBgdHJ1bmNhdGVkYCBjYXJyaWVzIG5vIHBvc2l0aW9uIGF0IGFsbCBhbmQgc29ydHNcbiAqIGxhc3QuXG4gKi9cbmZ1bmN0aW9uIHJhbmdlUmFuayhyYW5nZTogUmFuZ2VMYWJlbCk6IG51bWJlciB7XG4gIHN3aXRjaCAocmFuZ2Uua2luZCkge1xuICAgIGNhc2UgJ3dob2xlLWZpbGUnOlxuICAgICAgcmV0dXJuIDA7XG4gICAgY2FzZSAncmFuZ2UnOlxuICAgICAgcmV0dXJuIDE7XG4gICAgY2FzZSAndHJ1bmNhdGVkJzpcbiAgICAgIHJldHVybiAyO1xuICB9XG59XG5cbi8qKlxuICogU3RhY2tlZC1yYW5nZSBvcmRlciBpcyBieSBraW5kIHJhbmsgdGhlbiBudW1lcmljIChgc3RhcnRgIHRoZW4gYGVuZGApLFxuICogb3ZlcnJpZGluZyBhcnJpdmFsIG9yIGNvZGVwb2ludCBvcmRlciBcdTIwMTQgdGhlIG9ubHkgc29ydGluZyB0aGlzIG1vZHVsZSBkb2VzLFxuICogYW5kIHNjb3BlZCBzdHJpY3RseSB0byByYW5nZXMgc3RhY2tlZCBvbiBvbmUgcGF0aCAobmV2ZXIgdG8gc2libGluZyBwYXRoc1xuICogb3IgZGlyZWN0b3J5IG9yZGVyKS4gRXF1YWwtcmFua2VkIGVudHJpZXMgKHR3byBgdHJ1bmNhdGVkYHMsIG9yIHR3b1xuICogaWRlbnRpY2FsIHJhbmdlcykga2VlcCB0aGVpciBvd24gcmVsYXRpdmUgYXJyaXZhbCBvcmRlciwgc2luY2UgdGhlIHNvcnQgaXNcbiAqIHN0YWJsZS5cbiAqL1xuZnVuY3Rpb24gY29tcGFyZVJhbmdlRW50cmllcyhhOiBSYW5nZUVudHJ5LCBiOiBSYW5nZUVudHJ5KTogbnVtYmVyIHtcbiAgY29uc3QgcmFuayA9IHJhbmdlUmFuayhhLnJhbmdlKSAtIHJhbmdlUmFuayhiLnJhbmdlKTtcbiAgaWYgKHJhbmsgIT09IDApIHJldHVybiByYW5rO1xuICBpZiAoYS5yYW5nZS5raW5kID09PSAncmFuZ2UnICYmIGIucmFuZ2Uua2luZCA9PT0gJ3JhbmdlJykge1xuICAgIHJldHVybiBhLnJhbmdlLnN0YXJ0IC0gYi5yYW5nZS5zdGFydCB8fCBhLnJhbmdlLmVuZCAtIGIucmFuZ2UuZW5kO1xuICB9XG4gIHJldHVybiAwO1xufVxuXG4vKipcbiAqIFRoZSByYW5nZSBjb2x1bW4ncyB0ZXh0LCBvciBgbnVsbGAgd2hlbiB0aGUgZW50cnkgcHJpbnRzIGFzIGEgYmFyZSBwYXRoXG4gKiB3aXRoIG5vIHJhbmdlIGNvbHVtbiBhdCBhbGwuXG4gKlxuICogQSBgd2hvbGUtZmlsZWAgZW50cnkgaXMgdGhlIG9uZSBraW5kIHdob3NlIHJlbmRlcmluZyBkZXBlbmRzIG9uIGNvbnRleHQuXG4gKiBBbG9uZSBvbiBpdHMgcGF0aCBpdCBzdGF5cyBhIGJhcmUgcGF0aCB3aXRoIHplcm8gbWFya2VyIFx1MjAxNCB0aGF0IGlzIHdoYXQgdGhlXG4gKiBDTEkncyBvd24gZmxhdCBsaXN0IHByaW50cyBmb3IgYSB3aG9sZS1maWxlIGFuY2hvciwgYW5kIGFkZGluZyBhIG1hcmtlclxuICogdGhlcmUgd291bGQgYW5ub3RhdGUgdGhlIG92ZXJ3aGVsbWluZ2x5IGNvbW1vbiBjYXNlIGZvciB0aGUgYmVuZWZpdCBvZiB0aGVcbiAqIHJhcmUgb25lLiAqU3RhY2tlZCogYmVoaW5kIG90aGVyIHJhbmdlcyBvbiB0aGUgc2FtZSBwYXRoIGl0IG11c3QgY2FycnkgYW5cbiAqIGV4cGxpY2l0IG1hcmtlcjogd2l0aG91dCBvbmUgaXQgcmVuZGVycyBhcyBhIGNvbnRpbnVhdGlvbiBsaW5lIGhvbGRpbmdcbiAqIG5vdGhpbmcgYnV0IGluZGVudGF0aW9uIGFuZCBpdHMgZHJpZnQgc3VmZml4LCB3aGljaCBlcmFzZXMgdGhlIGFuY2hvclxuICogb3V0cmlnaHQgd2hlbiB0aGUgc3VmZml4IGlzIGVtcHR5IGFuZCBcdTIwMTQgd29yc2UgXHUyMDE0IGhhbmdzIGl0cyBgIFx1MjAxNCBjaGFuZ2VkYFxuICogdW5kZXIgYSBuZWlnaGJvdXJpbmcgcmFuZ2UsIGV4YWN0bHkgdGhlIHZpc3VhbCBncmFtbWFyIHRoYXQgbWVhbnMgXCJhbm90aGVyXG4gKiByYW5nZSBvbiB0aGlzIHNhbWUgZmlsZVwiLiBUaGUgcmVhZGVyIHdvdWxkIHRoZW4gcmVjb25jaWxlIHRoZSByYW5nZSB0aGF0XG4gKiBkaWQgbm90IGRyaWZ0LiBPZiB0aGUgdGhyZWUgZml4ZXMgYXZhaWxhYmxlIChwcmludCB0aGUgcGF0aCBvblxuICogY29udGludWF0aW9uIGxpbmVzLCBzb3J0IHdob2xlLWZpbGUgdG8gcG9zaXRpb24gMCwgb3Igc3BsaXQgaXQgaW50byBpdHMgb3duXG4gKiBsZWFmKSwgYW4gZXhwbGljaXQgbWFya2VyIGlzIHRoZSBvbmx5IG9uZSB0aGF0IG1ha2VzIHRoZSBlbnRyeSBpZGVudGlmaWFibGVcbiAqIGluICpldmVyeSogcG9zaXRpb24gcmF0aGVyIHRoYW4gb25seSBpbiB0aGUgcG9zaXRpb24gdGhlIHNvcnQgaGFwcGVucyB0b1xuICogcHV0IGl0IGluOyBzb3J0aW5nIGl0IGZpcnN0IChzZWUge0BsaW5rIHJhbmdlUmFua30pIGlzIGtlcHQgYXMgd2VsbCBiZWNhdXNlXG4gKiBcIndob2xlIGZpbGUsIHRoZW4gaXRzIHJhbmdlcyBpbiBsaW5lIG9yZGVyXCIgaXMgdGhlIG9yZGVyIGEgcmVhZGVyIGV4cGVjdHMsXG4gKiBub3QgYmVjYXVzZSBpZGVudGlmaWFiaWxpdHkgZGVwZW5kcyBvbiBpdC5cbiAqL1xuZnVuY3Rpb24gbGFiZWxGb3IocmFuZ2U6IFJhbmdlTGFiZWwsIHNvbGU6IGJvb2xlYW4pOiBzdHJpbmcgfCBudWxsIHtcbiAgc3dpdGNoIChyYW5nZS5raW5kKSB7XG4gICAgY2FzZSAncmFuZ2UnOlxuICAgICAgcmV0dXJuIGAjTCR7cmFuZ2Uuc3RhcnR9LUwke3JhbmdlLmVuZH1gO1xuICAgIGNhc2UgJ3dob2xlLWZpbGUnOlxuICAgICAgcmV0dXJuIHNvbGUgPyBudWxsIDogJyh3aG9sZSBmaWxlKSc7XG4gICAgY2FzZSAndHJ1bmNhdGVkJzpcbiAgICAgIHJldHVybiAnKHRydW5jYXRlZCBpbiBzb3VyY2UgXHUyMDE0IGFuY2hvciBpbmNvbXBsZXRlKSc7XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBDb2x1bW4gbWF0aFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogVGhlIGdyYXBoZW1lIHNlZ21lbnRlciwgY29uc3RydWN0ZWQgb24gZmlyc3QgdXNlIGFuZCB0aGVuIGNhY2hlZCBcdTIwMTQgaW5jbHVkaW5nXG4gKiBhIGNhY2hlZCBgbnVsbGAgd2hlbiBpdCBjYW5ub3QgYmUgY29uc3RydWN0ZWQgYXQgYWxsLlxuICpcbiAqIExhenkgb24gcHVycG9zZS4gYEludGxgIGlzIG5vdCBwYXJ0IG9mIHRoZSBKYXZhU2NyaXB0IGxhbmd1YWdlIGNvcmU6IGEgTm9kZVxuICogYnVpbHQgYC0td2l0aC1pbnRsPW5vbmVgIGhhcyBubyBgSW50bGAgZ2xvYmFsIHdoYXRzb2V2ZXIsIGFuZCBgaG9va3MuanNvbmBcbiAqIGludm9rZXMgYSBiYXJlIGBub2RlYCBvZmYgdGhlIHVzZXIncyBgUEFUSGAsIHNvIGBlbmdpbmVzLm5vZGVgIGNvbnN0cmFpbnNcbiAqIG5vdGhpbmcgaGVyZS4gQ29uc3RydWN0aW5nIHRoaXMgYXQgbW9kdWxlIHNjb3BlIHB1dCBhIGBSZWZlcmVuY2VFcnJvcmAgaW5cbiAqIHRoZSBidW5kbGVzJyB0b3AtbGV2ZWwgc3RhdGVtZW50cywgd2hlcmUgaXQgdGhyb3dzIGF0ICppbXBvcnQqIFx1MjAxNCBiZWZvcmUgYW55XG4gKiBvZiB0aGUgZmFpbC1jbG9zZWQgYHRyeS9jYXRjaGAgYmxvY2tzIGluIGByZW5kZXJBbmNob3JSdW5gLCBgcmVuZGVyUGF0aFJ1bmBcbiAqIGFuZCBgYW5jaG9yQnVsbGV0c2AgZXhpc3QgdG8gY2F0Y2ggaXQuIFRoZSBob29rIHByb2Nlc3MgdGhlbiBkaWVkIHdpdGggZXhpdFxuICogMSwgd2hpY2ggQ2xhdWRlIENvZGUgdHJlYXRzIGFzIGEgbm9uLWJsb2NraW5nIGhvb2sgZXJyb3I6IHRoZSBjb21taXQgZ2F0ZVxuICogc2lsZW50bHkgYWxsb3dlZCB0aGUgY29tbWl0IGFuZCB0aGUgZHJpZnQgcmVtaW5kZXIgc2lsZW50bHkgdmFuaXNoZWQuXG4gKiBCdWlsZGluZyBpdCBpbnNpZGUgdGhlIHJlbmRlciBwYXRoIHB1dHMgYW55IGZhaWx1cmUgYmFjayBpbnNpZGUgdGhvc2VcbiAqIGNhdGNoZXMuXG4gKlxuICogRkFJTC1DTE9TRUQsIG5vdCBhIGA8Z3JlZW5maWVsZD5gLWZvcmJpZGRlbiBmYWxsYmFjayBcdTIwMTQgdGhlIHNhbWUgY2F0ZWdvcnkgYXNcbiAqIHRoZSBsb2NhbCBgdHJ5L2NhdGNoYCBibG9ja3MgYXQgdGhpcyBtb2R1bGUncyBjYWxsIHNpdGVzLCBhbmQgbG9hZC1iZWFyaW5nXG4gKiBmb3IgdGhlIHNhbWUgcmVhc29uLiBOb3RoaW5nIGluIHRoZSBjb2x1bW4tYWxpZ25tZW50IHBhdGggbWF5IGJlIGFibGUgdG9cbiAqIGNvc3QgdGhlIGNvbW1pdCBnYXRlIG9yIHRoZSBkcmlmdCByZW1pbmRlcjogaWYgZGlzcGxheSB3aWR0aCBjYW5ub3QgYmVcbiAqIG1lYXN1cmVkLCB0aGUgbGlzdCBzdGlsbCBwcmludHMgYW5kIHRoZSBnYXRlIHN0aWxsIGhvbGRzOyBvbmx5IGFsaWdubWVudCBpc1xuICogbG9zdC5cbiAqL1xubGV0IGNhY2hlZFNlZ21lbnRlcjogeyB2YWx1ZTogSW50bC5TZWdtZW50ZXIgfCBudWxsIH0gfCB1bmRlZmluZWQ7XG5cbmZ1bmN0aW9uIGdyYXBoZW1lU2VnbWVudGVyKCk6IEludGwuU2VnbWVudGVyIHwgbnVsbCB7XG4gIGlmIChjYWNoZWRTZWdtZW50ZXIgPT09IHVuZGVmaW5lZCkge1xuICAgIHRyeSB7XG4gICAgICBjYWNoZWRTZWdtZW50ZXIgPSB7IHZhbHVlOiBuZXcgSW50bC5TZWdtZW50ZXIoJ2VuJywgeyBncmFudWxhcml0eTogJ2dyYXBoZW1lJyB9KSB9O1xuICAgIH0gY2F0Y2gge1xuICAgICAgY2FjaGVkU2VnbWVudGVyID0geyB2YWx1ZTogbnVsbCB9O1xuICAgIH1cbiAgfVxuICByZXR1cm4gY2FjaGVkU2VnbWVudGVyLnZhbHVlO1xufVxuXG4vKipcbiAqIENvZGUgcG9pbnQgcmFuZ2VzIHJlbmRlcmVkIHR3byBjb2x1bW5zIHdpZGU6IHRoZSBFYXN0IEFzaWFuIFdpZGUgKFcpIGFuZFxuICogRnVsbHdpZHRoIChGKSBibG9ja3Mgb2YgVUFYICMxMSwgcGx1cyB0aGUgZW1vamkgYmxvY2tzIHRoYXQgdGVybWluYWxzIGFuZFxuICogcHJvcG9ydGlvbmFsIGFnZW50LWZhY2luZyByZW5kZXJlcnMgYm90aCBnaXZlIGRvdWJsZSB3aWR0aC4gRXZlcnl0aGluZyBlbHNlXG4gKiBjb3VudHMgYXMgb25lIGNvbHVtbi5cbiAqXG4gKiBTb3J0ZWQgYXNjZW5kaW5nIGFuZCBub24tb3ZlcmxhcHBpbmcgXHUyMDE0IHtAbGluayBpc1dpZGVDb2RlUG9pbnR9IHNob3J0LWNpcmN1aXRzXG4gKiBvbiB0aGUgZmlyc3QgcmFuZ2Ugc3RhcnRpbmcgcGFzdCB0aGUgY29kZSBwb2ludC5cbiAqL1xuY29uc3QgV0lERV9SQU5HRVM6IHJlYWRvbmx5IChyZWFkb25seSBbbnVtYmVyLCBudW1iZXJdKVtdID0gW1xuICBbMHgxMTAwLCAweDExNWZdLFxuICBbMHgyMzI5LCAweDIzMmFdLFxuICBbMHgyNjAwLCAweDI3YmZdLFxuICBbMHgyZTgwLCAweDMwM2VdLFxuICBbMHgzMDQxLCAweDMzZmZdLFxuICBbMHgzNDAwLCAweDRkYmZdLFxuICBbMHg0ZTAwLCAweDlmZmZdLFxuICBbMHhhMDAwLCAweGE0Y2ZdLFxuICBbMHhhOTYwLCAweGE5N2ZdLFxuICBbMHhhYzAwLCAweGQ3YTNdLFxuICBbMHhmOTAwLCAweGZhZmZdLFxuICBbMHhmZTEwLCAweGZlMTldLFxuICBbMHhmZTMwLCAweGZlNmZdLFxuICBbMHhmZjAwLCAweGZmNjBdLFxuICBbMHhmZmUwLCAweGZmZTZdLFxuICBbMHgxNzAwMCwgMHgxOGFmZl0sXG4gIFsweDFmMWU2LCAweDFmMWZmXSxcbiAgWzB4MWYzMDAsIDB4MWY2NGZdLFxuICBbMHgxZjY4MCwgMHgxZjZmZl0sXG4gIFsweDFmOTAwLCAweDFmOWZmXSxcbiAgWzB4MWZhNzAsIDB4MWZhZmZdLFxuICBbMHgyMDAwMCwgMHgyZmZmZF0sXG4gIFsweDMwMDAwLCAweDNmZmZkXVxuXTtcblxuZnVuY3Rpb24gaXNXaWRlQ29kZVBvaW50KGNwOiBudW1iZXIpOiBib29sZWFuIHtcbiAgZm9yIChjb25zdCBbbG8sIGhpXSBvZiBXSURFX1JBTkdFUykge1xuICAgIGlmIChjcCA8IGxvKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKGNwIDw9IGhpKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICogRGlzcGxheSB3aWR0aCBvZiBhIG5hbWUgaW4gdGVybWluYWwgY29sdW1ucyBcdTIwMTQgdGhlIHVuaXQgdGhlIHJhbmdlIGNvbHVtbiBpc1xuICogYWN0dWFsbHkgYWxpZ25lZCBpbi4gTWVhc3VyZWQgb3ZlciBncmFwaGVtZSBjbHVzdGVycyAoc28gYSBkZWNvbXBvc2VkIGBcdTAwRTlgXG4gKiBvciBhIGNvbWJpbmluZy1tYXJrIHNlcXVlbmNlIGNvdW50cyBvbmNlLCBub3Qgb25jZSBwZXIgY29kZSBwb2ludCksIHdpdGhcbiAqIGVhY2ggY2x1c3RlciBjb250cmlidXRpbmcgdHdvIGNvbHVtbnMgd2hlbiBpdHMgYmFzZSBjb2RlIHBvaW50IGlzIEVhc3RcbiAqIEFzaWFuIFdpZGUvRnVsbHdpZHRoIG9yIGVtb2ppIGFuZCBvbmUgb3RoZXJ3aXNlLlxuICpcbiAqIE5laXRoZXIgVVRGLTE2IGAubGVuZ3RoYCBub3IgYEFycmF5LmZyb20obmFtZSkubGVuZ3RoYCBpcyB0aGlzIHVuaXQ6IHRoZVxuICogZmlyc3Qgb3Zlci1jb3VudHMgYSBzdXJyb2dhdGUgcGFpciwgdGhlIHNlY29uZCB1bmRlci1jb3VudHMgYSBDSksgaWRlb2dyYXBoXG4gKiBhbmQgb3Zlci1jb3VudHMgYSBkZWNvbXBvc2VkIGFjY2VudC5cbiAqXG4gKiBXaGVuIHtAbGluayBncmFwaGVtZVNlZ21lbnRlcn0gaXMgdW5hdmFpbGFibGUgKGEgTm9kZSBidWlsdFxuICogYC0td2l0aC1pbnRsPW5vbmVgIGhhcyBubyBgSW50bGAgZ2xvYmFsIGF0IGFsbCksIHRoaXMgZGVncmFkZXMgdG8gdGhlIGNydWRlclxuICogcGVyLWNvZGUtcG9pbnQgbWVhc3VyZSByYXRoZXIgdGhhbiB0aHJvd2luZy4gVGhhdCBtZWFzdXJlIG92ZXItY291bnRzIGFcbiAqIGRlY29tcG9zZWQgYWNjZW50IGFuZCBhIHJlZ2lvbmFsLWluZGljYXRvciBmbGFnIHBhaXIsIHNvIGFsaWdubWVudCBjYW4gYmUgYVxuICogY29sdW1uIG9yIHR3byBvZmYgXHUyMDE0IHdoaWNoIGlzIHRoZSBlbnRpcmUgY29zdCwgYW5kIGlzIHRoZSBjb3JyZWN0IHByaWNlIHRvXG4gKiBwYXk6IHRoZSBhbmNob3IgbGlzdCBzdGlsbCBwcmludHMgYW5kIHRoZSBjb21taXQgZ2F0ZSBzdGlsbCBob2xkcy5cbiAqL1xuZnVuY3Rpb24gZGlzcGxheVdpZHRoKG5hbWU6IHN0cmluZyk6IG51bWJlciB7XG4gIGNvbnN0IHNlZ21lbnRlciA9IGdyYXBoZW1lU2VnbWVudGVyKCk7XG4gIGxldCB3aWR0aCA9IDA7XG4gIGlmIChzZWdtZW50ZXIgPT09IG51bGwpIHtcbiAgICBmb3IgKGNvbnN0IGNvZGVQb2ludCBvZiBuYW1lKSB7XG4gICAgICB3aWR0aCArPSBpc1dpZGVDb2RlUG9pbnQoY29kZVBvaW50LmNvZGVQb2ludEF0KDApID8/IDApID8gMiA6IDE7XG4gICAgfVxuICAgIHJldHVybiB3aWR0aDtcbiAgfVxuICBmb3IgKGNvbnN0IHsgc2VnbWVudCB9IG9mIHNlZ21lbnRlci5zZWdtZW50KG5hbWUpKSB7XG4gICAgd2lkdGggKz0gaXNXaWRlQ29kZVBvaW50KHNlZ21lbnQuY29kZVBvaW50QXQoMCkgPz8gMCkgPyAyIDogMTtcbiAgfVxuICByZXR1cm4gd2lkdGg7XG59XG5cbi8qKlxuICogQWxpZ25tZW50IGNlaWxpbmcuIEEgc2libGluZyBncm91cCB3aG9zZSB3aWRlc3QgcmFuZ2UtYmVhcmluZyBuYW1lIGV4Y2VlZHNcbiAqIHRoaXMgd2lkdGggZG9lcyBub3QgYWxpZ24gYXQgYWxsIFx1MjAxNCBldmVyeSBuYW1lIGluIGl0IHRha2VzIGEgc2luZ2xlIHNwYWNlXG4gKiBiZWZvcmUgaXRzIHJhbmdlLiBUaGUgYWx0ZXJuYXRpdmUgKHBhZCB0aGUgc2hvcnQgbmFtZXMgdG8gdGhlIGNlaWxpbmcgd2hpbGVcbiAqIHRoZSBsb25nIG9uZSBzaXRzIGF0IGl0cyBvd24gbmF0dXJhbCBjb2x1bW4pIHBheXMgbW9zdCBvZiB0aGUgd2lkdGggZm9yXG4gKiBhbGlnbm1lbnQgdGhhdCBhbGlnbnMgd2l0aCBub3RoaW5nLCB3aGljaCBpcyBzdHJpY3RseSB3b3JzZSB0aGFuIG5vdFxuICogYWxpZ25pbmcuIE5hbWVzIHRoZW1zZWx2ZXMgYXJlIG5ldmVyIHRydW5jYXRlZCBvciBlbGlkZWQgYXQgYW55IHdpZHRoLlxuICovXG5jb25zdCBNQVhfQUxJR05fQ09MVU1OID0gNDg7XG5cbi8qKlxuICogVGhlIGNvbHVtbiBldmVyeSByYW5nZS1iZWFyaW5nIG5hbWUgaW4gdGhpcyBzaWJsaW5nIGdyb3VwIHBhZHMgdG8sIG9yIGAwYFxuICogd2hlbiB0aGUgZ3JvdXAgZm9yZ29lcyBhbGlnbm1lbnQgKG5vIHJhbmdlLWJlYXJpbmcgbmFtZXMsIG9yIGEgbmFtZSBwYXN0XG4gKiB7QGxpbmsgTUFYX0FMSUdOX0NPTFVNTn0pLiBBbGlnbm1lbnQgc2NvcGUgaXMgdGhlIGdyb3VwJ3MgZGlyZWN0IGNoaWxkcmVuXG4gKiBvbmx5LCBuZXZlciB0aGUgd2hvbGUgdHJlZSBcdTIwMTQgd2hvbGUtdHJlZSBhbGlnbm1lbnQgd291bGQgbGV0IG9uZSBkZWVwbHlcbiAqIG5lc3RlZCBsb25nIG5hbWUgcGFkIGV2ZXJ5IHVucmVsYXRlZCBicmFuY2guXG4gKi9cbmZ1bmN0aW9uIGNvbXB1dGVHcm91cFRhcmdldChpdGVtczogRGlzcGxheUl0ZW1bXSk6IG51bWJlciB7XG4gIGxldCBtYXggPSAwO1xuICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMpIHtcbiAgICBpZiAoaXRlbS5ub2RlLmtpbmQgPT09ICdsZWFmJyAmJiBwcmludHNSYW5nZUNvbHVtbihpdGVtLm5vZGUuYW5jaG9yKSkge1xuICAgICAgbWF4ID0gTWF0aC5tYXgobWF4LCBkaXNwbGF5V2lkdGgoaXRlbS5uYW1lKSk7XG4gICAgfVxuICB9XG4gIHJldHVybiBtYXggPiBNQVhfQUxJR05fQ09MVU1OID8gMCA6IG1heDtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIHRoaXMgYW5jaG9yIHByaW50cyBhIHJhbmdlIGNvbHVtbiBhdCBhbGwgXHUyMDE0IHRoZSBleGFjdCBjb25kaXRpb25cbiAqIHtAbGluayBsYWJlbEZvcn0gZW5jb2RlcywgaG9pc3RlZCBzbyB7QGxpbmsgY29tcHV0ZUdyb3VwVGFyZ2V0fSBtZWFzdXJlcyB0aGVcbiAqIHNhbWUgc2V0IG9mIG5hbWVzIGl0IHBhZHMuIEFuIGFuY2hvciB3aXRoIG5vIHJhbmdlcywgb3IgYSAqc29sZSogd2hvbGUtZmlsZVxuICogZW50cnkgKHdoaWNoIHJlbmRlcnMgYXMgYSBiYXJlIHBhdGggd2l0aCB6ZXJvIG1hcmtlciksIGNvbnRyaWJ1dGVzIG5vIHJhbmdlXG4gKiBjb2x1bW4gYW5kIHNvIG11c3Qgbm90IGNvbnRyaWJ1dGUgdG8gdGhlIGdyb3VwIG1heCBlaXRoZXI6IG90aGVyd2lzZSBhXG4gKiB3aG9sZS1maWxlIGFuY2hvciBvbiBhIHBhdGggcGFzdCB7QGxpbmsgTUFYX0FMSUdOX0NPTFVNTn0gc2lsZW50bHkgc3VwcHJlc3Nlc1xuICogYWxpZ25tZW50IGZvciBpdHMgcmFuZ2UtYmVhcmluZyBzaWJsaW5ncyB3aGlsZSBpdHNlbGYgcHJpbnRpbmcgbm90aGluZyB0b1xuICogYWxpZ24uXG4gKi9cbmZ1bmN0aW9uIHByaW50c1JhbmdlQ29sdW1uKGFuY2hvcjogVHJlZUFuY2hvcik6IGJvb2xlYW4ge1xuICBjb25zdCB7IHJhbmdlcyB9ID0gYW5jaG9yO1xuICBpZiAocmFuZ2VzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIGZhbHNlO1xuICByZXR1cm4gcmFuZ2VzLnNvbWUoKGVudHJ5KSA9PiBsYWJlbEZvcihlbnRyeS5yYW5nZSwgcmFuZ2VzLmxlbmd0aCA9PT0gMSkgIT09IG51bGwpO1xufVxuXG4vKiogVGhlIHNwYWNpbmcgYmV0d2VlbiBhIG5hbWUgb2YgYG5hbWVXaWR0aGAgY29sdW1ucyBhbmQgaXRzIHJhbmdlIGNvbHVtbi4gKi9cbmZ1bmN0aW9uIGNvbXB1dGVQYWQobmFtZVdpZHRoOiBudW1iZXIsIHRhcmdldDogbnVtYmVyKTogc3RyaW5nIHtcbiAgaWYgKG5hbWVXaWR0aCA+PSB0YXJnZXQpIHJldHVybiAnICc7XG4gIHJldHVybiAnICcucmVwZWF0KHRhcmdldCAtIG5hbWVXaWR0aCArIDEpO1xufVxuXG4vKipcbiAqIFJlbmRlciBvbmUgbGVhZidzIGxpbmUocykuIEFuIGVtcHR5IGByYW5nZXNgIGFycmF5IGlzIGEgYmFyZS1wYXRoIGxlYWYgd2l0aFxuICogbm8gcmFuZ2UgY29sdW1uIGF0IGFsbCAoZGlzdGluY3QgZnJvbSBhIGB3aG9sZS1maWxlYCBlbnRyeSwgd2hpY2ggaXMgYW5cbiAqIGV4cGxpY2l0IGNsYXNzaWZpY2F0aW9uIHRoYXQgYWxzbyBwcmludHMgd2l0aCB6ZXJvIG1hcmtlciB3aGVuIGl0IHN0YW5kc1xuICogYWxvbmUsIGJ1dCB0aHJvdWdoIHRoZSByYW5nZXMgcGlwZWxpbmUpLiBNdWx0aXBsZSBzdGFja2VkIHJhbmdlcyBwcmludFxuICogdW5kZXIgYSBjb250aW51YXRpb24gcHJlZml4IGluc3RlYWQgb2YgcmVwZWF0aW5nIHRoZSBuYW1lOyBlYWNoIGNhcnJpZXMgaXRzXG4gKiBvd24gc3VmZml4IGluZGVwZW5kZW50bHksIGFuZCBlYWNoIGNhcnJpZXMgYSBsYWJlbCBpZGVudGlmeWluZyB3aGljaCBhbmNob3JcbiAqIHRoZSBzdWZmaXggYmVsb25ncyB0by5cbiAqL1xuZnVuY3Rpb24gcmVuZGVyTGVhZkxpbmVzKFxuICBuYW1lOiBzdHJpbmcsXG4gIGFuY2hvcjogVHJlZUFuY2hvcixcbiAgb3duUHJlZml4OiBzdHJpbmcsXG4gIGNoaWxkUHJlZml4OiBzdHJpbmcsXG4gIGdyb3VwVGFyZ2V0OiBudW1iZXJcbik6IHN0cmluZ1tdIHtcbiAgY29uc3QgeyByYW5nZXMgfSA9IGFuY2hvcjtcbiAgaWYgKHJhbmdlcy5sZW5ndGggPT09IDApIHJldHVybiBbYCR7b3duUHJlZml4fSR7bmFtZX1gXTtcblxuICBjb25zdCBzb3J0ZWQgPSBbLi4ucmFuZ2VzXS5zb3J0KGNvbXBhcmVSYW5nZUVudHJpZXMpO1xuICBjb25zdCBzb2xlID0gc29ydGVkLmxlbmd0aCA9PT0gMTtcbiAgY29uc3QgbmFtZVdpZHRoID0gZGlzcGxheVdpZHRoKG5hbWUpO1xuICBjb25zdCBwYWQgPSBjb21wdXRlUGFkKG5hbWVXaWR0aCwgZ3JvdXBUYXJnZXQpO1xuICBjb25zdCBibGFuayA9ICcgJy5yZXBlYXQobmFtZVdpZHRoICsgcGFkLmxlbmd0aCk7XG5cbiAgcmV0dXJuIHNvcnRlZC5tYXAoKGVudHJ5LCBpKSA9PiB7XG4gICAgY29uc3QgbGFiZWwgPSBsYWJlbEZvcihlbnRyeS5yYW5nZSwgc29sZSk7XG4gICAgaWYgKGxhYmVsID09PSBudWxsKSByZXR1cm4gYCR7b3duUHJlZml4fSR7bmFtZX0ke2VudHJ5LnN1ZmZpeH1gO1xuICAgIGNvbnN0IGJhc2UgPSBpID09PSAwID8gYCR7b3duUHJlZml4fSR7bmFtZX0ke3BhZH1gIDogYCR7Y2hpbGRQcmVmaXh9JHtibGFua31gO1xuICAgIHJldHVybiBgJHtiYXNlfSR7bGFiZWx9JHtlbnRyeS5zdWZmaXh9YDtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIHJlbmRlck5vZGVzKG5vZGVzOiBQYXRoVHJlZU5vZGVbXSwgcHJlZml4OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IGxpbmVzOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBpdGVtcyA9IG5vZGVzLm1hcChmb2xkQ2hhaW4pO1xuICBjb25zdCBncm91cFRhcmdldCA9IGNvbXB1dGVHcm91cFRhcmdldChpdGVtcyk7XG4gIGl0ZW1zLmZvckVhY2goKGl0ZW0sIGkpID0+IHtcbiAgICBjb25zdCBpc0xhc3QgPSBpID09PSBpdGVtcy5sZW5ndGggLSAxO1xuICAgIGNvbnN0IG93blByZWZpeCA9IGAke3ByZWZpeH0ke2lzTGFzdCA/ICdcdTI1MTRcdTI1MDAgJyA6ICdcdTI1MUNcdTI1MDAgJ31gO1xuICAgIGNvbnN0IGNoaWxkUHJlZml4ID0gYCR7cHJlZml4fSR7aXNMYXN0ID8gJyAgICcgOiAnXHUyNTAyICAnfWA7XG4gICAgaWYgKGl0ZW0ubm9kZS5raW5kID09PSAnbGVhZicpIHtcbiAgICAgIGxpbmVzLnB1c2goLi4ucmVuZGVyTGVhZkxpbmVzKGl0ZW0ubmFtZSwgaXRlbS5ub2RlLmFuY2hvciwgb3duUHJlZml4LCBjaGlsZFByZWZpeCwgZ3JvdXBUYXJnZXQpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbGluZXMucHVzaChgJHtvd25QcmVmaXh9JHtpdGVtLm5hbWV9L2ApO1xuICAgICAgbGluZXMucHVzaCguLi5yZW5kZXJOb2RlcyhpdGVtLm5vZGUuY2hpbGRyZW4sIGNoaWxkUHJlZml4KSk7XG4gICAgfVxuICB9KTtcbiAgcmV0dXJuIGxpbmVzO1xufVxuXG4vKipcbiAqIFJlbmRlciBhIGNvbGxhcHNlZCBhbmNob3IgbGlzdCBhcyBhIGJveC1kcmF3aW5nIHRyZWUsIGdyb3VwZWQgYnkgc2hhcmVkXG4gKiBwYXRoIHByZWZpeC4gRXZlcnkgYW5jaG9yIGxpc3QgcmVuZGVycyBhcyBhIHRyZWUgdW5jb25kaXRpb25hbGx5IFx1MjAxNCBhIHNpbmdsZVxuICogYW5jaG9yIGJlY29tZXMgYSBvbmUtbGluZSB0cmVlIHdoYXRldmVyIGl0cyBkZXB0aCAoc2VlIHtAbGluayBmb2xkQ2hhaW59KTtcbiAqIHRoZXJlIGlzIG5vIGZsYXQtYnVsbGV0IHBhdGggb3Igc2l6ZSBmbG9vciBpbiB0aGlzIG1vZHVsZS5cbiAqXG4gKiBIZWlnaHQgaXMgYm91bmRlZCBieSB7QGxpbmsgZm9sZENoYWlufTogYSBkaXJlY3RvcnkgbGluZSBvbmx5IGV2ZXIgYXBwZWFyc1xuICogd2hlcmUgaXQgZ2VudWluZWx5IGdyb3VwcyB0d28gb3IgbW9yZSBzaWJsaW5ncywgc28gdGhlIHRyZWUgYWRkcyBhdCBtb3N0XG4gKiBvbmUgbGluZSBwZXIgcmVhbCBncm91cGluZyBhbmQgbmV2ZXIgb25lIHBlciBwYXRoIHNlZ21lbnQuXG4gKlxuICogVG90YWwgZm9yIGFueSB3ZWxsLWZvcm1lZCBgVHJlZUFuY2hvcltdYDogZGVnZW5lcmF0ZSBwYXRocyAocnVsZSBlbmZvcmNlZFxuICogaW4ge0BsaW5rIHNwbGl0U2VnbWVudHN9KSBhcmUgbm9ybWFsaXplZCB0byBhdG9taWMgbGVhdmVzIHJhdGhlciB0aGFuXG4gKiB0aHJvd24gb24sIHNvIHRoaXMgZnVuY3Rpb24gbmV2ZXIgbmVlZHMgYW4gaW50ZXJuYWwgdHJ5L2NhdGNoLiBDYWxsZXJzIGFkZFxuICogdGhlaXIgb3duIGNhdGNoIGFyb3VuZCB0aGlzIGNhbGwgaW4gYSBsYXRlciBwaGFzZSAoZmFpbC1vcGVuIGRpc2NpcGxpbmVcbiAqIGxpdmVzIGF0IHRoZSBjYWxsIHNpdGUsIG5vdCBoZXJlKS5cbiAqXG4gKiBgcmVuZGVyQW5jaG9yVHJlZWAncyBjb250cmFjdCByZXF1aXJlcyBhdCBtb3N0IG9uZSBgVHJlZUFuY2hvcmAgcGVyXG4gKiBkaXN0aW5jdCBgcGF0aGAgXHUyMDE0IHBhc3MgYW5jaG9ycyB0aHJvdWdoIHtAbGluayBjb2xsYXBzZUJ5UGF0aH0gZmlyc3QuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJBbmNob3JUcmVlKGFuY2hvcnM6IFRyZWVBbmNob3JbXSk6IHN0cmluZ1tdIHtcbiAgY29uc3QgZm9yZXN0ID0gYnVpbGRGb3Jlc3QoYW5jaG9ycyk7XG4gIHJldHVybiByZW5kZXJOb2Rlcyhmb3Jlc3QsICcnKTtcbn1cbiIsICIvKipcbiAqIENsYXVkZSBQb3N0VG9vbFVzZSB0b3VjaCBob29rIFx1MjAxNCB0aGluIFNESy1ib3VuZCBlbnRyeSBwb2ludC5cbiAqXG4gKiBGaXJlcyBhZnRlciBhIHN1Y2Nlc3NmdWwgYFJlYWRgL2BFZGl0YC9gV3JpdGVgLCBvciBhIGBCYXNoYCBjYWxsIHdob3NlXG4gKiBgY29tbWFuZGAgc3RhdGljYWxseSByZXNvbHZlcyB0byByZWNvZ25pemFibGUgZmlsZStsaW5lLXJhbmdlIGlkaW9tcy4gVGhlXG4gKiBDbGF1ZGUtc3BlY2lmaWMgam9iIGlzIHRyYW5zbGF0aW5nIHRoZSBzdHJ1Y3R1cmVkIGB0b29sX2lucHV0YFxuICogKGBmaWxlX3BhdGhgLCBgbmV3X3N0cmluZ2AvYGNvbnRlbnRgLCBgb2Zmc2V0YC9gbGltaXRgKSBhbmQgYHRvb2xfbmFtZWAgaW50b1xuICogYSBoYXJuZXNzLWFnbm9zdGljIHtAbGluayBUb3VjaElucHV0fSwgdGhlbiBoYW5kaW5nIG9mZiB0byB0aGUgc2hhcmVkXG4gKiB7QGxpbmsgcnVuVG91Y2hIb29rfSBjb3JlOiBvbiBhIHdyaXRlIGl0IGhlYWxzXG4gKiBwb3NpdGlvbmFsIHNwYW4gZHJpZnQgaW4gdGhlIHdvcmtpbmcgdHJlZSAoYGdpdCBzcGFuIGRyaWZ0IDxmaWxlPiAtLWZpeGApIGFuZFxuICogZm9sZHMgYW55IHNlbWFudGljIHJlc2lkdWUgaW50byBvbmUgYDxnaXQtc3Bhbj5gIGJsb2NrOyBvbiBhIHJlYWQgaXQgc3VyZmFjZXNcbiAqIHNwYW5zIG92ZXJsYXBwaW5nIHRoZSByZWFkJ3MgYG9mZnNldGAvYGxpbWl0YCB3aW5kb3cgKHdob2xlLWZpbGUgd2hlbiBuZWl0aGVyXG4gKiBpcyBnaXZlbikgd2l0aCBwb3NpdGlvbmFsIHN0YXR1c2VzIGZpbHRlcmVkIG91dCwgYW5kIG5ldmVyIG11dGF0ZXMgdGhlIHRyZWUuXG4gKlxuICogVGhlIGJsb2NrIHJlYWNoZXMgdGhlIG1vZGVsIGxvb3AgdmlhIGBob29rU3BlY2lmaWNPdXRwdXQuYWRkaXRpb25hbENvbnRleHRgIGFuZFxuICogdGhlIHVzZXItZmFjaW5nIFVJIHZpYSBgc3lzdGVtTWVzc2FnZWAuIEZhaWwtb3BlbiBpcyBsb2FkLWJlYXJpbmc6IGFuIGFic2VudFxuICogQ0xJL2Auc3Bhbi9gLCB0aW1lb3V0LCBvciBub24temVybyBleGl0IHlpZWxkcyBubyBzaWduYWwgYW5kIG5ldmVyIGJsb2NrcyB0aGVcbiAqIHRvb2wgY2FsbC4gVGhlIHRpbWVvdXQgaXMgbWlsbGlzZWNvbmRzIGhlcmUgKHRoZSBDbGF1ZGUgQ0xJIGVtaXRzIG1zIGludG9cbiAqIGBob29rcy5qc29uYCk7IENvZGV4J3MgZXF1aXZhbGVudCBzb3VyY2UgdmFsdWUgaXMgZGl2aWRlZCB0byBzZWNvbmRzIGF0IGVtaXQuXG4gKi9cblxuaW1wb3J0IHtcbiAgdHlwZSBIb29rQ29udGV4dCxcbiAgdHlwZSBQb3N0VG9vbFVzZUlucHV0LFxuICBwb3N0VG9vbFVzZUhvb2ssXG4gIHBvc3RUb29sVXNlT3V0cHV0XG59IGZyb20gJ0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcyc7XG5pbXBvcnQgeyBkZXJpdmVQYXRoIH0gZnJvbSAnLi4vY29tbW9uL2FnZW50LWhvb2tzLWNvbW1vbi5qcyc7XG5pbXBvcnQgeyBwYXJzZUNvbW1hbmREZXRhaWxlZCwgdHlwZSBSZXNvbHZlZFNwYW4gfSBmcm9tICcuLi9jb21tb24vcGFyc2UtY29tbWFuZC5qcyc7XG5pbXBvcnQgeyBjcmVhdGVEaXNrTWVtb1N0b3JlLCB0eXBlIE1lbW9GYWN0b3J5LCByZXNvbHZlVG91Y2hTY29wZSB9IGZyb20gJy4uL2NvbW1vbi9zcGFuLXN1cmZhY2UuanMnO1xuaW1wb3J0IHtcbiAgY3JlYXRlRGVmYXVsdFRvdWNoRXhlY3V0b3JzLFxuICBydW5Ub3VjaEhvb2ssXG4gIHR5cGUgVG91Y2hFeGVjdXRvcnMsXG4gIHR5cGUgVG91Y2hJbnB1dFxufSBmcm9tICcuLi9jb21tb24vdG91Y2gtY29yZS5qcyc7XG5cbnR5cGUgVG9vbElucHV0ID0gUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG5cbi8qKiBSZWFkIGEgYFRvb2xJbnB1dGAgZmllbGQgYXMgYSBwb3NpdGl2ZSBpbnRlZ2VyLCBvciBgdW5kZWZpbmVkYCB3aGVuIGFic2VudC9pbnZhbGlkLiAqL1xuZnVuY3Rpb24gcG9zaXRpdmVJbnRGaWVsZCh0b29sSW5wdXQ6IFRvb2xJbnB1dCwgZmllbGQ6IHN0cmluZyk6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IHJhdyA9IHRvb2xJbnB1dFtmaWVsZF07XG4gIHJldHVybiB0eXBlb2YgcmF3ID09PSAnbnVtYmVyJyAmJiBOdW1iZXIuaXNJbnRlZ2VyKHJhdykgJiYgcmF3ID4gMCA/IHJhdyA6IHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBUcmFuc2xhdGUgYSBDbGF1ZGUgdG9vbCBjYWxsIGludG8gYSB7QGxpbmsgVG91Y2hJbnB1dH0uIGBSZWFkYCBpcyBhIHJlYWQgdG91Y2hcbiAqIGNhcnJ5aW5nIGl0cyBgb2Zmc2V0YC9gbGltaXRgICh3aGVuIHByZXNlbnQpIGZvciByYW5nZS1wcmVjaXNlIHNjb3Bpbmc7XG4gKiBgRWRpdGAvYFdyaXRlYCBhcmUgd3JpdGUgdG91Y2hlcyB3aG9zZSBgd3JpdHRlbmAgYmxvY2sgaXMgdGhlIG5ldyBjb250ZW50IHRoZVxuICogdG9vbCBqdXN0IGFwcGxpZWQgKGBuZXdfc3RyaW5nYCBmb3IgRWRpdCwgYGNvbnRlbnRgIGZvciBXcml0ZSkuIEFuIHVua25vd24gdG9vbFxuICogb3IgYSBub24tc3RyaW5nIGNvbnRlbnQgZmllbGQgeWllbGRzIGBudWxsYCAobm90aGluZyB0byBkbykuXG4gKi9cbmZ1bmN0aW9uIHRvVG91Y2hJbnB1dChcbiAgdG9vbE5hbWU6IHN0cmluZyxcbiAgdG9vbElucHV0OiBUb29sSW5wdXQsXG4gIHNlc3Npb25JZDogc3RyaW5nLFxuICBjd2Q6IHN0cmluZyxcbiAgZmlsZVBhdGg6IHN0cmluZ1xuKTogVG91Y2hJbnB1dCB8IG51bGwge1xuICBpZiAodG9vbE5hbWUgPT09ICdSZWFkJykge1xuICAgIGNvbnN0IG9mZnNldCA9IHBvc2l0aXZlSW50RmllbGQodG9vbElucHV0LCAnb2Zmc2V0Jyk7XG4gICAgY29uc3QgbGltaXQgPSBwb3NpdGl2ZUludEZpZWxkKHRvb2xJbnB1dCwgJ2xpbWl0Jyk7XG4gICAgcmV0dXJuIHsga2luZDogJ3JlYWQnLCBzZXNzaW9uSWQsIGN3ZCwgZmlsZVBhdGgsIG9mZnNldCwgbGltaXQgfTtcbiAgfVxuICBpZiAodG9vbE5hbWUgPT09ICdFZGl0JyB8fCB0b29sTmFtZSA9PT0gJ1dyaXRlJykge1xuICAgIGNvbnN0IHJhdyA9IHRvb2xOYW1lID09PSAnRWRpdCcgPyB0b29sSW5wdXQubmV3X3N0cmluZyA6IHRvb2xJbnB1dC5jb250ZW50O1xuICAgIGNvbnN0IHdyaXR0ZW4gPSB0eXBlb2YgcmF3ID09PSAnc3RyaW5nJyA/IHJhdyA6ICcnO1xuICAgIHJldHVybiB7IGtpbmQ6ICd3cml0ZScsIHNlc3Npb25JZCwgY3dkLCBmaWxlUGF0aCwgd3JpdHRlbiB9O1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlSGFuZGxlcihcbiAgZXhlY3V0b3JzOiBUb3VjaEV4ZWN1dG9ycyA9IGNyZWF0ZURlZmF1bHRUb3VjaEV4ZWN1dG9ycygpLFxuICBtZW1vRmFjdG9yeTogTWVtb0ZhY3RvcnkgPSBjcmVhdGVEaXNrTWVtb1N0b3JlXG4pIHtcbiAgcmV0dXJuIGFzeW5jIChpbnB1dDogUG9zdFRvb2xVc2VJbnB1dCwgY3R4OiBIb29rQ29udGV4dCkgPT4ge1xuICAgIGNvbnN0IG1lbW8gPSBtZW1vRmFjdG9yeShjdHgubG9nZ2VyKTtcbiAgICBjb25zdCBzZXNzaW9uSWQgPSBpbnB1dC5zZXNzaW9uX2lkO1xuICAgIGNvbnN0IGN3ZCA9IGlucHV0LmN3ZCA/PyAnJztcbiAgICBjb25zdCB0b29sTmFtZSA9IGlucHV0LnRvb2xfbmFtZTtcbiAgICBjb25zdCB0b29sSW5wdXQgPSAoaW5wdXQudG9vbF9pbnB1dCA/PyB7fSkgYXMgVG9vbElucHV0O1xuXG4gICAgLy8gQmFzaCBoYXMgbm8gYGZpbGVfcGF0aGAgZmllbGQsIHNvIGl0IGdldHMgaXRzIG93biBicmFuY2g6IHJ1biB0aGUgc3RhdGljXG4gICAgLy8gY29tbWFuZCBwYXJzZXIgYW5kIHRyYW5zbGF0ZSBldmVyeSByZXNvbHZlZCBzcGFuIGludG8gYSB0b3VjaCB0aHJvdWdoIHRoZVxuICAgIC8vIHNhbWUgc2hhcmVkIGNvcmUuIFJlYWQgaWRpb21zIGNhcnJ5IHRoZSBwYXJzZWQgbGluZSB3aW5kb3c7IGEgaGVyZWRvY1xuICAgIC8vIHdyaXRlIGNhcnJpZXMgaXRzIHdyaXR0ZW4gYm9keSAoYHNwYW4uYm9keWApIHNvIHRoZSB0b3VjaCBjb3JlIGNhbiBuYXJyb3dcbiAgICAvLyB0aGUgd3JpdGUgdG8gdGhlIGxpbmVzIHRoYXQgY2hhbmdlZCBcdTIwMTQgYD5gIG92ZXJ3cml0ZXMgbG9jYXRlIHRoZSB3cml0dGVuXG4gICAgLy8gYmxvY2ssIGA+PmAgYXBwZW5kcyBsb2NhdGUgdGhlIGFwcGVuZGVkIGJsb2NrLCBhbmQgYSBgd3JpdHRlbjogJydgIHdob2xlLVxuICAgIC8vIGZpbGUgc2NvcGUgY292ZXJzIHRydW5jYXRpb25zLiBBIGNvbW1hbmQgd2l0aCBubyByZWNvZ25pemFibGUgaWRpb21cbiAgICAvLyB5aWVsZHMgbm8gYmxvY2tzIGFuZCByZXR1cm5zIGBudWxsYCBcdTIwMTQgZmFpbC1vcGVuLCBzYW1lIGFzIHRoZSB0b29sIHBhdGhcbiAgICAvLyBiZWxvdy5cbiAgICBpZiAodG9vbE5hbWUgPT09ICdCYXNoJykge1xuICAgICAgY29uc3QgY29tbWFuZCA9IHR5cGVvZiB0b29sSW5wdXQuY29tbWFuZCA9PT0gJ3N0cmluZycgPyB0b29sSW5wdXQuY29tbWFuZCA6IG51bGw7XG4gICAgICBpZiAoIWNvbW1hbmQpIHJldHVybiBudWxsO1xuICAgICAgY29uc3QgbWF0Y2hlcyA9IHBhcnNlQ29tbWFuZERldGFpbGVkKGNvbW1hbmQsIHsgY3dkIH0pO1xuICAgICAgY29uc3QgYmxvY2tzOiBzdHJpbmdbXSA9IFtdO1xuICAgICAgZm9yIChjb25zdCBtYXRjaCBvZiBtYXRjaGVzKSB7XG4gICAgICAgIGlmIChtYXRjaC5zdGF0dXMgIT09ICdyZXNvbHZlZCcpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBzcGFuOiBSZXNvbHZlZFNwYW4gPSBtYXRjaC5zcGFuO1xuICAgICAgICBjb25zdCBzY29wZSA9IHJlc29sdmVUb3VjaFNjb3BlKGN3ZCwgc3Bhbi5hYnNvbHV0ZVBhdGgpO1xuICAgICAgICBpZiAoIXNjb3BlKSBjb250aW51ZTtcbiAgICAgICAgbGV0IHRvdWNoOiBUb3VjaElucHV0O1xuICAgICAgICBpZiAobWF0Y2guaWRpb20gPT09ICdoZXJlZG9jLXdyaXRlJykge1xuICAgICAgICAgIC8vIGA+YCBvdmVyd3JpdGVzOiB3aG9sZS1maWxlIHNjb3BlIHNvIGRlbGV0ZWQgc3BhbnMgYmV5b25kIHRoZSBuZXdcbiAgICAgICAgICAvLyBFT0YgYXJlIHN1cmZhY2VkLiBgPj5gIGFwcGVuZHM6IG5hcnJvdyB0byB0aGUgYXBwZW5kZWQgbGluZXMuXG4gICAgICAgICAgY29uc3Qgd3JpdHRlbiA9IHNwYW4ucmVkaXJlY3QgPT09ICc+JyA/ICcnIDogKHNwYW4uYm9keSA/PyAnJyk7XG4gICAgICAgICAgdG91Y2ggPSB7IGtpbmQ6ICd3cml0ZScsIHNlc3Npb25JZCwgY3dkLCBmaWxlUGF0aDogc3Bhbi5hYnNvbHV0ZVBhdGgsIHdyaXR0ZW4gfTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0b3VjaCA9IHtcbiAgICAgICAgICAgIGtpbmQ6ICdyZWFkJyxcbiAgICAgICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgICAgIGN3ZCxcbiAgICAgICAgICAgIGZpbGVQYXRoOiBzcGFuLmFic29sdXRlUGF0aCxcbiAgICAgICAgICAgIG9mZnNldDogc3Bhbi5saW5lU3RhcnQsXG4gICAgICAgICAgICBsaW1pdDogc3Bhbi5saW5lRW5kIC0gc3Bhbi5saW5lU3RhcnQgKyAxXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBvdXRwdXQgPSBhd2FpdCBydW5Ub3VjaEhvb2sodG91Y2gsIGV4ZWN1dG9ycywgbWVtbyk7XG4gICAgICAgIGlmIChvdXRwdXQuYWRkaXRpb25hbENvbnRleHQpIGJsb2Nrcy5wdXNoKG91dHB1dC5hZGRpdGlvbmFsQ29udGV4dCk7XG4gICAgICB9XG4gICAgICBpZiAoYmxvY2tzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gICAgICBjb25zdCBjb21iaW5lZCA9IGJsb2Nrcy5qb2luKCcnKTtcbiAgICAgIHJldHVybiBwb3N0VG9vbFVzZU91dHB1dCh7XG4gICAgICAgIGhvb2tTcGVjaWZpY091dHB1dDogeyBhZGRpdGlvbmFsQ29udGV4dDogY29tYmluZWQgfSxcbiAgICAgICAgc3lzdGVtTWVzc2FnZTogY29tYmluZWRcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGFic1BhdGggPSBkZXJpdmVQYXRoKHRvb2xJbnB1dCwgY3dkKTtcbiAgICBpZiAoIWFic1BhdGgpIHJldHVybiBudWxsO1xuXG4gICAgLy8gQm91bmQgdGhlIHRvdWNoIHRvIHRoZSBDV0QgcmVwbyAoZHJvcHMgY3Jvc3MtcmVwbywgZ2l0aWdub3JlZCwgYW5kIHNwYW5cbiAgICAvLyBkb2N1bWVudHMpLiBGYWlsIGNsb3NlZCBvbiBhbiB1bnJlc29sdmFibGUgQ1dEIHJlcG8uXG4gICAgY29uc3Qgc2NvcGUgPSByZXNvbHZlVG91Y2hTY29wZShjd2QsIGFic1BhdGgpO1xuICAgIGlmICghc2NvcGUpIHJldHVybiBudWxsO1xuXG4gICAgY29uc3QgdG91Y2ggPSB0b1RvdWNoSW5wdXQodG9vbE5hbWUsIHRvb2xJbnB1dCwgc2Vzc2lvbklkLCBjd2QsIGFic1BhdGgpO1xuICAgIGlmICghdG91Y2gpIHJldHVybiBudWxsO1xuXG4gICAgY29uc3Qgb3V0cHV0ID0gYXdhaXQgcnVuVG91Y2hIb29rKHRvdWNoLCBleGVjdXRvcnMsIG1lbW8pO1xuICAgIGlmICghb3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0KSByZXR1cm4gbnVsbDtcblxuICAgIHJldHVybiBwb3N0VG9vbFVzZU91dHB1dCh7XG4gICAgICBob29rU3BlY2lmaWNPdXRwdXQ6IHsgYWRkaXRpb25hbENvbnRleHQ6IG91dHB1dC5hZGRpdGlvbmFsQ29udGV4dCB9LFxuICAgICAgc3lzdGVtTWVzc2FnZTogb3V0cHV0LmFkZGl0aW9uYWxDb250ZXh0XG4gICAgfSk7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IHBvc3RUb29sVXNlSG9vayh7IG1hdGNoZXI6ICdSZWFkfEVkaXR8V3JpdGV8QmFzaCcsIHRpbWVvdXQ6IDEwXzAwMCB9LCBjcmVhdGVIYW5kbGVyKCkpO1xuIiwgImltcG9ydCBob29rIGZyb20gJy4vcG9zdC10b29sLXVzZS50cyc7XG5pbXBvcnQgeyBleGVjdXRlIH0gZnJvbSAnLi4vLi4vLi4vLi4vbm9kZV9tb2R1bGVzL0Bnb29kZm9vdC9jbGF1ZGUtY29kZS1ob29rcy9kaXN0L3J1bnRpbWUuanMnO1xuXG5leGVjdXRlKGhvb2spO1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7QUFrQ0EsWUFBWSxRQUFRO0FBTWIsSUFBTSxrQkFBa0I7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBSzNCLGFBQWE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFNYixVQUFVO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQUtWLFFBQVE7QUFDWjtBQWtDTyxTQUFTLGlCQUFpQjtBQUM3QixTQUFPLFFBQVEsSUFBSSxnQkFBZ0IsUUFBUTtBQUMvQztBQThDTyxTQUFTLGNBQWMsTUFBTSxPQUFPO0FBQ3ZDLFFBQU0sVUFBVSxlQUFlO0FBQy9CLE1BQUksWUFBWSxRQUFXO0FBQ3ZCLFVBQU0sSUFBSSxNQUFNLHdHQUE2RztBQUFBLEVBQ2pJO0FBRUEsUUFBTSxlQUFlLGlCQUFpQixLQUFLO0FBRTNDLFFBQU0sa0JBQWtCLFVB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QUFRO0FBQUEsWUFDTixNQUFNO0FBQUEsWUFDTjtBQUFBLFlBQ0E7QUFBQSxZQUNBLFVBQVUsS0FBSztBQUFBLFlBQ2YsUUFBUSxLQUFLO0FBQUEsWUFDYixPQUFPLEtBQUssVUFBVSxLQUFLLFlBQVk7QUFBQSxVQUN6QztBQUFBLFFBQ0Y7QUFDQSxjQUFNQyxVQUFTLE1BQU0sYUFBYUQsUUFBTyxXQUFXLElBQUk7QUFDeEQsWUFBSUMsUUFBTyxrQkFBbUIsUUFBTyxLQUFLQSxRQUFPLGlCQUFpQjtBQUFBLE1BQ3BFO0FBQ0EsVUFBSSxPQUFPLFdBQVcsRUFBRyxRQUFPO0FBQ2hDLFlBQU0sV0FBVyxPQUFPLEtBQUssRUFBRTtBQUMvQixhQUFPLGtCQUFrQjtBQUFBLFFBQ3ZCLG9CQUFvQixFQUFFLG1CQUFtQixTQUFTO0FBQUEsUUFDbEQsZUFBZTtBQUFBLE1BQ2pCLENBQUM7QUFBQSxJQUNIO0FBRUEsVUFBTSxVQUFVLFdBQVcsV0FBVyxHQUFHO0FBQ3pDLFFBQUksQ0FBQyxRQUFTLFFBQU87QUFJckIsVUFBTSxRQUFRLGtCQUFrQixLQUFLLE9BQU87QUFDNUMsUUFBSSxDQUFDLE1BQU8sUUFBTztBQUVuQixVQUFNLFFBQVEsYUFBYSxVQUFVLFdBQVcsV0FBVyxLQUFLLE9BQU87QUFDdkUsUUFBSSxDQUFDLE1BQU8sUUFBTztBQUVuQixVQUFNLFNBQVMsTUFBTSxhQUFhLE9BQU8sV0FBVyxJQUFJO0FBQ3hELFFBQUksQ0FBQyxPQUFPLGtCQUFtQixRQUFPO0FBRXRDLFdBQU8sa0JBQWtCO0FBQUEsTUFDdkIsb0JBQW9CLEVBQUUsbUJBQW1CLE9BQU8sa0JBQWtCO0FBQUEsTUFDbEUsZUFBZSxPQUFPO0FBQUEsSUFDeEIsQ0FBQztBQUFBLEVBQ0g7QUFDRjtBQUVBLElBQU8sd0JBQVEsZ0JBQWdCLEVBQUUsU0FBUyx3QkFBd0IsU0FBUyxJQUFPLEdBQUcsY0FBYyxDQUFDOzs7QUNuSnBHLFFBQVEscUJBQUk7IiwKICAibmFtZXMiOiBbInJlc29sdmUiLCAiZnMiLCAiaXNBYnNvbHV0ZSIsICJleGVjRmlsZVN5bmMiLCAic3RhdFN5bmMiLCAiaSIsICJyZXNvbHZlIiwgInZhbHVlIiwgImVzY2FwZVJlZ0V4cCIsICJpc0Fic29sdXRlIiwgImV4ZWNGaWxlU3luYyIsICJmcyIsICJub2RlUGF0aCIsICJmcyIsICJub2RlUGF0aCIsICJsb2dnZXIiLCAiZXhlY0ZpbGVTeW5jIiwgImZzIiwgImJhc2VuYW1lIiwgImJhc2VuYW1lIiwgImV4ZWNGaWxlU3luYyIsICJzY29wZSIsICJ0b3VjaCIsICJvdXRwdXQiXQp9Cg==

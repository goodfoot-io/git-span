#!/usr/bin/env -S node --enable-source-maps
// packages/agent-hooks/src/codex/stop.ts
import { dirname as dirname5, join as join5 } from "node:path";

// node_modules/@goodfoot/agent-hooks/dist/core/logger.js
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
   * import { logger } from '@goodfoot/agent-hooks';
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
   * @param hookType - The agent event name being executed
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
   * logger.setLogFile('/var/log/agent-hooks.log');
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
        process.stderr.write(`[agent-hooks] Failed to close log file: ${String(closeError)}
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
        process.stderr.write(`[agent-hooks] Failed to close log file: ${String(closeError)}
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
          process.stderr.write(`[agent-hooks] Log handler error: ${String(handlerError)}
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
      process.stderr.write(`[agent-hooks] Log file write failed: ${String(writeError)}
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
  logEnvVar: process.env.AGENT_HOOKS_LOG_ENV_VAR ?? "AGENT_HOOKS_LOG_FILE"
});

// node_modules/@goodfoot/agent-hooks/dist/agents/codex/constants.js
var EVENTS_WITH_TEXT_OUTPUT = /* @__PURE__ */ new Set(["SessionStart", "UserPromptSubmit", "SubagentStart"]);

// node_modules/@goodfoot/agent-hooks/dist/agents/codex/events.js
var HOOK_EVENT_NAMES = [
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "UserPromptSubmit",
  "SessionStart",
  "SubagentStart",
  "Stop",
  "SubagentStop",
  "PreCompact",
  "PostCompact"
];
var EXCLUDED_FROM_ADVISORY = [
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "Stop",
  "SubagentStop",
  "PreCompact",
  "PostCompact"
];
var ADVISORY_EVENTS = HOOK_EVENT_NAMES.filter((eventName) => !EXCLUDED_FROM_ADVISORY.includes(eventName));

// node_modules/@goodfoot/agent-hooks/dist/core/define-hook.js
function defineHook(eventName, config, handler, policyGate) {
  if (policyGate !== void 0) {
    let accepted;
    try {
      accepted = policyGate(eventName, config.unexpectedError);
    } catch (error) {
      throw new Error(`Policy gate rejected "${eventName}": ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!accepted) {
      throw new Error(`Policy gate rejected "${eventName}"`);
    }
  }
  const hookFn = async (input, context) => {
    return await handler(input, context);
  };
  hookFn.eventName = eventName;
  hookFn.matcher = config.matcher;
  hookFn.timeout = config.timeout;
  hookFn.unexpectedError = config.unexpectedError;
  hookFn.onUnexpectedError = config.onUnexpectedError;
  hookFn.createContext = config.createContext;
  return hookFn;
}

// node_modules/@goodfoot/agent-hooks/dist/agents/codex/hooks.js
var advisoryPolicyGate = (eventName, policy) => policy !== "continue" || ADVISORY_EVENTS.includes(eventName);
function createHookFunction(hookEventName, config, handler) {
  const coreConfig = {
    matcher: "matcher" in config ? config.matcher : void 0,
    timeout: config.timeout,
    unexpectedError: config.unexpectedError,
    onUnexpectedError: config.onUnexpectedError
  };
  const hookFn = defineHook(hookEventName, coreConfig, handler, advisoryPolicyGate);
  const codexFn = hookFn;
  codexFn.hookEventName = hookEventName;
  codexFn.statusMessage = config.statusMessage;
  return codexFn;
}
function stopHook(config, handler) {
  return createHookFunction("Stop", config, handler);
}

// node_modules/@goodfoot/agent-hooks/dist/core/stdin.js
async function readStdin() {
  return new Promise((resolve7, reject2) => {
    const chunks = [];
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      chunks.push(chunk);
    });
    process.stdin.on("end", () => {
      resolve7(chunks.join(""));
    });
    process.stdin.on("error", (error) => {
      reject2(error);
    });
  });
}
function parseStdinJson(stdinContent) {
  return JSON.parse(stdinContent);
}

// node_modules/@goodfoot/agent-hooks/dist/core/transport.js
var HookBlockError = class extends Error {
  /**
   * Optional structured fields carried alongside the block reason (e.g.
   * extra wire fields the agent's translation may forward).
   */
  fields;
  /**
   * @param message - The block reason; becomes the error `message`.
   * @param fields - Optional additional structured fields.
   */
  constructor(message, fields) {
    super(message);
    this.name = "HookBlockError";
    this.fields = fields;
  }
};
var FALLBACK_EXIT_ERROR = 1;
var FALLBACK_EXIT_SUCCESS = 0;
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
function cleanup(policy, onUnexpectedError) {
  try {
    logger.clearContext();
    logger.close();
  } catch (error) {
    if (policy !== "continue") {
      throw error;
    }
    reportUnexpectedError(onUnexpectedError, error, "cleanup");
  }
}
function classify(error, phase, policy, onUnexpectedError) {
  if (error instanceof HookBlockError) {
    return { kind: "block", error };
  }
  if (policy === "continue") {
    reportUnexpectedError(onUnexpectedError, error, phase);
    return { kind: "response", output: void 0 };
  }
  return { kind: "handlerError", error, phase };
}
function writeStream(stream, content) {
  return new Promise((resolve7, reject2) => {
    stream.write(content, (error) => {
      if (error)
        reject2(error);
      else
        resolve7();
    });
  });
}
async function writeUnexpectedErrorStderr(error) {
  if (error instanceof Error) {
    await writeStream(process.stderr, `${error.stack ?? error.message}
`);
  } else {
    await writeStream(process.stderr, `${String(error)}
`);
  }
}
function cleanupQuietly() {
  try {
    logger.clearContext();
    logger.close();
  } catch {
  }
}
async function drive(transport, hookFn) {
  const policy = hookFn.unexpectedError ?? "error";
  const onUnexpectedError = hookFn.onUnexpectedError;
  const outcome = await (async () => {
    let stdinContent;
    try {
      stdinContent = await readStdin();
    } catch (error) {
      logger.logError(error, "Failed to read stdin");
      return classify(error, "read", policy, onUnexpectedError);
    }
    let input;
    try {
      input = parseStdinJson(stdinContent);
    } catch (error) {
      logger.logError(error, "Failed to parse stdin JSON");
      return classify(error, "parse", policy, onUnexpectedError);
    }
    logger.setContext(hookFn.eventName, input);
    const context = hookFn.createContext?.(input) ?? { logger };
    try {
      const result = await hookFn(input, context);
      if (result === null || result === void 0) {
        return { kind: "response", output: void 0 };
      }
      const raw = transport.rawStdout?.(result);
      return raw !== void 0 ? { kind: "rawStdout", stdout: raw } : { kind: "response", output: result };
    } catch (error) {
      return classify(error, "handler", policy, onUnexpectedError);
    }
  })();
  let finalized;
  try {
    finalized = transport.finalize(outcome);
  } catch (error) {
    if (policy === "continue") {
      reportUnexpectedError(onUnexpectedError, error, "serialize");
      cleanupQuietly();
      process.exit(FALLBACK_EXIT_SUCCESS);
    }
    await writeUnexpectedErrorStderr(error);
    cleanupQuietly();
    process.exit(FALLBACK_EXIT_ERROR);
  }
  try {
    cleanup(policy, onUnexpectedError);
  } catch (error) {
    await writeUnexpectedErrorStderr(error);
    process.exit(FALLBACK_EXIT_ERROR);
  }
  if (finalized.stderr !== void 0) {
    await writeStream(process.stderr, finalized.stderr);
  }
  if (finalized.stdout !== void 0) {
    try {
      await writeStream(process.stdout, finalized.stdout);
    } catch (error) {
      if (policy === "continue") {
        reportUnexpectedError(onUnexpectedError, error, "write");
        cleanupQuietly();
        process.exit(FALLBACK_EXIT_SUCCESS);
      }
      await writeUnexpectedErrorStderr(error);
      cleanupQuietly();
      process.exit(FALLBACK_EXIT_ERROR);
    }
  }
  process.exit(finalized.exitCode);
}

// node_modules/@goodfoot/agent-hooks/dist/agents/codex/outputs.js
var EXIT_CODES = {
  SUCCESS: 0,
  ERROR: 1,
  BLOCK: 2
};
var BlockError = class extends HookBlockError {
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
function stopOutput(options = {}) {
  return buildOutput("Stop", {
    continue: options.continue,
    stopReason: options.stopReason,
    suppressOutput: options.suppressOutput,
    systemMessage: options.systemMessage,
    decision: options.decision,
    reason: options.reason
  });
}

// node_modules/@goodfoot/agent-hooks/dist/agents/codex/transport.js
function convertToHookOutput(output) {
  return output.stderr !== void 0 ? { stdout: output.stdout, stderr: output.stderr } : { stdout: output.stdout };
}
function formatErrorText(error) {
  return error instanceof Error ? `${error.stack ?? error.message}
` : `${String(error)}
`;
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
function createCodexTransport() {
  return {
    finalize(outcome) {
      switch (outcome.kind) {
        case "response":
        case "rawStdout": {
          const stdoutJson = outcome.kind === "response" && outcome.output !== null && outcome.output !== void 0 ? JSON.stringify(convertToHookOutput(outcome.output).stdout) : "{}";
          return { stdout: stdoutJson, exitCode: EXIT_CODES.SUCCESS };
        }
        case "block": {
          const reason = outcome.error instanceof BlockError ? outcome.error.reason : outcome.error.message;
          return { stderr: `${reason}
`, exitCode: EXIT_CODES.BLOCK };
        }
        case "handlerError": {
          return { stderr: formatErrorText(outcome.error), exitCode: EXIT_CODES.ERROR };
        }
      }
    }
  };
}
async function execute(hookFn) {
  const eventName = hookFn.hookEventName;
  const composed = ((input, context) => {
    const result = hookFn(input, context);
    const normalize = (value) => {
      if (typeof value === "string") {
        return normalizeStringOutput(eventName, value);
      }
      return value;
    };
    return result instanceof Promise ? result.then(normalize) : normalize(result);
  });
  composed.eventName = hookFn.eventName ?? eventName;
  composed.matcher = hookFn.matcher;
  composed.timeout = hookFn.timeout;
  composed.unexpectedError = hookFn.unexpectedError;
  composed.onUnexpectedError = hookFn.onUnexpectedError;
  composed.createContext = hookFn.createContext;
  await drive(createCodexTransport(), composed);
}

// packages/agent-hooks/src/common/agent-hooks-common.ts
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";

// packages/agent-hooks/src/common/guards.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isErrnoException(error) {
  return error instanceof Error && (!("code" in error) || error.code === void 0 || typeof error.code === "string");
}
function errnoCode(error) {
  return isErrnoException(error) ? error.code : void 0;
}
function isOneOf(tokens, value) {
  return tokens.some((token) => token === value);
}

// packages/agent-hooks/src/common/agent-hooks-common.ts
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
    let current = fs.realpathSync.native(dir);
    for (; ; ) {
      if (fs.existsSync(nodePath.join(current, ".git"))) return toPosix(current);
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
var SESSION_TRASH_MARKER = ".trash-session-";
var lastOpportunisticPruneAt = Number.NEGATIVE_INFINITY;
function cleanupSessionState(layout, sessionId, now = Date.now()) {
  const dirPath = layout.dir(sessionId);
  try {
    fs.mkdirSync(layout.trashDir, { recursive: true, mode: 448 });
    const trashPath = nodePath.join(
      layout.trashDir,
      `${sanitizeSessionId(sessionId)}${SESSION_TRASH_MARKER}${process.pid}-${now.toString(36)}`
    );
    fs.renameSync(dirPath, trashPath);
    fs.utimesSync(trashPath, now / 1e3, now / 1e3);
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") throw error;
  }
}

// packages/agent-hooks/src/common/commit-runtime.ts
import { randomBytes as randomBytes2 } from "node:crypto";
import { existsSync as existsSync5, lstatSync as lstatSync2, realpathSync as realpathSync3, renameSync as renameSync3, rmSync as rmSync3 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join4 } from "node:path";

// packages/agent-hooks/src/common/commit-association.ts
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
function noteDocument(value) {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.host !== "claude" && value.host !== "codex") return null;
  if (typeof value.sessionId !== "string" || value.sessionId.length === 0 || value.sessionId.length > 4096 || value.sessionId.includes("\0"))
    return null;
  if (Object.keys(value).some((key2) => !["schemaVersion", "host", "sessionId", "transcriptLocator"].includes(key2)))
    return null;
  if (value.transcriptLocator !== void 0 && (typeof value.transcriptLocator !== "string" || value.transcriptLocator.length === 0 || value.transcriptLocator.length > 4096 || value.transcriptLocator.includes("\0")))
    return null;
  return {
    schemaVersion: 1,
    host: value.host,
    sessionId: value.sessionId,
    ...value.transcriptLocator === void 0 ? {} : { transcriptLocator: value.transcriptLocator }
  };
}
function commitAssociationKey(receipt, document) {
  return createHash("sha256").update(JSON.stringify([receipt.repository.commonDirectory, document.host, document.sessionId, receipt.sha])).digest("hex");
}
function selectCommitAssociation(document, existing) {
  if (!noteDocument(document)) return { kind: "reject", reason: "invalid association document" };
  const matches = [];
  for (const note of existing) {
    const value = noteDocument(note.document);
    if (value && value.host === document.host && value.sessionId === document.sessionId) matches.push(value);
  }
  const [original, ...others] = matches;
  if (others.length > 0) return { kind: "reject", reason: "ambiguous existing commit associations" };
  if (original === void 0) return { kind: "add", document };
  return {
    kind: "reuse",
    document: original,
    locatorConflict: document.transcriptLocator !== void 0 && original.transcriptLocator !== document.transcriptLocator
  };
}
function validateEnvelope(value, sha, operation) {
  const reject2 = (reason) => ({ ok: false, reason });
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha) || /^0+$/.test(sha)) return reject2("invalid full SHA selection");
  if (!isRecord(value) || value.schema_version !== 1 || value.operation !== operation || !Array.isArray(value.notes))
    return reject2("invalid notes CLI envelope");
  const result = [];
  const ids = /* @__PURE__ */ new Set();
  for (const note of value.notes) {
    if (!isRecord(note) || typeof note.id !== "number" || !Number.isSafeInteger(note.id) || note.id <= 0 || ids.has(note.id) || note.commit_sha !== sha || !Object.hasOwn(note, "document") || note.document === void 0) {
      return reject2("invalid exact-SHA notes record");
    }
    ids.add(note.id);
    result.push({ document: note.document });
  }
  return { ok: true, value: result };
}
function validateCommitNotesList(value, sha) {
  return validateEnvelope(value, sha, "list");
}
function validateCommitNotesAdd(value, sha, document) {
  const envelope = validateEnvelope(value, sha, "add");
  if (!envelope.ok) return envelope;
  const [acknowledged, ...extra] = envelope.value;
  if (acknowledged === void 0 || extra.length > 0 || !noteDocument(document) || !isDeepStrictEqual(acknowledged.document, document)) {
    return { ok: false, reason: "notes acknowledgment does not match frozen document" };
  }
  return { ok: true, value: document };
}

// packages/agent-hooks/src/common/commit-contracts.ts
import { isAbsolute } from "node:path";

// packages/agent-hooks/src/common/commit-limits.ts
var COMMIT_RECEIPT_LIMITS = {
  jsonFileBytes: 1048576,
  identityKeyBytes: 256,
  reflogBytes: 1048576,
  /** Newest receipts kept per invocation. */
  receiptsPerInvocation: 256,
  /** Invocation directories kept before a batch eviction starts. */
  invocationWindow: 512,
  /** Invocation count a batch eviction reduces the store to. */
  invocationWindowFloor: 384,
  /** Hard scan bound for readers that walk the invocation directory. */
  invocations: 4096,
  abandonedRetentionMs: 864e5,
  drainMs: 3e3,
  /** Share of drainMs a batch eviction may spend; the remainder is reserved so enrolling the invocation never starves. */
  evictionMs: 2e3,
  cliMs: 2e3
};

// packages/agent-hooks/src/common/commit-contracts.ts
function text(value, max = 4096) {
  return typeof value === "string" && value.length > 0 && value.length <= max && !value.includes("\0");
}
function absolute(value) {
  return text(value) && isAbsolute(value);
}
function key(value) {
  return text(value, COMMIT_RECEIPT_LIMITS.identityKeyBytes) && /^[a-zA-Z0-9_-]+$/.test(value);
}
function reject(reason) {
  return { ok: false, reason };
}
function validateCommitEnrollment(value) {
  if (!isRecord(value) || value.schemaVersion !== 1) return reject("invalid enrollment schema");
  if (value.host !== "claude" && value.host !== "codex") return reject("unsupported commit host");
  if (!key(value.invocationKey) || !text(value.sessionId) || !text(value.toolUseId)) {
    return reject("invalid invocation identity");
  }
  if (!absolute(value.cwd) || !absolute(value.gitExecutable)) return reject("enrollment paths must be absolute");
  if (!isRecord(value.originalInput) || !text(value.originalCommand, COMMIT_RECEIPT_LIMITS.jsonFileBytes)) {
    return reject("invalid original tool input");
  }
  if (value.transcriptLocator !== void 0 && !text(value.transcriptLocator))
    return reject("invalid transcript locator");
  try {
    if (Buffer.byteLength(JSON.stringify(value.originalInput)) > COMMIT_RECEIPT_LIMITS.jsonFileBytes)
      return reject("original input exceeds budget");
  } catch {
    return reject("original input is not serializable");
  }
  const enrollment = {
    schemaVersion: 1,
    invocationKey: value.invocationKey,
    host: value.host,
    sessionId: value.sessionId,
    toolUseId: value.toolUseId,
    originalInput: value.originalInput,
    originalCommand: value.originalCommand,
    cwd: value.cwd,
    gitExecutable: value.gitExecutable,
    ...value.transcriptLocator === void 0 ? {} : { transcriptLocator: value.transcriptLocator }
  };
  return { ok: true, value: enrollment };
}
function validateCommitReceipt(value, enrollment) {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.invocationKey !== enrollment.invocationKey || !key(value.nonce)) {
    return reject("invalid receipt identity");
  }
  const repo = value.repository;
  if (!isRecord(repo) || !absolute(repo.cwd) || !absolute(repo.gitDirectory) || !absolute(repo.commonDirectory) || !absolute(repo.headReflog)) {
    return reject("receipt repository paths must be absolute");
  }
  if (repo.objectFormat !== "sha1" && repo.objectFormat !== "sha256") return reject("unsupported object format");
  const pattern = repo.objectFormat === "sha1" ? /^[0-9a-f]{40}$/ : /^[0-9a-f]{64}$/;
  if (typeof value.sha !== "string" || !pattern.test(value.sha) || /^0+$/.test(value.sha))
    return reject("invalid full commit SHA");
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      invocationKey: value.invocationKey,
      nonce: value.nonce,
      sha: value.sha,
      repository: {
        cwd: repo.cwd,
        gitDirectory: repo.gitDirectory,
        commonDirectory: repo.commonDirectory,
        headReflog: repo.headReflog,
        objectFormat: repo.objectFormat
      }
    }
  };
}
function createCommitNoteDocument(enrollment) {
  return {
    schemaVersion: 1,
    host: enrollment.host,
    sessionId: enrollment.sessionId,
    ...enrollment.transcriptLocator === void 0 ? {} : { transcriptLocator: enrollment.transcriptLocator }
  };
}
function serializeCommitNoteDocument(document) {
  return JSON.stringify({
    schemaVersion: document.schemaVersion,
    host: document.host,
    sessionId: document.sessionId,
    ...document.transcriptLocator === void 0 ? {} : { transcriptLocator: document.transcriptLocator }
  });
}

// packages/agent-hooks/src/common/commit-lifecycle.ts
var COMMIT_INVOCATION_STATUSES = ["active", "completed", "acknowledged", "retired"];
function decideCommitClaim(owner, liveness, remainingMs) {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return "refuse";
  if (owner === null) return "acquire";
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || !/^[a-zA-Z0-9_-]{1,256}$/.test(owner.token))
    return "refuse";
  if (liveness === "dead") return "recover";
  return liveness === "alive" ? "wait" : "refuse";
}
function commitCliBudgetMs(phaseStartedMs, nowMs) {
  if (!Number.isFinite(phaseStartedMs) || !Number.isFinite(nowMs) || nowMs < phaseStartedMs) return 0;
  return Math.max(
    0,
    Math.floor(Math.min(COMMIT_RECEIPT_LIMITS.cliMs, COMMIT_RECEIPT_LIMITS.drainMs - (nowMs - phaseStartedMs)))
  );
}

// packages/agent-hooks/src/common/commit-native-io.ts
import { spawn, spawnSync } from "node:child_process";
import { createHash as createHash2 } from "node:crypto";
import {
  accessSync,
  closeSync as closeSync2,
  constants,
  existsSync as existsSync3,
  fstatSync,
  openSync as openSync2,
  readSync,
  realpathSync as realpathSync2,
  statSync as statSync2
} from "node:fs";
import { delimiter, isAbsolute as isAbsolute2, join as join2, resolve as resolve2 } from "node:path";
import { StringDecoder } from "node:string_decoder";
function executableOnPath(name, cwd = process.cwd()) {
  const candidates = isAbsolute2(name) ? [name] : (process.env.PATH ?? "").split(delimiter).map((directory) => resolve2(cwd, directory, name));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync2(candidate).isFile()) return realpathSync2(candidate);
    } catch {
    }
  }
  throw new Error(`${name} executable is unavailable`);
}
async function executeCommitNotes(executable, command) {
  return new Promise((resolveResult) => {
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let timedOut = false;
    let outputExceeded = false;
    let finished = false;
    const grouped = process.platform !== "win32";
    const child = spawn(executable, [...command.argv], {
      cwd: command.cwd,
      detached: grouped,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const finish = (exitCode, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      resolveResult({ exitCode, signal, stdout, stderr, timedOut, outputExceeded });
    };
    const terminate = () => {
      try {
        if (grouped && child.pid !== void 0) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        return finish(null, "SIGKILL");
      }
      finish(null, "SIGKILL");
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, command.timeoutMs);
    const append = (kind, chunk) => {
      bytes += chunk.length;
      if (bytes > command.maxOutputBytes) {
        outputExceeded = true;
        terminate();
        return;
      }
      if (kind === "stdout") stdout += stdoutDecoder.write(chunk);
      else stderr += stderrDecoder.write(chunk);
    };
    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.stdin.on("error", () => {
    });
    child.stdin.end(command.stdin ?? "");
    child.once("error", () => finish(127, null));
    child.once("close", (exitCode, signal) => finish(exitCode, signal));
  });
}

// packages/agent-hooks/src/common/commit-observation.ts
import { createHash as createHash3 } from "node:crypto";
import { resolve as resolve4 } from "node:path";

// packages/agent-hooks/src/common/commit-git.ts
import { isAbsolute as isAbsolute3, resolve as resolve3 } from "node:path";

// packages/agent-hooks/src/common/commit-span-metadata.ts
import { relative, resolve as resolve5 } from "node:path";
async function inspectCommitSpanMetadata(executable, cwd, sha, deadline, gitDirectory) {
  const git = async (argv, missingConfig = false) => {
    const timeoutMs = Math.floor(deadline - performance.now());
    if (timeoutMs <= 0) throw new Error("note commit inspection deadline exhausted");
    const result = await executeCommitNotes(executable, {
      cwd,
      argv: [...gitDirectory === void 0 ? [] : ["--git-dir", gitDirectory], ...argv],
      timeoutMs,
      maxOutputBytes: 1048576
    });
    if (result.signal !== null || result.timedOut || result.outputExceeded || result.exitCode !== 0 && !(missingConfig && result.exitCode === 1))
      throw new Error("note commit inspection unavailable, failed, or exceeded bounds");
    return result.stdout;
  };
  const configured = process.env.GIT_SPAN_DIR?.trim() || (await git(["config", "--get", "git-span.dir"], true)).trim() || ".span";
  const root = relative(cwd, resolve5(cwd, configured)).split("\\").join("/");
  const output = await git([
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-z",
    "-r",
    "--root",
    "-m",
    "--no-renames",
    sha,
    "--"
  ]);
  if (output && !output.endsWith("\0")) throw new Error("invalid note commit path output");
  const paths = output.split("\0").filter(Boolean);
  if (!paths.length) return "empty";
  return paths.some(
    (changed) => ![".span", ".spans", root].some((metadata) => metadata === "" || isInsideSpanRoot(changed, metadata))
  ) ? "material" : "metadata-only";
}

// packages/agent-hooks/src/common/commit-storage.ts
import { createHash as createHash4, randomBytes } from "node:crypto";
import {
  closeSync as closeSync3,
  constants as constants2,
  existsSync as existsSync4,
  fstatSync as fstatSync2,
  linkSync,
  lstatSync,
  mkdirSync as mkdirSync3,
  opendirSync,
  openSync as openSync3,
  readFileSync,
  renameSync as renameSync2,
  rmSync as rmSync2,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname as dirname4, isAbsolute as isAbsolute4, join as join3 } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// packages/agent-hooks/src/common/receipt-lock.ts
import { spawn as spawn2 } from "node:child_process";

// packages/agent-hooks/src/common/git-span-command.ts
import { dirname as dirname3, resolve as resolve6 } from "node:path";
function resolveGitSpanCommand(argv, cwd = process.cwd(), gitExecutable = "git", platform = process.platform) {
  if (platform === "win32") {
    const extensions = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
    for (const directory of (process.env.PATH ?? "").split(";")) {
      for (const extension of extensions) {
        const candidate = resolve6(cwd, directory, `git-span${extension.toLowerCase()}`);
        try {
          const executable = executableOnPath(candidate, cwd);
          if (extension.toLowerCase() === ".exe" || extension.toLowerCase() === ".com")
            return { executable, argv: [...argv] };
          return { executable: gitExecutable, argv: [`--exec-path=${dirname3(candidate)}`, "span", ...argv] };
        } catch {
        }
      }
    }
    return { executable: gitExecutable, argv: ["span", ...argv] };
  }
  try {
    return {
      executable: executableOnPath("git-span", cwd),
      argv: [...argv]
    };
  } catch {
    return { executable: gitExecutable, argv: ["span", ...argv] };
  }
}

// packages/agent-hooks/src/common/receipt-lock.ts
async function acquireNativeReceiptLock(directory, key2, deadline, executable) {
  const remaining = Math.min(3e4, Math.floor(deadline - performance.now()));
  if (remaining <= 0) throw new Error("receipt lock acquisition deadline exhausted");
  const args = ["__receipt-lock", "--directory", directory, "--key", key2, "--wait-ms", String(remaining)];
  const command = executable ? { executable, argv: args } : resolveGitSpanCommand(args);
  const child = spawn2(command.executable, command.argv, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, GIT_SPAN_DISABLE_UPDATE_CHECK: "1" },
    windowsHide: true
  });
  child.stdin.on("error", () => {
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString("utf8")).slice(0, 4096);
  });
  let spawnError;
  child.on("error", (error) => {
    spawnError = error;
  });
  const closed = new Promise((resolve7) => {
    child.once("close", (code, signal) => resolve7({ code, signal }));
  });
  let released = false;
  try {
    await new Promise((resolve7, reject2) => {
      let output = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject2(new Error("receipt lock acquisition deadline exhausted"));
      }, remaining);
      child.stdout.on("data", (chunk) => {
        output += chunk.toString("utf8");
        if (output === "locked\n") {
          clearTimeout(timer);
          resolve7();
        } else if (output.length >= 7) {
          clearTimeout(timer);
          child.kill("SIGKILL");
          reject2(new Error("invalid receipt lock readiness response"));
        }
      });
      void closed.then(() => {
        clearTimeout(timer);
        reject2(new Error(`receipt lock unavailable: ${spawnError?.message ?? (stderr.trim() || "helper exited")}`));
      });
    });
  } catch (error) {
    child.stdin.destroy();
    child.kill("SIGKILL");
    await closed;
    throw error;
  }
  return {
    async release() {
      if (released) throw new Error("receipt lock already released");
      released = true;
      child.stdin.end();
      const timer = setTimeout(() => child.kill("SIGKILL"), 1e3);
      try {
        const result = await closed;
        if (result.code !== 0 || result.signal !== null || spawnError)
          throw new Error(`receipt lock release failed: ${stderr.trim() || result.signal || String(result.code)}`);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

// packages/agent-hooks/src/common/commit-storage.ts
async function privateDirectory(path, deadline) {
  if (!isAbsolute4(path)) throw new Error("receipt state root must be absolute");
  if (performance.now() >= deadline) throw new Error("receipt directory phase deadline exhausted");
  mkdirSync3(path, { recursive: true, mode: 448 });
  const owner = process.getuid?.();
  const descriptor = owner === void 0 ? void 0 : openSync3(path, constants2.O_RDONLY | constants2.O_DIRECTORY | constants2.O_NOFOLLOW);
  try {
    for (; ; ) {
      const stat = descriptor === void 0 ? lstatSync(path) : fstatSync2(descriptor);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 63) !== 0)
        throw new Error("receipt directory is not private");
      if (owner === void 0 || stat.uid === owner) return;
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw new Error("receipt directory ownership unavailable within phase deadline");
      await delay(Math.min(5, remaining));
    }
  } finally {
    if (descriptor !== void 0) closeSync3(descriptor);
  }
}
function readJson(path, maximumBytes = COMMIT_RECEIPT_LIMITS.jsonFileBytes) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumBytes)
    throw new Error("invalid bounded receipt file");
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return parsed;
}
function atomicJson(path, value, immutable = false) {
  const temporary = join3(dirname4(path), `.publish-${randomBytes(16).toString("hex")}`);
  try {
    writeFileSync(temporary, JSON.stringify(value), { mode: 384, flag: "wx" });
    if (immutable) linkSync(temporary, path);
    else renameSync2(temporary, path);
  } finally {
    rmSync2(temporary, { force: true });
  }
}
function boundedEntries(directory, cap, deadline = Infinity) {
  if (!existsSync4(directory)) return [];
  const stream = opendirSync(directory);
  const names = [];
  try {
    for (; ; ) {
      if (performance.now() >= deadline) throw new Error("receipt phase deadline exhausted");
      const entry = stream.readSync();
      if (!entry) break;
      if (names.length >= cap) throw new Error("receipt entry count exceeds budget");
      names.push(entry.name);
    }
  } finally {
    stream.closeSync();
  }
  return names;
}
function ownerLiveness(owner) {
  try {
    process.kill(owner.pid, 0);
    return "alive";
  } catch (error) {
    return errnoCode(error) === "ESRCH" ? "dead" : "uncertain";
  }
}
function ownerRecord(value) {
  if (!isRecord(value)) return null;
  const { token, pid } = value;
  return typeof token === "string" && /^[a-zA-Z0-9_-]{1,256}$/.test(token) && typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0 ? { token, pid } : null;
}
async function acquireReceiptClaim(root, key2, deadline, executable) {
  if (!/^[a-zA-Z0-9_-]+$/.test(key2)) throw new Error("invalid receipt claim key");
  const directory = join3(root, "claims");
  await privateDirectory(directory, deadline);
  const path = join3(directory, `${key2}.json`);
  const owner = { token: randomBytes(16).toString("hex"), pid: process.pid };
  while (performance.now() < deadline) {
    const lock = await acquireNativeReceiptLock(directory, key2, deadline, executable);
    let retained = false;
    try {
      let prior = null;
      if (existsSync4(path)) {
        prior = ownerRecord(readJson(path, 4096));
        if (prior === null) return null;
      }
      const decision = decideCommitClaim(
        prior,
        prior === null ? "uncertain" : ownerLiveness(prior),
        deadline - performance.now()
      );
      if (decision === "acquire" || decision === "recover") {
        if (prior !== null) unlinkSync(path);
        atomicJson(path, owner, true);
        retained = true;
        return {
          owner,
          release: async () => {
            try {
              const current = ownerRecord(readJson(path, 4096));
              if (current?.token !== owner.token || current.pid !== owner.pid)
                throw new Error("receipt claim ownership changed");
              unlinkSync(path);
            } finally {
              await lock.release();
            }
          }
        };
      }
      if (decision === "refuse") return null;
    } finally {
      if (!retained) await lock.release();
    }
    await delay(Math.min(20, Math.max(0, deadline - performance.now())));
  }
  return null;
}

// packages/agent-hooks/src/common/commit-runtime.ts
async function cleanupCommitInvocations(host, sessionId, options = {}, logger2) {
  const root = receiptRoot(options);
  const started = performance.now();
  const deadline = started + COMMIT_RECEIPT_LIMITS.drainMs;
  const result = { acknowledged: 0, pending: 0, retired: 0 };
  if (!existsSync5(join4(root, "invocations"))) return result;
  try {
    for (const key2 of boundedEntries(join4(root, "invocations"), COMMIT_RECEIPT_LIMITS.invocations, deadline)) {
      if (performance.now() >= deadline) {
        logger2?.warn("git-span commit receipts: cleanup deadline exhausted");
        break;
      }
      const directory = join4(root, "invocations", key2);
      const valid = validateCommitEnrollment(readJson(join4(directory, "enrollment.json")));
      if (!valid.ok) {
        logger2?.warn(`git-span commit receipts: ${valid.reason}`);
        continue;
      }
      if (!cleanupMayAffect(directory, valid.value, host, sessionId)) continue;
      const claim = await acquireReceiptClaim(root, `invocation-${key2}`, deadline, options.lockExecutable);
      if (!claim) {
        logger2?.warn("git-span commit receipts: cleanup invocation ownership unavailable");
        continue;
      }
      try {
        const state = readState(directory, valid.value);
        const abandoned = Date.now() - state.lastActivityMs >= COMMIT_RECEIPT_LIMITS.abandonedRetentionMs;
        if (abandoned) {
          logger2?.warn("git-span commit receipts: expired abandoned state and pending evidence");
          rmSync3(directory, { recursive: true });
          result.retired++;
          continue;
        }
        if (valid.value.host !== host || valid.value.sessionId !== sessionId || state.status === "active") continue;
        if (state.status === "retired") continue;
        const drained = await drainDirectory(root, directory, valid.value, options, started, logger2);
        result.acknowledged += drained.acknowledged;
        result.pending += drained.pending;
        if (drained.pending === 0) {
          atomicJson(join4(directory, "state.json"), {
            ...state,
            status: "retired",
            pendingNonces: [],
            observing: false,
            lastActivityMs: Date.now()
          });
          result.retired++;
        }
      } finally {
        await claim.release();
      }
    }
  } catch (error) {
    logger2?.warn(`git-span commit receipts: ${errorMessage(error)}`);
  }
  return result;
}
function cleanupMayAffect(directory, enrollment, host, sessionId) {
  let state;
  try {
    state = readState(directory, enrollment);
  } catch {
    return true;
  }
  if (Date.now() - state.lastActivityMs >= COMMIT_RECEIPT_LIMITS.abandonedRetentionMs) return true;
  if (enrollment.host !== host || enrollment.sessionId !== sessionId) return false;
  return state.status !== "active" && state.status !== "retired";
}
function receiptRoot(options) {
  return options.stateRoot ?? join4(homedir2(), ".cache", "git-span", "commit-receipts");
}
function errorMessage(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}
function readState(directory, enrollment) {
  const value = readJson(join4(directory, "state.json"));
  const stored = isRecord(value) ? validateCommitEnrollment(value.enrollment) : null;
  if (!isRecord(value) || stored === null || !stored.ok || stored.value.invocationKey !== enrollment.invocationKey || !isOneOf(COMMIT_INVOCATION_STATUSES, value.status) || !Array.isArray(value.pendingNonces) || value.pendingNonces.length > COMMIT_RECEIPT_LIMITS.receiptsPerInvocation || !value.pendingNonces.every((nonce) => typeof nonce === "string") || typeof value.observing !== "boolean" || typeof value.lastActivityMs !== "number" || !Number.isFinite(value.lastActivityMs))
    throw new Error("invalid private invocation lifecycle");
  return {
    enrollment: stored.value,
    status: value.status,
    pendingNonces: value.pendingNonces,
    observing: value.observing,
    lastActivityMs: value.lastActivityMs
  };
}
async function drainDirectory(root, directory, enrollment, options, started, logger2) {
  const deadline = started + COMMIT_RECEIPT_LIMITS.drainMs;
  let acknowledged = 0;
  const names = boundedEntries(join4(directory, "receipts"), COMMIT_RECEIPT_LIMITS.receiptsPerInvocation, deadline);
  for (const name of names) {
    if (performance.now() >= deadline) {
      logger2?.warn("git-span commit receipts: receipt drain deadline exhausted");
      break;
    }
    try {
      if (!/^observed-[a-f0-9]{64}-[a-f0-9]{40}(?:[a-f0-9]{24})?\.json$/.test(name))
        throw new Error("invalid receipt filename");
      const valid = validateCommitReceipt(readJson(join4(directory, "receipts", name)), enrollment);
      if (!valid.ok) throw new Error(valid.reason);
      const classification = await inspectCommitSpanMetadata(
        enrollment.gitExecutable,
        valid.value.repository.cwd,
        valid.value.sha,
        deadline,
        valid.value.repository.gitDirectory
      );
      if (classification === "metadata-only") {
        if (performance.now() >= deadline) throw new Error("receipt drain deadline exhausted before acknowledgment");
        rmSync3(join4(directory, "receipts", name));
        acknowledged++;
        continue;
      }
      const document = createCommitNoteDocument(enrollment);
      const association = await acquireReceiptClaim(
        root,
        `association-${commitAssociationKey(valid.value, document)}`,
        deadline,
        options.lockExecutable
      );
      if (!association) throw new Error("commit association ownership unavailable");
      try {
        const list = await invokeNotes(
          enrollment,
          valid.value,
          options,
          ["list", valid.value.sha, "--exact", "--format", "json"],
          void 0,
          started
        );
        const existing = validateCommitNotesList(JSON.parse(list), valid.value.sha);
        if (!existing.ok) throw new Error(existing.reason);
        const selected = selectCommitAssociation(document, existing.value);
        if (selected.kind === "reject") throw new Error(selected.reason);
        if (selected.kind === "reuse") {
          if (selected.locatorConflict)
            logger2?.warn("git-span commit receipts: conflicting transcript locator; existing association retained");
        } else {
          const added = await invokeNotes(
            enrollment,
            valid.value,
            options,
            ["add", valid.value.sha, "--format", "json"],
            serializeCommitNoteDocument(selected.document),
            started
          );
          const confirmation = validateCommitNotesAdd(JSON.parse(added), valid.value.sha, selected.document);
          if (!confirmation.ok) throw new Error(confirmation.reason);
        }
        if (performance.now() >= deadline) throw new Error("receipt drain deadline exhausted before acknowledgment");
        rmSync3(join4(directory, "receipts", name));
        acknowledged++;
      } finally {
        await association.release();
      }
    } catch (error) {
      logger2?.warn(`git-span commit receipts: ${errorMessage(error)}`);
    }
  }
  const pendingNames = boundedEntries(join4(directory, "receipts"), COMMIT_RECEIPT_LIMITS.receiptsPerInvocation);
  const state = readState(directory, enrollment);
  atomicJson(join4(directory, "state.json"), {
    ...state,
    status: pendingNames.length === 0 ? "acknowledged" : "completed",
    pendingNonces: pendingNames.map((name) => name.replace(/\.json$/, "")),
    observing: false,
    lastActivityMs: Date.now()
  });
  return { acknowledged, pending: pendingNames.length };
}
async function invokeNotes(enrollment, receipt, options, args, stdin, started) {
  const timeoutMs = commitCliBudgetMs(started, performance.now());
  if (timeoutMs <= 0) throw new Error("receipt drain deadline exhausted");
  const resolved = options.notesExecutable === void 0 ? resolveGitSpanCommand(["notes", ...args], receipt.repository.commonDirectory, enrollment.gitExecutable) : { executable: options.notesExecutable, argv: ["notes", ...args] };
  const command = {
    cwd: receipt.repository.commonDirectory,
    argv: resolved.argv,
    ...stdin === void 0 ? {} : { stdin },
    timeoutMs,
    maxOutputBytes: 1048576
  };
  const result = await (options.notesIO?.execute(command) ?? executeCommitNotes(resolved.executable, command));
  if (result.exitCode !== 0 || result.signal !== null || result.timedOut || result.outputExceeded)
    throw new Error(
      result.timedOut ? "notes CLI timed out; receipt retained" : "notes CLI unavailable or failed; receipt retained"
    );
  return result.stdout;
}

// packages/agent-hooks/src/common/review-lookup.ts
function reviewError(err) {
  return (err instanceof Error ? err.message : "could not read commit notes").slice(0, 512);
}
function decodeReviewNotes(envelope) {
  if (!isRecord(envelope) || envelope.schema_version !== 1 || envelope.operation !== "list" || Object.keys(envelope).some((key2) => !["schema_version", "operation", "notes"].includes(key2)))
    throw new Error("invalid versioned notes list envelope");
  return decodeReviewNoteArray(envelope.notes);
}
function decodeReviewNoteArray(value) {
  if (!Array.isArray(value)) throw new Error("invalid captured notes");
  const ids = /* @__PURE__ */ new Set();
  return value.map((note) => {
    if (!isRecord(note) || Object.keys(note).length !== 3 || !Number.isSafeInteger(note.id) || typeof note.id !== "number" || note.id <= 0 || typeof note.commit_sha !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(note.commit_sha) || !Object.hasOwn(note, "document") || ids.has(note.id))
      throw new Error("invalid captured note tuple");
    ids.add(note.id);
    return { id: note.id, commit_sha: note.commit_sha, document: note.document };
  });
}
function noteBelongsToSession(note, scope) {
  if (scope.host === "antigravity" || scope.host === "opencode") return true;
  if (!isRecord(note.document)) return false;
  const doc = note.document;
  return doc.schemaVersion === 1 && doc.host === scope.host && doc.sessionId === scope.sessionId || doc.kind === "git-span/uncovered-commit" && doc.schema_version === 1 && doc.session_id === scope.sessionId && (doc.host === void 0 || doc.host === scope.host);
}
function reviewRepositories(scope) {
  const repositories = /* @__PURE__ */ new Set();
  for (const directory of /* @__PURE__ */ new Set([scope.cwd, ...scope.workspacePaths ?? []])) {
    if (!directory) continue;
    const root = resolveRepoRoot(directory);
    if (root) repositories.add(root);
    if (repositories.size > 32) throw new Error("review repository budget exceeded");
  }
  return [...repositories];
}
async function hasReviewNotes(scope, logger2, io) {
  const deadline = performance.now() + 5e3;
  try {
    const repositories = [];
    for (const cwd of reviewRepositories(scope)) {
      if (performance.now() >= deadline) throw new Error("note lookup deadline exhausted");
      const resolved = resolveGitSpanCommand(["notes", "list", "--format", "json"], cwd);
      const command = {
        cwd,
        argv: resolved.argv,
        timeoutMs: Math.max(1, Math.floor(deadline - performance.now())),
        maxOutputBytes: 1048576
      };
      const result = await (io?.execute(command) ?? executeCommitNotes(resolved.executable, command));
      if (result.exitCode !== 0 || result.signal !== null || result.timedOut || result.outputExceeded)
        throw new Error("notes CLI unavailable, failed, or exceeded lookup bounds");
      const notes = decodeReviewNotes(JSON.parse(result.stdout)).filter((note) => noteBelongsToSession(note, scope));
      if (notes.length) repositories.push({ cwd, notes });
    }
    return repositories.length ? { kind: "matching", repositories } : { kind: "empty" };
  } catch (err) {
    logger2.warn("git-span could not read commit notes", { err });
    return { kind: "failure", reason: reviewError(err) };
  }
}

// packages/agent-hooks/src/common/review-notes-stop.ts
function reviewNotesPrompt(scope) {
  const skill = scope.host === "claude" || scope.host === "codex" ? "git-span:review-notes" : "review-notes";
  const worker = `Load the ${skill} skill. Use commit notes to identify decision-changing contracts, implicit couplings and useful reminders. Extend existing spans where applicable; create new spans where coverage is missing. Validate anchors and whys against the current tree, and remove only successfully processed notes. Leave edits unstaged.`;
  return [
    "Dispatch a forked subagent with this prompt:",
    JSON.stringify(worker),
    "Wait for the subagent. Summarize spans created or updated, validation results, retained notes and incomplete scope in your final response."
  ].join("\n");
}
async function reviewNotesStopStatus(input, host, logger2, check = hasReviewNotes) {
  if (input.stop_hook_active) return {};
  let outcome;
  try {
    outcome = await check({ host, sessionId: input.session_id, cwd: input.cwd }, logger2);
  } catch (err) {
    outcome = { kind: "failure", reason: reviewError(err) };
  }
  if (outcome.kind === "empty") return {};
  if (outcome.kind === "matching") {
    return { reason: reviewNotesPrompt({ host, sessionId: input.session_id, cwd: input.cwd }) };
  }
  return { message: `git-span could not read commit notes: ${outcome.reason.slice(0, 512)}` };
}

// packages/agent-hooks/src/common/update-check-env.ts
function disableUpdateCheck() {
  process.env.GIT_SPAN_DISABLE_UPDATE_CHECK = "1";
}

// packages/agent-hooks/src/codex/stop.ts
function createHandler(layout = DEFAULT_SESSION_LAYOUT, runtimeOptions = {}, check) {
  return async (input, ctx) => {
    const status = await reviewNotesStopStatus(input, "codex", ctx.logger, check);
    if (status.reason) return stopOutput({ decision: "block", reason: status.reason });
    if (status.message) return stopOutput({ systemMessage: status.message });
    try {
      await cleanupCommitInvocations(
        "codex",
        input.session_id,
        { stateRoot: join5(dirname5(layout.base), "commit-receipts"), ...runtimeOptions },
        ctx.logger
      );
    } catch (err) {
      ctx.logger.warn("git-span completed commit receipt cleanup failed", { err });
    }
    try {
      cleanupSessionState(layout, input.session_id);
      return void 0;
    } catch (err) {
      ctx.logger.warn("git-span stop cleanup failed open on an uncaught error", { err });
      return void 0;
    }
  };
}
disableUpdateCheck();
var stop_default = stopHook({ timeout: 1e4 }, createHandler());

// packages/agent-hooks/src/codex/stop-entry.ts
execute(stop_default);

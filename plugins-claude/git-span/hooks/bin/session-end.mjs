#!/usr/bin/env -S node --enable-source-maps
import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __pathDirname } from "node:path";
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);

// packages/agent-hooks/src/claude/session-end.ts
import { dirname as dirname4, join as join5 } from "node:path";

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

// node_modules/@goodfoot/agent-hooks/dist/core/env.js
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

// node_modules/@goodfoot/agent-hooks/dist/agents/claude-code/events.js
var HOOK_EVENT_NAMES = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "Notification",
  "UserPromptExpansion",
  "UserPromptSubmit",
  "SessionStart",
  "SessionEnd",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
  "PermissionRequest",
  "PermissionDenied",
  "Setup",
  "TeammateIdle",
  "TaskCreated",
  "TaskCompleted",
  "Elicitation",
  "ElicitationResult",
  "ConfigChange",
  "InstructionsLoaded",
  "WorktreeCreate",
  "WorktreeRemove",
  "CwdChanged",
  "FileChanged",
  "MessageDisplay"
];
var EXCLUDED_FROM_ADVISORY = [
  "PreToolUse",
  "PermissionRequest",
  "Stop",
  "SubagentStop",
  "WorktreeCreate",
  "WorktreeRemove"
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

// node_modules/@goodfoot/agent-hooks/dist/agents/claude-code/hooks.js
var advisoryPolicyGate = (eventName, policy) => policy !== "continue" || ADVISORY_EVENTS.includes(eventName);
function createSessionStartContext() {
  return { logger, persistEnvVar, persistEnvVars };
}
function createHookFunction(hookEventName, config, handler) {
  const isSessionStart = hookEventName === "SessionStart";
  return defineHook(hookEventName, isSessionStart ? { ...config, createContext: createSessionStartContext } : config, handler, advisoryPolicyGate);
}
function sessionEndHook(config, handler) {
  return createHookFunction("SessionEnd", config, handler);
}

// node_modules/@goodfoot/agent-hooks/dist/agents/claude-code/outputs.js
var EXIT_CODES = {
  /** Handler completed successfully. Claude Code parses stdout as JSON. */
  SUCCESS: 0,
  /** Non-blocking error occurred (e.g., invalid input). stderr shown to user only. */
  ERROR: 1,
  /** Handler threw exception OR blocking action requested. stderr shown to Claude. */
  BLOCK: 2
};

// node_modules/@goodfoot/agent-hooks/dist/core/stdin.js
async function readStdin() {
  return new Promise((resolve4, reject2) => {
    const chunks = [];
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      chunks.push(chunk);
    });
    process.stdin.on("end", () => {
      resolve4(chunks.join(""));
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
  return new Promise((resolve4, reject2) => {
    stream.write(content, (error) => error ? reject2(error) : resolve4());
  });
}
async function writeUnexpectedErrorStderr(error) {
  const content = error instanceof Error ? `${error.stack ?? error.message}
` : `${String(error)}
`;
  await writeStream(process.stderr, content);
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

// node_modules/@goodfoot/agent-hooks/dist/agents/claude-code/transport.js
var BLOCK_SHAPE_BY_EVENT = {
  PermissionRequest: (reason) => ({
    hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: reason } }
  }),
  PreToolUse: (reason) => ({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
  })
};
function translateBlockToPayload(eventName, error) {
  const reason = error.message;
  const known = HOOK_EVENT_NAMES.includes(eventName) ? eventName : void 0;
  const payload = known !== void 0 ? BLOCK_SHAPE_BY_EVENT[known]?.(reason) ?? { continue: false, stopReason: reason } : { continue: false, stopReason: reason };
  if (error.fields !== void 0) {
    Object.assign(payload, error.fields);
  }
  return payload;
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
function formatErrorText(error) {
  return error instanceof Error ? `${error.stack ?? error.message}
` : `${String(error)}
`;
}
function detectRawStdout(output) {
  if (output._type === "WorktreeCreate" || output._type === "WorktreeRemove") {
    return output.rawStdout;
  }
  return void 0;
}
function createClaudeCodeTransport(eventName, policy, onUnexpectedError) {
  return {
    finalize(outcome) {
      switch (outcome.kind) {
        case "response": {
          const converted = outcome.output === null || outcome.output === void 0 ? void 0 : convertToHookOutput(outcome.output);
          if (converted?.stderr !== void 0) {
            return { stderr: converted.stderr, exitCode: EXIT_CODES.BLOCK };
          }
          let serializedText;
          try {
            serializedText = converted?.rawStdout !== void 0 ? converted.rawStdout : JSON.stringify(converted?.stdout ?? {});
          } catch (error) {
            logger.logError(error, "Failed to serialize hook output");
            if (policy !== "continue") {
              return { stderr: formatErrorText(error), exitCode: EXIT_CODES.ERROR };
            }
            onUnexpectedError?.(error, "serialize");
            serializedText = "{}";
          }
          return { stdout: serializedText, exitCode: EXIT_CODES.SUCCESS };
        }
        case "rawStdout":
          return { stdout: outcome.stdout, exitCode: EXIT_CODES.SUCCESS };
        case "block": {
          return {
            stdout: JSON.stringify(translateBlockToPayload(eventName, outcome.error)),
            exitCode: EXIT_CODES.SUCCESS
          };
        }
        case "handlerError": {
          if (outcome.phase === "read" || outcome.phase === "parse") {
            logger.error(`Invalid JSON input: ${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}`);
            return { stdout: "{}", exitCode: EXIT_CODES.SUCCESS };
          }
          logger.error(`Hook handler error: ${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}`);
          return { stderr: formatErrorText(outcome.error), exitCode: EXIT_CODES.BLOCK };
        }
      }
    },
    rawStdout: detectRawStdout
  };
}
async function execute(hookFn) {
  const policy = hookFn.unexpectedError ?? "error";
  const transport = createClaudeCodeTransport(hookFn.eventName, policy, hookFn.onUnexpectedError);
  await drive(transport, hookFn);
}

// packages/agent-hooks/src/common/agent-hooks-common.ts
import { execFileSync } from "node:child_process";
import * as fs2 from "node:fs";
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
    fs2.mkdirSync(layout.trashDir, { recursive: true, mode: 448 });
    const trashPath = nodePath.join(
      layout.trashDir,
      `${sanitizeSessionId(sessionId)}${SESSION_TRASH_MARKER}${process.pid}-${now.toString(36)}`
    );
    fs2.renameSync(dirPath, trashPath);
    fs2.utimesSync(trashPath, now / 1e3, now / 1e3);
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") throw error;
  }
}

// packages/agent-hooks/src/common/commit-runtime.ts
import { randomBytes as randomBytes2 } from "node:crypto";
import { chmodSync, existsSync as existsSync5, lstatSync as lstatSync3, readFileSync as readFileSync2, realpathSync as realpathSync3, rmSync as rmSync3, writeFileSync as writeFileSync2 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { isAbsolute as isAbsolute5, join as join4 } from "node:path";

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
  receiptsPerInvocation: 256,
  bytesPerInvocation: 4194304,
  invocations: 4096,
  totalBytes: 67108864,
  abandonedRetentionMs: 864e5,
  drainMs: 3e3,
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

// packages/agent-hooks/src/common/commit-git.ts
import { isAbsolute as isAbsolute2, resolve as resolve2 } from "node:path";

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
import {
  accessSync,
  closeSync as closeSync2,
  constants,
  existsSync as existsSync3,
  fstatSync,
  lstatSync,
  openSync as openSync2,
  readSync,
  realpathSync as realpathSync2
} from "node:fs";
import { delimiter, isAbsolute as isAbsolute3, join as join2, resolve as resolve3 } from "node:path";
import { StringDecoder } from "node:string_decoder";
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

// packages/agent-hooks/src/common/commit-storage.ts
import { createHash as createHash2, randomBytes } from "node:crypto";
import {
  closeSync as closeSync3,
  existsSync as existsSync4,
  linkSync,
  lstatSync as lstatSync2,
  mkdirSync as mkdirSync3,
  opendirSync,
  openSync as openSync3,
  readFileSync,
  renameSync as renameSync2,
  rmSync as rmSync2,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname as dirname3, isAbsolute as isAbsolute4, join as join3 } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
function privateDirectory(path) {
  if (!isAbsolute4(path)) throw new Error("receipt state root must be absolute");
  mkdirSync3(path, { recursive: true, mode: 448 });
  const stat = lstatSync2(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 63) !== 0 || process.getuid && stat.uid !== process.getuid()) {
    throw new Error("receipt directory is not private");
  }
}
function readJson(path, maximumBytes = COMMIT_RECEIPT_LIMITS.jsonFileBytes) {
  const stat = lstatSync2(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumBytes)
    throw new Error("invalid bounded receipt file");
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return parsed;
}
function atomicJson(path, value, immutable = false) {
  const temporary = join3(dirname3(path), `.publish-${randomBytes(16).toString("hex")}`);
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
async function acquireReceiptClaim(root, key2, deadline) {
  if (!/^[a-zA-Z0-9_-]+$/.test(key2)) throw new Error("invalid receipt claim key");
  const directory = join3(root, "claims");
  privateDirectory(directory);
  const path = join3(directory, `${key2}.json`);
  const guard = join3(directory, `${key2}.guard`);
  const owner = { token: randomBytes(16).toString("hex"), pid: process.pid };
  while (performance.now() < deadline) {
    let guarded = false;
    try {
      try {
        mkdirSync3(guard, { mode: 448 });
        guarded = true;
      } catch (error) {
        if (errnoCode(error) !== "EEXIST") throw error;
        return null;
      }
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
        return {
          owner,
          release: () => {
            let releaseGuard = false;
            try {
              mkdirSync3(guard, { mode: 448 });
              releaseGuard = true;
              const current = ownerRecord(readJson(path, 4096));
              if (current?.token !== owner.token || current.pid !== owner.pid)
                throw new Error("receipt claim ownership changed");
              unlinkSync(path);
            } finally {
              if (releaseGuard) rmSync2(guard, { recursive: true });
            }
          }
        };
      }
      if (decision === "refuse") return null;
    } finally {
      if (guarded) rmSync2(guard, { recursive: true });
    }
    await delay(Math.min(20, Math.max(0, deadline - performance.now())));
  }
  return null;
}
function usageRecord(value) {
  if (!isRecord(value)) return null;
  const { invocations, totalBytes } = value;
  return typeof invocations === "number" && Number.isSafeInteger(invocations) && invocations >= 0 && typeof totalBytes === "number" && Number.isSafeInteger(totalBytes) && totalBytes >= 0 ? { invocations, totalBytes } : null;
}
async function reserveReceiptCapacity(root, invocationDelta, byteDelta, deadline) {
  const claim = await acquireReceiptClaim(root, "capacity", deadline);
  if (!claim) return false;
  try {
    const path = join3(root, "usage.json");
    const usage = existsSync4(path) ? usageRecord(readJson(path, 4096)) : { invocations: 0, totalBytes: 0 };
    if (usage === null) return false;
    const next = { invocations: usage.invocations + invocationDelta, totalBytes: usage.totalBytes + byteDelta };
    if (next.invocations < 0 || next.invocations > COMMIT_RECEIPT_LIMITS.invocations || next.totalBytes < 0 || next.totalBytes > COMMIT_RECEIPT_LIMITS.totalBytes)
      return false;
    atomicJson(path, next);
    return true;
  } finally {
    claim.release();
  }
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
      const claim = await acquireReceiptClaim(root, `invocation-${key2}`, deadline);
      if (!claim) {
        logger2?.warn("git-span commit receipts: cleanup invocation ownership unavailable");
        continue;
      }
      try {
        const state = readState(directory, valid.value);
        const abandoned = Date.now() - state.lastActivityMs >= COMMIT_RECEIPT_LIMITS.abandonedRetentionMs;
        if (abandoned && (state.status !== "active" || !invocationIsLive(directory))) {
          const usage = readUsage(directory);
          logger2?.warn("git-span commit receipts: expired abandoned state and pending evidence");
          if (await reserveReceiptCapacity(root, -1, -usage.bytes, deadline)) {
            rmSync3(directory, { recursive: true });
            result.retired++;
          }
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
            liveLease: false,
            lastActivityMs: Date.now()
          });
          result.retired++;
        }
      } finally {
        claim.release();
      }
    }
  } catch (error) {
    logger2?.warn(`git-span commit receipts: ${errorMessage(error)}`);
  }
  return result;
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
  if (!isRecord(value) || stored === null || !stored.ok || stored.value.invocationKey !== enrollment.invocationKey || !isOneOf(COMMIT_INVOCATION_STATUSES, value.status) || !Array.isArray(value.pendingNonces) || value.pendingNonces.length > COMMIT_RECEIPT_LIMITS.receiptsPerInvocation || !value.pendingNonces.every((nonce) => typeof nonce === "string") || typeof value.liveLease !== "boolean" || typeof value.lastActivityMs !== "number" || !Number.isFinite(value.lastActivityMs))
    throw new Error("invalid private invocation lifecycle");
  return {
    enrollment: stored.value,
    status: value.status,
    pendingNonces: value.pendingNonces,
    liveLease: value.liveLease,
    lastActivityMs: value.lastActivityMs
  };
}
function readUsage(directory) {
  const usage = readJson(join4(directory, "usage.json"), 4096);
  if (!isRecord(usage) || typeof usage.bytes !== "number" || !Number.isSafeInteger(usage.bytes) || usage.bytes < 0 || typeof usage.receipts !== "number" || !Number.isSafeInteger(usage.receipts) || usage.receipts < 0)
    throw new Error("invalid invocation usage");
  return { bytes: usage.bytes, receipts: usage.receipts };
}
function invocationIsLive(directory) {
  try {
    if (!existsSync5(join4(directory, "lease"))) return false;
    const lease = readFileSync2(join4(directory, "lease"), "utf8");
    if (lease === "") return false;
    const pid = Number(lease);
    if (!Number.isSafeInteger(pid) || pid <= 0) return true;
    return ownerLiveness({ token: "lease", pid }) !== "dead";
  } catch {
    return true;
  }
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
      if (!/^receipt-[a-f0-9]+\.json$/.test(name)) throw new Error("invalid receipt filename");
      const valid = validateCommitReceipt(readJson(join4(directory, "receipts", name)), enrollment);
      if (!valid.ok) throw new Error(valid.reason);
      const document = createCommitNoteDocument(enrollment);
      const association = await acquireReceiptClaim(
        root,
        `association-${commitAssociationKey(valid.value, document)}`,
        deadline
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
        const usage = readUsage(directory);
        const bytes = lstatSync3(join4(directory, "receipts", name)).size;
        rmSync3(join4(directory, "receipts", name));
        atomicJson(join4(directory, "usage.json"), {
          bytes: usage.bytes - bytes,
          receipts: Math.max(0, usage.receipts - 1)
        });
        await reserveReceiptCapacity(root, 0, -bytes, deadline);
        acknowledged++;
      } finally {
        association.release();
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
    liveLease: false,
    lastActivityMs: Date.now()
  });
  if (existsSync5(join4(directory, "diagnostics.json"))) {
    const diagnostics = readJson(join4(directory, "diagnostics.json"), 16384);
    if (Array.isArray(diagnostics)) {
      for (const message of diagnostics)
        if (typeof message === "string") logger2?.warn(`git-span commit receipts: ${message.slice(0, 512)}`);
    }
    rmSync3(join4(directory, "diagnostics.json"));
  }
  return { acknowledged, pending: pendingNames.length };
}
async function invokeNotes(enrollment, receipt, options, args, stdin, started) {
  const timeoutMs = commitCliBudgetMs(started, performance.now());
  if (timeoutMs <= 0) throw new Error("receipt drain deadline exhausted");
  const command = {
    cwd: receipt.repository.commonDirectory,
    argv: options.notesExecutable === void 0 ? ["span", "notes", ...args] : ["notes", ...args],
    ...stdin === void 0 ? {} : { stdin },
    timeoutMs,
    maxOutputBytes: 1048576
  };
  const result = await (options.notesIO?.execute(command) ?? executeCommitNotes(options.notesExecutable ?? enrollment.gitExecutable, command));
  if (result.exitCode !== 0 || result.signal !== null || result.timedOut || result.outputExceeded)
    throw new Error(
      result.timedOut ? "notes CLI timed out; receipt retained" : "notes CLI unavailable or failed; receipt retained"
    );
  return result.stdout;
}

// packages/agent-hooks/src/common/update-check-env.ts
function disableUpdateCheck() {
  process.env.GIT_SPAN_DISABLE_UPDATE_CHECK = "1";
}

// packages/agent-hooks/src/claude/session-end.ts
var createHandler = (layout = DEFAULT_SESSION_LAYOUT, runtimeOptions = {}) => async (input, ctx) => {
  try {
    await cleanupCommitInvocations(
      "claude",
      input.session_id,
      { stateRoot: join5(dirname4(layout.base), "commit-receipts"), ...runtimeOptions },
      ctx.logger
    );
  } catch (err) {
    ctx.logger.warn("git-span completed commit receipt cleanup failed", { err });
  }
  try {
    cleanupSessionState(layout, input.session_id);
    return null;
  } catch (err) {
    ctx.logger.warn("git-span session state cleanup failed open on an uncaught error", { err });
    return null;
  }
};
disableUpdateCheck();
var session_end_default = sessionEndHook({ timeout: 1e4 }, createHandler());

// packages/agent-hooks/src/claude/session-end-entry.ts
execute(session_end_default);

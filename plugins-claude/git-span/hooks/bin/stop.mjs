#!/usr/bin/env -S node --enable-source-maps
import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __pathDirname } from "node:path";
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);

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
function stopHook(config, handler) {
  return createHookFunction("Stop", config, handler);
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
function createDecisionOutputBuilder(hookType) {
  return (options = {}) => ({
    _type: hookType,
    stdout: options
  });
}
var stopOutput = /* @__PURE__ */ createDecisionOutputBuilder("Stop");

// node_modules/@goodfoot/agent-hooks/dist/core/stdin.js
async function readStdin() {
  return new Promise((resolve4, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      chunks.push(chunk);
    });
    process.stdin.on("end", () => {
      resolve4(chunks.join(""));
    });
    process.stdin.on("error", (error) => {
      reject(error);
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
  return new Promise((resolve4, reject) => {
    stream.write(content, (error) => {
      if (error)
        reject(error);
      else
        resolve4();
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
var lastOpportunisticPruneAt = Number.NEGATIVE_INFINITY;

// packages/agent-hooks/src/common/commit-native-io.ts
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import { delimiter, isAbsolute, join as join2, resolve as resolve2 } from "node:path";
import { StringDecoder } from "node:string_decoder";
function executableOnPath(name, cwd = process.cwd()) {
  const candidates = isAbsolute(name) ? [name] : (process.env.PATH ?? "").split(delimiter).map((directory) => resolve2(cwd, directory, name));
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

// packages/agent-hooks/src/common/git-span-command.ts
import { dirname as dirname3, resolve as resolve3 } from "node:path";
function resolveGitSpanCommand(argv, cwd = process.cwd(), gitExecutable = "git", platform = process.platform) {
  if (platform === "win32") {
    const extensions = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
    for (const directory of (process.env.PATH ?? "").split(";")) {
      for (const extension of extensions) {
        const candidate = resolve3(cwd, directory, `git-span${extension.toLowerCase()}`);
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

// packages/agent-hooks/src/common/review-lookup.ts
function reviewError(err) {
  return (err instanceof Error ? err.message : "could not read commit notes").slice(0, 512);
}
function decodeReviewNotes(envelope) {
  if (!isRecord(envelope) || envelope.schema_version !== 1 || envelope.operation !== "list" || Object.keys(envelope).some((key) => !["schema_version", "operation", "notes"].includes(key)))
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
  const worker = `Load the ${skill} skill. Review changed behavior and its consumers, then document residual implicit couplings using git-span. Return findings or patches to the parent; do not independently edit production requirements, stage, or commit. Intentional code does not supersede a requirement. Report metadata completion separately from material findings; retain disputed consequences.`;
  return [
    "Dispatch a forked subagent with this prompt:",
    JSON.stringify(worker),
    "Wait for the subagent. Include unresolved findings, incomplete scope and lookup failures in your final response. Review completion is not semantic approval."
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

// packages/agent-hooks/src/claude/stop.ts
function createHandler(check) {
  return async (input, ctx) => {
    const status = await reviewNotesStopStatus(
      { stop_hook_active: input.stop_hook_active, session_id: input.session_id, cwd: input.cwd },
      "claude",
      ctx.logger,
      check
    );
    return status.reason ? stopOutput({ decision: "block", reason: status.reason }) : status.message ? stopOutput({ systemMessage: status.message }) : null;
  };
}
disableUpdateCheck();
var stop_default = stopHook({ timeout: 1e4 }, createHandler());

// packages/agent-hooks/src/claude/stop-entry.ts
execute(stop_default);

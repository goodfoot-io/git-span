#!/usr/bin/env -S node --enable-source-maps
// node_modules/@goodfoot/agent-hooks/dist/agents/antigravity/events.js
var HOOK_EVENT_NAMES = [
  "PreToolUse",
  "PostToolUse",
  "PreInvocation",
  "PostInvocation",
  "Stop"
];
var EXCLUDED_FROM_ADVISORY = [...HOOK_EVENT_NAMES];
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

// node_modules/@goodfoot/agent-hooks/dist/agents/antigravity/hooks.js
var advisoryPolicyGate = (eventName, policy) => policy !== "continue" || ADVISORY_EVENTS.includes(eventName);
function bindHook(event, config, handler) {
  const coreConfig = {
    matcher: config.matcher,
    timeout: config.timeout,
    unexpectedError: config.unexpectedError,
    onUnexpectedError: config.onUnexpectedError
  };
  const bound = defineHook(event, coreConfig, handler, advisoryPolicyGate);
  bound.hookEventName = event;
  return bound;
}
function preToolUseHook(config, handler) {
  return bindHook("PreToolUse", config, handler);
}

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

// node_modules/@goodfoot/agent-hooks/dist/core/stdin.js
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
function writeUnexpectedErrorStderr(error) {
  if (error instanceof Error) {
    process.stderr.write(`${error.stack ?? error.message}
`);
  } else {
    process.stderr.write(`${String(error)}
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
    writeUnexpectedErrorStderr(error);
    cleanupQuietly();
    process.exit(FALLBACK_EXIT_ERROR);
  }
  try {
    cleanup(policy, onUnexpectedError);
  } catch (error) {
    writeUnexpectedErrorStderr(error);
    process.exit(FALLBACK_EXIT_ERROR);
  }
  if (finalized.stderr !== void 0) {
    process.stderr.write(finalized.stderr);
  }
  if (finalized.stdout !== void 0) {
    try {
      process.stdout.write(finalized.stdout);
    } catch (error) {
      if (policy === "continue") {
        reportUnexpectedError(onUnexpectedError, error, "write");
        cleanupQuietly();
        process.exit(FALLBACK_EXIT_SUCCESS);
      }
      writeUnexpectedErrorStderr(error);
      cleanupQuietly();
      process.exit(FALLBACK_EXIT_ERROR);
    }
  }
  process.exit(finalized.exitCode);
}

// node_modules/@goodfoot/agent-hooks/dist/agents/antigravity/outputs.js
var EXIT_CODES = {
  SUCCESS: 0
};
var AntigravityBlockError = class extends HookBlockError {
  reason;
  constructor(reason) {
    super(reason);
    this.name = "AntigravityBlockError";
    this.reason = reason;
  }
};

// node_modules/@goodfoot/agent-hooks/dist/agents/antigravity/transport.js
function formatErrorText(error) {
  return error instanceof Error ? `${error.stack ?? error.message}
` : `${String(error)}
`;
}
function createAntigravityTransport() {
  return {
    finalize(outcome) {
      switch (outcome.kind) {
        case "response":
        case "rawStdout": {
          const stdoutJson = outcome.kind === "response" && outcome.output !== null && outcome.output !== void 0 ? JSON.stringify(outcome.output.stdout) : "{}";
          return { stdout: stdoutJson, exitCode: EXIT_CODES.SUCCESS };
        }
        case "block": {
          const reason = outcome.error instanceof AntigravityBlockError ? outcome.error.reason : outcome.error.message;
          const fields = outcome.error.fields ?? {};
          return { stdout: JSON.stringify({ decision: "deny", reason, ...fields }), exitCode: EXIT_CODES.SUCCESS };
        }
        case "handlerError": {
          return {
            stderr: formatErrorText(outcome.error),
            stdout: "{}",
            exitCode: EXIT_CODES.SUCCESS
          };
        }
      }
    }
  };
}
async function execute(hookFn) {
  await drive(createAntigravityTransport(), hookFn);
}

// src/common/agent-hooks-common.ts
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
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

// src/common/update-check-env.ts
function disableUpdateCheck() {
  process.env.GIT_SPAN_DISABLE_UPDATE_CHECK = "1";
}

// src/antigravity/stash.ts
import { randomBytes } from "node:crypto";
import * as fs2 from "node:fs";
import * as nodePath2 from "node:path";
function toolCallDir(layout, conversationId) {
  return nodePath2.join(layout.dir(conversationId), "antigravity-tool-calls");
}
function writeAtomic(target, content) {
  const tmp = `${target}.tmp-${process.pid}-${randomBytes(3).toString("hex")}`;
  fs2.writeFileSync(tmp, content);
  fs2.renameSync(tmp, target);
}
function stashToolCall(layout, conversationId, stepIdx, toolCall) {
  const dir = toolCallDir(layout, conversationId);
  fs2.mkdirSync(dir, { recursive: true });
  writeAtomic(
    nodePath2.join(dir, `${stepIdx}.json`),
    `${JSON.stringify({ name: toolCall.name, args: toolCall.args })}
`
  );
}

// src/antigravity/tool-call-stash.ts
function createHandler(layout = DEFAULT_SESSION_LAYOUT) {
  return async (input, ctx) => {
    try {
      stashToolCall(layout, input.conversationId, input.stepIdx, input.toolCall);
      return void 0;
    } catch (err) {
      ctx.logger.warn("git-span tool-call stash failed open; this call loses attribution", { err });
      return void 0;
    }
  };
}
disableUpdateCheck();
var tool_call_stash_default = preToolUseHook({ matcher: "run_command", timeout: 1e4 }, createHandler());

// src/antigravity/tool-call-stash-entry.ts
execute(tool_call_stash_default);

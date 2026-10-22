#!/usr/bin/env -S node --enable-source-maps
// packages/agent-hooks/src/codex/apply-patch-plan.ts
import * as fs8 from "node:fs";

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
function preToolUseHook(config, handler) {
  return createHookFunction("PreToolUse", config, handler);
}
function postToolUseHook(config, handler) {
  return createHookFunction("PostToolUse", config, handler);
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
function postToolUseOutput(options = {}) {
  const hasSpecific = options.additionalContext !== void 0 || options.updatedMCPToolOutput !== void 0;
  const hookSpecificOutput = hasSpecific ? omitUndefined({
    hookEventName: "PostToolUse",
    additionalContext: options.additionalContext,
    updatedMCPToolOutput: options.updatedMCPToolOutput
  }) : void 0;
  return buildOutput("PostToolUse", {
    continue: options.continue,
    stopReason: options.stopReason,
    suppressOutput: options.suppressOutput,
    systemMessage: options.systemMessage,
    decision: options.decision,
    reason: options.reason,
    hookSpecificOutput
  });
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

// packages/agent-hooks/src/common/fail-open.ts
var FAIL_OPEN_MESSAGE = "git-span failed open";
var MAX_PENDING_FAIL_OPEN = 32;
var counts = /* @__PURE__ */ new Map();
var pending = [];
var droppedPending = 0;
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function emit(logger2, event) {
  logger2.warn(FAIL_OPEN_MESSAGE, { ...event.context, site: event.site, error: event.error, count: event.count });
}
function flushFailOpen(logger2) {
  for (const event of pending.splice(0)) emit(logger2, event);
  if (droppedPending > 0) {
    logger2.warn(FAIL_OPEN_MESSAGE, { site: "fail-open-queue", dropped: droppedPending });
    droppedPending = 0;
  }
}
function reportFailOpen(logger2, site, error, context = {}) {
  const count = (counts.get(site) ?? 0) + 1;
  counts.set(site, count);
  const event = { site, error: errorMessage(error), count, context: { ...context, err: error } };
  if (logger2 === void 0) {
    if (pending.length < MAX_PENDING_FAIL_OPEN) pending.push(event);
    else droppedPending += 1;
    return event;
  }
  flushFailOpen(logger2);
  emit(logger2, event);
  return event;
}

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
function caughtProperty(error, key2) {
  return isRecord(error) ? error[key2] : void 0;
}
function isOneOf(tokens, value) {
  return tokens.some((token) => token === value);
}

// packages/agent-hooks/src/common/agent-hooks-common.ts
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
    let current2 = fs.realpathSync.native(dir);
    for (; ; ) {
      if (fs.existsSync(nodePath.join(current2, ".git"))) return toPosix(current2);
      const parent = nodePath.dirname(current2);
      if (parent === current2) break;
      current2 = parent;
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
  const envDir = process.env.GIT_SPAN_DIR;
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
    const status = err instanceof Error && "status" in err ? err.status : void 0;
    if (status !== 1) reportFailOpen(void 0, "span-root-config", err, { repoRoot });
  }
  return SPAN_ROOT;
}
function isInsideSpanRoot(repoRelPath, spanRoot = SPAN_ROOT) {
  const root2 = spanRoot.replace(/\/+$/, "");
  return repoRelPath === root2 || repoRelPath.startsWith(`${root2}/`);
}
function isGitIgnored(repoRoot, repoRelPath) {
  try {
    execFileSync("git", ["-C", repoRoot, "check-ignore", "-q", "--", repoRelPath], {
      stdio: ["ignore", "ignore", "ignore"]
    });
    return true;
  } catch (err) {
    void err;
    return false;
  }
}
function relativeToRepo(repoRoot, absPath) {
  const root2 = toPosix(repoRoot);
  const abs = toPosix(absPath);
  const prefix = root2.endsWith("/") ? root2 : `${root2}/`;
  return abs.startsWith(prefix) ? abs.slice(prefix.length) : abs;
}
function canonicalizePath(absPath) {
  try {
    return toPosix(fs.realpathSync.native(absPath));
  } catch {
    try {
      const dir = toPosix(fs.realpathSync.native(nodePath.dirname(absPath)));
      return `${dir}/${nodePath.basename(absPath)}`;
    } catch {
      return absPath;
    }
  }
}
function resolveFrame(workdir, directory) {
  if (workdir === void 0 || workdir.length === 0 || /[$`]/.test(workdir)) return directory;
  return nodePath.resolve(directory, workdir);
}
function rangesIntersect(a, b) {
  return a.start <= b.end && a.end >= b.start;
}
function parsePorcelain(stdout) {
  const rows = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [name, path, range] = trimmed.split("	");
    if (name === void 0 || path === void 0 || range === void 0) continue;
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
function sanitizeSessionId(sessionId2) {
  return sessionId2.replace(/[^A-Za-z0-9._-]/g, (ch) => {
    return `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
  });
}
function createSessionLayout(base) {
  const dir = (sessionId2) => nodePath.join(base, sanitizeSessionId(sessionId2));
  const plannedTouchesDir = (sessionId2) => nodePath.join(dir(sessionId2), "planned-touches");
  const plannedTouchFile = (sessionId2, toolUseId, suffix) => nodePath.join(plannedTouchesDir(sessionId2), `${sanitizeSessionId(toolUseId)}${suffix}`);
  return Object.freeze({
    base,
    trashDir: nodePath.join(nodePath.dirname(base), "session-trash"),
    dir,
    memoFile: (sessionId2) => nodePath.join(dir(sessionId2), "touch-memo.json"),
    plannedTouchesDir,
    plannedTouchRecordFile: (sessionId2, toolUseId) => plannedTouchFile(sessionId2, toolUseId, ".json"),
    plannedTouchConsumedFile: (sessionId2, toolUseId) => plannedTouchFile(sessionId2, toolUseId, ".consumed")
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
    for (const entry of fs.readdirSync(layout.trashDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.includes(SESSION_TRASH_MARKER)) continue;
      const trashPath = nodePath.join(layout.trashDir, entry.name);
      try {
        const stat = fs.statSync(trashPath);
        if (now - stat.mtimeMs > SESSION_TRASH_TTL_MS) {
          fs.rmSync(trashPath, { recursive: true, force: true });
        }
      } catch (err) {
        void err;
      }
    }
  } catch (err) {
    void err;
  }
  let entries;
  try {
    entries = fs.readdirSync(layout.base, { withFileTypes: true });
  } catch {
    return;
  }
  let trashDirReady = false;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = nodePath.join(layout.base, entry.name);
    try {
      const stat = fs.statSync(dirPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        if (!trashDirReady) {
          fs.mkdirSync(layout.trashDir, { recursive: true, mode: 448 });
          trashDirReady = true;
        }
        const trashPath = nodePath.join(
          layout.trashDir,
          `${entry.name}${SESSION_TRASH_MARKER}${process.pid}-${Date.now().toString(36)}`
        );
        fs.renameSync(dirPath, trashPath);
        fs.utimesSync(trashPath, now / 1e3, now / 1e3);
      }
    } catch (err) {
      void err;
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

// packages/agent-hooks/src/common/bash-attribution.ts
import { createHash as createHash3 } from "node:crypto";
import * as fs6 from "node:fs";
import * as nodePath5 from "node:path";

// packages/agent-hooks/src/common/span-surface.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import * as fs3 from "node:fs";
import * as nodePath3 from "node:path";

// packages/agent-hooks/src/common/git-span-command.ts
import { dirname as dirname3, resolve as resolve3 } from "node:path";

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
function probe(executable, argv, cwd) {
  const result = spawnSync(executable, [...argv], {
    cwd,
    encoding: "utf8",
    timeout: 1e3,
    maxBuffer: 65536,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error || result.status !== 0) throw new Error("Git repository probe failed");
  return result.stdout.trimEnd();
}
function prefixDigest(descriptor, length) {
  const bytes = Buffer.alloc(Math.min(length, 4096));
  let offset2 = 0;
  while (offset2 < bytes.length) {
    const count = readSync(descriptor, bytes, offset2, bytes.length - offset2, length - bytes.length + offset2);
    if (count === 0) throw new Error("reflog prefix truncated");
    offset2 += count;
  }
  return createHash("sha256").update(bytes).digest("hex");
}
function readCommitReflogAppend(path, checkpoint, maxBytes) {
  if (!existsSync3(path)) return null;
  const descriptor = openSync2(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw new Error("HEAD reflog is not a file");
    if (checkpoint.existed && prefixDigest(descriptor, checkpoint.offset) !== checkpoint.prefixDigest)
      throw new Error("observed reflog prefix changed");
    const length = stat.size - checkpoint.offset;
    const exceededBudget = length > maxBytes;
    const bytes = Buffer.alloc(Math.max(0, Math.min(length, maxBytes)));
    let offset2 = 0;
    while (offset2 < bytes.length) {
      const count = readSync(descriptor, bytes, offset2, bytes.length - offset2, checkpoint.offset + offset2);
      if (count === 0) break;
      offset2 += count;
    }
    return {
      device: String(stat.dev),
      inode: String(stat.ino),
      fileSize: stat.size,
      bytes: bytes.subarray(0, offset2),
      exceededBudget
    };
  } finally {
    closeSync2(descriptor);
  }
}
function verifyCommitObject(executable, repository, sha) {
  try {
    const format = probe(
      executable,
      ["--git-dir", repository.gitDirectory, "rev-parse", "--show-object-format"],
      repository.commonDirectory
    );
    const type = probe(
      executable,
      ["--git-dir", repository.gitDirectory, "cat-file", "-t", sha],
      repository.commonDirectory
    );
    return format === repository.objectFormat && type === "commit" ? { ok: true, value: sha } : { ok: false, reason: "witness is not a commit object in the actual object format" };
  } catch {
    return { ok: false, reason: "commit object verification failed" };
  }
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

// packages/agent-hooks/src/common/span-ignore.ts
import * as fs2 from "node:fs";
import * as nodePath2 from "node:path";
var HOOK_IGNORE_REL = nodePath2.join(".span", ".hookignore");

// packages/agent-hooks/src/common/span-surface.ts
function createDiskMemoStore(logger2, layout) {
  return {
    getSurfaced(sessionId2) {
      pruneStaleSessionsThrottled(layout);
      try {
        const raw = fs3.readFileSync(layout.memoFile(sessionId2), "utf8");
        const parsed = JSON.parse(raw);
        const surfaced = isRecord(parsed) ? parsed.surfaced : void 0;
        if (Array.isArray(surfaced) && surfaced.every((name) => typeof name === "string")) {
          return new Set(surfaced);
        }
        throw new Error("memo file is not a { surfaced: string[] } document");
      } catch (err) {
        logger2.warn("memo read failed (treating as empty)", { err });
      }
      return /* @__PURE__ */ new Set();
    },
    addSurfaced(sessionId2, names, known) {
      const existing = new Set(known);
      for (const n of names) existing.add(n);
      const memoDir = layout.dir(sessionId2);
      const memoPath = layout.memoFile(sessionId2);
      const tmpPath = `${memoPath}.tmp`;
      try {
        fs3.mkdirSync(memoDir, { recursive: true, mode: 448 });
        fs3.writeFileSync(tmpPath, JSON.stringify({ surfaced: [...existing] }), "utf8");
        fs3.renameSync(tmpPath, memoPath);
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

// packages/agent-hooks/src/common/static-attribution.ts
import { execFileSync as execFileSync4 } from "node:child_process";
import * as fs4 from "node:fs";
import * as nodePath4 from "node:path";

// packages/agent-hooks/src/common/parse-command.ts
import { readFileSync as readFileSync4, statSync as statSync4 } from "node:fs";
import { basename as basename2, isAbsolute as isAbsolute2, join as joinPath, resolve as resolvePath } from "node:path";

// packages/agent-hooks/src/common/command-resolve.ts
import { execFileSync as execFileSync3 } from "node:child_process";
import { readFileSync as readFileSync3, statSync as statSync3 } from "node:fs";
function countFileLines(absolutePath) {
  try {
    if (!statSync3(absolutePath).isFile()) return null;
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

// packages/agent-hooks/src/common/regex-groups.ts
function hasRequiredGroups(groups, required) {
  for (let index = 0; index < required; index++) {
    if (groups[index] === void 0) return false;
  }
  return true;
}
function matchGroups(text2, pattern, required) {
  if (pattern.global || pattern.sticky)
    throw new Error(`matchGroups needs a stateless pattern, got /${pattern.source}/${pattern.flags}`);
  const match = pattern.exec(text2);
  if (match === null) return null;
  const groups = match.slice(1);
  return hasRequiredGroups(groups, required) ? groups : null;
}

// packages/agent-hooks/src/common/shell-split-machines.ts
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
    level: [],
    outerLevels: [],
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
  const c = s.cmd.charAt(s.i);
  if (c === ">" || c === "<") return true;
  if (c === "&") return s.cmd[s.i + 1] === ">";
  if (c >= "0" && c <= "9") {
    let j = s.i;
    while (j < s.n && s.cmd.charAt(j) >= "0" && s.cmd.charAt(j) <= "9") j += 1;
    return s.cmd[j] === ">" || s.cmd[j] === "<";
  }
  return false;
}
function unconsumedPipeOp(s) {
  return (s.pendingOp === "pipe" || s.pendingOp === "and" || s.pendingOp === "or") && s.buf.trim() === "";
}
function appendStage(s, nextOp) {
  const text2 = s.buf.trim();
  if (text2) {
    if (s.pendingOp === "pipe" && (text2 === "!" || /^!\s/.test(text2))) {
      rejectList(s, "pipe-bang");
      return;
    }
    s.parts.push({ text: text2, precededBy: s.pendingOp, ...s.bufHeredoc ? { heredoc: true } : {} });
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
  const pending2 = s.heredocs[0];
  if (pending2?.close.test(line) === true) {
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
  const { i: i2 } = s;
  if (s.cmd[i2] !== "<" || s.cmd[i2 + 1] !== "<" || s.cmd[i2 + 2] !== "<") return false;
  if (s.cmd[i2 + 3] === "<" || s.cmd[i2 - 1] === "<") return false;
  s.buf += "<<<";
  s.i += 3;
  return true;
}
function stepHeredocOpen(s) {
  if (s.depth !== 0) return false;
  const { i: i2 } = s;
  if (s.cmd[i2] !== "<" || s.cmd[i2 + 1] !== "<" || s.cmd[i2 + 2] === "<") return false;
  const scanned = scanHeredocDelimiter(s);
  if (scanned.delim === "") return false;
  s.heredocs.push({
    close: new RegExp(`^${scanned.allowTabs ? "	*" : ""}${escapeRegExp(scanned.delim)}[ \\t]*$`)
  });
  s.bufHeredoc = true;
  if (insideOpenRegion(s)) {
    s.buf += s.cmd.slice(i2, scanned.next);
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
  const quote = s.cmd.charAt(j);
  if (quote === "'" || quote === '"') {
    const q = s.cmd.indexOf(quote, j + 1);
    if (q === -1) return { delim: s.cmd.slice(j + 1), allowTabs, next: s.n };
    return { delim: s.cmd.slice(j + 1, q), allowTabs, next: q + 1 };
  }
  const delimStart = j;
  while (j < s.n && !WORD_END.test(s.cmd.charAt(j))) j += 1;
  return { delim: s.cmd.slice(delimStart, j), allowTabs, next: j };
}
function insideOpenRegion(s) {
  return s.level.length > 0 || s.caseRegion !== null;
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
  const c = s.cmd.charAt(s.i);
  if (!wordStart(s.buf) || WORD_END.test(c)) return false;
  let j = s.i;
  while (j < s.n && !WORD_END.test(s.cmd.charAt(j))) j += 1;
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
      s.outerLevels.push(s.level);
      s.level = [];
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
    const outer = s.outerLevels.at(-1);
    if (s.depth === 0 || outer === void 0) {
      rejectList(s, "unbalanced-paren");
      return true;
    }
    if (s.level.length > 0) {
      rejectList(s, "unclosed-construct");
      return true;
    }
    s.depth -= 1;
    s.outerLevels.pop();
    s.level = outer;
  }
  s.buf += c;
  s.i += 1;
  return true;
}
function stepConstructWord(s) {
  if (!startsConstructWord(s)) return false;
  let j = s.i;
  while (j < s.n && !WORD_END.test(s.cmd.charAt(j))) j += 1;
  const w = s.cmd.slice(s.i, j);
  const top = s.level.at(-1);
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
  const c = s.cmd.charAt(s.i);
  if (WORD_END.test(c)) return false;
  if (!wordStart(s.buf) && !/[()]$/.test(s.buf)) return false;
  return !(c === "$" && s.cmd[s.i + 1] === "{");
}
function pushConstruct(s, kind) {
  markEnclosingBraceBody(s);
  s.level.push({ kind, body: false });
  s.afterKeyword = true;
}
function requireTopOf(s, kinds, requireBody) {
  const t = s.level.at(-1);
  if (t === void 0 || !kinds.includes(t.kind) || requireBody && !t.body) {
    rejectList(s, "unclosed-construct");
    return null;
  }
  return t;
}
function closeConstruct(s, kinds) {
  if (requireTopOf(s, kinds, true) === null) return;
  s.level.pop();
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
  const t = s.level.at(-1);
  if (s.afterKeyword || t === void 0 || t.kind !== "brace" || !t.body) {
    rejectList(s, "unclosed-construct");
    return;
  }
  s.level.pop();
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
  const kw2 = CONSTRUCT_KEYWORDS.get(w);
  if (kw2 === void 0) return false;
  kw2(s);
  return true;
}
function markEnclosingBraceBody(s) {
  const t = s.level.at(-1);
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
  if (s.caseRegion === null && s.level.length > 0 && (c === ";" || c === "&") && s.afterKeyword) {
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
  if (s.level.length > 0) return false;
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
  const before = trimmed.charAt(trimmed.length - 2);
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
  } else if (s.level.length > 0) {
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
    const c = t.src.charAt(j);
    if (quote === "'") {
      if (c === "'") return { out, next: j + 1 };
      out += c;
      j += 1;
      continue;
    }
    const escaped = t.src.charAt(j + 1);
    if (c === "\\" && j + 1 < t.n && '"\\$`'.includes(escaped)) {
      out += escaped;
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
    const c = t.src.charAt(j);
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

// packages/agent-hooks/src/common/shell-split.ts
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
    if (/\s/.test(t.src.charAt(t.i))) {
      flushWord(t);
      t.i += 1;
      continue;
    }
    if (stepTokenizerQuote(t)) continue;
    if (stepTokenizerEscape(t)) continue;
    if (stepTokenizerRedirect(t)) continue;
    if (stepTokenizerAmpersand(t)) continue;
    t.buf += t.src.charAt(t.i);
    t.i += 1;
  }
  return finishTokenizeScan(t);
}
function redirectAttachedTarget(text2) {
  const rest = text2.match(/^(\d*)(<<<|<<-|&>>|<<|>>|&>|>&|<|>)(.*)$/)?.[3];
  return rest !== void 0 && rest.length > 0 ? rest : null;
}
function argvOf(simpleCmd) {
  const tokens = tokenize(stripLeadingAssignments(simpleCmd).trim());
  if (tokens === null) return null;
  const argv = [];
  let skipTarget = false;
  for (const token of tokens) {
    if (skipTarget) {
      skipTarget = false;
      continue;
    }
    if (!token.isRedirect) {
      argv.push(token.text);
      continue;
    }
    skipTarget = redirectAttachedTarget(token.text) === null;
  }
  return argv;
}
function hasUnquotedRedirect(simpleCmd) {
  let inSquote = false;
  let inDquote = false;
  for (let i2 = 0; i2 < simpleCmd.length; i2++) {
    const c = simpleCmd.charAt(i2);
    if (inSquote) {
      if (c === "'") inSquote = false;
      continue;
    }
    if (inDquote) {
      if (c === "\\" && i2 + 1 < simpleCmd.length && '"\\$`'.includes(simpleCmd.charAt(i2 + 1))) {
        i2 += 1;
      } else if (c === '"') {
        inDquote = false;
      }
      continue;
    }
    if (c === "'") {
      inSquote = true;
      continue;
    }
    if (c === '"') {
      inDquote = true;
      continue;
    }
    if (c === "\\" && i2 + 1 < simpleCmd.length) {
      i2 += 1;
      continue;
    }
    if (c === "<") return true;
  }
  return false;
}

// packages/agent-hooks/src/common/unified-diff.ts
var HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
function stripPathComponents(p, n) {
  let s = p;
  for (let i2 = 0; i2 < n; i2++) {
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
  let current2 = null;
  let pendingKind = null;
  let renameFrom = null;
  let renameTo = null;
  let binary = false;
  const stripped = (raw) => {
    const text2 = headerPathText(raw);
    if (text2 === "/dev/null") return text2;
    return stripPathComponents(text2, stripLevelFor(text2, strip));
  };
  const finish = () => {
    if (current2 !== null) {
      if (current2.kind === "new") results.push({ path: current2.path, operation: "create-overwrite" });
      else if (current2.kind === "deleted") results.push({ path: current2.path, operation: "delete" });
      else if (binary) results.push({ path: current2.path, operation: "modify" });
      else if (current2.hunks.length === 0) {
      } else if (current2.countChanging) results.push({ path: current2.path, operation: "modify" });
      else {
        const start = Math.min(...current2.hunks.map((h) => h.start));
        const end = Math.max(...current2.hunks.map((h) => h.end));
        results.push({ path: current2.path, operation: "modify", lineStart: start, lineEnd: end });
      }
      current2 = null;
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
      if (current2 !== null) finish();
      current2 = {
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
      if (current2 === null) current2 = { path, kind: pendingKind ?? "modify", hunks: [], countChanging: false };
      else if (path === "/dev/null") current2.kind = "deleted";
      else if (current2.path === "/dev/null") {
        current2.path = path;
        current2.kind = "new";
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
      if (current2 !== null) finish();
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
    const [, preStartText, preCountText, , postCountText] = line.match(HUNK_HEADER) ?? [];
    if (preStartText !== void 0) {
      sawBlock = true;
      const preStart = Number.parseInt(preStartText, 10);
      const preCount = preCountText === void 0 ? 1 : Number.parseInt(preCountText, 10);
      const postCount = postCountText === void 0 ? 1 : Number.parseInt(postCountText, 10);
      if (current2 === null) return null;
      if (preCount !== postCount) current2.countChanging = true;
      if (preCount > 0) current2.hunks.push({ start: preStart, end: preStart + preCount - 1 });
    }
  }
  finish();
  return sawBlock ? results : null;
}

// packages/agent-hooks/src/common/parse-command.ts
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
  const scriptIdx = rest.findIndex((a) => a !== "-n" && sedScriptSegments(a).some((seg) => SED_RANGE.test(seg)));
  const script = rest[scriptIdx];
  if (script === void 0) return [];
  const [fileArg, ...otherFiles] = rest.filter((a, i2) => i2 !== scriptIdx && a !== "-n" && !a.startsWith("-"));
  if (fileArg === void 0 || otherFiles.length > 0) return [];
  const results = [];
  for (const segment of sedScriptSegments(script)) {
    const match = matchGroups(segment, SED_RANGE, 1);
    if (match === null) continue;
    const [startText, endToken] = match;
    const start = Number.parseInt(startText, 10);
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
  for (let i2 = 0; i2 < rest.length; i2++) {
    const a = rest[i2];
    if (a === void 0) break;
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
      i2 += 1;
      continue;
    }
    if (/^(-c|--bytes=)/.test(a)) {
      disqualified = true;
      continue;
    }
    if (a === "-q" || a === "-v" || a === "--quiet" || a === "--silent" || a === "--verbose") continue;
    if (a === "-n") {
      const v = rest[i2 + 1];
      if (v !== void 0 && /^\+?\d+$/.test(v)) {
        fromStart = v.startsWith("+");
        count = Number.parseInt(v.replace("+", ""), 10);
        i2 += 1;
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
  const spec = { kind: "upperBoundFromStart", end: count ?? 10 };
  return realFiles.map((fileArg) => ({
    kind: "candidate",
    idiom: "head-file",
    fileArg,
    spec,
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
  let i2 = 0;
  while (i2 < rest.length) {
    const a = rest[i2];
    if (a === void 0) break;
    if (a === "-C") {
      const v = rest[i2 + 1];
      if (v === void 0) return null;
      if (hasShellExpansion(v)) cDirUnresolvable = true;
      else cDir = v;
      i2 += 2;
      continue;
    }
    if (a === "-c") {
      i2 += 2;
      continue;
    }
    if (a.startsWith("-")) {
      i2 += 1;
      continue;
    }
    return { subIdx: i2, subcommand: a, cDir, cDirUnresolvable };
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
  const m = matchGroups(revPathArg, REV_PATH, 2);
  if (m === null) return [];
  const [rev, path] = m;
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
  for (let i2 = 0; i2 < after.length; i2++) {
    const a = after[i2];
    if (a === void 0) break;
    let spec = null;
    if (a === "-L") spec = after[i2 + 1] ?? null;
    else if (a.startsWith("-L")) spec = a.slice(2);
    if (!spec) continue;
    const m = matchGroups(spec, /^(\d+),(\d+):(.+)$/, 3);
    if (m === null) continue;
    const [s, e, path] = m;
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
  let i2 = from;
  const readDelimWord = (start) => {
    let d = "";
    let sawQuote = false;
    let k = start;
    while (k < n && !/\s/.test(raw.charAt(k)) && raw[k] !== "<" && raw[k] !== ">") {
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
  while (i2 < n) {
    const c = raw[i2];
    if (inSquote) {
      if (c === "'") inSquote = false;
      i2 += 1;
      continue;
    }
    if (inDquote) {
      if (c === "\\" && i2 + 1 < n) {
        i2 += 2;
        continue;
      }
      if (c === '"') inDquote = false;
      i2 += 1;
      continue;
    }
    if (c === "'") {
      inSquote = true;
      i2 += 1;
      continue;
    }
    if (c === '"') {
      inDquote = true;
      i2 += 1;
      continue;
    }
    if (c === "\\" && i2 + 1 < n) {
      i2 += 2;
      continue;
    }
    if (c === "(") {
      depth += 1;
      i2 += 1;
      continue;
    }
    if (c === ")") {
      depth = Math.max(0, depth - 1);
      i2 += 1;
      continue;
    }
    if (depth > 0) {
      i2 += 1;
      continue;
    }
    if (raw.startsWith("&&", i2) || raw.startsWith("||", i2)) {
      cmdStart = i2 + 2;
      pendingPipe = false;
      i2 += 2;
      continue;
    }
    if (raw.startsWith("|&", i2)) {
      cmdStart = i2 + 1;
      pendingPipe = true;
      i2 += 2;
      continue;
    }
    if (c === ";") {
      cmdStart = i2 + 1;
      pendingPipe = false;
      i2 += 1;
      continue;
    }
    if (c === "|") {
      cmdStart = i2 + 1;
      pendingPipe = true;
      i2 += 1;
      continue;
    }
    if (c === "\n") {
      if (!pendingPipe) cmdStart = i2 + 1;
      i2 += 1;
      continue;
    }
    if (c === "&") {
      const trimmed = raw.slice(cmdStart, i2).trimEnd();
      const dupRedirect = trimmed.endsWith(">") && (trimmed.length === 1 || /\s|\d/.test(trimmed[trimmed.length - 2] ?? ""));
      if (raw[i2 + 1] === ">" || dupRedirect) {
        i2 += 1;
        continue;
      }
      cmdStart = i2 + 1;
      pendingPipe = false;
      i2 += 1;
      continue;
    }
    if (c === "<" && raw[i2 + 1] === "<") {
      if (raw[i2 + 2] === "<") {
        i2 += 3;
        continue;
      }
      let j = i2 - 1;
      while (j >= from && /\d/.test(raw.charAt(j))) j -= 1;
      const ioNumber = j < i2 - 1 && (j < from || /\s|[;|&(]/.test(raw.charAt(j)));
      if (ioNumber) {
        i2 += 2;
        continue;
      }
      const tabStrip = raw[i2 + 2] === "-";
      const opLen = tabStrip ? 3 : 2;
      const lineEnd = raw.indexOf("\n", i2);
      const openerLineEnd = lineEnd === -1 ? n : lineEnd;
      const attached = readDelimWord(i2 + opLen);
      let delim = attached === null ? "" : attached.delim;
      let sawQuote = attached === null ? false : attached.sawQuote;
      if (delim === "" && attached !== null) {
        let k = attached.next;
        while (k < openerLineEnd && /\s/.test(raw.charAt(k))) k += 1;
        const word = readDelimWord(k);
        if (word === null) delim = "";
        else {
          delim = word.delim;
          sawQuote = word.sawQuote;
        }
      }
      if (delim === "" || !sawQuote && !BARE_DELIM.test(delim)) {
        i2 += opLen;
        continue;
      }
      return { cmdStart, openerLineEnd, delim, tabStrip, quotedDelim: sawQuote };
    }
    i2 += 1;
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
var REDIRECT_OPERATORS = [">", ">>", "&>", "&>>", ">&", "<", "<<", "<<-", "<<<"];
var REDIRECT_TOKEN = /^(\d*)(<<<|<<-|&>>|<<|>>|&>|>&|<|>)(.*)$/;
function classifyRedirectToken(text2) {
  const m = matchGroups(text2, REDIRECT_TOKEN, 3);
  if (m === null) return null;
  const [fdText, op, target] = m;
  if (!isOneOf(REDIRECT_OPERATORS, op)) return null;
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
  for (let i2 = 0; i2 < tokens.length; i2++) {
    const token = tokens[i2];
    if (token === void 0) break;
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
      const next = tokens[i2 + 1];
      if (next !== void 0 && !next.isRedirect) {
        redirects.push({ ...info, target: next.text });
        i2 += 1;
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
    const [fmt, ...extra] = args;
    if (fmt === void 0 || extra.length > 0) return void 0;
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
function matchTeeOperands(argv, pipeEchoContent, currentDir, simpleCommandIndex, join12, results) {
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
        join: join12,
        ...pipeEchoContent !== null ? { written: pipeEchoContent } : {}
      } : {
        operation: "append",
        absolutePath,
        simpleCommandIndex,
        join: join12,
        ...pipeEchoContent !== null ? { written: pipeEchoContent } : {}
      }
    });
  }
}
function matchRedirectFamily(argv, redirects, pipeEchoContent, currentDir, simpleCommandIndex, join12, results) {
  const contentRedirects = redirects.filter(isContentRedirect);
  const host = argv[0];
  if (contentRedirects.length === 0) {
    if (host === "tee") matchTeeOperands(argv, pipeEchoContent, currentDir, simpleCommandIndex, join12, results);
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
        span: { operation: "truncate", absolutePath, simpleCommandIndex, join: join12 }
      });
    }
    return;
  }
  if (host !== "echo" && host !== "printf" && host !== "tee") return;
  const [onlyRedirect, ...otherRedirects] = contentRedirects;
  const singleRedirect = otherRedirects.length === 0 ? onlyRedirect : void 0;
  const singlePlainAppend = singleRedirect?.op === ">>";
  const singlePlainOverwrite = singleRedirect?.op === ">";
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
          join: join12,
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
          join: join12,
          ...threadedOverwrite !== void 0 ? { written: threadedOverwrite } : {}
        }
      });
    }
  }
  if (host === "tee") matchTeeOperands(argv, pipeEchoContent, currentDir, simpleCommandIndex, join12, results);
}
var FOREIGN_WRAPPERS = /* @__PURE__ */ new Set(["sudo", "xargs", "nohup", "time", "nice", "doas"]);
var ASSIGNMENT_TOKEN = /^[A-Za-z_][A-Za-z0-9_]*=/;
function stripTransparentWrapper(argv) {
  const unwrapped = argv[0] === "command" || argv[0] === "env" ? argv.slice(1) : argv;
  const commandIndex = unwrapped.findIndex((word) => !ASSIGNMENT_TOKEN.test(word));
  if (commandIndex === -1) return [];
  return commandIndex > 0 ? unwrapped.slice(commandIndex) : unwrapped;
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
  let i2 = 0;
  let afterDashDash = false;
  while (i2 < args.length) {
    const a = args[i2];
    if (a === void 0) break;
    if (afterDashDash) {
      operands.push(a);
      i2 += 1;
      continue;
    }
    if (a === "--") {
      afterDashDash = true;
      i2 += 1;
      continue;
    }
    if (a === "-t" || a === "--target-directory") {
      const v = args[i2 + 1];
      if (v === void 0) return null;
      targetDir = v;
      i2 += 2;
      continue;
    }
    if (a.startsWith("--target-directory=")) {
      targetDir = a.slice("--target-directory=".length);
      i2 += 1;
      continue;
    }
    if (spec.excluded.has(a)) return null;
    if (spec.valueTaking.has(a)) {
      if (args[i2 + 1] === void 0) return null;
      i2 += 2;
      continue;
    }
    if (spec.noValue.has(a) || spec.noClobber.has(a)) {
      i2 += 1;
      continue;
    }
    if (a.startsWith("-")) {
      i2 += 1;
      continue;
    }
    operands.push(a);
    i2 += 1;
  }
  return { operands, targetDir };
}
function emitSourceSpan(results, spec, absolutePath, simpleCommandIndex, join12) {
  if (spec.sourceOperation === "delete") {
    results.push({
      status: "resolved",
      idiom: spec.idiom,
      span: { operation: "delete", absolutePath, simpleCommandIndex, join: join12 }
    });
    return;
  }
  const range = resolveSpec({ kind: "toEof", start: 1 }, () => countFileLines(absolutePath));
  results.push({
    status: "resolved",
    idiom: spec.idiom,
    span: range === null ? { operation: "read", absolutePath, simpleCommandIndex, join: join12 } : {
      operation: "read",
      lineStart: range.lineStart,
      lineEnd: range.lineEnd,
      absolutePath,
      simpleCommandIndex,
      join: join12
    }
  });
}
function matchCopyMoveFamily(argv, dirForResolution, simpleCommandIndex, join12, results) {
  const [command, ...commandArgs] = stripTransparentWrapper(argv);
  if (command === void 0) return;
  let spec = null;
  let args = [];
  let dir = dirForResolution;
  if (command === "cp" || command === "install" || command === "mv") {
    spec = command === "cp" ? CP_SPEC : command === "install" ? INSTALL_SPEC : MV_SPEC;
    args = commandArgs;
  } else if (command === "git") {
    const sub = findGitSubcommand(commandArgs);
    if (sub !== null && sub.subcommand === "mv") {
      if (sub.cDirUnresolvable) {
        pushUnresolved(results, "mv-write", "mv", "git -C target contains an unresolved shell variable");
        return;
      }
      spec = GIT_MV_SPEC;
      args = commandArgs.slice(sub.subIdx + 1);
      dir = sub.cDir ?? dirForResolution;
    }
  } else if (FOREIGN_WRAPPERS.has(command)) {
    const [wrapped] = commandArgs;
    const wrappedSpec = wrapped === "cp" ? CP_SPEC : wrapped === "install" ? INSTALL_SPEC : wrapped === "mv" ? MV_SPEC : null;
    if (wrapped !== void 0 && wrappedSpec !== null) {
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
    const dest = parts.operands.at(-1);
    if (dest === void 0) return;
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
  for (const sourcePath of sourcePaths) {
    emitSourceSpan(results, spec, sourcePath, simpleCommandIndex, join12);
  }
  for (const destPath of destPaths) {
    results.push({
      status: "resolved",
      idiom: spec.idiom,
      span: { operation: spec.destOperation, absolutePath: destPath, simpleCommandIndex, join: join12 }
    });
  }
}
var RM_NO_VALUE = /* @__PURE__ */ new Set(["-f", "-i", "-v"]);
var RM_EXCLUDED = /* @__PURE__ */ new Set(["-r", "-R", "--recursive", "-d"]);
var GIT_RM_EXCLUDED = /* @__PURE__ */ new Set(["-r", "-R", "--recursive", "-d", "-n", "--dry-run"]);
function matchRmOperands(args, excluded, excludeCached, dir, simpleCommandIndex, join12, results) {
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
      span: { operation: "delete", absolutePath: resolvePath(dir, operand), simpleCommandIndex, join: join12 }
    });
  }
}
function evaluateStaticSize(value) {
  if (value === void 0) return void 0;
  const m = matchGroups(value, /^(\d+)([KMG])?$/, 1);
  if (m === null) return void 0;
  const [baseText, suffix] = m;
  const base = Number.parseInt(baseText, 10);
  const mult = suffix === "K" ? 1024 : suffix === "M" ? 1024 ** 2 : suffix === "G" ? 1024 ** 3 : 1;
  return base * mult;
}
function matchTruncateOperands(args, dir, simpleCommandIndex, join12, results) {
  let sawSizeFlag = false;
  let afterDashDash = false;
  let staticSize;
  const operands = [];
  for (let i2 = 0; i2 < args.length; i2++) {
    const a = args[i2];
    if (a === void 0) break;
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
      staticSize = evaluateStaticSize(args[i2 + 1]);
      i2 += 1;
      continue;
    }
    if (a === "-r") {
      sawSizeFlag = true;
      staticSize = void 0;
      i2 += 1;
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
        join: join12,
        ...operand.size !== void 0 ? { size: operand.size } : {}
      }
    });
  }
}
function matchRmTruncate(argv, dirForResolution, simpleCommandIndex, join12, results) {
  const [command, ...commandArgs] = stripTransparentWrapper(argv);
  if (command === void 0) return;
  if (command === "rm") {
    matchRmOperands(commandArgs, RM_EXCLUDED, false, dirForResolution, simpleCommandIndex, join12, results);
    return;
  }
  if (command === "truncate") {
    matchTruncateOperands(commandArgs, dirForResolution, simpleCommandIndex, join12, results);
    return;
  }
  if (command === "git") {
    const sub = findGitSubcommand(commandArgs);
    if (sub !== null && sub.subcommand === "rm") {
      if (sub.cDirUnresolvable) {
        pushUnresolved(results, "rm-write", "rm", "git -C target contains an unresolved shell variable");
        return;
      }
      matchRmOperands(
        commandArgs.slice(sub.subIdx + 1),
        GIT_RM_EXCLUDED,
        true,
        sub.cDir ?? dirForResolution,
        simpleCommandIndex,
        join12,
        results
      );
    }
    return;
  }
  if (FOREIGN_WRAPPERS.has(command)) {
    const [wrapped] = commandArgs;
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
  for (let i2 = 0; i2 < body.length; i2++) {
    if (body[i2] !== "\\") continue;
    const next = body[i2 + 1];
    if (next === void 0 || next === "$" || next === "`" || next === "\\" || next === "\n") return false;
    i2 += 1;
  }
  return true;
}
function classifyHeredocOpener(opener, body, quotedDelim, currentDir, simpleCommandIndex, join12, results) {
  const bodyLiteral = quotedDelim || heredocBodyIsLiteral(body);
  const tokens = tokenize(stripLeadingAssignments(opener).trim());
  if (tokens === null) return;
  const { argv, redirects } = analyzeTokens(tokens);
  const host = argv[0];
  const contentRedirects = redirects.filter(isContentRedirect);
  const [onlyRedirect, ...otherRedirects] = contentRedirects;
  const singleRedirect = otherRedirects.length === 0 ? onlyRedirect : void 0;
  const singlePlainAppend = singleRedirect?.op === ">>";
  const singlePlainOverwrite = singleRedirect?.op === ">";
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
            join: join12,
            ...singlePlainAppend && r.op === ">>" && bodyLiteral ? { written: body } : {}
          }
        });
      } else {
        results.push({
          status: "resolved",
          idiom: "heredoc-write",
          span: body.length === 0 ? { operation: "truncate", absolutePath, simpleCommandIndex, join: join12 } : {
            operation: "create-overwrite",
            absolutePath,
            simpleCommandIndex,
            join: join12,
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
              join: join12,
              ...contentRedirects.length === 0 && bodyLiteral ? { written: body } : {}
            }
          });
        } else {
          results.push({
            status: "resolved",
            idiom: "heredoc-write",
            span: body.length === 0 ? { operation: "truncate", absolutePath, simpleCommandIndex, join: join12 } : {
              operation: "create-overwrite",
              absolutePath,
              simpleCommandIndex,
              join: join12,
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
    classifyPatchHeredoc(argv, body, currentDir, simpleCommandIndex, join12, results);
    return;
  }
}
var NUMERIC_SUBSTITUTION = /^(\d+)(?:,(\d+))?[sy]/;
var UNRESTRICTED_SUBSTITUTION = /^[sy]/;
function matchSedInplace(argv, dirForResolution, simpleCommandIndex, join12, results) {
  const [command, ...commandArgs] = stripTransparentWrapper(argv);
  if (command === void 0) return;
  if (command === "sed") {
    matchSedInplaceArgs(commandArgs, dirForResolution, simpleCommandIndex, join12, results);
    return;
  }
  if (FOREIGN_WRAPPERS.has(command)) {
    const [wrapped] = commandArgs;
    if (wrapped === "sed") {
      pushUnresolved(results, "sed-inplace", wrapped, `the ${command} wrapper obscures the ${wrapped} argv`);
    }
  }
}
var SED_SCRIPT_SHAPE = /^(?:[A-Za-z]|\d|\/|\\|\$|~)/;
function matchSedInplaceArgs(args, dir, simpleCommandIndex, join12, results) {
  let suffix = null;
  let sawInplace = false;
  let i2 = 0;
  const eScripts = [];
  const positionals = [];
  const files = [];
  let afterDashDash = false;
  while (i2 < args.length) {
    const a = args[i2];
    if (a === void 0) break;
    if (afterDashDash) {
      positionals.push(a);
      i2 += 1;
      continue;
    }
    if (a === "--") {
      afterDashDash = true;
      i2 += 1;
      continue;
    }
    if (a === "-n") {
      i2 += 1;
      continue;
    }
    if (a === "-e") {
      const v = args[i2 + 1];
      if (v === void 0) {
        pushUnresolved(results, "sed-inplace", a, "the -e flag is left valueless");
        return;
      }
      eScripts.push(v);
      i2 += 2;
      continue;
    }
    if (a === "-i") {
      sawInplace = true;
      const w = args[i2 + 1];
      if (w === void 0) {
        i2 += 1;
        continue;
      }
      if (w.startsWith("-")) {
        i2 += 1;
        continue;
      }
      const [following, ...beyond] = args.slice(i2 + 2);
      if (following !== void 0 && beyond.length > 0 && !SED_SCRIPT_SHAPE.test(w)) {
        suffix = w;
        i2 += 2;
        continue;
      }
      if (following === void 0) {
        files.push(w);
        i2 += 2;
        continue;
      }
      positionals.push(w, following);
      i2 += 3;
      continue;
    }
    if (a.startsWith("-i") && a.length > 2) {
      sawInplace = true;
      suffix = a.slice(2);
      i2 += 1;
      continue;
    }
    if (a.startsWith("-")) {
      i2 += 1;
      continue;
    }
    positionals.push(a);
    i2 += 1;
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
    const m = matchGroups(segment, NUMERIC_SUBSTITUTION, 1);
    if (m === null) {
      allNumeric = false;
      if (!UNRESTRICTED_SUBSTITUTION.test(segment)) allSubstitution = false;
      continue;
    }
    const [startText, endText] = m;
    const s = Number.parseInt(startText, 10);
    const e = endText === void 0 ? s : Number.parseInt(endText, 10);
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
        span: { operation: "modify", lineStart: start, lineEnd: end, absolutePath, simpleCommandIndex, join: join12 }
      });
    } else {
      results.push({
        status: "resolved",
        idiom: "sed-inplace",
        span: { operation: "modify", absolutePath, simpleCommandIndex, join: join12 }
      });
    }
    if (suffix !== null && suffix !== "") {
      results.push({
        status: "resolved",
        idiom: "sed-inplace",
        span: { operation: "create-overwrite", absolutePath: `${absolutePath}${suffix}`, simpleCommandIndex, join: join12 }
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
  for (let i2 = 0; i2 < args.length; i2++) {
    const a = args[i2];
    if (a === void 0) break;
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
        const v = args[i2 + 1];
        if (v !== void 0 && /^\d+$/.test(v)) {
          strip = Number.parseInt(v, 10);
          i2 += 1;
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
      const v = args[i2 + 1];
      if (v !== void 0 && /^\d+$/.test(v)) {
        strip = Number.parseInt(v, 10);
        i2 += 1;
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
function emitPatchTargets(args, isGitApply, host, targetDir, shellDir, redirects, simpleCommandIndex, join12, results) {
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
        join: join12,
        ...t.lineStart !== void 0 ? { lineStart: t.lineStart, lineEnd: t.lineEnd } : {}
      }
    });
  }
}
function matchPatchApply(argv, redirects, dirForResolution, simpleCommandIndex, join12, results) {
  const [command, ...commandArgs] = stripTransparentWrapper(argv);
  if (command === void 0) return;
  if (command === "patch") {
    emitPatchTargets(
      commandArgs,
      false,
      "patch",
      dirForResolution,
      dirForResolution,
      redirects,
      simpleCommandIndex,
      join12,
      results
    );
    return;
  }
  if (command === "git") {
    const sub = findGitSubcommand(commandArgs);
    if (sub === null || sub.subcommand !== "apply") return;
    if (sub.cDirUnresolvable) {
      pushUnresolved(results, "patch-write", "apply", "git -C target contains an unresolved shell variable");
      return;
    }
    emitPatchTargets(
      commandArgs.slice(sub.subIdx + 1),
      true,
      "apply",
      sub.cDir ?? dirForResolution,
      dirForResolution,
      redirects,
      simpleCommandIndex,
      join12,
      results
    );
    return;
  }
  if (FOREIGN_WRAPPERS.has(command)) {
    const [wrapped] = commandArgs;
    if (wrapped === "patch" || wrapped === "apply") {
      pushUnresolved(results, "patch-write", wrapped, `the ${command} wrapper obscures the ${wrapped} argv`);
    }
  }
}
function classifyPatchHeredoc(argv, body, currentDir, simpleCommandIndex, join12, results) {
  const [command, ...commandArgs] = stripTransparentWrapper(argv);
  if (command === void 0) return;
  let isGitApply = false;
  let args;
  let dir = currentDir;
  if (command === "patch") {
    args = commandArgs;
  } else if (command === "git") {
    const sub = findGitSubcommand(commandArgs);
    if (sub === null || sub.subcommand !== "apply") return;
    if (sub.cDirUnresolvable) {
      pushUnresolved(results, "patch-write", "apply", "git -C target contains an unresolved shell variable");
      return;
    }
    isGitApply = true;
    args = commandArgs.slice(sub.subIdx + 1);
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
        join: join12,
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
  const firstNonFlag = rest.findIndex((word) => !RUNNER_NO_ARG_FLAGS.has(word));
  rest = firstNonFlag === -1 ? [] : rest.slice(firstNonFlag);
  if (runner === "npm" && rest[0] === "--") rest = rest.slice(1);
  const [wrapped] = rest;
  if (wrapped === void 0) return "not-runner";
  if (wrapped.startsWith("-") || wrapped.startsWith(".") || /\s/.test(wrapped)) return { kind: "obscured" };
  return { kind: "stripped", stripped: rest };
}
function matchFormatter(argv, dirForResolution, simpleCommandIndex, join12, results) {
  const unwrapped = stripTransparentWrapper(argv);
  const [command] = unwrapped;
  if (command === void 0) return;
  let words = unwrapped;
  const strip = stripPackageRunner(unwrapped);
  if (strip === "not-runner") {
  } else if (strip.kind === "obscured") {
    pushUnresolved(results, "formatter-write", command, `the ${command} wrapper obscures the wrapped argv`);
    return;
  } else {
    words = strip.stripped;
  }
  const [tool, ...args] = words;
  if (tool === void 0) return;
  if (FOREIGN_WRAPPERS.has(tool)) {
    const [wrapped] = args;
    if (wrapped !== void 0 && FORMATTER_TABLE.some((r) => r.command === wrapped)) {
      pushUnresolved(results, "formatter-write", wrapped, `the ${tool} wrapper obscures the ${wrapped} argv`);
    }
    return;
  }
  const row = FORMATTER_TABLE.find((r) => r.command === tool);
  if (row === void 0) return;
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
  const [firstArg] = args;
  const afterSubcommand = firstArg !== void 0 && subcommandWords.has(firstArg) ? args.slice(1) : args;
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
      span: { operation: "modify", absolutePath: resolvePath(dirForResolution, operand), simpleCommandIndex, join: join12 }
    });
  }
}
var RESTORE_NO_VALUE = /* @__PURE__ */ new Set(["-q", "-f", "-u"]);
function emitRestoreCheckoutPathspec(results, idiom, operand, dir, simpleCommandIndex, join12) {
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
    span: { operation: "create-overwrite", absolutePath, simpleCommandIndex, join: join12 }
  });
}
function matchRestoreOperands(args, dir, simpleCommandIndex, join12, results) {
  let staged = false;
  let worktree = false;
  let afterDashDash = false;
  const operands = [];
  for (let i2 = 0; i2 < args.length; i2++) {
    const a = args[i2];
    if (a === void 0) break;
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
      i2 += 1;
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
    emitRestoreCheckoutPathspec(results, "git-restore-write", operand, dir, simpleCommandIndex, join12);
  }
}
function matchCheckoutOperands(args, dir, simpleCommandIndex, join12, results) {
  let afterDashDash = false;
  const operands = [];
  for (let i2 = 0; i2 < args.length; i2++) {
    const a = args[i2];
    if (a === void 0) break;
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
      i2 += 1;
      continue;
    }
    if (a === "-f" || a === "-q" || a === "-m" || a === "-t") continue;
    if (a.startsWith("-")) continue;
  }
  for (const operand of operands) {
    emitRestoreCheckoutPathspec(results, "git-checkout-write", operand, dir, simpleCommandIndex, join12);
  }
}
function matchGitRestoreCheckout(argv, dirForResolution, simpleCommandIndex, join12, results) {
  const [command, ...commandArgs] = stripTransparentWrapper(argv);
  if (command === void 0) return;
  if (command === "git") {
    const sub = findGitSubcommand(commandArgs);
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
    const args = commandArgs.slice(sub.subIdx + 1);
    if (sub.subcommand === "restore") matchRestoreOperands(args, dir, simpleCommandIndex, join12, results);
    else matchCheckoutOperands(args, dir, simpleCommandIndex, join12, results);
    return;
  }
  if (FOREIGN_WRAPPERS.has(command)) {
    const [wrapped] = commandArgs;
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
  void malformed;
  const results = [];
  const fsLineCache = /* @__PURE__ */ new Map();
  const gitLineCache = /* @__PURE__ */ new Map();
  const cachedFsTotalLines = (absPath) => () => {
    if (!fsLineCache.has(absPath)) fsLineCache.set(absPath, countFileLines(absPath));
    return fsLineCache.get(absPath) ?? null;
  };
  const cachedGitTotalLines = (gitCwd, rev, path) => () => {
    const key2 = `${gitCwd}\0${rev}\0${path}`;
    if (!gitLineCache.has(key2)) gitLineCache.set(key2, countGitBlobLines(gitCwd, rev, path));
    return gitLineCache.get(key2) ?? null;
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
  const emitCandidate = (c, frame, simpleCommandIndex, join12) => {
    if (looksUnresolvable(c.fileArg)) {
      results.push({
        status: "unresolved",
        idiom: c.idiom,
        fileArg: c.fileArg,
        reason: "path contains an unexpanded shell variable or glob"
      });
      return;
    }
    let resolutionDir;
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
      resolutionDir = c.dirOverride === void 0 ? frame.dir : isAbsolute2(c.dirOverride) ? c.dirOverride : resolvePath(frame.dir, c.dirOverride);
    } else {
      const gitDir = gitDirOf(c, frame);
      if (gitDir === void 0) {
        results.push({
          status: "unresolved",
          idiom: c.idiom,
          fileArg: c.fileArg,
          reason: "the git -C target cannot be resolved against the tracked directory"
        });
        return;
      }
      resolutionDir = gitDir;
    }
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
        join: join12
      }
    });
  };
  const matchReads = (simple, argv, i2) => {
    let isPlainSource = false;
    let plainFileArg = null;
    const [bin, ...operands] = argv;
    const lastOperand = operands.at(-1);
    const plainSource = bin === "cat" && operands.length === 1 || bin === "nl" && operands.length >= 1 ? lastOperand : void 0;
    if (plainSource !== void 0 && !plainSource.startsWith("-")) {
      isPlainSource = true;
      plainFileArg = plainSource;
      lastPlainFileSource = hasShellExpansion(plainSource) ? null : resolvePath(currentDir, plainSource);
    }
    if (plainFileArg !== null) {
      const next = simpleCommands[i2 + 1];
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
          i2,
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
          emitCandidate(outcome, { dir: currentDir, certain: true }, i2, joinOf(simple));
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
            emitCandidate(outcome, { dir: currentDir, certain: true }, i2, joinOf(simple));
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
  for (let i2 = 0; i2 < simpleCommands.length; i2++) {
    const simple = simpleCommands[i2];
    if (simple === void 0) break;
    if (simple.precededBy !== "pipe") pipeEchoContent = null;
    const heredocRef = matchGroups(simple.text, /^__heredoc_(\d+)__$/, 1);
    const w = heredocRef === null ? void 0 : heredocWrites[Number.parseInt(heredocRef[0], 10)];
    if (w !== void 0) {
      const tokens2 = tokenize(stripLeadingAssignments(w.opener).trim());
      if (tokens2 === null) {
        lastPlainFileSource = null;
        continue;
      }
      const openerArgv = analyzeTokens(tokens2).argv;
      matchReads(simple, openerArgv, i2);
      classifyHeredocOpener(w.opener, w.body, w.quotedDelim, currentDir, i2, joinOf(simple), results);
      pipeEchoContent = literalContent(openerArgv) ?? null;
      continue;
    }
    const tokens = tokenize(stripLeadingAssignments(simple.text).trim());
    if (tokens === null) {
      lastPlainFileSource = null;
      continue;
    }
    const { argv, redirects } = analyzeTokens(tokens);
    const [bin] = argv;
    if (bin === void 0) {
      matchRedirectFamily(argv, redirects, pipeEchoContent, currentDir, i2, joinOf(simple), results);
      lastPlainFileSource = null;
      continue;
    }
    if (bin === "cd") {
      lastPlainFileSource = null;
      const target = argv[1];
      if (target !== void 0 && target !== "-" && !hasShellExpansion(target)) {
        currentDir = resolvePath(currentDir, target);
      }
      continue;
    }
    const before = results.length;
    matchReads(simple, argv, i2);
    matchRedirectFamily(argv, redirects, pipeEchoContent, currentDir, i2, joinOf(simple), results);
    matchCopyMoveFamily(argv, currentDir, i2, joinOf(simple), results);
    matchRmTruncate(argv, currentDir, i2, joinOf(simple), results);
    matchSedInplace(argv, currentDir, i2, joinOf(simple), results);
    matchPatchApply(argv, redirects, currentDir, i2, joinOf(simple), results);
    matchFormatter(argv, currentDir, i2, joinOf(simple), results);
    matchGitRestoreCheckout(argv, currentDir, i2, joinOf(simple), results);
    if (results.length === before) {
      const status = BUILTIN_GUARD_STATUS.get(bin);
      if (status !== void 0) {
        results.push({
          status: "builtin-guard",
          simpleCommandIndex: i2,
          join: joinOf(simple),
          exitStatus: status
        });
      }
    }
    pipeEchoContent = literalContent(argv) ?? null;
  }
  return results;
}

// packages/agent-hooks/src/common/static-attribution.ts
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
function decodeLiteralField(raw, delimiter2, replacement) {
  let value = "";
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (character === void 0) break;
    if (character === "\\") {
      const next = raw[index + 1];
      if (next === void 0) return null;
      if (next === "n") value += "\n";
      else if (next === delimiter2 || next === "\\" || !replacement && REGEX_META.test(next)) value += next;
      else return null;
      index += 1;
      continue;
    }
    if (!replacement && REGEX_META.test(character) || replacement && character === "&") return null;
    value += character;
  }
  return value;
}
function readDelimitedField(source, start, delimiter2) {
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
    if (character === delimiter2) return { raw, next: index + 1 };
    raw += character;
  }
  return null;
}
function parseLiteralSubstitution(script) {
  const delimiter2 = script.charAt(1);
  if (script.length < 4 || script[0] !== "s" || /\w|\s/.test(delimiter2)) return null;
  const patternField = readDelimitedField(script, 2, delimiter2);
  if (patternField === null) return null;
  const replacementField = readDelimitedField(script, patternField.next, delimiter2);
  if (replacementField === null) return null;
  const flags = script.slice(replacementField.next);
  if (flags !== "" && flags !== "g") return null;
  const pattern = decodeLiteralField(patternField.raw, delimiter2, false);
  const replacement = decodeLiteralField(replacementField.raw, delimiter2, true);
  if (pattern === null || pattern.length === 0 || replacement === null) return null;
  return { pattern, replacement, global: flags === "g" };
}
function literalOccurrenceRanges(content, literal3) {
  if (literal3.length === 0) return [];
  const ranges = [];
  let cursor = 0;
  let scannedTo = 0;
  let currentLine = 1;
  while (cursor <= content.length - literal3.length) {
    const offset2 = content.indexOf(literal3, cursor);
    if (offset2 < 0) break;
    for (let index = scannedTo; index < offset2; index += 1) {
      if (content.charCodeAt(index) === 10) currentLine += 1;
    }
    const embeddedNewlines = literal3.match(/\n/g)?.length ?? 0;
    const range = { start: currentLine, end: currentLine + embeddedNewlines };
    const previous = ranges[ranges.length - 1];
    if (previous === void 0 || previous.start !== range.start || previous.end !== range.end) ranges.push(range);
    cursor = offset2 + Math.max(1, literal3.length);
    scannedTo = offset2;
  }
  return ranges;
}
function replaceLiteral(source, pattern, replacement, global) {
  if (global) return source.split(pattern).join(replacement);
  const offset2 = source.indexOf(pattern);
  if (offset2 < 0) return source;
  return `${source.slice(0, offset2)}${replacement}${source.slice(offset2 + pattern.length)}`;
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
      if (argument === void 0) break;
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
    if (argument === void 0) break;
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
  const key2 = `${flags ?? ""}\0${source}`;
  let pattern = compiledPatternCache.get(key2);
  if (pattern === void 0) {
    pattern = new RegExp(source, flags);
    compiledPatternCache.set(key2, pattern);
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
function pythonLineAtOffset(content, offset2) {
  let line = 1;
  for (let index = 0; index < offset2; index += 1) if (content.charCodeAt(index) === 10) line += 1;
  return line;
}
function countLiteralOccurrences(content, literal3) {
  if (literal3.length === 0) return 0;
  let count = 0;
  let cursor = 0;
  while (cursor <= content.length - literal3.length) {
    const offset2 = content.indexOf(literal3, cursor);
    if (offset2 < 0) break;
    count += 1;
    cursor = offset2 + literal3.length;
  }
  return count;
}
function structuredKeyRanges(content, format, key2) {
  const escaped = key2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = format === "json" ? compileOnce(`^[ \\t]*["']${escaped}["'][ \\t]*:`, "m") : format === "toml" ? compileOnce(`^[ \\t]*(?:["']${escaped}["']|${escaped})[ \\t]*=`, "m") : compileOnce(`^[ \\t]*(?:["']${escaped}["']|${escaped})[ \\t]*:`, "m");
  const ranges = [];
  let offset2 = 0;
  for (const line of content.split(/(?<=\n)/)) {
    if (pattern.test(line)) {
      const number = pythonLineAtOffset(content, offset2);
      ranges.push({ start: number, end: number });
    }
    offset2 += line.length;
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
function rejectStructuredPythonKeys() {
  return rejectPython("unsupported-expression", "structured Python mutation requires literal string keys");
}
function consumePythonStatement(statement, ctx) {
  const pathLiteral = matchGroups(statement, PYTHON_PATH_LITERAL_PATTERN, 2);
  if (pathLiteral !== null) {
    const [name, literal3] = pathLiteral;
    const path = decodePythonString(literal3);
    if (path === null) return rejectPython("unsupported-syntax", "Python path literal uses an unsupported escape");
    ctx.paths.set(name, { path, depth: 0 });
    return void 0;
  }
  const stringBinding = matchGroups(statement, PYTHON_STRING_BINDING_PATTERN, 2);
  if (stringBinding !== null) {
    const [name, literal3] = stringBinding;
    const path = decodePythonString(literal3);
    if (path === null) return rejectPython("unsupported-syntax", "Python string literal uses an unsupported escape");
    ctx.paths.set(name, { path, depth: 0 });
    return void 0;
  }
  const nameAlias = matchGroups(statement, PYTHON_NAME_ALIAS_PATTERN, 2);
  if (nameAlias !== null) {
    const [name, sourceName] = nameAlias;
    const source = ctx.paths.get(sourceName);
    if (source === void 0 || source.depth !== 0) {
      return rejectPython("unsupported-dataflow", "Python path aliases are limited to one literal hop");
    }
    ctx.paths.set(name, { path: source.path, depth: 1 });
    return void 0;
  }
  const textRead = matchGroups(statement, PYTHON_TEXT_READ_PATTERN, 3);
  if (textRead !== null) {
    const [name, pathName, readArguments] = textRead;
    const binding = ctx.paths.get(pathName);
    if (binding === void 0) return rejectPython("dynamic-path", "Python read target is not a literal path binding");
    if (readArguments.trim() !== "" && !/^encoding\s*=\s*['"]utf-?8['"]$/.test(readArguments.trim())) {
      return rejectPython(
        "unsupported-encoding",
        "only default or UTF-8 Python text reads are supported",
        binding.path
      );
    }
    ctx.texts.set(name, { path: binding.path });
    return void 0;
  }
  const replaceBinding = matchGroups(statement, PYTHON_REPLACE_BINDING_PATTERN, 4);
  if (replaceBinding !== null) {
    const [name, source, patternLiteral, replacementLiteral, countText] = replaceBinding;
    if (!ctx.texts.has(source))
      return rejectPython("unsupported-dataflow", "Python replace source is not a direct text read");
    const pattern = decodePythonString(patternLiteral);
    const replacement = decodePythonString(replacementLiteral);
    const count = countText === void 0 ? void 0 : Number.parseInt(countText, 10);
    if (pattern === null || pattern.length === 0 || replacement === null || count === 0) {
      return rejectPython(
        "unsupported-expression",
        "Python replace requires non-empty literal input and a positive count"
      );
    }
    ctx.replacements.set(name, { source, pattern, replacement, count });
    return void 0;
  }
  const countAssert = matchGroups(statement, PYTHON_COUNT_ASSERT_PATTERN, 3);
  if (countAssert !== null) {
    const [source, literalText, countText] = countAssert;
    const literal3 = decodePythonString(literalText);
    if (literal3 === null || literal3.length === 0 || !ctx.texts.has(source)) {
      return rejectPython("unsupported-dataflow", "Python count assertion is not tied to a direct text read");
    }
    ctx.countAssertions.set(`${source}\0${literal3}`, Number.parseInt(countText, 10));
    return void 0;
  }
  const indexAnchor = matchGroups(statement, PYTHON_INDEX_ANCHOR_PATTERN, 3);
  if (indexAnchor !== null) {
    const [name, source, literalText] = indexAnchor;
    const literal3 = decodePythonString(literalText);
    if (literal3 === null || literal3.length === 0 || !ctx.texts.has(source)) {
      return rejectPython("unsupported-dataflow", "Python index anchor is not tied to a direct text read");
    }
    ctx.anchors.set(name, { source, literal: literal3 });
    return void 0;
  }
  const lineArray = matchGroups(statement, PYTHON_LINE_ARRAY_PATTERN, 2);
  if (lineArray !== null) {
    const [name, pathName] = lineArray;
    const binding = ctx.paths.get(pathName);
    if (binding === void 0) return rejectPython("dynamic-path", "Python line-array target is not literal");
    ctx.lines.set(name, { path: binding.path, edits: /* @__PURE__ */ new Map() });
    return void 0;
  }
  const lineEdit = matchGroups(statement, PYTHON_LINE_EDIT_PATTERN, 3);
  if (lineEdit !== null) {
    const [name, indexText, valueLiteral] = lineEdit;
    const array = ctx.lines.get(name);
    const value = decodePythonString(valueLiteral);
    if (array === void 0 || value === null)
      return rejectPython("unsupported-dataflow", "line edit is not a bounded literal array edit");
    array.edits.set(Number.parseInt(indexText, 10), value);
    return void 0;
  }
  const structuredLoad = matchGroups(statement, PYTHON_STRUCTURED_LOAD_PATTERN, 3);
  if (structuredLoad !== null) {
    const [name, loader, pathName] = structuredLoad;
    const binding = ctx.paths.get(pathName);
    if (binding === void 0) return rejectPython("dynamic-path", "structured Python load target is not literal");
    const format = loader === "tomllib" ? "toml" : loader === "json" ? "json" : "yaml";
    ctx.structured.set(name, { format, path: binding.path, keys: [] });
    return void 0;
  }
  const structuredAssign = matchGroups(statement, PYTHON_STRUCTURED_ASSIGN_PATTERN, 2);
  const structuredTarget = structuredAssign === null ? void 0 : ctx.structured.get(structuredAssign[0]);
  if (structuredAssign !== null && structuredTarget !== void 0) {
    const keys = [];
    for (const [, keyLiteral] of structuredAssign[1].matchAll(PYTHON_STRUCTURED_KEY_SCAN_PATTERN)) {
      const key2 = keyLiteral === void 0 ? null : decodePythonString(keyLiteral);
      if (key2 === null) return rejectStructuredPythonKeys();
      keys.push(key2);
    }
    if (keys.length === 0) return rejectStructuredPythonKeys();
    structuredTarget.keys.push(keys);
    return void 0;
  }
  const append = matchGroups(statement, PYTHON_APPEND_PATTERN, 3);
  if (append !== null) {
    const [pathName, modeLiteral, writtenLiteral] = append;
    const binding = ctx.paths.get(pathName);
    const mode = decodePythonString(modeLiteral);
    const written = decodePythonString(writtenLiteral);
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
  const writeTarget = matchGroups(statement, PYTHON_WRITE_TARGET_PATTERN, 2);
  if (writeTarget !== null) {
    const [pathName, expression] = writeTarget;
    const binding = ctx.paths.get(pathName);
    if (binding === void 0) return rejectPython("dynamic-path", "Python write target is not literal");
    const absolutePath = nodePath4.resolve(ctx.cwd, binding.path);
    return resolvePythonWriteSink(ctx, expression.trim(), absolutePath);
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
var NODE_FS_METHODS = ["readFileSync", "writeFileSync", "appendFileSync"];
function toNodeFsMethod(name) {
  return NODE_FS_METHODS.find((method) => method === name) ?? null;
}
var NODE_STRING_SOURCE = String.raw`(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")`;
var NODE_NAME_SOURCE = `[A-Za-z_$][A-Za-z0-9_$]*`;
var NODE_FS_MEMBER_PATTERN = new RegExp(`^(${NODE_NAME_SOURCE})\\.(readFileSync|writeFileSync|appendFileSync)$`);
var NODE_REQUIRE_FS_MEMBER_PATTERN = /^require\((['"])(?:node:)?fs\1\)\.(readFileSync|writeFileSync|appendFileSync)$/;
var NODE_REQUIRE_FS_CALL_PATTERN = /^(require\((['"])(?:node:)?fs\2\)\.(?:readFileSync|writeFileSync|appendFileSync))\(([\s\S]*)\)$/;
var NODE_NAMED_CALL_PATTERN = /^([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?)\(([\s\S]*)\)$/;
var NODE_REQUIRE_FS_DESTRUCTURE_PATTERN = /^const\s+\{([^}]+)\}\s*=\s*require\((['"])(?:node:)?fs\2\)$/;
var NODE_FS_DESTRUCTURE_ENTRY_PATTERN = /^(readFileSync|writeFileSync|appendFileSync)(?:\s*:\s*([A-Za-z_$][A-Za-z0-9_$]*))?$/;
var NODE_JSON_STRINGIFY_PATTERN = /^JSON\.stringify\(([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*,\s*null\s*,\s*\d+)?\)$/;
var NODE_DIRECT_JSON_PARSE_PATTERN = /^JSON\.parse\((.+)\)$/;
var NODE_LITERAL_VALUE_PATTERN = /^(?:true|false|null|-?\d+(?:\.\d+)?|(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"))$/;
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
  const slice = matchGroups(expression, PYTHON_ANCHOR_SLICE_PATTERN, 4);
  if (slice === null) return "unmatched";
  const [source, anchorName, replacementLiteral, anchorLengthText] = slice;
  const anchor = ctx.anchors.get(anchorName);
  const read = ctx.texts.get(source);
  const replacementText = decodePythonString(replacementLiteral);
  if (anchor === void 0 || read === void 0 || anchor.source !== source || replacementText === null || Number.parseInt(anchorLengthText, 10) !== anchor.literal.length || nodePath4.resolve(ctx.cwd, read.path) !== absolutePath) {
    return rejectPython(
      "unsupported-dataflow",
      "Python slice reconstruction is not tied to one literal anchor",
      absolutePath
    );
  }
  const content = readPythonPreState(ctx, absolutePath, ["match-locations", "deleted-text"]);
  if (typeof content !== "string") return content;
  const offset2 = content.indexOf(anchor.literal);
  const [range] = literalOccurrenceRanges(content, anchor.literal);
  if (offset2 < 0 || range === void 0)
    return rejectPython(
      "evidence-mismatch",
      "Python slice anchor is absent from pre-state",
      absolutePath,
      ctx.preStateRequests
    );
  ctx.resolved.push({
    status: "resolved",
    layer: "python",
    idiom: "python-anchor-slice",
    span: {
      operation: "modify",
      absolutePath,
      lineStart: range.start,
      lineEnd: range.end,
      expectedContent: `${content.slice(0, offset2)}${replacementText}${content.slice(offset2 + anchor.literal.length)}`,
      simpleCommandIndex: 0
    }
  });
  return void 0;
}
function emitPythonLineJoin(ctx, expression, absolutePath) {
  const lineJoin = matchGroups(expression, PYTHON_LINE_JOIN_PATTERN, 2);
  if (lineJoin === null) return "unmatched";
  const [delimiterLiteral, arrayName, suffixLiteral] = lineJoin;
  const delimiter2 = decodePythonString(delimiterLiteral);
  const array = ctx.lines.get(arrayName);
  const suffix = suffixLiteral === void 0 ? "" : decodePythonString(suffixLiteral);
  if (delimiter2 !== "\n" || array === void 0 || suffix === null || suffix !== "" && suffix !== "\n") {
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
  const structuredSink = matchGroups(
    expression,
    /^(json|tomli_w|toml|yaml)\.(dumps|safe_dump)\(([A-Za-z_][A-Za-z0-9_]*)\)$/,
    3
  );
  if (structuredSink === null) return "unmatched";
  const [dumper, , valueName] = structuredSink;
  const value = ctx.structured.get(valueName);
  const sinkFormat = dumper === "json" ? "json" : dumper === "yaml" ? "yaml" : "toml";
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
    const key2 = keyPath.at(-1);
    const [range, ...ambiguous] = key2 === void 0 ? [] : structuredKeyRanges(content, value.format, key2);
    if (range === void 0 || ambiguous.length > 0) {
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
        lineStart: range.start,
        lineEnd: range.end,
        simpleCommandIndex: 0
      }
    });
  }
  return void 0;
}
function resolvePythonWriteSink(ctx, expression, absolutePath) {
  const literal3 = decodePythonString(expression);
  if (literal3 !== null) {
    ctx.resolved.push({
      status: "resolved",
      layer: "python",
      idiom: "python-write",
      span: {
        operation: "create-overwrite",
        absolutePath,
        written: literal3,
        expectedContent: literal3,
        simpleCommandIndex: 0
      }
    });
    return void 0;
  }
  const directReplace = matchGroups(expression, PYTHON_DIRECT_REPLACE_PATTERN, 3);
  let replacement;
  if (directReplace === null) {
    replacement = ctx.replacements.get(expression);
  } else {
    const [source, patternLiteral, replacementLiteral, countText] = directReplace;
    replacement = {
      source,
      pattern: decodePythonString(patternLiteral) ?? "",
      replacement: decodePythonString(replacementLiteral) ?? "",
      count: countText === void 0 ? void 0 : Number.parseInt(countText, 10)
    };
  }
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
  const literal3 = decodeNodeString(expression.trim());
  if (literal3 !== null) return { path: literal3, depth: 0 };
  return ctx.paths.get(expression.trim()) ?? null;
}
function nodeFsMethod(ctx, callee) {
  const bare = ctx.fsFunctions.get(callee);
  if (bare !== void 0) return bare;
  const member = matchGroups(callee, NODE_FS_MEMBER_PATTERN, 2);
  if (member !== null) {
    const [namespace, method] = member;
    return ctx.fsNamespaces.has(namespace) ? toNodeFsMethod(method) : null;
  }
  const required = matchGroups(callee, NODE_REQUIRE_FS_MEMBER_PATTERN, 2);
  return required === null ? null : toNodeFsMethod(required[1]);
}
function nodeParseCall(ctx, expression) {
  const trimmed = expression.trim();
  const requireCall = matchGroups(trimmed, NODE_REQUIRE_FS_CALL_PATTERN, 3);
  const namedCall = requireCall === null ? matchGroups(trimmed, NODE_NAMED_CALL_PATTERN, 2) : null;
  const [callee, argumentText] = requireCall === null ? namedCall ?? [] : [requireCall[0], requireCall[2]];
  if (callee === void 0 || argumentText === void 0) return null;
  const method = nodeFsMethod(ctx, callee.trim());
  if (method === null) return null;
  const args = splitNodeArguments(argumentText);
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
function rejectStructuredNodeKeys() {
  return rejectNode("unsupported-expression", "structured Node mutation requires literal property keys");
}
function consumeNodeStatement(statement, ctx) {
  const requireFs = matchGroups(statement, NODE_REQUIRE_FS_PATTERN, 1);
  if (requireFs !== null) {
    ctx.fsNamespaces.add(requireFs[0]);
    return void 0;
  }
  const destructure = matchGroups(statement, NODE_REQUIRE_FS_DESTRUCTURE_PATTERN, 1);
  if (destructure !== null) {
    for (const entry of destructure[0].split(",")) {
      const binding = matchGroups(entry.trim(), NODE_FS_DESTRUCTURE_ENTRY_PATTERN, 1);
      const method = binding === null ? null : toNodeFsMethod(binding[0]);
      if (binding === null || method === null)
        return rejectNode("unsupported-syntax", "Node fs destructuring contains an unsupported binding");
      ctx.fsFunctions.set(binding[1] ?? method, method);
    }
    return void 0;
  }
  const stringDecl = matchGroups(statement, NODE_STRING_DECL_PATTERN, 2);
  if (stringDecl !== null) {
    const [name, literal3] = stringDecl;
    const path = decodeNodeString(literal3);
    if (path === null) return rejectNode("unsupported-syntax", "Node string literal uses an unsupported escape");
    ctx.paths.set(name, { path, depth: 0 });
    return void 0;
  }
  const nameAlias = matchGroups(statement, NODE_NAME_ALIAS_PATTERN, 2);
  if (nameAlias !== null) {
    const [name, sourceName] = nameAlias;
    const source = ctx.paths.get(sourceName);
    if (source === void 0 || source.depth !== 0) {
      return rejectNode("unsupported-dataflow", "Node path aliases are limited to one literal hop");
    }
    ctx.paths.set(name, { path: source.path, depth: 1 });
    return void 0;
  }
  const genericDecl = matchGroups(statement, NODE_GENERIC_DECL_PATTERN, 2);
  if (genericDecl !== null) {
    const [name, initializer] = genericDecl;
    const expression = initializer.trim();
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
    const replacement = matchGroups(expression, NODE_REPLACE_CALL_PATTERN, 4);
    if (replacement !== null) {
      const [source, replaceMethod, patternLiteral, replacementLiteral] = replacement;
      if (!ctx.texts.has(source))
        return rejectNode("unsupported-dataflow", "Node replace source is not a direct text read");
      const pattern = decodeNodeString(patternLiteral);
      const replacementText = decodeNodeString(replacementLiteral);
      if (pattern === null || pattern.length === 0 || replacementText === null || replacementText.includes("$")) {
        return rejectNode("unsupported-expression", "Node replace requires non-empty literal input");
      }
      ctx.replacements.set(name, {
        source,
        pattern,
        replacement: replacementText,
        global: replaceMethod === "replaceAll"
      });
      return void 0;
    }
    const parsedJson = matchGroups(expression, NODE_JSON_PARSE_PATTERN, 1);
    if (parsedJson !== null) {
      const text2 = ctx.texts.get(parsedJson[0]);
      if (text2 === void 0) return rejectNode("unsupported-dataflow", "JSON.parse source is not a direct text read");
      ctx.structured.set(name, { path: text2.path, keys: [] });
      return void 0;
    }
    const directJson = matchGroups(expression, NODE_DIRECT_JSON_PARSE_PATTERN, 1);
    if (directJson !== null) {
      const read = nodeParseCall(ctx, directJson[0]);
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
  const structuredAssign = matchGroups(statement, NODE_STRUCTURED_ASSIGN_PATTERN, 3);
  const structuredTarget = structuredAssign === null ? void 0 : ctx.structured.get(structuredAssign[0]);
  if (structuredAssign !== null && structuredTarget !== void 0) {
    const [, keyPath, value] = structuredAssign;
    const keys = [];
    for (const [, propertyName, keyLiteral] of keyPath.matchAll(NODE_KEY_SEGMENT_SCAN_PATTERN)) {
      const key2 = propertyName ?? (keyLiteral === void 0 ? null : decodeNodeString(keyLiteral));
      if (key2 === null) return rejectStructuredNodeKeys();
      keys.push(key2);
    }
    if (keys.length === 0) return rejectStructuredNodeKeys();
    if (!NODE_LITERAL_VALUE_PATTERN.test(value.trim())) {
      return rejectNode("unsupported-expression", "structured Node mutation requires a literal value");
    }
    structuredTarget.keys.push(keys);
    return void 0;
  }
  const countGuard = matchGroups(statement, NODE_COUNT_GUARD_PATTERN, 3);
  if (countGuard !== null) {
    const [textName, literalSource, countText] = countGuard;
    const literal3 = decodeNodeString(literalSource);
    if (literal3 === null || literal3.length === 0 || !ctx.texts.has(textName)) {
      return rejectNode("unsupported-dataflow", "Node count guard is not tied to a direct text read");
    }
    ctx.countAssertions.set(`${textName}\0${literal3}`, Number.parseInt(countText, 10));
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
    const writtenExpression = call.args[1];
    if (writtenExpression === void 0 || call.args.length > 3)
      return rejectNode("unsupported-syntax", "Node writeFileSync call has unsupported arguments", binding.path);
    const encoding = call.args[2] === void 0 ? "utf8" : decodeNodeString(call.args[2]);
    if (encoding !== "utf8" && encoding !== "utf-8") {
      return rejectNode("unsupported-encoding", "Node write requires default or UTF-8 encoding", binding.path);
    }
    const absolutePath = nodePath4.resolve(ctx.cwd, binding.path);
    return resolveNodeWriteSink(ctx, writtenExpression, absolutePath);
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
  const literal3 = decodeNodeString(expression);
  if (literal3 !== null) {
    ctx.resolved.push({
      status: "resolved",
      layer: "node",
      idiom: "node-write",
      span: {
        operation: "create-overwrite",
        absolutePath,
        written: literal3,
        expectedContent: literal3,
        simpleCommandIndex: 0
      }
    });
    return void 0;
  }
  const directReplacement = matchGroups(expression, NODE_REPLACE_CALL_PATTERN, 4);
  let replacement;
  if (directReplacement === null) {
    replacement = ctx.replacements.get(expression);
  } else {
    const [source, replaceMethod, patternLiteral, replacementLiteral] = directReplacement;
    replacement = {
      source,
      pattern: decodeNodeString(patternLiteral) ?? "",
      replacement: decodeNodeString(replacementLiteral) ?? "",
      global: replaceMethod === "replaceAll"
    };
  }
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
  const serialized = matchGroups(expression, NODE_JSON_STRINGIFY_PATTERN, 1);
  if (serialized === null) return "unmatched";
  const value = ctx.structured.get(serialized[0]);
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
    const key2 = keyPath.at(-1);
    const [range, ...ambiguous] = key2 === void 0 ? [] : structuredKeyRanges(content, "json", key2);
    if (range === void 0 || ambiguous.length > 0) {
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
        lineStart: range.start,
        lineEnd: range.end,
        simpleCommandIndex: 0
      }
    });
  }
  return void 0;
}
var NUMERIC_SED_ADDRESS_PATTERN = /^(\d+)(?:,(\d+))?s\W/;
function parseNumericSedAddress(script) {
  const address = matchGroups(script, NUMERIC_SED_ADDRESS_PATTERN, 1);
  if (address === null) return null;
  const [startText, endText] = address;
  return {
    start: Number.parseInt(startText, 10),
    end: Number.parseInt(endText ?? startText, 10),
    commandOffset: endText === void 0 ? startText.length : startText.length + 1 + endText.length
  };
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
function resolveNumericSed(patternCommand, address, options, cwd, maxCandidates) {
  if (patternCommand.files.length === 0) {
    return {
      resolved: [],
      unresolved: [
        unresolved("shell", "sed-inplace", "unsupported-syntax", "numeric in-place substitution has no file operand")
      ],
      preStateRequests: []
    };
  }
  const { start, end } = address;
  const substitution = parseLiteralSubstitution(patternCommand.script.slice(address.commandOffset));
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
  const [firstRange] = ranges;
  const lastRange = ranges.at(-1);
  if (patternCommand.kind === "perl" && firstRange !== void 0 && lastRange !== void 0 && ranges.length > 1) {
    ranges = [{ start: firstRange.start, end: lastRange.end }];
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
function parseLiteralListLoop(variable, listSource, body, options, maxCandidates, parse4) {
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
    const result = parse4(expanded.command, { ...options, maxCandidates });
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
function parseCompoundStages(command, split, options, maxCandidates, parse4) {
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
    if (stage === void 0) break;
    const child = parse4(stage.text, options);
    const join12 = stage.precededBy === "and" ? "&&" : stage.precededBy === "or" ? "||" : void 0;
    resolved.push(
      ...child.resolved.map((match) => ({
        ...match,
        span: { ...match.span, simpleCommandIndex: index, join: join12 }
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
  if (split.malformed !== void 0) return null;
  const [stage, ...otherStages] = split.stages;
  const patternCommand = stage === void 0 || otherStages.length > 0 ? null : parsePatternCommand(stage.text);
  if (patternCommand === null) return null;
  const numericAddress = patternCommand.kind === "sed" ? parseNumericSedAddress(patternCommand.script) : null;
  if (numericAddress !== null) return resolveNumericSed(patternCommand, numericAddress, options, cwd, maxCandidates);
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
  if (["yarn", "npm", "pnpm", "make"].includes(argv[0] ?? "") && /(?:generate|build|install)/.test(argv.slice(1).join(" "))) {
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
var LITERAL_LIST_LOOP_PATTERN = /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([\s\S]*?)\s*;\s*do\s+([\s\S]*?)\s*;\s*done\s*$/;
function parseCommandLayered(command, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_ATTRIBUTION_CANDIDATES;
  if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1) {
    throw new Error("maxCandidates must be a positive safe integer");
  }
  if (!canCarryStaticIntent(command)) return { resolved: [], unresolved: [], preStateRequests: [] };
  const interpreted = parseInterpreterAttribution(command, options);
  if (interpreted !== null) return interpreted;
  const loop = matchGroups(command.trim(), LITERAL_LIST_LOOP_PATTERN, 3);
  if (loop !== null) {
    const [variable, listText, body] = loop;
    return parseLiteralListLoop(variable, listText, body, options, maxCandidates, parseCommandLayered);
  }
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
  const recordPaths = (sessionId2, toolUseId) => {
    if (sessionId2.length === 0 || toolUseId.length === 0) {
      throw new Error("planned-touch session and tool-use ids must not be empty");
    }
    return {
      dir: layout.plannedTouchesDir(sessionId2),
      record: layout.plannedTouchRecordFile(sessionId2, toolUseId),
      consumed: layout.plannedTouchConsumedFile(sessionId2, toolUseId)
    };
  };
  const makeRestrictiveDir = (dir) => {
    fs4.mkdirSync(dir, { recursive: true, mode: 448 });
    fs4.chmodSync(layout.base, 448);
    fs4.chmodSync(nodePath4.dirname(dir), 448);
    fs4.chmodSync(dir, 448);
  };
  const claim = (consumed) => {
    try {
      fs4.writeFileSync(consumed, "", { encoding: "utf8", flag: "wx", mode: 384 });
      return true;
    } catch (error) {
      if (errnoCode(error) === "EEXIST") return false;
      throw error;
    }
  };
  const take = (sessionId2, toolUseId) => {
    pruneStaleSessionsThrottled(layout);
    const paths = recordPaths(sessionId2, toolUseId);
    makeRestrictiveDir(paths.dir);
    if (!claim(paths.consumed)) return { status: "consumed" };
    let raw;
    try {
      raw = fs4.readFileSync(paths.record, "utf8");
    } catch (error) {
      if (errnoCode(error) === "ENOENT") return { status: "missing" };
      throw error;
    } finally {
      fs4.rmSync(paths.record, { force: true });
    }
    try {
      const parsed = JSON.parse(raw);
      const record2 = normalizePlannedTouchRecord(parsed, budgets);
      return { status: "record", record: record2 };
    } catch {
      return { status: "missing" };
    }
  };
  return {
    put(record2) {
      pruneStaleSessionsThrottled(layout);
      const normalized = normalizePlannedTouchRecord(record2, budgets);
      const paths = recordPaths(normalized.sessionId, normalized.toolUseId);
      makeRestrictiveDir(paths.dir);
      if (fs4.existsSync(paths.consumed)) {
        throw new Error("planned-touch record has already been consumed or discarded");
      }
      const encoded = JSON.stringify(normalized);
      const tmp = nodePath4.join(
        paths.dir,
        `.${nodePath4.basename(paths.record)}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}.tmp`
      );
      try {
        fs4.writeFileSync(tmp, encoded, { encoding: "utf8", mode: 384 });
        fs4.chmodSync(tmp, 384);
        fs4.renameSync(tmp, paths.record);
      } catch (error) {
        fs4.rmSync(tmp, { force: true });
        throw error;
      }
    },
    consume(sessionId2, toolUseId) {
      const result = take(sessionId2, toolUseId);
      return result.status === "record" ? result.record : null;
    },
    take,
    discard(sessionId2, toolUseId) {
      pruneStaleSessionsThrottled(layout);
      const paths = recordPaths(sessionId2, toolUseId);
      makeRestrictiveDir(paths.dir);
      claim(paths.consumed);
      fs4.rmSync(paths.record, { force: true });
    }
  };
}
var OPERATIONS = [
  "read",
  "create-overwrite",
  "append",
  "modify",
  "rename-copy",
  "truncate",
  "delete"
];
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
function safeInteger(value, min) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}
function validRange(value) {
  return isRecord(value) && safeInteger(value.start, 1) && safeInteger(value.end, value.start);
}
function copyRanges(value, maxRanges, error) {
  if (!Array.isArray(value) || value.length > maxRanges || !value.every(validRange)) throw new Error(error);
  return value.map(({ start, end }) => ({ start, end }));
}
function normalizeEvidence(value) {
  if (value === void 0) return void 0;
  if (!isRecord(value)) throw new Error("invalid planned-touch evidence");
  switch (value.kind) {
    case "literal-occurrences":
      if (typeof value.literal !== "string" || !safeInteger(value.expectedCount, 0)) {
        throw new Error("invalid literal-occurrences evidence");
      }
      return {
        kind: value.kind,
        literal: value.literal,
        ranges: copyRanges(value.ranges, Number.POSITIVE_INFINITY, "invalid literal-occurrences evidence"),
        expectedCount: value.expectedCount
      };
    case "anchor":
      if (typeof value.literal !== "string" || !safeInteger(value.line, 1)) {
        throw new Error("invalid anchor evidence");
      }
      return { kind: value.kind, literal: value.literal, line: value.line };
    case "eof":
      if (!safeInteger(value.line, 0) || !safeInteger(value.byteLength, 0)) {
        throw new Error("invalid eof evidence");
      }
      return { kind: value.kind, line: value.line, byteLength: value.byteLength };
    case "content-digest":
      if (value.algorithm !== "sha256" || typeof value.digest !== "string" || !/^[a-f0-9]{64}$/.test(value.digest) || !validRange(value.range)) {
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
function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}
function normalizePlannedTouchRecord(record2, budgets) {
  if (!isRecord(record2) || record2.version !== 1 || !nonEmptyString(record2.sessionId) || !nonEmptyString(record2.toolUseId) || !nonEmptyString(record2.repoRoot) || typeof record2.createdAtMs !== "number" || !Number.isFinite(record2.createdAtMs) || record2.createdAtMs < 0 || !Array.isArray(record2.touches)) {
    throw new Error("invalid planned-touch record");
  }
  const repoRoot = toPosix(record2.repoRoot);
  if (!nodePath4.isAbsolute(record2.repoRoot) && !/^[A-Za-z]:\//.test(repoRoot)) {
    throw new Error("planned-touch repository root must be absolute");
  }
  if (record2.touches.length > budgets.maxTouchesPerRecord) {
    throw new Error("planned-touch record exceeds touch budget");
  }
  let evidenceBytes = 0;
  const touches = record2.touches.map((touch) => {
    if (!isRecord(touch) || typeof touch.repoRelativePath !== "string") throw new Error("invalid planned touch");
    const repoRelativePath = toPosix(touch.repoRelativePath);
    if (repoRelativePath.length === 0 || repoRelativePath.startsWith("/") || /^[A-Za-z]:\//.test(repoRelativePath) || repoRelativePath.split("/").some((part) => part === "..")) {
      throw new Error("planned-touch path must be repository-relative");
    }
    if (!isOneOf(OPERATIONS, touch.operation)) throw new Error("invalid planned-touch operation");
    if (Array.isArray(touch.ranges) && touch.ranges.length > budgets.maxRangesPerTouch) {
      throw new Error("planned touch exceeds range budget");
    }
    const ranges = copyRanges(touch.ranges, budgets.maxRangesPerTouch, "invalid planned-touch range");
    if (!safeInteger(touch.simpleCommandIndex, 0)) {
      throw new Error("invalid planned-touch command index");
    }
    const evidence = normalizeEvidence(touch.evidence);
    if (evidence !== void 0) evidenceBytes += Buffer.byteLength(JSON.stringify(evidence));
    return {
      repoRelativePath,
      operation: touch.operation,
      ranges,
      simpleCommandIndex: touch.simpleCommandIndex,
      ...evidence === void 0 ? {} : { evidence }
    };
  });
  if (evidenceBytes > budgets.maxEvidenceBytes) throw new Error("planned-touch record exceeds evidence budget");
  const normalized = {
    version: 1,
    sessionId: record2.sessionId,
    toolUseId: record2.toolUseId,
    repoRoot,
    createdAtMs: record2.createdAtMs,
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
    if (caughtProperty(error, "status") !== 1) throw error;
    const failureStdout = caughtProperty(error, "stdout");
    stdout = typeof failureStdout === "string" ? failureStdout : "";
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

// packages/agent-hooks/src/common/touch-core.ts
import { execFileSync as execFileSync5 } from "node:child_process";
import { createHash as createHash2 } from "node:crypto";
import * as fs5 from "node:fs";
import { basename as basename4, dirname as dirname6, join as join5 } from "node:path";

// packages/agent-hooks/src/common/anchor-tree.ts
function collapseByPath(rows) {
  const anchors = [];
  const byPath = /* @__PURE__ */ new Map();
  for (const row of rows) {
    let anchor = byPath.get(row.path);
    if (!anchor) {
      anchor = { path: row.path, ranges: [] };
      byPath.set(row.path, anchor);
      anchors.push(anchor);
    }
    anchor.ranges.push({ range: row.range, suffix: row.suffix });
  }
  return anchors;
}
function splitSegments(path) {
  const dirs = path.split("/");
  const leaf = dirs.pop();
  if (leaf === void 0 || leaf.length === 0 || dirs.some((segment) => segment.length === 0)) return null;
  return { dirs, leaf };
}
function findOrCreateDir(parent, name) {
  for (const child of parent.children) {
    if (child.kind === "dir" && child.name === name) return child;
  }
  const node = { kind: "dir", name, children: [] };
  parent.children.push(node);
  return node;
}
function insertAnchor(root2, { dirs, leaf }, anchor) {
  let cur = root2;
  for (const dir of dirs) {
    cur = findOrCreateDir(cur, dir);
  }
  cur.children.push({ kind: "leaf", name: leaf, anchor });
}
function buildForest(anchors) {
  const root2 = { kind: "dir", name: "", children: [] };
  for (const anchor of anchors) {
    const segments = splitSegments(anchor.path);
    if (segments === null) {
      root2.children.push({ kind: "leaf", name: anchor.path, anchor });
      continue;
    }
    insertAnchor(root2, segments, anchor);
  }
  return root2.children;
}
function foldChain(node) {
  let name = node.name;
  let cur = node;
  while (cur.kind === "dir") {
    const [child, ...siblings] = cur.children;
    if (child === void 0 || siblings.length > 0) break;
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
  return sorted.map((entry, i2) => {
    const label = labelFor(entry.range, sole);
    if (label === null) return `${ownPrefix}${name}${entry.suffix}`;
    const base = i2 === 0 ? `${ownPrefix}${name}${pad}` : `${childPrefix}${blank}`;
    return `${base}${label}${entry.suffix}`;
  });
}
function renderNodes(nodes, prefix) {
  const lines = [];
  const items = nodes.map(foldChain);
  const groupTarget = computeGroupTarget(items);
  items.forEach((item, i2) => {
    const isLast = i2 === items.length - 1;
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

// packages/agent-hooks/src/common/touch-core.ts
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
  for (let i2 = 0; i2 <= last; i2++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i2 + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      starts.push(i2);
      if (starts.length > 1) break;
    }
  }
  const [start, ...duplicates] = starts;
  if (start !== void 0 && duplicates.length === 0) {
    return { start: start + 1, end: start + needle.length };
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
          const command = args[0] === "span" ? resolveGitSpanCommand(args.slice(1), repoRoot) : { executable: "git", argv: args };
          return execFileSync5(command.executable, command.argv, {
            cwd: repoRoot,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: DEFAULT_TIMEOUT_MS
          });
        } catch (err) {
          const stdout = caughtProperty(err, "stdout");
          return typeof stdout === "string" ? stdout : null;
        }
      };
      const lsFiles = capture(["ls-files", "--error-unmatch", "--", ...rels]);
      if (lsFiles !== null) {
        for (const line of lsFiles.split("\n")) {
          const rel = line.trim();
          if (rel.length > 0) real.add(join5(repoRoot, rel));
        }
      }
      const spanList = capture(["span", "list", "--porcelain", ...rels]);
      if (spanList !== null) {
        for (const row of parsePorcelain(spanList)) real.add(join5(repoRoot, row.path));
      }
    }
  }
  cache.realPaths = real;
  return real;
}
function changedOnDisk(cache, cwd) {
  if (cache.changedPaths !== null) return cache.changedPaths;
  const changed = /* @__PURE__ */ new Set();
  if (cache.changedCandidates.length > 0) {
    const repoRoot = resolveRepoRoot(cwd);
    if (repoRoot !== null) {
      const rels = cache.changedCandidates.map((p) => relativeToRepo(repoRoot, p));
      try {
        const out = execFileSync5("git", ["status", "--porcelain", "-z", "--untracked-files=no", "--", ...rels], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: DEFAULT_TIMEOUT_MS
        });
        for (const entry of out.split("\0")) {
          if (entry.length < 4) continue;
          const indexStatus = entry.charAt(0);
          const worktreeStatus = entry.charAt(1);
          if (indexStatus === " " && worktreeStatus === " ") continue;
          if (indexStatus === "?" || indexStatus === "!" || worktreeStatus === "?" || worktreeStatus === "!") {
            continue;
          }
          changed.add(join5(repoRoot, entry.slice(3)));
        }
      } catch (err) {
        void err;
      }
    }
  }
  cache.changedPaths = changed;
  return changed;
}
function workingTreeChanged(probeCache, cwd, absPath) {
  return changedOnDisk(probeCache, cwd).has(absPath);
}
function evaluateWriteGate(input, probeCache) {
  if (input.targetState === "absent") {
    if (fileExists(input.filePath)) return "decisiveFail";
    if (input.postState?.preTrackedDelete === true) return "decisivePass";
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
var MAX_CONTEXT_JSON_BYTES = 16 * 1024 * 1024;
var MAX_CONTEXT_ADDRESSES = 4096;
function record(value, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}
function exactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key2, index) => key2 !== expected[index])) {
    throw new Error(`${label} has unsupported fields`);
  }
}
function stringField(value, label) {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}
function integerField(value, label) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}
function booleanField(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}
function arrayField(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}
function enumField(value, tokens, label) {
  if (!isOneOf(tokens, value)) throw new Error(`${label} has an unsupported token`);
  return value;
}
function decodeExtent(value, label) {
  const object = record(value, label);
  const kind = enumField(object.kind, ["whole", "lines"], `${label}.kind`);
  if (kind === "whole") {
    exactKeys(object, ["kind"], label);
    return { kind };
  }
  exactKeys(object, ["kind", "start", "end"], label);
  const start = integerField(object.start, `${label}.start`);
  const end = integerField(object.end, `${label}.end`);
  if (start < 1 || end < start) throw new Error(`${label} has an invalid line range`);
  return { kind, start, end };
}
function decodeLocation(value, label) {
  const object = record(value, label);
  exactKeys(object, ["path", "extent"], label);
  return { path: stringField(object.path, `${label}.path`), extent: decodeExtent(object.extent, `${label}.extent`) };
}
function decodeStatus(value, label) {
  const object = record(value, label);
  const code = enumField(
    object.code,
    [
      "FRESH",
      "RESOLVED_PENDING_COMMIT",
      "MOVED",
      "CHANGED",
      "DELETED",
      "CONFLICT",
      "SUBMODULE",
      "CONTENT_UNAVAILABLE"
    ],
    `${label}.code`
  );
  if (code !== "CONTENT_UNAVAILABLE") {
    exactKeys(object, ["code"], label);
    return { code };
  }
  exactKeys(object, ["code", "reason", "detail"], label);
  const reason = enumField(
    object.reason,
    [
      "LFS_NOT_FETCHED",
      "LFS_NOT_INSTALLED",
      "PROMISOR_MISSING",
      "SPARSE_EXCLUDED",
      "FILTER_FAILED",
      "IO_ERROR"
    ],
    `${label}.reason`
  );
  return { code, reason, detail: object.detail };
}
function decodeSource(value, label) {
  return enumField(value, ["WORKTREE", "INDEX", "HEAD"], label);
}
function decodeAnchor(value, label) {
  const object = record(value, label);
  exactKeys(object, ["ordinal", "id", "anchored", "current", "status", "source", "sources"], label);
  return {
    ordinal: integerField(object.ordinal, `${label}.ordinal`),
    id: stringField(object.id, `${label}.id`),
    anchored: decodeLocation(object.anchored, `${label}.anchored`),
    current: object.current === null ? null : decodeLocation(object.current, `${label}.current`),
    status: decodeStatus(object.status, `${label}.status`),
    source: object.source === null ? null : decodeSource(object.source, `${label}.source`),
    sources: arrayField(object.sources, `${label}.sources`).map(
      (source, index) => decodeSource(source, `${label}.sources[${index}]`)
    )
  };
}
function decodeOverlap(value, label) {
  const object = record(value, label);
  exactKeys(object, ["scope", "anchor", "basis", "location", "intersection"], label);
  const anchor = record(object.anchor, `${label}.anchor`);
  exactKeys(anchor, ["ordinal", "id"], `${label}.anchor`);
  return {
    scope: integerField(object.scope, `${label}.scope`),
    anchor: {
      ordinal: integerField(anchor.ordinal, `${label}.anchor.ordinal`),
      id: stringField(anchor.id, `${label}.anchor.id`)
    },
    basis: enumField(object.basis, ["anchored", "current"], `${label}.basis`),
    location: decodeLocation(object.location, `${label}.location`),
    intersection: decodeExtent(object.intersection, `${label}.intersection`)
  };
}
function sameExtent(left, right) {
  return left.kind === "whole" && right.kind === "whole" || left.kind === "lines" && right.kind === "lines" && left.start === right.start && left.end === right.end;
}
function sameLocation(left, right) {
  return left.path === right.path && sameExtent(left.extent, right.extent);
}
function intersectExtents(left, right) {
  if (left.kind === "whole") return right;
  if (right.kind === "whole") return left;
  const start = Math.max(left.start, right.start);
  const end = Math.min(left.end, right.end);
  return start <= end ? { kind: "lines", start, end } : null;
}
function decodeContextDocument(stdout) {
  if (Buffer.byteLength(stdout) > MAX_CONTEXT_JSON_BYTES) throw new Error("context document exceeds the size limit");
  const parsed = JSON.parse(stdout);
  const root2 = record(parsed, "context document");
  exactKeys(root2, ["schema_version", "scopes", "mutation", "spans"], "context document");
  if (root2.schema_version !== 1) throw new Error("unsupported context schema version");
  const scopes = arrayField(root2.scopes, "context document.scopes").map((scope, index) => {
    const object = record(scope, `context document.scopes[${index}]`);
    exactKeys(object, ["path", "extent"], `context document.scopes[${index}]`);
    return {
      path: stringField(object.path, `context document.scopes[${index}].path`),
      extent: decodeExtent(object.extent, `context document.scopes[${index}].extent`)
    };
  });
  const mutationObject = record(root2.mutation, "context document.mutation");
  exactKeys(
    mutationObject,
    ["requested", "rewritten", "spans_touched", "anchors_updated", "anchors_removed", "identities_collapsed"],
    "context document.mutation"
  );
  const mutation = {
    requested: booleanField(mutationObject.requested, "context document.mutation.requested"),
    rewritten: booleanField(mutationObject.rewritten, "context document.mutation.rewritten"),
    spans_touched: integerField(mutationObject.spans_touched, "context document.mutation.spans_touched"),
    anchors_updated: integerField(mutationObject.anchors_updated, "context document.mutation.anchors_updated"),
    anchors_removed: integerField(mutationObject.anchors_removed, "context document.mutation.anchors_removed"),
    identities_collapsed: integerField(
      mutationObject.identities_collapsed,
      "context document.mutation.identities_collapsed"
    )
  };
  const spans = arrayField(root2.spans, "context document.spans").map((span, index) => {
    const label = `context document.spans[${index}]`;
    const object = record(span, label);
    exactKeys(object, ["name", "why", "overlaps", "anchors"], label);
    const why = object.why;
    if (why !== null && typeof why !== "string") throw new Error(`${label}.why must be a string or null`);
    return {
      name: stringField(object.name, `${label}.name`),
      why,
      overlaps: arrayField(object.overlaps, `${label}.overlaps`).map(
        (overlap, overlapIndex) => decodeOverlap(overlap, `${label}.overlaps[${overlapIndex}]`)
      ),
      anchors: arrayField(object.anchors, `${label}.anchors`).map(
        (anchor, anchorIndex) => decodeAnchor(anchor, `${label}.anchors[${anchorIndex}]`)
      )
    };
  });
  for (const [spanIndex, span] of spans.entries()) {
    for (const [overlapIndex, overlap] of span.overlaps.entries()) {
      const label = `context document.spans[${spanIndex}].overlaps[${overlapIndex}]`;
      const scope = scopes[overlap.scope];
      if (scope === void 0) throw new Error(`context document.spans[${spanIndex}] references an unknown scope`);
      const anchor = span.anchors[overlap.anchor.ordinal];
      if (anchor === void 0 || anchor.id !== overlap.anchor.id || anchor.ordinal !== overlap.anchor.ordinal) {
        throw new Error(`context document.spans[${spanIndex}] references an unknown anchor`);
      }
      const basisLocation = overlap.basis === "anchored" ? anchor.anchored : anchor.current;
      if (basisLocation === null)
        throw new Error(`${label} uses current basis for an anchor without a current location`);
      if (!sameLocation(overlap.location, basisLocation)) {
        throw new Error(`${label}.location does not equal its referenced ${overlap.basis} location`);
      }
      if (scope.path !== overlap.location.path) throw new Error(`${label} crosses scope and location paths`);
      const expectedIntersection = intersectExtents(scope.extent, overlap.location.extent);
      if (expectedIntersection === null || !sameExtent(expectedIntersection, overlap.intersection))
        throw new Error(`${label}.intersection is not the exact scope/location intersection`);
    }
  }
  return { schema_version: 1, scopes, mutation, spans };
}
function driftKey(name, status) {
  return `${name}	${status}`;
}
function anchorText(row) {
  if (row.start === 0 && row.end === 0) return row.path;
  return `${row.path}#L${row.start}-L${row.end}`;
}
function cleanHeader(fileName) {
  return `${fileName} has implicit couplings:`;
}
function cleanFooter(fileName) {
  return `If you change ${fileName} check the other files to confirm they still work together.`;
}
function driftHeader(driftedCount, kind) {
  if (kind === "write") {
    return driftedCount === 1 ? "This edit put an implicit coupling out of date:" : "This edit put implicit couplings out of date:";
  }
  return driftedCount === 1 ? "This file has an implicit coupling out of date:" : "This file has implicit couplings out of date:";
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
function anchorBullets(anchors, debtRows, logger2) {
  const entries = anchors.map((anchor) => {
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
    return { anchor, row: { path: anchor.path, range: rangeLabel(anchor), suffix } };
  });
  try {
    return renderAnchorTree(collapseByPath(entries.map(({ row }) => row)));
  } catch (err) {
    reportFailOpen(logger2, "anchor-tree-render", err, { span: anchors[0]?.name, anchorCount: anchors.length });
    return entries.map(({ anchor, row }) => `- ${anchorText(anchor)}${row.suffix}`);
  }
}
function renderSpanSection(name, anchors, debtRows, why, logger2) {
  const lines = [`## ${name}`, ...anchorBullets(anchors, debtRows, logger2)];
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
function recoverReadRange(offset2, limit, filePath) {
  if (offset2 === void 0 && limit === void 0) return "whole-file";
  const start = offset2 ?? 1;
  let lineCount2;
  try {
    const content = fs5.readFileSync(filePath, "utf8");
    lineCount2 = content.length === 0 ? 0 : content.split("\n").length;
  } catch {
    return "whole-file";
  }
  const end = Math.min(start + (limit ?? DEFAULT_READ_LIMIT) - 1, Math.max(lineCount2, start));
  return { start, end };
}
function rangesForInput(input) {
  if (input.kind === "read") {
    const recovered2 = recoverReadRange(input.offset, input.limit, input.filePath);
    return recovered2 === "whole-file" ? "whole-file" : [recovered2];
  }
  if (input.range !== void 0) return [input.range];
  const recovered = recoverRangeFromDisk(input.written, input.filePath);
  return recovered === "whole-file" ? "whole-file" : [recovered];
}
function extentIntersects(a, b) {
  if (b === "whole-file" || a.kind === "whole") return true;
  return b.some((range) => rangesIntersect(range, { start: a.start, end: a.end }));
}
function contextStatusToken(status) {
  return status.code === "CONTENT_UNAVAILABLE" ? status.reason : status.code;
}
function contextAnchorRow(name, anchor) {
  const extent = anchor.anchored.extent;
  return {
    name,
    path: anchor.anchored.path,
    start: extent.kind === "whole" ? 0 : extent.start,
    end: extent.kind === "whole" ? 0 : extent.end
  };
}
function contextDriftRow(name, anchor) {
  return { ...contextAnchorRow(name, anchor), status: contextStatusToken(anchor.status) };
}
function spanTouchesInput(span, document, repoPath, ranges) {
  return span.overlaps.some((overlap) => {
    const scope = document.scopes[overlap.scope];
    return scope !== void 0 && scope.path === repoPath && extentIntersects(overlap.intersection, ranges);
  });
}
function renderContextTouch(input, document, repoPath, ranges, memo, logger2) {
  const surfaced = memo.getSurfaced(input.sessionId);
  const sections = [];
  const toRecord = [];
  const driftedNames = [];
  for (const span of document.spans) {
    if (!spanTouchesInput(span, document, repoPath, ranges)) continue;
    const anchors = span.anchors.map((anchor) => contextAnchorRow(span.name, anchor));
    const drift = span.anchors.filter((anchor) => anchor.status.code !== "FRESH").map((anchor) => contextDriftRow(span.name, anchor));
    const debtRows = drift.filter((row) => isDebt(row.status));
    if (drift.length > 0 && debtRows.length === 0) continue;
    const debtStatuses = [...new Set(debtRows.map((row) => row.status))].sort();
    const unsurfacedDebt = debtStatuses.filter((status) => !surfaced.has(driftKey(span.name, status)));
    const isNewName = !surfaced.has(span.name);
    if (!isNewName && unsurfacedDebt.length === 0) continue;
    sections.push(renderSpanSection(span.name, anchors, debtRows, span.why, logger2));
    if (debtStatuses.length > 0) driftedNames.push(span.name);
    if (isNewName) toRecord.push(span.name);
    for (const status of unsurfacedDebt) toRecord.push(driftKey(span.name, status));
  }
  if (sections.length === 0) return null;
  memo.addSurfaced(input.sessionId, toRecord, surfaced);
  const fileName = basename4(input.filePath);
  const header = driftedNames.length > 0 ? driftHeader(driftedNames.length, input.kind) : cleanHeader(fileName);
  const footer = driftedNames.length > 0 ? driftFooter(driftedNames) : cleanFooter(fileName);
  return buildBlock(sections, header, footer);
}
function normalizedAddressIdentity(touches) {
  const byPath = /* @__PURE__ */ new Map();
  for (const touch of touches) {
    const existing = byPath.get(touch.repoPath);
    if (existing === "whole-file" || touch.ranges === "whole-file") {
      byPath.set(touch.repoPath, "whole-file");
    } else {
      byPath.set(touch.repoPath, [...existing ?? [], ...touch.ranges]);
    }
  }
  const identity = [];
  const byPathSorted = [...byPath].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  for (const [path, ranges] of byPathSorted) {
    if (ranges === "whole-file") {
      identity.push(path);
      continue;
    }
    const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    for (const range of sorted) {
      const prior = merged.at(-1);
      if (prior !== void 0 && range.start <= prior.end) prior.end = Math.max(prior.end, range.end);
      else merged.push({ ...range });
    }
    identity.push(...merged.map((range) => `${path}#L${range.start}-L${range.end}`));
  }
  return identity;
}
function deterministicOperationId(invocationId, repoRoot, addresses) {
  const bytes = createHash2("sha256").update(invocationId).update("\0").update(repoRoot).update("\0").update(addresses.join("\0")).digest();
  bytes.writeUInt8(bytes.readUInt8(6) & 15 | 80, 6);
  bytes.writeUInt8(bytes.readUInt8(8) & 63 | 128, 8);
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
async function runTouchHooks(inputs, executors, memo, invocationId, probeCache, logger2) {
  const outputs = inputs.map(() => ({ additionalContext: null, treeModified: false }));
  const prepared = [];
  for (const [index, input] of inputs.entries()) {
    if (input.kind === "write" && input.targetState !== void 0) {
      const probe2 = probeCache ?? createRealityProbeCache(input.targetState === "absent" ? [input.filePath] : []);
      const outcome = evaluateWriteGate(input, probe2);
      if (outcome === "decisiveFail" || outcome === "inconclusive" && input.targetState === "absent") continue;
    }
    const repoRoot = resolveRepoRoot(dirname6(input.filePath));
    if (repoRoot === null) continue;
    prepared.push({
      input,
      index,
      repoRoot,
      repoPath: relativeToRepo(repoRoot, input.filePath),
      ranges: rangesForInput(input),
      partitionKey: `${repoRoot}\0${input.kind === "write" ? "repair" : "read"}`
    });
  }
  const partitions = /* @__PURE__ */ new Map();
  for (const touch of prepared) {
    const partition = partitions.get(touch.partitionKey);
    if (partition === void 0) partitions.set(touch.partitionKey, [touch]);
    else partition.push(touch);
  }
  let queryCount = 0;
  let scopeCount = 0;
  let selectedResultCount = 0;
  let elapsedMs = 0;
  let treeModified = false;
  let failure = null;
  let repairFailure = false;
  const documents = /* @__PURE__ */ new Map();
  const rewrittenPartitions = /* @__PURE__ */ new Set();
  for (const [partitionKey, partition] of partitions) {
    const [first] = partition;
    if (first === void 0) continue;
    const repair = first.input.kind === "write";
    const addresses = partition.flatMap(
      (touch) => touch.ranges === "whole-file" ? [touch.repoPath] : touch.ranges.map((range) => `${touch.repoPath}#L${range.start}-L${range.end}`)
    );
    if (addresses.length > MAX_CONTEXT_ADDRESSES) {
      failure ??= "address_limit";
      if (repair) repairFailure = true;
      continue;
    }
    let request;
    if (repair) {
      if (invocationId === null) {
        failure ??= "missing_invocation_identity";
        repairFailure = true;
        continue;
      }
      const operationId = deterministicOperationId(invocationId, first.repoRoot, normalizedAddressIdentity(partition));
      request = { repoRoot: first.repoRoot, addresses, repair, operationId };
    } else {
      request = { repoRoot: first.repoRoot, addresses, repair };
    }
    queryCount += 1;
    const result = await executors.context(request);
    elapsedMs += result.elapsedMs;
    if (!result.ok) {
      failure ??= result.failure;
      if (repair) repairFailure = true;
      continue;
    }
    scopeCount += result.document.scopes.length;
    selectedResultCount += result.document.spans.length;
    documents.set(partitionKey, result.document);
    if (repair && result.document.mutation.rewritten) {
      treeModified = true;
      rewrittenPartitions.add(partitionKey);
    }
  }
  for (const touch of prepared) {
    const document = documents.get(touch.partitionKey);
    if (document === void 0) continue;
    const singleTouchMutation = (partitions.get(touch.partitionKey)?.length ?? 0) === 1 && rewrittenPartitions.has(touch.partitionKey);
    try {
      const additionalContext = renderContextTouch(touch.input, document, touch.repoPath, touch.ranges, memo, logger2);
      outputs[touch.index] = { additionalContext, treeModified: singleTouchMutation };
    } catch (err) {
      reportFailOpen(logger2, "touch-render", err, { filePath: touch.input.filePath });
      outputs[touch.index] = { additionalContext: null, treeModified: singleTouchMutation };
    }
  }
  if (logger2 !== void 0) flushFailOpen(logger2);
  return {
    outputs,
    treeModified,
    diagnostics: {
      queryCount,
      scopeCount,
      selectedResultCount,
      elapsedMs,
      mutation: treeModified ? "rewritten" : repairFailure ? "unknown" : "unchanged",
      failure
    }
  };
}
var DEFAULT_TIMEOUT_MS = 5e3;
function createDefaultTouchExecutors(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const executors = {
    context: async (request) => {
      const started = performance.now();
      const args = ["context", ...request.addresses, "--format", "json"];
      if (request.repair) args.push("--fix", "--operation-id", request.operationId);
      let stdout;
      try {
        const command = resolveGitSpanCommand(args, request.repoRoot);
        stdout = execFileSync5(command.executable, command.argv, {
          cwd: request.repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs,
          maxBuffer: MAX_CONTEXT_JSON_BYTES + 1
        });
      } catch (error) {
        const code = errnoCode(error);
        const rawStderr = caughtProperty(error, "stderr");
        const stderr = typeof rawStderr === "string" ? rawStderr : Buffer.isBuffer(rawStderr) ? rawStderr.toString("utf8") : void 0;
        const failure = code === "ENOENT" || stderr?.includes("is not a git command") === true ? "command_absent" : code === "ETIMEDOUT" || caughtProperty(error, "signal") === "SIGTERM" || caughtProperty(error, "killed") === true ? "timeout" : code === "ENOBUFS" ? "schema_rejected" : "nonzero_exit";
        return { ok: false, failure, elapsedMs: performance.now() - started };
      }
      if (stdout.trim().length === 0) {
        return { ok: false, failure: "empty_output", elapsedMs: performance.now() - started };
      }
      try {
        const document = decodeContextDocument(stdout);
        if (document.mutation.requested !== request.repair || document.mutation.rewritten && !request.repair) {
          throw new Error("context mutation does not match the requested mode");
        }
        return { ok: true, document, elapsedMs: performance.now() - started };
      } catch (error) {
        return {
          ok: false,
          failure: error instanceof SyntaxError ? "malformed_json" : "schema_rejected",
          elapsedMs: performance.now() - started
        };
      }
    },
    forInvocation: () => executors
  };
  return executors;
}

// packages/agent-hooks/src/common/bash-touch.ts
function bashSpanToTouch(span, sessionId2, cwd, scopeAlreadyResolved = false) {
  if (!scopeAlreadyResolved && !resolveTouchScope(cwd, span.absolutePath)) return null;
  switch (span.operation) {
    case "read":
      return {
        kind: "read",
        sessionId: sessionId2,
        cwd,
        filePath: span.absolutePath,
        offset: span.lineStart,
        limit: span.lineStart !== void 0 && span.lineEnd !== void 0 ? span.lineEnd - span.lineStart + 1 : void 0
      };
    case "create-overwrite":
    case "rename-copy":
      return {
        kind: "write",
        sessionId: sessionId2,
        cwd,
        filePath: span.absolutePath,
        written: "",
        targetState: "exists",
        postState: span.written !== void 0 ? { content: { exact: span.written } } : void 0
      };
    case "truncate":
      return {
        kind: "write",
        sessionId: sessionId2,
        cwd,
        filePath: span.absolutePath,
        written: "",
        targetState: "exists",
        postState: span.size === 0 ? { content: { empty: true } } : span.size !== void 0 ? { content: { size: span.size } } : void 0
      };
    case "append":
      return {
        kind: "write",
        sessionId: sessionId2,
        cwd,
        filePath: span.absolutePath,
        written: span.written ?? "",
        range: span.lineStart !== void 0 ? { start: span.lineStart, end: span.lineEnd ?? span.lineStart } : void 0,
        targetState: "exists",
        postState: span.expectedContent !== void 0 ? { content: { exact: span.expectedContent } } : span.written !== void 0 ? { content: { suffix: span.written } } : void 0
      };
    case "modify":
      return {
        kind: "write",
        sessionId: sessionId2,
        cwd,
        filePath: span.absolutePath,
        written: "",
        targetState: "exists",
        range: span.lineStart !== void 0 ? { start: span.lineStart, end: span.lineEnd ?? span.lineStart } : void 0,
        postState: span.expectedContent !== void 0 ? { content: { exact: span.expectedContent } } : void 0
      };
    case "delete":
      return {
        kind: "write",
        sessionId: sessionId2,
        cwd,
        filePath: span.absolutePath,
        written: "",
        targetState: "absent",
        postState: {
          realDelete: true,
          ...span.preTrackedDelete === true ? { preTrackedDelete: true } : {}
        }
      };
  }
}
function bashResponseInterrupted(toolResponse) {
  if (isRecord(toolResponse)) {
    const timedOutAfterMs = toolResponse.timedOutAfterMs;
    return toolResponse.interrupted === true || toolResponse.is_interrupt === true || typeof timedOutAfterMs === "number" && Number.isFinite(timedOutAfterMs) && timedOutAfterMs >= 0;
  }
  return false;
}
function bashResponseExitCode(toolResponse) {
  if (isRecord(toolResponse)) {
    for (const field of ["exit_code", "exitCode", "exitStatus"]) {
      const code = toolResponse[field];
      if (typeof code === "number" && Number.isInteger(code)) return code;
    }
  }
  return void 0;
}
var FILE_PRODUCING_OPS = /* @__PURE__ */ new Set(["create-overwrite", "rename-copy", "truncate", "append"]);
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
function translateAndGateSpans(groups, order, sessionId2, cwd, scopeAlreadyResolved, probeCache) {
  const evals = /* @__PURE__ */ new Map();
  for (const idx of order) {
    const spans = groups.get(idx);
    if (spans === void 0) continue;
    const readPaths = spans.filter((m) => (m.idiom === "cp-write" || m.idiom === "install-write") && m.span.operation === "read").map((m) => m.span.absolutePath);
    const deletePaths = spans.filter((m) => m.span.operation === "delete").map((m) => m.span.absolutePath);
    let readCursor = 0;
    let deleteCursor = 0;
    const list2 = [];
    for (const m of spans) {
      const touch = bashSpanToTouch(m.span, sessionId2, cwd, scopeAlreadyResolved);
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
      list2.push(entry);
    }
    evals.set(idx, list2);
  }
  return evals;
}
function buildPassByPath(evals, order) {
  const passByPath = /* @__PURE__ */ new Map();
  for (const idx of order) {
    const list2 = evals.get(idx);
    if (list2 === void 0) continue;
    for (const e of list2) {
      if (e.outcome === "decisivePass") {
        const prev = passByPath.get(e.path);
        if (prev === void 0 || idx > prev) passByPath.set(e.path, idx);
      }
    }
  }
  return passByPath;
}
function reconcileAgainstPassMap(evals, order, passByPath) {
  for (const idx of order) {
    const list2 = evals.get(idx);
    if (list2 === void 0) continue;
    for (const e of list2) {
      if (e.outcome === "pending") {
        const passIdx = e.sourceKey !== null ? passByPath.get(e.sourceKey) : void 0;
        e.outcome = passIdx !== void 0 && passIdx > e.commandIndex ? "decisivePass" : "decisiveFail";
      } else if (e.outcome === "decisiveFail") {
        const passIdx = passByPath.get(e.path);
        if (passIdx !== void 0 && passIdx > e.commandIndex) e.explained = true;
      }
    }
  }
}
function buildRecreateByPath(evals, order) {
  const recreateByPath = /* @__PURE__ */ new Map();
  for (const idx of order) {
    const list2 = evals.get(idx);
    if (list2 === void 0) continue;
    for (const e of list2) {
      if (e.outcome === "decisiveFail") continue;
      if (e.touch === null || e.touch.kind !== "write" || e.touch.targetState !== "exists") continue;
      if (!FILE_PRODUCING_OPS.has(e.match.span.operation)) continue;
      const prev = recreateByPath.get(e.path);
      if (prev === void 0 || idx > prev) recreateByPath.set(e.path, idx);
    }
  }
  return recreateByPath;
}
function explainLaterRecreates(evals, order, probeCache, cwd) {
  const recreateByPath = buildRecreateByPath(evals, order);
  if (recreateByPath.size === 0) return;
  for (const idx of order) {
    const list2 = evals.get(idx);
    if (list2 === void 0) continue;
    for (const e of list2) {
      if (e.outcome !== "decisiveFail" || e.explained) continue;
      if (e.touch === null || e.touch.kind !== "write" || e.touch.targetState !== "absent") continue;
      const recreateIdx = recreateByPath.get(e.path);
      if (recreateIdx !== void 0 && recreateIdx > e.commandIndex && workingTreeChanged(probeCache, cwd, e.path)) {
        e.explained = true;
      }
    }
  }
}
function computeVerdicts(order, evals, guardByIndex) {
  const computed = /* @__PURE__ */ new Map();
  for (const idx of order) {
    const list2 = evals.get(idx);
    if (list2 === void 0) {
      const guard = guardByIndex.get(idx);
      computed.set(idx, guard !== void 0 ? guard.exitStatus === 0 ? "succeeded" : "failed" : "unknown");
      continue;
    }
    let failed = false;
    let passed = false;
    for (const e of list2) {
      if (e.outcome === "decisiveFail" && !e.explained) failed = true;
      if (e.outcome === "decisivePass") passed = true;
    }
    computed.set(idx, failed ? "failed" : passed ? "succeeded" : "unknown");
  }
  return computed;
}
function applyJoinFilter(order, groups, guardByIndex, computed) {
  const effective = /* @__PURE__ */ new Map();
  const skipped = /* @__PURE__ */ new Set();
  let prevIndex = null;
  for (const idx of order) {
    const join12 = joinOfCommand(idx, groups, guardByIndex);
    const prevVerdict = prevIndex !== null ? effective.get(prevIndex) : void 0;
    if (prevVerdict !== void 0 && join12 !== void 0) {
      if (join12 === "&&" && prevVerdict === "failed" || join12 === "||" && prevVerdict === "succeeded") {
        effective.set(idx, join12 === "&&" ? "failed" : "succeeded");
        skipped.add(idx);
        prevIndex = idx;
        continue;
      }
    }
    const verdict = computed.get(idx);
    if (verdict === void 0) throw new Error(`applyJoinFilter: command ${idx} has no computed verdict`);
    effective.set(idx, verdict);
    prevIndex = idx;
  }
  return { effective, skipped };
}
function orderCommands(resolved, guards) {
  const groups = /* @__PURE__ */ new Map();
  const guardByIndex = /* @__PURE__ */ new Map();
  const order = [];
  for (const m of resolved) {
    const idx = m.span.simpleCommandIndex;
    const list2 = groups.get(idx);
    if (list2 !== void 0) {
      list2.push(m);
    } else {
      groups.set(idx, [m]);
      order.push(idx);
    }
  }
  for (const g of guards) {
    if (groups.has(g.simpleCommandIndex) || guardByIndex.has(g.simpleCommandIndex)) continue;
    guardByIndex.set(g.simpleCommandIndex, g);
    order.push(g.simpleCommandIndex);
  }
  order.sort((a, b) => a - b);
  return { groups, guardByIndex, order };
}
function seedProbeCache(resolved) {
  const probePaths = [];
  const fileProducingByPath = /* @__PURE__ */ new Map();
  for (const m of resolved) {
    if (m.span.operation === "delete") probePaths.push(m.span.absolutePath);
    else if ((m.idiom === "cp-write" || m.idiom === "install-write") && m.span.operation === "read") {
      probePaths.push(m.span.absolutePath);
    } else if (FILE_PRODUCING_OPS.has(m.span.operation)) {
      const list2 = fileProducingByPath.get(m.span.absolutePath);
      if (list2 !== void 0) list2.push(m.span.simpleCommandIndex);
      else fileProducingByPath.set(m.span.absolutePath, [m.span.simpleCommandIndex]);
    }
  }
  const recreateProbePaths = [];
  for (const m of resolved) {
    if (m.span.operation !== "delete") continue;
    const later = (fileProducingByPath.get(m.span.absolutePath) ?? []).some((i2) => i2 > m.span.simpleCommandIndex);
    if (later) recreateProbePaths.push(m.span.absolutePath);
  }
  return createRealityProbeCache(probePaths, recreateProbePaths);
}
function bashGatePrelude(matches, toolResponse) {
  const resolved = matches.filter((m) => m.status === "resolved");
  if (bashResponseInterrupted(toolResponse)) return { kind: "stop", drops: resolved.length };
  if (resolved.length === 0) return { kind: "stop", drops: 0 };
  if (resolved.length > DEFAULT_MAX_ATTRIBUTION_CANDIDATES) {
    return {
      kind: "stop",
      drops: resolved.length,
      warn: `Bash candidate budget exceeded: ${resolved.length} candidates (limit ${DEFAULT_MAX_ATTRIBUTION_CANDIDATES}); rejecting the complete touch set`
    };
  }
  return { kind: "proceed", resolved, exitCode: bashResponseExitCode(toolResponse) };
}
function selectSurvivors(order, evals, skipped, exitCode) {
  const touches = [];
  for (const idx of order) {
    if (skipped.has(idx)) continue;
    const list2 = evals.get(idx);
    if (list2 === void 0) continue;
    for (const e of list2) {
      if (e.touch === null || e.explained) continue;
      if (e.outcome === "decisiveFail") continue;
      if (e.outcome === "inconclusive" && e.touch.kind === "write" && e.touch.targetState === "absent") continue;
      if (e.outcome === "inconclusive" && e.touch.kind === "write" && exitCode !== void 0 && exitCode !== 0)
        continue;
      touches.push(e.touch);
    }
  }
  return touches;
}
async function runBashTouches(matches, sessionId2, cwd, toolResponse, executors, memo, warn = console.warn, scopeAlreadyResolved = false, reportDiagnostics = () => void 0, invocationId = null) {
  const prelude = bashGatePrelude(matches, toolResponse);
  if (prelude.kind === "stop") {
    if (prelude.warn !== void 0) warn(prelude.warn);
    reportDiagnostics({ executionGateDrops: prelude.drops });
    return [];
  }
  const { resolved, exitCode } = prelude;
  const guards = matches.filter((m) => m.status === "builtin-guard");
  const probeCache = seedProbeCache(resolved);
  const { groups, guardByIndex, order: commandOrder } = orderCommands(resolved, guards);
  const evals = translateAndGateSpans(groups, commandOrder, sessionId2, cwd, scopeAlreadyResolved, probeCache);
  const passByPath = buildPassByPath(evals, commandOrder);
  reconcileAgainstPassMap(evals, commandOrder, passByPath);
  explainLaterRecreates(evals, commandOrder, probeCache, cwd);
  const computed = computeVerdicts(commandOrder, evals, guardByIndex);
  const { skipped } = applyJoinFilter(commandOrder, groups, guardByIndex, computed);
  const touches = selectSurvivors(commandOrder, evals, skipped, exitCode);
  const invocationExecutors = executors.forInvocation?.() ?? executors;
  const batch = await runTouchHooks(touches, invocationExecutors, memo, invocationId, probeCache, { warn });
  const blocks = batch.outputs.flatMap(
    (output) => output.additionalContext === null ? [] : [output.additionalContext]
  );
  reportDiagnostics({ executionGateDrops: resolved.length - touches.length, ...batch.diagnostics });
  return blocks;
}

// packages/agent-hooks/src/common/parse-response.ts
import { existsSync as existsSync5, statSync as statSync6 } from "node:fs";
import { dirname as dirname7, join as join6, resolve as resolvePath2, sep as sep2 } from "node:path";
var MAX_RESPONSE_SPANS = 50;
var SEARCH_BINS = /* @__PURE__ */ new Set(["rg", "grep", "egrep", "fgrep"]);
var VALUE_SHORT_FLAGS = /* @__PURE__ */ new Set(["A", "B", "C", "e", "f", "m", "g", "t", "T"]);
var VALUE_LONG_FLAGS = /* @__PURE__ */ new Set([
  "after-context",
  "before-context",
  "context",
  "max-count",
  "regexp",
  "file",
  "glob",
  "iglob",
  "type",
  "type-not",
  "include",
  "exclude",
  "exclude-dir",
  "exclude-from"
]);
function hasShellExpansion2(s) {
  return /[$`]/.test(s);
}
function isPathspecMagic(p) {
  return /^:[/!^.(]/.test(p);
}
function analyzeSearchArgv(argv, start) {
  const positionals = [];
  let contextFlags = false;
  let numbered = false;
  let withFilename = false;
  let patternFromFlag = false;
  let stdinRedirect = false;
  let i2 = start;
  while (i2 < argv.length) {
    const a = argv[i2];
    if (a === void 0) break;
    if (a === "--") {
      positionals.push(...argv.slice(i2 + 1));
      break;
    }
    if (a.startsWith("<")) {
      stdinRedirect = true;
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
      if (name === "after-context" || name === "before-context" || name === "context") contextFlags = true;
      if (name === "line-number") numbered = true;
      if (name === "with-filename") withFilename = true;
      if (name === "regexp" || name === "file") patternFromFlag = true;
      if (eq === -1 && VALUE_LONG_FLAGS.has(name)) {
        i2 += 2;
        continue;
      }
      i2 += 1;
      continue;
    }
    if (a.startsWith("-") && a !== "-" && a.length > 1) {
      let consumesNext = false;
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (c === void 0) break;
        if (c === "A" || c === "B" || c === "C") contextFlags = true;
        if (c === "n") numbered = true;
        if (c === "H") withFilename = true;
        if (c === "e" || c === "f") patternFromFlag = true;
        if (VALUE_SHORT_FLAGS.has(c)) {
          consumesNext = j === a.length - 1;
          break;
        }
      }
      i2 += consumesNext ? 2 : 1;
      continue;
    }
    positionals.push(a);
    i2 += 1;
  }
  const firstPositional = patternFromFlag ? 0 : 1;
  const pathArgs = positionals.length > firstPositional ? positionals.slice(firstPositional).filter((p) => !isPathspecMagic(p)) : [];
  const pathspecMagic = positionals.length > firstPositional && positionals.slice(firstPositional).some((p) => isPathspecMagic(p));
  return { pathArgs, contextFlags, numbered, withFilename, pathspecMagic, stdinRedirect };
}
function findGitSubcommand2(argv) {
  let dir = null;
  let dirUnresolvable = false;
  let i2 = 1;
  while (i2 < argv.length) {
    const a = argv[i2];
    if (a === void 0) break;
    if (a === "-C") {
      const v = argv[i2 + 1];
      if (v === void 0) return null;
      if (hasShellExpansion2(v)) dirUnresolvable = true;
      else dir = v;
      i2 += 2;
      continue;
    }
    if (a === "-c") {
      i2 += 2;
      continue;
    }
    if (a.startsWith("-")) {
      i2 += 1;
      continue;
    }
    return { dir, dirUnresolvable, subcommand: a, start: i2 + 1 };
  }
  return null;
}
function hasDiffPatchFlag(argv, start) {
  for (let i2 = start; i2 < argv.length; i2++) {
    if (argv[i2] === "-p" || argv[i2] === "--patch") return true;
  }
  return false;
}
function hasRevPathArg(argv, start) {
  const valueFlags = /* @__PURE__ */ new Set(["--format", "--pretty", "--output", "--word-diff-regex"]);
  for (let i2 = start; i2 < argv.length; i2++) {
    const a = argv[i2];
    if (a === void 0) break;
    if (a === "--") return false;
    if (a.startsWith("-") && a !== "-") {
      if (!a.includes("=") && valueFlags.has(a)) i2 += 1;
      continue;
    }
    if (a.includes(":")) return true;
  }
  return false;
}
function hasFlag(argv, start, flag) {
  for (let i2 = start; i2 < argv.length; i2++) {
    const a = argv[i2];
    if (a === void 0) break;
    if (a === "--") return false;
    if (a === flag) return true;
  }
  return false;
}
function hasDiffRevPathArg(argv, start, cwd) {
  const valueFlags = /* @__PURE__ */ new Set([
    "--output",
    "--src-prefix",
    "--dst-prefix",
    "-L",
    "-S",
    "-G",
    "--grep",
    "--author",
    "--committer",
    "--since",
    "--until",
    "--before",
    "--after"
  ]);
  for (let i2 = start; i2 < argv.length; i2++) {
    const a = argv[i2];
    if (a === void 0) break;
    if (a === "--") return false;
    if (a.startsWith("-") && a !== "-") {
      if (!a.includes("=") && valueFlags.has(a)) i2 += 1;
      continue;
    }
    if (a.includes(":") && !existsSync5(resolvePath2(cwd, a))) return true;
  }
  return false;
}
function diffRelativeBase(argv, start, effectiveDir, repoRoot) {
  for (let i2 = start; i2 < argv.length; i2++) {
    const a = argv[i2];
    if (a === void 0) break;
    if (a === "--") return null;
    if (a === "--relative") return { base: effectiveDir, root: effectiveDir };
    if (a.startsWith("--relative=")) {
      const value = a.slice("--relative=".length);
      if (repoRoot === null || hasShellExpansion2(value) || value === "") return "unresolvable";
      const base = resolvePath2(repoRoot, value);
      return { base, root: base };
    }
  }
  return null;
}
var VERBATIM_PASS_BINS = /* @__PURE__ */ new Set(["head", "tail", "wc", "sort", "uniq", "cut"]);
function isRenumberingFilter(argv) {
  const bin = argv[0];
  if (bin === void 0) return true;
  if (bin === "nl") return true;
  if (bin === "sed") return !isVerbatimSedStage(argv);
  if (bin === "awk") return !isVerbatimAwkStage(argv);
  if (bin === "perl") return !isVerbatimPerlStage(argv);
  if (bin === "tr") return !isVerbatimTrStage(argv);
  if (bin === "cat") {
    if (argv.some((a) => a === "--number" || a.startsWith("-") && !a.startsWith("--") && a.includes("n")))
      return true;
    return hasFileOperand(argv);
  }
  if (SEARCH_BINS.has(bin)) {
    if (argv.some((a) => a === "--line-number" || a.startsWith("-") && !a.startsWith("--") && a.includes("n")))
      return true;
    return hasGrepFileOperand(argv);
  }
  if (VERBATIM_PASS_BINS.has(bin)) return hasFileOperand(argv);
  return true;
}
function hasFileOperand(argv) {
  let afterTerminator = false;
  for (let i2 = 1; i2 < argv.length; i2++) {
    const a = argv[i2];
    if (a === void 0) break;
    if (a === "--") {
      afterTerminator = true;
      continue;
    }
    if (a === "-") continue;
    if (afterTerminator || !a.startsWith("-")) return true;
  }
  return false;
}
function hasGrepFileOperand(argv) {
  let patternFromFlag = false;
  let seenPattern = false;
  for (let i2 = 1; i2 < argv.length; i2++) {
    const a = argv[i2];
    if (a === void 0) break;
    if (a === "--") {
      for (let j = i2 + 1; j < argv.length; j++) {
        if (!patternFromFlag && !seenPattern) seenPattern = true;
        else return true;
      }
      return false;
    }
    if (a === "-e" || a === "-f" || a === "--regexp" || a === "--file") {
      patternFromFlag = true;
      i2++;
      continue;
    }
    if (a.startsWith("-")) {
      if (a.startsWith("--")) {
        if (a.startsWith("--regexp=") || a.startsWith("--file=")) patternFromFlag = true;
      } else if (a.length > 2 && (a[1] === "e" || a[1] === "f")) {
        patternFromFlag = true;
      }
      continue;
    }
    if (!patternFromFlag && !seenPattern) seenPattern = true;
    else return true;
  }
  return false;
}
function isVerbatimSedScript(script, suppressAutoPrint) {
  if (suppressAutoPrint) {
    return /^\d+p$/.test(script) || /^\d+,\d+p$/.test(script) || /^\d+,\$p$/.test(script);
  }
  return /^\d+q$/.test(script) || /^\d+d$/.test(script);
}
function isVerbatimSedStage(argv) {
  let script = null;
  let suppressAutoPrint = false;
  for (let i2 = 1; i2 < argv.length; i2++) {
    const a = argv[i2];
    if (a === void 0) break;
    if (a === "-n") {
      suppressAutoPrint = true;
      continue;
    }
    if (a.startsWith("-") && a !== "-") return false;
    if (script !== null) return false;
    script = a;
  }
  return script !== null && isVerbatimSedScript(script, suppressAutoPrint);
}
function isVerbatimAwkStage(argv) {
  const [, program, ...rest] = argv;
  if (program === void 0 || rest.length > 0) return false;
  return /^NR\s*(<=|>=|==|!=|<|>)\s*\d+$/.test(program) || /^NR\s*%\s*\d+\s*(==|!=)\s*\d+$/.test(program);
}
function verbatimPerlScript(argv) {
  const [, first, second, third, ...rest] = argv;
  if (rest.length > 0) return null;
  if (first === "-ne" && second !== void 0 && third === void 0) return second;
  if (first === "-n" && second === "-e" && third !== void 0) return third;
  return null;
}
function isVerbatimPerlStage(argv) {
  const script = verbatimPerlScript(argv);
  if (script === null) return false;
  return /^\s*print\s+(?:if|unless)\s+\$\.\s*(<=|>=|==|!=|<|>)\s*\d+\s*;?\s*$/.test(script);
}
function isVerbatimTrStage(argv) {
  const [, flag, set, ...rest] = argv;
  if (flag !== "-d" || set === void 0 || rest.length > 0) return false;
  return !/[0-9:]/.test(set) && !set.includes("\\n");
}
function completeLines(stdout) {
  const lines = stdout.split("\n");
  lines.pop();
  return lines;
}
function recordsAreOneFile(stdout) {
  const lines = completeLines(stdout);
  if (lines.length === 0) return false;
  return lines.every((line) => line === "" || line === "--" || parseOneFileRecord(line) !== null);
}
function detectLayout(stdout, info, oneFileEligible) {
  if (stdout.includes("\0")) return "null-separated";
  const lines = completeLines(stdout);
  const first = lines.find((line) => line !== "");
  if (first === void 0) return null;
  if (/^\d+[-:]/.test(first)) {
    if (oneFileEligible && recordsAreOneFile(stdout)) return "one-file";
  }
  if (/^[^:]+:\d+/.test(first)) return info.contextFlags ? "context" : "recursive";
  if (info.contextFlags && lines.some((line) => line !== "" && /^[^:]+:\d+/.test(line))) return "context";
  if (/^[^-:]+-\d+-/.test(first)) return info.contextFlags ? "context" : null;
  if (info.numbered && /^[^:]+$/.test(first)) return "heading";
  return null;
}
function parseRecord(line, sep4) {
  const first = line.indexOf(sep4);
  if (first === -1) return null;
  const second = line.indexOf(sep4, first + 1);
  if (second === -1) return null;
  const path = line.slice(0, first);
  const lineToken = line.slice(first + 1, second);
  const text2 = line.slice(second + 1);
  if (path === "" || path.includes(":")) return null;
  if (!/^\d+$/.test(lineToken)) return null;
  const lineNumber = Number.parseInt(lineToken, 10);
  if (lineNumber <= 0) return null;
  return { path, line: lineNumber, text: text2 };
}
function parseOneFileRecord(line) {
  const [prefix, digits] = /^(\d+)([:-])/.exec(line) ?? [];
  if (prefix === void 0 || digits === void 0) return null;
  const lineNumber = Number.parseInt(digits, 10);
  if (lineNumber <= 0) return null;
  return { line: lineNumber, text: line.slice(prefix.length) };
}
function parseContextRecord(line, knownPaths) {
  for (const path of knownPaths) {
    if (!line.startsWith(`${path}-`)) continue;
    const tail = line.slice(path.length + 1);
    const [prefix, digits] = /^(\d+)-/.exec(tail) ?? [];
    if (prefix === void 0 || digits === void 0) continue;
    const lineNumber = Number.parseInt(digits, 10);
    if (lineNumber <= 0) continue;
    return { path, line: lineNumber, text: tail.slice(prefix.length) };
  }
  return null;
}
function lineCount(text2) {
  if (text2 === "") return 0;
  const withoutTrailingNewline = text2.endsWith("\n") ? text2.slice(0, -1) : text2;
  return withoutTrailingNewline.split("\n").length;
}
function decodeSearchLayout(layout, stdout, singleFileArg) {
  const records = [];
  switch (layout) {
    case "recursive":
      for (const line of completeLines(stdout)) {
        const rec = parseRecord(line, ":");
        if (rec !== null) records.push(rec);
      }
      break;
    case "context": {
      const lines = completeLines(stdout);
      const known = /* @__PURE__ */ new Set();
      for (const line of lines) {
        if (line === "--") continue;
        const rec = parseRecord(line, ":");
        if (rec !== null) known.add(rec.path);
      }
      const knownSorted = [...known].sort((a, b) => b.length - a.length);
      for (const line of lines) {
        if (line === "--") continue;
        const rec = parseRecord(line, ":") ?? parseContextRecord(line, knownSorted) ?? parseRecord(line, "-");
        if (rec !== null) records.push(rec);
      }
      break;
    }
    case "heading":
      {
        let current2 = null;
        for (const line of completeLines(stdout)) {
          if (line === "") continue;
          const rec = parseOneFileRecord(line);
          if (rec === null) {
            current2 = line;
          } else if (current2 !== null) {
            records.push({ path: current2, line: rec.line, text: rec.text });
          }
        }
      }
      break;
    case "one-file":
      if (singleFileArg !== null) {
        for (const line of completeLines(stdout)) {
          const rec = parseOneFileRecord(line);
          if (rec !== null) records.push({ path: singleFileArg, line: rec.line, text: rec.text });
        }
      }
      break;
    case "null-separated":
      {
        const parts = stdout.split("\0");
        if (!stdout.endsWith("\0")) parts.pop();
        for (const part of parts) {
          if (part === "") continue;
          const rec = parseRecord(part, ":");
          if (rec === null || rec.line !== 1) continue;
          records.push({ path: rec.path, line: null, text: rec.text });
        }
      }
      break;
  }
  return records;
}
function insideRoot(abs, roots) {
  for (const root2 of roots) {
    if (abs === root2 || abs.startsWith(root2 + sep2)) return true;
  }
  return false;
}
function isFile(abs) {
  try {
    return statSync6(abs).isFile();
  } catch {
    return false;
  }
}
function findGitRoot(startDir) {
  let dir = startDir;
  for (; ; ) {
    if (existsSync5(join6(dir, ".git"))) return dir;
    const parent = dirname7(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function capSpans(spans) {
  if (spans.length <= MAX_RESPONSE_SPANS) return spans;
  const ordered = [...spans].sort(
    (a, b) => a.absolutePath.localeCompare(b.absolutePath) || a.lineStart - b.lineStart || a.lineEnd - b.lineEnd
  );
  return ordered.slice(0, MAX_RESPONSE_SPANS);
}
function coalesce(lines) {
  const [first, ...rest] = [...lines].sort((a, b) => a - b);
  if (first === void 0) return [];
  const ranges = [];
  let start = first;
  let end = first;
  for (const n of rest) {
    if (n <= end + 1) {
      if (n > end) end = n;
    } else {
      ranges.push([start, end]);
      start = n;
      end = n;
    }
  }
  ranges.push([start, end]);
  return ranges;
}
function spansFor(perFile, baseDir, roots) {
  const spans = [];
  for (const [path, lines] of perFile) {
    const abs = resolvePath2(baseDir, path);
    if (!insideRoot(abs, roots)) continue;
    for (const [lineStart, lineEnd] of coalesce([...lines])) {
      spans.push({ lineStart, lineEnd, absolutePath: abs });
    }
  }
  return spans;
}
var HUNK_HEADER2 = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
function stripDiffPrefix(p) {
  return p.startsWith("a/") || p.startsWith("b/") ? p.slice(2) : p;
}
function parseDiffHeader(line) {
  if (line.startsWith("diff --cc ") || line.startsWith("diff --combined ")) return { kind: "combined" };
  if (!line.startsWith("diff --git ")) return null;
  const [oldToken, newToken, ...extra] = line.slice("diff --git ".length).trim().split(/\s+/);
  if (oldToken === void 0 || newToken === void 0 || extra.length > 0 || oldToken.startsWith('"') || newToken.startsWith('"')) {
    return { kind: "unparseable" };
  }
  return { kind: "file", oldPath: stripDiffPrefix(oldToken), newPath: stripDiffPrefix(newToken) };
}
function parseDiffSide(line, marker) {
  if (!line.startsWith(`${marker} `)) return null;
  const p = line.slice(marker.length + 1);
  if (p.startsWith('"')) return { kind: "unparseable" };
  return { kind: "side", path: p === "/dev/null" ? null : stripDiffPrefix(p) };
}
function decodeUnifiedDiff(stdout) {
  const perFile = /* @__PURE__ */ new Map();
  let current2 = null;
  for (const line of completeLines(stdout)) {
    const header = parseDiffHeader(line);
    if (header !== null) {
      current2 = {
        oldPath: header.kind === "file" ? header.oldPath : null,
        newPath: header.kind === "file" ? header.newPath : null,
        rename: false,
        binary: false,
        combined: header.kind === "combined",
        submodule: false,
        unusable: header.kind === "unparseable",
        sawHunk: false
      };
      continue;
    }
    if (current2 === null) continue;
    if (line.startsWith("Binary files ")) {
      current2.binary = true;
      continue;
    }
    const isBodyLine = line.startsWith(" ") || line.startsWith("+") || line.startsWith("-") || line.startsWith("\\");
    if (!isBodyLine && line.includes("mode 160000")) {
      current2.submodule = true;
      continue;
    }
    if (line.includes("Subproject commit")) {
      current2.submodule = true;
      continue;
    }
    if (line.startsWith("rename from ") || line.startsWith("rename to ") || line.startsWith("copy from ") || line.startsWith("copy to ")) {
      current2.rename = true;
      continue;
    }
    if (!current2.sawHunk) {
      const oldSide = parseDiffSide(line, "---");
      if (oldSide !== null) {
        if (oldSide.kind === "unparseable") current2.unusable = true;
        else current2.oldPath = oldSide.path;
        continue;
      }
      const newSide = parseDiffSide(line, "+++");
      if (newSide !== null) {
        if (newSide.kind === "unparseable") current2.unusable = true;
        else current2.newPath = newSide.path;
        continue;
      }
    }
    const hunk = HUNK_HEADER2.exec(line);
    if (hunk !== null) {
      current2.sawHunk = true;
      emitHunkRange(perFile, current2, hunk);
    }
  }
  return perFile;
}
function emitHunkRange(perFile, record2, hunk) {
  if (record2.binary || record2.combined || record2.submodule || record2.unusable) return;
  const [, oldStartText, oldCountText, newStartText, newCountText] = hunk;
  if (oldStartText === void 0 || newStartText === void 0) return;
  const oldStart = Number.parseInt(oldStartText, 10);
  const oldCount = oldCountText === void 0 ? 1 : Number.parseInt(oldCountText, 10);
  const newStart = Number.parseInt(newStartText, 10);
  const newCount = newCountText === void 0 ? 1 : Number.parseInt(newCountText, 10);
  if (record2.rename) {
    if (record2.newPath !== null) addLines(perFile, record2.newPath, newStart, newCount);
    return;
  }
  if (record2.oldPath !== null) addLines(perFile, record2.oldPath, oldStart, oldCount);
  if (record2.newPath !== null) addLines(perFile, record2.newPath, newStart, newCount);
}
function addLines(perFile, path, start, count) {
  if (start < 1 || count <= 0) return;
  let lines = perFile.get(path);
  if (lines === void 0) {
    lines = /* @__PURE__ */ new Set();
    perFile.set(path, lines);
  }
  for (let n = start; n < start + count; n++) lines.add(n);
}
function matchBlameRange(argv, start) {
  let spec = null;
  let specIdx = -1;
  const positionals = [];
  for (let i2 = start; i2 < argv.length; i2++) {
    const a = argv[i2];
    if (a === void 0) break;
    if (a === "--") {
      for (const [offset2, arg] of argv.slice(i2 + 1).entries()) positionals.push({ arg, idx: i2 + 1 + offset2 });
      break;
    }
    if (a === "-L") {
      spec = argv[i2 + 1] ?? null;
      specIdx = i2;
      i2 += 1;
      continue;
    }
    if (a.startsWith("-L")) {
      spec = a.slice(2);
      specIdx = i2;
      continue;
    }
    if (a.startsWith("-")) continue;
    positionals.push({ arg: a, idx: i2 });
  }
  if (spec === null) return null;
  const [, startText, endText] = /^(\d+),(\d+)$/.exec(spec) ?? [];
  if (startText === void 0 || endText === void 0) return null;
  const [file, ...otherFiles] = positionals.filter((p) => p.idx > specIdx);
  if (file === void 0 || otherFiles.length > 0) return null;
  return {
    lineStart: Number.parseInt(startText, 10),
    lineEnd: Number.parseInt(endText, 10),
    fileArg: file.arg
  };
}
function parseResponse(input) {
  const { command, cwd, stdout } = input;
  let currentDir = cwd;
  let gated = null;
  let gatedPrecededBy = "start";
  let gatedRedirect = false;
  let gatedHeredoc = false;
  const split = splitTopLevel(command);
  if (split.malformed !== void 0) return [];
  const parts = split.stages;
  for (let i2 = 0; i2 < parts.length; i2++) {
    const simple = parts[i2];
    if (simple === void 0) break;
    const argv = argvOf(simple.text);
    if (argv === null || argv.length === 0) continue;
    if (argv[0] === "cd") {
      if (gated === null) {
        const target = argv[1];
        if (target !== void 0 && target !== "-" && !hasShellExpansion2(target)) {
          currentDir = resolvePath2(currentDir, target);
        }
      }
      continue;
    }
    if (gated !== null) continue;
    const [bin] = argv;
    if (bin !== void 0 && SEARCH_BINS.has(bin)) {
      gated = { kind: "search", argv, start: 1, dir: null, dirUnresolvable: false };
    } else if (bin === "git") {
      const sub = findGitSubcommand2(argv);
      if (sub !== null) {
        const base2 = { argv, start: sub.start, dir: sub.dir, dirUnresolvable: sub.dirUnresolvable };
        if (sub.subcommand === "grep") gated = { kind: "search", ...base2 };
        else if (sub.subcommand === "show" && !hasRevPathArg(argv, sub.start)) gated = { kind: "diff", ...base2 };
        else if (sub.subcommand === "diff") gated = { kind: "diff", ...base2 };
        else if (sub.subcommand === "log" && hasDiffPatchFlag(argv, sub.start)) gated = { kind: "diff", ...base2 };
        else if (sub.subcommand === "blame") gated = { kind: "blame", ...base2 };
      }
    }
    if (gated === null) continue;
    gatedPrecededBy = simple.precededBy;
    gatedRedirect = hasUnquotedRedirect(simple.text);
    gatedHeredoc = simple.heredoc ?? false;
    for (const [j, sibling2] of parts.entries()) {
      if (j === i2) continue;
      if (j < i2 && parts.slice(j + 1, i2 + 1).every((part) => part.precededBy === "pipe")) continue;
      const siblingText = sibling2.text;
      const siblingArgv = argvOf(siblingText);
      if (siblingArgv === null || siblingArgv.length === 0 || siblingArgv[0] === "cd") continue;
      if (hasUnquotedRedirect(siblingText)) return [];
      if (sibling2.heredoc) return [];
      if (isRenumberingFilter(siblingArgv)) return [];
    }
  }
  if (gated === null || gated.dirUnresolvable) return [];
  const effectiveDir = gated.dir !== null ? resolvePath2(currentDir, gated.dir) : currentDir;
  if (gated.kind === "blame") {
    const m = matchBlameRange(gated.argv, gated.start);
    if (m === null || hasShellExpansion2(m.fileArg) || /[*?]/.test(m.fileArg)) return [];
    return [{ lineStart: m.lineStart, lineEnd: m.lineEnd, absolutePath: resolvePath2(effectiveDir, m.fileArg) }];
  }
  if (stdout.includes("\x1B")) return [];
  if (input.truncated) return [];
  if (gated.kind === "diff") {
    if (hasDiffRevPathArg(gated.argv, gated.start, effectiveDir)) return [];
    const repoRoot = findGitRoot(effectiveDir);
    if (repoRoot === null) return [];
    const relative3 = diffRelativeBase(gated.argv, gated.start, effectiveDir, repoRoot);
    if (relative3 === "unresolvable") return [];
    const base2 = relative3 !== null ? relative3.base : repoRoot;
    const roots2 = relative3 !== null ? [relative3.root] : [repoRoot];
    return capSpans(spansFor(decodeUnifiedDiff(stdout), base2, roots2));
  }
  const info = analyzeSearchArgv(gated.argv, gated.start);
  const stdinFed = gated.kind === "search" && gated.argv[0] !== "git" && info.pathArgs.length === 0 && (gatedPrecededBy === "pipe" || info.stdinRedirect || gatedRedirect || gatedHeredoc);
  if (stdinFed) return [];
  const isGitGrep = gated.kind === "search" && gated.argv[0] === "git";
  const fullName = isGitGrep && hasFlag(gated.argv, gated.start, "--full-name");
  const magic = isGitGrep && info.pathspecMagic;
  const worktreeRoot = magic || fullName ? findGitRoot(effectiveDir) : null;
  if ((magic || fullName) && worktreeRoot === null) return [];
  const base = fullName && worktreeRoot !== null ? worktreeRoot : effectiveDir;
  const roots = magic && worktreeRoot !== null ? [worktreeRoot] : info.pathArgs.length > 0 ? info.pathArgs.map((p) => resolvePath2(effectiveDir, p)) : [effectiveDir];
  const [firstPathArg, ...otherPathArgs] = info.pathArgs;
  const singleFileArg = firstPathArg !== void 0 && otherPathArgs.length === 0 ? firstPathArg : null;
  const oneFileEligible = info.numbered && !info.withFilename && singleFileArg !== null && isFile(resolvePath2(effectiveDir, singleFileArg));
  const layout = detectLayout(stdout, info, oneFileEligible);
  const perFile = /* @__PURE__ */ new Map();
  if (layout !== null) {
    for (const rec of decodeSearchLayout(layout, stdout, singleFileArg)) {
      if (layout === "recursive" && !isFile(resolvePath2(base, rec.path))) continue;
      if (rec.line === null) {
        const total = lineCount(rec.text);
        let lines = perFile.get(rec.path);
        if (lines === void 0) {
          lines = /* @__PURE__ */ new Set();
          perFile.set(rec.path, lines);
        }
        for (let n = 1; n <= total; n++) lines.add(n);
      } else {
        let lines = perFile.get(rec.path);
        if (lines === void 0) {
          lines = /* @__PURE__ */ new Set();
          perFile.set(rec.path, lines);
        }
        lines.add(rec.line);
      }
    }
  }
  const spans = spansFor(perFile, base, roots);
  if (perFile.size === 0 && !info.numbered && stdout !== "" && stdout.endsWith("\n") && singleFileArg !== null) {
    const abs = resolvePath2(effectiveDir, singleFileArg);
    const total = countFileLines(abs);
    if (total !== null && total > 0) {
      spans.push({ lineStart: 1, lineEnd: total, absolutePath: abs });
    }
  }
  return capSpans(spans);
}

// packages/agent-hooks/src/common/bash-attribution.ts
var RESPONSE_TEXT_FIELDS = ["output", "stdout", "content", "text"];
function finiteTimeout(record2) {
  const value = record2.timedOutAfterMs;
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function integerExitStatus(record2) {
  for (const field of ["exit_code", "exitCode", "exitStatus"]) {
    const value = record2[field];
    if (typeof value === "number" && Number.isInteger(value)) return value;
  }
  return void 0;
}
function normalizeBashResponse(toolResponse) {
  if (typeof toolResponse === "string") return { stdout: toolResponse };
  if (Array.isArray(toolResponse)) {
    const text2 = [];
    for (const block of toolResponse) {
      if (isRecord(block) && typeof block.text === "string") text2.push(block.text);
    }
    return { stdout: text2.join("") };
  }
  if (!isRecord(toolResponse)) return null;
  const record2 = toolResponse;
  for (const field of RESPONSE_TEXT_FIELDS) {
    const value = record2[field];
    if (typeof value !== "string") continue;
    const interrupted = record2.interrupted === true || record2.is_interrupt === true || finiteTimeout(record2);
    const rawOutputPath = record2.rawOutputPath;
    return {
      stdout: value,
      stderr: typeof record2.stderr === "string" ? record2.stderr : void 0,
      exitStatus: integerExitStatus(record2),
      truncated: typeof rawOutputPath === "string" && rawOutputPath.length > 0 || rawOutputPath === true || interrupted,
      interrupted
    };
  }
  return null;
}
function createDefaultPlannedTouchStore(layout) {
  return createPlannedTouchStore(layout, DEFAULT_PLANNED_TOUCH_BUDGETS);
}
function readText(path) {
  try {
    return fs6.readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
function planGroupKey(span) {
  return `${span.absolutePath}\0${span.operation}\0${span.simpleCommandIndex}`;
}
function countBy(values) {
  const counts2 = {};
  for (const value of values) counts2[value] = (counts2[value] ?? 0) + 1;
  return counts2;
}
function plannedSpans(record2, cwd, logger2) {
  if (record2 === null) return [];
  const relativeCwd = nodePath5.relative(record2.repoRoot, cwd);
  const cwdInsidePlannedRepo = relativeCwd === "" || relativeCwd !== ".." && !relativeCwd.startsWith(`..${nodePath5.sep}`) && !nodePath5.isAbsolute(relativeCwd);
  if (!cwdInsidePlannedRepo) {
    logger2.warn("git-span static attribution ignored an incompatible planned-touch record", {
      plannedRepoRoot: record2.repoRoot,
      currentCwd: cwd
    });
    return [];
  }
  const matches = [];
  for (const touch of record2.touches) {
    const absolutePath = nodePath5.join(record2.repoRoot, touch.repoRelativePath);
    let expectedContent;
    if (touch.evidence?.kind === "content-digest") {
      const content = readText(absolutePath);
      const digest = content === null ? null : createHash3("sha256").update(content).digest("hex");
      if (digest !== touch.evidence.digest) {
        logger2.warn("git-span static attribution discarded unverifiable planned evidence", {
          path: touch.repoRelativePath,
          reasonCode: "evidence-mismatch"
        });
        continue;
      }
      expectedContent = content ?? void 0;
    }
    const ranges = touch.ranges.length === 0 ? [void 0] : touch.ranges;
    for (const range of ranges) {
      matches.push({
        status: "resolved",
        idiom: "planned-static",
        span: {
          operation: touch.operation,
          absolutePath,
          lineStart: range?.start,
          lineEnd: range?.end,
          expectedContent,
          ...touch.operation === "delete" && touch.evidence?.kind === "tracked" ? { preTrackedDelete: true } : {},
          simpleCommandIndex: touch.simpleCommandIndex
        }
      });
    }
  }
  return matches;
}
function matchKey(match) {
  const span = match.span;
  return [span.absolutePath, span.operation, span.simpleCommandIndex, span.lineStart ?? "", span.lineEnd ?? ""].join(
    "\0"
  );
}
function filterPostTracked(matches, responseSpans, cwd, preTrackedPaths, preTrackedDeletes) {
  const guards = matches.filter(
    (match) => match.status === "builtin-guard"
  );
  const resolved = matches.filter(
    (match) => match.status === "resolved"
  );
  const candidates = [
    ...resolved.map((match) => ({ source: "command", match })),
    ...responseSpans.map((span) => ({ source: "response", span }))
  ];
  const preEligibleCommands = resolved.filter((match) => preTrackedPaths.has(match.span.absolutePath));
  const preEligibleSet = new Set(preEligibleCommands);
  const postCandidates = candidates.filter((value) => value.source === "response" || !preEligibleSet.has(value.match));
  const filtered = filterTrackedEligibility(
    postCandidates.map((value) => ({
      absolutePath: value.source === "command" ? value.match.span.absolutePath : value.span.absolutePath,
      value
    })),
    { cwd }
  );
  const eligibleCommands = new Set(
    filtered.eligible.flatMap(({ value }) => value.source === "command" ? [value.match] : [])
  );
  for (const match of preEligibleCommands) eligibleCommands.add(match);
  const eligibleResponses = filtered.eligible.flatMap(({ value }) => value.source === "response" ? [value.span] : []);
  for (const match of resolved) {
    if (match.span.operation === "delete" && preTrackedDeletes.has(match.span.absolutePath))
      eligibleCommands.add(match);
  }
  const kept = resolved.filter((match) => eligibleCommands.has(match));
  return {
    matches: [...kept, ...guards],
    responseSpans: eligibleResponses,
    trackedDrops: filtered.dropped.filter(({ reason }) => reason === "untracked-path").length,
    scopeDrops: filtered.dropped.filter(
      ({ reason }) => ["outside-repository", "ignored-path", "span-metadata-path"].includes(reason)
    ).length,
    ignoreQueryCount: filtered.ignoreQueryCount,
    trackedQueryCount: filtered.trackedQueryCount,
    eligibilityErrors: filtered.errors
  };
}
async function runResponseReadTouches(spans, cwd, sessionId2, executors, memo, invocationId, logger2) {
  const touches = spans.map(
    (span) => ({
      kind: "read",
      sessionId: sessionId2,
      cwd,
      filePath: span.absolutePath,
      offset: span.lineStart,
      limit: span.lineEnd - span.lineStart + 1
    })
  );
  const batch = await runTouchHooks(touches, executors, memo, invocationId, void 0, logger2);
  return {
    blocks: batch.outputs.flatMap((output) => output.additionalContext === null ? [] : [output.additionalContext]),
    diagnostics: batch.diagnostics
  };
}
async function runLayeredBashTouches(command, cwd, sessionId2, toolUseId, toolResponse, executors, memo, logger2, store) {
  const parserStarted = performance.now();
  const claimed = toolUseId === void 0 ? { status: "missing" } : store.take(sessionId2, toolUseId);
  if (claimed.status === "consumed") return [];
  const record2 = claimed.status === "record" ? claimed.record : null;
  const planned = plannedSpans(record2, cwd, logger2);
  const parsed = parseCommandLayered(command, { cwd, readPreState: readText });
  const preStateKeys = new Set(parsed.preStateRequests.map((request) => planGroupKey(request)));
  const ordinary = parsed.resolved.filter(({ span }) => !preStateKeys.has(planGroupKey(span))).map(({ idiom, span }) => ({ status: "resolved", idiom, span }));
  const detailed = /&&|\|\|/.test(command) ? parseCommandDetailed(command, { cwd }) : [];
  const joinByIndex = new Map([
    ...parsed.resolved.flatMap(
      ({ span }) => span.join === void 0 ? [] : [[span.simpleCommandIndex, span.join]]
    ),
    ...detailed.flatMap(
      (match) => match.status === "resolved" && match.span.join !== void 0 ? [[match.span.simpleCommandIndex, match.span.join]] : []
    )
  ]);
  for (const match of planned) {
    if (match.status === "resolved") match.span.join = joinByIndex.get(match.span.simpleCommandIndex);
  }
  const guards = detailed.filter(
    (match) => match.status === "builtin-guard"
  );
  const seen = new Set(planned.filter((match) => match.status === "resolved").map(matchKey));
  const combined = [
    ...planned,
    ...ordinary.filter((match) => {
      const key2 = matchKey(match);
      if (seen.has(key2)) return false;
      seen.add(key2);
      return true;
    }),
    ...guards
  ];
  const preTrackedDeletes = /* @__PURE__ */ new Set();
  const preTrackedPaths = /* @__PURE__ */ new Set();
  if (record2 !== null) {
    for (const { repoRelativePath, operation, evidence } of record2.touches) {
      const absolutePath = nodePath5.join(record2.repoRoot, repoRelativePath);
      preTrackedPaths.add(absolutePath);
      if (operation === "delete" && evidence?.kind === "tracked") preTrackedDeletes.add(absolutePath);
    }
  }
  const response = bashResponseInterrupted(toolResponse) ? null : normalizeBashResponse(toolResponse);
  const responseSpans = response === null ? [] : parseResponse({ command, cwd, ...response });
  const filtered = filterPostTracked(combined, responseSpans, cwd, preTrackedPaths, preTrackedDeletes);
  const parserLatencyMs = performance.now() - parserStarted;
  const touchStarted = performance.now();
  let executionGateDrops = 0;
  let commandDiagnostics = {};
  const invocationId = toolUseId === void 0 ? null : `${sessionId2}:${toolUseId}`;
  const commandBlocks = await runBashTouches(
    filtered.matches,
    sessionId2,
    cwd,
    toolResponse,
    executors,
    memo,
    (message, context) => logger2.warn(message, context),
    true,
    (diagnostics) => {
      executionGateDrops = diagnostics.executionGateDrops;
      commandDiagnostics = diagnostics;
    },
    invocationId
  );
  const responseBatch = await runResponseReadTouches(
    filtered.responseSpans,
    cwd,
    sessionId2,
    executors,
    memo,
    `${sessionId2}:${toolUseId ?? createHash3("sha256").update(command).digest("hex")}:response`,
    logger2
  );
  const blocks = [...commandBlocks, ...responseBatch.blocks];
  logger2.info?.("git-span static attribution post", {
    resolvedReads: filtered.matches.filter((match) => match.status === "resolved" && match.span.operation === "read").length,
    resolvedWrites: filtered.matches.filter((match) => match.status === "resolved" && match.span.operation !== "read").length,
    unresolvedByIdiom: countBy(parsed.unresolved.map(({ idiom }) => idiom)),
    unresolvedByReason: countBy(parsed.unresolved.map(({ reasonCode }) => reasonCode)),
    scopeDrops: filtered.scopeDrops,
    trackedDrops: filtered.trackedDrops,
    executionGateDrops,
    parserLatencyMs,
    touchLatencyMs: performance.now() - touchStarted,
    ignoreQueryCount: filtered.ignoreQueryCount,
    trackedQueryCount: filtered.trackedQueryCount,
    eligibilityErrors: filtered.eligibilityErrors,
    contextQueryCount: (commandDiagnostics.queryCount ?? 0) + responseBatch.diagnostics.queryCount,
    contextScopeCount: (commandDiagnostics.scopeCount ?? 0) + responseBatch.diagnostics.scopeCount,
    contextSelectedResultCount: (commandDiagnostics.selectedResultCount ?? 0) + responseBatch.diagnostics.selectedResultCount,
    contextElapsedMs: (commandDiagnostics.elapsedMs ?? 0) + responseBatch.diagnostics.elapsedMs,
    contextMutation: commandDiagnostics.mutation ?? "unchanged",
    contextFailure: commandDiagnostics.failure ?? responseBatch.diagnostics.failure,
    dependencyContextSurfaced: blocks.length > 0
  });
  return blocks;
}

// packages/agent-hooks/src/common/update-check-env.ts
function disableUpdateCheck() {
  process.env.GIT_SPAN_DISABLE_UPDATE_CHECK = "1";
}

// packages/agent-hooks/src/codex/apply-patch.ts
import * as fs7 from "node:fs";
var END_PATCH_MARKER = "*** End Patch";
var ADD_FILE_MARKER = "*** Add File: ";
var DELETE_FILE_MARKER = "*** Delete File: ";
var UPDATE_FILE_MARKER = "*** Update File: ";
var MOVE_TO_MARKER = "*** Move to: ";
var EOF_MARKER = "*** End of File";
var CHANGE_CONTEXT_MARKER = "@@ ";
var EMPTY_CHANGE_CONTEXT_MARKER = "@@";
function defaultReadPreEditFile(path) {
  try {
    return fs7.readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
function toPosix2(p) {
  return p.replace(/\\/g, "/");
}
function scanHunks(command) {
  const hunks = [];
  let openUpdate = null;
  for (const raw of command.split("\n")) {
    const headerLine = openUpdate ? raw.replace(/[ \t\r]+$/, "") : raw.trim();
    if (headerLine === END_PATCH_MARKER) {
      openUpdate = null;
      continue;
    }
    if (headerLine.startsWith(ADD_FILE_MARKER)) {
      hunks.push({ kind: "add", path: headerLine.slice(ADD_FILE_MARKER.length) });
      openUpdate = null;
      continue;
    }
    if (headerLine.startsWith(DELETE_FILE_MARKER)) {
      hunks.push({ kind: "delete", path: headerLine.slice(DELETE_FILE_MARKER.length) });
      openUpdate = null;
      continue;
    }
    if (headerLine.startsWith(UPDATE_FILE_MARKER)) {
      const hunk = {
        kind: "update",
        path: headerLine.slice(UPDATE_FILE_MARKER.length),
        movePath: null,
        chunks: []
      };
      hunks.push(hunk);
      openUpdate = hunk;
      continue;
    }
    if (openUpdate) {
      processUpdateLine(openUpdate, raw);
    }
  }
  return hunks;
}
function ensureChunk(hunk) {
  const last = hunk.chunks[hunk.chunks.length - 1];
  if (last) return last;
  const chunk = { changeContext: null, oldLines: [], newLines: [] };
  hunk.chunks.push(chunk);
  return chunk;
}
function processUpdateLine(hunk, raw) {
  const trimmedEnd = raw.replace(/[ \t\r]+$/, "");
  if (trimmedEnd === EOF_MARKER) return;
  if (hunk.chunks.length === 0 && hunk.movePath === null && trimmedEnd.startsWith(MOVE_TO_MARKER)) {
    hunk.movePath = trimmedEnd.slice(MOVE_TO_MARKER.length);
    return;
  }
  if (trimmedEnd === EMPTY_CHANGE_CONTEXT_MARKER) {
    hunk.chunks.push({ changeContext: null, oldLines: [], newLines: [] });
    return;
  }
  if (trimmedEnd.startsWith(CHANGE_CONTEXT_MARKER)) {
    hunk.chunks.push({ changeContext: trimmedEnd.slice(CHANGE_CONTEXT_MARKER.length), oldLines: [], newLines: [] });
    return;
  }
  if (raw === "") {
    const chunk = ensureChunk(hunk);
    chunk.oldLines.push("");
    chunk.newLines.push("");
    return;
  }
  const first = raw[0];
  if (first === " ") {
    const chunk = ensureChunk(hunk);
    const content = raw.slice(1);
    chunk.oldLines.push(content);
    chunk.newLines.push(content);
    return;
  }
  if (first === "+") {
    const chunk = ensureChunk(hunk);
    chunk.newLines.push(raw.slice(1));
    return;
  }
  if (first === "-") {
    const chunk = ensureChunk(hunk);
    chunk.oldLines.push(raw.slice(1));
    return;
  }
}
function splitLines(content) {
  return content.split("\n");
}
function scanLineIndices(lines, value) {
  const out = [];
  for (let i2 = 0; i2 < lines.length; i2++) {
    if (lines[i2] === value) out.push(i2);
  }
  return out;
}
function scanContiguousMatches(haystack, needle) {
  const out = [];
  const first = needle[0];
  if (first === void 0 || needle.length > haystack.length) return out;
  const last = haystack.length - needle.length;
  for (let i2 = 0; i2 <= last; i2++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i2 + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i2);
  }
  return out;
}
function buildLineOccurrences(lines) {
  const occurrences = /* @__PURE__ */ new Map();
  for (const [i2, line] of lines.entries()) {
    const seen = occurrences.get(line);
    if (seen === void 0) occurrences.set(line, i2);
    else if (typeof seen === "number") occurrences.set(line, [seen, i2]);
    else seen.push(i2);
  }
  return occurrences;
}
function occurrencesOf(occurrences, value) {
  const seen = occurrences.get(value);
  if (seen === void 0) return [];
  return typeof seen === "number" ? [seen] : seen;
}
function indexedContiguousMatches(haystack, needle, occurrences) {
  const out = [];
  const first = needle[0];
  if (first === void 0 || needle.length > haystack.length) return out;
  const last = haystack.length - needle.length;
  for (const start of occurrencesOf(occurrences, first)) {
    if (start > last) break;
    let ok = true;
    for (let j = 1; j < needle.length; j++) {
      if (haystack[start + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(start);
  }
  return out;
}
function preEditLines(lines, chunkCount) {
  if (chunkCount <= 1) {
    return {
      lineIndices: (value) => scanLineIndices(lines, value),
      contiguousMatches: (needle) => scanContiguousMatches(lines, needle)
    };
  }
  const occurrences = buildLineOccurrences(lines);
  return {
    lineIndices: (value) => occurrencesOf(occurrences, value),
    contiguousMatches: (needle) => indexedContiguousMatches(lines, needle, occurrences)
  };
}
function locateChunk(preLines, chunk) {
  const block = chunk.oldLines;
  if (block.length === 0) {
    const ctx2 = chunk.changeContext;
    if (ctx2 !== null && ctx2 !== "") {
      const [only, ...others] = preLines.lineIndices(ctx2);
      if (only !== void 0 && others.length === 0) {
        const line = only + 1;
        return { start: line, end: line };
      }
    }
    return null;
  }
  const starts = preLines.contiguousMatches(block);
  const [firstStart] = starts;
  if (firstStart === void 0) return null;
  if (starts.length === 1) return { start: firstStart + 1, end: firstStart + block.length };
  const ctx = chunk.changeContext;
  if (ctx !== null && ctx !== "") {
    for (const c of preLines.lineIndices(ctx)) {
      const after = starts.find((s) => s >= c);
      if (after !== void 0) {
        return { start: after + 1, end: after + block.length };
      }
    }
  }
  return null;
}
function recoverRange2(preLines, chunks) {
  let union = null;
  for (const chunk of chunks) {
    const r = locateChunk(preLines, chunk);
    if (r === null) return null;
    union = union === null ? r : { start: Math.min(union.start, r.start), end: Math.max(union.end, r.end) };
  }
  return union;
}
function parseApplyPatch(command, readPreEditFile = defaultReadPreEditFile) {
  const anchors = [];
  for (const hunk of scanHunks(command)) {
    if (hunk.kind === "add") {
      anchors.push({ path: toPosix2(hunk.path), kind: "create" });
      continue;
    }
    if (hunk.kind === "delete") {
      anchors.push({ path: toPosix2(hunk.path), kind: "whole-write", absent: true });
      continue;
    }
    const targetPath = toPosix2(hunk.movePath ?? hunk.path);
    if (hunk.movePath !== null) {
      anchors.push({ path: targetPath, kind: "whole-write" });
      continue;
    }
    const content = readPreEditFile(hunk.path);
    const pre = content === null ? null : preEditLines(splitLines(content), hunk.chunks.length);
    const range = pre === null ? null : recoverRange2(pre, hunk.chunks);
    if (range !== null) {
      anchors.push({ path: targetPath, kind: "write", range });
    } else {
      anchors.push({ path: targetPath, kind: "whole-write" });
    }
  }
  return anchors;
}

// packages/agent-hooks/src/codex/post-tool-use.ts
import { dirname as dirname9, join as join11, resolve as resolvePath3 } from "node:path";

// packages/agent-hooks/src/common/apply-patch-touch.ts
var noRangeRecovery = () => null;
async function runApplyPatchTouches(patchText, cwd, sessionId2, planned, executors, memo, invocationId, logger2) {
  const plannedPaths = new Set(planned.map(({ absolutePath }) => absolutePath));
  const fallback = parseApplyPatch(patchText, noRangeRecovery).map(
    (anchor) => ({
      absolutePath: abspathAgainst(cwd, anchor.path),
      operation: anchor.absent ? "delete" : anchor.kind === "create" ? "create-overwrite" : "modify",
      ranges: anchor.range === void 0 ? [] : [anchor.range],
      preTrackedDelete: false
    })
  ).filter(({ absolutePath }) => !plannedPaths.has(absolutePath));
  const candidates = [...planned, ...fallback];
  const tracked = filterTrackedEligibility(
    candidates.map((value) => ({ absolutePath: value.absolutePath, value })),
    { cwd }
  );
  const eligible = new Set(tracked.eligible.map(({ value }) => value));
  for (const candidate of candidates) if (candidate.preTrackedDelete) eligible.add(candidate);
  const touches = [];
  for (const candidate of candidates) {
    if (!eligible.has(candidate)) continue;
    const ranges = candidate.ranges.length === 0 ? [void 0] : candidate.ranges;
    for (const range of ranges) {
      touches.push({
        kind: "write",
        sessionId: sessionId2,
        cwd,
        filePath: candidate.absolutePath,
        ...invocationId === null ? {} : { invocationId },
        written: "",
        range,
        targetState: candidate.operation === "delete" ? "absent" : "exists",
        ...candidate.operation === "delete" ? { postState: { realDelete: true } } : {}
      });
    }
  }
  const batch = await runTouchHooks(touches, executors, memo, invocationId, void 0, logger2);
  return batch.outputs.flatMap((output) => output.additionalContext === null ? [] : [output.additionalContext]);
}

// packages/agent-hooks/src/common/commit-runtime.ts
import { randomBytes as randomBytes2 } from "node:crypto";
import { existsSync as existsSync7, lstatSync as lstatSync2, realpathSync as realpathSync3, renameSync as renameSync5, rmSync as rmSync4 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join9 } from "node:path";

// packages/agent-hooks/src/common/commit-association.ts
import { createHash as createHash4 } from "node:crypto";
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
  return createHash4("sha256").update(JSON.stringify([receipt.repository.commonDirectory, document.host, document.sessionId, receipt.sha])).digest("hex");
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
import { isAbsolute as isAbsolute5 } from "node:path";

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
  return text(value) && isAbsolute5(value);
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
function restoreCommitInvocation(enrollment, post) {
  if (enrollment.host !== post.host || enrollment.sessionId !== post.sessionId || enrollment.toolUseId !== post.toolUseId) {
    return reject("post does not match enrolled invocation");
  }
  return {
    ok: true,
    value: { input: enrollment.originalInput, command: enrollment.originalCommand, cwd: enrollment.cwd }
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

// packages/agent-hooks/src/common/commit-observation.ts
import { createHash as createHash5 } from "node:crypto";
import { resolve as resolve6 } from "node:path";

// packages/agent-hooks/src/common/commit-git.ts
import { isAbsolute as isAbsolute6, resolve as resolve5 } from "node:path";

// packages/agent-hooks/src/common/commit-observation.ts
function readCommitObservations(value, enrollment) {
  if (!Array.isArray(value) || value.length > 32) throw new Error("invalid commit observations");
  return value.map((item) => {
    if (!isRecord(item) || !isRecord(item.checkpoint)) throw new Error("invalid commit observation");
    const receipt = validateCommitReceipt(
      {
        schemaVersion: 1,
        invocationKey: enrollment.invocationKey,
        nonce: "observation",
        sha: "a".repeat(isRecord(item.repository) && item.repository.objectFormat === "sha256" ? 64 : 40),
        repository: item.repository
      },
      enrollment
    );
    const point = item.checkpoint;
    if (!receipt.ok || !Number.isSafeInteger(point.offset) || point.offset < 0)
      throw new Error("invalid commit observation checkpoint");
    let checkpoint;
    if (point.existed === false && point.offset === 0) checkpoint = { existed: false, offset: 0 };
    else if (point.existed === true && typeof point.device === "string" && typeof point.inode === "string" && typeof point.prefixDigest === "string" && /^[a-f0-9]{64}$/.test(point.prefixDigest))
      checkpoint = {
        existed: true,
        device: point.device,
        inode: point.inode,
        offset: point.offset,
        prefixDigest: point.prefixDigest
      };
    else throw new Error("invalid commit observation identity");
    return { repository: receipt.value.repository, checkpoint };
  });
}
function observedCommitReceipts(observation, enrollment) {
  const { repository, checkpoint } = observation;
  const append = readCommitReflogAppend(repository.headReflog, checkpoint, COMMIT_RECEIPT_LIMITS.reflogBytes);
  if (append === null) {
    if (checkpoint.existed) throw new Error("observed reflog disappeared");
    return [];
  }
  if (checkpoint.existed && (checkpoint.device !== append.device || checkpoint.inode !== append.inode))
    throw new Error("observed reflog replaced");
  if (append.exceededBudget) throw new Error("reflog evidence exceeds budget");
  if (append.fileSize < checkpoint.offset || append.fileSize - checkpoint.offset !== append.bytes.byteLength)
    throw new Error("observed reflog truncated or incomplete read");
  const text2 = new TextDecoder("utf-8", { fatal: true }).decode(append.bytes);
  if (text2 === "") return [];
  if (!text2.endsWith("\n")) throw new Error("incomplete observed reflog");
  const length = repository.objectFormat === "sha1" ? 40 : 64;
  const record2 = new RegExp(`^([0-9a-f]{${length}}) ([0-9a-f]{${length}}) .+ <[^>]*> [0-9]+ [+-][0-9]{4}\\t(.+)$`);
  const commits = /* @__PURE__ */ new Set();
  for (const line of text2.slice(0, -1).split("\n")) {
    const match = record2.exec(line);
    if (!match) throw new Error("malformed observed reflog");
    const sha = match[2];
    const action = match[3];
    if (sha && action && !/^(?:checkout|reset|fetch|branch): /.test(action) && !/^0+$/.test(sha)) commits.add(sha);
  }
  if (commits.size > COMMIT_RECEIPT_LIMITS.receiptsPerInvocation)
    throw new Error("observed commit count exceeds budget");
  return [...commits].map((sha) => ({
    schemaVersion: 1,
    invocationKey: enrollment.invocationKey,
    nonce: `observed-${createHash5("sha256").update(repository.gitDirectory).digest("hex")}-${sha}`,
    sha,
    repository
  }));
}

// packages/agent-hooks/src/common/commit-storage.ts
import { createHash as createHash6, randomBytes } from "node:crypto";
import {
  closeSync as closeSync3,
  constants as constants2,
  existsSync as existsSync6,
  fstatSync as fstatSync2,
  linkSync,
  lstatSync,
  mkdirSync as mkdirSync5,
  opendirSync,
  openSync as openSync3,
  readFileSync as readFileSync9,
  renameSync as renameSync4,
  rmSync as rmSync3,
  unlinkSync,
  writeFileSync as writeFileSync3
} from "node:fs";
import { dirname as dirname8, isAbsolute as isAbsolute7, join as join8 } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// packages/agent-hooks/src/common/receipt-lock.ts
import { spawn as spawn2 } from "node:child_process";
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
function identityKey(identity) {
  return createHash6("sha256").update(JSON.stringify([identity.host, identity.sessionId, identity.toolUseId])).digest("hex");
}
async function privateDirectory(path, deadline) {
  if (!isAbsolute7(path)) throw new Error("receipt state root must be absolute");
  if (performance.now() >= deadline) throw new Error("receipt directory phase deadline exhausted");
  mkdirSync5(path, { recursive: true, mode: 448 });
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
  const parsed = JSON.parse(readFileSync9(path, "utf8"));
  return parsed;
}
function atomicJson(path, value, immutable = false) {
  const temporary = join8(dirname8(path), `.publish-${randomBytes(16).toString("hex")}`);
  try {
    writeFileSync3(temporary, JSON.stringify(value), { mode: 384, flag: "wx" });
    if (immutable) linkSync(temporary, path);
    else renameSync4(temporary, path);
  } finally {
    rmSync3(temporary, { force: true });
  }
}
function boundedEntries(directory, cap, deadline = Infinity) {
  if (!existsSync6(directory)) return [];
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
async function acquireReceiptClaim(root2, key2, deadline, executable) {
  if (!/^[a-zA-Z0-9_-]+$/.test(key2)) throw new Error("invalid receipt claim key");
  const directory = join8(root2, "claims");
  await privateDirectory(directory, deadline);
  const path = join8(directory, `${key2}.json`);
  const owner = { token: randomBytes(16).toString("hex"), pid: process.pid };
  while (performance.now() < deadline) {
    const lock = await acquireNativeReceiptLock(directory, key2, deadline, executable);
    let retained = false;
    try {
      let prior = null;
      if (existsSync6(path)) {
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
              const current2 = ownerRecord(readJson(path, 4096));
              if (current2?.token !== owner.token || current2.pid !== owner.pid)
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
async function terminalCommitInvocation(identity, options = {}, logger2) {
  const root2 = receiptRoot(options);
  const directory = join9(root2, "invocations", identityKey(identity));
  const started = performance.now();
  let result = { original: null, acknowledged: 0, pending: 0 };
  if (!existsSync7(directory)) return result;
  try {
    const valid = validateCommitEnrollment(readJson(join9(directory, "enrollment.json")));
    if (!valid.ok) throw new Error(valid.reason);
    const original = restoreCommitInvocation(valid.value, identity);
    if (!original.ok) throw new Error(original.reason);
    const contextsPath = join9(directory, "commands.json");
    const executions = existsSync7(contextsPath) ? readExecutionContexts(readJson(contextsPath)) : void 0;
    const restored = {
      ...result,
      original: { ...original.value, ...executions === void 0 ? {} : { executions } }
    };
    result = restored;
    const claim = await acquireReceiptClaim(
      root2,
      `invocation-${identityKey(identity)}`,
      started + COMMIT_RECEIPT_LIMITS.drainMs,
      options.lockExecutable
    );
    if (!claim) {
      logger2?.warn("git-span commit receipts: invocation drain ownership unavailable");
      return restored;
    }
    try {
      const state = readState(directory, valid.value);
      if (state.status === "retired") return restored;
      if (state.status === "active") {
        const observations = readCommitObservations(readJson(join9(directory, "observations.json")), valid.value);
        for (const observation of observations) {
          try {
            for (const receipt of observedCommitReceipts(observation, valid.value)) {
              if (performance.now() >= started + COMMIT_RECEIPT_LIMITS.drainMs)
                throw new Error("commit observation deadline exhausted");
              const object = verifyCommitObject(valid.value.gitExecutable, receipt.repository, receipt.sha);
              if (!object.ok) throw new Error(object.reason);
              await publishReceipt(directory, receipt);
            }
          } catch (error) {
            logger2?.warn(`git-span commit observation: ${errorMessage2(error)}`);
          }
        }
      }
      atomicJson(join9(directory, "state.json"), {
        ...readState(directory, valid.value),
        status: "completed",
        observing: false,
        lastActivityMs: Date.now()
      });
      const drained = await drainDirectory(root2, directory, valid.value, options, started, logger2);
      return { ...restored, ...drained };
    } finally {
      await claim.release();
    }
  } catch (error) {
    logger2?.warn(`git-span commit receipts: ${errorMessage2(error)}`);
    return result;
  }
}
function receiptRoot(options) {
  return options.stateRoot ?? join9(homedir2(), ".cache", "git-span", "commit-receipts");
}
function errorMessage2(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}
function readExecutionContexts(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 32)
    throw new Error("invalid shell execution contexts");
  return value.map((item) => {
    if (!isRecord(item) || typeof item.command !== "string" || !item.command || typeof item.cwd !== "string" || !item.cwd)
      throw new Error("invalid shell execution context");
    return { command: item.command, cwd: item.cwd };
  });
}
function readState(directory, enrollment) {
  const value = readJson(join9(directory, "state.json"));
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
async function publishReceipt(directory, receipt) {
  const enrollment = validateCommitEnrollment(readJson(join9(directory, "enrollment.json")));
  if (!enrollment.ok) throw new Error(enrollment.reason);
  if (existsSync7(join9(directory, "receipts", `${receipt.nonce}.json`))) return;
  const state = readState(directory, enrollment.value);
  if (state.status !== "active") throw new Error("receipt invocation is no longer active");
  atomicJson(join9(directory, "receipts", `${receipt.nonce}.json`), receipt, true);
  const pendingNonces = [...state.pendingNonces, receipt.nonce];
  for (const dropped of pendingNonces.slice(0, -COMMIT_RECEIPT_LIMITS.receiptsPerInvocation))
    rmSync4(join9(directory, "receipts", `${dropped}.json`), { force: true });
  atomicJson(join9(directory, "state.json"), {
    ...state,
    pendingNonces: pendingNonces.slice(-COMMIT_RECEIPT_LIMITS.receiptsPerInvocation),
    lastActivityMs: Date.now()
  });
}
async function drainDirectory(root2, directory, enrollment, options, started, logger2) {
  const deadline = started + COMMIT_RECEIPT_LIMITS.drainMs;
  let acknowledged = 0;
  const names = boundedEntries(join9(directory, "receipts"), COMMIT_RECEIPT_LIMITS.receiptsPerInvocation, deadline);
  for (const name of names) {
    if (performance.now() >= deadline) {
      logger2?.warn("git-span commit receipts: receipt drain deadline exhausted");
      break;
    }
    try {
      if (!/^observed-[a-f0-9]{64}-[a-f0-9]{40}(?:[a-f0-9]{24})?\.json$/.test(name))
        throw new Error("invalid receipt filename");
      const valid = validateCommitReceipt(readJson(join9(directory, "receipts", name)), enrollment);
      if (!valid.ok) throw new Error(valid.reason);
      const document = createCommitNoteDocument(enrollment);
      const association = await acquireReceiptClaim(
        root2,
        `association-${commitAssociationKey(valid.value, document)}`,
        deadline,
        options.lockExecutable
      );
      if (!association) throw new Error("commit association ownership unavailable");
      try {
        const list2 = await invokeNotes(
          enrollment,
          valid.value,
          options,
          ["list", valid.value.sha, "--exact", "--format", "json"],
          void 0,
          started
        );
        const existing = validateCommitNotesList(JSON.parse(list2), valid.value.sha);
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
        rmSync4(join9(directory, "receipts", name));
        acknowledged++;
      } finally {
        await association.release();
      }
    } catch (error) {
      logger2?.warn(`git-span commit receipts: ${errorMessage2(error)}`);
    }
  }
  const pendingNames = boundedEntries(join9(directory, "receipts"), COMMIT_RECEIPT_LIMITS.receiptsPerInvocation);
  const state = readState(directory, enrollment);
  atomicJson(join9(directory, "state.json"), {
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

// packages/agent-hooks/src/codex/commit-exec.ts
import { existsSync as existsSync8 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { join as join10 } from "node:path";
function root(options) {
  return options.stateRoot ?? join10(homedir3(), ".cache", "git-span", "commit-receipts");
}
function sessionId(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && value.length > 0 && value.length <= 128) return value;
  return null;
}
function yieldedExecution(response) {
  return isRecord(response) && (response.exit_code === void 0 || response.exit_code === null) ? sessionId(response.session_id) : null;
}
function completedExecution(response) {
  return isRecord(response) && typeof response.exit_code === "number" && Number.isInteger(response.exit_code);
}
function polledExecution(input) {
  if (!isRecord(input)) return null;
  if (typeof input.arguments === "string") {
    if (Buffer.byteLength(input.arguments) > COMMIT_RECEIPT_LIMITS.jsonFileBytes) return null;
    try {
      const parsed = JSON.parse(input.arguments);
      return isRecord(parsed) ? sessionId(parsed.session_id) : null;
    } catch {
      return null;
    }
  }
  return sessionId(input.session_id);
}
async function retainExecution(identity, executionId, options) {
  const directory = join10(root(options), "invocations", identityKey(identity));
  if (!existsSync8(directory)) return;
  const deadline = performance.now() + COMMIT_RECEIPT_LIMITS.drainMs;
  const claim = await acquireReceiptClaim(
    root(options),
    `invocation-${identityKey(identity)}`,
    deadline,
    options.lockExecutable
  );
  if (!claim) throw new Error("yielded execution ownership unavailable");
  try {
    const stored = validateCommitEnrollment(readJson(join10(directory, "enrollment.json")));
    if (!stored.ok || stored.value.host !== identity.host || stored.value.sessionId !== identity.sessionId || stored.value.toolUseId !== identity.toolUseId)
      throw new Error("yielded execution enrollment mismatch");
    const existingPath = join10(directory, "exec-session.json");
    if (existsSync8(existingPath)) {
      const existing = readJson(existingPath);
      if (!isRecord(existing) || existing.executionId !== executionId || existing.invocationKey !== stored.value.invocationKey)
        throw new Error("yielded execution transport identity changed");
    }
    atomicJson(join10(directory, "exec-session.json"), { executionId, invocationKey: stored.value.invocationKey });
  } finally {
    await claim.release();
  }
}
function findExecution(session, executionId, options) {
  const directory = join10(root(options), "invocations");
  if (!existsSync8(directory)) return null;
  const deadline = performance.now() + COMMIT_RECEIPT_LIMITS.drainMs;
  let result = null;
  for (const key2 of boundedEntries(directory, COMMIT_RECEIPT_LIMITS.invocations, deadline)) {
    if (performance.now() >= deadline) throw new Error("yielded execution lookup deadline exhausted");
    const path = join10(directory, key2);
    const mappingPath = join10(path, "exec-session.json");
    if (!existsSync8(mappingPath)) continue;
    const mapping = readJson(mappingPath);
    if (!isRecord(mapping) || mapping.executionId !== executionId) continue;
    const valid = validateCommitEnrollment(readJson(join10(path, "enrollment.json")));
    if (!valid.ok || mapping.invocationKey !== valid.value.invocationKey)
      throw new Error("invalid yielded execution identity");
    if (valid.value.host !== "codex" || valid.value.sessionId !== session) continue;
    if (result !== null) throw new Error("ambiguous yielded execution identity");
    result = { host: "codex", sessionId: session, toolUseId: valid.value.toolUseId };
  }
  return result;
}

// packages/agent-hooks/src/codex/execution-plan.ts
var COMMAND_PREFIX = "node -e '/*git-span-execution-plan*/";
function isExecutionPlanCommand(command) {
  return command.startsWith(COMMAND_PREFIX);
}

// node_modules/acorn/dist/acorn.mjs
var astralIdentifierCodes = [509, 0, 227, 0, 150, 4, 294, 9, 1368, 2, 2, 1, 6, 3, 41, 2, 5, 0, 166, 1, 574, 3, 9, 9, 7, 9, 32, 4, 318, 1, 78, 5, 71, 10, 50, 3, 123, 2, 54, 14, 32, 10, 3, 1, 11, 3, 46, 10, 8, 0, 46, 9, 7, 2, 37, 13, 2, 9, 6, 1, 45, 0, 13, 2, 49, 13, 9, 3, 2, 11, 83, 11, 7, 0, 3, 0, 158, 11, 6, 9, 7, 3, 56, 1, 2, 6, 3, 1, 3, 2, 10, 0, 11, 1, 3, 6, 4, 4, 68, 8, 2, 0, 3, 0, 2, 3, 2, 4, 2, 0, 15, 1, 83, 17, 10, 9, 5, 0, 82, 19, 13, 9, 214, 6, 3, 8, 28, 1, 83, 16, 16, 9, 82, 12, 9, 9, 7, 19, 58, 14, 5, 9, 243, 14, 166, 9, 71, 5, 2, 1, 3, 3, 2, 0, 2, 1, 13, 9, 120, 6, 3, 6, 4, 0, 29, 9, 41, 6, 2, 3, 9, 0, 10, 10, 47, 15, 199, 7, 137, 9, 54, 7, 2, 7, 17, 9, 57, 21, 2, 13, 123, 5, 4, 0, 2, 1, 2, 6, 2, 0, 9, 9, 49, 4, 2, 1, 2, 4, 9, 9, 55, 9, 266, 3, 10, 1, 2, 0, 49, 6, 4, 4, 14, 10, 5350, 0, 7, 14, 11465, 27, 2343, 9, 87, 9, 39, 4, 60, 6, 26, 9, 535, 9, 470, 0, 2, 54, 8, 3, 82, 0, 12, 1, 19628, 1, 4178, 9, 519, 45, 3, 22, 543, 4, 4, 5, 9, 7, 3, 6, 31, 3, 149, 2, 1418, 49, 513, 54, 5, 49, 9, 0, 15, 0, 23, 4, 2, 14, 1361, 6, 2, 16, 3, 6, 2, 1, 2, 4, 101, 0, 161, 6, 10, 9, 357, 0, 62, 13, 499, 13, 245, 1, 2, 9, 233, 0, 3, 0, 8, 1, 6, 0, 475, 6, 110, 6, 6, 9, 4759, 9, 787719, 239];
var astralIdentifierStartCodes = [0, 11, 2, 25, 2, 18, 2, 1, 2, 14, 3, 13, 35, 122, 70, 52, 268, 28, 4, 48, 48, 31, 14, 29, 6, 37, 11, 29, 3, 35, 5, 7, 2, 4, 43, 157, 19, 35, 5, 35, 5, 39, 9, 51, 13, 10, 2, 14, 2, 6, 2, 1, 2, 10, 2, 14, 2, 6, 2, 1, 4, 51, 13, 310, 10, 21, 11, 7, 25, 5, 2, 41, 2, 8, 70, 5, 3, 0, 2, 43, 2, 1, 4, 0, 3, 22, 11, 22, 10, 30, 66, 18, 2, 1, 11, 21, 11, 25, 7, 25, 39, 55, 7, 1, 65, 0, 16, 3, 2, 2, 2, 28, 43, 28, 4, 28, 36, 7, 2, 27, 28, 53, 11, 21, 11, 18, 14, 17, 111, 72, 56, 50, 14, 50, 14, 35, 39, 27, 10, 22, 251, 41, 7, 1, 17, 5, 57, 28, 11, 0, 9, 21, 43, 17, 47, 20, 28, 22, 13, 52, 58, 1, 3, 0, 14, 44, 33, 24, 27, 35, 30, 0, 3, 0, 9, 34, 4, 0, 13, 47, 15, 3, 22, 0, 2, 0, 36, 17, 2, 24, 20, 1, 64, 6, 2, 0, 2, 3, 2, 14, 2, 9, 8, 46, 39, 7, 3, 1, 3, 21, 2, 6, 2, 1, 2, 4, 4, 0, 19, 0, 13, 4, 31, 9, 2, 0, 3, 0, 2, 37, 2, 0, 26, 0, 2, 0, 45, 52, 19, 3, 21, 2, 31, 47, 21, 1, 2, 0, 185, 46, 42, 3, 37, 47, 21, 0, 60, 42, 14, 0, 72, 26, 38, 6, 186, 43, 117, 63, 32, 7, 3, 0, 3, 7, 2, 1, 2, 23, 16, 0, 2, 0, 95, 7, 3, 38, 17, 0, 2, 0, 29, 0, 11, 39, 8, 0, 22, 0, 12, 45, 20, 0, 19, 72, 200, 32, 32, 8, 2, 36, 18, 0, 50, 29, 113, 6, 2, 1, 2, 37, 22, 0, 26, 5, 2, 1, 2, 31, 15, 0, 24, 43, 261, 18, 16, 0, 2, 12, 2, 33, 125, 0, 80, 921, 103, 110, 18, 195, 2637, 96, 16, 1071, 18, 5, 26, 3994, 6, 582, 6842, 29, 1763, 568, 8, 30, 18, 78, 18, 29, 19, 47, 17, 3, 32, 20, 6, 18, 433, 44, 212, 63, 33, 24, 3, 24, 45, 74, 6, 0, 67, 12, 65, 1, 2, 0, 15, 4, 10, 7381, 42, 31, 98, 114, 8702, 3, 2, 6, 2, 1, 2, 290, 16, 0, 30, 2, 3, 0, 15, 3, 9, 395, 2309, 106, 6, 12, 4, 8, 8, 9, 5991, 84, 2, 70, 2, 1, 3, 0, 3, 1, 3, 3, 2, 11, 2, 0, 2, 6, 2, 64, 2, 3, 3, 7, 2, 6, 2, 27, 2, 3, 2, 4, 2, 0, 4, 6, 2, 339, 3, 24, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 7, 1845, 30, 7, 5, 262, 61, 147, 44, 11, 6, 17, 0, 322, 29, 19, 43, 485, 27, 229, 29, 3, 0, 208, 30, 2, 2, 2, 1, 2, 6, 3, 4, 10, 1, 225, 6, 2, 3, 2, 1, 2, 14, 2, 196, 60, 67, 8, 0, 1205, 3, 2, 26, 2, 1, 2, 0, 3, 0, 2, 9, 2, 3, 2, 0, 2, 0, 7, 0, 5, 0, 2, 0, 2, 0, 2, 2, 2, 1, 2, 0, 3, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 1, 2, 0, 3, 3, 2, 6, 2, 3, 2, 3, 2, 0, 2, 9, 2, 16, 6, 2, 2, 4, 2, 16, 4421, 42719, 33, 4381, 3, 5773, 3, 7472, 16, 621, 2467, 541, 1507, 4938, 6, 8489];
var nonASCIIidentifierChars = "\u200C\u200D\xB7\u0300-\u036F\u0387\u0483-\u0487\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u0610-\u061A\u064B-\u0669\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u06F0-\u06F9\u0711\u0730-\u074A\u07A6-\u07B0\u07C0-\u07C9\u07EB-\u07F3\u07FD\u0816-\u0819\u081B-\u0823\u0825-\u0827\u0829-\u082D\u0859-\u085B\u0897-\u089F\u08CA-\u08E1\u08E3-\u0903\u093A-\u093C\u093E-\u094F\u0951-\u0957\u0962\u0963\u0966-\u096F\u0981-\u0983\u09BC\u09BE-\u09C4\u09C7\u09C8\u09CB-\u09CD\u09D7\u09E2\u09E3\u09E6-\u09EF\u09FE\u0A01-\u0A03\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A66-\u0A71\u0A75\u0A81-\u0A83\u0ABC\u0ABE-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AE2\u0AE3\u0AE6-\u0AEF\u0AFA-\u0AFF\u0B01-\u0B03\u0B3C\u0B3E-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B55-\u0B57\u0B62\u0B63\u0B66-\u0B6F\u0B82\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD7\u0BE6-\u0BEF\u0C00-\u0C04\u0C3C\u0C3E-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C62\u0C63\u0C66-\u0C6F\u0C81-\u0C83\u0CBC\u0CBE-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CE2\u0CE3\u0CE6-\u0CEF\u0CF3\u0D00-\u0D03\u0D3B\u0D3C\u0D3E-\u0D44\u0D46-\u0D48\u0D4A-\u0D4D\u0D57\u0D62\u0D63\u0D66-\u0D6F\u0D81-\u0D83\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DE6-\u0DEF\u0DF2\u0DF3\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u0E50-\u0E59\u0EB1\u0EB4-\u0EBC\u0EC8-\u0ECE\u0ED0-\u0ED9\u0F18\u0F19\u0F20-\u0F29\u0F35\u0F37\u0F39\u0F3E\u0F3F\u0F71-\u0F84\u0F86\u0F87\u0F8D-\u0F97\u0F99-\u0FBC\u0FC6\u102B-\u103E\u1040-\u1049\u1056-\u1059\u105E-\u1060\u1062-\u1064\u1067-\u106D\u1071-\u1074\u1082-\u108D\u108F-\u109D\u135D-\u135F\u1369-\u1371\u1712-\u1715\u1732-\u1734\u1752\u1753\u1772\u1773\u17B4-\u17D3\u17DD\u17E0-\u17E9\u180B-\u180D\u180F-\u1819\u18A9\u1920-\u192B\u1930-\u193B\u1946-\u194F\u19D0-\u19DA\u1A17-\u1A1B\u1A55-\u1A5E\u1A60-\u1A7C\u1A7F-\u1A89\u1A90-\u1A99\u1AB0-\u1ABD\u1ABF-\u1ADD\u1AE0-\u1AEB\u1B00-\u1B04\u1B34-\u1B44\u1B50-\u1B59\u1B6B-\u1B73\u1B80-\u1B82\u1BA1-\u1BAD\u1BB0-\u1BB9\u1BE6-\u1BF3\u1C24-\u1C37\u1C40-\u1C49\u1C50-\u1C59\u1CD0-\u1CD2\u1CD4-\u1CE8\u1CED\u1CF4\u1CF7-\u1CF9\u1DC0-\u1DFF\u200C\u200D\u203F\u2040\u2054\u20D0-\u20DC\u20E1\u20E5-\u20F0\u2CEF-\u2CF1\u2D7F\u2DE0-\u2DFF\u302A-\u302F\u3099\u309A\u30FB\uA620-\uA629\uA66F\uA674-\uA67D\uA69E\uA69F\uA6F0\uA6F1\uA802\uA806\uA80B\uA823-\uA827\uA82C\uA880\uA881\uA8B4-\uA8C5\uA8D0-\uA8D9\uA8E0-\uA8F1\uA8FF-\uA909\uA926-\uA92D\uA947-\uA953\uA980-\uA983\uA9B3-\uA9C0\uA9D0-\uA9D9\uA9E5\uA9F0-\uA9F9\uAA29-\uAA36\uAA43\uAA4C\uAA4D\uAA50-\uAA59\uAA7B-\uAA7D\uAAB0\uAAB2-\uAAB4\uAAB7\uAAB8\uAABE\uAABF\uAAC1\uAAEB-\uAAEF\uAAF5\uAAF6\uABE3-\uABEA\uABEC\uABED\uABF0-\uABF9\uFB1E\uFE00-\uFE0F\uFE20-\uFE2F\uFE33\uFE34\uFE4D-\uFE4F\uFF10-\uFF19\uFF3F\uFF65";
var nonASCIIidentifierStartChars = "\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377\u037A-\u037D\u037F\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u052F\u0531-\u0556\u0559\u0560-\u0588\u05D0-\u05EA\u05EF-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u0860-\u086A\u0870-\u0887\u0889-\u088F\u08A0-\u08C9\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u09FC\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0AF9\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D\u0C58-\u0C5A\u0C5C\u0C5D\u0C60\u0C61\u0C80\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDC-\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D04-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D54-\u0D56\u0D5F-\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81\u0E82\u0E84\u0E86-\u0E8A\u0E8C-\u0EA3\u0EA5\u0EA7-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F5\u13F8-\u13FD\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F8\u1700-\u1711\u171F-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1878\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191E\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4C\u1B83-\u1BA0\u1BAE\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1C80-\u1C8A\u1C90-\u1CBA\u1CBD-\u1CBF\u1CE9-\u1CEC\u1CEE-\u1CF3\u1CF5\u1CF6\u1CFA\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2118-\u211D\u2124\u2126\u2128\u212A-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303C\u3041-\u3096\u309B-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312F\u3131-\u318E\u31A0-\u31BF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B\uA640-\uA66E\uA67F-\uA69D\uA6A0-\uA6EF\uA717-\uA71F\uA722-\uA788\uA78B-\uA7DC\uA7F1-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA8FD\uA8FE\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uA9E0-\uA9E4\uA9E6-\uA9EF\uA9FA-\uA9FE\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA7E-\uAAAF\uAAB1\uAAB5\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB69\uAB70-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC";
var reservedWords = {
  3: "abstract boolean byte char class double enum export extends final float goto implements import int interface long native package private protected public short static super synchronized throws transient volatile",
  5: "class enum extends super const export import",
  6: "enum",
  strict: "implements interface let package private protected public static yield",
  strictBind: "eval arguments"
};
var ecma5AndLessKeywords = "break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this";
var keywords$1 = {
  5: ecma5AndLessKeywords,
  "5module": ecma5AndLessKeywords + " export import",
  6: ecma5AndLessKeywords + " const class extends export import super"
};
var keywordRelationalOperator = /^in(stanceof)?$/;
var nonASCIIidentifierStart = new RegExp("[" + nonASCIIidentifierStartChars + "]");
var nonASCIIidentifier = new RegExp("[" + nonASCIIidentifierStartChars + nonASCIIidentifierChars + "]");
function isInAstralSet(code, set) {
  var pos = 65536;
  for (var i2 = 0; i2 < set.length; i2 += 2) {
    pos += set[i2];
    if (pos > code) {
      return false;
    }
    pos += set[i2 + 1];
    if (pos >= code) {
      return true;
    }
  }
  return false;
}
function isIdentifierStart(code, astral) {
  if (code < 65) {
    return code === 36;
  }
  if (code < 91) {
    return true;
  }
  if (code < 97) {
    return code === 95;
  }
  if (code < 123) {
    return true;
  }
  if (code <= 65535) {
    return code >= 170 && nonASCIIidentifierStart.test(String.fromCharCode(code));
  }
  if (astral === false) {
    return false;
  }
  return isInAstralSet(code, astralIdentifierStartCodes);
}
function isIdentifierChar(code, astral) {
  if (code < 48) {
    return code === 36;
  }
  if (code < 58) {
    return true;
  }
  if (code < 65) {
    return false;
  }
  if (code < 91) {
    return true;
  }
  if (code < 97) {
    return code === 95;
  }
  if (code < 123) {
    return true;
  }
  if (code <= 65535) {
    return code >= 170 && nonASCIIidentifier.test(String.fromCharCode(code));
  }
  if (astral === false) {
    return false;
  }
  return isInAstralSet(code, astralIdentifierStartCodes) || isInAstralSet(code, astralIdentifierCodes);
}
var TokenType = function TokenType2(label, conf) {
  if (conf === void 0) conf = {};
  this.label = label;
  this.keyword = conf.keyword;
  this.beforeExpr = !!conf.beforeExpr;
  this.startsExpr = !!conf.startsExpr;
  this.isLoop = !!conf.isLoop;
  this.isAssign = !!conf.isAssign;
  this.prefix = !!conf.prefix;
  this.postfix = !!conf.postfix;
  this.binop = conf.binop || null;
  this.updateContext = null;
};
function binop(name, prec) {
  return new TokenType(name, { beforeExpr: true, binop: prec });
}
var beforeExpr = { beforeExpr: true };
var startsExpr = { startsExpr: true };
var keywords = {};
function kw(name, options) {
  if (options === void 0) options = {};
  options.keyword = name;
  return keywords[name] = new TokenType(name, options);
}
var types$1 = {
  num: new TokenType("num", startsExpr),
  regexp: new TokenType("regexp", startsExpr),
  string: new TokenType("string", startsExpr),
  name: new TokenType("name", startsExpr),
  privateId: new TokenType("privateId", startsExpr),
  eof: new TokenType("eof"),
  // Punctuation token types.
  bracketL: new TokenType("[", { beforeExpr: true, startsExpr: true }),
  bracketR: new TokenType("]"),
  braceL: new TokenType("{", { beforeExpr: true, startsExpr: true }),
  braceR: new TokenType("}"),
  parenL: new TokenType("(", { beforeExpr: true, startsExpr: true }),
  parenR: new TokenType(")"),
  comma: new TokenType(",", beforeExpr),
  semi: new TokenType(";", beforeExpr),
  colon: new TokenType(":", beforeExpr),
  dot: new TokenType("."),
  question: new TokenType("?", beforeExpr),
  questionDot: new TokenType("?."),
  arrow: new TokenType("=>", beforeExpr),
  template: new TokenType("template"),
  invalidTemplate: new TokenType("invalidTemplate"),
  ellipsis: new TokenType("...", beforeExpr),
  backQuote: new TokenType("`", startsExpr),
  dollarBraceL: new TokenType("${", { beforeExpr: true, startsExpr: true }),
  // Operators. These carry several kinds of properties to help the
  // parser use them properly (the presence of these properties is
  // what categorizes them as operators).
  //
  // `binop`, when present, specifies that this operator is a binary
  // operator, and will refer to its precedence.
  //
  // `prefix` and `postfix` mark the operator as a prefix or postfix
  // unary operator.
  //
  // `isAssign` marks all of `=`, `+=`, `-=` etcetera, which act as
  // binary operators with a very low precedence, that should result
  // in AssignmentExpression nodes.
  eq: new TokenType("=", { beforeExpr: true, isAssign: true }),
  assign: new TokenType("_=", { beforeExpr: true, isAssign: true }),
  incDec: new TokenType("++/--", { prefix: true, postfix: true, startsExpr: true }),
  prefix: new TokenType("!/~", { beforeExpr: true, prefix: true, startsExpr: true }),
  logicalOR: binop("||", 1),
  logicalAND: binop("&&", 2),
  bitwiseOR: binop("|", 3),
  bitwiseXOR: binop("^", 4),
  bitwiseAND: binop("&", 5),
  equality: binop("==/!=/===/!==", 6),
  relational: binop("</>/<=/>=", 7),
  bitShift: binop("<</>>/>>>", 8),
  plusMin: new TokenType("+/-", { beforeExpr: true, binop: 9, prefix: true, startsExpr: true }),
  modulo: binop("%", 10),
  star: binop("*", 10),
  slash: binop("/", 10),
  starstar: new TokenType("**", { beforeExpr: true }),
  coalesce: binop("??", 1),
  // Keyword token types.
  _break: kw("break"),
  _case: kw("case", beforeExpr),
  _catch: kw("catch"),
  _continue: kw("continue"),
  _debugger: kw("debugger"),
  _default: kw("default", beforeExpr),
  _do: kw("do", { isLoop: true, beforeExpr: true }),
  _else: kw("else", beforeExpr),
  _finally: kw("finally"),
  _for: kw("for", { isLoop: true }),
  _function: kw("function", startsExpr),
  _if: kw("if"),
  _return: kw("return", beforeExpr),
  _switch: kw("switch"),
  _throw: kw("throw", beforeExpr),
  _try: kw("try"),
  _var: kw("var"),
  _const: kw("const"),
  _while: kw("while", { isLoop: true }),
  _with: kw("with"),
  _new: kw("new", { beforeExpr: true, startsExpr: true }),
  _this: kw("this", startsExpr),
  _super: kw("super", startsExpr),
  _class: kw("class", startsExpr),
  _extends: kw("extends", beforeExpr),
  _export: kw("export"),
  _import: kw("import", startsExpr),
  _null: kw("null", startsExpr),
  _true: kw("true", startsExpr),
  _false: kw("false", startsExpr),
  _in: kw("in", { beforeExpr: true, binop: 7 }),
  _instanceof: kw("instanceof", { beforeExpr: true, binop: 7 }),
  _typeof: kw("typeof", { beforeExpr: true, prefix: true, startsExpr: true }),
  _void: kw("void", { beforeExpr: true, prefix: true, startsExpr: true }),
  _delete: kw("delete", { beforeExpr: true, prefix: true, startsExpr: true })
};
var lineBreak = /\r\n?|\n|\u2028|\u2029/;
var lineBreakG = new RegExp(lineBreak.source, "g");
function isNewLine(code) {
  return code === 10 || code === 13 || code === 8232 || code === 8233;
}
function nextLineBreak(code, from, end) {
  if (end === void 0) end = code.length;
  for (var i2 = from; i2 < end; i2++) {
    var next = code.charCodeAt(i2);
    if (isNewLine(next)) {
      return i2 < end - 1 && next === 13 && code.charCodeAt(i2 + 1) === 10 ? i2 + 2 : i2 + 1;
    }
  }
  return -1;
}
var nonASCIIwhitespace = /[\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]/;
var skipWhiteSpace = /(?:\s|\/\/.*|\/\*[^]*?\*\/)*/g;
var ref = Object.prototype;
var hasOwnProperty = ref.hasOwnProperty;
var toString = ref.toString;
var hasOwn = Object.hasOwn || (function(obj, propName) {
  return hasOwnProperty.call(obj, propName);
});
var isArray = Array.isArray || (function(obj) {
  return toString.call(obj) === "[object Array]";
});
var regexpCache = /* @__PURE__ */ Object.create(null);
function wordsRegexp(words) {
  return regexpCache[words] || (regexpCache[words] = new RegExp("^(?:" + words.replace(/ /g, "|") + ")$"));
}
function codePointToString(code) {
  if (code <= 65535) {
    return String.fromCharCode(code);
  }
  code -= 65536;
  return String.fromCharCode((code >> 10) + 55296, (code & 1023) + 56320);
}
var loneSurrogate = /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF])/;
var Position = function Position2(line, col) {
  this.line = line;
  this.column = col;
};
Position.prototype.offset = function offset(n) {
  return new Position(this.line, this.column + n);
};
var SourceLocation = function SourceLocation2(p, start, end) {
  this.start = start;
  this.end = end;
  if (p.sourceFile !== null) {
    this.source = p.sourceFile;
  }
};
function getLineInfo(input, offset2) {
  for (var line = 1, cur = 0; ; ) {
    var nextBreak = nextLineBreak(input, cur, offset2);
    if (nextBreak < 0) {
      return new Position(line, offset2 - cur);
    }
    ++line;
    cur = nextBreak;
  }
}
var defaultOptions = {
  // `ecmaVersion` indicates the ECMAScript version to parse. Must be
  // either 3, 5, 6 (or 2015), 7 (2016), 8 (2017), 9 (2018), 10
  // (2019), 11 (2020), 12 (2021), 13 (2022), 14 (2023), or `"latest"`
  // (the latest version the library supports). This influences
  // support for strict mode, the set of reserved words, and support
  // for new syntax features.
  ecmaVersion: null,
  // `sourceType` indicates the mode the code should be parsed in.
  // Can be either `"script"`, `"module"` or `"commonjs"`. This influences global
  // strict mode and parsing of `import` and `export` declarations.
  sourceType: "script",
  // `onInsertedSemicolon` can be a callback that will be called when
  // a semicolon is automatically inserted. It will be passed the
  // position of the inserted semicolon as an offset, and if
  // `locations` is enabled, it is given the location as a `{line,
  // column}` object as second argument.
  onInsertedSemicolon: null,
  // `onTrailingComma` is similar to `onInsertedSemicolon`, but for
  // trailing commas.
  onTrailingComma: null,
  // By default, reserved words are only enforced if ecmaVersion >= 5.
  // Set `allowReserved` to a boolean value to explicitly turn this on
  // an off. When this option has the value "never", reserved words
  // and keywords can also not be used as property names.
  allowReserved: null,
  // When enabled, a return at the top level is not considered an
  // error.
  allowReturnOutsideFunction: false,
  // When enabled, import/export statements are not constrained to
  // appearing at the top of the program, and an import.meta expression
  // in a script isn't considered an error.
  allowImportExportEverywhere: false,
  // By default, await identifiers are allowed to appear at the top-level scope only if ecmaVersion >= 2022.
  // When enabled, await identifiers are allowed to appear at the top-level scope,
  // but they are still not allowed in non-async functions.
  allowAwaitOutsideFunction: null,
  // When enabled, super identifiers are not constrained to
  // appearing in methods and do not raise an error when they appear elsewhere.
  allowSuperOutsideMethod: null,
  // When enabled, hashbang directive in the beginning of file is
  // allowed and treated as a line comment. Enabled by default when
  // `ecmaVersion` >= 2023.
  allowHashBang: false,
  // By default, the parser will verify that private properties are
  // only used in places where they are valid and have been declared.
  // Set this to false to turn such checks off.
  checkPrivateFields: true,
  // When `locations` is on, `loc` properties holding objects with
  // `start` and `end` properties in `{line, column}` form (with
  // line being 1-based and column 0-based) will be attached to the
  // nodes.
  locations: false,
  // A function can be passed as `onToken` option, which will
  // cause Acorn to call that function with object in the same
  // format as tokens returned from `tokenizer().getToken()`. Note
  // that you are not allowed to call the parser from the
  // callback—that will corrupt its internal state.
  onToken: null,
  // A function can be passed as `onComment` option, which will
  // cause Acorn to call that function with `(block, text, start,
  // end)` parameters whenever a comment is skipped. `block` is a
  // boolean indicating whether this is a block (`/* */`) comment,
  // `text` is the content of the comment, and `start` and `end` are
  // character offsets that denote the start and end of the comment.
  // When the `locations` option is on, two more parameters are
  // passed, the full `{line, column}` locations of the start and
  // end of the comments. Note that you are not allowed to call the
  // parser from the callback—that will corrupt its internal state.
  // When this option has an array as value, objects representing the
  // comments are pushed to it.
  onComment: null,
  // Nodes have their start and end characters offsets recorded in
  // `start` and `end` properties (directly on the node, rather than
  // the `loc` object, which holds line/column data. To also add a
  // [semi-standardized][range] `range` property holding a `[start,
  // end]` array with the same numbers, set the `ranges` option to
  // `true`.
  //
  // [range]: https://bugzilla.mozilla.org/show_bug.cgi?id=745678
  ranges: false,
  // It is possible to parse multiple files into a single AST by
  // passing the tree produced by parsing the first file as
  // `program` option in subsequent parses. This will add the
  // toplevel forms of the parsed file to the `Program` (top) node
  // of an existing parse tree.
  program: null,
  // When `locations` is on, you can pass this to record the source
  // file in every node's `loc` object.
  sourceFile: null,
  // This value, if given, is stored in every node, whether
  // `locations` is on or off.
  directSourceFile: null,
  // When enabled, parenthesized expressions are represented by
  // (non-standard) ParenthesizedExpression nodes
  preserveParens: false
};
var warnedAboutEcmaVersion = false;
function getOptions(opts) {
  var options = {};
  for (var opt in defaultOptions) {
    options[opt] = opts && hasOwn(opts, opt) ? opts[opt] : defaultOptions[opt];
  }
  if (options.ecmaVersion === "latest") {
    options.ecmaVersion = 1e8;
  } else if (options.ecmaVersion == null) {
    if (!warnedAboutEcmaVersion && typeof console === "object" && console.warn) {
      warnedAboutEcmaVersion = true;
      console.warn("Since Acorn 8.0.0, options.ecmaVersion is required.\nDefaulting to 2020, but this will stop working in the future.");
    }
    options.ecmaVersion = 11;
  } else if (options.ecmaVersion >= 2015) {
    options.ecmaVersion -= 2009;
  }
  if (options.allowReserved == null) {
    options.allowReserved = options.ecmaVersion < 5;
  }
  if (!opts || opts.allowHashBang == null) {
    options.allowHashBang = options.ecmaVersion >= 14;
  }
  if (isArray(options.onToken)) {
    var tokens = options.onToken;
    options.onToken = function(token) {
      return tokens.push(token);
    };
  }
  if (isArray(options.onComment)) {
    options.onComment = pushComment(options, options.onComment);
  }
  if (options.sourceType === "commonjs" && options.allowAwaitOutsideFunction) {
    throw new Error("Cannot use allowAwaitOutsideFunction with sourceType: commonjs");
  }
  return options;
}
function pushComment(options, array) {
  return function(block, text2, start, end, startLoc, endLoc) {
    var comment = {
      type: block ? "Block" : "Line",
      value: text2,
      start,
      end
    };
    if (options.locations) {
      comment.loc = new SourceLocation(this, startLoc, endLoc);
    }
    if (options.ranges) {
      comment.range = [start, end];
    }
    array.push(comment);
  };
}
var SCOPE_TOP = 1;
var SCOPE_FUNCTION = 2;
var SCOPE_ASYNC = 4;
var SCOPE_GENERATOR = 8;
var SCOPE_ARROW = 16;
var SCOPE_SIMPLE_CATCH = 32;
var SCOPE_SUPER = 64;
var SCOPE_DIRECT_SUPER = 128;
var SCOPE_CLASS_STATIC_BLOCK = 256;
var SCOPE_CLASS_FIELD_INIT = 512;
var SCOPE_SWITCH = 1024;
var SCOPE_VAR = SCOPE_TOP | SCOPE_FUNCTION | SCOPE_CLASS_STATIC_BLOCK;
function functionFlags(async, generator) {
  return SCOPE_FUNCTION | (async ? SCOPE_ASYNC : 0) | (generator ? SCOPE_GENERATOR : 0);
}
var BIND_NONE = 0;
var BIND_VAR = 1;
var BIND_LEXICAL = 2;
var BIND_FUNCTION = 3;
var BIND_SIMPLE_CATCH = 4;
var BIND_OUTSIDE = 5;
var Parser = function Parser2(options, input, startPos) {
  this.options = options = getOptions(options);
  this.sourceFile = options.sourceFile;
  this.keywords = wordsRegexp(keywords$1[options.ecmaVersion >= 6 ? 6 : options.sourceType === "module" ? "5module" : 5]);
  var reserved = "";
  if (options.allowReserved !== true) {
    reserved = reservedWords[options.ecmaVersion >= 6 ? 6 : options.ecmaVersion === 5 ? 5 : 3];
    if (options.sourceType === "module") {
      reserved += " await";
    }
  }
  this.reservedWords = wordsRegexp(reserved);
  var reservedStrict = (reserved ? reserved + " " : "") + reservedWords.strict;
  this.reservedWordsStrict = wordsRegexp(reservedStrict);
  this.reservedWordsStrictBind = wordsRegexp(reservedStrict + " " + reservedWords.strictBind);
  this.input = String(input);
  this.containsEsc = false;
  if (startPos) {
    this.pos = startPos;
    this.lineStart = this.input.lastIndexOf("\n", startPos - 1) + 1;
    this.curLine = this.input.slice(0, this.lineStart).split(lineBreak).length;
  } else {
    this.pos = this.lineStart = 0;
    this.curLine = 1;
  }
  this.type = types$1.eof;
  this.value = null;
  this.start = this.end = this.pos;
  this.startLoc = this.endLoc = this.curPosition();
  this.lastTokEndLoc = this.lastTokStartLoc = null;
  this.lastTokStart = this.lastTokEnd = this.pos;
  this.context = this.initialContext();
  this.exprAllowed = true;
  this.inModule = options.sourceType === "module";
  this.strict = this.inModule || this.strictDirective(this.pos);
  this.potentialArrowAt = -1;
  this.potentialArrowInForAwait = false;
  this.yieldPos = this.awaitPos = this.awaitIdentPos = 0;
  this.labels = [];
  this.undefinedExports = /* @__PURE__ */ Object.create(null);
  if (this.pos === 0 && options.allowHashBang && this.input.slice(0, 2) === "#!") {
    this.skipLineComment(2);
  }
  this.scopeStack = [];
  this.enterScope(
    this.options.sourceType === "commonjs" ? SCOPE_FUNCTION : SCOPE_TOP
  );
  this.regexpState = null;
  this.privateNameStack = [];
};
var prototypeAccessors = { inFunction: { configurable: true }, inGenerator: { configurable: true }, inAsync: { configurable: true }, canAwait: { configurable: true }, allowReturn: { configurable: true }, allowSuper: { configurable: true }, allowDirectSuper: { configurable: true }, treatFunctionsAsVar: { configurable: true }, allowNewDotTarget: { configurable: true }, allowUsing: { configurable: true }, inClassStaticBlock: { configurable: true } };
Parser.prototype.parse = function parse() {
  var node = this.options.program || this.startNode();
  this.nextToken();
  return this.parseTopLevel(node);
};
prototypeAccessors.inFunction.get = function() {
  return (this.currentVarScope().flags & SCOPE_FUNCTION) > 0;
};
prototypeAccessors.inGenerator.get = function() {
  return (this.currentVarScope().flags & SCOPE_GENERATOR) > 0;
};
prototypeAccessors.inAsync.get = function() {
  return (this.currentVarScope().flags & SCOPE_ASYNC) > 0;
};
prototypeAccessors.canAwait.get = function() {
  for (var i2 = this.scopeStack.length - 1; i2 >= 0; i2--) {
    var ref2 = this.scopeStack[i2];
    var flags = ref2.flags;
    if (flags & (SCOPE_CLASS_STATIC_BLOCK | SCOPE_CLASS_FIELD_INIT)) {
      return false;
    }
    if (flags & SCOPE_FUNCTION) {
      return (flags & SCOPE_ASYNC) > 0;
    }
  }
  return this.inModule && this.options.ecmaVersion >= 13 || this.options.allowAwaitOutsideFunction;
};
prototypeAccessors.allowReturn.get = function() {
  if (this.inFunction) {
    return true;
  }
  if (this.options.allowReturnOutsideFunction && this.currentVarScope().flags & SCOPE_TOP) {
    return true;
  }
  return false;
};
prototypeAccessors.allowSuper.get = function() {
  var ref2 = this.currentThisScope();
  var flags = ref2.flags;
  return (flags & SCOPE_SUPER) > 0 || this.options.allowSuperOutsideMethod;
};
prototypeAccessors.allowDirectSuper.get = function() {
  return (this.currentThisScope().flags & SCOPE_DIRECT_SUPER) > 0;
};
prototypeAccessors.treatFunctionsAsVar.get = function() {
  return this.treatFunctionsAsVarInScope(this.currentScope());
};
prototypeAccessors.allowNewDotTarget.get = function() {
  for (var i2 = this.scopeStack.length - 1; i2 >= 0; i2--) {
    var ref2 = this.scopeStack[i2];
    var flags = ref2.flags;
    if (flags & (SCOPE_CLASS_STATIC_BLOCK | SCOPE_CLASS_FIELD_INIT) || flags & SCOPE_FUNCTION && !(flags & SCOPE_ARROW)) {
      return true;
    }
  }
  return false;
};
prototypeAccessors.allowUsing.get = function() {
  var ref2 = this.currentScope();
  var flags = ref2.flags;
  if (flags & SCOPE_SWITCH) {
    return false;
  }
  if (!this.inModule && flags & SCOPE_TOP) {
    return false;
  }
  return true;
};
prototypeAccessors.inClassStaticBlock.get = function() {
  return (this.currentVarScope().flags & SCOPE_CLASS_STATIC_BLOCK) > 0;
};
Parser.extend = function extend() {
  var plugins = [], len = arguments.length;
  while (len--) plugins[len] = arguments[len];
  var cls = this;
  for (var i2 = 0; i2 < plugins.length; i2++) {
    cls = plugins[i2](cls);
  }
  return cls;
};
Parser.parse = function parse2(input, options) {
  return new this(options, input).parse();
};
Parser.parseExpressionAt = function parseExpressionAt(input, pos, options) {
  var parser = new this(options, input, pos);
  parser.nextToken();
  return parser.parseExpression();
};
Parser.tokenizer = function tokenizer(input, options) {
  return new this(options, input);
};
Object.defineProperties(Parser.prototype, prototypeAccessors);
var pp$9 = Parser.prototype;
var literal = /^(?:'((?:\\[^]|[^'\\])*?)'|"((?:\\[^]|[^"\\])*?)")/;
pp$9.strictDirective = function(start) {
  if (this.options.ecmaVersion < 5) {
    return false;
  }
  for (; ; ) {
    skipWhiteSpace.lastIndex = start;
    start += skipWhiteSpace.exec(this.input)[0].length;
    var match = literal.exec(this.input.slice(start));
    if (!match) {
      return false;
    }
    if ((match[1] || match[2]) === "use strict") {
      skipWhiteSpace.lastIndex = start + match[0].length;
      var spaceAfter = skipWhiteSpace.exec(this.input), end = spaceAfter.index + spaceAfter[0].length;
      var next = this.input.charAt(end);
      return next === ";" || next === "}" || lineBreak.test(spaceAfter[0]) && !(/[(`.[+\-/*%<>=,?^&]/.test(next) || next === "!" && this.input.charAt(end + 1) === "=");
    }
    start += match[0].length;
    skipWhiteSpace.lastIndex = start;
    start += skipWhiteSpace.exec(this.input)[0].length;
    if (this.input[start] === ";") {
      start++;
    }
  }
};
pp$9.eat = function(type) {
  if (this.type === type) {
    this.next();
    return true;
  } else {
    return false;
  }
};
pp$9.isContextual = function(name) {
  return this.type === types$1.name && this.value === name && !this.containsEsc;
};
pp$9.eatContextual = function(name) {
  if (!this.isContextual(name)) {
    return false;
  }
  this.next();
  return true;
};
pp$9.expectContextual = function(name) {
  if (!this.eatContextual(name)) {
    this.unexpected();
  }
};
pp$9.canInsertSemicolon = function() {
  return this.type === types$1.eof || this.type === types$1.braceR || lineBreak.test(this.input.slice(this.lastTokEnd, this.start));
};
pp$9.insertSemicolon = function() {
  if (this.canInsertSemicolon()) {
    if (this.options.onInsertedSemicolon) {
      this.options.onInsertedSemicolon(this.lastTokEnd, this.lastTokEndLoc);
    }
    return true;
  }
};
pp$9.semicolon = function() {
  if (!this.eat(types$1.semi) && !this.insertSemicolon()) {
    this.unexpected();
  }
};
pp$9.afterTrailingComma = function(tokType, notNext) {
  if (this.type === tokType) {
    if (this.options.onTrailingComma) {
      this.options.onTrailingComma(this.lastTokStart, this.lastTokStartLoc);
    }
    if (!notNext) {
      this.next();
    }
    return true;
  }
};
pp$9.expect = function(type) {
  this.eat(type) || this.unexpected();
};
pp$9.unexpected = function(pos) {
  this.raise(pos != null ? pos : this.start, "Unexpected token");
};
var DestructuringErrors = function DestructuringErrors2() {
  this.shorthandAssign = this.trailingComma = this.parenthesizedAssign = this.parenthesizedBind = this.doubleProto = -1;
};
pp$9.checkPatternErrors = function(refDestructuringErrors, isAssign) {
  if (!refDestructuringErrors) {
    return;
  }
  if (refDestructuringErrors.trailingComma > -1) {
    this.raiseRecoverable(refDestructuringErrors.trailingComma, "Comma is not permitted after the rest element");
  }
  var parens = isAssign ? refDestructuringErrors.parenthesizedAssign : refDestructuringErrors.parenthesizedBind;
  if (parens > -1) {
    this.raiseRecoverable(parens, isAssign ? "Assigning to rvalue" : "Parenthesized pattern");
  }
};
pp$9.checkExpressionErrors = function(refDestructuringErrors, andThrow) {
  if (!refDestructuringErrors) {
    return false;
  }
  var shorthandAssign = refDestructuringErrors.shorthandAssign;
  var doubleProto = refDestructuringErrors.doubleProto;
  if (!andThrow) {
    return shorthandAssign >= 0 || doubleProto >= 0;
  }
  if (shorthandAssign >= 0) {
    this.raise(shorthandAssign, "Shorthand property assignments are valid only in destructuring patterns");
  }
  if (doubleProto >= 0) {
    this.raiseRecoverable(doubleProto, "Redefinition of __proto__ property");
  }
};
pp$9.checkYieldAwaitInDefaultParams = function() {
  if (this.yieldPos && (!this.awaitPos || this.yieldPos < this.awaitPos)) {
    this.raise(this.yieldPos, "Yield expression cannot be a default value");
  }
  if (this.awaitPos) {
    this.raise(this.awaitPos, "Await expression cannot be a default value");
  }
};
pp$9.isSimpleAssignTarget = function(expr) {
  if (expr.type === "ParenthesizedExpression") {
    return this.isSimpleAssignTarget(expr.expression);
  }
  return expr.type === "Identifier" || expr.type === "MemberExpression";
};
var pp$8 = Parser.prototype;
pp$8.parseTopLevel = function(node) {
  var exports = /* @__PURE__ */ Object.create(null);
  if (!node.body) {
    node.body = [];
  }
  while (this.type !== types$1.eof) {
    var stmt = this.parseStatement(null, true, exports);
    node.body.push(stmt);
  }
  if (this.inModule) {
    for (var i2 = 0, list2 = Object.keys(this.undefinedExports); i2 < list2.length; i2 += 1) {
      var name = list2[i2];
      this.raiseRecoverable(this.undefinedExports[name].start, "Export '" + name + "' is not defined");
    }
  }
  this.adaptDirectivePrologue(node.body);
  this.next();
  node.sourceType = this.options.sourceType === "commonjs" ? "script" : this.options.sourceType;
  return this.finishNode(node, "Program");
};
var loopLabel = { kind: "loop" };
var switchLabel = { kind: "switch" };
pp$8.isLet = function(context) {
  if (this.options.ecmaVersion < 6 || !this.isContextual("let")) {
    return false;
  }
  skipWhiteSpace.lastIndex = this.pos;
  var skip = skipWhiteSpace.exec(this.input);
  var next = this.pos + skip[0].length, nextCh = this.fullCharCodeAt(next);
  if (nextCh === 91 || nextCh === 92) {
    return true;
  }
  if (context) {
    return false;
  }
  if (nextCh === 123) {
    return true;
  }
  if (isIdentifierStart(nextCh)) {
    var start = next;
    do {
      next += nextCh <= 65535 ? 1 : 2;
    } while (isIdentifierChar(nextCh = this.fullCharCodeAt(next)));
    if (nextCh === 92) {
      return true;
    }
    var ident = this.input.slice(start, next);
    if (!keywordRelationalOperator.test(ident)) {
      return true;
    }
  }
  return false;
};
pp$8.isAsyncFunction = function() {
  if (this.options.ecmaVersion < 8 || !this.isContextual("async")) {
    return false;
  }
  skipWhiteSpace.lastIndex = this.pos;
  var skip = skipWhiteSpace.exec(this.input);
  var next = this.pos + skip[0].length, after;
  return !lineBreak.test(this.input.slice(this.pos, next)) && this.input.slice(next, next + 8) === "function" && (next + 8 === this.input.length || !(isIdentifierChar(after = this.fullCharCodeAt(next + 8)) || after === 92));
};
pp$8.isUsingKeyword = function(isAwaitUsing, isFor) {
  if (this.options.ecmaVersion < 17 || !this.isContextual(isAwaitUsing ? "await" : "using")) {
    return false;
  }
  skipWhiteSpace.lastIndex = this.pos;
  var skip = skipWhiteSpace.exec(this.input);
  var next = this.pos + skip[0].length;
  if (lineBreak.test(this.input.slice(this.pos, next))) {
    return false;
  }
  if (isAwaitUsing) {
    var usingEndPos = next + 5, after;
    if (this.input.slice(next, usingEndPos) !== "using" || usingEndPos === this.input.length || isIdentifierChar(after = this.fullCharCodeAt(usingEndPos)) || after === 92) {
      return false;
    }
    skipWhiteSpace.lastIndex = usingEndPos;
    var skipAfterUsing = skipWhiteSpace.exec(this.input);
    next = usingEndPos + skipAfterUsing[0].length;
    if (skipAfterUsing && lineBreak.test(this.input.slice(usingEndPos, next))) {
      return false;
    }
  }
  var ch = this.fullCharCodeAt(next);
  if (!isIdentifierStart(ch) && ch !== 92) {
    return false;
  }
  var idStart = next;
  do {
    next += ch <= 65535 ? 1 : 2;
  } while (isIdentifierChar(ch = this.fullCharCodeAt(next)));
  if (ch === 92) {
    return true;
  }
  var id = this.input.slice(idStart, next);
  if (keywordRelationalOperator.test(id) || isFor && id === "of") {
    return false;
  }
  return true;
};
pp$8.isAwaitUsing = function(isFor) {
  return this.isUsingKeyword(true, isFor);
};
pp$8.isUsing = function(isFor) {
  return this.isUsingKeyword(false, isFor);
};
pp$8.parseStatement = function(context, topLevel, exports) {
  var starttype = this.type, node = this.startNode(), kind;
  if (this.isLet(context)) {
    starttype = types$1._var;
    kind = "let";
  }
  switch (starttype) {
    case types$1._break:
    case types$1._continue:
      return this.parseBreakContinueStatement(node, starttype.keyword);
    case types$1._debugger:
      return this.parseDebuggerStatement(node);
    case types$1._do:
      return this.parseDoStatement(node);
    case types$1._for:
      return this.parseForStatement(node);
    case types$1._function:
      if (context && (this.strict || context !== "if" && context !== "label") && this.options.ecmaVersion >= 6) {
        this.unexpected();
      }
      return this.parseFunctionStatement(node, false, !context);
    case types$1._class:
      if (context) {
        this.unexpected();
      }
      return this.parseClass(node, true);
    case types$1._if:
      return this.parseIfStatement(node);
    case types$1._return:
      return this.parseReturnStatement(node);
    case types$1._switch:
      return this.parseSwitchStatement(node);
    case types$1._throw:
      return this.parseThrowStatement(node);
    case types$1._try:
      return this.parseTryStatement(node);
    case types$1._const:
    case types$1._var:
      kind = kind || this.value;
      if (context && kind !== "var") {
        this.unexpected();
      }
      return this.parseVarStatement(node, kind);
    case types$1._while:
      return this.parseWhileStatement(node);
    case types$1._with:
      return this.parseWithStatement(node);
    case types$1.braceL:
      return this.parseBlock(true, node);
    case types$1.semi:
      return this.parseEmptyStatement(node);
    case types$1._export:
    case types$1._import:
      if (this.options.ecmaVersion > 10 && starttype === types$1._import) {
        skipWhiteSpace.lastIndex = this.pos;
        var skip = skipWhiteSpace.exec(this.input);
        var next = this.pos + skip[0].length, nextCh = this.input.charCodeAt(next);
        if (nextCh === 40 || nextCh === 46) {
          return this.parseExpressionStatement(node, this.parseExpression());
        }
      }
      if (!this.options.allowImportExportEverywhere) {
        if (!topLevel) {
          this.raise(this.start, "'import' and 'export' may only appear at the top level");
        }
        if (!this.inModule) {
          this.raise(this.start, "'import' and 'export' may appear only with 'sourceType: module'");
        }
      }
      return starttype === types$1._import ? this.parseImport(node) : this.parseExport(node, exports);
    // If the statement does not start with a statement keyword or a
    // brace, it's an ExpressionStatement or LabeledStatement. We
    // simply start parsing an expression, and afterwards, if the
    // next token is a colon and the expression was a simple
    // Identifier node, we switch to interpreting it as a label.
    default:
      if (this.isAsyncFunction()) {
        if (context) {
          this.unexpected();
        }
        this.next();
        return this.parseFunctionStatement(node, true, !context);
      }
      var usingKind = this.isAwaitUsing(false) ? "await using" : this.isUsing(false) ? "using" : null;
      if (usingKind) {
        if (!this.allowUsing) {
          this.raise(this.start, "Using declaration cannot appear in the top level when source type is `script` or in the bare case statement");
        }
        if (usingKind === "await using") {
          if (!this.canAwait) {
            this.raise(this.start, "Await using cannot appear outside of async function");
          }
          this.next();
        }
        this.next();
        this.parseVar(node, false, usingKind);
        this.semicolon();
        return this.finishNode(node, "VariableDeclaration");
      }
      var maybeName = this.value, expr = this.parseExpression();
      if (starttype === types$1.name && expr.type === "Identifier" && this.eat(types$1.colon)) {
        return this.parseLabeledStatement(node, maybeName, expr, context);
      } else {
        return this.parseExpressionStatement(node, expr);
      }
  }
};
pp$8.parseBreakContinueStatement = function(node, keyword) {
  var isBreak = keyword === "break";
  this.next();
  if (this.eat(types$1.semi) || this.insertSemicolon()) {
    node.label = null;
  } else if (this.type !== types$1.name) {
    this.unexpected();
  } else {
    node.label = this.parseIdent();
    this.semicolon();
  }
  var i2 = 0;
  for (; i2 < this.labels.length; ++i2) {
    var lab = this.labels[i2];
    if (node.label == null || lab.name === node.label.name) {
      if (lab.kind != null && (isBreak || lab.kind === "loop")) {
        break;
      }
      if (node.label && isBreak) {
        break;
      }
    }
  }
  if (i2 === this.labels.length) {
    this.raise(node.start, "Unsyntactic " + keyword);
  }
  return this.finishNode(node, isBreak ? "BreakStatement" : "ContinueStatement");
};
pp$8.parseDebuggerStatement = function(node) {
  this.next();
  this.semicolon();
  return this.finishNode(node, "DebuggerStatement");
};
pp$8.parseDoStatement = function(node) {
  this.next();
  this.labels.push(loopLabel);
  node.body = this.parseStatement("do");
  this.labels.pop();
  this.expect(types$1._while);
  node.test = this.parseParenExpression();
  if (this.options.ecmaVersion >= 6) {
    this.eat(types$1.semi);
  } else {
    this.semicolon();
  }
  return this.finishNode(node, "DoWhileStatement");
};
pp$8.parseForStatement = function(node) {
  this.next();
  var awaitAt = this.options.ecmaVersion >= 9 && this.canAwait && this.eatContextual("await") ? this.lastTokStart : -1;
  this.labels.push(loopLabel);
  this.enterScope(0);
  this.expect(types$1.parenL);
  if (this.type === types$1.semi) {
    if (awaitAt > -1) {
      this.unexpected(awaitAt);
    }
    return this.parseFor(node, null);
  }
  var isLet = this.isLet();
  if (this.type === types$1._var || this.type === types$1._const || isLet) {
    var init$1 = this.startNode(), kind = isLet ? "let" : this.value;
    this.next();
    this.parseVar(init$1, true, kind);
    this.finishNode(init$1, "VariableDeclaration");
    return this.parseForAfterInit(node, init$1, awaitAt);
  }
  var startsWithLet = this.isContextual("let"), isForOf = false;
  var usingKind = this.isUsing(true) ? "using" : this.isAwaitUsing(true) ? "await using" : null;
  if (usingKind) {
    var init$2 = this.startNode();
    this.next();
    if (usingKind === "await using") {
      if (!this.canAwait) {
        this.raise(this.start, "Await using cannot appear outside of async function");
      }
      this.next();
    }
    this.parseVar(init$2, true, usingKind);
    this.finishNode(init$2, "VariableDeclaration");
    return this.parseForAfterInit(node, init$2, awaitAt);
  }
  var containsEsc = this.containsEsc;
  var refDestructuringErrors = new DestructuringErrors();
  var initPos = this.start;
  var init = awaitAt > -1 ? this.parseExprSubscripts(refDestructuringErrors, "await") : this.parseExpression(true, refDestructuringErrors);
  if (this.type === types$1._in || (isForOf = this.options.ecmaVersion >= 6 && this.isContextual("of"))) {
    if (awaitAt > -1) {
      if (this.type === types$1._in) {
        this.unexpected(awaitAt);
      }
      node.await = true;
    } else if (isForOf && this.options.ecmaVersion >= 8) {
      if (init.start === initPos && !containsEsc && init.type === "Identifier" && init.name === "async") {
        this.unexpected();
      } else if (this.options.ecmaVersion >= 9) {
        node.await = false;
      }
    }
    if (startsWithLet && isForOf) {
      this.raise(init.start, "The left-hand side of a for-of loop may not start with 'let'.");
    }
    this.toAssignable(init, false, refDestructuringErrors);
    this.checkLValPattern(init);
    return this.parseForIn(node, init);
  } else {
    this.checkExpressionErrors(refDestructuringErrors, true);
  }
  if (awaitAt > -1) {
    this.unexpected(awaitAt);
  }
  return this.parseFor(node, init);
};
pp$8.parseForAfterInit = function(node, init, awaitAt) {
  if ((this.type === types$1._in || this.options.ecmaVersion >= 6 && this.isContextual("of")) && init.declarations.length === 1) {
    if (this.options.ecmaVersion >= 9) {
      if (this.type === types$1._in) {
        if (awaitAt > -1) {
          this.unexpected(awaitAt);
        }
      } else {
        node.await = awaitAt > -1;
      }
    }
    return this.parseForIn(node, init);
  }
  if (awaitAt > -1) {
    this.unexpected(awaitAt);
  }
  return this.parseFor(node, init);
};
pp$8.parseFunctionStatement = function(node, isAsync, declarationPosition) {
  this.next();
  return this.parseFunction(node, FUNC_STATEMENT | (declarationPosition ? 0 : FUNC_HANGING_STATEMENT), false, isAsync);
};
pp$8.parseIfStatement = function(node) {
  this.next();
  node.test = this.parseParenExpression();
  node.consequent = this.parseStatement("if");
  node.alternate = this.eat(types$1._else) ? this.parseStatement("if") : null;
  return this.finishNode(node, "IfStatement");
};
pp$8.parseReturnStatement = function(node) {
  if (!this.allowReturn) {
    this.raise(this.start, "'return' outside of function");
  }
  this.next();
  if (this.eat(types$1.semi) || this.insertSemicolon()) {
    node.argument = null;
  } else {
    node.argument = this.parseExpression();
    this.semicolon();
  }
  return this.finishNode(node, "ReturnStatement");
};
pp$8.parseSwitchStatement = function(node) {
  this.next();
  node.discriminant = this.parseParenExpression();
  node.cases = [];
  this.expect(types$1.braceL);
  this.labels.push(switchLabel);
  this.enterScope(SCOPE_SWITCH);
  var cur;
  for (var sawDefault = false; this.type !== types$1.braceR; ) {
    if (this.type === types$1._case || this.type === types$1._default) {
      var isCase = this.type === types$1._case;
      if (cur) {
        this.finishNode(cur, "SwitchCase");
      }
      node.cases.push(cur = this.startNode());
      cur.consequent = [];
      this.next();
      if (isCase) {
        cur.test = this.parseExpression();
      } else {
        if (sawDefault) {
          this.raiseRecoverable(this.lastTokStart, "Multiple default clauses");
        }
        sawDefault = true;
        cur.test = null;
      }
      this.expect(types$1.colon);
    } else {
      if (!cur) {
        this.unexpected();
      }
      cur.consequent.push(this.parseStatement(null));
    }
  }
  this.exitScope();
  if (cur) {
    this.finishNode(cur, "SwitchCase");
  }
  this.next();
  this.labels.pop();
  return this.finishNode(node, "SwitchStatement");
};
pp$8.parseThrowStatement = function(node) {
  this.next();
  if (lineBreak.test(this.input.slice(this.lastTokEnd, this.start))) {
    this.raise(this.lastTokEnd, "Illegal newline after throw");
  }
  node.argument = this.parseExpression();
  this.semicolon();
  return this.finishNode(node, "ThrowStatement");
};
var empty$1 = [];
pp$8.parseCatchClauseParam = function() {
  var param = this.parseBindingAtom();
  var simple = param.type === "Identifier";
  this.enterScope(simple ? SCOPE_SIMPLE_CATCH : 0);
  this.checkLValPattern(param, simple ? BIND_SIMPLE_CATCH : BIND_LEXICAL);
  this.expect(types$1.parenR);
  return param;
};
pp$8.parseTryStatement = function(node) {
  this.next();
  node.block = this.parseBlock();
  node.handler = null;
  if (this.type === types$1._catch) {
    var clause = this.startNode();
    this.next();
    if (this.eat(types$1.parenL)) {
      clause.param = this.parseCatchClauseParam();
    } else {
      if (this.options.ecmaVersion < 10) {
        this.unexpected();
      }
      clause.param = null;
      this.enterScope(0);
    }
    clause.body = this.parseBlock(false);
    this.exitScope();
    node.handler = this.finishNode(clause, "CatchClause");
  }
  node.finalizer = this.eat(types$1._finally) ? this.parseBlock() : null;
  if (!node.handler && !node.finalizer) {
    this.raise(node.start, "Missing catch or finally clause");
  }
  return this.finishNode(node, "TryStatement");
};
pp$8.parseVarStatement = function(node, kind, allowMissingInitializer) {
  this.next();
  this.parseVar(node, false, kind, allowMissingInitializer);
  this.semicolon();
  return this.finishNode(node, "VariableDeclaration");
};
pp$8.parseWhileStatement = function(node) {
  this.next();
  node.test = this.parseParenExpression();
  this.labels.push(loopLabel);
  node.body = this.parseStatement("while");
  this.labels.pop();
  return this.finishNode(node, "WhileStatement");
};
pp$8.parseWithStatement = function(node) {
  if (this.strict) {
    this.raise(this.start, "'with' in strict mode");
  }
  this.next();
  node.object = this.parseParenExpression();
  node.body = this.parseStatement("with");
  return this.finishNode(node, "WithStatement");
};
pp$8.parseEmptyStatement = function(node) {
  this.next();
  return this.finishNode(node, "EmptyStatement");
};
pp$8.parseLabeledStatement = function(node, maybeName, expr, context) {
  for (var i$1 = 0, list2 = this.labels; i$1 < list2.length; i$1 += 1) {
    var label = list2[i$1];
    if (label.name === maybeName) {
      this.raise(expr.start, "Label '" + maybeName + "' is already declared");
    }
  }
  var kind = this.type.isLoop ? "loop" : this.type === types$1._switch ? "switch" : null;
  for (var i2 = this.labels.length - 1; i2 >= 0; i2--) {
    var label$1 = this.labels[i2];
    if (label$1.statementStart === node.start) {
      label$1.statementStart = this.start;
      label$1.kind = kind;
    } else {
      break;
    }
  }
  this.labels.push({ name: maybeName, kind, statementStart: this.start });
  node.body = this.parseStatement(context ? context.indexOf("label") === -1 ? context + "label" : context : "label");
  this.labels.pop();
  node.label = expr;
  return this.finishNode(node, "LabeledStatement");
};
pp$8.parseExpressionStatement = function(node, expr) {
  node.expression = expr;
  this.semicolon();
  return this.finishNode(node, "ExpressionStatement");
};
pp$8.parseBlock = function(createNewLexicalScope, node, exitStrict) {
  if (createNewLexicalScope === void 0) createNewLexicalScope = true;
  if (node === void 0) node = this.startNode();
  node.body = [];
  this.expect(types$1.braceL);
  if (createNewLexicalScope) {
    this.enterScope(0);
  }
  while (this.type !== types$1.braceR) {
    var stmt = this.parseStatement(null);
    node.body.push(stmt);
  }
  if (exitStrict) {
    this.strict = false;
  }
  this.next();
  if (createNewLexicalScope) {
    this.exitScope();
  }
  return this.finishNode(node, "BlockStatement");
};
pp$8.parseFor = function(node, init) {
  node.init = init;
  this.expect(types$1.semi);
  node.test = this.type === types$1.semi ? null : this.parseExpression();
  this.expect(types$1.semi);
  node.update = this.type === types$1.parenR ? null : this.parseExpression();
  this.expect(types$1.parenR);
  node.body = this.parseStatement("for");
  this.exitScope();
  this.labels.pop();
  return this.finishNode(node, "ForStatement");
};
pp$8.parseForIn = function(node, init) {
  var isForIn = this.type === types$1._in;
  this.next();
  if (init.type === "VariableDeclaration" && init.declarations[0].init != null && (!isForIn || this.options.ecmaVersion < 8 || this.strict || init.kind !== "var" || init.declarations[0].id.type !== "Identifier")) {
    this.raise(
      init.start,
      (isForIn ? "for-in" : "for-of") + " loop variable declaration may not have an initializer"
    );
  }
  node.left = init;
  node.right = isForIn ? this.parseExpression() : this.parseMaybeAssign();
  this.expect(types$1.parenR);
  node.body = this.parseStatement("for");
  this.exitScope();
  this.labels.pop();
  return this.finishNode(node, isForIn ? "ForInStatement" : "ForOfStatement");
};
pp$8.parseVar = function(node, isFor, kind, allowMissingInitializer) {
  node.declarations = [];
  node.kind = kind;
  for (; ; ) {
    var decl = this.startNode();
    this.parseVarId(decl, kind);
    if (this.eat(types$1.eq)) {
      decl.init = this.parseMaybeAssign(isFor);
    } else if (!allowMissingInitializer && kind === "const" && !(this.type === types$1._in || this.options.ecmaVersion >= 6 && this.isContextual("of"))) {
      this.unexpected();
    } else if (!allowMissingInitializer && (kind === "using" || kind === "await using") && this.options.ecmaVersion >= 17 && this.type !== types$1._in && !this.isContextual("of")) {
      this.raise(this.lastTokEnd, "Missing initializer in " + kind + " declaration");
    } else if (!allowMissingInitializer && decl.id.type !== "Identifier" && !(isFor && (this.type === types$1._in || this.isContextual("of")))) {
      this.raise(this.lastTokEnd, "Complex binding patterns require an initialization value");
    } else {
      decl.init = null;
    }
    node.declarations.push(this.finishNode(decl, "VariableDeclarator"));
    if (!this.eat(types$1.comma)) {
      break;
    }
  }
  return node;
};
pp$8.parseVarId = function(decl, kind) {
  decl.id = kind === "using" || kind === "await using" ? this.parseIdent() : this.parseBindingAtom();
  this.checkLValPattern(decl.id, kind === "var" ? BIND_VAR : BIND_LEXICAL, false);
};
var FUNC_STATEMENT = 1;
var FUNC_HANGING_STATEMENT = 2;
var FUNC_NULLABLE_ID = 4;
pp$8.parseFunction = function(node, statement, allowExpressionBody, isAsync, forInit) {
  this.initFunction(node);
  if (this.options.ecmaVersion >= 9 || this.options.ecmaVersion >= 6 && !isAsync) {
    if (this.type === types$1.star && statement & FUNC_HANGING_STATEMENT) {
      this.unexpected();
    }
    node.generator = this.eat(types$1.star);
  }
  if (this.options.ecmaVersion >= 8) {
    node.async = !!isAsync;
  }
  if (statement & FUNC_STATEMENT) {
    node.id = statement & FUNC_NULLABLE_ID && this.type !== types$1.name ? null : this.parseIdent();
    if (node.id && !(statement & FUNC_HANGING_STATEMENT)) {
      this.checkLValSimple(node.id, this.strict || node.generator || node.async ? this.treatFunctionsAsVar ? BIND_VAR : BIND_LEXICAL : BIND_FUNCTION);
    }
  }
  var oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;
  this.yieldPos = 0;
  this.awaitPos = 0;
  this.awaitIdentPos = 0;
  this.enterScope(functionFlags(node.async, node.generator));
  if (!(statement & FUNC_STATEMENT)) {
    node.id = this.type === types$1.name ? this.parseIdent() : null;
  }
  this.parseFunctionParams(node);
  this.parseFunctionBody(node, allowExpressionBody, false, forInit);
  this.yieldPos = oldYieldPos;
  this.awaitPos = oldAwaitPos;
  this.awaitIdentPos = oldAwaitIdentPos;
  return this.finishNode(node, statement & FUNC_STATEMENT ? "FunctionDeclaration" : "FunctionExpression");
};
pp$8.parseFunctionParams = function(node) {
  this.expect(types$1.parenL);
  node.params = this.parseBindingList(types$1.parenR, false, this.options.ecmaVersion >= 8);
  this.checkYieldAwaitInDefaultParams();
};
pp$8.parseClass = function(node, isStatement) {
  this.next();
  var oldStrict = this.strict;
  this.strict = true;
  this.parseClassId(node, isStatement);
  this.parseClassSuper(node);
  var privateNameMap = this.enterClassBody();
  var classBody = this.startNode();
  var hadConstructor = false;
  classBody.body = [];
  this.expect(types$1.braceL);
  while (this.type !== types$1.braceR) {
    var element = this.parseClassElement(node.superClass !== null);
    if (element) {
      classBody.body.push(element);
      if (element.type === "MethodDefinition" && element.kind === "constructor") {
        if (hadConstructor) {
          this.raiseRecoverable(element.start, "Duplicate constructor in the same class");
        }
        hadConstructor = true;
      } else if (element.key && element.key.type === "PrivateIdentifier" && isPrivateNameConflicted(privateNameMap, element)) {
        this.raiseRecoverable(element.key.start, "Identifier '#" + element.key.name + "' has already been declared");
      }
    }
  }
  this.strict = oldStrict;
  this.next();
  node.body = this.finishNode(classBody, "ClassBody");
  this.exitClassBody();
  return this.finishNode(node, isStatement ? "ClassDeclaration" : "ClassExpression");
};
pp$8.parseClassElement = function(constructorAllowsSuper) {
  if (this.eat(types$1.semi)) {
    return null;
  }
  var ecmaVersion2 = this.options.ecmaVersion;
  var node = this.startNode();
  var keyName = "";
  var isGenerator = false;
  var isAsync = false;
  var kind = "method";
  var isStatic = false;
  if (this.eatContextual("static")) {
    if (ecmaVersion2 >= 13 && this.eat(types$1.braceL)) {
      this.parseClassStaticBlock(node);
      return node;
    }
    if (this.isClassElementNameStart() || this.type === types$1.star) {
      isStatic = true;
    } else {
      keyName = "static";
    }
  }
  node.static = isStatic;
  if (!keyName && ecmaVersion2 >= 8 && this.eatContextual("async")) {
    if ((this.isClassElementNameStart() || this.type === types$1.star) && !this.canInsertSemicolon()) {
      isAsync = true;
    } else {
      keyName = "async";
    }
  }
  if (!keyName && (ecmaVersion2 >= 9 || !isAsync) && this.eat(types$1.star)) {
    isGenerator = true;
  }
  if (!keyName && !isAsync && !isGenerator) {
    var lastValue = this.value;
    if (this.eatContextual("get") || this.eatContextual("set")) {
      if (this.isClassElementNameStart()) {
        kind = lastValue;
      } else {
        keyName = lastValue;
      }
    }
  }
  if (keyName) {
    node.computed = false;
    node.key = this.startNodeAt(this.lastTokStart, this.lastTokStartLoc);
    node.key.name = keyName;
    this.finishNode(node.key, "Identifier");
  } else {
    this.parseClassElementName(node);
  }
  if (ecmaVersion2 < 13 || this.type === types$1.parenL || kind !== "method" || isGenerator || isAsync) {
    var isConstructor = !node.static && checkKeyName(node, "constructor");
    var allowsDirectSuper = isConstructor && constructorAllowsSuper;
    if (isConstructor && kind !== "method") {
      this.raise(node.key.start, "Constructor can't have get/set modifier");
    }
    node.kind = isConstructor ? "constructor" : kind;
    this.parseClassMethod(node, isGenerator, isAsync, allowsDirectSuper);
  } else {
    this.parseClassField(node);
  }
  return node;
};
pp$8.isClassElementNameStart = function() {
  return this.type === types$1.name || this.type === types$1.privateId || this.type === types$1.num || this.type === types$1.string || this.type === types$1.bracketL || this.type.keyword;
};
pp$8.parseClassElementName = function(element) {
  if (this.type === types$1.privateId) {
    if (this.value === "constructor") {
      this.raise(this.start, "Classes can't have an element named '#constructor'");
    }
    element.computed = false;
    element.key = this.parsePrivateIdent();
  } else {
    this.parsePropertyName(element);
  }
};
pp$8.parseClassMethod = function(method, isGenerator, isAsync, allowsDirectSuper) {
  var key2 = method.key;
  if (method.kind === "constructor") {
    if (isGenerator) {
      this.raise(key2.start, "Constructor can't be a generator");
    }
    if (isAsync) {
      this.raise(key2.start, "Constructor can't be an async method");
    }
  } else if (method.static && checkKeyName(method, "prototype")) {
    this.raise(key2.start, "Classes may not have a static property named prototype");
  }
  var value = method.value = this.parseMethod(isGenerator, isAsync, allowsDirectSuper);
  if (method.kind === "get" && value.params.length !== 0) {
    this.raiseRecoverable(value.start, "getter should have no params");
  }
  if (method.kind === "set" && value.params.length !== 1) {
    this.raiseRecoverable(value.start, "setter should have exactly one param");
  }
  if (method.kind === "set" && value.params[0].type === "RestElement") {
    this.raiseRecoverable(value.params[0].start, "Setter cannot use rest params");
  }
  return this.finishNode(method, "MethodDefinition");
};
pp$8.parseClassField = function(field) {
  if (checkKeyName(field, "constructor")) {
    this.raise(field.key.start, "Classes can't have a field named 'constructor'");
  } else if (field.static && checkKeyName(field, "prototype")) {
    this.raise(field.key.start, "Classes can't have a static field named 'prototype'");
  }
  if (this.eat(types$1.eq)) {
    this.enterScope(SCOPE_CLASS_FIELD_INIT | SCOPE_SUPER);
    field.value = this.parseMaybeAssign();
    this.exitScope();
  } else {
    field.value = null;
  }
  this.semicolon();
  return this.finishNode(field, "PropertyDefinition");
};
pp$8.parseClassStaticBlock = function(node) {
  node.body = [];
  var oldLabels = this.labels;
  this.labels = [];
  this.enterScope(SCOPE_CLASS_STATIC_BLOCK | SCOPE_SUPER);
  while (this.type !== types$1.braceR) {
    var stmt = this.parseStatement(null);
    node.body.push(stmt);
  }
  this.next();
  this.exitScope();
  this.labels = oldLabels;
  return this.finishNode(node, "StaticBlock");
};
pp$8.parseClassId = function(node, isStatement) {
  if (this.type === types$1.name) {
    node.id = this.parseIdent();
    if (isStatement) {
      this.checkLValSimple(node.id, BIND_LEXICAL, false);
    }
  } else {
    if (isStatement === true) {
      this.unexpected();
    }
    node.id = null;
  }
};
pp$8.parseClassSuper = function(node) {
  node.superClass = this.eat(types$1._extends) ? this.parseExprSubscripts(null, false) : null;
};
pp$8.enterClassBody = function() {
  var element = { declared: /* @__PURE__ */ Object.create(null), used: [] };
  this.privateNameStack.push(element);
  return element.declared;
};
pp$8.exitClassBody = function() {
  var ref2 = this.privateNameStack.pop();
  var declared = ref2.declared;
  var used = ref2.used;
  if (!this.options.checkPrivateFields) {
    return;
  }
  var len = this.privateNameStack.length;
  var parent = len === 0 ? null : this.privateNameStack[len - 1];
  for (var i2 = 0; i2 < used.length; ++i2) {
    var id = used[i2];
    if (!hasOwn(declared, id.name)) {
      if (parent) {
        parent.used.push(id);
      } else {
        this.raiseRecoverable(id.start, "Private field '#" + id.name + "' must be declared in an enclosing class");
      }
    }
  }
};
function isPrivateNameConflicted(privateNameMap, element) {
  var name = element.key.name;
  var curr = privateNameMap[name];
  var next = "true";
  if (element.type === "MethodDefinition" && (element.kind === "get" || element.kind === "set")) {
    next = (element.static ? "s" : "i") + element.kind;
  }
  if (curr === "iget" && next === "iset" || curr === "iset" && next === "iget" || curr === "sget" && next === "sset" || curr === "sset" && next === "sget") {
    privateNameMap[name] = "true";
    return false;
  } else if (!curr) {
    privateNameMap[name] = next;
    return false;
  } else {
    return true;
  }
}
function checkKeyName(node, name) {
  var computed = node.computed;
  var key2 = node.key;
  return !computed && (key2.type === "Identifier" && key2.name === name || key2.type === "Literal" && key2.value === name);
}
pp$8.parseExportAllDeclaration = function(node, exports) {
  if (this.options.ecmaVersion >= 11) {
    if (this.eatContextual("as")) {
      node.exported = this.parseModuleExportName();
      this.checkExport(exports, node.exported, this.lastTokStart);
    } else {
      node.exported = null;
    }
  }
  this.expectContextual("from");
  if (this.type !== types$1.string) {
    this.unexpected();
  }
  node.source = this.parseExprAtom();
  if (this.options.ecmaVersion >= 16) {
    node.attributes = this.parseWithClause();
  }
  this.semicolon();
  return this.finishNode(node, "ExportAllDeclaration");
};
pp$8.parseExport = function(node, exports) {
  this.next();
  if (this.eat(types$1.star)) {
    return this.parseExportAllDeclaration(node, exports);
  }
  if (this.eat(types$1._default)) {
    this.checkExport(exports, "default", this.lastTokStart);
    node.declaration = this.parseExportDefaultDeclaration();
    return this.finishNode(node, "ExportDefaultDeclaration");
  }
  if (this.shouldParseExportStatement()) {
    node.declaration = this.parseExportDeclaration(node);
    if (node.declaration.type === "VariableDeclaration") {
      this.checkVariableExport(exports, node.declaration.declarations);
    } else {
      this.checkExport(exports, node.declaration.id, node.declaration.id.start);
    }
    node.specifiers = [];
    node.source = null;
    if (this.options.ecmaVersion >= 16) {
      node.attributes = [];
    }
  } else {
    node.declaration = null;
    node.specifiers = this.parseExportSpecifiers(exports);
    if (this.eatContextual("from")) {
      if (this.type !== types$1.string) {
        this.unexpected();
      }
      node.source = this.parseExprAtom();
      if (this.options.ecmaVersion >= 16) {
        node.attributes = this.parseWithClause();
      }
    } else {
      for (var i2 = 0, list2 = node.specifiers; i2 < list2.length; i2 += 1) {
        var spec = list2[i2];
        this.checkUnreserved(spec.local);
        this.checkLocalExport(spec.local);
        if (spec.local.type === "Literal") {
          this.raise(spec.local.start, "A string literal cannot be used as an exported binding without `from`.");
        }
      }
      node.source = null;
      if (this.options.ecmaVersion >= 16) {
        node.attributes = [];
      }
    }
    this.semicolon();
  }
  return this.finishNode(node, "ExportNamedDeclaration");
};
pp$8.parseExportDeclaration = function(node) {
  return this.parseStatement(null);
};
pp$8.parseExportDefaultDeclaration = function() {
  var isAsync;
  if (this.type === types$1._function || (isAsync = this.isAsyncFunction())) {
    var fNode = this.startNode();
    this.next();
    if (isAsync) {
      this.next();
    }
    return this.parseFunction(fNode, FUNC_STATEMENT | FUNC_NULLABLE_ID, false, isAsync);
  } else if (this.type === types$1._class) {
    var cNode = this.startNode();
    return this.parseClass(cNode, "nullableID");
  } else {
    var declaration = this.parseMaybeAssign();
    this.semicolon();
    return declaration;
  }
};
pp$8.checkExport = function(exports, name, pos) {
  if (!exports) {
    return;
  }
  if (typeof name !== "string") {
    name = name.type === "Identifier" ? name.name : name.value;
  }
  if (hasOwn(exports, name)) {
    this.raiseRecoverable(pos, "Duplicate export '" + name + "'");
  }
  exports[name] = true;
};
pp$8.checkPatternExport = function(exports, pat) {
  var type = pat.type;
  if (type === "Identifier") {
    this.checkExport(exports, pat, pat.start);
  } else if (type === "ObjectPattern") {
    for (var i2 = 0, list2 = pat.properties; i2 < list2.length; i2 += 1) {
      var prop = list2[i2];
      this.checkPatternExport(exports, prop);
    }
  } else if (type === "ArrayPattern") {
    for (var i$1 = 0, list$1 = pat.elements; i$1 < list$1.length; i$1 += 1) {
      var elt = list$1[i$1];
      if (elt) {
        this.checkPatternExport(exports, elt);
      }
    }
  } else if (type === "Property") {
    this.checkPatternExport(exports, pat.value);
  } else if (type === "AssignmentPattern") {
    this.checkPatternExport(exports, pat.left);
  } else if (type === "RestElement") {
    this.checkPatternExport(exports, pat.argument);
  }
};
pp$8.checkVariableExport = function(exports, decls) {
  if (!exports) {
    return;
  }
  for (var i2 = 0, list2 = decls; i2 < list2.length; i2 += 1) {
    var decl = list2[i2];
    this.checkPatternExport(exports, decl.id);
  }
};
pp$8.shouldParseExportStatement = function() {
  return this.type.keyword === "var" || this.type.keyword === "const" || this.type.keyword === "class" || this.type.keyword === "function" || this.isLet() || this.isAsyncFunction();
};
pp$8.parseExportSpecifier = function(exports) {
  var node = this.startNode();
  node.local = this.parseModuleExportName();
  node.exported = this.eatContextual("as") ? this.parseModuleExportName() : node.local;
  this.checkExport(
    exports,
    node.exported,
    node.exported.start
  );
  return this.finishNode(node, "ExportSpecifier");
};
pp$8.parseExportSpecifiers = function(exports) {
  var nodes = [], first = true;
  this.expect(types$1.braceL);
  while (!this.eat(types$1.braceR)) {
    if (!first) {
      this.expect(types$1.comma);
      if (this.afterTrailingComma(types$1.braceR)) {
        break;
      }
    } else {
      first = false;
    }
    nodes.push(this.parseExportSpecifier(exports));
  }
  return nodes;
};
pp$8.parseImport = function(node) {
  this.next();
  if (this.type === types$1.string) {
    node.specifiers = empty$1;
    node.source = this.parseExprAtom();
  } else {
    node.specifiers = this.parseImportSpecifiers();
    this.expectContextual("from");
    node.source = this.type === types$1.string ? this.parseExprAtom() : this.unexpected();
  }
  if (this.options.ecmaVersion >= 16) {
    node.attributes = this.parseWithClause();
  }
  this.semicolon();
  return this.finishNode(node, "ImportDeclaration");
};
pp$8.parseImportSpecifier = function() {
  var node = this.startNode();
  node.imported = this.parseModuleExportName();
  if (this.eatContextual("as")) {
    node.local = this.parseIdent();
  } else {
    this.checkUnreserved(node.imported);
    node.local = node.imported;
  }
  this.checkLValSimple(node.local, BIND_LEXICAL);
  return this.finishNode(node, "ImportSpecifier");
};
pp$8.parseImportDefaultSpecifier = function() {
  var node = this.startNode();
  node.local = this.parseIdent();
  this.checkLValSimple(node.local, BIND_LEXICAL);
  return this.finishNode(node, "ImportDefaultSpecifier");
};
pp$8.parseImportNamespaceSpecifier = function() {
  var node = this.startNode();
  this.next();
  this.expectContextual("as");
  node.local = this.parseIdent();
  this.checkLValSimple(node.local, BIND_LEXICAL);
  return this.finishNode(node, "ImportNamespaceSpecifier");
};
pp$8.parseImportSpecifiers = function() {
  var nodes = [], first = true;
  if (this.type === types$1.name) {
    nodes.push(this.parseImportDefaultSpecifier());
    if (!this.eat(types$1.comma)) {
      return nodes;
    }
  }
  if (this.type === types$1.star) {
    nodes.push(this.parseImportNamespaceSpecifier());
    return nodes;
  }
  this.expect(types$1.braceL);
  while (!this.eat(types$1.braceR)) {
    if (!first) {
      this.expect(types$1.comma);
      if (this.afterTrailingComma(types$1.braceR)) {
        break;
      }
    } else {
      first = false;
    }
    nodes.push(this.parseImportSpecifier());
  }
  return nodes;
};
pp$8.parseWithClause = function() {
  var nodes = [];
  if (!this.eat(types$1._with)) {
    return nodes;
  }
  this.expect(types$1.braceL);
  var attributeKeys = {};
  var first = true;
  while (!this.eat(types$1.braceR)) {
    if (!first) {
      this.expect(types$1.comma);
      if (this.afterTrailingComma(types$1.braceR)) {
        break;
      }
    } else {
      first = false;
    }
    var attr = this.parseImportAttribute();
    var keyName = attr.key.type === "Identifier" ? attr.key.name : attr.key.value;
    if (hasOwn(attributeKeys, keyName)) {
      this.raiseRecoverable(attr.key.start, "Duplicate attribute key '" + keyName + "'");
    }
    attributeKeys[keyName] = true;
    nodes.push(attr);
  }
  return nodes;
};
pp$8.parseImportAttribute = function() {
  var node = this.startNode();
  node.key = this.type === types$1.string ? this.parseExprAtom() : this.parseIdent(this.options.allowReserved !== "never");
  this.expect(types$1.colon);
  if (this.type !== types$1.string) {
    this.unexpected();
  }
  node.value = this.parseExprAtom();
  return this.finishNode(node, "ImportAttribute");
};
pp$8.parseModuleExportName = function() {
  if (this.options.ecmaVersion >= 13 && this.type === types$1.string) {
    var stringLiteral = this.parseLiteral(this.value);
    if (loneSurrogate.test(stringLiteral.value)) {
      this.raise(stringLiteral.start, "An export name cannot include a lone surrogate.");
    }
    return stringLiteral;
  }
  return this.parseIdent(true);
};
pp$8.adaptDirectivePrologue = function(statements) {
  for (var i2 = 0; i2 < statements.length && this.isDirectiveCandidate(statements[i2]); ++i2) {
    statements[i2].directive = statements[i2].expression.raw.slice(1, -1);
  }
};
pp$8.isDirectiveCandidate = function(statement) {
  return this.options.ecmaVersion >= 5 && statement.type === "ExpressionStatement" && statement.expression.type === "Literal" && typeof statement.expression.value === "string" && // Reject parenthesized strings.
  (this.input[statement.start] === '"' || this.input[statement.start] === "'");
};
var pp$7 = Parser.prototype;
pp$7.toAssignable = function(node, isBinding, refDestructuringErrors) {
  if (this.options.ecmaVersion >= 6 && node) {
    switch (node.type) {
      case "Identifier":
        if (this.inAsync && node.name === "await") {
          this.raise(node.start, "Cannot use 'await' as identifier inside an async function");
        }
        break;
      case "ObjectPattern":
      case "ArrayPattern":
      case "AssignmentPattern":
      case "RestElement":
        break;
      case "ObjectExpression":
        node.type = "ObjectPattern";
        if (refDestructuringErrors) {
          this.checkPatternErrors(refDestructuringErrors, true);
        }
        for (var i2 = 0, list2 = node.properties; i2 < list2.length; i2 += 1) {
          var prop = list2[i2];
          this.toAssignable(prop, isBinding);
          if (prop.type === "RestElement" && (prop.argument.type === "ArrayPattern" || prop.argument.type === "ObjectPattern")) {
            this.raise(prop.argument.start, "Unexpected token");
          }
        }
        break;
      case "Property":
        if (node.kind !== "init") {
          this.raise(node.key.start, "Object pattern can't contain getter or setter");
        }
        this.toAssignable(node.value, isBinding);
        break;
      case "ArrayExpression":
        node.type = "ArrayPattern";
        if (refDestructuringErrors) {
          this.checkPatternErrors(refDestructuringErrors, true);
        }
        this.toAssignableList(node.elements, isBinding);
        break;
      case "SpreadElement":
        node.type = "RestElement";
        this.toAssignable(node.argument, isBinding);
        if (node.argument.type === "AssignmentPattern") {
          this.raise(node.argument.start, "Rest elements cannot have a default value");
        }
        break;
      case "AssignmentExpression":
        if (node.operator !== "=") {
          this.raise(node.left.end, "Only '=' operator can be used for specifying default value.");
        }
        node.type = "AssignmentPattern";
        delete node.operator;
        this.toAssignable(node.left, isBinding);
        break;
      case "ParenthesizedExpression":
        this.toAssignable(node.expression, isBinding, refDestructuringErrors);
        break;
      case "ChainExpression":
        this.raiseRecoverable(node.start, "Optional chaining cannot appear in left-hand side");
        break;
      case "MemberExpression":
        if (!isBinding) {
          break;
        }
      default:
        this.raise(node.start, "Assigning to rvalue");
    }
  } else if (refDestructuringErrors) {
    this.checkPatternErrors(refDestructuringErrors, true);
  }
  return node;
};
pp$7.toAssignableList = function(exprList, isBinding) {
  var end = exprList.length;
  for (var i2 = 0; i2 < end; i2++) {
    var elt = exprList[i2];
    if (elt) {
      this.toAssignable(elt, isBinding);
    }
  }
  if (end) {
    var last = exprList[end - 1];
    if (this.options.ecmaVersion === 6 && isBinding && last && last.type === "RestElement" && last.argument.type !== "Identifier") {
      this.unexpected(last.argument.start);
    }
  }
  return exprList;
};
pp$7.parseSpread = function(refDestructuringErrors) {
  var node = this.startNode();
  this.next();
  node.argument = this.parseMaybeAssign(false, refDestructuringErrors);
  return this.finishNode(node, "SpreadElement");
};
pp$7.parseRestBinding = function() {
  var node = this.startNode();
  this.next();
  if (this.options.ecmaVersion === 6 && this.type !== types$1.name) {
    this.unexpected();
  }
  node.argument = this.parseBindingAtom();
  return this.finishNode(node, "RestElement");
};
pp$7.parseBindingAtom = function() {
  if (this.options.ecmaVersion >= 6) {
    switch (this.type) {
      case types$1.bracketL:
        var node = this.startNode();
        this.next();
        node.elements = this.parseBindingList(types$1.bracketR, true, true);
        return this.finishNode(node, "ArrayPattern");
      case types$1.braceL:
        return this.parseObj(true);
    }
  }
  return this.parseIdent();
};
pp$7.parseBindingList = function(close, allowEmpty, allowTrailingComma, allowModifiers) {
  var elts = [], first = true;
  while (!this.eat(close)) {
    if (first) {
      first = false;
    } else {
      this.expect(types$1.comma);
    }
    if (allowEmpty && this.type === types$1.comma) {
      elts.push(null);
    } else if (allowTrailingComma && this.afterTrailingComma(close)) {
      break;
    } else if (this.type === types$1.ellipsis) {
      var rest = this.parseRestBinding();
      this.parseBindingListItem(rest);
      elts.push(rest);
      if (this.type === types$1.comma) {
        this.raiseRecoverable(this.start, "Comma is not permitted after the rest element");
      }
      this.expect(close);
      break;
    } else {
      elts.push(this.parseAssignableListItem(allowModifiers));
    }
  }
  return elts;
};
pp$7.parseAssignableListItem = function(allowModifiers) {
  var elem = this.parseMaybeDefault(this.start, this.startLoc);
  this.parseBindingListItem(elem);
  return elem;
};
pp$7.parseBindingListItem = function(param) {
  return param;
};
pp$7.parseMaybeDefault = function(startPos, startLoc, left) {
  left = left || this.parseBindingAtom();
  if (this.options.ecmaVersion < 6 || !this.eat(types$1.eq)) {
    return left;
  }
  var node = this.startNodeAt(startPos, startLoc);
  node.left = left;
  node.right = this.parseMaybeAssign();
  return this.finishNode(node, "AssignmentPattern");
};
pp$7.checkLValSimple = function(expr, bindingType, checkClashes) {
  if (bindingType === void 0) bindingType = BIND_NONE;
  var isBind = bindingType !== BIND_NONE;
  switch (expr.type) {
    case "Identifier":
      if (this.strict && this.reservedWordsStrictBind.test(expr.name)) {
        this.raiseRecoverable(expr.start, (isBind ? "Binding " : "Assigning to ") + expr.name + " in strict mode");
      }
      if (isBind) {
        if (bindingType === BIND_LEXICAL && expr.name === "let") {
          this.raiseRecoverable(expr.start, "let is disallowed as a lexically bound name");
        }
        if (checkClashes) {
          if (hasOwn(checkClashes, expr.name)) {
            this.raiseRecoverable(expr.start, "Argument name clash");
          }
          checkClashes[expr.name] = true;
        }
        if (bindingType !== BIND_OUTSIDE) {
          this.declareName(expr.name, bindingType, expr.start);
        }
      }
      break;
    case "ChainExpression":
      this.raiseRecoverable(expr.start, "Optional chaining cannot appear in left-hand side");
      break;
    case "MemberExpression":
      if (isBind) {
        this.raiseRecoverable(expr.start, "Binding member expression");
      }
      break;
    case "ParenthesizedExpression":
      if (isBind) {
        this.raiseRecoverable(expr.start, "Binding parenthesized expression");
      }
      return this.checkLValSimple(expr.expression, bindingType, checkClashes);
    default:
      this.raise(expr.start, (isBind ? "Binding" : "Assigning to") + " rvalue");
  }
};
pp$7.checkLValPattern = function(expr, bindingType, checkClashes) {
  if (bindingType === void 0) bindingType = BIND_NONE;
  switch (expr.type) {
    case "ObjectPattern":
      for (var i2 = 0, list2 = expr.properties; i2 < list2.length; i2 += 1) {
        var prop = list2[i2];
        this.checkLValInnerPattern(prop, bindingType, checkClashes);
      }
      break;
    case "ArrayPattern":
      for (var i$1 = 0, list$1 = expr.elements; i$1 < list$1.length; i$1 += 1) {
        var elem = list$1[i$1];
        if (elem) {
          this.checkLValInnerPattern(elem, bindingType, checkClashes);
        }
      }
      break;
    default:
      this.checkLValSimple(expr, bindingType, checkClashes);
  }
};
pp$7.checkLValInnerPattern = function(expr, bindingType, checkClashes) {
  if (bindingType === void 0) bindingType = BIND_NONE;
  switch (expr.type) {
    case "Property":
      this.checkLValInnerPattern(expr.value, bindingType, checkClashes);
      break;
    case "AssignmentPattern":
      this.checkLValPattern(expr.left, bindingType, checkClashes);
      break;
    case "RestElement":
      this.checkLValPattern(expr.argument, bindingType, checkClashes);
      break;
    default:
      this.checkLValPattern(expr, bindingType, checkClashes);
  }
};
var TokContext = function TokContext2(token, isExpr, preserveSpace, override, generator) {
  this.token = token;
  this.isExpr = !!isExpr;
  this.preserveSpace = !!preserveSpace;
  this.override = override;
  this.generator = !!generator;
};
var types = {
  b_stat: new TokContext("{", false),
  b_expr: new TokContext("{", true),
  b_tmpl: new TokContext("${", false),
  p_stat: new TokContext("(", false),
  p_expr: new TokContext("(", true),
  q_tmpl: new TokContext("`", true, true, function(p) {
    return p.tryReadTemplateToken();
  }),
  f_stat: new TokContext("function", false),
  f_expr: new TokContext("function", true),
  f_expr_gen: new TokContext("function", true, false, null, true),
  f_gen: new TokContext("function", false, false, null, true)
};
var pp$6 = Parser.prototype;
pp$6.initialContext = function() {
  return [types.b_stat];
};
pp$6.curContext = function() {
  return this.context[this.context.length - 1];
};
pp$6.braceIsBlock = function(prevType) {
  var parent = this.curContext();
  if (parent === types.f_expr || parent === types.f_stat) {
    return true;
  }
  if (prevType === types$1.colon && (parent === types.b_stat || parent === types.b_expr)) {
    return !parent.isExpr;
  }
  if (prevType === types$1._return || prevType === types$1.name && this.exprAllowed) {
    return lineBreak.test(this.input.slice(this.lastTokEnd, this.start));
  }
  if (prevType === types$1._else || prevType === types$1.semi || prevType === types$1.eof || prevType === types$1.parenR || prevType === types$1.arrow) {
    return true;
  }
  if (prevType === types$1.braceL) {
    return parent === types.b_stat;
  }
  if (prevType === types$1._var || prevType === types$1._const || prevType === types$1.name) {
    return false;
  }
  return !this.exprAllowed;
};
pp$6.inGeneratorContext = function() {
  for (var i2 = this.context.length - 1; i2 >= 1; i2--) {
    var context = this.context[i2];
    if (context.token === "function") {
      return context.generator;
    }
  }
  return false;
};
pp$6.updateContext = function(prevType) {
  var update, type = this.type;
  if (type.keyword && prevType === types$1.dot) {
    this.exprAllowed = false;
  } else if (update = type.updateContext) {
    update.call(this, prevType);
  } else {
    this.exprAllowed = type.beforeExpr;
  }
};
pp$6.overrideContext = function(tokenCtx) {
  if (this.curContext() !== tokenCtx) {
    this.context[this.context.length - 1] = tokenCtx;
  }
};
types$1.parenR.updateContext = types$1.braceR.updateContext = function() {
  if (this.context.length === 1) {
    this.exprAllowed = true;
    return;
  }
  var out = this.context.pop();
  if (out === types.b_stat && this.curContext().token === "function") {
    out = this.context.pop();
  }
  this.exprAllowed = !out.isExpr;
};
types$1.braceL.updateContext = function(prevType) {
  this.context.push(this.braceIsBlock(prevType) ? types.b_stat : types.b_expr);
  this.exprAllowed = true;
};
types$1.dollarBraceL.updateContext = function() {
  this.context.push(types.b_tmpl);
  this.exprAllowed = true;
};
types$1.parenL.updateContext = function(prevType) {
  var statementParens = prevType === types$1._if || prevType === types$1._for || prevType === types$1._with || prevType === types$1._while;
  this.context.push(statementParens ? types.p_stat : types.p_expr);
  this.exprAllowed = true;
};
types$1.incDec.updateContext = function() {
};
types$1._function.updateContext = types$1._class.updateContext = function(prevType) {
  if (prevType.beforeExpr && prevType !== types$1._else && !(prevType === types$1.semi && this.curContext() !== types.p_stat) && !(prevType === types$1._return && lineBreak.test(this.input.slice(this.lastTokEnd, this.start))) && !((prevType === types$1.colon || prevType === types$1.braceL) && this.curContext() === types.b_stat)) {
    this.context.push(types.f_expr);
  } else {
    this.context.push(types.f_stat);
  }
  this.exprAllowed = false;
};
types$1.colon.updateContext = function() {
  if (this.curContext().token === "function") {
    this.context.pop();
  }
  this.exprAllowed = true;
};
types$1.backQuote.updateContext = function() {
  if (this.curContext() === types.q_tmpl) {
    this.context.pop();
  } else {
    this.context.push(types.q_tmpl);
  }
  this.exprAllowed = false;
};
types$1.star.updateContext = function(prevType) {
  if (prevType === types$1._function) {
    var index = this.context.length - 1;
    if (this.context[index] === types.f_expr) {
      this.context[index] = types.f_expr_gen;
    } else {
      this.context[index] = types.f_gen;
    }
  }
  this.exprAllowed = true;
};
types$1.name.updateContext = function(prevType) {
  var allowed = false;
  if (this.options.ecmaVersion >= 6 && prevType !== types$1.dot) {
    if (this.value === "of" && !this.exprAllowed || this.value === "yield" && this.inGeneratorContext()) {
      allowed = true;
    }
  }
  this.exprAllowed = allowed;
};
var pp$5 = Parser.prototype;
pp$5.checkPropClash = function(prop, propHash, refDestructuringErrors) {
  if (this.options.ecmaVersion >= 9 && prop.type === "SpreadElement") {
    return;
  }
  if (this.options.ecmaVersion >= 6 && (prop.computed || prop.method || prop.shorthand)) {
    return;
  }
  var key2 = prop.key;
  var name;
  switch (key2.type) {
    case "Identifier":
      name = key2.name;
      break;
    case "Literal":
      name = String(key2.value);
      break;
    default:
      return;
  }
  var kind = prop.kind;
  if (this.options.ecmaVersion >= 6) {
    if (name === "__proto__" && kind === "init") {
      if (propHash.proto) {
        if (refDestructuringErrors) {
          if (refDestructuringErrors.doubleProto < 0) {
            refDestructuringErrors.doubleProto = key2.start;
          }
        } else {
          this.raiseRecoverable(key2.start, "Redefinition of __proto__ property");
        }
      }
      propHash.proto = true;
    }
    return;
  }
  name = "$" + name;
  var other = propHash[name];
  if (other) {
    var redefinition;
    if (kind === "init") {
      redefinition = this.strict && other.init || other.get || other.set;
    } else {
      redefinition = other.init || other[kind];
    }
    if (redefinition) {
      this.raiseRecoverable(key2.start, "Redefinition of property");
    }
  } else {
    other = propHash[name] = {
      init: false,
      get: false,
      set: false
    };
  }
  other[kind] = true;
};
pp$5.parseExpression = function(forInit, refDestructuringErrors) {
  var startPos = this.start, startLoc = this.startLoc;
  var expr = this.parseMaybeAssign(forInit, refDestructuringErrors);
  if (this.type === types$1.comma) {
    var node = this.startNodeAt(startPos, startLoc);
    node.expressions = [expr];
    while (this.eat(types$1.comma)) {
      node.expressions.push(this.parseMaybeAssign(forInit, refDestructuringErrors));
    }
    return this.finishNode(node, "SequenceExpression");
  }
  return expr;
};
pp$5.parseMaybeAssign = function(forInit, refDestructuringErrors, afterLeftParse) {
  if (this.isContextual("yield")) {
    if (this.inGenerator) {
      return this.parseYield(forInit);
    } else {
      this.exprAllowed = false;
    }
  }
  var ownDestructuringErrors = false, oldParenAssign = -1, oldTrailingComma = -1, oldDoubleProto = -1;
  if (refDestructuringErrors) {
    oldParenAssign = refDestructuringErrors.parenthesizedAssign;
    oldTrailingComma = refDestructuringErrors.trailingComma;
    oldDoubleProto = refDestructuringErrors.doubleProto;
    refDestructuringErrors.parenthesizedAssign = refDestructuringErrors.trailingComma = -1;
  } else {
    refDestructuringErrors = new DestructuringErrors();
    ownDestructuringErrors = true;
  }
  var startPos = this.start, startLoc = this.startLoc;
  if (this.type === types$1.parenL || this.type === types$1.name) {
    this.potentialArrowAt = this.start;
    this.potentialArrowInForAwait = forInit === "await";
  }
  var left = this.parseMaybeConditional(forInit, refDestructuringErrors);
  if (afterLeftParse) {
    left = afterLeftParse.call(this, left, startPos, startLoc);
  }
  if (this.type.isAssign) {
    var node = this.startNodeAt(startPos, startLoc);
    node.operator = this.value;
    if (this.type === types$1.eq) {
      left = this.toAssignable(left, false, refDestructuringErrors);
    }
    if (!ownDestructuringErrors) {
      refDestructuringErrors.parenthesizedAssign = refDestructuringErrors.trailingComma = refDestructuringErrors.doubleProto = -1;
    }
    if (refDestructuringErrors.shorthandAssign >= left.start) {
      refDestructuringErrors.shorthandAssign = -1;
    }
    if (this.type === types$1.eq) {
      this.checkLValPattern(left);
    } else {
      this.checkLValSimple(left);
    }
    node.left = left;
    this.next();
    node.right = this.parseMaybeAssign(forInit);
    if (oldDoubleProto > -1) {
      refDestructuringErrors.doubleProto = oldDoubleProto;
    }
    return this.finishNode(node, "AssignmentExpression");
  } else {
    if (ownDestructuringErrors) {
      this.checkExpressionErrors(refDestructuringErrors, true);
    }
  }
  if (oldParenAssign > -1) {
    refDestructuringErrors.parenthesizedAssign = oldParenAssign;
  }
  if (oldTrailingComma > -1) {
    refDestructuringErrors.trailingComma = oldTrailingComma;
  }
  return left;
};
pp$5.parseMaybeConditional = function(forInit, refDestructuringErrors) {
  var startPos = this.start, startLoc = this.startLoc;
  var expr = this.parseExprOps(forInit, refDestructuringErrors);
  if (this.checkExpressionErrors(refDestructuringErrors)) {
    return expr;
  }
  if (this.eat(types$1.question)) {
    var node = this.startNodeAt(startPos, startLoc);
    node.test = expr;
    node.consequent = this.parseMaybeAssign();
    this.expect(types$1.colon);
    node.alternate = this.parseMaybeAssign(forInit);
    return this.finishNode(node, "ConditionalExpression");
  }
  return expr;
};
pp$5.parseExprOps = function(forInit, refDestructuringErrors) {
  var startPos = this.start, startLoc = this.startLoc;
  var expr = this.parseMaybeUnary(refDestructuringErrors, false, false, forInit);
  if (this.checkExpressionErrors(refDestructuringErrors)) {
    return expr;
  }
  return expr.start === startPos && expr.type === "ArrowFunctionExpression" ? expr : this.parseExprOp(expr, startPos, startLoc, -1, forInit);
};
pp$5.parseExprOp = function(left, leftStartPos, leftStartLoc, minPrec, forInit) {
  var prec = this.type.binop;
  if (prec != null && (!forInit || this.type !== types$1._in)) {
    if (prec > minPrec) {
      var logical = this.type === types$1.logicalOR || this.type === types$1.logicalAND;
      var coalesce2 = this.type === types$1.coalesce;
      if (coalesce2) {
        prec = types$1.logicalAND.binop;
      }
      var op = this.value;
      this.next();
      var startPos = this.start, startLoc = this.startLoc;
      var right = this.parseExprOp(this.parseMaybeUnary(null, false, false, forInit), startPos, startLoc, prec, forInit);
      var node = this.buildBinary(leftStartPos, leftStartLoc, left, right, op, logical || coalesce2);
      if (logical && this.type === types$1.coalesce || coalesce2 && (this.type === types$1.logicalOR || this.type === types$1.logicalAND)) {
        this.raiseRecoverable(this.start, "Logical expressions and coalesce expressions cannot be mixed. Wrap either by parentheses");
      }
      return this.parseExprOp(node, leftStartPos, leftStartLoc, minPrec, forInit);
    }
  }
  return left;
};
pp$5.buildBinary = function(startPos, startLoc, left, right, op, logical) {
  if (right.type === "PrivateIdentifier") {
    this.raise(right.start, "Private identifier can only be left side of binary expression");
  }
  var node = this.startNodeAt(startPos, startLoc);
  node.left = left;
  node.operator = op;
  node.right = right;
  return this.finishNode(node, logical ? "LogicalExpression" : "BinaryExpression");
};
pp$5.parseMaybeUnary = function(refDestructuringErrors, sawUnary, incDec, forInit) {
  var startPos = this.start, startLoc = this.startLoc, expr;
  if (this.isContextual("await") && this.canAwait) {
    expr = this.parseAwait(forInit);
    sawUnary = true;
  } else if (this.type.prefix) {
    var node = this.startNode(), update = this.type === types$1.incDec;
    node.operator = this.value;
    node.prefix = true;
    this.next();
    node.argument = this.parseMaybeUnary(null, true, update, forInit);
    this.checkExpressionErrors(refDestructuringErrors, true);
    if (update) {
      this.checkLValSimple(node.argument);
    } else if (this.strict && node.operator === "delete" && isLocalVariableAccess(node.argument)) {
      this.raiseRecoverable(node.start, "Deleting local variable in strict mode");
    } else if (node.operator === "delete" && isPrivateFieldAccess(node.argument)) {
      this.raiseRecoverable(node.start, "Private fields can not be deleted");
    } else {
      sawUnary = true;
    }
    expr = this.finishNode(node, update ? "UpdateExpression" : "UnaryExpression");
  } else if (!sawUnary && this.type === types$1.privateId) {
    if ((forInit || this.privateNameStack.length === 0) && this.options.checkPrivateFields) {
      this.unexpected();
    }
    expr = this.parsePrivateIdent();
    if (this.type !== types$1._in) {
      this.unexpected();
    }
  } else {
    expr = this.parseExprSubscripts(refDestructuringErrors, forInit);
    if (this.checkExpressionErrors(refDestructuringErrors)) {
      return expr;
    }
    while (this.type.postfix && !this.canInsertSemicolon()) {
      var node$1 = this.startNodeAt(startPos, startLoc);
      node$1.operator = this.value;
      node$1.prefix = false;
      node$1.argument = expr;
      this.checkLValSimple(expr);
      this.next();
      expr = this.finishNode(node$1, "UpdateExpression");
    }
  }
  if (!incDec && this.eat(types$1.starstar)) {
    if (sawUnary) {
      this.unexpected(this.lastTokStart);
    } else {
      return this.buildBinary(startPos, startLoc, expr, this.parseMaybeUnary(null, false, false, forInit), "**", false);
    }
  } else {
    return expr;
  }
};
function isLocalVariableAccess(node) {
  return node.type === "Identifier" || node.type === "ParenthesizedExpression" && isLocalVariableAccess(node.expression);
}
function isPrivateFieldAccess(node) {
  return node.type === "MemberExpression" && node.property.type === "PrivateIdentifier" || node.type === "ChainExpression" && isPrivateFieldAccess(node.expression) || node.type === "ParenthesizedExpression" && isPrivateFieldAccess(node.expression);
}
pp$5.parseExprSubscripts = function(refDestructuringErrors, forInit) {
  var startPos = this.start, startLoc = this.startLoc;
  var expr = this.parseExprAtom(refDestructuringErrors, forInit);
  if (expr.type === "ArrowFunctionExpression" && this.input.slice(this.lastTokStart, this.lastTokEnd) !== ")") {
    return expr;
  }
  var result = this.parseSubscripts(expr, startPos, startLoc, false, forInit);
  if (refDestructuringErrors && result.type === "MemberExpression") {
    if (refDestructuringErrors.parenthesizedAssign >= result.start) {
      refDestructuringErrors.parenthesizedAssign = -1;
    }
    if (refDestructuringErrors.parenthesizedBind >= result.start) {
      refDestructuringErrors.parenthesizedBind = -1;
    }
    if (refDestructuringErrors.trailingComma >= result.start) {
      refDestructuringErrors.trailingComma = -1;
    }
  }
  return result;
};
pp$5.parseSubscripts = function(base, startPos, startLoc, noCalls, forInit) {
  var maybeAsyncArrow = this.options.ecmaVersion >= 8 && base.type === "Identifier" && base.name === "async" && this.lastTokEnd === base.end && !this.canInsertSemicolon() && base.end - base.start === 5 && this.potentialArrowAt === base.start;
  var optionalChained = false;
  while (true) {
    var element = this.parseSubscript(base, startPos, startLoc, noCalls, maybeAsyncArrow, optionalChained, forInit);
    if (element.optional) {
      optionalChained = true;
    }
    if (element === base || element.type === "ArrowFunctionExpression") {
      if (optionalChained) {
        var chainNode = this.startNodeAt(startPos, startLoc);
        chainNode.expression = element;
        element = this.finishNode(chainNode, "ChainExpression");
      }
      return element;
    }
    base = element;
  }
};
pp$5.shouldParseAsyncArrow = function() {
  return !this.canInsertSemicolon() && this.eat(types$1.arrow);
};
pp$5.parseSubscriptAsyncArrow = function(startPos, startLoc, exprList, forInit) {
  return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), exprList, true, forInit);
};
pp$5.parseSubscript = function(base, startPos, startLoc, noCalls, maybeAsyncArrow, optionalChained, forInit) {
  var optionalSupported = this.options.ecmaVersion >= 11;
  var optional = optionalSupported && this.eat(types$1.questionDot);
  if (noCalls && optional) {
    this.raise(this.lastTokStart, "Optional chaining cannot appear in the callee of new expressions");
  }
  var computed = this.eat(types$1.bracketL);
  if (computed || optional && this.type !== types$1.parenL && this.type !== types$1.backQuote || this.eat(types$1.dot)) {
    var node = this.startNodeAt(startPos, startLoc);
    node.object = base;
    if (computed) {
      node.property = this.parseExpression();
      this.expect(types$1.bracketR);
    } else if (this.type === types$1.privateId && base.type !== "Super") {
      node.property = this.parsePrivateIdent();
    } else {
      node.property = this.parseIdent(this.options.allowReserved !== "never");
    }
    node.computed = !!computed;
    if (optionalSupported) {
      node.optional = optional;
    }
    base = this.finishNode(node, "MemberExpression");
  } else if (!noCalls && this.eat(types$1.parenL)) {
    var refDestructuringErrors = new DestructuringErrors(), oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;
    this.yieldPos = 0;
    this.awaitPos = 0;
    this.awaitIdentPos = 0;
    var exprList = this.parseExprList(types$1.parenR, this.options.ecmaVersion >= 8, false, refDestructuringErrors);
    if (maybeAsyncArrow && !optional && this.shouldParseAsyncArrow()) {
      this.checkPatternErrors(refDestructuringErrors, false);
      this.checkYieldAwaitInDefaultParams();
      if (this.awaitIdentPos > 0) {
        this.raise(this.awaitIdentPos, "Cannot use 'await' as identifier inside an async function");
      }
      this.yieldPos = oldYieldPos;
      this.awaitPos = oldAwaitPos;
      this.awaitIdentPos = oldAwaitIdentPos;
      return this.parseSubscriptAsyncArrow(startPos, startLoc, exprList, forInit);
    }
    this.checkExpressionErrors(refDestructuringErrors, true);
    this.yieldPos = oldYieldPos || this.yieldPos;
    this.awaitPos = oldAwaitPos || this.awaitPos;
    this.awaitIdentPos = oldAwaitIdentPos || this.awaitIdentPos;
    var node$1 = this.startNodeAt(startPos, startLoc);
    node$1.callee = base;
    node$1.arguments = exprList;
    if (optionalSupported) {
      node$1.optional = optional;
    }
    base = this.finishNode(node$1, "CallExpression");
  } else if (this.type === types$1.backQuote) {
    if (optional || optionalChained) {
      this.raise(this.start, "Optional chaining cannot appear in the tag of tagged template expressions");
    }
    var node$2 = this.startNodeAt(startPos, startLoc);
    node$2.tag = base;
    node$2.quasi = this.parseTemplate({ isTagged: true });
    base = this.finishNode(node$2, "TaggedTemplateExpression");
  }
  return base;
};
pp$5.parseExprAtom = function(refDestructuringErrors, forInit, forNew) {
  if (this.type === types$1.slash) {
    this.readRegexp();
  }
  var node, canBeArrow = this.potentialArrowAt === this.start;
  switch (this.type) {
    case types$1._super:
      if (!this.allowSuper) {
        this.raise(this.start, "'super' keyword outside a method");
      }
      node = this.startNode();
      this.next();
      if (this.type === types$1.parenL && !this.allowDirectSuper) {
        this.raise(node.start, "super() call outside constructor of a subclass");
      }
      if (this.type !== types$1.dot && this.type !== types$1.bracketL && this.type !== types$1.parenL) {
        this.unexpected();
      }
      return this.finishNode(node, "Super");
    case types$1._this:
      node = this.startNode();
      this.next();
      return this.finishNode(node, "ThisExpression");
    case types$1.name:
      var startPos = this.start, startLoc = this.startLoc, containsEsc = this.containsEsc;
      var id = this.parseIdent(false);
      if (this.options.ecmaVersion >= 8 && !containsEsc && id.name === "async" && !this.canInsertSemicolon() && this.eat(types$1._function)) {
        this.overrideContext(types.f_expr);
        return this.parseFunction(this.startNodeAt(startPos, startLoc), 0, false, true, forInit);
      }
      if (canBeArrow && !this.canInsertSemicolon()) {
        if (this.eat(types$1.arrow)) {
          return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), [id], false, forInit);
        }
        if (this.options.ecmaVersion >= 8 && id.name === "async" && this.type === types$1.name && !containsEsc && (!this.potentialArrowInForAwait || this.value !== "of" || this.containsEsc)) {
          id = this.parseIdent(false);
          if (this.canInsertSemicolon() || !this.eat(types$1.arrow)) {
            this.unexpected();
          }
          return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), [id], true, forInit);
        }
      }
      return id;
    case types$1.regexp:
      var value = this.value;
      node = this.parseLiteral(value.value);
      node.regex = { pattern: value.pattern, flags: value.flags };
      return node;
    case types$1.num:
    case types$1.string:
      return this.parseLiteral(this.value);
    case types$1._null:
    case types$1._true:
    case types$1._false:
      node = this.startNode();
      node.value = this.type === types$1._null ? null : this.type === types$1._true;
      node.raw = this.type.keyword;
      this.next();
      return this.finishNode(node, "Literal");
    case types$1.parenL:
      var start = this.start, expr = this.parseParenAndDistinguishExpression(canBeArrow, forInit);
      if (refDestructuringErrors) {
        if (refDestructuringErrors.parenthesizedAssign < 0 && !this.isSimpleAssignTarget(expr)) {
          refDestructuringErrors.parenthesizedAssign = start;
        }
        if (refDestructuringErrors.parenthesizedBind < 0) {
          refDestructuringErrors.parenthesizedBind = start;
        }
      }
      return expr;
    case types$1.bracketL:
      node = this.startNode();
      this.next();
      node.elements = this.parseExprList(types$1.bracketR, true, true, refDestructuringErrors);
      return this.finishNode(node, "ArrayExpression");
    case types$1.braceL:
      this.overrideContext(types.b_expr);
      return this.parseObj(false, refDestructuringErrors);
    case types$1._function:
      node = this.startNode();
      this.next();
      return this.parseFunction(node, 0);
    case types$1._class:
      return this.parseClass(this.startNode(), false);
    case types$1._new:
      return this.parseNew();
    case types$1.backQuote:
      return this.parseTemplate();
    case types$1._import:
      if (this.options.ecmaVersion >= 11) {
        return this.parseExprImport(forNew);
      } else {
        return this.unexpected();
      }
    default:
      return this.parseExprAtomDefault();
  }
};
pp$5.parseExprAtomDefault = function() {
  this.unexpected();
};
pp$5.parseExprImport = function(forNew) {
  var node = this.startNode();
  if (this.containsEsc) {
    this.raiseRecoverable(this.start, "Escape sequence in keyword import");
  }
  this.next();
  if (this.type === types$1.parenL && !forNew) {
    return this.parseDynamicImport(node);
  } else if (this.type === types$1.dot) {
    var meta = this.startNodeAt(node.start, node.loc && node.loc.start);
    meta.name = "import";
    node.meta = this.finishNode(meta, "Identifier");
    return this.parseImportMeta(node);
  } else {
    this.unexpected();
  }
};
pp$5.parseDynamicImport = function(node) {
  this.next();
  node.source = this.parseMaybeAssign();
  if (this.options.ecmaVersion >= 16) {
    if (!this.eat(types$1.parenR)) {
      this.expect(types$1.comma);
      if (!this.afterTrailingComma(types$1.parenR)) {
        node.options = this.parseMaybeAssign();
        if (!this.eat(types$1.parenR)) {
          this.expect(types$1.comma);
          if (!this.afterTrailingComma(types$1.parenR)) {
            this.unexpected();
          }
        }
      } else {
        node.options = null;
      }
    } else {
      node.options = null;
    }
  } else {
    if (!this.eat(types$1.parenR)) {
      var errorPos = this.start;
      if (this.eat(types$1.comma) && this.eat(types$1.parenR)) {
        this.raiseRecoverable(errorPos, "Trailing comma is not allowed in import()");
      } else {
        this.unexpected(errorPos);
      }
    }
  }
  return this.finishNode(node, "ImportExpression");
};
pp$5.parseImportMeta = function(node) {
  this.next();
  var containsEsc = this.containsEsc;
  node.property = this.parseIdent(true);
  if (node.property.name !== "meta") {
    this.raiseRecoverable(node.property.start, "The only valid meta property for import is 'import.meta'");
  }
  if (containsEsc) {
    this.raiseRecoverable(node.start, "'import.meta' must not contain escaped characters");
  }
  if (this.options.sourceType !== "module" && !this.options.allowImportExportEverywhere) {
    this.raiseRecoverable(node.start, "Cannot use 'import.meta' outside a module");
  }
  return this.finishNode(node, "MetaProperty");
};
pp$5.parseLiteral = function(value) {
  var node = this.startNode();
  node.value = value;
  node.raw = this.input.slice(this.start, this.end);
  if (node.raw.charCodeAt(node.raw.length - 1) === 110) {
    node.bigint = node.value != null ? node.value.toString() : node.raw.slice(0, -1).replace(/_/g, "");
  }
  this.next();
  return this.finishNode(node, "Literal");
};
pp$5.parseParenExpression = function() {
  this.expect(types$1.parenL);
  var val = this.parseExpression();
  this.expect(types$1.parenR);
  return val;
};
pp$5.shouldParseArrow = function(exprList) {
  return !this.canInsertSemicolon();
};
pp$5.parseParenAndDistinguishExpression = function(canBeArrow, forInit) {
  var startPos = this.start, startLoc = this.startLoc, val, allowTrailingComma = this.options.ecmaVersion >= 8;
  if (this.options.ecmaVersion >= 6) {
    this.next();
    var innerStartPos = this.start, innerStartLoc = this.startLoc;
    var exprList = [], first = true, lastIsComma = false;
    var refDestructuringErrors = new DestructuringErrors(), oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, spreadStart;
    this.yieldPos = 0;
    this.awaitPos = 0;
    while (this.type !== types$1.parenR) {
      first ? first = false : this.expect(types$1.comma);
      if (allowTrailingComma && this.afterTrailingComma(types$1.parenR, true)) {
        lastIsComma = true;
        break;
      } else if (this.type === types$1.ellipsis) {
        spreadStart = this.start;
        exprList.push(this.parseParenItem(this.parseRestBinding()));
        if (this.type === types$1.comma) {
          this.raiseRecoverable(
            this.start,
            "Comma is not permitted after the rest element"
          );
        }
        break;
      } else {
        exprList.push(this.parseMaybeAssign(false, refDestructuringErrors, this.parseParenItem));
      }
    }
    var innerEndPos = this.lastTokEnd, innerEndLoc = this.lastTokEndLoc;
    this.expect(types$1.parenR);
    if (canBeArrow && this.shouldParseArrow(exprList) && this.eat(types$1.arrow)) {
      this.checkPatternErrors(refDestructuringErrors, false);
      this.checkYieldAwaitInDefaultParams();
      this.yieldPos = oldYieldPos;
      this.awaitPos = oldAwaitPos;
      return this.parseParenArrowList(startPos, startLoc, exprList, forInit);
    }
    if (!exprList.length || lastIsComma) {
      this.unexpected(this.lastTokStart);
    }
    if (spreadStart) {
      this.unexpected(spreadStart);
    }
    this.checkExpressionErrors(refDestructuringErrors, true);
    this.yieldPos = oldYieldPos || this.yieldPos;
    this.awaitPos = oldAwaitPos || this.awaitPos;
    if (exprList.length > 1) {
      val = this.startNodeAt(innerStartPos, innerStartLoc);
      val.expressions = exprList;
      this.finishNodeAt(val, "SequenceExpression", innerEndPos, innerEndLoc);
    } else {
      val = exprList[0];
    }
  } else {
    val = this.parseParenExpression();
  }
  if (this.options.preserveParens) {
    var par = this.startNodeAt(startPos, startLoc);
    par.expression = val;
    return this.finishNode(par, "ParenthesizedExpression");
  } else {
    return val;
  }
};
pp$5.parseParenItem = function(item) {
  return item;
};
pp$5.parseParenArrowList = function(startPos, startLoc, exprList, forInit) {
  return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), exprList, false, forInit);
};
var empty = [];
pp$5.parseNew = function() {
  if (this.containsEsc) {
    this.raiseRecoverable(this.start, "Escape sequence in keyword new");
  }
  var node = this.startNode();
  this.next();
  if (this.options.ecmaVersion >= 6 && this.type === types$1.dot) {
    var meta = this.startNodeAt(node.start, node.loc && node.loc.start);
    meta.name = "new";
    node.meta = this.finishNode(meta, "Identifier");
    this.next();
    var containsEsc = this.containsEsc;
    node.property = this.parseIdent(true);
    if (node.property.name !== "target") {
      this.raiseRecoverable(node.property.start, "The only valid meta property for new is 'new.target'");
    }
    if (containsEsc) {
      this.raiseRecoverable(node.start, "'new.target' must not contain escaped characters");
    }
    if (!this.allowNewDotTarget) {
      this.raiseRecoverable(node.start, "'new.target' can only be used in functions and class static block");
    }
    return this.finishNode(node, "MetaProperty");
  }
  var startPos = this.start, startLoc = this.startLoc;
  node.callee = this.parseSubscripts(this.parseExprAtom(null, false, true), startPos, startLoc, true, false);
  if (this.eat(types$1.parenL)) {
    node.arguments = this.parseExprList(types$1.parenR, this.options.ecmaVersion >= 8, false);
  } else {
    node.arguments = empty;
  }
  return this.finishNode(node, "NewExpression");
};
pp$5.parseTemplateElement = function(ref2) {
  var isTagged = ref2.isTagged;
  var elem = this.startNode();
  if (this.type === types$1.invalidTemplate) {
    if (!isTagged) {
      this.raiseRecoverable(this.start, "Bad escape sequence in untagged template literal");
    }
    elem.value = {
      raw: this.value.replace(/\r\n?/g, "\n"),
      cooked: null
    };
  } else {
    elem.value = {
      raw: this.input.slice(this.start, this.end).replace(/\r\n?/g, "\n"),
      cooked: this.value
    };
  }
  this.next();
  elem.tail = this.type === types$1.backQuote;
  return this.finishNode(elem, "TemplateElement");
};
pp$5.parseTemplate = function(ref2) {
  if (ref2 === void 0) ref2 = {};
  var isTagged = ref2.isTagged;
  if (isTagged === void 0) isTagged = false;
  var node = this.startNode();
  this.next();
  node.expressions = [];
  var curElt = this.parseTemplateElement({ isTagged });
  node.quasis = [curElt];
  while (!curElt.tail) {
    if (this.type === types$1.eof) {
      this.raise(this.pos, "Unterminated template literal");
    }
    this.expect(types$1.dollarBraceL);
    node.expressions.push(this.parseExpression());
    this.expect(types$1.braceR);
    node.quasis.push(curElt = this.parseTemplateElement({ isTagged }));
  }
  this.next();
  return this.finishNode(node, "TemplateLiteral");
};
pp$5.isAsyncProp = function(prop) {
  return !prop.computed && prop.key.type === "Identifier" && prop.key.name === "async" && (this.type === types$1.name || this.type === types$1.num || this.type === types$1.string || this.type === types$1.bracketL || this.type.keyword || this.options.ecmaVersion >= 9 && this.type === types$1.star) && !lineBreak.test(this.input.slice(this.lastTokEnd, this.start));
};
pp$5.parseObj = function(isPattern, refDestructuringErrors) {
  var node = this.startNode(), first = true, propHash = {};
  node.properties = [];
  this.next();
  while (!this.eat(types$1.braceR)) {
    if (!first) {
      this.expect(types$1.comma);
      if (this.options.ecmaVersion >= 5 && this.afterTrailingComma(types$1.braceR)) {
        break;
      }
    } else {
      first = false;
    }
    var prop = this.parseProperty(isPattern, refDestructuringErrors);
    if (!isPattern) {
      this.checkPropClash(prop, propHash, refDestructuringErrors);
    }
    node.properties.push(prop);
  }
  return this.finishNode(node, isPattern ? "ObjectPattern" : "ObjectExpression");
};
pp$5.parseProperty = function(isPattern, refDestructuringErrors) {
  var prop = this.startNode(), isGenerator, isAsync, startPos, startLoc;
  if (this.options.ecmaVersion >= 9 && this.eat(types$1.ellipsis)) {
    if (isPattern) {
      prop.argument = this.parseIdent(false);
      if (this.type === types$1.comma) {
        this.raiseRecoverable(this.start, "Comma is not permitted after the rest element");
      }
      return this.finishNode(prop, "RestElement");
    }
    prop.argument = this.parseMaybeAssign(false, refDestructuringErrors);
    if (this.type === types$1.comma && refDestructuringErrors && refDestructuringErrors.trailingComma < 0) {
      refDestructuringErrors.trailingComma = this.start;
    }
    return this.finishNode(prop, "SpreadElement");
  }
  if (this.options.ecmaVersion >= 6) {
    prop.method = false;
    prop.shorthand = false;
    if (isPattern || refDestructuringErrors) {
      startPos = this.start;
      startLoc = this.startLoc;
    }
    if (!isPattern) {
      isGenerator = this.eat(types$1.star);
    }
  }
  var containsEsc = this.containsEsc;
  this.parsePropertyName(prop);
  if (!isPattern && !containsEsc && this.options.ecmaVersion >= 8 && !isGenerator && this.isAsyncProp(prop)) {
    isAsync = true;
    isGenerator = this.options.ecmaVersion >= 9 && this.eat(types$1.star);
    this.parsePropertyName(prop);
  } else {
    isAsync = false;
  }
  this.parsePropertyValue(prop, isPattern, isGenerator, isAsync, startPos, startLoc, refDestructuringErrors, containsEsc);
  return this.finishNode(prop, "Property");
};
pp$5.parseGetterSetter = function(prop) {
  var kind = prop.key.name;
  this.parsePropertyName(prop);
  prop.value = this.parseMethod(false);
  prop.kind = kind;
  var paramCount = prop.kind === "get" ? 0 : 1;
  if (prop.value.params.length !== paramCount) {
    var start = prop.value.start;
    if (prop.kind === "get") {
      this.raiseRecoverable(start, "getter should have no params");
    } else {
      this.raiseRecoverable(start, "setter should have exactly one param");
    }
  } else {
    if (prop.kind === "set" && prop.value.params[0].type === "RestElement") {
      this.raiseRecoverable(prop.value.params[0].start, "Setter cannot use rest params");
    }
  }
};
pp$5.parsePropertyValue = function(prop, isPattern, isGenerator, isAsync, startPos, startLoc, refDestructuringErrors, containsEsc) {
  if ((isGenerator || isAsync) && this.type === types$1.colon) {
    this.unexpected();
  }
  if (this.eat(types$1.colon)) {
    prop.value = isPattern ? this.parseMaybeDefault(this.start, this.startLoc) : this.parseMaybeAssign(false, refDestructuringErrors);
    prop.kind = "init";
  } else if (this.options.ecmaVersion >= 6 && this.type === types$1.parenL) {
    if (isPattern) {
      this.unexpected();
    }
    prop.method = true;
    prop.value = this.parseMethod(isGenerator, isAsync);
    prop.kind = "init";
  } else if (!isPattern && !containsEsc && this.options.ecmaVersion >= 5 && !prop.computed && prop.key.type === "Identifier" && (prop.key.name === "get" || prop.key.name === "set") && (this.type !== types$1.comma && this.type !== types$1.braceR && this.type !== types$1.eq)) {
    if (isGenerator || isAsync) {
      this.unexpected();
    }
    this.parseGetterSetter(prop);
  } else if (this.options.ecmaVersion >= 6 && !prop.computed && prop.key.type === "Identifier") {
    if (isGenerator || isAsync) {
      this.unexpected();
    }
    this.checkUnreserved(prop.key);
    if (prop.key.name === "await" && !this.awaitIdentPos) {
      this.awaitIdentPos = startPos;
    }
    if (isPattern) {
      prop.value = this.parseMaybeDefault(startPos, startLoc, this.copyNode(prop.key));
    } else if (this.type === types$1.eq && refDestructuringErrors) {
      if (refDestructuringErrors.shorthandAssign < 0) {
        refDestructuringErrors.shorthandAssign = this.start;
      }
      prop.value = this.parseMaybeDefault(startPos, startLoc, this.copyNode(prop.key));
    } else {
      prop.value = this.copyNode(prop.key);
    }
    prop.kind = "init";
    prop.shorthand = true;
  } else {
    this.unexpected();
  }
};
pp$5.parsePropertyName = function(prop) {
  if (this.options.ecmaVersion >= 6) {
    if (this.eat(types$1.bracketL)) {
      prop.computed = true;
      prop.key = this.parseMaybeAssign();
      this.expect(types$1.bracketR);
      return prop.key;
    } else {
      prop.computed = false;
    }
  }
  return prop.key = this.type === types$1.num || this.type === types$1.string ? this.parseExprAtom() : this.parseIdent(this.options.allowReserved !== "never");
};
pp$5.initFunction = function(node) {
  node.id = null;
  if (this.options.ecmaVersion >= 6) {
    node.generator = node.expression = false;
  }
  if (this.options.ecmaVersion >= 8) {
    node.async = false;
  }
};
pp$5.parseMethod = function(isGenerator, isAsync, allowDirectSuper) {
  var node = this.startNode(), oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;
  this.initFunction(node);
  if (this.options.ecmaVersion >= 6) {
    node.generator = isGenerator;
  }
  if (this.options.ecmaVersion >= 8) {
    node.async = !!isAsync;
  }
  this.yieldPos = 0;
  this.awaitPos = 0;
  this.awaitIdentPos = 0;
  this.enterScope(functionFlags(isAsync, node.generator) | SCOPE_SUPER | (allowDirectSuper ? SCOPE_DIRECT_SUPER : 0));
  this.expect(types$1.parenL);
  node.params = this.parseBindingList(types$1.parenR, false, this.options.ecmaVersion >= 8);
  this.checkYieldAwaitInDefaultParams();
  this.parseFunctionBody(node, false, true, false);
  this.yieldPos = oldYieldPos;
  this.awaitPos = oldAwaitPos;
  this.awaitIdentPos = oldAwaitIdentPos;
  return this.finishNode(node, "FunctionExpression");
};
pp$5.parseArrowExpression = function(node, params, isAsync, forInit) {
  var oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;
  this.enterScope(functionFlags(isAsync, false) | SCOPE_ARROW);
  this.initFunction(node);
  if (this.options.ecmaVersion >= 8) {
    node.async = !!isAsync;
  }
  this.yieldPos = 0;
  this.awaitPos = 0;
  this.awaitIdentPos = 0;
  node.params = this.toAssignableList(params, true);
  this.parseFunctionBody(node, true, false, forInit);
  this.yieldPos = oldYieldPos;
  this.awaitPos = oldAwaitPos;
  this.awaitIdentPos = oldAwaitIdentPos;
  return this.finishNode(node, "ArrowFunctionExpression");
};
pp$5.parseFunctionBody = function(node, isArrowFunction, isMethod, forInit) {
  var isExpression = isArrowFunction && this.type !== types$1.braceL;
  var oldStrict = this.strict, useStrict = false;
  if (isExpression) {
    node.body = this.parseMaybeAssign(forInit);
    node.expression = true;
    this.checkParams(node, false);
  } else {
    var nonSimple = this.options.ecmaVersion >= 7 && !this.isSimpleParamList(node.params);
    if (!oldStrict || nonSimple) {
      useStrict = this.strictDirective(this.end);
      if (useStrict && nonSimple) {
        this.raiseRecoverable(node.start, "Illegal 'use strict' directive in function with non-simple parameter list");
      }
    }
    var oldLabels = this.labels;
    this.labels = [];
    if (useStrict) {
      this.strict = true;
    }
    this.checkParams(node, !oldStrict && !useStrict && !isArrowFunction && !isMethod && this.isSimpleParamList(node.params));
    if (this.strict && node.id) {
      this.checkLValSimple(node.id, BIND_OUTSIDE);
    }
    node.body = this.parseBlock(false, void 0, useStrict && !oldStrict);
    node.expression = false;
    this.adaptDirectivePrologue(node.body.body);
    this.labels = oldLabels;
  }
  this.exitScope();
};
pp$5.isSimpleParamList = function(params) {
  for (var i2 = 0, list2 = params; i2 < list2.length; i2 += 1) {
    var param = list2[i2];
    if (param.type !== "Identifier") {
      return false;
    }
  }
  return true;
};
pp$5.checkParams = function(node, allowDuplicates) {
  var nameHash = /* @__PURE__ */ Object.create(null);
  for (var i2 = 0, list2 = node.params; i2 < list2.length; i2 += 1) {
    var param = list2[i2];
    this.checkLValInnerPattern(param, BIND_VAR, allowDuplicates ? null : nameHash);
  }
};
pp$5.parseExprList = function(close, allowTrailingComma, allowEmpty, refDestructuringErrors) {
  var elts = [], first = true;
  while (!this.eat(close)) {
    if (!first) {
      this.expect(types$1.comma);
      if (allowTrailingComma && this.afterTrailingComma(close)) {
        break;
      }
    } else {
      first = false;
    }
    var elt = void 0;
    if (allowEmpty && this.type === types$1.comma) {
      elt = null;
    } else if (this.type === types$1.ellipsis) {
      elt = this.parseSpread(refDestructuringErrors);
      if (refDestructuringErrors && this.type === types$1.comma && refDestructuringErrors.trailingComma < 0) {
        refDestructuringErrors.trailingComma = this.start;
      }
    } else {
      elt = this.parseMaybeAssign(false, refDestructuringErrors);
    }
    elts.push(elt);
  }
  return elts;
};
pp$5.checkUnreserved = function(ref2) {
  var start = ref2.start;
  var end = ref2.end;
  var name = ref2.name;
  if (this.inGenerator && name === "yield") {
    this.raiseRecoverable(start, "Cannot use 'yield' as identifier inside a generator");
  }
  if (this.inAsync && name === "await") {
    this.raiseRecoverable(start, "Cannot use 'await' as identifier inside an async function");
  }
  if (!(this.currentThisScope().flags & SCOPE_VAR) && name === "arguments") {
    this.raiseRecoverable(start, "Cannot use 'arguments' in class field initializer");
  }
  if (this.inClassStaticBlock && (name === "arguments" || name === "await")) {
    this.raise(start, "Cannot use " + name + " in class static initialization block");
  }
  if (this.keywords.test(name)) {
    this.raise(start, "Unexpected keyword '" + name + "'");
  }
  if (this.options.ecmaVersion < 6 && this.input.slice(start, end).indexOf("\\") !== -1) {
    return;
  }
  var re = this.strict ? this.reservedWordsStrict : this.reservedWords;
  if (re.test(name)) {
    if (!this.inAsync && name === "await") {
      this.raiseRecoverable(start, "Cannot use keyword 'await' outside an async function");
    }
    this.raiseRecoverable(start, "The keyword '" + name + "' is reserved");
  }
};
pp$5.parseIdent = function(liberal) {
  var node = this.parseIdentNode();
  this.next(!!liberal);
  this.finishNode(node, "Identifier");
  if (!liberal) {
    this.checkUnreserved(node);
    if (node.name === "await" && !this.awaitIdentPos) {
      this.awaitIdentPos = node.start;
    }
  }
  return node;
};
pp$5.parseIdentNode = function() {
  var node = this.startNode();
  if (this.type === types$1.name) {
    node.name = this.value;
  } else if (this.type.keyword) {
    node.name = this.type.keyword;
    if ((node.name === "class" || node.name === "function") && (this.lastTokEnd !== this.lastTokStart + 1 || this.input.charCodeAt(this.lastTokStart) !== 46)) {
      this.context.pop();
    }
    this.type = types$1.name;
  } else {
    this.unexpected();
  }
  return node;
};
pp$5.parsePrivateIdent = function() {
  var node = this.startNode();
  if (this.type === types$1.privateId) {
    node.name = this.value;
  } else {
    this.unexpected();
  }
  this.next();
  this.finishNode(node, "PrivateIdentifier");
  if (this.options.checkPrivateFields) {
    if (this.privateNameStack.length === 0) {
      this.raise(node.start, "Private field '#" + node.name + "' must be declared in an enclosing class");
    } else {
      this.privateNameStack[this.privateNameStack.length - 1].used.push(node);
    }
  }
  return node;
};
pp$5.parseYield = function(forInit) {
  if (!this.yieldPos) {
    this.yieldPos = this.start;
  }
  var node = this.startNode();
  this.next();
  if (this.type === types$1.semi || this.canInsertSemicolon() || this.type !== types$1.star && !this.type.startsExpr) {
    node.delegate = false;
    node.argument = null;
  } else {
    node.delegate = this.eat(types$1.star);
    node.argument = this.parseMaybeAssign(forInit);
  }
  return this.finishNode(node, "YieldExpression");
};
pp$5.parseAwait = function(forInit) {
  if (!this.awaitPos) {
    this.awaitPos = this.start;
  }
  var node = this.startNode();
  this.next();
  node.argument = this.parseMaybeUnary(null, true, false, forInit);
  return this.finishNode(node, "AwaitExpression");
};
var pp$4 = Parser.prototype;
pp$4.raise = function(pos, message) {
  var loc = getLineInfo(this.input, pos);
  message += " (" + loc.line + ":" + loc.column + ")";
  if (this.sourceFile) {
    message += " in " + this.sourceFile;
  }
  var err = new SyntaxError(message);
  err.pos = pos;
  err.loc = loc;
  err.raisedAt = this.pos;
  throw err;
};
pp$4.raiseRecoverable = pp$4.raise;
pp$4.curPosition = function() {
  if (this.options.locations) {
    return new Position(this.curLine, this.pos - this.lineStart);
  }
};
var pp$3 = Parser.prototype;
var Scope = function Scope2(flags) {
  this.flags = flags;
  this.var = [];
  this.lexical = [];
  this.functions = [];
};
pp$3.enterScope = function(flags) {
  this.scopeStack.push(new Scope(flags));
};
pp$3.exitScope = function() {
  this.scopeStack.pop();
};
pp$3.treatFunctionsAsVarInScope = function(scope) {
  return scope.flags & SCOPE_FUNCTION || !this.inModule && scope.flags & SCOPE_TOP;
};
pp$3.declareName = function(name, bindingType, pos) {
  var redeclared = false;
  if (bindingType === BIND_LEXICAL) {
    var scope = this.currentScope();
    redeclared = scope.lexical.indexOf(name) > -1 || scope.functions.indexOf(name) > -1 || scope.var.indexOf(name) > -1;
    scope.lexical.push(name);
    if (this.inModule && scope.flags & SCOPE_TOP) {
      delete this.undefinedExports[name];
    }
  } else if (bindingType === BIND_SIMPLE_CATCH) {
    var scope$1 = this.currentScope();
    scope$1.lexical.push(name);
  } else if (bindingType === BIND_FUNCTION) {
    var scope$2 = this.currentScope();
    if (this.treatFunctionsAsVar) {
      redeclared = scope$2.lexical.indexOf(name) > -1;
    } else {
      redeclared = scope$2.lexical.indexOf(name) > -1 || scope$2.var.indexOf(name) > -1;
    }
    scope$2.functions.push(name);
  } else {
    for (var i2 = this.scopeStack.length - 1; i2 >= 0; --i2) {
      var scope$3 = this.scopeStack[i2];
      if (scope$3.lexical.indexOf(name) > -1 && !(scope$3.flags & SCOPE_SIMPLE_CATCH && scope$3.lexical[0] === name) || !this.treatFunctionsAsVarInScope(scope$3) && scope$3.functions.indexOf(name) > -1) {
        redeclared = true;
        break;
      }
      scope$3.var.push(name);
      if (this.inModule && scope$3.flags & SCOPE_TOP) {
        delete this.undefinedExports[name];
      }
      if (scope$3.flags & SCOPE_VAR) {
        break;
      }
    }
  }
  if (redeclared) {
    this.raiseRecoverable(pos, "Identifier '" + name + "' has already been declared");
  }
};
pp$3.checkLocalExport = function(id) {
  if (this.scopeStack[0].lexical.indexOf(id.name) === -1 && this.scopeStack[0].var.indexOf(id.name) === -1) {
    this.undefinedExports[id.name] = id;
  }
};
pp$3.currentScope = function() {
  return this.scopeStack[this.scopeStack.length - 1];
};
pp$3.currentVarScope = function() {
  for (var i2 = this.scopeStack.length - 1; ; i2--) {
    var scope = this.scopeStack[i2];
    if (scope.flags & (SCOPE_VAR | SCOPE_CLASS_FIELD_INIT | SCOPE_CLASS_STATIC_BLOCK)) {
      return scope;
    }
  }
};
pp$3.currentThisScope = function() {
  for (var i2 = this.scopeStack.length - 1; ; i2--) {
    var scope = this.scopeStack[i2];
    if (scope.flags & (SCOPE_VAR | SCOPE_CLASS_FIELD_INIT | SCOPE_CLASS_STATIC_BLOCK) && !(scope.flags & SCOPE_ARROW)) {
      return scope;
    }
  }
};
var Node = function Node2(parser, pos, loc) {
  this.type = "";
  this.start = pos;
  this.end = 0;
  if (parser.options.locations) {
    this.loc = new SourceLocation(parser, loc);
  }
  if (parser.options.directSourceFile) {
    this.sourceFile = parser.options.directSourceFile;
  }
  if (parser.options.ranges) {
    this.range = [pos, 0];
  }
};
var pp$2 = Parser.prototype;
pp$2.startNode = function() {
  return new Node(this, this.start, this.startLoc);
};
pp$2.startNodeAt = function(pos, loc) {
  return new Node(this, pos, loc);
};
function finishNodeAt(node, type, pos, loc) {
  node.type = type;
  node.end = pos;
  if (this.options.locations) {
    node.loc.end = loc;
  }
  if (this.options.ranges) {
    node.range[1] = pos;
  }
  return node;
}
pp$2.finishNode = function(node, type) {
  return finishNodeAt.call(this, node, type, this.lastTokEnd, this.lastTokEndLoc);
};
pp$2.finishNodeAt = function(node, type, pos, loc) {
  return finishNodeAt.call(this, node, type, pos, loc);
};
pp$2.copyNode = function(node) {
  var newNode = new Node(this, node.start, this.startLoc);
  for (var prop in node) {
    newNode[prop] = node[prop];
  }
  return newNode;
};
var scriptValuesAddedInUnicode = "Berf Beria_Erfe Gara Garay Gukh Gurung_Khema Hrkt Katakana_Or_Hiragana Kawi Kirat_Rai Krai Nag_Mundari Nagm Ol_Onal Onao Sidetic Sidt Sunu Sunuwar Tai_Yo Tayo Todhri Todr Tolong_Siki Tols Tulu_Tigalari Tutg Unknown Zzzz";
var ecma9BinaryProperties = "ASCII ASCII_Hex_Digit AHex Alphabetic Alpha Any Assigned Bidi_Control Bidi_C Bidi_Mirrored Bidi_M Case_Ignorable CI Cased Changes_When_Casefolded CWCF Changes_When_Casemapped CWCM Changes_When_Lowercased CWL Changes_When_NFKC_Casefolded CWKCF Changes_When_Titlecased CWT Changes_When_Uppercased CWU Dash Default_Ignorable_Code_Point DI Deprecated Dep Diacritic Dia Emoji Emoji_Component Emoji_Modifier Emoji_Modifier_Base Emoji_Presentation Extender Ext Grapheme_Base Gr_Base Grapheme_Extend Gr_Ext Hex_Digit Hex IDS_Binary_Operator IDSB IDS_Trinary_Operator IDST ID_Continue IDC ID_Start IDS Ideographic Ideo Join_Control Join_C Logical_Order_Exception LOE Lowercase Lower Math Noncharacter_Code_Point NChar Pattern_Syntax Pat_Syn Pattern_White_Space Pat_WS Quotation_Mark QMark Radical Regional_Indicator RI Sentence_Terminal STerm Soft_Dotted SD Terminal_Punctuation Term Unified_Ideograph UIdeo Uppercase Upper Variation_Selector VS White_Space space XID_Continue XIDC XID_Start XIDS";
var ecma10BinaryProperties = ecma9BinaryProperties + " Extended_Pictographic";
var ecma11BinaryProperties = ecma10BinaryProperties;
var ecma12BinaryProperties = ecma11BinaryProperties + " EBase EComp EMod EPres ExtPict";
var ecma13BinaryProperties = ecma12BinaryProperties;
var ecma14BinaryProperties = ecma13BinaryProperties;
var unicodeBinaryProperties = {
  9: ecma9BinaryProperties,
  10: ecma10BinaryProperties,
  11: ecma11BinaryProperties,
  12: ecma12BinaryProperties,
  13: ecma13BinaryProperties,
  14: ecma14BinaryProperties
};
var ecma14BinaryPropertiesOfStrings = "Basic_Emoji Emoji_Keycap_Sequence RGI_Emoji_Modifier_Sequence RGI_Emoji_Flag_Sequence RGI_Emoji_Tag_Sequence RGI_Emoji_ZWJ_Sequence RGI_Emoji";
var unicodeBinaryPropertiesOfStrings = {
  9: "",
  10: "",
  11: "",
  12: "",
  13: "",
  14: ecma14BinaryPropertiesOfStrings
};
var unicodeGeneralCategoryValues = "Cased_Letter LC Close_Punctuation Pe Connector_Punctuation Pc Control Cc cntrl Currency_Symbol Sc Dash_Punctuation Pd Decimal_Number Nd digit Enclosing_Mark Me Final_Punctuation Pf Format Cf Initial_Punctuation Pi Letter L Letter_Number Nl Line_Separator Zl Lowercase_Letter Ll Mark M Combining_Mark Math_Symbol Sm Modifier_Letter Lm Modifier_Symbol Sk Nonspacing_Mark Mn Number N Open_Punctuation Ps Other C Other_Letter Lo Other_Number No Other_Punctuation Po Other_Symbol So Paragraph_Separator Zp Private_Use Co Punctuation P punct Separator Z Space_Separator Zs Spacing_Mark Mc Surrogate Cs Symbol S Titlecase_Letter Lt Unassigned Cn Uppercase_Letter Lu";
var ecma9ScriptValues = "Adlam Adlm Ahom Anatolian_Hieroglyphs Hluw Arabic Arab Armenian Armn Avestan Avst Balinese Bali Bamum Bamu Bassa_Vah Bass Batak Batk Bengali Beng Bhaiksuki Bhks Bopomofo Bopo Brahmi Brah Braille Brai Buginese Bugi Buhid Buhd Canadian_Aboriginal Cans Carian Cari Caucasian_Albanian Aghb Chakma Cakm Cham Cham Cherokee Cher Common Zyyy Coptic Copt Qaac Cuneiform Xsux Cypriot Cprt Cyrillic Cyrl Deseret Dsrt Devanagari Deva Duployan Dupl Egyptian_Hieroglyphs Egyp Elbasan Elba Ethiopic Ethi Georgian Geor Glagolitic Glag Gothic Goth Grantha Gran Greek Grek Gujarati Gujr Gurmukhi Guru Han Hani Hangul Hang Hanunoo Hano Hatran Hatr Hebrew Hebr Hiragana Hira Imperial_Aramaic Armi Inherited Zinh Qaai Inscriptional_Pahlavi Phli Inscriptional_Parthian Prti Javanese Java Kaithi Kthi Kannada Knda Katakana Kana Kayah_Li Kali Kharoshthi Khar Khmer Khmr Khojki Khoj Khudawadi Sind Lao Laoo Latin Latn Lepcha Lepc Limbu Limb Linear_A Lina Linear_B Linb Lisu Lisu Lycian Lyci Lydian Lydi Mahajani Mahj Malayalam Mlym Mandaic Mand Manichaean Mani Marchen Marc Masaram_Gondi Gonm Meetei_Mayek Mtei Mende_Kikakui Mend Meroitic_Cursive Merc Meroitic_Hieroglyphs Mero Miao Plrd Modi Mongolian Mong Mro Mroo Multani Mult Myanmar Mymr Nabataean Nbat New_Tai_Lue Talu Newa Newa Nko Nkoo Nushu Nshu Ogham Ogam Ol_Chiki Olck Old_Hungarian Hung Old_Italic Ital Old_North_Arabian Narb Old_Permic Perm Old_Persian Xpeo Old_South_Arabian Sarb Old_Turkic Orkh Oriya Orya Osage Osge Osmanya Osma Pahawh_Hmong Hmng Palmyrene Palm Pau_Cin_Hau Pauc Phags_Pa Phag Phoenician Phnx Psalter_Pahlavi Phlp Rejang Rjng Runic Runr Samaritan Samr Saurashtra Saur Sharada Shrd Shavian Shaw Siddham Sidd SignWriting Sgnw Sinhala Sinh Sora_Sompeng Sora Soyombo Soyo Sundanese Sund Syloti_Nagri Sylo Syriac Syrc Tagalog Tglg Tagbanwa Tagb Tai_Le Tale Tai_Tham Lana Tai_Viet Tavt Takri Takr Tamil Taml Tangut Tang Telugu Telu Thaana Thaa Thai Thai Tibetan Tibt Tifinagh Tfng Tirhuta Tirh Ugaritic Ugar Vai Vaii Warang_Citi Wara Yi Yiii Zanabazar_Square Zanb";
var ecma10ScriptValues = ecma9ScriptValues + " Dogra Dogr Gunjala_Gondi Gong Hanifi_Rohingya Rohg Makasar Maka Medefaidrin Medf Old_Sogdian Sogo Sogdian Sogd";
var ecma11ScriptValues = ecma10ScriptValues + " Elymaic Elym Nandinagari Nand Nyiakeng_Puachue_Hmong Hmnp Wancho Wcho";
var ecma12ScriptValues = ecma11ScriptValues + " Chorasmian Chrs Diak Dives_Akuru Khitan_Small_Script Kits Yezi Yezidi";
var ecma13ScriptValues = ecma12ScriptValues + " Cypro_Minoan Cpmn Old_Uyghur Ougr Tangsa Tnsa Toto Vithkuqi Vith";
var ecma14ScriptValues = ecma13ScriptValues + " " + scriptValuesAddedInUnicode;
var unicodeScriptValues = {
  9: ecma9ScriptValues,
  10: ecma10ScriptValues,
  11: ecma11ScriptValues,
  12: ecma12ScriptValues,
  13: ecma13ScriptValues,
  14: ecma14ScriptValues
};
var data = {};
function buildUnicodeData(ecmaVersion2) {
  var d = data[ecmaVersion2] = {
    binary: wordsRegexp(unicodeBinaryProperties[ecmaVersion2] + " " + unicodeGeneralCategoryValues),
    binaryOfStrings: wordsRegexp(unicodeBinaryPropertiesOfStrings[ecmaVersion2]),
    nonBinary: {
      General_Category: wordsRegexp(unicodeGeneralCategoryValues),
      Script: wordsRegexp(unicodeScriptValues[ecmaVersion2])
    }
  };
  d.nonBinary.Script_Extensions = d.nonBinary.Script;
  d.nonBinary.gc = d.nonBinary.General_Category;
  d.nonBinary.sc = d.nonBinary.Script;
  d.nonBinary.scx = d.nonBinary.Script_Extensions;
}
for (i = 0, list = [9, 10, 11, 12, 13, 14]; i < list.length; i += 1) {
  ecmaVersion = list[i];
  buildUnicodeData(ecmaVersion);
}
var ecmaVersion;
var i;
var list;
var pp$1 = Parser.prototype;
var BranchID = function BranchID2(parent, base) {
  this.parent = parent;
  this.base = base || this;
};
BranchID.prototype.separatedFrom = function separatedFrom(alt) {
  for (var self = this; self; self = self.parent) {
    for (var other = alt; other; other = other.parent) {
      if (self.base === other.base && self !== other) {
        return true;
      }
    }
  }
  return false;
};
BranchID.prototype.sibling = function sibling() {
  return new BranchID(this.parent, this.base);
};
var RegExpValidationState = function RegExpValidationState2(parser) {
  this.parser = parser;
  this.validFlags = "gim" + (parser.options.ecmaVersion >= 6 ? "uy" : "") + (parser.options.ecmaVersion >= 9 ? "s" : "") + (parser.options.ecmaVersion >= 13 ? "d" : "") + (parser.options.ecmaVersion >= 15 ? "v" : "");
  this.unicodeProperties = data[parser.options.ecmaVersion >= 14 ? 14 : parser.options.ecmaVersion];
  this.source = "";
  this.flags = "";
  this.start = 0;
  this.switchU = false;
  this.switchV = false;
  this.switchN = false;
  this.pos = 0;
  this.lastIntValue = 0;
  this.lastStringValue = "";
  this.lastAssertionIsQuantifiable = false;
  this.numCapturingParens = 0;
  this.maxBackReference = 0;
  this.groupNames = /* @__PURE__ */ Object.create(null);
  this.backReferenceNames = [];
  this.branchID = null;
};
RegExpValidationState.prototype.reset = function reset(start, pattern, flags) {
  var unicodeSets = flags.indexOf("v") !== -1;
  var unicode = flags.indexOf("u") !== -1;
  this.start = start | 0;
  this.source = pattern + "";
  this.flags = flags;
  if (unicodeSets && this.parser.options.ecmaVersion >= 15) {
    this.switchU = true;
    this.switchV = true;
    this.switchN = true;
  } else {
    this.switchU = unicode && this.parser.options.ecmaVersion >= 6;
    this.switchV = false;
    this.switchN = unicode && this.parser.options.ecmaVersion >= 9;
  }
};
RegExpValidationState.prototype.raise = function raise(message) {
  this.parser.raiseRecoverable(this.start, "Invalid regular expression: /" + this.source + "/: " + message);
};
RegExpValidationState.prototype.at = function at(i2, forceU) {
  if (forceU === void 0) forceU = false;
  var s = this.source;
  var l = s.length;
  if (i2 >= l) {
    return -1;
  }
  var c = s.charCodeAt(i2);
  if (!(forceU || this.switchU) || c <= 55295 || c >= 57344 || i2 + 1 >= l) {
    return c;
  }
  var next = s.charCodeAt(i2 + 1);
  return next >= 56320 && next <= 57343 ? (c << 10) + next - 56613888 : c;
};
RegExpValidationState.prototype.nextIndex = function nextIndex(i2, forceU) {
  if (forceU === void 0) forceU = false;
  var s = this.source;
  var l = s.length;
  if (i2 >= l) {
    return l;
  }
  var c = s.charCodeAt(i2), next;
  if (!(forceU || this.switchU) || c <= 55295 || c >= 57344 || i2 + 1 >= l || (next = s.charCodeAt(i2 + 1)) < 56320 || next > 57343) {
    return i2 + 1;
  }
  return i2 + 2;
};
RegExpValidationState.prototype.current = function current(forceU) {
  if (forceU === void 0) forceU = false;
  return this.at(this.pos, forceU);
};
RegExpValidationState.prototype.lookahead = function lookahead(forceU) {
  if (forceU === void 0) forceU = false;
  return this.at(this.nextIndex(this.pos, forceU), forceU);
};
RegExpValidationState.prototype.advance = function advance(forceU) {
  if (forceU === void 0) forceU = false;
  this.pos = this.nextIndex(this.pos, forceU);
};
RegExpValidationState.prototype.eat = function eat(ch, forceU) {
  if (forceU === void 0) forceU = false;
  if (this.current(forceU) === ch) {
    this.advance(forceU);
    return true;
  }
  return false;
};
RegExpValidationState.prototype.eatChars = function eatChars(chs, forceU) {
  if (forceU === void 0) forceU = false;
  var pos = this.pos;
  for (var i2 = 0, list2 = chs; i2 < list2.length; i2 += 1) {
    var ch = list2[i2];
    var current2 = this.at(pos, forceU);
    if (current2 === -1 || current2 !== ch) {
      return false;
    }
    pos = this.nextIndex(pos, forceU);
  }
  this.pos = pos;
  return true;
};
pp$1.validateRegExpFlags = function(state) {
  var validFlags = state.validFlags;
  var flags = state.flags;
  var u = false;
  var v = false;
  for (var i2 = 0; i2 < flags.length; i2++) {
    var flag = flags.charAt(i2);
    if (validFlags.indexOf(flag) === -1) {
      this.raise(state.start, "Invalid regular expression flag");
    }
    if (flags.indexOf(flag, i2 + 1) > -1) {
      this.raise(state.start, "Duplicate regular expression flag");
    }
    if (flag === "u") {
      u = true;
    }
    if (flag === "v") {
      v = true;
    }
  }
  if (this.options.ecmaVersion >= 15 && u && v) {
    this.raise(state.start, "Invalid regular expression flag");
  }
};
function hasProp(obj) {
  for (var _ in obj) {
    return true;
  }
  return false;
}
pp$1.validateRegExpPattern = function(state) {
  this.regexp_pattern(state);
  if (!state.switchN && this.options.ecmaVersion >= 9 && hasProp(state.groupNames)) {
    state.switchN = true;
    this.regexp_pattern(state);
  }
};
pp$1.regexp_pattern = function(state) {
  state.pos = 0;
  state.lastIntValue = 0;
  state.lastStringValue = "";
  state.lastAssertionIsQuantifiable = false;
  state.numCapturingParens = 0;
  state.maxBackReference = 0;
  state.groupNames = /* @__PURE__ */ Object.create(null);
  state.backReferenceNames.length = 0;
  state.branchID = null;
  this.regexp_disjunction(state);
  if (state.pos !== state.source.length) {
    if (state.eat(
      41
      /* ) */
    )) {
      state.raise("Unmatched ')'");
    }
    if (state.eat(
      93
      /* ] */
    ) || state.eat(
      125
      /* } */
    )) {
      state.raise("Lone quantifier brackets");
    }
  }
  if (state.maxBackReference > state.numCapturingParens) {
    state.raise("Invalid escape");
  }
  for (var i2 = 0, list2 = state.backReferenceNames; i2 < list2.length; i2 += 1) {
    var name = list2[i2];
    if (!state.groupNames[name]) {
      state.raise("Invalid named capture referenced");
    }
  }
};
pp$1.regexp_disjunction = function(state) {
  var trackDisjunction = this.options.ecmaVersion >= 16;
  if (trackDisjunction) {
    state.branchID = new BranchID(state.branchID, null);
  }
  this.regexp_alternative(state);
  while (state.eat(
    124
    /* | */
  )) {
    if (trackDisjunction) {
      state.branchID = state.branchID.sibling();
    }
    this.regexp_alternative(state);
  }
  if (trackDisjunction) {
    state.branchID = state.branchID.parent;
  }
  if (this.regexp_eatQuantifier(state, true)) {
    state.raise("Nothing to repeat");
  }
  if (state.eat(
    123
    /* { */
  )) {
    state.raise("Lone quantifier brackets");
  }
};
pp$1.regexp_alternative = function(state) {
  while (state.pos < state.source.length && this.regexp_eatTerm(state)) {
  }
};
pp$1.regexp_eatTerm = function(state) {
  if (this.regexp_eatAssertion(state)) {
    if (state.lastAssertionIsQuantifiable && this.regexp_eatQuantifier(state)) {
      if (state.switchU) {
        state.raise("Invalid quantifier");
      }
    }
    return true;
  }
  if (state.switchU ? this.regexp_eatAtom(state) : this.regexp_eatExtendedAtom(state)) {
    this.regexp_eatQuantifier(state);
    return true;
  }
  return false;
};
pp$1.regexp_eatAssertion = function(state) {
  var start = state.pos;
  state.lastAssertionIsQuantifiable = false;
  if (state.eat(
    94
    /* ^ */
  ) || state.eat(
    36
    /* $ */
  )) {
    return true;
  }
  if (state.eat(
    92
    /* \ */
  )) {
    if (state.eat(
      66
      /* B */
    ) || state.eat(
      98
      /* b */
    )) {
      return true;
    }
    state.pos = start;
  }
  if (state.eat(
    40
    /* ( */
  ) && state.eat(
    63
    /* ? */
  )) {
    var lookbehind = false;
    if (this.options.ecmaVersion >= 9) {
      lookbehind = state.eat(
        60
        /* < */
      );
    }
    if (state.eat(
      61
      /* = */
    ) || state.eat(
      33
      /* ! */
    )) {
      this.regexp_disjunction(state);
      if (!state.eat(
        41
        /* ) */
      )) {
        state.raise("Unterminated group");
      }
      state.lastAssertionIsQuantifiable = !lookbehind;
      return true;
    }
  }
  state.pos = start;
  return false;
};
pp$1.regexp_eatQuantifier = function(state, noError) {
  if (noError === void 0) noError = false;
  if (this.regexp_eatQuantifierPrefix(state, noError)) {
    state.eat(
      63
      /* ? */
    );
    return true;
  }
  return false;
};
pp$1.regexp_eatQuantifierPrefix = function(state, noError) {
  return state.eat(
    42
    /* * */
  ) || state.eat(
    43
    /* + */
  ) || state.eat(
    63
    /* ? */
  ) || this.regexp_eatBracedQuantifier(state, noError);
};
pp$1.regexp_eatBracedQuantifier = function(state, noError) {
  var start = state.pos;
  if (state.eat(
    123
    /* { */
  )) {
    var min = 0, max = -1;
    if (this.regexp_eatDecimalDigits(state)) {
      min = state.lastIntValue;
      if (state.eat(
        44
        /* , */
      ) && this.regexp_eatDecimalDigits(state)) {
        max = state.lastIntValue;
      }
      if (state.eat(
        125
        /* } */
      )) {
        if (max !== -1 && max < min && !noError) {
          state.raise("numbers out of order in {} quantifier");
        }
        return true;
      }
    }
    if (state.switchU && !noError) {
      state.raise("Incomplete quantifier");
    }
    state.pos = start;
  }
  return false;
};
pp$1.regexp_eatAtom = function(state) {
  return this.regexp_eatPatternCharacters(state) || state.eat(
    46
    /* . */
  ) || this.regexp_eatReverseSolidusAtomEscape(state) || this.regexp_eatCharacterClass(state) || this.regexp_eatUncapturingGroup(state) || this.regexp_eatCapturingGroup(state);
};
pp$1.regexp_eatReverseSolidusAtomEscape = function(state) {
  var start = state.pos;
  if (state.eat(
    92
    /* \ */
  )) {
    if (this.regexp_eatAtomEscape(state)) {
      return true;
    }
    state.pos = start;
  }
  return false;
};
pp$1.regexp_eatUncapturingGroup = function(state) {
  var start = state.pos;
  if (state.eat(
    40
    /* ( */
  )) {
    if (state.eat(
      63
      /* ? */
    )) {
      if (this.options.ecmaVersion >= 16) {
        var addModifiers = this.regexp_eatModifiers(state);
        var hasHyphen = state.eat(
          45
          /* - */
        );
        if (addModifiers || hasHyphen) {
          for (var i2 = 0; i2 < addModifiers.length; i2++) {
            var modifier = addModifiers.charAt(i2);
            if (addModifiers.indexOf(modifier, i2 + 1) > -1) {
              state.raise("Duplicate regular expression modifiers");
            }
          }
          if (hasHyphen) {
            var removeModifiers = this.regexp_eatModifiers(state);
            if (!addModifiers && !removeModifiers && state.current() === 58) {
              state.raise("Invalid regular expression modifiers");
            }
            for (var i$1 = 0; i$1 < removeModifiers.length; i$1++) {
              var modifier$1 = removeModifiers.charAt(i$1);
              if (removeModifiers.indexOf(modifier$1, i$1 + 1) > -1 || addModifiers.indexOf(modifier$1) > -1) {
                state.raise("Duplicate regular expression modifiers");
              }
            }
          }
        }
      }
      if (state.eat(
        58
        /* : */
      )) {
        this.regexp_disjunction(state);
        if (state.eat(
          41
          /* ) */
        )) {
          return true;
        }
        state.raise("Unterminated group");
      }
    }
    state.pos = start;
  }
  return false;
};
pp$1.regexp_eatCapturingGroup = function(state) {
  if (state.eat(
    40
    /* ( */
  )) {
    if (this.options.ecmaVersion >= 9) {
      this.regexp_groupSpecifier(state);
    } else if (state.current() === 63) {
      state.raise("Invalid group");
    }
    this.regexp_disjunction(state);
    if (state.eat(
      41
      /* ) */
    )) {
      state.numCapturingParens += 1;
      return true;
    }
    state.raise("Unterminated group");
  }
  return false;
};
pp$1.regexp_eatModifiers = function(state) {
  var modifiers = "";
  var ch = 0;
  while ((ch = state.current()) !== -1 && isRegularExpressionModifier(ch)) {
    modifiers += codePointToString(ch);
    state.advance();
  }
  return modifiers;
};
function isRegularExpressionModifier(ch) {
  return ch === 105 || ch === 109 || ch === 115;
}
pp$1.regexp_eatExtendedAtom = function(state) {
  return state.eat(
    46
    /* . */
  ) || this.regexp_eatReverseSolidusAtomEscape(state) || this.regexp_eatCharacterClass(state) || this.regexp_eatUncapturingGroup(state) || this.regexp_eatCapturingGroup(state) || this.regexp_eatInvalidBracedQuantifier(state) || this.regexp_eatExtendedPatternCharacter(state);
};
pp$1.regexp_eatInvalidBracedQuantifier = function(state) {
  if (this.regexp_eatBracedQuantifier(state, true)) {
    state.raise("Nothing to repeat");
  }
  return false;
};
pp$1.regexp_eatSyntaxCharacter = function(state) {
  var ch = state.current();
  if (isSyntaxCharacter(ch)) {
    state.lastIntValue = ch;
    state.advance();
    return true;
  }
  return false;
};
function isSyntaxCharacter(ch) {
  return ch === 36 || ch >= 40 && ch <= 43 || ch === 46 || ch === 63 || ch >= 91 && ch <= 94 || ch >= 123 && ch <= 125;
}
pp$1.regexp_eatPatternCharacters = function(state) {
  var start = state.pos;
  var ch = 0;
  while ((ch = state.current()) !== -1 && !isSyntaxCharacter(ch)) {
    state.advance();
  }
  return state.pos !== start;
};
pp$1.regexp_eatExtendedPatternCharacter = function(state) {
  var ch = state.current();
  if (ch !== -1 && ch !== 36 && !(ch >= 40 && ch <= 43) && ch !== 46 && ch !== 63 && ch !== 91 && ch !== 94 && ch !== 124) {
    state.advance();
    return true;
  }
  return false;
};
pp$1.regexp_groupSpecifier = function(state) {
  if (state.eat(
    63
    /* ? */
  )) {
    if (!this.regexp_eatGroupName(state)) {
      state.raise("Invalid group");
    }
    var trackDisjunction = this.options.ecmaVersion >= 16;
    var known = state.groupNames[state.lastStringValue];
    if (known) {
      if (trackDisjunction) {
        for (var i2 = 0, list2 = known; i2 < list2.length; i2 += 1) {
          var altID = list2[i2];
          if (!altID.separatedFrom(state.branchID)) {
            state.raise("Duplicate capture group name");
          }
        }
      } else {
        state.raise("Duplicate capture group name");
      }
    }
    if (trackDisjunction) {
      (known || (state.groupNames[state.lastStringValue] = [])).push(state.branchID);
    } else {
      state.groupNames[state.lastStringValue] = true;
    }
  }
};
pp$1.regexp_eatGroupName = function(state) {
  state.lastStringValue = "";
  if (state.eat(
    60
    /* < */
  )) {
    if (this.regexp_eatRegExpIdentifierName(state) && state.eat(
      62
      /* > */
    )) {
      return true;
    }
    state.raise("Invalid capture group name");
  }
  return false;
};
pp$1.regexp_eatRegExpIdentifierName = function(state) {
  state.lastStringValue = "";
  if (this.regexp_eatRegExpIdentifierStart(state)) {
    state.lastStringValue += codePointToString(state.lastIntValue);
    while (this.regexp_eatRegExpIdentifierPart(state)) {
      state.lastStringValue += codePointToString(state.lastIntValue);
    }
    return true;
  }
  return false;
};
pp$1.regexp_eatRegExpIdentifierStart = function(state) {
  var start = state.pos;
  var forceU = this.options.ecmaVersion >= 11;
  var ch = state.current(forceU);
  state.advance(forceU);
  if (ch === 92 && this.regexp_eatRegExpUnicodeEscapeSequence(state, forceU)) {
    ch = state.lastIntValue;
  }
  if (isRegExpIdentifierStart(ch)) {
    state.lastIntValue = ch;
    return true;
  }
  state.pos = start;
  return false;
};
function isRegExpIdentifierStart(ch) {
  return isIdentifierStart(ch, true) || ch === 36 || ch === 95;
}
pp$1.regexp_eatRegExpIdentifierPart = function(state) {
  var start = state.pos;
  var forceU = this.options.ecmaVersion >= 11;
  var ch = state.current(forceU);
  state.advance(forceU);
  if (ch === 92 && this.regexp_eatRegExpUnicodeEscapeSequence(state, forceU)) {
    ch = state.lastIntValue;
  }
  if (isRegExpIdentifierPart(ch)) {
    state.lastIntValue = ch;
    return true;
  }
  state.pos = start;
  return false;
};
function isRegExpIdentifierPart(ch) {
  return isIdentifierChar(ch, true) || ch === 36 || ch === 95 || ch === 8204 || ch === 8205;
}
pp$1.regexp_eatAtomEscape = function(state) {
  if (this.regexp_eatBackReference(state) || this.regexp_eatCharacterClassEscape(state) || this.regexp_eatCharacterEscape(state) || state.switchN && this.regexp_eatKGroupName(state)) {
    return true;
  }
  if (state.switchU) {
    if (state.current() === 99) {
      state.raise("Invalid unicode escape");
    }
    state.raise("Invalid escape");
  }
  return false;
};
pp$1.regexp_eatBackReference = function(state) {
  var start = state.pos;
  if (this.regexp_eatDecimalEscape(state)) {
    var n = state.lastIntValue;
    if (state.switchU) {
      if (n > state.maxBackReference) {
        state.maxBackReference = n;
      }
      return true;
    }
    if (n <= state.numCapturingParens) {
      return true;
    }
    state.pos = start;
  }
  return false;
};
pp$1.regexp_eatKGroupName = function(state) {
  if (state.eat(
    107
    /* k */
  )) {
    if (this.regexp_eatGroupName(state)) {
      state.backReferenceNames.push(state.lastStringValue);
      return true;
    }
    state.raise("Invalid named reference");
  }
  return false;
};
pp$1.regexp_eatCharacterEscape = function(state) {
  return this.regexp_eatControlEscape(state) || this.regexp_eatCControlLetter(state) || this.regexp_eatZero(state) || this.regexp_eatHexEscapeSequence(state) || this.regexp_eatRegExpUnicodeEscapeSequence(state, false) || !state.switchU && this.regexp_eatLegacyOctalEscapeSequence(state) || this.regexp_eatIdentityEscape(state);
};
pp$1.regexp_eatCControlLetter = function(state) {
  var start = state.pos;
  if (state.eat(
    99
    /* c */
  )) {
    if (this.regexp_eatControlLetter(state)) {
      return true;
    }
    state.pos = start;
  }
  return false;
};
pp$1.regexp_eatZero = function(state) {
  if (state.current() === 48 && !isDecimalDigit(state.lookahead())) {
    state.lastIntValue = 0;
    state.advance();
    return true;
  }
  return false;
};
pp$1.regexp_eatControlEscape = function(state) {
  var ch = state.current();
  if (ch === 116) {
    state.lastIntValue = 9;
    state.advance();
    return true;
  }
  if (ch === 110) {
    state.lastIntValue = 10;
    state.advance();
    return true;
  }
  if (ch === 118) {
    state.lastIntValue = 11;
    state.advance();
    return true;
  }
  if (ch === 102) {
    state.lastIntValue = 12;
    state.advance();
    return true;
  }
  if (ch === 114) {
    state.lastIntValue = 13;
    state.advance();
    return true;
  }
  return false;
};
pp$1.regexp_eatControlLetter = function(state) {
  var ch = state.current();
  if (isControlLetter(ch)) {
    state.lastIntValue = ch % 32;
    state.advance();
    return true;
  }
  return false;
};
function isControlLetter(ch) {
  return ch >= 65 && ch <= 90 || ch >= 97 && ch <= 122;
}
pp$1.regexp_eatRegExpUnicodeEscapeSequence = function(state, forceU) {
  if (forceU === void 0) forceU = false;
  var start = state.pos;
  var switchU = forceU || state.switchU;
  if (state.eat(
    117
    /* u */
  )) {
    if (this.regexp_eatFixedHexDigits(state, 4)) {
      var lead = state.lastIntValue;
      if (switchU && lead >= 55296 && lead <= 56319) {
        var leadSurrogateEnd = state.pos;
        if (state.eat(
          92
          /* \ */
        ) && state.eat(
          117
          /* u */
        ) && this.regexp_eatFixedHexDigits(state, 4)) {
          var trail = state.lastIntValue;
          if (trail >= 56320 && trail <= 57343) {
            state.lastIntValue = (lead - 55296) * 1024 + (trail - 56320) + 65536;
            return true;
          }
        }
        state.pos = leadSurrogateEnd;
        state.lastIntValue = lead;
      }
      return true;
    }
    if (switchU && state.eat(
      123
      /* { */
    ) && this.regexp_eatHexDigits(state) && state.eat(
      125
      /* } */
    ) && isValidUnicode(state.lastIntValue)) {
      return true;
    }
    if (switchU) {
      state.raise("Invalid unicode escape");
    }
    state.pos = start;
  }
  return false;
};
function isValidUnicode(ch) {
  return ch >= 0 && ch <= 1114111;
}
pp$1.regexp_eatIdentityEscape = function(state) {
  if (state.switchU) {
    if (this.regexp_eatSyntaxCharacter(state)) {
      return true;
    }
    if (state.eat(
      47
      /* / */
    )) {
      state.lastIntValue = 47;
      return true;
    }
    return false;
  }
  var ch = state.current();
  if (ch !== 99 && (!state.switchN || ch !== 107)) {
    state.lastIntValue = ch;
    state.advance();
    return true;
  }
  return false;
};
pp$1.regexp_eatDecimalEscape = function(state) {
  state.lastIntValue = 0;
  var ch = state.current();
  if (ch >= 49 && ch <= 57) {
    do {
      state.lastIntValue = 10 * state.lastIntValue + (ch - 48);
      state.advance();
    } while ((ch = state.current()) >= 48 && ch <= 57);
    return true;
  }
  return false;
};
var CharSetNone = 0;
var CharSetOk = 1;
var CharSetString = 2;
pp$1.regexp_eatCharacterClassEscape = function(state) {
  var ch = state.current();
  if (isCharacterClassEscape(ch)) {
    state.lastIntValue = -1;
    state.advance();
    return CharSetOk;
  }
  var negate = false;
  if (state.switchU && this.options.ecmaVersion >= 9 && ((negate = ch === 80) || ch === 112)) {
    state.lastIntValue = -1;
    state.advance();
    var result;
    if (state.eat(
      123
      /* { */
    ) && (result = this.regexp_eatUnicodePropertyValueExpression(state)) && state.eat(
      125
      /* } */
    )) {
      if (negate && result === CharSetString) {
        state.raise("Invalid property name");
      }
      return result;
    }
    state.raise("Invalid property name");
  }
  return CharSetNone;
};
function isCharacterClassEscape(ch) {
  return ch === 100 || ch === 68 || ch === 115 || ch === 83 || ch === 119 || ch === 87;
}
pp$1.regexp_eatUnicodePropertyValueExpression = function(state) {
  var start = state.pos;
  if (this.regexp_eatUnicodePropertyName(state) && state.eat(
    61
    /* = */
  )) {
    var name = state.lastStringValue;
    if (this.regexp_eatUnicodePropertyValue(state)) {
      var value = state.lastStringValue;
      this.regexp_validateUnicodePropertyNameAndValue(state, name, value);
      return CharSetOk;
    }
  }
  state.pos = start;
  if (this.regexp_eatLoneUnicodePropertyNameOrValue(state)) {
    var nameOrValue = state.lastStringValue;
    return this.regexp_validateUnicodePropertyNameOrValue(state, nameOrValue);
  }
  return CharSetNone;
};
pp$1.regexp_validateUnicodePropertyNameAndValue = function(state, name, value) {
  if (!hasOwn(state.unicodeProperties.nonBinary, name)) {
    state.raise("Invalid property name");
  }
  if (!state.unicodeProperties.nonBinary[name].test(value)) {
    state.raise("Invalid property value");
  }
};
pp$1.regexp_validateUnicodePropertyNameOrValue = function(state, nameOrValue) {
  if (state.unicodeProperties.binary.test(nameOrValue)) {
    return CharSetOk;
  }
  if (state.switchV && state.unicodeProperties.binaryOfStrings.test(nameOrValue)) {
    return CharSetString;
  }
  state.raise("Invalid property name");
};
pp$1.regexp_eatUnicodePropertyName = function(state) {
  var ch = 0;
  state.lastStringValue = "";
  while (isUnicodePropertyNameCharacter(ch = state.current())) {
    state.lastStringValue += codePointToString(ch);
    state.advance();
  }
  return state.lastStringValue !== "";
};
function isUnicodePropertyNameCharacter(ch) {
  return isControlLetter(ch) || ch === 95;
}
pp$1.regexp_eatUnicodePropertyValue = function(state) {
  var ch = 0;
  state.lastStringValue = "";
  while (isUnicodePropertyValueCharacter(ch = state.current())) {
    state.lastStringValue += codePointToString(ch);
    state.advance();
  }
  return state.lastStringValue !== "";
};
function isUnicodePropertyValueCharacter(ch) {
  return isUnicodePropertyNameCharacter(ch) || isDecimalDigit(ch);
}
pp$1.regexp_eatLoneUnicodePropertyNameOrValue = function(state) {
  return this.regexp_eatUnicodePropertyValue(state);
};
pp$1.regexp_eatCharacterClass = function(state) {
  if (state.eat(
    91
    /* [ */
  )) {
    var negate = state.eat(
      94
      /* ^ */
    );
    var result = this.regexp_classContents(state);
    if (!state.eat(
      93
      /* ] */
    )) {
      state.raise("Unterminated character class");
    }
    if (negate && result === CharSetString) {
      state.raise("Negated character class may contain strings");
    }
    return true;
  }
  return false;
};
pp$1.regexp_classContents = function(state) {
  if (state.current() === 93) {
    return CharSetOk;
  }
  if (state.switchV) {
    return this.regexp_classSetExpression(state);
  }
  this.regexp_nonEmptyClassRanges(state);
  return CharSetOk;
};
pp$1.regexp_nonEmptyClassRanges = function(state) {
  while (this.regexp_eatClassAtom(state)) {
    var left = state.lastIntValue;
    if (state.eat(
      45
      /* - */
    ) && this.regexp_eatClassAtom(state)) {
      var right = state.lastIntValue;
      if (state.switchU && (left === -1 || right === -1)) {
        state.raise("Invalid character class");
      }
      if (left !== -1 && right !== -1 && left > right) {
        state.raise("Range out of order in character class");
      }
    }
  }
};
pp$1.regexp_eatClassAtom = function(state) {
  var start = state.pos;
  if (state.eat(
    92
    /* \ */
  )) {
    if (this.regexp_eatClassEscape(state)) {
      return true;
    }
    if (state.switchU) {
      var ch$1 = state.current();
      if (ch$1 === 99 || isOctalDigit(ch$1)) {
        state.raise("Invalid class escape");
      }
      state.raise("Invalid escape");
    }
    state.pos = start;
  }
  var ch = state.current();
  if (ch !== 93) {
    state.lastIntValue = ch;
    state.advance();
    return true;
  }
  return false;
};
pp$1.regexp_eatClassEscape = function(state) {
  var start = state.pos;
  if (state.eat(
    98
    /* b */
  )) {
    state.lastIntValue = 8;
    return true;
  }
  if (state.switchU && state.eat(
    45
    /* - */
  )) {
    state.lastIntValue = 45;
    return true;
  }
  if (!state.switchU && state.eat(
    99
    /* c */
  )) {
    if (this.regexp_eatClassControlLetter(state)) {
      return true;
    }
    state.pos = start;
  }
  return this.regexp_eatCharacterClassEscape(state) || this.regexp_eatCharacterEscape(state);
};
pp$1.regexp_classSetExpression = function(state) {
  var result = CharSetOk, subResult;
  if (this.regexp_eatClassSetRange(state)) ;
  else if (subResult = this.regexp_eatClassSetOperand(state)) {
    if (subResult === CharSetString) {
      result = CharSetString;
    }
    var start = state.pos;
    while (state.eatChars(
      [38, 38]
      /* && */
    )) {
      if (state.current() !== 38 && (subResult = this.regexp_eatClassSetOperand(state))) {
        if (subResult !== CharSetString) {
          result = CharSetOk;
        }
        continue;
      }
      state.raise("Invalid character in character class");
    }
    if (start !== state.pos) {
      return result;
    }
    while (state.eatChars(
      [45, 45]
      /* -- */
    )) {
      if (this.regexp_eatClassSetOperand(state)) {
        continue;
      }
      state.raise("Invalid character in character class");
    }
    if (start !== state.pos) {
      return result;
    }
  } else {
    state.raise("Invalid character in character class");
  }
  for (; ; ) {
    if (this.regexp_eatClassSetRange(state)) {
      continue;
    }
    subResult = this.regexp_eatClassSetOperand(state);
    if (!subResult) {
      return result;
    }
    if (subResult === CharSetString) {
      result = CharSetString;
    }
  }
};
pp$1.regexp_eatClassSetRange = function(state) {
  var start = state.pos;
  if (this.regexp_eatClassSetCharacter(state)) {
    var left = state.lastIntValue;
    if (state.eat(
      45
      /* - */
    ) && this.regexp_eatClassSetCharacter(state)) {
      var right = state.lastIntValue;
      if (left !== -1 && right !== -1 && left > right) {
        state.raise("Range out of order in character class");
      }
      return true;
    }
    state.pos = start;
  }
  return false;
};
pp$1.regexp_eatClassSetOperand = function(state) {
  if (this.regexp_eatClassSetCharacter(state)) {
    return CharSetOk;
  }
  return this.regexp_eatClassStringDisjunction(state) || this.regexp_eatNestedClass(state);
};
pp$1.regexp_eatNestedClass = function(state) {
  var start = state.pos;
  if (state.eat(
    91
    /* [ */
  )) {
    var negate = state.eat(
      94
      /* ^ */
    );
    var result = this.regexp_classContents(state);
    if (state.eat(
      93
      /* ] */
    )) {
      if (negate && result === CharSetString) {
        state.raise("Negated character class may contain strings");
      }
      return result;
    }
    state.pos = start;
  }
  if (state.eat(
    92
    /* \ */
  )) {
    var result$1 = this.regexp_eatCharacterClassEscape(state);
    if (result$1) {
      return result$1;
    }
    state.pos = start;
  }
  return null;
};
pp$1.regexp_eatClassStringDisjunction = function(state) {
  var start = state.pos;
  if (state.eatChars(
    [92, 113]
    /* \q */
  )) {
    if (state.eat(
      123
      /* { */
    )) {
      var result = this.regexp_classStringDisjunctionContents(state);
      if (state.eat(
        125
        /* } */
      )) {
        return result;
      }
    } else {
      state.raise("Invalid escape");
    }
    state.pos = start;
  }
  return null;
};
pp$1.regexp_classStringDisjunctionContents = function(state) {
  var result = this.regexp_classString(state);
  while (state.eat(
    124
    /* | */
  )) {
    if (this.regexp_classString(state) === CharSetString) {
      result = CharSetString;
    }
  }
  return result;
};
pp$1.regexp_classString = function(state) {
  var count = 0;
  while (this.regexp_eatClassSetCharacter(state)) {
    count++;
  }
  return count === 1 ? CharSetOk : CharSetString;
};
pp$1.regexp_eatClassSetCharacter = function(state) {
  var start = state.pos;
  if (state.eat(
    92
    /* \ */
  )) {
    if (this.regexp_eatCharacterEscape(state) || this.regexp_eatClassSetReservedPunctuator(state)) {
      return true;
    }
    if (state.eat(
      98
      /* b */
    )) {
      state.lastIntValue = 8;
      return true;
    }
    state.pos = start;
    return false;
  }
  var ch = state.current();
  if (ch < 0 || ch === state.lookahead() && isClassSetReservedDoublePunctuatorCharacter(ch)) {
    return false;
  }
  if (isClassSetSyntaxCharacter(ch)) {
    return false;
  }
  state.advance();
  state.lastIntValue = ch;
  return true;
};
function isClassSetReservedDoublePunctuatorCharacter(ch) {
  return ch === 33 || ch >= 35 && ch <= 38 || ch >= 42 && ch <= 44 || ch === 46 || ch >= 58 && ch <= 64 || ch === 94 || ch === 96 || ch === 126;
}
function isClassSetSyntaxCharacter(ch) {
  return ch === 40 || ch === 41 || ch === 45 || ch === 47 || ch >= 91 && ch <= 93 || ch >= 123 && ch <= 125;
}
pp$1.regexp_eatClassSetReservedPunctuator = function(state) {
  var ch = state.current();
  if (isClassSetReservedPunctuator(ch)) {
    state.lastIntValue = ch;
    state.advance();
    return true;
  }
  return false;
};
function isClassSetReservedPunctuator(ch) {
  return ch === 33 || ch === 35 || ch === 37 || ch === 38 || ch === 44 || ch === 45 || ch >= 58 && ch <= 62 || ch === 64 || ch === 96 || ch === 126;
}
pp$1.regexp_eatClassControlLetter = function(state) {
  var ch = state.current();
  if (isDecimalDigit(ch) || ch === 95) {
    state.lastIntValue = ch % 32;
    state.advance();
    return true;
  }
  return false;
};
pp$1.regexp_eatHexEscapeSequence = function(state) {
  var start = state.pos;
  if (state.eat(
    120
    /* x */
  )) {
    if (this.regexp_eatFixedHexDigits(state, 2)) {
      return true;
    }
    if (state.switchU) {
      state.raise("Invalid escape");
    }
    state.pos = start;
  }
  return false;
};
pp$1.regexp_eatDecimalDigits = function(state) {
  var start = state.pos;
  var ch = 0;
  state.lastIntValue = 0;
  while (isDecimalDigit(ch = state.current())) {
    state.lastIntValue = 10 * state.lastIntValue + (ch - 48);
    state.advance();
  }
  return state.pos !== start;
};
function isDecimalDigit(ch) {
  return ch >= 48 && ch <= 57;
}
pp$1.regexp_eatHexDigits = function(state) {
  var start = state.pos;
  var ch = 0;
  state.lastIntValue = 0;
  while (isHexDigit(ch = state.current())) {
    state.lastIntValue = 16 * state.lastIntValue + hexToInt(ch);
    state.advance();
  }
  return state.pos !== start;
};
function isHexDigit(ch) {
  return ch >= 48 && ch <= 57 || ch >= 65 && ch <= 70 || ch >= 97 && ch <= 102;
}
function hexToInt(ch) {
  if (ch >= 65 && ch <= 70) {
    return 10 + (ch - 65);
  }
  if (ch >= 97 && ch <= 102) {
    return 10 + (ch - 97);
  }
  return ch - 48;
}
pp$1.regexp_eatLegacyOctalEscapeSequence = function(state) {
  if (this.regexp_eatOctalDigit(state)) {
    var n1 = state.lastIntValue;
    if (this.regexp_eatOctalDigit(state)) {
      var n2 = state.lastIntValue;
      if (n1 <= 3 && this.regexp_eatOctalDigit(state)) {
        state.lastIntValue = n1 * 64 + n2 * 8 + state.lastIntValue;
      } else {
        state.lastIntValue = n1 * 8 + n2;
      }
    } else {
      state.lastIntValue = n1;
    }
    return true;
  }
  return false;
};
pp$1.regexp_eatOctalDigit = function(state) {
  var ch = state.current();
  if (isOctalDigit(ch)) {
    state.lastIntValue = ch - 48;
    state.advance();
    return true;
  }
  state.lastIntValue = 0;
  return false;
};
function isOctalDigit(ch) {
  return ch >= 48 && ch <= 55;
}
pp$1.regexp_eatFixedHexDigits = function(state, length) {
  var start = state.pos;
  state.lastIntValue = 0;
  for (var i2 = 0; i2 < length; ++i2) {
    var ch = state.current();
    if (!isHexDigit(ch)) {
      state.pos = start;
      return false;
    }
    state.lastIntValue = 16 * state.lastIntValue + hexToInt(ch);
    state.advance();
  }
  return true;
};
var Token = function Token2(p) {
  this.type = p.type;
  this.value = p.value;
  this.start = p.start;
  this.end = p.end;
  if (p.options.locations) {
    this.loc = new SourceLocation(p, p.startLoc, p.endLoc);
  }
  if (p.options.ranges) {
    this.range = [p.start, p.end];
  }
};
var pp = Parser.prototype;
pp.next = function(ignoreEscapeSequenceInKeyword) {
  if (!ignoreEscapeSequenceInKeyword && this.type.keyword && this.containsEsc) {
    this.raiseRecoverable(this.start, "Escape sequence in keyword " + this.type.keyword);
  }
  if (this.options.onToken) {
    this.options.onToken(new Token(this));
  }
  this.lastTokEnd = this.end;
  this.lastTokStart = this.start;
  this.lastTokEndLoc = this.endLoc;
  this.lastTokStartLoc = this.startLoc;
  this.nextToken();
};
pp.getToken = function() {
  this.next();
  return new Token(this);
};
if (typeof Symbol !== "undefined") {
  pp[Symbol.iterator] = function() {
    var this$1$1 = this;
    return {
      next: function() {
        var token = this$1$1.getToken();
        return {
          done: token.type === types$1.eof,
          value: token
        };
      }
    };
  };
}
pp.nextToken = function() {
  var curContext = this.curContext();
  if (!curContext || !curContext.preserveSpace) {
    this.skipSpace();
  }
  this.start = this.pos;
  if (this.options.locations) {
    this.startLoc = this.curPosition();
  }
  if (this.pos >= this.input.length) {
    return this.finishToken(types$1.eof);
  }
  if (curContext.override) {
    return curContext.override(this);
  } else {
    this.readToken(this.fullCharCodeAtPos());
  }
};
pp.readToken = function(code) {
  if (isIdentifierStart(code, this.options.ecmaVersion >= 6) || code === 92) {
    return this.readWord();
  }
  return this.getTokenFromCode(code);
};
pp.fullCharCodeAt = function(pos) {
  var code = this.input.charCodeAt(pos);
  if (code <= 55295 || code >= 56320) {
    return code;
  }
  var next = this.input.charCodeAt(pos + 1);
  return next <= 56319 || next >= 57344 ? code : (code << 10) + next - 56613888;
};
pp.fullCharCodeAtPos = function() {
  return this.fullCharCodeAt(this.pos);
};
pp.skipBlockComment = function() {
  var startLoc = this.options.onComment && this.curPosition();
  var start = this.pos, end = this.input.indexOf("*/", this.pos += 2);
  if (end === -1) {
    this.raise(this.pos - 2, "Unterminated comment");
  }
  this.pos = end + 2;
  if (this.options.locations) {
    for (var nextBreak = void 0, pos = start; (nextBreak = nextLineBreak(this.input, pos, this.pos)) > -1; ) {
      ++this.curLine;
      pos = this.lineStart = nextBreak;
    }
  }
  if (this.options.onComment) {
    this.options.onComment(
      true,
      this.input.slice(start + 2, end),
      start,
      this.pos,
      startLoc,
      this.curPosition()
    );
  }
};
pp.skipLineComment = function(startSkip) {
  var start = this.pos;
  var startLoc = this.options.onComment && this.curPosition();
  var ch = this.input.charCodeAt(this.pos += startSkip);
  while (this.pos < this.input.length && !isNewLine(ch)) {
    ch = this.input.charCodeAt(++this.pos);
  }
  if (this.options.onComment) {
    this.options.onComment(
      false,
      this.input.slice(start + startSkip, this.pos),
      start,
      this.pos,
      startLoc,
      this.curPosition()
    );
  }
};
pp.skipSpace = function() {
  loop: while (this.pos < this.input.length) {
    var ch = this.input.charCodeAt(this.pos);
    switch (ch) {
      case 32:
      case 160:
        ++this.pos;
        break;
      case 13:
        if (this.input.charCodeAt(this.pos + 1) === 10) {
          ++this.pos;
        }
      case 10:
      case 8232:
      case 8233:
        ++this.pos;
        if (this.options.locations) {
          ++this.curLine;
          this.lineStart = this.pos;
        }
        break;
      case 47:
        switch (this.input.charCodeAt(this.pos + 1)) {
          case 42:
            this.skipBlockComment();
            break;
          case 47:
            this.skipLineComment(2);
            break;
          default:
            break loop;
        }
        break;
      default:
        if (ch > 8 && ch < 14 || ch >= 5760 && nonASCIIwhitespace.test(String.fromCharCode(ch))) {
          ++this.pos;
        } else {
          break loop;
        }
    }
  }
};
pp.finishToken = function(type, val) {
  this.end = this.pos;
  if (this.options.locations) {
    this.endLoc = this.curPosition();
  }
  var prevType = this.type;
  this.type = type;
  this.value = val;
  this.updateContext(prevType);
};
pp.readToken_dot = function() {
  var next = this.input.charCodeAt(this.pos + 1);
  if (next >= 48 && next <= 57) {
    return this.readNumber(true);
  }
  var next2 = this.input.charCodeAt(this.pos + 2);
  if (this.options.ecmaVersion >= 6 && next === 46 && next2 === 46) {
    this.pos += 3;
    return this.finishToken(types$1.ellipsis);
  } else {
    ++this.pos;
    return this.finishToken(types$1.dot);
  }
};
pp.readToken_slash = function() {
  var next = this.input.charCodeAt(this.pos + 1);
  if (this.exprAllowed) {
    ++this.pos;
    return this.readRegexp();
  }
  if (next === 61) {
    return this.finishOp(types$1.assign, 2);
  }
  return this.finishOp(types$1.slash, 1);
};
pp.readToken_mult_modulo_exp = function(code) {
  var next = this.input.charCodeAt(this.pos + 1);
  var size = 1;
  var tokentype = code === 42 ? types$1.star : types$1.modulo;
  if (this.options.ecmaVersion >= 7 && code === 42 && next === 42) {
    ++size;
    tokentype = types$1.starstar;
    next = this.input.charCodeAt(this.pos + 2);
  }
  if (next === 61) {
    return this.finishOp(types$1.assign, size + 1);
  }
  return this.finishOp(tokentype, size);
};
pp.readToken_pipe_amp = function(code) {
  var next = this.input.charCodeAt(this.pos + 1);
  if (next === code) {
    if (this.options.ecmaVersion >= 12) {
      var next2 = this.input.charCodeAt(this.pos + 2);
      if (next2 === 61) {
        return this.finishOp(types$1.assign, 3);
      }
    }
    return this.finishOp(code === 124 ? types$1.logicalOR : types$1.logicalAND, 2);
  }
  if (next === 61) {
    return this.finishOp(types$1.assign, 2);
  }
  return this.finishOp(code === 124 ? types$1.bitwiseOR : types$1.bitwiseAND, 1);
};
pp.readToken_caret = function() {
  var next = this.input.charCodeAt(this.pos + 1);
  if (next === 61) {
    return this.finishOp(types$1.assign, 2);
  }
  return this.finishOp(types$1.bitwiseXOR, 1);
};
pp.readToken_plus_min = function(code) {
  var next = this.input.charCodeAt(this.pos + 1);
  if (next === code) {
    if (next === 45 && !this.inModule && this.input.charCodeAt(this.pos + 2) === 62 && (this.lastTokEnd === 0 || lineBreak.test(this.input.slice(this.lastTokEnd, this.pos)))) {
      this.skipLineComment(3);
      this.skipSpace();
      return this.nextToken();
    }
    return this.finishOp(types$1.incDec, 2);
  }
  if (next === 61) {
    return this.finishOp(types$1.assign, 2);
  }
  return this.finishOp(types$1.plusMin, 1);
};
pp.readToken_lt_gt = function(code) {
  var next = this.input.charCodeAt(this.pos + 1);
  var size = 1;
  if (next === code) {
    size = code === 62 && this.input.charCodeAt(this.pos + 2) === 62 ? 3 : 2;
    if (this.input.charCodeAt(this.pos + size) === 61) {
      return this.finishOp(types$1.assign, size + 1);
    }
    return this.finishOp(types$1.bitShift, size);
  }
  if (next === 33 && code === 60 && !this.inModule && this.input.charCodeAt(this.pos + 2) === 45 && this.input.charCodeAt(this.pos + 3) === 45) {
    this.skipLineComment(4);
    this.skipSpace();
    return this.nextToken();
  }
  if (next === 61) {
    size = 2;
  }
  return this.finishOp(types$1.relational, size);
};
pp.readToken_eq_excl = function(code) {
  var next = this.input.charCodeAt(this.pos + 1);
  if (next === 61) {
    return this.finishOp(types$1.equality, this.input.charCodeAt(this.pos + 2) === 61 ? 3 : 2);
  }
  if (code === 61 && next === 62 && this.options.ecmaVersion >= 6) {
    this.pos += 2;
    return this.finishToken(types$1.arrow);
  }
  return this.finishOp(code === 61 ? types$1.eq : types$1.prefix, 1);
};
pp.readToken_question = function() {
  var ecmaVersion2 = this.options.ecmaVersion;
  if (ecmaVersion2 >= 11) {
    var next = this.input.charCodeAt(this.pos + 1);
    if (next === 46) {
      var next2 = this.input.charCodeAt(this.pos + 2);
      if (next2 < 48 || next2 > 57) {
        return this.finishOp(types$1.questionDot, 2);
      }
    }
    if (next === 63) {
      if (ecmaVersion2 >= 12) {
        var next2$1 = this.input.charCodeAt(this.pos + 2);
        if (next2$1 === 61) {
          return this.finishOp(types$1.assign, 3);
        }
      }
      return this.finishOp(types$1.coalesce, 2);
    }
  }
  return this.finishOp(types$1.question, 1);
};
pp.readToken_numberSign = function() {
  var ecmaVersion2 = this.options.ecmaVersion;
  var code = 35;
  if (ecmaVersion2 >= 13) {
    ++this.pos;
    code = this.fullCharCodeAtPos();
    if (isIdentifierStart(code, true) || code === 92) {
      return this.finishToken(types$1.privateId, this.readWord1());
    }
  }
  this.raise(this.pos, "Unexpected character '" + codePointToString(code) + "'");
};
pp.getTokenFromCode = function(code) {
  switch (code) {
    // The interpretation of a dot depends on whether it is followed
    // by a digit or another two dots.
    case 46:
      return this.readToken_dot();
    // Punctuation tokens.
    case 40:
      ++this.pos;
      return this.finishToken(types$1.parenL);
    case 41:
      ++this.pos;
      return this.finishToken(types$1.parenR);
    case 59:
      ++this.pos;
      return this.finishToken(types$1.semi);
    case 44:
      ++this.pos;
      return this.finishToken(types$1.comma);
    case 91:
      ++this.pos;
      return this.finishToken(types$1.bracketL);
    case 93:
      ++this.pos;
      return this.finishToken(types$1.bracketR);
    case 123:
      ++this.pos;
      return this.finishToken(types$1.braceL);
    case 125:
      ++this.pos;
      return this.finishToken(types$1.braceR);
    case 58:
      ++this.pos;
      return this.finishToken(types$1.colon);
    case 96:
      if (this.options.ecmaVersion < 6) {
        break;
      }
      ++this.pos;
      return this.finishToken(types$1.backQuote);
    case 48:
      var next = this.input.charCodeAt(this.pos + 1);
      if (next === 120 || next === 88) {
        return this.readRadixNumber(16);
      }
      if (this.options.ecmaVersion >= 6) {
        if (next === 111 || next === 79) {
          return this.readRadixNumber(8);
        }
        if (next === 98 || next === 66) {
          return this.readRadixNumber(2);
        }
      }
    // Anything else beginning with a digit is an integer, octal
    // number, or float.
    case 49:
    case 50:
    case 51:
    case 52:
    case 53:
    case 54:
    case 55:
    case 56:
    case 57:
      return this.readNumber(false);
    // Quotes produce strings.
    case 34:
    case 39:
      return this.readString(code);
    // Operators are parsed inline in tiny state machines. '=' (61) is
    // often referred to. `finishOp` simply skips the amount of
    // characters it is given as second argument, and returns a token
    // of the type given by its first argument.
    case 47:
      return this.readToken_slash();
    case 37:
    case 42:
      return this.readToken_mult_modulo_exp(code);
    case 124:
    case 38:
      return this.readToken_pipe_amp(code);
    case 94:
      return this.readToken_caret();
    case 43:
    case 45:
      return this.readToken_plus_min(code);
    case 60:
    case 62:
      return this.readToken_lt_gt(code);
    case 61:
    case 33:
      return this.readToken_eq_excl(code);
    case 63:
      return this.readToken_question();
    case 126:
      return this.finishOp(types$1.prefix, 1);
    case 35:
      return this.readToken_numberSign();
  }
  this.raise(this.pos, "Unexpected character '" + codePointToString(code) + "'");
};
pp.finishOp = function(type, size) {
  var str = this.input.slice(this.pos, this.pos + size);
  this.pos += size;
  return this.finishToken(type, str);
};
pp.readRegexp = function() {
  var escaped, inClass, start = this.pos;
  for (; ; ) {
    if (this.pos >= this.input.length) {
      this.raise(start, "Unterminated regular expression");
    }
    var ch = this.input.charAt(this.pos);
    if (lineBreak.test(ch)) {
      this.raise(start, "Unterminated regular expression");
    }
    if (!escaped) {
      if (ch === "[") {
        inClass = true;
      } else if (ch === "]" && inClass) {
        inClass = false;
      } else if (ch === "/" && !inClass) {
        break;
      }
      escaped = ch === "\\";
    } else {
      escaped = false;
    }
    ++this.pos;
  }
  var pattern = this.input.slice(start, this.pos);
  ++this.pos;
  var flagsStart = this.pos;
  var flags = this.readWord1();
  if (this.containsEsc) {
    this.unexpected(flagsStart);
  }
  var state = this.regexpState || (this.regexpState = new RegExpValidationState(this));
  state.reset(start, pattern, flags);
  this.validateRegExpFlags(state);
  this.validateRegExpPattern(state);
  var value = null;
  try {
    value = new RegExp(pattern, flags);
  } catch (e) {
  }
  return this.finishToken(types$1.regexp, { pattern, flags, value });
};
pp.readInt = function(radix, len, maybeLegacyOctalNumericLiteral) {
  var allowSeparators = this.options.ecmaVersion >= 12 && len === void 0;
  var isLegacyOctalNumericLiteral = maybeLegacyOctalNumericLiteral && this.input.charCodeAt(this.pos) === 48;
  var start = this.pos, total = 0, lastCode = 0;
  for (var i2 = 0, e = len == null ? Infinity : len; i2 < e; ++i2, ++this.pos) {
    var code = this.input.charCodeAt(this.pos), val = void 0;
    if (allowSeparators && code === 95) {
      if (isLegacyOctalNumericLiteral) {
        this.raiseRecoverable(this.pos, "Numeric separator is not allowed in legacy octal numeric literals");
      }
      if (lastCode === 95) {
        this.raiseRecoverable(this.pos, "Numeric separator must be exactly one underscore");
      }
      if (i2 === 0) {
        this.raiseRecoverable(this.pos, "Numeric separator is not allowed at the first of digits");
      }
      lastCode = code;
      continue;
    }
    if (code >= 97) {
      val = code - 97 + 10;
    } else if (code >= 65) {
      val = code - 65 + 10;
    } else if (code >= 48 && code <= 57) {
      val = code - 48;
    } else {
      val = Infinity;
    }
    if (val >= radix) {
      break;
    }
    lastCode = code;
    total = total * radix + val;
  }
  if (allowSeparators && lastCode === 95) {
    this.raiseRecoverable(this.pos - 1, "Numeric separator is not allowed at the last of digits");
  }
  if (this.pos === start || len != null && this.pos - start !== len) {
    return null;
  }
  return total;
};
function stringToNumber(str, isLegacyOctalNumericLiteral) {
  if (isLegacyOctalNumericLiteral) {
    return parseInt(str, 8);
  }
  return parseFloat(str.replace(/_/g, ""));
}
function stringToBigInt(str) {
  if (typeof BigInt !== "function") {
    return null;
  }
  return BigInt(str.replace(/_/g, ""));
}
pp.readRadixNumber = function(radix) {
  var start = this.pos;
  this.pos += 2;
  var val = this.readInt(radix);
  if (val == null) {
    this.raise(this.start + 2, "Expected number in radix " + radix);
  }
  if (this.options.ecmaVersion >= 11 && this.input.charCodeAt(this.pos) === 110) {
    val = stringToBigInt(this.input.slice(start, this.pos));
    ++this.pos;
  } else if (isIdentifierStart(this.fullCharCodeAtPos())) {
    this.raise(this.pos, "Identifier directly after number");
  }
  return this.finishToken(types$1.num, val);
};
pp.readNumber = function(startsWithDot) {
  var start = this.pos;
  if (!startsWithDot && this.readInt(10, void 0, true) === null) {
    this.raise(start, "Invalid number");
  }
  var octal = this.pos - start >= 2 && this.input.charCodeAt(start) === 48;
  if (octal && this.strict) {
    this.raise(start, "Invalid number");
  }
  var next = this.input.charCodeAt(this.pos);
  if (!octal && !startsWithDot && this.options.ecmaVersion >= 11 && next === 110) {
    var val$1 = stringToBigInt(this.input.slice(start, this.pos));
    ++this.pos;
    if (isIdentifierStart(this.fullCharCodeAtPos())) {
      this.raise(this.pos, "Identifier directly after number");
    }
    return this.finishToken(types$1.num, val$1);
  }
  if (octal && /[89]/.test(this.input.slice(start, this.pos))) {
    octal = false;
  }
  if (next === 46 && !octal) {
    ++this.pos;
    this.readInt(10);
    next = this.input.charCodeAt(this.pos);
  }
  if ((next === 69 || next === 101) && !octal) {
    next = this.input.charCodeAt(++this.pos);
    if (next === 43 || next === 45) {
      ++this.pos;
    }
    if (this.readInt(10) === null) {
      this.raise(start, "Invalid number");
    }
  }
  if (isIdentifierStart(this.fullCharCodeAtPos())) {
    this.raise(this.pos, "Identifier directly after number");
  }
  var val = stringToNumber(this.input.slice(start, this.pos), octal);
  return this.finishToken(types$1.num, val);
};
pp.readCodePoint = function() {
  var ch = this.input.charCodeAt(this.pos), code;
  if (ch === 123) {
    if (this.options.ecmaVersion < 6) {
      this.unexpected();
    }
    var codePos = ++this.pos;
    code = this.readHexChar(this.input.indexOf("}", this.pos) - this.pos);
    ++this.pos;
    if (code > 1114111) {
      this.invalidStringToken(codePos, "Code point out of bounds");
    }
  } else {
    code = this.readHexChar(4);
  }
  return code;
};
pp.readString = function(quote) {
  var out = "", chunkStart = ++this.pos;
  for (; ; ) {
    if (this.pos >= this.input.length) {
      this.raise(this.start, "Unterminated string constant");
    }
    var ch = this.input.charCodeAt(this.pos);
    if (ch === quote) {
      break;
    }
    if (ch === 92) {
      out += this.input.slice(chunkStart, this.pos);
      out += this.readEscapedChar(false);
      chunkStart = this.pos;
    } else if (ch === 8232 || ch === 8233) {
      if (this.options.ecmaVersion < 10) {
        this.raise(this.start, "Unterminated string constant");
      }
      ++this.pos;
      if (this.options.locations) {
        this.curLine++;
        this.lineStart = this.pos;
      }
    } else {
      if (isNewLine(ch)) {
        this.raise(this.start, "Unterminated string constant");
      }
      ++this.pos;
    }
  }
  out += this.input.slice(chunkStart, this.pos++);
  return this.finishToken(types$1.string, out);
};
var INVALID_TEMPLATE_ESCAPE_ERROR = {};
pp.tryReadTemplateToken = function() {
  this.inTemplateElement = true;
  try {
    this.readTmplToken();
  } catch (err) {
    if (err === INVALID_TEMPLATE_ESCAPE_ERROR) {
      this.readInvalidTemplateToken();
    } else {
      throw err;
    }
  }
  this.inTemplateElement = false;
};
pp.invalidStringToken = function(position, message) {
  if (this.inTemplateElement && this.options.ecmaVersion >= 9) {
    throw INVALID_TEMPLATE_ESCAPE_ERROR;
  } else {
    this.raise(position, message);
  }
};
pp.readTmplToken = function() {
  var out = "", chunkStart = this.pos;
  for (; ; ) {
    if (this.pos >= this.input.length) {
      this.raise(this.start, "Unterminated template");
    }
    var ch = this.input.charCodeAt(this.pos);
    if (ch === 96 || ch === 36 && this.input.charCodeAt(this.pos + 1) === 123) {
      if (this.pos === this.start && (this.type === types$1.template || this.type === types$1.invalidTemplate)) {
        if (ch === 36) {
          this.pos += 2;
          return this.finishToken(types$1.dollarBraceL);
        } else {
          ++this.pos;
          return this.finishToken(types$1.backQuote);
        }
      }
      out += this.input.slice(chunkStart, this.pos);
      return this.finishToken(types$1.template, out);
    }
    if (ch === 92) {
      out += this.input.slice(chunkStart, this.pos);
      out += this.readEscapedChar(true);
      chunkStart = this.pos;
    } else if (isNewLine(ch)) {
      out += this.input.slice(chunkStart, this.pos);
      ++this.pos;
      switch (ch) {
        case 13:
          if (this.input.charCodeAt(this.pos) === 10) {
            ++this.pos;
          }
        case 10:
          out += "\n";
          break;
        default:
          out += String.fromCharCode(ch);
          break;
      }
      if (this.options.locations) {
        ++this.curLine;
        this.lineStart = this.pos;
      }
      chunkStart = this.pos;
    } else {
      ++this.pos;
    }
  }
};
pp.readInvalidTemplateToken = function() {
  for (; this.pos < this.input.length; this.pos++) {
    switch (this.input[this.pos]) {
      case "\\":
        ++this.pos;
        break;
      case "$":
        if (this.input[this.pos + 1] !== "{") {
          break;
        }
      // fall through
      case "`":
        return this.finishToken(types$1.invalidTemplate, this.input.slice(this.start, this.pos));
      case "\r":
        if (this.input[this.pos + 1] === "\n") {
          ++this.pos;
        }
      // fall through
      case "\n":
      case "\u2028":
      case "\u2029":
        ++this.curLine;
        this.lineStart = this.pos + 1;
        break;
    }
  }
  this.raise(this.start, "Unterminated template");
};
pp.readEscapedChar = function(inTemplate) {
  var ch = this.input.charCodeAt(++this.pos);
  ++this.pos;
  switch (ch) {
    case 110:
      return "\n";
    // 'n' -> '\n'
    case 114:
      return "\r";
    // 'r' -> '\r'
    case 120:
      return String.fromCharCode(this.readHexChar(2));
    // 'x'
    case 117:
      return codePointToString(this.readCodePoint());
    // 'u'
    case 116:
      return "	";
    // 't' -> '\t'
    case 98:
      return "\b";
    // 'b' -> '\b'
    case 118:
      return "\v";
    // 'v' -> '\u000b'
    case 102:
      return "\f";
    // 'f' -> '\f'
    case 13:
      if (this.input.charCodeAt(this.pos) === 10) {
        ++this.pos;
      }
    // '\r\n'
    case 10:
      if (this.options.locations) {
        this.lineStart = this.pos;
        ++this.curLine;
      }
      return "";
    case 56:
    case 57:
      if (this.strict) {
        this.invalidStringToken(
          this.pos - 1,
          "Invalid escape sequence"
        );
      }
      if (inTemplate) {
        var codePos = this.pos - 1;
        this.invalidStringToken(
          codePos,
          "Invalid escape sequence in template string"
        );
      }
    default:
      if (ch >= 48 && ch <= 55) {
        var octalStr = this.input.substr(this.pos - 1, 3).match(/^[0-7]+/)[0];
        var octal = parseInt(octalStr, 8);
        if (octal > 255) {
          octalStr = octalStr.slice(0, -1);
          octal = parseInt(octalStr, 8);
        }
        this.pos += octalStr.length - 1;
        ch = this.input.charCodeAt(this.pos);
        if ((octalStr !== "0" || ch === 56 || ch === 57) && (this.strict || inTemplate)) {
          this.invalidStringToken(
            this.pos - 1 - octalStr.length,
            inTemplate ? "Octal literal in template string" : "Octal literal in strict mode"
          );
        }
        return String.fromCharCode(octal);
      }
      if (isNewLine(ch)) {
        if (this.options.locations) {
          this.lineStart = this.pos;
          ++this.curLine;
        }
        return "";
      }
      return String.fromCharCode(ch);
  }
};
pp.readHexChar = function(len) {
  var codePos = this.pos;
  var n = this.readInt(16, len);
  if (n === null) {
    this.invalidStringToken(codePos, "Bad character escape sequence");
  }
  return n;
};
pp.readWord1 = function() {
  this.containsEsc = false;
  var word = "", first = true, chunkStart = this.pos;
  var astral = this.options.ecmaVersion >= 6;
  while (this.pos < this.input.length) {
    var ch = this.fullCharCodeAtPos();
    if (isIdentifierChar(ch, astral)) {
      this.pos += ch <= 65535 ? 1 : 2;
    } else if (ch === 92) {
      this.containsEsc = true;
      word += this.input.slice(chunkStart, this.pos);
      var escStart = this.pos;
      if (this.input.charCodeAt(++this.pos) !== 117) {
        this.invalidStringToken(this.pos, "Expecting Unicode escape sequence \\uXXXX");
      }
      ++this.pos;
      var esc = this.readCodePoint();
      if (!(first ? isIdentifierStart : isIdentifierChar)(esc, astral)) {
        this.invalidStringToken(escStart, "Invalid Unicode escape");
      }
      word += codePointToString(esc);
      chunkStart = this.pos;
    } else {
      break;
    }
    first = false;
  }
  return word + this.input.slice(chunkStart, this.pos);
};
pp.readWord = function() {
  var word = this.readWord1();
  var type = types$1.name;
  if (this.keywords.test(word)) {
    type = keywords[word];
  }
  return this.finishToken(type, word);
};
var version = "8.16.0";
Parser.acorn = {
  Parser,
  version,
  defaultOptions,
  Position,
  SourceLocation,
  getLineInfo,
  Node,
  TokenType,
  tokTypes: types$1,
  keywordTypes: keywords,
  TokContext,
  tokContexts: types,
  isIdentifierChar,
  isIdentifierStart,
  Token,
  isNewLine,
  lineBreak,
  lineBreakG,
  nonASCIIwhitespace
};
function parse3(input, options) {
  return Parser.parse(input, options);
}

// packages/agent-hooks/src/codex/shell-command.ts
function extractShellCommand(toolInput) {
  if (!isRecord(toolInput)) return null;
  const command = toolInput.command;
  if (typeof command === "string") return command.length > 0 ? command : null;
  if (Array.isArray(command)) {
    const parts = command.filter((p) => typeof p === "string");
    if (parts.length === 0) return null;
    const flagIdx = parts.findIndex((p) => p === "-c" || p === "-lc" || p === "-ic");
    const script = flagIdx >= 0 ? parts[flagIdx + 1] : void 0;
    if (script !== void 0) return script;
    return parts.join(" ");
  }
  return null;
}

// packages/agent-hooks/src/codex/shell-input.ts
var MAX_SOURCE_BYTES = 1048576;
var MAX_EXECUTIONS = 32;
var MAX_AST_NODES = 5e4;
function execution(input) {
  const command = typeof input.cmd === "string" ? input.cmd : extractShellCommand(input);
  if (!command) return null;
  const workdir = input.workdir ?? input.cwd;
  if (workdir !== void 0 && workdir !== null && typeof workdir !== "string") return null;
  return {
    command,
    workdir: typeof workdir === "string" ? workdir : null,
    background: ["run_in_background", "background", "delegate", "delegated", "worker"].some(
      (key2) => input[key2] === true
    )
  };
}
function argumentsObject(input) {
  if (!isRecord(input)) return null;
  if (typeof input.arguments !== "string") return input;
  if (Buffer.byteLength(input.arguments) > MAX_SOURCE_BYTES) return null;
  try {
    const parsed = JSON.parse(input.arguments);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function literal2(node) {
  if (!isRecord(node)) return void 0;
  if (node.type === "Literal") return node.value;
  if (node.type === "TemplateLiteral" && Array.isArray(node.expressions) && node.expressions.length === 0) {
    const first = Array.isArray(node.quasis) ? node.quasis[0] : null;
    return isRecord(first) && isRecord(first.value) ? first.value.cooked : void 0;
  }
  return void 0;
}
function literalArguments(node) {
  if (!isRecord(node) || node.type !== "ObjectExpression" || !Array.isArray(node.properties)) return null;
  const result = {};
  for (const property of node.properties) {
    if (!isRecord(property) || property.type !== "Property" || property.computed || property.method) return null;
    const key2 = property.key;
    const name = isRecord(key2) && key2.type === "Identifier" ? key2.name : literal2(key2);
    if (typeof name !== "string") return null;
    if (["cmd", "workdir", "cwd", "run_in_background", "background", "delegate", "delegated", "worker"].includes(name)) {
      if (Object.hasOwn(result, name)) return null;
      const value = literal2(property.value);
      if (value === void 0) return null;
      result[name] = value;
    }
  }
  return result;
}
function narrowCodeModeExecutions(toolInput) {
  if (!isRecord(toolInput) || typeof toolInput.input !== "string") return { matched: false, executions: [] };
  const source = toolInput.input;
  if (Buffer.byteLength(source) > MAX_SOURCE_BYTES) return { matched: true, executions: [] };
  let ast;
  try {
    ast = parse3(source, { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true });
  } catch {
    return { matched: /\bexec_command\b/.test(source), executions: [] };
  }
  let nodes = 0;
  let matched = false;
  let invalid = false;
  const executions = [];
  const pending2 = [ast];
  while (pending2.length > 0) {
    const node = pending2.pop();
    if (!isRecord(node) || typeof node.type !== "string") continue;
    if (++nodes > MAX_AST_NODES) return { matched: true, executions: [] };
    if (node.type === "CallExpression" && isRecord(node.callee)) {
      const callee = node.callee;
      if (callee.type === "MemberExpression" && isRecord(callee.object) && callee.object.type === "Identifier" && callee.object.name === "tools" && isRecord(callee.property) && (callee.computed ? literal2(callee.property) : callee.property.name) === "exec_command") {
        matched = true;
        const args = Array.isArray(node.arguments) && node.arguments.length === 1 ? literalArguments(node.arguments[0]) : null;
        const result = args === null ? null : execution(args);
        if (result === null || executions.length >= MAX_EXECUTIONS) invalid = true;
        else executions.push(result);
      }
    }
    const children = Object.values(node).flatMap((value) => Array.isArray(value) ? value : [value]);
    for (let index = children.length - 1; index >= 0; index--) pending2.push(children[index]);
  }
  return { matched, executions: invalid ? [] : executions };
}
function narrowShellExecutions(toolInput) {
  const args = argumentsObject(toolInput);
  const direct = args === null ? null : execution(args);
  if (direct !== null) return { matched: true, executions: [direct] };
  return narrowCodeModeExecutions(toolInput);
}

// packages/agent-hooks/src/codex/post-tool-use.ts
var APPLY_PATCH_SUCCESS_PREFIX = "Success. Updated the following files:";
function narrowApplyPatchCommand(toolInput) {
  return isRecord(toolInput) && typeof toolInput.command === "string" ? toolInput.command : null;
}
function classifyApplyPatchResponse(toolResponse) {
  if (Array.isArray(toolResponse)) return "unknown";
  const normalized = normalizeBashResponse(toolResponse);
  if (normalized === null) return "unknown";
  return normalized.stdout.startsWith(APPLY_PATCH_SUCCESS_PREFIX) ? "success" : "failure";
}
function plannedPatchCandidates(record2, cwd) {
  const repoRoot = resolveRepoRoot(cwd);
  if (record2 === null || repoRoot === null || toPosix(record2.repoRoot) !== toPosix(repoRoot)) return [];
  return record2.touches.map((touch) => ({
    absolutePath: resolvePath3(record2.repoRoot, touch.repoRelativePath),
    operation: touch.operation === "delete" ? "delete" : touch.operation === "create-overwrite" ? "create-overwrite" : "modify",
    ranges: touch.ranges,
    preTrackedDelete: touch.operation === "delete" && touch.evidence?.kind === "tracked"
  }));
}
function createHandler(executors = createDefaultTouchExecutors(), memoFactory = createDiskMemoStore, layout = DEFAULT_SESSION_LAYOUT, runtimeOptions = {}) {
  const options = { stateRoot: join11(dirname9(layout.base), "commit-receipts"), ...runtimeOptions };
  return async (input, ctx) => {
    let original = null;
    const shellTool = ["Bash", "shell", "local_shell", "exec_command", "exec"].includes(input.tool_name);
    const poll = input.tool_name === "write_stdin";
    if ((shellTool || poll) && input.session_id && input.tool_use_id) {
      try {
        const executionId = poll ? polledExecution(input.tool_input) : null;
        const identity = poll ? executionId === null ? null : findExecution(input.session_id, executionId, options) : { host: "codex", sessionId: input.session_id, toolUseId: input.tool_use_id };
        if (identity !== null) {
          const running = yieldedExecution(input.tool_response);
          if (running !== null) {
            if (!poll && narrowShellExecutions(input.tool_input).executions.length > 1) {
              ctx.logger.warn(
                "Codex raw code-mode batch yielded without per-command completion identities; preserving active observations"
              );
              return void 0;
            }
            await retainExecution(identity, running, options);
            return void 0;
          }
          if (poll && !completedExecution(input.tool_response)) return void 0;
          original = (await terminalCommitInvocation(identity, options, ctx.logger)).original;
        }
      } catch (err) {
        ctx.logger.warn("git-span terminal commit attribution failed", { err });
      }
    }
    if (poll) return void 0;
    if (original === null && isRecord(input.tool_input) && typeof input.tool_input.command === "string" && isExecutionPlanCommand(input.tool_input.command)) {
      ctx.logger.warn("git-span execution-directory receipt missing; suppressing session-directory attribution");
      return void 0;
    }
    if (original === null && input.tool_name === "Bash" && isRecord(input.tool_input) && typeof input.tool_input.command === "string" && typeof input.tool_input.workdir !== "string" && typeof input.tool_input.cwd !== "string") {
      ctx.logger.warn("git-span canonical Bash execution directory unknown; suppressing session-directory attribution");
      return void 0;
    }
    const cwd = original?.cwd ?? input.cwd ?? "";
    const sessionId2 = input.session_id;
    const memo = memoFactory(ctx.logger, layout);
    if (shellTool) {
      const recovered = narrowShellExecutions(original?.input ?? input.tool_input);
      if (recovered.executions.length === 0) {
        if (recovered.matched)
          ctx.logger.warn("Codex code-mode exec envelope matched but its command is not statically recoverable");
        return void 0;
      }
      const blocks2 = [];
      const executions = original?.executions ?? recovered.executions.map((execution2, index) => ({
        command: execution2.command,
        cwd: index === 0 && original !== null ? original.cwd : resolveFrame(execution2.workdir ?? void 0, input.cwd ?? "")
      }));
      for (const execution2 of executions) {
        const effectiveCwd = execution2.cwd;
        blocks2.push(
          ...await runLayeredBashTouches(
            execution2.command,
            effectiveCwd,
            sessionId2,
            recovered.executions.length === 1 ? input.tool_use_id : void 0,
            input.tool_response,
            executors,
            memo,
            ctx.logger,
            createDefaultPlannedTouchStore(layout)
          )
        );
      }
      if (blocks2.length === 0) return void 0;
      const shellCombined = blocks2.join("");
      return postToolUseOutput({ additionalContext: shellCombined, systemMessage: shellCombined });
    }
    const command = narrowApplyPatchCommand(input.tool_input);
    if (command === null) return void 0;
    const store = createDefaultPlannedTouchStore(layout);
    const planned = input.tool_use_id === void 0 ? { status: "missing" } : store.take(sessionId2, input.tool_use_id);
    if (planned.status === "consumed") return void 0;
    const record2 = planned.status === "record" ? planned.record : null;
    const classification = classifyApplyPatchResponse(input.tool_response);
    if (classification === "failure") return void 0;
    if (classification === "unknown") {
      ctx.logger.warn("Codex apply_patch tool_response shape unrecognized; suppressing attribution");
      return void 0;
    }
    const blocks = await runApplyPatchTouches(
      command,
      cwd,
      sessionId2,
      plannedPatchCandidates(record2, cwd),
      executors,
      memo,
      input.tool_use_id === void 0 ? null : `${sessionId2}:${input.tool_use_id}`,
      ctx.logger
    );
    if (blocks.length === 0) return void 0;
    const combined = blocks.join("");
    return postToolUseOutput({ additionalContext: combined, systemMessage: combined });
  };
}
disableUpdateCheck();
var post_tool_use_default = postToolUseHook(
  { matcher: "apply_patch|exec_command|exec|shell|local_shell|Bash|write_stdin", timeout: 15e3 },
  createHandler()
);

// packages/agent-hooks/src/codex/apply-patch-plan.ts
function readPreEdit(cwd, path) {
  try {
    return fs8.readFileSync(abspathAgainst(cwd, path), "utf8");
  } catch {
    return null;
  }
}
function createHandler2(layout = DEFAULT_SESSION_LAYOUT) {
  return async (input, ctx) => {
    try {
      if (!input.session_id || !input.tool_use_id) return void 0;
      const command = narrowApplyPatchCommand(input.tool_input);
      if (command === null) return void 0;
      const cwd = input.cwd ?? "";
      const repoRoot = resolveRepoRoot(cwd);
      if (repoRoot === null) return void 0;
      const anchors = parseApplyPatch(command, (path) => readPreEdit(cwd, path));
      if (anchors.length === 0) {
        ctx.logger.warn("git-span apply_patch pre-plan resolved no anchors", { toolUseId: input.tool_use_id });
        return void 0;
      }
      const tracked = filterTrackedEligibility(
        anchors.map((anchor) => ({ absolutePath: abspathAgainst(cwd, anchor.path), value: anchor })),
        { cwd }
      );
      flushFailOpen(ctx.logger);
      const touches = tracked.eligible.map(({ absolutePath, value: anchor }) => ({
        repoRelativePath: relativeToRepo(repoRoot, absolutePath),
        operation: anchor.absent ? "delete" : anchor.kind === "create" ? "create-overwrite" : "modify",
        ranges: anchor.range === void 0 ? [] : [anchor.range],
        simpleCommandIndex: 0,
        ...anchor.absent ? { evidence: { kind: "tracked", tracked: true } } : {}
      }));
      if (touches.length === 0) return void 0;
      createDefaultPlannedTouchStore(layout).put({
        version: 1,
        sessionId: input.session_id,
        toolUseId: input.tool_use_id,
        repoRoot,
        createdAtMs: Date.now(),
        touches
      });
      ctx.logger.info?.("git-span apply_patch pre-plan", {
        planned: touches.length,
        trackedDrops: tracked.dropped.length,
        ignoreQueryCount: tracked.ignoreQueryCount,
        trackedQueryCount: tracked.trackedQueryCount,
        eligibilityErrors: tracked.errors
      });
      return void 0;
    } catch (err) {
      ctx.logger.warn("git-span apply_patch pre-plan failed closed for attribution", { err });
      return void 0;
    }
  };
}
disableUpdateCheck();
var apply_patch_plan_default = preToolUseHook({ matcher: "apply_patch", timeout: 1e4 }, createHandler2());

// packages/agent-hooks/src/codex/apply-patch-plan-entry.ts
execute(apply_patch_plan_default);

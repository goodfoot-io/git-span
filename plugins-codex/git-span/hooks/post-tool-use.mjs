#!/usr/bin/env -S node --enable-source-maps
// packages/agent-hooks/src/codex/post-tool-use.ts
import { dirname as dirname8, join as join10, resolve as resolvePath3 } from "node:path";

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
function postToolUseHook(config, handler) {
  return createHookFunction("PostToolUse", config, handler);
}

// node_modules/@goodfoot/agent-hooks/dist/core/stdin.js
async function readStdin() {
  return new Promise((resolve5, reject2) => {
    const chunks = [];
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      chunks.push(chunk);
    });
    process.stdin.on("end", () => {
      resolve5(chunks.join(""));
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
  return new Promise((resolve5, reject2) => {
    stream.write(content, (error) => error ? reject2(error) : resolve5());
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
  const composed = (input, context) => {
    const result = hookFn(input, context);
    const normalize = (value) => {
      if (typeof value === "string") {
        return normalizeStringOutput(eventName, value);
      }
      return value;
    };
    return result instanceof Promise ? result.then(normalize) : normalize(result);
  };
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
    for (const entry of fs.readdirSync(layout.trashDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.includes(SESSION_TRASH_MARKER)) continue;
      const trashPath = nodePath.join(layout.trashDir, entry.name);
      try {
        const stat = fs.statSync(trashPath);
        if (now - stat.mtimeMs > SESSION_TRASH_TTL_MS) {
          fs.rmSync(trashPath, { recursive: true, force: true });
        }
      } catch (err) {
      }
    }
  } catch (err) {
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

// packages/agent-hooks/src/codex/apply-patch.ts
import * as fs2 from "node:fs";
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
    return fs2.readFileSync(path, "utf8");
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
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === value) out.push(i);
  }
  return out;
}
function scanContiguousMatches(haystack, needle) {
  const out = [];
  const first = needle[0];
  if (first === void 0 || needle.length > haystack.length) return out;
  const last = haystack.length - needle.length;
  for (let i = 0; i <= last; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}
function buildLineOccurrences(lines) {
  const occurrences = /* @__PURE__ */ new Map();
  for (const [i, line] of lines.entries()) {
    const seen = occurrences.get(line);
    if (seen === void 0) occurrences.set(line, i);
    else if (typeof seen === "number") occurrences.set(line, [seen, i]);
    else seen.push(i);
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
function recoverRange(preLines, chunks) {
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
    const range = pre === null ? null : recoverRange(pre, hunk.chunks);
    if (range !== null) {
      anchors.push({ path: targetPath, kind: "write", range });
    } else {
      anchors.push({ path: targetPath, kind: "whole-write" });
    }
  }
  return anchors;
}

// packages/agent-hooks/src/common/static-attribution.ts
import { execFileSync as execFileSync3 } from "node:child_process";
import * as fs3 from "node:fs";
import * as nodePath2 from "node:path";

// packages/agent-hooks/src/common/parse-command.ts
import { readFileSync as readFileSync3, statSync as statSync3 } from "node:fs";
import { basename as basename2, isAbsolute, join as joinPath, resolve as resolvePath } from "node:path";

// packages/agent-hooks/src/common/command-resolve.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import { readFileSync as readFileSync2, statSync as statSync2 } from "node:fs";
function countFileLines(absolutePath) {
  try {
    if (!statSync2(absolutePath).isFile()) return null;
    const content = readFileSync2(absolutePath, "utf8");
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
  const kw = CONSTRUCT_KEYWORDS.get(w);
  if (kw === void 0) return false;
  kw(s);
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
  for (let i = 0; i < simpleCmd.length; i++) {
    const c = simpleCmd.charAt(i);
    if (inSquote) {
      if (c === "'") inSquote = false;
      continue;
    }
    if (inDquote) {
      if (c === "\\" && i + 1 < simpleCmd.length && '"\\$`'.includes(simpleCmd.charAt(i + 1))) {
        i += 1;
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
    if (c === "\\" && i + 1 < simpleCmd.length) {
      i += 1;
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
    const text2 = headerPathText(raw);
    if (text2 === "/dev/null") return text2;
    return stripPathComponents(text2, stripLevelFor(text2, strip));
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
    const [, preStartText, preCountText, , postCountText] = line.match(HUNK_HEADER) ?? [];
    if (preStartText !== void 0) {
      sawBlock = true;
      const preStart = Number.parseInt(preStartText, 10);
      const preCount = preCountText === void 0 ? 1 : Number.parseInt(preCountText, 10);
      const postCount = postCountText === void 0 ? 1 : Number.parseInt(postCountText, 10);
      if (current === null) return null;
      if (preCount !== postCount) current.countChanging = true;
      if (preCount > 0) current.hunks.push({ start: preStart, end: preStart + preCount - 1 });
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
  const [fileArg, ...otherFiles] = rest.filter((a, i) => i !== scriptIdx && a !== "-n" && !a.startsWith("-"));
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
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
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
  let i = 0;
  while (i < rest.length) {
    const a = rest[i];
    if (a === void 0) break;
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
  for (let i = 0; i < after.length; i++) {
    const a = after[i];
    if (a === void 0) break;
    let spec = null;
    if (a === "-L") spec = after[i + 1] ?? null;
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
  let i = from;
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
      while (j >= from && /\d/.test(raw.charAt(j))) j -= 1;
      const ioNumber = j < i - 1 && (j < from || /\s|[;|&(]/.test(raw.charAt(j)));
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
        while (k < openerLineEnd && /\s/.test(raw.charAt(k))) k += 1;
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
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
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
function matchTeeOperands(argv, pipeEchoContent, currentDir, simpleCommandIndex, join11, results) {
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
        join: join11,
        ...pipeEchoContent !== null ? { written: pipeEchoContent } : {}
      } : {
        operation: "append",
        absolutePath,
        simpleCommandIndex,
        join: join11,
        ...pipeEchoContent !== null ? { written: pipeEchoContent } : {}
      }
    });
  }
}
function matchRedirectFamily(argv, redirects, pipeEchoContent, currentDir, simpleCommandIndex, join11, results) {
  const contentRedirects = redirects.filter(isContentRedirect);
  const host = argv[0];
  if (contentRedirects.length === 0) {
    if (host === "tee") matchTeeOperands(argv, pipeEchoContent, currentDir, simpleCommandIndex, join11, results);
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
        span: { operation: "truncate", absolutePath, simpleCommandIndex, join: join11 }
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
          join: join11,
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
          join: join11,
          ...threadedOverwrite !== void 0 ? { written: threadedOverwrite } : {}
        }
      });
    }
  }
  if (host === "tee") matchTeeOperands(argv, pipeEchoContent, currentDir, simpleCommandIndex, join11, results);
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
    if (a === void 0) break;
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
function emitSourceSpan(results, spec, absolutePath, simpleCommandIndex, join11) {
  if (spec.sourceOperation === "delete") {
    results.push({
      status: "resolved",
      idiom: spec.idiom,
      span: { operation: "delete", absolutePath, simpleCommandIndex, join: join11 }
    });
    return;
  }
  const range = resolveSpec({ kind: "toEof", start: 1 }, () => countFileLines(absolutePath));
  results.push({
    status: "resolved",
    idiom: spec.idiom,
    span: range === null ? { operation: "read", absolutePath, simpleCommandIndex, join: join11 } : {
      operation: "read",
      lineStart: range.lineStart,
      lineEnd: range.lineEnd,
      absolutePath,
      simpleCommandIndex,
      join: join11
    }
  });
}
function matchCopyMoveFamily(argv, dirForResolution, simpleCommandIndex, join11, results) {
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
    emitSourceSpan(results, spec, sourcePath, simpleCommandIndex, join11);
  }
  for (const destPath of destPaths) {
    results.push({
      status: "resolved",
      idiom: spec.idiom,
      span: { operation: spec.destOperation, absolutePath: destPath, simpleCommandIndex, join: join11 }
    });
  }
}
var RM_NO_VALUE = /* @__PURE__ */ new Set(["-f", "-i", "-v"]);
var RM_EXCLUDED = /* @__PURE__ */ new Set(["-r", "-R", "--recursive", "-d"]);
var GIT_RM_EXCLUDED = /* @__PURE__ */ new Set(["-r", "-R", "--recursive", "-d", "-n", "--dry-run"]);
function matchRmOperands(args, excluded, excludeCached, dir, simpleCommandIndex, join11, results) {
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
      span: { operation: "delete", absolutePath: resolvePath(dir, operand), simpleCommandIndex, join: join11 }
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
function matchTruncateOperands(args, dir, simpleCommandIndex, join11, results) {
  let sawSizeFlag = false;
  let afterDashDash = false;
  let staticSize;
  const operands = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
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
        join: join11,
        ...operand.size !== void 0 ? { size: operand.size } : {}
      }
    });
  }
}
function matchRmTruncate(argv, dirForResolution, simpleCommandIndex, join11, results) {
  const [command, ...commandArgs] = stripTransparentWrapper(argv);
  if (command === void 0) return;
  if (command === "rm") {
    matchRmOperands(commandArgs, RM_EXCLUDED, false, dirForResolution, simpleCommandIndex, join11, results);
    return;
  }
  if (command === "truncate") {
    matchTruncateOperands(commandArgs, dirForResolution, simpleCommandIndex, join11, results);
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
        join11,
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
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "\\") continue;
    const next = body[i + 1];
    if (next === void 0 || next === "$" || next === "`" || next === "\\" || next === "\n") return false;
    i += 1;
  }
  return true;
}
function classifyHeredocOpener(opener, body, quotedDelim, currentDir, simpleCommandIndex, join11, results) {
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
            join: join11,
            ...singlePlainAppend && r.op === ">>" && bodyLiteral ? { written: body } : {}
          }
        });
      } else {
        results.push({
          status: "resolved",
          idiom: "heredoc-write",
          span: body.length === 0 ? { operation: "truncate", absolutePath, simpleCommandIndex, join: join11 } : {
            operation: "create-overwrite",
            absolutePath,
            simpleCommandIndex,
            join: join11,
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
              join: join11,
              ...contentRedirects.length === 0 && bodyLiteral ? { written: body } : {}
            }
          });
        } else {
          results.push({
            status: "resolved",
            idiom: "heredoc-write",
            span: body.length === 0 ? { operation: "truncate", absolutePath, simpleCommandIndex, join: join11 } : {
              operation: "create-overwrite",
              absolutePath,
              simpleCommandIndex,
              join: join11,
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
    classifyPatchHeredoc(argv, body, currentDir, simpleCommandIndex, join11, results);
    return;
  }
}
var NUMERIC_SUBSTITUTION = /^(\d+)(?:,(\d+))?[sy]/;
var UNRESTRICTED_SUBSTITUTION = /^[sy]/;
function matchSedInplace(argv, dirForResolution, simpleCommandIndex, join11, results) {
  const [command, ...commandArgs] = stripTransparentWrapper(argv);
  if (command === void 0) return;
  if (command === "sed") {
    matchSedInplaceArgs(commandArgs, dirForResolution, simpleCommandIndex, join11, results);
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
function matchSedInplaceArgs(args, dir, simpleCommandIndex, join11, results) {
  let suffix = null;
  let sawInplace = false;
  let i = 0;
  const eScripts = [];
  const positionals = [];
  const files = [];
  let afterDashDash = false;
  while (i < args.length) {
    const a = args[i];
    if (a === void 0) break;
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
      const [following, ...beyond] = args.slice(i + 2);
      if (following !== void 0 && beyond.length > 0 && !SED_SCRIPT_SHAPE.test(w)) {
        suffix = w;
        i += 2;
        continue;
      }
      if (following === void 0) {
        files.push(w);
        i += 2;
        continue;
      }
      positionals.push(w, following);
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
        span: { operation: "modify", lineStart: start, lineEnd: end, absolutePath, simpleCommandIndex, join: join11 }
      });
    } else {
      results.push({
        status: "resolved",
        idiom: "sed-inplace",
        span: { operation: "modify", absolutePath, simpleCommandIndex, join: join11 }
      });
    }
    if (suffix !== null && suffix !== "") {
      results.push({
        status: "resolved",
        idiom: "sed-inplace",
        span: { operation: "create-overwrite", absolutePath: `${absolutePath}${suffix}`, simpleCommandIndex, join: join11 }
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
    return readFileSync3(absolutePath, "utf8");
  } catch {
    return null;
  }
}
function emitPatchTargets(args, isGitApply, host, targetDir, shellDir, redirects, simpleCommandIndex, join11, results) {
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
        join: join11,
        ...t.lineStart !== void 0 ? { lineStart: t.lineStart, lineEnd: t.lineEnd } : {}
      }
    });
  }
}
function matchPatchApply(argv, redirects, dirForResolution, simpleCommandIndex, join11, results) {
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
      join11,
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
      join11,
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
function classifyPatchHeredoc(argv, body, currentDir, simpleCommandIndex, join11, results) {
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
        join: join11,
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
function matchFormatter(argv, dirForResolution, simpleCommandIndex, join11, results) {
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
      span: { operation: "modify", absolutePath: resolvePath(dirForResolution, operand), simpleCommandIndex, join: join11 }
    });
  }
}
var RESTORE_NO_VALUE = /* @__PURE__ */ new Set(["-q", "-f", "-u"]);
function emitRestoreCheckoutPathspec(results, idiom, operand, dir, simpleCommandIndex, join11) {
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
    span: { operation: "create-overwrite", absolutePath, simpleCommandIndex, join: join11 }
  });
}
function matchRestoreOperands(args, dir, simpleCommandIndex, join11, results) {
  let staged = false;
  let worktree = false;
  let afterDashDash = false;
  const operands = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
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
    emitRestoreCheckoutPathspec(results, "git-restore-write", operand, dir, simpleCommandIndex, join11);
  }
}
function matchCheckoutOperands(args, dir, simpleCommandIndex, join11, results) {
  let afterDashDash = false;
  const operands = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
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
      i += 1;
      continue;
    }
    if (a === "-f" || a === "-q" || a === "-m" || a === "-t") continue;
    if (a.startsWith("-")) continue;
  }
  for (const operand of operands) {
    emitRestoreCheckoutPathspec(results, "git-checkout-write", operand, dir, simpleCommandIndex, join11);
  }
}
function matchGitRestoreCheckout(argv, dirForResolution, simpleCommandIndex, join11, results) {
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
    if (sub.subcommand === "restore") matchRestoreOperands(args, dir, simpleCommandIndex, join11, results);
    else matchCheckoutOperands(args, dir, simpleCommandIndex, join11, results);
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
    if (isAbsolute(c.dirOverride)) return c.dirOverride;
    return frame.certain ? resolvePath(frame.dir, c.dirOverride) : void 0;
  };
  const emitCandidate = (c, frame, simpleCommandIndex, join11) => {
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
      if (!frame.certain && !isAbsolute(c.fileArg)) {
        results.push({
          status: "unresolved",
          idiom: c.idiom,
          fileArg: c.fileArg,
          reason: "the working directory is uncertain \u2014 the relative path cannot be resolved"
        });
        return;
      }
      resolutionDir = c.dirOverride === void 0 ? frame.dir : isAbsolute(c.dirOverride) ? c.dirOverride : resolvePath(frame.dir, c.dirOverride);
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
        join: join11
      }
    });
  };
  const matchReads = (simple, argv, i) => {
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
    const [bin] = argv;
    if (bin === void 0) {
      matchRedirectFamily(argv, redirects, pipeEchoContent, currentDir, i, joinOf(simple), results);
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
    matchReads(simple, argv, i);
    matchRedirectFamily(argv, redirects, pipeEchoContent, currentDir, i, joinOf(simple), results);
    matchCopyMoveFamily(argv, currentDir, i, joinOf(simple), results);
    matchRmTruncate(argv, currentDir, i, joinOf(simple), results);
    matchSedInplace(argv, currentDir, i, joinOf(simple), results);
    matchPatchApply(argv, redirects, currentDir, i, joinOf(simple), results);
    matchFormatter(argv, currentDir, i, joinOf(simple), results);
    matchGitRestoreCheckout(argv, currentDir, i, joinOf(simple), results);
    if (results.length === before) {
      const status = BUILTIN_GUARD_STATUS.get(bin);
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
  if (read === void 0 || nodePath2.resolve(ctx.cwd, read.path) !== absolutePath) {
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
function structuredKeyRanges(content, format, key2) {
  const escaped = key2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
function rejectStructuredPythonKeys() {
  return rejectPython("unsupported-expression", "structured Python mutation requires literal string keys");
}
function consumePythonStatement(statement, ctx) {
  const pathLiteral = matchGroups(statement, PYTHON_PATH_LITERAL_PATTERN, 2);
  if (pathLiteral !== null) {
    const [name, literal] = pathLiteral;
    const path = decodePythonString(literal);
    if (path === null) return rejectPython("unsupported-syntax", "Python path literal uses an unsupported escape");
    ctx.paths.set(name, { path, depth: 0 });
    return void 0;
  }
  const stringBinding = matchGroups(statement, PYTHON_STRING_BINDING_PATTERN, 2);
  if (stringBinding !== null) {
    const [name, literal] = stringBinding;
    const path = decodePythonString(literal);
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
    const literal = decodePythonString(literalText);
    if (literal === null || literal.length === 0 || !ctx.texts.has(source)) {
      return rejectPython("unsupported-dataflow", "Python count assertion is not tied to a direct text read");
    }
    ctx.countAssertions.set(`${source}\0${literal}`, Number.parseInt(countText, 10));
    return void 0;
  }
  const indexAnchor = matchGroups(statement, PYTHON_INDEX_ANCHOR_PATTERN, 3);
  if (indexAnchor !== null) {
    const [name, source, literalText] = indexAnchor;
    const literal = decodePythonString(literalText);
    if (literal === null || literal.length === 0 || !ctx.texts.has(source)) {
      return rejectPython("unsupported-dataflow", "Python index anchor is not tied to a direct text read");
    }
    ctx.anchors.set(name, { source, literal });
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
    const absolutePath = nodePath2.resolve(ctx.cwd, binding.path);
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
    const absolutePath = nodePath2.resolve(ctx.cwd, binding.path);
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
  if (anchor === void 0 || read === void 0 || anchor.source !== source || replacementText === null || Number.parseInt(anchorLengthText, 10) !== anchor.literal.length || nodePath2.resolve(ctx.cwd, read.path) !== absolutePath) {
    return rejectPython(
      "unsupported-dataflow",
      "Python slice reconstruction is not tied to one literal anchor",
      absolutePath
    );
  }
  const content = readPythonPreState(ctx, absolutePath, ["match-locations", "deleted-text"]);
  if (typeof content !== "string") return content;
  const offset = content.indexOf(anchor.literal);
  const [range] = literalOccurrenceRanges(content, anchor.literal);
  if (offset < 0 || range === void 0)
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
      expectedContent: `${content.slice(0, offset)}${replacementText}${content.slice(offset + anchor.literal.length)}`,
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
  if (nodePath2.resolve(ctx.cwd, array.path) !== absolutePath || array.edits.size === 0) {
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
  if (value === void 0 || value.format !== sinkFormat || nodePath2.resolve(ctx.cwd, value.path) !== absolutePath || value.keys.length === 0) {
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
  const literal = decodeNodeString(expression.trim());
  if (literal !== null) return { path: literal, depth: 0 };
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
  if (read === void 0 || nodePath2.resolve(ctx.cwd, read.path) !== absolutePath) {
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
    const [name, literal] = stringDecl;
    const path = decodeNodeString(literal);
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
    const literal = decodeNodeString(literalSource);
    if (literal === null || literal.length === 0 || !ctx.texts.has(textName)) {
      return rejectNode("unsupported-dataflow", "Node count guard is not tied to a direct text read");
    }
    ctx.countAssertions.set(`${textName}\0${literal}`, Number.parseInt(countText, 10));
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
    const absolutePath = nodePath2.resolve(ctx.cwd, binding.path);
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
    const absolutePath = nodePath2.resolve(ctx.cwd, binding.path);
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
  if (value === void 0 || nodePath2.resolve(ctx.cwd, value.path) !== absolutePath || value.keys.length === 0) {
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
  const absolutePath = nodePath2.resolve(cwd, file);
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
        absolutePath: `${nodePath2.resolve(cwd, file)}${patternCommand.backupSuffix}`,
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
  const absolutePath = nodePath2.resolve(cwd, file);
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
    if (stage === void 0) break;
    const child = parse(stage.text, options);
    const join11 = stage.precededBy === "and" ? "&&" : stage.precededBy === "or" ? "||" : void 0;
    resolved.push(
      ...child.resolved.map((match) => ({
        ...match,
        span: { ...match.span, simpleCommandIndex: index, join: join11 }
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
    fs3.mkdirSync(dir, { recursive: true, mode: 448 });
    fs3.chmodSync(layout.base, 448);
    fs3.chmodSync(nodePath2.dirname(dir), 448);
    fs3.chmodSync(dir, 448);
  };
  const claim = (consumed) => {
    try {
      fs3.writeFileSync(consumed, "", { encoding: "utf8", flag: "wx", mode: 384 });
      return true;
    } catch (error) {
      if (errnoCode(error) === "EEXIST") return false;
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
      raw = fs3.readFileSync(paths.record, "utf8");
    } catch (error) {
      if (errnoCode(error) === "ENOENT") return { status: "missing" };
      throw error;
    } finally {
      fs3.rmSync(paths.record, { force: true });
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
      if (fs3.existsSync(paths.consumed)) {
        throw new Error("planned-touch record has already been consumed or discarded");
      }
      const encoded = JSON.stringify(normalized);
      const tmp = nodePath2.join(
        paths.dir,
        `.${nodePath2.basename(paths.record)}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}.tmp`
      );
      try {
        fs3.writeFileSync(tmp, encoded, { encoding: "utf8", mode: 384 });
        fs3.chmodSync(tmp, 384);
        fs3.renameSync(tmp, paths.record);
      } catch (error) {
        fs3.rmSync(tmp, { force: true });
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
      fs3.rmSync(paths.record, { force: true });
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
  if (!nodePath2.isAbsolute(record2.repoRoot) && !/^[A-Za-z]:\//.test(repoRoot)) {
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
  const stdout = execFileSync3("git", ["-C", repoRoot, "ls-files", "-z", "--cached", "--", ...repoRelativePaths], {
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
    stdout = execFileSync3("git", ["-C", repoRoot, "check-ignore", "--no-index", "-z", "--stdin"], {
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
    const relativePath = nodePath2.relative(cwdRepoRoot, canonicalPath);
    if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${nodePath2.sep}`) || nodePath2.isAbsolute(relativePath)) {
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
import { execFileSync as execFileSync4 } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs4 from "node:fs";
import { basename as basename4, dirname as dirname4, join as join3 } from "node:path";

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
function insertAnchor(root, { dirs, leaf }, anchor) {
  let cur = root;
  for (const dir of dirs) {
    cur = findOrCreateDir(cur, dir);
  }
  cur.children.push({ kind: "leaf", name: leaf, anchor });
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

// packages/agent-hooks/src/common/touch-core.ts
function toNeedleLines(written) {
  if (written.length === 0) return [];
  const trimmed = written.endsWith("\n") ? written.slice(0, -1) : written;
  if (trimmed.length === 0) return [];
  return trimmed.split("\n");
}
function recoverRange2(written, onDiskContent) {
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
    fs4.statSync(absPath);
    return true;
  } catch {
    return false;
  }
}
function isFileOnDisk(absPath) {
  try {
    return fs4.statSync(absPath).isFile();
  } catch {
    return false;
  }
}
function contentMatches(post, filePath) {
  try {
    if ("exact" in post) return fs4.readFileSync(filePath, "utf8") === post.exact;
    if ("suffix" in post) {
      const content = fs4.readFileSync(filePath, "utf8");
      return content.endsWith(post.suffix) || content.endsWith(`${post.suffix}
`);
    }
    if ("empty" in post) return fs4.statSync(filePath).size === 0;
    return fs4.statSync(filePath).size === post.size;
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
          return execFileSync4("git", args, {
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
          if (rel.length > 0) real.add(join3(repoRoot, rel));
        }
      }
      const spanList = capture(["span", "list", "--porcelain", ...rels]);
      if (spanList !== null) {
        for (const row of parsePorcelain(spanList)) real.add(join3(repoRoot, row.path));
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
        const out = execFileSync4("git", ["status", "--porcelain", "-z", "--untracked-files=no", "--", ...rels], {
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
          changed.add(join3(repoRoot, entry.slice(3)));
        }
      } catch (err) {
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
        src = fs4.readFileSync(input.sourcePath, "utf8");
        dst = fs4.readFileSync(input.filePath, "utf8");
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
  const root = record(parsed, "context document");
  exactKeys(root, ["schema_version", "scopes", "mutation", "spans"], "context document");
  if (root.schema_version !== 1) throw new Error("unsupported context schema version");
  const scopes = arrayField(root.scopes, "context document.scopes").map((scope, index) => {
    const object = record(scope, `context document.scopes[${index}]`);
    exactKeys(object, ["path", "extent"], `context document.scopes[${index}]`);
    return {
      path: stringField(object.path, `context document.scopes[${index}].path`),
      extent: decodeExtent(object.extent, `context document.scopes[${index}].extent`)
    };
  });
  const mutationObject = record(root.mutation, "context document.mutation");
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
  const spans = arrayField(root.spans, "context document.spans").map((span, index) => {
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
    content = fs4.readFileSync(filePath, "utf8");
  } catch {
    return "whole-file";
  }
  return recoverRange2(written, content);
}
var DEFAULT_READ_LIMIT = 2e3;
function recoverReadRange(offset, limit, filePath) {
  if (offset === void 0 && limit === void 0) return "whole-file";
  const start = offset ?? 1;
  let lineCount2;
  try {
    const content = fs4.readFileSync(filePath, "utf8");
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
  const bytes = createHash("sha256").update(invocationId).update("\0").update(repoRoot).update("\0").update(addresses.join("\0")).digest();
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
      const probe = probeCache ?? createRealityProbeCache(input.targetState === "absent" ? [input.filePath] : []);
      const outcome = evaluateWriteGate(input, probe);
      if (outcome === "decisiveFail" || outcome === "inconclusive" && input.targetState === "absent") continue;
    }
    const repoRoot = resolveRepoRoot(dirname4(input.filePath));
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
var HOOK_CONTEXT_LOCK_WAIT_SECS = "1";
function createDefaultTouchExecutors(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const executors = {
    context: async (request) => {
      const started = performance.now();
      const args = ["span", "context", ...request.addresses, "--format", "json"];
      if (request.repair) args.push("--fix", "--operation-id", request.operationId);
      let stdout;
      try {
        stdout = execFileSync4("git", args, {
          cwd: request.repoRoot,
          env: { ...process.env, GIT_SPAN_LOCK_WAIT_SECS: HOOK_CONTEXT_LOCK_WAIT_SECS },
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

// packages/agent-hooks/src/common/apply-patch-touch.ts
var noRangeRecovery = () => null;
async function runApplyPatchTouches(patchText, cwd, sessionId, planned, executors, memo, invocationId, logger2) {
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
        sessionId,
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

// packages/agent-hooks/src/common/bash-attribution.ts
import { createHash as createHash2 } from "node:crypto";
import * as fs7 from "node:fs";
import * as nodePath5 from "node:path";

// packages/agent-hooks/src/common/span-surface.ts
import { execFileSync as execFileSync5 } from "node:child_process";
import * as fs6 from "node:fs";
import * as nodePath4 from "node:path";

// packages/agent-hooks/src/common/span-ignore.ts
import * as fs5 from "node:fs";
import * as nodePath3 from "node:path";
var HOOK_IGNORE_REL = nodePath3.join(".span", ".hookignore");

// packages/agent-hooks/src/common/span-surface.ts
function createDiskMemoStore(logger2, layout) {
  return {
    getSurfaced(sessionId) {
      pruneStaleSessionsThrottled(layout);
      try {
        const raw = fs6.readFileSync(layout.memoFile(sessionId), "utf8");
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
    addSurfaced(sessionId, names, known) {
      const existing = new Set(known);
      for (const n of names) existing.add(n);
      const memoDir = layout.dir(sessionId);
      const memoPath = layout.memoFile(sessionId);
      const tmpPath = `${memoPath}.tmp`;
      try {
        fs6.mkdirSync(memoDir, { recursive: true, mode: 448 });
        fs6.writeFileSync(tmpPath, JSON.stringify({ surfaced: [...existing] }), "utf8");
        fs6.renameSync(tmpPath, memoPath);
      } catch (err) {
        logger2.warn("memo write failed", { err });
      }
    }
  };
}
function resolveTouchScope(cwd, absPath) {
  const cwdRepoRoot = cwd ? resolveRepoRoot(cwd) : null;
  if (!cwdRepoRoot) return null;
  const absDir = toPosix(nodePath4.dirname(absPath));
  const fileRepoRoot = resolveRepoRoot(absDir);
  if (fileRepoRoot !== cwdRepoRoot) return null;
  const repoRoot = cwdRepoRoot;
  const repoRelPath = relativeToRepo(repoRoot, absPath);
  if (isGitIgnored(repoRoot, repoRelPath)) return null;
  const spanRoot = resolveSpanRoot(repoRoot);
  if (isInsideSpanRoot(repoRelPath, spanRoot)) return null;
  return { repoRoot, repoRelPath };
}

// packages/agent-hooks/src/common/bash-touch.ts
function bashSpanToTouch(span, sessionId, cwd, scopeAlreadyResolved = false) {
  if (!scopeAlreadyResolved && !resolveTouchScope(cwd, span.absolutePath)) return null;
  switch (span.operation) {
    case "read":
      return {
        kind: "read",
        sessionId,
        cwd,
        filePath: span.absolutePath,
        offset: span.lineStart,
        limit: span.lineStart !== void 0 && span.lineEnd !== void 0 ? span.lineEnd - span.lineStart + 1 : void 0
      };
    case "create-overwrite":
    case "rename-copy":
      return {
        kind: "write",
        sessionId,
        cwd,
        filePath: span.absolutePath,
        written: "",
        targetState: "exists",
        postState: span.written !== void 0 ? { content: { exact: span.written } } : void 0
      };
    case "truncate":
      return {
        kind: "write",
        sessionId,
        cwd,
        filePath: span.absolutePath,
        written: "",
        targetState: "exists",
        postState: span.size === 0 ? { content: { empty: true } } : span.size !== void 0 ? { content: { size: span.size } } : void 0
      };
    case "append":
      return {
        kind: "write",
        sessionId,
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
        sessionId,
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
        sessionId,
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
function translateAndGateSpans(groups, order, sessionId, cwd, scopeAlreadyResolved, probeCache) {
  const evals = /* @__PURE__ */ new Map();
  for (const idx of order) {
    const spans = groups.get(idx);
    if (spans === void 0) continue;
    const readPaths = spans.filter((m) => (m.idiom === "cp-write" || m.idiom === "install-write") && m.span.operation === "read").map((m) => m.span.absolutePath);
    const deletePaths = spans.filter((m) => m.span.operation === "delete").map((m) => m.span.absolutePath);
    let readCursor = 0;
    let deleteCursor = 0;
    const list = [];
    for (const m of spans) {
      const touch = bashSpanToTouch(m.span, sessionId, cwd, scopeAlreadyResolved);
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
      list.push(entry);
    }
    evals.set(idx, list);
  }
  return evals;
}
function buildPassByPath(evals, order) {
  const passByPath = /* @__PURE__ */ new Map();
  for (const idx of order) {
    const list = evals.get(idx);
    if (list === void 0) continue;
    for (const e of list) {
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
    const list = evals.get(idx);
    if (list === void 0) continue;
    for (const e of list) {
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
    const list = evals.get(idx);
    if (list === void 0) continue;
    for (const e of list) {
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
    const list = evals.get(idx);
    if (list === void 0) continue;
    for (const e of list) {
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
    const list = evals.get(idx);
    if (list === void 0) {
      const guard = guardByIndex.get(idx);
      computed.set(idx, guard !== void 0 ? guard.exitStatus === 0 ? "succeeded" : "failed" : "unknown");
      continue;
    }
    let failed = false;
    let passed = false;
    for (const e of list) {
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
    const join11 = joinOfCommand(idx, groups, guardByIndex);
    const prevVerdict = prevIndex !== null ? effective.get(prevIndex) : void 0;
    if (prevVerdict !== void 0 && join11 !== void 0) {
      if (join11 === "&&" && prevVerdict === "failed" || join11 === "||" && prevVerdict === "succeeded") {
        effective.set(idx, join11 === "&&" ? "failed" : "succeeded");
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
    const list = groups.get(idx);
    if (list !== void 0) {
      list.push(m);
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
      const list = fileProducingByPath.get(m.span.absolutePath);
      if (list !== void 0) list.push(m.span.simpleCommandIndex);
      else fileProducingByPath.set(m.span.absolutePath, [m.span.simpleCommandIndex]);
    }
  }
  const recreateProbePaths = [];
  for (const m of resolved) {
    if (m.span.operation !== "delete") continue;
    const later = (fileProducingByPath.get(m.span.absolutePath) ?? []).some((i) => i > m.span.simpleCommandIndex);
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
    const list = evals.get(idx);
    if (list === void 0) continue;
    for (const e of list) {
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
async function runBashTouches(matches, sessionId, cwd, toolResponse, executors, memo, warn = console.warn, scopeAlreadyResolved = false, reportDiagnostics = () => void 0, invocationId = null) {
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
  const evals = translateAndGateSpans(groups, commandOrder, sessionId, cwd, scopeAlreadyResolved, probeCache);
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
import { existsSync as existsSync4, statSync as statSync5 } from "node:fs";
import { dirname as dirname6, join as join5, resolve as resolvePath2, sep as sep2 } from "node:path";
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
  let i = start;
  while (i < argv.length) {
    const a = argv[i];
    if (a === void 0) break;
    if (a === "--") {
      positionals.push(...argv.slice(i + 1));
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
        i += 2;
        continue;
      }
      i += 1;
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
      i += consumesNext ? 2 : 1;
      continue;
    }
    positionals.push(a);
    i += 1;
  }
  const firstPositional = patternFromFlag ? 0 : 1;
  const pathArgs = positionals.length > firstPositional ? positionals.slice(firstPositional).filter((p) => !isPathspecMagic(p)) : [];
  const pathspecMagic = positionals.length > firstPositional && positionals.slice(firstPositional).some((p) => isPathspecMagic(p));
  return { pathArgs, contextFlags, numbered, withFilename, pathspecMagic, stdinRedirect };
}
function findGitSubcommand2(argv) {
  let dir = null;
  let dirUnresolvable = false;
  let i = 1;
  while (i < argv.length) {
    const a = argv[i];
    if (a === void 0) break;
    if (a === "-C") {
      const v = argv[i + 1];
      if (v === void 0) return null;
      if (hasShellExpansion2(v)) dirUnresolvable = true;
      else dir = v;
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
    return { dir, dirUnresolvable, subcommand: a, start: i + 1 };
  }
  return null;
}
function hasDiffPatchFlag(argv, start) {
  for (let i = start; i < argv.length; i++) {
    if (argv[i] === "-p" || argv[i] === "--patch") return true;
  }
  return false;
}
function hasRevPathArg(argv, start) {
  const valueFlags = /* @__PURE__ */ new Set(["--format", "--pretty", "--output", "--word-diff-regex"]);
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (a === void 0) break;
    if (a === "--") return false;
    if (a.startsWith("-") && a !== "-") {
      if (!a.includes("=") && valueFlags.has(a)) i += 1;
      continue;
    }
    if (a.includes(":")) return true;
  }
  return false;
}
function hasFlag(argv, start, flag) {
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
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
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (a === void 0) break;
    if (a === "--") return false;
    if (a.startsWith("-") && a !== "-") {
      if (!a.includes("=") && valueFlags.has(a)) i += 1;
      continue;
    }
    if (a.includes(":") && !existsSync4(resolvePath2(cwd, a))) return true;
  }
  return false;
}
function diffRelativeBase(argv, start, effectiveDir, repoRoot) {
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
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
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
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
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === void 0) break;
    if (a === "--") {
      for (let j = i + 1; j < argv.length; j++) {
        if (!patternFromFlag && !seenPattern) seenPattern = true;
        else return true;
      }
      return false;
    }
    if (a === "-e" || a === "-f" || a === "--regexp" || a === "--file") {
      patternFromFlag = true;
      i++;
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
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
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
        let current = null;
        for (const line of completeLines(stdout)) {
          if (line === "") continue;
          const rec = parseOneFileRecord(line);
          if (rec === null) {
            current = line;
          } else if (current !== null) {
            records.push({ path: current, line: rec.line, text: rec.text });
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
  for (const root of roots) {
    if (abs === root || abs.startsWith(root + sep2)) return true;
  }
  return false;
}
function isFile(abs) {
  try {
    return statSync5(abs).isFile();
  } catch {
    return false;
  }
}
function findGitRoot(startDir) {
  let dir = startDir;
  for (; ; ) {
    if (existsSync4(join5(dir, ".git"))) return dir;
    const parent = dirname6(dir);
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
  let current = null;
  for (const line of completeLines(stdout)) {
    const header = parseDiffHeader(line);
    if (header !== null) {
      current = {
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
    if (current === null) continue;
    if (line.startsWith("Binary files ")) {
      current.binary = true;
      continue;
    }
    const isBodyLine = line.startsWith(" ") || line.startsWith("+") || line.startsWith("-") || line.startsWith("\\");
    if (!isBodyLine && line.includes("mode 160000")) {
      current.submodule = true;
      continue;
    }
    if (line.includes("Subproject commit")) {
      current.submodule = true;
      continue;
    }
    if (line.startsWith("rename from ") || line.startsWith("rename to ") || line.startsWith("copy from ") || line.startsWith("copy to ")) {
      current.rename = true;
      continue;
    }
    if (!current.sawHunk) {
      const oldSide = parseDiffSide(line, "---");
      if (oldSide !== null) {
        if (oldSide.kind === "unparseable") current.unusable = true;
        else current.oldPath = oldSide.path;
        continue;
      }
      const newSide = parseDiffSide(line, "+++");
      if (newSide !== null) {
        if (newSide.kind === "unparseable") current.unusable = true;
        else current.newPath = newSide.path;
        continue;
      }
    }
    const hunk = HUNK_HEADER2.exec(line);
    if (hunk !== null) {
      current.sawHunk = true;
      emitHunkRange(perFile, current, hunk);
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
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (a === void 0) break;
    if (a === "--") {
      for (const [offset, arg] of argv.slice(i + 1).entries()) positionals.push({ arg, idx: i + 1 + offset });
      break;
    }
    if (a === "-L") {
      spec = argv[i + 1] ?? null;
      specIdx = i;
      i += 1;
      continue;
    }
    if (a.startsWith("-L")) {
      spec = a.slice(2);
      specIdx = i;
      continue;
    }
    if (a.startsWith("-")) continue;
    positionals.push({ arg: a, idx: i });
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
  for (let i = 0; i < parts.length; i++) {
    const simple = parts[i];
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
    for (const [j, sibling] of parts.entries()) {
      if (j === i) continue;
      if (j < i && parts.slice(j + 1, i + 1).every((part) => part.precededBy === "pipe")) continue;
      const siblingText = sibling.text;
      const siblingArgv = argvOf(siblingText);
      if (siblingArgv === null || siblingArgv.length === 0 || siblingArgv[0] === "cd") continue;
      if (hasUnquotedRedirect(siblingText)) return [];
      if (sibling.heredoc) return [];
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
    return fs7.readFileSync(path, "utf8");
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
      const digest = content === null ? null : createHash2("sha256").update(content).digest("hex");
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
async function runResponseReadTouches(spans, cwd, sessionId, executors, memo, invocationId, logger2) {
  const touches = spans.map(
    (span) => ({
      kind: "read",
      sessionId,
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
async function runLayeredBashTouches(command, cwd, sessionId, toolUseId, toolResponse, executors, memo, logger2, store) {
  const parserStarted = performance.now();
  const claimed = toolUseId === void 0 ? { status: "missing" } : store.take(sessionId, toolUseId);
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
  const invocationId = toolUseId === void 0 ? null : `${sessionId}:${toolUseId}`;
  const commandBlocks = await runBashTouches(
    filtered.matches,
    sessionId,
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
    sessionId,
    executors,
    memo,
    `${sessionId}:${toolUseId ?? createHash2("sha256").update(command).digest("hex")}:response`,
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

// packages/agent-hooks/src/common/commit-runtime.ts
import { randomBytes as randomBytes2 } from "node:crypto";
import { chmodSync as chmodSync2, existsSync as existsSync7, lstatSync as lstatSync3, readFileSync as readFileSync10, realpathSync as realpathSync3, rmSync as rmSync4, writeFileSync as writeFileSync4 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { isAbsolute as isAbsolute8, join as join9 } from "node:path";

// packages/agent-hooks/src/common/commit-association.ts
import { createHash as createHash3 } from "node:crypto";
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
  return createHash3("sha256").update(JSON.stringify([receipt.repository.commonDirectory, document.host, document.sessionId, receipt.sha])).digest("hex");
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
import { isAbsolute as isAbsolute4 } from "node:path";

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
  return text(value) && isAbsolute4(value);
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

// packages/agent-hooks/src/common/commit-git.ts
import { isAbsolute as isAbsolute5, resolve as resolve3 } from "node:path";

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
  existsSync as existsSync5,
  fstatSync,
  lstatSync,
  openSync as openSync2,
  readSync,
  realpathSync as realpathSync2
} from "node:fs";
import { delimiter, isAbsolute as isAbsolute6, join as join7, resolve as resolve4 } from "node:path";
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
import { createHash as createHash4, randomBytes } from "node:crypto";
import {
  closeSync as closeSync3,
  existsSync as existsSync6,
  linkSync,
  lstatSync as lstatSync2,
  mkdirSync as mkdirSync5,
  opendirSync,
  openSync as openSync3,
  readFileSync as readFileSync9,
  renameSync as renameSync4,
  rmSync as rmSync3,
  unlinkSync,
  writeFileSync as writeFileSync3
} from "node:fs";
import { dirname as dirname7, isAbsolute as isAbsolute7, join as join8 } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
function identityKey(identity) {
  return createHash4("sha256").update(JSON.stringify([identity.host, identity.sessionId, identity.toolUseId])).digest("hex");
}
function privateDirectory(path) {
  if (!isAbsolute7(path)) throw new Error("receipt state root must be absolute");
  mkdirSync5(path, { recursive: true, mode: 448 });
  const stat = lstatSync2(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 63) !== 0 || process.getuid && stat.uid !== process.getuid()) {
    throw new Error("receipt directory is not private");
  }
}
function readJson(path, maximumBytes = COMMIT_RECEIPT_LIMITS.jsonFileBytes) {
  const stat = lstatSync2(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumBytes)
    throw new Error("invalid bounded receipt file");
  const parsed = JSON.parse(readFileSync9(path, "utf8"));
  return parsed;
}
function atomicJson(path, value, immutable = false) {
  const temporary = join8(dirname7(path), `.publish-${randomBytes(16).toString("hex")}`);
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
async function acquireReceiptClaim(root, key2, deadline) {
  if (!/^[a-zA-Z0-9_-]+$/.test(key2)) throw new Error("invalid receipt claim key");
  const directory = join8(root, "claims");
  privateDirectory(directory);
  const path = join8(directory, `${key2}.json`);
  const guard = join8(directory, `${key2}.guard`);
  const owner = { token: randomBytes(16).toString("hex"), pid: process.pid };
  while (performance.now() < deadline) {
    let guarded = false;
    try {
      try {
        mkdirSync5(guard, { mode: 448 });
        guarded = true;
      } catch (error) {
        if (errnoCode(error) !== "EEXIST") throw error;
        return null;
      }
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
        return {
          owner,
          release: () => {
            let releaseGuard = false;
            try {
              mkdirSync5(guard, { mode: 448 });
              releaseGuard = true;
              const current = ownerRecord(readJson(path, 4096));
              if (current?.token !== owner.token || current.pid !== owner.pid)
                throw new Error("receipt claim ownership changed");
              unlinkSync(path);
            } finally {
              if (releaseGuard) rmSync3(guard, { recursive: true });
            }
          }
        };
      }
      if (decision === "refuse") return null;
    } finally {
      if (guarded) rmSync3(guard, { recursive: true });
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
    const path = join8(root, "usage.json");
    const usage = existsSync6(path) ? usageRecord(readJson(path, 4096)) : { invocations: 0, totalBytes: 0 };
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
async function terminalCommitInvocation(identity, options = {}, logger2) {
  const root = receiptRoot(options);
  const directory = join9(root, "invocations", identityKey(identity));
  const started = performance.now();
  let result = { original: null, acknowledged: 0, pending: 0 };
  if (!existsSync7(directory)) return result;
  try {
    const valid = validateCommitEnrollment(readJson(join9(directory, "enrollment.json")));
    if (!valid.ok) throw new Error(valid.reason);
    const original = restoreCommitInvocation(valid.value, identity);
    if (!original.ok) throw new Error(original.reason);
    const restored = { ...result, original: original.value };
    result = restored;
    try {
      const lease = readFileSync10(join9(directory, "lease"), "utf8");
      if (!/^[1-9][0-9]*$/.test(lease)) logger2?.warn("git-span commit receipts: invocation lease unavailable");
    } catch {
      logger2?.warn("git-span commit receipts: invocation lease unavailable");
    }
    const claim = await acquireReceiptClaim(
      root,
      `invocation-${identityKey(identity)}`,
      started + COMMIT_RECEIPT_LIMITS.drainMs
    );
    if (!claim) {
      logger2?.warn("git-span commit receipts: invocation drain ownership unavailable");
      return restored;
    }
    try {
      const state = readState(directory, valid.value);
      if (state.status === "retired") return restored;
      atomicJson(join9(directory, "state.json"), {
        ...state,
        status: "completed",
        liveLease: false,
        lastActivityMs: Date.now()
      });
      const drained = await drainDirectory(root, directory, valid.value, options, started, logger2);
      return { ...restored, ...drained };
    } finally {
      claim.release();
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
function readState(directory, enrollment) {
  const value = readJson(join9(directory, "state.json"));
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
  const usage = readJson(join9(directory, "usage.json"), 4096);
  if (!isRecord(usage) || typeof usage.bytes !== "number" || !Number.isSafeInteger(usage.bytes) || usage.bytes < 0 || typeof usage.receipts !== "number" || !Number.isSafeInteger(usage.receipts) || usage.receipts < 0)
    throw new Error("invalid invocation usage");
  return { bytes: usage.bytes, receipts: usage.receipts };
}
async function drainDirectory(root, directory, enrollment, options, started, logger2) {
  const deadline = started + COMMIT_RECEIPT_LIMITS.drainMs;
  let acknowledged = 0;
  const names = boundedEntries(join9(directory, "receipts"), COMMIT_RECEIPT_LIMITS.receiptsPerInvocation, deadline);
  for (const name of names) {
    if (performance.now() >= deadline) {
      logger2?.warn("git-span commit receipts: receipt drain deadline exhausted");
      break;
    }
    try {
      if (!/^receipt-[a-f0-9]+\.json$/.test(name)) throw new Error("invalid receipt filename");
      const valid = validateCommitReceipt(readJson(join9(directory, "receipts", name)), enrollment);
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
        const bytes = lstatSync3(join9(directory, "receipts", name)).size;
        rmSync4(join9(directory, "receipts", name));
        atomicJson(join9(directory, "usage.json"), {
          bytes: usage.bytes - bytes,
          receipts: Math.max(0, usage.receipts - 1)
        });
        await reserveReceiptCapacity(root, 0, -bytes, deadline);
        acknowledged++;
      } finally {
        association.release();
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
    liveLease: false,
    lastActivityMs: Date.now()
  });
  if (existsSync7(join9(directory, "diagnostics.json"))) {
    const diagnostics = readJson(join9(directory, "diagnostics.json"), 16384);
    if (Array.isArray(diagnostics)) {
      for (const message of diagnostics)
        if (typeof message === "string") logger2?.warn(`git-span commit receipts: ${message.slice(0, 512)}`);
    }
    rmSync4(join9(directory, "diagnostics.json"));
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

// packages/agent-hooks/src/codex/post-tool-use.ts
var APPLY_PATCH_SUCCESS_PREFIX = "Success. Updated the following files:";
function narrowApplyPatchCommand(toolInput) {
  return isRecord(toolInput) && typeof toolInput.command === "string" ? toolInput.command : null;
}
function narrowExecCommand(toolInput) {
  if (isRecord(toolInput)) {
    const args = toolInput.arguments;
    if (typeof args === "string") {
      try {
        const parsed = JSON.parse(args);
        if (isRecord(parsed) && typeof parsed.cmd === "string") {
          return { cmd: parsed.cmd, workdir: typeof parsed.workdir === "string" ? parsed.workdir : null };
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}
function quoteObjectKeys(literal) {
  let out = "";
  let index = 0;
  while (index < literal.length) {
    const character = literal[index];
    if (character === '"' || character === "'") {
      const quote = character;
      const start = index;
      index += 1;
      while (index < literal.length) {
        if (literal[index] === "\\" && index + 1 < literal.length) index += 2;
        else if (literal[index] === quote) {
          index += 1;
          break;
        } else index += 1;
      }
      out += literal.slice(start, index);
      continue;
    }
    const key2 = literal.slice(index).match(/^(\{|,)\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:/);
    if (key2 !== null) {
      out += `${key2[1]}"${key2[2]}":`;
      index += key2[0].length;
      continue;
    }
    out += character;
    index += 1;
  }
  return out;
}
function narrowCodeModeExec(toolInput) {
  if (isRecord(toolInput)) {
    const input = toolInput.input;
    if (typeof input === "string") {
      const match = input.match(/tools\.exec_command\(\s*(\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})\s*\)/);
      const objectLiteral = match?.[1];
      if (objectLiteral !== void 0) {
        try {
          const parsed = JSON.parse(quoteObjectKeys(objectLiteral));
          if (isRecord(parsed) && typeof parsed.cmd === "string") {
            return {
              matched: true,
              cmd: parsed.cmd,
              workdir: typeof parsed.workdir === "string" ? parsed.workdir : null
            };
          }
        } catch {
          return { matched: true, cmd: null, workdir: null };
        }
        return { matched: true, cmd: null, workdir: null };
      }
    }
  }
  return { matched: false, cmd: null, workdir: null };
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
  const options = { stateRoot: join10(dirname8(layout.base), "commit-receipts"), ...runtimeOptions };
  return async (input, ctx) => {
    let original = null;
    if (input.tool_name === "Bash" && input.session_id && input.tool_use_id) {
      try {
        original = (await terminalCommitInvocation(
          {
            host: "codex",
            sessionId: input.session_id,
            toolUseId: input.tool_use_id
          },
          options,
          ctx.logger
        )).original;
      } catch (err) {
        ctx.logger.warn("git-span terminal commit attribution failed", { err });
      }
    }
    const cwd = original?.cwd ?? input.cwd ?? "";
    const sessionId = input.session_id;
    const memo = memoFactory(ctx.logger, layout);
    if (["Bash", "shell", "local_shell", "exec_command", "exec"].includes(input.tool_name)) {
      let command2 = original?.command ?? extractShellCommand(input.tool_input);
      let workdir = null;
      if (command2 === null) {
        const classic = narrowExecCommand(input.tool_input);
        command2 = classic?.cmd ?? null;
        workdir = classic?.workdir ?? null;
      }
      if (command2 === null && input.tool_name === "exec") {
        const codeMode = narrowCodeModeExec(input.tool_input);
        if (codeMode.matched && codeMode.cmd === null) {
          ctx.logger.warn("Codex code-mode exec envelope matched but its command is not statically recoverable");
        }
        command2 = codeMode.cmd;
        workdir = codeMode.workdir;
      }
      if (command2 === null || command2.length === 0) return void 0;
      const effectiveCwd = resolveFrame(workdir ?? void 0, cwd);
      const blocks2 = await runLayeredBashTouches(
        command2,
        effectiveCwd,
        sessionId,
        input.tool_use_id,
        input.tool_response,
        executors,
        memo,
        ctx.logger,
        createDefaultPlannedTouchStore(layout)
      );
      if (blocks2.length === 0) return void 0;
      const shellCombined = blocks2.join("");
      return postToolUseOutput({ additionalContext: shellCombined, systemMessage: shellCombined });
    }
    const command = narrowApplyPatchCommand(input.tool_input);
    if (command === null) return void 0;
    const store = createDefaultPlannedTouchStore(layout);
    const planned = input.tool_use_id === void 0 ? { status: "missing" } : store.take(sessionId, input.tool_use_id);
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
      sessionId,
      plannedPatchCandidates(record2, cwd),
      executors,
      memo,
      input.tool_use_id === void 0 ? null : `${sessionId}:${input.tool_use_id}`,
      ctx.logger
    );
    if (blocks.length === 0) return void 0;
    const combined = blocks.join("");
    return postToolUseOutput({ additionalContext: combined, systemMessage: combined });
  };
}
disableUpdateCheck();
var post_tool_use_default = postToolUseHook(
  { matcher: "apply_patch|exec_command|exec|shell|local_shell|Bash", timeout: 15e3 },
  createHandler()
);

// packages/agent-hooks/src/codex/post-tool-use-entry.ts
execute(post_tool_use_default);

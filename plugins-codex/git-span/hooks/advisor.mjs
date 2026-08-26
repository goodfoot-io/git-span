#!/usr/bin/env -S node --enable-source-maps
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
function preToolUseOutput(options = {}) {
  const hasSpecific = options.additionalContext !== void 0 || options.permissionDecision !== void 0 || options.permissionDecisionReason !== void 0 || options.updatedInput !== void 0;
  const hookSpecificOutput = hasSpecific ? omitUndefined({
    hookEventName: "PreToolUse",
    additionalContext: options.additionalContext,
    permissionDecision: options.permissionDecision,
    permissionDecisionReason: options.permissionDecisionReason,
    updatedInput: options.updatedInput
  }) : void 0;
  return buildOutput("PreToolUse", {
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
    const normalize2 = (value) => {
      if (typeof value === "string") {
        return normalizeStringOutput(eventName, value);
      }
      return value;
    };
    return result instanceof Promise ? result.then(normalize2) : normalize2(result);
  };
  composed.eventName = hookFn.eventName ?? eventName;
  composed.matcher = hookFn.matcher;
  composed.timeout = hookFn.timeout;
  composed.unexpectedError = hookFn.unexpectedError;
  composed.onUnexpectedError = hookFn.onUnexpectedError;
  composed.createContext = hookFn.createContext;
  await drive(createCodexTransport(), composed);
}

// src/common/advisor-core.ts
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs4 from "node:fs";
import * as nodePath4 from "node:path";
import { promisify } from "node:util";

// src/common/advisor-ignore.ts
import * as fs2 from "node:fs";
import * as nodePath2 from "node:path";

// src/common/span-ignore.ts
import * as fs from "node:fs";
import * as nodePath from "node:path";
var HOOK_IGNORE_REL = nodePath.join(".span", ".hookignore");
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}
function ancestorPaths(path) {
  const parts = path.split("/");
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    out.push(parts.slice(0, i + 1).join("/"));
  }
  return out;
}
function compilePattern(pattern) {
  let pat = pattern;
  let dirOnly = false;
  if (pat.endsWith("/")) {
    dirOnly = true;
    pat = pat.slice(0, -1);
  }
  let anchored = pat.includes("/");
  if (pat.startsWith("/")) {
    anchored = true;
    pat = pat.slice(1);
  }
  const re = globToRegExp(pat);
  return (repoRelPath) => {
    if (anchored) {
      const segs = ancestorPaths(repoRelPath);
      const candidates2 = dirOnly ? segs.slice(0, -1) : segs;
      return candidates2.some((s) => re.test(s));
    }
    const components = repoRelPath.split("/");
    const candidates = dirOnly ? components.slice(0, -1) : components;
    return candidates.some((c) => re.test(c));
  };
}

// src/common/advisor-ignore.ts
var ADVISOR_IGNORE_REL = nodePath2.join(".span", ".advisorignore");
function parseAdvisorIgnore(content) {
  const rules = [];
  for (const rawLine of content.split("\n")) {
    const pattern = rawLine.trim();
    if (!pattern || pattern.startsWith("#")) continue;
    rules.push({ pattern, matches: compilePattern(pattern) });
  }
  return rules;
}
function loadAdvisorIgnore(repoRoot) {
  try {
    const content = fs2.readFileSync(nodePath2.join(repoRoot, ADVISOR_IGNORE_REL), "utf8");
    return parseAdvisorIgnore(content);
  } catch {
    return [];
  }
}
function isAdvisorIgnored(rules, repoRelPath) {
  return rules.some((rule) => rule.matches(repoRelPath));
}

// src/common/agent-hooks-common.ts
import { execFileSync } from "node:child_process";
import * as fs3 from "node:fs";
import * as os from "node:os";
import * as nodePath3 from "node:path";
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
    let current = fs3.realpathSync.native(dir);
    for (; ; ) {
      if (fs3.existsSync(nodePath3.join(current, ".git"))) return toPosix(current);
      const parent = nodePath3.dirname(current);
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
function isEnvironmentalStatus(status) {
  switch (status) {
    case "CONFLICT":
    case "SUBMODULE":
    case "LFS_NOT_FETCHED":
    case "LFS_NOT_INSTALLED":
    case "PROMISOR_MISSING":
    case "SPARSE_EXCLUDED":
    case "FILTER_FAILED":
    case "IO_ERROR":
      return true;
    default:
      return false;
  }
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
function createSessionLayout(base) {
  const dir = (sessionId) => nodePath3.join(base, sanitizeSessionId(sessionId));
  const plannedTouchesDir = (sessionId) => nodePath3.join(dir(sessionId), "planned-touches");
  const plannedTouchFile = (sessionId, toolUseId, suffix) => nodePath3.join(plannedTouchesDir(sessionId), `${sanitizeSessionId(toolUseId)}${suffix}`);
  return Object.freeze({
    base,
    trashDir: nodePath3.join(nodePath3.dirname(base), "session-trash"),
    dir,
    memoFile: (sessionId) => nodePath3.join(dir(sessionId), "touch-memo.json"),
    plannedTouchesDir,
    plannedTouchRecordFile: (sessionId, toolUseId) => plannedTouchFile(sessionId, toolUseId, ".json"),
    plannedTouchConsumedFile: (sessionId, toolUseId) => plannedTouchFile(sessionId, toolUseId, ".consumed")
  });
}
var DEFAULT_SESSION_LAYOUT = createSessionLayout(
  nodePath3.join(os.homedir(), ".cache", "git-span", "session")
);
var THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1e3;
var lastOpportunisticPruneAt = Number.NEGATIVE_INFINITY;
function resolveGitCommonDir(repoRoot) {
  const out = execFileSync("git", ["-C", repoRoot, "rev-parse", "--git-common-dir"], {
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8"
  });
  const trimmed = toPosix(out.trim());
  if (!nodePath3.isAbsolute(trimmed)) {
    return toPosix(nodePath3.resolve(repoRoot, trimmed));
  }
  return trimmed;
}
function queueRoot(repoRoot) {
  return nodePath3.join(resolveGitCommonDir(repoRoot), "git-span");
}
function advisorMemoDir(repoRoot) {
  return nodePath3.join(queueRoot(repoRoot), "advisor");
}
function indentBlockBody(text) {
  return text.split("\n").map((line) => line.length > 0 ? `  ${line}` : line).join("\n");
}

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

// src/common/mechanical-change.ts
function parseUnifiedDiff(text) {
  const files = [];
  let current = null;
  let hunk = null;
  const flushHunk = () => {
    if (current && hunk) current.hunks.push(hunk);
    hunk = null;
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flushHunk();
      if (current) files.push(current);
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      const path = m ? m[2] : line.slice(11);
      current = { path, hunks: [], binary: false, structural: false };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      current.binary = true;
      continue;
    }
    if (line.startsWith("new file mode") || line.startsWith("deleted file mode") || line.startsWith("rename from") || line.startsWith("rename to") || line.startsWith("old mode") || line.startsWith("new mode")) {
      current.structural = true;
      continue;
    }
    if (line.startsWith("index ")) continue;
    if (line.startsWith("@@")) {
      flushHunk();
      hunk = { removed: [], added: [] };
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith("-")) hunk.removed.push(line.slice(1));
    else if (line.startsWith("+")) hunk.added.push(line.slice(1));
  }
  flushHunk();
  if (current) files.push(current);
  return files;
}
var NOISE_BASENAMES = /* @__PURE__ */ new Set([
  "yarn.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "npm-shrinkwrap.json",
  "Cargo.lock",
  "poetry.lock",
  "Pipfile.lock",
  "go.sum",
  "composer.lock",
  "Gemfile.lock",
  "flake.lock",
  ".DS_Store"
]);
var NOISE_SUFFIXES = [
  ".tsbuildinfo",
  ".min.js",
  ".min.css",
  ".js.map",
  ".mjs.map",
  ".cjs.map",
  ".css.map",
  ".d.ts.map"
];
var NOISE_SEGMENTS = /* @__PURE__ */ new Set(["node_modules", "__pycache__"]);
function isNeverSpannedPath(repoRelPath) {
  const parts = repoRelPath.split("/");
  const base = parts[parts.length - 1] ?? "";
  if (NOISE_BASENAMES.has(base)) return true;
  if (NOISE_SUFFIXES.some((s) => repoRelPath.endsWith(s))) return true;
  if (parts.some((p) => NOISE_SEGMENTS.has(p))) return true;
  return false;
}
var SEMVER_RE = /\bv?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\b(?!\.\d)/g;
var HEXISH_RE = /\b[0-9a-f]{32,}\b|\bsha(?:256|512)-[A-Za-z0-9+/=]{20,}\b|\b[0-9a-f]{7,40}\/[0-9a-f]{7,40}\b/g;
var CHECKSUM_FIELD_RE = /\b(checksum|integrity|resolution|hash|digest|sha\d*)\b/i;
var DOTTED_QUAD_RE = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
var VERSION_CONTEXT_RES = [
  /version/i,
  /(?<![=!<>+\-*/&|])[:=](?!=)\s*["'`]?v?\d+\.\d+\.\d+/,
  /^\s*v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\s*$/,
  /^\.[A-Za-z]{1,3}\s/
];
var MANIFEST_BASENAMES = /* @__PURE__ */ new Set([
  "package.json",
  "Cargo.toml",
  "marketplace.json",
  "plugin.json",
  "pyproject.toml",
  "composer.json",
  "go.mod"
]);
var TIMESTAMP_FIELD_RE = /\b(timestamps?|generated|generated_?at|built|built_?at|build_?time|date|datetime|time|created_?at|updated_?at|modified|last_?modified|expires|expires_?at|expiry|epoch|mtime|ctime|iat|exp|nbf)(?:Ms|MS|_ms)?\b/i;
var TIMESTAMP_RE = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{10,13}\b/g;
function normalize(line, re) {
  return line.replace(re, " ");
}
function isVersionContext(line) {
  return VERSION_CONTEXT_RES.some((re) => re.test(line));
}
function isManifestPath(repoRelPath) {
  const parts = repoRelPath.split("/");
  return MANIFEST_BASENAMES.has(parts[parts.length - 1] ?? "");
}
function pairIsMechanical(removed, added, manifestPath) {
  if (removed === added) return false;
  if (!DOTTED_QUAD_RE.test(removed) && !DOTTED_QUAD_RE.test(added) && (manifestPath || isVersionContext(removed)) && normalize(removed, SEMVER_RE) === normalize(added, SEMVER_RE)) {
    return true;
  }
  if (CHECKSUM_FIELD_RE.test(removed) && normalize(removed, HEXISH_RE) === normalize(added, HEXISH_RE)) {
    return true;
  }
  if (TIMESTAMP_FIELD_RE.test(removed) && normalize(removed, TIMESTAMP_RE) === normalize(added, TIMESTAMP_RE)) {
    return true;
  }
  return false;
}
function isMechanicalDiff(file) {
  if (file.binary) return { mechanical: false, reason: "binary file" };
  if (file.structural) return { mechanical: false, reason: "structural change (rename/add/delete)" };
  if (file.hunks.length === 0) return { mechanical: false, reason: "no hunks" };
  const manifestPath = isManifestPath(file.path);
  for (let h = 0; h < file.hunks.length; h++) {
    const hunk = file.hunks[h];
    if (hunk.removed.length !== hunk.added.length || hunk.removed.length === 0) {
      return { mechanical: false, reason: `hunk ${h + 1}: unbalanced removed/added counts` };
    }
    for (let i = 0; i < hunk.removed.length; i++) {
      if (!pairIsMechanical(hunk.removed[i], hunk.added[i], manifestPath)) {
        return { mechanical: false, reason: `hunk ${h + 1}: no rule matched` };
      }
    }
  }
  return { mechanical: true };
}
var CLASSIFIABLE_BASENAMES = /* @__PURE__ */ new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "Cargo.toml",
  "Cargo.lock",
  "yarn.lock",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "plugin.json",
  "marketplace.json",
  "pyproject.toml",
  "composer.json",
  "composer.lock",
  "Gemfile.lock",
  "poetry.lock",
  "Pipfile.lock",
  "flake.lock",
  "go.mod",
  "go.sum"
]);
var MAN_PAGE_RE = /\.[1-9]$/;
function isClassifiablePath(repoRelPath) {
  const parts = repoRelPath.split("/");
  const base = parts[parts.length - 1] ?? "";
  if (CLASSIFIABLE_BASENAMES.has(base)) return true;
  if (base === "Dockerfile" || base.startsWith("Dockerfile.")) return true;
  return MAN_PAGE_RE.test(base);
}
function classifyMechanical(file) {
  if (isNeverSpannedPath(file.path)) return { mechanical: true };
  if (!isClassifiablePath(file.path)) {
    return { mechanical: false, reason: "not a manifest-shaped path: the classifier does not apply" };
  }
  return isMechanicalDiff(file);
}

// src/common/advisor-core.ts
var AdvisorScanError = class extends Error {
  detail;
  constructor(detail) {
    super(`git span drift could not complete its scan: ${detail}`);
    this.name = "AdvisorScanError";
    this.detail = detail;
  }
};
var AdvisorIncompatibleCliError = class extends Error {
  detail;
  installedVersion;
  constructor(detail, installedVersion) {
    super(`the installed git-span binary does not support this command: ${detail}`);
    this.name = "AdvisorIncompatibleCliError";
    this.detail = detail;
    this.installedVersion = installedVersion;
  }
};
var AdvisorDeadlineError = class extends Error {
  budgetMs;
  constructor(budgetMs) {
    super(`advisor evaluation exceeded its ${budgetMs} ms budget`);
    this.name = "AdvisorDeadlineError";
    this.budgetMs = budgetMs;
  }
};
function parseGitCommand(command) {
  for (const segment of splitSegments2(command)) {
    const inv = matchGitInvocation(tokenize(segment));
    if (!inv) continue;
    if (inv.subcommand === "commit") {
      const dashDash = inv.args.indexOf("--");
      const paths = dashDash >= 0 ? inv.args.slice(dashDash + 1).filter((p) => p.length > 0) : [];
      return paths.length > 0 ? { kind: "commit", paths } : { kind: "commit" };
    }
    if (inv.subcommand === "push") {
      return { kind: "push" };
    }
    if (inv.subcommand === "status") {
      return { kind: "status" };
    }
  }
  return { kind: "none" };
}
var COMMIT_VALUE_OPTIONS = /* @__PURE__ */ new Set([
  "-m",
  "--message",
  "-F",
  "--file",
  "-C",
  "--reuse-message",
  "-c",
  "--reedit-message",
  "--author",
  "--date",
  "-t",
  "--template",
  "--fixup",
  "--squash",
  "--trailer",
  "--cleanup",
  "--gpg-sign"
]);
function commitStagesAll(command) {
  for (const segment of splitSegments2(command)) {
    const inv = matchGitInvocation(tokenize(segment));
    if (inv?.subcommand !== "commit") continue;
    const dashDash = inv.args.indexOf("--");
    const flagArgs = dashDash >= 0 ? inv.args.slice(0, dashDash) : inv.args;
    for (let i = 0; i < flagArgs.length; i++) {
      const arg = flagArgs[i];
      if (arg === "--all") return true;
      if (COMMIT_VALUE_OPTIONS.has(arg)) {
        i++;
        continue;
      }
      if (!arg.startsWith("--") && /^-[A-Za-z]*a[A-Za-z]*$/.test(arg)) return true;
    }
    return false;
  }
  return false;
}
var TWO_CHAR_OPERATORS = /* @__PURE__ */ new Set(["&&", "||"]);
var ONE_CHAR_SEPARATORS = /* @__PURE__ */ new Set([";", "|", "\n", "&", "(", ")"]);
function splitSegments2(command) {
  const segments = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (TWO_CHAR_OPERATORS.has(command.slice(i, i + 2))) {
      segments.push(current);
      current = "";
      i++;
      continue;
    }
    if (ONE_CHAR_SEPARATORS.has(ch)) {
      segments.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments;
}
function tokenize(segment) {
  const tokens = [];
  let current = "";
  let has = false;
  let quote = null;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      has = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (ch === " " || ch === "	") {
      if (has) {
        tokens.push(current);
        current = "";
        has = false;
      }
      continue;
    }
    current += ch;
    has = true;
  }
  if (has) tokens.push(current);
  return tokens;
}
var GIT_VALUE_OPTIONS = /* @__PURE__ */ new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--super-prefix",
  "--exec-path",
  "--attr-source",
  "--config-env"
]);
function matchGitInvocation(tokens) {
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
  if (i >= tokens.length || tokens[i] !== "git") return null;
  i++;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "--") return null;
    if (!t.startsWith("-")) break;
    i += GIT_VALUE_OPTIONS.has(t) ? 2 : 1;
  }
  if (i >= tokens.length) return null;
  return { subcommand: tokens[i], args: tokens.slice(i + 1) };
}
async function resolveChangesetUnfiltered(kind, all, cwd, git, paths) {
  if (kind === "push") {
    const { paths: outgoing, base } = await git.outgoingPaths(cwd);
    return { paths: outgoing, range: base === null ? { kind: "unresolvable" } : { kind: "commits", base } };
  }
  if (kind === "status") {
    const [staged2, tracked2] = await Promise.all([git.stagedPaths(cwd), git.trackedModifiedPaths(cwd)]);
    return { paths: mergeUniquePaths(staged2, tracked2), range: { kind: "worktree" } };
  }
  if (paths && paths.length > 0) {
    return { paths: await git.pathspecPaths(paths, cwd), range: { kind: "worktree" } };
  }
  const staged = await git.stagedPaths(cwd);
  if (!all) return { paths: staged, range: { kind: "staged" } };
  const tracked = await git.trackedModifiedPaths(cwd);
  return { paths: mergeUniquePaths(staged, tracked), range: { kind: "worktree" } };
}
async function resolveChangeset(kind, all, cwd, git, paths) {
  const changeset = await resolveChangesetUnfiltered(kind, all, cwd, git, paths);
  const repoRoot = resolveRepoRoot(cwd);
  if (!repoRoot || changeset.paths.length === 0) return changeset;
  return { ...changeset, paths: changeset.paths.filter((p) => fs4.existsSync(nodePath4.join(repoRoot, p))) };
}
function mergeUniquePaths(...groups) {
  const seen = /* @__PURE__ */ new Set();
  const merged = [];
  for (const group of groups) {
    for (const path of group) {
      if (seen.has(path)) continue;
      seen.add(path);
      merged.push(path);
    }
  }
  return merged;
}
async function evaluateAdvisor(paths, cwd, executors, memoState, mode = "may-hold", churn, harness = "generic", deadlineMs = EVALUATION_DEADLINE_MS, logger2) {
  if (paths.length === 0) return { decision: "allow", kind: "silent" };
  const controller = new AbortController();
  const { signal } = controller;
  let timer;
  try {
    const evaluation = (async () => {
      try {
        if (mode === "may-hold") {
          await executors.fix(paths, cwd, signal);
        }
        const driftRows = await executors.drift(paths, cwd, signal);
        const debtRows = driftRows.filter((row) => isDebt(row.status));
        const semantic = debtRows.filter((row) => !isEnvironmentalStatus(row.status));
        const environmental = debtRows.filter((row) => isEnvironmentalStatus(row.status));
        if (mode === "report-only") {
          if (semantic.length > 0) {
            memoState.record(`seen-${advisorStateDigest(semantic, [])}`);
            const newSemantic = filterNewReportItems(semantic, memoState, semanticReportIdentity);
            if (newSemantic.length === 0) return { decision: "allow", kind: "silent" };
            return {
              decision: "allow",
              kind: "semantic-drift-report",
              findings: newSemantic,
              ...renderDriftReason(
                newSemantic,
                await fetchSpanBlocks(executors, newSemantic, cwd, signal),
                "report-only",
                harness
              )
            };
          }
          if (environmental.length > 0) {
            return {
              decision: "allow",
              kind: "environmental",
              conditions: environmental,
              reason: renderEnvironmentalReason(
                environmental,
                await fetchSpanBlocks(executors, environmental, cwd, signal)
              )
            };
          }
          const { uncovered: uncovered2, covering: covering2 } = await computeUncoveredPaths(paths, cwd, executors, churn, signal);
          if (uncovered2.length === 0) return { decision: "allow", kind: "silent" };
          memoState.record(`seen-${advisorStateDigest([], uncovered2)}`);
          const newUncovered = filterNewReportItems(uncovered2, memoState, uncoveredReportIdentity);
          if (newUncovered.length === 0) return { decision: "allow", kind: "silent" };
          return {
            decision: "allow",
            kind: "uncovered-writes-report",
            uncovered: newUncovered,
            ...renderUncoveredReason(
              newUncovered,
              covering2,
              await fetchSpanBlocks(executors, covering2, cwd, signal),
              "report-only",
              harness
            )
          };
        }
        let semanticAlreadyPresented = false;
        if (semantic.length > 0) {
          const semanticDigest = advisorStateDigest(semantic, []);
          if (memoState.has(semanticDigest)) {
            semanticAlreadyPresented = true;
          } else if (memoState.has(`seen-${semanticDigest}`)) {
            memoState.record(semanticDigest);
            semanticAlreadyPresented = true;
          } else {
            if (!memoState.record(semanticDigest)) return { decision: "allow", kind: "silent" };
            memoState.record(`seen-${semanticDigest}`);
            return {
              decision: "hold",
              kind: "semantic-drift",
              findings: semantic,
              ...renderDriftReason(
                semantic,
                await fetchSpanBlocks(executors, semantic, cwd, signal),
                "may-hold",
                harness
              )
            };
          }
        }
        if (environmental.length > 0) {
          return {
            decision: "allow",
            kind: "environmental",
            conditions: environmental,
            reason: renderEnvironmentalReason(
              environmental,
              await fetchSpanBlocks(executors, environmental, cwd, signal)
            )
          };
        }
        const { uncovered, covering } = await computeUncoveredPaths(paths, cwd, executors, churn, signal);
        if (uncovered.length === 0) {
          return semanticAlreadyPresented ? { decision: "allow", kind: "already-presented" } : { decision: "allow", kind: "silent" };
        }
        const digest = advisorStateDigest([], uncovered);
        if (memoState.has(digest)) return { decision: "allow", kind: "already-presented" };
        if (memoState.has(`seen-${digest}`)) {
          memoState.record(digest);
          return { decision: "allow", kind: "already-presented" };
        }
        if (!memoState.record(digest)) return { decision: "allow", kind: "silent" };
        memoState.record(`seen-${digest}`);
        return {
          decision: "hold",
          kind: "uncovered-writes",
          uncovered,
          ...renderUncoveredReason(
            uncovered,
            covering,
            await fetchSpanBlocks(executors, covering, cwd, signal),
            "may-hold",
            harness
          )
        };
      } catch (err) {
        if (controller.signal.aborted) throw new AdvisorDeadlineError(deadlineMs);
        if (err instanceof AdvisorIncompatibleCliError) {
          return {
            decision: "allow",
            kind: "scan-failed",
            cause: "incompatible-cli",
            reason: renderIncompatibleCliReason(err)
          };
        }
        if (err instanceof AdvisorScanError) {
          return {
            decision: "allow",
            kind: "scan-failed",
            cause: "aborted",
            reason: renderScanFailedReason(err.detail)
          };
        }
        logger2?.warn("git-span advisor evaluation failed open on an unexpected error", { err });
        return { decision: "allow", kind: "silent" };
      }
    })();
    const expiry = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new AdvisorDeadlineError(deadlineMs));
      }, deadlineMs);
    });
    return await Promise.race([evaluation, expiry]);
  } catch (err) {
    if (err instanceof AdvisorDeadlineError) {
      return {
        decision: "allow",
        kind: "scan-failed",
        cause: "deadline-exceeded",
        reason: renderDeadlineExceededReason(err.budgetMs)
      };
    }
    throw err;
  } finally {
    if (timer !== void 0) clearTimeout(timer);
    controller.abort();
  }
}
async function computeUncoveredPaths(paths, cwd, executors, churn, signal) {
  if (paths.length < 2) return { uncovered: [], covering: [] };
  const changeset = new Set(paths);
  const covering = (await executors.list(paths, cwd, signal)).filter((row) => changeset.has(row.path));
  const covered = new Set(covering.map((row) => row.path));
  const repoRoot = resolveRepoRoot(cwd);
  const advisorIgnoreRules = repoRoot ? loadAdvisorIgnore(repoRoot) : [];
  const spanRoot = repoRoot === null ? SPAN_ROOT : resolveSpanRoot(repoRoot);
  let uncovered = paths.filter(
    (path) => !covered.has(path) && !isInsideSpanRoot(path, spanRoot) && !isAdvisorIgnored(advisorIgnoreRules, path)
  );
  if (churn && uncovered.length > 0) {
    const before = uncovered.length;
    uncovered = uncovered.filter((path) => !isNeverSpannedPath(path));
    const suppressedByPath = before - uncovered.length;
    const needsContent = uncovered.filter(isClassifiablePath);
    const byPath = /* @__PURE__ */ new Map();
    let readOutcome = needsContent.length > 0 ? "clean" : "skipped";
    if (needsContent.length > 0) {
      try {
        for (const file of await churn.git.changedHunks(needsContent, churn.range, cwd, signal)) {
          byPath.set(file.path, file);
        }
      } catch {
        readOutcome = "failed";
      }
      const missing = needsContent.filter((path) => !byPath.has(path));
      if (missing.length > 0) {
        if (readOutcome === "clean") readOutcome = "per-file-fallback";
        for (const path of missing) {
          try {
            for (const file of await churn.git.changedHunks([path], churn.range, cwd, signal)) {
              byPath.set(file.path, file);
            }
          } catch {
            readOutcome = "failed";
          }
        }
      }
      uncovered = uncovered.filter((path) => {
        const file = byPath.get(path);
        if (!file) return true;
        return !classifyMechanical(file).mechanical;
      });
    }
    churn.logger?.info?.("git-span advisor churn suppression", {
      candidates: before,
      suppressedByPath,
      suppressedByContent: before - suppressedByPath - uncovered.length,
      reported: uncovered.length,
      read: readOutcome
    });
  }
  return { uncovered, covering };
}
function anchorText(row) {
  if (row.start === 0 && row.end === 0) return row.path;
  return `${row.path}#L${row.start}-L${row.end}`;
}
function advisorStateDigest(findings, uncovered) {
  const findingKeys = findings.map((row) => `${row.status}	${row.name}	${row.path}	${row.start}	${row.end}`).sort();
  const payload = JSON.stringify({ findings: findingKeys, uncovered: [...uncovered].sort() });
  return createHash("sha256").update(payload).digest("hex");
}
function reportItemKey(identity) {
  return `report-${createHash("sha256").update(identity).digest("hex")}`;
}
function semanticReportIdentity(row) {
  return JSON.stringify({ kind: "semantic", path: row.path, name: row.name });
}
function uncoveredReportIdentity(path) {
  return JSON.stringify({ kind: "uncovered", path });
}
function filterNewReportItems(items, memoState, identityOf) {
  const unseen = /* @__PURE__ */ new Set();
  for (const item of items) {
    const identity = identityOf(item);
    if (!memoState.has(reportItemKey(identity))) unseen.add(identity);
  }
  for (const identity of unseen) memoState.record(reportItemKey(identity));
  return items.filter((item) => unseen.has(identityOf(item)));
}
async function fetchSpanBlocks(executors, rows, cwd, signal) {
  const names = [...new Set(rows.map((row) => row.name))].sort();
  if (names.length === 0) return "";
  try {
    return await executors.listBlocks(names, cwd, signal);
  } catch {
    return "";
  }
}
function extractWhy(blocksText, name) {
  const trimmed = blocksText.trim();
  if (trimmed.length === 0) return "";
  for (const block of trimmed.split("\n\n---\n\n")) {
    const lines = block.split("\n");
    if (lines[0] !== `## ${name}`) continue;
    let i = 1;
    while (i < lines.length && (lines[i].startsWith("- ") || lines[i] === "*Span has no anchors*")) i++;
    if (lines[i] === "") i++;
    return lines.slice(i).join("\n").trim();
  }
  return "";
}
function dedupeByAnchor(rows) {
  const order = [];
  const byAddr = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const addr = anchorText(row);
    let statuses = byAddr.get(addr);
    if (!statuses) {
      statuses = /* @__PURE__ */ new Set();
      byAddr.set(addr, statuses);
      order.push(addr);
    }
    statuses.add(row.status);
  }
  return order.map((addr) => ({ addr, statuses: [...byAddr.get(addr) ?? []].sort() }));
}
function rangeLabel(row) {
  if (row.start === 0 && row.end === 0) return { kind: "whole-file" };
  return { kind: "range", start: row.start, end: row.end };
}
var BULLET_RANGE = /^(.+)#L(\d+)-L(\d+)$/;
function parseAnchorAddr(addr, suffix) {
  const matched = BULLET_RANGE.exec(addr);
  if (matched) {
    return { path: matched[1], range: { kind: "range", start: Number(matched[2]), end: Number(matched[3]) }, suffix };
  }
  const fragment = addr.indexOf("#L");
  if (fragment === -1) return { path: addr, range: { kind: "whole-file" }, suffix };
  return { path: addr.slice(0, fragment), range: { kind: "truncated" }, suffix };
}
function renderAnchorRun(rows, flat) {
  try {
    return renderAnchorTree(collapseByPath(rows));
  } catch {
    return flat;
  }
}
function annotateBulletRun(bulletLines, pending) {
  const addrs = bulletLines.map((line) => line.slice(2));
  const paths = addrs.map((addr) => addr.split("#")[0]);
  const claimed = addrs.map(() => []);
  const used = /* @__PURE__ */ new Set();
  const claim = (index, matches) => {
    for (const row of pending) {
      if (used.has(row) || !matches(row)) continue;
      claimed[index].push(row);
      used.add(row);
    }
  };
  for (const [i, addr] of addrs.entries()) {
    claim(i, (row) => anchorText(row) === addr);
  }
  for (const [i, addr] of addrs.entries()) {
    if (paths.filter((path) => path === paths[i]).length !== 1) continue;
    claim(i, (row) => addr === row.path || addr.startsWith(`${row.path}#`));
  }
  const entries = addrs.map((addr, i) => {
    const rows = claimed[i];
    if (rows.length === 0) return { addr, suffix: "" };
    const statuses = [...new Set(rows.map((row) => row.status))].sort();
    return { addr, suffix: ` \u2014 ${statuses.map(humanStatusLabel).join(", ")}` };
  });
  for (const { addr, statuses } of dedupeByAnchor(pending.filter((row) => !used.has(row)))) {
    entries.push({ addr, suffix: ` \u2014 ${statuses.map(humanStatusLabel).join(", ")}` });
  }
  return entries;
}
function annotateBlocks(blocksText, rows) {
  const remaining = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const group = remaining.get(row.name);
    if (group) group.push(row);
    else remaining.set(row.name, [row]);
  }
  const out = [];
  let pending = [];
  let bullets = [];
  let inBullets = false;
  let runRows = [];
  let runFlat = [];
  const collect = (addr, suffix) => {
    runFlat.push(`- ${addr}${suffix}`);
    runRows.push(parseAnchorAddr(addr, suffix));
  };
  const closeBullets = () => {
    for (const { addr, suffix } of annotateBulletRun(bullets, pending)) {
      collect(addr, suffix);
    }
    if (runRows.length > 0) out.push(...renderAnchorRun(runRows, runFlat));
    bullets = [];
    pending = [];
    runRows = [];
    runFlat = [];
    inBullets = false;
  };
  const trimmed = blocksText.trim();
  if (trimmed.length > 0) {
    for (const line of trimmed.split("\n")) {
      const header = /^## (.+)$/.exec(line);
      if (header) {
        closeBullets();
        out.push(line);
        pending = remaining.get(header[1]) ?? [];
        remaining.delete(header[1]);
        inBullets = true;
        continue;
      }
      if (inBullets && line.startsWith("- ")) {
        bullets.push(line);
        continue;
      }
      if (inBullets) closeBullets();
      out.push(line);
    }
    closeBullets();
  }
  for (const [name, group] of remaining) {
    if (out.length > 0) out.push("", "---", "");
    out.push(`## ${name}`);
    const rows2 = [];
    const flat = [];
    for (const { addr, statuses } of dedupeByAnchor(group)) {
      const suffix = ` \u2014 ${statuses.map(humanStatusLabel).join(", ")}`;
      flat.push(`- ${addr}${suffix}`);
      rows2.push(parseAnchorAddr(addr, suffix));
    }
    out.push(...renderAnchorRun(rows2, flat));
  }
  return out.join("\n");
}
function renderDriftReason(findings, blocksText, mode = "may-hold", harness = "generic") {
  const names = [...new Set(findings.map((row) => row.name))];
  const subject = names.length === 1 ? "an implicit dependency" : "implicit dependencies";
  const name = names.length === 1 ? names[0] : "<name>";
  const action = `preserve anchor shape; if an address changed, swap the old anchor for the new one with \`git span replace\`; update or retire the why only if its meaning changed; require \`git span drift ${name}\` to report zero`;
  const inline = harness === "generic";
  const lead = inline ? "Bring the coupled files back into agreement (follow confirmed authority)" : harness === "claude" ? "Dispatch a forked subagent to bring the coupled files back into agreement (follow confirmed authority)" : harness === "codex" ? 'Spawn a forked subagent with `spawn_agent`, setting `fork_turns: "all"`, to bring the coupled files back into agreement (follow confirmed authority)' : "Dispatch a subagent with the `task` tool to bring the coupled files back into agreement (follow confirmed authority)";
  const skillLine = harness === "opencode" ? "Load the `reconcile` skill via the skill tool in the subagent." : "Load the `git-span:reconcile` skill in the fork.";
  const tail = inline ? mode === "may-hold" ? `then reconcile: ${action}. Retry the command; the hold will not fire again for the same debt state. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete dependency.` : `then reconcile: ${action}. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete dependency.` : mode === "may-hold" ? `\u2014 ${action}. Then retry. ${skillLine} The hold will not fire again for the same debt state. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete dependency.` : `\u2014 ${action}. ${skillLine} Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete dependency.`;
  const closing = `${lead}${inline ? "," : ""} ${tail}`;
  return {
    reason: [
      `This change leaves ${subject} out of date:`,
      "",
      annotateBlocks(blocksText, findings),
      "",
      "---",
      "",
      closing
    ].join("\n")
  };
}
function wrapGitSpanContext(text) {
  if (text.includes("<git-span>")) return text;
  return `<git-span>
${text}
</git-span>`;
}
function renderEnvironmentalReason(conditions, blocksText) {
  return [
    "Could not check these implicit dependencies (unfetched LFS, sparse checkout, or similar) \u2014 not blocking:",
    "",
    annotateBlocks(blocksText, conditions),
    "",
    "---",
    "",
    "Fix the checkout/fetch issue if these dependencies need verifying."
  ].join("\n");
}
function renderDeadlineExceededReason(budgetMs) {
  return [
    `The implicit-dependency check exceeded its ${budgetMs} ms time budget, so this change was NOT verified:`,
    "<git-span-error>",
    indentBlockBody("a git or git-span subprocess did not finish in time; the scan was abandoned mid-flight"),
    "</git-span-error>",
    "",
    "The command proceeds anyway. Run `git span drift --format porcelain` manually if verification matters for this change."
  ].join("\n");
}
function renderScanFailedReason(detail) {
  return [
    "The implicit-dependency check could not run, so this change was NOT verified:",
    "<git-span-error>",
    indentBlockBody(detail),
    "</git-span-error>",
    "",
    "The command proceeds anyway. Fix the scan error if verification matters for this change."
  ].join("\n");
}
function renderIncompatibleCliReason(err) {
  const installed = err.installedVersion;
  const lagging = installed !== null && !isOlderThan(installed, REQUIRED_GIT_SPAN_VERSION) ? (
    // Binary is at or past what this plugin was built against, yet it
    // rejected the command — the plugin is the stale artifact.
    "the git-span plugin is older than the binary and is still issuing a retired command"
  ) : "the git-span binary is older than the plugin and does not know this command yet";
  return [
    "The implicit-dependency check could not run, so this change was NOT verified.",
    "",
    `The installed git-span binary reports ${installed ?? "no readable version"}; this plugin`,
    `expects ${REQUIRED_GIT_SPAN_VERSION} or compatible. They install through separate channels, so`,
    `they can drift apart \u2014 here, ${lagging}.`,
    "",
    "Bring them back in line, then retry:",
    "",
    "    npm install -g git-span@latest    # upgrade the binary",
    "    # and update the git-span plugin from the marketplace",
    "",
    "The command proceeds anyway. Nothing is wrong with this repository \u2014 but until",
    "the two are aligned, span drift is not being checked and spans are not being",
    "auto-reanchored on edit.",
    "",
    "<git-span-error>",
    indentBlockBody(`git-span reported: ${err.detail}`),
    "</git-span-error>"
  ].join("\n");
}
var RELATED_SPANS_CAP = 8;
function dirParts(path) {
  const parts = path.split("/");
  parts.pop();
  return parts;
}
function pathProximity(a, b) {
  const x = dirParts(a);
  const y = dirParts(b);
  let shared = 0;
  while (shared < x.length && shared < y.length && x[shared] === y[shared]) shared++;
  const deepest = Math.max(x.length, y.length);
  if (deepest === 0) return 0;
  return shared / deepest;
}
function groupCoveringByName(covering, uncovered) {
  const byName = /* @__PURE__ */ new Map();
  for (const row of covering) {
    const group = byName.get(row.name) ?? { anchors: /* @__PURE__ */ new Map(), paths: /* @__PURE__ */ new Set() };
    const addr = anchorText(row);
    if (!group.anchors.has(addr)) group.anchors.set(addr, row);
    group.paths.add(row.path);
    byName.set(row.name, group);
  }
  return [...byName.entries()].map(([name, group]) => {
    let proximity = 0;
    for (const path of group.paths) {
      for (const target of uncovered) proximity = Math.max(proximity, pathProximity(path, target));
    }
    return {
      name,
      // The determinism tie-break this section has always had, preserved
      // exactly: codepoint order over the anchor's `path#Lstart-Lend`
      // address, matching the plain `[...set].sort()` this replaced. The
      // tree renderer never re-sorts sibling paths, so it lays out whatever
      // order arrives here — which is why this sort must stay.
      anchors: [...group.anchors.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, row]) => row),
      coOccurrence: group.paths.size,
      proximity
    };
  }).sort(
    (a, b) => b.coOccurrence - a.coOccurrence || b.proximity - a.proximity || // Codepoint order, matching the plain `.sort()` this key replaced —
    // `localeCompare` would make the tie-break locale-dependent, and the
    // whole point of this key is that it is not.
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  ).map(({ name, anchors }) => ({ name, anchors }));
}
function renderRelatedSpansSection(covering, uncovered, coveringBlocksText) {
  if (covering.length === 0) return [];
  const lines = [
    "",
    "---",
    "",
    "Other files in this change already belong to spans \u2014 an uncovered file above might belong with one of these instead of a new one:"
  ];
  const groups = groupCoveringByName(covering, uncovered);
  for (const { name, anchors } of groups.slice(0, RELATED_SPANS_CAP)) {
    const rows = anchors.map((anchor) => ({ path: anchor.path, range: rangeLabel(anchor), suffix: "" }));
    lines.push(
      "",
      `## ${name}`,
      ...renderAnchorRun(
        rows,
        anchors.map((anchor) => `- ${anchorText(anchor)}`)
      )
    );
    const why = extractWhy(coveringBlocksText, name);
    if (why.length > 0) lines.push("", why);
  }
  const hidden = groups.length - RELATED_SPANS_CAP;
  if (hidden > 0) {
    lines.push(
      "",
      hidden === 1 ? (
        // The hidden spans cover *covered* paths, which this message never
        // names — so a `<path>` placeholder would leave the reader with
        // nothing to substitute. Bare `git span list` needs no argument and
        // is guaranteed to include them.
        "1 more span covers files in this change and is not shown \u2014 `git span list` lists every span in the repository."
      ) : `${hidden} more spans cover files in this change and are not shown \u2014 \`git span list\` lists every span in the repository.`
    );
  }
  return lines;
}
function renderUncoveredReason(uncovered, covering, coveringBlocksText, mode = "may-hold", harness = "generic") {
  const lines = uncovered.map((path) => `- ${path}`);
  const subject = uncovered.length === 1 ? "this file carries" : "these files carry";
  const inline = harness === "generic";
  const actionLine = inline ? `Determine if ${subject} implicit dependencies, then use \`git span\` to document them:` : harness === "claude" ? `Dispatch a forked subagent to determine if ${subject} implicit dependencies and to then use \`git span\` to document them:` : harness === "codex" ? `Spawn a forked subagent with \`spawn_agent\`, setting \`fork_turns: "all"\`, to determine if ${subject} implicit dependencies and to then use \`git span\` to document them:` : `Dispatch a subagent with the \`task\` tool to determine if ${subject} implicit dependencies and to then use \`git span\` to document them:`;
  const body = [
    "<git-span>",
    ...lines,
    "",
    actionLine,
    "",
    "`git span add <name> <anchor> [<anchor>] ...`  \u2014 an anchor is a path or a `path#Lstart-Lend` range",
    '`git span why <name> "<why>"`',
    "",
    'The "<why>" is one or two complete present-tense clauses stating the relationship and any decisive nonlocal authority, invariant, permitted difference, lifecycle state, evidence gate, or focused conditional verification. Labels are optional but must introduce complete clauses. Omit generic work orders and CLI procedure.'
  ];
  body.push(...renderRelatedSpansSection(covering, uncovered, coveringBlocksText));
  if (mode === "may-hold") {
    body.push("", "If none exist, retry the command to proceed (one-time check).");
  }
  body.push(
    "",
    harness === "generic" ? "Load the `git-span:git-span` skill for guidance." : harness === "opencode" ? "Load the `git-span` skill via the skill tool in the subagent." : "Load the `git-span:git-span` skill in the fork.",
    "</git-span>"
  );
  return { reason: body.join("\n") };
}
var DEFAULT_TIMEOUT_MS = 1e4;
var EVALUATION_DEADLINE_MS = 8e3;
var execFileAsync = promisify(execFile);
var MAX_STDOUT_BYTES = 64 * 1024 * 1024;
var GIT_READ_OPTS = ["-c", "core.quotepath=false"];
var GIT_DIFF_SHAPE_OPTS = ["--no-ext-diff", "--no-color", "--src-prefix=a/", "--dst-prefix=b/"];
function buildHunkReadArgs(repoRoot, range, paths) {
  const rangeArgs = range.kind === "staged" ? ["--cached"] : range.kind === "worktree" ? ["HEAD"] : [`${range.base}..HEAD`];
  return ["-C", repoRoot, ...GIT_READ_OPTS, "diff", "-U0", ...GIT_DIFF_SHAPE_OPTS, ...rangeArgs, "--", ...paths];
}
async function gitText(args, cwd, timeoutMs, signal) {
  const outcome = await trySpawnGit(args, cwd, timeoutMs, signal);
  return outcome.ok ? outcome.stdout : "";
}
async function gitLines(args, cwd, timeoutMs, signal) {
  const outcome = await trySpawnGit(args, cwd, timeoutMs, signal);
  return outcome.ok ? splitPosixLines(outcome.stdout) : [];
}
async function gitLinesOrNull(args, cwd, timeoutMs, signal) {
  const outcome = await trySpawnGit(args, cwd, timeoutMs, signal);
  return outcome.ok ? splitPosixLines(outcome.stdout) : null;
}
function splitPosixLines(out) {
  return out.split("\n").map((line) => line.trim()).filter((line) => line.length > 0).map(toPosix);
}
async function trySpawnGit(args, cwd, timeoutMs, signal) {
  if (signal?.aborted) return { ok: false, stdout: "", stderr: "" };
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: MAX_STDOUT_BYTES,
      timeout: timeoutMs,
      signal
    });
    return { ok: true, stdout };
  } catch (err) {
    const streams = err;
    return {
      ok: false,
      stdout: typeof streams.stdout === "string" ? streams.stdout : "",
      stderr: typeof streams.stderr === "string" ? streams.stderr : ""
    };
  }
}
function createDefaultGitExecutor(timeoutMs = DEFAULT_TIMEOUT_MS) {
  return {
    stagedPaths: async (cwd, signal) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot) return [];
      return gitLines(
        ["-C", repoRoot, ...GIT_READ_OPTS, "diff", "--cached", "--name-only"],
        repoRoot,
        timeoutMs,
        signal
      );
    },
    trackedModifiedPaths: async (cwd, signal) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot) return [];
      return gitLines(["-C", repoRoot, ...GIT_READ_OPTS, "diff", "--name-only"], repoRoot, timeoutMs, signal);
    },
    outgoingPaths: async (cwd, signal) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot) return { paths: [], base: null };
      const upstream = await gitLinesOrNull(
        ["-C", repoRoot, ...GIT_READ_OPTS, "diff", "--name-only", "@{u}..HEAD"],
        repoRoot,
        timeoutMs,
        signal
      );
      if (upstream !== null) return { paths: upstream, base: "@{u}" };
      const base = (await gitLines(["-C", repoRoot, "merge-base", "HEAD", "origin/HEAD"], repoRoot, timeoutMs, signal))[0];
      if (!base) return { paths: [], base: null };
      return {
        paths: await gitLines(
          ["-C", repoRoot, ...GIT_READ_OPTS, "diff", "--name-only", `${base}..HEAD`],
          repoRoot,
          timeoutMs,
          signal
        ),
        base
      };
    },
    pathspecPaths: async (paths, cwd, signal) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return [];
      return gitLines(
        ["-C", repoRoot, ...GIT_READ_OPTS, "diff", "HEAD", "--name-only", "--", ...paths],
        repoRoot,
        timeoutMs,
        signal
      );
    },
    changedHunks: async (paths, range, cwd, signal) => {
      if (range.kind === "unresolvable" || paths.length === 0) return [];
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot) return [];
      const text = await gitText(buildHunkReadArgs(repoRoot, range, paths), repoRoot, timeoutMs, signal);
      if (text.trim().length === 0) return [];
      try {
        return parseUnifiedDiff(text);
      } catch {
        return [];
      }
    }
  };
}
var REQUIRED_GIT_SPAN_VERSION = "1.0.142";
function isArgumentParseFailure(stderr) {
  if (!/^\s*(usage|Usage):/m.test(stderr)) return false;
  return /error:\s+(unexpected argument|unrecognized subcommand|invalid subcommand|unknown (?:argument|subcommand)|the subcommand .* wasn't recognized|unexpected value)/i.test(
    stderr
  );
}
function parseSemverTriple(text) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
function isOlderThan(version, floor) {
  const a = parseSemverTriple(version);
  const b = parseSemverTriple(floor);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}
async function probeGitSpanVersion(repoRoot, timeoutMs, signal) {
  const outcome = await trySpawnGit(["span", "--version"], repoRoot, timeoutMs, signal);
  if (!outcome.ok) return null;
  const triple = parseSemverTriple(outcome.stdout);
  return triple ? triple.join(".") : null;
}
async function classifyCliFailure(detail, repoRoot, timeoutMs, signal) {
  if (!isArgumentParseFailure(detail)) return new AdvisorScanError(detail);
  return new AdvisorIncompatibleCliError(detail, await probeGitSpanVersion(repoRoot, timeoutMs, signal));
}
function createDefaultAdvisorExecutors(timeoutMs = DEFAULT_TIMEOUT_MS) {
  return {
    fix: async (paths, cwd, signal) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return;
      const outcome = await trySpawnGit(["span", "drift", ...paths, "--fix"], repoRoot, timeoutMs, signal);
      if (outcome.ok) return;
      const stderrText = outcome.stderr.trim();
      if (stderrText.length > 0) {
        const classified = await classifyCliFailure(stderrText, repoRoot, timeoutMs, signal);
        if (classified instanceof AdvisorIncompatibleCliError) throw classified;
      }
    },
    drift: async (paths, cwd, signal) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return [];
      const outcome = await trySpawnGit(
        ["span", "drift", "--format", "porcelain", ...paths],
        repoRoot,
        timeoutMs,
        signal
      );
      if (!outcome.ok && outcome.stdout.trim().length === 0 && outcome.stderr.trim().length > 0) {
        throw await classifyCliFailure(outcome.stderr.trim(), repoRoot, timeoutMs, signal);
      }
      return parseDriftPorcelain(outcome.stdout);
    },
    list: async (paths, cwd, signal) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || paths.length === 0) return [];
      const outcome = await trySpawnGit(["span", "list", "--porcelain", ...paths], repoRoot, timeoutMs, signal);
      if (!outcome.ok && outcome.stdout.trim().length === 0 && outcome.stderr.trim().length > 0) {
        throw new AdvisorScanError(outcome.stderr.trim());
      }
      return parsePorcelain(outcome.stdout);
    },
    listBlocks: async (names, cwd, signal) => {
      const repoRoot = resolveRepoRoot(cwd);
      if (!repoRoot || names.length === 0) return "";
      const outcome = await trySpawnGit(["span", "list", ...names], repoRoot, timeoutMs, signal);
      return outcome.ok ? outcome.stdout : "";
    }
  };
}
function createDiskAdvisorMemoState(cwd) {
  const repoRoot = resolveRepoRoot(cwd);
  if (!repoRoot) {
    return { has: () => false, record: () => false };
  }
  const dir = advisorMemoDir(repoRoot);
  return {
    has: (digest) => {
      try {
        return fs4.existsSync(nodePath4.join(dir, digest));
      } catch {
        return false;
      }
    },
    record: (digest) => {
      try {
        fs4.mkdirSync(dir, { recursive: true });
        fs4.writeFileSync(nodePath4.join(dir, digest), "");
        return true;
      } catch {
        return false;
      }
    }
  };
}

// src/common/update-check-env.ts
function disableUpdateCheck() {
  process.env.GIT_SPAN_DISABLE_UPDATE_CHECK = "1";
}

// src/codex/advisor.ts
var CODEX_ADVISOR_HARD_DENY = true;
function extractShellCommand(toolInput) {
  if (toolInput === null || typeof toolInput !== "object" || !("command" in toolInput)) return null;
  const command = toolInput.command;
  if (typeof command === "string") return command.length > 0 ? command : null;
  if (Array.isArray(command)) {
    const parts = command.filter((p) => typeof p === "string");
    if (parts.length === 0) return null;
    const flagIdx = parts.findIndex((p) => p === "-c" || p === "-lc" || p === "-ic");
    if (flagIdx >= 0 && parts[flagIdx + 1] !== void 0) return parts[flagIdx + 1];
    return parts.join(" ");
  }
  return null;
}
function createHandler(git = createDefaultGitExecutor(), executors = createDefaultAdvisorExecutors(), memoFactory = createDiskAdvisorMemoState, hardDeny = CODEX_ADVISOR_HARD_DENY) {
  return async (input, ctx) => {
    try {
      ctx.logger.info("git-span advisor observed shell tool", { tool_name: input.tool_name });
      const command = extractShellCommand(input.tool_input);
      if (command === null) return void 0;
      const parsed = parseGitCommand(command);
      if (parsed.kind === "none") return void 0;
      const cwd = input.cwd ?? "";
      const all = parsed.kind === "commit" ? commitStagesAll(command) : false;
      const changeset = await resolveChangeset(parsed.kind, all, cwd, git, parsed.paths);
      const mode = parsed.kind === "status" ? "report-only" : "may-hold";
      const result = await evaluateAdvisor(
        changeset.paths,
        cwd,
        executors,
        memoFactory(cwd),
        mode,
        {
          git,
          range: changeset.range,
          // The hook logger is the only place a suppressed file leaves a trace —
          // the agent-facing output of a suppression is nothing at all.
          logger: ctx.logger
        },
        "codex",
        void 0,
        // Core defects (non-advisor-error throws) warn here instead of vanishing
        // into evaluateAdvisor's fail-open catch.
        ctx.logger
      );
      if (result.decision !== "hold") {
        if (result.kind === "environmental" || result.kind === "scan-failed") {
          ctx.logger.warn("git-span advisor allowed with an unresolved condition", { reason: result.reason });
          const wrapped2 = wrapGitSpanContext(result.reason);
          return preToolUseOutput({ additionalContext: wrapped2, systemMessage: wrapped2 });
        }
        if (result.kind === "semantic-drift-report" || result.kind === "uncovered-writes-report") {
          const wrapped2 = wrapGitSpanContext(result.reason);
          return preToolUseOutput({ additionalContext: wrapped2, systemMessage: wrapped2 });
        }
        return void 0;
      }
      if (hardDeny) {
        return preToolUseOutput({
          permissionDecision: "deny",
          permissionDecisionReason: result.reason,
          systemMessage: result.reason
        });
      }
      const warning = `Could not block this command \u2014 the issue below still needs resolving:
${result.reason}`;
      const wrapped = wrapGitSpanContext(warning);
      return preToolUseOutput({ additionalContext: wrapped, systemMessage: wrapped });
    } catch (err) {
      ctx.logger.warn("git-span advisor failed open on an uncaught error", { err });
      return void 0;
    }
  };
}
disableUpdateCheck();
var advisor_default = preToolUseHook({ matcher: "Bash|shell|exec|local_shell", timeout: 1e4 }, createHandler());

// src/codex/advisor-entry.ts
execute(advisor_default);

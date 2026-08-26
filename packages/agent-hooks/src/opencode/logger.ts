/**
 * Env-gated JSONL logger for the OpenCode adapter, satisfying the shared
 * {@link MemoLogger} surface (`../common/span-surface.js`).
 *
 * OpenCode has no SDK-level hook logger (the Claude/Codex twins log through
 * their hosts' unified `AGENT_HOOKS_LOG_FILE`), so this
 * adapter ships its own: when `OPENCODE_GIT_SPAN_LOG_FILE` names a path, every
 * record appends as one JSON object per line (JSONL); unset, the logger is a
 * silent no-op — the same "no destination, record discarded" posture the twins'
 * loggers have when their variable is unset. Only proven bun-compatible
 * `node:` APIs are used (OpenCode loads plugins with bun).
 */

import { appendFileSync } from 'node:fs';
import type { MemoLogger } from '../common/span-surface.js';

/** The env var that gates the JSONL destination. */
export const OPENCODE_LOG_FILE_ENV = 'OPENCODE_GIT_SPAN_LOG_FILE';

export interface CreateOpencodeLoggerOptions {
  /** Overrides the env var (tests inject a scratch path here). */
  logFile?: string;
}

/**
 * Replace Errors with plain objects carrying their non-enumerable `message`
 * and `stack` plus every enumerable own property — `JSON.stringify` alone
 * renders an Error as `{}`. Recurses through arrays and plain objects so a
 * nested error keeps its detail too.
 */
function serializeValue(value: unknown): unknown {
  if (value instanceof Error) {
    const out: Record<string, unknown> = { message: value.message, stack: value.stack };
    for (const [key, own] of Object.entries(value)) out[key] = serializeValue(own);
    return out;
  }
  if (Array.isArray(value)) return value.map(serializeValue);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, own] of Object.entries(value)) out[key] = serializeValue(own);
    return out;
  }
  return value;
}

function appendRecord(logFile: string, level: 'warn' | 'info', message: string, context?: Record<string, unknown>) {
  try {
    const entry: Record<string, unknown> = { ts: new Date().toISOString(), level, message };
    if (context !== undefined) {
      for (const [key, value] of Object.entries(context)) entry[key] = serializeValue(value);
    }
    appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
  } catch {
    // Logging must never throw into a hook body: an unwritable destination
    // degrades to silence, exactly like the unset-variable case.
  }
}

/** Build the adapter logger: JSONL when a destination is configured, silent otherwise. */
export function createOpencodeLogger(options: CreateOpencodeLoggerOptions = {}): MemoLogger {
  const logFile = options.logFile ?? process.env[OPENCODE_LOG_FILE_ENV];
  if (typeof logFile !== 'string' || logFile.length === 0) {
    return {
      warn: () => undefined
    };
  }
  return {
    warn(message, context) {
      appendRecord(logFile, 'warn', message, context);
    },
    info(message, context) {
      appendRecord(logFile, 'info', message, context);
    }
  };
}

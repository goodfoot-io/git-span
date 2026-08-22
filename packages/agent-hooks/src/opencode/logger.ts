/**
 * Env-gated JSONL logger for the OpenCode adapter, satisfying the shared
 * {@link MemoLogger} surface (`../common/span-surface.js`).
 *
 * OpenCode has no SDK-level hook logger (the Claude/Codex twins log through
 * their hosts' `CLAUDE_CODE_HOOKS_LOG_FILE` / `CODEX_HOOKS_LOG_FILE`), so this
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

function appendRecord(logFile: string, level: 'warn' | 'info', message: string, context?: Record<string, unknown>) {
  try {
    const entry: Record<string, unknown> = { ts: new Date().toISOString(), level, message };
    if (context !== undefined) {
      for (const [key, value] of Object.entries(context)) entry[key] = value;
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

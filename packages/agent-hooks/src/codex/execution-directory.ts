/** Recover canonical Bash execution context without changing the shell command. */
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { isRecord } from '../common/guards.js';
import { narrowCodeModeExecutions } from './shell-input.js';

const MAX_TRANSCRIPT_BYTES = 16 * 1024 * 1024;
const MAX_PENDING_CALLS = 32;
const MAX_PENDING_SOURCE_BYTES = 1_048_576;

export interface ExecutionDirectoryRequest {
  readonly transcriptPath?: string | null;
  readonly sessionId: string;
  readonly toolUseId: string;
  readonly command: string;
  readonly cwd: string;
}

/**
 * Read a bounded, complete local rollout. Missing, paginated, malformed or
 * oversized transcripts disable attribution rather than guessing a directory.
 */
function readTranscript(path: string): string | null {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_TRANSCRIPT_BYTES) return null;
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) return null;
      offset += count;
    }
    const text = bytes.toString('utf8');
    if (!text.endsWith('\n')) return null;
    return text;
  } finally {
    closeSync(descriptor);
  }
}

/** Decode one direct call; the hook cwd belongs to its originating execution context. */
function directDirectory(call: Record<string, unknown>, request: ExecutionDirectoryRequest): string | null {
  if (call.type !== 'function_call' || call.name !== 'exec_command' || typeof call.arguments !== 'string') return null;
  const args: unknown = JSON.parse(call.arguments);
  if (!isRecord(args) || args.cmd !== request.command) return null;
  if (args.environment_id !== undefined && args.environment_id !== null) return null;
  if (['run_in_background', 'background', 'delegate', 'delegated', 'worker'].some((key) => args[key] === true))
    return null;
  if (args.workdir === undefined || args.workdir === null || args.workdir === '') return request.cwd;
  if (typeof args.workdir !== 'string' || args.workdir.includes('\0')) return null;
  return resolve(request.cwd, args.workdir);
}

/** Only the host's leading terminal status retires a source; yielded/unknown outputs retain it. */
function completedScript(output: unknown): boolean {
  const first = Array.isArray(output) ? output[0] : output;
  const text = isRecord(first) && first.type === 'input_text' ? first.text : first;
  return typeof text === 'string' && (text.startsWith('Script completed\n') || text.startsWith('Script failed\n'));
}

interface PendingScript {
  readonly input: string;
  readonly cwd: string;
}

/** Parse outstanding sources only, requiring every possible matching command to agree. */
function codeModeDirectory(pending: ReadonlyMap<string, PendingScript>, command: string): string | null {
  if (pending.size > MAX_PENDING_CALLS) return null;
  let bytes = 0;
  for (const script of pending.values()) {
    bytes += Buffer.byteLength(script.input);
    if (bytes > MAX_PENDING_SOURCE_BYTES) return null;
  }
  let directory: string | null = null;
  for (const script of pending.values()) {
    const parsed = narrowCodeModeExecutions(script, { directToolsOnly: true });
    // An unparsed source could contain another matching call in a different directory.
    if (!parsed.matched || parsed.executions.length === 0) return null;
    for (const execution of parsed.executions) {
      if (execution.command !== command) continue;
      if (execution.background) return null;
      const cwd = resolve(script.cwd, execution.workdir ?? '');
      if (directory !== null && directory !== cwd) return null;
      directory = cwd;
    }
  }
  return directory;
}

/**
 * Prefer an exact original call. For generated code-mode child IDs, infer a
 * directory only from outstanding literal calls whose matching commands agree.
 * The invocation enrollment caches the result for PostToolUse.
 */
export function resolveExecutionDirectory(request: ExecutionDirectoryRequest): string | null {
  if (!request.transcriptPath || !isAbsolute(request.cwd) || request.cwd.includes('\0')) return null;
  try {
    const text = readTranscript(request.transcriptPath);
    if (text === null) return null;
    let exact: Record<string, unknown> | undefined;
    const pending = new Map<string, PendingScript>();
    let cwd = request.cwd;
    // Parse each JSON record once, without retaining historical payloads or splitting the full file into an array.
    for (let start = 0; start < text.length; ) {
      const end = text.indexOf('\n', start);
      const row: unknown = JSON.parse(text.slice(start, end));
      if (!isRecord(row) || !isRecord(row.payload)) return null;
      const payload = row.payload;
      if (start === 0 && (row.type !== 'session_meta' || payload.id !== request.sessionId)) return null;
      start = end + 1;
      if (row.type === 'turn_context') {
        if (typeof payload.cwd !== 'string' || !isAbsolute(payload.cwd) || payload.cwd.includes('\0')) return null;
        cwd = payload.cwd;
      }
      if (row.type !== 'response_item') continue;
      const type = payload.type;
      if (payload.call_id === request.toolUseId && (type === 'function_call' || type === 'custom_tool_call')) {
        if (exact !== undefined) return null;
        exact = payload;
      }
      if (payload.namespace !== undefined && payload.namespace !== null && payload.namespace !== 'functions') {
        if (payload === exact) return null;
        continue;
      }
      if (typeof payload.call_id !== 'string') continue;
      if (type === 'custom_tool_call' && payload.name === 'exec') {
        if (typeof payload.input !== 'string' || pending.has(payload.call_id)) return null;
        pending.set(payload.call_id, { input: payload.input, cwd });
      } else if (type === 'custom_tool_call_output' && completedScript(payload.output)) {
        pending.delete(payload.call_id);
      }
    }
    if (exact !== undefined) return directDirectory(exact, request);
    return request.toolUseId.startsWith('exec-') ? codeModeDirectory(pending, request.command) : null;
  } catch {
    return null;
  }
}

/**
 * Codex PostToolUse touch hook — heal + surface after a confirmed `apply_patch`,
 * or a shell/exec call whose command statically resolves to file+line idioms.
 *
 * PostToolUse fires after `apply_patch` has run, so this is the accurate home for
 * the touch signal: the file is already written, so a scoped `git span drift
 * <file> --fix` heals positional drift against real bytes and the surfaced block
 * reflects the healed anchors. The handler narrows the `apply_patch` envelope
 * (`tool_input.command`, SDK-typed `unknown`) into per-file anchors via the
 * shared [apply-patch parser](./apply-patch.ts), and recovers shell commands
 * from either Codex envelope (classic `exec_command` JSON `arguments`, or
 * code-mode `exec` wrapping `tools.exec_command({...})`) via the shared
 * [command parser](../common/parse-command.ts); each touched file is scoped to
 * the CWD repo, and drives the harness-agnostic {@link runTouchHook} core — the
 * same core the Claude adapter uses.
 *
 * Two Codex-specific concerns are preserved from this file's journaling
 * predecessor:
 *
 * 1. **Success classification.** The parsed envelope describes *intent*, not
 *    *outcome*. Codex core fires PostToolUse only on tool success, but as a
 *    durability belt we classify `tool_response` via
 *    {@link classifyApplyPatchResponse}: a confirmed rejection (`'failure'`)
 *    suppresses the touch (no phantom heal/surface on a patch that never
 *    applied); a success or an unrecognized shape (`'unknown'`, warned) proceeds.
 * 2. **No post-edit range recovery from the envelope.** PostToolUse runs after
 *    the patch rewrote the file, so the hunk's pre-edit block no longer sits
 *    where the edit happened and could mis-anchor a duplicate. The touch is
 *    scoped file-wide (`written: ''` → whole-file), which is exactly the
 *    behavior {@link runTouchHook} takes for an empty write.
 *
 * The timeout is milliseconds in the handler config (the CLI emits `10` seconds)
 * — see the timeout-units spike note; the source value must stay in ms so the
 * Codex build's seconds conversion at emit remains correct.
 */

import { type HookContext, type PostToolUseInput, postToolUseHook, postToolUseOutput } from '@goodfoot/codex-hooks';
import { abspathAgainst } from '../common/agent-hooks-common.js';
import { parseCommandDetailed } from '../common/parse-command.js';
import { createDiskMemoStore, type MemoFactory, resolveTouchScope } from '../common/span-surface.js';
import {
  createDefaultTouchExecutors,
  runTouchHook,
  type TouchExecutors,
  type TouchInput
} from '../common/touch-core.js';
import { parseApplyPatch } from './apply-patch.js';

/**
 * The prefix apply_patch's stdout carries when — and only when — the patch
 * applied (codex-rs/apply-patch `print_summary`). Codex surfaces that stdout
 * verbatim as the PostToolUse `tool_response` (a bare string today). Fixed
 * across Add/Modify/Delete; the header is followed by `A/M/D <path>` lines.
 */
const APPLY_PATCH_SUCCESS_PREFIX = 'Success. Updated the following files:';

/**
 * The common fields an object-wrapped tool_response might carry the tool's text
 * output under, if Codex ever stops surfacing it as a bare string. Ordered by
 * likelihood; the first field whose value is a string wins.
 */
const RESPONSE_TEXT_FIELDS = ['output', 'stdout', 'content', 'text'] as const;

/** Narrow the SDK's `unknown` tool_input to the `apply_patch` `{ command }` shape. */
export function narrowApplyPatchCommand(toolInput: unknown): string | null {
  if (toolInput !== null && typeof toolInput === 'object' && 'command' in toolInput) {
    const command = (toolInput as { command: unknown }).command;
    if (typeof command === 'string') return command;
  }
  return null;
}

/**
 * Narrow the classic `exec_command` envelope (cli_version ≤ 0.130.0):
 * `tool_input.arguments` is a JSON *string* of shape
 * `{"cmd": "...", "workdir": "..."}` — parse it and return the `cmd`. Returns
 * `null` for any other shape (not JSON, no `cmd` field, or not this envelope).
 */
export function narrowExecCommand(toolInput: unknown): string | null {
  if (toolInput !== null && typeof toolInput === 'object' && 'arguments' in toolInput) {
    const args = (toolInput as { arguments: unknown }).arguments;
    if (typeof args === 'string') {
      try {
        const parsed = JSON.parse(args);
        if (parsed !== null && typeof parsed === 'object' && typeof parsed.cmd === 'string') {
          return parsed.cmd;
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * The result of narrowing the code-mode `exec` envelope. `matched` separates
 * "the envelope was a `tools.exec_command({...})` call whose argument could not
 * be recovered" (a variable/template-built command — statically unresolvable)
 * from "the envelope is not code-mode exec at all", so the handler can warn on
 * the former instead of silently conflating it with the latter.
 */
export interface CodeModeExecNarrow {
  /** Whether `tool_input.input` contained a `tools.exec_command({...})` call. */
  matched: boolean;
  /** The recovered `cmd` string, or `null` when matched but unparsable / absent. */
  cmd: string | null;
}

/**
 * Quote bare identifier keys in a JS object literal so `JSON.parse` can read
 * it. Real code-mode call sites emit JS-style unquoted keys
 * (`{cmd:"sed -n '1,240p' /path",...}`), which is valid JS but invalid JSON.
 * String values (single- or double-quoted) are copied verbatim — including any
 * `, key:`-shaped text inside them — and already-quoted keys pass through
 * untouched.
 */
function quoteObjectKeys(literal: string): string {
  let out = '';
  let i = 0;
  const n = literal.length;
  while (i < n) {
    const c = literal[i];
    if (c === '"' || c === "'") {
      const quote = c;
      const start = i;
      i += 1;
      while (i < n) {
        if (literal[i] === '\\' && i + 1 < n) i += 2;
        else if (literal[i] === quote) {
          i += 1;
          break;
        } else i += 1;
      }
      out += literal.slice(start, i);
      continue;
    }
    const key = literal.slice(i).match(/^(\{|,)\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:/);
    if (key) {
      out += `${key[1]}"${key[2]}":`;
      i += key[0].length;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * Narrow the code-mode `exec` envelope (cli_version ≥ 0.144.0):
 * `tool_input.input` is JS source that calls `tools.exec_command({...})` —
 * recover the literal object argument via balanced-brace matching, quote its
 * unquoted JS keys, and parse it. A command built from variables or template
 * literals is statically unresolvable: the call still *matched* but yields
 * `cmd: null`, reported distinctly from a non-code-mode envelope.
 */
export function narrowCodeModeExec(toolInput: unknown): CodeModeExecNarrow {
  if (toolInput !== null && typeof toolInput === 'object' && 'input' in toolInput) {
    const input = (toolInput as { input: unknown }).input;
    if (typeof input === 'string') {
      // Match tools.exec_command({...}) — extract the literal object argument
      const match = input.match(/tools\.exec_command\(\s*(\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})\s*\)/);
      if (match) {
        try {
          const parsed = JSON.parse(quoteObjectKeys(match[1]));
          if (parsed !== null && typeof parsed === 'object' && typeof parsed.cmd === 'string') {
            return { matched: true, cmd: parsed.cmd };
          }
          return { matched: true, cmd: null };
        } catch {
          // matched, but the literal did not parse — the call is still a
          // code-mode exec whose command cannot be recovered statically.
          return { matched: true, cmd: null };
        }
      }
    }
  }
  return { matched: false, cmd: null };
}

/**
 * Tolerantly pull the tool's textual output out of a `tool_response` of
 * uncertain shape (SDK-typed `unknown`): a bare string (today's Codex) is
 * returned as-is; an object is probed for the first {@link RESPONSE_TEXT_FIELDS}
 * entry that holds a string. Returns `null` when no text can be recovered
 * (unknown object shape, `null`, or a non-string/non-object), which the caller
 * treats as an *unrecognized* — not *failed* — response.
 */
function extractResponseText(toolResponse: unknown): string | null {
  if (typeof toolResponse === 'string') return toolResponse;
  if (toolResponse !== null && typeof toolResponse === 'object') {
    const record = toolResponse as Record<string, unknown>;
    for (const field of RESPONSE_TEXT_FIELDS) {
      const value = record[field];
      if (typeof value === 'string') return value;
    }
  }
  return null;
}

/**
 * Classify an `apply_patch` `tool_response` for the touch gate:
 *
 * - `'success'` — text was recovered and carries {@link APPLY_PATCH_SUCCESS_PREFIX}.
 * - `'failure'` — text was recovered but lacks the header: a genuine rejection
 *   or error. The ONLY classification that suppresses the touch.
 * - `'unknown'` — no text could be recovered (unrecognized shape). We proceed
 *   defensively here rather than risk missing a real edit's heal/surface; Codex
 *   core fires PostToolUse only on success, so this cannot heal/surface a patch
 *   that never applied.
 */
export function classifyApplyPatchResponse(toolResponse: unknown): 'success' | 'failure' | 'unknown' {
  const text = extractResponseText(toolResponse);
  if (text === null) return 'unknown';
  return text.startsWith(APPLY_PATCH_SUCCESS_PREFIX) ? 'success' : 'failure';
}

/** A reader that always declines, forcing the parser to whole-file anchors. */
const noRangeRecovery = (): null => null;

export function createHandler(
  executors: TouchExecutors = createDefaultTouchExecutors(),
  memoFactory: MemoFactory = createDiskMemoStore
) {
  return async (input: PostToolUseInput, ctx: HookContext) => {
    const tool_name = input.tool_name;
    const cwd = input.cwd ?? '';
    const sessionId = input.session_id;
    const memo = memoFactory(ctx.logger);

    // Shell touch: extract the command from whichever envelope shape the harness
    // delivers, parse, and run each resolved span through the shared touch core.
    //
    // - `Bash`: the harness-unwrapped shape Codex ≥0.144 actually sends —
    //   `tool_input.command` is the raw shell command string (same shape the
    //   Claude adapter handles).
    // - `exec_command`: classic function_call envelope (cli ≤0.130) —
    //   `tool_input.arguments` is a JSON string with a `cmd` field.
    // - `exec`: direct code-mode envelope (may ship in a future CLI) —
    //   `tool_input.input` is JS source wrapping `tools.exec_command({...})`.
    //
    // A command with no recognized idiom yields no blocks and returns undefined —
    // fail-open, same as the apply_patch path below.
    if (tool_name === 'Bash' || tool_name === 'exec_command' || tool_name === 'exec') {
      let command: string | null = null;
      if (tool_name === 'Bash') {
        // The harness already unwrapped the code-mode envelope — the command is
        // in `tool_input.command`, exactly as the Claude adapter receives it.
        const raw = (input.tool_input as Record<string, unknown> | null)?.command;
        command = typeof raw === 'string' ? raw : null;
      } else {
        command = narrowExecCommand(input.tool_input);
      }
      if (command === null && tool_name === 'exec') {
        // Code-mode `exec` wraps the same call in JS source. A matched call
        // whose argument could not be parsed (variable/template-built command)
        // is a distinct outcome from "not a code-mode envelope at all": warn so
        // the blind spot is visible instead of silently conflated with no match.
        const codeMode = narrowCodeModeExec(input.tool_input);
        if (codeMode.matched && codeMode.cmd === null) {
          ctx.logger.warn(
            'Codex code-mode exec envelope matched but its exec_command argument could not be parsed; no shell touch',
            {
              toolInputType: typeof input.tool_input,
              toolInputKeys:
                input.tool_input !== null && typeof input.tool_input === 'object'
                  ? Object.keys(input.tool_input as Record<string, unknown>)
                  : undefined
            }
          );
        }
        command = codeMode.cmd;
      }
      if (!command) return undefined;

      const matches = parseCommandDetailed(command, cwd);
      const blocks: string[] = [];
      for (const match of matches) {
        if (match.status !== 'resolved') continue;
        const span = match.span;
        const absPath = abspathAgainst(cwd, span.absolutePath);
        const scope = resolveTouchScope(cwd, absPath);
        if (!scope) continue;
        let touchInput: {
          kind: 'read' | 'write';
          sessionId: string;
          cwd: string;
          filePath: string;
          offset?: number;
          limit?: number;
          written?: string;
        };
        if (match.idiom === 'heredoc-write') {
          // `>` overwrites: whole-file scope so deleted spans beyond the new
          // EOF are surfaced. `>>` appends: narrow to the appended lines.
          const written = span.redirect === '>' ? '' : (span.body ?? '');
          touchInput = { kind: 'write', sessionId, cwd, filePath: absPath, written };
        } else {
          touchInput = {
            kind: 'read',
            sessionId,
            cwd,
            filePath: absPath,
            offset: span.lineStart,
            limit: span.lineEnd - span.lineStart + 1
          };
        }
        const output = await runTouchHook(touchInput as TouchInput, executors, memo);
        if (output.additionalContext) blocks.push(output.additionalContext);
      }
      if (blocks.length === 0) return undefined;
      const combined = blocks.join('');
      return postToolUseOutput({ additionalContext: combined, systemMessage: combined });
    }

    const command = narrowApplyPatchCommand(input.tool_input);
    if (command === null) return undefined;

    // Suppress only a *confirmed* non-success. An unrecognized response shape
    // proceeds (with a warning) rather than risk skipping a real edit's touch.
    const classification = classifyApplyPatchResponse(input.tool_response);
    if (classification === 'failure') return undefined;
    if (classification === 'unknown') {
      ctx.logger.warn('Codex apply_patch tool_response shape unrecognized; running touch defensively', {
        toolResponseType: typeof input.tool_response,
        toolResponseKeys:
          input.tool_response !== null && typeof input.tool_response === 'object'
            ? Object.keys(input.tool_response as Record<string, unknown>)
            : undefined
      });
    }

    // One envelope may touch several files; force whole-file anchors (Codex never
    // recovers a post-edit range) and run the shared touch core per touched file.
    // The shared memo dedupes span renders across anchors and the session.
    const anchors = parseApplyPatch(command, noRangeRecovery);
    const blocks: string[] = [];
    for (const anchor of anchors) {
      const absPath = abspathAgainst(cwd, anchor.path);
      const scope = resolveTouchScope(cwd, absPath);
      if (!scope) continue;
      const output = await runTouchHook(
        { kind: 'write', sessionId, cwd, filePath: absPath, written: '' },
        executors,
        memo
      );
      if (output.additionalContext) blocks.push(output.additionalContext);
    }

    if (blocks.length === 0) return undefined;
    const combined = blocks.join('');
    return postToolUseOutput({ additionalContext: combined, systemMessage: combined });
  };
}

export default postToolUseHook({ matcher: 'apply_patch|exec_command|exec|Bash', timeout: 10_000 }, createHandler());

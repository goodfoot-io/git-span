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

import { resolve as resolvePath } from 'node:path';
import { type HookContext, type PostToolUseInput, postToolUseHook, postToolUseOutput } from '@goodfoot/codex-hooks';
import { abspathAgainst } from '../common/agent-hooks-common.js';
import { bashResponseInterrupted, runBashTouches } from '../common/bash-touch.js';
import { parseCommandDetailed } from '../common/parse-command.js';
import { parseResponse, type ResponseParseInput } from '../common/parse-response.js';
import { createDiskMemoStore, type MemoFactory, resolveTouchScope } from '../common/span-surface.js';
import { createDefaultTouchExecutors, runTouchHook, type TouchExecutors } from '../common/touch-core.js';
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
 * `{"cmd": "...", "workdir": "..."}` — parse it and return the `cmd` and
 * `workdir`. Returns `null` for any other shape (not JSON, no `cmd` field, or
 * not this envelope); `workdir` is `null` when absent or not a string.
 */
export function narrowExecCommand(toolInput: unknown): { cmd: string; workdir: string | null } | null {
  if (toolInput !== null && typeof toolInput === 'object' && 'arguments' in toolInput) {
    const args = (toolInput as { arguments: unknown }).arguments;
    if (typeof args === 'string') {
      try {
        const parsed = JSON.parse(args);
        if (parsed !== null && typeof parsed === 'object' && typeof parsed.cmd === 'string') {
          return { cmd: parsed.cmd, workdir: typeof parsed.workdir === 'string' ? parsed.workdir : null };
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
  /** The recovered `workdir` string, or `null` when absent or not a string. */
  workdir: string | null;
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
            return {
              matched: true,
              cmd: parsed.cmd,
              workdir: typeof parsed.workdir === 'string' ? parsed.workdir : null
            };
          }
          return { matched: true, cmd: null, workdir: null };
        } catch {
          // matched, but the literal did not parse — the call is still a
          // code-mode exec whose command cannot be recovered statically.
          return { matched: true, cmd: null, workdir: null };
        }
      }
    }
  }
  return { matched: false, cmd: null, workdir: null };
}

/** The shell `tool_response` fields a response-aware parse contributes, before `command`/`cwd` are attached at the call site. */
type NormalizedShellResponse = Pick<
  ResponseParseInput,
  'stdout' | 'stderr' | 'exitStatus' | 'truncated' | 'interrupted'
>;

/**
 * Tolerantly normalize the tool's textual output and metadata out of a
 * `tool_response` of uncertain shape (SDK-typed `unknown`): a bare string
 * (today's Codex) is used as-is; a text-block array joins its blocks; an
 * object is probed for the first {@link RESPONSE_TEXT_FIELDS} entry that
 * holds a string, carrying along `stderr`, `exitCode`/`exitStatus`, and the
 * two-regime markers when the envelope has them — `rawOutputPath` set (the
 * inline stdout is only a preview) becomes `truncated: true`; `interrupted`
 * or `timedOutAfterMs` (the command was cut off mid-run) becomes
 * `interrupted: true`, the complete-records regime — the same normalization
 * the Claude adapter applies to its Bash envelope. Returns `null` when no
 * text can be recovered (unknown object shape, `null`, or a non-string/
 * non-object), which the caller treats as an *unrecognized* — not *failed* —
 * response.
 */
function normalizeShellResponse(toolResponse: unknown): NormalizedShellResponse | null {
  if (typeof toolResponse === 'string') return { stdout: toolResponse };
  if (Array.isArray(toolResponse)) {
    const text: string[] = [];
    for (const block of toolResponse) {
      if (block !== null && typeof block === 'object') {
        const value = (block as { text?: unknown }).text;
        if (typeof value === 'string') text.push(value);
      }
    }
    return { stdout: text.join('') };
  }
  if (toolResponse !== null && typeof toolResponse === 'object') {
    const record = toolResponse as Record<string, unknown>;
    for (const field of RESPONSE_TEXT_FIELDS) {
      const value = record[field];
      if (typeof value === 'string') {
        return {
          stdout: value,
          stderr: typeof record.stderr === 'string' ? record.stderr : undefined,
          exitStatus:
            typeof record.exitCode === 'number'
              ? record.exitCode
              : typeof record.exitStatus === 'number'
                ? record.exitStatus
                : undefined,
          truncated: record.rawOutputPath !== undefined,
          interrupted: record.interrupted === true || record.timedOutAfterMs !== undefined
        };
      }
    }
  }
  return null;
}

/**
 * Classify an `apply_patch` `tool_response` for the touch gate:
 *
 * - `'success'` — text was recovered from a bare string or a text-field
 *   object and carries {@link APPLY_PATCH_SUCCESS_PREFIX}.
 * - `'failure'` — text was recovered from a bare string or a text-field
 *   object but lacks the header: a genuine rejection or error. The ONLY
 *   classification that suppresses the touch.
 * - `'unknown'` — no text could be recovered (unrecognized shape), or the
 *   response is a block/text array. We proceed defensively here rather than
 *   risk missing a real edit's heal/surface; Codex core fires PostToolUse
 *   only on success, so this cannot heal/surface a patch that never applied.
 *
 * The array check restores the pre-normalizer contract: the baseline
 * `extractResponseText` returned `null` for every array shape (text-block,
 * empty, non-text), so arrays classified `'unknown'` and proceeded with a
 * warning. `normalizeShellResponse` deliberately widened to arrays for the
 * shell-parse evidence source, so classification reads the raw envelope to
 * keep the apply_patch gate behavior-identical — a joined array whose text
 * merely lacks the success header must never be mistaken for a confirmed
 * rejection.
 */
export function classifyApplyPatchResponse(toolResponse: unknown): 'success' | 'failure' | 'unknown' {
  if (Array.isArray(toolResponse)) return 'unknown';
  const normalized = normalizeShellResponse(toolResponse);
  if (normalized === null) return 'unknown';
  return normalized.stdout.startsWith(APPLY_PATCH_SUCCESS_PREFIX) ? 'success' : 'failure';
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
    // The branch also normalizes `tool_response` via `normalizeShellResponse`
    // and merges `parseResponse`'s spans in as read touches (the tool_response
    // pass below).
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
      let workdir: string | null = null;
      if (tool_name === 'Bash') {
        // The harness already unwrapped the code-mode envelope — the command is
        // in `tool_input.command`, exactly as the Claude adapter receives it.
        const raw = (input.tool_input as Record<string, unknown> | null)?.command;
        command = typeof raw === 'string' ? raw : null;
      } else {
        // The classic `exec_command` envelope carries `workdir` beside `cmd`
        // (plan §8) — thread it through like the code-mode envelope below.
        const classic = narrowExecCommand(input.tool_input);
        command = classic?.cmd ?? null;
        workdir = classic?.workdir ?? null;
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
        workdir = codeMode.workdir;
      }
      if (!command) return undefined;

      // Plan §8: a workdir present and free of `$`/backtick absolutizes against
      // the envelope's own `input.cwd` — the shell tool resolves a relative
      // workdir against that same base — and is the single frame for the whole
      // touch (parse base, absolutization, scope check, and the touch record's
      // cwd, which the executors drive their git span runs from). A
      // template-literal workdir (containing `$`/backtick) is unresolvable and
      // falls back to hook `cwd`.
      const effectiveCwd = workdir !== null && !/[`$]/.test(workdir) ? resolvePath(cwd, workdir) : cwd;

      // An interrupted command produces no touches, whatever its spans; the
      // driver re-checks defensively.
      if (bashResponseInterrupted(input.tool_response)) return undefined;
      const matches = parseCommandDetailed(command, effectiveCwd);
      const blocks = await runBashTouches(
        matches,
        sessionId,
        effectiveCwd,
        input.tool_response,
        executors,
        memo,
        (message) => ctx.logger.warn(message)
      );
      // The tool_response is a second evidence source for the shell:
      // response-derivable commands (grep/ripgrep with numbered output,
      // git diff/show/log -p, git blame -L) locate their read windows in the
      // output, which the command text alone cannot. Normalize the envelope,
      // merge its spans with the command-derived ones, and run each as a
      // read touch; the memo dedupes duplicate surfaces across the sources.
      // An unrecognized envelope degrades to command-only parsing.
      const response = normalizeShellResponse(input.tool_response);
      if (response !== null) {
        for (const span of parseResponse({ command, cwd: effectiveCwd, ...response })) {
          const absPath = abspathAgainst(effectiveCwd, span.absolutePath);
          const scope = resolveTouchScope(effectiveCwd, absPath);
          if (!scope) continue;
          const output = await runTouchHook(
            {
              kind: 'read',
              sessionId,
              cwd: effectiveCwd,
              filePath: absPath,
              offset: span.lineStart,
              limit: span.lineEnd - span.lineStart + 1
            },
            executors,
            memo
          );
          if (output.additionalContext) blocks.push(output.additionalContext);
        }
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
      // A `*** Delete File:` anchor carries the absent marker (plan §3): its
      // touch targets absence — the delete gate verifies the path is gone AND
      // was real (index-tracked or spanned) before firing. Everything else
      // targets existence.
      const output = await runTouchHook(
        {
          kind: 'write',
          sessionId,
          cwd,
          filePath: absPath,
          written: '',
          targetState: anchor.absent ? 'absent' : 'exists',
          ...(anchor.absent ? { postState: { realDelete: true } } : {})
        },
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

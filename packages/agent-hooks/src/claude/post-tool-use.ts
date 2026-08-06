/**
 * Claude PostToolUse touch hook — thin SDK-bound entry point.
 *
 * Fires after a successful `Read`/`Edit`/`Write`, or a `Bash` call whose
 * `command` statically resolves to recognizable file+line-range idioms. The
 * Claude-specific job is translating the structured `tool_input`
 * (`file_path`, `new_string`/`content`, `offset`/`limit`) and `tool_name` into
 * a harness-agnostic {@link TouchInput}, then handing off to the shared
 * {@link runTouchHook} core: on a write it heals
 * positional span drift in the working tree (`git span drift <file> --fix`) and
 * folds any semantic residue into one `<git-span>` block; on a read it surfaces
 * spans overlapping the read's `offset`/`limit` window (whole-file when neither
 * is given) with positional statuses filtered out, and never mutates the tree.
 *
 * The block reaches the model loop via `hookSpecificOutput.additionalContext` and
 * the user-facing UI via `systemMessage`. Fail-open is load-bearing: an absent
 * CLI/`.span/`, timeout, or non-zero exit yields no signal and never blocks the
 * tool call. The timeout is milliseconds here (the Claude CLI emits ms into
 * `hooks.json`); Codex's equivalent source value is divided to seconds at emit.
 */

import {
  type HookContext,
  type PostToolUseInput,
  postToolUseHook,
  postToolUseOutput
} from '@goodfoot/claude-code-hooks';
import { derivePath } from '../common/agent-hooks-common.js';
import { bashResponseInterrupted, runBashTouches } from '../common/bash-touch.js';
import { parseCommandDetailed } from '../common/parse-command.js';
import { parseResponse, type ResponseParseInput } from '../common/parse-response.js';
import { createDiskMemoStore, type MemoFactory, resolveTouchScope } from '../common/span-surface.js';
import {
  createDefaultTouchExecutors,
  runTouchHook,
  type TouchExecutors,
  type TouchInput
} from '../common/touch-core.js';

type ToolInput = Record<string, unknown>;

/** Read a `ToolInput` field as a positive integer, or `undefined` when absent/invalid. */
function positiveIntField(toolInput: ToolInput, field: string): number | undefined {
  const raw = toolInput[field];
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : undefined;
}

/** The Bash `tool_response` fields a response-aware parse contributes, before `command`/`cwd` are attached at the call site. */
type NormalizedToolResponse = Pick<
  ResponseParseInput,
  'stdout' | 'stderr' | 'exitStatus' | 'truncated' | 'interrupted'
>;

/**
 * Normalize a Bash `tool_response` envelope into the shared parser's input
 * fields (notes/response-envelope-shapes.md). Tolerated shapes: a bare
 * string (legacy `tool_result`); the deployed CLI's object
 * `{stdout, stderr, rawOutputPath?, interrupted, timedOutAfterMs?, …}`; the
 * older `{output, success, exitCode, filePath}` object; and a
 * `[{type:'text',text}]` content-block array. Plan step 6's two regimes map
 * one-to-one: `rawOutputPath` set (the inline stdout is only a preview)
 * becomes `truncated: true` and the parser parses nothing; `interrupted` or
 * `timedOutAfterMs` (the command was cut off mid-run) becomes
 * `interrupted: true`, the complete-records regime — fully-terminated
 * records parse and the incomplete tail drops. Legacy `exitCode` becomes
 * `exitStatus` (metadata only; never a gate). Fail closed: any other shape
 * yields `null` and the branch degrades to today's command-only parsing.
 */
function normalizeToolResponse(toolResponse: unknown): NormalizedToolResponse | null {
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
    if (typeof record.stdout === 'string') {
      return {
        stdout: record.stdout,
        stderr: typeof record.stderr === 'string' ? record.stderr : undefined,
        truncated: record.rawOutputPath !== undefined,
        interrupted: record.interrupted === true || record.timedOutAfterMs !== undefined
      };
    }
    if (typeof record.output === 'string') {
      return {
        stdout: record.output,
        exitStatus: typeof record.exitCode === 'number' ? record.exitCode : undefined
      };
    }
  }
  return null;
}

/**
 * Translate a Claude tool call into a {@link TouchInput}. `Read` is a read touch
 * carrying its `offset`/`limit` (when present) for range-precise scoping;
 * `Edit`/`Write` are write touches whose `written` block is the new content the
 * tool just applied (`new_string` for Edit, `content` for Write). An unknown tool
 * or a non-string content field yields `null` (nothing to do).
 */
function toTouchInput(
  toolName: string,
  toolInput: ToolInput,
  sessionId: string,
  cwd: string,
  filePath: string
): TouchInput | null {
  if (toolName === 'Read') {
    const offset = positiveIntField(toolInput, 'offset');
    const limit = positiveIntField(toolInput, 'limit');
    return { kind: 'read', sessionId, cwd, filePath, offset, limit };
  }
  if (toolName === 'Edit' || toolName === 'Write') {
    const raw = toolName === 'Edit' ? toolInput.new_string : toolInput.content;
    const written = typeof raw === 'string' ? raw : '';
    // The Edit/Write path passes 'exists' — the tool ran, so the file is
    // present; the write gate (plan §3 step 1) verifies it before any
    // executor call.
    return { kind: 'write', sessionId, cwd, filePath, written, targetState: 'exists' };
  }
  return null;
}

export function createHandler(
  executors: TouchExecutors = createDefaultTouchExecutors(),
  memoFactory: MemoFactory = createDiskMemoStore
) {
  return async (input: PostToolUseInput, ctx: HookContext) => {
    const memo = memoFactory(ctx.logger);
    const sessionId = input.session_id;
    const cwd = input.cwd ?? '';
    const toolName = input.tool_name;
    const toolInput = (input.tool_input ?? {}) as ToolInput;

    // Bash has no `file_path` field, so it gets its own branch: run the static
    // command parser and hand the matches to the shared `runBashTouches`
    // driver (plan §3 step 2), which owns the per-command verdict thread —
    // post-state gates, join filtering, and the interrupted gate (plan §4) —
    // and returns the merged blocks for the adapters' output builders. The
    // tool_response is then normalized via `normalizeToolResponse` and merged
    // in as a second evidence source (the response pass below). A
    // command with no recognizable idiom yields no blocks and returns `null` —
    // fail-open, same as the tool path below.
    if (toolName === 'Bash') {
      const command = typeof toolInput.command === 'string' ? toolInput.command : null;
      if (!command) return null;
      // An interrupted command produces no touches, whatever its spans; the
      // driver re-checks defensively.
      if (bashResponseInterrupted(input.tool_response)) return null;
      const matches = parseCommandDetailed(command, cwd);
      const blocks = await runBashTouches(matches, sessionId, cwd, input.tool_response, executors, memo, (message) =>
        ctx.logger.warn(message)
      );
      // The tool_response is a second evidence source: response-derivable
      // commands (grep/ripgrep with numbered output, git diff/show/log -p,
      // git blame -L) locate their read windows in the output, which the
      // command text alone cannot. Normalize the envelope, merge its spans
      // with the command-derived ones, and run each as a read touch; the
      // memo dedupes duplicate surfaces across the two sources. An
      // unrecognized envelope degrades to command-only parsing.
      const response = normalizeToolResponse(input.tool_response);
      if (response !== null) {
        for (const span of parseResponse({ command, cwd, ...response })) {
          const scope = resolveTouchScope(cwd, span.absolutePath);
          if (!scope) continue;
          const output = await runTouchHook(
            {
              kind: 'read',
              sessionId,
              cwd,
              filePath: span.absolutePath,
              offset: span.lineStart,
              limit: span.lineEnd - span.lineStart + 1
            },
            executors,
            memo
          );
          if (output.additionalContext) blocks.push(output.additionalContext);
        }
      }
      if (blocks.length === 0) return null;
      const combined = blocks.join('');
      return postToolUseOutput({
        hookSpecificOutput: { additionalContext: combined },
        systemMessage: combined
      });
    }

    const absPath = derivePath(toolInput, cwd);
    if (!absPath) return null;

    // Bound the touch to the CWD repo (drops cross-repo, gitignored, and span
    // documents). Fail closed on an unresolvable CWD repo.
    const scope = resolveTouchScope(cwd, absPath);
    if (!scope) return null;

    const touch = toTouchInput(toolName, toolInput, sessionId, cwd, absPath);
    if (!touch) return null;

    const output = await runTouchHook(touch, executors, memo);
    if (!output.additionalContext) return null;

    return postToolUseOutput({
      hookSpecificOutput: { additionalContext: output.additionalContext },
      systemMessage: output.additionalContext
    });
  };
}

export default postToolUseHook({ matcher: 'Read|Edit|Write|Bash', timeout: 10_000 }, createHandler());

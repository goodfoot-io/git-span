/**
 * Claude PostToolUse touch hook — thin SDK-bound entry point.
 *
 * Fires after a successful `Read`/`Edit`/`Write`. The Claude-specific job is
 * translating the structured `tool_input` (`file_path`, `new_string`/`content`)
 * and `tool_name` into a harness-agnostic {@link TouchInput}, then handing off to
 * the shared {@link runTouchHook} core: on a write it heals positional span drift
 * in the working tree (`git span stale <file> --fix`) and folds any semantic
 * residue into one `<git-span>` block; on a read it surfaces overlapping spans
 * with positional statuses filtered out and never mutates the tree.
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
import { createDiskMemoStore, type MemoFactory, resolveTouchScope } from '../common/span-surface.js';
import {
  createDefaultTouchExecutors,
  runTouchHook,
  type TouchExecutors,
  type TouchInput
} from '../common/touch-core.js';

type ToolInput = Record<string, unknown>;

/**
 * Translate a Claude tool call into a {@link TouchInput}. `Read` is a read touch;
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
    return { kind: 'read', sessionId, cwd, filePath };
  }
  if (toolName === 'Edit' || toolName === 'Write') {
    const raw = toolName === 'Edit' ? toolInput.new_string : toolInput.content;
    const written = typeof raw === 'string' ? raw : '';
    return { kind: 'write', sessionId, cwd, filePath, written };
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

    const absPath = derivePath(toolInput, cwd);
    if (!absPath) return postToolUseOutput({});

    // Bound the touch to the CWD repo (drops cross-repo, gitignored, and span
    // documents). Fail closed on an unresolvable CWD repo.
    const scope = resolveTouchScope(cwd, absPath);
    if (!scope) return postToolUseOutput({});

    const touch = toTouchInput(toolName, toolInput, sessionId, cwd, absPath);
    if (!touch) return postToolUseOutput({});

    const output = await runTouchHook(touch, executors, memo);
    if (!output.additionalContext) return postToolUseOutput({});

    return postToolUseOutput({
      hookSpecificOutput: { additionalContext: output.additionalContext },
      systemMessage: output.additionalContext
    });
  };
}

export default postToolUseHook({ matcher: 'Read|Edit|Write', timeout: 10_000 }, createHandler());

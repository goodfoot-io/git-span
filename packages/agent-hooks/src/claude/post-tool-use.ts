/**
 * Claude PostToolUse touch hook — heal + surface after a successful
 * `Read`/`Edit`/`Write`, or a `Bash` call.
 *
 * Fires after a successful `Read`/`Edit`/`Write`, or a `Bash` call. The
 * Claude-specific job is translating the structured `tool_input`
 * (`file_path`, `new_string`/`content`, `offset`/`limit`) and `tool_name` into
 * a harness-agnostic {@link TouchInput}, then handing off to the shared
 * {@link runTouchHook} core: on a write it heals
 * positional span drift in the working tree (`git span drift <file> --fix`) and
 * folds any semantic residue into one `<git-span>` block; on a read it surfaces
 * spans overlapping the read's `offset`/`limit` window (whole-file when neither
 * is given) with positional statuses filtered out, and never mutates the tree.
 *
 * A `Bash` call is snapshot-first: when the snapshot classifier decides a
 * pre-capture record should exist for the command, the record's tree-to-tree
 * comparison (the shared {@link snapshotBashBranch}) is authoritative — exact
 * post-state ranges for changed files, whole-file scopes for
 * creates/deletes/renames, interleaved-edit resolution against the activity
 * log, and the concurrency ambiguity table — and the static-parse path runs
 * only as a co-parser for spans the snapshot did not cover (its paths are
 * skipped when the comparison attributed or dropped them). When no record
 * exists (the pre capture failed open, or the classifier says the command is
 * read-only or statically covered), the static path stays authoritative.
 *
 * The block reaches the model loop via `hookSpecificOutput.additionalContext` and
 * the user-facing UI via `systemMessage`. Fail-open is load-bearing: an absent
 * CLI/`.span/`, timeout, or non-zero exit yields no signal and never blocks the
 * tool call. The timeout is milliseconds here (the Claude CLI emits ms into
 * `hooks.json`); Codex's equivalent source value is divided to seconds at emit.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  type HookContext,
  type PostToolUseInput,
  postToolUseHook,
  postToolUseOutput
} from '@goodfoot/claude-code-hooks';
import {
  DEFAULT_SESSION_LAYOUT,
  derivePath,
  resolveRepoRoot,
  type SessionLayout
} from '../common/agent-hooks-common.js';
import { bashSpanToTouch } from '../common/bash-touch.js';
import { parseCommandDetailed } from '../common/parse-command.js';
import { parseResponse, type ResponseParseInput } from '../common/parse-response.js';
import { classifyCommandForSnapshot } from '../common/snapshot-core.js';
import {
  resolveSnapshotBudgets,
  SNAPSHOT_RECORDLESS_NOTE,
  shouldSurfaceRecordlessNote,
  snapshotBashBranch
} from '../common/snapshot-harness.js';
import { createSnapshotStore, finishActivityEntry } from '../common/snapshot-store.js';
import { createDiskMemoStore, type MemoFactory, type MemoStore, resolveTouchScope } from '../common/span-surface.js';
import {
  createDefaultTouchExecutors,
  runTouchHook,
  type TouchExecutors,
  type TouchInput
} from '../common/touch-core.js';
import { narrowCommand } from './snapshot.js';

type ToolInput = Record<string, unknown>;

/** Read a `ToolInput` field as a positive integer, or `undefined` when absent/invalid. */
function positiveIntField(toolInput: ToolInput, field: string): number | undefined {
  const raw = toolInput[field];
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : undefined;
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

/** sha256 hex of a file's bytes, or null when the read fails. */
function hashOfFile(absPath: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(absPath)).digest('hex');
  } catch {
    return null;
  }
}

/** The empty exclude set — the static co-parser's default when no snapshot ran. */
const EMPTY_PATHS: ReadonlySet<string> = new Set();

/** The Bash `tool_response` fields a response-aware parse contributes, before `command`/`cwd` are attached at the call site. */
type NormalizedToolResponse = Pick<ResponseParseInput, 'stdout' | 'stderr' | 'exitStatus' | 'truncated'>;

/**
 * Normalize a Bash `tool_response` envelope into the shared parser's input
 * fields (notes/response-envelope-shapes.md). Tolerated shapes: a bare
 * string (legacy `tool_result`); the deployed CLI's object
 * `{stdout, stderr, rawOutputPath?, interrupted, timedOutAfterMs?, …}`; the
 * older `{output, success, exitCode, filePath}` object; and a
 * `[{type:'text',text}]` content-block array. `rawOutputPath` set (the
 * inline stdout is only a preview), `interrupted`, or `timedOutAfterMs`
 * marks the response truncated — the parser fails closed on the flag and
 * parses nothing. Legacy `exitCode` becomes `exitStatus` (metadata only;
 * never a gate). Fail closed: any other shape yields `null` and the branch
 * degrades to today's command-only parsing.
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
        truncated:
          record.rawOutputPath !== undefined || record.interrupted === true || record.timedOutAfterMs !== undefined
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
 * The static-parse Bash path, extracted so the snapshot branch can co-run it:
 * parse the command and translate every resolved span into a touch through the
 * same shared core. `excludedPaths` (repo-relative) are skipped — paths the
 * snapshot comparison already attributed or dropped must not be surfaced twice.
 * With the empty set this is byte-identical to Phase 1's standalone Bash loop.
 *
 * `toolResponse` is the second evidence source: response-derivable commands
 * (grep/ripgrep with numbered output, git diff/show/log -p, git blame -L)
 * locate their read windows in the output, which the command text alone
 * cannot. Its spans merge with the command-derived ones and run through the
 * same excludedPaths filter and shared touch core; the per-session memo
 * dedupes duplicate surfaces across the two sources. An unrecognized envelope
 * degrades to command-only parsing.
 */
async function runStaticParseTouches(
  command: string,
  cwd: string,
  sessionId: string,
  executors: TouchExecutors,
  memo: MemoStore,
  excludedPaths: ReadonlySet<string> = EMPTY_PATHS,
  toolResponse?: unknown
): Promise<string[]> {
  const blocks: string[] = [];
  const matches = parseCommandDetailed(command, { cwd });
  for (const match of matches) {
    if (match.status !== 'resolved') continue;
    const span = match.span;
    const scope = resolveTouchScope(cwd, span.absolutePath);
    if (!scope) continue;
    if (excludedPaths.has(scope.repoRelPath)) continue;
    const touch = bashSpanToTouch(span, sessionId, cwd);
    if (!touch) continue;
    const output = await runTouchHook(touch, executors, memo);
    if (output.additionalContext) blocks.push(output.additionalContext);
  }
  const response = normalizeToolResponse(toolResponse);
  if (response !== null) {
    for (const span of parseResponse({ command, cwd, ...response })) {
      const scope = resolveTouchScope(cwd, span.absolutePath);
      if (!scope) continue;
      if (excludedPaths.has(scope.repoRelPath)) continue;
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
  return blocks;
}

export function createHandler(
  executors: TouchExecutors = createDefaultTouchExecutors(),
  memoFactory: MemoFactory = createDiskMemoStore,
  layout: SessionLayout = DEFAULT_SESSION_LAYOUT
) {
  return async (input: PostToolUseInput, ctx: HookContext) => {
    const memo = memoFactory(ctx.logger, layout);
    const sessionId = input.session_id;
    const cwd = input.cwd ?? '';
    const toolName = input.tool_name;
    const toolInput = (input.tool_input ?? {}) as ToolInput;

    // Bash has no `file_path` field, so it gets its own branch: snapshot-first
    // when the classifier decides a snapshot should exist — the comparison is
    // authoritative, and the static parser co-runs only for spans the
    // snapshot did not cover (its attributed/dropped paths are skipped).
    // Without a record the static path stays authoritative, byte-identical to
    // Phase 1. A command with no recognized idiom yields no blocks and returns
    // `null` — fail-open, same as the tool path below.
    if (toolName === 'Bash') {
      const command = narrowCommand(input.tool_input);
      if (!command) return null;
      // The snapshot surface is keyed by (session_id, tool_use_id) — a post
      // event without tool_use_id can never correlate a record, so the branch
      // fails open to the static path (contract tests call this shape).
      // Transcript-visible note for a decided-but-recordless snapshot: set when
      // the snapshot branch falls back to the static path, unshifted into the
      // blocks below (declared at Bash-block scope — the static tail runs for
      // both the snapshot and non-snapshot paths).
      let attributionNote: string | null = null;
      // The snapshot surface is anchored at the hook cwd's repo — resolve it
      // once: the budgets resolve against it, and the no-record note fires
      // only when the repo exists at post time. In a repo-less cwd the pre
      // walk could never have created a record, so the note would be
      // guaranteed spurious ("...the static spans below..." with no spans) —
      // the fallback is silent there, per the "silence is the correct steady
      // state" contract.
      const repoRoot = resolveRepoRoot(cwd);
      if (input.tool_use_id && classifyCommandForSnapshot(command, cwd).decision.kind === 'snapshot') {
        // Same resolution as the pre side (env → repo config → defaults); a
        // repo-less cwd resolves null and skips the config layer only.
        const budgets = resolveSnapshotBudgets(repoRoot);
        const store = createSnapshotStore(ctx.logger, budgets, layout);
        const outcome = await snapshotBashBranch(
          store,
          sessionId,
          input.tool_use_id,
          cwd,
          executors,
          memo,
          ctx.logger,
          budgets
        );
        if (outcome.kind === 'tombstoned') return null;
        if (outcome.kind === 'no-record') {
          if (repoRoot !== null) {
            // The pre-walk failed open (or never ran) — the loss is visible,
            // never silent, and the static path still runs. The note is
            // transcript-visible so the model sees WHY no snapshot attribution
            // happened — a logger-only warn is invisible to it.
            ctx.logger.warn('git-span: snapshot decided but no record exists; falling back to the static path');
            attributionNote = SNAPSHOT_RECORDLESS_NOTE;
          }
        } else {
          const blocks: string[] = [];
          if (outcome.additionalContext) blocks.push(outcome.additionalContext);
          blocks.push(
            ...(await runStaticParseTouches(
              command,
              cwd,
              sessionId,
              executors,
              memo,
              outcome.excludedPaths,
              input.tool_response
            ))
          );
          if (blocks.length === 0) return null;
          const combined = blocks.join('');
          return postToolUseOutput({
            hookSpecificOutput: { additionalContext: combined },
            systemMessage: combined
          });
        }
      }
      const blocks = await runStaticParseTouches(
        command,
        cwd,
        sessionId,
        executors,
        memo,
        EMPTY_PATHS,
        input.tool_response
      );
      // The note is only worth surfacing when the static fallback actually
      // found something to attribute — that's the signal a write happened
      // but escaped snapshot tracking (a real degradation). An empty
      // fallback means nothing was written; unshifting the note in that case
      // would make it unconditional (blocks.length would never be 0), firing
      // on every recordless no-op command instead of just the lossy ones —
      // and it would dangle its "the static spans below" promise. At most
      // one appearance per session, via the shared disk-marker gate.
      if (blocks.length === 0) return null;
      if (attributionNote !== null && shouldSurfaceRecordlessNote(sessionId, ctx.logger, layout)) {
        blocks.unshift(attributionNote);
      }
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

    // Activity-log stamp: at the end of the edit's own touch, stamp the
    // path's postHash (the on-disk state its touch read) plus finishedAt, so
    // an interleaved-edit check inside a Bash snapshot window can resolve this
    // edit's boundary. A failed read leaves postHash null — a null stamp can
    // never resolve a boundary as clean. Fail open and continue the touch path.
    if (touch.kind === 'write') {
      try {
        finishActivityEntry(scope.repoRoot, sessionId, input.tool_use_id, [
          { path: scope.repoRelPath, postHash: hashOfFile(absPath) }
        ]);
      } catch (err) {
        ctx.logger.warn('git-span activity-log stamp failed open', { err });
      }
    }

    if (!output.additionalContext) return null;

    return postToolUseOutput({
      hookSpecificOutput: { additionalContext: output.additionalContext },
      systemMessage: output.additionalContext
    });
  };
}

export default postToolUseHook({ matcher: 'Read|Edit|Write|Bash', timeout: 10_000 }, createHandler());

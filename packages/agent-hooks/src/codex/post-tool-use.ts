/**
 * Codex PostToolUse touch hook — snapshot-first after a confirmed shell call,
 * heal + surface after a confirmed `apply_patch`.
 *
 * A shell call (`Bash`/`exec_command`/`exec` — same matcher family as the
 * advisor) is snapshot-first: when the snapshot classifier decides a
 * pre-capture record should exist for the command, the record's tree-to-tree
 * comparison (the shared {@link snapshotBashBranch} from the harness-agnostic
 * common/snapshot-harness.ts — no SDK imports, so the codex bundle stays
 * hermetic) is authoritative — exact post-state ranges for changed files,
 * whole-file scopes for creates/deletes/renames, interleaved-edit resolution
 * against the activity log, and the concurrency ambiguity table — and the
 * static-parse path runs only as a co-parser for spans the snapshot did not
 * cover. When no record exists (the pre capture failed open, or the
 * classifier says the command is read-only or statically covered), the static
 * path stays authoritative.
 *
 * `apply_patch` is the touch path: one envelope may touch several files, so
 * each parsed anchor runs through the shared {@link runTouchHook} core with a
 * whole-file scope (Codex never recovers a post-edit range), and each anchor's
 * `postHash` is stamped into its activity entry — the state the touch read —
 * closing the interleaved-edit boundary the activity-log pre-hook opened.
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
 * The platform asymmetry is deliberately absent here: Codex has no
 * PostToolUseFailure event, so a failed call's record is never attributed and
 * never silently discarded — it stays live as ambiguity evidence and is
 * reclaimed by the Stop/TTL cleanup (always-discard by construction).
 *
 * The timeout is milliseconds in the handler config (the CLI emits `10` seconds)
 * — see the timeout-units spike note; the source value must stay in ms so the
 * Codex build's seconds conversion at emit remains correct.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { type HookContext, type PostToolUseInput, postToolUseHook, postToolUseOutput } from '@goodfoot/codex-hooks';
import { abspathAgainst, resolveRepoRoot } from '../common/agent-hooks-common.js';
import { bashSpanToTouch } from '../common/bash-touch.js';
import { parseCommandDetailed } from '../common/parse-command.js';
import { parseResponse, type ResponseParseInput } from '../common/parse-response.js';
import { classifyCommandForSnapshot } from '../common/snapshot-core.js';
import { resolveSnapshotBudgets, snapshotBashBranch } from '../common/snapshot-harness.js';
import { createSnapshotStore, finishActivityEntry } from '../common/snapshot-store.js';
import { createDiskMemoStore, type MemoFactory, type MemoStore, resolveTouchScope } from '../common/span-surface.js';
import { createDefaultTouchExecutors, runTouchHook, type TouchExecutors } from '../common/touch-core.js';
import { extractShellCommand } from './advisor.js';
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
          // parse-response.ts's `interrupted` field is not yet load-bearing
          // (its complete-records regime is undocumented future work) — until
          // that phase lands, `interrupted`/`timedOutAfterMs` collapse into
          // `truncated` so the response fails closed today, same as the
          // Claude adapter's envelope normalization.
          truncated:
            record.rawOutputPath !== undefined || record.interrupted === true || record.timedOutAfterMs !== undefined,
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

/**
 * The static-parse shell path, extracted so the snapshot branch can co-run it:
 * parse the command and translate every resolved span into a touch through the
 * same shared core. `cwd` is the effective frame (the envelope's workdir when
 * one is present, else the hook cwd) — the parse base, the absolutization
 * base, and the touch record's cwd, which the executors drive their git span
 * runs from. `excludedPaths` (repo-relative) are skipped — paths the snapshot
 * comparison already attributed or dropped must not be surfaced twice. With
 * the empty set this is byte-identical to Phase 1's standalone shell loop.
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
    const absPath = abspathAgainst(cwd, span.absolutePath);
    const scope = resolveTouchScope(cwd, absPath);
    if (!scope) continue;
    if (excludedPaths.has(scope.repoRelPath)) continue;
    const touch = bashSpanToTouch(span, sessionId, cwd);
    if (!touch) continue;
    const output = await runTouchHook(touch, executors, memo);
    if (output.additionalContext) blocks.push(output.additionalContext);
  }
  const response = normalizeShellResponse(toolResponse);
  if (response !== null) {
    for (const span of parseResponse({ command, cwd, ...response })) {
      const absPath = abspathAgainst(cwd, span.absolutePath);
      const scope = resolveTouchScope(cwd, absPath);
      if (!scope) continue;
      if (excludedPaths.has(scope.repoRelPath)) continue;
      const output = await runTouchHook(
        {
          kind: 'read',
          sessionId,
          cwd,
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
  return blocks;
}

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
    // Snapshot-first when the classifier decides a snapshot should exist: the
    // comparison is authoritative, and the static parser co-runs only for spans
    // the snapshot did not cover (its attributed/dropped paths are skipped).
    // Without a record the static path stays authoritative, byte-identical to
    // Phase 1. A command with no recognized idiom yields no blocks and returns
    // undefined — fail-open, same as the apply_patch path below.
    if (
      tool_name === 'Bash' ||
      tool_name === 'shell' ||
      tool_name === 'local_shell' ||
      tool_name === 'exec_command' ||
      tool_name === 'exec'
    ) {
      // Extraction-first: the shell envelopes (Bash/shell/local_shell — the
      // harness already unwrapped the code-mode envelope, so the command sits in
      // `tool_input.command` as a string or argv array, exactly as the Claude
      // adapter receives it) all resolve via extractShellCommand; the classic
      // `exec_command` envelope carries `workdir` beside `cmd` (plan §8) and
      // threads it through like the code-mode envelope below.
      let command: string | null = extractShellCommand(input.tool_input);
      let workdir: string | null = null;
      if (command === null) {
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
      // static touch (parse base, absolutization, scope check, and the touch
      // record's cwd, which the executors drive their git span runs from). A
      // template-literal workdir (containing `$`/backtick) is unresolvable and
      // falls back to hook `cwd`.
      const effectiveCwd = workdir !== null && !/[`$]/.test(workdir) ? resolvePath(cwd, workdir) : cwd;

      // Snapshot-first when the classifier decides a snapshot should exist: the
      // comparison is authoritative, and the static parser co-runs only for
      // spans the snapshot did not cover (its attributed/dropped paths are
      // skipped). The snapshot surface is anchored at `effectiveCwd` — the
      // pre hook classifies, resolves, and walks at the SAME frame (the
      // envelope's workdir when one is present, else the hook cwd), so a
      // write through a workdir pointing into another repo is recorded,
      // compared, and attributed in that repo — never silently lost. The
      // snapshot surface is keyed by (session_id, tool_use_id) — a post
      // event without tool_use_id can never correlate a record, so the branch
      // fails open to the static path (contract tests call this shape).
      // Transcript-visible note for a decided-but-recordless snapshot: set when
      // the snapshot branch falls back to the static path, unshifted into the
      // blocks below (declared at Bash-block scope — the static tail runs for
      // both the snapshot and non-snapshot paths).
      let attributionNote: string | null = null;
      // The snapshot surface is anchored at effectiveCwd's repo — resolve it
      // once: the budgets resolve against it, and the no-record note fires
      // only when the repo exists at post time. In a repo-less cwd the pre
      // walk could never have created a record, so the note would be
      // guaranteed spurious ("...the static spans below..." with no spans) —
      // the fallback is silent there, per the "silence is the correct steady
      // state" contract.
      const repoRoot = resolveRepoRoot(effectiveCwd);
      if (input.tool_use_id && classifyCommandForSnapshot(command, effectiveCwd).decision.kind === 'snapshot') {
        // Same resolution as the pre side (env → repo config → defaults); a
        // repo-less cwd resolves null and skips the config layer only.
        const budgets = resolveSnapshotBudgets(repoRoot);
        const store = createSnapshotStore(ctx.logger, budgets);
        const outcome = await snapshotBashBranch(
          store,
          sessionId,
          input.tool_use_id,
          effectiveCwd,
          executors,
          memo,
          ctx.logger,
          budgets
        );
        if (outcome.kind === 'tombstoned') return undefined;
        if (outcome.kind === 'no-record') {
          if (repoRoot !== null) {
            // The pre-walk failed open (or never ran) — the loss is visible,
            // never silent, and the static path still runs. The note is
            // transcript-visible so the model sees WHY no snapshot attribution
            // happened — a logger-only warn is invisible to it.
            ctx.logger.warn('git-span: snapshot decided but no record exists; falling back to the static path');
            attributionNote =
              "git-span: snapshot record unavailable — this command's file writes were not snapshot-attributed; the static spans below are the only attribution";
          }
        } else {
          const blocks: string[] = [];
          if (outcome.additionalContext) blocks.push(outcome.additionalContext);
          blocks.push(
            ...(await runStaticParseTouches(
              command,
              effectiveCwd,
              sessionId,
              executors,
              memo,
              outcome.excludedPaths,
              input.tool_response
            ))
          );
          if (blocks.length === 0) return undefined;
          const combined = blocks.join('');
          return postToolUseOutput({ additionalContext: combined, systemMessage: combined });
        }
      }
      const blocks = await runStaticParseTouches(
        command,
        effectiveCwd,
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
      // on every recordless no-op command instead of just the lossy ones.
      if (blocks.length === 0) return undefined;
      if (attributionNote !== null) blocks.unshift(attributionNote);
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

      // Activity-log stamp: at the end of this anchor's own touch, stamp the
      // path's postHash (the state its touch read) plus finishedAt, so an
      // interleaved-edit check inside a shell snapshot window can resolve the
      // patch's boundary. A failed read leaves postHash null — a null stamp can
      // never resolve a boundary as clean. Fail open and continue the touch path.
      try {
        finishActivityEntry(scope.repoRoot, sessionId, input.tool_use_id, [
          { path: scope.repoRelPath, postHash: hashOfFile(absPath) }
        ]);
      } catch (err) {
        ctx.logger.warn('git-span activity-log stamp failed open', { err });
      }

      if (output.additionalContext) blocks.push(output.additionalContext);
    }

    if (blocks.length === 0) return undefined;
    const combined = blocks.join('');
    return postToolUseOutput({ additionalContext: combined, systemMessage: combined });
  };
}

/**
 * The tool-name family the Post handler can consume: the pre family (every
 * spelling the pre matcher registers — `shell`/`local_shell` included) plus
 * `apply_patch`. Exported so the fixture can pin pre ⊆ post: a pre-registered
 * spelling the post side cannot consume breaks the matcher-family test.
 */
export const SNAPSHOT_POST_MATCHER = 'apply_patch|exec_command|exec|shell|local_shell|Bash';

// The matcher must be a STRING LITERAL, not the identifier reference: the
// codex-hooks build CLI extracts a hook's matcher only from a literal
// initializer and silently leaves it undefined otherwise — an identifier
// reference would emit an unconstrained hook that runs for every tool
// occurrence. The literal must stay textually identical to
// SNAPSHOT_POST_MATCHER (the fixture that pins pre ⊆ post imports the
// constant, and the hook-build portability test asserts the emitted matcher
// equals the constant). The post family deliberately includes `apply_patch`
// — the post hook must run for the touch path.
export default postToolUseHook(
  { matcher: 'apply_patch|exec_command|exec|shell|local_shell|Bash', timeout: 10_000 },
  createHandler()
);

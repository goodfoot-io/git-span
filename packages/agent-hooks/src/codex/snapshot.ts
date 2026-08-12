/**
 * Codex PreToolUse snapshot hook — the snapshot decision + write-tree capture.
 *
 * Fires before `Bash`/`shell`/`exec`/`local_shell`/`exec_command` tool calls,
 * on the same matcher as the advisor. Mirrors the Claude snapshot hook:
 * classify the command via {@link classifyCommandForSnapshot} and, on a
 * snapshot decision, take the private write-tree capture and persist the
 * tree-SHA record for (session_id, tool_use_id) via
 * {@link capturePreSnapshot}. Codex adds `agent_id` to the record when
 * present, so SubagentStop can remove only the subagent's records. Fail-open
 * is load-bearing: any error yields no record and never blocks the command —
 * the Post side then falls back to today's static-parse path.
 *
 * The capture mechanism lives in the harness-agnostic
 * [snapshot-harness.ts](../common/snapshot-harness.ts) — no SDK imports, so
 * the codex bundle stays hermetic; only the envelope narrowing (the shell
 * envelope family and its `workdir` frame) is Codex-specific here.
 */

import { resolve as resolvePath } from 'node:path';
import { type HookContext, type PreToolUseInput, preToolUseHook } from '@goodfoot/codex-hooks';
import { DEFAULT_SESSION_LAYOUT, resolveRepoRoot, type SessionLayout } from '../common/agent-hooks-common.js';
import { classifyCommandForSnapshot } from '../common/snapshot-core.js';
import { capturePreSnapshot, resolveSnapshotBudgets } from '../common/snapshot-harness.js';
import { createSnapshotStore } from '../common/snapshot-store.js';
import { extractShellCommand } from './advisor.js';
import { narrowCodeModeExec, narrowExecCommand } from './post-tool-use.js';

export function createHandler(layout: SessionLayout = DEFAULT_SESSION_LAYOUT) {
  return async (input: PreToolUseInput, ctx: HookContext) => {
    try {
      // A PreToolUse event without session_id or tool_use_id can never be
      // correlated — fail open, no record (per the plan).
      if (!input.session_id || !input.tool_use_id) return undefined;
      // The command rides in any of the shell envelopes: the harness-unwrapped
      // `command` (string or argv — extractShellCommand), the classic
      // exec_command JSON `arguments`, or the code-mode exec JS `input` —
      // mirroring the Post side, the classic and code-mode envelopes carry a
      // `workdir` beside the command that must be threaded the same way.
      let command: string | null = extractShellCommand(input.tool_input);
      let workdir: string | null = null;
      if (command === null) {
        const classic = narrowExecCommand(input.tool_input);
        command = classic?.cmd ?? null;
        workdir = classic?.workdir ?? null;
      }
      if (command === null) {
        const codeMode = narrowCodeModeExec(input.tool_input);
        command = codeMode.cmd;
        workdir = codeMode.workdir;
      }
      if (command === null) return undefined;
      // The same frame rule the Post side uses (Plan §8): a workdir present
      // and free of `$`/backtick absolutizes against the envelope's own
      // `input.cwd` — the shell tool resolves a relative workdir against that
      // same base — and is the single frame for classify, repo resolution,
      // and the capture. A template-literal workdir (containing `$`/backtick)
      // is unresolvable and falls back to hook `cwd`. A workdir pointing into
      // another repo records THAT repo — the Post side's compare runs at the
      // record's repoRoot, so a workdir-pointed write is attributed in the
      // workdir repo, never silently lost.
      const effectiveCwd =
        workdir !== null && !/[`$]/.test(workdir) ? resolvePath(input.cwd ?? '', workdir) : (input.cwd ?? '');
      const plan = classifyCommandForSnapshot(command, effectiveCwd);
      if (plan.decision.kind !== 'snapshot') {
        // No snapshot: the command has no write-capable command, or every
        // write is statically covered and provably expansion-free — the Post
        // side's static-parse path stays authoritative.
        return undefined;
      }
      const repoRoot = resolveRepoRoot(effectiveCwd);
      if (repoRoot === null) return undefined; // no repo, no record — fail open
      const budgets = resolveSnapshotBudgets(repoRoot);
      const result = capturePreSnapshot({
        store: createSnapshotStore(ctx.logger, budgets, layout),
        sessionId: input.session_id,
        toolUseId: input.tool_use_id,
        ...(input.agent_id !== undefined ? { agentId: input.agent_id } : {}),
        repoRoot,
        budgets,
        logger: ctx.logger
      });
      if (result === null) return undefined; // total capture failure — fail open
      ctx.logger.info('git-span snapshot pre-capture', {
        toolUseId: input.tool_use_id,
        decision: plan.decision.reason,
        treeSha: result.treeSha,
        gaps: result.gaps,
        refused: !result.wrote
      });
      return undefined;
    } catch (err) {
      // Fail open: never let the snapshot pre-hook block the command. A
      // missing record degrades that call to the static path — visible only
      // via the Post classifier's missing-record warning.
      ctx.logger.warn('git-span snapshot pre-hook failed open on an uncaught error', { err });
      return undefined;
    }
  };
}

/**
 * The tool-name family this pre hook registers for — every spelling the pre
 * side can be asked to snapshot. The Post side must be able to consume each
 * of these (matcher and handler gate), so the family is exported for the
 * fixture that pins pre ⊆ post.
 */
export const SNAPSHOT_PRE_MATCHER = 'Bash|shell|exec|local_shell|exec_command';

// The matcher must be a STRING LITERAL, not the identifier reference: the
// codex-hooks build CLI extracts a hook's matcher only from a literal
// initializer and silently leaves it undefined otherwise — an identifier
// reference would emit an unconstrained hook that runs for every tool
// occurrence. The literal must stay textually identical to
// SNAPSHOT_PRE_MATCHER (the fixture that pins pre ⊆ post imports the
// constant, and the hook-build portability test asserts the emitted matcher
// equals the constant).
export default preToolUseHook(
  { matcher: 'Bash|shell|exec|local_shell|exec_command', timeout: 10_000 },
  createHandler()
);

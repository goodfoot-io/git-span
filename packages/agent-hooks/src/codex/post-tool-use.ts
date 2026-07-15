/**
 * Codex PostToolUse hook — journal the confirmed `apply_patch` write.
 *
 * PostToolUse fires after `apply_patch` succeeds, so this is the accurate home
 * for journaling the actual write (the edit has landed) — the recommendation in
 * the event-mapping note, since the reconciler runs post-commit anyway. This
 * handler's only job is **journaling**: it parses the same `apply_patch` envelope
 * (`tool_input.command`, narrowed from the SDK's `unknown`) into `AnchorSpec[]`
 * via the shared [apply-patch parser](./apply-patch.ts), scopes each touched file
 * to the CWD repo (dropping cross-repo, gitignored, and span-document paths via
 * the shared guard), and appends the write anchors to the per-session touch
 * journal that the Stop core later drains into a `PreCommitRecord`.
 *
 * Span surfacing is the PreToolUse hook's job (before the patch applies); this
 * hook never surfaces. The timeout is milliseconds in the handler config (the
 * CLI emits `10` seconds) — see the timeout-units spike note.
 */

import { type HookContext, type PostToolUseInput, postToolUseHook, postToolUseOutput } from '@goodfoot/codex-hooks';
import { abspathAgainst } from '../common/agent-hooks-common.js';
import { resolveTouchScope } from '../common/span-surface.js';
import { appendTouchJournal } from '../common/stop-core.js';
import { defaultReadPreEditFile, parseApplyPatch, type ReadPreEditFile } from './apply-patch.js';
import { narrowApplyPatchCommand } from './pre-tool-use.js';

export function createHandler(readPreEditFile: ReadPreEditFile = defaultReadPreEditFile) {
  return (input: PostToolUseInput, ctx: HookContext) => {
    const command = narrowApplyPatchCommand(input.tool_input);
    if (command === null) return postToolUseOutput({});

    const cwd = input.cwd ?? '';
    const sessionId = input.session_id;

    // Parse the confirmed write into per-file anchors, then journal each one that
    // scopes to the CWD repo. `resolveTouchScope` drops cross-repo, gitignored,
    // and span-document paths and yields the repo-relative path the journal and
    // the Stop drain expect — the same invariant the Claude PreToolUse hook holds.
    const anchors = parseApplyPatch(command, readPreEditFile);
    const entries: Array<{
      path: string;
      kind: (typeof anchors)[number]['kind'];
      range?: (typeof anchors)[number]['range'];
    }> = [];
    for (const anchor of anchors) {
      const absPath = abspathAgainst(cwd, anchor.path);
      const scope = resolveTouchScope(cwd, absPath);
      if (!scope) continue;
      entries.push({ path: scope.repoRelPath, kind: anchor.kind, range: anchor.range });
    }

    appendTouchJournal(sessionId, 'apply_patch', entries, ctx.logger);

    return postToolUseOutput({});
  };
}

export default postToolUseHook({ matcher: 'apply_patch', timeout: 10_000 }, createHandler());

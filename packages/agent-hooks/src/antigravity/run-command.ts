/**
 * Narrowing for Antigravity's `run_command` tool call — the one shell
 * envelope the pinned contract names (live-verified `args` shape:
 * `{ CommandLine, Cwd }`, PascalCase keys). Shared by every adapter that
 * reads a `run_command` call so the narrowing cannot drift between the
 * advisor, the planner, and the touch join.
 */

import type { AntigravityToolCall } from '@goodfoot/agent-hooks/antigravity';
import type { StashedToolCall } from './stash.js';

export interface RunCommandCall {
  command: string;
  /** `args.Cwd` when present — the host's own resolved working directory. */
  cwd: string | null;
}

/**
 * Narrow a `toolCall` (live from PreToolUse, or replayed from the stash) into
 * the command string and frame the shared cores consume. Returns `null` when
 * no non-empty `CommandLine` is recoverable.
 */
export function narrowRunCommand(toolCall: AntigravityToolCall | StashedToolCall): RunCommandCall | null {
  if (toolCall.name !== 'run_command') return null;
  const commandLine = toolCall.args.CommandLine;
  if (typeof commandLine !== 'string' || commandLine.length === 0) return null;
  const cwd = toolCall.args.Cwd;
  return { command: commandLine, cwd: typeof cwd === 'string' && cwd.length > 0 ? cwd : null };
}

/**
 * The frame relative paths resolve against: the call's own `Cwd` when the
 * host sent one, else the first workspace root, else empty (the shared cores
 * treat an empty frame as "no repository" and fail open).
 */
export function resolveCallCwd(call: RunCommandCall, workspacePaths: readonly string[]): string {
  return call.cwd ?? workspacePaths[0] ?? '';
}

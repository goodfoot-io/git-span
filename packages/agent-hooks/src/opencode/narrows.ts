/**
 * Pure per-tool-id narrowing for the OpenCode adapter.
 *
 * OpenCode has no hook matcher strings — hooks receive every tool and filter
 * by exact tool id themselves. The literal ids this adapter covers (verified
 * live, `notes/opencode-runtime-spikes.md` S1): `bash`
 * (`{command, timeout?, workdir?}`), `read` (`{filePath, offset?, limit?}`),
 * `edit` (`{filePath, oldString, newString, replaceAll?}`), `write`
 * (`{content, filePath}`), and `apply_patch` (`{patchText}`, gpt-models only).
 * OpenCode's experimental code-mode `execute` tool is deliberately excluded —
 * commands issued through it bypass attribution and advisory checks alike
 * (accepted v1 gap, documented in the skill reference and website docs).
 *
 * Every narrow is total over garbage input: malformed shapes resolve to
 * `null`, never a throw — the fail-open contract starts at the argument edge.
 */

export interface OpencodeBashArgs {
  command: string;
  /** Resolved by the host against the instance directory; absent = instance dir. */
  workdir?: string;
}

export interface OpencodeReadArgs {
  filePath: string;
  offset?: number;
  limit?: number;
}

export interface OpencodeWriteArgs {
  filePath: string;
  written: string;
}

function stringField(args: unknown, field: string): string | undefined {
  if (args === null || typeof args !== 'object' || !(field in args)) return undefined;
  const value = (args as Record<string, unknown>)[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function positiveIntField(args: unknown, field: string): number | undefined {
  if (args === null || typeof args !== 'object' || !(field in args)) return undefined;
  const value = (args as Record<string, unknown>)[field];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** Narrow the `bash` tool's args into command + workdir; `null` when unusable. */
export function narrowBashArgs(args: unknown): OpencodeBashArgs | null {
  const command = stringField(args, 'command');
  if (command === undefined) return null;
  const workdir = stringField(args, 'workdir');
  return workdir === undefined ? { command } : { command, workdir };
}

/** Narrow the `read` tool's args into a path + optional positive-int window. */
export function narrowReadArgs(args: unknown): OpencodeReadArgs | null {
  const filePath = stringField(args, 'filePath');
  if (filePath === undefined) return null;
  const offset = positiveIntField(args, 'offset');
  const limit = positiveIntField(args, 'limit');
  return offset === undefined && limit === undefined ? { filePath } : { filePath, offset, limit };
}

/** Narrow `edit` into a write touch (the new string is what was written). */
export function narrowEditArgs(args: unknown): OpencodeWriteArgs | null {
  const filePath = stringField(args, 'filePath');
  const written = stringField(args, 'newString');
  if (filePath === undefined || written === undefined) return null;
  return { filePath, written };
}

/** Narrow `write` into a write touch (full content replacement). */
export function narrowWriteArgs(args: unknown): OpencodeWriteArgs | null {
  const filePath = stringField(args, 'filePath');
  const written = stringField(args, 'content');
  if (filePath === undefined || written === undefined) return null;
  return { filePath, written };
}

/** Narrow `apply_patch` into its patch script text. */
export function narrowApplyPatchText(args: unknown): string | null {
  return stringField(args, 'patchText') ?? null;
}

/**
 * The shape {@link normalizeBashResponse} (via `runLayeredBashTouches`)
 * consumes, translated from the host's bash result per plan decision 10:
 * metadata `{output, exit, truncated, outputPath?}` where `exit` is a number
 * or `null` (null = aborted/timed out). A null exit maps to
 * `interrupted: true` with no `exitStatus`, suppressing attribution exactly
 * like the twins' interrupted rows; truncation flows through `rawOutputPath`.
 */
export interface MappedBashResponse {
  output: string;
  exitStatus?: number;
  interrupted: boolean;
  rawOutputPath?: string;
}

/**
 * Map the after-hook's `(output.output, output.metadata)` bash result into the
 * twins' normalized-response contract. Total over garbage: a non-object
 * metadata (or a missing one) yields `interrupted: true` — without an exit
 * status there is no proof the command completed, so attribution suppresses
 * rather than guessing. The text source prefers `metadata.output` (the host's
 * own result text) and falls back to the appended `output.output` channel;
 * the host's redundant `truncated` boolean is ignored because the normalized
 * shape re-derives truncation from `rawOutputPath`.
 */
export function toBashResponse(outputChannel: unknown, metadata: unknown): MappedBashResponse {
  const record = metadata !== null && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {};
  const rawText =
    typeof record.output === 'string' ? record.output : typeof outputChannel === 'string' ? outputChannel : '';
  const exit = record.exit;
  const outputPath =
    typeof record.outputPath === 'string' && record.outputPath.length > 0 ? record.outputPath : undefined;
  return {
    output: rawText,
    exitStatus: Number.isInteger(exit) ? (exit as number) : undefined,
    interrupted: typeof exit !== 'number',
    ...(outputPath === undefined ? {} : { rawOutputPath: outputPath })
  };
}

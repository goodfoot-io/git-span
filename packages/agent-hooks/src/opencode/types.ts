/**
 * Local structural types for the subset of OpenCode's plugin `Hooks` surface
 * this adapter uses. Deliberately loose (`unknown` leaves narrowed at the
 * edges): OpenCode's own SDK types are not a dependency — the peer package
 * bundles this module standalone, and every field is re-validated before use
 * so a host shape change fails open instead of misbehaving.
 *
 * Verified host facts these encode (notes/opencode-runtime-spikes.md):
 * - `tool.execute.before(input{tool,sessionID,callID}, output{args})` blocks
 *   by throwing; the thrown message reaches the model verbatim.
 * - `tool.execute.after(input{…,args}, output{title,output,metadata})` fires
 *   only after successful execution; appending to `output.output` injects.
 * - `shell.env(input{cwd,sessionID?,callID?})` fires per shell execution with
 *   the resolved cwd, ordered before → shell.env → after per callID.
 * - `event` delivers typed events; `session.*` properties carry `sessionID`.
 */

/** The plugin init input this adapter reads. */
export interface OpencodePluginInput {
  directory?: string;
}

/** Shared `input` envelope of the tool hooks. */
export interface OpencodeToolInput {
  tool?: string;
  sessionID?: string;
  callID?: string;
  /**
   * The tool-call arguments ride the *input* of the after hook (the before
   * hook receives them on `output.args` instead). Narrowed defensively at
   * every use site.
   */
  args?: unknown;
}

/** Before-hook mutable output: the tool call's arguments. */
export interface OpencodeBeforeOutput {
  // Host type is a per-tool JSON object; narrowed defensively at the edges.
  args?: unknown;
}

/** After-hook mutable output: append-only injection channel + result metadata. */
export interface OpencodeAfterOutput {
  title?: unknown;
  /** The tool result text the model sees; appended to, never rewritten wholesale. */
  output?: string;
  metadata?: unknown;
}

/** `shell.env` input: resolved cwd for the shell execution, keyed by call. */
export interface OpencodeShellEnvInput {
  cwd?: string;
  sessionID?: string;
  callID?: string;
}

/** `shell.env` mutable output: the environment handed to the shell. */
export interface OpencodeShellEnvOutput {
  env: Record<string, string>;
}

/** A typed host event (`event.type` + `event.properties`). */
export interface OpencodeEvent {
  type?: string;
  properties?: { sessionID?: string };
}

/**
 * The subset of OpenCode's `Hooks` object this adapter returns. Local and
 * structural — no dependency on an OpenCode SDK.
 */
export interface GitSpanOpencodeHooks {
  dispose?: () => Promise<void> | void;
  event?: (context: { event: OpencodeEvent }) => Promise<void>;
  'tool.execute.before'?: (input: OpencodeToolInput, output: OpencodeBeforeOutput) => Promise<void>;
  'tool.execute.after'?: (input: OpencodeToolInput, output: OpencodeAfterOutput) => Promise<void>;
  'shell.env'?: (input: OpencodeShellEnvInput, output: OpencodeShellEnvOutput) => Promise<void>;
}

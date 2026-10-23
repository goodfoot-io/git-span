/** Internal envelopes shared by the OpenCode attribution handlers and their tests.
 * Native V2 domain hooks are translated into these envelopes by index.ts.
 */

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
  properties?: { sessionID?: string; info?: { id?: string; parentID?: string } };
}

/**
 * Normalized attribution callbacks used internally by the native adapter.
 */
export interface GitSpanOpencodeHooks {
  dispose?: () => Promise<void> | void;
  event?: (context: { event: OpencodeEvent }) => Promise<void>;
  'tool.execute.before'?: (input: OpencodeToolInput, output: OpencodeBeforeOutput) => Promise<void>;
  'tool.execute.after'?: (input: OpencodeToolInput, output: OpencodeAfterOutput) => Promise<void>;
  'shell.env'?: (input: OpencodeShellEnvInput, output: OpencodeShellEnvOutput) => Promise<void>;
}

/** Pure argv and reflog evidence contracts for the invocation-local Git shim. */
import type { CommitObjectFormat, CommitValidation } from './commit-contracts.js';

export interface CommitGitInvocation {
  /** Exact original argv, including global options, is forwarded once. */
  readonly argv: readonly string[];
  readonly effectiveCwd: string;
  /** Original global options retained for repository probes with the same Git semantics. */
  readonly globalArguments: readonly string[];
  readonly command: string;
  readonly commandArguments: readonly string[];
  readonly gitDirectory?: string;
  readonly workTree?: string;
  readonly builtinCommit: boolean;
  readonly dryRun: boolean;
}

/** Parse repeated -C, -c, --config-env, --git-dir and --work-tree without shell parsing or alias expansion. */
export function parseCommitGitInvocation(
  _argv: readonly string[],
  _cwd: string
): CommitValidation<CommitGitInvocation> {
  throw new Error('Not Implemented');
}

/** A missing pre-execution reflog is allowed for unborn HEAD; an existing log must retain its identity. */
export type CommitReflogCheckpoint =
  | { readonly existed: false; readonly offset: 0 }
  | { readonly existed: true; readonly device: string; readonly inode: string; readonly offset: number };

/** The IO adapter reads at most the evidence budget and reports actual metadata rather than trusting receipt metadata. */
export interface CommitReflogAppend {
  readonly device: string;
  readonly inode: string;
  readonly fileSize: number;
  readonly bytes: Uint8Array;
  readonly exceededBudget: boolean;
}

export interface CommitCreationEvidence {
  readonly checkpoint: CommitReflogCheckpoint;
  readonly append: CommitReflogAppend | null;
  readonly objectFormat: CommitObjectFormat;
  readonly nonce: string;
  readonly gitExitCode: number | null;
  readonly gitSignal: string | null;
  readonly builtinCommit: boolean;
  readonly dryRun: boolean;
}

/** Exactly one complete nonce-tagged transition after successful builtin commit yields the frozen full SHA. */
export function validateCommitCreationEvidence(_evidence: CommitCreationEvidence): CommitValidation<string> {
  throw new Error('Not Implemented');
}

/**
 * Response-aware derivation of read-touch spans from Bash `tool_response`
 * output, for the grep/ripgrep and unified-diff command families that
 * parse-command.ts deliberately cannot classify from command text alone: the
 * window is anchored to match position or hunk lines, which is data-dependent
 * and lives in the response, not the command. parseResponse is the second
 * evidence source the Claude and Codex adapters merge with parseCommand's
 * spans.
 *
 * The common/ layer convention is load-bearing: modules import only `node:`
 * builtins and sibling modules — zero SDK imports. Envelope normalization
 * (`tool_response` → ResponseParseInput) happens in the adapters, which hand
 * the already-normalized shape down here.
 *
 * Phase 1 of the TDD bootstrap (plans/initial.md): the contract and the
 * search/diff record types the decoders will need, with `Not Implemented`
 * bodies. Phase 3 implements against the skipped acceptance checks in
 * test/common/parse-response.test.ts.
 */
import type { ResolvedSpan } from './parse-command.js';

/**
 * The normalized tool-response input the adapters hand the shared parser.
 * `stdout` is the (possibly preview) output text; `stderr` and `exitStatus`
 * are carried for diagnostics and are never parse gates — `git diff
 * --exit-code` exits 1 on differences, so exit status must not be treated as
 * failure. `truncated` (Claude `rawOutputPath` set ⇒ inline stdout is only a
 * preview, or `interrupted`) forces the fail-closed rules.
 */
export interface ResponseParseInput {
  command: string;
  cwd: string;
  stdout: string;
  stderr?: string;
  exitStatus?: number; // metadata only — never gates (git diff exits 1 on differences)
  truncated?: boolean;
}

/**
 * A single decoded search-output record. The path/line split is layout-
 * dependent: `path:line:text` (recursive), `path-line:text` (context lines in
 * -A/-B/-C groups carry no number — `line` is null and the record advances
 * the per-file counter instead), `line:text` (one-file layout), or a
 * NUL-terminated `path:1:…` record (`-z`).
 */
export interface SearchRecord {
  path: string;
  /** The record's line number, or null for context lines without one. */
  line: number | null;
  text: string;
}

/** The recognized search output layouts the decoders distinguish. */
export type SearchLayout = 'recursive' | 'context' | 'heading' | 'null-separated' | 'one-file';

/**
 * One file's section of a unified-diff response. `oldPath`/`newPath` are the
 * `a/`-`b/`-prefixed sides with the prefix stripped; null for `/dev/null`
 * (new-file / deleted-file sides).
 */
export interface DiffFileRecord {
  oldPath: string | null;
  newPath: string | null;
  /**
   * Rename/copy metadata (`rename from`/`rename to`, `copy from`/`copy to`):
   * the new path is the touch target.
   */
  rename: { from: string; to: string } | null;
  binary: boolean;
  combined: boolean;
  submodule: boolean;
  hunks: DiffHunk[];
}

/**
 * A unified-diff hunk header (`@@ -a,b +c,d @@`); an omitted count means 1.
 * Per-side ranges are `oldStart..oldStart+oldCount-1` on the old path and
 * `newStart..newStart+newCount-1` on the new path.
 */
export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

/**
 * Derives precise per-file read ranges from a response-producing search or
 * diff command: command gating, scope restriction against the command's
 * declared roots, search-layout decoding, unified-diff decoding, coalescing,
 * and the fail-closed truncation/hostile-output rules. Returns [] for
 * anything not response-derivable or not fully observed.
 */
export function parseResponse(_input: ResponseParseInput): ResolvedSpan[] {
  throw new Error('Not Implemented');
}

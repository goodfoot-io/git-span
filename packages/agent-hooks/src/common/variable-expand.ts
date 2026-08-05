/**
 * Variable resolution for the execution-aware Bash touch parser (plan §7).
 *
 * Expansion runs over the raw simple-command text *before* tokenizing, with a
 * quote-aware scanner: single-quoted spans stay literal, double-quoted and
 * unquoted spans expand `$VAR` and `${VAR}` (greedy identifier), and a
 * backslash-escaped `$` stays literal. Expanding before tokenizing keeps an
 * expanded value's `&&`/spaces out of the splitter's reach. Value precedence
 * is script variable table > allowlisted hook env > unresolved — an unset or
 * unknown name is left as the residual `$`, which trips the parser's
 * `looksUnresolvable` path (fail closed, no touch).
 *
 * The module is a Phase 1 contract stub: only {@link DEFAULT_PATH_ALLOWLIST}
 * is real; {@link expandVariables} throws `Not Implemented` until the Phase 3
 * walk lands.
 */

/**
 * The shared allowlist of hook-env variable names path arguments may resolve
 * from — identical across harnesses so the same command string produces the
 * same touches everywhere. An allowlisted name absent from a particular hook
 * env stays unresolved (fail closed), so the list is safe to share.
 */
export const DEFAULT_PATH_ALLOWLIST = [
  'HOME',
  'PWD',
  'WORKSPACE_PATH',
  'CARD_REPO_PATH',
  'REPO_ROOT',
  'BASE_BRANCH'
] as const;

/**
 * Expand `$VAR` / `${VAR}` references in a simple command's raw text (plan
 * §7). `$(…)`, `$((…))`, `${!X}` indirect expansion, special parameters, and
 * unknown variables stay untouched.
 *
 * @param text The raw simple-command text, before tokenizing.
 * @param variables The script variable table from executed non-pipe assignment
 *   stages, in order (takes precedence over the allowlisted hook env).
 * @param env The hook process env (the parser defaults to `process.env`;
 *   injectable in tests).
 * @param allowlist Variable names allowed to resolve from `env`; defaults to
 *   {@link DEFAULT_PATH_ALLOWLIST}.
 *
 * Not implemented yet — Phase 1 declares the contract surface only.
 */
export function expandVariables(
  _text: string,
  _variables: ReadonlyMap<string, string>,
  _env: Record<string, string | undefined>,
  _allowlist: readonly string[] = DEFAULT_PATH_ALLOWLIST
): string {
  throw new Error('Not Implemented');
}

/**
 * Variable resolution for the execution-aware Bash touch parser (plan §7).
 *
 * Expansion runs over the raw simple-command text *before* tokenizing, with a
 * quote-aware scanner: single-quoted spans stay literal, double-quoted and
 * unquoted spans expand `$VAR` and `${VAR}` (greedy identifier), and a
 * backslash-escaped `$` stays literal. Expanding before tokenizing keeps an
 * expanded value's `&&`/spaces out of the splitter's reach. Value precedence
 * is script variable table > env > unresolved — a name absent from both is
 * left as the residual `$`, which trips the parser's `looksUnresolvable` path
 * (fail closed, no touch).
 *
 * The env is expected to be pre-curated: `parseCommandDetailed` gates its
 * `process.env` default by `ParseOptions.allowlist` (so only the
 * `DEFAULT_PATH_ALLOWLIST` names ever resolve from the hook env), while an
 * explicitly injected env — as in tests — is consulted wholesale.
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

/** A bare reference name: greedy identifier after `$`. */
const BARE_NAME = /^[A-Za-z_][A-Za-z0-9_]*/;

/** A braced reference must be exactly an identifier — `${!X}`, `${X:-d}`, `${#X}` never expand. */
const BRACED_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Expand `$VAR` / `${VAR}` references in a simple command's raw text (plan
 * §7). `$(…)`, `$((…))`, `${!X}` indirect expansion, `${X:…}` operators,
 * special parameters, and unknown variables stay untouched.
 *
 * @param text The raw simple-command text, before tokenizing.
 * @param variables The script variable table from executed non-pipe assignment
 *   stages, in order (takes precedence over `env`).
 * @param env The curated environment (the parser gates its `process.env`
 *   default by `DEFAULT_PATH_ALLOWLIST`; an injected env is used wholesale).
 */
export function expandVariables(
  text: string,
  variables: ReadonlyMap<string, string>,
  env: Record<string, string | undefined>
): string {
  const resolve = (name: string): string | undefined => {
    const fromTable = variables.get(name);
    if (fromTable !== undefined) return fromTable;
    const fromEnv = env[name];
    return fromEnv !== undefined ? fromEnv : undefined;
  };

  let out = '';
  let i = 0;
  const n = text.length;
  let inSingle = false;
  let inDouble = false;
  while (i < n) {
    const c = text[i];
    if (inSingle) {
      // Single-quoted spans are fully literal — `$` and `\` included.
      if (c === "'") inSingle = false;
      out += c;
      i++;
      continue;
    }
    if (inDouble) {
      if (c === '"') {
        inDouble = false;
        out += c;
        i++;
        continue;
      }
      if (c === '\\' && i + 1 < n && '"\\$`'.includes(text[i + 1])) {
        // Inside double quotes backslash escapes `"` `\` `$` `` ` `` — the
        // escaped character stays literal (no expansion of `\$`).
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (c === '\\') {
        out += c;
        i++;
        continue;
      }
      if (c === '$') {
        const ref = expandRef(text, i, resolve);
        out += ref.text;
        i = ref.next;
        continue;
      }
      out += c;
      i++;
      continue;
    }
    // Unquoted.
    if (c === "'") {
      inSingle = true;
      out += c;
      i++;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      out += c;
      i++;
      continue;
    }
    if (c === '\\') {
      // A backslash escapes the next character — `\$` stays literal (the
      // tokenizer resolves the escape).
      out += c;
      if (i + 1 < n) {
        out += text[i + 1];
        i += 2;
      } else {
        i++;
      }
      continue;
    }
    if (c === '$') {
      const ref = expandRef(text, i, resolve);
      out += ref.text;
      i = ref.next;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Resolve the reference starting at `text[start]` (a `$`). A known name's
 * value replaces the whole reference; anything else — command substitution,
 * arithmetic, indirect expansion, parameter operators, special parameters,
 * unknown or unset names — is returned verbatim (the `$` only), so the
 * caller's scan continues and the residual text is unchanged.
 */
function expandRef(
  text: string,
  start: number,
  resolve: (name: string) => string | undefined
): { text: string; next: number } {
  const rest = text.slice(start + 1);
  if (rest.startsWith('(')) return { text: '$', next: start + 1 }; // `$(…)` / `$((…))` — untouched
  if (rest.startsWith('{')) {
    const close = text.indexOf('}', start + 2);
    if (close === -1) return { text: '$', next: start + 1 }; // unterminated `$ {` — untouched
    const inner = text.slice(start + 2, close);
    if (BRACED_NAME.test(inner)) {
      const value = resolve(inner);
      if (value !== undefined) return { text: value, next: close + 1 };
    }
    return { text: '$', next: start + 1 }; // `${!X}`, `${X:…}`, unknown names — untouched
  }
  const name = BARE_NAME.exec(rest);
  if (name === null) return { text: '$', next: start + 1 }; // special parameters, bare `$` — untouched
  const value = resolve(name[0]);
  if (value !== undefined) return { text: value, next: start + 1 + name[0].length };
  return { text: '$', next: start + 1 }; // unknown name — the residual `$` trips looksUnresolvable
}

/**
 * Escapes VS Code glob metacharacters so a literal filesystem path can be
 * handed to `createFileSystemWatcher` (or any other GlobPattern consumer)
 * without its metacharacters being interpreted as wildcards.
 *
 * VS Code interprets every string passed to
 * {@linkcode vscode.workspace.createFileSystemWatcher} as a GlobPattern:
 * `*`, `?`, `{`, `}`, `[` and `]` carry wildcard meaning, so an anchored file
 * under `src/[generated]/api.ts` silently never fires its watcher -- the
 * bracket segment parses as a character class matching e.g. `src/g/api.ts`,
 * never the literal directory.
 *
 * The engine's own escaping rules (see `parseRegExp` in VS Code's
 * `src/vs/base/common/glob.ts`) honor no backslash escapes -- `\*` would match
 * a backslash followed by a wildcard -- but inside a `[...]` character class
 * every character except `-`, a leading `^`/`!`, and `/` is matched literally.
 * Each metacharacter is therefore wrapped in a single-element character
 * class: `[` -> `[[]` (`]` immediately after `[` is also literal), `]` -> `[]]`,
 * `*` -> `[*]`, `?` -> `[?]`, `{` -> `[{]`, `}` -> `[}]`.
 *
 * @summary Escapes VS Code glob metacharacters in literal paths.
 * @module spanViewer/globEscape
 */

/**
 * One glob metacharacter to neutralize: the full wildcard set of VS Code's
 * GlobPattern syntax (`[]` classes, `{}` alternation, `*`/`?` wildcards).
 */
const GLOB_METACHARACTERS = /[*?{}[\]]/g;

/**
 * Rewrites every glob metacharacter in `value` into the equivalent
 * single-character class, leaving all other characters (separators included)
 * untouched so the output still matches only the literal input path.
 *
 * @param value - Literal filesystem path to turn into a safe GlobPattern.
 * @returns The pattern that matches exactly `value`.
 * @throws Never.
 */
export const escapeGlobPattern = (value: string): string => value.replace(GLOB_METACHARACTERS, (char) => `[${char}]`);

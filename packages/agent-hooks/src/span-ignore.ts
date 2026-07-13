/**
 * Path-scoped span suppression for the agent hooks.
 *
 * Some spans are noise when browsing certain parts of the tree — wiki or
 * marketing spans that anchor prose, surfaced inline while reading source,
 * add little. This module lets a repo declare, per path, which span slug
 * prefixes to hold back.
 *
 * Config lives at `<repoRoot>/.span/.hookignore`. Each non-comment line is a
 * gitignore-style path pattern, a single run of whitespace, then a
 * comma-separated list of span slug prefixes to suppress for paths the pattern
 * matches:
 *
 *   packages/agent-hooks/src wiki,marketing
 *
 * A span whose slug begins with `wiki` or `marketing` (the slug equals the
 * prefix, or is `<prefix>/…`) is then never surfaced for an anchor whose path
 * sits under `packages/agent-hooks/src` — neither inline by the PreToolUse hook
 * nor in the Stop hook's stale / related sections.
 *
 * Pattern grammar is a deliberate subset of gitignore:
 *
 * - Blank lines and lines beginning with `#` are skipped.
 * - A trailing `/` restricts the pattern to directories (the leaf file is not
 *   itself tested, only its ancestor directories).
 * - A pattern containing a slash is anchored to the repo root; a pattern with
 *   no slash matches a single path component at any depth.
 * - `*` and `?` match within one path segment; `**` matches across segments.
 * - Negation (`!`) is not supported.
 *
 * Suppression is fail-open: a missing or unreadable `.hookignore`, or a
 * malformed line, yields no rule rather than hiding spans the author did not
 * ask to hide.
 */

import * as fs from 'node:fs';
import * as nodePath from 'node:path';

export interface IgnoreRule {
  /** The raw gitignore-style pattern, retained for diagnostics. */
  pattern: string;
  /** Span slug prefixes suppressed for paths this rule matches. */
  prefixes: string[];
  /** True when `repoRelPath` (POSIX, repo-relative) is governed by this rule. */
  matches: (repoRelPath: string) => boolean;
}

const HOOK_IGNORE_REL = nodePath.join('.span', '.hookignore');

/**
 * Translate one gitignore-style glob segment into an anchored RegExp. `*` and
 * `?` stay within a path segment; `**` (optionally followed by `/`) spans them.
 */
function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        // Absorb a following slash so `**/foo` does not demand a literal `/`.
        if (glob[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

/** Ancestor path chain: `a/b/c.ts` → `['a', 'a/b', 'a/b/c.ts']`. */
function ancestorPaths(path: string): string[] {
  const parts = path.split('/');
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    out.push(parts.slice(0, i + 1).join('/'));
  }
  return out;
}

/**
 * Compile a single pattern into a path predicate. A pattern matches a file when
 * it matches the file's path or any ancestor directory of it, so a directory
 * pattern suppresses everything beneath it.
 */
function compilePattern(pattern: string): (repoRelPath: string) => boolean {
  let pat = pattern;
  let dirOnly = false;
  if (pat.endsWith('/')) {
    dirOnly = true;
    pat = pat.slice(0, -1);
  }
  let anchored = pat.includes('/');
  if (pat.startsWith('/')) {
    anchored = true;
    pat = pat.slice(1);
  }
  const re = globToRegExp(pat);

  return (repoRelPath: string) => {
    if (anchored) {
      const segs = ancestorPaths(repoRelPath);
      // For a dir-only pattern, never test the leaf file itself.
      const candidates = dirOnly ? segs.slice(0, -1) : segs;
      return candidates.some((s) => re.test(s));
    }
    // Unanchored: match against individual path components at any depth.
    const components = repoRelPath.split('/');
    const candidates = dirOnly ? components.slice(0, -1) : components;
    return candidates.some((c) => re.test(c));
  };
}

/** Parse `.hookignore` text into rules, skipping comments and malformed lines. */
export function parseHookIgnore(content: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    // `<pattern><whitespace><prefixes>` — pattern is the first token, prefixes
    // the second. A line without both is malformed and skipped.
    const match = line.match(/^(\S+)\s+(\S+)$/);
    if (!match) continue;
    const [, pattern, prefixesRaw] = match;
    const prefixes = prefixesRaw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (prefixes.length === 0) continue;
    rules.push({ pattern, prefixes, matches: compilePattern(pattern) });
  }
  return rules;
}

/**
 * Load the suppression rules for a repo. Fail-open: any read or parse failure
 * yields an empty rule set, so spans surface as normal when no config exists.
 */
export function loadHookIgnore(repoRoot: string): IgnoreRule[] {
  try {
    const content = fs.readFileSync(nodePath.join(repoRoot, HOOK_IGNORE_REL), 'utf8');
    return parseHookIgnore(content);
  } catch {
    return [];
  }
}

/** A slug carries a prefix when it equals the prefix or is `<prefix>/…`. */
function slugHasPrefix(slug: string, prefix: string): boolean {
  return slug === prefix || slug.startsWith(`${prefix}/`);
}

/**
 * True when a span `slug` should be suppressed for an anchor at `repoRelPath`:
 * some rule matches the path and lists a prefix the slug carries.
 */
export function isSpanSuppressed(rules: IgnoreRule[], repoRelPath: string, slug: string): boolean {
  for (const rule of rules) {
    if (!rule.matches(repoRelPath)) continue;
    if (rule.prefixes.some((p) => slugHasPrefix(slug, p))) return true;
  }
  return false;
}

/** Signature for injecting a rule loader (production default: {@link loadHookIgnore}). */
export type HookIgnoreLoader = (repoRoot: string) => IgnoreRule[];

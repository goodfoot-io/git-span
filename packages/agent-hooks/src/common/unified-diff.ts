/**
 * The range-preserving unified-diff parser (plan §5.7), sibling to
 * mechanical-change.ts's range-less `parseUnifiedDiff`. The patch/git apply
 * grammar needs the `@@ -a,b +c,d @@` hunk numbers that parseUnifiedDiff
 * discards, so this parses the same header dialect from scratch.
 *
 * A hunk whose pre/post line counts match preserves line coordinates, so a
 * file whose hunks are all count-preserving gets an exact range — the union of
 * every hunk's region. Any count-changing hunk (pure add, pure delete, unequal
 * counts) degrades the file to a whole-file modify: positions below it shift,
 * and a deleted line occupies no post-edit range at all.
 *
 * Per-file classifications: `new file mode` → create-overwrite; `deleted file
 * mode` → delete; `rename from`/`rename to` → source delete + dest
 * rename-copy; binary diffs → whole-file modify; a `+++ /dev/null` target (the
 * shape `diff -u`-format deletions take) → delete, and a `--- /dev/null` side
 * (the `diff -u`-format creation shape, with no `new file mode` header) →
 * create-overwrite.
 *
 * Git-style `a/…`/`b/…` prefixes are stripped per the caller's `-pN` strip
 * level: a number strips that many leading path components, and `'auto'`
 * (patch's default) strips one when the path is a/- or b/-prefixed and none
 * otherwise. `/dev/null` is checked before stripping — the header marker
 * would otherwise lose its `dev/` component.
 *
 * `diff -u` headers carry a tab-separated timestamp (`--- f.txt\t2024-01-01
 * 00:00:00`) and may be CRLF-terminated; both are stripped before path
 * resolution. The target of a modify hunk is the `---` side: patch and git
 * apply rewrite the file named there (for `diff -u f.txt f.new`, the `+++`
 * side is only a label), so the `+++` line overrides the path only for the
 * `/dev/null` markers — a `--- /dev/null` side (a new file) names the target
 * on `+++`, and a `+++ /dev/null` side marks a deletion.
 *
 * Malformed or empty patch text returns null (fail closed — the caller emits
 * unresolved rather than guessing at targets).
 */

/** The `-pN` header strip level: a component count, or patch's `'auto'` default. */
export type PathStrip = number | 'auto';

/** One file a patch touches: the target path, the touch kind, and the exact range when the hunks preserve line counts. */
export interface UnifiedDiffTarget {
  path: string;
  operation: 'modify' | 'create-overwrite' | 'delete' | 'rename-copy';
  lineStart?: number;
  lineEnd?: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Strip the first `n` leading path components (`-pN`), stopping at a component-less path. */
function stripPathComponents(p: string, n: number): string {
  let s = p;
  for (let i = 0; i < n; i++) {
    const slash = s.indexOf('/');
    if (slash === -1) return s;
    s = s.slice(slash + 1);
  }
  return s;
}

/**
 * The level to strip from `raw` under `strip`: a number passes through; `'auto'`
 * resolves to p1 when the path is `a/`/`b/`-prefixed and p0 otherwise — patch's
 * default for diffs whose prefixes are `diff -u`-style rather than git's.
 */
function stripLevelFor(raw: string, strip: PathStrip): number {
  return strip === 'auto' ? (raw.startsWith('a/') || raw.startsWith('b/') ? 1 : 0) : strip;
}

/**
 * The raw `---`/`+++` header path: the text up to the first tab (the
 * `diff -u` timestamp column), or the whole word when there is none. CRLF
 * is handled at the line level (see parseUnifiedDiffRange), which also
 * covers hunk headers.
 */
function headerPathText(raw: string): string {
  const tab = raw.indexOf('\t');
  return tab === -1 ? raw : raw.slice(0, tab);
}

export function parseUnifiedDiffRange(patchText: string, strip: PathStrip): UnifiedDiffTarget[] | null {
  const results: UnifiedDiffTarget[] = [];
  let sawBlock = false;
  let current: {
    path: string;
    kind: 'modify' | 'new' | 'deleted';
    hunks: Array<{ start: number; end: number }>;
    countChanging: boolean;
  } | null = null;
  let pendingKind: 'new' | 'deleted' | null = null;
  let renameFrom: string | null = null;
  let renameTo: string | null = null;
  let binary = false;

  /** The header path, tab/CR-stripped, with the `-pN` level applied — `/dev/null` kept verbatim (the marker is never a real path). */
  const stripped = (raw: string): string => {
    const text = headerPathText(raw);
    if (text === '/dev/null') return text;
    return stripPathComponents(text, stripLevelFor(text, strip));
  };

  const finish = (): void => {
    if (current !== null) {
      if (current.kind === 'new') results.push({ path: current.path, operation: 'create-overwrite' });
      else if (current.kind === 'deleted') results.push({ path: current.path, operation: 'delete' });
      else if (binary) results.push({ path: current.path, operation: 'modify' });
      else if (current.hunks.length === 0) {
        // A header-only block with no hunks: nothing statically known.
      } else if (current.countChanging) results.push({ path: current.path, operation: 'modify' });
      else {
        const start = Math.min(...current.hunks.map((h) => h.start));
        const end = Math.max(...current.hunks.map((h) => h.end));
        results.push({ path: current.path, operation: 'modify', lineStart: start, lineEnd: end });
      }
      current = null;
    }
    if (renameFrom !== null) results.push({ path: renameFrom, operation: 'delete' });
    if (renameTo !== null) results.push({ path: renameTo, operation: 'rename-copy' });
    renameFrom = null;
    renameTo = null;
    binary = false;
  };

  for (const rawLine of patchText.split('\n')) {
    // A trailing `\r` (CRLF patch text — Windows-authored diffs) pollutes
    // headers, hunk headers, and path lines alike; both patch and git apply
    // strip it, so the parser does too.
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith('--- ')) {
      sawBlock = true;
      if (current !== null) finish();
      current = {
        path: stripped(line.slice(4)),
        kind: pendingKind ?? 'modify',
        hunks: [],
        countChanging: false
      };
      pendingKind = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      sawBlock = true;
      const path = stripped(line.slice(4));
      if (current === null) current = { path, kind: pendingKind ?? 'modify', hunks: [], countChanging: false };
      else if (path === '/dev/null') current.kind = 'deleted';
      else if (current.path === '/dev/null') {
        // A `--- /dev/null` side replaced by a real `+++` path is a new file
        // (the `diff -u`-format creation shape — no `new file mode` header).
        // Its `@@ -0,0 +N @@` hunk has no pre-edit lines, so the
        // create-overwrite is decided here, not from hunk coverage.
        current.path = path;
        current.kind = 'new';
      }
      // Otherwise keep the `---` side: patch and git apply rewrite the file
      // named on the `---` line, and `diff -u f f.new` headers name the
      // pre-image there — the `+++` path is only a label (the diff-uu
      // patch-header miss).
      pendingKind = null;
      continue;
    }
    if (line.startsWith('new file mode')) {
      pendingKind = 'new';
      continue;
    }
    if (line.startsWith('deleted file mode')) {
      pendingKind = 'deleted';
      continue;
    }
    if (line.startsWith('rename from ')) {
      sawBlock = true;
      if (current !== null) finish();
      renameFrom = stripped(line.slice('rename from '.length));
      continue;
    }
    if (line.startsWith('rename to ')) {
      sawBlock = true;
      renameTo = stripped(line.slice('rename to '.length));
      continue;
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      sawBlock = true;
      binary = true;
      continue;
    }
    const hunk = line.match(HUNK_HEADER);
    if (hunk) {
      sawBlock = true;
      const preStart = Number.parseInt(hunk[1], 10);
      const preCount = hunk[2] === undefined ? 1 : Number.parseInt(hunk[2], 10);
      const postCount = hunk[4] === undefined ? 1 : Number.parseInt(hunk[4], 10);
      if (current === null) return null; // a hunk without a file header → malformed
      if (preCount !== postCount) current.countChanging = true;
      if (preCount > 0) current.hunks.push({ start: preStart, end: preStart + preCount - 1 });
    }
  }
  finish();
  return sawBlock ? results : null;
}

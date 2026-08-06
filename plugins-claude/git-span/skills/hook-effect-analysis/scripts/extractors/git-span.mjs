// Entity extractor for the git-span touch hook's `<git-span>` block.
//
// outcomes.mjs and baseline.mjs take any extractor matching the shape
// `(emittedText) => string[]`, used as the default export here. simulate.mjs
// needs exact per-line text to cost a suppression policy, so this module
// also exports a named `anchors(emittedText)` giving line-level detail — an
// extension of the base contract, not a replacement for it.
//
// Both walk the same two formats seen in the wild:
//
//   flat (older): "- path/to/file.ts#L1-L2 — changed"
//   tree (current): box-drawing anchors, folded to a shared directory
//     prefix — "├─ packages/\n│  └─ agent-hooks/src/x.ts #L1-L2"
//
// See plugins-claude/git-span/skills/git-span/references/understanding-hook-output.md
// for the tree-rendering rules this mirrors: a directory holding a single
// entry folds onto that entry's line, so a branch only appears where two or
// more anchors actually share a prefix.
//
// No knowledge of what a span *is* beyond this text shape leaks into
// collect.mjs / outcomes.mjs / baseline.mjs / simulate.mjs — this module is
// the only git-span-specific code in the skill.

const FLAT_BULLET_RE = /^-\s+(.*)$/;
// A tree line is zero or more 3-char indent units ("│  " or "   ") followed
// by a branch marker ("├─ " or "└─ ") and content.
const TREE_LINE_RE = /^((?:(?:│ {2}|║ {2}| {3}))*)(├─ |└─ )(.*)$/;
const INDENT_UNIT_RE = /(│ {2}| {3})/g;

function stripAnchorSuffix(raw) {
  // Strip the human status suffix (" — changed", " — deleted", …) before the
  // line-range fragment, then the fragment itself. Splitting on "#" first —
  // without stripping the suffix — leaves " — changed" attached to bare-path
  // anchors, which then never match anything (measurement-pitfalls.md).
  return raw.split(" — ")[0].split("#")[0].trimEnd();
}

// Shared walk: yields {section, entity, line} for every leaf anchor line
// across every "## <name>" section of the emitted text.
function* walk(emittedText) {
  if (!emittedText) return;
  const sectionTexts = emittedText.split(/(?=^## )/m).filter((s) => s.startsWith("## "));

  for (const sectionText of sectionTexts) {
    const lines = sectionText.split("\n");
    const name = lines[0].slice(3).trim();
    const dirStack = [];

    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      if (line.trim() === "---") break; // end of anchor list / why text

      const flat = line.trim().match(FLAT_BULLET_RE);
      if (flat) {
        const entity = stripAnchorSuffix(flat[1]);
        if (entity) yield { section: name, entity, line };
        continue;
      }

      const tree = line.match(TREE_LINE_RE);
      if (!tree) continue;
      const [, indent, , content] = tree;
      const depth = (indent.match(INDENT_UNIT_RE) ?? []).length;
      const stripped = stripAnchorSuffix(content);
      if (!stripped) continue;

      if (stripped.endsWith("/")) {
        // Folder node: contributes a prefix segment for deeper lines, not an
        // entity itself.
        dirStack[depth] = stripped;
        dirStack.length = depth + 1;
        continue;
      }

      const prefix = dirStack.slice(0, depth).join("");
      yield { section: name, entity: prefix + stripped, line };
    }
  }
}

/**
 * @param {string} emittedText
 * @returns {string[]} deduplicated repo-relative entity paths
 */
export default function extract(emittedText) {
  return [...new Set([...walk(emittedText)].map((a) => a.entity))];
}

/**
 * @param {string} emittedText
 * @returns {{section: string, entity: string, line: string}[]} one record
 *   per anchor line, in document order, with the exact raw line text so a
 *   caller can compute character costs for dropping it.
 */
export function anchors(emittedText) {
  return [...walk(emittedText)];
}

#!/usr/bin/env node
/**
 * Normalizes the esbuild "module-boundary" `//` comments -- and the matching
 * `sources` entries esbuild embeds in the inline sourcemap it appends to the
 * bottom of the bundle -- that `claude-code-hooks`/`codex-hooks` bake above
 * every bundled module in the generated `.mjs` hook bins.
 *
 * esbuild resolves `node_modules` imports through symlinks to their realpath
 * before computing those comments, and computes the comment as a path
 * relative to `process.cwd()` (not the `-o` output directory). Every Cards
 * worktree symlinks its `node_modules` back into the shared main-workspace
 * install, so `process.cwd()` (deep inside a worktree) and the realpath
 * (`/workspace/node_modules/...`) share no common ancestor except the
 * filesystem root -- producing a long, worktree-depth-dependent `../` chain
 * instead of the short, portable form that a non-worktree build (real
 * `node_modules`, no symlink) would emit. The exact same cwd-relative
 * computation feeds the `sources` array of the base64-encoded inline
 * sourcemap on the file's last line (`//# sourceMappingURL=...`), so both
 * must be corrected for the artifact to be byte-stable across worktrees.
 *
 * The CLI also generates a synthetic `<hook>-entry.ts` stdin wrapper that
 * imports the compiled runtime module via a *second*, independently
 * computed long-form path (`path.relative(resolveDir, runtimePathAbsolute)`,
 * where `runtimePathAbsolute` comes from the CLI's own `import.meta.url` --
 * which Node always fully realpaths, dereferencing every symlink in the
 * chain, even the ordinary `node_modules/.bin/*` symlink npm/yarn always
 * create). That wrapper source text is preserved verbatim in the inline
 * sourcemap's `sourcesContent` entry for the synthetic file, so it carries
 * the same non-portable path and must be normalized the same way.
 *
 * `scripts/hooks-cli-wrapper.js` runs this immediately after every
 * `claude-code-hooks`/`codex-hooks` invocation (whether reached via
 * `yarn build:hooks` or directly via `yarn claude-code-hooks`/`yarn
 * codex-hooks`), rewriting any module-boundary comment or sourcemap
 * `sources`/`sourcesContent` reference resolved from
 * `node_modules/@goodfoot/(claude-code-hooks|codex-hooks)/dist/*.js` to the
 * canonical short form. That makes the generated artifact's identity-comment
 * content deterministic regardless of where the build physically runs.
 *
 * Also usable standalone: `node scripts/normalize-hook-module-comments.js <dir> [...dirs]`
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';

const MODULE_COMMENT_PATTERN = /^\/\/ (?:.*\/)?node_modules\/@goodfoot\/(claude-code-hooks|codex-hooks)\/dist\/(.+)$/;

// Matches a bare node_modules/@goodfoot/<pkg>/dist/<rest> reference anywhere
// in a string (e.g. inside a JSON-encoded sourcemap "sources"/"sourcesContent"
// entry), not anchored to a `//` comment line. The leading-path group is
// restricted to `../` segments and plain filename characters so it can only
// consume the contiguous relative-path prefix immediately before
// `node_modules` -- never unrelated surrounding text (e.g. the rest of an
// `import ... from '...'` statement it's embedded in), which is what a
// naive `.*\/` prefix would wrongly swallow.
const BARE_MODULE_PATH_PATTERN =
  /(?:\.\.\/)*(?:[A-Za-z0-9_.-]+\/)*node_modules\/@goodfoot\/(claude-code-hooks|codex-hooks)\/dist\/([^"'\s]+)/g;

const SOURCE_MAP_LINE_PATTERN = /^(\/\/# sourceMappingURL=data:application\/json;base64,)(.+)$/;

// `packages/<pkg>` is always 2 directories below the repo root that
// `node_modules` lives in, matching the fixed "../../node_modules" form used
// by the "//" module-boundary comments (which are relative to `process.cwd()`,
// always `packages/agent-hooks` for this CLI).
const CWD_TO_ROOT_LEVELS = 2;

function canonicalize(line) {
  const match = line.match(MODULE_COMMENT_PATTERN);
  if (!match) return line;
  const [, pkg, rest] = match;
  return `// ../../node_modules/@goodfoot/${pkg}/dist/${rest}`;
}

function replaceBareModulePaths(text, upLevels) {
  const prefix = '../'.repeat(upLevels);
  return text.replace(
    BARE_MODULE_PATH_PATTERN,
    (_m, pkg, rest) => `${prefix}node_modules/@goodfoot/${pkg}/dist/${rest}`
  );
}

/**
 * Finds the `[start, end)` byte range (including the surrounding `[`/`]`) of
 * the array value for `key` in a decoded sourcemap JSON string, plus the
 * `[start, end)` range of each individual string element within it (in
 * order). Never touches `mappings`, `names`, or anything outside the target
 * array -- and never round-trips through `JSON.stringify`, since esbuild's
 * own sourcemap serializer doesn't match Node's formatting (compact
 * comma-space-separated arrays, non-escaped unicode) closely enough to
 * reproduce byte-for-byte.
 */
function locateJsonStringArray(json, key) {
  const marker = `"${key}":`;
  const keyIndex = json.indexOf(marker);
  if (keyIndex === -1) return undefined;
  let i = keyIndex + marker.length;
  while (json[i] === ' ') i += 1;
  if (json[i] !== '[') return undefined;
  const arrayStart = i;
  const elements = [];
  let inString = false;
  let elementStart = -1;
  for (i += 1; i < json.length; i += 1) {
    const ch = json[i];
    if (inString) {
      if (ch === '\\') {
        i += 1; // skip the escaped character
      } else if (ch === '"') {
        inString = false;
        elements.push({ start: elementStart, end: i + 1 });
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      elementStart = i;
    } else if (ch === ']') {
      return { start: arrayStart, end: i + 1, elements };
    }
  }
  return { start: arrayStart, end: json.length, elements };
}

/**
 * Rewrites the `sources` and `sourcesContent` arrays of a decoded sourcemap
 * JSON string in place (as raw text edits, never a JSON.stringify
 * round-trip):
 *
 * - Each `sources[i]` entry that resolves through `node_modules/@goodfoot/
 *   (claude-code-hooks|codex-hooks)/dist/*.js` is anchored to the fixed
 *   `../../node_modules/...` form (these are always relative to the CLI's
 *   own `process.cwd()`, i.e. `packages/agent-hooks`).
 * - Each `sourcesContent[i]` entry (the synthetic `<hook>-entry.ts` stdin
 *   wrapper embeds a *second*, independently-computed import path to the
 *   same file) is anchored using a `../` depth derived from `sources[i]`
 *   itself, since that wrapper's import is relative to the real hook file's
 *   own subdirectory -- not to `process.cwd()` -- so a fixed 2-level prefix
 *   would be wrong whenever the hook lives more than one directory below
 *   `packages/agent-hooks`.
 */
function normalizeSourceMapText(json) {
  let result = json;

  const sourcesArray = locateJsonStringArray(result, 'sources');
  if (sourcesArray !== undefined) {
    const patchedArrayText = replaceBareModulePaths(
      result.slice(sourcesArray.start, sourcesArray.end),
      CWD_TO_ROOT_LEVELS
    );
    result = result.slice(0, sourcesArray.start) + patchedArrayText + result.slice(sourcesArray.end);
  }

  // Re-locate after any edits above shifted offsets.
  const sourcesForDepth = locateJsonStringArray(result, 'sources');
  const sourcesContentArray = locateJsonStringArray(result, 'sourcesContent');
  if (sourcesForDepth === undefined || sourcesContentArray === undefined) return result;

  const edits = [];
  for (let i = 0; i < sourcesContentArray.elements.length; i += 1) {
    const contentSpan = sourcesContentArray.elements[i];
    const original = result.slice(contentSpan.start, contentSpan.end);
    if (!original.includes('node_modules/@goodfoot/')) continue;

    const sourceSpan = sourcesForDepth.elements[i];
    const sourceRelPath = sourceSpan !== undefined ? JSON.parse(result.slice(sourceSpan.start, sourceSpan.end)) : '';
    const sourceDir = posix.dirname(sourceRelPath);
    const dirDepth = sourceDir === '.' ? 0 : sourceDir.split('/').filter(Boolean).length;

    const patched = replaceBareModulePaths(original, dirDepth + CWD_TO_ROOT_LEVELS);
    if (patched !== original) {
      edits.push({ start: contentSpan.start, end: contentSpan.end, text: patched });
    }
  }

  if (edits.length === 0) return result;
  edits.sort((a, b) => b.start - a.start); // apply back-to-front so offsets stay valid
  for (const edit of edits) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

function normalizeSourceMapLine(line) {
  const match = line.match(SOURCE_MAP_LINE_PATTERN);
  if (!match) return line;
  const [, prefix, base64] = match;
  const decoded = Buffer.from(base64, 'base64').toString('utf8');
  const patched = normalizeSourceMapText(decoded);
  if (patched === decoded) return line;
  return prefix + Buffer.from(patched, 'utf8').toString('base64');
}

function normalizeFile(filePath) {
  const original = readFileSync(filePath, 'utf8');
  const lines = original.split('\n');
  let changed = false;
  const next = lines.map((line) => {
    const afterComment = canonicalize(line);
    const afterSourceMap = normalizeSourceMapLine(afterComment);
    if (afterSourceMap !== line) changed = true;
    return afterSourceMap;
  });
  if (changed) {
    writeFileSync(filePath, next.join('\n'));
  }
  return changed;
}

function collectMjsFiles(dir, results = []) {
  for (const entry of readdirSync(dir)) {
    // dispatcher.mjs is built by a separate esbuild invocation that never
    // crosses node_modules; leave its build path untouched.
    if (entry === 'dispatcher.mjs') continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      collectMjsFiles(full, results);
    } else if (entry.endsWith('.mjs')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Normalizes every `.mjs` file (recursively, excluding `dispatcher.mjs`)
 * under each of `dirs` in place.
 * @param {string[]} dirs
 * @returns {{ scanned: number, changed: number }}
 */
export function normalizeModuleComments(dirs) {
  let changed = 0;
  let scanned = 0;
  for (const dir of dirs) {
    for (const file of collectMjsFiles(dir)) {
      scanned += 1;
      if (normalizeFile(file)) changed += 1;
    }
  }
  return { scanned, changed };
}

function isMain() {
  return process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;
}

if (isMain()) {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    process.stderr.write('Usage: normalize-hook-module-comments.js <dir> [...dirs]\n');
    process.exit(1);
  }
  const { scanned, changed } = normalizeModuleComments(targets);
  process.stdout.write(`normalize-hook-module-comments: scanned ${scanned} file(s), updated ${changed}\n`);
}

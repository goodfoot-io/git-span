/**
 * Tree-sitter explicit-reference disqualifier.
 *
 * The whole pipeline mines *implicit* couplings — files that change together
 * for reasons the code does not spell out. If two anchors in a group are
 * connected by an *explicit* code reference (a TypeScript `import`/`require`/
 * re-export, or a Rust `use`/`mod`), the coupling is already visible in the
 * source and is therefore not implicit — so this disqualifier contributes
 * evidence *against* the group being a real implicit dependency.
 *
 * Grammars are WASM (design decision 3): `web-tree-sitter` as the runtime and
 * the prebuilt `tree-sitter-rust.wasm` / `tree-sitter-typescript.wasm` shipped
 * by `tree-sitter-wasms`. No native binding, no node-gyp, no network — parsing
 * is fully offline.
 *
 * Parse failure is evidence-neutral (design decision 6). A file that cannot be
 * parsed — unsupported language, syntax error, binary, generated code — never
 * counts as "no reference found" (which would falsely corroborate the group)
 * and never counts as "reference found" (which would falsely disqualify it).
 * When a parse failure blocks a conclusive answer, the evidence is returned
 * with `inconclusive: true`, `strength: 0`, and a `parse_failed` note so the
 * operator sees it happened instead of a silent miscount.
 *
 * Grammar-path resolution has two modes, documented here because they differ
 * between development and a shipped bin:
 *  - **Dev / test** (no `yarn build` has run): grammars load straight from the
 *    installed `tree-sitter-wasms` package under `node_modules`, so the test
 *    suite runs without a prior build step.
 *  - **Prod** (bundled `dist/cli.js`): `scripts/build.js` copies the two
 *    `.wasm` files into `dist/grammars/`, and this module loads them from a
 *    path relative to the bundle — so the installed bin does not depend on
 *    `node_modules/tree-sitter-wasms` surviving at runtime.
 */

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Language, type Node, Parser } from 'web-tree-sitter';
import type { Anchor, AnchorGroup, Disqualifier, DisqualifierEvidence, RepoContext } from '../types.js';

const DISQUALIFIER_NAME = 'tree-sitter-reference';

/**
 * Strength assigned when an explicit reference is found between two anchors —
 * high, but never exactly 1 (scoring clamps inputs anyway, design decision 7),
 * because path-stem matching for Rust `use`/`mod` is a heuristic that can, in
 * principle, match an unrelated same-named module.
 */
const REFERENCE_STRENGTH = 0.9;

// ---------------------------------------------------------------------------
// Language / grammar selection
// ---------------------------------------------------------------------------

type GrammarKind = 'typescript' | 'rust';

interface GrammarSpec {
  kind: GrammarKind;
  wasmFile: string;
}

const TYPESCRIPT: GrammarSpec = { kind: 'typescript', wasmFile: 'tree-sitter-typescript.wasm' };
const RUST: GrammarSpec = { kind: 'rust', wasmFile: 'tree-sitter-rust.wasm' };

const GRAMMAR_BY_EXTENSION: ReadonlyMap<string, GrammarSpec> = new Map([
  ['.ts', TYPESCRIPT],
  ['.tsx', TYPESCRIPT],
  ['.mts', TYPESCRIPT],
  ['.cts', TYPESCRIPT],
  ['.rs', RUST]
]);

function grammarForPath(filePath: string): GrammarSpec | null {
  return GRAMMAR_BY_EXTENSION.get(path.extname(filePath).toLowerCase()) ?? null;
}

const GRAMMARS_SUBDIR = 'grammars';

function moduleDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

/** Resolves a grammar `.wasm` path, preferring the built `dist/grammars/` copy and falling back to the installed package (see module header). */
function resolveGrammarPath(wasmFile: string): string {
  const distPath = path.join(moduleDir(), GRAMMARS_SUBDIR, wasmFile);
  if (fs.existsSync(distPath)) return distPath;
  const require = createRequire(import.meta.url);
  return require.resolve(`tree-sitter-wasms/out/${wasmFile}`);
}

// ---------------------------------------------------------------------------
// web-tree-sitter lifecycle (lazy, process-wide, memoized)
// ---------------------------------------------------------------------------

let initPromise: Promise<void> | null = null;

function ensureInit(): Promise<void> {
  if (!initPromise) initPromise = Parser.init();
  return initPromise;
}

const languageCache = new Map<string, Promise<Language | null>>();

/**
 * Loads (and caches) a grammar. Returns null — never throws — if the grammar
 * cannot be loaded, so a missing/incompatible `.wasm` degrades to an
 * evidence-neutral parse failure rather than crashing the whole report.
 */
function loadLanguage(wasmFile: string): Promise<Language | null> {
  let promise = languageCache.get(wasmFile);
  if (!promise) {
    promise = Language.load(resolveGrammarPath(wasmFile)).catch(() => null);
    languageCache.set(wasmFile, promise);
  }
  return promise;
}

// ---------------------------------------------------------------------------
// Reference extraction
// ---------------------------------------------------------------------------

/**
 * The explicit references a single parsed file makes, normalized for matching
 * against other anchors' paths:
 *  - `paths` — relative import specifiers resolved against the referring
 *    file's directory, extension stripped (e.g. `src/a.ts` importing
 *    `"./helper"` yields `src/helper`).
 *  - `names` — bare module/identifier names (a TS specifier's basename, a Rust
 *    `use`/`mod` identifier) matched against another anchor's filename stem.
 */
interface FileReferences {
  paths: Set<string>;
  names: Set<string>;
}

function stripExtension(filePath: string): string {
  const ext = path.extname(filePath);
  return ext ? filePath.slice(0, -ext.length) : filePath;
}

function unquote(text: string): string {
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' || first === "'" || first === '`') && last === first) {
      return text.slice(1, -1);
    }
  }
  return text;
}

/** First `string` descendant of a node's subtree, unquoted, or null. */
function firstStringLiteral(node: Node): string | null {
  const strings = node.descendantsOfType('string');
  const first = strings[0];
  return first ? unquote(first.text) : null;
}

function addSpecifier(refs: FileReferences, fromPath: string, specifier: string): void {
  const base = stripExtension(path.posix.basename(specifier));
  if (base) refs.names.add(base);
  if (specifier.startsWith('.')) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier));
    refs.paths.add(stripExtension(resolved));
  }
}

function extractTypescriptReferences(root: Node, fromPath: string): FileReferences {
  const refs: FileReferences = { paths: new Set(), names: new Set() };

  // `import ... from "x"` / `import type ... from "x"` and `export ... from "x"`.
  // `descendantsOfType` only ever returns nodes matching the queried grammar
  // type (or `null` in gaps of the query results), so a `null` here is never a
  // real statement to skip — it's just the more conservative 0.25.10 typing.
  for (const kind of ['import_statement', 'export_statement']) {
    for (const stmt of root.descendantsOfType(kind)) {
      if (!stmt) continue;
      const specifier = firstStringLiteral(stmt);
      if (specifier) addSpecifier(refs, fromPath, specifier);
    }
  }

  // `require("x")` calls.
  for (const call of root.descendantsOfType('call_expression')) {
    if (!call) continue;
    if (call.child(0)?.text !== 'require') continue;
    const specifier = firstStringLiteral(call);
    if (specifier) addSpecifier(refs, fromPath, specifier);
  }

  return refs;
}

function extractRustReferences(root: Node, _fromPath: string): FileReferences {
  const refs: FileReferences = { paths: new Set(), names: new Set() };

  // `use crate::foo::Bar;` — every path segment is a candidate module name.
  for (const use of root.descendantsOfType('use_declaration')) {
    if (!use) continue;
    for (const ident of use.descendantsOfType('identifier')) {
      if (ident) refs.names.add(ident.text);
    }
  }

  // `mod foo;` — the declared module name.
  for (const mod of root.descendantsOfType('mod_item')) {
    if (!mod) continue;
    const name = mod.childForFieldName('name')?.text;
    if (name) refs.names.add(name);
  }

  return refs;
}

// ---------------------------------------------------------------------------
// Per-file parse
// ---------------------------------------------------------------------------

type ParseOutcome = { ok: true; refs: FileReferences } | { ok: false };

/**
 * Memoizes `parseFile` per `(RepoContext, path)`. A single run always reads
 * the same anchor path at the same revision (`HEAD`), but a "hub" file can
 * appear as an anchor in a very large number of groups — without this cache,
 * each occurrence re-parses the same unchanged content from scratch, which is
 * the dominant cost of the disqualifier stage on a real repo (a fresh WASM
 * parse per group, not per distinct file). Scoped per `RepoContext` instance
 * (via `WeakMap`, so it never outlives or leaks across runs) rather than
 * keyed on path alone, since two different repos/tests can share a relative
 * path (e.g. `src/a.ts`) with unrelated content.
 */
const parseCacheByContext = new WeakMap<RepoContext, Map<string, Promise<ParseOutcome>>>();

function parseFile(filePath: string, ctx: RepoContext): Promise<ParseOutcome> {
  let cache = parseCacheByContext.get(ctx);
  if (!cache) {
    cache = new Map();
    parseCacheByContext.set(ctx, cache);
  }
  let cached = cache.get(filePath);
  if (!cached) {
    cached = parseFileUncached(filePath, ctx);
    cache.set(filePath, cached);
  }
  return cached;
}

async function parseFileUncached(filePath: string, ctx: RepoContext): Promise<ParseOutcome> {
  const grammar = grammarForPath(filePath);
  if (!grammar) return { ok: false };

  const content = await ctx.fileAt(filePath, 'HEAD');
  if (content === null) return { ok: false };

  await ensureInit();
  const language = await loadLanguage(grammar.wasmFile);
  if (!language) return { ok: false };

  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(content);
  try {
    if (!tree || tree.rootNode.hasError) return { ok: false };
    const refs =
      grammar.kind === 'typescript'
        ? extractTypescriptReferences(tree.rootNode, filePath)
        : extractRustReferences(tree.rootNode, filePath);
    return { ok: true, refs };
  } finally {
    tree?.delete();
    parser.delete();
  }
}

/** True when `from`'s extracted references point at the `to` anchor's file. */
function referencesTarget(from: FileReferences, toPath: string): boolean {
  const noExt = stripExtension(toPath);
  if (from.paths.has(noExt)) return true;
  return from.names.has(path.posix.basename(noExt));
}

// ---------------------------------------------------------------------------
// Disqualifier
// ---------------------------------------------------------------------------

/**
 * Evaluates every internal edge (every unordered pair of distinct-path
 * anchors) of the candidate group exactly once, returning exactly one
 * `DisqualifierEvidence` per edge, always. Never early-returns on the first
 * firing pair (near-clique grouping plan, "Per-edge disqualifiers — exact
 * no-match floor semantics").
 *
 * Per pair, in priority order: a reference in either direction disqualifies
 * that edge at `REFERENCE_STRENGTH`; otherwise, if either anchor in the pair
 * failed to parse, the edge is evidence-neutral and `inconclusive` (design
 * decision 6 — a parse failure blocking *this specific pair*'s conclusion
 * must never masquerade as "no reference found" for that pair, even if some
 * other pair in the same group parsed cleanly); otherwise the edge gets
 * today's clean floor (strength 0, not inconclusive).
 */
const treeSitterReferenceDisqualifier: Disqualifier = async (
  group: AnchorGroup,
  ctx: RepoContext
): Promise<DisqualifierEvidence[]> => {
  const anchorsByPath = distinctAnchorsByPath(group.anchors);
  const paths = [...anchorsByPath.keys()];

  // A reference connects *two* anchors — a group over a single file (or none)
  // has nothing to connect. Evidence-neutral, and not a parse failure.
  if (paths.length < 2) {
    return [{ disqualifier: DISQUALIFIER_NAME, strength: 0 }];
  }

  const outcomes = await Promise.all(paths.map((filePath) => parseFile(filePath, ctx)));
  const parsed = new Map<string, FileReferences>();
  const failed = new Set<string>();
  for (let i = 0; i < paths.length; i++) {
    const outcome = outcomes[i];
    if (outcome.ok) parsed.set(paths[i], outcome.refs);
    else failed.add(paths[i]);
  }

  const results: DisqualifierEvidence[] = [];
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const pathA = paths[i];
      const pathB = paths[j];
      const anchorA = anchorsByPath.get(pathA)!;
      const anchorB = anchorsByPath.get(pathB)!;

      const refsA = parsed.get(pathA);
      const refsB = parsed.get(pathB);

      let direction: string | null = null;
      if (refsA && referencesTarget(refsA, pathB)) direction = `${pathA} -> ${pathB}`;
      else if (refsB && referencesTarget(refsB, pathA)) direction = `${pathB} -> ${pathA}`;

      if (direction) {
        results.push({
          disqualifier: DISQUALIFIER_NAME,
          strength: REFERENCE_STRENGTH,
          detail: `explicit reference: ${direction}`,
          edge: { a: anchorA, b: anchorB }
        });
        continue;
      }

      const failedHere = [pathA, pathB].filter((p) => failed.has(p));
      if (failedHere.length > 0) {
        results.push({
          disqualifier: DISQUALIFIER_NAME,
          strength: 0,
          inconclusive: true,
          detail: `parse_failed: ${failedHere.join(', ')}`,
          edge: { a: anchorA, b: anchorB }
        });
        continue;
      }

      // Both anchors parsed cleanly and neither referenced the other:
      // evaluated, nothing to disqualify.
      results.push({ disqualifier: DISQUALIFIER_NAME, strength: 0, edge: { a: anchorA, b: anchorB } });
    }
  }

  return results;
};

/** First anchor encountered per distinct path, preserving `anchors`' original order. */
function distinctAnchorsByPath(anchors: Anchor[]): Map<string, Anchor> {
  const byPath = new Map<string, Anchor>();
  for (const anchor of anchors) {
    if (!byPath.has(anchor.path)) byPath.set(anchor.path, anchor);
  }
  return byPath;
}

export default treeSitterReferenceDisqualifier;

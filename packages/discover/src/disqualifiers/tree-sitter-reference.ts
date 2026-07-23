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
 * Parses one anchor file and extracts its explicit references. Returns
 * `{ ok: false }` on any parse failure — unsupported extension, missing
 * content, grammar load failure, or a syntax error (`rootNode.hasError`) — so
 * every failure mode funnels into the same evidence-neutral path.
 */
async function parseFile(filePath: string, ctx: RepoContext): Promise<ParseOutcome> {
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

const treeSitterReferenceDisqualifier: Disqualifier = async (
  group: AnchorGroup,
  ctx: RepoContext
): Promise<DisqualifierEvidence> => {
  const paths = distinctAnchorPaths(group.anchors);

  // A reference connects *two* anchors — a group over a single file (or none)
  // has nothing to connect. Evidence-neutral, and not a parse failure.
  if (paths.length < 2) {
    return { disqualifier: DISQUALIFIER_NAME, strength: 0 };
  }

  const outcomes = await Promise.all(paths.map((filePath) => parseFile(filePath, ctx)));
  const parsed = new Map<string, FileReferences>();
  let anyParseFailed = false;
  for (let i = 0; i < paths.length; i++) {
    const outcome = outcomes[i];
    if (outcome.ok) parsed.set(paths[i], outcome.refs);
    else anyParseFailed = true;
  }

  // An explicit reference from any parsed file to any other anchor disqualifies.
  for (const [fromPath, refs] of parsed) {
    for (const toPath of paths) {
      if (toPath === fromPath) continue;
      if (referencesTarget(refs, toPath)) {
        return {
          disqualifier: DISQUALIFIER_NAME,
          strength: REFERENCE_STRENGTH,
          detail: `explicit reference: ${fromPath} -> ${toPath}`
        };
      }
    }
  }

  // No reference found. If a parse failure blocked a file, we cannot conclude
  // "no reference" — surface it as inconclusive (evidence-neutral, visible)
  // rather than silently reporting a clean zero (design decision 6).
  if (anyParseFailed) {
    const failedPaths = paths.filter((filePath) => !parsed.has(filePath));
    return {
      disqualifier: DISQUALIFIER_NAME,
      strength: 0,
      inconclusive: true,
      detail: `parse_failed: ${failedPaths.join(', ')}`
    };
  }

  // Every anchor parsed cleanly and none referenced another: evaluated,
  // nothing to disqualify.
  return { disqualifier: DISQUALIFIER_NAME, strength: 0 };
};

function distinctAnchorPaths(anchors: Anchor[]): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const anchor of anchors) {
    if (seen.has(anchor.path)) continue;
    seen.add(anchor.path);
    paths.push(anchor.path);
  }
  return paths;
}

export default treeSitterReferenceDisqualifier;

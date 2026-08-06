/// <reference lib="dom" />

/**
 * Webview bundle entry for the span viewer: builds the whole DOM -- title row
 * with conditional Drift pill, why prose, the declaration's last-edited line,
 * one card per anchor, uncommitted declaration edit card,
 * collapsed-by-default History accordion -- from the posted `PostedDocument`.
 *
 * The webview has no filesystem access and no CSP allowance to fetch anchor
 * content, so the provider pre-computes everything (content bytes,
 * ladder-resolved history pairs, span-diff threading) and ships it in one
 * structured-clone-safe `postMessage`. Diffs render through Monaco's real
 * `createDiffEditor` code path (`hideUnchangedRegions`, plus the width-driven
 * side-by-side/inline options in `diffLayout`), previews through
 * `monaco.editor.create` with the
 * language resolved from the file extension via
 * `monaco.languages.getLanguages()` -- never a bespoke diff renderer.
 *
 * `self.MonacoEnvironment.getWorker` (Phase C) is preserved unchanged: the
 * fetch-and-Blob-wrap pattern the webview's distinct origin requires.
 *
 * The theme bridge (Phase E) defines a `'git-span'` Monaco theme from the
 * injected `--vscode-*` variables on load and re-defines it whenever the
 * provider relays a workbench theme change. It covers editor chrome only --
 * `rules` stays empty, so syntax colors render from Monaco's bundled base
 * palettes (the plan's accepted tradeoff). Monaco itself loads with this
 * bundle, i.e. on first panel open; no editor is created until the first
 * `document` postMessage arrives.
 *
 * @summary Webview bundle: renders the posted span document with Monaco.
 */

import * as monaco from 'monaco-editor/editor/editor.api.js';

// Narrowed Monaco imports: the editor API core (Monarch highlighting, diff
// algorithm) instead of the full package entry, which also registers the
// css/html/typescript language-service features. The TypeScript one installs
// worker-backed providers for `.ts`/`.tsx`/`.js`/`.jsx` anchors that the
// bundle's editor worker cannot answer ("Missing requestHandler or method:
// getNavigationTree"). The curated basic-language definitions below keep
// `resolveLanguage()` reporting the same ids for every anchor extension, and
// the JSON language feature is kept because its worker is genuinely bundled.
import 'monaco-editor/language/json/monaco.contribution.js';
import 'monaco-editor/languages/definitions/cpp/register.js';
import 'monaco-editor/languages/definitions/css/register.js';
import 'monaco-editor/languages/definitions/go/register.js';
import 'monaco-editor/languages/definitions/html/register.js';
import 'monaco-editor/languages/definitions/ini/register.js';
import 'monaco-editor/languages/definitions/java/register.js';
import 'monaco-editor/languages/definitions/javascript/register.js';
import 'monaco-editor/languages/definitions/markdown/register.js';
import 'monaco-editor/languages/definitions/python/register.js';
import 'monaco-editor/languages/definitions/ruby/register.js';
import 'monaco-editor/languages/definitions/rust/register.js';
import 'monaco-editor/languages/definitions/shell/register.js';
import 'monaco-editor/languages/definitions/typescript/register.js';
import 'monaco-editor/languages/definitions/xml/register.js';
import 'monaco-editor/languages/definitions/yaml/register.js';

import '@vscode/codicons/dist/codicon.css';
import './main.css';

import type { PostedAnchor, PostedDocument, PostedHistoryCommit, UnavailableReason } from '../types.js';
import { anchorRangeLabel } from './anchorRangeLabel.js';
import { hasStatusDot, statusDotLabel } from './anchorStatusDot.js';
import { anchorCardKey, CardOpenStore, commitCardKey, DECLARATION_CARD_KEY } from './cardState.js';
import { LINE_HEIGHT, shouldCollapse } from './collapseRule.js';
import { RESPONSIVE_DIFF_LAYOUT_OPTIONS } from './diffLayout.js';
import { gutterLineNumbers } from './diffLineNumbers.js';
import { disclosureIconClass } from './disclosureIcon.js';
import { formatAge } from './formatAge.js';
import { normalizeThemeColor } from './themeColor.js';

/**
 * The postMessage channel back to the extension host. `acquireVsCodeApi` is
 * injected by VS Code into every webview -- it is not importable.
 */
interface VSCodeWebviewApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeWebviewApi;

const vscode = acquireVsCodeApi();

/**
 * The reader's collapsed/expanded choices, surviving the full DOM replacement
 * every posted document performs.
 */
const cardOpenStore = new CardOpenStore(vscode);

/**
 * Worker script per Monaco worker label, resolved relative to this bundle
 * (both live in dist/webview, served via asWebviewUri). The narrowed import
 * above registers no language-service feature beyond JSON, so only the editor
 * and JSON workers are bundled -- "JSON/generic Monarch only" -- and any other
 * label falls back to the editor worker, matching Monaco's own default.
 */
const WORKER_SCRIPTS: Readonly<Record<string, string>> = {
  editorWorkerService: 'editor.worker.js',
  json: 'json.worker.js'
};

const workerBlobUrls = new Map<string, Promise<string>>();

/**
 * Fetch a worker script through its webview-resource URL and wrap the
 * response text in a Blob so the worker can be constructed from a `blob:`
 * URL. A webview's script runs from a distinct/null origin, so
 * `new Worker(asWebviewUriString)` is a cross-origin construction and
 * reliably throws -- this is the pattern VS Code's own Monaco integrations
 * use. Phase E's CSP covers the pieces: `connect-src ${webview.cspSource}`
 * for the fetch, `worker-src blob:` for the construction.
 *
 * @param scriptName - The worker script filename, resolved relative to this
 *   bundle (both live in dist/webview).
 * @returns A promise of the `blob:` URL the worker is constructed from; the
 *   result is cached per script so each worker file is fetched once.
 */
function getWorkerBlobUrl(scriptName: string): Promise<string> {
  let pending = workerBlobUrls.get(scriptName);
  if (pending === undefined) {
    pending = fetch(new URL(scriptName, import.meta.url).toString())
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `Failed to fetch Monaco worker script "${scriptName}": ${response.status} ${response.statusText}`
          );
        }
        return response.text();
      })
      .then((text) => URL.createObjectURL(new Blob([text], { type: 'text/javascript' })));
    workerBlobUrls.set(scriptName, pending);
  }
  return pending;
}

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Promise<Worker> {
    const scriptName = WORKER_SCRIPTS[label] ?? 'editor.worker.js';
    return getWorkerBlobUrl(scriptName).then((blobUrl) => new Worker(blobUrl));
  }
};

/**
 * The Monaco built-in base themes the bridge can target, matched by the
 * provider's `data-vscode-theme` attribute and `themeChanged` message kind.
 * `base` decides the token palette Monaco falls back to for syntax colors;
 * chrome colors come from the bridged `--vscode-*` variables (the accepted
 * tradeoff -- TextMate token colors are never bridged).
 */
type ThemeKind = 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';

/**
 * Detect the active Monaco base theme: the provider's `data-vscode-theme`
 * attribute first (authoritative -- it mirrors `activeColorTheme.kind` at
 * open time), then VS Code's own injected `vscode-*` body classes.
 *
 * @returns The detected base theme.
 * @throws Never.
 */
function detectThemeKind(): ThemeKind {
  const data = document.body.dataset['vscodeTheme'];
  if (data === 'vs-dark' || data === 'hc-black' || data === 'hc-light') {
    return data;
  }
  const classes = document.body.classList;
  if (classes.contains('vscode-high-contrast')) {
    return 'hc-black';
  }
  if (classes.contains('vscode-dark')) {
    return 'vs-dark';
  }
  return 'vs';
}

/**
 * (Re-)define the `'git-span'` Monaco theme from the webview's injected
 * `--vscode-*` variables and make it active. VS Code re-injects those
 * variables on every workbench theme change, so re-running this with the new
 * `base` picks up both the new chrome colors and the new token palette, and
 * existing editor instances follow via `monaco.editor.setTheme`.
 *
 * Editor chrome only -- `rules` stays empty: the webview's variables cover
 * the workbench color registry but never include TextMate `tokenColors`, so
 * syntax highlighting renders from Monaco's bundled base palettes (the
 * plan's accepted tradeoff).
 *
 * Every value passes through `normalizeThemeColor` first. VS Code serializes
 * transparent colors as `rgba(...)`, but Monaco parses `defineTheme` colors
 * with `Color.fromHex()` -- literally `parseHex(value) || Color.red` -- so
 * forwarding a variable unconverted paints every transparent color opaque
 * red inside the embedded editors. That silently hit all four diff colors
 * (registered as required-transparent) plus the selection and line-highlight
 * colors. Values the normalizer rejects, including variables VS Code does not
 * inject at all (e.g. `contrastBorder` outside high-contrast themes), are
 * skipped so Monaco falls back to the inherited base palette.
 *
 * The two naming schemes differ by one character: Monaco's color ids keep the
 * dot (`diffEditor.insertedTextBorder`), while the injected CSS variable
 * replaces it with a dash (`--vscode-diffEditor-insertedTextBorder`).
 *
 * @param kind - The Monaco base theme to bridge from.
 * @throws Never.
 */
function defineGitSpanTheme(kind: ThemeKind): void {
  const style = getComputedStyle(document.body);
  const read = (name: string): string => style.getPropertyValue(`--vscode-${name}`);
  const colors: Record<string, string> = {};
  const pairs: ReadonlyArray<readonly [string, string]> = [
    ['editor.background', 'editor-background'],
    ['editor.foreground', 'editor-foreground'],
    ['editor.lineHighlightBackground', 'editor-lineHighlightBackground'],
    ['editor.selectionBackground', 'editor-selectionBackground'],
    ['editor.inactiveSelectionBackground', 'editor-inactiveSelectionBackground'],
    ['editorLineNumber.foreground', 'editorLineNumber-foreground'],
    ['editorWidget.background', 'editorWidget-background'],
    ['editorWidget.border', 'widget-border'],
    ['diffEditor.insertedLineBackground', 'diffEditor-insertedLineBackground'],
    ['diffEditor.removedLineBackground', 'diffEditor-removedLineBackground'],
    ['diffEditor.insertedTextBackground', 'diffEditor-insertedTextBackground'],
    ['diffEditor.removedTextBackground', 'diffEditor-removedTextBackground'],
    ['diffEditor.insertedTextBorder', 'diffEditor-insertedTextBorder'],
    ['diffEditor.removedTextBorder', 'diffEditor-removedTextBorder'],
    ['diffEditor.diagonalFill', 'diffEditor-diagonalFill'],
    ['diffEditor.unchangedRegionBackground', 'diffEditor-unchangedRegionBackground'],
    ['diffEditor.unchangedRegionForeground', 'diffEditor-unchangedRegionForeground'],
    ['diffEditor.unchangedCodeBackground', 'diffEditor-unchangedCodeBackground'],
    ['diffEditor.border', 'diffEditor-border'],
    ['diffEditorGutter.insertedLineBackground', 'diffEditorGutter-insertedLineBackground'],
    ['diffEditorGutter.removedLineBackground', 'diffEditorGutter-removedLineBackground'],
    ['contrastBorder', 'contrastBorder']
  ];
  for (const [monacoId, vscodeVariable] of pairs) {
    const value = normalizeThemeColor(read(vscodeVariable));
    if (value !== null) {
      colors[monacoId] = value;
    }
  }
  monaco.editor.defineTheme('git-span', {
    base: kind,
    inherit: true,
    colors,
    rules: []
  });
  monaco.editor.setTheme('git-span');
}

// Bridge the theme before any document arrives: the first `postMessage` is
// `ready`, and editors must be themed from the moment they are created.
defineGitSpanTheme(detectThemeKind());

/**
 * Post a message back to the extension host.
 *
 * @param message - The message payload, matched by `type` in the host.
 * @throws Never.
 */
function post(message: unknown): void {
  vscode.postMessage(message);
}

/** Tell the host this webview is alive; it re-posts the last document. */
post({ type: 'ready' });

/** The most recently posted document, for the History accordion's labels. */
let currentDocument: PostedDocument | null = null;

/** Every Monaco editor and model created for the current render. */
const trackedDisposables: monaco.IDisposable[] = [];

function track(disposable: monaco.IDisposable): void {
  trackedDisposables.push(disposable);
}

function disposeTracked(): void {
  for (let i = trackedDisposables.length - 1; i >= 0; i--) {
    trackedDisposables[i]?.dispose();
  }
  trackedDisposables.length = 0;
}

/**
 * Create a DOM element with an optional class name and text content. Text is
 * set via `textContent` so posted content can never be interpreted as HTML.
 * The return type follows the tag name, so `details.open`, `button.type`, and
 * `a.href` type-check at the call sites.
 *
 * @param tag - The element's tag name.
 * @param className - Optional class name.
 * @param text - Optional text content.
 * @returns The created element.
 * @throws Never.
 */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className !== undefined) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

/**
 * Split a repo-relative path into its directory and basename parts.
 *
 * @param filePath - The repo-relative file path.
 * @returns The `dir` (possibly empty) and `base` components.
 * @throws Never.
 */
function splitPath(filePath: string): { dir: string; base: string } {
  const slashIndex = filePath.lastIndexOf('/');
  if (slashIndex === -1) {
    return { dir: '', base: filePath };
  }
  return { dir: filePath.slice(0, slashIndex), base: filePath.slice(slashIndex + 1) };
}

/**
 * Split an anchor address into its file path and `#L`-range fragment.
 *
 * @param address - A full anchor address (`path#Lstart-Lend` or bare path).
 * @returns The path and the range fragment (minus the `#L` prefix and the
 *   fragment's own leading `L`), or `null`.
 * @throws Never.
 */
function splitAddress(address: string): { path: string; range: string | null } {
  const hashIndex = address.indexOf('#L');
  if (hashIndex === -1) {
    return { path: address, range: null };
  }
  // Drop the fragment's leading `L` so callers prepending their own `#L`
  // prefix produce `#L10-L20`, never `#LL10-L20`.
  return { path: address.slice(0, hashIndex), range: address.slice(hashIndex + 1).replace(/^L/, '') };
}

/**
 * Resolve a Monaco language id from a file path's extension, via the
 * languages Monaco itself has registered (a small lookup, not a maintained
 * map). An extension matching no registered language falls back to
 * `'plaintext'` explicitly. A `#L` range suffix on a history-block path
 * (`src.ts#L1-L3`) is stripped before the extension is extracted.
 *
 * @param filePath - The repo-relative file path, with or without a range.
 * @returns A Monaco language id (`'plaintext'` when nothing matches).
 * @throws Never.
 */
function resolveLanguage(filePath: string): string {
  const hashIndex = filePath.indexOf('#');
  const pathOnly = hashIndex === -1 ? filePath : filePath.slice(0, hashIndex);
  const dotIndex = pathOnly.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === pathOnly.length - 1) {
    return 'plaintext';
  }
  const extension = `.${pathOnly.slice(dotIndex + 1).toLowerCase()}`;
  for (const language of monaco.languages.getLanguages()) {
    if (language.extensions?.some((registered) => registered.toLowerCase() === extension)) {
      return language.id;
    }
  }
  return 'plaintext';
}

/**
 * Count the content lines of a text (the split artifact of a trailing newline
 * is not a line).
 *
 * @param text - The text to count lines of.
 * @returns The number of content lines.
 * @throws Never.
 */
function countLines(text: string): number {
  if (text === '') {
    return 0;
  }
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

/** Reason-specific copy for `unavailable` status cards -- never one shared label. */
const UNAVAILABLE_COPY: Record<UnavailableReason, string> = {
  absent: 'The anchored file is absent at this location -- it may have been deleted or moved.',
  'range-past-eof': 'The anchored line range lies beyond the end of the file.',
  binary: 'The anchored file is binary and cannot be previewed.',
  'filter-failed':
    "The file's .gitattributes filter driver produced no content -- fix the filter driver, then re-check this span.",
  unrecoverable: 'No snapshot hashes to the recorded token; the recorded content can no longer be recovered.'
};

const CHANGED_COPY = 'This file changed while the span was being checked -- reopen the view to re-check it.';
const DANGLING_COPY = "No commit in this span's history covers this anchor.";
const UNRECONSTRUCTABLE_COPY = 'This history could not be reconstructed from the recorded diffs.';
const TRUNCATED_COPY = 'History before this point could not be reconstructed.';

/**
 * How long a clipped diff body waits for `onDidUpdateDiff` before revealing
 * itself anyway. Only reached when the diff computation never completes.
 */
const DIFF_REVEAL_TIMEOUT_MS = 1500;

/**
 * Scrollbar and ruler options shared by every embedded editor.
 *
 * Ported from VS Code's multi-diff editor, which forces the same set on each
 * entry (`diffEditorItemTemplate.ts`, `_updateOptions`) so the file list owns
 * all vertical scrolling and no editor traps the wheel. Here the page itself
 * plays that role: `handleMouseWheel: false` lets wheel events bubble out to
 * the document, so scrolling never stalls when the pointer is over an editor.
 *
 * Deliberate divergence: VS Code also hides the *horizontal* scrollbar and
 * drives `scrollLeft` from its outer container. There is no outer horizontal
 * scroller here, and long lines still have to be reachable, so the horizontal
 * scrollbar keeps its default `auto` behaviour.
 */
const NO_VERTICAL_SCROLL_OPTIONS = {
  scrollBeyondLastLine: false,
  scrollbar: {
    vertical: 'hidden',
    handleMouseWheel: false,
    useShadows: false
  },
  overviewRulerBorder: false
} as const satisfies monaco.editor.IEditorOptions;

/**
 * Size `host` to the tallest of `editors`' rendered content, and keep it there.
 *
 * Cards never scroll internally, so the host has to track content height for
 * the life of the editor rather than being measured once: expanding one of
 * `hideUnchangedRegions`' collapsed runs, or crossing the side-by-side
 * breakpoint, both change the rendered height after creation.
 *
 * Taking the max across the passed editors covers both diff layouts -- inline
 * renders everything in the modified editor, side-by-side splits across the
 * two and either side can be the taller one.
 *
 * @param host - The element holding the editor(s).
 * @param editors - The code editors whose content the host must fit.
 * @returns A function reading the current rendered height in px.
 * @throws Never.
 */
function bindContentHeight(host: HTMLElement, editors: readonly monaco.editor.ICodeEditor[]): () => number {
  const measure = (): number => {
    let height = 0;
    for (const editor of editors) {
      height = Math.max(height, editor.getContentHeight());
    }
    return height;
  };
  const apply = (): void => {
    host.style.height = `${measure()}px`;
  };
  for (const editor of editors) {
    track(editor.onDidContentSizeChange(apply));
  }
  apply();
  return measure;
}

/**
 * A plain preview: `monaco.editor.create` over the posted content, read-only,
 * sized to its full content and never scrolling internally. The height is set
 * explicitly because the host div has no intrinsic size.
 *
 * The initial collapse decision is taken synchronously from the content's line
 * count, which for a preview *is* its rendered line count -- wrapping and
 * folding are both off and there are no unchanged-region strips -- so the card
 * is already in its final state on the first paint, with nothing to settle.
 *
 * @param content - The content to preview.
 * @param language - The Monaco language id to highlight with.
 * @param card - Optional card whose initial open state this body decides.
 * @returns The preview's host element.
 * @throws Never.
 */
function createPreview(content: string, language: string, card?: HTMLDetailsElement): HTMLElement {
  const lineCount = countLines(content);
  const host = el('div', 'monaco-host');
  host.style.height = `${Math.max(lineCount, 1) * LINE_HEIGHT}px`;

  if (card !== undefined) {
    card.open = !shouldCollapse(lineCount * LINE_HEIGHT);
  }

  const model = monaco.editor.createModel(content, language);
  track(model);
  const editor = monaco.editor.create(host, {
    model,
    readOnly: true,
    automaticLayout: true,
    minimap: { enabled: false },
    folding: false,
    glyphMargin: false,
    overviewRulerLanes: 0,
    ...NO_VERTICAL_SCROLL_OPTIONS
  });
  track(editor);
  void bindContentHeight(host, [editor]);
  return host;
}

/**
 * A Monaco diff editor over an `(original, modified)` pair, with
 * `hideUnchangedRegions` collapsing unchanged runs inside large anchors, sized
 * to its full rendered content and never scrolling internally.
 *
 * Renders side by side or inline depending on the editor's own width, per
 * {@linkcode RESPONSIVE_DIFF_LAYOUT_OPTIONS}; Monaco re-decides on resize, and
 * {@linkcode bindContentHeight} re-measures because either layout can be the
 * taller one.
 *
 * When `card` is given, the body is clipped to zero height until the first
 * `onDidUpdateDiff`. A diff's rendered height is only knowable once the diff
 * has been computed -- `hideUnchangedRegions` cannot fold anything before then,
 * and an inline diff renders both sides' changed lines, so no cheap bound on
 * the raw line counts exists. Clipping means the reader sees the card's final
 * open state on the first paint instead of watching a tall body snap shut.
 *
 * The models carry only the anchor extent's own lines, so without an offset
 * Monaco would number the gutter from 1. When a side's file-absolute first
 * line is given, that side's gutter is renumbered from it (see
 * {@linkcode gutterLineNumbers}); omitted sides keep Monaco's default, which
 * is right for whole-file diffs like the `.span` declaration's.
 *
 * @param original - The pre-edit side of the diff.
 * @param modified - The post-edit side of the diff.
 * @param language - The Monaco language id to highlight with.
 * @param card - Optional card whose initial open state this body decides.
 * @param originalStartLine - The original side's file-absolute first line.
 * @param modifiedStartLine - The modified side's file-absolute first line.
 * @returns The diff editor's host element, or the clip wrapper around it.
 * @throws Never.
 */
function createDiff(
  original: string,
  modified: string,
  language: string,
  card?: HTMLDetailsElement,
  originalStartLine?: number,
  modifiedStartLine?: number
): HTMLElement {
  const lineCount = Math.max(countLines(original), countLines(modified));
  const host = el('div', 'monaco-host');
  host.style.height = `${Math.max(lineCount, 1) * LINE_HEIGHT}px`;

  // The clip only exists to hide the pre-diff height; without a card to
  // decide, the host stands alone and paints immediately.
  const root = card === undefined ? host : el('div');
  if (root !== host) {
    root.style.height = '0';
    root.style.overflow = 'hidden';
    root.appendChild(host);
  }

  const originalModel = monaco.editor.createModel(original, language);
  const modifiedModel = monaco.editor.createModel(modified, language);
  track(originalModel);
  track(modifiedModel);

  const diffEditor = monaco.editor.createDiffEditor(host, {
    readOnly: true,
    automaticLayout: true,
    hideUnchangedRegions: { enabled: true },
    minimap: { enabled: false },
    renderOverviewRuler: false,
    ...RESPONSIVE_DIFF_LAYOUT_OPTIONS,
    ...NO_VERTICAL_SCROLL_OPTIONS
  });
  diffEditor.setModel({ original: originalModel, modified: modifiedModel });
  track(diffEditor);

  // The offset is per side, not per diff: the diff editor shares one
  // `lineNumbers` value across both sub-editors, and a rename block's sides
  // live in different addresses' line spaces. Applied after `setModel`, which
  // is where each sub-editor's options take effect.
  if (originalStartLine !== undefined) {
    diffEditor.getOriginalEditor().updateOptions({ lineNumbers: gutterLineNumbers(originalStartLine) });
  }
  if (modifiedStartLine !== undefined) {
    diffEditor.getModifiedEditor().updateOptions({ lineNumbers: gutterLineNumbers(modifiedStartLine) });
  }

  const measure = bindContentHeight(host, [diffEditor.getOriginalEditor(), diffEditor.getModifiedEditor()]);

  if (card !== undefined) {
    let settled = false;
    const reveal = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      // Measured here rather than cached: `onDidUpdateDiff` and the
      // fold-driven content-size event have no guaranteed order, and a height
      // read before `hideUnchangedRegions` folded would over-collapse.
      card.open = !shouldCollapse(measure());
      root.style.removeProperty('height');
      root.style.removeProperty('overflow');
    };
    track(diffEditor.onDidUpdateDiff(reveal));
    // Safety net: a diff that never resolves must not leave the body
    // permanently invisible. Reveals from whatever height is known by then.
    const timer = setTimeout(reveal, DIFF_REVEAL_TIMEOUT_MS);
    track({ dispose: () => clearTimeout(timer) });
  }
  return root;
}

/**
 * A header-only status line (codicon + copy), for unavailable/raced/dangling
 * cards.
 *
 * @param copy - The reason-specific status copy.
 * @returns The status card element.
 * @throws Never.
 */
function createStatusCard(copy: string): HTMLElement {
  const card = el('div', 'status-card');
  card.appendChild(el('i', 'codicon codicon-warning'));
  card.appendChild(el('span', undefined, copy));
  return card;
}

/**
 * The address-change banner for a relocated anchor: bare range or filename
 * pair.
 *
 * @param fromAddress - The anchor's recorded address.
 * @param toAddress - The anchor's proposed address.
 * @returns The rename banner element.
 * @throws Never.
 */
function createRenameBanner(fromAddress: string, toAddress: string): HTMLElement {
  const from = splitAddress(fromAddress);
  const to = splitAddress(toAddress);
  const banner = el('div', 'rename-banner');
  if (from.path === to.path && from.range !== null && to.range !== null) {
    banner.appendChild(el('span', undefined, `#L${from.range}`));
  } else {
    banner.appendChild(el('span', undefined, from.path));
  }
  banner.appendChild(el('span', 'arrow', '→'));
  if (from.path === to.path && from.range !== null && to.range !== null) {
    banner.appendChild(el('span', undefined, `#L${to.range}`));
  } else {
    banner.appendChild(el('span', undefined, to.path));
  }
  return banner;
}

/**
 * The disclosure chevron for a collapsible card, bound to that card's real
 * open state.
 *
 * The `details` element stays the single source of truth: the chevron is
 * derived from `details.open` at construction and re-derived on every
 * `toggle`, so it is correct whether the card starts expanded or collapsed
 * and stays correct as the user toggles it -- nothing here assumes an
 * initial state.
 *
 * The element is decorative and marked `aria-hidden`: `details`/`summary`
 * already expose the expanded state to assistive technology, and the
 * filename beside it is the row's real label.
 *
 * @param details - The card whose open state the chevron mirrors.
 * @returns The chevron element, to be placed first in the summary row.
 * @throws Never.
 */
function createDisclosureChevron(details: HTMLDetailsElement): HTMLElement {
  const chevron = el('i', disclosureIconClass(details.open));
  chevron.setAttribute('aria-hidden', 'true');
  details.addEventListener('toggle', () => {
    chevron.className = disclosureIconClass(details.open);
  });
  return chevron;
}

/**
 * Put a card into the state the reader last chose for it, and keep recording
 * their choices.
 *
 * Returns `undefined` for a card the reader has never touched, which is the
 * caller's signal to hand the card to its body builder and let the
 * rendered-height rule decide. A card that comes back with a choice is *not*
 * handed over: the builders flip `open` from a measurement they take
 * themselves -- {@linkcode createDiff} does it asynchronously, after the diff
 * settles -- so overriding them afterwards would either lose the race or
 * visibly re-toggle the card. Withholding the card leaves the state set here
 * as the only one applied.
 *
 * Only a real activation of the summary row counts as a choice. Clicks on the
 * row's buttons stop propagating before they reach it, and the builders' own
 * `open` assignments produce no click at all -- so a measured default is never
 * mistaken for something the reader asked for, and an anchor that later grows
 * past the collapse threshold still starts closed.
 *
 * Must be called before the card's chevron is built: the chevron derives its
 * glyph from `details.open` at construction.
 *
 * @param details - The card to restore and watch.
 * @param summary - The card's summary row, the reader's toggle surface.
 * @param key - The card's persisted-state key.
 * @param defaultOpen - The state to use when the reader has no choice on
 *   record and the body has no height to measure.
 * @returns The reader's recorded choice, or `undefined` when there is none.
 * @throws Never.
 */
function bindOpenState(
  details: HTMLDetailsElement,
  summary: HTMLElement,
  key: string,
  defaultOpen: boolean
): boolean | undefined {
  const choice = cardOpenStore.choice(key);
  details.open = choice ?? defaultOpen;

  let readerDriven = false;
  summary.addEventListener('click', (event) => {
    if (event.isTrusted && !event.defaultPrevented) {
      readerDriven = true;
    }
  });
  details.addEventListener('toggle', () => {
    if (!readerDriven) {
      return;
    }
    readerDriven = false;
    cardOpenStore.record(key, details.open);
  });

  return choice;
}

/**
 * One anchor card: header bar (chevron, filename, line range, path, dot,
 * go-to-file) plus body. Cards render open so a freshly-opened span shows its
 * anchors without
 * interaction, except where the body's rendered height crosses the collapse
 * threshold -- the body builder flips `open` to false in that case, since
 * cards never scroll internally and an unbounded one would bury everything
 * below it. A card the reader has already collapsed or expanded keeps that
 * state instead and is never measured.
 *
 * @param anchor - The posted anchor to render.
 * @returns The anchor card's `details` element.
 * @throws Never.
 */
function createAnchorCard(anchor: PostedAnchor): HTMLElement {
  const details = el('details', 'anchor');
  const summary = el('summary');
  // Passing the card to a body builder is what opts it into the height rule,
  // so only a card without a recorded choice is handed over.
  const measured = bindOpenState(details, summary, anchorCardKey(anchor.address), true) === undefined;
  const card = measured ? details : undefined;
  summary.appendChild(createDisclosureChevron(details));

  const { dir, base } = splitPath(anchor.path);
  summary.appendChild(el('span', 'fname', base));
  const rangeLabel = anchorRangeLabel(anchor.range);
  if (rangeLabel !== null) {
    summary.appendChild(el('span', 'frange', rangeLabel));
  }
  if (dir !== '') {
    summary.appendChild(el('span', 'fpath', dir));
  }
  // The dot trails the path group, matching the multi-diff header's
  // `.status`-after-`.file-path` order: since a clean anchor wears no dot,
  // leading with it would indent every clean filename out of line with the
  // drifted ones. Absent kinds omit the element outright rather than render it
  // transparent -- an invisible span still occupies its flex gap.
  if (hasStatusDot(anchor.kind)) {
    const dot = el('span', 'dot drift');
    dot.title = statusDotLabel(anchor.kind);
    summary.appendChild(dot);
  }
  summary.appendChild(el('span', 'spacer'));

  const goButton = el('button', 'icon-btn');
  goButton.type = 'button';
  goButton.title = 'Go to file';
  goButton.appendChild(el('i', 'codicon codicon-go-to-file'));
  goButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    post({ type: 'goToFile', path: anchor.path, range: anchor.range });
  });
  summary.appendChild(goButton);
  details.appendChild(summary);

  const body = el('div');
  switch (anchor.kind) {
    case 'clean':
      body.appendChild(createPreview(anchor.content, resolveLanguage(anchor.path), card));
      break;
    case 'drifted':
    case 'reconciled':
      // Drifted-deleted (current null) renders original=recorded, modified='';
      // drifted-new (historical null) renders original='', modified=current.
      body.appendChild(
        createDiff(
          anchor.historical ?? '',
          anchor.current ?? '',
          resolveLanguage(anchor.path),
          card,
          anchor.historicalStartLine,
          anchor.currentStartLine
        )
      );
      break;
    case 'relocated':
      // Never a diff editor with identical sides: banner plus plain preview.
      body.appendChild(createRenameBanner(anchor.address, anchor.proposed));
      body.appendChild(createPreview(anchor.content, resolveLanguage(anchor.path), card));
      break;
    case 'unavailable':
      body.appendChild(createStatusCard(UNAVAILABLE_COPY[anchor.reason]));
      break;
    case 'changed':
      body.appendChild(createStatusCard(CHANGED_COPY));
      break;
    case 'dangling':
      body.appendChild(createStatusCard(DANGLING_COPY));
      break;
  }
  details.appendChild(body);
  return details;
}

/**
 * The uncommitted declaration edit card (`current.span_diff`), per the
 * mockup. Called only when an uncommitted edit exists; the `'unavailable'`
 * marker renders a status card in place of a diff.
 *
 * Starts collapsed on the same rendered-height rule as an anchor card, and
 * honours a recorded choice ahead of it the same way. The `'unavailable'`
 * branch has no editor to measure and so always stays open -- a one-line
 * status card has nothing to bury.
 *
 * @param edit - The resolved uncommitted edit pair, or `'unavailable'`.
 * @returns The card's `details` element.
 * @throws Never.
 */
function createUncommittedCard(edit: Exclude<PostedDocument['uncommittedEdit'], undefined>): HTMLElement {
  const details = el('details', 'anchor');
  const summary = el('summary');
  const measured = bindOpenState(details, summary, DECLARATION_CARD_KEY, true) === undefined;
  summary.appendChild(createDisclosureChevron(details));

  const { dir, base } = splitPath(edit === 'unavailable' ? '.span' : edit.path);
  summary.appendChild(el('span', 'fname', base));
  if (dir !== '') {
    summary.appendChild(el('span', 'fpath', dir));
  }
  // Trails the path group exactly as the anchor card's dot does. A declaration
  // has no line range to sit between them; keeping the dot in the same slot is
  // what holds the two card types structurally identical.
  const dot = el('span', 'dot drift');
  dot.title = 'uncommitted edit';
  summary.appendChild(dot);
  summary.appendChild(el('span', 'spacer'));

  if (edit !== 'unavailable') {
    const goButton = el('button', 'icon-btn');
    goButton.type = 'button';
    goButton.title = 'Go to file';
    goButton.appendChild(el('i', 'codicon codicon-go-to-file'));
    goButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      post({ type: 'goToFile', path: edit.path, range: null });
    });
    summary.appendChild(goButton);
  }
  details.appendChild(summary);

  const body = el('div');
  const title = el('div', 'difftitle');
  title.appendChild(el('b', undefined, 'Uncommitted edit'));
  body.appendChild(title);
  if (edit === 'unavailable') {
    body.appendChild(createStatusCard(UNRECONSTRUCTABLE_COPY));
  } else {
    body.appendChild(createDiff(edit.original, edit.modified, 'plaintext', measured ? details : undefined));
  }
  details.appendChild(body);
  return details;
}

/**
 * One history accordion entry: summary row (chevron, summary text,
 * relative+absolute age, abbreviated hash link). The body is built lazily on the first open --
 * the ladder is pure string work with no I/O, so this avoids wasted editor
 * construction on collapsed sections.
 *
 * Entries are collapsed by default but keyed by commit hash, so an entry the
 * reader opened comes back open after a re-render; restoring it builds the
 * body immediately rather than waiting for a toggle that has already happened.
 *
 * @param commit - The posted history commit to render.
 * @returns The commit's `details` element.
 * @throws Never.
 */
function createCommitEntry(commit: PostedHistoryCommit): HTMLElement {
  const details = el('details', 'commit');

  const summary = el('summary');
  const restored = bindOpenState(details, summary, commitCardKey(commit.hash), false);
  summary.appendChild(createDisclosureChevron(details));
  summary.appendChild(el('span', 'csum', commit.summary));
  summary.appendChild(el('span', 'cdate', formatAge(commit.date)));
  const hashLink = el('a', 'csha', commit.hash.slice(0, 7));
  hashLink.href = '#';
  hashLink.title = 'Open commit';
  hashLink.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    post({ type: 'openCommit', hash: commit.hash });
  });
  summary.appendChild(hashLink);
  details.appendChild(summary);

  const body = el('div');
  let built = false;
  const build = (): void => {
    if (built) {
      return;
    }
    built = true;
    buildCommitBody(commit, body);
  };
  details.addEventListener('toggle', () => {
    if (details.open) {
      build();
    }
  });
  details.appendChild(body);
  if (restored === true) {
    build();
  }
  return details;
}

/**
 * Build one history entry's body: span_diff first, then per-anchor blocks.
 *
 * @param commit - The posted history commit whose body to build.
 * @param body - The container to append the body into.
 * @throws Never.
 */
function buildCommitBody(commit: PostedHistoryCommit, body: HTMLElement): void {
  if (commit.spanDiff !== undefined) {
    body.appendChild(el('div', 'patchtitle', `.span/${currentDocument?.spanName ?? ''}`));
    if (commit.spanDiff === 'unavailable') {
      body.appendChild(createStatusCard(UNRECONSTRUCTABLE_COPY));
    } else {
      body.appendChild(createDiff(commit.spanDiff.original, commit.spanDiff.modified, 'plaintext'));
    }
  }
  for (const block of commit.blocks) {
    body.appendChild(el('div', 'patchtitle', block.path));
    if (block.rebound !== undefined) {
      // Header-only rebound block: the token transition, no diff editor.
      const banner = el('div', 'rebound-banner');
      banner.appendChild(el('span', undefined, block.rebound.from));
      banner.appendChild(el('span', 'arrow', '→'));
      banner.appendChild(el('span', undefined, block.rebound.to));
      body.appendChild(banner);
    } else if (block.unavailable) {
      body.appendChild(createStatusCard(block.truncated === true ? TRUNCATED_COPY : UNRECONSTRUCTABLE_COPY));
    } else if (block.pair !== undefined) {
      body.appendChild(
        createDiff(
          block.pair.original,
          block.pair.modified,
          resolveLanguage(block.path),
          undefined,
          block.pair.originalStartLine,
          block.pair.modifiedStartLine
        )
      );
    }
  }
}

/**
 * The collapsed-by-default History accordion section (the page's only
 * heading).
 *
 * @param history - The posted history commits, newest first.
 * @returns The section element.
 * @throws Never.
 */
function createHistorySection(history: PostedHistoryCommit[]): HTMLElement {
  const section = el('section');
  const heading = el('h2');
  heading.append('History', el('span', 'count', `(${history.length})`));
  section.appendChild(heading);
  for (const commit of history) {
    section.appendChild(createCommitEntry(commit));
  }
  return section;
}

/**
 * Replace the whole document body with the posted document's render.
 *
 * @param posted - The document posted by the extension host.
 * @throws Never.
 */
function renderDocument(posted: PostedDocument): void {
  currentDocument = posted;
  disposeTracked();
  // Before any card is built: the builders read their restored state from the
  // store, and this is where choices about cards the document no longer has
  // are dropped.
  cardOpenStore.adopt(posted);

  const app = document.getElementById('app');
  if (app === null) {
    return;
  }

  const frame = el('div', 'frame');

  const titlebar = el('div', 'titlebar');
  titlebar.appendChild(el('h1', undefined, posted.spanName));
  if (posted.drift) {
    const pill = el('span', 'drift-pill');
    pill.title = posted.driftReasons.join('; ');
    pill.appendChild(el('span', 'dot-sm'));
    pill.append('Drift');
    titlebar.appendChild(pill);
  }

  // Reopens this `.span` file with VS Code's default (text) editor. The icon
  // carries no text, so the accessible name has to come from the button
  // itself and must name the outcome rather than the glyph.
  const editButton = el('button', 'icon-btn');
  editButton.type = 'button';
  editButton.title = 'Open in text editor';
  editButton.setAttribute('aria-label', 'Open in text editor');
  editButton.appendChild(el('i', 'codicon codicon-edit'));
  editButton.addEventListener('click', () => {
    post({ type: 'reopenAsText' });
  });
  titlebar.appendChild(editButton);

  frame.appendChild(titlebar);

  const why = el('div', 'why');
  why.appendChild(el('p', undefined, posted.why));
  frame.appendChild(why);

  // Absent whenever neither the commit date nor the mtime resolved: render no
  // line rather than a placeholder that reads like a real date.
  if (posted.updatedAt !== undefined) {
    frame.appendChild(el('p', 'updated', `Updated ${formatAge(posted.updatedAt)}`));
  }

  if (posted.uncommittedEdit !== undefined) {
    frame.appendChild(createUncommittedCard(posted.uncommittedEdit));
  }

  for (const anchor of posted.anchors) {
    frame.appendChild(createAnchorCard(anchor));
  }

  if (posted.history.length > 0) {
    frame.appendChild(createHistorySection(posted.history));
  }

  // The titlebar's edit button is the sole entry point to `reopenAsText`.
  frame.appendChild(el('p', 'footnote', 'Rendered by the git-span extension.'));

  app.replaceChildren(frame);
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const message = event.data as { type?: unknown };
  if (message?.type === 'themeChanged') {
    const kind = (message as { kind?: unknown }).kind;
    if (kind === 'vs' || kind === 'vs-dark' || kind === 'hc-black' || kind === 'hc-light') {
      // Keep the attribute in step with the active theme so detection stays
      // consistent with the provider's view.
      document.body.dataset['vscodeTheme'] = kind;
      defineGitSpanTheme(kind);
    }
    return;
  }
  if (message?.type === 'document') {
    renderDocument((message as { document: PostedDocument }).document);
  }
});

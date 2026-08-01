/// <reference lib="dom" />

/**
 * Webview bundle entry for the span viewer: builds the whole DOM -- title row
 * with conditional Stale pill, why prose, one card per anchor, uncommitted
 * declaration edit card, collapsed-by-default History accordion -- from the
 * posted `PostedDocument`.
 *
 * The webview has no filesystem access and no CSP allowance to fetch anchor
 * content, so the provider pre-computes everything (content bytes,
 * ladder-resolved history pairs, span-diff threading) and ships it in one
 * structured-clone-safe `postMessage`. Diffs render through Monaco's real
 * `createDiffEditor` code path (`renderSideBySide: false`,
 * `hideUnchangedRegions`), previews through `monaco.editor.create` with the
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

import * as monaco from 'monaco-editor';

import '@vscode/codicons/dist/codicon.css';
import './main.css';

import type { PostedAnchor, PostedDocument, PostedHistoryCommit, UnavailableReason } from '../types.js';

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
 * Worker script per Monaco worker label, resolved relative to this bundle
 * (both live in dist/webview, served via asWebviewUri). The full package
 * entry registers css/html/typescript language contributions too, but per
 * the plan only the editor and JSON workers are bundled -- "JSON/generic
 * Monarch only" -- and any other label falls back to the editor worker,
 * matching Monaco's own default.
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
 * plan's accepted tradeoff). Empty variables (e.g. `contrastBorder` outside
 * high-contrast themes) are skipped -- Monaco parses every color it is
 * given, and `''` is not a color.
 *
 * @param kind - The Monaco base theme to bridge from.
 * @throws Never.
 */
function defineGitSpanTheme(kind: ThemeKind): void {
  const style = getComputedStyle(document.body);
  const read = (name: string): string => style.getPropertyValue(`--vscode-${name}`).trim();
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
    ['contrastBorder', 'contrastBorder']
  ];
  for (const [monacoId, vscodeVariable] of pairs) {
    const value = read(vscodeVariable);
    if (value !== '') {
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

/**
 * `N unit(s) ago` phrasing for relative ages.
 *
 * @param count - The elapsed count in `unit`s.
 * @param unit - The singular unit name.
 * @returns The relative-age phrase.
 * @throws Never.
 */
function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

/**
 * Relative + absolute age of a commit from its v2 ISO `date` field, e.g.
 * `1 day ago (Jul 29, 2026 at 3:12 PM)`.
 *
 * @param isoDate - The commit's ISO date string.
 * @returns The combined age label (the raw string when unparseable).
 * @throws Never.
 */
function formatAge(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  const absolute = date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  let relative: string;
  if (seconds < 45) {
    relative = 'just now';
  } else if (seconds < 3600) {
    relative = plural(Math.round(seconds / 60), 'minute');
  } else if (seconds < 86400) {
    relative = plural(Math.round(seconds / 3600), 'hour');
  } else if (seconds < 604800) {
    relative = plural(Math.round(seconds / 86400), 'day');
  } else if (seconds < 2592000) {
    relative = plural(Math.round(seconds / 604800), 'week');
  } else if (seconds < 31536000) {
    relative = plural(Math.round(seconds / 2592000), 'month');
  } else {
    relative = plural(Math.round(seconds / 31536000), 'year');
  }
  return `${relative} (${absolute})`;
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

/** Preview height in px per content line, matching Monaco's default line height. */
const LINE_HEIGHT = 18;
/** Previews longer than this many lines render capped with a "Show all" button. */
const CAP_LINES = 10;
const MIN_DIFF_HEIGHT = 60;
const MAX_DIFF_HEIGHT = 600;

/**
 * A capped plain preview: `monaco.editor.create` over the posted content,
 * read-only, with a "Show all N lines" button when the content exceeds the
 * cap. The editor's height is set explicitly because the host div has no
 * intrinsic size.
 *
 * @param content - The content to preview.
 * @param language - The Monaco language id to highlight with.
 * @returns The preview wrapper element.
 * @throws Never.
 */
function createPreview(content: string, language: string): HTMLElement {
  const lineCount = countLines(content);
  const capped = lineCount > CAP_LINES;
  const wrapper = el('div');
  const host = el('div', 'monaco-host');
  host.style.height = `${Math.max(capped ? CAP_LINES : lineCount, 1) * LINE_HEIGHT}px`;
  wrapper.appendChild(host);

  const model = monaco.editor.createModel(content, language);
  track(model);
  const editor = monaco.editor.create(host, {
    model,
    readOnly: true,
    automaticLayout: true,
    scrollBeyondLastLine: false,
    minimap: { enabled: false },
    folding: false,
    glyphMargin: false
  });
  track(editor);

  if (capped) {
    const button = el('button', 'showall', `Show all ${lineCount} lines`);
    button.type = 'button';
    button.addEventListener('click', () => {
      host.style.height = `${lineCount * LINE_HEIGHT}px`;
      button.remove();
    });
    wrapper.appendChild(button);
  }
  return wrapper;
}

/**
 * A Monaco inline diff editor over an `(original, modified)` pair, with
 * `hideUnchangedRegions` collapsing unchanged runs inside large anchors.
 *
 * @param original - The pre-edit side of the diff.
 * @param modified - The post-edit side of the diff.
 * @param language - The Monaco language id to highlight with.
 * @returns The diff editor's host element.
 * @throws Never.
 */
function createDiff(original: string, modified: string, language: string): HTMLElement {
  const lineCount = Math.max(countLines(original), countLines(modified));
  const host = el('div', 'monaco-host');
  host.style.height = `${Math.min(Math.max(lineCount * LINE_HEIGHT, MIN_DIFF_HEIGHT), MAX_DIFF_HEIGHT)}px`;

  const originalModel = monaco.editor.createModel(original, language);
  const modifiedModel = monaco.editor.createModel(modified, language);
  track(originalModel);
  track(modifiedModel);

  const diffEditor = monaco.editor.createDiffEditor(host, {
    readOnly: true,
    automaticLayout: true,
    renderSideBySide: false,
    hideUnchangedRegions: { enabled: true },
    scrollBeyondLastLine: false,
    minimap: { enabled: false }
  });
  diffEditor.setModel({ original: originalModel, modified: modifiedModel });
  track(diffEditor);
  return host;
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
 * The status dot's class per anchor kind.
 *
 * @param kind - The posted anchor's kind.
 * @returns The dot's class suffix (`clean` or `drift`).
 * @throws Never.
 */
function kindDot(kind: PostedAnchor['kind']): string {
  return kind === 'clean' ? 'clean' : 'drift';
}

/**
 * The status dot's tooltip per anchor kind.
 *
 * @param kind - The posted anchor's kind.
 * @returns The tooltip copy for that kind.
 * @throws Never.
 */
function kindLabel(kind: PostedAnchor['kind']): string {
  switch (kind) {
    case 'clean':
      return 'clean';
    case 'drifted':
    case 'reconciled':
      return 'drifted';
    case 'relocated':
      return 'relocated';
    case 'unavailable':
      return 'unavailable';
    case 'changed':
      return 'content changed while this span was being checked';
    case 'dangling':
      return 'no history';
  }
}

/**
 * One anchor card: header bar (dot, filename, dir path, go-to-file) plus
 * body. Cards render open by default so a freshly-opened span shows its
 * anchors without interaction.
 *
 * @param anchor - The posted anchor to render.
 * @returns The anchor card's `details` element.
 * @throws Never.
 */
function createAnchorCard(anchor: PostedAnchor): HTMLElement {
  const details = el('details', 'anchor');
  details.open = true;

  const summary = el('summary');
  const dot = el('span', `dot ${kindDot(anchor.kind)}`);
  dot.title = kindLabel(anchor.kind);
  summary.appendChild(dot);

  const { dir, base } = splitPath(anchor.path);
  summary.appendChild(el('span', 'fname', base));
  if (dir !== '') {
    summary.appendChild(el('span', 'fpath', dir));
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
      body.appendChild(createPreview(anchor.content, resolveLanguage(anchor.path)));
      break;
    case 'drifted':
    case 'reconciled':
      // Drifted-deleted (current null) renders original=recorded, modified='';
      // drifted-new (historical null) renders original='', modified=current.
      body.appendChild(createDiff(anchor.historical ?? '', anchor.current ?? '', resolveLanguage(anchor.path)));
      break;
    case 'relocated':
      // Never a diff editor with identical sides: banner plus plain preview.
      body.appendChild(createRenameBanner(anchor.address, anchor.proposed));
      body.appendChild(createPreview(anchor.content, resolveLanguage(anchor.path)));
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
 * @param edit - The resolved uncommitted edit pair, or `'unavailable'`.
 * @returns The card's `details` element.
 * @throws Never.
 */
function createUncommittedCard(edit: Exclude<PostedDocument['uncommittedEdit'], undefined>): HTMLElement {
  const details = el('details', 'anchor');
  details.open = true;

  const summary = el('summary');
  const dot = el('span', 'dot drift');
  dot.title = 'uncommitted edit';
  summary.appendChild(dot);

  const { dir, base } = splitPath(edit === 'unavailable' ? '.span' : edit.path);
  summary.appendChild(el('span', 'fname', base));
  if (dir !== '') {
    summary.appendChild(el('span', 'fpath', dir));
  }
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
    body.appendChild(createDiff(edit.original, edit.modified, 'plaintext'));
  }
  details.appendChild(body);
  return details;
}

/**
 * One history accordion entry: summary row (summary text, relative+absolute
 * age, abbreviated hash link). The body is built lazily on the first open --
 * the ladder is pure string work with no I/O, so this avoids wasted editor
 * construction on collapsed sections.
 *
 * @param commit - The posted history commit to render.
 * @returns The commit's `details` element.
 * @throws Never.
 */
function createCommitEntry(commit: PostedHistoryCommit): HTMLElement {
  const details = el('details', 'commit');

  const summary = el('summary');
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
  details.addEventListener('toggle', () => {
    if (details.open && !built) {
      built = true;
      buildCommitBody(commit, body);
    }
  });
  details.appendChild(body);
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
      body.appendChild(createDiff(block.pair.original, block.pair.modified, resolveLanguage(block.path)));
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

  const app = document.getElementById('app');
  if (app === null) {
    return;
  }

  const frame = el('div', 'frame');

  const titlebar = el('div', 'titlebar');
  titlebar.appendChild(el('h1', undefined, posted.spanName));
  if (posted.stale) {
    const pill = el('span', 'stale-pill');
    pill.title = posted.staleReasons.join('; ');
    pill.appendChild(el('span', 'dot-sm'));
    pill.append('Stale');
    titlebar.appendChild(pill);
  }
  frame.appendChild(titlebar);

  const why = el('div', 'why');
  why.appendChild(el('p', undefined, posted.why));
  frame.appendChild(why);

  if (posted.uncommittedEdit !== undefined) {
    frame.appendChild(createUncommittedCard(posted.uncommittedEdit));
  }

  for (const anchor of posted.anchors) {
    frame.appendChild(createAnchorCard(anchor));
  }

  if (posted.history.length > 0) {
    frame.appendChild(createHistorySection(posted.history));
  }

  const footnote = el('p', 'footnote');
  footnote.append('Rendered by the git-span extension. ');
  const reopen = el('a', undefined, 'Reopen as text');
  reopen.href = '#';
  reopen.addEventListener('click', (event) => {
    event.preventDefault();
    post({ type: 'reopenAsText' });
  });
  footnote.appendChild(reopen);
  footnote.append('.');
  frame.appendChild(footnote);

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

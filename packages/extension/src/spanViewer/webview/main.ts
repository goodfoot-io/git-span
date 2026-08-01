/// <reference lib="dom" />

/**
 * Webview entry point for the span viewer.
 *
 * Bundled by the webview esbuild pass (browser platform, ESM) into
 * dist/webview/main.js and loaded by the custom editor's HTML template.
 * It runs inside the sandboxed webview iframe, never in the extension host.
 *
 * Phase C scope is dependency and bundling infrastructure only. The full
 * `monaco-editor` package entry is imported rather than
 * `monaco-editor/esm/vs/editor/editor.api` because the api-only entry pulls
 * zero language contributions — every preview and diff would render as
 * plaintext regardless of file extension. `self.MonacoEnvironment.getWorker`
 * is wired up with the fetch-and-Blob-wrap pattern the webview's distinct
 * origin requires. Phase D replaces `activate()` with the real rendering
 * logic.
 *
 * @summary Webview bundle entry: Monaco worker plumbing and activate hook.
 */

import * as monaco from 'monaco-editor';

import './main.css';

/**
 * Worker script per Monaco worker label, resolved relative to this bundle
 * (both live in dist/webview, served via asWebviewUri). The full package
 * entry registers css/html/typescript language contributions too, but per
 * the plan only the editor and JSON workers are bundled — "JSON/generic
 * Monarch only" — and any other label falls back to the editor worker,
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
 * reliably throws — this is the pattern VS Code's own Monaco integrations
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
 * No-op for Phase C; Phase D replaces this with the real rendering logic
 * (monaco.editor.create / createDiffEditor over the posted document). The
 * `monaco` binding is referenced here so the full-package import above stays
 * live — its side effects register every bundled language contribution.
 */
export function activate(): void {
  void monaco;
}

# Cards webview inspection

Load this for any task driving or verifying the Cards extension's UI — including reproducing what `packages/demo-scripter/demos/qa/**` demos do, without that framework.

## 1. CLI vs CDP — pick the right tool

The `cards-extension` CLI drives extension/editor/window state directly over the Cards server relay — no keystrokes, no DOM races. CDP/puppeteer is for what the CLI can't reach: rendered pixels and webview-internal DOM/JS state. Commands used most often for QA-style tasks are inlined below — that's usually enough. Only load the `cards:cards` skill's `references/extension-cli.md` if you need a CLI subcommand not covered here (e.g. `workspace`, `debug`, `attribution`, `notify`).

`execute-command` prints `Warning: lossyCoercion — result contains values that could not be serialized exactly` on stderr even on success, whenever the underlying VS Code command returns `undefined`/`void` (most navigation commands do) — this is expected, not a failure.

- **Invoke a VS Code command** (open a view, run a built-in command, etc.): use the CLI, not CDP.
  ```
  echo '[]' | cards-extension execute-command <commandId> --workspace /workspace
  ```
  There is **no CDP path** to invoke an arbitrary VS Code command. If the CLI is unavailable, fall back to simulating Command Palette keystrokes (open palette, type, Enter) — slower and racier.

  Command IDs to open Cards views (from `packages/extension/package.json`'s `contributes.commands`/`contributes.viewsContainers`; grep there for others):
  | Command ID | Opens |
  |---|---|
  | `workbench.view.extension.cards-panel` | Cards list view (activity-bar container `cards-panel`) |
  | `cards.viewArchive` | Archive view |
  | `cards.viewWorktrees` | Worktrees view |
  | `cards.backToCardsList` | Return to the list from detail/create |
  | `cards.openCard` | A specific card's detail panel — pass the card id as a CLI stdin arg: `echo '["main-368"]' \| cards-extension execute-command cards.openCard --workspace /workspace`. This is the way to open a detail panel — dispatching a synthetic `.click()` on the card's list-item element via CDP does not trigger the SPA's navigation. |
  | `cards.createCard` | Create-card panel — **mutates state on submit**; in QA/exploration contexts, navigate to it to inspect the form and stop there |

  General pattern for any view container: `workbench.view.extension.<containerId>`, where `<containerId>` comes from `contributes.viewsContainers.activitybar[].id`.

- **Read/set editor state** (active file, cursor, selection): use the CLI as ground truth.
  ```
  cards-extension editor open <filePath> --line <n> --workspace /workspace
  cards-extension editor info --workspace /workspace   # {filePath, line, column} — ground truth
  ```
  Use `editor info` rather than scraping `.tab.active` via CDP to confirm which file is open — the `active` class marks the focused *editor group*, which can differ from the file the CLI just opened if focus wasn't stolen (e.g. `--focus=false`), so a DOM check can misreport.

- **Verify webview rendering/internal state** (is the panel showing the right card, is a button visible, pixel-level checks): only CDP reaches this — the CLI has no visibility inside webview iframes. See sections 2-4 below.

`bin/open-cards-view.mjs` wraps the "run command, then confirm it rendered" sequence in one call (see SKILL.md Section 2) — use it instead of running the CLI command and the CDP confirmation as two separate manual steps.

## 2. Locating a Cards webview

Cards renders each panel (list, detail, create) as a **double-nested iframe**: an outer `iframe.webview` in the workbench DOM, wrapping an inner bare `iframe` holding the actual app. `page.frames()` returns both; the leaf frame (no child frames) is the one to evaluate against.

```js
const frames = page.frames();
const inner = frames.find(f => f.url().includes('vscode-webview') && f.childFrames().length === 0);
```

The outer `iframe.webview` frame's URL also contains `vscode-webview` — `childFrames().length === 0` (leaf) is what disambiguates it from the inner one, not the URL substring alone.

After running `execute-command` to open a view, the webview frame may not exist yet — `page.frames()` can return the outer frame with zero children for a brief window before the inner frame attaches. Poll (e.g. retry every 200ms up to a few seconds) until a leaf `vscode-webview` frame appears, rather than querying once immediately after the command.

VSCode keeps a webview mounted as a background editor tab even after you navigate away from it — so once more than one card has ever been opened in a session, several leaf `vscode-webview` frames coexist at once (e.g. the list plus two previously-viewed cards' detail panels). "The first leaf frame found" is not reliably "the one you just opened." `bin/lib.mjs`'s `findCardsWebviewFrame(page, { cardId })` handles this by matching each candidate frame's `__INIT_DATA__.cardId` against the `cardId` you pass (default `null` for list/create) — use it (or its `cardId`-matching approach, if writing raw CDP) rather than taking `page.frames()`'s first match.

## 3. Identifying which panel is open

Evaluate `window.__INIT_DATA__` inside the inner frame — its shape tells you which panel:

- **Detail panel**: `__INIT_DATA__.cardId` is set, matching the target card.
- **List panel**: `#root` present, `__INIT_DATA__.baseUrl` is a string, no `cardId`, `document.title === "Cards"`.
- **Create panel**: same shape as list, disambiguate only by `document.title === "Create Card"`.

```js
const initData = await inner.evaluate(() => ({
  cardId: window.__INIT_DATA__?.cardId,
  baseUrl: window.__INIT_DATA__?.baseUrl,
  hasRoot: !!document.getElementById('root'),
  title: document.title,
}));
```

`__INIT_DATA__` also carries a live `accessToken` for the webview's local API server — treat it as a secret and keep it out of anything you log.

Sub-views reached via `cards.viewArchive`/`cards.viewWorktrees`/`cards.backToCardsList` render inside the same SPA shell with identical `__INIT_DATA__` shape, no route in `location.hash`/`location.href`, and `document.title` stays `"Cards"` — so `document.title`/`__INIT_DATA__` alone can't tell them apart. To confirm one of these opened, rely on the command you ran to identify which view it should be, and poll `document.body.innerText` until it changes from what it was before the command, confirming the view actually re-rendered.

## 4. Clicking `@vscode-elements` components (e.g. `vscode-button`)

These set `icon`/`title` as JS properties (Lit, no `reflect:true`) — CSS attribute selectors (`vscode-button[icon="x"]`) never match. Find by JS property, then call `.click()` directly inside the page context:

```js
await inner.evaluate((target) => {
  const btn = Array.from(document.querySelectorAll('vscode-button')).find(el => el.icon === target);
  btn?.click();
}, 'trash'); // the icon name
```

Poll rather than assuming immediate presence — these buttons often mount after an async fetch.

`bin/click-button.mjs` does exactly this — discover a real `icon` value first with `bin/find-buttons.mjs` (Section 5) rather than guessing one.

## 5. Card list items

Card list items are **not** `vscode-button` — they're `[role="option"]` elements with a `data-card-id` attribute (class `CardListItem`), not JS properties:

```js
const cards = await inner.evaluate(() =>
  Array.from(document.querySelectorAll('[role="option"]')).map(el => ({
    cardId: el.getAttribute('data-card-id'),
    text: el.textContent?.trim().slice(0, 80),
  }))
);
```

`bin/find-buttons.mjs` returns these under `options` (alongside `vscode-button`s under `buttons`) — use it instead of guessing selectors.

---
name: vscode
description: Use puppeteer/CDP to connect to, screenshot, and inspect a remote VSCode instance running the Cards extension over Tailscale (vscode.heron-stork.ts.net) — for QA, debugging, or driving the Cards UI, including tasks like those in packages/demo-scripter/demos/qa.
---

<instructions>

## 1. Preflight

```!
CDP_RESPONSE=$(curl -s -m 5 -H "Host: localhost" http://vscode.heron-stork.ts.net:9222/json/version 2>/dev/null)
if [ -z "$CDP_RESPONSE" ]; then
  echo "BLOCKED: no CDP on vscode.heron-stork.ts.net:9222"
  exit 1
fi
node -e "require('puppeteer-core')" 2>/dev/null || echo "BLOCKED: puppeteer-core not installed — run from /workspace"
echo "--- open windows (pick a targetId for the scripts below) ---"
node ${CLAUDE_SKILL_DIR}/bin/list-windows.mjs
```

Note the `id` of the window you want — every `bin/` script below takes it as `<targetId>` (`${CLAUDE_SKILL_DIR}` resolves to this skill's own directory).

## 2. bin/ scripts

Each connects, does one thing, disconnects, and prints JSON. Run with `node ${CLAUDE_SKILL_DIR}/bin/<script>.mjs <args>`.

| Script | Args | Does |
|---|---|---|
| `list-windows.mjs` | *(none)* | Prints `[{id, title}, ...]` for open VSCode windows. Already run in Preflight. |
| `screenshot.mjs` | `<targetId> <outPath>` | Screenshots one window. Pass an absolute path under the scratchpad for `outPath`. |
| `open-cards-view.mjs` | `<targetId> <commandId> [cliArgsJSON] [expectCardId] [timeoutMs]` | Runs a `cards-extension` command to navigate the Cards UI, then polls for and prints the resulting webview's state. The usual way to open/change a Cards view and confirm it worked in one step. `cliArgsJSON` defaults to `[]` — pass it explicitly (e.g. `'["main-368"]'`) only when the command takes an argument. |
| `find-cards-webview.mjs` | `<targetId> [cardId] [timeoutMs]` | Polls for a Cards webview's state (`cardId`, `baseUrl`, `hasRoot`, `title`, `bodyText`) without navigating first — use when a view is already open and you just need to (re-)check it. |
| `find-buttons.mjs` | `<targetId> [cardId] [timeoutMs]` | Lists clickable elements in a Cards webview — `vscode-button`s (with `icon`/`title`) and `role="option"`/`role="button"` elements like card list items (with `data-card-id`). Run this **before** `click-button.mjs` to get a real `icon` value instead of guessing one. |
| `click-button.mjs` | `<targetId> <icon> [cardId] [timeoutMs]` | Finds and clicks a `<vscode-button>` by its `icon` JS property. **Mutates state** — click only buttons `find-buttons.mjs` shows are navigation-style, never delete/archive/submit actions. |

Every script's `[cardId]` param: pass a card's id to target its detail panel, or omit it (or pass `null`) for the list/create panel — several Cards webviews can be mounted at once, and `cardId` is what picks the right one.

Example — open a specific card's detail panel and confirm it rendered:
```
node ${CLAUDE_SKILL_DIR}/bin/open-cards-view.mjs <targetId> cards.openCard '["main-368"]' main-368
```

Example — open the Cards list view:
```
node ${CLAUDE_SKILL_DIR}/bin/open-cards-view.mjs <targetId> workbench.view.extension.cards-panel
```

## 3. Conditional references — load only when needed

- **Cards-specific mechanics not covered above** (view command IDs beyond the common ones, double-nested iframe structure, `@vscode-elements` click quirks, card-list DOM selectors, CLI-vs-CDP tradeoffs, `lossyCoercion` CLI warning): **load `reference/cards-webview.md`**.
- **A `bin/` script and `bin/lib.mjs` genuinely don't cover the task** (one-off console log capture, custom raw CDP): **load `reference/raw-cdp.md`**.
- **Task needs port 9333** (CPU/heap profiling, `Runtime.evaluate` in the extension host's own JS context — distinct from the renderer CDP on 9222 that everything else here uses): **load `reference/extension-host.md`**.

</instructions>

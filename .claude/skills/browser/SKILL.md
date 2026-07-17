---
name: browser
description: Direct browser control via CDP for web interaction (automation, scraping, testing, screenshots) using the browser-use CLI against Browser Use Cloud remote browsers. This container has no local Chrome/CDP — every session is a cloud browser.
---

<instructions>

## Why remote-only

There is no local Chrome in this container, so **never** attempt the local-Chrome flow (`chrome://inspect`, `--doctor` "chrome running" checks, `browser-use auth login`). Every session must be a Browser Use Cloud remote daemon.

## 1. Start a remote daemon

`BU_NAME` is an arbitrary label you invent per session — not a fixed or persistent value. Pick a new short made-up name each time you start a fresh browser (e.g. `r7k2`); reusing a name that's still running fails with `daemon already alive` (see the 429/`--doctor` note below for intentionally reusing an existing one).

Cloud browsers bill until stopped, and a crashed/abandoned agent won't call `stop_remote_daemon` — always pass `timeout=<minutes, 1-240>` as a safety net so the browser self-terminates even if step 3 never runs:

```bash
browser-use <<'PY'
start_remote_daemon("r7k2", timeout=30)
PY
```

This prints a `liveUrl` — share it with the user so they can watch the session. There is no local GUI.

If this fails with an HTTP 429 (rate limited), run `browser-use --doctor` to list already-running sessions and reuse one with its existing name (`BU_NAME=<existing-name>`) instead of retrying `start_remote_daemon`.

## 2. Drive it

**Every single command — not just the first — must set `BU_NAME`** to the same name used in `start_remote_daemon`. Omitting it makes the daemon try to fall back to a local Chrome that doesn't exist in this container, crashing with a `DevToolsActivePort not found` error and killing the session:

```bash
# ✅ correct — BU_NAME set on every call
BU_NAME=r7k2 browser-use <<'PY'
new_tab("https://example.com")
ensure_real_tab()   # attach to the real tab, not an invisible omnibox popup
wait_for_load()
print(page_info())
PY

# ❌ wrong — no BU_NAME, daemon tries local Chrome, crashes the session
browser-use <<'PY'
list_tabs()
PY
```

- First navigation on a tab is `new_tab(url)`, not `goto_url(url)`.
- Call `ensure_real_tab()` right after `new_tab()`/`start_remote_daemon()` — a fresh session's only CDP target can be an invisible `chrome://omnibox-popup` page, which silently swallows navigation/clicks meant for the real page.
- Helpers (`new_tab`, `page_info`, `capture_screenshot`, `click_at_xy`, `js`, `cdp`, etc.) are pre-imported — no imports needed in the heredoc.
- Do not start a new remote daemon and then keep using a different `BU_NAME` — one name per active session.

## 3. Stop it when done

Cloud daemons bill until stopped or timed out. Before ending a task, ask the user directly: "Should I close this browser now?" If yes:

```bash
BU_NAME=r7k2 browser-use <<'PY'
stop_remote_daemon("r7k2")
PY
```

## Page workflow

- Screenshots first: `capture_screenshot()` returns a file path (e.g. `/home/node/.config/browser-harness/tmp/shot.png`) — `print()` it, then `Read` the path to view the image.
- Clicking: screenshot -> read pixel coords -> `click_at_xy(x, y)` -> screenshot again to confirm.
- After navigation, call `wait_for_load()`.
- If the current tab is stale, internal, or navigation/clicks seem to land on the wrong page, call `ensure_real_tab()`.
- Native `<select>` dropdowns: don't coordinate-click the opened option — it doesn't reliably update the element's value. Set it directly: `js("document.querySelector('select#id').value='opt'; document.querySelector('select#id').dispatchEvent(new Event('change'))")`.
- Use `js(...)` for DOM inspection/extraction when coordinates are the wrong tool. Target elements with a specific selector (`#id`, `[name=...]`, `button[type=submit]`) — a bare tag selector like `document.querySelector('button')` can silently grab the wrong element on pages with more than one match.
- Login walls: stop and ask. Exception: available SSO can be used automatically if already signed in; still stop for passwords, MFA, consent, or ambiguous account choice.
- Raw CDP is available via `cdp("Domain.method", ...)` — except file inputs, see `reference/uploads.md`.

## Interaction skills — load only when needed

| File | Load when... |
|---|---|
| `reference/connection.md` | A tab seems attached but invisible/wrong, or `new_tab`/`goto_url` act on the wrong target |
| `reference/dialogs.md` | `page_info()` returns a `dialog` key, or a flow triggers `alert`/`confirm`/`prompt`/`beforeunload` |
| `reference/uploads.md` | Task needs a file upload (`cdp("Input.setInputFiles", ...)` does not work) |
| `reference/profile-sync.md` | The task needs a logged-in session (reuse an existing Browser Use cloud profile) |
| `reference/screenshots.md` | Screenshots come back oversized, or click coordinates from a screenshot land in the wrong place |
| `reference/tabs.md` | Managing more than one tab in a session |

Upstream source (for updates, or to check for newly-filled-in topics not yet mirrored here): https://github.com/browser-use/browser-harness/tree/main/interaction-skills

## Design constraints

- Coordinate clicks are the default — CDP mouse events pass through iframes/shadow DOM/cross-origin content at the compositor level.
- Connection model: `BU_NAME` selects the daemon; `BU_CDP_URL` (HTTP DevTools endpoint, resolved to WebSocket by the daemon) / `BU_CDP_WS` are available for advanced cases.

## Gotchas

- Omnibox popups are not real work tabs.
- Multiple sub-agents needing isolated browsing must use distinct `BU_NAME`s (and distinct `start_remote_daemon` names) — they are separate billed cloud browsers.

</instructions>

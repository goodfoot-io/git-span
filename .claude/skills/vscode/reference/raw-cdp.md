# Raw CDP (when a bin/ script and bin/lib.mjs don't cover the task)

Load this only once you've confirmed the `bin/*.mjs` scripts (SKILL.md Section 2) and importing `bin/lib.mjs` directly don't cover what you need — e.g. one-off console log capture, or a custom combination of steps.

- `9222` — renderer CDP (Chrome/Electron), what the `bin/` scripts use. Covered below.
- `9333` — extension-host Node inspector (CPU/heap profiling, `Runtime.evaluate` in the extension host's own JS context). Load `reference/extension-host.md` instead when the task needs 9333.

Every HTTP request (`/json/version`, `/json/list`) and the WebSocket handshake must send the header `Host: localhost` — Chrome/Node refuse real hostnames as DNS-rebinding protection. Use `curl -H "Host: localhost"` or Node's core `http` module for these; both honor a `Host` header override. `fetch`/undici silently drops it instead, producing a confusing body-parse error rather than a clear rejection.

Pipe node scripts via stdin **from `/workspace`** (`cd /workspace && node << 'EOF' ... EOF`):
- `puppeteer-core`/`ws` resolve from `/workspace/node_modules` when the stdin cwd is under `/workspace`; running from `/tmp` fails module resolution entirely.
- The stdin heredoc form sidesteps the harmless-but-noisy `MODULE_TYPELESS_PACKAGE_JSON` warning a saved `.js` file under `/workspace` prints (its `package.json` lacks `"type": "module"`), and leaves no throwaway script behind in the repo. Save real output (screenshots, profiles) to the scratchpad path; the script itself only needs to exist for the duration of the heredoc.
- The heredoc body is top-level module code: top-level `await` works, but a bare top-level `return` throws `SyntaxError: Illegal return statement`. For early-exit control flow, use `if`/`else` or wrap the logic in `async function main() { ... }; await main();`.

Connect and get a `page` for a specific window — reuse `bin/lib.mjs` rather than re-deriving the `/json/version` → UUID → `puppeteer.connect()` handshake and the `Target.getTargetInfo` matching loop it already implements:

```js
import { connect, getPageByTargetId } from "${CLAUDE_SKILL_DIR}/bin/lib.mjs";
const browser = await connect();
const page = await getPageByTargetId(browser, "<id from Preflight/list-windows.mjs>");
// ... your custom logic on `page` ...
await browser.disconnect(); // keeps VSCode running; close() would terminate it
```

`getPageByTargetId` internally calls `(await page.createCDPSession()).send('Target.getTargetInfo')` on each page and compares `targetInfo.targetId`. If you write this loop yourself (e.g. to also read `targetInfo.title` for a similar-titles tie-break), remember the response nests fields under a `targetInfo` key: `{ targetInfo: { targetId, title, ... } }`. It throws (doesn't hang or fail silently) if no page matches the given `targetId`, with a message pointing at `list-windows.mjs`.

If two windows have similar/generic titles and `getPageByTargetId`'s `id` match isn't enough context, break the tie with page content, not more CDP metadata — e.g. `page.evaluate(() => Array.from(document.querySelectorAll('.tab .label-name')).map(el => el.textContent))` to check every open tab in that window, not just `.tab.active` (a file can be open in a background tab, not the frontmost one).

Console logs — CDP sessions belong to a `page`; call `page.createCDPSession()` even to capture console output from a webview iframe on that page, since it's one Chromium renderer process for the whole window (frames don't have their own `createCDPSession()`):

```js
const client = await page.createCDPSession();
await client.send("Runtime.enable");
client.on("Runtime.consoleAPICalled", (e) => {
  console.log(`[${e.type}]`, e.args.map((a) => a.value ?? a.description).join(" "));
});
```

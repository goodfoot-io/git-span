---
name: resize-vscode-window
description: Resizes a remote VSCode window's OS-level frame (e.g. to a specific pixel size or aspect ratio like 16:9) over CDP. Use when asked to "resize the VSCode window", "make the window 16:9", "set the window size", or "shrink/enlarge the VSCode window".
---

<instructions>

## 1. Find the target window

List open windows and note the `id` of the one to resize:

```bash
node /workspace/.claude/skills/resize-vscode-window/bin/list-windows.mjs
```

## 2. Resize it

```bash
node /workspace/.claude/skills/resize-vscode-window/bin/resize-window.mjs <targetId> <width> <height>
```

For a 16:9 aspect ratio, pick any `width`/`height` pair in that ratio (e.g. `1920 1080` or `1600 900`).

This drives the resize via `window.resizeTo(width, height)` executed in the window's renderer through CDP (`Runtime.evaluate`). **Do not** attempt this via the `Browser.setWindowBounds` / `Browser.getWindowForTarget` CDP methods (e.g. through Puppeteer's `browser.setWindowBounds()` or `page.windowId()`) — Electron's CDP implementation does not implement the `Browser.*` domain at all and returns `'<method>' wasn't found` for every method in it, even at the browser-level (non-sessioned) WebSocket endpoint. `window.resizeTo` works because it hits `Runtime.evaluate`, which Electron does implement, and Electron forwards the DOM API call to the real `BrowserWindow.setBounds`.

## 3. Confirm it worked

Screenshot the window and check the image dimensions, rather than trusting the synchronous return value of `window.resizeTo` alone — `window.outerWidth`/`outerHeight` update immediately in the renderer regardless of whether the underlying OS window actually moved, so treat them as unconfirmed until a screenshot shows the new size (accounting for the display's DPI scale factor, e.g. a 2x Retina display screenshots a 1920×1080 window as 3840×2160):

```bash
node /workspace/.claude/skills/resize-vscode-window/bin/screenshot.mjs <targetId> /absolute/scratchpad/path.png
```

</instructions>

#!/usr/bin/env node
// Usage: node list-windows.mjs
// Prints JSON array of open VSCode windows: [{ id, title }, ...]
// id is the CDP targetId — pass it to screenshot.mjs / find-cards-webview.mjs / click-button.mjs.
import { listWindows } from "./lib.mjs";

const windows = await listWindows();
console.log(JSON.stringify(windows, null, 2));

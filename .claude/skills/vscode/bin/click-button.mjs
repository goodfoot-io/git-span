#!/usr/bin/env node
// Usage: node click-button.mjs <targetId> <icon> [cardId] [timeoutMs]
// Finds a Cards webview's leaf frame, then finds a <vscode-button> whose `icon`
// JS property equals <icon> (CSS attribute selectors don't match — @vscode-elements
// sets icon/title as JS properties, not reflected HTML attributes) and clicks it.
// Polls because buttons often mount after an async fetch. Prints { clicked: true/false }.
// Pass [cardId] to target a specific card's detail panel instead of the list/create
// panel (default) — see find-cards-webview.mjs for why cardId picks which webview.
//
// For read-only inspection, use find-cards-webview.mjs/find-buttons.mjs instead —
// this script performs a real click, which can mutate state (e.g. delete/archive/
// submit buttons). Run find-buttons.mjs first to confirm the icon you're passing
// belongs to a safe, navigation-style button.
import { connect, getPageByTargetId, findCardsWebviewFrame } from "./lib.mjs";

const [targetId, icon, cardIdArg, timeoutMsArg] = process.argv.slice(2);
if (!targetId || !icon) {
  console.error("Usage: node click-button.mjs <targetId> <icon> [cardId] [timeoutMs]");
  process.exit(1);
}
const cardId = !cardIdArg || cardIdArg === "null" ? null : cardIdArg;
const timeoutMs = timeoutMsArg ? Number(timeoutMsArg) : 5000;

const browser = await connect();
try {
  const page = await getPageByTargetId(browser, targetId);
  const frame = await findCardsWebviewFrame(page, { timeoutMs, cardId });
  if (!frame) {
    console.log(JSON.stringify({ clicked: false, reason: "no webview frame found" }));
    process.exit(0);
  }

  const deadline = Date.now() + timeoutMs;
  let clicked = false;
  while (Date.now() < deadline && !clicked) {
    clicked = await frame.evaluate((target) => {
      const btn = Array.from(document.querySelectorAll("vscode-button")).find(
        (el) => el.icon === target,
      );
      if (!btn) return false;
      btn.click();
      return true;
    }, icon);
    if (!clicked) await new Promise((r) => setTimeout(r, 200));
  }
  console.log(JSON.stringify({ clicked }));
} finally {
  await browser.disconnect();
}

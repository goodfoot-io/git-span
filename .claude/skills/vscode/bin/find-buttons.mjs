#!/usr/bin/env node
// Usage: node find-buttons.mjs <targetId> [cardId] [timeoutMs]
// Discovers clickable elements inside a Cards webview so you know what `icon`
// value to pass to click-button.mjs before clicking anything blind.
// Prints JSON: { buttons: [...], options: [...] }
// Covers <vscode-button> (icon/title as JS properties) and role="option"/role="button"
// elements (e.g. card list items, which use [data-card-id] instead of icon).
// Pass [cardId] to inspect a specific card's detail panel instead of the list/create
// panel (default) — see find-cards-webview.mjs for why cardId is how you pick which
// webview, since several can be mounted at once.
import { connect, getPageByTargetId, findCardsWebviewFrame } from "./lib.mjs";

const [targetId, cardIdArg, timeoutMsArg] = process.argv.slice(2);
if (!targetId) {
  console.error("Usage: node find-buttons.mjs <targetId> [cardId] [timeoutMs]");
  process.exit(1);
}
const cardId = !cardIdArg || cardIdArg === "null" ? null : cardIdArg;
const timeoutMs = timeoutMsArg ? Number(timeoutMsArg) : 5000;

const browser = await connect();
try {
  const page = await getPageByTargetId(browser, targetId);
  const frame = await findCardsWebviewFrame(page, { timeoutMs, cardId });
  if (!frame) {
    console.log(JSON.stringify({ found: false }));
    process.exit(0);
  }
  const elements = await frame.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("vscode-button")).map((el) => ({
      tag: "vscode-button",
      icon: el.icon ?? null,
      title: el.title ?? null,
      ariaLabel: el.getAttribute("aria-label"),
      text: el.textContent?.trim().slice(0, 60) ?? null,
    }));
    const options = Array.from(document.querySelectorAll('[role="option"], [role="button"]')).map(
      (el) => ({
        tag: el.tagName.toLowerCase(),
        icon: null,
        cardId: el.getAttribute("data-card-id"),
        ariaLabel: el.getAttribute("aria-label"),
        text: el.textContent?.trim().slice(0, 60) ?? null,
      }),
    );
    return { buttons, options };
  });
  console.log(JSON.stringify(elements, null, 2));
} finally {
  await browser.disconnect();
}

#!/usr/bin/env node
// Usage: node find-cards-webview.mjs <targetId> [cardId] [timeoutMs]
// Polls for a Cards webview leaf frame and prints its state as JSON:
//   { found: true, cardId, baseUrl, hasRoot, title, bodyText }
// Pass [cardId] to find a specific card's detail panel; omit it (or pass the literal
// string "null") to find the list/create panel. VSCode keeps previously-opened detail
// panels mounted as background tabs, so several Cards webviews can coexist — matching
// on cardId is what picks the right one, not "whichever frame is found first".
// title "Cards" = list, "Create Card" = create; archive/worktrees views also show
// cardId=null and title "Cards" — indistinguishable from list by state alone, compare
// bodyText across calls, or trust the command you ran to get there.
// Does not print __INIT_DATA__.accessToken (live credential for the webview's local API).
import { connect, getPageByTargetId, findCardsWebviewFrame, readPanelState } from "./lib.mjs";

const [targetId, cardIdArg, timeoutMsArg] = process.argv.slice(2);
if (!targetId) {
  console.error("Usage: node find-cards-webview.mjs <targetId> [cardId] [timeoutMs]");
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
  const state = await readPanelState(frame);
  console.log(JSON.stringify({ found: true, ...state }, null, 2));
} finally {
  await browser.disconnect();
}

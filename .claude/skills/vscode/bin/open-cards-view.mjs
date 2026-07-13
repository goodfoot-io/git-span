#!/usr/bin/env node
// Usage: node open-cards-view.mjs <targetId> <commandId> [cliArgsJSON] [expectCardId] [timeoutMs]
// Runs a cards-extension CLI command to navigate the Cards UI, then polls for the
// resulting webview and prints its state — the two-step "run command, then confirm
// it rendered" sequence nearly every Cards navigation needs.
//
// cliArgsJSON: JSON array piped to `execute-command` as stdin (default "[]").
// expectCardId: cardId to poll findCardsWebviewFrame for (default null = list/create
//   panel). Pass the target card's id when commandId navigates to its detail panel.
//
// Examples:
//   node open-cards-view.mjs <targetId> workbench.view.extension.cards-panel
//   node open-cards-view.mjs <targetId> cards.openCard '["main-368"]' main-368
//   node open-cards-view.mjs <targetId> cards.backToCardsList
//   node open-cards-view.mjs <targetId> cards.viewArchive
//
// archive/worktrees/list all resolve to cardId=null and are otherwise indistinguishable
// by webview state — this script confirms *a* Cards webview rendered with the cardId
// you expected, not which specific sub-view. Compare `bodyText` across two calls if you
// need to confirm the sub-view actually changed.
import { execSync } from "node:child_process";
import { connect, getPageByTargetId, findCardsWebviewFrame, readPanelState } from "./lib.mjs";

const [targetId, commandId, cliArgsJSON, expectCardIdArg, timeoutMsArg] = process.argv.slice(2);
if (!targetId || !commandId) {
  console.error(
    "Usage: node open-cards-view.mjs <targetId> <commandId> [cliArgsJSON] [expectCardId] [timeoutMs]",
  );
  process.exit(1);
}
const cliArgs = !cliArgsJSON || cliArgsJSON === "null" ? "[]" : cliArgsJSON;
const cardId = !expectCardIdArg || expectCardIdArg === "null" ? null : expectCardIdArg;
const timeoutMs = timeoutMsArg ? Number(timeoutMsArg) : 5000;

execSync(`echo '${cliArgs.replace(/'/g, "'\\''")}' | cards-extension execute-command ${commandId} --workspace /workspace`, {
  stdio: ["ignore", "ignore", "ignore"], // suppress the benign lossyCoercion warning on stderr
});

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

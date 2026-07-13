#!/usr/bin/env node
// Usage: node screenshot.mjs <targetId> <outPath>
// targetId comes from list-windows.mjs. outPath should be an absolute path
// (e.g. under the session scratchpad) — never save into /workspace.
import { connect, getPageByTargetId } from "./lib.mjs";

const [targetId, outPath] = process.argv.slice(2);
if (!targetId || !outPath) {
  console.error("Usage: node screenshot.mjs <targetId> <outPath>");
  process.exit(1);
}

const browser = await connect();
try {
  const page = await getPageByTargetId(browser, targetId);
  await page.screenshot({ path: outPath, captureBeyondViewport: false });
  console.log(JSON.stringify({ saved: outPath }));
} finally {
  await browser.disconnect(); // NOT close() — keeps VSCode running
}

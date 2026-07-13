#!/usr/bin/env node
// Usage: node resize-window.mjs <targetId> <width> <height>
import { connect, getPageByTargetId } from "./lib.mjs";

const [targetId, widthStr, heightStr] = process.argv.slice(2);
const width = Number(widthStr);
const height = Number(heightStr);
if (!targetId || !width || !height) {
  console.error("Usage: node resize-window.mjs <targetId> <width> <height>");
  process.exit(1);
}

const browser = await connect();
try {
  const page = await getPageByTargetId(browser, targetId);
  const result = await page.evaluate(
    (w, h) => {
      window.resizeTo(w, h);
      return { outerWidth: window.outerWidth, outerHeight: window.outerHeight };
    },
    width,
    height,
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.disconnect(); // NOT close() — keeps VSCode running
}

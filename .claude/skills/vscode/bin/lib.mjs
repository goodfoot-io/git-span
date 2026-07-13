import http from "node:http";
import puppeteer from "puppeteer-core";

export const CDP_HOST = process.env.CDP_HOST || "vscode.heron-stork.ts.net";
export const CDP_PORT = process.env.CDP_PORT || "9222";

// Node's core http module allows overriding the Host header; fetch/undici does not
// (it silently drops it, which makes CDP's DNS-rebinding check reject the request).
function cdpGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: CDP_HOST, port: CDP_PORT, path, headers: { Host: "localhost" } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`CDP ${path} returned non-JSON: ${data.slice(0, 200)}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

export async function listWindows() {
  const targets = await cdpGet("/json/list");
  return targets
    .filter((t) => t.type === "page")
    .map((t) => ({ id: t.id, title: t.title }));
}

export async function connect() {
  const version = await cdpGet("/json/version");
  const browserWSEndpoint = version.webSocketDebuggerUrl.replace(
    "ws://localhost",
    `ws://${CDP_HOST}:${CDP_PORT}`,
  );
  return puppeteer.connect({
    browserWSEndpoint,
    headers: { Host: "localhost" },
    defaultViewport: null,
  });
}

export async function getPageByTargetId(browser, targetId) {
  for (const page of await browser.pages()) {
    const session = await page.createCDPSession();
    const { targetInfo } = await session.send("Target.getTargetInfo");
    await session.detach();
    if (targetInfo.targetId === targetId) return page;
  }
  throw new Error(`No page found with targetId ${targetId}. Run list-windows.mjs to see open targets.`);
}

export async function readPanelState(frame) {
  return frame.evaluate(() => ({
    cardId: window.__INIT_DATA__?.cardId ?? null,
    baseUrl: window.__INIT_DATA__?.baseUrl ?? null,
    hasRoot: !!document.getElementById("root"),
    title: document.title,
    bodyText: document.body.innerText.slice(0, 300),
  }));
}

// Cards renders each panel as a double-nested iframe: outer iframe.webview (in the
// workbench DOM) wrapping an inner bare iframe with the actual app. Both frames' URLs
// contain "vscode-webview" — childFrames().length === 0 (leaf) is what disambiguates
// the inner one.
//
// VSCode keeps a webview mounted (as a background editor tab) even after navigating
// away from it, so once more than one card has ever been opened, several leaf
// `vscode-webview` frames can coexist simultaneously — "the first one found" is not
// reliably "the one you just opened". Match on `cardId` instead: pass the target
// card's id to find its detail panel, or leave it `null` (default) for the list/create
// panel. The frame may not exist yet right after execute-command, so poll.
export async function findCardsWebviewFrame(page, { timeoutMs = 5000, intervalMs = 200, cardId = null } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const leaves = page
      .frames()
      .filter((f) => f.url().includes("vscode-webview") && f.childFrames().length === 0);
    for (const frame of leaves) {
      const state = await readPanelState(frame).catch(() => null);
      if (state && state.cardId === cardId) return frame;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

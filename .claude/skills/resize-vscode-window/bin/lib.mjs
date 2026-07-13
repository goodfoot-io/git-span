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

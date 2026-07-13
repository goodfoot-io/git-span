# Extension host (9333)

Node inspector for the extension/plugin-host process — NOT a CDP browser target. Use a raw `ws` connection with `Runtime.*`/`Profiler.*`/`HeapProfiler.*`, never `puppeteer.connect()`.

Same `Host: localhost` header requirement as 9222 (see main SKILL.md), for both the `/json` HTTP request and the WebSocket handshake.

## Connect

```js
import { createRequire } from "node:module";
const WebSocket = createRequire("/workspace/")("ws");

const [target] = await fetch("http://vscode.heron-stork.ts.net:9333/json", {
  headers: { Host: "localhost" },
}).then((r) => r.json());

const ws = new WebSocket(
  target.webSocketDebuggerUrl.replace("ws://localhost", "ws://vscode.heron-stork.ts.net:9333"),
  { headers: { Host: "localhost" } },
);

let id = 0;
const pending = new Map();
const send = (method, params) =>
  new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
ws.on("message", (d) => {
  const m = JSON.parse(d);
  if (pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
});
await new Promise((res) => ws.once("open", res));

await send("Runtime.enable");
const r = await send("Runtime.evaluate", { expression: "process.title" });
```

`/json` on 9333 may list multiple Node targets (helper processes, utility processes) — check `title`/`Runtime.evaluate("process.argv")` to identify the right one before profiling.

## CPU/heap profiling

```js
await send("Profiler.enable");
await send("Profiler.setSamplingInterval", { interval: 100 }); // microseconds
await send("Profiler.start");
await new Promise((r) => setTimeout(r, 60_000));
const { profile } = await send("Profiler.stop");
require("node:fs").writeFileSync(`/tmp/profile-${Date.now()}.cpuprofile`, JSON.stringify(profile));
```

Open `.cpuprofile` in VSCode's built-in viewer. For heap: `HeapProfiler.takeHeapSnapshot` (streams via `HeapProfiler.addHeapSnapshotChunk`) or `HeapProfiler.startSampling`/`stopSampling`.

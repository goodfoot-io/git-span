import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Boots the *built* Worker for the gate suites: `vite preview --strictPort`
// runs the `@cloudflare/vite-plugin` serve flow, which serves the production
// build through real workerd — full Accept negotiation, `.md` alternates,
// and Link headers included — not a static file preview. Confirmed against
// this repo's build in `notes/spike-boot-mechanism.md`: despite loading
// `wrangler.dev.toml`, served `sitemap.xml` and other canonical-URL output
// already resolve to `https://git-span.com`, so no `SITE_URL` override or
// `wrangler dev` fallback is needed.
const PORT = 4310;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_INTERVAL_MS = 200;

// Vitest's `globalSetup` runs once in the main process, before test files
// are dispatched to their own worker/fork processes — module-scope state set
// here is invisible to the test files. A small JSON file under a gate-scoped
// temp directory is the simplest thing that crosses that process boundary.
const SERVER_INFO_DIR = path.join(tmpdir(), 'git-span-website-gate');
const SERVER_INFO_PATH = path.join(SERVER_INFO_DIR, 'server.json');

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..');

export interface GateServerInfo {
  baseUrl: string;
  port: number;
}

/** Read by gate test files to discover the booted Worker's base URL. */
export function readGateServerInfo(): GateServerInfo {
  return JSON.parse(readFileSync(SERVER_INFO_PATH, 'utf8')) as GateServerInfo;
}

function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return (async function poll(): Promise<void> {
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(url);
        // Any response at all — even a 4xx/5xx from the app — proves the
        // Worker is up and answering; readiness isn't about page content.
        if (response.status < 600) return;
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
    }
    throw new Error(
      `gate globalSetup: built Worker at ${url} did not become ready within ${timeoutMs}ms: ${String(lastError)}`
    );
  })();
}

/**
 * Proves the port is ours to take by binding it ourselves. An HTTP probe
 * cannot do this job: it accepts *any* responder, so a stale, foreign, or
 * concurrent server on 4310 reads as "ready" and the whole gate then audits
 * content it never built. Binding fails closed instead.
 */
function assertPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', (error: NodeJS.ErrnoException) => {
      reject(
        new Error(
          `gate globalSetup: port ${port} is already in use (${error.code ?? error.message}). ` +
            `The gate must own this port to be sure it audits the site it just built. ` +
            `Find the holder with \`lsof -i :${port}\` and stop it, then re-run.`
        )
      );
    });
    probe.once('listening', () => {
      probe.close(() => resolve());
    });
    probe.listen(port, '127.0.0.1');
  });
}

export default async function setup(): Promise<() => Promise<void>> {
  mkdirSync(SERVER_INFO_DIR, { recursive: true });

  await assertPortFree(PORT);

  // `detached: true` makes this process the leader of a new process group,
  // so teardown can kill the whole group in one signal — `vite preview`'s own
  // workerd child processes included — instead of leaking children that
  // outlive the parent PID (the `f23ae27` / `5edf56b` lesson).
  const child: ChildProcess = spawn('yarn', ['exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: PACKAGE_ROOT,
    stdio: 'inherit',
    detached: true
  });

  const exitedEarly = new Promise<never>((_resolve, reject) => {
    child.once('exit', (code, signal) => {
      reject(new Error(`gate globalSetup: vite preview exited early (code ${code}, signal ${signal})`));
    });
    child.once('error', reject);
  });
  // Prevent an unhandled-rejection warning when this promise loses the race
  // below (the common case: readiness wins, and the listeners above still
  // fire later when the server is torn down).
  exitedEarly.catch(() => {});

  try {
    await Promise.race([waitForReady(`${BASE_URL}/`, READY_TIMEOUT_MS), exitedEarly]);
  } catch (error) {
    killProcessGroup(child);
    throw error;
  }

  const info: GateServerInfo = { baseUrl: BASE_URL, port: PORT };
  writeFileSync(SERVER_INFO_PATH, JSON.stringify(info), 'utf8');

  return async () => {
    rmSync(SERVER_INFO_PATH, { force: true });
    killProcessGroup(child);
  };
}

function killProcessGroup(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    // Already exited — nothing to clean up.
  }
}

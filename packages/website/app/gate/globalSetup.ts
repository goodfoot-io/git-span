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
// One bounded retry of the whole boot sequence, paused just long enough for a
// previous run's server to finish releasing port 4310.
const RETRY_DELAY_MS = 1_000;

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

/**
 * Marks a boot failure the caller may retry once: the port was busy at probe
 * time, or the server never answered. Both are the signature of a previous
 * run's server still winding down. A child that *exited* is never wrapped in
 * this — that is a real crash and must surface on the first attempt.
 */
class TransientBootError extends Error {}

function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return (async function poll(): Promise<void> {
    // Why not "any response proves it's up": a Worker that boots and then 5xxs
    // on every request would read as ready, and the suite would then bury one
    // boot fault under dozens of individually-failing page assertions. A
    // sub-500 response proves the Worker is both up *and* serving.
    let lastOutcome = 'no response yet';
    while (Date.now() < deadline) {
      try {
        const response = await fetch(url);
        if (response.status < 500) return;
        lastOutcome = `answered ${response.status} ${response.statusText}`;
      } catch (error) {
        // Connection refused while the server is still binding is the normal
        // startup path — keep polling until the deadline.
        lastOutcome = String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
    }
    throw new TransientBootError(
      `gate globalSetup: built Worker at ${url} did not become ready within ${timeoutMs}ms ` +
        `(last outcome: ${lastOutcome}).`
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
        new TransientBootError(
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

/** One acquire-and-spawn attempt: claim the port, boot the Worker, wait for it. */
async function bootServer(): Promise<ChildProcess> {
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
      reject(
        new Error(
          `gate globalSetup: the \`vite preview\` child process exited before serving anything ` +
            `(exit code ${code === null ? 'none' : code}, signal ${signal ?? 'none'}). ` +
            `Its output above is the diagnosis — the gate did not time out waiting, the server died. ` +
            `A \`--strictPort\` bind failure on ${PORT} looks like this.`
        )
      );
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
    // Two very different faults reach this point and used to read identically.
    // Which one it was is knowable here and nowhere else: `exitedEarly` losing
    // the race means the child is still running, so the budget — not the
    // server — is what ran out. Say so, rather than leaving the reader to
    // guess whether the process died.
    if (error instanceof TransientBootError && child.exitCode === null && child.signalCode === null) {
      throw new TransientBootError(
        `${error.message} The \`vite preview\` child process (pid ${child.pid ?? 'unknown'}) was still ` +
          `running when the budget expired — it is slow to boot or wedged, not dead. A machine under ` +
          `concurrent load (another build, test run, or gate leg) is the usual cause.`
      );
    }
    throw error;
  }

  return child;
}

export default async function setup(): Promise<() => Promise<void>> {
  mkdirSync(SERVER_INFO_DIR, { recursive: true });

  let child: ChildProcess;
  try {
    child = await bootServer();
  } catch (error) {
    // Retry once, and only for the two transient shapes: the port was still
    // held at probe time, or the server never answered. The overwhelmingly
    // likely cause is a *previous* gate run's server still releasing port
    // 4310 on a fast back-to-back re-run. A child that exited is a real
    // failure and is rethrown on the first attempt, never retried into a
    // second, more confusing one. A port genuinely held for the whole run
    // still fails closed — the second attempt just fails the same way.
    if (!(error instanceof TransientBootError)) throw reportSetupFailure(error);
    console.error(`${String(error)}\n  Retrying the boot sequence once — this is usually a port still being released.`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    try {
      child = await bootServer();
    } catch (retryError) {
      throw reportSetupFailure(retryError);
    }
  }

  const info: GateServerInfo = { baseUrl: BASE_URL, port: PORT };
  writeFileSync(SERVER_INFO_PATH, JSON.stringify(info), 'utf8');

  return async () => {
    rmSync(SERVER_INFO_PATH, { force: true });
    killProcessGroup(child);
  };
}

/**
 * Vitest reports a `globalSetup` throw by dispatching zero test files and
 * headlining "No test files found, exiting with code 1", printing the actual
 * cause below as an unhandled error. That framing sends a developer to edit
 * the config globs — the wrong file entirely. Printing the cause here, at the
 * moment of failure, puts the real diagnosis on screen first.
 */
function reportSetupFailure(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `\n=== GATE BOOT FAILED — the gate never started, so no test file ran ===\n` +
      `${message}\n` +
      `=== Any "No test files found" line below is a consequence of this, not a config problem ===\n`
  );
  return error;
}

function killProcessGroup(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    // Already exited — nothing to clean up.
  }
}

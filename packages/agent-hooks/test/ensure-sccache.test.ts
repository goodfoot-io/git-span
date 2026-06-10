/**
 * Tests for scripts/ensure-sccache.sh — the build preflight that guarantees a
 * reachable sccache server before Rust compilation.
 *
 * The bug (card main-96): a stale / version-mismatched sccache server left
 * holding the server socket makes every client handshake fail with an opaque
 * "Failed to read response header / failed to fill whole buffer" transport
 * error, which Cargo surfaces as a compile failure. A truly-absent server
 * auto-recovers (any sccache client command spawns one), so the failure mode
 * that needs a fix is specifically a *present-but-wedged* server occupying the
 * port.
 *
 * Each test runs against an ISOLATED sccache instance — a private SCCACHE_DIR
 * and a per-run free TCP port — so it never touches the shared production
 * server that concurrent worktrees compile against. The wedged server is
 * simulated by a separate child process that accepts the connection and writes
 * a few junk bytes, reproducing the exact handshake failure deterministically.
 */

import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { type AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8'
}).trim();
const helper = join(repoRoot, 'scripts', 'ensure-sccache.sh');

/** sccache must be installed for these tests to mean anything (skip on CI). */
function hasSccache(): boolean {
  try {
    execFileSync('sccache', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Reserve an ephemeral port the isolated sccache server can bind. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** True when an sccache server answers `--show-stats` for this env. */
function serverReachable(env: NodeJS.ProcessEnv): boolean {
  try {
    execFileSync('sccache', ['--show-stats'], { env, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Run the preflight helper; returns its exit code (0 on success). */
function runHelper(env: NodeJS.ProcessEnv): number {
  try {
    execFileSync('bash', [helper], { env, stdio: 'pipe' });
    return 0;
  } catch (err) {
    return (err as { status?: number }).status ?? 1;
  }
}

/**
 * Spawn a separate process that squats `port` and corrupts the sccache
 * handshake — stands in for a stale / mismatched server holding the socket.
 */
function spawnWedgedServer(port: number): Promise<ChildProcess> {
  const code =
    'const net=require("net");' +
    `net.createServer(s=>{s.end(Buffer.from([1,2,3,4]));}).listen(${port},"127.0.0.1",()=>{process.stdout.write("READY");});`;
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'ignore'] });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.stdout.on('data', (b: Buffer) => {
      if (b.toString().includes('READY')) resolve(child);
    });
  });
}

describe.skipIf(!hasSccache())('ensure-sccache.sh', () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;
  let wedged: ChildProcess | undefined;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sccache-ensure-'));
    const port = await freePort();
    env = {
      ...process.env,
      SCCACHE_DIR: join(dir, 'cache'),
      SCCACHE_SERVER_PORT: String(port)
    };
  });

  afterEach(() => {
    if (wedged && wedged.exitCode === null) wedged.kill('SIGKILL');
    wedged = undefined;
    try {
      execFileSync('sccache', ['--stop-server'], { env, stdio: 'ignore' });
    } catch (err) {
      void err; // best-effort teardown of the isolated server
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('reproduces the wedged-server handshake failure, then recovers it', async () => {
    wedged = await spawnWedgedServer(Number(env.SCCACHE_SERVER_PORT));

    // Bug symptom: a present-but-wedged server makes the client fail.
    expect(serverReachable(env)).toBe(false);

    expect(runHelper(env)).toBe(0);

    // Recovery: the helper reclaimed the port and started a clean server.
    expect(serverReachable(env)).toBe(true);
  });

  it('is a no-op when the server is already healthy', async () => {
    // With SCCACHE_SERVER_PORT set to a TCP port, the sccache client
    // does not auto-start a server (auto-start only works for UDS
    // connections). Start one explicitly so the preflight can verify
    // it no-ops against a reachable server.
    const server = spawn('sccache', [], {
      env: { ...env, SCCACHE_START_SERVER: '1' },
      stdio: 'ignore',
      detached: true
    });
    server.unref();
    await new Promise((r) => setTimeout(r, 500));
    expect(serverReachable(env)).toBe(true);
    expect(runHelper(env)).toBe(0);
    expect(serverReachable(env)).toBe(true);
  });

  it('is idempotent across repeated runs', () => {
    expect(runHelper(env)).toBe(0);
    expect(runHelper(env)).toBe(0);
    expect(serverReachable(env)).toBe(true);
  });
});

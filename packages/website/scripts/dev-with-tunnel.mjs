#!/usr/bin/env node

/**
 * Dev server with optional Cloudflare Tunnel support.
 *
 * Starts `react-router dev` on `localhost:5173`. When
 * `CLOUDFLARE_TUNNEL_TOKEN_LOCAL` is set (in the environment, or in the
 * repo-root `.env`), also runs a `cloudflared` tunnel to expose the dev
 * server at a public URL.
 *
 * Usage:
 *   node scripts/dev-with-tunnel.mjs        # start
 *   node scripts/dev-with-tunnel.mjs stop   # stop
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { env } from 'node:process';
import { fileURLToPath } from 'node:url';

const PID_FILE = '/tmp/git-span-website-dev.pid';
const LOG_PREFIX = '[git-span-website]';
const VITE_PORT = 5173;

const TUNNEL_HEALTH_INTERVAL_MS = 30_000;
const TUNNEL_HEALTH_FETCH_TIMEOUT_MS = 8_000;
const TUNNEL_HEALTH_FAIL_THRESHOLD = 3;
const TUNNEL_BACKOFF_MIN_MS = 2_000;
const TUNNEL_BACKOFF_MAX_MS = 60_000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = path.resolve(__dirname, '..', '.source');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const ENV_FILE = path.join(REPO_ROOT, '.env');

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in env)) env[key] = value;
  }
}

let shuttingDown = false;
let restartAttempt = 0;
let consecutiveHealthFails = 0;
let restartTimer = null;
let healthInterval = null;

function log(...args) {
  console.log(LOG_PREFIX, ...args);
}

function err(...args) {
  console.error(LOG_PREFIX, ...args);
}

function readPid() {
  try {
    return parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
  } catch {
    return null;
  }
}

function writePid(pid) {
  writeFileSync(PID_FILE, String(pid));
}

function removePid() {
  try {
    unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
}

function stop() {
  const pid = readPid();
  if (!pid) {
    log('No PID file found at', PID_FILE);
    return;
  }

  log('Stopping process group', pid);
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // process already gone
    }
  }

  removePid();
  log('Stopped');
}

const isStop = process.argv.includes('stop');

if (isStop) {
  stop();
  process.exit(0);
}

// If there's an existing PID file, stop first
const existingPid = readPid();
if (existingPid) {
  log('Existing dev process found (PID', existingPid + '). Stopping first.');
  stop();
  // Give it time to release ports
  await new Promise((r) => setTimeout(r, 1000));
}

// Check for tunnel token
loadEnvFile(ENV_FILE);
const tunnelToken = env['CLOUDFLARE_TUNNEL_TOKEN_LOCAL'];
if (!tunnelToken) {
  log('CLOUDFLARE_TUNNEL_TOKEN_LOCAL not set -- skipping tunnel, serving on localhost only');
}

// Ensure .source/ exists before starting vite (fumadocs-mdx generates it)
if (!existsSync(SOURCE_DIR)) {
  log('.source/ directory not found; running fumadocs:generate...');
  const generate = spawn('yarn', ['run', 'fumadocs:generate'], {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
  });
  await new Promise((resolve, reject) => {
    generate.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`fumadocs:generate exited with code ${code}`))
    );
  });
}

// Spawn vite dev server
const vite = spawn('yarn', ['run', 'dev:vite'], {
  stdio: 'inherit',
  env: { ...env, FORCE_COLOR: '1' },
  detached: true
});

const children = [vite];

// Tunnel health check and respawn helpers
function scheduleTunnelRestart() {
  if (shuttingDown) return;
  const delay = Math.min(
    TUNNEL_BACKOFF_MIN_MS * Math.pow(2, restartAttempt),
    TUNNEL_BACKOFF_MAX_MS
  );
  restartAttempt++;
  log(`Scheduling tunnel restart in ${delay}ms (attempt ${restartAttempt})`);
  restartTimer = setTimeout(() => {
    if (shuttingDown) return;
    spawnTunnel();
  }, delay);
}

async function checkTunnelHealth() {
  if (shuttingDown || !tunnelToken) return;
  try {
    await fetch('https://local.git-span.com/', {
      signal: AbortSignal.timeout(TUNNEL_HEALTH_FETCH_TIMEOUT_MS),
      redirect: 'manual',
    });
    // Any HTTP response means the tunnel is forwarding
    consecutiveHealthFails = 0;
    restartAttempt = 0;
  } catch (err) {
    consecutiveHealthFails++;
    log(`Tunnel health check failed (${consecutiveHealthFails}/${TUNNEL_HEALTH_FAIL_THRESHOLD}):`, err.message);
    if (consecutiveHealthFails >= TUNNEL_HEALTH_FAIL_THRESHOLD && tunnel) {
      log('Tunnel health check threshold reached; killing tunnel for restart...');
      tunnel.kill('SIGTERM');
      // Respawning happens in the exit handler
    }
  }
}

// Spawn cloudflared tunnel if token is available
let tunnel = null;

function spawnTunnel() {
  if (shuttingDown) return;
  tunnel = spawn('cloudflared', ['tunnel', 'run', '--token', tunnelToken], {
    stdio: 'inherit',
    detached: true,
  });
  children.push(tunnel);

  tunnel.on('exit', (code) => {
    log('cloudflared tunnel exited with code', code);
    if (!shuttingDown) {
      scheduleTunnelRestart();
    }
  });

  tunnel.on('error', (errMsg) => {
    err('cloudflared tunnel error:', errMsg.message);
    err('Is cloudflared installed? See https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
    if (!shuttingDown) {
      scheduleTunnelRestart();
    }
  });
}

if (tunnelToken) {
  spawnTunnel();
  healthInterval = setInterval(checkTunnelHealth, TUNNEL_HEALTH_INTERVAL_MS);
}

const pgid = vite.pid;
writePid(pgid);
log('Dev server started (PID', pgid + '). Vite running on http://localhost:' + VITE_PORT);

// Graceful shutdown handler
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log('Shutting down...');
  if (restartTimer) clearTimeout(restartTimer);
  if (healthInterval) clearInterval(healthInterval);
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
  removePid();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// If Vite exits unexpectedly, shut down everything
vite.on('exit', (code) => {
  if (code !== 0) {
    err('vite exited unexpectedly with code', code);
  }
  shutdown();
});

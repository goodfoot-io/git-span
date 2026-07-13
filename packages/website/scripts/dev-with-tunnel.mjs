#!/usr/bin/env node

/**
 * Dev server with optional Cloudflare Tunnel support.
 *
 * Starts `react-router dev` on `localhost:5173`. When
 * `CLOUDFLARE_TUNNEL_TOKEN_LOCAL` is set in the environment, also runs a
 * `cloudflared` tunnel to expose the dev server at a public URL.
 *
 * Usage:
 *   node scripts/dev-with-tunnel.mjs        # start
 *   node scripts/dev-with-tunnel.mjs stop   # stop
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { env } from 'node:process';

const PID_FILE = '/tmp/git-span-website-dev.pid';
const LOG_PREFIX = '[git-span-website]';
const VITE_PORT = 5173;

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
const tunnelToken = env['CLOUDFLARE_TUNNEL_TOKEN_LOCAL'];
if (!tunnelToken) {
  log('CLOUDFLARE_TUNNEL_TOKEN_LOCAL not set -- skipping tunnel, serving on localhost only');
}

// Spawn vite dev server
const vite = spawn('yarn', ['run', 'dev:vite'], {
  stdio: 'inherit',
  env: { ...env, FORCE_COLOR: '1' },
  detached: true
});

const children = [vite];

// Spawn cloudflared tunnel if token is available
let tunnel = null;
if (tunnelToken) {
  tunnel = spawn(
    'cloudflared',
    ['tunnel', 'run', '--token', tunnelToken],
    {
      stdio: 'inherit',
      detached: true
    }
  );
  children.push(tunnel);

  tunnel.on('exit', (code) => {
    log('cloudflared tunnel exited with code', code);
    log('Tunnel will be respawned automatically');
  });

  tunnel.on('error', (errMsg) => {
    err('cloudflared tunnel error:', errMsg.message);
    err('Is cloudflared installed? See https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
  });
}

const pgid = vite.pid;
writePid(pgid);
log('Dev server started (PID', pgid + '). Vite running on http://localhost:' + VITE_PORT);

// Graceful shutdown handler
function shutdown() {
  log('Shutting down...');
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

import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { acquireReceiptClaim } from '../../src/common/commit-storage.js';
import { acquireNativeReceiptLock } from '../../src/common/receipt-lock.js';
import { buildWorkspaceGitSpan } from '../real-bundle-helpers.js';

const roots: string[] = [];
const children: ChildProcess[] = [];
let binary: string;
beforeAll(() => {
  binary = buildWorkspaceGitSpan().binary;
}, 600_000);
afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scratch(): { root: string; claims: string } {
  const root = mkdtempSync(join(tmpdir(), 'commit-storage-recovery-'));
  roots.push(root);
  const claims = join(root, 'claims');
  mkdirSync(claims, { mode: 0o700 });
  return { root, claims };
}

function nativeProcess(directory: string, key = 'capacity', waitMs = 1000) {
  const child = spawn(binary, ['__receipt-lock', '--directory', directory, '--key', key, '--wait-ms', String(waitMs)], {
    cwd: directory,
    stdio: 'pipe'
  });
  children.push(child);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  const ready = async () => {
    await vi.waitFor(() => expect(stdout).toBe('locked\n'));
  };
  return { child, closed, ready, output: () => ({ stdout, stderr }) };
}

describe('receipt storage crash recovery', () => {
  it('recovers the claim after its owner dies leaving an empty serialization guard', async () => {
    const { root, claims } = scratch();

    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {
      encoding: 'utf8'
    });
    expect(child.status).toBe(0);
    const deadPid = Number(child.stdout);
    expect(Number.isSafeInteger(deadPid)).toBe(true);
    expect(() => process.kill(deadPid, 0)).toThrowError(expect.objectContaining({ code: 'ESRCH' }));

    mkdirSync(join(claims, 'invocation-dead.guard'), { mode: 0o700 });
    writeFileSync(join(claims, 'invocation-dead.json'), JSON.stringify({ token: 'abandoned-owner', pid: deadPid }), {
      mode: 0o600
    });

    for (let attempt = 0; attempt < 2; attempt++) {
      const claim = await acquireReceiptClaim(root, 'invocation-dead', performance.now() + 1000, binary);
      expect(claim).not.toBeNull();
      await claim?.release();
    }
    expect(existsSync(join(claims, 'invocation-dead.guard'))).toBe(true);
  });

  it('allows nested association work while an invocation stripe is held', async () => {
    const { root, claims } = scratch();
    const invocation = await acquireReceiptClaim(root, 'invocation-first', performance.now() + 2000, binary);
    expect(invocation).not.toBeNull();
    try {
      const distinct = await acquireReceiptClaim(root, 'invocation-0', performance.now() + 2000, binary);
      expect(distinct).not.toBeNull();
      await distinct?.release();
      // These two fixed identities share the native FNV-1a stripe 96.
      const colliding = nativeProcess(claims, 'invocation-507', 100);
      expect(await colliding.closed).toBe(1);
      expect(colliding.output().stderr).toContain('deadline exhausted');
      const association = await acquireReceiptClaim(root, 'association-first', performance.now() + 2000, binary);
      expect(association).not.toBeNull();
      try {
        expect(association).not.toBeNull();
      } finally {
        await association?.release();
      }
    } finally {
      await invocation?.release();
    }
    const later = await acquireReceiptClaim(root, 'invocation-507', performance.now() + 2000, binary);
    expect(later).not.toBeNull();
    await later?.release();
  });

  it.each(['alive', 'uncertain'] as const)('does not steal %s primary ownership', async (liveness) => {
    const { root, claims } = scratch();
    const owner = { token: 'existing-owner', pid: process.pid };
    const path = join(claims, 'capacity.json');
    writeFileSync(path, JSON.stringify(owner), { mode: 0o600 });
    if (liveness === 'uncertain')
      vi.spyOn(process, 'kill').mockImplementation(() => {
        throw Object.assign(new Error('not permitted'), { code: 'EPERM' });
      });
    const claim = await acquireReceiptClaim(root, 'capacity', performance.now() + 100, binary).catch(
      (error: unknown) => {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(/deadline exhausted/);
        return null;
      }
    );
    expect(claim).toBeNull();
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(owner);
  });

  it('refuses malformed ownership', async () => {
    const { root, claims } = scratch();
    writeFileSync(join(claims, 'invocation-bad.json'), '{}', { mode: 0o600 });
    expect(await acquireReceiptClaim(root, 'invocation-bad', performance.now() + 1000, binary)).toBeNull();
  });

  it('refuses an unavailable lock executable', async () => {
    const { root } = scratch();
    await expect(
      acquireReceiptClaim(root, 'invocation-any', performance.now() + 1000, join(root, 'missing-executable'))
    ).rejects.toThrow('receipt lock unavailable');
  });

  it('checks primary ownership on release while still holding the mutex', async () => {
    const { root, claims } = scratch();
    const claim = await acquireReceiptClaim(root, 'capacity', performance.now() + 1000, binary);
    expect(claim).not.toBeNull();
    const replacement = { token: 'replacement', pid: process.pid };
    writeFileSync(join(claims, 'capacity.json'), JSON.stringify(replacement));
    await expect(claim?.release()).rejects.toThrow('ownership changed');
    expect(JSON.parse(readFileSync(join(claims, 'capacity.json'), 'utf8'))).toEqual(replacement);
    const lock = await acquireNativeReceiptLock(claims, 'capacity', performance.now() + 1000, binary);
    await lock.release();
  });
});

describe('native receipt lock lifetime', () => {
  it('holds a stable lock through contention and releases on stdin EOF', async () => {
    const { claims } = scratch();
    const first = nativeProcess(claims);
    await first.ready();
    const contender = nativeProcess(claims, 'capacity', 100);
    expect(await contender.closed).toBe(1);
    expect(contender.output()).toMatchObject({ stdout: '', stderr: expect.stringContaining('deadline exhausted') });
    first.child.stdin.end();
    expect(await first.closed).toBe(0);
    expect(existsSync(join(claims, 'capacity.lock'))).toBe(true);
    const lock = await acquireNativeReceiptLock(claims, 'capacity', performance.now() + 1000, binary);
    await lock.release();
  });

  it('releases the OS mutex when its helper process is killed', async () => {
    const { claims } = scratch();
    const first = nativeProcess(claims);
    await first.ready();
    first.child.kill('SIGKILL');
    await first.closed;
    const lock = await acquireNativeReceiptLock(claims, 'capacity', performance.now() + 1000, binary);
    await lock.release();
  });

  it('releases after a caller crash closes the inherited stdin pipe', async () => {
    const { claims } = scratch();
    const parent = spawn(
      process.execPath,
      [
        '-e',
        `
      const {spawn}=require('node:child_process');
      const helper=spawn(process.argv[1], ['__receipt-lock','--directory',process.argv[2],'--key','capacity','--wait-ms','1000'], {stdio:['pipe','pipe','inherit']});
      helper.stdout.once('data', () => process.stdout.write('ready'));
      setInterval(()=>{}, 1000);
    `,
        binary,
        claims
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    children.push(parent);
    let stdout = '';
    parent.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    await vi.waitFor(() => expect(stdout).toBe('ready'));
    const closed = new Promise<void>((resolve) => parent.once('exit', () => resolve()));
    parent.kill('SIGKILL');
    await closed;
    const lock = await acquireNativeReceiptLock(claims, 'capacity', performance.now() + 1000, binary);
    await lock.release();
  });

  it('bounds waits and refuses already-expired deadlines', async () => {
    const { claims } = scratch();
    const lock = await acquireNativeReceiptLock(claims, 'capacity', performance.now() + 1000, binary);
    const started = performance.now();
    try {
      await expect(acquireNativeReceiptLock(claims, 'capacity', performance.now() + 100, binary)).rejects.toThrow(
        /deadline exhausted/
      );
      expect(performance.now() - started).toBeLessThan(1000);
      await expect(acquireNativeReceiptLock(claims, 'capacity', performance.now() - 1, binary)).rejects.toThrow(
        'deadline exhausted'
      );
    } finally {
      await lock.release();
    }
  });
});

import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { privateDirectory } from '../../src/common/commit-storage.js';

vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  return { ...actual, fstatSync: vi.fn(actual.fstatSync) };
});

const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'private-receipt-directory-'));
  vi.mocked(fs.fstatSync).mockReset().mockImplementation(actual.fstatSync);
});
afterEach(() => {
  vi.mocked(fs.fstatSync).mockReset().mockImplementation(actual.fstatSync);
  fs.rmSync(root, { recursive: true, force: true });
});

function wrongOwner(descriptor: number) {
  const stat = actual.fstatSync(descriptor);
  return Object.assign(Object.create(stat), { uid: stat.uid + 1 });
}

describe.skipIf(process.platform === 'win32')('private receipt directory retained ownership', () => {
  it('requires a fresh exact-owner observation after transient incorrect inode metadata', async () => {
    let descriptor = -1;
    vi.mocked(fs.fstatSync).mockImplementationOnce(((fd: number) => {
      descriptor = fd;
      return wrongOwner(fd);
    }) as typeof fs.fstatSync);
    await expect(privateDirectory(root, performance.now() + 1000)).resolves.toBeUndefined();
    expect(fs.fstatSync).toHaveBeenCalledTimes(2);
    expect(() => actual.fstatSync(descriptor)).toThrowError(expect.objectContaining({ code: 'EBADF' }));
  });

  it('refuses persistent incorrect ownership within the shared deadline and closes its descriptor', async () => {
    let descriptor = -1;
    vi.mocked(fs.fstatSync).mockImplementation(((fd: number) => {
      descriptor = fd;
      return wrongOwner(fd);
    }) as typeof fs.fstatSync);
    const started = performance.now();
    await expect(privateDirectory(root, started + 40)).rejects.toThrow('ownership unavailable within phase deadline');
    expect(performance.now() - started).toBeLessThan(1000);
    expect(() => actual.fstatSync(descriptor)).toThrowError(expect.objectContaining({ code: 'EBADF' }));
  });

  it('rejects public permissions immediately', async () => {
    fs.chmodSync(root, 0o755);
    await expect(privateDirectory(root, performance.now() + 1000)).rejects.toThrow('directory is not private');
    expect(fs.fstatSync).toHaveBeenCalledTimes(1);
  });

  it('refuses symlinked directories without inspecting their target', async () => {
    const link = join(root, 'redirect');
    fs.symlinkSync(root, link);
    await expect(privateDirectory(link, performance.now() + 1000)).rejects.toThrow();
    expect(fs.fstatSync).not.toHaveBeenCalled();
  });
});

/** Crash-released native mutex for private receipt state. */
import { spawn } from 'node:child_process';
import { resolveGitSpanCommand } from './git-span-command.js';

export interface NativeReceiptLock {
  release(): Promise<void>;
}

/** The helper holds one stable OS lock until its stdin closes, including on parent death. */
export async function acquireNativeReceiptLock(
  directory: string,
  key: string,
  deadline: number,
  executable?: string
): Promise<NativeReceiptLock> {
  const remaining = Math.min(30_000, Math.floor(deadline - performance.now()));
  if (remaining <= 0) throw new Error('receipt lock acquisition deadline exhausted');
  const args = ['__receipt-lock', '--directory', directory, '--key', key, '--wait-ms', String(remaining)];
  const command = executable ? { executable, argv: args } : resolveGitSpanCommand(args);
  const child = spawn(command.executable, command.argv, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GIT_SPAN_DISABLE_UPDATE_CHECK: '1' },
    windowsHide: true
  });
  child.stdin.on('error', () => {});
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString('utf8')).slice(0, 4096);
  });
  let spawnError: Error | undefined;
  child.on('error', (error) => {
    spawnError = error;
  });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  let released = false;
  try {
    await new Promise<void>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('receipt lock acquisition deadline exhausted'));
      }, remaining);
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
        if (output === 'locked\n') {
          clearTimeout(timer);
          resolve();
        } else if (output.length >= 7) {
          clearTimeout(timer);
          child.kill('SIGKILL');
          reject(new Error('invalid receipt lock readiness response'));
        }
      });
      void closed.then(() => {
        clearTimeout(timer);
        reject(new Error(`receipt lock unavailable: ${spawnError?.message ?? (stderr.trim() || 'helper exited')}`));
      });
    });
  } catch (error) {
    child.stdin.destroy();
    child.kill('SIGKILL');
    await closed;
    throw error;
  }
  return {
    async release() {
      if (released) throw new Error('receipt lock already released');
      released = true;
      child.stdin.end();
      const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
      try {
        const result = await closed;
        if (result.code !== 0 || result.signal !== null || spawnError)
          throw new Error(`receipt lock release failed: ${stderr.trim() || result.signal || String(result.code)}`);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

/** Real SDK child processes prove complete emission before their explicit exit. */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
const message = 'multibyte λ transport '.repeat(6000);
const transport = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.resolve('@goodfoot/agent-hooks'))), 'core/transport.js')
).href;
async function execute(mode: 'stdout' | 'stderr' | 'serialize-error' | 'continue', paused: boolean) {
  const directory = mkdtempSync(join(tmpdir(), 'receipt-transport-'));
  directories.push(directory);
  const entry = join(directory, 'entry.mjs');
  writeFileSync(
    entry,
    `import { drive } from ${JSON.stringify(transport)};
const text=${JSON.stringify(message)};
const mode=${JSON.stringify(mode)};
const hook=async()=>({text}); hook.eventName='PreToolUse';
if(mode==='continue') hook.unexpectedError='continue';
await drive({finalize(outcome){
 if(mode==='serialize-error'||mode==='continue') throw new Error(text);
 if(mode==='stderr') return {stderr:text,exitCode:2};
 return {stdout:JSON.stringify(outcome.output),exitCode:0};
}},hook);
`
  );
  const consumer = `import subprocess, sys, time
child=subprocess.Popen([sys.argv[1], sys.argv[2]], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
child.stdin.write(b'{}')
child.stdin.close()
time.sleep(0.25)
if child.poll() is not None:
 sys.stderr.write('backpressure child exited before consumption\\n')
if sys.argv[3]=='stdout':
 sys.stdout.buffer.write(child.stdout.read())
 sys.stderr.buffer.write(child.stderr.read())
else:
 sys.stderr.buffer.write(child.stderr.read())
 sys.stdout.buffer.write(child.stdout.read())
sys.exit(child.wait())
`;
  const child = paused
    ? spawn('python3', ['-c', consumer, process.execPath, entry, mode], { stdio: 'pipe' })
    : spawn(process.execPath, [entry], { stdio: 'pipe' });
  const delayedStream = mode === 'stdout' ? child.stdout : child.stderr;
  if (paused) delayedStream.pause();
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const finished = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  const deadline = setTimeout(() => child.kill('SIGKILL'), 5000);
  child.stdin.end('{}');
  try {
    if (paused) {
      await delay(250);
      expect(child.exitCode).toBeNull();
      delayedStream.resume();
    }
    return { status: await finished, stdout, stderr };
  } finally {
    clearTimeout(deadline);
  }
}

describe('receipt dependency transport drain', () => {
  it.each([false, true])('emits complete UTF-8 JSON with paused consumer=%s', async (paused) => {
    const result = await execute('stdout', paused);
    expect(result).toMatchObject({ status: 0, stderr: '' });
    expect(JSON.parse(result.stdout)).toEqual({ text: message });
  });
  it('awaits finalized stderr before preserving a block exit', async () => {
    expect(await execute('stderr', true)).toEqual({ status: 2, stdout: '', stderr: message });
  });
  it('awaits runtime error stderr before preserving failure status', async () => {
    const result = await execute('serialize-error', true);
    expect(result).toMatchObject({ status: 1, stdout: '' });
    expect(result.stderr).toContain(`Error: ${message}\n`);
  });
  it('retains continue policy for serialization failure', async () => {
    expect(await execute('continue', false)).toMatchObject({ status: 0, stdout: '' });
  });
});

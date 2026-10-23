import type { PluginInput } from '@goodfoot/agent-hooks/opencode';
import { describe, expect, it, vi } from 'vitest';
import plugin from '../../src/opencode/index.js';

vi.mock('../../src/common/context-warmup.js', () => ({ startContextWarmup: vi.fn() }));
vi.mock('../../src/opencode/post-tool-use.js', () => ({
  createAfterHandler: () => async (_input: unknown, output: { output: string }) => {
    output.output += '\n<span>context</span>';
  }
}));

type Callback = (event: Record<string, unknown>) => Promise<void>;

function fixture() {
  const callbacks = new Map<string, Callback>();
  const disposals: ReturnType<typeof vi.fn>[] = [];
  const register = async (name: string, callback: Callback) => {
    callbacks.set(name, callback);
    const dispose = vi.fn(async () => {});
    disposals.push(dispose);
    return { dispose };
  };
  const queue: Record<string, unknown>[] = [];
  let wake = () => {};
  const consumed = vi.fn();
  const get = vi.fn(async () => ({ id: 'native-review' }));
  const synthetic = vi.fn(async () => ({}));
  const subscribe = async function* ({ signal }: { signal: AbortSignal }) {
    while (!signal.aborted) {
      const event = queue.shift();
      if (event) {
        consumed(event);
        yield event;
      } else {
        await new Promise<void>((resolve) => {
          wake = resolve;
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
      }
    }
  };
  return {
    context: {
      location: { directory: '/tmp' },
      tool: { hook: register },
      session: { hook: register, get, synthetic },
      event: { subscribe }
    } as unknown as PluginInput,
    callbacks,
    disposals,
    consumed,
    get,
    synthetic,
    emit(type: string, data: unknown) {
      queue.push({ type, data, location: { directory: '/tmp' } });
      wake();
    }
  };
}

async function start() {
  const f = fixture();
  const cleanup = await plugin.setup(f.context);
  if (!cleanup) throw new Error('Missing plugin cleanup');
  return { ...f, cleanup };
}

async function invoke(f: Awaited<ReturnType<typeof start>>, name: string, event: Record<string, unknown>) {
  const callback = f.callbacks.get(name);
  if (!callback) throw new Error(`Missing native hook ${name}`);
  await callback(event);
}

describe('OpenCode V2 native adapter', () => {
  it('preserves structured content and metadata when appending context', async () => {
    const f = await start();
    try {
      const parts = [
        { type: 'text', text: 'original' },
        { type: 'file', uri: 'file:///tmp/a', mime: 'text/plain' }
      ];
      const event = {
        status: 'completed',
        tool: 'read',
        sessionID: 'native-review',
        id: 'call',
        input: {},
        result: { content: parts, metadata: { retained: true } }
      };
      await invoke(f, 'execute.after', event);
      expect(event.result).toEqual({
        content: [...parts, { type: 'text', text: '\n<span>context</span>' }],
        metadata: { retained: true }
      });
      const failed = { status: 'error', error: { message: 'denied' } };
      await invoke(f, 'execute.after', failed);
      expect(failed).toEqual({ status: 'error', error: { message: 'denied' } });
    } finally {
      await f.cleanup();
    }
    expect(f.disposals).toHaveLength(2);
    for (const dispose of f.disposals) expect(dispose).toHaveBeenCalledOnce();
  });

  it('does not register a prompt hook or resume an idle session', async () => {
    const f = await start();
    try {
      expect(f.callbacks.has('prompt')).toBe(false);
      f.emit('session.status', { sessionID: 'native-review', status: { type: 'idle' } });
      f.emit('session.status', { sessionID: 'barrier', status: { type: 'idle' } });
      await vi.waitFor(() => expect(f.consumed).toHaveBeenCalledTimes(2));
      expect(f.get).not.toHaveBeenCalled();
      expect(f.synthetic).not.toHaveBeenCalled();
    } finally {
      await f.cleanup();
    }
  });
});

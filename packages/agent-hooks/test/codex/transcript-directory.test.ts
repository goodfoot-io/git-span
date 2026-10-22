/** Transcript-backed execution-directory recovery preserves shell commands. */
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as shellInput from '../../src/codex/shell-input.js';
import { createHandler } from '../../src/codex/static-plan.js';
import { createSessionLayout } from '../../src/common/agent-hooks-common.js';

const { enroll, plan } = vi.hoisted(() => ({
  enroll: vi.fn(async () => ({ kind: 'enrolled' })),
  plan: vi.fn()
}));
vi.mock('../../src/common/commit-runtime.js', () => ({ enrollCommitInvocation: enroll }));
vi.mock('../../src/common/bash-attribution.js', () => ({
  planBashTouches: plan,
  createDefaultPlannedTouchStore: () => ({})
}));

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function fixture(workdir: string | undefined) {
  const root = mkdtempSync(join(tmpdir(), 'codex-transcript-directory-'));
  roots.push(root);
  const command = 'cat app.ts';
  const transcript = join(root, 'session.jsonl');
  const rows = [
    { type: 'session_meta', payload: { id: 'session' } },
    {
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        call_id: 'call',
        arguments: JSON.stringify({ cmd: command, ...(workdir === undefined ? {} : { workdir }) })
      }
    }
  ];
  writeFileSync(transcript, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  const input = {
    session_id: 'session',
    tool_use_id: 'call',
    transcript_path: transcript,
    cwd: root,
    tool_name: 'Bash',
    tool_input: { command }
  };
  return { root, transcript, input, rows, handler: createHandler(createSessionLayout(join(root, 'state'))) };
}

const context = { logger: { warn: vi.fn() } };
describe('Codex transcript directory planning', () => {
  it.each([undefined, '../target', '/tmp/absolute-target'])(
    'preserves the command with workdir %s',
    async (workdir) => {
      const f = fixture(workdir);
      expect(await f.handler(f.input as never, context as never)).toBeUndefined();
      const cwd = workdir === undefined ? f.root : workdir.startsWith('/') ? workdir : join(f.root, workdir);
      expect(enroll).toHaveBeenCalledWith(
        expect.objectContaining({ cwd, toolInput: f.input.tool_input, toolUseId: 'call' }),
        expect.anything(),
        context.logger
      );
      expect(plan).toHaveBeenCalledWith('cat app.ts', cwd, 'session', 'call', context.logger, expect.anything());
      expect(f.input.tool_input).toEqual({ command: 'cat app.ts' });
    }
  );

  it.each([
    'missing',
    'wrong-session',
    'wrong-id',
    'command-mismatch',
    'duplicate',
    'malformed',
    'partial',
    'oversized',
    'environment',
    'invalid-workdir',
    'nul-workdir',
    'background',
    'wrong-tool',
    'wrong-namespace',
    'code-mode'
  ])('suppresses planning without an exact safe call: %s', async (failure) => {
    const f = fixture('../target');
    const call = f.rows[1]?.payload;
    if (call === undefined) throw new Error('missing fixture call');
    let transcript: string;
    switch (failure) {
      case 'missing':
        rmSync(f.transcript);
        break;
      case 'wrong-session':
        f.input.session_id = 'other';
        break;
      case 'wrong-id':
        f.input.tool_use_id = 'other';
        break;
      case 'command-mismatch':
        f.input.tool_input.command = 'cat other.ts';
        break;
      case 'duplicate':
        f.rows.push(f.rows[1] as (typeof f.rows)[number]);
        break;
      case 'environment':
      case 'invalid-workdir':
      case 'nul-workdir':
      case 'background':
        call.arguments = JSON.stringify({
          cmd: 'cat app.ts',
          ...(failure === 'environment' ? { environment_id: 'remote' } : {}),
          ...(failure === 'invalid-workdir' ? { workdir: 4 } : {}),
          ...(failure === 'nul-workdir' ? { workdir: 'bad\0path' } : {}),
          ...(failure === 'background' ? { background: true } : {})
        });
        break;
      case 'wrong-tool':
        call.name = 'other';
        break;
      case 'wrong-namespace':
        Object.assign(call, { namespace: 'untrusted' });
        break;
      case 'code-mode':
        Object.assign(call, {
          type: 'custom_tool_call',
          name: 'exec',
          input: 'tools.exec_command({cmd:"cat other.ts"})'
        });
        f.input.tool_use_id = 'exec-child';
        break;
    }
    if (failure !== 'missing') {
      transcript = `${f.rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
      if (failure === 'malformed') transcript += 'invalid\n';
      if (failure === 'partial') transcript += '{"type":';
      writeFileSync(f.transcript, transcript);
      if (failure === 'oversized') truncateSync(f.transcript, 16 * 1024 * 1024 + 1);
    }
    expect(await f.handler(f.input as never, context as never)).toBeUndefined();
    expect(enroll).not.toHaveBeenCalled();
    expect(plan).not.toHaveBeenCalled();
    expect(context.logger.warn).toHaveBeenCalledWith(expect.stringContaining('suppressing attribution'));
  });

  it('does not confuse a call output or a different call with the original invocation', async () => {
    const f = fixture('../target');
    writeFileSync(
      f.transcript,
      `${f.rows.map((row) => JSON.stringify(row)).join('\n')}\n${JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call_output', call_id: 'call', output: 'output' }
      })}\n${JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          call_id: 'other',
          name: 'exec_command',
          arguments: JSON.stringify({ cmd: 'cat app.ts', workdir: '/wrong' })
        }
      })}\n`
    );
    expect(await f.handler(f.input as never, context as never)).toBeUndefined();
    expect(enroll).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: join(f.root, '../target') }),
      expect.anything(),
      context.logger
    );
  });
});

function codeModeFixture(sources: string[]) {
  const f = fixture(undefined);
  f.input.tool_use_id = 'exec-child';
  const rows: unknown[] = [
    f.rows[0],
    ...sources.map((input, index) => ({
      type: 'response_item',
      payload: { type: 'custom_tool_call', name: 'exec', call_id: `outer-${index}`, input }
    }))
  ];
  const save = () => writeFileSync(f.transcript, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  save();
  return { ...f, rows, save };
}

describe('literal code-mode directory recovery', () => {
  it.each([undefined, '../target', '/tmp/absolute-target'])(
    'recovers child workdir %s without rewriting',
    async (workdir) => {
      const f = codeModeFixture([
        `const result = await tools.exec_command(${JSON.stringify({ cmd: 'cat app.ts', ...(workdir === undefined ? {} : { workdir }) })}); text(result);`
      ]);
      expect(await f.handler(f.input as never, context as never)).toBeUndefined();
      expect(enroll).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: resolve(f.root, workdir ?? ''), toolInput: f.input.tool_input }),
        expect.anything(),
        context.logger
      );
    }
  );

  it('accepts multiple possible calls only when their matching commands agree on the directory', async () => {
    const f = codeModeFixture([
      'tools.exec_command({cmd: "cat app.ts", workdir: "../target"});',
      'tools.exec_command({cmd: "git status", workdir: "/other"}); tools.exec_command({cmd: "cat app.ts", workdir: "../target"});'
    ]);
    expect(await f.handler(f.input as never, context as never)).toBeUndefined();
    expect(enroll).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: join(f.root, '../target') }),
      expect.anything(),
      context.logger
    );
  });

  it.each([
    [
      'tools.exec_command({cmd: "cat app.ts", workdir: "/one"}); tools.exec_command({cmd: "cat app.ts", workdir: "/two"});'
    ],
    [
      'tools.exec_command({cmd: "cat app.ts", workdir: "/one"});',
      'tools.exec_command({cmd: "cat app.ts", workdir: "/two"});'
    ],
    ['tools.exec_command({cmd: "cat app.ts", workdir: directory});'],
    ['tools.exec_command({cmd: command, workdir: "/one"});'],
    ['tools.exec_command({cmd: "cat app.ts", environment_id: "remote"});'],
    ['tools.exec_command({cmd: "cat app.ts", cwd: "/ignored-by-host"});'],
    [
      'const run = tools.exec_command; run({cmd: "cat app.ts", workdir: "/unknown"}); tools.exec_command({cmd: "cat app.ts", workdir: "/one"});'
    ],
    [
      'const t = tools; t.exec_command({cmd: "cat app.ts", workdir: "/unknown"}); tools.exec_command({cmd: "cat app.ts", workdir: "/one"});'
    ],
    ['tools.exec_command({cmd: "cat app.ts", workdir: "/one", background: true});']
  ])('rejects ambiguous or nonliteral child execution: %s', async (...sources) => {
    const f = codeModeFixture(sources);
    expect(await f.handler(f.input as never, context as never)).toBeUndefined();
    expect(enroll).not.toHaveBeenCalled();
    expect(plan).not.toHaveBeenCalled();
  });

  it.each(['Script completed', 'Script failed'])(
    'ignores terminal outer calls, including dynamic source: %s',
    async (status) => {
      const f = codeModeFixture(['tools.exec_command({cmd: buildCommand(), workdir: directory});']);
      f.rows.push({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'outer-0',
          output: [{ type: 'input_text', text: `${status}\nWall time 0.1 seconds\nOutput:\n` }]
        }
      });
      f.rows.push({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'active',
          input: 'tools.exec_command({cmd: "cat app.ts", workdir: "../target"});'
        }
      });
      f.save();
      expect(await f.handler(f.input as never, context as never)).toBeUndefined();
      expect(enroll).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: join(f.root, '../target') }),
        expect.anything(),
        context.logger
      );
    }
  );

  it('keeps yielded outer calls as candidates rather than treating their response as completion', async () => {
    const f = codeModeFixture(['tools.exec_command({cmd: "cat app.ts", workdir: "/one"});']);
    f.rows.push({
      type: 'response_item',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'outer-0',
        output: [{ type: 'input_text', text: 'Script running with cell ID 123\nWall time 0.1 seconds\nOutput:\n' }]
      }
    });
    f.rows.push({
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        name: 'exec',
        call_id: 'active',
        input: 'tools.exec_command({cmd:"cat app.ts", workdir:"/two"});'
      }
    });
    f.save();
    expect(await f.handler(f.input as never, context as never)).toBeUndefined();
    expect(enroll).not.toHaveBeenCalled();
  });
  it('resolves each outstanding source against its own originating turn directory', async () => {
    const f = codeModeFixture([]);
    for (const [id, cwd] of [
      ['first', '/one'],
      ['second', '/two']
    ]) {
      f.rows.push({ type: 'turn_context', payload: { cwd } });
      f.rows.push({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: id,
          input: 'tools.exec_command({cmd:"cat app.ts", workdir:"target"});'
        }
      });
    }
    f.save();
    expect(await f.handler(f.input as never, context as never)).toBeUndefined();
    expect(enroll).not.toHaveBeenCalled();
  });

  it('parses only outstanding JavaScript, regardless of completed history size', async () => {
    const f = codeModeFixture([]);
    for (let index = 0; index < 2000; index++) {
      f.rows.push({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: `old-${index}`,
          input: 'tools.exec_command({cmd: dynamic(), workdir: unknown});'
        }
      });
      f.rows.push({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: `old-${index}`,
          output: 'Script completed\nWall time 0.1 seconds\nOutput:\n'
        }
      });
    }
    const source = 'tools.exec_command({cmd:"cat app.ts", workdir:"../target"});';
    f.rows.push({
      type: 'response_item',
      payload: { type: 'custom_tool_call', name: 'exec', call_id: 'active', input: source }
    });
    f.save();
    const parser = vi.spyOn(shellInput, 'narrowCodeModeExecutions');
    expect(await f.handler(f.input as never, context as never)).toBeUndefined();
    expect(parser).toHaveBeenCalledExactlyOnceWith({ input: source, cwd: f.root }, { directToolsOnly: true });
    expect(enroll).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: join(f.root, '../target') }),
      expect.anything(),
      context.logger
    );
  });

  it.each(['source-bytes', 'pending-count'])('bounds pending work before parsing any JavaScript: %s', async (limit) => {
    const source = 'tools.exec_command({cmd:"cat app.ts", workdir:"../target"});';
    const f = codeModeFixture(
      limit === 'source-bytes' ? [source + ' '.repeat(1_048_576)] : Array.from({ length: 33 }, () => source)
    );
    const parser = vi.spyOn(shellInput, 'narrowCodeModeExecutions');
    expect(await f.handler(f.input as never, context as never)).toBeUndefined();
    expect(parser).not.toHaveBeenCalled();
    expect(enroll).not.toHaveBeenCalled();
  });
});

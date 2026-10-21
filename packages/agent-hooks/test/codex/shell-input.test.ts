import { describe, expect, it } from 'vitest';
import { narrowCodeModeExec, narrowShellExecutions } from '../../src/codex/shell-input.js';

describe('Codex literal shell normalization', () => {
  it('retains each execution and workdir from a code-mode batch', () => {
    expect(
      narrowShellExecutions({
        input: `await Promise.all([
      tools.exec_command({cmd: 'git commit -qm first', workdir: '/first'}),
      tools.exec_command({cmd: \`git commit -qm second\`, workdir: '/second'})
    ]);`
      })
    ).toEqual({
      matched: true,
      executions: [
        { command: 'git commit -qm first', workdir: '/first', background: false },
        { command: 'git commit -qm second', workdir: '/second', background: false }
      ]
    });
    expect(
      narrowCodeModeExec({ input: 'tools.exec_command({cmd:"first"}); tools.exec_command({cmd:"second"});' })
    ).toEqual({ matched: true, cmd: null, workdir: null });
  });

  it('rejects the complete batch when any command or cwd is dynamic', () => {
    for (const dynamic of [
      'cmd: buildCommand()',
      'cmd: "git commit", workdir: directory',
      '...args, cmd: "git commit"'
    ]) {
      expect(
        narrowShellExecutions({ input: `tools.exec_command({cmd:"echo literal"}); tools.exec_command({${dynamic}});` })
      ).toEqual({ matched: true, executions: [] });
    }
  });

  it('does not parse calls inside strings, comments, or regex literals', () => {
    expect(
      narrowShellExecutions({
        input: `
      const text = 'tools.exec_command({cmd:"git commit"})';
      // tools.exec_command({cmd:"git commit"})
      const pattern = /tools.exec_command/;
    `
      })
    ).toEqual({ matched: false, executions: [] });
  });

  it('bounds code size and number of execution contexts', () => {
    expect(narrowShellExecutions({ input: ' '.repeat(1_048_577) })).toEqual({ matched: true, executions: [] });
    expect(narrowShellExecutions({ input: 'tools.exec_command({cmd:"git status"});'.repeat(33) })).toEqual({
      matched: true,
      executions: []
    });
  });
});

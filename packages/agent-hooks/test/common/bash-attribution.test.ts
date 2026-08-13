/** Focused lifecycle checks for the authoritative static Bash attribution pipeline. */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createDefaultPlannedTouchStore,
  normalizeBashResponse,
  planBashTouches,
  runLayeredBashTouches
} from '../../src/common/bash-attribution.js';
import { bashResponseExitCode, bashResponseInterrupted } from '../../src/common/bash-touch.js';
import type { CoreLogger, MemoStore } from '../../src/common/span-surface.js';
import type { TouchExecutors } from '../../src/common/touch-core.js';
import { makeTempRepo } from '../helpers.js';
import { makeTempLayout } from '../session-layout-helpers.js';

const SESSION_ID = 'static-attribution-lifecycle';

function memo(): MemoStore {
  const surfaced = new Set<string>();
  return {
    getSurfaced: () => new Set(surfaced),
    addSurfaced: (_sessionId, names) => {
      for (const name of names) surfaced.add(name);
    }
  };
}

function capture(): { executors: TouchExecutors; fixes: string[] } {
  const fixes: string[] = [];
  return {
    fixes,
    executors: {
      fix: async (filePath) => {
        fixes.push(filePath);
        return { modified: false };
      },
      list: async () => [],
      drift: async () => [],
      why: async () => null
    }
  };
}

function logger(): { value: CoreLogger; warnings: string[]; infos: Record<string, unknown>[] } {
  const warnings: string[] = [];
  const infos: Record<string, unknown>[] = [];
  return {
    warnings,
    infos,
    value: {
      warn: (message) => warnings.push(message),
      info: (_message, context) => {
        if (context !== undefined) infos.push(context);
      }
    }
  };
}

describe('Bash response normalization', () => {
  it('accepts every deployed exit-code spelling', () => {
    expect(bashResponseExitCode({ exit_code: 1 })).toBe(1);
    expect(bashResponseExitCode({ exitCode: 2 })).toBe(2);
    expect(bashResponseExitCode({ exitStatus: 3 })).toBe(3);
    expect(normalizeBashResponse({ output: 'x', exit_code: 1 })?.exitStatus).toBe(1);
    expect(normalizeBashResponse({ stdout: 'x', exitCode: 2 })?.exitStatus).toBe(2);
    expect(normalizeBashResponse({ content: 'x', exitStatus: 3 })?.exitStatus).toBe(3);
  });

  it('treats nullable timeouts as completed and numeric timeouts or either interrupt spelling as interrupted', () => {
    expect(bashResponseInterrupted({ timedOutAfterMs: null })).toBe(false);
    expect(normalizeBashResponse({ output: 'x', timedOutAfterMs: null })?.interrupted).toBe(false);
    expect(bashResponseInterrupted({ timedOutAfterMs: 0 })).toBe(true);
    expect(bashResponseInterrupted({ interrupted: true })).toBe(true);
    expect(bashResponseInterrupted({ is_interrupt: true })).toBe(true);
  });
});

describe('static Bash pre/post plan lifecycle', () => {
  it('consumes a verified sed plan once and never widens a missing second delivery', async () => {
    const repo = makeTempRepo();
    const temp = makeTempLayout();
    try {
      const filePath = join(repo.root, 'f.txt');
      writeFileSync(filePath, 'keep\nneedle\nkeep\n');
      execFileSync('git', ['add', 'f.txt'], { cwd: repo.root });
      const store = createDefaultPlannedTouchStore(temp.layout);
      const log = logger();
      const command = "sed -i 's/needle/pin/' f.txt";
      planBashTouches(command, repo.root, SESSION_ID, 'sed-once', log.value, store);
      writeFileSync(filePath, 'keep\npin\nkeep\n');

      const first = capture();
      await runLayeredBashTouches(
        command,
        repo.root,
        SESSION_ID,
        'sed-once',
        { exitStatus: 0 },
        first.executors,
        memo(),
        log.value,
        store
      );
      expect(first.fixes).toEqual([filePath]);

      const duplicate = capture();
      await runLayeredBashTouches(
        command,
        repo.root,
        SESSION_ID,
        'sed-once',
        { exitStatus: 0 },
        duplicate.executors,
        memo(),
        log.value,
        store
      );
      expect(duplicate.fixes).toEqual([]);
    } finally {
      temp.cleanup();
      repo.cleanup();
    }
  });

  it('fails closed when a required plan is missing or its post-state evidence mismatches', async () => {
    const repo = makeTempRepo();
    const temp = makeTempLayout();
    try {
      const filePath = join(repo.root, 'f.txt');
      writeFileSync(filePath, 'needle\n');
      execFileSync('git', ['add', 'f.txt'], { cwd: repo.root });
      const store = createDefaultPlannedTouchStore(temp.layout);
      const log = logger();
      const command = "sed -i 's/needle/pin/' f.txt";

      writeFileSync(filePath, 'pin\n');
      const missing = capture();
      await runLayeredBashTouches(
        command,
        repo.root,
        SESSION_ID,
        'missing-plan',
        { exitStatus: 0 },
        missing.executors,
        memo(),
        log.value,
        store
      );
      expect(missing.fixes).toEqual([]);

      writeFileSync(filePath, 'needle\n');
      planBashTouches(command, repo.root, SESSION_ID, 'bad-evidence', log.value, store);
      writeFileSync(filePath, 'unexpected\n');
      const mismatch = capture();
      await runLayeredBashTouches(
        command,
        repo.root,
        SESSION_ID,
        'bad-evidence',
        { exitStatus: 0 },
        mismatch.executors,
        memo(),
        log.value,
        store
      );
      expect(mismatch.fixes).toEqual([]);
      expect(log.warnings.some((message) => message.includes('unverifiable planned evidence'))).toBe(true);
    } finally {
      temp.cleanup();
      repo.cleanup();
    }
  });

  it('consumes interrupted plans without firing, while a nullable timeout permits verified work', async () => {
    const repo = makeTempRepo();
    const temp = makeTempLayout();
    try {
      const filePath = join(repo.root, 'f.txt');
      writeFileSync(filePath, 'needle\n');
      execFileSync('git', ['add', 'f.txt'], { cwd: repo.root });
      const store = createDefaultPlannedTouchStore(temp.layout);
      const log = logger();
      const command = "sed -i 's/needle/pin/' f.txt";

      planBashTouches(command, repo.root, SESSION_ID, 'interrupted', log.value, store);
      writeFileSync(filePath, 'pin\n');
      const interrupted = capture();
      await runLayeredBashTouches(
        command,
        repo.root,
        SESSION_ID,
        'interrupted',
        { timedOutAfterMs: 1 },
        interrupted.executors,
        memo(),
        log.value,
        store
      );
      expect(interrupted.fixes).toEqual([]);
      expect(store.consume(SESSION_ID, 'interrupted')).toBeNull();

      writeFileSync(filePath, 'needle\n');
      planBashTouches(command, repo.root, SESSION_ID, 'nullable-timeout', log.value, store);
      writeFileSync(filePath, 'pin\n');
      const completed = capture();
      await runLayeredBashTouches(
        command,
        repo.root,
        SESSION_ID,
        'nullable-timeout',
        { exitStatus: 0, timedOutAfterMs: null },
        completed.executors,
        memo(),
        log.value,
        store
      );
      expect(completed.fixes).toEqual([filePath]);
    } finally {
      temp.cleanup();
      repo.cleanup();
    }
  });

  it('attributes verified substitutions on nonzero exit but suppresses inconclusive formatter failures', async () => {
    const repo = makeTempRepo();
    const temp = makeTempLayout();
    try {
      const filePath = join(repo.root, 'f.txt');
      writeFileSync(filePath, 'needle\n');
      execFileSync('git', ['add', 'f.txt'], { cwd: repo.root });
      const store = createDefaultPlannedTouchStore(temp.layout);
      const log = logger();
      const command = "sed -i 's/needle/pin/' f.txt; false";
      planBashTouches(command, repo.root, SESSION_ID, 'partial-write', log.value, store);
      writeFileSync(filePath, 'pin\n');
      const verified = capture();
      await runLayeredBashTouches(
        command,
        repo.root,
        SESSION_ID,
        'partial-write',
        { exitStatus: 1 },
        verified.executors,
        memo(),
        log.value,
        store
      );
      expect(verified.fixes).toEqual([filePath]);

      const formatter = capture();
      await runLayeredBashTouches(
        'prettier --write f.txt',
        repo.root,
        SESSION_ID,
        'formatter-failure',
        { exitStatus: 1 },
        formatter.executors,
        memo(),
        log.value,
        store
      );
      expect(formatter.fixes).toEqual([]);
    } finally {
      temp.cleanup();
      repo.cleanup();
    }
  });

  it('uses pre tracking for git rm and post tracking for creates and explicit git add', async () => {
    const repo = makeTempRepo();
    const temp = makeTempLayout();
    try {
      const store = createDefaultPlannedTouchStore(temp.layout);
      const log = logger();
      const deleted = join(repo.root, 'deleted.txt');
      writeFileSync(deleted, 'tracked\n');
      execFileSync('git', ['add', 'deleted.txt'], { cwd: repo.root });
      planBashTouches('git rm deleted.txt', repo.root, SESSION_ID, 'git-rm', log.value, store);
      execFileSync('git', ['rm', '-q', '-f', 'deleted.txt'], { cwd: repo.root });
      const removal = capture();
      await runLayeredBashTouches(
        'git rm deleted.txt',
        repo.root,
        SESSION_ID,
        'git-rm',
        { exitStatus: 0 },
        removal.executors,
        memo(),
        log.value,
        store
      );
      expect(removal.fixes).toEqual([deleted]);

      const untracked = join(repo.root, 'untracked.txt');
      writeFileSync(untracked, 'x\n');
      const dropped = capture();
      await runLayeredBashTouches(
        'echo x > untracked.txt',
        repo.root,
        SESSION_ID,
        'untracked-create',
        { exitStatus: 0 },
        dropped.executors,
        memo(),
        log.value,
        store
      );
      expect(dropped.fixes).toEqual([]);

      const added = join(repo.root, 'added.txt');
      writeFileSync(added, 'x\n');
      execFileSync('git', ['add', 'added.txt'], { cwd: repo.root });
      const accepted = capture();
      await runLayeredBashTouches(
        'echo x > added.txt && git add added.txt',
        repo.root,
        SESSION_ID,
        'tracked-create',
        { exitStatus: 0 },
        accepted.executors,
        memo(),
        log.value,
        store
      );
      expect(accepted.fixes).toEqual([added]);
    } finally {
      temp.cleanup();
      repo.cleanup();
    }
  });

  it('batches command and response producers into one post-side tracked-membership query', async () => {
    const repo = makeTempRepo();
    const temp = makeTempLayout();
    try {
      const filePath = join(repo.root, 'f.txt');
      writeFileSync(filePath, 'one\ntwo\nthree\n');
      execFileSync('git', ['add', 'f.txt'], { cwd: repo.root });
      const command = 'git log -p -L 2,3:f.txt';
      const response = [
        'diff --git a/f.txt b/f.txt',
        'index 1111111..2222222 100644',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -2,2 +2,2 @@',
        '-two',
        '+TWO',
        ' three',
        ''
      ].join('\n');
      const log = logger();
      const run = capture();
      await runLayeredBashTouches(
        command,
        repo.root,
        SESSION_ID,
        'batched-producers',
        response,
        run.executors,
        memo(),
        log.value,
        createDefaultPlannedTouchStore(temp.layout)
      );

      expect(log.infos.at(-1)?.subprocessCount).toBe(1);
    } finally {
      temp.cleanup();
      repo.cleanup();
    }
  });
});

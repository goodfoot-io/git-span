import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addLineSpan,
  type BuiltRealHookBundles,
  buildRealHookBundles,
  buildWorkspaceGitSpan,
  commitRepo,
  hookContext,
  invokeRealHook,
  makeRealBundleRepo,
  writeRepoFile
} from '../real-bundle-helpers.js';

let bundles: BuiltRealHookBundles;
let binaryPath: string;
beforeAll(() => {
  binaryPath = buildWorkspaceGitSpan().pathDir;
  bundles = buildRealHookBundles();
}, 600_000);
afterAll(() => bundles?.cleanup());

describe('emitted hook session guidance lifecycle', () => {
  it.each(['claude', 'codex'] as const)('keeps %s guidance once while lifecycle events reset exposure', (host) => {
    const repo = makeRealBundleRepo(binaryPath);
    try {
      writeRepoFile(repo, 'app.ts', 'one\n');
      commitRepo(repo, 'source');
      addLineSpan(repo, 'flow', 'app.ts', 1, 1);
      commitRepo(repo, 'span');
      const directory = host === 'claude' ? bundles.claudeHooksDir : bundles.codexHooksDir;
      let sequence = 0;
      const touch = (sessionId = 's', transcript = '/tmp/transcript') =>
        invokeRealHook(
          join(directory, 'post-tool-use.mjs'),
          {
            hook_event_name: 'PostToolUse',
            cwd: repo.root,
            session_id: sessionId,
            transcript_path: transcript,
            tool_use_id: `tool-${++sequence}`,
            tool_name: 'Bash',
            tool_input: { command: 'cat app.ts', ...(host === 'codex' ? { workdir: repo.root } : {}) },
            tool_response: { stdout: 'one\n' }
          },
          repo.env
        );
      const first = touch();
      expect(first.stderr).toBe('');
      expect(hookContext(first.output)).toBe(
        '\n<git-span>\napp.ts is anchored in: flow\n\nUse `git span list flow` for more information\n</git-span>\n'
      );
      expect(hookContext(touch().output)).toBe('');
      const event = host === 'codex' ? 'stop.mjs' : 'session-start.mjs';
      const reset = invokeRealHook(
        join(directory, event),
        {
          hook_event_name: host === 'codex' ? 'Stop' : 'SessionStart',
          cwd: repo.root,
          session_id: 's',
          source: 'compact',
          transcript_path: '/tmp/transcript',
          stop_hook_active: false
        },
        repo.env
      );
      expect(reset.stderr).toBe('');
      expect(hookContext(touch().output)).toBe('\n<git-span>\napp.ts is anchored in: flow\n</git-span>\n');
      if (host === 'claude') {
        invokeRealHook(
          join(directory, event),
          {
            hook_event_name: 'SessionStart',
            cwd: repo.root,
            session_id: 's',
            source: 'resume',
            transcript_path: '/tmp/transcript'
          },
          repo.env
        );
        expect(hookContext(touch('s', '/tmp/other-recipient').output)).toBe(
          '\n<git-span>\napp.ts is anchored in: flow\n</git-span>\n'
        );
      }
      expect(hookContext(touch('new-session').output)).toContain('Use `git span list flow` for more information');
    } finally {
      repo.cleanup();
    }
  });
});

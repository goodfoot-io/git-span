/** D1/D1b and D3/D3b: CLI and emitted-hook reproductions from report 05. */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type BuiltRealHookBundles,
  buildRealHookBundles,
  buildWorkspaceGitSpan,
  commitRepo,
  hookContext,
  invokeRealHook,
  makeRealBundleRepo,
  type RealBundleRepo,
  writeRepoFile
} from '../real-bundle-helpers.js';

interface ContextDocument {
  spans: { name: string; anchors: { status: { code: string } }[] }[];
}

describe('repair correctness reproductions', () => {
  let bundles: BuiltRealHookBundles;
  let pathDir: string;
  beforeAll(() => {
    pathDir = buildWorkspaceGitSpan().pathDir;
    bundles = buildRealHookBundles();
  }, 600_000);
  afterAll(() => bundles?.cleanup());

  function span(repo: RealBundleRepo, args: string[]): string {
    return execFileSync('git', ['span', ...args], {
      cwd: repo.root,
      env: { ...repo.env, GIT_SPAN_DISABLE_UPDATE_CHECK: '1', GIT_SPAN_CONTEXT_DISABLE_SERVICE: '1' },
      encoding: 'utf8'
    });
  }

  function context(repo: RealBundleRepo): ContextDocument {
    return JSON.parse(span(repo, ['context', 'app.py', '--format', 'json'])) as ContextDocument;
  }

  function edit(repo: RealBundleRepo, oldString: string, newString: string): string {
    return hookContext(
      invokeRealHook(
        join(bundles.claudeHooksDir, 'post-tool-use.mjs'),
        {
          session_id: randomUUID(),
          transcript_path: join(repo.home, 'transcript.jsonl'),
          cwd: repo.root,
          hook_event_name: 'PostToolUse',
          tool_name: 'Edit',
          tool_use_id: randomUUID(),
          tool_input: { file_path: join(repo.root, 'app.py'), old_string: oldString, new_string: newString },
          tool_response: {}
        },
        { ...repo.env, GIT_SPAN_CONTEXT_DISABLE_SERVICE: '1' }
      ).output
    );
  }

  it.each(['CLI', 'hook'] as const)('D1: %s repair must leave a literal whitespace change unresolved', (route) => {
    const repo = makeRealBundleRepo(pathDir);
    try {
      const original = 'print("alpha beta")';
      const changed = 'print("alphabeta")';
      writeRepoFile(repo, 'app.py', `${original}\n`);
      writeRepoFile(repo, 'witness.txt', 'Output is alpha beta.\n');
      commitRepo(repo, 'source');
      span(repo, ['add', 'literal', 'app.py#L1-L1', 'witness.txt#L1-L1']);
      span(repo, ['why', 'literal', 'Source output must agree with the witness.']);
      commitRepo(repo, 'coupling');
      const definition = readFileSync(join(repo.root, '.span/literal'), 'utf8');
      writeRepoFile(repo, 'app.py', `${changed}\n`);
      expect(context(repo).spans[0]?.anchors[0]?.status.code).toBe('CHANGED');
      // The changed bytes demonstrably change the program's observable output.
      expect(execFileSync('python3', ['app.py'], { cwd: repo.root, encoding: 'utf8' })).toBe('alphabeta\n');
      if (route === 'CLI') {
        span(repo, ['context', 'app.py#L1-L1', '--fix', '--operation-id', randomUUID(), '--format', 'json']);
      } else {
        expect.soft(edit(repo, original, changed)).toContain('changed');
      }
      expect.soft(readFileSync(join(repo.root, '.span/literal'), 'utf8')).toBe(definition);
      expect(context(repo).spans[0]?.anchors[0]?.status.code).toBe('CHANGED');
    } finally {
      repo.cleanup();
    }
  });

  it.each(['CLI', 'hook'] as const)('D3: %s location repair must cover independently coupled shifted code', (route) => {
    const repo = makeRealBundleRepo(pathDir);
    try {
      const source = Array.from({ length: 30 }, (_, index) => `line_${index + 1} = ${index + 1}`).join('\n');
      writeRepoFile(repo, 'app.py', `${source}\n`);
      commitRepo(repo, 'source');
      span(repo, ['add', 'selected', 'app.py#L1-L2', 'app.py#L10-L11']);
      span(repo, ['why', 'selected', 'The two source ranges agree.']);
      span(repo, ['add', 'independent', 'app.py#L20-L21']);
      span(repo, ['why', 'independent', 'A separate relationship in the same edited file.']);
      commitRepo(repo, 'couplings');
      const independent = readFileSync(join(repo.root, '.span/independent'), 'utf8');
      writeRepoFile(repo, 'app.py', `# inserted\n${source}\n`);
      // All anchored bytes remain unique and identical; only their line coordinates change.
      if (route === 'CLI') {
        span(repo, ['context', 'app.py#L1-L2', '--fix', '--operation-id', randomUUID(), '--format', 'json']);
      } else {
        edit(repo, 'line_1 = 1', '# inserted\nline_1 = 1');
      }
      // Establish that repair reaches outside the touched range inside the selected span.
      expect(readFileSync(join(repo.root, '.span/selected'), 'utf8')).toContain('#L11-L12');
      expect.soft(readFileSync(join(repo.root, '.span/independent'), 'utf8')).not.toBe(independent);
      expect.soft(readFileSync(join(repo.root, '.span/independent'), 'utf8')).toContain('#L21-L22');
      const statuses = context(repo)
        .spans.find(({ name }) => name === 'independent')
        ?.anchors.map(({ status }) => status.code);
      expect(statuses).not.toContain('MOVED');
    } finally {
      repo.cleanup();
    }
  });
});

/**
 * Standing control against foreign-vocabulary drift (evaluation finding B2):
 * the antigravity skill tree was born by cloning Claude-tree content, so it
 * launched speaking vocabulary that is foreign or false on an agy host —
 * `git-span:git-span` plugin-namespace dispatch, bare Claude tool names,
 * `~/.claude`/`.claude-plugin` paths, and an advisor-host enumeration that
 * excluded its own platform. The fix is the shared glossary in
 * scripts/agent-skills-vocabulary.mjs rendered through the templates; this
 * test asserts on the RENDERED tree so a future template edit that
 * reintroduces the class turns a gate red.
 *
 * PreToolUse/PostToolUse are NOT forbidden here: unlike opencode, they are
 * Antigravity's native hook-event names (plugins-antigravity/git-span/hooks.json).
 *
 * Allowlist entries carry their reason inline. The positive assertions at the
 * bottom keep the control meaningful: if the antigravity adaptations were
 * ever reverted wholesale, the allowlist must fail loud, not pass silent.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const skillsRoot = join(process.cwd(), '..', '..', 'plugins-antigravity', 'git-span', 'skills');
const vocabularyModule = pathToFileURL(join(process.cwd(), '..', '..', 'scripts', 'agent-skills-vocabulary.mjs')).href;

/** token pattern → the foreign vocabulary it detects. */
const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  { name: 'plugin-namespace skill dispatch', pattern: /git-span:(git-span|reconcile|hook-effect-analysis)/ },
  { name: 'opencode $-prefixed skill dispatch', pattern: /\$git-span/ },
  { name: 'Claude Agent-tool XML dispatch', pattern: /<invoke name=/ },
  { name: 'Claude/opencode subagent_type dispatch', pattern: /subagent_type/ },
  { name: 'Codex spawn_agent dispatch', pattern: /spawn_agent/ },
  { name: 'Codex fork_turns dispatch', pattern: /fork_turns/ },
  { name: 'bare Claude Read tool name', pattern: /`Read`/ },
  { name: 'Claude home path', pattern: /~\/\.claude/ },
  { name: 'Claude plugin-manifest dir', pattern: /\.claude-plugin/ },
  { name: 'Claude hooks log env var', pattern: /CLAUDE_CODE_HOOKS_LOG_FILE/ },
  { name: 'Codex hooks log env var', pattern: /CODEX_HOOKS_LOG_FILE/ },
  { name: 'sibling-tree script path', pattern: /plugins-(claude|codex|opencode)\// },
  { name: 'advisor-host enumeration missing Antigravity', pattern: /Claude Code, Codex, (or |and )?OpenCode(?!, )/ }
];

/**
 * Files where a token is sanctioned, with the reason. Keyed by path relative
 * to the skills root; values map forbidden-token names to why they are
 * correct there. Anything not listed must be completely clean.
 */
const ALLOWED: Record<string, Record<string, string>> = {
  'hook-effect-analysis/SKILL.md': {
    'Claude home path':
      'names the transcript corpus the pipeline analyzes as DATA (`~/.claude/projects/**/*.jsonl`); the SKILL.md host-scope note states this host records no such transcripts'
  },
  'hook-effect-analysis/references/transcript-record-shape.md': {
    'Claude home path':
      'documents the record shape of the MEASURED transcript corpus (data vocabulary), not paths on this host',
    'bare Claude Read tool name':
      'documents tool_use record names inside the measured corpus (data vocabulary), not instructions to the running agent'
  },
  'hook-effect-analysis/scripts/collect.mjs': {
    'Claude home path': 'the default --root of the corpus the script parses; data plumbing, not host guidance'
  },
  'git-span/scripts/mine.mjs': {
    'Claude plugin-manifest dir':
      'mining heuristic over ANALYZED repositories (skip-list entry and an example pair in a comment); the repos being mined may be Claude plugins regardless of this host'
  }
};

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.name.endsWith('.md') || entry.name.endsWith('.mjs')) yield path;
  }
}

describe('antigravity skill tree — no foreign vocabulary outside data-vocabulary allowlist', () => {
  const files = [...walk(skillsRoot)];
  it('finds the skill files (guard against a moved root silently passing everything)', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith('git-span/SKILL.md'))).toBe(true);
  });

  it('every file is clean except allowlisted tokens in allowlisted files', () => {
    const violations: string[] = [];
    for (const path of files) {
      const rel = path.slice(skillsRoot.length + 1);
      const text = readFileSync(path, 'utf8');
      const allowed = ALLOWED[rel] ?? {};
      for (const { name, pattern } of FORBIDDEN) {
        if (pattern.test(text) && allowed[name] === undefined) {
          violations.push(`${rel}: ${name}`);
        }
      }
      for (const [name] of Object.entries(allowed)) {
        const forbidden = FORBIDDEN.find(({ name: n }) => n === name);
        if (forbidden === undefined) {
          violations.push(`${rel}: allowlist entry "${name}" matches no known token (stale allowlist)`);
        } else if (!forbidden.pattern.test(text)) {
          violations.push(
            `${rel}: allowlist entry "${name}" but its token no longer appears in the file — remove the entry (stale allowlist)`
          );
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('advisor-host enumeration is rendered from the shared glossary and includes this platform', async () => {
    const vocabulary = await import(vocabularyModule);
    const prose: string = vocabulary.advisorHostsProse;
    expect(prose).toContain('Antigravity');
    const ciAndSync = readFileSync(join(skillsRoot, 'git-span', 'references', 'ci-and-sync.md'), 'utf8');
    expect(ciAndSync).toContain(`a hooked ${prose} session`);
  });

  it('positive controls — the antigravity adaptations are actually present', () => {
    const terminal = readFileSync(join(skillsRoot, 'git-span', 'references', 'terminal-statuses.md'), 'utf8');
    expect(terminal).toContain("your host's file-read tool");
    const procedure = readFileSync(join(skillsRoot, 'reconcile', 'references', 'procedure.md'), 'utf8');
    expect(procedure).toContain('Invoke `git-span` only when a topic exceeds');
    const install = readFileSync(join(skillsRoot, 'git-span', 'references', 'install-and-trust.md'), 'utf8');
    expect(install).toContain('agy plugin install');
    expect(install).toContain('`{"decision": "allow"}`');
    const team = readFileSync(join(skillsRoot, 'reconcile', 'references', 'team.md'), 'utf8');
    expect(team).toContain('invoke_subagent');
    const hookEffect = readFileSync(join(skillsRoot, 'hook-effect-analysis', 'SKILL.md'), 'utf8');
    expect(hookEffect).toContain('On this host');
  });
});

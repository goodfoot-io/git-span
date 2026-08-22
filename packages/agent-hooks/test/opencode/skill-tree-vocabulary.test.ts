/**
 * Standing control against mirror-propagation drift (evaluation finding A):
 * the opencode skill tree must not carry twin-only vocabulary — Claude/Codex
 * hook-event names, Claude fork-dispatch syntax, twin log env vars, or
 * `plugins-{claude,codex}` paths — outside the spots pinned as deliberate
 * forks in `.span/git-span/plugin-twin-guidance`.
 *
 * Allowlist entries carry their reason inline. The positive assertions at the
 * bottom keep the control meaningful: if the opencode adaptations were ever
 * reverted wholesale, the allowlist must fail loud, not pass silent.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const skillsRoot = join(process.cwd(), '..', '..', 'plugins-opencode', 'git-span', 'skills');

/** token pattern → the twin-only vocabulary it detects. */
const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  { name: 'Claude PostToolUse event', pattern: /\bPostToolUse\b/ },
  { name: 'Claude PreToolUse event', pattern: /\bPreToolUse\b/ },
  { name: 'Codex spawn_agent dispatch', pattern: /spawn_agent/ },
  { name: 'Codex fork_turns dispatch', pattern: /fork_turns/ },
  { name: 'Claude Agent-tool XML dispatch', pattern: /<invoke name="Agent">/ },
  { name: 'fork subagent_type', pattern: /subagent_type["'\s:]+["']?fork["']/ },
  { name: 'Claude hooks log env var', pattern: /CLAUDE_CODE_HOOKS_LOG_FILE/ },
  { name: 'Codex hooks log env var', pattern: /CODEX_HOOKS_LOG_FILE/ },
  { name: 'normative-tree script path', pattern: /plugins-(claude|codex)\// }
];

/**
 * Files where a token is sanctioned, with the reason. Keyed by path relative
 * to the skills root; values map forbidden-token names to why they are
 * correct there. Anything not listed must be completely clean.
 */
const ALLOWED: Record<string, Record<string, string>> = {
  'hook-effect-analysis/references/transcript-record-shape.md': {
    'Claude PostToolUse event':
      'documents the record shape of MEASURED host transcripts (data vocabulary of the corpora this skill analyzes), not instructions to the running agent',
    'Claude PreToolUse event':
      'documents the record shape of MEASURED host transcripts (data vocabulary of the corpora this skill analyzes), not instructions to the running agent'
  },
  'hook-effect-analysis/SKILL.md': {
    'Claude PostToolUse event':
      '--hook selector examples over recorded cross-harness corpora; the selectors name the recorded events, not this host',
    'Claude PreToolUse event':
      '--hook selector examples over recorded cross-harness corpora; the selectors name the recorded events, not this host'
  }
};

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.name.endsWith('.md') || entry.name.endsWith('.mjs')) yield path;
  }
}

describe('opencode skill tree — no twin-only vocabulary outside pinned forks', () => {
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
        if (!FORBIDDEN.some(({ name: n }) => n === name)) {
          violations.push(`${rel}: allowlist entry "${name}" matches no known token (stale allowlist)`);
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('positive controls — the opencode adaptations are actually present', () => {
    const skill = readFileSync(join(skillsRoot, 'git-span', 'SKILL.md'), 'utf8');
    expect(skill).toContain('tool.execute.after');
    expect(skill).toContain('tool.execute.before');
    const team = readFileSync(join(skillsRoot, 'reconcile', 'references', 'team.md'), 'utf8');
    expect(team).toContain('"subagent_type": "general"');
    const install = readFileSync(join(skillsRoot, 'git-span', 'references', 'codex-install-and-trust.md'), 'utf8');
    expect(install).toContain('npx opencode-git-span install');
    expect(install).toContain('"plugin": ["opencode-git-span"]');
  });
});

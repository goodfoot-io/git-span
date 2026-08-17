// @vitest-environment node
/**
 * Protocol suite: the agent-skills discovery index and served skill files,
 * asserted over real HTTP against the booted Worker. The index bytes are
 * compared against the real generated publication (`agentSkillsPublication`
 * — the same import the route loader itself serves from), never a double.
 *
 * @summary Agent-skills discovery surface protocol assertions
 */
import { afterAll, describe, expect, it } from 'vitest';
import { readGateServerInfo } from '~/gate/globalSetup';
import { AGENT_SKILLS_INDEX_PATH } from '~/lib/agent-skills';
import { agentSkillsPublication } from '~/lib/agent-skills.generated';

const { baseUrl } = readGateServerInfo();

/** Every resource this suite promises to verify, independent of what actually ran. */
const EXPECTED_RESOURCES = [AGENT_SKILLS_INDEX_PATH, ...agentSkillsPublication.index.skills.map((skill) => skill.url)];

type Outcome = { total: number; failed: number; firstFailure?: string };

/** Per-resource outcome, keyed by path, filled in as cases run. */
const outcomes = new Map<string, Outcome>();

function outcomeFor(key: string): Outcome {
  const existing = outcomes.get(key);
  if (existing) return existing;
  const created: Outcome = { total: 0, failed: 0 };
  outcomes.set(key, created);
  return created;
}

/** Runs `fn`, recording pass/fail against `key` before rethrowing on failure. */
async function tracked<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const outcome = outcomeFor(key);
  outcome.total += 1;
  try {
    return await fn();
  } catch (error) {
    outcome.failed += 1;
    outcome.firstFailure ??= error instanceof Error ? error.message : String(error);
    throw error;
  }
}

function formatOutcome(key: string): string {
  const outcome = outcomes.get(key);
  if (!outcome) return 'NOT REACHED — case did not record an outcome';
  if (outcome.failed === 0) return `VERIFIED — ${outcome.total} check(s) passed`;
  return `FAIL — ${outcome.failed} of ${outcome.total} check(s) failed; first failure: ${outcome.firstFailure}`;
}

describe(`GET ${AGENT_SKILLS_INDEX_PATH}`, () => {
  it('serves bytes identical to the committed generated index', async () => {
    await tracked(AGENT_SKILLS_INDEX_PATH, async () => {
      const response = await fetch(`${baseUrl}${AGENT_SKILLS_INDEX_PATH}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/json');
      expect(await response.json()).toEqual(agentSkillsPublication.index);
    });
  });
});

describe('GET /.well-known/agent-skills/*', () => {
  it('advertises at least one skill to check', () => {
    expect(agentSkillsPublication.index.skills.length).toBeGreaterThan(0);
  });

  it.each(agentSkillsPublication.index.skills.map((skill) => [skill.url, skill] as const))(
    'serves the skill file advertised at %s',
    async (_url, skill) => {
      await tracked(skill.url, async () => {
        const response = await fetch(`${baseUrl}${skill.url}`);
        expect(response.status, `skill fetch failed for ${skill.url}`).toBe(200);
        const body = await response.text();
        expect(body.length, `skill file is empty for ${skill.url}`).toBeGreaterThan(0);
      });
    }
  );

  it('404s an unknown skill key', async () => {
    const response = await fetch(`${baseUrl}/.well-known/agent-skills/not-a-real-skill/SKILL.md`);
    expect(response.status).toBe(404);
  });

  // Printed on every run, pass or fail — see code-equivalence.test.ts for the
  // rationale. `process.stdout.write`, not `console.log`: vitest swallows
  // test-side `console` output on a passing run.
  afterAll(() => {
    const lines = [`Agent-skills discovery: ${EXPECTED_RESOURCES.length} resource(s) against ${baseUrl}`];
    for (const resource of EXPECTED_RESOURCES) {
      lines.push(`  ${resource}: ${formatOutcome(resource)}`);
    }
    process.stdout.write(`${lines.join('\n')}\n`);
  });
});

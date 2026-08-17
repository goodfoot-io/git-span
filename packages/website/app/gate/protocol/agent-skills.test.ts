// @vitest-environment node
/**
 * Protocol suite: the agent-skills discovery index and served skill files,
 * asserted over real HTTP against the booted Worker. The index bytes are
 * compared against the real generated publication (`agentSkillsPublication`
 * — the same import the route loader itself serves from), never a double.
 *
 * @summary Agent-skills discovery surface protocol assertions
 */
import { describe, expect, it } from 'vitest';
import { readGateServerInfo } from '~/gate/globalSetup';
import { AGENT_SKILLS_INDEX_PATH } from '~/lib/agent-skills';
import { agentSkillsPublication } from '~/lib/agent-skills.generated';

const { baseUrl } = readGateServerInfo();

describe(`GET ${AGENT_SKILLS_INDEX_PATH}`, () => {
  it('serves bytes identical to the committed generated index', async () => {
    const response = await fetch(`${baseUrl}${AGENT_SKILLS_INDEX_PATH}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(await response.json()).toEqual(agentSkillsPublication.index);
  });
});

describe('GET /.well-known/agent-skills/*', () => {
  it('advertises at least one skill to check', () => {
    expect(agentSkillsPublication.index.skills.length).toBeGreaterThan(0);
  });

  it.each(agentSkillsPublication.index.skills.map((skill) => [skill.url, skill] as const))(
    'serves the skill file advertised at %s',
    async (_url, skill) => {
      const response = await fetch(`${baseUrl}${skill.url}`);
      expect(response.status, `skill fetch failed for ${skill.url}`).toBe(200);
      const body = await response.text();
      expect(body.length, `skill file is empty for ${skill.url}`).toBeGreaterThan(0);
    }
  );

  it('404s an unknown skill key', async () => {
    const response = await fetch(`${baseUrl}/.well-known/agent-skills/not-a-real-skill/SKILL.md`);
    expect(response.status).toBe(404);
  });
});

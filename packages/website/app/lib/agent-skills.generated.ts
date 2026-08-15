/**
 * Build-generated: the agent-skills publication emitted by
 * `scripts/generate-agent-skills.mjs` from the normative Claude plugin skill
 * tree. Never edit by hand — the contract suite fails when this file differs
 * from a fresh generator run.
 *
 * Not Implemented — TDD bootstrap stub: an empty publication until the
 * generator's first run.
 */
import type { AgentSkillsPublication } from './agent-skills';

// Annotated explicitly rather than via `satisfies`: `satisfies` would narrow
// the literal to `skills: never[]` / `files: {}` and break string indexing in
// consumers — the annotation keeps the runtime literal while widening the
// declared type.
export const agentSkillsPublication: AgentSkillsPublication = {
  index: { $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json', skills: [] },
  files: {}
};

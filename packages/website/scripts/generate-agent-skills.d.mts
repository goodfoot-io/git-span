/**
 * Type declaration for the agent-skills generator script, so the contract
 * suite's staleness assertion can import `buildPublication` from
 * `generate-agent-skills.mjs` under `moduleResolution: "Bundler"`.
 */
import type { AgentSkillsPublication } from '../app/lib/agent-skills';

/** Pure mapping: plugin skill tree → publication object. Never writes. */
export function buildPublication(skillsRoot: string): AgentSkillsPublication;

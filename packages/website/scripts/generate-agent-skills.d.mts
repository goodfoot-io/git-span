/**
 * Type declaration for the agent-skills generator script, so the contract
 * suite's staleness assertion can import `buildPublication` from
 * `generate-agent-skills.mjs` under `moduleResolution: "Bundler"`.
 */
import type { AgentSkillsPublication } from '../app/lib/agent-skills';

/** Pure mapping: plugin skill tree → publication object. Never writes. */
export function buildPublication(skillsRoot: string): AgentSkillsPublication;

/** The default tree root: the repo-root plugin skill tree the generator's only input. */
export const defaultSkillsRoot: string;

/**
 * Emit the generated artifact as biome-formatted TypeScript at `outPath`
 * (default: the committed artifact location). Parameterized so the umbrella
 * artifact gate can emit into a temporary directory and byte-compare.
 */
export function emit(publication: AgentSkillsPublication, outPath?: string): void;

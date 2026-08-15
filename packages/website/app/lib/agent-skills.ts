/**
 * The agent-skills discovery surface: the Cloudflare Agent Skills draft v0.2.0
 * index document shape, the stable publication constants, and the resolver
 * that maps a request path to the served skill bytes.
 *
 * One module owns the shape because three surfaces share it — the build-time
 * generator emits `agent-skills.generated.ts` against these interfaces, the
 * index and file resource routes serve from it, and the discovery finalizer
 * appends the index link constant — so the generated artifact, the routes,
 * and the header advertisement cannot disagree about the contract.
 *
 * @summary Agent-skills index shape, Link constant, and file resolver
 */

/** One index entry per the Cloudflare Agent Skills draft v0.2.0: enough for an
 * agent to decide whether to fetch the body, and nothing more. */
export interface AgentSkillEntry {
  name: string;
  type: 'skill-md';
  description: string;
  url: string;
  digest: string;
}

/** The index document served at `/.well-known/agent-skills/index.json`. */
export interface AgentSkillsIndex {
  $schema: string;
  skills: AgentSkillEntry[];
}

/** One served file under `/.well-known/agent-skills/`: its content and the
 * exact `Content-Type` it serves with. */
export interface AgentSkillsFile {
  content: string;
  contentType: string;
}

/** The build-generated publication: the index document plus every served
 * file keyed by its path relative to `/.well-known/agent-skills/`. */
export interface AgentSkillsPublication {
  index: AgentSkillsIndex;
  files: Record<string, AgentSkillsFile>;
}

/** The index URL an agent points itself at. */
export const AGENT_SKILLS_INDEX_PATH = '/.well-known/agent-skills/index.json';

/** The RFC 8288 link-value advertising the index on every response. The draft
 * defines no discovery relation; `rel="agent-skills"` mirrors the reference
 * implementation's `rel="api-catalog"` convention. */
export const AGENT_SKILLS_LINK = '</.well-known/agent-skills/index.json>; rel="agent-skills"';

/**
 * Resolve a served-file path — relative to `/.well-known/agent-skills/` — to
 * its content, or null when the publication does not carry it. Lookup is
 * exact, so an unknown path 404s fail-closed and traversal is structurally
 * impossible.
 *
 * @param pathname - The path segment below the well-known prefix.
 * @summary The published file at a path, or null
 */
export function resolveAgentSkillsFile(_pathname: string): AgentSkillsFile | null {
  throw new Error('Not Implemented');
}

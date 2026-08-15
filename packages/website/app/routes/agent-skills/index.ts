/**
 * Resource route: the agent-skills discovery index at
 * `/.well-known/agent-skills/index.json` — the Cloudflare Agent Skills draft
 * v0.2.0 routing table an agent reads to decide which SKILL.md to fetch.
 *
 * Not Implemented — TDD bootstrap stub: the loader throws until the
 * generated publication is wired in.
 *
 * @summary Agent-skills index resource route
 */
import type { LoaderFunctionArgs } from 'react-router';

export function loader(_args: LoaderFunctionArgs): Response {
  throw new Error('Not Implemented');
}

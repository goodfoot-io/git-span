/**
 * Resource route: the agent-skills discovery index at
 * `/.well-known/agent-skills/index.json` — the Cloudflare Agent Skills draft
 * v0.2.0 routing table an agent reads to decide which SKILL.md to fetch.
 *
 * The document is the build-generated artifact served verbatim: its URLs are
 * path-absolute, so the same bytes are origin-correct in dev, preview, and
 * production without baking an origin in at generation time. The body is
 * nulled on HEAD explicitly — react-router runs resource-route loaders for
 * HEAD but returns the body verbatim — so the draft's GET+HEAD mandate holds
 * regardless of how the runtime strips bodies.
 *
 * @summary Agent-skills index resource route
 */
import type { LoaderFunctionArgs } from 'react-router';
import { agentSkillsPublication } from '~/lib/agent-skills.generated';

const CONTENT_TYPE = 'application/json';

export function loader({ request }: LoaderFunctionArgs): Response {
  const body = JSON.stringify(agentSkillsPublication.index);
  return new Response(request.method === 'HEAD' ? null : body, {
    headers: { 'Content-Type': CONTENT_TYPE }
  });
}

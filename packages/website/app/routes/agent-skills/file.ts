/**
 * Resource route: served skill files under `/.well-known/agent-skills/*` —
 * the SKILL.md bodies, references, and scripts of the published product
 * skills, byte-identical to the normative Claude plugin tree.
 *
 * Lookup is exact against the generated file map: an unknown path throws a
 * 404 Response, and traversal is structurally impossible because every key
 * is a path the generator walked inside the tree. The body is nulled on
 * HEAD explicitly, mirroring the index route and `markdownResponse`.
 *
 * This module imports the build-generated publication directly, rather than
 * through `lib/agent-skills`, so the lib module stays import-free and the
 * publication never reaches the client bundle.
 *
 * @summary Agent-skills file resource route
 */
import type { LoaderFunctionArgs } from 'react-router';
import { agentSkillsPublication } from '~/lib/agent-skills.generated';

export function loader({ params, request }: LoaderFunctionArgs): Response {
  const pathname = params['*'] ?? '';
  const file = agentSkillsPublication.files[pathname] ?? null;
  if (file === null) {
    throw new Response(`No agent-skills file at /${pathname}`, { status: 404 });
  }
  return new Response(request.method === 'HEAD' ? null : file.content, {
    headers: { 'Content-Type': file.contentType }
  });
}

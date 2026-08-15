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
 * @summary Agent-skills file resource route
 */
import type { LoaderFunctionArgs } from 'react-router';
import { resolveAgentSkillsFile } from '~/lib/agent-skills';

export function loader({ params, request }: LoaderFunctionArgs): Response {
  const pathname = params['*'] ?? '';
  const file = resolveAgentSkillsFile(pathname);
  if (file === null) {
    throw new Response(`No agent-skills file at /${pathname}`, { status: 404 });
  }
  return new Response(request.method === 'HEAD' ? null : file.content, {
    headers: { 'Content-Type': file.contentType }
  });
}

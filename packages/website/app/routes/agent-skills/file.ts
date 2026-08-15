/**
 * Resource route: served skill files under `/.well-known/agent-skills/*` —
 * the SKILL.md bodies, references, and scripts of the published product
 * skills, byte-identical to the normative Claude plugin tree.
 *
 * Not Implemented — TDD bootstrap stub: the loader throws until the
 * generated publication is wired in.
 *
 * @summary Agent-skills file resource route
 */
import type { LoaderFunctionArgs } from 'react-router';

export function loader(_args: LoaderFunctionArgs): Response {
  throw new Error('Not Implemented');
}

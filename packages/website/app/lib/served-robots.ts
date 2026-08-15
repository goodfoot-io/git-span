/**
 * Served-content contract for `https://git-span.com/robots.txt` (card main-257).
 *
 * The repository publishes the policy in `public/robots.txt`, but the bytes the
 * edge actually serves are the destination — Cloudflare's managed robots.txt
 * placeholder (an all-comments Content Signals preamble that names no crawler)
 * satisfies any naive "returns 200" check while carrying no policy at all.
 * `servedRobotsViolations` classifies a served body against the settled
 * contract: the `GPTBot` stanza is the sentinel that the file is ours rather
 * than Cloudflare's, and the `Sitemap:` line is the link to the generated
 * sitemap. Pure and parameterized so the classification is testable without
 * network access or a module import.
 */

export interface ServedRobotsContract {
  /** The canonical sitemap URL the served policy must point at. */
  sitemapUrl: string;
}

const GPTBOT_STANZA = 'User-agent: GPTBot\nAllow: /';

/** Returns a violation per contract line the served body fails to carry. */
export function servedRobotsViolations(body: string, contract: ServedRobotsContract): string[] {
  const violations: string[] = [];
  if (!body.includes(GPTBOT_STANZA)) {
    violations.push(`missing 'User-agent: GPTBot' stanza with 'Allow: /'`);
  }
  if (!body.includes(`Sitemap: ${contract.sitemapUrl}`)) {
    violations.push(`missing 'Sitemap: ${contract.sitemapUrl}' line`);
  }
  return violations;
}

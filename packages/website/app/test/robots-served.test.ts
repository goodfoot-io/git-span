// Live served-content check for /robots.txt (card main-257). The destination
// is the bytes the edge serves, not the deployed asset: Cloudflare's managed
// robots.txt answers GET with an all-comments placeholder and HEAD with 404,
// which is exactly the silent regression this check exists to catch.
//
// SKIPPED until the operator disables Cloudflare's managed robots.txt on the
// git-span.com zone (AI Crawl Control -> Managed robots.txt). The card's
// sequencing constraint: "The zone change is manual and must land before the
// assertion is enabled, or the check fails against production on its first
// run." Enablement is a one-line change — drop the `.skip` — coordinated with
// the operator, after verifying the zone now serves the repository policy.
//
// main-255 handoff: this file is live-network and must be collected in an
// isolated deploy-gate config excluded from the hermetic protocol suite
// (reference-implementation lesson f23ae27).
import { describe, expect, it } from 'vitest';
import { SITE_URL } from '~/lib/meta';
import { servedRobotsViolations } from '~/lib/served-robots';

const robotsUrl = `${SITE_URL}/robots.txt`;

describe.skip('served robots.txt at the edge', () => {
  it('serves the repository policy with HEAD and GET agreeing', async () => {
    const [get, head] = await Promise.all([fetch(robotsUrl), fetch(robotsUrl, { method: 'HEAD' })]);
    expect(get.status).toBe(200);
    expect(head.status).toBe(get.status);
    const body = await get.text();
    expect(servedRobotsViolations(body, { sitemapUrl: `${SITE_URL}/sitemap.xml` })).toEqual([]);
  });
});

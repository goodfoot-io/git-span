// @vitest-environment node
/**
 * Phase F's live Lighthouse gate: one test, `runAgenticGate()`, against the
 * real built Worker booted by [globalSetup.ts](./globalSetup.ts). Targets are
 * `/` plus every real Fumadocs page (`source.getPages()` — the real
 * generated collection, never a double), so a page that regresses below the
 * pinned Agentic Browsing threshold fails this suite.
 *
 * @summary Live Lighthouse Agentic Browsing gate against every public page
 */
import { expect, test } from 'vitest';
import { readGateServerInfo } from '~/gate/globalSetup';
import { runAgenticGate } from '~/gate/run';
import { source } from '~/lib/source';

test('every public page clears the Agentic Browsing gate', async () => {
  const { baseUrl } = readGateServerInfo();
  const pages = source.getPages();

  const targets = [`${baseUrl}/`, ...pages.map((page) => `${baseUrl}${page.url}`)];

  // An empty target list must fail the gate, not silently pass it.
  expect(targets.length).toBeGreaterThan(0);

  await runAgenticGate(targets);
}, 600_000);

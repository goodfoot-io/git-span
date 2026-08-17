// @vitest-environment node
/**
 * Protocol suite: the published `/schemas/cli/v1/*.json` files, asserted
 * over real HTTP against the booted Worker — content type, sha256 versus
 * the committed manifest, and `$id` self-resolution.
 *
 * @summary Published CLI JSON Schema protocol assertions
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readGateServerInfo } from '~/gate/globalSetup';
import { SITE_URL } from '~/lib/meta';

const { baseUrl } = readGateServerInfo();
const SCHEMAS_DIR = path.join(process.cwd(), 'public/schemas/cli/v1');

const manifest = new Map(
  readFileSync(path.join(SCHEMAS_DIR, 'sha256-manifest.txt'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => {
      const [hash, filename] = line.trim().split(/\s+/);
      return [filename, hash] as const;
    })
);

/** Every resource this suite promises to verify, independent of what actually ran. */
const EXPECTED_RESOURCES = [...manifest.keys()];

/** Per-resource outcome, keyed by filename, filled in as cases run. */
const outcomes = new Map<string, string>();

describe('published CLI JSON Schemas', () => {
  it('has a manifest listing schemas to check', () => {
    expect(manifest.size).toBeGreaterThan(0);
  });

  it.each(EXPECTED_RESOURCES)('GET /schemas/cli/v1/%s', async (filename) => {
    const urlPath = `/schemas/cli/v1/${filename}`;
    outcomes.set(filename, `FAIL — did not complete verification of ${urlPath}`);

    const response = await fetch(`${baseUrl}${urlPath}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');

    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = createHash('sha256').update(bytes).digest('hex');
    expect(digest, `${filename}: served bytes do not match sha256-manifest.txt`).toBe(manifest.get(filename));

    const body = JSON.parse(bytes.toString('utf8')) as { $id: string };
    const expectedId = `${SITE_URL}${urlPath}`;
    expect(body.$id).toBe(expectedId);

    const idResponse = await fetch(body.$id.replace(SITE_URL, baseUrl));
    expect(idResponse.status).toBe(200);
    const idBytes = Buffer.from(await idResponse.arrayBuffer());
    expect(Buffer.compare(idBytes, bytes), `${filename}: $id does not resolve to identical bytes`).toBe(0);

    outcomes.set(filename, `VERIFIED — sha256 matches manifest, $id resolves to identical bytes`);
  });

  // Printed on every run, pass or fail — see code-equivalence.test.ts for the
  // rationale. `process.stdout.write`, not `console.log`: vitest swallows
  // test-side `console` output on a passing run.
  afterAll(() => {
    const lines = [`Published CLI JSON Schemas: ${EXPECTED_RESOURCES.length} resource(s) against ${baseUrl}`];
    for (const filename of EXPECTED_RESOURCES) {
      lines.push(
        `  /schemas/cli/v1/${filename}: ${outcomes.get(filename) ?? 'NOT REACHED — case did not record an outcome'}`
      );
    }
    process.stdout.write(`${lines.join('\n')}\n`);
  });
});

/**
 * The declared inventory of every agent-facing artifact git-span.com
 * publishes: what it is, which human-authored source it derives from, which
 * generator or renderer produces it, which gate checks it, and which command
 * fixes it when stale.
 *
 * This file is the single audit point for the umbrella drift gate. Adding an
 * agent-facing representation is one entry here; deleting one without
 * removing its entry fails the meta-gates. The list is consumed by the gate
 * logic ([`gate.mjs`](./gate.mjs)), the CLI wrapper
 * (`scripts/generate-artifacts.mjs`), and the meta-gate test suite
 * ([`artifact-gate.test.ts`](./artifact-gate.test.ts)).
 *
 * Entries are plain `.mjs` data with JSDoc types: the CLI wrapper runs under
 * plain node, which cannot load `.ts`.
 */
import path from 'node:path';
import { buildPublication, emit } from '../../../scripts/generate-agent-skills.mjs';

/**
 * @typedef {'committed-generated' | 'committed-authored' | 'runtime'} ArtifactKind
 *
 * @typedef {{
 *   path: string,
 *   label: string,
 *   kind: ArtifactKind,
 *   source: string,
 *   generator: string,
 *   generatorFiles: string[],
 *   check: string,
 *   fixCommand: string | null,
 *   banner: string | null,
 *   bannerJustification: string | null,
 *   render: ((options: {toDir: string, skillsRoot: string}) => void) | null,
 * }} ArtifactEntry
 */

/** @type {ArtifactEntry[]} */
export const artifacts = [
  {
    path: '/docs/<slug>.md and /index.md',
    label: 'per-page Markdown alternates',
    kind: 'runtime',
    source:
      'content/docs/*.mdx via Fumadocs processed markdown (source.config.ts includeProcessedMarkdown) plus the homepage copy records',
    generator: 'the get-llm-text, content-negotiation, and homepage-markdown renderers, served by the worker arms',
    generatorFiles: [
      'app/lib/get-llm-text.ts',
      'app/lib/content-negotiation.ts',
      'app/lib/homepage-markdown.ts',
      'app/worker.ts'
    ],
    check:
      'app/lib/content-negotiation.test.ts, app/worker.test.ts, app/lib/get-llm-text.test.ts, app/lib/homepage-markdown.test.ts (website yarn test)',
    fixCommand: null,
    banner: null,
    bannerJustification: 'Nothing committed to banner — derived at request time from the declared source.',
    render: null
  },
  {
    path: '/llms.txt',
    label: 'the root llms.txt system map',
    kind: 'committed-authored',
    source: 'the hand-authored policy text in app/routes/llms.txt.ts',
    generator: 'none — hand-authored',
    generatorFiles: ['app/routes/llms.txt.ts'],
    check: 'app/lib/llms-resources.test.ts shape and link-resolvability pins (website yarn test)',
    fixCommand: null,
    banner: null,
    bannerJustification: 'Hand-authored policy file, not generated output.',
    render: null
  },
  {
    path: '/docs/llms.txt',
    label: 'the docs-scope llms.txt index',
    kind: 'runtime',
    source: 'the content/docs tree plus meta.json authored order',
    generator:
      'llms(source).index() with withMdLinks in app/lib/llms-resources.ts, served by app/routes/docs.llms.txt.ts',
    generatorFiles: ['app/lib/llms-resources.ts', 'app/routes/docs.llms.txt.ts'],
    check: 'app/lib/llms-resources.test.ts live-equality and authored-order pins (website yarn test)',
    fixCommand: null,
    banner: null,
    bannerJustification: 'Nothing committed to banner — derived at request time from the declared source.',
    render: null
  },
  {
    path: '/docs/llms-full.txt and /llms-full.txt',
    label: 'the two llms-full corpora',
    kind: 'runtime',
    source: 'the homepage copy records plus the docs corpus in authored order',
    generator:
      'the one shared corpus generator in app/lib/llms-resources.ts (renderDocsCorpus) and renderHomepageMarkdown, served by the two full-text routes',
    generatorFiles: [
      'app/lib/llms-resources.ts',
      'app/lib/homepage-markdown.ts',
      'app/routes/docs.llms-full.txt.ts',
      'app/routes/llms-full.txt.ts'
    ],
    check: 'app/lib/llms-resources.test.ts composition and one-generator contract pins (website yarn test)',
    fixCommand: null,
    banner: null,
    bannerJustification: 'Nothing committed to banner — derived at request time from the declared source.',
    render: null
  },
  {
    path: '/sitemap.xml',
    label: 'the sitemap',
    kind: 'runtime',
    source: 'app/lib/indexable-routes.ts plus source.getPages()',
    generator: 'renderSitemap in app/lib/sitemap.ts, served by app/routes/sitemap.xml.ts',
    generatorFiles: ['app/lib/sitemap.ts', 'app/routes/sitemap.xml.ts', 'app/lib/indexable-routes.ts'],
    check: 'app/routes/sitemap.test.ts and app/lib/sitemap.test.ts pinned loc-set checks (website yarn test)',
    fixCommand: null,
    banner: null,
    bannerJustification: 'Nothing committed to banner — derived at request time from the declared source.',
    render: null
  },
  {
    path: 'public/robots.txt',
    label: 'robots.txt',
    kind: 'committed-authored',
    source: 'the settled crawler policy (main-249); the Sitemap line derives from SITE_URL',
    generator: 'none — hand-authored policy file',
    generatorFiles: ['public/robots.txt'],
    check:
      'app/lib/served-robots.test.ts fixture suite; the live check in app/test/robots-served.test.ts is skipped pending the main-257 operator action (website yarn test)',
    fixCommand: null,
    banner: null,
    bannerJustification: 'Hand-authored policy file, not generated output.',
    render: null
  },
  {
    path: 'app/lib/agent-skills.generated.ts',
    label: 'app/lib/agent-skills.generated.ts',
    kind: 'committed-generated',
    source: 'plugins-claude/git-span/skills (the normative twin per .span/git-span/plugin-twin-guidance)',
    generator: 'scripts/generate-agent-skills.mjs (buildPublication + emit)',
    generatorFiles: ['scripts/generate-agent-skills.mjs'],
    check:
      'the umbrella --check (yarn artifacts:check) plus app/routes/agent-skills.test.ts byte-identity (website yarn test)',
    fixCommand: 'yarn workspace @goodfoot/git-span-website generate:artifacts',
    banner: 'GENERATED by packages/website/scripts/generate-agent-skills.mjs',
    bannerJustification: null,
    render: ({ toDir, skillsRoot }) =>
      emit(buildPublication(skillsRoot), path.join(toDir, 'app/lib/agent-skills.generated.ts'))
  },
  {
    path: '/.well-known/agent-skills/index.json and /.well-known/agent-skills/*',
    label: 'the Agent Skills discovery index and skill payloads',
    kind: 'runtime',
    source: 'app/lib/agent-skills.generated.ts, derived from plugins-claude/git-span/skills',
    generator: 'the agent-skills index and file route loaders',
    generatorFiles: ['app/routes/agent-skills/index.ts', 'app/routes/agent-skills/file.ts'],
    check: 'app/routes/agent-skills.test.ts route, byte-identity, digest, content-type, and fail-closed pins',
    fixCommand: null,
    banner: null,
    bannerJustification: 'Nothing committed at the public URLs — route loaders serve the generated publication.',
    render: null
  },
  {
    path: 'content/docs/commands.mdx',
    label: 'content/docs/commands.mdx',
    kind: 'committed-generated',
    source: 'the clap tree in packages/git-span/src/cli',
    generator: 'gen-schemas (packages/git-span/src/schemas/mod.rs commands_mdx)',
    generatorFiles: ['../git-span/src/schemas/mod.rs', '../git-span/src/bin/gen-schemas.rs'],
    check: 'gen-schemas --check chained ahead of nextest in the git-span yarn test script',
    fixCommand: 'yarn workspace git-span build:schemas',
    banner: 'GENERATED by gen-schemas',
    bannerJustification: null,
    render: null
  },
  {
    path: 'public/schemas/cli/v1/*.json',
    label: 'the published v1 CLI JSON Schemas',
    kind: 'committed-generated',
    source: 'the --format json document types in packages/git-span/src',
    generator: 'gen-schemas (packages/git-span/src/schemas/mod.rs artifacts)',
    generatorFiles: ['../git-span/src/schemas/mod.rs', '../git-span/src/bin/gen-schemas.rs'],
    check: 'gen-schemas --check plus the schema_immutability.rs manifest gate, both in the git-span yarn test script',
    fixCommand: 'yarn workspace git-span build:schemas',
    banner: null,
    bannerJustification:
      'JSON cannot carry comments; the $id is the identity and public/schemas/cli/v1/sha256-manifest.txt pins the v1 bytes immutably.',
    render: null
  },
  {
    path: 'HTTP Link headers on every non-redirect response',
    label: 'the discovery Link headers',
    kind: 'runtime',
    source: 'the route classifier plus the DOC_SLUGS glob over content/docs',
    generator: 'applyDiscoveryHeaders in app/lib/discovery-links.ts, mounted as the worker finalizer',
    generatorFiles: ['app/lib/discovery-links.ts', 'app/root.tsx', 'app/worker.ts'],
    check: 'app/lib/discovery-links.test.ts (website yarn test)',
    fixCommand: null,
    banner: null,
    bannerJustification: 'Nothing committed to banner — derived at request time from the declared source.',
    render: null
  }
];

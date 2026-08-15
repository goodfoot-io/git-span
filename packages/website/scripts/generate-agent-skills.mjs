#!/usr/bin/env node

/**
 * Build-time generator for the agent-skills discovery surface: reads the
 * normative Claude plugin skill tree (`plugins-claude/git-span/skills`) and
 * emits `app/lib/agent-skills.generated.ts` — the Cloudflare Agent Skills
 * draft v0.2.0 index document plus every served skill file, byte-identical
 * to the tree.
 *
 * The tree is the normative source because `.span/git-span/plugin-twin-guidance`
 * names the Claude plugin tree authoritative for the published guidance; that
 * dependency is anchored by the `.span/git-span/agent-skills-publication`
 * span, so retargeting the twins without updating this generator surfaces as
 * drift.
 *
 * Chained into the package's `dev` and `build` scripts so deploys and tunnel
 * previews always regenerate; deliberately not in `test`/`typecheck` — the
 * contract suite compares the committed artifact against a fresh
 * `buildPublication` run, so a plugin-tree edit without regeneration fails
 * the suite instead of being silently refreshed.
 *
 * The draft-field mapping lives in exactly one production place: the
 * `skillEntry` construction below. A draft revision re-points this mapping
 * plus the contract-test pins, nothing else.
 *
 * The emitted file is formatted with the workspace's biome binary before
 * writing, so `yarn lint` and the pre-commit hook are no-ops on it — the
 * staleness check compares raw bytes, and a lint rewrite of a drift-free
 * artifact would fail it. Biome is invoked through Yarn: the node-modules
 * linker hoists it to the workspace root, so the package-level `.bin` never
 * carries it and `yarn biome` resolves it in every install layout, exactly
 * as the package's `lint` script does.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The draft v0.2.0 index schema identifier — the opaque URI the draft pins. */
const DRAFT_SCHEMA = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';

/** The well-known prefix the index and served files live under. */
const INDEX_PREFIX = '/.well-known/agent-skills';

/** The package root (`packages/website`) — this script lives in `scripts/`. */
const packageRoot = fileURLToPath(new URL('..', import.meta.url));

/** The default tree root: the repo-root plugin skill tree the generator's
 * only input. `scripts/` → three levels up. */
const defaultSkillsRoot = fileURLToPath(new URL('../../../plugins-claude/git-span/skills', import.meta.url));

/**
 * Read a tree file as UTF-8, failing closed on bytes that are not: serving a
 * lossily decoded string would corrupt the wire while the digest certified
 * the corruption, because every comparison in the pipeline is over the
 * decoded text. Verifying the round-trip keeps the served bytes and the
 * digest identical to the tree bytes by construction.
 */
function readTextFile(filePath) {
  const bytes = readFileSync(filePath);
  const text = bytes.toString('utf8');
  if (Buffer.compare(bytes, Buffer.from(text, 'utf8')) !== 0) {
    throw new Error(`${filePath} is not valid UTF-8; skill tree files must be valid UTF-8 to serve byte-identically`);
  }
  return text;
}

/**
 * The single name/description pair a SKILL.md frontmatter must carry — a
 * minimal `---`-block parse; the descriptions are single-line scalars today,
 * and the contract suite pins the parse against the live tree. YAML block
 * scalars (`description: |`) are rejected fail-closed: the one-line regex
 * would capture the indicator character itself and publish a description
 * that exists nowhere in the tree.
 */
function readFrontmatter(skillMdPath) {
  const markdown = readTextFile(skillMdPath);
  const match = /^---\n([\s\S]*?)\n---/.exec(markdown);
  if (!match) throw new Error(`no frontmatter block in ${skillMdPath}`);
  const name = /^name:\s*(.+)$/m.exec(match[1])?.[1];
  const description = /^description:\s*(.+)$/m.exec(match[1])?.[1];
  for (const [field, value] of [['name', name], ['description', description]]) {
    if (value === undefined || /^[|>]/.test(value)) {
      throw new Error(`frontmatter ${field} in ${skillMdPath} must be a single-line scalar`);
    }
  }
  return { name, description };
}

/** Every file under a directory, as absolute paths — the whole skill body:
 * SKILL.md, references/*.md, and scripts/*.mjs. */
function* walkFiles(root, dir = root) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(root, absolute);
    else yield absolute;
  }
}

/** The Content-Type a served file carries: Markdown as Markdown, scripts as
 * inert plain text — the draft tells clients not to execute by default. */
function contentTypeFor(servedPath) {
  return servedPath.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8';
}

/** SHA-256 over the utf-8 bytes of a served file, as the draft formats it. */
function digestOf(content) {
  return `sha256:${createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex')}`;
}

/**
 * Pure mapping: plugin skill tree → publication object. Imported by the
 * contract suite for the staleness assertion; must never write.
 *
 * @param skillsRoot - Absolute path to the plugin skill tree root.
 */
export function buildPublication(skillsRoot) {
  const names = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const files = {};
  const skills = names.map((name) => {
    for (const filePath of walkFiles(path.join(skillsRoot, name))) {
      const servedPath = path.relative(skillsRoot, filePath).split(path.sep).join('/');
      files[servedPath] = {
        content: readTextFile(filePath),
        contentType: contentTypeFor(servedPath)
      };
    }
    // The draft-field mapping: metadata to name/type/description/url/digest.
    // This construction is the one place a draft revision re-points.
    const { description } = readFrontmatter(path.join(skillsRoot, name, 'SKILL.md'));
    return {
      name,
      type: 'skill-md',
      description,
      url: `${INDEX_PREFIX}/${name}/SKILL.md`,
      digest: digestOf(files[`${name}/SKILL.md`].content)
    };
  });
  return { index: { $schema: DRAFT_SCHEMA, skills }, files };
}

/**
 * Run biome against the emitted artifact so its bytes are stable under every
 * later lint pass. Spawned as `yarn biome` — never through `npm_execpath`,
 * which Yarn sets to a shell wrapper that node cannot run — so the binary
 * resolves the way `yarn lint` does, whatever the install layout. Windows
 * resolves the shim name (`yarn.cmd`) because execFile cannot spawn `.cmd`
 * wrappers without a shell.
 */
function formatWithBiome(outPath) {
  const yarnCommand = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
  execFileSync(yarnCommand, ['biome', 'check', '--write', '--unsafe', outPath], { cwd: packageRoot, stdio: 'inherit' });
}

/**
 * Emit the generated artifact as TypeScript, biome-formatted so every later
 * lint or pre-commit pass leaves its bytes untouched.
 */
function emit(publication) {
  const outPath = path.join(packageRoot, 'app/lib/agent-skills.generated.ts');
  const json = JSON.stringify(publication, null, 2);
  const source = `/**
 * Build-generated: the agent-skills publication emitted by
 * \`scripts/generate-agent-skills.mjs\` from the normative Claude plugin skill
 * tree. Never edit by hand — the contract suite fails when this file differs
 * from a fresh generator run.
 */
import type { AgentSkillsPublication } from './agent-skills';

export const agentSkillsPublication: AgentSkillsPublication = ${json};
`;
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, source);
  formatWithBiome(outPath);
}

// The direct-invocation guard compares realpaths, not URL strings: on
// case-insensitive filesystems two spellings of one path must still compare
// equal, and a symlinked invocation is the same script.
const invokedDirectly = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  emit(buildPublication(defaultSkillsRoot));
}

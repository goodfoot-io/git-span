// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type LoaderFunctionArgs, matchRoutes, type RouteObject } from 'react-router';
import { describe, expect, it } from 'vitest';
import { buildPublication } from '../../scripts/generate-agent-skills.mjs';
import { loader as fileLoader } from './agent-skills/file';
import { loader as indexLoader } from './agent-skills/index';
import { AGENT_SKILLS_INDEX_PATH } from '~/lib/agent-skills';
import { agentSkillsPublication } from '~/lib/agent-skills.generated';
import routes from '~/routes';

// The generator's input: the normative Claude plugin skill tree, four levels
// above this file. Resolved from import.meta.url — never cwd — because yarn
// runs package scripts with cwd = packages/website.
const skillsRoot = fileURLToPath(new URL('../../../../plugins-claude/git-span/skills', import.meta.url));
const liveSkillDirs = readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

function readFrontmatterDescription(skillDir: string): string {
  const markdown = readFileSync(path.join(skillsRoot, skillDir, 'SKILL.md'), 'utf8');
  const description = /^description:\s*(.+)$/m.exec(markdown)?.[1];
  if (description === undefined) throw new Error(`no frontmatter description in ${skillDir}/SKILL.md`);
  return description;
}

/** Every file under one skill directory, as plugin-tree-relative paths with
 * `/` separators — the generator's map keys normalize `path.sep`, so the
 * walker must too, or the key-set equality breaks on Windows. */
function walkSkillFiles(skillDir: string, dir = skillDir): string[] {
  return readdirSync(path.join(skillsRoot, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(dir, entry.name);
    return entry.isDirectory() ? walkSkillFiles(skillDir, relative) : [relative.split(path.sep).join('/')];
  });
}

function loaderArgs(url: string, params: Record<string, string> = {}, method = 'GET'): LoaderFunctionArgs {
  return {
    request: new Request(`https://git-span.test${url}`, { method }),
    params,
    context: {}
  } as unknown as LoaderFunctionArgs;
}

function caught(fn: () => unknown): unknown {
  try {
    return fn();
  } catch (error) {
    return error;
  }
}

const index = agentSkillsPublication.index;
const entryFile = (entry: { url: string }) =>
  agentSkillsPublication.files[entry.url.slice('/.well-known/agent-skills/'.length)];

describe(`GET ${AGENT_SKILLS_INDEX_PATH}`, () => {
  it('is registered as an explicit resource route the splat cannot swallow', () => {
    expect(routes).toContainEqual({
      path: '.well-known/agent-skills/index.json',
      file: 'routes/agent-skills/index.ts'
    });
    expect(routes).toContainEqual({ path: '.well-known/agent-skills/*', file: 'routes/agent-skills/file.ts' });
    const table = routes as unknown as RouteObject[];
    const fileOf = (match: ReturnType<typeof matchRoutes>) =>
      (match?.[0]?.route as (RouteObject & { file?: string }) | undefined)?.file;
    expect(fileOf(matchRoutes(table, AGENT_SKILLS_INDEX_PATH))).toBe('routes/agent-skills/index.ts');
    expect(fileOf(matchRoutes(table, '/.well-known/agent-skills/git-span/SKILL.md'))).toBe(
      'routes/agent-skills/file.ts'
    );
  });

  it('serves the index as application/json with the generated document', async () => {
    const response = await indexLoader(loaderArgs(AGENT_SKILLS_INDEX_PATH));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual(index);
  });

  it('answers HEAD with the same headers and no body', async () => {
    const response = await indexLoader(loaderArgs(AGENT_SKILLS_INDEX_PATH, {}, 'HEAD'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.text()).toBe('');
  });

  it('pins the draft v0.2.0 envelope: schema URI and exact entry keys', () => {
    expect(index.$schema).toBe('https://schemas.agentskills.io/discovery/0.2.0/schema.json');
    for (const entry of index.skills) {
      expect(Object.keys(entry).sort()).toEqual(['description', 'digest', 'name', 'type', 'url']);
      expect(entry.type).toBe('skill-md');
      expect(entry.url).toBe(`/.well-known/agent-skills/${entry.name}/SKILL.md`);
      expect(entry.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it('names every skill directory in the live plugin tree and nothing else', () => {
    expect(index.skills.map((skill) => skill.name)).toEqual(liveSkillDirs);
  });

  it('reads each description from the live SKILL.md frontmatter', () => {
    for (const entry of index.skills) {
      expect(entry.description).toBe(readFrontmatterDescription(entry.name));
    }
  });

  it('computes each digest over the bytes actually served', () => {
    for (const entry of index.skills) {
      const file = entryFile(entry);
      expect(file, `${entry.name}: index url names no served file`).toBeDefined();
      if (!file) continue;
      const digest = createHash('sha256').update(Buffer.from(file.content, 'utf8')).digest('hex');
      expect(entry.digest).toBe(`sha256:${digest}`);
    }
  });

  it('keeps the committed artifact identical to a fresh generator run', () => {
    expect(agentSkillsPublication).toEqual(buildPublication(skillsRoot));
  });
});

describe('GET /.well-known/agent-skills/*', () => {
  it('serves SKILL.md with text/markdown and scripts with text/plain', async () => {
    for (const name of liveSkillDirs) {
      const response = await fileLoader(
        loaderArgs(`/.well-known/agent-skills/${name}/SKILL.md`, { '*': `${name}/SKILL.md` })
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
      expect(await response.text()).toBe(agentSkillsPublication.files[`${name}/SKILL.md`].content);
    }
    const script = await fileLoader(
      loaderArgs('/.well-known/agent-skills/hook-effect-analysis/scripts/collect.mjs', {
        '*': 'hook-effect-analysis/scripts/collect.mjs'
      })
    );
    expect(script.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  });

  it('keeps every served file byte-identical to the live plugin tree', () => {
    const liveFiles = liveSkillDirs.flatMap((dir) => walkSkillFiles(dir));
    expect(Object.keys(agentSkillsPublication.files).sort()).toEqual([...liveFiles].sort());
    for (const [servedPath, file] of Object.entries(agentSkillsPublication.files)) {
      // Compare raw buffers, not decoded strings: the generator's fail-closed
      // UTF-8 guard makes both representations agree, and a buffer comparison
      // sees drift the decoded-string comparison could not.
      const treeBytes = readFileSync(path.join(skillsRoot, servedPath));
      expect(Buffer.compare(treeBytes, Buffer.from(file.content, 'utf8')), servedPath).toBe(0);
    }
  });

  it('answers HEAD with the same headers and no body', async () => {
    const response = await fileLoader(
      loaderArgs('/.well-known/agent-skills/reconcile/SKILL.md', { '*': 'reconcile/SKILL.md' }, 'HEAD')
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(await response.text()).toBe('');
  });

  it('404s fail-closed on unknown paths', () => {
    const error = caught(() => fileLoader(loaderArgs('/.well-known/agent-skills/nope', { '*': 'nope' })));
    expect(error).toBeInstanceOf(Response);
    if (!(error instanceof Response)) throw new Error('expected a thrown Response');
    expect(error.status).toBe(404);
  });
});

describe('buildPublication fail-closed guards', () => {
  function withTempTree(files: Record<string, string | Buffer>, fn: (root: string) => void): void {
    const root = mkdtempSync(path.join(os.tmpdir(), 'agent-skills-fixture-'));
    const skillDir = path.join(root, 'fixture-skill');
    mkdirSync(skillDir);
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: fixture-skill\ndescription: A fixture skill\n---\n# Fixture\n'
    );
    for (const [relative, content] of Object.entries(files)) {
      const filePath = path.join(skillDir, relative);
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, content);
    }
    try {
      fn(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it('rejects a skill file that is not valid UTF-8 instead of serving replacement bytes', () => {
    withTempTree({ 'scripts/broken.mjs': Buffer.from([0x63, 0x6f, 0x6e, 0x80, 0x81]) }, (root) => {
      // The error must name the broken file: a guard that rejected every
      // file, valid ones included, would name SKILL.md instead.
      expect(() => buildPublication(root)).toThrow(/broken\.mjs is not valid UTF-8/);
    });
  });

  it('rejects a block-scalar description instead of publishing the indicator', () => {
    withTempTree({}, (root) => {
      writeFileSync(
        path.join(root, 'fixture-skill', 'SKILL.md'),
        '---\nname: fixture-skill\ndescription: |\n  A multi-line description\n---\n# Fixture\n'
      );
      expect(() => buildPublication(root)).toThrow(/single-line scalar/);
    });
  });

  it('rejects descriptions a real YAML parse would read differently', () => {
    const variants = [
      'description: Track spans\n  clean up couplings', // folded plain scalar
      'description: Track spans # keep in sync', // inline comment
      'description: "Track spans"' // quoted scalar
    ];
    for (const description of variants) {
      withTempTree({}, (root) => {
        writeFileSync(
          path.join(root, 'fixture-skill', 'SKILL.md'),
          `---\nname: fixture-skill\n${description}\n---\n# Fixture\n`
        );
        expect(() => buildPublication(root), description).toThrow(/bare single-line scalar/);
      });
    }
  });
});

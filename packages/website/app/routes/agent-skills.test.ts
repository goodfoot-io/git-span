// @vitest-environment node
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
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

/** Every file under one skill directory, as plugin-tree-relative paths. */
function walkSkillFiles(skillDir: string, dir = skillDir): string[] {
  return readdirSync(path.join(skillsRoot, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(dir, entry.name);
    return entry.isDirectory() ? walkSkillFiles(skillDir, relative) : [relative];
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
      expect(readFileSync(path.join(skillsRoot, servedPath), 'utf8')).toBe(file.content);
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

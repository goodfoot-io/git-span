/**
 * The build-generated agent-skills publication, loaded from
 * `agent-skills.generated.json` and validated against the publication
 * interfaces at module load. The JSON import's inferred type is never trusted
 * as an `AgentSkillsPublication`: every field is checked, so a hand edit or a
 * generator change that breaks the contract fails the first import (and every
 * suite that touches the routes) instead of serving a malformed index.
 *
 * Imported only by server-side route modules, like the artifact itself, so
 * the skill bodies never reach the browser bundle.
 *
 * @summary Typed, validated agent-skills publication
 */
import type { AgentSkillEntry, AgentSkillsFile, AgentSkillsIndex, AgentSkillsPublication } from './agent-skills';
import generated from './agent-skills.generated.json';

const SOURCE = 'agent-skills.generated.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw new Error(`${SOURCE}: ${where}.${key} must be a string`);
  return value;
}

function parseSkillEntry(value: unknown, where: string): AgentSkillEntry {
  if (!isRecord(value)) throw new Error(`${SOURCE}: ${where} must be an object`);
  const type = stringField(value, 'type', where);
  if (type !== 'skill-md') throw new Error(`${SOURCE}: ${where}.type must be 'skill-md', got '${type}'`);
  return {
    name: stringField(value, 'name', where),
    type,
    description: stringField(value, 'description', where),
    url: stringField(value, 'url', where),
    digest: stringField(value, 'digest', where)
  };
}

function parseIndex(value: unknown): AgentSkillsIndex {
  if (!isRecord(value)) throw new Error(`${SOURCE}: index must be an object`);
  const skills = value.skills;
  if (!Array.isArray(skills)) throw new Error(`${SOURCE}: index.skills must be an array`);
  return {
    $schema: stringField(value, '$schema', 'index'),
    skills: skills.map((skill: unknown, position) => parseSkillEntry(skill, `index.skills[${position}]`))
  };
}

function parseFiles(value: unknown): Record<string, AgentSkillsFile> {
  if (!isRecord(value)) throw new Error(`${SOURCE}: files must be an object`);
  const files: Record<string, AgentSkillsFile> = {};
  for (const [servedPath, file] of Object.entries(value)) {
    const where = `files[${JSON.stringify(servedPath)}]`;
    if (!isRecord(file)) throw new Error(`${SOURCE}: ${where} must be an object`);
    files[servedPath] = {
      content: stringField(file, 'content', where),
      contentType: stringField(file, 'contentType', where)
    };
  }
  return files;
}

/**
 * Validate the generated artifact's shape. The `$comment` banner member is
 * required (it marks the file as generated) and dropped from the result.
 *
 * @param value - The parsed artifact.
 * @summary Parse the generated agent-skills artifact
 */
function parseAgentSkillsPublication(value: unknown): AgentSkillsPublication {
  if (!isRecord(value)) throw new Error(`${SOURCE}: the artifact must be an object`);
  stringField(value, '$comment', 'artifact');
  return { index: parseIndex(value.index), files: parseFiles(value.files) };
}

/** The served publication: the index document plus every served file. */
export const agentSkillsPublication: AgentSkillsPublication = parseAgentSkillsPublication(generated);

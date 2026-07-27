/**
 * Extension-manifest wiring coupling signal.
 *
 * A `package.json` `contributes` block (commands, configuration keys, views,
 * view containers, keybindings, menus) declares an identifier that some
 * other source file must register or read at runtime. That registration
 * site is never expressed as a type or import — only as a matching string —
 * so this signal greps for the identifier and scores higher when the match
 * looks like an actual registration call rather than an incidental mention.
 *
 * @summary Detects manifest-declared ids wired up in registrar source files.
 */

import type { Candidate, DiscoverConfig, Loc, RepoHistory, RepoScan, Signal } from '../types.js';

const SIGNAL_NAME = 'manifest-wiring';
const REGISTRATION_SCORE = 0.7;
const MENTION_SCORE = 0.58;
const MAX_PAIRS = 150;
const REGISTRATION_MARKER_RE =
  /registerCommand|executeCommand|registerWebviewViewProvider|createTreeView|getConfiguration|onCommand/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * Parses `text` as JSON and returns its `contributes` value, but only when
 * that value is a plain object. Returns null on any parse failure or on a
 * missing/non-object `contributes` — a malformed manifest is skipped, never
 * thrown.
 *
 * @param text - Raw `package.json` file content.
 * @returns The `contributes` object, or null when absent/malformed.
 */
function manifestContributes(text: string): Record<string, unknown> | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  const contributes = data['contributes'];
  return isRecord(contributes) ? contributes : null;
}

function collectArrayIds(value: unknown, key: 'command' | 'id', into: Set<string>): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = item[key];
    if (typeof id === 'string' && id.length > 0) into.add(id);
  }
}

function collectContainerMapIds(value: unknown, key: 'command' | 'id', into: Set<string>): void {
  if (!isRecord(value)) return;
  for (const containerKey of Object.keys(value)) {
    collectArrayIds(value[containerKey], key, into);
  }
}

function collectConfigurationIds(value: unknown, into: Set<string>): void {
  const sections = Array.isArray(value) ? value : [value];
  for (const section of sections) {
    if (!isRecord(section)) continue;
    const properties = section['properties'];
    if (!isRecord(properties)) continue;
    for (const propKey of Object.keys(properties)) into.add(propKey);
  }
}

/**
 * Collects every distinct id declared by a manifest's `contributes` block
 * across commands, configuration, views, view containers, keybindings, and
 * menus.
 *
 * @param contributes - The manifest's parsed `contributes` object.
 * @returns Distinct declared ids, sorted for deterministic iteration.
 */
function collectContributedIds(contributes: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  collectArrayIds(contributes['commands'], 'command', ids);
  collectConfigurationIds(contributes['configuration'], ids);
  collectContainerMapIds(contributes['views'], 'id', ids);
  collectContainerMapIds(contributes['viewsContainers'], 'id', ids);
  collectArrayIds(contributes['keybindings'], 'command', ids);
  collectContainerMapIds(contributes['menus'], 'command', ids);
  return [...ids].sort();
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface IdMatch {
  readonly line: number;
  readonly hasMarker: boolean;
}

/**
 * Finds the first delimited occurrence of `id` in `text` (bounded by
 * non-word, non-dot characters so it cannot match inside a longer dotted
 * identifier) and reports its 1-based line number plus whether that line
 * looks like an actual registration call.
 *
 * @param id - The manifest-declared id to search for.
 * @param text - Candidate registrar file content.
 * @returns The match location and marker flag, or null when not found.
 */
function findIdMatch(id: string, text: string): IdMatch | null {
  const re = new RegExp(`(?<![\\w.])${escapeRegExp(id)}(?![\\w.])`);
  const match = re.exec(text);
  if (match === null) return null;
  const upToMatch = text.slice(0, match.index);
  const line = upToMatch.split('\n').length;
  const lineStart = upToMatch.lastIndexOf('\n') + 1;
  const lineEndIdx = text.indexOf('\n', match.index);
  const fullLine = text.slice(lineStart, lineEndIdx === -1 ? text.length : lineEndIdx);
  return { line, hasMarker: REGISTRATION_MARKER_RE.test(fullLine) };
}

interface PairMatch {
  readonly manifest: string;
  readonly registrar: string;
  readonly id: string;
  readonly line: number;
  readonly score: number;
}

function pairKey(manifest: string, registrar: string): string {
  return `${manifest} ${registrar}`;
}

/**
 * Signal that pairs a `package.json` manifest with the files that wire up
 * its declared `contributes` ids.
 */
export const manifestWiringSignal: Signal = {
  name: SIGNAL_NAME,

  applies(scan: RepoScan): boolean {
    for (const path of scan.files) {
      if (basename(path) !== 'package.json') continue;
      const text = scan.text.get(path);
      if (text !== undefined && manifestContributes(text) !== null) return true;
    }
    return false;
  },

  run(scan: RepoScan, _history: RepoHistory, _config: DiscoverConfig): Candidate[] {
    const registrarCandidates = scan.files.filter((path) => basename(path) !== 'package.json' && scan.text.has(path));

    const best = new Map<string, PairMatch>();
    for (const manifestPath of scan.files) {
      if (basename(manifestPath) !== 'package.json') continue;
      const manifestText = scan.text.get(manifestPath);
      if (manifestText === undefined) continue;
      const contributes = manifestContributes(manifestText);
      if (contributes === null) continue;

      for (const id of collectContributedIds(contributes)) {
        for (const registrarPath of registrarCandidates) {
          const text = scan.text.get(registrarPath);
          if (text === undefined) continue;
          const found = findIdMatch(id, text);
          if (found === null) continue;

          const score = found.hasMarker ? REGISTRATION_SCORE : MENTION_SCORE;
          const key = pairKey(manifestPath, registrarPath);
          const existing = best.get(key);
          if (existing === undefined || score > existing.score) {
            best.set(key, { manifest: manifestPath, registrar: registrarPath, id, line: found.line, score });
          }
        }
      }
    }

    const candidates: Candidate[] = [];
    for (const match of best.values()) {
      const locs: Loc[] = [{ path: match.manifest }, { path: match.registrar, start: match.line, end: match.line }];
      candidates.push({
        locs,
        score: match.score,
        signal: SIGNAL_NAME,
        evidence: [`manifest:${match.id}`]
      });
    }

    candidates.sort((x, y) => {
      if (y.score !== x.score) return y.score - x.score;
      const xa = x.locs[0]?.path ?? '';
      const xb = x.locs[1]?.path ?? '';
      const ya = y.locs[0]?.path ?? '';
      const yb = y.locs[1]?.path ?? '';
      return xa === ya ? xb.localeCompare(yb) : xa.localeCompare(ya);
    });

    return candidates.slice(0, MAX_PAIRS);
  }
};

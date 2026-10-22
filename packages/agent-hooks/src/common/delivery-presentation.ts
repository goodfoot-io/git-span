/** Bounded presentation history; never a semantic review or approval record. */
import { createHash } from 'node:crypto';
import { isRecord } from './guards.js';
import type { ContextSpan } from './touch-core.js';

export const BROAD_READ_BYTES = 1536;
export const TARGETED_BYTES = 8192;
export const MAX_SNAPSHOTS = 128;
export const MAX_SNAPSHOT_BYTES = 8192;
export const MAX_MEMO_BYTES = 256 * 1024;

export interface DeliverySnapshot {
  version: 1;
  revision: string;
  why: string | null;
  anchors: string[];
  fullFooter: boolean;
  recipient: string;
}

/** Safely quote one literal shell argument, including embedded quote characters. */
export function shellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Inline code whose delimiter cannot be closed by user-controlled text. */
export function inlineCode(value: string): string {
  const longest = (value.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(longest + 1);
  return `${fence} ${value.replace(/\p{Cc}/gu, ' ')} ${fence}`;
}

export function showRoute(name: string): string {
  if (Buffer.byteLength(name) > 256 || /\p{Cc}/u.test(name))
    return '`git span list` (retrieve the complete name, then `git span show <name>`)';
  return inlineCode(`git span show -- ${shellArgument(name)}`);
}

export function snapshot(span: ContextSpan, fullFooter: boolean, recipient: string): DeliverySnapshot {
  return {
    version: 1,
    revision: span.evidence_revision,
    why: span.why,
    anchors: span.anchors.map((anchor) => createHash('sha256').update(JSON.stringify(anchor)).digest('hex')),
    fullFooter,
    recipient
  };
}

/** Old digests and malformed/oversize snapshots provide no exposure baseline. */
export function readSnapshots(surfaced: Set<string>): Map<string, { key: string; value: DeliverySnapshot }> {
  const result = new Map<string, { key: string; value: DeliverySnapshot }>();
  for (const key of surfaced) {
    if (!key.startsWith('touch:')) continue;
    const identity = key.slice(0, 70);
    if (!/^touch:[0-9a-f]{64}$/.test(identity)) {
      surfaced.delete(key);
      continue;
    }
    try {
      if (Buffer.byteLength(key) > MAX_SNAPSHOT_BYTES) throw new Error('oversize snapshot');
      const parsed: unknown = JSON.parse(key.slice(71));
      if (
        !isRecord(parsed) ||
        parsed.version !== 1 ||
        typeof parsed.revision !== 'string' ||
        !/^[0-9a-f]{64}$/.test(parsed.revision) ||
        !(parsed.why === null || typeof parsed.why === 'string') ||
        !Array.isArray(parsed.anchors) ||
        !parsed.anchors.every((row): row is string => typeof row === 'string' && /^[0-9a-f]{64}$/.test(row)) ||
        typeof parsed.fullFooter !== 'boolean' ||
        typeof parsed.recipient !== 'string' ||
        parsed.recipient.length !== 64 ||
        !/^[0-9a-f]{64}$/.test(parsed.recipient)
      )
        throw new Error('invalid snapshot');
      const value: DeliverySnapshot = {
        version: 1,
        revision: parsed.revision,
        why: parsed.why,
        anchors: parsed.anchors,
        fullFooter: parsed.fullFooter,
        recipient: parsed.recipient
      };
      const prior = result.get(identity);
      if (prior !== undefined) surfaced.delete(prior.key);
      result.set(identity, { key, value });
    } catch {
      surfaced.delete(key);
    }
  }
  return result;
}

/** Deterministic oldest-first eviction, bounded by count and serialized bytes. */
export function recordSnapshots(surfaced: Set<string>, updates: Map<string, DeliverySnapshot>): void {
  const records = readSnapshots(surfaced);
  for (const [identity, value] of updates) {
    const prior = records.get(identity);
    if (prior !== undefined) {
      surfaced.delete(prior.key);
      records.delete(identity);
    }
    const key = `${identity}:${JSON.stringify(value)}`;
    if (Buffer.byteLength(key) <= MAX_SNAPSHOT_BYTES) {
      records.set(identity, { key, value });
      surfaced.add(key);
    }
  }
  let bytes = Buffer.byteLength(JSON.stringify([...surfaced]));
  for (const [identity, entry] of records) {
    if (records.size <= MAX_SNAPSHOTS && bytes <= MAX_MEMO_BYTES) break;
    surfaced.delete(entry.key);
    records.delete(identity);
    bytes -= Buffer.byteLength(JSON.stringify(entry.key)) + (surfaced.size > 0 ? 1 : 0);
  }
  for (const key of surfaced) {
    if (bytes <= MAX_MEMO_BYTES) break;
    surfaced.delete(key);
    bytes -= Buffer.byteLength(JSON.stringify(key)) + (surfaced.size > 0 ? 1 : 0);
  }
}

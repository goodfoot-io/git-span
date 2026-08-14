/**
 * Authoritative static-intent pipeline shared by the Claude, Codex, and
 * mini-swe-agent Bash adapters.
 *
 * PreToolUse records only the tracked ranges whose precision or eligibility
 * depends on pre-command state. PostToolUse consumes that record, reparses the
 * command for ordinary post-state operations, applies operation-specific
 * tracked eligibility, and delegates execution/join semantics to the shared
 * Bash touch driver. Response-derived reads intentionally remain a second
 * producer and share only the session memo.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { relativeToRepo, resolveRepoRoot, type SessionLayout, toPosix } from './agent-hooks-common.js';
import { type BashTouchMatch, bashResponseInterrupted, runBashTouches } from './bash-touch.js';
import { parseCommandDetailed, type ResolvedSpan } from './parse-command.js';
import { parseResponse, type ResponseParseInput, type ResponseSpan } from './parse-response.js';
import type { CoreLogger, MemoStore } from './span-surface.js';
import {
  createPlannedTouchStore,
  DEFAULT_PLANNED_TOUCH_BUDGETS,
  filterTrackedEligibility,
  type LayeredResolvedMatch,
  type PlannedTouch,
  type PlannedTouchRecord,
  type PlannedTouchStore,
  type PreStateEvidence,
  parseCommandLayered
} from './static-attribution.js';
import { runTouchHook, type TouchExecutors } from './touch-core.js';

/** The response fields understood by response-derived read attribution. */
export type NormalizedBashResponse = Pick<
  ResponseParseInput,
  'stdout' | 'stderr' | 'exitStatus' | 'truncated' | 'interrupted'
>;

const RESPONSE_TEXT_FIELDS = ['output', 'stdout', 'content', 'text'] as const;

function finiteTimeout(record: Readonly<Record<string, unknown>>): boolean {
  const value = record.timedOutAfterMs;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function integerExitStatus(record: Readonly<Record<string, unknown>>): number | undefined {
  for (const field of ['exit_code', 'exitCode', 'exitStatus'] as const) {
    const value = record[field];
    if (typeof value === 'number' && Number.isInteger(value)) return value;
  }
  return undefined;
}

/** Normalize all deployed Bash response spellings without treating a nullable timeout as an interruption. */
export function normalizeBashResponse(toolResponse: unknown): NormalizedBashResponse | null {
  if (typeof toolResponse === 'string') return { stdout: toolResponse };
  if (Array.isArray(toolResponse)) {
    const text: string[] = [];
    for (const block of toolResponse) {
      if (block !== null && typeof block === 'object') {
        const value = (block as { text?: unknown }).text;
        if (typeof value === 'string') text.push(value);
      }
    }
    return { stdout: text.join('') };
  }
  if (toolResponse === null || typeof toolResponse !== 'object') return null;

  const record = toolResponse as Record<string, unknown>;
  for (const field of RESPONSE_TEXT_FIELDS) {
    const value = record[field];
    if (typeof value !== 'string') continue;
    const interrupted = record.interrupted === true || record.is_interrupt === true || finiteTimeout(record);
    const rawOutputPath = record.rawOutputPath;
    return {
      stdout: value,
      stderr: typeof record.stderr === 'string' ? record.stderr : undefined,
      exitStatus: integerExitStatus(record),
      truncated:
        (typeof rawOutputPath === 'string' && rawOutputPath.length > 0) || rawOutputPath === true || interrupted,
      interrupted
    };
  }
  return null;
}

/** Create the production planned-touch store under a session layout. */
export function createDefaultPlannedTouchStore(layout: SessionLayout): PlannedTouchStore {
  return createPlannedTouchStore(layout, DEFAULT_PLANNED_TOUCH_BUDGETS);
}

function readText(path: string): string | null {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function unionRange(ranges: readonly { start: number; end: number }[]): { start: number; end: number } {
  return ranges.reduce(
    (union, range) => ({ start: Math.min(union.start, range.start), end: Math.max(union.end, range.end) }),
    { start: ranges[0]?.start ?? 1, end: ranges[0]?.end ?? 1 }
  );
}

function planEvidence(
  matches: readonly LayeredResolvedMatch[],
  requirements: ReadonlySet<string>
): PreStateEvidence | undefined {
  if (matches.some(({ span }) => span.operation === 'delete')) return { kind: 'tracked', tracked: true };
  const expectedContent = matches.find(({ span }) => span.expectedContent !== undefined)?.span.expectedContent;
  const ranges = matches.flatMap(({ span }) =>
    span.lineStart === undefined ? [] : [{ start: span.lineStart, end: span.lineEnd ?? span.lineStart }]
  );
  if (expectedContent !== undefined) {
    return {
      kind: 'content-digest',
      algorithm: 'sha256',
      digest: createHash('sha256').update(expectedContent).digest('hex'),
      range: unionRange(ranges)
    };
  }
  if (requirements.has('pre-command-eof')) {
    const content = readText(matches[0].span.absolutePath);
    if (content !== null) {
      return {
        kind: 'eof',
        line: content.length === 0 ? 0 : content.split('\n').length,
        byteLength: Buffer.byteLength(content)
      };
    }
  }
  return undefined;
}

function planGroupKey(span: ResolvedSpan): string {
  return `${span.absolutePath}\0${span.operation}\0${span.simpleCommandIndex}`;
}

/**
 * Parse and persist the bounded pieces of Bash attribution that cannot be
 * reconstructed safely after execution. All persisted paths pass pre-side
 * tracked eligibility; ordinary creates and reads deliberately produce no
 * record and are checked against the post-command index instead.
 */
export function planBashTouches(
  command: string,
  cwd: string,
  sessionId: string,
  toolUseId: string,
  logger: CoreLogger,
  store: PlannedTouchStore
): void {
  const started = performance.now();
  const parsed = parseCommandLayered(command, { cwd, readPreState: readText });
  const requested = new Map<string, Set<string>>();
  for (const request of parsed.preStateRequests) {
    const key = `${request.absolutePath}\0${request.operation}\0${request.simpleCommandIndex}`;
    const requirements = requested.get(key) ?? new Set<string>();
    requirements.add(request.requirement);
    requested.set(key, requirements);
  }

  const candidates = parsed.resolved.filter(
    ({ span }) => span.operation === 'delete' || requested.has(planGroupKey(span))
  );
  const tracked = filterTrackedEligibility(
    candidates.map((value) => ({ absolutePath: value.span.absolutePath, value })),
    { cwd }
  );
  if (tracked.eligible.length === 0) {
    logger.info?.('git-span static attribution pre-plan', {
      resolved: parsed.resolved.length,
      unresolved: parsed.unresolved.length,
      planned: 0,
      trackedDrops: tracked.dropped.length,
      parserLatencyMs: performance.now() - started,
      subprocessCount: tracked.subprocessCount
    });
    return;
  }
  const repoRoot = resolveRepoRoot(cwd);
  if (repoRoot === null) return;

  const groups = new Map<string, LayeredResolvedMatch[]>();
  for (const { value } of tracked.eligible) {
    const key = planGroupKey(value.span);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  const touches: PlannedTouch[] = [];
  for (const [key, matches] of groups) {
    const span = matches[0].span;
    const requirements = requested.get(key) ?? new Set<string>();
    const evidence = planEvidence(matches, requirements);
    touches.push({
      repoRelativePath: toPosix(relativeToRepo(repoRoot, span.absolutePath)),
      operation: span.operation,
      ranges: matches.flatMap(({ span: item }) =>
        item.lineStart === undefined ? [] : [{ start: item.lineStart, end: item.lineEnd ?? item.lineStart }]
      ),
      simpleCommandIndex: span.simpleCommandIndex,
      ...(evidence === undefined ? {} : { evidence })
    });
  }
  store.put({ version: 1, sessionId, toolUseId, repoRoot, createdAtMs: Date.now(), touches });
  logger.info?.('git-span static attribution pre-plan', {
    resolved: parsed.resolved.length,
    unresolved: parsed.unresolved.length,
    unresolvedReasons: parsed.unresolved.map(({ reasonCode }) => reasonCode),
    planned: touches.length,
    trackedDrops: tracked.dropped.length,
    parserLatencyMs: performance.now() - started,
    subprocessCount: tracked.subprocessCount
  });
}

function plannedSpans(record: PlannedTouchRecord | null, cwd: string, logger: CoreLogger): BashTouchMatch[] {
  if (record === null) return [];
  const relativeCwd = nodePath.relative(record.repoRoot, cwd);
  const cwdInsidePlannedRepo =
    relativeCwd === '' ||
    (relativeCwd !== '..' && !relativeCwd.startsWith(`..${nodePath.sep}`) && !nodePath.isAbsolute(relativeCwd));
  if (!cwdInsidePlannedRepo) {
    logger.warn('git-span static attribution ignored an incompatible planned-touch record', {
      plannedRepoRoot: record.repoRoot,
      currentCwd: cwd
    });
    return [];
  }
  const matches: BashTouchMatch[] = [];
  for (const touch of record.touches) {
    const absolutePath = nodePath.join(record.repoRoot, touch.repoRelativePath);
    let expectedContent: string | undefined;
    if (touch.evidence?.kind === 'content-digest') {
      const content = readText(absolutePath);
      const digest = content === null ? null : createHash('sha256').update(content).digest('hex');
      if (digest !== touch.evidence.digest) {
        logger.warn('git-span static attribution discarded unverifiable planned evidence', {
          path: touch.repoRelativePath,
          reasonCode: 'evidence-mismatch'
        });
        continue;
      }
      expectedContent = content ?? undefined;
    }
    const ranges = touch.ranges.length === 0 ? [undefined] : touch.ranges;
    for (const range of ranges) {
      matches.push({
        status: 'resolved',
        idiom: 'planned-static',
        span: {
          operation: touch.operation,
          absolutePath,
          lineStart: range?.start,
          lineEnd: range?.end,
          expectedContent,
          ...(touch.operation === 'delete' && touch.evidence?.kind === 'tracked'
            ? { preTrackedDelete: true as const }
            : {}),
          simpleCommandIndex: touch.simpleCommandIndex
        }
      });
    }
  }
  return matches;
}

function matchKey(match: Extract<BashTouchMatch, { status: 'resolved' }>): string {
  const span = match.span;
  return [span.absolutePath, span.operation, span.simpleCommandIndex, span.lineStart ?? '', span.lineEnd ?? ''].join(
    '\0'
  );
}

function filterPostTracked(
  matches: readonly BashTouchMatch[],
  responseSpans: readonly ResponseSpan[],
  cwd: string,
  preTrackedPaths: ReadonlySet<string>,
  preTrackedDeletes: ReadonlySet<string>
): {
  matches: BashTouchMatch[];
  responseSpans: ResponseSpan[];
  trackedDrops: number;
  scopeDrops: number;
  subprocessCount: number;
} {
  const guards = matches.filter(
    (match): match is Extract<BashTouchMatch, { status: 'builtin-guard' }> => match.status === 'builtin-guard'
  );
  const resolved = matches.filter(
    (match): match is Extract<BashTouchMatch, { status: 'resolved' }> => match.status === 'resolved'
  );
  type Candidate =
    | { readonly source: 'command'; readonly match: Extract<BashTouchMatch, { status: 'resolved' }> }
    | { readonly source: 'response'; readonly span: ResponseSpan };
  const candidates: Candidate[] = [
    ...resolved.map((match): Candidate => ({ source: 'command', match })),
    ...responseSpans.map((span): Candidate => ({ source: 'response', span }))
  ];
  const preEligibleCommands = resolved.filter((match) => preTrackedPaths.has(match.span.absolutePath));
  const preEligibleSet = new Set(preEligibleCommands);
  const postCandidates = candidates.filter((value) => value.source === 'response' || !preEligibleSet.has(value.match));
  const filtered = filterTrackedEligibility(
    postCandidates.map((value) => ({
      absolutePath: value.source === 'command' ? value.match.span.absolutePath : value.span.absolutePath,
      value
    })),
    { cwd }
  );
  const eligibleCommands = new Set(
    filtered.eligible.flatMap(({ value }) => (value.source === 'command' ? [value.match] : []))
  );
  for (const match of preEligibleCommands) eligibleCommands.add(match);
  const eligibleResponses = filtered.eligible.flatMap(({ value }) => (value.source === 'response' ? [value.span] : []));
  for (const match of resolved) {
    if (match.span.operation === 'delete' && preTrackedDeletes.has(match.span.absolutePath))
      eligibleCommands.add(match);
  }
  const kept = resolved.filter((match) => eligibleCommands.has(match));
  return {
    matches: [...kept, ...guards],
    responseSpans: eligibleResponses,
    trackedDrops: filtered.dropped.filter(({ reason }) => reason === 'untracked-path').length,
    scopeDrops: filtered.dropped.filter(({ reason }) => reason !== 'untracked-path').length,
    subprocessCount: filtered.subprocessCount
  };
}

async function runResponseReadTouches(
  spans: readonly ResponseSpan[],
  cwd: string,
  sessionId: string,
  executors: TouchExecutors,
  memo: MemoStore
): Promise<string[]> {
  const blocks: string[] = [];
  for (const span of spans) {
    const output = await runTouchHook(
      {
        kind: 'read',
        sessionId,
        cwd,
        filePath: span.absolutePath,
        offset: span.lineStart,
        limit: span.lineEnd - span.lineStart + 1
      },
      executors,
      memo
    );
    if (output.additionalContext) blocks.push(output.additionalContext);
  }
  return blocks;
}

/** Run the complete command-derived pass followed by the independent response-read pass. */
export async function runLayeredBashTouches(
  command: string,
  cwd: string,
  sessionId: string,
  toolUseId: string | undefined,
  toolResponse: unknown,
  executors: TouchExecutors,
  memo: MemoStore,
  logger: CoreLogger,
  store: PlannedTouchStore
): Promise<string[]> {
  const parserStarted = performance.now();
  const record = toolUseId === undefined ? null : store.consume(sessionId, toolUseId);
  const planned = plannedSpans(record, cwd, logger);
  const parsed = parseCommandLayered(command, { cwd, readPreState: readText });
  const preStateKeys = new Set(parsed.preStateRequests.map((request) => planGroupKey(request)));
  const ordinary: BashTouchMatch[] = parsed.resolved
    // A pre-state-sensitive command is represented by its consumed plan.
    // Re-emitting the post-state parse alongside that plan made one logical
    // write run the full git-span surface twice whenever its recovered range
    // differed from the planned union range.
    .filter(({ span }) => !preStateKeys.has(planGroupKey(span)))
    .map(({ idiom, span }) => ({ status: 'resolved', idiom, span }));
  // A second deterministic parse is needed only for conditional compounds:
  // the layered result already carries every resolved span's join metadata,
  // while `&&`/`||` additionally need span-less builtin guards. Simple
  // commands avoid repeating lexical dispatch entirely.
  const detailed = /&&|\|\|/.test(command) ? parseCommandDetailed(command, { cwd }) : [];
  const joinByIndex = new Map([
    ...parsed.resolved.flatMap(({ span }) =>
      span.join === undefined ? [] : ([[span.simpleCommandIndex, span.join]] as const)
    ),
    ...detailed.flatMap((match) =>
      match.status === 'resolved' && match.span.join !== undefined
        ? [[match.span.simpleCommandIndex, match.span.join] as const]
        : []
    )
  ]);
  for (const match of planned) {
    if (match.status === 'resolved') match.span.join = joinByIndex.get(match.span.simpleCommandIndex);
  }
  const guards = detailed.filter(
    (match): match is Extract<BashTouchMatch, { status: 'builtin-guard' }> => match.status === 'builtin-guard'
  );
  const seen = new Set(planned.filter((match) => match.status === 'resolved').map(matchKey));
  const combined = [
    ...planned,
    ...ordinary.filter((match) => {
      const key = matchKey(match as Extract<BashTouchMatch, { status: 'resolved' }>);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    ...guards
  ];
  const preTrackedDeletes = new Set(
    (record?.touches ?? [])
      .filter(({ operation, evidence }) => operation === 'delete' && evidence?.kind === 'tracked')
      .map(({ repoRelativePath }) => nodePath.join(record!.repoRoot, repoRelativePath))
  );
  const preTrackedPaths = new Set(
    (record?.touches ?? []).map(({ repoRelativePath }) => nodePath.join(record!.repoRoot, repoRelativePath))
  );
  const response = bashResponseInterrupted(toolResponse) ? null : normalizeBashResponse(toolResponse);
  const responseSpans = response === null ? [] : parseResponse({ command, cwd, ...response });
  const filtered = filterPostTracked(combined, responseSpans, cwd, preTrackedPaths, preTrackedDeletes);
  const parserLatencyMs = performance.now() - parserStarted;
  const touchStarted = performance.now();
  const commandBlocks = await runBashTouches(
    filtered.matches,
    sessionId,
    cwd,
    toolResponse,
    executors,
    memo,
    (message) => logger.warn(message),
    true
  );
  const responseBlocks = await runResponseReadTouches(filtered.responseSpans, cwd, sessionId, executors, memo);
  const blocks = [...commandBlocks, ...responseBlocks];
  logger.info?.('git-span static attribution post', {
    resolvedReads: filtered.matches.filter((match) => match.status === 'resolved' && match.span.operation === 'read')
      .length,
    resolvedWrites: filtered.matches.filter((match) => match.status === 'resolved' && match.span.operation !== 'read')
      .length,
    unresolvedByReason: parsed.unresolved.reduce<Record<string, number>>((counts, item) => {
      counts[item.reasonCode] = (counts[item.reasonCode] ?? 0) + 1;
      return counts;
    }, {}),
    scopeDrops: filtered.scopeDrops,
    trackedDrops: filtered.trackedDrops,
    parserLatencyMs,
    touchLatencyMs: performance.now() - touchStarted,
    subprocessCount: filtered.subprocessCount,
    dependencyContextSurfaced: blocks.length > 0
  });
  return blocks;
}

/** Filter one structured producer against the post-command index. */
export function postTrackedValue<T>(absolutePath: string, value: T, cwd: string): T | null {
  return filterTrackedEligibility([{ absolutePath, value }], { cwd }).eligible[0]?.value ?? null;
}

/** Convert a failure event without a response envelope into the driver's normalized evidence shape. */
export function failureBashResponse(input: unknown): Record<string, unknown> {
  const record = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const response =
    record.tool_response !== null && typeof record.tool_response === 'object'
      ? { ...(record.tool_response as Record<string, unknown>) }
      : {};
  if (integerExitStatus(response) === undefined) response.exitStatus = 1;
  if (record.is_interrupt === true) response.is_interrupt = true;
  return response;
}

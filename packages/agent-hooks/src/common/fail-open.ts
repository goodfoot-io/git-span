/**
 * Observable fail-open: the one way a swallowed failure reaches the hook log.
 *
 * Fail-open is the contract at these sites — a defect there must never cost
 * the agent its tool call — but a bare `catch` leaves nothing behind, so a
 * broken renderer or a misbehaving `git` looks exactly like "nothing to
 * report". {@link reportFailOpen} keeps the fail-open behavior and records
 * the swallow as one structured warn record ({@link FAIL_OPEN_MESSAGE}, the
 * site, the error message, and a per-process count for the site) on the
 * hook's {@link CoreLogger} — the host's run log (`AGENT_HOOKS_LOG_FILE` for
 * the Claude Code/Codex SDK loggers, `OPENCODE_GIT_SPAN_LOG_FILE` for
 * OpenCode).
 *
 * Some fail-open sites sit below every logger (span-root resolution is a
 * process-cached lookup with no logger in reach). Those report with no
 * logger; the record waits in a bounded in-memory queue and
 * {@link flushFailOpen} writes it to the run log at the next boundary that
 * holds one. Nothing persists past the process.
 */

import type { CoreLogger } from './span-surface.js';

/** The message every fail-open record carries, so one hook-log search finds them all. */
export const FAIL_OPEN_MESSAGE = 'git-span failed open';

/** The swallowed-failure sites, named for where the failure was absorbed. */
export type FailOpenSite =
  /** One touch's rendering threw; that touch surfaces nothing. */
  | 'touch-render'
  /** The anchor tree threw; the span's anchors print as the flat bullet list. */
  | 'anchor-tree-render'
  /** `git config git-span.dir` failed for a reason other than an unset key; the default span root applies. */
  | 'span-root-config';

/** One swallowed failure, as the run log records it. */
export interface FailOpenEvent {
  readonly site: FailOpenSite;
  /** The swallowed error's message. */
  readonly error: string;
  /** How many times this site has failed open in this process, this one included. */
  readonly count: number;
  /** Site-specific detail (the touched file, the repository), plus the raw error so loggers keep its stack. */
  readonly context: Readonly<Record<string, unknown>>;
}

/** Logger-less records held for the next flush; past this, only a dropped count is kept. */
export const MAX_PENDING_FAIL_OPEN = 32;

const counts = new Map<FailOpenSite, number>();
const pending: FailOpenEvent[] = [];
let droppedPending = 0;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emit(logger: CoreLogger, event: FailOpenEvent): void {
  logger.warn(FAIL_OPEN_MESSAGE, { ...event.context, site: event.site, error: event.error, count: event.count });
}

/**
 * Write every queued logger-less record to `logger`, oldest first, followed
 * by one record counting any that overflowed the queue. The queue is empty
 * afterwards.
 */
export function flushFailOpen(logger: CoreLogger): void {
  for (const event of pending.splice(0)) emit(logger, event);
  if (droppedPending > 0) {
    logger.warn(FAIL_OPEN_MESSAGE, { site: 'fail-open-queue', dropped: droppedPending });
    droppedPending = 0;
  }
}

/**
 * Record that `site` swallowed `error` and carried on. With a logger, any
 * queued records flush first and this one is written immediately; without
 * one, it queues for the next {@link flushFailOpen}. Returns the recorded
 * event.
 */
export function reportFailOpen(
  logger: CoreLogger | undefined,
  site: FailOpenSite,
  error: unknown,
  context: Readonly<Record<string, unknown>> = {}
): FailOpenEvent {
  const count = (counts.get(site) ?? 0) + 1;
  counts.set(site, count);
  const event: FailOpenEvent = { site, error: errorMessage(error), count, context: { ...context, err: error } };
  if (logger === undefined) {
    if (pending.length < MAX_PENDING_FAIL_OPEN) pending.push(event);
    else droppedPending += 1;
    return event;
  }
  flushFailOpen(logger);
  emit(logger, event);
  return event;
}

/** How many times `site` has failed open in this process. */
export function failOpenCount(site: FailOpenSite): number {
  return counts.get(site) ?? 0;
}

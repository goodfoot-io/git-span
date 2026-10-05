/**
 * Runtime type guards for untrusted values.
 *
 * Hook payloads, tool responses, JSON state files and caught errors all
 * arrive as `unknown`. These predicates are the one place that turns such a
 * value into a typed one, so callers narrow by checking instead of asserting
 * with `as`.
 */

/** A non-null, non-array object, readable key by key as `unknown`. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A thrown Node.js system error, whose `code` (when present) names the errno. */
export function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && (!('code' in error) || error.code === undefined || typeof error.code === 'string');
}

/** The errno code a caught error carries, or `undefined` when it carries none. */
export function errnoCode(error: unknown): string | undefined {
  return isErrnoException(error) ? error.code : undefined;
}

/**
 * One property of a caught value, read as `unknown` — a child-process
 * failure's `stdout`, `status`, `signal` or `stderr` — or `undefined` when the
 * caught value is not an object.
 */
export function caughtProperty(error: unknown, key: string): unknown {
  return isRecord(error) ? error[key] : undefined;
}

/** Whether `value` is one of `tokens` — membership that narrows, unlike `Array.prototype.includes`. */
export function isOneOf<const T extends string>(tokens: readonly T[], value: unknown): value is T {
  return tokens.some((token) => token === value);
}

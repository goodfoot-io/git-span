/**
 * Returns `value`, throwing (and so failing the calling test) when it is
 * `undefined`. Narrows `noUncheckedIndexedAccess` reads such as `records[0]`
 * in test assertions without a non-null assertion.
 */
export function defined<T>(value: T | undefined, what = 'value'): T {
  if (value === undefined) throw new Error(`expected ${what} to be defined`);
  return value;
}

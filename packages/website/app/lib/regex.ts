/**
 * Capture group `index` of a regex match whose pattern guarantees the group
 * participates (a non-optional group). Throws instead of returning
 * `undefined`, so a pattern edit that makes the group optional fails loudly.
 *
 * @param match - A successful `exec`/`matchAll` result.
 * @param index - The capture group number.
 * @summary Required capture group of a regex match
 */
export function capture(match: RegExpMatchArray, index: number): string {
  const value = match[index];
  if (value === undefined) {
    throw new Error(`capture group ${index} did not participate in match ${JSON.stringify(match[0])}`);
  }
  return value;
}

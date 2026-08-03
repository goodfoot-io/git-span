/**
 * Relative-plus-absolute age formatting for the span viewer's ISO timestamps:
 * a commit's v2 `date` field in the History accordion, and the `.span`
 * declaration's `updatedAt` in the "Updated ..." line under the why prose.
 *
 * Lives apart from `main.ts` because that module's import of `monaco-editor`
 * and `./main.css` makes it loadable only in the webview's browser bundle.
 * Nothing here touches the DOM, so the extension host's Mocha suite can
 * import and exercise it directly.
 *
 * The absolute half renders through `toLocaleString` with the host's default
 * locale and time zone -- deliberately, so the label reads in the reader's own
 * conventions. Callers that need a stable string across machines must not
 * depend on its exact form.
 *
 * @summary Relative + absolute age labels for the span viewer's ISO dates.
 * @module spanViewer/webview/formatAge
 */

/** Seconds under which an age reads `just now` rather than a counted unit. */
const JUST_NOW_SECONDS = 45;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;
const SECONDS_PER_WEEK = 604800;
/** The 30-day month this scale uses; calendar months are not modelled. */
const SECONDS_PER_MONTH = 2592000;
/** The 365-day year this scale uses; leap years are not modelled. */
const SECONDS_PER_YEAR = 31536000;

/**
 * `N unit(s) ago` phrasing for relative ages.
 *
 * @param count - The elapsed count in `unit`s.
 * @param unit - The singular unit name.
 * @returns The relative-age phrase.
 * @throws Never.
 */
function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

/**
 * Relative + absolute age of an ISO timestamp, e.g.
 * `1 day ago (Jul 29, 2026 at 3:12 PM)`.
 *
 * An unparseable input is echoed back verbatim rather than rendered as an
 * epoch or a guess: a caller that cannot produce a real date must not be made
 * to look like it did.
 *
 * Future timestamps clamp to `just now` -- a clock skew between the committer
 * and the reader must not surface as a negative age.
 *
 * @param isoDate - The ISO date string to label.
 * @param now - Epoch milliseconds to measure the age against; defaults to the
 *   current time and exists so tests can pin every bucket boundary exactly.
 * @returns The combined age label, or `isoDate` unchanged when unparseable.
 * @throws Never.
 */
export function formatAge(isoDate: string, now: number = Date.now()): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  const absolute = date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000));
  let relative: string;
  if (seconds < JUST_NOW_SECONDS) {
    relative = 'just now';
  } else if (seconds < SECONDS_PER_HOUR) {
    relative = plural(Math.round(seconds / SECONDS_PER_MINUTE), 'minute');
  } else if (seconds < SECONDS_PER_DAY) {
    relative = plural(Math.round(seconds / SECONDS_PER_HOUR), 'hour');
  } else if (seconds < SECONDS_PER_WEEK) {
    relative = plural(Math.round(seconds / SECONDS_PER_DAY), 'day');
  } else if (seconds < SECONDS_PER_MONTH) {
    relative = plural(Math.round(seconds / SECONDS_PER_WEEK), 'week');
  } else if (seconds < SECONDS_PER_YEAR) {
    relative = plural(Math.round(seconds / SECONDS_PER_MONTH), 'month');
  } else {
    relative = plural(Math.round(seconds / SECONDS_PER_YEAR), 'year');
  }
  return `${relative} (${absolute})`;
}

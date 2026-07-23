/**
 * Aggregating index of every signal module. Signals are loaded as
 * default-exported closures from here rather than imported by name at each
 * call site, so knip's generic `packages/*` entry (src/**\/*.ts) sees every
 * signal module as reachable from `entry` — re-exporting them here keeps
 * Stage 1's fan-out of six new files from being flagged as unused exports.
 */

export { default as timeWindow } from './time-window.js';

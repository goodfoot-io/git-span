/**
 * Aggregating index of every signal module. Signals are loaded as
 * default-exported closures from here rather than imported by name at each
 * call site, so knip's generic `packages/*` entry (src/**\/*.ts) sees every
 * signal module as reachable from `entry` — re-exporting them here keeps
 * Stage 1's fan-out of six new files from being flagged as unused exports.
 */

export { default as associationRules } from './association-rules.js';
export { default as commitMessageSimilarity } from './commit-message-similarity.js';
export { default as conceptualSimilarity } from './conceptual-similarity.js';
export { default as releaseTagDelta } from './release-tag-delta.js';
export { default as sameAuthorSession } from './same-author-session.js';
export { default as sharedConfigKeys } from './shared-config-keys.js';
export { default as timeWindow } from './time-window.js';

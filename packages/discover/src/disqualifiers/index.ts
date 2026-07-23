/**
 * Aggregating index of every disqualifier module. Disqualifiers are loaded
 * as default-exported closures from here rather than imported by name at
 * each call site, so knip's generic `packages/*` entry (src/**\/*.ts) sees
 * every disqualifier module as reachable from `entry` — re-exporting them
 * here keeps Stage 1's new tree-sitter-reference.ts from being flagged as an
 * unused export.
 */

export { default as rawPathInclusion } from './raw-path-inclusion.js';
export { default as treeSitterReference } from './tree-sitter-reference.js';

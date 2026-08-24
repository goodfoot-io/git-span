// Fresh-consumer probe for the rkyv-js resolution gate: this import uses the
// bare specifier alone — no paths mapping, no bundler alias — so tsc binding
// it proves the dependency is consumable exactly as its manifest declares.
// Type-checked by the sibling tsconfig.json as part of
// scripts/check-rkyv-resolution.mjs.
export { decode, encode } from 'rkyv-js';

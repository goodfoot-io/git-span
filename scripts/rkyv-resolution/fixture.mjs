// Fresh-consumer probe for the rkyv-js resolution gate: this import uses the
// bare specifier alone — no paths mapping, no bundler alias — so tsc binding
// it proves the dependency is consumable exactly as its manifest declares.
// Type-checked by the sibling tsconfig.json as part of
// scripts/check-rkyv-resolution.mjs.
//
// rkyv-js 0.3.x has no free encode/decode functions; codecs are built from the
// root's schema primitives and carry encode/decode as methods.
import * as rkyv from 'rkyv-js';

const Probe = rkyv.taggedEnum({ Off: null, On: { level: rkyv.u32 } });

export const probeOk = typeof Probe.encode === 'function' && typeof Probe.decode === 'function';

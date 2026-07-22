// The engine stage's resting/default background color -- the exact pixel color shown behind the
// transparent engine canvas whenever no color beat (see engine/backdrop.ts) is active. Slightly
// lighter than the page ground (--color-ground in global.css, #f4f1e8) so the stage panel reads
// as its own surface, not a literal continuation of the page; the two are deliberately no longer
// required to match. engine/backdrop.ts is the single source of truth for the full t-varying
// color (panel gradient CSS + WebGL fog) built on top of this default -- read that module, not
// this constant, wherever the actual per-frame color is needed.
export const STAGE_BACKGROUND_DEFAULT_CSS = '#f5f3eb';
export const STAGE_BACKGROUND_DEFAULT = 0xf5f3eb;

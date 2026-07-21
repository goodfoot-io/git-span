// Single source of truth for the engine stage's background color. This is the exact pixel
// color shown behind the transparent engine canvas (EngineStage renders it as the containing
// div's CSS background, and EngineScene fogs distant parts toward it so they blend into the
// page instead of picking up a mismatched haze). It must equal the page ground
// (--color-ground in global.css) and the theme-color meta in root.tsx.
export const STAGE_BACKGROUND_CSS = '#f4f1e8';
export const STAGE_BACKGROUND = 0xf4f1e8;

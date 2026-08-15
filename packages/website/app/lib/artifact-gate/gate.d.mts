/**
 * Type declaration for the umbrella artifact gate module, so the meta-gate
 * test suite can import it from `gate.mjs` under `moduleResolution: "Bundler"`.
 */

/** Emit every website-owned committed artifact into `toDir` (default: their
 * committed locations), regenerating from `skillsRoot` (default: the
 * normative plugin skill tree). */
export function generateArtifacts(options?: { toDir?: string; skillsRoot?: string }): void;

/**
 * Compare every website-owned committed artifact under `root` against fresh
 * generation from `skillsRoot` (defaults: the committed locations and the
 * normative plugin skill tree). Reports stale artifacts on stderr and returns
 * true when any is stale.
 */
export function checkArtifacts(options?: { root?: string; skillsRoot?: string }): boolean;

/** Render the full declared inventory table. */
export function renderInventory(): string;

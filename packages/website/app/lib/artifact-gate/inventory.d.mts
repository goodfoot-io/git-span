/**
 * Type declaration for the declared artifact inventory module, so the
 * meta-gate test suite can import it from `inventory.mjs` under
 * `moduleResolution: "Bundler"`.
 */

export type ArtifactKind = 'committed-generated' | 'committed-authored' | 'runtime';

export interface ArtifactEntry {
  /** The published path (or path pattern) the artifact is served at or committed under. */
  path: string;
  /** The human-facing label used in stale messages. */
  label: string;
  kind: ArtifactKind;
  /** The human-authored source the artifact derives from. */
  source: string;
  /** The generator or renderer that produces it. */
  generator: string;
  /** Paths to the renderer files that produce it, package-root-relative. */
  generatorFiles: string[];
  /** Which gate checks this artifact for drift. */
  check: string;
  /** The command that fixes a stale artifact, null when it has no regeneration step. */
  fixCommand: string | null;
  /** The banner marker committed-generated artifacts carry, null when bannerless. */
  banner: string | null;
  /** Why a committed-generated artifact is bannerless, null when it carries a banner. */
  bannerJustification: string | null;
  /** Executable renderer for website-owned committed output; null for delegated or runtime entries. */
  render: ((options: { toDir: string; skillsRoot: string }) => void) | null;
}

export const artifacts: ArtifactEntry[];

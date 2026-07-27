/**
 * Shared contracts for the implicit-coupling discovery pipeline.
 *
 * The pipeline scans a repository's working tree into a {@link RepoScan},
 * loads its git history into a {@link RepoHistory}, runs every {@link Signal}
 * over those two pure data structures to produce scored {@link Candidate}
 * groups, then merges, ranks, and emits them. Signals are pure functions of
 * (scan, history, config), so every stage is testable without a repository.
 *
 * @summary Type contracts shared by all discovery modules.
 */

/**
 * A file, or a 1-based inclusive line range within a file.
 */
export interface Loc {
  /** Repository-relative POSIX path. */
  path: string;
  /** First line of the range (1-based, inclusive); absent = whole file. */
  start?: number;
  /** Last line of the range (1-based, inclusive); absent = whole file. */
  end?: number;
}

/**
 * One scored coupling hypothesis produced by a single signal.
 */
export interface Candidate {
  /** The coupled locations (at least two; every path is in `scan.files`). */
  locs: Loc[];
  /** Confidence in (0, 1] as judged by the producing signal alone. */
  score: number;
  /** Name of the producing signal; drives merge-time attenuation. */
  signal: string;
  /** Compact machine-oriented tags for debugging; never rendered as prose. */
  evidence: readonly string[];
}

/**
 * Immutable snapshot of the repository working tree.
 */
export interface RepoScan {
  /** Absolute path to the repository root. */
  root: string;
  /**
   * All referencable tracked files (sorted). Excludes configured prefixes,
   * noise (lockfiles, logs, caches), and generated/vendored/compiled files.
   * Binary assets remain listed — they may be coupling targets — but have no
   * entry in {@link RepoScan.text}.
   */
  files: readonly string[];
  /** Content of scannable text files — a subset of {@link RepoScan.files}. */
  text: ReadonlyMap<string, string>;
  /** Line-split view of {@link RepoScan.text}. */
  lines: ReadonlyMap<string, readonly string[]>;
  /** First path segment of every file that lives in a subdirectory. */
  topLevelDirs: ReadonlySet<string>;
  /** Directory prefixes (with trailing `/`) classified as documentation. */
  docsDirs: readonly string[];
}

/**
 * One non-merge commit, normalized for mining.
 */
export interface CommitMeta {
  /** Full commit hash. */
  sha: string;
  /** Committer timestamp, unix seconds. */
  timestamp: number;
  /** Author email. */
  author: string;
  /** First line of the commit message. */
  subject: string;
  /**
   * Changed paths, rename-resolved to their current names and filtered to
   * files that still exist in the scan.
   */
  files: readonly string[];
  /** True for version-bump / release commits (excluded from mining). */
  isRelease: boolean;
}

/**
 * A logical unit of work: one or more commits merged for co-change mining.
 */
export interface ChangeGroup {
  /** Deduplicated union of member commits' current-name files. */
  files: readonly string[];
  /** Timestamp of the newest member commit, unix seconds. */
  timestamp: number;
  /** Number of commits merged into this group. */
  commitCount: number;
}

/**
 * Immutable snapshot of the repository's git history.
 */
export interface RepoHistory {
  /** Non-merge commits in chronological order. */
  commits: readonly CommitMeta[];
  /** sha → full message (subject + body, conflict trailers stripped). */
  messages: ReadonlyMap<string, string>;
  /** Logical change groups (release commits excluded). */
  changeGroups: readonly ChangeGroup[];
  /**
   * Share (0..1) of non-release commits whose message names at least one
   * repository path — how much this repo's commit messages can be trusted
   * as a coupling signal.
   */
  messageQuality: number;
}

/**
 * Tunable discovery options. Defaults live in `config.ts`.
 */
export interface DiscoverConfig {
  /**
   * Repository-relative path prefixes excluded from scanning, history, and
   * output entirely (POSIX form, no leading `./`, no trailing `/`).
   */
  exclude: readonly string[];
  /** Maximum number of merged candidates to emit. */
  maxCandidates: number;
  /** Merged candidates scoring below this are dropped. */
  minScore: number;
  /** Whether the commit-message signal runs at all. */
  useCommitMessages: boolean;
  /** Files larger than this many bytes are not content-scanned. */
  maxFileBytes: number;
}

/**
 * Executes `git <args>` in `cwd`, returning stdout; throws on failure.
 */
export type GitRunner = (args: readonly string[], cwd: string) => string;

/**
 * One coupling detector running over the pure scan/history snapshots.
 */
export interface Signal {
  /** Stable identifier used in evidence tags and merge attenuation. */
  readonly name: string;
  /**
   * Cheap gate: whether this signal is meaningful for the repository at all
   * (for example, manifest wiring only when a matching manifest exists).
   *
   * @param scan - Working-tree snapshot.
   * @param history - Git-history snapshot.
   * @param config - Discovery options.
   * @returns True when {@link Signal.run} should be invoked.
   */
  applies(scan: RepoScan, history: RepoHistory, config: DiscoverConfig): boolean;
  /**
   * Produce every candidate this signal can justify on its own.
   *
   * @param scan - Working-tree snapshot.
   * @param history - Git-history snapshot.
   * @param config - Discovery options.
   * @returns Scored candidates (deterministic order for identical inputs).
   */
  run(scan: RepoScan, history: RepoHistory, config: DiscoverConfig): Candidate[];
}

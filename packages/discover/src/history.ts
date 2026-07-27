/**
 * Git history loader: mines commit structure and messages into an immutable
 * {@link RepoHistory} snapshot the rest of the pipeline can mine without
 * touching git again.
 *
 * Two `git log` invocations do the work: one walks `--name-status` to
 * recover per-commit changed files (resolving renames to their current
 * names), the other walks raw commit bodies for message mining. Commits are
 * grouped into logical units of work ({@link ChangeGroup}) for co-change
 * statistics, and classified as release/version-bump noise so mining signals
 * can ignore them.
 *
 * @summary Loads and normalizes a repository's git history.
 */

import { posix } from 'node:path';
import { defaultGitRunner } from './git.js';
import type { ChangeGroup, CommitMeta, DiscoverConfig, GitRunner, RepoHistory, RepoScan } from './types.js';

const RECORD_SEP = '\x1e';
const FIELD_SEP = '\x1f';

/** Subject-line shapes that mark a commit as a version bump / release. */
const RELEASE_SUBJECT_PATTERNS: readonly RegExp[] = [
  /^(?:chore(?:\(release\))?[:!]?\s*)?release\b/i,
  /^bump\b/i,
  /^v?\d+\.\d+\.\d+(?:[-+.\w]*)?$/,
  /^prepare (?:for )?release/i,
  /^update (?:changelog|versions?)\b/i
];

/** Basenames whose presence-only filesets mark a "version in unison" commit. */
const VERSION_UNISON_BASENAMES = new Set([
  'package.json',
  'CHANGELOG.md',
  'Cargo.toml',
  'pyproject.toml',
  'VERSION',
  'version.ts',
  'versions.json'
]);

/** Ticket-token shapes used to decide whether two commits share a ticket reference. */
const TICKET_TOKEN_PATTERNS: readonly RegExp[] = [/#\d{2,6}\b/g, /\b[A-Z][A-Z0-9]+-\d+\b/g];

const MERGE_SAME_AUTHOR_GAP_SECONDS = 45 * 60;
const MERGE_TICKET_GAP_SECONDS = 24 * 60 * 60;

/** One `--name-status` commit record before rename resolution / scan filtering. */
interface RawCommit {
  sha: string;
  timestamp: number;
  author: string;
  subject: string;
  files: string[];
  renames: Array<readonly [string, string]>;
}

/**
 * Load and normalize the git history of the repository at `root`.
 *
 * @param root - Absolute path to the repository root.
 * @param scan - Working-tree snapshot; commit paths are filtered to this.
 * @param config - Resolved discovery configuration (see `resolveConfig`).
 * @param git - Git command runner; defaults to {@link defaultGitRunner}.
 * @returns Immutable snapshot of commits, messages, change groups, and
 *   message quality.
 * @throws {Error} If either git invocation fails.
 */
export function loadHistory(
  root: string,
  scan: RepoScan,
  config: DiscoverConfig,
  git: GitRunner = defaultGitRunner
): RepoHistory {
  const excludeArgs = config.exclude.map((prefix) => `:(exclude)${prefix}`);

  const structureRaw = git(
    [
      'log',
      '--no-merges',
      '--reverse',
      '-M',
      '--name-status',
      `--format=${RECORD_SEP}%H${FIELD_SEP}%ct${FIELD_SEP}%ae${FIELD_SEP}%s`,
      '--',
      '.',
      ...excludeArgs
    ],
    root
  );
  const rawCommits = parseStructure(structureRaw);
  const alias = buildAliasMap(rawCommits);
  const scanFiles = new Set(scan.files);
  const commits = rawCommits.map((rc) => resolveCommit(rc, alias, scanFiles));

  const shaSet = new Set(commits.map((c) => c.sha));
  const messagesRaw = git(
    ['log', '--no-merges', `--format=${RECORD_SEP}%H${FIELD_SEP}%B`, '--', '.', ...excludeArgs],
    root
  );
  const messages = parseMessages(messagesRaw, shaSet);

  const changeGroups = buildChangeGroups(commits);
  const messageQuality = computeMessageQuality(commits, messages, scan.files);

  return { commits, messages, changeGroups, messageQuality };
}

/**
 * Parse the `--name-status` invocation's stdout into raw, unresolved commits.
 *
 * @param raw - Complete stdout of the structure git invocation.
 * @returns Commits in chronological order, files not yet rename-resolved.
 */
function parseStructure(raw: string): RawCommit[] {
  const commits: RawCommit[] = [];
  for (const record of raw.split(RECORD_SEP)) {
    if (record === '') continue;
    const newlineIdx = record.indexOf('\n');
    const header = newlineIdx === -1 ? record : record.slice(0, newlineIdx);
    const rest = newlineIdx === -1 ? '' : record.slice(newlineIdx + 1);
    const [sha, ct, author, subject] = splitFour(header, FIELD_SEP);

    const files: string[] = [];
    const renames: Array<readonly [string, string]> = [];
    for (const line of rest.split('\n')) {
      if (line === '') continue;
      const tabIdx = line.indexOf('\t');
      if (tabIdx === -1) continue;
      const status = line.slice(0, tabIdx);
      const remainder = line.slice(tabIdx + 1);
      if (status.startsWith('R') || status.startsWith('C')) {
        const parts = remainder.split('\t');
        if (parts.length !== 2) continue;
        const [oldPath, newPath] = parts;
        if (oldPath === undefined || newPath === undefined) continue;
        if (status.startsWith('R')) renames.push([oldPath, newPath]);
        files.push(newPath);
      } else {
        files.push(remainder);
      }
    }
    commits.push({ sha, timestamp: Number(ct), author, subject, files, renames });
  }
  return commits;
}

/**
 * Split a string into exactly four fields on the first three occurrences of
 * `sep`, with the fourth field retaining any further occurrences verbatim.
 *
 * @param line - String to split.
 * @param sep - Field separator.
 * @returns Four fields (later ones default to `''` when the input is short).
 */
function splitFour(line: string, sep: string): [string, string, string, string] {
  const first = line.indexOf(sep);
  if (first === -1) return [line, '', '', ''];
  const second = line.indexOf(sep, first + 1);
  if (second === -1) return [line.slice(0, first), line.slice(first + 1), '', ''];
  const third = line.indexOf(sep, second + 1);
  if (third === -1) return [line.slice(0, first), line.slice(first + 1, second), line.slice(second + 1), ''];
  return [line.slice(0, first), line.slice(first + 1, second), line.slice(second + 1, third), line.slice(third + 1)];
}

/**
 * Build a historical-name -> latest-name alias map by walking every rename
 * event in chronological order. On each `old -> new` rename, every existing
 * alias currently resolving to `old` (plus `old` itself) is re-pointed to
 * `new`, so the resulting map is always single-hop resolvable.
 *
 * @param rawCommits - Chronologically ordered raw commits.
 * @returns Alias map from any historical name to its current name.
 */
function buildAliasMap(rawCommits: readonly RawCommit[]): Map<string, string> {
  const alias = new Map<string, string>();
  for (const commit of rawCommits) {
    for (const [oldPath, newPath] of commit.renames) {
      for (const [historical, current] of alias) {
        if (current === oldPath) alias.set(historical, newPath);
      }
      alias.set(oldPath, newPath);
    }
  }
  return alias;
}

/**
 * Resolve a raw commit's changed paths through the alias map and filter to
 * scan membership, then classify it as a release commit.
 *
 * @param rc - Raw, unresolved commit.
 * @param alias - Final historical-name -> latest-name alias map.
 * @param scanFiles - Set of files known to the working-tree scan.
 * @returns The normalized CommitMeta.
 */
function resolveCommit(rc: RawCommit, alias: ReadonlyMap<string, string>, scanFiles: ReadonlySet<string>): CommitMeta {
  const resolved = new Set<string>();
  for (const f of rc.files) {
    const current = alias.get(f) ?? f;
    if (scanFiles.has(current)) resolved.add(current);
  }
  const files = [...resolved].sort();
  return {
    sha: rc.sha,
    timestamp: rc.timestamp,
    author: rc.author,
    subject: rc.subject,
    files,
    isRelease: computeIsRelease(rc.subject, files)
  };
}

/**
 * Decide whether a commit is a version-bump / release commit.
 *
 * @param subject - Commit subject line.
 * @param files - Resolved, deduplicated, sorted changed files.
 * @returns True when the subject matches a release shape, or every changed
 *   file is a version-in-unison manifest.
 */
function computeIsRelease(subject: string, files: readonly string[]): boolean {
  if (RELEASE_SUBJECT_PATTERNS.some((pattern) => pattern.test(subject))) return true;
  if (files.length === 0) return false;
  return files.every((f) => VERSION_UNISON_BASENAMES.has(posix.basename(f)));
}

/**
 * Parse the message invocation's stdout into a sha -> stripped-message map,
 * limited to shas already known from the structure invocation.
 *
 * @param raw - Complete stdout of the message git invocation.
 * @param knownShas - Shas present in the structure invocation's commits.
 * @returns Map of sha to full message with Conflicts trailers stripped.
 */
function parseMessages(raw: string, knownShas: ReadonlySet<string>): Map<string, string> {
  const messages = new Map<string, string>();
  for (const record of raw.split(RECORD_SEP)) {
    if (record === '') continue;
    const sepIdx = record.indexOf(FIELD_SEP);
    if (sepIdx === -1) continue;
    const sha = record.slice(0, sepIdx);
    if (!knownShas.has(sha)) continue;
    const body = record.slice(sepIdx + 1);
    const stripped = stripConflictsTrailer(body).replace(/\n+$/, '');
    messages.set(sha, stripped);
  }
  return messages;
}

/**
 * Remove a `Conflicts:` trailer block from a commit message, from the line
 * matching `Conflicts:` through the following blank line (or end of text).
 *
 * @param body - Raw commit message body.
 * @returns The message with any Conflicts trailer removed.
 */
function stripConflictsTrailer(body: string): string {
  const lines = body.split('\n');
  const idx = lines.findIndex((l) => /^Conflicts:\s*$/.test(l));
  if (idx === -1) return body;
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i += 1) {
    if (lines[i] === '') {
      end = i + 1;
      break;
    }
  }
  lines.splice(idx, end - idx);
  return lines.join('\n');
}

/**
 * Extract the set of ticket tokens (`#1234`, `ABC-123`) mentioned in text.
 *
 * @param text - Text to scan.
 * @returns Distinct matched ticket tokens.
 */
function ticketTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const pattern of TICKET_TOKEN_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      tokens.add(match[0]);
    }
  }
  return tokens;
}

/**
 * Decide whether `commit` should merge into the change group ending at
 * `prev`: same author within 45 minutes, or a shared ticket token within 24
 * hours.
 *
 * @param prev - The previous qualifying commit (chronologically).
 * @param commit - The candidate commit to merge.
 * @returns True when `commit` belongs in the same change group as `prev`.
 */
function shouldMergeIntoGroup(prev: CommitMeta, commit: CommitMeta): boolean {
  const gapSeconds = commit.timestamp - prev.timestamp;
  if (commit.author === prev.author && gapSeconds <= MERGE_SAME_AUTHOR_GAP_SECONDS) return true;
  if (gapSeconds > MERGE_TICKET_GAP_SECONDS) return false;
  const commitTokens = ticketTokens(commit.subject);
  if (commitTokens.size === 0) return false;
  const prevTokens = ticketTokens(prev.subject);
  for (const token of commitTokens) {
    if (prevTokens.has(token)) return true;
  }
  return false;
}

/**
 * Merge non-release commits with at least one file into logical change
 * groups for co-change mining.
 *
 * @param commits - Chronologically ordered, normalized commits.
 * @returns Change groups in chronological order of formation.
 */
function buildChangeGroups(commits: readonly CommitMeta[]): ChangeGroup[] {
  const groups: ChangeGroup[] = [];
  let currentFiles: Set<string> | null = null;
  let currentTimestamp = 0;
  let currentCommitCount = 0;
  let prevCommit: CommitMeta | null = null;

  const flush = (): void => {
    if (currentFiles === null) return;
    groups.push({ files: [...currentFiles].sort(), timestamp: currentTimestamp, commitCount: currentCommitCount });
  };

  for (const commit of commits) {
    if (commit.isRelease || commit.files.length === 0) continue;
    if (currentFiles !== null && prevCommit !== null && shouldMergeIntoGroup(prevCommit, commit)) {
      for (const f of commit.files) currentFiles.add(f);
      currentTimestamp = Math.max(currentTimestamp, commit.timestamp);
      currentCommitCount += 1;
    } else {
      flush();
      currentFiles = new Set(commit.files);
      currentTimestamp = commit.timestamp;
      currentCommitCount = 1;
    }
    prevCommit = commit;
  }
  flush();

  return groups;
}

/**
 * Check whether a message token resolves unambiguously to a scan file.
 *
 * @param token - Candidate token extracted from a commit message.
 * @param scanFileSet - Set of all scan files.
 * @param scanFiles - All scan files (for suffix scanning).
 * @param basenameIndex - Basename -> owning scan files.
 * @returns True when the token names exactly one scan file.
 */
function tokenNamesScanFile(
  token: string,
  scanFileSet: ReadonlySet<string>,
  scanFiles: readonly string[],
  basenameIndex: ReadonlyMap<string, readonly string[]>
): boolean {
  if (token.includes('/')) {
    if (scanFileSet.has(token)) return true;
    const suffix = `/${token}`;
    let count = 0;
    for (const f of scanFiles) {
      if (f.endsWith(suffix)) count += 1;
      if (count > 1) return false;
    }
    return count === 1;
  }
  if (token.length < 8 || !token.includes('.')) return false;
  const owners = basenameIndex.get(token);
  return owners !== undefined && owners.length === 1;
}

/**
 * Compute the share of non-release commits whose message names at least one
 * repository path.
 *
 * @param commits - Normalized commits.
 * @param messages - Sha -> full stripped message.
 * @param scanFiles - All scan files.
 * @returns Fraction in [0, 1]; 0 when there are no non-release commits.
 */
function computeMessageQuality(
  commits: readonly CommitMeta[],
  messages: ReadonlyMap<string, string>,
  scanFiles: readonly string[]
): number {
  const nonRelease = commits.filter((c) => !c.isRelease);
  if (nonRelease.length === 0) return 0;

  const scanFileSet = new Set(scanFiles);
  const basenameIndex = new Map<string, string[]>();
  for (const f of scanFiles) {
    const base = posix.basename(f);
    const owners = basenameIndex.get(base);
    if (owners) owners.push(f);
    else basenameIndex.set(base, [f]);
  }

  const tokenPattern = /[\w@./-]+/g;
  let matching = 0;
  for (const commit of nonRelease) {
    const text = messages.get(commit.sha) ?? commit.subject;
    for (const match of text.matchAll(tokenPattern)) {
      if (tokenNamesScanFile(match[0], scanFileSet, scanFiles, basenameIndex)) {
        matching += 1;
        break;
      }
    }
  }
  return matching / nonRelease.length;
}

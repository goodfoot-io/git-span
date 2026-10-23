import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { argvOf, splitTopLevel, tokenize } from './shell-split.js';

/** Complete selection result; unsuccessful selection never exposes a partial commit set. */
export type CommitInspectionSelection =
  | { kind: 'unsupported'; recognized: boolean }
  | { kind: 'failed'; reason: string }
  | { kind: 'selected'; repoRoot: string; commits: string[] };

const MAX_COMMITS = 4096;
const MAX_OUTPUT = 4 * 1024 * 1024;
const DEADLINE_MS = 3000;
const FLAGS = new Set([
  '--all',
  '--first-parent',
  '--exclude-first-parent-only',
  '--ancestry-path',
  '--no-merges',
  '--merges',
  '--reverse',
  '--date-order',
  '--author-date-order',
  '--topo-order',
  '--do-walk',
  '--no-walk',
  '--follow',
  '--full-history',
  '--simplify-merges',
  '--simplify-by-decoration',
  '--dense',
  '--sparse',
  '--remove-empty',
  '--all-match',
  '--invert-grep',
  '--regexp-ignore-case',
  '--basic-regexp',
  '--extended-regexp',
  '--fixed-strings',
  '--perl-regexp',
  '--pickaxe-all',
  '--pickaxe-regex',
  '--boundary',
  '--left-right',
  '--cherry-mark',
  '--cherry-pick',
  '--left-only',
  '--right-only',
  '--cherry',
  '--single-worktree',
  '--ignore-missing',
  '--full-diff',
  '--root',
  '--no-root',
  '-i',
  '-E',
  '-F',
  '-P',
  '-m',
  '-c',
  '--cc',
  '--first-parent',
  '--no-renames',
  '--find-copies-harder',
  '--ignore-all-space',
  '--ignore-space-change',
  '--ignore-space-at-eol',
  '--ignore-cr-at-eol',
  '--ignore-blank-lines'
]);
const VALUES = new Set([
  '--max-count',
  '--skip',
  '--since',
  '--after',
  '--until',
  '--before',
  '--since-as-filter',
  '--author',
  '--committer',
  '--grep',
  '--min-parents',
  '--max-parents',
  '--exclude',
  '--diff-filter',
  '--find-object'
]);
const OPTIONAL_VALUES = new Set(['--branches', '--tags', '--remotes', '--glob', '--ancestry-path', '--no-walk']);
const PRESENTATION = new Set([
  '--oneline',
  '--graph',
  '--patch',
  '--no-patch',
  '--raw',
  '--stat',
  '--numstat',
  '--shortstat',
  '--summary',
  '--name-only',
  '--name-status',
  '--check',
  '--patch-with-stat',
  '--patch-with-raw',
  '--compact-summary',
  '--no-decorate',
  '--decorate',
  '--no-color',
  '--color',
  '--abbrev-commit',
  '--no-abbrev-commit',
  '--no-abbrev',
  '--show-signature',
  '--no-show-signature',
  '--log-size',
  '--fuller',
  '-p',
  '-u',
  '-s',
  '-z'
]);
const PRESENTATION_VALUES = new Set(['--date', '--encoding']);

interface Inspection {
  cwd: string;
  subcommand: 'show' | 'log';
  args: string[];
}

function literalWords(text: string): string[] | null {
  // No expansion is evaluated by the selector; decline even quoted expansion syntax.
  if (/[$`\n\r\0]/.test(text)) return null;
  const tokens = tokenize(text);
  if (tokens === null || tokens.some((token) => token.isRedirect)) return null;
  if (tokens.some((token) => !token.quoted && /[*?[\]~{}]/.test(token.text))) {
    // Revision syntax HEAD~2 and HEAD^{tree} is handled by Git, not Bash expansion.
    if (tokens.some((token) => !token.quoted && /[*?[\]]|^~|\{[^}]*,/.test(token.text))) return null;
  }
  return tokens.map((token) => token.text);
}

/** Accept only one literal command or a literal cd joined to one command by &&. */
function literalStages(command: string): string[] | null {
  let quote: "'" | '"' | null = null;
  let start = 0;
  const stages: string[] = [];
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (char === '\\') {
      index++;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '#' && (index === 0 || /[\s;&|()]/.test(command[index - 1] ?? ''))) {
      if (command.includes('\n', index)) return null;
      return [...stages, command.slice(start, index).trim()];
    }
    if (char === '&' && command[index + 1] === '&') {
      stages.push(command.slice(start, index).trim());
      index++;
      start = index + 1;
    } else if (char !== undefined && /[;&|()\n\r]/.test(char)) return null;
  }
  if (quote !== null) return null;
  return [...stages, command.slice(start).trim()];
}

function inspect(command: string, cwd: string): Inspection | null {
  const stages = literalStages(command);
  if (stages === null) return null;
  let stage = stages[0];
  if (stages.length === 2) {
    const prefix = stage === undefined ? null : literalWords(stage);
    stage = stages[1];
    if (prefix?.length !== 2 || prefix[0] !== 'cd' || prefix[1] === '-') return null;
    cwd = resolve(cwd, prefix[1] ?? '');
  } else if (stages.length !== 1) return null;
  const argv = stage === undefined ? null : literalWords(stage);
  if (argv === null || argv[0] !== 'git') return null;
  let index = 1;
  while (argv[index] === '-C') {
    const directory = argv[index + 1];
    if (directory === undefined) return null;
    cwd = resolve(cwd, directory);
    index += 2;
  }
  const subcommand = argv[index];
  if (subcommand !== 'show' && subcommand !== 'log') return null;
  return { cwd, subcommand, args: argv.slice(index + 1) };
}

/** Only simple userformats are interpreted; nested directives and configured aliases fail closed. */
function userFormatWantsNotes(format: string): boolean | null {
  if (!format.includes('%') && !/^(?:t?format):/.test(format)) return null;
  if (format.includes('(')) return null;
  for (let index = 0; index < format.length; index++) {
    if (format[index] !== '%') continue;
    let code = format[++index];
    if (code === '%') continue;
    if (code === '+' || code === '-' || code === ' ') code = format[++index];
    if (code === 'N') return true;
    if (code === 'x' && /^[0-9a-f]{2}$/i.test(format.slice(index + 1, index + 3))) index += 2;
  }
  return false;
}

function normalize(args: string[]): { args: string[]; revisions: string[] } | null {
  const retained: string[] = [];
  const revisions: string[] = [];
  let explicitNotes = false;
  let format: string | undefined;
  let formatCount = 0;
  let grep = false;
  const finish = (paths: string[]): { args: string[]; revisions: string[] } | null => {
    let notes: string[] = [];
    if (!explicitNotes) {
      if (format === undefined) notes = ['--notes'];
      else if (!grep) notes = ['--no-notes'];
      else {
        // Multiple formats and pretty aliases have native state that cannot be reconstructed safely here.
        if (formatCount > 1) return null;
        const builtin = /^(?:oneline|short|medium|full|fuller|reference|email|mboxrd|raw)$/.test(format);
        const wants = builtin ? false : userFormatWantsNotes(format);
        if (wants === null) return null;
        notes = [wants ? '--notes' : '--no-notes'];
      }
    }
    return {
      args: [...retained, '--format=%H', '--no-patch', '--no-decorate', ...notes, ...revisions, ...paths],
      revisions
    };
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined) break;
    if (arg === '--') return finish(args.slice(index));
    if (!arg.startsWith('-') || arg === '-') {
      if (arg === '-' || arg.includes('\n')) return null;
      revisions.push(arg);
      continue;
    }
    const name = arg.split('=')[0] ?? arg;
    if (arg === '--notes' || arg === '--show-notes' || arg === '--no-notes' || /^--(?:notes|show-notes)=/.test(arg)) {
      explicitNotes = true;
      retained.push(arg);
      continue;
    }
    if (arg === '--oneline' || name === '--pretty' || (name === '--format' && arg.includes('='))) {
      format = arg === '--oneline' ? 'oneline' : arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : 'medium';
      formatCount++;
      continue;
    }
    if (PRESENTATION.has(arg) || /^--(?:color|decorate|stat|abbrev)=/.test(arg) || /^-U\d*$/.test(arg)) continue;
    if (name === '--abbrev') continue;
    if (name === '--grep') grep = true;
    if (PRESENTATION_VALUES.has(name)) {
      if (!arg.includes('=') && args[++index] === undefined) return null;
      continue;
    }
    if (FLAGS.has(arg) || /^-\d+$/.test(arg) || OPTIONAL_VALUES.has(name)) {
      retained.push(arg);
      continue;
    }
    if (VALUES.has(name) || arg === '-n' || arg === '-S' || arg === '-G') {
      retained.push(arg);
      if (!arg.includes('=')) {
        const value = args[++index];
        if (value === undefined || value === '--') return null;
        retained.push(value);
      }
      continue;
    }
    if (/^-(?:n\d+|[SG].+|[MC](?:\d+%?)?)$/.test(arg) || /^--(?:find-renames|find-copies)(?:=\d+%?)?$/.test(arg)) {
      retained.push(arg);
      continue;
    }
    if (/^--diff-merges=(?:off|none|on|first-parent|1|separate|m|combined|c|dense-combined|cc|remerge|r)$/.test(arg)) {
      retained.push(arg);
      continue;
    }
    return null;
  }
  return finish([]);
}

/** Recognize intent without claiming that an ambiguous shell stage executed. */
function recognizesInspection(command: string): boolean {
  return [command, ...splitTopLevel(command).stages.map((stage) => stage.text)].some((stage) => {
    const words = argvOf(stage);
    if (words === null) return false;
    let index = 0;
    while (/^[A-Za-z_][A-Za-z_0-9]*=/.test(words[index] ?? '')) index++;
    if (words[index++] !== 'git') return false;
    while (words[index]?.startsWith('-')) {
      const option = words[index++];
      if (option === '-C' || option === '-c' || option === '--git-dir' || option === '--work-tree') index++;
    }
    const subcommand = words[index++];
    if (subcommand !== 'show' && subcommand !== 'log') return false;
    const args = words.slice(index);
    if (subcommand === 'show') {
      const normalized = normalize(args);
      const revisions =
        normalized?.revisions ?? args.slice(0, args.indexOf('--') < 0 ? args.length : args.indexOf('--'));
      if (revisions.some((arg) => !arg.startsWith('-') && arg.includes(':'))) return false;
    }
    return true;
  });
}

async function runGit(cwd: string, args: string[], deadline: number, input?: string): Promise<string> {
  const remaining = Math.floor(deadline - performance.now());
  if (remaining <= 0) throw new Error('Commit selection exceeded its 3-second deadline');
  return new Promise((resolveOutput, reject) => {
    const child = execFile(
      'git',
      ['--no-pager', '-c', 'log.showSignature=false', ...args],
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: MAX_OUTPUT,
        timeout: remaining,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1' }
      },
      (error, stdout) => {
        if (error !== null) reject(new Error(`Commit selection failed: ${error.message}`));
        else resolveOutput(stdout);
      }
    );
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(input);
  });
}

/**
 * Resolve supported literal show/log commands through native Git, independent of tool stdout.
 * Refs are observed after tool completion. Selection fails above 4096 commits,
 * 4 MiB subprocess output, or a total 3-second deadline across all subprocesses.
 */
export async function resolveCommitInspection(command: string, cwd: string): Promise<CommitInspectionSelection> {
  const invocation = inspect(command, cwd);
  if (invocation === null) return { kind: 'unsupported', recognized: recognizesInspection(command) };
  const normalized = normalize(invocation.args);
  if (invocation.subcommand === 'show' && normalized?.revisions.some((rev) => rev.includes(':'))) {
    return { kind: 'unsupported', recognized: false };
  }
  if (normalized === null) return { kind: 'unsupported', recognized: true };
  const deadline = performance.now() + DEADLINE_MS;
  try {
    if (
      [
        'GIT_DIR',
        'GIT_WORK_TREE',
        'GIT_COMMON_DIR',
        'GIT_INDEX_FILE',
        'GIT_OBJECT_DIRECTORY',
        'GIT_ALTERNATE_OBJECT_DIRECTORIES',
        'GIT_REPLACE_REF_BASE',
        'GIT_GRAFT_FILE'
      ].some((key) => process.env[key] !== undefined)
    ) {
      return { kind: 'unsupported', recognized: true };
    }
    const discovery = (
      await runGit(invocation.cwd, ['rev-parse', '--show-toplevel', '--git-path', 'info/grafts'], deadline)
    )
      .trimEnd()
      .split('\n');
    if (discovery.length !== 2 || discovery[0] === undefined || discovery[1] === undefined) {
      return { kind: 'failed', reason: 'Repository discovery returned ambiguous paths' };
    }
    const repoRoot = realpathSync(discovery[0]);
    if (existsSync(resolve(invocation.cwd, discovery[1]))) return { kind: 'unsupported', recognized: true };
    const replacements = await runGit(repoRoot, ['for-each-ref', '--format=%(refname)', 'refs/replace/'], deadline);
    if (replacements.trim() !== '') return { kind: 'unsupported', recognized: true };
    const configuration = await runGit(repoRoot, ['config', '--list', '--null'], deadline);
    if (
      configuration.split('\0').some((entry) => /^(?:diff\..*\.(?:textconv|command)|diff\.external)\n/i.test(entry))
    ) {
      return { kind: 'unsupported', recognized: true };
    }
    const simpleRevisions = normalized.revisions.filter((rev) => !rev.includes('..') && !rev.startsWith('^'));
    if (invocation.subcommand === 'show' && simpleRevisions.length > 0) {
      const types = await runGit(
        invocation.cwd,
        ['cat-file', '--batch-check=%(objecttype)'],
        deadline,
        `${simpleRevisions.join('\n')}\n`
      );
      if (
        types
          .trim()
          .split('\n')
          .some((type) => ['blob', 'tree', 'tag'].includes(type))
      ) {
        return { kind: 'unsupported', recognized: true };
      }
    }
    const output = await runGit(
      invocation.cwd,
      [invocation.subcommand, '--no-ext-diff', '--no-textconv', ...normalized.args],
      deadline
    );
    const lines = output.trim() === '' ? [] : output.trimEnd().split('\n');
    if (lines.length > MAX_COMMITS) return { kind: 'failed', reason: 'Commit selection exceeds 4096 commits' };
    if (lines.some((line) => !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(line))) {
      return { kind: 'failed', reason: 'Commit selection returned malformed object identities' };
    }
    const commits = [...new Set(lines)];
    if (commits.length > 0) {
      const verified = await runGit(
        repoRoot,
        ['cat-file', '--batch-check=%(objectname) %(objecttype)'],
        deadline,
        `${commits.join('\n')}\n`
      );
      const records = verified.trimEnd().split('\n');
      if (records.length !== commits.length || records.some((line, index) => line !== `${commits[index]} commit`)) {
        return { kind: 'failed', reason: 'Commit selection contains unavailable or non-commit objects' };
      }
    }
    return { kind: 'selected', repoRoot, commits };
  } catch (error) {
    return { kind: 'failed', reason: (error instanceof Error ? error.message : String(error)).slice(0, 1024) };
  }
}

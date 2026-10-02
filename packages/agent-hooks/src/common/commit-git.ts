/** Pure argv and reflog evidence contracts for the invocation-local Git shim. */
import { isAbsolute, resolve } from 'node:path';
import type { CommitObjectFormat, CommitValidation } from './commit-contracts.js';

export interface CommitGitInvocation {
  /** Exact original argv, including global options, is forwarded once. */
  readonly argv: readonly string[];
  readonly effectiveCwd: string;
  /** Original global options retained for repository probes with the same Git semantics. */
  readonly globalArguments: readonly string[];
  readonly command: string;
  readonly commandArguments: readonly string[];
  readonly gitDirectory?: string;
  readonly workTree?: string;
  readonly builtinCommit: boolean;
  readonly dryRun: boolean;
}

/** Parse repeated -C, -c, --config-env, --git-dir and --work-tree without shell parsing or alias expansion. */
export function parseCommitGitInvocation(argv: readonly string[], cwd: string): CommitValidation<CommitGitInvocation> {
  const reject = (reason: string): CommitValidation<CommitGitInvocation> => ({ ok: false, reason });
  if (!isAbsolute(cwd) || argv.some((arg) => arg.includes('\0'))) return reject('invalid Git argv or cwd');
  let effectiveCwd = cwd;
  let gitDirectory: string | undefined;
  let workTree: string | undefined;
  let index = 0;
  const switches = new Set([
    '--no-pager',
    '--paginate',
    '-p',
    '-P',
    '--bare',
    '--no-replace-objects',
    '--literal-pathspecs',
    '--glob-pathspecs',
    '--noglob-pathspecs',
    '--icase-pathspecs',
    '--no-optional-locks'
  ]);
  while (index < argv.length && argv[index].startsWith('-')) {
    const argument = argv[index];
    if (switches.has(argument)) {
      index++;
      continue;
    }
    let option: string;
    let value: string | undefined;
    if (
      argument === '-C' ||
      argument === '-c' ||
      argument === '--git-dir' ||
      argument === '--work-tree' ||
      argument === '--config-env'
    ) {
      option = argument;
      value = argv[++index];
    } else if (argument.startsWith('-C') || argument.startsWith('-c')) {
      option = argument.slice(0, 2);
      value = argument.slice(2);
    } else {
      const equals = argument.indexOf('=');
      option = equals < 0 ? argument : argument.slice(0, equals);
      value = equals < 0 ? undefined : argument.slice(equals + 1);
      if (!['--git-dir', '--work-tree', '--config-env'].includes(option))
        return reject('unsupported Git global option');
    }
    if (value === undefined || (value === '' && option !== '-C')) return reject('incomplete Git global option');
    if (option === '-C' && value !== '') effectiveCwd = resolve(effectiveCwd, value);
    if (option === '--git-dir') gitDirectory = value;
    if (option === '--work-tree') workTree = value;
    index++;
  }
  const command = argv[index];
  if (!command) return reject('missing Git builtin command');
  const commandArguments = argv.slice(index + 1);
  let dryRun = false;
  const consumes = new Set([
    '-m',
    '--message',
    '-F',
    '--file',
    '-C',
    '--reuse-message',
    '-c',
    '--reedit-message',
    '--author',
    '--date',
    '--fixup',
    '--squash',
    '-t',
    '--template',
    '--pathspec-from-file',
    '--trailer',
    '--cleanup'
  ]);
  for (let i = 0; i < commandArguments.length; i++) {
    const argument = commandArguments[i];
    if (argument === '--') break;
    if (consumes.has(argument)) {
      i++;
      continue;
    }
    if (argument === '--dry-run') dryRun = true;
  }
  return {
    ok: true,
    value: {
      argv: [...argv],
      effectiveCwd,
      globalArguments: argv.slice(0, index),
      command,
      commandArguments,
      builtinCommit: command === 'commit',
      dryRun: command === 'commit' && dryRun,
      ...(gitDirectory === undefined ? {} : { gitDirectory }),
      ...(workTree === undefined ? {} : { workTree })
    }
  };
}

/** A missing pre-execution reflog is allowed for unborn HEAD; an existing log must retain its identity. */
export type CommitReflogCheckpoint =
  | { readonly existed: false; readonly offset: 0 }
  | { readonly existed: true; readonly device: string; readonly inode: string; readonly offset: number };

/** The IO adapter reads at most the evidence budget and reports actual metadata rather than trusting receipt metadata. */
export interface CommitReflogAppend {
  readonly device: string;
  readonly inode: string;
  readonly fileSize: number;
  readonly bytes: Uint8Array;
  readonly exceededBudget: boolean;
}

export interface CommitCreationEvidence {
  readonly checkpoint: CommitReflogCheckpoint;
  readonly append: CommitReflogAppend | null;
  readonly objectFormat: CommitObjectFormat;
  readonly nonce: string;
  readonly gitExitCode: number | null;
  readonly gitSignal: string | null;
  readonly builtinCommit: boolean;
  readonly dryRun: boolean;
}

/** Exactly one complete nonce-tagged transition after successful builtin commit yields the frozen full SHA. */
export function validateCommitCreationEvidence(evidence: CommitCreationEvidence): CommitValidation<string> {
  const reject = (reason: string): CommitValidation<string> => ({ ok: false, reason });
  if (!evidence.builtinCommit || evidence.dryRun || evidence.gitExitCode !== 0 || evidence.gitSignal !== null) {
    return reject('no successful builtin commit');
  }
  if (!/^[a-zA-Z0-9_-]{1,256}$/.test(evidence.nonce)) return reject('invalid reflog nonce');
  if (evidence.objectFormat !== 'sha1' && evidence.objectFormat !== 'sha256')
    return reject('unsupported object format');
  const { append, checkpoint } = evidence;
  if (!append) return reject('missing HEAD reflog');
  if (!Number.isSafeInteger(checkpoint.offset) || checkpoint.offset < 0 || !Number.isSafeInteger(append.fileSize)) {
    return reject('invalid reflog offset');
  }
  if (checkpoint.existed && (checkpoint.device !== append.device || checkpoint.inode !== append.inode)) {
    return reject('reflog replaced');
  }
  if (append.exceededBudget || append.bytes.byteLength > 1_048_576) return reject('reflog evidence exceeds budget');
  if (append.fileSize < checkpoint.offset || append.fileSize - checkpoint.offset !== append.bytes.byteLength) {
    return reject('reflog truncated or incomplete read');
  }
  const length = evidence.objectFormat === 'sha1' ? 40 : 64;
  const header = new RegExp(`^([0-9a-f]{${length}}) ([0-9a-f]{${length}}) .+ <[^>]*> [0-9]+ [+-][0-9]{4}$`);
  const text = new TextDecoder().decode(append.bytes);
  if (text.length === 0 || !text.endsWith('\n')) return reject('incomplete reflog evidence');
  const lines = text.slice(0, -1).split('\n');
  const matches: string[] = [];
  for (const line of lines) {
    const tab = line.indexOf('\t');
    if (tab < 0) return reject('malformed reflog evidence');
    const parsed = header.exec(line.slice(0, tab));
    if (!parsed) return reject('malformed reflog evidence');
    if (!line.slice(tab + 1).startsWith(`${evidence.nonce}: `)) continue;
    if (/^0+$/.test(parsed[2]) || parsed[1] === parsed[2]) return reject('invalid nonce-tagged transition');
    matches.push(parsed[2]);
  }
  return matches.length === 1
    ? { ok: true, value: matches[0] }
    : reject('missing or ambiguous nonce-tagged transition');
}

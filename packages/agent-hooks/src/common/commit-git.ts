/** Pure Git argv classification and reflog checkpoint contracts. */
import { isAbsolute, resolve } from 'node:path';
import type { CommitValidation } from './commit-contracts.js';

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
  for (let argument = argv[index]; argument?.startsWith('-') === true; argument = argv[index]) {
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
    if (argument === undefined || argument === '--') break;
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
  | {
      readonly existed: true;
      readonly device: string;
      readonly inode: string;
      readonly offset: number;
      readonly prefixDigest: string;
    };

/** The IO adapter reads at most the evidence budget and reports actual metadata rather than trusting receipt metadata. */
export interface CommitReflogAppend {
  readonly device: string;
  readonly inode: string;
  readonly fileSize: number;
  readonly bytes: Uint8Array;
  readonly exceededBudget: boolean;
}

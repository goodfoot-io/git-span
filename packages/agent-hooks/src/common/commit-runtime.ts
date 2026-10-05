/** Host-facing receipt runtime. This state root is independent of session touch storage. */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import {
  commitAssociationKey,
  selectCommitAssociation,
  validateCommitNotesAdd,
  validateCommitNotesList
} from './commit-association.js';
import type { CommitEnrollment, CommitHost, CommitPostIdentity, CommitReceipt } from './commit-contracts.js';
import {
  createCommitNoteDocument,
  restoreCommitInvocation,
  serializeCommitNoteDocument,
  validateCommitEnrollment,
  validateCommitReceipt
} from './commit-contracts.js';
import { parseCommitGitInvocation, validateCommitCreationEvidence } from './commit-git.js';
import type { CommitNotesIO } from './commit-io.js';
import { COMMIT_RECEIPT_LIMITS, type CommitInvocationState, commitCliBudgetMs } from './commit-lifecycle.js';
import {
  checkpointCommitReflog,
  executableOnPath,
  executeCommitGit,
  executeCommitNotes,
  readCommitReflogAppend,
  resolveCommitRepository,
  verifyCommitObject
} from './commit-native-io.js';
import {
  acquireReceiptClaim,
  appendReceiptDiagnostic,
  atomicJson,
  boundedEntries,
  identityKey,
  ownerLiveness,
  privateDirectory,
  privateEmptyFile,
  readJson,
  reserveReceiptCapacity
} from './commit-storage.js';
import { argvOf, splitTopLevel, tokenize } from './shell-split.js';

/** Host logging adapter; normal enrollment and successful recording remain silent. */
export interface CommitRuntimeLogger {
  warn(message: string, fields?: Record<string, unknown>): void;
}

/** Inject a private scratch root and real CLI adapter in acceptance checks. Defaults use production discovery. */
export interface CommitRuntimeOptions {
  readonly stateRoot?: string;
  readonly notesExecutable?: string;
  readonly notesIO?: CommitNotesIO;
}

export interface CommitEnrollmentRequest extends CommitPostIdentity {
  /** Effective shell cwd already resolved from the actual supported host envelope. */
  readonly cwd: string;
  /** The inspected direct shell input; only a nonempty command string is enrolled. */
  readonly toolInput: Readonly<Record<string, unknown>>;
  readonly transcriptLocator?: string;
  /** Absolute deployed pre-hook bundle. The launcher never references a workspace checkout. */
  readonly bundlePath: string;
}

export type CommitEnrollmentResult =
  | {
      readonly kind: 'enrolled';
      readonly updatedInput: Readonly<Record<string, unknown>>;
      readonly enrollment: CommitEnrollment;
    }
  | { readonly kind: 'unsupported'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** Freeze original host identity and input, publish private instrumentation, then return command-only replacement. */
export async function enrollCommitInvocation(
  request: CommitEnrollmentRequest,
  options: CommitRuntimeOptions = {},
  logger?: CommitRuntimeLogger
): Promise<CommitEnrollmentResult> {
  const unsupported = inspectInput(request.toolInput);
  if (unsupported !== null) {
    logger?.warn(`git-span commit receipts: ${unsupported}`);
    return { kind: 'unsupported', reason: unsupported };
  }
  const command = request.toolInput.command as string;
  const root = receiptRoot(options);
  const key = identityKey(request);
  const directory = join(root, 'invocations', key);
  const deadline = performance.now() + COMMIT_RECEIPT_LIMITS.drainMs;
  try {
    privateDirectory(root);
    privateDirectory(join(root, 'invocations'));
    const claim = await acquireReceiptClaim(root, `invocation-${key}`, deadline);
    if (!claim) throw new Error('invocation enrollment ownership unavailable');
    try {
      const enrollmentPath = join(directory, 'enrollment.json');
      if (existsSync(enrollmentPath)) {
        const existing = validateCommitEnrollment(readJson(enrollmentPath));
        if (!existing.ok) throw new Error(existing.reason);
        const state = readState(directory, existing.value);
        if (
          state.status !== 'active' ||
          JSON.stringify(existing.value.originalInput) !== JSON.stringify(request.toolInput) ||
          existing.value.cwd !== request.cwd
        )
          throw new Error('invocation key cannot be reused');
        return {
          kind: 'enrolled',
          enrollment: existing.value,
          updatedInput: replacementInput(existing.value, directory)
        };
      }
      if (!isAbsolute(request.bundlePath) || !lstatSync(request.bundlePath).isFile())
        throw new Error('deployed shim bundle must be an absolute file');
      if (!lstatSync(realpathSync(request.cwd)).isDirectory())
        throw new Error('effective shell cwd must be a directory');
      const enrollment: CommitEnrollment = {
        schemaVersion: 1,
        invocationKey: randomBytes(24).toString('hex'),
        host: request.host,
        sessionId: request.sessionId,
        toolUseId: request.toolUseId,
        originalInput: JSON.parse(JSON.stringify(request.toolInput)) as Record<string, unknown>,
        originalCommand: command,
        cwd: request.cwd,
        gitExecutable: executableOnPath('git'),
        ...(request.transcriptLocator === undefined ? {} : { transcriptLocator: request.transcriptLocator })
      };
      const valid = validateCommitEnrollment(enrollment);
      if (!valid.ok) throw new Error(valid.reason);
      const config = { schemaVersion: 1, root, directory, enrollment: valid.value };
      const launcher = `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(request.bundlePath)} --git-span-commit-shim ${quote(join(directory, 'shim.json'))} -- "$@"\n`;
      const state: CommitInvocationState = {
        enrollment: valid.value,
        status: 'active',
        pendingNonces: [],
        liveLease: true,
        lastActivityMs: Date.now()
      };
      // Reserve the largest reachable lifecycle representation, including all pending keys.
      const maximumState = {
        ...state,
        status: 'acknowledged',
        pendingNonces: Array.from({ length: COMMIT_RECEIPT_LIMITS.receiptsPerInvocation }, () =>
          'x'.repeat(COMMIT_RECEIPT_LIMITS.identityKeyBytes)
        ),
        liveLease: false,
        lastActivityMs: Number.MAX_SAFE_INTEGER
      };
      const serializedBytes = [valid.value, config, maximumState].map((value) =>
        Buffer.byteLength(JSON.stringify(value))
      );
      const initialBytes = serializedBytes.reduce((sum, bytes) => sum + bytes, 0) + Buffer.byteLength(launcher) + 32768;
      if (
        serializedBytes.some((bytes) => bytes > COMMIT_RECEIPT_LIMITS.jsonFileBytes) ||
        initialBytes > COMMIT_RECEIPT_LIMITS.bytesPerInvocation
      ) {
        const reason = 'serialized receipt envelope exceeds private state bounds';
        logger?.warn(`git-span commit receipts: ${reason}`);
        return { kind: 'unsupported', reason };
      }
      if (
        initialBytes > COMMIT_RECEIPT_LIMITS.bytesPerInvocation ||
        !(await reserveReceiptCapacity(root, 1, initialBytes, deadline))
      )
        throw new Error('private receipt state capacity exceeded');
      try {
        privateDirectory(directory);
        privateDirectory(join(directory, 'bin'));
        privateDirectory(join(directory, 'receipts'));
        privateEmptyFile(join(directory, 'lease'));
        atomicJson(enrollmentPath, valid.value, true);
        atomicJson(join(directory, 'state.json'), state);
        atomicJson(join(directory, 'usage.json'), { bytes: initialBytes, receipts: 0 });
        atomicJson(join(directory, 'shim.json'), config, true);
        writeFileSync(join(directory, 'bin', 'git'), launcher, { mode: 0o700, flag: 'wx' });
        chmodSync(join(directory, 'bin', 'git'), 0o700);
      } catch (error) {
        await reserveReceiptCapacity(root, -1, -initialBytes, deadline);
        rmSync(directory, { recursive: true, force: true });
        throw error;
      }
      return { kind: 'enrolled', enrollment: valid.value, updatedInput: replacementInput(valid.value, directory) };
    } finally {
      claim.release();
    }
  } catch (error) {
    const reason = errorMessage(error);
    logger?.warn(`git-span commit receipts: ${reason}`);
    return { kind: 'unavailable', reason };
  }
}

export interface CommitTerminalResult {
  /** Original input remains available on duplicate posts independently of touch consumption or receipt acknowledgment. */
  readonly original: {
    readonly input: Readonly<Record<string, unknown>>;
    readonly command: string;
    readonly cwd: string;
  } | null;
  readonly acknowledged: number;
  readonly pending: number;
}

/** Correlate a terminal delivery, restore immutable input, and drain independently within one 3-second phase. */
export async function terminalCommitInvocation(
  identity: CommitPostIdentity,
  options: CommitRuntimeOptions = {},
  logger?: CommitRuntimeLogger
): Promise<CommitTerminalResult> {
  const root = receiptRoot(options);
  const directory = join(root, 'invocations', identityKey(identity));
  const started = performance.now();
  let result: CommitTerminalResult = { original: null, acknowledged: 0, pending: 0 };
  if (!existsSync(directory)) return result;
  try {
    const valid = validateCommitEnrollment(readJson(join(directory, 'enrollment.json')));
    if (!valid.ok) throw new Error(valid.reason);
    const original = restoreCommitInvocation(valid.value, identity);
    if (!original.ok) throw new Error(original.reason);
    const restored = { ...result, original: original.value };
    result = restored;
    try {
      const lease = readFileSync(join(directory, 'lease'), 'utf8');
      if (!/^[1-9][0-9]*$/.test(lease)) logger?.warn('git-span commit receipts: invocation lease unavailable');
    } catch {
      logger?.warn('git-span commit receipts: invocation lease unavailable');
    }
    const claim = await acquireReceiptClaim(
      root,
      `invocation-${identityKey(identity)}`,
      started + COMMIT_RECEIPT_LIMITS.drainMs
    );
    if (!claim) {
      logger?.warn('git-span commit receipts: invocation drain ownership unavailable');
      return restored;
    }
    try {
      const state = readState(directory, valid.value);
      if (state.status === 'retired') return restored;
      atomicJson(join(directory, 'state.json'), {
        ...state,
        status: 'completed',
        liveLease: false,
        lastActivityMs: Date.now()
      });
      const drained = await drainDirectory(root, directory, valid.value, options, started, logger);
      return { ...restored, ...drained };
    } finally {
      claim.release();
    }
  } catch (error) {
    logger?.warn(`git-span commit receipts: ${errorMessage(error)}`);
    return result;
  }
}

export interface CommitCleanupResult {
  readonly acknowledged: number;
  readonly pending: number;
  readonly retired: number;
}

/** Retry completed work within one shared 3-second phase; preserve active leases and Codex continuing sessions. */
export async function cleanupCommitInvocations(
  host: CommitHost,
  sessionId: string,
  options: CommitRuntimeOptions = {},
  logger?: CommitRuntimeLogger
): Promise<CommitCleanupResult> {
  const root = receiptRoot(options);
  const started = performance.now();
  const deadline = started + COMMIT_RECEIPT_LIMITS.drainMs;
  const result = { acknowledged: 0, pending: 0, retired: 0 };
  if (!existsSync(join(root, 'invocations'))) return result;
  try {
    for (const key of boundedEntries(join(root, 'invocations'), COMMIT_RECEIPT_LIMITS.invocations, deadline)) {
      if (performance.now() >= deadline) {
        logger?.warn('git-span commit receipts: cleanup deadline exhausted');
        break;
      }
      const directory = join(root, 'invocations', key);
      const valid = validateCommitEnrollment(readJson(join(directory, 'enrollment.json')));
      if (!valid.ok) {
        logger?.warn(`git-span commit receipts: ${valid.reason}`);
        continue;
      }
      const claim = await acquireReceiptClaim(root, `invocation-${key}`, deadline);
      if (!claim) {
        logger?.warn('git-span commit receipts: cleanup invocation ownership unavailable');
        continue;
      }
      try {
        const state = readState(directory, valid.value);
        const abandoned = Date.now() - state.lastActivityMs >= COMMIT_RECEIPT_LIMITS.abandonedRetentionMs;
        if (abandoned && (state.status !== 'active' || !invocationIsLive(directory))) {
          const usage = readUsage(directory);
          logger?.warn('git-span commit receipts: expired abandoned state and pending evidence');
          if (await reserveReceiptCapacity(root, -1, -usage.bytes, deadline)) {
            rmSync(directory, { recursive: true });
            result.retired++;
          }
          continue;
        }
        if (valid.value.host !== host || valid.value.sessionId !== sessionId || state.status === 'active') continue;
        if (state.status === 'retired') continue;
        const drained = await drainDirectory(root, directory, valid.value, options, started, logger);
        result.acknowledged += drained.acknowledged;
        result.pending += drained.pending;
        if (drained.pending === 0) {
          atomicJson(join(directory, 'state.json'), {
            ...state,
            status: 'retired',
            pendingNonces: [],
            liveLease: false,
            lastActivityMs: Date.now()
          });
          result.retired++;
        }
      } finally {
        claim.release();
      }
    }
  } catch (error) {
    logger?.warn(`git-span commit receipts: ${errorMessage(error)}`);
  }
  return result;
}

/**
 * Call before host protocol stdin is consumed. Returns false for ordinary hook argv.
 * Matching --git-span-commit-shim <absolute-config> -- <git-argv> executes the Git child exactly once,
 * publishes evidence without changing inherited stdio, then terminates with the original exit/signal outcome.
 */
export async function dispatchCommitShim(argv: readonly string[] = process.argv.slice(2)): Promise<boolean> {
  if (argv[0] !== '--git-span-commit-shim') return false;
  const configPath = argv[1];
  if (!configPath || !isAbsolute(configPath) || argv[2] !== '--') throw new Error('invalid receipt shim dispatch');
  const config = readJson(configPath) as {
    schemaVersion: number;
    root: string;
    directory: string;
    enrollment: unknown;
  };
  const valid = validateCommitEnrollment(config.enrollment);
  if (config.schemaVersion !== 1 || !valid.ok || !isAbsolute(config.root) || !isAbsolute(config.directory))
    throw new Error('invalid immutable receipt shim configuration');
  const enrollment = valid.value;
  const gitArgv = argv.slice(3);
  const parsed = parseCommitGitInvocation(gitArgv, process.cwd());
  const nonce = `receipt-${randomBytes(24).toString('hex')}`;
  let repository: CommitReceipt['repository'] | null = null;
  let checkpoint: ReturnType<typeof checkpointCommitReflog> | null = null;
  if (parsed.ok && parsed.value.builtinCommit && !parsed.value.dryRun) {
    try {
      repository = resolveCommitRepository(enrollment.gitExecutable, parsed.value.globalArguments, process.cwd());
      checkpoint = checkpointCommitReflog(repository.headReflog);
    } catch (error) {
      appendReceiptDiagnostic(config.directory, errorMessage(error));
    }
  } else if (!parsed.ok) appendReceiptDiagnostic(config.directory, parsed.reason);
  const result = await executeCommitGit(
    enrollment.gitExecutable,
    gitArgv,
    process.cwd(),
    parsed.ok && parsed.value.builtinCommit ? nonce : undefined
  );
  if (repository !== null && checkpoint !== null) {
    try {
      const evidence = validateCommitCreationEvidence({
        checkpoint,
        append: readCommitReflogAppend(repository.headReflog, checkpoint, COMMIT_RECEIPT_LIMITS.reflogBytes),
        objectFormat: repository.objectFormat,
        nonce,
        gitExitCode: result.exitCode,
        gitSignal: result.signal,
        builtinCommit: true,
        dryRun: false
      });
      if (!evidence.ok) {
        if (result.exitCode === 0 && result.signal === null) appendReceiptDiagnostic(config.directory, evidence.reason);
      } else {
        const object = verifyCommitObject(enrollment.gitExecutable, repository, evidence.value);
        if (!object.ok) appendReceiptDiagnostic(config.directory, object.reason);
        else
          await publishReceipt(config.root, config.directory, {
            schemaVersion: 1,
            invocationKey: enrollment.invocationKey,
            nonce,
            sha: evidence.value,
            repository
          });
      }
    } catch (error) {
      appendReceiptDiagnostic(config.directory, errorMessage(error));
    }
  }
  if (result.signal !== null) {
    process.kill(process.pid, result.signal as NodeJS.Signals);
    await new Promise(() => {});
  }
  process.exit(result.exitCode ?? 127);
}

function receiptRoot(options: CommitRuntimeOptions): string {
  return options.stateRoot ?? join(homedir(), '.cache', 'git-span', 'commit-receipts');
}
function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}
function inspectInput(input: Readonly<Record<string, unknown>>): string | null {
  if (typeof input.command !== 'string' || input.command.length === 0) return 'unsupported shell input';
  if (
    input.run_in_background === true ||
    input.background === true ||
    input.delegated === true ||
    input.worker === true
  )
    return 'background or delegated execution is unsupported';
  const split = splitTopLevel(input.command);
  if (split.stages.some((stage) => stage.precededBy === 'background') || /&\s*$/.test(input.command))
    return 'background shell execution is unsupported';
  for (const stage of split.stages) {
    const args = argvOf(stage.text) ?? [];
    const tokens = tokenize(stage.text) ?? [];
    const leadingAssignments: string[] = [];
    for (const token of tokens) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(token.text)) break;
      leadingAssignments.push(token.text);
    }
    const wrapper = args[0]?.split('/').at(-1);
    if (
      leadingAssignments.some((arg) => /^PATH=/.test(arg)) ||
      (['export', 'env'].includes(wrapper ?? '') && args.some((arg) => /^PATH=/.test(arg))) ||
      (args[0] === 'unset' && args.includes('PATH')) ||
      (wrapper === 'env' && (args.includes('-i') || args.includes('--ignore-environment')))
    )
      return 'observable instrumentation PATH override is unsupported';
    // Walk visible wrapper prefixes, rather than treating their arguments as ordinary Git argv.
    let executableIndex = 0;
    for (; executableIndex < args.length; ) {
      let index = executableIndex;
      const name = args[index]?.split('/').at(-1);
      if (
        (name === 'export' && args.slice(index + 1).some((arg) => /^PATH=/.test(arg))) ||
        (name === 'unset' && args.slice(index + 1).includes('PATH'))
      )
        return 'observable instrumentation PATH override is unsupported';
      if (!['builtin', 'command', 'exec', 'env', 'hash'].includes(name ?? '')) break;
      if (name === 'hash' && args.length > index + 1)
        return 'observable executable-search mutation bypasses receipt instrumentation';
      index++;
      for (let arg = args[index]; arg !== undefined; arg = args[index]) {
        if (arg === '--') {
          index++;
          break;
        }
        if (name === 'command' && /^-[^-]*p/.test(arg))
          return 'observable executable-search mutation bypasses receipt instrumentation';
        if (
          name === 'env' &&
          (/^PATH=/.test(arg) ||
            arg === '--ignore-environment' ||
            /^-[^-]*i/.test(arg) ||
            arg === '--unset=PATH' ||
            /^(?:-[^-]*u)PATH$/.test(arg) ||
            ((arg === '-u' || arg === '--unset') && args[index + 1] === 'PATH') ||
            arg === '-S' ||
            arg.startsWith('--split-string'))
        )
          return 'observable executable-search mutation bypasses receipt instrumentation';
        if (name === 'env' && ['-u', '--unset', '-C', '--chdir'].includes(arg)) {
          index += 2;
          continue;
        }
        if (arg.startsWith('-') || (name === 'env' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(arg))) {
          index++;
          continue;
        }
        break;
      }
      executableIndex = index;
    }
    const executable = args[executableIndex];
    if (executable !== undefined && isAbsolute(executable) && /(?:^|\/)git$/.test(executable))
      return 'absolute Git invocation bypasses receipt instrumentation';
  }
  return null;
}
function replacementInput(enrollment: CommitEnrollment, directory: string): Readonly<Record<string, unknown>> {
  const command = `{ printf '%s' "$$" > ${quote(join(directory, 'lease'))}; } 2>/dev/null || :; export PATH=${quote(join(directory, 'bin'))}:"$PATH"; ${enrollment.originalCommand}`;
  return { ...enrollment.originalInput, command };
}
function readState(directory: string, enrollment: CommitEnrollment): CommitInvocationState {
  const value = readJson(join(directory, 'state.json')) as CommitInvocationState;
  if (
    !['active', 'completed', 'acknowledged', 'retired'].includes(value.status) ||
    !Array.isArray(value.pendingNonces) ||
    value.pendingNonces.length > COMMIT_RECEIPT_LIMITS.receiptsPerInvocation ||
    !Number.isFinite(value.lastActivityMs) ||
    value.enrollment.invocationKey !== enrollment.invocationKey
  )
    throw new Error('invalid private invocation lifecycle');
  return value;
}
function readUsage(directory: string): { bytes: number; receipts: number } {
  const usage = readJson(join(directory, 'usage.json'), 4096) as { bytes: number; receipts: number };
  if (
    !Number.isSafeInteger(usage.bytes) ||
    usage.bytes < 0 ||
    !Number.isSafeInteger(usage.receipts) ||
    usage.receipts < 0
  )
    throw new Error('invalid invocation usage');
  return usage;
}
function invocationIsLive(directory: string): boolean {
  try {
    if (!existsSync(join(directory, 'lease'))) return false;
    const lease = readFileSync(join(directory, 'lease'), 'utf8');
    if (lease === '') return false;
    const pid = Number(lease);
    if (!Number.isSafeInteger(pid) || pid <= 0) return true;
    return ownerLiveness({ token: 'lease', pid }) !== 'dead';
  } catch {
    return true;
  }
}
async function publishReceipt(root: string, directory: string, receipt: CommitReceipt): Promise<void> {
  const deadline = performance.now() + COMMIT_RECEIPT_LIMITS.drainMs;
  const enrollment = validateCommitEnrollment(readJson(join(directory, 'enrollment.json')));
  if (!enrollment.ok) throw new Error(enrollment.reason);
  const key = identityKey(enrollment.value);
  const claim = await acquireReceiptClaim(root, `invocation-${key}`, deadline);
  if (!claim) throw new Error('receipt publication ownership unavailable');
  try {
    const state = readState(directory, enrollment.value);
    if (state.status !== 'active') throw new Error('receipt invocation is no longer active');
    const usage = readUsage(directory);
    const bytes = Buffer.byteLength(JSON.stringify(receipt));
    if (
      usage.receipts >= COMMIT_RECEIPT_LIMITS.receiptsPerInvocation ||
      usage.bytes + bytes > COMMIT_RECEIPT_LIMITS.bytesPerInvocation ||
      !(await reserveReceiptCapacity(root, 0, bytes, deadline))
    )
      throw new Error('receipt capacity exceeded');
    atomicJson(join(directory, 'usage.json'), { bytes: usage.bytes + bytes, receipts: usage.receipts + 1 });
    atomicJson(join(directory, 'receipts', `${receipt.nonce}.json`), receipt, true);
    atomicJson(join(directory, 'state.json'), {
      ...state,
      pendingNonces: [...state.pendingNonces, receipt.nonce],
      lastActivityMs: Date.now()
    });
  } finally {
    claim.release();
  }
}
async function drainDirectory(
  root: string,
  directory: string,
  enrollment: CommitEnrollment,
  options: CommitRuntimeOptions,
  started: number,
  logger?: CommitRuntimeLogger
): Promise<{ acknowledged: number; pending: number }> {
  const deadline = started + COMMIT_RECEIPT_LIMITS.drainMs;
  let acknowledged = 0;
  const names = boundedEntries(join(directory, 'receipts'), COMMIT_RECEIPT_LIMITS.receiptsPerInvocation, deadline);
  for (const name of names) {
    if (performance.now() >= deadline) {
      logger?.warn('git-span commit receipts: receipt drain deadline exhausted');
      break;
    }
    try {
      if (!/^receipt-[a-f0-9]+\.json$/.test(name)) throw new Error('invalid receipt filename');
      const valid = validateCommitReceipt(readJson(join(directory, 'receipts', name)), enrollment);
      if (!valid.ok) throw new Error(valid.reason);
      const document = createCommitNoteDocument(enrollment);
      const association = await acquireReceiptClaim(
        root,
        `association-${commitAssociationKey(valid.value, document)}`,
        deadline
      );
      if (!association) throw new Error('commit association ownership unavailable');
      try {
        const list = await invokeNotes(
          enrollment,
          valid.value,
          options,
          ['list', valid.value.sha, '--exact', '--format', 'json'],
          undefined,
          started
        );
        const existing = validateCommitNotesList(JSON.parse(list), valid.value.sha);
        if (!existing.ok) throw new Error(existing.reason);
        const selected = selectCommitAssociation(document, existing.value);
        if (selected.kind === 'reject') throw new Error(selected.reason);
        if (selected.kind === 'reuse') {
          if (selected.locatorConflict)
            logger?.warn('git-span commit receipts: conflicting transcript locator; existing association retained');
        } else {
          const added = await invokeNotes(
            enrollment,
            valid.value,
            options,
            ['add', valid.value.sha, '--format', 'json'],
            serializeCommitNoteDocument(selected.document),
            started
          );
          const confirmation = validateCommitNotesAdd(JSON.parse(added), valid.value.sha, selected.document);
          if (!confirmation.ok) throw new Error(confirmation.reason);
        }
        if (performance.now() >= deadline) throw new Error('receipt drain deadline exhausted before acknowledgment');
        const usage = readUsage(directory);
        const bytes = lstatSync(join(directory, 'receipts', name)).size;
        rmSync(join(directory, 'receipts', name));
        atomicJson(join(directory, 'usage.json'), {
          bytes: usage.bytes - bytes,
          receipts: Math.max(0, usage.receipts - 1)
        });
        await reserveReceiptCapacity(root, 0, -bytes, deadline);
        acknowledged++;
      } finally {
        association.release();
      }
    } catch (error) {
      logger?.warn(`git-span commit receipts: ${errorMessage(error)}`);
    }
  }
  const pendingNames = boundedEntries(join(directory, 'receipts'), COMMIT_RECEIPT_LIMITS.receiptsPerInvocation);
  const state = readState(directory, enrollment);
  atomicJson(join(directory, 'state.json'), {
    ...state,
    status: pendingNames.length === 0 ? 'acknowledged' : 'completed',
    pendingNonces: pendingNames.map((name) => name.replace(/\.json$/, '')),
    liveLease: false,
    lastActivityMs: Date.now()
  });
  if (existsSync(join(directory, 'diagnostics.json'))) {
    const diagnostics = readJson(join(directory, 'diagnostics.json'), 16384);
    if (Array.isArray(diagnostics))
      for (const message of diagnostics)
        if (typeof message === 'string') logger?.warn(`git-span commit receipts: ${message.slice(0, 512)}`);
    rmSync(join(directory, 'diagnostics.json'));
  }
  return { acknowledged, pending: pendingNames.length };
}
async function invokeNotes(
  enrollment: CommitEnrollment,
  receipt: CommitReceipt,
  options: CommitRuntimeOptions,
  args: readonly string[],
  stdin: string | undefined,
  started: number
): Promise<string> {
  const timeoutMs = commitCliBudgetMs(started, performance.now());
  if (timeoutMs <= 0) throw new Error('receipt drain deadline exhausted');
  const command = {
    cwd: receipt.repository.commonDirectory,
    argv: options.notesExecutable === undefined ? ['span', 'notes', ...args] : ['notes', ...args],
    ...(stdin === undefined ? {} : { stdin }),
    timeoutMs,
    maxOutputBytes: 1_048_576
  };
  const result = await (options.notesIO?.execute(command) ??
    executeCommitNotes(options.notesExecutable ?? enrollment.gitExecutable, command));
  if (result.exitCode !== 0 || result.signal !== null || result.timedOut || result.outputExceeded)
    throw new Error(
      result.timedOut ? 'notes CLI timed out; receipt retained' : 'notes CLI unavailable or failed; receipt retained'
    );
  return result.stdout;
}

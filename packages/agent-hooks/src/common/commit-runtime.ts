/** Host-facing receipt runtime. This state root is independent of session touch storage. */
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  commitAssociationKey,
  selectCommitAssociation,
  validateCommitNotesAdd,
  validateCommitNotesList
} from './commit-association.js';
import type {
  CommitEnrollment,
  CommitHost,
  CommitPostIdentity,
  CommitReceipt,
  CommitValidation
} from './commit-contracts.js';
import {
  createCommitNoteDocument,
  restoreCommitInvocation,
  serializeCommitNoteDocument,
  validateCommitEnrollment,
  validateCommitReceipt
} from './commit-contracts.js';
import type { CommitNotesIO } from './commit-io.js';
import {
  COMMIT_INVOCATION_STATUSES,
  COMMIT_RECEIPT_LIMITS,
  type CommitInvocationState,
  commitCliBudgetMs
} from './commit-lifecycle.js';
import { executableOnPath, executeCommitNotes, verifyCommitObject } from './commit-native-io.js';
import { checkpointCommitInvocation, observedCommitReceipts, readCommitObservations } from './commit-observation.js';
import {
  acquireReceiptClaim,
  atomicJson,
  boundedEntries,
  identityKey,
  privateDirectory,
  readJson
} from './commit-storage.js';
import { resolveGitSpanCommand } from './git-span-command.js';
import { isOneOf, isRecord } from './guards.js';
import { splitTopLevel } from './shell-split.js';

/** Host logging adapter; normal enrollment and successful recording remain silent. */
export interface CommitRuntimeLogger {
  warn(message: string, fields?: Record<string, unknown>): void;
  info?(message: string, fields?: Record<string, unknown>): void;
}

/** Inject a private scratch root and real CLI adapter in acceptance checks. Defaults use production discovery. */
export interface CommitRuntimeOptions {
  readonly stateRoot?: string;
  readonly notesExecutable?: string;
  /** Independently select the native lock helper; notes fault injection must not disable locking. */
  readonly lockExecutable?: string;
  readonly notesIO?: CommitNotesIO;
}

export interface CommitEnrollmentRequest extends CommitPostIdentity {
  /** Effective shell cwd already resolved from the actual supported host envelope. */
  readonly cwd: string;
  /** The inspected direct shell input; only a nonempty command string is enrolled. */
  readonly toolInput: Readonly<Record<string, unknown>>;
  /** Adapter-normalized command; original toolInput is still frozen byte-for-byte as JSON. */
  readonly command?: string;
  /** Other literal commands in a code-mode batch, each with its actual effective cwd. */
  readonly additionalCommands?: readonly { readonly command: string; readonly cwd: string }[];
  readonly transcriptLocator?: string;
}

export type CommitEnrollmentResult =
  | {
      readonly kind: 'enrolled';
      readonly enrollment: CommitEnrollment;
    }
  | { readonly kind: 'unsupported'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** Freeze tool identity and reflog checkpoints without modifying the shell invocation. */
export async function enrollCommitInvocation(
  request: CommitEnrollmentRequest,
  options: CommitRuntimeOptions = {},
  logger?: CommitRuntimeLogger
): Promise<CommitEnrollmentResult> {
  const inspected = inspectInput(request.toolInput, request.command);
  if (!inspected.ok) {
    logger?.warn(`git-span commit receipts: ${inspected.reason}`);
    return { kind: 'unsupported', reason: inspected.reason };
  }
  const command = inspected.value;
  const root = receiptRoot(options);
  const key = identityKey(request);
  const directory = join(root, 'invocations', key);
  const deadline = performance.now() + COMMIT_RECEIPT_LIMITS.drainMs;
  try {
    await privateDirectory(root, deadline);
    await privateDirectory(join(root, 'invocations'), deadline);
    await evictInvocations(
      root,
      key,
      Math.min(deadline, performance.now() + COMMIT_RECEIPT_LIMITS.evictionMs),
      options.lockExecutable,
      logger
    );
    const claim = await acquireReceiptClaim(root, `invocation-${key}`, deadline, options.lockExecutable);
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
          enrollment: existing.value
        };
      }
      if (!lstatSync(realpathSync(request.cwd)).isDirectory())
        throw new Error('effective shell cwd must be a directory');
      const originalInput: unknown = JSON.parse(JSON.stringify(request.toolInput));
      if (!isRecord(originalInput)) throw new Error('shell input is not a JSON object');
      const enrollment: CommitEnrollment = {
        schemaVersion: 1,
        invocationKey: randomBytes(24).toString('hex'),
        host: request.host,
        sessionId: request.sessionId,
        toolUseId: request.toolUseId,
        originalInput,
        originalCommand: command,
        cwd: request.cwd,
        gitExecutable: executableOnPath('git'),
        ...(request.transcriptLocator === undefined ? {} : { transcriptLocator: request.transcriptLocator })
      };
      const valid = validateCommitEnrollment(enrollment);
      if (!valid.ok) throw new Error(valid.reason);
      const commands = request.additionalCommands ?? [];
      if (commands.length > 31) throw new Error('too many shell commands in one invocation');
      const observations = checkpointCommitInvocation(valid.value, deadline);
      const observed = new Set(observations.map((item) => item.repository.headReflog));
      for (const context of commands) {
        const inspectedContext = inspectInput(request.toolInput, context.command);
        if (!inspectedContext.ok) throw new Error(inspectedContext.reason);
        if (!lstatSync(realpathSync(context.cwd)).isDirectory())
          throw new Error('effective shell cwd must be a directory');
        for (const observation of checkpointCommitInvocation(
          { ...valid.value, originalCommand: inspectedContext.value, cwd: context.cwd },
          deadline
        )) {
          if (!observed.has(observation.repository.headReflog)) {
            observed.add(observation.repository.headReflog);
            observations.push(observation);
            if (observations.length > 32) throw new Error('repository observation count exceeds budget');
          }
        }
      }
      const state: CommitInvocationState = {
        enrollment: valid.value,
        status: 'active',
        pendingNonces: [],
        observing: true,
        lastActivityMs: Date.now()
      };
      const executionContexts = [{ command, cwd: request.cwd }, ...commands];
      if ([valid.value, observations, state, executionContexts].some((value) => !fitsJsonFile(value))) {
        const reason = 'serialized receipt envelope exceeds private state bounds';
        logger?.warn(`git-span commit receipts: ${reason}`);
        return { kind: 'unsupported', reason };
      }
      try {
        await privateDirectory(directory, deadline);
        await privateDirectory(join(directory, 'receipts'), deadline);
        atomicJson(enrollmentPath, valid.value, true);
        atomicJson(join(directory, 'state.json'), state);
        atomicJson(join(directory, 'observations.json'), observations, true);
        if (commands.length > 0) atomicJson(join(directory, 'commands.json'), executionContexts, true);
      } catch (error) {
        rmSync(directory, { recursive: true, force: true });
        throw error;
      }
      return { kind: 'enrolled', enrollment: valid.value };
    } finally {
      await claim.release();
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
    /** All effective contexts of a frozen multi-command envelope. */
    readonly executions?: readonly { readonly command: string; readonly cwd: string }[];
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
    const contextsPath = join(directory, 'commands.json');
    const executions = existsSync(contextsPath) ? readExecutionContexts(readJson(contextsPath)) : undefined;
    const restored = {
      ...result,
      original: { ...original.value, ...(executions === undefined ? {} : { executions }) }
    };
    result = restored;
    const claim = await acquireReceiptClaim(
      root,
      `invocation-${identityKey(identity)}`,
      started + COMMIT_RECEIPT_LIMITS.drainMs,
      options.lockExecutable
    );
    if (!claim) {
      logger?.warn('git-span commit receipts: invocation drain ownership unavailable');
      return restored;
    }
    try {
      const state = readState(directory, valid.value);
      if (state.status === 'retired') return restored;
      if (state.status === 'active') {
        const observations = readCommitObservations(readJson(join(directory, 'observations.json')), valid.value);
        for (const observation of observations) {
          try {
            for (const receipt of observedCommitReceipts(observation, valid.value)) {
              if (performance.now() >= started + COMMIT_RECEIPT_LIMITS.drainMs)
                throw new Error('commit observation deadline exhausted');
              const object = verifyCommitObject(valid.value.gitExecutable, receipt.repository, receipt.sha);
              if (!object.ok) throw new Error(object.reason);
              await publishReceipt(directory, receipt);
            }
          } catch (error) {
            logger?.warn(`git-span commit observation: ${errorMessage(error)}`);
          }
        }
      }
      atomicJson(join(directory, 'state.json'), {
        ...readState(directory, valid.value),
        status: 'completed',
        observing: false,
        lastActivityMs: Date.now()
      });
      const drained = await drainDirectory(root, directory, valid.value, options, started, logger);
      return { ...restored, ...drained };
    } finally {
      await claim.release();
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

/** Retry completed work within one shared 3-second phase; preserve active observations and Codex continuing sessions. */
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
      if (!cleanupMayAffect(directory, valid.value, host, sessionId)) continue;
      const claim = await acquireReceiptClaim(root, `invocation-${key}`, deadline, options.lockExecutable);
      if (!claim) {
        logger?.warn('git-span commit receipts: cleanup invocation ownership unavailable');
        continue;
      }
      try {
        const state = readState(directory, valid.value);
        const abandoned = Date.now() - state.lastActivityMs >= COMMIT_RECEIPT_LIMITS.abandonedRetentionMs;
        if (abandoned) {
          logger?.warn('git-span commit receipts: expired abandoned state and pending evidence');
          rmSync(directory, { recursive: true });
          result.retired++;
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
            observing: false,
            lastActivityMs: Date.now()
          });
          result.retired++;
        }
      } finally {
        await claim.release();
      }
    }
  } catch (error) {
    logger?.warn(`git-span commit receipts: ${errorMessage(error)}`);
  }
  return result;
}

/**
 * Decide without the native lock whether cleanup could change an invocation.
 *
 * Each lock is a spawned helper process, so locking every stored invocation made SessionEnd scale with the whole
 * store and outlast the host's kill budget. `state.json` is replaced atomically, so an unlocked read sees a whole
 * snapshot; it only prunes work, because the locked section re-reads and re-checks everything it acts on. Any
 * unreadable state falls through to the locked path so its existing failure handling still applies.
 */
function cleanupMayAffect(
  directory: string,
  enrollment: CommitEnrollment,
  host: CommitHost,
  sessionId: string
): boolean {
  let state: CommitInvocationState;
  try {
    state = readState(directory, enrollment);
  } catch {
    return true;
  }
  if (Date.now() - state.lastActivityMs >= COMMIT_RECEIPT_LIMITS.abandonedRetentionMs) return true;
  if (enrollment.host !== host || enrollment.sessionId !== sessionId) return false;
  return state.status !== 'active' && state.status !== 'retired';
}

function fitsJsonFile(value: unknown): boolean {
  return Buffer.byteLength(JSON.stringify(value)) <= COMMIT_RECEIPT_LIMITS.jsonFileBytes;
}

/** Eviction order: broken or retired entries first, then acknowledged ones, then abandoned work. */
function evictionRank(directory: string, now: number): { rank: number; lastActivityMs: number } | null {
  try {
    const enrollment = validateCommitEnrollment(readJson(join(directory, 'enrollment.json')));
    if (!enrollment.ok) return { rank: 0, lastActivityMs: 0 };
    const state = readState(directory, enrollment.value);
    if (state.status === 'retired') return { rank: 0, lastActivityMs: state.lastActivityMs };
    if (state.status === 'acknowledged') return { rank: 1, lastActivityMs: state.lastActivityMs };
    if (now - state.lastActivityMs >= COMMIT_RECEIPT_LIMITS.abandonedRetentionMs)
      return { rank: 2, lastActivityMs: state.lastActivityMs };
    return null;
  } catch {
    return { rank: 0, lastActivityMs: 0 };
  }
}

/**
 * Keep only a recent window of invocations. Past the window, evict the oldest finished entries in one batch
 * down to the floor so that enrollment does not rescan on every call. Each victim is renamed away atomically
 * under its own invocation claim and then deleted; the entry being enrolled is never a victim. Evicted
 * entries cost at most a missing recommendation note, so every failure here is logged and ignored.
 */
async function evictInvocations(
  root: string,
  enrollingKey: string,
  deadline: number,
  executable: string | undefined,
  logger?: CommitRuntimeLogger
): Promise<void> {
  const invocations = join(root, 'invocations');
  try {
    // The pre-window global usage ledger is no longer read; drop it so it does not linger as ownerless state.
    rmSync(join(root, 'usage.json'), { force: true });
    const names = boundedEntries(invocations, Number.POSITIVE_INFINITY, deadline);
    for (const name of names)
      if (name.startsWith('.evicted-')) rmSync(join(invocations, name), { recursive: true, force: true });
    const live = names.filter((name) => !name.startsWith('.evicted-'));
    if (live.length <= COMMIT_RECEIPT_LIMITS.invocationWindow) return;
    const now = Date.now();
    const candidates = live
      .filter((name) => name !== enrollingKey)
      .flatMap((name) => {
        const ranked = evictionRank(join(invocations, name), now);
        return ranked === null ? [] : [{ name, ...ranked }];
      })
      .sort((a, b) => a.rank - b.rank || a.lastActivityMs - b.lastActivityMs);
    let remaining = live.length;
    for (const candidate of candidates) {
      if (remaining <= COMMIT_RECEIPT_LIMITS.invocationWindowFloor || performance.now() >= deadline) break;
      // The lock helper reports a timeout by throwing; a contended victim is skipped, never fatal to the batch.
      let claim: Awaited<ReturnType<typeof acquireReceiptClaim>>;
      try {
        claim = await acquireReceiptClaim(
          root,
          `invocation-${candidate.name}`,
          Math.min(deadline, performance.now() + 100),
          executable
        );
      } catch {
        continue;
      }
      if (!claim) continue;
      try {
        // The state may have changed between ranking and claiming.
        if (evictionRank(join(invocations, candidate.name), Date.now()) === null) continue;
        const trash = join(invocations, `.evicted-${randomBytes(8).toString('hex')}`);
        renameSync(join(invocations, candidate.name), trash);
        rmSync(trash, { recursive: true, force: true });
        remaining--;
      } finally {
        await claim.release();
      }
    }
    logger?.info?.(`git-span commit receipts: evicted ${live.length - remaining} old invocations`);
  } catch (error) {
    logger?.warn(`git-span commit receipts: eviction skipped: ${errorMessage(error)}`);
  }
}

function receiptRoot(options: CommitRuntimeOptions): string {
  return options.stateRoot ?? join(homedir(), '.cache', 'git-span', 'commit-receipts');
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}
function readExecutionContexts(value: unknown): { command: string; cwd: string }[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 32)
    throw new Error('invalid shell execution contexts');
  return value.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.command !== 'string' ||
      !item.command ||
      typeof item.cwd !== 'string' ||
      !item.cwd
    )
      throw new Error('invalid shell execution context');
    return { command: item.command, cwd: item.cwd };
  });
}
/** The enrollable command string of a direct shell input, or why the input is unsupported. */
function inspectInput(input: Readonly<Record<string, unknown>>, normalizedCommand?: string): CommitValidation<string> {
  const command = normalizedCommand ?? input.command;
  if (typeof command !== 'string' || command.length === 0) return { ok: false, reason: 'unsupported shell input' };
  const reason = unsupportedCommandReason(input, command);
  return reason === null ? { ok: true, value: command } : { ok: false, reason };
}
function unsupportedCommandReason(input: Readonly<Record<string, unknown>>, command: string): string | null {
  if (
    input.run_in_background === true ||
    input.background === true ||
    input.delegated === true ||
    input.worker === true
  )
    return 'background or delegated execution is unsupported';
  const split = splitTopLevel(command);
  if (split.stages.some((stage) => stage.precededBy === 'background') || /&\s*$/.test(command))
    return 'background shell execution is unsupported';
  return null;
}
/** The invocation's private lifecycle state, decoded and bound to the enrollment it was published for. */
function readState(directory: string, enrollment: CommitEnrollment): CommitInvocationState {
  const value = readJson(join(directory, 'state.json'));
  const stored = isRecord(value) ? validateCommitEnrollment(value.enrollment) : null;
  if (
    !isRecord(value) ||
    stored === null ||
    !stored.ok ||
    stored.value.invocationKey !== enrollment.invocationKey ||
    !isOneOf(COMMIT_INVOCATION_STATUSES, value.status) ||
    !Array.isArray(value.pendingNonces) ||
    value.pendingNonces.length > COMMIT_RECEIPT_LIMITS.receiptsPerInvocation ||
    !value.pendingNonces.every((nonce): nonce is string => typeof nonce === 'string') ||
    typeof value.observing !== 'boolean' ||
    typeof value.lastActivityMs !== 'number' ||
    !Number.isFinite(value.lastActivityMs)
  )
    throw new Error('invalid private invocation lifecycle');
  return {
    enrollment: stored.value,
    status: value.status,
    pendingNonces: value.pendingNonces,
    observing: value.observing,
    lastActivityMs: value.lastActivityMs
  };
}
/** Called under the invocation claim; deterministic names make interrupted publication retryable. */
async function publishReceipt(directory: string, receipt: CommitReceipt): Promise<void> {
  const enrollment = validateCommitEnrollment(readJson(join(directory, 'enrollment.json')));
  if (!enrollment.ok) throw new Error(enrollment.reason);
  if (existsSync(join(directory, 'receipts', `${receipt.nonce}.json`))) return;
  const state = readState(directory, enrollment.value);
  if (state.status !== 'active') throw new Error('receipt invocation is no longer active');
  atomicJson(join(directory, 'receipts', `${receipt.nonce}.json`), receipt, true);
  // Window the receipts: the newest stay, and the dropped ones lose their evidence files.
  const pendingNonces = [...state.pendingNonces, receipt.nonce];
  for (const dropped of pendingNonces.slice(0, -COMMIT_RECEIPT_LIMITS.receiptsPerInvocation))
    rmSync(join(directory, 'receipts', `${dropped}.json`), { force: true });
  atomicJson(join(directory, 'state.json'), {
    ...state,
    pendingNonces: pendingNonces.slice(-COMMIT_RECEIPT_LIMITS.receiptsPerInvocation),
    lastActivityMs: Date.now()
  });
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
      if (!/^observed-[a-f0-9]{64}-[a-f0-9]{40}(?:[a-f0-9]{24})?\.json$/.test(name))
        throw new Error('invalid receipt filename');
      const valid = validateCommitReceipt(readJson(join(directory, 'receipts', name)), enrollment);
      if (!valid.ok) throw new Error(valid.reason);
      const document = createCommitNoteDocument(enrollment);
      const association = await acquireReceiptClaim(
        root,
        `association-${commitAssociationKey(valid.value, document)}`,
        deadline,
        options.lockExecutable
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
        rmSync(join(directory, 'receipts', name));
        acknowledged++;
      } finally {
        await association.release();
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
    observing: false,
    lastActivityMs: Date.now()
  });
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
  const resolved =
    options.notesExecutable === undefined
      ? resolveGitSpanCommand(['notes', ...args], receipt.repository.commonDirectory, enrollment.gitExecutable)
      : { executable: options.notesExecutable, argv: ['notes', ...args] };
  const command = {
    cwd: receipt.repository.commonDirectory,
    argv: resolved.argv,
    ...(stdin === undefined ? {} : { stdin }),
    timeoutMs,
    maxOutputBytes: 1_048_576
  };
  const result = await (options.notesIO?.execute(command) ?? executeCommitNotes(resolved.executable, command));
  if (result.exitCode !== 0 || result.signal !== null || result.timedOut || result.outputExceeded)
    throw new Error(
      result.timedOut ? 'notes CLI timed out; receipt retained' : 'notes CLI unavailable or failed; receipt retained'
    );
  return result.stdout;
}

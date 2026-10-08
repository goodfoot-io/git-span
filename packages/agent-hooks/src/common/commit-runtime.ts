/** Host-facing receipt runtime. This state root is independent of session touch storage. */
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, realpathSync, rmSync } from 'node:fs';
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
  readJson,
  reserveReceiptCapacity
} from './commit-storage.js';
import { isOneOf, isRecord } from './guards.js';
import { splitTopLevel } from './shell-split.js';

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
  const inspected = inspectInput(request.toolInput);
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
      const observations = checkpointCommitInvocation(valid.value, deadline);
      const state: CommitInvocationState = {
        enrollment: valid.value,
        status: 'active',
        pendingNonces: [],
        observing: true,
        lastActivityMs: Date.now()
      };
      // Reserve the largest reachable lifecycle representation, including all pending keys.
      const maximumState = {
        ...state,
        status: 'acknowledged',
        pendingNonces: Array.from({ length: COMMIT_RECEIPT_LIMITS.receiptsPerInvocation }, () =>
          'x'.repeat(COMMIT_RECEIPT_LIMITS.identityKeyBytes)
        ),
        observing: false,
        lastActivityMs: Number.MAX_SAFE_INTEGER
      };
      const serializedBytes = [valid.value, observations, maximumState].map((value) =>
        Buffer.byteLength(JSON.stringify(value))
      );
      const initialBytes = serializedBytes.reduce((sum, bytes) => sum + bytes, 0) + 32768;
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
        privateDirectory(join(directory, 'receipts'));
        atomicJson(enrollmentPath, valid.value, true);
        atomicJson(join(directory, 'state.json'), state);
        atomicJson(join(directory, 'usage.json'), { bytes: initialBytes, receipts: 0 });
        atomicJson(join(directory, 'observations.json'), observations, true);
      } catch (error) {
        await reserveReceiptCapacity(root, -1, -initialBytes, deadline);
        rmSync(directory, { recursive: true, force: true });
        throw error;
      }
      return { kind: 'enrolled', enrollment: valid.value };
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
      if (state.status === 'active') {
        const observations = readCommitObservations(readJson(join(directory, 'observations.json')), valid.value);
        for (const observation of observations) {
          try {
            for (const receipt of observedCommitReceipts(observation, valid.value)) {
              if (performance.now() >= started + COMMIT_RECEIPT_LIMITS.drainMs)
                throw new Error('commit observation deadline exhausted');
              const object = verifyCommitObject(valid.value.gitExecutable, receipt.repository, receipt.sha);
              if (!object.ok) throw new Error(object.reason);
              await publishReceipt(root, directory, receipt, started + COMMIT_RECEIPT_LIMITS.drainMs);
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
      const claim = await acquireReceiptClaim(root, `invocation-${key}`, deadline);
      if (!claim) {
        logger?.warn('git-span commit receipts: cleanup invocation ownership unavailable');
        continue;
      }
      try {
        const state = readState(directory, valid.value);
        const abandoned = Date.now() - state.lastActivityMs >= COMMIT_RECEIPT_LIMITS.abandonedRetentionMs;
        if (abandoned) {
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
            observing: false,
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

function receiptRoot(options: CommitRuntimeOptions): string {
  return options.stateRoot ?? join(homedir(), '.cache', 'git-span', 'commit-receipts');
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}
/** The enrollable command string of a direct shell input, or why the input is unsupported. */
function inspectInput(input: Readonly<Record<string, unknown>>): CommitValidation<string> {
  const command = input.command;
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
function readUsage(directory: string): { bytes: number; receipts: number } {
  const usage = readJson(join(directory, 'usage.json'), 4096);
  if (
    !isRecord(usage) ||
    typeof usage.bytes !== 'number' ||
    !Number.isSafeInteger(usage.bytes) ||
    usage.bytes < 0 ||
    typeof usage.receipts !== 'number' ||
    !Number.isSafeInteger(usage.receipts) ||
    usage.receipts < 0
  )
    throw new Error('invalid invocation usage');
  return { bytes: usage.bytes, receipts: usage.receipts };
}
/** Called under the invocation claim; deterministic names make interrupted publication retryable. */
async function publishReceipt(
  root: string,
  directory: string,
  receipt: CommitReceipt,
  deadline: number
): Promise<void> {
  const enrollment = validateCommitEnrollment(readJson(join(directory, 'enrollment.json')));
  if (!enrollment.ok) throw new Error(enrollment.reason);
  if (existsSync(join(directory, 'receipts', `${receipt.nonce}.json`))) return;
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

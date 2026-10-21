/** Persist the raw unified-exec transport identity without completing a yielded invocation. */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CommitPostIdentity } from '../common/commit-contracts.js';
import { validateCommitEnrollment } from '../common/commit-contracts.js';
import { COMMIT_RECEIPT_LIMITS } from '../common/commit-limits.js';
import type { CommitRuntimeOptions } from '../common/commit-runtime.js';
import { acquireReceiptClaim, atomicJson, boundedEntries, identityKey, readJson } from '../common/commit-storage.js';
import { isRecord } from '../common/guards.js';

function root(options: CommitRuntimeOptions): string {
  return options.stateRoot ?? join(homedir(), '.cache', 'git-span', 'commit-receipts');
}

function sessionId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && value.length > 0 && value.length <= 128) return value;
  return null;
}

/** Only a structured running response authorizes raw write_stdin correlation. */
export function yieldedExecution(response: unknown): string | null {
  return isRecord(response) && (response.exit_code === undefined || response.exit_code === null)
    ? sessionId(response.session_id)
    : null;
}

/** Polls without an exit status remain nonterminal, including unknown/partial response shapes. */
export function completedExecution(response: unknown): boolean {
  return isRecord(response) && typeof response.exit_code === 'number' && Number.isInteger(response.exit_code);
}

export function polledExecution(input: unknown): string | null {
  if (!isRecord(input)) return null;
  if (typeof input.arguments === 'string') {
    if (Buffer.byteLength(input.arguments) > COMMIT_RECEIPT_LIMITS.jsonFileBytes) return null;
    try {
      const parsed: unknown = JSON.parse(input.arguments);
      return isRecord(parsed) ? sessionId(parsed.session_id) : null;
    } catch {
      return null;
    }
  }
  return sessionId(input.session_id);
}

/** Save transport ownership under the already-accounted invocation directory. */
export async function retainExecution(
  identity: CommitPostIdentity,
  executionId: string,
  options: CommitRuntimeOptions
): Promise<void> {
  const directory = join(root(options), 'invocations', identityKey(identity));
  if (!existsSync(directory)) return;
  const deadline = performance.now() + COMMIT_RECEIPT_LIMITS.drainMs;
  const claim = await acquireReceiptClaim(
    root(options),
    `invocation-${identityKey(identity)}`,
    deadline,
    options.lockExecutable
  );
  if (!claim) throw new Error('yielded execution ownership unavailable');
  try {
    const stored = validateCommitEnrollment(readJson(join(directory, 'enrollment.json')));
    if (
      !stored.ok ||
      stored.value.host !== identity.host ||
      stored.value.sessionId !== identity.sessionId ||
      stored.value.toolUseId !== identity.toolUseId
    )
      throw new Error('yielded execution enrollment mismatch');
    const existingPath = join(directory, 'exec-session.json');
    if (existsSync(existingPath)) {
      const existing = readJson(existingPath);
      if (
        !isRecord(existing) ||
        existing.executionId !== executionId ||
        existing.invocationKey !== stored.value.invocationKey
      )
        throw new Error('yielded execution transport identity changed');
    }
    atomicJson(join(directory, 'exec-session.json'), { executionId, invocationKey: stored.value.invocationKey });
  } finally {
    await claim.release();
  }
}

/** Resolve only uniquely-owned transports in this Codex session; never infer ownership from cwd. */
export function findExecution(
  session: string,
  executionId: string,
  options: CommitRuntimeOptions
): CommitPostIdentity | null {
  const directory = join(root(options), 'invocations');
  if (!existsSync(directory)) return null;
  const deadline = performance.now() + COMMIT_RECEIPT_LIMITS.drainMs;
  let result: CommitPostIdentity | null = null;
  for (const key of boundedEntries(directory, COMMIT_RECEIPT_LIMITS.invocations, deadline)) {
    if (performance.now() >= deadline) throw new Error('yielded execution lookup deadline exhausted');
    const path = join(directory, key);
    const mappingPath = join(path, 'exec-session.json');
    if (!existsSync(mappingPath)) continue;
    const mapping = readJson(mappingPath);
    if (!isRecord(mapping) || mapping.executionId !== executionId) continue;
    const valid = validateCommitEnrollment(readJson(join(path, 'enrollment.json')));
    if (!valid.ok || mapping.invocationKey !== valid.value.invocationKey)
      throw new Error('invalid yielded execution identity');
    if (valid.value.host !== 'codex' || valid.value.sessionId !== session) continue;
    if (result !== null) throw new Error('ambiguous yielded execution identity');
    result = { host: 'codex', sessionId: session, toolUseId: valid.value.toolUseId };
  }
  return result;
}

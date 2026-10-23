/** Read-only, complete pending-inspection reports independent of ordinary touch delivery. */
import type { ContextDocument } from './touch-core.js';

/** One supported literal invocation; native code owns all subcommand argument semantics. */
export interface PendingInspection {
  cwd: string;
  command: 'status' | 'diff';
  args: string[];
}

/** Unsupported candidate inspections consume ordinary diff attribution without claiming completeness. */
export type PendingInspectionParse =
  | { kind: 'none' }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'inspection'; inspection: PendingInspection };

/** Native empty success remains distinct from collection, schema, and execution errors. */
export type PendingContextResult = { ok: true; document: ContextDocument } | { ok: false; reason: string };

/** Thin native adapter; tests may supply real fixture documents without replacing host internals. */
export type PendingContextExecutor = (inspection: PendingInspection) => Promise<PendingContextResult>;

/** Recognize one literal Git command, preserving Git pathspecs and repeated literal -C options. */
export function parsePendingInspection(_command: string, _cwd: string): PendingInspectionParse {
  throw new Error('Not Implemented');
}

/** Render every selected relationship completely, or refuse a report exceeding its byte bound. */
export function renderPendingContext(_document: ContextDocument, _maxBytes?: number): string | null {
  throw new Error('Not Implemented');
}

/** Invoke pending-context directly through the resolved CLI with bounded read-only collection. */
export function createDefaultPendingContextExecutor(_timeoutMs?: number): PendingContextExecutor {
  throw new Error('Not Implemented');
}

/** Session-scoped authoring guidance, independent from span context selection. */
import type { MemoStore } from './span-surface.js';

/** Claim the exact authoring message only after a confirmed write. */
export function firstWriteGuidance(sessionId: string, memo: MemoStore, writeObserved: boolean): string | null {
  void sessionId;
  void memo;
  void writeObserved;
  throw new Error('Not Implemented');
}

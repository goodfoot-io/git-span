/** Host response metadata, never post-read filesystem contents, establishes exposure. */
import type { LineRange } from './agent-hooks-common.js';
import { isRecord } from './guards.js';

/** Claude's text Read response describes the lines actually returned, including EOF. */
export function claudeReadExposure(response: unknown): LineRange | null {
  if (!isRecord(response) || !isRecord(response.file)) return null;
  const { startLine, numLines, totalLines } = response.file;
  if (
    typeof startLine !== 'number' ||
    !Number.isSafeInteger(startLine) ||
    startLine < 1 ||
    typeof numLines !== 'number' ||
    !Number.isSafeInteger(numLines) ||
    numLines < 1 ||
    typeof totalLines !== 'number' ||
    !Number.isSafeInteger(totalLines) ||
    totalLines < 0
  )
    return null;
  const end = startLine + numLines - 1;
  if (!Number.isSafeInteger(end) || end > totalLines) return null;
  return { start: startLine, end };
}

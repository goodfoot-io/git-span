/** Shared complete relationship presentation for committed and pending inspections. */
import { humanStatusLabel } from './agent-hooks-common.js';
import { collapseByPath, renderAnchorTree } from './anchor-tree.js';
import type { ContextSpan } from './touch-core.js';

/** Render all current anchors and why, independent of ordinary touch presentation history. */
export function renderFullSpanContext(spans: readonly ContextSpan[], maxBytes: number): string | null {
  const unique = new Map(spans.map((span) => [span.name, span]));
  if (unique.size === 0) return null;
  const sections = [...unique.values()].map((span) => {
    const anchors = collapseByPath(
      span.anchors.map((anchor) => {
        const location = anchor.current ?? anchor.anchored;
        const status = anchor.status;
        const label =
          status.code === 'CONTENT_UNAVAILABLE'
            ? `content unavailable: ${humanStatusLabel(status.reason)}`
            : humanStatusLabel(status.code);
        return {
          path: location.path.replace(/\p{Cc}/gu, (character) => JSON.stringify(character).slice(1, -1)),
          range:
            location.extent.kind === 'whole'
              ? { kind: 'whole-file' as const }
              : { kind: 'range' as const, start: location.extent.start, end: location.extent.end },
          suffix: status.code === 'FRESH' ? '' : ` — ${label}`
        };
      })
    );
    return `## ${span.name}\n${renderAnchorTree(anchors).join('\n')}${span.why === null ? '' : `\n\n${span.why}`}`;
  });
  const output = `\n<git-span>\n\n${sections.join('\n\n---\n\n')}\n\n</git-span>\n`;
  if (Buffer.byteLength(output) > maxBytes) throw new Error('complete span context exceeds the rendered byte limit');
  return output;
}

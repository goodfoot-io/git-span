import type { ReactNode } from 'react';
import type { PhaseId } from './scene';
import type { DiffSign, SpecimenTone } from './specimens';
import { SPECIMENS } from './specimens';

const TONE_CLASS: Record<SpecimenTone, string> = {
  code: 'text-ink-secondary',
  muted: 'text-ink-tertiary-deep',
  danger: 'text-negative'
};

// Every red/green delineated line gets a background wash matching its text color, not text
// color alone -- the same pairing the 'agent' kind already uses (bg-terminal-removed/-added
// beside text-terminal-danger/-success below). '-'/'+' rows carry the wash unconditionally;
// context/hunk-header rows stay washless.
const DIFF_SIGN_CLASS: Record<DiffSign, string> = {
  '+': 'bg-highlight text-positive',
  '-': 'bg-negative-wash text-negative',
  ' ': 'text-ink-tertiary-deep',
  '@': 'text-ink-tertiary-deep'
};

// 'lines' kind background wash: danger-toned lines always carry the red wash (they're
// inherently a negative delineation, same as a diff '-' row), independent of the `highlight`
// flag, which instead marks the green/neutral callout wash used to bracket-link a pair of
// lines.
function lineBackgroundClass(tone: SpecimenTone, highlight: boolean | undefined): string {
  if (tone === 'danger') return 'bg-negative-wash';
  return highlight ? 'bg-highlight' : '';
}

// The header is the container's first line — a command prompt or file label above the
// output it produced, as one block of terminal scrollback.
//
// The scrollback is real preformatted-code markup, not a stack of CSS-positioned divs:
// each line is a block-level span whose text ends in a newline, so any extraction of the
// page as text — an accessibility-tree read, a copy-paste, a Markdown reduction —
// reproduces the scrollback one line per line. The trailing newline lives at the end of
// each line's own text (never as a bare text node between the spans), because a bare
// newline between block boxes inside <pre> would render as an extra blank line while a
// trailing newline at a line's end does not — the two shapes are visually identical
// except for that anonymous line box.
function SpecimenFrame({ header, children }: { header?: string; children: ReactNode }) {
  return (
    <pre className="overflow-x-auto whitespace-pre rounded-md border border-rule bg-ground-raised px-4 py-3 font-mono text-xs leading-relaxed">
      <code className="block">
        {header && (
          <span className="block text-ink-secondary">
            {header}
            {'\n'}
          </span>
        )}
        {children}
      </code>
    </pre>
  );
}

export function PhaseSpecimen({ state }: { state: PhaseId }) {
  const specimen = SPECIMENS[state];
  if (!specimen) return null;

  if (specimen.kind === 'agent') {
    // Line 6 appears twice (removed and added), so diff keys come from precomputed
    // {id, row} pairs rather than the line number or text alone.
    const rows = specimen.diff.map((row, index) => ({ ...row, id: `${index}-${row.sign ?? ' '}-${row.text}` }));
    return (
      <pre className="overflow-x-auto whitespace-pre rounded-md border border-terminal-rule bg-terminal-raised px-4 py-3 font-mono text-xs leading-relaxed text-terminal-ink">
        <code className="block">
          <span className="block">
            <span className="text-cc-tool">●</span> <span className="font-semibold">{specimen.tool}</span>(
            <span className="underline">{specimen.target}</span>){'\n'}
          </span>
          <span className="block text-terminal-ink-faint">
            {`  ⎿  ${specimen.summary}`}
            {'\n'}
          </span>
          {rows.map((row) => (
            <span
              key={row.id}
              className={
                row.sign === '-' ? 'block bg-terminal-removed' : row.sign === '+' ? 'block bg-terminal-added' : 'block'
              }
            >
              <span
                className={
                  row.sign === '-'
                    ? 'text-terminal-danger'
                    : row.sign === '+'
                      ? 'text-terminal-success'
                      : 'text-terminal-ink-faint'
                }
              >
                {`  ${String(row.line).padStart(2)} ${row.sign ?? ' '} `}
              </span>
              {row.text}
              {'\n'}
            </span>
          ))}
          <span className="block text-white">
            {`  ⎿  ${specimen.hookLabel}`}
            {'\n'}
          </span>
          {/* pl-[5ch] instead of a space prefix keeps the why lines indented flush under the ⎿ marker's text column. */}
          {specimen.hookLines.map((line, index) => (
            <span key={line} className="block pl-[5ch] text-white">
              {line}
              {index < specimen.hookLines.length - 1 ? '\n' : null}
            </span>
          ))}
        </code>
      </pre>
    );
  }

  if (specimen.kind === 'diff') {
    // Precompute {id, row} pairs in a plain map (blank context lines make row text non-unique),
    // so no array index is used as a JSX key. A '@' hunk header carries no sign column; git
    // prints the line as-is.
    const rows = specimen.rows.map((row, index) => ({ ...row, id: `${index}-${row.text}` }));
    return (
      <SpecimenFrame header={specimen.header}>
        {rows.map((row, index) => (
          <span key={row.id} className={`block ${DIFF_SIGN_CLASS[row.sign]}`}>
            {row.sign !== '@' && <span className="select-none">{row.sign}</span>}
            {row.text}
            {index < rows.length - 1 ? '\n' : null}
          </span>
        ))}
      </SpecimenFrame>
    );
  }

  // lines — precompute {id, line} pairs in a plain map (blank lines make line text
  // non-unique), so no array index is used as a JSX key.
  const lines = specimen.lines.map((line, index) => ({ ...line, id: `${index}-${line.text}` }));
  const highlighted = lines.flatMap((line, index) => (line.highlight ? [index] : []));
  const bracket =
    specimen.bracket && highlighted.length >= 2
      ? { first: highlighted[0], last: highlighted[highlighted.length - 1] }
      : null;
  return (
    <SpecimenFrame header={specimen.header}>
      <span className={`block${bracket ? ' relative pr-6' : ''}`}>
        {lines.map((line, index) => (
          <span
            key={line.id}
            className={`block ${TONE_CLASS[line.tone]} ${lineBackgroundClass(line.tone, line.highlight)}`.trim()}
          >
            {line.text}
            {index < lines.length - 1 ? '\n' : null}
          </span>
        ))}
        {bracket && (
          /* A border-drawn bracket linking the first and last highlighted lines: out of the
             first, down the gutter, into the last. `lh` units track the line height, so the
             ends sit on each line's vertical center; the two zero-size spans are
             left-pointing arrowheads made from border triangles. */
          <span
            aria-hidden
            className="absolute right-0 w-3 rounded-r-[2px] border border-l-0 border-highlight-accent"
            style={{
              top: `calc(${bracket.first} * 1lh + 0.5lh)`,
              height: `calc(${bracket.last - bracket.first} * 1lh)`
            }}
          >
            <span className="absolute -top-[4.5px] -left-[5px] h-0 w-0 border-y-4 border-y-transparent border-r-[6px] border-r-highlight-accent" />
            <span className="absolute -bottom-[4.5px] -left-[5px] h-0 w-0 border-y-4 border-y-transparent border-r-[6px] border-r-highlight-accent" />
          </span>
        )}
      </span>
    </SpecimenFrame>
  );
}

import type { ReactNode } from 'react';
import type { PhaseId } from './scene';
import type { DiffSign, SpecimenTone } from './specimens';
import { SPECIMENS } from './specimens';

const TONE_CLASS: Record<SpecimenTone, string> = {
  code: 'text-ink-secondary',
  muted: 'text-ink-tertiary-deep',
  danger: 'text-negative'
};

const DIFF_SIGN_CLASS: Record<DiffSign, string> = {
  '+': 'text-positive',
  '-': 'text-negative',
  ' ': 'text-ink-tertiary-deep',
  '@': 'text-ink-tertiary-deep'
};

// The header is the container's first line — a command prompt or file label above the
// output it produced, as one block of terminal scrollback.
function SpecimenFrame({ header, children }: { header?: string; children: ReactNode }) {
  return (
    <div className="whitespace-pre-wrap rounded-md border border-rule bg-ground-raised px-4 py-3 font-mono text-xs leading-relaxed">
      {header && <div className="text-ink-secondary">{header}</div>}
      {children}
    </div>
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
      <div className="whitespace-pre-wrap rounded-md border border-terminal-rule bg-terminal-raised px-4 py-3 font-mono text-xs leading-relaxed text-terminal-ink">
        <div>
          <span className="text-cc-tool">●</span> <span className="font-semibold">{specimen.tool}</span>(
          <span className="underline">{specimen.target}</span>)
        </div>
        <div className="text-terminal-ink-faint">{`  ⎿  ${specimen.summary}`}</div>
        {rows.map((row) => (
          <div
            key={row.id}
            className={row.sign === '-' ? 'bg-terminal-removed' : row.sign === '+' ? 'bg-terminal-added' : undefined}
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
          </div>
        ))}
        <div className="text-terminal-ink-faint">{`  ⎿  ${specimen.hookLabel}`}</div>
        {/* pl-[5ch] instead of a space prefix keeps wrapped lines (the why) on the same indent. */}
        {specimen.hookLines.map((line) => (
          <div key={line} className="pl-[5ch] text-terminal-ink-faint">
            {line}
          </div>
        ))}
      </div>
    );
  }

  if (specimen.kind === 'diff') {
    // Precompute {id, row} pairs in a plain map (blank context lines make row text non-unique),
    // so no array index is used as a JSX key. A '@' hunk header carries no sign column; git
    // prints the line as-is.
    const rows = specimen.rows.map((row, index) => ({ ...row, id: `${index}-${row.text}` }));
    return (
      <SpecimenFrame header={specimen.header}>
        {rows.map((row) => (
          <div key={row.id} className={DIFF_SIGN_CLASS[row.sign]}>
            {row.sign !== '@' && <span className="select-none">{row.sign}</span>}
            {row.text}
          </div>
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
      <div className={bracket ? 'relative pr-6' : undefined}>
        {lines.map((line) => (
          <div key={line.id} className={`${TONE_CLASS[line.tone]}${line.highlight ? ' bg-highlight' : ''}`}>
            {line.text}
          </div>
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
      </div>
    </SpecimenFrame>
  );
}

import type { PhaseId } from './scene';
import type { SpecimenTone } from './specimens';
import { SPECIMENS } from './specimens';

const TONE_CLASS: Record<SpecimenTone, string> = {
  code: 'text-ink-secondary',
  muted: 'text-ink-tertiary',
  danger: 'text-negative'
};

export function PhaseSpecimen({ state }: { state: PhaseId }) {
  const specimen = SPECIMENS[state];
  if (!specimen) return null;

  if (specimen.kind === 'exhibit') {
    return (
      <div className="rounded-lg border border-linkage/40 bg-linkage/10 px-4 py-3 font-mono text-xs leading-relaxed">
        <div className="text-[0.65rem] uppercase tracking-wide text-linkage">◆ git-span · recorded relationship</div>
        <div className="font-semibold text-ink-primary">{specimen.name}</div>
        {specimen.anchors.map((anchor) => (
          <div key={anchor} className="text-ink-secondary">
            {anchor}
          </div>
        ))}
        <div className="mt-1.5 text-ink-secondary">{specimen.why}</div>
      </div>
    );
  }

  if (specimen.kind === 'diff') {
    return (
      <div className="border-l border-rule pl-4 font-mono text-xs leading-relaxed">
        {specimen.rows.map((row) => (
          <div key={row.text} className={row.sign === '+' ? 'text-positive' : 'text-negative'}>
            <span className="select-none">{row.sign}</span> {row.text}
          </div>
        ))}
      </div>
    );
  }

  if (specimen.kind === 'lines') {
    return (
      <div className="border-l border-rule pl-4 font-mono text-xs leading-relaxed">
        {specimen.lines.map((line) => (
          <div key={line.text} className={TONE_CLASS[line.tone]}>
            {line.text}
          </div>
        ))}
      </div>
    );
  }

  // agreement — precompute the cursor-split fragments as {id, part} pairs before the rendering
  // map, so no array index is used as a JSX key.
  const rows = specimen.rows.map((row) => ({
    ...row,
    fragments: row.code.split('cursor').map((part, index) => ({ id: `${row.file}-${index}`, part }))
  }));

  return (
    <div className="border-l border-rule pl-4 font-mono text-xs leading-relaxed">
      {rows.map((row) => (
        <div key={row.file}>
          {row.fragments.map((fragment, index) => (
            <span key={fragment.id} className="text-ink-secondary">
              {fragment.part}
              {index < row.fragments.length - 1 && <strong className="font-semibold text-ink-primary">cursor</strong>}
            </span>
          ))}
          <span className="ml-3 text-[0.7rem] text-ink-tertiary">{row.file}</span>
        </div>
      ))}
    </div>
  );
}

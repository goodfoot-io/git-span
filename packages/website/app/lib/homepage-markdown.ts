/**
 * Markdown representation of the homepage, rendered from the same typed
 * content records the React view composes — never from the rendered markup.
 * Both representations keep reading the same records, which is the
 * single-sourcing guarantee.
 *
 * @summary Homepage Markdown rendered from the shared copy and specimen records
 */
import { CLOSING, HERO, PHASE_COPY } from '~/components/marketing/story/copy';
import { TIMELINE } from '~/components/marketing/story/scene';
import type { DiffSign, Specimen } from '~/components/marketing/story/specimens';
import { SPECIMENS } from '~/components/marketing/story/specimens';

/** The same phase order _index.tsx renders: every non-hero step of the timeline. */
const STORY_STEPS = TIMELINE.filter((phase) => phase.id !== 'hero');

/**
 * Diff rows exactly as Specimen.tsx prints them: `-`/`+`/context rows carry
 * their sign in a leading column, `@` hunk headers are emitted as-is — git
 * prints them with no sign column of their own.
 */
function diffRowLines(rows: { sign: DiffSign; text: string }[]): string[] {
  return rows.map((row) => (row.sign === '@' ? row.text : `${row.sign}${row.text}`));
}

/** The specimen's verbatim lines in Specimen.tsx's field order, header first. */
function specimenLines(specimen: Specimen): string[] {
  const header = specimen.kind === 'agent' ? [] : specimen.header ? [specimen.header] : [];
  switch (specimen.kind) {
    case 'diff':
      return [...header, ...diffRowLines(specimen.rows)];
    case 'lines':
      return [...header, ...specimen.lines.map((line) => line.text)];
    case 'agent': {
      // Line-numbered diff rows: `NN sign text`; a no-sign row pads a space
      // where the sign column would be, mirroring Specimen.tsx's span.
      const rows = specimen.diff.map((row) => `  ${String(row.line).padStart(2)} ${row.sign ?? ' '} ${row.text}`);
      // The hook lines carry the injected <git-span> block itself — the most
      // agent-relevant artifact on the page — indented like Specimen.tsx's
      // pl-[5ch] column.
      return [
        `● ${specimen.tool}(${specimen.target})`,
        `  ⎿  ${specimen.summary}`,
        ...rows,
        `  ⎿  ${specimen.hookLabel}`,
        ...specimen.hookLines.map((line) => `     ${line}`)
      ];
    }
  }
}

/**
 * The specimen as a fenced code block — `diff` and `console` fences for the
 * terminal excerpts, a plain fence for the agent session, which mixes a tool
 * call, a diff, and the injected block and so belongs to no one language.
 * Tone, highlight, and bracket are visual-only and do not carry over.
 */
function fencedSpecimen(specimen: Specimen): string {
  const info = specimen.kind === 'diff' ? 'diff' : specimen.kind === 'lines' ? 'console' : '';
  return [`\`\`\`${info}`, ...specimenLines(specimen), '```'].join('\n');
}

/**
 * Render the homepage as a complete Markdown document: the hero heading and
 * supporting copy, each story phase with its prose and full specimen, and the
 * closing headline with its CTAs — in the same phase order the page uses.
 *
 * @returns The complete homepage Markdown document.
 * @summary Markdown document mirroring the homepage's content, single-sourced
 */
export function renderHomepageMarkdown(): string {
  const hero = [HERO.headline.map((segment) => `# ${segment.text}`).join('\n'), HERO.supporting].join('\n\n');

  const phases = STORY_STEPS.flatMap((phase) => {
    const prose = PHASE_COPY[phase.id].prose;
    // A prose-free step renders no specimen either — the same guard _index.tsx
    // uses, where the specimen sits inside the `prose &&` block.
    if (!prose) return [];
    const specimen = SPECIMENS[phase.id];
    return [[`## ${prose.headline}`, prose.body, ...(specimen ? [fencedSpecimen(specimen)] : [])].join('\n\n')];
  });

  const closing = [
    `## ${CLOSING.headline}`,
    `[${CLOSING.primaryCta.label}](${CLOSING.primaryCta.href}) [${CLOSING.secondaryCta.label}](${CLOSING.secondaryCta.href})`
  ].join('\n\n');

  return `${[hero, ...phases, closing].join('\n\n')}\n`;
}

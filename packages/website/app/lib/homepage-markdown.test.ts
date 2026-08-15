import { describe, expect, it } from 'vitest';
import { CLOSING, HERO, PHASE_COPY } from '~/components/marketing/story/copy';
import { TIMELINE } from '~/components/marketing/story/scene';
import { SPECIMENS } from '~/components/marketing/story/specimens';
import { renderHomepageMarkdown } from '~/lib/homepage-markdown';

// The same phase order _index.tsx renders: every non-hero step of the timeline.
const STORY_STEPS = TIMELINE.filter((phase) => phase.id !== 'hero');

describe('renderHomepageMarkdown', () => {
  it.skip('opens with the hero heading and supporting copy', () => {
    const markdown = renderHomepageMarkdown();
    for (const segment of HERO.headline) {
      expect(markdown).toContain(`# ${segment.text}`);
    }
    expect(markdown).toContain(HERO.supporting);
  });

  it.skip('renders every story phase in the page order, with its prose', () => {
    const markdown = renderHomepageMarkdown();
    const positions = STORY_STEPS.map((phase) => {
      const prose = PHASE_COPY[phase.id].prose;
      const index = markdown.indexOf(`## ${prose?.headline}`);
      expect(index, `phase ${phase.id} headline`).toBeGreaterThanOrEqual(0);
      if (prose) expect(markdown).toContain(prose.body);
      return index;
    });
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it.skip('renders the hero phase prose-free', () => {
    expect(PHASE_COPY.hero.prose).toBeNull();
    expect(renderHomepageMarkdown()).not.toContain('## Hero');
  });

  it.skip('renders every specimen header and row', () => {
    const markdown = renderHomepageMarkdown();
    for (const phase of STORY_STEPS) {
      const specimen = SPECIMENS[phase.id];
      if (!specimen) continue;
      if (specimen.kind === 'agent') {
        continue; // agent framing asserted in its own test
      }
      if (specimen.header) expect(markdown).toContain(specimen.header);
      const lines = specimen.kind === 'diff' ? specimen.rows : specimen.lines;
      for (const line of lines) {
        expect(markdown, `specimen line of ${phase.id}`).toContain(line.text);
      }
    }
  });

  it.skip('emits diff rows with a sign column and hunk headers signless', () => {
    const markdown = renderHomepageMarkdown();
    // change specimen — git prints '@' hunk headers with no sign column.
    expect(markdown).toContain('@@ -3,6 +3,6 @@ function listProducts(q: ProductQuery) {');
    expect(markdown).toContain('-    page: page.nextPage,');
    expect(markdown).toContain('+    cursor: page.nextCursor,');
  });

  it.skip('renders the full agent specimen: tool call, numbered rows, and the git-span block', () => {
    const markdown = renderHomepageMarkdown();
    expect(markdown).toContain('● Update(api/src/routes/products.ts)');
    expect(markdown).toContain('  ⎿  Added 1 line, removed 1 line');
    expect(markdown).toContain('   6 -   page: page.nextPage,');
    expect(markdown).toContain('   6 +   cursor: page.nextCursor');
    expect(markdown).toContain('  ⎿  PostToolUse says: <git-span>');
    // The hook lines carry the injected <git-span> block itself — the most
    // agent-relevant artifact on the page — indented like Specimen.tsx's
    // pl-[5ch] column.
    expect(markdown).toContain('     ## product-listing-pagination');
    expect(markdown).toContain('     api/src/routes/products.ts#L4-L7');
    expect(markdown).toContain('     client-py/pagination.py#L25-L27');
    expect(markdown).toContain('     The API pagination response is authoritative;');
    expect(markdown).toContain('     </git-span>');
  });

  it.skip('closes with the closing headline and both CTAs', () => {
    const markdown = renderHomepageMarkdown();
    expect(markdown).toContain(`## ${CLOSING.headline}`);
    for (const cta of [CLOSING.primaryCta, CLOSING.secondaryCta]) {
      expect(markdown).toContain(`[${cta.label}](${cta.href})`);
    }
  });

  it.skip('ends with a newline', () => {
    expect(renderHomepageMarkdown()).toMatch(/\n$/);
  });
});

import { describe, expect, it } from 'vitest';
import { equivalentCodeSamples, extractHtmlCodeSamples, extractMarkdownFences } from '~/gate/code-samples';

/**
 * Fixture HTML shaped like fumadocs pretty-code's rendered output: a
 * `<figure data-rehype-pretty-code-figure>` wrapping `<pre data-language>`
 * and `<code>`, with one `<span data-line>` per source line, each further
 * nested with per-token spans for syntax-highlight coloring. Two code
 * samples, matching the two fences in `MATCHING_MARKDOWN` below.
 */
const MATCHING_HTML = `
<article>
  <p>Install the package, then log something.</p>
  <figure data-rehype-pretty-code-figure>
    <pre data-language="bash" data-theme="github-dark"><code data-language="bash"><span data-line><span style="color:#79B8FF">yarn</span> add git-span</span>
<span data-line><span style="color:#79B8FF">yarn</span> build</span></code></pre>
  </figure>
  <p>Then:</p>
  <figure data-rehype-pretty-code-figure>
    <pre data-language="ts" data-theme="github-dark"><code data-language="ts"><span data-line><span style="color:#F97583">const</span> <span>foo</span> = <span style="color:#79B8FF">1</span>;</span>
<span data-line><span>console</span>.<span>log</span>(foo);</span></code></pre>
  </figure>
</article>
`;

/** The Markdown alternate whose two fences match `MATCHING_HTML` exactly. */
const MATCHING_MARKDOWN = `# Getting started

Install the package, then log something.

\`\`\`bash
yarn add git-span
yarn build
\`\`\`

Then:

\`\`\`ts
const foo = 1;
console.log(foo);
\`\`\`
`;

/** Same HTML as \`MATCHING_HTML\` but the Markdown alternate is missing the second block. */
const MISSING_BLOCK_MARKDOWN = `# Getting started

Install the package, then log something.

\`\`\`bash
yarn add git-span
yarn build
\`\`\`
`;

/** Same HTML as \`MATCHING_HTML\` but the Markdown alternate's second fence content differs. */
const DIFFERING_MARKDOWN = `# Getting started

Install the package, then log something.

\`\`\`bash
yarn add git-span
yarn build
\`\`\`

Then:

\`\`\`ts
const foo = 2;
console.log(foo);
\`\`\`
`;

/**
 * HTML with a single code sample whose content contains a literal
 * triple-backtick run — the \`09bd1fbd\` marker case: a fence opened with
 * four backticks must not be closed early by a shorter run inside its body.
 */
const BACKTICK_MARKER_HTML = `
<figure data-rehype-pretty-code-figure>
  <pre data-language="md" data-theme="github-dark"><code data-language="md"><span data-line><span>Example fenced block:</span></span>
<span data-line></span>
<span data-line><span>\`\`\`js</span></span>
<span data-line><span>console.log(1);</span></span>
<span data-line><span>\`\`\`</span></span></code></pre>
</figure>
`;

/** The Markdown alternate: one fence opened with four backticks whose body contains a triple-backtick run. */
const BACKTICK_MARKER_MARKDOWN = `
\`\`\`\`md
Example fenced block:

\`\`\`js
console.log(1);
\`\`\`
\`\`\`\`
`;

/**
 * Openers CommonMark allows but a purely-alphanumeric info-string grammar
 * rejects: a fumadocs `title=` attribute, a hyphenated language id, and a
 * language id followed by highlight metadata.
 */
const INFO_STRING_MARKDOWN = `\`\`\`bash title="Install"
yarn add git-span
\`\`\`

\`\`\`ts {1} showLineNumbers
const foo = 1;
\`\`\`

\`\`\`objective-c
@implementation Foo @end
\`\`\`
`;

/** Tilde fences, whose info strings carry no backtick restriction at all. */
const TILDE_FENCE_MARKDOWN = `~~~md
\`\`\`
nested
\`\`\`
~~~

~~~
plain tilde body
~~~
`;

describe('extractHtmlCodeSamples', () => {
  it('extracts the text content of every pre > code block, joined line by line', () => {
    expect(extractHtmlCodeSamples(MATCHING_HTML)).toEqual([
      'yarn add git-span\nyarn build',
      'const foo = 1;\nconsole.log(foo);'
    ]);
  });
});

describe('extractMarkdownFences', () => {
  it('extracts the verbatim body of every fenced code block', () => {
    expect(extractMarkdownFences(MATCHING_MARKDOWN)).toEqual([
      'yarn add git-span\nyarn build',
      'const foo = 1;\nconsole.log(foo);'
    ]);
  });

  it('does not close a fence on a shorter backtick run inside its body', () => {
    const fences = extractMarkdownFences(BACKTICK_MARKER_MARKDOWN);
    expect(fences).toEqual(['Example fenced block:\n\n```js\nconsole.log(1);\n```']);
  });

  it('recognizes an opener carrying a fumadocs-style info string attribute', () => {
    expect(extractMarkdownFences(INFO_STRING_MARKDOWN)).toEqual([
      'yarn add git-span',
      'const foo = 1;',
      '@implementation Foo @end'
    ]);
  });

  it('recognizes a tilde fence, including one whose body contains backticks', () => {
    expect(extractMarkdownFences(TILDE_FENCE_MARKDOWN)).toEqual(['```\nnested\n```', 'plain tilde body']);
  });
});

describe('equivalentCodeSamples', () => {
  it('is equivalent when the HTML and Markdown carry the same code samples', () => {
    expect(equivalentCodeSamples(MATCHING_HTML, MATCHING_MARKDOWN)).toEqual({ equivalent: true });
  });

  it('names the missing block when the Markdown alternate drops a code sample present in the HTML', () => {
    const result = equivalentCodeSamples(MATCHING_HTML, MISSING_BLOCK_MARKDOWN);
    expect(result.equivalent).toBe(false);
    expect(result.mismatch).toMatch(/count/);
  });

  it('names the differing index when content diverges between HTML and Markdown', () => {
    const result = equivalentCodeSamples(MATCHING_HTML, DIFFERING_MARKDOWN);
    expect(result.equivalent).toBe(false);
    expect(result.mismatch).toMatch(/index 1/);
  });

  it('is equivalent when a fence with an embedded shorter backtick run matches the HTML', () => {
    expect(equivalentCodeSamples(BACKTICK_MARKER_HTML, BACKTICK_MARKER_MARKDOWN)).toEqual({ equivalent: true });
  });
});

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PhaseSpecimen } from './Specimen';
import { SPECIMENS } from './specimens';

// Every specimen is verbatim terminal scrollback, and the page's whole
// value to a text-consuming reader — an agent reading the accessibility
// tree, or a Markdown reduction of the page — rests on that scrollback
// surviving the extraction as its lines, not as one run-together
// paragraph. Line separation is a property of the markup: real
// preformatted-code markup carries newline text nodes, while a stack of
// CSS-positioned <div>s concatenates into a single line when the styling
// is stripped away.

// globals: false means no automatic testing-library cleanup; without it,
// one test's render leaks into the next test's screen queries.
afterEach(cleanup);

describe('PhaseSpecimen scrollback', () => {
  it.each(Object.keys(SPECIMENS))('emits preformatted-code markup for the %s specimen', (phase) => {
    const { container } = render(<PhaseSpecimen state={phase as keyof typeof SPECIMENS} />);
    expect(container.querySelector('pre code'), 'specimen frame must be <pre><code>').not.toBeNull();
  });

  it.each([
    [
      'failure',
      [
        '$ python ./scripts/sync_catalog.py',
        '    page = fetch_page(cursor)',
        '  File "client-py/pagination.py", line 27, in fetch_page',
        '    next_page = response["page"]',
        '                ~~~~~~~~^^^^^^^^',
        "KeyError: 'page'"
      ]
    ],
    [
      'change',
      [
        '$ git show ./api/src/routes/products.ts',
        '@@ -3,6 +3,6 @@ function listProducts(q: ProductQuery) {',
        ' ',
        '   return {',
        '     items: items.slice(0, limit),',
        '-    page: page.nextPage,',
        '+    cursor: page.nextCursor,',
        '   };'
      ]
    ],
    [
      'span',
      [
        '● Update(api/src/routes/products.ts)',
        '  ⎿  Added 1 line, removed 1 line',
        '   4   return {',
        '   5     items: items.slice(0, limit),',
        '   6 -   page: page.nextPage,',
        '   6 +   cursor: page.nextCursor',
        '   7   };',
        '  ⎿  PostToolUse says: <git-span>',
        '## product-listing-pagination',
        'api/src/routes/products.ts#L4-L7',
        'client-py/pagination.py#L25-L27',
        ' ',
        'The API pagination response is authoritative;',
        'clients consume its continuation cursor unchanged.',
        '</git-span>'
      ]
    ]
  ] as const)('extracts the %s scrollback one line per line, in order', (phase, lines) => {
    const { container } = render(<PhaseSpecimen state={phase} />);
    const frame = container.querySelector('pre');
    expect(frame).not.toBeNull();
    expect(frame?.textContent).toBe(lines.join('\n'));
  });
});

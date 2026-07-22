import type { PhaseId } from './scene';

// Each specimen is 1–3 quiet lines of verbatim repository content proving that section's claim —
// evidence under the prose, never narrative; the page reads complete without them.

export type SpecimenTone = 'code' | 'muted' | 'danger';

// '@' marks a hunk header, which git prints with no sign column of its own.
export type DiffSign = '+' | '-' | ' ' | '@';

// `header` is the specimen's first line: the command whose output the lines quote, or a file
// label (its extension signals the language). Omit it where the lines carry their own context.
export type Specimen =
  | { kind: 'diff'; header?: string; rows: { sign: DiffSign; text: string }[] }
  | {
      kind: 'lines';
      header?: string;
      // `highlight` puts a muted-green wash behind the line; with `bracket`, a border-drawn
      // bracket in the right gutter links the first highlighted line to the last.
      bracket?: boolean;
      lines: { text: string; tone: SpecimenTone; highlight?: boolean }[];
    }
  // A portion of a Claude Code session on the dark terminal surface: a tool call with its
  // line-numbered diff, then the PostToolUse hook feedback carrying the injected <git-span>
  // block.
  | {
      kind: 'agent';
      tool: string;
      target: string;
      summary: string;
      diff: { line: number; sign?: '+' | '-'; text: string }[];
      hookLabel: string;
      hookLines: string[];
    };

export const SPECIMENS: Partial<Record<PhaseId, Specimen>> = {
  // Two excerpts of the same relationship's two sides, cut from the files as a terminal
  // session: the API and the Python client both speak "page" — one subsystem in agreement,
  // with nothing syntactic connecting its halves — and the highlighted lines and the
  // right-gutter bracket draw the invisible link. The excerpts are lightly stylized for
  // readability (TypeScript dedented, trailing comma dropped). The sed ranges stay
  // consistent with the rest of the story — lines 4–7 are the return block the change
  // hunk later edits, lines 25–27 end on the traceback's line 27 inside the span anchor
  // L25–L27.
  traverse: {
    kind: 'lines',
    bracket: true,
    lines: [
      { text: "$ cat ./api/src/routes/products.ts | sed -n '4,7p'", tone: 'code' },
      { text: 'return {', tone: 'muted' },
      { text: '  items: items.slice(0, limit),', tone: 'muted' },
      { text: '  page: page.nextPage', tone: 'muted', highlight: true },
      { text: '};', tone: 'muted' },
      { text: ' ', tone: 'muted' },
      { text: "$ cat ./client-py/pagination.py | sed -n '25,27p'", tone: 'code' },
      { text: 'def fetch_page(params):', tone: 'muted' },
      { text: '    response = get_products(params)', tone: 'muted' },
      { text: '    next_page = response["page"]', tone: 'muted', highlight: true }
    ]
  },
  // Quotes `git show ./api/src/routes/products.ts` output from the hunk header on, verified
  // against a real reproduction — the hunk header is condensed for column width ('export'
  // dropped, 'q' for 'query'); the body lines keep their file indentation flush against the
  // sign column, exactly as git prints them, including the blank line 3 printed as a bare
  // context line.
  change: {
    kind: 'diff',
    header: '$ git show ./api/src/routes/products.ts',
    rows: [
      { sign: '@', text: '@@ -3,6 +3,6 @@ function listProducts(q: ProductQuery) {' },
      { sign: ' ', text: '' },
      { sign: ' ', text: '  return {' },
      { sign: ' ', text: '    items: items.slice(0, limit),' },
      { sign: '-', text: '    page: page.nextPage,' },
      { sign: '+', text: '    cursor: page.nextCursor,' },
      { sign: ' ', text: '  };' }
    ]
  },
  // The last five lines of a real CPython 3.13 traceback, transcribed verbatim from a
  // reproduction — quoting the tail is how scrollback actually reads. The path is printed
  // repo-relative (Python would print it absolute) so the line fits the column without
  // scrolling.
  failure: {
    kind: 'lines',
    header: '$ python ./scripts/sync_catalog.py',
    lines: [
      { text: '    page = fetch_page(cursor)', tone: 'muted' },
      { text: '  File "client-py/pagination.py", line 27, in fetch_page', tone: 'muted' },
      { text: '    next_page = response["page"]', tone: 'muted' },
      { text: '                ~~~~~~~~^^^^^^^^', tone: 'muted' },
      { text: "KeyError: 'page'", tone: 'danger' }
    ]
  },
  // The span file itself, cat as a terminal session, in its real on-disk shape (verified
  // against this repo's .span files): one anchor per line as `path#Lstart-Lend rk64:<key>`
  // separated by a single space, a blank line, then the present-tense why. The anchors
  // point at the exact lines the traverse excerpts showed. The why is manually broken into
  // two lines -- the specimen frame no longer soft-wraps (see Specimen.tsx), and one line
  // is wider than the narrowest column can show without a horizontal scrollbar; a real
  // span file's why would just be one long line.
  second: {
    kind: 'lines',
    lines: [
      { text: '$ cat ./.span/product-listing-pagination', tone: 'code' },
      { text: 'api/src/routes/products.ts#L4-L7 rk64:38db8e8540025b2a', tone: 'muted', highlight: true },
      { text: 'client-py/pagination.py#L25-L27  rk64:f4df18e9b3e72d2a', tone: 'muted', highlight: true },
      { text: ' ', tone: 'muted' },
      { text: 'Product-listing pagination is a continuation flow', tone: 'muted' },
      { text: 'implemented across the API and client libraries.', tone: 'muted' }
    ]
  },
  // The agent edits an anchored section, and the PostToolUse hook injects the relationship.
  // The block carries exactly what the recorded span file (the `second` specimen) contains:
  // same name, same two anchors, same why.
  span: {
    kind: 'agent',
    tool: 'Update',
    target: 'api/src/routes/products.ts',
    summary: 'Added 1 line, removed 1 line',
    diff: [
      { line: 4, text: 'return {' },
      { line: 5, text: '  items: items.slice(0, limit),' },
      { line: 6, sign: '-', text: '  page: page.nextPage,' },
      { line: 6, sign: '+', text: '  cursor: page.nextCursor' },
      { line: 7, text: '};' }
    ],
    hookLabel: 'PostToolUse says: <git-span>',
    hookLines: [
      '## product-listing-pagination',
      'api/src/routes/products.ts#L4-L7',
      'client-py/pagination.py#L25-L27',
      ' ',
      'Product-listing pagination is a continuation flow',
      'implemented across the API and client libraries.',
      '</git-span>'
    ]
  },
  // Quotes `git show ./client-py/pagination.py` output from the hunk header on, verified
  // against a real reproduction. The hunk label names get_products because git tags a hunk
  // with the nearest preceding top-level line; the fix renames the continuation variable,
  // so line 28's return changes along with the traceback's line 27.
  related: {
    kind: 'diff',
    header: '$ git show ./client-py/pagination.py',
    rows: [
      { sign: '@', text: '@@ -24,5 +24,5 @@ def get_products(params):' },
      { sign: ' ', text: '' },
      { sign: ' ', text: 'def fetch_page(params):' },
      { sign: ' ', text: '    response = get_products(params)' },
      { sign: '-', text: '    next_page = response["page"]' },
      { sign: '-', text: '    return next_page' },
      { sign: '+', text: '    next_cursor = response["cursor"]' },
      { sign: '+', text: '    return next_cursor' }
    ]
  },
  // The traverse excerpts cat again after the work: both sides now speak "cursor", the
  // highlights marking the restored agreement.
  success: {
    kind: 'lines',
    bracket: true,
    lines: [
      { text: "$ cat ./api/src/routes/products.ts | sed -n '4,7p'", tone: 'code' },
      { text: 'return {', tone: 'muted' },
      { text: '  items: items.slice(0, limit),', tone: 'muted' },
      { text: '  cursor: page.nextCursor', tone: 'muted', highlight: true },
      { text: '};', tone: 'muted' },
      { text: ' ', tone: 'muted' },
      { text: "$ cat ./client-py/pagination.py | sed -n '25,27p'", tone: 'code' },
      { text: 'def fetch_page(params):', tone: 'muted' },
      { text: '    response = get_products(params)', tone: 'muted' },
      { text: '    next_cursor = response["cursor"]', tone: 'muted', highlight: true }
    ]
  }
};

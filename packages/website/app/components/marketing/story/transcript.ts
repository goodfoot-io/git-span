import type { PhaseId } from './scene';

// Per-state terminal content, adapted from reports/unified-homepage.md section 11, presented in
// the visual vocabulary of a Claude Code session. Each state is a self-contained recording of the
// agent working; content may repeat across states (each session repeats its request and diffs).

export type LineKind =
  | 'command' // a tool-run shell command
  | 'user' // the human request (types in)
  | 'read' // the agent reading a file
  | 'action' // the agent editing / writing a file
  | 'output' // neutral tool result
  | 'note' // the agent's own message (types in)
  | 'success' // a passing example
  | 'trace' // a multi-line error / traceback
  | 'span' // the injected <git-span> context block
  | 'blank'; // a spacer line

export interface DiffRow {
  sign: '+' | '-' | ' ';
  text: string;
}

export interface TermLine {
  kind: LineKind | 'diff';
  text?: string;
  lines?: string[];
  diff?: DiffRow[];
  startLine?: number; // first line number for a diff, for a real-codebase gutter
  file?: string; // for a diff: the edited file, shown in the result summary
}

const API_DIFF: DiffRow[] = [
  { sign: ' ', text: 'export async function listProducts(input: ListProductsInput) {' },
  { sign: '-', text: '  const page = await products.listPage(input.page);' },
  { sign: '+', text: '  const page = await products.listAfter(input.cursor);' },
  { sign: ' ', text: '' },
  { sign: ' ', text: '  return {' },
  { sign: ' ', text: '    products: page.items,' },
  { sign: '-', text: '    page: page.nextPage,' },
  { sign: '+', text: '    cursor: page.nextCursor,' },
  { sign: ' ', text: '  };' },
  { sign: ' ', text: '}' }
];

const TS_DIFF: DiffRow[] = [
  { sign: ' ', text: 'export type ProductPage = {' },
  { sign: ' ', text: '  products: Product[];' },
  { sign: '-', text: '  page: number | null;' },
  { sign: '+', text: '  cursor: string | null;' },
  { sign: ' ', text: '};' },
  { sign: ' ', text: '' },
  { sign: ' ', text: 'export function next(page: ProductPage) {' },
  { sign: '-', text: '  return page.page;' },
  { sign: '+', text: '  return page.cursor;' },
  { sign: ' ', text: '}' }
];

const PY_DIFF: DiffRow[] = [
  { sign: ' ', text: '@dataclass' },
  { sign: ' ', text: 'class ProductPage:' },
  { sign: ' ', text: '    products: list[Product]' },
  { sign: '-', text: '    page: int | None' },
  { sign: '+', text: '    cursor: str | None' },
  { sign: ' ', text: '' },
  { sign: ' ', text: 'def next_value(response: dict) -> str | None:' },
  { sign: '-', text: '    return response["page"]' },
  { sign: '+', text: '    return response["cursor"]' }
];

const PY_TRACEBACK: string[] = [
  'Traceback (most recent call last):',
  '  File "packages/client-python/examples/list_products.py", line 17, in <module>',
  '    next_page = response["page"]',
  '                ~~~~~~~~^^^^^^^^',
  "KeyError: 'page'"
];

const SPAN_BLOCK: string[] = [
  '## product-listing-pagination',
  '- packages/api/src/routes/products.ts#L42-L58',
  '- packages/client-ts/src/products/pagination.ts#L18-L34',
  '- packages/client-python/src/products/pagination.py#L21-L37',
  '',
  'Product-listing pagination is a continuation flow implemented across',
  'the API and client libraries.'
];

const REQUEST = '> Change product listings from page-based to cursor-based pagination.';
const BLANK: TermLine = { kind: 'blank' };
const API_FILE = 'packages/api/src/routes/products.ts';
const TS_FILE = 'packages/client-ts/src/products/pagination.ts';
const PY_FILE = 'packages/client-python/src/products/pagination.py';

export const TERMINAL_STATES: Partial<Record<PhaseId, TermLine[]>> = {
  change: [
    { kind: 'user', text: REQUEST },
    { kind: 'read', text: 'Read packages/api/src/routes/products.ts' },
    { kind: 'output', text: 'Read 58 lines (ctrl+o to expand)' },
    { kind: 'read', text: 'Read packages/client-ts/src/products/pagination.ts' },
    { kind: 'output', text: 'Read 34 lines (ctrl+o to expand)' },
    { kind: 'action', text: 'Editing packages/api/src/routes/products.ts' },
    { kind: 'diff', diff: API_DIFF, startLine: 42, file: API_FILE },
    { kind: 'action', text: 'Editing packages/client-ts/src/products/pagination.ts' },
    { kind: 'diff', diff: TS_DIFF, startLine: 18, file: TS_FILE }
  ],
  failure: [
    { kind: 'command', text: '$ pnpm example:list-products' },
    { kind: 'success', text: '✓ cursor: "eyJpZCI6MTAwMH0="' },
    BLANK,
    { kind: 'command', text: '$ uv run packages/client-python/examples/list_products.py' },
    { kind: 'trace', lines: PY_TRACEBACK },
    { kind: 'note', text: 'The Python client still reads response["page"] — it wasn\'t part of this change.' }
  ],
  traverse: [
    { kind: 'user', text: '> exit' },
    { kind: 'command', text: '$ git reset --hard HEAD' },
    { kind: 'output', text: 'HEAD is now at 7c3a21e Add product listing API' }
  ],
  second: [
    { kind: 'user', text: REQUEST },
    { kind: 'read', text: 'Read packages/api/src/routes/products.ts' },
    { kind: 'output', text: 'Read 58 lines (ctrl+o to expand)' },
    { kind: 'action', text: 'Editing packages/api/src/routes/products.ts' },
    { kind: 'diff', diff: API_DIFF, startLine: 42, file: API_FILE },
    { kind: 'action', text: 'Saved packages/api/src/routes/products.ts' }
  ],
  span: [
    { kind: 'span', lines: SPAN_BLOCK },
    { kind: 'note', text: 'git-span has these three sections recorded as one pagination flow.' },
    { kind: 'note', text: "I'll update the TypeScript and Python clients to match the API." }
  ],
  related: [
    { kind: 'read', text: 'Read packages/client-ts/src/products/pagination.ts' },
    { kind: 'output', text: 'Read 34 lines (ctrl+o to expand)' },
    { kind: 'action', text: 'Editing packages/client-ts/src/products/pagination.ts' },
    { kind: 'diff', diff: TS_DIFF, startLine: 18, file: TS_FILE },
    { kind: 'read', text: 'Read packages/client-python/src/products/pagination.py' },
    { kind: 'output', text: 'Read 37 lines (ctrl+o to expand)' },
    { kind: 'action', text: 'Editing packages/client-python/src/products/pagination.py' },
    { kind: 'diff', diff: PY_DIFF, startLine: 21, file: PY_FILE }
  ],
  success: [
    { kind: 'command', text: '$ pnpm example:list-products' },
    { kind: 'success', text: '✓ cursor: "eyJpZCI6MTAwMH0="' },
    BLANK,
    { kind: 'command', text: '$ uv run packages/client-python/examples/list_products.py' },
    { kind: 'success', text: '✓ cursor: "eyJpZCI6MTAwMH0="' }
  ]
};

// A short contextual title per state, shown in the terminal's title bar like a Claude Code
// session name — it hints at what the recording is about.
export const STATE_TITLE: Partial<Record<PhaseId, string>> = {
  change: 'Switch products to cursor pagination',
  failure: 'Python client fails on the page key',
  traverse: 'Reset and start over',
  second: 'Retry — the span is recorded',
  span: 'The pagination span appears',
  related: 'Apply the change across clients',
  success: 'Every client passes'
};

// A playback timeline in seconds. User requests and the agent's own messages "type" character by
// character; commands, tool results, and diffs land as blocks. Each state's total drives its
// player duration and its scrubber.
const TIMING = { charPer: 0.026, typedMin: 0.5, block: 0.5, multi: 0.9, blank: 0.16, gap: 0.14 };

function isTyped(line: TermLine): boolean {
  return line.kind === 'user' || line.kind === 'note';
}

function lineDuration(line: TermLine): number {
  if (line.kind === 'blank') return TIMING.blank;
  if (isTyped(line)) return Math.max(TIMING.typedMin, (line.text?.length ?? 0) * TIMING.charPer);
  if (line.kind === 'diff' || line.kind === 'trace' || line.kind === 'span') return TIMING.multi;
  return TIMING.block;
}

export interface TimelineEntry {
  line: TermLine;
  start: number;
  end: number;
  typed: boolean;
}

export interface StateTimeline {
  entries: TimelineEntry[];
  total: number;
}

function buildTimeline(lines: TermLine[]): StateTimeline {
  const entries: TimelineEntry[] = [];
  let cursor = 0;
  for (const line of lines) {
    const duration = lineDuration(line);
    entries.push({ line, start: cursor, end: cursor + duration, typed: isTyped(line) });
    cursor += duration + TIMING.gap;
  }
  return { entries, total: Math.max(1, cursor) };
}

export const STATE_TIMELINES: Partial<Record<PhaseId, StateTimeline>> = Object.fromEntries(
  Object.entries(TERMINAL_STATES).map(([state, lines]) => [state, buildTimeline(lines ?? [])])
) as Partial<Record<PhaseId, StateTimeline>>;

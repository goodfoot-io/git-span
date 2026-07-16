import type { PhaseId } from './scene';

// Each specimen is 1–3 quiet lines of verbatim repository content proving that section's claim —
// evidence under the prose, never narrative; the page reads complete without them.

export type SpecimenTone = 'code' | 'muted' | 'danger';

export type Specimen =
  | { kind: 'diff'; rows: { sign: '+' | '-'; text: string }[] }
  | { kind: 'lines'; lines: { text: string; tone: SpecimenTone }[] }
  | { kind: 'exhibit'; name: string; anchors: string[]; why: string }
  | { kind: 'agreement'; rows: { code: string; file: string }[] };

export const SPECIMENS: Partial<Record<PhaseId, Specimen>> = {
  change: {
    kind: 'diff',
    rows: [
      { sign: '-', text: 'page: page.nextPage,' },
      { sign: '+', text: 'cursor: page.nextCursor,' }
    ]
  },
  failure: {
    kind: 'lines',
    lines: [
      { text: 'next_page = response["page"]', tone: 'code' },
      { text: "KeyError: 'page'", tone: 'danger' }
    ]
  },
  traverse: {
    kind: 'lines',
    lines: [
      { text: 'api/products.ts · client-py/pagination.py', tone: 'code' },
      { text: 'no import, no reference — one relationship', tone: 'muted' }
    ]
  },
  second: {
    kind: 'lines',
    lines: [
      { text: '.span/product-listing-pagination', tone: 'code' },
      { text: 'api/products.ts · client-ts/pagination.ts · client-py/pagination.py', tone: 'muted' }
    ]
  },
  span: {
    kind: 'exhibit',
    name: 'product-listing-pagination',
    anchors: ['api/products.ts#L42-L58', 'client-ts/pagination.ts#L18-L34', 'client-py/pagination.py#L21-L37'],
    why: 'Product-listing pagination is a continuation flow implemented across the API and client libraries.'
  },
  related: {
    kind: 'diff',
    rows: [
      { sign: '-', text: 'return response["page"]' },
      { sign: '+', text: 'return response["cursor"]' }
    ]
  },
  success: {
    kind: 'agreement',
    rows: [
      { code: 'cursor: page.nextCursor', file: 'api/products.ts' },
      { code: 'page.cursor', file: 'client-ts/pagination.ts' },
      { code: 'response["cursor"]', file: 'client-py/pagination.py' }
    ]
  }
};

import type { PhaseId } from './scene';

export interface HeadlineSegment {
  text: string;
  code: boolean;
}

export interface Cta {
  label: string;
  href: string;
}

export interface HeroCopy {
  headline: HeadlineSegment[];
  supporting: string;
  primaryCta: Cta;
  secondaryCta: Cta;
}

export interface ClosingCopy {
  headline: string;
  primaryCta: Cta;
  secondaryCta: Cta;
}

export interface Stage {
  headline: string;
  body: string;
}

export interface PhaseCopyEntry {
  prose: Stage | null;
  caption: string;
}

const GITHUB_URL = 'https://github.com/goodfoot-io/git-span';
const DOCS_URL = '/docs';

const PRIMARY_CTA: Cta = { label: 'View & star on GitHub', href: GITHUB_URL };
const SECONDARY_CTA: Cta = { label: 'Get started', href: DOCS_URL };

export const HERO: HeroCopy = {
  headline: [
    { text: 'Git tracks the changes. ', code: false },
    { text: 'git-span', code: true },
    { text: ' tracks the consequences.', code: false }
  ],
  supporting:
    'Record durable relationships between exact sections of your repository. When one changes, git-span brings ' +
    'the connected code into your coding agent’s context.',
  primaryCta: PRIMARY_CTA,
  secondaryCta: SECONDARY_CTA
};

export const CLOSING: ClosingCopy = {
  headline: 'Record the relationships your code cannot express.',
  primaryCta: PRIMARY_CTA,
  secondaryCta: SECONDARY_CTA
};

// Captions are the animation-beat descriptions for the media window: they seed the loading
// fallback and the aria-live state announcements while the engine renders. The animation is an
// engine: assembled and slowly rotating, exploded into a 3D technical view, changed (the belt,
// its sprockets, and the front accessory drive resize under a translucent green highlight),
// failed reassembly (the resized parts stop short of the block's front mounts, which flag red),
// re-exploded, amber linkage surfacing the recorded relationship, the mounts resized to match
// under green, and finally reassembled cleanly.
export const PHASE_COPY: Record<PhaseId, PhaseCopyEntry> = {
  hero: {
    prose: null,
    caption: 'The assembled engine hangs suspended in space, slowly rotating'
  },
  traverse: {
    prose: {
      headline: 'Your code is full of relationships it can’t express.',
      body: 'An API and its clients. A schema and its migrations. A constant and the tests that assume it. Every repository is held together by sections that form one subsystem with nothing connecting them — no import, no reference. Those relationships exist only in someone’s understanding.'
    },
    caption:
      'The camera zooms out; the components separate in unison into a 3D technical exploded view, each part suspended along its axis of assembly with clear space between them'
  },
  change: {
    prose: {
      headline: 'You change one part of the system.',
      body: 'You change one file and commit it. Git records the new lines exactly — and records nothing about the other sections of the repository that were written against the behavior you just replaced.'
    },
    caption:
      'The serpentine belt, the crankshaft and camshaft sprockets, and the front accessory drive change size under a translucent green highlight; nothing else moves'
  },
  failure: {
    prose: {
      headline: 'Miss one consequence, and the larger system stops fitting together.',
      body: 'The dependency that failed was never an import, a type, or a package manifest — nothing a compiler resolves or a diff reveals. It was a shared assumption between distant sections, still sitting in the source, and it broke at integration.'
    },
    caption:
      'The camera zooms in; the engine attempts to reassemble, but the resized belt drive stops short of its seat — the front mounts on the engine block highlight red at the gap'
  },
  second: {
    prose: {
      headline: 'A span records which sections belong together and why.',
      body: 'A span is a name, two or more exact anchors — file paths with line ranges — and a durable, present-tense definition of the subsystem those sections form. Someone who understood this relationship recorded it — git span add, git span why — and committed it like any other file. It sits quietly in the tree, inert until a recorded section changes.'
    },
    caption:
      'The camera zooms out; the components separate in unison back into the exploded view, each part again suspended along its axis of assembly'
  },
  span: {
    prose: {
      headline: 'Touch one section, and the whole relationship surfaces.',
      body: 'The moment an anchored section is edited, a hook injects the relationship into your coding agent’s context: the name, the exact locations, the standing definition. The agent now knows what you knew when you recorded it.'
    },
    caption:
      'Thin amber lines draw from the resized parts to the front mounts on the block — the recorded relationship surfaces, and only those mounts begin to glow green'
  },
  related: {
    prose: {
      headline: 'git-span brings those sections into your work.',
      body: 'The agent — or you — reads each surfaced location and changes what the new behavior requires. git-span never edits code; it puts the relationship in front of whoever does, before the work is called complete.'
    },
    caption:
      'The front mounts resize to match the new belt drive, staying green until they agree; the amber linkage fades as the geometry resolves'
  },
  success: {
    prose: {
      headline: 'This time, the whole system fits together.',
      body: 'The change integrates on the first attempt, because every section of the relationship was part of the work. Git tracked the changes; git-span carried the consequences.'
    },
    caption:
      'The camera zooms in; the engine reassembles with the same motion as the failed attempt — this time everything fits perfectly and the engine stands fully assembled'
  }
};

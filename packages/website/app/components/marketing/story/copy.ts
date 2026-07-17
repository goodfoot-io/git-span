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
// engine: assembled, viewed end-on down its crankshaft as it would sit in a car and slowly
// orbiting, exploding into a 3D technical view as soon as scrolling begins (with a brief orange
// flash on the ring gear and rear cover as the camera settles into its final angle), changed (the
// large ring gear grows and lifts off its seat under a translucent green highlight while the rear
// cover glows red in sympathy), failed
// reassembly (the modified ring gear no longer sits flush against the engine's rear cover, which
// flags red at the gap), re-exploded, an amber line from the ring gear surfacing the recorded
// relationship with the cover, the cover resizing and rising to meet the gear under green, and
// finally reassembled cleanly.
export const PHASE_COPY: Record<PhaseId, PhaseCopyEntry> = {
  hero: {
    prose: null,
    caption: 'The assembled engine is viewed end-on along its crankshaft, as it sits in a car, slowly orbiting'
  },
  traverse: {
    prose: {
      headline: 'Your code is full of relationships it can’t express.',
      body: 'An API and its clients. A schema and its migrations. A constant and the tests that assume it. Every repository is held together by sections that form one subsystem with nothing connecting them — no import, no reference. Those relationships exist only in someone’s understanding.'
    },
    caption:
      'The engine, already separating since the first scroll, continues pulling apart into a 3D technical exploded view, each part suspended along its axis of assembly with clear space between them; the camera settles into its final angle partway through, and the ring gear and rear cover briefly flash orange as it does'
  },
  change: {
    prose: {
      headline: 'You change one part of the system.',
      body: 'You change one file and commit it. Git records the new lines exactly — and records nothing about the other sections of the repository that were written against the behavior you just replaced.'
    },
    caption:
      'The large ring gear grows larger and lifts up off its seat under a translucent green highlight, while the engine’s rear cover glows red in sympathy — nothing else moves'
  },
  failure: {
    prose: {
      headline: 'Miss one consequence, and the larger system stops fitting together.',
      body: 'The dependency that failed was never an import, a type, or a package manifest — nothing a compiler resolves or a diff reveals. It was a shared assumption between distant sections, still sitting in the source, and it broke at integration.'
    },
    caption:
      'The camera zooms in; the engine attempts to reassemble, but the modified ring gear no longer sits flush against its seat — the engine’s rear cover highlights red at the gap'
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
      'A thin amber line draws from the ring gear to the engine’s rear cover — the recorded relationship surfaces, and only that cover begins to glow green'
  },
  related: {
    prose: {
      headline: 'git-span brings those sections into your work.',
      body: 'The agent — or you — reads each surfaced location and changes what the new behavior requires. git-span never edits code; it puts the relationship in front of whoever does, before the work is called complete.'
    },
    caption:
      'The rear cover resizes and rises to meet the ring gear, staying green until they agree; the amber line fades as the geometry resolves'
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

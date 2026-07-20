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
// orbiting, exploding into a 3D technical view as soon as scrolling begins. A sustained orange
// pulse rises on the ring gear, the 8 pistons, and the rear cover as the camera settles into its
// final angle (t7.5-28); the ring gear then grows and turns blue while the pistons and rear cover
// turn red (t16-24), and the ring gear's own blue deepens to that same red (t28-41) -- no lift, no
// separate "failure" motion, just a color story playing out on parts held in their exploded
// positions. All color then drains away and the ring gear shrinks back to its normal size as a
// translucent green bounding box fades in around it, the pistons, and the rear cover (t46-60);
// the box fades back out as those parts fade up to a shared, permanent green (t60-72). The ring
// gear grows again (t72-83), the rear cover resizes to meet it, and the whole engine draws back
// together and reassembles (t83-87), ending fully assembled with the resolved parts still green.
// There is no amber line, no camera zoom tied to any of these beats, and no residual reassembly
// gap -- camera motion only happens across the hero->traverse handoff (settling by t=12.3), plus
// a slow ambient azimuth drift and whatever the user drags.
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
      'The engine, already separating since the first scroll, continues pulling apart into a 3D technical exploded view, each part suspended along its axis of assembly with clear space between them; the camera settles into its final angle partway through, and the ring gear, the pistons, and the rear cover hold a sustained, gentle orange pulse as it does'
  },
  change: {
    prose: {
      headline: 'You change one part of the system.',
      body: 'You change one file and commit it. Git records the new lines exactly — and records nothing about the other sections of the repository that were written against the behavior you just replaced.'
    },
    caption:
      'The large ring gear grows and turns blue in place, while the pistons and the engine’s rear cover turn red in sympathy — nothing lifts, nothing else moves'
  },
  failure: {
    prose: {
      headline: 'Miss one consequence, and the larger system stops fitting together.',
      body: 'The dependency that failed was never an import, a type, or a package manifest — nothing a compiler resolves or a diff reveals. It was a shared assumption between distant sections, still sitting in the source, and it broke at integration.'
    },
    caption:
      'The ring gear’s blue deepens into the same red already showing on the pistons and the rear cover — no reassembly attempt, no gap, no camera motion'
  },
  second: {
    prose: {
      headline: 'A span records which sections belong together and why.',
      body: 'A span is a name, two or more exact anchors — file paths with line ranges — and a durable, present-tense definition of the subsystem those sections form. Someone who understood this relationship recorded it — git span add, git span why — and committed it like any other file. It sits quietly in the tree, inert until a recorded section changes.'
    },
    caption:
      'No motion, no zoom: the color drains away from the ring gear, the pistons, and the rear cover, the ring gear shrinks back to its normal size, and a translucent green bounding box fades in around the three of them'
  },
  span: {
    prose: {
      headline: 'Touch one section, and the whole relationship surfaces.',
      body: 'The moment an anchored section is edited, a hook injects the relationship into your coding agent’s context: the name, the exact locations, the standing definition. The agent now knows what you knew when you recorded it.'
    },
    caption:
      'The bounding box fades out as the ring gear, the pistons, and the rear cover fade up together into a shared green glow'
  },
  related: {
    prose: {
      headline: 'git-span brings those sections into your work.',
      body: 'The agent — or you — reads each surfaced location and changes what the new behavior requires. git-span never edits code; it puts the relationship in front of whoever does, before the work is called complete.'
    },
    caption:
      'The ring gear grows again, the rear cover resizes to meet it, and the whole engine draws back together and reassembles — everything stays green throughout'
  },
  success: {
    prose: {
      headline: 'This time, the whole system fits together.',
      body: 'The change integrates on the first attempt, because every section of the relationship was part of the work. Git tracked the changes; git-span carried the consequences.'
    },
    caption:
      'No zoom: the engine stands fully assembled, every part fitting together, the resolved ring gear, pistons, and rear cover still holding their shared green'
  }
};

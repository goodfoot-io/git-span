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
    { text: 'Spans', code: false },
    { text: ' track the consequences.', code: false }
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
// final angle (t7.5-20); the ring gear then turns blue while the pistons and rear cover turn red
// (t16-20), the ring gear grows as its own beat (t22-27), and the ring gear's own blue deepens to
// that same red (t30-34). While that red deepens, the engine attempts to reassemble: it draws
// fully back together around the oversized red ring gear (t32-43) -- the failed fit made motion --
// holds assembled for a beat, then pulls back apart into the exploded view (t48-58). All color
// drains away and the ring gear shrinks back to its normal size while the engine re-explodes
// (t46-60); only once the re-explode has finished does a box of green glass fade in tightly around
// the ring gear, the pistons, and the rear cover (t58-60); the box fades back out as those parts
// fade up to a shared green (t60-72). The ring gear grows
// again (t72-83), the rear cover resizes to meet it, and the whole engine draws back together and
// reassembles (t83-87) while the camera eases back out to the hero's framing on the same window --
// every collapsed pose from t87 on shows the engine at exactly its hero size -- then holds fully
// assembled with the resolved parts still green through most of the remaining scroll. Then, at the
// very end (t93-100), the green fades away, the ring gear and rear cover ease back to their
// natural size, and the fully assembled engine resumes the same slow rotation it opened with --
// ending exactly as it began. There is no amber line and no residual reassembly gap -- camera
// motion only happens across the hero->traverse handoff (settling by t=12.3), the ease back to
// the hero framing during the reassembly (t83-87), plus a slow ambient azimuth drift, the idle
// turntable (faded out since early scroll, resumed at the very end), and whatever the user drags.
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
      'The large ring gear turns blue in place and then grows, while the pistons and the engine’s rear cover turn red in sympathy — then the whole engine begins drawing back together around the oversized gear'
  },
  failure: {
    prose: {
      headline: 'Miss one consequence, and the larger system stops fitting together.',
      body: 'The dependency that failed was never an import, a type, or a package manifest — nothing a compiler resolves or a diff reveals. It was a shared assumption between distant sections, still sitting in the source, and it broke at integration.'
    },
    caption:
      'The engine draws fully back together around the oversized ring gear as its blue deepens into the same red already showing on the pistons and the rear cover — the attempted assembly that no longer fits — holds for a beat, then begins pulling back apart'
  },
  second: {
    prose: {
      headline: 'A span records which sections belong together and why.',
      body: 'A span is a name, two or more exact anchors — file paths with line ranges — and a durable, present-tense definition of the subsystem those sections form. Someone who understood this relationship recorded it — git span add, git span why — and committed it like any other file. It sits quietly in the tree, inert until a recorded section changes.'
    },
    caption:
      'The engine settles back into its exploded view as the color drains away from the ring gear, the pistons, and the rear cover and the ring gear shrinks back to its normal size; once everything is back in place, a box of green glass fades in tightly around the three of them'
  },
  span: {
    prose: {
      headline: 'Touch one section, and the whole relationship surfaces.',
      body: 'The moment an anchored section is edited, a hook injects the relationship into your coding agent’s context: the name, the exact locations, the standing definition. The agent now knows what you knew when you recorded it.'
    },
    caption:
      'The glass box fades out as the ring gear, the pistons, and the rear cover fade up together into a shared green glow'
  },
  related: {
    prose: {
      headline: 'git-span brings those sections into your work.',
      body: 'The agent — or you — reads each surfaced location and changes what the new behavior requires. git-span never edits code; it puts the relationship in front of whoever does, before the work is called complete.'
    },
    caption:
      'The ring gear grows again, the rear cover resizes to meet it, and the whole engine draws back together and reassembles as the camera eases back out to the opening framing — everything stays green through most of this, until the fade back to normal begins near the very end'
  },
  success: {
    prose: {
      headline: 'This time, the whole system fits together.',
      body: 'The change integrates on the first attempt, because every section of the relationship was part of the work. Git tracked the changes; git-span carried the consequences.'
    },
    caption:
      'The engine stands fully assembled at its opening size, every part fitting together — the shared green fades away, the ring gear, pistons, and rear cover return to their natural size and color, and the fully assembled engine resumes the same slow rotation it opened with'
  }
};

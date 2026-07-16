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

// Captions are the animation-beat descriptions shown in the media window while that phase is
// active.
export const PHASE_COPY: Record<PhaseId, PhaseCopyEntry> = {
  hero: {
    prose: null,
    caption: 'An exploded assembly, aligned — every part currently agrees'
  },
  change: {
    prose: {
      headline: 'You change one part of the system.',
      body: 'You change one file and commit it. Git records the new lines exactly — and records nothing about the other sections of the repository that were written against the behavior you just replaced.'
    },
    caption: 'One part takes a new geometry; nothing else moves'
  },
  failure: {
    prose: {
      headline: 'Miss one consequence, and the larger system stops fitting together.',
      body: 'The dependency that failed was never an import, a type, or a package manifest — nothing a compiler resolves or a diff reveals. It was a shared assumption between distant sections, still sitting in the source, and it broke at integration.'
    },
    caption: 'The parts move toward assembly; three mounting points miss'
  },
  traverse: {
    prose: {
      headline: 'Your code is full of relationships it can’t express.',
      body: 'An API and its clients. A schema and its migrations. A constant and the tests that assume it. Every repository is held together by sections that form one subsystem with nothing connecting them — no import, no reference. Those relationships exist only in someone’s understanding.'
    },
    caption: 'The wide shot — the failure recedes; the camera crosses one machine holding many such assemblies'
  },
  second: {
    prose: {
      headline: 'A span records which sections belong together and why.',
      body: 'A span is a name, two or more exact anchors — file paths with line ranges — and a durable, present-tense definition of the subsystem those sections form. Someone who understood this relationship recorded it — git span add, git span why — and committed it like any other file. It sits quietly in the tree, inert until a recorded section changes.'
    },
    caption: 'The same change begins again; nothing looks different'
  },
  span: {
    prose: {
      headline: 'Touch one section, and the whole relationship surfaces.',
      body: 'The moment an anchored section is edited, a hook injects the relationship into your coding agent’s context: the name, the exact locations, the standing definition. The agent now knows what you knew when you recorded it.'
    },
    caption: 'Amber linkage connects three parts, resolving into shared geometry'
  },
  related: {
    prose: {
      headline: 'git-span brings those sections into your work.',
      body: 'The agent — or you — reads each surfaced location and changes what the new behavior requires. git-span never edits code; it puts the relationship in front of whoever does, before the work is called complete.'
    },
    caption: 'The linkage becomes guides; related interfaces adjust into agreement'
  },
  success: {
    prose: {
      headline: 'This time, the whole system fits together.',
      body: 'The change integrates on the first attempt, because every section of the relationship was part of the work. Git tracked the changes; git-span carried the consequences.'
    },
    caption: 'The same motion as the failed attempt; every interface seats'
  }
};

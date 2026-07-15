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

export type StageId = 'A' | 'B' | 'C' | 'D';

export interface PhaseCopyEntry {
  stage: StageId | null;
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

export const STAGES: Record<StageId, Stage> = {
  A: {
    headline: 'You change one part of the system.',
    body: 'The code you touched can be correct while another implementation still depends on the behavior you replaced.'
  },
  B: {
    headline: 'Miss one consequence, and the larger system stops fitting together.',
    body: 'Every file can still be valid on its own. The failure appears when the pieces try to work together.'
  },
  C: {
    headline: 'A span records which sections belong together and why.',
    body: 'It stores exact locations and a durable definition of the subsystem they collectively form.'
  },
  D: {
    headline: 'git-span brings those sections into your work.',
    body: 'You—or your coding agent—can change the whole relationship before the work is considered complete.'
  }
};

export const PHASE_COPY: Record<PhaseId, PhaseCopyEntry> = {
  hero: {
    stage: null,
    caption: 'Aligned exploded assembly — every part currently agrees'
  },
  change: {
    stage: 'A',
    caption: 'Local change — the lower control arm shifts to a new three-point geometry'
  },
  failure: {
    stage: 'B',
    caption: 'Implosion — three mounting points fail to align'
  },
  traverse: {
    stage: 'B',
    caption: 'Re-explosion and traversal — the camera crosses the chassis to a second assembly'
  },
  second: {
    stage: 'C',
    caption: 'Second session — an analogous control arm changes from a clean start'
  },
  span: {
    stage: 'C',
    caption: 'Span appears — recorded linkage resolves into shared triangular geometry'
  },
  related: {
    stage: 'D',
    caption: 'Related changes — linkage lines become adjustment guides and mounts morph'
  },
  success: {
    stage: 'D',
    caption: 'Successful integration — all three interfaces seat and align'
  }
};

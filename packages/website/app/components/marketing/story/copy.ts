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
const GETTING_STARTED_URL = '/docs/getting-started';

const PRIMARY_CTA: Cta = { label: 'Install git-span', href: GETTING_STARTED_URL };
const SECONDARY_CTA: Cta = { label: 'View on GitHub', href: GITHUB_URL };

export const HERO: HeroCopy = {
  headline: [
    { text: 'Git tracks changes. ', code: false },
    { text: 'Spans', code: false },
    { text: ' track connections.', code: false }
  ],
  supporting:
    'Spans document implicit dependencies, the invisible connections in your project that type systems cannot see. ' +
    'Coding agents using git-span understand how the changes they make will affect other parts of the repository.',
  primaryCta: PRIMARY_CTA,
  secondaryCta: SECONDARY_CTA
};

export const CLOSING: ClosingCopy = {
  headline: 'Give agents the context they need.',
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
      headline: 'Some files depend on each other but are not directly connected.',
      body: 'Separate parts of a repository often participate in the same behavior. An API response and the client code that reads it. SDKs written in different languages. No import, type, or reference connects these sections, but changing one can require attention elsewhere. Without a place to record the connection, it survives only as long as someone remembers it.'
    },
    caption:
      'The engine, already separating since the first scroll, continues pulling apart into a 3D technical exploded view, each part suspended along its axis of assembly with clear space between them; the camera settles into its final angle partway through, and the ring gear, the pistons, and the rear cover hold a sustained, gentle orange pulse as it does'
  },
  change: {
    prose: {
      headline: 'Coding agents change files without understanding the consequences.',
      body: 'Your coding agent renames an API response field, implemented in TypeScript, from “page” to “cursor.” Git records the edited line exactly. Nothing in the commit points to the Python client that still reads “page.”'
    },
    caption:
      'The large ring gear turns blue in place and then grows, while the pistons and the engine’s rear cover turn red in sympathy — then the whole engine begins drawing back together around the oversized gear'
  },
  failure: {
    prose: {
      headline: "By the time you notice it's already too late.",
      body: 'The API change looks complete. Then the catalog sync reaches the untouched client and crashes. The connection becomes visible only after the work looked finished, when rediscovering it costs the most.'
    },
    caption:
      'The engine draws fully back together around the oversized ring gear as its blue deepens into the same red already showing on the pistons and the rear cover — the attempted assembly that no longer fits — holds for a beat, then begins pulling back apart'
  },
  second: {
    prose: {
      headline: 'Spans help coding agents understand hidden connections.',
      body: 'A span gives the connection a name, identifies the exact file and line locations involved, and explains why those sections belong together. It lives in .span/ as ordinary tracked text, so it can be reviewed, committed, and shared with the code.'
    },
    caption:
      'The engine settles back into its exploded view as the color drains away from the ring gear, the pistons, and the rear cover and the ring gear shrinks back to its normal size; once everything is back in place, a box of green glass fades in tightly around the three of them'
  },
  span: {
    prose: {
      headline: 'Spans document code when and where agents need it, but not before.',
      body: 'When a coding agent reads or edits a recorded line range, git-span puts the span into its context before the tool runs. The agent receives the span’s name, every connected location, and the explanation of how those sections relate. The client that was absent from the diff is now part of the work.'
    },
    caption:
      'The glass box fades out as the ring gear, the pistons, and the rear cover fade up together into a shared green glow'
  },
  related: {
    prose: {
      headline: 'Understanding connections leads to better decisions.',
      body: 'The agent follows the surfaced location, reads the client code, and updates it to use “cursor.” git-span never edits source code or chooses the fix. It brings recorded knowledge into the work while there is still time to act on it.'
    },
    caption:
      'The ring gear grows again, the rear cover resizes to meet it, and the whole engine draws back together and reassembles as the camera eases back out to the opening framing — everything stays green through most of this, until the fade back to normal begins near the very end'
  },
  success: {
    prose: {
      headline: 'Agents succeed with the right context.',
      body: 'The API and client now agree on “cursor.” The catalog sync passes. No late crash. No return to work everyone thought was finished. Git tracked the edits. The span kept the connection visible.'
    },
    caption:
      'The engine stands fully assembled at its opening size, every part fitting together — the shared green fades away, the ring gear, pistons, and rear cover return to their natural size and color, and the fully assembled engine resumes the same slow rotation it opened with'
  }
};

import { useRef } from 'react';
import type { MetaFunction } from 'react-router';
import { Link } from 'react-router';
import { CLOSING, HERO, PHASE_COPY } from '~/components/marketing/story/copy';
import { EngineStage } from '~/components/marketing/story/EngineStage';
import { deriveScene, TIMELINE, TimelineReadout, useTimeline } from '~/components/marketing/story/index';
import { PhaseSpecimen } from '~/components/marketing/story/Specimen';
import { useMediaQuery } from '~/lib/useMediaQuery';

export const meta: MetaFunction = () => [
  { title: 'git-span -- Semantic code annotations for git' },
  {
    name: 'description',
    content:
      'Git-native code annotations that ship with every commit. Keep context where it belongs -- in your source tree, not your brain.'
  }
];

// The narrative states, one scrolling step each. The hero is the unmeasured lead-in above them.
const STORY_STEPS = TIMELINE.filter((phase) => phase.id !== 'hero');

// Each step is as tall as its phase weight, so the steps sum to the timeline's scroll distance
// and each step's scroll range lines up with its engine state. Below lg the engine column isn't
// rendered at all, so these heights only apply at lg+ -- narrower viewports get natural height.
function stepHeightClass(scrollVh: number): string {
  if (scrollVh === 1.5) return 'lg:min-h-[150vh]';
  if (scrollVh === 0.5) return 'lg:min-h-[50vh]';
  return 'lg:min-h-screen';
}

interface CtaLink {
  label: string;
  href: string;
}

function CtaButtons({ primary, secondary }: { primary: CtaLink; secondary: CtaLink }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Link
        to={primary.href}
        className="inline-flex items-center rounded-radius bg-accent px-5 py-3 font-mono text-sm font-medium text-white transition-colors hover:bg-accent-hover"
      >
        {primary.label}
      </Link>
      <Link
        to={secondary.href}
        className="inline-flex items-center rounded-radius border border-rule px-5 py-3 font-mono text-sm font-medium text-ink-primary transition-colors hover:bg-ground-raised"
      >
        {secondary.label}
      </Link>
    </div>
  );
}

function HeroIntro() {
  return (
    // Below lg there is no engine column, so the single content column centers itself and takes a
    // wider measure; at lg+ the split layout owns the measure and it snaps back to the left rail.
    <div className="mx-auto w-full max-w-xl lg:mx-0 lg:max-w-md">
      <h1 className="text-[2.6rem] font-semibold leading-[1.05] tracking-[-0.02em] text-balance text-ink-primary sm:text-5xl lg:text-[3.5rem]">
        {HERO.headline.map((segment) =>
          segment.code ? (
            <span key={segment.text} className="font-mono">
              {segment.text}
            </span>
          ) : (
            <span key={segment.text}>{segment.text}</span>
          )
        )}
      </h1>
      <p className="mt-6 text-lg leading-relaxed text-ink-secondary">{HERO.supporting}</p>
      <div className="mt-8">
        <CtaButtons primary={HERO.primaryCta} secondary={HERO.secondaryCta} />
      </div>
    </div>
  );
}

export default function Index() {
  const firstStepRef = useRef<HTMLDivElement | null>(null);
  const t = useTimeline(firstStepRef);
  const scene = deriveScene(t);
  // The engine can't fit below lg (see EngineStage), so it's only mounted -- and three.js only
  // loaded -- once a real lg+ viewport is confirmed client-side. Initial SSR/first-paint value is
  // false so hydration matches; the outer column is also `hidden lg:block` so nothing shifts
  // while this resolves.
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  return (
    <div className="bg-ground text-ink-primary">
      {/*
        Persistent split screen. The left column scrolls: a hero lead-in, then one prose step per
        state. The right column is pinned and scrubs through the engine states as those steps
        scroll past.
      */}
      <section className="w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12">
          <div className="px-6 lg:col-span-5 lg:pr-8 lg:pl-12">
            {/*
              Unmeasured full-viewport hero lead-in. It gives the first measured step a viewport
              of content above it, so at rest that step sits at the viewport bottom and the timeline
              resolves to t=0. Scrolling through the hero is the timeline's first (hero) state.
              Below lg the engine column doesn't render, so this doesn't need to reserve a full
              viewport -- it gets natural height instead.
            */}
            <div className="flex min-h-0 flex-col py-24 lg:min-h-screen lg:justify-center">
              <HeroIntro />
            </div>

            {STORY_STEPS.map((phase, index) => {
              const prose = PHASE_COPY[phase.id].prose;
              const eyebrow = `${String(index + 2).padStart(2, '0')} — ${phase.label.toUpperCase()}`;
              return (
                <div
                  key={phase.id}
                  ref={index === 0 ? firstStepRef : undefined}
                  className={`flex flex-col justify-center py-14 lg:py-12 ${stepHeightClass(phase.scrollVh)}`}
                >
                  {prose && (
                    <div className="mx-auto w-full max-w-xl lg:mx-0 lg:max-w-md">
                      <p className="mb-3 font-mono text-xs uppercase tracking-[0.08em] text-ink-tertiary-deep">
                        {eyebrow}
                      </p>
                      <h2 className="text-[1.6rem] font-semibold tracking-tight text-ink-primary sm:text-3xl">
                        {prose.headline}
                      </h2>
                      <p className="mt-3 text-base leading-relaxed text-ink-secondary">{prose.body}</p>
                      <div className="mt-6">
                        <PhaseSpecimen state={phase.id} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Trailing spacer: (100vh − last step height) / 2. It keeps the sticky media pinned until the
                final step's content crosses the viewport center — the pin releases exactly at t=100.
                Only meaningful once the engine column renders, at lg+. */}
            <div aria-hidden className="hidden h-[25vh] lg:block" />
          </div>

          {/*
            Full-bleed media. The column runs to the right viewport edge so the engine frame
            occupies the right side generously. The engine itself keeps a clear whitespace margin
            inside the frame at all times — no part of it is ever cropped or touches the edges.
            Hidden below lg: the engine can't fit on phones/tablets, and gating the mount on
            `isDesktop` keeps three.js from ever loading there.
          */}
          <div className="hidden lg:col-span-7 lg:block">
            <div className="flex h-[calc(100vh-4rem)] items-stretch lg:sticky lg:top-16">
              {isDesktop && <EngineStage scene={scene} />}
            </div>
          </div>
        </div>
      </section>

      {/* Closing. The full-width top rule terminates the split layout's column rule and the
          engine's scroll-away tail with a clean sectioning line. The eyebrow continues the
          steps' numbered sequence (the last story step is 08) so the CTA reads as the final
          beat of the narrative rather than a detached banner. */}
      <section className="border-t border-rule bg-ground">
        <div className="mx-auto max-w-2xl px-6 py-24 text-center">
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.08em] text-ink-tertiary-deep">09 — Get started</p>
          <h2 className="text-3xl font-semibold tracking-tight text-ink-primary sm:text-4xl">{CLOSING.headline}</h2>
          <div className="mt-8 flex justify-center">
            <CtaButtons primary={CLOSING.primaryCta} secondary={CLOSING.secondaryCta} />
          </div>
        </div>
      </section>

      <TimelineReadout t={t} />
    </div>
  );
}

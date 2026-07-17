import { useRef } from 'react';
import type { MetaFunction } from 'react-router';
import { Link } from 'react-router';
import { CLOSING, HERO, PHASE_COPY } from '~/components/marketing/story/copy';
import { EngineStage } from '~/components/marketing/story/EngineStage';
import { deriveScene, TIMELINE, TimelineReadout, useTimeline } from '~/components/marketing/story/index';
import { PhaseSpecimen } from '~/components/marketing/story/Specimen';

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
// and each step's scroll range lines up with its engine state.
function stepHeightClass(scrollVh: number): string {
  if (scrollVh === 1.5) return 'min-h-[150vh]';
  if (scrollVh === 0.5) return 'min-h-[50vh]';
  return 'min-h-screen';
}

interface CtaLink {
  label: string;
  href: string;
}

function CtaButtons({ primary, secondary }: { primary: CtaLink; secondary: CtaLink }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <a
        href={primary.href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center rounded-radius bg-ink-primary px-6 py-3 text-sm font-semibold text-ground-raised transition-opacity hover:opacity-90"
      >
        {primary.label}
      </a>
      <Link
        to={secondary.href}
        className="inline-flex items-center rounded-radius border border-rule px-6 py-3 text-sm font-semibold text-ink-primary transition-colors hover:bg-ground-raised"
      >
        {secondary.label}
      </Link>
    </div>
  );
}

function HeroIntro() {
  return (
    <div className="max-w-md">
      <h1 className="text-4xl font-bold leading-tight tracking-tight text-ink-primary sm:text-5xl">
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
            */}
            <div className="flex min-h-screen flex-col justify-center">
              <HeroIntro />
            </div>

            {STORY_STEPS.map((phase, index) => {
              const prose = PHASE_COPY[phase.id].prose;
              return (
                <div
                  key={phase.id}
                  ref={index === 0 ? firstStepRef : undefined}
                  className={`flex flex-col justify-center py-12 ${stepHeightClass(phase.scrollVh)}`}
                >
                  {prose && (
                    <div className="max-w-md">
                      <h2 className="text-2xl font-semibold text-ink-primary sm:text-3xl">{prose.headline}</h2>
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
                final step's content crosses the viewport center — the pin releases exactly at t=100. */}
            <div aria-hidden className="h-[25vh]" />
          </div>

          {/*
            Full-bleed media. The column runs to the right viewport edge so the engine frame
            occupies the right side generously. The engine itself keeps a clear whitespace margin
            inside the frame at all times — no part of it is ever cropped or touches the edges.
          */}
          <div className="lg:col-span-7">
            <div className="flex h-[28rem] items-stretch px-6 py-12 lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:px-0 lg:py-6 lg:pr-6">
              <EngineStage scene={scene} />
            </div>
          </div>
        </div>
      </section>

      {/* Closing */}
      <section className="mx-auto max-w-2xl px-6 py-32 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-ink-primary sm:text-4xl">{CLOSING.headline}</h2>
        <div className="mt-8 flex justify-center">
          <CtaButtons primary={CLOSING.primaryCta} secondary={CLOSING.secondaryCta} />
        </div>
      </section>

      <TimelineReadout t={t} />
    </div>
  );
}

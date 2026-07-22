import { useEffect, useRef, useState } from 'react';
import { PHASE_COPY } from './copy';
import { stageBackgroundCssAt, stageLabelColorAt } from './engine/backdrop';
import { engineFrame, RETURN_TO_NORMAL_START_T } from './engine/beats';
import type { EngineScene } from './engine/EngineScene';
import type { SceneState } from './scene';

interface EngineStageProps {
  scene: SceneState;
}

type Status = 'loading' | 'ready' | 'fallback';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function EngineStage({ scene }: EngineStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<EngineScene | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  // Client-only boot: three.js never loads during SSR, and the homepage's initial bundle stays
  // untouched by it. A failed WebGL context or load falls back to the quiet dashed frame.
  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    let resizeObserver: ResizeObserver | null = null;

    (async () => {
      try {
        const { EngineScene: EngineSceneImpl } = await import('./engine/EngineScene');
        if (cancelled) return;
        const instance = new EngineSceneImpl(container);
        await instance.load();
        if (cancelled) {
          instance.dispose();
          return;
        }
        engineRef.current = instance;
        resizeObserver = new ResizeObserver(() => instance.resize());
        resizeObserver.observe(container);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('fallback');
      }
    })();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  // Drive the baked scene from the pure beat math on every scroll-derived scene change.
  useEffect(() => {
    if (status !== 'ready') return;
    const engine = engineRef.current;
    if (!engine) return;
    engine.setFrame(engineFrame(scene));
    // The turntable accumulates rotation during `hero` and again over the RETURN_TO_NORMAL window
    // at the very end (t >= RETURN_TO_NORMAL_START_T, see beats.ts) -- idleWeight (which blends how
    // much of that accumulation the camera keeps) ramps 1 -> 0 across hero/traverse and 0 -> 1
    // back across that ending window, so the accumulator needs to be live in both spans, not just
    // `hero`. Still fully disabled under prefers-reduced-motion.
    engine.setHeroIdle((scene.phase.id === 'hero' || scene.t >= RETURN_TO_NORMAL_START_T) && !prefersReducedMotion());
    engine.setReducedMotion(prefersReducedMotion());
  }, [status, scene]);

  const caption = PHASE_COPY[scene.phase.id].caption;
  // Deliberately unnumbered: the engine phase can lag the prose step by a half-viewport at
  // boundaries, and two visible ordinals disagreeing reads as a bug. The numbered sequence lives
  // in the prose eyebrows; this label captions whatever state the engine is actually in. The
  // hero phase's internal label isn't a figure caption, so it gets a descriptive one.
  const figureLabel = (scene.phase.id === 'hero' ? 'Assembled view' : scene.phase.label).toUpperCase();

  return (
    <div className="flex h-full w-full flex-col overflow-hidden lg:border-l lg:border-rule">
      <div className="relative flex-1" style={{ background: stageBackgroundCssAt(scene.t) }}>
        <div ref={containerRef} aria-hidden className="absolute inset-0" />

        {/* Technical figure label: always visible, not just in the loading/fallback state. Fades
            to white in lockstep with the backdrop beats (see engine/backdrop.ts's
            stageLabelColorAt) since the default dark-tertiary-ink color loses contrast against
            the gray/red/green panel states. */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-3 top-[9px] font-mono text-xs uppercase tracking-[0.08em]"
          style={{ color: stageLabelColorAt(scene.t) }}
        >
          {figureLabel}
        </div>

        {status !== 'ready' && (
          <div className="pointer-events-none absolute inset-0 flex flex-col p-3">
            <div className="flex flex-1 items-center justify-center px-8 text-center">
              <p className="font-mono text-xs text-ink-tertiary-deep">{caption}</p>
            </div>
          </div>
        )}

        <div className="sr-only" aria-live="polite">
          {caption}
        </div>
      </div>
    </div>
  );
}

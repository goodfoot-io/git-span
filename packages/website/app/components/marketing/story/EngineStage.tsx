import { useEffect, useRef, useState } from 'react';
import { PHASE_COPY } from './copy';
import { engineFrame } from './engine/beats';
import type { EngineScene } from './engine/EngineScene';
import type { SceneState } from './scene';

interface EngineStageProps {
  scene: SceneState;
}

type Status = 'loading' | 'ready' | 'fallback';

// The animation frame's background is pinned by the spec: flat warm-stone #f2efe6 edge to edge,
// shown during loading too, with the engine holding a clear whitespace margin -- never cropped,
// never touching the frame edges.
const STAGE_BACKGROUND = '#f2efe6';
const STAGE_GRAPHITE = '#4a4a4e';

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
    engine.setHeroIdle(scene.phase.id === 'hero' && !prefersReducedMotion());
  }, [status, scene]);

  const caption = PHASE_COPY[scene.phase.id].caption;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-lg">
      <div className="relative flex-1" style={{ backgroundColor: STAGE_BACKGROUND }}>
        <div ref={containerRef} aria-hidden className="absolute inset-0" />

        {status !== 'ready' && (
          <div className="pointer-events-none absolute inset-0 flex flex-col p-3">
            <span className="font-mono text-xs uppercase tracking-wide" style={{ color: STAGE_GRAPHITE }}>
              ENGINE
            </span>
            <div className="flex flex-1 items-center justify-center px-8 text-center">
              <p className="font-mono text-xs" style={{ color: STAGE_GRAPHITE }}>
                {caption}
              </p>
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

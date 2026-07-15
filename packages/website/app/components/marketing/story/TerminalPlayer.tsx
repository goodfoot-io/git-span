import { useEffect, useRef, useState } from 'react';
import type { PhaseId } from './scene';
import { Terminal } from './Terminal';
import { STATE_TIMELINES } from './transcript';

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M5 3.5v9l7-4.5z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
      <rect x="4.5" y="3.5" width="2.5" height="9" fill="currentColor" />
      <rect x="9" y="3.5" width="2.5" height="9" fill="currentColor" />
    </svg>
  );
}

export function TerminalPlayer({ state }: { state: PhaseId }) {
  const duration = STATE_TIMELINES[state]?.total ?? 1;

  const [progress, setProgress] = useState(0); // 0..1
  const [playing, setPlaying] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Advance progress with requestAnimationFrame while playing (time-based, not scroll-based).
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setProgress((p) => Math.min(1, p + dt / duration));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration]);

  // Stop at the end.
  useEffect(() => {
    if (progress >= 1) setPlaying(false);
  }, [progress]);

  // Trigger: play when the window reaches the vertical center of the viewport, pause when it
  // leaves. Reduced-motion users get the finished state immediately and no auto-play.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setProgress(1);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          setProgress((p) => (p >= 1 ? 0 : p));
          setPlaying(true);
        } else {
          setPlaying(false);
        }
      },
      // Collapse the root to the viewport's horizontal center line.
      { rootMargin: '-50% 0px -50% 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const toggle = () => {
    if (progress >= 1) {
      setProgress(0);
      setPlaying(true);
      return;
    }
    setPlaying((p) => !p);
  };

  return (
    <div ref={containerRef} className="w-full max-w-xl">
      <Terminal state={state} progress={progress} playing={playing} />
      {/* Transport controls: deliberately low-contrast so they recede behind the terminal, and
          come forward only on hover/focus. */}
      <div className="mt-2 flex items-center gap-3 opacity-45 transition-opacity duration-200 focus-within:opacity-90 hover:opacity-90">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Pause' : 'Play'}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-rule/60 text-ink-tertiary transition-colors hover:text-ink-secondary"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={progress}
          onChange={(event) => {
            setPlaying(false);
            setProgress(Number(event.target.value));
          }}
          aria-label="Scrub terminal animation"
          className="h-0.5 w-full cursor-pointer accent-ink-tertiary"
        />
      </div>
    </div>
  );
}

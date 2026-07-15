import type { RefObject } from 'react';
import { useEffect, useState } from 'react';
import { timelineFromScroll } from './scene';

export function useTimeline(firstStepRef: RefObject<HTMLElement | null>): number {
  const [t, setT] = useState(0);

  useEffect(() => {
    let frame = 0;

    const measure = () => {
      frame = 0;
      const el = firstStepRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const vh = window.innerHeight;
      setT(timelineFromScroll(top, vh));
    };

    const onScrollOrResize = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize, { passive: true });

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [firstStepRef]);

  return t;
}
